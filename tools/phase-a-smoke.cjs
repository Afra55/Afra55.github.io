#!/usr/bin/env node
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const PORT = 8771;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
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
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => {
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function getPuppeteer() {
  try {
    return require("puppeteer-core");
  } catch (_) {
    execSync("npm install --no-save puppeteer-core@23", { stdio: "pipe", cwd: "/tmp" });
    return require("/tmp/node_modules/puppeteer-core");
  }
}

async function openPage(browser, hash, viewport) {
  const toolId = String(hash || "").replace(/^#/, "");
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.removeItem("devtools-tool-last-v1");
      sessionStorage.removeItem("devtools-tool-last-session-v1");
    } catch (_) {}
  });
  if (viewport) await page.setViewport(viewport);
  await page.goto(`http://127.0.0.1:${PORT}/tools/index.html${hash}`, {
    waitUntil: "load",
    timeout: 90000,
  });
  await page.waitForFunction(() => Boolean(window.DevToolsNav), { timeout: 30000 });
  await page.evaluate(async () => {
    await window.DevToolsNav.whenRouteSettled();
  });
  const ok = await page
    .waitForFunction(
      (id) => Boolean(document.querySelector(`#${id}.tool-panel.is-workspace-active`)),
      { timeout: 90000 },
      toolId
    )
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    const snap = await page.evaluate(() => ({
      hash: location.hash,
      title: document.querySelector("#workspace-title")?.textContent || "",
      panels: [...document.querySelectorAll(".tool-panel")].map((p) => ({
        id: p.id,
        active: p.classList.contains("is-workspace-active"),
        hidden: p.hidden,
      })),
    }));
    throw new Error(`panel not active: ${toolId} · ${JSON.stringify(snap)}`);
  }
  return page;
}

async function main() {
  const problems = [];
  const server = await startServer();
  let browser;
  try {
    const puppeteer = await getPuppeteer();
    browser = await puppeteer.launch({
      executablePath: "/usr/bin/google-chrome-stable",
      headless: true,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });

    const bootPage = await openPage(browser, "#json", { width: 1280, height: 800 });
    const boot = await bootPage.evaluate(() => ({
      registry: Boolean(window.DEVTOOLS_REGISTRY),
      groupCount: window.DEVTOOLS_REGISTRY?.groups?.length || 0,
      metaCount: Object.keys(window.DEVTOOLS_REGISTRY?.meta || {}).length,
      navScale: Boolean(window.DevToolsNavScale),
      navLinks: document.querySelectorAll(".tool-nav-link").length,
      navMeta: Object.keys(window.DevToolsCatalog?.meta || {}).length,
      defaultOrder: window.DevToolsNav?.DEFAULT_ORDER?.length || 0,
    }));

    if (!boot.registry) problems.push("DEVTOOLS_REGISTRY missing");
    if (boot.groupCount !== 14) problems.push(`groups=${boot.groupCount}`);
    if (boot.metaCount !== 67) problems.push(`meta=${boot.metaCount}`);
    if (!boot.navScale) problems.push("DevToolsNavScale missing");
    if (boot.navLinks < 60) problems.push(`navLinks=${boot.navLinks}`);
    if (boot.navMeta !== 67) problems.push(`DevToolsCatalog.meta=${boot.navMeta}`);
    if (boot.defaultOrder !== 67) problems.push(`defaultOrder=${boot.defaultOrder}`);

    const searchInput = await bootPage.$("#tool-search");
    if (!searchInput) problems.push("tool-search missing");
    else {
      await searchInput.type("黑盒");
      await new Promise((r) => setTimeout(r, 200));
      const search = await bootPage.evaluate(() => {
        const visible = [...document.querySelectorAll(".tool-nav-link")].filter(
          (l) => !l.classList.contains("is-filtered-out")
        );
        return { visible: visible.length, ids: visible.map((l) => l.dataset.tool) };
      });
      if (!search.ids.includes("vbb")) problems.push("search 黑盒 missing vbb");
      if (search.visible > 8) problems.push(`search too broad: ${search.visible}`);
    }
    await bootPage.close();

    const vbbPage = await openPage(browser, "#vbb", { width: 1280, height: 800 });
    const vbb = await vbbPage.evaluate(() => ({
      title: document.querySelector("#workspace-title")?.textContent || "",
      hasPanel: Boolean(document.getElementById("vbb")),
    }));
    await vbbPage.close();
    if (!vbb.hasPanel) problems.push("vbb panel missing");
    if (!/黑盒/.test(vbb.title)) problems.push(`vbb title: ${vbb.title}`);

    const mobilePage = await openPage(browser, "#json", {
      width: 390,
      height: 844,
      isMobile: true,
      hasTouch: true,
    });
    const mobile = await mobilePage.evaluate(() => ({
      title: document.querySelector("#workspace-title")?.textContent || "",
      navOpenBtn: Boolean(document.querySelector("#nav-open")),
    }));
    await mobilePage.close();
    if (!/JSON/i.test(mobile.title)) problems.push(`mobile title: ${mobile.title}`);

    if (problems.length) {
      console.error("phase-a-smoke: FAIL\n" + problems.map((p) => `  - ${p}`).join("\n"));
      process.exit(1);
    }
    console.log(JSON.stringify({ ok: true, boot, vbb, mobile }, null, 2));
  } finally {
    await browser?.close();
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
