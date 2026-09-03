#!/usr/bin/env node
"use strict";

const fs = require("fs");
const http = require("http");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TOOLS = path.join(ROOT, "tools");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function staticChecks() {
  execSync("node --check tools/piano.js", { cwd: ROOT, stdio: "inherit" });
  const html = fs.readFileSync(path.join(TOOLS, "panels/piano.html"), "utf8");
  const js = fs.readFileSync(path.join(TOOLS, "piano.js"), "utf8");
  const css = fs.readFileSync(path.join(TOOLS, "styles/panels/piano.css"), "utf8");
  const registry = fs.readFileSync(path.join(TOOLS, "registry/tools.json"), "utf8");
  const lazy = fs.readFileSync(path.join(TOOLS, "lib/lazy-scripts.js"), "utf8");
  const oss = fs.readFileSync(path.join(TOOLS, "lib/oss-deps.js"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(TOOLS, "panels/manifest.json"), "utf8"));

  assert(html.includes('id="piano"'), "panel id");
  assert(html.includes('id="piano-kb"') && html.includes('id="piano-engine"'), "toolbar ids");
  assert(html.includes("kevinsqi/react-piano") && html.includes("danigb/soundfont-player"), "attribution");
  assert(js.includes("KEY_BINDS") && js.includes("Soundfont"), "js core");
  assert(css.includes(".piano-kb") && css.includes(".piano-black"), "css");
  assert(registry.includes('"piano"') && /"name": "在线钢琴"/.test(registry), "registry meta");
  assert(/piano:\s*"\.\/piano\.js"/.test(lazy), "TOOL_FILES");
  assert(lazy.includes('"piano"'), "standalone/no_pure");
  assert(oss.includes("react-piano") && oss.includes("soundfont-player"), "oss-deps");
  assert(manifest.panels.some((p) => p.id === "piano"), "manifest");
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
};

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
    const rel = urlPath === "/" ? "/tools/index.html" : urlPath;
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

async function getPuppeteer() {
  try {
    return require("puppeteer-core");
  } catch (_) {
    execSync("npm install --no-save puppeteer-core@23", { stdio: "pipe", cwd: "/tmp" });
    return require("/tmp/node_modules/puppeteer-core");
  }
}

function chromePath() {
  const cands = [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/local/bin/google-chrome",
  ];
  return cands.find((p) => fs.existsSync(p));
}

async function browserChecks() {
  const server = await startServer();
  const port = server.address().port;
  let browser;
  try {
    const puppeteer = await getPuppeteer();
    const executablePath = chromePath();
    if (!executablePath) throw new Error("chrome not found");
    browser = await puppeteer.launch({
      executablePath,
      headless: true,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => {
      try {
        localStorage.removeItem("devtools-tool-last-v1");
        sessionStorage.removeItem("devtools-tool-last-session-v1");
        localStorage.removeItem("devtools-piano-v1");
      } catch (_) {}
    });
    await page.setViewport({ width: 1280, height: 900 });
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err.message || err)));
    await page.goto(`http://127.0.0.1:${port}/tools/index.html#piano`, {
      waitUntil: "load",
      timeout: 90000,
    });
    await page.waitForFunction(() => Boolean(window.DevToolsNav), { timeout: 30000 });
    await page.evaluate(async () => {
      await window.DevToolsNav.whenRouteSettled();
    });
    await page.waitForFunction(
      () => Boolean(document.querySelector("#piano.tool-panel.is-workspace-active")),
      { timeout: 90000 }
    );
    await page.waitForFunction(
      () => document.querySelectorAll("#piano-kb .piano-white").length >= 50,
      { timeout: 30000 }
    );
    const counts = await page.evaluate(() => ({
      white: document.querySelectorAll("#piano-kb .piano-white").length,
      black: document.querySelectorAll("#piano-kb .piano-black").length,
      c4: Boolean(document.querySelector('#piano-kb [data-midi="60"]')),
      a0: Boolean(document.querySelector('#piano-kb [data-midi="21"]')),
      c8: Boolean(document.querySelector('#piano-kb [data-midi="108"]')),
      binds: window.PianoTool?.keyBinds?.length || 0,
    }));
    assert(counts.white === 52, `white keys ${counts.white}`);
    assert(counts.black === 36, `black keys ${counts.black}`);
    assert(counts.c4 && counts.a0 && counts.c8, "missing A0/C4/C8");
    assert(counts.binds >= 30, `key binds ${counts.binds}`);

    await page.keyboard.down("q");
    await page.waitForFunction(
      () => document.querySelector('#piano-kb [data-midi="60"]')?.classList.contains("is-active"),
      { timeout: 5000 }
    );
    const now = await page.$eval("#piano-now", (el) => el.textContent || "");
    assert(/C4/.test(now), `now text ${now}`);
    await page.keyboard.up("q");

    await page.keyboard.down("z");
    await page.waitForFunction(
      () => document.querySelector('#piano-kb [data-midi="48"]')?.classList.contains("is-active"),
      { timeout: 5000 }
    );
    await page.keyboard.up("z");

    await page.click('#piano-kb [data-midi="64"]', { delay: 40 });
    assert(!errors.length, `pageerror: ${errors.join("; ")}`);
  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise((r) => server.close(r));
  }
}

async function main() {
  staticChecks();
  await browserChecks();
  console.log("piano-smoke ok");
}

main().catch((err) => {
  console.error("piano-smoke FAIL:", err.message || err);
  process.exit(1);
});
