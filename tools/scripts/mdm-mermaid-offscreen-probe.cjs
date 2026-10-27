#!/usr/bin/env node
"use strict";

/**
 * Mermaid 离屏 container 根治校验（Chrome）：
 * 1) 无第三参：body 上会出现临时 svg[id^=mmd]（复现旧闪条）
 * 2) 有 stage：渲染全程 body 直接子级不得出现该临时节点
 * 3) MDM 面板真实路径：预览出图 + MutationObserver 无 body 闪挂 + stage 存在
 * 4) 坏语法：不在 body 底部留 Syntax error 大图
 */

const fs = require("fs");
const http = require("http");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const TOOLS = path.join(ROOT, "tools");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
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
  ].filter(Boolean);
  return cands.find((p) => fs.existsSync(p));
}

function installPuppeteerCore(dir) {
  let lastErr;
  for (let i = 1; i <= 3; i++) {
    try {
      execSync("npm install --no-save --prefer-offline puppeteer-core@25", {
        stdio: "pipe",
        cwd: dir,
        env: { ...process.env, npm_config_fetch_retries: "5", npm_config_fetch_retry_maxtimeout: "60000" },
      });
      return;
    } catch (e) {
      lastErr = e;
      console.log(`probe: puppeteer-core 安装第 ${i} 次失败，重试…`);
    }
  }
  throw lastErr;
}

