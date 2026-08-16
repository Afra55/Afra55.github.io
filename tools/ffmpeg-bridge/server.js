#!/usr/bin/env node
"use strict";

/**
 * DevTools local FFmpeg bridge
 * - Bind 127.0.0.1 only
 * - Zero npm dependencies
 * - Local FS browse + batch ffmpeg jobs (extract audio / convert)
 */

const http = require("http");
const { URL } = require("url");
const { execFile, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");

const HOST = "127.0.0.1";
const PORT = Number(process.env.FFMPEG_BRIDGE_PORT || 17889);
const TOKEN = String(process.env.FFMPEG_BRIDGE_TOKEN || "devtools-ffmpeg");
const ALLOWED_ORIGINS = new Set(
  String(
    process.env.FFMPEG_BRIDGE_ORIGINS ||
      [
        "https://afra55.github.io",
        "http://127.0.0.1:8080",
        "http://localhost:8080",
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "http://127.0.0.1:8765",
        "http://localhost:8765",
      ].join(",")
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

const BRIDGE_VERSION = "0.1.0";
const FEATURES = [
  "local-fs",
  "probe",
  "extract-audio",
  "convert",
  "jobs",
  "job-cancel",
];

const VIDEO_EXTS = new Set([
  ".mp4",
  ".mov",
  ".mkv",
  ".webm",
  ".m4v",
  ".avi",
  ".flv",
  ".wmv",
  ".ts",
  ".m2ts",
  ".mpg",
  ".mpeg",
  ".3gp",
]);
const AUDIO_EXTS = new Set([".mp3", ".m4a", ".aac", ".wav", ".flac", ".ogg", ".opus", ".wma"]);

const TMP_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "ffmpeg-bridge-"));
const JOBS = new Map();

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
    headers["Access-Control-Allow-Headers"] = "Content-Type, X-Ffmpeg-Token, X-Filename";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Expose-Headers"] = "Content-Disposition";
  }
}

function readBody(req, limit = 8 * 1024 * 1024) {
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
        resolve({
          stdout: stdout || (encoding === null ? Buffer.alloc(0) : ""),
          stderr: stderr || (encoding === null ? Buffer.alloc(0) : ""),
        });
      }
    );
  });
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

function requireToken(req) {
  const token = req.headers["x-ffmpeg-token"];
  if (!token || token !== TOKEN) {
    const err = new Error("未授权：缺少或错误的 X-Ffmpeg-Token");
    err.status = 401;
    throw err;
  }
}

function localFsRoots() {
  const roots = [
    { path: os.homedir(), name: "Home" },
    { path: os.tmpdir(), name: "Temp" },
  ];
  if (process.platform === "win32") {
    for (const letter of "CDEFGHIJKLMNOPQRSTUVWXYZ") {
      const drive = `${letter}:\\`;
      try {
        if (fs.existsSync(drive)) roots.push({ path: drive, name: `${letter}:` });
      } catch {
        /* skip */
      }
    }
  }
  return roots;
}

function isPathUnderRoot(realPath, rootReal) {
  const a = path.resolve(realPath);
  const b = path.resolve(rootReal);
  if (a === b) return true;
  const prefix = b.endsWith(path.sep) ? b : b + path.sep;
  return a.startsWith(prefix);
}

async function resolveLocalPath(inputPath, { mustExist = true } = {}) {
  const raw = String(inputPath || "").trim();
  if (!raw) throw new Error("缺少 path");
  if (raw.includes("\0")) throw new Error("非法路径");
  const roots = localFsRoots();
  const resolvedRoots = [];
  for (const r of roots) {
    try {
      resolvedRoots.push(await fs.promises.realpath(r.path));
    } catch {
      /* skip */
    }
  }
  if (!resolvedRoots.length) throw new Error("无可用本机根目录");
  const candidate = path.resolve(raw);
  if (!mustExist) {
    const parent = path.dirname(candidate);
    let parentReal;
    try {
      parentReal = await fs.promises.realpath(parent);
    } catch (err) {
      throw new Error(err.code === "ENOENT" ? `父目录不存在: ${parent}` : err.message || String(err));
    }
    if (!resolvedRoots.some((root) => isPathUnderRoot(parentReal, root))) {
      throw new Error("路径不在允许的本机根目录内");
    }
    const base = path.basename(candidate);
    if (!base || base === "." || base === "..") throw new Error("非法文件名");
    return path.join(parentReal, base);
  }
  let real;
  try {
    real = await fs.promises.realpath(candidate);
  } catch (err) {
    throw new Error(err.code === "ENOENT" ? `路径不存在: ${candidate}` : err.message || String(err));
  }
  if (!resolvedRoots.some((root) => isPathUnderRoot(real, root))) {
    throw new Error("路径不在允许的本机根目录内");
  }
  return real;
}

