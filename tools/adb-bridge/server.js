#!/usr/bin/env node
"use strict";

/**
 * DevTools local ADB bridge (P0)
 * - Bind 127.0.0.1 only
 * - Zero npm dependencies
 * - File ops limited to /sdcard and /storage/emulated/0
 */

const http = require("http");
const { URL } = require("url");
const { spawn, execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const HOST = "127.0.0.1";
const PORT = Number(process.env.ADB_BRIDGE_PORT || 17888);
const TOKEN = String(process.env.ADB_BRIDGE_TOKEN || "devtools-adb");
const ALLOWED_ORIGINS = new Set(
  String(
    process.env.ADB_BRIDGE_ORIGINS ||
      [
        "https://afra55.github.io",
        "http://127.0.0.1:8080",
        "http://localhost:8080",
        "http://127.0.0.1:5500",
        "http://localhost:5500",
      ].join(",")
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

const ROOTS = ["/sdcard", "/storage/emulated/0"];
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "adb-bridge-"));

function sendJson(res, status, data, origin) {
  const body = JSON.stringify(data);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  };
  applyCors(headers, origin);
  res.writeHead(status, headers);
  res.end(body);
}

function applyCors(headers, origin) {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
    headers["Access-Control-Allow-Headers"] = "Content-Type, X-Adb-Token, X-Filename";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Expose-Headers"] = "Content-Disposition, X-Adb-Filename";
  }
}

function readBody(req, limit = 512 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("请求体过大"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function execFileAsync(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      {
        encoding: "utf8",
        maxBuffer: 20 * 1024 * 1024,
        timeout: opts.timeout || 120000,
        ...opts,
      },
      (err, stdout, stderr) => {
        if (err) {
          const message = (stderr || stdout || err.message || String(err)).trim();
          const wrapped = new Error(message || "命令执行失败");
          wrapped.code = err.code;
          wrapped.stdout = stdout;
          wrapped.stderr = stderr;
          reject(wrapped);
          return;
        }
        resolve({ stdout: stdout || "", stderr: stderr || "" });
      }
    );
  });
}

async function adb(args, opts) {
  return execFileAsync("adb", args, opts);
}

