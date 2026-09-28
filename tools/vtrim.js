(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const P = window.DevToolsPure;
  const MIN_SPAN = 0.5;
  /** 少于这个时长的剪切不走「-c copy 快速剪切」：copy 只能按关键帧切，
   *  请求 0.8s 也可能导出 2s（整段 GOP）。重编码的输入定位是精确的，短片段必须走它。 */
  const COPY_MIN_SPAN = 2;
  const FILM_THUMBS = 18;

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
    }, 2000);
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

  function formatClock(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    const whole = Math.floor(r);
    const frac = Math.round((r - whole) * 10);
    if (frac > 0 && frac < 10) return `${m}:${String(whole).padStart(2, "0")}.${frac}`;
    return `${m}:${String(whole).padStart(2, "0")}`;
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function even(n) {
    const x = Math.max(2, Math.round(n));
    return x % 2 === 0 ? x : x - 1;
  }

  function parseAspect(aspect) {
    const a = String(aspect || "free");
    if (a === "free") return null;
    const [w, h] = a.split(":").map(Number);
    if (!(w > 0 && h > 0)) return null;
    return w / h;
  }

  function waitSeek(videoEl) {
    return new Promise((resolve) => {
      if (!videoEl) return resolve();
      const done = () => {
        videoEl.removeEventListener("seeked", done);
        resolve();
      };
      videoEl.addEventListener("seeked", done);
      setTimeout(done, 800);
    });
  }

  function hapticLight() {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(8);
      }
    } catch (_) {}
  }

  const fileInput = $("#vtrim-file");
  const clearBtn = $("#vtrim-clear");
  const undoBtn = $("#vtrim-undo");
  const resetBtn = $("#vtrim-reset");
  const meta = $("#vtrim-meta");
  const stage = $("#vtrim-stage");
  const previewWrap = $("#vtrim-preview-wrap");
  const video = $("#vtrim-video");
  const cropBox = $("#vtrim-crop-box");
  const tapPlay = $("#vtrim-tap-play");
  const filmLoading = $("#vtrim-film-loading");
  const playBtn = $("#vtrim-play");
  const muteBtn = $("#vtrim-mute");
  const clockEl = $("#vtrim-clock");
  const rangeLabel = $("#vtrim-range-label");
  const modeHint = $("#vtrim-mode-hint");
  const trimTools = $("#vtrim-trim-tools");
  const cropPanel = $("#vtrim-crop-panel");
  const timeline = $("#vtrim-timeline");
  const filmstrip = $("#vtrim-filmstrip");
  const selEl = $("#vtrim-sel");
  const handleStart = $("#vtrim-handle-start");
  const handleEnd = $("#vtrim-handle-end");
  const tipStart = $("#vtrim-tip-start");
  const tipEnd = $("#vtrim-tip-end");
  const playhead = $("#vtrim-playhead");
  const windowEl = $("#vtrim-window");

  // 独立胶片探针：抽帧不打断主预览（接近系统相册「边看边出条」）
  const filmVideo = document.createElement("video");
  filmVideo.muted = true;
  filmVideo.preload = "auto";
  filmVideo.playsInline = true;
  filmVideo.setAttribute("playsinline", "");
  filmVideo.setAttribute("webkit-playsinline", "");
  filmVideo.setAttribute("aria-hidden", "true");
  filmVideo.tabIndex = -1;
  filmVideo.style.cssText =
    "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1";
  document.body.appendChild(filmVideo);
  const nudgeStartM = $("#vtrim-nudge-start-m");
  const nudgeStartP = $("#vtrim-nudge-start-p");
  const nudgeEndM = $("#vtrim-nudge-end-m");
  const nudgeEndP = $("#vtrim-nudge-end-p");
  const cropEnable = $("#vtrim-crop-enable");
  const cropResetBtn = $("#vtrim-crop-reset");
  const rotL = $("#vtrim-rot-l");
  const rotR = $("#vtrim-rot-r");
  const flipHBtn = $("#vtrim-flip-h");
  const exportBar = $("#vtrim-export-bar");
  const summaryEl = $("#vtrim-summary");
  const exportBtn = $("#vtrim-export");
  const abortBtn = $("#vtrim-abort");
  const downloadA = $("#vtrim-download");
  const progress = $("#vtrim-progress");
  const progressFill = $("#vtrim-progress-fill");
  const progressText = $("#vtrim-progress-text");
  const progressPct = $("#vtrim-progress-pct");
  const progressSub = $("#vtrim-progress-sub");
  const resultBlock = $("#vtrim-result-block");
  const resultMeta = $("#vtrim-result-meta");
  const resultVideo = $("#vtrim-result");
  const resultAudio = $("#vtrim-result-audio");
  const cropLive = $("#vtrim-crop-live");
  const errorEl = $("#vtrim-error");
  const shareTip = $("#vtrim-share-tip");
  const bridgeWrap = $("#vtrim-bridge");
  const bridgeDot = $("#vtrim-bridge-dot");
  const bridgeTitle = $("#vtrim-bridge-title");
  const bridgeText = $("#vtrim-bridge-text");
  const preferBridgeEl = $("#vtrim-prefer-bridge");
  const bridgeReconnectBtn = $("#vtrim-bridge-reconnect");

  const DEFAULT_BRIDGE_TOKEN = "devtools-bridge";
  const PREFER_BRIDGE_KEY = "devtools-vtrim-prefer-bridge";

  /** @type {{ ok: boolean, base: string, prefix: string, token: string, version: string }} */
  let bridge = { ok: false, base: "", prefix: "/ff", token: DEFAULT_BRIDGE_TOKEN, version: "" };
  let bridgeJobId = "";

  /** @type {Blob|null} */
  let latestExportBlob = null;
  let latestExportName = "trimmed.mp4";

  function mediaApi() {
    return window.DevToolsExtraMedia || {};
  }

  function preferGalleryShare() {
    const M = mediaApi();
    return typeof M.preferShareToGallery === "function" && M.preferShareToGallery();
  }

  /** 电脑侧展示桥加速；手机仍用网页编码 */
  function isDesktopExportTarget() {
    const M = mediaApi();
    if (typeof M.isLikelyMobileMedia === "function" && M.isLikelyMobileMedia()) return false;
    try {
      if (window.matchMedia("(pointer: coarse)").matches && !window.matchMedia("(pointer: fine)").matches) {
        return false;
      }
    } catch (_) {}
    return true;
  }

  function storedBridgeToken() {
    try {
      return (
        localStorage.getItem("devtools-ffmpeg-token") ||
        localStorage.getItem("devtools-bridge-token") ||
        DEFAULT_BRIDGE_TOKEN
      );
    } catch {
      return DEFAULT_BRIDGE_TOKEN;
    }
  }

  function storedBridgeBase() {
    try {
      return (localStorage.getItem("devtools-ffmpeg-base") || "http://127.0.0.1:17888").replace(/\/$/, "");
    } catch {
      return "http://127.0.0.1:17888";
    }
  }

  function prefixFromHealth(health) {
    if (!health) return "/ff";
    if (health.service === "devtools-ffmpeg-bridge") return "";
    if (
      health.unified ||
      health.service === "devtools-bridge" ||
      health.ffmpegMount === "/ff" ||
      health.capabilities?.ffmpeg ||
      health.embedded
    ) {
      return "/ff";
    }
    if (health.service === "devtools-bridge-ffmpeg") return "/ff";
    return "/ff";
  }

  function readPreferBridge() {
    try {
      const v = localStorage.getItem(PREFER_BRIDGE_KEY);
      if (v === "0") return false;
      if (v === "1") return true;
    } catch (_) {}
    return true;
  }

  function writePreferBridge(on) {
    try {
      localStorage.setItem(PREFER_BRIDGE_KEY, on ? "1" : "0");
    } catch (_) {}
  }

  function paintBridge() {
    const desktop = isDesktopExportTarget();
    if (bridgeWrap) bridgeWrap.hidden = !desktop;
    if (!desktop) return;
    const ok = bridge.ok;
    bridgeDot?.classList.toggle("is-ok", ok);
    bridgeDot?.classList.toggle("is-err", !ok);
    if (bridgeTitle) {
      bridgeTitle.textContent = ok ? `本机桥已连接 · v${bridge.version || "?"}` : "未连接本机桥";
    }
    if (bridgeText) {
      bridgeText.textContent = ok
        ? "导出可走系统 FFmpeg（仅 127.0.0.1，不上传公网）"
        : "启动统一桥后点「重新连接」，大文件/重编码会快很多";
    }
    if (preferBridgeEl) preferBridgeEl.checked = readPreferBridge();
  }

  async function probeBridge({ launch = false } = {}) {
    if (!isDesktopExportTarget()) {
      bridge.ok = false;
      paintBridge();
      return false;
    }
    const token = storedBridgeToken();
    bridge.token = token;
    let base = storedBridgeBase();
    let prefix = "/ff";
    let rootHealth = null;
    try {
      const discovered = await window.devtoolsBridgeToken?.discoverBase?.(base, token, { kind: "unified" });
      if (discovered?.base) base = String(discovered.base).replace(/\/$/, "");
      rootHealth = discovered?.health || null;
      prefix = prefixFromHealth(rootHealth);
    } catch (_) {}

    const candidates = [
      { base, prefix },
      { base: "http://127.0.0.1:17888", prefix: "/ff" },
      { base: "http://127.0.0.1:17889", prefix: "" },
    ];
    const seen = new Set();
    for (const c of candidates) {
      const key = `${c.base}|${c.prefix}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const res = await fetch(`${c.base}${c.prefix}/health`, {
          headers: { "X-Ffmpeg-Token": token, "X-Adb-Token": token },
          cache: "no-store",
          mode: "cors",
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (!data?.ok) continue;
        bridge = {
          ok: true,
          base: c.base,
          prefix: c.prefix,
          token,
          version: data.version || rootHealth?.version || "",
        };
        paintBridge();
        return true;
      } catch (_) {}
    }

    if (launch && window.devtoolsBridgeToken?.readAutoStart?.() !== false) {
      try {
        const found = await window.devtoolsBridgeToken.ensureBridgeRunning?.({
          preferredBase: storedBridgeBase(),
          token,
          timeoutMs: 10000,
          launch: true,
          kind: "unified",
        });
        if (found?.health) {
          bridge = {
            ok: true,
            base: found.base,
            prefix: prefixFromHealth(found.health),
            token,
            version: found.health.version || "",
          };
          paintBridge();
          return true;
        }
      } catch (_) {}
    }
    bridge.ok = false;
    paintBridge();
    return false;
  }

  async function bridgeFetch(pathname, opts = {}) {
    if (!bridge.ok) throw new Error("本机桥未连接");
    const headers = Object.assign({}, opts.headers || {});
    headers["X-Ffmpeg-Token"] = bridge.token;
    headers["X-Adb-Token"] = bridge.token;
    const res = await fetch(`${bridge.base}${bridge.prefix}${pathname}`, { ...opts, headers });
    if (!res.ok) {
      let msg = `桥请求失败 HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j?.error) msg = j.error;
      } catch (_) {}
      throw new Error(msg);
    }
    return res;
  }

  function shouldUseBridge() {
    if (!isDesktopExportTarget()) return false;
    if (!bridge.ok) return false;
    if (preferBridgeEl) return Boolean(preferBridgeEl.checked);
    return readPreferBridge();
  }

  function syncShareUi() {
    try {
      mediaApi().revealAutoShareGalleryUi?.();
    } catch (_) {}
    const shareOk = preferGalleryShare();
    if (shareTip) shareTip.hidden = !shareOk;
    if (downloadA && !downloadA.hidden) {
      if (shareOk) {
        downloadA.textContent = latestExportName.endsWith(".mp3") || latestExportName.endsWith(".m4a")
          ? "分享/保存音频"
          : "分享到相册";
        downloadA.title = "调起系统分享，可选存到相册或文件";
      } else {
        downloadA.textContent = "下载结果";
        downloadA.removeAttribute("title");
      }
    }
  }

  async function deliverExportBlob(blob, fname, { auto = false } = {}) {
    const M = mediaApi();
    const shareOk = preferGalleryShare();
    const autoShare =
      auto &&
      typeof M.isAutoShareGalleryEnabled === "function" &&
      M.isAutoShareGalleryEnabled() &&
      shareOk &&
      typeof M.shareMediaBlob === "function";

    if (autoShare || (shareOk && !auto && typeof M.shareMediaBlob === "function")) {
      const r = await M.shareMediaBlob(blob, fname, {
        title: fname,
        fallbackDownload: true,
      });
      if (r.shared) {
        toast("已调起系统分享 · 可选存到相册");
        return { shared: true };
      }
      if (r.cancelled) {
        toast("已取消分享");
        return { cancelled: true };
      }
      if (r.downloaded) {
        toast(auto ? `已下载 · ${fname}` : `无法分享，已改为下载`);
        return { downloaded: true };
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {}
    }, 2000);
    return { downloaded: true };
  }

  if (!fileInput || !video) return;

  let sourceFile = null;
  let objectUrl = "";
  let duration = 0;
  let startSec = 0;
  let endSec = 0;
  let muted = true;
  let playing = false;
  let busy = false;
  let abortFlag = false;
  let aspect = "free";
  /** crop in source pixel space (pre-rotate display uses CSS; export uses rotate then crop on rotated frame) */
  let crop = { x: 0, y: 0, w: 1, h: 1 };
  let rotate = 0; // 0|90|180|270
  let flipH = false;
  let resultUrl = "";
  let drag = null;
  let filmReady = false;
  let filmGen = 0;
  let activeHandle = "start";
  let editMode = "trim"; // trim | crop
  let lastSeekAt = 0;
  let pendingSeek = null;
  let scrubSeekWanted = null;
  let scrubSeekInflight = false;
  let playheadRaf = 0;
  let previewScrub = null;
  let exportQuality = "fast"; // fast | hq
  let exportTrack = "av"; // av | video | audio
  let exportAudioFmt = "m4a"; // m4a | mp3 (仅音频时)
  let cropLiveRaf = 0;
  /** @type {object[]} */
  let history = [];
  let applyingHistory = false;
  const SNAP_SEC = 0.12;
  const HISTORY_MAX = 30;

  const DEFAULT_META =
    "支持 MP4 / WebM / MOV。选择后仅本机读取，不会上传。关闭页面会释放本次视频。";

  function engine() {
    return window.DevToolsFfmpeg || null;
  }

  function setProgress(visible, ratio, text, opts = {}) {
    if (!progress) return;
    progress.hidden = !visible;
    const r = clamp(Number(ratio) || 0, 0, 1);
    if (progressFill) {
      progressFill.style.width = `${Math.round(r * 100)}%`;
      progressFill.classList.toggle("is-active", visible);
      progressFill.classList.toggle("is-busy", Boolean(opts.busy));
    }
    if (progressPct) {
      progressPct.hidden = !visible;
      progressPct.textContent = `${Math.round(r * 100)}%`;
    }
    if (progressText) progressText.textContent = text || "";
    if (progressSub) {
      const sub = opts.sub || "";
      progressSub.textContent = sub;
      progressSub.hidden = !sub;
    }
  }

  function revokeResult() {
    if (resultUrl) {
      try {
        URL.revokeObjectURL(resultUrl);
      } catch (_) {}
      resultUrl = "";
    }
    if (resultVideo) {
      resultVideo.removeAttribute("src");
      resultVideo.hidden = true;
      try {
        resultVideo.load();
      } catch (_) {}
    }
    if (resultAudio) {
      resultAudio.removeAttribute("src");
      resultAudio.hidden = true;
      try {
        resultAudio.load();
      } catch (_) {}
    }
    if (downloadA) {
      downloadA.hidden = true;
      downloadA.removeAttribute("href");
      downloadA.textContent = "下载结果";
      downloadA.removeAttribute("title");
    }
    latestExportBlob = null;
    latestExportName = "trimmed.mp4";
    if (resultBlock) resultBlock.hidden = true;
    if (resultMeta) resultMeta.textContent = "";
  }

  function snapshotState() {
    return {
      startSec,
      endSec,
      crop: { ...crop },
      rotate,
      flipH,
      aspect,
      cropOn: Boolean(cropEnable?.checked),
      editMode,
    };
  }

  function pushHistory() {
    if (applyingHistory || !sourceFile) return;
    const snap = snapshotState();
    const last = history[history.length - 1];
    if (last && JSON.stringify(last) === JSON.stringify(snap)) return;
    history.push(snap);
    if (history.length > HISTORY_MAX) history.shift();
    setButtons();
  }

  function applySnapshot(snap) {
    if (!snap) return;
    applyingHistory = true;
    startSec = snap.startSec;
    endSec = snap.endSec;
    crop = { ...snap.crop };
    rotate = snap.rotate;
    flipH = snap.flipH;
    aspect = snap.aspect || "free";
    if (cropEnable) cropEnable.checked = snap.cropOn !== false;
    editMode = snap.editMode === "crop" ? "crop" : "trim";
    syncAspectUi();
    syncModeUi();
    applyVideoTransform();
    layoutCropBox();
    seekTo(startSec, { immediate: true });
    paintTimeline();
    updateLabels();
    updateSummary();
    applyingHistory = false;
    setButtons();
  }

  function undoEdit() {
    if (history.length < 2) {
      toast("没有可撤销的步骤");
      return;
    }
    history.pop(); // drop current
    const prev = history[history.length - 1];
    applySnapshot(prev);
    toast("已撤销");
  }

  function clearAll() {
    abortFlag = true;
    try {
      video.pause();
    } catch (_) {}
    if (objectUrl) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch (_) {}
      objectUrl = "";
    }
    sourceFile = null;
    duration = 0;
    startSec = 0;
    endSec = 0;
    crop = { x: 0, y: 0, w: 1, h: 1 };
    rotate = 0;
    flipH = false;
    aspect = "free";
    filmReady = false;
    filmGen += 1;
    playing = false;
    editMode = "trim";
    history = [];
    exportQuality = "fast";
    exportTrack = "av";
    exportAudioFmt = "m4a";
    document.querySelectorAll("[data-vtrim-quality]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.vtrimQuality === "fast");
    });
    document.querySelectorAll("[data-vtrim-track]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.vtrimTrack === "av");
    });
    document.querySelectorAll("[data-vtrim-audio-fmt]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.vtrimAudioFmt === "m4a");
    });
    const audioFmtSeg = $("#vtrim-audio-fmt-seg");
    if (audioFmtSeg) audioFmtSeg.hidden = true;
    if (cropLive) cropLive.hidden = true;
    if (filmLoading) {
      filmLoading.hidden = true;
      filmLoading.textContent = "正在生成胶片预览…";
    }
    previewWrap?.classList.remove("is-film-loading", "is-playing");
    timeline?.classList.remove("is-dragging", "is-dragging-window", "is-min-span", "is-pulse");
    if (tipStart) tipStart.hidden = true;
    if (tipEnd) tipEnd.hidden = true;
    if (exportBar) exportBar.hidden = true;
    revokeResult();
    video.removeAttribute("src");
    try {
      video.load();
    } catch (_) {}
    filmVideo.removeAttribute("src");
    try {
      filmVideo.load();
    } catch (_) {}
    if (stage) stage.hidden = true;
    if (meta) meta.textContent = DEFAULT_META;
    setError(errorEl, "");
    setProgress(false, 0, "");
    syncAspectUi();
    syncMuteUi();
    syncCropBoxVisibility();
    setButtons();
    paintTimeline();
  }

  function resetEdit() {
    if (!duration) return;
    pushHistory();
    startSec = 0;
    endSec = duration;
    crop = { x: 0, y: 0, w: video.videoWidth || 1, h: video.videoHeight || 1 };
    rotate = 0;
    flipH = false;
    aspect = "free";
    if (cropEnable) cropEnable.checked = true;
    syncAspectUi();
    applyVideoTransform();
    layoutCropBox();
    seekTo(startSec);
    paintTimeline();
    updateLabels();
    updateSummary();
    pushHistory();
    setButtons();
    toast("已重置为全长、未裁剪");
  }

  function setButtons() {
    const has = Boolean(sourceFile && duration > 0);
    if (playBtn) playBtn.disabled = !has || busy;
    if (muteBtn) muteBtn.disabled = !has;
    if (resetBtn) resetBtn.disabled = !has || busy;
    if (undoBtn) undoBtn.disabled = !has || busy || history.length < 2;
    if (exportBtn) {
      exportBtn.disabled = !has || busy;
      exportBtn.textContent =
        exportTrack === "audio" ? "导出音频" : exportTrack === "video" ? "导出无声视频" : "导出视频";
    }
    const audioFmtSeg = $("#vtrim-audio-fmt-seg");
    if (audioFmtSeg) audioFmtSeg.hidden = exportTrack !== "audio" || !has;
    if (rotL) rotL.disabled = !has || busy;
    if (rotR) rotR.disabled = !has || busy;
    if (flipHBtn) flipHBtn.disabled = !has || busy;
    if (cropResetBtn) cropResetBtn.disabled = !has || busy;
    if (abortBtn) abortBtn.hidden = !busy;
    if (tapPlay) tapPlay.hidden = !has;
    if (exportBar) exportBar.hidden = !has;
    [nudgeStartM, nudgeStartP, nudgeEndM, nudgeEndP].forEach((btn) => {
      if (btn) btn.disabled = !has || busy;
    });
    syncActiveHandleUi();
    syncModeUi();
  }

  function syncActiveHandleUi() {
    handleStart?.classList.toggle("is-active", activeHandle === "start");
    handleEnd?.classList.toggle("is-active", activeHandle === "end");
  }

  function syncModeUi() {
    document.querySelectorAll("[data-vtrim-mode]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.vtrimMode === editMode);
    });
    if (trimTools) trimTools.hidden = editMode !== "trim";
    if (cropPanel) cropPanel.hidden = editMode !== "crop";
    if (modeHint) {
      modeHint.textContent =
        editMode === "crop"
          ? "拖绿框裁边框 · 双击重置 · 预览区左右滑 scrub"
          : "拖黄框两端看时间气泡 · 预览区点按播放 · 左右滑 scrub";
    }
    // crop overlay only in crop mode (and when enabled)
    syncCropBoxVisibility();
    stage?.classList.toggle("is-mode-crop", editMode === "crop");
    stage?.classList.toggle("is-mode-trim", editMode === "trim");
    scheduleCropLive();
  }

  function syncMuteUi() {
    video.muted = muted;
    if (muteBtn) {
      muteBtn.textContent = muted ? "开声音" : "静音";
      muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    }
  }

  function syncAspectUi() {
    document.querySelectorAll("[data-vtrim-aspect]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.vtrimAspect === aspect);
    });
  }

  function syncCropBoxVisibility() {
    const on = editMode === "crop" && Boolean(cropEnable?.checked) && Boolean(sourceFile);
    if (cropBox) cropBox.hidden = !on;
    if (previewWrap) previewWrap.classList.toggle("is-cropping", on);
  }

  function applyVideoTransform() {
    const parts = [];
    if (rotate) parts.push(`rotate(${rotate}deg)`);
    if (flipH) parts.push("scaleX(-1)");
    video.style.transform = parts.length ? parts.join(" ") : "";
    video.style.transformOrigin = "center center";
  }

  function displaySize() {
    const vw = video.videoWidth || 1;
    const vh = video.videoHeight || 1;
    const swapped = rotate === 90 || rotate === 270;
    return { w: swapped ? vh : vw, h: swapped ? vw : vh, srcW: vw, srcH: vh };
  }

  /** Map source crop rect into display (after rotate/flip) space for overlay */
  function cropToDisplayRect() {
    const { w: dw, h: dh, srcW, srcH } = displaySize();
    const mapPoint = (cx, cy) => {
      let nx = cx;
      let ny = cy;
      if (rotate === 90) {
        nx = srcH - cy;
        ny = cx;
      } else if (rotate === 180) {
        nx = srcW - cx;
        ny = srcH - cy;
      } else if (rotate === 270) {
        nx = cy;
        ny = srcW - cx;
      }
      if (flipH) nx = dw - nx;
      return [nx, ny];
    };
    const x = crop.x;
    const y = crop.y;
    const w = crop.w;
    const h = crop.h;
    const pts = [
      mapPoint(x, y),
      mapPoint(x + w, y),
      mapPoint(x + w, y + h),
      mapPoint(x, y + h),
    ];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const right = Math.max(...xs);
    const bottom = Math.max(...ys);
    return {
      x: clamp(left, 0, dw),
      y: clamp(top, 0, dh),
      w: clamp(right - left, 1, dw),
      h: clamp(bottom - top, 1, dh),
      dw,
      dh,
    };
  }

  function displayRectToCrop(dx, dy, dwBox, dhBox) {
    const { w: dw, h: dh, srcW, srcH } = displaySize();
    const unmap = (px, py) => {
      let nx = px;
      let ny = py;
      if (flipH) nx = dw - nx;
      if (rotate === 90) {
        const sx = ny;
        const sy = srcH - nx;
        return [sx, sy];
      }
      if (rotate === 180) return [srcW - nx, srcH - ny];
      if (rotate === 270) {
        const sx = srcW - ny;
        const sy = nx;
        return [sx, sy];
      }
      return [nx, ny];
    };
    const pts = [
      unmap(dx, dy),
      unmap(dx + dwBox, dy),
      unmap(dx + dwBox, dy + dhBox),
      unmap(dx, dy + dhBox),
    ];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    let x = Math.min(...xs);
    let y = Math.min(...ys);
    let w = Math.max(...xs) - x;
    let h = Math.max(...ys) - y;
    x = clamp(x, 0, srcW - 1);
    y = clamp(y, 0, srcH - 1);
    w = clamp(w, 1, srcW - x);
    h = clamp(h, 1, srcH - y);
    crop = { x, y, w, h };
  }

  function videoContentRect() {
    const wrap = previewWrap.getBoundingClientRect();
    const { w: dw, h: dh } = displaySize();
    const scale = Math.min(wrap.width / dw, wrap.height / dh);
    const rw = dw * scale;
    const rh = dh * scale;
    const left = (wrap.width - rw) / 2;
    const top = (wrap.height - rh) / 2;
    return { left, top, width: rw, height: rh, scale, dw, dh };
  }

  function layoutCropBox() {
    if (!cropBox || cropBox.hidden || !video.videoWidth) {
      scheduleCropLive();
      return;
    }
    const geom = videoContentRect();
    const d = cropToDisplayRect();
    const left = geom.left + (d.x / d.dw) * geom.width;
    const top = geom.top + (d.y / d.dh) * geom.height;
    const width = (d.w / d.dw) * geom.width;
    const height = (d.h / d.dh) * geom.height;
    cropBox.style.left = `${left}px`;
    cropBox.style.top = `${top}px`;
    cropBox.style.width = `${width}px`;
    cropBox.style.height = `${height}px`;
    scheduleCropLive();
  }

  function fitCropToAspect() {
    if (!video.videoWidth) return;
    const { w: dw, h: dh, srcW, srcH } = displaySize();
    // Fit aspect in *display* space, then map back to source crop.
    let x = 0;
    let y = 0;
    let w = dw;
    let h = dh;
    const ratio = parseAspect(aspect);
    if (ratio) {
      if (dw / dh > ratio) {
        h = dh;
        w = h * ratio;
        x = (dw - w) / 2;
        y = 0;
      } else {
        w = dw;
        h = w / ratio;
        x = 0;
        y = (dh - h) / 2;
      }
    } else if (P?.calcCropRect) {
      const rect = P.calcCropRect(srcW, srcH, { aspect: "free", center: true });
      crop = { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
      layoutCropBox();
      return;
    } else {
      crop = { x: 0, y: 0, w: srcW, h: srcH };
      layoutCropBox();
      return;
    }
    displayRectToCrop(x, y, w, h);
    layoutCropBox();
  }

  function syncHandleTips() {
    if (tipStart) tipStart.textContent = formatClock(startSec);
    if (tipEnd) tipEnd.textContent = formatClock(endSec);
    const dragging = Boolean(drag);
    const showStart = dragging && (drag.kind === "start" || drag.kind === "window");
    const showEnd = dragging && (drag.kind === "end" || drag.kind === "window");
    if (tipStart) tipStart.hidden = !showStart;
    if (tipEnd) tipEnd.hidden = !showEnd;
  }

  function previewSeek(t) {
    scrubSeekWanted = clamp(t, 0, Math.max(0, duration - 0.04));
    pumpPreviewScrubSeek();
  }

  function updateLabels() {
    const now = video.currentTime || startSec;
    if (clockEl) clockEl.textContent = `${formatClock(now)} / ${formatClock(duration)}`;
    const span = Math.max(0, endSec - startSec);
    if (rangeLabel) {
      rangeLabel.textContent = `保留 ${formatClock(span)}（${formatClock(startSec)}–${formatClock(endSec)}）`;
    }
    syncHandleTips();
    updateSummary();
  }

  function estimateOutSize() {
    const d = cropToDisplayRect();
    const cropOn = editMode === "crop" ? Boolean(cropEnable?.checked) : Boolean(cropEnable?.checked);
    const full =
      Math.abs(crop.x) < 1 &&
      Math.abs(crop.y) < 1 &&
      Math.abs(crop.w - (video.videoWidth || 0)) < 2 &&
      Math.abs(crop.h - (video.videoHeight || 0)) < 2;
    const useCrop = Boolean(cropEnable?.checked) && !full;
    let w = video.videoWidth || 0;
    let h = video.videoHeight || 0;
    if (rotate === 90 || rotate === 270) {
      const t = w;
      w = h;
      h = t;
    }
    if (useCrop) {
      w = Math.round(d.w);
      h = Math.round(d.h);
    }
    return { w: even(w), h: even(h), useCrop, reencode: useCrop || rotate !== 0 || flipH };
  }

  function updateSummary() {
    if (!summaryEl) return;
    if (!sourceFile || !duration) {
      summaryEl.textContent = "—";
      return;
    }
    const span = endSec - startSec;
    const trackLabel =
      exportTrack === "audio" ? "仅音频" : exportTrack === "video" ? "仅视频" : "音视频";
    if (exportTrack === "audio") {
      const af = exportAudioFmt === "mp3" ? "MP3" : "M4A";
      summaryEl.textContent = `将导出 ${formatClock(span)} · ${trackLabel} · ${af}`;
      return;
    }
    const est = estimateOutSize();
    const mode = est.reencode
      ? `重编码 · ${exportQuality === "hq" ? "清晰" : "快速"}`
      : "快速剪切";
    summaryEl.textContent = `将导出 ${formatClock(span)} · ${est.w}×${est.h} · ${trackLabel} · ${mode}`;
  }

  function paintCropLive() {
    if (!cropLive || !video?.videoWidth || !sourceFile) {
      if (cropLive) cropLive.hidden = true;
      return;
    }
    const show = editMode === "crop" && Boolean(cropEnable?.checked);
    cropLive.hidden = !show;
    if (!show) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const maxW = 160;
    const maxH = 90;
    const sx = Math.max(0, crop.x);
    const sy = Math.max(0, crop.y);
    const sw = Math.max(2, crop.w);
    const sh = Math.max(2, crop.h);
    let outW = sw;
    let outH = sh;
    if (rotate === 90 || rotate === 270) {
      outW = sh;
      outH = sw;
    }
    const scale = Math.min(maxW / outW, maxH / outH, 1);
    const cssW = Math.max(48, Math.round(outW * scale));
    const cssH = Math.max(28, Math.round(outH * scale));
    cropLive.width = Math.round(cssW * dpr);
    cropLive.height = Math.round(cssH * dpr);
    cropLive.style.width = `${cssW}px`;
    cropLive.style.height = `${cssH}px`;
    const ctx = cropLive.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = window.DevToolsTheme?.stageBg?.() || "#0a101c";
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.save();
    ctx.translate(cssW / 2, cssH / 2);
    if (rotate) ctx.rotate((rotate * Math.PI) / 180);
    if (flipH) ctx.scale(-1, 1);
    const drawW = rotate === 90 || rotate === 270 ? cssH : cssW;
    const drawH = rotate === 90 || rotate === 270 ? cssW : cssH;
    try {
      ctx.drawImage(video, sx, sy, sw, sh, -drawW / 2, -drawH / 2, drawW, drawH);
    } catch (_) {}
    ctx.restore();
  }

  function scheduleCropLive() {
    cancelAnimationFrame(cropLiveRaf);
    cropLiveRaf = requestAnimationFrame(() => paintCropLive());
  }

  function paintTimeline() {
    if (!selEl || !duration) {
      if (selEl) {
        selEl.style.setProperty("--vtrim-start", "0%");
        selEl.style.setProperty("--vtrim-end", "100%");
        selEl.style.setProperty("--vtrim-play", "0%");
      }
      return;
    }
    const sPct = (startSec / duration) * 100;
    const ePct = (endSec / duration) * 100;
    const pPct = ((video.currentTime || 0) / duration) * 100;
    selEl.style.setProperty("--vtrim-start", `${sPct}%`);
    selEl.style.setProperty("--vtrim-end", `${ePct}%`);
    selEl.style.setProperty("--vtrim-play", `${clamp(pPct, 0, 100)}%`);
    if (handleStart) {
      handleStart.setAttribute("aria-valuemin", "0");
      handleStart.setAttribute("aria-valuemax", String(endSec - MIN_SPAN));
      handleStart.setAttribute("aria-valuenow", String(startSec));
    }
    if (handleEnd) {
      handleEnd.setAttribute("aria-valuemin", String(startSec + MIN_SPAN));
      handleEnd.setAttribute("aria-valuemax", String(duration));
      handleEnd.setAttribute("aria-valuenow", String(endSec));
    }
  }

  async function ensureFilmProbe() {
    if (!objectUrl) return false;
    if (filmVideo.src !== objectUrl) {
      filmVideo.src = objectUrl;
    }
    if (filmVideo.videoWidth > 0 && filmVideo.readyState >= 1) return true;
    try {
      await new Promise((resolve, reject) => {
        const onMeta = () => {
          cleanup();
          resolve();
        };
        const onErr = () => {
          cleanup();
          reject(new Error("film meta"));
        };
        const cleanup = () => {
          filmVideo.removeEventListener("loadedmetadata", onMeta);
          filmVideo.removeEventListener("error", onErr);
        };
        filmVideo.addEventListener("loadedmetadata", onMeta);
        filmVideo.addEventListener("error", onErr);
        if (filmVideo.readyState >= 1 && filmVideo.videoWidth) {
          cleanup();
          resolve();
        }
      });
      return filmVideo.videoWidth > 0;
    } catch (_) {
      return false;
    }
  }

  async function buildFilmstrip() {
    if (!filmstrip || !duration) return;
    const gen = ++filmGen;
    filmReady = false;
    if (filmLoading) {
      filmLoading.hidden = false;
      filmLoading.textContent = "正在生成胶片预览…";
    }
    previewWrap?.classList.add("is-film-loading");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = timeline?.clientWidth || 640;
    const cssH = Math.max(56, Math.min(72, timeline?.clientHeight || 64));
    filmstrip.width = Math.round(cssW * dpr);
    filmstrip.height = Math.round(cssH * dpr);
    filmstrip.style.width = "100%";
    filmstrip.style.height = `${cssH}px`;
    const ctx = filmstrip.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = window.DevToolsTheme?.stageBg?.() || "#0a101c";
    ctx.fillRect(0, 0, cssW, cssH);
    const nBase = Math.min(36, Math.max(12, Math.round(cssW / 36)));
    // 长视频少抽帧，减轻手机/长片卡顿
    const n =
      duration > 900 ? Math.min(nBase, 10) : duration > 300 ? Math.min(nBase, 14) : duration > 120 ? Math.min(nBase, 20) : nBase;
    const tw = cssW / n;

    const probeOk = await ensureFilmProbe();
    if (gen !== filmGen) return;
    // 探针失败时回退主视频（会短暂打断预览，但保证胶片仍能出）
    const probe = probeOk ? filmVideo : video;
    const pauseMain = probe === video;
    const wasTime = pauseMain ? video.currentTime : 0;
    const wasPaused = pauseMain ? video.paused : true;
    if (pauseMain) {
      try {
        video.pause();
      } catch (_) {}
    }

    for (let i = 0; i < n; i++) {
      if (gen !== filmGen) return;
      const t = (duration * i) / Math.max(1, n - 1);
      try {
        probe.currentTime = Math.min(duration - 0.05, Math.max(0, t));
        await waitSeek(probe);
        if (gen !== filmGen) return;
        const vw = probe.videoWidth || video.videoWidth;
        const vh = probe.videoHeight || video.videoHeight;
        if (!(vw > 0 && vh > 0)) throw new Error("no frame");
        const scale = Math.max(tw / vw, cssH / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        ctx.drawImage(probe, i * tw + (tw - dw) / 2, (cssH - dh) / 2, dw, dh);
      } catch (_) {
        ctx.fillStyle = window.DevToolsTheme?.cssVar?.("--bg-1") || window.DevToolsTheme?.stageBg?.() || "#1a2436";
        ctx.fillRect(i * tw, 0, tw, cssH);
      }
      if (filmLoading) filmLoading.textContent = `胶片预览 ${i + 1}/${n}`;
      // 让出一帧，选片后仍可点播放 / 拖黄框
      await new Promise((r) => requestAnimationFrame(r));
    }

    if (pauseMain) {
      try {
        video.currentTime = clamp(wasTime, startSec, Math.max(startSec, endSec - 0.04));
        await waitSeek(video);
        if (!wasPaused) video.play().catch(() => {});
      } catch (_) {}
    }
    if (gen !== filmGen) return;
    filmReady = true;
    if (filmLoading) {
      filmLoading.hidden = true;
      filmLoading.textContent = "正在生成胶片预览…";
    }
    previewWrap?.classList.remove("is-film-loading");
    paintTimeline();
  }

  function seekTo(t, { force = false, immediate = false } = {}) {
    const next = force
      ? clamp(t, 0, Math.max(0, duration - 0.04))
      : clamp(t, startSec, Math.max(startSec, endSec - 0.04));
    const apply = () => {
      try {
        video.currentTime = next;
      } catch (_) {}
      lastSeekAt = performance.now();
      pendingSeek = null;
      paintTimeline();
      updateLabels();
    };
    if (immediate || performance.now() - lastSeekAt > 40) {
      apply();
      return;
    }
    pendingSeek = next;
    clearTimeout(seekTo._t);
    seekTo._t = setTimeout(apply, 42);
  }

  // 预览拖动：串行等 seeked 再应用最新目标（对齐 vplay 的 pumpScrubSeek），
  // 避免拖动时密集 currentTime 写入导致画面不更新，预览帧与播放帧保持一致。
  function pumpPreviewScrubSeek() {
    if (!video?.src || scrubSeekInflight) return;
    if (scrubSeekWanted == null) return;
    const t = Math.max(0, Math.min(duration || 0, scrubSeekWanted));
    scrubSeekWanted = null;
    if (Math.abs((Number(video.currentTime) || 0) - t) < 0.03 && !video.seeking) {
      paintTimeline();
      updateLabels();
      return;
    }
    scrubSeekInflight = true;
    const onSeeked = () => {
      video.removeEventListener("seeked", onSeeked);
      scrubSeekInflight = false;
      paintTimeline();
      updateLabels();
      pumpPreviewScrubSeek();
    };
    video.addEventListener("seeked", onSeeked, { once: true });
    try {
      video.currentTime = t;
    } catch (_) {}
  }

  function snapTime(t, which) {
    if (which === "start") {
      if (t <= SNAP_SEC) {
        if (t > 0) hapticLight();
        return 0;
      }
      return t;
    }
    if (t >= duration - SNAP_SEC) {
      if (t < duration) hapticLight();
      return duration;
    }
    return t;
  }

  function setStart(t, { preview = true, record = false } = {}) {
    const prev = startSec;
    startSec = clamp(t, 0, endSec - MIN_SPAN);
    activeHandle = "start";
    syncActiveHandleUi();
    const atMin = Math.abs(endSec - startSec - MIN_SPAN) < 0.02;
    timeline?.classList.toggle("is-min-span", atMin);
    if (atMin && Math.abs(prev - startSec) > 0.001) {
      timeline?.classList.add("is-pulse");
      hapticLight();
    }
    if (preview) previewSeek(startSec);
    else if (video.currentTime < startSec) previewSeek(startSec);
    paintTimeline();
    updateLabels();
    if (record) pushHistory();
  }

  function setEnd(t, { preview = true, record = false } = {}) {
    const prev = endSec;
    endSec = clamp(t, startSec + MIN_SPAN, duration);
    activeHandle = "end";
    syncActiveHandleUi();
    const atMin = Math.abs(endSec - startSec - MIN_SPAN) < 0.02;
    timeline?.classList.toggle("is-min-span", atMin);
    if (atMin && Math.abs(prev - endSec) > 0.001) {
      timeline?.classList.add("is-pulse");
      hapticLight();
    }
    if (preview) previewSeek(Math.max(startSec, endSec - 0.04));
    else if (video.currentTime > endSec) previewSeek(endSec - 0.04);
    paintTimeline();
    updateLabels();
    if (record) pushHistory();
  }

  function finishTrimDrag() {
    if (!drag) return;
    if (drag.kind === "start") {
      const snapped = snapTime(startSec, "start");
      if (snapped !== startSec) setStart(snapped, { preview: true });
      pushHistory();
    } else if (drag.kind === "end") {
      const snapped = snapTime(endSec, "end");
      if (snapped !== endSec) setEnd(snapped, { preview: true });
      pushHistory();
    } else if (drag.kind === "window") {
      pushHistory();
    }
  }

  function rotateBy(delta) {
    if (!video.videoWidth) return;
    pushHistory();
    const d = cropToDisplayRect();
    const xPct = d.x / d.dw;
    const yPct = d.y / d.dh;
    const wPct = d.w / d.dw;
    const hPct = d.h / d.dh;
    rotate = (rotate + delta + 360) % 360;
    applyVideoTransform();
    const { w: dw, h: dh } = displaySize();
    if (aspect !== "free") {
      fitCropToAspect();
    } else {
      displayRectToCrop(xPct * dw, yPct * dh, Math.max(2, wPct * dw), Math.max(2, hPct * dh));
      layoutCropBox();
    }
    updateSummary();
    pushHistory();
  }

  function shiftWindow(deltaSec) {
    const span = endSec - startSec;
    let nextStart = startSec + deltaSec;
    let nextEnd = endSec + deltaSec;
    if (nextStart < 0) {
      nextStart = 0;
      nextEnd = span;
    }
    if (nextEnd > duration) {
      nextEnd = duration;
      nextStart = Math.max(0, duration - span);
    }
    startSec = nextStart;
    endSec = nextEnd;
    previewSeek(clamp(video.currentTime || startSec, startSec, Math.max(startSec, endSec - 0.04)));
    paintTimeline();
    updateLabels();
  }

  function ratioFromClientX(clientX) {
    const rect = timeline.getBoundingClientRect();
    return clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  }

  async function togglePlay() {
    if (!sourceFile || busy) return;
    if (!video.paused) {
      video.pause();
      playing = false;
      if (playBtn) playBtn.textContent = "播放";
      return;
    }
    if (video.currentTime < startSec || video.currentTime >= endSec - 0.05) {
      seekTo(startSec);
    }
    try {
      await video.play();
      playing = true;
      if (playBtn) playBtn.textContent = "暂停";
    } catch (err) {
      if (!muted) {
        muted = true;
        syncMuteUi();
        try {
          await video.play();
          playing = true;
          if (playBtn) playBtn.textContent = "暂停";
          toast("浏览器限制有声播放，已改为静音");
          return;
        } catch (_) {}
      }
      toast(err?.message || "无法播放");
    }
  }

  function needsReencode() {
    const fullCrop =
      Math.abs(crop.x) < 1 &&
      Math.abs(crop.y) < 1 &&
      Math.abs(crop.w - (video.videoWidth || 0)) < 2 &&
      Math.abs(crop.h - (video.videoHeight || 0)) < 2;
    const cropOn = Boolean(cropEnable?.checked) && !fullCrop;
    return cropOn || rotate !== 0 || flipH;
  }

  function buildVf() {
    const filters = [];
    if (rotate === 90) filters.push("transpose=1");
    else if (rotate === 180) filters.push("transpose=1,transpose=1");
    else if (rotate === 270) filters.push("transpose=2");
    if (flipH) filters.push("hflip");

    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    let cw = srcW;
    let ch = srcH;
    if (rotate === 90 || rotate === 270) {
      cw = srcH;
      ch = srcW;
    }

    // Map source crop → after rotate/flip space for ffmpeg (filters apply in order)
    // We apply rotate/flip first, then crop in the transformed frame.
    const d = cropToDisplayRect();
    const cropOn = Boolean(cropEnable?.checked);
    if (cropOn) {
      const x = even(clamp(d.x, 0, cw - 2));
      const y = even(clamp(d.y, 0, ch - 2));
      let w = even(clamp(d.w, 2, cw - x));
      let h = even(clamp(d.h, 2, ch - y));
      if (w < 2) w = 2;
      if (h < 2) h = 2;
      if (x + w > cw) w = even(cw - x) || 2;
      if (y + h > ch) h = even(ch - y) || 2;
      filters.push(`crop=${w}:${h}:${x}:${y}`);
    }
    return filters.join(",");
  }

  async function exportViaBridge({ span, track, audioOnly, videoOnly, audioMp3, reencode }) {
    const vf = reencode ? buildVf() : "";
    const q = new URLSearchParams({
      op: "vtrim",
      filename: sourceFile.name || "video.mp4",
      startSec: String(Math.max(0, startSec)),
      durationSec: String(Math.max(MIN_SPAN, span)),
      track,
      quality: exportQuality === "hq" ? "hq" : "fast",
      audioFmt: audioMp3 ? "mp3" : "m4a",
    });
    if (vf) q.set("vf", vf);
    if (reencode) q.set("reencode", "1");

    setProgress(true, 0.08, "上传到本机桥…", { busy: true });
    const startRes = await bridgeFetch(`/jobs/browser-run?${q}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Filename": sourceFile.name || "video.mp4",
      },
      body: sourceFile,
    });
    const started = await startRes.json();
    const jobId = started?.job?.id;
    if (!jobId) throw new Error("本机桥未返回任务 ID");
    bridgeJobId = jobId;

    setProgress(true, 0.2, "本机 FFmpeg 处理中…", { busy: true, sub: `${formatClock(startSec)}–${formatClock(endSec)}` });
    for (;;) {
      if (abortFlag) {
        try {
          await bridgeFetch(`/jobs/${jobId}/cancel`, { method: "POST", body: "{}" });
        } catch (_) {}
        throw new Error("已取消");
      }
      await new Promise((r) => setTimeout(r, 650));
      const stRes = await bridgeFetch(`/jobs/${jobId}`);
      const st = await stRes.json();
      const job = st.job;
      const prog = 0.2 + (Number(job?.progress) || 0) * 0.7;
      setProgress(true, prog, job?.message || "本机 FFmpeg 处理中…", {
        busy: true,
        sub: `${formatClock(startSec)}–${formatClock(endSec)}`,
      });
      if (job?.status === "done" || job?.status === "success") break;
      if (job?.status === "error" || job?.status === "failed") {
        throw new Error(job?.error || job?.message || "本机桥导出失败");
      }
      if (job?.status === "cancelled") throw new Error("已取消");
    }

    setProgress(true, 0.92, "下载结果…", { busy: true });
    const dl = await bridgeFetch(`/jobs/${jobId}/download`);
    const buf = await dl.arrayBuffer();
    if (!(buf.byteLength > 32)) throw new Error("本机桥返回空文件");
    const mime = audioOnly ? (audioMp3 ? "audio/mpeg" : "audio/mp4") : "video/mp4";
    bridgeJobId = "";
    return {
      outBlob: new Blob([buf], { type: mime }),
      viaBridge: true,
      audioOnly,
      videoOnly,
      audioMp3,
      reencode,
      span,
    };
  }

  async function exportViaWasm({ span, track, audioOnly, videoOnly, audioMp3, reencode }) {
    const eng = engine();
    if (!eng?.getInstance) throw new Error("编码器未就绪，请刷新页面后重试");
    await eng.prewarm?.().catch(() => {});
    const ffmpeg = await eng.getInstance((r, t) => setProgress(true, 0.05 + r * 0.2, t || "加载编码器…", { busy: true }));
    if (abortFlag) throw new Error("已取消");
    const inName = await eng.ensureInputWritten(ffmpeg, sourceFile, (r, t) =>
      setProgress(true, 0.25 + r * 0.15, t || "写入视频…", { busy: true })
    );
    const ss = String(Math.max(0, startSec));
    const tt = String(Math.max(MIN_SPAN, span));
    const outExt = audioOnly ? (audioMp3 ? "mp3" : "m4a") : "mp4";
    const outName = `vtrim-out-${Date.now()}.${outExt}`;
    const crf = exportQuality === "hq" ? "20" : "23";
    const preset = exportQuality === "hq" ? "veryfast" : "ultrafast";
    const attempts = [];

    if (audioOnly) {
      if (audioMp3) {
        attempts.push({
          label: "抽取 MP3",
          args: ["-ss", ss, "-t", tt, "-i", inName, "-vn", "-c:a", "copy", "-f", "mp3", "-y", outName],
        });
        attempts.push({
          label: "MP3 重编码",
          args: ["-ss", ss, "-t", tt, "-i", inName, "-vn", "-c:a", "libmp3lame", "-b:a", "192k", "-y", outName],
        });
      } else {
        attempts.push({
          label: "抽取音轨",
          args: ["-ss", ss, "-t", tt, "-i", inName, "-vn", "-c:a", "copy", "-y", outName],
        });
        attempts.push({
          label: "AAC 重编码",
          args: ["-ss", ss, "-t", tt, "-i", inName, "-vn", "-c:a", "aac", "-b:a", "192k", "-y", outName],
        });
      }
    } else {
      if (!reencode && !videoOnly && span >= COPY_MIN_SPAN) {
        attempts.push({
          label: "快速剪切",
          args: [
            "-ss",
            ss,
            "-t",
            tt,
            "-i",
            inName,
            "-c",
            "copy",
            "-avoid_negative_ts",
            "make_zero",
            "-movflags",
            "+faststart",
            "-y",
            outName,
          ],
        });
      }
      if (!reencode && videoOnly && span >= COPY_MIN_SPAN) {
        attempts.push({
          label: "快速无声剪切",
          args: [
            "-ss",
            ss,
            "-t",
            tt,
            "-i",
            inName,
            "-an",
            "-c:v",
            "copy",
            "-avoid_negative_ts",
            "make_zero",
            "-movflags",
            "+faststart",
            "-y",
            outName,
          ],
        });
      }
      const vf = buildVf();
      if (!videoOnly) {
        const encArgs = ["-ss", ss, "-t", tt, "-i", inName];
        if (vf) encArgs.push("-vf", vf);
        encArgs.push(
          "-c:v",
          "libx264",
          "-preset",
          preset,
          "-crf",
          crf,
          "-pix_fmt",
          "yuv420p",
          "-c:a",
          "aac",
          "-b:a",
          exportQuality === "hq" ? "160k" : "128k",
          "-movflags",
          "+faststart",
          "-y",
          outName
        );
        attempts.push({ label: reencode ? "裁剪重编码" : "重编码", args: encArgs });
      }
      const encNoA = ["-ss", ss, "-t", tt, "-i", inName];
      if (vf) encNoA.push("-vf", vf);
      encNoA.push(
        "-an",
        "-c:v",
        "libx264",
        "-preset",
        preset,
        "-crf",
        crf,
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        "-y",
        outName
      );
      attempts.push({ label: videoOnly ? "无声重编码" : "无音轨重编码", args: encNoA });
    }

    let outBlob = null;
    const mime = audioOnly ? (audioMp3 ? "audio/mpeg" : "audio/mp4") : "video/mp4";
    for (const attempt of attempts) {
      if (abortFlag) throw new Error("已取消");
      setProgress(true, 0.45, `${attempt.label}…`, {
        busy: true,
        sub: `${formatClock(startSec)}–${formatClock(endSec)}`,
      });
      try {
        await ffmpeg.deleteFile(outName);
      } catch (_) {}
      try {
        const code = await ffmpeg.exec(attempt.args);
        if (code !== 0) continue;
        const data = await ffmpeg.readFile(outName);
        const raw = data instanceof Uint8Array ? data : new Uint8Array(data);
        if (raw.byteLength > 32) {
          const bytes = new Uint8Array(raw.byteLength);
          bytes.set(raw);
          outBlob = new Blob([bytes], { type: mime });
          break;
        }
      } catch (err) {
        if (String(err?.message) === "已取消") throw err;
      }
    }
    try {
      await ffmpeg.deleteFile(outName);
    } catch (_) {}
    if (!outBlob) throw new Error("导出失败，可尝试缩短时长或关闭裁剪后重试");
    return { outBlob, viaBridge: false, audioOnly, videoOnly, audioMp3, reencode, span };
  }

  async function presentExportResult({ outBlob, viaBridge, audioOnly, videoOnly, audioMp3, reencode, span }) {
    resultUrl = URL.createObjectURL(outBlob);
    if (resultBlock) resultBlock.hidden = false;
    if (audioOnly) {
      if (resultAudio) {
        resultAudio.src = resultUrl;
        resultAudio.hidden = false;
      }
      if (resultVideo) resultVideo.hidden = true;
    } else if (resultVideo) {
      resultVideo.src = resultUrl;
      resultVideo.hidden = false;
      if (resultAudio) resultAudio.hidden = true;
    }
    const trackLabel = audioOnly ? "仅音频" : videoOnly ? "仅视频" : "音视频";
    const modeLabel = audioOnly
      ? audioMp3
        ? "MP3"
        : "M4A"
      : reencode
        ? exportQuality === "hq"
          ? "清晰重编码"
          : "快速重编码"
        : "快速剪切";
    const engineLabel = viaBridge ? "本机桥" : "网页";
    if (resultMeta) {
      const mb = (outBlob.size / (1024 * 1024)).toFixed(2);
      resultMeta.textContent = `约 ${mb} MB · ${formatClock(span)} · ${trackLabel} · ${modeLabel} · ${engineLabel}`;
    }
    const fname = audioOnly
      ? `trimmed-${Date.now()}.${audioMp3 ? "mp3" : "m4a"}`
      : `trimmed-${Date.now()}.mp4`;
    latestExportBlob = outBlob;
    latestExportName = fname;
    if (downloadA) {
      downloadA.href = resultUrl;
      downloadA.download = fname;
      downloadA.hidden = false;
    }
    syncShareUi();
    const delivered = await deliverExportBlob(outBlob, fname, { auto: true });
    setProgress(true, 1, viaBridge ? "本机桥导出完成" : "导出完成");
    if (!delivered?.shared && !delivered?.cancelled) {
      toast(`已导出 · ${trackLabel} · ${engineLabel} · 保留 ${formatClock(span)}`);
    } else if (delivered?.shared) {
      toast(`已导出 · ${trackLabel} · 保留 ${formatClock(span)}`);
    }
    try {
      resultBlock?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (_) {}
  }

  async function exportVideo() {
    if (!sourceFile || busy) return;
    const span = endSec - startSec;
    if (!(span >= MIN_SPAN)) {
      toast(`保留时长至少 ${MIN_SPAN} 秒`);
      return;
    }
    abortFlag = false;
    bridgeJobId = "";
    busy = true;
    setButtons();
    setError(errorEl, "");
    revokeResult();
    if (abortBtn) abortBtn.hidden = false;
    setProgress(true, 0.02, "准备导出…", { busy: true });

    const track = exportTrack === "audio" || exportTrack === "video" ? exportTrack : "av";
    const audioOnly = track === "audio";
    const videoOnly = track === "video";
    const audioMp3 = audioOnly && exportAudioFmt === "mp3";
    const reencode = audioOnly ? false : needsReencode();
    const ctx = { span, track, audioOnly, videoOnly, audioMp3, reencode };

    try {
      let result = null;
      if (shouldUseBridge()) {
        try {
          result = await exportViaBridge(ctx);
        } catch (err) {
          if (String(err?.message) === "已取消") throw err;
          console.warn("[vtrim] 本机桥失败，回退网页编码", err);
          setProgress(true, 0.05, "桥失败，改用网页编码…", { busy: true });
          result = await exportViaWasm(ctx);
        }
      } else {
        result = await exportViaWasm(ctx);
      }
      await presentExportResult(result);
    } catch (err) {
      if (String(err?.message) === "已取消") toast("已取消导出");
      else setError(errorEl, err?.message || String(err));
      setProgress(false, 0, "");
    } finally {
      busy = false;
      bridgeJobId = "";
      if (abortBtn) abortBtn.hidden = true;
      setButtons();
    }
  }

  async function onFile(file) {
    if (!file) return;
    clearAll();
    abortFlag = false;
    sourceFile = file;
    objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    filmVideo.src = objectUrl;
    video.muted = true;
    muted = true;
    syncMuteUi();
    setError(errorEl, "");
    try {
      await new Promise((resolve, reject) => {
        const onMeta = () => {
          cleanup();
          resolve();
        };
        const onErr = () => {
          cleanup();
          reject(new Error("无法读取视频"));
        };
        const cleanup = () => {
          video.removeEventListener("loadedmetadata", onMeta);
          video.removeEventListener("error", onErr);
        };
        video.addEventListener("loadedmetadata", onMeta);
        video.addEventListener("error", onErr);
        if (video.readyState >= 1 && video.videoWidth) resolve();
      });
      duration = Number(video.duration) || 0;
      if (!(duration > 0)) throw new Error("无法获取视频时长");
      startSec = 0;
      endSec = duration;
      crop = { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight };
      if (stage) stage.hidden = false;
      if (meta) {
        meta.textContent = `本地文件，不上传 · ${file.name || "video"} · ${formatClock(duration)} · ${video.videoWidth}×${video.videoHeight}`;
      }
      syncCropBoxVisibility();
      applyVideoTransform();
      layoutCropBox();
      paintTimeline();
      updateLabels();
      history = [];
      pushHistory();
      setButtons();
      toast("已选择，仅本机处理，不会上传");
      engine()?.prewarm?.().catch(() => {});
      // 胶片与预览并行：不阻塞首帧预览
      buildFilmstrip().catch(() => {});
      seekTo(0);
    } catch (err) {
      setError(errorEl, err?.message || String(err));
      clearAll();
    }
  }

  // ---- events ----
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    onFile(f).finally(() => {
      fileInput.value = "";
    });
  });
  clearBtn?.addEventListener("click", () => clearAll());
  undoBtn?.addEventListener("click", () => undoEdit());
  resetBtn?.addEventListener("click", () => resetEdit());
  playBtn?.addEventListener("click", () => togglePlay().catch(() => {}));
  muteBtn?.addEventListener("click", () => {
    muted = !muted;
    syncMuteUi();
  });
  document.querySelectorAll("[data-vtrim-mode]").forEach((btn) => {
    btn.addEventListener("click", () => {
      editMode = btn.dataset.vtrimMode === "crop" ? "crop" : "trim";
      syncModeUi();
      layoutCropBox();
      updateSummary();
    });
  });
  document.querySelectorAll("[data-vtrim-quality]").forEach((btn) => {
    btn.addEventListener("click", () => {
      exportQuality = btn.dataset.vtrimQuality === "hq" ? "hq" : "fast";
      document.querySelectorAll("[data-vtrim-quality]").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.vtrimQuality === exportQuality);
      });
      updateSummary();
    });
  });
  document.querySelectorAll("[data-vtrim-track]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const t = btn.dataset.vtrimTrack;
      exportTrack = t === "video" || t === "audio" ? t : "av";
      document.querySelectorAll("[data-vtrim-track]").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.vtrimTrack === exportTrack);
      });
      setButtons();
      updateSummary();
    });
  });
  document.querySelectorAll("[data-vtrim-audio-fmt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      exportAudioFmt = btn.dataset.vtrimAudioFmt === "mp3" ? "mp3" : "m4a";
      document.querySelectorAll("[data-vtrim-audio-fmt]").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.vtrimAudioFmt === exportAudioFmt);
      });
      updateSummary();
    });
  });
  rotL?.addEventListener("click", () => rotateBy(-90));
  rotR?.addEventListener("click", () => rotateBy(90));
  flipHBtn?.addEventListener("click", () => {
    pushHistory();
    flipH = !flipH;
    applyVideoTransform();
    layoutCropBox();
    updateSummary();
    pushHistory();
  });
  cropResetBtn?.addEventListener("click", () => {
    pushHistory();
    fitCropToAspect();
    updateSummary();
    pushHistory();
    toast("已重置裁剪框");
  });
  cropEnable?.addEventListener("change", () => {
    pushHistory();
    syncCropBoxVisibility();
    layoutCropBox();
    updateSummary();
    pushHistory();
  });
  document.querySelectorAll("[data-vtrim-aspect]").forEach((btn) => {
    btn.addEventListener("click", () => {
      pushHistory();
      aspect = btn.dataset.vtrimAspect || "free";
      syncAspectUi();
      if (cropEnable && !cropEnable.checked) cropEnable.checked = true;
      if (editMode !== "crop") {
        editMode = "crop";
        syncModeUi();
      }
      syncCropBoxVisibility();
      fitCropToAspect();
      updateSummary();
      pushHistory();
    });
  });
  exportBtn?.addEventListener("click", () => exportVideo().catch((err) => setError(errorEl, err.message || String(err))));
  abortBtn?.addEventListener("click", () => {
    abortFlag = true;
    try {
      engine()?.terminate?.({ revokeAssets: false });
    } catch (_) {}
    const id = bridgeJobId;
    if (id && bridge.ok) {
      bridgeFetch(`/jobs/${id}/cancel`, { method: "POST", body: "{}" }).catch(() => {});
    }
  });

  preferBridgeEl?.addEventListener("change", () => {
    writePreferBridge(Boolean(preferBridgeEl.checked));
  });
  bridgeReconnectBtn?.addEventListener("click", () => {
    probeBridge({ launch: true }).then((ok) => {
      toast(ok ? "本机桥已连接" : "未连上本机桥，请先在「本机桥」面板启动");
    });
  });

  function tickPlayhead() {
    if (!sourceFile) {
      playheadRaf = 0;
      return;
    }
    paintTimeline();
    updateLabels();
    if (!video.paused) playheadRaf = requestAnimationFrame(tickPlayhead);
    else playheadRaf = 0;
  }

  video.addEventListener("timeupdate", () => {
    if (!sourceFile) return;
    if (!video.paused && video.currentTime >= endSec - 0.05) {
      seekTo(startSec, { immediate: true });
      video.play().catch(() => {});
    }
    if (!playheadRaf) {
      paintTimeline();
      updateLabels();
    }
    scheduleCropLive();
  });
  video.addEventListener("pause", () => {
    playing = false;
    if (playBtn) playBtn.textContent = "播放";
    previewWrap?.classList.remove("is-playing");
    if (playheadRaf) {
      cancelAnimationFrame(playheadRaf);
      playheadRaf = 0;
    }
    paintTimeline();
  });
  video.addEventListener("play", () => {
    playing = true;
    if (playBtn) playBtn.textContent = "暂停";
    previewWrap?.classList.add("is-playing");
    if (!playheadRaf) playheadRaf = requestAnimationFrame(tickPlayhead);
  });

  timeline?.addEventListener("animationend", () => timeline.classList.remove("is-pulse"));

  // timeline drag
  function hitKind(ratio, target) {
    if (target === handleStart || target?.classList?.contains("vtrim-handle-start")) return "start";
    if (target === handleEnd || target?.classList?.contains("vtrim-handle-end")) return "end";
    if (target === windowEl || target?.classList?.contains("vtrim-window")) return "window";
    const startR = startSec / duration;
    const endR = endSec / duration;
    const pxPad = 0.045; // ~ handle hit slop
    if (Math.abs(ratio - startR) <= pxPad) return "start";
    if (Math.abs(ratio - endR) <= pxPad) return "end";
    if (ratio < startR) return "start";
    if (ratio > endR) return "end";
    return "seek";
  }

  function onTimelinePointerDown(e) {
    if (!duration || busy) return;
    try {
      video.pause();
    } catch (_) {}
    const ratio = ratioFromClientX(e.clientX);
    const t = ratio * duration;
    const kind = hitKind(ratio, e.target);
    timeline?.classList.add("is-dragging");
    if (kind === "start") {
      drag = { kind: "start", pointerId: e.pointerId };
      handleStart?.setPointerCapture?.(e.pointerId);
      setStart(t);
    } else if (kind === "end") {
      drag = { kind: "end", pointerId: e.pointerId };
      handleEnd?.setPointerCapture?.(e.pointerId);
      setEnd(t);
    } else if (kind === "window") {
      drag = {
        kind: "window",
        pointerId: e.pointerId,
        originX: e.clientX,
        originStart: startSec,
        originEnd: endSec,
      };
      timeline?.classList.add("is-dragging-window");
      windowEl?.setPointerCapture?.(e.pointerId);
      syncHandleTips();
    } else {
      previewSeek(clamp(t, startSec, Math.max(startSec, endSec - 0.04)));
      drag = { kind: "seek", pointerId: e.pointerId };
    }
    e.preventDefault();
  }
  function onTimelinePointerMove(e) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.kind === "window") {
      const rect = timeline.getBoundingClientRect();
      const deltaSec = ((e.clientX - drag.originX) / Math.max(1, rect.width)) * duration;
      startSec = drag.originStart;
      endSec = drag.originEnd;
      shiftWindow(deltaSec);
      syncHandleTips();
      return;
    }
    const t = ratioFromClientX(e.clientX) * duration;
    if (drag.kind === "start") setStart(t);
    else if (drag.kind === "end") setEnd(t);
    else previewSeek(clamp(t, startSec, Math.max(startSec, endSec - 0.04)));
  }
  function onTimelinePointerUp(e) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    finishTrimDrag();
    timeline?.classList.remove("is-dragging-window", "is-dragging");
    drag = null;
    syncHandleTips();
  }
  timeline?.addEventListener("pointerdown", onTimelinePointerDown);
  timeline?.addEventListener("pointermove", onTimelinePointerMove);
  timeline?.addEventListener("pointerup", onTimelinePointerUp);
  timeline?.addEventListener("pointercancel", onTimelinePointerUp);

  function onHandleKey(which, e) {
    if (!duration || busy) return;
    const step = e.shiftKey ? 1 : 0.1;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      if (which === "start") setStart(startSec - step);
      else setEnd(endSec - step);
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      if (which === "start") setStart(startSec + step);
      else setEnd(endSec + step);
    }
  }
  handleStart?.addEventListener("keydown", (e) => onHandleKey("start", e));
  handleEnd?.addEventListener("keydown", (e) => onHandleKey("end", e));
  handleStart?.addEventListener("focus", () => {
    activeHandle = "start";
    syncActiveHandleUi();
  });
  handleEnd?.addEventListener("focus", () => {
    activeHandle = "end";
    syncActiveHandleUi();
  });

  nudgeStartM?.addEventListener("click", () => setStart(startSec - 0.1, { record: true }));
  nudgeStartP?.addEventListener("click", () => setStart(startSec + 0.1, { record: true }));
  nudgeEndM?.addEventListener("click", () => setEnd(endSec - 0.1, { record: true }));
  nudgeEndP?.addEventListener("click", () => setEnd(endSec + 0.1, { record: true }));

  // crop box drag
  let cropDrag = null;
  function onCropPointerDown(e) {
    if (cropBox?.hidden || busy) return;
    const handle = e.target?.closest?.("[data-vtrim-handle]");
    const geom = videoContentRect();
    const d = cropToDisplayRect();
    cropDrag = {
      pointerId: e.pointerId,
      handle: handle?.dataset?.vtrimHandle || "move",
      startX: e.clientX,
      startY: e.clientY,
      box: { ...d },
      geom,
    };
    cropBox.setPointerCapture?.(e.pointerId);
    previewWrap?.classList.add("is-dragging");
    e.preventDefault();
    e.stopPropagation();
  }
  function onCropPointerMove(e) {
    if (!cropDrag || cropDrag.pointerId !== e.pointerId) return;
    const { geom, box, handle } = cropDrag;
    const dx = (e.clientX - cropDrag.startX) / geom.scale;
    const dy = (e.clientY - cropDrag.startY) / geom.scale;
    let x = box.x;
    let y = box.y;
    let w = box.w;
    let h = box.h;
    const ratio = parseAspect(aspect);
    const minSide = 16;
    const applyAspect = () => {
      if (!ratio) return;
      if (handle === "n" || handle === "s") {
        w = h * ratio;
      } else {
        h = w / ratio;
      }
    };
    if (handle === "move") {
      x = clamp(box.x + dx, 0, box.dw - w);
      y = clamp(box.y + dy, 0, box.dh - h);
    } else {
      if (handle.includes("w")) {
        const nx = clamp(box.x + dx, 0, box.x + box.w - minSide);
        w = box.x + box.w - nx;
        x = nx;
      }
      if (handle.includes("e")) {
        w = clamp(box.w + dx, minSide, box.dw - box.x);
      }
      if (handle.includes("n")) {
        const ny = clamp(box.y + dy, 0, box.y + box.h - minSide);
        h = box.y + box.h - ny;
        y = ny;
      }
      if (handle.includes("s")) {
        h = clamp(box.h + dy, minSide, box.dh - box.y);
      }
      if (ratio) {
        applyAspect();
        if (x + w > box.dw) {
          w = box.dw - x;
          h = w / ratio;
        }
        if (y + h > box.dh) {
          h = box.dh - y;
          w = h * ratio;
        }
        if (w < minSide) {
          w = minSide;
          h = w / ratio;
        }
        if (h < minSide) {
          h = minSide;
          w = h * ratio;
        }
      }
      x = clamp(x, 0, box.dw - w);
      y = clamp(y, 0, box.dh - h);
    }
    displayRectToCrop(x, y, w, h);
    layoutCropBox();
    scheduleCropLive();
  }
  function onCropPointerUp(e) {
    if (!cropDrag || cropDrag.pointerId !== e.pointerId) return;
    cropDrag = null;
    previewWrap?.classList.remove("is-dragging");
    pushHistory();
    updateSummary();
  }
  cropBox?.addEventListener("pointerdown", (e) => {
    pushHistory();
    onCropPointerDown(e);
  });
  cropBox?.addEventListener("dblclick", (e) => {
    e.preventDefault();
    pushHistory();
    fitCropToAspect();
    updateSummary();
    pushHistory();
    toast("已重置裁剪框");
  });
  window.addEventListener("pointermove", onCropPointerMove);
  window.addEventListener("pointerup", onCropPointerUp);
  window.addEventListener("pointercancel", onCropPointerUp);

  // preview area: horizontal scrub; short tap toggles play
  previewWrap?.addEventListener("pointerdown", (e) => {
    if (!sourceFile || busy || e.target?.closest?.(".vtrim-crop-box")) return;
    previewScrub = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startT: video.currentTime || startSec,
      moved: false,
    };
    try {
      video.pause();
    } catch (_) {}
    previewWrap.setPointerCapture?.(e.pointerId);
  });
  previewWrap?.addEventListener("pointermove", (e) => {
    if (!previewScrub || previewScrub.pointerId !== e.pointerId) return;
    const dx = e.clientX - previewScrub.startX;
    if (Math.abs(dx) > 8) previewScrub.moved = true;
    if (!previewScrub.moved) return;
    const geom = previewWrap.getBoundingClientRect();
    const span = Math.max(MIN_SPAN, endSec - startSec);
    const delta = (dx / Math.max(1, geom.width)) * span;
    const target = clamp(previewScrub.startT + delta, startSec, Math.max(startSec, endSec - 0.04));
    scrubSeekWanted = target;
    pumpPreviewScrubSeek();
  });
  previewWrap?.addEventListener("pointerup", (e) => {
    if (!previewScrub || previewScrub.pointerId !== e.pointerId) return;
    const wasMove = previewScrub.moved;
    previewScrub = null;
    if (!wasMove) togglePlay().catch(() => {});
  });
  previewWrap?.addEventListener("pointercancel", () => {
    previewScrub = null;
  });

  let resizeFilmTimer = 0;
  window.addEventListener("resize", () => {
    layoutCropBox();
    if (sourceFile && duration) {
      clearTimeout(resizeFilmTimer);
      resizeFilmTimer = setTimeout(() => buildFilmstrip().catch(() => {}), 180);
    }
  });

  window.DevToolsTemp?.registerCleanup?.(clearAll);

  window.DevToolsVtrim = {
    getRange: () => ({ start: startSec, end: endSec, duration }),
    getCrop: () => ({ ...crop, rotate, flipH, aspect }),
    getMode: () => editMode,
    getTrack: () => exportTrack,
    setMode: (mode) => {
      editMode = mode === "crop" ? "crop" : "trim";
      syncModeUi();
      layoutCropBox();
    },
    setRange: (start, end) => {
      if (!duration) return false;
      const s = clamp(Number(start) || 0, 0, duration - MIN_SPAN);
      const e = clamp(Number(end) || duration, s + MIN_SPAN, duration);
      startSec = s;
      endSec = e;
      seekTo(s, { immediate: true });
      paintTimeline();
      updateLabels();
      pushHistory();
      return true;
    },
    undo: undoEdit,
    clear: clearAll,
  };

  setButtons();
  syncMuteUi();
  syncAspectUi();
  syncModeUi();
  syncShareUi();
  paintBridge();
  probeBridge({ launch: false }).catch(() => {});

  if (downloadA && !downloadA.dataset.shareBound) {
    downloadA.dataset.shareBound = "1";
    downloadA.addEventListener("click", (e) => {
      if (!preferGalleryShare() || !latestExportBlob) return;
      e.preventDefault();
      deliverExportBlob(latestExportBlob, latestExportName, { auto: false }).catch((err) => {
        setError(errorEl, err?.message || String(err));
      });
    });
  }
})();