async function listLocalDir(inputPath) {
  const real = await resolveLocalPath(inputPath);
  const st = await fs.promises.stat(real);
  if (!st.isDirectory()) throw new Error("不是目录");
  const dirents = await fs.promises.readdir(real, { withFileTypes: true });
  const entries = [];
  for (const d of dirents) {
    const full = path.join(real, d.name);
    let size = 0;
    let date = "";
    let writable = false;
    const type = d.isDirectory() ? "dir" : "file";
    try {
      const s = await fs.promises.stat(full);
      size = s.isFile() ? s.size : 0;
      date = s.mtime ? new Date(s.mtime).toISOString() : "";
    } catch {
      /* ignore */
    }
    try {
      await fs.promises.access(full, fs.constants.W_OK);
      writable = true;
    } catch {
      writable = false;
    }
    const ext = path.extname(d.name).toLowerCase();
    entries.push({
      name: d.name,
      type,
      size,
      date,
      writable,
      kind: type === "dir" ? "dir" : VIDEO_EXTS.has(ext) ? "video" : AUDIO_EXTS.has(ext) ? "audio" : "file",
    });
  }
  entries.sort((a, b) => {
    if (a.type === "dir" && b.type !== "dir") return -1;
    if (a.type !== "dir" && b.type === "dir") return 1;
    return a.name.localeCompare(b.name);
  });
  return { ok: true, path: real, entries };
}

async function ensureWritableDir(dirPath) {
  const real = await resolveLocalPath(dirPath);
  const st = await fs.promises.stat(real);
  if (!st.isDirectory()) throw new Error("输出目录不是文件夹");
  try {
    await fs.promises.access(real, fs.constants.W_OK);
  } catch {
    throw new Error("输出目录不可写");
  }
  return real;
}

