(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;

  // 调试日志：始终写入环形缓冲（供「导出诊断」）；控制台仅 ?debug / localStorage
  const VBB_DEBUG = (() => {
    try {
      if (/[?&]debug\b/.test(location.search)) return true;
      return localStorage.getItem("devtools-vbb-debug") === "1";
    } catch (_) {
      return false;
    }
  })();
  const VBB_LOG_RING_MAX = 3000;
  /** @type {{ t: number, m: string }[]} */
  const vbbLogRing = [];
  function pushVbbLogLine(msg) {
    const m = String(msg || "").slice(0, 2400);
    if (!m) return;
    vbbLogRing.push({ t: Date.now(), m });
    if (vbbLogRing.length > VBB_LOG_RING_MAX) {
      vbbLogRing.splice(0, vbbLogRing.length - VBB_LOG_RING_MAX);
    }
  }
  function getVbbLogRing() {
    return vbbLogRing.slice();
  }
  function clearVbbLogRing() {
    vbbLogRing.length = 0;
  }
  const vbbLog = (...args) => {
    try {
      const text = args
        .map((a) => {
          if (typeof a === "string") return a;
          if (a instanceof Error) return a.message || String(a);
          try {
            return JSON.stringify(a);
          } catch (_) {
            return String(a);
          }
        })
        .join(" ");
      pushVbbLogLine(text);
    } catch (_) {}
    if (!VBB_DEBUG) return;
    try {
      console.log(...args);
    } catch (_) {}
  };

  const M = window.DevToolsExtraMedia || {};
  const DN = window.DevToolsDeviceNotify || {};
  const {
    mergeGifBlobs, compressGifBlob, getFfmpegInstance, ensureFfmpegAssets, fetchFileBytes,
    pinLocalMediaFile, isPinnedLocalMediaFile, isLocalFileUnreadableError, friendlyLocalFileError,
    LOCAL_FILE_UNREADABLE_HINT,
    ensureFfmpegInputWritten, loadGifsicle, buildGifCompressArgs, buildBlackboxSoftCompressArgs,
    buildBlackboxHardCompressArgs, gifCompressSummary, readGifWatermarkOptions, drawGifTextWatermark,
    encodeAnimatedWebpFromStillFrames, isAutoPackZipEnabled, setAutoPackZipEnabled, syncAutoPackZipToggles,
    bindAutoPackZipToggles, canEncodeStillWebp, gifQualityToWebpQuality, gifQualityToMaxColors,
    gifQualityToGifskiQuality,
    terminateFfmpegInstance, clearFfmpegInputCache, paintFfmpegWarmHint, prewarmFfmpegEngine, scheduleFfmpegPrewarm,
    TOOLS_VERSION, GIF_TOOL_VERSION, compressExistingGifToBlackbox, blackboxUseMaxBytes,
    blackboxMaxMb, blackboxMaxLabel, setBlackboxMaxMb,
    readMediaPerfMode, setMediaPerfMode, mediaPerfProfile, isCoarsePointerMedia,
    AUTO_PACK_ZIP_KEY,
    preferShareToGallery, isAutoShareGalleryEnabled, shareMediaBlob, maybeAutoShareGallery,
    revealAutoShareGalleryUi,
    createFfmpegInstance, destroyFfmpegInstance,
  } = M;
  const FFMPEG_SEG_FILE_BYTES = M.FFMPEG_SEG_FILE_BYTES ?? 48 * 1024 * 1024;
  const formatLocalPickMeta = K.formatLocalPickMeta;
  const attachLocalVideoPreview = K.attachLocalVideoPreview;
  const waitVideoMetadata = K.waitVideoMetadata;
