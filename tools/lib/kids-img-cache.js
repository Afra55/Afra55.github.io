(() => {
  "use strict";

  /**
   * 幼儿认物配图：带进度下载 + Cache API 持久缓存。
   * 跨域时常拿不到 Content-Length，因此：
   * - 有真实字节 → 显示真百分比
   * - 否则 → 平滑模拟进度（到 90%），完成时到 100%
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

  /** 进度泵：无 Content-Length 时也能看到进度在走 */
  function createProgressPump(onProgress) {
    let fake = 6;
    let real = null;
    let stopped = false;
    const emit = () => {
      if (stopped || !onProgress) return;
      if (real != null && real >= 0) {
        onProgress({ loaded: 0, total: 0, percent: real });
      } else {
        onProgress({ loaded: 0, total: 0, percent: Math.min(90, Math.round(fake)) });
      }
    };
    emit();
    const timer = window.setInterval(() => {
      if (stopped) return;
      if (real != null && real >= 0) return;
      fake += Math.max(0.8, (92 - fake) * 0.07);
      emit();
    }, 180);
    return {
      onReal(p) {
        if (stopped) return;
        const pct = typeof p?.percent === "number" ? p.percent : -1;
        if (pct >= 0) {
          real = pct;
          emit();
        }
      },
      done() {
        if (stopped) return;
        stopped = true;
        window.clearInterval(timer);
        onProgress?.({ loaded: 1, total: 1, percent: 100 });
      },
      fail() {
        if (stopped) return;
        stopped = true;
        window.clearInterval(timer);
      },
    };
  }

  function fetchBlobWithProgress(url, onRealProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.responseType = "blob";
      xhr.timeout = 22000;
      try {
        xhr.setRequestHeader("Accept", "image/avif,image/webp,image/*,*/*");
      } catch (_) {
        /* ignore */
      }
      xhr.onprogress = (ev) => {
        if (!onRealProgress) return;
        if (ev.lengthComputable && ev.total > 0) {
          const percent = Math.max(0, Math.min(99, Math.round((ev.loaded / ev.total) * 100)));
          onRealProgress({ loaded: ev.loaded, total: ev.total, percent });
        }
        // 无 total 时不打断模拟进度
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300 && xhr.response) resolve(xhr.response);
        else reject(new Error(`image http ${xhr.status}`));
      };
      xhr.onerror = () => reject(new Error("image network error"));
      xhr.ontimeout = () => reject(new Error("image timeout"));
      xhr.send();
    });
  }

  function probeViaImage(url, timeoutMs = 10000) {
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
      window.setTimeout(() => finish(false), timeoutMs);
      img.referrerPolicy = "no-referrer";
      img.decoding = "async";
      img.src = url;
    });
  }

  /**
   * @param {object} item { id, commons?, query?, nameEn? }
   * @param {object} opts { onProgress?, namespace? }
   */
  async function resolveItemImage(item, opts = {}) {
    if (!item) return { url: "", credit: "", fromCache: false };
    const ns = opts.namespace || "kids";
    const cacheKey = `${ns}:${item.id}`;
    const m = loadMeta();
    const pump = createProgressPump(opts.onProgress);

    try {
      // 1) Cache API 命中
      const cached = await getCachedBlobUrl(cacheKey);
      if (cached) {
        pump.done();
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

      const tryOne = async (cand) => {
        // 优先 XHR 拉二进制（可缓存 + 可能有真进度）
        try {
          const blob = await fetchBlobWithProgress(cand.url, (p) => pump.onReal(p));
          if (blob && blob.size) {
            const type = blob.type || "image/jpeg";
            if (!type.startsWith("image/") && type !== "application/octet-stream") {
              throw new Error("not image");
            }
            const response = new Response(blob, {
              status: 200,
              headers: { "Content-Type": type.startsWith("image/") ? type : "image/jpeg" },
            });
            await putCache(cacheKey, response.clone());
            m[cacheKey] = { credit: cand.credit || "", at: Date.now(), src: cand.url };
            saveMeta();
            pump.done();
            return {
              url: URL.createObjectURL(blob),
              credit: cand.credit || "",
              fromCache: false,
            };
          }
        } catch (_) {
          /* CORS 等：改走 <img> 热链，模拟进度继续跑 */
        }

        if (await probeViaImage(cand.url)) {
          m[cacheKey] = {
            credit: cand.credit || "",
            at: Date.now(),
            src: cand.url,
            hotlink: true,
          };
          saveMeta();
          pump.done();
          return { url: cand.url, credit: cand.credit || "", fromCache: false };
        }
        return null;
      };

      for (const cand of candidates) {
        const hit = await tryOne(cand);
        if (hit?.url) return hit;
      }

      await pushOpenverse();
      for (const cand of candidates.slice(item.commons ? 1 : 0)) {
        const hit = await tryOne(cand);
        if (hit?.url) return hit;
      }

      pump.fail();
      return { url: "", credit: "", fromCache: false };
    } catch (err) {
      pump.fail();
      throw err;
    }
  }

  window.DevToolsKidsImg = {
    commonsUrl,
    resolveItemImage,
    CACHE_NAME,
  };
})();