async function mkdirpAllowed(dirPath) {
  const candidate = path.resolve(String(dirPath || "").trim());
  if (!candidate) throw new Error("缺少输出目录");
  // allow creating under an existing allowed parent
  let cur = candidate;
  const parts = [];
  while (true) {
    try {
      const real = await resolveLocalPath(cur);
      const st = await fs.promises.stat(real);
      if (!st.isDirectory()) throw new Error("输出路径冲突");
      break;
    } catch (err) {
      if (!/不存在|ENOENT/i.test(String(err.message || err))) throw err;
      parts.unshift(path.basename(cur));
      const parent = path.dirname(cur);
      if (parent === cur) throw err;
      cur = parent;
    }
  }
  let build = await resolveLocalPath(cur);
  for (const part of parts) {
    if (!part || part === "." || part === "..") throw new Error("非法目录名");
    build = path.join(build, part);
    await fs.promises.mkdir(build, { recursive: false }).catch(async (e) => {
      if (e.code !== "EEXIST") throw e;
    });
  }
  return ensureWritableDir(build);
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
      path: a.path || "",
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

async function checkBinary(name, args) {
  const resolved = whichSync(name) || name;
  try {
    const { stdout, stderr } = await execFileAsync(resolved, args, { timeout: 8000 });
    const text = String(stdout || stderr || "").trim();
    const line = text.split(/\r?\n/).find(Boolean) || text;
    return { ok: true, version: line.slice(0, 200), path: whichSync(name) || resolved };
  } catch (err) {
    return {
      ok: false,
      error: err.message || String(err),
      setup:
        name === "ffmpeg"
          ? "请安装 FFmpeg 并确保终端可执行 ffmpeg。macOS: brew install ffmpeg；Windows: 官网 zip 加入 PATH；Linux: apt/yum/pacman 安装 ffmpeg。"
          : "请安装 FFmpeg（含 ffprobe）。",
    };
  }
}

async function probeMedia(inputPath) {
  const real = await resolveLocalPath(inputPath);
  const ffprobe = whichSync("ffprobe") || "ffprobe";
  const { stdout } = await execFileAsync(
    ffprobe,
    [
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      real,
    ],
    { timeout: 60000 }
  );
  let info = {};
  try {
    info = JSON.parse(String(stdout || "{}"));
  } catch {
    info = {};
  }
  const format = info.format || {};
  const streams = Array.isArray(info.streams) ? info.streams : [];
  const video = streams.find((s) => s.codec_type === "video");
  const audio = streams.find((s) => s.codec_type === "audio");
  return {
    ok: true,
    path: real,
    name: path.basename(real),
    duration: Number(format.duration) || 0,
    size: Number(format.size) || 0,
    format: format.format_name || "",
    bitrate: Number(format.bit_rate) || 0,
    video: video
      ? {
          codec: video.codec_name || "",
          width: Number(video.width) || 0,
          height: Number(video.height) || 0,
          fps: String(video.r_frame_rate || video.avg_frame_rate || ""),
        }
      : null,
    audio: audio
      ? {
          codec: audio.codec_name || "",
          channels: Number(audio.channels) || 0,
          sampleRate: Number(audio.sample_rate) || 0,
        }
      : null,
  };
}

function isVideoFile(filePath) {
  return VIDEO_EXTS.has(path.extname(filePath).toLowerCase());
}

async function collectInputFiles(paths, { recursive = false, maxFiles = 2000 } = {}) {
  const list = Array.isArray(paths) ? paths : [];
  if (!list.length) throw new Error("请选择至少一个文件或文件夹");
  const out = [];
  const seen = new Set();

  async function walkDir(dir, depth) {
    if (out.length >= maxFiles) return;
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const d of entries) {
      if (out.length >= maxFiles) return;
      if (d.name.startsWith(".")) continue;
      const full = path.join(dir, d.name);
      if (d.isDirectory()) {
        if (recursive && depth < 8) await walkDir(full, depth + 1);
        continue;
      }
      if (d.isFile() && isVideoFile(full)) {
        const real = await resolveLocalPath(full);
        if (!seen.has(real)) {
          seen.add(real);
          out.push(real);
        }
      }
    }
  }

  for (const raw of list) {
    if (out.length >= maxFiles) break;
    const real = await resolveLocalPath(raw);
    const st = await fs.promises.stat(real);
    if (st.isDirectory()) {
      await walkDir(real, 0);
    } else if (st.isFile()) {
      if (!seen.has(real)) {
        seen.add(real);
        out.push(real);
      }
    }
  }
  if (!out.length) throw new Error("未找到可处理的视频文件");
  if (out.length > maxFiles) throw new Error(`文件过多（>${maxFiles}），请缩小范围`);
  return out;
}

function spawnFfmpeg(args, { onProgress } = {}) {
  const bin = whichSync("ffmpeg") || "ffmpeg";
  const child = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    const text = chunk.toString("utf8");
    stderr += text;
    if (stderr.length > 200000) stderr = stderr.slice(-100000);
    if (typeof onProgress === "function") {
      const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text);
      if (m) {
        const sec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
        onProgress(sec, text);
      }
    }
  });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve({ code, stderr });
      else reject(Object.assign(new Error(clip(stderr) || `ffmpeg 退出码 ${code}`), { code, stderr }));
    });
  });
  return { child, done };
}

