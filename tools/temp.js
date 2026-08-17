(() => {
  "use strict";

  const tracked = new Map(); // url -> { size, kind, at }
  const cleaners = [];
  const origCreate = URL.createObjectURL.bind(URL);
  const origRevoke = URL.revokeObjectURL.bind(URL);
  let unloading = false;

  function kindOf(obj) {
    if (!obj) return "unknown";
    if (typeof File !== "undefined" && obj instanceof File) return "file";
    if (typeof Blob !== "undefined" && obj instanceof Blob) return "blob";
    if (typeof MediaSource !== "undefined" && obj instanceof MediaSource) return "media";
    return "other";
  }

  function sizeOf(obj) {
    if (!obj) return 0;
    const n = Number(obj.size ?? obj.byteLength ?? 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }

  function formatBytes(n) {
    const v = Number(n) || 0;
    if (v < 1024) return `${v} B`;
    if (v < 1024 * 1024) return `${(v / 1024).toFixed(1)} KB`;
    return `${(v / (1024 * 1024)).toFixed(2)} MB`;
  }

  URL.createObjectURL = (obj) => {
    const url = origCreate(obj);
    tracked.set(url, {
      size: sizeOf(obj),
      kind: kindOf(obj),
      at: Date.now(),
    });
    return url;
  };

  URL.revokeObjectURL = (url) => {
    tracked.delete(url);
    origRevoke(url);
  };

  function blobStats() {
    let bytes = 0;
    let count = 0;
    let fileBytes = 0;
    for (const info of tracked.values()) {
      count += 1;
      bytes += info.size || 0;
      if (info.kind === "file") fileBytes += info.size || 0;
    }
    return { count, bytes, fileBytes };
  }

  async function storageStats() {
    if (!navigator.storage?.estimate) return null;
    try {
      const est = await navigator.storage.estimate();
      return {
        usage: Number(est.usage) || 0,
        quota: Number(est.quota) || 0,
      };
    } catch (_) {
      return null;
    }
  }

  function stripBlobMedia() {
    document.querySelectorAll("video, audio, img, a").forEach((el) => {
      try {
        const href = el.getAttribute?.("href") || "";
        const src = el.getAttribute?.("src") || el.src || "";
        if (typeof src === "string" && src.startsWith("blob:")) {
          if ("removeAttribute" in el) el.removeAttribute("src");
          if (typeof el.load === "function") el.load();
        }
        if (el.tagName === "A" && href.startsWith("blob:")) {
          el.removeAttribute("href");
          el.hidden = true;
        }
      } catch (_) {
        /* ignore */
      }
    });
    document.querySelectorAll("source").forEach((el) => {
      const src = el.getAttribute("src") || "";
      if (src.startsWith("blob:")) el.removeAttribute("src");
    });
  }

  function clearFileInputs() {
    document.querySelectorAll('input[type="file"]').forEach((input) => {
      try {
        input.value = "";
      } catch (_) {
        /* ignore */
      }
    });
  }

  async function clearCacheStorage(opts = {}) {
    if (!window.caches?.keys) return 0;
    try {
      const keys = await caches.keys();
      const includePersist = Boolean(opts.includePersist);
      const selected = includePersist
        ? keys
        : keys.filter((k) => !String(k).startsWith("devtools-persist-"));
      await Promise.all(selected.map((k) => caches.delete(k)));
      return selected.length;
    } catch (_) {
      return 0;
    }
  }

  async function deleteIndexedDb(name) {
    if (!name || !window.indexedDB?.deleteDatabase) return false;
    return new Promise((resolve) => {
      try {
        const req = indexedDB.deleteDatabase(name);
        req.onsuccess = () => resolve(true);
        req.onerror = () => resolve(false);
        req.onblocked = () => resolve(true);
      } catch (_) {
        resolve(false);
      }
    });
  }

  async function deleteSiteIndexedDbs() {
    const names = new Set(["devtools-persist-ffmpeg"]);
    const preserve = new Set(["devtools-memo-v1"]);
    try {
      if (typeof indexedDB.databases === "function") {
        const list = await indexedDB.databases();
        (list || []).forEach((d) => {
          const name = String(d?.name || "");
          if (name.startsWith("devtools") && !preserve.has(name)) names.add(name);
        });
      }
    } catch (_) {
      /* Safari 可能不支持 databases() */
    }
    let deleted = 0;
    for (const name of names) {
      if (preserve.has(name)) continue;
      if (await deleteIndexedDb(name)) deleted += 1;
    }
    return deleted;
  }

  async function refreshCacheHint() {
    const el = document.getElementById("nav-cache-meta");
    if (!el) return;
    const blobs = blobStats();
    const est = await storageStats();
    let memoBytes = 0;
    try {
      memoBytes = Number(await window.DevToolsMemo?.getStorageBytes?.()) || 0;
    } catch (_) {
      memoBytes = 0;
    }
    const parts = [];
    // 站点占用里尽量不把备忘录数据说成「缓存」
    const cacheish = Math.max(0, (Number(est?.usage) || 0) - memoBytes);
    if (cacheish > 0) parts.push(`缓存 ${formatBytes(cacheish)}`);
    if (memoBytes > 0) parts.push(`备忘录 ${formatBytes(memoBytes)}`);
    if (blobs.bytes > 0) parts.push(`临时 ${formatBytes(blobs.bytes)}`);
    el.title = "缓存可一键清理；备忘录数据不会被清掉";
    el.textContent = parts.length ? parts.join(" · ") : "暂无缓存";
  }

  /** 一键清掉本站临时视频/GIF 和编码器磁盘缓存（不动备忘录数据；系统相册已下载文件也不动） */
  async function purgeSiteCache() {
    const before = await storageStats();
    await clearAll();
    try {
      await window.DevToolsTemp.purgePersistedEngine?.();
    } catch (_) {
      /* ignore */
    }
    const idbCount = await deleteSiteIndexedDbs();
    const cacheCount = await clearCacheStorage({ includePersist: true });
    try {
      if (typeof window.gc === "function") window.gc();
    } catch (_) {}
    await refreshCacheHint();
    const after = await storageStats();
    const freed = Math.max(0, (Number(before?.usage) || 0) - (Number(after?.usage) || 0));
    const message =
      freed >= 1024 * 1024
        ? `已清理约 ${formatBytes(freed)}（备忘录数据已保留；清理前仍建议导出备份）`
        : "已清理本站临时文件和编码器缓存（备忘录数据已保留）";
    return { before, after, freed, idbCount, cacheCount, message };
  }

  /** 创建不计入临时跟踪的 Object URL（用于持久引擎等） */
  function createPersistentObjectURL(obj) {
    return origCreate(obj);
  }

  function revokePersistentObjectURL(url) {
    try {
      origRevoke(url);
    } catch (_) {
      /* ignore */
    }
  }

  function revokeAllTracked() {
    const urls = [...tracked.keys()];
    for (const url of urls) {
      try {
        origRevoke(url);
      } catch (_) {
        /* ignore */
      }
      tracked.delete(url);
    }
    return urls.length;
  }

  function releaseEngine() {
    try {
      window.DevToolsTemp.releaseEngine?.();
    } catch (_) {
      /* ignore */
    }
  }

  /** 关闭标签 / 离开页面：同步丢掉本次视频、GIF 与编码器内存拷贝 */
  function releaseOnLeave() {
    if (unloading) return 0;
    unloading = true;
    window.DevToolsTemp.isUnloading = true;
    releaseEngine();
    for (const fn of cleaners) {
      try {
        fn();
      } catch (_) {
        /* ignore */
      }
    }
    stripBlobMedia();
    clearFileInputs();
    return revokeAllTracked();
  }

  async function clearAll() {
    const before = blobStats();
    for (const fn of cleaners) {
      try {
        fn();
      } catch (_) {
        /* ignore */
      }
    }
    // Click known clear buttons as a second pass for tools that keep private state.
    ["#gif-clear", "#gifx-clear", "#v2g-clear", "#gifc-clear", "#imgkit-clear", "#vbb-clear", "#vsplit-clear"].forEach(
      (sel) => {
        try {
          document.querySelector(sel)?.click();
        } catch (_) {
          /* ignore */
        }
      }
    );
    stripBlobMedia();
    clearFileInputs();
    const revoked = revokeAllTracked();
    const cacheCount = await clearCacheStorage();
    try {
      if (typeof window.gc === "function") window.gc();
    } catch (_) {
      /* ignore */
    }
    return { before, revoked, cacheCount, after: blobStats() };
  }

  function registerCleanup(fn) {
    if (typeof fn === "function") cleaners.push(fn);
  }

  window.addEventListener("pagehide", (ev) => {
    if (ev.persisted) {
      // 进后台 / 往返缓存：丢掉编码器里的视频拷贝，避免后台继续占几百 MB
      releaseEngine();
      return;
    }
    releaseOnLeave();
  });
  window.addEventListener("beforeunload", () => {
    releaseOnLeave();
  });

  window.DevToolsTemp = {
    registerCleanup,
    blobStats,
    storageStats,
    clearAll,
    purgeSiteCache,
    releaseOnLeave,
    formatBytes,
    refresh: refreshCacheHint,
    createPersistentObjectURL,
    revokePersistentObjectURL,
    persistCachePrefix: "devtools-persist-",
    autoReleaseOnLeave: true,
    isUnloading: false,
    releaseEngine: null,
    purgePersistedEngine: null,
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      refreshCacheHint();
    });
  } else {
    refreshCacheHint();
  }
})();

