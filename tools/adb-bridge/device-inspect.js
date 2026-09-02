"use strict";

/**
 * ADB device inspect helpers: performance, processes, interactive shell, layout dump.
 * Zero npm deps. Used by the unified local bridge.
 */

const crypto = require("crypto");
const { spawn } = require("child_process");

/** @type {Map<string, { flips: number, time: number }>} */
const fpsStore = new Map();

/** @type {Map<string, import('child_process').ChildProcess>} */
const shellSessions = new Map();

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function shellCapture(adbSerial, serial, command, timeout = 15000) {
  try {
    const { stdout, stderr } = await adbSerial(serial, ["shell", command], { timeout });
    return `${stdout || ""}${stderr || ""}`.trim();
  } catch {
    return "";
  }
}

function parseProcStat(text) {
  const cpus = [];
  for (const raw of String(text || "").split("\n")) {
    const line = raw.trim();
    if (!line.startsWith("cpu")) continue;
    const parts = line.split(/\s+/);
    if (parts[0] === "cpu") continue; // aggregate
    if (!/^cpu\d+$/.test(parts[0])) continue;
    cpus.push({
      id: parts[0],
      times: {
        user: Number(parts[1]) || 0,
        nice: Number(parts[2]) || 0,
        sys: Number(parts[3]) || 0,
        idle: Number(parts[4]) || 0,
        iowait: Number(parts[5]) || 0,
        irq: Number(parts[6]) || 0,
        softirq: Number(parts[7]) || 0,
      },
    });
  }
  return cpus;
}

function cpuLoadBetween(prev, next) {
  if (!prev || !next) return 0;
  const loadOf = (t) => t.user + t.sys + t.nice + t.irq + t.iowait + t.softirq;
  const lastLoad = loadOf(prev.times);
  const lastTick = lastLoad + prev.times.idle;
  const load = loadOf(next.times);
  const tick = load + next.times.idle;
  const den = tick - lastTick;
  if (den <= 0) return 0;
  const ratio = (load - lastLoad) / den;
  return Math.max(0, Math.min(1, ratio));
}

function parseMeminfo(text) {
  const map = {};
  for (const raw of String(text || "").split("\n")) {
    const m = raw.match(/^(\w+):\s+(\d+)/);
    if (m) map[m[1]] = Number(m[2]) || 0;
  }
  const totalKb = map.MemTotal || 0;
  const availKb = map.MemAvailable || map.MemFree || 0;
  const usedKb = Math.max(0, totalKb - availKb);
  return {
    totalKb,
    availKb,
    usedKb,
    freeKb: map.MemFree || 0,
    buffersKb: map.Buffers || 0,
    cachedKb: map.Cached || 0,
    swapTotalKb: map.SwapTotal || 0,
    swapFreeKb: map.SwapFree || 0,
    usedRatio: totalKb > 0 ? usedKb / totalKb : 0,
  };
}

function parsePs(text) {
  const lines = String(text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return [];
  const out = [];
  for (const line of lines) {
    // USER PID PPID VSZ RSS WCHAN ADDR S NAME  (toybox) or similar
    // Also: PID USER NAME (busybox short)
    if (/^USER\b/i.test(line) || /^PID\b/i.test(line)) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    let user = "";
    let pid = 0;
    let name = "";
    let rssKb = 0;
    if (/^\d+$/.test(parts[0])) {
      pid = Number(parts[0]);
      user = parts[1] || "";
      name = parts.slice(parts.length >= 9 ? 8 : 2).join(" ") || parts[parts.length - 1] || "";
      if (parts.length >= 5 && /^\d+$/.test(parts[4])) rssKb = Number(parts[4]) || 0;
    } else if (/^\d+$/.test(parts[1])) {
      user = parts[0];
      pid = Number(parts[1]);
      // Prefer NAME column near end; ARGS may exist
      if (parts.length >= 9) {
        name = parts.slice(8).join(" ");
        if (/^\d+$/.test(parts[4])) rssKb = Number(parts[4]) || 0;
      } else {
        name = parts[parts.length - 1] || "";
      }
    } else {
      continue;
    }
    if (!pid || pid < 1) continue;
    out.push({ pid, user, name, rssKb });
  }
  // de-dupe by pid
  const seen = new Set();
  return out.filter((p) => {
    if (seen.has(p.pid)) return false;
    seen.add(p.pid);
    return true;
  });
}

function parseUiAutomatorXml(xml) {
  const text = String(xml || "");
  const nodes = [];
  const re = /<node\b([^>]*)\/?>/g;
  let m;
  while ((m = re.exec(text))) {
    const attrs = {};
    const attrRe = /([\w:.-]+)="([^"]*)"/g;
    let a;
    while ((a = attrRe.exec(m[1]))) {
      attrs[a[1]] = a[2]
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
    }
    const bounds = attrs.bounds || "";
    let rect = null;
    const bm = bounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    if (bm) {
      rect = {
        x1: Number(bm[1]),
        y1: Number(bm[2]),
        x2: Number(bm[3]),
        y2: Number(bm[4]),
        w: Number(bm[3]) - Number(bm[1]),
        h: Number(bm[4]) - Number(bm[2]),
      };
    }
    nodes.push({
      index: nodes.length,
      class: attrs.class || "",
      text: attrs.text || "",
      contentDesc: attrs["content-desc"] || "",
      resourceId: attrs["resource-id"] || "",
      package: attrs.package || "",
      clickable: attrs.clickable === "true",
      enabled: attrs.enabled !== "false",
      bounds,
      rect,
      attrs,
    });
  }
  return nodes;
}

