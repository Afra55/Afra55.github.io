(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  const panel = $("#lanboard");
  if (!panel) return;

  const PROTO = "devtools-lanboard:v1";
  const LOBBY_SLUG = "devtools-lanboard";
  const STUN = [
    { urls: "stun:stun.miwifi.com:3478" },
    { urls: "stun:stun.chat.bilibili.com:3478" },
    { urls: "stun:stun.hitv.com:3478" },
    { urls: "stun:stun.l.google.com:19302" },
  ];
  const CHUNK_SIZE = 32 * 1024;
  const DC_BUFFER_LIMIT = 512 * 1024;
  const NAME_KEY = "devtools-lanboard-name";
  const PEER_ID_KEY = "devtools-lanboard-peer-id";
  const IDB_NAME = "devtools-lanboard";
  const IDB_STORE = "kv";
  const IDB_ITEMS_KEY = "items-v1";
  const MQTT_BROKERS = [
    "wss://broker-cn.emqx.io:8084/mqtt",
    "wss://broker.emqx.io:8084/mqtt",
    "wss://broker.hivemq.com:8884/mqtt",
    "wss://test.mosquitto.org:8081/mqtt",
  ];
  const MQTT_TOPIC = `devtools/lanboard/v1/${LOBBY_SLUG}`;
  const MQTT_MSG_TTL_MS = 120000;
  const PRESENCE_MS = 4000;
  const PEER_STALE_MS = 12000;
  const TEXT_MQTT_MAX = 1800;
  const THUMB_TIMEOUT_MS = 2500;
  const MQTT_THUMB_MAX = 12000;
  const SOURCE_GONE = "源设备已离开，仅可预览";

  const els = {
    statusDot: $("#lb-dot"),
    statusTitle: $("#lb-status-title"),
    statusText: $("#lb-status-text"),
    errorEl: $("#lb-error"),
    infoEl: $("#lb-info"),
    nameInput: $("#lb-name"),
    textInput: $("#lb-text"),
    sendBtn: $("#lb-send"),
    fileInput: $("#lb-file-input"),
    anyFileInput: $("#lb-any-file-input"),
    fileHint: $("#lb-file-hint"),
    emptySteps: $("#lb-empty-steps"),
    compose: panel.querySelector(".lb-compose"),
    feed: $("#lb-feed"),
    members: $("#lb-members"),
    memberCount: $("#lb-member-count"),
    bridgeShell: $("#lb-bridge-shell"),
    bridgeNote: $("#lb-bridge-note"),
    bridgeQr: $("#lb-bridge-qr"),
  };

  /** @type {File[]} */
  let pendingFiles = [];
  let sending = false;

  const state = {
    peerId: "",
    peerName: "",
    mqttClient: null,
    mqttSeen: null,
    presenceTimer: null,
    pruneTimer: null,
    peers: new Map(),
    /** @type {Map<string, { pc: RTCPeerConnection, dc: RTCDataChannel|null, polite: boolean, makingOffer: boolean }>} */
    links: new Map(),
    /** @type {Map<string, object>} */
    items: new Map(),
    /** @type {Map<string, Blob|File>} */
    localBlobs: new Map(),
    bridgeBase: "http://127.0.0.1:17888",
    bridgeToken: "devtools-bridge",
    bridgeOk: false,
    mqttOk: false,
    started: false,
    /** @type {BroadcastChannel|null} */
    bc: null,
  };

  function uid(n = 10) {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return [...a].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, n);
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function fmtSize(n) {
    const x = Number(n) || 0;
    if (x < 1024) return `${x} B`;
    if (x < 1024 * 1024) return `${(x / 1024).toFixed(1)} KB`;
    return `${(x / (1024 * 1024)).toFixed(1)} MB`;
  }

  function fileKindOf(file) {
    const mime = String(file?.type || "").toLowerCase();
    if (mime.startsWith("video/")) return "video";
    if (mime.startsWith("image/")) return "image";
    // 部分手机选视频不带 MIME，按扩展名兜底，避免当普通文件且跳过缩略图路径
    const name = String(file?.name || "").toLowerCase();
    if (/\.(mp4|webm|mov|m4v|mkv|avi|3gp)$/.test(name)) return "video";
    if (/\.(png|jpe?g|gif|webp|bmp|heic|heif)$/.test(name)) return "image";
    return "file";
  }

  function kindLabel(kind) {
    if (kind === "video") return "视频";
    if (kind === "image") return "图片";
    return "文件";
  }

  function notifyToast(msg) {
    const text = String(msg || "").trim();
    if (!text) return;
    let el = document.getElementById("lb-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "lb-toast";
      el.setAttribute("role", "status");
      el.style.cssText =
        "position:fixed;left:50%;bottom:1.4rem;transform:translateX(-50%);z-index:9999;background:rgba(20,20,20,.88);color:#fff;padding:.55rem .9rem;border-radius:8px;font-size:.9rem;max-width:90vw;pointer-events:none";
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.hidden = false;
    clearTimeout(notifyToast._t);
    notifyToast._t = setTimeout(() => {
      el.hidden = true;
    }, 2600);
  }

  function setError(msg) {
    if (!els.errorEl) return;
    const t = String(msg || "").trim();
    els.errorEl.hidden = !t;
    els.errorEl.textContent = t;
  }

  function setInfo(msg) {
    if (!els.infoEl) return;
    const t = String(msg || "").trim();
    els.infoEl.hidden = !t;
    els.infoEl.textContent = t;
  }

  function webrtcSupported() {
    return typeof RTCPeerConnection === "function";
  }

  function loadName() {
    try {
      return localStorage.getItem(NAME_KEY) || "";
    } catch {
      return "";
    }
  }

  function saveName(name) {
    try {
      localStorage.setItem(NAME_KEY, name);
    } catch {
      /* ignore */
    }
  }

  function loadPeerId() {
    try {
      const id = String(sessionStorage.getItem(PEER_ID_KEY) || "").trim();
      return /^[a-f0-9]{8,32}$/i.test(id) ? id : "";
    } catch {
      return "";
    }
  }

  function savePeerId(id) {
    try {
      if (id) sessionStorage.setItem(PEER_ID_KEY, id);
    } catch {
      /* ignore */
    }
  }

  function publishBye() {
    if (!state.peerId) return;
    publishMqtt({ type: "bye", peerId: state.peerId });
  }

  function openIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IDB 打开失败"));
    });
  }

  async function idbGet(key) {
    try {
      const db = await openIdb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readonly");
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch {
      return null;
    }
  }

  async function idbSet(key, value) {
    try {
      const db = await openIdb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, "readwrite");
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch {
      /* ignore */
    }
  }

  async function persistItems() {
    const list = [...state.items.values()]
      .filter((it) => it.kind === "text")
      .map((it) => ({
        id: it.id,
        kind: "text",
        text: it.text || "",
        ownerId: it.ownerId || "",
        ownerName: it.ownerName || "",
        addedAt: it.addedAt || 0,
      }));
    await idbSet(IDB_ITEMS_KEY, { v: 1, items: list, savedAt: Date.now() });
  }

  async function restoreLocalItems() {
    const data = await idbGet(IDB_ITEMS_KEY);
    const items = data?.items;
    if (!Array.isArray(items)) return;
    for (const it of items) {
      if (!it?.id || it.kind !== "text") continue;
      if (!state.items.has(it.id)) upsertItem(it, { paint: false, persist: false, relay: false });
    }
  }

  function peerLabel(id) {
    if (id === state.peerId) return "我";
    const p = state.peers.get(id);
    return p?.name || String(id || "").slice(0, 8);
  }

  function isOwnerOnline(ownerId) {
    if (!ownerId) return false;
    if (ownerId === state.peerId) return true;
    const p = state.peers.get(ownerId);
    return !!(p && Date.now() - (p.lastSeen || 0) < PEER_STALE_MS);
  }

  function mediaDownloadable(it) {
    if (!it || it.kind === "text") return false;
    if (state.localBlobs.has(it.id)) return true;
    if (it.onBridge && state.bridgeOk) return true;
    return isOwnerOnline(it.ownerId);
  }

  function upsertItem(raw, { paint = true, persist = true, relay = false } = {}) {
    if (!raw?.id) return;
    const prev = state.items.get(raw.id) || {};
    const next = {
      ...prev,
      ...raw,
      id: String(raw.id),
      kind: raw.kind || prev.kind || "text",
      addedAt: Number(raw.addedAt || prev.addedAt || Date.now()),
    };
    state.items.set(next.id, next);
    if (persist && next.kind === "text") persistItems();
    if (paint) paintFeed();
    if (relay) broadcastItem(next);
  }

  function paintStatus() {
    const online = [...state.peers.values()].filter((p) => Date.now() - (p.lastSeen || 0) < PEER_STALE_MS);
    const n = online.length + 1;
    const mqtt = state.mqttOk;
    const links = [...state.links.values()].filter((l) => l.dc?.readyState === "open").length;
    if (els.statusDot) {
      els.statusDot.classList.toggle("ok", mqtt);
      els.statusDot.classList.toggle("warn", !mqtt);
    }
    if (els.statusTitle) {
      els.statusTitle.textContent = mqtt ? `大厅在场 · ${n} 台` : "正在连接大厅…";
    }
    if (els.statusText) {
      const parts = [];
      parts.push(mqtt ? "信令已连" : "连信令中");
      parts.push(`直连 ${links}`);
      parts.push(state.bridgeOk ? "桥已连（文字可落桥）" : "无桥（纯在线同步）");
      els.statusText.textContent = parts.join(" · ");
    }
    if (els.memberCount) els.memberCount.textContent = String(n);
    if (els.members) {
      const rows = [{ id: state.peerId, name: state.peerName || "我", me: true }, ...online];
      els.members.innerHTML = rows
        .map(
          (p) =>
            `<li>${escapeHtml(p.name || peerLabel(p.id))}${p.me ? "（本机）" : ""}${
              state.links.get(p.id)?.dc?.readyState === "open" ? " · 直连" : ""
            }</li>`
        )
        .join("");
    }
    if (els.bridgeNote) {
      els.bridgeNote.textContent = state.bridgeOk
        ? "桥在线：文字快照会写入本机桥；媒体也可暂存到桥。"
        : "未连上桥：文字靠在线设备互相同步；全员退出后再进可能为空。";
    }
  }

  function paintFeed() {
    if (!els.feed) return;
    const list = [...state.items.values()].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
    if (els.emptySteps) els.emptySteps.hidden = list.length > 0;
    if (!list.length) {
      els.feed.innerHTML =
        '<p class="hint tight lb-empty">大厅还没有内容。发一条文字，或直接选文件（选完即发）。</p>';
      return;
    }
    els.feed.innerHTML = list
      .map((it) => {
        if (it.kind === "text") {
          return `<div class="lb-item" data-id="${escapeHtml(it.id)}">
            <div class="lb-item-main">
              <p class="lb-item-text">${escapeHtml(it.text || "")}</p>
              <p class="hint tight lb-item-meta mono">${escapeHtml(peerLabel(it.ownerId))} · ${new Date(it.addedAt || 0).toLocaleTimeString()}</p>
            </div>
            <div class="lb-item-actions">
              <button type="button" class="secondary-btn lb-copy" data-id="${escapeHtml(it.id)}">复制</button>
            </div>
          </div>`;
        }
        const canDl = mediaDownloadable(it);
        const label = kindLabel(it.kind);
        const preview = it.thumb
          ? `<img src="${escapeHtml(it.thumb)}" alt="" loading="lazy" />`
          : `<span class="lb-kind lb-kind-${escapeHtml(it.kind === "video" || it.kind === "image" ? it.kind : "file")}">${escapeHtml(label)}</span>`;
        const hint = canDl ? "" : `<span class="lb-dl-hint is-warn">${SOURCE_GONE}</span>`;
        return `<div class="lb-item" data-id="${escapeHtml(it.id)}">
          <div class="lb-item-preview">${preview}</div>
          <div class="lb-item-main">
            <strong>${escapeHtml(it.name || label)}</strong>
            <p class="hint tight lb-item-meta mono">${escapeHtml(label)} · ${fmtSize(it.size)} · ${escapeHtml(peerLabel(it.ownerId))}</p>
          </div>
          <div class="lb-item-actions">
            <button type="button" class="secondary-btn lb-download" data-id="${escapeHtml(it.id)}" ${
              canDl ? "" : 'aria-disabled="true"'
            }>下载</button>
            ${hint}
          </div>
        </div>`;
      })
      .join("");

    els.feed.querySelectorAll(".lb-copy").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-id");
        const it = state.items.get(id);
        if (!it?.text) return;
        try {
          await navigator.clipboard.writeText(it.text);
          notifyToast("已复制");
        } catch {
          notifyToast("复制失败，请长按文字手动复制");
        }
      });
    });
    els.feed.querySelectorAll(".lb-download").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-id");
        downloadItem(id);
      });
    });
  }

  async function makeImageThumb(file) {
    if (!file?.type?.startsWith("image/") || file.size > 12 * 1024 * 1024) return "";
    return withTimeout(
      (async () => {
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
      })(),
      THUMB_TIMEOUT_MS,
      ""
    );
  }

  function withTimeout(promise, ms, fallback = "") {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => {
        if (done) return;
        done = true;
        resolve(v);
      };
      const to = setTimeout(() => finish(fallback), ms);
      Promise.resolve(promise)
        .then((v) => {
          clearTimeout(to);
          finish(v);
        })
        .catch(() => {
          clearTimeout(to);
          finish(fallback);
        });
    });
  }

  async function makeVideoThumb(file) {
    const mime = String(file?.type || "").toLowerCase();
    const byExt = /\.(mp4|webm|mov|m4v|mkv|avi|3gp)$/i.test(String(file?.name || ""));
    if (!mime.startsWith("video/") && !byExt) return "";
    // 部分编码/大文件永远不触发 loadeddata；无超时会卡住整批发送并表现为「点发送无反应」。
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    let settled = false;
    const cleanup = () => {
      try {
        video.onloadedmetadata = null;
        video.onloadeddata = null;
        video.onerror = null;
        video.onseeked = null;
        video.removeAttribute("src");
        video.load?.();
      } catch {
        /* ignore */
      }
      try {
        URL.revokeObjectURL(url);
      } catch {
        /* ignore */
      }
    };
    try {
      return await new Promise((resolve) => {
        const done = (value) => {
          if (settled) return;
          settled = true;
          clearTimeout(watchdog);
          cleanup();
          resolve(value);
        };
        const watchdog = setTimeout(() => done(""), THUMB_TIMEOUT_MS);
        const draw = () => {
          try {
            if (video.videoWidth < 2 || video.videoHeight < 2) {
              done("");
              return;
            }
            const canvas = document.createElement("canvas");
            const maxSide = 128;
            const scale = Math.min(1, maxSide / Math.max(video.videoWidth || 1, video.videoHeight || 1));
            canvas.width = Math.max(1, Math.round((video.videoWidth || 1) * scale));
            canvas.height = Math.max(1, Math.round((video.videoHeight || 1) * scale));
            canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
            done(canvas.toDataURL("image/jpeg", 0.7));
          } catch {
            done("");
          }
        };
        const afterMeta = () => {
          if (settled) return;
          video.onloadedmetadata = null;
          video.onloadeddata = null;
          const seekTo = Math.min(0.4, Math.max(0, (video.duration || 1) * 0.05));
          if (Number.isFinite(seekTo) && seekTo > 0) {
            try {
              video.onseeked = () => draw();
              video.currentTime = seekTo;
              setTimeout(() => {
                if (!settled) draw();
              }, 600);
              return;
            } catch {
              /* fall through */
            }
          }
          draw();
        };
        video.onloadedmetadata = afterMeta;
        video.onloadeddata = afterMeta;
        video.onerror = () => done("");
        video.src = url;
      });
    } catch {
      cleanup();
      return "";
    }
  }

  function createPeer() {
    return new RTCPeerConnection({
      iceServers: STUN,
      bundlePolicy: "max-bundle",
      rtcpMuxPolicy: "require",
    });
  }

  async function waitIce(pc) {
    if (pc.iceGatheringState === "complete") return;
    await new Promise((resolve) => {
      const to = setTimeout(resolve, 3500);
      pc.addEventListener("icegatheringstatechange", () => {
        if (pc.iceGatheringState === "complete") {
          clearTimeout(to);
          resolve(null);
        }
      });
    });
  }

  function getMqttConnect() {
    const m = typeof mqtt !== "undefined" ? mqtt : globalThis.mqtt;
    if (!m) return null;
    if (typeof m.connect === "function") return m.connect.bind(m);
    if (typeof m.default?.connect === "function") return m.default.connect.bind(m.default);
    if (typeof m.default === "function") return m.default;
    return null;
  }

  async function ensureMqttLib() {
    if (getMqttConnect()) return;
    await window.DevToolsLazy?.loadVendor?.("mqtt");
    if (!getMqttConnect()) throw new Error("MQTT 库加载失败");
  }

  function makeEnvelope(payload) {
    return {
      v: 1,
      proto: PROTO,
      msgId: uid(12),
      ts: Date.now(),
      from: state.peerId,
      ...payload,
    };
  }

  function publishMqtt(payload, { retain = false } = {}) {
    const msg = makeEnvelope(payload);
    if (state.bc) {
      try {
        state.bc.postMessage(msg);
      } catch {
        /* ignore */
      }
    }
    if (!state.mqttClient) return;
    try {
      state.mqttClient.publish(MQTT_TOPIC, JSON.stringify(msg), { qos: 0, retain });
    } catch {
      /* ignore */
    }
  }

  function bindBroadcastChannel() {
    if (typeof BroadcastChannel !== "function") return;
    try {
      state.bc = new BroadcastChannel("devtools-lanboard-v1");
      state.bc.onmessage = (ev) => {
        const msg = ev?.data;
        if (!shouldAcceptMqtt(msg)) return;
        handleSignalMsg(msg, "bc");
      };
    } catch {
      state.bc = null;
    }
  }

  function shouldAcceptMqtt(msg) {
    if (!msg || msg.proto !== PROTO) return false;
    if (msg.from === state.peerId) return false;
    if (Date.now() - (msg.ts || 0) > MQTT_MSG_TTL_MS) return false;
    if (!state.mqttSeen) state.mqttSeen = new Set();
    const key = msg.msgId || `${msg.type}:${msg.from}:${msg.ts}`;
    if (state.mqttSeen.has(key)) return false;
    state.mqttSeen.add(key);
    if (state.mqttSeen.size > 800) {
      state.mqttSeen = new Set([...state.mqttSeen].slice(-400));
    }
    return true;
  }

  function connectMqttOnce(brokerUrl) {
    const connectFn = getMqttConnect();
    if (!connectFn) return Promise.reject(new Error("信令库不可用"));
    return new Promise((resolve, reject) => {
      const client = connectFn(brokerUrl, {
        clientId: `lb_${uid(12)}`,
        clean: true,
        reconnectPeriod: 4000,
        connectTimeout: 10000,
      });
      let settled = false;
      const fail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(to);
        try {
          client.end(true);
        } catch {
          /* ignore */
        }
        reject(err instanceof Error ? err : new Error(String(err || "信令失败")));
      };
      const to = setTimeout(() => fail(new Error("连接信令超时")), 12000);
      client.on("error", fail);
      client.on("connect", () => {
        client.subscribe(MQTT_TOPIC, { qos: 0 }, (err) => {
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

  async function connectMqtt() {
    await ensureMqttLib();
    let lastErr = null;
    for (const broker of MQTT_BROKERS) {
      try {
        const client = await connectMqttOnce(broker);
        state.mqttClient = client;
        state.mqttOk = true;
        state.mqttSeen = new Set();
        client.on("message", onMqttMessage);
        client.on("offline", () => {
          state.mqttOk = false;
          paintStatus();
        });
        client.on("reconnect", () => {
          state.mqttOk = true;
          paintStatus();
        });
        publishPresence();
        requestSnapshots();
        paintStatus();
        return;
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr || new Error("无法连接大厅信令");
  }

  function publishPresence() {
    publishMqtt({
      type: "presence",
      name: state.peerName,
      peerId: state.peerId,
    });
  }

  function requestSnapshots() {
    publishMqtt({ type: "snap-req" });
    for (const [peerId, link] of state.links) {
      if (link.dc?.readyState === "open") {
        try {
          link.dc.send(JSON.stringify({ type: "snap-req", from: state.peerId }));
        } catch {
          /* ignore */
        }
      }
      void peerId;
    }
  }

  function onMqttMessage(_t, payload) {
    let msg;
    try {
      msg = JSON.parse(payload.toString());
    } catch {
      return;
    }
    if (!shouldAcceptMqtt(msg)) return;
    handleSignalMsg(msg, "mqtt");
  }

  function handleSignalMsg(msg, via) {
    switch (msg.type) {
      case "presence":
        notePeer(msg.peerId || msg.from, msg.name || "");
        maybeConnect(msg.peerId || msg.from);
        break;
      case "bye":
        dropPeer(msg.peerId || msg.from);
        break;
      case "signal":
        handleRtcSignal(msg).catch(() => {});
        break;
      case "item-meta":
        if (msg.item) upsertItem({ ...msg.item, text: undefined });
        break;
      case "item-text":
        if (msg.item?.kind === "text") upsertItem(msg.item);
        break;
      case "snap-req":
        sendSnapshotTo(msg.from, via === "mqtt" ? "mqtt" : "dc");
        break;
      case "snap":
        applySnapshot(msg);
        break;
      default:
        break;
    }
  }

  function notePeer(id, name) {
    if (!id || id === state.peerId) return;
    const prev = state.peers.get(id) || {};
    state.peers.set(id, {
      id,
      name: name || prev.name || id.slice(0, 8),
      lastSeen: Date.now(),
    });
    paintStatus();
    paintFeed();
  }

  function dropPeer(id) {
    if (!id) return;
    state.peers.delete(id);
    const link = state.links.get(id);
    if (link) {
      try {
        link.pc.close();
      } catch {
        /* ignore */
      }
      state.links.delete(id);
    }
    paintStatus();
    paintFeed();
  }

  function prunePeers() {
    const now = Date.now();
    for (const [id, p] of state.peers) {
      if (now - (p.lastSeen || 0) > PEER_STALE_MS) dropPeer(id);
    }
  }

  function sendSnapshotTo(to, via) {
    const texts = [...state.items.values()].filter((it) => it.kind === "text");
    const media = [...state.items.values()]
      .filter((it) => it.kind !== "text")
      .map((it) => ({
        id: it.id,
        kind: it.kind,
        name: it.name,
        mime: it.mime,
        size: it.size,
        ownerId: it.ownerId,
        ownerName: it.ownerName,
        thumb: it.thumb,
        addedAt: it.addedAt,
        onBridge: !!it.onBridge,
      }));
    const payload = { type: "snap", texts, media, from: state.peerId };
    if (via === "mqtt" || !to) {
      publishMqtt(payload);
      return;
    }
    const link = state.links.get(to);
    if (link?.dc?.readyState === "open") {
      try {
        link.dc.send(JSON.stringify(payload));
      } catch {
        publishMqtt(payload);
      }
    } else {
      publishMqtt(payload);
    }
  }

  function applySnapshot(msg) {
    (msg.texts || []).forEach((it) => upsertItem(it, { paint: false, persist: false }));
    (msg.media || []).forEach((it) => upsertItem(it, { paint: false, persist: false }));
    persistItems();
    paintFeed();
  }

  function dcSend(peerId, obj) {
    const link = state.links.get(peerId);
    if (link?.dc?.readyState === "open") {
      link.dc.send(typeof obj === "string" ? obj : JSON.stringify(obj));
      return true;
    }
    return false;
  }

  function broadcastDc(obj) {
    const body = JSON.stringify(obj);
    for (const [id, link] of state.links) {
      if (link.dc?.readyState === "open") {
        try {
          link.dc.send(body);
        } catch {
          /* ignore */
        }
      }
      void id;
    }
  }

  function broadcastItem(item) {
    if (item.kind === "text") {
      broadcastDc({ type: "item-text", item });
      if (String(item.text || "").length <= TEXT_MQTT_MAX) {
        publishMqtt({ type: "item-text", item });
      } else {
        publishMqtt({
          type: "item-meta",
          item: {
            id: item.id,
            kind: "text",
            ownerId: item.ownerId,
            ownerName: item.ownerName,
            addedAt: item.addedAt,
            size: BufferByteLength(item.text),
          },
        });
      }
      pushTextToBridge(item);
      return;
    }
    const meta = { ...item };
    delete meta._objUrl;
    broadcastDc({ type: "item-meta", item: meta });
    // MQTT 载荷有限：大缩略图只走 DataChannel，避免静默丢消息
    const mqttMeta = { ...meta };
    if (String(mqttMeta.thumb || "").length > MQTT_THUMB_MAX) mqttMeta.thumb = "";
    publishMqtt({ type: "item-meta", item: mqttMeta });
  }

  function BufferByteLength(s) {
    try {
      return new TextEncoder().encode(String(s || "")).length;
    } catch {
      return String(s || "").length;
    }
  }

  async function maybeConnect(remoteId) {
    if (!remoteId || remoteId === state.peerId || !webrtcSupported()) return;
    if (state.links.has(remoteId)) return;
    // 较小 id 发起，避免双开
    if (state.peerId > remoteId) return;
    await ensureLink(remoteId, true);
  }

  async function ensureLink(remoteId, asOfferer) {
    if (state.links.has(remoteId)) return state.links.get(remoteId);
    const pc = createPeer();
    const link = { pc, dc: null, polite: state.peerId > remoteId, makingOffer: false };
    state.links.set(remoteId, link);

    pc.onicecandidate = (ev) => {
      if (!ev.candidate) return;
      publishMqtt({
        type: "signal",
        signalType: "ice",
        to: remoteId,
        candidate: ev.candidate,
      });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed" || pc.connectionState === "closed") {
        try {
          pc.close();
        } catch {
          /* ignore */
        }
        state.links.delete(remoteId);
        paintStatus();
      }
    };
    pc.ondatachannel = (ev) => {
      bindDc(remoteId, ev.channel);
    };

    if (asOfferer) {
      const dc = pc.createDataChannel("lanboard", { ordered: true });
      bindDc(remoteId, dc);
      link.makingOffer = true;
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await waitIce(pc);
        publishMqtt({
          type: "signal",
          signalType: "offer",
          to: remoteId,
          sdp: pc.localDescription?.sdp,
        });
      } finally {
        link.makingOffer = false;
      }
    }
    paintStatus();
    return link;
  }

  function bindDc(remoteId, dc) {
    const link = state.links.get(remoteId);
    if (!link) return;
    link.dc = dc;
    dc.binaryType = "arraybuffer";
    dc.onopen = () => {
      paintStatus();
      try {
        dc.send(
          JSON.stringify({
            type: "snap",
            texts: [...state.items.values()].filter((i) => i.kind === "text"),
            media: [...state.items.values()]
              .filter((i) => i.kind !== "text")
              .map((i) => ({
                id: i.id,
                kind: i.kind,
                name: i.name,
                mime: i.mime,
                size: i.size,
                ownerId: i.ownerId,
                ownerName: i.ownerName,
                thumb: i.thumb,
                addedAt: i.addedAt,
                onBridge: !!i.onBridge,
              })),
            from: state.peerId,
          })
        );
      } catch {
        /* ignore */
      }
    };
    dc.onclose = () => paintStatus();
    dc.onmessage = (ev) => {
      if (typeof ev.data !== "string") {
        handleBinaryFrom(remoteId, ev.data);
        return;
      }
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.type === "item-text" && msg.item) upsertItem(msg.item);
      else if (msg.type === "item-meta" && msg.item) upsertItem(msg.item);
      else if (msg.type === "snap") applySnapshot(msg);
      else if (msg.type === "snap-req") sendSnapshotTo(remoteId, "dc");
      else if (msg.type === "file-req") serveFile(remoteId, msg.fileId).catch(() => {});
      else if (msg.type === "file-meta" || msg.type === "file-done" || msg.type === "file-error") {
        handleFileCtrl(remoteId, msg);
      }
    };
  }

  /** @type {Map<string, { chunks: ArrayBuffer[], meta: object|null, resolve: Function, reject: Function, timer: any }>} */
  const recvSessions = new Map();

  function handleBinaryFrom(from, buf) {
    const key = [...recvSessions.keys()].find((k) => k.startsWith(`${from}:`));
    if (!key) return;
    const sess = recvSessions.get(key);
    if (!sess) return;
    sess.chunks.push(buf);
  }

  function handleFileCtrl(from, msg) {
    const key = `${from}:${msg.fileId}`;
    const sess = recvSessions.get(key);
    if (!sess) return;
    if (msg.type === "file-meta") sess.meta = msg;
    if (msg.type === "file-done") {
      clearTimeout(sess.timer);
      sess.resolve({ meta: sess.meta, chunks: sess.chunks });
      recvSessions.delete(key);
    }
    if (msg.type === "file-error") {
      clearTimeout(sess.timer);
      sess.reject(new Error(msg.message || "传输失败"));
      recvSessions.delete(key);
    }
  }

  async function handleRtcSignal(msg) {
    const from = msg.from;
    const to = msg.to;
    if (to && to !== state.peerId) return;
    if (!from || from === state.peerId) return;
    notePeer(from, state.peers.get(from)?.name || "");

    let link = state.links.get(from);
    if (!link) {
      await ensureLink(from, false);
      link = state.links.get(from);
    }
    if (!link) return;
    const { pc } = link;

    if (msg.signalType === "offer" && msg.sdp) {
      const offerCollision = link.makingOffer || pc.signalingState !== "stable";
      if (offerCollision && !link.polite) return;
      await pc.setRemoteDescription({ type: "offer", sdp: msg.sdp });
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitIce(pc);
      publishMqtt({
        type: "signal",
        signalType: "answer",
        to: from,
        sdp: pc.localDescription?.sdp,
      });
      return;
    }
    if (msg.signalType === "answer" && msg.sdp) {
      if (pc.signalingState === "have-local-offer") {
        await pc.setRemoteDescription({ type: "answer", sdp: msg.sdp });
      }
      return;
    }
    if (msg.signalType === "ice" && msg.candidate) {
      try {
        await pc.addIceCandidate(msg.candidate);
      } catch {
        /* ignore */
      }
    }
  }

  async function waitDcBuffer(dc) {
    while (dc.bufferedAmount > DC_BUFFER_LIMIT) {
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  async function serveFile(to, fileId) {
    const blob = state.localBlobs.get(fileId);
    const meta = state.items.get(fileId);
    if (!blob || !meta) {
      dcSend(to, { type: "file-error", fileId, message: "源文件不在本机" });
      return;
    }
    const link = state.links.get(to);
    if (!link?.dc || link.dc.readyState !== "open") {
      await ensureLink(to, state.peerId < to);
      await new Promise((r) => setTimeout(r, 600));
    }
    const dc = state.links.get(to)?.dc;
    if (!dc || dc.readyState !== "open") {
      return;
    }
    dcSend(to, {
      type: "file-meta",
      fileId,
      name: meta.name,
      mime: meta.mime,
      size: blob.size,
    });
    const buf = await blob.arrayBuffer();
    for (let i = 0; i < buf.byteLength; i += CHUNK_SIZE) {
      await waitDcBuffer(dc);
      dc.send(buf.slice(i, i + CHUNK_SIZE));
    }
    dcSend(to, { type: "file-done", fileId });
  }

  function requestFileFromPeer(ownerId, fileId) {
    return new Promise(async (resolve, reject) => {
      if (!ownerId || ownerId === state.peerId) {
        reject(new Error("无源设备"));
        return;
      }
      if (!state.links.has(ownerId)) {
        await ensureLink(ownerId, state.peerId < ownerId);
        await new Promise((r) => setTimeout(r, 800));
      }
      const key = `${ownerId}:${fileId}`;
      const timer = setTimeout(() => {
        recvSessions.delete(key);
        reject(new Error("下载超时"));
      }, 120000);
      recvSessions.set(key, { chunks: [], meta: null, resolve, reject, timer });
      const ok = dcSend(ownerId, { type: "file-req", fileId, from: state.peerId });
      if (!ok) {
        clearTimeout(timer);
        recvSessions.delete(key);
        reject(new Error(SOURCE_GONE));
      }
    });
  }

  async function downloadItem(id) {
    const it = state.items.get(id);
    if (!it || it.kind === "text") return;
    if (!mediaDownloadable(it)) {
      notifyToast(SOURCE_GONE);
      setInfo(SOURCE_GONE);
      paintFeed();
      return;
    }
    try {
      let blob = state.localBlobs.get(id);
      if (!blob && it.onBridge && state.bridgeOk) {
        blob = await fetchMediaFromBridge(id);
      }
      if (!blob && isOwnerOnline(it.ownerId)) {
        const { meta, chunks } = await requestFileFromPeer(it.ownerId, id);
        blob = new Blob(chunks, { type: meta?.mime || it.mime || "application/octet-stream" });
        state.localBlobs.set(id, blob);
      }
      if (!blob) {
        notifyToast(SOURCE_GONE);
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = it.name || "download";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
      notifyToast("开始下载");
    } catch (e) {
      notifyToast(e?.message || SOURCE_GONE);
      setError(e?.message || SOURCE_GONE);
    }
  }

  function bridgeHeaders(extra = {}) {
    return {
      "X-Adb-Token": state.bridgeToken,
      "X-Ffmpeg-Token": state.bridgeToken,
      ...extra,
    };
  }

  async function probeBridge() {
    const base = String(state.bridgeBase || "http://127.0.0.1:17888").replace(/\/+$/, "");
    state.bridgeBase = base;
    try {
      const res = await fetch(`${base}/lanboard/health`, {
        headers: bridgeHeaders(),
        cache: "no-store",
      });
      if (!res.ok) throw new Error("health fail");
      const j = await res.json();
      state.bridgeOk = !!j?.ok;
    } catch {
      try {
        const res = await fetch(`${base}/health`, { cache: "no-store" });
        state.bridgeOk = res.ok;
      } catch {
        state.bridgeOk = false;
      }
    }
    paintStatus();
    if (state.bridgeOk) pullBridgeSnapshot().catch(() => {});
    return state.bridgeOk;
  }

  async function pullBridgeSnapshot() {
    if (!state.bridgeOk) return;
    const base = state.bridgeBase;
    const res = await fetch(`${base}/lanboard/snapshot`, {
      headers: bridgeHeaders(),
      cache: "no-store",
    });
    if (!res.ok) return;
    const j = await res.json();
    (j.texts || []).forEach((it) => upsertItem(it, { paint: false }));
    (j.media || []).forEach((it) => upsertItem({ ...it, onBridge: true }, { paint: false }));
    persistItems();
    paintFeed();
  }

  async function pushTextToBridge(item) {
    if (!state.bridgeOk || item.kind !== "text") return;
    try {
      await fetch(`${state.bridgeBase}/lanboard/texts`, {
        method: "POST",
        headers: {
          ...bridgeHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ item }),
      });
    } catch {
      /* ignore */
    }
  }

  async function pushMediaToBridge(item, blob) {
    if (!state.bridgeOk || !blob) return;
    try {
      const res = await fetch(`${state.bridgeBase}/lanboard/media`, {
        method: "POST",
        headers: bridgeHeaders({
          "Content-Type": item.mime || "application/octet-stream",
          "X-Lanboard-Id": item.id,
          "X-Lanboard-Name": encodeURIComponent(item.name || "file"),
          "X-Lanboard-Mime": item.mime || "application/octet-stream",
          "X-Lanboard-Kind": item.kind || "file",
          "X-Lanboard-Owner": item.ownerId || "",
          "X-Lanboard-Owner-Name": encodeURIComponent(item.ownerName || ""),
          "X-Lanboard-Thumb": encodeURIComponent(item.thumb || ""),
        }),
        body: blob,
      });
      if (res.ok) {
        upsertItem({ ...item, onBridge: true }, { paint: true, persist: false, relay: false });
      }
    } catch {
      /* ignore */
    }
  }

  async function fetchMediaFromBridge(id) {
    const res = await fetch(`${state.bridgeBase}/lanboard/media/${encodeURIComponent(id)}`, {
      headers: bridgeHeaders(),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(SOURCE_GONE);
    const blob = await res.blob();
    state.localBlobs.set(id, blob);
    return blob;
  }

  function clearPendingFiles() {
    pendingFiles = [];
    if (els.fileHint) els.fileHint.textContent = "";
    if (els.fileInput) els.fileInput.value = "";
    if (els.anyFileInput) els.anyFileInput.value = "";
  }

  function setPendingFromInput(input) {
    pendingFiles = [...(input?.files || [])];
    if (els.fileHint) {
      els.fileHint.textContent = pendingFiles.length ? `已选 ${pendingFiles.length} 个，发送中…` : "";
    }
    // 两个 input 互斥：从一个选完后清空另一个，避免重复
    if (input === els.fileInput && els.anyFileInput) els.anyFileInput.value = "";
    if (input === els.anyFileInput && els.fileInput) els.fileInput.value = "";
  }

  function setSendingUi(on, label = "") {
    sending = !!on;
    if (els.sendBtn) {
      els.sendBtn.disabled = sending;
      els.sendBtn.textContent = sending ? label || "发送中…" : "发送";
    }
  }

  async function sendCompose({ fromFiles = false } = {}) {
    const text = String(els.textInput?.value || "").trim();
    if (!text && !pendingFiles.length) {
      if (!fromFiles) setError("请输入文字或选择文件");
      return;
    }
    if (sending) {
      setInfo("正在发送，请稍候…");
      return;
    }
    setError("");
    setInfo("");
    setSendingUi(true, "发送中…");
    const files = pendingFiles.slice();
    clearPendingFiles();
    const fails = [];
    try {
      if (text) {
        const item = {
          id: uid(12),
          kind: "text",
          text,
          ownerId: state.peerId,
          ownerName: state.peerName,
          addedAt: Date.now(),
        };
        upsertItem(item, { relay: true });
        if (els.textInput) els.textInput.value = "";
      }
      const total = files.length;
      for (let i = 0; i < total; i++) {
        const file = files[i];
        const name = file?.name || `文件${i + 1}`;
        setSendingUi(true, `发送 ${i + 1}/${total}`);
        if (els.fileHint) els.fileHint.textContent = `正在发送 ${i + 1}/${total}：${name}`;
        try {
          await sendFile(file);
        } catch (e) {
          fails.push(`${name}：${e?.message || e || "失败"}`);
        }
      }
      paintFeed();
      if (fails.length) {
        const msg =
          fails.length === total
            ? `全部 ${total} 个文件发送失败：${fails.slice(0, 3).join("；")}${fails.length > 3 ? "…" : ""}`
            : `${fails.length}/${total} 个失败：${fails.slice(0, 3).join("；")}${fails.length > 3 ? "…" : ""}`;
        setError(msg);
        notifyToast(msg);
      } else if (total > 0) {
        setInfo(total === 1 ? "已发送 1 个文件" : `已发送 ${total} 个文件`);
        notifyToast(total === 1 ? "已发送" : `已发送 ${total} 个文件`);
        if (els.fileHint) els.fileHint.textContent = "";
      }
    } finally {
      setSendingUi(false);
    }
  }

  async function sendFile(file) {
    if (!file) return;
    if (typeof file.size === "number" && file.size <= 0) {
      throw new Error("空文件无法发送");
    }
    const id = uid(12);
    const kind = fileKindOf(file);
    let thumb = "";
    try {
      if (kind === "image") thumb = await makeImageThumb(file);
      else if (kind === "video") thumb = await makeVideoThumb(file);
    } catch {
      thumb = "";
    }
    const item = {
      id,
      kind,
      name: file.name || kindLabel(kind),
      mime: file.type || "application/octet-stream",
      size: file.size,
      ownerId: state.peerId,
      ownerName: state.peerName,
      thumb,
      addedAt: Date.now(),
      onBridge: false,
    };
    state.localBlobs.set(id, file);
    upsertItem(item, { relay: true });
    pushMediaToBridge(item, file).catch(() => {});
  }

  function onFilesPicked(input) {
    try {
      const files = [...(input?.files || [])].filter(Boolean);
      if (!files.length) return;
      pendingFiles = files;
      if (els.fileHint) els.fileHint.textContent = `已选 ${files.length} 个，发送中…`;
      // 先拷贝 File 再清空 value，便于再次选同一文件也能触发 change
      if (input) input.value = "";
      if (input === els.fileInput && els.anyFileInput) els.anyFileInput.value = "";
      if (input === els.anyFileInput && els.fileInput) els.fileInput.value = "";
      sendCompose({ fromFiles: true }).catch((e) => {
        const msg = e?.message || "发送失败";
        setError(msg);
        notifyToast(msg);
      });
    } catch (e) {
      const msg = e?.message || "选文件后发送失败";
      setError(msg);
      notifyToast(msg);
    }
  }

  function onFilesDropped(fileList) {
    try {
      const files = [...(fileList || [])].filter(Boolean);
      if (!files.length) return;
      pendingFiles = files;
      if (els.fileHint) els.fileHint.textContent = `已选 ${files.length} 个，发送中…`;
      if (els.fileInput) els.fileInput.value = "";
      if (els.anyFileInput) els.anyFileInput.value = "";
      sendCompose({ fromFiles: true }).catch((e) => {
        const msg = e?.message || "发送失败";
        setError(msg);
        notifyToast(msg);
      });
    } catch (e) {
      const msg = e?.message || "拖入文件后发送失败";
      setError(msg);
      notifyToast(msg);
    }
  }

  function bindBridgeUi() {
    if (!els.bridgeShell) return;
    if (window.devtoolsBridgeShell?.mount) {
      try {
        const shell = window.devtoolsBridgeShell.mount({
          host: els.bridgeShell,
          prefix: "lanb",
          kind: "unified",
          collapseAdvanced: true,
          showReadyCard: false,
          primaryAction: "connect",
          hintDisconnected:
            "可选：连统一桥后文字会落桥，电脑关网页后手机仍可拉文字。一般同 WiFi 直连即可。",
          connHint:
            '默认统一桥 <span class="mono">17888</span> · API <span class="mono">/lanboard/*</span> · Token <span class="mono">devtools-bridge</span>。',
          defaultBase: "http://127.0.0.1:17888",
          defaultToken: "devtools-bridge",
        });
        shell.bind?.({
          onConnected: (info) => {
            if (info?.base) state.bridgeBase = String(info.base).replace(/\/+$/, "");
            else if (shell.getBase) state.bridgeBase = shell.getBase();
            if (info?.token) state.bridgeToken = info.token;
            else if (shell.getToken) state.bridgeToken = shell.getToken();
            state.bridgeOk = true;
            paintStatus();
            pullBridgeSnapshot().catch(() => {});
            renderBridgeQr();
          },
        });
        const base = shell.getBase?.() || state.bridgeBase;
        const token = shell.getToken?.() || state.bridgeToken;
        state.bridgeBase = String(base).replace(/\/+$/, "");
        state.bridgeToken = token;
      } catch (e) {
        els.bridgeShell.innerHTML = `<p class="hint tight">桥连接壳加载失败：${escapeHtml(e?.message || e)}</p>`;
      }
    } else {
      els.bridgeShell.innerHTML = `<div class="field-row" style="flex-wrap:wrap">
        <label>桥地址</label>
        <input id="lb-bridge-base" type="text" value="${escapeHtml(state.bridgeBase)}" style="min-width:14rem" />
        <label>Token</label>
        <input id="lb-bridge-token" type="text" value="${escapeHtml(state.bridgeToken)}" style="min-width:8rem" />
        <button type="button" class="secondary-btn" id="lb-bridge-probe">检测桥</button>
      </div>`;
      $("#lb-bridge-probe")?.addEventListener("click", () => {
        state.bridgeBase = $("#lb-bridge-base")?.value || state.bridgeBase;
        state.bridgeToken = $("#lb-bridge-token")?.value || state.bridgeToken;
        probeBridge().then((ok) => notifyToast(ok ? "桥已连接" : "未检测到桥"));
        renderBridgeQr();
      });
    }
    renderBridgeQr();
  }

  async function renderBridgeQr() {
    if (!els.bridgeQr) return;
    els.bridgeQr.innerHTML = "";
    const text = `${state.bridgeBase.replace(/\/+$/, "")}/lanboard · token=${state.bridgeToken}`;
    try {
      if (typeof QRCode === "undefined") {
        await window.DevToolsLazy?.loadVendor?.("qrcode");
      }
      if (typeof QRCode !== "undefined") {
        // eslint-disable-next-line no-new
        new QRCode(els.bridgeQr, { text, width: 140, height: 140, correctLevel: QRCode.CorrectLevel.L });
        return;
      }
    } catch {
      /* ignore */
    }
    els.bridgeQr.textContent = text;
  }

  function bindUi() {
    if (els.nameInput) {
      els.nameInput.value = loadName() || `设备-${uid(4)}`;
      state.peerName = els.nameInput.value.trim() || "未命名";
      els.nameInput.addEventListener("change", () => {
        state.peerName = els.nameInput.value.trim() || "未命名";
        saveName(state.peerName);
        publishPresence();
        paintStatus();
      });
    }
    els.sendBtn?.addEventListener("click", () =>
      sendCompose().catch((e) => setError(e?.message || "发送失败"))
    );
    els.fileInput?.addEventListener("change", () => onFilesPicked(els.fileInput));
    els.anyFileInput?.addEventListener("change", () => onFilesPicked(els.anyFileInput));
    els.textInput?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) {
        ev.preventDefault();
        sendCompose().catch((e) => setError(e?.message || "发送失败"));
      }
    });
    if (els.compose) {
      els.compose.addEventListener("dragover", (ev) => {
        if (![...ev.dataTransfer?.types || []].includes("Files")) return;
        ev.preventDefault();
        ev.dataTransfer.dropEffect = "copy";
        els.compose.classList.add("lb-compose-drag");
      });
      els.compose.addEventListener("dragleave", (ev) => {
        if (ev.target === els.compose) els.compose.classList.remove("lb-compose-drag");
      });
      els.compose.addEventListener("drop", (ev) => {
        els.compose.classList.remove("lb-compose-drag");
        if (![...ev.dataTransfer?.types || []].includes("Files")) return;
        ev.preventDefault();
        onFilesDropped(ev.dataTransfer?.files);
      });
    }
  }

  async function boot() {
    if (state.started) return;
    state.started = true;
    state.peerId = loadPeerId() || uid(12);
    savePeerId(state.peerId);
    state.peerName = (els.nameInput?.value || loadName() || `设备-${uid(4)}`).trim();
    if (els.nameInput && !els.nameInput.value) els.nameInput.value = state.peerName;
    saveName(state.peerName);

    bindBroadcastChannel();
    bindUi();
    bindBridgeUi();
    await restoreLocalItems();
    paintFeed();
    paintStatus();

    if (!webrtcSupported()) {
      setError("当前浏览器不支持 WebRTC，媒体直传不可用；文字仍可尝试信令同步。");
    }

    try {
      await window.DevToolsLazy?.ensureForTool?.("lanboard");
    } catch {
      /* ignore */
    }

    probeBridge().catch(() => {});
    try {
      await connectMqtt();
      setInfo("");
    } catch (e) {
      setError(e?.message || "无法进入大厅，请检查网络后刷新");
    }

    state.presenceTimer = setInterval(() => {
      publishPresence();
      prunePeers();
      paintStatus();
      paintFeed();
    }, PRESENCE_MS);
    state.pruneTimer = setInterval(() => probeBridge().catch(() => {}), 20000);

    window.addEventListener("pagehide", publishBye);
    window.addEventListener("beforeunload", publishBye);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        publishPresence();
        requestSnapshots();
        pullBridgeSnapshot().catch(() => {});
      }
    });
  }

  function panelLooksActive() {
    return (
      panel.classList.contains("is-workspace-active") ||
      panel.classList.contains("is-active") ||
      (!panel.hidden && panel.offsetParent !== null)
    );
  }

  if (panelLooksActive() || location.hash.replace(/^#/, "").split("?")[0] === "lanboard") {
    boot().catch((e) => setError(e?.message || "启动失败"));
  } else {
    const obs = new MutationObserver(() => {
      if (panelLooksActive()) {
        obs.disconnect();
        boot().catch((e) => setError(e?.message || "启动失败"));
      }
    });
    obs.observe(panel, { attributes: true, attributeFilter: ["class", "hidden", "style"] });
    // 懒加载后也可能已显示
    setTimeout(() => {
      if (!state.started && panelLooksActive()) {
        boot().catch((e) => setError(e?.message || "启动失败"));
      }
    }, 400);
  }

  window.DevToolsLanBoard = { boot, probeBridge };
})();
