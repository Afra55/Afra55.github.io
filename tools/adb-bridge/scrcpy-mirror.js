"use strict";

/**
 * Scrcpy-server mirror helper (video only).
 * Zero npm deps. Pins Genymobile scrcpy-server v3.1.
 *
 * Protocol (tunnel_forward, video only, control=false):
 *  1) dummy byte 0x00
 *  2) device name 64 bytes
 *  3) video header: codec_id u32 + width u32 + height u32
 *  4) frames: pts/flags u64 + size u32 + payload
 */

const fs = require("fs");
const path = require("path");
const net = require("net");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { spawn } = require("child_process");

const SCRCPY_VERSION = "3.1";
const SCRCPY_SERVER_NAME = `scrcpy-server-v${SCRCPY_VERSION}`;
const SCRCPY_SERVER_URL = `https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/${SCRCPY_SERVER_NAME}`;
const SCRCPY_SERVER_SHA256 = "958f0944a62f23b1f33a16e9eb14844c1a04b882ca175a738c16d23cb22b86c0";
const PACKET_FLAG_CONFIG = 1n << 63n;
const PACKET_FLAG_KEY_FRAME = 1n << 62n;
const DEVICE_NAME_LEN = 64;
const REMOTE_JAR = "/data/local/tmp/devtools-scrcpy-server.jar";
/** 单帧 payload 上限（与 pumpFrames 一致） */
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
/** readExact 绝对缓冲上限，防止协议错位时无限累积 */
const MAX_READ_BUFFER = MAX_FRAME_BYTES + 256 * 1024;

const sessions = new Map(); // serial -> Session

function bridgeDataDir() {
  const raw = process.env.ADB_BRIDGE_DIR || process.env.DEVTOOLS_BRIDGE_DIR;
  if (raw && String(raw).trim()) return path.resolve(String(raw).trim());
  return __dirname;
}

function cacheDir() {
  return bridgeDataDir();
}

function vendorJarPath() {
  return path.join(bridgeDataDir(), "vendor", SCRCPY_SERVER_NAME);
}

function cachedJarPath() {
  return path.join(bridgeDataDir(), "vendor", SCRCPY_SERVER_NAME);
}

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const tmp = `${dest}.part`;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const req = mod.get(url, { headers: { "User-Agent": "devtools-adb-bridge" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadFile(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`下载 scrcpy-server 失败 HTTP ${res.statusCode}`));
        return;
      }
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on("finish", () => {
        out.close(() => {
          try {
            fs.renameSync(tmp, dest);
            resolve(dest);
          } catch (err) {
            reject(err);
          }
        });
      });
      out.on("error", (err) => {
        req.destroy();
        fs.unlink(tmp, () => {});
        reject(err);
      });
    });
    req.on("error", (err) => {
      fs.unlink(tmp, () => {});
      reject(err);
    });
  });
}

async function ensureServerJar() {
  const candidates = [vendorJarPath(), cachedJarPath()];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        if (sha256File(p) === SCRCPY_SERVER_SHA256) return p;
      } catch {
        /* continue */
      }
    }
  }
  const dest = cachedJarPath();
  await downloadFile(SCRCPY_SERVER_URL, dest);
  const got = sha256File(dest);
  if (got !== SCRCPY_SERVER_SHA256) {
    try {
      fs.unlinkSync(dest);
    } catch {
      /* ignore */
    }
    throw new Error(`scrcpy-server 校验失败（期望 ${SCRCPY_SERVER_SHA256.slice(0, 12)}…）`);
  }
  return dest;
}

async function pickAppProcessRunner(deps, serial) {
  try {
    const { stdout } = await deps.adbSerial(serial, ["shell", "command -v app_process64 2>/dev/null || which app_process64"], {
      timeout: 8000,
    });
    if (stdout && stdout.trim()) return "app_process64";
  } catch {
    /* fall through */
  }
  return "app_process";
}

async function remoteJarOnDevice(deps, serial) {
  try {
    const { stdout } = await deps.adbSerial(
      serial,
      ["shell", `ls -l ${REMOTE_JAR} 2>/dev/null || echo __MISSING__`],
      { timeout: 10000 }
    );
    const line = String(stdout || "")
      .trim()
      .split("\n")
      .pop();
    if (!line || line.includes("__MISSING__") || /No such file/i.test(line)) {
      return { present: false, path: REMOTE_JAR, detail: line || "not found" };
    }
    const sizeMatch = line.match(/\s(\d+)\s+\d{4}-\d{2}-\d{2}/);
    const size = sizeMatch ? parseInt(sizeMatch[1], 10) : null;
    return { present: true, path: REMOTE_JAR, size, detail: line.trim() };
  } catch (err) {
    return { present: false, path: REMOTE_JAR, error: err.message || String(err) };
  }
}

