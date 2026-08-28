#!/usr/bin/env node
"use strict";

/**
 * 局域网互传冒烟：DOM、WebRTC 能力探测、邀请码编解码、三端 UA 模拟。
 * 用法：node tools/lanshare-smoke.cjs [baseUrl]
 */

const http = require("http");
const https = require("https");
const { URL } = require("url");
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const baseUrl = process.argv[2] || "http://127.0.0.1:4173/tools/";
const root = path.join(__dirname);

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "https:" ? https : http;
    mod
      .get(url, (res) => {
        let body = "";
        res.on("data", (c) => {
          body += c;
        });
        res.on("end", () => {
          if (res.statusCode >= 400) reject(new Error(`HTTP ${res.statusCode} ${url}`));
          else resolve(body);
        });
      })
      .on("error", reject);
  });
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  execSync("node --check lanshare.js", { cwd: root, stdio: "pipe" });

  const html = await fetchText(new URL("index.html", baseUrl).href).catch(() =>
    fs.readFileSync(path.join(root, "index.html"), "utf8")
  );

  assert(/id="lanshare"/.test(html), "缺少 #lanshare 面板");
  assert(/id="ls-create"/.test(html), "缺少创建房间按钮");
  assert(/id="ls-join-paste"/.test(html), "缺少手动粘贴邀请框");
  assert(/id="ls-copy-invite"/.test(html), "缺少复制邀请按钮");
  assert(/id="ls-scan-file-input"/.test(html), "缺少图片识别邀请码入口");
  assert(/lanshare\.js/.test(html), "index.html 未引用 lanshare.js");
  assert(/20260817lanshare3/.test(html), "index.html 版本 query 未 bump");

  const js = fs.readFileSync(path.join(root, "lanshare.js"), "utf8");
  assert(/inviteLinkBase/.test(js), "缺少 inviteLinkBase");
  assert(/buildInviteUrl/.test(js), "缺少 buildInviteUrl");
  assert(/parseInviteAsync/.test(js), "缺少 parseInviteAsync");
  assert(/tryAutoJoinFromHash/.test(js), "缺少扫码深链自动加入");

  const appJs = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert(/lanshare/.test(appJs), "app.js 未注册 lanshare");
  assert(!/lanshare[^\n]*desktopOnly/.test(appJs), "lanshare 不应标记 desktopOnly");

  let puppeteer;
  try {
    puppeteer = require("puppeteer");
  } catch {
    puppeteer = null;
  }

  if (puppeteer) {
    const platforms = [
      {
        name: "iOS Safari",
        ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      },
      {
        name: "Android Chrome",
        ua: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
      },
      {
        name: "Desktop Chrome",
        ua: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      },
    ];

    for (const p of platforms) {
      const browser = await puppeteer.launch({
        headless: "new",
        args: ["--no-sandbox", "--disable-setuid-sandbox", "--use-fake-ui-for-media-stream"],
      });
      try {
        const page = await browser.newPage();
        await page.setUserAgent(p.ua);
        await page.goto(new URL("#lanshare", baseUrl).href, { waitUntil: "networkidle2", timeout: 60000 });
        const result = await page.evaluate(async () => {
          const api = window.LanShareSelfTest;
          if (!api) return { ok: false, err: "LanShareSelfTest missing" };
          const fakeSdp = "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\n";
          const room = "TEST01";
          const token = await api.packInvitePayload({ v: 1, r: room, h: "host1", n: "H", s: fakeSdp });
          const url = `${api.inviteLinkBase()}#lanshare?j=${token}`;
          let parsed;
          try {
            parsed = await api.parseInviteAsync(url);
          } catch (e) {
            return { ok: false, err: e.message };
          }
          const urlOk = /^https?:\/\//.test(url) && url.includes("#lanshare?j=");
          return {
            ok: api.webrtcSupported() && parsed.roomId === room && urlOk,
            urlLen: url.length,
            urlOk,
            webrtc: api.webrtcSupported(),
            ios: api.isIOS(),
            android: api.isAndroid(),
            mobile: api.isMobileClient(),
            panel: !!document.getElementById("lanshare"),
            createBtn: !!document.getElementById("ls-create"),
            joinPaste: !!document.getElementById("ls-join-paste"),
            copyInvite: !!document.getElementById("ls-copy-invite"),
            fileInputAccept: document.getElementById("ls-file-input")?.getAttribute("accept") === "*/*",
          };
        });
        assert(result.panel, `${p.name}: 面板未渲染`);
        assert(result.createBtn && result.joinPaste, `${p.name}: 关键控件缺失`);
        assert(result.webrtc, `${p.name}: WebRTC 不可用`);
        assert(result.ok, `${p.name}: 邀请码自检失败 ${result.err || ""}`);
        console.log(`OK ${p.name}`, JSON.stringify(result));
      } finally {
        await browser.close();
      }
    }
  } else {
    console.log("skip puppeteer (not installed); static checks only");
  }

  console.log("lanshare-smoke: all checks passed");
}

main().catch((e) => {
  console.error("lanshare-smoke FAILED:", e.message || e);
  process.exit(1);
});
