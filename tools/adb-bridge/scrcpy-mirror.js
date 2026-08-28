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
const os = require("os");
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

const sessions = new Map(); // serial -> Session

function cacheDir() {
  return path.join(os.homedir(), ".devtools-adb-bridge");
}

function vendorJarPath() {
  return path.join(__dirname, "vendor", SCRCPY_SERVER_NAME);
}

function cachedJarPath() {
  return path.join(cacheDir(), SCRCPY_SERVER_NAME);
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

function readExact(socket, n) {
  return new Promise((resolve, reject) => {
    let buf = Buffer.alloc(0);
    let settled = false;
    const done = (err, data) => {
      if (settled) return;
      settled = true;
      socket.off("data", onData);
      socket.off("error", onErr);
      socket.off("close", onClose);
      if (err) reject(err);
      else resolve(data);
    };
    const onErr = (e) => done(e || new Error("socket error"));
    const onClose = () => done(new Error("socket closed"));
    const onData = (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length >= n) {
        const out = buf.subarray(0, n);
        const rest = buf.subarray(n);
        if (rest.length) socket.unshift(rest);
        done(null, out);
      }
    };
    socket.on("data", onData);
    socket.on("error", onErr);
    socket.on("close", onClose);
    socket.resume();
  });
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
      resolve(sock);
    });
    sock.once("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

async function connectWithRetry(port, tries = 50, delayMs = 100) {
  let last = null;
  for (let i = 0; i < tries; i++) {
    try {
      return await connectLocal(port, 1500);
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw last || new Error("无法连接 scrcpy 视频端口");
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
  }

  async start() {
    const jar = await ensureServerJar();
    const adb = this.deps.adbPath;
    await this.deps.adbSerial(this.serial, ["push", jar, REMOTE_JAR], { timeout: 120000 });

    const scid = crypto.randomBytes(4).readUInt32BE(0) & 0x7fffffff;
    this.scidHex = scid.toString(16).padStart(8, "0");
    this.port = await findFreePort();

    await this.deps.adbSerial(this.serial, ["forward", `tcp:${this.port}`, `localabstract:scrcpy_${this.scidHex}`], {
      timeout: 15000,
    });

    const shellCmd = [
      `CLASSPATH=${REMOTE_JAR}`,
      "app_process",
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
      "cleanup=true",
      "power_on=true",
      "video_bit_rate=6000000",
      "max_size=1280",
      "max_fps=60",
    ].join(" ");

    this.proc = spawn(adb, ["-s", this.serial, "shell", shellCmd], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let errTail = "";
    this.proc.stderr.on("data", (d) => {
      errTail = (errTail + d.toString("utf8")).slice(-2000);
    });
    this.proc.stdout.on("data", (d) => {
      errTail = (errTail + d.toString("utf8")).slice(-2000);
    });
    this.proc.on("exit", () => {
      if (!this.closed) this.stop(`scrcpy-server 已退出${errTail ? `: ${errTail.trim()}` : ""}`);
    });

    try {
      this.videoSock = await connectWithRetry(this.port);
      const dummy = await readExact(this.videoSock, 1);
      if (dummy[0] !== 0) {
        // still proceed; some builds may omit
      }
      const nameBuf = await readExact(this.videoSock, DEVICE_NAME_LEN);
      const deviceName = nameBuf.toString("utf8").replace(/\0+$/g, "") || this.serial;
      const header = await readExact(this.videoSock, 12);
      const codecId = header.readUInt32BE(0);
      const width = header.readUInt32BE(4);
      const height = header.readUInt32BE(8);
      const codec =
        codecId === 0x68323634
          ? "h264"
          : codecId === 0x68323635
            ? "h265"
            : codecId === 0x00617631
              ? "av1"
              : `id:${codecId.toString(16)}`;
      this.meta = { deviceName, codec, codecId, width, height, version: SCRCPY_VERSION };
      this.pumping = true;
      this.pumpFrames().catch((err) => this.stop(err.message || String(err)));
    } catch (err) {
      this.stop(err.message || String(err));
      throw err;
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
    while (this.pumping && this.videoSock && !this.videoSock.destroyed) {
      const hdr = await readExact(this.videoSock, 12);
      const ptsFlags = hdr.readBigUInt64BE(0);
      const size = hdr.readUInt32BE(8);
      if (size <= 0 || size > 16 * 1024 * 1024) throw new Error(`异常帧大小 ${size}`);
      const payload = await readExact(this.videoSock, size);
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

async function getOrStartSession(serial, deps) {
  const existing = sessions.get(serial);
  if (existing && !existing.closed) return existing;
  const session = new MirrorSession(serial, deps);
  sessions.set(serial, session);
  try {
    await session.start();
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
    vendor: fs.existsSync(vendor),
    cached: fs.existsSync(cached),
    url: SCRCPY_SERVER_URL,
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

  const token = url.searchParams.get("token") || req.headers["x-adb-token"] || "";
  if (token !== deps.token) {
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

  getOrStartSession(serial, deps)
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
  ensureServerJar,
  handleUpgrade,
  stopSession,
  stopAll,
  jarStatus,
  sessions,
};
