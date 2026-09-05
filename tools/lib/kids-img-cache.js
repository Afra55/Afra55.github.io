(() => {
  "use strict";

  /**
   * 幼儿认物配图：带进度下载 + Cache API 持久缓存（跨会话复用二进制）。
   * 暴露 window.DevToolsKidsImg
   */
  const CACHE_NAME = "devtools-kids-img-v1";
  const META_KEY = "devtools-kids-img-meta-v1";

  let meta = null;

  function loadMeta() {
    if (meta) return meta;
    try {
      meta = JSON.parse(localStorage.getItem(META_KEY) || "{}") || {};
    } catch (_) {
      meta = {};
    }
    return meta;
  }

  function saveMeta() {
    try {
      localStorage.setItem(META_KEY, JSON.stringify(meta || {}));
    } catch (_) {
      /* quota */
    }
  }

  function commonsUrl(file, width = 900) {
    if (!file) return "";
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=${width}`;
  }

  async function openCache() {
    if (!("caches" in window)) return null;
    try {
      return await caches.open(CACHE_NAME);
    } catch (_) {
      return null;
    }
  }

  async function getCachedBlobUrl(cacheKey) {
    const cache = await openCache();
    if (!cache) return "";
    try {
      const res = await cache.match(cacheKey);
      if (!res || !res.ok) return "";
      const blob = await res.blob();
      if (!blob || !blob.size) return "";
      return URL.createObjectURL(blob);
    } catch (_) {
      return "";
    }
  }

  async function putCache(cacheKey, response) {
    const cache = await openCache();
    if (!cache || !response) return;
    try {
      await cache.put(cacheKey, response);
    } catch (_) {
      /* ignore */
    }
  }

  /**
   * 带进度拉取图片，写入 Cache，返回 blob: URL。
   * onProgress({ loaded, total, percent })
   */
  function fetchImageWithProgress(url, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.responseType = "blob";
      xhr.timeout = 20000;
      xhr.setRequestHeader("Accept", "image/*,*/*");
      xhr.onprogress = (ev) => {
        if (!onProgress) return;
        if (ev.lengthComputable && ev.total > 0) {
          const percent = Math.max(0, Math.min(100, Math.round((ev.loaded / ev.total) * 100)));
          onProgress({ loaded: ev.loaded, total: ev.total, percent });
        } else {
          onProgress({ loaded: ev.loaded || 0, total: 0, percent: -1 });
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300 && xhr.response) {
          resolve(xhr.response);
        } else {
          reject(new Error(`image http ${xhr.status}`));
        }
      };
      xhr.onerror = () => reject(new Error("image network error"));
      xhr.ontimeout = () => reject(new Error("image timeout"));
      xhr.send();
    });
  }

  async function probeViaImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        resolve(ok);
      };
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      window.setTimeout(() => finish(false), 8000);
      img.referrerPolicy = "no-referrer";
      img.src = url;
    });
  }

  /**
   * @param {object} item { id, commons?, query?, nameEn? }
   * @param {object} opts { onProgress?, namespace? }
   * @returns {Promise<{ url: string, credit: string, fromCache: boolean }>}
   */
  async function resolveItemImage(item, opts = {}) {
    if (!item) return { url: "", credit: "", fromCache: false };
    const ns = opts.namespace || "kids";
    const cacheKey = `${ns}:${item.id}`;
    const m = loadMeta();

    // 1) 本地 Cache 命中
    const cached = await getCachedBlobUrl(cacheKey);
    if (cached) {
      return {
        url: cached,
        credit: m[cacheKey]?.credit || "",
        fromCache: true,
      };
    }

    const candidates = [];
    if (item.commons) {
      candidates.push({
        url: commonsUrl(item.commons),
        credit: `Wikimedia Commons · ${item.commons}`,
      });
    }

    // Openverse 兜底（仅当 commons 失败时再请求）
    async function pushOpenverse() {
      try {
        const q = encodeURIComponent(item.query || item.nameEn || item.id);
        const api = `https://api.openverse.org/v1/images/?q=${q}&license=cc0,by,by-sa&page_size=5`;
        const res = await fetch(api, { headers: { Accept: "application/json" } });
        if (!res.ok) return;
        const data = await res.json();
        for (const row of data.results || []) {
          const url = row.url || row.thumbnail || "";
          if (!url) continue;
          candidates.push({
            url,
            credit: [row.license, row.creator, "Openverse"].filter(Boolean).join(" · "),
          });
        }
      } catch (_) {
        /* ignore */
      }
    }

    const tryDownload = async (cand) => {
      opts.onProgress?.({ loaded: 0, total: 0, percent: 0 });
      try {
        const blob = await fetchImageWithProgress(cand.url, opts.onProgress);
        if (!blob || !blob.size) return null;
        const type = blob.type || "image/jpeg";
        if (type && !type.startsWith("image/") && type !== "application/octet-stream") {
          return null;
        }
        const response = new Response(blob, {
          status: 200,
          headers: { "Content-Type": type.startsWith("image/") ? type : "image/jpeg" },
        });
        await putCache(cacheKey, response.clone());
        m[cacheKey] = { credit: cand.credit || "", at: Date.now(), src: cand.url };
        saveMeta();
        opts.onProgress?.({ loaded: blob.size, total: blob.size, percent: 100 });
        return {
          url: URL.createObjectURL(blob),
          credit: cand.credit || "",
          fromCache: false,
        };
      } catch (_) {
        // XHR 可能被 CORS 拦；退回 <img> 探测直链（无进度、不落盘二进制）
        if (await probeViaImage(cand.url)) {
          m[cacheKey] = { credit: cand.credit || "", at: Date.now(), src: cand.url, hotlink: true };
          saveMeta();
          opts.onProgress?.({ loaded: 1, total: 1, percent: 100 });
          return { url: cand.url, credit: cand.credit || "", fromCache: false };
        }
        return null;
      }
    };

    // 先试 commons
    for (const cand of candidates) {
      const hit = await tryDownload(cand);
      if (hit?.url) return hit;
    }

    await pushOpenverse();
    for (const cand of candidates.slice(item.commons ? 1 : 0)) {
      const hit = await tryDownload(cand);
      if (hit?.url) return hit;
    }

    return { url: "", credit: "", fromCache: false };
  }

  window.DevToolsKidsImg = {
    commonsUrl,
    resolveItemImage,
    CACHE_NAME,
  };
})();
