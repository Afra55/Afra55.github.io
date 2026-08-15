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
        "vbb-plan-compare",
        "vbb-list",
      ].map((id) => ({ id, ok: Boolean(document.getElementById(id)) })),
      orderHasMedia: false,
      footerText: document.querySelector(".site-footer")?.textContent || "",
      homeLinkCount: [...document.querySelectorAll("a")].filter((a) => /返回主站/.test(a.textContent || "")).length,
      footerHomeHref: [...document.querySelectorAll(".site-footer a")].some((a) => a.getAttribute("href") === "/"),
      vbbPreload: document.getElementById("vbb-video")?.getAttribute("preload") || "",
      v2gPreload: document.getElementById("v2g-video")?.getAttribute("preload") || "",
      vsplitPreload: document.getElementById("vsplit-video")?.getAttribute("preload") || "",
      autoRelease: Boolean(window.DevToolsTemp?.autoReleaseOnLeave),
      hasReleaseOnLeave: typeof window.DevToolsTemp?.releaseOnLeave === "function",
      hasCacheBtn: Boolean(document.getElementById("nav-cache-clear")),
      hasCacheMeta: Boolean(document.getElementById("nav-cache-meta")),
      hasPurge: typeof window.DevToolsTemp?.purgeSiteCache === "function",
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
  const localPick = await page.evaluate(() => ({
    meta: document.getElementById("vbb-meta")?.textContent || "",
    preload: document.getElementById("vbb-video")?.preload || "",
    blobCount: window.DevToolsTemp?.blobStats?.().count || 0,
  }));
  if (!/本地文件，不上传/.test(localPick.meta)) {
    throw new Error(`select should show local-only hint, got: ${localPick.meta}`);
  }
  if (localPick.preload !== "metadata") {
    throw new Error(`vbb video preload should be metadata, got ${localPick.preload}`);
  }

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
    const eq = document.getElementById("vbb-equalize");
    return {
      summary,
      runDisabled,
      rows,
      cards,
      equalizeExists: Boolean(eq),
      equalizeChecked: Boolean(eq?.checked),
      hookEqualize: Boolean(window.DevToolsVbb?.isEqualize?.()),
    };
  });
  if (!afterAnalyze.equalizeExists) throw new Error("missing #vbb-equalize switch");
  if (afterAnalyze.equalizeChecked || afterAnalyze.hookEqualize) {
    throw new Error("equalize should default off");
  }

  // 自定义时长：4s 视频目标 3s → 前段 3.0s、末段 1.0s，不得均分成 2.0s
  await page.click("#vbb-mode-custom");
  await page.evaluate(() => {
    const el = document.getElementById("vbb-target-span");
    el.value = "3";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const customRemainder = await page.evaluate(() => {
    const plan = window.DevToolsVbb?.getActivePlan?.();
    const reuse = window.DevToolsVbb?.shouldReuseFirstPlan;
    return {
      summary: document.getElementById("vbb-plan-summary")?.textContent || "",
      count: plan?.count,
      spans: (plan?.ranges || []).map((r) => Number(r.span.toFixed(3))),
      starts: (plan?.ranges || []).map((r) => Number(r.start.toFixed(3))),
      planRows: document.querySelectorAll("#vbb-plan-list .vbb-plan-row").length,
      reuseMid: typeof reuse === "function" ? reuse(plan?.ranges || [], 1) : null,
      reuseLast: typeof reuse === "function" ? reuse(plan?.ranges || [], (plan?.ranges || []).length - 1) : null,
    };
  });
  if (customRemainder.count !== 2 || customRemainder.spans[0] !== 3 || Math.abs(customRemainder.spans[1] - 1) > 0.05) {
    throw new Error(`custom remainder split failed: ${JSON.stringify(customRemainder)}`);
  }
  if (!/前1段 3\.0s/.test(customRemainder.summary) || !/末段 1\.0s/.test(customRemainder.summary)) {
    throw new Error(`custom summary should show remainder split, got: ${customRemainder.summary}`);
  }
  if (customRemainder.planRows) throw new Error("plan list estimates should stay hidden");
  if (customRemainder.reuseMid !== false || customRemainder.reuseLast !== false) {
    throw new Error(`2-clip plan must not reuse last clip: ${JSON.stringify(customRemainder)}`);
  }

  await page.click("#vbb-equalize");
  const customEqualize = await page.evaluate(() => {
    const plan = window.DevToolsVbb?.getActivePlan?.();
    return {
      checked: Boolean(document.getElementById("vbb-equalize")?.checked),
      summary: document.getElementById("vbb-plan-summary")?.textContent || "",
      count: plan?.count,
      spans: (plan?.ranges || []).map((r) => Number(r.span.toFixed(3))),
    };
  });
  if (!customEqualize.checked) throw new Error("equalize checkbox should turn on");
  if (customEqualize.count !== 2 || customEqualize.spans.some((s) => Math.abs(s - 2) > 0.05)) {
    throw new Error(`equalize should split 4s/3s into 2×2s, got ${JSON.stringify(customEqualize)}`);
  }
  if (!/每段 2\.0s/.test(customEqualize.summary) || /末段/.test(customEqualize.summary)) {
    throw new Error(`equalize summary should be even spans, got: ${customEqualize.summary}`);
  }

  await page.click("#vbb-equalize");
  const customEqualizeOff = await page.evaluate(() => {
    const plan = window.DevToolsVbb?.getActivePlan?.();
    return {
      checked: Boolean(document.getElementById("vbb-equalize")?.checked),
      summary: document.getElementById("vbb-plan-summary")?.textContent || "",
      spans: (plan?.ranges || []).map((r) => Number(r.span.toFixed(3))),
    };
  });
  if (customEqualizeOff.checked) throw new Error("equalize should turn off");
  if (customEqualizeOff.spans[0] !== 3 || Math.abs(customEqualizeOff.spans[1] - 1) > 0.05) {
    throw new Error(`turning equalize off should restore 3+1, got ${JSON.stringify(customEqualizeOff)}`);
  }

  // 均分打开时切换预设不应报错，且关均分后自定义仍是末段剩余
  await page.click("#vbb-equalize");
  await page.click("#vbb-mode-clarity");
  await page.click("#vbb-mode-duration");
  await page.click("#vbb-mode-custom");
  await page.click("#vbb-equalize");
  const afterModeSwitch = await page.evaluate(() => {
    const plan = window.DevToolsVbb?.getActivePlan?.();
    return {
      checked: Boolean(document.getElementById("vbb-equalize")?.checked),
      spans: (plan?.ranges || []).map((r) => Number(r.span.toFixed(3))),
      errors: document.getElementById("vbb-error")?.textContent || "",
    };
  });
  if (afterModeSwitch.checked) throw new Error("equalize should stay off after mode switch");
  if (afterModeSwitch.spans[0] !== 3 || Math.abs(afterModeSwitch.spans[1] - 1) > 0.05) {
    throw new Error(`mode switch with toggle should keep remainder, got ${JSON.stringify(afterModeSwitch)}`);
  }

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
    return list && list.querySelectorAll(".vsplit-clip").length > 0;
  }, { timeout: 180000 });

  const afterRun = await page.evaluate(() => {
    const clips = document.querySelectorAll("#vbb-list .vsplit-clip").length;
    const downloads = [...document.querySelectorAll("#vbb-list a[download]")].length;
    const mergeDisabled = document.getElementById("vbb-merge")?.disabled;
    const err = document.getElementById("vbb-error");
    return {
      clips,
      downloads,
      mergeDisabled,
      errorVisible: err ? !err.hidden && Boolean(err.textContent) : false,
      errorText: err?.textContent || "",
    };
  });

  // 2.4s / 0.8s → 3 段等长：中间段应沿用 #01，末段独立探测
  const tmpReuse = "/tmp/vbb-smoke-reuse.mp4";
  execSync(
    `ffmpeg -y -f lavfi -i testsrc=size=1280x720:rate=30:duration=2.4 -f lavfi -i sine=f=440:d=2.4 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest ${tmpReuse}`,
    { stdio: "pipe" }
  );
  await input.uploadFile(tmpReuse);
  await page.waitForFunction(() => {
    const b = document.getElementById("vbb-analyze");
    return b && !b.disabled;
  }, { timeout: 15000 });
  await page.click("#vbb-analyze");
  await page.waitForFunction(() => {
    const plan = document.getElementById("vbb-plan");
    return plan && !plan.hidden;
  }, { timeout: 180000 });
  await page.click("#vbb-mode-custom");
  await page.evaluate(() => {
    const el = document.getElementById("vbb-target-span");
    el.value = "0.8";
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const reusePlan = await page.evaluate(() => {
    const plan = window.DevToolsVbb?.getActivePlan?.();
    const reuse = window.DevToolsVbb?.shouldReuseFirstPlan;
    const ranges = plan?.ranges || [];
    return {
      count: plan?.count,
      spans: ranges.map((r) => Number(r.span.toFixed(3))),
      flags: ranges.map((_, i) => (typeof reuse === "function" ? reuse(ranges, i) : null)),
    };
  });
  if (reusePlan.count !== 3 || reusePlan.spans.some((s) => Math.abs(s - 0.8) > 0.05)) {
    throw new Error(`reuse plan should be 3×0.8s, got ${JSON.stringify(reusePlan)}`);
  }
  if (reusePlan.flags[0] !== false || reusePlan.flags[1] !== true || reusePlan.flags[2] !== false) {
    throw new Error(`reuse flags should be [false,true,false], got ${JSON.stringify(reusePlan)}`);
  }
  await page.click("#vbb-run");
  await page.waitForFunction(() => {
    const notes = window.DevToolsVbb?.getClips?.() || [];
    return notes.length >= 3 && notes.every((c) => c.gifBlob || c.error);
  }, { timeout: 180000 });
  const reuseRun = await page.evaluate(() => {
    const clips = window.DevToolsVbb?.getClips?.() || [];
    return clips.map((c) => ({
      span: Number((c.span || 0).toFixed(3)),
      note: c.gifNote || "",
      error: c.error || "",
      hasBlob: Boolean(c.gifBlob),
    }));
  });
  if (reuseRun.length !== 3 || reuseRun.some((c) => !c.hasBlob || c.error)) {
    throw new Error(`reuse encode failed: ${JSON.stringify(reuseRun)}`);
  }
  if (/沿用#01/.test(reuseRun[0].note)) throw new Error(`#01 should probe, got ${reuseRun[0].note}`);
  if (!/沿用#01/.test(reuseRun[1].note)) throw new Error(`#02 should reuse #01, got ${reuseRun[1].note}`);
  if (/沿用#01/.test(reuseRun[2].note)) throw new Error(`last clip should not reuse, got ${reuseRun[2].note}`);

  const cleanup = await page.evaluate(async () => {
    const before = window.DevToolsTemp?.blobStats?.() || { count: -1, bytes: -1 };
    const revoked = window.DevToolsTemp?.releaseOnLeave?.() ?? -1;
    const after = window.DevToolsTemp?.blobStats?.() || { count: -1 };
    const videoSrc = document.getElementById("vbb-video")?.getAttribute("src") || "";
    const analyzeDisabled = document.getElementById("vbb-analyze")?.disabled;
    return {
      beforeCount: before.count,
      beforeBytes: before.bytes,
      revoked,
      afterCount: after.count,
      videoSrc,
      analyzeDisabled,
      unloading: Boolean(window.DevToolsTemp?.isUnloading),
    };
  });
  if (!(cleanup.beforeCount > 0)) {
    throw new Error(`expected tracked blobs before leave-cleanup, got ${JSON.stringify(cleanup)}`);
  }
  if (cleanup.afterCount !== 0) {
    throw new Error(`leave-cleanup should revoke blobs, got ${JSON.stringify(cleanup)}`);
  }
  if (cleanup.videoSrc) throw new Error(`video src should be cleared, got ${cleanup.videoSrc}`);
  if (cleanup.analyzeDisabled !== true) throw new Error("analyze should disable after leave-cleanup");

  const todayTools = await page.evaluate(() => ({
    vsplit: Boolean(document.getElementById("vsplit")),
    gifm: Boolean(document.getElementById("gifm-merge") && document.getElementById("gifm-file")),
    vbbSharp: Boolean(document.getElementById("vbb-mode-sharp")),
    mediaTabs: document.querySelectorAll("#media-subnav [data-media-tab]").length,
    vsplitManualMode: Boolean(document.getElementById("vsplit-mode-m")),
    vsplitMarks: Boolean(document.getElementById("vsplit-marks")),
  }));

  // Mobile drawer + media tab switch
  await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
  await page.goto(`http://127.0.0.1:${PORT}/tools/index.html#timestamp`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  });
  const cacheUi = await page.evaluate(async () => {
    const btn = document.getElementById("nav-cache-clear");
    const meta = document.getElementById("nav-cache-meta");
    const inNav = Boolean(document.getElementById("nav-bar")?.contains(btn));
    const result = await window.DevToolsTemp.purgeSiteCache();
    let idbGone = true;
    try {
      const dbs = typeof indexedDB.databases === "function" ? await indexedDB.databases() : [];
      idbGone = !(dbs || []).some((d) => String(d?.name || "").includes("ffmpeg"));
    } catch (_) {}
    return {
      inNav,
      btnText: (btn?.textContent || "").trim(),
      hasMeta: Boolean(meta),
      msg: result?.message || "",
      blobs: window.DevToolsTemp.blobStats().count,
      hasPurgeEngine: typeof window.DevToolsTemp.purgePersistedEngine === "function",
      idbGone,
    };
  });
  if (!cacheUi.inNav || cacheUi.btnText !== "一键清理缓存") {
    throw new Error(`sidebar cache button missing: ${JSON.stringify(cacheUi)}`);
  }
  if (!cacheUi.msg || cacheUi.blobs !== 0) {
    throw new Error(`purgeSiteCache failed: ${JSON.stringify(cacheUi)}`);
  }
  await page.click("#nav-open");
  const drawerOpen = await page.evaluate(() => document.body.classList.contains("nav-open"));
  await page.click("#nav-close");
  const closedByBtn = await page.evaluate(() => !document.body.classList.contains("nav-open"));
  // 模拟部分手机：关闭后焦点回到「工具」并再次合成 click
  await page.evaluate(() => document.getElementById("nav-open")?.click());
  const stayedClosedAfterGhostOpen = await page.evaluate(
    () => !document.body.classList.contains("nav-open")
  );
  // Safari pageshow / 回前台应强制关闭
  await new Promise((r) => setTimeout(r, 500));
  await page.click("#nav-open");
  await page.waitForFunction(() => document.body.classList.contains("nav-open"), { timeout: 5000 });
  await page.evaluate(() => {
    window.dispatchEvent(new Event("pageshow"));
  });
  const closedByPageshow = await page.evaluate(() => !document.body.classList.contains("nav-open"));
  const defaultClosedStyle = await page.evaluate(() => {
    const nav = document.getElementById("nav-bar");
    const cs = getComputedStyle(nav);
    return {
      visibility: cs.visibility,
      pointerEvents: cs.pointerEvents,
      hasNavOpen: document.body.classList.contains("nav-open"),
    };
  });
  // 再等防抖窗口后正常打开
  await new Promise((r) => setTimeout(r, 500));
  await page.click("#nav-open");
  await page.waitForFunction(() => document.body.classList.contains("nav-open"), { timeout: 5000 });
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
    closedByBtn,
    stayedClosedAfterGhostOpen,
    closedByPageshow,
    defaultClosedStyle,
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

  // 手动选段：打点、改时长、按标记算 range（新开页，避免前面重活拖垮会话）
  const pageMarks = await browser.newPage();
  pageMarks.on("pageerror", (err) => errors.push(`marks: ${String(err)}`));
  await pageMarks.goto(`http://127.0.0.1:${PORT}/tools/index.html#media/vsplit`, {
    waitUntil: "networkidle0",
    timeout: 60000,
  });
  const vsplitInput = await pageMarks.$("#vsplit-file");
  await vsplitInput.uploadFile(tmpMp4);
  await pageMarks.waitForFunction(() => {
    const b = document.getElementById("vsplit-cut");
    return b && !b.disabled;
  }, { timeout: 15000 });
  await pageMarks.click("#vsplit-mode-m");
  const manualUi = await pageMarks.evaluate(() => {
    const row = document.getElementById("vsplit-manual-row");
    const stage = document.getElementById("vsplit-stage");
    const scrub = document.getElementById("vsplit-scrub");
    const video = document.getElementById("vsplit-video");
    return {
      mode: window.DevToolsVsplit?.getMode?.(),
      rowVisible: row ? !row.hidden : false,
      stageManual: stage?.classList.contains("is-manual"),
      scrubExists: Boolean(scrub),
      scrubDisabled: scrub?.disabled,
      videoControls: video?.hasAttribute("controls"),
      cutLabel: (document.getElementById("vsplit-cut")?.textContent || "").trim(),
      markStartDisabled: document.getElementById("vsplit-mark-start")?.disabled,
      scrubUnderVideo: Boolean(stage?.contains(scrub) && stage?.contains(video)),
    };
  });
  if (manualUi.mode !== "manual" || !manualUi.rowVisible || !manualUi.stageManual) {
    throw new Error(`manual mode UI failed: ${JSON.stringify(manualUi)}`);
  }
  if (!manualUi.scrubExists || manualUi.scrubDisabled || !manualUi.scrubUnderVideo) {
    throw new Error(`scrub UI missing/disabled: ${JSON.stringify(manualUi)}`);
  }
  if (manualUi.videoControls) {
    throw new Error("manual mode should hide native video controls");
  }
  if (manualUi.cutLabel !== "按标记切分") {
    throw new Error(`cut button should say 按标记切分, got ${manualUi.cutLabel}`);
  }
  const manualMarks = await pageMarks.evaluate(async () => {
    const video = document.getElementById("vsplit-video");
    const scrub = document.getElementById("vsplit-scrub");
    const seekByScrub = async (ratio) => {
      const max = Number(scrub.max) || 1000;
      scrub.value = String(Math.round(max * ratio));
      scrub.dispatchEvent(new Event("input", { bubbles: true }));
      scrub.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 80));
    };
    await seekByScrub(0.12);
    document.getElementById("vsplit-mark-start")?.click();
    await seekByScrub(0.55);
    document.getElementById("vsplit-mark-end")?.click();
    await seekByScrub(0.62);
    document.getElementById("vsplit-mark-start")?.click();
    await seekByScrub(0.9);
    document.getElementById("vsplit-mark-end")?.click();
    const marks = window.DevToolsVsplit?.getMarks?.() || [];
    const ranges = window.DevToolsVsplit?.computeRanges?.(Number(video.duration) || 4) || [];
    const rows = document.querySelectorAll("#vsplit-marks .vsplit-mark").length;
    const cutDisabled = document.getElementById("vsplit-cut")?.disabled;
    const gifDisabled = document.getElementById("vsplit-gif-bb")?.disabled;
    const nowText = document.getElementById("vsplit-manual-now")?.textContent || "";
    const endInp = document.querySelector('#vsplit-marks .vsplit-mark input[aria-label="片段 1 终点秒"]');
    if (endInp) {
      endInp.value = "1.8";
      endInp.dispatchEvent(new Event("change", { bubbles: true }));
    }
    const afterEdit = window.DevToolsVsplit?.getMarks?.() || [];
    return {
      marks,
      ranges,
      rows,
      cutDisabled,
      gifDisabled,
      afterEdit,
      draft: window.DevToolsVsplit?.getDraftStart?.(),
      nowText,
      scrubbedTime: Number(video.currentTime) || 0,
    };
  });
  if (manualMarks.marks.length !== 2 || manualMarks.rows !== 2) {
    throw new Error(`expected 2 marks, got ${JSON.stringify(manualMarks)}`);
  }
  if (manualMarks.cutDisabled || manualMarks.gifDisabled) {
    throw new Error(`cut/gif should enable with marks: ${JSON.stringify(manualMarks)}`);
  }
  if (!(manualMarks.scrubbedTime > 2.5)) {
    throw new Error(`scrub should seek video near end, got ${manualMarks.scrubbedTime}`);
  }
  if (Math.abs(manualMarks.afterEdit[0].end - 1.8) > 0.05) {
    throw new Error(`edit end failed: ${JSON.stringify(manualMarks.afterEdit)}`);
  }
  await pageMarks.close();

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
  if (!/2026\.08\.14/.test(result.version)) problems.push(`bad version ${result.version}`);
  if (result.analyzeDisabled !== true) problems.push("analyze should start disabled");
  if (result.runDisabled !== true) problems.push("run should start disabled");
  if (!result.ids.every((x) => x.ok)) problems.push("missing ids");
  if (result.homeLinkCount) problems.push("footer should not have 返回主站");
  if (result.footerHomeHref) problems.push("footer should not link to /");
  if (!/本地处理/.test(result.footerText || "")) problems.push("footer privacy note missing");
  if (!/关闭页面会释放/.test(result.footerText || "")) problems.push("footer should mention auto-release on close");
  if (result.vbbPreload !== "metadata") problems.push(`vbb preload should be metadata, got ${result.vbbPreload}`);
  if (result.v2gPreload !== "metadata") problems.push(`v2g preload should be metadata, got ${result.v2gPreload}`);
  if (result.vsplitPreload !== "metadata") problems.push(`vsplit preload should be metadata, got ${result.vsplitPreload}`);
  if (!result.autoRelease) problems.push("DevToolsTemp.autoReleaseOnLeave missing");
  if (!result.hasReleaseOnLeave) problems.push("DevToolsTemp.releaseOnLeave missing");
  if (!result.hasCacheBtn) problems.push("missing #nav-cache-clear in sidebar");
  if (!result.hasCacheMeta) problems.push("missing #nav-cache-meta in sidebar");
  if (!result.hasPurge) problems.push("DevToolsTemp.purgeSiteCache missing");
  if (!/侧栏/.test(result.footerText || "")) problems.push("footer should mention sidebar cache cleanup");
  if (!afterAnalyze.summary) problems.push("plan summary missing after analyze");
  if (afterAnalyze.rows) problems.push("per-clip estimate preview should be removed");
  if (/预计压/.test(afterAnalyze.summary || "")) problems.push("summary should not show per-clip compress preview");
  if (afterAnalyze.equalizeChecked) problems.push("equalize switch should default off");
  if (afterAnalyze.cards !== 3) problems.push(`expected 3 compare cards, got ${afterAnalyze.cards}`);
  if (afterAnalyze.runDisabled !== false) problems.push("run should enable after analyze");
  if (!durationMode.active) problems.push("duration mode not active");
  if (!/FPS/i.test(durationMode.summary)) problems.push("duration summary missing FPS");
  if (!sharpMode.active) problems.push("sharp mode not active");
  if (!/FPS/i.test(sharpMode.summary + sharpMode.cardText)) problems.push("sharp summary missing FPS");
  if (!/宽\s*[4-7][0-9]{2}|宽[4-7][0-9]{2}/.test(sharpMode.summary + sharpMode.cardText)) {
    problems.push("sharp mode missing width hint");
  }
  // 1280 源 + 短片：锐度档应能抬到 >420
  if (!/宽\s*(?:480|540|600|660|720)|宽(?:480|540|600|660|720)/.test(sharpMode.summary + sharpMode.cardText)) {
    problems.push(`sharp mode should widen above 420 for 1280 source: ${sharpMode.summary}`);
  }
  if (!analyze.ready) problems.push("GIF_TOOL_VERSION missing");
  if (!afterRun.clips || !afterRun.downloads) problems.push(`execute clips/download missing: ${JSON.stringify(afterRun)}`);
  if (afterRun.errorVisible) problems.push(`execute error: ${afterRun.errorText}`);
  if (!todayTools.vsplit) problems.push("missing video split tool");
  if (!todayTools.gifm) problems.push("missing gif merge UI");
  if (!todayTools.vbbSharp) problems.push("missing sharp mode");
  if (!todayTools.vsplitManualMode) problems.push("missing vsplit manual mode button");
  if (!todayTools.vsplitMarks) problems.push("missing vsplit marks list");
  if (todayTools.mediaTabs !== 3) problems.push("media subnav should have 3 tabs");
  if (!mobileShell.drawerOpen) problems.push("mobile drawer failed to open");
  if (!mobileShell.closedByBtn) problems.push("nav-close should close drawer");
  if (!mobileShell.stayedClosedAfterGhostOpen) {
    problems.push("drawer should stay closed when open button gets ghost click after close");
  }
  if (!mobileShell.closedByPageshow) problems.push("pageshow should force drawer closed");
  if (mobileShell.defaultClosedStyle?.hasNavOpen) problems.push("drawer should not stay open after pageshow");
  if (mobileShell.defaultClosedStyle?.visibility !== "hidden") {
    problems.push(`closed drawer visibility should be hidden, got ${mobileShell.defaultClosedStyle?.visibility}`);
  }
  if (mobileShell.defaultClosedStyle?.pointerEvents !== "none") {
    problems.push(`closed drawer pointer-events should be none, got ${mobileShell.defaultClosedStyle?.pointerEvents}`);
  }
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
      customRemainder,
      customEqualize,
      durationMode,
      sharpMode,
      afterRun,
      reusePlan,
      reuseRun,
      localPick,
      cleanup,
      cacheUi,
      manualUi,
      manualMarks,
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
    reuseRun,
    customRemainder,
    localPick,
    cleanup,
    cacheUi,
    manualUi,
    manualMarks,
    mobile: mobileShell.hashVbb,
    shellFixes,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