async function ensureRemoteJar(deps, serial, localJar) {
  const localSize = fs.statSync(localJar).size;
  await deps.adbSerial(serial, ["push", localJar, REMOTE_JAR], { timeout: 120000 });
  const remote = await remoteJarOnDevice(deps, serial);
  if (!remote.present) {
    throw new Error(
      `无法 push scrcpy-server 到 ${REMOTE_JAR}（${remote.detail || remote.error || "设备上未找到文件"}）。请确认 USB 调试正常且 /data/local/tmp 可写`
    );
  }
  if (remote.size != null && Math.abs(remote.size - localSize) > 512) {
    throw new Error(
      `设备端 scrcpy-server 大小异常（本地 ${localSize} 字节，远端 ${remote.size} 字节）。请重试「开始镜像」；手机其它路径的 jar 不会被使用，仅认 ${REMOTE_JAR} v${SCRCPY_VERSION}`
    );
  }
  return { ...remote, expectedVersion: SCRCPY_VERSION, localSize };
}

function formatMirrorError(base, errTail, procExitCode) {
  const tail = String(errTail || "").trim();
  let msg = base;
  if (/does not match the client/i.test(tail)) {
    msg = `scrcpy-server 版本不匹配（需要 v${SCRCPY_VERSION}）。桥会自动 push 到 ${REMOTE_JAR}，手机其它路径的旧 jar 不会被使用`;
  } else if (/IllegalArgumentException|Invalid key=value/i.test(tail)) {
    msg = "scrcpy-server 启动参数被拒绝";
  } else if (/Permission denied|SecurityException|INJECT_EVENTS/i.test(tail)) {
    msg = "scrcpy-server 权限不足（请解锁屏幕并保持亮屏后重试）";
  } else if (/Could not register|MediaCodec|encoder/i.test(tail)) {
    msg = "scrcpy-server 无法启动屏幕编码（部分机型需关闭其它投屏/录屏应用）";
  } else if (base === "socket closed" || /socket closed/i.test(base)) {
    msg = `镜像握手失败（视频 socket 已关闭${procExitCode != null ? `，server 退出码 ${procExitCode}` : ""}）`;
  }
  if (tail) {
    const short = tail.length > 280 ? `${tail.slice(-280)}…` : tail;
    if (!msg.includes(short.slice(0, 40))) msg += ` — ${short}`;
  }
  return msg;
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const addr = s.address();
      const port = addr && typeof addr === "object" ? addr.port : 0;
      s.close((err) => (err ? reject(err) : resolve(port)));
    });
    s.on("error", reject);
  });
}

/**
 * 持续缓冲 socket 数据，避免每次 readExact 用 unshift 换监听时丢掉后续字节。
 */
class SocketReader {
  constructor(socket) {
    this.socket = socket;
    this.chunks = [];
    this.total = 0;
    this.wait = null;
    this.ended = null;
    this.onData = (chunk) => {
      if (!chunk || !chunk.length) return;
      this.chunks.push(chunk);
      this.total += chunk.length;
      this._flush();
    };
    this.onErr = (err) => this._end(err || new Error("socket error"));
    this.onClose = () => this._end(new Error("socket closed"));
    socket.on("data", this.onData);
    socket.on("error", this.onErr);
    socket.on("close", this.onClose);
    socket.resume();
  }

