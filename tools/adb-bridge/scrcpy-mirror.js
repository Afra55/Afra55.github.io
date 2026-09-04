"use strict";

/**
 * Scrcpy-server mirror helper (video + control [+ optional audio]).
 * Zero npm deps. Pins Genymobile scrcpy-server v3.1.
 *
 * Protocol (tunnel_forward):
 *  1) video TCP: dummy byte 0x00
 *  2) audio TCP (optional): second connect
 *  3) control TCP: next connect (no dummy)
 *  4) device name 64 bytes on video
 *  5) video header: codec_id + width + height
 *  6) audio codec id u32 (if audio)
 *  7) frames: pts/flags u64 + size u32 + payload
 * WS binary: video flags 0..3; audio = 0x80|flags
 */

const fs = require("fs");
const path = require("path");
const net = require("net");
const http = require("http");
const https = require("https");
const crypto = require("crypto");
const { spawn } = require("child_process");
const ctrl = require("./scrcpy-ctrl");

const SCRCPY_VERSION = "3.1";
const SCRCPY_SERVER_NAME = `scrcpy-server-v${SCRCPY_VERSION}`;
const SCRCPY_SERVER_URL = `https://github.com/Genymobile/scrcpy/releases/download/v${SCRCPY_VERSION}/${SCRCPY_SERVER_NAME}`;
const SCRCPY_SERVER_SHA256 = "958f0944a62f23b1f33a16e9eb14844c1a04b882ca175a738c16d23cb22b86c0";
const PACKET_FLAG_CONFIG = 1n << 63n;
const PACKET_FLAG_KEY_FRAME = 1n << 62n;
const DEVICE_NAME_LEN = 64;
const REMOTE_JAR = "/data/local/tmp/devtools-scrcpy-server.jar";
const MAX_FRAME_BYTES = 16 * 1024 * 1024;
const MAX_READ_BUFFER = MAX_FRAME_BYTES + 256 * 1024;
const AUDIO_FLAG = 0x80;
const CODEC_OPUS = 0x6f707573;

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
  } else if (/Could not register|MediaCodec|encoder|IllegalStateException/i.test(tail)) {
    msg = "scrcpy-server 无法启动屏幕编码（请关闭其它投屏/录屏，解锁亮屏后重试；桥会自动降分辨率重试）";
  } else if (base === "socket closed" || /socket closed/i.test(base)) {
    const deviceSeen = /INFO:\s*Device:/i.test(tail);
    msg = `镜像握手失败（视频 socket 已关闭${procExitCode != null ? `，server 退出码 ${procExitCode}` : ""}）`;
    if (deviceSeen) {
      msg +=
        "。设备已启动但编码器/出流阶段断开（部分 Android 15+ / 红魔等机型对编码参数敏感）；请更新本站桥后重试，或关闭其它投屏后解锁亮屏再开镜像";
    }
  } else if (/ECONNREFUSED/i.test(base)) {
    if (/Device:/i.test(tail) || /INFO:.*Android/i.test(tail)) {
      msg =
        "本地 adb forward 在设备已启动后断开。常见原因：握手前抢连转发、多座桥抢端口。将自动重建转发；请只留一座桥窗口并保持手机解锁亮屏";
    } else {
      msg =
        "无法连接本地转发端口（adb forward 未在 127.0.0.1 监听）。请只留一座桥窗口后重试；Windows 上该端口可能被系统保留";
    }
  }
  if (tail) {
    const short = tail.length > 280 ? `${tail.slice(-280)}…` : tail;
    if (!msg.includes(short.slice(0, 40))) msg += ` — ${short}`;
  }
  return msg;
}

function isPortTaken(port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(true));
    s.once("listening", () => s.close(() => resolve(false)));
    s.listen(port, "127.0.0.1");
  });
}

