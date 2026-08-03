#!/usr/bin/env node
"use strict";

/**
 * DevTools local ADB bridge (P0–P3)
 * - Bind 127.0.0.1 only
 * - Zero npm dependencies
 * - File ops limited to /sdcard and /storage/emulated/0
 */

const http = require("http");
const { URL } = require("url");
const { execFile } = require("child_process");
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
const JOBS = new Map();
const UPLOADS = new Map();
const BRIDGE_VERSION = "0.5.1";

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
    execFile(
      file,
      args,
      {
        encoding: opts.encoding || "utf8",
        maxBuffer: opts.maxBuffer || 20 * 1024 * 1024,
        timeout: opts.timeout || 120000,
        ...opts,
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
  if (!allowed) throw new Error(`仅允许访问：${ROOTS.join("、")}`);
  return normalized === "/" ? "/sdcard" : normalized;
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
  const dir = normalizeRemotePath(remotePath);
  const { stdout, stderr } = await adbSerial(serial, ["shell", `ls -la ${shellQuote(dir)}`], {
    timeout: 20000,
  });
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

async function movePath(serial, fromPath, toPath) {
  const from = normalizeRemotePath(fromPath);
  const to = normalizeRemotePath(toPath);
  if (ROOTS.includes(from)) throw new Error("不能移动根目录");
  await adbSerial(serial, ["shell", `mv -- ${shellQuote(from)} ${shellQuote(to)}`], { timeout: 60000 });
  return { ok: true, from, to };
}

async function copyPath(serial, fromPath, toPath) {
  const from = normalizeRemotePath(fromPath);
  const to = normalizeRemotePath(toPath);
  await adbSerial(serial, ["shell", `cp -a -- ${shellQuote(from)} ${shellQuote(to)}`], {
    timeout: 180000,
  });
  return { ok: true, from, to };
}

async function renamePath(serial, fromPath, newName) {
  const from = normalizeRemotePath(fromPath);
  if (ROOTS.includes(from)) throw new Error("不能重命名根目录");
  const base = from.slice(0, from.lastIndexOf("/")) || "/sdcard";
  const name = path.basename(String(newName || "").trim()).replace(/[\\/]/g, "");
  if (!name) throw new Error("新名称无效");
  const to = normalizeRemotePath(`${base}/${name}`);
  return movePath(serial, from, to);
}

async function uploadFile(serial, dir, filename, buffer) {
  const safeDir = normalizeRemotePath(dir);
  const safeName = path.basename(String(filename || "upload.bin")).replace(/[\\/]/g, "_");
  if (!safeName) throw new Error("文件名无效");
  const remote = normalizeRemotePath(`${safeDir}/${safeName}`);
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
  return { ok: true, path: remote, size: buffer.length };
}

async function downloadFile(serial, remotePath) {
  const target = normalizeRemotePath(remotePath);
  const local = tempName("dl", basenameRemote(target));
  await adbSerial(serial, ["pull", target, local], { timeout: 300000 });
  const data = fs.readFileSync(local);
  try {
    fs.unlinkSync(local);
  } catch {
    /* ignore */
  }
  return { filename: basenameRemote(target), data };
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
      apkPath,
      isSystem,
      kind: isSystem ? "system" : "third",
    });
  }
  apps.sort((a, b) => a.packageName.localeCompare(b.packageName));
  return apps;
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
  if (!badging) {
    return {
      ok: true,
      filename,
      tool: "",
      note: "本机未找到 aapt/aapt2，仅返回文件大小。安装 Android build-tools 后可解析包名/权限。",
      size: fs.statSync(filePath).size,
    };
  }
  const packageName = (badging.match(/package: name='([^']+)'/) || [])[1] || "";
  const versionName = (badging.match(/versionName='([^']+)'/) || [])[1] || "";
  const versionCode = (badging.match(/versionCode='([^']+)'/) || [])[1] || "";
  const minSdk = (badging.match(/sdkVersion:'([^']+)'/) || [])[1] || "";
  const targetSdk = (badging.match(/targetSdkVersion:'([^']+)'/) || [])[1] || "";
  const launchActivity = (badging.match(/launchable-activity: name='([^']+)'/) || [])[1] || "";
  const permissions = [...badging.matchAll(/uses-permission: name='([^']+)'/g)].map((m) => m[1]);
  const label = (badging.match(/application-label(?:-zh(?:-CN)?)?:'([^']+)'/) ||
    badging.match(/application-label:'([^']+)'/) || [])[1] || "";
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
    size: fs.statSync(filePath).size,
    rawPreview: badging.split(/\r?\n/).slice(0, 80).join("\n"),
  };
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
  const showTouches = await read("system", "show_touches");
  const pointerLocation = await read("system", "pointer_location");
  const windowAnim = await read("global", "window_animation_scale");
  const transitionAnim = await read("global", "transition_animation_scale");
  const animatorAnim = await read("global", "animator_duration_scale");
  const layout = await shellCapture(serial, "getprop debug.layout", 8000);
  const stayOn = await read("global", "stay_on_while_plugged_in");
  return {
    ok: true,
    showTouches: showTouches === "1" || showTouches === "true",
    pointerLocation: pointerLocation === "1" || pointerLocation === "true",
    layoutBounds: layout === "true" || layout === "1",
    windowAnimationScale: windowAnim === "null" ? "1.0" : windowAnim || "1.0",
    transitionAnimationScale: transitionAnim === "null" ? "1.0" : transitionAnim || "1.0",
    animatorDurationScale: animatorAnim === "null" ? "1.0" : animatorAnim || "1.0",
    stayOnWhilePluggedIn: stayOn === "null" ? "0" : stayOn || "0",
    raw: { showTouches, pointerLocation, layout, windowAnim, transitionAnim, animatorAnim, stayOn },
  };
}

