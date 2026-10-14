#!/usr/bin/env node
"use strict";

/**
 * 黑盒能力探测：seed 相似度 API + 一条短片真实编码。
 * 用法：NODE_PATH=/tmp/node_modules node tools/scripts/vbb-capability-probe.cjs
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.resolve(__dirname, "../..");
const PORT = Number(process.env.VBB_PROBE_PORT || 8771);
const OUT = process.env.VBB_PROBE_OUT || path.join(ROOT, "tools/.tmp-vbb-bench/capability-probe.json");
const SAMPLE_A = path.join(ROOT, "tools/.tmp-vbb-bench/samples/a-860x610-25fps-12s.mp4");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".mp4": "video/mp4",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function startServer() {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent((req.url || "/").split("?")[0]);
    if (rel === "/") rel = "/tools/index.html";
    const file = path.join(ROOT, rel.replace(/^\//, ""));
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

async function loadPuppeteer() {
  try {
    return require("puppeteer-core");
  } catch (_) {}
  return require(path.join(os.tmpdir(), "node_modules", "puppeteer-core"));
}

function findBrowser() {
  for (const p of [
    process.env.VBB_SMOKE_BROWSER,
    "/usr/local/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
  ].filter(Boolean)) {
    if (fs.existsSync(p)) return p;
  }
  throw new Error("未找到 Chrome");
}

async function main() {
  if (!fs.existsSync(SAMPLE_A)) throw new Error("缺样本 " + SAMPLE_A);
  const puppeteer = await loadPuppeteer();
  const server = await startServer();
  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(180000);
  const logs = [];
  page.on("console", (m) => {
    const t = m.text();
    if (/\[vbb|沿用|seed|stall|宽\d+|FPS/.test(t)) logs.push(t);
  });

  try {
    await page.goto(`http://127.0.0.1:${PORT}/tools/index.html?debug#vbb`, {
      waitUntil: "networkidle0",
      timeout: 120000,
    });
    await page.waitForFunction(
      () => window.__devtoolsBootReady && Boolean(document.getElementById("vbb-file")),
      { timeout: 90000 }
    );
    await page.evaluate(() => {
      try {
        localStorage.setItem("devtools-vbb-debug", "1");
        localStorage.removeItem("devtools-vbb-span-scheme-v1");
      } catch (_) {}
    });

    const seedMatrix = await page.evaluate(() => {
      const api = window.DevToolsVbb;
      if (!api?.spanSchemeKey || !api?.seedFitsMeta || !api?.saveSpanScheme || !api?.loadSpanScheme) {
        return { ok: false, reason: "missing api", keys: Object.keys(api || {}) };
      }
      const a = { srcW: 860, srcH: 610, srcFps: 25, fps: 25, maxW: 840, speed: 1 };
      const b = { srcW: 1280, srcH: 720, srcFps: 30, fps: 15, maxW: 420, speed: 1 };
      const c = { srcW: 864, srcH: 608, srcFps: 25, fps: 25, maxW: 700, speed: 1 };
      api.saveSpanScheme(12, a, "blackbox");
      const hitSame = api.loadSpanScheme(12.04, 1, { srcW: 860, srcH: 610, srcFps: 25 });
      const missRes = api.loadSpanScheme(12, 1, { srcW: 1280, srcH: 720, srcFps: 25 });
      const missFps = api.loadSpanScheme(12, 1, { srcW: 860, srcH: 610, srcFps: 30 });
      const near = api.loadSpanScheme(12, 1, { srcW: 864, srcH: 608, srcFps: 25 });
      const keyA = api.spanSchemeKey(12, 1, a);
      const keyB = api.spanSchemeKey(12, 1, b);
      const keyC = api.spanSchemeKey(12, 1, c);
      return {
        ok: true,
        keyA,
        keyB,
        keyC,
        keysDifferAB: keyA !== keyB,
        keysSameAC: keyA === keyC,
        hitSame: Boolean(hitSame && hitSame.fps === 25),
        missRes: !missRes,
        missFps: !missFps,
        nearHit: Boolean(near),
        fitsAA: api.seedFitsMeta(a, { srcW: 860, srcH: 610, srcFps: 25 }),
        fitsAB: api.seedFitsMeta(a, { srcW: 1280, srcH: 720, srcFps: 25 }),
      };
    });

    const input = await page.$("#vbb-file");
    await input.uploadFile(SAMPLE_A);
    await page.waitForFunction(() => {
      const b = document.getElementById("vbb-oneclick");
      return b && !b.disabled;
    }, { timeout: 90000 });

    await page.evaluate(() => {
      try {
        localStorage.setItem("devtools-media-perf", "eco");
        localStorage.setItem("devtools-vbb-debug", "1");
        localStorage.setItem("devtools-vbb-fps-cap", "15");
      } catch (_) {}
      const sel = document.getElementById("vbb-perf");
      if (sel) {
        sel.value = "eco";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    const t0 = Date.now();
    await page.click("#vbb-oneclick");
    let encodeResult = { done: false, err: "timeout" };
    try {
      encodeResult = await page.waitForFunction(
        () => {
          const clips = window.DevToolsVbb?.getClips?.() || [];
          const c = clips[0];
          if (!c) return false;
          if (c.gifBlob && c.gifBlob.size > 0) {
            return {
              done: true,
              size: c.gifBlob.size,
              note: c.gifNote || "",
              err: c.error || "",
              fps: c.gifFps || 0,
              w: c.gifOutW || 0,
              h: c.gifOutH || 0,
              engine: c.gifEngine || "",
              gq: c.gifskiQuality || 0,
            };
          }
          if (c.error) {
            return { done: true, size: 0, err: c.error, note: c.gifNote || "" };
          }
          return false;
        },
        { timeout: 480000, polling: 1000 }
      ).then((h) => h.jsonValue());
    } catch (e) {
      encodeResult = { done: false, err: String(e && e.message ? e.message : e) };
    }
    const elapsedMs = Date.now() - t0;

    const afterEncodeSeed = await page.evaluate(() => {
      const api = window.DevToolsVbb;
      const miss = api.loadSpanScheme(12, 1, { srcW: 1280, srcH: 720, srcFps: 30 });
      const hit = api.loadSpanScheme(12, 1, { srcW: 860, srcH: 610, srcFps: 25 });
      return {
        miss: Boolean(miss),
        hit: Boolean(hit),
        hitFps: hit?.fps || 0,
        hitMaxW: hit?.maxW || 0,
        hitSrcW: hit?.srcW || 0,
        hitSrcFps: hit?.srcFps || 0,
      };
    });

    const checks = {
      seedApi: Boolean(seedMatrix.ok),
      seedHitSame: Boolean(seedMatrix.hitSame),
      seedMissRes: Boolean(seedMatrix.missRes),
      seedMissFps: Boolean(seedMatrix.missFps),
      seedNearSameBucket: Boolean(seedMatrix.nearHit && seedMatrix.keysSameAC),
      seedKeysDifferAB: Boolean(seedMatrix.keysDifferAB),
      encodeDone: Boolean(encodeResult.done && encodeResult.size > 0),
      encodeUnder10mb: Boolean(encodeResult.size > 0 && encodeResult.size <= 10 * 1024 * 1024),
      afterMissOtherVideo: afterEncodeSeed.miss === false,
      afterHitSameFingerprint: Boolean(afterEncodeSeed.hit),
    };
    const failed = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);

    const out = {
      ok: failed.length === 0,
      failed,
      checks,
      seedMatrix,
      encodeResult,
      elapsedMs,
      afterEncodeSeed,
      progressLogs: logs.filter((l) => /seed|沿用|宽\d+|FPS|stall/.test(l)).slice(-50),
      build: await page.evaluate(() => window.TOOLS_BUILD || ""),
    };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log(JSON.stringify(out, null, 2));
    if (failed.length) process.exitCode = 2;
  } finally {
    await browser.close().catch(() => {});
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
