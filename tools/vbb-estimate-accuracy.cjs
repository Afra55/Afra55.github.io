#!/usr/bin/env node
"use strict";

/**
 * 黑盒预估 vs 实测对照：各时长单段视频，走「时长优先」黑盒路径。
 * 用法：node tools/vbb-estimate-accuracy.cjs
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8767;
const SPANS = [4, 6, 8, 10, 12, 14, 16, 20];
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".mp4": "video/mp4",
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
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve(server)));
}

function makeMp4(span, outPath) {
  execSync(
    `ffmpeg -y -f lavfi -i testsrc=size=1280x720:rate=30:duration=${span} -f lavfi -i sine=f=440:d=${span} -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest ${outPath}`,
    { stdio: "pipe" }
  );
}

function relErr(est, act) {
  if (!(act > 0)) return Infinity;
  return Math.abs(est - act) / act;
}

async function main() {
  let puppeteer;
  try {
    puppeteer = require("/tmp/node_modules/puppeteer-core");
  } catch (_) {
    execSync("npm install --no-save puppeteer-core@23", { stdio: "inherit", cwd: "/tmp" });
    puppeteer = require("/tmp/node_modules/puppeteer-core");
  }

  const server = await startServer();
  const browser = await puppeteer.launch({
    executablePath: "/usr/bin/google-chrome-stable",
    headless: true,
    args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(300000);
  const rows = [];

  for (const span of SPANS) {
    const mp4 = `/tmp/vbb-acc-${span}s.mp4`;
    makeMp4(span, mp4);
    await page.goto(`http://127.0.0.1:${PORT}/tools/index.html#media/vbb`, {
      waitUntil: "networkidle0",
      timeout: 60000,
    });
    const input = await page.$("#vbb-file");
    await input.uploadFile(mp4);
    await page.waitForFunction(() => {
      const b = document.getElementById("vbb-analyze");
      return b && !b.disabled;
    });
    await page.click("#vbb-analyze");
    await page.waitForFunction(() => {
      const plan = document.getElementById("vbb-plan");
      return plan && !plan.hidden;
    }, { timeout: 180000 });

    const before = await page.evaluate(() => {
      const hook = window.DevToolsVbb;
      if (!hook?.getActivePlan || !hook?.estimateBlackbox) {
        return { error: "DevToolsVbb hook missing" };
      }
      const active = hook.getActivePlan();
      const bps15 = hook.getBps15();
      const srcW = hook.getSrcW();
      const est = hook.estimateBlackbox(active?.avgSpan || 0);
      return {
        bps15,
        srcW,
        avgSpan: active?.avgSpan,
        count: active?.count,
        estBytes: est.bytes,
        estFps: est.fps,
        estCompressRounds: est.compressRounds,
        estMaxW: est.maxW,
        summary: document.getElementById("vbb-plan-summary")?.textContent || "",
      };
    });
    if (before.error) throw new Error(before.error);

    await page.click("#vbb-run");
    await page.waitForFunction(() => {
      const list = document.getElementById("vbb-list");
      return list && list.querySelectorAll(".vsplit-clip").length > 0;
    }, { timeout: 300000 });

    const after = await page.evaluate(() => {
      const clip = window.DevToolsVbb?.getClips?.()?.[0];
      const note = clip?.gifNote || "";
      const fpsM = note.match(/(\d+)\s*FPS/i);
      const roundM = note.match(/已压\s*(\d+)\s*轮/);
      const wM = note.match(/(\d+)\s*[×x]\s*\d+/i) || note.match(/宽\s*(\d+)/);
      return {
        actualBytes: clip?.gifBlob?.size || 0,
        actualFps: fpsM ? Number(fpsM[1]) : null,
        actualCompressRounds: roundM ? Number(roundM[1]) : 0,
        actualW: wM ? Number(wM[1]) : null,
        note,
        error: clip?.error || "",
      };
    });

    const sizeErr = relErr(before.estBytes, after.actualBytes);
    const fpsOk =
      before.estFps === after.actualFps ||
      // 预估 15+压缩、实测 15；或边界档允许差一档且都做过压缩
      (before.estFps === 15 && after.actualFps === 15);
    const sizeOk =
      sizeErr <= 0.35 ||
      (before.estBytes >= 5 * 1024 * 1024 && after.actualBytes >= 4.5 * 1024 * 1024);

    rows.push({
      span,
      ...before,
      ...after,
      sizeErr: Number(sizeErr.toFixed(3)),
      fpsOk,
      sizeOk,
      ok: Boolean(fpsOk && sizeOk && !after.error),
    });
    console.log(
      JSON.stringify(
        {
          span,
          est: `${before.estFps}fps/w${before.estMaxW}/${(before.estBytes / 1048576).toFixed(2)}MB/c${before.estCompressRounds}`,
          act: `${after.actualFps}fps/w${after.actualW}/${(after.actualBytes / 1048576).toFixed(2)}MB/c${after.actualCompressRounds}`,
          sizeErr: `${(sizeErr * 100).toFixed(1)}%`,
          ok: rows[rows.length - 1].ok,
          note: after.note,
        },
        null,
        0
      )
    );
  }

  await browser.close();
  server.close();

  const failed = rows.filter((r) => !r.ok);
  const report = { passed: rows.length - failed.length, failed: failed.length, rows };
  fs.writeFileSync("/tmp/vbb-estimate-accuracy.json", JSON.stringify(report, null, 2));
  console.log("\nSUMMARY", { passed: report.passed, failed: report.failed });
  if (failed.length) {
    console.error("FAIL details", failed);
    process.exit(1);
  }
  console.log("vbb-estimate-accuracy: all passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
