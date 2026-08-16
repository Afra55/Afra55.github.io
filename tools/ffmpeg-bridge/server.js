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

const BRIDGE_VERSION = "0.4.0";
const FEATURES = [
  "local-fs",
  "probe",
  "probe-batch",
  "ops-catalog",
  "extract-audio",
  "audio-convert",
  "volume",
  "volume-keep",
  "loudnorm",
  "dynaudnorm",
  "mono",
  "stereo",
  "denoise-audio",
  "silence-trim",
  "sample-rate",
  "convert",
  "compress",
  "hevc",
  "scale",
  "fps",
  "mute",
  "crop",
  "pad",
  "blur-pad",
  "rotate",
  "flip",
  "reverse",
  "deinterlace",
  "eq",
  "sharpen",
  "blur",
  "deshake",
  "hue",
  "vignette",
  "negate",
  "speed",
  "trim",
  "cut-tail",
  "fade",
  "loop",
  "segment",
  "split-parts",
  "gif",
  "webp",
  "thumb",
  "frames",
  "waveform",
  "slideshow",
  "concat",
  "replace-audio",
  "burn-subs",
  "overlay-text",
  "strip-meta",
  "jobs",
  "job-cancel",
  "jobs-run",
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
const IMAGE_EXTS = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"]);

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
      kind:
        type === "dir"
          ? "dir"
          : VIDEO_EXTS.has(ext)
            ? "video"
            : AUDIO_EXTS.has(ext)
              ? "audio"
              : IMAGE_EXTS.has(ext)
                ? "image"
                : "file",
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

function isAudioFile(filePath) {
  return AUDIO_EXTS.has(path.extname(filePath).toLowerCase());
}

function isImageFile(filePath) {
  return IMAGE_EXTS.has(path.extname(filePath).toLowerCase());
}

function acceptsMedia(filePath, accept) {
  const a = String(accept || "video").toLowerCase();
  if (a === "audio") return isAudioFile(filePath);
  if (a === "image") return isImageFile(filePath);
  if (a === "media") return isVideoFile(filePath) || isAudioFile(filePath);
  if (a === "av") return isVideoFile(filePath) || isAudioFile(filePath);
  return isVideoFile(filePath);
}

async function collectInputFiles(paths, { recursive = false, maxFiles = 2000, accept = "video" } = {}) {
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
      if (d.isFile() && acceptsMedia(full, accept)) {
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
      if (!acceptsMedia(real, accept)) continue;
      if (!seen.has(real)) {
        seen.add(real);
        out.push(real);
      }
    }
  }
  if (!out.length) {
    const tip =
      accept === "audio"
        ? "未找到可处理的音频文件"
        : accept === "image"
          ? "未找到可处理的图片文件"
          : accept === "media" || accept === "av"
            ? "未找到可处理的音视频文件"
            : "未找到可处理的视频文件";
    throw new Error(tip);
  }
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

const AUDIO_FMT_OPTS = [
  { value: "mp3", label: "MP3" },
  { value: "m4a", label: "M4A/AAC" },
  { value: "wav", label: "WAV" },
  { value: "flac", label: "FLAC" },
  { value: "ogg", label: "OGG" },
  { value: "opus", label: "Opus" },
];
const BITRATE_OPTS = [
  { value: "128k", label: "128k" },
  { value: "192k", label: "192k" },
  { value: "256k", label: "256k" },
  { value: "320k", label: "320k" },
];

/** 用户可见操作目录（网页按此渲染 fields） */
const OPS_CATALOG = [
  {
    id: "extract-audio",
    label: "抽音频",
    group: "音频",
    desc: "从视频/音频抽出或转出音轨",
    accept: "media",
    fields: [
      { key: "format", type: "select", label: "格式", options: AUDIO_FMT_OPTS, default: "mp3" },
      { key: "bitrate", type: "select", label: "码率", options: BITRATE_OPTS, default: "192k" },
    ],
  },
  {
    id: "audio-convert",
    label: "音频转码",
    group: "音频",
    desc: "音频互转格式 / 码率",
    accept: "audio",
    fields: [
      { key: "format", type: "select", label: "格式", options: AUDIO_FMT_OPTS, default: "mp3" },
      { key: "bitrate", type: "select", label: "码率", options: BITRATE_OPTS, default: "192k" },
    ],
  },
  {
    id: "volume",
    label: "音量调节",
    group: "音频",
    desc: "放大 / 缩小音量后导出音频",
    accept: "media",
    fields: [
      { key: "volumePct", type: "number", label: "音量%", min: 5, max: 400, step: 5, default: 100 },
      { key: "format", type: "select", label: "格式", options: AUDIO_FMT_OPTS, default: "mp3" },
      { key: "bitrate", type: "select", label: "码率", options: BITRATE_OPTS, default: "192k" },
    ],
  },
  {
    id: "loudnorm",
    label: "响度标准化",
    group: "音频",
    desc: "EBU R128 响度对齐",
    accept: "media",
    fields: [
      { key: "format", type: "select", label: "格式", options: AUDIO_FMT_OPTS, default: "mp3" },
      { key: "bitrate", type: "select", label: "码率", options: BITRATE_OPTS, default: "192k" },
    ],
  },
  {
    id: "mono",
    label: "转单声道",
    group: "音频",
    desc: "立体声压成单声道",
    accept: "media",
    fields: [
      { key: "format", type: "select", label: "格式", options: AUDIO_FMT_OPTS, default: "mp3" },
      { key: "bitrate", type: "select", label: "码率", options: BITRATE_OPTS, default: "128k" },
    ],
  },
  {
    id: "denoise-audio",
    label: "音频降噪",
    group: "音频",
    desc: "轻量 FFT 降噪（afftdn）",
    accept: "media",
    fields: [
      { key: "format", type: "select", label: "格式", options: AUDIO_FMT_OPTS, default: "mp3" },
      { key: "bitrate", type: "select", label: "码率", options: BITRATE_OPTS, default: "192k" },
    ],
  },
  {
    id: "convert",
    label: "转封装/转码",
    group: "视频",
    desc: "MP4 / WebM / MKV / MOV / 流拷贝",
    accept: "video",
    fields: [
      {
        key: "preset",
        type: "select",
        label: "预设",
        options: [
          { value: "mp4-fast", label: "MP4 快速" },
          { value: "mp4-hq", label: "MP4 高清" },
          { value: "mp4-copy", label: "MP4 流拷贝" },
          { value: "webm", label: "WebM VP9" },
          { value: "mkv", label: "MKV" },
          { value: "mov", label: "MOV" },
        ],
        default: "mp4-fast",
      },
    ],
  },
  {
    id: "compress",
    label: "压缩体积",
    group: "视频",
    desc: "按清晰度档位压体积（H.264）",
    accept: "video",
    fields: [
      {
        key: "compress",
        type: "select",
        label: "档位",
        options: [
          { value: "low", label: "轻度（更清晰）" },
          { value: "medium", label: "均衡" },
          { value: "high", label: "强压（更小）" },
        ],
        default: "medium",
      },
    ],
  },
  {
    id: "hevc",
    label: "转 H.265",
    group: "视频",
    desc: "HEVC 更小体积（兼容性略差）",
    accept: "video",
    fields: [
      {
        key: "hevcCrf",
        type: "select",
        label: "质量 CRF",
        options: [
          { value: "24", label: "24 较清晰" },
          { value: "28", label: "28 均衡" },
          { value: "32", label: "32 更小" },
        ],
        default: "28",
      },
    ],
  },
  {
    id: "scale",
    label: "改分辨率",
    group: "视频",
    desc: "按高度等比缩放",
    accept: "video",
    fields: [
      {
        key: "height",
        type: "select",
        label: "高度",
        options: [
          { value: "360", label: "360p" },
          { value: "480", label: "480p" },
          { value: "720", label: "720p" },
          { value: "1080", label: "1080p" },
          { value: "1440", label: "1440p" },
          { value: "2160", label: "2160p" },
        ],
        default: "720",
      },
    ],
  },
  {
    id: "fps",
    label: "改帧率",
    group: "视频",
    desc: "统一输出帧率",
    accept: "video",
    fields: [
      {
        key: "fps",
        type: "select",
        label: "帧率",
        options: [
          { value: "24", label: "24" },
          { value: "25", label: "25" },
          { value: "30", label: "30" },
          { value: "50", label: "50" },
          { value: "60", label: "60" },
        ],
        default: "30",
      },
    ],
  },
  {
    id: "mute",
    label: "去音轨",
    group: "视频",
    desc: "导出无声视频",
    accept: "video",
    fields: [],
  },
  {
    id: "crop",
    label: "裁剪画面",
    group: "画面",
    desc: "按宽高比中心裁剪",
    accept: "video",
    fields: [
      {
        key: "cropRatio",
        type: "select",
        label: "比例",
        options: [
          { value: "1:1", label: "1:1" },
          { value: "4:3", label: "4:3" },
          { value: "16:9", label: "16:9" },
          { value: "9:16", label: "9:16" },
          { value: "4:5", label: "4:5" },
        ],
        default: "1:1",
      },
    ],
  },
  {
    id: "pad",
    label: "补黑边",
    group: "画面",
    desc: "加黑边贴合目标比例",
    accept: "video",
    fields: [
      {
        key: "padRatio",
        type: "select",
        label: "目标比例",
        options: [
          { value: "16:9", label: "16:9" },
          { value: "9:16", label: "9:16" },
          { value: "1:1", label: "1:1" },
          { value: "4:3", label: "4:3" },
        ],
        default: "16:9",
      },
    ],
  },
  {
    id: "rotate",
    label: "旋转",
    group: "画面",
    desc: "90° / 180° / 270°",
    accept: "video",
    fields: [
      {
        key: "rotate",
        type: "select",
        label: "角度",
        options: [
          { value: "90", label: "顺时针 90°" },
          { value: "180", label: "180°" },
          { value: "270", label: "逆时针 90°" },
        ],
        default: "90",
      },
    ],
  },
  {
    id: "flip",
    label: "翻转",
    group: "画面",
    desc: "水平 / 垂直镜像",
    accept: "video",
    fields: [
      {
        key: "flip",
        type: "select",
        label: "方向",
        options: [
          { value: "h", label: "水平" },
          { value: "v", label: "垂直" },
        ],
        default: "h",
      },
    ],
  },
  {
    id: "reverse",
    label: "倒放",
    group: "画面",
    desc: "画面与音轨倒序（短片更合适）",
    accept: "video",
    fields: [],
  },
  {
    id: "deinterlace",
    label: "去隔行",
    group: "画面",
    desc: "yadif 去隔行",
    accept: "video",
    fields: [],
  },
  {
    id: "eq",
    label: "亮度对比度",
    group: "画面",
    desc: "简单色彩/亮度调节",
    accept: "video",
    fields: [
      { key: "brightness", type: "number", label: "亮度(-1~1)", min: -1, max: 1, step: 0.05, default: 0 },
      { key: "contrast", type: "number", label: "对比度", min: 0.5, max: 2, step: 0.05, default: 1 },
      { key: "saturation", type: "number", label: "饱和度", min: 0, max: 3, step: 0.1, default: 1 },
    ],
  },
  {
    id: "speed",
    label: "变速",
    group: "时间",
    desc: "快放 / 慢放（音画同步）",
    accept: "video",
    fields: [
      {
        key: "speed",
        type: "select",
        label: "倍速",
        options: [
          { value: "0.5", label: "0.5×" },
          { value: "0.75", label: "0.75×" },
          { value: "1.25", label: "1.25×" },
          { value: "1.5", label: "1.5×" },
          { value: "2", label: "2×" },
          { value: "3", label: "3×" },
          { value: "4", label: "4×" },
        ],
        default: "1.5",
      },
    ],
  },
  {
    id: "trim",
    label: "裁剪时长",
    group: "时间",
    desc: "统一截取起点 + 时长",
    accept: "media",
    fields: [
      { key: "startSec", type: "number", label: "起点(秒)", min: 0, max: 86400, step: 0.1, default: 0 },
      { key: "durationSec", type: "number", label: "时长(秒)", min: 0.2, max: 86400, step: 0.1, default: 10 },
      {
        key: "trimMode",
        type: "select",
        label: "输出",
        options: [
          { value: "video", label: "视频" },
          { value: "audio", label: "仅音频 MP3" },
        ],
        default: "video",
      },
    ],
  },
  {
    id: "fade",
    label: "淡入淡出",
    group: "时间",
    desc: "开头结尾淡化",
    accept: "video",
    fields: [
      { key: "fadeIn", type: "number", label: "淡入(秒)", min: 0, max: 30, step: 0.1, default: 1 },
      { key: "fadeOut", type: "number", label: "淡出(秒)", min: 0, max: 30, step: 0.1, default: 1 },
    ],
  },
  {
    id: "loop",
    label: "循环成片",
    group: "时间",
    desc: "把短片循环 N 次合成",
    accept: "video",
    fields: [{ key: "loops", type: "number", label: "循环次数", min: 2, max: 50, step: 1, default: 3 }],
  },
  {
    id: "gif",
    label: "转 GIF",
    group: "动图",
    desc: "调色板高质量动图",
    accept: "video",
    fields: [
      { key: "gifFps", type: "number", label: "帧率", min: 5, max: 30, step: 1, default: 10 },
      { key: "gifWidth", type: "number", label: "宽度", min: 120, max: 1280, step: 10, default: 480 },
    ],
  },
  {
    id: "thumb",
    label: "截封面",
    group: "截取",
    desc: "导出单张封面图",
    accept: "video",
    fields: [{ key: "atSec", type: "number", label: "时间点(秒)", min: 0, max: 86400, step: 0.1, default: 1 }],
  },
  {
    id: "frames",
    label: "按间隔截帧",
    group: "截取",
    desc: "每隔 N 秒存一张图到子文件夹",
    accept: "video",
    fields: [{ key: "everySec", type: "number", label: "间隔(秒)", min: 0.5, max: 600, step: 0.5, default: 5 }],
  },
  {
    id: "concat",
    label: "拼接成片",
    group: "合成",
    desc: "按勾选顺序合成一个视频",
    accept: "video",
    fields: [],
  },
  {
    id: "replace-audio",
    label: "替换音轨",
    group: "合成",
    desc: "用所选音频替换视频音轨（勾选：多个视频 + 1 个音频）",
    accept: "av",
    fields: [],
  },
  {
    id: "slideshow",
    label: "图片幻灯片",
    group: "合成",
    desc: "多张图片合成视频",
    accept: "image",
    fields: [
      { key: "holdSec", type: "number", label: "每张秒数", min: 0.3, max: 30, step: 0.1, default: 2 },
      {
        key: "slideSize",
        type: "select",
        label: "画幅",
        options: [
          { value: "1280x720", label: "1280×720" },
          { value: "1920x1080", label: "1920×1080" },
          { value: "1080x1920", label: "1080×1920" },
          { value: "1080x1080", label: "1080×1080" },
        ],
        default: "1280x720",
      },
    ],
  },
  {
    id: "burn-subs",
    label: "烧录字幕",
    group: "合成",
    desc: "烧录同名 .srt/.ass（需放在视频旁）",
    accept: "video",
    fields: [],
  },
  {
    id: "overlay-text",
    label: "文字水印",
    group: "合成",
    desc: "烧录简单文字（需系统字体）",
    accept: "video",
    fields: [
      { key: "text", type: "text", label: "文字", default: "DevTools" },
      {
        key: "textPos",
        type: "select",
        label: "位置",
        options: [
          { value: "br", label: "右下" },
          { value: "bl", label: "左下" },
          { value: "tr", label: "右上" },
          { value: "tl", label: "左上" },
          { value: "c", label: "居中" },
        ],
        default: "br",
      },
      { key: "fontSize", type: "number", label: "字号", min: 12, max: 96, step: 1, default: 28 },
    ],
  },
  {
    id: "strip-meta",
    label: "清除元数据",
    group: "工具",
    desc: "去掉标题/作者等元信息（流拷贝）",
    accept: "media",
    fields: [],
  },
  {
    id: "volume-keep",
    label: "视频音量",
    group: "音频",
    desc: "调音量但保留画面",
    accept: "video",
    fields: [{ key: "volumePct", type: "number", label: "音量%", min: 5, max: 400, step: 5, default: 100 }],
  },
  {
    id: "dynaudnorm",
    label: "动态响度",
    group: "音频",
    desc: "dynaudnorm 平滑响度",
    accept: "media",
    fields: [
      { key: "format", type: "select", label: "格式", options: AUDIO_FMT_OPTS, default: "mp3" },
      { key: "bitrate", type: "select", label: "码率", options: BITRATE_OPTS, default: "192k" },
    ],
  },
  {
    id: "stereo",
    label: "转立体声",
    group: "音频",
    desc: "强制双声道输出",
    accept: "media",
    fields: [
      { key: "format", type: "select", label: "格式", options: AUDIO_FMT_OPTS, default: "mp3" },
      { key: "bitrate", type: "select", label: "码率", options: BITRATE_OPTS, default: "192k" },
    ],
  },
  {
    id: "silence-trim",
    label: "掐头去尾静音",
    group: "音频",
    desc: "去掉开头结尾静音段",
    accept: "media",
    fields: [
      { key: "format", type: "select", label: "格式", options: AUDIO_FMT_OPTS, default: "mp3" },
      { key: "bitrate", type: "select", label: "码率", options: BITRATE_OPTS, default: "192k" },
    ],
  },
  {
    id: "sample-rate",
    label: "改采样率",
    group: "音频",
    desc: "重采样到指定 Hz",
    accept: "media",
    fields: [
      {
        key: "sampleRate",
        type: "select",
        label: "采样率",
        options: [
          { value: "22050", label: "22050" },
          { value: "44100", label: "44100" },
          { value: "48000", label: "48000" },
        ],
        default: "44100",
      },
      { key: "format", type: "select", label: "格式", options: AUDIO_FMT_OPTS, default: "mp3" },
      { key: "bitrate", type: "select", label: "码率", options: BITRATE_OPTS, default: "192k" },
    ],
  },
  {
    id: "sharpen",
    label: "锐化",
    group: "画面",
    desc: "unsharp 轻度锐化",
    accept: "video",
    fields: [],
  },
  {
    id: "blur",
    label: "模糊",
    group: "画面",
    desc: "整幅高斯模糊",
    accept: "video",
    fields: [
      {
        key: "blurStrength",
        type: "select",
        label: "强度",
        options: [
          { value: "3", label: "轻" },
          { value: "8", label: "中" },
          { value: "15", label: "重" },
        ],
        default: "8",
      },
    ],
  },
  {
    id: "deshake",
    label: "防抖",
    group: "画面",
    desc: "deshake 简易防抖",
    accept: "video",
    fields: [],
  },
  {
    id: "hue",
    label: "色相偏移",
    group: "画面",
    desc: "整体色相旋转",
    accept: "video",
    fields: [{ key: "hueDeg", type: "number", label: "色相°", min: -180, max: 180, step: 5, default: 30 }],
  },
  {
    id: "vignette",
    label: "暗角",
    group: "画面",
    desc: "添加 vignette 暗角",
    accept: "video",
    fields: [],
  },
  {
    id: "negate",
    label: "负片",
    group: "画面",
    desc: "颜色反相",
    accept: "video",
    fields: [],
  },
  {
    id: "blur-pad",
    label: "模糊铺底",
    group: "画面",
    desc: "竖屏/方屏：中间原片 + 模糊背景（短视频常用）",
    accept: "video",
    fields: [
      {
        key: "blurPadSize",
        type: "select",
        label: "目标画幅",
        options: [
          { value: "1080x1920", label: "9:16 1080×1920" },
          { value: "1080x1080", label: "1:1 1080×1080" },
          { value: "1920x1080", label: "16:9 1920×1080" },
        ],
        default: "1080x1920",
      },
    ],
  },
  {
    id: "cut-tail",
    label: "保留片尾",
    group: "时间",
    desc: "只保留最后 N 秒",
    accept: "video",
    fields: [{ key: "tailSec", type: "number", label: "秒数", min: 0.5, max: 3600, step: 0.5, default: 10 }],
  },
  {
    id: "segment",
    label: "按时长切片",
    group: "时间",
    desc: "每 N 秒切成一段（流拷贝优先）",
    accept: "video",
    fields: [{ key: "segmentSec", type: "number", label: "每段秒数", min: 1, max: 3600, step: 1, default: 60 }],
  },
  {
    id: "split-parts",
    label: "均分 N 段",
    group: "时间",
    desc: "按总时长均分成 N 个文件",
    accept: "video",
    fields: [{ key: "parts", type: "number", label: "段数", min: 2, max: 30, step: 1, default: 3 }],
  },
  {
    id: "webp",
    label: "转动态 WebP",
    group: "动图",
    desc: "导出动画 WebP",
    accept: "video",
    fields: [
      { key: "webpFps", type: "number", label: "帧率", min: 5, max: 30, step: 1, default: 10 },
      { key: "webpWidth", type: "number", label: "宽度", min: 120, max: 1280, step: 10, default: 480 },
    ],
  },
  {
    id: "waveform",
    label: "音频波形视频",
    group: "动图",
    desc: "把音频做成波形可视化视频",
    accept: "audio",
    fields: [
      {
        key: "waveSize",
        type: "select",
        label: "分辨率",
        options: [
          { value: "1280x720", label: "1280×720" },
          { value: "1920x1080", label: "1920×1080" },
          { value: "1080x1080", label: "1080×1080" },
        ],
        default: "1280x720",
      },
    ],
  },
];

// NOTE: catalog ends above; legacy concat/overlay already redefined — remove duplicates below if any

function audioArgsForFormat(fmt, bitrate) {
  const f = String(fmt || "mp3").toLowerCase();
  const br = String(bitrate || "192k");
  if (f === "wav") return { ext: "wav", mime: "audio/wav", args: ["-vn", "-c:a", "pcm_s16le", "-ar", "44100", "-ac", "2"] };
  if (f === "flac") return { ext: "flac", mime: "audio/flac", args: ["-vn", "-c:a", "flac"] };
  if (f === "ogg") return { ext: "ogg", mime: "audio/ogg", args: ["-vn", "-c:a", "libvorbis", "-q:a", "5"] };
  if (f === "opus") return { ext: "opus", mime: "audio/opus", args: ["-vn", "-c:a", "libopus", "-b:a", br] };
  if (f === "m4a") return { ext: "m4a", mime: "audio/mp4", args: ["-vn", "-c:a", "aac", "-b:a", br] };
  return { ext: "mp3", mime: "audio/mpeg", args: ["-vn", "-c:a", "libmp3lame", "-b:a", br] };
}

function atempoChain(speed) {
  let s = Number(speed) || 1;
  if (!(s > 0)) s = 1;
  const filters = [];
  // atempo 仅支持 0.5–2.0，链式拼接
  while (s > 2.0001) {
    filters.push("atempo=2.0");
    s /= 2;
  }
  while (s < 0.5 - 1e-9) {
    filters.push("atempo=0.5");
    s /= 0.5;
  }
  filters.push(`atempo=${Math.max(0.5, Math.min(2, s)).toFixed(4)}`);
  return filters.join(",");
}

function even(n) {
  const x = Math.max(2, Math.round(Number(n) || 2));
  return x % 2 === 0 ? x : x - 1;
}

function defaultFontPath() {
  const candidates = [
    "/System/Library/Fonts/PingFang.ttc",
    "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
    "/Library/Fonts/Arial Unicode.ttf",
    "C:\\Windows\\Fonts\\msyh.ttc",
    "C:\\Windows\\Fonts\\msyh.ttf",
    "C:\\Windows\\Fonts\\arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc",
  ];
  for (const f of candidates) {
    try {
      if (fs.existsSync(f)) return f;
    } catch {
      /* ignore */
    }
  }
  return "";
}

function parseRatio(s, fallbackW = 16, fallbackH = 9) {
  const m = String(s || "").match(/^(\d+(?:\.\d+)?)\s*[:/]\s*(\d+(?:\.\d+)?)$/);
  if (!m) return { w: fallbackW, h: fallbackH };
  return { w: Number(m[1]), h: Number(m[2]) };
}

function escapeDrawtext(text) {
  return String(text || "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/%/g, "\\%")
    .replace(/\n/g, " ");
}

/**
 * @returns {{ ext: string, mime: string, suffix: string, buildArgs: (src: string, dest: string) => string[][] }}
 * buildArgs returns one or more attempt arg lists (fallback chain)
 */
function planOp(op, opts = {}) {
  const id = String(op || "").toLowerCase();

  if (id === "extract-audio" || id === "audio-convert") {
    const fmt = audioArgsForFormat(opts.format, opts.bitrate);
    return {
      ext: fmt.ext,
      mime: fmt.mime,
      suffix: id === "audio-convert" ? `-a${fmt.ext}` : "",
      buildArgs: (src, dest) => {
        const attempts = [];
        if (fmt.ext === "m4a") attempts.push(["-y", "-i", src, "-vn", "-c:a", "copy", dest]);
        attempts.push(["-y", "-i", src, ...fmt.args, dest]);
        return attempts;
      },
    };
  }

  if (id === "volume") {
    const pct = Math.max(5, Math.min(400, Number(opts.volumePct) || 100));
    const vol = (pct / 100).toFixed(3);
    const fmt = audioArgsForFormat(opts.format || "mp3", opts.bitrate);
    const af = Math.abs(pct - 100) < 0.05 ? [] : ["-af", `volume=${vol}`];
    return {
      ext: fmt.ext,
      mime: fmt.mime,
      suffix: `-vol${pct}`,
      buildArgs: (src, dest) => [["-y", "-i", src, "-vn", ...af, ...fmt.args.filter((a) => a !== "-vn"), dest]],
    };
  }

  if (id === "loudnorm") {
    const fmt = audioArgsForFormat(opts.format || "mp3", opts.bitrate || "192k");
    return {
      ext: fmt.ext,
      mime: fmt.mime,
      suffix: "-loudnorm",
      buildArgs: (src, dest) => [
        ["-y", "-i", src, "-vn", "-af", "loudnorm=I=-16:TP=-1.5:LRA=11", ...fmt.args.filter((a) => a !== "-vn"), dest],
      ],
    };
  }

  if (id === "mono") {
    const fmt = audioArgsForFormat(opts.format || "mp3", opts.bitrate || "128k");
    return {
      ext: fmt.ext,
      mime: fmt.mime,
      suffix: "-mono",
      buildArgs: (src, dest) => [["-y", "-i", src, "-vn", "-ac", "1", ...fmt.args.filter((a) => a !== "-vn"), dest]],
    };
  }

  if (id === "denoise-audio") {
    const fmt = audioArgsForFormat(opts.format || "mp3", opts.bitrate || "192k");
    return {
      ext: fmt.ext,
      mime: fmt.mime,
      suffix: "-denoise",
      buildArgs: (src, dest) => [
        ["-y", "-i", src, "-vn", "-af", "afftdn=nf=-25", ...fmt.args.filter((a) => a !== "-vn"), dest],
        ["-y", "-i", src, "-vn", "-af", "highpass=f=80,lowpass=f=12000", ...fmt.args.filter((a) => a !== "-vn"), dest],
      ],
    };
  }

  if (id === "convert") {
    const p = String(opts.preset || "mp4-fast").toLowerCase();
    let ext = "mp4";
    let mime = "video/mp4";
    let args = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart"];
    if (p === "mp4-hq") {
      args = ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart"];
    } else if (p === "mp4-copy") {
      args = ["-c", "copy", "-movflags", "+faststart"];
    } else if (p === "webm") {
      ext = "webm";
      mime = "video/webm";
      args = ["-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "32", "-c:a", "libopus", "-b:a", "128k"];
    } else if (p === "mkv") {
      ext = "mkv";
      mime = "video/x-matroska";
      args = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "128k"];
    } else if (p === "mov") {
      ext = "mov";
      mime = "video/quicktime";
      args = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "128k"];
    }
    return {
      ext,
      mime,
      suffix: `-out`,
      buildArgs: (src, dest) => [["-y", "-i", src, ...args, dest]],
    };
  }

  if (id === "compress") {
    const level = String(opts.compress || "medium").toLowerCase();
    const crf = level === "high" ? "28" : level === "low" ? "20" : "23";
    const preset = level === "high" ? "veryfast" : "fast";
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: `-cmp-${level}`,
      buildArgs: (src, dest) => [
        [
          "-y",
          "-i",
          src,
          "-c:v",
          "libx264",
          "-preset",
          preset,
          "-crf",
          crf,
          "-c:a",
          "aac",
          "-b:a",
          level === "high" ? "96k" : "128k",
          "-movflags",
          "+faststart",
          dest,
        ],
      ],
    };
  }

  if (id === "hevc") {
    const crf = String(opts.hevcCrf || "28");
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: `-hevc${crf}`,
      buildArgs: (src, dest) => [
        [
          "-y",
          "-i",
          src,
          "-c:v",
          "libx265",
          "-preset",
          "medium",
          "-crf",
          crf,
          "-tag:v",
          "hvc1",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          dest,
        ],
        // fallback if libx265 missing
        [
          "-y",
          "-i",
          src,
          "-c:v",
          "libx264",
          "-preset",
          "medium",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          dest,
        ],
      ],
    };
  }

  if (id === "scale") {
    const h = even(Math.max(144, Math.min(4320, Number(opts.height) || 720)));
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: `-${h}p`,
      buildArgs: (src, dest) => [
        [
          "-y",
          "-i",
          src,
          "-vf",
          `scale=-2:${h}`,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          dest,
        ],
      ],
    };
  }

  if (id === "fps") {
    const fps = Math.max(1, Math.min(120, Number(opts.fps) || 30));
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: `-${fps}fps`,
      buildArgs: (src, dest) => [
        [
          "-y",
          "-i",
          src,
          "-r",
          String(fps),
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          dest,
        ],
      ],
    };
  }

  if (id === "mute") {
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: "-mute",
      buildArgs: (src, dest) => [
        ["-y", "-i", src, "-an", "-c:v", "copy", "-movflags", "+faststart", dest],
        ["-y", "-i", src, "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-movflags", "+faststart", dest],
      ],
    };
  }

  if (id === "crop") {
    const { w, h } = parseRatio(opts.cropRatio || "1:1", 1, 1);
    const vf = `crop=min(iw\\,ih*${w}/${h}):min(ih\\,iw*${h}/${w})`;
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: `-crop${String(opts.cropRatio || "1x1").replace(":", "x")}`,
      buildArgs: (src, dest) => [
        [
          "-y",
          "-i",
          src,
          "-vf",
          vf,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          dest,
        ],
      ],
    };
  }

  if (id === "pad") {
    const { w, h } = parseRatio(opts.padRatio || "16:9", 16, 9);
    const vf = `setsar=1,pad=max(iw\\,ih*${w}/${h}):max(ih\\,iw*${h}/${w}):(ow-iw)/2:(oh-ih)/2:black`;
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: `-pad${String(opts.padRatio || "16x9").replace(":", "x")}`,
      buildArgs: (src, dest) => [
        [
          "-y",
          "-i",
          src,
          "-vf",
          vf,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          dest,
        ],
      ],
    };
  }

  if (id === "rotate") {
    const deg = Number(opts.rotate) || 90;
    const transpose =
      deg === 180 ? "transpose=1,transpose=1" : deg === 270 ? "transpose=2" : "transpose=1";
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: `-rot${deg}`,
      buildArgs: (src, dest) => [
        [
          "-y",
          "-i",
          src,
          "-vf",
          transpose,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "copy",
          "-movflags",
          "+faststart",
          dest,
        ],
        [
          "-y",
          "-i",
          src,
          "-vf",
          transpose,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          dest,
        ],
      ],
    };
  }

  if (id === "flip") {
    const mode = String(opts.flip || "h").toLowerCase();
    const vf = mode === "v" ? "vflip" : "hflip";
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: `-flip${mode}`,
      buildArgs: (src, dest) => [
        [
          "-y",
          "-i",
          src,
          "-vf",
          vf,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "copy",
          "-movflags",
          "+faststart",
          dest,
        ],
        [
          "-y",
          "-i",
          src,
          "-vf",
          vf,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          dest,
        ],
      ],
    };
  }

  if (id === "reverse") {
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: "-rev",
      buildArgs: (src, dest) => [
        [
          "-y",
          "-i",
          src,
          "-vf",
          "reverse",
          "-af",
          "areverse",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          dest,
        ],
        [
          "-y",
          "-i",
          src,
          "-an",
          "-vf",
          "reverse",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-movflags",
          "+faststart",
          dest,
        ],
      ],
    };
  }

  if (id === "deinterlace") {
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: "-deint",
      buildArgs: (src, dest) => [
        [
          "-y",
          "-i",
          src,
          "-vf",
          "yadif=0:-1:0",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "copy",
          "-movflags",
          "+faststart",
          dest,
        ],
        [
          "-y",
          "-i",
          src,
          "-vf",
          "yadif=0:-1:0",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          dest,
        ],
      ],
    };
  }

  if (id === "eq") {
    const br = Math.max(-1, Math.min(1, Number(opts.brightness) || 0));
    const ct = Math.max(0.5, Math.min(2, Number(opts.contrast) || 1));
    const sat = Math.max(0, Math.min(3, Number(opts.saturation) || 1));
    const vf = `eq=brightness=${br}:contrast=${ct}:saturation=${sat}`;
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: "-eq",
      buildArgs: (src, dest) => [
        [
          "-y",
          "-i",
          src,
          "-vf",
          vf,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "copy",
          "-movflags",
          "+faststart",
          dest,
        ],
        [
          "-y",
          "-i",
          src,
          "-vf",
          vf,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          dest,
        ],
      ],
    };
  }

  if (id === "speed") {
    const speed = Math.max(0.25, Math.min(4, Number(opts.speed) || 1.5));
    const setpts = (1 / speed).toFixed(6);
    const atempo = atempoChain(speed);
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: `-spd${String(speed).replace(".", "_")}`,
      buildArgs: (src, dest) => [
        [
          "-y",
          "-i",
          src,
          "-filter_complex",
          `[0:v]setpts=${setpts}*PTS[v];[0:a]${atempo}[a]`,
          "-map",
          "[v]",
          "-map",
          "[a]",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          dest,
        ],
        // no audio fallback
        [
          "-y",
          "-i",
          src,
          "-an",
          "-filter:v",
          `setpts=${setpts}*PTS`,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-movflags",
          "+faststart",
          dest,
        ],
      ],
    };
  }

  if (id === "trim") {
    const start = Math.max(0, Number(opts.startSec) || 0);
    const dur = Math.max(0.2, Number(opts.durationSec) || 10);
    const mode = String(opts.trimMode || "video").toLowerCase();
    if (mode === "audio") {
      const fmt = audioArgsForFormat("mp3", "192k");
      return {
        ext: fmt.ext,
        mime: fmt.mime,
        suffix: "-cut",
        buildArgs: (src, dest) => [["-y", "-ss", String(start), "-t", String(dur), "-i", src, ...fmt.args, dest]],
      };
    }
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: `-cut`,
      buildArgs: (src, dest) => [
        ["-y", "-ss", String(start), "-t", String(dur), "-i", src, "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", dest],
        [
          "-y",
          "-ss",
          String(start),
          "-t",
          String(dur),
          "-i",
          src,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          dest,
        ],
      ],
    };
  }

  if (id === "fade") {
    const fin = Math.max(0, Number(opts.fadeIn) || 1);
    const fout = Math.max(0, Number(opts.fadeOut) || 1);
    // st for fade out needs duration; use approximate via fade=t=out:st=999999 workaround — better probe per file in runner
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: "-fade",
      needsDuration: true,
      fadeIn: fin,
      fadeOut: fout,
      buildArgs: (src, dest, meta = {}) => {
        const dur = Number(meta.duration) || 0;
        const foStart = Math.max(0, dur - fout);
        const vf = [];
        const af = [];
        if (fin > 0) {
          vf.push(`fade=t=in:st=0:d=${fin}`);
          af.push(`afade=t=in:st=0:d=${fin}`);
        }
        if (fout > 0 && dur > fout) {
          vf.push(`fade=t=out:st=${foStart}:d=${fout}`);
          af.push(`afade=t=out:st=${foStart}:d=${fout}`);
        }
        const args = ["-y", "-i", src];
        if (vf.length) args.push("-vf", vf.join(","));
        if (af.length) args.push("-af", af.join(","));
        args.push(
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          dest
        );
        return [args];
      },
    };
  }

  if (id === "gif") {
    const fps = Math.max(5, Math.min(30, Number(opts.gifFps) || 10));
    const width = even(Math.max(120, Math.min(1280, Number(opts.gifWidth) || 480)));
    return {
      ext: "gif",
      mime: "image/gif",
      suffix: "",
      buildArgs: (src, dest) => [
        [
          "-y",
          "-i",
          src,
          "-vf",
          `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`,
          "-loop",
          "0",
          dest,
        ],
      ],
    };
  }

  if (id === "thumb") {
    const at = Math.max(0, Number(opts.atSec) || 1);
    return {
      ext: "jpg",
      mime: "image/jpeg",
      suffix: "-cover",
      buildArgs: (src, dest) => [["-y", "-ss", String(at), "-i", src, "-frames:v", "1", "-q:v", "2", dest]],
    };
  }

  if (id === "frames") {
    const every = Math.max(0.5, Math.min(600, Number(opts.everySec) || 5));
    return {
      ext: "jpg",
      mime: "image/jpeg",
      suffix: "-frames",
      multiPattern: true,
      multiName: "frame-%04d.jpg",
      artifactRe: /\.jpe?g$/i,
      buildArgs: (src, destPattern) => [
        ["-y", "-i", src, "-vf", `fps=1/${every}`, "-q:v", "3", destPattern],
      ],
    };
  }

  if (id === "loop") {
    const loops = Math.max(2, Math.min(50, Math.round(Number(opts.loops) || 3)));
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: `-loop${loops}`,
      buildArgs: (src, dest) => [
        [
          "-y",
          "-stream_loop",
          String(loops - 1),
          "-i",
          src,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          dest,
        ],
      ],
    };
  }

  if (id === "overlay-text") {
    const text = escapeDrawtext(opts.text || "DevTools");
    const font = defaultFontPath();
    const size = Math.max(12, Math.min(96, Number(opts.fontSize) || 28));
    const pos = String(opts.textPos || "br").toLowerCase();
    let xy = "x=w-tw-24:y=h-th-24";
    if (pos === "bl") xy = "x=24:y=h-th-24";
    else if (pos === "tr") xy = "x=w-tw-24:y=24";
    else if (pos === "tl") xy = "x=24:y=24";
    else if (pos === "c") xy = "x=(w-tw)/2:y=(h-th)/2";
    const fontPart = font ? `:fontfile=${font.replace(/\\/g, "/").replace(/:/g, "\\:")}` : "";
    const vf = `drawtext=text='${text}'${fontPart}:fontsize=${size}:fontcolor=white:borderw=2:bordercolor=black@0.6:${xy}`;
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: "-text",
      buildArgs: (src, dest) => [
        [
          "-y",
          "-i",
          src,
          "-vf",
          vf,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "copy",
          "-movflags",
          "+faststart",
          dest,
        ],
        [
          "-y",
          "-i",
          src,
          "-vf",
          vf,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          dest,
        ],
      ],
    };
  }

  if (id === "strip-meta") {
    const ext = path.extname(String(opts.__srcExt || ".mp4")).replace(/^\./, "") || "mp4";
    return {
      ext,
      mime: "application/octet-stream",
      suffix: "-nometadata",
      buildArgs: (src, dest) => {
        const outExt = path.extname(dest).toLowerCase() || path.extname(src).toLowerCase();
        return [
          ["-y", "-i", src, "-map_metadata", "-1", "-c", "copy", dest],
          ["-y", "-i", src, "-map_metadata", "-1", "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-c:a", "aac", "-b:a", "128k", dest],
        ];
      },
      // ext resolved per-file in runner via plan.extFromSrc
      extFromSrc: true,
    };
  }

  if (id === "volume-keep") {
    const pct = Math.max(5, Math.min(400, Number(opts.volumePct) || 100));
    const vol = (pct / 100).toFixed(3);
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: `-vvol${pct}`,
      buildArgs: (src, dest) => [
        [
          "-y",
          "-i",
          src,
          "-af",
          `volume=${vol}`,
          "-c:v",
          "copy",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          dest,
        ],
        [
          "-y",
          "-i",
          src,
          "-af",
          `volume=${vol}`,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          dest,
        ],
      ],
    };
  }

  if (id === "dynaudnorm") {
    const fmt = audioArgsForFormat(opts.format || "mp3", opts.bitrate || "192k");
    return {
      ext: fmt.ext,
      mime: fmt.mime,
      suffix: "-dynnorm",
      buildArgs: (src, dest) => [
        ["-y", "-i", src, "-vn", "-af", "dynaudnorm", ...fmt.args.filter((a) => a !== "-vn"), dest],
      ],
    };
  }

  if (id === "stereo") {
    const fmt = audioArgsForFormat(opts.format || "mp3", opts.bitrate || "192k");
    return {
      ext: fmt.ext,
      mime: fmt.mime,
      suffix: "-stereo",
      buildArgs: (src, dest) => [["-y", "-i", src, "-vn", "-ac", "2", ...fmt.args.filter((a) => a !== "-vn"), dest]],
    };
  }

  if (id === "silence-trim") {
    const fmt = audioArgsForFormat(opts.format || "mp3", opts.bitrate || "192k");
    return {
      ext: fmt.ext,
      mime: fmt.mime,
      suffix: "-siltrim",
      buildArgs: (src, dest) => [
        [
          "-y",
          "-i",
          src,
          "-vn",
          "-af",
          "silenceremove=start_periods=1:start_silence=0.2:start_threshold=-40dB:stop_periods=1:stop_silence=0.2:stop_threshold=-40dB",
          ...fmt.args.filter((a) => a !== "-vn"),
          dest,
        ],
      ],
    };
  }

  if (id === "sample-rate") {
    const rate = String(opts.sampleRate || "44100");
    const fmt = audioArgsForFormat(opts.format || "mp3", opts.bitrate || "192k");
    const cleaned = [];
    const raw = fmt.args.filter((a) => a !== "-vn");
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === "-ar") {
        i += 1;
        continue;
      }
      cleaned.push(raw[i]);
    }
    return {
      ext: fmt.ext,
      mime: fmt.mime,
      suffix: `-ar${rate}`,
      buildArgs: (src, dest) => [["-y", "-i", src, "-vn", "-ar", rate, ...cleaned, dest]],
    };
  }

  if (id === "sharpen") {
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: "-sharp",
      buildArgs: (src, dest) => [
        x264Args(src, dest, "unsharp=5:5:1.0:5:5:0.0"),
        x264Args(src, dest, "unsharp=5:5:1.0:5:5:0.0", true),
      ],
    };
  }

  if (id === "blur") {
    const s = Math.max(1, Math.min(30, Number(opts.blurStrength) || 8));
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: `-blur${s}`,
      buildArgs: (src, dest) => [x264Args(src, dest, `gblur=sigma=${s}`), x264Args(src, dest, `gblur=sigma=${s}`, true)],
    };
  }

  if (id === "deshake") {
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: "-deshake",
      buildArgs: (src, dest) => [x264Args(src, dest, "deshake"), x264Args(src, dest, "deshake", true)],
    };
  }

  if (id === "hue") {
    const deg = Math.max(-180, Math.min(180, Number(opts.hueDeg) || 30));
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: `-hue${deg}`,
      buildArgs: (src, dest) => [x264Args(src, dest, `hue=h=${deg}`), x264Args(src, dest, `hue=h=${deg}`, true)],
    };
  }

  if (id === "vignette") {
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: "-vig",
      buildArgs: (src, dest) => [x264Args(src, dest, "vignette"), x264Args(src, dest, "vignette", true)],
    };
  }

  if (id === "negate") {
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: "-neg",
      buildArgs: (src, dest) => [x264Args(src, dest, "negate"), x264Args(src, dest, "negate", true)],
    };
  }

  if (id === "blur-pad") {
    const size = String(opts.blurPadSize || "1080x1920");
    const [W, H] = size.split("x").map((n) => even(Number(n) || 1080));
    const fc = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},gblur=sigma=20[bg];[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2`;
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: `-blurpad${W}x${H}`,
      buildArgs: (src, dest) => [
        [
          "-y",
          "-i",
          src,
          "-filter_complex",
          fc,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          dest,
        ],
      ],
    };
  }

  if (id === "cut-tail") {
    const tail = Math.max(0.5, Number(opts.tailSec) || 10);
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: `-tail${Math.round(tail)}`,
      needsDuration: true,
      buildArgs: (src, dest, meta = {}) => {
        const dur = Number(meta.duration) || 0;
        const start = Math.max(0, dur - tail);
        return [
          ["-y", "-ss", String(start), "-i", src, "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", dest],
          [
            "-y",
            "-ss",
            String(start),
            "-i",
            src,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            dest,
          ],
        ];
      },
    };
  }

  if (id === "segment") {
    const sec = Math.max(1, Math.min(3600, Number(opts.segmentSec) || 60));
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: `-seg${sec}`,
      multiPattern: true,
      multiName: "part-%03d.mp4",
      artifactRe: /\.mp4$/i,
      buildArgs: (src, destPattern) => [
        ["-y", "-i", src, "-c", "copy", "-map", "0", "-f", "segment", "-segment_time", String(sec), "-reset_timestamps", "1", destPattern],
        [
          "-y",
          "-i",
          src,
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-f",
          "segment",
          "-segment_time",
          String(sec),
          "-reset_timestamps",
          "1",
          destPattern,
        ],
      ],
    };
  }

  if (id === "webp") {
    const fps = Math.max(5, Math.min(30, Number(opts.webpFps) || 10));
    const width = even(Math.max(120, Math.min(1280, Number(opts.webpWidth) || 480)));
    return {
      ext: "webp",
      mime: "image/webp",
      suffix: "",
      buildArgs: (src, dest) => [
        ["-y", "-i", src, "-vf", `fps=${fps},scale=${width}:-1:flags=lanczos`, "-loop", "0", "-an", dest],
      ],
    };
  }

  if (id === "waveform") {
    const size = String(opts.waveSize || "1280x720");
    const [W, H] = size.split("x").map((n) => even(Number(n) || 720));
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: "-wave",
      buildArgs: (src, dest) => [
        [
          "-y",
          "-i",
          src,
          "-filter_complex",
          `showwaves=s=${W}x${H}:mode=cline:rate=25:colors=0x2ec4b6`,
          "-c:v",
          "libx264",
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-shortest",
          "-movflags",
          "+faststart",
          dest,
        ],
      ],
    };
  }

  if (id === "burn-subs") {
    return {
      ext: "mp4",
      mime: "video/mp4",
      suffix: "-sub",
      buildArgs: (src, dest) => {
        const base = src.replace(/\.[^.]+$/, "");
        const candidates = [`${base}.srt`, `${base}.ass`, `${base}.vtt`];
        const sub = candidates.find((p) => fs.existsSync(p));
        if (!sub) throw new Error(`未找到字幕文件（需要 ${path.basename(base)}.srt/.ass/.vtt）`);
        const escaped = sub.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
        const vf = `subtitles='${escaped}'`;
        return [
          [
            "-y",
            "-i",
            src,
            "-vf",
            vf,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-c:a",
            "copy",
            "-movflags",
            "+faststart",
            dest,
          ],
          [
            "-y",
            "-i",
            src,
            "-vf",
            vf,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            dest,
          ],
        ];
      },
    };
  }

  // special ops handled by dedicated runners
  if (id === "split-parts" || id === "replace-audio" || id === "slideshow") {
    return { ext: "mp4", mime: "video/mp4", suffix: "", buildArgs: () => [], special: id };
  }

  throw new Error(`未知操作: ${id}`);
}

function x264Args(src, dest, vf, reencodeAudio = false) {
  const args = ["-y", "-i", src, "-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "23"];
  if (reencodeAudio) args.push("-c:a", "aac", "-b:a", "128k");
  else args.push("-c:a", "copy");
  args.push("-movflags", "+faststart", dest);
  return args;
}

async function probeDuration(filePath) {
  try {
    const info = await probeMedia(filePath);
    return Number(info.duration) || 0;
  } catch {
    return 0;
  }
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

function iSafe(n, total) {
  return total ? Math.min(0.99, n / total) : 0;
}

async function runOneAttempt(job, attempts) {
  let lastErr = null;
  for (const args of attempts) {
    if (job.cancelRequested) break;
    try {
      const { child, done } = spawnFfmpeg(args);
      job.child = child;
      job.pid = child.pid || null;
      await done;
      return;
    } catch (err) {
      lastErr = err;
    }
  }
  if (lastErr) throw lastErr;
  throw new Error("已取消");
}

async function runBatchOpJob(job) {
  const files = job._files;
  const outDir = job._outDir;
  const plan = job._plan;
  const overwrite = Boolean(job.meta.overwrite);
  const total = files.length;
  let okCount = 0;
  let failCount = 0;
  const label = job.meta.opLabel || job.type;
  const artRe = plan.artifactRe || /\.(jpe?g|mp4|png|webp)$/i;

  for (let i = 0; i < files.length; i++) {
    if (job.cancelRequested) break;
    const src = files[i];
    const base = path.basename(src, path.extname(src)) + (plan.suffix || "");
    touchJob(job, {
      progress: i / total,
      message: `${label} ${i + 1}/${total} · ${path.basename(src)}`,
    });
    const item = { src, dest: "", ok: false, error: "" };
    try {
      let dest;
      let attempts;
      const ext = plan.extFromSrc ? path.extname(src).replace(/^\./, "") || plan.ext : plan.ext;
      if (plan.multiPattern) {
        const folder = path.join(outDir, `${base}-parts`);
        await fs.promises.mkdir(folder, { recursive: true });
        dest = path.join(folder, plan.multiName || "frame-%04d.jpg");
        item.dest = folder;
        const meta = plan.needsDuration ? { duration: await probeDuration(src) } : {};
        attempts = plan.buildArgs(src, dest, meta);
      } else {
        dest = await uniqueOutPath(outDir, base.replace(/\.$/, "") || "out", ext, overwrite);
        item.dest = dest;
        const meta = plan.needsDuration ? { duration: await probeDuration(src) } : {};
        attempts = plan.buildArgs(src, dest, meta);
      }

      let succeeded = false;
      for (let a = 0; a < attempts.length; a++) {
        if (job.cancelRequested) break;
        try {
          const { child, done } = spawnFfmpeg(attempts[a]);
          job.child = child;
          job.pid = child.pid || null;
          await done;
          succeeded = true;
          break;
        } catch (err) {
          if (!plan.multiPattern) {
            try {
              if (item.dest && fs.existsSync(item.dest)) await fs.promises.unlink(item.dest);
            } catch {
              /* ignore */
            }
          }
          if (a === attempts.length - 1) throw err;
        }
      }
      if (job.cancelRequested) break;
      if (!succeeded) throw new Error("导出失败");

      if (plan.multiPattern) {
        const folder = item.dest;
        const names = (await fs.promises.readdir(folder)).filter((n) => artRe.test(n));
        if (!names.length) throw new Error("未生成切片文件");
        let size = 0;
        for (const n of names) {
          try {
            size += (await fs.promises.stat(path.join(folder, n))).size;
          } catch {
            /* ignore */
          }
        }
        item.ok = true;
        item.size = size;
        okCount += 1;
        job.artifacts.push({ name: path.basename(folder), size, path: folder, mime: "inode/directory" });
      } else {
        const st = await fs.promises.stat(item.dest);
        item.ok = true;
        item.size = st.size;
        okCount += 1;
        job.artifacts.push({
          name: path.basename(item.dest),
          size: st.size,
          path: item.dest,
          mime: plan.mime,
        });
      }
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

async function runReplaceAudioJob(job) {
  const videos = job._files.filter(isVideoFile);
  const audio = job._audioPath;
  if (!audio) throw new Error("请同时勾选一个音频文件作为新音轨");
  if (!videos.length) throw new Error("请勾选至少一个视频");
  const outDir = job._outDir;
  const overwrite = Boolean(job.meta.overwrite);
  let okCount = 0;
  let failCount = 0;
  for (let i = 0; i < videos.length; i++) {
    if (job.cancelRequested) break;
    const src = videos[i];
    touchJob(job, { progress: i / videos.length, message: `替换音轨 ${i + 1}/${videos.length}` });
    const dest = await uniqueOutPath(outDir, path.basename(src, path.extname(src)) + "-reaudio", "mp4", overwrite);
    const item = { src, dest, ok: false, error: "" };
    try {
      await runOneAttempt(job, [
        ["-y", "-i", src, "-i", audio, "-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy", "-c:a", "aac", "-b:a", "128k", "-shortest", "-movflags", "+faststart", dest],
        [
          "-y",
          "-i",
          src,
          "-i",
          audio,
          "-map",
          "0:v:0",
          "-map",
          "1:a:0",
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-shortest",
          "-movflags",
          "+faststart",
          dest,
        ],
      ]);
      const st = await fs.promises.stat(dest);
      item.ok = true;
      item.size = st.size;
      okCount += 1;
      job.artifacts.push({ name: path.basename(dest), size: st.size, path: dest, mime: "video/mp4" });
    } catch (err) {
      item.error = err.message || String(err);
      failCount += 1;
    }
    job.items.push(item);
  }
  touchJob(job, {
    progress: 1,
    message: `完成 · 成功 ${okCount} · 失败 ${failCount}`,
    meta: { ...job.meta, okCount, failCount, outDir },
  });
  if (!okCount) throw new Error(job.items.find((x) => x.error)?.error || "替换音轨失败");
}

async function runSplitPartsJob(job) {
  const files = job._files;
  const parts = Math.max(2, Math.min(30, Math.round(Number(job._parts) || 3)));
  const outDir = job._outDir;
  const overwrite = Boolean(job.meta.overwrite);
  let okCount = 0;
  let failCount = 0;
  for (let i = 0; i < files.length; i++) {
    if (job.cancelRequested) break;
    const src = files[i];
    const dur = await probeDuration(src);
    if (!(dur > 0.5)) {
      failCount += 1;
      job.items.push({ src, dest: "", ok: false, error: "无法读取时长" });
      continue;
    }
    const slice = dur / parts;
    const folder = path.join(outDir, `${path.basename(src, path.extname(src))}-parts${parts}`);
    await fs.promises.mkdir(folder, { recursive: true });
    let partOk = 0;
    for (let p = 0; p < parts; p++) {
      if (job.cancelRequested) break;
      const start = p * slice;
      const len = p === parts - 1 ? Math.max(0.2, dur - start) : slice;
      const dest = path.join(folder, `part-${String(p + 1).padStart(2, "0")}.mp4`);
      touchJob(job, {
        progress: (i + p / parts) / files.length,
        message: `均分 ${i + 1}/${files.length} · 第 ${p + 1}/${parts} 段`,
      });
      try {
        if (fs.existsSync(dest) && !overwrite) {
          /* keep */
        } else {
          await runOneAttempt(job, [
            ["-y", "-ss", String(start), "-t", String(len), "-i", src, "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", dest],
            [
              "-y",
              "-ss",
              String(start),
              "-t",
              String(len),
              "-i",
              src,
              "-c:v",
              "libx264",
              "-preset",
              "veryfast",
              "-crf",
              "23",
              "-c:a",
              "aac",
              "-b:a",
              "128k",
              "-movflags",
              "+faststart",
              dest,
            ],
          ]);
        }
        partOk += 1;
      } catch (err) {
        job.items.push({ src, dest, ok: false, error: err.message || String(err) });
      }
    }
    if (partOk) {
      okCount += 1;
      job.artifacts.push({ name: path.basename(folder), size: 0, path: folder, mime: "inode/directory" });
      job.items.push({ src, dest: folder, ok: true, size: 0 });
    } else failCount += 1;
  }
  touchJob(job, {
    progress: 1,
    message: `完成 · 成功 ${okCount} · 失败 ${failCount}`,
    meta: { ...job.meta, okCount, failCount, outDir },
  });
  if (!okCount) throw new Error("均分失败");
}

async function runSlideshowJob(job) {
  const files = job._files;
  if (!files.length) throw new Error("请勾选图片");
  const hold = Math.max(0.3, Math.min(30, Number(job._holdSec) || 2));
  const size = String(job._slideSize || "1280x720");
  const [W, H] = size.split("x").map((n) => even(Number(n) || 720));
  const outDir = job._outDir;
  const overwrite = Boolean(job.meta.overwrite);
  const listFile = path.join(TMP_ROOT, `slide-${job.id}.txt`);
  const lines = [];
  for (const f of files) {
    const esc = String(f).replace(/'/g, `'\\''`);
    lines.push(`file '${esc}'`);
    lines.push(`duration ${hold}`);
  }
  // concat demuxer needs last file repeated without duration for stills
  const last = String(files[files.length - 1]).replace(/'/g, `'\\''`);
  lines.push(`file '${last}'`);
  await fs.promises.writeFile(listFile, lines.join("\n"), "utf8");
  const dest = await uniqueOutPath(outDir, `slideshow-${Date.now()}`, "mp4", overwrite);
  touchJob(job, { progress: 0.2, message: `幻灯片 ${files.length} 张…` });
  try {
    await runOneAttempt(job, [
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listFile,
        "-vf",
        `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=30`,
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        dest,
      ],
    ]);
    const st = await fs.promises.stat(dest);
    job.items.push({ src: files.join(" + "), dest, ok: true, size: st.size });
    job.artifacts.push({ name: path.basename(dest), size: st.size, path: dest, mime: "video/mp4" });
    touchJob(job, { progress: 1, message: `幻灯片完成 · ${path.basename(dest)}`, meta: { ...job.meta, okCount: 1, failCount: 0, outDir } });
  } finally {
    try {
      await fs.promises.unlink(listFile);
    } catch {
      /* ignore */
    }
  }
}

// (batch runner above)

async function runConcatJob(job) {
  const files = job._files;
  const outDir = job._outDir;
  const overwrite = Boolean(job.meta.overwrite);
  if (files.length < 2) throw new Error("拼接至少需要 2 个文件");
  const listFile = path.join(TMP_ROOT, `concat-${job.id}.txt`);
  const lines = files.map((f) => `file '${String(f).replace(/'/g, `'\\''`)}'`);
  await fs.promises.writeFile(listFile, lines.join("\n"), "utf8");
  const dest = await uniqueOutPath(outDir, `merged-${Date.now()}`, "mp4", overwrite);
  touchJob(job, { progress: 0.1, message: `拼接 ${files.length} 个文件…` });
  const attempts = [
    ["-y", "-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", "-movflags", "+faststart", dest],
    [
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listFile,
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-crf",
      "23",
      "-c:a",
      "aac",
      "-b:a",
      "128k",
      "-movflags",
      "+faststart",
      dest,
    ],
  ];
  try {
    await runOneAttempt(job, attempts);
    const st = await fs.promises.stat(dest);
    job.items.push({ src: files.join(" + "), dest, ok: true, size: st.size });
    job.artifacts.push({ name: path.basename(dest), size: st.size, path: dest, mime: "video/mp4" });
    touchJob(job, {
      progress: 1,
      message: `拼接完成 · ${path.basename(dest)}`,
      meta: { ...job.meta, okCount: 1, failCount: 0, outDir },
    });
  } finally {
    try {
      await fs.promises.unlink(listFile);
    } catch {
      /* ignore */
    }
  }
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