  read(n, opts = {}) {
    const timeoutMs = opts.timeoutMs ?? (n > 65536 ? 120_000 : 30_000);
    const slack = opts.slack ?? 0;
    const maxTotal = Math.min(opts.maxTotal ?? n + slack, MAX_READ_BUFFER);
    return new Promise((resolve, reject) => {
      if (this.wait) {
        reject(new Error("SocketReader 重叠读取"));
        return;
      }
      if (!Number.isFinite(n) || n < 0 || n > MAX_READ_BUFFER) {
        reject(new Error(`readExact 非法长度 ${n}`));
        return;
      }
      const waiter = { n, maxTotal, resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        if (this.wait === waiter) this.wait = null;
        reject(new Error(`读取 ${n} 字节超时（${timeoutMs}ms）`));
      }, timeoutMs);
      this.wait = waiter;
      this._flush();
    });
  }

  _take(n) {
    if (this.total < n) return null;
    if (this.chunks.length === 1) {
      const c = this.chunks[0];
      const out = c.subarray(0, n);
      const rest = c.subarray(n);
      this.chunks = rest.length ? [rest] : [];
      this.total -= n;
      return out;
    }
    const merged = Buffer.concat(this.chunks, this.total);
    const out = merged.subarray(0, n);
    const rest = merged.subarray(n);
    this.chunks = rest.length ? [rest] : [];
    this.total = rest.length;
    return out;
  }

  _flush() {
    const w = this.wait;
    if (!w) return;
    if (this.total > w.maxTotal) {
      this.wait = null;
      clearTimeout(w.timer);
      w.reject(new Error(`镜像数据流协议错位（期望 ${w.n} 字节，缓冲已达 ${this.total}）`));
      return;
    }
    if (this.total >= w.n) {
      this.wait = null;
      clearTimeout(w.timer);
      w.resolve(this._take(w.n));
      return;
    }
    if (this.ended) {
      this.wait = null;
      clearTimeout(w.timer);
      w.reject(this.ended);
    }
  }

  _end(err) {
    if (this.ended) {
      this._flush();
      return;
    }
    this.ended = err instanceof Error ? err : new Error(String(err || "socket closed"));
    this._flush();
  }

  destroy() {
    try {
      this.socket.destroy();
    } catch {
      /* ignore */
    }
  }
}

function parseVideoMeta(header) {
  const codecId = header.readUInt32BE(0);
  const width = header.readUInt32BE(4);
  const height = header.readUInt32BE(8);
  if (width <= 0 || width > 8192 || height <= 0 || height > 8192) {
    throw new Error(`异常分辨率 ${width}x${height}（握手可能失败，请重试镜像）`);
  }
  const codec =
    codecId === 0x68323634
      ? "h264"
      : codecId === 0x68323635
        ? "h265"
        : codecId === 0x00617631
          ? "av1"
          : `id:${codecId.toString(16)}`;
  return { codecId, width, height, codec };
}

async function readMirrorHandshake(reader, serial) {
  const nameBuf = await reader.read(DEVICE_NAME_LEN, { timeoutMs: 8000 });
  const deviceName = nameBuf.toString("utf8").replace(/\0+$/g, "") || serial;
  const header = await reader.read(12, { timeoutMs: 45000 });
  const { codecId, width, height, codec } = parseVideoMeta(header);
  return { deviceName, codec, codecId, width, height, version: SCRCPY_VERSION };
}

function connectLocal(port, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host: "127.0.0.1", port });
    const timer = setTimeout(() => {
      sock.destroy();
      reject(new Error("连接镜像端口超时"));
    }, timeoutMs);
    sock.once("connect", () => {
      clearTimeout(timer);
      sock.setNoDelay(true);
      sock.pause();
      resolve(sock);
    });
    sock.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

/**
 * adb forward 的 TCP 连接会立刻成功，即使设备端尚未 listen。
 * 必须等到 dummy byte 0x00，才说明 scrcpy-server 真正 accept 了。
 */
async function connectUntilDummy(port, onProgress) {
  let last = null;
  const tries = 40;
  for (let i = 0; i < tries; i++) {
    let sock = null;
    let reader = null;
    try {
      sock = await connectLocal(port, 1500);
      reader = new SocketReader(sock);
      const dummy = await reader.read(1, { timeoutMs: 2200 });
      return { sock, reader, dummy };
    } catch (err) {
      last = err;
      try {
        reader?.destroy();
      } catch {
        /* ignore */
      }
      try {
        sock?.destroy();
      } catch {
        /* ignore */
      }
      if (i === 3 || i === 10 || i === 20) {
        onProgress?.(`等待设备端握手… (${i + 1}/${tries})`);
      }
      await new Promise((r) => setTimeout(r, 180));
    }
  }
  throw last || new Error("等待视频握手超时（设备端未发送 dummy byte）");
}

function wsAcceptKey(key) {
  return crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
}

function wsSend(socket, data, opcode = 1) {
  if (!socket || socket.destroyed) return;
  const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | (opcode & 0x0f);
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  socket.write(Buffer.concat([header, payload]));
}

