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
const BRIDGE_VERSION = "0.3.0";

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
  throw new Error("不支持的应用操作");
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
          features: ["fs", "install", "apps", "screenshot", "record", "jobs"],
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
  console.log(" 能力: 文件 / 安装 / 应用 / 截图录屏 / 任务");
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
