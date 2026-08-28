(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const panel = $("#lanshare");
  if (!panel) return;

  const PROTO = "devtools-lanshare:v1";
  const STUN = [{ urls: "stun:stun.l.google.com:19302" }];
  const CHUNK_SIZE = 64 * 1024;
  const NAME_KEY = "devtools-lanshare-name";

  const els = {
    statusDot: $("#ls-dot"),
    statusTitle: $("#ls-status-title"),
    statusText: $("#ls-status-text"),
    nameInput: $("#ls-name"),
    createBtn: $("#ls-create"),
    joinArea: $("#ls-join-area"),
    inviteArea: $("#ls-invite-area"),
    inviteText: $("#ls-invite-text"),
    inviteQr: $("#ls-invite-qr"),
    scanBtn: $("#ls-scan"),
    pasteJoinBtn: $("#ls-paste-join"),
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

  /** @type {{ peerId: string, peerName: string, roomId: string, isHost: boolean, hostId: string, joinedAt: number, members: Map<string, any>, files: Map<string, any>, localFiles: Map<string, File>, memberLinks: Map<string, { pc: RTCPeerConnection, dc: RTCDataChannel|null }>, transferPcs: Map<string, RTCPeerConnection>, transferring: boolean, controlPc: RTCPeerConnection|null, controlDc: RTCDataChannel|null, pendingJoin: { pc: RTCPeerConnection, dc: RTCDataChannel|null }|null }} */
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
  };

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
    if (els.statusText) {
      els.statusText.textContent = inRoom
        ? `${state.members.size} 人在线 · 协调者只同步列表与牵线，文件从上传者直传`
        : "创建或加入房间；文件不经房主中转，下载时与上传者 WebRTC 直连。";
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
    return new RTCPeerConnection({ iceServers: STUN });
  }

  async function waitIce(pc) {
    if (pc.iceGatheringState === "complete") return;
    await new Promise((resolve) => {
      const to = setTimeout(resolve, 3000);
      pc.addEventListener("icegatheringstatechange", () => {
        if (pc.iceGatheringState === "complete") {
          clearTimeout(to);
          resolve(null);
        }
      });
    });
  }

  function makeInvitePayload(sdp) {
    return `${PROTO}|${state.roomId}|${b64enc({ hostId: state.peerId, hostName: state.peerName, sdp })}`;
  }

  function parseInvite(text) {
    const raw = String(text || "").trim();
    if (!raw.startsWith(`${PROTO}|`)) throw new Error("无效的邀请码");
    const i = raw.indexOf("|", PROTO.length + 1);
    if (i < 0) throw new Error("邀请码格式错误");
    const roomId = raw.slice(PROTO.length + 1, i);
    const data = b64dec(raw.slice(i + 1));
    if (!data.sdp) throw new Error("邀请码缺少连接信息");
    return { roomId, hostId: data.hostId, hostName: data.hostName, sdp: data.sdp };
  }

  function renderInviteQr(payload) {
    if (!els.inviteQr) return;
    els.inviteQr.innerHTML = "";
    if (typeof QRCode === "undefined") {
      els.inviteQr.textContent = "二维码库未加载";
      return;
    }
    try {
      // eslint-disable-next-line no-new
      new QRCode(els.inviteQr, { text: payload, width: 168, height: 168, correctLevel: QRCode.CorrectLevel.L });
    } catch (_) {
      els.inviteQr.innerHTML = '<p class="hint tight">邀请文本较长，请复制下方文本分享</p>';
    }
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

  function onControlMessage(msg, remoteId) {
    switch (msg.type) {
      case "hello":
        if (!state.isHost) return;
        {
          const member = { id: msg.from, name: msg.name || "成员", joinedAt: msg.joinedAt || Date.now() };
          state.members.set(member.id, member);
          sendToMember(remoteId, {
            type: "welcome",
            ...exportRoomState(),
          });
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
          handleRelay(msg.payload, msg.from);
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
  }

  async function refreshJoinSlot() {
    if (!state.isHost) return;
    state.pendingJoin?.pc?.close();
    const pc = createPeer();
    const dc = pc.createDataChannel("control", { ordered: true });
    let settled = false;
    state.pendingJoin = { pc, dc };

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

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitIce(pc);
    updateInviteDisplay(makeInvitePayload(pc.localDescription.sdp));
  }

  async function createRoom() {
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
    pc.onicecandidate = () => {};

    pc.ondatachannel = (ev) => {
      state.controlDc = ev.channel;
      bindControlDc(state.controlDc, inv.hostId);
      state.controlDc.onopen = () => {
        state.controlDc.send(
          JSON.stringify({
            type: "hello",
            from: state.peerId,
            name: state.peerName,
            joinedAt: state.joinedAt,
          })
        );
      };
    };

    await pc.setRemoteDescription({ type: "offer", sdp: inv.sdp });
    const ans = await pc.createAnswer();
    await pc.setLocalDescription(ans);
    await waitIce(pc);
    paintStatus();
  }

  function handleRelay(payload, from) {
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
      state.controlDc.onopen = () => paintStatus();
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
      dc.send(JSON.stringify({ type: "meta", name: meta.name, size: meta.size, mime: meta.mime, fileId }));
      let offset = 0;
      while (offset < file.size) {
        const buf = await file.slice(offset, offset + CHUNK_SIZE).arrayBuffer();
        dc.send(buf);
        offset += buf.byteLength;
      }
      dc.send(JSON.stringify({ type: "done", fileId }));
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
      const timer = setTimeout(() => reject(new Error("连接超时")), 90000);

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
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = meta?.name || "download";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      setProgress(null);
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
    /** @type {Map<string, { pc: RTCPeerConnection, dc: RTCDataChannel|null }>} */
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
      } else {
        sendToMember(m.id, { type: "relay", payload });
      }
    }
    await new Promise((r) => setTimeout(r, 1500));
    closeMemberControl();
    closeHostControl(true);
    handshakes.forEach((link, id) => state.memberLinks.set(id, link));
    await refreshJoinSlot();
    state.memberLinks.forEach((link, id) => {
      if (link.dc?.readyState === "open") {
        sendToMember(id, { type: "host-transfer-done", hostId: state.peerId });
      }
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
        await new Promise((r) => setTimeout(r, 1200));
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
    if (els.inviteText) els.inviteText.value = "";
    if (els.inviteQr) els.inviteQr.innerHTML = "";
    setProgress(null);
    if (!keepError) setError("");
    paintStatus();
  }

  async function pasteJoin() {
    try {
      const text = await navigator.clipboard.readText();
      if (!text.trim()) throw new Error("剪贴板为空");
      await joinRoom(text.trim());
    } catch (e) {
      setError(e.message || "无法从剪贴板加入");
    }
  }

  async function startScan() {
    if (typeof jsQR === "undefined") {
      setError("扫码库未加载");
      return;
    }
    stopScan();
    try {
      camStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      if (els.camVideo) {
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
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
          if (code?.data?.startsWith(PROTO)) {
            stopScan();
            joinRoom(code.data).catch((err) => setError(err.message));
            return;
          }
        }
        scanRaf = requestAnimationFrame(tick);
      };
      scanRaf = requestAnimationFrame(tick);
    } catch (_) {
      setError("无法打开摄像头，请粘贴邀请文本加入");
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
  els.scanBtn?.addEventListener("click", () => startScan());
  els.camStop?.addEventListener("click", () => stopScan());
  els.leaveBtn?.addEventListener("click", () => leaveRoom());
  els.dissolveBtn?.addEventListener("click", () => dissolveRoom());
  els.pickBtn?.addEventListener("click", () => els.fileInput?.click());
  els.fileInput?.addEventListener("change", () => {
    if (els.fileInput?.files?.length) onFilesPicked(els.fileInput.files);
    els.fileInput.value = "";
  });
  els.nameInput?.addEventListener("change", saveName);

  loadName();
  paintStatus();

  window.addEventListener("devtools:route", () => {
    if (location.hash.replace("#", "").split("/")[0] !== "lanshare") stopScan();
  });
})();
