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
  const PAGE_SIZE = 36;
  const AUTOCLIP_KEY = "devtools-memo-autoclip-v1";
  const LARGE_WARN_BYTES = 25 * 1024 * 1024;
  const SAVE_CHUNK = 1024 * 1024;
  const UNDO_MS = 8000;
  const VIRTUAL_MIN = 64;
  const TEXT_PREVIEW_MAX = 4000;
  const NOTE_MAX = 500;
  const NOTE_CARD_CLIP = 80;
  const CARD_EST_DEFAULT = 210;
  const CARD_EST_NOTE = 28;
  const CARD_EST_BY_TYPE = {
    text: 200,
    image: 268,
    gif: 268,
    video: 292,
    audio: 196,
    file: 176,
  };

  class SaveAbortedError extends Error {
    constructor(msg = "已取消保存") {
      super(msg);
      this.name = "SaveAbortedError";
    }
  }

  function isGifLike(mime, name) {
    const m = String(mime || "").toLowerCase();
    const n = String(name || "").toLowerCase();
    if (m === "image/gif" || m === "image/apng") return true;
    if (/\.(gif|apng)$/.test(n)) return true;
    return false;
  }

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
      if (!Array.isArray(it.tagIds)) it.tagIds = [];
      const custom = it.tagIds.filter((id) => id && id !== DEFAULT_TAG_ID);
      // 有自定义标签则不属于默认；无标签才归默认
      it.tagIds = custom.length ? custom : [DEFAULT_TAG_ID];
      if (it.order == null) it.order = i;
      // 历史图片中的 GIF/APNG 归入动图
      if (it.type === "image" && isGifLike(it.mime, it.name || it.fileName)) it.type = "gif";
      if (!it.type) it.type = detectKind(it.mime, it.name || it.fileName);
      const note = String(it.note || "").trim();
      if (note) it.note = note.length > NOTE_MAX ? `${note.slice(0, NOTE_MAX)}…` : note;
      else delete it.note;
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
    if (isGifLike(m, n)) return "gif";
    if (m.startsWith("image/") || /\.(png|jpe?g|webp|bmp|svg|heic|avif)$/.test(n)) return "image";
    if (m.startsWith("video/") || /\.(mp4|webm|mov|m4v|mkv|avi)$/.test(n)) return "video";
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
    activeType: "all", // all | text | image | gif | video | audio | file
    searchQuery: "",
    listLimit: PAGE_SIZE,
    autoClip: false,
    selected: new Set(),
    lastClipSig: "",
    busy: false,
    objectUrls: new Set(),
    editingId: "",
    noteEditingId: "",
    expandedNotes: new Set(),
    tagTargetId: "",
    flashItemId: "",
    saveAbort: null,
    pendingUndo: null,
    virtualMode: false,
    virtualRaf: 0,
    testShareUi: false,
    cardHeightCache: new Map(),
    shareFilesCapable: null, // null=未探测, true/false
    hashIndex: new Map(), // contentHash -> item ref
    tagMap: new Map(), // tagId -> tag
    countCache: null, // { total, untagged, byTag:Map, byType }
    filterCache: { key: "", items: null },
    persistTimer: 0,
    persistWaiters: [],
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
    const pretty = (state.index.items?.length || 0) < 400;
    await writable.write(JSON.stringify(state.index, null, pretty ? 2 : 0));
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

  async function persistIndexNow() {
    await idbSet("index", "main", state.index);
    if (state.mode === "dir") await writeIndexToDir();
  }

  async function persistIndex({ immediate = false } = {}) {
    const large = (state.index.items?.length || 0) >= 800;
    if (immediate || !large) {
      if (state.persistTimer) {
        clearTimeout(state.persistTimer);
        state.persistTimer = 0;
      }
      await persistIndexNow();
      const waiters = state.persistWaiters.splice(0);
      waiters.forEach((w) => w.resolve());
      return;
    }
    return new Promise((resolve, reject) => {
      state.persistWaiters.push({ resolve, reject });
      clearTimeout(state.persistTimer);
      state.persistTimer = setTimeout(() => {
        state.persistTimer = 0;
        const waiters = state.persistWaiters.splice(0);
        persistIndexNow()
          .then(() => waiters.forEach((w) => w.resolve()))
          .catch((err) => waiters.forEach((w) => w.reject(err)));
      }, 360);
    });
  }

  function flushPersistSync() {
    if (!state.persistTimer && !state.persistWaiters.length) return;
    clearTimeout(state.persistTimer);
    state.persistTimer = 0;
    // 关页时尽量落盘；异步交易可能来不及完成，但比丢 debounce 强
    persistIndexNow().catch(() => {});
    const waiters = state.persistWaiters.splice(0);
    waiters.forEach((w) => w.resolve());
  }

  function concatArrayBuffers(parts) {
    const total = parts.reduce((n, p) => n + (p?.byteLength || 0), 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const part of parts) {
      out.set(new Uint8Array(part), offset);
      offset += part.byteLength;
    }
    return out.buffer;
  }

  async function writeBlobChunked(blob, writeChunk, { onProgress, signal } = {}) {
    const total = blob.size || 0;
    let written = 0;
    const report = () => {
      if (typeof onProgress === "function") onProgress(written, total);
    };
    const check = () => {
      if (signal?.aborted) throw new SaveAbortedError();
    };
    check();
    report();
    if (!total) {
      await writeChunk(new Blob([]));
      report();
      return;
    }
    let offset = 0;
    while (offset < total) {
      check();
      const end = Math.min(offset + SAVE_CHUNK, total);
      await writeChunk(blob.slice(offset, end));
      offset = end;
      written = offset;
      report();
    }
    check();
  }

  async function saveBlob(id, blob, fileName, { onProgress, signal } = {}) {
    const safe = safeFileName(fileName || id, id);
    if (state.mode === "dir" && state.dirHandle) {
      const ok = await ensureDirPermission(state.dirHandle);
      if (!ok) throw new Error("没有目录写入权限，请重新连接目录");
      const dir = await getBlobsDir(true);
      const handle = await dir.getFileHandle(safe, { create: true });
      const writable = await handle.createWritable();
      try {
        await writeBlobChunked(
          blob,
          async (chunk) => {
            await writable.write(chunk);
          },
          { onProgress, signal }
        );
        await writable.close();
      } catch (err) {
        try {
          await writable.abort?.();
        } catch (_) {}
        try {
          await dir.removeEntry(safe);
        } catch (_) {}
        throw err;
      }
      return safe;
    }
    const chunks = [];
    await writeBlobChunked(
      blob,
      async (chunk) => {
        chunks.push(await chunk.arrayBuffer());
      },
      { onProgress, signal }
    );
    const buf = chunks.length === 1 ? chunks[0] : concatArrayBuffers(chunks);
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
    // 万级体量：用索引里的 size 汇总，避免逐条读 IDB/目录文件
    let total = 0;
    const n = state.index.items?.length || 0;
    try {
      if (n < 500) {
        total += new TextEncoder().encode(JSON.stringify(state.index || {})).length;
      } else {
        // 粗估索引体积，避免大 JSON.stringify 卡住主线程
        total += n * 220 + (state.index.tags?.length || 0) * 48 + 2048;
        for (const it of state.index.items) {
          const prev = it.textPreview;
          if (prev) total += Math.min(String(prev).length, 4000);
        }
      }
    } catch (_) {}
    for (const it of state.index.items || []) {
      total += Number(it.size) || 0;
    }
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
  const exportBtn = $("#memo-export");
  const exportOkBtn = $("#memo-export-ok");
  const reconnectBtn = $("#memo-reconnect");
  const exportDlg = $("#memo-export-dlg");
  const exportTags = $("#memo-export-tags");
  const lightbox = $("#memo-lightbox");
  const lightboxImg = $("#memo-lightbox-img");
  const lightboxText = $("#memo-lightbox-text");
  const lightboxVideo = $("#memo-lightbox-video");
  const lightboxAudio = $("#memo-lightbox-audio");
  const lightboxAudioWrap = $("#memo-preview-audio-wrap");
  const lightboxFrame = $("#memo-lightbox-frame");
  const lightboxFile = $("#memo-preview-file");
  const previewTitle = $("#memo-preview-title");
  const previewSub = $("#memo-preview-sub");
  const previewFsBtn = $("#memo-preview-fs");
  const previewNewTabBtn = $("#memo-preview-newtab");
  const previewDlBtn = $("#memo-preview-dl");
  const previewShareBtn = $("#memo-preview-share");
  const previewEditBtn = $("#memo-preview-edit");
  const previewNoteBtn = $("#memo-preview-note");
  let previewObjectUrl = "";
  let previewBlob = null;
  let previewItem = null;

  function setProgress(visible, ratio, text, { cancellable = false } = {}) {
    if (!progressEl) return;
    progressEl.hidden = !visible;
    const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
    if (progressFill) progressFill.style.width = `${pct}%`;
    if (progressPct) progressPct.textContent = `${pct}%`;
    if (progressText) progressText.textContent = text || `${pct}%`;
    const cancelBtn = $("#memo-progress-cancel");
    if (cancelBtn) cancelBtn.hidden = !visible || !cancellable;
  }

  function beginSaveAbort() {
    try {
      state.saveAbort?.abort?.();
    } catch (_) {}
    state.saveAbort = typeof AbortController === "function" ? new AbortController() : null;
    return state.saveAbort?.signal || null;
  }

  function endSaveAbort() {
    state.saveAbort = null;
    const cancelBtn = $("#memo-progress-cancel");
    if (cancelBtn) cancelBtn.hidden = true;
  }

  function confirmLargeBlob(blob, name) {
    const size = blob?.size || 0;
    if (size < LARGE_WARN_BYTES) return true;
    const storeTip =
      state.mode === "dir"
        ? "写入可能较慢，可随时点取消。"
        : "应用内存储空间有限，大文件更建议先「选择存储目录」。";
    return window.confirm(`「${name || "文件"}」约 ${formatBytes(size)}，体积较大。\n${storeTip}\n是否继续？`);
  }

  function canShareFiles() {
    return typeof navigator.share === "function" && typeof navigator.canShare === "function";
  }

  /** 手机端优先分享；桌面端下载。是否具备文件分享能力再二次确认。 */
  function preferShareExport() {
    return isLikelyMobile() && canShareFiles();
  }

  function syncExportButtonLabels() {
    const share = preferShareExport();
    if (exportBtn) {
      exportBtn.textContent = share ? "导出并分享" : "导出";
      exportBtn.title = share
        ? "打包后调起系统分享（可发到其它 App / 存到文件）"
        : "打包下载到本地";
    }
    if (exportOkBtn) exportOkBtn.textContent = share ? "导出并分享" : "导出";
  }

  function updateStoreMeta() {
    if (!storeMeta) return;
    syncExportButtonLabels();
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
    const banner = $("#memo-reconnect-banner");
    if (banner) banner.hidden = !state.dirPending;
    if (state.dirPending && state.dirHandle) {
      storeMeta.textContent = `曾绑定目录「${state.dirHandle.name}」，连接已失效。请重新连接同一路径以恢复。`;
    } else if (state.mode === "dir" && state.dirHandle) {
      storeMeta.textContent = `存储：磁盘目录「${state.dirHandle.name}」· 清缓存不会删目录内文件；若连接丢失请重新选择同一目录即可恢复。`;
    } else {
      storeMeta.textContent = canDirPicker()
        ? "存储：应用内数据（IndexedDB）。建议选择目录以便清缓存后文件仍在磁盘上。清理缓存前仍建议导出备份。"
        : "存储：应用内数据（手机端）。清理缓存前请先「导出」备份（会优先调起系统分享）。";
    }
    window.DevToolsTemp?.refresh?.();
  }

  function customTagIds(item) {
    return (item?.tagIds || []).filter((id) => id && id !== DEFAULT_TAG_ID);
  }

  function isUntagged(item) {
    return customTagIds(item).length === 0;
  }

  function ensureTagMembership(item) {
    if (!item) return;
    const custom = customTagIds(item);
    item.tagIds = custom.length ? custom : [DEFAULT_TAG_ID];
  }

  function rebuildTagMap() {
    state.tagMap = new Map((state.index.tags || []).map((t) => [t.id, t]));
  }

  function invalidateCountCache() {
    state.countCache = null;
    invalidateFilterCache();
  }

  function invalidateFilterCache() {
    state.filterCache = { key: "", items: null };
  }

  function filterCacheKey(type, tagId, query) {
    return `${type || "all"}|${tagId || "all"}|${String(query || "").trim().toLowerCase()}`;
  }

  function ensureCountCache() {
    if (state.countCache) return state.countCache;
    const byTag = new Map();
    const byType = { text: 0, image: 0, gif: 0, video: 0, audio: 0, file: 0 };
    let untagged = 0;
    const items = state.index.items || [];
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const tk = byType[it.type] != null ? it.type : "file";
      byType[tk] += 1;
      const custom = customTagIds(it);
      if (!custom.length) untagged += 1;
      else {
        for (let j = 0; j < custom.length; j++) {
          const id = custom[j];
          byTag.set(id, (byTag.get(id) || 0) + 1);
        }
      }
    }
    state.countCache = {
      total: items.length,
      untagged,
      byTag,
      byType,
    };
    return state.countCache;
  }

  const TYPE_LABELS = {
    text: "文本",
    image: "图片",
    gif: "动图",
    video: "视频",
    audio: "音频",
    file: "文件",
  };

  function itemMatchesSearch(item, q) {
    if (!q) return true;
    // 限制正文参与长度，避免万级长文本搜索卡顿
    const preview = item.textPreview ? String(item.textPreview).slice(0, 1200) : "";
    const tagNames = (item.tagIds || [])
      .map((id) => state.tagMap.get(id)?.name || id)
      .filter(Boolean)
      .join("\n");
    const hay = `${item.name || ""}\n${item.fileName || ""}\n${item.mime || ""}\n${item.note || ""}\n${preview}\n${
      TYPE_LABELS[item.type] || ""
    }\n${item.type || ""}\n${tagNames}`.toLowerCase();
    return hay.includes(q);
  }

  function filterItems({ type = state.activeType, tagId = state.activeTagId, query = state.searchQuery } = {}) {
    // items 数组本身按 order 排列，不再每次 sort
    const src = state.index.items || [];
    const q = String(query || "").trim().toLowerCase();
    const out = [];
    const tagAll = !tagId || tagId === "all";
    const tagDefault = tagId === DEFAULT_TAG_ID || tagId === "default";
    for (let i = 0; i < src.length; i++) {
      const it = src[i];
      if (tagDefault) {
        if (!isUntagged(it)) continue;
      } else if (!tagAll) {
        if (!customTagIds(it).includes(tagId)) continue;
      }
      if (q && !itemMatchesSearch(it, q)) continue;
      if (type !== "all" && it.type !== type) continue;
      out.push(it);
    }
    return out;
  }

  function visibleItems() {
    const key = filterCacheKey(state.activeType, state.activeTagId, state.searchQuery);
    if (state.filterCache.key === key && Array.isArray(state.filterCache.items)) {
      return state.filterCache.items;
    }
    const items = filterItems();
    state.filterCache = { key, items };
    return items;
  }

  function canDragReorder() {
    // 虚拟列表下远距离拖拽不可靠；量大时关闭卡片拖拽
    return (state.index.items?.length || 0) < VIRTUAL_MIN;
  }

  function hasActiveFilters() {
    return Boolean(
      String(state.searchQuery || "").trim() ||
        state.activeType !== "all" ||
        (state.activeTagId && state.activeTagId !== "all")
    );
  }

  function syncFilterChrome() {
    const clearBtn = $("#memo-clear-filters");
    if (clearBtn) clearBtn.hidden = !hasActiveFilters();
    const hint = $("#memo-filter-hint");
    if (!hint) return;
    const parts = [];
    if (state.activeTagId === "all") parts.push("标签：全部");
    else if (state.activeTagId === DEFAULT_TAG_ID || state.activeTagId === "default") parts.push("标签：未分类");
    else parts.push(`标签：${tagById(state.activeTagId)?.name || "已选"}`);
    parts.push(`类型：${state.activeType === "all" ? "全部" : TYPE_LABELS[state.activeType] || state.activeType}`);
    const q = String(state.searchQuery || "").trim();
    if (q) parts.push(`关键词：「${q}」`);
    hint.textContent = `${parts.join(" · ")}。点左侧标签、下方类型即可筛选；直接搜标签名也行。`;
  }

  function clearAllFilters() {
    state.searchQuery = "";
    state.activeType = "all";
    state.activeTagId = "all";
    const search = $("#memo-search");
    if (search) search.value = "";
    resetListPaging();
    renderAll();
    toast("已清除筛选");
  }

  function textContentSig(text) {
    return `text:${String(text || "").trim()}`;
  }

  function blobContentSig(blob, type) {
    const t = type || detectKind(blob?.type, blob?.name);
    return `bin:${t}:${blob?.size || 0}:${blob?.type || ""}`;
  }

  function bytesToHex(buf) {
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  async function hashBlobPartial(blob) {
    if (!blob || !crypto?.subtle?.digest) return "";
    const size = blob.size || 0;
    const headLen = Math.min(65536, size);
    const tailStart = Math.max(headLen, size - Math.min(65536, size));
    const parts = [new TextEncoder().encode(`${size}|${blob.type || ""}|`)];
    if (headLen > 0) parts.push(new Uint8Array(await blob.slice(0, headLen).arrayBuffer()));
    if (tailStart < size) parts.push(new Uint8Array(await blob.slice(tailStart, size).arrayBuffer()));
    const total = parts.reduce((n, p) => n + p.length, 0);
    const merged = new Uint8Array(total);
    let o = 0;
    for (const p of parts) {
      merged.set(p, o);
      o += p.length;
    }
    return bytesToHex(await crypto.subtle.digest("SHA-256", merged));
  }

  function itemContentSig(item) {
    if (!item) return "";
    if (item.contentHash) return `hash:${item.contentHash}`;
    if (item.type === "text") return textContentSig(item.textPreview || "");
    return `bin:${item.type}:${item.size || 0}:${item.mime || ""}`;
  }

  function rememberHash(item) {
    if (item?.contentHash) state.hashIndex.set(item.contentHash, item);
  }

  function forgetHash(item) {
    if (!item?.contentHash) return;
    if (state.hashIndex.get(item.contentHash) === item) state.hashIndex.delete(item.contentHash);
  }

  function rebuildHashIndex() {
    state.hashIndex = new Map();
    for (const it of state.index.items) rememberHash(it);
  }

  function findDuplicateBySig(coarseSig, contentHash) {
    // contentHash：Map O(1) 存条目引用；无 hash 的旧条目才走线性粗匹配
    if (contentHash) {
      const byMap = state.hashIndex.get(contentHash);
      if (byMap) return byMap;
    }
    if (!coarseSig || coarseSig === "text:" || /^bin:\w+:0:/.test(coarseSig)) return null;
    for (const it of state.index.items) {
      if (itemContentSig(it) === coarseSig) return it;
      if (!it.contentHash) {
        const legacy =
          it.type === "text"
            ? textContentSig(it.textPreview || "")
            : `bin:${it.type}:${it.size || 0}:${it.mime || ""}`;
        if (legacy === coarseSig) return it;
      }
    }
    return null;
  }

  function clipTextPreview(text) {
    const s = String(text || "");
    if (s.length <= TEXT_PREVIEW_MAX) return s;
    return `${s.slice(0, TEXT_PREVIEW_MAX)}…`;
  }

  function clipNote(text) {
    const s = String(text || "").trim();
    if (!s) return "";
    if (s.length <= NOTE_MAX) return s;
    return `${s.slice(0, NOTE_MAX)}…`;
  }

  async function bumpItemToFront(item) {
    if (!item?.id) return { item: null, moved: false };
    const idx = state.index.items.findIndex((x) => x.id === item.id);
    if (idx < 0) return { item: null, moved: false };
    let moved = false;
    if (idx > 0) {
      const [row] = state.index.items.splice(idx, 1);
      state.index.items.unshift(row);
      moved = true;
    }
    const row = state.index.items[0];
    row.updatedAt = Date.now();
    if (item.contentHash && !row.contentHash) {
      row.contentHash = item.contentHash;
      rememberHash(row);
    }
    reindexOrders();
    await persistIndex();
    return { item: row, moved };
  }

  function estimateCardHeight(item) {
    if (item?.id && state.cardHeightCache.has(item.id)) {
      return state.cardHeightCache.get(item.id);
    }
    let h = CARD_EST_BY_TYPE[item?.type] || CARD_EST_DEFAULT;
    const hasNote = String(item?.note || "").trim();
    if (hasNote || (item?.type && item.type !== "text")) h += CARD_EST_NOTE;
    return h;
  }

  function buildHeightPrefix(items) {
    const prefix = new Array(items.length + 1);
    prefix[0] = 0;
    for (let i = 0; i < items.length; i++) {
      prefix[i + 1] = prefix[i] + estimateCardHeight(items[i]);
    }
    return prefix;
  }

  function indexAtOffset(prefix, offset) {
    let lo = 0;
    let hi = Math.max(0, prefix.length - 2);
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (prefix[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }

  function measureVisibleCardHeights() {
    if (!itemList) return false;
    let changed = false;
    $$(".memo-card", itemList).forEach((card) => {
      const id = card.dataset.memoId;
      if (!id) return;
      const h = Math.round(card.getBoundingClientRect().height);
      if (h < 48) return;
      if (state.cardHeightCache.get(id) !== h) {
        state.cardHeightCache.set(id, h);
        changed = true;
      }
    });
    return changed;
  }

  function flashItem(id, msg) {
    if (msg) toast(msg);
    state.flashItemId = id || "";
    // 入库后回到「全能看见」的视图，避免被筛选挡住
    state.searchQuery = "";
    state.activeType = "all";
    state.activeTagId = "all";
    const search = $("#memo-search");
    if (search) search.value = "";
    resetListPaging();
    renderAll();
    requestAnimationFrame(() => {
      const items = visibleItems();
      const idx = items.findIndex((x) => x.id === id);
      if (idx >= 0 && items.length >= VIRTUAL_MIN) {
        paintVirtualWindow(items, { force: true, preferId: id });
        const prefix = buildHeightPrefix(items);
        const listTop = itemList.getBoundingClientRect().top + window.scrollY;
        const targetY = Math.max(0, listTop + prefix[idx] - 72);
        window.scrollTo({ top: targetY, behavior: "smooth" });
      }
      requestAnimationFrame(() => {
        const card = itemList?.querySelector?.(`.memo-card[data-memo-id="${id}"]`) || null;
        if (!card) {
          state.flashItemId = "";
          return;
        }
        card.classList.add("is-just-saved");
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
        setTimeout(() => card.classList.remove("is-just-saved"), 1800);
        state.flashItemId = "";
      });
    });
  }

  function renderTypeFilter() {
    const host = $("#memo-type-filter");
    if (!host) return;
    const q = String(state.searchQuery || "").trim();
    const tagAll = !state.activeTagId || state.activeTagId === "all";
    let total;
    let counts;
    if (tagAll && !q) {
      const cache = ensureCountCache();
      total = cache.total;
      counts = cache.byType;
    } else {
      counts = { text: 0, image: 0, gif: 0, video: 0, audio: 0, file: 0 };
      const pool = filterItems({ type: "all" });
      total = pool.length;
      for (let i = 0; i < pool.length; i++) {
        const k = counts[pool[i].type] != null ? pool[i].type : "file";
        counts[k] += 1;
      }
    }
    const mk = (type, label, n) =>
      `<button type="button" class="memo-type-chip${state.activeType === type ? " is-active" : ""}" data-memo-type="${type}">${label}<span class="mono">${n}</span></button>`;
    host.innerHTML = [
      mk("all", "全部", total),
      mk("text", "文本", counts.text || 0),
      mk("image", "图片", counts.image || 0),
      mk("gif", "动图", counts.gif || 0),
      mk("video", "视频", counts.video || 0),
      mk("audio", "音频", counts.audio || 0),
      mk("file", "文件", counts.file || 0),
    ].join("");
  }

  function resetListPaging() {
    state.listLimit = PAGE_SIZE;
  }

  function tagById(id) {
    return state.tagMap.get(id) || state.index.tags.find((t) => t.id === id);
  }

  function renderTags() {
    if (!tagList) return;
    const cache = ensureCountCache();
    const tags = state.index.tags || [];
    const bits = [
      `<div class="memo-tag-row"><button type="button" class="memo-tag-item${state.activeTagId === "all" ? " is-active" : ""}" data-memo-tag="all" draggable="false">全部<span class="mono memo-tag-count">${cache.total}</span></button></div>`,
    ];
    for (let i = 0; i < tags.length; i++) {
      const t = tags[i];
      const count = t.id === DEFAULT_TAG_ID ? cache.untagged : cache.byTag.get(t.id) || 0;
      const label = t.id === DEFAULT_TAG_ID ? "默认（未分类）" : t.name;
      const canDel = t.id !== DEFAULT_TAG_ID;
      const delBtn = canDel
        ? `<button type="button" class="ghost-btn memo-tag-del" data-memo-tag-del="${escapeHtml(t.id)}" title="删除标签（不删条目）" aria-label="删除标签 ${escapeHtml(label)}">删除</button>`
        : "";
      bits.push(
        `<div class="memo-tag-row${state.activeTagId === t.id ? " is-active-row" : ""}">
          <button type="button" class="memo-tag-item${state.activeTagId === t.id ? " is-active" : ""}" data-memo-tag="${escapeHtml(t.id)}" draggable="${canDel ? "true" : "false"}">${escapeHtml(label)}<span class="mono memo-tag-count">${count}</span></button>
          ${delBtn}
        </div>`
      );
    }
    tagList.innerHTML = bits.join("");
    syncTagsToggle();
  }

  async function deleteTag(tagId) {
    if (!tagId || tagId === DEFAULT_TAG_ID || tagId === "all") {
      toast("默认标签不能删除");
      return;
    }
    const tag = tagById(tagId);
    if (!tag) {
      toast("标签不存在");
      return;
    }
    const linked = state.index.items.filter((it) => customTagIds(it).includes(tagId)).length;
    const ok = window.confirm(
      linked
        ? `删除标签「${tag.name}」？\n不会删除任何条目，只会去掉该标签。\n若条目因此没有其它自定义标签，会回到「默认」。\n当前约有 ${linked} 条关联。`
        : `删除标签「${tag.name}」？\n不会删除任何条目。`
    );
    if (!ok) return;

    for (const it of state.index.items) {
      if (!Array.isArray(it.tagIds) || !it.tagIds.includes(tagId)) continue;
      it.tagIds = it.tagIds.filter((id) => id !== tagId);
      ensureTagMembership(it);
      it.updatedAt = Date.now();
    }
    state.index.tags = state.index.tags.filter((t) => t.id !== tagId);
    if (state.activeTagId === tagId) state.activeTagId = "all";
    reindexOrders();
    rebuildTagMap();
    invalidateCountCache();
    await persistIndex({ immediate: true });
    renderAll();
    toast(`已删除标签「${tag.name}」`);
  }

  async function removeTagFromItem(itemId, tagId) {
    const item = state.index.items.find((x) => x.id === itemId);
    if (!item || !tagId || tagId === DEFAULT_TAG_ID) return;
    if (!item.tagIds?.includes(tagId)) return;
    item.tagIds = item.tagIds.filter((id) => id !== tagId);
    ensureTagMembership(item);
    item.updatedAt = Date.now();
    invalidateCountCache();
    await persistIndex({ immediate: true });
    renderAll();
    const name = tagById(tagId)?.name || "标签";
    toast(`已从条目移除「${name}」`);
  }

  function syncTagsToggle() {
    const aside = $("#memo-tags-aside");
    const toggle = $("#memo-tags-toggle");
    if (!toggle) return;
    let label = "标签筛选";
    if (state.activeTagId === DEFAULT_TAG_ID) label = "标签：默认";
    else if (state.activeTagId && state.activeTagId !== "all") {
      const name = tagById(state.activeTagId)?.name;
      if (name) label = `标签：${name}`;
    }
    const open = aside?.classList.contains("is-open");
    toggle.textContent = open ? `${label} · 收起` : label;
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
  }

  function itemCardHtml(item) {
    const checked = state.selected.has(item.id) ? "checked" : "";
    const tags = (item.tagIds || [])
      .filter((id) => id !== DEFAULT_TAG_ID)
      .map((id) => ({ id, name: tagById(id)?.name || id }))
      .filter((t) => t.name);
    const tagHtml = tags
      .map(
        (t) =>
          `<button type="button" class="memo-chip" data-memo-chip-rm="${item.id}" data-memo-chip-tag="${escapeHtml(t.id)}" title="点此移除标签">${escapeHtml(t.name)} ×</button>`
      )
      .join("");
    const title = escapeHtml(item.name || item.type || "条目");
    const time = formatTime(item.createdAt);
    const size = formatBytes(item.size || 0);
    const typeLabel = TYPE_LABELS[item.type] || item.type || "文件";
    const noteRaw = String(item.note || "").trim();
    const wantsNoteHint = !noteRaw && item.type !== "text";
    let noteHtml = "";
    if (noteRaw) {
      const expanded = state.expandedNotes.has(item.id);
      const long = noteRaw.length > NOTE_CARD_CLIP;
      const shown = !long || expanded ? noteRaw : `${noteRaw.slice(0, NOTE_CARD_CLIP)}…`;
      noteHtml = `<div class="memo-card-note-wrap">
        <button type="button" class="memo-card-note" data-memo-note="${item.id}" title="点击编辑备注">${escapeHtml(shown)}</button>
        ${
          long
            ? `<button type="button" class="ghost-btn memo-note-expand" data-memo-note-expand="${item.id}">${
                expanded ? "收起" : "展开"
              }</button>`
            : ""
        }
      </div>`;
    } else if (wantsNoteHint) {
      noteHtml = `<button type="button" class="memo-card-note is-empty" data-memo-note="${item.id}">添加备注…</button>`;
    }
    let body = "";
    if (item.type === "text") {
      const full = item.textPreview || "";
      const short = full.length > 160 ? `${full.slice(0, 160)}…` : full;
      body = `<pre class="memo-text mono" data-memo-expand="${item.id}">${escapeHtml(short)}</pre>`;
    } else if (item.type === "image" || item.type === "gif") {
      const badge = item.type === "gif" ? `<span class="memo-anim-badge">动图</span>` : "";
      body = `<div class="memo-thumb-wrap memo-media-hit" data-memo-preview="${item.id}">${badge}<img class="memo-thumb" data-memo-thumb="${item.id}" alt="" loading="lazy" decoding="async" /></div>`;
    } else if (item.type === "video") {
      body = `<div class="memo-media-hit" data-memo-preview="${item.id}"><video class="memo-media" data-memo-media="${item.id}" muted playsinline preload="none"></video></div>`;
    } else if (item.type === "audio") {
      body = `<button type="button" class="memo-audio-hit" data-memo-preview="${item.id}">
        <span class="memo-audio-hit-icon" aria-hidden="true">♪</span>
        <span class="memo-audio-hit-meta">
          <strong>${title}</strong>
          <span class="hint tight">点击完整预览 / 播放</span>
        </span>
      </button>`;
    } else {
      body = `<button type="button" class="memo-file-hit" data-memo-preview="${item.id}">
        <strong class="mono">${escapeHtml(item.mime || "文件")}</strong>
        <span class="hint tight">点击预览或下载</span>
      </button>`;
    }
    const editing = state.editingId === item.id ? " is-editing" : "";
    const canCopy = canClipboardCopy(item);
    const offerShare = canOfferItemShare(item);
    let primaryAction = "";
    let secondaryShare = "";
    let moreDownload = "";
    if (!canCopy && offerShare) {
      primaryAction = `<button type="button" class="secondary-btn" data-memo-share="${item.id}">分享</button>`;
      moreDownload = `<button type="button" class="ghost-btn" data-memo-dl="${item.id}">下载</button>`;
    } else if (!canCopy) {
      primaryAction = `<button type="button" class="secondary-btn" data-memo-dl="${item.id}">下载</button>`;
    } else {
      primaryAction = `<button type="button" class="secondary-btn" data-memo-copy="${item.id}">复制</button>`;
      if (offerShare) {
        secondaryShare = `<button type="button" class="ghost-btn" data-memo-share="${item.id}">分享</button>`;
      }
      moreDownload = `<button type="button" class="ghost-btn" data-memo-dl="${item.id}">下载</button>`;
    }
    return `<article class="memo-card${editing}" data-memo-id="${item.id}" draggable="${canDragReorder() ? "true" : "false"}">
      <div class="memo-card-head">
        <label class="memo-check"><input type="checkbox" data-memo-check="${item.id}" ${checked} /></label>
        <div class="memo-card-meta">
          <strong title="${title}">${title}</strong>
          <span class="hint tight mono"><span class="memo-type-pill">${escapeHtml(typeLabel)}</span> · ${time} · ${size}</span>
        </div>
      </div>
      <div class="memo-card-body">${body}</div>
      ${noteHtml}
      <div class="memo-card-tags">${tagHtml}<button type="button" class="ghost-btn memo-tag-add" data-memo-tag-add="${item.id}">+ 标签</button></div>
      <div class="btn-row memo-card-actions">
        ${primaryAction}
        ${secondaryShare}
        <button type="button" class="ghost-btn" data-memo-open="${item.id}">预览</button>
        ${item.type === "text" ? `<button type="button" class="ghost-btn" data-memo-edit="${item.id}">编辑</button>` : ""}
        <button type="button" class="secondary-btn" data-memo-note="${item.id}">${noteRaw ? "改备注" : "备注"}</button>
        <details class="memo-more">
          <summary class="ghost-btn memo-more-sum">更多</summary>
          <div class="memo-more-menu" role="menu">
            ${moreDownload}
            ${state.mode === "dir" && !state.dirPending ? `<button type="button" class="ghost-btn" data-memo-path="${item.id}">路径</button>` : ""}
            <button type="button" class="ghost-btn" data-memo-del="${item.id}">删除</button>
          </div>
        </details>
      </div>
    </article>`;
  }

  let mediaObserver = null;
  function stopMediaObserver() {
    if (mediaObserver) {
      mediaObserver.disconnect();
      mediaObserver = null;
    }
  }

  async function hydrateOneMedia(el) {
    if (!el || el.dataset.hydrated === "1") return;
    el.dataset.hydrated = "1";
    const isImg = el.hasAttribute("data-memo-thumb");
    const id = isImg ? el.dataset.memoThumb : el.dataset.memoMedia;
    const item = state.index.items.find((x) => x.id === id);
    if (!item) return;
    try {
      const blob = await loadBlob(item);
      el.src = trackUrl(URL.createObjectURL(blob));
    } catch (_) {
      const tip = state.dirPending ? "需重新连接目录后才能预览" : isImg ? "预览失败" : "无法加载媒体";
      el.replaceWith(Object.assign(document.createElement("p"), { className: "hint tight", textContent: tip }));
    }
  }

  function hydrateMedia() {
    stopMediaObserver();
    const nodes = [...$$("[data-memo-thumb], [data-memo-media]", itemList)];
    if (!nodes.length) return;
    if (typeof IntersectionObserver !== "function") {
      nodes.forEach((el) => {
        hydrateOneMedia(el).catch(() => {});
      });
      return;
    }
    mediaObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const el = entry.target;
          mediaObserver?.unobserve(el);
          hydrateOneMedia(el).catch(() => {});
        });
      },
      { root: null, rootMargin: "160px 0px", threshold: 0.01 }
    );
    nodes.forEach((el) => mediaObserver.observe(el));
  }

  function renderListMeta(total, shown) {
    const meta = $("#memo-list-meta");
    if (!meta) return;
    const q = String(state.searchQuery || "").trim();
    if (!total && !q) {
      meta.hidden = true;
      meta.textContent = "";
      return;
    }
    meta.hidden = false;
    const parts = [`共 ${total} 条`];
    if (shown < total) parts.push(`已显示 ${shown}`);
    if (q) parts.push(`搜索「${q}」`);
    meta.textContent = parts.join(" · ");
  }

  function stopVirtualScroll() {
    if (state.virtualRaf) {
      cancelAnimationFrame(state.virtualRaf);
      state.virtualRaf = 0;
    }
    state.virtualMode = false;
    window.removeEventListener("scroll", onVirtualScroll);
    window.removeEventListener("resize", onVirtualScroll);
  }

  function onVirtualScroll() {
    if (!state.virtualMode) return;
    if (state.virtualRaf) return;
    state.virtualRaf = requestAnimationFrame(() => {
      state.virtualRaf = 0;
      const items = visibleItems();
      if (items.length < VIRTUAL_MIN) {
        renderItems();
        return;
      }
      paintVirtualWindow(items);
    });
  }

  function setupVirtualScroll() {
    stopVirtualScroll();
    state.virtualMode = true;
    window.addEventListener("scroll", onVirtualScroll, { passive: true });
    window.addEventListener("resize", onVirtualScroll);
  }

  function paintVirtualWindow(items, { force = false, preferId = "", skipMeasure = false } = {}) {
    if (!itemList) return;
    const prefix = buildHeightPrefix(items);
    const totalH = prefix[items.length] || 0;
    const listTop = itemList.getBoundingClientRect().top + window.scrollY;
    const viewTop = Math.max(0, window.scrollY + 8 - listTop);
    const viewH = window.innerHeight || 800;
    let start;
    let end;
    const preferIdx = preferId ? items.findIndex((x) => x.id === preferId) : -1;
    if (force && preferIdx >= 0) {
      start = Math.max(0, preferIdx - 8);
      end = Math.min(items.length, preferIdx + 12);
    } else {
      start = Math.max(0, indexAtOffset(prefix, viewTop) - 4);
      end = Math.min(items.length, indexAtOffset(prefix, viewTop + viewH) + 6);
    }
    if (end - start < 16) end = Math.min(items.length, start + 16);
    const topPad = prefix[start] || 0;
    const bottomPad = Math.max(0, totalH - (prefix[end] || 0));
    const slice = items.slice(start, end);
    const prevStart = itemList.dataset.virtStart || "";
    const prevEnd = itemList.dataset.virtEnd || "";
    if (!force && prevStart === String(start) && prevEnd === String(end) && itemList.querySelector(".memo-card")) {
      return;
    }
    stopMediaObserver();
    revokeTrackedUrls();
    itemList.dataset.virtStart = String(start);
    itemList.dataset.virtEnd = String(end);
    itemList.innerHTML = `<div class="memo-virt-spacer" data-memo-virt-top style="height:${topPad}px" aria-hidden="true"></div>${slice
      .map(itemCardHtml)
      .join("")}<div class="memo-virt-spacer" data-memo-virt-bottom style="height:${bottomPad}px" aria-hidden="true"></div>`;
    renderListMeta(items.length, slice.length);
    hydrateMedia();
    const batch = $("#memo-batch-del");
    if (batch) batch.disabled = state.selected.size === 0;
    if (skipMeasure) return;
    requestAnimationFrame(() => {
      if (!state.virtualMode) return;
      if (!measureVisibleCardHeights()) return;
      const next = visibleItems();
      if (next.length < VIRTUAL_MIN) return;
      const keepId = preferId || itemList.querySelector(".memo-card")?.dataset?.memoId || "";
      paintVirtualWindow(next, { force: true, preferId: keepId, skipMeasure: true });
    });
  }

  function syncDropHint() {
    const dropHint = $("#memo-drop > p.hint");
    if (!dropHint) return;
    dropHint.textContent = canDragReorder()
      ? "拖拽文件到此处添加 · 最新在上 · 可拖拽排序 · 滑到底部自动加载更多"
      : "拖拽文件到此处添加 · 最新在上 · 条目较多已关闭拖拽排序，可用筛选/搜索定位";
  }

  function renderItems() {
    if (!itemList) return;
    stopMediaObserver();
    revokeTrackedUrls();
    const items = visibleItems();
    const moreRow = $("#memo-more-row");
    const loadMoreBtn = $("#memo-load-more");
    const sentinel = $("#memo-scroll-sentinel");
    const loadingTip = $("#memo-loading-more");
    syncDropHint();
    if (!items.length) {
      stopVirtualScroll();
      itemList.dataset.virtStart = "";
      itemList.dataset.virtEnd = "";
      let emptyTip = "暂无条目。可粘贴、拖入文件或保存文本。";
      if (state.searchQuery.trim()) {
        emptyTip = `没有匹配「${state.searchQuery.trim()}」的条目。`;
      } else if (state.activeType !== "all" && state.activeTagId !== "all") {
        emptyTip = "当前标签与类型筛选下暂无条目。";
      } else if (state.activeType !== "all") {
        emptyTip = `当前没有「${TYPE_LABELS[state.activeType] || state.activeType}」类型条目。`;
      } else if (state.activeTagId === DEFAULT_TAG_ID) {
        emptyTip = "暂无未分类条目。已加自定义标签的内容会离开「默认」。";
      } else if (state.activeTagId !== "all") {
        emptyTip = "当前标签下暂无条目。可在此标签下新建，或切回「全部」。";
      }
      itemList.innerHTML = `<p class="hint">${emptyTip}</p>`;
      renderListMeta(0, 0);
      if (moreRow) moreRow.hidden = true;
      if (sentinel) sentinel.hidden = true;
      if (loadingTip) loadingTip.hidden = true;
      const batch = $("#memo-batch-del");
      if (batch) batch.disabled = state.selected.size === 0;
      return;
    }

    if (items.length >= VIRTUAL_MIN) {
      if (moreRow) moreRow.hidden = true;
      if (sentinel) sentinel.hidden = true;
      if (loadingTip) loadingTip.hidden = true;
      itemList.dataset.virtStart = "";
      itemList.dataset.virtEnd = "";
      setupVirtualScroll();
      paintVirtualWindow(items);
      return;
    }

    stopVirtualScroll();
    itemList.dataset.virtStart = "";
    itemList.dataset.virtEnd = "";
    const limit = Math.max(PAGE_SIZE, state.listLimit || PAGE_SIZE);
    const page = items.slice(0, limit);
    const useGroups =
      state.activeType === "all" && !String(state.searchQuery || "").trim() && items.length <= PAGE_SIZE;
    if (useGroups) {
      const order = ["text", "image", "gif", "video", "audio", "file"];
      const groups = order
        .map((type) => ({ type, items: page.filter((it) => it.type === type) }))
        .filter((g) => g.items.length);
      itemList.innerHTML = groups
        .map(
          (g) =>
            `<section class="memo-type-group" data-memo-type-group="${g.type}">
              <h3 class="memo-type-group-title">${TYPE_LABELS[g.type] || g.type}<span class="mono memo-tag-count">${g.items.length}</span></h3>
              <div class="memo-type-group-list">${g.items.map(itemCardHtml).join("")}</div>
            </section>`
        )
        .join("");
    } else {
      itemList.innerHTML = page.map(itemCardHtml).join("");
    }
    renderListMeta(items.length, page.length);
    if (moreRow) {
      const hasMore = page.length < items.length;
      moreRow.hidden = !hasMore;
      if (loadMoreBtn) loadMoreBtn.textContent = `手动加载更多（还剩 ${Math.max(0, items.length - page.length)}）`;
      if (sentinel) sentinel.hidden = !hasMore;
      if (loadingTip && !hasMore) loadingTip.hidden = true;
    }
    hydrateMedia();
    setupInfiniteScroll();
    const batch = $("#memo-batch-del");
    if (batch) batch.disabled = state.selected.size === 0;
  }

  let infiniteObserver = null;
  let infiniteBusy = false;
  function setupInfiniteScroll() {
    const sentinel = $("#memo-scroll-sentinel");
    if (!sentinel) return;
    if (infiniteObserver) {
      infiniteObserver.disconnect();
      infiniteObserver = null;
    }
    if (sentinel.hidden) return;
    if (typeof IntersectionObserver !== "function") return;
    infiniteObserver = new IntersectionObserver(
      (entries) => {
        const hit = entries.some((e) => e.isIntersecting);
        if (!hit || infiniteBusy) return;
        const items = visibleItems();
        const limit = Math.max(PAGE_SIZE, state.listLimit || PAGE_SIZE);
        if (limit >= items.length) return;
        infiniteBusy = true;
        const tip = $("#memo-loading-more");
        if (tip) tip.hidden = false;
        state.listLimit = limit + PAGE_SIZE;
        renderItems();
        infiniteBusy = false;
      },
      { root: null, rootMargin: "240px 0px", threshold: 0 }
    );
    infiniteObserver.observe(sentinel);
  }

  function tagsForNewItem() {
    if (state.activeTagId && state.activeTagId !== "all" && state.activeTagId !== DEFAULT_TAG_ID) {
      return [state.activeTagId];
    }
    return [DEFAULT_TAG_ID];
  }

  function renderAll() {
    renderTags();
    renderTypeFilter();
    renderItems();
    updateStoreMeta();
    syncFilterChrome();
  }

  function reindexOrders() {
    state.index.items.forEach((it, i) => {
      it.order = i;
    });
    state.index.tags.forEach((t, i) => {
      t.order = i;
    });
    invalidateCountCache();
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
    if (!opts.skipLargeConfirm && !confirmLargeBlob(blob, name || type)) {
      toast("已取消添加");
      return null;
    }
    let contentHash = "";
    try {
      if (type === "text") {
        contentHash = await hashBlobPartial(new Blob([String(textPreview || "").trim()], { type: "text/plain" }));
      } else {
        contentHash = await hashBlobPartial(blob);
      }
    } catch (_) {
      contentHash = "";
    }
    const sig = type === "text" ? textContentSig(textPreview) : blobContentSig(blob, type);
    const dup = findDuplicateBySig(sig, contentHash);
    if (dup) {
      if (contentHash && !dup.contentHash) {
        dup.contentHash = contentHash;
        rememberHash(dup);
      }
      const { item: bumped, moved } = await bumpItemToFront(dup);
      const tip = moved ? "已有相同内容，已移到最前" : "已有相同内容，已在最前";
      if (!quiet) {
        setProgress(false, 0, "");
        flashItem(bumped?.id || dup.id, tip);
      }
      return bumped || dup;
    }
    const id = uid();
    const signal = opts.signal || beginSaveAbort();
    const total = blob.size || 0;
    const cancellable = total >= SAVE_CHUNK;
    try {
      if (!quiet) setProgress(true, 0.02, `保存 ${name || type}…`, { cancellable });
      const fileName = await saveBlob(id, blob, `${id}_${safeFileName(name || type)}`, {
        signal,
        onProgress: (done, all) => {
          if (quiet && all < LARGE_WARN_BYTES) return;
          const ratio = all ? Math.min(0.92, done / all) : 0.5;
          setProgress(true, ratio, `写入 ${name || type}（${formatBytes(done)} / ${formatBytes(all)}）`, {
            cancellable,
          });
        },
      });
      if (!quiet) setProgress(true, 0.96, "写入索引…", { cancellable: false });
      const item = {
        id,
        type,
        name: name || `${type}-${formatTime(Date.now())}`,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        order: -1,
        tagIds: opts.tagIds || tagsForNewItem(),
        mime: blob.type || "",
        size: blob.size || 0,
        fileName,
        textPreview: type === "text" ? clipTextPreview(textPreview) : "",
        contentHash: contentHash || undefined,
      };
      state.index.items.unshift(item);
      rememberHash(item);
      reindexOrders();
      await persistIndex();
      if (!quiet) {
        setProgress(false, 0, "");
        flashItem(item.id, "已添加");
      }
      return item;
    } catch (err) {
      if (err?.name === "SaveAbortedError" || err instanceof SaveAbortedError) {
        setProgress(false, 0, "");
        toast("已取消保存");
        return null;
      }
      throw err;
    } finally {
      if (!opts.signal) endSaveAbort();
    }
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

  function isTextEditOpen() {
    return Boolean($("#memo-text-edit")?.open || $("#memo-note-edit")?.open);
  }

  function syncNoteEditCount() {
    const src = $("#memo-note-edit-src");
    const el = $("#memo-note-edit-count");
    if (!el) return;
    const n = String(src?.value || "").length;
    el.textContent = `${n} / ${NOTE_MAX}`;
    el.classList.toggle("is-near-limit", n >= NOTE_MAX - 40);
  }

  function clearEditing({ keepHighlight = false } = {}) {
    const id = state.editingId;
    state.editingId = "";
    const err = $("#memo-text-edit-error");
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
    if (!keepHighlight || !id) return;
    requestAnimationFrame(() => {
      const card = itemList?.querySelector?.(`.memo-card[data-memo-id="${id}"]`);
      if (!card) return;
      card.classList.add("is-just-saved");
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setTimeout(() => card.classList.remove("is-just-saved"), 1600);
    });
  }

  function closeTextEditPanel({ discard = true } = {}) {
    const dlg = $("#memo-text-edit");
    if (dlg?.open) dlg.close();
    if (discard) clearEditing();
  }

  function clearNoteEditing() {
    state.noteEditingId = "";
    const err = $("#memo-note-edit-error");
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
  }

  function closeNoteEditPanel({ discard = true } = {}) {
    const dlg = $("#memo-note-edit");
    if (dlg?.open) dlg.close();
    if (discard) clearNoteEditing();
  }

  async function beginEditNote(item) {
    if (!item?.id) return;
    closeTextEditPanel({ discard: true });
    state.noteEditingId = item.id;
    const dlg = $("#memo-note-edit");
    const src = $("#memo-note-edit-src");
    const sub = $("#memo-note-edit-sub");
    if (sub) {
      sub.textContent = item.name
        ? `给「${item.name}」加一句说明，方便以后搜索`
        : "说明这条用来干什么，可搜索";
    }
    if (src) src.value = String(item.note || "");
    syncNoteEditCount();
    const err = $("#memo-note-edit-error");
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
    if (dlg && typeof dlg.showModal === "function" && !dlg.open) dlg.showModal();
    setTimeout(() => {
      src?.focus?.();
      try {
        const len = src?.value?.length || 0;
        src?.setSelectionRange?.(len, len);
      } catch (_) {}
    }, 40);
  }

  async function saveNoteFromPanel({ clear = false } = {}) {
    const id = state.noteEditingId;
    const src = $("#memo-note-edit-src");
    const body = clear ? "" : clipNote(src?.value || "");
    const item = state.index.items.find((x) => x.id === id);
    if (!item) {
      closeNoteEditPanel({ discard: true });
      toast("原条目已不存在");
      return;
    }
    if (body) item.note = body;
    else {
      delete item.note;
      state.expandedNotes.delete(id);
    }
    item.updatedAt = Date.now();
    state.cardHeightCache.delete(item.id);
    state.filterCache = { key: "", items: null };
    state.countCache = null;
    await persistIndex({ immediate: true });
    const savedId = id;
    state.noteEditingId = "";
    const dlg = $("#memo-note-edit");
    if (dlg?.open) dlg.close();
    if (previewItem?.id === savedId) syncPreviewNoteLine(item);
    renderAll();
    requestAnimationFrame(() => {
      const card = itemList?.querySelector?.(`.memo-card[data-memo-id="${savedId}"]`);
      if (!card) return;
      card.classList.add("is-just-saved");
      card.scrollIntoView({ behavior: "smooth", block: "nearest" });
      setTimeout(() => card.classList.remove("is-just-saved"), 1600);
    });
    toast(body ? "已保存备注" : "已清空备注");
  }

  async function beginEditText(item) {
    if (!item || item.type !== "text") {
      toast("仅文本条目可编辑");
      return;
    }
    let text = item.textPreview || "";
    if (!text) {
      try {
        text = await (await loadBlob(item)).text();
      } catch (_) {
        text = "";
      }
    }
    closeLightbox();
    closeNoteEditPanel({ discard: true });
    state.editingId = item.id;
    const dlg = $("#memo-text-edit");
    const src = $("#memo-text-edit-src");
    const sub = $("#memo-text-edit-sub");
    if (sub) sub.textContent = item.name ? `正在编辑：${item.name}` : "修改后点保存，覆盖原条目";
    if (src) src.value = text;
    if (dlg && typeof dlg.showModal === "function" && !dlg.open) dlg.showModal();
    renderItems();
    setTimeout(() => {
      src?.focus?.();
      try {
        const len = src?.value?.length || 0;
        src?.setSelectionRange?.(len, len);
      } catch (_) {}
    }, 40);
  }

  async function saveEditedTextFromPanel() {
    const id = state.editingId;
    const src = $("#memo-text-edit-src");
    const body = String(src?.value || "").trim();
    const err = $("#memo-text-edit-error");
    if (!body) {
      if (err) {
        err.hidden = false;
        err.textContent = "内容不能为空";
      } else toast("内容不能为空");
      return;
    }
    const item = state.index.items.find((x) => x.id === id);
    if (!item) {
      closeTextEditPanel({ discard: true });
      toast("原条目已不存在");
      return;
    }
    await withBusy(async () => {
      const blob = new Blob([body], { type: "text/plain;charset=utf-8" });
      item.textPreview = clipTextPreview(body);
      item.updatedAt = Date.now();
      item.size = blob.size;
      item.mime = "text/plain;charset=utf-8";
      item.fileName = await saveBlob(item.id, blob, item.fileName || `${item.id}_text.txt`);
      try {
        item.contentHash = await hashBlobPartial(blob);
      } catch (_) {}
      rememberHash(item);
      await persistIndex();
      const savedId = id;
      state.editingId = "";
      const dlg = $("#memo-text-edit");
      if (dlg?.open) dlg.close();
      renderAll();
      requestAnimationFrame(() => {
        const card = itemList?.querySelector?.(`.memo-card[data-memo-id="${savedId}"]`);
        if (!card) return;
        card.classList.add("is-just-saved");
        card.scrollIntoView({ behavior: "smooth", block: "nearest" });
        setTimeout(() => card.classList.remove("is-just-saved"), 1600);
      });
      toast("已保存修改");
    });
  }

  async function ingestFiles(fileList) {
    const files = [...(fileList || [])].filter(Boolean);
    if (!files.length) return;
    await withBusy(async () => {
      let added = 0;
      let skipped = 0;
      let cancelled = 0;
      let lastId = "";
      const signal = beginSaveAbort();
      try {
        for (let i = 0; i < files.length; i++) {
          if (signal?.aborted) break;
          const f = files[i];
          if (!confirmLargeBlob(f, f.name)) {
            cancelled += 1;
            continue;
          }
          setProgress(true, i / Math.max(1, files.length), `导入 ${f.name}（${i + 1}/${files.length}）`, {
            cancellable: true,
          });
          const before = state.index.items.length;
          const item = await addItemFromBlob(f, f.name, {
            quiet: true,
            skipLargeConfirm: true,
            signal,
          });
          if (signal?.aborted || item === null && signal?.aborted) {
            cancelled += 1;
            break;
          }
          if (item?.id) lastId = item.id;
          if (state.index.items.length > before) added += 1;
          else if (item) skipped += 1;
          else cancelled += 1;
        }
      } finally {
        endSaveAbort();
        setProgress(false, 0, "");
      }
      if (lastId) {
        const parts = [];
        if (added) parts.push(`已添加 ${added} 个`);
        if (skipped) parts.push(`重复置顶 ${skipped} 个`);
        if (cancelled) parts.push(`取消 ${cancelled} 个`);
        flashItem(lastId, parts.join("，") || "完成");
      } else if (cancelled && !added) {
        toast("已取消");
      } else {
        toast("没有可添加的文件");
      }
    });
  }

  function clipPermissionHint(err) {
    const name = err?.name || "";
    const msg = String(err?.message || err || "");
    if (name === "NotAllowedError" || /notallowed|permission|denied|权限/i.test(msg)) {
      return isLikelyMobile()
        ? "没有剪贴板权限。请在弹出提示里点允许，或改用长按粘贴到本页。"
        : "没有剪贴板权限。请允许访问后重试，或改用 Ctrl/⌘+V 粘贴。";
    }
    if (/secure|https|issecurecontext/i.test(msg)) {
      return "当前环境无法读剪贴板，请用 HTTPS 打开，或直接粘贴到本页。";
    }
    return msg || "读取剪贴板失败，可改用粘贴";
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
      if (force) setError(memoError, clipPermissionHint(err));
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
    rebuildHashIndex();
    rebuildTagMap();
    invalidateCountCache();
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
      state.autoClip = localStorage.getItem(AUTOCLIP_KEY) === "1";
    } catch (_) {
      state.autoClip = false;
    }
    const autoclipEl = $("#memo-autoclip");
    if (autoclipEl) autoclipEl.checked = state.autoClip;
    try {
      const saved = await idbGet("index", "main");
      if (saved) state.index = normalizeIndex(saved);
    } catch (_) {
      state.index = emptyIndex();
    }
    const restored = await tryRestoreDirHandle();
    if (!restored && !state.dirPending) state.mode = "idb";
    rebuildHashIndex();
    rebuildTagMap();
    invalidateCountCache();
    renderAll();
  }

  function hideUndoBar() {
    const bar = $("#memo-undo-bar");
    if (bar) bar.hidden = true;
  }

  async function commitPendingUndo() {
    const pending = state.pendingUndo;
    state.pendingUndo = null;
    if (pending?.timer) clearTimeout(pending.timer);
    hideUndoBar();
    const items = pending?.items || [];
    for (const it of items) {
      try {
        await removeBlob(it);
      } catch (_) {}
      forgetHash(it);
      if (it?.id) state.cardHeightCache.delete(it.id);
    }
  }

  function flushPendingUndoOnLeave() {
    const pending = state.pendingUndo;
    if (!pending?.items?.length) return;
    if (pending.timer) clearTimeout(pending.timer);
    state.pendingUndo = null;
    hideUndoBar();
    // 关页时尽量提交硬删除，避免留下无索引 blob
    pending.items.forEach((it) => {
      removeBlob(it).catch(() => {});
      forgetHash(it);
      if (it?.id) state.cardHeightCache.delete(it.id);
    });
  }

  async function undoDelete() {
    const pending = state.pendingUndo;
    if (!pending?.items?.length) return;
    if (pending.timer) clearTimeout(pending.timer);
    state.pendingUndo = null;
    hideUndoBar();
    const restored = pending.items;
    state.index.items = [...restored, ...state.index.items];
    restored.forEach(rememberHash);
    reindexOrders();
    await persistIndex({ immediate: true });
    renderAll();
    toast(restored.length > 1 ? `已撤销删除 ${restored.length} 条` : "已撤销删除");
  }

  function showUndoBar(count) {
    const bar = $("#memo-undo-bar");
    const text = $("#memo-undo-text");
    if (text) text.textContent = count > 1 ? `已删除 ${count} 条` : "已删除 1 条";
    if (bar) bar.hidden = false;
  }

  async function deleteItems(ids) {
    const list = [...ids];
    if (!list.length) return;
    if (!window.confirm(`删除 ${list.length} 条？删除后约 ${Math.round(UNDO_MS / 1000)} 秒内可撤销。`)) return;
    await commitPendingUndo();
    const removed = [];
    for (const id of list) {
      const idx = state.index.items.findIndex((x) => x.id === id);
      if (idx < 0) continue;
      removed.push(state.index.items[idx]);
      state.index.items.splice(idx, 1);
      state.selected.delete(id);
    }
    if (!removed.length) return;
    removed.forEach(forgetHash);
    reindexOrders();
    await persistIndex({ immediate: true });
    renderAll();
    state.pendingUndo = {
      items: removed,
      timer: setTimeout(() => {
        commitPendingUndo().catch(() => {});
      }, UNDO_MS),
    };
    showUndoBar(removed.length);
  }

  function canClipboardCopy(item) {
    return item?.type === "text" || item?.type === "image" || item?.type === "gif";
  }

  function probeCanShareFiles() {
    if (state.testShareUi) return true;
    if (!isLikelyMobile() || typeof navigator.share !== "function" || !canShareFiles()) return false;
    if (state.shareFilesCapable != null) return state.shareFilesCapable;
    try {
      const probe = new File([new Uint8Array([1])], "memo-share-probe.bin", {
        type: "application/octet-stream",
      });
      state.shareFilesCapable = navigator.canShare({ files: [probe] });
    } catch (_) {
      state.shareFilesCapable = false;
    }
    return state.shareFilesCapable;
  }

  function canOfferItemShare(item) {
    if (state.testShareUi) return true;
    if (!isLikelyMobile() || typeof navigator.share !== "function") return false;
    if (!item) return probeCanShareFiles();
    if (item.type === "text") {
      try {
        if (typeof navigator.canShare === "function") {
          return navigator.canShare({ title: "备忘录", text: "x" });
        }
      } catch (_) {}
      return true;
    }
    // 图片/视频/音频/文件依赖系统文件分享能力；不具备则卡片直接显示下载
    return probeCanShareFiles();
  }

  function itemShareFileName(item) {
    const raw = String(item?.name || item?.fileName || item?.id || "memo-item").trim() || "memo-item";
    return safeFileName(raw, "memo-item");
  }

  async function shareItem(item) {
    if (!item) return;
    if (!canOfferItemShare()) {
      await downloadItem(item, { toastMsg: "当前环境不支持分享，已改为下载" });
      return;
    }
    try {
      if (item.type === "text") {
        const text = item.textPreview || (await (await loadBlob(item)).text());
        const payload = { title: item.name || "备忘录文本", text };
        if (typeof navigator.canShare === "function" && !navigator.canShare(payload)) {
          await downloadItem(item, { toastMsg: "无法分享该文本，已改为下载" });
          return;
        }
        await navigator.share(payload);
        toast("已调起分享");
        return;
      }

      const blob = await loadBlob(item);
      const mime = blob.type || item.mime || "application/octet-stream";
      const file = new File([blob], itemShareFileName(item), { type: mime });
      const filePayload = { files: [file], title: item.name || "备忘录文件" };
      if (canShareFiles() && navigator.canShare(filePayload)) {
        await navigator.share(filePayload);
        toast("已调起分享");
        return;
      }
      // 部分环境不能分享文件，文本类可退回纯文字
      if (isTextLikeItem(item, blob)) {
        const text = await blob.text();
        const textPayload = { title: item.name || "备忘录", text };
        if (typeof navigator.canShare !== "function" || navigator.canShare(textPayload)) {
          await navigator.share(textPayload);
          toast("已调起分享");
          return;
        }
      }
      await downloadItem(item, { toastMsg: "当前环境无法分享该文件，已改为下载" });
    } catch (err) {
      if (err && (err.name === "AbortError" || /abort|cancel|取消/i.test(String(err.message || "")))) {
        toast("已取消分享");
        return;
      }
      try {
        await downloadItem(item, { toastMsg: "分享失败，已改为下载" });
      } catch (dlErr) {
        setError(memoError, dlErr.message || err.message || "分享失败");
      }
    }
  }

  function clipboardTypeSupported(mime) {
    const type = String(mime || "").toLowerCase();
    if (!type) return false;
    if (type === "text/plain" || type === "text/html" || type === "image/png") return true;
    try {
      if (typeof ClipboardItem?.supports === "function") return ClipboardItem.supports(type);
    } catch (_) {}
    // 常见静态图：不少环境可写；写失败时再回退下载
    return type === "image/jpeg" || type === "image/gif" || type === "image/webp";
  }

  async function downloadItem(item, { toastMsg } = {}) {
    const blob = await loadBlob(item);
    downloadBlob(blob, item.name || item.fileName || item.id);
    toast(toastMsg || "已开始下载");
  }

  async function copyItem(item) {
    try {
      if (item.type === "text") {
        const text = item.textPreview || (await (await loadBlob(item)).text());
        await navigator.clipboard.writeText(text);
        toast("已复制文本");
        return;
      }
      if ((item.type === "image" || item.type === "gif") && navigator.clipboard?.write && window.ClipboardItem) {
        const blob = await loadBlob(item);
        const type = blob.type || (item.type === "gif" ? "image/gif" : "image/png");
        try {
          if (!clipboardTypeSupported(type) && item.type === "image") {
            // 尝试转成 PNG 再写（静态图）
            const png = await imageBlobToPng(blob);
            await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
            toast("已复制图片");
            return;
          }
          await navigator.clipboard.write([new ClipboardItem({ [type]: blob })]);
          toast(item.type === "gif" ? "已复制动图" : "已复制图片");
          return;
        } catch (_) {
          await downloadItem(item, { toastMsg: "无法写入剪贴板，已改为下载" });
          return;
        }
      }
      // 视频 / 音频 / 普通文件：系统剪贴板通常不支持
      await downloadItem(item, { toastMsg: "此类型无法写入系统剪贴板，已改为下载" });
    } catch (err) {
      setError(memoError, err.message || "复制失败");
    }
  }

  async function imageBlobToPng(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("图片解码失败"));
        el.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth || img.width || 1;
      canvas.height = img.naturalHeight || img.height || 1;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const png = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("转 PNG 失败"))), "image/png");
      });
      return png;
    } finally {
      URL.revokeObjectURL(url);
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
    syncExportButtonLabels();
    exportTags.innerHTML = state.index.tags
      .map((t) => {
        const label = t.id === DEFAULT_TAG_ID ? "默认（未分类）" : t.name;
        return `<option value="${escapeHtml(t.id)}">${escapeHtml(label)}</option>`;
      })
      .join("");
    $("#memo-export-pass").value = "";
    exportDlg.showModal();
  }

  async function doExport({ share = preferShareExport() } = {}) {
    await withBusy(async () => {
      const kinds = $$('#memo-export-dlg input[name="kind"]:checked').map((el) => el.value);
      if (!kinds.length) throw new Error("请至少选择一种类型");
      const tagIds = [...(exportTags?.selectedOptions || [])].map((o) => o.value);
      const password = String($("#memo-export-pass")?.value || "");
      const packed = await buildExportZip({ kinds, tagIds, password });
      if (share) {
        try {
          const file = new File([packed.blob], packed.filename, { type: packed.blob.type || "application/zip" });
          if (canShareFiles() && navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: "备忘录导出" });
            toast(`已分享 ${packed.count} 条`);
            return;
          }
          toast("当前环境无法分享文件，已改为下载");
        } catch (err) {
          // 用户取消分享：不再强制下载
          if (err && (err.name === "AbortError" || /abort|cancel|取消/i.test(String(err.message || "")))) {
            toast("已取消分享");
            return;
          }
          toast("分享失败，已改为下载");
        }
      }
      downloadBlob(packed.blob, packed.filename);
      toast(`已导出 ${packed.count} 条`);
    });
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

  function hidePreviewParts() {
    [lightboxImg, lightboxVideo, lightboxAudioWrap, lightboxText, lightboxFrame, lightboxFile].forEach((el) => {
      if (el) el.hidden = true;
    });
    if (lightboxVideo) {
      try {
        lightboxVideo.pause();
      } catch (_) {}
      lightboxVideo.removeAttribute("src");
      lightboxVideo.load?.();
    }
    if (lightboxAudio) {
      try {
        lightboxAudio.pause();
      } catch (_) {}
      lightboxAudio.removeAttribute("src");
      lightboxAudio.load?.();
    }
    if (lightboxFrame) {
      lightboxFrame.removeAttribute("src");
    }
    if (lightboxImg) lightboxImg.removeAttribute("src");
    if (lightboxText) lightboxText.textContent = "";
  }

  function revokePreviewUrl() {
    if (previewObjectUrl) {
      try {
        URL.revokeObjectURL(previewObjectUrl);
      } catch (_) {}
    }
    previewObjectUrl = "";
    previewBlob = null;
  }

  function syncPreviewNoteLine(item) {
    if (!previewNoteBtn) return;
    if (!item) {
      previewNoteBtn.hidden = true;
      previewNoteBtn.textContent = "";
      return;
    }
    const note = String(item.note || "").trim();
    previewNoteBtn.hidden = false;
    previewNoteBtn.classList.toggle("is-empty", !note);
    previewNoteBtn.textContent = note ? `备注：${note}` : "添加备注…";
    previewNoteBtn.title = note ? "点击编辑备注" : "点击添加备注";
  }

  function setPreviewChrome(item, { canFs = false, canNewTab = false, canDl = true, canEdit = false } = {}) {
    previewItem = item;
    if (previewTitle) previewTitle.textContent = item?.name || "预览";
    if (previewSub) {
      previewSub.textContent = item
        ? `${item.type || "file"} · ${formatBytes(item.size || 0)} · ${formatTime(item.createdAt)}`
        : "";
    }
    syncPreviewNoteLine(item);
    if (previewFsBtn) {
      previewFsBtn.hidden = !canFs;
      previewFsBtn.textContent = lightbox?.classList.contains("is-fs") ? "退出全屏" : "全屏";
    }
    if (previewNewTabBtn) previewNewTabBtn.hidden = !canNewTab;
    if (previewDlBtn) previewDlBtn.hidden = !canDl;
    if (previewShareBtn) previewShareBtn.hidden = !item || !canOfferItemShare(item);
    if (previewEditBtn) previewEditBtn.hidden = !canEdit;
  }

  function isPdfItem(item, blob) {
    const mime = String(blob?.type || item?.mime || "").toLowerCase();
    const name = String(item?.name || item?.fileName || "").toLowerCase();
    return mime === "application/pdf" || name.endsWith(".pdf");
  }

  function isTextLikeItem(item, blob) {
    if (item?.type === "text") return true;
    const mime = String(blob?.type || item?.mime || "").toLowerCase();
    const name = String(item?.name || item?.fileName || "").toLowerCase();
    if (mime.startsWith("text/")) return true;
    if (mime === "application/json" || mime === "application/xml" || mime.endsWith("+json") || mime.endsWith("+xml")) {
      return true;
    }
    return /\.(txt|md|markdown|json|csv|log|xml|html?|css|js|ts|yml|yaml|ini|conf)$/i.test(name);
  }

  async function openItemPreview(item) {
    if (!item || !lightbox) return;
    setError(memoError, "");
    hidePreviewParts();
    revokePreviewUrl();
    lightbox.classList.remove("is-fs");
    const blob = await loadBlob(item);
    previewBlob = blob;
    previewObjectUrl = URL.createObjectURL(blob);
    const url = previewObjectUrl;

    if (item.type === "image" || item.type === "gif" || String(blob.type || "").startsWith("image/")) {
      setPreviewChrome(item, { canFs: true, canNewTab: true, canDl: true });
      lightboxImg.hidden = false;
      lightboxImg.src = url;
      lightbox.showModal();
      return;
    }

    if (item.type === "video" || String(blob.type || "").startsWith("video/")) {
      setPreviewChrome(item, { canFs: true, canNewTab: true, canDl: true });
      lightboxVideo.hidden = false;
      lightboxVideo.src = url;
      lightbox.showModal();
      try {
        await lightboxVideo.play();
      } catch (_) {
        /* autoplay may be blocked; controls remain */
      }
      return;
    }

    if (item.type === "audio" || String(blob.type || "").startsWith("audio/")) {
      setPreviewChrome(item, { canFs: true, canNewTab: false, canDl: true });
      lightboxAudioWrap.hidden = false;
      lightboxAudio.src = url;
      lightbox.showModal();
      try {
        await lightboxAudio.play();
      } catch (_) {}
      return;
    }

    if (isPdfItem(item, blob)) {
      setPreviewChrome(item, { canFs: true, canNewTab: true, canDl: true });
      lightboxFrame.hidden = false;
      lightboxFrame.src = url;
      lightbox.showModal();
      return;
    }

    if (isTextLikeItem(item, blob)) {
      setPreviewChrome(item, { canFs: true, canNewTab: true, canDl: true, canEdit: item.type === "text" });
      let text = item.textPreview || "";
      if (!text) {
        text = await blob.text();
        if (text.length > 400000) text = `${text.slice(0, 400000)}\n\n…（内容过长，已截断预览）`;
      }
      lightboxText.hidden = false;
      lightboxText.textContent = text;
      lightbox.showModal();
      return;
    }

    setPreviewChrome(item, { canFs: false, canNewTab: true, canDl: true });
    lightboxFile.hidden = false;
    const nameEl = $("#memo-preview-file-name");
    const metaEl = $("#memo-preview-file-meta");
    if (nameEl) nameEl.textContent = item.name || item.fileName || item.id;
    if (metaEl) metaEl.textContent = `${item.mime || blob.type || "unknown"} · ${formatBytes(blob.size || item.size || 0)}`;
    lightbox.showModal();
  }

  async function togglePreviewFullscreen() {
    // Prefer native media fullscreen for video when available (含 iOS webkit)
    if (lightboxVideo && !lightboxVideo.hidden) {
      try {
        if (document.fullscreenElement === lightboxVideo) {
          await document.exitFullscreen();
          return;
        }
        if (typeof lightboxVideo.webkitDisplayingFullscreen === "boolean" && lightboxVideo.webkitDisplayingFullscreen) {
          lightboxVideo.webkitExitFullscreen?.();
          return;
        }
        if (lightboxVideo.requestFullscreen) {
          await lightboxVideo.requestFullscreen();
          return;
        }
        if (lightboxVideo.webkitEnterFullscreen) {
          lightboxVideo.webkitEnterFullscreen();
          return;
        }
        if (lightboxVideo.webkitRequestFullscreen) {
          lightboxVideo.webkitRequestFullscreen();
          return;
        }
      } catch (_) {
        /* fall through to dialog fullscreen */
      }
    }
    if (!lightbox) return;
    const on = lightbox.classList.toggle("is-fs");
    if (previewFsBtn) previewFsBtn.textContent = on ? "退出全屏" : "全屏";
  }

  function closeLightbox() {
    hidePreviewParts();
    revokePreviewUrl();
    previewItem = null;
    syncPreviewNoteLine(null);
    lightbox?.classList.remove("is-fs");
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    }
    lightbox?.close?.();
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
      let skipped = 0;
      let notedImport = 0;
      for (let i = 0; i < imported.items.length; i++) {
        const it = imported.items[i];
        setProgress(true, i / Math.max(1, imported.items.length), `导入 ${it.name}`);
        const entry = zip.file(`${BLOBS_DIR}/${it.fileName}`) || zip.file(`${BLOBS_DIR}/${it.id}`);
        if (!entry) continue;
        const blob = await entry.async("blob");
        const typed = blob.type ? blob : new Blob([blob], { type: it.mime || "application/octet-stream" });
        let contentHash = it.contentHash || "";
        if (!contentHash) {
          try {
            contentHash = await hashBlobPartial(typed);
          } catch (_) {
            contentHash = "";
          }
        }
        const coarse =
          it.type === "text"
            ? textContentSig(it.textPreview || "")
            : `bin:${it.type || detectKind(typed.type, it.name)}:${typed.size || it.size || 0}:${typed.type || it.mime || ""}`;
        const dup = findDuplicateBySig(coarse, contentHash);
        if (dup) {
          await bumpItemToFront(dup);
          skipped += 1;
          continue;
        }
        const newId = uid();
        const fileName = await saveBlob(newId, typed, `${newId}_${safeFileName(it.fileName || it.name || "file")}`);
        const row = {
          ...it,
          id: newId,
          fileName,
          contentHash: contentHash || it.contentHash || undefined,
          createdAt: it.createdAt || Date.now(),
          updatedAt: Date.now(),
          order: -1,
        };
        const note = clipNote(row.note || "");
        if (note) {
          row.note = note;
          notedImport += 1;
        } else delete row.note;
        state.index.items.unshift(row);
        rememberHash(row);
        importedCount += 1;
      }
      reindexOrders();
      rebuildTagMap();
      await persistIndex({ immediate: true });
      setProgress(false, 0, "");
      renderAll();
      const noteBit = notedImport ? `，其中 ${notedImport} 条含备注` : "";
      if (importedCount && skipped) toast(`导入完成：新增 ${importedCount} 条${noteBit}，重复置顶 ${skipped} 条`);
      else if (importedCount) toast(`导入完成（${importedCount} 条${noteBit}）`);
      else if (skipped) toast(`全部为重复内容，已置顶 ${skipped} 条`);
      else toast("导入完成，但未找到可写入的文件");
    });
  }

  function openTagDialog(itemId) {
    state.tagTargetId = itemId;
    const dlg = $("#memo-tag-dlg");
    const input = $("#memo-tag-search");
    if (input) input.value = "";
    renderTagSuggest("");
    dlg?.showModal?.();
    setTimeout(() => input?.focus(), 30);
  }

  function renderTagSuggest(q) {
    const box = $("#memo-tag-suggest");
    if (!box) return;
    const query = String(q || "").trim().toLowerCase();
    const tags = state.index.tags.filter((t) => t.id !== DEFAULT_TAG_ID);
    const filtered = query ? tags.filter((t) => t.name.toLowerCase().includes(query)) : tags;
    if (!filtered.length) {
      box.innerHTML = `<p class="hint tight">${query ? `没有「${escapeHtml(query)}」，可点下方创建` : "暂无自定义标签"}</p>`;
      return;
    }
    box.innerHTML = filtered
      .map(
        (t) =>
          `<button type="button" class="memo-tag-suggest-item" data-memo-tag-pick="${escapeHtml(t.id)}">${escapeHtml(t.name)}</button>`
      )
      .join("");
  }

  async function applyTagToTarget(tag) {
    const item = state.index.items.find((x) => x.id === state.tagTargetId);
    if (!item || !tag || tag.id === DEFAULT_TAG_ID) return;
    if (!item.tagIds.includes(tag.id)) item.tagIds.push(tag.id);
    ensureTagMembership(item);
    item.updatedAt = Date.now();
    invalidateCountCache();
    await persistIndex({ immediate: true });
    state.tagTargetId = "";
    renderAll();
    toast(`已添加标签「${tag.name}」`);
  }

  async function commitTagFromInput() {
    const name = String($("#memo-tag-search")?.value || "").trim();
    if (!name) return;
    let tag = state.index.tags.find((x) => x.name === name);
    if (!tag) {
      tag = { id: uid(), name, order: -1 };
      state.index.tags.unshift(tag);
      reindexOrders();
      rebuildTagMap();
      await persistIndex({ immediate: true });
    }
    if (!state.tagTargetId) {
      renderAll();
      toast(`已就绪标签「${tag.name}」`);
      return;
    }
    await applyTagToTarget(tag);
  }

  // ---- events ----
  $("#memo-pick-dir")?.addEventListener("click", () => {
    pickDirectory().catch((err) => setError(memoError, err.message || String(err)));
  });
  reconnectBtn?.addEventListener("click", () => {
    pickDirectory().catch((err) => setError(memoError, err.message || String(err)));
  });
  $("#memo-reconnect-banner-btn")?.addEventListener("click", () => {
    pickDirectory().catch((err) => setError(memoError, err.message || String(err)));
  });
  $("#memo-file")?.addEventListener("change", (e) => {
    ingestFiles(e.target.files).catch((err) => setError(memoError, err.message || String(err)));
    e.target.value = "";
  });
  $("#memo-save-text")?.addEventListener("click", () => {
    addText(editor?.value || "").catch((err) => setError(memoError, err.message || String(err)));
  });
  editor?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    addText(editor.value || "").catch((err) => setError(memoError, err.message || String(err)));
  });
  $("#memo-text-edit-save")?.addEventListener("click", () => {
    saveEditedTextFromPanel().catch((err) => {
      const el = $("#memo-text-edit-error");
      if (el) {
        el.hidden = false;
        el.textContent = err.message || String(err);
      } else setError(memoError, err.message || String(err));
    });
  });
  $("#memo-text-edit-cancel")?.addEventListener("click", () => {
    closeTextEditPanel({ discard: true });
    toast("已取消编辑");
  });
  $("#memo-text-edit")?.addEventListener("close", () => {
    if (state.editingId) clearEditing();
    renderItems();
  });
  $("#memo-note-edit-save")?.addEventListener("click", () => {
    saveNoteFromPanel().catch((err) => {
      const el = $("#memo-note-edit-error");
      if (el) {
        el.hidden = false;
        el.textContent = err.message || String(err);
      } else setError(memoError, err.message || String(err));
    });
  });
  $("#memo-note-edit-clear")?.addEventListener("click", () => {
    const src = $("#memo-note-edit-src");
    if (src) src.value = "";
    saveNoteFromPanel({ clear: true }).catch((err) => {
      const el = $("#memo-note-edit-error");
      if (el) {
        el.hidden = false;
        el.textContent = err.message || String(err);
      } else setError(memoError, err.message || String(err));
    });
  });
  $("#memo-note-edit-cancel")?.addEventListener("click", () => {
    closeNoteEditPanel({ discard: true });
    toast("已取消备注");
  });
  $("#memo-note-edit")?.addEventListener("close", () => {
    if (state.noteEditingId) clearNoteEditing();
  });
  $("#memo-note-edit-src")?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    saveNoteFromPanel().catch((err) => setError(memoError, err.message || String(err)));
  });
  $("#memo-note-edit-src")?.addEventListener("input", () => syncNoteEditCount());
  $("#memo-read-clip")?.addEventListener("click", () => {
    readClipboard({ force: true }).catch((err) => setError(memoError, err.message || String(err)));
  });
  previewEditBtn?.addEventListener("click", () => {
    const item = previewItem;
    if (!item || item.type !== "text") {
      toast("仅文本条目可编辑");
      return;
    }
    beginEditText(item).catch((err) => setError(memoError, err.message || String(err)));
  });
  previewNoteBtn?.addEventListener("click", () => {
    const item = previewItem;
    if (!item) return;
    beginEditNote(item).catch((err) => setError(memoError, err.message || String(err)));
  });
  $("#memo-tag-new")?.addEventListener("click", () => {
    state.tagTargetId = "";
    const dlg = $("#memo-tag-dlg");
    const title = dlg?.querySelector(".subhead");
    if (title) title.textContent = "新建标签";
    const input = $("#memo-tag-search");
    if (input) input.value = "";
    renderTagSuggest("");
    dlg?.showModal?.();
    setTimeout(() => input?.focus(), 30);
  });

  $("#memo-tag-search")?.addEventListener("input", (e) => {
    renderTagSuggest(e.target.value);
  });
  $("#memo-tag-suggest")?.addEventListener("click", async (e) => {
    const id = e.target.closest?.("[data-memo-tag-pick]")?.dataset?.memoTagPick;
    if (!id) return;
    const tag = state.index.tags.find((t) => t.id === id);
    const dlg = $("#memo-tag-dlg");
    if (!state.tagTargetId) {
      if (tag) {
        state.activeTagId = tag.id;
        dlg?.close?.("cancel");
        renderAll();
      }
      return;
    }
    // 先应用标签，再关对话框，避免 close 事件清空 tagTargetId
    await applyTagToTarget(tag).catch((err) => setError(memoError, err.message || String(err)));
    dlg?.close?.("cancel");
  });
  $("#memo-tag-dlg")?.addEventListener("close", () => {
    const dlg = $("#memo-tag-dlg");
    const title = dlg?.querySelector(".subhead");
    if (title) title.textContent = "添加标签";
    if (dlg?.returnValue !== "ok") {
      state.tagTargetId = "";
      return;
    }
    commitTagFromInput().catch((err) => setError(memoError, err.message || String(err)));
  });

  tagList?.addEventListener("click", (e) => {
    const delBtn = e.target.closest?.("[data-memo-tag-del]");
    if (delBtn) {
      e.preventDefault();
      e.stopPropagation();
      const id = delBtn.dataset.memoTagDel;
      deleteTag(id).catch((err) => setError(memoError, err.message || String(err)));
      return;
    }
    const btn = e.target.closest("[data-memo-tag]");
    if (!btn) return;
    state.activeTagId = btn.dataset.memoTag;
    resetListPaging();
    invalidateFilterCache();
    if (window.matchMedia("(max-width: 900px)").matches) {
      $("#memo-tags-aside")?.classList.remove("is-open");
    }
    renderAll();
  });

  $("#memo-type-filter")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-memo-type]");
    if (!btn) return;
    state.activeType = btn.dataset.memoType || "all";
    resetListPaging();
    renderAll();
  });

  let searchTimer = 0;
  $("#memo-search")?.addEventListener("input", (e) => {
    const val = String(e.target.value || "");
    clearTimeout(searchTimer);
    const n = state.index.items?.length || 0;
    const delay = n > 5000 ? 450 : n > 1200 ? 300 : 180;
    searchTimer = setTimeout(() => {
      state.searchQuery = val;
      resetListPaging();
      renderAll();
    }, delay);
  });
  $("#memo-clear-filters")?.addEventListener("click", () => clearAllFilters());
  $("#memo-load-more")?.addEventListener("click", () => {
    state.listLimit = (state.listLimit || PAGE_SIZE) + PAGE_SIZE;
    renderItems();
  });
  $("#memo-autoclip")?.addEventListener("change", (e) => {
    state.autoClip = Boolean(e.target.checked);
    try {
      localStorage.setItem(AUTOCLIP_KEY, state.autoClip ? "1" : "0");
    } catch (_) {}
    toast(state.autoClip ? "已开启：回到本页自动读剪贴板" : "已关闭自动读剪贴板");
    if (state.autoClip) {
      readClipboard({ force: false }).catch(() => {});
    }
  });

  function maybeAutoClip() {
    if (!state.autoClip) return;
    if (!isMemoActive()) return;
    if (document.visibilityState && document.visibilityState !== "visible") return;
    if (isTextEditOpen()) return;
    readClipboard({ force: false }).catch(() => {});
  }
  window.addEventListener("focus", () => maybeAutoClip());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") maybeAutoClip();
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
    rebuildTagMap();
    dragTagId = null;
    await persistIndex({ immediate: true });
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
      const delId = t.closest?.("[data-memo-del]")?.dataset?.memoDel;
      if (delId) {
        await deleteItems([delId]);
        return;
      }
      const editId = t.closest?.("[data-memo-edit]")?.dataset?.memoEdit;
      if (editId) {
        const item = state.index.items.find((x) => x.id === editId);
        if (item) await beginEditText(item);
        return;
      }
      const noteId = t.closest?.("[data-memo-note]")?.dataset?.memoNote;
      if (noteId) {
        const item = state.index.items.find((x) => x.id === noteId);
        if (item) await beginEditNote(item);
        return;
      }
      const noteExpandId = t.closest?.("[data-memo-note-expand]")?.dataset?.memoNoteExpand;
      if (noteExpandId) {
        if (state.expandedNotes.has(noteExpandId)) state.expandedNotes.delete(noteExpandId);
        else state.expandedNotes.add(noteExpandId);
        state.cardHeightCache.delete(noteExpandId);
        renderItems();
        return;
      }
      const copyId = t.closest?.("[data-memo-copy]")?.dataset?.memoCopy;
      if (copyId) {
        const item = state.index.items.find((x) => x.id === copyId);
        if (item) await copyItem(item);
        t.closest("details")?.removeAttribute("open");
        return;
      }
      const shareId = t.closest?.("[data-memo-share]")?.dataset?.memoShare;
      if (shareId) {
        const item = state.index.items.find((x) => x.id === shareId);
        if (item) await shareItem(item);
        t.closest("details")?.removeAttribute("open");
        return;
      }
      const dlId = t.closest?.("[data-memo-dl]")?.dataset?.memoDl;
      if (dlId) {
        const item = state.index.items.find((x) => x.id === dlId);
        if (!item) return;
        await downloadItem(item);
        t.closest("details")?.removeAttribute("open");
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
      const previewId = t.closest?.("[data-memo-preview]")?.dataset?.memoPreview;
      if (previewId) {
        const item = state.index.items.find((x) => x.id === previewId);
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
        // 单击展开/收起；双击编辑文本
        if (e.detail >= 2) {
          const item = state.index.items.find((x) => x.id === expandId);
          if (item?.type === "text") await beginEditText(item);
          else if (item) await openItemPreview(item);
          return;
        }
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
        openTagDialog(tagAddId);
        return;
      }
      const chipRm = t.closest?.("[data-memo-chip-rm]");
      if (chipRm) {
        const itemId = chipRm.dataset.memoChipRm;
        const tagId = chipRm.dataset.memoChipTag;
        await removeTagFromItem(itemId, tagId);
        return;
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
  $("#memo-progress-cancel")?.addEventListener("click", () => {
    try {
      state.saveAbort?.abort?.();
    } catch (_) {}
    toast("正在取消…");
  });
  $("#memo-undo-btn")?.addEventListener("click", () => {
    undoDelete().catch((err) => setError(memoError, err.message || String(err)));
  });
  $("#memo-tags-toggle")?.addEventListener("click", () => {
    const aside = $("#memo-tags-aside");
    if (!aside) return;
    aside.classList.toggle("is-open");
    syncTagsToggle();
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

  // 整页 Ctrl/⌘+V 与右键粘贴：备忘录激活时识别类型并添加（编辑框内文本仍走默认粘贴）
  function isEditableTarget(el) {
    if (!el || el === document.body) return false;
    const tag = String(el.tagName || "").toLowerCase();
    if (tag === "textarea" || tag === "select") return true;
    if (tag === "input") {
      const type = String(el.type || "text").toLowerCase();
      return !["button", "submit", "checkbox", "radio", "file", "range", "color"].includes(type);
    }
    return Boolean(el.isContentEditable);
  }

  document.addEventListener(
    "paste",
    (e) => {
      if (!isMemoActive()) return;
      if (isTextEditOpen()) return;
      const cd = e.clipboardData;
      if (!cd) return;
      const files = [...(cd.files || [])];
      if (files.length) {
        e.preventDefault();
        ingestFiles(files).catch((err) => setError(memoError, err.message || String(err)));
        return;
      }
      const items = [...(cd.items || [])];
      const img = items.find((it) => it.kind === "file" && String(it.type || "").startsWith("image/"));
      if (img) {
        e.preventDefault();
        const f = img.getAsFile();
        if (f) ingestFiles([f]).catch((err) => setError(memoError, err.message || String(err)));
        return;
      }
      const active = document.activeElement;
      // 编辑框 / 其它可编辑控件内：文本交给默认粘贴
      if (active === editor || isEditableTarget(active)) return;
      const text = cd.getData("text/plain");
      if (text && text.trim()) {
        e.preventDefault();
        addText(text).catch((err) => setError(memoError, err.message || String(err)));
      }
    },
    true
  );

  $("#memo-export")?.addEventListener("click", () => openExportDialog());
  exportDlg?.addEventListener("close", () => {
    if (exportDlg.returnValue !== "ok") return;
    doExport()
      .catch((err) => setError(memoError, err.message || String(err)))
      .finally(() => setProgress(false, 0, ""));
  });
  let lastShareOffer = canOfferItemShare({ type: "file" }) || canOfferItemShare({ type: "text" });
  window.addEventListener("resize", () => {
    syncExportButtonLabels();
    const next = canOfferItemShare({ type: "file" }) || canOfferItemShare({ type: "text" });
    if (next === lastShareOffer) return;
    lastShareOffer = next;
    if (isMemoActive()) renderItems();
  });
  window.addEventListener("pagehide", () => {
    flushPersistSync();
    flushPendingUndoOnLeave();
  });
  window.addEventListener("beforeunload", () => {
    flushPersistSync();
    flushPendingUndoOnLeave();
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
  $("#memo-lightbox-close")?.addEventListener("click", closeLightbox);
  previewFsBtn?.addEventListener("click", () => {
    togglePreviewFullscreen().catch((err) => setError(memoError, err.message || String(err)));
  });
  previewDlBtn?.addEventListener("click", () => {
    if (!previewItem || !previewBlob) return;
    downloadBlob(previewBlob, previewItem.name || previewItem.fileName || previewItem.id);
  });
  previewShareBtn?.addEventListener("click", () => {
    const item = previewItem;
    if (!item) return;
    shareItem(item).catch((err) => setError(memoError, err.message || String(err)));
  });
  previewNewTabBtn?.addEventListener("click", () => {
    if (!previewObjectUrl) return;
    window.open(previewObjectUrl, "_blank", "noopener");
  });
  lightbox?.addEventListener("click", (e) => {
    if (e.target === lightbox) closeLightbox();
  });
  lightbox?.addEventListener("close", () => {
    hidePreviewParts();
    revokePreviewUrl();
    previewItem = null;
    lightbox?.classList.remove("is-fs");
  });
  document.addEventListener("fullscreenchange", () => {
    if (previewFsBtn && !previewFsBtn.hidden) {
      previewFsBtn.textContent =
        document.fullscreenElement || lightbox?.classList.contains("is-fs") ? "退出全屏" : "全屏";
    }
  });
  document.addEventListener("keydown", (e) => {
    if (!lightbox?.open) return;
    if (e.key === "Escape" && lightbox.classList.contains("is-fs") && !document.fullscreenElement) {
      lightbox.classList.remove("is-fs");
      if (previewFsBtn) previewFsBtn.textContent = "全屏";
      e.preventDefault();
      e.stopPropagation();
    }
  });

  window.DevToolsMemo = {
    getStorageBytes: estimateStorageBytes,
    getMode: () => state.mode,
    getIndex: () => state.index,
    ingestBlob: (blob, name) => addItemFromBlob(blob, name || `import-${Date.now()}`, { quiet: false }),
    ingestText: (text) => addText(text),
    canOfferShare: (item) => canOfferItemShare(item),
    canShareFilesProbe: () => probeCanShareFiles(),
    estimateCardHeight: (item) => estimateCardHeight(item || {}),
    isOrdered: () => (state.index.items || []).every((it, i) => (it.order ?? i) === i),
    getCountCache: () => ensureCountCache(),
    canDragReorder: () => canDragReorder(),
    setShareUiForTest: (on) => {
      state.testShareUi = Boolean(on);
      renderItems();
      if (previewItem) setPreviewChrome(previewItem, { canDl: true, canEdit: previewItem.type === "text" });
    },
    shareItem: (id) => {
      const item = state.index.items.find((x) => x.id === id) || previewItem;
      return shareItem(item);
    },
  };

  boot().catch((err) => setError(memoError, err.message || String(err)));
})();