async function readProcStat(adbSerial, serial) {
  const text = await shellCapture(adbSerial, serial, "cat /proc/stat", 10000);
  return parseProcStat(text);
}

async function getPerf(adbSerial, serial, opts = {}) {
  if (!serial) throw new Error("缺少设备 serial");
  const period = Math.max(50, Math.min(1000, Number(opts.period) || 200));
  const pkg = String(opts.package || "").trim();

  const first = await readProcStat(adbSerial, serial);
  await sleep(period);
  const [
    second,
    memRaw,
    flipsRaw,
    foreground,
    tempRaw,
  ] = await Promise.all([
    readProcStat(adbSerial, serial),
    shellCapture(adbSerial, serial, "cat /proc/meminfo", 10000),
    shellCapture(adbSerial, serial, "dumpsys SurfaceFlinger 2>/dev/null | head -n 80", 20000),
    shellCapture(
      adbSerial,
      serial,
      "dumpsys activity activities 2>/dev/null | grep -E 'mResumedActivity|topResumedActivity' | head -n 3",
      20000
    ),
    shellCapture(adbSerial, serial, "dumpsys thermalservice 2>/dev/null | head -n 40", 15000),
  ]);

  const cores = second.map((cpu, idx) => {
    const load = cpuLoadBetween(first[idx], cpu);
    return { id: cpu.id, load, loadPct: Math.round(load * 1000) / 10 };
  });
  const avgLoad = cores.length ? cores.reduce((s, c) => s + c.load, 0) / cores.length : 0;

  let fps = 0;
  const flipMatch = flipsRaw.match(/flips=(\d+)/);
  if (flipMatch) {
    const flips = Number(flipMatch[1]) || 0;
    const time = Date.now();
    const prev = fpsStore.get(serial);
    if (prev && time > prev.time) {
      fps = Math.max(0, Math.round(((flips - prev.flips) * 1000) / (time - prev.time)));
    }
    fpsStore.set(serial, { flips, time });
  } else if (pkg) {
    // Soft fallback: gfxinfo occasionally exposes frames
    const gfx = await shellCapture(
      adbSerial,
      serial,
      `dumpsys gfxinfo ${shellQuote(pkg)} framestats 2>/dev/null | head -n 5`,
      15000
    );
    void gfx;
  }

  let temperatureC = null;
  const tempMatch = tempRaw.match(/mValue=([\d.]+).*mName=CPU/i) || tempRaw.match(/Temperature\{mValue=([\d.]+)/);
  if (tempMatch) temperatureC = Math.round(Number(tempMatch[1]) * 10) / 10;

  return {
    ok: true,
    ts: Date.now(),
    periodMs: period,
    cpu: {
      cores,
      avgLoad,
      avgPct: Math.round(avgLoad * 1000) / 10,
    },
    memory: parseMeminfo(memRaw),
    fps,
    temperatureC,
    foreground: foreground || "",
  };
}

async function listProcesses(adbSerial, serial, opts = {}) {
  if (!serial) throw new Error("缺少设备 serial");
  const query = String(opts.query || "").trim().toLowerCase();
  const limit = Math.max(20, Math.min(2000, Number(opts.limit) || 400));

  let raw = await shellCapture(adbSerial, serial, "ps -A 2>/dev/null", 20000);
  if (!raw || raw.length < 20) {
    raw = await shellCapture(adbSerial, serial, "ps 2>/dev/null", 20000);
  }
  let processes = parsePs(raw);
  if (query) {
    processes = processes.filter(
      (p) =>
        String(p.name).toLowerCase().includes(query) ||
        String(p.user).toLowerCase().includes(query) ||
        String(p.pid).includes(query)
    );
  }
  processes.sort((a, b) => (b.rssKb || 0) - (a.rssKb || 0) || a.pid - b.pid);
  const truncated = processes.length > limit;
  if (truncated) processes = processes.slice(0, limit);
  return { ok: true, count: processes.length, truncated, processes, rawHint: processes.length ? "" : "未能解析进程列表" };
}

async function killProcess(adbSerial, serial, body = {}) {
  if (!serial) throw new Error("缺少设备 serial");
  const pid = Number(body.pid);
  const packageName = String(body.packageName || body.package || "").trim();
  const mode = String(body.mode || (packageName ? "force-stop" : "kill")).trim();

  if (mode === "force-stop" || packageName) {
    if (!packageName) throw new Error("force-stop 需要 packageName");
    if (!/^[A-Za-z0-9._]+$/.test(packageName)) throw new Error("非法包名");
    const { stdout, stderr } = await adbSerial(serial, ["shell", "am", "force-stop", packageName], {
      timeout: 20000,
    });
    return { ok: true, mode: "force-stop", packageName, output: `${stdout}\n${stderr}`.trim() };
  }

  if (!Number.isFinite(pid) || pid < 1) throw new Error("缺少有效 pid");
  const signal = String(body.signal || "TERM").toUpperCase();
  if (!["TERM", "KILL", "HUP", "INT", "9", "15"].includes(signal)) {
    throw new Error("不支持的 signal");
  }
  const sigArg = signal === "9" || signal === "KILL" ? "-9" : signal === "15" || signal === "TERM" ? "-15" : `-${signal}`;
  try {
    const { stdout, stderr } = await adbSerial(serial, ["shell", "kill", sigArg, String(pid)], {
      timeout: 15000,
    });
    return { ok: true, mode: "kill", pid, signal: sigArg, output: `${stdout}\n${stderr}`.trim() };
  } catch (err) {
    throw new Error(err.message || String(err));
  }
}

async function dumpLayout(adbSerial, serial) {
  if (!serial) throw new Error("缺少设备 serial");
  const remote = "/data/local/tmp/devtools-window-dump.xml";
  // Prefer exec-out dump to stdout when supported; fallback to file.
  let xml = "";
  try {
    const { stdout } = await adbSerial(
      serial,
      ["exec-out", "uiautomator", "dump", "/dev/tty"],
      { timeout: 45000, maxBuffer: 8 * 1024 * 1024 }
    );
    xml = String(stdout || "");
    if (xml.includes("<?xml") || xml.includes("<hierarchy")) {
      // ok
    } else {
      xml = "";
    }
  } catch {
    xml = "";
  }

  if (!xml) {
    await adbSerial(serial, ["shell", "uiautomator", "dump", remote], { timeout: 45000 }).catch(() => {});
    const { stdout } = await adbSerial(serial, ["exec-out", "cat", remote], {
      timeout: 30000,
      maxBuffer: 8 * 1024 * 1024,
    });
    xml = String(stdout || "");
  }

  if (!xml.includes("<")) {
    throw new Error("uiautomator dump 失败（部分机型需解锁屏幕，或未安装 uiautomator）");
  }

  // Strip non-xml noise before first <
  const start = xml.indexOf("<");
  if (start > 0) xml = xml.slice(start);
  const nodes = parseUiAutomatorXml(xml);
  return {
    ok: true,
    nodeCount: nodes.length,
    nodes,
    xml,
  };
}

async function shellExec(adbSerial, serial, command, opts = {}) {
  if (!serial) throw new Error("缺少设备 serial");
  const cmd = String(command || "").trim();
  if (!cmd) throw new Error("命令不能为空");
  if (cmd.length > 8000) throw new Error("命令过长");
  // Block obvious remote exfil patterns? Keep permissive for local debug bridge.
  const timeout = Math.max(3000, Math.min(120000, Number(opts.timeout) || 30000));
  try {
    const { stdout, stderr } = await adbSerial(serial, ["shell", cmd], {
      timeout,
      maxBuffer: 4 * 1024 * 1024,
    });
    return {
      ok: true,
      stdout: String(stdout || ""),
      stderr: String(stderr || ""),
      code: 0,
    };
  } catch (err) {
    return {
      ok: false,
      stdout: String(err.stdout || ""),
      stderr: String(err.stderr || err.message || String(err)),
      code: typeof err.code === "number" ? err.code : 1,
      error: err.message || String(err),
    };
  }
}

/* ---- WebSocket interactive shell ---- */

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
    header[0] = 0x80 | opcode;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeUInt32BE(0, 2);
    header.writeUInt32BE(len, 6);
  }
  try {
    socket.write(Buffer.concat([header, payload]));
  } catch {
    /* ignore */
  }
}