function wsSendJson(socket, obj) {
  wsSend(socket, JSON.stringify(obj), 1);
}

function wsSendBinary(socket, buf) {
  wsSend(socket, buf, 2);
}

function attachWsReader(socket, { onMessage, onClose }) {
  let buf = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const b0 = buf[0];
      const b1 = buf[1];
      const opcode = b0 & 0x0f;
      const masked = (b1 & 0x80) !== 0;
      let len = b1 & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        offset = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (buf.length < offset + maskLen + len) return;
      let payload = buf.subarray(offset + maskLen, offset + maskLen + len);
      if (masked) {
        const mask = buf.subarray(offset, offset + 4);
        payload = Buffer.from(payload);
        for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      }
      buf = buf.subarray(offset + maskLen + len);
      if (opcode === 0x8) {
        try {
          socket.end();
        } catch {
          /* ignore */
        }
        onClose?.();
        return;
      }
      if (opcode === 0x9) {
        wsSend(socket, payload, 0x0a);
        continue;
      }
      if (opcode === 0x1 || opcode === 0x2) onMessage?.(payload, opcode);
    }
  });
  socket.on("close", () => onClose?.());
  socket.on("error", () => onClose?.());
}

class MirrorSession {
  constructor(serial, deps) {
    this.serial = serial;
    this.deps = deps;
    this.port = 0;
    this.scidHex = "";
    this.proc = null;
    this.videoSock = null;
    this.clients = new Set();
    this.meta = null;
    this.closed = false;
    this.pumping = false;
    this.lastConfig = null;
    this.errTail = "";
    this.procExitCode = null;
    this.reader = null;
  }

  mirrorError(base) {
    return formatMirrorError(base, this.errTail, this.procExitCode);
  }

  buildServerShellCmd(appProcessRunner) {
    return [
      `CLASSPATH=${REMOTE_JAR}`,
      appProcessRunner,
      "/",
      "com.genymobile.scrcpy.Server",
      SCRCPY_VERSION,
      `scid=${this.scidHex}`,
      "log_level=info",
      "video=true",
      "audio=false",
      "control=false",
      "tunnel_forward=true",
      "send_dummy_byte=true",
      "send_device_meta=true",
      "send_frame_meta=true",
      "send_codec_meta=true",
      "cleanup=false",
      "power_on=true",
      "stay_awake=true",
      "video_codec=h264",
      "video_bit_rate=4000000",
      "max_size=1280",
      "max_fps=60",
    ].join(" ");
  }

  attachServerProc(proc) {
    this.proc = proc;
    this.errTail = "";
    this.procExitCode = null;
    proc.stderr.on("data", (d) => {
      this.errTail = (this.errTail + d.toString("utf8")).slice(-2000);
    });
    proc.stdout.on("data", (d) => {
      this.errTail = (this.errTail + d.toString("utf8")).slice(-2000);
    });
    proc.on("exit", (code) => {
      this.procExitCode = code;
      if (!this.closed) {
        this.stop(this.mirrorError(`scrcpy-server 已退出${code != null ? ` (code ${code})` : ""}`));
      }
    });
  }

