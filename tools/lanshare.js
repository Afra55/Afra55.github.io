(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const panel = $("#lanshare");
  if (!panel) return;

  const PROTO = "devtools-lanshare:v1";
  const STUN = [{ urls: "stun:stun.l.google.com:19302" }, { urls: "stun:stun1.l.google.com:19302" }];
  const CHUNK_SIZE = 32 * 1024;
  const DC_BUFFER_LIMIT = 512 * 1024;
  const NAME_KEY = "devtools-lanshare-name";
  const PENDING_JOIN_KEY = "devtools-lanshare-pending-j";
  const ANSWER_RELAY_PREFIX = "devtools-lanshare-answer";

  const els = {
    statusDot: $("#ls-dot"),
    statusTitle: $("#ls-status-title"),
    statusText: $("#ls-status-text"),
    platformHint: $("#ls-platform-hint"),
    nameInput: $("#ls-name"),
    createBtn: $("#ls-create"),
    joinArea: $("#ls-join-area"),
    inviteArea: $("#ls-invite-area"),
    inviteText: $("#ls-invite-text"),
    inviteQr: $("#ls-invite-qr"),
    copyInviteBtn: $("#ls-copy-invite"),
    scanAnswerBtn: $("#ls-scan-answer"),
    guestAnswerArea: $("#ls-guest-answer-area"),
    guestAnswerQr: $("#ls-guest-answer-qr"),
    guestAnswerText: $("#ls-guest-answer-text"),
    copyGuestAnswerBtn: $("#ls-copy-guest-answer"),
    scanBtn: $("#ls-scan"),
    scanFileBtn: $("#ls-scan-file"),
    scanFileInput: $("#ls-scan-file-input"),
    pasteJoinBtn: $("#ls-paste-join"),
    joinPaste: $("#ls-join-paste"),
    joinConfirmBtn: $("#ls-join-confirm"),
    roomMeta: $("#ls-room-meta"),
    membersEl: $("#ls-members"),
    filesEl: $("#ls-files"),
    fileInput: $("#ls-file-input"),
    pickBtn: $("#ls-pick"),
    leaveBtn: $("#ls-leave"),
    dissolveBtn: $("#ls-dissolve"),
    errorEl: $("#ls-error"),
    progressEl: $("#ls-progress"),
    progressBar: $("#ls-progress-bar"),
    progressText: $("#ls-progress-text"),
    camWrap: $("#ls-cam-wrap"),
    camVideo: $("#ls-cam-video"),
    camStop: $("#ls-cam-stop"),
  };

  /** @type {MediaStream|null} */
  let camStream = null;
  /** @type {number|null} */
  let scanRaf = null;

  const state = {
    peerId: "",
    peerName: "",
    roomId: "",
    isHost: false,
    hostId: "",
    joinedAt: 0,
    members: new Map(),
    files: new Map(),
    localFiles: new Map(),
    memberLinks: new Map(),
    transferPcs: new Map(),
    transferring: false,
    controlPc: null,
    controlDc: null,
    pendingJoin: null,
    pageHiddenWarn: false,
    autoJoinBusy: false,
    /** 成员侧：收到 welcome 后为 true；房主创建房间后为 true */
    controlLinked: false,
    pendingOutbound: [],
    answerBc: null,
    answerStorageHandler: null,
    answerScanMode: false,
  };

  function stashPendingJoinToken(token) {
    if (!token) return;
    try {
      sessionStorage.setItem(PENDING_JOIN_KEY, token);
    } catch (_) {
      /* ignore */
    }
  }

  function takePendingJoinToken() {
    const fromHash = readJoinTokenFromHash();
    if (fromHash) {
      stashPendingJoinToken(fromHash);
      return fromHash;
    }
    try {
      return sessionStorage.getItem(PENDING_JOIN_KEY) || "";
    } catch (_) {
      return "";
    }
  }

  function clearPendingJoinToken() {
    try {
      sessionStorage.removeItem(PENDING_JOIN_KEY);
    } catch (_) {
      /* ignore */
    }
  }

  function readJoinTokenFromHash() {
    const full = String(location.hash || "").replace(/^#/, "");
    if (!full.startsWith("lanshare?")) return "";
    return new URLSearchParams(full.slice(full.indexOf("?") + 1)).get("j") || "";
  }

  stashPendingJoinToken(readJoinTokenFromHash());

  function isIOS() {
    return /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
  }

  function isAndroid() {
    return /Android/i.test(navigator.userAgent || "");
  }

  function isMobileClient() {
    return (
      isIOS() ||
      isAndroid() ||
      window.matchMedia("(max-width: 900px)").matches ||
      (window.matchMedia("(pointer: coarse)").matches && window.matchMedia("(max-width: 900px)").matches)
    );
  }

  function webrtcSupported() {
    return typeof RTCPeerConnection !== "undefined" && typeof RTCDataChannel !== "undefined";
  }

  function uid(n = 8) {
    const a = "abcdefghijklmnopqrstuvwxyz0123456789";
    let s = "";
    for (let i = 0; i < n; i++) s += a[(Math.random() * a.length) | 0];
    return s;
  }

  function roomCode() {
    const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 6; i++) s += a[(Math.random() * a.length) | 0];
    return s;
  }

  function b64enc(obj) {
    const json = typeof obj === "string" ? obj : JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    return b64urlFromBytes(bytes);
  }

  function b64urlFromBytes(bytes) {
    let bin = "";
    bytes.forEach((b) => {
      bin += String.fromCharCode(b);
    });
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function b64urlToBytes(str) {
    const pad = str.length % 4 ? "=".repeat(4 - (str.length % 4)) : "";
    const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const bin = atob(b64);
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  }

  function b64dec(str) {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(str)));
  }

  function inviteLinkBase() {
    try {
      const u = new URL(location.href);
      u.search = "";
      u.hash = "";
      let p = u.pathname.replace(/\/index\.html$/i, "");
      if (!p.endsWith("/")) p += "/";
      return `${u.origin}${p}`;
    } catch {
      return "https://afra55.github.io/tools/";
    }
  }

  function trimSdpForLan(sdp) {
    if (!sdp) return sdp;
    let host = 0;
    const keep = [];
    for (const line of sdp.split(/\r?\n/)) {
      if (!line) continue;
      if (line.startsWith("a=candidate:")) {
        if (!/ typ host /.test(line)) continue;
        host += 1;
        if (host > 3) continue;
      }
      if (line.startsWith("a=end-of-candidates")) continue;
      keep.push(line);
    }
    return `${keep.join("\r\n")}\r\n`;
  }

  function trimSdpForAnswer(sdp) {
    if (!sdp) return sdp;
    const keep = [];
    for (const line of sdp.split(/\r?\n/)) {
      if (!line) continue;
      if (line.startsWith("a=candidate:")) continue;
      if (line.startsWith("a=end-of-candidates")) continue;
      keep.push(line);
    }
    return `${keep.join("\r\n")}\r\n`;
  }

  function toInviteRecord({ roomId, hostId, hostName, sdp }) {
    return { v: 1, r: roomId, h: hostId, n: hostName, s: trimSdpForLan(sdp) };
  }

  function fromInviteRecord(rec) {
    return {
      roomId: rec.r || rec.roomId,
      hostId: rec.h || rec.hostId,
      hostName: rec.n || rec.hostName,
      sdp: rec.s || rec.sdp,
    };
  }

  function fromAnswerRecord(rec) {
    return {
      roomId: rec.r || rec.roomId,
      hostId: rec.h || rec.hostId,
      memberId: rec.f || rec.from || rec.memberId,
      sdp: rec.s || rec.sdp,
    };
  }

  async function packInvitePayload(obj) {
    const json = JSON.stringify(obj);
    const raw = new TextEncoder().encode(json);
    if (typeof CompressionStream !== "undefined") {
      try {
        const buf = await new Response(new Blob([raw]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer();
        return `z${b64urlFromBytes(new Uint8Array(buf))}`;
      } catch {
        /* fall through */
      }
    }
    return `r${b64urlFromBytes(raw)}`;
  }

  async function unpackInvitePayload(token) {
    const t = String(token || "").trim();
    if (!t) throw new Error("邀请数据为空");
    if (t.startsWith("z")) {
      if (typeof DecompressionStream === "undefined") throw new Error("当前浏览器无法解压邀请链接");
      const bytes = b64urlToBytes(t.slice(1));
      const out = await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"))).arrayBuffer();
      return JSON.parse(new TextDecoder().decode(out));
    }
    if (t.startsWith("r")) return JSON.parse(new TextDecoder().decode(b64urlToBytes(t.slice(1))));
    return b64dec(t);
  }

  async function buildInviteUrl(offerSdp) {
    const token = await packInvitePayload(
      toInviteRecord({ roomId: state.roomId, hostId: state.peerId, hostName: state.peerName, sdp: offerSdp })
    );
    return `${inviteLinkBase()}#lanshare?j=${encodeURIComponent(token)}`;
  }

  async function buildInviteToken(offerSdp) {
    return packInvitePayload(
      toInviteRecord({ roomId: state.roomId, hostId: state.peerId, hostName: state.peerName, sdp: offerSdp })
    );
  }

  async function buildJoinAnswerToken(answerSdp) {
    return packInvitePayload({
      t: "answer",
      r: state.roomId,
      h: state.hostId,
      f: state.peerId,
      s: trimSdpForAnswer(answerSdp),
    });
  }

  function inviteQrText(token) {
    return `lanshare?j=${token}`;
  }

  function joinAnswerQrText(token) {
    return `lanshare?a=${token}`;
  }

  async function parseInviteAsync(text) {
    const raw = normalizeInviteText(text);
    if (/^https?:\/\//i.test(raw)) {
      let u;
      try {
        u = new URL(raw);
      } catch {
        throw new Error("无效的邀请链接");
      }
      const frag = u.hash.replace(/^#/, "");
      if (frag.includes("lanshare")) return parseInviteAsync(frag);
      throw new Error("链接不是互传邀请");
    }
    if (raw.startsWith("lanshare")) {
      const q = raw.indexOf("?");
      if (q >= 0) {
        const j = new URLSearchParams(raw.slice(q + 1)).get("j");
        if (j) {
          const inv = fromInviteRecord(await unpackInvitePayload(j));
          if (!inv.sdp) throw new Error("邀请缺少连接信息");
          return inv;
        }
      }
    }
    if (raw.startsWith(`${PROTO}|`)) {
      const i = raw.indexOf("|", PROTO.length + 1);
      if (i < 0) throw new Error("邀请码格式错误");
      const roomId = raw.slice(PROTO.length + 1, i);
      const data = b64dec(raw.slice(i + 1));
      if (!data.sdp && !data.s) throw new Error("邀请码缺少连接信息");
      return fromInviteRecord({ roomId, ...data, sdp: data.sdp || data.s });
    }
    if (/^[zr][A-Za-z0-9_-]+$/.test(raw)) {
      const inv = fromInviteRecord(await unpackInvitePayload(raw));
      if (!inv.sdp) throw new Error("邀请缺少连接信息");
      return inv;
    }
    throw new Error("无效的邀请链接");
  }

  async function parseJoinAnswerAsync(text) {
    const raw = normalizeInviteText(text);
    if (/^https?:\/\//i.test(raw)) {
      let u;
      try {
        u = new URL(raw);
      } catch {
        throw new Error("无效的应答链接");
      }
      const frag = u.hash.replace(/^#/, "");
      if (frag.includes("lanshare")) return parseJoinAnswerAsync(frag);
      throw new Error("链接不是互传应答");
    }
    if (raw.startsWith("lanshare")) {
      const q = raw.indexOf("?");
      if (q >= 0) {
        const a = new URLSearchParams(raw.slice(q + 1)).get("a");
        if (a) {
          const ans = fromAnswerRecord(await unpackInvitePayload(a));
          if (!ans.sdp) throw new Error("应答缺少连接信息");
          return ans;
        }
      }
    }
    if (/^[zr][A-Za-z0-9_-]+$/.test(raw)) {
      const ans = fromAnswerRecord(await unpackInvitePayload(raw));
      if (!ans.sdp) throw new Error("应答缺少连接信息");
      return ans;
    }
    throw new Error("无效的应答码");
  }

  function isAnswerScanData(data) {
    const s = normalizeInviteText(data);
    if (!s) return false;
    if (/^https?:\/\//i.test(s) && /lanshare/i.test(s) && /[?&]a=/.test(s)) return true;
    if (s.startsWith("lanshare?") && /(?:^|[?&])a=/.test(s)) return true;
    return false;
  }

  function isInviteScanData(data) {
    const s = normalizeInviteText(data);
    if (!s) return false;
    if (s.startsWith(PROTO)) return true;
    if (/^https?:\/\//i.test(s) && /lanshare/i.test(s)) return true;
    if (s.startsWith("lanshare?")) return true;
    if (/^[zr][A-Za-z0-9_-]{24,}$/.test(s)) return true;
    return false;
  }

  function fmtSize(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function fmtTime(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function setError(msg) {
    if (!els.errorEl) return;
    els.errorEl.hidden = !msg;
    els.errorEl.textContent = msg || "";
  }

  function setProgress(pct, text) {
    if (!els.progressEl) return;
    if (pct == null) {
      els.progressEl.hidden = true;
      if (els.progressBar) els.progressBar.style.width = "0%";
      if (els.progressText) els.progressText.textContent = "";
      return;
    }
    els.progressEl.hidden = false;
    if (els.progressBar) els.progressBar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    if (els.progressText) els.progressText.textContent = text || "";
  }

  function peerName() {
    return String(els.nameInput?.value || "").trim() || "设备";
  }

  function saveName() {
    try {
      localStorage.setItem(NAME_KEY, peerName());
    } catch (_) {
      /* ignore */
    }
  }

  function loadName() {
    try {
      const v = localStorage.getItem(NAME_KEY);
      if (v && els.nameInput) els.nameInput.value = v;
    } catch (_) {
      /* ignore */
    }
  }

  function paintPlatformHint() {
    if (!els.platformHint) return;
    if (!webrtcSupported()) {
      els.platformHint.hidden = false;
      els.platformHint.textContent = "当前浏览器不支持 WebRTC，请换用 Chrome / Safari / Edge 最新版。";
      return;
    }
    const parts = [];
    if (isIOS()) {
      parts.push("iOS：请用 Safari 并保持本页在前台；下载完成后可用「分享」保存到文件；若无法读剪贴板，请在下框手动粘贴邀请文本。");
    } else if (isAndroid()) {
      parts.push("Android：推荐 Chrome；扫码需授予相机权限；传大文件时请保持屏幕常亮。");
    } else {
      parts.push("电脑：可直接下载文件；也可扫码或复制邀请文本与手机互联。");
    }
    parts.push("所有设备需在同一局域网。");
    els.platformHint.hidden = false;
    els.platformHint.textContent = parts.join(" ");
  }

  function disableIfUnsupported() {
    const ok = webrtcSupported();
    if (els.createBtn) els.createBtn.disabled = !ok;
    if (els.scanBtn) els.scanBtn.disabled = !ok;
    if (els.pasteJoinBtn) els.pasteJoinBtn.disabled = !ok;
    if (els.joinConfirmBtn) els.joinConfirmBtn.disabled = !ok;
  }

  function memberLabel(id) {
    return state.members.get(id)?.name || id.slice(0, 6);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function paintStatus() {
    const inRoom = !!state.roomId;
    els.statusDot?.classList.toggle("is-ok", inRoom);
    els.statusDot?.classList.toggle("is-err", !inRoom);
    if (els.statusTitle) {
      if (!inRoom) els.statusTitle.textContent = "未加入房间";
      else if (state.isHost) els.statusTitle.textContent = `房主 · 房间 ${state.roomId}`;
      else els.statusTitle.textContent = `成员 · 房间 ${state.roomId}`;
    }
    let statusExtra = "";
    if (state.pageHiddenWarn) statusExtra = " · 页面在后台，连接可能中断";
    else if (inRoom && !state.controlLinked) statusExtra = " · 正在连接…";
    else if (inRoom && !state.isHost && state.controlDc?.readyState !== "open") statusExtra = " · 信令连接中…";
    if (els.statusText) {
      els.statusText.textContent = inRoom
        ? `${state.members.size} 人在线 · 文件从上传者直传${statusExtra}`
        : "创建或加入房间；文件不经房主中转。";
    }
    if (els.inviteArea) els.inviteArea.hidden = !inRoom || !state.isHost;
    if (els.joinArea) els.joinArea.hidden = inRoom;
    if (els.guestAnswerArea) els.guestAnswerArea.hidden = !inRoom || state.isHost || state.controlLinked;
    if (els.leaveBtn) els.leaveBtn.hidden = !inRoom;
    if (els.dissolveBtn) els.dissolveBtn.hidden = !inRoom || !state.isHost;
    if (els.pickBtn) {
      els.pickBtn.disabled = !canUploadFiles();
      els.pickBtn.title = canUploadFiles() ? "" : "连接就绪后才可上传";
    }
    if (els.roomMeta) {
      els.roomMeta.hidden = !inRoom;
      els.roomMeta.textContent = state.isHost
        ? "你是房主：可解散；退出时由最近加入的在线成员接任"
        : `房主：${memberLabel(state.hostId)}`;
    }
    paintMembers();
    paintFiles();
  }

  function paintMembers() {
    if (!els.membersEl) return;
    const list = [...state.members.values()].sort((a, b) => a.joinedAt - b.joinedAt);
    els.membersEl.innerHTML = list.length
      ? list
          .map((m) => {
            const tags = [];
            if (m.id === state.hostId) tags.push("房主");
            if (m.id === state.peerId) tags.push("我");
            const tag = tags.length ? ` <span class="hint">(${tags.join(" · ")})</span>` : "";
            return `<div class="ls-member-row"><span>${escapeHtml(m.name)}</span>${tag}<span class="hint mono">${fmtTime(m.joinedAt)}</span></div>`;
          })
          .join("")
      : '<p class="hint tight">暂无成员</p>';
  }

  function paintFiles() {
    if (!els.filesEl) return;
    const list = [...state.files.values()].sort((a, b) => b.addedAt - a.addedAt);
    els.filesEl.innerHTML = list.length
      ? list
          .map((f) => {
            const mine = f.ownerId === state.peerId;
            const actions = mine
              ? `<button type="button" class="ghost-btn ls-del" data-id="${f.id}">删除</button>`
              : `<button type="button" class="secondary-btn ls-dl" data-id="${f.id}">下载</button>`;
            return `<div class="ls-file-row"><div class="ls-file-main"><strong>${escapeHtml(f.name)}</strong><span class="hint mono">${fmtSize(f.size)} · ${escapeHtml(memberLabel(f.ownerId))}</span></div><div class="btn-row tight">${actions}</div></div>`;
          })
          .join("")
      : '<p class="hint tight">暂无文件，点「选择文件」上传</p>';
    $$(".ls-del", els.filesEl).forEach((btn) => btn.addEventListener("click", () => removeFile(btn.dataset.id)));
    $$(".ls-dl", els.filesEl).forEach((btn) => btn.addEventListener("click", () => requestDownload(btn.dataset.id)));
  }

  function createPeer() {
    return new RTCPeerConnection({
      iceServers: STUN,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    });
  }

  function iceWaitMs() {
    return isMobileClient() ? 6500 : 3500;
  }

  async function waitIce(pc) {
    if (pc.iceGatheringState === "complete") return;
    await new Promise((resolve) => {
      const ms = iceWaitMs();
      const to = setTimeout(resolve, ms);
      pc.addEventListener("icegatheringstatechange", () => {
        if (pc.iceGatheringState === "complete") {
          clearTimeout(to);
          resolve(null);
        }
      });
    });
  }

  function normalizeInviteText(text) {
    return String(text || "")
      .trim()
      .replace(/^[\u201c\u201d\u2018\u2019]+|[\u201c\u201d\u2018\u2019]+$/g, "");
  }

  function makeInvitePayload(sdp) {
    return buildInviteUrl(sdp);
  }

  async function renderGuestAnswerQr(token) {
    if (!els.guestAnswerQr) return;
    els.guestAnswerQr.innerHTML = "";
    await ensureQrLibs();
    if (typeof QRCode === "undefined") {
      els.guestAnswerQr.textContent = "二维码库未加载，请复制下方应答链接";
      return;
    }
    const tries = [QRCode.CorrectLevel.L, QRCode.CorrectLevel.M];
    for (const text of [joinAnswerQrText(token), `${inviteLinkBase()}#${joinAnswerQrText(token)}`]) {
      for (const level of tries) {
        try {
          renderQrBox(els.guestAnswerQr, text, level);
          return;
        } catch (err) {
          if (!/Too long|overflow|code length overflow/i.test(String(err.message || err))) break;
        }
      }
    }
    els.guestAnswerQr.innerHTML = '<p class="hint tight">应答码较长，请复制下方链接给房主。</p>';
  }

  async function updateInviteDisplay(offerSdp) {
    const token = await buildInviteToken(offerSdp);
    const url = `${inviteLinkBase()}#${inviteQrText(token)}`;
    if (els.inviteText) els.inviteText.value = url;
    await renderInviteQr(token);
  }

  async function ensureQrLibs() {
    if (typeof QRCode !== "undefined" && typeof jsQR === "function") return;
    if (window.DevToolsLazy?.loadVendor) {
      if (typeof QRCode === "undefined") await window.DevToolsLazy.loadVendor("qrcode");
      if (typeof jsQR !== "function") await window.DevToolsLazy.loadVendor("jsQR");
    }
  }

  function renderQrBox(el, text, level) {
    el.innerHTML = "";
    // eslint-disable-next-line no-new
    new QRCode(el, { text, width: 168, height: 168, correctLevel: level });
  }

  async function renderInviteQr(token) {
    if (!els.inviteQr) return;
    els.inviteQr.innerHTML = "";
    await ensureQrLibs();
    if (typeof QRCode === "undefined") {
      els.inviteQr.textContent = "二维码库未加载，请复制下方邀请文本";
      return;
    }
    const qrPayloads = [inviteQrText(token), `${inviteLinkBase()}#${inviteQrText(token)}`];
    const tries = [QRCode.CorrectLevel.L, QRCode.CorrectLevel.M];
    for (const text of qrPayloads) {
      for (const level of tries) {
        try {
          renderQrBox(els.inviteQr, text, level);
          return;
        } catch (err) {
          if (!/Too long|overflow|code length overflow/i.test(String(err.message || err))) break;
        }
      }
    }
    els.inviteQr.innerHTML =
      '<p class="hint tight">邀请文本较长，二维码无法生成，请复制下方链接分享（或使用应用内扫码/粘贴）。</p>';
  }

  function exportRoomState() {
    return {
      roomId: state.roomId,
      hostId: state.hostId,
      members: [...state.members.values()],
      files: [...state.files.values()],
    };
  }

  function applyRoomState(snapshot) {
    if (!snapshot) return;
    state.roomId = snapshot.roomId || state.roomId;
    state.hostId = snapshot.hostId || state.hostId;
    state.isHost = state.hostId === state.peerId;
    state.members.clear();
    (snapshot.members || []).forEach((m) => state.members.set(m.id, m));
    state.files.clear();
    (snapshot.files || []).forEach((f) => state.files.set(f.id, f));
    state.controlLinked = true;
    flushPendingOutbound();
    paintStatus();
  }

  function sendToMember(memberId, msg) {
    const link = state.memberLinks.get(memberId);
    if (link?.dc?.readyState === "open") link.dc.send(JSON.stringify(msg));
  }

  function broadcastExcept(exceptId, msg) {
    if (!state.isHost) return;
    state.memberLinks.forEach((link, id) => {
      if (exceptId && id === exceptId) return;
      if (link?.dc?.readyState === "open") link.dc.send(JSON.stringify(msg));
    });
  }

  function memberSend(msg) {
    if (state.isHost) {
      state.memberLinks.forEach((link) => {
        if (link?.dc?.readyState === "open") link.dc.send(JSON.stringify(msg));
      });
      return;
    }
    if (state.controlDc?.readyState === "open") {
      state.controlDc.send(JSON.stringify(msg));
    } else {
      state.pendingOutbound.push(msg);
    }
  }

  function flushPendingOutbound() {
    if (state.isHost || state.controlDc?.readyState !== "open") return;
    while (state.pendingOutbound.length) {
      state.controlDc.send(JSON.stringify(state.pendingOutbound.shift()));
    }
  }

  function canUploadFiles() {
    if (!state.roomId) return false;
    if (state.isHost) return state.controlLinked;
    return state.controlLinked && state.controlDc?.readyState === "open";
  }

  function relayMemberEvent(msg, remoteId, types) {
    if (!state.isHost || !remoteId || !types.includes(msg.type)) return;
    broadcastExcept(remoteId, msg);
  }

  function broadcast(msg) {
    if (state.isHost) {
      state.memberLinks.forEach((link) => {
        if (link?.dc?.readyState === "open") link.dc.send(JSON.stringify(msg));
      });
    } else {
      memberSend(msg);
    }
  }

  function relayTo(to, payload) {
    if (state.isHost) sendToMember(to, { type: "relay", payload });
    else if (state.controlDc?.readyState === "open") {
      state.controlDc.send(JSON.stringify({ type: "relay", to, from: state.peerId, payload }));
    }
  }

  function sendHello(dc) {
    if (!dc || dc.readyState !== "open") return;
    dc.send(
      JSON.stringify({
        type: "hello",
        from: state.peerId,
        name: state.peerName,
        joinedAt: state.joinedAt,
      })
    );
  }

  function whenDcOpen(dc, fn) {
    if (!dc) return;
    let done = false;
    const run = () => {
      if (done || dc.readyState !== "open") return;
      done = true;
      fn();
    };
    if (dc.readyState === "open") {
      run();
      return;
    }
    dc.addEventListener("open", run, { once: true });
    setTimeout(run, isIOS() ? 1200 : 600);
    setTimeout(run, 2500);
  }

  function onControlMessage(msg, remoteId) {
    switch (msg.type) {
      case "hello":
        if (!state.isHost) return;
        {
          const member = { id: msg.from, name: msg.name || "成员", joinedAt: msg.joinedAt || Date.now() };
          state.members.set(member.id, member);
          sendToMember(remoteId, { type: "welcome", ...exportRoomState() });
          broadcast({ type: "member-joined", member });
          paintStatus();
          refreshJoinSlot().catch(() => {});
        }
        break;
      case "welcome":
        applyRoomState(msg);
        break;
      case "member-joined":
        if (msg.member) state.members.set(msg.member.id, msg.member);
        paintStatus();
        break;
      case "member-left":
        if (msg.memberId) {
          state.members.delete(msg.memberId);
          if (state.isHost) state.memberLinks.delete(msg.memberId);
        }
        paintStatus();
        relayMemberEvent(msg, remoteId, ["member-left"]);
        break;
      case "file-add":
        if (msg.file) state.files.set(msg.file.id, msg.file);
        paintFiles();
        relayMemberEvent(msg, remoteId, ["file-add"]);
        break;
      case "file-remove":
        if (msg.fileId) {
          state.files.delete(msg.fileId);
          state.localFiles.delete(msg.fileId);
        }
        paintFiles();
        relayMemberEvent(msg, remoteId, ["file-remove"]);
        break;
      case "download-request":
        if (msg.fileId && msg.requesterId === state.peerId) return;
        if (msg.fileId && msg.requesterId && state.localFiles.has(msg.fileId)) {
          startUpload(msg.fileId, msg.requesterId);
        } else if (state.isHost && msg.fileId && msg.requesterId) {
          const f = state.files.get(msg.fileId);
          if (f) sendToMember(f.ownerId, { type: "download-request", fileId: msg.fileId, requesterId: msg.requesterId });
        }
        break;
      case "relay":
        if (state.isHost && msg.to && msg.to !== state.peerId) {
          sendToMember(msg.to, { type: "relay", payload: msg.payload });
        } else {
          handleRelay(msg.payload);
        }
        break;
      case "room-closed":
        setError("房主已解散房间");
        cleanupRoom(true);
        break;
      case "host-transfer-start":
        handleHostTransferStart(msg);
        break;
      case "host-transfer-done":
        if (!state.isHost) closeMemberControl();
        paintStatus();
        break;
      default:
        break;
    }
  }

  function bindControlDc(dc, remoteId) {
    dc.onmessage = (ev) => {
      try {
        onControlMessage(JSON.parse(String(ev.data)), remoteId);
      } catch (_) {
        /* ignore */
      }
    };
    dc.onclose = () => {
      if (state.isHost && remoteId && remoteId !== state.peerId) {
        state.members.delete(remoteId);
        state.memberLinks.delete(remoteId);
        broadcast({ type: "member-left", memberId: remoteId });
        paintStatus();
      }
    };
  }

  function stopAnswerRelayListen() {
    state.answerBc?.close();
    state.answerBc = null;
    if (state.answerStorageHandler) {
      window.removeEventListener("storage", state.answerStorageHandler);
      state.answerStorageHandler = null;
    }
  }

  function startAnswerRelayListen() {
    stopAnswerRelayListen();
    if (!state.isHost || !state.roomId) return;
    try {
      state.answerBc = new BroadcastChannel(`${ANSWER_RELAY_PREFIX}:${state.roomId}`);
      state.answerBc.onmessage = (ev) => {
        const payload = ev.data;
        if (!payload) return;
        applyJoinAnswer(payload.answerText || payload.text || (payload.token ? joinAnswerQrText(payload.token) : "")).catch(
          () => {}
        );
      };
    } catch (_) {
      /* ignore */
    }
    state.answerStorageHandler = (ev) => {
      if (ev.key !== `${ANSWER_RELAY_PREFIX}:${state.roomId}` || !ev.newValue) return;
      applyJoinAnswer(joinAnswerQrText(ev.newValue)).catch(() => {});
    };
    window.addEventListener("storage", state.answerStorageHandler);
    try {
      const cached = localStorage.getItem(`${ANSWER_RELAY_PREFIX}:${state.roomId}`);
      if (cached) applyJoinAnswer(joinAnswerQrText(cached)).catch(() => {});
    } catch (_) {
      /* ignore */
    }
  }

  function readAnswerTokenFromHash() {
    const full = String(location.hash || "").replace(/^#/, "");
    if (!full.startsWith("lanshare?")) return "";
    return new URLSearchParams(full.slice(full.indexOf("?") + 1)).get("a") || "";
  }

  async function tryApplyJoinAnswerFromHash() {
    if (!state.isHost || !state.pendingJoin?.pc) return false;
    const a = readAnswerTokenFromHash();
    if (!a) return false;
    const ok = await applyJoinAnswer(joinAnswerQrText(a));
    if (ok) history.replaceState(null, "", "#lanshare");
    return ok;
  }

  async function applyJoinAnswer(text) {
    if (!state.isHost || !state.pendingJoin?.pc) return false;
    const parsed = await parseJoinAnswerAsync(text);
    if (!parsed?.sdp) return false;
    if (parsed.roomId && parsed.roomId !== state.roomId) return false;
    if (parsed.hostId && parsed.hostId !== state.peerId) return false;
    const pc = state.pendingJoin.pc;
    if (pc.signalingState !== "have-local-offer") return false;
    try {
      await pc.setRemoteDescription({ type: "answer", sdp: parsed.sdp });
      setError("");
      return true;
    } catch (e) {
      setError(e?.message || "成员应答无效，请让其重新加入");
      return false;
    }
  }

  async function publishJoinAnswer(answerSdp, inv) {
    const token = await buildJoinAnswerToken(answerSdp);
    const answerText = joinAnswerQrText(token);
    const answerUrl = `${inviteLinkBase()}#${answerText}`;

    try {
      const bc = new BroadcastChannel(`${ANSWER_RELAY_PREFIX}:${inv.roomId}`);
      bc.postMessage({ token, answerText, answerUrl });
      bc.close();
    } catch (_) {
      /* ignore */
    }
    try {
      localStorage.setItem(`${ANSWER_RELAY_PREFIX}:${inv.roomId}`, token);
    } catch (_) {
      /* ignore */
    }

    if (els.guestAnswerArea) els.guestAnswerArea.hidden = false;
    if (els.guestAnswerText) els.guestAnswerText.value = answerUrl;
    await renderGuestAnswerQr(token);
    try {
      await copyText(answerUrl);
    } catch (_) {
      /* ignore */
    }
    paintStatus();
  }

  async function applyAnswerFromScanData(data) {
    if (!state.isHost) throw new Error("仅房主可扫描成员应答");
    const ok = await applyJoinAnswer(data);
    if (!ok) throw new Error("应答无效或已过期，请让成员重新加入");
    setError("");
  }

  async function refreshJoinSlot() {
    if (!state.isHost) return;
    state.pendingJoin?.pc?.close();
    const pc = createPeer();
    const dc = pc.createDataChannel("control", { ordered: true });
    let settled = false;
    state.pendingJoin = { pc, dc };

    const onHelloChannel = (e) => {
      if (settled) return;
      try {
        const msg = JSON.parse(String(e.data));
        if (msg.type !== "hello") return;
        settled = true;
        const memberId = msg.from;
        state.memberLinks.set(memberId, { pc, dc });
        state.pendingJoin = null;
        bindControlDc(dc, memberId);
        onControlMessage(msg, memberId);
        refreshJoinSlot().catch(() => {});
      } catch (_) {
        /* ignore */
      }
    };
    dc.onmessage = onHelloChannel;

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") setError("有新成员连接失败，请刷新邀请码重试");
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIce(pc);
    startAnswerRelayListen();
    await updateInviteDisplay(pc.localDescription.sdp);
    tryApplyJoinAnswerFromHash().catch(() => {});
  }

  async function createRoom() {
    if (!webrtcSupported()) {
      setError("当前浏览器不支持 WebRTC");
      return;
    }
    setError("");
    saveName();
    cleanupRoom(false);
    state.peerId = uid();
    state.peerName = peerName();
    state.roomId = roomCode();
    state.isHost = true;
    state.hostId = state.peerId;
    state.joinedAt = Date.now();
    state.members.set(state.peerId, { id: state.peerId, name: state.peerName, joinedAt: state.joinedAt });
    state.controlLinked = true;
    await refreshJoinSlot();
    paintStatus();
  }

  async function joinRoom(inviteText) {
    if (!webrtcSupported()) {
      setError("当前浏览器不支持 WebRTC");
      return;
    }
    setError("");
    saveName();
    const inv = await parseInviteAsync(inviteText);
    cleanupRoom(false);
    state.peerId = uid();
    state.peerName = peerName();
    state.roomId = inv.roomId;
    state.hostId = inv.hostId;
    state.isHost = false;
    state.joinedAt = Date.now();
    state.members.set(state.peerId, { id: state.peerId, name: state.peerName, joinedAt: state.joinedAt });
    state.controlLinked = false;
    state.pendingOutbound = [];
    paintStatus();

    const pc = createPeer();
    state.controlPc = pc;

    pc.ondatachannel = (ev) => {
      state.controlDc = ev.channel;
      bindControlDc(state.controlDc, inv.hostId);
      whenDcOpen(state.controlDc, () => {
        sendHello(state.controlDc);
        paintStatus();
      });
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "connected") paintStatus();
      if (pc.connectionState === "failed") setError("加入房间失败，请确认邀请码未过期并重试");
      if (pc.connectionState === "disconnected") setError("与房主连接中断，请重新加入");
    };

    try {
      await pc.setRemoteDescription({ type: "offer", sdp: inv.sdp });
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      await waitIce(pc);
      await publishJoinAnswer(pc.localDescription.sdp, inv);
    } catch (e) {
      closeMemberControl();
      state.roomId = "";
      state.isHost = false;
      state.hostId = "";
      state.members.clear();
      paintStatus();
      throw new Error(e?.message || "无法建立连接，请让房主刷新邀请二维码");
    }
    paintStatus();
  }

  function handleRelay(payload) {
    if (!payload) return;
    if (payload.type === "webrtc-offer" && payload.to === state.peerId) {
      acceptFileOffer(payload.from, payload.fileId, payload.sdp);
    } else if (payload.type === "webrtc-answer" && payload.to === state.peerId) {
      const key = `${state.peerId}:${payload.fileId}`;
      const pc = state.transferPcs.get(key);
      if (pc) pc.setRemoteDescription({ type: "answer", sdp: payload.sdp }).catch(() => {});
    } else if (payload.type === "ice-candidate") {
      const pc =
        state.transferPcs.get(`${payload.from}:${payload.fileId}`) ||
        state.transferPcs.get(`${state.peerId}:${payload.fileId}`);
      if (pc && payload.candidate) pc.addIceCandidate(payload.candidate).catch(() => {});
    } else if (payload.type === "host-handshake-offer" && payload.to === state.peerId) {
      reconnectToHost(payload);
    } else if (state.isHost && payload.to) {
      sendToMember(payload.to, { type: "relay", payload });
    } else if (!state.isHost && payload.to && payload.to !== state.peerId) {
      relayTo(payload.to, payload);
    }
  }

  async function reconnectToHost(payload) {
    closeMemberControl();
    state.hostId = payload.from;
    state.isHost = false;
    if (payload.state) applyRoomState(payload.state);
    const pc = createPeer();
    state.controlPc = pc;
    pc.ondatachannel = (ev) => {
      state.controlDc = ev.channel;
      bindControlDc(state.controlDc, payload.from);
      whenDcOpen(state.controlDc, () => paintStatus());
    };
    await pc.setRemoteDescription({ type: "offer", sdp: payload.sdp });
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    await waitIce(pc);
    paintStatus();
  }

  async function onFilesPicked(fileList) {
    if (!canUploadFiles()) {
      setError(state.controlLinked ? "连接未就绪，请稍候再选文件" : "仍在连接房主，请稍候再上传");
      return;
    }
    setError("");
    for (const file of [...fileList]) {
      const id = uid(10);
      state.localFiles.set(id, file);
      const meta = {
        id,
        name: file.name,
        size: file.size,
        mime: file.type || "application/octet-stream",
        ownerId: state.peerId,
        addedAt: Date.now(),
      };
      state.files.set(id, meta);
      memberSend({ type: "file-add", file: meta });
    }
    paintFiles();
  }

  function removeFile(fileId) {
    const f = state.files.get(fileId);
    if (!f || f.ownerId !== state.peerId) return;
    state.files.delete(fileId);
    state.localFiles.delete(fileId);
    memberSend({ type: "file-remove", fileId });
    paintFiles();
  }

  function requestDownload(fileId) {
    const f = state.files.get(fileId);
    if (!f || f.ownerId === state.peerId || state.transferring) return;
    setError("");
    const msg = { type: "download-request", fileId, requesterId: state.peerId };
    if (state.isHost) sendToMember(f.ownerId, msg);
    else if (state.controlDc?.readyState === "open") state.controlDc.send(JSON.stringify(msg));
  }

  function waitDcDrain(dc) {
    return new Promise((resolve) => {
      if (dc.bufferedAmount <= DC_BUFFER_LIMIT) {
        resolve(null);
        return;
      }
      const tick = () => {
        if (dc.bufferedAmount <= DC_BUFFER_LIMIT) resolve(null);
        else setTimeout(tick, 30);
      };
      tick();
    });
  }

  async function sendFileChunks(dc, file) {
    let offset = 0;
    while (offset < file.size) {
      await waitDcDrain(dc);
      const buf = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
      dc.send(buf);
      offset += buf.byteLength;
    }
  }

  async function startUpload(fileId, requesterId) {
    const file = state.localFiles.get(fileId);
    const meta = state.files.get(fileId);
    if (!file || !meta) return;
    const key = `${state.peerId}:${fileId}`;
    if (state.transferPcs.has(key)) return;

    const pc = createPeer();
    state.transferPcs.set(key, pc);
    const dc = pc.createDataChannel("file", { ordered: true });
    dc.binaryType = "arraybuffer";

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        relayTo(requesterId, {
          type: "ice-candidate",
          candidate: ev.candidate,
          fileId,
          from: state.peerId,
          to: requesterId,
        });
      }
    };

    dc.onopen = async () => {
      try {
        dc.send(JSON.stringify({ type: "meta", name: meta.name, size: meta.size, mime: meta.mime, fileId }));
        await sendFileChunks(dc, file);
        dc.send(JSON.stringify({ type: "done", fileId }));
      } catch (_) {
        dc.send(JSON.stringify({ type: "error", fileId, message: "发送中断" }));
      }
    };

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIce(pc);
    relayTo(requesterId, {
      type: "webrtc-offer",
      from: state.peerId,
      to: requesterId,
      fileId,
      sdp: pc.localDescription.sdp,
    });
  }

  async function saveReceivedBlob(blob, filename) {
    const name = filename || "download";
    if (isMobileClient() && typeof navigator.share === "function" && typeof File !== "undefined") {
      try {
        const file = new File([blob], name, { type: blob.type || "application/octet-stream" });
        if (!navigator.canShare || navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: name });
          return;
        }
      } catch (err) {
        if (err?.name === "AbortError") return;
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    if (isIOS()) {
      setTimeout(() => {
        try {
          window.open(url, "_blank");
        } catch (_) {
          /* ignore */
        }
      }, 300);
    }
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  async function acceptFileOffer(from, fileId, sdp) {
    if (state.transferring) return;
    state.transferring = true;
    setProgress(0, "正在连接上传者…");
    const key = `${from}:${fileId}`;
    const pc = createPeer();
    state.transferPcs.set(key, pc);

    const received = new Promise((resolve, reject) => {
      let meta = null;
      const chunks = [];
      let total = 0;
      const timer = setTimeout(() => reject(new Error("连接超时")), 120000);

      pc.ondatachannel = (ev) => {
        const dc = ev.channel;
        dc.binaryType = "arraybuffer";
        dc.onmessage = (e) => {
          if (typeof e.data === "string") {
            const msg = JSON.parse(e.data);
            if (msg.type === "meta") {
              meta = msg;
              total = msg.size || 0;
            } else if (msg.type === "done") {
              clearTimeout(timer);
              resolve({ meta, chunks });
            } else if (msg.type === "error") {
              clearTimeout(timer);
              reject(new Error(msg.message || "传输失败"));
            }
          } else {
            chunks.push(new Uint8Array(e.data));
            if (total > 0) {
              const got = chunks.reduce((s, c) => s + c.byteLength, 0);
              setProgress((got / total) * 100, `下载 ${fmtSize(got)} / ${fmtSize(total)}`);
            }
          }
        };
      };

      pc.onicecandidate = (ev) => {
        if (ev.candidate) {
          relayTo(from, { type: "ice-candidate", candidate: ev.candidate, fileId, from: state.peerId, to: from });
        }
      };
    });

    try {
      await pc.setRemoteDescription({ type: "offer", sdp });
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      await waitIce(pc);
      relayTo(from, {
        type: "webrtc-answer",
        from: state.peerId,
        to: from,
        fileId,
        sdp: pc.localDescription.sdp,
      });
      const { meta, chunks } = await received;
      const blob = new Blob(chunks, { type: meta?.mime || "application/octet-stream" });
      await saveReceivedBlob(blob, meta?.name || "download");
      setProgress(null);
      if (isIOS()) setError("");
    } catch (e) {
      setError(e.message || "下载失败");
      setProgress(null);
    } finally {
      state.transferring = false;
      state.transferPcs.delete(key);
      pc.close();
    }
  }

  function pickNextHost() {
    const others = [...state.members.values()].filter((m) => m.id !== state.peerId);
    if (!others.length) return null;
    others.sort((a, b) => b.joinedAt - a.joinedAt);
    return others[0];
  }

  async function handleHostTransferStart(msg) {
    if (msg.nextHostId !== state.peerId) {
      state.hostId = msg.nextHostId;
      state.isHost = false;
      applyRoomState(msg.state);
      paintStatus();
      return;
    }
    applyRoomState(msg.state);
    state.isHost = true;
    state.hostId = state.peerId;
    const others = [...state.members.values()].filter((m) => m.id !== state.peerId);
    const handshakes = new Map();
    for (const m of others) {
      const pc = createPeer();
      const dc = pc.createDataChannel("control", { ordered: true });
      const link = { pc, dc };
      handshakes.set(m.id, link);
      dc.onopen = () => bindControlDc(dc, m.id);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await waitIce(pc);
      const payload = {
        type: "host-handshake-offer",
        from: state.peerId,
        to: m.id,
        sdp: pc.localDescription.sdp,
        state: exportRoomState(),
      };
      if (state.controlDc?.readyState === "open") {
        state.controlDc.send(JSON.stringify({ type: "relay", to: m.id, payload }));
      }
    }
    await new Promise((r) => setTimeout(r, isMobileClient() ? 2200 : 1500));
    closeMemberControl();
    closeHostControl(true);
    handshakes.forEach((link, id) => state.memberLinks.set(id, link));
    await refreshJoinSlot();
    state.memberLinks.forEach((link, id) => {
      if (link.dc?.readyState === "open") sendToMember(id, { type: "host-transfer-done", hostId: state.peerId });
    });
    state.controlLinked = true;
    paintStatus();
  }

  async function leaveRoom() {
    if (!state.roomId) return;
    if (state.isHost) {
      const next = pickNextHost();
      if (next) {
        const snapshot = exportRoomState();
        snapshot.hostId = next.id;
        broadcast({ type: "host-transfer-start", nextHostId: next.id, state: snapshot });
        await new Promise((r) => setTimeout(r, isMobileClient() ? 1800 : 1200));
      } else {
        broadcast({ type: "room-closed" });
      }
    } else {
      memberSend({ type: "member-left", memberId: state.peerId });
    }
    cleanupRoom(false);
  }

  function dissolveRoom() {
    if (!state.isHost) return;
    broadcast({ type: "room-closed" });
    cleanupRoom(false);
  }

  function closeMemberControl() {
    state.controlDc?.close();
    state.controlDc = null;
    state.controlPc?.close();
    state.controlPc = null;
  }

  function closeHostControl(full) {
    state.pendingJoin?.pc?.close();
    state.pendingJoin = null;
    state.memberLinks.forEach((l) => {
      l.dc?.close();
      l.pc?.close();
    });
    state.memberLinks.clear();
    if (full) {
      state.controlDc?.close();
      state.controlPc?.close();
      state.controlDc = null;
      state.controlPc = null;
    }
  }

  function cleanupRoom(keepError) {
    closeHostControl(true);
    closeMemberControl();
    state.transferPcs.forEach((pc) => pc.close());
    state.transferPcs.clear();
    state.roomId = "";
    state.isHost = false;
    state.hostId = "";
    state.members.clear();
    state.files.clear();
    state.localFiles.clear();
    state.transferring = false;
    state.pageHiddenWarn = false;
    state.autoJoinBusy = false;
    state.controlLinked = false;
    state.pendingOutbound = [];
    stopAnswerRelayListen();
    if (els.inviteText) els.inviteText.value = "";
    if (els.inviteQr) els.inviteQr.innerHTML = "";
    if (els.guestAnswerArea) els.guestAnswerArea.hidden = true;
    if (els.guestAnswerQr) els.guestAnswerQr.innerHTML = "";
    if (els.guestAnswerText) els.guestAnswerText.value = "";
    setProgress(null);
    if (!keepError) setError("");
    paintStatus();
  }

  async function copyText(text) {
    const v = String(text || "").trim();
    if (!v) throw new Error("无内容可复制");
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(v);
      return;
    }
    const ta = document.createElement("textarea");
    ta.value = v;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }

  async function copyInvite() {
    try {
      await copyText(els.inviteText?.value || "");
      setError("");
      if (els.copyInviteBtn) {
        const prev = els.copyInviteBtn.textContent;
        els.copyInviteBtn.textContent = "已复制";
        setTimeout(() => {
          if (els.copyInviteBtn) els.copyInviteBtn.textContent = prev;
        }, 1500);
      }
    } catch (e) {
      setError(e.message || "复制失败，请长按邀请文本手动复制");
    }
  }

  async function pasteJoin() {
    try {
      if (navigator.clipboard?.readText) {
        const text = await navigator.clipboard.readText();
        if (text.trim()) {
          await joinRoom(text);
          return;
        }
      }
      throw new Error("无法读取剪贴板");
    } catch (_) {
      if (els.joinPaste) {
        els.joinPaste.focus();
        setError("请在下方输入框粘贴邀请文本后点「确认加入」（iOS 常需手动粘贴）");
      } else {
        setError("无法从剪贴板加入，请手动粘贴邀请文本");
      }
    }
  }

  async function confirmPasteJoin() {
    const text = els.joinPaste?.value || els.inviteText?.value || "";
    if (!normalizeInviteText(text)) {
      setError("请先粘贴完整邀请文本");
      return;
    }
    try {
      await joinRoom(text);
      if (els.joinPaste) els.joinPaste.value = "";
      setError("");
    } catch (e) {
      setError(e.message || "加入失败");
    }
  }

  function decodeQrFromImage(img) {
    if (typeof jsQR !== "function") throw new Error("扫码库未加载");
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const maxSide = 1400;
    let w = img.naturalWidth || img.videoWidth || img.width;
    let h = img.naturalHeight || img.videoHeight || img.height;
    if (!w || !h) throw new Error("无法读取图片尺寸");
    const scale = Math.min(1, maxSide / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);
    const code = jsQR(canvas.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "attemptBoth" });
    if (!code?.data) throw new Error("未识别到二维码");
    return code.data;
  }

  async function joinFromScanData(data) {
    if (isAnswerScanData(data)) {
      await applyAnswerFromScanData(data);
      return;
    }
    if (!isInviteScanData(data)) throw new Error("不是有效的互传邀请");
    await joinRoom(data);
  }

  async function tryAutoJoinFromHash() {
    if (state.roomId || state.autoJoinBusy) return;
    const j = takePendingJoinToken();
    if (!j) return;
    state.autoJoinBusy = true;
    try {
      setError("");
      await joinRoom(`lanshare?j=${j}`);
      clearPendingJoinToken();
      history.replaceState(null, "", "#lanshare");
    } catch (e) {
      setError(e.message || "自动加入失败，请粘贴链接后点「确认加入」");
    } finally {
      state.autoJoinBusy = false;
    }
  }

  async function startScan() {
    try {
      await ensureQrLibs();
    } catch (e) {
      setError(e.message || "扫码库未加载");
      return;
    }
    if (typeof jsQR === "undefined") {
      setError("扫码库未加载");
      return;
    }
    stopScan();
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前环境无法打开摄像头，请用「图片识别邀请码」或手动粘贴");
      return;
    }
    try {
      const videoOpts = isIOS()
        ? { facingMode: "environment" }
        : { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } };
      camStream = await navigator.mediaDevices.getUserMedia({ video: videoOpts, audio: false });
      if (els.camVideo) {
        els.camVideo.setAttribute("playsinline", "");
        els.camVideo.setAttribute("webkit-playsinline", "");
        els.camVideo.playsInline = true;
        els.camVideo.muted = true;
        els.camVideo.srcObject = camStream;
        els.camVideo.hidden = false;
        await els.camVideo.play();
      }
      if (els.camWrap) els.camWrap.hidden = false;
      if (els.camStop) els.camStop.hidden = false;
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const tick = () => {
        if (!camStream || !els.camVideo || !ctx) return;
        const v = els.camVideo;
        if (v.readyState >= v.HAVE_CURRENT_DATA) {
          canvas.width = v.videoWidth;
          canvas.height = v.videoHeight;
          ctx.drawImage(v, 0, 0);
          try {
            const code = jsQR(canvas.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height, {
              inversionAttempts: "attemptBoth",
            });
            if (code?.data) {
              if (isAnswerScanData(code.data)) {
                stopScan();
                applyAnswerFromScanData(code.data).catch((err) => setError(err.message));
                return;
              }
              if (isInviteScanData(code.data)) {
                stopScan();
                joinFromScanData(code.data).catch((err) => setError(err.message));
                return;
              }
            }
          } catch (_) {
            /* ignore frame errors */
          }
        }
        scanRaf = requestAnimationFrame(tick);
      };
      scanRaf = requestAnimationFrame(tick);
    } catch (e) {
      setError(isIOS() ? "无法打开摄像头：请在 Safari 设置中允许相机，或改用「图片识别邀请码」" : "无法打开摄像头，请用图片识别或粘贴邀请文本");
    }
  }

  async function scanFromFile(file) {
    if (!file) return;
    stopScan();
    try {
      await ensureQrLibs();
    } catch (e) {
      setError(e.message || "扫码库未加载");
      return;
    }
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error("图片加载失败"));
        img.src = url;
      });
      const data = decodeQrFromImage(img);
      await joinFromScanData(data);
    } catch (e) {
      setError(e.message || "识别失败");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function stopScan() {
    if (scanRaf) cancelAnimationFrame(scanRaf);
    scanRaf = null;
    camStream?.getTracks().forEach((t) => t.stop());
    camStream = null;
    if (els.camVideo) {
      els.camVideo.srcObject = null;
      els.camVideo.hidden = true;
    }
    if (els.camWrap) els.camWrap.hidden = true;
    if (els.camStop) els.camStop.hidden = true;
  }

  async function startAnswerScan() {
    state.answerScanMode = true;
    await startScan();
  }

  els.createBtn?.addEventListener("click", () => createRoom().catch((e) => setError(e.message)));
  els.pasteJoinBtn?.addEventListener("click", () => pasteJoin());
  els.joinConfirmBtn?.addEventListener("click", () => confirmPasteJoin().catch((e) => setError(e.message)));
  els.copyInviteBtn?.addEventListener("click", () => copyInvite());
  els.scanAnswerBtn?.addEventListener("click", () => startAnswerScan());
  els.copyGuestAnswerBtn?.addEventListener("click", () => copyText(els.guestAnswerText?.value || "").catch((e) => setError(e.message)));
  els.scanBtn?.addEventListener("click", () => {
    state.answerScanMode = false;
    startScan();
  });
  els.scanFileBtn?.addEventListener("click", () => els.scanFileInput?.click());
  els.scanFileInput?.addEventListener("change", () => {
    const f = els.scanFileInput?.files?.[0];
    if (f) scanFromFile(f).catch((e) => setError(e.message));
    if (els.scanFileInput) els.scanFileInput.value = "";
  });
  els.camStop?.addEventListener("click", () => stopScan());
  els.leaveBtn?.addEventListener("click", () => leaveRoom());
  els.dissolveBtn?.addEventListener("click", () => dissolveRoom());
  els.pickBtn?.addEventListener("click", () => els.fileInput?.click());
  els.fileInput?.addEventListener("change", () => {
    if (els.fileInput?.files?.length) onFilesPicked(els.fileInput.files);
    if (els.fileInput) els.fileInput.value = "";
  });
  els.nameInput?.addEventListener("change", saveName);

  document.addEventListener("visibilitychange", () => {
    if (!state.roomId) return;
    state.pageHiddenWarn = document.hidden;
    paintStatus();
  });

  loadName();
  paintPlatformHint();
  disableIfUnsupported();
  paintStatus();
  tryApplyJoinAnswerFromHash().catch(() => {});
  tryAutoJoinFromHash().catch(() => {});

  window.LanShareSelfTest = {
    webrtcSupported,
    isIOS,
    isAndroid,
    isMobileClient,
    parseInviteAsync,
    parseJoinAnswerAsync,
    buildInviteUrl,
    buildInviteToken,
    buildJoinAnswerToken,
    inviteQrText,
    joinAnswerQrText,
    packInvitePayload,
    unpackInvitePayload,
    inviteLinkBase,
    isInviteScanData,
    isAnswerScanData,
    readJoinTokenFromHash,
    readAnswerTokenFromHash,
    takePendingJoinToken,
    getRoomId: () => state.roomId,
  };

  window.addEventListener("devtools:route", () => {
    const head = location.hash.replace("#", "").split(/[/?]/)[0];
    if (head !== "lanshare") stopScan();
    else {
      tryApplyJoinAnswerFromHash().catch(() => {});
      tryAutoJoinFromHash().catch(() => {});
    }
  });
})();