function wsSendJson(socket, obj) {
  wsSend(socket, JSON.stringify(obj), 1);
}

function attachWsReader(socket, { onMessage, onClose }) {
  let buf = Buffer.alloc(0);
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    try {
      onClose && onClose();
    } catch {
      /* ignore */
    }
  };
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
        len = Number(buf.readUInt32BE(6));
        offset = 10;
      }
      const maskLen = masked ? 4 : 0;
      if (buf.length < offset + maskLen + len) return;
      let payload = buf.slice(offset + maskLen, offset + maskLen + len);
      if (masked) {
        const mask = buf.slice(offset, offset + 4);
        const out = Buffer.alloc(len);
        for (let i = 0; i < len; i++) out[i] = payload[i] ^ mask[i % 4];
        payload = out;
      }
      buf = buf.slice(offset + maskLen + len);
      if (opcode === 0x8) {
        close();
        try {
          socket.end();
        } catch {
          /* ignore */
        }
        return;
      }
      if (opcode === 0x9) {
        wsSend(socket, payload, 0xa);
        continue;
      }
      if (opcode === 0x1 || opcode === 0x2) {
        try {
          onMessage && onMessage(payload, opcode);
        } catch {
          /* ignore */
        }
      }
    }
  });
  socket.on("close", close);
  socket.on("error", close);
}

