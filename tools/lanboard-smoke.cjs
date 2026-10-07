#!/usr/bin/env node
"use strict";

/**
 * 局域网看板冒烟：静态校验 +（可选）两标签浏览器流。
 * 用法: node tools/lanboard-smoke.cjs [baseUrl]
 */

const fs = require("fs");
const path = require("path");
const http = require("http");
const { execSync } = require("child_process");
const os = require("os");

const toolsRoot = path.resolve(__dirname);
const repoRoot = path.resolve(__dirname, "..");
const SOURCE_GONE = "源设备已离开，仅可预览";
const BASE = process.argv[2] || "http://127.0.0.1:8080/tools/";

function fail(msg) {
  console.error("lanboard-smoke FAIL:", msg);
  process.exit(1);
}

function assert(cond, msg) {
  if (!cond) fail(msg);
}

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function staticCheck() {
  const files = [
    "lanboard.js",
    "panels/lanboard.html",
    "styles/panels/lanboard.css",
    "lanboard-bridge/server.js",
  ];
  for (const f of files) {
    assert(fs.existsSync(path.join(toolsRoot, f)), `缺少 ${f}`);
  }
  const js = fs.readFileSync(path.join(toolsRoot, "lanboard.js"), "utf8");
  assert(js.includes("devtools-lanboard"), "缺少大厅 slug/proto");
  assert(js.includes(SOURCE_GONE), "缺少源离开文案");
  assert(js.includes("/lanboard/"), "缺少桥 API 路径");
  const html = fs.readFileSync(path.join(toolsRoot, "panels/lanboard.html"), "utf8");
  assert(html.includes('id="lanboard"'), "面板 id 不对");
  assert(html.includes('id="lb-send"'), "缺少发送按钮");
  assert(html.includes('id="lb-any-file-input"'), "缺少任意文件输入");
  assert(/accept=["']\*\/\*["']/.test(html), "任意文件 accept 应为 */*");
  assert(js.includes("sendFile") || js.includes("fileKindOf"), "缺少任意文件发送逻辑");
  assert(!js.includes("仅支持图片或视频"), "仍限制仅图片/视频");
  const reg = JSON.parse(fs.readFileSync(path.join(toolsRoot, "registry/tools.json"), "utf8"));
  assert(reg.meta?.lanboard, "registry 缺 lanboard");
  assert((reg.groups.find((g) => g.id === "device")?.tools || []).includes("lanboard"), "device 组未挂 lanboard");
  const lazy = fs.readFileSync(path.join(toolsRoot, "lib/lazy-scripts.js"), "utf8");
  assert(/lanboard\s*:/.test(lazy), "lazy-scripts 未登记");
  const bridge = fs.readFileSync(path.join(toolsRoot, "adb-bridge/server.js"), "utf8");
  assert(bridge.includes("loadLanboardBridge"), "统一桥未挂载 lanboard");
  assert(bridge.includes("/lanboard"), "统一桥缺 /lanboard 路由");
  const zip = fs.readFileSync(path.join(toolsRoot, "lib/unified-bridge-bundle.js"), "utf8");
  assert(zip.includes("lanboard-bridge"), "完整包未含 lanboard-bridge");
  const bf = JSON.parse(fs.readFileSync(path.join(toolsRoot, "bridge-files.json"), "utf8"));
  assert((bf.files || []).includes("lanboard-bridge/server.js"), "bridge-files 缺 lanboard");
  console.log("lanboard-smoke: static OK");
}

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean);
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return "";
}

