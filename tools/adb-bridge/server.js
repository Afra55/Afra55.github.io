#!/usr/bin/env node
"use strict";

/**
 * DevTools local ADB bridge (P0–P3)
 * - Bind 127.0.0.1 only
 * - Zero npm dependencies
 * - Read roots: sdcard + system/app paths; writes default to sdcard/tmp unless forcePush
 */

const http = require("http");
const { URL } = require("url");
const { execFile, spawn } = require("child_process");
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

const BRIDGE_VERSION = "0.6.6";

/** Preferred quick roots shown in UI (reads are not limited to these) */
const ROOTS = [
  "/",
  "/sdcard",
  "/storage/emulated/0",
  "/data",
  "/data/local/tmp",
  "/data/data",
  "/data/app",
  "/system",
  "/system/app",
  "/system/priv-app",
  "/product/app",
  "/vendor/app",
];
/** Soft hint for safer writes; Device Explorer mode still allows any path (device enforces) */
const WRITE_ROOTS = ["/sdcard", "/storage/emulated/0", "/data/local/tmp"];
/** System/product APK dirs used by /install/push-system overwrite detection */
const SYSTEM_APP_ROOTS = [
  "/data/app",
  "/system/app",
  "/system/priv-app",
  "/product/app",
  "/vendor/app",
];
const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "adb-bridge-"));
const JOBS = new Map();
const UPLOADS = new Map();

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

function parseJsonBody(buf) {
  const text = Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf || "");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function execFileAsync(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const encoding = opts.encoding === "buffer" ? null : opts.encoding || "utf8";
    execFile(
      file,
      args,
      {
        encoding,
        maxBuffer: opts.maxBuffer || 20 * 1024 * 1024,
        timeout: opts.timeout || 120000,
        ...opts,
        encoding,
      },
      (err, stdout, stderr) => {
        if (err) {
          const message = String(stderr || stdout || err.message || err).trim();
          const wrapped = new Error(message || "命令执行失败");
          wrapped.code = err.code;
          wrapped.stdout = stdout;
          wrapped.stderr = stderr;
          reject(wrapped);
          return;
        }
        resolve({ stdout: stdout || (encoding === null ? Buffer.alloc(0) : ""), stderr: stderr || (encoding === null ? Buffer.alloc(0) : "") });
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

function isUnderRoots(normalized, roots) {
  return roots.some((root) => normalized === root || normalized.startsWith(`${root}/`));
}

/**
 * Normalize a remote path. Like Android Studio Device File Explorer:
 * any absolute path is allowed; the device enforces permissions.
 * @param {string} input
 * @param {{ write?: boolean, force?: boolean }} [opts]  force kept for API compat
 */
function normalizeRemotePath(input, opts = {}) {
  void opts;
  let p = String(input || "").trim().replace(/\\/g, "/");
  if (!p) p = "/";
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
  return parts.length ? `/${parts.join("/")}` : "/";
}

/** 常用存储别名：/sdcard ↔ /storage/emulated/0 */
function expandFsPathCandidates(remotePath) {
  const dir = normalizeRemotePath(remotePath);
  const out = [];
  const push = (p) => {
    const n = normalizeRemotePath(p);
    if (!out.includes(n)) out.push(n);
  };
  push(dir);

  const rewrite = (fromPrefix, toPrefix) => {
    if (dir === fromPrefix) push(toPrefix);
    else if (dir.startsWith(`${fromPrefix}/`)) push(`${toPrefix}${dir.slice(fromPrefix.length)}`);
  };
  rewrite("/sdcard", "/storage/emulated/0");
  rewrite("/storage/emulated/0", "/sdcard");
  rewrite("/storage/self/primary", "/storage/emulated/0");
  rewrite("/mnt/sdcard", "/storage/emulated/0");

  // Download 大小写差异（部分机型）
  if (/\/download$/i.test(dir) && !dir.endsWith("/Download")) {
    push(dir.replace(/\/download$/i, "/Download"));
  }
  if (dir.endsWith("/Download")) {
    push(dir.replace(/\/Download$/, "/download"));
  }
  return out;
}

async function resolveFsListPath(serial, remotePath) {
  const candidates = expandFsPathCandidates(remotePath);
  // 优先 readlink/realpath 解析符号链接（/sdcard → /storage/emulated/0）
  const primary = candidates[0];
  try {
    const { stdout } = await adbSerial(
      serial,
      ["shell", `readlink -f -- ${shellQuote(primary)} 2>/dev/null || realpath -- ${shellQuote(primary)} 2>/dev/null || echo`],
      { timeout: 8000 }
    );
    const resolved = String(stdout || "")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find((l) => l.startsWith("/"));
    if (resolved) {
      const n = normalizeRemotePath(resolved);
      if (!candidates.includes(n)) candidates.unshift(n);
      else {
        candidates.splice(candidates.indexOf(n), 1);
        candidates.unshift(n);
      }
    }
  } catch {
    /* ignore */
  }
  return candidates;
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

function createJob(type, meta = {}) {
  const id = crypto.randomBytes(6).toString("hex");
  const job = {
    id,
    type,
    status: "queued",
    progress: 0,
    message: "",
    items: [],
    artifacts: [],
    meta,
    error: "",
    child: null,
    pid: null,
    cancelRequested: false,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  JOBS.set(id, job);
  return job;
}

function touchJob(job, patch = {}) {
  Object.assign(job, patch, { updatedAt: Date.now() });
  return job;
}

function publicJob(job) {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    progress: job.progress,
    message: job.message,
    items: job.items,
    artifacts: job.artifacts.map((a) => ({
      name: a.name,
      size: a.size,
      serial: a.serial || "",
      mime: a.mime || "application/octet-stream",
    })),
    meta: job.meta,
    error: job.error,
    cancelRequested: Boolean(job.cancelRequested),
    pid: job.pid || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function tempName(prefix, filename) {
  const safe = path.basename(String(filename || "file.bin")).replace(/[\\/]/g, "_") || "file.bin";
  return path.join(TMP_ROOT, `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${safe}`);
}

async function checkAdb() {
  try {
    const { stdout } = await adb(["version"], { timeout: 8000 });
    const line = stdout.split(/\r?\n/).find(Boolean) || stdout.trim();
    return { ok: true, version: line.trim(), path: whichSync("adb") || "adb" };
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err),
      setup:
        "请安装 Android platform-tools，确保终端可执行 adb。macOS: brew install android-platform-tools；Windows: 安装 SDK Platform-Tools 并加入 PATH；Linux: 发行版包或官网 zip。",
    };
  }
}

async function probeOneTool(name) {
  const resolved = resolveTool(name);
  const which = whichSync(name);
  let ok = Boolean(which || (resolved && resolved !== name && fs.existsSync(resolved)));
  let binPath = which || (ok ? resolved : "") || "";
  if (!ok) {
    const bin = resolved || name;
    try {
      await execFileAsync(bin, name === "openssl" ? ["version"] : name === "adb" ? ["version"] : ["-help"], {
        timeout: 5000,
      });
      ok = true;
      binPath = binPath || bin;
    } catch (err) {
      const blob = `${err?.stdout || ""}${err?.stderr || ""}`;
      if (/Usage|Key and Certificate|Android Debug Bridge|apk file|OpenSSL/i.test(blob)) {
        ok = true;
        binPath = binPath || bin;
      }
    }
  }
  return { ok, path: binPath };
}

async function probeHostTools() {
  const names = ["adb", "keytool", "openssl", "apksigner", "aapt", "aapt2", "jarsigner"];
  const tools = {};
  for (const name of names) {
    tools[name] = await probeOneTool(name);
  }
  const signingOk = tools.keytool.ok || tools.apksigner.ok || tools.openssl.ok;
  return {
    tools,
    signingOk,
    adbOk: tools.adb.ok,
    setup: {
      adb: tools.adb.ok
        ? ""
        : "未找到 adb：安装 Android SDK Platform-Tools，并把 platform-tools 目录加入 PATH。macOS 可用 brew install android-platform-tools。",
      signing: signingOk
        ? ""
        : "未找到签名工具：安装 JDK（提供 keytool），或安装 Android build-tools（提供 apksigner）并加入 PATH。也可安装 openssl 作为证书解析回退。配好后请重启 ADB 桥。",
    },
  };
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
      transportId: meta.transport_id || meta["transport_id"] || "",
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
      size: Number(m[6]),
      date: `${m[7]} ${m[8]}`,
    };
  }
  if (trimmed === "." || trimmed === "..") return null;
  return { name: trimmed, type: "unknown", mode: "", size: 0, date: "" };
}

async function listDir(serial, remotePath) {
  const candidates = await resolveFsListPath(serial, remotePath);
  const errors = [];

  for (const dir of candidates) {
    // Like Android Studio: /data/data without root → virtual package list
    if (dir === "/data/data" || dir === "/data/user/0") {
      try {
        const normal = await tryListDirShell(serial, dir);
        if (normal.entries.length) {
          return { path: dir, entries: normal.entries, access: "shell" };
        }
      } catch (err) {
        errors.push(`${dir} shell: ${err.message || err}`);
      }
      return listDataDataVirtual(serial, dir);
    }

    try {
      const normal = await tryListDirShell(serial, dir);
      return { path: dir, entries: normal.entries, access: "shell" };
    } catch (err) {
      errors.push(`${dir} shell: ${err.message || err}`);
    }

    try {
      const rooted = await tryListDirShell(serial, dir, { su: true });
      return { path: dir, entries: rooted.entries, access: "su", note: "已通过 su 读取（设备已 root）" };
    } catch (err) {
      errors.push(`${dir} su: ${err.message || err}`);
    }

    const pkg = dataDataPackage(dir);
    if (pkg) {
      try {
        const runAs = await tryListDirShell(serial, dir, { runAs: pkg });
        return {
          path: dir,
          entries: runAs.entries,
          access: `run-as:${pkg}`,
          note: `已通过 run-as ${pkg} 读取（仅 debuggable 应用）`,
        };
      } catch (err) {
        errors.push(`${dir} run-as: ${err.message || err}`);
      }
    }
  }

  const shown = candidates[0] || normalizeRemotePath(remotePath);
  const hint =
    String(shown).startsWith("/data/data")
      ? "无 root 时 /data/data 仅能进入 debuggable 应用（run-as）。可先打开 /data/data 查看包名列表。"
      : "该目录受系统权限保护。可尝试内部存储 /storage/emulated/0、/data/local/tmp，或使用已 root 设备 / 模拟器。";
  throw new Error(`无法列出 ${shown}。${hint}\n尝试：${errors.join(" | ")}`);
}

function dataDataPackage(remotePath) {
  const m = String(remotePath || "").match(/^\/data\/(?:data|user\/\d+)\/([^/]+)/);
  return m ? m[1] : "";
}

async function tryListDirShell(serial, dir, { su = false, runAs = "" } = {}) {
  // 末尾加 / 避免部分机型把 /sdcard 当符号链接文件列出
  const listTarget = dir === "/" ? "/" : `${dir}/`;
  let cmd = `ls -la ${shellQuote(listTarget)}`;
  if (runAs) {
    cmd = `run-as ${shellQuote(runAs)} ls -la ${shellQuote(listTarget)}`;
  } else if (su) {
    cmd = `su -c ${shellQuote(`ls -la ${listTarget}`)}`;
  }
  const { stdout, stderr } = await adbSerial(serial, ["shell", cmd], { timeout: 25000 });
  const text = `${stdout || ""}\n${stderr || ""}`;
  if (/Permission denied|Permission Denied/i.test(text) && !/\n[-dl]/m.test(text)) {
    throw new Error("Permission denied");
  }
  if (/No such file|Not a directory/i.test(text) && !/\n[-dl]/m.test(text)) {
    throw new Error(text.trim().split(/\r?\n/)[0] || "No such file");
  }
  if (/run-as:\s*package not debuggable|not debuggable|unknown package/i.test(text)) {
    throw new Error(text.trim().split(/\r?\n/)[0] || "run-as failed");
  }
  if (/su:\s*not found|su: inaccessible|Can't find/i.test(text) && su && !/\n[-dl]/m.test(text)) {
    throw new Error("su unavailable");
  }
  const entries = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || /^total\s+/i.test(line)) continue;
    if (/Permission denied|run-as:|su:/i.test(line) && !/^[-dlcbps]/.test(line.trim())) continue;
    const item = parseLsLine(line);
    if (item) entries.push(item);
  }
  if (!entries.length && /Permission denied/i.test(text)) throw new Error("Permission denied");
  entries.sort((a, b) => {
    if (a.type === "dir" && b.type !== "dir") return -1;
    if (a.type !== "dir" && b.type === "dir") return 1;
    return a.name.localeCompare(b.name);
  });
  return { entries };
}

async function listDataDataVirtual(serial, dir) {
  const { stdout } = await adbSerial(serial, ["shell", "pm", "list", "packages"], { timeout: 60000 });
  const entries = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^package:(.+)$/);
    if (!m) continue;
    entries.push({
      name: m[1].trim(),
      type: "dir",
      mode: "virtual",
      size: 0,
      date: "",
      virtual: true,
    });
  }
  entries.sort((a, b) => a.name.localeCompare(b.name));
  return {
    path: dir,
    entries,
    access: "packages-virtual",
    note: "无 root：按已安装包名虚拟列出。进入后会尝试 run-as（仅 debug 包可读，与 Android Studio Device File Explorer 相同）。",
  };
}

