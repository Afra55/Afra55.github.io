#!/usr/bin/env node
"use strict";

/**
 * 局域网互传冒烟：邀请链接编解码、深链自动加入、三端 UA。
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
const VER = "navlast3";

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

function sampleSdp() {
  const hosts = [
    "192.168.1.8",
    "192.168.1.9",
    "10.0.0.12",
    "fe80::1",
    "172.16.0.5",
    "192.168.1.10",
    "192.168.1.11",
  ];
  const lines = [
    "v=0",
    "o=- 123 0 IN IP4 127.0.0.1",
    "s=-",
    "t=0 0",
    "a=group:BUNDLE 0",
    "a=extmap-allow-mixed",
    "a=msid-semantic: WMS",
    "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
    "c=IN IP4 0.0.0.0",
    "a=ice-ufrag:abcd",
    "a=ice-pwd:efghijklmnop012345678901234",
    "a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF",
    "a=setup:actpass",
    "a=mid:0",
    "a=sctp-port:5000",
    "a=max-message-size:262144",
  ];
  let n = 0;
  for (const ip of hosts) {
    n += 1;
    lines.push(
      `a=candidate:${n} 1 udp 2122260223 ${ip} ${50000 + n} typ host generation 0 network-id ${n} network-cost 10`
    );
    lines.push(`a=candidate:${n} 1 udp 1686052607 ${ip} ${50000 + n} typ srflx raddr ${ip} rport ${50000 + n} generation 0`);
  }
  lines.push("a=end-of-candidates");
  return `${lines.join("\r\n")}\r\n`;
}

async function main() {
  execSync("node --check lanshare.js", { cwd: root, stdio: "pipe" });
  execSync("node --check app.js", { cwd: root, stdio: "pipe" });

  const html = await fetchText(new URL("index.html", baseUrl).href).catch(() =>
    fs.readFileSync(path.join(root, "index.html"), "utf8")
  );

  assert(/id="lanshare"/.test(html), "缺少 #lanshare 面板");
  assert(/邀请链接/.test(html), "缺少邀请链接文案");
  assert(/lanshare\.js/.test(html), "index.html 未引用 lanshare.js");
  assert(new RegExp(`20260817${VER}`).test(html), `index.html 版本应为 ${VER}`);

  const js = fs.readFileSync(path.join(root, "lanshare.js"), "utf8");
  assert(/encodeURIComponent\(token\)/.test(js), "邀请 token 应 URL 编码");
  assert(/broadcastExcept/.test(js), "房主应转发成员事件给其他成员");
  assert(/controlLinked/.test(js), "缺少 controlLinked 连接就绪状态");
  assert(/relayMemberEvent/.test(js), "缺少成员事件转发");
  assert(/canUploadFiles/.test(js), "缺少上传前连接校验");
  assert(/sessionStorage/.test(js) && /PENDING_JOIN_KEY/.test(js), "缺少 join token 缓存");
  assert(/preserveLanshareJoin/.test(fs.readFileSync(path.join(root, "app.js"), "utf8")), "app.js 应保护 lanshare 深链");

  let puppeteer;
  try {
    puppeteer = require("puppeteer");
  } catch {
    puppeteer = null;
  }

  if (!puppeteer) {
    console.log("skip puppeteer (not installed); static checks only");
    console.log("lanshare-smoke: all checks passed");
    return;
  }

  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--use-fake-ui-for-media-stream"],
  });

  try {
    const page = await browser.newPage();
    await page.goto(new URL("#lanshare", baseUrl).href, { waitUntil: "networkidle2", timeout: 60000 });

    const core = await page.evaluate(async () => {
      const api = window.LanShareSelfTest;
      if (!api) return { ok: false, err: "LanShareSelfTest missing" };
      const room = "ROOM42";
      const sdp = "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\n";
      const token = await api.packInvitePayload({ v: 1, r: room, h: "host1", n: "Host", s: sdp });
      const url = `${api.inviteLinkBase()}#lanshare?j=${encodeURIComponent(token)}`;
      const parsed = await api.parseInviteAsync(url);
      const legacy =
        "devtools-lanshare:v1|" +
        room +
        "|" +
        btoa(JSON.stringify({ hostId: "host1", hostName: "H", sdp }))
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, "");
      const legacyParsed = await api.parseInviteAsync(legacy);
      return {
        ok: parsed.roomId === room && legacyParsed.roomId === room,
        url,
        urlLen: url.length,
        parsedRoom: parsed.roomId,
        legacyRoom: legacyParsed.roomId,
      };
    });
    assert(core.ok, `邀请解析失败: ${core.err || ""}`);
    assert(core.urlLen < 2800, `邀请链接过长 (${core.urlLen})，二维码可能无法生成`);
    console.log("OK invite parse", JSON.stringify({ urlLen: core.urlLen, room: core.parsedRoom }));

    const realistic = await page.evaluate(async (sdpText) => {
      const api = window.LanShareSelfTest;
      const token = await api.packInvitePayload({
        v: 1,
        r: "LAN001",
        h: "hostx",
        n: "房主",
        s: sdpText,
      });
      const url = `${api.inviteLinkBase()}#lanshare?j=${encodeURIComponent(token)}`;
      const parsed = await api.parseInviteAsync(url);
      return { urlLen: url.length, ok: parsed.roomId === "LAN001" && parsed.sdp.includes("m=application") };
    }, sampleSdp());
    assert(realistic.ok, " realistic SDP 邀请解析失败");
    assert(realistic.urlLen < 2800, `真实 SDP 邀请链接过长 (${realistic.urlLen})`);
    console.log("OK realistic sdp url", JSON.stringify({ urlLen: realistic.urlLen }));

    const inviteUrl = await page.evaluate(async (sdpText) => {
      const api = window.LanShareSelfTest;
      const token = await api.packInvitePayload({
        v: 1,
        r: "JOIN99",
        h: "hostz",
        n: "Z",
        s: sdpText,
      });
      return `${api.inviteLinkBase()}#lanshare?j=${encodeURIComponent(token)}`;
    }, sampleSdp());

    const joinPage = await browser.newPage();
    await joinPage.goto(inviteUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await joinPage.waitForFunction(
      () => window.LanShareSelfTest?.getRoomId?.() === "JOIN99",
      { timeout: 20000 }
    );
    const joined = await joinPage.evaluate(() => ({
      title: document.getElementById("ls-status-title")?.textContent || "",
      joinHidden: document.getElementById("ls-join-area")?.hidden,
      hash: location.hash,
      roomId: window.LanShareSelfTest?.getRoomId?.() || "",
      err: document.getElementById("ls-error")?.textContent || "",
    }));
    assert(joined.roomId === "JOIN99", `深链未自动加入: room=${joined.roomId} err=${joined.err}`);
    assert(joined.title.includes("成员"), `标题未更新: ${joined.title}`);
    assert(joined.joinHidden, "加入区未隐藏");
    assert(joined.hash === "#lanshare", `加入后 hash 未清理: ${joined.hash}`);
    console.log("OK deep link auto-join", JSON.stringify(joined));

    const platforms = ["iOS Safari", "Android Chrome", "Desktop Chrome"];
    const uas = [
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    ];
    for (let i = 0; i < platforms.length; i += 1) {
      const p = await browser.newPage();
      await p.setUserAgent(uas[i]);
      await p.goto(new URL("#lanshare", baseUrl).href, { waitUntil: "networkidle2", timeout: 60000 });
      const ok = await p.evaluate(() => ({
        panel: !!document.getElementById("lanshare"),
        webrtc: window.LanShareSelfTest?.webrtcSupported?.(),
      }));
      assert(ok.panel && ok.webrtc, `${platforms[i]}: 面板/WebRTC`);
      await p.close();
      console.log(`OK ${platforms[i]}`);
    }
  } finally {
    await browser.close();
  }

  console.log("lanshare-smoke: all checks passed");
}

main().catch((e) => {
  console.error("lanshare-smoke FAILED:", e.message || e);
  process.exit(1);
});