async function adbSerial(serial, args, opts) {
  if (!serial) throw new Error("缺少设备 serial");
  return adb(["-s", serial, ...args], opts);
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function normalizeRemotePath(input) {
  let p = String(input || "").trim().replace(/\\/g, "/");
  if (!p) p = "/sdcard";
  if (!p.startsWith("/")) p = `/${p}`;
  const parts = [];
  for (const seg of p.split("/")) {
    if (!seg || seg === ".") continue;
    if (seg === "..") {
      if (!parts.length) throw new Error("非法路径");
      parts.pop();
      continue;
    }
    if (seg.includes("\0")) throw new Error("非法路径");
    parts.push(seg);
  }
  const normalized = `/${parts.join("/")}`;
  const allowed = ROOTS.some((root) => normalized === root || normalized.startsWith(`${root}/`));
  if (!allowed) {
    throw new Error(`仅允许访问：${ROOTS.join("、")}`);
  }
  return normalized === "/" ? "/sdcard" : normalized;
}

function parentDir(remotePath) {
  const normalized = normalizeRemotePath(remotePath);
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return normalized;
  const parent = normalized.slice(0, idx);
  return parent || "/";
}

function basenameRemote(remotePath) {
  const normalized = normalizeRemotePath(remotePath);
  const idx = normalized.lastIndexOf("/");
  return idx >= 0 ? normalized.slice(idx + 1) : normalized;
}

function requireToken(req) {
  const token = req.headers["x-adb-token"];
  if (!token || token !== TOKEN) {
    const err = new Error("未授权：缺少或错误的 X-Adb-Token");
    err.status = 401;
    throw err;
  }
}

async function checkAdb() {
  try {
    const { stdout } = await adb(["version"], { timeout: 8000 });
    const line = stdout.split(/\r?\n/).find(Boolean) || stdout.trim();
    return { ok: true, version: line.trim() };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

async function listDevices() {
  const { stdout } = await adb(["devices", "-l"], { timeout: 10000 });
  const lines = stdout.split(/\r?\n/).slice(1);
  const devices = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    const serial = parts[0];
    const state = parts[1] || "unknown";
    const meta = {};
    for (const part of parts.slice(2)) {
      const eq = part.indexOf(":");
      if (eq > 0) meta[part.slice(0, eq)] = part.slice(eq + 1);
    }
    devices.push({
      serial,
      state,
      model: meta.model || "",
      product: meta.product || "",
      device: meta.device || "",
      transportId: meta["transport_id"] || "",
      usb: meta.usb || "",
    });
  }
  return devices;
}

async function getprop(serial, key) {
  try {
    const { stdout } = await adbSerial(serial, ["shell", "getprop", key], { timeout: 8000 });
    return stdout.trim();
  } catch {
    return "";
  }
}

async function deviceInfo(serial) {
  const devices = await listDevices();
  const base = devices.find((d) => d.serial === serial);
  if (!base) throw new Error("设备不存在或未连接");
  if (base.state !== "device") {
    return {
      ...base,
      ready: false,
      message: `设备状态为 ${base.state}，请在手机上授权 USB 调试`,
    };
  }

  const keys = [
    "ro.product.manufacturer",
    "ro.product.model",
    "ro.product.device",
    "ro.build.version.release",
    "ro.build.version.sdk",
    "ro.build.display.id",
    "ro.serialno",
    "ro.product.cpu.abi",
  ];
  const props = {};
  await Promise.all(
    keys.map(async (key) => {
      props[key] = await getprop(serial, key);
    })
  );

  let battery = "";
  try {
    const { stdout } = await adbSerial(serial, ["shell", "dumpsys", "battery"], { timeout: 10000 });
    const level = stdout.match(/level:\s*(\d+)/);
    const status = stdout.match(/status:\s*(\d+)/);
    battery = level ? `${level[1]}%` : "";
    if (status) battery += status[1] === "2" ? "（充电中）" : "";
  } catch {
    battery = "";
  }

  let screen = "";
  try {
    const { stdout } = await adbSerial(serial, ["shell", "wm", "size"], { timeout: 8000 });
    const m = stdout.match(/(\d+)\s*x\s*(\d+)/i);
    screen = m ? `${m[1]}x${m[2]}` : stdout.trim();
  } catch {
    screen = "";
  }

  let density = "";
  try {
    const { stdout } = await adbSerial(serial, ["shell", "wm", "density"], { timeout: 8000 });
    const m = stdout.match(/(\d+)/);
    density = m ? m[1] : stdout.trim();
  } catch {
    density = "";
  }

  let storage = "";
  try {
    const { stdout } = await adbSerial(serial, ["shell", "df", "-h", "/sdcard"], { timeout: 8000 });
    const lines = stdout.trim().split(/\r?\n/);
    storage = lines[lines.length - 1] || stdout.trim();
  } catch {
    storage = "";
  }

  return {
    ...base,
    ready: true,
    manufacturer: props["ro.product.manufacturer"] || "",
    model: props["ro.product.model"] || base.model || "",
    deviceName: props["ro.product.device"] || base.device || "",
    androidVersion: props["ro.build.version.release"] || "",
    sdk: props["ro.build.version.sdk"] || "",
    buildId: props["ro.build.display.id"] || "",
    serialno: props["ro.serialno"] || serial,
    abi: props["ro.product.cpu.abi"] || "",
    battery,
    screen,
    density,
    storage,
  };
}

function parseLsLine(line) {
  const trimmed = line.replace(/\r/g, "").trimEnd();
  if (!trimmed) return null;
  // Android toybox/busybox style
  const m = trimmed.match(
    /^([bcdlps\-])([rwxstST\-]{9})\s+(\d+)\s+(\S+)\s+(\S+)\s+(\d+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2})\s+(.+)$/
  );
  if (m) {
    const typeChar = m[1];
    const name = m[9];
    if (name === "." || name === "..") return null;
    return {
      name,
      type: typeChar === "d" ? "dir" : typeChar === "l" ? "link" : "file",
      mode: `${m[1]}${m[2]}`,
      links: Number(m[3]),
      owner: m[4],
      group: m[5],
      size: Number(m[6]),
      date: `${m[7]} ${m[8]}`,
    };
  }
  // fallback: name only
  if (trimmed === "." || trimmed === "..") return null;
  return {
    name: trimmed,
    type: "unknown",
    mode: "",
    size: 0,
    date: "",
  };
}

async function listDir(serial, remotePath) {
  const dir = normalizeRemotePath(remotePath);
  const { stdout, stderr } = await adbSerial(
    serial,
    ["shell", `ls -la ${shellQuote(dir)}`],
    { timeout: 20000 }
  );
  const text = stdout || stderr || "";
  if (/No such file|Permission denied|Not a directory/i.test(text) && !text.includes("\n")) {
    throw new Error(text.trim());
  }
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || /^total\s+/i.test(line)) continue;
    const item = parseLsLine(line);
    if (item) entries.push(item);
  }
  entries.sort((a, b) => {
    if (a.type === "dir" && b.type !== "dir") return -1;
    if (a.type !== "dir" && b.type === "dir") return 1;
    return a.name.localeCompare(b.name);
  });
  return { path: dir, entries };
}

async function deletePath(serial, remotePath) {
  const target = normalizeRemotePath(remotePath);
  if (ROOTS.includes(target)) throw new Error("不能删除根目录");
  await adbSerial(serial, ["shell", `rm -rf -- ${shellQuote(target)}`], { timeout: 60000 });
  return { ok: true, path: target };
}

async function mkdirPath(serial, remotePath) {
  const target = normalizeRemotePath(remotePath);
  await adbSerial(serial, ["shell", `mkdir -p -- ${shellQuote(target)}`], { timeout: 20000 });
  return { ok: true, path: target };
}