function startShellSession(serial, socket, deps) {
  const adb = deps.adbPath || "adb";
  const child = spawn(adb, ["-s", serial, "shell"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });
  const id = crypto.randomBytes(6).toString("hex");
  shellSessions.set(id, child);

  const sendOut = (chunk, stream) => {
    const text = Buffer.isBuffer(chunk) ? chunk.toString("utf8") : String(chunk || "");
    if (!text) return;
    wsSendJson(socket, { type: "data", stream, data: text });
  };

  child.stdout.on("data", (c) => sendOut(c, "stdout"));
  child.stderr.on("data", (c) => sendOut(c, "stderr"));
  child.on("exit", (code, signal) => {
    shellSessions.delete(id);
    wsSendJson(socket, { type: "exit", code, signal: signal || null });
    try {
      socket.end();
    } catch {
      /* ignore */
    }
  });
  child.on("error", (err) => {
    shellSessions.delete(id);
    wsSendJson(socket, { type: "error", error: err.message || String(err) });
    try {
      socket.end();
    } catch {
      /* ignore */
    }
  });

  wsSendJson(socket, { type: "ready", sessionId: id, serial });

  attachWsReader(socket, {
    onMessage: (payload) => {
      let msg;
      try {
        msg = JSON.parse(payload.toString("utf8"));
      } catch {
        // treat raw text as stdin
        if (child.stdin && !child.stdin.destroyed) {
          child.stdin.write(payload);
        }
        return;
      }
      if (msg.type === "stdin" || msg.type === "input") {
        const data = msg.data != null ? String(msg.data) : "";
        if (child.stdin && !child.stdin.destroyed) child.stdin.write(data);
      } else if (msg.type === "resize") {
        // Interactive adb shell without PTY protocol: best-effort stty
        const cols = Math.max(20, Math.min(300, Number(msg.cols) || 80));
        const rows = Math.max(5, Math.min(120, Number(msg.rows) || 24));
        if (child.stdin && !child.stdin.destroyed) {
          child.stdin.write(`stty cols ${cols} rows ${rows} 2>/dev/null\n`);
        }
      } else if (msg.type === "close" || msg.type === "kill") {
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
      }
    },
    onClose: () => {
      shellSessions.delete(id);
      try {
        if (!child.killed) child.kill("SIGTERM");
      } catch {
        /* ignore */
      }
    },
  });

  return id;
}

/**
 * Handle HTTP upgrade for /shell/ws
 * @returns {boolean} true if handled
 */
function handleShellUpgrade(req, socket, head, deps) {
  const url = new URL(req.url || "/", `http://${deps.host}:${deps.port}`);
  if (url.pathname !== "/shell/ws") return false;

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

  const token = String(
    url.searchParams.get("token") || req.headers["x-adb-token"] || req.headers["x-ffmpeg-token"] || ""
  );
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

  try {
    startShellSession(serial, socket, deps);
  } catch (err) {
    wsSendJson(socket, { type: "error", error: err.message || String(err) });
    try {
      socket.end();
    } catch {
      /* ignore */
    }
  }
  return true;
}

module.exports = {
  parseProcStat,
  parseMeminfo,
  parsePs,
  parseUiAutomatorXml,
  cpuLoadBetween,
  getPerf,
  listProcesses,
  killProcess,
  dumpLayout,
  shellExec,
  handleShellUpgrade,
  FEATURES: ["device-perf", "device-processes", "device-shell", "device-layout"],
};
