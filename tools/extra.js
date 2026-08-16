(() => {
  "use strict";

  const P = window.DevToolsPure;
  if (!P) {
    console.error("DevToolsPure missing");
    return;
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

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

  function toast(msg) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.classList.add("is-show");
    clearTimeout(toast._t);
    clearTimeout(toast._tHide);
    toast._t = setTimeout(() => {
      el.classList.remove("is-show");
      toast._tHide = setTimeout(() => {
        el.hidden = true;
      }, 200);
    }, 1400);
  }

  function formatKb(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatLocalPickMeta(file, extra) {
    const name = file?.name || "未命名";
    const size = formatKb(file?.size || 0);
    const tail = extra ? ` · ${extra}` : "";
    return `${name} · ${size} · 本地文件，不上传${tail}`;
  }

  function attachLocalVideoPreview(video, url) {
    if (!video) throw new Error("视频预览未找到");
    video.hidden = false;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    try {
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.disableRemotePlayback = true;
    } catch (_) {
      /* ignore */
    }
    video.src = url;
    video.load();
  }

  function waitVideoMetadata(video, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (ok, arg) => {
        if (settled) return;
        settled = true;
        video.removeEventListener("loadedmetadata", onMeta);
        video.removeEventListener("error", onErr);
        window.clearTimeout(timer);
        if (ok) resolve(arg);
        else reject(arg);
      };
      const onMeta = () => finish(true);
      const onErr = () => finish(false, new Error("无法读取该视频"));
      const timer = window.setTimeout(() => {
        if (video.videoWidth) finish(true);
        else finish(false, new Error("读取视频信息超时（文件仍在本地，未上传）"));
      }, timeoutMs);
      video.addEventListener("loadedmetadata", onMeta);
      video.addEventListener("error", onErr);
      if (video.readyState >= 1 && video.videoWidth) finish(true);
    });
  }

  const TOOLS_VERSION = "2026.08.16-vsplit3";
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

  function paintFfmpegWarmHint() {
    const el = document.getElementById("v2g-hq-warm");
    const wrap = document.getElementById("v2g-warm-progress");
    const fill = document.getElementById("v2g-warm-progress-fill");
    const textEl = document.getElementById("v2g-warm-progress-text");
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
    if (el) el.textContent = text;
    const showBar = ffmpegWarmState === "warming";
    if (wrap) wrap.hidden = !showBar;
    if (showBar && fill) {
      const pct = Math.max(0, Math.min(100, Math.round((ffmpegWarmDetail.ratio || 0) * 100)));
      fill.style.width = `${pct}%`;
      fill.classList.add("is-active");
    } else if (fill) {
      fill.classList.remove("is-active");
      if (ffmpegWarmState === "ready") fill.style.width = "100%";
    }
    if (textEl) textEl.textContent = showBar ? text : "";
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

  function isGifmakerActive() {
    const hash = String(location.hash || "").replace(/^#/, "").toLowerCase();
    if (
      hash === "gifmaker" ||
      hash === "vsplit" ||
      hash === "vbb" ||
      hash === "media" ||
      hash.indexOf("media/") === 0
    ) {
      return true;
    }
    const mediaLink = document.querySelector('.tool-nav-link[data-tool="media"]');
    if (mediaLink?.classList.contains("is-active")) return true;
    return ["gifmaker", "vsplit", "vbb"].some((id) => {
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
      ["gifmaker", "vsplit", "vbb"].forEach((id) => {
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
        '.tool-nav-link[data-tool="media"], [data-media-tab], .tool-nav-link[data-tool="gifmaker"], .tool-nav-link[data-tool="vsplit"], .tool-nav-link[data-tool="vbb"]'
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

  // ---- Time diff ----
  const tdA = $("#td-a");
  const tdB = $("#td-b");
  const tdResult = $("#td-result");
  const tdValue = $("#td-result-value");
  const tdError = $("#td-error");

  function fillNowDate(input) {
    input.value = P.formatDateTime(Date.now());
  }

  function fillNowTs(input, asMs) {
    const now = Date.now();
    input.value = String(asMs ? now : Math.floor(now / 1000));
  }

  function calcTimeDiff() {
    try {
      const r = P.timeDiff(tdA.value, tdB.value);
      tdValue.textContent = r.text;
      tdResult.hidden = false;
      setError(tdError, "");
    } catch (err) {
      tdResult.hidden = true;
      setError(tdError, err.message || String(err));
    }
  }

  $("#td-now-a")?.addEventListener("click", () => fillNowDate(tdA));
  $("#td-now-b")?.addEventListener("click", () => fillNowDate(tdB));
  $("#td-ts-a")?.addEventListener("click", () => fillNowTs(tdA, false));
  $("#td-ts-b")?.addEventListener("click", () => fillNowTs(tdB, false));
  $("#td-ms-a")?.addEventListener("click", () => fillNowTs(tdA, true));
  $("#td-ms-b")?.addEventListener("click", () => fillNowTs(tdB, true));
  $("#td-calc")?.addEventListener("click", calcTimeDiff);
  [tdA, tdB].forEach((el) => {
    el?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") calcTimeDiff();
    });
  });

  // 默认演示：秒时间戳 vs 日期时间
  fillNowTs(tdA, false);
  fillNowDate(tdB);
  tdB.value = P.formatDateTime(Date.now() + 86400000);

  // ---- Color convert ----
  const cHex = $("#c-hex");
  const cRgb = $("#c-rgb");
  const cHsl = $("#c-hsl");
  const cSwatch = $("#c-swatch");
  const cPreview = $("#c-preview-hex");
  const cError = $("#c-error");
  let colorSync = false;

  function applyColorSource(source) {
    if (colorSync) return;
    try {
      const value = source === "hex" ? cHex.value : source === "rgb" ? cRgb.value : cHsl.value;
      const color = P.colorFrom(source, value);
      colorSync = true;
      cHex.value = color.hex;
      cRgb.value = color.rgb;
      cHsl.value = color.hsl;
      cSwatch.style.backgroundColor = color.rgb;
      cPreview.textContent = color.hex;
      setError(cError, "");
    } catch (err) {
      setError(cError, err.message || String(err));
    } finally {
      colorSync = false;
    }
  }

  cHex?.addEventListener("input", () => applyColorSource("hex"));
  cRgb?.addEventListener("input", () => applyColorSource("rgb"));
  cHsl?.addEventListener("input", () => applyColorSource("hsl"));
  applyColorSource("hex");

  // ---- URL ----
  const urlRaw = $("#url-raw");
  const urlEnc = $("#url-enc");
  const urlError = $("#url-error");
  $("#url-encode")?.addEventListener("click", () => {
    try {
      urlEnc.value = encodeURIComponent(urlRaw.value);
      setError(urlError, "");
    } catch (err) {
      setError(urlError, err.message || String(err));
    }
  });
  $("#url-decode")?.addEventListener("click", () => {
    try {
      urlRaw.value = decodeURIComponent(urlEnc.value);
      setError(urlError, "");
    } catch (err) {
      setError(urlError, "解码失败：内容不是合法的 URL 编码");
    }
  });
  $("#url-swap")?.addEventListener("click", () => {
    const t = urlRaw.value;
    urlRaw.value = urlEnc.value;
    urlEnc.value = t;
  });

  // ---- Query / JWT ----
  const qInput = $("#q-input");
  const qOut = $("#q-out");
  const jwtInput = $("#jwt-input");
  const jwtOut = $("#jwt-out");
  const qError = $("#q-error");

  $("#q-parse")?.addEventListener("click", () => {
    try {
      const obj = P.parseQuery(qInput.value);
      qOut.textContent = JSON.stringify(obj, null, 2);
      setError(qError, "");
    } catch (err) {
      setError(qError, err.message || String(err));
    }
  });

  $("#jwt-parse")?.addEventListener("click", () => {
    try {
      const parsed = P.parseJwt(jwtInput.value);
      jwtOut.textContent = JSON.stringify(parsed, null, 2);
      setError(qError, "");
    } catch (err) {
      setError(qError, err.message || String(err));
    }
  });

  // ---- UUID ----
  function genUuid() {
    const count = Math.min(200, Math.max(1, Number($("#uuid-count").value) || 1));
    const upper = $("#uuid-upper").checked;
    const noHyphen = $("#uuid-nohyphen").checked;
    const list = [];
    for (let i = 0; i < count; i++) list.push(P.formatUuid(P.uuidv4(), { upper, noHyphen }));
    $("#uuid-out").value = list.join("\n");
  }
  $("#uuid-gen")?.addEventListener("click", genUuid);
  genUuid();

  // ---- Hash ----
  async function sha256(text) {
    const data = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  $("#hash-run")?.addEventListener("click", async () => {
    const text = $("#hash-input").value;
    try {
      $("#hash-md5").textContent = P.md5(text);
      $("#hash-sha256").textContent = await sha256(text);
      setError($("#hash-error"), "");
    } catch (err) {
      setError($("#hash-error"), err.message || String(err));
    }
  });

  // ---- Text ----
  const textInput = $("#text-input");
  const textStatsEl = $("#text-stats");

  function refreshTextStats() {
    const s = P.textStats(textInput.value);
    textStatsEl.textContent = `字符 ${s.chars} · 非空白 ${s.charsNoSpace} · 词 ${s.words} · 行 ${s.lines}（非空 ${s.nonEmptyLines}）`;
  }

  textInput?.addEventListener("input", refreshTextStats);
  $$("[data-text-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      textInput.value = P.transformText(textInput.value, btn.dataset.textAction);
      refreshTextStats();
    });
  });
  refreshTextStats();

  // ---- Case convert ----
  try {
    const caseInput = $("#case-input");
    const caseMeta = $("#case-meta");
    const caseMap = {
      camel: $("#case-camel"),
      pascal: $("#case-pascal"),
      snake: $("#case-snake"),
      screaming: $("#case-screaming"),
      kebab: $("#case-kebab"),
      dot: $("#case-dot"),
      path: $("#case-path"),
      title: $("#case-title"),
    };

    function refreshCaseConvert() {
      if (!caseInput) return;
      const result = P.convertCaseLines(caseInput.value);
      Object.keys(caseMap).forEach((key) => {
        const el = caseMap[key];
        if (!el) return;
        const value = result[key] || "";
        el.textContent = value || "—";
        el.title = value;
      });
      if (caseMeta) {
        caseMeta.textContent = result.count
          ? `已转换 ${result.count} 个名称`
          : "每行一个名称，自动识别并转换。";
      }
    }

    caseInput?.addEventListener("input", refreshCaseConvert);
    $("#case-clear")?.addEventListener("click", () => {
      if (caseInput) caseInput.value = "";
      refreshCaseConvert();
    });
    $("#case-use-camel")?.addEventListener("click", () => {
      if (!caseInput || !caseMap.camel) return;
      const v = caseMap.camel.textContent;
      if (!v || v === "—") return;
      caseInput.value = v;
      refreshCaseConvert();
      toast("已填入 camelCase");
    });
    $("#case-use-snake")?.addEventListener("click", () => {
      if (!caseInput || !caseMap.snake) return;
      const v = caseMap.snake.textContent;
      if (!v || v === "—") return;
      caseInput.value = v;
      refreshCaseConvert();
      toast("已填入 snake_case");
    });
    $("#case-use-kebab")?.addEventListener("click", () => {
      if (!caseInput || !caseMap.kebab) return;
      const v = caseMap.kebab.textContent;
      if (!v || v === "—") return;
      caseInput.value = v;
      refreshCaseConvert();
      toast("已填入 kebab-case");
    });
    refreshCaseConvert();
  } catch (err) {
    console.error("case convert init failed", err);
  }

  // ---- Coordinate convert ----
  try {
    const coordInput = $("#coord-input");
    const coordSystem = $("#coord-system");
    const coordMeta = $("#coord-meta");
    const coordError = $("#coord-error");
    const systems = ["wgs84", "gcj02", "bd09", "cgcs2000"];
    const coordOut = Object.fromEntries(
      systems.map((key) => [
        key,
        {
          decimal: $(`#coord-${key}`),
          dms: $(`#coord-${key}-dms`),
        },
      ])
    );

    function refreshCoordConvert() {
      if (!coordInput || !coordSystem) return;
      const text = coordInput.value;
      if (!String(text || "").trim()) {
        systems.forEach((key) => {
          if (coordOut[key].decimal) coordOut[key].decimal.textContent = "—";
          if (coordOut[key].dms) coordOut[key].dms.textContent = "—";
        });
        setError(coordError, "");
        if (coordMeta) {
          coordMeta.textContent = "每行一组坐标，顺序为经度在前、纬度在后。CGCS2000 按 WGS84 近似处理。";
        }
        return;
      }
      try {
        const result = P.convertCoordinateLines(coordSystem.value, text);
        systems.forEach((key) => {
          const decimal = result.decimal[key] || "";
          const dms = result.dms[key] || "";
          if (coordOut[key].decimal) {
            coordOut[key].decimal.textContent = decimal || "—";
            coordOut[key].decimal.title = decimal;
          }
          if (coordOut[key].dms) {
            coordOut[key].dms.textContent = dms || "—";
            coordOut[key].dms.title = dms;
          }
        });
        setError(coordError, result.fail ? `${result.error}（失败 ${result.fail} 行）` : "");
        if (coordMeta) {
          coordMeta.textContent = result.fail
            ? `成功 ${result.ok} 行 · 失败 ${result.fail} 行`
            : `已转换 ${result.ok} 组坐标`;
        }
      } catch (err) {
        systems.forEach((key) => {
          if (coordOut[key].decimal) coordOut[key].decimal.textContent = "—";
          if (coordOut[key].dms) coordOut[key].dms.textContent = "—";
        });
        setError(coordError, err.message || String(err));
        if (coordMeta) coordMeta.textContent = "请检查输入格式：lng,lat";
      }
    }

    function useCoordResult(system) {
      const el = coordOut[system]?.decimal;
      if (!coordInput || !el) return;
      const v = el.textContent || "";
      const cleaned = v
        .split(/\r\n|\n|\r/)
        .map((line) => line.trim())
        .filter((line) => line && line !== "—")
        .join("\n");
      if (!cleaned) return;
      coordInput.value = cleaned;
      if (coordSystem) coordSystem.value = system;
      refreshCoordConvert();
      toast(`已填入 ${system.toUpperCase()}`);
    }

    coordInput?.addEventListener("input", refreshCoordConvert);
    coordSystem?.addEventListener("change", refreshCoordConvert);
    $("#coord-clear")?.addEventListener("click", () => {
      if (coordInput) coordInput.value = "";
      refreshCoordConvert();
    });
    $("#coord-use-wgs84")?.addEventListener("click", () => useCoordResult("wgs84"));
    $("#coord-use-gcj02")?.addEventListener("click", () => useCoordResult("gcj02"));
    $("#coord-use-bd09")?.addEventListener("click", () => useCoordResult("bd09"));
    refreshCoordConvert();
  } catch (err) {
    console.error("coord convert init failed", err);
  }

  // ---- Diff ----
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  $("#diff-run")?.addEventListener("click", () => {
    const rows = P.diffLines($("#diff-a").value, $("#diff-b").value);
    $("#diff-out").innerHTML = rows
      .map((row) => {
        const cls = row.type === "add" ? "diff-add" : row.type === "del" ? "diff-del" : "diff-same";
        const mark = row.type === "add" ? "+" : row.type === "del" ? "-" : " ";
        return `<div class="${cls}"><span class="diff-mark">${mark}</span>${escapeHtml(row.text)}</div>`;
      })
      .join("");
  });

  // ---- YAML ----
  $("#yaml-to-json")?.addEventListener("click", () => {
    try {
      if (typeof jsyaml === "undefined") throw new Error("js-yaml 未加载");
      const data = jsyaml.load($("#yaml-in").value);
      $("#json-from-yaml").value = JSON.stringify(data, null, 2);
      setError($("#yaml-error"), "");
    } catch (err) {
      setError($("#yaml-error"), err.message || String(err));
    }
  });
  $("#json-to-yaml")?.addEventListener("click", () => {
    try {
      if (typeof jsyaml === "undefined") throw new Error("js-yaml 未加载");
      const data = JSON.parse($("#json-from-yaml").value);
      $("#yaml-in").value = jsyaml.dump(data);
      setError($("#yaml-error"), "");
    } catch (err) {
      setError($("#yaml-error"), err.message || String(err));
    }
  });
  $("#yaml-to-json")?.click();

  // ---- Image Base64 ----
  $("#img-file")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError($("#img-error"), "请选择图片文件");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      $("#img-b64").value = dataUrl;
      $("#img-preview").src = dataUrl;
      $("#img-meta").textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB · ${file.type}`;
      setError($("#img-error"), "");
    };
    reader.onerror = () => setError($("#img-error"), "读取图片失败");
    reader.readAsDataURL(file);
  });

  // ---- QR generate + decode ----
  function generateQr() {
    const box = $("#qr-box");
    const text = $("#qr-text").value.trim();
    box.innerHTML = "";
    if (!text) {
      setError($("#qr-error"), "请输入内容");
      return;
    }
    try {
      if (typeof QRCode === "undefined") throw new Error("QRCode 库未加载");
      // eslint-disable-next-line no-new
      new QRCode(box, {
        text,
        width: 180,
        height: 180,
        colorDark: "#0b1220",
        colorLight: "#ffffff",
        correctLevel: QRCode.CorrectLevel.M,
      });
      setError($("#qr-error"), "");
    } catch (err) {
      setError($("#qr-error"), err.message || String(err));
    }
  }
  $("#qr-gen")?.addEventListener("click", generateQr);
  generateQr();

  const qrVideo = $("#qr-video");
  const qrCanvas = $("#qr-scan-canvas");
  const qrPreview = $("#qr-scan-preview");
  const qrDecoded = $("#qr-decoded");
  const qrDecodeMeta = $("#qr-decode-meta");
  const qrDecodeError = $("#qr-decode-error");
  const qrCamStart = $("#qr-cam-start");
  const qrCamStop = $("#qr-cam-stop");
  let qrStream = null;
  let qrScanTimer = 0;
  let qrScanning = false;

  function decodeImageData(imageData) {
    if (typeof jsQR !== "function") throw new Error("jsQR 库未加载");
    return jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "attemptBoth",
    });
  }

  function showDecoded(text, meta) {
    qrDecoded.value = text;
    qrDecodeMeta.textContent = meta || "";
    setError(qrDecodeError, "");
    toast("已识别二维码");
  }

  function decodeFromImageElement(img, meta) {
    const canvas = qrCanvas;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    const maxSide = 1200;
    let w = img.naturalWidth || img.videoWidth || img.width;
    let h = img.naturalHeight || img.videoHeight || img.height;
    if (!w || !h) throw new Error("无法读取图像尺寸");
    const scale = Math.min(1, maxSide / Math.max(w, h));
    w = Math.max(1, Math.round(w * scale));
    h = Math.max(1, Math.round(h * scale));
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);
    const code = decodeImageData(ctx.getImageData(0, 0, w, h));
    if (!code) throw new Error("未识别到二维码，请换更清晰的图片试试");
    showDecoded(code.data, meta || `已识别 · ${w}×${h}`);
    return code.data;
  }

  function stopCamera() {
    qrScanning = false;
    if (qrScanTimer) {
      cancelAnimationFrame(qrScanTimer);
      qrScanTimer = 0;
    }
    if (qrStream) {
      qrStream.getTracks().forEach((t) => t.stop());
      qrStream = null;
    }
    if (qrVideo) {
      qrVideo.pause();
      qrVideo.srcObject = null;
      qrVideo.hidden = true;
    }
    if (qrCamStop) qrCamStop.hidden = true;
    if (qrCamStart) qrCamStart.hidden = false;
  }

  function scanCameraFrame() {
    if (!qrScanning || !qrVideo) return;
    if (qrVideo.readyState >= 2) {
      try {
        const canvas = qrCanvas;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const w = qrVideo.videoWidth;
        const h = qrVideo.videoHeight;
        if (w && h) {
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(qrVideo, 0, 0, w, h);
          const code = decodeImageData(ctx.getImageData(0, 0, w, h));
          if (code) {
            showDecoded(code.data, `摄像头识别 · ${w}×${h}`);
            stopCamera();
            return;
          }
        }
      } catch (_) {
        // keep scanning
      }
    }
    qrScanTimer = requestAnimationFrame(scanCameraFrame);
  }

  $("#qr-file")?.addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    stopCamera();
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        qrPreview.hidden = false;
        qrPreview.src = url;
        decodeFromImageElement(img, `图片识别 · ${file.name}`);
      } catch (err) {
        setError(qrDecodeError, err.message || String(err));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      setError(qrDecodeError, "图片加载失败");
    };
    img.src = url;
    e.target.value = "";
  });

  qrCamStart?.addEventListener("click", async () => {
    setError(qrDecodeError, "");
    if (!navigator.mediaDevices?.getUserMedia) {
      setError(qrDecodeError, "当前浏览器不支持摄像头");
      return;
    }
    try {
      stopCamera();
      qrStream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      qrPreview.hidden = true;
      qrVideo.hidden = false;
      qrVideo.srcObject = qrStream;
      await qrVideo.play();
      qrScanning = true;
      qrCamStart.hidden = true;
      qrCamStop.hidden = false;
      qrDecodeMeta.textContent = "摄像头扫描中…对准二维码即可";
      scanCameraFrame();
    } catch (err) {
      stopCamera();
      setError(qrDecodeError, `无法打开摄像头：${err.message || err}`);
    }
  });

  qrCamStop?.addEventListener("click", () => {
    stopCamera();
    qrDecodeMeta.textContent = "已关闭摄像头";
  });

  window.addEventListener("pagehide", stopCamera);

  // ---- Cron ----
  function runCron() {
    try {
      const expr = $("#cron-input").value;
      $("#cron-desc").textContent = P.describeCron(expr);
      const next = P.nextCronTimes(expr, Date.now(), 8);
      $("#cron-next").textContent = next.map((ms, i) => `${i + 1}. ${P.formatDateTime(ms)}`).join("\n");
      setError($("#cron-error"), "");
    } catch (err) {
      $("#cron-desc").textContent = "";
      $("#cron-next").textContent = "";
      setError($("#cron-error"), err.message || String(err));
    }
  }
  $("#cron-run")?.addEventListener("click", runCron);
  $("#cron-input")?.addEventListener("change", runCron);
  runCron();

  // ---- Units ----
  const unitCat = $("#unit-cat");
  const unitFrom = $("#unit-from");
  const unitTo = $("#unit-to");
  const unitFromVal = $("#unit-from-val");
  const unitToVal = $("#unit-to-val");
  const unitHint = $("#unit-hint");

  function fillUnitSelects() {
    const cat = unitCat.value;
    const table = P.UNIT_TABLES[cat];
    const units = cat === "temp" ? table.units : Object.keys(table.units);
    unitFrom.innerHTML = units.map((u) => `<option value="${u}">${u}</option>`).join("");
    unitTo.innerHTML = units.map((u) => `<option value="${u}">${u}</option>`).join("");
    if (cat === "length") {
      unitFrom.value = "m";
      unitTo.value = "cm";
    } else if (cat === "weight") {
      unitFrom.value = "kg";
      unitTo.value = "g";
    } else {
      unitFrom.value = "C";
      unitTo.value = "F";
    }
    convertUnits();
  }

  function convertUnits() {
    try {
      const out = P.convertUnit(unitCat.value, unitFromVal.value, unitFrom.value, unitTo.value);
      unitToVal.value = Number(out.toPrecision(12));
      unitHint.textContent = `${unitFromVal.value} ${unitFrom.value} = ${unitToVal.value} ${unitTo.value}`;
    } catch (err) {
      unitHint.textContent = err.message || String(err);
    }
  }

  unitCat?.addEventListener("change", fillUnitSelects);
  [unitFrom, unitTo, unitFromVal].forEach((el) => el?.addEventListener("input", convertUnits));
  fillUnitSelects();

  // ---- Share card ----
  const scInput = $("#sc-input");
  const scLang = $("#sc-lang");
  const scTheme = $("#sc-theme");
  const scTitle = $("#sc-title");
  const scWatermark = $("#sc-watermark");
  const scLines = $("#sc-lines");
  const scPretty = $("#sc-pretty");
  const scDots = $("#sc-dots");
  const scDotsEl = $("#sc-dots-el");
  const scCard = $("#sc-card");
  const scCode = $("#sc-code");
  const scCardTitle = $("#sc-card-title");
  const scCardWatermark = $("#sc-card-watermark");
  const scMeta = $("#sc-meta");
  const scError = $("#sc-error");
  const scCapture = $("#sc-capture");

  const LANG_LABEL = {
    json: "JSON",
    kotlin: "Kotlin / Compose",
    java: "Java",
    javascript: "JavaScript",
    python: "Python",
    xml: "XML / HTML",
    text: "纯文本",
  };

  function refreshShareCard() {
    if (!scCard || !scCode) return;
    try {
      const rendered = P.renderShareCode(scInput.value, {
        lang: scLang.value,
        prettyJson: !!scPretty?.checked,
        lineNumbers: !!scLines?.checked,
      });
      scCode.innerHTML = rendered.html;
      scCard.className = `share-card theme-${scTheme.value}`;
      scCardTitle.textContent = scTitle.value.trim() || "untitled";
      const mark = scWatermark.value.trim();
      scCardWatermark.textContent = mark;
      scCardWatermark.hidden = !mark;
      if (scDotsEl) scDotsEl.hidden = !scDots?.checked;
      scMeta.textContent = `预览 · ${LANG_LABEL[rendered.lang] || rendered.lang} · ${rendered.lineCount} 行`;
      setError(scError, "");
    } catch (err) {
      setError(scError, err.message || String(err));
    }
  }

  [
    scInput,
    scLang,
    scTheme,
    scTitle,
    scWatermark,
    scLines,
    scPretty,
    scDots,
  ].forEach((el) => {
    el?.addEventListener("input", refreshShareCard);
    el?.addEventListener("change", refreshShareCard);
  });
  $("#sc-refresh")?.addEventListener("click", refreshShareCard);

  $("#sc-export")?.addEventListener("click", async () => {
    refreshShareCard();
    if (typeof html2canvas !== "function") {
      setError(scError, "html2canvas 未加载");
      return;
    }
    try {
      const canvas = await html2canvas(scCapture, {
        backgroundColor: null,
        scale: 2,
        useCORS: true,
        logging: false,
      });
      const link = document.createElement("a");
      const name = (scTitle.value.trim() || "code-card").replace(/[^\w.-]+/g, "_");
      link.download = `${name}.png`;
      link.href = canvas.toDataURL("image/png");
      link.click();
      scMeta.textContent = `已导出 ${canvas.width}×${canvas.height} PNG`;
      toast("已导出图片");
      setError(scError, "");
    } catch (err) {
      setError(scError, `导出失败：${err.message || err}`);
    }
  });

  refreshShareCard();


  // ---- Number base ----
  const nbInput = $("#nb-input");
  const nbFrom = $("#nb-from");
  const nbBin = $("#nb-bin");
  const nbOct = $("#nb-oct");
  const nbDec = $("#nb-dec");
  const nbHex = $("#nb-hex");
  const nbError = $("#nb-error");

  function convertBase() {
    try {
      const raw = (nbInput.value || "").trim();
      if (!raw) throw new Error("请输入数值");
      const base = Number(nbFrom.value);
      const n = parseInt(raw, base);
      if (!Number.isFinite(n)) throw new Error("数值无效");
      nbBin.textContent = n.toString(2);
      nbOct.textContent = n.toString(8);
      nbDec.textContent = n.toString(10);
      nbHex.textContent = n.toString(16).toUpperCase();
      setError(nbError, "");
    } catch (err) {
      nbBin.textContent = nbOct.textContent = nbDec.textContent = nbHex.textContent = "—";
      setError(nbError, err.message || String(err));
    }
  }
  [nbInput, nbFrom].forEach((el) => el?.addEventListener("input", convertBase));
  nbFrom?.addEventListener("change", convertBase);
  convertBase();

  // ---- Markdown preview ----
  const mdInput = $("#md-input");
  const mdPreview = $("#md-preview");

  function renderMarkdown(src) {
    let html = String(src || "");
    html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
    html = html.replace(/```[\s\S]*?```/g, (m) => {
      const inner = m.slice(3, -3).replace(/^\w*\n/, "");
      return `<pre class="mono">${inner}</pre>`;
    });
    html = html.replace(/`([^`]+)`/g, '<code class="mono">$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    html = html.replace(/_(.+?)_/g, "<em>$1</em>");
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    html = html.replace(/^[-*] (.+)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
    html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
    html = html.replace(/((?:<li>.*<\/li>\n?)+)(?!<\/ul>)/g, (m) => `<ol>${m}</ol>`);
    html = html.replace(/\n{2,}/g, "</p><p>");
    html = `<p>${html}</p>`;
    html = html.replace(/<p>\s*(<h[1-6]>)/g, "$1").replace(/(<\/h[1-6]>)\s*<\/p>/g, "$1");
    html = html.replace(/<p>\s*(<pre)/g, "$1").replace(/(<\/pre>)\s*<\/p>/g, "$1");
    html = html.replace(/<p>\s*(<ul)/g, "$1").replace(/(<\/ul>)\s*<\/p>/g, "$1");
    html = html.replace(/<p>\s*(<ol)/g, "$1").replace(/(<\/ol>)\s*<\/p>/g, "$1");
    html = html.replace(/<p>\s*<\/p>/g, "");
    return html;
  }

  function refreshMarkdown() {
    if (mdPreview) mdPreview.innerHTML = renderMarkdown(mdInput?.value || "");
  }
  mdInput?.addEventListener("input", refreshMarkdown);
  refreshMarkdown();

  // ---- EyeDropper / image color picker ----
  try {
    const eyePick = $("#eye-pick");
    const eyeFile = $("#eye-file");
    const eyeSwatch = $("#eye-swatch");
    const eyeHex = $("#eye-hex");
    const eyeRgb = $("#eye-rgb");
    const eyeAhex = $("#eye-ahex");
    const eyeImg = $("#eye-img");
    const eyeMeta = $("#eye-meta");
    const eyeHint = $("#eye-hint");
    const eyeError = $("#eye-error");
    const hasEyeDropper = "EyeDropper" in window;

    function applyPickedColor(hex) {
      if (!eyeHex || !eyeRgb || !eyeAhex || !eyeSwatch) return;
      const c = P.colorFrom("hex", hex);
      eyeSwatch.style.backgroundColor = c.rgb;
      eyeHex.textContent = c.hex;
      eyeRgb.textContent = c.rgb;
      eyeAhex.textContent = P.rgbStringToAhex(c.rgb);
      setError(eyeError, "");
    }

    if (!hasEyeDropper) {
      if (eyeHint) {
        eyeHint.textContent = "当前浏览器不支持屏幕取色，请改用「上传图片取色」。Chrome / Edge 桌面版通常支持。";
      }
      if (eyePick) {
        eyePick.disabled = true;
        eyePick.title = "当前浏览器不支持 EyeDropper API";
        eyePick.textContent = "屏幕取色（不可用）";
      }
    }

    eyePick?.addEventListener("click", async () => {
      if (!hasEyeDropper) {
        setError(eyeError, "当前浏览器不支持屏幕取色，请改用图片取色");
        toast("请改用图片取色");
        return;
      }
      if (!window.isSecureContext) {
        setError(eyeError, "屏幕取色需要 HTTPS 安全上下文");
        toast("需要 HTTPS 才能取色");
        return;
      }
      try {
        setError(eyeError, "");
        toast("请在屏幕上点选颜色…");
        const eyeDropper = new window.EyeDropper();
        const result = await eyeDropper.open();
        applyPickedColor(result.sRGBHex);
        if (eyeMeta) eyeMeta.textContent = `屏幕取色：${result.sRGBHex}`;
        toast(`已取色 ${result.sRGBHex}`);
      } catch (err) {
        if (String(err && err.name) === "AbortError") {
          toast("已取消取色");
          return;
        }
        setError(eyeError, `取色失败：${err.message || err}`);
        toast("取色失败");
      }
    });

    eyeFile?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const url = URL.createObjectURL(file);
      if (eyeImg) {
        eyeImg.hidden = false;
        eyeImg.src = url;
      }
      if (eyeMeta) eyeMeta.textContent = `点击图片任意位置取色 · ${file.name}`;
      setError(eyeError, "");
      toast("图片已加载，点击图片取色");
      e.target.value = "";
    });

    eyeImg?.addEventListener("click", (e) => {
      try {
        if (!eyeImg.naturalWidth) {
          setError(eyeError, "图片尚未加载完成");
          return;
        }
        const rect = eyeImg.getBoundingClientRect();
        const scaleX = eyeImg.naturalWidth / rect.width;
        const scaleY = eyeImg.naturalHeight / rect.height;
        const x = Math.max(0, Math.min(eyeImg.naturalWidth - 1, Math.floor((e.clientX - rect.left) * scaleX)));
        const y = Math.max(0, Math.min(eyeImg.naturalHeight - 1, Math.floor((e.clientY - rect.top) * scaleY)));
        const canvas = document.createElement("canvas");
        canvas.width = eyeImg.naturalWidth;
        canvas.height = eyeImg.naturalHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(eyeImg, 0, 0);
        const data = ctx.getImageData(x, y, 1, 1).data;
        const hex = `#${[data[0], data[1], data[2]].map((n) => n.toString(16).toUpperCase().padStart(2, "0")).join("")}`;
        applyPickedColor(hex);
        if (eyeMeta) eyeMeta.textContent = `图片取色：(${x}, ${y}) ${hex}`;
        toast(`已取色 ${hex}`);
      } catch (err) {
        setError(eyeError, `图片取色失败：${err.message || err}`);
        toast("图片取色失败");
      }
    });
    applyPickedColor("#2EC4B6");
  } catch (err) {
    console.error("eyedropper init failed", err);
  }

  // ---- Password generator ----
  try {
    const pwLength = $("#pw-length");
    const pwCount = $("#pw-count");
    const pwUpper = $("#pw-upper");
    const pwLower = $("#pw-lower");
    const pwNumber = $("#pw-number");
    const pwSymbol = $("#pw-symbol");
    const pwNoAmbiguous = $("#pw-no-ambiguous");
    const pwOutput = $("#pw-output");
    const pwMeta = $("#pw-meta");
    const pwError = $("#pw-error");
    const pwGenerate = $("#pw-generate");

    function genPasswords(fromClick) {
      try {
        if (!pwOutput) throw new Error("密码输出框未找到");
        const list = P.generatePasswords({
          length: Math.min(128, Math.max(4, Number(pwLength?.value) || 16)),
          count: Math.min(20, Math.max(1, Number(pwCount?.value) || 1)),
          upper: !!pwUpper?.checked,
          lower: !!pwLower?.checked,
          number: !!pwNumber?.checked,
          symbol: !!pwSymbol?.checked,
          noAmbiguous: !!pwNoAmbiguous?.checked,
        });
        pwOutput.value = list.join("\n");
        // Also mirror into a data attribute so dump/debug can see it
        pwOutput.dataset.count = String(list.length);
        if (pwMeta) pwMeta.textContent = `已生成 ${list.length} 个密码 · 长度 ${list[0]?.length || 0}`;
        setError(pwError, "");
        if (fromClick) toast(`已生成 ${list.length} 个密码`);
      } catch (err) {
        if (pwOutput) pwOutput.value = "";
        if (pwMeta) pwMeta.textContent = "";
        setError(pwError, err.message || String(err));
        if (fromClick) toast(err.message || "生成失败");
      }
    }

    pwGenerate?.addEventListener("click", (e) => {
      e.preventDefault();
      genPasswords(true);
    });
    [pwLength, pwCount, pwUpper, pwLower, pwNumber, pwSymbol, pwNoAmbiguous].forEach((el) => {
      el?.addEventListener("input", () => genPasswords(false));
      el?.addEventListener("change", () => genPasswords(false));
    });
    genPasswords(false);
  } catch (err) {
    console.error("password init failed", err);
  }

  // ---- GIF maker ----
  try {
    const gifFile = $("#gif-file");
    const gifFramesEl = $("#gif-frames");
    const gifDelay = $("#gif-delay");
    const gifWidth = $("#gif-width");
    const gifQuality = $("#gif-quality");
    const gifMeta = $("#gif-meta");
    const gifError = $("#gif-error");
    const gifProgress = $("#gif-progress");
    const gifProgressFill = $("#gif-progress-fill");
    const gifProgressText = $("#gif-progress-text");
    const gifPreview = $("#gif-preview");
    const gifDownload = $("#gif-download");
    const gifGenerate = $("#gif-generate");
    const gifAbort = $("#gif-abort");
    const gifCompress = $("#gif-compress");
    const gifCompressAgain = $("#gif-compress-again");
    const gifCompressLevel = $("#gif-compress-level");
    const MAX_GIF_FRAMES = 40;
    const frames = [];
    let frameSeq = 0;
    let activeGif = null;
    let previewUrl = "";
    let latestGifBlob = null;
    let baseGifBlob = null;
    let originalGifSize = 0;
    let gifCompressRound = 0;
    let compressingGif = false;

    function defaultDelay() {
      return Math.min(10000, Math.max(20, Number(gifDelay?.value) || 500));
    }

    function setGifCompressEnabled(on) {
      if (gifCompress) gifCompress.disabled = !on || compressingGif;
      if (gifCompressAgain) {
        const canAgain = on && gifCompressRound > 0 && !compressingGif;
        gifCompressAgain.disabled = !canAgain;
        gifCompressAgain.hidden = gifCompressRound <= 0;
      }
    }

    function revokePreview() {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = "";
      }
      latestGifBlob = null;
      baseGifBlob = null;
      originalGifSize = 0;
      gifCompressRound = 0;
      setGifCompressEnabled(false);
      if (gifPreview) {
        gifPreview.hidden = true;
        gifPreview.removeAttribute("src");
      }
      if (gifDownload) {
        gifDownload.hidden = true;
        gifDownload.removeAttribute("href");
      }
    }

    function applyGifOutput(blob, metaText, { resetCompress = false } = {}) {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
        previewUrl = "";
      }
      latestGifBlob = blob;
      if (resetCompress) {
        baseGifBlob = blob;
        originalGifSize = blob.size;
        gifCompressRound = 0;
      }
      previewUrl = URL.createObjectURL(blob);
      if (gifPreview) {
        gifPreview.src = previewUrl;
        gifPreview.hidden = false;
      }
      if (gifDownload) {
        gifDownload.href = previewUrl;
        gifDownload.hidden = false;
      }
      setGifCompressEnabled(true);
      if (metaText && gifMeta) gifMeta.textContent = metaText;
    }

    function setProgress(visible, ratio, text) {
      if (!gifProgress) return;
      gifProgress.hidden = !visible;
      const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
      if (gifProgressFill) gifProgressFill.style.width = `${pct}%`;
      if (gifProgressText) gifProgressText.textContent = text || `${pct}%`;
    }

    function updateGifMeta() {
      if (!gifMeta) return;
      if (!frames.length) {
        gifMeta.textContent = "选择至少 2 张图片。单帧建议不超过 1280px，张数过多会较慢。";
        return;
      }
      const totalMs = frames.reduce((sum, f) => sum + (Number(f.delay) || 0), 0);
      gifMeta.textContent = `已添加 ${frames.length} 帧 · 循环约 ${(totalMs / 1000).toFixed(2)}s`;
    }

    function renderFrameList() {
      if (!gifFramesEl) return;
      gifFramesEl.innerHTML = "";
      frames.forEach((frame, index) => {
        const row = document.createElement("div");
        row.className = "gif-frame";
        row.dataset.id = frame.id;

        const img = document.createElement("img");
        img.className = "gif-frame-thumb";
        img.src = frame.url;
        img.alt = frame.name;

        const meta = document.createElement("div");
        meta.className = "gif-frame-meta";
        const name = document.createElement("div");
        name.className = "gif-frame-name";
        name.textContent = `${index + 1}. ${frame.name}`;
        const controls = document.createElement("div");
        controls.className = "gif-frame-controls";
        const delayLabel = document.createElement("label");
        delayLabel.textContent = "时长 ms";
        const delayInput = document.createElement("input");
        delayInput.className = "mono meta-input";
        delayInput.type = "number";
        delayInput.min = "20";
        delayInput.max = "10000";
        delayInput.step = "10";
        delayInput.value = String(frame.delay);
        delayInput.addEventListener("input", () => {
          frame.delay = Math.min(10000, Math.max(20, Number(delayInput.value) || 20));
          updateGifMeta();
        });
        controls.append(delayLabel, delayInput);
        meta.append(name, controls);

        const actions = document.createElement("div");
        actions.className = "gif-frame-actions";
        const mkBtn = (label, cls, handler) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = cls;
          btn.textContent = label;
          btn.addEventListener("click", handler);
          return btn;
        };
        actions.append(
          mkBtn("上移", "ghost-btn", () => {
            if (index <= 0) return;
            const [item] = frames.splice(index, 1);
            frames.splice(index - 1, 0, item);
            renderFrameList();
            updateGifMeta();
          }),
          mkBtn("下移", "ghost-btn", () => {
            if (index >= frames.length - 1) return;
            const [item] = frames.splice(index, 1);
            frames.splice(index + 1, 0, item);
            renderFrameList();
            updateGifMeta();
          }),
          mkBtn("删除", "ghost-btn", () => {
            URL.revokeObjectURL(frame.url);
            frames.splice(index, 1);
            renderFrameList();
            updateGifMeta();
            revokePreview();
          })
        );

        row.append(img, meta, actions);
        gifFramesEl.appendChild(row);
      });
    }

    function loadImageFile(file) {
      return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => resolve({ img, url, name: file.name || "image", width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => {
          URL.revokeObjectURL(url);
          reject(new Error(`无法读取图片：${file.name || "unknown"}`));
        };
        img.src = url;
      });
    }

    function fitSize(srcW, srcH, maxW) {
      const widthCap = Math.min(1280, Math.max(64, Number(maxW) || 480));
      if (srcW <= widthCap) return { width: srcW, height: srcH };
      const scale = widthCap / srcW;
      return {
        width: Math.max(1, Math.round(srcW * scale)),
        height: Math.max(1, Math.round(srcH * scale)),
      };
    }

    async function addFiles(fileList) {
      const files = [...(fileList || [])].filter((f) => f.type.startsWith("image/"));
      if (!files.length) {
        setError(gifError, "请选择图片文件");
        return;
      }
      setError(gifError, "");
      for (const file of files) {
        if (frames.length >= MAX_GIF_FRAMES) {
          setError(gifError, `最多 ${MAX_GIF_FRAMES} 帧`);
          break;
        }
        try {
          const loaded = await loadImageFile(file);
          frames.push({
            id: `f${Date.now()}_${frameSeq++}`,
            url: loaded.url,
            name: loaded.name,
            delay: defaultDelay(),
            width: loaded.width,
            height: loaded.height,
            img: loaded.img,
          });
        } catch (err) {
          setError(gifError, err.message || String(err));
        }
      }
      renderFrameList();
      updateGifMeta();
      revokePreview();
      if (gifFile) gifFile.value = "";
    }

    function setBusy(busy) {
      if (gifGenerate) gifGenerate.disabled = !!busy;
      if (gifAbort) gifAbort.hidden = !busy;
      if (gifFile) gifFile.disabled = !!busy;
    }

    function abortGif() {
      if (activeGif) {
        try {
          activeGif.abort();
        } catch (_) {}
        activeGif = null;
      }
      setBusy(false);
      setProgress(false, 0, "");
      toast("已取消生成");
    }

    async function generateGif() {
      if (typeof GIF !== "function") {
        setError(gifError, "gif.js 未加载");
        return;
      }
      if (frames.length < 2) {
        setError(gifError, "至少需要 2 张图片");
        return;
      }
      setError(gifError, "");
      revokePreview();
      setBusy(true);
      setProgress(true, 0.02, "准备帧… 0%");
      let cleanupWorker = null;

      try {
        const maxW = Number(gifWidth?.value) || 480;
        const quality = Math.min(30, Math.max(1, Number(gifQuality?.value) || 10));
        let outW = 0;
        let outH = 0;
        frames.forEach((frame) => {
          const size = fitSize(frame.width, frame.height, maxW);
          outW = Math.max(outW, size.width);
          outH = Math.max(outH, size.height);
        });

        const canvas = document.createElement("canvas");
        canvas.width = outW;
        canvas.height = outH;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });

        setProgress(true, 0.02, "准备编码器…");
        const workerSource = await fetch(new URL("./vendor/gif.worker.js", document.baseURI || window.location.href)).then((r) => {
          if (!r.ok) throw new Error("无法加载 gif.worker.js");
          return r.text();
        });
        const workerScript = URL.createObjectURL(new Blob([workerSource], { type: "application/javascript" }));
        cleanupWorker = () => {
          try {
            URL.revokeObjectURL(workerScript);
          } catch (_) {}
        };
        const gif = new GIF({
          workers: 2,
          quality,
          width: outW,
          height: outH,
          workerScript,
          repeat: 0,
          background: "#000000",
        });
        activeGif = gif;

        frames.forEach((frame, idx) => {
          const size = fitSize(frame.width, frame.height, maxW);
          const x = Math.round((outW - size.width) / 2);
          const y = Math.round((outH - size.height) / 2);
          ctx.fillStyle = "#000000";
          ctx.fillRect(0, 0, outW, outH);
          ctx.drawImage(frame.img, x, y, size.width, size.height);
          drawGifTextWatermark(ctx, outW, outH, readGifWatermarkOptions("gif"));
          gif.addFrame(ctx, {
            delay: Math.min(10000, Math.max(20, Number(frame.delay) || defaultDelay())),
            copy: true,
          });
          setProgress(true, ((idx + 1) / frames.length) * 0.15, `准备帧… ${idx + 1}/${frames.length}`);
        });

        const blob = await new Promise((resolve, reject) => {
          gif.on("progress", (p) => {
            const ratio = 0.15 + p * 0.85;
            setProgress(true, ratio, `编码中… ${Math.round(p * 100)}%`);
          });
          gif.on("finished", (b) => resolve(b));
          gif.on("abort", () => reject(new Error("已取消")));
          try {
            gif.render();
          } catch (err) {
            reject(err);
          }
        });

        applyGifOutput(blob, `已生成 ${outW}×${outH} · ${frames.length} 帧 · ${formatKb(blob.size)}`, {
          resetCompress: true,
        });
        setProgress(true, 1, `完成 · ${formatKb(blob.size)}`);
        toast("GIF 已生成");
      } catch (err) {
        if (String(err && err.message) !== "已取消") {
          setError(gifError, err.message || String(err));
          setProgress(false, 0, "");
        }
      } finally {
        if (typeof cleanupWorker === "function") cleanupWorker();
        activeGif = null;
        setBusy(false);
      }
    }

    async function compressGeneratedGif({ again = false } = {}) {
      const input = again ? latestGifBlob : baseGifBlob || latestGifBlob;
      if (!input || compressingGif) return;
      compressingGif = true;
      setGifCompressEnabled(false);
      if (gifGenerate) gifGenerate.disabled = true;
      setError(gifError, "");
      const before = input.size;
      const nextRound = again ? gifCompressRound + 1 : 1;
      if (!again) {
        originalGifSize = (baseGifBlob || input).size;
        gifCompressRound = 0;
      }
      try {
        const level = gifCompressLevel?.value || "standard";
        const out = await compressGifBlob(input, level, (ratio, text) => {
          setProgress(true, ratio, text);
        }, { round: nextRound });
        const after = out.size;
        gifCompressRound = nextRound;
        const summary = gifCompressSummary(originalGifSize || before, before, after, nextRound);
        applyGifOutput(out, summary.text);
        setProgress(true, 1, `第 ${nextRound} 次压缩完成 · ${formatKb(before)} → ${formatKb(after)}`);
        toast(
          after < before
            ? `第 ${nextRound} 次已压缩，本轮约省 ${summary.stepSaved}%`
            : `第 ${nextRound} 次完成（本轮体积无明显下降，可换更强档位再试）`
        );
      } catch (err) {
        setError(gifError, err.message || String(err));
        setProgress(false, 0, "");
      } finally {
        compressingGif = false;
        if (gifGenerate) gifGenerate.disabled = false;
        setGifCompressEnabled(Boolean(latestGifBlob));
      }
    }

    function clearGifMakerTemps() {
      frames.splice(0).forEach((f) => URL.revokeObjectURL(f.url));
      renderFrameList();
      updateGifMeta();
      revokePreview();
      setError(gifError, "");
      setProgress(false, 0, "");
      if (activeGif) {
        try {
          activeGif.abort();
        } catch (_) {
          /* ignore */
        }
        activeGif = null;
      }
    }

    gifFile?.addEventListener("change", (e) => addFiles(e.target.files));
    $("#gif-clear")?.addEventListener("click", clearGifMakerTemps);
    window.DevToolsTemp?.registerCleanup(clearGifMakerTemps);
    $("#gif-apply-delay")?.addEventListener("click", () => {
      const delay = defaultDelay();
      frames.forEach((f) => {
        f.delay = delay;
      });
      renderFrameList();
      updateGifMeta();
      toast(`已统一为 ${delay} ms`);
    });
    gifGenerate?.addEventListener("click", generateGif);
    gifAbort?.addEventListener("click", abortGif);
    gifCompress?.addEventListener("click", () => {
      compressGeneratedGif({ again: false }).catch((err) => setError(gifError, err.message || String(err)));
    });
    gifCompressAgain?.addEventListener("click", () => {
      compressGeneratedGif({ again: true }).catch((err) => setError(gifError, err.message || String(err)));
    });
    updateGifMeta();
  } catch (err) {
    console.error("gif maker init failed", err);
  }

  // ---- GIF extract / to video ----
  try {
    const gifxFile = $("#gifx-file");
    const gifxFramesEl = $("#gifx-frames");
    const gifxMeta = $("#gifx-meta");
    const gifxError = $("#gifx-error");
    const gifxFormat = $("#gifx-format");
    const gifxFps = $("#gifx-fps");
    const gifxProgress = $("#gifx-progress");
    const gifxProgressFill = $("#gifx-progress-fill");
    const gifxProgressText = $("#gifx-progress-text");
    const gifxZipBtn = $("#gifx-zip");
    const gifxVideoBtn = $("#gifx-video");
    const gifxAbort = $("#gifx-abort");
    const gifxDownloadVideo = $("#gifx-download-video");
    const gifxVideoPreview = $("#gifx-video-preview");
    const extracted = [];
    let videoUrl = "";
    let abortVideo = false;

    function setGifxProgress(visible, ratio, text) {
      if (!gifxProgress) return;
      gifxProgress.hidden = !visible;
      const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
      if (gifxProgressFill) gifxProgressFill.style.width = `${pct}%`;
      if (gifxProgressText) gifxProgressText.textContent = text || `${pct}%`;
    }

    function clearExtracted() {
      extracted.splice(0).forEach((f) => {
        if (f.url) URL.revokeObjectURL(f.url);
      });
      if (gifxFramesEl) gifxFramesEl.innerHTML = "";
      if (gifxZipBtn) gifxZipBtn.disabled = true;
      if (gifxVideoBtn) gifxVideoBtn.disabled = true;
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
        videoUrl = "";
      }
      if (gifxVideoPreview) {
        gifxVideoPreview.hidden = true;
        gifxVideoPreview.removeAttribute("src");
      }
      if (gifxDownloadVideo) {
        gifxDownloadVideo.hidden = true;
        gifxDownloadVideo.removeAttribute("href");
      }
      if (gifxMeta) gifxMeta.textContent = "上传 GIF 后可拆成逐帧图片，或导出 WebM 视频。";
      setGifxProgress(false, 0, "");
      setError(gifxError, "");
    }

    function canvasToBlob(canvas, type, quality) {
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (!blob) reject(new Error("导出图片失败"));
          else resolve(blob);
        }, type, quality);
      });
    }

    async function decodeGifWithImageDecoder(buffer) {
      if (typeof ImageDecoder !== "function") return null;
      try {
        const decoder = new ImageDecoder({ data: buffer, type: "image/gif" });
        await decoder.tracks.ready;
        const track = decoder.tracks.selectedTrack;
        if (!track || !track.frameCount) return null;
        const frames = [];
        for (let i = 0; i < track.frameCount; i++) {
          const result = await decoder.decode({ frameIndex: i });
          const frame = result.image;
          const canvas = document.createElement("canvas");
          canvas.width = frame.displayWidth || frame.codedWidth;
          canvas.height = frame.displayHeight || frame.codedHeight;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(frame, 0, 0);
          const delayUs = frame.duration || result.duration || 100000;
          const delay = Math.max(20, Math.round(delayUs / 1000));
          frame.close();
          frames.push({ canvas, delay, index: i });
          setGifxProgress(true, ((i + 1) / track.frameCount) * 0.7, `解码中… ${i + 1}/${track.frameCount}`);
        }
        decoder.close?.();
        return frames;
      } catch (_) {
        return null;
      }
    }

    function decodeGifWithOmggif(buffer) {
      if (typeof GifReader !== "function") throw new Error("GIF 解码库未加载");
      const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
      const reader = new GifReader(bytes);
      const width = reader.width;
      const height = reader.height;
      const count = reader.numFrames();
      const frames = [];
      const full = document.createElement("canvas");
      full.width = width;
      full.height = height;
      const fullCtx = full.getContext("2d", { willReadFrequently: true });
      fullCtx.clearRect(0, 0, width, height);
      let saved = null;

      for (let i = 0; i < count; i++) {
        const info = reader.frameInfo(i);
        if (i > 0) {
          const prev = reader.frameInfo(i - 1);
          if (prev.disposal === 2) {
            fullCtx.clearRect(prev.x, prev.y, prev.width, prev.height);
          } else if (prev.disposal === 3 && saved) {
            fullCtx.putImageData(saved, 0, 0);
          }
        }
        if (info.disposal === 3) {
          saved = fullCtx.getImageData(0, 0, width, height);
        } else {
          saved = null;
        }

        const imageData = fullCtx.getImageData(0, 0, width, height);
        reader.decodeAndBlitFrameRGBA(i, imageData.data);
        fullCtx.putImageData(imageData, 0, 0);

        const snap = document.createElement("canvas");
        snap.width = width;
        snap.height = height;
        snap.getContext("2d").drawImage(full, 0, 0);
        const delay = Math.max(20, (info.delay || 10) * 10);
        frames.push({ canvas: snap, delay, index: i });
        setGifxProgress(true, ((i + 1) / count) * 0.7, `解码中… ${i + 1}/${count}`);
      }
      return frames;
    }

    async function renderExtractedList() {
      if (!gifxFramesEl) return;
      gifxFramesEl.innerHTML = "";
      for (const frame of extracted) {
        const row = document.createElement("div");
        row.className = "gif-frame";
        const img = document.createElement("img");
        img.className = "gif-frame-thumb";
        img.src = frame.url;
        img.alt = `frame-${frame.index + 1}`;
        const meta = document.createElement("div");
        meta.className = "gif-frame-meta";
        const name = document.createElement("div");
        name.className = "gif-frame-name";
        name.textContent = `第 ${frame.index + 1} 帧 · ${frame.delay} ms · ${frame.width}×${frame.height}`;
        const controls = document.createElement("div");
        controls.className = "gif-frame-controls";
        const link = document.createElement("a");
        link.className = "secondary-btn";
        link.textContent = "下载此帧";
        link.href = frame.url;
        link.download = `frame-${String(frame.index + 1).padStart(3, "0")}.png`;
        controls.appendChild(link);
        meta.append(name, controls);
        row.append(img, meta);
        gifxFramesEl.appendChild(row);
      }
    }

    async function loadGifFile(file) {
      if (!file) return;
      clearExtracted();
      setGifxProgress(true, 0.02, "读取文件…");
      try {
        const buffer = await file.arrayBuffer();
        let frames = await decodeGifWithImageDecoder(buffer);
        if (!frames || !frames.length) {
          frames = decodeGifWithOmggif(buffer);
        }
        if (!frames.length) throw new Error("未解析到帧");
        setGifxProgress(true, 0.75, "导出帧图片…");
        for (let i = 0; i < frames.length; i++) {
          const frame = frames[i];
          const blob = await canvasToBlob(frame.canvas, "image/png");
          const url = URL.createObjectURL(blob);
          extracted.push({
            index: frame.index,
            delay: frame.delay,
            width: frame.canvas.width,
            height: frame.canvas.height,
            canvas: frame.canvas,
            pngBlob: blob,
            url,
          });
          setGifxProgress(true, 0.75 + ((i + 1) / frames.length) * 0.25, `导出帧… ${i + 1}/${frames.length}`);
        }
        await renderExtractedList();
        const totalMs = extracted.reduce((s, f) => s + f.delay, 0);
        if (gifxMeta) {
          gifxMeta.textContent = `${file.name} · ${extracted.length} 帧 · 约 ${(totalMs / 1000).toFixed(2)}s · ${extracted[0].width}×${extracted[0].height}`;
        }
        if (gifxZipBtn) gifxZipBtn.disabled = false;
        if (gifxVideoBtn) gifxVideoBtn.disabled = false;
        setGifxProgress(true, 1, `已拆出 ${extracted.length} 帧`);
        toast(`已拆出 ${extracted.length} 帧`);
      } catch (err) {
        clearExtracted();
        setError(gifxError, err.message || String(err));
      } finally {
        if (gifxFile) gifxFile.value = "";
      }
    }

    function pickMime() {
      const format = gifxFormat?.value || "png";
      if (format === "jpeg") return { type: "image/jpeg", ext: "jpg", quality: 0.92 };
      if (format === "webp") return { type: "image/webp", ext: "webp", quality: 0.92 };
      return { type: "image/png", ext: "png", quality: undefined };
    }

    async function downloadZip() {
      if (!extracted.length) return;
      if (typeof JSZip !== "function") {
        setError(gifxError, "JSZip 未加载");
        return;
      }
      try {
        setError(gifxError, "");
        setGifxProgress(true, 0.05, "打包中…");
        const zip = new JSZip();
        const fmt = pickMime();
        for (let i = 0; i < extracted.length; i++) {
          const frame = extracted[i];
          let blob = frame.pngBlob;
          if (fmt.type !== "image/png") {
            blob = await canvasToBlob(frame.canvas, fmt.type, fmt.quality);
          }
          const name = `frame-${String(i + 1).padStart(3, "0")}.${fmt.ext}`;
          zip.file(name, blob);
          setGifxProgress(true, ((i + 1) / extracted.length) * 0.85, `打包… ${i + 1}/${extracted.length}`);
        }
        const meta = extracted.map((f, i) => `${i + 1}\t${f.delay}ms\t${f.width}x${f.height}`).join("\n");
        zip.file("frames.txt", `index\tdelay\tsize\n${meta}\n`);
        const out = await zip.generateAsync({ type: "blob" }, (meta) => {
          setGifxProgress(true, 0.85 + (meta.percent / 100) * 0.15, `压缩… ${Math.round(meta.percent)}%`);
        });
        const url = URL.createObjectURL(out);
        const a = document.createElement("a");
        a.href = url;
        a.download = "gif-frames.zip";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        setGifxProgress(true, 1, `已打包 ${extracted.length} 帧`);
        toast("已下载 ZIP");
      } catch (err) {
        setError(gifxError, err.message || String(err));
        setGifxProgress(false, 0, "");
      }
    }

    function pickRecorderMime() {
      const candidates = [
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
      ];
      for (const type of candidates) {
        if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(type)) return type;
      }
      return "video/webm";
    }

    function wait(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function exportVideo() {
      if (!extracted.length) return;
      if (typeof MediaRecorder !== "function") {
        setError(gifxError, "当前浏览器不支持 MediaRecorder");
        return;
      }
      abortVideo = false;
      if (gifxAbort) gifxAbort.hidden = false;
      if (gifxVideoBtn) gifxVideoBtn.disabled = true;
      if (gifxZipBtn) gifxZipBtn.disabled = true;
      setError(gifxError, "");
      setGifxProgress(true, 0.02, "准备录制…");

      try {
        const width = extracted[0].width;
        const height = extracted[0].height;
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        const fps = Math.min(60, Math.max(5, Number(gifxFps?.value) || 20));
        const stream = canvas.captureStream(fps);
        const mimeType = pickRecorderMime();
        const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 });
        const chunks = [];
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size) chunks.push(e.data);
        };

        const stopped = new Promise((resolve, reject) => {
          recorder.onstop = () => resolve();
          recorder.onerror = (e) => reject(e.error || new Error("录制失败"));
        });
        recorder.start(100);

        // paint first frame immediately
        for (let i = 0; i < extracted.length; i++) {
          if (abortVideo) throw new Error("已取消");
          const frame = extracted[i];
          ctx.clearRect(0, 0, width, height);
          ctx.drawImage(frame.canvas, 0, 0);
          const track = stream.getVideoTracks()[0];
          if (track && typeof track.requestFrame === "function") {
            track.requestFrame();
          }
          setGifxProgress(true, ((i + 1) / extracted.length) * 0.95, `导出视频… ${i + 1}/${extracted.length}`);
          await wait(Math.max(20, frame.delay));
        }
        // hold last frame briefly so encoders flush
        await wait(120);
        recorder.stop();
        stream.getTracks().forEach((t) => t.stop());
        await stopped;

        const blob = new Blob(chunks, { type: mimeType.includes("webm") ? "video/webm" : mimeType });
        if (!blob.size) throw new Error("视频为空，请换 Chrome / Edge 再试");
        if (videoUrl) URL.revokeObjectURL(videoUrl);
        videoUrl = URL.createObjectURL(blob);
        if (gifxVideoPreview) {
          gifxVideoPreview.src = videoUrl;
          gifxVideoPreview.hidden = false;
        }
        if (gifxDownloadVideo) {
          gifxDownloadVideo.href = videoUrl;
          gifxDownloadVideo.hidden = false;
        }
        setGifxProgress(true, 1, `完成 · ${(blob.size / 1024).toFixed(1)} KB`);
        toast("视频已生成");
      } catch (err) {
        if (String(err && err.message) !== "已取消") {
          setError(gifxError, err.message || String(err));
          setGifxProgress(false, 0, "");
        } else {
          setGifxProgress(false, 0, "");
          toast("已取消导出");
        }
      } finally {
        abortVideo = false;
        if (gifxAbort) gifxAbort.hidden = true;
        if (gifxVideoBtn) gifxVideoBtn.disabled = !extracted.length;
        if (gifxZipBtn) gifxZipBtn.disabled = !extracted.length;
      }
    }

    gifxFile?.addEventListener("change", (e) => loadGifFile(e.target.files?.[0]));
    $("#gifx-clear")?.addEventListener("click", clearExtracted);
    window.DevToolsTemp?.registerCleanup(clearExtracted);
    gifxZipBtn?.addEventListener("click", downloadZip);
    gifxVideoBtn?.addEventListener("click", exportVideo);
    gifxAbort?.addEventListener("click", () => {
      abortVideo = true;
    });
  } catch (err) {
    console.error("gif extract init failed", err);
  }

  // ---- Video to GIF ----
  try {
    const v2gFile = $("#v2g-file");
    const v2gVideo = $("#v2g-video");
    const v2gMeta = $("#v2g-meta");
    const v2gError = $("#v2g-error");
    const v2gFps = $("#v2g-fps");
    const v2gWidth = $("#v2g-width");
    const v2gMaxsec = $("#v2g-maxsec");
    const v2gStart = $("#v2g-start");
    const v2gQuality = $("#v2g-quality");
    const v2gBrightEnable = $("#v2g-bright-enable");
    const v2gBrightPanel = $("#v2g-bright-panel");
    const v2gBrightPresets = $("#v2g-bright-presets");
    const v2gBrightAmount = $("#v2g-bright-amount");
    const v2gBrightPct = $("#v2g-bright-pct");
    const v2gBrightReset = $("#v2g-bright-reset");
    const v2gBrightPreview = $("#v2g-bright-preview");
    const v2gGenerate = $("#v2g-generate");
    const v2gGenerateWebp = $("#v2g-generate-webp");
    const v2gBlackbox = $("#v2g-blackbox");
    const v2gAbort = $("#v2g-abort");
    const v2gProgress = $("#v2g-progress");
    const v2gProgressFill = $("#v2g-progress-fill");
    const v2gProgressText = $("#v2g-progress-text");
    const v2gProgressSub = $("#v2g-progress-sub");
    const v2gProgressPct = $("#v2g-progress-pct");
    const v2gPreview = $("#v2g-preview");
    const v2gDownload = $("#v2g-download");
    const v2gCompress = $("#v2g-compress");
    const v2gCompressAgain = $("#v2g-compress-again");
    const v2gCompressLevel = $("#v2g-compress-level");
    const MAX_V2G_FRAMES = 300;
    const MAX_V2G_SECONDS = 600;
    const V2G_BLACKBOX_MAX_BYTES = 6 * 1024 * 1024;
    /** 体积有余（<5MB）时尝试加宽，把预算用在清晰度上 */
    const V2G_BLACKBOX_WIDEN_BYTES = 5 * 1024 * 1024;
    /** 黑盒：起点宽 420 + quality 5；优先保住 12FPS；够小时再加宽 */
    const V2G_BLACKBOX_FPS_LIST = [15, 12, 10];
    const V2G_BLACKBOX_BASE_W = 420;
    const V2G_BLACKBOX_WIDTH_STEP = 60;
    const V2G_BLACKBOX_WIDTH_CAP = 720;
    const V2G_BLACKBOX_QUALITY = 5;
    const V2G_BLACKBOX_MAX_COMPRESS_ROUNDS = 10;
    /** 非最后一档：每轮轻lossy（对齐 -l），最多 3 轮不减色；多给高帧档机会再降 FPS */
    const V2G_BLACKBOX_SOFT_COMPRESS_ROUNDS = 3;
    const V2G_BLACKBOX_LONG_SPAN_SEC = 20;
    const V2G_FFMPEG_WARN_BYTES = 40 * 1024 * 1024;
    /** 滑块默认上限；数字框可更高，滑块 max 会跟着扩展 */
    const V2G_BRIGHT_SLIDER_MAX = 200;
    /** 防误触软顶（%）；实际无业务硬限 */
    const V2G_BRIGHT_SOFT_MAX = 999;
    const V2G_DEFAULT_META =
      "支持 MP4 / WebM / MOV。选择后仅本机读取，不会上传。默认 15FPS / 宽480 / 质量5。关闭页面会释放本次视频和 GIF；编码器缓存可在侧栏一键清理。";
    let v2gBrightPreviewTimer = 0;
    let v2gBrightPreviewToken = 0;
    let v2gBrightFrameReady = false;
    let videoObjectUrl = "";
    let gifObjectUrl = "";
    let latestV2gBlob = null;
    let baseV2gBlob = null;
    let originalV2gSize = 0;
    let v2gCompressRound = 0;
    /** @type {"gif"|"webp"} */
    let latestV2gFormat = "gif";
    /** @type {File|null} */
    let v2gSourceFile = null;
    let activeV2gGifs = new Set();
    let abortV2g = false;
    let compressingV2g = false;
    let v2gBusy = false;
    const webpEncodeSupported = canEncodeStillWebp();

    function refreshWebpButtonGate() {
      if (!v2gGenerateWebp) return;
      if (webpEncodeSupported) {
        v2gGenerateWebp.title = "浏览器原生编码各帧再封装为动画 WebP；通常比 GIF 更清晰更小";
        v2gGenerateWebp.hidden = false;
        return;
      }
      v2gGenerateWebp.disabled = true;
      v2gGenerateWebp.title = "当前浏览器不支持编码 WebP（常见于手机 Safari）。可用「转为 GIF」或「黑盒 GIF」。";
      v2gGenerateWebp.textContent = "动画 WebP（本机不支持）";
    }
    refreshWebpButtonGate();

    function setV2gActionButtons() {
      const hasVideo = Boolean(v2gVideo?.src);
      const canRun = hasVideo && !v2gBusy && !compressingV2g;
      if (v2gGenerate) v2gGenerate.disabled = !canRun;
      if (v2gGenerateWebp) v2gGenerateWebp.disabled = !canRun || !webpEncodeSupported;
      if (v2gBlackbox) v2gBlackbox.disabled = !canRun;
    }

    function setV2gCompressEnabled(on) {
      const allow = Boolean(on) && latestV2gFormat === "gif";
      if (v2gCompress) v2gCompress.disabled = !allow || compressingV2g || v2gBusy;
      if (v2gCompressAgain) {
        const canAgain = allow && v2gCompressRound > 0 && !compressingV2g && !v2gBusy;
        v2gCompressAgain.disabled = !canAgain;
        v2gCompressAgain.hidden = v2gCompressRound <= 0 || latestV2gFormat !== "gif";
      }
    }

    function applyV2gOutput(blob, { resetCompress = false, format = "gif" } = {}) {
      if (gifObjectUrl) {
        URL.revokeObjectURL(gifObjectUrl);
        gifObjectUrl = "";
      }
      latestV2gBlob = blob;
      latestV2gFormat = format === "webp" ? "webp" : "gif";
      if (resetCompress) {
        baseV2gBlob = blob;
        originalV2gSize = blob.size;
        v2gCompressRound = 0;
      }
      gifObjectUrl = URL.createObjectURL(blob);
      if (v2gPreview) {
        v2gPreview.src = gifObjectUrl;
        v2gPreview.hidden = false;
        v2gPreview.alt = latestV2gFormat === "webp" ? "视频转动画 WebP 预览" : "视频转 GIF 预览";
      }
      if (v2gDownload) {
        v2gDownload.href = gifObjectUrl;
        v2gDownload.hidden = false;
        v2gDownload.download = latestV2gFormat === "webp" ? "from-video.webp" : "from-video.gif";
        v2gDownload.textContent = latestV2gFormat === "webp" ? "下载 WebP" : "下载 GIF";
      }
      setV2gCompressEnabled(latestV2gFormat === "gif");
    }

    function setV2gProgress(visible, ratio, text, opts = {}) {
      if (!v2gProgress) return;
      v2gProgress.hidden = !visible;
      if (!visible) {
        if (v2gProgressFill) {
          v2gProgressFill.style.width = "0%";
          v2gProgressFill.classList.remove("is-active", "is-busy");
        }
        if (v2gProgressPct) {
          v2gProgressPct.textContent = "0%";
          v2gProgressPct.hidden = true;
        }
        if (v2gProgressText) v2gProgressText.textContent = "";
        if (v2gProgressSub) {
          v2gProgressSub.textContent = "";
          v2gProgressSub.hidden = true;
        }
        return;
      }
      const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
      const busy = Boolean(opts.busy) || (pct > 0 && pct < 100);
      if (v2gProgressFill) {
        v2gProgressFill.style.width = `${Math.max(pct, busy && pct < 8 ? 8 : pct)}%`;
        v2gProgressFill.classList.toggle("is-active", busy);
        v2gProgressFill.classList.toggle("is-busy", Boolean(opts.busy));
      }
      if (v2gProgressPct) {
        v2gProgressPct.textContent = `${pct}%`;
        v2gProgressPct.hidden = false;
      }
      if (v2gProgressText) v2gProgressText.textContent = text || `${pct}%`;
      if (v2gProgressSub) {
        const sub = opts.sub || "";
        v2gProgressSub.textContent = sub;
        v2gProgressSub.hidden = !sub;
      }
    }

    function revokeV2gGif() {
      if (gifObjectUrl) {
        URL.revokeObjectURL(gifObjectUrl);
        gifObjectUrl = "";
      }
      latestV2gBlob = null;
      baseV2gBlob = null;
      originalV2gSize = 0;
      v2gCompressRound = 0;
      latestV2gFormat = "gif";
      setV2gCompressEnabled(false);
      if (v2gPreview) {
        v2gPreview.hidden = true;
        v2gPreview.removeAttribute("src");
      }
      if (v2gDownload) {
        v2gDownload.hidden = true;
        v2gDownload.removeAttribute("href");
        v2gDownload.download = "from-video.gif";
        v2gDownload.textContent = "下载 GIF";
      }
    }

    function clearV2g() {
      abortV2g = true;
      activeV2gGifs.forEach((gif) => {
        try {
          gif.abort();
        } catch (_) {}
      });
      activeV2gGifs.clear();
      // 不清掉已预热的 FFmpeg，避免每次清空视频都重下 31MB
      v2gSourceFile = null;
      if (videoObjectUrl) {
        URL.revokeObjectURL(videoObjectUrl);
        videoObjectUrl = "";
      }
      if (v2gVideo) {
        v2gVideo.pause?.();
        v2gVideo.removeAttribute("src");
        v2gVideo.load?.();
        v2gVideo.hidden = true;
      }
      revokeV2gGif();
      setV2gActionButtons();
      if (v2gAbort) v2gAbort.hidden = true;
      setV2gProgress(false, 0, "");
      setError(v2gError, "");
      if (v2gMeta) {
        v2gMeta.textContent = V2G_DEFAULT_META;
      }
      if (v2gMaxsec) {
        v2gMaxsec.value = "";
        v2gMaxsec.max = String(MAX_V2G_SECONDS);
      }
      if (v2gStart) v2gStart.value = "0";
      if (v2gFile) v2gFile.value = "";
      if (v2gBrightPanel) v2gBrightPanel.hidden = true;
      v2gBrightFrameReady = false;
      if (v2gBrightPreview) v2gBrightPreview.style.filter = "none";
      abortV2g = false;
    }

    function clampV2gBrightPct(raw) {
      const n = Math.round(Number(raw));
      if (!Number.isFinite(n)) return 0;
      return Math.min(V2G_BRIGHT_SOFT_MAX, Math.max(0, n));
    }

    /** @returns {number} ≥0 相对提亮量（与 CSS brightness(1+x) / 像素乘算一致） */
    function readV2gBrightness() {
      if (!v2gBrightEnable?.checked) return 0;
      const raw = v2gBrightPct?.value ?? v2gBrightAmount?.value;
      return clampV2gBrightPct(raw) / 100;
    }

    /** 乘法系数：+20% → 1.2（预览 CSS / WebP 像素 / FFmpeg 共用） */
    function v2gBrightMultiplier(bright) {
      const b = Math.max(0, Number(bright) || 0);
      return 1 + b;
    }

    /**
     * FFmpeg 乘法提亮（勿用 eq=brightness：那是 -1..1 加性，同等数值会亮很多）。
     * 例：+20% → colorchannelmixer rr/gg/bb=1.2
     */
    function v2gBrightFfmpegFilter(bright) {
      if (!(Number(bright) > 0)) return "";
      const m = v2gBrightMultiplier(bright).toFixed(4);
      return `,colorchannelmixer=rr=${m}:gg=${m}:bb=${m}`;
    }

    function formatV2gBrightTip(bright) {
      const b = Number(bright) || 0;
      if (b <= 0) return "";
      return ` · 已调亮 +${Math.round(b * 100)}%`;
    }

    function syncV2gBrightUi() {
      const pct = clampV2gBrightPct(v2gBrightPct?.value ?? v2gBrightAmount?.value);
      if (v2gBrightAmount) {
        const sliderMax = Math.max(V2G_BRIGHT_SLIDER_MAX, pct);
        if (Number(v2gBrightAmount.max) !== sliderMax) v2gBrightAmount.max = String(sliderMax);
        if (Number(v2gBrightAmount.value) !== pct) v2gBrightAmount.value = String(pct);
      }
      if (v2gBrightPct && Number(v2gBrightPct.value) !== pct) v2gBrightPct.value = String(pct);
      if (v2gBrightReset) v2gBrightReset.disabled = pct <= 0;
      if (v2gBrightPresets) {
        v2gBrightPresets.querySelectorAll("[data-bright]").forEach((btn) => {
          const v = Math.round(Number(btn.getAttribute("data-bright")) || 0);
          btn.classList.toggle("is-active", v === pct);
        });
      }
    }

    function setV2gBrightPct(raw, { preview = true } = {}) {
      const pct = clampV2gBrightPct(raw);
      if (v2gBrightPct) v2gBrightPct.value = String(pct);
      if (v2gBrightAmount) {
        v2gBrightAmount.max = String(Math.max(V2G_BRIGHT_SLIDER_MAX, pct));
        v2gBrightAmount.value = String(pct);
      }
      if (preview) {
        applyV2gBrightCssFilter();
        if (!v2gBrightFrameReady && v2gBrightEnable?.checked) {
          scheduleV2gBrightPreview({ forceCapture: true });
        }
      } else {
        syncV2gBrightUi();
      }
    }

    /** 预览用 CSS filter，系数与导出乘法提亮一致 */
    function applyV2gBrightCssFilter() {
      syncV2gBrightUi();
      if (!v2gBrightPreview) return;
      const bright = readV2gBrightness();
      const m = v2gBrightMultiplier(bright);
      v2gBrightPreview.style.filter = bright > 0 ? `brightness(${m})` : "none";
    }

    /**
     * 抓取起始秒附近原画到 canvas，再套 CSS 亮度。
     * 仅亮度变化时不必重抓，直接改 CSS。
     */
    async function captureV2gBrightPreviewFrame() {
      if (!v2gBrightEnable?.checked || !v2gVideo?.src || !v2gVideo.videoWidth) {
        if (v2gBrightPanel) v2gBrightPanel.hidden = true;
        v2gBrightFrameReady = false;
        return;
      }
      if (!v2gBrightPreview || !v2gBrightPanel) return;
      const token = ++v2gBrightPreviewToken;
      const startSec = Math.max(0, Number(v2gStart?.value) || 0);
      try {
        await seekVideo(v2gVideo, startSec);
        if (token !== v2gBrightPreviewToken) return;
        await waitFrame();
        if (token !== v2gBrightPreviewToken) return;
        // 部分机型 seek 后首帧仍空，再等一小拍
        await new Promise((r) => setTimeout(r, 30));
        if (token !== v2gBrightPreviewToken) return;
        const srcW = v2gVideo.videoWidth;
        const srcH = v2gVideo.videoHeight;
        if (!srcW || !srcH) throw new Error("无尺寸");
        const maxW = 480;
        const scale = srcW > maxW ? maxW / srcW : 1;
        const outW = Math.max(1, Math.round(srcW * scale));
        const outH = Math.max(1, Math.round(srcH * scale));
        v2gBrightPreview.width = outW;
        v2gBrightPreview.height = outH;
        const ctx = v2gBrightPreview.getContext("2d", { alpha: false });
        if (!ctx) throw new Error("无画布");
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, outW, outH);
        ctx.drawImage(v2gVideo, 0, 0, outW, outH);
        v2gBrightFrameReady = true;
        v2gBrightPanel.hidden = false;
        applyV2gBrightCssFilter();
      } catch (_) {
        if (token === v2gBrightPreviewToken) {
          v2gBrightFrameReady = false;
          if (v2gBrightPanel) v2gBrightPanel.hidden = true;
        }
      }
    }

    function scheduleV2gBrightPreview(opts = {}) {
      const forceCapture = Boolean(opts.forceCapture);
      if (!forceCapture && v2gBrightFrameReady && v2gBrightEnable?.checked && v2gBrightPanel && !v2gBrightPanel.hidden) {
        applyV2gBrightCssFilter();
        return;
      }
      if (v2gBrightPreviewTimer) window.clearTimeout(v2gBrightPreviewTimer);
      v2gBrightPreviewTimer = window.setTimeout(() => {
        v2gBrightPreviewTimer = 0;
        captureV2gBrightPreviewFrame().catch(() => {});
      }, forceCapture ? 60 : 40);
    }

    function seekVideo(video, time) {
      return new Promise((resolve, reject) => {
        if (!Number.isFinite(time)) {
          reject(new Error("无效的时间点"));
          return;
        }
        const onSeeked = () => {
          video.removeEventListener("seeked", onSeeked);
          video.removeEventListener("error", onError);
          resolve();
        };
        const onError = () => {
          video.removeEventListener("seeked", onSeeked);
          video.removeEventListener("error", onError);
          reject(new Error("视频定位失败"));
        };
        video.addEventListener("seeked", onSeeked);
        video.addEventListener("error", onError);
        const maxT = Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.001) : time;
        const target = Math.max(0, Math.min(time, maxT));
        if (Math.abs((video.currentTime || 0) - target) < 0.001) {
          video.removeEventListener("seeked", onSeeked);
          video.removeEventListener("error", onError);
          resolve();
          return;
        }
        video.currentTime = target;
      });
    }

    function waitFrame() {
      return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
      });
    }

    async function loadVideoFile(file) {
      if (!file) return;
      clearV2g();
      v2gSourceFile = file;
      setError(v2gError, "");
      if (v2gMeta) v2gMeta.textContent = formatLocalPickMeta(file, "正在读取时长…");
      toast("已选择，仅本机处理，不会上传");
      setV2gProgress(true, 0.12, "本地读取视频信息（不上传）…");
      try {
        videoObjectUrl = URL.createObjectURL(file);
        if (!v2gVideo) throw new Error("视频预览未找到");
        attachLocalVideoPreview(v2gVideo, videoObjectUrl);
        await waitVideoMetadata(v2gVideo);
        // Some WebM blobs report Infinity until more data is parsed
        let duration = Number(v2gVideo.duration) || 0;
        if (!Number.isFinite(duration) || duration <= 0) {
          const start = Date.now();
          while (Date.now() - start < 2500) {
            await new Promise((r) => setTimeout(r, 100));
            duration = Number(v2gVideo.duration) || 0;
            if (Number.isFinite(duration) && duration > 0) break;
          }
        }
        if ((!Number.isFinite(duration) || duration <= 0) && v2gVideo.videoWidth) {
          duration = 0; // unknown; conversion will use playback capture
        }
        if (!v2gVideo.videoWidth || !v2gVideo.videoHeight) throw new Error("视频时长或尺寸无效");
        if (v2gMaxsec) {
          if (Number.isFinite(duration) && duration > 0) {
            const secs = Math.min(MAX_V2G_SECONDS, Math.max(0.5, Math.round(duration * 10) / 10));
            v2gMaxsec.value = String(secs);
            v2gMaxsec.max = String(Math.max(MAX_V2G_SECONDS, Math.ceil(secs)));
          } else {
            v2gMaxsec.value = "";
            v2gMaxsec.placeholder = "时长未知，请手动填写";
          }
        }
        if (v2gStart) v2gStart.value = "0";
        if (v2gMeta) {
          const durText = Number.isFinite(duration) && duration > 0 ? `${duration.toFixed(2)}s` : "时长未知";
          const maxTip =
            Number.isFinite(duration) && duration > 0
              ? ` · 最长秒数已设为 ${v2gMaxsec?.value || "—"}s`
              : "";
          v2gMeta.textContent = formatLocalPickMeta(file, `${durText} · ${v2gVideo.videoWidth}×${v2gVideo.videoHeight}${maxTip}`);
        }
        setV2gActionButtons();
        setV2gProgress(true, 1, "视频已就绪（未上传）");
        toast("视频已就绪");
        scheduleV2gBrightPreview({ forceCapture: true });
      } catch (err) {
        clearV2g();
        setError(v2gError, err.message || String(err));
      }
    }

    function resolveV2gSpan() {
      const startSec = Math.max(0, Number(v2gStart?.value) || 0);
      let duration = Number(v2gVideo.duration) || 0;
      const hasDuration = Number.isFinite(duration) && duration > 0;
      if (hasDuration && startSec >= duration) throw new Error("起始时间超出视频长度");
      const rawMax = Number(v2gMaxsec?.value);
      let maxSec;
      if (Number.isFinite(rawMax) && rawMax > 0) {
        maxSec = Math.min(MAX_V2G_SECONDS, Math.max(0.5, rawMax));
      } else if (hasDuration) {
        maxSec = Math.min(MAX_V2G_SECONDS, Math.max(0.5, duration - startSec));
      } else {
        maxSec = 6;
      }
      const endSec = hasDuration ? Math.min(duration, startSec + maxSec) : startSec + maxSec;
      const span = Math.max(0.05, endSec - startSec);
      return { startSec, maxSec, span, hasDuration, duration };
    }

    /**
     * 按当前 UI 参数抽帧到 canvas，每帧 paint 后回调 onFrame(ctx, index, total)。
     * @returns {Promise<{frameCount:number,span:number,fps:number,outW:number,outH:number,framesCapped:boolean,quality:number,maxW:number,delay:number,canvas:HTMLCanvasElement,ctx:CanvasRenderingContext2D}>}
     */
    async function sampleV2gFrames(opts) {
      const video = opts.video || v2gVideo;
      if (!video) throw new Error("视频未找到");
      const fps = Math.min(15, Math.max(2, Number(opts.fps) || 8));
      const maxW = Math.min(720, Math.max(64, Number(opts.maxW) || 360));
      const quality = Math.min(30, Math.max(1, Number(opts.quality) || 12));
      const progressBase = Number(opts.progressBase) || 0;
      const progressSpan = Number(opts.progressSpan) || 1;
      const stageLabel = opts.stageLabel || "";
      const sampleShare = Number.isFinite(opts.sampleShare) ? opts.sampleShare : 0.45;
      const mapProgress = (local, text) => {
        if (typeof opts.onProgress === "function") opts.onProgress(local, text);
        else setV2gProgress(true, progressBase + local * progressSpan, text);
      };

      const { startSec, maxSec, span, hasDuration } = resolveV2gSpan();
      const delay = Math.round(1000 / fps);
      const naturalFrames = Math.max(2, Math.floor(span * fps) + 1);
      let frameCount = Math.min(MAX_V2G_FRAMES, naturalFrames);
      const framesCapped = naturalFrames > MAX_V2G_FRAMES;

      const srcW = video.videoWidth || 0;
      const srcH = video.videoHeight || 0;
      if (!srcW || !srcH) throw new Error("无法读取视频尺寸");
      const scale = srcW > maxW ? maxW / srcW : 1;
      const outW = Math.max(1, Math.round(srcW * scale));
      const outH = Math.max(1, Math.round(srcH * scale));

      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const wm = readGifWatermarkOptions("v2g");
      const bright = Number.isFinite(opts.brightness) ? Number(opts.brightness) : readV2gBrightness();
      const prefix = stageLabel ? `${stageLabel} · ` : "";

      const paint = () => {
        ctx.fillStyle = "#000000";
        ctx.fillRect(0, 0, outW, outH);
        ctx.drawImage(video, 0, 0, outW, outH);
        if (bright > 0) {
          try {
            const img = ctx.getImageData(0, 0, outW, outH);
            const d = img.data;
            const m = v2gBrightMultiplier(bright);
            for (let i = 0; i < d.length; i += 4) {
              d[i] = Math.min(255, d[i] * m);
              d[i + 1] = Math.min(255, d[i + 1] * m);
              d[i + 2] = Math.min(255, d[i + 2] * m);
            }
            ctx.putImageData(img, 0, 0);
          } catch (_) {
            // 跨域/受保护帧时跳过像素调亮
          }
        }
        drawGifTextWatermark(ctx, outW, outH, wm);
      };

      if (hasDuration) {
        for (let i = 0; i < frameCount; i++) {
          if (abortV2g) throw new Error("已取消");
          const t = startSec + (span * i) / Math.max(1, frameCount - 1);
          await seekVideo(video, t);
          await waitFrame();
          paint();
          await opts.onFrame?.(ctx, i, frameCount);
          mapProgress(((i + 1) / frameCount) * sampleShare, `${prefix}抽帧… ${i + 1}/${frameCount}`);
        }
      } else {
        video.currentTime = startSec;
        await waitFrame();
        try {
          await video.play();
        } catch (_) {}
        const startedAt = performance.now();
        let captured = 0;
        let lastAt = -Infinity;
        while (captured < frameCount) {
          if (abortV2g) throw new Error("已取消");
          if (video.ended) break;
          const elapsed = (performance.now() - startedAt) / 1000;
          if (elapsed > maxSec + 0.5) break;
          const now = performance.now();
          if (now - lastAt >= delay * 0.9) {
            paint();
            await opts.onFrame?.(ctx, captured, frameCount);
            captured += 1;
            lastAt = now;
            mapProgress((captured / frameCount) * sampleShare, `${prefix}抽帧… ${captured}/${frameCount}`);
          }
          await waitFrame();
        }
        video.pause();
        frameCount = Math.max(2, captured);
        if (captured < 2) throw new Error("未能从视频抓取足够帧");
      }

      return {
        frameCount,
        span,
        fps,
        outW,
        outH,
        framesCapped,
        quality,
        maxW,
        delay,
        canvas,
        ctx,
        mapProgress,
        prefix,
      };
    }

    /**
     * Encode video segment to GIF with explicit params.
     * @param {{ fps:number, maxW:number, quality:number, video?:HTMLVideoElement, workerScript?:string, progressBase?:number, progressSpan?:number, stageLabel?:string, onProgress?:(local:number,text:string)=>void }} opts
     */
    async function encodeV2gGif(opts) {
      let ownedWorkerScript = "";
      let workerScript = opts.workerScript || "";
      const cleanupWorker = () => {
        if (!ownedWorkerScript) return;
        try {
          URL.revokeObjectURL(ownedWorkerScript);
        } catch (_) {}
        ownedWorkerScript = "";
      };
      if (!workerScript) {
        const workerSource = await fetch(new URL("./vendor/gif.worker.js", document.baseURI || window.location.href)).then((r) => {
          if (!r.ok) throw new Error("无法加载 gif.worker.js");
          return r.text();
        });
        ownedWorkerScript = URL.createObjectURL(new Blob([workerSource], { type: "application/javascript" }));
        workerScript = ownedWorkerScript;
      }

      let gif = null;
      try {
        let outW = 0;
        let outH = 0;
        const sampled = await sampleV2gFrames({
          ...opts,
          sampleShare: 0.45,
          onFrame: async (ctx, _i, _total) => {
            if (!gif) {
              outW = ctx.canvas.width;
              outH = ctx.canvas.height;
              gif = new GIF({
                workers: opts.workers || 2,
                quality: Math.min(30, Math.max(1, Number(opts.quality) || 12)),
                width: outW,
                height: outH,
                workerScript,
                repeat: 0,
                background: "#000000",
              });
              activeV2gGifs.add(gif);
            }
            const delay = Math.round(1000 / Math.min(15, Math.max(2, Number(opts.fps) || 8)));
            gif.addFrame(ctx, { delay, copy: true });
          },
        });

        if (!gif) throw new Error("未能创建 GIF 编码器");
        const blob = await new Promise((resolve, reject) => {
          gif.on("progress", (p) => {
            sampled.mapProgress(0.45 + p * 0.55, `${sampled.prefix}编码 GIF… ${Math.round(p * 100)}%`);
          });
          gif.on("finished", (b) => resolve(b));
          gif.on("abort", () => reject(new Error("已取消")));
          try {
            gif.render();
          } catch (err) {
            reject(err);
          }
        });

        return {
          blob,
          frameCount: sampled.frameCount,
          span: sampled.span,
          fps: sampled.fps,
          outW: sampled.outW,
          outH: sampled.outH,
          framesCapped: sampled.framesCapped,
          quality: sampled.quality,
          maxW: sampled.maxW,
        };
      } finally {
        if (gif) activeV2gGifs.delete(gif);
        cleanupWorker();
      }
    }

    async function canvasToWebpBytes(canvas, quality01) {
      const blob = await new Promise((resolve, reject) => {
        try {
          canvas.toBlob((b) => resolve(b), "image/webp", quality01);
        } catch (err) {
          reject(err);
        }
      });
      if (!blob) throw new Error("当前浏览器无法编码 WebP");
      const buf = new Uint8Array(await blob.arrayBuffer());
      const isWebp =
        buf.length >= 12 &&
        buf[0] === 0x52 &&
        buf[1] === 0x49 &&
        buf[2] === 0x46 &&
        buf[3] === 0x46 &&
        buf[8] === 0x57 &&
        buf[9] === 0x45 &&
        buf[10] === 0x42 &&
        buf[11] === 0x50;
      if (!isWebp) throw new Error("当前浏览器不支持编码 WebP（可改用「转为 GIF」）");
      return buf;
    }

    /**
     * Encode video segment to animated WebP (browser still-WebP + ANMF mux).
     */
    async function encodeV2gWebp(opts) {
      if (!canEncodeStillWebp()) {
        throw new Error("当前浏览器不支持 WebP 编码，请换 Chrome / Edge / Firefox 再试");
      }
      const webpQ = gifQualityToWebpQuality(opts.quality);
      const stillFrames = [];
      const sampled = await sampleV2gFrames({
        ...opts,
        sampleShare: 0.88,
        onFrame: async (ctx) => {
          const file = await canvasToWebpBytes(ctx.canvas, webpQ);
          stillFrames.push({ file, durationMs: 100 });
        },
      });
      for (const f of stillFrames) f.durationMs = sampled.delay;
      if (stillFrames.length < 2) throw new Error("未能从视频抓取足够帧");

      sampled.mapProgress(0.92, `${sampled.prefix}封装动画 WebP…`);
      const blob = encodeAnimatedWebpFromStillFrames(stillFrames, sampled.outW, sampled.outH, 0);
      sampled.mapProgress(1, `${sampled.prefix}完成`);
      return {
        blob,
        frameCount: sampled.frameCount,
        span: sampled.span,
        fps: sampled.fps,
        outW: sampled.outW,
        outH: sampled.outH,
        framesCapped: sampled.framesCapped,
        quality: sampled.quality,
        maxW: sampled.maxW,
        webpQuality: webpQ,
      };
    }

    function v2gSourceExt(file) {
      const name = String(file?.name || "").toLowerCase();
      if (name.endsWith(".webm")) return "webm";
      if (name.endsWith(".mov")) return "mov";
      if (name.endsWith(".m4v")) return "m4v";
      if (name.endsWith(".mkv")) return "mkv";
      return "mp4";
    }

    function createEncodeProgressTicker(mapProgress, base, span, initialPhase, isAborted) {
      let phase = initialPhase || "处理中";
      let lastP = 0;
      let lastBumpAt = Date.now();
      const startedAt = Date.now();
      const aborted = typeof isAborted === "function" ? isAborted : () => abortV2g;
      const timer = setInterval(() => {
        if (aborted()) return;
        const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
        const stalled = Date.now() - lastBumpAt > 900;
        if (stalled) {
          lastP = Math.min(0.97, lastP + 0.012);
          lastBumpAt = Date.now();
        }
        const pct = Math.round(lastP * 100);
        mapProgress(
          base + lastP * span,
          `${phase} · ${pct}% · 已用时 ${elapsed}s${stalled ? " · 编码中请稍候" : ""}`
        );
      }, 700);
      return {
        setPhase(next) {
          phase = next || phase;
          lastBumpAt = Date.now();
        },
        setProgress(p) {
          const n = Math.max(0, Math.min(1, Number(p) || 0));
          if (n >= lastP) {
            lastP = n;
            lastBumpAt = Date.now();
          }
        },
        bump() {
          lastP = Math.min(0.96, lastP + 0.004);
          lastBumpAt = Date.now();
        },
        stop() {
          clearInterval(timer);
        },
      };
    }

    async function buildV2gWatermarkPng(outW, outH) {
      const wm = readGifWatermarkOptions("v2g");
      if (!wm?.enabled || !String(wm.text || "").trim()) return null;
      const w = Math.max(2, Math.round(outW));
      const h = Math.max(2, Math.round(outH));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.clearRect(0, 0, w, h);
      drawGifTextWatermark(ctx, w, h, wm);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) return null;
      return new Uint8Array(await blob.arrayBuffer());
    }

    /**
     * FFmpeg palettegen/paletteuse 出 GIF（默认引擎）。
     */
    async function encodeV2gGifFfmpeg(opts) {
      const file = opts.file || v2gSourceFile;
      if (!file) throw new Error("缺少原始视频文件，请重新选择视频");
      const fps = Math.min(15, Math.max(2, Number(opts.fps) || 8));
      const maxW = Math.min(720, Math.max(64, Number(opts.maxW) || 360));
      const quality = Math.min(30, Math.max(1, Number(opts.quality) || 12));
      const maxColors = gifQualityToMaxColors(quality);
      const skipWm = Boolean(opts.skipWatermark);
      const bright = opts.skipBright
        ? 0
        : Number.isFinite(opts.brightness)
          ? Number(opts.brightness)
          : readV2gBrightness();
      const brightFilter = v2gBrightFfmpegFilter(bright);
      let startSec;
      let span;
      if (Number.isFinite(opts.startSec) && Number.isFinite(opts.span)) {
        startSec = Math.max(0, Number(opts.startSec));
        span = Math.max(0.05, Number(opts.span));
      } else {
        ({ startSec, span } = resolveV2gSpan());
      }
      const aborted = () => abortV2g || (typeof opts.isAborted === "function" && opts.isAborted());
      const naturalFrames = Math.max(2, Math.floor(span * fps) + 1);
      const framesCapped = naturalFrames > MAX_V2G_FRAMES;
      const frameCount = Math.min(MAX_V2G_FRAMES, naturalFrames);
      const srcW = Number(opts.srcW) || v2gVideo?.videoWidth || 0;
      const srcH = Number(opts.srcH) || v2gVideo?.videoHeight || 0;
      const scale = srcW > maxW && srcW > 0 ? maxW / srcW : 1;
      const outW = srcW ? Math.max(2, Math.round((srcW * scale) / 2) * 2) : maxW;
      const outH = srcH ? Math.max(2, Math.round((srcH * scale) / 2) * 2) : Math.round(outW * 0.75);
      const stageLabel = opts.stageLabel ? `${opts.stageLabel} · ` : "";

      const mapProgress = (local, text) => {
        if (typeof opts.onProgress === "function") opts.onProgress(local, text);
        else setV2gProgress(true, local, text);
      };

      if (aborted()) throw new Error("已取消");
      mapProgress(0.03, `${stageLabel}准备 FFmpeg 引擎…`);
      let ticker = null;
      const ffmpeg = await getFfmpegInstance((ratio, text) => {
        mapProgress(0.03 + Math.min(0.12, (ratio || 0) * 0.12), `${stageLabel}${text || "加载引擎…"}`);
      });
      if (aborted()) throw new Error("已取消");

      ticker = createEncodeProgressTicker(mapProgress, 0.2, 0.72, `${stageLabel}准备编码`, aborted);
      const onFfmpegProgress = ({ progress }) => {
        if (aborted()) return;
        const p = Math.max(0, Math.min(1, Number(progress) || 0));
        ticker.setProgress(p);
        ticker.setPhase(p < 0.45 ? `${stageLabel}分析调色板` : `${stageLabel}写入 GIF 帧`);
      };
      const onFfmpegLog = () => {
        ticker.bump();
      };
      ffmpeg.on("progress", onFfmpegProgress);
      try {
        ffmpeg.on("log", onFfmpegLog);
      } catch (_) {}

      const ext = v2gSourceExt(file);
      const outName = "out.gif";
      const wmName = "wm.png";
      let usedWm = false;
      let inName = `in.${ext}`;
      let segName = null;
      let encodeInput = inName;
      let encodeSs = startSec;
      let encodeT = span;

      try {
        ticker.setPhase(`${stageLabel}本地载入`);
        mapProgress(0.16, `${stageLabel}载入本地编码器（不上传）…`);
        inName = await ensureFfmpegInputWritten(ffmpeg, file, (_r, text) => {
          mapProgress(0.16, `${stageLabel}${text || "载入本地编码器（不上传）…"}`);
        });
        encodeInput = inName;
        if (aborted()) throw new Error("已取消");

        // 大文件先按段 remux，避免整片在调色板滤镜里反复解复用（手机易加载失败/白屏）
        const wantSeg =
          file.size >= FFMPEG_SEG_FILE_BYTES &&
          Number.isFinite(opts.startSec) &&
          Number.isFinite(opts.span);
        if (wantSeg) {
          segName = `seg-${Date.now().toString(36)}.${ext}`;
          ticker.setPhase(`${stageLabel}抽取片段`);
          mapProgress(0.18, `${stageLabel}抽取片段…`);
          const cutCode = await ffmpeg.exec([
            "-ss",
            String(startSec),
            "-t",
            String(Math.min(span + 0.15, span * 1.05 + 0.05)),
            "-i",
            inName,
            "-c",
            "copy",
            "-avoid_negative_ts",
            "make_zero",
            "-movflags",
            "+faststart",
            "-y",
            segName,
          ]);
          if (aborted()) throw new Error("已取消");
          if (cutCode === 0) {
            encodeInput = segName;
            encodeSs = 0;
            encodeT = span;
          } else {
            try {
              await ffmpeg.deleteFile(segName);
            } catch (_) {}
            segName = null;
          }
        }

        const wmBytes = skipWm ? null : await buildV2gWatermarkPng(outW, outH);
        let filterArgs;
        if (wmBytes && wmBytes.length) {
          usedWm = true;
          await ffmpeg.writeFile(wmName, wmBytes);
          filterArgs = [
            "-filter_complex",
            `[0:v]fps=${fps},scale=${maxW}:-2:flags=lanczos${brightFilter}[base];` +
              `[1:v]format=rgba[wm];[base][wm]overlay=0:0:format=auto[v];` +
              `[v]split[s0][s1];[s0]palettegen=max_colors=${maxColors}:stats_mode=diff[p];` +
              `[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
          ];
        } else {
          filterArgs = [
            "-vf",
            `fps=${fps},scale=${maxW}:-2:flags=lanczos${brightFilter},` +
              `split[s0][s1];[s0]palettegen=max_colors=${maxColors}:stats_mode=diff[p];` +
              `[s1][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle`,
          ];
        }

        ticker.setPhase(`${stageLabel}双通道调色板编码`);
        ticker.setProgress(0.05);
        const args = [];
        if (encodeSs > 0.001) args.push("-ss", String(encodeSs));
        args.push("-t", String(encodeT), "-i", encodeInput);
        if (usedWm) args.push("-i", wmName);
        args.push(
          ...filterArgs,
          "-frames:v",
          String(frameCount),
          "-loop",
          "0",
          "-y",
          outName
        );
        const code = await ffmpeg.exec(args);
        if (aborted()) throw new Error("已取消");
        if (code !== 0) throw new Error(`FFmpeg 失败（code=${code}）`);

        ticker.stop();
        ticker = null;
        mapProgress(0.94, `${stageLabel}读取 GIF…`);
        const data = await ffmpeg.readFile(outName);
        const raw = data instanceof Uint8Array ? data : new Uint8Array(data);
        const bytes = new Uint8Array(raw.byteLength);
        bytes.set(raw);
        const blob = new Blob([bytes], { type: "image/gif" });
        if (!blob.size) throw new Error("FFmpeg 未产出 GIF");
        mapProgress(1, `${stageLabel}完成`);
        return {
          blob,
          frameCount,
          span,
          fps,
          outW,
          outH,
          framesCapped,
          quality,
          maxW,
          maxColors,
          engine: "ffmpeg",
          watermark: usedWm,
          brightness: bright,
        };
      } finally {
        if (ticker) ticker.stop();
        try {
          ffmpeg.off("progress", onFfmpegProgress);
        } catch (_) {}
        try {
          ffmpeg.off("log", onFfmpegLog);
        } catch (_) {}
        // 源视频保留在引擎内复用；仅清理段文件与输出
        if (segName) {
          try {
            await ffmpeg.deleteFile(segName);
          } catch (_) {}
        }
        try {
          await ffmpeg.deleteFile(outName);
        } catch (_) {}
        if (usedWm) {
          try {
            await ffmpeg.deleteFile(wmName);
          } catch (_) {}
        }
      }
    }

    function describeBlackboxCandidate(c) {
      if (!c) return "";
      const compressTip = c.compressRounds > 0 ? ` · 已压 ${c.compressRounds} 轮` : " · 未压缩";
      const effFps = c.frameCount > 1 ? (c.frameCount - 1) / c.span : c.fps;
      const capTip = c.framesCapped
        ? ` · 已抽稀到 ${c.frameCount} 帧（约 ${effFps.toFixed(1)} FPS）`
        : "";
      const widthTip = c.maxW ? ` · 宽≤${c.maxW}` : "";
      return `${c.fps} FPS${widthTip} · ${c.outW}×${c.outH} · ${formatKb(c.blob.size)}${compressTip}${capTip}`;
    }

    function summarizeBlackboxCandidates(list) {
      return (list || [])
        .map((c) => `${c.fps}FPS ${formatKb(c.blob.size)}`)
        .join(" · ");
    }

    /** 长片跳过 15：触顶 300 帧后名义 15 无意义，且更慢 */
    function resolveBlackboxFpsList(span) {
      const s = Number(span) || 0;
      const framesAt15 = Math.floor(s * 15) + 1;
      if (s > V2G_BLACKBOX_LONG_SPAN_SEC || framesAt15 > MAX_V2G_FRAMES) {
        return V2G_BLACKBOX_FPS_LIST.filter((fps) => fps <= 12);
      }
      return V2G_BLACKBOX_FPS_LIST.slice();
    }

    function applyBlackboxSuccess(candidate, note) {
      applyV2gOutput(candidate.blob, { resetCompress: true, format: "gif" });
      v2gCompressRound = candidate.compressRounds || 0;
      setV2gCompressEnabled(true);
      if (v2gMeta) {
        v2gMeta.textContent = `${note} · ${describeBlackboxCandidate(candidate)}${formatV2gBrightTip(candidate.brightness)}`;
      }
      setV2gProgress(true, 1, `黑盒完成 · ${describeBlackboxCandidate(candidate)}`);
      toast(`黑盒 GIF 已生成 · ${candidate.fps}FPS · ${formatKb(candidate.blob.size)}`);
    }

    function resolveBlackboxWidthCap() {
      const srcW = Number(v2gVideo?.videoWidth) || 0;
      if (srcW > 0) return Math.min(V2G_BLACKBOX_WIDTH_CAP, srcW);
      return V2G_BLACKBOX_WIDTH_CAP;
    }

    /**
     * 体积有余（<5MB）时按步进加宽；某档超过 6MB 则回退上一档。
     * 加宽只重编码、不压缩，避免牺牲刚换来的清晰度。
     */
    async function tryWidenBlackboxCandidate(baseCandidate, fps) {
      let best = baseCandidate;
      if (!best?.blob || best.blob.size >= V2G_BLACKBOX_WIDEN_BYTES) return best;
      if (best.blob.size > V2G_BLACKBOX_MAX_BYTES) return best;

      const hardMax = resolveBlackboxWidthCap();
      let nextW = (Number(best.maxW) || V2G_BLACKBOX_BASE_W) + V2G_BLACKBOX_WIDTH_STEP;
      if (nextW > hardMax) {
        setV2gProgress(true, 0.96, `黑盒：体积有余但已达源宽度上限（≤${hardMax}）`);
        return best;
      }

      let step = 0;
      while (nextW <= hardMax) {
        if (abortV2g) throw new Error("已取消");
        step += 1;
        const progress = Math.min(0.97, 0.72 + step * 0.05);
        setV2gProgress(
          true,
          progress,
          `黑盒加宽 · ${fps}FPS`,
          { sub: `${formatKb(best.blob.size)} → 试宽 ${nextW}`, busy: true }
        );
        const encoded = await encodeV2gGifFfmpeg({
          file: v2gSourceFile,
          fps,
          maxW: nextW,
          quality: V2G_BLACKBOX_QUALITY,
          stageLabel: `${fps}FPS·宽${nextW}`,
          onProgress: (local, text) => {
            setV2gProgress(
              true,
              Math.min(0.97, progress + Math.min(0.04, (local || 0) * 0.04)),
              `黑盒加宽 · ${fps}FPS`,
              { sub: text || `编码宽 ${nextW}…`, busy: local > 0 && local < 1 }
            );
          },
        });
        const cand = { ...encoded, compressRounds: 0, maxW: nextW };
        if (cand.blob.size > V2G_BLACKBOX_MAX_BYTES) {
          setV2gProgress(
            true,
            0.98,
            `黑盒加宽超限 · 沿用宽≤${best.maxW}`,
            { sub: `宽 ${nextW} · ${formatKb(cand.blob.size)}` }
          );
          break;
        }
        best = cand;
        if (best.outW > 0 && best.outW < nextW - 2) {
          // 源视频本身更窄，继续加宽无收益
          setV2gProgress(true, 0.98, `黑盒：输出宽已达源尺寸 ${best.outW}，停止加宽`);
          break;
        }
        nextW += V2G_BLACKBOX_WIDTH_STEP;
      }
      return best;
    }

    /**
     * 单档：编码后若超 6MB 再压缩。
     * 非最后一档：轻柔 lossy（对齐 -l，不减色），不够则降帧。
     * 最后一档：标准/强力多轮（每轮都有 lossy），尽量挤进 6MB。
     * @returns {{ candidate: object, underBudget: boolean }}
     */
    async function encodeAndCompressBlackboxTier(fps, tierIndex, tierTotal, maxW = V2G_BLACKBOX_BASE_W) {
      if (abortV2g) throw new Error("已取消");
      const base = tierIndex / Math.max(1, tierTotal);
      const spanShare = 1 / Math.max(1, tierTotal);
      const isLastTier = tierIndex >= tierTotal - 1;
      const maxRounds = isLastTier ? V2G_BLACKBOX_MAX_COMPRESS_ROUNDS : V2G_BLACKBOX_SOFT_COMPRESS_ROUNDS;
      const width = Math.min(V2G_BLACKBOX_WIDTH_CAP, Math.max(64, Number(maxW) || V2G_BLACKBOX_BASE_W));

      setV2gProgress(true, base + 0.02 * spanShare, `黑盒编码 · ${fps}FPS`, {
        sub: `宽≤${width} · 档位 ${tierIndex + 1}/${tierTotal}`,
      });

      const encoded = await encodeV2gGifFfmpeg({
        file: v2gSourceFile,
        fps,
        maxW: width,
        quality: V2G_BLACKBOX_QUALITY,
        stageLabel: `${fps}FPS`,
        onProgress: (local, text) => {
          setV2gProgress(
            true,
            base + Math.min(0.55, local * 0.55) * spanShare,
            `黑盒编码 · ${fps}FPS`,
            { sub: text || "编码中…", busy: local > 0 && local < 1 }
          );
        },
      });

      let candidate = { ...encoded, compressRounds: 0, maxW: width };
      if (candidate.blob.size <= V2G_BLACKBOX_MAX_BYTES) {
        return { candidate, underBudget: true };
      }

      for (let round = 1; round <= maxRounds; round++) {
        if (abortV2g) throw new Error("已取消");
        const before = candidate.blob.size;
        const plan = isLastTier
          ? buildBlackboxHardCompressArgs(round)
          : buildBlackboxSoftCompressArgs(round);
        const modeTip = isLastTier ? plan.label : "轻柔";
        setV2gProgress(
          true,
          base + (0.55 + (round / (maxRounds + 1)) * 0.4) * spanShare,
          `黑盒压缩 · ${fps}FPS`,
          {
            sub: `第 ${round}/${maxRounds} 轮 · ${modeTip} · ${formatKb(before)}`,
            busy: true,
          }
        );
        const out = await compressGifBlob(
          candidate.blob,
          "standard",
          (ratio, text, meta) => {
            setV2gProgress(
              true,
              base + (0.55 + ((round - 1 + ratio) / (maxRounds + 1)) * 0.4) * spanShare,
              `黑盒压缩 · ${fps}FPS`,
              {
                sub: `第 ${round}/${maxRounds} 轮 · ${text || modeTip}`,
                busy: Boolean(meta?.busy) || ratio < 1,
              }
            );
          },
          { round, plan }
        );
        candidate = { ...candidate, blob: out, compressRounds: round };
        if (out.size <= V2G_BLACKBOX_MAX_BYTES) {
          return { candidate, underBudget: true };
        }
        if (out.size >= before * 0.99) {
          setV2gProgress(
            true,
            base + 0.96 * spanShare,
            isLastTier ? `黑盒 · ${fps}FPS 压缩收益不足` : `黑盒 · ${fps}FPS 将降帧`,
            { sub: formatKb(out.size) }
          );
          break;
        }
      }

      if (!isLastTier && candidate.blob.size > V2G_BLACKBOX_MAX_BYTES) {
        setV2gProgress(
          true,
          base + 0.98 * spanShare,
          `黑盒 · ${fps}FPS 仍超 6MB`,
          { sub: `${formatKb(candidate.blob.size)} · 改试更低帧率` }
        );
      }

      return { candidate, underBudget: false };
    }

    function shouldReuseVbbFirstPlan(ranges, index) {
      if (!Array.isArray(ranges) || index <= 0 || index >= ranges.length - 1) return false;
      const a = Number(ranges[0]?.span) || 0;
      const b = Number(ranges[index]?.span) || 0;
      return a > 0 && Math.abs(a - b) < 0.08;
    }

    function snapshotVbbEncodeSeed(encoded, extras = {}) {
      if (!encoded?.blob) return null;
      return {
        fps: Number(encoded.fps) || 15,
        maxW: Math.max(64, Number(encoded.maxW || extras.usedWidth || encoded.outW) || V2G_BLACKBOX_BASE_W),
        compressRounds: Number(encoded.compressRounds) || 0,
        usedFallback: Boolean(extras.usedFallback),
      };
    }

    async function encodeBlackboxClip(clipOpts) {
      const file = clipOpts.file;
      const startSec = clipOpts.startSec;
      const span = clipOpts.span;
      const srcW = clipOpts.srcW;
      const srcH = clipOpts.srcH;
      const isAborted = clipOpts.isAborted || (() => abortV2g);
      const onProgress = clipOpts.onProgress || (() => {});
      const fpsList = resolveBlackboxFpsList(span);
      if (!fpsList.length) throw new Error("没有可用的黑盒帧率方案");
      const tried = [];
      const common = {
        file,
        startSec,
        span,
        srcW,
        srcH,
        skipWatermark: true,
        skipBright: true,
        brightness: 0,
        isAborted,
        quality: V2G_BLACKBOX_QUALITY,
      };

      const encodeAt = async (fps, maxW, progressBase, progressSpan, stageLabel) => {
        const encoded = await encodeV2gGifFfmpeg({
          ...common,
          fps,
          maxW,
          stageLabel,
          onProgress: (local, text) => onProgress(progressBase + Math.min(1, local) * progressSpan, text),
        });
        return { ...encoded, compressRounds: 0, maxW };
      };

      const compressAt = async (candidate, fps, isLastFps, progressBase) => {
        if (!(candidate?.blob?.size > V2G_BLACKBOX_MAX_BYTES)) return candidate;
        const maxRounds = isLastFps ? V2G_BLACKBOX_MAX_COMPRESS_ROUNDS : V2G_BLACKBOX_SOFT_COMPRESS_ROUNDS;
        let cur = candidate;
        for (let round = 1; round <= maxRounds; round++) {
          if (isAborted()) throw new Error("已取消");
          const before = cur.blob.size;
          const plan = isLastFps ? buildBlackboxHardCompressArgs(round) : buildBlackboxSoftCompressArgs(round);
          const out = await compressGifBlob(
            cur.blob,
            "standard",
            (ratio, text) => {
              onProgress(
                progressBase + ((round - 1 + ratio) / (maxRounds + 1)) * 0.18,
                `黑盒压缩 · ${fps}FPS · ${text || plan.label}`
              );
            },
            { round, plan }
          );
          cur = { ...cur, blob: out, compressRounds: round };
          if (out.size <= V2G_BLACKBOX_MAX_BYTES) break;
          if (out.size >= before * 0.99) break;
        }
        return cur;
      };

      const widenFrom = async (candidate, fps) => {
        if (!candidate?.blob || candidate.blob.size >= V2G_BLACKBOX_WIDEN_BYTES) return candidate;
        if (candidate.blob.size > V2G_BLACKBOX_MAX_BYTES) return candidate;
        let best = candidate;
        const hardMax = srcW > 0 ? Math.min(V2G_BLACKBOX_WIDTH_CAP, srcW) : V2G_BLACKBOX_WIDTH_CAP;
        let nextW = (Number(best.maxW) || V2G_BLACKBOX_BASE_W) + V2G_BLACKBOX_WIDTH_STEP;
        while (nextW <= hardMax) {
          if (isAborted()) throw new Error("已取消");
          onProgress(0.92, `黑盒加宽 · ${nextW}`);
          const wider = await encodeAt(fps, nextW, 0.92, 0.05, `${fps}FPS·宽${nextW}`);
          if (wider.blob.size > V2G_BLACKBOX_MAX_BYTES) break;
          best = wider;
          if (best.outW > 0 && best.outW < nextW - 2) break;
          nextW += V2G_BLACKBOX_WIDTH_STEP;
        }
        return best;
      };

      const seed = clipOpts.seed;
      if (seed?.fps) {
        const fps = Number(seed.fps) || 15;
        const isLastFps = fpsList[fpsList.length - 1] === fps;
        let width = Math.max(64, Number(seed.maxW) || V2G_BLACKBOX_BASE_W);
        onProgress(0.04, `沿用#01 · ${fps}FPS · 宽${width}`);
        let candidate = await encodeAt(fps, width, 0.04, 0.5, `${fps}FPS·宽${width}`);
        candidate = await compressAt(candidate, fps, isLastFps, 0.55);
        while (candidate.blob.size > V2G_BLACKBOX_MAX_BYTES && width > V2G_BLACKBOX_BASE_W) {
          width = Math.max(V2G_BLACKBOX_BASE_W, width - V2G_BLACKBOX_WIDTH_STEP);
          onProgress(0.74, `沿用后超限降宽 · ${width}`);
          candidate = await encodeAt(fps, width, 0.74, 0.08, `${fps}FPS·宽${width}`);
          candidate = await compressAt(candidate, fps, isLastFps, 0.84);
        }
        if (candidate.blob.size <= V2G_BLACKBOX_MAX_BYTES) {
          return widenFrom(candidate, fps);
        }
        // 沿用失败再走完整探测
      }

      for (let i = 0; i < fpsList.length; i++) {
        if (isAborted()) throw new Error("已取消");
        const fps = fpsList[i];
        const isLast = i >= fpsList.length - 1;
        const maxRounds = isLast ? V2G_BLACKBOX_MAX_COMPRESS_ROUNDS : V2G_BLACKBOX_SOFT_COMPRESS_ROUNDS;
        onProgress((i + 0.02) / fpsList.length, `黑盒编码 · ${fps}FPS`);
        const encoded = await encodeV2gGifFfmpeg({
          ...common,
          fps,
          maxW: V2G_BLACKBOX_BASE_W,
          stageLabel: `${fps}FPS`,
          onProgress: (local, text) => onProgress((i + Math.min(0.55, local * 0.55)) / fpsList.length, text),
        });
        let candidate = { ...encoded, compressRounds: 0, maxW: V2G_BLACKBOX_BASE_W };
        if (candidate.blob.size > V2G_BLACKBOX_MAX_BYTES) {
          for (let round = 1; round <= maxRounds; round++) {
            if (isAborted()) throw new Error("已取消");
            const before = candidate.blob.size;
            const plan = isLast ? buildBlackboxHardCompressArgs(round) : buildBlackboxSoftCompressArgs(round);
            const out = await compressGifBlob(
              candidate.blob,
              "standard",
              (ratio, text) => {
                onProgress(
                  (i + 0.55 + ((round - 1 + ratio) / (maxRounds + 1)) * 0.4) / fpsList.length,
                  `黑盒压缩 · ${fps}FPS · ${text || plan.label}`
                );
              },
              { round, plan }
            );
            candidate = { ...candidate, blob: out, compressRounds: round };
            if (out.size <= V2G_BLACKBOX_MAX_BYTES) break;
            if (out.size >= before * 0.99) break;
          }
        }
        tried.push(candidate);
        if (candidate.blob.size <= V2G_BLACKBOX_MAX_BYTES) {
          if (candidate.blob.size < V2G_BLACKBOX_WIDEN_BYTES) {
            let best = candidate;
            const hardMax = srcW > 0 ? Math.min(V2G_BLACKBOX_WIDTH_CAP, srcW) : V2G_BLACKBOX_WIDTH_CAP;
            let nextW = (Number(best.maxW) || V2G_BLACKBOX_BASE_W) + V2G_BLACKBOX_WIDTH_STEP;
            while (nextW <= hardMax) {
              if (isAborted()) throw new Error("已取消");
              onProgress(0.92, `黑盒加宽 · ${nextW}`);
              const wider = await encodeV2gGifFfmpeg({
                ...common,
                fps,
                maxW: nextW,
                stageLabel: `${fps}FPS·宽${nextW}`,
                onProgress: (local, text) => onProgress(0.92 + local * 0.05, text),
              });
              const cand = { ...wider, compressRounds: 0, maxW: nextW };
              if (cand.blob.size > V2G_BLACKBOX_MAX_BYTES) break;
              best = cand;
              if (best.outW > 0 && best.outW < nextW - 2) break;
              nextW += V2G_BLACKBOX_WIDTH_STEP;
            }
            return best;
          }
          return candidate;
        }
      }
      return tried.slice().sort((a, b) => a.blob.size - b.blob.size)[0] || null;
    }

    async function convertVideoToGif() {
      if (!v2gVideo || !v2gVideo.src) {
        setError(v2gError, "请先选择视频");
        return;
      }
      if (!v2gSourceFile) {
        setError(v2gError, "缺少原始文件，请重新选择视频");
        return;
      }
      if (v2gBusy) return;
      abortV2g = false;
      v2gBusy = true;
      revokeV2gGif();
      setError(v2gError, "");
      setV2gActionButtons();
      setV2gCompressEnabled(false);
      if (v2gAbort) v2gAbort.hidden = false;
      setV2gProgress(true, 0.02, "准备 FFmpeg 转换…");

      try {
        if (v2gSourceFile.size > V2G_FFMPEG_WARN_BYTES) {
          toast(`视频约 ${formatKb(v2gSourceFile.size)}，手机上可能较慢或内存不足`);
        }
        await prewarmFfmpegEngine().catch(() => {});
        const fps = Math.min(15, Math.max(2, Number(v2gFps?.value) || 8));
        const maxW = Math.min(720, Math.max(64, Number(v2gWidth?.value) || 360));
        const quality = Math.min(30, Math.max(1, Number(v2gQuality?.value) || 12));
        const result = await encodeV2gGifFfmpeg({ fps, maxW, quality, file: v2gSourceFile });
        applyV2gOutput(result.blob, { resetCompress: true, format: "gif" });
        setV2gProgress(
          true,
          1,
          `完成 · ${result.frameCount} 帧 · ${result.outW}×${result.outH} · ${formatKb(result.blob.size)}`
        );
        if (v2gMeta) {
          const effFps = result.frameCount > 1 ? (result.frameCount - 1) / result.span : result.fps;
          const capTip = result.framesCapped
            ? ` · 为控制体积已抽稀到 ${result.frameCount} 帧（约 ${effFps.toFixed(1)} FPS）`
            : "";
          const wmTip = result.watermark ? " · 含水印" : "";
          const brightTip = formatV2gBrightTip(result.brightness);
          v2gMeta.textContent = `已转换 GIF（FFmpeg） ${result.frameCount} 帧 · ${result.span.toFixed(1)}s · ${result.fps} FPS · ${result.outW}×${result.outH} · ${result.maxColors}色 · ${formatKb(result.blob.size)}${wmTip}${brightTip}${capTip}`;
        }
        toast("GIF 已生成");
      } catch (err) {
        if (abortV2g || String(err && err.message) === "已取消") {
          terminateFfmpegInstance({ revokeAssets: false });
          scheduleFfmpegPrewarm();
          setV2gProgress(false, 0, "");
          toast("已取消转换");
        } else {
          if (!ffmpegInstance?.loaded) terminateFfmpegInstance({ revokeAssets: false });
          scheduleFfmpegPrewarm();
          setError(v2gError, err.message || String(err));
          setV2gProgress(false, 0, "");
        }
      } finally {
        abortV2g = false;
        v2gBusy = false;
        if (v2gAbort) v2gAbort.hidden = true;
        setV2gActionButtons();
        setV2gCompressEnabled(Boolean(latestV2gBlob));
      }
    }

    async function convertVideoToWebp() {
      if (!v2gVideo || !v2gVideo.src) {
        setError(v2gError, "请先选择视频");
        return;
      }
      if (!webpEncodeSupported) {
        setError(v2gError, "当前浏览器不支持编码 WebP（常见于手机 Safari）。请用「转为 GIF」或「黑盒 GIF」");
        return;
      }
      if (v2gBusy) return;
      abortV2g = false;
      v2gBusy = true;
      revokeV2gGif();
      setError(v2gError, "");
      setV2gActionButtons();
      setV2gCompressEnabled(false);
      if (v2gAbort) v2gAbort.hidden = false;
      setV2gProgress(true, 0.02, "准备抽帧并编码 WebP…");

      try {
        const fps = Math.min(15, Math.max(2, Number(v2gFps?.value) || 8));
        const maxW = Math.min(720, Math.max(64, Number(v2gWidth?.value) || 360));
        const quality = Math.min(30, Math.max(1, Number(v2gQuality?.value) || 12));
        const result = await encodeV2gWebp({ fps, maxW, quality });
        applyV2gOutput(result.blob, { resetCompress: true, format: "webp" });
        setV2gProgress(
          true,
          1,
          `完成 · WebP ${result.frameCount} 帧 · ${result.outW}×${result.outH} · ${formatKb(result.blob.size)}`
        );
        if (v2gMeta) {
          const effFps = result.frameCount > 1 ? (result.frameCount - 1) / result.span : result.fps;
          const capTip = result.framesCapped
            ? ` · 已抽稀到 ${result.frameCount} 帧（约 ${effFps.toFixed(1)} FPS）`
            : "";
          const qTip = ` · WebP质量≈${Math.round((result.webpQuality || 0) * 100)}%`;
          const brightTip = formatV2gBrightTip(readV2gBrightness());
          v2gMeta.textContent = `已转换动画 WebP ${result.frameCount} 帧 · ${result.span.toFixed(1)}s · ${result.fps} FPS · ${result.outW}×${result.outH} · ${formatKb(result.blob.size)}${qTip}${brightTip}${capTip}`;
        }
        toast("动画 WebP 已生成");
      } catch (err) {
        if (String(err && err.message) !== "已取消") {
          setError(v2gError, err.message || String(err));
          setV2gProgress(false, 0, "");
        } else {
          setV2gProgress(false, 0, "");
          toast("已取消转换");
        }
      } finally {
        abortV2g = false;
        v2gBusy = false;
        if (v2gAbort) v2gAbort.hidden = true;
        setV2gActionButtons();
        setV2gCompressEnabled(Boolean(latestV2gBlob));
      }
    }

    async function convertVideoToGifBlackBox() {
      if (!v2gVideo || !v2gVideo.src) {
        setError(v2gError, "请先选择视频");
        return;
      }
      if (!v2gSourceFile) {
        setError(v2gError, "缺少原始文件，请重新选择视频");
        return;
      }
      if (v2gBusy) return;
      abortV2g = false;
      v2gBusy = true;
      revokeV2gGif();
      setError(v2gError, "");
      setV2gActionButtons();
      setV2gCompressEnabled(false);
      if (v2gAbort) v2gAbort.hidden = false;
      setV2gProgress(true, 0.02, "黑盒准备中", {
        sub: `起点宽 ${V2G_BLACKBOX_BASE_W} · 15→12→10 · 够小再加宽`,
        busy: true,
      });

      try {
        await prewarmFfmpegEngine().catch(() => {});
        const { span } = resolveV2gSpan();
        const fpsList = resolveBlackboxFpsList(span);
        if (!fpsList.length) throw new Error("没有可用的黑盒帧率方案");

        const skipTip =
          fpsList[0] < 15
            ? `约 ${span.toFixed(1)}s，从 ${fpsList[0]}FPS 起试`
            : `尝试 ${fpsList.join("/")} FPS`;
        setV2gProgress(true, 0.03, "黑盒开始", { sub: skipTip, busy: true });

        const tried = [];
        for (let i = 0; i < fpsList.length; i++) {
          if (abortV2g) throw new Error("已取消");
          const fps = fpsList[i];
          const { candidate, underBudget } = await encodeAndCompressBlackboxTier(
            fps,
            i,
            fpsList.length,
            V2G_BLACKBOX_BASE_W
          );
          tried.push(candidate);
          if (underBudget) {
            let finalCand = candidate;
            if (candidate.blob.size < V2G_BLACKBOX_WIDEN_BYTES) {
              finalCand = await tryWidenBlackboxCandidate(candidate, fps);
            }
            const widened = (finalCand.maxW || 0) > (candidate.maxW || 0);
            const note =
              candidate.compressRounds > 0
                ? `黑盒完成 · ${fps}FPS 压缩 ${candidate.compressRounds} 轮后达标${widened ? "并加宽" : ""}`
                : widened
                  ? `黑盒完成 · ${fps}FPS 达标后加宽至 ≤${finalCand.maxW}`
                  : `黑盒完成 · ${fps}FPS 未压缩即达标`;
            applyBlackboxSuccess(finalCand, note);
            return;
          }
        }

        const fallback = tried.slice().sort((a, b) => a.blob.size - b.blob.size)[0] || null;
        if (fallback) {
          applyV2gOutput(fallback.blob, { resetCompress: true, format: "gif" });
          v2gCompressRound = fallback.compressRounds || 0;
          setV2gCompressEnabled(true);
          const tip = summarizeBlackboxCandidates(tried);
          if (v2gMeta) {
            v2gMeta.textContent = `黑盒已尽力 · 仍超过 6MB · 已保留最小 ${describeBlackboxCandidate(fallback)}（试过 ${tip}）· 建议缩短「最长秒数」`;
          }
          setV2gProgress(true, 1, `仍超 6MB · 已保留最小 ${formatKb(fallback.blob.size)}`);
          setError(v2gError, "自动压到 6MB 失败：片段可能过长或画面过复杂，请缩短「最长秒数」后重试");
          toast(`黑盒未达 6MB，已保留最小 ${formatKb(fallback.blob.size)}`);
          return;
        }

        throw new Error("黑盒转换失败");
      } catch (err) {
        if (String(err && err.message) !== "已取消") {
          setError(v2gError, err.message || String(err));
          setV2gProgress(false, 0, "");
        } else {
          setV2gProgress(false, 0, "");
          toast("已取消转换");
        }
      } finally {
        abortV2g = false;
        v2gBusy = false;
        if (v2gAbort) v2gAbort.hidden = true;
        setV2gActionButtons();
        setV2gCompressEnabled(Boolean(latestV2gBlob));
      }
    }

    async function compressV2gGif({ again = false } = {}) {
      const input = again ? latestV2gBlob : baseV2gBlob || latestV2gBlob;
      if (!input || compressingV2g || v2gBusy) return;
      if (latestV2gFormat !== "gif") {
        setError(v2gError, "动画 WebP 暂不支持 gifsicle 压缩，请改用 GIF 或直接下载");
        return;
      }
      compressingV2g = true;
      setV2gCompressEnabled(false);
      setV2gActionButtons();
      setError(v2gError, "");
      const before = input.size;
      const nextRound = again ? v2gCompressRound + 1 : 1;
      if (!again) {
        originalV2gSize = (baseV2gBlob || input).size;
        v2gCompressRound = 0;
      }
      try {
        const level = v2gCompressLevel?.value || "standard";
        const out = await compressGifBlob(input, level, (ratio, text) => {
          setV2gProgress(true, ratio, text);
        }, { round: nextRound });
        const after = out.size;
        v2gCompressRound = nextRound;
        const summary = gifCompressSummary(originalV2gSize || before, before, after, nextRound);
        applyV2gOutput(out, { format: "gif" });
        if (v2gMeta) v2gMeta.textContent = summary.text;
        setV2gProgress(true, 1, `第 ${nextRound} 次压缩完成 · ${formatKb(before)} → ${formatKb(after)}`);
        toast(
          after < before
            ? `第 ${nextRound} 次已压缩，本轮约省 ${summary.stepSaved}%`
            : `第 ${nextRound} 次完成（本轮体积无明显下降，可换更强档位再试）`
        );
      } catch (err) {
        setError(v2gError, err.message || String(err));
        setV2gProgress(false, 0, "");
      } finally {
        compressingV2g = false;
        setV2gActionButtons();
        setV2gCompressEnabled(Boolean(latestV2gBlob));
      }
    }

    v2gFile?.addEventListener("change", (e) => loadVideoFile(e.target.files?.[0]));
    $("#v2g-clear")?.addEventListener("click", clearV2g);
    window.DevToolsTemp?.registerCleanup(clearV2g);
    v2gGenerate?.addEventListener("click", convertVideoToGif);
    v2gGenerateWebp?.addEventListener("click", () => {
      convertVideoToWebp().catch((err) => setError(v2gError, err.message || String(err)));
    });
    v2gBlackbox?.addEventListener("click", () => {
      convertVideoToGifBlackBox().catch((err) => setError(v2gError, err.message || String(err)));
    });
    v2gCompress?.addEventListener("click", () => {
      compressV2gGif({ again: false }).catch((err) => setError(v2gError, err.message || String(err)));
    });
    v2gCompressAgain?.addEventListener("click", () => {
      compressV2gGif({ again: true }).catch((err) => setError(v2gError, err.message || String(err)));
    });
    v2gAbort?.addEventListener("click", () => {
      abortV2g = true;
      activeV2gGifs.forEach((gif) => {
        try {
          gif.abort();
        } catch (_) {}
      });
      // 中断进行中的任务；保留已下载资源，后台再预热实例
      terminateFfmpegInstance({ revokeAssets: false });
      scheduleFfmpegPrewarm();
    });
    v2gBrightEnable?.addEventListener("change", () => {
      if (!v2gBrightEnable.checked) {
        if (v2gBrightPanel) v2gBrightPanel.hidden = true;
        v2gBrightFrameReady = false;
        if (v2gBrightPreview) v2gBrightPreview.style.filter = "none";
        syncV2gBrightUi();
        return;
      }
      if (clampV2gBrightPct(v2gBrightPct?.value ?? v2gBrightAmount?.value) <= 0) {
        setV2gBrightPct(20, { preview: false });
      }
      v2gBrightFrameReady = false;
      scheduleV2gBrightPreview({ forceCapture: true });
    });
    v2gBrightPresets?.addEventListener("click", (e) => {
      const btn = e.target?.closest?.("[data-bright]");
      if (!btn || !v2gBrightPresets.contains(btn)) return;
      setV2gBrightPct(btn.getAttribute("data-bright"));
    });
    v2gBrightReset?.addEventListener("click", () => {
      setV2gBrightPct(0);
      toast("已还原为原始亮度");
    });
    v2gBrightAmount?.addEventListener("input", () => {
      setV2gBrightPct(v2gBrightAmount.value);
    });
    v2gBrightPct?.addEventListener("input", () => {
      setV2gBrightPct(v2gBrightPct.value);
    });
    v2gBrightPct?.addEventListener("change", () => {
      setV2gBrightPct(v2gBrightPct.value);
    });
    v2gStart?.addEventListener("change", () => scheduleV2gBrightPreview({ forceCapture: true }));
    v2gStart?.addEventListener("input", () => scheduleV2gBrightPreview({ forceCapture: true }));
    syncV2gBrightUi();

    // ---- Video split (shares FFmpeg / blackbox encoder) ----
    const vsplitFile = $("#vsplit-file");
    const vsplitVideo = $("#vsplit-video");
    const vsplitMeta = $("#vsplit-meta");
    const vsplitError = $("#vsplit-error");
    const vsplitCount = $("#vsplit-count");
    const vsplitCountRow = $("#vsplit-count-row");
    const vsplitDurationRow = $("#vsplit-duration-row");
    const vsplitManualRow = $("#vsplit-manual-row");
    const vsplitManualTransport = $("#vsplit-manual-transport");
    const vsplitStage = $("#vsplit-stage");
    const vsplitScrub = $("#vsplit-scrub");
    const vsplitScrubHome = $("#vsplit-scrub-home");
    const vsplitScrubBlock = $("#vsplit-scrub-block");
    const vsplitFsScrubSlot = $("#vsplit-fs-scrub-slot");
    const vsplitScrubHit = $("#vsplit-scrub-hit");
    const vsplitScrubMarks = $("#vsplit-scrub-marks");
    const vsplitMarkPicker = $("#vsplit-mark-picker");
    const vsplitMarkChips = $("#vsplit-mark-chips");
    const vsplitScrubHint = $("#vsplit-scrub-hint");
    const vsplitPlay = $("#vsplit-play");
    const vsplitMute = $("#vsplit-mute");
    const vsplitFs = $("#vsplit-fs");
    const vsplitFsHost = $("#vsplit-fs-host");
    const vsplitFsOpenBtn = $("#vsplit-fs-open");
    const vsplitFsClose = $("#vsplit-fs-close");
    const vsplitFsPlay = $("#vsplit-fs-play");
    const vsplitFsMute = $("#vsplit-fs-mute");
    const vsplitFsMark = $("#vsplit-fs-mark");
    const vsplitFsUndo = $("#vsplit-fs-undo");
    const vsplitFsNow = $("#vsplit-fs-now");
    const vsplitFsStatus = $("#vsplit-fs-status");
    const vsplitFsNote = $("#vsplit-fs-note");
    const vsplitFsFlash = $("#vsplit-fs-flash");
    const vsplitPreviewWrap = $("#vsplit-preview-wrap");
    const vsplitManualNow = $("#vsplit-manual-now");
    const vsplitManualCount = $("#vsplit-manual-count");
    const vsplitManualDraft = $("#vsplit-manual-draft");
    const vsplitMarksEl = $("#vsplit-marks");
    const vsplitMarkTap = $("#vsplit-mark-tap");
    const vsplitMarkUndo = $("#vsplit-mark-undo");
    const vsplitMarkClear = $("#vsplit-mark-clear");
    const vsplitAddBtns = $("#vsplit-add-btns");
    const vsplitEditBar = $("#vsplit-edit-bar");
    const vsplitEditTitle = $("#vsplit-edit-title");
    const vsplitEditApply = $("#vsplit-edit-apply");
    const vsplitEditDelStart = $("#vsplit-edit-del-start");
    const vsplitEditDelEnd = $("#vsplit-edit-del-end");
    const vsplitEditDone = $("#vsplit-edit-done");
    const vsplitQuickExport = $("#vsplit-quick-export");
    const vsplitQuickCut = $("#vsplit-quick-cut");
    const vsplitQuickBb = $("#vsplit-quick-bb");
    const vsplitQuickHq = $("#vsplit-quick-hq");
    const vsplitNudgeM1 = $("#vsplit-nudge-m1");
    const vsplitNudgeM01 = $("#vsplit-nudge-m01");
    const vsplitNudgeP01 = $("#vsplit-nudge-p01");
    const vsplitNudgeP1 = $("#vsplit-nudge-p1");
    const vsplitH = $("#vsplit-h");
    const vsplitM = $("#vsplit-m");
    const vsplitS = $("#vsplit-s");
    const vsplitFps = $("#vsplit-fps");
    const vsplitWidth = $("#vsplit-width");
    const vsplitQuality = $("#vsplit-quality");
    const vsplitCut = $("#vsplit-cut");
    const vsplitGifHq = $("#vsplit-gif-hq");
    const vsplitGifBb = $("#vsplit-gif-bb");
    const vsplitMerge = $("#vsplit-merge");
    const vsplitAbort = $("#vsplit-abort");
    const vsplitList = $("#vsplit-list");
    const vsplitZipVideo = $("#vsplit-zip-video");
    const vsplitZipGif = $("#vsplit-zip-gif");
    const vsplitMergedDl = $("#vsplit-merged-dl");
    const vsplitMergedPreview = $("#vsplit-merged-preview");
    const vsplitProgress = $("#vsplit-progress");
    const vsplitProgressFill = $("#vsplit-progress-fill");
    const vsplitProgressText = $("#vsplit-progress-text");
    const vsplitProgressSub = $("#vsplit-progress-sub");
    const vsplitProgressPct = $("#vsplit-progress-pct");
    const VSPLIT_MAX_CLIPS = 50;
    const VSPLIT_MIN_SPAN = 0.5;
    const VSPLIT_DEFAULT_META =
      "支持 MP4 / WebM / MOV。选择后仅本机读取，不会上传。可等分、按时长或手动选段；关闭页面会释放本次视频和 GIF。";
    let vsplitSourceFile = null;
    let vsplitObjectUrl = "";
    let vsplitClips = [];
    let vsplitBusy = false;
    let abortVsplit = false;
    let vsplitZipVideoUrl = "";
    let vsplitZipGifUrl = "";
    let vsplitMergedUrl = "";
    let vsplitMode = "count";
    /** @type {{start:number|null,end:number|null}[]} */
    let vsplitMarks = [];
    /** @type {number|null} */
    let vsplitDraftStart = null;
    let vsplitEditIdx = -1;
    /** 附近标记弹层里高亮的端点（你刚点到的） */
    let vsplitPickerHighlight = null;
    /** @type {"start"|"end"} */
    let vsplitEditFocus = "start";
    let vsplitScrubbing = false;
    let vsplitPlaying = false;
    const VSPLIT_MUTE_KEY = "devtools-vsplit-muted";
    let vsplitMuted = true;
    try {
      const savedMute = localStorage.getItem(VSPLIT_MUTE_KEY);
      if (savedMute === "0") vsplitMuted = false;
      if (savedMute === "1") vsplitMuted = true;
    } catch (_) {
      /* ignore */
    }
    let vsplitFsOpen = false;
    let vsplitFsNoteTimer = 0;
    let vsplitFsPulseTimer = 0;
    let vsplitFsFlashTimer = 0;
    let vsplitFsStatusTimer = 0;
    const VSPLIT_SCRUB_STEPS = 1000;
    /** 按住滑块上下滑：微调窗口（秒） */
    const VSPLIT_FINE_WINDOW = 4;
    const scrubGesture = {
      active: false,
      pointerId: null,
      startX: 0,
      startY: 0,
      anchorTime: 0,
      fine: false,
    };

    function setVsplitProgress(visible, ratio, text, opts = {}) {
      if (!vsplitProgress) return;
      vsplitProgress.hidden = !visible;
      if (!visible) {
        if (vsplitProgressFill) {
          vsplitProgressFill.style.width = "0%";
          vsplitProgressFill.classList.remove("is-active", "is-busy");
        }
        if (vsplitProgressPct) vsplitProgressPct.hidden = true;
        if (vsplitProgressSub) vsplitProgressSub.hidden = true;
        return;
      }
      const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
      const busy = Boolean(opts.busy) || (pct > 0 && pct < 100);
      if (vsplitProgressFill) {
        vsplitProgressFill.style.width = `${Math.max(pct, busy && pct < 8 ? 8 : pct)}%`;
        vsplitProgressFill.classList.toggle("is-active", busy);
        vsplitProgressFill.classList.toggle("is-busy", Boolean(opts.busy));
      }
      if (vsplitProgressPct) {
        vsplitProgressPct.textContent = `${pct}%`;
        vsplitProgressPct.hidden = false;
      }
      if (vsplitProgressText) vsplitProgressText.textContent = text || `${pct}%`;
      if (vsplitProgressSub) {
        vsplitProgressSub.textContent = opts.sub || "";
        vsplitProgressSub.hidden = !opts.sub;
      }
    }

    function buildClipProgressDom() {
      const box = document.createElement("div");
      box.className = "vsplit-clip-progress";
      box.hidden = true;
      box.innerHTML =
        '<div class="vsplit-clip-progress-head">' +
        '<span class="hint tight vsplit-clip-progress-text">等待中…</span>' +
        '<span class="mono vsplit-clip-progress-pct">—</span>' +
        "</div>" +
        '<div class="gif-progress-track" aria-hidden="true"><span class="gif-progress-fill"></span></div>';
      return box;
    }

    function syncClipProgressDom(box, job) {
      if (!box) return;
      const status = job?.jobStatus || "";
      const show = status === "pending" || status === "running" || status === "done" || status === "error";
      box.hidden = !show;
      if (!show) return;
      box.dataset.status = status;
      const ratio = Math.max(0, Math.min(1, Number(job.jobProgress) || 0));
      const pct = Math.round(ratio * 100);
      const fill = box.querySelector(".gif-progress-fill");
      const textEl = box.querySelector(".vsplit-clip-progress-text");
      const pctEl = box.querySelector(".vsplit-clip-progress-pct");
      const running = status === "running";
      if (fill) {
        const width = status === "pending" ? 0 : Math.max(pct, running && pct < 6 ? 6 : pct);
        fill.style.width = `${width}%`;
        fill.classList.toggle("is-active", running);
        fill.classList.toggle("is-busy", running);
      }
      if (textEl) {
        textEl.textContent =
          job.jobText ||
          (status === "pending"
            ? "等待中…"
            : status === "running"
              ? "处理中…"
              : status === "done"
                ? "完成"
                : status === "error"
                  ? "失败"
                  : "");
      }
      if (pctEl) pctEl.textContent = status === "pending" ? "—" : `${pct}%`;
    }

    function setVsplitClipJob(idx, patch = {}) {
      const c = vsplitClips[idx];
      if (!c) return;
      if (patch.status != null) c.jobStatus = patch.status;
      if (patch.progress != null) c.jobProgress = Math.max(0, Math.min(1, Number(patch.progress) || 0));
      if (patch.text != null) c.jobText = String(patch.text || "");
      const row = vsplitList?.querySelector(`[data-vsplit-clip="${idx}"]`);
      if (row) syncClipProgressDom(row.querySelector(".vsplit-clip-progress"), c);
    }

    function clearVsplitClipJobs() {
      vsplitClips.forEach((c) => {
        c.jobStatus = "";
        c.jobProgress = 0;
        c.jobText = "";
      });
    }

    function formatClock(sec) {
      const s = Math.max(0, Number(sec) || 0);
      const h = Math.floor(s / 3600);
      const m = Math.floor((s % 3600) / 60);
      const r = Math.floor(s % 60);
      const tenths = Math.round((s - Math.floor(s)) * 10);
      const tail = tenths ? `.${tenths}` : "";
      if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}${tail}`;
      return `${m}:${String(r).padStart(2, "0")}${tail}`;
    }

    /** 片段时长文案，如 7.0秒 */
    function formatVsplitSpanSec(sec) {
      const s = Math.max(0, Number(sec) || 0);
      const rounded = Math.round(s * 10) / 10;
      return `${rounded.toFixed(1)}秒`;
    }

    function formatVsplitMarkRangeLabel(mark, idx) {
      const n = `#${String(idx + 1).padStart(2, "0")}`;
      const s = mark?.start == null ? "—" : formatClock(mark.start);
      const e = mark?.end == null ? "—" : formatClock(mark.end);
      if (mark && isMarkComplete(mark)) {
        return `${n} ${s}→${e} · 共${formatVsplitSpanSec(mark.end - mark.start)}`;
      }
      return `${n} ${s}→${e}`;
    }

    function revokeUrl(url) {
      if (!url) return;
      try {
        URL.revokeObjectURL(url);
      } catch (_) {}
    }

    function hideDownloadLink(el) {
      if (!el) return;
      el.hidden = true;
      el.removeAttribute("href");
    }

    function revokeVsplitGifOutputs() {
      revokeUrl(vsplitZipGifUrl);
      revokeUrl(vsplitMergedUrl);
      vsplitZipGifUrl = "";
      vsplitMergedUrl = "";
      if (vsplitZipGif) vsplitZipGif.disabled = true;
      hideDownloadLink(vsplitMergedDl);
      if (vsplitMergedPreview) {
        vsplitMergedPreview.hidden = true;
        vsplitMergedPreview.removeAttribute("src");
      }
    }

    function revokeVsplitDownloads() {
      revokeUrl(vsplitZipVideoUrl);
      vsplitZipVideoUrl = "";
      if (vsplitZipVideo) vsplitZipVideo.disabled = true;
      revokeVsplitGifOutputs();
    }

    function resetVsplitAbort() {
      abortVsplit = false;
      abortV2g = false;
    }

    function clearVsplitClips() {
      vsplitClips.forEach((c) => {
        try {
          if (c.videoUrl) URL.revokeObjectURL(c.videoUrl);
        } catch (_) {}
        try {
          if (c.gifUrl) URL.revokeObjectURL(c.gifUrl);
        } catch (_) {}
      });
      vsplitClips = [];
      if (vsplitList) vsplitList.innerHTML = "";
      revokeVsplitDownloads();
    }

    function isMarkComplete(m) {
      return (
        m &&
        Number.isFinite(m.start) &&
        Number.isFinite(m.end) &&
        m.start != null &&
        m.end != null &&
        m.end - m.start >= VSPLIT_MIN_SPAN - 0.001
      );
    }

    function completeVsplitMarks() {
      return vsplitMarks.filter(isMarkComplete);
    }

    function setVsplitButtons() {
      const hasVideo = Boolean(vsplitSourceFile && vsplitVideo?.src);
      const hasClips = vsplitClips.length > 0;
      const completeMarks = completeVsplitMarks();
      const hasComplete = completeMarks.length > 0;
      const videoCount = vsplitClips.filter((c) => c.videoBlob).length;
      const gifCount = vsplitClips.filter((c) => c.gifBlob).length;
      const editing = vsplitEditIdx >= 0;
      const canManualCut = vsplitMode !== "manual" || hasComplete;
      if (vsplitCut) {
        vsplitCut.disabled = !hasVideo || vsplitBusy || !canManualCut;
        vsplitCut.textContent = vsplitMode === "manual" ? "按标记切成视频" : "切成视频";
      }
      const canGif = hasClips || (vsplitMode === "manual" && hasComplete);
      if (vsplitGifHq) vsplitGifHq.disabled = !canGif || vsplitBusy;
      if (vsplitGifBb) vsplitGifBb.disabled = !canGif || vsplitBusy;
      if (vsplitMerge) vsplitMerge.disabled = gifCount < 2 || vsplitBusy;
      if (vsplitZipVideo) vsplitZipVideo.disabled = videoCount < 1 || vsplitBusy;
      if (vsplitZipGif) vsplitZipGif.disabled = gifCount < 1 || vsplitBusy;
      if (vsplitPlay) {
        vsplitPlay.disabled = !hasVideo || vsplitBusy || vsplitMode !== "manual";
        vsplitPlay.textContent = vsplitPlaying ? "暂停" : "播放";
      }
      paintVsplitMuteButtons(hasVideo && !vsplitBusy && vsplitMode === "manual");
      const markLabel = vsplitDraftStart == null ? "打起点" : "打终点";
      if (vsplitMarkTap) {
        vsplitMarkTap.disabled = !hasVideo || vsplitBusy || editing;
        vsplitMarkTap.textContent = markLabel;
      }
      if (vsplitFsOpenBtn) {
        vsplitFsOpenBtn.disabled = !hasVideo || vsplitBusy || vsplitMode !== "manual";
        vsplitFsOpenBtn.hidden = vsplitMode !== "manual";
      }
      if (vsplitFsPlay) {
        vsplitFsPlay.disabled = !hasVideo || vsplitBusy;
        vsplitFsPlay.textContent = vsplitPlaying ? "暂停" : "播放";
      }
      if (vsplitFsMark) {
        vsplitFsMark.disabled = !hasVideo || vsplitBusy || editing;
        vsplitFsMark.textContent = markLabel;
      }
      const canUndoLast =
        !editing && hasVideo && !vsplitBusy && (vsplitDraftStart != null || vsplitMarks.length > 0);
      const undoLabel = vsplitDraftStart != null ? "取消起点" : "取消上一段";
      if (vsplitMarkUndo) {
        vsplitMarkUndo.hidden = false;
        vsplitMarkUndo.disabled = !canUndoLast;
        vsplitMarkUndo.textContent = undoLabel;
      }
      if (vsplitFsUndo) {
        vsplitFsUndo.disabled = !canUndoLast;
        vsplitFsUndo.textContent = undoLabel;
      }
      if (vsplitMarkClear) {
        vsplitMarkClear.disabled =
          (!vsplitMarks.length && vsplitDraftStart == null) || vsplitBusy || editing;
      }
      if (vsplitScrub) vsplitScrub.disabled = !hasVideo || vsplitBusy || vsplitMode !== "manual";
      [vsplitNudgeM1, vsplitNudgeM01, vsplitNudgeP01, vsplitNudgeP1].forEach((btn) => {
        if (btn) btn.disabled = !hasVideo || vsplitBusy || vsplitMode !== "manual";
      });
      if (vsplitAddBtns) vsplitAddBtns.hidden = editing;
      if (vsplitEditBar) vsplitEditBar.hidden = !editing;
      if (vsplitQuickExport) {
        vsplitQuickExport.hidden = !(vsplitMode === "manual" && hasComplete);
      }
      if (vsplitQuickCut) vsplitQuickCut.disabled = !hasVideo || vsplitBusy || !canManualCut;
      if (vsplitQuickBb) vsplitQuickBb.disabled = !canGif || vsplitBusy;
      if (vsplitQuickHq) vsplitQuickHq.disabled = !canGif || vsplitBusy;
      if (editing) {
        const mark = vsplitMarks[vsplitEditIdx];
        if (vsplitEditApply) {
          vsplitEditApply.disabled = !hasVideo || vsplitBusy;
          vsplitEditApply.textContent = vsplitEditFocus === "start" ? "设为起点" : "设为终点";
        }
        if (vsplitEditDelStart) vsplitEditDelStart.disabled = !mark || mark.start == null || vsplitBusy;
        if (vsplitEditDelEnd) vsplitEditDelEnd.disabled = !mark || mark.end == null || vsplitBusy;
        $$("#vsplit-edit-focus [data-edit-focus]").forEach((btn) => {
          btn.classList.toggle("is-active", btn.dataset.editFocus === vsplitEditFocus);
        });
        if (vsplitEditTitle) {
          const n = String(vsplitEditIdx + 1).padStart(2, "0");
          const focusLabel = vsplitEditFocus === "start" ? "起点" : "终点";
          vsplitEditTitle.textContent = `编辑 #${n} · 拖滑块即调${focusLabel}`;
        }
      }
    }

    function syncVsplitMode() {
      const isCount = vsplitMode === "count";
      const isDuration = vsplitMode === "duration";
      const isManual = vsplitMode === "manual";
      $("#vsplit-mode-n")?.classList.toggle("is-active", isCount);
      $("#vsplit-mode-t")?.classList.toggle("is-active", isDuration);
      $("#vsplit-mode-m")?.classList.toggle("is-active", isManual);
      if (vsplitCountRow) vsplitCountRow.hidden = !isCount;
      if (vsplitDurationRow) vsplitDurationRow.hidden = !isDuration;
      if (vsplitManualRow) vsplitManualRow.hidden = !isManual;
      if (vsplitManualTransport) vsplitManualTransport.hidden = !isManual;
      if (vsplitMarksEl) vsplitMarksEl.hidden = true;
      vsplitStage?.classList.toggle("is-manual", isManual);
      if (!isManual) {
        pauseVsplitPreview();
        exitVsplitEdit();
        exitVsplitFullscreen({ restoreVideo: true });
      }
      if (vsplitVideo) {
        if (isManual) vsplitVideo.removeAttribute("controls");
        else vsplitVideo.setAttribute("controls", "");
      }
      if (isManual) {
        syncVsplitScrubFromVideo();
        paintVsplitNow();
        paintVsplitMarks();
      }
      setVsplitButtons();
    }

    function roundVsplitTime(sec) {
      const n = Number(sec);
      if (!Number.isFinite(n)) return 0;
      return Math.round(Math.max(0, n) * 10) / 10;
    }

    function vsplitVideoNow() {
      return Number(vsplitVideo?.currentTime) || 0;
    }

    function vsplitVideoDuration() {
      const d = Number(vsplitVideo?.duration);
      return Number.isFinite(d) && d > 0 ? d : 0;
    }

    function pauseVsplitPreview() {
      try {
        vsplitVideo?.pause?.();
      } catch (_) {}
      vsplitPlaying = false;
      if (vsplitPlay) vsplitPlay.textContent = "播放";
      if (vsplitFsPlay) vsplitFsPlay.textContent = "播放";
    }

    function paintVsplitMuteButtons(enabled) {
      const label = vsplitMuted ? "开声音" : "静音";
      const title = vsplitMuted ? "当前静音，点此开声音" : "当前有声，点此静音";
      [vsplitMute, vsplitFsMute].forEach((btn) => {
        if (!btn) return;
        if (enabled != null) btn.disabled = !enabled;
        btn.textContent = label;
        btn.title = title;
        btn.setAttribute("aria-pressed", vsplitMuted ? "true" : "false");
        btn.classList.toggle("is-muted", vsplitMuted);
      });
    }

    function applyVsplitMute() {
      if (!vsplitVideo) return;
      vsplitVideo.muted = Boolean(vsplitMuted);
      if (!vsplitMuted) {
        try {
          vsplitVideo.volume = 1;
        } catch (_) {
          /* ignore */
        }
        vsplitVideo.removeAttribute("muted");
      } else {
        vsplitVideo.setAttribute("muted", "");
      }
      paintVsplitMuteButtons();
    }

    function toggleVsplitMute() {
      vsplitMuted = !vsplitMuted;
      try {
        localStorage.setItem(VSPLIT_MUTE_KEY, vsplitMuted ? "1" : "0");
      } catch (_) {
        /* ignore */
      }
      applyVsplitMute();
      toast(vsplitMuted ? "已静音" : "已开声音");
    }

    async function toggleVsplitPlay() {
      if (!vsplitVideo || !vsplitSourceFile || vsplitMode !== "manual") return;
      if (vsplitPlaying || !vsplitVideo.paused) {
        pauseVsplitPreview();
        return;
      }
      applyVsplitMute();
      try {
        await vsplitVideo.play();
        vsplitPlaying = true;
        if (vsplitPlay) vsplitPlay.textContent = "暂停";
        if (vsplitFsPlay) vsplitFsPlay.textContent = "暂停";
      } catch (err) {
        // 部分浏览器禁止带声音自动播：回退静音再试一次
        if (!vsplitMuted) {
          vsplitMuted = true;
          applyVsplitMute();
          try {
            await vsplitVideo.play();
            vsplitPlaying = true;
            if (vsplitPlay) vsplitPlay.textContent = "暂停";
            if (vsplitFsPlay) vsplitFsPlay.textContent = "暂停";
            toast("浏览器限制有声播放，已改为静音；可再点「开声音」");
            setVsplitButtons();
            return;
          } catch (_) {
            /* fall through */
          }
        }
        vsplitPlaying = false;
        toast(err?.message || "无法播放");
      }
      setVsplitButtons();
    }

    function paintVsplitFsChrome() {
      if (!vsplitFsOpen) return;
      const now = vsplitScrubbing ? scrubValueToTime(vsplitScrub?.value) : vsplitVideoNow();
      const dur = vsplitVideoDuration();
      if (vsplitFsNow) {
        if (!vsplitSourceFile || !(dur > 0)) vsplitFsNow.textContent = "0:00 / 0:00";
        else vsplitFsNow.textContent = `${formatClock(now)} / ${formatClock(dur)}`;
      }
      if (vsplitFsStatus) {
        const done = completeVsplitMarks().length;
        const phase = vsplitDraftStart == null ? "等待打起点" : "正在打终点";
        vsplitFsStatus.textContent = `已完成 ${done} 段 · ${phase}`;
      }
      if (vsplitFsPlay) vsplitFsPlay.textContent = vsplitPlaying ? "暂停" : "播放";
      paintVsplitMuteButtons();
      if (vsplitFsMark) {
        vsplitFsMark.textContent = vsplitDraftStart == null ? "打起点" : "打终点";
      }
      if (vsplitFsUndo) {
        const canUndo =
          vsplitEditIdx < 0 &&
          Boolean(vsplitSourceFile) &&
          (vsplitDraftStart != null || vsplitMarks.length > 0);
        vsplitFsUndo.disabled = !canUndo || vsplitBusy;
        vsplitFsUndo.textContent = vsplitDraftStart != null ? "取消起点" : "取消上一段";
      }
    }

    function clearVsplitFsFeedbackTimers() {
      if (vsplitFsNoteTimer) window.clearTimeout(vsplitFsNoteTimer);
      if (vsplitFsPulseTimer) window.clearTimeout(vsplitFsPulseTimer);
      if (vsplitFsFlashTimer) window.clearTimeout(vsplitFsFlashTimer);
      if (vsplitFsStatusTimer) window.clearTimeout(vsplitFsStatusTimer);
      vsplitFsNoteTimer = 0;
      vsplitFsPulseTimer = 0;
      vsplitFsFlashTimer = 0;
      vsplitFsStatusTimer = 0;
    }

    function bumpVsplitFsStatus() {
      if (!vsplitFsStatus) return;
      vsplitFsStatus.classList.remove("is-bump");
      void vsplitFsStatus.offsetWidth;
      vsplitFsStatus.classList.add("is-bump");
      if (vsplitFsStatusTimer) window.clearTimeout(vsplitFsStatusTimer);
      vsplitFsStatusTimer = window.setTimeout(() => {
        vsplitFsStatus.classList.remove("is-bump");
        vsplitFsStatusTimer = 0;
      }, 280);
    }

    function pulseVsplitFsMarkBtn(kind) {
      if (!vsplitFsMark) return;
      vsplitFsMark.classList.remove("is-pulse", "is-pulse-start", "is-pulse-end");
      void vsplitFsMark.offsetWidth;
      vsplitFsMark.classList.add("is-pulse", kind === "end" ? "is-pulse-end" : "is-pulse-start");
      if (vsplitFsPulseTimer) window.clearTimeout(vsplitFsPulseTimer);
      vsplitFsPulseTimer = window.setTimeout(() => {
        vsplitFsMark.classList.remove("is-pulse", "is-pulse-start", "is-pulse-end");
        vsplitFsPulseTimer = 0;
      }, 200);
    }

    function flashVsplitFsFrame(kind) {
      if (!vsplitFsFlash || !vsplitFsHost) return;
      // 确保闪层在视频之上（部分 WebKit 会把后插入的 video 盖住绝对定位层）
      vsplitFsHost.appendChild(vsplitFsFlash);
      vsplitFsFlash.classList.remove("is-pop", "is-start", "is-end");
      void vsplitFsFlash.offsetWidth;
      vsplitFsFlash.classList.add("is-pop", kind === "end" ? "is-end" : "is-start");
      if (vsplitFsFlashTimer) window.clearTimeout(vsplitFsFlashTimer);
      vsplitFsFlashTimer = window.setTimeout(() => {
        vsplitFsFlash.classList.remove("is-pop", "is-start", "is-end");
        vsplitFsFlashTimer = 0;
      }, 450);
    }

    function showVsplitFsNote(text, kind) {
      if (!vsplitFsNote) return;
      vsplitFsNote.hidden = false;
      vsplitFsNote.textContent = text || "";
      vsplitFsNote.classList.remove("is-on", "is-start", "is-end");
      void vsplitFsNote.offsetWidth;
      vsplitFsNote.classList.add("is-on", kind === "end" ? "is-end" : "is-start");
      if (vsplitFsNoteTimer) window.clearTimeout(vsplitFsNoteTimer);
      vsplitFsNoteTimer = window.setTimeout(() => {
        vsplitFsNote.classList.remove("is-on");
        vsplitFsNoteTimer = 0;
      }, 900);
    }

    function buzzVsplitFs() {
      try {
        if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
          navigator.vibrate(12);
        }
      } catch (_) {}
    }

    /** 全屏打点节奏反馈；非全屏仍走 toast */
    function notifyVsplitMarkFeedback(message, kind) {
      if (!vsplitFsOpen) {
        toast(message);
        return;
      }
      paintVsplitFsChrome();
      pulseVsplitFsMarkBtn(kind);
      flashVsplitFsFrame(kind);
      bumpVsplitFsStatus();
      showVsplitFsNote(message, kind);
      buzzVsplitFs();
    }

    function enterVsplitFullscreen() {
      if (!vsplitVideo || !vsplitSourceFile || vsplitMode !== "manual" || !vsplitFs || !vsplitFsHost) return;
      if (vsplitFsOpen) return;
      if (vsplitEditIdx >= 0) exitVsplitEdit();
      vsplitFsOpen = true;
      vsplitFs.hidden = false;
      document.body.classList.add("vsplit-fs-open");
      if (vsplitVideo.parentElement !== vsplitFsHost) {
        vsplitFsHost.appendChild(vsplitVideo);
      }
      if (vsplitFsFlash) vsplitFsHost.appendChild(vsplitFsFlash);
      // 进度条 + 打点圆点一并带进全屏，避免无法拖进度
      if (vsplitScrubBlock && vsplitFsScrubSlot && vsplitScrubBlock.parentElement !== vsplitFsScrubSlot) {
        vsplitFsScrubSlot.appendChild(vsplitScrubBlock);
      }
      vsplitVideo.hidden = false;
      vsplitVideo.classList.add("is-fs");
      paintVsplitFsChrome();
      paintVsplitScrubMarks();
      syncVsplitScrubFromVideo();
      setVsplitButtons();
      // 进入后尽量继续播，便于边看边打点
      if (vsplitVideo.paused) {
        toggleVsplitPlay().catch(() => {});
      }
    }

    function exitVsplitFullscreen(opts = {}) {
      if (!vsplitFsOpen && !opts.force) {
        // 仍确保视频回到预览区
        if (opts.restoreVideo !== false && vsplitVideo && vsplitPreviewWrap && vsplitVideo.parentElement !== vsplitPreviewWrap) {
          vsplitPreviewWrap.appendChild(vsplitVideo);
        }
        if (vsplitScrubBlock && vsplitScrubHome && vsplitScrubBlock.parentElement !== vsplitScrubHome) {
          vsplitScrubHome.appendChild(vsplitScrubBlock);
        }
        return;
      }
      vsplitFsOpen = false;
      clearVsplitFsFeedbackTimers();
      if (vsplitFsNote) {
        vsplitFsNote.hidden = true;
        vsplitFsNote.classList.remove("is-on", "is-start", "is-end");
        vsplitFsNote.textContent = "";
      }
      vsplitFsMark?.classList.remove("is-pulse", "is-pulse-start", "is-pulse-end");
      vsplitFsStatus?.classList.remove("is-bump");
      vsplitFsFlash?.classList.remove("is-pop", "is-start", "is-end");
      if (vsplitFs) vsplitFs.hidden = true;
      document.body.classList.remove("vsplit-fs-open");
      if (vsplitVideo) {
        vsplitVideo.classList.remove("is-fs");
        if (opts.restoreVideo !== false && vsplitPreviewWrap && vsplitVideo.parentElement !== vsplitPreviewWrap) {
          vsplitPreviewWrap.appendChild(vsplitVideo);
        }
      }
      if (vsplitScrubBlock && vsplitScrubHome && vsplitScrubBlock.parentElement !== vsplitScrubHome) {
        vsplitScrubHome.appendChild(vsplitScrubBlock);
      }
      /* 全屏期间只刷了 scrub；退出后补一次完整列表 */
      try {
        paintVsplitMarks();
      } catch (err) {
        console.error(err);
        paintVsplitScrubMarks();
      }
      syncVsplitScrubFromVideo();
      paintVsplitNow();
      setVsplitButtons();
    }

    function scrubValueToTime(raw) {
      const dur = vsplitVideoDuration();
      if (!(dur > 0)) return 0;
      if (scrubGesture.fine) {
        const steps = Math.max(1, Number(vsplitScrub?.max) || VSPLIT_SCRUB_STEPS);
        const v = Math.max(0, Math.min(steps, Number(raw) || 0));
        const ratio = v / steps;
        const half = VSPLIT_FINE_WINDOW / 2;
        const t = scrubGesture.anchorTime - half + ratio * VSPLIT_FINE_WINDOW;
        return Math.max(0, Math.min(dur, t));
      }
      const steps = Math.max(1, Number(vsplitScrub?.max) || VSPLIT_SCRUB_STEPS);
      const v = Math.max(0, Math.min(steps, Number(raw) || 0));
      return (v / steps) * dur;
    }

    function timeToScrubValue(sec) {
      const dur = vsplitVideoDuration();
      if (!(dur > 0)) return 0;
      const steps = Math.max(1, Number(vsplitScrub?.max) || VSPLIT_SCRUB_STEPS);
      if (scrubGesture.fine) {
        const half = VSPLIT_FINE_WINDOW / 2;
        const lo = scrubGesture.anchorTime - half;
        const ratio = (Math.max(0, Math.min(sec, dur)) - lo) / VSPLIT_FINE_WINDOW;
        return Math.round(Math.max(0, Math.min(1, ratio)) * steps);
      }
      return Math.round((Math.max(0, Math.min(sec, dur)) / dur) * steps);
    }

    function syncVsplitScrubFromVideo() {
      if (!vsplitScrub || vsplitScrubbing) return;
      const dur = vsplitVideoDuration();
      const has = Boolean(vsplitSourceFile && dur > 0);
      vsplitScrub.disabled = !has || vsplitBusy || vsplitMode !== "manual";
      if (!has) {
        vsplitScrub.value = "0";
        return;
      }
      vsplitScrub.max = String(VSPLIT_SCRUB_STEPS);
      vsplitScrub.value = String(timeToScrubValue(Number(vsplitVideo?.currentTime) || 0));
    }

    function seekVsplitPreview(sec, opts = {}) {
      if (!vsplitVideo) return;
      const dur = vsplitVideoDuration();
      let t = Number(sec) || 0;
      if (dur > 0) t = Math.max(0, Math.min(t, Math.max(0, dur - 0.001)));
      if (!opts.keepPlaying) pauseVsplitPreview();
      try {
        vsplitVideo.currentTime = t;
      } catch (_) {}
      if (!opts.fromScrub) syncVsplitScrubFromVideo();
      paintVsplitNow();
    }

    function nudgeVsplitPreview(delta) {
      const now = vsplitScrubbing ? scrubValueToTime(vsplitScrub?.value) : vsplitVideoNow();
      seekVsplitPreview(now + delta);
      if (vsplitEditIdx >= 0) applyScrubToEditFocus({ silent: true });
    }

    function paintScrubHint() {
      if (!vsplitScrubHint) return;
      if (scrubGesture.fine) {
        const half = (VSPLIT_FINE_WINDOW / 2).toFixed(1);
        vsplitScrubHint.textContent = `微调中 · 窗口 ±${half}s（松手回粗调）`;
        return;
      }
      if (vsplitEditIdx >= 0) {
        vsplitScrubHint.textContent = "编辑中只显示本段绿/橙点 · 上方可点「退出编辑」· 上下滑微调";
        return;
      }
      vsplitScrubHint.textContent = "绿起点 / 橙终点同行 · 点圆点或芯片进入编辑 · 上下滑微调";
    }

    function onVsplitScrubInput() {
      if (!vsplitScrub || !vsplitSourceFile) return;
      vsplitScrubbing = true;
      pauseVsplitPreview();
      const t = scrubValueToTime(vsplitScrub.value);
      seekVsplitPreview(t, { fromScrub: true });
      if (vsplitManualNow) {
        const dur = vsplitVideoDuration();
        vsplitManualNow.textContent = `${formatClock(t)} / ${formatClock(dur)}`;
      }
      paintScrubHint();
    }

    function onVsplitScrubCommit() {
      onVsplitScrubInput();
      vsplitScrubbing = false;
      scrubGesture.active = false;
      scrubGesture.fine = false;
      scrubGesture.pointerId = null;
      syncVsplitScrubFromVideo();
      if (vsplitEditIdx >= 0) applyScrubToEditFocus({ silent: true });
      paintVsplitNow();
      paintScrubHint();
    }

    function beginScrubGesture(ev) {
      if (!vsplitSourceFile || vsplitMode !== "manual") return;
      const t = vsplitVideoNow();
      scrubGesture.active = true;
      scrubGesture.pointerId = ev.pointerId;
      scrubGesture.startX = ev.clientX;
      scrubGesture.startY = ev.clientY;
      scrubGesture.anchorTime = t;
      scrubGesture.fine = false;
      vsplitScrubbing = true;
      pauseVsplitPreview();
      paintScrubHint();
    }

    function moveScrubGesture(ev) {
      if (!scrubGesture.active) return;
      if (scrubGesture.pointerId != null && ev.pointerId !== scrubGesture.pointerId) return;
      const dy = scrubGesture.startY - ev.clientY;
      if (!scrubGesture.fine && Math.abs(dy) > 28) {
        scrubGesture.fine = true;
        scrubGesture.anchorTime = scrubValueToTime(vsplitScrub?.value) || vsplitVideoNow();
        if (vsplitScrub) vsplitScrub.value = String(Math.round(VSPLIT_SCRUB_STEPS / 2));
        toast("已进入微调");
      }
      if (!vsplitScrub) return;
      // 水平仍走 range 原生值；微调时 value→time 用局部窗口
      onVsplitScrubInput();
    }

    function clearVsplitMarks() {
      vsplitMarks = [];
      vsplitDraftStart = null;
      hideVsplitMarkPicker();
      exitVsplitEdit();
      paintVsplitMarks();
      setVsplitButtons();
    }

    function invalidateVsplitOutputsFromMarks() {
      if (vsplitClips.length) clearVsplitClips();
      setVsplitButtons();
    }

    function exitVsplitEdit() {
      vsplitEditIdx = -1;
      vsplitEditFocus = "start";
      hideVsplitMarkPicker();
      setVsplitButtons();
      paintVsplitMarks();
    }

    function enterVsplitEdit(idx) {
      if (idx < 0 || idx >= vsplitMarks.length) return;
      const mark = vsplitMarks[idx];
      if (!mark) return;
      /* 全屏编辑栏被隐藏；进编辑还会重绘下方长列表，手机易白屏 */
      if (vsplitFsOpen) {
        const jump = mark.start != null ? mark.start : mark.end;
        if (jump != null) seekVsplitPreview(jump, { keepPlaying: true });
        return;
      }
      pauseVsplitPreview();
      vsplitDraftStart = null;
      vsplitEditIdx = idx;
      hideVsplitMarkPicker();
      vsplitEditFocus = mark.start == null && mark.end != null ? "end" : "start";
      const jump = vsplitEditFocus === "end" ? mark.end : mark.start;
      if (jump != null) seekVsplitPreview(jump);
      paintVsplitDraft();
      paintVsplitMarks();
      setVsplitButtons();
      toast(`编辑 #${String(idx + 1).padStart(2, "0")}`);
    }

    function paintVsplitNow() {
      const now = vsplitScrubbing ? scrubValueToTime(vsplitScrub?.value) : vsplitVideoNow();
      const dur = vsplitVideoDuration();
      if (vsplitManualNow) {
        if (!vsplitSourceFile || !(dur > 0)) vsplitManualNow.textContent = "0:00 / 0:00";
        else vsplitManualNow.textContent = `${formatClock(now)} / ${formatClock(dur)}`;
      }
      if (vsplitManualCount) {
        const done = completeVsplitMarks().length;
        const total = vsplitMarks.length;
        vsplitManualCount.textContent = total ? `${done}/${total} 段` : "0 段";
      }
      if (!vsplitScrubbing) syncVsplitScrubFromVideo();
      // 播放 timeupdate 很频繁：不在这里重绘圆点/芯片，避免布局抖动导致打点按钮点不中
      paintScrubHint();
      paintVsplitFsChrome();
    }

    function paintVsplitDraft() {
      if (!vsplitManualDraft) return;
      if (vsplitEditIdx >= 0) {
        const mark = vsplitMarks[vsplitEditIdx];
        const s = mark?.start == null ? "—" : formatClock(mark.start);
        const e = mark?.end == null ? "—" : formatClock(mark.end);
        const focusLabel = vsplitEditFocus === "start" ? "起点" : "终点";
        vsplitManualDraft.hidden = false;
        vsplitManualDraft.textContent = `编辑中 ${s} → ${e} · 拖滑块松手即更新${focusLabel}`;
        return;
      }
      if (vsplitDraftStart == null) {
        vsplitManualDraft.hidden = true;
        vsplitManualDraft.textContent = "";
        return;
      }
      vsplitManualDraft.hidden = false;
      vsplitManualDraft.textContent = `已设起点 ${formatClock(vsplitDraftStart)} · 拖到终点后点「打终点」`;
    }

    function collectVsplitScrubEndpoints() {
      const list = [];
      // 编辑某段时只暴露该段端点，避免点到被隐藏的其它标记
      if (vsplitEditIdx >= 0) {
        const mark = vsplitMarks[vsplitEditIdx];
        if (!mark) return list;
        if (mark.start != null) {
          list.push({ t: Number(mark.start), kind: "start", idx: vsplitEditIdx, draft: false });
        }
        if (mark.end != null) {
          list.push({ t: Number(mark.end), kind: "end", idx: vsplitEditIdx, draft: false });
        }
        return list;
      }
      if (vsplitDraftStart != null) {
        list.push({ t: Number(vsplitDraftStart), kind: "start", idx: -1, draft: true });
      }
      vsplitMarks.forEach((mark, idx) => {
        if (mark.start != null) list.push({ t: Number(mark.start), kind: "start", idx, draft: false });
        if (mark.end != null) list.push({ t: Number(mark.end), kind: "end", idx, draft: false });
      });
      return list;
    }

    function hideVsplitMarkPicker() {
      const hadHighlight = !!vsplitPickerHighlight;
      const wasOpen = Boolean(vsplitMarkPicker && !vsplitMarkPicker.hidden);
      if (vsplitMarkPicker) {
        vsplitMarkPicker.hidden = true;
        vsplitMarkPicker.innerHTML = "";
      }
      vsplitPickerHighlight = null;
      if (hadHighlight || wasOpen) paintVsplitScrubMarks();
    }

    function showVsplitMarkPicker(near, clientX, preferred) {
      if (!vsplitMarkPicker || !vsplitScrubHit) return;
      const hitRect = vsplitScrubHit.getBoundingClientRect();
      // near 可能已按距离排序；先记下最近点，再按时间排列表
      const items = near.filter((ep) => !ep.draft && ep.idx >= 0);
      if (!items.length) {
        hideVsplitMarkPicker();
        return;
      }
      const prefer =
        (preferred &&
          items.find((ep) => ep.idx === preferred.idx && ep.kind === preferred.kind)) ||
        items[0];
      items.sort(
        (a, b) =>
          a.t - b.t ||
          a.idx - b.idx ||
          (a.kind === b.kind ? 0 : a.kind === "start" ? -1 : 1)
      );
      vsplitPickerHighlight = prefer ? { idx: prefer.idx, kind: prefer.kind } : null;
      vsplitMarkPicker.innerHTML = "";
      const title = document.createElement("p");
      title.className = "vsplit-mark-picker-title";
      title.textContent = `附近 ${items.length} 个标记（按时间）· 高亮为你点到的：`;
      vsplitMarkPicker.appendChild(title);
      items.forEach((ep) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.setAttribute("role", "option");
        const isNearest =
          prefer && ep.idx === prefer.idx && ep.kind === prefer.kind;
        if (isNearest) {
          btn.className = "is-nearest";
          btn.setAttribute("aria-selected", "true");
        } else {
          btn.setAttribute("aria-selected", "false");
        }
        const kindLabel = ep.kind === "end" ? "终点" : "起点";
        const badge = isNearest ? `<span class="vsplit-mark-picker-badge">当前</span>` : "";
        const mark = vsplitMarks[ep.idx];
        let rangeHtml = "";
        if (mark && isMarkComplete(mark)) {
          rangeHtml = ` <span class="mono vsplit-mark-picker-range">${formatClock(mark.start)}→${formatClock(mark.end)} · 共${formatVsplitSpanSec(mark.end - mark.start)}</span>`;
        } else if (mark) {
          const s = mark.start == null ? "—" : formatClock(mark.start);
          const e = mark.end == null ? "—" : formatClock(mark.end);
          rangeHtml = ` <span class="mono vsplit-mark-picker-range">${s}→${e}</span>`;
        }
        btn.innerHTML = `${badge}<strong>#${String(ep.idx + 1).padStart(2, "0")} ${kindLabel}</strong> <span class="mono">${formatClock(ep.t)}</span>${rangeHtml}`;
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          e.stopPropagation();
          hideVsplitMarkPicker();
          selectVsplitEditEndpoint(ep.idx, ep.kind);
        });
        vsplitMarkPicker.appendChild(btn);
      });
      const left = Math.max(8, Math.min(clientX - hitRect.left - 40, hitRect.width - 160));
      vsplitMarkPicker.style.left = `${left}px`;
      vsplitMarkPicker.style.top = `1.1rem`;
      vsplitMarkPicker.hidden = false;
      paintVsplitScrubMarks();
      const nearestBtn = vsplitMarkPicker.querySelector("button.is-nearest");
      if (nearestBtn?.scrollIntoView) {
        try {
          nearestBtn.scrollIntoView({ block: "nearest", behavior: "auto" });
        } catch (_) {
          /* ignore */
        }
      }
    }

    function resolveVsplitMarkTap(clientX) {
      if (!vsplitScrubMarks) return null;
      const rect = vsplitScrubMarks.getBoundingClientRect();
      if (!(rect.width > 0)) return null;
      const dur = vsplitVideoDuration();
      if (!(dur > 0)) return null;
      const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const t = pct * dur;
      const pxThresh = 32;
      const timeThresh = Math.max((pxThresh / rect.width) * dur, 0.12);
      const near = collectVsplitScrubEndpoints()
        .map((ep) => ({ ...ep, dist: Math.abs(ep.t - t) }))
        .filter((ep) => ep.dist <= timeThresh)
        .sort((a, b) => a.dist - b.dist || a.idx - b.idx);
      return { t, near, timeThresh };
    }

    let vsplitChipPaintSig = "";
    let vsplitChipScrollIdx = -2;

    function scrollVsplitActiveChipIntoView() {
      if (vsplitFsOpen || vsplitEditIdx < 0) return;
      if (vsplitEditIdx === vsplitChipScrollIdx) return;
      const active =
        vsplitMarkChips?.querySelector(".vsplit-mark-chip-wrap.is-active") ||
        vsplitMarkChips?.querySelector(".vsplit-mark-chip.is-active");
      if (active?.scrollIntoView) {
        try {
          active.scrollIntoView({ inline: "center", block: "nearest", behavior: "auto" });
        } catch (_) {
          /* ignore */
        }
      }
      vsplitChipScrollIdx = vsplitEditIdx;
    }

    function paintVsplitMarkChips() {
      if (!vsplitMarkChips) return;
      /* 全屏芯片已 CSS 隐藏，跳过重建减轻 DOM 抖动 */
      if (vsplitFsOpen) return;
      if (vsplitMode !== "manual" || !vsplitMarks.length) {
        vsplitMarkChips.hidden = true;
        vsplitMarkChips.innerHTML = "";
        vsplitChipPaintSig = "";
        vsplitChipScrollIdx = -2;
        return;
      }
      const sig = `${vsplitEditIdx}|${vsplitMarks
        .map((m) => `${m.start ?? "x"}:${m.end ?? "x"}`)
        .join(",")}`;
      if (sig === vsplitChipPaintSig && vsplitMarkChips.childElementCount === vsplitMarks.length) {
        $$("#vsplit-mark-chips .vsplit-mark-chip-wrap").forEach((wrap, idx) => {
          const on = vsplitEditIdx === idx;
          wrap.classList.toggle("is-active", on);
          wrap.querySelector(".vsplit-mark-chip")?.classList.toggle("is-active", on);
        });
        scrollVsplitActiveChipIntoView();
        if (vsplitEditIdx < 0) vsplitChipScrollIdx = -2;
        return;
      }
      vsplitChipPaintSig = sig;
      vsplitMarkChips.hidden = false;
      vsplitMarkChips.innerHTML = "";
      vsplitMarks.forEach((mark, idx) => {
        const wrap = document.createElement("div");
        wrap.className =
          "vsplit-mark-chip-wrap" +
          (vsplitEditIdx === idx ? " is-active" : "") +
          (isMarkComplete(mark) ? "" : " is-incomplete");
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className =
          "vsplit-mark-chip" +
          (vsplitEditIdx === idx ? " is-active" : "") +
          (isMarkComplete(mark) ? "" : " is-incomplete");
        const s = mark.start == null ? "—" : formatClock(mark.start);
        const e = mark.end == null ? "—" : formatClock(mark.end);
        chip.textContent = formatVsplitMarkRangeLabel(mark, idx);
        chip.title = isMarkComplete(mark)
          ? `编辑第 ${idx + 1} 段 · ${s}→${e} · 共${formatVsplitSpanSec(mark.end - mark.start)}`
          : `编辑第 ${idx + 1} 段 · ${s}→${e}`;
        chip.addEventListener("click", () => {
          // 全屏打点时芯片只作跳转预览，禁止进入编辑（编辑栏在全屏被隐藏）
          if (vsplitFsOpen) {
            const jump = mark.start != null ? mark.start : mark.end;
            if (jump != null) seekVsplitPreview(jump, { keepPlaying: true });
            return;
          }
          hideVsplitMarkPicker();
          if (vsplitEditIdx === idx) {
            const next = vsplitEditFocus === "start" && mark.end != null ? "end" : "start";
            if (next === "start" && mark.start == null && mark.end != null) selectVsplitEditEndpoint(idx, "end");
            else selectVsplitEditEndpoint(idx, next);
            return;
          }
          enterVsplitEdit(idx);
        });
        const del = document.createElement("button");
        del.type = "button";
        del.className = "vsplit-mark-chip-del";
        del.setAttribute("aria-label", `删除第 ${idx + 1} 段`);
        del.title = `删除第 ${idx + 1} 段`;
        del.textContent = "×";
        del.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          if (vsplitFsOpen || vsplitBusy) return;
          const label = formatVsplitMarkRangeLabel(mark, idx);
          if (!window.confirm(`删除第 ${idx + 1} 段？\n${label}`)) return;
          if (vsplitEditIdx === idx) exitVsplitEdit();
          else if (vsplitEditIdx > idx) vsplitEditIdx -= 1;
          vsplitMarks.splice(idx, 1);
          invalidateVsplitOutputsFromMarks();
          paintVsplitMarks();
          paintVsplitNow();
          toast("已删除片段");
        });
        wrap.append(chip, del);
        vsplitMarkChips.appendChild(wrap);
      });
      scrollVsplitActiveChipIntoView();
      if (vsplitEditIdx < 0) vsplitChipScrollIdx = -2;
    }

    function onVsplitMarksTrackPointer(e) {
      if (vsplitMode !== "manual" || vsplitBusy || vsplitFsOpen) return;
      if (e.target.closest(".vsplit-scrub-mark")) return;
      if (e.target.closest(".vsplit-mark-picker")) return;
      const resolved = resolveVsplitMarkTap(e.clientX);
      if (!resolved || !resolved.near.length) {
        hideVsplitMarkPicker();
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      const actionable = resolved.near.filter((ep) => !ep.draft && ep.idx >= 0);
      if (!actionable.length) return;
      if (actionable.length === 1) {
        hideVsplitMarkPicker();
        selectVsplitEditEndpoint(actionable[0].idx, actionable[0].kind);
        return;
      }
      showVsplitMarkPicker(actionable, e.clientX, actionable[0]);
    }

    function paintVsplitScrubMarks() {
      if (!vsplitScrubMarks) return;
      vsplitScrubMarks.innerHTML = "";
      if (vsplitMode !== "manual") {
        paintVsplitMarkChips();
        return;
      }
      const dur = vsplitVideoDuration();
      if (!(dur > 0)) {
        paintVsplitMarkChips();
        return;
      }
      const addDot = (t, kind, opts = {}) => {
        if (t == null || !Number.isFinite(t)) return;
        const { active = false, idx = -1, editable = false, picked = false } = opts;
        const dot = document.createElement("button");
        dot.type = "button";
        dot.className =
          `vsplit-scrub-mark is-${kind}` +
          (active ? " is-active" : "") +
          (picked ? " is-picked" : "") +
          (editable ? " is-editable" : "");
        const pct = Math.max(0, Math.min(100, (Number(t) / dur) * 100));
        dot.style.left = `${pct}%`;
        if (active || picked) dot.style.zIndex = "5";
        const label = kind === "start" ? "起点" : "终点";
        dot.setAttribute(
          "aria-label",
          idx >= 0
            ? `${picked ? "当前点到 · " : ""}选中第 ${idx + 1} 段${label}`
            : label
        );
        if (editable && idx >= 0) {
          dot.addEventListener("pointerdown", (e) => {
            e.stopPropagation();
          });
          dot.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            // 非编辑态：附近多个时弹出列表；编辑态只有本段点，直接切换端点
            if (vsplitEditIdx < 0) {
              const resolved = resolveVsplitMarkTap(e.clientX);
              const actionable = resolved
                ? resolved.near.filter((ep) => !ep.draft && ep.idx >= 0)
                : [];
              if (actionable.length > 1) {
                showVsplitMarkPicker(actionable, e.clientX, { idx, kind });
                return;
              }
            }
            selectVsplitEditEndpoint(idx, kind);
          });
        } else {
          dot.tabIndex = -1;
          dot.setAttribute("aria-hidden", "true");
        }
        vsplitScrubMarks.appendChild(dot);
      };

      /* 全屏圆点只作预览，禁止点选进编辑 */
      const canEditDots = !vsplitBusy && !vsplitFsOpen;
      if (vsplitEditIdx >= 0) {
        const mark = vsplitMarks[vsplitEditIdx];
        if (mark) {
          addDot(mark.start, "start", {
            active: vsplitEditFocus === "start",
            idx: vsplitEditIdx,
            editable: canEditDots,
          });
          addDot(mark.end, "end", {
            active: vsplitEditFocus === "end",
            idx: vsplitEditIdx,
            editable: canEditDots,
          });
        }
      } else {
        if (vsplitDraftStart != null) addDot(vsplitDraftStart, "start", { editable: false });
        vsplitMarks.forEach((mark, idx) => {
          const pickStart =
            vsplitPickerHighlight &&
            vsplitPickerHighlight.idx === idx &&
            vsplitPickerHighlight.kind === "start";
          const pickEnd =
            vsplitPickerHighlight &&
            vsplitPickerHighlight.idx === idx &&
            vsplitPickerHighlight.kind === "end";
          addDot(mark.start, "start", {
            idx,
            editable: canEditDots,
            active: !!pickStart,
            picked: !!pickStart,
          });
          addDot(mark.end, "end", {
            idx,
            editable: canEditDots,
            active: !!pickEnd,
            picked: !!pickEnd,
          });
        });
      }
      paintVsplitMarkChips();
    }

    function selectVsplitEditEndpoint(idx, kind) {
      if (idx < 0 || idx >= vsplitMarks.length) return;
      const focus = kind === "end" ? "end" : "start";
      const mark = vsplitMarks[idx];
      if (!mark) return;
      if (focus === "start" && mark.start == null) return;
      if (focus === "end" && mark.end == null) return;
      const jump = focus === "end" ? mark.end : mark.start;
      /* 全屏禁止进编辑：会 paintVsplitMarks 重绘下方列表导致白屏/闪退 */
      if (vsplitFsOpen) {
        if (jump != null) seekVsplitPreview(jump, { keepPlaying: true });
        return;
      }
      hideVsplitMarkPicker();
      if (vsplitEditIdx !== idx) {
        vsplitDraftStart = null;
        vsplitEditIdx = idx;
        pauseVsplitPreview();
      }
      vsplitEditFocus = focus;
      if (jump != null) seekVsplitPreview(jump, { keepPlaying: true });
      setVsplitButtons();
      paintVsplitDraft();
      paintVsplitMarks();
      paintVsplitScrubMarks();
    }

    function sortVsplitMarks() {
      vsplitMarks.sort((a, b) => {
        const as = a.start == null ? Number.POSITIVE_INFINITY : a.start;
        const bs = b.start == null ? Number.POSITIVE_INFINITY : b.start;
        const ae = a.end == null ? Number.POSITIVE_INFINITY : a.end;
        const be = b.end == null ? Number.POSITIVE_INFINITY : b.end;
        return as - bs || ae - be;
      });
    }

    function normalizeMarkPair(start, end, opts = {}) {
      const dur = vsplitVideoDuration();
      let s = start == null ? null : roundVsplitTime(start);
      let e = end == null ? null : roundVsplitTime(end);
      if (s != null && e != null) {
        if (e < s) {
          const tmp = s;
          s = e;
          e = tmp;
        }
        if (dur > 0) {
          s = Math.min(s, Math.max(0, dur - VSPLIT_MIN_SPAN));
          e = Math.min(Math.max(e, s + VSPLIT_MIN_SPAN), dur);
        }
        if (e - s < VSPLIT_MIN_SPAN - 0.001) {
          if (!opts.silent) toast(`每段至少 ${VSPLIT_MIN_SPAN} 秒`);
          return null;
        }
      } else if (dur > 0) {
        if (s != null) s = Math.max(0, Math.min(s, dur));
        if (e != null) e = Math.max(0, Math.min(e, dur));
      }
      return { start: s, end: e };
    }

    function updateVsplitMark(idx, nextStart, nextEnd, opts = {}) {
      const next = normalizeMarkPair(nextStart, nextEnd, opts);
      if (!next) return false;
      vsplitMarks[idx] = next;
      if (!opts.skipSort && isMarkComplete(next)) sortVsplitMarks();
      invalidateVsplitOutputsFromMarks();
      paintVsplitMarks();
      paintVsplitNow();
      return true;
    }

    function applyScrubToEditFocus(opts = {}) {
      if (vsplitEditIdx < 0) return;
      const mark = vsplitMarks[vsplitEditIdx];
      if (!mark) return;
      const t = roundVsplitTime(vsplitScrubbing ? scrubValueToTime(vsplitScrub?.value) : vsplitVideoNow());
      pauseVsplitPreview();
      if (vsplitEditFocus === "start") {
        if (mark.end != null && t >= mark.end) {
          if (!opts.silent) toast("起点需早于终点");
          return;
        }
        updateVsplitMark(vsplitEditIdx, t, mark.end, { skipSort: true });
        if (!opts.silent) toast(`起点 ${formatClock(t)}`);
      } else {
        if (mark.start != null && t <= mark.start) {
          if (!opts.silent) toast("终点需晚于起点");
          return;
        }
        updateVsplitMark(vsplitEditIdx, mark.start, t, { skipSort: true });
        if (!opts.silent) toast(`终点 ${formatClock(t)}`);
      }
      setVsplitButtons();
    }

    function deleteEditEndpoint(which) {
      if (vsplitEditIdx < 0) return;
      const mark = vsplitMarks[vsplitEditIdx];
      if (!mark) return;
      if (which === "start") mark.start = null;
      else mark.end = null;
      if (mark.start == null && mark.end == null) {
        vsplitMarks.splice(vsplitEditIdx, 1);
        exitVsplitEdit();
        invalidateVsplitOutputsFromMarks();
        paintVsplitMarks();
        paintVsplitNow();
        toast("片段已删除");
        return;
      }
      vsplitEditFocus = which === "start" ? "end" : "start";
      invalidateVsplitOutputsFromMarks();
      paintVsplitMarks();
      paintVsplitNow();
      setVsplitButtons();
      toast(which === "start" ? "已删起点" : "已删终点");
    }

    function paintVsplitMarks() {
      paintVsplitDraft();
      paintVsplitScrubMarks();
      // 大块分段列表已去掉：横向芯片 + 进度条圆点即可编辑/切换/删除
      if (vsplitMarksEl) {
        vsplitMarksEl.innerHTML = "";
        vsplitMarksEl.hidden = true;
      }
      setVsplitButtons();
    }

    function currentMarkTime() {
      return roundVsplitTime(vsplitScrubbing ? scrubValueToTime(vsplitScrub?.value) : vsplitVideoNow());
    }

    function flushVsplitMarkPaint() {
      try {
        if (vsplitFsOpen) {
          // 全屏时只刷进度条圆点，避免重绘下方长列表把手机内存打爆（白屏/闪退）
          paintVsplitDraft();
          paintVsplitScrubMarks();
          paintVsplitNow();
          setVsplitButtons();
          return;
        }
        paintVsplitMarks();
        paintVsplitNow();
        setVsplitButtons();
      } catch (err) {
        console.error(err);
        toast(err?.message || "标记刷新失败");
      }
    }

    let vsplitMarkTapCooldownUntil = 0;
    function tapVsplitMark() {
      try {
        if (!vsplitSourceFile || !vsplitVideo?.src) {
          toast("请先选择视频");
          return;
        }
        if (vsplitEditIdx >= 0) {
          toast("请先退出编辑再打点");
          return;
        }
        const nowMs = performance.now();
        const t = currentMarkTime();
        if (vsplitDraftStart == null) {
          vsplitDraftStart = t;
          vsplitMarkTapCooldownUntil = 0;
          paintVsplitDraft();
          paintVsplitScrubMarks();
          setVsplitButtons();
          paintVsplitNow();
          notifyVsplitMarkFeedback(`起点 ${formatClock(t)}`, "start");
          return;
        }
        // 同一段内防连点误触终点（新起点会清冷却）
        if (nowMs < vsplitMarkTapCooldownUntil) return;
        if (vsplitMarks.length >= VSPLIT_MAX_CLIPS) {
          toast(`最多 ${VSPLIT_MAX_CLIPS} 段`);
          return;
        }
        const start = vsplitDraftStart;
        const end = t;
        // 必须真实拉开最短时长；勿靠 normalize 自动拉长，否则播放中连点会狂造段
        if (Math.abs(end - start) < VSPLIT_MIN_SPAN - 0.001) {
          toast(`终点至少距起点 ${VSPLIT_MIN_SPAN} 秒，请继续播放或拖动`);
          return;
        }
        const next = normalizeMarkPair(start, end);
        if (!next || !isMarkComplete(next)) {
          toast(`每段至少 ${VSPLIT_MIN_SPAN} 秒`);
          return;
        }
        // 与最近一段几乎重合则忽略，防止同位置连点重复入库
        const last = vsplitMarks[vsplitMarks.length - 1];
        if (
          last &&
          Math.abs((last.start ?? -1) - next.start) < 0.08 &&
          Math.abs((last.end ?? -1) - next.end) < 0.08
        ) {
          toast("与上一段重复，已忽略");
          vsplitDraftStart = null;
          flushVsplitMarkPaint();
          return;
        }
        vsplitMarks.push(next);
        sortVsplitMarks();
        vsplitDraftStart = null;
        vsplitMarkTapCooldownUntil = nowMs + 300;
        invalidateVsplitOutputsFromMarks();
        flushVsplitMarkPaint();
        notifyVsplitMarkFeedback(`已添加 · ${(next.end - next.start).toFixed(1)}s`, "end");
      } catch (err) {
        console.error(err);
        try {
          toast(err?.message || "打点失败，请重试");
        } catch (_) {}
      }
    }

    let vsplitMarkTapArmed = false;
    function fireVsplitMarkTap(e) {
      if (vsplitMarkTap?.disabled && e?.currentTarget === vsplitMarkTap) return;
      if (vsplitFsMark?.disabled && e?.currentTarget === vsplitFsMark) return;
      if (e?.type === "pointerup") {
        if (e.button != null && e.button !== 0) return;
        // 仅触摸/手写笔走 pointerup；鼠标仍用 click，避免桌面双触发
        if (!e.pointerType || e.pointerType === "mouse") return;
        e.preventDefault();
        vsplitMarkTapArmed = true;
        window.setTimeout(() => {
          vsplitMarkTapArmed = false;
        }, 450);
        tapVsplitMark();
        return;
      }
      if (e?.type === "click" && vsplitMarkTapArmed) return;
      tapVsplitMark();
    }

    function undoVsplitDraft() {
      vsplitDraftStart = null;
      paintVsplitDraft();
      paintVsplitScrubMarks();
      paintVsplitNow();
      setVsplitButtons();
      notifyVsplitMarkFeedback("已取消起点", "start");
    }

    function undoVsplitLastMark() {
      if (vsplitEditIdx >= 0) {
        toast("请先退出编辑");
        return;
      }
      // 1) 有未完成起点草稿 → 只取消起点
      if (vsplitDraftStart != null) {
        undoVsplitDraft();
        return;
      }
      if (!vsplitMarks.length) {
        toast("没有可取消的标记");
        return;
      }
      const lastIdx = vsplitMarks.length - 1;
      const last = vsplitMarks[lastIdx];
      // 2) 上一段已有终点 → 只取消终点，起点回到「待打终点」
      if (last && last.end != null && last.start != null) {
        const start = last.start;
        vsplitMarks.splice(lastIdx, 1);
        vsplitDraftStart = start;
        invalidateVsplitOutputsFromMarks();
        paintVsplitMarks();
        paintVsplitNow();
        setVsplitButtons();
        notifyVsplitMarkFeedback(`已取消终点 · 起点保留 ${formatClock(start)}`, "start");
        return;
      }
      // 3) 仅剩起点（或不完整段）→ 取消该起点
      vsplitMarks.splice(lastIdx, 1);
      invalidateVsplitOutputsFromMarks();
      paintVsplitMarks();
      paintVsplitNow();
      setVsplitButtons();
      notifyVsplitMarkFeedback("已取消起点", "start");
    }

    function ensureVsplitClipsFromMarks() {
      if (vsplitClips.length) return;
      if (vsplitMode !== "manual") return;
      const marks = completeVsplitMarks();
      if (!marks.length) return;
      vsplitClips = marks.map((m) => ({
        start: m.start,
        span: Math.max(VSPLIT_MIN_SPAN, m.end - m.start),
        videoBlob: null,
        videoUrl: "",
        copied: false,
        gifBlob: null,
        gifUrl: "",
        gifNote: "",
        error: "",
        jobStatus: "",
        jobProgress: 0,
        jobText: "",
      }));
      renderVsplitList();
    }

    function computeVsplitRanges(duration) {
      const d = Number(duration) || 0;
      if (!(d > 0)) throw new Error("无法读取视频时长");
      const ranges = [];
      if (vsplitMode === "manual") {
        const marks = completeVsplitMarks();
        if (!marks.length) throw new Error("请先标记至少一段完整的起点和终点");
        const skipped = vsplitMarks.length - marks.length;
        if (skipped > 0) toast(`已跳过 ${skipped} 段未完成`);
        marks.forEach((m) => {
          const start = Math.max(0, Math.min(m.start, d));
          const end = Math.max(start + VSPLIT_MIN_SPAN, Math.min(m.end, d));
          const span = end - start;
          if (span < VSPLIT_MIN_SPAN - 0.001) throw new Error("存在过短片段，请调整后再切");
          ranges.push({ start, span });
        });
        return ranges;
      }
      if (vsplitMode === "count") {
        const n = Math.min(VSPLIT_MAX_CLIPS, Math.max(2, Math.round(Number(vsplitCount?.value) || 2)));
        const part = d / n;
        if (part < VSPLIT_MIN_SPAN) throw new Error("每段太短，请减少份数");
        for (let i = 0; i < n; i++) {
          const start = i * part;
          const end = i === n - 1 ? d : (i + 1) * part;
          ranges.push({ start, span: Math.max(VSPLIT_MIN_SPAN, end - start) });
        }
      } else {
        const h = Math.max(0, Number(vsplitH?.value) || 0);
        const m = Math.max(0, Number(vsplitM?.value) || 0);
        const s = Math.max(0, Number(vsplitS?.value) || 0);
        const part = h * 3600 + m * 60 + s;
        if (part < VSPLIT_MIN_SPAN) throw new Error("每段时长至少 0.5 秒");
        let start = 0;
        let i = 0;
        while (start < d - 0.04 && i < VSPLIT_MAX_CLIPS) {
          const span = Math.min(part, d - start);
          if (span < VSPLIT_MIN_SPAN && i > 0) break;
          ranges.push({ start, span: Math.max(span, Math.min(VSPLIT_MIN_SPAN, d - start)) });
          start += part;
          i += 1;
        }
        if (!ranges.length) throw new Error("无法按此时长切分");
      }
      return ranges;
    }

    function renderVsplitList() {
      if (!vsplitList) return;
      vsplitList.innerHTML = "";
      vsplitClips.forEach((c, idx) => {
        const row = document.createElement("div");
        row.className = "gif-frame vsplit-clip";
        row.dataset.vsplitClip = String(idx);
        const top = document.createElement("div");
        top.className = "vsplit-clip-top";
        const title = document.createElement("strong");
        title.textContent = `#${String(idx + 1).padStart(2, "0")}  ${formatClock(c.start)}–${formatClock(c.start + c.span)} · 共${formatVsplitSpanSec(c.span)}`;
        const meta = document.createElement("span");
        meta.className = "hint tight";
        const bits = [];
        if (c.videoBlob) bits.push(`视频 ${formatKb(c.videoBlob.size)}`);
        if (c.gifBlob) bits.push(`GIF ${formatKb(c.gifBlob.size)}`);
        if (c.gifNote) bits.push(c.gifNote);
        if (c.error) bits.push(c.error);
        meta.textContent = bits.join(" · ");
        const actions = document.createElement("div");
        actions.className = "btn-row";
        if (c.videoUrl) {
          const a = document.createElement("a");
          a.className = "secondary-btn";
          a.href = c.videoUrl;
          a.download = `clip-${String(idx + 1).padStart(2, "0")}.mp4`;
          a.textContent = "下载视频";
          actions.appendChild(a);
        }
        if (c.gifUrl) {
          const a = document.createElement("a");
          a.className = "secondary-btn";
          a.href = c.gifUrl;
          a.download = `clip-${String(idx + 1).padStart(2, "0")}.gif`;
          a.textContent = "下载 GIF";
          actions.appendChild(a);
        }
        top.append(title, meta, actions);
        row.appendChild(top);
        const progressBox = buildClipProgressDom();
        row.appendChild(progressBox);
        syncClipProgressDom(progressBox, c);
        if (c.gifUrl) {
          const img = document.createElement("img");
          img.className = "vsplit-clip-gif";
          img.alt = `片段 ${idx + 1} GIF 预览`;
          img.src = c.gifUrl;
          row.appendChild(img);
        }
        vsplitList.appendChild(row);
      });
      setVsplitButtons();
    }

    async function readClipBytes(ffmpeg, name) {
      try {
        const data = await ffmpeg.readFile(name);
        const raw = data instanceof Uint8Array ? data : new Uint8Array(data);
        if (!raw.byteLength) return null;
        const bytes = new Uint8Array(raw.byteLength);
        bytes.set(raw);
        return bytes;
      } catch (_) {
        return null;
      }
    }

    async function cutOneClip(ffmpeg, inName, start, span, outName) {
      const ss = String(start);
      const tt = String(span);
      const attempts = [
        ["copy", ["-ss", ss, "-t", tt, "-i", inName, "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", "-y", outName]],
        ["mpeg4", ["-ss", ss, "-t", tt, "-i", inName, "-an", "-c:v", "mpeg4", "-q:v", "7", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", outName]],
        ["x264", ["-ss", ss, "-t", tt, "-i", inName, "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", outName]],
      ];
      for (const [kind, args] of attempts) {
        try {
          await ffmpeg.deleteFile(outName);
        } catch (_) {}
        try {
          const code = await ffmpeg.exec(args);
          const bytes = code === 0 ? await readClipBytes(ffmpeg, outName) : null;
          if (bytes && bytes.byteLength > 32) return { bytes, copied: kind === "copy" };
        } catch (_) {}
      }
      return { bytes: null, copied: false };
    }

    async function zipBlobs(entries, zipName) {
      if (typeof JSZip !== "function") throw new Error("JSZip 未加载");
      const zip = new JSZip();
      entries.forEach((e) => zip.file(e.name, e.blob));
      const blob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(blob);
      return { blob, url, name: zipName };
    }

    function triggerLocalDownload(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
      }, 2000);
    }

    async function packDownloadVsplitVideos({ auto = false } = {}) {
      const videos = vsplitClips.map((c, i) => ({ c, i })).filter((x) => x.c.videoBlob);
      if (!videos.length) {
        if (!auto) toast("请先点「切成视频」");
        return false;
      }
      const packed = await zipBlobs(
        videos.map((x) => ({ name: `clip-${String(x.i + 1).padStart(2, "0")}.mp4`, blob: x.c.videoBlob })),
        "clips-video.zip"
      );
      revokeUrl(vsplitZipVideoUrl);
      vsplitZipVideoUrl = packed.url;
      triggerLocalDownload(packed.blob, packed.name);
      if (!auto) toast(`已打包 ${videos.length} 个视频`);
      setVsplitButtons();
      return true;
    }

    async function packDownloadVsplitGifs({ auto = false } = {}) {
      const gifs = vsplitClips.map((c, i) => ({ c, i })).filter((x) => x.c.gifBlob);
      if (!gifs.length) {
        if (!auto) toast("请先生成 GIF");
        return false;
      }
      const packed = await zipBlobs(
        gifs.map((x) => ({ name: `clip-${String(x.i + 1).padStart(2, "0")}.gif`, blob: x.c.gifBlob })),
        "clips-gif.zip"
      );
      revokeUrl(vsplitZipGifUrl);
      vsplitZipGifUrl = packed.url;
      triggerLocalDownload(packed.blob, packed.name);
      if (!auto) toast(`已打包 ${gifs.length} 个 GIF`);
      setVsplitButtons();
      return true;
    }

    function clearVsplit() {
      if (vsplitBusy) {
        abortVsplit = true;
        abortV2g = true;
        terminateFfmpegInstance({ revokeAssets: false });
        scheduleFfmpegPrewarm();
      }
      vsplitBusy = false;
      vsplitSourceFile = null;
      pauseVsplitPreview();
      exitVsplitFullscreen({ force: true });
      clearVsplitMarks();
      clearVsplitClips();
      if (vsplitObjectUrl) {
        URL.revokeObjectURL(vsplitObjectUrl);
        vsplitObjectUrl = "";
      }
      if (vsplitVideo) {
        vsplitVideo.pause?.();
        vsplitVideo.removeAttribute("src");
        vsplitVideo.load?.();
        vsplitVideo.hidden = true;
      }
      if (vsplitFile) vsplitFile.value = "";
      if (vsplitAbort) vsplitAbort.hidden = true;
      setVsplitProgress(false, 0, "");
      setError(vsplitError, "");
      if (vsplitMeta) vsplitMeta.textContent = VSPLIT_DEFAULT_META;
      paintVsplitNow();
      resetVsplitAbort();
      setVsplitButtons();
    }

    async function loadVsplitFile(file) {
      if (!file) return;
      clearVsplit();
      vsplitSourceFile = file;
      setError(vsplitError, "");
      if (vsplitMeta) vsplitMeta.textContent = formatLocalPickMeta(file, "正在读取时长…");
      toast("已选择，仅本机处理，不会上传");
      vsplitObjectUrl = URL.createObjectURL(file);
      attachLocalVideoPreview(vsplitVideo, vsplitObjectUrl);
      applyVsplitMute();
      await waitVideoMetadata(vsplitVideo);
      const duration = Number(vsplitVideo.duration) || 0;
      if (!(duration > 0) || !vsplitVideo.videoWidth) throw new Error("视频时长或尺寸无效");
      if (vsplitMeta) {
        vsplitMeta.textContent = formatLocalPickMeta(
          file,
          `${duration.toFixed(1)}s · ${vsplitVideo.videoWidth}×${vsplitVideo.videoHeight}`
        );
      }
      setVsplitButtons();
      paintVsplitNow();
      syncVsplitScrubFromVideo();
      if (vsplitMode === "manual") {
        vsplitVideo?.removeAttribute("controls");
        paintVsplitMarks();
      }
      toast("视频已就绪");
    }

    async function runVsplitCut() {
      if (!vsplitSourceFile || !vsplitVideo?.src || vsplitBusy) return;
      abortVsplit = false;
      vsplitBusy = true;
      setVsplitButtons();
      if (vsplitAbort) vsplitAbort.hidden = false;
      setError(vsplitError, "");
      clearVsplitClips();
      try {
        const duration = Number(vsplitVideo.duration) || 0;
        const ranges = computeVsplitRanges(duration);
        setVsplitProgress(true, 0.02, "本地读取视频（不上传）…", { sub: `共 ${ranges.length} 段`, busy: true });
        await prewarmFfmpegEngine().catch(() => {});
        const ffmpeg = await getFfmpegInstance();
        const ext = v2gSourceExt(vsplitSourceFile);
        const inName = `split-in.${ext}`;
        await ffmpeg.writeFile(
          inName,
          await fetchFileBytes(vsplitSourceFile, (ratio, text) => {
            setVsplitProgress(true, 0.02 + Math.min(0.1, (Number(ratio) || 0) * 0.1), text || "本地读取（不上传）…", {
              sub: `共 ${ranges.length} 段`,
              busy: true,
            });
          })
        );
        try {
          vsplitClips = ranges.map((r) => ({
            start: r.start,
            span: r.span,
            videoBlob: null,
            videoUrl: "",
            copied: false,
            gifBlob: null,
            gifUrl: "",
            gifNote: "",
            error: "",
            jobStatus: "pending",
            jobProgress: 0,
            jobText: "等待切分",
          }));
          renderVsplitList();
          for (let i = 0; i < ranges.length; i++) {
            if (abortVsplit) throw new Error("已取消");
            const r = ranges[i];
            const outName = `clip-${i}.mp4`;
            setVsplitClipJob(i, { status: "running", progress: 0.08, text: "切分视频…" });
            setVsplitProgress(true, (i + 0.05) / ranges.length, `切分视频 · ${i + 1}/${ranges.length}`, {
              sub: `${formatClock(r.start)}–${formatClock(r.start + r.span)} · 共${formatVsplitSpanSec(r.span)}`,
              busy: true,
            });
            const { bytes, copied } = await cutOneClip(ffmpeg, inName, r.start, r.span, outName);
            const blob = bytes ? new Blob([bytes], { type: "video/mp4" }) : null;
            const c = vsplitClips[i];
            c.videoBlob = blob;
            c.videoUrl = blob ? URL.createObjectURL(blob) : "";
            c.copied = copied;
            c.error = blob ? "" : "视频切片失败（仍可转 GIF）";
            setVsplitClipJob(i, {
              status: blob ? "done" : "error",
              progress: 1,
              text: blob ? "切分完成" : "切分失败",
            });
            try {
              await ffmpeg.deleteFile(outName);
            } catch (_) {}
            renderVsplitList();
          }
        } finally {
          try {
            await ffmpeg.deleteFile(inName);
          } catch (_) {}
        }
        const videos = vsplitClips.map((c, i) => ({ c, i })).filter((x) => x.c.videoBlob);
        const failN = vsplitClips.filter((c) => !c.videoBlob).length;
        setVsplitProgress(true, 1, `切分完成 · ${vsplitClips.length} 段`);
        setVsplitButtons();
        if (videos.length) {
          if (isAutoPackZipEnabled()) {
            await packDownloadVsplitVideos({ auto: true });
            toast(
              failN
                ? `已切 ${vsplitClips.length} 段（${failN} 段失败）· 已打包下载视频`
                : `已切成 ${vsplitClips.length} 段 · 已打包下载全部视频`
            );
          } else {
            toast(
              failN
                ? `已切 ${vsplitClips.length} 段（${failN} 段失败）· 可点「打包下载全部视频」`
                : `已切成 ${vsplitClips.length} 段 · 可点「打包下载全部视频」`
            );
          }
        } else {
          toast(failN ? `切分失败 ${failN} 段` : `已切成 ${vsplitClips.length} 段`);
        }
        clearVsplitClipJobs();
        renderVsplitList();
      } catch (err) {
        if (String(err && err.message) !== "已取消") setError(vsplitError, err.message || String(err));
        else toast("已取消切分");
        if (String(err && err.message) === "已取消") setVsplitProgress(false, 0, "");
        clearVsplitClipJobs();
        renderVsplitList();
      } finally {
        vsplitBusy = false;
        resetVsplitAbort();
        if (vsplitAbort) vsplitAbort.hidden = true;
        setVsplitButtons();
      }
    }

    async function runVsplitGifs(mode) {
      if (!vsplitSourceFile || vsplitBusy) return;
      if (vsplitMode === "manual") ensureVsplitClipsFromMarks();
      if (!vsplitClips.length) return;
      abortVsplit = false;
      vsplitBusy = true;
      setVsplitButtons();
      if (vsplitAbort) vsplitAbort.hidden = false;
      setError(vsplitError, "");
      revokeVsplitGifOutputs();
      const fps = Math.min(15, Math.max(2, Number(vsplitFps?.value) || 15));
      const maxW = Math.min(720, Math.max(64, Number(vsplitWidth?.value) || 480));
      const quality = Math.min(30, Math.max(1, Number(vsplitQuality?.value) || 5));
      const srcW = vsplitVideo?.videoWidth || 0;
      const srcH = vsplitVideo?.videoHeight || 0;
      const isAborted = () => abortVsplit;
      try {
        await prewarmFfmpegEngine().catch(() => {});
        vsplitClips.forEach((c, idx) => {
          setVsplitClipJob(idx, { status: "pending", progress: 0, text: "等待转 GIF" });
        });
        renderVsplitList();
        for (let i = 0; i < vsplitClips.length; i++) {
          if (abortVsplit) throw new Error("已取消");
          const c = vsplitClips[i];
          if (c.gifUrl) {
            try {
              URL.revokeObjectURL(c.gifUrl);
            } catch (_) {}
          }
          c.gifBlob = null;
          c.gifUrl = "";
          c.gifNote = "";
          c.error = "";
          const label = mode === "blackbox" ? "黑盒 GIF" : "高清 GIF";
          setVsplitClipJob(i, { status: "running", progress: 0.02, text: `${label}…` });
          setVsplitProgress(true, i / vsplitClips.length, `${label} · ${i + 1}/${vsplitClips.length}`, {
            sub: `${formatClock(c.start)}–${formatClock(c.start + c.span)} · 共${formatVsplitSpanSec(c.span)}`,
            busy: true,
          });
          try {
            const encoded =
              mode === "blackbox"
                ? await encodeBlackboxClip({
                    file: vsplitSourceFile,
                    startSec: c.start,
                    span: c.span,
                    srcW,
                    srcH,
                    isAborted,
                    onProgress: (local, text) => {
                      const p = Math.min(0.98, Number(local) || 0);
                      setVsplitClipJob(i, { status: "running", progress: p, text: text || `${label}…` });
                      setVsplitProgress(true, (i + p) / vsplitClips.length, `${label} · ${i + 1}/${vsplitClips.length}`, {
                        sub: text,
                        busy: true,
                      });
                    },
                  })
                : await encodeV2gGifFfmpeg({
                    file: vsplitSourceFile,
                    fps,
                    maxW,
                    quality,
                    startSec: c.start,
                    span: c.span,
                    srcW,
                    srcH,
                    skipWatermark: true,
                    skipBright: true,
                    brightness: 0,
                    isAborted,
                    stageLabel: `#${i + 1}`,
                    onProgress: (local, text) => {
                      const p = Math.min(0.98, Number(local) || 0);
                      setVsplitClipJob(i, { status: "running", progress: p, text: text || `${label}…` });
                      setVsplitProgress(true, (i + p) / vsplitClips.length, `${label} · ${i + 1}/${vsplitClips.length}`, {
                        sub: text,
                        busy: true,
                      });
                    },
                  });
            if (!encoded?.blob) throw new Error("未产出 GIF");
            c.gifBlob = encoded.blob;
            c.gifUrl = URL.createObjectURL(encoded.blob);
            c.gifNote = encoded.framesCapped ? `已抽稀 ${encoded.frameCount} 帧` : `${encoded.outW}×${encoded.outH}`;
            setVsplitClipJob(i, { status: "done", progress: 1, text: "GIF 完成" });
          } catch (err) {
            if (String(err && err.message) === "已取消") throw err;
            c.error = err.message || String(err);
            setVsplitClipJob(i, { status: "error", progress: 1, text: "GIF 失败" });
          }
          renderVsplitList();
        }
        const gifs = vsplitClips.map((c, i) => ({ c, i })).filter((x) => x.c.gifBlob);
        const failN = vsplitClips.filter((c) => c.error).length;
        setVsplitProgress(true, 1, `GIF 完成 · 成功 ${gifs.length}/${vsplitClips.length}`);
        setVsplitButtons();
        if (gifs.length) {
          if (isAutoPackZipEnabled()) {
            await packDownloadVsplitGifs({ auto: true });
            toast(failN ? `完成，${failN} 段失败 · 已打包下载 GIF` : `已生成 ${gifs.length} 个 GIF · 已打包下载`);
          } else {
            toast(
              failN
                ? `完成，${failN} 段失败 · 可点「打包下载全部 GIF」`
                : `已生成 ${gifs.length} 个 GIF · 可点「打包下载全部 GIF」`
            );
          }
        } else {
          toast(failN ? `完成，${failN} 段失败` : "未生成 GIF");
        }
        clearVsplitClipJobs();
        renderVsplitList();
      } catch (err) {
        if (String(err && err.message) !== "已取消") setError(vsplitError, err.message || String(err));
        else toast("已取消");
        clearVsplitClipJobs();
        renderVsplitList();
      } finally {
        vsplitBusy = false;
        resetVsplitAbort();
        if (vsplitAbort) vsplitAbort.hidden = true;
        setVsplitButtons();
      }
    }

    async function runVsplitMerge() {
      const blobs = vsplitClips.map((c) => c.gifBlob).filter(Boolean);
      if (blobs.length < 2 || vsplitBusy) return;
      vsplitBusy = true;
      setVsplitButtons();
      setError(vsplitError, "");
      try {
        const blob = await mergeGifBlobs(blobs, (ratio, text) =>
          setVsplitProgress(true, ratio, "合并 GIF", { sub: text, busy: ratio < 1 })
        );
        if (vsplitMergedUrl) URL.revokeObjectURL(vsplitMergedUrl);
        vsplitMergedUrl = URL.createObjectURL(blob);
        if (vsplitMergedPreview) {
          vsplitMergedPreview.src = vsplitMergedUrl;
          vsplitMergedPreview.hidden = false;
        }
        if (vsplitMergedDl) {
          vsplitMergedDl.href = vsplitMergedUrl;
          vsplitMergedDl.hidden = false;
        }
        setVsplitProgress(true, 1, `合并完成 · ${formatKb(blob.size)}`);
        toast("已合并为一条 GIF");
      } catch (err) {
        setError(vsplitError, err.message || String(err));
      } finally {
        vsplitBusy = false;
        resetVsplitAbort();
        setVsplitButtons();
      }
    }

    $("#vsplit-mode-n")?.addEventListener("click", () => {
      vsplitMode = "count";
      vsplitDraftStart = null;
      exitVsplitEdit();
      syncVsplitMode();
    });
    $("#vsplit-mode-t")?.addEventListener("click", () => {
      vsplitMode = "duration";
      vsplitDraftStart = null;
      exitVsplitEdit();
      syncVsplitMode();
    });
    $("#vsplit-mode-m")?.addEventListener("click", () => {
      vsplitMode = "manual";
      syncVsplitMode();
    });
    vsplitPlay?.addEventListener("click", () => {
      toggleVsplitPlay().catch(() => {});
    });
    vsplitMute?.addEventListener("click", () => toggleVsplitMute());
    vsplitFsOpenBtn?.addEventListener("click", () => enterVsplitFullscreen());
    vsplitFsClose?.addEventListener("click", () => exitVsplitFullscreen());
    vsplitFsPlay?.addEventListener("click", () => {
      toggleVsplitPlay().catch(() => {});
    });
    vsplitFsMute?.addEventListener("click", () => toggleVsplitMute());
    vsplitFsMark?.addEventListener("pointerup", (e) => fireVsplitMarkTap(e));
    vsplitFsMark?.addEventListener("click", (e) => fireVsplitMarkTap(e));
    vsplitFsUndo?.addEventListener("click", () => undoVsplitLastMark());
    document.addEventListener("keydown", (e) => {
      if (!vsplitFsOpen) return;
      if (e.key === "Escape") {
        e.preventDefault();
        exitVsplitFullscreen();
      }
    });
    vsplitMarkTap?.addEventListener("pointerup", (e) => fireVsplitMarkTap(e));
    vsplitMarkTap?.addEventListener("click", (e) => fireVsplitMarkTap(e));
    vsplitMarkUndo?.addEventListener("click", () => undoVsplitLastMark());
    vsplitMarkClear?.addEventListener("click", () => {
      clearVsplitMarks();
      invalidateVsplitOutputsFromMarks();
      paintVsplitNow();
      toast("已清空标记");
    });
    vsplitEditApply?.addEventListener("click", () => applyScrubToEditFocus());
    vsplitEditDelStart?.addEventListener("click", () => deleteEditEndpoint("start"));
    vsplitEditDelEnd?.addEventListener("click", () => deleteEditEndpoint("end"));
    vsplitEditDone?.addEventListener("click", () => {
      exitVsplitEdit();
      paintVsplitNow();
    });
    vsplitQuickCut?.addEventListener("click", () => runVsplitCut().catch((err) => setError(vsplitError, err.message || String(err))));
    vsplitQuickBb?.addEventListener("click", () => {
      runVsplitGifs("blackbox").catch((err) => setError(vsplitError, err.message || String(err)));
    });
    vsplitQuickHq?.addEventListener("click", () => {
      runVsplitGifs("hq").catch((err) => setError(vsplitError, err.message || String(err)));
    });
    vsplitZipVideo?.addEventListener("click", () => {
      packDownloadVsplitVideos().catch((err) => setError(vsplitError, err.message || String(err)));
    });
    vsplitZipGif?.addEventListener("click", () => {
      packDownloadVsplitGifs().catch((err) => setError(vsplitError, err.message || String(err)));
    });
    $("#vsplit-edit-focus")?.addEventListener("click", (e) => {
      const btn = e.target?.closest?.("[data-edit-focus]");
      if (!btn || vsplitEditIdx < 0) return;
      e.preventDefault();
      const nextFocus = btn.dataset.editFocus === "end" ? "end" : "start";
      if (nextFocus === vsplitEditFocus) return;
      vsplitEditFocus = nextFocus;
      const mark = vsplitMarks[vsplitEditIdx];
      if (mark) {
        const jump = vsplitEditFocus === "end" ? mark.end : mark.start;
        // 切换端点时仅预览跳转，不自动写入；保留播放状态
        if (jump != null) seekVsplitPreview(jump, { keepPlaying: true });
      }
      setVsplitButtons();
      paintVsplitDraft();
      paintVsplitScrubMarks();
    });
    vsplitNudgeM1?.addEventListener("click", () => nudgeVsplitPreview(-1));
    vsplitNudgeM01?.addEventListener("click", () => nudgeVsplitPreview(-0.1));
    vsplitNudgeP01?.addEventListener("click", () => nudgeVsplitPreview(0.1));
    vsplitNudgeP1?.addEventListener("click", () => nudgeVsplitPreview(1));
    vsplitScrub?.addEventListener("pointerdown", (ev) => beginScrubGesture(ev));
    vsplitScrub?.addEventListener("pointermove", (ev) => moveScrubGesture(ev));
    vsplitScrub?.addEventListener("input", () => onVsplitScrubInput());
    vsplitScrub?.addEventListener("change", () => onVsplitScrubCommit());
    vsplitScrub?.addEventListener("pointerup", () => onVsplitScrubCommit());
    vsplitScrub?.addEventListener("pointercancel", () => onVsplitScrubCommit());
    vsplitScrub?.addEventListener("touchend", () => onVsplitScrubCommit(), { passive: true });
    vsplitScrubMarks?.addEventListener("pointerdown", (ev) => onVsplitMarksTrackPointer(ev));
    document.addEventListener("pointerdown", (ev) => {
      if (!vsplitMarkPicker || vsplitMarkPicker.hidden) return;
      if (ev.target.closest("#vsplit-mark-picker, #vsplit-scrub-marks, #vsplit-mark-chips")) return;
      hideVsplitMarkPicker();
    });
    const onVsplitTime = () => {
      if (vsplitMode !== "manual" || vsplitScrubbing) return;
      vsplitPlaying = Boolean(vsplitVideo && !vsplitVideo.paused);
      paintVsplitNow();
      if (vsplitPlay) vsplitPlay.textContent = vsplitPlaying ? "暂停" : "播放";
      if (vsplitFsPlay) vsplitFsPlay.textContent = vsplitPlaying ? "暂停" : "播放";
    };
    vsplitVideo?.addEventListener("timeupdate", onVsplitTime);
    vsplitVideo?.addEventListener("seeked", onVsplitTime);
    vsplitVideo?.addEventListener("play", () => {
      vsplitPlaying = true;
      if (vsplitPlay) vsplitPlay.textContent = "暂停";
      if (vsplitFsPlay) vsplitFsPlay.textContent = "暂停";
    });
    vsplitVideo?.addEventListener("pause", () => {
      vsplitPlaying = false;
      if (vsplitPlay) vsplitPlay.textContent = "播放";
      if (vsplitFsPlay) vsplitFsPlay.textContent = "播放";
    });
    vsplitVideo?.addEventListener("ended", () => {
      vsplitPlaying = false;
      if (vsplitPlay) vsplitPlay.textContent = "播放";
      if (vsplitFsPlay) vsplitFsPlay.textContent = "播放";
    });
    vsplitVideo?.addEventListener("loadedmetadata", () => {
      syncVsplitScrubFromVideo();
      paintVsplitNow();
    });
    vsplitFile?.addEventListener("change", (e) => {
      loadVsplitFile(e.target.files?.[0]).catch((err) => {
        clearVsplit();
        setError(vsplitError, err.message || String(err));
      });
    });
    $("#vsplit-clear")?.addEventListener("click", clearVsplit);
    window.DevToolsTemp?.registerCleanup(clearVsplit);
    window.DevToolsVsplit = {
      getMode: () => vsplitMode,
      getMarks: () => vsplitMarks.map((m) => ({ ...m })),
      getDraftStart: () => vsplitDraftStart,
      getEditIdx: () => vsplitEditIdx,
      isFullscreen: () => vsplitFsOpen,
      enterFullscreen: () => enterVsplitFullscreen(),
      exitFullscreen: () => exitVsplitFullscreen(),
      undoLast: () => undoVsplitLastMark(),
      enterEdit: (idx) => enterVsplitEdit(idx),
      setMarks: (marks) => {
        vsplitMarks = (Array.isArray(marks) ? marks : [])
          .map((m) => normalizeMarkPair(m.start, m.end, { silent: true }))
          .filter(Boolean)
          .filter(isMarkComplete)
          .slice(0, VSPLIT_MAX_CLIPS);
        sortVsplitMarks();
        vsplitDraftStart = null;
        exitVsplitEdit();
        invalidateVsplitOutputsFromMarks();
        paintVsplitMarks();
        paintVsplitNow();
      },
      computeRanges: (duration) => computeVsplitRanges(duration),
    };
    vsplitCut?.addEventListener("click", () => runVsplitCut().catch((err) => setError(vsplitError, err.message || String(err))));
    vsplitGifHq?.addEventListener("click", () => runVsplitGifs("hq").catch((err) => setError(vsplitError, err.message || String(err))));
    vsplitGifBb?.addEventListener("click", () =>
      runVsplitGifs("blackbox").catch((err) => setError(vsplitError, err.message || String(err)))
    );
    vsplitMerge?.addEventListener("click", () => runVsplitMerge().catch((err) => setError(vsplitError, err.message || String(err))));
    vsplitAbort?.addEventListener("click", () => {
      abortVsplit = true;
      abortV2g = true;
      terminateFfmpegInstance({ revokeAssets: false });
      scheduleFfmpegPrewarm();
    });
    syncVsplitMode();
    applyVsplitMute();
    setVsplitButtons();

    // ---- One-click blackbox split planner (vbb) ----
    const vbbFile = $("#vbb-file");
    const vbbVideo = $("#vbb-video");
    const vbbMeta = $("#vbb-meta");
    const vbbError = $("#vbb-error");
    const vbbAnalyze = $("#vbb-analyze");
    const vbbRun = $("#vbb-run");
    const vbbMerge = $("#vbb-merge");
    const vbbAbort = $("#vbb-abort");
    const vbbZip = $("#vbb-zip");
    const vbbMergedDl = $("#vbb-merged-dl");
    const vbbMergedPreview = $("#vbb-merged-preview");
    const vbbProgress = $("#vbb-progress");
    const vbbProgressFill = $("#vbb-progress-fill");
    const vbbProgressText = $("#vbb-progress-text");
    const vbbProgressSub = $("#vbb-progress-sub");
    const vbbProgressPct = $("#vbb-progress-pct");
    const vbbPlan = $("#vbb-plan");
    const vbbPlanSummary = $("#vbb-plan-summary");
    const vbbPlanCompare = $("#vbb-plan-compare");
    const vbbPlanList = $("#vbb-plan-list");
    const vbbList = $("#vbb-list");
    const vbbResultBlock = $("#vbb-result-block");
    const vbbCustomRow = $("#vbb-custom-row");
    const vbbTargetSpan = $("#vbb-target-span");
    const vbbTargetRange = $("#vbb-target-range");
    const vbbEqualize = $("#vbb-equalize");
    const VBB_SAMPLE_SPAN = 2.5;
    const VBB_SAFETY = 0.85;
    /** 清晰优先：按接近 6MB 规划段长（略留余量，避免实测偶发超限） */
    const VBB_CLARITY_FILL = 0.97;
    const VBB_MAX_CLIPS = 50;
    const VBB_MIN_SPAN = 0.5;
    const VBB_CLARITY_MAX_SPAN = 20;
    const VBB_DURATION_MAX_SPAN = 30;
    /** 与 V2G_BLACKBOX_LONG_SPAN_SEC 对齐：超过该秒数（或 15FPS 触顶帧）黑盒从 12FPS 起试 */
    const VBB_BLACKBOX_LONG_SPAN_SEC = 20;
    /** Soft keep≈0.72 对应约 1–2 轮 --lossy 轻压 */
    const VBB_SOFT_COMPRESS_KEEP = 0.72;
    const VBB_DEFAULT_META =
      "支持 MP4 / WebM / MOV。选择后仅本机读取，不会上传。分析阶段抽 2–3 秒样片估体积；关闭页面会释放本次视频和 GIF。";

    let vbbSourceFile = null;
    let vbbObjectUrl = "";
    let vbbBusy = false;
    let abortVbb = false;
    let vbbMode = "clarity";
    let vbbAnalysis = null;
    let vbbClips = [];
    let vbbZipUrl = "";
    let vbbMergedUrl = "";
    /** 仅预览当前选中片段，避免手机同时解码多个大 GIF 白屏 */
    let vbbPreviewIdx = -1;

    function isLikelyMobileBrowser() {
      return (
        window.matchMedia("(max-width: 900px)").matches ||
        /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "")
      );
    }

    function setVbbProgress(visible, ratio, text, opts = {}) {
      if (!vbbProgress) return;
      vbbProgress.hidden = !visible;
      if (!visible) {
        if (vbbProgressFill) {
          vbbProgressFill.style.width = "0%";
          vbbProgressFill.classList.remove("is-active", "is-busy");
        }
        if (vbbProgressPct) vbbProgressPct.hidden = true;
        if (vbbProgressSub) vbbProgressSub.hidden = true;
        return;
      }
      const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
      const busy = Boolean(opts.busy) || (pct > 0 && pct < 100);
      if (vbbProgressFill) {
        vbbProgressFill.style.width = `${Math.max(pct, busy && pct < 8 ? 8 : pct)}%`;
        vbbProgressFill.classList.toggle("is-active", busy);
        vbbProgressFill.classList.toggle("is-busy", Boolean(opts.busy));
      }
      if (vbbProgressPct) {
        vbbProgressPct.textContent = `${pct}%`;
        vbbProgressPct.hidden = false;
      }
      if (vbbProgressText) vbbProgressText.textContent = text || `${pct}%`;
      if (vbbProgressSub) {
        vbbProgressSub.textContent = opts.sub || "";
        vbbProgressSub.hidden = !opts.sub;
      }
    }

    function setVbbClipJob(idx, patch = {}) {
      const c = vbbClips[idx];
      if (!c) return;
      if (patch.status != null) c.jobStatus = patch.status;
      if (patch.progress != null) c.jobProgress = Math.max(0, Math.min(1, Number(patch.progress) || 0));
      if (patch.text != null) c.jobText = String(patch.text || "");
      const row = vbbList?.querySelector(`[data-vbb-clip="${idx}"]`);
      if (row) syncClipProgressDom(row.querySelector(".vsplit-clip-progress"), c);
    }

    function clearVbbClipJobs() {
      vbbClips.forEach((c) => {
        c.jobStatus = "";
        c.jobProgress = 0;
        c.jobText = "";
      });
    }

    function resetVbbAbort() {
      abortVbb = false;
      abortV2g = false;
    }

    function formatVbbClock(sec) {
      const s = Math.max(0, Number(sec) || 0);
      const m = Math.floor(s / 60);
      const r = Math.floor(s % 60);
      const tenths = Math.round((s - Math.floor(s)) * 10);
      const tail = tenths ? `.${tenths}` : "";
      return `${m}:${String(r).padStart(2, "0")}${tail}`;
    }

    function clearVbbResults() {
      vbbClips.forEach((c) => {
        try {
          if (c.gifUrl) URL.revokeObjectURL(c.gifUrl);
        } catch (_) {}
      });
      vbbClips = [];
      vbbPreviewIdx = -1;
      if (vbbList) vbbList.innerHTML = "";
      if (vbbZipUrl) {
        try {
          URL.revokeObjectURL(vbbZipUrl);
        } catch (_) {}
      }
      vbbZipUrl = "";
      if (vbbMergedUrl) {
        try {
          URL.revokeObjectURL(vbbMergedUrl);
        } catch (_) {}
      }
      vbbMergedUrl = "";
      if (vbbZip) vbbZip.disabled = true;
      if (vbbMergedDl) {
        vbbMergedDl.hidden = true;
        vbbMergedDl.removeAttribute("href");
      }
      if (vbbMergedPreview) {
        vbbMergedPreview.hidden = true;
        vbbMergedPreview.removeAttribute("src");
      }
      if (vbbResultBlock) vbbResultBlock.hidden = true;
    }

    function setVbbButtons() {
      const hasVideo = Boolean(vbbVideo?.src && vbbSourceFile);
      const hasPlan = Boolean(vbbAnalysis?.active?.ranges?.length);
      const gifCount = vbbClips.filter((c) => c.gifBlob).length;
      if (vbbAnalyze) vbbAnalyze.disabled = !hasVideo || vbbBusy;
      if (vbbRun) vbbRun.disabled = !hasPlan || vbbBusy;
      if (vbbMerge) vbbMerge.disabled = gifCount < 2 || vbbBusy;
      if (vbbZip) vbbZip.disabled = gifCount < 1 || vbbBusy;
    }

    async function packDownloadVbbGifs({ auto = false } = {}) {
      const gifs = vbbClips.map((c, i) => ({ c, i })).filter((x) => x.c.gifBlob);
      if (!gifs.length) {
        if (!auto) toast("请先生成 GIF");
        return false;
      }
      const packed = await zipBlobs(
        gifs.map((x) => ({ name: `bb-${String(x.i + 1).padStart(2, "0")}.gif`, blob: x.c.gifBlob })),
        "blackbox-clips.zip"
      );
      if (vbbZipUrl) {
        try {
          URL.revokeObjectURL(vbbZipUrl);
        } catch (_) {}
      }
      vbbZipUrl = packed.url;
      triggerLocalDownload(packed.blob, packed.name);
      if (!auto) toast(`已打包 ${gifs.length} 个 GIF`);
      setVbbButtons();
      return true;
    }

    function syncVbbModeUi() {
      $("#vbb-mode-clarity")?.classList.toggle("is-active", vbbMode === "clarity");
      $("#vbb-mode-sharp")?.classList.toggle("is-active", vbbMode === "sharp");
      $("#vbb-mode-duration")?.classList.toggle("is-active", vbbMode === "duration");
      $("#vbb-mode-custom")?.classList.toggle("is-active", vbbMode === "custom");
      if (vbbCustomRow) vbbCustomRow.hidden = vbbMode !== "custom";
    }

    function isVbbEqualize() {
      return Boolean(vbbEqualize?.checked);
    }

    function buildVbbRanges(duration, targetSpan, equalize) {
      const d = Number(duration) || 0;
      const part = Math.max(VBB_MIN_SPAN, Number(targetSpan) || VBB_MIN_SPAN);
      if (!(d > 0)) throw new Error("无法读取视频时长");
      const needed = Math.max(1, Math.ceil(d / part - 1e-9));
      const useEqual = Boolean(equalize) || needed > VBB_MAX_CLIPS;
      // 均分，或触顶段数上限：每段等长
      if (useEqual) {
        const n = Math.min(VBB_MAX_CLIPS, needed);
        const slice = d / n;
        const ranges = [];
        for (let i = 0; i < n; i++) {
          const start = i * slice;
          const end = i === n - 1 ? d : (i + 1) * slice;
          ranges.push({ start, span: Math.max(VBB_MIN_SPAN, end - start) });
        }
        return ranges;
      }
      const ranges = [];
      let start = 0;
      while (start < d - 1e-9) {
        const remaining = d - start;
        // 剩余不足一段、或切完会留下过短尾巴：并入末段
        if (remaining <= part + 1e-6 || remaining - part < VBB_MIN_SPAN) {
          ranges.push({ start, span: remaining });
          break;
        }
        ranges.push({ start, span: part });
        start += part;
      }
      if (!ranges.length) ranges.push({ start: 0, span: d });
      return ranges;
    }

    function typicalVbbSpan(ranges, fallback) {
      if (ranges?.length) return ranges[0].span;
      return Math.max(VBB_MIN_SPAN, Number(fallback) || VBB_MIN_SPAN);
    }

    function formatVbbRangesSpanTip(ranges) {
      if (!ranges?.length) return "";
      const first = ranges[0].span;
      const last = ranges[ranges.length - 1].span;
      if (ranges.length === 1 || Math.abs(last - first) < 0.08) {
        return `每段 ${first.toFixed(1)}s`;
      }
      return `前${ranges.length - 1}段 ${first.toFixed(1)}s · 末段 ${last.toFixed(1)}s`;
    }

    function vbbWidthLadder(srcW) {
      const hard = Math.min(V2G_BLACKBOX_WIDTH_CAP, srcW > 0 ? srcW : V2G_BLACKBOX_WIDTH_CAP);
      const start = Math.min(V2G_BLACKBOX_BASE_W, hard);
      const list = [];
      for (let w = start; w <= hard + 0.1; w += V2G_BLACKBOX_WIDTH_STEP) {
        list.push(Math.min(hard, Math.round(w)));
      }
      if (!list.length) list.push(Math.max(64, hard || V2G_BLACKBOX_BASE_W));
      const last = list[list.length - 1];
      if (last < hard) list.push(hard);
      return [...new Set(list)];
    }

    function vbbSampleBaseWidth(srcW) {
      return Math.min(V2G_BLACKBOX_BASE_W, srcW > 0 ? srcW : V2G_BLACKBOX_BASE_W);
    }

    function estimateVbbBytesAtWidth(bps15, span, width, srcW) {
      const s = Math.max(VBB_MIN_SPAN, Number(span) || VBB_MIN_SPAN);
      const baseW = vbbSampleBaseWidth(srcW);
      const w = Math.max(64, Number(width) || baseW);
      const scale = (w / Math.max(1, baseW)) ** 2;
      return Math.round(bps15 * s * scale);
    }

    function estimateVbbBytesAtFpsWidth(bps15, span, fps, width, srcW) {
      const f = Math.max(1, Number(fps) || 15);
      return Math.round(estimateVbbBytesAtWidth(bps15, span, width, srcW) * (f / 15));
    }

    function resolveBlackboxEstimateFpsList(span) {
      const s = Math.max(VBB_MIN_SPAN, Number(span) || VBB_MIN_SPAN);
      const framesAt15 = Math.floor(s * 15) + 1;
      // 与 resolveBlackboxFpsList 一致：超长秒数或 15FPS 会触顶帧上限时从 12 起
      if (s > VBB_BLACKBOX_LONG_SPAN_SEC || framesAt15 > MAX_V2G_FRAMES) return [12, 10];
      return [15, 12, 10];
    }

    /**
     * 对齐 encodeBlackboxClip 加宽：仅当当前体积 < 5MB 才尝试加宽，
     * 并取仍 ≤6MB 的最大宽（加宽重编码不带压缩）。
     */
    function resolveVbbWidenWidthForEst(bps15, span, fps, srcW, startBytes, startW) {
      const budget = V2G_BLACKBOX_MAX_BYTES;
      const widenGate = V2G_BLACKBOX_WIDEN_BYTES;
      let best = Math.max(64, Number(startW) || vbbSampleBaseWidth(srcW));
      let bestBytes = Math.max(1, Number(startBytes) || estimateVbbBytesAtFpsWidth(bps15, span, fps, best, srcW));
      if (bestBytes >= widenGate) return { maxW: best, bytes: bestBytes };
      for (const w of vbbWidthLadder(srcW)) {
        if (w <= best) continue;
        const est = estimateVbbBytesAtFpsWidth(bps15, span, fps, w, srcW);
        if (est <= budget) {
          best = w;
          bestBytes = est;
        } else break;
      }
      return { maxW: best, bytes: bestBytes };
    }

    /**
     * 对齐 encodeBlackboxClip：
     * - 长段/触顶帧从 12FPS 起
     * - 每档先 420 宽；超限轻柔压缩；体积 <5MB 再加宽到 ≤6MB 最大宽
     */
    function estimateVbbBlackboxPlan(bps15, span, srcW) {
      const s = Math.max(VBB_MIN_SPAN, Number(span) || VBB_MIN_SPAN);
      const maxBytes = V2G_BLACKBOX_MAX_BYTES;
      const baseW = vbbSampleBaseWidth(srcW);
      const fpsList = resolveBlackboxEstimateFpsList(s);

      for (let i = 0; i < fpsList.length; i++) {
        const fps = fpsList[i];
        const isLast = i >= fpsList.length - 1;
        const atBase = estimateVbbBytesAtFpsWidth(bps15, s, fps, baseW, srcW);

        if (atBase <= maxBytes) {
          const wide = resolveVbbWidenWidthForEst(bps15, s, fps, srcW, atBase, baseW);
          return { bytes: wide.bytes, fps, compressRounds: 0, maxW: wide.maxW };
        }

        const soft = Math.round(atBase * VBB_SOFT_COMPRESS_KEEP);
        if (soft <= maxBytes) {
          // 实装：轻压进预算后若 <5MB，会用不带压缩的更宽重编码加宽（compressRounds 归零）
          if (soft < V2G_BLACKBOX_WIDEN_BYTES) {
            const wide = resolveVbbWidenWidthForEst(bps15, s, fps, srcW, soft, baseW);
            if (wide.maxW > baseW) {
              return { bytes: wide.bytes, fps, compressRounds: 0, maxW: wide.maxW };
            }
          }
          return {
            bytes: Math.min(maxBytes, Math.max(soft, Math.round(maxBytes * 0.88))),
            fps,
            compressRounds: 1,
            maxW: baseW,
          };
        }

        if (isLast) {
          return { bytes: maxBytes, fps, compressRounds: 2, maxW: baseW };
        }
      }

      return { bytes: maxBytes, fps: 10, compressRounds: 2, maxW: baseW };
    }

    function estimateVbbBytesBlackbox(bps15, span, srcW) {
      return estimateVbbBlackboxPlan(bps15, span, srcW).bytes;
    }

    function estimateVbbFps(bps15, span, mode, width, srcW) {
      if (mode !== "duration" && mode !== "blackbox") return 15;
      return estimateVbbBlackboxPlan(bps15, span, srcW).fps;
    }

    function estimateVbbCompressRounds(bps15, span, mode, srcW) {
      if (mode !== "duration" && mode !== "blackbox") return 0;
      return estimateVbbBlackboxPlan(bps15, span, srcW).compressRounds;
    }

    function estimateVbbBytes(bps15, span, mode, width, srcW) {
      const s = Math.max(VBB_MIN_SPAN, Number(span) || VBB_MIN_SPAN);
      if (mode === "duration" || mode === "blackbox") {
        return estimateVbbBytesBlackbox(bps15, s, srcW);
      }
      return estimateVbbBytesAtWidth(bps15, s, width || vbbSampleBaseWidth(srcW), srcW);
    }

    function formatVbbFpsTip(fps) {
      return `${fps || 15}FPS`;
    }

    function resolveVbbWidthForSpan(bps15, span, srcW) {
      const budget = V2G_BLACKBOX_MAX_BYTES * VBB_SAFETY;
      let best = vbbSampleBaseWidth(srcW);
      for (const w of vbbWidthLadder(srcW)) {
        if (estimateVbbBytesAtWidth(bps15, span, w, srcW) <= budget) best = w;
        else break;
      }
      return best;
    }

    function resolveVbbSpanForWidth(bps15, width, srcW) {
      const baseW = vbbSampleBaseWidth(srcW);
      const scale = (Math.max(baseW, Number(width) || baseW) / Math.max(1, baseW)) ** 2;
      const span = (V2G_BLACKBOX_MAX_BYTES * VBB_SAFETY) / Math.max(1, bps15 * scale);
      return Math.max(VBB_MIN_SPAN, Math.min(VBB_CLARITY_MAX_SPAN, span));
    }

    function describeVbbExpect(mode, targetSpan, clarityMax, durationMax, maxW, estFps, compressRounds) {
      const fps = estFps || 15;
      const compressTip = compressRounds > 0 ? `，预计压${compressRounds}轮` : "";
      if (mode === "clarity") return "不压缩 · ≤6MB";
      if (mode === "sharp") return "缩短加宽 · 不压缩 · ≤6MB";
      if (mode === "duration") return `优先保 15FPS（超限先轻压再 12→10）${compressTip} · ≤6MB`;
      if (targetSpan < clarityMax - 0.05) {
        return `短于清晰档 · 目标宽${maxW || "?"} · 不压缩`;
      }
      if (targetSpan <= clarityMax + 0.05) return "接近清晰优先 · 尽量不压缩";
      if (targetSpan <= durationMax + 0.05) {
        return `超过清晰安全时长 · 走黑盒（预计 ${fps}FPS${compressTip}）`;
      }
      return `目标偏长 · 走黑盒（预计 ${fps}FPS${compressTip}），个别段可能接近 6MB 上限`;
    }

    function annotateVbbPlan(plan, bps15, srcW) {
      const avgSpan = plan.avgSpan;
      const typicalSpan = plan.typicalSpan || typicalVbbSpan(plan.ranges, avgSpan);
      const maxW = plan.maxW || vbbSampleBaseWidth(srcW);
      const capped = plan.count >= VBB_MAX_CLIPS && typicalSpan > plan.maxSpan * 1.02;
      let note = plan.note;
      let encode = plan.encode;
      let unsafe = false;
      if (capped) {
        unsafe = true;
        note = `${note} · 已达 ${VBB_MAX_CLIPS} 段上限，单段约 ${typicalSpan.toFixed(1)}s`;
      }
      const estMode = encode === "blackbox" ? "duration" : "clarity";
      let estBytes;
      let estFps;
      let estCompressRounds = 0;
      let outMaxW = maxW;
      if (estMode === "duration") {
        const bb = estimateVbbBlackboxPlan(bps15, typicalSpan, srcW);
        estBytes = bb.bytes;
        estFps = bb.fps;
        estCompressRounds = bb.compressRounds;
        outMaxW = bb.maxW || maxW;
      } else {
        estBytes = estimateVbbBytes(bps15, typicalSpan, estMode, maxW, srcW);
        estFps = 15;
      }
      if ((encode === "clarity" || encode === "sharp") && estBytes > V2G_BLACKBOX_MAX_BYTES) {
        unsafe = true;
        note = `${note} · 预估超 6MB`;
      }
      if ((encode === "clarity" || encode === "sharp") && typicalSpan > plan.maxSpan * 1.05) {
        unsafe = true;
        note = `${note} · 实际单段长于安全时长`;
      }
      return {
        ...plan,
        typicalSpan,
        note,
        encode,
        unsafe,
        maxW: outMaxW,
        estBytes,
        estFps,
        estCompressRounds,
      };
    }

    function makeVbbPlanVariant(key, label, duration, maxSpan, bps15, note, opts = {}) {
      const hardCap = key === "duration" ? VBB_DURATION_MAX_SPAN : VBB_CLARITY_MAX_SPAN;
      const safeMax = Math.max(VBB_MIN_SPAN, Math.min(maxSpan, hardCap));
      const ranges = buildVbbRanges(duration, safeMax, isVbbEqualize());
      const avgSpan = ranges.reduce((a, r) => a + r.span, 0) / Math.max(1, ranges.length);
      const typicalSpan = typicalVbbSpan(ranges, safeMax);
      const encode = opts.encode || (key === "duration" ? "blackbox" : key === "sharp" ? "sharp" : "clarity");
      const srcW = opts.srcW || 0;
      const maxW = opts.maxW || vbbSampleBaseWidth(srcW);
      return annotateVbbPlan(
        {
          key,
          label,
          maxSpan: safeMax,
          ranges,
          count: ranges.length,
          avgSpan,
          typicalSpan,
          estBytes: estimateVbbBytes(bps15, typicalSpan, encode === "blackbox" ? "duration" : "clarity", maxW, srcW),
          note,
          encode,
          maxW,
        },
        bps15,
        srcW
      );
    }

    function makeSharpPlan(duration, bps15, srcW, clarityMax) {
      const ladder = vbbWidthLadder(srcW);
      const topW = ladder[ladder.length - 1] || vbbSampleBaseWidth(srcW);
      let targetSpan = resolveVbbSpanForWidth(bps15, topW, srcW);
      targetSpan = Math.max(VBB_MIN_SPAN, Math.min(clarityMax, targetSpan));
      const wideAtClarity = resolveVbbWidthForSpan(bps15, clarityMax, srcW);
      if (wideAtClarity > vbbSampleBaseWidth(srcW) + 1) {
        const spanForTop = resolveVbbSpanForWidth(bps15, topW, srcW);
        if (spanForTop >= clarityMax - 0.05) {
          targetSpan = clarityMax;
        } else {
          targetSpan = Math.max(VBB_MIN_SPAN, Math.min(clarityMax, spanForTop));
        }
      }
      const maxW = resolveVbbWidthForSpan(bps15, targetSpan, srcW);
      return makeVbbPlanVariant(
        "sharp",
        "锐度优先",
        duration,
        targetSpan,
        bps15,
        `宽${maxW} · 缩短加宽 · 不压缩 · ≤6MB`,
        { encode: "sharp", maxW, srcW }
      );
    }

    function rebuildVbbDerivedPlans() {
      if (!vbbAnalysis) return;
      const { duration, bps15, srcW, clarityMax, durationMax } = vbbAnalysis;
      if (!(duration > 0) || !(bps15 > 0) || !(clarityMax > 0)) return;
      vbbAnalysis.clarity = makeVbbPlanVariant(
        "clarity",
        "清晰优先",
        duration,
        clarityMax,
        bps15,
        "宽420 · 贴紧6MB · 不压缩",
        { encode: "clarity", maxW: V2G_BLACKBOX_BASE_W, srcW }
      );
      vbbAnalysis.sharp = makeSharpPlan(duration, bps15, srcW, clarityMax);
      vbbAnalysis.durationPlan = makeVbbPlanVariant(
        "duration",
        "时长优先",
        duration,
        durationMax,
        bps15,
        "可降帧/压缩 · 段更长、段数更少",
        { encode: "blackbox", maxW: V2G_BLACKBOX_BASE_W, srcW }
      );
    }

    function resolveActiveVbbPlan() {
      if (!vbbAnalysis) return null;
      const { duration, bps15, clarity, sharp, durationPlan, srcW } = vbbAnalysis;
      if (vbbMode === "clarity") return { ...clarity, encode: clarity.encode || "clarity", maxW: clarity.maxW || vbbSampleBaseWidth(srcW) };
      if (vbbMode === "sharp") return { ...sharp, encode: "sharp", maxW: sharp.maxW || vbbSampleBaseWidth(srcW) };
      if (vbbMode === "duration") return { ...durationPlan, encode: "blackbox", maxW: durationPlan.maxW || vbbSampleBaseWidth(srcW) };
      let target = Number(vbbTargetSpan?.value);
      if (!(target > 0)) target = clarity.maxSpan;
      target = Math.max(VBB_MIN_SPAN, Math.min(VBB_DURATION_MAX_SPAN, target));
      const ranges = buildVbbRanges(duration, target, isVbbEqualize());
      const avgSpan = ranges.reduce((a, r) => a + r.span, 0) / Math.max(1, ranges.length);
      const typicalSpan = typicalVbbSpan(ranges, target);
      if (typicalSpan > clarity.maxSpan + 0.05) {
        const estPlan = estimateVbbBlackboxPlan(bps15, typicalSpan, srcW);
        return annotateVbbPlan(
          {
            key: "custom",
            label: "自定义时长",
            maxSpan: target,
            ranges,
            count: ranges.length,
            avgSpan,
            typicalSpan,
            estBytes: estPlan.bytes,
            estFps: estPlan.fps,
            estCompressRounds: estPlan.compressRounds,
            note: describeVbbExpect(
              "custom",
              typicalSpan,
              clarity.maxSpan,
              durationPlan.maxSpan,
              V2G_BLACKBOX_BASE_W,
              estPlan.fps,
              estPlan.compressRounds
            ),
            encode: "blackbox",
            maxW: V2G_BLACKBOX_BASE_W,
          },
          bps15,
          srcW
        );
      }
      const maxW = resolveVbbWidthForSpan(bps15, typicalSpan, srcW);
      const encode = maxW > vbbSampleBaseWidth(srcW) + 1 ? "sharp" : "clarity";
      const estFps = 15;
      return annotateVbbPlan(
        {
          key: "custom",
          label: "自定义时长",
          maxSpan: target,
          ranges,
          count: ranges.length,
          avgSpan,
          typicalSpan,
          estBytes: estimateVbbBytes(bps15, typicalSpan, "clarity", maxW, srcW),
          estFps,
          estCompressRounds: 0,
          note: describeVbbExpect("custom", typicalSpan, clarity.maxSpan, durationPlan.maxSpan, maxW, estFps, 0),
          encode,
          maxW,
        },
        bps15,
        srcW
      );
    }

    function paintVbbPlan() {
      if (!vbbAnalysis) {
        if (vbbPlan) vbbPlan.hidden = true;
        setVbbButtons();
        return;
      }
      const active = resolveActiveVbbPlan();
      vbbAnalysis.active = active;
      if (vbbPlan) vbbPlan.hidden = false;
      syncVbbModeUi();

      if (vbbPlanCompare) {
        vbbPlanCompare.innerHTML = "";
        [vbbAnalysis.clarity, vbbAnalysis.sharp, vbbAnalysis.durationPlan].forEach((p) => {
          if (!p) return;
          const card = document.createElement("button");
          card.type = "button";
          card.className = `vbb-plan-card${vbbMode === p.key ? " is-selected" : ""}`;
          const title = document.createElement("strong");
          title.textContent = p.label;
          const line = document.createElement("span");
          line.className = "hint tight";
          const widthTip = p.maxW ? ` · 宽${p.maxW}` : "";
          const fpsTip = ` · ${formatVbbFpsTip(p.estFps || 15, p.estCompressRounds || 0)}`;
          line.textContent = `${p.count} 段 · ${formatVbbRangesSpanTip(p.ranges)}${widthTip}${fpsTip} · 预估 ${formatKb(p.estBytes)}/段`;
          const note = document.createElement("span");
          note.className = "hint tight";
          note.textContent = p.note;
          card.append(title, line, note);
          card.addEventListener("click", () => {
            vbbMode = p.key;
            paintVbbPlan();
          });
          vbbPlanCompare.appendChild(card);
        });
      }

      if (vbbPlanSummary && active) {
        const widthTip = active.maxW ? ` · 目标宽 ${active.maxW}` : "";
        const fpsTip = ` · ${formatVbbFpsTip(active.estFps || 15, active.estCompressRounds || 0)}`;
        const warn = active.unsafe ? " ⚠ 可能超预算，执行时超限会降宽或改走黑盒。" : "";
        vbbPlanSummary.textContent = `将生成 ${active.count} 个切片 · ${formatVbbRangesSpanTip(active.ranges)}${widthTip}${fpsTip} · 预估约 ${formatKb(active.estBytes)}/段 · ${active.note}（体积为估算；各段预览在生成后显示）${warn}`;
      }

      if (vbbPlanList) vbbPlanList.innerHTML = "";

      if (vbbTargetSpan && vbbTargetRange && vbbAnalysis) {
        const min = VBB_MIN_SPAN;
        const max = Math.max(
          vbbAnalysis.clarity.maxSpan,
          vbbAnalysis.sharp?.maxSpan || 0,
          vbbAnalysis.durationPlan.maxSpan
        );
        vbbTargetRange.min = String(Number(min.toFixed(1)));
        vbbTargetRange.max = String(Number(max.toFixed(1)));
        let cur = Number(vbbTargetSpan.value);
        if (!(cur >= min && cur <= max)) {
          cur = Math.min(max, Math.max(min, vbbAnalysis.clarity.maxSpan));
          vbbTargetSpan.value = String(Number(cur.toFixed(1)));
        }
        vbbTargetRange.value = String(Number(cur.toFixed(1)));
        vbbTargetSpan.min = vbbTargetRange.min;
        vbbTargetSpan.max = vbbTargetRange.max;
      }

      setVbbButtons();
    }

    function renderVbbResults() {
      if (!vbbList) return;
      vbbList.innerHTML = "";
      if (vbbResultBlock) vbbResultBlock.hidden = vbbClips.length === 0;
      vbbClips.forEach((c, idx) => {
        const row = document.createElement("div");
        row.className = "gif-frame vsplit-clip";
        row.dataset.vbbClip = String(idx);
        const top = document.createElement("div");
        top.className = "vsplit-clip-top";
        const title = document.createElement("strong");
        title.textContent = `#${String(idx + 1).padStart(2, "0")}  ${formatVbbClock(c.start)}–${formatVbbClock(c.start + c.span)} · 共${formatVsplitSpanSec(c.span)}`;
        const meta = document.createElement("span");
        meta.className = "hint tight";
        const bits = [];
        if (c.gifBlob) bits.push(formatKb(c.gifBlob.size));
        if (c.gifNote) bits.push(c.gifNote);
        if (c.error) bits.push(c.error);
        meta.textContent = bits.join(" · ");
        const actions = document.createElement("div");
        actions.className = "btn-row";
        if (c.gifBlob) {
          if (!c.gifUrl) c.gifUrl = URL.createObjectURL(c.gifBlob);
          const a = document.createElement("a");
          a.className = "secondary-btn";
          a.href = c.gifUrl;
          a.download = `bb-${String(idx + 1).padStart(2, "0")}.gif`;
          a.textContent = "下载 GIF";
          actions.appendChild(a);
          const previewBtn = document.createElement("button");
          previewBtn.type = "button";
          previewBtn.className = "ghost-btn";
          previewBtn.textContent = vbbPreviewIdx === idx ? "收起预览" : "预览";
          previewBtn.addEventListener("click", () => {
            vbbPreviewIdx = vbbPreviewIdx === idx ? -1 : idx;
            renderVbbResults();
          });
          actions.appendChild(previewBtn);
        }
        top.append(title, meta, actions);
        row.appendChild(top);
        const progressBox = buildClipProgressDom();
        row.appendChild(progressBox);
        syncClipProgressDom(progressBox, c);
        // 默认不挂载全部 <img>，避免手机同时解码多个大 GIF 导致白屏/杀进程
        if (c.gifBlob && vbbPreviewIdx === idx) {
          if (!c.gifUrl) c.gifUrl = URL.createObjectURL(c.gifBlob);
          const img = document.createElement("img");
          img.className = "vsplit-clip-gif";
          img.alt = `黑盒片段 ${idx + 1}`;
          img.loading = "lazy";
          img.decoding = "async";
          img.src = c.gifUrl;
          row.appendChild(img);
        }
        vbbList.appendChild(row);
      });
      setVbbButtons();
    }

    function clearVbb() {
      if (vbbBusy) {
        abortVbb = true;
        abortV2g = true;
        terminateFfmpegInstance({ revokeAssets: false });
        scheduleFfmpegPrewarm();
      }
      vbbBusy = false;
      vbbSourceFile = null;
      vbbAnalysis = null;
      clearVbbResults();
      if (vbbObjectUrl) {
        URL.revokeObjectURL(vbbObjectUrl);
        vbbObjectUrl = "";
      }
      if (vbbVideo) {
        vbbVideo.pause?.();
        vbbVideo.removeAttribute("src");
        vbbVideo.load?.();
        vbbVideo.hidden = true;
      }
      if (vbbFile) vbbFile.value = "";
      if (vbbAbort) vbbAbort.hidden = true;
      if (vbbPlan) vbbPlan.hidden = true;
      if (vbbPlanCompare) vbbPlanCompare.innerHTML = "";
      if (vbbPlanList) vbbPlanList.innerHTML = "";
      setVbbProgress(false, 0, "");
      setError(vbbError, "");
      if (vbbMeta) vbbMeta.textContent = VBB_DEFAULT_META;
      resetVbbAbort();
      setVbbButtons();
    }

    async function loadVbbFile(file) {
      if (!file) return;
      clearVbb();
      vbbSourceFile = file;
      setError(vbbError, "");
      if (vbbMeta) vbbMeta.textContent = formatLocalPickMeta(file, "正在读取时长…");
      toast("已选择，仅本机处理，不会上传");
      vbbObjectUrl = URL.createObjectURL(file);
      attachLocalVideoPreview(vbbVideo, vbbObjectUrl);
      await waitVideoMetadata(vbbVideo);
      const duration = Number(vbbVideo.duration) || 0;
      if (!(duration > 0) || !vbbVideo.videoWidth) throw new Error("视频时长或尺寸无效");
      if (duration < VBB_MIN_SPAN) throw new Error(`视频太短，至少约 ${VBB_MIN_SPAN} 秒`);
      if (vbbMeta) {
        vbbMeta.textContent = formatLocalPickMeta(
          file,
          `${duration.toFixed(1)}s · ${vbbVideo.videoWidth}×${vbbVideo.videoHeight}`
        );
      }
      setVbbButtons();
      toast("视频已就绪，可分析切分方案");
    }

    async function runVbbAnalyze() {
      if (!vbbSourceFile || !vbbVideo?.src || vbbBusy) return;
      abortVbb = false;
      vbbBusy = true;
      setVbbButtons();
      if (vbbAbort) vbbAbort.hidden = false;
      setError(vbbError, "");
      clearVbbResults();
      try {
        const duration = Number(vbbVideo.duration) || 0;
        if (!(duration >= VBB_MIN_SPAN)) throw new Error(`视频太短，至少约 ${VBB_MIN_SPAN} 秒`);
        const srcW = vbbVideo.videoWidth || 0;
        const srcH = vbbVideo.videoHeight || 0;
        const sampleSpan = Math.min(VBB_SAMPLE_SPAN, Math.max(VBB_MIN_SPAN, duration));
        const sampleStart = Math.max(0, Math.min(Math.max(0, duration - sampleSpan), duration * 0.4));
        setVbbProgress(true, 0.08, "分析中 · 编码样片", {
          sub: `${sampleSpan.toFixed(1)}s @ 15FPS / 宽${V2G_BLACKBOX_BASE_W}`,
          busy: true,
        });
        await prewarmFfmpegEngine().catch(() => {});
        const sample = await encodeV2gGifFfmpeg({
          file: vbbSourceFile,
          fps: 15,
          maxW: V2G_BLACKBOX_BASE_W,
          quality: V2G_BLACKBOX_QUALITY,
          startSec: sampleStart,
          span: sampleSpan,
          srcW,
          srcH,
          skipWatermark: true,
          skipBright: true,
          brightness: 0,
          isAborted: () => abortVbb,
          stageLabel: "样片",
          onProgress: (local, text) =>
            setVbbProgress(true, 0.08 + Math.min(0.75, local) * 0.75, "分析中 · 编码样片", {
              sub: text,
              busy: true,
            }),
        });
        if (abortVbb) throw new Error("已取消");
        if (!sample?.blob?.size) throw new Error("样片编码失败");
        const bps15 = sample.blob.size / Math.max(0.5, sample.span || sampleSpan);
        const clarityMax = Math.max(
          VBB_MIN_SPAN,
          Math.min(VBB_CLARITY_MAX_SPAN, (V2G_BLACKBOX_MAX_BYTES * VBB_CLARITY_FILL) / bps15)
        );
        const durationMax = Math.max(
          clarityMax,
          Math.min(
            VBB_DURATION_MAX_SPAN,
            (V2G_BLACKBOX_MAX_BYTES * 0.92) / Math.max(1, bps15 * (10 / 15) * 0.55)
          )
        );
        const clarity = makeVbbPlanVariant(
          "clarity",
          "清晰优先",
          duration,
          clarityMax,
          bps15,
          "宽420 · 贴紧6MB · 不压缩",
          { encode: "clarity", maxW: V2G_BLACKBOX_BASE_W, srcW }
        );
        const sharp = makeSharpPlan(duration, bps15, srcW, clarityMax);
        const durationPlan = makeVbbPlanVariant(
          "duration",
          "时长优先",
          duration,
          durationMax,
          bps15,
          "可降帧/压缩 · 段更长、段数更少",
          { encode: "blackbox", maxW: V2G_BLACKBOX_BASE_W, srcW }
        );
        vbbAnalysis = {
          duration,
          srcW,
          srcH,
          bps15,
          sampleBytes: sample.blob.size,
          sampleSpan: sample.span || sampleSpan,
          clarityMax,
          durationMax,
          clarity,
          sharp,
          durationPlan,
          active: null,
        };
        if (vbbTargetSpan) vbbTargetSpan.value = String(Number(clarity.maxSpan.toFixed(1)));
        if (vbbTargetRange) vbbTargetRange.value = vbbTargetSpan.value;
        vbbMode = "clarity";
        paintVbbPlan();
        setVbbProgress(
          true,
          1,
          `分析完成 · 样片 ${formatKb(sample.blob.size)} / ${vbbAnalysis.sampleSpan.toFixed(1)}s`
        );
        toast(`清晰 ${clarity.count} 段 · 锐度 ${sharp.count} 段(宽${sharp.maxW}) · 时长 ${durationPlan.count} 段`);
        if (isLikelyMobileBrowser() && (duration >= 90 || (vbbSourceFile?.size || 0) >= 200 * 1024 * 1024)) {
          toast("大视频在手机上易内存不足。已优化分段写入；仍建议少段处理或用电脑。");
        }
      } catch (err) {
        if (String(err && err.message) !== "已取消") setError(vbbError, err.message || String(err));
        else toast("已取消分析");
        if (String(err && err.message) === "已取消") setVbbProgress(false, 0, "");
      } finally {
        vbbBusy = false;
        resetVbbAbort();
        if (vbbAbort) vbbAbort.hidden = true;
        setVbbButtons();
      }
    }

    async function runVbbExecute() {
      const plan = resolveActiveVbbPlan();
      if (!vbbSourceFile || !plan?.ranges?.length || vbbBusy) return;
      vbbAnalysis.active = plan;
      abortVbb = false;
      vbbBusy = true;
      setVbbButtons();
      if (vbbAbort) vbbAbort.hidden = false;
      setError(vbbError, "");
      clearVbbResults();
      const srcW = vbbVideo?.videoWidth || vbbAnalysis?.srcW || 0;
      const srcH = vbbVideo?.videoHeight || vbbAnalysis?.srcH || 0;
      const isAborted = () => abortVbb;
      const mobile = isLikelyMobileBrowser();
      const fileBytes = vbbSourceFile?.size || 0;
      const hugeFile = fileBytes >= 120 * 1024 * 1024;
      const longJob = (vbbAnalysis?.duration || 0) >= 90 || plan.ranges.length >= 8 || hugeFile;
      if (mobile && longJob) {
        toast(
          hugeFile
            ? "源视频较大：已改为整片只写入一次并按段抽取，仍可能因内存不足失败。"
            : "视频较长：手机可能因内存不足白屏。已改为按需预览；建议分段处理或用电脑。"
        );
      }
      try {
        await prewarmFfmpegEngine().catch(() => {});
        // 大文件先写入一次，后续片段复用，避免每段再 arrayBuffer 整文件
        if (hugeFile || plan.ranges.length >= 4) {
          try {
            const ff = await getFfmpegInstance();
            await ensureFfmpegInputWritten(ff, vbbSourceFile, () => {});
          } catch (_) {}
        }
        let firstSeed = null;
        vbbClips = plan.ranges.map((r) => ({
          start: r.start,
          span: r.span,
          gifBlob: null,
          gifUrl: "",
          gifNote: "",
          error: "",
          jobStatus: "pending",
          jobProgress: 0,
          jobText: "等待中…",
        }));
        renderVbbResults();
        for (let i = 0; i < plan.ranges.length; i++) {
          if (abortVbb) throw new Error("已取消");
          const r = plan.ranges[i];
          const clip = vbbClips[i];
          const isWide = plan.encode === "clarity" || plan.encode === "sharp";
          const reuseSeed = firstSeed && shouldReuseVbbFirstPlan(plan.ranges, i);
          const label = plan.encode === "sharp" ? "锐度 GIF" : plan.encode === "clarity" ? "清晰 GIF" : "时长黑盒";
          const followTip = reuseSeed ? " · 沿用#01" : "";
          setVbbClipJob(i, { status: "running", progress: 0.02, text: `${label}…` });
          setVbbProgress(true, i / plan.ranges.length, `${label} · ${i + 1}/${plan.ranges.length}${followTip}`, {
            sub: `${formatVbbClock(r.start)}–${formatVbbClock(r.start + r.span)}${isWide ? ` · 宽${(reuseSeed ? firstSeed.maxW : plan.maxW) || V2G_BLACKBOX_BASE_W}` : ""}`,
            busy: true,
          });
          try {
            let encoded;
            let usedFallback = false;
            let usedWidth = reuseSeed && !firstSeed.usedFallback
              ? firstSeed.maxW
              : plan.maxW || V2G_BLACKBOX_BASE_W;
            if (isWide && !(reuseSeed && firstSeed.usedFallback)) {
              const tryEncodeWide = async (maxW, phaseLabel, localBase, localSpan) =>
                encodeV2gGifFfmpeg({
                  file: vbbSourceFile,
                  fps: reuseSeed ? firstSeed.fps || 15 : 15,
                  maxW,
                  quality: V2G_BLACKBOX_QUALITY,
                  startSec: r.start,
                  span: r.span,
                  srcW,
                  srcH,
                  skipWatermark: true,
                  skipBright: true,
                  brightness: 0,
                  isAborted,
                  stageLabel: `#${i + 1}`,
                  onProgress: (local, text) => {
                    const p = localBase + Math.min(1, local) * localSpan;
                    setVbbClipJob(i, { status: "running", progress: Math.min(0.98, p), text: `${text} · 宽${maxW}` });
                    setVbbProgress(true, (i + p) / plan.ranges.length, `${phaseLabel} · ${i + 1}/${plan.ranges.length}`, {
                      sub: `${text} · 宽${maxW}`,
                      busy: true,
                    });
                  },
                });

              encoded = await tryEncodeWide(usedWidth, reuseSeed ? "沿用#01" : label, 0, 0.55);
              if (!encoded?.blob) throw new Error("未产出 GIF");
              encoded = { ...encoded, compressRounds: encoded.compressRounds || 0, maxW: usedWidth };
              while (encoded?.blob?.size > V2G_BLACKBOX_MAX_BYTES && usedWidth > V2G_BLACKBOX_BASE_W) {
                usedWidth = Math.max(V2G_BLACKBOX_BASE_W, usedWidth - V2G_BLACKBOX_WIDTH_STEP);
                setVbbProgress(true, (i + 0.55) / plan.ranges.length, `超限降宽 → ${usedWidth} · ${i + 1}/${plan.ranges.length}`, {
                  sub: formatKb(encoded.blob.size),
                  busy: true,
                });
                setVbbClipJob(i, { status: "running", progress: 0.55, text: `超限降宽 → ${usedWidth}` });
                encoded = await tryEncodeWide(usedWidth, "降宽重编", 0.55, 0.25);
                encoded = { ...encoded, compressRounds: 0, maxW: usedWidth };
              }
              if (reuseSeed && encoded?.blob?.size < V2G_BLACKBOX_WIDEN_BYTES && encoded?.blob?.size <= V2G_BLACKBOX_MAX_BYTES) {
                const hardMax = srcW > 0 ? Math.min(V2G_BLACKBOX_WIDTH_CAP, srcW) : V2G_BLACKBOX_WIDTH_CAP;
                let nextW = usedWidth + V2G_BLACKBOX_WIDTH_STEP;
                while (nextW <= hardMax) {
                  if (isAborted()) throw new Error("已取消");
                  const wider = await tryEncodeWide(nextW, "沿用后加宽", 0.72, 0.15);
                  if (wider?.blob?.size > V2G_BLACKBOX_MAX_BYTES) break;
                  encoded = { ...wider, compressRounds: 0, maxW: nextW };
                  usedWidth = nextW;
                  if (encoded.outW > 0 && encoded.outW < nextW - 2) break;
                  nextW += V2G_BLACKBOX_WIDTH_STEP;
                }
              }
              if (encoded?.blob?.size > V2G_BLACKBOX_MAX_BYTES) {
                setVbbProgress(true, (i + 0.8) / plan.ranges.length, `仍超限，改走黑盒 · ${i + 1}/${plan.ranges.length}`, {
                  sub: formatKb(encoded.blob.size),
                  busy: true,
                });
                setVbbClipJob(i, { status: "running", progress: 0.8, text: "仍超限，改走黑盒…" });
                encoded = await encodeBlackboxClip({
                  file: vbbSourceFile,
                  startSec: r.start,
                  span: r.span,
                  srcW,
                  srcH,
                  isAborted,
                  seed: reuseSeed ? firstSeed : null,
                  onProgress: (local, text) => {
                    const p = 0.8 + Math.min(0.18, local) * 0.18;
                    setVbbClipJob(i, { status: "running", progress: Math.min(0.98, p), text });
                    setVbbProgress(true, (i + p) / plan.ranges.length, `黑盒回退 · ${i + 1}/${plan.ranges.length}`, {
                      sub: text,
                      busy: true,
                    });
                  },
                });
                usedFallback = true;
              }
            } else {
              encoded = await encodeBlackboxClip({
                file: vbbSourceFile,
                startSec: r.start,
                span: r.span,
                srcW,
                srcH,
                isAborted,
                seed: reuseSeed ? firstSeed : null,
                onProgress: (local, text) => {
                  const p = Math.min(0.98, Number(local) || 0);
                  setVbbClipJob(i, { status: "running", progress: p, text: text || `${label}…` });
                  setVbbProgress(true, (i + p) / plan.ranges.length, `${label} · ${i + 1}/${plan.ranges.length}${followTip}`, {
                    sub: text,
                    busy: true,
                  });
                },
              });
              if (reuseSeed && firstSeed.usedFallback) usedFallback = true;
              if (encoded?.maxW) usedWidth = encoded.maxW;
            }
            if (!encoded?.blob) throw new Error("未产出 GIF");
            clip.gifBlob = encoded.blob;
            // 延迟创建 ObjectURL：列表默认不解码预览
            clip.gifUrl = "";
            const bits = [];
            if (reuseSeed) bits.push("沿用#01");
            if (usedFallback) bits.push("超限→黑盒");
            else if (isWide && usedWidth !== (plan.maxW || V2G_BLACKBOX_BASE_W)) bits.push(`已降宽${usedWidth}`);
            if (encoded.fps) bits.push(`${encoded.fps}FPS`);
            if (encoded.outW && encoded.outH) bits.push(`${encoded.outW}×${encoded.outH}`);
            if (encoded.compressRounds > 0) bits.push(`已压 ${encoded.compressRounds} 轮`);
            if (encoded.maxW) bits.push(`宽≤${encoded.maxW}`);
            else if (isWide && !usedFallback) bits.push(`宽≤${usedWidth}`);
            if (encoded.framesCapped) bits.push(`已抽稀 ${encoded.frameCount} 帧`);
            clip.gifNote = bits.join(" · ");
            if (encoded.blob.size > V2G_BLACKBOX_MAX_BYTES) {
              clip.error = `仍超 6MB（${formatKb(encoded.blob.size)}）`;
            }
            if (i === 0) firstSeed = snapshotVbbEncodeSeed(encoded, { usedWidth, usedFallback });
            setVbbClipJob(i, {
              status: clip.error ? "error" : "done",
              progress: 1,
              text: clip.error ? "完成（超限）" : "完成",
            });
          } catch (err) {
            if (String(err && err.message) === "已取消") throw err;
            clip.error = err.message || String(err);
            setVbbClipJob(i, { status: "error", progress: 1, text: "失败" });
          }
          // 只刷新列表元数据，不自动展开全部预览
          renderVbbResults();
          // 让出主线程，便于 Safari 回收临时内存
          const pauseMs = mobile ? (hugeFile ? 220 : 120) : 16;
          await new Promise((r) => setTimeout(r, pauseMs));
          const recycleEvery = mobile ? (hugeFile ? 1 : 2) : hugeFile ? 2 : 4;
          if ((i + 1) % recycleEvery === 0 && i < plan.ranges.length - 1) {
            try {
              terminateFfmpegInstance({ revokeAssets: false });
            } catch (_) {}
            await new Promise((r) => setTimeout(r, mobile ? 160 : 40));
            await prewarmFfmpegEngine().catch(() => {});
            try {
              const ff = await getFfmpegInstance();
              await ensureFfmpegInputWritten(ff, vbbSourceFile, () => {});
            } catch (_) {}
          }
        }
        const gifs = vbbClips.map((c, i) => ({ c, i })).filter((x) => x.c.gifBlob);
        const failN = vbbClips.filter((c) => c.error || !c.gifBlob).length;
        setVbbProgress(true, 1, `完成 · 成功 ${gifs.length}/${vbbClips.length}`);
        clearVbbClipJobs();
        renderVbbResults();
        setVbbButtons();
        if (gifs.length) {
          if (isAutoPackZipEnabled()) {
            await packDownloadVbbGifs({ auto: true });
            toast(
              failN
                ? `完成，${failN} 段有问题 · 已打包下载 GIF`
                : `已生成 ${gifs.length} 个 GIF · 已打包下载（可点「预览」查看）`
            );
          } else {
            toast(
              failN
                ? `完成，${failN} 段有问题 · 可点「打包下载全部 GIF」`
                : `已生成 ${gifs.length} 个 GIF · 可点「打包下载全部 GIF」预览后自行打包`
            );
          }
        } else {
          toast(failN ? `完成，${failN} 段有问题` : "未生成 GIF");
        }
      } catch (err) {
        if (String(err && err.message) !== "已取消") setError(vbbError, err.message || String(err));
        else toast("已取消");
        clearVbbClipJobs();
        renderVbbResults();
      } finally {
        vbbBusy = false;
        resetVbbAbort();
        if (vbbAbort) vbbAbort.hidden = true;
        setVbbButtons();
      }
    }

    async function runVbbMerge() {
      const blobs = vbbClips.map((c) => c.gifBlob).filter(Boolean);
      if (blobs.length < 2 || vbbBusy) return;
      vbbBusy = true;
      setVbbButtons();
      setError(vbbError, "");
      try {
        const blob = await mergeGifBlobs(blobs, (ratio, text) =>
          setVbbProgress(true, ratio, "合并 GIF", { sub: text, busy: ratio < 1 })
        );
        if (vbbMergedUrl) URL.revokeObjectURL(vbbMergedUrl);
        vbbMergedUrl = URL.createObjectURL(blob);
        if (vbbMergedPreview) {
          vbbMergedPreview.src = vbbMergedUrl;
          vbbMergedPreview.hidden = false;
        }
        if (vbbMergedDl) {
          vbbMergedDl.href = vbbMergedUrl;
          vbbMergedDl.hidden = false;
        }
        if (vbbResultBlock) vbbResultBlock.hidden = false;
        setVbbProgress(true, 1, `合并完成 · ${formatKb(blob.size)}`);
        toast("已合并为一条 GIF");
      } catch (err) {
        setError(vbbError, err.message || String(err));
      } finally {
        vbbBusy = false;
        setVbbButtons();
      }
    }

    $("#vbb-mode-clarity")?.addEventListener("click", () => {
      vbbMode = "clarity";
      paintVbbPlan();
    });
    $("#vbb-mode-sharp")?.addEventListener("click", () => {
      vbbMode = "sharp";
      paintVbbPlan();
    });
    $("#vbb-mode-duration")?.addEventListener("click", () => {
      vbbMode = "duration";
      paintVbbPlan();
    });
    $("#vbb-mode-custom")?.addEventListener("click", () => {
      vbbMode = "custom";
      paintVbbPlan();
    });
    const syncCustomTarget = (raw) => {
      if (!vbbAnalysis) return;
      const min = Number(vbbTargetRange?.min) || VBB_MIN_SPAN;
      const max = Number(vbbTargetRange?.max) || VBB_DURATION_MAX_SPAN;
      const val = Math.max(min, Math.min(max, Number(raw) || min));
      if (vbbTargetSpan) vbbTargetSpan.value = String(Number(val.toFixed(1)));
      if (vbbTargetRange) vbbTargetRange.value = String(Number(val.toFixed(1)));
      if (vbbMode !== "custom") vbbMode = "custom";
      paintVbbPlan();
    };
    vbbTargetSpan?.addEventListener("change", () => syncCustomTarget(vbbTargetSpan.value));
    vbbTargetSpan?.addEventListener("input", () => syncCustomTarget(vbbTargetSpan.value));
    vbbTargetRange?.addEventListener("input", () => syncCustomTarget(vbbTargetRange.value));
    vbbEqualize?.addEventListener("change", () => {
      rebuildVbbDerivedPlans();
      paintVbbPlan();
    });
    vbbFile?.addEventListener("change", (e) => {
      loadVbbFile(e.target.files?.[0]).catch((err) => {
        clearVbb();
        setError(vbbError, err.message || String(err));
      });
    });
    $("#vbb-clear")?.addEventListener("click", clearVbb);
    window.DevToolsTemp?.registerCleanup(clearVbb);
    // 供预估准确性测试读取（不影响 UI）
    window.DevToolsVbb = {
      getBps15: () => vbbAnalysis?.bps15 ?? null,
      getSrcW: () => vbbAnalysis?.srcW ?? 0,
      getActivePlan: () => (vbbAnalysis ? resolveActiveVbbPlan() : null),
      getClips: () => vbbClips.slice(),
      shouldReuseFirstPlan: (ranges, index) => shouldReuseVbbFirstPlan(ranges, index),
      estimateBlackbox: (span) => {
        if (!vbbAnalysis) return null;
        return estimateVbbBlackboxPlan(vbbAnalysis.bps15, span, vbbAnalysis.srcW);
      },
      isEqualize: () => isVbbEqualize(),
    };
    vbbAnalyze?.addEventListener("click", () => runVbbAnalyze().catch((err) => setError(vbbError, err.message || String(err))));
    vbbRun?.addEventListener("click", () => runVbbExecute().catch((err) => setError(vbbError, err.message || String(err))));
    vbbMerge?.addEventListener("click", () => runVbbMerge().catch((err) => setError(vbbError, err.message || String(err))));
    vbbZip?.addEventListener("click", () => {
      packDownloadVbbGifs().catch((err) => setError(vbbError, err.message || String(err)));
    });
    vbbAbort?.addEventListener("click", () => {
      abortVbb = true;
      abortV2g = true;
      terminateFfmpegInstance({ revokeAssets: false });
      scheduleFfmpegPrewarm();
    });
    syncVbbModeUi();
    setVbbButtons();
  } catch (err) {
    console.error("video to gif init failed", err);
  }

  // ---- Compress existing GIF ----
  try {
    const gifcFile = $("#gifc-file");
    const gifcMeta = $("#gifc-meta");
    const gifcError = $("#gifc-error");
    const gifcLevel = $("#gifc-compress-level");
    const gifcCompress = $("#gifc-compress");
    const gifcCompressAgain = $("#gifc-compress-again");
    const gifcDownload = $("#gifc-download");
    const gifcSource = $("#gifc-source");
    const gifcPreview = $("#gifc-preview");
    const gifcProgress = $("#gifc-progress");
    const gifcProgressFill = $("#gifc-progress-fill");
    const gifcProgressText = $("#gifc-progress-text");
    let sourceBlob = null;
    let workingBlob = null;
    let originalSize = 0;
    let compressRound = 0;
    let sourceUrl = "";
    let outUrl = "";
    let sourceName = "compressed.gif";
    let compressingExisting = false;

    function setGifcProgress(visible, ratio, text) {
      if (!gifcProgress) return;
      gifcProgress.hidden = !visible;
      const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
      if (gifcProgressFill) gifcProgressFill.style.width = `${pct}%`;
      if (gifcProgressText) gifcProgressText.textContent = text || `${pct}%`;
    }

    function setGifcButtons() {
      if (gifcCompress) gifcCompress.disabled = !sourceBlob || compressingExisting;
      if (gifcCompressAgain) {
        const canAgain = Boolean(workingBlob) && compressRound > 0 && !compressingExisting;
        gifcCompressAgain.disabled = !canAgain;
        gifcCompressAgain.hidden = compressRound <= 0;
      }
    }

    function revokeGifcOut() {
      if (outUrl) {
        URL.revokeObjectURL(outUrl);
        outUrl = "";
      }
      if (gifcPreview) {
        gifcPreview.hidden = true;
        gifcPreview.removeAttribute("src");
      }
      if (gifcDownload) {
        gifcDownload.hidden = true;
        gifcDownload.removeAttribute("href");
      }
    }

    function clearGifc() {
      sourceBlob = null;
      workingBlob = null;
      originalSize = 0;
      compressRound = 0;
      if (sourceUrl) {
        URL.revokeObjectURL(sourceUrl);
        sourceUrl = "";
      }
      revokeGifcOut();
      if (gifcSource) {
        gifcSource.hidden = true;
        gifcSource.removeAttribute("src");
      }
      if (gifcFile) gifcFile.value = "";
      setGifcProgress(false, 0, "");
      setError(gifcError, "");
      if (gifcMeta) {
        gifcMeta.textContent =
          "上传本地已有 GIF，选择档位后压缩；效果不满意可点「继续压缩」，会基于当前结果再压一轮。";
      }
      sourceName = "compressed.gif";
      compressingExisting = false;
      setGifcButtons();
    }

    async function loadExistingGif(file) {
      if (!file) return;
      clearGifc();
      setError(gifcError, "");
      const type = String(file.type || "").toLowerCase();
      const name = String(file.name || "");
      if (type && type !== "image/gif" && !/\.gif$/i.test(name)) {
        setError(gifcError, "请选择 GIF 文件");
        return;
      }
      sourceBlob = file;
      workingBlob = file;
      originalSize = file.size;
      compressRound = 0;
      sourceName = name.replace(/\.gif$/i, "") || "compressed";
      sourceName = `${sourceName}-compressed.gif`;
      sourceUrl = URL.createObjectURL(file);
      if (gifcSource) {
        gifcSource.src = sourceUrl;
        gifcSource.hidden = false;
      }
      setGifcButtons();
      if (gifcMeta) {
        gifcMeta.textContent = `${file.name} · ${formatKb(file.size)} · 选择档位后点「压缩体积」；可多次「继续压缩」`;
      }
      toast("GIF 已加载");
    }

    async function compressExistingGif({ again = false } = {}) {
      const input = again ? workingBlob : sourceBlob;
      if (!input || compressingExisting) return;
      compressingExisting = true;
      setGifcButtons();
      setError(gifcError, "");
      const before = input.size;
      const nextRound = again ? compressRound + 1 : 1;
      if (!again) {
        workingBlob = sourceBlob;
        originalSize = sourceBlob.size;
      }
      try {
        const level = gifcLevel?.value || "standard";
        const out = await compressGifBlob(input, level, (ratio, text) => {
          setGifcProgress(true, ratio, text);
        }, { round: nextRound });
        const after = out.size;
        compressRound = nextRound;
        workingBlob = out;
        if (outUrl) URL.revokeObjectURL(outUrl);
        outUrl = URL.createObjectURL(out);
        if (gifcPreview) {
          gifcPreview.src = outUrl;
          gifcPreview.hidden = false;
        }
        if (gifcDownload) {
          gifcDownload.href = outUrl;
          gifcDownload.download = sourceName;
          gifcDownload.hidden = false;
        }
        const summary = gifCompressSummary(originalSize || before, before, after, nextRound);
        if (gifcMeta) gifcMeta.textContent = summary.text;
        setGifcProgress(true, 1, `第 ${nextRound} 次压缩完成 · ${formatKb(before)} → ${formatKb(after)}`);
        toast(
          after < before
            ? `第 ${nextRound} 次已压缩，本轮约省 ${summary.stepSaved}%`
            : `第 ${nextRound} 次完成（本轮体积无明显下降，可换更强档位再试）`
        );
      } catch (err) {
        setError(gifcError, err.message || String(err));
        setGifcProgress(false, 0, "");
      } finally {
        compressingExisting = false;
        setGifcButtons();
      }
    }

    gifcFile?.addEventListener("change", (e) => {
      loadExistingGif(e.target.files?.[0]).catch((err) => setError(gifcError, err.message || String(err)));
    });
    $("#gifc-clear")?.addEventListener("click", clearGifc);
    window.DevToolsTemp?.registerCleanup(clearGifc);
    gifcCompress?.addEventListener("click", () => {
      compressExistingGif({ again: false }).catch((err) => setError(gifcError, err.message || String(err)));
    });
    gifcCompressAgain?.addEventListener("click", () => {
      compressExistingGif({ again: true }).catch((err) => setError(gifcError, err.message || String(err)));
    });
  } catch (err) {
    console.error("gif compress existing init failed", err);
  }

  // ---- Merge GIFs ----
  try {
    const gifmFile = $("#gifm-file");
    const gifmList = $("#gifm-list");
    const gifmMeta = $("#gifm-meta");
    const gifmError = $("#gifm-error");
    const gifmMerge = $("#gifm-merge");
    const gifmDownload = $("#gifm-download");
    const gifmPreview = $("#gifm-preview");
    const gifmProgress = $("#gifm-progress");
    const gifmProgressFill = $("#gifm-progress-fill");
    const gifmProgressText = $("#gifm-progress-text");
    const items = [];
    let mergedUrl = "";
    let merging = false;

    function setGifmProgress(visible, ratio, text) {
      if (!gifmProgress) return;
      gifmProgress.hidden = !visible;
      const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
      if (gifmProgressFill) gifmProgressFill.style.width = `${pct}%`;
      if (gifmProgressText) gifmProgressText.textContent = text || `${pct}%`;
    }

    function revokeMerged() {
      if (mergedUrl) {
        URL.revokeObjectURL(mergedUrl);
        mergedUrl = "";
      }
      if (gifmPreview) {
        gifmPreview.hidden = true;
        gifmPreview.removeAttribute("src");
      }
      if (gifmDownload) {
        gifmDownload.hidden = true;
        gifmDownload.removeAttribute("href");
      }
    }

    function renderGifmList() {
      if (!gifmList) return;
      gifmList.innerHTML = "";
      items.forEach((it, idx) => {
        const row = document.createElement("div");
        row.className = "gif-frame";
        const img = document.createElement("img");
        img.className = "gif-frame-thumb gifm-thumb";
        img.alt = `GIF ${idx + 1}`;
        img.src = it.url;
        const meta = document.createElement("div");
        meta.className = "gif-frame-meta";
        const nameEl = document.createElement("strong");
        nameEl.className = "gif-frame-name";
        nameEl.textContent = `${idx + 1}. ${it.name}`;
        const sizeEl = document.createElement("span");
        sizeEl.className = "hint tight";
        sizeEl.textContent = formatKb(it.blob.size);
        meta.append(nameEl, sizeEl);
        const actions = document.createElement("div");
        actions.className = "gif-frame-actions";
        const up = document.createElement("button");
        up.type = "button";
        up.className = "ghost-btn";
        up.textContent = "上移";
        up.disabled = idx === 0;
        up.addEventListener("click", () => {
          if (idx <= 0) return;
          const cur = items.splice(idx, 1)[0];
          items.splice(idx - 1, 0, cur);
          renderGifmList();
        });
        const down = document.createElement("button");
        down.type = "button";
        down.className = "ghost-btn";
        down.textContent = "下移";
        down.disabled = idx === items.length - 1;
        down.addEventListener("click", () => {
          if (idx >= items.length - 1) return;
          const cur = items.splice(idx, 1)[0];
          items.splice(idx + 1, 0, cur);
          renderGifmList();
        });
        const del = document.createElement("button");
        del.type = "button";
        del.className = "ghost-btn";
        del.textContent = "移除";
        del.addEventListener("click", () => {
          URL.revokeObjectURL(it.url);
          items.splice(idx, 1);
          renderGifmList();
        });
        actions.append(up, down, del);
        row.append(img, meta, actions);
        gifmList.appendChild(row);
      });
      if (gifmMerge) gifmMerge.disabled = merging || items.length < 2;
      if (gifmMeta) {
        gifmMeta.textContent =
          items.length >= 2
            ? `已选 ${items.length} 个 GIF，点「合并为一条 GIF」按当前顺序拼接（不重编码）`
            : "按添加顺序拼接成一条长 GIF，不重新调色板（各段宽高需一致）。至少 2 个。";
      }
    }

    function clearGifm() {
      items.splice(0, items.length).forEach((it) => {
        try {
          URL.revokeObjectURL(it.url);
        } catch (_) {}
      });
      revokeMerged();
      if (gifmFile) gifmFile.value = "";
      setGifmProgress(false, 0, "");
      setError(gifmError, "");
      renderGifmList();
    }

    gifmFile?.addEventListener("change", (e) => {
      const files = [...(e.target.files || [])];
      files.forEach((file) => {
        const type = String(file.type || "").toLowerCase();
        const name = String(file.name || "");
        if (type && type !== "image/gif" && !/\.gif$/i.test(name)) return;
        items.push({ blob: file, name: name || "clip.gif", url: URL.createObjectURL(file) });
      });
      if (gifmFile) gifmFile.value = "";
      renderGifmList();
    });
    $("#gifm-clear")?.addEventListener("click", clearGifm);
    window.DevToolsTemp?.registerCleanup(clearGifm);
    gifmMerge?.addEventListener("click", async () => {
      if (items.length < 2 || merging) return;
      merging = true;
      gifmMerge.disabled = true;
      setError(gifmError, "");
      revokeMerged();
      try {
        const blob = await mergeGifBlobs(
          items.map((it) => it.blob),
          (ratio, text) => setGifmProgress(true, ratio, text)
        );
        mergedUrl = URL.createObjectURL(blob);
        if (gifmPreview) {
          gifmPreview.src = mergedUrl;
          gifmPreview.hidden = false;
        }
        if (gifmDownload) {
          gifmDownload.href = mergedUrl;
          gifmDownload.hidden = false;
        }
        setGifmProgress(true, 1, `合并完成 · ${formatKb(blob.size)}`);
        toast("GIF 已合并，可预览下载");
      } catch (err) {
        setError(gifmError, err.message || String(err));
        setGifmProgress(false, 0, "");
      } finally {
        merging = false;
        renderGifmList();
      }
    });
    renderGifmList();
  } catch (err) {
    console.error("gif merge init failed", err);
  }

  // Rebind copy buttons added dynamically in HTML for new panels
  // ---- ADB bridge client (P0–P3) ----
  try {
    const ADB_STORE_BASE = "devtools-adb-base";
    const ADB_STORE_TOKEN = "devtools-adb-token";
    const ADB_FS_ROOTS_HINT_HTML =
      "对标桌面文件管理器：双栏互拖、拖入上传；文件夹优先桥端打包。Delete / F2 / Ctrl+A。「内部存储」= /storage/emulated/0。";
    const adbBaseInput = $("#adb-base");
    const adbTokenInput = $("#adb-token");
    const adbDot = $("#adb-dot");
    const adbStatusTitle = $("#adb-status-title");
    const adbStatusText = $("#adb-status-text");
    const adbError = $("#adb-error");
    const adbWorkspace = $("#adb-workspace");
    const adbDeviceList = $("#adb-device-list");
    const adbDeviceMeta = $("#adb-device-meta");
    const adbSelectedMeta = $("#adb-selected-meta");
    const adbFsList = $("#adb-fs-list");
    const adbFsPath = $("#adb-fs-path");
    const adbFsMeta = $("#adb-fs-meta");
    const adbInfoMeta = $("#adb-info-meta");
    const adbAppsList = $("#adb-apps-list");
    const adbAppsMeta = $("#adb-apps-meta");
    const adbJobsList = $("#adb-jobs-list");
    const adbJobsMeta = $("#adb-jobs-meta");
    const adbInstallMeta = $("#adb-install-meta");
    const adbApkName = $("#adb-apk-name");
    let adbConnected = false;
    let adbDevices = [];
    let adbSelected = "";
    let adbChecked = new Set();
    let adbPollTimer = 0;
    let adbJobTimer = 0;
    let adbLogLiveTimer = 0;
    let adbApps = [];
    let adbJobs = [];
    let adbApkFile = null;
    let adbApkUploadId = "";
    let adbApkInfo = null;
    let adbFsSelected = "";
    let adbBridgeFeatures = [];
    let adbBridgeVersion = "";
    let adbFsChecked = new Map(); // path -> { path, name, isDir }
    let adbFsClipboard = null; // { mode: 'cut'|'copy', items: [{path, name}] }
    let adbFsPreviewUrl = "";
    let adbFsPreviewToken = 0;
    let adbFsEntriesCache = [];
    let adbFsPathCache = "/";
    let adbFsSortKey = "name"; // name | size | date
    let adbFsSortDir = 1; // 1 asc, -1 desc
    let adbFsXferBusy = false;
    let adbFsXferAbort = null; // AbortController for current transfer (upload/download/zip)
    let adbFsHistory = [];
    let adbFsHistIdx = -1;
    let adbFsDirWritable = true;
    const ADB_STORE_FSVIEW = "devtools-adb-fs-view";
    const ADB_STORE_LOCAL_PATH = "devtools-adb-local-path";
    let adbFsView = "list"; // list | grid
    let adbFsThumbUrls = []; // blob URLs to revoke on next repaint
    const ADB_FS_THUMB_MAX = 2 * 1024 * 1024;
    let adbLocalRoots = [];
    let adbLocalPath = "";
    let adbLocalEntries = [];
    let adbLocalChecked = new Map(); // path -> { path, name, isDir }
    let adbLocalBusy = false;
    const adbFsPreview = $("#adb-fs-preview");
    const adbFsPreviewTitle = $("#adb-fs-preview-title");
    const adbFsPreviewMeta = $("#adb-fs-preview-meta");
    const adbFsPreviewBody = $("#adb-fs-preview-body");
    const adbFsBatch = $("#adb-fs-batch");
    const adbFsBatchMeta = $("#adb-fs-batch-meta");
    const ADB_PREVIEW_IMAGE_MAX = 12 * 1024 * 1024;
    const ADB_PREVIEW_TEXT_MAX = 1.5 * 1024 * 1024;
    const ADB_PREVIEW_MEDIA_MAX = 28 * 1024 * 1024;
    let adbInputShotUrl = "";
    let adbInputLive = false;
    let adbInputLiveTimer = 0;
    let adbInputRefreshBusy = false;
    let adbInputRefreshAfter = false;
    const ADB_STORE_INPUT_SHOT_VH = "devtools-adb-input-shot-vh";
    const ADB_INPUT_SHOT_VH_DEFAULT = 56;
    let adbTab = "info";
    let adbPermPackage = "";
    let adbLogLive = false;
    let adbTrackedJobs = new Set(); // jobs shown inline on current panels

    function adbBase() {
      return String(adbBaseInput?.value || "http://127.0.0.1:17888").replace(/\/+$/, "");
    }

    function adbToken() {
      return String(adbTokenInput?.value || "devtools-adb");
    }

    function persistAdbSettings() {
      try {
        localStorage.setItem(ADB_STORE_BASE, adbBase());
        localStorage.setItem(ADB_STORE_TOKEN, adbToken());
      } catch (_) {
        /* ignore */
      }
    }

    function restoreAdbSettings() {
      try {
        const base = localStorage.getItem(ADB_STORE_BASE);
        const token = localStorage.getItem(ADB_STORE_TOKEN);
        if (base && adbBaseInput) adbBaseInput.value = base;
        if (token && adbTokenInput) adbTokenInput.value = token;
        const view = localStorage.getItem(ADB_STORE_FSVIEW);
        if (view === "grid" || view === "list") adbFsView = view;
      } catch (_) {
        /* ignore */
      }
    }

    function setAdbStatus(kind, title, text) {
      if (adbDot) {
        adbDot.classList.remove("is-ok", "is-warn", "is-err");
        if (kind) adbDot.classList.add(kind);
      }
      if (adbStatusTitle) adbStatusTitle.textContent = title;
      if (adbStatusText) adbStatusText.textContent = text;
    }

    function formatBytes(n) {
      const num = Number(n);
      if (!Number.isFinite(num)) return "";
      if (num < 1024) return `${num} B`;
      if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
      if (num < 1024 * 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)} MB`;
      return `${(num / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    }

    function joinRemote(dir, name) {
      const baseRaw = String(dir || "/");
      const base = baseRaw === "/" ? "" : baseRaw.replace(/\/+$/, "");
      return `${base}/${String(name || "").replace(/^\/+/, "")}` || "/";
    }

    function basenameRemote(remotePath) {
      const p = String(remotePath || "").replace(/\/+$/, "");
      const idx = p.lastIndexOf("/");
      return idx >= 0 ? p.slice(idx + 1) : p;
    }

    function checkedSerials() {
      return [...adbChecked];
    }

    function targetSerials(preferChecked) {
      const list = preferChecked ? checkedSerials() : [];
      if (list.length) return list;
      return adbSelected ? [adbSelected] : [];
    }

    function updateSelectedMeta() {
      if (!adbSelectedMeta) return;
      const n = adbChecked.size;
      adbSelectedMeta.textContent = adbSelected
        ? `当前：${adbSelected}${n ? ` · 已勾选 ${n} 台` : " · 未勾选批量设备"}`
        : "请选择当前设备；勾选用于批量安装与截图";
      if (adbInstallMeta) {
        adbInstallMeta.textContent = n
          ? `将安装到勾选的 ${n} 台设备`
          : adbSelected
            ? `未勾选时，「安装到勾选设备」会回退到当前设备`
            : "请先选择设备";
      }
    }

    async function adbFetch(pathname, options = {}) {
      const headers = Object.assign({}, options.headers || {});
      if (options.auth !== false) headers["X-Adb-Token"] = adbToken();
      const res = await fetch(`${adbBase()}${pathname}`, {
        ...options,
        headers,
        cache: "no-store",
      });
      const type = res.headers.get("content-type") || "";
      if (type.includes("application/json")) {
        const data = await res.json();
        if (!res.ok || data.ok === false) {
          throw new Error(data.error || `请求失败 (${res.status})`);
        }
        return data;
      }
      if (!res.ok) {
        let msg = `请求失败 (${res.status})`;
        try {
          const data = await res.json();
          if (data?.error) msg = data.error;
        } catch (_) {
          /* ignore */
        }
        throw new Error(msg);
      }
      return res;
    }

    function requireCurrentSerial() {
      if (!adbSelected) throw new Error("请先选择当前设备");
      return adbSelected;
    }

    function switchAdbTab(tab) {
      const prev = adbTab;
      adbTab = tab;
      $$(".adb-tab").forEach((btn) => {
        btn.classList.toggle("is-active", btn.dataset.adbTab === tab);
      });
      $$("[data-adb-panel]").forEach((panel) => {
        panel.hidden = panel.dataset.adbPanel !== tab;
      });
      if (prev === "logcat" && tab !== "logcat") stopAdbLogLive();
      if (prev === "input" && tab !== "input") stopInputLivePreview();
      if (tab === "apps" && adbSelected && !adbApps.length) loadApps().catch(() => {});
      if (tab === "jobs") refreshJobs().catch(() => {});
      if (tab === "info" && adbSelected) loadSnapshot({ silent: true }).catch(() => {});
      if (tab === "network" && adbSelected) {
        refreshProxy({ silent: true }).catch(() => {});
        refreshForwards({ silent: true }).catch(() => {});
      }
      if (tab === "developer" && adbSelected) refreshDeveloper({ silent: true }).catch(() => {});
    }

    function adbDeviceAccent(serial) {
      const s = String(serial || "");
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return Math.abs(h) % 360;
    }

    function renderAdbDevices() {
      if (!adbDeviceList) return;
      if (!adbDevices.length) {
        adbDeviceList.innerHTML = `<div class="adb-fs-empty">未检测到设备。请检查 USB 调试授权后点「刷新设备」。</div>`;
        if (adbDeviceMeta) adbDeviceMeta.textContent = "0 台";
        updateSelectedMeta();
        return;
      }
      if (adbDeviceMeta) adbDeviceMeta.textContent = `${adbDevices.length} 台`;
      adbDeviceList.innerHTML = adbDevices
        .map((d) => {
          const title = d.model || d.product || d.serial;
          const active = d.serial === adbSelected ? " is-active" : "";
          const checked = adbChecked.has(d.serial) ? "checked" : "";
          const hue = adbDeviceAccent(d.serial);
          return `<div class="adb-device${active}" data-serial-wrap="${escapeHtml(d.serial)}" style="--adb-accent: hsl(${hue} 58% 46%)">
            <span class="adb-device-stripe" aria-hidden="true"></span>
            <input class="adb-device-check" type="checkbox" data-adb-check="${escapeHtml(d.serial)}" ${checked} aria-label="勾选 ${escapeHtml(d.serial)}" />
            <button type="button" class="adb-device-body" data-serial="${escapeHtml(d.serial)}">
              <strong>${escapeHtml(title)}</strong>
              <span>${escapeHtml(d.serial)} · ${escapeHtml(d.state)}</span>
            </button>
          </div>`;
        })
        .join("");
      updateSelectedMeta();
    }

    function fillAdbInfo(info) {
      const set = (id, value) => {
        const el = $(id);
        if (el) el.textContent = value || "—";
      };
      if (!info) {
        ["#adb-info-serial", "#adb-info-state", "#adb-info-model", "#adb-info-android", "#adb-info-screen", "#adb-info-battery", "#adb-info-storage", "#adb-info-build"].forEach((id) => set(id, "—"));
        if (adbInfoMeta) adbInfoMeta.textContent = "未选择设备";
        return;
      }
      set("#adb-info-serial", info.serial || info.serialno);
      set("#adb-info-state", info.state);
      set("#adb-info-model", [info.manufacturer, info.model].filter(Boolean).join(" / "));
      set(
        "#adb-info-android",
        [info.androidVersion && `Android ${info.androidVersion}`, info.sdk && `SDK ${info.sdk}`]
          .filter(Boolean)
          .join(" · ")
      );
      set("#adb-info-screen", [info.screen, info.density && `${info.density} dpi`].filter(Boolean).join(" / "));
      set("#adb-info-battery", info.battery);
      set("#adb-info-storage", info.storage);
      set("#adb-info-build", [info.abi, info.buildId].filter(Boolean).join(" · "));
      if (adbInfoMeta) {
        adbInfoMeta.textContent = info.ready === false ? info.message || "设备未就绪" : "已加载";
      }
    }

    function renderFsCrumbs(pathValue) {
      const el = $("#adb-fs-crumbs");
      if (!el) return;
      const raw = String(pathValue || "/");
      if (raw === "/") {
        el.innerHTML = `<button type="button" class="linkish" data-adb-open="/">/</button>`;
        return;
      }
      const parts = raw.replace(/\/+$/, "").split("/").filter(Boolean);
      let acc = "";
      const bits = [`<button type="button" class="linkish" data-adb-open="/">/</button>`];
      parts.forEach((part) => {
        acc += `/${part}`;
        bits.push(
          `<button type="button" class="linkish" data-adb-open="${escapeHtml(acc)}">${escapeHtml(part)}</button>`
        );
      });
      el.innerHTML = bits.join(`<span class="adb-crumb-sep" aria-hidden="true">/</span>`);
    }

    function classifyAdbPreview(name) {
      const n = String(name || "");
      if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(n)) return "image";
      if (/\.(mp4|webm|mkv|3gp)$/i.test(n)) return "video";
      if (/\.(mp3|m4a|aac|ogg|wav)$/i.test(n)) return "audio";
      if (
        /\.(txt|log|md|csv|tsv|ini|conf|cfg|properties|prop|gradle|smali|java|kt|kts|xml|html?|css|js|mjs|cjs|ts|json|ya?ml|toml|sh|bat|cmd|rc|gitignore|pro)$/i.test(
          n
        )
      ) {
        return "text";
      }
      return "other";
    }

    function clearAdbFsPreview({ keepOpen = false } = {}) {
      if (adbFsPreviewUrl) {
        try {
          URL.revokeObjectURL(adbFsPreviewUrl);
        } catch (_) {
          /* ignore */
        }
        adbFsPreviewUrl = "";
      }
      if (adbFsPreviewBody) adbFsPreviewBody.innerHTML = "";
      if (adbFsPreviewMeta) adbFsPreviewMeta.textContent = "";
      if (adbFsPreviewTitle) adbFsPreviewTitle.textContent = "文件预览";
      const propsBox = $("#adb-fs-props");
      if (propsBox) {
        propsBox.hidden = true;
        propsBox.textContent = "";
      }
      if (adbFsPreview && !keepOpen) adbFsPreview.hidden = true;
    }

    function showAdbFsPreviewShell(name, metaText) {
      if (adbFsPreview) adbFsPreview.hidden = false;
      if (adbFsPreviewTitle) adbFsPreviewTitle.textContent = name || "文件预览";
      if (adbFsPreviewMeta) adbFsPreviewMeta.textContent = metaText || "";
    }

    function showFsProps(entry) {
      const box = $("#adb-fs-props");
      if (!box || !entry) return;
      if (adbFsPreview) adbFsPreview.hidden = false;
      if (adbFsPreviewTitle && (entry.isDir || entry.virtual)) {
        adbFsPreviewTitle.textContent = entry.name || basenameRemote(entry.path) || "属性";
      }
      const lines = [
        `路径：${entry.path || ""}`,
        `类型：${entry.virtual ? "虚拟（应用包名）" : entry.isDir ? "文件夹" : "文件"}`,
      ];
      if (!entry.isDir && !entry.virtual) {
        const size = Number(entry.size);
        lines.push(`大小：${Number.isFinite(size) ? `${formatBytes(size)} (${size} B)` : "未知"}`);
      }
      if (entry.date) lines.push(`修改时间：${entry.date}`);
      if (entry.mode) lines.push(`权限：${entry.mode}`);
      lines.push(`可写：${entry.virtual ? "否（虚拟）" : entry.writable === false ? "否" : "是"}`);
      box.textContent = lines.join("\n");
      box.hidden = false;
      if ((entry.isDir || entry.virtual) && adbFsPreviewBody) {
        adbFsPreviewBody.innerHTML = `<p class="adb-fs-preview-empty">文件夹无预览，可查看上方属性或双击打开。</p>`;
      }
    }

    async function previewAdbFile(remotePath, name, sizeHint) {
      if (!adbSelected || !remotePath) return;
      const kind = classifyAdbPreview(name);
      const size = Number(sizeHint);
      const knownSize = Number.isFinite(size) && size >= 0;
      clearAdbFsPreview({ keepOpen: true });
      showAdbFsPreviewShell(name || basenameRemote(remotePath), "加载预览…");
      if (kind === "other") {
        if (adbFsPreviewBody) {
          adbFsPreviewBody.innerHTML = `<p class="adb-fs-preview-empty">此类型暂不支持在线预览，请用「下载」到电脑查看。</p>`;
        }
        if (adbFsPreviewMeta) {
          adbFsPreviewMeta.textContent = knownSize ? formatBytes(size) : "未知大小";
        }
        return;
      }
      const limit =
        kind === "text" ? ADB_PREVIEW_TEXT_MAX : kind === "image" ? ADB_PREVIEW_IMAGE_MAX : ADB_PREVIEW_MEDIA_MAX;
      if (knownSize && size > limit) {
        if (adbFsPreviewBody) {
          adbFsPreviewBody.innerHTML = `<p class="adb-fs-preview-empty">文件约 ${formatBytes(
            size
          )}，超过预览上限（${formatBytes(limit)}）。请下载后本地打开。</p>`;
        }
        if (adbFsPreviewMeta) adbFsPreviewMeta.textContent = `${kind} · ${formatBytes(size)}`;
        return;
      }
      const token = ++adbFsPreviewToken;
      try {
        const res = await adbFetch(
          `/fs/download?serial=${encodeURIComponent(adbSelected)}&path=${encodeURIComponent(remotePath)}`
        );
        if (token !== adbFsPreviewToken) return;
        const blob = await res.blob();
        if (token !== adbFsPreviewToken) return;
        if (blob.size > limit) {
          if (adbFsPreviewBody) {
            adbFsPreviewBody.innerHTML = `<p class="adb-fs-preview-empty">已拉取 ${formatBytes(
              blob.size
            )}，超过预览上限。请下载后本地打开。</p>`;
          }
          return;
        }
        if (kind === "text") {
          const text = await blob.text();
          if (token !== adbFsPreviewToken) return;
          const pre = document.createElement("pre");
          pre.className = "mono";
          pre.textContent = text.slice(0, 200_000);
          if (adbFsPreviewBody) {
            adbFsPreviewBody.innerHTML = "";
            adbFsPreviewBody.appendChild(pre);
          }
          if (adbFsPreviewMeta) {
            adbFsPreviewMeta.textContent = `文本 · ${formatBytes(blob.size)}${
              text.length > 200_000 ? " · 已截断显示" : ""
            }`;
          }
          return;
        }
        adbFsPreviewUrl = URL.createObjectURL(blob);
        if (kind === "image") {
          const img = document.createElement("img");
          img.alt = name || "预览图";
          img.src = adbFsPreviewUrl;
          if (adbFsPreviewBody) {
            adbFsPreviewBody.innerHTML = "";
            adbFsPreviewBody.appendChild(img);
          }
        } else if (kind === "video") {
          const video = document.createElement("video");
          video.controls = true;
          video.playsInline = true;
          video.src = adbFsPreviewUrl;
          if (adbFsPreviewBody) {
            adbFsPreviewBody.innerHTML = "";
            adbFsPreviewBody.appendChild(video);
          }
        } else if (kind === "audio") {
          const audio = document.createElement("audio");
          audio.controls = true;
          audio.src = adbFsPreviewUrl;
          if (adbFsPreviewBody) {
            adbFsPreviewBody.innerHTML = "";
            adbFsPreviewBody.appendChild(audio);
          }
        }
        if (adbFsPreviewMeta) adbFsPreviewMeta.textContent = `${kind} · ${formatBytes(blob.size)}`;
      } catch (err) {
        if (token !== adbFsPreviewToken) return;
        if (adbFsPreviewBody) {
          adbFsPreviewBody.innerHTML = `<p class="adb-fs-preview-empty">${escapeHtml(
            err.message || String(err)
          )}</p>`;
        }
        if (adbFsPreviewMeta) adbFsPreviewMeta.textContent = "预览失败";
      }
    }

    function clipboardItems(clip = adbFsClipboard) {
      if (!clip) return [];
      if (Array.isArray(clip.items) && clip.items.length) return clip.items;
      if (clip.path) return [{ path: clip.path, name: clip.name || basenameRemote(clip.path) }];
      return [];
    }

    function setFsClipboard(mode, items) {
      const list = (items || [])
        .map((it) => ({
          path: it.path,
          name: it.name || basenameRemote(it.path),
        }))
        .filter((it) => it.path);
      adbFsClipboard = list.length ? { mode, items: list } : null;
      updateFsClipboardMeta();
    }

    function updateFsClipboardMeta() {
      const meta = $("#adb-fs-clip-meta");
      const pasteBtn = $("#adb-fs-paste");
      const items = clipboardItems();
      if (pasteBtn) pasteBtn.disabled = !items.length;
      if (!meta) return;
      if (!items.length) {
        meta.hidden = true;
        meta.textContent = "";
        return;
      }
      meta.hidden = false;
      const verb = adbFsClipboard.mode === "cut" ? "已剪切（移动）" : "已复制";
      const names = items.slice(0, 3).map((it) => it.name || basenameRemote(it.path));
      const more = items.length > 3 ? ` 等 ${items.length} 项` : items.length > 1 ? `（${items.length} 项）` : "";
      meta.textContent = `${verb}：${names.join("、")}${more} · 打开目标目录后点「粘贴到此处」`;
    }

    function syncFsBatchBar() {
      const n = adbFsChecked.size;
      if (adbFsBatch) adbFsBatch.hidden = n === 0;
      if (adbFsBatchMeta) adbFsBatchMeta.textContent = `已选 ${n} 项`;
      adbFsList?.querySelectorAll(".adb-fs-row[data-adb-entry]").forEach((row) => {
        const path = row.dataset.adbEntry || "";
        const on = adbFsChecked.has(path);
        row.classList.toggle("is-checked", on);
        const box = row.querySelector(".adb-fs-check");
        if (box) box.checked = on;
      });
    }

    function clearFsChecked() {
      adbFsChecked.clear();
      syncFsBatchBar();
    }

    function collectFsEntrySelection(row) {
      if (!row) return null;
      const path = row.dataset.adbEntry || row.dataset.adbFile || row.dataset.adbOpen || "";
      if (!path) return null;
      return {
        path,
        name: row.dataset.adbEntryName || row.dataset.adbFileName || basenameRemote(path),
        isDir: row.classList.contains("is-dir") || Boolean(row.dataset.adbOpen),
        virtual: row.classList.contains("is-virtual"),
        size: row.dataset.adbFileSize || "",
        writable: row.dataset.adbEntryWritable !== "0",
        mode: row.dataset.adbEntryMode || "",
        date: row.dataset.adbEntryDate || "",
      };
    }

    function hideFsCtxMenu() {
      const menu = $("#adb-fs-ctx");
      if (menu) menu.hidden = true;
    }

    function ensureFsCtxMenu() {
      let menu = $("#adb-fs-ctx");
      if (menu) return menu;
      menu = document.createElement("div");
      menu.id = "adb-fs-ctx";
      menu.className = "adb-fs-ctx";
      menu.hidden = true;
      menu.setAttribute("role", "menu");
      document.body.appendChild(menu);
      menu.addEventListener("click", async (e) => {
        const btn = e.target.closest("[data-adb-fs-act]");
        if (!btn || btn.disabled || btn.classList.contains("is-disabled")) return;
        e.preventDefault();
        e.stopPropagation();
        const action = btn.dataset.adbFsAct || "";
        const entry = {
          path: menu.dataset.path || "",
          name: menu.dataset.name || "",
          isDir: menu.dataset.isDir === "1",
          virtual: menu.dataset.virtual === "1",
          size: menu.dataset.size || "",
          writable: menu.dataset.writable !== "0",
          mode: menu.dataset.mode || "",
          date: menu.dataset.date || "",
        };
        hideFsCtxMenu();
        await runFsEntryAction(action, entry);
      });
      return menu;
    }

    function showFsCtxMenu(entry, clientX, clientY) {
      if (!entry) return;
      hideAppCtxMenu();
      const menu = ensureFsCtxMenu();
      menu.dataset.path = entry.path;
      menu.dataset.name = entry.name || "";
      menu.dataset.isDir = entry.isDir ? "1" : "0";
      menu.dataset.virtual = entry.virtual ? "1" : "0";
      menu.dataset.size = entry.size || "";
      menu.dataset.writable = entry.writable === false ? "0" : "1";
      menu.dataset.mode = entry.mode || "";
      menu.dataset.date = entry.date || "";
      const writable = entry.writable !== false && !entry.virtual;
      const dis = (cond) => (cond ? ` disabled title="只读路径或无写入权限"` : "");
      const bits = [];
      if (entry.virtual) {
        bits.push(`<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-fs-act="open">打开</button>`);
        bits.push(`<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-fs-act="copypath">复制路径</button>`);
        bits.push(`<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-fs-act="props">属性</button>`);
        menu.innerHTML = bits.join("");
        menu.hidden = false;
        positionFsCtxMenu(menu, clientX, clientY);
        return;
      }
      if (entry.isDir) {
        bits.push(`<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-fs-act="open">打开</button>`);
        bits.push(`<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-fs-act="downloadFolder">下载文件夹</button>`);
      } else {
        bits.push(`<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-fs-act="preview">预览</button>`);
        bits.push(`<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-fs-act="download">下载</button>`);
      }
      bits.push(`<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-fs-act="props">属性</button>`);
      bits.push(`<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-fs-act="copypath">复制路径</button>`);
      bits.push(`<button type="button" class="adb-fs-ctx-item"${dis(!writable)} role="menuitem" data-adb-fs-act="rename">重命名</button>`);
      bits.push(`<button type="button" class="adb-fs-ctx-item"${dis(!writable)} role="menuitem" data-adb-fs-act="cut">移动</button>`);
      bits.push(`<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-fs-act="copy">复制</button>`);
      bits.push(`<button type="button" class="adb-fs-ctx-item is-danger"${dis(!writable)} role="menuitem" data-adb-fs-act="delete">删除</button>`);
      menu.innerHTML = bits.join("");
      menu.hidden = false;
      positionFsCtxMenu(menu, clientX, clientY);
    }

    function positionFsCtxMenu(menu, clientX, clientY) {
      const pad = 8;
      const mw = menu.offsetWidth || 160;
      const mh = menu.offsetHeight || 200;
      let left = Number(clientX) || pad;
      let top = Number(clientY) || pad;
      left = Math.max(pad, Math.min(left, window.innerWidth - mw - pad));
      top = Math.max(pad, Math.min(top, window.innerHeight - mh - pad));
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    }

    async function runFsEntryAction(action, entry) {
      if (!entry?.path || !adbSelected) return;
      try {
        if (action === "open") {
          await loadFs(entry.path);
          return;
        }
        if (action === "preview") {
          adbFsSelected = entry.path;
          await previewAdbFile(entry.path, entry.name, entry.size);
          showFsProps(entry);
          return;
        }
        if (action === "props") {
          showFsProps(entry);
          return;
        }
        if (action === "download") {
          await downloadAdbFile(entry.path, entry.name);
          return;
        }
        if (action === "downloadFolder") {
          await downloadFolder(entry.path, entry.name);
          return;
        }
        if (action === "copypath") {
          try {
            await navigator.clipboard.writeText(entry.path);
            toast("已复制路径");
          } catch (_) {
            toast("复制失败");
          }
          return;
        }
        if (action === "rename") {
          if (entry.writable === false || entry.virtual) {
            toast("只读路径，无法重命名");
            return;
          }
          const next = window.prompt("新名称", entry.name || "");
          if (!next || !next.trim()) return;
          await adbFetch("/fs/rename", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ serial: adbSelected, path: entry.path, name: next.trim() }),
          });
          toast("已重命名");
          await loadFs(adbFsPath?.value || "/");
          return;
        }
        if (action === "cut") {
          if (entry.writable === false || entry.virtual) {
            toast("只读路径，无法移动");
            return;
          }
          setFsClipboard("cut", [{ path: entry.path, name: entry.name }]);
          toast("已准备移动，请打开目标目录后点「粘贴到此处」");
          return;
        }
        if (action === "copy") {
          setFsClipboard("copy", [{ path: entry.path, name: entry.name }]);
          toast("已复制，请打开目标目录后点「粘贴到此处」");
          return;
        }
        if (action === "delete") {
          if (entry.writable === false || entry.virtual) {
            toast("只读路径，无法删除");
            return;
          }
          if (!window.confirm(`确认删除「${entry.name || entry.path}」？此操作不可恢复。`)) return;
          await adbFetch("/fs/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ serial: adbSelected, path: entry.path }),
          });
          toast("已删除");
          await loadFs(adbFsPath?.value || "/");
        }
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    }

    function updateFsSortMeta() {
      const el = $("#adb-fs-sort-meta");
      if (!el) return;
      const labels = { name: "名称", size: "大小", date: "修改时间" };
      const arrow = adbFsSortDir > 0 ? "↑" : "↓";
      el.textContent = `排序：${labels[adbFsSortKey] || "名称"} ${arrow}`;
    }

    function sortFsEntries(entries) {
      const key = adbFsSortKey;
      const dir = adbFsSortDir;
      return [...entries].sort((a, b) => {
        const aDir = a.type === "dir" || a.virtual || a.mode === "virtual";
        const bDir = b.type === "dir" || b.virtual || b.mode === "virtual";
        if (aDir !== bDir) return aDir ? -1 : 1;
        let cmp = 0;
        if (key === "size") {
          cmp = (Number(a.size) || 0) - (Number(b.size) || 0);
        } else if (key === "date") {
          cmp = String(a.date || "").localeCompare(String(b.date || ""));
        } else {
          cmp = String(a.name || "").localeCompare(String(b.name || ""), undefined, {
            sensitivity: "base",
            numeric: true,
          });
        }
        return cmp * dir;
      });
    }

    function revokeFsThumbUrls() {
      adbFsThumbUrls.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch (_) {
          /* ignore */
        }
      });
      adbFsThumbUrls = [];
    }

    function setAdbFsView(view) {
      adbFsView = view === "grid" ? "grid" : "list";
      try {
        localStorage.setItem(ADB_STORE_FSVIEW, adbFsView);
      } catch (_) {
        /* ignore */
      }
      $("#adb-fs-view-list")?.classList.toggle("is-active", adbFsView === "list");
      $("#adb-fs-view-grid")?.classList.toggle("is-active", adbFsView === "grid");
      paintFsList();
    }

    async function loadFsThumb(img, remotePath) {
      if (!adbSelected) return;
      try {
        const res = await adbFetch(
          `/fs/download?serial=${encodeURIComponent(adbSelected)}&path=${encodeURIComponent(remotePath)}`
        );
        const blob = await res.blob();
        if (blob.size > ADB_FS_THUMB_MAX) return;
        const url = URL.createObjectURL(blob);
        adbFsThumbUrls.push(url);
        if (!img.isConnected) {
          URL.revokeObjectURL(url);
          return;
        }
        const thumb = document.createElement("img");
        thumb.className = "adb-fs-thumb";
        thumb.alt = "";
        thumb.src = url;
        img.replaceWith(thumb);
      } catch (_) {
        /* leave placeholder */
      }
    }

    function paintFsList() {
      if (!adbFsList) return;
      hideFsCtxMenu();
      revokeFsThumbUrls();
      adbFsList.classList.toggle("is-grid", adbFsView === "grid");
      const pathValue = adbFsPathCache || "/";
      const q = String($("#adb-fs-filter")?.value || "")
        .trim()
        .toLowerCase();
      let entries = adbFsEntriesCache || [];
      if (q) {
        entries = entries.filter((item) => String(item.name || "").toLowerCase().includes(q));
      }
      entries = sortFsEntries(entries);
      updateFsSortMeta();
      if (!(adbFsEntriesCache || []).length) {
        adbFsList.innerHTML = `<div class="adb-fs-empty">目录为空或无权读取</div>`;
        return;
      }
      if (!entries.length) {
        adbFsList.innerHTML = `<div class="adb-fs-empty">无匹配项（可清空筛选）</div>`;
        return;
      }
      const sortMark = (key) =>
        adbFsSortKey === key ? (adbFsSortDir > 0 ? " ↑" : " ↓") : "";
      const head = `<div class="adb-fs-head" role="row">
        <span class="adb-fs-col-check" aria-hidden="true"></span>
        <button type="button" class="adb-fs-sort" data-adb-fs-sort="name">名称${sortMark("name")}</button>
        <button type="button" class="adb-fs-sort adb-fs-col-size" data-adb-fs-sort="size">大小${sortMark("size")}</button>
        <button type="button" class="adb-fs-sort adb-fs-col-date" data-adb-fs-sort="date">修改时间${sortMark("date")}</button>
        <span class="adb-fs-col-more" aria-hidden="true"></span>
      </div>`;
      const thumbQueue = [];
      const rows = entries
        .map((item) => {
          const full = joinRemote(pathValue, item.name);
          const isDir = item.type === "dir";
          const virtual = Boolean(item.virtual || item.mode === "virtual");
          const writable = virtual ? false : item.writable !== false;
          const sizeText = virtual ? "虚拟" : isDir ? "—" : formatBytes(item.size) || "—";
          const dateText = virtual ? "—" : item.date || "—";
          const checked = !virtual && adbFsChecked.has(full) ? "checked" : "";
          const selected = adbFsSelected && adbFsSelected === full ? " is-selected" : "";
          const checkedCls = !virtual && adbFsChecked.has(full) ? " is-checked" : "";
          const sizeAttr =
            !isDir && item.size != null && Number.isFinite(Number(item.size))
              ? ` data-adb-file-size="${escapeHtml(String(item.size))}"`
              : "";
          const entryAttr = `data-adb-entry="${escapeHtml(full)}" data-adb-entry-name="${escapeHtml(item.name)}" data-adb-entry-writable="${writable ? "1" : "0"}" data-adb-entry-mode="${escapeHtml(String(item.mode || ""))}" data-adb-entry-date="${escapeHtml(String(item.date || ""))}"`;
          const rowAttr = isDir
            ? `data-adb-open="${escapeHtml(full)}" ${entryAttr}${virtual ? "" : ' draggable="true"'}`
            : `data-adb-file="${escapeHtml(full)}" data-adb-file-name="${escapeHtml(item.name)}"${sizeAttr} ${entryAttr}${virtual ? "" : ' draggable="true"'}`;
          const checkHtml = virtual
            ? `<span class="adb-fs-col-check"></span>`
            : `<input type="checkbox" class="adb-fs-check" data-adb-check-path="${escapeHtml(full)}" aria-label="选择 ${escapeHtml(item.name)}" ${checked} />`;
          const moreHtml = virtual
            ? `<span class="adb-fs-col-more"></span>`
            : `<button type="button" class="adb-fs-more" data-adb-fs-more aria-label="更多操作" title="更多操作">⋯</button>`;
          const nameHtml = isDir
            ? `<span class="adb-fs-name">${escapeHtml(item.name)}/</span>`
            : `<span class="adb-fs-name mono">${escapeHtml(item.name)}</span>`;
          const isImage = !isDir && !virtual && classifyAdbPreview(item.name) === "image";
          const canThumb = isImage && Number(item.size) > 0 && Number(item.size) <= ADB_FS_THUMB_MAX;
          const thumbId = `fst-${thumbQueue.length}-${Math.random().toString(36).slice(2, 7)}`;
          if (adbFsView === "grid" && canThumb) thumbQueue.push({ id: thumbId, path: full });
          const thumbHtml =
            adbFsView === "grid"
              ? isDir
                ? `<span class="adb-fs-thumb-ph" aria-hidden="true">📁</span>`
                : canThumb
                  ? `<span class="adb-fs-thumb-ph" id="${thumbId}" data-adb-fs-thumb aria-hidden="true">…</span>`
                  : `<span class="adb-fs-thumb-ph" aria-hidden="true">${virtual ? "📦" : "📄"}</span>`
              : "";
          return `<div class="adb-fs-row${isDir ? " is-dir" : " is-file"}${virtual ? " is-virtual" : ""}${writable ? "" : " is-readonly"}${selected}${checkedCls}" ${rowAttr}>
            ${checkHtml}
            ${thumbHtml}
            <div class="adb-fs-col-name">${nameHtml}</div>
            <span class="adb-fs-col-size mono">${escapeHtml(sizeText)}</span>
            <span class="adb-fs-col-date mono">${escapeHtml(dateText)}</span>
            ${moreHtml}
          </div>`;
        })
        .join("");
      adbFsList.innerHTML = head + rows;
      syncFsBatchBar();
      if (adbFsView === "grid") {
        thumbQueue.forEach(({ id, path }) => {
          const el = document.getElementById(id);
          if (el) loadFsThumb(el, path);
        });
      }
    }

    function renderFsEntries(pathValue, entries) {
      if (!adbFsList) return;
      adbFsSelected = "";
      clearFsChecked();
      clearAdbFsPreview();
      hideFsCtxMenu();
      adbFsPathCache = pathValue || "/";
      adbFsEntriesCache = Array.isArray(entries) ? entries : [];
      paintFsList();
    }

    function joinLocalPath(dir, name) {
      const d = String(dir || "");
      if (!d) return name;
      return /[\\/]$/.test(d) ? `${d}${name}` : `${d}/${name}`;
    }

    function parentOfLocalPath(p) {
      const s = String(p || "").replace(/[\\/]+$/, "");
      const idx = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
      if (idx < 0) return s;
      return s.slice(0, idx) || s.slice(0, 1);
    }

    function syncLocalPushBtn() {
      const btn = $("#adb-fs-local-push");
      if (!btn) return;
      btn.disabled = !adbLocalChecked.size || !adbSelected || !adbFsDirWritable;
    }

    function renderLocalRoots() {
      const el = $("#adb-fs-local-roots");
      if (!el) return;
      el.innerHTML = adbLocalRoots
        .map(
          (r) =>
            `<button type="button" class="ghost-btn" data-adb-local-root="${escapeHtml(r.path)}">${escapeHtml(r.name || r.path)}</button>`
        )
        .join("");
    }

    function renderLocalList() {
      const el = $("#adb-fs-local-list");
      if (!el) return;
      if (!adbLocalEntries.length) {
        el.innerHTML = `<div class="adb-fs-empty">空文件夹</div>`;
        return;
      }
      const sorted = [...adbLocalEntries].sort((a, b) => {
        if (a.type === "dir" && b.type !== "dir") return -1;
        if (a.type !== "dir" && b.type === "dir") return 1;
        return String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
      });
      el.innerHTML = sorted
        .map((item) => {
          const full = joinLocalPath(adbLocalPath, item.name);
          const isDir = item.type === "dir";
          const checked = adbLocalChecked.has(full) ? "checked" : "";
          const checkedCls = adbLocalChecked.has(full) ? " is-checked" : "";
          const label = isDir ? `${item.name}/` : item.name;
          const sizeText = isDir ? "" : formatBytes(item.size) || "";
          return `<div class="adb-fs-local-row${checkedCls}" data-adb-local-path="${escapeHtml(full)}" data-adb-local-name="${escapeHtml(item.name)}" data-adb-local-dir="${isDir ? "1" : "0"}" draggable="true">
            <input type="checkbox" class="adb-fs-check" data-adb-local-check="${escapeHtml(full)}" aria-label="选择 ${escapeHtml(item.name)}" ${checked} />
            <span class="adb-fs-name${isDir ? "" : " mono"}"${isDir ? ` data-adb-local-open="${escapeHtml(full)}"` : ""}>${escapeHtml(label)}</span>
            <span class="hint tight mono">${escapeHtml(sizeText)}</span>
          </div>`;
        })
        .join("");
    }

    async function loadLocalRoots() {
      try {
        const data = await adbFetch("/local/roots");
        adbLocalRoots = data.roots || [];
        renderLocalRoots();
        let preferred = "";
        try {
          preferred = String(localStorage.getItem(ADB_STORE_LOCAL_PATH) || "").trim();
        } catch (_) {
          preferred = "";
        }
        if (preferred) {
          await loadLocalPath(preferred);
          if (adbLocalPath) return;
        }
        if (!adbLocalPath && adbLocalRoots.length) {
          await loadLocalPath(adbLocalRoots[0].path);
        } else {
          syncLocalSaveMeta();
        }
      } catch (err) {
        const meta = $("#adb-fs-local-meta");
        if (meta) meta.textContent = "本机浏览不可用：" + (err.message || String(err));
      }
    }

    async function loadLocalPath(p) {
      if (adbLocalBusy) return;
      adbLocalBusy = true;
      const meta = $("#adb-fs-local-meta");
      if (meta) meta.textContent = "加载中…";
      try {
        const data = await adbFetch(`/local/list?path=${encodeURIComponent(p)}`);
        adbLocalPath = data.path || p;
        adbLocalEntries = data.entries || [];
        adbLocalChecked.clear();
        if ($("#adb-fs-local-path")) $("#adb-fs-local-path").value = adbLocalPath;
        try {
          localStorage.setItem(ADB_STORE_LOCAL_PATH, adbLocalPath);
        } catch (_) {
          /* ignore */
        }
        renderLocalList();
        syncLocalSaveMeta();
        syncLocalPushBtn();
      } catch (err) {
        if ($("#adb-fs-local-list")) {
          $("#adb-fs-local-list").innerHTML = `<div class="adb-fs-empty">${escapeHtml(err.message || String(err))}</div>`;
        }
        if (meta) meta.textContent = err.message || "读取失败";
      } finally {
        adbLocalBusy = false;
      }
    }

    function renderApps() {
      if (!adbAppsList) return;
      const q = String($("#adb-apps-filter")?.value || "")
        .trim()
        .toLowerCase();
      const list = adbApps.filter((app) => {
        if (!q) return true;
        return (
          app.packageName.toLowerCase().includes(q) ||
          String(app.label || "")
            .toLowerCase()
            .includes(q)
        );
      });
      if (adbAppsMeta) {
        const resolved = adbApps.filter((a) => a.label && a.label !== a.packageName).length;
        adbAppsMeta.textContent = `${list.length}/${adbApps.length} · 应用名 ${resolved}/${adbApps.length} · ${
          adbSelected || "未选择"
        }`;
      }
      if (!list.length) {
        adbAppsList.innerHTML = `<div class="adb-fs-empty">无匹配应用</div>`;
        return;
      }
      adbAppsList.innerHTML = list
        .slice(0, 400)
        .map((app) => {
          const kind = app.isSystem ? "系统" : "三方";
          const pkg = escapeHtml(app.packageName);
          const hasLabel = Boolean(app.label && app.label !== app.packageName);
          const title = escapeHtml(hasLabel ? app.label : app.packageName);
          const checked = adbPermPackage === app.packageName ? "checked" : "";
          return `<div class="adb-fs-row adb-app-row" data-adb-app-pkg="${pkg}">
            <label class="adb-app-select">
              <input type="checkbox" data-adb-app-check="${pkg}" ${checked} />
              <span>
                <strong>${title}</strong>
                <div class="adb-fs-meta mono">${pkg}</div>
                <div class="adb-fs-meta">${kind}${
                  hasLabel ? "" : " · 未解析应用名"
                }${app.apkPath ? ` · ${escapeHtml(app.apkPath)}` : ""}</div>
              </span>
            </label>
            <div class="adb-app-actions">
              <button type="button" class="primary-btn" data-adb-app-open="${pkg}">打开</button>
              <button type="button" class="secondary-btn" data-adb-app-info="${pkg}">详情</button>
              <button type="button" class="ghost-btn" data-adb-app-uninstall="${pkg}">卸载</button>
            </div>
          </div>`;
        })
        .join("");
      if (list.length > 400) {
        adbAppsList.insertAdjacentHTML(
          "beforeend",
          `<div class="adb-fs-empty">仅显示前 400 条，请用过滤缩小范围</div>`
        );
      }
    }

    function hideAppCtxMenu() {
      const menu = $("#adb-app-ctx");
      if (menu) menu.hidden = true;
    }

    function ensureAppCtxMenu() {
      let menu = $("#adb-app-ctx");
      if (menu) return menu;
      menu = document.createElement("div");
      menu.id = "adb-app-ctx";
      menu.className = "adb-fs-ctx adb-app-ctx";
      menu.hidden = true;
      menu.setAttribute("role", "menu");
      document.body.appendChild(menu);
      menu.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-adb-app-act]");
        if (!btn) return;
        e.preventDefault();
        const pkg = menu.dataset.pkg || "";
        const act = btn.dataset.adbAppAct || "";
        hideAppCtxMenu();
        if (pkg && act) runAppRowAction(act, pkg).catch((err) => setError(adbError, err.message || String(err)));
      });
      return menu;
    }

    function showAppCtxMenu(pkg, clientX, clientY) {
      if (!pkg) return;
      const menu = ensureAppCtxMenu();
      menu.dataset.pkg = pkg;
      menu.innerHTML = [
        `<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-app-act="open">打开</button>`,
        `<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-app-act="info">详情</button>`,
        `<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-app-act="stop">强停</button>`,
        `<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-app-act="clear">清数据</button>`,
        `<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-app-act="backup">备份</button>`,
        `<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-app-act="disable">停用</button>`,
        `<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-app-act="enable">启用</button>`,
        `<button type="button" class="adb-fs-ctx-item is-danger" role="menuitem" data-adb-app-act="uninstall">卸载</button>`,
      ].join("");
      menu.hidden = false;
      const pad = 8;
      const rect = menu.getBoundingClientRect();
      let left = clientX;
      let top = clientY;
      if (left + rect.width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - rect.width - pad);
      if (top + rect.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - rect.height - pad);
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
    }

    async function runAppRowAction(act, pkg) {
      const packageName = String(pkg || "").trim();
      if (!packageName || !adbSelected) return;
      if (act === "open") {
        await adbFetch("/apps/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serial: adbSelected, packageName, action: "open" }),
        });
        toast("已尝试打开应用");
        return;
      }
      if (act === "info") {
        await showAppInfo(packageName);
        return;
      }
      if (act === "stop") {
        await adbFetch("/apps/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serial: adbSelected, packageName, action: "force-stop" }),
        });
        toast("已强制停止");
        return;
      }
      if (act === "clear") {
        if (!window.confirm(`确认清除 ${packageName} 的数据？`)) return;
        await adbFetch("/apps/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serial: adbSelected, packageName, action: "clear" }),
        });
        toast("已清除数据");
        return;
      }
      if (act === "backup") {
        const data = await adbFetch("/apps/backup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serial: adbSelected, packageName, async: true }),
        });
        await trackJob(data.job);
        return;
      }
      if (act === "disable") {
        if (!window.confirm(`确认停用 ${packageName}？`)) return;
        await adbFetch("/apps/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serial: adbSelected, packageName, action: "disable" }),
        });
        toast("已请求停用");
        return;
      }
      if (act === "enable") {
        await adbFetch("/apps/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serial: adbSelected, packageName, action: "enable" }),
        });
        toast("已请求启用");
        return;
      }
      if (act === "uninstall") {
        if (!window.confirm(`确认卸载 ${packageName}？此操作不可恢复。`)) return;
        await adbFetch("/apps/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serial: adbSelected, packageName, action: "uninstall" }),
        });
        toast("已请求卸载");
        await loadApps();
      }
    }

    function jobTypeLabel(type) {
      return (
        {
          install: "安装 APK",
          screenshot: "截图",
          record: "录屏",
          backup: "备份 APK",
        }[type] || type
      );
    }

    function jobCardHtml(job) {
      const items = (job.items || [])
        .map((it) => `<li>${escapeHtml(it.serial || "")}: ${escapeHtml(it.status)} ${escapeHtml(it.message || "")}</li>`)
        .join("");
      const arts = (job.artifacts || [])
        .map(
          (a) =>
            `<button type="button" class="secondary-btn" data-adb-art-job="${escapeHtml(job.id)}" data-adb-art-name="${escapeHtml(a.name)}">下载 ${escapeHtml(a.name)}</button>`
        )
        .join("");
      const running = job.status === "running" || job.status === "pending" || job.status === "queued";
      const cancelBtn = running
        ? `<button type="button" class="ghost-btn" data-adb-job-cancel="${escapeHtml(job.id)}">取消</button>`
        : "";
      const zipBtn =
        (job.artifacts || []).length > 0
          ? `<button type="button" class="ghost-btn" data-adb-job-zip="${escapeHtml(job.id)}">打包下载全部</button>`
          : "";
      return `<div class="adb-job" data-adb-job-id="${escapeHtml(job.id)}">
        <div class="adb-job-head">
          <strong>${escapeHtml(jobTypeLabel(job.type))} · ${escapeHtml(job.status)}</strong>
          <span>${escapeHtml(String(job.progress || 0))}%</span>
        </div>
        <div class="gif-progress" style="margin-top:0.45rem">
          <div class="gif-progress-track"><span class="gif-progress-fill" style="width:${Number(job.progress) || 0}%"></span></div>
        </div>
        <p class="adb-job-msg">${escapeHtml(job.message || job.error || "")}</p>
        ${items ? `<ul class="adb-job-items">${items}</ul>` : ""}
        <div class="adb-job-arts">${cancelBtn}${zipBtn}${arts}</div>
      </div>`;
    }

    function renderInlineJobs() {
      const mediaEl = $("#adb-media-jobs");
      if (mediaEl) {
        const preferred = (adbJobs || []).filter(
          (j) => (j.type === "screenshot" || j.type === "record") && adbTrackedJobs.has(j.id)
        );
        const fallback = (adbJobs || [])
          .filter((j) => j.type === "screenshot" || j.type === "record")
          .slice(0, 2);
        const finalList = preferred.length ? preferred.slice(0, 6) : fallback;
        mediaEl.innerHTML = finalList.length
          ? finalList.map(jobCardHtml).join("")
          : `<div class="hint tight">截图/录屏任务会显示在这里，可直接预览下载</div>`;
      }

      const installEl = $("#adb-install-jobs");
      if (installEl) {
        const preferred = (adbJobs || []).filter((j) => j.type === "install" && adbTrackedJobs.has(j.id));
        const fallback = (adbJobs || []).filter((j) => j.type === "install").slice(0, 2);
        const finalList = preferred.length ? preferred.slice(0, 4) : fallback;
        installEl.innerHTML = finalList.length ? finalList.map(jobCardHtml).join("") : "";
      }
    }

    function renderJobs(jobs) {
      if (!adbJobsList) return;
      adbJobs = jobs || [];
      if (!jobs?.length) {
        adbJobsList.innerHTML = `<div class="adb-fs-empty">暂无任务</div>`;
        if (adbJobsMeta) adbJobsMeta.textContent = "暂无任务";
        renderInlineJobs();
        updateMediaPreviewFromJobs(jobs);
        return;
      }
      if (adbJobsMeta) adbJobsMeta.textContent = `${jobs.length} 条最近任务`;
      adbJobsList.innerHTML = jobs.map(jobCardHtml).join("");
      renderInlineJobs();
      updateMediaPreviewFromJobs(jobs);
    }

    function updateMediaPreviewFromJobs(jobs) {
      if ($("#adb-media-meta")) {
        const arts = (jobs || []).reduce((n, j) => n + ((j.artifacts || []).length || 0), 0);
        const running = (jobs || []).filter((j) => j.status === "running" || j.status === "pending").length;
        $("#adb-media-meta").textContent = running
          ? `${running} 个任务进行中 · 产物 ${arts}`
          : arts
            ? `可预览/打包 · 产物 ${arts}`
            : "截图支持多设备；录屏针对当前设备";
      }
      const preview = $("#adb-media-preview");
      if (!preview) return;
      const shot = (jobs || []).find(
        (j) =>
          j.type === "screenshot" &&
          (j.status === "done" || j.status === "completed" || j.status === "success") &&
          (j.artifacts || []).some((a) => /\.png$/i.test(a.name || ""))
      );
      if (!shot) return;
      const art = (shot.artifacts || []).find((a) => /\.png$/i.test(a.name || ""));
      if (!art) return;
      if (preview.dataset.adbPreviewJob === shot.id && preview.dataset.adbPreviewName === art.name) return;
      preview.dataset.adbPreviewJob = shot.id;
      preview.dataset.adbPreviewName = art.name;
      adbFetch(`/jobs/${encodeURIComponent(shot.id)}/artifact/${encodeURIComponent(art.name)}`)
        .then((res) => res.blob())
        .then((blob) => {
          const url = URL.createObjectURL(blob);
          const others = (shot.artifacts || [])
            .map(
              (a) =>
                `<button type="button" class="secondary-btn" data-adb-art-job="${escapeHtml(shot.id)}" data-adb-art-name="${escapeHtml(a.name)}">下载 ${escapeHtml(a.name)}</button>`
            )
            .join("");
          preview.innerHTML = `<img alt="截图预览" src="${url}" /><div class="adb-job-arts" style="margin-top:0.55rem">${others}<button type="button" class="ghost-btn" data-adb-job-zip="${escapeHtml(shot.id)}">打包下载全部</button></div>`;
          preview.hidden = false;
        })
        .catch(() => {});
    }

    async function loadAdbInfo(serial) {
      if (!serial) {
        fillAdbInfo(null);
        return;
      }
      try {
        const data = await adbFetch(`/device/info?serial=${encodeURIComponent(serial)}`);
        fillAdbInfo(data.info);
      } catch (err) {
        fillAdbInfo({ serial, state: "error", ready: false, message: err.message || String(err) });
        setError(adbError, err.message || String(err));
      }
    }

    function updateHostToolsProbe(health) {
      adbBridgeFeatures = Array.isArray(health?.features) ? health.features.slice() : [];
      adbBridgeVersion = health?.version ? String(health.version) : "";
      const el = $("#adb-tools-probe");
      if (!el) return;
      const tools = health?.tools || {};
      const bits = ["adb", "keytool", "apksigner", "openssl", "aapt"]
        .map((name) => {
          const t = tools[name];
          if (!t) return null;
          const pathHint = t.ok && t.path ? `（${String(t.path).split(/[/\\]/).slice(-2).join("/")}）` : "";
          return `${name}${t.ok ? "✓" : "✗"}${name === "keytool" && t.ok ? pathHint : ""}`;
        })
        .filter(Boolean);
      const ver = health?.version ? `桥 ${health.version}` : "";
      const setupBits = [];
      if (health?.setup?.adb) setupBits.push(health.setup.adb);
      if (health?.setup?.signing) setupBits.push(health.setup.signing);
      el.textContent = [
        bits.length ? `本机工具：${bits.join(" · ")}` : "连接桥后显示本机工具探测",
        ver,
        setupBits.length ? setupBits.join(" ") : "",
      ]
        .filter(Boolean)
        .join(" · ");
      const signGuide = $("#adb-signing-guide");
      if (signGuide) {
        const signingOk =
          health?.signingOk === true ||
          tools.keytool?.ok ||
          tools.apksigner?.ok ||
          tools.openssl?.ok;
        // Show guide when connected and signing tools missing; keep hidden until we know
        if (health?.tools) signGuide.hidden = Boolean(signingOk);
      }
      syncLocalSaveMeta();
      applyAdbFeatureGates(health);
    }

    function bridgeHas(feature) {
      return adbBridgeFeatures.includes(feature);
    }

    function bridgeAtLeast(ver) {
      const cur = String(adbBridgeVersion || "")
        .split(".")
        .map((n) => Number(n) || 0);
      const need = String(ver || "")
        .split(".")
        .map((n) => Number(n) || 0);
      for (let i = 0; i < Math.max(cur.length, need.length); i++) {
        const a = cur[i] || 0;
        const b = need[i] || 0;
        if (a > b) return true;
        if (a < b) return false;
      }
      return true;
    }

    function applyAdbFeatureGates(health) {
      const connected = Boolean(health?.version);
      const bundle = $("#adb-dl-bundle");
      if (bundle) bundle.classList.toggle("is-hidden", connected);

      const inputRefresh = $("#adb-input-refresh-shot");
      const inputLive = $("#adb-input-live-stop");
      const canInput = !health || bridgeHas("screencap") || bridgeHas("input") || bridgeAtLeast("0.6.8");
      if (inputRefresh) {
        inputRefresh.disabled = Boolean(health) && !canInput;
        inputRefresh.title = canInput ? "" : "当前桥版本过旧，请更新到 ≥0.6.8";
      }
      if (inputLive && !canInput) inputLive.hidden = true;

      const analyzeBtn = $("#adb-apk-analyze");
      const canSign = !health || bridgeHas("apk-signing") || bridgeHas("apk-info") || bridgeAtLeast("0.6.10");
      if (analyzeBtn) {
        analyzeBtn.title = canSign ? "" : "签名分析需桥 ≥0.6.10";
      }

      const logLevel = $("#adb-log-level");
      if (logLevel) {
        const ok = !health || bridgeHas("logcat-level") || bridgeAtLeast("0.6.12");
        logLevel.disabled = Boolean(health) && !ok;
        logLevel.title = ok ? "" : "级别过滤需桥 ≥0.6.12";
      }
    }

    function canLocalPull() {
      return Boolean(adbLocalPath) && (bridgeHas("local-pull") || bridgeAtLeast("0.6.11"));
    }

    function canFsZip() {
      return bridgeHas("fs-zip") || bridgeAtLeast("0.6.12");
    }

    function syncLocalSaveMeta() {
      const meta = $("#adb-fs-local-meta");
      if (!meta) return;
      if (!adbConnected) {
        meta.textContent = "连接桥后可设置本机目录";
        return;
      }
      if (!canLocalPull()) {
        meta.textContent = adbBridgeVersion
          ? `桥 ${adbBridgeVersion} 无本机直存，请更新 ≥0.6.11`
          : "下载落点（需桥 ≥0.6.11）";
        return;
      }
      if (!adbLocalPath) {
        meta.textContent = "请选择本机目录作为下载落点";
        return;
      }
      meta.textContent = `落点：${adbLocalPath}`;
    }

    function updateFsHistButtons() {
      const back = $("#adb-fs-back");
      const forward = $("#adb-fs-forward");
      if (back) back.disabled = adbFsHistIdx <= 0;
      if (forward) forward.disabled = adbFsHistIdx < 0 || adbFsHistIdx >= adbFsHistory.length - 1;
    }

    function pushFsHistory(path, mode) {
      if (mode === "none") {
        updateFsHistButtons();
        return;
      }
      if (mode === "replace") {
        if (adbFsHistIdx >= 0) adbFsHistory[adbFsHistIdx] = path;
        else {
          adbFsHistory = [path];
          adbFsHistIdx = 0;
        }
        updateFsHistButtons();
        return;
      }
      if (adbFsHistIdx >= 0 && adbFsHistory[adbFsHistIdx] === path) {
        updateFsHistButtons();
        return;
      }
      adbFsHistory = adbFsHistory.slice(0, adbFsHistIdx + 1);
      adbFsHistory.push(path);
      adbFsHistIdx = adbFsHistory.length - 1;
      updateFsHistButtons();
    }

    function resetFsHistory() {
      adbFsHistory = [];
      adbFsHistIdx = -1;
      updateFsHistButtons();
    }

    function updateFsWriteState() {
      const uploadInput = $("#adb-fs-upload");
      const uploadDirInput = $("#adb-fs-upload-dir");
      const mkdirBtn = $("#adb-fs-mkdir");
      const pasteBtn = $("#adb-fs-paste");
      const writable = adbFsDirWritable !== false;
      [uploadInput, uploadDirInput].forEach((input) => {
        if (!input) return;
        input.disabled = !writable;
        const label = input.id ? document.querySelector(`label[for="${input.id}"]`) : null;
        if (label) label.classList.toggle("is-disabled", !writable);
      });
      if (mkdirBtn) mkdirBtn.disabled = !writable;
      if (pasteBtn) pasteBtn.disabled = !writable || !clipboardItems().length;
      syncLocalPushBtn();
    }

    async function loadFs(pathValue, { history = "push" } = {}) {
      if (!adbSelected) {
        toast("请先选择设备");
        return;
      }
      const pathText = pathValue || adbFsPath?.value || "/";
      if (adbFsPath) adbFsPath.value = pathText;
      const filterEl = $("#adb-fs-filter");
      if (filterEl && filterEl.value) filterEl.value = "";
      renderFsCrumbs(pathText);
      if (adbFsMeta) adbFsMeta.textContent = "加载中…";
      const accessEl = $("#adb-fs-access");
      if (accessEl) {
        accessEl.hidden = true;
        accessEl.textContent = "";
      }
      try {
        const data = await adbFetch(
          `/fs/list?serial=${encodeURIComponent(adbSelected)}&path=${encodeURIComponent(pathText)}`
        );
        const resolved = data.path || pathText;
        adbFsDirWritable = data.writable !== false;
        renderFsEntries(resolved, data.entries || []);
        if (adbFsPath) adbFsPath.value = resolved;
        renderFsCrumbs(resolved);
        pushFsHistory(resolved, history);
        updateFsWriteState();
        if (adbFsMeta) {
          const total = (data.entries || []).length;
          adbFsMeta.textContent = `${total} 项 · ${resolved}${adbFsDirWritable ? "" : " · 只读"}`;
        }
        if (accessEl && (data.access || data.note)) {
          accessEl.hidden = false;
          accessEl.textContent = [data.access && `访问方式：${data.access}`, data.note]
            .filter(Boolean)
            .join(" · ");
        }
        setError(adbError, "");
      } catch (err) {
        adbFsEntriesCache = [];
        adbFsPathCache = pathText;
        if (adbFsList) adbFsList.innerHTML = `<div class="adb-fs-empty">${escapeHtml(err.message || String(err))}</div>`;
        if (adbFsMeta) adbFsMeta.textContent = "读取失败";
        setError(adbError, err.message || String(err));
      }
    }

    async function loadApps() {
      if (!adbSelected) return;
      if (adbAppsMeta) adbAppsMeta.textContent = "加载应用名中…（首次可能较慢）";
      const kind = $("#adb-apps-kind")?.value || "third";
      const data = await adbFetch(
        `/apps?serial=${encodeURIComponent(adbSelected)}&kind=${encodeURIComponent(kind)}`
      );
      adbApps = data.apps || [];
      const resolved =
        data.labelResolved != null
          ? Number(data.labelResolved)
          : adbApps.filter((a) => a.label && a.label !== a.packageName).length;
      if (adbAppsMeta) {
        adbAppsMeta.textContent = `${adbApps.length} 个 · 应用名 ${resolved}/${adbApps.length} · ${
          adbSelected || "未选择"
        }`;
      }
      renderApps();
      if (data.labelNote) {
        const tip = $("#adb-apps-label-tip");
        if (tip) {
          tip.hidden = false;
          tip.textContent = data.labelNote;
        } else if (resolved < Math.min(3, adbApps.length)) {
          toast(data.labelNote);
        }
      } else {
        const tip = $("#adb-apps-label-tip");
        if (tip) tip.hidden = true;
      }
    }

    async function loadSnapshot({ silent = false } = {}) {
      const serial = requireCurrentSerial();
      const snapMeta = $("#adb-snap-meta");
      const out = $("#adb-snap-out");
      if (snapMeta) snapMeta.textContent = "加载中…";
      const data = await adbFetch(`/device/snapshot?serial=${encodeURIComponent(serial)}`);
      const text = [
        `前台:\n${data.foreground || "—"}`,
        `uptime: ${data.uptime || "—"}`,
        `屏幕常亮(stay_on_while_plugged_in): ${data.stayOnWhilePluggedIn || "—"}`,
        `\n磁盘:\n${data.disk || "—"}`,
        `\n内存:\n${data.meminfo || "—"}`,
        `\n进程:\n${data.top || "—"}`,
      ].join("\n");
      if (out) out.textContent = text;
      if (snapMeta) snapMeta.textContent = "已更新";
      if (!silent) toast("快照已刷新");
    }

    async function deviceControl(action) {
      const serial = requireCurrentSerial();
      const data = await adbFetch("/device/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial, action }),
      });
      toast(data.message || "已执行");
      return data;
    }

    async function fetchLogcat({ silent = false } = {}) {
      const serial = requireCurrentSerial();
      const lines = Number($("#adb-log-lines")?.value || 400);
      const packageName = String($("#adb-log-package")?.value || "").trim();
      const query = String($("#adb-log-query")?.value || "").trim();
      const tag = String($("#adb-log-tag")?.value || "").trim();
      const level = String($("#adb-log-level")?.value || "").trim();
      const params = new URLSearchParams({
        serial,
        lines: String(lines),
      });
      if (packageName) params.set("package", packageName);
      if (query) params.set("query", query);
      if (tag) params.set("tag", tag);
      if (level) params.set("level", level);
      if (!silent && $("#adb-log-meta")) $("#adb-log-meta").textContent = "拉取中…";
      const data = await adbFetch(`/logcat?${params.toString()}`);
      if ($("#adb-log-out")) $("#adb-log-out").textContent = data.text || "(无日志)";
      const note = data.note ? ` · ${data.note}` : "";
      if ($("#adb-log-meta")) {
        $("#adb-log-meta").textContent = `${adbLogLive ? "实时" : "已拉取"} ${data.lines || 0} 行${note}`;
      }
      if ($("#adb-log-note") && data.note) $("#adb-log-note").textContent = data.note;
      return data;
    }

    function stopAdbLogLive() {
      adbLogLive = false;
      clearInterval(adbLogLiveTimer);
      adbLogLiveTimer = 0;
      const live = $("#adb-log-live");
      if (live) {
        if (live.type === "checkbox") live.checked = false;
        else live.classList.remove("is-active");
      }
    }

    function startAdbLogLive() {
      adbLogLive = true;
      clearInterval(adbLogLiveTimer);
      const live = $("#adb-log-live");
      if (live) {
        if (live.type === "checkbox") live.checked = true;
        else live.classList.add("is-active");
      }
      fetchLogcat({ silent: true }).catch((err) => setError(adbError, err.message || String(err)));
      adbLogLiveTimer = setInterval(() => {
        if (!adbLogLive || adbTab !== "logcat") {
          stopAdbLogLive();
          return;
        }
        fetchLogcat({ silent: true }).catch(() => {});
      }, 2000);
    }

    function toggleAdbLogLive(force) {
      const next = force == null ? !adbLogLive : Boolean(force);
      if (next) startAdbLogLive();
      else stopAdbLogLive();
    }

    async function selectAdbDevice(serial) {
      adbSelected = serial;
      renderAdbDevices();
      resetFsHistory();
      await loadAdbInfo(serial);
      await loadFs("/");
      if (adbTab === "apps") await loadApps();
      if (adbTab === "info") await loadSnapshot({ silent: true }).catch(() => {});
    }

    async function refreshAdbDevices({ silent = false } = {}) {
      const data = await adbFetch("/devices");
      adbDevices = data.devices || [];
      const serialSet = new Set(adbDevices.map((d) => d.serial));
      adbChecked = new Set([...adbChecked].filter((s) => serialSet.has(s)));
      if (!adbSelected || !serialSet.has(adbSelected)) {
        const ready = adbDevices.find((d) => d.state === "device");
        adbSelected = (ready || adbDevices[0] || {}).serial || "";
      }
      if (!adbChecked.size && adbSelected) adbChecked.add(adbSelected);
      renderAdbDevices();
      if (adbSelected) {
        await loadAdbInfo(adbSelected);
        resetFsHistory();
        await loadFs(adbFsPath?.value || "/");
      } else {
        fillAdbInfo(null);
        if (adbFsList) adbFsList.innerHTML = `<div class="adb-fs-empty">请选择设备</div>`;
      }
      const adbLine = data.adb?.version || "adb ok";
      setAdbStatus(
        adbDevices.length ? "is-ok" : "is-warn",
        adbDevices.length ? `已连接 · ${adbDevices.length} 台设备` : "已连接桥 · 无设备",
        `${adbLine}。支持文件 / 安装 / 应用 / 截图录屏。`
      );
      if (!silent) toast(adbDevices.length ? `已刷新 ${adbDevices.length} 台设备` : "桥已连接，未发现设备");
    }

    async function connectAdbBridge({ fromPoll = false } = {}) {
      persistAdbSettings();
      setError(adbError, "");
      try {
        const health = await adbFetch("/health", { auth: false });
        updateHostToolsProbe(health);
        if (!health.adb?.ok) {
          adbConnected = true;
          if (adbWorkspace) adbWorkspace.hidden = true;
          if ($("#adb-refresh")) $("#adb-refresh").disabled = true;
          const setupMsg =
            health.setup?.adb ||
            health.adb?.setup ||
            "请安装 platform-tools 并确保 adb 在 PATH 中，然后重启桥";
          setAdbStatus("is-err", "桥已启动，但未找到 adb", setupMsg);
          setError(adbError, health.adb?.error || "本机未找到 adb 命令。见上方「本机依赖怎么配？」");
          return false;
        }
        adbConnected = true;
        if (adbWorkspace) adbWorkspace.hidden = false;
        if ($("#adb-refresh")) $("#adb-refresh").disabled = false;
        await refreshAdbDevices({ silent: fromPoll });
        if (!adbLocalRoots.length) loadLocalRoots().catch(() => {});
        return true;
      } catch (err) {
        adbConnected = false;
        if (adbWorkspace) adbWorkspace.hidden = true;
        if ($("#adb-refresh")) $("#adb-refresh").disabled = true;
        updateHostToolsProbe(null);
        setAdbStatus(
          "is-err",
          "未连接本机桥",
          fromPoll
            ? "已下载完整包的话，请解压并运行启动脚本（同目录需有 server.js），保持窗口打开；正在等待桥启动…"
            : "请先下载完整 ZIP 并运行启动脚本，再点连接。需本机已安装 adb（见上方配置说明）。"
        );
        if (!fromPoll) setError(adbError, err.message || "无法连接本机桥");
        return false;
      }
    }

    function startAdbWaitPoll() {
      clearInterval(adbPollTimer);
      let tries = 0;
      adbPollTimer = setInterval(async () => {
        tries += 1;
        const ok = await connectAdbBridge({ fromPoll: true });
        if (ok || tries >= 60) clearInterval(adbPollTimer);
      }, 2000);
    }

    function downloadBlobFile(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    async function fetchTextAsset(path) {
      const res = await fetch(path, { cache: "no-cache" });
      if (!res.ok) throw new Error(`无法读取 ${path}（${res.status}）`);
      return res.text();
    }

    async function downloadAdbBridgeBundle(platform) {
      if (typeof JSZip === "undefined") throw new Error("JSZip 未加载，无法打包下载");
      const map = {
        mac: {
          scriptPath: "./adb-bridge/start-mac.command",
          scriptName: "start-adb-bridge.command",
          zipName: "devtools-adb-bridge-mac.zip",
          runHint: "解压后在终端执行：chmod +x start-adb-bridge.command && ./start-adb-bridge.command\n也可在 Finder 中双击 start-adb-bridge.command。",
        },
        win: {
          scriptPath: "./adb-bridge/start-win.bat",
          scriptName: "start-adb-bridge.bat",
          zipName: "devtools-adb-bridge-win.zip",
          runHint:
            "解压后优先双击 start-adb-bridge.cmd（更不易闪退）；也可双击 start-adb-bridge.bat。请保持窗口打开。",
        },
        linux: {
          scriptPath: "./adb-bridge/start-linux.sh",
          scriptName: "start-adb-bridge.sh",
          zipName: "devtools-adb-bridge-linux.zip",
          runHint: "解压后执行：chmod +x start-adb-bridge.sh && ./start-adb-bridge.sh",
        },
      };
      const cfg = map[platform];
      if (!cfg) throw new Error("未知平台");
      const [serverJs, scriptRaw] = await Promise.all([
        fetchTextAsset("./adb-bridge/server.js"),
        fetchTextAsset(cfg.scriptPath),
      ]);
      // Windows cmd.exe is fragile with LF-only / UTF-8 Chinese .bat files.
      const scriptText =
        platform === "win" ? String(scriptRaw).replace(/\r?\n/g, "\r\n") : scriptRaw;
      if (!/ADB_BRIDGE_TOKEN|devtools-adb-bridge|DevTools local ADB bridge/.test(serverJs)) {
        throw new Error("server.js 内容异常，请刷新页面后重试");
      }
      const readme = [
        "DevTools ADB Bridge 完整包",
        "",
        "本压缩包必须同时保留：",
        "  - server.js          （桥接服务，缺它会提示找不到 server.js）",
        "  - " + cfg.scriptName + "  （启动脚本）",
        "",
        "使用步骤：",
        "1. 解压到任意文件夹（两个文件放在同一目录）",
        "2. 本机已安装 Node.js 与 adb，并可用 adb devices",
        "3. " + cfg.runHint.replace(/\n/g, "\n   "),
        "4. 回到网页点击「连接本机桥」",
        "",
        "若窗口一闪而过：",
        "- Windows：请重新下载本完整包（已修复编码闪退）；窗口结束时会 pause",
        "- Windows 日志：%USERPROFILE%\\.devtools-adb-bridge\\last-start.log",
        "- Windows 也会复制到桌面：devtools-adb-bridge-last-start.log",
        "- macOS：chmod +x " + cfg.scriptName + " 后运行；或 bash " + cfg.scriptName,
        "- 确认未重复打开多个桥（端口占用会自动换端口并提示）",
        "",
        "默认地址 http://127.0.0.1:17888  Token: devtools-adb",
        "",
      ].join("\n");
      const zip = new JSZip();
      zip.file("server.js", serverJs);
      zip.file(cfg.scriptName, scriptText, {
        unixPermissions: platform === "win" ? undefined : 0o755,
      });
      if (platform === "win") {
        // Outer wrapper always pauses, even if the .bat hits a parser error.
        const wrapper = [
          "@echo off",
          'cd /d "%~dp0"',
          'cmd /d /c ""%~dp0start-adb-bridge.bat" & echo. & echo Log: %USERPROFILE%\\.devtools-adb-bridge\\last-start.log & echo Desktop copy: devtools-adb-bridge-last-start.log & pause"',
          "",
        ].join("\r\n");
        zip.file("start-adb-bridge.cmd", wrapper);
      }
      zip.file(platform === "win" ? "README.txt" : "使用说明.txt", readme.replace(/\r?\n/g, platform === "win" ? "\r\n" : "\n"));
      const blob = await zip.generateAsync({
        type: "blob",
        platform: platform === "win" ? "DOS" : "UNIX",
      });
      downloadBlobFile(blob, cfg.zipName);
      setAdbStatus(
        "is-warn",
        "等待本机桥启动…",
        "完整包已下载。请解压后运行启动脚本（同目录需有 server.js），并保持窗口打开；网页会自动重试连接。"
      );
      toast("已下载完整包，请解压后运行");
      startAdbWaitPoll();
    }

    function downloadAdbScriptAndWait(anchor) {
      const platform = anchor?.dataset?.adbBundle;
      if (platform) {
        downloadAdbBridgeBundle(platform).catch((err) => {
          setError(adbError, err.message || String(err));
          setAdbStatus("is-err", "下载失败", err.message || String(err));
        });
        return;
      }
      const href = anchor?.getAttribute("href");
      const filename = anchor?.getAttribute("download") || "start-adb-bridge";
      if (href) {
        const a = document.createElement("a");
        a.href = href;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      setAdbStatus("is-warn", "等待本机桥启动…", "脚本开始下载。请双击运行，并保持终端窗口打开；网页会自动重试连接。");
      toast("请运行下载的启动脚本");
      startAdbWaitPoll();
    }

    function xhrUploadFile(file, dir, filename, { signal, onProgress } = {}) {
      return new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("aborted", "AbortError"));
          return;
        }
        const xhr = new XMLHttpRequest();
        const url = `${adbBase()}/fs/upload?serial=${encodeURIComponent(adbSelected)}&path=${encodeURIComponent(dir)}&name=${encodeURIComponent(filename)}`;
        xhr.open("POST", url);
        xhr.setRequestHeader("X-Adb-Token", adbToken());
        xhr.setRequestHeader("Content-Type", "application/octet-stream");
        xhr.setRequestHeader("X-Filename", encodeURIComponent(filename));
        xhr.upload.onprogress = (e) => {
          if (onProgress) onProgress(e.loaded || 0, e.total || Number(file.size) || 0);
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
            return;
          }
          let msg = `上传失败 (${xhr.status})`;
          try {
            const data = JSON.parse(xhr.responseText);
            if (data?.error) msg = data.error;
          } catch (_) {
            /* ignore parse error */
          }
          reject(new Error(msg));
        };
        xhr.onerror = () => reject(new Error("网络错误，上传失败"));
        xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
        const onAbort = () => xhr.abort();
        if (signal) signal.addEventListener("abort", onAbort, { once: true });
        const cleanup = () => signal?.removeEventListener("abort", onAbort);
        xhr.addEventListener("loadend", cleanup);
        xhr.send(file);
      });
    }

    async function uploadAdbFiles(fileList, { relativePaths = false } = {}) {
      if (!adbSelected) return;
      const files = [...fileList];
      if (!files.length) return;
      if (!adbFsDirWritable) {
        toast("当前目录只读，无法上传");
        return;
      }
      if (adbFsXferBusy) {
        toast("已有传输进行中");
        return;
      }
      const dir = adbFsPath?.value || "/";
      setError(adbError, "");
      const totalBytes = files.reduce((sum, f) => sum + (Number(f.size) || 0), 0) || files.length;
      let doneBytes = 0;
      const started = performance.now();
      adbFsXferBusy = true;
      const controller = new AbortController();
      adbFsXferAbort = controller;
      const madeDirs = new Set();
      try {
        for (let i = 0; i < files.length; i++) {
          if (controller.signal.aborted) throw new DOMException("aborted", "AbortError");
          const file = files[i];
          const fileSize = Number(file.size) || 0;
          const relPath = (relativePaths && file.webkitRelativePath) || file.name;
          const relDir = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";
          const targetDir = relDir ? joinRemote(dir, relDir) : dir;
          const filename = basenameRemote(relPath) || file.name;
          if (relDir && !madeDirs.has(targetDir)) {
            madeDirs.add(targetDir);
            try {
              await adbFetch("/fs/mkdir", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ serial: adbSelected, path: targetDir }),
                signal: controller.signal,
              });
            } catch (_) {
              /* 目录可能已存在；若确实无权限会在上传时报错 */
            }
          }
          let lastLoaded = 0;
          updateFsXfer({
            title: `上传 ${i + 1}/${files.length}`,
            name: relPath,
            loaded: doneBytes,
            total: totalBytes,
            started,
          });
          await xhrUploadFile(file, targetDir, filename, {
            signal: controller.signal,
            onProgress: (loaded) => {
              doneBytes += loaded - lastLoaded;
              lastLoaded = loaded;
              updateFsXfer({
                title: `上传 ${i + 1}/${files.length}`,
                name: relPath,
                loaded: Math.min(doneBytes, totalBytes),
                total: totalBytes,
                started,
              });
            },
          });
          doneBytes += Math.max(0, fileSize - lastLoaded);
        }
        toast(`已上传 ${files.length} 个文件`);
        await loadFs(dir, { history: "replace" });
      } catch (err) {
        if (err?.name === "AbortError") {
          toast("已取消上传");
          await loadFs(dir, { history: "replace" }).catch(() => {});
        } else {
          throw err;
        }
      } finally {
        adbFsXferBusy = false;
        adbFsXferAbort = null;
        hideFsXfer();
      }
    }

    async function pullRemoteToLocalDir(remotePath, name, { signal } = {}) {
      if (!canLocalPull()) throw new Error("本机直存不可用");
      return adbFetch("/local/pull", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serial: adbSelected,
          remotePath,
          localDir: adbLocalPath,
          name: name || basenameRemote(remotePath),
        }),
        signal,
      });
    }

    async function downloadAdbFile(remotePath, name, { nested = false, signal: parentSignal } = {}) {
      if (!adbSelected) return;
      let controller = null;
      if (!nested) {
        if (adbFsXferBusy) {
          toast("已有传输进行中");
          return;
        }
        adbFsXferBusy = true;
        controller = new AbortController();
        adbFsXferAbort = controller;
      }
      const signal = parentSignal || controller?.signal;
      const started = performance.now();
      try {
        updateFsXfer({ title: nested ? "批量下载" : "下载中", name: name || remotePath, loaded: 0, total: 0, started });
        if (adbFsMeta) adbFsMeta.textContent = `下载中：${name || remotePath}`;
        if (canLocalPull()) {
          const data = await pullRemoteToLocalDir(remotePath, name, { signal });
          updateFsXfer({
            title: nested ? "批量下载" : "已保存到本机",
            name: data.localPath || name || remotePath,
            loaded: data.size || 1,
            total: data.size || 1,
            started,
          });
          if (!nested) toast(`已保存到 ${data.localPath || adbLocalPath}`);
          if (adbFsMeta) adbFsMeta.textContent = `已保存 ${name || ""} → ${adbLocalPath}`;
          loadLocalPath(adbLocalPath).catch(() => {});
          return data;
        }
        const res = await adbFetch(
          `/fs/download?serial=${encodeURIComponent(adbSelected)}&path=${encodeURIComponent(remotePath)}`,
          signal ? { signal } : {}
        );
        const total = Number(res.headers.get("content-length")) || 0;
        let blob;
        if (res.body && typeof res.body.getReader === "function") {
          const reader = res.body.getReader();
          const chunks = [];
          let loaded = 0;
          while (true) {
            if (signal?.aborted) {
              try {
                await reader.cancel();
              } catch (_) {
                /* ignore */
              }
              throw new DOMException("aborted", "AbortError");
            }
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.byteLength || 0;
            updateFsXfer({
              title: nested ? "批量下载" : "下载中",
              name: name || remotePath,
              loaded,
              total: total || loaded,
              started,
            });
          }
          blob = new Blob(chunks);
        } else {
          blob = await res.blob();
          updateFsXfer({
            title: nested ? "批量下载" : "下载中",
            name: name || remotePath,
            loaded: blob.size,
            total: blob.size,
            started,
          });
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name || "download.bin";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        if (!nested) toast("已开始下载到浏览器默认目录");
        if (adbFsMeta) adbFsMeta.textContent = `已下载 ${name || ""}`;
      } finally {
        if (!nested) {
          adbFsXferBusy = false;
          adbFsXferAbort = null;
          hideFsXfer();
        }
      }
    }

    async function downloadFolderBlob(remoteDir, { onProgress, signal, maxFiles = 400 } = {}) {
      if (typeof JSZip === "undefined" && typeof window.JSZip === "undefined") {
        throw new Error("JSZip 未加载，无法打包下载");
      }
      const Zip = typeof JSZip !== "undefined" ? JSZip : window.JSZip;
      const zip = new Zip();
      const queue = [{ remote: remoteDir, rel: "" }];
      let count = 0;
      let skipped = false;
      while (queue.length) {
        if (signal?.aborted) throw new DOMException("aborted", "AbortError");
        const { remote, rel } = queue.shift();
        const data = await adbFetch(
          `/fs/list?serial=${encodeURIComponent(adbSelected)}&path=${encodeURIComponent(remote)}`,
          signal ? { signal } : {}
        );
        for (const item of data.entries || []) {
          if (signal?.aborted) throw new DOMException("aborted", "AbortError");
          const childRemote = joinRemote(data.path || remote, item.name);
          const childRel = rel ? `${rel}/${item.name}` : item.name;
          if (item.type === "dir" && !item.virtual) {
            queue.push({ remote: childRemote, rel: childRel });
            continue;
          }
          if (item.virtual) continue;
          if (count >= maxFiles) {
            skipped = true;
            continue;
          }
          count += 1;
          if (onProgress) onProgress({ count, name: childRel });
          try {
            const res = await adbFetch(
              `/fs/download?serial=${encodeURIComponent(adbSelected)}&path=${encodeURIComponent(childRemote)}`,
              signal ? { signal } : {}
            );
            const blob = await res.blob();
            zip.file(childRel, blob);
          } catch (err) {
            zip.file(`${childRel}.error.txt`, String(err.message || err));
          }
        }
      }
      if (!count) throw new Error("文件夹为空或无可下载文件");
      const blob = await zip.generateAsync({ type: "blob" });
      return { blob, count, skipped };
    }

    async function downloadFolder(remotePath, name) {
      if (!adbSelected) return;
      if (adbFsXferBusy) {
        toast("已有传输进行中");
        return;
      }
      adbFsXferBusy = true;
      const controller = new AbortController();
      adbFsXferAbort = controller;
      const started = performance.now();
      try {
        if (canLocalPull()) {
          updateFsXfer({ title: "拉取文件夹到本机", name: name || remotePath, loaded: 0, total: 0, started });
          const data = await pullRemoteToLocalDir(remotePath, name, { signal: controller.signal });
          toast(`文件夹已保存到 ${data.localPath || adbLocalPath}`);
          loadLocalPath(adbLocalPath).catch(() => {});
          return;
        }
        if (canFsZip()) {
          updateFsXfer({ title: "桥端打包文件夹", name: name || remotePath, loaded: 0, total: 0, started });
          const res = await adbFetch(
            `/fs/zip?serial=${encodeURIComponent(adbSelected)}&path=${encodeURIComponent(remotePath)}`,
            { signal: controller.signal }
          );
          const blob = await res.blob();
          downloadBlobFile(blob, `${name || basenameRemote(remotePath) || "folder"}.zip`);
          toast(`已下载 ${formatBytes(blob.size)}（桥端打包）`);
          return;
        }
        updateFsXfer({ title: "打包文件夹", name: name || remotePath, loaded: 0, total: 0, started });
        const { blob, count, skipped } = await downloadFolderBlob(remotePath, {
          signal: controller.signal,
          onProgress: ({ count: c, name: n }) => {
            updateFsXfer({ title: `打包文件夹 (${c})`, name: n, loaded: c, total: 0, started });
          },
        });
        downloadBlobFile(blob, `${name || basenameRemote(remotePath) || "folder"}.zip`);
        toast(skipped ? `已打包 ${count} 个文件（已达上限，部分文件未包含）` : `已打包 ${count} 个文件`);
      } catch (err) {
        if (err?.name === "AbortError") {
          toast("已取消打包下载");
        } else {
          throw err;
        }
      } finally {
        adbFsXferBusy = false;
        adbFsXferAbort = null;
        hideFsXfer();
      }
    }

    function formatFsSpeed(bytesPerSec) {
      if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return "";
      return `${formatBytes(bytesPerSec)}/s`;
    }

    function updateFsXfer({ title, name, loaded, total, started }) {
      const box = $("#adb-fs-xfer");
      if (!box) return;
      box.hidden = false;
      const titleEl = $("#adb-fs-xfer-title");
      const metaEl = $("#adb-fs-xfer-meta");
      const fill = $("#adb-fs-xfer-fill");
      if (titleEl) titleEl.textContent = title || "传输中";
      const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((loaded / total) * 100))) : 0;
      const elapsed = Math.max(0.001, (performance.now() - (started || performance.now())) / 1000);
      const speed = loaded > 0 ? formatFsSpeed(loaded / elapsed) : "";
      const sizeBit =
        total > 0 ? `${formatBytes(loaded)} / ${formatBytes(total)}` : loaded > 0 ? formatBytes(loaded) : "…";
      if (metaEl) {
        metaEl.textContent = [name, sizeBit, speed && `· ${speed}`, total > 0 && `${pct}%`].filter(Boolean).join(" ");
      }
      if (fill) fill.style.width = `${total > 0 ? pct : Math.min(95, 12 + (loaded ? 40 : 0))}%`;
      if (adbFsMeta && name) adbFsMeta.textContent = `${title || "传输"}：${name}`;
    }

    function hideFsXfer() {
      const box = $("#adb-fs-xfer");
      if (box) box.hidden = true;
      const fill = $("#adb-fs-xfer-fill");
      if (fill) fill.style.width = "0%";
    }

    async function downloadArtifact(jobId, name) {
      const res = await adbFetch(`/jobs/${encodeURIComponent(jobId)}/artifact/${encodeURIComponent(name)}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast("已开始下载");
    }

    function watchJobs() {
      clearInterval(adbJobTimer);
      adbJobTimer = setInterval(() => {
        if (!adbConnected) return;
        if (adbTab === "jobs" || document.visibilityState === "visible") {
          refreshJobs({ silent: true }).catch(() => {});
        }
      }, 1500);
    }

    async function refreshJobs({ silent = false } = {}) {
      const data = await adbFetch("/jobs");
      renderJobs(data.jobs || []);
      if (!silent) toast("任务已刷新");
    }

    async function trackJob(job, { stay = true } = {}) {
      if (job?.id) adbTrackedJobs.add(job.id);
      if (!stay) switchAdbTab("jobs");
      toast(`任务已创建：${jobTypeLabel(job.type)}${stay ? "（可在当前页查看进度/下载）" : ""}`);
      await refreshJobs({ silent: true });
      watchJobs();
    }

    async function startInstall(serials) {
      if (!adbApkFile) throw new Error("请先选择 APK");
      if (!serials.length) throw new Error("请选择设备");
      const buffer = new Uint8Array(await adbApkFile.arrayBuffer());
      const uploaded = await adbFetch(`/upload?name=${encodeURIComponent(adbApkFile.name)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Filename": encodeURIComponent(adbApkFile.name),
        },
        body: buffer,
      });
      adbApkUploadId = uploaded.uploadId;
      const payload = {
        uploadId: uploaded.uploadId,
        serials,
        replace: Boolean($("#adb-apk-replace")?.checked),
      };
      if ($("#adb-apk-downgrade")) {
        payload.allowDowngrade = Boolean($("#adb-apk-downgrade").checked);
      }
      const data = await adbFetch("/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      await trackJob(data.job);
    }

    function setApkButtonsEnabled(on) {
      if ($("#adb-apk-install-selected")) $("#adb-apk-install-selected").disabled = !on;
      if ($("#adb-apk-install-current")) $("#adb-apk-install-current").disabled = !on;
      if ($("#adb-apk-analyze")) $("#adb-apk-analyze").disabled = !on;
      if ($("#adb-apk-push-system")) $("#adb-apk-push-system").disabled = !on;
    }

    function setPermTarget(pkg) {
      adbPermPackage = pkg || "";
      if ($("#adb-perm-target")) {
        $("#adb-perm-target").textContent = adbPermPackage
          ? `权限目标：${adbPermPackage}`
          : "勾选应用后可授予/撤销权限";
      }
    }

    async function showAppInfo(packageName) {
      const serial = requireCurrentSerial();
      const data = await adbFetch(
        `/apps/info?serial=${encodeURIComponent(serial)}&package=${encodeURIComponent(packageName)}`
      );
      const el = $("#adb-app-detail");
      if (!el) return;
      el.hidden = false;
      el.textContent = [
        `包名: ${data.packageName}`,
        `版本: ${data.versionName || "—"} (${data.versionCode || "—"})`,
        `SDK: min ${data.minSdk || "—"} / target ${data.targetSdk || "—"}`,
        `启动 Activity: ${data.launchActivity || "—"}`,
        `已授予权限 (${(data.grantedPermissions || []).length}):`,
        ...(data.grantedPermissions || []).slice(0, 40),
        "",
        `声明权限 (${(data.permissions || []).length}):`,
        ...(data.permissions || []).slice(0, 40),
        "",
        "预览:",
        data.rawPreview || "",
      ].join("\n");
      setPermTarget(packageName);
      switchAdbTab("apps");
    }

    async function analyzeSelectedApk() {
      if (!adbApkFile) throw new Error("请先选择 APK");
      const buffer = new Uint8Array(await adbApkFile.arrayBuffer());
      const uploaded = await adbFetch(`/upload?name=${encodeURIComponent(adbApkFile.name)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Filename": encodeURIComponent(adbApkFile.name),
        },
        body: buffer,
      });
      adbApkUploadId = uploaded.uploadId;
      const data = await adbFetch("/apk/info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: uploaded.uploadId }),
      });
      adbApkInfo = data;
      let installedLine = "";
      if (data.packageName && adbSelected) {
        try {
          const installed = await adbFetch(
            `/apps/info?serial=${encodeURIComponent(adbSelected)}&package=${encodeURIComponent(data.packageName)}`
          );
          installedLine = `已安装版本: ${installed.versionName || "—"} (${installed.versionCode || "—"}) · APK: ${data.versionName || "—"} (${data.versionCode || "—"})`;
        } catch (_) {
          installedLine = `已安装版本: 未安装或无法读取 · APK: ${data.versionName || "—"} (${data.versionCode || "—"})`;
        }
      }
      const el = $("#adb-apk-info");
      if (!el) return;
      el.hidden = false;
      el.textContent = [
        `文件: ${data.filename || adbApkFile.name}`,
        `大小: ${formatBytes(data.size || adbApkFile.size)}`,
        `解析工具: ${data.tool || "无"}`,
        data.note || "",
        `应用名: ${data.label || "—"}`,
        `包名: ${data.packageName || "—"}`,
        `版本: ${data.versionName || "—"} (${data.versionCode || "—"})`,
        installedLine,
        `SDK: min ${data.minSdk || "—"} / target ${data.targetSdk || "—"}`,
        `启动: ${data.launchActivity || "—"}`,
        "",
        ...formatApkSigningLines(data),
        "",
        `权限 (${(data.permissions || []).length}):`,
        ...(data.permissions || []).slice(0, 60),
        "",
        data.rawPreview || "",
      ]
        .filter((line) => line !== "")
        .join("\n");
      if ($("#adb-apk-pkg") && data.packageName) $("#adb-apk-pkg").value = data.packageName;
      toast("APK 信息已解析");
    }

    function formatApkSigningLines(data) {
      const signing = data?.signing || {};
      const signers = data?.signatures || signing.signers || [];
      const lines = [
        `签名工具: ${signing.tool || "无"}`,
        `签名方案: ${(signing.schemes || []).length ? signing.schemes.join(" / ") : "—"}`,
      ];
      const found = signing.toolsFound
        ? Object.entries(signing.toolsFound)
            .filter(([, v]) => v)
            .map(([k]) => k)
        : [];
      if (signing.toolsFound) {
        lines.push(`本机工具: ${found.length ? found.join(", ") : "未检测到 keytool/openssl/apksigner"}`);
      }
      const paths = signing.resolvedPaths || {};
      const pathBits = ["apksigner", "keytool", "openssl"]
        .map((k) => (paths[k] ? `${k}=${paths[k]}` : ""))
        .filter(Boolean);
      if (pathBits.length) lines.push(`工具路径: ${pathBits.join(" · ")}`);
      if (paths.JAVA_HOME) lines.push(`JAVA_HOME: ${paths.JAVA_HOME}`);
      if (signing.note) lines.push(signing.note);
      const errs = Array.isArray(signing.errors) ? signing.errors : [];
      if (errs.length && !signers.length) {
        errs.slice(0, 3).forEach((e) => {
          lines.push(`错误(${e.tool || "?"}): ${e.message || ""}`);
        });
      }
      const signGuide = $("#adb-signing-guide");
      if (!signers.length) {
        lines.push("签名: 未能解析");
        if (found.length) {
          if (!found.includes("apksigner")) {
            lines.push(
              "说明：已检测到本机签名工具，但该 APK 可能只有 v2/v3 签名。请安装 Android build-tools 的 apksigner（不必重装 JDK/keytool），然后重启 ADB 桥再分析。"
            );
          } else {
            lines.push(
              "说明：探测到 apksigner 仍失败时，请看上方「错误」行（常见：缺 Java、Windows 未重启桥、APK 损坏）。也可在终端手动: apksigner verify --print-certs 你的.apk"
            );
          }
          // 工具已在，不误导展示「未安装 keytool」引导
          if (signGuide) signGuide.hidden = true;
        } else {
          lines.push(
            "配置：安装 JDK（keytool）或 Android build-tools（apksigner），可选 openssl；配好后重启 ADB 桥再分析。"
          );
          if (signGuide) signGuide.hidden = false;
        }
        return lines;
      }
      if (signGuide) signGuide.hidden = true;
      signers.forEach((s, idx) => {
        const n = s.index || idx + 1;
        lines.push(`签名 #${n}:`);
        lines.push(`  别名: ${s.alias || s.v1Entry || "—"}`);
        lines.push(`  CN: ${s.cn || "—"}`);
        lines.push(`  Owner: ${s.owner || "—"}`);
        if (s.issuer) lines.push(`  Issuer: ${s.issuer}`);
        if (s.serial) lines.push(`  Serial: ${s.serial}`);
        if (s.valid) lines.push(`  Valid: ${s.valid}`);
        lines.push(`  SHA1: ${s.sha1 || "—"}`);
        lines.push(`  SHA256: ${s.sha256 || "—"}`);
        if (s.md5) lines.push(`  MD5: ${s.md5}`);
        if (s.sigAlg) lines.push(`  算法: ${s.sigAlg}`);
      });
      return lines;
    }

    async function pushSystemApk() {
      if (!adbApkFile) throw new Error("请先选择 APK");
      const serial = requireCurrentSerial();
      let uploadId = adbApkUploadId;
      let packageName = String($("#adb-apk-pkg")?.value || adbApkInfo?.packageName || "").trim();
      if (!uploadId) {
        const buffer = new Uint8Array(await adbApkFile.arrayBuffer());
        const uploaded = await adbFetch(`/upload?name=${encodeURIComponent(adbApkFile.name)}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Filename": encodeURIComponent(adbApkFile.name),
          },
          body: buffer,
        });
        uploadId = uploaded.uploadId;
        adbApkUploadId = uploadId;
      }
      if (!packageName) {
        const data = await adbFetch("/apk/info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId }),
        });
        adbApkInfo = data;
        packageName = data.packageName || "";
        if ($("#adb-apk-pkg") && packageName) $("#adb-apk-pkg").value = packageName;
      }
      if (!packageName) throw new Error("无法解析包名，请填写包名或先分析 APK");
      const data = await adbFetch("/install/push-system", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial, uploadId, packageName }),
      });
      toast(
        data.message ||
          (data.replaced
            ? `已覆盖推送 ${data.remotePath || ""}`
            : `已推送至 ${data.remotePath || "系统/临时路径"}`)
      );
      return data;
    }

    async function refreshProxy({ silent = false } = {}) {
      const serial = requireCurrentSerial();
      const data = await adbFetch(`/network/proxy?serial=${encodeURIComponent(serial)}`);
      if ($("#adb-proxy-host") && data.host) $("#adb-proxy-host").value = data.host;
      if ($("#adb-proxy-port") && data.port) $("#adb-proxy-port").value = data.port;
      if ($("#adb-proxy-meta")) {
        $("#adb-proxy-meta").textContent = data.httpProxy
          ? `当前代理：${data.httpProxy}`
          : "当前未设置 HTTP 代理";
      }
      if (!silent) toast("代理状态已刷新");
    }

    async function refreshForwards({ silent = false } = {}) {
      const serial = requireCurrentSerial();
      const data = await adbFetch(`/network/forward?serial=${encodeURIComponent(serial)}`);
      const lines = [];
      lines.push("forward:");
      if (!(data.forwards || []).length) lines.push("  (无)");
      for (const f of data.forwards || []) {
        lines.push(`  ${f.serial}  ${f.local}  ->  ${f.remote}`);
      }
      lines.push("reverse:");
      const reverses = (data.reverses || []).filter((r) => r.local || r.raw);
      if (!reverses.length) lines.push("  (无)");
      for (const r of reverses) {
        lines.push(r.local ? `  ${r.local}  ->  ${r.remote}` : `  ${r.raw}`);
      }
      if ($("#adb-fwd-out")) $("#adb-fwd-out").textContent = lines.join("\n");
      if ($("#adb-forward-meta")) {
        $("#adb-forward-meta").textContent = `forward ${(data.forwards || []).length} · reverse ${reverses.length}`;
      }
      if (!silent) toast("转发列表已刷新");
    }

    async function refreshDeveloper({ silent = false } = {}) {
      const serial = requireCurrentSerial();
      const data = await adbFetch(`/developer?serial=${encodeURIComponent(serial)}`);
      const onOff = (v) => (v ? "开" : "关");
      if ($("#adb-dev-show-touches")) $("#adb-dev-show-touches").textContent = onOff(data.showTouches ?? data.show_touches);
      if ($("#adb-dev-pointer")) $("#adb-dev-pointer").textContent = onOff(data.pointerLocation ?? data.pointer_location);
      if ($("#adb-dev-layout")) $("#adb-dev-layout").textContent = onOff(data.layoutBounds ?? data.show_layout);
      if ($("#adb-dev-stay-on")) {
        const stayRaw = String(data.stay_on ?? data.stayOnWhilePluggedIn ?? "");
        const stayOn = stayRaw && stayRaw !== "0" && stayRaw !== "null" && stayRaw !== "—";
        $("#adb-dev-stay-on").textContent = stayOn ? `开(${stayRaw})` : stayRaw === "0" ? "关" : "—";
      }
      if ($("#adb-dev-force-rtl")) $("#adb-dev-force-rtl").textContent = onOff(data.force_rtl);
      if ($("#adb-dev-dont-keep")) $("#adb-dev-dont-keep").textContent = onOff(data.dont_keep_activities);
      if ($("#adb-dev-force-gpu")) $("#adb-dev-force-gpu").textContent = onOff(data.force_gpu);
      if ($("#adb-dev-hardware-ui")) $("#adb-dev-hardware-ui").textContent = onOff(data.hardware_ui);
      if ($("#adb-dev-usb-notify")) {
        $("#adb-dev-usb-notify").textContent = onOff(data.usb_debugging_notify);
      }
      if ($("#adb-dev-gpu-overdraw")) $("#adb-dev-gpu-overdraw").textContent = onOff(data.gpu_overdraw);
      if ($("#adb-dev-strict-mode")) $("#adb-dev-strict-mode").textContent = onOff(data.strict_mode);
      if ($("#adb-dev-show-anrs")) $("#adb-dev-show-anrs").textContent = onOff(data.show_all_anrs);
      if ($("#adb-dev-verify-adb")) $("#adb-dev-verify-adb").textContent = onOff(data.verify_adb_installs);
      if ($("#adb-dev-force-dark")) $("#adb-dev-force-dark").textContent = onOff(data.force_dark);
      if ($("#adb-dev-auto-rotate")) $("#adb-dev-auto-rotate").textContent = onOff(data.auto_rotate);
      if ($("#adb-dev-mobile-always")) $("#adb-dev-mobile-always").textContent = onOff(data.mobile_data_always_on);
      if ($("#adb-dev-scales")) {
        $("#adb-dev-scales").textContent = `window ${data.windowAnimationScale} / transition ${data.transitionAnimationScale} / animator ${data.animatorDurationScale}`;
      }
      if ($("#adb-dev-meta")) $("#adb-dev-meta").textContent = "已同步当前设备状态";
      if (!silent) toast("开发者选项已刷新");
    }

    restoreAdbSettings();
    $("#adb-fs-view-list")?.classList.toggle("is-active", adbFsView === "list");
    $("#adb-fs-view-grid")?.classList.toggle("is-active", adbFsView === "grid");
    setAdbStatus("is-err", "未连接本机桥", "使用本工具需要本机已安装 adb。请下载完整 ZIP（含 server.js）并运行后连接。");
    if ($("#adb-fs-hint")) $("#adb-fs-hint").innerHTML = ADB_FS_ROOTS_HINT_HTML;
    {
      const hostEl = $("#adb-proxy-host");
      if (hostEl && !hostEl.value) {
        const h = String(window.location.hostname || "");
        if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) {
          hostEl.placeholder = h;
          if (!hostEl.dataset.adbFilled) {
            hostEl.value = h;
            hostEl.dataset.adbFilled = "1";
          }
        } else if (h === "localhost" || h === "127.0.0.1") {
          hostEl.placeholder = "本机局域网 IP，如 192.168.1.8";
        }
      }
    }

    async function cancelAdbJob(jobId) {
      const data = await adbFetch(`/jobs/${encodeURIComponent(jobId)}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      toast(data.message || "已请求取消");
      await refreshJobs({ silent: true });
      return data;
    }

    async function zipJobArtifacts(jobId) {
      if (typeof JSZip === "undefined" && typeof window.JSZip === "undefined") {
        throw new Error("JSZip 未加载，无法打包下载");
      }
      const Zip = typeof JSZip !== "undefined" ? JSZip : window.JSZip;
      const job = adbJobs.find((j) => j.id === jobId);
      const arts = job?.artifacts || [];
      if (!arts.length) throw new Error("该任务没有可打包的产物");
      const zip = new Zip();
      for (const a of arts) {
        const res = await adbFetch(`/jobs/${encodeURIComponent(jobId)}/artifact/${encodeURIComponent(a.name)}`);
        zip.file(a.name, await res.blob());
      }
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlobFile(blob, `adb-job-${jobId}.zip`);
      toast(`已打包 ${arts.length} 个文件`);
    }

    function adbCanvasCoords(img, clientX, clientY) {
      const rect = img.getBoundingClientRect();
      const nw = img.naturalWidth || 1;
      const nh = img.naturalHeight || 1;
      const x = Math.round(((clientX - rect.left) / Math.max(rect.width, 1)) * nw);
      const y = Math.round(((clientY - rect.top) / Math.max(rect.height, 1)) * nh);
      return {
        x: Math.max(0, Math.min(nw - 1, x)),
        y: Math.max(0, Math.min(nh - 1, y)),
      };
    }

    async function refreshInputScreencap({ quiet = false } = {}) {
      if (adbInputRefreshBusy) {
        adbInputRefreshAfter = true;
        return;
      }
      adbInputRefreshBusy = true;
      try {
        const serial = requireCurrentSerial();
        const img = $("#adb-input-canvas");
        if (!img) throw new Error("缺少预览元素 #adb-input-canvas");
        const res = await adbFetch(`/media/screencap?serial=${encodeURIComponent(serial)}`);
        const blob = await res.blob();
        if (adbInputShotUrl) URL.revokeObjectURL(adbInputShotUrl);
        adbInputShotUrl = URL.createObjectURL(blob);
        img.src = adbInputShotUrl;
        img.hidden = false;
        if (!quiet && $("#adb-input-meta")) {
          $("#adb-input-meta").textContent = "单指：单击 / 长按 / 双击 / 拖拽。操作后自动实时预览。";
        }
        if (!quiet) toast("已刷新屏幕预览");
      } finally {
        adbInputRefreshBusy = false;
        if (adbInputRefreshAfter) {
          adbInputRefreshAfter = false;
          refreshInputScreencap({ quiet: true }).catch(() => {});
        }
      }
    }

    function clampInputShotVh(raw) {
      const n = Number(raw);
      if (!Number.isFinite(n)) return ADB_INPUT_SHOT_VH_DEFAULT;
      return Math.max(32, Math.min(88, Math.round(n / 2) * 2));
    }

    function applyInputShotSize(vh, { persist = true } = {}) {
      const value = clampInputShotVh(vh);
      const wrap = $("#adb-input-shot-wrap");
      const slider = $("#adb-input-shot-size");
      const label = $("#adb-input-shot-size-val");
      if (wrap) wrap.style.setProperty("--adb-input-shot-vh", String(value));
      if (slider && String(slider.value) !== String(value)) slider.value = String(value);
      if (slider) slider.setAttribute("aria-valuetext", `${value}`);
      if (label) label.textContent = `${value}%`;
      if (persist) {
        try {
          localStorage.setItem(ADB_STORE_INPUT_SHOT_VH, String(value));
        } catch (_) {
          /* ignore */
        }
      }
      return value;
    }

    function restoreInputShotSize() {
      let saved = ADB_INPUT_SHOT_VH_DEFAULT;
      try {
        const raw = localStorage.getItem(ADB_STORE_INPUT_SHOT_VH);
        if (raw != null && raw !== "") saved = clampInputShotVh(raw);
      } catch (_) {
        saved = ADB_INPUT_SHOT_VH_DEFAULT;
      }
      applyInputShotSize(saved, { persist: false });
    }

    function updateInputLiveUi() {
      const stopBtn = $("#adb-input-live-stop");
      const meta = $("#adb-input-live-meta");
      if (stopBtn) stopBtn.hidden = !adbInputLive;
      if (meta) meta.hidden = !adbInputLive;
    }

    function startInputLivePreview() {
      if (adbInputLiveTimer) return;
      adbInputLive = true;
      updateInputLiveUi();
      adbInputLiveTimer = setInterval(() => {
        if (adbTab !== "input" || !adbSelected) {
          stopInputLivePreview();
          return;
        }
        refreshInputScreencap({ quiet: true }).catch(() => {});
      }, 1200);
    }

    function stopInputLivePreview() {
      if (adbInputLiveTimer) {
        clearInterval(adbInputLiveTimer);
        adbInputLiveTimer = 0;
      }
      adbInputLive = false;
      updateInputLiveUi();
    }

    function afterInputPreviewAction() {
      if (!adbSelected) return;
      setTimeout(() => {
        if (adbTab !== "input") return;
        refreshInputScreencap({ quiet: true })
          .catch(() => {})
          .finally(() => {
            if (adbTab === "input") startInputLivePreview();
          });
      }, 350);
    }

    function updateRecordTip() {
      const tip = $("#adb-record-tip");
      const secEl = $("#adb-record-sec");
      if (!tip || !secEl) return;
      const sec = Number(secEl.value);
      tip.textContent =
        sec === 0
          ? "0 秒 = 无时限录屏，请用「取消录屏」或任务中的取消结束。"
          : `将录制约 ${sec} 秒后结束（部分系统硬上限约 180 秒）。也可随时取消。`;
    }

    $("#adb-connect")?.addEventListener("click", () => connectAdbBridge());
    $("#adb-refresh")?.addEventListener("click", () =>
      refreshAdbDevices().catch((err) => setError(adbError, err.message || String(err)))
    );
    adbBaseInput?.addEventListener("change", persistAdbSettings);
    adbTokenInput?.addEventListener("change", persistAdbSettings);

    $("#adb-dl-mac")?.addEventListener("click", (e) => {
      e.preventDefault();
      downloadAdbScriptAndWait($("#adb-dl-mac"));
    });
    $("#adb-dl-win")?.addEventListener("click", (e) => {
      e.preventDefault();
      downloadAdbScriptAndWait($("#adb-dl-win"));
    });
    $("#adb-dl-linux")?.addEventListener("click", (e) => {
      e.preventDefault();
      downloadAdbScriptAndWait($("#adb-dl-linux"));
    });

    $$(".adb-tab").forEach((btn) => {
      btn.addEventListener("click", () => switchAdbTab(btn.dataset.adbTab));
    });

    $("#adb-select-all")?.addEventListener("click", () => {
      adbChecked = new Set(adbDevices.map((d) => d.serial));
      renderAdbDevices();
    });
    $("#adb-select-none")?.addEventListener("click", () => {
      adbChecked = new Set();
      renderAdbDevices();
    });

    adbDeviceList?.addEventListener("click", (e) => {
      const check = e.target.closest("[data-adb-check]");
      if (check) return;
      const btn = e.target.closest("[data-serial]");
      if (!btn) return;
      selectAdbDevice(btn.dataset.serial).catch((err) => setError(adbError, err.message || String(err)));
    });
    adbDeviceList?.addEventListener("change", (e) => {
      const check = e.target.closest("[data-adb-check]");
      if (!check) return;
      const serial = check.dataset.adbCheck;
      if (check.checked) adbChecked.add(serial);
      else adbChecked.delete(serial);
      updateSelectedMeta();
    });

    $("#adb-fs-go")?.addEventListener("click", () => loadFs(adbFsPath?.value || "/"));
    $("#adb-fs-refresh")?.addEventListener("click", () => loadFs(adbFsPath?.value || "/", { history: "replace" }));
    $("#adb-fs-back")?.addEventListener("click", () => {
      if (adbFsHistIdx <= 0) return;
      adbFsHistIdx -= 1;
      loadFs(adbFsHistory[adbFsHistIdx], { history: "none" });
    });
    $("#adb-fs-forward")?.addEventListener("click", () => {
      if (adbFsHistIdx < 0 || adbFsHistIdx >= adbFsHistory.length - 1) return;
      adbFsHistIdx += 1;
      loadFs(adbFsHistory[adbFsHistIdx], { history: "none" });
    });
    $("#adb-fs-shortcuts")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-adb-fs-jump]");
      if (!btn) return;
      e.preventDefault();
      const target = btn.getAttribute("data-adb-fs-jump") || "/";
      loadFs(target);
    });
    adbFsPath?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") loadFs(adbFsPath.value || "/");
    });
    $("#adb-fs-up")?.addEventListener("click", () => {
      const cur = adbFsPath?.value || "/";
      if (cur === "/" || cur === "") {
        loadFs("/");
        return;
      }
      const parts = cur.replace(/\/+$/, "").split("/");
      if (parts.length <= 1) {
        loadFs("/");
        return;
      }
      parts.pop();
      loadFs(parts.join("/") || "/");
    });
    $("#adb-fs-mkdir")?.addEventListener("click", async () => {
      if (!adbSelected) return;
      const name = window.prompt("新建文件夹名称");
      if (!name || !name.trim()) return;
      const target = joinRemote(adbFsPath?.value || "/", name.trim());
      try {
        await adbFetch("/fs/mkdir", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serial: adbSelected, path: target }),
        });
        toast("已创建文件夹");
        await loadFs(adbFsPath?.value || "/");
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-fs-upload")?.addEventListener("change", async (e) => {
      try {
        await uploadAdbFiles(e.target.files || []);
      } catch (err) {
        setError(adbError, err.message || String(err));
      } finally {
        e.target.value = "";
      }
    });
    $("#adb-fs-upload-dir")?.addEventListener("change", async (e) => {
      try {
        await uploadAdbFiles(e.target.files || [], { relativePaths: true });
      } catch (err) {
        setError(adbError, err.message || String(err));
      } finally {
        e.target.value = "";
      }
    });
    $("#adb-fs-xfer-cancel")?.addEventListener("click", () => {
      if (adbFsXferAbort) {
        adbFsXferAbort.abort();
        toast("正在取消…");
      } else {
        hideFsXfer();
      }
    });
    $("#adb-fs-view-list")?.addEventListener("click", () => setAdbFsView("list"));
    $("#adb-fs-view-grid")?.addEventListener("click", () => setAdbFsView("grid"));

    $("#adb-fs-local-list")?.addEventListener("click", (e) => {
      const check = e.target.closest("[data-adb-local-check]");
      if (check) {
        const path = check.dataset.adbLocalCheck || "";
        const row = check.closest(".adb-fs-local-row");
        const name = row?.dataset.adbLocalName || basenameRemote(path);
        const isDir = row?.dataset.adbLocalDir === "1";
        if (check.checked) adbLocalChecked.set(path, { path, name, isDir });
        else adbLocalChecked.delete(path);
        row?.classList.toggle("is-checked", check.checked);
        syncLocalPushBtn();
        return;
      }
      const openEl = e.target.closest("[data-adb-local-open]");
      if (openEl?.dataset.adbLocalOpen) {
        loadLocalPath(openEl.dataset.adbLocalOpen).catch((err) => setError(adbError, err.message || String(err)));
      }
    });
    $("#adb-fs-local-up")?.addEventListener("click", () => {
      if (!adbLocalPath) return;
      loadLocalPath(parentOfLocalPath(adbLocalPath)).catch((err) => setError(adbError, err.message || String(err)));
    });
    $("#adb-fs-local-go")?.addEventListener("click", () => {
      const p = $("#adb-fs-local-path")?.value || "";
      if (p) loadLocalPath(p).catch((err) => setError(adbError, err.message || String(err)));
    });
    $("#adb-fs-local-path")?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") $("#adb-fs-local-go")?.click();
    });
    $("#adb-fs-local-roots")?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-adb-local-root]");
      if (!btn) return;
      loadLocalPath(btn.dataset.adbLocalRoot || "").catch((err) => setError(adbError, err.message || String(err)));
    });
    $("#adb-fs-local-push")?.addEventListener("click", async () => {
      if (!adbSelected) {
        toast("请先选择设备");
        return;
      }
      const items = [...adbLocalChecked.values()];
      if (!items.length) return;
      if (!adbFsDirWritable) {
        toast("当前设备目录只读，无法推送");
        return;
      }
      const remoteDir = adbFsPath?.value || "/";
      try {
        const data = await adbFetch("/local/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serial: adbSelected, paths: items.map((it) => it.path), remoteDir }),
        });
        const results = data.results || [];
        const ok = results.filter((r) => r.ok).length;
        const fail = results.length - ok;
        toast(fail ? `已推送 ${ok} 项，失败 ${fail} 项` : `已推送 ${ok} 项`);
        adbLocalChecked.clear();
        renderLocalList();
        syncLocalPushBtn();
        await loadFs(remoteDir, { history: "replace" });
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });

    adbFsList?.addEventListener("click", async (e) => {
      const sortBtn = e.target.closest("[data-adb-fs-sort]");
      if (sortBtn) {
        e.preventDefault();
        e.stopPropagation();
        const key = sortBtn.dataset.adbFsSort || "name";
        if (adbFsSortKey === key) adbFsSortDir *= -1;
        else {
          adbFsSortKey = key;
          adbFsSortDir = 1;
        }
        paintFsList();
        return;
      }
      const moreBtn = e.target.closest("[data-adb-fs-more]");
      if (moreBtn) {
        e.preventDefault();
        e.stopPropagation();
        const row = moreBtn.closest(".adb-fs-row");
        const entry = collectFsEntrySelection(row);
        const rect = moreBtn.getBoundingClientRect();
        showFsCtxMenu(entry, rect.left, rect.bottom + 4);
        return;
      }
      const check = e.target.closest(".adb-fs-check");
      if (check) {
        e.stopPropagation();
        hideFsCtxMenu();
        const row = check.closest(".adb-fs-row");
        const entry = collectFsEntrySelection(row);
        if (!entry || entry.virtual) return;
        if (check.checked) adbFsChecked.set(entry.path, entry);
        else adbFsChecked.delete(entry.path);
        syncFsBatchBar();
        return;
      }
      hideFsCtxMenu();
      const row = e.target.closest(".adb-fs-row[data-adb-entry]");
      if (!row) return;
      // 单击：目录/虚拟包打开，文件预览
      if (row.dataset.adbOpen) {
        loadFs(row.dataset.adbOpen);
        return;
      }
      if (row.dataset.adbFile) {
        adbFsList.querySelectorAll(".adb-fs-row.is-selected").forEach((r) => r.classList.remove("is-selected"));
        row.classList.add("is-selected");
        adbFsSelected = row.dataset.adbFile || "";
        showFsProps(collectFsEntrySelection(row));
        previewAdbFile(row.dataset.adbFile, row.dataset.adbFileName, row.dataset.adbFileSize).catch((err) =>
          setError(adbError, err.message || String(err))
        );
      }
    });
    $("#adb-fs-filter")?.addEventListener("input", () => {
      paintFsList();
      if (adbFsMeta && adbFsPathCache) {
        const total = (adbFsEntriesCache || []).length;
        const q = String($("#adb-fs-filter")?.value || "").trim();
        adbFsMeta.textContent = q
          ? `筛选中 · 共 ${total} 项 · ${adbFsPathCache}`
          : `${total} 项 · ${adbFsPathCache}`;
      }
    });
    {
      const dropEl = $("#adb-fs-workspace") || adbFsList;
      const localDrop = $("#adb-fs-local") || $(".adb-fs-pane-local");
      const hasFiles = (dt) => dt && [...(dt.types || [])].includes("Files");
      const hasLocalPaths = (dt) =>
        dt && ([...(dt.types || [])].includes("application/x-adb-local-paths") || dt.getData?.("application/x-adb-local-paths"));
      const hasDevicePaths = (dt) =>
        dt && ([...(dt.types || [])].includes("application/x-adb-device-paths") || dt.getData?.("application/x-adb-device-paths"));
      const readEntryFile = (fileEntry) =>
        new Promise((resolve, reject) => {
          fileEntry.file(resolve, reject);
        });
      const readEntries = (reader) =>
        new Promise((resolve, reject) => {
          reader.readEntries(resolve, reject);
        });
      async function walkEntry(entry, prefix, out) {
        if (!entry) return;
        if (entry.isFile) {
          const file = await readEntryFile(entry);
          try {
            Object.defineProperty(file, "webkitRelativePath", {
              configurable: true,
              value: prefix ? `${prefix}/${file.name}` : file.name,
            });
          } catch (_) {
            /* ignore */
          }
          out.push(file);
          return;
        }
        if (entry.isDirectory) {
          const reader = entry.createReader();
          const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
          while (true) {
            const batch = await readEntries(reader);
            if (!batch.length) break;
            for (const child of batch) {
              await walkEntry(child, nextPrefix, out);
            }
          }
        }
      }
      async function collectDroppedFiles(dt) {
        const out = [];
        const items = dt?.items ? [...dt.items] : [];
        if (items.some((it) => typeof it.webkitGetAsEntry === "function" && it.webkitGetAsEntry())) {
          for (const item of items) {
            if (item.kind !== "file") continue;
            const entry = item.webkitGetAsEntry?.();
            if (entry) await walkEntry(entry, "", out);
            else if (item.getAsFile) {
              const f = item.getAsFile();
              if (f) out.push(f);
            }
          }
          return out;
        }
        return [...(dt?.files || [])];
      }
      async function pushLocalPathsToDevice(paths) {
        if (!paths?.length || !adbSelected) return;
        if (!adbFsDirWritable) {
          toast("当前设备目录只读，无法接收");
          return;
        }
        const remoteDir = adbFsPath?.value || "/";
        const data = await adbFetch("/local/push", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serial: adbSelected, paths, remoteDir }),
        });
        const results = data.results || [];
        const ok = results.filter((r) => r.ok).length;
        const fail = results.length - ok;
        toast(fail ? `已推送 ${ok} 项，失败 ${fail} 项` : `已推送 ${ok} 项`);
        await loadFs(remoteDir, { history: "replace" });
      }
      async function pullDevicePathsToLocal(items) {
        if (!items?.length || !canLocalPull()) {
          toast(canLocalPull() ? "无项目" : "本机直存不可用，请更新桥 ≥0.6.11");
          return;
        }
        for (const it of items) {
          if (it.isDir) await pullRemoteToLocalDir(it.path, it.name);
          else await pullRemoteToLocalDir(it.path, it.name);
        }
        toast(`已保存 ${items.length} 项到本机`);
        loadLocalPath(adbLocalPath).catch(() => {});
      }

      // OS files → device
      dropEl?.addEventListener("dragenter", (e) => {
        if (!hasFiles(e.dataTransfer) && !hasLocalPaths(e.dataTransfer)) return;
        e.preventDefault();
        dropEl.classList.add("is-drop");
        adbFsList?.classList.add("is-drop");
      });
      dropEl?.addEventListener("dragover", (e) => {
        if (!hasFiles(e.dataTransfer) && !hasLocalPaths(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        dropEl.classList.add("is-drop");
        adbFsList?.classList.add("is-drop");
      });
      dropEl?.addEventListener("dragleave", (e) => {
        if (e.relatedTarget && dropEl.contains(e.relatedTarget)) return;
        dropEl.classList.remove("is-drop");
        adbFsList?.classList.remove("is-drop");
      });
      dropEl?.addEventListener("drop", (e) => {
        e.preventDefault();
        dropEl.classList.remove("is-drop");
        adbFsList?.classList.remove("is-drop");
        try {
          const rawLocal = e.dataTransfer.getData("application/x-adb-local-paths");
          if (rawLocal) {
            const paths = JSON.parse(rawLocal);
            pushLocalPathsToDevice(paths).catch((err) => setError(adbError, err.message || String(err)));
            return;
          }
        } catch (_) {
          /* fall through */
        }
        if (!hasFiles(e.dataTransfer)) return;
        collectDroppedFiles(e.dataTransfer)
          .then((files) => {
            if (!files.length) return;
            const hasRel = files.some((f) => f.webkitRelativePath && f.webkitRelativePath.includes("/"));
            return uploadAdbFiles(files, { relativePaths: hasRel });
          })
          .catch((err) => setError(adbError, err.message || String(err)));
      });

      // device → local
      localDrop?.addEventListener("dragenter", (e) => {
        if (!hasDevicePaths(e.dataTransfer)) return;
        e.preventDefault();
        localDrop.classList.add("is-drop");
      });
      localDrop?.addEventListener("dragover", (e) => {
        if (!hasDevicePaths(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        localDrop.classList.add("is-drop");
      });
      localDrop?.addEventListener("dragleave", (e) => {
        if (e.relatedTarget && localDrop.contains(e.relatedTarget)) return;
        localDrop.classList.remove("is-drop");
      });
      localDrop?.addEventListener("drop", (e) => {
        e.preventDefault();
        localDrop.classList.remove("is-drop");
        try {
          const raw = e.dataTransfer.getData("application/x-adb-device-paths");
          if (!raw) return;
          const items = JSON.parse(raw);
          pullDevicePathsToLocal(items).catch((err) => setError(adbError, err.message || String(err)));
        } catch (err) {
          setError(adbError, err.message || String(err));
        }
      });

      // dragstart: local rows → device
      $("#adb-fs-local-list")?.addEventListener("dragstart", (e) => {
        const row = e.target.closest(".adb-fs-local-row[data-adb-local-path]");
        if (!row) return;
        const path = row.dataset.adbLocalPath;
        if (!path) return;
        const paths =
          adbLocalChecked.size && adbLocalChecked.has(path)
            ? [...adbLocalChecked.keys()]
            : [path];
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData("application/x-adb-local-paths", JSON.stringify(paths));
        e.dataTransfer.setData("text/plain", paths.join("\n"));
      });

      // dragstart: device rows → local
      adbFsList?.addEventListener("dragstart", (e) => {
        const row = e.target.closest(".adb-fs-row[data-adb-entry]");
        if (!row || row.classList.contains("is-virtual")) return;
        if (e.target.closest(".adb-fs-check") || e.target.closest("[data-adb-fs-more]")) {
          e.preventDefault();
          return;
        }
        const entry = collectFsEntrySelection(row);
        if (!entry) return;
        const items =
          adbFsChecked.size && adbFsChecked.has(entry.path)
            ? [...adbFsChecked.values()]
            : [entry];
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData(
          "application/x-adb-device-paths",
          JSON.stringify(items.map((it) => ({ path: it.path, name: it.name, isDir: !!it.isDir })))
        );
        e.dataTransfer.setData("text/plain", items.map((it) => it.path).join("\n"));
      });
    }
    adbFsList?.addEventListener("contextmenu", (e) => {
      const row = e.target.closest(".adb-fs-row[data-adb-entry]");
      if (!row || row.classList.contains("is-virtual")) return;
      if (e.target.closest(".adb-fs-check")) return;
      e.preventDefault();
      const entry = collectFsEntrySelection(row);
      showFsCtxMenu(entry, e.clientX, e.clientY);
    });
    document.addEventListener("click", (e) => {
      if (e.target.closest("#adb-fs-ctx") || e.target.closest("[data-adb-fs-more]")) return;
      hideFsCtxMenu();
      if (!e.target.closest("#adb-app-ctx")) hideAppCtxMenu();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        hideFsCtxMenu();
        hideAppCtxMenu();
      }
    });
    document.addEventListener("keydown", (e) => {
      if (adbTab !== "files") return;
      const tag = (e.target && e.target.tagName) || "";
      const typing =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (e.target && e.target.isContentEditable);
      if (typing) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        $("#adb-fs-select-all")?.click();
        return;
      }
      if (e.key === "Escape") {
        hideFsCtxMenu();
        clearFsChecked();
        clearAdbFsPreview();
        return;
      }
      const selectedRow =
        adbFsList?.querySelector(".adb-fs-row.is-selected[data-adb-entry]") ||
        adbFsList?.querySelector(".adb-fs-row.is-checked[data-adb-entry]");
      if (e.key === "F2") {
        e.preventDefault();
        const entry = collectFsEntrySelection(selectedRow);
        if (entry && !entry.virtual) runFsEntryAction("rename", entry);
        return;
      }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (adbFsChecked.size) {
          e.preventDefault();
          $("#adb-fs-batch-del")?.click();
          return;
        }
        const entry = collectFsEntrySelection(selectedRow);
        if (entry && !entry.virtual) {
          e.preventDefault();
          runFsEntryAction("delete", entry);
        }
        return;
      }
      if (e.key === "Enter") {
        const entry = collectFsEntrySelection(selectedRow);
        if (!entry) return;
        e.preventDefault();
        if (entry.isDir || entry.virtual) runFsEntryAction("open", entry);
        else runFsEntryAction("preview", entry);
      }
    });
    window.addEventListener("scroll", hideFsCtxMenu, true);
    $("#adb-fs-preview-close")?.addEventListener("click", () => clearAdbFsPreview());
    $("#adb-fs-select-all")?.addEventListener("click", () => {
      adbFsList?.querySelectorAll(".adb-fs-row[data-adb-entry]:not(.is-virtual)").forEach((row) => {
        const entry = collectFsEntrySelection(row);
        if (entry) adbFsChecked.set(entry.path, entry);
      });
      syncFsBatchBar();
    });
    $("#adb-fs-select-none")?.addEventListener("click", () => clearFsChecked());
    $("#adb-fs-batch-dl")?.addEventListener("click", async () => {
      const items = [...adbFsChecked.values()];
      if (!items.length) {
        toast("请先勾选要下载的文件或文件夹");
        return;
      }
      if (adbFsXferBusy) {
        toast("已有传输进行中");
        return;
      }
      adbFsXferBusy = true;
      const controller = new AbortController();
      adbFsXferAbort = controller;
      const started = performance.now();
      try {
        for (let i = 0; i < items.length; i++) {
          if (controller.signal.aborted) throw new DOMException("aborted", "AbortError");
          const it = items[i];
          if (it.isDir) {
            updateFsXfer({
              title: `批量下载 ${i + 1}/${items.length} · ${canLocalPull() ? "拉取文件夹" : "打包文件夹"}`,
              name: it.name,
              loaded: i,
              total: items.length,
              started,
            });
            if (canLocalPull()) {
              await pullRemoteToLocalDir(it.path, it.name, { signal: controller.signal });
              toast(`「${it.name}」已保存到本机目录`);
            } else if (canFsZip()) {
              const res = await adbFetch(
                `/fs/zip?serial=${encodeURIComponent(adbSelected)}&path=${encodeURIComponent(it.path)}`,
                { signal: controller.signal }
              );
              const blob = await res.blob();
              downloadBlobFile(blob, `${it.name || basenameRemote(it.path) || "folder"}.zip`);
              toast(`「${it.name}」已桥端打包下载`);
            } else {
              const { blob, count, skipped } = await downloadFolderBlob(it.path, {
                signal: controller.signal,
                onProgress: ({ name: n }) => {
                  updateFsXfer({
                    title: `批量下载 ${i + 1}/${items.length} · 打包文件夹`,
                    name: n,
                    loaded: i,
                    total: items.length,
                    started,
                  });
                },
              });
              downloadBlobFile(blob, `${it.name || basenameRemote(it.path) || "folder"}.zip`);
              toast(skipped ? `「${it.name}」已打包 ${count} 个文件（已达上限）` : `「${it.name}」已打包 ${count} 个文件`);
            }
          } else {
            updateFsXfer({
              title: `批量下载 ${i + 1}/${items.length}`,
              name: it.name,
              loaded: i,
              total: items.length,
              started,
            });
            await downloadAdbFile(it.path, it.name, { nested: true, signal: controller.signal });
          }
        }
        toast(canLocalPull() ? `已保存 ${items.length} 项到本机目录` : `已开始下载 ${items.length} 项`);
        if (canLocalPull()) {
          loadLocalPath(adbLocalPath).catch(() => {});
        }
      } catch (err) {
        if (err?.name === "AbortError") toast("已取消批量下载");
        else setError(adbError, err.message || String(err));
      } finally {
        adbFsXferBusy = false;
        adbFsXferAbort = null;
        hideFsXfer();
      }
    });
    $("#adb-fs-batch-cut")?.addEventListener("click", () => {
      const items = [...adbFsChecked.values()];
      if (!items.length) return;
      setFsClipboard("cut", items);
      clearFsChecked();
      toast(`已准备移动 ${items.length} 项，打开目标目录后粘贴`);
    });
    $("#adb-fs-batch-copy")?.addEventListener("click", () => {
      const items = [...adbFsChecked.values()];
      if (!items.length) return;
      setFsClipboard("copy", items);
      toast(`已复制 ${items.length} 项，打开目标目录后粘贴`);
    });
    $("#adb-fs-batch-del")?.addEventListener("click", async () => {
      const items = [...adbFsChecked.values()];
      if (!items.length) return;
      if (!window.confirm(`确认删除选中的 ${items.length} 项？此操作不可恢复。`)) return;
      try {
        for (let i = 0; i < items.length; i++) {
          if (adbFsMeta) adbFsMeta.textContent = `批量删除 ${i + 1}/${items.length}：${items[i].name}`;
          await adbFetch("/fs/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ serial: adbSelected, path: items[i].path }),
          });
        }
        toast(`已删除 ${items.length} 项`);
        clearFsChecked();
        await loadFs(adbFsPath?.value || "/");
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-fs-paste")?.addEventListener("click", async () => {
      const items = clipboardItems();
      if (!items.length || !adbSelected) return;
      const dir = adbFsPath?.value || "/";
      const mode = adbFsClipboard.mode === "cut" ? "cut" : "copy";
      try {
        for (let i = 0; i < items.length; i++) {
          const it = items[i];
          const destName = it.name || basenameRemote(it.path);
          const to = joinRemote(dir, destName);
          if (adbFsMeta) adbFsMeta.textContent = `${mode === "cut" ? "移动" : "复制"} ${i + 1}/${items.length}：${destName}`;
          if (mode === "cut") {
            await adbFetch("/fs/move", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ serial: adbSelected, from: it.path, to }),
            });
          } else {
            await adbFetch("/fs/copy", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ serial: adbSelected, from: it.path, to }),
            });
          }
        }
        toast(mode === "cut" ? `已移动 ${items.length} 项到当前目录` : `已复制 ${items.length} 项到当前目录`);
        if (mode === "cut") adbFsClipboard = null;
        updateFsClipboardMeta();
        await loadFs(dir);
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    adbFsList?.addEventListener("dblclick", (e) => {
      if (e.target.closest(".adb-fs-check, .adb-fs-more, #adb-fs-ctx")) return;
      const row = e.target.closest(".adb-fs-row[data-adb-entry]");
      if (!row) return;
      e.preventDefault();
      if (row.dataset.adbOpen) {
        loadFs(row.dataset.adbOpen);
        return;
      }
      if (row.dataset.adbFile) {
        adbFsList.querySelectorAll(".adb-fs-row.is-selected").forEach((r) => r.classList.remove("is-selected"));
        row.classList.add("is-selected");
        adbFsSelected = row.dataset.adbFile || "";
        showFsProps(collectFsEntrySelection(row));
        previewAdbFile(row.dataset.adbFile, row.dataset.adbFileName, row.dataset.adbFileSize).catch((err) =>
          setError(adbError, err.message || String(err))
        );
      }
    });
    $("#adb-fs-crumbs")?.addEventListener("click", (e) => {
      const openBtn = e.target.closest("[data-adb-open]");
      if (!openBtn) return;
      loadFs(openBtn.dataset.adbOpen);
    });
    $("[data-adb-panel='files']")?.addEventListener("click", (e) => {
      if (e.target.closest("#adb-fs-list, #adb-fs-crumbs")) return;
      const openBtn = e.target.closest("button[data-adb-open]");
      if (!openBtn) return;
      loadFs(openBtn.dataset.adbOpen);
    });

    $("#adb-apk-file")?.addEventListener("change", (e) => {
      adbApkFile = e.target.files?.[0] || null;
      adbApkUploadId = "";
      adbApkInfo = null;
      if ($("#adb-apk-pkg")) $("#adb-apk-pkg").value = "";
      if (adbApkName) {
        adbApkName.textContent = adbApkFile
          ? `${adbApkFile.name}（${formatBytes(adbApkFile.size)}）`
          : "尚未选择 APK";
      }
      setApkButtonsEnabled(Boolean(adbApkFile));
      const infoEl = $("#adb-apk-info");
      if (infoEl) {
        infoEl.hidden = true;
        infoEl.textContent = "";
      }
    });
    $("#adb-apk-analyze")?.addEventListener("click", () =>
      analyzeSelectedApk().catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-apk-push-system")?.addEventListener("click", () =>
      pushSystemApk().catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-apk-install-selected")?.addEventListener("click", async () => {
      try {
        await startInstall(targetSerials(true));
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-apk-install-current")?.addEventListener("click", async () => {
      try {
        if (!adbSelected) throw new Error("请先选择当前设备");
        await startInstall([adbSelected]);
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });

    $("#adb-apps-refresh")?.addEventListener("click", () =>
      loadApps().catch((err) => setError(adbError, err.message || String(err)))
    );
    async function runPermAction(action) {
      if (!adbPermPackage) throw new Error("请先在应用列表点「选中」");
      const permission = String($("#adb-perm-name")?.value || "").trim();
      if (!permission) throw new Error("请填写权限名");
      await adbFetch("/apps/permission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          serial: requireCurrentSerial(),
          packageName: adbPermPackage,
          action,
          permission,
        }),
      });
      toast(action === "grant" ? "已授予权限" : "已撤销权限");
    }
    $("#adb-perm-grant")?.addEventListener("click", () =>
      runPermAction("grant").catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-perm-revoke")?.addEventListener("click", () =>
      runPermAction("revoke").catch((err) => setError(adbError, err.message || String(err)))
    );

    $("#adb-proxy-refresh")?.addEventListener("click", () =>
      refreshProxy().catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-proxy-set")?.addEventListener("click", async () => {
      try {
        const data = await adbFetch("/network/proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serial: requireCurrentSerial(),
            host: $("#adb-proxy-host")?.value || "",
            port: $("#adb-proxy-port")?.value || "",
          }),
        });
        toast(data.message || "代理已设置");
        await refreshProxy({ silent: true });
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-proxy-clear")?.addEventListener("click", async () => {
      try {
        const data = await adbFetch("/network/proxy", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serial: requireCurrentSerial(), clear: true }),
        });
        toast(data.message || "代理已清除");
        if ($("#adb-proxy-host")) $("#adb-proxy-host").value = "";
        if ($("#adb-proxy-port")) $("#adb-proxy-port").value = "";
        await refreshProxy({ silent: true });
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-fwd-refresh")?.addEventListener("click", () =>
      refreshForwards().catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-fwd-add")?.addEventListener("click", async () => {
      try {
        const data = await adbFetch("/network/forward", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serial: requireCurrentSerial(),
            direction: $("#adb-fwd-dir")?.value || "forward",
            local: $("#adb-fwd-local")?.value || "",
            remote: $("#adb-fwd-remote")?.value || "",
          }),
        });
        toast(data.message || "已添加转发");
        await refreshForwards({ silent: true });
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-fwd-remove")?.addEventListener("click", async () => {
      try {
        const data = await adbFetch("/network/forward", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serial: requireCurrentSerial(),
            direction: $("#adb-fwd-dir")?.value || "forward",
            local: $("#adb-fwd-local")?.value || "",
            remove: true,
          }),
        });
        toast(data.message || "已移除");
        await refreshForwards({ silent: true });
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-fwd-clear")?.addEventListener("click", async () => {
      try {
        if (!window.confirm("确认清除当前方向的全部端口转发？")) return;
        const data = await adbFetch("/network/forward", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serial: requireCurrentSerial(),
            direction: $("#adb-fwd-dir")?.value || "forward",
            removeAll: true,
          }),
        });
        toast(data.message || "已清除");
        await refreshForwards({ silent: true });
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });

    $("#adb-dev-refresh")?.addEventListener("click", () =>
      refreshDeveloper().catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-open-dev-page")?.addEventListener("click", () =>
      deviceControl("open_developer").catch((err) => setError(adbError, err.message || String(err)))
    );
    $$("[data-adb-dev]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const key = btn.dataset.adbDev;
          const raw = btn.dataset.adbDevVal;
          const value = raw === "1" || raw === "true";
          const data = await adbFetch("/developer", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ serial: requireCurrentSerial(), key, value }),
          });
          toast(data.message || "已更新");
          await refreshDeveloper({ silent: true });
        } catch (err) {
          setError(adbError, err.message || String(err));
        }
      });
    });
    $$("[data-adb-dev-quick]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          const action = btn.dataset.adbDevQuick;
          const data = await adbFetch("/device/control", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ serial: requireCurrentSerial(), action }),
          });
          toast(data.message || "已执行");
        } catch (err) {
          setError(adbError, err.message || String(err));
        }
      });
    });
    $("#adb-anim-apply")?.addEventListener("click", async () => {
      try {
        const data = await adbFetch("/developer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serial: requireCurrentSerial(),
            key: "animation_scale_all",
            value: $("#adb-anim-scale")?.value || "1",
          }),
        });
        toast(data.message || "动画倍率已应用");
        await refreshDeveloper({ silent: true });
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-apps-kind")?.addEventListener("change", () =>
      loadApps().catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-apps-filter")?.addEventListener("input", () => renderApps());
    adbAppsList?.addEventListener("change", (e) => {
      const check = e.target.closest("[data-adb-app-check]");
      if (!check) return;
      if (check.checked) {
        adbAppsList.querySelectorAll("[data-adb-app-check]").forEach((el) => {
          if (el !== check) el.checked = false;
        });
        setPermTarget(check.dataset.adbAppCheck);
      } else if (adbPermPackage === check.dataset.adbAppCheck) {
        setPermTarget("");
      }
    });
    adbAppsList?.addEventListener("click", async (e) => {
      if (e.target.closest("[data-adb-app-check]") || e.target.closest(".adb-app-select")) {
        // checkbox handled in change; allow label click without triggering action buttons
        if (!e.target.closest("button")) return;
      }
      const openBtn = e.target.closest("[data-adb-app-open]");
      const infoBtn = e.target.closest("[data-adb-app-info]");
      const uninstallBtn = e.target.closest("[data-adb-app-uninstall]");
      try {
        if (openBtn) {
          await runAppRowAction("open", openBtn.dataset.adbAppOpen);
          return;
        }
        if (infoBtn) {
          await runAppRowAction("info", infoBtn.dataset.adbAppInfo);
          return;
        }
        if (uninstallBtn) {
          await runAppRowAction("uninstall", uninstallBtn.dataset.adbAppUninstall);
        }
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    adbAppsList?.addEventListener("contextmenu", (e) => {
      const row = e.target.closest(".adb-app-row[data-adb-app-pkg]");
      if (!row) return;
      if (e.target.closest("button") || e.target.closest("input")) return;
      e.preventDefault();
      hideFsCtxMenu();
      showAppCtxMenu(row.dataset.adbAppPkg, e.clientX, e.clientY);
    });

    $("#adb-shot-selected")?.addEventListener("click", async () => {
      try {
        const serials = targetSerials(true);
        if (!serials.length) throw new Error("请选择设备");
        const data = await adbFetch("/media/screenshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serials }),
        });
        await trackJob(data.job);
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-shot-current")?.addEventListener("click", async () => {
      try {
        if (!adbSelected) throw new Error("请先选择当前设备");
        const data = await adbFetch("/media/screenshot", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serials: [adbSelected] }),
        });
        await trackJob(data.job);
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-record-current")?.addEventListener("click", async () => {
      try {
        if (!adbSelected) throw new Error("请先选择当前设备");
        const raw = $("#adb-record-sec")?.value;
        const seconds = raw === "" || raw == null ? 30 : Number(raw);
        if (seconds === 0) {
          updateRecordTip();
          toast("无时限录屏已开始，请稍后取消结束");
        }
        const data = await adbFetch("/media/record", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serial: adbSelected, seconds }),
        });
        await trackJob(data.job);
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-record-sec")?.addEventListener("input", updateRecordTip);
    $("#adb-record-cancel")?.addEventListener("click", async () => {
      try {
        const job = adbJobs.find(
          (j) =>
            j.type === "record" &&
            (j.status === "running" || j.status === "pending" || j.status === "queued")
        );
        if (!job) throw new Error("没有进行中的录屏任务");
        await cancelAdbJob(job.id);
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-media-zip")?.addEventListener("click", async () => {
      try {
        const done = (j) =>
          j.status === "done" || j.status === "completed" || j.status === "success" || j.status === "cancelled";
        const withArts = (adbJobs || []).filter((j) => (j.artifacts || []).length && done(j));
        const job =
          withArts.find((j) => j.type === "screenshot") ||
          withArts.find((j) => j.type === "record") ||
          withArts[0];
        if (!job) throw new Error("没有可打包的任务产物，请先截图/录屏并等待完成");
        await zipJobArtifacts(job.id);
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });

    $("#adb-jobs-refresh")?.addEventListener("click", () =>
      refreshJobs().catch((err) => setError(adbError, err.message || String(err)))
    );
    async function onAdbJobClick(e) {
      const cancelBtn = e.target.closest("[data-adb-job-cancel]");
      if (cancelBtn) {
        try {
          await cancelAdbJob(cancelBtn.dataset.adbJobCancel);
        } catch (err) {
          setError(adbError, err.message || String(err));
        }
        return;
      }
      const zipBtn = e.target.closest("[data-adb-job-zip]");
      if (zipBtn) {
        try {
          await zipJobArtifacts(zipBtn.dataset.adbJobZip);
        } catch (err) {
          setError(adbError, err.message || String(err));
        }
        return;
      }
      const btn = e.target.closest("[data-adb-art-job]");
      if (!btn) return;
      try {
        await downloadArtifact(btn.dataset.adbArtJob, btn.dataset.adbArtName);
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    }
    adbJobsList?.addEventListener("click", onAdbJobClick);
    $("#adb-media-jobs")?.addEventListener("click", onAdbJobClick);
    $("#adb-install-jobs")?.addEventListener("click", onAdbJobClick);
    $("#adb-media-preview")?.addEventListener("click", onAdbJobClick);

    $("#adb-snap-refresh")?.addEventListener("click", () =>
      loadSnapshot().catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-stay-on")?.addEventListener("click", () =>
      deviceControl("stay_awake_on").catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-stay-off")?.addEventListener("click", () =>
      deviceControl("stay_awake_off").catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-open-dev")?.addEventListener("click", () =>
      deviceControl("open_developer").catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-open-log")?.addEventListener("click", () =>
      deviceControl("open_logging").catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-usb-install")?.addEventListener("click", () =>
      deviceControl("enable_usb_install").catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-open-unknown")?.addEventListener("click", () =>
      deviceControl("open_install_unknown").catch((err) => setError(adbError, err.message || String(err)))
    );

    $("#adb-log-fetch")?.addEventListener("click", () =>
      fetchLogcat().catch((err) => setError(adbError, err.message || String(err)))
    );
    const adbLogLiveEl = $("#adb-log-live");
    if (adbLogLiveEl) {
      if (adbLogLiveEl.type === "checkbox") {
        adbLogLiveEl.addEventListener("change", () => {
          toggleAdbLogLive(adbLogLiveEl.checked);
        });
      } else {
        adbLogLiveEl.addEventListener("click", () => toggleAdbLogLive());
      }
    }
    $("#adb-log-clear")?.addEventListener("click", async () => {
      try {
        const serial = requireCurrentSerial();
        if (!window.confirm("确认清空设备 logcat 缓冲？")) return;
        await adbFetch("/logcat/clear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serial }),
        });
        toast("已清空日志缓冲");
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-log-copy")?.addEventListener("click", async () => {
      const text = $("#adb-log-out")?.textContent || "";
      if (!text || text === "尚未拉取") return;
      try {
        await navigator.clipboard.writeText(text);
        toast("日志已复制");
      } catch (_) {
        toast("复制失败");
      }
    });
    $("#adb-log-download")?.addEventListener("click", () => {
      const text = $("#adb-log-out")?.textContent || "";
      if (!text || text === "尚未拉取") return;
      const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `logcat-${adbSelected || "device"}-${Date.now()}.txt`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    });

    $("#adb-tap-run")?.addEventListener("click", async () => {
      try {
        await adbFetch("/input", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serial: requireCurrentSerial(),
            action: "tap",
            x: Number($("#adb-tap-x")?.value),
            y: Number($("#adb-tap-y")?.value),
          }),
        });
        toast("已点击");
        if (!$("#adb-input-canvas")?.hidden) afterInputPreviewAction();
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-swipe-run")?.addEventListener("click", async () => {
      try {
        await adbFetch("/input", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serial: requireCurrentSerial(),
            action: "swipe",
            x1: Number($("#adb-swipe-x1")?.value),
            y1: Number($("#adb-swipe-y1")?.value),
            x2: Number($("#adb-swipe-x2")?.value),
            y2: Number($("#adb-swipe-y2")?.value),
            duration: Number($("#adb-swipe-ms")?.value || 300),
          }),
        });
        toast("已滑动");
        if (!$("#adb-input-canvas")?.hidden) afterInputPreviewAction();
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $$("[data-adb-key]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await adbFetch("/input", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              serial: requireCurrentSerial(),
              action: "key",
              key: btn.dataset.adbKey,
            }),
          });
          toast(`按键 ${btn.dataset.adbKey}`);
          if (adbTab === "input" && !$("#adb-input-canvas")?.hidden) afterInputPreviewAction();
        } catch (err) {
          setError(adbError, err.message || String(err));
        }
      });
    });
    $("#adb-input-text-run")?.addEventListener("click", async () => {
      try {
        await adbFetch("/input", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serial: requireCurrentSerial(),
            action: "text",
            text: $("#adb-input-text")?.value || "",
          }),
        });
        toast("已输入文本");
        if (!$("#adb-input-canvas")?.hidden) afterInputPreviewAction();
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });
    $("#adb-input-refresh-shot")?.addEventListener("click", () =>
      refreshInputScreencap().catch((err) => setError(adbError, err.message || String(err)))
    );
    $("#adb-input-live-stop")?.addEventListener("click", () => {
      stopInputLivePreview();
      toast("已停止实时预览");
    });
    {
      const sizeEl = $("#adb-input-shot-size");
      sizeEl?.addEventListener("input", () => applyInputShotSize(sizeEl.value));
      sizeEl?.addEventListener("change", () => applyInputShotSize(sizeEl.value));
      $("#adb-input-shot-size-reset")?.addEventListener("click", () => {
        applyInputShotSize(ADB_INPUT_SHOT_VH_DEFAULT);
        toast("已恢复默认预览大小");
      });
      restoreInputShotSize();
    }
    {
      const canvas = $("#adb-input-canvas");
      const LONG_MS = 520;
      const DOUBLE_MS = 320;
      const MOVE_THRESH = 10;
      let drag = null;
      let longTimer = 0;
      let pendingTap = null; // { x, y, timer }

      const clearLongTimer = () => {
        if (longTimer) {
          clearTimeout(longTimer);
          longTimer = 0;
        }
      };
      const clearPendingTap = () => {
        if (pendingTap?.timer) clearTimeout(pendingTap.timer);
        pendingTap = null;
      };
      const sendInput = (body) =>
        adbFetch("/input", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serial: requireCurrentSerial(), ...body }),
        });

      canvas?.addEventListener("pointerdown", (e) => {
        if (!canvas.naturalWidth) return;
        canvas.setPointerCapture?.(e.pointerId);
        const pt = adbCanvasCoords(canvas, e.clientX, e.clientY);
        const now = Date.now();
        let asDouble = false;
        if (
          pendingTap &&
          now - pendingTap.at < DOUBLE_MS &&
          Math.abs(pt.x - pendingTap.x) + Math.abs(pt.y - pendingTap.y) <= 36
        ) {
          clearPendingTap();
          asDouble = true;
        }
        drag = {
          ...pt,
          moved: false,
          pointerId: e.pointerId,
          at: now,
          asDouble,
          fired: "",
        };
        clearLongTimer();
        if (!asDouble) {
          longTimer = setTimeout(async () => {
            longTimer = 0;
            if (!drag || drag.moved || drag.fired || drag.asDouble) return;
            drag.fired = "longpress";
            try {
              await sendInput({
                action: "longpress",
                x: drag.x,
                y: drag.y,
                duration: 1000,
              });
              if ($("#adb-tap-x")) $("#adb-tap-x").value = String(drag.x);
              if ($("#adb-tap-y")) $("#adb-tap-y").value = String(drag.y);
              toast(`已长按 ${drag.x},${drag.y}`);
              if ($("#adb-input-meta")) {
                $("#adb-input-meta").textContent = `长按 ${drag.x},${drag.y} · 单指手势：单击 / 长按 / 双击 / 拖拽`;
              }
              afterInputPreviewAction();
            } catch (err) {
              setError(adbError, err.message || String(err));
            }
          }, LONG_MS);
        }
        e.preventDefault();
      });
      canvas?.addEventListener("pointermove", (e) => {
        if (!drag || drag.pointerId !== e.pointerId) return;
        const pt = adbCanvasCoords(canvas, e.clientX, e.clientY);
        if (Math.abs(pt.x - drag.x) + Math.abs(pt.y - drag.y) > MOVE_THRESH) {
          drag.moved = true;
          clearLongTimer();
        }
      });
      canvas?.addEventListener("pointerup", async (e) => {
        if (!drag || drag.pointerId !== e.pointerId) return;
        const start = drag;
        drag = null;
        clearLongTimer();
        if (start.fired === "longpress") return;
        try {
          const end = adbCanvasCoords(canvas, e.clientX, e.clientY);
          if (start.moved) {
            clearPendingTap();
            await sendInput({
              action: "swipe",
              x1: start.x,
              y1: start.y,
              x2: end.x,
              y2: end.y,
              duration: Number($("#adb-swipe-ms")?.value || 300),
            });
            toast("已滑动");
            afterInputPreviewAction();
            return;
          }
          if (start.asDouble) {
            await sendInput({ action: "doubletap", x: start.x, y: start.y });
            if ($("#adb-tap-x")) $("#adb-tap-x").value = String(start.x);
            if ($("#adb-tap-y")) $("#adb-tap-y").value = String(start.y);
            toast(`已双击 ${start.x},${start.y}`);
            afterInputPreviewAction();
            return;
          }
          clearPendingTap();
          pendingTap = {
            x: start.x,
            y: start.y,
            at: Date.now(),
            timer: setTimeout(async () => {
              pendingTap = null;
              try {
                await sendInput({ action: "tap", x: start.x, y: start.y });
                if ($("#adb-tap-x")) $("#adb-tap-x").value = String(start.x);
                if ($("#adb-tap-y")) $("#adb-tap-y").value = String(start.y);
                toast(`已点击 ${start.x},${start.y}`);
                afterInputPreviewAction();
              } catch (err) {
                setError(adbError, err.message || String(err));
              }
            }, DOUBLE_MS),
          };
        } catch (err) {
          setError(adbError, err.message || String(err));
        }
      });
      canvas?.addEventListener("pointercancel", () => {
        clearLongTimer();
        drag = null;
      });
    }
    updateRecordTip();

    $("#adb-clip-run")?.addEventListener("click", async () => {
      try {
        const data = await adbFetch("/clipboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serial: requireCurrentSerial(),
            text: $("#adb-clip-text")?.value || "",
          }),
        });
        toast(data.note || "已推送剪贴板");
      } catch (err) {
        setError(adbError, err.message || String(err));
      }
    });

    const ua = navigator.userAgent || "";
    if (/Windows/i.test(ua)) {
      $("#adb-dl-win")?.classList.add("primary-btn");
      $("#adb-dl-win")?.classList.remove("secondary-btn");
    } else if (/Mac OS|Macintosh/i.test(ua)) {
      $("#adb-dl-mac")?.classList.add("primary-btn");
      $("#adb-dl-mac")?.classList.remove("secondary-btn");
    } else {
      $("#adb-dl-linux")?.classList.add("primary-btn");
      $("#adb-dl-linux")?.classList.remove("secondary-btn");
    }

    connectAdbBridge({ fromPoll: true }).catch(() => {});
  } catch (err) {
    console.error("adb tool init failed", err);
  }

  $$("[data-copy]").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      const target = document.getElementById(btn.dataset.copy);
      const text = target?.textContent || "";
      if (!text || text === "—") return;
      try {
        await navigator.clipboard.writeText(text);
        toast("已复制");
      } catch (_) {
        toast("复制失败");
      }
    });
  });
  $$("[data-copy-value]").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      const target = document.getElementById(btn.dataset.copyValue);
      const text = target?.value || "";
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        toast("已复制");
      } catch (_) {
        toast("复制失败");
      }
    });
  });
})();
