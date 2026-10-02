#!/usr/bin/env node
"use strict";

/**
 * 实测：多选 → 编辑裁切片头片尾 → 拼接后转黑盒
 * 用法：node tools/scripts/vbb-merge-edit-bench.cjs video1 video2
 * 环境：VBB_BENCH_OUT / VBB_BENCH_TAG / VBB_PERF=auto|max|balanced|eco|desktop
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.resolve(__dirname, "../..");
const PORT = Number(process.env.VBB_BENCH_PORT || 8771);
const OUT_DIR = process.env.VBB_BENCH_OUT || path.join(ROOT, "tools/.tmp-vbb-bench");
const TAG = process.env.VBB_BENCH_TAG || "merge-edit";
const PERF = String(process.env.VBB_PERF || "max").trim() || "max";
const MOBILE = process.env.VBB_MOBILE === "1";
const { assertGifFpsAllowed } = require("../lib/vbb-blackbox-fps.js");

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
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

function findBrowser() {
  const cands = [
    process.env.VBB_SMOKE_BROWSER,
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  ].filter(Boolean);
  for (const p of cands) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return "";
}

async function loadPuppeteer() {
  try {
    return require("puppeteer-core");
  } catch (_) {}
  return require(path.join(os.tmpdir(), "node_modules", "puppeteer-core"));
}

async function main() {
  const videos = process.argv.slice(2).filter((p) => fs.existsSync(p));
  if (videos.length < 2) throw new Error("需要至少两个视频路径");
  const browserPath = findBrowser();
  if (!browserPath) throw new Error("未找到浏览器");
  const puppeteer = await loadPuppeteer();
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const server = await startServer();
  const browser = await puppeteer.launch({
    executablePath: browserPath,
    headless: "new",
    protocolTimeout: 0,
    args: ["--disable-gpu", "--no-sandbox"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(0);
  page.setDefaultNavigationTimeout(180000);

  if (MOBILE) {
    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  } else {
    await page.setViewport({ width: 1280, height: 900, isMobile: false, hasTouch: false });
  }

  const logs = [];
  let encodeDone = false;
  page.on("console", (msg) => {
    const t = msg.text();
    if (/\[vbb-phase\]|\[vbb\]/.test(t)) {
      logs.push(t);
      console.log("  ", t.slice(0, 240));
      if (/选定 .+fps|黑盒完成|无法压到|FAIL/.test(t)) encodeDone = true;
    }
  });

  const t0 = Date.now();
  try {
    await page.goto(`http://127.0.0.1:${PORT}/tools/index.html?debug#vbb`, {
      waitUntil: "networkidle0",
      timeout: 120000,
    });
    await page.evaluate((perf) => {
      try {
        localStorage.setItem("devtools-vbb-debug", "1");
        localStorage.setItem("devtools-media-perf-v1", perf);
      } catch (_) {}
    }, PERF);
    await page.waitForFunction(
      () => window.__devtoolsBootReady && Boolean(document.getElementById("vbb-file")),
      { timeout: 90000 }
    );

    // 应用性能档 UI
    await page.evaluate((perf) => {
      const sel = document.getElementById("vbb-perf");
      if (sel) {
        sel.value = perf;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (typeof setMediaPerfMode === "function") setMediaPerfMode(perf);
      else if (window.DevToolsMedia?.setMediaPerfMode) window.DevToolsMedia.setMediaPerfMode(perf);
    }, PERF);

    const perfInfo = await page.evaluate(() => {
      const p = typeof mediaPerfProfile === "function" ? mediaPerfProfile() : null;
      const mode = typeof readMediaPerfMode === "function" ? readMediaPerfMode() : "";
      const coarse = typeof isCoarsePointerMedia === "function" ? isCoarsePointerMedia() : false;
      return { mode, coarse, profile: p };
    });
    console.log("perf:", JSON.stringify(perfInfo));

    const input = await page.$("#vbb-file");
    await input.uploadFile(videos[0], videos[1]);
    await page.waitForFunction(() => {
      const list = document.getElementById("vbb-batch-list");
      return list && !list.hidden && list.querySelectorAll(".vbb-batch-row").length >= 2;
    }, { timeout: 180000 });

    const batchMeta = await page.evaluate(() => {
      const rows = [...document.querySelectorAll(".vbb-batch-row")].map((r) => r.textContent.trim());
      const merge = !document.getElementById("vbb-merge-video")?.disabled;
      return { rows, merge };
    });
    console.log("batch:", batchMeta);

    // 给两条都裁片头片尾（约去头 1.2s、去尾 1.5s），模拟用户编辑
    const editPlan = await page.evaluate(async () => {
      const api = window.DevToolsVbb;
      const files = api?.getBatchFiles?.() || [];
      if (files.length < 2) throw new Error("batch < 2");
      const applied = [];
      for (let i = 0; i < 2; i++) {
        const item = files[i];
        const d = Number(item.duration) || 0;
        const trimStart = Math.min(1.2, Math.max(0.2, d * 0.08));
        const trimEnd = Math.max(trimStart + 2, d - Math.min(1.5, d * 0.1));
        item.edit = {
          trimStart,
          trimEnd,
          cropOn: false,
          crop: { x: 0, y: 0, w: item.srcW, h: item.srcH },
        };
        applied.push({
          name: item.file?.name,
          duration: d,
          trimStart,
          trimEnd,
          span: trimEnd - trimStart,
        });
      }
      // 刷新 UI
      api?.syncUi?.();
      return applied;
    });
    console.log("edits:", JSON.stringify(editPlan, null, 2));

    const tMerge = Date.now();
    encodeDone = false;
    await page.evaluate(() => {
      document.getElementById("vbb-merge-video")?.click();
    });

    // gifski 会卡住主线程，CDP waitForFunction 易超时；改轮询 + 控制台「选定」信号
    const deadline = Date.now() + 60 * 60 * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      let done = false;
      try {
        done = await page.evaluate(() => {
          const clips = window.DevToolsVbb?.getClips?.() || [];
          if (!clips.length) return false;
          return clips.every((c) => c.gifBlob || c.error);
        });
      } catch (_) {
        // 主线程忙时忽略，继续等
      }
      if (done) break;
    }
    const mergeMs = Date.now() - tMerge;

    const result = await page.evaluate(() => {
      const clips = (window.DevToolsVbb?.getClips?.() || []).map((c) => ({
        start: c.start,
        span: c.span,
        fps: c.gifFps || c.fps || null,
        outW: c.gifOutW || 0,
        outH: c.gifOutH || 0,
        size: c.gifBlob?.size || 0,
        note: c.gifNote || "",
        error: c.error || "",
      }));
      const v = document.getElementById("vbb-video");
      const meta = document.getElementById("vbb-meta")?.textContent || "";
      const summary = document.getElementById("vbb-result-summary")?.textContent || "";
      const p = typeof mediaPerfProfile === "function" ? mediaPerfProfile() : null;
      return {
        clips,
        meta,
        summary,
        video: {
          duration: v?.duration || 0,
          width: v?.videoWidth || 0,
          height: v?.videoHeight || 0,
        },
        profile: p,
      };
    });

    // 从 phase log 抽拼接 fps
    const mergeFpsLog = logs.find((l) => /拼接中间片/.test(l)) || "";
    const report = {
      tag: TAG,
      at: new Date().toISOString(),
      perfMode: PERF,
      mobileViewport: MOBILE,
      videos,
      editPlan,
      perfInfo,
      mergeMs,
      totalMs: Date.now() - t0,
      mergeFpsLog,
      result,
      phases: logs.filter((l) => /拼接|选定|试 |决策|保帧|加宽/.test(l)).slice(-40),
    };
    const outPath = path.join(OUT_DIR, `${TAG}__merge-edit.json`);
    fs.writeFileSync(outPath, JSON.stringify(report, null, 2));
    console.log("\n==== MERGE+EDIT RESULT ====");
    console.log("merge+gif ms:", mergeMs, "total ms:", report.totalMs);
    console.log("meta:", result.meta);
    console.log("summary:", result.summary);
    console.log(
      "clip:",
      result.clips.map((c) => `${c.note || c.error} · ${(c.size / 1048576).toFixed(2)}MB`).join(" | ")
    );
    console.log("wrote", outPath);
    {
      const decision = logs.find((l) => /决策 fpsList=/.test(l)) || "";
      const m = /srcFps=([\d.]+)/.exec(decision);
      const srcFps = m ? Number(m[1]) : 0;
      if (srcFps >= 24.2 && srcFps <= 25.8) {
        for (const c of result.clips) {
          if (c.error) continue;
          const fps = Number(c.fps) || 0;
          if (!(fps > 0) && c.note) {
            const nm = /(\d+(?:\.\d+)?)\s*FPS/i.exec(c.note);
            if (nm) c.fps = Number(nm[1]);
          }
          if (c.fps > 0) assertGifFpsAllowed(srcFps, c.fps, "merge gif");
        }
        console.log("✓ fps guard: src≈25 → gif ∈ {25,12.5} ok");
      }
    }
    if (!result.clips.length || result.clips.some((c) => c.error || !(c.size > 0))) {
      process.exitCode = 1;
    }
  } finally {
    await browser.close().catch(() => {});
    await new Promise((r) => server.close(r));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
