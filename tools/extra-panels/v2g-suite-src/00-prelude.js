(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;

  // 调试日志：URL 带 ?debug 或 localStorage 设 devtools-vbb-debug=1 时输出
  const VBB_DEBUG = (() => {
    try {
      if (/[?&]debug\b/.test(location.search)) return true;
      return localStorage.getItem("devtools-vbb-debug") === "1";
    } catch (_) {
      return false;
    }
  })();
  const vbbLog = (...args) => {
    if (!VBB_DEBUG) return;
    try {
      console.log(...args);
    } catch (_) {}
  };

  const M = window.DevToolsExtraMedia || {};
  const DN = window.DevToolsDeviceNotify || {};
  const {
    mergeGifBlobs, compressGifBlob, getFfmpegInstance, ensureFfmpegAssets, fetchFileBytes,
    ensureFfmpegInputWritten, loadGifsicle, buildGifCompressArgs, buildBlackboxSoftCompressArgs,
    buildBlackboxHardCompressArgs, gifCompressSummary, readGifWatermarkOptions, drawGifTextWatermark,
    encodeAnimatedWebpFromStillFrames, isAutoPackZipEnabled, setAutoPackZipEnabled, syncAutoPackZipToggles,
    bindAutoPackZipToggles, canEncodeStillWebp, gifQualityToWebpQuality, gifQualityToMaxColors,
    gifQualityToGifskiQuality,
    terminateFfmpegInstance, paintFfmpegWarmHint, prewarmFfmpegEngine, scheduleFfmpegPrewarm,
    TOOLS_VERSION, GIF_TOOL_VERSION, compressExistingGifToBlackbox, blackboxUseMaxBytes,
    blackboxMaxMb, setBlackboxMaxMb,
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
