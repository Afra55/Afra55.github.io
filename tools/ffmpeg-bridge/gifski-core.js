/**
 * 原生 GIF 编码（优先 gifski，否则 ffmpeg palettegen）。
 * 挂在 ffmpeg-bridge，由统一桥 /ff 暴露。
 * gifski 可自动下载到本桥目录 ffmpeg-bridge/vendor/gifski/（用户解压目录内）。
 */
"use strict";

const { execFile, spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");

/** 官方 release 包内含 win/mac/linux 预编译 CLI */
const GIFSKI_RELEASE = {
  version: "1.34.0",
  url: "https://github.com/ImageOptim/gifski/releases/download/1.34.0/gifski-1.34.0.tar.xz",
  sha256: "b9b6591aa163123d737353d9c8581efdf3234d28eeaa45329b31da905cd5a996",
  archiveName: "gifski-1.34.0.tar.xz",
};

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

function vendorDir(baseDir) {
  return path.join(baseDir || __dirname, "vendor", "gifski");
}

function vendorGifskiPath(baseDir) {
  const exe = process.platform === "win32" ? "gifski.exe" : "gifski";
  return path.join(vendorDir(baseDir), exe);
}

function archiveMemberForPlatform() {
  if (process.platform === "win32") return "win/gifski.exe";
  if (process.platform === "darwin") return "mac/gifski";
  return "linux/gifski";
}

function findGifski(baseDir) {
  const fromPath = whichSync("gifski");
  if (fromPath) return { path: fromPath, source: "path" };
  const vend = vendorGifskiPath(baseDir);
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

function downloadUrl(url, dest) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    const tmp = `${dest}.part`;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const req = mod.get(url, { headers: { "User-Agent": "devtools-ffmpeg-bridge-gifski" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadUrl(res.headers.location, dest).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`下载 gifski 失败 HTTP ${res.statusCode}`));
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

function sha256File(file) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(file));
  return hash.digest("hex");
}

async function extractGifskiFromArchive(archivePath, destExe) {
  const member = archiveMemberForPlatform();
  const extractRoot = fs.mkdtempSync(path.join(os.tmpdir(), "gifski-extract-"));
  try {
    // Windows 10+/macOS/Linux 自带 tar 可解 xz
    await execFileAsync("tar", ["-xJf", archivePath, "-C", extractRoot, member], { timeout: 120000 });
    const extracted = path.join(extractRoot, ...member.split("/"));
    if (!fs.existsSync(extracted)) {
      throw new Error(`压缩包内未找到 ${member}`);
    }
    fs.mkdirSync(path.dirname(destExe), { recursive: true });
    fs.copyFileSync(extracted, destExe);
    try {
      fs.chmodSync(destExe, 0o755);
    } catch (_) {}
  } finally {
    try {
      fs.rmSync(extractRoot, { recursive: true, force: true });
    } catch (_) {}
  }
}

/**
 * 把官方 CLI 下载到指定桥目录（默认本模块旁 vendor/gifski）。
 * @param {{ force?: boolean, baseDir?: string }} [opts]
 */
async function ensureInstalled(opts = {}) {
  const baseDir = opts.baseDir ? path.resolve(opts.baseDir) : __dirname;
  const dest = vendorGifskiPath(baseDir);
  if (!opts.force) {
    const hit = findGifski(baseDir);
    if (hit) {
      const probed = await probeGifski(hit.path);
      if (probed.ok) {
        return {
          ok: true,
          installed: hit.source === "vendor",
          already: true,
          path: hit.path,
          source: hit.source,
          version: probed.version,
          installDir: vendorDir(baseDir),
        };
      }
    }
  }

  const cacheDir = path.join(os.tmpdir(), "devtools-gifski-cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  const archivePath = path.join(cacheDir, GIFSKI_RELEASE.archiveName);
  let needDl = true;
  if (fs.existsSync(archivePath)) {
    try {
      if (sha256File(archivePath).toLowerCase() === GIFSKI_RELEASE.sha256) needDl = false;
    } catch (_) {}
  }
  if (needDl) {
    await downloadUrl(GIFSKI_RELEASE.url, archivePath);
    const got = sha256File(archivePath).toLowerCase();
    if (got !== GIFSKI_RELEASE.sha256) {
      try {
        fs.unlinkSync(archivePath);
      } catch (_) {}
      throw new Error(`gifski 包校验失败（期望 ${GIFSKI_RELEASE.sha256.slice(0, 12)}…）`);
    }
  }

  await extractGifskiFromArchive(archivePath, dest);
  const probed = await probeGifski(dest);
  if (!probed.ok) {
    throw new Error(`安装后无法运行 gifski：${probed.error || "unknown"}`);
  }
  return {
    ok: true,
    installed: true,
    already: false,
    path: dest,
    source: "vendor",
    version: probed.version,
    installDir: vendorDir(baseDir),
    release: GIFSKI_RELEASE.version,
  };
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

async function status(opts = {}) {
  if (opts.autoInstall) {
    try {
      await ensureInstalled({ force: Boolean(opts.forceInstall) });
    } catch (_) {
      /* 安装失败仍回报当前状态 */
    }
  }
  const hit = findGifski(opts.baseDir);
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
    installDir: vendorDir(opts.baseDir),
    canInstall: true,
    release: GIFSKI_RELEASE.version,
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
    // 与面板一致：乘法提亮（勿用 eq=brightness 加性，同等数值会过曝/发灰）
    const m = Math.max(0.1, Math.min(3, 1 + Math.max(-1, Math.min(1, brightness))));
    parts.push(`colorchannelmixer=rr=${m.toFixed(4)}:gg=${m.toFixed(4)}:bb=${m.toFixed(4)}`);
  }
  return parts.join(",");
}

function buildFfmpegInputArgs(inputPath, opts) {
  const args = ["-hide_banner", "-loglevel", "error", "-y"];
  // -ss 放在 -i 之后按解码时钟裁；-t 不加正垫，片尾与编辑半开预览对齐
  args.push("-i", inputPath);
  if (opts.startSec > 0.001) {
    args.push("-ss", String(opts.startSec));
  }
  if (opts.span > 0.05) {
    const srcSpan = opts.speed > 1.01 ? opts.span * opts.speed : opts.span;
    args.push("-t", String(srcSpan));
  }
  return args;
}

/**
 * 用原生 gifski（经 ffmpeg y4m 管道）编码。
 * quality: 1-100；显式 --threads（并行试档时按 inflight 均分核；不传 --fast）。
 */
let gifskiInflight = 0;

function gifskiThreadCount() {
  const cpus = Math.max(1, (os.cpus() || []).length || 4);
  const share = Math.max(1, gifskiInflight);
  // 单任务多进程：并行试档时均分核，避免两路各占满核互相挤
  return Math.max(2, Math.min(cpus, Math.ceil(cpus / share)));
}

/**
 * 用原生 gifski（经 ffmpeg y4m 管道）编码。
 * quality: 1-100；显式 --threads（默认开多线程，不传 --fast）。
 */
function encodeWithGifski(bin, ffmpegBin, inputPath, outPath, rawOpts = {}) {
  const opts = normalizeEncodeOpts(rawOpts);
  gifskiInflight += 1;
  const auto = gifskiThreadCount();
  const want = Math.round(Number(rawOpts.threads) || 0);
  const threads = Math.max(2, Math.min(32, want > 0 ? Math.min(want, auto) : auto));
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const vf = buildVideoFilter({ ...opts, denoise: rawOpts.denoise !== false });
    const ffArgs = [...buildFfmpegInputArgs(inputPath, opts), "-an", "-vf", vf, "-f", "yuv4mpegpipe", "-"];
    const ff = spawn(ffmpegBin, ffArgs, { stdio: ["ignore", "pipe", "pipe"] });
    const gsArgs = ["-", "-o", outPath, "--quality", String(opts.quality), "--threads", String(threads)];
    if (rawOpts.fast === true) gsArgs.push("--fast");
    if (opts.extra > 1 || rawOpts.extra === true) gsArgs.push("--extra");
    // 仅在明确要求时才把面板 lossy 映射到 gifski --lossy-quality（会打噪点）。
    // 满画质黑盒不得走这条；quality≥90 时忽略误传的 lossy。
    if (opts.lossy > 0 && opts.quality < 90) {
      const lq = Math.max(1, Math.min(100, 100 - Math.round(opts.lossy / 2)));
      gsArgs.push("--lossy-quality", String(lq));
    }
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
    const done = (fn) => {
      gifskiInflight = Math.max(0, gifskiInflight - 1);
      fn();
    };
    ff.on("error", (err) => done(() => reject(err)));
    gs.on("error", (err) => done(() => reject(err)));
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
        done(() =>
          resolve({
            ok: true,
            engine: "gifski-native",
            path: outPath,
            size: fs.statSync(outPath).size,
            fps: opts.fps,
            width: opts.width,
            quality: opts.quality,
            multithreaded: true,
            threads,
          })
        );
        return;
      }
      done(() =>
        reject(new Error(`gifski 失败 code=${code} ff=${ffErr.slice(0, 200)} gs=${gsErr.slice(0, 300)}`))
      );
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
  // 缺 gifski 时自动下到本桥 vendor（用户解压目录内），失败则继续 palette
  if (!findGifski() && opts.autoInstall !== false) {
    try {
      await ensureInstalled();
    } catch (_) {}
  }
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
  ensureInstalled,
  vendorGifskiPath,
  vendorDir,
  GIFSKI_RELEASE,
};