async function browserFlow() {
  let puppeteer;
  try {
    puppeteer = require("puppeteer-core");
  } catch {
    try {
      puppeteer = require("puppeteer");
    } catch {
      console.log("lanboard-smoke: 无 puppeteer，跳过浏览器流");
      return { skipped: true };
    }
  }
  const exe = chromePath();
  if (!exe && !puppeteer.executablePath) {
    console.log("lanboard-smoke: 未找到 Chrome，跳过浏览器流");
    return { skipped: true };
  }

  const browser = await puppeteer.launch({
    headless: "new",
    executablePath: exe || undefined,
    protocolTimeout: 180000,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--use-fake-ui-for-media-stream",
      "--autoplay-policy=no-user-gesture-required",
      "--disable-dev-shm-usage",
    ],
  });

  try {
    const pageA = await browser.newPage();
    const pageB = await browser.newPage();
    const url = BASE.replace(/\/?$/, "/") + "#lanboard";

    pageA.setDefaultTimeout(60000);
    pageB.setDefaultTimeout(60000);
    pageA.setDefaultNavigationTimeout(120000);
    pageB.setDefaultNavigationTimeout(120000);

    // 串行进页：避免单线程静态服被双标签并发打爆
    await pageA.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    await pageA.waitForFunction(() => !!document.querySelector("#lanboard #lb-send"), { timeout: 60000 });
    await pageB.goto(url, { waitUntil: "domcontentloaded", timeout: 120000 });
    await pageB.waitForFunction(() => !!document.querySelector("#lanboard #lb-send"), { timeout: 60000 });

    await pageA.evaluate(async () => {
      if (window.DevToolsLanBoard?.boot) await window.DevToolsLanBoard.boot();
    });
    await pageB.evaluate(async () => {
      if (window.DevToolsLanBoard?.boot) await window.DevToolsLanBoard.boot();
    });

    const waitLobby = async (page, label) => {
      for (let i = 0; i < 40; i++) {
        const st = await page.evaluate(() => ({
          title: document.querySelector("#lb-status-title")?.textContent || "",
          text: document.querySelector("#lb-status-text")?.textContent || "",
        }));
        if (/大厅在场|信令已连/.test(st.title + st.text)) {
          console.log(`lobby ${label}:`, `${st.title} | ${st.text}`);
          return st;
        }
        await wait(400);
      }
      const st = await page.evaluate(() => ({
        title: document.querySelector("#lb-status-title")?.textContent || "",
        text: document.querySelector("#lb-status-text")?.textContent || "",
      }));
      fail(`${label} 未连上大厅: ${st.title} | ${st.text}`);
    };

    await waitLobby(pageA, "A");
    await waitLobby(pageB, "B");
    await wait(2500);

    const marker = `smoke-${Date.now()}`;
    await pageA.evaluate((text) => {
      const ta = document.querySelector("#lb-text");
      ta.value = text;
      document.querySelector("#lb-send").click();
    }, marker);

    let seen = false;
    for (let i = 0; i < 30; i++) {
      seen = await pageB.evaluate((m) => (document.querySelector("#lb-feed")?.innerText || "").includes(m), marker);
      if (seen) break;
      await wait(400);
    }
    assert(seen, `标签 B 未看到文字「${marker}」`);
    console.log("text sync OK");

    const hasCopy = await pageB.evaluate(() => !!document.querySelector(".lb-copy"));
    assert(hasCopy, "缺少复制按钮");
    await pageB.evaluate(() => document.querySelector(".lb-copy")?.click());

    const pngB64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC";
    const pngPath = path.join(os.tmpdir(), `lanboard-smoke-${Date.now()}.png`);
    fs.writeFileSync(pngPath, Buffer.from(pngB64, "base64"));

    const fileInput = await pageA.$("#lb-file-input");
    assert(fileInput, "缺少文件输入");
    await fileInput.uploadFile(pngPath);
    await wait(200);
    await pageA.evaluate(() => document.querySelector("#lb-send")?.click());

    let previewOk = false;
    let mediaOnB = false;
    for (let i = 0; i < 30; i++) {
      const st = await pageA.evaluate(() => ({
        preview: [...document.querySelectorAll("#lb-feed .lb-item-preview img")].some((img) =>
          (img.getAttribute("src") || "").startsWith("data:")
        ),
      }));
      const stB = await pageB.evaluate(() => ({
        dl: !!document.querySelector("#lb-feed .lb-download"),
        prev: !!document.querySelector("#lb-feed .lb-item-preview img, #lb-feed .lb-kind"),
      }));
      previewOk = st.preview;
      mediaOnB = stB.dl && stB.prev;
      if (previewOk && mediaOnB) break;
      await wait(400);
    }
    assert(previewOk, "发送端无图片预览");
    assert(mediaOnB, "B 未出现媒体预览/下载按钮");
    console.log("media preview OK");

    const anyName = `smoke-any-${Date.now()}.bin`;
    const anyPath = path.join(os.tmpdir(), anyName);
    fs.writeFileSync(anyPath, Buffer.from("lanboard-any-file-smoke"));
    const anyInput = await pageA.$("#lb-any-file-input");
    assert(anyInput, "缺少任意文件输入");
    await anyInput.uploadFile(anyPath);
    await wait(200);
    await pageA.evaluate(() => document.querySelector("#lb-send")?.click());

    let anyOnB = false;
    for (let i = 0; i < 30; i++) {
      anyOnB = await pageB.evaluate((name) => {
        const feed = document.querySelector("#lb-feed")?.innerText || "";
        const hasName = feed.includes(name);
        const hasFileKind = [...document.querySelectorAll("#lb-feed .lb-kind-file")].length > 0;
        const dlCount = document.querySelectorAll("#lb-feed .lb-download").length;
        return hasName && hasFileKind && dlCount >= 2;
      }, anyName);
      if (anyOnB) break;
      await wait(400);
    }
    assert(anyOnB, `B 未看到任意文件「${anyName}」`);
    console.log("any file sync OK");

    // 关掉源页；再等 bye / presence 过期；必要时强制刷新列表态
    const ownerId = await pageA.evaluate(() => {
      const row = [...document.querySelectorAll("#lb-feed .lb-item")].find((el) =>
        el.querySelector(".lb-download")
      );
      return row?.getAttribute("data-id") || "";
    });
    await pageA.close();
    await wait(3000);

    // 若 bye 未触发，用超时前的强制：点下载应提示；先等 prune
    let gone = { ok: false };
    for (let i = 0; i < 25; i++) {
      gone = await pageB.evaluate((tip) => {
        const btn = document.querySelector("#lb-feed .lb-download");
        if (!btn) return { ok: false, reason: "no download btn" };
        // 触发一次 paint：点下载
        btn.click();
        const hint = document.querySelector("#lb-feed .lb-dl-hint")?.textContent || "";
        const toast = document.getElementById("lb-toast")?.textContent || "";
        const info = document.getElementById("lb-info")?.textContent || "";
        const err = document.getElementById("lb-error")?.textContent || "";
        const blob = `${hint}\n${toast}\n${info}\n${err}`;
        return { ok: blob.includes(tip), hint, toast, info, err, blob };
      }, SOURCE_GONE);
      if (gone.ok) break;
      await wait(1000);
    }
    assert(gone.ok, `源离开后未提示「${SOURCE_GONE}」: ${JSON.stringify(gone)} (media=${ownerId})`);

    try {
      fs.unlinkSync(pngPath);
    } catch {
      /* ignore */
    }
    try {
      fs.unlinkSync(anyPath);
    } catch {
      /* ignore */
    }

    console.log("lanboard-smoke: browser OK");
    return { skipped: false };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  staticCheck();
  execSync("node tools/scripts/verify-registry.cjs", { cwd: repoRoot, stdio: "inherit" });
  const result = await browserFlow();
  if (result.skipped) {
    fail("浏览器流被跳过，无法认定两标签校验通过");
  }
  console.log("lanboard-smoke: ALL PASS");
}

main().catch((e) => {
  console.error(e);
  fail(e?.message || String(e));
});