function findEphemeralPort() {
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

/** scrcpy 默认区间，避开 Windows Hyper-V/WinNAT 排除端口。 */
async function findScrcpyTunnelPort() {
  const min = 27183;
  const max = 27320;
  for (let p = min; p <= max; p += 1) {
    if (!(await isPortTaken(p))) return p;
  }
  return findEphemeralPort();
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function listAdbForwards(deps, serial) {
  try {
    const { stdout } = await deps.adbSerial(serial, ["forward", "--list"], { timeout: 8000 });
    return String(stdout || "");
  } catch {
    return "";
  }
}

/**
 * 只登记 adb forward，不要在设备端 abstract socket 就绪前去 TCP 探测。
 * 部分机型（含 Android 14+）上，抢连会导致本机监听随后 ECONNREFUSED。
 */
async function setupAdbForward(deps, serial, scidHex) {
  let lastErr = null;
  for (let i = 0; i < 8; i += 1) {
    const port = await findScrcpyTunnelPort();
    try {
      await deps.adbSerial(serial, ["forward", "--remove", `tcp:${port}`], { timeout: 8000 }).catch(() => {});
      await deps.adbSerial(serial, ["forward", `tcp:${port}`, `localabstract:scrcpy_${scidHex}`], {
        timeout: 15000,
      });
      const listed = await listAdbForwards(deps, serial);
      if (!listed.includes(`tcp:${port}`)) {
        throw new Error(`adb forward 未登记 tcp:${port}`);
      }
      // 给 adb 一点时间真正 bind；不要 connect，否则可能弄丢转发
      await delay(80);
      return port;
    } catch (err) {
      lastErr = err;
      await deps.adbSerial(serial, ["forward", "--remove", `tcp:${port}`], { timeout: 8000 }).catch(() => {});
    }
  }
  const detail = lastErr && lastErr.message ? lastErr.message : String(lastErr || "unknown");
  throw new Error(`无法建立 adb 端口转发：${detail}`);
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

function connectLocal(port, timeoutMs = 8000, host = "127.0.0.1") {
  return new Promise((resolve, reject) => {
    const sock = net.connect({ host, port });
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

async function connectLocalAny(port, timeoutMs = 8000) {
  let last = null;
  for (const host of ["127.0.0.1", "localhost"]) {
    try {
      return await connectLocal(port, timeoutMs, host);
    } catch (err) {
      last = err;
    }
  }
  throw last || new Error("连接镜像端口失败");
}

/**
 * adb forward 的 TCP 连接会立刻成功，即使设备端尚未 listen。
 * 必须等到 dummy byte 0x00，才说明 scrcpy-server 真正 accept 了。
 * 切勿在 server 启动前 connect：部分机型会弄丢本机监听。
 */
async function connectUntilDummy(port, onProgress, opts = {}) {
  let last = null;
  const tries = opts.tries ?? 40;
  const shouldAbort = opts.shouldAbort;
  for (let i = 0; i < tries; i++) {
    if (shouldAbort?.()) break;
    let sock = null;
    let reader = null;
    try {
      sock = await connectLocalAny(port, 1500);
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
      // 本机已无监听：继续空转无意义，交给上层重建 forward
      if (/ECONNREFUSED/i.test(err?.message || String(err || ""))) {
        throw err;
      }
      if (i === 3 || i === 10 || i === 20) {
        onProgress?.(`等待设备端握手… (${i + 1}/${tries})`);
      }
      await delay(180);
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
  constructor(serial, deps, startOpts = {}) {
    this.serial = serial;
    this.deps = deps;
    this.startOpts = startOpts || {};
    this.port = 0;
    this.scidHex = "";
    this.proc = null;
    this.videoSock = null;
    this.audioSock = null;
    this.controlSock = null;
    this.clients = new Set();
    this.meta = null;
    this.closed = false;
    this.pumping = false;
    this.lastConfig = null;
    this.lastKeyFrame = null;
    this.errTail = "";
    this.procExitCode = null;
    this.reader = null;
    this.audioReader = null;
    this.controlEnabled = true;
    this.audioEnabled = false;
    this.clipboardSeq = 1n;
    this.controlBuf = Buffer.alloc(0);
    this.quality = ctrl.resolveQuality(this.startOpts.quality);
  }

  mirrorError(base) {
    return formatMirrorError(base, this.errTail, this.procExitCode);
  }

  buildServerShellCmd(appProcessRunner, opts = {}) {
    const q = opts.quality || this.quality;
    const videoBitRate = opts.videoBitRate ?? q.videoBitRate ?? 2500000;
    const maxSize = opts.maxSize ?? q.maxSize ?? 1280;
    const maxFps = opts.maxFps ?? q.maxFps ?? 30;
    const useControl = opts.control !== false;
    const useAudio = opts.audio === true;
    this.controlEnabled = useControl;
    this.audioEnabled = useAudio;
    const parts = [
      `CLASSPATH=${REMOTE_JAR}`,
      appProcessRunner,
      "/",
      "com.genymobile.scrcpy.Server",
      SCRCPY_VERSION,
      `scid=${this.scidHex}`,
      "log_level=info",
      "video=true",
      `audio=${useAudio ? "true" : "false"}`,
      `control=${useControl ? "true" : "false"}`,
      "tunnel_forward=true",
      "send_dummy_byte=true",
      "send_device_meta=true",
      "send_frame_meta=true",
      "send_codec_meta=true",
      "cleanup=false",
      "power_on=true",
      "stay_awake=true",
      "video_codec=h264",
      `video_bit_rate=${videoBitRate}`,
      `max_size=${maxSize}`,
      `max_fps=${maxFps}`,
    ];
    if (useAudio) {
      parts.push("audio_codec=opus", "audio_bit_rate=128000");
    }
    if (opts.showTouches) {
      parts.push("show_touches=true");
    }
    if (opts.videoCodecOptions) {
      parts.push(`video_codec_options=${opts.videoCodecOptions}`);
    }
    return parts.join(" ");
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

    const preferredRunner = await pickAppProcessRunner(this.deps, this.serial);

    const killServerProc = async () => {
      try {
        this.proc?.kill("SIGTERM");
      } catch {
        /* ignore */
      }
      this.proc = null;
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
    };

    const freshForward = async ({ newScid = true } = {}) => {
      if (this.port) {
        await this.deps.adbSerial(this.serial, ["forward", "--remove", `tcp:${this.port}`], { timeout: 8000 }).catch(() => {});
      }
      if (newScid || !this.scidHex) {
        const scid = crypto.randomBytes(4).readUInt32BE(0) & 0x7fffffff;
        this.scidHex = scid.toString(16).padStart(8, "0");
      }
      this.port = await setupAdbForward(this.deps, this.serial, this.scidHex);
    };

    const cleanupHandshakeSockets = () => {
      try {
        this.reader?.destroy();
      } catch {
        /* ignore */
      }
      this.reader = null;
      try {
        this.audioReader?.destroy();
      } catch {
        /* ignore */
      }
      this.audioReader = null;
      try {
        this.videoSock?.destroy();
      } catch {
        /* ignore */
      }
      this.videoSock = null;
      try {
        this.audioSock?.destroy();
      } catch {
        /* ignore */
      }
      this.audioSock = null;
      try {
        this.controlSock?.destroy();
      } catch {
        /* ignore */
      }
      this.controlSock = null;
    };

    const waitServerBanner = async () => {
      const t0 = Date.now();
      while (Date.now() - t0 < 5000) {
        if (this.procExitCode != null) {
          throw new Error(
            this.mirrorError(`scrcpy-server 已退出${this.procExitCode != null ? ` (code ${this.procExitCode})` : ""}`)
          );
        }
        if (/\[server\]\s*INFO:\s*Device:/i.test(this.errTail) || /INFO:\s*Device:/i.test(this.errTail)) {
          await delay(120);
          return;
        }
        await delay(80);
      }
    };

    const handshakeOnce = async () => {
      await waitServerBanner().catch((err) => {
        if (/已退出/i.test(err.message || "")) throw err;
      });
      onProgress?.("等待视频握手（dummy byte）…");
      const { sock, reader } = await connectUntilDummy(this.port, onProgress, {
        shouldAbort: () => this.closed || this.procExitCode != null,
      });
      this.videoSock = sock;
      this.reader = reader;
      // accept 顺序：video → [audio] → [control]
      if (this.audioEnabled) {
        onProgress?.("连接音频通道…");
        try {
          this.audioSock = await connectLocalAny(this.port, 5000);
          this.audioSock.setNoDelay(true);
          this.audioSock.pause();
          this.audioReader = new SocketReader(this.audioSock);
        } catch (err) {
          throw new Error(`音频通道连接失败：${err.message || err}`);
        }
      }
      if (this.controlEnabled) {
        onProgress?.("连接 scrcpy 控制通道…");
        try {
          this.controlSock = await connectLocalAny(this.port, 5000);
          this.controlSock.setNoDelay(true);
          this.attachControlPump();
        } catch (err) {
          throw new Error(`控制通道连接失败：${err.message || err}`);
        }
      }
      onProgress?.("已连接，读取分辨率…");
      this.meta = await readMirrorHandshake(reader, this.serial);
      this.meta.control = Boolean(this.controlSock && !this.controlSock.destroyed);
      this.meta.quality = this.quality.name;
      this.meta.audio = false;
      if (this.audioEnabled && this.audioReader) {
        const acodec = await this.audioReader.read(4, { timeoutMs: 15000 });
        const codecId = acodec.readUInt32BE(0);
        if (codecId === 0) {
          // 设备显式禁用音频
          this.audioEnabled = false;
        } else if (codecId === 1) {
          throw new Error("设备音频配置失败");
        } else {
          this.meta.audio = true;
          this.meta.audioCodec = codecId === CODEC_OPUS ? "opus" : `id:${codecId.toString(16)}`;
          this.meta.audioCodecId = codecId;
        }
      }
      this.pumping = true;
      this.pumpFrames().catch((err) => this.stop(this.mirrorError(err.message || String(err))));
      if (this.audioEnabled && this.audioReader) {
        this.pumpAudio().catch((err) => {
          this.broadcastJson({ type: "status", message: `音频中断：${err.message || err}` });
        });
      }
    };

    const isRetryableHandshake = (err) => {
      const m = err?.message || String(err || "");
      return (
        /socket closed|dummy byte|握手|ECONNREFUSED|MediaCodec|encoder|IllegalArgument|无法启动屏幕编码|控制通道|音频通道/i.test(m) ||
        this.procExitCode != null
      );
    };

    const wantAudio = this.startOpts.audio === true;
    const wantTouches = this.startOpts.showTouches === true;
    const q = this.quality;

    /** 参数阶梯：先按画质档位，再降级；控制/音频失败可关。 */
    const attempts = [
      {
        label: null,
        runner: preferredRunner,
        maxSize: q.maxSize,
        videoBitRate: q.videoBitRate,
        maxFps: q.maxFps,
        audio: wantAudio,
        showTouches: wantTouches,
      },
      {
        label: "编码器异常，降低分辨率重试…",
        runner: preferredRunner,
        maxSize: Math.min(800, q.maxSize),
        videoBitRate: 1500000,
        maxFps: 24,
        audio: false,
        showTouches: wantTouches,
      },
    ];
    if (preferredRunner === "app_process64") {
      attempts.push({
        label: "改用 app_process 重试…",
        runner: "app_process",
        maxSize: 800,
        videoBitRate: 1500000,
        maxFps: 24,
        audio: false,
        showTouches: false,
      });
    }
    attempts.push({
      label: "最小参数重试…",
      runner: "app_process",
      maxSize: 640,
      videoBitRate: 1000000,
      maxFps: 20,
      videoCodecOptions: "i-frame-interval=5",
      audio: false,
      showTouches: false,
    });
    attempts.push({
      label: "无控制通道降级（仅视频）…",
      runner: "app_process",
      maxSize: 800,
      videoBitRate: 1500000,
      maxFps: 24,
      control: false,
      audio: false,
      showTouches: false,
    });

    let lastErr = null;
    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      if (this.closed) break;
      if (i > 0) {
        if (!isRetryableHandshake(lastErr)) break;
        cleanupHandshakeSockets();
        await killServerProc();
        onProgress?.(attempt.label || "正在重试镜像…");
      } else {
        onProgress?.("正在建立 adb 端口转发…");
      }

      try {
        await freshForward();
        const shellCmd = this.buildServerShellCmd(attempt.runner, {
          maxSize: attempt.maxSize,
          videoBitRate: attempt.videoBitRate,
          maxFps: attempt.maxFps,
          videoCodecOptions: attempt.videoCodecOptions,
          control: attempt.control,
          audio: attempt.audio,
          showTouches: attempt.showTouches,
        });
        onProgress?.(i === 0 ? "正在启动设备端 scrcpy-server…" : `正在启动 scrcpy-server（${attempt.maxSize}p）…`);
        this.attachServerProc(this.spawnServerProcess(adb, shellCmd));
        await handshakeOnce();
        return;
      } catch (err) {
        cleanupHandshakeSockets();
        lastErr = err;
        const refused = /ECONNREFUSED/i.test(err.message || String(err || ""));
        if (refused && !this.closed && i === 0) {
          try {
            onProgress?.("转发已失效，正在重建 adb forward…");
            await freshForward({ newScid: false });
            await handshakeOnce();
            return;
          } catch (err2) {
            cleanupHandshakeSockets();
            lastErr = err2;
          }
        }
      }
    }

    const msg = this.mirrorError(lastErr?.message || String(lastErr || "握手失败"));
    this.stop(msg);
    throw new Error(msg);
  }

  broadcastJson(obj) {
    for (const c of this.clients) wsSendJson(c, obj);
  }

  broadcastBinary(buf) {
    for (const c of this.clients) wsSendBinary(c, buf);
  }

  wrapMirrorPacket(flags, pts, payload) {
    const out = Buffer.alloc(5 + payload.length);
    out[0] = flags;
    out.writeUInt32BE(pts >>> 0, 1);
    payload.copy(out, 5);
    return out;
  }

  /** AVCDecoderConfigurationRecord：以 1 开头的短配置。并进关键帧会让 WebCodecs 黑屏。 */
  isAvcDecoderConfig(buf) {
    if (!buf || buf.length < 7 || buf.length > 2048) return false;
    return buf[0] === 1;
  }

  /** 仅非 avcC 配置可并入下一媒体包；avcC 只单独发 configure */
  shouldMergeConfigIntoMedia(cfg) {
    if (!cfg || !cfg.length) return false;
    return !this.isAvcDecoderConfig(cfg);
  }

  prependConfigIfNeeded(cfg, keyBody, pts) {
    if (!cfg?.length || !keyBody?.length) return null;
    if (this.isAvcDecoderConfig(cfg)) return null;
    if (keyBody.length >= cfg.length && Buffer.compare(keyBody.subarray(0, cfg.length), cfg) === 0) {
      return null; // 已含配置
    }
    return this.wrapMirrorPacket(2, pts, Buffer.concat([cfg, keyBody]));
  }

  writeControl(buf) {
    if (!this.controlSock || this.controlSock.destroyed) return false;
    try {
      this.controlSock.write(buf);
      return true;
    } catch {
      return false;
    }
  }

  resetVideo() {
    return this.writeControl(ctrl.encodeEmpty(ctrl.TYPE_RESET_VIDEO));
  }

  videoSize() {
    return {
      w: Math.max(1, Math.min(0xffff, this.meta?.width || 1)),
      h: Math.max(1, Math.min(0xffff, this.meta?.height || 1)),
    };
  }

  injectTouch(msg = {}) {
    if (!this.meta) return false;
    const action = ctrl.resolveMotionAction(msg);
    if (action == null) return false;
    const { w, h } = this.videoSize();
    const x = Math.max(0, Math.min(w - 1, Math.round(Number(msg.x) || 0)));
    const y = Math.max(0, Math.min(h - 1, Math.round(Number(msg.y) || 0)));
    let pointerId = ctrl.POINTER_ID_FINGER;
    if (msg.pointerId === "virtual" || msg.pointer === "virtual" || msg.finger === 2) {
      pointerId = ctrl.POINTER_ID_VIRTUAL;
    } else if (msg.pointerId != null && typeof msg.pointerId !== "string") {
      try {
        pointerId = BigInt(msg.pointerId);
      } catch {
        /* keep finger */
      }
    }
    return this.writeControl(
      ctrl.encodeTouch({
        action,
        x,
        y,
        width: w,
        height: h,
        pressure: msg.pressure,
        pointerId,
      })
    );
  }

  injectScroll(msg = {}) {
    if (!this.meta) return false;
    const { w, h } = this.videoSize();
    const x = Math.max(0, Math.min(w - 1, Math.round(Number(msg.x) || w / 2)));
    const y = Math.max(0, Math.min(h - 1, Math.round(Number(msg.y) || h / 2)));
    return this.writeControl(
      ctrl.encodeScroll({
        x,
        y,
        width: w,
        height: h,
        hScroll: msg.hScroll ?? msg.h ?? 0,
        vScroll: msg.vScroll ?? msg.v ?? 0,
      })
    );
  }

  injectKey(msg = {}) {
    const keycode = ctrl.resolveKeycode(msg.keycode ?? msg.key);
    if (keycode == null) return false;
    const metaState = Number(msg.metaState) || 0;
    const repeat = Number(msg.repeat) || 0;
    if (msg.action === "down" || msg.action === ctrl.AKEY_DOWN) {
      return this.writeControl(ctrl.encodeKeycode({ action: ctrl.AKEY_DOWN, keycode, repeat, metaState }));
    }
    if (msg.action === "up" || msg.action === ctrl.AKEY_UP) {
      return this.writeControl(ctrl.encodeKeycode({ action: ctrl.AKEY_UP, keycode, repeat, metaState }));
    }
    // 完整按键：down + up
    const ok1 = this.writeControl(ctrl.encodeKeycode({ action: ctrl.AKEY_DOWN, keycode, repeat, metaState }));
    const ok2 = this.writeControl(ctrl.encodeKeycode({ action: ctrl.AKEY_UP, keycode, repeat: 0, metaState }));
    return ok1 && ok2;
  }

  injectText(text) {
    return this.writeControl(ctrl.encodeText(text));
  }

  setClipboard(text, paste = false) {
    const seq = this.clipboardSeq;
    this.clipboardSeq += 1n;
    return this.writeControl(ctrl.encodeSetClipboard(text, { sequence: seq, paste: Boolean(paste) }));
  }

  getClipboard() {
    return this.writeControl(ctrl.encodeGetClipboard(0));
  }

  setDisplayPower(on) {
    return this.writeControl(ctrl.encodeDisplayPower(Boolean(on)));
  }

  expandNotification() {
    return this.writeControl(ctrl.encodeEmpty(ctrl.TYPE_EXPAND_NOTIFICATION));
  }

  collapsePanels() {
    return this.writeControl(ctrl.encodeEmpty(ctrl.TYPE_COLLAPSE_PANELS));
  }

  rotateDevice() {
    return this.writeControl(ctrl.encodeEmpty(ctrl.TYPE_ROTATE_DEVICE));
  }

  /** 双指捏合：主指 + 虚拟指（官方 POINTER_ID_VIRTUAL_FINGER） */
  injectPinch(msg = {}) {
    const phase = String(msg.phase || msg.action || "MOVE").toUpperCase();
    const action = phase === "DOWN" ? ctrl.AMOTION_DOWN : phase === "UP" ? ctrl.AMOTION_UP : ctrl.AMOTION_MOVE;
    const ok1 = this.injectTouch({ action, x: msg.x1, y: msg.y1, pointerId: ctrl.POINTER_ID_FINGER });
    const ok2 = this.injectTouch({ action, x: msg.x2, y: msg.y2, pointerId: ctrl.POINTER_ID_VIRTUAL });
    return ok1 && ok2;
  }

  handleClientMessage(raw) {
    let msg = null;
    try {
      msg = JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw));
    } catch {
      return;
    }
    if (!msg || typeof msg !== "object") return;
    switch (msg.type) {
      case "touch":
        this.injectTouch(msg);
        break;
      case "scroll":
        this.injectScroll(msg);
        break;
      case "key":
      case "keycode":
        this.injectKey(msg);
        break;
      case "text":
        this.injectText(msg.text || "");
        break;
      case "clipboard":
      case "set_clipboard":
        this.setClipboard(msg.text || "", msg.paste);
        break;
      case "get_clipboard":
        this.getClipboard();
        break;
      case "display_power":
      case "power":
        this.setDisplayPower(msg.on !== false && msg.on !== 0);
        break;
      case "expand_notification":
        this.expandNotification();
        break;
      case "collapse_panels":
        this.collapsePanels();
        break;
      case "rotate":
        this.rotateDevice();
        break;
      case "pinch":
        this.injectPinch(msg);
        break;
      case "reset_video":
      case "resetVideo":
        this.resetVideo();
        break;
      default:
        break;
    }
  }

  attachControlPump() {
    if (!this.controlSock) return;
    this.controlSock.on("data", (chunk) => {
      this.controlBuf = Buffer.concat([this.controlBuf, chunk]);
      for (;;) {
        const { consumed, msg } = ctrl.parseDeviceMessage(this.controlBuf);
        if (consumed < 0) {
          this.controlBuf = Buffer.alloc(0);
          break;
        }
        if (!consumed) break;
        this.controlBuf = this.controlBuf.subarray(consumed);
        if (msg) this.broadcastJson(msg);
      }
    });
    this.controlSock.on("error", () => {});
  }

  addClient(socket) {
    this.clients.add(socket);
    if (this.meta) {
      wsSendJson(socket, {
        type: "hello",
        ...this.meta,
        control: Boolean(this.controlSock && !this.controlSock.destroyed),
        features: {
          touch: true,
          scroll: true,
          key: true,
          text: true,
          clipboard: true,
          displayPower: true,
          pinch: true,
          audio: Boolean(this.meta.audio),
          quality: this.quality.name,
        },
      });
      if (this.lastConfig) wsSendBinary(socket, Buffer.from(this.lastConfig));
      if (this.lastKeyFrame) {
        let keyPkt = this.lastKeyFrame;
        if (this.lastConfig && this.lastConfig.length > 5) {
          const cfg = this.lastConfig.subarray(5);
          const keyBody = this.lastKeyFrame.subarray(5);
          const pts = this.lastKeyFrame.readUInt32BE(1);
          const merged = this.prependConfigIfNeeded(cfg, keyBody, pts);
          if (merged) keyPkt = merged;
        }
        wsSendBinary(socket, Buffer.from(keyPkt));
      }
      this.resetVideo();
    }
  }

  removeClient(socket) {
    this.clients.delete(socket);
    if (!this.clients.size) this.stop("无客户端");
  }

  async pumpFrames() {
    let pendingConfig = null;
    while (this.pumping && this.reader && this.videoSock && !this.videoSock.destroyed) {
      const hdr = await this.reader.read(12, { timeoutMs: 120_000 });
      const ptsFlags = hdr.readBigUInt64BE(0);
      const size = hdr.readUInt32BE(8);
      if (size <= 0 || size > MAX_FRAME_BYTES) throw new Error(`异常帧大小 ${size}`);
      const payload = await this.reader.read(size, { slack: 0, maxTotal: size, timeoutMs: 120_000 });
      const isConfig = (ptsFlags & PACKET_FLAG_CONFIG) !== 0n;
      const isKey = (ptsFlags & PACKET_FLAG_KEY_FRAME) !== 0n;
      const pts = Number(ptsFlags & ~(PACKET_FLAG_CONFIG | PACKET_FLAG_KEY_FRAME));

      if (isConfig) {
        pendingConfig = Buffer.from(payload);
        const out = this.wrapMirrorPacket(1, 0, pendingConfig);
        this.lastConfig = out;
        if (this.clients.size) this.broadcastBinary(out);
        continue;
      }

      let media = payload;
      // Annex-B 配置可并入下一包（对齐 demuxer）；avcC 绝不能并——否则 WebCodecs 关键帧黑屏
      if (pendingConfig && pendingConfig.length && this.shouldMergeConfigIntoMedia(pendingConfig)) {
        media = Buffer.concat([pendingConfig, payload]);
        pendingConfig = null;
      } else if (pendingConfig) {
        pendingConfig = null;
      }
      let flags = 0;
      if (isKey) flags |= 2;
      const out = this.wrapMirrorPacket(flags, pts, media);
      if (isKey) this.lastKeyFrame = out;
      if (this.clients.size) this.broadcastBinary(out);
    }
  }

  async pumpAudio() {
    let pendingConfig = null;
    while (this.pumping && this.audioReader && this.audioSock && !this.audioSock.destroyed) {
      const hdr = await this.audioReader.read(12, { timeoutMs: 120_000 });
      const ptsFlags = hdr.readBigUInt64BE(0);
      const size = hdr.readUInt32BE(8);
      if (size <= 0 || size > MAX_FRAME_BYTES) throw new Error(`异常音频帧 ${size}`);
      const payload = await this.audioReader.read(size, { slack: 0, maxTotal: size, timeoutMs: 120_000 });
      const isConfig = (ptsFlags & PACKET_FLAG_CONFIG) !== 0n;
      const pts = Number(ptsFlags & ~(PACKET_FLAG_CONFIG | PACKET_FLAG_KEY_FRAME));
      if (isConfig) {
        pendingConfig = Buffer.from(payload);
        const out = this.wrapMirrorPacket(AUDIO_FLAG | 1, 0, pendingConfig);
        if (this.clients.size) this.broadcastBinary(out);
        continue;
      }
      let media = payload;
      if (pendingConfig && pendingConfig.length) {
        // opus config 单独给 decoder；媒体帧不再强制合并
        pendingConfig = null;
      }
      const out = this.wrapMirrorPacket(AUDIO_FLAG, pts, media);
      if (this.clients.size) this.broadcastBinary(out);
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
      this.audioReader?.destroy();
    } catch {
      /* ignore */
    }
    this.audioReader = null;
    try {
      this.videoSock?.destroy();
    } catch {
      /* ignore */
    }
    this.videoSock = null;
    try {
      this.audioSock?.destroy();
    } catch {
      /* ignore */
    }
    this.audioSock = null;
    try {
      this.controlSock?.destroy();
    } catch {
      /* ignore */
    }
    this.controlSock = null;
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

async function getOrStartSession(serial, deps, onProgress, startOpts = {}) {
  const existing = sessions.get(serial);
  if (existing && !existing.closed) {
    existing.stop("restart");
  }
  const session = new MirrorSession(serial, deps, startOpts);
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
    onMessage: (payload, opcode) => {
      if (opcode === 1 && session) session.handleClientMessage(payload);
    },
    onClose: () => {
      if (session) session.removeClient(socket);
    },
  });

  const startOpts = {
    quality: url.searchParams.get("quality") || "balanced",
    audio: url.searchParams.get("audio") === "1" || url.searchParams.get("audio") === "true",
    showTouches:
      url.searchParams.get("show_touches") === "1" || url.searchParams.get("show_touches") === "true",
  };

  getOrStartSession(
    serial,
    deps,
    (message) => {
      if (!closed && !socket.destroyed) {
        try {
          wsSendJson(socket, { type: "status", message });
        } catch {
          /* ignore */
        }
      }
    },
    startOpts
  )
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
  QUALITY_PRESETS: ctrl.QUALITY_PRESETS,
};
