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

  async function clearCacheStorage() {
    if (!window.caches?.keys) return 0;
    try {
      const keys = await caches.keys();
      // 持久资源（如 FFmpeg 引擎）永不随「清理临时」删除
      const ephemeral = keys.filter((k) => !String(k).startsWith("devtools-persist-"));
      await Promise.all(ephemeral.map((k) => caches.delete(k)));
      return ephemeral.length;
    } catch (_) {
      return 0;
    }
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
    releaseOnLeave,
    formatBytes,
    refresh: async () => {},
    createPersistentObjectURL,
    revokePersistentObjectURL,
    persistCachePrefix: "devtools-persist-",
    autoReleaseOnLeave: true,
    isUnloading: false,
    releaseEngine: null,
  };
})();
