/**
 * 原生 GIF 编码（优先 gifski，否则 ffmpeg palettegen）。
 * 挂在 ffmpeg-bridge，由统一桥 /ff 暴露。
 */
"use strict";

const { execFile, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

function whichSync(bin) {
  const pathEnv = String(process.env.PATH || "");
  const exts =
    process.platform === "win32"
      ? (String(process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean) || [".EXE"])
      : [""];
  const names = process.platform === "win32" && !/\.[a-z0-9]+$/i.test(bin) ? exts.map((e) => bin + e) : [bin];
  for (const dir of pathEnv.split(path.delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const full = path.join(dir, name);
      try {
        if (fs.existsSync(full) && fs.statSync(full).isFile()) return full;
      } catch (_) {}
    }
  }
  return "";
}

function vendorGifskiPath() {
  const base = path.join(__dirname, "vendor", "gifski");
  const exe = process.platform === "win32" ? "gifski.exe" : "gifski";
  return path.join(base, exe);
}

function findGifski() {
  const fromPath = whichSync("gifski");
  if (fromPath) return { path: fromPath, source: "path" };
  const vend = vendorGifskiPath();
  try {
    if (fs.existsSync(vend)) return { path: vend, source: "vendor" };
  } catch (_) {}
  return null;
}

function findFfmpeg() {
  return whichSync("ffmpeg") || "ffmpeg";
}

function execFileAsync(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: opts.timeout || 120000, maxBuffer: 8 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

async function probeGifski(binPath) {
  try {
    const { stdout, stderr } = await execFileAsync(binPath, ["--version"], { timeout: 8000 });
    const text = String(stdout || stderr || "").trim();
    return { ok: true, version: (text.split(/\r?\n/).find(Boolean) || text).slice(0, 120), path: binPath };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

async function status() {
  const hit = findGifski();
  const ffmpeg = findFfmpeg();
  let gifski = { ok: false, available: false };
  if (hit) {
    gifski = { ...(await probeGifski(hit.path)), available: true, source: hit.source };
  }
  let ffmpegOk = false;
  try {
    await execFileAsync(ffmpeg, ["-version"], { timeout: 8000 });
    ffmpegOk = true;
  } catch (_) {}
  return {
    ok: true,
    gifski,
    ffmpeg: { ok: ffmpegOk, path: ffmpeg },
    /** 有 gifski 或 ffmpeg 即可走原生编码 */
    nativeEncode: Boolean(gifski.available || ffmpegOk),
    engine: gifski.available ? "gifski" : ffmpegOk ? "ffmpeg-palette" : "none",
  };
}

function normalizeEncodeOpts(opts = {}) {
  const fps = Math.max(5, Math.min(60, Number(opts.fps) || 20));
  const width = Math.max(64, Math.min(1280, Math.round((Number(opts.width) || Number(opts.maxW) || 420) / 2) * 2));
  const quality = Math.max(1, Math.min(100, Math.round(Number(opts.quality) || Number(opts.gifskiQuality) || 90)));
  const startSec = Math.max(0, Number(opts.startSec) || 0);
  const span = Math.max(0, Number(opts.span) || Number(opts.durationSec) || 0);
  const speed = Math.max(1, Math.min(16, Number(opts.speed) || 1));
  const brightness = Number(opts.brightness) || 0;
  const crop = opts.crop && typeof opts.crop === "object" ? opts.crop : null;
  const lossy = Math.max(0, Math.min(200, Math.round(Number(opts.lossy) || 0)));
  const extra = Math.max(1, Math.min(100, Math.round(Number(opts.extra) || 1)));
  return { fps, width, quality, startSec, span, speed, brightness, crop, lossy, extra };
}

/** 与面板侧尽量对齐的 vf：裁剪 / 倍速 / fps / 可选降噪 / 缩放 / 亮度 */
function buildVideoFilter(opts) {
  const { fps, width, speed, brightness, crop } = opts;
  const parts = [];
  if (crop && Number(crop.w) > 0 && Number(crop.h) > 0) {
    const x = Math.max(0, Math.round(Number(crop.x) || 0));
    const y = Math.max(0, Math.round(Number(crop.y) || 0));
    parts.push(`crop=${Math.round(crop.w)}:${Math.round(crop.h)}:${x}:${y}`);
  }
  if (speed > 1.01) parts.push(`setpts=PTS/${speed}`);
  parts.push(`fps=${fps}`);
  if (opts.denoise !== false) parts.push("hqdn3d=1.5:1.5:6:6");
  parts.push(`scale=${width}:-2:flags=lanczos`);
  if (Math.abs(brightness) >= 0.01) {
    const b = Math.max(-1, Math.min(1, brightness));
    parts.push(`eq=brightness=${b.toFixed(3)}`);
  }
  return parts.join(",");
}

function buildFfmpegInputArgs(inputPath, opts) {
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  if (opts.startSec > 0.05) {
    args.push("-ss", String(opts.startSec));
  }
  args.push("-i", inputPath);
  if (opts.span > 0.05) {
    // 加速时按源时长截取，再靠 setpts 压缩
    const srcSpan = opts.speed > 1.01 ? opts.span * opts.speed : opts.span;
    args.push("-t", String(srcSpan + 0.05));
  }
  return args;
}

/**
 * 用原生 gifski（经 ffmpeg y4m 管道）编码。
 * quality: 1-100；原生 gifski 默认多线程。
 */
function encodeWithGifski(bin, ffmpegBin, inputPath, outPath, rawOpts = {}) {
  const opts = normalizeEncodeOpts(rawOpts);
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const vf = buildVideoFilter({ ...opts, denoise: rawOpts.denoise !== false });
    const ffArgs = [...buildFfmpegInputArgs(inputPath, opts), "-an", "-vf", vf, "-f", "yuv4mpegpipe", "-"];
    const ff = spawn(ffmpegBin, ffArgs, { stdio: ["ignore", "pipe", "pipe"] });
    const gsArgs = ["-", "-o", outPath, "--quality", String(opts.quality)];
    if (rawOpts.fast === true) gsArgs.push("--fast");
    if (opts.extra > 1 || rawOpts.extra === true) gsArgs.push("--extra");
    if (opts.lossy > 0) gsArgs.push("--lossy", String(opts.lossy));
    const gs = spawn(bin, gsArgs, { stdio: ["pipe", "ignore", "pipe"] });
    let ffErr = "";
    let gsErr = "";
    ff.stderr.on("data", (d) => {
      ffErr += String(d);
      if (ffErr.length > 4000) ffErr = ffErr.slice(-2000);
    });
    gs.stderr.on("data", (d) => {
      gsErr += String(d);
      if (gsErr.length > 4000) gsErr = gsErr.slice(-2000);
    });
    ff.on("error", reject);
    gs.on("error", reject);
    ff.stdout.pipe(gs.stdin);
    ff.on("close", (code) => {
      if (code !== 0 && !gs.killed) {
        try {
          gs.kill("SIGKILL");
        } catch (_) {}
      }
    });
    gs.on("close", (code) => {
      if (code === 0 && fs.existsSync(outPath) && fs.statSync(outPath).size > 32) {
        resolve({
          ok: true,
          engine: "gifski-native",
          path: outPath,
          size: fs.statSync(outPath).size,
          fps: opts.fps,
          width: opts.width,
          quality: opts.quality,
          multithreaded: true,
        });
        return;
      }
      reject(new Error(`gifski 失败 code=${code} ff=${ffErr.slice(0, 200)} gs=${gsErr.slice(0, 300)}`));
    });
  });
}

/** ffmpeg 两遍 palette（无 gifski 时的原生回退，仍远快于浏览器 wasm） */
async function encodeWithFfmpegPalette(ffmpegBin, inputPath, outPath, rawOpts = {}) {
  const opts = normalizeEncodeOpts(rawOpts);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const chain = buildVideoFilter({ ...opts, denoise: rawOpts.denoise !== false });
  const vf = `${chain},split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a`;
  const args = [...buildFfmpegInputArgs(inputPath, opts), "-an", "-vf", vf, "-loop", "0", outPath];
  try {
    await execFileAsync(ffmpegBin, args, { timeout: 30 * 60 * 1000 });
  } catch (err) {
    // hqdn3d 未编入时去掉重试
    if (/hqdn3d/i.test(String(err.stderr || err.message || ""))) {
      const chain2 = buildVideoFilter({ ...opts, denoise: false });
      const vf2 = `${chain2},split[s0][s1];[s0]palettegen=stats_mode=diff[p];[s1][p]paletteuse=dither=sierra2_4a`;
      await execFileAsync(ffmpegBin, [...buildFfmpegInputArgs(inputPath, opts), "-an", "-vf", vf2, "-loop", "0", outPath], {
        timeout: 30 * 60 * 1000,
      });
    } else {
      throw err;
    }
  }
  if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 32) {
    throw new Error("ffmpeg palette 未产出 GIF");
  }
  return {
    ok: true,
    engine: "ffmpeg-palette",
    path: outPath,
    size: fs.statSync(outPath).size,
    fps: opts.fps,
    width: opts.width,
    quality: opts.quality,
  };
}

async function encodeNative(inputPath, outPath, opts = {}) {
  const st = await status();
  if (!st.nativeEncode) {
    throw new Error("本机无 gifski 且无 ffmpeg，无法原生编码");
  }
  const ffmpegBin = findFfmpeg();
  if (st.gifski.available) {
    try {
      return await encodeWithGifski(st.gifski.path, ffmpegBin, inputPath, outPath, opts);
    } catch (err) {
      if (!st.ffmpeg.ok) throw err;
    }
  }
  return encodeWithFfmpegPalette(ffmpegBin, inputPath, outPath, opts);
}

module.exports = {
  findGifski,
  status,
  encodeNative,
  encodeWithGifski,
  encodeWithFfmpegPalette,
};
