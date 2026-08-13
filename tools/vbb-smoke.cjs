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
      hasNav: Boolean(document.querySelector('.tool-nav-link[data-tool="media"]')),
      mediaActive: document.querySelector('.tool-nav-link[data-tool="media"]')?.classList.contains("is-active"),
      vbbActive: document.getElementById("vbb")?.classList.contains("is-workspace-active"),
      hash: location.hash,
      mediaSubnavVisible: !document.getElementById("media-subnav")?.hidden,
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
      orderHasMedia: false,
    };
    try {
      out.orderHasMedia = [...document.querySelectorAll(".tool-nav-link")].some((a) => a.dataset.tool === "media");
      out.noLegacyMediaNav = ![...document.querySelectorAll(".tool-nav-link")].some((a) =>
        ["gifmaker", "vsplit", "vbb"].includes(a.dataset.tool)
      );
    } catch (_) {}
    return out;
  });

  // Create a tiny mp4 and run analyze path lightly (engine warm + metadata load)
  const tmpMp4 = "/tmp/vbb-smoke.mp4";
  const { execSync } = require("child_process");
  execSync(
    `ffmpeg -y -f lavfi -i testsrc=size=1280x720:rate=30:duration=4 -f lavfi -i sine=f=440:d=4 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest ${tmpMp4}`,
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

  await page.click("#vbb-mode-sharp");
  const sharpMode = await page.evaluate(() => {
    const summary = document.getElementById("vbb-plan-summary")?.textContent || "";
    const active = document.getElementById("vbb-mode-sharp")?.classList.contains("is-active");
    const card = [...document.querySelectorAll("#vbb-plan-compare .vbb-plan-card")].find((el) =>
      /锐度/.test(el.textContent || "")
    );
    return { summary, active, cardText: card?.textContent || "" };
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

  const todayTools = await page.evaluate(() => ({
    vsplit: Boolean(document.getElementById("vsplit")),
    gifm: Boolean(document.getElementById("gifm-merge") && document.getElementById("gifm-file")),
    vbbSharp: Boolean(document.getElementById("vbb-mode-sharp")),
    mediaTabs: document.querySelectorAll("#media-subnav [data-media-tab]").length,
  }));

  // Mobile drawer + media tab switch
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`http://127.0.0.1:${PORT}/tools/index.html#timestamp`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  });
  await page.click("#nav-open");
  const drawerOpen = await page.evaluate(() => document.body.classList.contains("nav-open"));
  await page.click('.tool-nav-link[data-tool="media"]');
  await page.waitForFunction(() => location.hash.indexOf("#media/") === 0, { timeout: 5000 });
  const afterMedia = await page.evaluate(() => ({
    hash: location.hash,
    gifActive: document.getElementById("gifmaker")?.classList.contains("is-workspace-active"),
    drawerClosed: !document.body.classList.contains("nav-open"),
    subnav: !document.getElementById("media-subnav")?.hidden,
  }));
  await page.click('[data-media-tab="vbb"]');
  await page.waitForFunction(() => location.hash === "#media/vbb", { timeout: 5000 });
  const mobileShell = {
    drawerOpen,
    afterMedia,
    hashVbb: await page.evaluate(() => location.hash),
    vbbActive: await page.evaluate(() =>
      document.getElementById("vbb")?.classList.contains("is-workspace-active")
    ),
    onlyOneActive: await page.evaluate(
      () => document.querySelectorAll(".tool-panel.is-workspace-active").length === 1
    ),
  };

  // 媒体 Tab 应 replace 而非堆历史；最近使用不应被默认排序灌满
  const histBefore = await page.evaluate(() => history.length);
  await page.click('[data-media-tab="gifmaker"]');
  await page.waitForFunction(() => location.hash === "#media/gifmaker", { timeout: 5000 });
  await page.click('[data-media-tab="vsplit"]');
  await page.waitForFunction(() => location.hash === "#media/vsplit", { timeout: 5000 });
  const shellFixes = await page.evaluate((prevLen) => {
    const recentRaw = localStorage.getItem("devtools-tool-recent-v1");
    let recent = [];
    try {
      recent = JSON.parse(recentRaw || "[]");
    } catch (_) {}
    const search = document.getElementById("tool-search");
    if (search) {
      search.value = "vbb";
      search.dispatchEvent(new Event("input", { bubbles: true }));
    }
    const mediaVisible = ![...document.querySelectorAll('.tool-nav-link[data-tool="media"]')].some((a) =>
      a.classList.contains("is-filtered-out")
    );
    const comingGone = !document.getElementById("coming");
    return {
      historyGrew: history.length > prevLen + 1,
      historyLength: history.length,
      prevLen,
      recentCount: recent.length,
      recentLooksDefault:
        recent.length >= 6 &&
        recent[0] === "timestamp" &&
        recent[1] === "timediff" &&
        recent[2] === "cron",
      searchFindsMedia: mediaVisible,
      comingGone,
      noDragOnMobile: [...document.querySelectorAll(".tool-nav-link")].every((a) => a.draggable === false),
    };
  }, histBefore);

  await browser.close();
  server.close();

  const problems = [];
  if (errors.length) problems.push(`page errors: ${errors.join(" | ")}`);
  if (!result.hasSection) problems.push("missing #vbb");
  if (!result.hasNav) problems.push("missing media nav");
  if (!result.mediaActive) problems.push("media nav should be active for #vbb");
  if (!result.vbbActive) problems.push("vbb panel should be workspace-active");
  if (result.hash !== "#media/vbb") problems.push(`legacy #vbb should redirect, got ${result.hash}`);
  if (!result.mediaSubnavVisible) problems.push("media subnav should show");
  if (!result.orderHasMedia) problems.push("nav missing media entry");
  if (result.noLegacyMediaNav === false) problems.push("legacy gifmaker/vsplit/vbb nav links should be gone");
  if (!result.version.includes("2026.08.13")) problems.push(`bad version ${result.version}`);
  if (result.analyzeDisabled !== true) problems.push("analyze should start disabled");
  if (result.runDisabled !== true) problems.push("run should start disabled");
  if (!result.ids.every((x) => x.ok)) problems.push("missing ids");
  if (!afterAnalyze.rows) problems.push("no plan rows after analyze");
  if (afterAnalyze.cards !== 3) problems.push(`expected 3 compare cards, got ${afterAnalyze.cards}`);
  if (afterAnalyze.runDisabled !== false) problems.push("run should enable after analyze");
  if (!durationMode.active) problems.push("duration mode not active");
  if (!sharpMode.active) problems.push("sharp mode not active");
  if (!/宽\s*[4-7][0-9]{2}|宽[4-7][0-9]{2}/.test(sharpMode.summary + sharpMode.cardText)) {
    problems.push("sharp mode missing width hint");
  }
  // 1280 源 + 短片：锐度档应能抬到 >420
  if (!/宽\s*(?:480|540|600|660|720)|宽(?:480|540|600|660|720)/.test(sharpMode.summary + sharpMode.cardText)) {
    problems.push(`sharp mode should widen above 420 for 1280 source: ${sharpMode.summary}`);
  }
  if (!analyze.ready) problems.push("GIF_TOOL_VERSION missing");
  if (!afterRun.clips || !afterRun.previews) problems.push(`execute preview missing: ${JSON.stringify(afterRun)}`);
  if (afterRun.errorVisible) problems.push(`execute error: ${afterRun.errorText}`);
  if (!todayTools.vsplit) problems.push("missing video split tool");
  if (!todayTools.gifm) problems.push("missing gif merge UI");
  if (!todayTools.vbbSharp) problems.push("missing sharp mode");
  if (todayTools.mediaTabs !== 3) problems.push("media subnav should have 3 tabs");
  if (!mobileShell.drawerOpen) problems.push("mobile drawer failed to open");
  if (!mobileShell.afterMedia.gifActive) problems.push("media entry should open gif tab");
  if (!mobileShell.afterMedia.drawerClosed) problems.push("drawer should close after navigate");
  if (mobileShell.hashVbb !== "#media/vbb") problems.push(`media tab switch hash: ${mobileShell.hashVbb}`);
  if (!mobileShell.vbbActive) problems.push("vbb tab switch failed");
  if (!mobileShell.onlyOneActive) problems.push("more than one panel active");
  if (shellFixes.historyGrew) problems.push("media tab switches should replaceState, not grow history much");
  if (shellFixes.recentLooksDefault) problems.push("recent list looks like default order padding");
  if (!shellFixes.searchFindsMedia) problems.push("search vbb should match media");
  if (!shellFixes.comingGone) problems.push("#coming placeholder should be removed");
  if (!shellFixes.noDragOnMobile) problems.push("mobile nav links should not be draggable");

  if (problems.length) {
    console.error("FAIL", {
      problems,
      result,
      afterAnalyze,
      durationMode,
      sharpMode,
      afterRun,
      analyze,
      todayTools,
      mobileShell,
      shellFixes,
      errors,
    });
    process.exit(1);
  }
  console.log("vbb-smoke: all passed", {
    version: result.version,
    rows: afterAnalyze.rows,
    cards: afterAnalyze.cards,
    clips: afterRun.clips,
    sharp: sharpMode.summary.slice(0, 90),
    mobile: mobileShell.hashVbb,
    shellFixes,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
