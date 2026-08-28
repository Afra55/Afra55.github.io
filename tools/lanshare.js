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
  };

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
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    let bin = "";
    bytes.forEach((b) => {
      bin += String.fromCharCode(b);
    });
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  function b64dec(str) {
    const pad = str.length % 4 ? "=".repeat(4 - (str.length % 4)) : "";
    const b64 = str.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
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
    if (els.statusText) {
      els.statusText.textContent = inRoom
        ? `${state.members.size} 人在线 · 文件从上传者直传${statusExtra}`
        : "创建或加入房间；文件不经房主中转。";
    }
    if (els.inviteArea) els.inviteArea.hidden = !inRoom || !state.isHost;
    if (els.joinArea) els.joinArea.hidden = inRoom;
    if (els.leaveBtn) els.leaveBtn.hidden = !inRoom;
    if (els.dissolveBtn) els.dissolveBtn.hidden = !inRoom || !state.isHost;
    if (els.pickBtn) els.pickBtn.disabled = !inRoom;
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
    return `${PROTO}|${state.roomId}|${b64enc({ hostId: state.peerId, hostName: state.peerName, sdp })}`;
  }

  function parseInvite(text) {
    const raw = normalizeInviteText(text);
    if (!raw.startsWith(`${PROTO}|`)) throw new Error("无效的邀请码");
    const i = raw.indexOf("|", PROTO.length + 1);
    if (i < 0) throw new Error("邀请码格式错误");
    const roomId = raw.slice(PROTO.length + 1, i);
    const data = b64dec(raw.slice(i + 1));
    if (!data.sdp) throw new Error("邀请码缺少连接信息");
    return { roomId, hostId: data.hostId, hostName: data.hostName, sdp: data.sdp };
  }

  function renderQrBox(el, text, level) {
    el.innerHTML = "";
    // eslint-disable-next-line no-new
    new QRCode(el, { text, width: 168, height: 168, correctLevel: level });
  }

  function renderInviteQr(payload) {
    if (!els.inviteQr) return;
    els.inviteQr.innerHTML = "";
    if (typeof QRCode === "undefined") {
      els.inviteQr.textContent = "二维码库未加载，请复制下方邀请文本";
      return;
    }
    const tries = [
      QRCode.CorrectLevel.L,
      QRCode.CorrectLevel.M,
    ];
    for (const level of tries) {
      try {
        renderQrBox(els.inviteQr, payload, level);
        return;
      } catch (err) {
        if (!/Too long|overflow|code length overflow/i.test(String(err.message || err))) break;
      }
    }
    els.inviteQr.innerHTML = '<p class="hint tight">邀请文本较长，二维码无法生成，请复制下方文本分享（或使用电脑加入）。</p>';
  }

  function updateInviteDisplay(payload) {
    if (els.inviteText) els.inviteText.value = payload;
    renderInviteQr(payload);
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
    paintStatus();
  }

  function sendToMember(memberId, msg) {
    const link = state.memberLinks.get(memberId);
    if (link?.dc?.readyState === "open") link.dc.send(JSON.stringify(msg));
  }

  function broadcast(msg) {
    if (state.isHost) {
      state.memberLinks.forEach((link) => {
        if (link.dc?.readyState === "open") link.dc.send(JSON.stringify(msg));
      });
    } else if (state.controlDc?.readyState === "open") {
      state.controlDc.send(JSON.stringify(msg));
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
        if (msg.memberId) state.members.delete(msg.memberId);
        paintStatus();
        break;
      case "file-add":
        if (msg.file) state.files.set(msg.file.id, msg.file);
        paintFiles();
        break;
      case "file-remove":
        if (msg.fileId) {
          state.files.delete(msg.fileId);
          state.localFiles.delete(msg.fileId);
        }
        paintFiles();
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
    updateInviteDisplay(makeInvitePayload(pc.localDescription.sdp));
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
    const inv = parseInvite(inviteText);
    cleanupRoom(false);
    state.peerId = uid();
    state.peerName = peerName();
    state.roomId = inv.roomId;
    state.hostId = inv.hostId;
    state.isHost = false;
    state.joinedAt = Date.now();
    state.members.set(state.peerId, { id: state.peerId, name: state.peerName, joinedAt: state.joinedAt });

    const pc = createPeer();
    state.controlPc = pc;

    pc.ondatachannel = (ev) => {
      state.controlDc = ev.channel;
      bindControlDc(state.controlDc, inv.hostId);
      whenDcOpen(state.controlDc, () => sendHello(state.controlDc));
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") setError("加入房间失败，请确认邀请码未过期并重试");
    };

    await pc.setRemoteDescription({ type: "offer", sdp: inv.sdp });
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    await waitIce(pc);
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
    if (!state.roomId) return;
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
      broadcast({ type: "file-add", file: meta });
    }
    paintFiles();
  }

  function removeFile(fileId) {
    const f = state.files.get(fileId);
    if (!f || f.ownerId !== state.peerId) return;
    state.files.delete(fileId);
    state.localFiles.delete(fileId);
    broadcast({ type: "file-remove", fileId });
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
      broadcast({ type: "member-left", memberId: state.peerId });
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
    if (els.inviteText) els.inviteText.value = "";
    if (els.inviteQr) els.inviteQr.innerHTML = "";
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
    if (!normalizeInviteText(data).startsWith(PROTO)) throw new Error("不是有效的互传邀请码");
    await joinRoom(data);
  }

  async function startScan() {
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
            if (code?.data?.startsWith(PROTO)) {
              stopScan();
              joinFromScanData(code.data).catch((err) => setError(err.message));
              return;
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

  els.createBtn?.addEventListener("click", () => createRoom().catch((e) => setError(e.message)));
  els.pasteJoinBtn?.addEventListener("click", () => pasteJoin());
  els.joinConfirmBtn?.addEventListener("click", () => confirmPasteJoin().catch((e) => setError(e.message)));
  els.copyInviteBtn?.addEventListener("click", () => copyInvite());
  els.scanBtn?.addEventListener("click", () => startScan());
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

  window.LanShareSelfTest = {
    webrtcSupported,
    isIOS,
    isAndroid,
    isMobileClient,
    parseInvite,
    makeInvitePayload,
  };

  window.addEventListener("devtools:route", () => {
    if (location.hash.replace("#", "").split("/")[0] !== "lanshare") stopScan();
  });
})();