async function probeFsRoots(serial) {
  const candidates = [
    "/",
    "/sdcard",
    "/storage/emulated/0",
    "/data",
    "/data/local/tmp",
    "/data/data",
    "/data/app",
    "/system",
    "/system/app",
    "/product",
    "/vendor",
    "/mnt",
  ];
  const roots = [];
  for (const pathValue of candidates) {
    try {
      const result = await listDir(serial, pathValue);
      roots.push({
        path: pathValue,
        ok: true,
        count: (result.entries || []).length,
        access: result.access || "shell",
        note: result.note || "",
      });
    } catch (err) {
      roots.push({
        path: pathValue,
        ok: false,
        count: 0,
        access: "",
        note: String(err.message || err).split(/\r?\n/)[0],
      });
    }
  }
  return { ok: true, roots };
}

function mimeFromFilename(filename) {
  const n = String(filename || "").toLowerCase();
  if (/\.png$/i.test(n)) return "image/png";
  if (/\.jpe?g$/i.test(n)) return "image/jpeg";
  if (/\.gif$/i.test(n)) return "image/gif";
  if (/\.webp$/i.test(n)) return "image/webp";
  if (/\.bmp$/i.test(n)) return "image/bmp";
  if (/\.svg$/i.test(n)) return "image/svg+xml";
  if (/\.mp4$/i.test(n)) return "video/mp4";
  if (/\.webm$/i.test(n)) return "video/webm";
  if (/\.mkv$/i.test(n)) return "video/x-matroska";
  if (/\.3gp$/i.test(n)) return "video/3gpp";
  if (/\.mp3$/i.test(n)) return "audio/mpeg";
  if (/\.m4a$/i.test(n)) return "audio/mp4";
  if (/\.aac$/i.test(n)) return "audio/aac";
  if (/\.ogg$/i.test(n)) return "audio/ogg";
  if (/\.wav$/i.test(n)) return "audio/wav";
  if (/\.(txt|log|md|csv|tsv|ini|conf|cfg|properties|prop|gradle|smali|java|kt|kts|xml|html?|css|js|mjs|cjs|ts|json|ya?ml|toml|sh|bat|cmd|rc)$/i.test(n)) {
    return "text/plain; charset=utf-8";
  }
  return "application/octet-stream";
}

async function downloadFile(serial, remotePath) {
  const target = normalizeRemotePath(remotePath);
  const local = tempName("dl", basenameRemote(target));
  try {
    await adbSerial(serial, ["pull", target, local], { timeout: 300000 });
  } catch (pullErr) {
    const pkg = dataDataPackage(target);
    let recovered = false;
    if (pkg) {
      try {
        // exec-out keeps binary intact (shell can mangle bytes)
        const { stdout } = await adbSerial(
          serial,
          ["exec-out", "run-as", pkg, "cat", target],
          { timeout: 180000, encoding: "buffer", maxBuffer: 64 * 1024 * 1024 }
        );
        fs.writeFileSync(local, stdout || Buffer.alloc(0));
        recovered = true;
      } catch {
        /* try su */
      }
    }
    if (!recovered) {
      try {
        const tmpRemote = "/data/local/tmp/.adb-bridge-dl";
        await adbSerial(serial, ["shell", `su -c ${shellQuote(`cp ${target} ${tmpRemote}`)}`], {
          timeout: 60000,
        });
        await adbSerial(serial, ["pull", tmpRemote, local], { timeout: 300000 });
        try {
          await adbSerial(serial, ["shell", `rm -f -- ${shellQuote(tmpRemote)}`], { timeout: 10000 });
        } catch {
          /* ignore */
        }
        recovered = true;
      } catch {
        throw pullErr;
      }
    }
  }
  const data = fs.readFileSync(local);
  try {
    fs.unlinkSync(local);
  } catch {
    /* ignore */
  }
  const filename = basenameRemote(target);
  return { filename, data, mime: mimeFromFilename(filename) };
}

async function deletePath(serial, remotePath) {
  const target = normalizeRemotePath(remotePath, { write: true });
  if (
    target === "/" ||
    target === "/sdcard" ||
    target === "/storage/emulated/0" ||
    target === "/data" ||
    target === "/system"
  ) {
    throw new Error("不能删除根目录");
  }
  await adbSerial(serial, ["shell", `rm -rf -- ${shellQuote(target)}`], { timeout: 60000 });
  return { ok: true, path: target };
}

async function mkdirPath(serial, remotePath) {
  const target = normalizeRemotePath(remotePath, { write: true });
  await adbSerial(serial, ["shell", `mkdir -p -- ${shellQuote(target)}`], { timeout: 20000 });
  return { ok: true, path: target };
}

async function movePath(serial, fromPath, toPath) {
  const from = normalizeRemotePath(fromPath, { write: true });
  const to = normalizeRemotePath(toPath, { write: true });
  if (from === "/" || from === "/sdcard" || from === "/data" || from === "/system") {
    throw new Error("不能移动根目录");
  }
  await adbSerial(serial, ["shell", `mv -- ${shellQuote(from)} ${shellQuote(to)}`], { timeout: 60000 });
  return { ok: true, from, to };
}

async function copyPath(serial, fromPath, toPath) {
  const from = normalizeRemotePath(fromPath);
  const to = normalizeRemotePath(toPath, { write: true });
  await adbSerial(serial, ["shell", `cp -a -- ${shellQuote(from)} ${shellQuote(to)}`], {
    timeout: 180000,
  });
  return { ok: true, from, to };
}

async function renamePath(serial, fromPath, newName) {
  const from = normalizeRemotePath(fromPath, { write: true });
  if (from === "/" || from === "/sdcard" || from === "/data" || from === "/system") {
    throw new Error("不能重命名根目录");
  }
  const base = from === "/" ? "/" : from.slice(0, from.lastIndexOf("/")) || "/";
  const name = path.basename(String(newName || "").trim()).replace(/[\\/]/g, "");
  if (!name) throw new Error("新名称无效");
  const to = normalizeRemotePath(base === "/" ? `/${name}` : `${base}/${name}`, { write: true });
  return movePath(serial, from, to);
}

async function uploadFile(serial, dir, filename, buffer, forcePush = false) {
  const safeDir = normalizeRemotePath(dir, { write: true, force: Boolean(forcePush) });
  const safeName = path.basename(String(filename || "upload.bin")).replace(/[\\/]/g, "_");
  if (!safeName) throw new Error("文件名无效");
  const remote = normalizeRemotePath(`${safeDir}/${safeName}`, {
    write: true,
    force: Boolean(forcePush),
  });
  const local = tempName("up", safeName);
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
  return { ok: true, path: remote, size: buffer.length, forcePush: Boolean(forcePush) };
}

function storeUpload(filename, buffer) {
  const id = crypto.randomBytes(6).toString("hex");
  const local = tempName("apk", filename || "app.apk");
  fs.writeFileSync(local, buffer);
  const item = {
    id,
    filename: path.basename(String(filename || "app.apk")),
    path: local,
    size: buffer.length,
    createdAt: Date.now(),
  };
  UPLOADS.set(id, item);
  return item;
}

function parseSerials(input) {
  if (Array.isArray(input)) return input.map(String).map((s) => s.trim()).filter(Boolean);
  return String(input || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

async function listApps(serial, kind = "all") {
  const flag = kind === "system" ? "-s" : kind === "third" ? "-3" : "";
  const args = flag ? ["shell", "pm", "list", "packages", "-f", flag] : ["shell", "pm", "list", "packages", "-f"];
  const { stdout } = await adbSerial(serial, args, { timeout: 60000 });
  const thirdSet = new Set();
  if (kind === "all") {
    try {
      const third = await adbSerial(serial, ["shell", "pm", "list", "packages", "-3"], { timeout: 60000 });
      for (const line of third.stdout.split(/\r?\n/)) {
        const m = line.match(/^package:(.+)$/);
        if (m) thirdSet.add(m[1].trim());
      }
    } catch {
      /* ignore */
    }
  }

  const apps = [];
  for (const line of stdout.split(/\r?\n/)) {
    const m = line.match(/^package:(.+?)=([^=]+)$/);
    if (!m) continue;
    const apkPath = m[1].trim();
    const packageName = m[2].trim();
    let isSystem = kind === "system";
    if (kind === "third") isSystem = false;
    if (kind === "all") isSystem = !thirdSet.has(packageName);
    apps.push({
      packageName,
      label: "",
      apkPath,
      isSystem,
      kind: isSystem ? "system" : "third",
    });
  }
  const labelInfo = await loadAppLabels(serial, apps);
  for (const app of apps) {
    app.label = labelInfo.map.get(app.packageName) || "";
  }
  apps.sort((a, b) => {
    const la = (a.label || a.packageName).toLowerCase();
    const lb = (b.label || b.packageName).toLowerCase();
    return la.localeCompare(lb, "zh");
  });
  return {
    apps,
    labelResolved: apps.filter((a) => a.label).length,
    labelNote: labelInfo.note || "",
    labelSource: labelInfo.source || "",
  };
}

function parseLabelFromBadging(text) {
  const s = String(text || "");
  return (
    (
      s.match(/application-label-zh-CN:'([^']*)'/) ||
      s.match(/application-label-zh:'([^']*)'/) ||
      s.match(/application-label:'([^']*)'/) ||
      s.match(/application:\s*label='([^']*)'/) ||
      []
    )[1] || ""
  ).trim();
}

function parseDumpsysPackageLabels(stdout) {
  const map = new Map();
  let current = "";
  for (const line of String(stdout || "").split(/\r?\n/)) {
    const pkg = line.match(/^\s*Package\s+\[([^\]]+)\]/);
    if (pkg) {
      current = pkg[1].trim();
      continue;
    }
    if (!current) continue;
    const raw =
      (line.match(/applicationLabel=(.+)$/) ||
        line.match(/nonLocalizedLabel=(.+)$/) ||
        line.match(/appLabel=(.+)$/) ||
        line.match(/Application label:\s*(.+)$/i) ||
        line.match(/应用程序标签[：:=]\s*(.+)$/) ||
        [])[1];
    if (!raw) continue;
    let cleaned = String(raw).trim().replace(/^"|"$/g, "");
    if (/^null$/i.test(cleaned) || cleaned === "null") continue;
    // dumpsys often prints "null" after nonLocalizedLabel= when unset
    if (!cleaned || cleaned === "0") continue;
    if (!map.has(current)) map.set(current, cleaned);
  }
  return map;
}

function labelCachePath() {
  return path.join(os.homedir(), ".devtools-adb-bridge", "app-labels-cache.json");
}