  spawnServerProcess(adb, shellCmd) {
    return spawn(adb, ["-s", this.serial, "shell", shellCmd], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  async start(onProgress) {
    const jar = await ensureServerJar();
    const adb = this.deps.adbPath;
    onProgress?.("正在推送 scrcpy-server 到手机…");
    await ensureRemoteJar(this.deps, this.serial, jar);

    try {
      await this.deps.adbSerial(
        this.serial,
        [
          "shell",
          "pkill -f com.genymobile.scrcpy.Server 2>/dev/null; pkill -f devtools-scrcpy-server 2>/dev/null; true",
        ],
        { timeout: 8000 }
      );
    } catch {
      /* ignore */
    }

    try {
      await this.deps.adbSerial(this.serial, ["shell", "input keyevent KEYCODE_WAKEUP"], { timeout: 5000 });
    } catch {
      /* ignore */
    }

    const scid = crypto.randomBytes(4).readUInt32BE(0) & 0x7fffffff;
    this.scidHex = scid.toString(16).padStart(8, "0");
    this.port = await findFreePort();

    await this.deps.adbSerial(this.serial, ["forward", "--remove", `tcp:${this.port}`], { timeout: 8000 }).catch(() => {});
    await this.deps.adbSerial(this.serial, ["forward", `tcp:${this.port}`, `localabstract:scrcpy_${this.scidHex}`], {
      timeout: 15000,
    });

    const appProcessRunner = await pickAppProcessRunner(this.deps, this.serial);
    let shellCmd = this.buildServerShellCmd(appProcessRunner);
    onProgress?.("正在启动设备端 scrcpy-server…");
    this.attachServerProc(this.spawnServerProcess(adb, shellCmd));
    await new Promise((r) => setTimeout(r, 200));

    const handshakeOnce = async () => {
      onProgress?.("等待视频握手（dummy byte）…");
      const { sock, reader } = await connectUntilDummy(this.port, onProgress);
      this.videoSock = sock;
      this.reader = reader;
      onProgress?.("已连接，读取分辨率…");
      this.meta = await readMirrorHandshake(reader, this.serial);
      this.pumping = true;
      this.pumpFrames().catch((err) => this.stop(this.mirrorError(err.message || String(err))));
    };

    try {
      await handshakeOnce();
    } catch (err) {
      try {
        this.reader?.destroy();
      } catch {
        /* ignore */
      }
      this.reader = null;
      try {
        this.videoSock?.destroy();
      } catch {
        /* ignore */
      }
      this.videoSock = null;
      const failedWith64 = appProcessRunner === "app_process64";
      if (failedWith64 && ( /socket closed|dummy byte|握手/i.test(err.message || "") || this.procExitCode != null)) {
        try {
          this.proc?.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        this.proc = null;
        shellCmd = this.buildServerShellCmd("app_process");
        onProgress?.("改用 app_process 重试…");
        this.attachServerProc(this.spawnServerProcess(adb, shellCmd));
        await new Promise((r) => setTimeout(r, 200));
        try {
          await handshakeOnce();
          return;
        } catch {
          /* fall through to formatted error below */
        }
      }
      const msg = this.mirrorError(err.message || String(err));
      this.stop(msg);
      throw new Error(msg);
    }
  }

  broadcastJson(obj) {
    for (const c of this.clients) wsSendJson(c, obj);
  }

  broadcastBinary(buf) {
    for (const c of this.clients) wsSendBinary(c, buf);
  }

  addClient(socket) {
    this.clients.add(socket);
    if (this.meta) {
      wsSendJson(socket, { type: "hello", ...this.meta });
      if (this.lastConfig) wsSendBinary(socket, Buffer.from(this.lastConfig));
    }
  }

  removeClient(socket) {
    this.clients.delete(socket);
    if (!this.clients.size) this.stop("无客户端");
  }

  async pumpFrames() {
    while (this.pumping && this.reader && this.videoSock && !this.videoSock.destroyed) {
      const hdr = await this.reader.read(12, { timeoutMs: 120_000 });
      const ptsFlags = hdr.readBigUInt64BE(0);
      const size = hdr.readUInt32BE(8);
      if (size <= 0 || size > MAX_FRAME_BYTES) throw new Error(`异常帧大小 ${size}`);
      const payload = await this.reader.read(size, { slack: 0, maxTotal: size, timeoutMs: 120_000 });
      const isConfig = (ptsFlags & PACKET_FLAG_CONFIG) !== 0n;
      const isKey = (ptsFlags & PACKET_FLAG_KEY_FRAME) !== 0n;
      const pts = Number(ptsFlags & ~(PACKET_FLAG_CONFIG | PACKET_FLAG_KEY_FRAME));
      const out = Buffer.alloc(5 + payload.length);
      let flags = 0;
      if (isConfig) flags |= 1;
      if (isKey) flags |= 2;
      out[0] = flags;
      out.writeUInt32BE(pts >>> 0, 1);
      payload.copy(out, 5);
      if (isConfig) this.lastConfig = out;
      this.broadcastBinary(out);
    }
  }

  stop(reason) {
    if (this.closed) return;
    this.closed = true;
    this.pumping = false;
    for (const c of this.clients) {
      try {
        wsSendJson(c, { type: "bye", reason: reason || "stopped" });
        c.end();
      } catch {
        /* ignore */
      }
    }
    this.clients.clear();
    try {
      this.reader?.destroy();
    } catch {
      /* ignore */
    }
    this.reader = null;
    try {
      this.videoSock?.destroy();
    } catch {
      /* ignore */
    }
    this.videoSock = null;
    try {
      this.proc?.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    this.proc = null;
    if (this.port) {
      this.deps.adbSerial(this.serial, ["forward", "--remove", `tcp:${this.port}`], { timeout: 8000 }).catch(() => {});
    }
    sessions.delete(this.serial);
  }
}

async function getOrStartSession(serial, deps, onProgress) {
  const existing = sessions.get(serial);
  if (existing && !existing.closed) {
    existing.stop("restart");
  }
  const session = new MirrorSession(serial, deps);
  sessions.set(serial, session);
  try {
    await session.start(onProgress);
    return session;
  } catch (err) {
    sessions.delete(serial);
    throw err;
  }
}

function stopSession(serial) {
  const s = sessions.get(serial);
  if (s) s.stop("api-stop");
  return Boolean(s);
}

function stopAll() {
  for (const s of [...sessions.values()]) s.stop("shutdown");
}

function jarStatus() {
  const vendor = vendorJarPath();
  const cached = cachedJarPath();
  return {
    version: SCRCPY_VERSION,
    remotePath: REMOTE_JAR,
    vendor: fs.existsSync(vendor),
    cached: fs.existsSync(cached),
    url: SCRCPY_SERVER_URL,
  };
}

async function deviceJarStatus(serial, deps) {
  if (!serial || !deps?.adbSerial) return null;
  const remote = await remoteJarOnDevice(deps, serial);
  return {
    ...remote,
    expectedVersion: SCRCPY_VERSION,
    note: "仅使用此固定路径的 v3.1 jar；手机其它位置的 scrcpy jar 不会被读取",
  };
}

/**
 * Handle HTTP upgrade for /mirror/ws
 * @returns {boolean} true if handled
 */
function handleUpgrade(req, socket, head, deps) {
  const url = new URL(req.url || "/", `http://${deps.host}:${deps.port}`);
  if (url.pathname !== "/mirror/ws") return false;

  const origin = req.headers.origin || "";
  if (origin && deps.allowedOrigins && !deps.allowedOrigins.has(origin)) {
    try {
      const u = new URL(origin);
      const localHost = u.hostname === "127.0.0.1" || u.hostname === "localhost";
      if (!localHost) {
        socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return true;
      }
    } catch {
      socket.write("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return true;
    }
  }

  const token = String(url.searchParams.get("token") || req.headers["x-adb-token"] || req.headers["x-ffmpeg-token"] || "");
  const accepted =
    deps.acceptedTokens && typeof deps.acceptedTokens.has === "function"
      ? deps.acceptedTokens
      : new Set([deps.token, "devtools-bridge", "devtools-adb", "devtools-ffmpeg"].filter(Boolean));
  if (!token || !accepted.has(token)) {
    socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return true;
  }

  const serial = url.searchParams.get("serial") || "";
  if (!serial) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return true;
  }

  const key = req.headers["sec-websocket-key"];
  if (!key) {
    socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    socket.destroy();
    return true;
  }

  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\n" +
      "Upgrade: websocket\r\n" +
      "Connection: Upgrade\r\n" +
      `Sec-WebSocket-Accept: ${wsAcceptKey(key)}\r\n` +
      (origin && deps.allowedOrigins.has(origin) ? `Access-Control-Allow-Origin: ${origin}\r\n` : "") +
      "\r\n"
  );
  if (head && head.length) socket.unshift(head);

  let session = null;
  let closed = false;
  const fail = (msg) => {
    if (closed) return;
    closed = true;
    try {
      wsSendJson(socket, { type: "error", error: msg });
      socket.end();
    } catch {
      socket.destroy();
    }
  };

  attachWsReader(socket, {
    onMessage: () => {},
    onClose: () => {
      if (session) session.removeClient(socket);
    },
  });

  getOrStartSession(serial, deps, (message) => {
    if (!closed && !socket.destroyed) {
      try {
        wsSendJson(socket, { type: "status", message });
      } catch {
        /* ignore */
      }
    }
  })
    .then((s) => {
      session = s;
      if (closed || socket.destroyed) {
        s.removeClient(socket);
        return;
      }
      s.addClient(socket);
    })
    .catch((err) => fail(err.message || String(err)));

  return true;
}

module.exports = {
  SCRCPY_VERSION,
  SCRCPY_SERVER_NAME,
  REMOTE_JAR,
  ensureServerJar,
  handleUpgrade,
  stopSession,
  stopAll,
  jarStatus,
  deviceJarStatus,
  sessions,
};