async function uploadFile(serial, dir, filename, buffer) {
  const safeDir = normalizeRemotePath(dir);
  const safeName = path.basename(String(filename || "upload.bin")).replace(/[\\/]/g, "_");
  if (!safeName) throw new Error("文件名无效");
  const remote = normalizeRemotePath(`${safeDir}/${safeName}`);
  const local = path.join(TMP_ROOT, `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${safeName}`);
  fs.writeFileSync(local, buffer);
  try {
    await adbSerial(serial, ["push", local, remote], { timeout: 300000 });
  } finally {
    try {
      fs.unlinkSync(local);
    } catch {
      /* ignore */
    }
  }
  return { ok: true, path: remote, size: buffer.length };
}

async function downloadFile(serial, remotePath) {
  const target = normalizeRemotePath(remotePath);
  const local = path.join(
    TMP_ROOT,
    `${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${basenameRemote(target)}`
  );
  await adbSerial(serial, ["pull", target, local], { timeout: 300000 });
  const data = fs.readFileSync(local);
  try {
    fs.unlinkSync(local);
  } catch {
    /* ignore */
  }
  return { filename: basenameRemote(target), data };
}

async function handleApi(req, res, url) {
  const origin = req.headers.origin || "";
  if (req.method === "OPTIONS") {
    const headers = {};
    applyCors(headers, origin);
    res.writeHead(204, headers);
    res.end();
    return;
  }

  try {
    if (url.pathname === "/health" && req.method === "GET") {
      const adbInfo = await checkAdb();
      let devices = [];
      if (adbInfo.ok) {
        try {
          devices = await listDevices();
        } catch {
          devices = [];
        }
      }
      sendJson(
        res,
        200,
        {
          ok: true,
          service: "devtools-adb-bridge",
          version: "0.1.0",
          port: PORT,
          tokenRequired: true,
          defaultTokenHint: "devtools-adb",
          adb: adbInfo,
          deviceCount: devices.length,
          roots: ROOTS,
        },
        origin
      );
      return;
    }

    requireToken(req);

    if (url.pathname === "/devices" && req.method === "GET") {
      const adbInfo = await checkAdb();
      if (!adbInfo.ok) {
        sendJson(res, 503, { ok: false, error: adbInfo.error || "未找到 adb", adb: adbInfo }, origin);
        return;
      }
      const devices = await listDevices();
      sendJson(res, 200, { ok: true, adb: adbInfo, devices }, origin);
      return;
    }

    if (url.pathname === "/device/info" && req.method === "GET") {
      const serial = url.searchParams.get("serial") || "";
      const info = await deviceInfo(serial);
      sendJson(res, 200, { ok: true, info }, origin);
      return;
    }

    if (url.pathname === "/fs/list" && req.method === "GET") {
      const serial = url.searchParams.get("serial") || "";
      const remotePath = url.searchParams.get("path") || "/sdcard";
      const result = await listDir(serial, remotePath);
      sendJson(res, 200, { ok: true, ...result }, origin);
      return;
    }

    if (url.pathname === "/fs/mkdir" && req.method === "POST") {
      const body = JSON.parse((await readBody(req, 1024 * 1024)).toString("utf8") || "{}");
      const result = await mkdirPath(body.serial, body.path);
      sendJson(res, 200, result, origin);
      return;
    }

    if (url.pathname === "/fs/delete" && req.method === "POST") {
      const body = JSON.parse((await readBody(req, 1024 * 1024)).toString("utf8") || "{}");
      const result = await deletePath(body.serial, body.path);
      sendJson(res, 200, result, origin);
      return;
    }

    if (url.pathname === "/fs/upload" && req.method === "POST") {
      const serial = url.searchParams.get("serial") || "";
      const dir = url.searchParams.get("path") || "/sdcard/Download";
      const filename =
        decodeURIComponent(url.searchParams.get("name") || "") ||
        String(req.headers["x-filename"] || "upload.bin");
      const buffer = await readBody(req);
      if (!buffer.length) throw new Error("空文件");
      const result = await uploadFile(serial, dir, filename, buffer);
      sendJson(res, 200, result, origin);
      return;
    }

    if (url.pathname === "/fs/download" && req.method === "GET") {
      const serial = url.searchParams.get("serial") || "";
      const remotePath = url.searchParams.get("path") || "";
      const file = await downloadFile(serial, remotePath);
      const headers = {
        "Content-Type": "application/octet-stream",
        "Content-Length": file.data.length,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "X-Adb-Filename": encodeURIComponent(file.filename),
        "Cache-Control": "no-store",
      };
      applyCors(headers, origin);
      res.writeHead(200, headers);
      res.end(file.data);
      return;
    }

    sendJson(res, 404, { ok: false, error: "未找到接口" }, origin);
  } catch (err) {
    const status = err.status || (String(err.message || "").includes("未授权") ? 401 : 400);
    sendJson(
      res,
      status,
      {
        ok: false,
        error: err.message || String(err),
      },
      origin
    );
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  handleApi(req, res, url);
});

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("========================================");
  console.log(" DevTools ADB Bridge 已启动");
  console.log(` 地址: http://${HOST}:${PORT}`);
  console.log(` Token: ${TOKEN}`);
  console.log(" 请保持此窗口打开，然后回到网页点击「连接」");
  console.log(" 需要本机已安装 adb，并执行过 adb devices");
  console.log("========================================");
  console.log("");
});

function cleanup() {
  try {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);