async function startJobFromBody(body) {
  const op = String(body.op || body.type || "").toLowerCase();
  if (!op) throw new Error("缺少 op");
  const catalog = OPS_CATALOG.find((o) => o.id === op);
  if (!catalog && !["concat", "extract-audio", "convert"].includes(op)) {
    planOp(op, body);
  } else if (op !== "concat" && op !== "replace-audio" && op !== "slideshow" && op !== "split-parts") {
    planOp(op, body);
  }

  const accept = catalog?.accept || "video";
  const files = await collectInputFiles(body.paths || [], {
    recursive: Boolean(body.recursive),
    accept,
  });
  let outDir;
  if (body.createOutDir) outDir = await mkdirpAllowed(body.outDir || "");
  else outDir = await ensureWritableDir(body.outDir || "");

  if (op === "concat") {
    const job = createJob("concat", {
      op,
      opLabel: catalog?.label || "拼接",
      overwrite: Boolean(body.overwrite),
      recursive: Boolean(body.recursive),
      outDir,
      count: files.length,
    });
    job._files = files;
    job._outDir = outDir;
    runJobAsync(job, runConcatJob);
    return job;
  }

  if (op === "replace-audio") {
    const audio =
      (body.audioPath && (await resolveLocalPath(body.audioPath))) || files.find((f) => isAudioFile(f)) || null;
    const videos = files.filter((f) => isVideoFile(f));
    if (!audio) throw new Error("请勾选一个音频文件（或填写 audioPath）作为新音轨");
    if (!videos.length) throw new Error("请勾选至少一个视频");
    const job = createJob("replace-audio", {
      op,
      opLabel: catalog?.label || "替换音轨",
      overwrite: Boolean(body.overwrite),
      outDir,
      count: videos.length,
    });
    job._files = videos;
    job._audioPath = audio;
    job._outDir = outDir;
    runJobAsync(job, runReplaceAudioJob);
    return job;
  }

  if (op === "split-parts") {
    const job = createJob("split-parts", {
      op,
      opLabel: catalog?.label || "均分 N 段",
      overwrite: Boolean(body.overwrite),
      outDir,
      count: files.length,
      parts: Number(body.parts) || 3,
    });
    job._files = files;
    job._outDir = outDir;
    job._parts = Number(body.parts) || 3;
    runJobAsync(job, runSplitPartsJob);
    return job;
  }

  if (op === "slideshow") {
    const job = createJob("slideshow", {
      op,
      opLabel: catalog?.label || "图片幻灯片",
      overwrite: Boolean(body.overwrite),
      outDir,
      count: files.length,
    });
    job._files = files;
    job._outDir = outDir;
    job._holdSec = Number(body.holdSec) || 2;
    job._slideSize = body.slideSize || "1280x720";
    runJobAsync(job, runSlideshowJob);
    return job;
  }

  const opts = { ...body };
  if (op === "extract-audio" || op === "audio-convert") opts.format = body.format || "mp3";
  if (op === "convert") opts.preset = body.preset || "mp4-fast";

  const plan = planOp(op, opts);
  if (plan.special) throw new Error(`操作 ${op} 需要专用任务入口`);
  const job = createJob(op, {
    op,
    opLabel: catalog?.label || op,
    overwrite: Boolean(body.overwrite),
    recursive: Boolean(body.recursive),
    outDir,
    count: files.length,
    options: opts,
  });
  job._files = files;
  job._outDir = outDir;
  job._plan = plan;
  runJobAsync(job, runBatchOpJob);
  return job;
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

    if (req.method === "POST" && pathname === "/probe/batch") {
      const body = parseJsonBody(await readBody(req));
      const paths = Array.isArray(body.paths) ? body.paths.slice(0, 30) : [];
      if (!paths.length) throw new Error("请选择要探测的文件");
      const items = [];
      for (const p of paths) {
        try {
          items.push(await probeMedia(p));
        } catch (err) {
          items.push({ ok: false, path: p, error: err.message || String(err) });
        }
      }
      sendJson(res, 200, { ok: true, items }, origin);
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

    if (req.method === "GET" && pathname === "/ops") {
      sendJson(res, 200, { ok: true, ops: OPS_CATALOG, version: BRIDGE_VERSION }, origin);
      return;
    }

    if (req.method === "POST" && pathname === "/jobs/run") {
      const body = parseJsonBody(await readBody(req));
      const job = await startJobFromBody(body);
      sendJson(res, 200, { ok: true, job: publicJob(job) }, origin);
      return;
    }

    if (req.method === "POST" && pathname === "/jobs/extract-audio") {
      const body = parseJsonBody(await readBody(req));
      body.op = "extract-audio";
      const job = await startJobFromBody(body);
      sendJson(res, 200, { ok: true, job: publicJob(job) }, origin);
      return;
    }

    if (req.method === "POST" && pathname === "/jobs/convert") {
      const body = parseJsonBody(await readBody(req));
      body.op = "convert";
      const job = await startJobFromBody(body);
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