function readLabelCache() {
  try {
    const raw = JSON.parse(fs.readFileSync(labelCachePath(), "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

function writeLabelCache(cache) {
  try {
    const dir = path.dirname(labelCachePath());
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(labelCachePath(), JSON.stringify(cache));
  } catch {
    /* ignore */
  }
}

function resolveAaptBin() {
  const aapt2 = resolveTool("aapt2");
  if (whichSync("aapt2") || (aapt2 && aapt2 !== "aapt2" && fs.existsSync(aapt2))) return aapt2;
  const aapt = resolveTool("aapt");
  if (whichSync("aapt") || (aapt && aapt !== "aapt" && fs.existsSync(aapt))) return aapt;
  return "";
}

async function dumpBadgingLabel(localApk) {
  const bin = resolveAaptBin();
  if (!bin) return "";
  try {
    const { stdout, stderr } = await execFileAsync(bin, ["dump", "badging", localApk], {
      timeout: 45000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return parseLabelFromBadging(`${stdout || ""}\n${stderr || ""}`);
  } catch (err) {
    return parseLabelFromBadging(`${err?.stdout || ""}\n${err?.stderr || ""}`);
  }
}

async function mapPool(items, concurrency, worker) {
  const list = Array.from(items);
  let idx = 0;
  const runners = Array.from({ length: Math.max(1, concurrency) }, async () => {
    while (idx < list.length) {
      const cur = list[idx++];
      await worker(cur);
    }
  });
  await Promise.all(runners);
}

async function enrichLabelsWithAapt(serial, apps, map, cache) {
  const bin = resolveAaptBin();
  if (!bin) {
    return {
      enriched: 0,
      note: "本机未找到 aapt/aapt2：应用名可能显示为包名。安装 Android SDK build-tools 并加入 PATH 后重启桥，即可解析中文应用名。",
    };
  }
  const missing = apps.filter((a) => a.apkPath && !map.get(a.packageName));
  // 三方优先（用户最关心），再补系统
  missing.sort((a, b) => Number(a.isSystem) - Number(b.isSystem));
  const budget = missing.slice(0, 100);
  let enriched = 0;
  let failed = 0;
  const started = Date.now();
  const deadlineMs = 75000;
  await mapPool(budget, 3, async (app) => {
    if (Date.now() - started > deadlineMs) return;
    const cacheKey = `${app.packageName}@@${app.apkPath}`;
    const hit = cache[cacheKey];
    if (hit?.label) {
      map.set(app.packageName, hit.label);
      enriched += 1;
      return;
    }
    const local = tempName("label", `${app.packageName.replace(/[^\w.-]+/g, "_")}.apk`);
    try {
      await adbSerial(serial, ["pull", app.apkPath, local], { timeout: 90000 });
      const label = await dumpBadgingLabel(local);
      if (label) {
        map.set(app.packageName, label);
        cache[cacheKey] = { label, at: Date.now() };
        enriched += 1;
      } else {
        failed += 1;
      }
    } catch {
      failed += 1;
    } finally {
      try {
        fs.unlinkSync(local);
      } catch {
        /* ignore */
      }
    }
  });
  writeLabelCache(cache);
  const stillMissing = apps.filter((a) => !map.get(a.packageName)).length;
  let note = `应用名已用 aapt 解析 ${enriched} 个`;
  if (stillMissing) note += `，仍有 ${stillMissing} 个显示包名`;
  if (failed && !enriched) note += "（拉取/解析失败较多，请确认 build-tools 可用）";
  return { enriched, note };
}

async function loadAppLabels(serial, apps = []) {
  const map = new Map();
  const sources = [];
  try {
    const { stdout } = await adbSerial(serial, ["shell", "dumpsys", "package"], {
      timeout: 120000,
      maxBuffer: 64 * 1024 * 1024,
    });
    const fromDump = parseDumpsysPackageLabels(stdout);
    for (const [k, v] of fromDump) map.set(k, v);
    if (fromDump.size) sources.push("dumpsys");
  } catch {
    /* optional */
  }

  // 启动器 Activity 里偶尔有 nonLocalizedLabel（覆盖桌面可见应用）
  try {
    const beforeLauncher = map.size;
    const { stdout } = await adbSerial(
      serial,
      [
        "shell",
        "cmd",
        "package",
        "query-activities",
        "-a",
        "android.intent.action.MAIN",
        "-c",
        "android.intent.category.LAUNCHER",
      ],
      { timeout: 45000, maxBuffer: 20 * 1024 * 1024 }
    );
    let pkg = "";
    for (const line of String(stdout || "").split(/\r?\n/)) {
      const p = line.match(/packageName=(\S+)/);
      if (p) pkg = p[1].trim();
      const lab =
        (line.match(/nonLocalizedLabel=([^\s]+(?:\s+[^\s=]+)*)/) ||
          line.match(/applicationLabel=([^\s]+)/) ||
          [])[1];
      if (pkg && lab && !/^null$/i.test(lab) && !map.has(pkg)) {
        map.set(pkg, lab.trim());
      }
    }
    if (map.size > beforeLauncher) sources.push("launcher");
  } catch {
    /* optional */
  }

  const cache = readLabelCache();
  let usedCache = false;
  for (const app of apps) {
    if (map.has(app.packageName)) continue;
    const hit = cache[`${app.packageName}@@${app.apkPath}`];
    if (hit?.label) {
      map.set(app.packageName, hit.label);
      usedCache = true;
    }
  }
  if (usedCache) sources.push("cache");

  const before = map.size;
  const aaptInfo = await enrichLabelsWithAapt(serial, apps, map, cache);
  if (map.size > before) sources.push("aapt");

  const resolved = map.size;
  let note = aaptInfo.note || "";
  if (!resolved) {
    note =
      aaptInfo.note ||
      "未能解析应用名。请安装 Android SDK build-tools（提供 aapt/aapt2），重启 ADB 桥后再刷新应用列表。";
  }
  return { map, note, source: sources.join("+") || "none" };
}

async function appAction(serial, packageName, action) {
  const pkg = String(packageName || "").trim();
  if (!pkg || !/^[A-Za-z0-9._]+$/.test(pkg)) throw new Error("包名无效");
  if (action === "uninstall") {
    const { stdout, stderr } = await adbSerial(serial, ["uninstall", pkg], { timeout: 120000 });
    const text = `${stdout}\n${stderr}`;
    if (/Failure|Error/i.test(text) && !/Success/i.test(text)) throw new Error(text.trim() || "卸载失败");
    return { ok: true, action, packageName: pkg, output: text.trim() };
  }
  if (action === "disable") {
    const { stdout, stderr } = await adbSerial(
      serial,
      ["shell", "pm", "disable-user", "--user", "0", pkg],
      { timeout: 60000 }
    );
    return { ok: true, action, packageName: pkg, output: `${stdout}\n${stderr}`.trim() };
  }
  if (action === "enable") {
    const { stdout, stderr } = await adbSerial(serial, ["shell", "pm", "enable", pkg], {
      timeout: 60000,
    });
    return { ok: true, action, packageName: pkg, output: `${stdout}\n${stderr}`.trim() };
  }
  if (action === "open" || action === "launch") {
    const { stdout, stderr } = await adbSerial(
      serial,
      ["shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"],
      { timeout: 30000 }
    );
    const text = `${stdout}\n${stderr}`;
    if (/No activities found|Error|Exception/i.test(text) && !/Events injected/i.test(text)) {
      throw new Error(text.trim() || "无法打开应用（可能没有桌面入口）");
    }
    return { ok: true, action: "open", packageName: pkg, output: text.trim() };
  }
  if (action === "force-stop") {
    const { stdout, stderr } = await adbSerial(serial, ["shell", "am", "force-stop", pkg], {
      timeout: 20000,
    });
    return { ok: true, action, packageName: pkg, output: `${stdout}\n${stderr}`.trim() };
  }
  if (action === "clear") {
    const { stdout, stderr } = await adbSerial(serial, ["shell", "pm", "clear", pkg], {
      timeout: 60000,
    });
    const text = `${stdout}\n${stderr}`;
    if (/Failed|Error/i.test(text) && !/Success/i.test(text)) {
      throw new Error(text.trim() || "清数据失败");
    }
    return { ok: true, action, packageName: pkg, output: text.trim() };
  }
  throw new Error("不支持的应用操作");
}

async function appPermission(serial, packageName, action, permission) {
  const pkg = String(packageName || "").trim();
  const perm = String(permission || "").trim();
  if (!pkg || !/^[A-Za-z0-9._]+$/.test(pkg)) throw new Error("包名无效");
  if (!perm || !/^[A-Za-z0-9._]+$/.test(perm)) throw new Error("权限名无效");
  if (action !== "grant" && action !== "revoke") throw new Error("仅支持 grant/revoke");
  const { stdout, stderr } = await adbSerial(serial, ["shell", "pm", action, pkg, perm], {
    timeout: 30000,
  });
  return { ok: true, action, packageName: pkg, permission: perm, output: `${stdout}\n${stderr}`.trim() };
}

function parsePackageDump(text, packageName) {
  const versionName = (text.match(/versionName=([^\s]+)/) || [])[1] || "";
  const versionCode = (text.match(/versionCode=(\d+)/) || [])[1] || "";
  const minSdk = (text.match(/minSdk=(\d+)/) || [])[1] || "";
  const targetSdk = (text.match(/targetSdk=(\d+)/) || [])[1] || "";
  const enabled = !/Package \[.*?\][\s\S]*?enabled=false/i.test(text);
  const permissions = [];
  const granted = [];
  for (const line of text.split(/\r?\n/)) {
    const req = line.match(/^\s*android\.permission\.[A-Z0-9_]+|^\s*[a-zA-Z0-9_.]+\.permission\.[A-Z0-9_]+/);
    if (req) permissions.push(req[0].trim());
    const g = line.match(/^\s*(android\.permission\.[A-Z0-9_]+): granted=true/);
    if (g) granted.push(g[1]);
    const g2 = line.match(/^\s*([a-zA-Z0-9_.]+\.permission\.[A-Z0-9_]+): granted=true/);
    if (g2) granted.push(g2[1]);
  }
  const activities = [];
  const actRe = new RegExp(`${packageName.replace(/\./g, "\\.")}/[^\\s]+`, "g");
  const seen = new Set();
  for (const m of text.matchAll(actRe)) {
    if (!seen.has(m[0])) {
      seen.add(m[0]);
      activities.push(m[0]);
    }
    if (activities.length >= 30) break;
  }
  return {
    packageName,
    versionName,
    versionCode,
    minSdk,
    targetSdk,
    enabled,
    permissions: [...new Set(permissions)].slice(0, 80),
    grantedPermissions: [...new Set(granted)].slice(0, 80),
    activities,
  };
}

async function getPackageInfo(serial, packageName) {
  const pkg = String(packageName || "").trim();
  if (!pkg || !/^[A-Za-z0-9._]+$/.test(pkg)) throw new Error("包名无效");
  const { stdout } = await adbSerial(serial, ["shell", "dumpsys", "package", pkg], {
    timeout: 60000,
    maxBuffer: 30 * 1024 * 1024,
  });
  if (!stdout || /Unable to find package/i.test(stdout)) throw new Error("找不到该包");
  let launchActivity = "";
  try {
    const resolved = await adbSerial(
      serial,
      ["shell", "cmd", "package", "resolve-activity", "--brief", pkg],
      { timeout: 15000 }
    );
    const lines = resolved.stdout
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    launchActivity = lines[lines.length - 1] || "";
  } catch {
    launchActivity = "";
  }
  const parsed = parsePackageDump(stdout, pkg);
  return {
    ok: true,
    ...parsed,
    launchActivity,
    rawPreview: stdout.split(/\r?\n/).slice(0, 120).join("\n"),
  };
}

async function analyzeLocalApk(filePath, filename) {
  const tools = ["aapt", "aapt2"];
  let badging = "";
  let tool = "";
  for (const bin of tools) {
    try {
      const { stdout } = await execFileAsync(bin, ["dump", "badging", filePath], {
        timeout: 30000,
        maxBuffer: 10 * 1024 * 1024,
      });
      badging = stdout || "";
      tool = bin;
      break;
    } catch {
      /* try next */
    }
  }

  const signing = await analyzeApkSigning(filePath);
  const size = fs.statSync(filePath).size;

  if (!badging) {
    return {
      ok: true,
      filename,
      tool: "",
      note:
        "本机未找到 aapt/aapt2，包名/权限可能缺失；签名仍会尽量用 keytool/openssl/apksigner 解析。安装 Android build-tools 后可解析包名/权限。",
      size,
      signing,
      signatures: signing.signers || [],
    };
  }
  const packageName = (badging.match(/package: name='([^']+)'/) || [])[1] || "";
  const versionName = (badging.match(/versionName='([^']+)'/) || [])[1] || "";
  const versionCode = (badging.match(/versionCode='([^']+)'/) || [])[1] || "";
  const minSdk = (badging.match(/sdkVersion:'([^']+)'/) || [])[1] || "";
  const targetSdk = (badging.match(/targetSdkVersion:'([^']+)'/) || [])[1] || "";
  const launchActivity = (badging.match(/launchable-activity: name='([^']+)'/) || [])[1] || "";
  const permissions = [...badging.matchAll(/uses-permission: name='([^']+)'/g)].map((m) => m[1]);
  const label =
    (badging.match(/application-label(?:-zh(?:-CN)?)?:'([^']+)'/) ||
      badging.match(/application-label:'([^']+)'/) ||
      [])[1] || "";
  return {
    ok: true,
    filename,
    tool,
    packageName,
    label,
    versionName,
    versionCode,
    minSdk,
    targetSdk,
    launchActivity: packageName && launchActivity ? `${packageName}/${launchActivity}` : launchActivity,
    permissions: permissions.slice(0, 100),
    size,
    signing,
    signatures: signing.signers || [],
    rawPreview: badging.split(/\r?\n/).slice(0, 80).join("\n"),
  };
}

function normalizeFingerprint(value) {
  return String(value || "")
    .replace(/\s+/g, "")
    .replace(/:/g, "")
    .toUpperCase();
}

function formatFingerprint(value) {
  const hex = normalizeFingerprint(value);
  if (!hex || hex.length % 2) return String(value || "").trim();
  return hex.match(/.{1,2}/g).join(":");
}

function parseDnField(dn, field) {
  const re = new RegExp(`(?:^|,)\\s*${field}\\s*=\\s*([^,]+)`, "i");
  const m = String(dn || "").match(re);
  return m ? m[1].trim() : "";
}

function parseKeytoolCertText(text) {
  const owner =
    (String(text).match(/Owner:\s*(.+)/i) || String(text).match(/所有者:\s*(.+)/) || [])[1]?.trim() || "";
  const issuer =
    (String(text).match(/Issuer:\s*(.+)/i) || String(text).match(/发布者:\s*(.+)/) || [])[1]?.trim() || "";
  const serial =
    (String(text).match(/Serial number:\s*([^\s]+)/i) ||
      String(text).match(/序列号:\s*([^\s]+)/) ||
      [])[1] || "";
  const valid =
    (String(text).match(/Valid from:\s*(.+)/i) || String(text).match(/有效期自:\s*(.+)/) || [])[1]?.trim() ||
    "";
  const sha1Raw =
    (String(text).match(/SHA1:\s*([0-9A-Fa-f:]+)/i) ||
      String(text).match(/SHA-1:\s*([0-9A-Fa-f:]+)/i) ||
      [])[1] || "";
  const sha256Raw =
    (String(text).match(/SHA256:\s*([0-9A-Fa-f:]+)/i) ||
      String(text).match(/SHA-256:\s*([0-9A-Fa-f:]+)/i) ||
      [])[1] || "";
  const md5Raw = (String(text).match(/MD5:\s*([0-9A-Fa-f:]+)/i) || [])[1] || "";
  const sigAlg =
    (String(text).match(/Signature algorithm name:\s*(.+)/i) ||
      String(text).match(/签名算法名称:\s*(.+)/) ||
      [])[1]?.trim() || "";
  const cn = parseDnField(owner, "CN");
  return {
    owner,
    cn,
    issuer,
    serial,
    valid,
    sha1: formatFingerprint(sha1Raw),
    sha256: formatFingerprint(sha256Raw),
    md5: formatFingerprint(md5Raw),
    sigAlg,
  };
}

function parseApksignerCertText(text) {
  const blocks = String(text || "").split(/Signer #\d+/i).slice(1);
  const signers = [];
  const schemes = [];
  if (/Verified using v1 scheme/i.test(text)) schemes.push("v1");
  if (/Verified using v2 scheme/i.test(text)) schemes.push("v2");
  if (/Verified using v3 scheme/i.test(text)) schemes.push("v3");
  if (/Verified using v3\.1 scheme/i.test(text)) schemes.push("v3.1");
  if (/Verified using v4 scheme/i.test(text)) schemes.push("v4");
  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    const dn =
      (block.match(/certificate DN:\s*(.+)/i) || [])[1]?.trim() ||
      (block.match(/Signer certificate DN:\s*(.+)/i) || [])[1]?.trim() ||
      "";
    const sha256 =
      (block.match(/SHA-256 digest:\s*([0-9A-Fa-f:]+)/i) || [])[1] ||
      (block.match(/SHA256 digest:\s*([0-9A-Fa-f:]+)/i) || [])[1] ||
      "";
    const sha1 =
      (block.match(/SHA-1 digest:\s*([0-9A-Fa-f:]+)/i) || [])[1] ||
      (block.match(/SHA1 digest:\s*([0-9A-Fa-f:]+)/i) || [])[1] ||
      "";
    const md5 = (block.match(/MD5 digest:\s*([0-9A-Fa-f:]+)/i) || [])[1] || "";
    signers.push({
      index: i + 1,
      alias: "",
      owner: dn,
      cn: parseDnField(dn, "CN"),
      issuer: "",
      serial: "",
      valid: "",
      sha1: formatFingerprint(sha1),
      sha256: formatFingerprint(sha256),
      md5: formatFingerprint(md5),
      sigAlg: "",
      source: "apksigner",
    });
  }
  return { schemes, signers };
}

async function listApkMetaInfSignerEntries(filePath) {
  try {
    const { stdout } = await execFileAsync("unzip", ["-Z1", filePath], {
      timeout: 20000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return String(stdout || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => /^META-INF\/[^/]+\.(RSA|DSA|EC)$/i.test(s));
  } catch {
    return [];
  }
}

function whichSync(bin) {
  const pathEnv = String(process.env.PATH || "");
  const sep = process.platform === "win32" ? ";" : ":";
  const exts = process.platform === "win32" ? [".exe", ".bat", ".cmd", ""] : [""];
  for (const dir of pathEnv.split(sep)) {
    if (!dir) continue;
    for (const ext of exts) {
      const full = path.join(dir, bin + ext);
      try {
        if (fs.existsSync(full)) return full;
      } catch {
        /* ignore */
      }
    }
  }
  return "";
}

function resolveJavaHomeBin(name) {
  const exe = process.platform === "win32" ? `${name}.exe` : name;
  const homes = [];
  const envHome = process.env.JAVA_HOME || process.env.JDK_HOME || "";
  if (envHome) homes.push(envHome);
  if (process.platform === "darwin") {
    try {
      const { execFileSync } = require("child_process");
      const jh = String(execFileSync("/usr/libexec/java_home", [], { encoding: "utf8", timeout: 3000 })).trim();
      if (jh) homes.push(jh);
    } catch {
      /* ignore */
    }
  }
  for (const home of homes) {
    const cand = path.join(home, "bin", exe);
    if (fs.existsSync(cand)) return cand;
  }
  const brewBins = [
    `/opt/homebrew/opt/openjdk/bin/${name}`,
    `/opt/homebrew/opt/openjdk@21/bin/${name}`,
    `/opt/homebrew/opt/openjdk@17/bin/${name}`,
    `/usr/local/opt/openjdk/bin/${name}`,
    `/usr/local/opt/openjdk@21/bin/${name}`,
    `/usr/local/opt/openjdk@17/bin/${name}`,
  ];
  for (const cand of brewBins) {
    if (fs.existsSync(cand)) return cand;
  }
  for (const root of ["/usr/lib/jvm", "/Library/Java/JavaVirtualMachines"]) {
    try {
      if (!fs.existsSync(root)) continue;
      for (const ent of fs.readdirSync(root)) {
        const cand = path.join(root, ent, "bin", name);
        const candHome = path.join(root, ent, "Contents", "Home", "bin", name);
        if (fs.existsSync(cand)) return cand;
        if (fs.existsSync(candHome)) return candHome;
      }
    } catch {
      /* ignore */
    }
  }
  if (process.platform === "win32") {
    const programFiles = [
      process.env["ProgramFiles"] || "C:\\Program Files",
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
      path.join(os.homedir(), "AppData", "Local", "Programs"),
    ];
    const vendors = ["Java", "Eclipse Adoptium", "Microsoft", "Amazon Corretto", "Zulu", "Semeru", "BellSoft"];
    for (const pf of programFiles) {
      for (const vendor of vendors) {
        const root = path.join(pf, vendor);
        try {
          if (!fs.existsSync(root)) continue;
          const walk = (dir, depth) => {
            if (depth > 3) return "";
            let ents = [];
            try {
              ents = fs.readdirSync(dir);
            } catch {
              return "";
            }
            const direct = path.join(dir, "bin", exe);
            if (fs.existsSync(direct)) return direct;
            for (const ent of ents.sort().reverse()) {
              const hit = walk(path.join(dir, ent), depth + 1);
              if (hit) return hit;
            }
            return "";
          };
          const hit = walk(root, 0);
          if (hit) return hit;
        } catch {
          /* ignore */
        }
      }
    }
  }
  return "";
}

function resolveTool(name) {
  const direct = whichSync(name);
  if (direct) return direct;
  if (name === "keytool" || name === "jarsigner") {
    const fromJava = resolveJavaHomeBin(name);
    if (fromJava) return fromJava;
  }
  if (name === "apksigner") {
    const sdk =
      process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || process.env.ANDROID_SDK || "";
    const roots = [sdk, path.join(os.homedir(), "Library/Android/sdk"), path.join(os.homedir(), "Android/Sdk")].filter(
      Boolean
    );
    for (const root of roots) {
      const bt = path.join(root, "build-tools");
      try {
        if (!fs.existsSync(bt)) continue;
        const versions = fs.readdirSync(bt).sort().reverse();
        for (const ver of versions) {
          const cand = path.join(bt, ver, process.platform === "win32" ? "apksigner.bat" : "apksigner");
          if (fs.existsSync(cand)) return cand;
        }
      } catch {
        /* ignore */
      }
    }
  }
  return name; // fall back to PATH resolution by execFile
}

function parseOpensslCertText(text) {
  const subject = (String(text).match(/subject\s*=\s*(.+)/i) || [])[1]?.trim() || "";
  const issuer = (String(text).match(/issuer\s*=\s*(.+)/i) || [])[1]?.trim() || "";
  const sha1 = (String(text).match(/sha1\s+Fingerprint\s*=\s*([0-9A-Fa-f:]+)/i) || [])[1] || "";
  const sha256 = (String(text).match(/sha256\s+Fingerprint\s*=\s*([0-9A-Fa-f:]+)/i) || [])[1] || "";
  const notBefore = (String(text).match(/notBefore\s*=\s*(.+)/i) || [])[1]?.trim() || "";
  const notAfter = (String(text).match(/notAfter\s*=\s*(.+)/i) || [])[1]?.trim() || "";
  const owner = subject.replace(/,\s*/g, ", ");
  return {
    owner,
    cn: parseDnField(owner, "CN") || parseDnField(subject.replace(/\s*=\s*/g, "="), "CN"),
    issuer: issuer.replace(/,\s*/g, ", "),
    serial: "",
    valid: [notBefore, notAfter].filter(Boolean).join(" → "),
    sha1: formatFingerprint(sha1),
    sha256: formatFingerprint(sha256),
    md5: "",
    sigAlg: "",
  };
}

async function analyzeCertWithOpenssl(certPath) {
  const openssl = resolveTool("openssl");
  const { stdout: pem } = await execFileAsync(
    openssl,
    ["pkcs7", "-inform", "DER", "-in", certPath, "-print_certs"],
    { timeout: 20000, maxBuffer: 2 * 1024 * 1024 }
  );
  const tmpPem = `${certPath}.pem`;
  fs.writeFileSync(tmpPem, pem || "");
  try {
    const { stdout } = await execFileAsync(
      openssl,
      ["x509", "-in", tmpPem, "-noout", "-subject", "-issuer", "-dates", "-fingerprint", "-sha1", "-fingerprint", "-sha256"],
      { timeout: 20000, maxBuffer: 2 * 1024 * 1024 }
    );
    return parseOpensslCertText(stdout || "");
  } finally {
    try {
      fs.unlinkSync(tmpPem);
    } catch {
      /* ignore */
    }
  }
}

async function analyzeApkSigning(filePath) {
  const result = {
    ok: true,
    tool: "",
    schemes: [],
    signers: [],
    note: "",
    toolsFound: {},
  };

  const apksigner = resolveTool("apksigner");
  const keytool = resolveTool("keytool");
  const openssl = resolveTool("openssl");
  result.toolsFound = {
    apksigner: Boolean(whichSync("apksigner") || (apksigner && apksigner !== "apksigner" && fs.existsSync(apksigner))),
    keytool: Boolean(whichSync("keytool") || (keytool && keytool !== "keytool" && fs.existsSync(keytool))),
    openssl: Boolean(whichSync("openssl") || (openssl && openssl !== "openssl" && fs.existsSync(openssl))),
  };
  // also mark true if bare name works via PATH in this environment
  for (const [name, bin] of [
    ["apksigner", apksigner],
    ["keytool", keytool],
    ["openssl", openssl],
  ]) {
    if (result.toolsFound[name]) continue;
    try {
      await execFileAsync(bin, name === "openssl" ? ["version"] : ["-help"], { timeout: 5000 });
      result.toolsFound[name] = true;
    } catch (err) {
      // keytool -help exits 0 usually; apksigner may exit non-zero but still exists
      if (err && (err.stdout || err.stderr) && /Usage|Key and Certificate|apk file/i.test(`${err.stdout}${err.stderr}`)) {
        result.toolsFound[name] = true;
      }
    }
  }

  // Prefer apksigner (v1–v4)
  try {
    const { stdout, stderr } = await execFileAsync(apksigner, ["verify", "--print-certs", filePath], {
      timeout: 45000,
      maxBuffer: 4 * 1024 * 1024,
    });
    const parsed = parseApksignerCertText(`${stdout || ""}\n${stderr || ""}`);
    if (parsed.signers.length) {
      result.tool = "apksigner";
      result.schemes = parsed.schemes;
      result.signers = parsed.signers;
      result.toolsFound.apksigner = true;
    }
  } catch {
    /* optional */
  }

  // keytool -jarfile (v1 / jarsigner)
  if (!result.signers.length) {
    try {
      const { stdout } = await execFileAsync(keytool, ["-printcert", "-jarfile", filePath], {
        timeout: 45000,
        maxBuffer: 4 * 1024 * 1024,
      });
      const parsed = parseKeytoolCertText(stdout || "");
      if (parsed.owner || parsed.sha1 || parsed.sha256) {
        result.tool = "keytool";
        result.toolsFound.keytool = true;
        result.schemes = result.schemes.length ? result.schemes : ["v1"];
        result.signers = [
          {
            index: 1,
            alias: "",
            ...parsed,
            source: "keytool",
          },
        ];
      }
    } catch {
      /* optional */
    }
  }

  // Enrich / fallback via META-INF/*.RSA (alias often equals entry basename)
  const entries = await listApkMetaInfSignerEntries(filePath);
  if (entries.length) {
    const aliases = entries.map((e) => path.basename(e).replace(/\.(RSA|DSA|EC)$/i, ""));
    if (!result.signers.length) {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "adb-apk-cert-"));
      try {
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i];
          const alias = aliases[i];
          const certPath = path.join(tmpDir, path.basename(entry));
          let parsed = null;
          try {
            await execFileAsync("unzip", ["-o", "-j", "-d", tmpDir, filePath, entry], {
              timeout: 20000,
              maxBuffer: 4 * 1024 * 1024,
            });
            try {
              const { stdout } = await execFileAsync(keytool, ["-printcert", "-file", certPath], {
                timeout: 20000,
                maxBuffer: 2 * 1024 * 1024,
              });
              parsed = parseKeytoolCertText(stdout || "");
              result.toolsFound.keytool = true;
            } catch {
              parsed = await analyzeCertWithOpenssl(certPath);
              result.toolsFound.openssl = true;
            }
          } catch {
            parsed = null;
          }
          result.signers.push({
            index: i + 1,
            alias: alias && alias.toUpperCase() !== "CERT" ? alias : "",
            v1Entry: alias,
            owner: parsed?.owner || "",
            cn: parsed?.cn || "",
            issuer: parsed?.issuer || "",
            serial: parsed?.serial || "",
            valid: parsed?.valid || "",
            sha1: parsed?.sha1 || "",
            sha256: parsed?.sha256 || "",
            md5: parsed?.md5 || "",
            sigAlg: parsed?.sigAlg || "",
            source: parsed ? "meta-inf" : "meta-inf-empty",
          });
        }
        if (result.signers.some((s) => s.sha1 || s.sha256 || s.owner)) {
          result.tool = result.tool || (result.toolsFound.keytool ? "meta-inf+keytool" : "meta-inf+openssl");
          if (!result.schemes.length) result.schemes = ["v1"];
        } else {
          result.signers = [];
        }
      } finally {
        try {
          fs.rmSync(tmpDir, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
    } else {
      for (let i = 0; i < result.signers.length; i++) {
        const alias = aliases[i] || aliases[0] || "";
        if (!result.signers[i].alias && alias && alias.toUpperCase() !== "CERT") {
          result.signers[i].alias = alias;
        }
        if (alias) result.signers[i].v1Entry = alias;
      }
    }
  }

  if (!result.signers.length) {
    result.ok = false;
    const found = Object.entries(result.toolsFound)
      .filter(([, v]) => v)
      .map(([k]) => k);
    result.note = found.length
      ? `未能解析签名（已检测到 ${found.join("/")}）。该 APK 可能只有 v2/v3 签名且无 v1 块，请安装 Android build-tools 中的 apksigner。`
      : "未能解析签名：本机未找到 keytool / openssl / apksigner。请安装 JDK，或把 Android SDK build-tools 加入 PATH。";
  } else {
    result.note =
      "别名优先取自 META-INF 签名块文件名（jarsigner 别名）；Android 常见为 CERT。证书主体见 CN/Owner。";
  }
  return result;
}

async function getProxy(serial) {
  const httpProxy = await shellCapture(serial, "settings get global http_proxy", 8000);
  const host = await shellCapture(serial, "settings get global global_http_proxy_host", 8000);
  const port = await shellCapture(serial, "settings get global global_http_proxy_port", 8000);
  return {
    ok: true,
    httpProxy: httpProxy === "null" ? "" : httpProxy,
    host: host === "null" ? "" : host,
    port: port === "null" ? "" : port,
  };
}

async function setProxy(serial, host, port) {
  const h = String(host || "").trim();
  const p = String(port || "").trim();
  if (!h || !p) throw new Error("请填写代理 host 与 port");
  if (!/^\d+$/.test(p)) throw new Error("端口无效");
  await adbSerial(serial, ["shell", "settings", "put", "global", "http_proxy", `${h}:${p}`], {
    timeout: 10000,
  });
  return { ok: true, ...(await getProxy(serial)), message: `已设置代理 ${h}:${p}` };
}

async function clearProxy(serial) {
  await adbSerial(serial, ["shell", "settings", "put", "global", "http_proxy", ":0"], {
    timeout: 10000,
  });
  try {
    await adbSerial(serial, ["shell", "settings", "delete", "global", "global_http_proxy_host"], {
      timeout: 8000,
    });
    await adbSerial(serial, ["shell", "settings", "delete", "global", "global_http_proxy_port"], {
      timeout: 8000,
    });
  } catch {
    /* ignore */
  }
  return { ok: true, ...(await getProxy(serial)), message: "已清除代理" };
}

async function listForwards(serial) {
  const { stdout } = await adb(["forward", "--list"], { timeout: 10000 });
  const forwards = [];
  const reverses = [];
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 3) {
      if (!serial || parts[0] === serial) {
        forwards.push({ serial: parts[0], local: parts[1], remote: parts[2] });
      }
    }
  }
  try {
    const rev = await adb(["reverse", "--list"], { timeout: 10000 });
    for (const line of rev.stdout.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      // reverse --list format varies; often "UsbFfs tcp:xxx tcp:yyy" or with serial
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2) {
        reverses.push({ raw: trimmed, parts });
      }
    }
  } catch {
    /* reverse list may fail on some adb */
  }
  if (serial) {
    try {
      const revSerial = await adbSerial(serial, ["reverse", "--list"], { timeout: 10000 });
      for (const line of revSerial.stdout.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2) {
          reverses.push({ serial, local: parts[0], remote: parts[1], raw: trimmed });
        }
      }
    } catch {
      /* ignore */
    }
  }
  return { ok: true, forwards, reverses };
}

async function addForward(serial, local, remote, direction = "forward") {
  const loc = String(local || "").trim();
  const rem = String(remote || "").trim();
  if (!loc || !rem) throw new Error("请填写 local 与 remote，例如 tcp:8080");
  const cmd = direction === "reverse" ? "reverse" : "forward";
  await adbSerial(serial, [cmd, loc, rem], { timeout: 15000 });
  return { ok: true, ...(await listForwards(serial)), message: `已添加 ${cmd} ${loc} -> ${rem}` };
}

async function removeForward(serial, local, direction = "forward", removeAll = false) {
  const cmd = direction === "reverse" ? "reverse" : "forward";
  if (removeAll) {
    await adbSerial(serial, [cmd, "--remove-all"], { timeout: 15000 });
    return { ok: true, ...(await listForwards(serial)), message: `已清除全部 ${cmd}` };
  }
  const loc = String(local || "").trim();
  if (!loc) throw new Error("请填写要移除的 local 端口，例如 tcp:8080");
  await adbSerial(serial, [cmd, "--remove", loc], { timeout: 15000 });
  return { ok: true, ...(await listForwards(serial)), message: `已移除 ${cmd} ${loc}` };
}

async function getDeveloperOptions(serial) {
  const read = async (ns, key) => shellCapture(serial, `settings get ${ns} ${key}`, 8000);
  const readProp = async (key) => shellCapture(serial, `getprop ${key}`, 8000);
  const asBool = (v) => v === "1" || v === "true";

  const showTouches = await read("system", "show_touches");
  const pointerLocation = await read("system", "pointer_location");
  const windowAnim = await read("global", "window_animation_scale");
  const transitionAnim = await read("global", "transition_animation_scale");
  const animatorAnim = await read("global", "animator_duration_scale");
  const layout = await readProp("debug.layout");
  const stayOn = await read("global", "stay_on_while_plugged_in");

  // Best-effort extras — empty/fail ignored per key
  const forceRtl =
    (await read("global", "debug.force_rtl")) || (await readProp("debug.force_rtl"));
  const dontKeep = await read("global", "always_finish_activities");
  const forceGpu = await read("global", "force_gpu_rendering");
  const hardwareUi =
    (await read("global", "debug.hwui.profile")) || (await readProp("debug.hwui.profile"));
  const usbNotify =
    (await read("global", "adb_notify")) ||
    (await read("secure", "adb_notify")) ||
    (await read("global", "adb_wifi_enabled"));
  const gpuOverdraw =
    (await readProp("debug.hwui.overdraw")) || (await read("global", "debug.hwui.overdraw"));
  const strictMode = await read("global", "strict_mode");
  const showAnrs = await read("secure", "anr_show_background");

  return {
    ok: true,
    stay_on: stayOn === "null" ? "0" : stayOn || "0",
    stayOnWhilePluggedIn: stayOn === "null" ? "0" : stayOn || "0",
    show_touches: asBool(showTouches),
    showTouches: asBool(showTouches),
    pointer_location: asBool(pointerLocation),
    pointerLocation: asBool(pointerLocation),
    show_layout: asBool(layout) || layout === "true",
    layoutBounds: asBool(layout) || layout === "true",
    force_rtl: asBool(forceRtl),
    dont_keep_activities: asBool(dontKeep),
    force_gpu: asBool(forceGpu),
    hardware_ui: Boolean(hardwareUi && hardwareUi !== "null" && hardwareUi !== "false" && hardwareUi !== "0"),
    usb_debugging_notify: asBool(usbNotify),
    gpu_overdraw: Boolean(
      gpuOverdraw &&
        gpuOverdraw !== "null" &&
        gpuOverdraw !== "false" &&
        gpuOverdraw !== "0" &&
        gpuOverdraw !== ""
    ),
    strict_mode: asBool(strictMode),
    show_all_anrs: asBool(showAnrs),
    windowAnimationScale: windowAnim === "null" ? "1.0" : windowAnim || "1.0",
    transitionAnimationScale: transitionAnim === "null" ? "1.0" : transitionAnim || "1.0",
    animatorDurationScale: animatorAnim === "null" ? "1.0" : animatorAnim || "1.0",
    raw: {
      showTouches,
      pointerLocation,
      layout,
      windowAnim,
      transitionAnim,
      animatorAnim,
      stayOn,
      forceRtl,
      dontKeep,
      forceGpu,
      hardwareUi,
      usbNotify,
      gpuOverdraw,
      strictMode,
      showAnrs,
    },
  };
}

async function setDeveloperOption(serial, key, value) {
  const k = String(key || "").trim();
  async function put(ns, name, val) {
    await adbSerial(serial, ["shell", "settings", "put", ns, name, String(val)], { timeout: 10000 });
  }
  async function tryPut(ns, name, val) {
    try {
      await put(ns, name, val);
      return true;
    } catch {
      return false;
    }
  }
  async function tryProp(name, val) {
    try {
      await adbSerial(serial, ["shell", "setprop", name, String(val)], { timeout: 10000 });
      return true;
    } catch {
      return false;
    }
  }

  if (k === "show_touches") {
    await put("system", "show_touches", value ? "1" : "0");
  } else if (k === "pointer_location") {
    await put("system", "pointer_location", value ? "1" : "0");
  } else if (k === "layout_bounds" || k === "show_layout") {
    await adbSerial(serial, ["shell", "setprop", "debug.layout", value ? "true" : "false"], {
      timeout: 10000,
    });
    try {
      await adbSerial(serial, ["shell", "service", "call", "activity", "1599295570"], {
        timeout: 10000,
      });
    } catch {
      /* ignore refresh failure */
    }
  } else if (k === "stay_on" || k === "stay_on_while_plugged_in") {
    const v = value === true || value === "on" ? "7" : value === false || value === "off" ? "0" : String(value);
    await put("global", "stay_on_while_plugged_in", v);
  } else if (k === "force_rtl") {
    await tryPut("global", "debug.force_rtl", value ? "1" : "0");
    await tryProp("debug.force_rtl", value ? "1" : "0");
  } else if (k === "dont_keep_activities") {
    await tryPut("global", "always_finish_activities", value ? "1" : "0");
  } else if (k === "force_gpu") {
    await tryPut("global", "force_gpu_rendering", value ? "1" : "0");
  } else if (k === "hardware_ui") {
    await tryPut("global", "debug.hwui.profile", value ? "visual_bars" : "false");
    await tryProp("debug.hwui.profile", value ? "visual_bars" : "false");
  } else if (k === "usb_debugging_notify") {
    await tryPut("global", "adb_notify", value ? "1" : "0");
    await tryPut("secure", "adb_notify", value ? "1" : "0");
  } else if (k === "gpu_overdraw") {
    await tryProp("debug.hwui.overdraw", value ? "show" : "false");
    await tryPut("global", "debug.hwui.overdraw", value ? "show" : "false");
  } else if (k === "strict_mode") {
    await tryPut("global", "strict_mode", value ? "1" : "0");
  } else if (k === "show_all_anrs") {
    await tryPut("secure", "anr_show_background", value ? "1" : "0");
  } else if (k === "window_animation_scale") {
    await put("global", "window_animation_scale", value);
  } else if (k === "transition_animation_scale") {
    await put("global", "transition_animation_scale", value);
  } else if (k === "animator_duration_scale") {
    await put("global", "animator_duration_scale", value);
  } else if (k === "animation_scale_all") {
    const scale = String(value ?? "1");
    await put("global", "window_animation_scale", scale);
    await put("global", "transition_animation_scale", scale);
    await put("global", "animator_duration_scale", scale);
  } else {
    throw new Error("不支持的开发者选项");
  }
  return { ok: true, ...(await getDeveloperOptions(serial)), message: `已更新 ${k}` };
}

async function dumpLogcat(serial, opts = {}) {
  const lines = Math.max(20, Math.min(5000, Number(opts.lines) || 500));
  const query = String(opts.query || "").trim();
  const packageName = String(opts.packageName || "").trim();
  const tag = String(opts.tag || "").trim();
  const since = String(opts.since || "").trim();
  const args = ["logcat", "-d", "-v", "time", "-t", String(lines)];
  if (packageName) {
    try {
      const { stdout } = await adbSerial(serial, ["shell", "pidof", "-s", packageName], {
        timeout: 8000,
      });
      const pid = stdout.trim().split(/\s+/)[0];
      if (pid && /^\d+$/.test(pid)) args.push("--pid", pid);
    } catch {
      /* ignore pid filter */
    }
  }
  // Safe tag filter syntax: TagName:V *:S (alphanumeric / . _ $ / - only)
  let usedTagFilter = false;
  if (tag && /^[A-Za-z0-9._$/-]+$/.test(tag) && tag.length <= 128) {
    args.push(`${tag}:V`, "*:S");
    usedTagFilter = true;
  }
  const { stdout } = await adbSerial(serial, args, { timeout: 60000, maxBuffer: 30 * 1024 * 1024 });
  let text = stdout || "";
  if (tag && !usedTagFilter) {
    const t = tag.toLowerCase();
    text = text
      .split(/\r?\n/)
      .filter((line) => {
        const lower = line.toLowerCase();
        if (lower.includes(`${t}:`)) return true;
        // time format columns: date time pid tid level tag:
        const m = line.match(/\s([VDIWEF])\s+([^\s:]+):/);
        if (m && m[2].toLowerCase() === t) return true;
        return false;
      })
      .join("\n");
  }
  if (query) {
    const q = query.toLowerCase();
    text = text
      .split(/\r?\n/)
      .filter((line) => line.toLowerCase().includes(q))
      .join("\n");
  }
  if (since) {
    // Best-effort: keep lines whose leading timestamp string is >= since (lexical if same format)
    text = text
      .split(/\r?\n/)
      .filter((line) => {
        const m = line.match(/^(\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+)/);
        if (!m) return true;
        return m[1] >= since;
      })
      .join("\n");
  }
  return {
    ok: true,
    text,
    lines: text ? text.split(/\r?\n/).filter(Boolean).length : 0,
    note:
      "流式 /logcat/stream 暂未提供；请轮询本接口，可用 tag、query、package、since 组合过滤。",
  };
}

async function clearLogcat(serial) {
  await adbSerial(serial, ["logcat", "-c"], { timeout: 15000 });
  return { ok: true };
}

function encodeAdbInputText(text) {
  // `input text` uses %s for spaces; many special chars break — strip risky ones.
  return String(text ?? "")
    .replace(/ /g, "%s")
    .replace(/['"\\<>|;`$]/g, "")
    .slice(0, 2000);
}

const KEYCODE_MAP = {
  BACK: "4",
  HOME: "3",
  RECENTS: "187",
  ENTER: "66",
  DEL: "67",
  TAB: "61",
  POWER: "26",
  VOLUME_UP: "24",
  VOLUME_DOWN: "25",
  MENU: "82",
  APP_SWITCH: "187",
};

async function runInput(serial, body = {}) {
  const action = String(body.action || "").trim();
  if (action === "tap") {
    const x = Number(body.x);
    const y = Number(body.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error("坐标无效");
    await adbSerial(serial, ["shell", "input", "tap", String(Math.round(x)), String(Math.round(y))], {
      timeout: 15000,
    });
    return { ok: true, action };
  }
  if (action === "swipe") {
    const x1 = Number(body.x1);
    const y1 = Number(body.y1);
    const x2 = Number(body.x2);
    const y2 = Number(body.y2);
    const duration = Math.max(50, Math.min(5000, Number(body.duration) || 300));
    if (![x1, y1, x2, y2].every(Number.isFinite)) throw new Error("滑动坐标无效");
    await adbSerial(
      serial,
      [
        "shell",
        "input",
        "swipe",
        String(Math.round(x1)),
        String(Math.round(y1)),
        String(Math.round(x2)),
        String(Math.round(y2)),
        String(duration),
      ],
      { timeout: 20000 }
    );
    return { ok: true, action };
  }
  if (action === "key") {
    const raw = String(body.key || body.keycode || "").trim().toUpperCase();
    const code = KEYCODE_MAP[raw] || (/^\d+$/.test(raw) ? raw : "");
    if (!code) throw new Error("按键无效");
    await adbSerial(serial, ["shell", "input", "keyevent", code], { timeout: 15000 });
    return { ok: true, action, key: raw, keycode: code };
  }
  if (action === "text") {
    const encoded = encodeAdbInputText(body.text);
    if (!encoded) throw new Error("文本为空或无可输入字符");
    await adbSerial(serial, ["shell", "input", "text", encoded], { timeout: 30000 });
    return { ok: true, action, note: "已输入到当前焦点；空格已转义，部分符号会被忽略" };
  }
  throw new Error("不支持的输入操作");
}

async function pushClipboard(serial, text) {
  const value = String(text ?? "");
  if (!value) throw new Error("剪贴板内容为空");
  const errors = [];

  // Try broadcast helpers / OEM clipper receivers first.
  try {
    const { stdout, stderr } = await adbSerial(
      serial,
      [
        "shell",
        "am",
        "broadcast",
        "-a",
        "clipper.set",
        "-e",
        "text",
        value.slice(0, 4000),
      ],
      { timeout: 15000 }
    );
    const out = `${stdout}\n${stderr}`;
    if (!/Error|Exception|not found/i.test(out)) {
      return { ok: true, method: "clipper.broadcast", output: out.trim() };
    }
    errors.push(out.trim());
  } catch (err) {
    errors.push(err.message || String(err));
  }

  // service call clipboard (works on some Android versions; length-limited)
  try {
    const clipped = value.slice(0, 180);
    const { stdout, stderr } = await adbSerial(
      serial,
      ["shell", `service call clipboard 2 i32 1 i32 1 s16 ${shellQuote(clipped)}`],
      { timeout: 15000 }
    );
    return {
      ok: true,
      method: "service.call",
      truncated: value.length > 180,
      output: `${stdout}\n${stderr}`.trim(),
      note: value.length > 180 ? "内容已截断到约 180 字符" : "",
    };
  } catch (err) {
    errors.push(err.message || String(err));
  }

  throw new Error(
    `剪贴板推送失败（机型/系统限制）。可改用「输入文本」到当前焦点。${errors[0] ? `详情：${errors[0]}` : ""}`
  );
}

async function shellCapture(serial, command, timeout = 15000) {
  try {
    const { stdout, stderr } = await adbSerial(serial, ["shell", command], { timeout });
    return `${stdout || ""}${stderr || ""}`.trim();
  } catch (err) {
    return "";
  }
}

async function deviceSnapshot(serial) {
  const info = await deviceInfo(serial);
  const [
    foreground,
    meminfo,
    top,
    df,
    uptime,
    stayOn,
  ] = await Promise.all([
    shellCapture(
      serial,
      "dumpsys activity activities | grep -E 'mResumedActivity|topResumedActivity' | head -n 5",
      20000
    ),
    shellCapture(serial, "dumpsys meminfo -s | head -n 20", 20000),
    shellCapture(serial, "top -n 1 -m 8 -q", 20000),
    shellCapture(serial, "df -h /data /sdcard 2>/dev/null | head -n 10", 15000),
    shellCapture(serial, "uptime", 8000),
    shellCapture(serial, "settings get global stay_on_while_plugged_in", 8000),
  ]);

  return {
    ok: true,
    info,
    foreground: foreground || "—",
    meminfo: meminfo || "—",
    top: top || "—",
    disk: df || "—",
    uptime: uptime || "—",
    stayOnWhilePluggedIn: stayOn || "—",
  };
}

async function deviceControl(serial, action) {
  const act = String(action || "").trim();
  const results = [];

  async function run(label, args) {
    try {
      const { stdout, stderr } = await adbSerial(serial, args, { timeout: 20000 });
      results.push({ label, ok: true, output: `${stdout}\n${stderr}`.trim() });
    } catch (err) {
      results.push({ label, ok: false, output: err.message || String(err) });
    }
  }

  if (act === "stay_awake_on") {
    await run("stay_on_while_plugged_in=7", [
      "shell",
      "settings",
      "put",
      "global",
      "stay_on_while_plugged_in",
      "7",
    ]);
    await run("svc power stayon true", ["shell", "svc", "power", "stayon", "true"]);
    return { ok: true, action: act, results, message: "已尝试开启充电时屏幕常亮" };
  }
  if (act === "stay_awake_off") {
    await run("stay_on_while_plugged_in=0", [
      "shell",
      "settings",
      "put",
      "global",
      "stay_on_while_plugged_in",
      "0",
    ]);
    await run("svc power stayon false", ["shell", "svc", "power", "stayon", "false"]);
    return { ok: true, action: act, results, message: "已尝试关闭屏幕常亮" };
  }
  if (act === "open_developer") {
    await run("development_settings_enabled=1", [
      "shell",
      "settings",
      "put",
      "global",
      "development_settings_enabled",
      "1",
    ]);
    await run("open developer settings", [
      "shell",
      "am",
      "start",
      "-a",
      "android.settings.APPLICATION_DEVELOPMENT_SETTINGS",
    ]);
    return { ok: true, action: act, results, message: "已打开开发者选项" };
  }
  if (act === "open_logging") {
    // Open developer options where OEM logging switches usually live.
    await run("open developer settings", [
      "shell",
      "am",
      "start",
      "-a",
      "android.settings.APPLICATION_DEVELOPMENT_SETTINGS",
    ]);
    // Best-effort: some OEMs expose logging toggles via these keys.
    await run("enable debug.app-info", [
      "shell",
      "settings",
      "put",
      "global",
      "debug_app",
      "null",
    ]);
    return {
      ok: true,
      action: act,
      results,
      message: "已打开开发者选项，请在手机上开启「日志/USB 调试日志」等相关开关",
    };
  }
  if (act === "open_install_unknown") {
    await run("open manage unknown app sources", [
      "shell",
      "am",
      "start",
      "-a",
      "android.settings.MANAGE_UNKNOWN_APP_SOURCES",
    ]);
    await run("open security settings fallback", [
      "shell",
      "am",
      "start",
      "-a",
      "android.settings.SECURITY_SETTINGS",
    ]);
    return {
      ok: true,
      action: act,
      results,
      message: "已打开安装未知应用/安全设置页",
    };
  }
  if (act === "enable_usb_install") {
    // Common OEM / vendor toggle (e.g. some Chinese ROM USB install switches)
    await run("adb_install_enabled system=1", [
      "shell",
      "settings",
      "put",
      "system",
      "adb_install_enabled",
      "1",
    ]);
    await run("adb_install_enabled global=1", [
      "shell",
      "settings",
      "put",
      "global",
      "adb_install_enabled",
      "1",
    ]);
    await run("adb_install_enabled secure=1", [
      "shell",
      "settings",
      "put",
      "secure",
      "adb_install_enabled",
      "1",
    ]);
    await run("install_non_market_apps global", [
      "shell",
      "settings",
      "put",
      "global",
      "install_non_market_apps",
      "1",
    ]);
    await run("install_non_market_apps secure", [
      "shell",
      "settings",
      "put",
      "secure",
      "install_non_market_apps",
      "1",
    ]);
    await run("verifier_verify_adb_installs=0", [
      "shell",
      "settings",
      "put",
      "global",
      "verifier_verify_adb_installs",
      "0",
    ]);
    await run("package_verifier_enable=0", [
      "shell",
      "settings",
      "put",
      "global",
      "package_verifier_enable",
      "0",
    ]);
    // Xiaomi / OEM style best-effort props
    await run("persist.security.adbinput=1", ["shell", "setprop", "persist.security.adbinput", "1"]);
    await run("open developer settings", [
      "shell",
      "am",
      "start",
      "-a",
      "android.settings.APPLICATION_DEVELOPMENT_SETTINGS",
    ]);
    return {
      ok: true,
      action: act,
      results,
      message:
        "已尝试开启 USB 安装（含 settings put system adb_install_enabled 1）并打开开发者选项。部分品牌仍需在手机上再确认一次。",
    };
  }
  throw new Error("不支持的设备控制操作");
}

async function backupApp(serial, packageName) {
  const pkg = String(packageName || "").trim();
  if (!pkg) throw new Error("包名无效");
  const { stdout } = await adbSerial(serial, ["shell", "pm", "path", pkg], { timeout: 30000 });
  const m = stdout.match(/package:(.+)/);
  if (!m) throw new Error("找不到应用 APK 路径");
  const remote = m[1].trim();
  const local = tempName("backup", `${pkg}.apk`);
  await adbSerial(serial, ["pull", remote, local], { timeout: 300000 });
  const data = fs.readFileSync(local);
  try {
    fs.unlinkSync(local);
  } catch {
    /* ignore */
  }
  return { filename: `${pkg}.apk`, data, remote };
}

async function resolvePackageApkPath(serial, packageName) {
  const pkg = String(packageName || "").trim();
  if (!pkg || !/^[A-Za-z0-9._]+$/.test(pkg)) throw new Error("包名无效");
  let stdout = "";
  try {
    ({ stdout } = await adbSerial(serial, ["shell", "pm", "path", pkg], { timeout: 30000 }));
  } catch {
    try {
      ({ stdout } = await adbSerial(serial, ["shell", "cmd", "package", "path", pkg], {
        timeout: 30000,
      }));
    } catch (err) {
      throw new Error(err.message || "无法查询包路径");
    }
  }
  const m = String(stdout || "").match(/package:(.+)/);
  return m ? m[1].trim() : "";
}

/**
 * Push an uploaded APK onto the device for system/tmp deploy.
 * - If packageName resolves to a path under SYSTEM_APP_ROOTS, overwrite that path.
 * - Else use remoteDir/<name> or /data/local/tmp/<pkg|file>.apk
 * Uses force write for system paths (equivalent to forcePush).
 */
async function pushSystemApk(serial, uploadId, packageName, remoteDir) {
  const upload = UPLOADS.get(uploadId);
  if (!upload) throw new Error("找不到已上传的 APK，请先上传");
  if (!serial) throw new Error("缺少设备 serial");

  const pkg = String(packageName || "").trim();
  let remotePath = "";
  let replaced = false;

  if (pkg) {
    try {
      const existing = await resolvePackageApkPath(serial, pkg);
      if (existing && isUnderRoots(existing.replace(/\\/g, "/"), SYSTEM_APP_ROOTS)) {
        remotePath = normalizeRemotePath(existing, { write: true, force: true });
        replaced = true;
      }
    } catch {
      /* package may not be installed yet */
    }
  }

  if (!remotePath) {
    const dir = String(remoteDir || "").trim();
    const fileName = pkg ? `${pkg}.apk` : path.basename(upload.filename || "app.apk");
    if (dir) {
      const safeDir = normalizeRemotePath(dir, { write: true, force: true });
      remotePath = normalizeRemotePath(`${safeDir}/${fileName}`, { write: true, force: true });
    } else {
      remotePath = normalizeRemotePath(`/data/local/tmp/${fileName}`, { write: true });
    }
  }

  if (!replaced) {
    try {
      const { stdout } = await adbSerial(serial, ["shell", `ls ${shellQuote(remotePath)}`], {
        timeout: 10000,
      });
      if (stdout.trim() && !/No such file|Not found|No such/i.test(stdout)) replaced = true;
    } catch {
      /* treat as new */
    }
  }

  await adbSerial(serial, ["push", upload.path, remotePath], { timeout: 300000 });
  return {
    ok: true,
    remotePath,
    replaced,
    message: replaced
      ? `已覆盖推送到 ${remotePath}`
      : `已推送到 ${remotePath}（未找到同名系统包时写入此路径）`,
  };
}

async function runInstallJob(job, upload, serials, opts = {}) {
  const replace = opts.replace !== false;
  // allowDowngrade: explicit true enables -d; if omitted, keep legacy (-d with replace)
  const allowDowngrade =
    opts.allowDowngrade != null ? Boolean(opts.allowDowngrade) : replace;
  touchJob(job, { status: "running", message: "开始安装", progress: 0, items: [] });
  const total = serials.length || 1;
  for (let i = 0; i < serials.length; i++) {
    const serial = serials[i];
    const item = { serial, status: "running", message: "安装中" };
    job.items.push(item);
    touchJob(job, {
      progress: Math.round((i / total) * 100),
      message: `安装到 ${serial}（${i + 1}/${total}）`,
    });
    try {
      const args = ["install"];
      if (replace) args.push("-r");
      if (allowDowngrade) args.push("-d");
      args.push(upload.path);
      const { stdout, stderr } = await adbSerial(serial, args, { timeout: 600000 });
      const text = `${stdout}\n${stderr}`;
      if (/Failure|Error/i.test(text) && !/Success/i.test(text)) throw new Error(text.trim() || "安装失败");
      item.status = "ok";
      item.message = "Success";
    } catch (err) {
      item.status = "error";
      item.message = err.message || String(err);
    }
    touchJob(job, { progress: Math.round(((i + 1) / total) * 100) });
  }
  const failed = job.items.filter((x) => x.status === "error").length;
  touchJob(job, {
    status: failed && failed === job.items.length ? "error" : "done",
    message: failed ? `完成，失败 ${failed}/${job.items.length}` : "全部安装成功",
    error: failed ? `${failed} 台失败` : "",
    progress: 100,
  });
}

async function screenshotOne(serial) {
  const remote = `/sdcard/Download/devtools-shot-${Date.now()}.png`;
  await adbSerial(serial, ["shell", `screencap -p ${shellQuote(remote)}`], { timeout: 30000 });
  const local = tempName("shot", `${serial}.png`);
  try {
    await adbSerial(serial, ["pull", remote, local], { timeout: 120000 });
  } finally {
    try {
      await adbSerial(serial, ["shell", `rm -f -- ${shellQuote(remote)}`], { timeout: 10000 });
    } catch {
      /* ignore */
    }
  }
  const stat = fs.statSync(local);
  return {
    name: `${serial}-screenshot.png`,
    path: local,
    size: stat.size,
    serial,
    mime: "image/png",
  };
}

async function runScreenshotJob(job, serials) {
  touchJob(job, { status: "running", message: "开始截图", progress: 0, items: [], artifacts: [] });
  const total = serials.length || 1;
  for (let i = 0; i < serials.length; i++) {
    const serial = serials[i];
    const item = { serial, status: "running", message: "截图中" };
    job.items.push(item);
    touchJob(job, {
      progress: Math.round((i / total) * 100),
      message: `截图 ${serial}（${i + 1}/${total}）`,
    });
    try {
      const art = await screenshotOne(serial);
      job.artifacts.push(art);
      item.status = "ok";
      item.message = art.name;
    } catch (err) {
      item.status = "error";
      item.message = err.message || String(err);
    }
    touchJob(job, { progress: Math.round(((i + 1) / total) * 100) });
  }
  const failed = job.items.filter((x) => x.status === "error").length;
  touchJob(job, {
    status: failed && failed === job.items.length ? "error" : "done",
    message: failed ? `截图完成，失败 ${failed}` : "截图完成",
    error: failed ? `${failed} 台失败` : "",
    progress: 100,
  });
}

async function screencapPng(serial) {
  if (!serial) throw new Error("缺少设备 serial");
  const result = await adbSerial(serial, ["exec-out", "screencap", "-p"], {
    encoding: "buffer",
    maxBuffer: 50 * 1024 * 1024,
    timeout: 60000,
  });
  const data = Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout || "");
  if (!data.length) throw new Error("截图为空");
  return data;
}

async function pullRecordArtifact(job, serial, remote) {
  const local = tempName("rec", `${serial}.mp4`);
  await adbSerial(serial, ["pull", remote, local], { timeout: 300000 });
  try {
    await adbSerial(serial, ["shell", `rm -f -- ${shellQuote(remote)}`], { timeout: 10000 });
  } catch {
    /* ignore */
  }
  if (!fs.existsSync(local)) return null;
  const stat = fs.statSync(local);
  if (!stat.size) {
    try {
      fs.unlinkSync(local);
    } catch {
      /* ignore */
    }
    return null;
  }
  const art = {
    name: `${serial}-screenrecord.mp4`,
    path: local,
    size: stat.size,
    serial,
    mime: "video/mp4",
  };
  job.artifacts.push(art);
  return art;
}

async function runRecordJob(job, serial, seconds) {
  // seconds === 0 or null → no --time-limit (until cancel / device default)
  const unlimited = seconds === 0 || seconds === null;
  const limit = unlimited ? null : Math.max(1, Math.min(180, Number(seconds) || 30));
  const remote = `/sdcard/Download/devtools-rec-${Date.now()}.mp4`;
  job.meta = { ...(job.meta || {}), serial, seconds: unlimited ? 0 : limit, remote, unlimited };

  touchJob(job, {
    status: "running",
    message: unlimited ? "录屏中 0s（无时限，POST /jobs/:id/cancel 结束）" : `录屏中 0/${limit}s`,
    progress: 0,
    items: [{ serial, status: "running", message: "recording" }],
  });

  const started = Date.now();
  const timer = setInterval(() => {
    const elapsed = Math.round((Date.now() - started) / 1000);
    if (unlimited) {
      touchJob(job, {
        progress: Math.min(90, 5 + (elapsed % 85)),
        message: `录屏中 ${elapsed}s`,
      });
    } else {
      const capped = Math.min(limit, elapsed);
      touchJob(job, {
        progress: Math.round((capped / limit) * 90),
        message: `录屏中 ${capped}/${limit}s`,
      });
    }
  }, 1000);

  const shellCmd = unlimited
    ? `screenrecord ${shellQuote(remote)}`
    : `screenrecord --time-limit ${limit} ${shellQuote(remote)}`;

  const child = spawn("adb", ["-s", serial, "shell", shellCmd], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  job.child = child;
  job.pid = child.pid;

  let stderr = "";
  child.stderr.on("data", (d) => {
    stderr += d.toString("utf8");
  });
  child.stdout.on("data", () => {
    /* drain */
  });

  try {
    await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => {
        if (job.cancelRequested) {
          resolve({ cancelled: true });
          return;
        }
        if (code === 0 || signal === "SIGINT" || signal === "SIGTERM") {
          resolve({ cancelled: false });
          return;
        }
        // screenrecord may exit non-zero after SIGINT on some devices
        if (signal) {
          resolve({ cancelled: Boolean(job.cancelRequested) });
          return;
        }
        reject(new Error(stderr.trim() || `screenrecord 退出码 ${code}`));
      });
    });

    clearInterval(timer);
    job.child = null;

    if (job.cancelRequested) {
      touchJob(job, { progress: 92, message: "取消中，尝试拉取部分录屏…" });
      // brief settle so screenrecord flushes
      await new Promise((r) => setTimeout(r, 800));
      try {
        const art = await pullRecordArtifact(job, serial, remote);
        if (job.items[0]) {
          job.items[0].status = "cancelled";
          job.items[0].message = art ? "cancelled (partial)" : "cancelled";
        }
        touchJob(job, {
          status: "cancelled",
          progress: 100,
          message: art ? "已取消，已保存部分录屏" : "已取消（无可用片段）",
        });
      } catch (err) {
        if (job.items[0]) {
          job.items[0].status = "cancelled";
          job.items[0].message = err.message || String(err);
        }
        touchJob(job, {
          status: "cancelled",
          progress: 100,
          message: "已取消",
          error: err.message || String(err),
        });
      }
      return;
    }

    touchJob(job, { progress: 92, message: "拉取录屏文件…" });
    await pullRecordArtifact(job, serial, remote);
    if (job.items[0]) {
      job.items[0].status = "ok";
      job.items[0].message = "done";
    }
    touchJob(job, { status: "done", progress: 100, message: "录屏完成" });
  } catch (err) {
    clearInterval(timer);
    job.child = null;
    if (job.cancelRequested) {
      try {
        await pullRecordArtifact(job, serial, remote);
      } catch {
        /* ignore */
      }
      if (job.items[0]) {
        job.items[0].status = "cancelled";
        job.items[0].message = "cancelled";
      }
      touchJob(job, { status: "cancelled", progress: 100, message: "已取消" });
      return;
    }
    if (job.items[0]) {
      job.items[0].status = "error";
      job.items[0].message = err.message || String(err);
    }
    touchJob(job, {
      status: "error",
      progress: 100,
      message: "录屏失败",
      error: err.message || String(err),
    });
  }
}

async function cancelJob(jobId) {
  const job = JOBS.get(jobId);
  if (!job) throw new Error("任务不存在");
  if (job.status !== "running" && job.status !== "queued") {
    return { ok: false, job: publicJob(job), error: "任务已结束，无法取消" };
  }
  job.cancelRequested = true;
  touchJob(job, { message: job.message || "正在取消…" });

  const serial = job.meta?.serial || (job.items[0] && job.items[0].serial) || "";
  if (job.type === "record" && serial) {
    try {
      await adbSerial(serial, ["shell", "pkill", "-2", "screenrecord"], { timeout: 10000 });
    } catch {
      try {
        await adbSerial(serial, ["shell", "killall", "-2", "screenrecord"], { timeout: 10000 });
      } catch {
        /* ignore */
      }
    }
  }
  if (job.child && !job.child.killed) {
    try {
      job.child.kill("SIGINT");
    } catch {
      /* ignore */
    }
  }
  if (job.status === "queued") {
    touchJob(job, { status: "cancelled", progress: 100, message: "已取消" });
  }
  return { ok: true, job: publicJob(job), message: "已请求取消" };
}

async function runBackupJob(job, serial, packageName) {
  touchJob(job, {
    status: "running",
    message: `备份 ${packageName}`,
    progress: 10,
    items: [{ serial, status: "running", message: packageName }],
  });
  try {
    const file = await backupApp(serial, packageName);
    const local = tempName("jobbak", file.filename);
    fs.writeFileSync(local, file.data);
    job.artifacts.push({
      name: file.filename,
      path: local,
      size: file.data.length,
      serial,
      mime: "application/vnd.android.package-archive",
    });
    job.items[0].status = "ok";
    touchJob(job, { status: "done", progress: 100, message: "备份完成" });
  } catch (err) {
    job.items[0].status = "error";
    job.items[0].message = err.message || String(err);
    touchJob(job, {
      status: "error",
      progress: 100,
      message: "备份失败",
      error: err.message || String(err),
    });
  }
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
      const hostTools = await probeHostTools();
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
          version: BRIDGE_VERSION,
          port: PORT,
          tokenRequired: true,
          defaultTokenHint: "devtools-adb",
          features: [
            "fs",
            "fs-roots",
            "fs-run-as",
            "fs-su",
            "fs-data-virtual",
            "install",
            "install-push-system",
            "apps",
            "screenshot",
            "screencap",
            "record",
            "jobs",
            "job-cancel",
            "logcat",
            "input",
            "clipboard",
            "snapshot",
            "device-control",
            "apk-info",
            "apk-signing",
            "host-tools",
            "fs-preview",
            "host-tools-probe",
            "app-labels-aapt",
            "proxy",
            "forward",
            "developer",
          ],
          adb: adbInfo,
          tools: hostTools.tools,
          signingOk: hostTools.signingOk,
          setup: hostTools.setup,
          deviceCount: devices.length,
          roots: ROOTS,
          writeRoots: WRITE_ROOTS,
          note:
            "文件浏览类似 Device File Explorer：默认从 / 浏览；无权限时尝试 su / run-as；/data/data 无 root 时按包名虚拟列出。写入同样透传 adb；系统 APK 覆盖请用 POST /install/push-system",
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

    if (url.pathname === "/fs/roots" && req.method === "GET") {
      const serial = url.searchParams.get("serial") || "";
      sendJson(res, 200, await probeFsRoots(serial), origin);
      return;
    }

    if (url.pathname === "/fs/list" && req.method === "GET") {
      const serial = url.searchParams.get("serial") || "";
      const remotePath = url.searchParams.get("path") || "/";
      const result = await listDir(serial, remotePath);
      sendJson(res, 200, { ok: true, ...result }, origin);
      return;
    }

    if (url.pathname === "/fs/mkdir" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req, 1024 * 1024));
      sendJson(res, 200, await mkdirPath(body.serial, body.path), origin);
      return;
    }

    if (url.pathname === "/fs/delete" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req, 1024 * 1024));
      sendJson(res, 200, await deletePath(body.serial, body.path), origin);
      return;
    }

    if (url.pathname === "/fs/rename" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req, 1024 * 1024));
      sendJson(res, 200, await renamePath(body.serial, body.path, body.name), origin);
      return;
    }

    if (url.pathname === "/fs/move" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req, 1024 * 1024));
      sendJson(res, 200, await movePath(body.serial, body.from, body.to), origin);
      return;
    }

    if (url.pathname === "/fs/copy" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req, 1024 * 1024));
      sendJson(res, 200, await copyPath(body.serial, body.from, body.to), origin);
      return;
    }

    if (url.pathname === "/fs/upload" && req.method === "POST") {
      const serial = url.searchParams.get("serial") || "";
      const dir = url.searchParams.get("path") || "/sdcard/Download";
      const filename =
        decodeURIComponent(url.searchParams.get("name") || "") ||
        decodeURIComponent(String(req.headers["x-filename"] || "upload.bin"));
      const forcePush =
        url.searchParams.get("forcePush") === "1" ||
        url.searchParams.get("forcePush") === "true";
      const buffer = await readBody(req);
      if (!buffer.length) throw new Error("空文件");
      sendJson(res, 200, await uploadFile(serial, dir, filename, buffer, forcePush), origin);
      return;
    }

    if (url.pathname === "/fs/download" && req.method === "GET") {
      const serial = url.searchParams.get("serial") || "";
      const remotePath = url.searchParams.get("path") || "";
      const file = await downloadFile(serial, remotePath);
      const headers = {
        "Content-Type": file.mime || "application/octet-stream",
        "Content-Length": file.data.length,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
        "X-Adb-Filename": encodeURIComponent(file.filename),
        "X-Adb-Mime": file.mime || "application/octet-stream",
        "Cache-Control": "no-store",
      };
      applyCors(headers, origin);
      res.writeHead(200, headers);
      res.end(file.data);
      return;
    }

    if (url.pathname === "/upload" && req.method === "POST") {
      const filename =
        decodeURIComponent(url.searchParams.get("name") || "") ||
        decodeURIComponent(String(req.headers["x-filename"] || "upload.bin"));
      const buffer = await readBody(req);
      if (!buffer.length) throw new Error("空文件");
      const item = storeUpload(filename, buffer);
      sendJson(res, 200, { ok: true, uploadId: item.id, filename: item.filename, size: item.size }, origin);
      return;
    }

    if (url.pathname === "/install" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req, 1024 * 1024));
      const upload = UPLOADS.get(body.uploadId);
      if (!upload) throw new Error("找不到已上传的 APK，请先上传");
      const serials = parseSerials(body.serials || body.serial);
      if (!serials.length) throw new Error("请选择至少一台设备");
      const replace = body.replace !== false;
      const allowDowngrade =
        body.allowDowngrade != null ? Boolean(body.allowDowngrade) : replace;
      const job = createJob("install", {
        filename: upload.filename,
        serials,
        replace,
        allowDowngrade,
      });
      setImmediate(() => {
        runInstallJob(job, upload, serials, { replace, allowDowngrade }).catch((err) => {
          touchJob(job, { status: "error", error: err.message || String(err), message: "安装异常" });
        });
      });
      sendJson(res, 200, { ok: true, job: publicJob(job) }, origin);
      return;
    }

    if (url.pathname === "/install/push-system" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req, 1024 * 1024));
      const result = await pushSystemApk(
        body.serial,
        body.uploadId,
        body.packageName,
        body.remoteDir
      );
      sendJson(res, 200, result, origin);
      return;
    }

    if (url.pathname === "/apps" && req.method === "GET") {
      const serial = url.searchParams.get("serial") || "";
      const kind = url.searchParams.get("kind") || "all";
      const result = await listApps(serial, kind);
      sendJson(
        res,
        200,
        {
          ok: true,
          apps: result.apps,
          count: result.apps.length,
          labelResolved: result.labelResolved,
          labelNote: result.labelNote,
          labelSource: result.labelSource,
        },
        origin
      );
      return;
    }

    if (url.pathname === "/apps/action" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req, 1024 * 1024));
      sendJson(res, 200, await appAction(body.serial, body.packageName, body.action), origin);
      return;
    }

    if (url.pathname === "/apps/permission" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req, 1024 * 1024));
      sendJson(
        res,
        200,
        await appPermission(body.serial, body.packageName, body.action, body.permission),
        origin
      );
      return;
    }

    if (url.pathname === "/apps/info" && req.method === "GET") {
      const serial = url.searchParams.get("serial") || "";
      const packageName = url.searchParams.get("package") || "";
      sendJson(res, 200, await getPackageInfo(serial, packageName), origin);
      return;
    }

    if (url.pathname === "/apk/info" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req, 1024 * 1024));
      const upload = UPLOADS.get(body.uploadId);
      if (!upload) throw new Error("找不到已上传的 APK，请先上传");
      sendJson(res, 200, await analyzeLocalApk(upload.path, upload.filename), origin);
      return;
    }

    if (url.pathname === "/apps/backup" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req, 1024 * 1024));
      const serial = body.serial || "";
      const packageName = body.packageName || "";
      if (body.async) {
        const job = createJob("backup", { serial, packageName });
        setImmediate(() => {
          runBackupJob(job, serial, packageName).catch((err) => {
            touchJob(job, { status: "error", error: err.message || String(err), message: "备份异常" });
          });
        });
        sendJson(res, 200, { ok: true, job: publicJob(job) }, origin);
        return;
      }
      const file = await backupApp(serial, packageName);
      const headers = {
        "Content-Type": "application/vnd.android.package-archive",
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

    if (url.pathname === "/logcat" && req.method === "GET") {
      const serial = url.searchParams.get("serial") || "";
      const result = await dumpLogcat(serial, {
        lines: url.searchParams.get("lines"),
        query: url.searchParams.get("query"),
        packageName: url.searchParams.get("package"),
        tag: url.searchParams.get("tag"),
        since: url.searchParams.get("since"),
      });
      sendJson(res, 200, result, origin);
      return;
    }

    if (url.pathname === "/logcat/clear" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req, 1024 * 1024));
      sendJson(res, 200, await clearLogcat(body.serial), origin);
      return;
    }

    if (url.pathname === "/input" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req, 1024 * 1024));
      sendJson(res, 200, await runInput(body.serial, body), origin);
      return;
    }

    if (url.pathname === "/clipboard" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req, 1024 * 1024));
      sendJson(res, 200, await pushClipboard(body.serial, body.text), origin);
      return;
    }

    if (url.pathname === "/device/snapshot" && req.method === "GET") {
      const serial = url.searchParams.get("serial") || "";
      sendJson(res, 200, await deviceSnapshot(serial), origin);
      return;
    }

    if (url.pathname === "/device/control" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req, 1024 * 1024));
      sendJson(res, 200, await deviceControl(body.serial, body.action), origin);
      return;
    }

    if (url.pathname === "/network/proxy" && req.method === "GET") {
      const serial = url.searchParams.get("serial") || "";
      sendJson(res, 200, await getProxy(serial), origin);
      return;
    }

    if (url.pathname === "/network/proxy" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req, 1024 * 1024));
      if (body.clear) {
        sendJson(res, 200, await clearProxy(body.serial), origin);
        return;
      }
      sendJson(res, 200, await setProxy(body.serial, body.host, body.port), origin);
      return;
    }

    if (url.pathname === "/network/forward" && req.method === "GET") {
      const serial = url.searchParams.get("serial") || "";
      sendJson(res, 200, await listForwards(serial), origin);
      return;
    }

    if (url.pathname === "/network/forward" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req, 1024 * 1024));
      if (body.remove || body.removeAll) {
        sendJson(
          res,
          200,
          await removeForward(body.serial, body.local, body.direction || "forward", Boolean(body.removeAll)),
          origin
        );
        return;
      }
      sendJson(
        res,
        200,
        await addForward(body.serial, body.local, body.remote, body.direction || "forward"),
        origin
      );
      return;
    }

    if (url.pathname === "/developer" && req.method === "GET") {
      const serial = url.searchParams.get("serial") || "";
      sendJson(res, 200, await getDeveloperOptions(serial), origin);
      return;
    }

    if (url.pathname === "/developer" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req, 1024 * 1024));
      sendJson(res, 200, await setDeveloperOption(body.serial, body.key, body.value), origin);
      return;
    }

    if (url.pathname === "/media/screencap" && req.method === "GET") {
      const serial = url.searchParams.get("serial") || "";
      const data = await screencapPng(serial);
      const headers = {
        "Content-Type": "image/png",
        "Content-Length": data.length,
        "Cache-Control": "no-store",
      };
      applyCors(headers, origin);
      res.writeHead(200, headers);
      res.end(data);
      return;
    }

    if (url.pathname === "/media/screenshot" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req, 1024 * 1024));
      const serials = parseSerials(body.serials || body.serial);
      if (!serials.length) throw new Error("请选择至少一台设备");
      const job = createJob("screenshot", { serials });
      setImmediate(() => {
        runScreenshotJob(job, serials).catch((err) => {
          touchJob(job, { status: "error", error: err.message || String(err), message: "截图异常" });
        });
      });
      sendJson(res, 200, { ok: true, job: publicJob(job) }, origin);
      return;
    }

    if (url.pathname === "/media/record" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req, 1024 * 1024));
      const serial = String(body.serial || "").trim();
      if (!serial) throw new Error("请选择设备");
      // seconds: omit → 30; 0/null → unlimited until cancel
      let seconds;
      if (body.seconds === 0 || body.seconds === null) {
        seconds = body.seconds === null ? null : 0;
      } else if (body.seconds === undefined || body.seconds === "") {
        seconds = 30;
      } else {
        seconds = Number(body.seconds);
        if (!Number.isFinite(seconds)) seconds = 30;
      }
      const job = createJob("record", { serial, seconds: seconds == null ? 0 : seconds });
      setImmediate(() => {
        runRecordJob(job, serial, seconds).catch((err) => {
          touchJob(job, { status: "error", error: err.message || String(err), message: "录屏异常" });
        });
      });
      sendJson(res, 200, { ok: true, job: publicJob(job) }, origin);
      return;
    }

    if (url.pathname === "/jobs" && req.method === "GET") {
      const list = [...JOBS.values()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 40)
        .map(publicJob);
      sendJson(res, 200, { ok: true, jobs: list }, origin);
      return;
    }

    const cancelMatch = url.pathname.match(/^\/jobs\/([^/]+)\/cancel$/);
    if (cancelMatch && req.method === "POST") {
      sendJson(res, 200, await cancelJob(decodeURIComponent(cancelMatch[1])), origin);
      return;
    }

    if (url.pathname.startsWith("/jobs/") && req.method === "GET") {
      const parts = url.pathname.split("/").filter(Boolean);
      const jobId = parts[1];
      const job = JOBS.get(jobId);
      if (!job) throw new Error("任务不存在");
      if (parts[2] === "artifact") {
        const name = decodeURIComponent(parts[3] || "");
        const art = job.artifacts.find((a) => a.name === name);
        if (!art || !fs.existsSync(art.path)) throw new Error("产物不存在");
        const data = fs.readFileSync(art.path);
        const headers = {
          "Content-Type": art.mime || "application/octet-stream",
          "Content-Length": data.length,
          "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(art.name)}`,
          "X-Adb-Filename": encodeURIComponent(art.name),
          "Cache-Control": "no-store",
        };
        applyCors(headers, origin);
        res.writeHead(200, headers);
        res.end(data);
        return;
      }
      sendJson(res, 200, { ok: true, job: publicJob(job) }, origin);
      return;
    }

    sendJson(res, 404, { ok: false, error: "未找到接口" }, origin);
  } catch (err) {
    const status = err.status || (String(err.message || "").includes("未授权") ? 401 : 400);
    sendJson(res, status, { ok: false, error: err.message || String(err) }, origin);
  }
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  handleApi(req, res, url);
});

