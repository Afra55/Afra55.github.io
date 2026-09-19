#!/usr/bin/env node
"use strict";

/**
 * Markdown 文档管理（mdm）浏览器冒烟：
 * 进入本地存储模式 → 新建 → 编辑 → 保存 → 列表 → 搜索 → 预览 → 无 pageerror
 * 找不到 Chrome/Edge 或 puppeteer 时 SKIP（不判失败）。
 */

const fs = require("fs");
const http = require("http");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const TOOLS = path.join(ROOT, "tools");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function staticChecks() {
  execSync("node --check tools/extra-panels/mdm.js", { cwd: ROOT, stdio: "inherit" });
  execSync("node --check tools/lib/mdm-pure.js", { cwd: ROOT, stdio: "inherit" });
  const html = fs.readFileSync(path.join(TOOLS, "panels/mdm.html"), "utf8");
  const js = fs.readFileSync(path.join(TOOLS, "extra-panels/mdm.js"), "utf8");
  const registry = fs.readFileSync(path.join(TOOLS, "registry/tools.json"), "utf8");
  const lazy = fs.readFileSync(path.join(TOOLS, "lib/lazy-scripts.js"), "utf8");
  const oss = fs.readFileSync(path.join(TOOLS, "lib/oss-deps.js"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(TOOLS, "panels/manifest.json"), "utf8"));

  assert(html.includes('id="mdm"'), "panel id");
  assert(html.includes('id="mdm-use-idb"') && html.includes('id="mdm-pick-dir"'), "mode buttons");
  assert(html.includes('id="mdm-editor"') && html.includes('id="mdm-preview"'), "editor/preview");
  assert(html.includes('id="mdm-modal"'), "modal host");
  assert(html.includes('role="listbox"'), "list aria role");
  assert(js.includes("DevToolsMdmPure") && js.includes("buildLibraryZip"), "js core");
  assert(registry.includes('"Markdown 文档管理"'), "registry meta");
  assert(/mdm:\s*"\.\/extra-panels\/mdm\.js"/.test(lazy), "TOOL_FILES");
  assert(lazy.includes('"mdmpure"'), "mdmpure vendor");
  assert(oss.includes("CodeMirror 6") && oss.includes("Mermaid"), "oss-deps");
  assert(manifest.panels.some((p) => p.id === "mdm"), "manifest");
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".ttf": "font/ttf",
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
    const dir = os.tmpdir();
    execSync("npm install --no-save puppeteer-core@23", { stdio: "pipe", cwd: dir });
    return require(path.join(dir, "node_modules", "puppeteer-core"));
  }
}

function chromePath() {
  const cands = [
    process.env.DEVTOOLS_CHROME_PATH,
    process.env.CHROME_PATH,
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/local/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  ].filter(Boolean);
  return cands.find((p) => {
    try {
      return fs.existsSync(p);
    } catch (_) {
      return false;
    }
  });
}

const TITLE = "冒烟文档 A";
const BODY = "第一行 hello\n\n- [ ] 待办一\n- [x] 待办二\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\n```mermaid\nflowchart TD\n  A[开始] --> B[结束]\n```";

