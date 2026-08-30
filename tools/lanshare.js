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
  const PENDING_PWD_KEY = "devtools-lanshare-pending-p";
  const ANSWER_RELAY_PREFIX = "devtools-lanshare-answer";
  const OFFER_RELAY_PREFIX = "devtools-lanshare-offer";
  const HOST_ANSWER_RELAY_PREFIX = "devtools-lanshare-host-answer";
  const MQTT_BROKERS = [
    "wss://broker.emqx.io:8084/mqtt",
    "wss://broker.hivemq.com:8884/mqtt",
    "wss://test.mosquitto.org:8081/mqtt",
  ];
  const MQTT_TOPIC_PREFIX = "devtools/lanshare/v1";
  const MQTT_MSG_TTL_MS = 120000;
  const MQTT_OFFER_RETRY_MS = 2500;
  const MQTT_JOIN_TIMEOUT_MS = 45000;
  const ROOM_PWD_MIN = 4;
  const ROOM_PWD_MAX = 16;

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
    inviteQrApp: $("#ls-invite-qr-app"),
    copyInviteBtn: $("#ls-copy-invite"),
    scanAnswerBtn: $("#ls-scan-answer"),
    roomCodeEl: $("#ls-room-pwd-display"),
    hostOfferPaste: $("#ls-host-offer-paste"),
    hostOfferConfirmBtn: $("#ls-host-offer-confirm"),
    pairingGuide: $("#ls-pairing-guide"),
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
    roomPwdHost: $("#ls-room-pwd-host"),
    roomPwdJoin: $("#ls-room-pwd-join"),
    joinPwdBtn: $("#ls-join-pwd"),
    joinFallback: $("#ls-join-fallback"),
    roomMeta: $("#ls-room-meta"),
    membersEl: $("#ls-members"),
    filesEl: $("#ls-files"),
    fileInput: $("#ls-file-input"),
    pickBtn: $("#ls-pick"),
    leaveBtn: $("#ls-leave"),
    errorEl: $("#ls-error"),
    progressEl: $("#ls-progress"),
    progressBar: $("#ls-progress-bar"),
    progressText: $("#ls-progress-text"),
    camWrap: $("#ls-cam-wrap"),
    camVideo: $("#ls-cam-video"),
    camStop: $("#ls-cam-stop"),
    scanHint: $("#ls-scan-hint"),
  };

  /** @type {MediaStream|null} */
  let camStream = null;
  /** @type {number|null} */
  let scanTimer = null;
  /** @type {HTMLCanvasElement|null} */
  let scanCanvas = null;
  /** @type {number|null} */
  let busyProgressTimer = null;
  /** @type {number|null} */
  let infoTimer = null;
  /** @type {number} */
  let pendingJoinGen = 0;
  /** @type {number|null} */
  let downloadConnectTimer = null;

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
    /** @type {{ fileId: string, pct: number, label: string, phase: string }|null} */
    activeDownload: null,
    /** @type {string[]} */
    downloadQueue: [],
    /** @type {Map<string, { phase: string, pct: number, label: string }>} */
    fileLocalStatus: new Map(),
    /** @type {Map<string, { sent: number, total: number }>} */
    sendSessions: new Map(),
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
    offerBc: null,
    offerStorageHandler: null,
    hostAnswerBc: null,
    hostAnswerStorageHandler: null,
    answerScanMode: false,
    roomPassword: "",
    roomPasswordSlug: "",
    viaMqtt: false,
    mqttClient: null,
    mqttTopic: "",
    mqttHelloTimer: null,
    mqttSeen: null,
    mqttGuestHandler: null,
    mqttOfferRetryTimer: null,
    mqttJoinTimeoutTimer: null,
    mqttPendingOffer: null,
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

  async function tryApplyHostAnswerFromHash() {
    if (state.isHost || !state.controlPc) return false;
    const a = readAnswerTokenFromHash();
    if (!a) return false;
    const ok = await applyHostAnswer(joinAnswerQrText(a));
    if (ok) history.replaceState(null, "", "#lanshare");
    return ok;
  }

  function readJoinTokenFromHash() {
    const full = String(location.hash || "").replace(/^#/, "");
    if (!full.startsWith("lanshare?")) return "";
    const params = new URLSearchParams(full.slice(full.indexOf("?") + 1));
    const j = params.get("j");
    if (j) return j;
    const r = params.get("r");
    const h = params.get("h");
    if (r && h) return full;
    return "";
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

  function trimSdpMinimal(sdp) {
    if (!sdp) return sdp;
    const keep = [];
    for (const line of sdp.split(/\r?\n/)) {
      if (!line) continue;
      if (line.startsWith("a=candidate:")) continue;
      if (line.startsWith("a=end-of-candidates")) continue;
      if (line.startsWith("a=ssrc:")) continue;
      if (line.startsWith("a=msid:")) continue;
      keep.push(line);
    }
    return `${keep.join("\r\n")}\r\n`;
  }

  function toInviteRecord({ roomId, hostId, hostName, sdp }) {
    if (sdp) return { v: 1, r: roomId, h: hostId, n: hostName, s: trimSdpForLan(sdp) };
    return { v: 3, r: roomId, h: hostId, n: hostName };
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

  function fromOfferRecord(rec) {
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

  async function buildJoinOfferToken(offerSdp) {
    return packInvitePayload({
      t: "offer",
      r: state.roomId,
      h: state.hostId,
      f: state.peerId,
      s: trimSdpMinimal(offerSdp),
    });
  }

  async function buildHostAnswerToken(answerSdp, guestId) {
    return packInvitePayload({
      t: "host-answer",
      r: state.roomId,
      h: state.peerId,
      f: guestId,
      s: trimSdpMinimal(answerSdp),
    });
  }

  function inviteQrTextShort() {
    return `lanshare?r=${encodeURIComponent(state.roomId)}&h=${encodeURIComponent(state.peerId)}`;
  }

  function inviteQrText(token) {
    return `lanshare?j=${token}`;
  }

  function joinOfferQrText(token) {
    return `lanshare?o=${token}`;
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
        const params = new URLSearchParams(raw.slice(q + 1));
        const r = params.get("r");
        const h = params.get("h");
        if (r && h && !params.get("j")) {
          return {
            roomId: r,
            hostId: h,
            hostName: params.get("n") || "房主",
            sdp: null,
            mode: "short",
          };
        }
        const j = params.get("j");
        if (j) {
          const inv = fromInviteRecord(await unpackInvitePayload(j));
          if (inv.sdp) {
            inv.mode = "legacy-offer";
            return inv;
          }
          inv.mode = "short-token";
          return inv;
        }
      }
    }
    if (raw.startsWith(`${PROTO}|`)) {
      const i = raw.indexOf("|", PROTO.length + 1);
      if (i < 0) throw new Error("邀请码格式错误");
      const roomId = raw.slice(PROTO.length + 1, i);
      const data = b64dec(raw.slice(i + 1));
      const inv = fromInviteRecord({ roomId, ...data, sdp: data.sdp || data.s });
      inv.mode = inv.sdp ? "legacy-offer" : "short-token";
      return inv;
    }
    if (/^[zr][A-Za-z0-9_-]+$/.test(raw)) {
      const inv = fromInviteRecord(await unpackInvitePayload(raw));
      if (inv.sdp) {
        inv.mode = "legacy-offer";
        return inv;
      }
      inv.mode = "short-token";
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

  async function parseJoinOfferAsync(text) {
    const raw = normalizeInviteText(text);
    if (/^https?:\/\//i.test(raw)) {
      let u;
      try {
        u = new URL(raw);
      } catch {
        throw new Error("无效的连接码链接");
      }
      const frag = u.hash.replace(/^#/, "");
      if (frag.includes("lanshare")) return parseJoinOfferAsync(frag);
      throw new Error("链接不是互传连接码");
    }
    if (raw.startsWith("lanshare")) {
      const q = raw.indexOf("?");
      if (q >= 0) {
        const o = new URLSearchParams(raw.slice(q + 1)).get("o");
        if (o) {
          const offer = fromOfferRecord(await unpackInvitePayload(o));
          if (!offer.sdp) throw new Error("连接码缺少 SDP");
          return offer;
        }
      }
    }
    if (/^[zr][A-Za-z0-9_-]+$/.test(raw)) {
      const offer = fromOfferRecord(await unpackInvitePayload(raw));
      if (!offer.sdp) throw new Error("连接码缺少 SDP");
      return offer;
    }
    throw new Error("无效的连接码");
  }

  function isOfferScanData(data) {
    const s = normalizeInviteText(data);
    if (!s) return false;
    if (/^https?:\/\//i.test(s) && /lanshare/i.test(s) && /[?&]o=/.test(s)) return true;
    if (s.startsWith("lanshare?") && /(?:^|[?&])o=/.test(s)) return true;
    return false;
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
    if (isOfferScanData(s) || isAnswerScanData(s)) return false;
    if (s.startsWith(PROTO)) return true;
    if (/^https?:\/\//i.test(s) && /lanshare/i.test(s)) return true;
    if (s.startsWith("lanshare?")) return true;
    if (/^[zr][A-Za-z0-9_-]{8,}$/.test(s)) return true;
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

  function setInfo(msg) {
    clearTimeout(infoTimer);
    if (!msg || !els.statusText || !state.roomId) return;
    const base = `${state.members.size} 人在线 · 文件从上传者直传`;
    els.statusText.textContent = `${base} · ${msg}`;
    infoTimer = setTimeout(() => paintStatus(), 4500);
  }

  function attachProgressSlot(slot) {
    if (!els.progressEl) return;
    const host =
      slot === "create"
        ? els.createBtn?.closest(".ls-action-row") || els.createBtn?.parentElement
        : els.joinPwdBtn?.closest(".ls-action-row") || els.joinPwdBtn?.parentElement;
    if (host && els.progressEl.parentElement !== host) host.appendChild(els.progressEl);
  }

  function setProgress(pct, text, { busy = false } = {}) {
    if (!els.progressEl) return;
    const wrap = els.progressEl.querySelector(".ls-progress-bar-wrap");
    if (pct == null) {
      els.progressEl.hidden = true;
      wrap?.classList.remove("is-busy");
      if (els.progressBar) els.progressBar.style.width = "0%";
      if (els.progressText) els.progressText.textContent = "";
      return;
    }
    els.progressEl.hidden = false;
    wrap?.classList.toggle("is-busy", !!busy);
    if (!busy && els.progressBar) els.progressBar.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    if (els.progressText) els.progressText.textContent = text || "";
  }

  function startBusyProgress(text, slot = "join") {
    attachProgressSlot(slot);
    stopBusyProgress();
    setProgress(0, text, { busy: true });
    let p = 6;
    busyProgressTimer = window.setInterval(() => {
      p = Math.min(p + 4, 88);
      if (els.progressText) els.progressText.textContent = text;
      if (els.progressBar && !els.progressEl.querySelector(".ls-progress-bar-wrap")?.classList.contains("is-busy")) {
        els.progressBar.style.width = `${p}%`;
      }
    }, 380);
  }

  function stopBusyProgress() {
    if (busyProgressTimer) {
      clearInterval(busyProgressTimer);
      busyProgressTimer = null;
    }
    setProgress(null);
  }

  function setJoinUiBusy(busy) {
    const disabled = !!busy;
    if (els.createBtn) els.createBtn.disabled = disabled || !webrtcSupported();
    if (els.joinPwdBtn) els.joinPwdBtn.disabled = disabled || !webrtcSupported();
    if (els.scanBtn) els.scanBtn.disabled = disabled || !webrtcSupported();
    if (els.pasteJoinBtn) els.pasteJoinBtn.disabled = disabled || !webrtcSupported();
    if (els.joinConfirmBtn) els.joinConfirmBtn.disabled = disabled || !webrtcSupported();
  }

  function fileKindLabel(meta) {
    const mime = String(meta?.mime || "").toLowerCase();
    const ext = String(meta?.name || "")
      .split(".")
      .pop()
      ?.toLowerCase() || "";
    if (mime.startsWith("image/") || /^(jpg|jpeg|png|gif|webp|bmp|svg|heic|heif|avif)$/.test(ext)) return "图片";
    if (mime.startsWith("video/") || /^(mp4|mov|webm|mkv|avi|m4v|3gp)$/.test(ext)) return "视频";
    if (mime.startsWith("audio/") || /^(mp3|wav|flac|aac|m4a|ogg|opus)$/.test(ext)) return "音频";
    if (mime.startsWith("text/") || /^(txt|md|json|xml|html|css|js|ts|csv|log)$/.test(ext)) return "文本";
    if (/^(pdf|doc|docx|xls|xlsx|ppt|pptx)$/.test(ext)) return "文档";
    if (/^(zip|rar|7z|tar|gz)$/.test(ext)) return "压缩包";
    return "文件";
  }

  function isImageMeta(meta) {
    const mime = String(meta?.mime || "").toLowerCase();
    return mime.startsWith("image/") || !!meta?.thumb;
  }

  function filePreviewSrc(meta) {
    if (meta?.thumb) return meta.thumb;
    const local = state.localFiles.get(meta.id);
    if (local && local.type?.startsWith("image/")) {
      if (!meta._objUrl) {
        meta._objUrl = URL.createObjectURL(local);
      }
      return meta._objUrl;
    }
    return "";
  }

  async function makeImageThumb(file) {
    if (!file?.type?.startsWith("image/") || file.size > 12 * 1024 * 1024) return "";
    try {
      let bmp;
      if (typeof createImageBitmap === "function") {
        bmp = await createImageBitmap(file);
      } else {
        const url = URL.createObjectURL(file);
        try {
          bmp = await new Promise((resolve, reject) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = reject;
            img.src = url;
          });
        } finally {
          URL.revokeObjectURL(url);
        }
      }
      const maxSide = 128;
      const scale = Math.min(1, maxSide / Math.max(bmp.width || 1, bmp.height || 1));
      const w = Math.max(1, Math.round((bmp.width || 1) * scale));
      const h = Math.max(1, Math.round((bmp.height || 1) * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d")?.drawImage(bmp, 0, 0, w, h);
      bmp.close?.();
      return canvas.toDataURL("image/jpeg", 0.72);
    } catch {
      return "";
    }
  }

  function revokeFilePreviewUrls() {
    state.files.forEach((meta) => {
      if (meta._objUrl) {
        URL.revokeObjectURL(meta._objUrl);
        delete meta._objUrl;
      }
    });
  }

  function removeMemberFiles(memberId, { notify = false } = {}) {
    if (!memberId) return;
    const ids = [...state.files.values()].filter((f) => f.ownerId === memberId).map((f) => f.id);
    ids.forEach((id) => {
      const meta = state.files.get(id);
      if (meta?._objUrl) URL.revokeObjectURL(meta._objUrl);
      state.files.delete(id);
      state.localFiles.delete(id);
      if (notify) memberSend({ type: "file-remove", fileId: id });
    });
    if (ids.length) paintFiles();
  }

  function closeMemberLink(memberId) {
    const link = state.memberLinks.get(memberId);
    if (!link) return;
    link.dc?.close();
    link.pc?.close();
    state.memberLinks.delete(memberId);
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
    parts.push("推荐：房主创建时设置房间密码，成员输入密码即可自动加入。");
    if (isIOS()) {
      parts.push("iOS：请用 Safari；可用相机扫电脑上的邀请二维码（会自动打开链接），或让电脑复制链接发给你。");
    } else if (isAndroid()) {
      parts.push("Android：推荐 Chrome；可用微信/相机扫邀请码，或粘贴链接加入。");
    } else {
      parts.push("电脑作房主：手机扫邀请码或打开链接加入，再把手机上的连接码链接发回电脑粘贴即可（不必对着扫）。");
    }
    parts.push("所有设备需在同一局域网。");
    els.platformHint.hidden = false;
    els.platformHint.textContent = parts.join(" ");
  }

  function paintPairingGuide() {
    if (!els.pairingGuide) return;
    const inRoom = !!state.roomId;
    els.pairingGuide.hidden = !inRoom;
    if (!inRoom) return;
    if (state.isHost) {
      if (state.roomPassword) {
        els.pairingGuide.innerHTML =
          `<strong>房间密码：${escapeHtml(state.roomPassword)}</strong>` +
          '<p class="hint tight" style="margin:0.35rem 0 0">告诉成员此密码，对方输入即可自动连接，无需扫码或粘贴连接码。</p>';
      } else {
        els.pairingGuide.innerHTML =
          "<strong>电脑 + 手机配对</strong><ol class=\"hint tight\" style=\"margin:0.35rem 0 0 1.1rem;padding:0\">" +
          "<li>手机扫下方二维码，或用微信打开「邀请链接」</li>" +
          "<li>手机出现「连接码」后，复制链接发到电脑（微信/QQ 均可）</li>" +
          "<li>电脑粘贴到「粘贴成员连接码」并确认 — 也可摄像头扫手机连接码</li>" +
          "</ol>";
      }
    } else if (state.viaMqtt) {
      els.pairingGuide.innerHTML =
        '<strong>密码加入</strong><p class="hint tight" style="margin:0.35rem 0 0">正在通过房间密码自动配对，请稍候…</p>';
    } else {
      els.pairingGuide.innerHTML =
        "<strong>等待与房主配对</strong><p class=\"hint tight\" style=\"margin:0.35rem 0 0\">" +
        "请将下方连接码二维码或链接发给房主（微信/QQ）。若扫不出二维码，复制链接即可。</p>";
    }
  }

  function disableIfUnsupported() {
    const ok = webrtcSupported();
    if (els.createBtn) els.createBtn.disabled = !ok;
    if (els.scanBtn) els.scanBtn.disabled = !ok;
    if (els.pasteJoinBtn) els.pasteJoinBtn.disabled = !ok;
    if (els.joinConfirmBtn) els.joinConfirmBtn.disabled = !ok;
    if (els.joinPwdBtn) els.joinPwdBtn.disabled = !ok;
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
    else if (inRoom && !state.controlLinked) {
      statusExtra = state.viaMqtt ? " · 密码配对中…" : " · 正在连接…";
    }
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
    if (els.pickBtn) {
      els.pickBtn.disabled = !canUploadFiles();
      els.pickBtn.title = canUploadFiles() ? "" : "连接就绪后才可上传";
    }
    if (els.roomMeta) {
      els.roomMeta.hidden = !inRoom;
      els.roomMeta.textContent = state.isHost
        ? "你是房主：退出后由最近加入的在线成员接任"
        : `房主：${memberLabel(state.hostId)}`;
    }
    paintMembers();
    paintFiles();
    paintPairingGuide();
    if (els.roomCodeEl) {
      els.roomCodeEl.hidden = !inRoom || !state.isHost;
      if (inRoom && state.isHost) {
        if (state.roomPassword) {
          els.roomCodeEl.textContent = `房间密码 ${state.roomPassword} · 房间号 ${state.roomId}`;
        } else {
          els.roomCodeEl.textContent = `房间号 ${state.roomId}（也可复制链接分享）`;
        }
      }
    }
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

  function openJoinFallback(hint) {
    if (els.joinFallback) els.joinFallback.open = true;
    if (hint) setError(hint);
  }

  function setFileLocalStatus(fileId, pct, label, phase) {
    state.fileLocalStatus.set(fileId, { pct, label, phase });
    updateFileRowActions(fileId);
  }

  function clearFileLocalStatus(fileId) {
    state.fileLocalStatus.delete(fileId);
    let touched = false;
    for (const key of state.sendSessions.keys()) {
      if (key.startsWith(`${fileId}:`)) {
        state.sendSessions.delete(key);
        touched = true;
      }
    }
    if (touched || state.fileLocalStatus.has(fileId)) updateFileRowActions(fileId);
  }

  function bumpSendProgress(fileId, requesterId, sent, total) {
    state.sendSessions.set(`${fileId}:${requesterId}`, { sent, total });
    let maxPct = 0;
    let lanes = 0;
    for (const [key, v] of state.sendSessions) {
      if (!key.startsWith(`${fileId}:`)) continue;
      lanes += 1;
      if (v.total > 0) maxPct = Math.max(maxPct, (v.sent / v.total) * 100);
    }
    const label =
      lanes > 1
        ? `发送中 · ${lanes} 人 ${total ? fmtSize(sent) + " / " + fmtSize(total) : ""}`.trim()
        : total
          ? `发送 ${fmtSize(sent)} / ${fmtSize(total)}`
          : "发送中…";
    setFileLocalStatus(fileId, maxPct, label, "sending");
  }

  function clearSendSession(fileId, requesterId) {
    state.sendSessions.delete(`${fileId}:${requesterId}`);
    let lanes = 0;
    for (const key of state.sendSessions.keys()) {
      if (key.startsWith(`${fileId}:`)) lanes += 1;
    }
    if (lanes === 0) {
      state.fileLocalStatus.delete(fileId);
      updateFileRowActions(fileId);
    }
  }

  const RING_PATH =
    "M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831";

  function ringProgressHtml(pct, label, { busy = false } = {}) {
    const p = Math.min(100, Math.max(0, pct));
    const title = escapeHtml(label || "");
    const dash = busy ? "" : ` stroke-dasharray="${(p * 0.942).toFixed(2)}, 100"`;
    const busyCls = busy ? " is-busy" : "";
    const pctInner = busy ? "" : `<span class="ls-ring-pct mono">${Math.round(p)}</span>`;
    return (
      `<div class="ls-ring-progress${busyCls}" role="progressbar" aria-valuemin="0" aria-valuemax="100"` +
      (busy ? "" : ` aria-valuenow="${Math.round(p)}"`) +
      ` title="${title}" aria-label="${title}">` +
      `<svg class="ls-ring-svg" viewBox="0 0 36 36" aria-hidden="true">` +
      `<path class="ls-ring-track" d="${RING_PATH}" fill="none" stroke-width="3"/>` +
      `<path class="ls-ring-fill" d="${RING_PATH}" fill="none" stroke-width="3"${dash}/>` +
      `</svg>${pctInner}</div>`
    );
  }

  function fileActionsInnerHtml(f) {
    const mine = f.ownerId === state.peerId;
    const local = state.fileLocalStatus.get(f.id);
    if (mine) {
      if (local?.phase === "processing") {
        return (
          ringProgressHtml(0, local.label || "处理中…", { busy: true }) +
          `<button type="button" class="ghost-btn ls-del" data-id="${f.id}" disabled>删除</button>`
        );
      }
      if (local?.phase === "sending") {
        const pct = Math.min(100, Math.max(0, local.pct));
        return (
          ringProgressHtml(pct, local.label || "发送中…") +
          `<button type="button" class="ghost-btn ls-del" data-id="${f.id}">删除</button>`
        );
      }
      return `<button type="button" class="ghost-btn ls-del" data-id="${f.id}">删除</button>`;
    }
    if (state.downloadQueue.includes(f.id) && state.activeDownload?.fileId !== f.id) {
      const pos = state.downloadQueue.indexOf(f.id) + 1;
      return `<span class="ls-dl-status is-queue">排队 #${pos}</span>`;
    }
    const dl = state.activeDownload;
    if (dl?.fileId === f.id) {
      if (dl.phase === "done") {
        return `<span class="ls-dl-status is-ok">已完成</span>`;
      }
      if (dl.phase === "error") {
        return `<button type="button" class="secondary-btn ls-dl" data-id="${f.id}">重试</button>`;
      }
      const pct = Math.min(100, Math.max(0, dl.pct));
      const busy = dl.phase === "connecting" && pct <= 0;
      return ringProgressHtml(pct, dl.label || "下载中…", { busy });
    }
    return `<button type="button" class="secondary-btn ls-dl" data-id="${f.id}">下载</button>`;
  }

  function bindFileRowActions(root = els.filesEl) {
    if (!root) return;
    $$(".ls-del", root).forEach((btn) => btn.addEventListener("click", () => removeFile(btn.dataset.id)));
    $$(".ls-dl", root).forEach((btn) => btn.addEventListener("click", () => requestDownload(btn.dataset.id)));
  }

  function setDownloadProgress(fileId, pct, label, phase = "downloading") {
    state.activeDownload = { fileId, pct, label, phase };
    state.transferring = phase === "connecting" || phase === "downloading";
    updateFileRowActions(fileId);
  }

  function isDownloadBusy() {
    const p = state.activeDownload?.phase;
    return p === "connecting" || p === "downloading";
  }

  function advanceDownloadQueue() {
    state.activeDownload = null;
    state.transferring = false;
    while (state.downloadQueue.length) {
      const next = state.downloadQueue.shift();
      const f = state.files.get(next);
      if (f && f.ownerId !== state.peerId) {
        startDownloadRequest(next);
        return;
      }
    }
    paintFiles();
  }

  function finishDownloadProgress(fileId, ok) {
    clearTimeout(downloadConnectTimer);
    downloadConnectTimer = null;
    if (ok) {
      setDownloadProgress(fileId, 100, "已完成", "done");
      setTimeout(() => {
        if (state.activeDownload?.fileId === fileId && state.activeDownload.phase === "done") {
          advanceDownloadQueue();
        }
      }, 1800);
    } else {
      setDownloadProgress(fileId, 0, "失败", "error");
      state.transferring = false;
      setTimeout(() => {
        if (state.activeDownload?.fileId === fileId && state.activeDownload.phase === "error") {
          advanceDownloadQueue();
        }
      }, 2500);
    }
  }

  function clearDownloadProgress() {
    clearTimeout(downloadConnectTimer);
    downloadConnectTimer = null;
    state.activeDownload = null;
    state.downloadQueue = [];
    state.transferring = false;
  }

  function updateFileRowActions(fileId) {
    if (!els.filesEl) return;
    const row = els.filesEl.querySelector(`.ls-file-row[data-id="${CSS.escape(fileId)}"]`);
    if (!row) {
      paintFiles();
      return;
    }
    const actions = row.querySelector(".ls-file-actions");
    const f = state.files.get(fileId);
    if (actions && f) {
      actions.innerHTML = fileActionsInnerHtml(f);
      bindFileRowActions(actions);
    }
  }

  function paintFiles() {
    if (!els.filesEl) return;
    const list = [...state.files.values()].sort((a, b) => b.addedAt - a.addedAt);
    els.filesEl.innerHTML = list.length
      ? list
          .map((f) => {
            const kind = fileKindLabel(f);
            const preview = filePreviewSrc(f);
            const previewHtml = preview
              ? `<div class="ls-file-preview"><img class="ls-file-thumb" src="${preview}" alt="" loading="lazy" /></div>`
              : `<div class="ls-file-preview"><span class="ls-file-kind-badge">${escapeHtml(kind)}</span></div>`;
            return `<div class="ls-file-row" data-id="${escapeHtml(f.id)}">${previewHtml}<div class="ls-file-main"><strong>${escapeHtml(f.name)}</strong><span class="hint mono"><span class="ls-file-kind-tag">${escapeHtml(kind)}</span>${fmtSize(f.size)} · ${escapeHtml(memberLabel(f.ownerId))}</span></div><div class="ls-file-actions btn-row tight">${fileActionsInnerHtml(f)}</div></div>`;
          })
          .join("")
      : '<p class="hint tight">暂无文件，点「选择文件」上传</p>';
    bindFileRowActions();
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

  async function renderGuestSignalQr(token, kind) {
    const el = els.guestAnswerQr;
    if (!el) return;
    el.innerHTML = "";
    await ensureQrLibs();
    if (typeof QRCode === "undefined") {
      el.textContent = kind === "offer" ? "二维码库未加载，请复制下方连接码" : "二维码库未加载，请复制下方应答链接";
      return;
    }
    const qrText = kind === "offer" ? joinOfferQrText(token) : joinAnswerQrText(token);
    const tries = [QRCode.CorrectLevel.L, QRCode.CorrectLevel.M];
    for (const text of [`${inviteLinkBase()}#${qrText}`, qrText]) {
      for (const level of tries) {
        try {
          renderQrBox(el, text, level);
          return;
        } catch (err) {
          if (!/Too long|overflow|code length overflow/i.test(String(err.message || err))) break;
        }
      }
    }
    el.innerHTML = '<p class="hint tight">连接码较长，请复制下方链接给房主。</p>';
  }

  async function updateInviteDisplay() {
    const shortText = inviteQrTextShort();
    const url = `${inviteLinkBase()}#${shortText}`;
    if (els.inviteText) els.inviteText.value = url;
    await renderInviteQr();
  }

  async function ensureQrLibs() {
    if (typeof QRCode !== "undefined" && typeof jsQR === "function") return;
    if (!window.DevToolsLazy?.loadVendor) {
      throw new Error("脚本加载器未就绪，请刷新页面后重试");
    }
    if (typeof QRCode === "undefined") await window.DevToolsLazy.loadVendor("qrcode");
    if (typeof jsQR !== "function") await window.DevToolsLazy.loadVendor("jsQR");
    if (typeof QRCode === "undefined" || typeof jsQR !== "function") {
      throw new Error("二维码库加载失败，请检查网络后刷新页面");
    }
  }

  function getMqttConnect() {
    const m = typeof mqtt !== "undefined" ? mqtt : null;
    if (!m) return null;
    if (typeof m.connect === "function") return m.connect.bind(m);
    if (typeof m.default?.connect === "function") return m.default.connect.bind(m.default);
    if (typeof m.default === "function") return m.default;
    return null;
  }

  async function ensureMqttLib() {
    if (getMqttConnect()) return;
    if (!window.DevToolsLazy?.loadVendor) throw new Error("脚本加载器未就绪，请刷新页面后重试");
    await window.DevToolsLazy.loadVendor("mqtt");
    if (!getMqttConnect()) throw new Error("信令库加载失败，请检查网络后刷新");
  }

  function normalizeRoomPassword(raw) {
    return String(raw || "")
      .trim()
      .replace(/\s+/g, "")
      .slice(0, ROOM_PWD_MAX);
  }

  function validateRoomPassword(pwd) {
    const n = normalizeRoomPassword(pwd);
    if (n.length < ROOM_PWD_MIN || n.length > ROOM_PWD_MAX) {
      throw new Error(`房间密码需 ${ROOM_PWD_MIN}–${ROOM_PWD_MAX} 位字母或数字`);
    }
    if (!/^[A-Za-z0-9]+$/.test(n)) throw new Error("房间密码仅支持字母和数字");
    return n;
  }

  async function hashRoomPassword(pwd) {
    const norm = normalizeRoomPassword(pwd).toLowerCase();
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(norm));
    return Array.from(new Uint8Array(buf))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 24);
  }

  function mqttTopicForSlug(slug) {
    return `${MQTT_TOPIC_PREFIX}/${slug}`;
  }

  function isValidMqttMsg(msg) {
    return msg && msg.proto === PROTO && typeof msg.type === "string" && typeof msg.ts === "number";
  }

  function mqttDedupeKey(msg) {
    return `${msg.type}:${msg.memberId || ""}:${msg.hostId || ""}:${msg.ts}`;
  }

  function shouldAcceptMqttMsg(msg) {
    if (!isValidMqttMsg(msg)) return false;
    if (Date.now() - msg.ts > MQTT_MSG_TTL_MS) return false;
    if (!state.mqttSeen) state.mqttSeen = new Set();
    const key = mqttDedupeKey(msg);
    if (state.mqttSeen.has(key)) return false;
    state.mqttSeen.add(key);
    return true;
  }

  function publishMqttPayload(msg, { retain = false } = {}) {
    if (!state.mqttClient || !state.mqttTopic) return;
    const body = JSON.stringify({ proto: PROTO, ts: Date.now(), ...msg });
    state.mqttClient.publish(state.mqttTopic, body, { qos: 0, retain });
  }

  function trimSdpForMqttSignal(sdp) {
    return trimSdpForLan(sdp);
  }

  function connectMqttOnce(brokerUrl, topic) {
    const connectFn = getMqttConnect();
    if (!connectFn) return Promise.reject(new Error("信令库不可用"));
    return new Promise((resolve, reject) => {
      const client = connectFn(brokerUrl, {
        clientId: `ls_${uid(12)}`,
        clean: true,
        reconnectPeriod: 5000,
        connectTimeout: 10000,
      });
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(to);
        try {
          client.end(true);
        } catch (_) {
          /* ignore */
        }
        reject(err instanceof Error ? err : new Error(String(err || "信令连接失败")));
      };
      const to = setTimeout(() => fail(new Error("连接信令超时")), 12000);
      client.on("error", fail);
      client.on("connect", () => {
        client.subscribe(topic, { qos: 0 }, (err) => {
          if (err) {
            fail(err);
            return;
          }
          if (settled) return;
          settled = true;
          clearTimeout(to);
          resolve(client);
        });
      });
    });
  }

  async function connectMqttTopic(slug) {
    const topic = mqttTopicForSlug(slug);
    let lastErr = null;
    for (const broker of MQTT_BROKERS) {
      try {
        const client = await connectMqttOnce(broker, topic);
        return { client, topic, broker };
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("无法连接信令服务器，请检查网络后重试");
  }

  function clearMqttJoinTimers() {
    if (state.mqttOfferRetryTimer) {
      clearInterval(state.mqttOfferRetryTimer);
      state.mqttOfferRetryTimer = null;
    }
    if (state.mqttJoinTimeoutTimer) {
      clearTimeout(state.mqttJoinTimeoutTimer);
      state.mqttJoinTimeoutTimer = null;
    }
    state.mqttPendingOffer = null;
  }

  function startMqttGuestJoinWatch() {
    clearMqttJoinTimers();
    if (!state.viaMqtt || state.isHost) return;
    state.mqttJoinTimeoutTimer = setTimeout(() => {
      if (state.controlLinked || !state.roomId || state.isHost) return;
      openJoinFallback("自动配对超时：请确认房主在线且密码正确，或改用下方扫码/粘贴邀请");
      paintStatus();
    }, MQTT_JOIN_TIMEOUT_MS);
  }

  function publishMqttGuestOffer(offerSdp, inv) {
    if (!state.mqttClient || !state.mqttTopic) return;
    publishMqttPayload({
      type: "guest-offer",
      roomId: inv.roomId,
      hostId: inv.hostId,
      memberId: state.peerId,
      memberName: state.peerName,
      sdp: trimSdpForMqttSignal(offerSdp),
    });
  }

  function startMqttOfferRetry(offerSdp, inv) {
    state.mqttPendingOffer = { offerSdp, inv };
    publishMqttGuestOffer(offerSdp, inv);
    if (state.mqttOfferRetryTimer) clearInterval(state.mqttOfferRetryTimer);
    state.mqttOfferRetryTimer = setInterval(() => {
      if (state.controlLinked || !state.viaMqtt || state.isHost || !state.mqttPendingOffer) {
        clearMqttJoinTimers();
        return;
      }
      publishMqttGuestOffer(state.mqttPendingOffer.offerSdp, state.mqttPendingOffer.inv);
    }, MQTT_OFFER_RETRY_MS);
  }

  function waitMqttHostHello(slug, timeoutMs = 20000) {
    return connectMqttTopic(slug).then(
      ({ client, topic }) =>
        new Promise((resolve, reject) => {
          let settled = false;
          const finish = (fn, val) => {
            if (settled) return;
            settled = true;
            clearTimeout(to);
            client.removeListener("message", onMsg);
            fn(val);
          };
          const onMsg = (_t, payload) => {
            try {
              const msg = JSON.parse(payload.toString());
              if (!isValidMqttMsg(msg) || msg.type !== "host-hello") return;
              if (Date.now() - msg.ts > MQTT_MSG_TTL_MS) return;
              if (!msg.roomId || !msg.hostId) return;
              finish(resolve, { client, topic, hello: msg });
            } catch (_) {
              /* ignore */
            }
          };
          const to = setTimeout(
            () => {
              try {
                client.end(true);
              } catch (_) {
                /* ignore */
              }
              finish(reject, new Error("未找到该密码的房间，请确认密码或让房主已创建房间"));
            },
            timeoutMs
          );
          client.on("message", onMsg);
        })
    );
  }

  function onMqttHostMessage(_t, payload) {
    let msg;
    try {
      msg = JSON.parse(payload.toString());
    } catch {
      return;
    }
    if (!shouldAcceptMqttMsg(msg)) return;
    if (msg.type !== "guest-offer" || !state.isHost) return;
    if (msg.roomId && msg.roomId !== state.roomId) return;
    if (msg.hostId && msg.hostId !== state.peerId) return;
    applyJoinOfferFromMqtt({
      sdp: msg.sdp,
      roomId: msg.roomId,
      hostId: msg.hostId,
      memberId: msg.memberId,
    }).catch(() => {});
  }

  async function applyJoinOfferFromMqtt(parsed) {
    let ok = await applyJoinOfferDirect(parsed);
    if (!ok && state.isHost && state.viaMqtt) {
      await refreshJoinSlot();
      ok = await applyJoinOfferDirect(parsed);
    }
    if (!ok && state.isHost && state.viaMqtt) {
      setError("成员密码加入配对失败，请让对方重点「密码加入」");
    }
  }

  function onMqttGuestMessage(_t, payload) {
    let msg;
    try {
      msg = JSON.parse(payload.toString());
    } catch {
      return;
    }
    if (!shouldAcceptMqttMsg(msg)) return;
    if (msg.type !== "host-answer" || state.isHost) return;
    if (msg.memberId && msg.memberId !== state.peerId) return;
    if (msg.roomId && msg.roomId !== state.roomId) return;
    applyHostAnswerDirect(msg.sdp).catch(() => {});
  }

  async function startMqttHost() {
    if (!state.roomPasswordSlug) return;
    await ensureMqttLib();
    stopMqttSignaling();
    state.mqttSeen = new Set();
    const { client, topic } = await connectMqttTopic(state.roomPasswordSlug);
    state.mqttClient = client;
    state.mqttTopic = topic;
    client.on("message", onMqttHostMessage);
    const publishHello = () => {
      publishMqttPayload(
        {
          type: "host-hello",
          roomId: state.roomId,
          hostId: state.peerId,
          hostName: state.peerName,
        },
        { retain: true }
      );
    };
    publishHello();
    state.mqttHelloTimer = setInterval(publishHello, 8000);
  }

  function attachMqttGuest(client, topic) {
    if (state.mqttGuestHandler) client.removeListener("message", state.mqttGuestHandler);
    state.mqttClient = client;
    state.mqttTopic = topic;
    state.mqttSeen = new Set();
    state.mqttGuestHandler = onMqttGuestMessage;
    client.on("message", state.mqttGuestHandler);
  }

  function stopMqttSignaling() {
    clearMqttJoinTimers();
    if (state.mqttHelloTimer) {
      clearInterval(state.mqttHelloTimer);
      state.mqttHelloTimer = null;
    }
    const client = state.mqttClient;
    if (client) {
      if (state.mqttGuestHandler) {
        client.removeListener("message", state.mqttGuestHandler);
        state.mqttGuestHandler = null;
      }
      if (state.isHost && state.roomPasswordSlug && state.mqttTopic) {
        try {
          client.publish(state.mqttTopic, "", { qos: 0, retain: true });
        } catch (_) {
          /* ignore */
        }
      }
      try {
        client.end(true);
      } catch (_) {
        /* ignore */
      }
    }
    state.mqttClient = null;
    state.mqttTopic = "";
    state.mqttSeen = null;
  }

  async function preloadPanel() {
    try {
      await window.DevToolsLazy?.ensureForTool?.("lanshare");
      await ensureQrLibs();
    } catch (e) {
      setError(e?.message || "互传组件加载失败，请刷新页面");
    }
  }

  function renderQrBox(el, text, level) {
    el.innerHTML = "";
    // eslint-disable-next-line no-new
    new QRCode(el, { text, width: 168, height: 168, correctLevel: level });
  }

  async function renderInviteQr() {
    if (els.inviteQr) els.inviteQr.innerHTML = "";
    if (els.inviteQrApp) els.inviteQrApp.innerHTML = "";
    if (!els.inviteQr && !els.inviteQrApp) return;
    await ensureQrLibs();
    if (typeof QRCode === "undefined") {
      const msg = "二维码库未加载，请复制下方邀请文本";
      if (els.inviteQr) els.inviteQr.textContent = msg;
      if (els.inviteQrApp) els.inviteQrApp.textContent = msg;
      return;
    }
    const shortText = inviteQrTextShort();
    const fullUrl = `${inviteLinkBase()}#${shortText}`;
    const tries = [QRCode.CorrectLevel.L, QRCode.CorrectLevel.M];
    if (els.inviteQrApp) {
      for (const level of tries) {
        try {
          renderQrBox(els.inviteQrApp, shortText, level);
          break;
        } catch (err) {
          if (!/Too long|overflow|code length overflow/i.test(String(err.message || err))) break;
        }
      }
      if (!els.inviteQrApp.childNodes.length) {
        els.inviteQrApp.innerHTML = '<p class="hint tight">短码生成失败</p>';
      }
    }
    if (!els.inviteQr) return;
    for (const text of [fullUrl, shortText]) {
      for (const level of tries) {
        try {
          renderQrBox(els.inviteQr, text, level);
          return;
        } catch (err) {
          if (!/Too long|overflow|code length overflow/i.test(String(err.message || err))) break;
        }
      }
    }
    els.inviteQr.innerHTML = '<p class="hint tight">二维码生成失败，请复制下方链接分享。</p>';
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
    clearMqttJoinTimers();
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
        if (msg.memberId && state.members.has(msg.memberId)) {
          const leftName = msg.name || memberLabel(msg.memberId);
          state.members.delete(msg.memberId);
          removeMemberFiles(msg.memberId);
          if (state.isHost) closeMemberLink(msg.memberId);
          setInfo(`${leftName} 已退出`);
          paintStatus();
        }
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
        setError(msg.reason === "host-offline" ? "房主已离线，房间已结束" : "房主已解散房间");
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
      if (state.isHost && remoteId && remoteId !== state.peerId && state.members.has(remoteId)) {
        const leftName = memberLabel(remoteId);
        state.members.delete(remoteId);
        removeMemberFiles(remoteId);
        closeMemberLink(remoteId);
        broadcast({ type: "member-left", memberId: remoteId, name: leftName });
        setInfo(`${leftName} 已退出`);
        paintStatus();
      } else if (!state.isHost && remoteId === state.hostId && state.roomId) {
        setError("房主已离线，房间已结束");
        cleanupRoom(true);
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

  function stopOfferRelayListen() {
    state.offerBc?.close();
    state.offerBc = null;
    if (state.offerStorageHandler) {
      window.removeEventListener("storage", state.offerStorageHandler);
      state.offerStorageHandler = null;
    }
  }

  function stopHostAnswerListen() {
    state.hostAnswerBc?.close();
    state.hostAnswerBc = null;
    if (state.hostAnswerStorageHandler) {
      window.removeEventListener("storage", state.hostAnswerStorageHandler);
      state.hostAnswerStorageHandler = null;
    }
  }

  function stopSignalRelayListen() {
    stopAnswerRelayListen();
    stopOfferRelayListen();
    stopHostAnswerListen();
  }

  function startOfferRelayListen() {
    stopOfferRelayListen();
    if (!state.isHost || !state.roomId) return;
    try {
      state.offerBc = new BroadcastChannel(`${OFFER_RELAY_PREFIX}:${state.roomId}`);
      state.offerBc.onmessage = (ev) => {
        const payload = ev.data;
        if (!payload) return;
        applyJoinOffer(payload.offerText || payload.text || (payload.token ? joinOfferQrText(payload.token) : "")).catch(
          () => {}
        );
      };
    } catch (_) {
      /* ignore */
    }
    state.offerStorageHandler = (ev) => {
      if (ev.key !== `${OFFER_RELAY_PREFIX}:${state.roomId}` || !ev.newValue) return;
      applyJoinOffer(joinOfferQrText(ev.newValue)).catch(() => {});
    };
    window.addEventListener("storage", state.offerStorageHandler);
    try {
      const cached = localStorage.getItem(`${OFFER_RELAY_PREFIX}:${state.roomId}`);
      if (cached) applyJoinOffer(joinOfferQrText(cached)).catch(() => {});
    } catch (_) {
      /* ignore */
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

  function readOfferTokenFromHash() {
    const full = String(location.hash || "").replace(/^#/, "");
    if (!full.startsWith("lanshare?")) return "";
    return new URLSearchParams(full.slice(full.indexOf("?") + 1)).get("o") || "";
  }

  function readAnswerTokenFromHash() {
    const full = String(location.hash || "").replace(/^#/, "");
    if (!full.startsWith("lanshare?")) return "";
    return new URLSearchParams(full.slice(full.indexOf("?") + 1)).get("a") || "";
  }

  async function tryApplyJoinOfferFromHash() {
    if (!state.isHost || !state.pendingJoin?.pc) return false;
    const o = readOfferTokenFromHash();
    if (!o) return false;
    const ok = await applyJoinOffer(joinOfferQrText(o));
    if (ok) history.replaceState(null, "", "#lanshare");
    return ok;
  }

  async function tryApplyJoinAnswerFromHash() {
    if (!state.isHost || !state.pendingJoin?.pc) return false;
    const a = readAnswerTokenFromHash();
    if (!a) return false;
    const ok = await applyJoinAnswer(joinAnswerQrText(a));
    if (ok) history.replaceState(null, "", "#lanshare");
    return ok;
  }

  async function applyJoinOfferDirect(parsed) {
    if (!state.isHost || !state.pendingJoin?.pc) return false;
    if (!parsed?.sdp) return false;
    if (parsed.roomId && parsed.roomId !== state.roomId) return false;
    if (parsed.hostId && parsed.hostId !== state.peerId) return false;
    const pc = state.pendingJoin.pc;
    if (pc.signalingState !== "stable" || pc.localDescription) return false;
    try {
      await pc.setRemoteDescription({ type: "offer", sdp: parsed.sdp });
      const ans = await pc.createAnswer();
      await pc.setLocalDescription(ans);
      await waitIce(pc);
      await publishHostAnswer(pc.localDescription.sdp, parsed.memberId || "");
      setError("");
      return true;
    } catch (e) {
      setError(e?.message || "成员连接码无效，请让其重新加入");
      return false;
    }
  }

  async function applyJoinOffer(text) {
    const parsed = await parseJoinOfferAsync(text);
    return applyJoinOfferDirect(parsed);
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

  async function publishJoinOffer(offerSdp, inv) {
    if (state.viaMqtt && state.mqttClient) {
      startMqttOfferRetry(offerSdp, inv);
      startMqttGuestJoinWatch();
      if (els.guestAnswerArea) els.guestAnswerArea.hidden = true;
      paintStatus();
      return;
    }

    const token = await buildJoinOfferToken(offerSdp);
    const offerText = joinOfferQrText(token);
    const offerUrl = `${inviteLinkBase()}#${offerText}`;

    try {
      const bc = new BroadcastChannel(`${OFFER_RELAY_PREFIX}:${inv.roomId}`);
      bc.postMessage({ token, offerText, offerUrl });
      bc.close();
    } catch (_) {
      /* ignore */
    }
    try {
      localStorage.setItem(`${OFFER_RELAY_PREFIX}:${inv.roomId}`, token);
    } catch (_) {
      /* ignore */
    }

    if (els.guestAnswerArea) els.guestAnswerArea.hidden = false;
    if (els.guestAnswerText) els.guestAnswerText.value = offerUrl;
    await renderGuestSignalQr(token, "offer");
    try {
      await copyText(offerUrl);
    } catch (_) {
      /* ignore */
    }
    paintStatus();
  }

  async function publishHostAnswer(answerSdp, guestId) {
    if (state.viaMqtt && state.mqttClient) {
      const ansMsg = {
        type: "host-answer",
        roomId: state.roomId,
        hostId: state.peerId,
        memberId: guestId,
        sdp: trimSdpForMqttSignal(answerSdp),
      };
      publishMqttPayload(ansMsg);
      setTimeout(() => publishMqttPayload(ansMsg), 1200);
    }

    const token = await buildHostAnswerToken(answerSdp, guestId);
    const answerText = joinAnswerQrText(token);
    const relayKey = `${HOST_ANSWER_RELAY_PREFIX}:${state.roomId}:${guestId || "any"}`;
    try {
      const bc = new BroadcastChannel(relayKey);
      bc.postMessage({ token, answerText });
      bc.close();
    } catch (_) {
      /* ignore */
    }
    try {
      localStorage.setItem(relayKey, token);
    } catch (_) {
      /* ignore */
    }
  }

  function startHostAnswerListen(roomId, peerId) {
    stopHostAnswerListen();
    const relayKey = `${HOST_ANSWER_RELAY_PREFIX}:${roomId}:${peerId}`;
    try {
      state.hostAnswerBc = new BroadcastChannel(relayKey);
      state.hostAnswerBc.onmessage = (ev) => {
        const payload = ev.data;
        if (!payload) return;
        applyHostAnswer(payload.answerText || (payload.token ? joinAnswerQrText(payload.token) : "")).catch(() => {});
      };
    } catch (_) {
      /* ignore */
    }
    state.hostAnswerStorageHandler = (ev) => {
      if (ev.key !== relayKey || !ev.newValue) return;
      applyHostAnswer(joinAnswerQrText(ev.newValue)).catch(() => {});
    };
    window.addEventListener("storage", state.hostAnswerStorageHandler);
    try {
      const cached = localStorage.getItem(relayKey);
      if (cached) applyHostAnswer(joinAnswerQrText(cached)).catch(() => {});
    } catch (_) {
      /* ignore */
    }
  }

  async function applyHostAnswerDirect(sdp) {
    if (state.isHost || !state.controlPc || state.controlLinked) return false;
    if (!sdp) return false;
    const pc = state.controlPc;
    if (pc.signalingState !== "have-local-offer") return false;
    try {
      await pc.setRemoteDescription({ type: "answer", sdp });
      whenDcOpen(state.controlDc, () => {
        sendHello(state.controlDc);
        paintStatus();
      });
      setError("");
      return true;
    } catch (e) {
      setError(e?.message || "房主应答无效，请让房主重新扫描连接码");
      return false;
    }
  }

  async function applyHostAnswer(text) {
    if (state.isHost || !state.controlPc || state.controlLinked) return false;
    const parsed = await parseJoinAnswerAsync(text);
    if (!parsed?.sdp) return false;
    if (parsed.roomId && parsed.roomId !== state.roomId) return false;
    if (parsed.memberId && parsed.memberId !== state.peerId) return false;
    return applyHostAnswerDirect(parsed.sdp);
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
    await renderGuestSignalQr(token, "answer");
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

  async function applyOfferFromScanData(data) {
    if (!state.isHost) throw new Error("仅房主可扫描成员连接码");
    const ok = await applyJoinOffer(data);
    if (!ok) throw new Error("连接码无效或已过期，请让成员重新加入");
    setError("");
  }

  async function refreshJoinSlot() {
    if (!state.isHost) return;
    const prev = state.pendingJoin;
    state.pendingJoin = null;
    prev?.pc?.close();

    const pc = createPeer();
    const slotGen = (pendingJoinGen += 1);
    let settled = false;
    state.pendingJoin = { pc, dc: null, gen: slotGen };

    pc.ondatachannel = (ev) => {
      const dc = ev.channel;
      state.pendingJoin.dc = dc;
      dc.onmessage = (e) => {
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
    };

    pc.onconnectionstatechange = () => {
      if (state.pendingJoin?.pc !== pc || state.pendingJoin?.gen !== slotGen) return;
      if (pc.connectionState === "failed") {
        setError("新成员连接失败，请让对方重新加入");
        refreshJoinSlot().catch(() => {});
      }
    };

    startOfferRelayListen();
    startAnswerRelayListen();
    await updateInviteDisplay();
    tryApplyJoinOfferFromHash().catch(() => {});
    tryApplyJoinAnswerFromHash().catch(() => {});
  }

  async function createRoom() {
    if (!webrtcSupported()) {
      setError("当前浏览器不支持 WebRTC");
      return;
    }
    setJoinUiBusy(true);
    startBusyProgress("正在创建房间…", "create");
    try {
      await ensureQrLibs();
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

      const pwdRaw = els.roomPwdHost?.value || "";
      if (normalizeRoomPassword(pwdRaw)) {
        state.roomPassword = validateRoomPassword(pwdRaw);
        state.roomPasswordSlug = await hashRoomPassword(state.roomPassword);
        state.viaMqtt = true;
      }

      if (state.viaMqtt) {
        if (els.progressText) els.progressText.textContent = "正在启动密码信令…";
        try {
          await startMqttHost();
        } catch (e) {
          openJoinFallback((e?.message || "密码信令启动失败") + "；请改用下方扫码/粘贴邀请");
          state.viaMqtt = false;
        }
      }
      if (els.progressText) els.progressText.textContent = "正在准备邀请…";
      await refreshJoinSlot();
      setProgress(100, "房间已创建");
      paintStatus();
    } catch (e) {
      state.roomId = "";
      state.isHost = false;
      state.hostId = "";
      state.members.clear();
      paintStatus();
      setError(e?.message || "创建房间失败");
      throw e;
    } finally {
      setJoinUiBusy(false);
      setTimeout(stopBusyProgress, 450);
    }
  }

  async function joinRoom(inviteText, opts = {}) {
    if (!webrtcSupported()) {
      setError("当前浏览器不支持 WebRTC");
      return;
    }
    if (!opts._skipBusy) {
      setJoinUiBusy(true);
      startBusyProgress(opts.viaMqtt ? "正在通过密码加入…" : "正在加入房间…", "join");
    }
    try {
      setError("");
      saveName();
      const inv = await parseInviteAsync(inviteText);
      cleanupRoom(false, { keepMqtt: !!opts.keepMqtt });
      if (opts.viaMqtt) state.viaMqtt = true;
      if (opts.mqttClient && opts.mqttTopic) {
        attachMqttGuest(opts.mqttClient, opts.mqttTopic);
      }
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

      if (els.progressText) els.progressText.textContent = "正在建立 WebRTC 连接…";
      const pc = createPeer();
      state.controlPc = pc;

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") paintStatus();
        if (pc.connectionState === "failed") setError("加入房间失败，请确认邀请码未过期并重试");
        if (pc.connectionState === "disconnected") setError("与房主连接中断，请重新加入");
      };

      if (inv.sdp && inv.mode === "legacy-offer") {
        pc.ondatachannel = (ev) => {
          state.controlDc = ev.channel;
          bindControlDc(state.controlDc, inv.hostId);
          whenDcOpen(state.controlDc, () => {
            sendHello(state.controlDc);
            paintStatus();
          });
        };
        await pc.setRemoteDescription({ type: "offer", sdp: inv.sdp });
        const ans = await pc.createAnswer();
        await pc.setLocalDescription(ans);
        await waitIce(pc);
        await publishJoinAnswer(pc.localDescription.sdp, inv);
      } else {
        const dc = pc.createDataChannel("control", { ordered: true });
        state.controlDc = dc;
        bindControlDc(dc, inv.hostId);
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitIce(pc);
        if (els.progressText) els.progressText.textContent = state.viaMqtt ? "正在自动配对…" : "正在等待房主确认…";
        startHostAnswerListen(inv.roomId, state.peerId);
        await publishJoinOffer(pc.localDescription.sdp, inv);
        await tryApplyHostAnswerFromHash();
      }
      if (!opts._skipBusy) setProgress(100, "已加入房间");
      paintStatus();
    } catch (e) {
      closeMemberControl();
      state.roomId = "";
      state.isHost = false;
      state.hostId = "";
      state.members.clear();
      paintStatus();
      throw new Error(e?.message || "无法建立连接，请让房主刷新邀请二维码");
    } finally {
      if (!opts._skipBusy) {
        setJoinUiBusy(false);
        setTimeout(stopBusyProgress, 450);
      }
    }
  }

  async function joinByPassword(pwdRaw) {
    if (!webrtcSupported()) {
      setError("当前浏览器不支持 WebRTC");
      return;
    }
    setJoinUiBusy(true);
    startBusyProgress("正在连接信令…", "join");
    try {
      const pwd = validateRoomPassword(pwdRaw);
      setError("");
      saveName();
      await ensureMqttLib();
      const slug = await hashRoomPassword(pwd);
      state.roomPassword = pwd;
      state.roomPasswordSlug = slug;
      if (els.progressText) els.progressText.textContent = "正在查找房间…";
      const { client, topic, hello } = await waitMqttHostHello(slug);
      const invText = `lanshare?r=${encodeURIComponent(hello.roomId)}&h=${encodeURIComponent(hello.hostId)}`;
      await joinRoom(invText, { keepMqtt: true, viaMqtt: true, mqttClient: client, mqttTopic: topic, _skipBusy: true });
      if (els.roomPwdJoin) els.roomPwdJoin.value = "";
      setProgress(100, "已加入房间");
      paintStatus();
    } catch (e) {
      openJoinFallback((e?.message || "密码加入失败") + "；请改用下方扫码/粘贴邀请");
      throw e;
    } finally {
      setJoinUiBusy(false);
      setTimeout(stopBusyProgress, 450);
    }
  }

  function readPasswordFromHash() {
    const full = String(location.hash || "").replace(/^#/, "");
    if (!full.startsWith("lanshare?")) return "";
    return new URLSearchParams(full.slice(full.indexOf("?") + 1)).get("p") || "";
  }

  function stashPendingPassword(pwd) {
    if (!pwd) return;
    try {
      sessionStorage.setItem(PENDING_PWD_KEY, pwd);
    } catch (_) {
      /* ignore */
    }
  }

  function takePendingPassword() {
    const fromHash = readPasswordFromHash();
    if (fromHash) {
      stashPendingPassword(fromHash);
      return fromHash;
    }
    try {
      return sessionStorage.getItem(PENDING_PWD_KEY) || "";
    } catch (_) {
      return "";
    }
  }

  function clearPendingPassword() {
    try {
      sessionStorage.removeItem(PENDING_PWD_KEY);
    } catch (_) {
      /* ignore */
    }
  }

  async function tryAutoJoinFromPassword() {
    if (state.roomId || state.autoJoinBusy) return;
    const pending = takePendingPassword();
    if (!pending) return;
    state.autoJoinBusy = true;
    try {
      setError("");
      await joinByPassword(pending);
      clearPendingPassword();
      history.replaceState(null, "", "#lanshare");
    } catch (e) {
      openJoinFallback((e?.message || "密码加入失败") + "；请改用下方扫码/粘贴邀请");
    } finally {
      state.autoJoinBusy = false;
    }
  }

  function uploadTransferKey(fileId, requesterId) {
    return `${state.peerId}:${fileId}:${requesterId}`;
  }

  function findUploadTransferPc(fileId, requesterId) {
    if (!fileId || !requesterId) return null;
    return state.transferPcs.get(uploadTransferKey(fileId, requesterId)) || null;
  }

  function releaseUploadTransfer(fileId, requesterId, pc) {
    const key = uploadTransferKey(fileId, requesterId);
    if (pc && state.transferPcs.get(key) !== pc) return;
    state.transferPcs.delete(key);
    clearSendSession(fileId, requesterId);
    try {
      pc?.close();
    } catch (_) {
      /* ignore */
    }
  }

  function handleRelay(payload) {
    if (!payload) return;
    if (payload.type === "webrtc-offer" && payload.to === state.peerId) {
      acceptFileOffer(payload.from, payload.fileId, payload.sdp);
    } else if (payload.type === "webrtc-answer" && payload.to === state.peerId) {
      const pc = findUploadTransferPc(payload.fileId, payload.from);
      if (pc) pc.setRemoteDescription({ type: "answer", sdp: payload.sdp }).catch(() => {});
    } else if (payload.type === "ice-candidate") {
      const pc =
        state.transferPcs.get(`${payload.from}:${payload.fileId}`) ||
        findUploadTransferPc(payload.fileId, payload.from);
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
      setFileLocalStatus(id, 0, "处理中…", "processing");
      paintFiles();
      const thumb = await makeImageThumb(file);
      if (thumb) meta.thumb = thumb;
      state.files.set(id, meta);
      clearFileLocalStatus(id);
      memberSend({ type: "file-add", file: meta });
      paintFiles();
    }
  }

  function removeFile(fileId) {
    const f = state.files.get(fileId);
    if (!f || f.ownerId !== state.peerId) return;
    state.files.delete(fileId);
    state.localFiles.delete(fileId);
    memberSend({ type: "file-remove", fileId });
    paintFiles();
  }

  function enqueueDownload(fileId) {
    if (state.downloadQueue.includes(fileId)) return;
    if (state.activeDownload?.fileId === fileId) return;
    state.downloadQueue.push(fileId);
    paintFiles();
  }

  function startDownloadRequest(fileId) {
    const f = state.files.get(fileId);
    if (!f || f.ownerId === state.peerId) return;
    setError("");
    setDownloadProgress(fileId, 0, "连接中…", "connecting");
    clearTimeout(downloadConnectTimer);
    downloadConnectTimer = window.setTimeout(() => {
      if (state.activeDownload?.fileId === fileId && state.activeDownload.phase === "connecting") {
        setError("连接上传者超时，请重试");
        finishDownloadProgress(fileId, false);
      }
    }, 120000);
    const msg = { type: "download-request", fileId, requesterId: state.peerId };
    if (state.isHost) sendToMember(f.ownerId, msg);
    else if (state.controlDc?.readyState === "open") state.controlDc.send(JSON.stringify(msg));
    else {
      setError("连接未就绪，请稍候再下载");
      finishDownloadProgress(fileId, false);
    }
  }

  function requestDownload(fileId) {
    const f = state.files.get(fileId);
    if (!f || f.ownerId === state.peerId) return;
    if (state.activeDownload?.fileId === fileId) {
      const p = state.activeDownload.phase;
      if (p === "connecting" || p === "downloading") return;
    }
    if (state.downloadQueue.includes(fileId)) return;
    if (isDownloadBusy()) {
      enqueueDownload(fileId);
      return;
    }
    startDownloadRequest(fileId);
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

  async function sendFileChunks(dc, file, onProgress) {
    let offset = 0;
    while (offset < file.size) {
      await waitDcDrain(dc);
      const buf = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
      dc.send(buf);
      offset += buf.byteLength;
      onProgress?.(offset, file.size);
    }
  }

  async function startUpload(fileId, requesterId) {
    const file = state.localFiles.get(fileId);
    const meta = state.files.get(fileId);
    if (!file || !meta) return;
    const key = uploadTransferKey(fileId, requesterId);
    if (state.transferPcs.has(key)) return;

    const pc = createPeer();
    state.transferPcs.set(key, pc);
    const dc = pc.createDataChannel("file", { ordered: true });
    dc.binaryType = "arraybuffer";

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        releaseUploadTransfer(fileId, requesterId, pc);
      }
    };

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
        bumpSendProgress(fileId, requesterId, 0, file.size);
        dc.send(JSON.stringify({ type: "meta", name: meta.name, size: meta.size, mime: meta.mime, fileId }));
        await sendFileChunks(dc, file, (sent, total) => bumpSendProgress(fileId, requesterId, sent, total));
        dc.send(JSON.stringify({ type: "done", fileId }));
      } catch (_) {
        dc.send(JSON.stringify({ type: "error", fileId, message: "发送中断" }));
      } finally {
        clearSendSession(fileId, requesterId);
        try {
          dc.close();
        } catch (_) {
          /* ignore */
        }
        releaseUploadTransfer(fileId, requesterId, pc);
      }
    };

    dc.onclose = () => {
      releaseUploadTransfer(fileId, requesterId, pc);
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
    if (state.transferring && state.activeDownload?.fileId && state.activeDownload.fileId !== fileId) return;
    state.transferring = true;
    setDownloadProgress(fileId, 0, "连接中…", "connecting");
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
              setDownloadProgress(fileId, 0, total ? `0 / ${fmtSize(total)}` : "下载中…", "downloading");
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
              setDownloadProgress(fileId, (got / total) * 100, `${fmtSize(got)} / ${fmtSize(total)}`, "downloading");
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
      finishDownloadProgress(fileId, true);
      if (isIOS()) setError("");
    } catch (e) {
      setError(e.message || "下载失败");
      finishDownloadProgress(fileId, false);
    } finally {
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
    const myName = state.peerName || memberLabel(state.peerId);
    removeMemberFiles(state.peerId, { notify: true });
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
      memberSend({ type: "member-left", memberId: state.peerId, name: myName });
    }
    cleanupRoom(false);
  }

  /** 直接关页/刷新时尽力通知对端（浏览器不保证一定送达） */
  function abandonRoomOnPageHide() {
    if (!state.roomId) return;
    const myName = state.peerName || memberLabel(state.peerId);
    try {
      removeMemberFiles(state.peerId, { notify: true });
      if (state.isHost) {
        const others = [...state.members.values()].filter((m) => m.id !== state.peerId);
        if (others.length) {
          broadcast({ type: "room-closed", reason: "host-offline" });
        }
        stopMqttSignaling();
      } else if (state.controlDc?.readyState === "open") {
        state.controlDc.send(JSON.stringify({ type: "member-left", memberId: state.peerId, name: myName }));
      }
    } catch (_) {
      /* 关页瞬间可能来不及发送 */
    }
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

  function cleanupRoom(keepError, opts = {}) {
    if (!opts.keepMqtt) stopMqttSignaling();
    stopBusyProgress();
    clearTimeout(infoTimer);
    revokeFilePreviewUrls();
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
    state.fileLocalStatus.clear();
    state.sendSessions.clear();
    clearDownloadProgress();
    state.pageHiddenWarn = false;
    state.autoJoinBusy = false;
    state.controlLinked = false;
    state.pendingOutbound = [];
    state.roomPassword = "";
    state.roomPasswordSlug = "";
    state.viaMqtt = false;
    stopSignalRelayListen();
    if (els.inviteText) els.inviteText.value = "";
    if (els.inviteQr) els.inviteQr.innerHTML = "";
    if (els.inviteQrApp) els.inviteQrApp.innerHTML = "";
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

  async function confirmHostOfferPaste() {
    const text = els.hostOfferPaste?.value || "";
    if (!normalizeInviteText(text)) {
      setError("请先粘贴成员发来的连接码链接或文本");
      return;
    }
    try {
      await applyOfferFromScanData(text);
      if (els.hostOfferPaste) els.hostOfferPaste.value = "";
    } catch (e) {
      setError(e.message || "连接码无效");
    }
  }

  function getJsQR() {
    const j = typeof jsQR !== "undefined" ? jsQR : globalThis.jsQR;
    if (typeof j === "function") return j;
    if (j && typeof j.default === "function") return j.default;
    return null;
  }

  function decodeQrFromImageData(imageData, w, h) {
    const fn = getJsQR();
    if (!fn) return null;
    return fn(imageData.data, w, h, { inversionAttempts: "attemptBoth" });
  }

  function decodeQrFromSource(source, sw, sh, sx = 0, sy = 0) {
    if (!sw || !sh) return null;
    if (!scanCanvas) scanCanvas = document.createElement("canvas");
    const canvas = scanCanvas;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    const maxSide = 1000;
    const base = Math.min(1, maxSide / Math.max(sw, sh));
    const scales = [1, 0.75, 0.55, 1.35];
    for (const scale of scales) {
      const w = Math.max(1, Math.round(sw * base * scale));
      const h = Math.max(1, Math.round(sh * base * scale));
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(source, sx, sy, sw, sh, 0, 0, w, h);
      const code = decodeQrFromImageData(ctx.getImageData(0, 0, w, h), w, h);
      if (code?.data) return code.data;
    }
    const cw = Math.round(sw * 0.62);
    const ch = Math.round(sh * 0.62);
    const cx = Math.round((sw - cw) / 2);
    const cy = Math.round((sh - ch) / 2);
    for (const scale of [1, 0.8, 1.25]) {
      const w = Math.max(1, Math.round(cw * base * scale));
      const h = Math.max(1, Math.round(ch * base * scale));
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(source, sx + cx, sy + cy, cw, ch, 0, 0, w, h);
      const code = decodeQrFromImageData(ctx.getImageData(0, 0, w, h), w, h);
      if (code?.data) return code.data;
    }
    return null;
  }

  function normalizeScanPayload(data) {
    let s = normalizeInviteText(data);
    if (!s) return "";
    if (/^https?:\/\//i.test(s)) {
      try {
        const u = new URL(s);
        const frag = u.hash.replace(/^#/, "").trim();
        if (frag.includes("lanshare")) return frag;
        const q = u.search.replace(/^\?/, "");
        if (q && (/(^|&)(r|j|o|a)=/.test(q) || q.includes("lanshare"))) return `lanshare?${q}`;
      } catch (_) {
        /* ignore */
      }
    }
    return s;
  }

  function setScanHint(msg) {
    if (!els.scanHint) return;
    els.scanHint.hidden = !msg;
    els.scanHint.textContent = msg || "";
  }

  function looksLikeLansharePayload(data) {
    const s = normalizeScanPayload(data);
    if (!s) return false;
    if (isOfferScanData(s) || isAnswerScanData(s) || isInviteScanData(s)) return true;
    return /lanshare/i.test(s) || s.startsWith(PROTO) || /^[zr][A-Za-z0-9_-]{8,}$/.test(s);
  }

  function handleDecodedScan(raw) {
    const data = normalizeScanPayload(raw);
    if (!data || !looksLikeLansharePayload(data)) {
      setError("识别到二维码，但不是互传邀请/连接码");
      return;
    }
    stopScan();
    setScanHint("");
    if (state.isHost && isOfferScanData(data)) {
      applyOfferFromScanData(data).catch((err) => setError(err.message));
      return;
    }
    if (state.isHost && isAnswerScanData(data)) {
      applyAnswerFromScanData(data).catch((err) => setError(err.message));
      return;
    }
    if (!state.isHost && isAnswerScanData(data)) {
      applyHostAnswer(data).catch((err) => setError(err.message));
      return;
    }
    joinFromScanData(data).catch((err) => setError(err.message));
  }

  function decodeQrFromImage(img) {
    if (!getJsQR()) throw new Error("扫码库未加载");
    const w = img.naturalWidth || img.videoWidth || img.width;
    const h = img.naturalHeight || img.videoHeight || img.height;
    if (!w || !h) throw new Error("无法读取图片尺寸");
    const data = decodeQrFromSource(img, w, h);
    if (!data) throw new Error("未识别到二维码，请换更清晰的图片或对准一些");
    return data;
  }

  async function joinFromScanData(data) {
    if (isOfferScanData(data)) {
      await applyOfferFromScanData(data);
      return;
    }
    if (isAnswerScanData(data)) {
      if (state.isHost) {
        await applyAnswerFromScanData(data);
      } else {
        await applyHostAnswer(data);
      }
      return;
    }
    if (!isInviteScanData(data)) throw new Error("不是有效的互传邀请");
    await joinRoom(data);
  }

  async function tryAutoJoinFromHash() {
    if (state.roomId || state.autoJoinBusy) return;
    const pending = takePendingJoinToken();
    if (!pending) return;
    state.autoJoinBusy = true;
    try {
      setError("");
      const joinText = pending.startsWith("lanshare?") ? pending : `lanshare?j=${pending}`;
      await joinRoom(joinText);
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
    if (!getJsQR()) {
      setError("扫码库未加载");
      return;
    }
    stopScan();
    setError("");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前环境无法打开摄像头，请用「图片识别邀请码」或手动粘贴");
      return;
    }
    try {
      const videoOpts = isIOS()
        ? { facingMode: { ideal: "environment" } }
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
      setScanHint("对准二维码，保持稳定…");
      const tick = () => {
        if (!camStream || !els.camVideo) return;
        const v = els.camVideo;
        if (v.readyState >= v.HAVE_CURRENT_DATA && v.videoWidth > 0 && v.videoHeight > 0) {
          try {
            const data = decodeQrFromSource(v, v.videoWidth, v.videoHeight);
            if (data) {
              handleDecodedScan(data);
              return;
            }
          } catch (_) {
            /* ignore frame errors */
          }
        }
        scanTimer = window.setTimeout(tick, 140);
      };
      scanTimer = window.setTimeout(tick, 140);
    } catch (e) {
      setScanHint("");
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
      handleDecodedScan(data);
    } catch (e) {
      setError(e.message || "识别失败");
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function stopScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = null;
    camStream?.getTracks().forEach((t) => t.stop());
    camStream = null;
    if (els.camVideo) {
      els.camVideo.srcObject = null;
      els.camVideo.hidden = true;
    }
    if (els.camWrap) els.camWrap.hidden = true;
    if (els.camStop) els.camStop.hidden = true;
    setScanHint("");
  }

  async function startAnswerScan() {
    state.answerScanMode = true;
    await startScan();
  }

  els.createBtn?.addEventListener("click", () => createRoom().catch((e) => setError(e.message)));
  els.joinPwdBtn?.addEventListener("click", () => {
    const pwd = els.roomPwdJoin?.value || "";
    joinByPassword(pwd).catch((e) => setError(e.message || "密码加入失败"));
  });
  els.roomPwdJoin?.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      ev.preventDefault();
      els.joinPwdBtn?.click();
    }
  });
  els.pasteJoinBtn?.addEventListener("click", () => pasteJoin());
  els.joinConfirmBtn?.addEventListener("click", () => confirmPasteJoin().catch((e) => setError(e.message)));
  els.copyInviteBtn?.addEventListener("click", () => copyInvite());
  els.scanAnswerBtn?.addEventListener("click", () => startAnswerScan());
  els.hostOfferConfirmBtn?.addEventListener("click", () => confirmHostOfferPaste().catch((e) => setError(e.message)));
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

  window.addEventListener("pagehide", (ev) => {
    if (ev.persisted) return;
    abandonRoomOnPageHide();
    stopScan();
  });

  loadName();
  paintPlatformHint();
  disableIfUnsupported();
  paintStatus();
  tryApplyJoinOfferFromHash().catch(() => {});
  tryApplyJoinAnswerFromHash().catch(() => {});
  tryApplyHostAnswerFromHash().catch(() => {});
  tryAutoJoinFromHash().catch(() => {});
  tryAutoJoinFromPassword().catch(() => {});

  window.LanShareSelfTest = {
    webrtcSupported,
    isIOS,
    isAndroid,
    isMobileClient,
    parseInviteAsync,
    parseJoinAnswerAsync,
    parseJoinOfferAsync,
    buildInviteUrl,
    buildInviteToken,
    buildJoinOfferToken,
    inviteQrTextShort,
    inviteQrText,
    joinOfferQrText,
    joinAnswerQrText,
    packInvitePayload,
    unpackInvitePayload,
    inviteLinkBase,
    isInviteScanData,
    isOfferScanData,
    isAnswerScanData,
    readJoinTokenFromHash,
    readAnswerTokenFromHash,
    readPasswordFromHash,
    takePendingJoinToken,
    normalizeRoomPassword,
    hashRoomPassword,
    validateRoomPassword,
    getRoomId: () => state.roomId,
  };

  window.addEventListener("devtools:route", () => {
    const head = location.hash.replace("#", "").split(/[/?]/)[0];
    if (head !== "lanshare") stopScan();
    else {
      preloadPanel().finally(() => {
        tryApplyJoinOfferFromHash().catch(() => {});
        tryApplyJoinAnswerFromHash().catch(() => {});
        tryApplyHostAnswerFromHash().catch(() => {});
        tryAutoJoinFromHash().catch(() => {});
        tryAutoJoinFromPassword().catch(() => {});
      });
    }
  });

  preloadPanel().catch(() => {});
})();
