#!/usr/bin/env node
"use strict";

/**
 * 本地黑盒 GIF 实测：对给定视频跑 #vbb 一键黑盒，打印 fps/宽/体积。
 * 用法：node tools/scripts/vbb-bench-local.cjs [video1] [video2] ...
 * 环境：VBB_BENCH_OUT=结果目录；VBB_BENCH_TAG=标签（写进 json）
 *       VBB_BENCH_MOBILE=1 → 模拟手机触屏 + 性能拉满 + 强制 wasm（贴近真机单路）
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.resolve(__dirname, "../..");
const PORT = Number(process.env.VBB_BENCH_PORT || 8767);
const OUT_DIR = process.env.VBB_BENCH_OUT || path.join(os.tmpdir(), "vbb-bench");
const TAG = process.env.VBB_BENCH_TAG || "baseline";
const MOBILE = /^(1|true|yes)$/i.test(String(process.env.VBB_BENCH_MOBILE || ""));
const FPS_CAP = Number(process.env.VBB_BENCH_FPS_CAP || 0);
const QUALITY_FIRST = /^(1|true|yes)$/i.test(String(process.env.VBB_BENCH_QUALITY_FIRST || ""));
const MAX_BYTES = 10 * 1024 * 1024;
const {
  assertGifFpsAllowed,
} = require("../lib/vbb-blackbox-fps.js");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".gif": "image/gif",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    let rel = urlPath === "/" ? "/tools/index.html" : urlPath;
    const file = path.join(ROOT, rel.replace(/^\//, ""));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, { "Content-Type": MIME[ext] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

function findBrowser() {
  const cands = [
    process.env.VBB_SMOKE_BROWSER,
    process.env.DEVTOOLS_CHROME_PATH,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  for (const p of cands) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return "";
}

async function loadPuppeteer() {
  const TMP = os.tmpdir();
  try {
    return require("puppeteer-core");
  } catch (_) {}
  try {
    return require(path.join(TMP, "node_modules", "puppeteer-core"));
  } catch (_) {
    const { execSync } = require("child_process");
    execSync("npm install --no-save puppeteer-core@25", { stdio: "inherit", cwd: TMP });
    return require(path.join(TMP, "node_modules", "puppeteer-core"));
  }
}

function fmtMb(n) {
  return `${(Number(n) / (1024 * 1024)).toFixed(2)}MB`;
}

async function encodeOne(page, videoPath) {
  const name = path.basename(videoPath);
  console.log(`\n=== [${TAG}] ${name} ===`);
  const t0 = Date.now();

  await page.goto(`http://127.0.0.1:${PORT}/tools/index.html?debug#vbb`, {
    waitUntil: "domcontentloaded",
    timeout: 180000,
  });
  const forceHtml5Fail = /^(1|true|yes)$/i.test(String(process.env.VBB_BENCH_FORCE_HTML5_FAIL || ""));
  await page.evaluate((mobile, fpsCap, qualityFirst, forceHtml5Fail) => {
    try {
      localStorage.setItem("devtools-vbb-debug", "1");
      localStorage.setItem("devtools-vbb-auto-crop", "1");
      if (fpsCap > 0) localStorage.setItem("devtools-vbb-fps-cap", String(fpsCap));
      else localStorage.removeItem("devtools-vbb-fps-cap");
      localStorage.setItem("devtools-vbb-quality-first", qualityFirst ? "1" : "0");
      if (mobile) {
        localStorage.setItem("devtools-media-perf-v1", "max");
      }
      window.__VBB_FORCE_CROP_HTML5_FAIL = Boolean(forceHtml5Fail);
      if (forceHtml5Fail) localStorage.setItem("devtools-vbb-force-crop-html5-fail", "1");
      else localStorage.removeItem("devtools-vbb-force-crop-html5-fail");
    } catch (_) {}
  }, MOBILE, FPS_CAP, QUALITY_FIRST, forceHtml5Fail);
  await page.waitForFunction(
    () => window.__devtoolsBootReady && Boolean(document.getElementById("vbb-file")),
    { timeout: 90000 }
  );
  await page.evaluate((on) => {
    const el = document.getElementById("vbb-quality-first");
    if (!el) return;
    el.checked = on;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }, QUALITY_FIRST);
  await page.evaluate(() => {
    const el = document.getElementById("vbb-auto-crop");
    if (!el) return;
    el.checked = true;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });

  if (MOBILE) {
    // 模拟手机：触屏 + 小视口；强制 wasm，避免本机桥把「手机单路」测成桌面原生
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await page.evaluate(() => {
      try {
        window.matchMedia = ((orig) => {
          return (query) => {
            const q = String(query || "");
            if (/pointer:\s*coarse/i.test(q)) {
              return { matches: true, media: q, onchange: null, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; } };
            }
            return orig.call(window, query);
          };
        })(window.matchMedia.bind(window));
      } catch (_) {}
      try {
        if (typeof setMediaPerfMode === "function") setMediaPerfMode("max");
        const sel = document.getElementById("vbb-perf");
        if (sel) {
          sel.value = "max";
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
      } catch (_) {}
      // 黑盒入口强制 wasm（贴近手机无桥；encodeBlackboxGif 读此开关）
      window.__VBB_FORCE_WASM = true;
    });
  } else {
    // 桌面档：拉满 widen / 质量上探
    await page.setViewport({ width: 1280, height: 900, isMobile: false, hasTouch: false });
  }

  const input = await page.$("#vbb-file");
  await input.uploadFile(videoPath);
  await page.waitForFunction(() => {
    const v = document.getElementById("vbb-video");
    const b = document.getElementById("vbb-oneclick");
    return v && Number(v.duration) > 0 && Number.isFinite(v.duration) && b && !b.disabled;
  }, { timeout: 120000 });

  const meta = await page.evaluate(() => document.getElementById("vbb-meta")?.textContent || "");
  const perfInfo = await page.evaluate(() => {
    const p = typeof mediaPerfProfile === "function" ? mediaPerfProfile() : {};
    const coarse =
      typeof isCoarsePointerMedia === "function"
        ? isCoarsePointerMedia()
        : (() => {
            try {
              return window.matchMedia("(pointer: coarse)").matches;
            } catch (_) {
              return false;
            }
          })();
    return {
      coarse,
      tier: p.tier,
      label: p.label,
      batchConcurrency: p.batchConcurrency,
      encodeConcurrency: p.encodeConcurrency,
      widenProbes: p.widenProbes,
      preferChunkByDefault: p.preferChunkByDefault,
    };
  });
  console.log("meta:", meta);
  console.log("perf:", JSON.stringify(perfInfo));

  const logs = [];
  const onConsole = (msg) => {
    const t = msg.text();
    if (/\[vbb-phase\]|\[vbb\]|\[vbb-crop\]/.test(t)) {
      logs.push(t);
      console.log("  ", t.slice(0, 220));
    }
  };
  page.on("console", onConsole);

  await page.evaluate((forceHtml5Fail) => {
    try {
      window.__VBB_FORCE_CROP_HTML5_FAIL = Boolean(forceHtml5Fail);
      if (forceHtml5Fail) localStorage.setItem("devtools-vbb-force-crop-html5-fail", "1");
      else localStorage.removeItem("devtools-vbb-force-crop-html5-fail");
    } catch (_) {}
    document.getElementById("vbb-oneclick")?.click();
  }, forceHtml5Fail);

  await page.waitForFunction(
    () => {
      const clips = window.DevToolsVbb?.getClips?.() || [];
      if (!clips.length) return false;
      return clips.every((c) => c.gifBlob || c.error);
    },
    { timeout: 45 * 60 * 1000, polling: 1000 }
  );

  page.off("console", onConsole);

  const result = await page.evaluate((maxBytes) => {
    const clips = (window.DevToolsVbb?.getClips?.() || []).map((c) => ({
      start: c.start,
      span: c.span,
      fps: c.gifFps || c.fps || null,
      outW: c.gifOutW || 0,
      outH: c.gifOutH || 0,
      maxW: c.gifMaxW || c.maxW || 0,
      size: c.gifBlob?.size || 0,
      note: c.gifNote || "",
      error: c.error || "",
      under10: Boolean(c.gifBlob && c.gifBlob.size <= maxBytes),
    }));
    const v = document.getElementById("vbb-video");
    return {
      clips,
      video: {
        duration: v?.duration || 0,
        width: v?.videoWidth || 0,
        height: v?.videoHeight || 0,
      },
      summary: document.getElementById("vbb-result-summary")?.textContent || "",
    };
  }, MAX_BYTES);

  // 从 note 补 fps（gifFps 可能未挂）
  for (const c of result.clips) {
    if (!c.fps && c.note) {
      const m = /(\d+(?:\.\d+)?)\s*FPS/i.exec(c.note);
      if (m) c.fps = Number(m[1]);
    }
    if (!c.maxW && c.outW) c.maxW = c.outW;
  }

  const elapsedMs = Date.now() - t0;
  const row = {
    tag: TAG,
    file: name,
    path: videoPath,
    elapsedMs,
    video: result.video,
    meta,
    summary: result.summary,
    clips: result.clips,
    phases: logs.filter((l) =>
      /选定|余量提帧|余量抬画质|跳过加宽|试 |决策|O3后/.test(l)
    ),
  };

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const safe = name.replace(/[^\w.\-]+/g, "_");
  const outJson = path.join(OUT_DIR, `${TAG}__${safe}.json`);
  fs.writeFileSync(outJson, JSON.stringify(row, null, 2));

  for (const c of result.clips) {
    console.log(
      `→ GIF span=${Number(c.span).toFixed(1)}s fps=${c.fps} w=${c.outW || c.maxW} size=${fmtMb(c.size)} ≤10MB=${c.under10} note=${c.note || c.error}`
    );
  }

  // 自动去色边：开关强制开着时，成片须标注「去色边」且宽高比相对源有变化（裁掉左右黑边）
  {
    const c = result.clips[0] || {};
    if (!c.error) {
      const srcAspect = (Number(result.video.width) || 0) / Math.max(1, Number(result.video.height) || 1);
      const outAspect = (Number(c.outW) || 0) / Math.max(1, Number(c.outH) || 1);
      const note = String(c.note || "");
      if (!/去色边/.test(note)) {
        throw new Error(`${name}: 自动去色边开着但 note 无「去色边」：${note}`);
      }
      if (!(c.outW > 0 && c.outH > 0)) {
        throw new Error(`${name}: 缺少 outW/outH，无法校验 crop`);
      }
      if (Math.abs(outAspect - srcAspect) < 0.004) {
        throw new Error(
          `${name}: 成片宽高比≈源（${outAspect.toFixed(4)} vs ${srcAspect.toFixed(4)}），疑似未裁黑边`
        );
      }
      const cropLog = logs.find((l) => /\[vbb-crop\]/.test(l)) || "";
      console.log(`✓ crop guard: aspect ${srcAspect.toFixed(4)}→${outAspect.toFixed(4)} · ${cropLog.slice(0, 120)}`);
      if (forceHtml5Fail && !/ffmpeg-fallback|forcedHtml5Fail/.test(logs.join("\n"))) {
        throw new Error(`${name}: 强制 HTML5 失败时须走 ffmpeg-fallback`);
      }
    }
  }

  // 硬约束：决策日志里的 srcFps 与成片 fps 必须同属整除档（防 25→20 回归）
  {
    const decision = logs.find((l) => /决策 fpsList=/.test(l)) || "";
    if (QUALITY_FIRST) {
      if (!/画质优先守80/.test(decision)) {
        throw new Error(`${name}: 画质优先未写入决策日志`);
      }
      for (const c of result.clips) {
        if (c.error) continue;
        const qm = /画质\s*(\d+)/.exec(c.note || "");
        const gq = qm ? Number(qm[1]) : 0;
        if (gq > 0 && gq < 80) {
          const joined = logs.join("\n");
          if (!/底档≥80仍超/.test(joined)) {
            throw new Error(`${name}: 画质优先 gq=${gq} 但未先试完底档≥80`);
          }
        }
      }
    } else {
      const span = Number(result.clips[0]?.span) || Number(result.video.duration) || 0;
      if (span > 10.1 && decision && !/长片保帧可<80/.test(decision)) {
        throw new Error(`${name}: 默认长片未走保帧路径`);
      }
      if (span <= 10 && decision && !/短片守80掉帧/.test(decision)) {
        throw new Error(`${name}: 默认短片未走守80路径`);
      }
    }
    const m = /srcFps=([\d.]+)/.exec(decision);
    const srcFps = m ? Number(m[1]) : 0;
    if (srcFps >= 23.5 && srcFps < 24.5) {
      for (const c of result.clips) {
        if (c.error || !(c.fps > 0)) continue;
        assertGifFpsAllowed(srcFps, c.fps, `${name} clip`);
      }
      console.log(`✓ fps guard: src≈24 → gif ∈ {24,15,12} ok`);
    } else if (srcFps >= 24.5 && srcFps <= 25.8) {
      for (const c of result.clips) {
        if (c.error || !(c.fps > 0)) continue;
        assertGifFpsAllowed(srcFps, c.fps, `${name} clip`);
      }
      console.log(`✓ fps guard: src≈25 → gif ∈ {25,15,12.5} ok`);
    }
  }

  console.log(`elapsed ${(elapsedMs / 1000).toFixed(1)}s → ${outJson}`);
  return row;
}

async function main() {
  const videos = process.argv.slice(2).filter((p) => fs.existsSync(p));
  if (!videos.length) {
    console.error("用法: node tools/scripts/vbb-bench-local.cjs <video>...");
    process.exit(2);
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const puppeteer = await loadPuppeteer();
  const server = await startServer();
  const exe = findBrowser();
  if (!exe) throw new Error("未找到 Chrome/Edge");
  const browser = await puppeteer.launch({
    executablePath: exe,
    headless: true,
    protocolTimeout: 60 * 60 * 1000,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(60 * 60 * 1000);
  const all = [];
  try {
    for (const v of videos) {
      all.push(await encodeOne(page, v));
    }
  } finally {
    await browser.close();
    server.close();
  }
  const summaryPath = path.join(OUT_DIR, `${TAG}__summary.json`);
  fs.writeFileSync(summaryPath, JSON.stringify(all, null, 2));
  console.log("\n==== SUMMARY ====");
  for (const r of all) {
    const c = r.clips[0] || {};
    console.log(
      `${r.file} | ${Number(r.video.duration).toFixed(1)}s ${r.video.width}x${r.video.height} | fps=${c.fps} w=${c.outW || c.maxW} ${fmtMb(c.size)} ≤10=${c.under10}`
    );
  }
  console.log("wrote", summaryPath);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