async function setDeveloperOption(serial, key, value) {
  const k = String(key || "").trim();
  async function put(ns, name, val) {
    await adbSerial(serial, ["shell", "settings", "put", ns, name, String(val)], { timeout: 10000 });
  }
  if (k === "show_touches") {
    await put("system", "show_touches", value ? "1" : "0");
  } else if (k === "pointer_location") {
    await put("system", "pointer_location", value ? "1" : "0");
  } else if (k === "layout_bounds") {
    await adbSerial(serial, ["shell", "setprop", "debug.layout", value ? "true" : "false"], {
      timeout: 10000,
    });
    // Refresh UI hierarchy overlay
    try {
      await adbSerial(serial, ["shell", "service", "call", "activity", "1599295570"], {
        timeout: 10000,
      });
    } catch {
      /* ignore refresh failure */
    }
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
  const { stdout } = await adbSerial(serial, args, { timeout: 60000, maxBuffer: 30 * 1024 * 1024 });
  let text = stdout || "";
  if (query) {
    const q = query.toLowerCase();
    text = text
      .split(/\r?\n/)
      .filter((line) => line.toLowerCase().includes(q))
      .join("\n");
  }
  return { ok: true, text, lines: text ? text.split(/\r?\n/).filter(Boolean).length : 0 };
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

async function runInstallJob(job, upload, serials, replace) {
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
      const args = replace ? ["install", "-r", "-d", upload.path] : ["install", upload.path];
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

async function runRecordJob(job, serial, seconds) {
  const limit = Math.max(1, Math.min(180, Number(seconds) || 30));
  const remote = `/sdcard/Download/devtools-rec-${Date.now()}.mp4`;
  touchJob(job, {
    status: "running",
    message: `录屏中 0/${limit}s`,
    progress: 0,
    items: [{ serial, status: "running", message: "recording" }],
  });

  const started = Date.now();
  const timer = setInterval(() => {
    const elapsed = Math.min(limit, Math.round((Date.now() - started) / 1000));
    touchJob(job, {
      progress: Math.round((elapsed / limit) * 90),
      message: `录屏中 ${elapsed}/${limit}s`,
    });
  }, 1000);

  try {
    await adbSerial(serial, ["shell", `screenrecord --time-limit ${limit} ${shellQuote(remote)}`], {
      timeout: (limit + 30) * 1000,
    });
    clearInterval(timer);
    touchJob(job, { progress: 92, message: "拉取录屏文件…" });
    const local = tempName("rec", `${serial}.mp4`);
    await adbSerial(serial, ["pull", remote, local], { timeout: 300000 });
    try {
      await adbSerial(serial, ["shell", `rm -f -- ${shellQuote(remote)}`], { timeout: 10000 });
    } catch {
      /* ignore */
    }
    const stat = fs.statSync(local);
    job.artifacts.push({
      name: `${serial}-screenrecord.mp4`,
      path: local,
      size: stat.size,
      serial,
      mime: "video/mp4",
    });
    job.items[0].status = "ok";
    job.items[0].message = "done";
    touchJob(job, { status: "done", progress: 100, message: "录屏完成" });
  } catch (err) {
    clearInterval(timer);
    job.items[0].status = "error";
    job.items[0].message = err.message || String(err);
    touchJob(job, {
      status: "error",
      progress: 100,
      message: "录屏失败",
      error: err.message || String(err),
    });
  }
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
            "install",
            "apps",
            "screenshot",
            "record",
            "jobs",
            "logcat",
            "input",
            "clipboard",
            "snapshot",
            "device-control",
            "apk-info",
            "proxy",
            "forward",
            "developer",
          ],
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
      const buffer = await readBody(req);
      if (!buffer.length) throw new Error("空文件");
      sendJson(res, 200, await uploadFile(serial, dir, filename, buffer), origin);
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
      const job = createJob("install", {
        filename: upload.filename,
        serials,
        replace: body.replace !== false,
      });
      setImmediate(() => {
        runInstallJob(job, upload, serials, body.replace !== false).catch((err) => {
          touchJob(job, { status: "error", error: err.message || String(err), message: "安装异常" });
        });
      });
      sendJson(res, 200, { ok: true, job: publicJob(job) }, origin);
      return;
    }

    if (url.pathname === "/apps" && req.method === "GET") {
      const serial = url.searchParams.get("serial") || "";
      const kind = url.searchParams.get("kind") || "all";
      const apps = await listApps(serial, kind);
      sendJson(res, 200, { ok: true, apps, count: apps.length }, origin);
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
      const seconds = Number(body.seconds || 30);
      const job = createJob("record", { serial, seconds });
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

server.listen(PORT, HOST, () => {
  console.log("");
  console.log("========================================");
  console.log(" DevTools ADB Bridge 已启动");
  console.log(` 版本: ${BRIDGE_VERSION}`);
  console.log(` 地址: http://${HOST}:${PORT}`);
  console.log(` Token: ${TOKEN}`);
  console.log(" 能力: 文件 / 安装 / 应用 / 网络代理转发 / 开发者选项 / Logcat / 任务");
  console.log(" 请保持此窗口打开，然后回到网页点击「连接」");
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