async function browserChecks() {
  const executablePath = chromePath();
  if (!executablePath) {
    console.log("mdm-smoke SKIP: 未找到 Chrome/Edge（可用 DEVTOOLS_CHROME_PATH 指定）");
    return;
  }
  let puppeteer;
  try {
    puppeteer = await getPuppeteer();
  } catch (err) {
    console.log(`mdm-smoke SKIP: puppeteer-core 不可用（${err.message || err}）`);
    return;
  }
  const server = await startServer();
  const port = server.address().port;
  let browser;
  try {
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
      } catch (_) {}
    });
    await page.setViewport({ width: 1400, height: 950 });
    const errors = [];
    page.on("pageerror", (err) => errors.push(String(err.message || err)));
    await page.goto(`http://127.0.0.1:${port}/tools/index.html#mdm`, {
      waitUntil: "load",
      timeout: 90000,
    });
    await page.waitForFunction(() => Boolean(window.DevToolsNav), { timeout: 30000 });
    await page.evaluate(async () => {
      await window.DevToolsNav.whenRouteSettled();
    });
    await page.waitForFunction(
      () => Boolean(document.querySelector("#mdm.tool-panel.is-workspace-active")),
      { timeout: 90000 }
    );
    await page.waitForFunction(
      () => window.DevToolsLazy?.isToolReady?.("mdm") && Boolean(window.DevToolsMdmPure),
      { timeout: 90000 }
    );
    // 等启动遮罩退场 + 懒加载结束，否则点击会被 overlay 吃掉
    await page.waitForFunction(
      () => {
        if (!window.__devtoolsBootReady) return false;
        const boot = document.getElementById("devtools-boot-overlay");
        if (boot && !boot.classList.contains("is-done")) return false;
        if (document.querySelector("#mdm.is-tool-assets-loading")) return false;
        if (document.querySelector('#mdm[aria-busy="true"]')) return false;
        return Boolean(document.getElementById("mdm-use-idb"));
      },
      { timeout: 90000 }
    );

    // 1) 进入本地存储模式（二次确认弹窗）
    await page.click("#mdm-use-idb");
    await page.waitForSelector('#mdm-modal:not([hidden]) [data-cf="yes"]', { timeout: 10000 });
    await page.click('#mdm-modal [data-cf="yes"]');
    await page.waitForFunction(
      () => {
        const layout = document.getElementById("mdm-layout");
        const nb = document.getElementById("mdm-new");
        return layout && !layout.hidden && nb && !nb.disabled;
      },
      { timeout: 30000 }
    );

    // 2) 新建 + 命名
    console.log("STEP new");
    await page.click("#mdm-new");
    await page.click("#mdm-title", { clickCount: 3 });
    await page.keyboard.type(TITLE);
    console.log("STEP new:typed");
    await page.waitForFunction(
      (t) => (document.querySelector("#mdm-list")?.textContent || "").includes(t),
      { timeout: 15000 },
      TITLE
    );
    console.log("STEP title-ok");

    // 3) 编辑正文（CM6）：用一次性插入避开自动续行对表格的干扰
    await page.click("#mdm-editor .cm-content");
    await page.evaluate((body) => {
      const ed = document.querySelector("#mdm-editor .cm-content");
      ed.focus();
      document.execCommand("insertText", false, body);
    }, BODY);
    console.log("STEP body-typed");
    await page.waitForFunction(
      (b) => (document.querySelector("#mdm-editor .cm-content")?.innerText || "").includes(b),
      { timeout: 15000 },
      "第一行 hello"
    );
    console.log("STEP body-ok");

    // 4) 保存（自动保存 1.8s 后应写入；按钮此时可能已因保存完而置灰）
    await page.waitForFunction(
      () => /已保存|自动保存/.test(document.getElementById("mdm-save-status")?.textContent || ""),
      { timeout: 30000 }
    );
    console.log("STEP saved");

    // 5) 列表
    const listCount = await page.$$eval("#mdm-list [data-id]", (els) => els.length);
    assert(listCount === 1, `list count ${listCount}`);

    // 6) 搜索：命中 1 篇；无结果时列表显示空提示
    await page.click("#mdm-search");
    await page.keyboard.type("冒烟文档");
    await page.waitForFunction(
      () => {
        const items = document.querySelectorAll("#mdm-list [data-id]").length;
        const c = document.getElementById("mdm-count")?.textContent || "";
        return items === 1 && /\b1\b/.test(c);
      },
      { timeout: 15000 }
    );
    console.log("STEP search-hit");
    await page.click("#mdm-search", { clickCount: 3 });
    await page.keyboard.type("zzz不存在zzz");
    await page.waitForFunction(
      () => {
        const items = document.querySelectorAll("#mdm-list [data-id]").length;
        const t = document.getElementById("mdm-list")?.textContent || "";
        return items === 0 && /没有匹配/.test(t);
      },
      { timeout: 15000 }
    );
    console.log("STEP search-empty");
    await page.evaluate(() => {
      const s = document.getElementById("mdm-search");
      if (s) {
        s.value = "";
        s.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });

    // 7) 预览：正文 + 任务列表复选框可点击
    await page.click("#mdm-mode-preview");
    await page.waitForFunction(
      () => (document.querySelector("#mdm-preview")?.textContent || "").includes("第一行 hello"),
      { timeout: 20000 }
    );
    const taskCbs = await page.$$eval("#mdm-preview input.mdm-task-cb", (els) => els.length);
    assert(taskCbs === 2, `task checkboxes ${taskCbs}`);
    assert(
      (await page.$$eval("#mdm-preview input.mdm-task-cb", (els) => els.filter((e) => e.disabled).length)) === 0,
      "task checkboxes should be clickable"
    );
    assert(
      (await page.$$eval("#mdm-preview table", (els) => els.length)) >= 1,
      "table should render in preview"
    );
    // Mermaid 需懒加载 5MB vendor，给足时间
    await page.waitForFunction(() => Boolean(document.querySelector("#mdm-preview .mdm-mermaid svg")), {
      timeout: 60000,
    });
    console.log("STEP mermaid-ok");

    // 8) 侧栏大纲 & 快捷键弹窗
    await page.click("#mdm-insert-toggle");
    await page.click('[data-insert="help"]');
    await page.waitForSelector('#mdm-modal:not([hidden]) .mdm-keys', { timeout: 10000 });
    await page.click('#mdm-modal [data-mdl="close"]');

    // 9) 表格编辑：对齐应写回 :---:
    await page.click("#mdm-mode-edit");
    const tableEl = await page.evaluateHandle(() => {
      const ls = [...document.querySelectorAll("#mdm-editor .cm-line")];
      return ls.find((l) => /^\|\s*A\s*\|/.test(l.textContent || "")) || null;
    });
    const te = tableEl.asElement();
    assert(te, "table line not found in editor");
    {
      const b = await te.boundingBox();
      await page.mouse.click(b.x + 12, b.y + b.height / 2);
    }
    await page.click("#mdm-insert-toggle");
    await page.click('[data-insert="tableedit"]');
    await page.waitForSelector("#mdm-modal:not([hidden]) .mdm-grid", { timeout: 10000 });
    await page.select('#mdm-modal select[data-align="1"]', "center");
    await page.click('#mdm-modal [data-mdl="ok"]');
    await page.waitForFunction(
      () => [...document.querySelectorAll("#mdm-editor .cm-line")].some((l) => /:---:/.test(l.textContent || "")),
      { timeout: 10000 }
    );
    console.log("STEP table-align-ok");

    assert(!errors.length, `pageerror: ${errors.join("; ")}`);
    console.log("mdm-smoke ok (idb/new/save/list/search/preview/mermaid/table)");
  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise((r) => server.close(r));
  }
}

async function main() {
  staticChecks();
  await browserChecks();
}

main().catch((err) => {
  console.error("mdm-smoke FAIL:", err.message || err);
  process.exit(1);
});