function clip(text, max = 400) {
  const s = String(text || "")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function audioArgsForFormat(fmt, bitrate) {
  const f = String(fmt || "mp3").toLowerCase();
  const br = String(bitrate || "192k");
  if (f === "wav") return { ext: "wav", args: ["-vn", "-c:a", "pcm_s16le", "-ar", "44100", "-ac", "2"] };
  if (f === "m4a") return { ext: "m4a", args: ["-vn", "-c:a", "aac", "-b:a", br] };
  return { ext: "mp3", args: ["-vn", "-c:a", "libmp3lame", "-b:a", br] };
}

function convertPresetArgs(preset) {
  const p = String(preset || "mp4-fast").toLowerCase();
  if (p === "mp4-hq") {
    return {
      ext: "mp4",
      args: ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"],
    };
  }
  if (p === "webm") {
    return {
      ext: "webm",
      args: ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-c:a", "libopus", "-b:a", "128k"],
    };
  }
  if (p === "audio-copy-mp4") {
    return { ext: "mp4", args: ["-c", "copy", "-movflags", "+faststart"] };
  }
  // default fast mp4
  return {
    ext: "mp4",
    args: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"],
  };
}

async function uniqueOutPath(dir, base, ext, overwrite) {
  let name = `${base}.${ext}`;
  let dest = path.join(dir, name);
  if (overwrite) return dest;
  let i = 1;
  while (fs.existsSync(dest)) {
    name = `${base}-${i}.${ext}`;
    dest = path.join(dir, name);
    i += 1;
    if (i > 9999) throw new Error("无法生成唯一输出文件名");
  }
  return dest;
}

function runJobAsync(job, runner) {
  setImmediate(async () => {
    touchJob(job, { status: "running", progress: 0.01, message: "开始…" });
    try {
      await runner(job);
      if (job.cancelRequested) {
        touchJob(job, { status: "cancelled", message: "已取消", progress: job.progress || 0 });
      } else {
        touchJob(job, { status: "done", progress: 1, message: job.message || "完成" });
      }
    } catch (err) {
      touchJob(job, {
        status: job.cancelRequested ? "cancelled" : "error",
        error: err.message || String(err),
        message: job.cancelRequested ? "已取消" : "失败",
      });
    } finally {
      job.child = null;
      job.pid = null;
    }
  });
}

async function runExtractAudioJob(job) {
  const files = job._files;
  const outDir = job._outDir;
  const fmt = audioArgsForFormat(job.meta.format, job.meta.bitrate);
  const overwrite = Boolean(job.meta.overwrite);
  const total = files.length;
  let okCount = 0;
  let failCount = 0;

  for (let i = 0; i < files.length; i++) {
    if (job.cancelRequested) break;
    const src = files[i];
    const base = path.basename(src, path.extname(src));
    const dest = await uniqueOutPath(outDir, base, fmt.ext, overwrite);
    touchJob(job, {
      progress: i / total,
      message: `抽音频 ${i + 1}/${total} · ${path.basename(src)}`,
    });
    const item = { src, dest, ok: false, error: "" };
    try {
      // Prefer stream copy into m4a when source audio is already aac and no forced reencode needed
      const attempts = [];
      if (fmt.ext === "m4a" && !overwrite) {
        attempts.push(["-y", "-i", src, "-vn", "-c:a", "copy", dest]);
      }
      attempts.push(["-y", "-i", src, ...fmt.args, dest]);

      let lastErr = null;
      for (const args of attempts) {
        if (job.cancelRequested) break;
        try {
          const { child, done } = spawnFfmpeg(args);
          job.child = child;
          job.pid = child.pid || null;
          await done;
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          try {
            if (fs.existsSync(dest)) await fs.promises.unlink(dest);
          } catch {
            /* ignore */
          }
        }
      }
      if (job.cancelRequested) break;
      if (lastErr) throw lastErr;
      const st = await fs.promises.stat(dest);
      item.ok = true;
      item.size = st.size;
      okCount += 1;
      job.artifacts.push({
        name: path.basename(dest),
        size: st.size,
        path: dest,
        mime: fmt.ext === "mp3" ? "audio/mpeg" : fmt.ext === "wav" ? "audio/wav" : "audio/mp4",
      });
    } catch (err) {
      item.error = err.message || String(err);
      failCount += 1;
    }
    job.items.push(item);
  }

  touchJob(job, {
    progress: job.cancelRequested ? iSafe(job.items.length, total) : 1,
    message: job.cancelRequested
      ? `已取消 · 成功 ${okCount} · 失败 ${failCount}`
      : `完成 · 成功 ${okCount} · 失败 ${failCount}`,
    meta: { ...job.meta, okCount, failCount, outDir },
  });
  if (!okCount && failCount) throw new Error(job.items.find((x) => x.error)?.error || "全部失败");
}

function iSafe(n, total) {
  return total ? Math.min(0.99, n / total) : 0;
}

async function runConvertJob(job) {
  const files = job._files;
  const outDir = job._outDir;
  const preset = convertPresetArgs(job.meta.preset);
  const overwrite = Boolean(job.meta.overwrite);
  const total = files.length;
  let okCount = 0;
  let failCount = 0;

  for (let i = 0; i < files.length; i++) {
    if (job.cancelRequested) break;
    const src = files[i];
    const base = path.basename(src, path.extname(src));
    const dest = await uniqueOutPath(outDir, `${base}-out`, preset.ext, overwrite);
    touchJob(job, {
      progress: i / total,
      message: `转换 ${i + 1}/${total} · ${path.basename(src)}`,
    });
    const item = { src, dest, ok: false, error: "" };
    try {
      const args = ["-y", "-i", src, ...preset.args, dest];
      const { child, done } = spawnFfmpeg(args);
      job.child = child;
      job.pid = child.pid || null;
      await done;
      if (job.cancelRequested) break;
      const st = await fs.promises.stat(dest);
      item.ok = true;
      item.size = st.size;
      okCount += 1;
      job.artifacts.push({
        name: path.basename(dest),
        size: st.size,
        path: dest,
        mime: preset.ext === "webm" ? "video/webm" : "video/mp4",
      });
    } catch (err) {
      item.error = err.message || String(err);
      failCount += 1;
    }
    job.items.push(item);
  }

  touchJob(job, {
    progress: job.cancelRequested ? iSafe(job.items.length, total) : 1,
    message: job.cancelRequested
      ? `已取消 · 成功 ${okCount} · 失败 ${failCount}`
      : `完成 · 成功 ${okCount} · 失败 ${failCount}`,
    meta: { ...job.meta, okCount, failCount, outDir },
  });
  if (!okCount && failCount) throw new Error(job.items.find((x) => x.error)?.error || "全部失败");
}

function cancelJob(job) {
  job.cancelRequested = true;
  if (job.child && !job.child.killed) {
    try {
      job.child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
  touchJob(job, { message: "正在取消…" });
  return publicJob(job);
}

function listenWithFallback(startPort, maxTries = 12) {
  return new Promise((resolve, reject) => {
    let port = startPort;
    let tries = 0;
    const server = http.createServer(handleRequest);
    const tryListen = () => {
      server.once("error", (err) => {
        if (err.code === "EADDRINUSE" && tries < maxTries) {
          tries += 1;
          port += 1;
          tryListen();
          return;
        }
        reject(err);
      });
      server.listen(port, HOST, () => resolve({ server, port }));
    };
    tryListen();
  });
}

async function handleRequest(req, res) {
  const origin = req.headers.origin || "";
  if (req.method === "OPTIONS") {
    const headers = {};
    applyCors(headers, origin);
    headers["Content-Length"] = 0;
    res.writeHead(204, headers);
    res.end();
    return;
  }

  try {
    const url = new URL(req.url || "/", `http://${HOST}`);
    const pathname = url.pathname;

    if (req.method === "GET" && pathname === "/health") {
      const [ffmpeg, ffprobe] = await Promise.all([
        checkBinary("ffmpeg", ["-version"]),
        checkBinary("ffprobe", ["-version"]),
      ]);
      sendJson(
        res,
        200,
        {
          ok: true,
          service: "devtools-ffmpeg-bridge",
          version: BRIDGE_VERSION,
          port: Number(process.env.__FF_ACTUAL_PORT || PORT),
          tokenRequired: true,
          defaultTokenHint: "devtools-ffmpeg",
          features: FEATURES,
          ffmpeg,
          ffprobe,
          tools: { ffmpeg, ffprobe },
          setup: {
            ffmpeg: ffmpeg.ok ? "" : ffmpeg.setup || "",
            ffprobe: ffprobe.ok ? "" : ffprobe.setup || "",
          },
          roots: localFsRoots(),
        },
        origin
      );
      return;
    }

    requireToken(req);

    if (req.method === "GET" && pathname === "/local/roots") {
      sendJson(res, 200, { ok: true, roots: localFsRoots() }, origin);
      return;
    }

    if (req.method === "GET" && pathname === "/local/list") {
      const data = await listLocalDir(url.searchParams.get("path") || "");
      sendJson(res, 200, data, origin);
      return;
    }

    if (req.method === "POST" && pathname === "/local/mkdir") {
      const body = parseJsonBody(await readBody(req));
      const dir = await mkdirpAllowed(body.path || body.dir || "");
      sendJson(res, 200, { ok: true, path: dir }, origin);
      return;
    }

    if (req.method === "POST" && pathname === "/probe") {
      const body = parseJsonBody(await readBody(req));
      const data = await probeMedia(body.path || "");
      sendJson(res, 200, data, origin);
      return;
    }

    if (req.method === "GET" && pathname === "/jobs") {
      const jobs = [...JOBS.values()]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 50)
        .map(publicJob);
      sendJson(res, 200, { ok: true, jobs }, origin);
      return;
    }

    if (req.method === "GET" && pathname.startsWith("/jobs/")) {
      const id = pathname.slice("/jobs/".length).split("/")[0];
      const job = JOBS.get(id);
      if (!job) {
        sendJson(res, 404, { ok: false, error: "任务不存在" }, origin);
        return;
      }
      sendJson(res, 200, { ok: true, job: publicJob(job) }, origin);
      return;
    }

    if (req.method === "POST" && /^\/jobs\/[^/]+\/cancel$/.test(pathname)) {
      const id = pathname.split("/")[2];
      const job = JOBS.get(id);
      if (!job) {
        sendJson(res, 404, { ok: false, error: "任务不存在" }, origin);
        return;
      }
      sendJson(res, 200, { ok: true, job: cancelJob(job) }, origin);
      return;
    }

    if (req.method === "POST" && pathname === "/jobs/extract-audio") {
      const body = parseJsonBody(await readBody(req));
      const files = await collectInputFiles(body.paths || [], {
        recursive: Boolean(body.recursive),
      });
      let outDir;
      if (body.createOutDir) {
        outDir = await mkdirpAllowed(body.outDir || "");
      } else {
        outDir = await ensureWritableDir(body.outDir || "");
      }
      const format = String(body.format || "mp3").toLowerCase();
      if (!["mp3", "m4a", "wav"].includes(format)) throw new Error("格式仅支持 mp3 / m4a / wav");
      const job = createJob("extract-audio", {
        format,
        bitrate: String(body.bitrate || "192k"),
        overwrite: Boolean(body.overwrite),
        recursive: Boolean(body.recursive),
        outDir,
        count: files.length,
      });
      job._files = files;
      job._outDir = outDir;
      runJobAsync(job, runExtractAudioJob);
      sendJson(res, 200, { ok: true, job: publicJob(job) }, origin);
      return;
    }

    if (req.method === "POST" && pathname === "/jobs/convert") {
      const body = parseJsonBody(await readBody(req));
      const files = await collectInputFiles(body.paths || [], {
        recursive: Boolean(body.recursive),
      });
      let outDir;
      if (body.createOutDir) {
        outDir = await mkdirpAllowed(body.outDir || "");
      } else {
        outDir = await ensureWritableDir(body.outDir || "");
      }
      const preset = String(body.preset || "mp4-fast");
      const job = createJob("convert", {
        preset,
        overwrite: Boolean(body.overwrite),
        recursive: Boolean(body.recursive),
        outDir,
        count: files.length,
      });
      job._files = files;
      job._outDir = outDir;
      runJobAsync(job, runConvertJob);
      sendJson(res, 200, { ok: true, job: publicJob(job) }, origin);
      return;
    }

    sendJson(res, 404, { ok: false, error: "未找到接口" }, origin);
  } catch (err) {
    const status = err.status || ( /未授权/.test(String(err.message)) ? 401 : 400);
    sendJson(res, status, { ok: false, error: err.message || String(err) }, origin);
  }
}

async function main() {
  const ffmpeg = await checkBinary("ffmpeg", ["-version"]);
  const { server, port } = await listenWithFallback(PORT);
  process.env.__FF_ACTUAL_PORT = String(port);
  console.log(`DevTools FFmpeg bridge v${BRIDGE_VERSION}`);
  console.log(`Listening on http://${HOST}:${port}`);
  console.log(`Token: ${TOKEN}`);
  console.log(`ffmpeg: ${ffmpeg.ok ? ffmpeg.version : "NOT FOUND — " + (ffmpeg.error || "")}`);
  console.log(`Temp: ${TMP_ROOT}`);
  if (!ffmpeg.ok) {
    console.log("提示：桥已启动，但未找到 ffmpeg。安装后无需重启即可在网页探测。");
  }

  const cleanup = () => {
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
  };
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
