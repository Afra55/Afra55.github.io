(() => {
  "use strict";

  const P = window.DevToolsPure;
  if (!P) return;
  const K = window.DevToolsExtraKit;
  const $ = K.$;
  const $$ = K.$$;
  const setError = K.setError;
  const toast = K.toast;
  const formatKb = K.formatKb;
  const escapeHtml = P.escapeHtml;

  const TOOLS_VERSION = window.TOOLS_BUILD || "2026.08.29-234500";
  /** @deprecated 兼容旧冒烟/书签；与 TOOLS_VERSION 相同 */
  const GIF_TOOL_VERSION = TOOLS_VERSION;
  /** 切片/批量 GIF 产出后是否自动打 zip 下载；默认关，开启后记住 */
  const AUTO_PACK_ZIP_KEY = "devtools-auto-pack-zip-v1";

  function isAutoPackZipEnabled() {
    try {
      return localStorage.getItem(AUTO_PACK_ZIP_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function setAutoPackZipEnabled(on) {
    try {
      localStorage.setItem(AUTO_PACK_ZIP_KEY, on ? "1" : "0");
    } catch (_) {
      /* ignore */
    }
  }

  function syncAutoPackZipToggles(checked) {
    document.querySelectorAll("[data-auto-pack-zip]").forEach((el) => {
      if (el instanceof HTMLInputElement) el.checked = checked;
    });
  }

  function bindAutoPackZipToggles() {
    const boxes = [...document.querySelectorAll("[data-auto-pack-zip]")].filter(
      (el) => el instanceof HTMLInputElement
    );
    const initial = isAutoPackZipEnabled();
    syncAutoPackZipToggles(initial);
    boxes.forEach((el) => {
      el.addEventListener("change", () => {
        const on = Boolean(el.checked);
        setAutoPackZipEnabled(on);
        syncAutoPackZipToggles(on);
        toast(on ? "已开启：产出后自动打包下载" : "已关闭：产出后需手动打包");
      });
    });
    try {
      window.DevToolsAutoPackZip = {
        isEnabled: isAutoPackZipEnabled,
        setEnabled: (on) => {
          setAutoPackZipEnabled(on);
          syncAutoPackZipToggles(Boolean(on));
        },
      };
    } catch (_) {
      /* ignore */
    }
  }

  const GIF_COMPRESS_PRESETS = {
    light: { label: "轻度", baseLossy: 35 },
    standard: { label: "标准", baseLossy: 55 },
    strong: { label: "强力", baseLossy: 90 },
  };

  /** 探测浏览器是否能用 canvas 编码静图 WebP（动画需自行 mux） */
  function canEncodeStillWebp() {
    try {
      const c = document.createElement("canvas");
      c.width = 1;
      c.height = 1;
      return c.toDataURL("image/webp").indexOf("data:image/webp") === 0;
    } catch (_) {
      return false;
    }
  }

  /** gif.js quality(1好–30差) → canvas WebP quality(0–1，越大越好) */
  function gifQualityToWebpQuality(q) {
    const gq = Math.min(30, Math.max(1, Number(q) || 12));
    return Math.max(0.35, Math.min(0.95, 1.02 - gq / 40));
  }

  /** gif.js quality → ffmpeg palettegen max_colors */
  function gifQualityToMaxColors(q) {
    const gq = Math.min(30, Math.max(1, Number(q) || 12));
    return Math.max(96, Math.min(256, Math.round(256 - (gq - 1) * (160 / 29))));
  }

  /** 视频转 GIF：ffmpeg.wasm（本地 vendor），进入 GIF 工具时预热并持久保存 */
  function resolveFfmpegVendorBase() {
    const nodes = document.getElementsByTagName("script");
    for (let i = nodes.length - 1; i >= 0; i--) {
      const src = nodes[i].src || "";
      if (/extra\.js(\?|#|$)/i.test(src)) {
        return new URL("./vendor/ffmpeg/", src);
      }
    }
    return new URL("./vendor/ffmpeg/", document.baseURI || window.location.href);
  }

  const FFMPEG_VENDOR_BASE = resolveFfmpegVendorBase();
  /** IndexedDB / Cache 均用 persist 前缀；侧栏「一键清理缓存」可整库删除 */
  const FFMPEG_IDB_NAME = "devtools-persist-ffmpeg";
  const FFMPEG_IDB_STORE = "assets";
  const FFMPEG_IDB_VERSION = 1;
  const FFMPEG_ASSET_KEY_CORE = "core-js-0.12.6";
  const FFMPEG_ASSET_KEY_WASM = "core-wasm-0.12.6";
  let ffmpegModsPromise = null;
  let ffmpegInstance = null;
  /** 预热后的资源 blob（持久，不计入临时占用，也不随清理撤销） */
  let ffmpegAssetBlobs = null;
  let ffmpegWarmPromise = null;
  /** @type {"idle"|"warming"|"ready"|"error"} */
  let ffmpegWarmState = "idle";
  let ffmpegWarmError = "";
  let ffmpegWarmDetail = { ratio: 0, text: "" };
  /**
   * 当前引擎实例里已写入的源视频，避免大文件每段都 arrayBuffer+writeFile（手机易白屏）。
   * @type {null|{key:string,name:string}}
   */
  let ffmpegCachedInput = null;
  const FFMPEG_SEG_FILE_BYTES = 48 * 1024 * 1024;
  /** 用户点「一键清理缓存」后，不再自动预热，以免马上重新占空间 */
  let ffmpegSkipAutoPrewarm = false;
  let ffmpegEngineEpoch = 0;

  function loadFfmpegMods() {
    if (!ffmpegModsPromise) {
      const entry = new URL("ff/index.js", FFMPEG_VENDOR_BASE).href;
      ffmpegModsPromise = import(entry)
        .then((ff) => ({ FFmpeg: ff.FFmpeg }))
        .catch((err) => {
          ffmpegModsPromise = null;
          throw err;
        });
    }
    return ffmpegModsPromise;
  }

  async function fetchFileBytes(file, onProgress) {
    if (!file) throw new Error("缺少文件");
    if (file instanceof Uint8Array) return file;
    const size = Number(file.size) || 0;
    const note = (ratio, read, total) => {
      if (total >= 1024 * 1024) {
        return `本地读取 ${formatKb(read)} / ${formatKb(total)}（不上传）`;
      }
      return ratio >= 1 ? "本地读取完成（未上传）" : "本地读取（不上传）…";
    };
    if (!size || size < 4 * 1024 * 1024 || typeof file.slice !== "function") {
      onProgress?.(0.35, "本地读取（不上传）…");
      const buf = new Uint8Array(await file.arrayBuffer());
      onProgress?.(1, "本地读取完成（未上传）");
      return buf;
    }
    const chunkSize = 4 * 1024 * 1024;
    const out = new Uint8Array(size);
    let offset = 0;
    while (offset < size) {
      const end = Math.min(offset + chunkSize, size);
      const chunk = new Uint8Array(await file.slice(offset, end).arrayBuffer());
      out.set(chunk, offset);
      offset = end;
      onProgress?.(offset / size, note(offset / size, offset, size));
    }
    return out;
  }

  function ffmpegInputKey(file) {
    if (!file) return "";
    return `${file.name || "file"}:${file.size || 0}:${file.lastModified || 0}`;
  }

  function guessVideoExt(file) {
    const name = String(file?.name || "").toLowerCase();
    if (name.endsWith(".webm")) return "webm";
    if (name.endsWith(".mov")) return "mov";
    if (name.endsWith(".m4v")) return "m4v";
    if (name.endsWith(".mkv")) return "mkv";
    return "mp4";
  }

  async function ensureFfmpegInputWritten(ffmpeg, file, onWrite) {
    const ext = guessVideoExt(file);
    const inName = `in.${ext}`;
    const key = ffmpegInputKey(file);
    if (ffmpegCachedInput?.key === key && ffmpegCachedInput?.name === inName) {
      return inName;
    }
    if (ffmpegCachedInput?.name) {
      try {
        await ffmpeg.deleteFile(ffmpegCachedInput.name);
      } catch (_) {}
      ffmpegCachedInput = null;
    }
    onWrite?.(0, "载入本地编码器（不上传）…");
    await ffmpeg.writeFile(inName, await fetchFileBytes(file, onWrite));
    onWrite?.(1, "已载入本地编码器（未上传）");
    ffmpegCachedInput = { key, name: inName };
    return inName;
  }

  function clearFfmpegInputCache() {
    ffmpegCachedInput = null;
  }

  function openFfmpegIdb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) {
        reject(new Error("当前浏览器不支持 IndexedDB"));
        return;
      }
      const req = indexedDB.open(FFMPEG_IDB_NAME, FFMPEG_IDB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(FFMPEG_IDB_STORE)) {
          db.createObjectStore(FFMPEG_IDB_STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("打开 IndexedDB 失败"));
    });
  }

  async function idbGetAsset(key) {
    let db = null;
    try {
      db = await openFfmpegIdb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(FFMPEG_IDB_STORE, "readonly");
        const req = tx.objectStore(FFMPEG_IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error || new Error("读取引擎缓存失败"));
      });
    } catch (_) {
      return null;
    } finally {
      try {
        db?.close();
      } catch (_) {}
    }
  }

  async function idbPutAsset(key, buffer) {
    let db = null;
    try {
      db = await openFfmpegIdb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(FFMPEG_IDB_STORE, "readwrite");
        tx.objectStore(FFMPEG_IDB_STORE).put(buffer, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error || new Error("写入引擎缓存失败"));
      });
    } catch (_) {
      /* private mode / quota：忽略，仍可用本次内存 blob */
    } finally {
      try {
        db?.close();
      } catch (_) {}
    }
  }

  function deleteFfmpegIndexedDb() {
    return new Promise((resolve) => {
      if (!window.indexedDB?.deleteDatabase) {
        resolve(false);
        return;
      }
      const req = indexedDB.deleteDatabase(FFMPEG_IDB_NAME);
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
      req.onblocked = () => resolve(true);
    });
  }

  async function purgePersistedEngine() {
    ffmpegSkipAutoPrewarm = true;
    ffmpegEngineEpoch += 1;
    terminateFfmpegInstance({ revokeAssets: true });
    ffmpegWarmState = "idle";
    ffmpegWarmError = "";
    ffmpegWarmPromise = null;
    const ok = await deleteFfmpegIndexedDb();
    paintFfmpegWarmHint();
    return ok;
  }

  function createEngineObjectURL(buf, mime) {
    const blob = new Blob([buf], { type: mime });
    if (window.DevToolsTemp?.createPersistentObjectURL) {
      return window.DevToolsTemp.createPersistentObjectURL(blob);
    }
    // 无 temp 钩子时退回原生 API（同样不进临时统计）
    return URL.createObjectURL(blob);
  }

  async function fetchArrayBufferProgress(url, onProgress, label, progressFrom, progressTo) {
    onProgress?.(progressFrom, `${label}…`);
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      throw new Error(`${label}网络失败：${err?.message || err}（${url}）`);
    }
    if (!res.ok) throw new Error(`${label}下载失败 HTTP ${res.status}（${url}）`);
    const total = Number(res.headers.get("content-length")) || 0;
    if (!res.body || !total || typeof res.body.getReader !== "function") {
      const buf = await res.arrayBuffer();
      onProgress?.(progressTo, `${label}完成`);
      return buf;
    }
    const reader = res.body.getReader();
    const chunks = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      const ratio = Math.min(1, received / total);
      const mb = (received / (1024 * 1024)).toFixed(1);
      const totalMb = (total / (1024 * 1024)).toFixed(1);
      onProgress?.(
        progressFrom + (progressTo - progressFrom) * ratio,
        `${label} ${mb}/${totalMb} MB`
      );
    }
    const merged = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    onProgress?.(progressTo, `${label}完成`);
    return merged.buffer;
  }

  async function loadEngineBuffer(key, url, onProgress, label, progressFrom, progressTo) {
    const cached = await idbGetAsset(key);
    if (cached instanceof ArrayBuffer && cached.byteLength > 0) {
      onProgress?.(progressTo, `${label}（本地已存）`);
      return cached;
    }
    if (cached?.buffer instanceof ArrayBuffer && cached.byteLength > 0) {
      // 偶发存成 TypedArray
      const copy = cached.buffer.slice(cached.byteOffset, cached.byteOffset + cached.byteLength);
      onProgress?.(progressTo, `${label}（本地已存）`);
      return copy;
    }
    const buf = await fetchArrayBufferProgress(url, onProgress, label, progressFrom, progressTo);
    await idbPutAsset(key, buf);
    return buf;
  }

  async function ensureFfmpegAssets(onProgress) {
    if (ffmpegAssetBlobs?.coreBlob && ffmpegAssetBlobs?.wasmBlob) return ffmpegAssetBlobs;
    const coreJsURL = new URL("core/ffmpeg-core.js", FFMPEG_VENDOR_BASE).href;
    const wasmURL = new URL("core/ffmpeg-core.wasm", FFMPEG_VENDOR_BASE).href;
    const workerURL = new URL("ff/worker.js", FFMPEG_VENDOR_BASE).href;
    const coreBuf = await loadEngineBuffer(
      FFMPEG_ASSET_KEY_CORE,
      coreJsURL,
      onProgress,
      "首次准备本地编码器 core.js",
      0.04,
      0.08
    );
    const wasmBuf = await loadEngineBuffer(
      FFMPEG_ASSET_KEY_WASM,
      wasmURL,
      onProgress,
      "首次准备本地编码器 wasm",
      0.08,
      0.18
    );
    ffmpegAssetBlobs = {
      coreBlob: createEngineObjectURL(coreBuf, "text/javascript"),
      wasmBlob: createEngineObjectURL(wasmBuf, "application/wasm"),
      workerURL,
    };
    return ffmpegAssetBlobs;
  }

  async function getFfmpegInstance(onProgress) {
    ffmpegSkipAutoPrewarm = false;
    if (ffmpegInstance?.loaded) return ffmpegInstance;
    const epoch = ffmpegEngineEpoch;
    onProgress?.(0.02, "加载 FFmpeg 模块…");
    const { FFmpeg } = await loadFfmpegMods();
    const assets = await ensureFfmpegAssets(onProgress);

    onProgress?.(0.19, "初始化 FFmpeg Worker…");
    const ffmpeg = new FFmpeg();
    try {
      await ffmpeg.load({
        classWorkerURL: assets.workerURL,
        coreURL: assets.coreBlob,
        wasmURL: assets.wasmBlob,
      });
    } catch (err) {
      try {
        ffmpeg.terminate();
      } catch (_) {
        /* ignore */
      }
      terminateFfmpegInstance({ revokeAssets: false });
      const msg = err?.message || String(err);
      throw new Error(
        /NetworkError|Failed to fetch|Aborted/i.test(msg)
          ? `FFmpeg 引擎加载失败（多为手机网络中断或内存不足，可换 Wi‑Fi / 缩短片段后重试）：${msg}`
          : `FFmpeg 引擎加载失败：${msg}`
      );
    }
    ffmpegInstance = ffmpeg;
    ffmpegWarmState = "ready";
    ffmpegWarmError = "";
    if (epoch !== ffmpegEngineEpoch) {
      try {
        ffmpeg.terminate();
      } catch (_) {}
      ffmpegInstance = null;
      throw new Error("已取消");
    }
    onProgress?.(0.22, "FFmpeg 就绪");
    paintFfmpegWarmHint();
    return ffmpeg;
  }

  function terminateFfmpegInstance({ revokeAssets = false } = {}) {
    if (ffmpegInstance) {
      try {
        ffmpegInstance.terminate();
      } catch (_) {
        /* ignore */
      }
      ffmpegInstance = null;
    }
    clearFfmpegInputCache();
    // 默认永不 revoke 引擎 blob：IndexedDB 仍在，内存 URL 也可复用；且不进临时占用清理
    if (revokeAssets && ffmpegAssetBlobs) {
      const revoke =
        window.DevToolsTemp?.revokePersistentObjectURL ||
        ((u) => {
          try {
            URL.revokeObjectURL(u);
          } catch (_) {}
        });
      try {
        revoke(ffmpegAssetBlobs.coreBlob);
      } catch (_) {}
      try {
        revoke(ffmpegAssetBlobs.wasmBlob);
      } catch (_) {}
      ffmpegAssetBlobs = null;
    }
    if (ffmpegWarmState === "ready") ffmpegWarmState = "idle";
    ffmpegWarmPromise = null;
    paintFfmpegWarmHint();
  }

  const FFMPEG_WARM_UI = [
    {
      hint: "v2g-hq-warm",
      wrap: "v2g-warm-progress",
      fill: "v2g-warm-progress-fill",
      text: "v2g-warm-progress-text",
    },
    {
      hint: "vbb-ffmpeg-warm",
      wrap: "vbb-ffmpeg-warm-progress",
      fill: "vbb-ffmpeg-warm-progress-fill",
      text: "vbb-ffmpeg-warm-progress-text",
    },
    {
      hint: "vsplit-ffmpeg-warm",
      wrap: "vsplit-ffmpeg-warm-progress",
      fill: "vsplit-ffmpeg-warm-progress-fill",
      text: "vsplit-ffmpeg-warm-progress-text",
    },
  ];

  function paintFfmpegWarmHint() {
    const genBtn = document.getElementById("v2g-generate");
    if (genBtn && ffmpegWarmState === "ready") {
      genBtn.title = "使用 FFmpeg 双通道调色板编码 GIF（引擎已就绪）";
    }
    let text = "";
    if (ffmpegWarmState === "warming") {
      text = ffmpegWarmDetail.text || "引擎预热中…";
    } else if (ffmpegWarmState === "ready") {
      text = "本地编码器已就绪（约 30MB 引擎缓存可在侧栏一键清理）";
    } else if (ffmpegWarmState === "error") {
      text = ffmpegWarmError || "引擎预热失败，转换时会重试";
    } else if (ffmpegSkipAutoPrewarm) {
      text = "编码器缓存已清理，开始转换时会重新下载";
    } else {
      text = "进入本页将预热本地编码器（不上传视频）";
    }
    const showBar = ffmpegWarmState === "warming";
    const pct = Math.max(0, Math.min(100, Math.round((ffmpegWarmDetail.ratio || 0) * 100)));
    for (const ui of FFMPEG_WARM_UI) {
      const hintEl = document.getElementById(ui.hint);
      const wrap = document.getElementById(ui.wrap);
      const fill = document.getElementById(ui.fill);
      const textEl = document.getElementById(ui.text);
      if (hintEl) hintEl.textContent = text;
      if (wrap) wrap.hidden = !showBar;
      if (fill) {
        if (showBar) {
          fill.style.width = `${pct}%`;
          fill.classList.add("is-active");
        } else {
          fill.classList.remove("is-active");
          if (ffmpegWarmState === "ready") fill.style.width = "100%";
        }
      }
      if (textEl) textEl.textContent = showBar ? ffmpegWarmDetail.text || text : "";
    }
  }

  function setFfmpegWarmProgress(ratio, text) {
    ffmpegWarmDetail = {
      ratio: Math.max(0, Math.min(1, Number(ratio) || 0)),
      text: text || ffmpegWarmDetail.text || "引擎预热中…",
    };
    paintFfmpegWarmHint();
  }

  function injectFfmpegPreloadLinks() {
    const id = "ffmpeg-preload-wasm";
    if (document.getElementById(id)) return;
    const wasm = new URL("core/ffmpeg-core.wasm", FFMPEG_VENDOR_BASE).href;
    const core = new URL("core/ffmpeg-core.js", FFMPEG_VENDOR_BASE).href;
    [
      [id, wasm, "fetch", "application/wasm"],
      ["ffmpeg-preload-core", core, "fetch", "application/javascript"],
    ].forEach(([linkId, href, as, type]) => {
      if (document.getElementById(linkId)) return;
      const link = document.createElement("link");
      link.id = linkId;
      link.rel = "preload";
      link.href = href;
      link.as = as;
      link.type = type;
      link.crossOrigin = "anonymous";
      document.head.appendChild(link);
    });
  }

  const GIF_FFMPEG_TOOLS = new Set(["gifmaker", "v2g", "gifx", "gifc", "gife", "gifm", "vsplit", "vbb", "vtrim", "audio", "vplay"]);

  function isGifmakerActive() {
    const hash = String(location.hash || "").replace(/^#/, "").toLowerCase();
    const head = hash.split(/[/?]/).filter(Boolean)[0] || "";
    if (GIF_FFMPEG_TOOLS.has(head) || hash === "media" || hash.indexOf("media/") === 0) {
      return true;
    }
    const mediaLink = document.querySelector(
      '.tool-nav-link[data-tool="gifmaker"], .tool-nav-link[data-tool="v2g"], .tool-nav-link[data-tool="vsplit"], .tool-nav-link[data-tool="vbb"], .tool-nav-link[data-tool="vtrim"], .tool-nav-link[data-tool="audio"], .tool-nav-link[data-tool="vplay"]'
    );
    if (mediaLink?.classList.contains("is-active")) return true;
    return [...GIF_FFMPEG_TOOLS, "vbb", "vtrim", "audio", "vplay"].some((id) => {
      const panel = document.getElementById(id);
      return !!(panel && panel.classList.contains("is-workspace-active") && !panel.hidden);
    });
  }

  function prewarmFfmpegEngine() {
    if (ffmpegInstance?.loaded) {
      ffmpegWarmState = "ready";
      paintFfmpegWarmHint();
      return Promise.resolve(ffmpegInstance);
    }
    if (ffmpegWarmPromise) return ffmpegWarmPromise;
    injectFfmpegPreloadLinks();
    ffmpegWarmState = "warming";
    ffmpegWarmError = "";
    setFfmpegWarmProgress(0.02, "开始预热 FFmpeg…");
    ffmpegWarmPromise = getFfmpegInstance((ratio, text) => {
      setFfmpegWarmProgress(ratio, text);
    })
      .then((ff) => {
        ffmpegWarmState = "ready";
        setFfmpegWarmProgress(1, "本地编码器已就绪（引擎缓存会保留，不是你的视频）");
        paintFfmpegWarmHint();
        return ff;
      })
      .catch((err) => {
        ffmpegWarmState = "error";
        ffmpegWarmError = err?.message || String(err);
        ffmpegWarmPromise = null;
        paintFfmpegWarmHint();
        throw err;
      });
    return ffmpegWarmPromise;
  }

  function scheduleFfmpegPrewarm() {
    if (window.DevToolsTemp?.isUnloading) return;
    if (ffmpegSkipAutoPrewarm) return;
    if (!isGifmakerActive()) return;
    const run = () => {
      prewarmFfmpegEngine().catch(() => {});
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run, { timeout: 1500 });
    } else {
      setTimeout(run, 300);
    }
  }

  function bindFfmpegPrewarmTriggers() {
    if (window.DevToolsTemp) {
      window.DevToolsTemp.releaseEngine = () => terminateFfmpegInstance({ revokeAssets: false });
      window.DevToolsTemp.purgePersistedEngine = purgePersistedEngine;
    }
    paintFfmpegWarmHint();
    scheduleFfmpegPrewarm();
    window.addEventListener("hashchange", scheduleFfmpegPrewarm);
    window.addEventListener("devtools:route", scheduleFfmpegPrewarm);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) scheduleFfmpegPrewarm();
    });
    if (typeof MutationObserver === "function") {
      [...GIF_FFMPEG_TOOLS, "vbb", "vtrim", "audio", "vplay"].forEach((id) => {
        const panel = document.getElementById(id);
        if (!panel) return;
        new MutationObserver(scheduleFfmpegPrewarm).observe(panel, {
          attributes: true,
          attributeFilter: ["class", "hidden", "style"],
        });
      });
    }
    document.addEventListener("click", (e) => {
      const t = e.target?.closest?.(
        '.tool-nav-link[data-tool="media"], [data-category-tab], .tool-nav-link[data-tool="gifmaker"], .tool-nav-link[data-tool="v2g"], .tool-nav-link[data-tool="gifx"], .tool-nav-link[data-tool="gifc"], .tool-nav-link[data-tool="gife"], .tool-nav-link[data-tool="gifm"], .tool-nav-link[data-tool="vsplit"], .tool-nav-link[data-tool="vbb"], .tool-nav-link[data-tool="vtrim"], .tool-nav-link[data-tool="audio"], .tool-nav-link[data-tool="vplay"]'
      );
      if (t) setTimeout(scheduleFfmpegPrewarm, 0);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindFfmpegPrewarmTriggers);
  } else {
    bindFfmpegPrewarmTriggers();
  }

  /**
   * 把浏览器 canvas.toBlob("image/webp") 得到的静图，封装成动画 WebP（VP8X+ANIM+ANMF）。
   * 无 WASM：浏览器负责每帧编码，这里只做容器拼接。
   */
  function encodeAnimatedWebpFromStillFrames(frames, width, height, loop = 0) {
    class ByteWriter {
      constructor() {
        this.buf = new Uint8Array(4096);
        this.len = 0;
      }
      ensure(n) {
        if (this.len + n <= this.buf.length) return;
        let cap = this.buf.length * 2;
        while (cap < this.len + n) cap *= 2;
        const next = new Uint8Array(cap);
        next.set(this.buf.subarray(0, this.len));
        this.buf = next;
      }
      u8(v) {
        this.ensure(1);
        this.buf[this.len++] = v & 0xff;
      }
      u16(v) {
        this.u8(v);
        this.u8(v >>> 8);
      }
      u24(v) {
        this.u8(v);
        this.u8(v >>> 8);
        this.u8(v >>> 16);
      }
      u32(v) {
        this.u8(v);
        this.u8(v >>> 8);
        this.u8(v >>> 16);
        this.u8(v >>> 24);
      }
      fourcc(s) {
        for (let i = 0; i < 4; i++) this.u8(s.charCodeAt(i));
      }
      bytes(b) {
        this.ensure(b.length);
        this.buf.set(b, this.len);
        this.len += b.length;
      }
      take() {
        return this.buf.subarray(0, this.len);
      }
    }

    const u32le = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

    function frameImageChunks(file) {
      let off = 12;
      const parts = [];
      let hasAlpha = false;
      while (off + 8 <= file.length) {
        const cc = String.fromCharCode(file[off], file[off + 1], file[off + 2], file[off + 3]);
        const size = u32le(file, off + 4);
        const end = off + 8 + size + (size & 1);
        if (cc !== "VP8X") {
          parts.push(file.subarray(off, Math.min(end, file.length)));
          if (cc === "ALPH") hasAlpha = true;
        }
        off = end;
      }
      let total = 0;
      for (const p of parts) total += p.length;
      const data = new Uint8Array(total);
      let at = 0;
      for (const p of parts) {
        data.set(p, at);
        at += p.length;
      }
      return { data, hasAlpha };
    }

    if (!frames || !frames.length) throw new Error("没有可封装的 WebP 帧");
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    const parsed = frames.map((f) => ({
      ...frameImageChunks(f.file),
      durationMs: f.durationMs,
    }));
    const hasAlpha = parsed.some((p) => p.hasAlpha);
    const body = new ByteWriter();

    body.fourcc("VP8X");
    body.u32(10);
    body.u8(0x02 | (hasAlpha ? 0x10 : 0));
    body.u24(0);
    body.u24(w - 1);
    body.u24(h - 1);

    body.fourcc("ANIM");
    body.u32(6);
    body.u32(0);
    body.u16(loop & 0xffff);

    for (const p of parsed) {
      const payload = 16 + p.data.length;
      body.fourcc("ANMF");
      body.u32(payload);
      body.u24(0);
      body.u24(0);
      body.u24(w - 1);
      body.u24(h - 1);
      body.u24(Math.max(0, Math.round(p.durationMs)));
      body.u8(0x02);
      body.bytes(p.data);
      if (payload & 1) body.u8(0);
    }

    const bodyBytes = body.take();
    const out = new ByteWriter();
    out.fourcc("RIFF");
    out.u32(4 + bodyBytes.length);
    out.fourcc("WEBP");
    out.bytes(bodyBytes);
    return new Blob([new Uint8Array(out.take())], { type: "image/webp" });
  }

  function paintToolsVersion() {
    const label = `v${TOOLS_VERSION}`;
    const el = $("#site-tools-version");
    if (el) {
      el.textContent = label;
      el.title = `工具页逻辑版本 ${TOOLS_VERSION}（更新后应看到此号变化）`;
    }
    try {
      window.TOOLS_VERSION = TOOLS_VERSION;
      window.GIF_TOOL_VERSION = TOOLS_VERSION;
    } catch (_) {}
  }

  paintToolsVersion();
  document.addEventListener("DOMContentLoaded", () => {
    paintToolsVersion();
    bindAutoPackZipToggles();
  });
  if (document.readyState !== "loading") bindAutoPackZipToggles();

  try {
    window.DevToolsFfmpeg = {
      getInstance: getFfmpegInstance,
      ensureInputWritten: ensureFfmpegInputWritten,
      terminate: (opts) => terminateFfmpegInstance(opts || { revokeAssets: false }),
      prewarm: prewarmFfmpegEngine,
      inputKey: ffmpegInputKey,
      guessExt: guessVideoExt,
    };
  } catch (_) {
    /* ignore */
  }

  let gifsicleModulePromise = null;

  function loadGifsicle() {
    if (!gifsicleModulePromise) {
      const url = new URL("./vendor/gifsicle.min.js", document.baseURI || window.location.href).href;
      gifsicleModulePromise = import(url)
        .then((mod) => mod.default || mod)
        .catch((err) => {
          gifsicleModulePromise = null;
          throw err;
        });
    }
    return gifsicleModulePromise;
  }

  /**
   * 手动压缩：第 1 轮先 -O3，之后再逐步 lossy / 减色 / 缩放。
   * 黑盒请用 buildBlackbox*，勿直接复用（避免第 1 轮纯 O3 浪费有效压缩轮次）。
   */
  function buildGifCompressArgs(level = "standard", round = 1) {
    const preset = GIF_COMPRESS_PRESETS[level] || GIF_COMPRESS_PRESETS.standard;
    const r = Math.max(1, Math.round(Number(round) || 1));
    if (r === 1) {
      return { label: `${preset.label}·优化`, args: "-O3", round: 1, lossy: 0 };
    }
    const lossy = Math.min(200, preset.baseLossy + (r - 2) * 30);
    const parts = ["-O3", `--lossy=${lossy}`];
    if (level === "strong" || r >= 3) {
      parts.push(`--colors ${r >= 5 ? 64 : 128}`);
    }
    if (r >= 8) parts.push("--scale 0.85");
    else if (r >= 6) parts.push("--scale 0.9");
    return { label: preset.label, args: parts.join(" "), round: r, lossy };
  }

  /**
   * 黑盒高帧档轻柔压缩（对齐 -l 基线）：每轮都带 lossy，不减色/缩放，优先保住 12FPS。
   * 附带 -O3，但不单独占一轮。
   */
  function buildBlackboxSoftCompressArgs(round = 1) {
    const r = Math.max(1, Math.round(Number(round) || 1));
    const lossy = Math.min(75, 25 + (r - 1) * 22); // 1→25, 2→47, 3→69
    return { label: "轻柔", args: `-O3 --lossy=${lossy}`, round: r, lossy };
  }

  /** 黑盒最后一档：每轮都有 lossy（对齐 -l 力度），避免首轮纯 O3 白占一轮 */
  function buildBlackboxHardCompressArgs(round = 1) {
    const r = Math.max(1, Math.round(Number(round) || 1));
    const level = r <= 2 ? "standard" : "strong";
    const baseLossy = level === "strong" ? 100 : 60;
    const lossy = Math.min(200, baseLossy + (r - 1) * 30);
    const parts = ["-O3", `--lossy=${lossy}`];
    if (level === "strong" || r >= 2) {
      parts.push(`--colors ${r >= 4 ? 64 : 128}`);
    }
    if (r >= 7) parts.push("--scale 0.85");
    else if (r >= 5) parts.push("--scale 0.9");
    return { label: level === "strong" ? "强力" : "标准", args: parts.join(" "), round: r, lossy };
  }

  function gifCompressSummary(originalSize, beforeSize, afterSize, round) {
    const stepSaved = beforeSize > 0 ? Math.max(0, Math.round((1 - afterSize / beforeSize) * 100)) : 0;
    const totalSaved =
      originalSize > 0 ? Math.max(0, Math.round((1 - afterSize / originalSize) * 100)) : stepSaved;
    return {
      stepSaved,
      totalSaved,
      text: `第 ${round} 次压缩：${formatKb(beforeSize)} → ${formatKb(afterSize)}（本轮约省 ${stepSaved}%）· 相对原图 ${formatKb(originalSize)} → ${formatKb(afterSize)}（累计约省 ${totalSaved}%）`,
    };
  }

  const GIF_WM_DEFAULT_TEXT = "Elliot718703";

  function readGifWatermarkOptions(prefix) {
    const enabled = Boolean($(`#${prefix}-wm-enable`)?.checked);
    const text = String($(`#${prefix}-wm-text`)?.value ?? GIF_WM_DEFAULT_TEXT).trim();
    const sizeKey = String($(`#${prefix}-wm-size`)?.value || "small");
    return { enabled, text, sizeKey };
  }

  function drawGifTextWatermark(ctx, canvasW, canvasH, opts) {
    if (!ctx || !opts?.enabled) return;
    const text = String(opts.text || "").trim();
    if (!text) return;
    const w = Math.max(1, Number(canvasW) || 1);
    const h = Math.max(1, Number(canvasH) || 1);
    const ratio = opts.sizeKey === "large" ? 0.055 : opts.sizeKey === "medium" ? 0.04 : 0.028;
    const fontSize = Math.max(8, Math.round(Math.min(w, h) * ratio));
    const pad = Math.max(4, Math.round(fontSize * 0.55));
    ctx.save();
    ctx.font = `600 ${fontSize}px "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
    ctx.textAlign = "right";
    ctx.textBaseline = "top";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    ctx.lineWidth = Math.max(1, Math.round(fontSize * 0.16));
    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    ctx.fillStyle = "rgba(255, 255, 255, 0.88)";
    const x = w - pad;
    const y = pad;
    ctx.strokeText(text, x, y);
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  async function compressGifBlob(blob, level = "standard", onProgress, opts = {}) {
    if (!blob) throw new Error("没有可压缩的 GIF");
    const plan = opts.plan || buildGifCompressArgs(level, opts.round || 1);
    onProgress?.(0.05, "加载压缩引擎…");
    const gifsicle = await loadGifsicle();
    if (!gifsicle || typeof gifsicle.run !== "function") throw new Error("压缩引擎未加载");
    const modeLabel = plan.lossy > 0 ? `${plan.label} lossy=${plan.lossy}` : `${plan.label} O3`;
    const startedAt = Date.now();
    let tick = 0.18;
    let timer = null;
    const pushBusy = (forceRatio) => {
      if (typeof forceRatio === "number") tick = forceRatio;
      else tick = Math.min(0.9, tick + 0.018);
      const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      onProgress?.(
        tick,
        `压缩中 · ${modeLabel} · 已用时 ${elapsed}s`,
        { busy: true, elapsed }
      );
    };
    pushBusy(0.2);
    timer = setInterval(() => pushBusy(), 700);
    try {
      const out = await gifsicle.run({
        input: [{ file: blob, name: "in.gif" }],
        command: [`${plan.args} in.gif -o /out/out.gif`],
      });
      const file = Array.isArray(out) ? out[0] : null;
      if (!file) throw new Error("压缩失败，未得到输出");
      onProgress?.(1, "压缩完成");
      return file instanceof Blob ? file : new Blob([file], { type: "image/gif" });
    } finally {
      if (timer) clearInterval(timer);
    }
  }

  /**
   * 用 gifsicle --merge 拼接已有 GIF，不重新调色板编码。
   * 各段尺寸宜一致，否则可能失败。
   */
  async function mergeGifBlobs(blobs, onProgress) {
    const list = (blobs || []).filter(Boolean);
    if (list.length < 2) throw new Error("至少需要 2 个 GIF 才能合并");
    onProgress?.(0.06, "加载合并引擎…");
    const gifsicle = await loadGifsicle();
    if (!gifsicle || typeof gifsicle.run !== "function") throw new Error("合并引擎未加载");
    const input = list.map((file, i) => ({ file, name: `in${i}.gif` }));
    const names = input.map((x) => x.name).join(" ");
    const startedAt = Date.now();
    let tick = 0.2;
    let timer = null;
    const pushBusy = (forceRatio) => {
      if (typeof forceRatio === "number") tick = forceRatio;
      else tick = Math.min(0.9, tick + 0.02);
      const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      onProgress?.(tick, `拼接 ${list.length} 段 · 已用时 ${elapsed}s`);
    };
    pushBusy(0.22);
    timer = setInterval(() => pushBusy(), 700);
    const commands = [`--merge ${names} -o /out/out.gif`, `${names} -o /out/out.gif`];
    try {
      let blob = null;
      let lastErr = "";
      for (const cmd of commands) {
        try {
          const out = await gifsicle.run({
            input,
            command: [cmd],
          });
          const file = Array.isArray(out) ? out[0] : null;
          if (!file) {
            lastErr = "合并失败：请确认各 GIF 宽高一致";
            continue;
          }
          const next = file instanceof Blob ? file : new Blob([file], { type: "image/gif" });
          if (!next.size) {
            lastErr = "合并结果为空";
            continue;
          }
          blob = next;
          break;
        } catch (err) {
          lastErr = err?.message || String(err);
        }
      }
      if (!blob) throw new Error(lastErr || "合并失败：请确认各 GIF 宽高一致");
      onProgress?.(1, "合并完成");
      return blob;
    } finally {
      if (timer) clearInterval(timer);
    }
  }


  window.DevToolsExtraMedia = {
    isAutoPackZipEnabled, setAutoPackZipEnabled, syncAutoPackZipToggles, bindAutoPackZipToggles,
    canEncodeStillWebp, gifQualityToWebpQuality, gifQualityToMaxColors, resolveFfmpegVendorBase,
    loadFfmpegMods, fetchFileBytes, ffmpegInputKey, guessVideoExt, ensureFfmpegInputWritten,
    clearFfmpegInputCache, openFfmpegIdb, idbGetAsset, idbPutAsset, deleteFfmpegIndexedDb,
    purgePersistedEngine, createEngineObjectURL, fetchArrayBufferProgress, loadEngineBuffer,
    ensureFfmpegAssets, getFfmpegInstance, terminateFfmpegInstance, paintFfmpegWarmHint,
    setFfmpegWarmProgress, injectFfmpegPreloadLinks, isGifmakerActive, prewarmFfmpegEngine,
    scheduleFfmpegPrewarm, bindFfmpegPrewarmTriggers, encodeAnimatedWebpFromStillFrames,
    paintToolsVersion, loadGifsicle, buildGifCompressArgs, buildBlackboxSoftCompressArgs,
    buildBlackboxHardCompressArgs, gifCompressSummary, readGifWatermarkOptions,
    drawGifTextWatermark, compressGifBlob, mergeGifBlobs, TOOLS_VERSION, GIF_TOOL_VERSION,
    AUTO_PACK_ZIP_KEY, FFMPEG_SEG_FILE_BYTES,
    formatLocalPickMeta: K.formatLocalPickMeta,
    attachLocalVideoPreview: K.attachLocalVideoPreview,
    waitVideoMetadata: K.waitVideoMetadata,
    escapeHtml,
  };
  bindAutoPackZipToggles?.();
  bindFfmpegPrewarmTriggers?.();
  paintToolsVersion?.();
})();
