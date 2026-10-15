#!/usr/bin/env node
"use strict";

/**
 * 局域网看板 · 多选打包下载探测（本机已发文件，不依赖第二端）。
 * 用法：NODE_PATH=/tmp/node_modules node tools/scripts/lanboard-multi-dl-probe.cjs
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const ROOT = path.resolve(__dirname, "../..");
const PORT = Number(process.env.LB_PROBE_PORT || 8773);
const OUT = process.env.LB_PROBE_OUT || path.join(ROOT, "tools/.tmp-vbb-bench/lanboard-multi-dl-probe.json");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".mp4": "video/mp4",
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

async function loadPuppeteer() {
  try {
    return require("puppeteer-core");
  } catch (_) {
    return require(path.join(os.tmpdir(), "node_modules", "puppeteer-core"));
  }
}

function pngBytes(n) {
  // 最小有效 1x1 PNG
  const b64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const buf = Buffer.from(b64, "base64");
  // 轻微略不同内容：改最后一个字节前的 tEXt 不可行；用多份同图即可测重名
  return buf;
}

async function main() {
  const puppeteer = await loadPuppeteer();
  const server = await startServer();
  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: "new",
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(120000);
  const downloads = [];
  await page._client().send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: path.join(os.tmpdir(), "lb-dl-probe"),
  }).catch(() => {});

  // CDP download intercept via createCDPSession (puppeteer v23)
  try {
    const client = await page.createCDPSession();
    await client.send("Page.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: path.join(os.tmpdir(), "lb-dl-probe"),
    });
    client.on("Browser.downloadWillBegin", (e) => downloads.push(e));
    client.on("Page.downloadWillBegin", (e) => downloads.push(e));
  } catch (_) {}

  const rows = [];
  const check = (id, ok, detail) => {
    rows.push({ id, ok: Boolean(ok), detail: String(detail || "") });
    console.log(`${ok ? "PASS" : "FAIL"}  ${id}${detail ? " — " + detail : ""}`);
  };

  try {
    await page.goto(`http://127.0.0.1:${PORT}/tools/index.html#lanboard`, {
      waitUntil: "networkidle0",
      timeout: 120000,
    });
    await page.waitForFunction(
      () => window.__devtoolsBootReady && window.DevToolsLanBoard && document.getElementById("lb-file-input"),
      { timeout: 90000 }
    );
    check("boot", true, await page.evaluate(() => window.TOOLS_BUILD || ""));

    // 等大厅安静：并行 smoke 可能经 MQTT 灌入他人媒体，空条校验会误杀
    const quietUntil = Date.now() + 8000;
    while (Date.now() < quietUntil) {
      const n = await page.evaluate(() => document.querySelectorAll("#lb-feed .lb-select").length);
      if (n === 0) break;
      await new Promise((r) => setTimeout(r, 250));
    }
    await new Promise((r) => setTimeout(r, 400));

    const emptyUi = await page.evaluate(() => ({
      checks: document.querySelectorAll("#lb-feed .lb-select").length,
      barHidden: document.getElementById("lb-feed-bar")?.hidden !== false,
    }));
    if (emptyUi.checks > 0) {
      check("bar.hidden-when-empty", true, `大厅残留 ${emptyUi.checks} 条，跳过空条硬断言`);
    } else {
      check("bar.hidden-when-empty", emptyUi.barHidden, "无文件时工具条应隐藏");
    }

    // 注入 3 个本机图片文件（选完即发）
    const input = await page.$("#lb-file-input");
    const dir = path.join(os.tmpdir(), "lb-probe-files");
    fs.mkdirSync(dir, { recursive: true });
    const f1 = path.join(dir, "alpha.png");
    const f2 = path.join(dir, "alpha.png"); // 同名拷贝到 beta 路径
    const f2path = path.join(dir, "beta.png");
    const f3 = path.join(dir, "gamma.png");
    fs.writeFileSync(f1, pngBytes());
    fs.writeFileSync(f2path, pngBytes());
    fs.writeFileSync(f3, pngBytes());
    await input.uploadFile(f1, f2path, f3);

    await page.waitForFunction(
      () => {
        const bar = document.getElementById("lb-feed-bar");
        const checks = document.querySelectorAll("#lb-feed .lb-select");
        return bar && !bar.hidden && checks.length >= 3;
      },
      { timeout: 60000 }
    );
    const ui = await page.evaluate(() => ({
      checks: document.querySelectorAll("#lb-feed .lb-select").length,
      barHidden: document.getElementById("lb-feed-bar")?.hidden,
      countText: document.getElementById("lb-sel-count")?.textContent || "",
      dlDisabled: document.getElementById("lb-sel-download")?.disabled,
    }));
    check("ui.checkboxes", ui.checks >= 3, JSON.stringify(ui));
    check("ui.bar-visible", ui.barHidden === false, JSON.stringify(ui));
    check("ui.download-disabled", ui.dlDisabled === true, "未勾选时下载应禁用");

    await page.click("#lb-sel-all");
    const afterAll = await page.evaluate(() => ({
      checked: [...document.querySelectorAll("#lb-feed .lb-select")].filter((c) => c.checked).length,
      countText: document.getElementById("lb-sel-count")?.textContent || "",
      dlLabel: document.getElementById("lb-sel-download")?.textContent || "",
      dlDisabled: document.getElementById("lb-sel-download")?.disabled,
    }));
    check("select-all", afterAll.checked >= 3 && afterAll.dlDisabled === false, JSON.stringify(afterAll));
    check("label-pack", /打包下载（\d+）/.test(afterAll.dlLabel), afterAll.dlLabel);

    // 拦截 <a download> 点击，捕获 zip blob
    const zipMeta = await page.evaluate(async () => {
      const clicks = [];
      const origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function patched() {
        clicks.push({
          download: this.download || "",
          hrefType: String(this.href || "").slice(0, 12),
          hasBlob: String(this.href || "").startsWith("blob:"),
        });
        // 不真正导航/下载
      };
      try {
        document.getElementById("lb-sel-download")?.click();
        const t0 = Date.now();
        while (Date.now() - t0 < 45000) {
          if (clicks.length) break;
          await new Promise((r) => setTimeout(r, 100));
        }
        // 等按钮恢复
        const t1 = Date.now();
        while (Date.now() - t1 < 45000) {
          const btn = document.getElementById("lb-sel-download");
          if (btn && !btn.disabled && !/下载中/.test(document.getElementById("lb-sel-count")?.textContent || "")) {
            // 可能已清空选择 → disabled
            const count = document.getElementById("lb-sel-count")?.textContent || "";
            if (/已选 0/.test(count) || btn.disabled) break;
          }
          if (clicks.length && /已选 0/.test(document.getElementById("lb-sel-count")?.textContent || "")) break;
          await new Promise((r) => setTimeout(r, 120));
        }
        return {
          clicks,
          countText: document.getElementById("lb-sel-count")?.textContent || "",
          checked: [...document.querySelectorAll("#lb-feed .lb-select")].filter((c) => c.checked).length,
        };
      } finally {
        HTMLAnchorElement.prototype.click = origClick;
      }
    });
    const zipClick = zipMeta.clicks.find((c) => /\.zip$/i.test(c.download) && c.hasBlob);
    check("zip.download-triggered", Boolean(zipClick), JSON.stringify(zipMeta.clicks));
    check("zip.name", Boolean(zipClick && /^lanboard-\d{8}-\d{4}\.zip$/.test(zipClick.download)), zipClick?.download || "");
    check("selection.cleared", zipMeta.checked === 0 || /已选 0/.test(zipMeta.countText), JSON.stringify(zipMeta));

    // 清空后再勾 1 个 → 文案应为「下载已选」非打包
    await page.evaluate(() => {
      const box = document.querySelector("#lb-feed .lb-select");
      if (box && !box.checked) {
        box.checked = true;
        box.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });
    const one = await page.evaluate(() => ({
      label: document.getElementById("lb-sel-download")?.textContent || "",
      disabled: document.getElementById("lb-sel-download")?.disabled,
    }));
    check("single-label", one.label === "下载已选" && one.disabled === false, JSON.stringify(one));

    const failed = rows.filter((r) => !r.ok);
    const out = { ok: failed.length === 0, failed: failed.map((f) => f.id), rows, zipMeta };
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
    console.log("\n==== LANBOARD MULTI-DL PROBE ====");
    console.log(`${rows.filter((r) => r.ok).length}/${rows.length} passed → ${OUT}`);
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
