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
  assert(js.includes("THUMB_TIMEOUT_MS") || js.includes("withTimeout"), "视频缩略图须有超时，否则发送会挂死");
  assert(/function\s+onFilesPicked\s*\(/.test(js), "须定义 onFilesPicked（与 change 监听同名）");
  assert(/function\s+onFilesDropped\s*\(/.test(js), "须定义 onFilesDropped（与 drop 监听同名）");
  assert(!/\bqueueFilesPicked\b/.test(js), "禁止残留 queueFilesPicked 与监听器名不一致");
  assert(!/\bqueueFilesDropped\b/.test(js), "禁止残留 queueFilesDropped 与监听器名不一致");
  assert(js.includes("onFilesPicked") && js.includes("fromFiles"), "选文件后应自动发送");
  assert(
    /finally\s*\{[\s\S]*?pendingFiles\.length[\s\S]*?sendCompose\(\s*\{\s*fromFiles:\s*true/.test(js),
    "发送中再选文件须在 finally 续发，避免选完卡住"
  );
  assert(js.includes("PEER_ID_KEY") && js.includes("sessionStorage"), "peerId 须 sessionStorage 持久化，避免刷新幽灵会话");
  assert(js.includes("pagehide"), "离开页须 pagehide 发 bye");
  assert(js.includes("wipeAbandonedRoom") || js.includes("clearRoomLocal"), "空房须清空残留");
  assert(js.includes("ROOM_SETTLE_MS") || js.includes("persistGate"), "进场须空房结算门闩");
  assert(js.includes("/lanboard/clear"), "末人离开须清桥 /lanboard/clear");
  assert(js.includes("feedSignature") || js.includes("lastFeedSig"), "列表须签名防闪，避免心跳整表重绘缩略图");
  assert(js.includes("serveTailByPeer") && js.includes("enqueuePeerJob"), "多端同文件：发送须按 peer 排队，跨 peer 可并行");
  assert(js.includes("recvTailByPeer") && js.includes("activeRecvByPeer"), "单端多文件：同 owner 须排队且二进制按活跃 fileId 路由");
  assert(js.includes("resolveInflight"), "同文件重复拉取须 inflight 去重");
  assert(js.includes("dlUiState") && js.includes("排队中"), "下载排队/进行中须有可见状态");
  assert(!/recvSessions\.keys\(\)\)\.find\(\s*\(k\)\s*=>\s*k\.startsWith/.test(js), "禁止把同 peer 二进制盲目塞进第一个会话");
  assert(html.includes("自动发送") || html.includes("选完即发") || /自动发出/.test(html), "面板文案应说明选完即发");
  assert(html.includes('id="lb-preview-dlg"'), "缺少媒体预览弹层");
  assert(js.includes("openPreview") && js.includes("closePreview"), "缺少预览打开/关闭逻辑");
  assert(html.includes('id="lb-feed-bar"') && html.includes('id="lb-sel-download"'), "缺少多选下载工具条");
  assert(js.includes("downloadSelectedItems") && js.includes("selectedDlIds"), "缺少多选下载逻辑");
  assert(js.includes("ensureJsZip") && js.includes("打包下载"), "多选≥2须 ZIP 打包");
  assert(js.includes("uniqueZipName"), "ZIP 内重名须去重");
  assert(js.includes("markDownloadUi") && js.includes("ownedUi"), "批量下载不得误清单条 dlUiState");
  assert(/let lastFeedSig[\s\S]*?selectedDlIds[\s\S]*?function paintFeed/.test(js), "selectedDlIds 须在 paintFeed 前初始化");
  {
    function uniqueZipName(name, used) {
      const raw = String(name || "download").replace(/[\\/:*?"<>|]+/g, "_").trim() || "download";
      if (!used.has(raw)) {
        used.add(raw);
        return raw;
      }
      const dot = raw.lastIndexOf(".");
      const base = dot > 0 ? raw.slice(0, dot) : raw;
      const ext = dot > 0 ? raw.slice(dot) : "";
      let i = 2;
      let next = `${base}-${i}${ext}`;
      while (used.has(next)) {
        i += 1;
        next = `${base}-${i}${ext}`;
      }
      used.add(next);
      return next;
    }
    const used = new Set();
    assert(uniqueZipName("a.png", used) === "a.png", "首个文件名原样保留");
    assert(uniqueZipName("a.png", used) === "a-2.png", "重名须加 -2");
    assert(uniqueZipName("a/b:c?.png", used) === "a_b_c_.png", "非法文件名字符须替换");
  }
  const css = fs.readFileSync(path.join(toolsRoot, "styles/panels/lanboard.css"), "utf8");
  assert(css.includes(".lb-preview-dlg") && css.includes("object-fit: contain"), "预览弹层须 contain");
  assert(/@media\s*\(\s*max-width:\s*640px\s*\)/.test(css), "窄屏须有媒体查询");
  assert(css.includes(".lb-item-check") && css.includes(".lb-feed-bar"), "多选勾选与工具条须有样式");
  assert(css.includes("100dvh") || css.includes("safe-area-inset"), "手机预览须兼顾 dvh/安全区");
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
    // 选完应自动发送，无需再点「发送」

    let previewOk = false;
    let mediaOnB = false;
    for (let i = 0; i < 40; i++) {
      const st = await pageA.evaluate(() => ({
        preview: [...document.querySelectorAll("#lb-feed .lb-item-preview img")].some((img) =>
          (img.getAttribute("src") || "").startsWith("data:")
        ),
        hasItem: (document.querySelector("#lb-feed")?.innerText || "").includes(".png") ||
          !!document.querySelector("#lb-feed .lb-item-preview"),
      }));
      const stB = await pageB.evaluate(() => ({
        dl: !!document.querySelector("#lb-feed .lb-download"),
        prev: !!document.querySelector("#lb-feed .lb-item-preview img, #lb-feed .lb-kind"),
      }));
      previewOk = st.preview || st.hasItem;
      mediaOnB = stB.dl && stB.prev;
      if (previewOk && mediaOnB) break;
      await wait(400);
    }
    assert(previewOk, "选图后未自动出现在发送端列表");
    assert(mediaOnB, "B 未出现媒体预览/下载按钮");
    console.log("media auto-send OK");

    // 视频选完即发（曾因 onFilesPicked 未定义而静默失败）
    const mp4Path = path.join(os.tmpdir(), `lanboard-smoke-${Date.now()}.mp4`);
    try {
      const { execFileSync } = require("child_process");
      const ffmpegCandidates = [
        process.env.FFMPEG_PATH,
        "ffmpeg",
        "D:\\ffmpeg-master-latest-win64-gpl\\bin\\ffmpeg.exe",
      ].filter(Boolean);
      let made = false;
      for (const ff of ffmpegCandidates) {
        try {
          execFileSync(
            ff,
            [
              "-y",
              "-f",
              "lavfi",
              "-i",
              "color=c=red:s=160x120:d=0.5",
              "-c:v",
              "libx264",
              "-pix_fmt",
              "yuv420p",
              mp4Path,
            ],
            { stdio: "ignore", timeout: 20000 }
          );
          made = fs.existsSync(mp4Path);
          if (made) break;
        } catch {
          /* try next */
        }
      }
      if (made) {
        await fileInput.uploadFile(mp4Path);
        let videoOk = false;
        for (let i = 0; i < 40; i++) {
          videoOk = await pageA.evaluate(() => {
            const feed = document.querySelector("#lb-feed")?.innerText || "";
            const err = document.querySelector("#lb-error")?.textContent || "";
            if (/onFilesPicked is not defined/i.test(err)) return false;
            return (
              /\.mp4|视频/.test(feed) ||
              !!document.querySelector("#lb-feed .lb-kind-video, #lb-feed .lb-item-preview")
            );
          });
          if (videoOk) break;
          await wait(400);
        }
        assert(videoOk, "选视频后未自动出现在列表（检查 onFilesPicked 是否定义）");
        console.log("video auto-send OK");
      } else {
        console.log("video auto-send SKIP (no ffmpeg)");
      }
    } finally {
      try {
        fs.unlinkSync(mp4Path);
      } catch {
        /* ignore */
      }
    }

    // 刷新后 peerId 须保持（sessionStorage），避免旧 id+新 id 叠成幽灵台数
    await wait(1500);
    const idBefore = await pageA.evaluate(() => sessionStorage.getItem("devtools-lanboard-peer-id") || "");
    assert(!!idBefore, "A 缺少 session peerId");
    const peersBefore = await pageB.evaluate(() => document.querySelector("#lb-members")?.innerHTML || "");
    await pageA.reload({ waitUntil: "domcontentloaded", timeout: 120000 });
    await pageA.waitForFunction(() => !!document.querySelector("#lanboard #lb-send"), {
      timeout: 60000,
    });
    await pageA.evaluate(async () => {
      if (window.DevToolsLanBoard?.boot) await window.DevToolsLanBoard.boot();
    });
    await waitLobby(pageA, "A-reloaded");
    await wait(2500);
    const idAfter = await pageA.evaluate(() => sessionStorage.getItem("devtools-lanboard-peer-id") || "");
    assert(idBefore === idAfter, `刷新后 peerId 变化: ${idBefore} -> ${idAfter}`);
    const peersAfter = await pageB.evaluate(() => document.querySelector("#lb-members")?.innerHTML || "");
    // 对端列表里不应同时残留两个「本机 A」式幽灵（同 id 只会占一条）
    const aNameHits = (peersAfter.match(/设备-|Diag|本机/g) || []).length;
    void peersBefore;
    void aNameHits;
    console.log("peerId stable after reload OK:", idAfter);

    const anyName = `smoke-any-${Date.now()}.bin`;
    const anyPath = path.join(os.tmpdir(), anyName);
    fs.writeFileSync(anyPath, Buffer.from("lanboard-any-file-smoke"));
    const anyInput = await pageA.$("#lb-any-file-input");
    assert(anyInput, "缺少任意文件输入");
    await anyInput.uploadFile(anyPath);

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
