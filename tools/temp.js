(() => {
  "use strict";

  const tracked = new Map(); // url -> { size, kind, at }
  const cleaners = [];
  const origCreate = URL.createObjectURL.bind(URL);
  const origRevoke = URL.revokeObjectURL.bind(URL);

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
    scheduleRefresh();
    return url;
  };

  URL.revokeObjectURL = (url) => {
    tracked.delete(url);
    origRevoke(url);
    scheduleRefresh();
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

  /** 创建不计入「临时占用」的 Object URL（用于持久引擎等） */
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
    ["#gif-clear", "#gifx-clear", "#v2g-clear", "#gifc-clear", "#imgkit-clear"].forEach((sel) => {
      try {
        document.querySelector(sel)?.click();
      } catch (_) {
        /* ignore */
      }
    });
    stripBlobMedia();
    clearFileInputs();
    const revoked = revokeAllTracked();
    const cacheCount = await clearCacheStorage();
    // Hint GC for decoded video frames / detached buffers when available.
    try {
      if (typeof window.gc === "function") window.gc();
    } catch (_) {
      /* ignore */
    }
    await refreshUi();
    return { before, revoked, cacheCount, after: blobStats() };
  }

  function registerCleanup(fn) {
    if (typeof fn === "function") cleaners.push(fn);
  }

  const api = {
    registerCleanup,
    blobStats,
    storageStats,
    clearAll,
    formatBytes,
    refresh: refreshUi,
    createPersistentObjectURL,
    revokePersistentObjectURL,
    persistCachePrefix: "devtools-persist-",
  };
  window.DevToolsTemp = api;

  let refreshTimer = 0;
  function scheduleRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      refreshUi().catch(() => {});
    }, 120);
  }

  async function refreshUi() {
    const blobMeta = document.querySelector("#temp-blob-meta");
    const storeMeta = document.querySelector("#temp-store-meta");
    const summaryMeta = document.querySelector("#temp-summary-meta");
    const bar = document.querySelector("#temp-bar");
    if (!bar) return;

    const blob = blobStats();
    if (blobMeta) {
      blobMeta.textContent =
        blob.count > 0
          ? `本页临时文件：${formatBytes(blob.bytes)}（${blob.count} 项${blob.fileBytes ? `，含上传约 ${formatBytes(blob.fileBytes)}` : ""}）`
          : "本页临时文件：接近 0（无活跃 Blob URL）";
    }

    const store = await storageStats();
    let storeText = "站点存储：—";
    if (storeMeta) {
      if (!store) {
        storeText = "站点存储：当前浏览器不支持估算";
      } else {
        const quotaText = store.quota > 0 ? ` / 配额 ${formatBytes(store.quota)}` : "";
        storeText = `站点存储：${formatBytes(store.usage)}${quotaText}`;
      }
      storeMeta.textContent = storeText;
    }

    if (summaryMeta) {
      summaryMeta.textContent =
        blob.count > 0
          ? `${formatBytes(blob.bytes)} · ${blob.count} 项`
          : "接近 0";
    }

    bar.dataset.hasTemp = blob.count > 0 ? "1" : "0";
  }

  function toast(msg) {
    const el = document.querySelector("#toast");
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

  function runClear(triggerBtn) {
    const buttons = [document.querySelector("#temp-clear"), document.querySelector("#temp-clear-compact")].filter(
      Boolean
    );
    buttons.forEach((btn) => {
      btn.disabled = true;
    });
    if (triggerBtn) triggerBtn.disabled = true;
    return clearAll()
      .then((result) => {
        const freed = Math.max(0, (result.before.bytes || 0) - (result.after.bytes || 0));
        toast(
          freed > 0
            ? `已清理临时文件约 ${formatBytes(freed)}`
            : "已执行清理（主要释放页面内存中的上传/预览）"
        );
        const bar = document.querySelector("#temp-bar");
        const toggle = document.querySelector("#temp-toggle");
        if (bar) bar.dataset.expanded = "0";
        if (toggle) toggle.setAttribute("aria-expanded", "false");
      })
      .catch((err) => toast(err.message || String(err)))
      .finally(() => {
        buttons.forEach((btn) => {
          btn.disabled = false;
        });
      });
  }

  function bindUi() {
    const refreshBtn = document.querySelector("#temp-refresh");
    const clearBtn = document.querySelector("#temp-clear");
    const clearCompactBtn = document.querySelector("#temp-clear-compact");
    const toggleBtn = document.querySelector("#temp-toggle");
    const bar = document.querySelector("#temp-bar");

    toggleBtn?.addEventListener("click", () => {
      if (!bar) return;
      const next = bar.dataset.expanded === "1" ? "0" : "1";
      bar.dataset.expanded = next;
      toggleBtn.setAttribute("aria-expanded", next === "1" ? "true" : "false");
    });

    refreshBtn?.addEventListener("click", () => {
      refreshUi()
        .then(() => toast("已刷新占用信息"))
        .catch(() => {});
    });
    clearBtn?.addEventListener("click", () => {
      runClear(clearBtn);
    });
    clearCompactBtn?.addEventListener("click", () => {
      runClear(clearCompactBtn);
    });
    refreshUi().catch(() => {});
    // Periodic light refresh while page is visible
    setInterval(() => {
      if (document.visibilityState === "visible") refreshUi().catch(() => {});
    }, 8000);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindUi, { once: true });
  } else {
    bindUi();
  }
})();