async function getPuppeteer() {
  try {
    return require("puppeteer-core");
  } catch (_) {
    const dir = os.tmpdir();
    installPuppeteerCore(dir);
    return require(path.join(dir, "node_modules", "puppeteer-core"));
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
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

function staticSourceChecks() {
  const js = fs.readFileSync(path.join(TOOLS, "extra-panels/mdm.js"), "utf8");
  const css = fs.readFileSync(path.join(TOOLS, "styles/panels/mdm.css"), "utf8");
  assert(js.includes("function ensureMermaidStage"), "ensureMermaidStage");
  assert(/mermaid\.render\(\s*id\s*,\s*src\s*,\s*stage\s*\)/.test(js), "render third arg");
  assert(!js.includes("ensureMermaidBodyGuard"), "no body guard");
  assert(!js.includes("cloakMermaidTempNode"), "no cloak");
  assert(css.includes('body > svg[id^="mmd"]'), "css fallback");
  // stage 不得作为 CSS 选择器被压成 width:0（会毁测量）；注释里提 width:0 没关系
  assert(!/(^|[,{\s])#mdm-mermaid-stage[\s,{]/.test(css), "stage must not be a CSS hide target");
  console.log("probe: static OK");
}

async function vendorApiProbe(page, port) {
  await page.goto(`http://127.0.0.1:${port}/tools/vendor/mermaid/mermaid.min.js`, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  // 空白页加载 vendor
  await page.setContent(
    `<!doctype html><html><head><meta charset="utf-8"><title>mmd-probe</title></head>
     <body><h1>probe</h1>
     <script src="http://127.0.0.1:${port}/tools/vendor/mermaid/mermaid.min.js"></script>
     </body></html>`,
    { waitUntil: "networkidle0", timeout: 90000 }
  );
  await page.waitForFunction(() => typeof window.mermaid?.render === "function", { timeout: 30000 });

  const result = await page.evaluate(async () => {
    const good = "flowchart TD\n  A[开始] --> B[结束]";
    const bad = "flowchart TD\n  A-->";

    function watchBodyTemps(ms = 8000) {
      const hits = [];
      const obs = new MutationObserver((muts) => {
        for (const m of muts) {
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            const id = String(n.id || "");
            const isTemp =
              /^mmd/i.test(id) ||
              /^dmmd/i.test(id) ||
              n.getAttribute?.("aria-roledescription") === "error" ||
              (n.matches?.("svg") && /Syntax error in text/i.test(n.textContent || ""));
            if (n.parentElement === document.body && isTemp) {
              hits.push({
                tag: n.tagName,
                id,
                w: n.getBoundingClientRect?.().width || 0,
                text: String(n.textContent || "").slice(0, 40),
              });
            }
          }
        }
      });
      obs.observe(document.body, { childList: true });
      return {
        hits,
        stop: () => obs.disconnect(),
        wait: (t) => new Promise((r) => setTimeout(r, t)),
      };
    }

    window.mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: "dark",
    });

    // --- 1) 无 container：应能观察到 body 临时节点（旧行为） ---
    const noStageWatch = watchBodyTemps();
    let noStageSvg = "";
    try {
      const id = "mmdNoStage" + Math.random().toString(36).slice(2, 7);
      const out = await window.mermaid.render(id, good);
      noStageSvg = out.svg || "";
    } finally {
      await noStageWatch.wait(50);
      noStageWatch.stop();
      document.querySelectorAll("body > svg[id^=mmd], body > div[id^=dmmd], body > div[id^=d]").forEach((el) => {
        if (/^mmd|^dmmd|^d/i.test(el.id || "")) el.remove();
      });
    }

    // --- 2) 有 stage：渲染全程 body 不得直接挂临时节点 ---
    const stage = document.createElement("div");
    stage.id = "mdm-mermaid-stage";
    stage.setAttribute("data-mdm-mermaid-stage", "1");
    stage.style.cssText = "position:absolute;left:-10000px;top:0;width:960px;overflow:hidden;opacity:0;pointer-events:none;";
    document.body.appendChild(stage);

    const withStageWatch = watchBodyTemps();
    let withStageSvg = "";
    let stageHadChild = false;
    try {
      const id = "mmdStage" + Math.random().toString(36).slice(2, 7);
      // 在 render 中途轮询 stage 是否被写入
      const poll = setInterval(() => {
        if (stage.childElementCount > 0) stageHadChild = true;
      }, 0);
      const out = await window.mermaid.render(id, good, stage);
      clearInterval(poll);
      withStageSvg = out.svg || "";
      if (stage.childElementCount > 0) stageHadChild = true;
    } finally {
      await withStageWatch.wait(50);
      withStageWatch.stop();
      stage.innerHTML = "";
    }

    // --- 3) 坏语法 + suppress：不得在 body 留错误大图 ---
    const badWatch = watchBodyTemps();
    let badThrew = false;
    try {
      const id = "mmdBad" + Math.random().toString(36).slice(2, 7);
      await window.mermaid.render(id, bad, stage);
    } catch (_) {
      badThrew = true;
    } finally {
      await badWatch.wait(50);
      badWatch.stop();
    }
    const bodyErrorLeft = [...document.querySelectorAll("body svg[aria-roledescription=error], body > svg")].filter(
      (el) => /Syntax error in text/i.test(el.textContent || "")
    ).length;

    return {
      noStageHits: noStageWatch.hits.length,
      noStageSample: noStageWatch.hits.slice(0, 3),
      noStageSvgOk: /<svg[\s>]/i.test(noStageSvg) && !/Syntax error/i.test(noStageSvg),
      withStageHits: withStageWatch.hits.length,
      withStageSample: withStageWatch.hits.slice(0, 3),
      withStageSvgOk: /<svg[\s>]/i.test(withStageSvg) && !/Syntax error/i.test(withStageSvg),
      stageHadChild,
      badThrew,
      badBodyHits: badWatch.hits.length,
      bodyErrorLeft,
    };
  });

  assert(result.noStageSvgOk, `no-stage should still render svg: ${JSON.stringify(result)}`);
  assert(
    result.noStageHits > 0,
    `baseline: without container body must get temp nodes (got ${result.noStageHits})`
  );
  assert(result.withStageSvgOk, `with-stage svg failed: ${JSON.stringify(result)}`);
  assert(
    result.withStageHits === 0,
    `with stage, body must not get temp children: ${JSON.stringify(result.withStageSample)}`
  );
  assert(result.stageHadChild, "stage should receive mermaid temp DOM during render");
  assert(result.badThrew, "bad syntax should throw under suppressErrorRendering");
  assert(result.bodyErrorLeft === 0, `error svg left on body: ${result.bodyErrorLeft}`);
  assert(result.badBodyHits === 0, `bad render flashed body temps: ${result.badBodyHits}`);
  console.log("probe: vendor API OK", {
    noStageHits: result.noStageHits,
    withStageHits: result.withStageHits,
    stageHadChild: result.stageHadChild,
  });
}

async function mdmPanelProbe(page, port) {
  await page.evaluateOnNewDocument(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch (_) {}
    // 清掉旧 IDB，避免二次确认弹窗被跳过/卡住
    try {
      indexedDB.deleteDatabase("devtools-mdm");
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
  await page.waitForFunction(
    () => {
      if (!window.__devtoolsBootReady) return false;
      const boot = document.getElementById("devtools-boot-overlay");
      if (boot && !boot.classList.contains("is-done")) return false;
      if (document.querySelector("#mdm.is-tool-assets-loading")) return false;
      return Boolean(document.getElementById("mdm-use-idb"));
    },
    { timeout: 90000 }
  );

  // 已在本地模式则跳过确认
  const needIdb = await page.evaluate(() => {
    const layout = document.getElementById("mdm-layout");
    return !(layout && !layout.hidden && document.getElementById("mdm-new") && !document.getElementById("mdm-new").disabled);
  });
  if (needIdb) {
    await page.click("#mdm-use-idb");
    const modalYes = await page.waitForSelector('#mdm-modal:not([hidden]) [data-cf="yes"]', { timeout: 10000 }).catch(() => null);
    if (modalYes) await modalYes.click();
  }
  await page.waitForFunction(
    () => {
      const layout = document.getElementById("mdm-layout");
      const nb = document.getElementById("mdm-new");
      return layout && !layout.hidden && nb && !nb.disabled;
    },
    { timeout: 30000 }
  );

  await page
    .waitForFunction(() => document.querySelectorAll("#mdm-list [data-id]").length > 0, { timeout: 15000 })
    .catch(() => {});
  const preCount = await page.$$eval("#mdm-list [data-id]", (els) => els.length);
  if (preCount === 0) await page.click("#mdm-new");

  // 与 mdm-smoke 同构：两张 flowchart，避免 sequence 额外变量
  const BODY =
    "第一行 hello\n\n```mermaid\nflowchart TD\n  A[开始] --> B[结束]\n```\n\n```mermaid\nflowchart LR\n  X[左] --> Y[右]\n```\n";

  await page.evaluate(() => {
    window.__mmdBodyHits = [];
    if (window.__mmdBodyObs) {
      try {
        window.__mmdBodyObs.disconnect();
      } catch (_) {}
    }
    window.__mmdBodyObs = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1 || n.parentElement !== document.body) continue;
          if (n.id === "mdm-mermaid-stage" || n.getAttribute?.("data-mdm-mermaid-stage")) continue;
          const id = String(n.id || "");
          const isTemp =
            /^mmd/i.test(id) ||
            /^dmmd/i.test(id) ||
            n.getAttribute?.("aria-roledescription") === "error" ||
            (n.matches?.("svg") && /Syntax error in text/i.test(n.textContent || ""));
          if (isTemp) {
            window.__mmdBodyHits.push({
              tag: n.tagName,
              id,
              w: Math.round(n.getBoundingClientRect?.().width || 0),
            });
          }
        }
      }
    });
    window.__mmdBodyObs.observe(document.body, { childList: true });
  });

  await page.click("#mdm-editor .cm-content");
  await page.evaluate((body) => {
    const ed = document.querySelector("#mdm-editor .cm-content");
    ed.focus();
    document.execCommand("insertText", false, body);
  }, BODY);
  await page.waitForFunction(
    () => (document.querySelector("#mdm-editor .cm-content")?.innerText || "").includes("flowchart TD"),
    { timeout: 15000 }
  );
  await page.waitForFunction(
    () => /已保存|自动保存/.test(document.getElementById("mdm-save-status")?.textContent || ""),
    { timeout: 30000 }
  );

  await page.click("#mdm-mode-preview");
  try {
    await page.waitForFunction(() => document.querySelectorAll("#mdm-preview .mdm-mermaid svg").length >= 2, {
      timeout: 90000,
    });
  } catch (err) {
    const dump = await page.evaluate(() => ({
      text: (document.getElementById("mdm-preview")?.textContent || "").slice(0, 200),
      codes: document.querySelectorAll("#mdm-preview code.language-mermaid").length,
      figs: document.querySelectorAll("#mdm-preview .mdm-mermaid").length,
      svgs: document.querySelectorAll("#mdm-preview .mdm-mermaid svg").length,
      tips: [...document.querySelectorAll(".mdm-mermaid-err-tip")].map((t) => t.textContent),
      stage: !!document.getElementById("mdm-mermaid-stage"),
      mermaid: typeof window.mermaid,
      editor: (document.querySelector("#mdm-editor .cm-content")?.innerText || "").slice(0, 120),
    }));
    throw new Error(`mermaid preview timeout: ${JSON.stringify(dump)} | ${err.message}`);
  }

  const panel = await page.evaluate(() => {
    try {
      window.__mmdBodyObs?.disconnect();
    } catch (_) {}
    const figs = [...document.querySelectorAll("#mdm-preview .mdm-mermaid")];
    const svgs = figs.map((f) => f.querySelector("svg")).filter(Boolean);
    const stage = document.getElementById("mdm-mermaid-stage");
    const bodyTemps = [...document.querySelectorAll("body > svg[id^=mmd], body > div[id^=dmmd]")];
    const errTips = document.querySelectorAll(".mdm-mermaid-err-tip").length;
    const zoomBtns = document.querySelectorAll("#mdm-preview .mdm-mermaid-zoom").length;
    return {
      figCount: figs.length,
      svgCount: svgs.length,
      zoomBtns,
      stageExists: Boolean(stage),
      stageEmpty: stage ? stage.childElementCount === 0 : null,
      stageOffscreen: stage
        ? stage.getBoundingClientRect().right < 0 || Number.parseFloat(getComputedStyle(stage).left) < -100
        : null,
      bodyTempsLeft: bodyTemps.length,
      bodyHits: window.__mmdBodyHits || [],
      errTips,
      sampleW: svgs[0]?.getBoundingClientRect?.().width || 0,
    };
  });

  assert(panel.figCount >= 2, `expected >=2 mermaid figs, got ${panel.figCount}`);
  assert(panel.svgCount >= 2, `expected >=2 svgs, got ${panel.svgCount}`);
  assert(panel.zoomBtns >= 2, `zoom badges missing: ${panel.zoomBtns}`);
  assert(panel.stageExists, "mdm-mermaid-stage should exist after render");
  assert(panel.stageEmpty === true, "stage should be cleared after render");
  assert(panel.stageOffscreen === true, "stage should be offscreen");
  assert(panel.bodyTempsLeft === 0, `body temp leftovers: ${panel.bodyTempsLeft}`);
  assert(
    panel.bodyHits.length === 0,
    `MDM path flashed body temps: ${JSON.stringify(panel.bodyHits)}`
  );
  assert(panel.sampleW > 40, `rendered svg too narrow: ${panel.sampleW}`);
  assert(panel.errTips === 0, `unexpected err tips: ${panel.errTips}`);

  // 坏语法：应出 tip，不应 body 大图
  await page.click("#mdm-mode-edit");
  await page.evaluate(() => {
    window.__mmdBodyHits = [];
    window.__mmdBodyObs = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1 || n.parentElement !== document.body) continue;
          if (n.id === "mdm-mermaid-stage" || n.getAttribute?.("data-mdm-mermaid-stage")) continue;
          const id = String(n.id || "");
          const isTemp =
            /^mmd/i.test(id) ||
            /^dmmd/i.test(id) ||
            n.getAttribute?.("aria-roledescription") === "error" ||
            (n.matches?.("svg") && /Syntax error in text/i.test(n.textContent || ""));
          if (isTemp) window.__mmdBodyHits.push({ tag: n.tagName, id });
        }
      }
    });
    window.__mmdBodyObs.observe(document.body, { childList: true });
  });
  await page.click("#mdm-editor .cm-content");
  await page.evaluate(() => {
    const ed = document.querySelector("#mdm-editor .cm-content");
    ed.focus();
    document.execCommand("selectAll", false);
    document.execCommand("insertText", false, "# bad\n\n```mermaid\nflowchart TD\n  A-->\n```\n");
  });
  await page.click("#mdm-mode-preview");
  await page.waitForFunction(() => document.querySelector(".mdm-mermaid-err-tip"), { timeout: 60000 });
  const badPanel = await page.evaluate(() => {
    try {
      window.__mmdBodyObs?.disconnect();
    } catch (_) {}
    const tip = document.querySelector(".mdm-mermaid-err-tip")?.textContent || "";
    const bodyErr = [...document.querySelectorAll("body svg")].filter((el) =>
      /Syntax error in text/i.test(el.textContent || "")
    );
    return {
      tip,
      bodyErr: bodyErr.length,
      bodyHits: window.__mmdBodyHits || [],
      previewErrSvg: document.querySelectorAll('#mdm-preview svg[aria-roledescription="error"]').length,
    };
  });
  assert(/Mermaid 语法未就绪/.test(badPanel.tip), `err tip missing: ${badPanel.tip}`);
  assert(badPanel.bodyErr === 0, `error svg on body: ${badPanel.bodyErr}`);
  assert(badPanel.bodyHits.length === 0, `bad syntax body flash: ${JSON.stringify(badPanel.bodyHits)}`);
  assert(badPanel.previewErrSvg === 0, "preview should not host error svg");

  assert(errors.length === 0, `pageerror: ${errors.join(" | ")}`);
  console.log("probe: MDM panel OK", {
    figs: panel.figCount,
    svgW: Math.round(panel.sampleW),
    bodyHits: panel.bodyHits.length,
  });
}

async function main() {
  staticSourceChecks();
  execSync("node tools/test/mdm-mermaid-error.test.js", { cwd: ROOT, stdio: "inherit" });
  execSync("node tools/test/mdm-mermaid-zoom.test.js", { cwd: ROOT, stdio: "inherit" });

  const executablePath = chromePath();
  assert(executablePath, "需要 Chrome 才能做完整运行时校验");
  const puppeteer = await getPuppeteer();
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
    await vendorApiProbe(page, port);
    await mdmPanelProbe(page, port);
    console.log("mdm-mermaid-offscreen-probe: ALL PASS");
  } finally {
    try {
      await browser?.close();
    } catch (_) {}
    await new Promise((r) => server.close(r));
  }
}

main().catch((err) => {
  console.error("mdm-mermaid-offscreen-probe: FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
