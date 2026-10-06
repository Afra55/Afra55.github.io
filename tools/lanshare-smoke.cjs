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
const os = require("os");

const baseUrl = process.argv[2] || "http://127.0.0.1:4173/tools/";
const root = path.join(__dirname);
const VER = "theme1";

function toolsBuildFromHtml(html) {
  const m = html.match(/TOOLS_BUILD\s*=\s*"([^"]+)"/);
  if (m) return m[1];
  const v = html.match(/\?v=([0-9]{4}\.[0-9]{2}\.[0-9]{2}-[0-9]+)/);
  return v ? v[1] : "";
}

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
  const htmlLocal = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const lansharePanel = fs.readFileSync(path.join(root, "panels/lanshare.html"), "utf8");
  const lazyJs = fs.readFileSync(path.join(root, "lib/lazy-scripts.js"), "utf8");

  assert(/id="workspace-panels"/.test(htmlLocal), "缺少 workspace-panels 容器");
  assert(/id="lanshare"/.test(lansharePanel), "缺少 #lanshare 面板");
  assert(/邀请链接/.test(lansharePanel), "缺少邀请链接文案");
  assert(/lanshare:\s*"\.\/lanshare\.js"/.test(lazyJs), "lazy-scripts 未注册 lanshare.js");
  const build = toolsBuildFromHtml(htmlLocal);
  assert(build, "index.html 缺少 TOOLS_BUILD");
  assert(/2026\.\d{2}\.\d{2}-\d{6}|20260817theme1/.test(htmlLocal), `index.html 版本/cache-bust 异常 (${build})`);

  const js = fs.readFileSync(path.join(root, "lanshare.js"), "utf8");
  assert(/encodeURIComponent\(token\)/.test(js), "邀请 token 应 URL 编码");
  assert(/inviteQrTextShort/.test(js), "缺少超短邀请码");
  assert(/publishJoinOffer/.test(js), "缺少成员 offer 回传");
  assert(/applyJoinOffer/.test(js), "缺少房主 offer 应用");
  assert(/joinByPassword/.test(js), "缺少密码加入");
  assert(/uploadTransferKey/.test(js), "上传连接应按请求者区分");
  assert(/decodeQrFromSource/.test(js), "缺少多尺度二维码解码");
  assert(/ls-invite-qr-app/.test(lansharePanel), "缺少应用内短码二维码区");
  assert(/ls-qr-duo/.test(fs.readFileSync(path.join(root, "style.css"), "utf8")), "缺少双二维码布局样式");
  assert(/downloadQueue/.test(js), "缺少下载排队");
  assert(/enqueueDownload/.test(js), "缺少 enqueueDownload");
  assert(/openJoinFallback/.test(js), "缺少密码失败展开备用区");
  assert(/ls-inline-progress/.test(lansharePanel), "缺少按钮旁内联进度");
  assert(/ls-ring-progress/.test(fs.readFileSync(path.join(root, "style.css"), "utf8")), "缺少行内环形进度样式");
  assert(/ls-join-fallback/.test(lansharePanel), "缺少备用加入区 id");
  assert(/bumpSendProgress/.test(js), "缺少上传发送进度");
  assert(/is-queue/.test(fs.readFileSync(path.join(root, "style.css"), "utf8")), "缺少排队样式");
  assert(/pagehide/.test(js), "应监听 pagehide");
  assert(/removeMemberFiles/.test(js), "缺少退出清理文件");
  assert(!/dissolveRoom/.test(js), "应移除解散房间");
  assert(/fileKindLabel/.test(js), "缺少文件类型标签");
  assert(!/ls-dissolve/.test(lansharePanel), "应移除解散按钮");
  assert(/MQTT_BROKERS/.test(js), "缺少 MQTT 多 broker 回退");
  assert(/ls-room-pwd-join/.test(lansharePanel), "缺少密码加入输入框");
  assert(/vendor\/mqtt\.min\.js/.test(lazyJs), "lazy-scripts 应注册 mqtt");
  assert(/lanshare:\s*\["qrcode",\s*"jsQR"\]/.test(lazyJs), "lazy-scripts 应为 lanshare 加载 qrcode/jsQR");
  assert(/broadcastExcept/.test(js), "房主应转发成员事件给其他成员");
  assert(/controlLinked/.test(js), "缺少 controlLinked 连接就绪状态");
  assert(/relayMemberEvent/.test(js), "缺少成员事件转发");
  assert(/canUploadFiles/.test(js), "缺少上传前连接校验");
  assert(/sessionStorage/.test(js) && /PENDING_JOIN_KEY/.test(js), "缺少 join token 缓存");
  assert(/ls-known-limits/.test(lansharePanel), "缺少已知限制说明");
  assert(/使用注意/.test(lansharePanel), "缺少使用注意文案");
  assert(/ls-scan-feedback/.test(lansharePanel), "缺少扫码反馈");
  assert(/ls-save-dir-pick/.test(lansharePanel), "缺少保存目录按钮");
  assert(/ls-join-steps/.test(lansharePanel), "缺少加入步骤");
  assert(/完整链接/.test(lansharePanel), "缺少完整链接码说明");
  assert(/inviteCameraUrl/.test(js), "邀请链接应带查询参数防微信丢 hash");
  assert(/showDirectoryPicker/.test(js), "桌面应支持选择保存目录");
  assert(/cameraErrorMessage/.test(js), "应提示摄像头权限/HTTPS");
  assert(/promoteLanshareQueryToHash/.test(fs.readFileSync(path.join(root, "app.js"), "utf8")), "app.js 应将 ls 查询参数提升为 hash");
  assert(/AbortError/.test(js), "取消分享应回落下载");
  assert(/connectionState === "failed"/.test(js), "下载端应处理 WebRTC failed");
  assert(/isSecureContext/.test(js), "应提示非安全上下文");

  assert(/ls-create-nopwd/.test(lansharePanel), "缺少不设密码入口");
  assert(/ls-session/.test(lansharePanel), "会话区应独立隐藏");
  assert(/仅本页摄像头扫/.test(lansharePanel), "短码应标明仅本页摄像头扫");
  assert(/ls-retry/.test(lansharePanel), "缺少重试连接按钮");
  assert(/generateRoomPassword/.test(js), "创建房间应能自动生成密码");
  assert(/waitControlLinked/.test(js), "密码加入应等待配对完成");
  assert(/加入失败，请让双方都点重试/.test(js), "握手失败应用人话");
  assert(!/openJoinFallback\(\(e\?\.message \|\| "密码加入失败"\)/.test(js), "密码失败不应再引导扫码当主路径");

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
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--use-fake-ui-for-media-stream"],
  });

  try {
    const page = await browser.newPage();
    await page.goto(new URL("#lanshare", baseUrl).href, { waitUntil: "networkidle2", timeout: 60000 });

    const core = await page.evaluate(async () => {
      const api = window.LanShareSelfTest;
      if (!api) return { ok: false, err: "LanShareSelfTest missing" };
      const room = "ROOM42";
      const short = `lanshare?r=${room}&h=host1`;
      const parsedShort = await api.parseInviteAsync(short);
      const sdp = "v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\ns=-\r\nt=0 0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\nc=IN IP4 0.0.0.0\r\n";
      const token = await api.packInvitePayload({ v: 1, r: room, h: "host1", n: "Host", s: sdp });
      const legacyParsed = await api.parseInviteAsync(api.inviteQrText(token));
      return {
        ok: parsedShort.roomId === room && !parsedShort.sdp && legacyParsed.roomId === room && !!legacyParsed.sdp,
        shortLen: short.length,
        parsedRoom: parsedShort.roomId,
      };
    });
    assert(core.ok, `邀请解析失败: ${core.err || ""}`);
    assert(core.shortLen < 80, `超短邀请码过长 (${core.shortLen})`);
    console.log("OK invite parse", JSON.stringify({ shortLen: core.shortLen, room: core.parsedRoom }));

    const pwdHash = await page.evaluate(async () => {
      const api = window.LanShareSelfTest;
      const a = await api.hashRoomPassword("Test12");
      const b = await api.hashRoomPassword("test12");
      return { ok: a === b && a.length === 24, len: a.length };
    });
    assert(pwdHash.ok, "房间密码哈希不稳定");
    console.log("OK room password hash", JSON.stringify(pwdHash));

    const realistic = await page.evaluate(async (sdpText) => {
      const api = window.LanShareSelfTest;
      const room = "LAN001";
      const shortText = `lanshare?r=${room}&h=hostx`;
      const parsed = await api.parseInviteAsync(shortText);
      const offerToken = await api.packInvitePayload({
        t: "offer",
        r: room,
        h: "hostx",
        f: "guest1",
        s: sdpText,
      });
      const offerParsed = await api.parseJoinOfferAsync(api.joinOfferQrText(offerToken));
      return {
        shortLen: shortText.length,
        ok: parsed.roomId === room && !parsed.sdp && offerParsed.roomId === room && offerParsed.sdp.includes("m=application"),
      };
    }, sampleSdp());
    assert(realistic.ok, " realistic 短邀请/连接码解析失败");
    assert(realistic.shortLen < 80, `超短邀请码过长 (${realistic.shortLen})`);
    console.log("OK realistic short invite", JSON.stringify({ shortLen: realistic.shortLen }));

    const inviteUrl = await page.evaluate(async () => {
      const api = window.LanShareSelfTest;
      return `${api.inviteLinkBase()}#lanshare?r=JOIN99&h=hostz`;
    });

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

    const camUrl = await page.evaluate(() => window.LanShareSelfTest.inviteCameraUrl("lanshare?r=JOINQ1&h=hostq"));
    assert(/[?&]ls=1/.test(camUrl) && /lsr=JOINQ1/.test(camUrl) && /#lanshare\?/.test(camUrl), `完整链接码格式异常: ${camUrl}`);
    const parsedCam = await page.evaluate(async (url) => window.LanShareSelfTest.parseInviteAsync(url), camUrl);
    assert(parsedCam.roomId === "JOINQ1", `完整链接解析失败: ${JSON.stringify(parsedCam)}`);

    const queryOnly = new URL(await page.evaluate(() => window.LanShareSelfTest.inviteLinkBase()));
    queryOnly.search = "ls=1&lsr=JOINQ1&lsh=hostq";
    queryOnly.hash = "";
    const queryPage = await browser.newPage();
    await queryPage.goto(queryOnly.href, { waitUntil: "networkidle2", timeout: 60000 });
    await queryPage.waitForFunction(
      () => window.LanShareSelfTest?.getRoomId?.() === "JOINQ1",
      { timeout: 20000 }
    );
    const queryJoined = await queryPage.evaluate(() => ({
      roomId: window.LanShareSelfTest?.getRoomId?.() || "",
      hash: location.hash,
    }));
    assert(queryJoined.roomId === "JOINQ1", `无 hash 查询参数未自动加入: ${JSON.stringify(queryJoined)}`);
    await queryPage.close();
    console.log("OK query-only auto-join", JSON.stringify(queryJoined));

    const shotDir = fs.mkdtempSync(path.join(os.tmpdir(), "lanshare-ux-"));
    await page.setViewport({ width: 1280, height: 900 });
    await page.goto(new URL("#lanshare", baseUrl).href, { waitUntil: "networkidle2", timeout: 60000 });
    await page.waitForSelector("#ls-create", { timeout: 15000 });
    const ux = await page.evaluate(() => {
      const primaries = [...document.querySelectorAll("#ls-join-area .primary-btn")].filter((b) => {
        const st = getComputedStyle(b);
        return st.display !== "none" && st.visibility !== "hidden";
      });
      const fallback = document.getElementById("ls-join-fallback");
      return {
        steps: (document.getElementById("ls-join-steps")?.textContent || "").includes("密码加入"),
        sessionHidden: !!document.getElementById("ls-session")?.hidden,
        saveDirHidden: !!document.getElementById("ls-save-dir-row")?.hidden || !!document.getElementById("ls-session")?.hidden,
        primaryCount: primaries.length,
        primaryText: primaries.map((b) => b.id).join(","),
        scanInFallback: !!fallback?.contains(document.getElementById("ls-scan")),
        fallbackOpen: !!fallback?.open,
        nopwd: !!document.getElementById("ls-create-nopwd"),
      };
    });
    assert(ux.steps && ux.sessionHidden, `空态步骤/会话隐藏异常: ${JSON.stringify(ux)}`);
    assert(ux.primaryCount === 1 && ux.primaryText === "ls-create", `桌面空态应只有创建房间主按钮: ${JSON.stringify(ux)}`);
    assert(ux.scanInFallback && !ux.fallbackOpen, "扫码应收进折叠备用且默认关闭");
    await page.screenshot({ path: path.join(shotDir, "desktop-empty.png"), fullPage: true });
    await page.click("#ls-create");
    await page.waitForFunction(
      () => !document.getElementById("ls-invite-area")?.hidden && (document.getElementById("ls-room-pwd-display")?.textContent || "").includes("房间密码"),
      { timeout: 20000 }
    );
    const hostUx = await page.evaluate(() => ({
      pwd: (document.getElementById("ls-room-pwd-display")?.textContent || "").match(/房间密码\s+(\S+)/)?.[1] || "",
      guide: document.getElementById("ls-pairing-guide")?.textContent || "",
      qrOpen: !!document.getElementById("ls-invite-qr-backup")?.open,
      pickDisabled: !!document.getElementById("ls-pick")?.disabled,
      sessionHidden: !!document.getElementById("ls-session")?.hidden,
      saveDir: !document.getElementById("ls-save-dir-row")?.hidden,
    }));
    assert(hostUx.pwd && hostUx.pwd.length >= 4, `未自动生成密码: ${JSON.stringify(hostUx)}`);
    assert(/告诉成员此密码|自动连接/.test(hostUx.guide), `房主应突出密码而非扫码: ${hostUx.guide}`);
    assert(!hostUx.qrOpen, "有密码时扫码备用应默认折叠");
    assert(!hostUx.sessionHidden && !hostUx.pickDisabled, `房主应能直接选文件: ${JSON.stringify(hostUx)}`);
    await page.screenshot({ path: path.join(shotDir, "desktop-host-pwd.png"), fullPage: true });

    const guestPage = await browser.newPage();
    await guestPage.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await guestPage.setUserAgent(
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36"
    );
    await guestPage.goto(new URL("#lanshare", baseUrl).href, { waitUntil: "networkidle2", timeout: 60000 });
    await guestPage.waitForSelector("#ls-join-pwd", { timeout: 15000 });
    const mobileEmpty = await guestPage.evaluate(() => {
      const primaries = [...document.querySelectorAll("#ls-join-area .primary-btn")].filter((b) => {
        const st = getComputedStyle(b);
        return st.display !== "none" && st.visibility !== "hidden";
      });
      return {
        primaryText: primaries.map((b) => b.id).join(","),
        steps: (document.getElementById("ls-join-steps")?.textContent || "").includes("密码加入"),
        scanInFallback: !!document.getElementById("ls-join-fallback")?.contains(document.getElementById("ls-scan")),
      };
    });
    assert(mobileEmpty.primaryText === "ls-join-pwd", `窄屏空态主按钮应为密码加入: ${JSON.stringify(mobileEmpty)}`);
    await guestPage.type("#ls-room-pwd-join", hostUx.pwd);
    await guestPage.click("#ls-join-pwd");
    await guestPage.waitForFunction(
      () => {
        const pick = document.getElementById("ls-pick");
        return pick && !pick.disabled && !document.getElementById("ls-session")?.hidden;
      },
      { timeout: 30000 }
    );
    const guestUx = await guestPage.evaluate(() => ({
      pickDisabled: !!document.getElementById("ls-pick")?.disabled,
      guestQr: !document.getElementById("ls-guest-answer-area")?.hidden,
      err: document.getElementById("ls-error")?.textContent || "",
      room: window.LanShareSelfTest?.getRoomId?.() || "",
    }));
    assert(!guestUx.pickDisabled, `密码加入后应能选文件: ${JSON.stringify(guestUx)}`);
    assert(!guestUx.guestQr, "密码加入后不应再要求回传连接码");
    assert(!/setRemoteDescription|SDP/i.test(guestUx.err), `状态卡出现协议错误: ${guestUx.err}`);
    await guestPage.screenshot({ path: path.join(shotDir, "mobile-joined.png"), fullPage: true });
    await guestPage.close();

    await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
    await page.reload({ waitUntil: "networkidle2", timeout: 60000 });
    await page.evaluate(() => {
      location.hash = "lanshare";
    });
    await page.waitForSelector("#ls-join-pwd", { timeout: 15000 });
    await page.screenshot({ path: path.join(shotDir, "mobile-empty.png"), fullPage: true });
    console.log("OK ux walk", JSON.stringify({ ux, hostUx, mobileEmpty, guestUx, shotDir }));

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
