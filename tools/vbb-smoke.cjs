#!/usr/bin/env node
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8765;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".mp4": "video/mp4",
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

async function main() {
  let puppeteer;
  try {
    puppeteer = require("puppeteer-core");
  } catch (_) {
    const { execSync } = require("child_process");
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
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    // 环境可能拦外网字体等，与工具逻辑无关
    if (/ERR_CONNECTION_REFUSED|fonts\.googleapis|fonts\.gstatic|net::ERR_/i.test(text)) return;
    errors.push(`console: ${text}`);
  });

  await page.goto(`http://127.0.0.1:${PORT}/tools/index.html#vbb`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  });

  const result = await page.evaluate(async () => {
    const out = {
      hasSection: Boolean(document.getElementById("vbb")),
      hasNav: Boolean(document.querySelector('.tool-nav-link[data-tool="vbb"]')),
      version: document.getElementById("gif-tool-version")?.textContent || "",
      analyzeDisabled: document.getElementById("vbb-analyze")?.disabled,
      runDisabled: document.getElementById("vbb-run")?.disabled,
      mergeDisabled: document.getElementById("vbb-merge")?.disabled,
      planHidden: document.getElementById("vbb-plan")?.hidden,
      ids: [
        "vbb-file",
        "vbb-analyze",
        "vbb-run",
        "vbb-merge",
        "vbb-mode-clarity",
        "vbb-mode-duration",
        "vbb-mode-custom",
        "vbb-plan-list",
        "vbb-list",
      ].map((id) => ({ id, ok: Boolean(document.getElementById(id)) })),
      orderHasVbb: false,
    };
    try {
      const raw = localStorage.getItem("devtools-tool-order-v2");
      // DEFAULT_ORDER is internal; check nav contains vbb after app init
      out.orderHasVbb = [...document.querySelectorAll(".tool-nav-link")].some((a) => a.dataset.tool === "vbb");
      out.navAfterGif =
        [...document.querySelectorAll(".tool-nav-link")].findIndex((a) => a.dataset.tool === "vsplit") >= 0 &&
        [...document.querySelectorAll(".tool-nav-link")].findIndex((a) => a.dataset.tool === "vbb") >
          [...document.querySelectorAll(".tool-nav-link")].findIndex((a) => a.dataset.tool === "vsplit");
    } catch (_) {}
    return out;
  });

  // Create a tiny mp4 and run analyze path lightly (engine warm + metadata load)
  const tmpMp4 = "/tmp/vbb-smoke.mp4";
  const { execSync } = require("child_process");
  execSync(
    `ffmpeg -y -f lavfi -i color=c=blue:s=320x240:d=3 -f lavfi -i sine=f=440:d=3 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest ${tmpMp4}`,
    { stdio: "pipe" }
  );

  const analyze = await page.evaluate(async (fileUrl) => {
    // Can't easily set file input from URL without puppeteer upload; return readiness only.
    return {
      ready: typeof window.GIF_TOOL_VERSION === "string",
      gifVersion: window.GIF_TOOL_VERSION || "",
    };
  }, pathToFileURL(tmpMp4).href);

  // Upload via puppeteer and click analyze
  const input = await page.$("#vbb-file");
  await input.uploadFile(tmpMp4);
  await page.waitForFunction(() => {
    const b = document.getElementById("vbb-analyze");
    return b && !b.disabled;
  }, { timeout: 15000 });

  await page.click("#vbb-analyze");
  await page.waitForFunction(() => {
    const plan = document.getElementById("vbb-plan");
    return plan && !plan.hidden;
  }, { timeout: 180000 });

  const afterAnalyze = await page.evaluate(() => {
    const summary = document.getElementById("vbb-plan-summary")?.textContent || "";
    const runDisabled = document.getElementById("vbb-run")?.disabled;
    const rows = document.querySelectorAll("#vbb-plan-list .vbb-plan-row").length;
    const cards = document.querySelectorAll("#vbb-plan-compare .vbb-plan-card").length;
    return { summary, runDisabled, rows, cards };
  });

  // Switch duration mode and ensure plan updates
  await page.click("#vbb-mode-duration");
  const durationMode = await page.evaluate(() => {
    const summary = document.getElementById("vbb-plan-summary")?.textContent || "";
    const active = document.getElementById("vbb-mode-duration")?.classList.contains("is-active");
    return { summary, active };
  });

  await page.click("#vbb-mode-clarity");
  await page.click("#vbb-run");
  await page.waitForFunction(() => {
    const list = document.getElementById("vbb-list");
    return list && list.querySelectorAll(".vsplit-clip-gif, .vsplit-clip").length > 0;
  }, { timeout: 180000 });

  const afterRun = await page.evaluate(() => {
    const clips = document.querySelectorAll("#vbb-list .vsplit-clip").length;
    const previews = document.querySelectorAll("#vbb-list .vsplit-clip-gif").length;
    const mergeDisabled = document.getElementById("vbb-merge")?.disabled;
    const err = document.getElementById("vbb-error");
    return {
      clips,
      previews,
      mergeDisabled,
      errorVisible: err ? !err.hidden && Boolean(err.textContent) : false,
      errorText: err?.textContent || "",
    };
  });

  await browser.close();
  server.close();

  const problems = [];
  if (errors.length) problems.push(`page errors: ${errors.join(" | ")}`);
  if (!result.hasSection) problems.push("missing #vbb");
  if (!result.hasNav) problems.push("missing nav");
  if (!result.version.includes("2026.08.13")) problems.push(`bad version ${result.version}`);
  if (result.analyzeDisabled !== true) problems.push("analyze should start disabled");
  if (result.runDisabled !== true) problems.push("run should start disabled");
  if (!result.ids.every((x) => x.ok)) problems.push("missing ids");
  if (!afterAnalyze.rows) problems.push("no plan rows after analyze");
  if (afterAnalyze.cards !== 2) problems.push(`expected 2 compare cards, got ${afterAnalyze.cards}`);
  if (afterAnalyze.runDisabled !== false) problems.push("run should enable after analyze");
  if (!durationMode.active) problems.push("duration mode not active");
  if (!analyze.ready) problems.push("GIF_TOOL_VERSION missing");
  if (!afterRun.clips || !afterRun.previews) problems.push(`execute preview missing: ${JSON.stringify(afterRun)}`);
  if (afterRun.errorVisible) problems.push(`execute error: ${afterRun.errorText}`);

  if (problems.length) {
    console.error("FAIL", { problems, result, afterAnalyze, durationMode, afterRun, analyze, errors });
    process.exit(1);
  }
  console.log("vbb-smoke: all passed", {
    version: result.version,
    rows: afterAnalyze.rows,
    clips: afterRun.clips,
    summary: afterAnalyze.summary.slice(0, 80),
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
