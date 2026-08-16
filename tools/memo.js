(() => {
  "use strict";

  const P = window.DevToolsPure;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  if (!P || !$("#memo")) return;

  const DB_NAME = "devtools-memo-v1";
  const DB_VER = 1;
  const INDEX_NAME = "memo-index.json";
  const BLOBS_DIR = "blobs";
  const DEFAULT_TAG_ID = "default";
  const META_KEY = "meta";

  function toast(msg) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.classList.add("is-show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.classList.remove("is-show");
      setTimeout(() => {
        el.hidden = true;
      }, 200);
    }, 1600);
  }

  function setError(el, msg) {
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }

  function uid() {
    return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
  }

  function formatBytes(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return "—";
    if (num < 1024) return `${Math.round(num)} B`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
    return `${(num / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatTime(ts) {
    const d = new Date(Number(ts) || Date.now());
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function isMemoActive() {
    const panel = $("#memo");
    return !!(panel && panel.classList.contains("is-workspace-active") && !panel.hidden);
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function canDirPicker() {
    return typeof window.showDirectoryPicker === "function";
  }

  function isLikelyMobile() {
    return (
      window.matchMedia("(max-width: 900px)").matches ||
      /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "")
    );
  }

  function emptyIndex() {
    return {
      version: 1,
      folderId: uid(),
      tags: [{ id: DEFAULT_TAG_ID, name: "默认", order: 0 }],
      items: [],
    };
  }

  function normalizeIndex(raw) {
    const base = emptyIndex();
    if (!raw || typeof raw !== "object") return base;
    const tags = Array.isArray(raw.tags) ? raw.tags : base.tags;
    const hasDefault = tags.some((t) => t.id === DEFAULT_TAG_ID);
    const nextTags = hasDefault ? tags : [base.tags[0], ...tags];
    nextTags.forEach((t, i) => {
      if (t.order == null) t.order = i;
    });
    nextTags.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const items = Array.isArray(raw.items) ? raw.items : [];
    items.forEach((it, i) => {
      if (!Array.isArray(it.tagIds) || !it.tagIds.length) it.tagIds = [DEFAULT_TAG_ID];
      if (it.order == null) it.order = i;
    });
    items.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return {
      version: 1,
      folderId: raw.folderId || base.folderId,
      tags: nextTags,
      items,
    };
  }

  function detectKind(mime, name) {
    const m = String(mime || "").toLowerCase();
    const n = String(name || "").toLowerCase();
    if (m.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg)$/.test(n)) return "image";
    if (m.startsWith("video/") || /\.(mp4|webm|mov|m4v|mkv)$/.test(n)) return "video";
    if (m.startsWith("audio/") || /\.(mp3|wav|ogg|m4a|aac|flac)$/.test(n)) return "audio";
    if (m.startsWith("text/") || m === "application/json" || /\.(txt|md|json|csv|log)$/.test(n)) return "text";
    return "file";
  }

  let dbPromise = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
        if (!db.objectStoreNames.contains("blobs")) db.createObjectStore("blobs");
        if (!db.objectStoreNames.contains("index")) db.createObjectStore("index");
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onclose = () => {
          dbPromise = null;
        };
        db.onversionchange = () => {
          try {
            db.close();
          } catch (_) {}
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        dbPromise = null;
        reject(req.error || new Error("打开备忘录数据库失败"));
      };
    });
    return dbPromise;
  }

  function safeFileName(name, fallback = "file") {
    const base = String(name || fallback).trim() || fallback;
    return base
      .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_")
      .replace(/\s+/g, " ")
      .slice(0, 120);
  }

  async function idbGet(store, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(store, key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbDel(store, key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbKeys(store) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).getAllKeys();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  // ---- crypto helpers for export ----
  async function deriveKey(password, salt) {
    const enc = new TextEncoder();
    const base = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
      base,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
  }

  async function encryptBytes(bytes, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(password, salt);
    const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes);
    const out = new Uint8Array(salt.length + iv.length + cipher.byteLength);
    out.set(salt, 0);
    out.set(iv, 16);
    out.set(new Uint8Array(cipher), 28);
    return out;
  }

  async function decryptBytes(packed, password) {
    const data = packed instanceof Uint8Array ? packed : new Uint8Array(packed);
    const salt = data.slice(0, 16);
    const iv = data.slice(16, 28);
    const cipher = data.slice(28);
    const key = await deriveKey(password, salt);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
    return new Uint8Array(plain);
  }

  // ---- store adapters ----
  const state = {
    mode: "idb", // idb | dir
    dirHandle: null,
    dirPending: false,
    index: emptyIndex(),
    activeTagId: "all",
    selected: new Set(),
    bgImageUrl: "",
    bgImageBlob: null,
    lastClipSig: "",
    busy: false,
    objectUrls: new Set(),
  };

  function trackUrl(url) {
    if (url) state.objectUrls.add(url);
    return url;
  }

  function revokeTrackedUrls() {
    for (const url of state.objectUrls) {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {}
    }
    state.objectUrls.clear();
  }

  async function ensureDirPermission(handle, mode = "readwrite") {
    if (!handle) return false;
    try {
      const q = await handle.queryPermission?.({ mode });
      if (q === "granted") return true;
      const r = await handle.requestPermission?.({ mode });
      return r === "granted";
    } catch (_) {
      return false;
    }
  }

  async function getBlobsDir(create = true) {
    if (!state.dirHandle) return null;
    return state.dirHandle.getDirectoryHandle(BLOBS_DIR, { create });
  }

  async function writeIndexToDir() {
    if (!state.dirHandle) return;
    const ok = await ensureDirPermission(state.dirHandle);
    if (!ok) throw new Error("没有目录写入权限，请重新选择存储目录");
    const file = await state.dirHandle.getFileHandle(INDEX_NAME, { create: true });
    const writable = await file.createWritable();
    await writable.write(JSON.stringify(state.index, null, 2));
    await writable.close();
  }

  async function readIndexFromDir(handle) {
    try {
      const fileHandle = await handle.getFileHandle(INDEX_NAME);
      const file = await fileHandle.getFile();
      const text = await file.text();
      return normalizeIndex(JSON.parse(text));
    } catch (_) {
      return null;
    }
  }

  async function persistIndex() {
    await idbSet("index", "main", state.index);
    if (state.mode === "dir") await writeIndexToDir();
  }

  async function saveBlob(id, blob, fileName) {
    const safe = safeFileName(fileName || id, id);
    if (state.mode === "dir" && state.dirHandle) {
      const ok = await ensureDirPermission(state.dirHandle);
      if (!ok) throw new Error("没有目录写入权限，请重新连接目录");
      const dir = await getBlobsDir(true);
      const handle = await dir.getFileHandle(safe, { create: true });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return safe;
    }
    const buf = await blob.arrayBuffer();
    await idbSet("blobs", id, { name: safe, mime: blob.type || "", buf });
    return safe;
  }

  async function loadBlob(item) {
    if (state.mode === "dir" && state.dirHandle) {
      const ok = await ensureDirPermission(state.dirHandle, "read");
      if (!ok) throw new Error("没有目录读取权限");
      const dir = await getBlobsDir(false);
      const handle = await dir.getFileHandle(item.fileName || item.id);
      return handle.getFile();
    }
    const row = await idbGet("blobs", item.id);
    if (!row?.buf) throw new Error("找不到文件数据");
    return new Blob([row.buf], { type: row.mime || item.mime || "application/octet-stream" });
  }

  async function removeBlob(item) {
    if (state.mode === "dir" && state.dirHandle) {
      try {
        const dir = await getBlobsDir(false);
        await dir.removeEntry(item.fileName || item.id);
      } catch (_) {
        /* ignore */
      }
      return;
    }
    await idbDel("blobs", item.id);
  }

  async function estimateStorageBytes() {
    let total = 0;
    try {
      const idx = JSON.stringify(state.index || {});
      total += new TextEncoder().encode(idx).length;
    } catch (_) {}
    if (state.mode === "dir" && state.dirHandle) {
      try {
        const ok = await ensureDirPermission(state.dirHandle, "read");
        if (!ok) return total;
        const dir = await getBlobsDir(false);
        // eslint-disable-next-line no-restricted-syntax
        for await (const [, handle] of dir.entries()) {
          if (handle.kind !== "file") continue;
          const f = await handle.getFile();
          total += f.size || 0;
        }
        try {
          const ih = await state.dirHandle.getFileHandle(INDEX_NAME);
          const f = await ih.getFile();
          total += f.size || 0;
        } catch (_) {}
      } catch (_) {}
      return total;
    }
    try {
      const keys = await idbKeys("blobs");
      for (const key of keys) {
        const row = await idbGet("blobs", key);
        total += row?.buf?.byteLength || 0;
      }
    } catch (_) {}
    return total;
  }

  // ---- UI refs ----
  const memoError = $("#memo-error");
  const storeMeta = $("#memo-store-meta");
  const tagList = $("#memo-tag-list");
  const itemList = $("#memo-list");
  const editor = $("#memo-editor");
  const progressEl = $("#memo-progress");
  const progressFill = $("#memo-progress-fill");
  const progressText = $("#memo-progress-text");
  const progressPct = $("#memo-progress-pct");
  const shareBtn = $("#memo-share");
  const reconnectBtn = $("#memo-reconnect");
  const exportDlg = $("#memo-export-dlg");
  const exportTags = $("#memo-export-tags");
  const lightbox = $("#memo-lightbox");
  const lightboxImg = $("#memo-lightbox-img");
  const lightboxText = $("#memo-lightbox-text");

  function setProgress(visible, ratio, text) {
    if (!progressEl) return;
    progressEl.hidden = !visible;
    const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (progressPct) progressPct.textContent = `${pct}%`;
    if (progressText) progressText.textContent = text || `${pct}%`;
  }

  function canShareFiles() {
    return typeof navigator.share === "function" && typeof navigator.canShare === "function";
  }

  function updateStoreMeta() {
    if (!storeMeta) return;
    if (shareBtn) shareBtn.hidden = !(isLikelyMobile() || canShareFiles());
    const pickBtn = $("#memo-pick-dir");
    const connected = Boolean(state.dirHandle) && (state.mode === "dir" || state.dirPending);
    if (pickBtn) {
      pickBtn.hidden = !canDirPicker() || connected;
      pickBtn.textContent = "选择存储目录";
    }
    if (reconnectBtn) {
      reconnectBtn.hidden = !canDirPicker() || !connected;
      reconnectBtn.textContent = state.dirPending ? "重新连接目录" : "更换目录";
    }
    if (state.dirPending && state.dirHandle) {
      storeMeta.textContent = `曾绑定目录「${state.dirHandle.name}」，连接已失效。请点「重新连接目录」并选回同一路径以恢复磁盘文件（清站点缓存不会删这些文件）。`;
    } else if (state.mode === "dir" && state.dirHandle) {
      storeMeta.textContent = `存储：磁盘目录「${state.dirHandle.name}」· 清缓存不会删目录内文件；若连接丢失请重新选择同一目录即可恢复。`;
    } else {
      storeMeta.textContent = canDirPicker()
        ? "存储：应用内数据（IndexedDB）。建议选择目录以便清缓存后文件仍在磁盘上。清理缓存前仍建议导出备份。"
        : "存储：应用内数据（手机端）。清理缓存前请先「导出」或「分享导出包」备份到文件/其它 App。";
    }
    window.DevToolsTemp?.refresh?.();
  }

  function visibleItems() {
    const items = [...state.index.items].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    if (state.activeTagId === "all") return items;
    return items.filter((it) => (it.tagIds || []).includes(state.activeTagId));
  }

  function tagById(id) {
    return state.index.tags.find((t) => t.id === id);
  }

  function renderTags() {
    if (!tagList) return;
    const tags = [...state.index.tags].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const bits = [
      `<button type="button" class="memo-tag-item${state.activeTagId === "all" ? " is-active" : ""}" data-memo-tag="all" draggable="false">全部</button>`,
    ];
    tags.forEach((t) => {
      bits.push(
        `<button type="button" class="memo-tag-item${state.activeTagId === t.id ? " is-active" : ""}" data-memo-tag="${escapeHtml(t.id)}" draggable="${t.id !== DEFAULT_TAG_ID ? "true" : "false"}">${escapeHtml(t.name)}</button>`
      );
    });
    tagList.innerHTML = bits.join("");
  }

  function itemCardHtml(item) {
    const checked = state.selected.has(item.id) ? "checked" : "";
    const tags = (item.tagIds || [])
      .filter((id) => id !== DEFAULT_TAG_ID)
      .map((id) => tagById(id)?.name || id)
      .filter(Boolean);
    const tagHtml = tags.map((n) => `<span class="memo-chip">${escapeHtml(n)}</span>`).join("");
    const title = escapeHtml(item.name || item.type || "条目");
    const time = formatTime(item.createdAt);
    const size = formatBytes(item.size || 0);
    let body = "";
    if (item.type === "text") {
      const full = item.textPreview || "";
      const short = full.length > 160 ? `${full.slice(0, 160)}…` : full;
      body = `<pre class="memo-text mono" data-memo-expand="${item.id}">${escapeHtml(short)}</pre>`;
    } else if (item.type === "image") {
      body = `<div class="memo-thumb-wrap"><img class="memo-thumb" data-memo-thumb="${item.id}" alt="" loading="lazy" /></div>`;
    } else if (item.type === "video") {
      body = `<video class="memo-media" data-memo-media="${item.id}" controls preload="metadata"></video>`;
    } else if (item.type === "audio") {
      body = `<audio class="memo-media" data-memo-media="${item.id}" controls preload="metadata"></audio>`;
    } else {
      body = `<p class="hint tight">文件 · ${escapeHtml(item.mime || "unknown")}</p>`;
    }
    return `<article class="memo-card" data-memo-id="${item.id}" draggable="true">
      <div class="memo-card-head">
        <label class="memo-check"><input type="checkbox" data-memo-check="${item.id}" ${checked} /></label>
        <div class="memo-card-meta">
          <strong title="${title}">${title}</strong>
          <span class="hint tight mono">${time} · ${size}</span>
        </div>
      </div>
      <div class="memo-card-body">${body}</div>
      <div class="memo-card-tags">${tagHtml}<button type="button" class="ghost-btn memo-tag-add" data-memo-tag-add="${item.id}">+ 标签</button></div>
      <div class="btn-row memo-card-actions">
        <button type="button" class="ghost-btn" data-memo-copy="${item.id}">复制</button>
        <button type="button" class="ghost-btn" data-memo-open="${item.id}">打开/预览</button>
        <button type="button" class="ghost-btn" data-memo-dl="${item.id}">下载</button>
        ${state.mode === "dir" && !state.dirPending ? `<button type="button" class="ghost-btn" data-memo-path="${item.id}">路径</button>` : ""}
        <button type="button" class="ghost-btn" data-memo-del="${item.id}">删除</button>
      </div>
    </article>`;
  }

  async function hydrateMedia() {
    for (const img of $$("[data-memo-thumb]", itemList)) {
      const id = img.dataset.memoThumb;
      const item = state.index.items.find((x) => x.id === id);
      if (!item) continue;
      try {
        const blob = await loadBlob(item);
        img.src = trackUrl(URL.createObjectURL(blob));
      } catch (_) {
        const tip = state.dirPending ? "需重新连接目录后才能预览" : "预览失败";
        img.replaceWith(Object.assign(document.createElement("p"), { className: "hint tight", textContent: tip }));
      }
    }
    for (const media of $$("[data-memo-media]", itemList)) {
      const id = media.dataset.memoMedia;
      const item = state.index.items.find((x) => x.id === id);
      if (!item) continue;
      try {
        const blob = await loadBlob(item);
        media.src = trackUrl(URL.createObjectURL(blob));
      } catch (_) {
        media.replaceWith(
          Object.assign(document.createElement("p"), {
            className: "hint tight",
            textContent: state.dirPending ? "需重新连接目录后才能播放" : "无法加载媒体",
          })
        );
      }
    }
  }

  function renderItems() {
    if (!itemList) return;
    revokeTrackedUrls();
    const items = visibleItems();
    if (!items.length) {
      const emptyTip =
        state.activeTagId === "all"
          ? "暂无条目。可粘贴、拖入文件或保存文本。"
          : "当前标签下暂无条目。可在此标签下新建，或切回「全部」。";
      itemList.innerHTML = `<p class="hint">${emptyTip}</p>`;
      const batch = $("#memo-batch-del");
      if (batch) batch.disabled = state.selected.size === 0;
      return;
    }
    itemList.innerHTML = items.map(itemCardHtml).join("");
    hydrateMedia().catch(() => {});
    const batch = $("#memo-batch-del");
    if (batch) batch.disabled = state.selected.size === 0;
  }

  function renderAll() {
    renderTags();
    renderItems();
    updateStoreMeta();
  }

  function reindexOrders() {
    state.index.items.forEach((it, i) => {
      it.order = i;
    });
    state.index.tags.forEach((t, i) => {
      t.order = i;
    });
  }

  async function withBusy(fn) {
    if (state.busy) {
      toast("正在处理中，请稍候");
      return null;
    }
    state.busy = true;
    try {
      return await fn();
    } finally {
      state.busy = false;
    }
  }

  async function addItemFromBlob(blob, name, opts = {}) {
    const id = uid();
    const type = opts.type || detectKind(blob.type, name);
    let textPreview = opts.textPreview || "";
    if (type === "text" && !textPreview) {
      try {
        textPreview = await blob.text();
      } catch (_) {
        textPreview = "";
      }
    }
    const quiet = Boolean(opts.quiet);
    if (!quiet) setProgress(true, 0.15, `保存 ${name || type}…`);
    const fileName = await saveBlob(id, blob, `${id}_${safeFileName(name || type)}`);
    if (!quiet) setProgress(true, 0.85, "写入索引…");
    const item = {
      id,
      type,
      name: name || `${type}-${formatTime(Date.now())}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      order: -1,
      tagIds: opts.tagIds || (state.activeTagId !== "all" ? [DEFAULT_TAG_ID, state.activeTagId].filter((id, i, arr) => arr.indexOf(id) === i) : [DEFAULT_TAG_ID]),
      mime: blob.type || "",
      size: blob.size || 0,
      fileName,
      textPreview: type === "text" ? textPreview : "",
    };
    state.index.items.unshift(item);
    reindexOrders();
    await persistIndex();
    if (!quiet) {
      setProgress(false, 0, "");
      renderAll();
      toast("已添加");
    }
    return item;
  }

  async function addText(text) {
    const body = String(text || "").trim();
    if (!body) {
      toast("内容为空");
      return;
    }
    await withBusy(async () => {
      const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
      await addItemFromBlob(blob, `文本-${formatTime(Date.now())}.txt`, { type: "text", textPreview: body });
      if (editor) editor.value = "";
    });
  }

  async function ingestFiles(fileList) {
    const files = [...(fileList || [])].filter(Boolean);
    if (!files.length) return;
    await withBusy(async () => {
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setProgress(true, i / Math.max(1, files.length), `导入 ${f.name}`);
        await addItemFromBlob(f, f.name, { quiet: true });
      }
      setProgress(false, 0, "");
      renderAll();
      toast(files.length > 1 ? `已添加 ${files.length} 个文件` : "已添加");
    });
  }

  async function readClipboard({ force = false } = {}) {
    setError(memoError, "");
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        let got = false;
        const files = [];
        let textBody = "";
        for (const item of items) {
          const types = item.types || [];
          const imgType = types.find((t) => t.startsWith("image/"));
          if (imgType) {
            const blob = await item.getType(imgType);
            const sig = `img:${blob.size}:${imgType}`;
            if (!force && sig === state.lastClipSig) return;
            state.lastClipSig = sig;
            files.push(new File([blob], `剪贴板.${imgType.split("/")[1] || "png"}`, { type: imgType }));
            got = true;
            continue;
          }
          if (types.includes("text/plain")) {
            const blob = await item.getType("text/plain");
            const text = (await blob.text()).trim();
            if (!text) continue;
            const sig = `text:${text.slice(0, 80)}:${text.length}`;
            if (!force && sig === state.lastClipSig) return;
            state.lastClipSig = sig;
            textBody = text;
            got = true;
          }
        }
        if (files.length) await ingestFiles(files);
        else if (textBody) await addText(textBody);
        else if (force) toast("剪贴板无可识别内容（文件请拖拽添加）");
        return;
      }
      if (navigator.clipboard?.readText) {
        const text = (await navigator.clipboard.readText()).trim();
        if (!text) {
          if (force) toast("剪贴板为空");
          return;
        }
        const sig = `text:${text.slice(0, 80)}:${text.length}`;
        if (!force && sig === state.lastClipSig) return;
        state.lastClipSig = sig;
        await addText(text);
        return;
      }
      if (force) toast("当前浏览器不支持读取剪贴板，请用 Ctrl/⌘+V 或右键粘贴");
    } catch (err) {
      if (force) setError(memoError, err.message || "读取剪贴板失败（可改用粘贴快捷键）");
    }
  }

  async function connectDirectory(handle, { isNew = false } = {}) {
    const ok = await ensureDirPermission(handle);
    if (!ok) throw new Error("未获得目录权限");
    const existing = await readIndexFromDir(handle);
    state.dirHandle = handle;
    state.mode = "dir";
    state.dirPending = false;
    if (existing) {
      state.index = existing;
      toast(isNew ? `已恢复目录「${handle.name}」中的备忘录` : `已连接「${handle.name}」`);
    } else if (state.index.items.length) {
      // 空目录：把当前应用内条目写入磁盘
      await writeIndexToDir();
      // 把已有 blob 从 IDB 拷到目录（若有）
      for (const it of state.index.items) {
        try {
          const row = await idbGet("blobs", it.id);
          if (!row?.buf) continue;
          const blob = new Blob([row.buf], { type: row.mime || it.mime || "application/octet-stream" });
          it.fileName = await saveBlob(it.id, blob, it.fileName || `${it.id}_${it.name || "file"}`);
        } catch (_) {
          /* skip missing */
        }
      }
      await writeIndexToDir();
      toast(`已绑定空目录「${handle.name}」，并写入现有条目`);
    } else {
      state.index = emptyIndex();
      await writeIndexToDir();
      toast(`已创建备忘录目录「${handle.name}」`);
    }
    await idbSet("meta", META_KEY, { mode: "dir", folderName: handle.name, folderId: state.index.folderId });
    try {
      await idbSet("meta", "dirHandle", handle);
    } catch (_) {
      /* structured clone may fail on some browsers */
    }
    await idbSet("index", "main", state.index);
    renderAll();
  }

  async function pickDirectory() {
    if (!canDirPicker()) {
      toast("当前环境不支持选择目录，已使用应用内存储");
      return;
    }
    const handle = await window.showDirectoryPicker({ mode: "readwrite" });
    await connectDirectory(handle, { isNew: true });
  }

  async function tryRestoreDirHandle() {
    if (!canDirPicker()) return false;
    try {
      const handle = await idbGet("meta", "dirHandle");
      if (!handle) return false;
      const ok = await ensureDirPermission(handle);
      if (!ok) {
        state.dirHandle = handle;
        state.dirPending = true;
        state.mode = "idb";
        return false;
      }
      await connectDirectory(handle, { isNew: false });
      return true;
    } catch (_) {
      return false;
    }
  }

  async function boot() {
    setError(memoError, "");
    try {
      const saved = await idbGet("index", "main");
      if (saved) state.index = normalizeIndex(saved);
    } catch (_) {
      state.index = emptyIndex();
    }
    const restored = await tryRestoreDirHandle();
    if (!restored && !state.dirPending) state.mode = "idb";
    renderAll();
  }

  async function deleteItems(ids) {
    const list = [...ids];
    if (!list.length) return;
    if (!window.confirm(`确认删除 ${list.length} 条？此操作不可恢复。`)) return;
    for (const id of list) {
      const item = state.index.items.find((x) => x.id === id);
      if (item) await removeBlob(item);
      state.index.items = state.index.items.filter((x) => x.id !== id);
      state.selected.delete(id);
    }
    reindexOrders();
    await persistIndex();
    renderAll();
    toast("已删除");
  }

  async function copyItem(item) {
    try {
      if (item.type === "text") {
        const text = item.textPreview || (await (await loadBlob(item)).text());
        await navigator.clipboard.writeText(text);
        toast("已复制文本");
        return;
      }
      if (item.type === "image" && navigator.clipboard?.write && window.ClipboardItem) {
        const blob = await loadBlob(item);
        const type = blob.type || "image/png";
        await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
        toast("已复制图片");
        return;
      }
      const blob = await loadBlob(item);
      const text = item.type === "text" ? await blob.text() : "";
      if (text) {
        await navigator.clipboard.writeText(text);
        toast("已复制");
      } else {
        toast("此类内容请用下载");
      }
    } catch (err) {
      setError(memoError, err.message || "复制失败");
    }
  }

  function pathHint(item) {
    if (state.mode === "dir" && state.dirHandle) {
      return `${state.dirHandle.name}/${BLOBS_DIR}/${item.fileName || item.id}`;
    }
    return `应用内存储 / ${item.id}`;
  }

  // ---- export / import / share ----
  function openExportDialog() {
    if (!exportDlg || !exportTags) return;
    exportTags.innerHTML = state.index.tags
      .map((t) => `<option value="${escapeHtml(t.id)}">${escapeHtml(t.name)}</option>`)
      .join("");
    $("#memo-export-pass").value = "";
    exportDlg.showModal();
  }

  async function buildExportZip({ kinds, tagIds, password }) {
    if (typeof JSZip !== "function") throw new Error("JSZip 未加载");
    const kindSet = new Set(kinds);
    const tagSet = tagIds?.length ? new Set(tagIds) : null;
    const picked = state.index.items.filter((it) => {
      if (!kindSet.has(it.type)) return false;
      if (!tagSet) return true;
      return (it.tagIds || []).some((id) => tagSet.has(id));
    });
    if (!picked.length) throw new Error("没有符合条件的条目");
    const zip = new JSZip();
    const exportIndex = {
      version: 1,
      exportedAt: Date.now(),
      tags: state.index.tags,
      items: [],
    };
    for (let i = 0; i < picked.length; i++) {
      const it = picked[i];
      setProgress(true, i / picked.length, `打包 ${it.name}`);
      const blob = await loadBlob(it);
      const name = `${BLOBS_DIR}/${it.fileName || it.id}`;
      zip.file(name, blob);
      exportIndex.items.push({ ...it });
    }
    zip.file(INDEX_NAME, JSON.stringify(exportIndex, null, 2));
    let outBlob = await zip.generateAsync({ type: "blob" }, (meta) => {
      setProgress(true, 0.7 + (meta.percent / 100) * 0.25, `压缩… ${Math.round(meta.percent)}%`);
    });
    let filename = `memo-export-${Date.now()}.zip`;
    if (password) {
      const bytes = new Uint8Array(await outBlob.arrayBuffer());
      const enc = await encryptBytes(bytes, password);
      outBlob = new Blob([enc], { type: "application/octet-stream" });
      filename = `memo-export-${Date.now()}.memo`;
    }
    setProgress(false, 0, "");
    return { blob: outBlob, filename, count: picked.length };
  }

  async function openItemPreview(item) {
    if (!item) return;
    if (item.type === "image") {
      const blob = await loadBlob(item);
      if (lightboxImg?.src?.startsWith("blob:")) {
        try {
          URL.revokeObjectURL(lightboxImg.src);
        } catch (_) {}
      }
      lightboxImg.hidden = false;
      lightboxText.hidden = true;
      lightboxImg.src = trackUrl(URL.createObjectURL(blob));
      lightbox?.showModal?.();
      return;
    }
    if (item.type === "text") {
      lightboxImg.hidden = true;
      lightboxText.hidden = false;
      lightboxText.textContent = item.textPreview || (await (await loadBlob(item)).text());
      lightbox?.showModal?.();
      return;
    }
    const blob = await loadBlob(item);
    downloadBlob(blob, item.name || item.id);
  }

  async function doExport({ share = false } = {}) {
    await withBusy(async () => {
      const kinds = $$('#memo-export-dlg input[name="kind"]:checked').map((el) => el.value);
      if (!kinds.length) throw new Error("请至少选择一种类型");
      const tagIds = [...(exportTags?.selectedOptions || [])].map((o) => o.value);
      const password = String($("#memo-export-pass")?.value || "");
      const packed = await buildExportZip({ kinds, tagIds, password });
      if (share && canShareFiles()) {
        const file = new File([packed.blob], packed.filename, { type: packed.blob.type || "application/zip" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: "备忘录导出" });
          toast(`已分享 ${packed.count} 条`);
          return;
        }
        toast("系统不支持直接分享文件，已改为下载");
      }
      downloadBlob(packed.blob, packed.filename);
      toast(`已导出 ${packed.count} 条`);
    });
  }

  async function doImport(file) {
    if (!file) return;
    await withBusy(async () => {
      let zipBlob = file;
      const name = file.name || "";
      const looksEncrypted = /\.memo$/i.test(name);
      const tryLoadZip = async (blob) => {
        if (typeof JSZip !== "function") throw new Error("JSZip 未加载");
        return JSZip.loadAsync(blob);
      };

      let zip;
      try {
        zip = await tryLoadZip(zipBlob);
      } catch (err) {
        if (!looksEncrypted && file.type !== "application/octet-stream") throw err;
        const pass = window.prompt("该文件可能已加密，请输入口令") || "";
        if (!pass) throw new Error("需要口令才能导入加密包");
        try {
          const dec = await decryptBytes(new Uint8Array(await file.arrayBuffer()), pass);
          zipBlob = new Blob([dec], { type: "application/zip" });
          zip = await tryLoadZip(zipBlob);
        } catch (_) {
          throw new Error("解密失败，口令可能不正确");
        }
      }

      const indexFile = zip.file(INDEX_NAME);
      if (!indexFile) throw new Error("不是有效的备忘录导出包");
      const imported = normalizeIndex(JSON.parse(await indexFile.async("string")));
      const tagMap = new Map(state.index.tags.map((t) => [t.id, t]));
      imported.tags.forEach((t) => {
        if (t.id === DEFAULT_TAG_ID) return;
        if (!tagMap.has(t.id)) {
          state.index.tags.unshift({ ...t, order: -1 });
          tagMap.set(t.id, t);
        }
      });
      let importedCount = 0;
      for (let i = 0; i < imported.items.length; i++) {
        const it = imported.items[i];
        setProgress(true, i / Math.max(1, imported.items.length), `导入 ${it.name}`);
        const entry = zip.file(`${BLOBS_DIR}/${it.fileName}`) || zip.file(`${BLOBS_DIR}/${it.id}`);
        if (!entry) continue;
        const blob = await entry.async("blob");
        const typed = blob.type ? blob : new Blob([blob], { type: it.mime || "application/octet-stream" });
        const newId = uid();
        const fileName = await saveBlob(newId, typed, `${newId}_${safeFileName(it.fileName || it.name || "file")}`);
        state.index.items.unshift({
          ...it,
          id: newId,
          fileName,
          createdAt: it.createdAt || Date.now(),
          updatedAt: Date.now(),
          order: -1,
        });
        importedCount += 1;
      }
      reindexOrders();
      await persistIndex();
      setProgress(false, 0, "");
      renderAll();
      toast(importedCount ? `导入完成（${importedCount} 条）` : "导入完成，但未找到可写入的文件");
    });
  }

  // ---- text to image ----
  function wrapText(text, cols) {
    const c = Math.max(4, Number(cols) || 16);
    const lines = [];
    String(text || "")
      .split(/\n/)
      .forEach((line) => {
        if (!line) {
          lines.push("");
          return;
        }
        for (let i = 0; i < line.length; i += c) lines.push(line.slice(i, i + c));
      });
    return lines;
  }

  function paintTextImageCard() {
    const card = $("#memo-ti-card");
    if (!card) return;
    const text = editor?.value || "";
    const cols = Number($("#memo-ti-cols")?.value) || 16;
    const size = Number($("#memo-ti-size")?.value) || 28;
    const bg = $("#memo-ti-bg")?.value || "#0f172a";
    const fg = $("#memo-ti-fg")?.value || "#e8eef8";
    const wm = $("#memo-ti-wm")?.value || "";
    const lines = wrapText(text, cols);
    card.style.backgroundColor = bg;
    card.style.color = fg;
    card.style.fontSize = `${size}px`;
    card.style.backgroundImage = state.bgImageUrl ? `url(${state.bgImageUrl})` : "none";
    card.innerHTML = `<div class="memo-ti-lines">${lines.map((l) => `<div>${escapeHtml(l || " ")}</div>`).join("")}</div>${
      wm ? `<div class="memo-ti-wm">${escapeHtml(wm)}</div>` : ""
    }`;
  }

  async function saveTextImage() {
    await withBusy(async () => {
      const card = $("#memo-ti-card");
      if (!card) return;
      paintTextImageCard();
      if (typeof html2canvas !== "function") throw new Error("html2canvas 未加载");
      setProgress(true, 0.3, "渲染图片…");
      const canvas = await html2canvas(card, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
      });
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("导出失败"))), "image/png");
      });
      await addItemFromBlob(blob, `文字图-${Date.now()}.png`, { type: "image", quiet: true });
      setProgress(false, 0, "");
      renderAll();
      toast("已生成图片");
      $("#memo-toimg").hidden = true;
    });
  }

  // ---- events ----
  $("#memo-pick-dir")?.addEventListener("click", () => {
    pickDirectory().catch((err) => setError(memoError, err.message || String(err)));
  });
  reconnectBtn?.addEventListener("click", () => {
    pickDirectory().catch((err) => setError(memoError, err.message || String(err)));
  });
  $("#memo-file")?.addEventListener("change", (e) => {
    ingestFiles(e.target.files).catch((err) => setError(memoError, err.message || String(err)));
    e.target.value = "";
  });
  $("#memo-save-text")?.addEventListener("click", () => {
    addText(editor?.value || "").catch((err) => setError(memoError, err.message || String(err)));
  });
  $("#memo-read-clip")?.addEventListener("click", () => {
    readClipboard({ force: true }).catch((err) => setError(memoError, err.message || String(err)));
  });
  $("#memo-to-image")?.addEventListener("click", () => {
    $("#memo-toimg").hidden = false;
    paintTextImageCard();
  });
  $("#memo-ti-close")?.addEventListener("click", () => {
    $("#memo-toimg").hidden = true;
  });
  ["memo-ti-cols", "memo-ti-size", "memo-ti-bg", "memo-ti-fg", "memo-ti-wm"].forEach((id) => {
    $(`#${id}`)?.addEventListener("input", paintTextImageCard);
  });
  editor?.addEventListener("input", () => {
    if (!$("#memo-toimg")?.hidden) paintTextImageCard();
  });
  $("#memo-ti-bgimg")?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (state.bgImageUrl) URL.revokeObjectURL(state.bgImageUrl);
    state.bgImageBlob = f;
    state.bgImageUrl = URL.createObjectURL(f);
    paintTextImageCard();
    e.target.value = "";
  });
  $("#memo-ti-bgimg-clear")?.addEventListener("click", () => {
    if (state.bgImageUrl) URL.revokeObjectURL(state.bgImageUrl);
    state.bgImageUrl = "";
    state.bgImageBlob = null;
    paintTextImageCard();
  });
  $("#memo-ti-save")?.addEventListener("click", () => {
    saveTextImage().catch((err) => setError(memoError, err.message || String(err)));
  });

  $("#memo-tag-new")?.addEventListener("click", async () => {
    const name = (window.prompt("新标签名称") || "").trim();
    if (!name) return;
    const exist = state.index.tags.find((t) => t.name === name);
    if (exist) {
      toast(`标签「${name}」已存在`);
      return;
    }
    const id = uid();
    state.index.tags.unshift({ id, name, order: -1 });
    reindexOrders();
    await persistIndex();
    renderAll();
    toast(`已创建标签「${name}」`);
  });

  tagList?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-memo-tag]");
    if (!btn) return;
    state.activeTagId = btn.dataset.memoTag;
    renderAll();
  });

  // tag drag reorder
  let dragTagId = null;
  tagList?.addEventListener("dragstart", (e) => {
    const btn = e.target.closest("[data-memo-tag]");
    if (!btn || btn.dataset.memoTag === "all" || btn.dataset.memoTag === DEFAULT_TAG_ID) {
      e.preventDefault();
      return;
    }
    dragTagId = btn.dataset.memoTag;
    e.dataTransfer.effectAllowed = "move";
  });
  tagList?.addEventListener("dragover", (e) => {
    if (!dragTagId) return;
    e.preventDefault();
  });
  tagList?.addEventListener("drop", async (e) => {
    const btn = e.target.closest("[data-memo-tag]");
    if (!dragTagId || !btn) return;
    e.preventDefault();
    const toId = btn.dataset.memoTag;
    if (!toId || toId === "all" || toId === dragTagId) return;
    const tags = state.index.tags.filter((t) => t.id !== DEFAULT_TAG_ID);
    const def = state.index.tags.find((t) => t.id === DEFAULT_TAG_ID);
    const from = tags.findIndex((t) => t.id === dragTagId);
    const to = tags.findIndex((t) => t.id === toId);
    if (from < 0 || to < 0) return;
    const [row] = tags.splice(from, 1);
    tags.splice(to, 0, row);
    state.index.tags = def ? [def, ...tags] : tags;
    reindexOrders();
    dragTagId = null;
    await persistIndex();
    renderAll();
  });

  itemList?.addEventListener("click", async (e) => {
    const t = e.target;
    try {
      if (t.matches?.("[data-memo-check]")) {
        const id = t.dataset.memoCheck;
        if (t.checked) state.selected.add(id);
        else state.selected.delete(id);
        $("#memo-batch-del").disabled = state.selected.size === 0;
        return;
      }
      const copyId = t.closest?.("[data-memo-copy]")?.dataset?.memoCopy;
      if (copyId) {
        const item = state.index.items.find((x) => x.id === copyId);
        if (item) await copyItem(item);
        return;
      }
      const delId = t.closest?.("[data-memo-del]")?.dataset?.memoDel;
      if (delId) {
        await deleteItems([delId]);
        return;
      }
      const dlId = t.closest?.("[data-memo-dl]")?.dataset?.memoDl;
      if (dlId) {
        const item = state.index.items.find((x) => x.id === dlId);
        if (!item) return;
        const blob = await loadBlob(item);
        downloadBlob(blob, item.name || item.fileName || item.id);
        return;
      }
      const pathId = t.closest?.("[data-memo-path]")?.dataset?.memoPath;
      if (pathId) {
        const item = state.index.items.find((x) => x.id === pathId);
        if (!item) return;
        const tip = pathHint(item);
        try {
          await navigator.clipboard.writeText(tip);
          toast(`路径已复制：${tip}`);
        } catch (_) {
          window.alert(tip);
        }
        return;
      }
      const openId = t.closest?.("[data-memo-open]")?.dataset?.memoOpen;
      if (openId) {
        const item = state.index.items.find((x) => x.id === openId);
        if (item) await openItemPreview(item);
        return;
      }
      const thumbId = t.closest?.("[data-memo-thumb]")?.dataset?.memoThumb;
      if (thumbId) {
        const item = state.index.items.find((x) => x.id === thumbId);
        if (item) await openItemPreview(item);
        return;
      }
      const expandId = t.closest?.("[data-memo-expand]")?.dataset?.memoExpand;
      if (expandId) {
        const item = state.index.items.find((x) => x.id === expandId);
        if (!item) return;
        const el = t.closest("[data-memo-expand]");
        const full = item.textPreview || "";
        if (el.dataset.full === "1") {
          el.textContent = full.length > 160 ? `${full.slice(0, 160)}…` : full;
          el.dataset.full = "0";
        } else {
          el.textContent = full;
          el.dataset.full = "1";
        }
        return;
      }
      const tagAddId = t.closest?.("[data-memo-tag-add]")?.dataset?.memoTagAdd;
      if (tagAddId) {
        const item = state.index.items.find((x) => x.id === tagAddId);
        if (!item) return;
        const names = state.index.tags
          .filter((x) => x.id !== DEFAULT_TAG_ID)
          .map((x) => x.name)
          .join(" / ");
        const raw = window.prompt(`输入标签名（已有：${names || "无"}）。已有同名则复用，否则新建。`, "");
        if (raw == null) return;
        const name = raw.trim();
        if (!name) return;
        let tag = state.index.tags.find((x) => x.name === name);
        if (!tag) {
          const fuzzy = state.index.tags.filter((x) => x.id !== DEFAULT_TAG_ID && x.name.includes(name));
          if (fuzzy.length === 1) tag = fuzzy[0];
        }
        if (!tag) {
          tag = { id: uid(), name, order: -1 };
          state.index.tags.unshift(tag);
          reindexOrders();
        }
        if (!item.tagIds.includes(tag.id)) item.tagIds.push(tag.id);
        item.updatedAt = Date.now();
        await persistIndex();
        renderAll();
      }
    } catch (err) {
      setError(memoError, err.message || String(err));
    }
  });

  $("#memo-select-all")?.addEventListener("change", (e) => {
    const on = e.target.checked;
    visibleItems().forEach((it) => {
      if (on) state.selected.add(it.id);
      else state.selected.delete(it.id);
    });
    renderItems();
  });
  $("#memo-batch-del")?.addEventListener("click", () => {
    deleteItems([...state.selected]).catch((err) => setError(memoError, err.message || String(err)));
  });

  // item drag reorder
  let dragItemId = null;
  itemList?.addEventListener("dragstart", (e) => {
    if (e.target.closest("input, button, a, textarea, video, audio, label")) {
      e.preventDefault();
      return;
    }
    const card = e.target.closest(".memo-card");
    if (!card) return;
    dragItemId = card.dataset.memoId;
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("is-dragging");
  });
  itemList?.addEventListener("dragend", () => {
    $$(".memo-card.is-dragging", itemList).forEach((el) => el.classList.remove("is-dragging"));
    dragItemId = null;
  });
  itemList?.addEventListener("dragover", (e) => {
    if (!dragItemId) return;
    e.preventDefault();
  });
  itemList?.addEventListener("drop", async (e) => {
    const card = e.target.closest(".memo-card");
    if (!dragItemId || !card) return;
    e.preventDefault();
    const toId = card.dataset.memoId;
    if (!toId || toId === dragItemId) return;
    const items = state.index.items;
    const from = items.findIndex((x) => x.id === dragItemId);
    const to = items.findIndex((x) => x.id === toId);
    if (from < 0 || to < 0) return;
    const [row] = items.splice(from, 1);
    items.splice(to, 0, row);
    reindexOrders();
    await persistIndex();
    renderAll();
  });

  // drop files
  const drop = $("#memo-drop");
  drop?.addEventListener("dragover", (e) => {
    if ([...e.dataTransfer.types].includes("Files")) {
      e.preventDefault();
      drop.classList.add("is-drag");
    }
  });
  drop?.addEventListener("dragleave", () => drop.classList.remove("is-drag"));
  drop?.addEventListener("drop", (e) => {
    drop.classList.remove("is-drag");
    if (!e.dataTransfer?.files?.length) return;
    e.preventDefault();
    ingestFiles(e.dataTransfer.files).catch((err) => setError(memoError, err.message || String(err)));
  });

  // Ctrl/⌘+V 与右键粘贴：备忘录激活时识别图片/文件；编辑框内文本走默认粘贴
  document.addEventListener("paste", (e) => {
    if (!isMemoActive()) return;
    const cd = e.clipboardData;
    if (!cd) return;
    const files = [...(cd.files || [])];
    if (files.length) {
      e.preventDefault();
      ingestFiles(files).catch((err) => setError(memoError, err.message || String(err)));
      return;
    }
    const items = [...(cd.items || [])];
    const img = items.find((it) => it.kind === "file" && it.type.startsWith("image/"));
    if (img) {
      e.preventDefault();
      const f = img.getAsFile();
      if (f) ingestFiles([f]).catch((err) => setError(memoError, err.message || String(err)));
      return;
    }
    if (document.activeElement === editor) return;
    const text = cd.getData("text/plain");
    if (text && text.trim()) {
      e.preventDefault();
      addText(text).catch((err) => setError(memoError, err.message || String(err)));
    }
  });

  $("#memo-export")?.addEventListener("click", () => {
    if (shareBtn) shareBtn.dataset.shareAfter = "";
    openExportDialog();
  });
  shareBtn?.addEventListener("click", () => {
    if (shareBtn) shareBtn.dataset.shareAfter = "1";
    openExportDialog();
  });
  exportDlg?.addEventListener("close", () => {
    if (exportDlg.returnValue !== "ok") {
      if (shareBtn) shareBtn.dataset.shareAfter = "";
      return;
    }
    const share = shareBtn?.dataset.shareAfter === "1";
    if (shareBtn) shareBtn.dataset.shareAfter = "";
    doExport({ share })
      .catch((err) => setError(memoError, err.message || String(err)))
      .finally(() => setProgress(false, 0, ""));
  });
  $("#memo-import")?.addEventListener("change", (e) => {
    const f = e.target.files?.[0];
    doImport(f)
      .catch((err) => setError(memoError, err.message || String(err)))
      .finally(() => {
        e.target.value = "";
        setProgress(false, 0, "");
      });
  });
  const closeLightbox = () => {
    if (lightboxImg?.src?.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(lightboxImg.src);
      } catch (_) {}
      lightboxImg.removeAttribute("src");
    }
    lightbox?.close?.();
  };
  $("#memo-lightbox-close")?.addEventListener("click", closeLightbox);
  lightbox?.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  lightbox?.addEventListener("close", () => {
    if (lightboxImg?.src?.startsWith("blob:")) {
      try {
        URL.revokeObjectURL(lightboxImg.src);
      } catch (_) {}
      lightboxImg.removeAttribute("src");
    }
  });

  window.DevToolsMemo = {
    getStorageBytes: estimateStorageBytes,
    getMode: () => state.mode,
    getIndex: () => state.index,
  };

  boot().catch((err) => setError(memoError, err.message || String(err)));
})();