function printBanner(activePort) {
  console.log("");
  console.log("========================================");
  console.log(" DevTools ADB Bridge 已启动");
  console.log(` 版本: ${BRIDGE_VERSION}`);
  console.log(` 地址: http://${HOST}:${activePort}`);
  console.log(` Token: ${TOKEN}`);
  console.log(" 能力: 文件 / 安装 / 应用 / 网络代理转发 / 开发者选项 / Logcat / 任务");
  console.log(" 请保持此窗口打开，然后回到网页点击「连接」");
  if (activePort !== PORT) {
    console.log(` 注意: 默认端口 ${PORT} 被占用，已改用 ${activePort}`);
    console.log(" 请在网页把桥地址改成上述端口后再连接");
  }
  console.log("========================================");
  console.log("");
}

function listenWithFallback(startPort, maxTries = 12) {
  let port = startPort;
  let tries = 0;

  const tryListen = () => {
    const onError = (err) => {
      server.removeListener("listening", onListening);
      if (err && err.code === "EADDRINUSE" && tries < maxTries - 1) {
        tries += 1;
        const next = startPort + tries;
        console.warn(`端口 ${port} 已被占用，尝试 ${next}…`);
        port = next;
        setTimeout(tryListen, 50);
        return;
      }
      console.error("");
      console.error("启动失败:", err && err.message ? err.message : String(err));
      if (err && err.code === "EADDRINUSE") {
        console.error(`端口 ${startPort} 起连续 ${maxTries} 个均被占用。`);
        console.error("请关闭旧的桥接窗口，或设置环境变量 ADB_BRIDGE_PORT 换端口。");
      }
      console.error("");
      process.exitCode = 1;
    };

    const onListening = () => {
      server.removeListener("error", onError);
      printBanner(port);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, HOST);
  };

  tryListen();
}

listenWithFallback(PORT);

function cleanup() {
  try {
    fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
  try {
    server.close();
  } catch {
    /* ignore */
  }
  process.exit(0);
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

process.on("uncaughtException", (err) => {
  console.error("");
  console.error("未捕获异常:", err && err.stack ? err.stack : err);
  console.error("窗口将保持打开，便于查看错误。按 Ctrl+C 退出。");
});

