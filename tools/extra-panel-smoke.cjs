#!/usr/bin/env node
"use strict";

/**
 * 浏览器冒烟：extra-kit 初始化 + extra-panels 按钮绑定（二维码 / UUID / Hash）
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
if (!fs.existsSync(path.join(ROOT, "tools/index.html"))) {
  throw new Error(`extra-panel-smoke: bad ROOT ${ROOT}`);
}

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
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function serverPort(server) {
  const addr = server.address();
  return typeof addr === "object" && addr ? addr.port : 8772;
}

async function getPuppeteer() {
  try {
    return require("puppeteer-core");
  } catch (_) {
    execSync("npm install --no-save puppeteer-core@23", { stdio: "pipe", cwd: "/tmp" });
    return require("/tmp/node_modules/puppeteer-core");
  }
}

async function openPage(browser, hash, port) {
  const toolId = String(hash || "").replace(/^#/, "");
  const page = await browser.newPage();
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.removeItem("devtools-tool-last-v1");
      sessionStorage.removeItem("devtools-tool-last-session-v1");
    } catch (_) {}
  });
  await page.setViewport({ width: 1280, height: 900 });
  const url = `http://127.0.0.1:${port}/tools/index.html${hash}`;
  await page.goto(url, {
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
    throw new Error(`panel not active: ${toolId}`);
  }
  // 加载条可能延迟显示，不能只靠 !is-tool-assets-loading；须等懒加载真正就绪
  // 启动遮罩未退时 Puppeteer click 会点到 overlay，须等 is-done / 移除
  await page.waitForFunction(
    (id) => {
      if (!window.__devtoolsBootReady) return false;
      const boot = document.getElementById("devtools-boot-overlay");
      if (boot && !boot.classList.contains("is-done")) return false;
      if (!window.DevToolsLazy?.isToolReady?.(id)) return false;
      if (!window.__devtoolsExtraCore || !window.DevToolsExtraKit?.$) return false;
      if (document.querySelector(`#${id}.is-tool-assets-loading`)) return false;
      if (document.querySelector(`#${id}[aria-busy="true"]`)) return false;
      return true;
    },
    { timeout: 90000 },
    toolId
  );
  return page;
}

async function testQrcode(page) {
  await page.waitForFunction(
    () => {
      const meta = document.querySelector("#qr-meta")?.textContent || "";
      const n = document.querySelector("#qr-box-wrap")?.children?.length || 0;
      return /已生成/.test(meta) || n > 0;
    },
    { timeout: 90000 }
  );
  await page.evaluate(() => {
    const wrap = document.querySelector("#qr-box-wrap");
    if (wrap) wrap.innerHTML = "";
    const meta = document.querySelector("#qr-meta");
    if (meta) meta.textContent = "";
  });
  await page.click("#qr-gen");
  await page.waitForFunction(
    () => {
      const n = document.querySelector("#qr-box-wrap")?.children?.length || 0;
      const meta = document.querySelector("#qr-meta")?.textContent || "";
      return n > 0 && /已生成/.test(meta);
    },
    { timeout: 30000 }
  );
}

async function testUuid(page) {
  await page.waitForFunction(
    () => {
      const lines = String(document.querySelector("#uuid-out")?.value || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      return (
        lines.length > 0 &&
        lines.every((line) =>
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(line)
        )
      );
    },
    { timeout: 30000 }
  );
}

async function testHash(page) {
  await page.evaluate(() => {
    const el = document.querySelector("#hash-input");
    if (el) el.value = "hello";
  });
  await page.click("#hash-run");
  await page.waitForFunction(
    () => /^[0-9a-f]{32}$/i.test(document.querySelector("#hash-md5")?.textContent || ""),
    { timeout: 30000 }
  );
}

async function main() {
  const server = await startServer();
  const port = serverPort(server);
  let browser;
  try {
    const puppeteer = await getPuppeteer();
    browser = await puppeteer.launch({
      executablePath: "/usr/bin/google-chrome-stable",
      headless: true,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });

    const qPage = await openPage(browser, "#qrcode", port);
    await testQrcode(qPage);
    await qPage.close();

    const uPage = await openPage(browser, "#uuid", port);
    await testUuid(uPage);
    await uPage.close();

    const hPage = await openPage(browser, "#hash", port);
    await testHash(hPage);
    await hPage.close();

    console.log("extra-panel-smoke ok (qrcode, uuid, hash)");
  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise((r) => server.close(r));
  }
}

main().catch((err) => {
  console.error("extra-panel-smoke FAIL:", err.message || err);
  process.exit(1);
});
