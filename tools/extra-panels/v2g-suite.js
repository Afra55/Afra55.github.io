(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;

  const M = window.DevToolsExtraMedia || {};
  const {
    mergeGifBlobs, compressGifBlob, getFfmpegInstance, ensureFfmpegAssets, fetchFileBytes,
    ensureFfmpegInputWritten, loadGifsicle, buildGifCompressArgs, buildBlackboxSoftCompressArgs,
    buildBlackboxHardCompressArgs, gifCompressSummary, readGifWatermarkOptions, drawGifTextWatermark,
    encodeAnimatedWebpFromStillFrames, isAutoPackZipEnabled, setAutoPackZipEnabled, syncAutoPackZipToggles,
    bindAutoPackZipToggles, canEncodeStillWebp, gifQualityToWebpQuality, gifQualityToMaxColors,
    terminateFfmpegInstance, paintFfmpegWarmHint, prewarmFfmpegEngine, scheduleFfmpegPrewarm,
    TOOLS_VERSION, GIF_TOOL_VERSION,
    AUTO_PACK_ZIP_KEY,
  } = M;
  const FFMPEG_SEG_FILE_BYTES = M.FFMPEG_SEG_FILE_BYTES ?? 48 * 1024 * 1024;
  const formatLocalPickMeta = K.formatLocalPickMeta;
  const attachLocalVideoPreview = K.attachLocalVideoPreview;
  const waitVideoMetadata = K.waitVideoMetadata;

    try {
      let v2gFile;
      let v2gVideo;
      let v2gMeta;
      let v2gError;
      let v2gFps;
      let v2gWidth;
      let v2gMaxsec;
      let v2gStart;
      let v2gQuality;
      let v2gBrightEnable;
      let v2gBrightPanel;
      let v2gBrightPresets;
      let v2gBrightAmount;
      let v2gBrightPct;
      let v2gBrightReset;
      let v2gBrightPreview;
      let v2gGenerate;
      let v2gGenerateWebp;
      let v2gBlackbox;
      let v2gAbort;
      let v2gProgress;
      let v2gProgressFill;
      let v2gProgressText;
      let v2gProgressSub;
      let v2gProgressPct;
      let v2gPreview;
      let v2gDownload;
      let v2gCompress;
      let v2gCompressAgain;
      let v2gCompressLevel;
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
  
      const VBB_SPAN_SCHEME_KEY = "devtools-vbb-span-scheme-v1";
      const VBB_SPAN_SCHEME_MAX = 48;
  
      function vbbSpanSchemeKey(span) {
        const s = Math.max(VBB_MIN_SPAN, Number(span) || VBB_MIN_SPAN);
        return s.toFixed(1);
      }
  
      function loadVbbSpanSchemes() {
        try {
          const raw = localStorage.getItem(VBB_SPAN_SCHEME_KEY);
          return raw ? JSON.parse(raw) : {};
        } catch (_) {
          return {};
        }
      }
  
      function loadVbbSpanScheme(span) {
        const hit = loadVbbSpanSchemes()[vbbSpanSchemeKey(span)];
        if (!hit || !(Number(hit.fps) > 0)) return null;
        return hit;
      }
  
      function saveVbbSpanScheme(span, seed, encode) {
        if (!seed?.fps) return;
        try {
          const map = loadVbbSpanSchemes();
          const key = vbbSpanSchemeKey(span);
          map[key] = {
            fps: Number(seed.fps) || 15,
            maxW: Math.max(64, Number(seed.maxW) || V2G_BLACKBOX_BASE_W),
            compressRounds: Number(seed.compressRounds) || 0,
            usedFallback: Boolean(seed.usedFallback),
            encode: encode || "blackbox",
            at: Date.now(),
          };
          const keys = Object.keys(map).sort((a, b) => (map[b].at || 0) - (map[a].at || 0));
          while (keys.length > VBB_SPAN_SCHEME_MAX) delete map[keys.pop()];
          localStorage.setItem(VBB_SPAN_SCHEME_KEY, JSON.stringify(map));
        } catch (_) {}
      }
  
      function resolveVbbSegmentReuse(ranges, index, firstSeed, planEncode) {
        const cached = loadVbbSpanScheme(ranges[index]?.span);
        if (cached) {
          return { seed: cached, fromCache: true, encode: cached.encode || planEncode };
        }
        if (firstSeed && shouldReuseVbbFirstPlan(ranges, index)) {
          return { seed: firstSeed, fromCache: false, encode: planEncode };
        }
        return { seed: null, fromCache: false, encode: planEncode };
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
                  `压缩 ${fps} FPS · ${text || plan.label}`
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
            onProgress(0.92, `加宽至 ${nextW}px`);
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
          onProgress(0.04, `沿用方案 · ${fps}FPS · 宽${width}`);
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
          onProgress((i + 0.02) / fpsList.length, `试 ${fps} 帧/秒`);
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
                    `压缩 ${fps} FPS · ${text || plan.label}`
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
                onProgress(0.92, `加宽至 ${nextW}px`);
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
  
      bindPanel("v2g", (root) => {
        root = root || document.getElementById("v2g");
        v2gFile = $("#v2g-file", root);
        v2gVideo = $("#v2g-video", root);
        v2gMeta = $("#v2g-meta", root);
        v2gError = $("#v2g-error", root);
        v2gFps = $("#v2g-fps", root);
        v2gWidth = $("#v2g-width", root);
        v2gMaxsec = $("#v2g-maxsec", root);
        v2gStart = $("#v2g-start", root);
        v2gQuality = $("#v2g-quality", root);
        v2gBrightEnable = $("#v2g-bright-enable", root);
        v2gBrightPanel = $("#v2g-bright-panel", root);
        v2gBrightPresets = $("#v2g-bright-presets", root);
        v2gBrightAmount = $("#v2g-bright-amount", root);
        v2gBrightPct = $("#v2g-bright-pct", root);
        v2gBrightReset = $("#v2g-bright-reset", root);
        v2gBrightPreview = $("#v2g-bright-preview", root);
        v2gGenerate = $("#v2g-generate", root);
        v2gGenerateWebp = $("#v2g-generate-webp", root);
        v2gAbort = $("#v2g-abort", root);
        v2gProgress = $("#v2g-progress", root);
        v2gProgressFill = $("#v2g-progress-fill", root);
        v2gProgressText = $("#v2g-progress-text", root);
        v2gProgressSub = $("#v2g-progress-sub", root);
        v2gProgressPct = $("#v2g-progress-pct", root);
        v2gPreview = $("#v2g-preview", root);
        v2gDownload = $("#v2g-download", root);
        v2gCompress = $("#v2g-compress", root);
        v2gCompressAgain = $("#v2g-compress-again", root);
        v2gCompressLevel = $("#v2g-compress-level", root);
  
        if (v2gFile && !v2gFile.dataset.v2gBound) {
          v2gFile.dataset.v2gBound = "1";
          v2gFile.addEventListener("change", (e) => loadVideoFile(e.target.files?.[0]));
        }
  
            $("#v2g-clear", root)?.addEventListener("click", clearV2g);
      window.DevToolsTemp?.registerCleanup(clearV2g);
      v2gGenerate?.addEventListener("click", convertVideoToGif);
      v2gGenerateWebp?.addEventListener("click", () => {
        convertVideoToWebp().catch((err) => setError(v2gError, err.message || String(err)));
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
      flushPendingFileInput(v2gFile, (files) => loadVideoFile(files?.[0]));
  
  
      });
      // ---- Video split (shares FFmpeg / blackbox encoder) ----
      let vsplitFile;
      let vsplitVideo;
      let vsplitMeta;
      let vsplitError;
      let vsplitCount;
      let vsplitCountRow;
      let vsplitDurationRow;
      let vsplitManualRow;
      let vsplitManualTransport;
      let vsplitStage;
      let vsplitScrub;
      let vsplitScrubHome;
      let vsplitScrubBlock;
      let vsplitFsScrubSlot;
      let vsplitScrubHit;
      let vsplitScrubMarks;
      let vsplitMarkPicker;
      let vsplitMarkChips;
      let vsplitScrubHint;
      let vsplitPlay;
      let vsplitMute;
      let vsplitFs;
      let vsplitFsHost;
      let vsplitFsOpenBtn;
      let vsplitFsClose;
      let vsplitFsPlay;
      let vsplitFsMute;
      let vsplitFsMark;
      let vsplitFsUndo;
      let vsplitFsNow;
      let vsplitFsStatus;
      let vsplitFsNote;
      let vsplitFsFlash;
      let vsplitPreviewWrap;
      let vsplitManualNow;
      let vsplitManualCount;
      let vsplitManualDraft;
      let vsplitMarksEl;
      let vsplitMarkTap;
      let vsplitMarkUndo;
      let vsplitMarkClear;
      let vsplitAddBtns;
      let vsplitEditBar;
      let vsplitEditTitle;
      let vsplitEditApply;
      let vsplitEditDelStart;
      let vsplitEditDelEnd;
      let vsplitEditDone;
      let vsplitQuickExport;
      let vsplitQuickCut;
      let vsplitQuickHq;
      let vsplitNudgeM1;
      let vsplitNudgeM01;
      let vsplitNudgeP01;
      let vsplitNudgeP1;
      let vsplitH;
      let vsplitM;
      let vsplitS;
      let vsplitFps;
      let vsplitWidth;
      let vsplitQuality;
      let vsplitCut;
      let vsplitGifHq;
      let vsplitMerge;
      let vsplitAbort;
      let vsplitList;
      let vsplitZipVideo;
      let vsplitZipGif;
      let vsplitMergedDl;
      let vsplitMergedPreview;
      let vsplitProgress;
      let vsplitProgressFill;
      let vsplitProgressText;
      let vsplitProgressSub;
      let vsplitProgressPct;
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
      let vsplitFsFeedbackRaf = 0;
      let vsplitFsScrubPaintRaf = 0;
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
        if (vsplitFsFeedbackRaf) window.cancelAnimationFrame(vsplitFsFeedbackRaf);
        if (vsplitFsScrubPaintRaf) window.cancelAnimationFrame(vsplitFsScrubPaintRaf);
        vsplitFsNoteTimer = 0;
        vsplitFsPulseTimer = 0;
        vsplitFsFlashTimer = 0;
        vsplitFsStatusTimer = 0;
        vsplitFsFeedbackRaf = 0;
        vsplitFsScrubPaintRaf = 0;
      }
  
      function bumpVsplitFsStatus() {
        if (!vsplitFsStatus) return;
        vsplitFsStatus.classList.remove("is-bump");
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
        vsplitFsMark.classList.add("is-pulse", kind === "end" ? "is-pulse-end" : "is-pulse-start");
        if (vsplitFsPulseTimer) window.clearTimeout(vsplitFsPulseTimer);
        vsplitFsPulseTimer = window.setTimeout(() => {
          vsplitFsMark.classList.remove("is-pulse", "is-pulse-start", "is-pulse-end");
          vsplitFsPulseTimer = 0;
        }, 200);
      }
  
      function ensureVsplitFsFlashOnTop() {
        if (!vsplitFsFlash || !vsplitFsHost) return;
        // 仅在需要时挪闪层，避免每次打点 appendChild 触发合成重建
        if (vsplitFsHost.lastElementChild !== vsplitFsFlash) {
          vsplitFsHost.appendChild(vsplitFsFlash);
        }
      }
  
      function flashVsplitFsFrame(kind) {
        if (!vsplitFsFlash || !vsplitFsHost) return;
        ensureVsplitFsFlashOnTop();
        const endClass = kind === "end" ? "is-end" : "is-start";
        // 不用 offsetWidth 强制回流；用 animation 重启
        vsplitFsFlash.classList.remove("is-pop", "is-start", "is-end");
        vsplitFsFlash.style.animation = "none";
        vsplitFsFlash.classList.add(endClass);
        // 下一帧再开动画，避免与打点 DOM 重绘抢同一帧
        requestAnimationFrame(() => {
          if (!vsplitFsOpen || !vsplitFsFlash) return;
          vsplitFsFlash.style.animation = "";
          vsplitFsFlash.classList.add("is-pop");
        });
        if (vsplitFsFlashTimer) window.clearTimeout(vsplitFsFlashTimer);
        vsplitFsFlashTimer = window.setTimeout(() => {
          vsplitFsFlash.classList.remove("is-pop", "is-start", "is-end");
          vsplitFsFlash.style.animation = "";
          vsplitFsFlashTimer = 0;
        }, 450);
      }
  
      function showVsplitFsNote(text, kind) {
        if (!vsplitFsNote) return;
        vsplitFsNote.hidden = false;
        vsplitFsNote.textContent = text || "";
        vsplitFsNote.classList.remove("is-on", "is-start", "is-end");
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
  
      /** 全屏打点节奏反馈；非全屏仍走 toast。视觉反馈延后一帧，避免与圆点重绘同帧卡死。 */
      function notifyVsplitMarkFeedback(message, kind) {
        if (!vsplitFsOpen) {
          toast(message);
          return;
        }
        ensureVsplitFsChromeVisible();
        paintVsplitFsChrome();
        buzzVsplitFs();
        if (vsplitFsFeedbackRaf) window.cancelAnimationFrame(vsplitFsFeedbackRaf);
        vsplitFsFeedbackRaf = requestAnimationFrame(() => {
          vsplitFsFeedbackRaf = 0;
          if (!vsplitFsOpen) return;
          pulseVsplitFsMarkBtn(kind);
          flashVsplitFsFrame(kind);
          bumpVsplitFsStatus();
          showVsplitFsNote(message, kind);
        });
      }
  
      function ensureVsplitFsVideoSurface() {
        if (!vsplitFsOpen || !vsplitVideo || !vsplitFsHost) return;
        if (vsplitVideo.parentElement !== vsplitFsHost) {
          if (vsplitFsFlash && vsplitFsFlash.parentElement === vsplitFsHost) {
            vsplitFsHost.insertBefore(vsplitVideo, vsplitFsFlash);
          } else {
            vsplitFsHost.appendChild(vsplitVideo);
          }
        }
        vsplitVideo.hidden = false;
        vsplitVideo.classList.add("is-fs");
        ensureVsplitFsFlashOnTop();
      }
  
      function ensureVsplitFsChromeVisible() {
        if (!vsplitFsOpen || !vsplitFs) return;
        vsplitFs.hidden = false;
        vsplitFs.querySelector(".vsplit-fs-top")?.style && (vsplitFs.querySelector(".vsplit-fs-top").style.visibility = "");
        vsplitFs.querySelector(".vsplit-fs-bottom")?.style &&
          (vsplitFs.querySelector(".vsplit-fs-bottom").style.visibility = "");
        ensureVsplitFsVideoSurface();
      }
  
      function enterVsplitFullscreen() {
        if (!vsplitVideo || !vsplitSourceFile || vsplitMode !== "manual" || !vsplitFs || !vsplitFsHost) return;
        if (vsplitFsOpen) return;
        if (vsplitEditIdx >= 0) exitVsplitEdit();
        vsplitFsOpen = true;
        vsplitFs.hidden = false;
        document.body.classList.add("vsplit-fs-open");
        // 只挪一次 video；先放视频再保证闪层在上，减少解码表面重建次数
        if (vsplitVideo.parentElement !== vsplitFsHost) {
          if (vsplitFsFlash && vsplitFsFlash.parentElement === vsplitFsHost) {
            vsplitFsHost.insertBefore(vsplitVideo, vsplitFsFlash);
          } else {
            vsplitFsHost.appendChild(vsplitVideo);
          }
        }
        ensureVsplitFsFlashOnTop();
        // 进度条 + 打点圆点一并带进全屏，避免无法拖进度
        if (vsplitScrubBlock && vsplitFsScrubSlot && vsplitScrubBlock.parentElement !== vsplitFsScrubSlot) {
          vsplitFsScrubSlot.appendChild(vsplitScrubBlock);
        }
        ensureVsplitFsVideoSurface();
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
        if (vsplitFsFlash) vsplitFsFlash.style.animation = "";
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
          if (typeof vsplitVideo.fastSeek === "function") vsplitVideo.fastSeek(t);
          else vsplitVideo.currentTime = t;
        } catch (_) {}
        if (vsplitFsOpen) ensureVsplitFsVideoSurface();
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
        if (vsplitFsOpen) ensureVsplitFsChromeVisible();
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
        if (vsplitFsOpen) {
          ensureVsplitFsChromeVisible();
          paintVsplitScrubMarks();
        }
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
        if (vsplitFsOpen && vsplitScrubbing) return;
        if (vsplitMode !== "manual") {
          vsplitScrubMarks.innerHTML = "";
          paintVsplitMarkChips();
          return;
        }
        const dur = vsplitVideoDuration();
        if (!(dur > 0)) {
          vsplitScrubMarks.innerHTML = "";
          if (!vsplitFsOpen) paintVsplitMarkChips();
          return;
        }
        const frag = document.createDocumentFragment();
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
          dot.dataset.t = String(t);
          if (idx >= 0) dot.dataset.idx = String(idx);
          if (active || picked) dot.style.zIndex = "5";
          const label = kind === "start" ? "起点" : "终点";
          const jumpToDot = (e) => {
            e.preventDefault();
            e.stopPropagation();
            seekVsplitPreview(t, { keepPlaying: true });
          };
          if (vsplitFsOpen) {
            dot.classList.add("is-jump");
            dot.setAttribute(
              "aria-label",
              idx >= 0 ? `跳到第 ${idx + 1} 段${label}` : `跳到${label}`
            );
            dot.addEventListener("pointerdown", (e) => {
              if (e.button != null && e.button !== 0) return;
              e.stopPropagation();
              seekVsplitPreview(t, { keepPlaying: true });
            });
            dot.addEventListener("click", jumpToDot);
          } else if (editable && idx >= 0) {
            dot.setAttribute(
              "aria-label",
              `${picked ? "当前点到 · " : ""}选中第 ${idx + 1} 段${label}`
            );
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
          frag.appendChild(dot);
        };
  
        /* 全屏圆点只跳进度，不进编辑 */
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
        vsplitScrubMarks.replaceChildren(frag);
        if (!vsplitFsOpen) paintVsplitMarkChips();
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
            ensureVsplitFsChromeVisible();
            // 全屏：文案立刻更新；圆点合并到下一帧，避开与闪层反馈抢主线程
            paintVsplitDraft();
            paintVsplitNow();
            setVsplitButtons();
            if (vsplitScrubbing) return;
            if (!vsplitFsScrubPaintRaf) {
              vsplitFsScrubPaintRaf = requestAnimationFrame(() => {
                vsplitFsScrubPaintRaf = 0;
                if (!vsplitFsOpen || vsplitScrubbing) return;
                paintVsplitScrubMarks();
              });
            }
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
            flushVsplitMarkPaint();
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
  
      function seekToLatestVsplitMark() {
        let t = 0;
        if (vsplitDraftStart != null) t = vsplitDraftStart;
        else {
          const last = vsplitMarks[vsplitMarks.length - 1];
          if (last) t = last.end != null ? last.end : last.start != null ? last.start : 0;
        }
        seekVsplitPreview(t, { keepPlaying: true });
      }
  
      function undoVsplitDraft() {
        vsplitDraftStart = null;
        flushVsplitMarkPaint();
        seekToLatestVsplitMark();
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
          flushVsplitMarkPaint();
          seekToLatestVsplitMark();
          notifyVsplitMarkFeedback(`已取消终点 · 起点保留 ${formatClock(start)}`, "start");
          return;
        }
        // 3) 仅剩起点（或不完整段）→ 取消该起点
        vsplitMarks.splice(lastIdx, 1);
        invalidateVsplitOutputsFromMarks();
        flushVsplitMarkPaint();
        seekToLatestVsplitMark();
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
  
      bindPanel("vsplit", () => {
        const root = document.getElementById("vsplit");
        vsplitFile = $("#vsplit-file", root);
        vsplitVideo = $("#vsplit-video", root);
        vsplitMeta = $("#vsplit-meta", root);
        vsplitError = $("#vsplit-error", root);
        vsplitCount = $("#vsplit-count", root);
        vsplitCountRow = $("#vsplit-count-row", root);
        vsplitDurationRow = $("#vsplit-duration-row", root);
        vsplitManualRow = $("#vsplit-manual-row", root);
        vsplitManualTransport = $("#vsplit-manual-transport", root);
        vsplitStage = $("#vsplit-stage", root);
        vsplitScrub = $("#vsplit-scrub", root);
        vsplitScrubHome = $("#vsplit-scrub-home", root);
        vsplitScrubBlock = $("#vsplit-scrub-block", root);
        vsplitFsScrubSlot = $("#vsplit-fs-scrub-slot");
        vsplitScrubHit = $("#vsplit-scrub-hit", root);
        vsplitScrubMarks = $("#vsplit-scrub-marks", root);
        vsplitMarkPicker = $("#vsplit-mark-picker", root);
        vsplitMarkChips = $("#vsplit-mark-chips", root);
        vsplitScrubHint = $("#vsplit-scrub-hint", root);
        vsplitPlay = $("#vsplit-play", root);
        vsplitMute = $("#vsplit-mute", root);
        vsplitFs = $("#vsplit-fs");
        vsplitFsHost = $("#vsplit-fs-host");
        vsplitFsOpenBtn = $("#vsplit-fs-open", root);
        vsplitFsClose = $("#vsplit-fs-close");
        vsplitFsPlay = $("#vsplit-fs-play");
        vsplitFsMute = $("#vsplit-fs-mute");
        vsplitFsMark = $("#vsplit-fs-mark");
        vsplitFsUndo = $("#vsplit-fs-undo");
        vsplitFsNow = $("#vsplit-fs-now");
        vsplitFsStatus = $("#vsplit-fs-status");
        vsplitFsNote = $("#vsplit-fs-note");
        vsplitFsFlash = $("#vsplit-fs-flash");
        vsplitPreviewWrap = $("#vsplit-preview-wrap", root);
        vsplitManualNow = $("#vsplit-manual-now", root);
        vsplitManualCount = $("#vsplit-manual-count", root);
        vsplitManualDraft = $("#vsplit-manual-draft", root);
        vsplitMarksEl = $("#vsplit-marks", root);
        vsplitMarkTap = $("#vsplit-mark-tap", root);
        vsplitMarkUndo = $("#vsplit-mark-undo", root);
        vsplitMarkClear = $("#vsplit-mark-clear", root);
        vsplitAddBtns = $("#vsplit-add-btns", root);
        vsplitEditBar = $("#vsplit-edit-bar", root);
        vsplitEditTitle = $("#vsplit-edit-title", root);
        vsplitEditApply = $("#vsplit-edit-apply", root);
        vsplitEditDelStart = $("#vsplit-edit-del-start", root);
        vsplitEditDelEnd = $("#vsplit-edit-del-end", root);
        vsplitEditDone = $("#vsplit-edit-done", root);
        vsplitQuickExport = $("#vsplit-quick-export", root);
        vsplitQuickCut = $("#vsplit-quick-cut", root);
        vsplitQuickHq = $("#vsplit-quick-hq", root);
        vsplitNudgeM1 = $("#vsplit-nudge-m1", root);
        vsplitNudgeM01 = $("#vsplit-nudge-m01", root);
        vsplitNudgeP01 = $("#vsplit-nudge-p01", root);
        vsplitNudgeP1 = $("#vsplit-nudge-p1", root);
        vsplitH = $("#vsplit-h", root);
        vsplitM = $("#vsplit-m", root);
        vsplitS = $("#vsplit-s", root);
        vsplitFps = $("#vsplit-fps", root);
        vsplitWidth = $("#vsplit-width", root);
        vsplitQuality = $("#vsplit-quality", root);
        vsplitCut = $("#vsplit-cut", root);
        vsplitGifHq = $("#vsplit-gif-hq", root);
        vsplitMerge = $("#vsplit-merge", root);
        vsplitAbort = $("#vsplit-abort", root);
        vsplitList = $("#vsplit-list", root);
        vsplitZipVideo = $("#vsplit-zip-video", root);
        vsplitZipGif = $("#vsplit-zip-gif", root);
        vsplitMergedDl = $("#vsplit-merged-dl", root);
        vsplitMergedPreview = $("#vsplit-merged-preview", root);
        vsplitProgress = $("#vsplit-progress", root);
        vsplitProgressFill = $("#vsplit-progress-fill", root);
        vsplitProgressText = $("#vsplit-progress-text", root);
        vsplitProgressSub = $("#vsplit-progress-sub", root);
        vsplitProgressPct = $("#vsplit-progress-pct", root);
  
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
      function bindVsplitNudgeRepeat(btn, delta) {
        if (!btn) return;
        const step = Math.abs(Number(delta) || 0);
        const isFine = step > 0 && step <= 0.15;
        const holdDelay = isFine ? 560 : 500;
        const repeatMs = isFine ? 220 : 130;
        let holdTimer = 0;
        let repeatTimer = 0;
        let holding = false;
        let lastStartAt = 0;
        let lastTickAt = 0;
        btn.style.webkitUserSelect = "none";
        btn.style.userSelect = "none";
        btn.style.webkitTouchCallout = "none";
        const stop = () => {
          if (holdTimer) window.clearTimeout(holdTimer);
          if (repeatTimer) window.clearInterval(repeatTimer);
          holdTimer = 0;
          repeatTimer = 0;
          holding = false;
        };
        const tick = () => {
          if (btn.disabled) {
            stop();
            return;
          }
          const now = Date.now();
          // iOS 上 touchstart + pointerdown 会各来一次，合并成一步
          if (lastTickAt && now - lastTickAt < 90) return;
          lastTickAt = now;
          nudgeVsplitPreview(delta);
        };
        const start = () => {
          if (holding || btn.disabled) return;
          holding = true;
          lastStartAt = Date.now();
          window.getSelection?.()?.removeAllRanges?.();
          tick();
          holdTimer = window.setTimeout(() => {
            holdTimer = 0;
            if (!holding || btn.disabled) return;
            repeatTimer = window.setInterval(tick, repeatMs);
          }, holdDelay);
        };
        const onPointerDown = (e) => {
          if (e.pointerType === "mouse" && e.button != null && e.button !== 0) return;
          e.preventDefault();
          start();
        };
        const onTouchStart = (e) => {
          // 拦 iOS 选字。pointer 可能随后才到，这里也允许起步；holding/合并计步保证只走一次
          e.preventDefault();
          start();
        };
        btn.addEventListener("pointerdown", onPointerDown, { passive: false });
        btn.addEventListener("pointerup", stop);
        btn.addEventListener("pointercancel", stop);
        btn.addEventListener("touchstart", onTouchStart, { passive: false });
        btn.addEventListener("touchend", stop);
        btn.addEventListener("touchcancel", stop);
        btn.addEventListener(
          "touchmove",
          (e) => {
            if (!holding) return;
            e.preventDefault();
          },
          { passive: false }
        );
        btn.addEventListener("contextmenu", (e) => e.preventDefault());
        btn.addEventListener("selectstart", (e) => e.preventDefault());
        btn.addEventListener("click", (e) => {
          e.preventDefault();
          if (holding) return;
          if (lastStartAt && Date.now() - lastStartAt < 800) return;
          if (btn.disabled) return;
          tick();
        });
      }
  
      bindVsplitNudgeRepeat(vsplitNudgeM1, -1);
      bindVsplitNudgeRepeat(vsplitNudgeM01, -0.1);
      bindVsplitNudgeRepeat(vsplitNudgeP01, 0.1);
      bindVsplitNudgeRepeat(vsplitNudgeP1, 1);
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
      flushPendingFileInput(vsplitFile, (files) =>
        loadVsplitFile(files?.[0]).catch((err) => {
          clearVsplit();
          setError(vsplitError, err.message || String(err));
        })
      );
  
  
      });
      // ---- One-click blackbox split planner (vbb) ----
      let vbbFile;
      let vbbVideo;
      let vbbMeta;
      let vbbError;
      let vbbAnalyze;
      let vbbRun;
      let vbbOneclick;
      let vbbAdvanced;
      let vbbSplitPanel;
      let vbbWorkflowHint;
      let vbbMerge;
      let vbbAbort;
      let vbbZip;
      let vbbMergedDl;
      let vbbMergedPreview;
      let vbbMergedBlock;
      let vbbMergedMeta;
      let vbbResultSummary;
      let vbbProgress;
      let vbbProgressFill;
      let vbbProgressText;
      let vbbProgressSub;
      let vbbProgressPct;
      let vbbPlan;
      let vbbPlanSummary;
      let vbbPlanList;
      let vbbList;
      let vbbBatchList;
      let vbbResultBlock;
      let vbbCustomRow;
      let vbbTargetSpan;
      let vbbTargetRange;
      let vbbTargetLabel;
      let vbbEqualizeHint;
      let vbbEqualize;
      let vbbManualPanel;
      let vbbScrub;
      let vbbPlay;
      let vbbManualNow;
      let vbbManualCount;
      let vbbManualDraft;
      let vbbMarkTap;
      let vbbMarkUndo;
      let vbbMarkClear;
      let vbbNudgeM1;
      let vbbNudgeM01;
      let vbbNudgeP01;
      let vbbNudgeP1;
      let vbbScrubMarks;
      let vbbMarkChips;
      let vbbJumpTime;
      let vbbJumpGo;
      let vbbLongHint;
      const VBB_LONG_VIDEO_SEC = 180;
      const VBB_MANUAL_SEEK_DEBOUNCE_MS = 120;
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
        "支持 MP4 / WebM / MOV。可多选已裁好的短片，一次性全部转黑盒 GIF；仅本机读取，不会上传。";
      const VBB_WORKFLOW_HINTS = {
        single: "整段视频将输出一个 GIF，选视频后点「一键黑盒」即可。",
        split: "长视频切片：先点「① 分析切分方案」查看段数与预估，调整满意后点「② 按方案生成 GIF」。",
        manual: "手动打点：拖到起点/终点点「打起点」「打终点」，标记多段后点「一键黑盒」。",
      };
  
      let vbbSourceFile = null;
      /** @type {{ file: File, duration: number, srcW: number, srcH: number }[]} */
      let vbbBatchFiles = [];
      let vbbObjectUrl = "";
      let vbbBusy = false;
      let abortVbb = false;
      let vbbMode = "duration";
      let vbbWorkflow = "single";
      /** 自定义段时长参考值（均分开启时仅用于算段数，不直接覆盖为实际每段时长） */
      let vbbSegmentTarget = 12;
      let vbbAnalysis = null;
      let vbbClips = [];
      let vbbZipUrl = "";
      let vbbMergedUrl = "";
      /** 仅预览当前选中片段，避免手机同时解码多个大 GIF 白屏 */
      let vbbPreviewIdx = -1;
      /** @type {{start:number,end:number}[]} */
      let vbbMarks = [];
      /** @type {number|null} */
      let vbbDraftStart = null;
      let vbbPlaying = false;
      let vbbScrubbing = false;
      const VBB_SCRUB_STEPS = 1000;
      let vbbSeekTimer = 0;
      let vbbPendingSeek = null;
  
      function parseVbbJumpTime(raw) {
        const text = String(raw || "").trim();
        if (!text) return null;
        if (/^\d+(\.\d+)?$/.test(text)) return Number(text);
        const m = text.match(/^(\d+):(\d+(?:\.\d+)?)$/);
        if (m) return Number(m[1]) * 60 + Number(m[2]);
        const h = text.match(/^(\d+):(\d+):(\d+(?:\.\d+)?)$/);
        if (h) return Number(h[1]) * 3600 + Number(h[2]) * 60 + Number(h[3]);
        return null;
      }
  
      function pauseVbbPreview() {
        try {
          vbbVideo?.pause?.();
        } catch (_) {}
        vbbPlaying = false;
      }
  
      function vbbScrubValueToTime(value) {
        const d = vbbVideoDuration();
        if (!(d > 0)) return 0;
        return (Number(value) / VBB_SCRUB_STEPS) * d;
      }
  
      function vbbTimeToScrubValue(sec) {
        const d = vbbVideoDuration();
        if (!(d > 0)) return 0;
        return Math.round((Math.max(0, Math.min(sec, d)) / d) * VBB_SCRUB_STEPS);
      }
  
      function syncVbbScrubFromVideo() {
        if (!vbbScrub || vbbScrubbing) return;
        const d = vbbVideoDuration();
        const has = Boolean(vbbSourceFile && d > 0);
        vbbScrub.disabled = !has || vbbBusy || !isVbbManualMode();
        if (!has) {
          vbbScrub.value = "0";
          return;
        }
        vbbScrub.max = String(VBB_SCRUB_STEPS);
        vbbScrub.value = String(vbbTimeToScrubValue(vbbMarkTime()));
      }
  
      function applyVbbSeek(sec, opts = {}) {
        if (!vbbVideo?.src) return;
        const d = vbbVideoDuration();
        const t = Math.max(0, Math.min(d || 0, Number(sec) || 0));
        if (!opts.keepPlaying) pauseVbbPreview();
        try {
          if (typeof vbbVideo.fastSeek === "function") vbbVideo.fastSeek(t);
          else vbbVideo.currentTime = t;
        } catch (_) {}
        if (!opts.fromScrub) syncVbbScrubFromVideo();
        paintVbbNow();
      }
  
      function scheduleVbbSeek(sec, opts = {}) {
        vbbPendingSeek = { sec, opts };
        clearTimeout(vbbSeekTimer);
        vbbSeekTimer = window.setTimeout(() => {
          vbbSeekTimer = 0;
          if (vbbPendingSeek) {
            applyVbbSeek(vbbPendingSeek.sec, vbbPendingSeek.opts);
            vbbPendingSeek = null;
          }
        }, opts.immediate ? 0 : VBB_MANUAL_SEEK_DEBOUNCE_MS);
      }
  
      function flushVbbSeek() {
        clearTimeout(vbbSeekTimer);
        vbbSeekTimer = 0;
        if (vbbPendingSeek) {
          applyVbbSeek(vbbPendingSeek.sec, { ...vbbPendingSeek.opts, immediate: true });
          vbbPendingSeek = null;
        }
      }
  
      function paintVbbNow() {
        const hasVideo = Boolean(vbbSourceFile && vbbVideo?.src);
        const d = vbbVideoDuration();
        const t = vbbScrubbing ? vbbScrubValueToTime(vbbScrub?.value) : vbbMarkTime();
        if (vbbManualNow) {
          vbbManualNow.textContent = hasVideo ? `${formatVbbClock(t)} / ${formatVbbClock(d)}` : "0:00 / 0:00";
        }
        const count = completeVbbMarks().length;
        if (vbbManualCount) {
          vbbManualCount.textContent = vbbMarks.length ? `${count}/${vbbMarks.length} 段` : "0 段";
        }
        if (vbbManualDraft) {
          if (vbbDraftStart != null) {
            vbbManualDraft.hidden = false;
            vbbManualDraft.textContent = `已设起点 ${formatVbbClock(vbbDraftStart)} · 拖到终点后点「打终点」`;
          } else {
            vbbManualDraft.hidden = true;
            vbbManualDraft.textContent = "";
          }
        }
        if (vbbMarkTap) vbbMarkTap.textContent = vbbDraftStart == null ? "打起点" : "打终点";
        if (vbbPlay) vbbPlay.textContent = vbbPlaying ? "暂停" : "播放";
        if (!vbbScrubbing) syncVbbScrubFromVideo();
      }
  
      function paintVbbScrubMarks() {
        if (!vbbScrubMarks) return;
        const d = vbbVideoDuration();
        vbbScrubMarks.innerHTML = "";
        if (!(d > 0) || !isVbbManualMode()) return;
        const addDot = (t, kind) => {
          const dot = document.createElement("button");
          dot.type = "button";
          dot.className = `vsplit-scrub-mark is-${kind} is-jump`;
          dot.style.left = `${(t / d) * 100}%`;
          dot.title = `${kind === "start" ? "起点" : "终点"} ${formatVbbClock(t)}`;
          dot.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            seekVbbPreview(t, { keepPlaying: true });
          });
          vbbScrubMarks.appendChild(dot);
        };
        if (vbbDraftStart != null) addDot(vbbDraftStart, "start");
        vbbMarks.forEach((mark) => {
          if (mark.start != null) addDot(mark.start, "start");
          if (mark.end != null) addDot(mark.end, "end");
        });
      }
  
      function paintVbbMarkChips() {
        if (!vbbMarkChips) return;
        const marks = completeVbbMarks();
        vbbMarkChips.innerHTML = "";
        vbbMarkChips.hidden = !marks.length;
        marks.forEach((mark, idx) => {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "vsplit-mark-chip";
          chip.textContent = `#${String(idx + 1).padStart(2, "0")} ${formatVbbClock(mark.start)}→${formatVbbClock(mark.end)}`;
          chip.addEventListener("click", () => seekVbbPreview(mark.start, { keepPlaying: true }));
          vbbMarkChips.appendChild(chip);
        });
      }
  
      function syncVbbLongHint() {
        const d = vbbVideoDuration();
        const show = isVbbManualMode() && d >= VBB_LONG_VIDEO_SEC;
        if (vbbLongHint) vbbLongHint.hidden = !show;
      }
  
      function paintVbbManualControls() {
        const manual = isVbbManualMode();
        if (vbbManualPanel) vbbManualPanel.hidden = !manual;
        if (vbbAdvanced) vbbAdvanced.hidden = manual || isVbbBatchMode();
        if (vbbVideo) {
          if (manual && vbbVideo.src) {
            vbbVideo.controls = false;
            vbbVideo.hidden = false;
            vbbVideo.preload = "metadata";
          } else if (vbbVideo.src) {
            vbbVideo.controls = true;
          }
        }
        syncVbbLongHint();
        const canMark = manual && Boolean(vbbSourceFile && vbbVideo?.src) && !vbbBusy;
        if (vbbScrub) vbbScrub.disabled = !canMark;
        if (vbbPlay) vbbPlay.disabled = !canMark;
        [vbbNudgeM1, vbbNudgeM01, vbbNudgeP01, vbbNudgeP1, vbbJumpGo].forEach((btn) => {
          if (btn) btn.disabled = !canMark;
        });
        if (vbbJumpTime) vbbJumpTime.disabled = !canMark;
        if (vbbMarkTap) vbbMarkTap.disabled = !canMark;
        if (vbbMarkUndo) {
          vbbMarkUndo.disabled = !canMark || (vbbDraftStart == null && !vbbMarks.length);
          vbbMarkUndo.textContent = vbbDraftStart != null ? "取消起点" : "取消上一段";
        }
        if (vbbMarkClear) vbbMarkClear.disabled = !canMark || (!vbbMarks.length && vbbDraftStart == null);
        if (vbbOneclick && isVbbManualMode()) {
          const count = completeVbbMarks().length;
          vbbOneclick.textContent = count > 0 ? `一键黑盒（${count} 段）` : "一键黑盒";
        }
        paintVbbNow();
        paintVbbScrubMarks();
        paintVbbMarkChips();
      }
  
      function isVbbManualMode() {
        return vbbWorkflow === "manual" && !isVbbBatchMode();
      }
  
      function isVbbSplitMode() {
        return vbbWorkflow === "split" && !isVbbBatchMode();
      }
  
      function vbbVideoDuration() {
        return Math.max(0, Number(vbbVideo?.duration) || 0);
      }
  
      function vbbMarkTime() {
        if (!vbbVideo?.src) return 0;
        return Math.max(0, Math.min(vbbVideoDuration(), Number(vbbVideo.currentTime) || 0));
      }
  
      function normalizeVbbMark(start, end) {
        const d = vbbVideoDuration();
        let s = Math.max(0, Math.min(Number(start) || 0, d));
        let e = Math.max(0, Math.min(Number(end) || 0, d));
        if (e < s) [s, e] = [e, s];
        if (e - s < VBB_MIN_SPAN - 0.001) return null;
        return { start: s, end: e };
      }
  
      function completeVbbMarks() {
        return vbbMarks.filter((m) => m && m.start != null && m.end != null && m.end - m.start >= VBB_MIN_SPAN - 0.001);
      }
  
      function computeVbbManualRanges() {
        const d = vbbVideoDuration();
        if (!(d > 0)) throw new Error("无法读取视频时长");
        const marks = completeVbbMarks();
        if (!marks.length) throw new Error("请先标记至少一段完整的起点和终点");
        return marks.map((m) => {
          const start = Math.max(0, Math.min(m.start, d));
          const end = Math.max(start + VBB_MIN_SPAN, Math.min(m.end, d));
          return { start, span: end - start };
        });
      }
  
      function seekVbbPreview(sec, opts = {}) {
        if (!vbbVideo?.src) return;
        if (opts.debounced) {
          scheduleVbbSeek(sec, opts);
          return;
        }
        flushVbbSeek();
        applyVbbSeek(sec, opts);
        if (!opts.silent) paintVbbManualControls();
      }
  
      function paintVbbManualUi() {
        paintVbbManualControls();
      }
  
      function clearVbbMarks() {
        vbbMarks = [];
        vbbDraftStart = null;
        paintVbbManualUi();
      }
  
      function tapVbbMark() {
        if (!isVbbManualMode() || !vbbSourceFile || !vbbVideo?.src) {
          toast("请先选择视频");
          return;
        }
        const t = vbbMarkTime();
        if (vbbDraftStart == null) {
          vbbDraftStart = t;
          paintVbbManualUi();
          toast(`起点 ${formatVbbClock(t)}`);
          return;
        }
        if (vbbMarks.length >= VBB_MAX_CLIPS) {
          toast(`最多 ${VBB_MAX_CLIPS} 段`);
          return;
        }
        const next = normalizeVbbMark(vbbDraftStart, t);
        if (!next) {
          toast(`终点至少距起点 ${VBB_MIN_SPAN} 秒`);
          return;
        }
        vbbMarks.push(next);
        vbbMarks.sort((a, b) => a.start - b.start);
        vbbDraftStart = null;
        paintVbbManualUi();
        toast(`已添加 · ${(next.end - next.start).toFixed(1)}s`);
      }
  
      function undoVbbMark() {
        if (vbbDraftStart != null) {
          vbbDraftStart = null;
          paintVbbManualUi();
          toast("已取消起点");
          return;
        }
        if (!vbbMarks.length) {
          toast("没有可取消的标记");
          return;
        }
        const last = vbbMarks[vbbMarks.length - 1];
        if (last?.end != null && last?.start != null) {
          vbbMarks.pop();
          vbbDraftStart = last.start;
          paintVbbManualUi();
          toast("已取消上一段终点");
          return;
        }
        vbbMarks.pop();
        paintVbbManualUi();
        toast("已删除上一段");
      }
  
      function nudgeVbbPreview(delta) {
        if (!vbbVideo?.src) return;
        seekVbbPreview(vbbMarkTime() + Number(delta || 0));
      }
  
      function isVbbBatchMode() {
        return vbbBatchFiles.length > 1;
      }
  
      function vbbGifBaseName(file) {
        const name = String(file?.name || "clip");
        return name.replace(/\.[^.]+$/i, "").replace(/[^\w\u4e00-\u9fff.-]+/g, "_") || "clip";
      }
  
      function vbbGifDownloadName(clip, idx) {
        if (clip?.sourceName) return `${clip.sourceName}.gif`;
        return `bb-${String((idx ?? 0) + 1).padStart(2, "0")}.gif`;
      }
  
      function isLikelyVideoFile(file) {
        if (!file) return false;
        if (String(file.type || "").startsWith("video/")) return true;
        return /\.(mp4|webm|mov|m4v)$/i.test(String(file.name || ""));
      }
  
      function isLikelyMobileBrowser() {
        return (
          window.matchMedia("(max-width: 900px)").matches ||
          /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "")
        );
      }
  
      function shouldPinVbbScroll() {
        return isLikelyMobileBrowser();
      }
  
      let vbbScrollGuardReady = false;
      let vbbUserScrollUntil = 0;
      let vbbProgrammaticScroll = false;
  
      function markVbbUserScroll() {
        if (vbbProgrammaticScroll) return;
        vbbUserScrollUntil = Date.now() + 480;
      }
  
      function isVbbUserScrolling() {
        return Date.now() < vbbUserScrollUntil;
      }
  
      function ensureVbbScrollGuard() {
        if (vbbScrollGuardReady) return;
        vbbScrollGuardReady = true;
        const opts = { passive: true, capture: true };
        window.addEventListener("touchstart", markVbbUserScroll, opts);
        window.addEventListener("touchmove", markVbbUserScroll, opts);
        window.addEventListener("wheel", markVbbUserScroll, opts);
        const shell = document.querySelector(".shell");
        if (shell) {
          shell.addEventListener("touchstart", markVbbUserScroll, opts);
          shell.addEventListener("touchmove", markVbbUserScroll, opts);
          shell.addEventListener("wheel", markVbbUserScroll, opts);
          shell.addEventListener("scroll", markVbbUserScroll, opts);
        }
      }
  
      function vbbScrollRoot() {
        const shell = document.querySelector(".shell");
        if (window.matchMedia("(min-width: 901px)").matches && shell) return shell;
        return document.scrollingElement || document.documentElement;
      }
  
      function readVbbScrollTop(root) {
        if (!root || root === document.documentElement || root === document.scrollingElement) {
          return window.scrollY || 0;
        }
        return root.scrollTop || 0;
      }
  
      function writeVbbScrollTop(root, top) {
        const y = Math.max(0, Number(top) || 0);
        if (!root || root === document.documentElement || root === document.scrollingElement) {
          window.scrollTo({ top: y, left: 0, behavior: "auto" });
          return;
        }
        root.scrollTop = y;
      }
  
      function restoreVbbScrollLater(top) {
        const root = vbbScrollRoot();
        const apply = () => {
          vbbProgrammaticScroll = true;
          writeVbbScrollTop(root, top);
          requestAnimationFrame(() => {
            vbbProgrammaticScroll = false;
          });
        };
        requestAnimationFrame(() => {
          apply();
          requestAnimationFrame(apply);
        });
      }
  
      function pinVbbViewport(mutator) {
        if (!shouldPinVbbScroll() || isVbbUserScrolling()) return mutator();
        const top = readVbbScrollTop(vbbScrollRoot());
        const out = mutator();
        restoreVbbScrollLater(top);
        return out;
      }
  
      function runVbbLayoutUpdate(mutator, { pin = false } = {}) {
        if (pin && shouldPinVbbScroll() && !isVbbUserScrolling()) return pinVbbViewport(mutator);
        return mutator();
      }
  
      function blurVbbActionButton(el) {
        if (!shouldPinVbbScroll() || !el) return;
        requestAnimationFrame(() => {
          try {
            el.blur();
          } catch (_) {}
        });
      }
  
      async function probeVbbVideoFile(file, videoEl = vbbVideo) {
        if (!file || !videoEl) throw new Error("无法读取视频");
        const url = URL.createObjectURL(file);
        try {
          attachLocalVideoPreview(videoEl, url);
          await waitVideoMetadata(videoEl);
          const duration = Number(videoEl.duration) || 0;
          const srcW = videoEl.videoWidth || 0;
          const srcH = videoEl.videoHeight || 0;
          if (!(duration >= VBB_MIN_SPAN)) throw new Error(`${file.name || "视频"}：太短，至少约 ${VBB_MIN_SPAN} 秒`);
          if (!srcW) throw new Error(`${file.name || "视频"}：无法读取尺寸`);
          return { file, duration, srcW, srcH };
        } finally {
          URL.revokeObjectURL(url);
          videoEl.pause?.();
          videoEl.removeAttribute("src");
          videoEl.load?.();
          videoEl.hidden = true;
        }
      }
  
      function renderVbbBatchList() {
        if (!vbbBatchList) return;
        if (!isVbbBatchMode()) {
          vbbBatchList.hidden = true;
          vbbBatchList.innerHTML = "";
          return;
        }
        vbbBatchList.hidden = false;
        vbbBatchList.innerHTML = "";
        vbbBatchFiles.forEach((item, idx) => {
          const row = document.createElement("div");
          row.className = "vbb-batch-row hint tight";
          row.textContent = `${idx + 1}. ${item.file.name} · ${item.duration.toFixed(1)}s · ${formatKb(item.file.size)}`;
          vbbBatchList.appendChild(row);
        });
      }
  
      function syncVbbBatchMeta() {
        if (!vbbMeta) return;
        if (!isVbbBatchMode()) return;
        const totalDur = vbbBatchFiles.reduce((sum, item) => sum + item.duration, 0);
        const totalSize = vbbBatchFiles.reduce((sum, item) => sum + (item.file.size || 0), 0);
        vbbMeta.textContent = `已选 ${vbbBatchFiles.length} 个视频 · 共 ${totalDur.toFixed(1)}s · ${formatKb(totalSize)} · 点「一键黑盒」全部转换`;
      }
  
      /** 总进度条与各片段进度并存 */
      function vbbFfmpegPhaseText(raw) {
        const t = String(raw || "").trim();
        if (!t) return "";
        return t
          .replace(/准备\s*FFmpeg\s*引擎/gi, "准备引擎")
          .replace(/载入本地编码器[^…]*/g, "载入编码器")
          .replace(/加载引擎/g, "载入引擎")
          .replace(/双通道调色板编码/g, "调色板编码")
          .replace(/分析调色板/g, "分析调色板")
          .replace(/写入\s*GIF\s*帧/g, "写入帧")
          .replace(/读取\s*GIF/g, "读取结果")
          .replace(/本地载入/g, "载入视频")
          .replace(/抽取片段/g, "截取片段")
          .replace(/准备编码/g, "准备编码")
          .replace(/编码中请稍候/g, "编码中")
          .trim();
      }

      function vbbStageText(text) {
        const t = String(text || "").trim();
        if (!t) return "";
        if (/^(完成|失败|等待|编码|合并|分析|整段转换|批量转换)/.test(t) && t.length <= 24) return t;

        let m;
        if ((m = t.match(/^黑盒编码\s*·\s*(\d+)\s*FPS/i))) return `试 ${m[1]} 帧/秒`;
        if ((m = t.match(/^黑盒压缩\s*·\s*(\d+)\s*FPS(?:\s*·\s*(.+))?$/i))) {
          const tail = m[2] ? vbbStageText(m[2]) : "";
          return tail ? `压缩 ${m[1]} FPS · ${tail}` : `压缩 ${m[1]} 帧/秒`;
        }
        if ((m = t.match(/^黑盒加宽\s*·\s*(\d+)/i))) return `加宽至 ${m[1]}px`;
        if ((m = t.match(/^试\s*(\d+)\s*帧\/秒/i))) return t;
        if ((m = t.match(/^压缩\s*(\d+)\s*FPS/i))) return t;
        if ((m = t.match(/^加宽至\s*(\d+)px/i))) return t;
        if (/^沿用方案/.test(t)) return t.replace(/\s*·\s*/g, " · ");
        if ((m = t.match(/^沿用后超限降宽\s*·\s*(\d+)/i))) return `方案超限，降宽至 ${m[1]}px`;

        if (/^(完成|失败|等待|编码|合并|分析|压缩|降宽)/.test(t) && t.length <= 12) return t;
        const fps = t.match(/(\d+)FPS/);
        if (fps && /压缩|编码/.test(t)) return `${fps[1]} FPS`;
        if (/降宽/.test(t)) {
          const w = t.match(/→\s*(\d+)/) || t.match(/宽\s*(\d+)/);
          return w ? `降宽 ${w[1]}` : "降宽";
        }
        if (/沿用/.test(t)) return t.includes("方案") ? "沿用方案" : "沿用";
        if (/样片|分析/.test(t)) return t.replace(/编码样片/, "样片").replace(/分析中\s*[·.]?\s*/, "分析 ");

        if ((m = t.match(/^(\d+)FPS\s*·\s*(.+)$/i))) {
          const head = vbbFfmpegPhaseText(m[2].split("·")[0]?.trim());
          return head ? `${m[1]} FPS · ${head}` : `${m[1]} FPS`;
        }

        return t
          .replace(/超限→黑盒|仍超限[，,]?\s*改走黑盒/g, "超限")
          .replace(/清晰 GIF|锐度 GIF/g, (m) => m.replace(" GIF", ""))
          .replace(/时长黑盒|手动黑盒|批量黑盒|黑盒回退|黑盒完成|黑盒编码|改走黑盒|压黑盒|黑盒压缩|黑盒加宽|符合黑盒|黑盒/g, "")
          .replace(/\s*·\s*/g, " · ")
          .replace(/(^·|·$)/g, "")
          .trim();
      }

      function formatVbbJobStage(text) {
        const raw = String(text || "").trim();
        if (!raw) return "处理中…";
        return vbbTickerLine(raw) || vbbStageText(raw) || raw;
      }

      function bumpVbbEncodeProgress(ratio, main, stageText, opts = {}) {
        const stage = formatVbbJobStage(stageText);
        setVbbProgress(true, ratio, main, { sub: stage, busy: opts.busy !== false });
        return stage;
      }
  
      function vbbTickerLine(text) {
        const t = String(text || "").trim();
        if (!t) return "";
        if (/已用时|%\s*·|编码中|请稍候/.test(t)) {
          const elapsed = t.match(/已用时\s*(\d+)\s*s/i);
          const pct = t.match(/(\d+)\s*%/);
          const phaseRaw = t.split("·")[0]?.trim() || "";
          const phase = vbbFfmpegPhaseText(phaseRaw) || vbbStageText(phaseRaw);
          const stalled = /编码中|请稍候/.test(t);
          const parts = [];
          if (phase) parts.push(phase);
          else if (phaseRaw && !/^\d+%?$/.test(phaseRaw)) parts.push(vbbStageText(phaseRaw) || phaseRaw.slice(0, 12));
          if (pct) parts.push(`${pct[1]}%`);
          if (elapsed) parts.push(`${elapsed[1]}s`);
          if (stalled && (!pct || Number(pct[1]) < 99)) parts.push("编码中");
          if (parts.length) return parts.join(" · ");
        }
        return vbbStageText(t) || t;
      }
  
      function formatVbbProgressLine(main, sub, pct) {
        const m = vbbStageText(String(main || "").trim());
        const rawSub = String(sub || "").trim();
        const s = rawSub ? (/已用时|%\s*·|编码中|请稍候/.test(rawSub) ? vbbTickerLine(rawSub) : vbbStageText(rawSub) || rawSub) : "";
        const bits = [];
        if (m) bits.push(m);
        if (s && s !== m && !m.includes(s)) bits.push(s);
        const line = bits.join(" · ");
        return line || (pct != null ? `${pct}%` : "");
      }
  
      function vbbClipProgressLine(i, total, { reuse = false } = {}) {
        const bits = [`${i + 1}/${total}`];
        if (reuse) bits.push("沿用");
        return bits.join(" · ");
      }
  
      function setVbbProgress(visible, ratio, text, opts = {}) {
        if (!vbbProgress) return;
        const pin = Boolean(visible && vbbProgress.hidden);
        runVbbLayoutUpdate(() => {
          vbbProgress.hidden = !visible;
          if (!visible) {
            if (vbbProgressFill) {
              vbbProgressFill.style.width = "0%";
              vbbProgressFill.classList.remove("is-active", "is-busy");
            }
            if (vbbProgressPct) vbbProgressPct.hidden = true;
            if (vbbProgressSub) {
              vbbProgressSub.hidden = true;
              vbbProgressSub.classList.remove("is-empty");
            }
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
          const line = formatVbbProgressLine(text, opts.sub, pct);
          if (vbbProgressText) vbbProgressText.textContent = line;
          if (vbbProgressSub) {
            vbbProgressSub.hidden = true;
            vbbProgressSub.classList.remove("is-empty");
          }
        }, { pin });
      }
  
      function hideVbbMergedBlock() {
        if (vbbMergedUrl) {
          try {
            URL.revokeObjectURL(vbbMergedUrl);
          } catch (_) {}
        }
        vbbMergedUrl = "";
        if (vbbMergedPreview) {
          vbbMergedPreview.hidden = true;
          vbbMergedPreview.removeAttribute("src");
        }
        if (vbbMergedDl) {
          vbbMergedDl.hidden = true;
          vbbMergedDl.removeAttribute("href");
        }
        if (vbbMergedBlock) vbbMergedBlock.hidden = true;
        if (vbbMergedMeta) vbbMergedMeta.textContent = "";
      }
  
      function showVbbMergedBlock(blob, info = {}) {
        hideVbbMergedBlock();
        vbbMergedUrl = URL.createObjectURL(blob);
        if (vbbMergedPreview) {
          vbbMergedPreview.src = vbbMergedUrl;
          vbbMergedPreview.hidden = false;
        }
        if (vbbMergedDl) {
          vbbMergedDl.href = vbbMergedUrl;
          vbbMergedDl.download = info.downloadName || "blackbox-merged.gif";
          vbbMergedDl.hidden = false;
        }
        if (vbbMergedBlock) vbbMergedBlock.hidden = false;
        if (vbbMergedMeta) {
          const bits = [formatKb(blob.size)];
          if (info.beforeSize && info.beforeSize > blob.size) {
            bits.push(`${formatKb(info.beforeSize)} → ${formatKb(blob.size)}`);
          }
          if (info.compressRounds > 0) bits.push(`已压 ${info.compressRounds} 轮`);
          bits.push(blob.size <= V2G_BLACKBOX_MAX_BYTES ? "≤6MB" : "仍超 6MB");
          vbbMergedMeta.textContent = bits.join(" · ");
        }
        if (vbbResultBlock) vbbResultBlock.hidden = false;
      }
  
      function setVbbClipJob(idx, patch = {}) {
        const c = vbbClips[idx];
        if (!c) return;
        if (patch.status != null) c.jobStatus = patch.status;
        if (patch.progress != null) c.jobProgress = Math.max(0, Math.min(1, Number(patch.progress) || 0));
        if (patch.text != null) {
          const polished = vbbStageText(String(patch.text || ""));
          c.jobText = polished || String(patch.text || "");
        }
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
  
      /** GIF 实际播放时长（秒）：优先按帧数/帧率，否则用编码 span */
      function vbbEncodedGifDurationSec(encoded) {
        if (!encoded) return 0;
        const fps = Math.max(1, Number(encoded.fps) || 15);
        const frames = Number(encoded.frameCount) || 0;
        if (frames > 1) return (frames - 1) / fps;
        const span = Number(encoded.span);
        return span > 0 ? span : 0;
      }
  
      function attachVbbEncodedMeta(clip, encoded) {
        if (!clip || !encoded) return;
        clip.gifOutW = Number(encoded.outW) || 0;
        clip.gifOutH = Number(encoded.outH) || 0;
        clip.gifFps = Number(encoded.fps) || 0;
        clip.gifDuration = vbbEncodedGifDurationSec(encoded);
      }
  
      function simplifyVbbGifNote(note, { mobile = false } = {}) {
        const raw = String(note || "").trim();
        if (!raw || !mobile) return raw;
        const out = [];
        for (const part of raw.split(" · ").filter(Boolean)) {
          if (/^沿用/.test(part)) {
            out.push("沿用");
            continue;
          }
          if (/超限/.test(part)) {
            out.push("超限");
            continue;
          }
          const fps = part.match(/^(\d+)FPS$/);
          if (fps) {
            out.push(`${fps[1]}FPS`);
            continue;
          }
          const dim = part.match(/^(\d+)×\d+$/);
          if (dim) {
            out.push(`${dim[1]}宽`);
            continue;
          }
          if (/^宽≤/.test(part) || /^已压 /.test(part)) continue;
          if (/^已降宽/.test(part)) {
            out.push(part.replace("已降宽", "降宽"));
            continue;
          }
          if (out.length < 2) out.push(part);
        }
        return out.slice(0, 3).join(" · ");
      }
  
      function formatVbbClipTitle(c, idx) {
        if (c.sourceFile) return c.sourceFile;
        if (c.sourceName) return c.sourceName;
        const n = `#${String(idx + 1).padStart(2, "0")}`;
        if (!(Number(c.start) > 0) && vbbWorkflow === "single" && !isVbbBatchMode()) {
          return vbbSourceFile?.name || "整段 GIF";
        }
        return `${n}  ${formatVbbClock(c.start)}–${formatVbbClock(c.start + c.span)}`;
      }
  
      function formatVbbClipMeta(c, { mobile = false } = {}) {
        if (c.error && !c.gifBlob) return c.error;
        if (!c.gifBlob) {
          if (c.jobStatus === "running" || c.jobStatus === "pending") return c.jobText || "";
          return c.error || "";
        }
        const bits = [];
        const videoSec = Number(c.span) || 0;
        if (videoSec > 0) bits.push(`时长 ${formatVsplitSpanSec(videoSec)}`);
        const w = Number(c.gifOutW) || 0;
        const h = Number(c.gifOutH) || 0;
        if (w && h) bits.push(`GIF ${w}×${h}`);
        bits.push(formatKb(c.gifBlob.size));
        const extra = simplifyVbbGifNote(c.gifNote, { mobile });
        if (extra) {
          extra.split(" · ").forEach((part) => {
            if (!part) return;
            if (/^\d+×\d+$/.test(part) || /^GIF \d+×\d+$/.test(part)) return;
            if (/^\d+\s*FPS$/i.test(part)) {
              if (!mobile) bits.push(part.replace(/\s+/g, ""));
              return;
            }
            if (/^沿用|^超限|^已压|^降宽|^已抽稀|^宽≤/.test(part) || (mobile && /^\d+宽$/.test(part))) {
              bits.push(part);
            }
          });
        }
        if (c.error) bits.push(c.error);
        return bits.join(" · ");
      }
  
      function applyVbbClipEncoded(clip, encoded, extraBits = []) {
        if (!clip || !encoded?.blob) return;
        clip.gifBlob = encoded.blob;
        clip.gifUrl = "";
        attachVbbEncodedMeta(clip, encoded);
        const bits = [];
        extraBits.forEach((b) => {
          if (b) bits.push(b);
        });
        if (encoded.fps) bits.push(`${encoded.fps} FPS`);
        if (encoded.outW && encoded.outH) bits.push(`${encoded.outW}×${encoded.outH}`);
        if (encoded.compressRounds > 0) bits.push(`已压 ${encoded.compressRounds} 轮`);
        if (encoded.maxW) bits.push(`宽≤${encoded.maxW}`);
        if (encoded.framesCapped && encoded.frameCount) bits.push(`已抽稀 ${encoded.frameCount} 帧`);
        clip.gifNote = bits.filter(Boolean).join(" · ");
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
        hideVbbMergedBlock();
        if (vbbZip) vbbZip.disabled = true;
        if (vbbResultBlock) vbbResultBlock.hidden = true;
        if (vbbResultSummary) {
          vbbResultSummary.textContent = "";
          vbbResultSummary.hidden = true;
        }
      }
  
      function setVbbButtons() {
        const hasVideo = isVbbBatchMode()
          ? vbbBatchFiles.length > 0
          : Boolean(vbbVideo?.src && vbbSourceFile);
        const hasPlan = Boolean(vbbAnalysis?.active?.ranges?.length);
        const manualCount = completeVbbMarks().length;
        const gifCount = vbbClips.filter((c) => c.gifBlob).length;
        if (vbbOneclick) {
          const manualNeedMarks = isVbbManualMode() && manualCount < 1;
          vbbOneclick.hidden = isVbbSplitMode();
          vbbOneclick.disabled = !hasVideo || vbbBusy || manualNeedMarks || isVbbSplitMode();
          if (isVbbBatchMode()) {
            vbbOneclick.textContent = `一键黑盒（${vbbBatchFiles.length} 个）`;
          } else if (isVbbManualMode()) {
            vbbOneclick.textContent = manualCount > 0 ? `一键黑盒（${manualCount} 段）` : "一键黑盒";
          } else {
            vbbOneclick.textContent = "一键黑盒";
          }
        }
        if (vbbAnalyze) vbbAnalyze.disabled = !hasVideo || vbbBusy || isVbbBatchMode() || isVbbManualMode();
        if (vbbRun) {
          vbbRun.disabled = !hasPlan || vbbBusy || isVbbBatchMode() || isVbbManualMode();
          vbbRun.classList.toggle("is-ready", hasPlan && !vbbBusy && isVbbSplitMode());
        }
        if (vbbMerge) vbbMerge.disabled = gifCount < 2 || vbbBusy || isVbbBatchMode();
        if (vbbZip) vbbZip.disabled = gifCount < 1 || vbbBusy;
        if (isVbbManualMode()) paintVbbManualControls();
      }
  
      function syncVbbWorkflowUi() {
        const batch = isVbbBatchMode();
        const workflowRow = document.querySelector(".blackbox-workflow-row");
        if (workflowRow) workflowRow.hidden = batch;
        $("#vbb-workflow-single")?.classList.toggle("is-active", vbbWorkflow === "single");
        $("#vbb-workflow-split")?.classList.toggle("is-active", vbbWorkflow === "split");
        $("#vbb-workflow-manual")?.classList.toggle("is-active", vbbWorkflow === "manual");
        const showSplit = isVbbSplitMode();
        if (vbbSplitPanel) vbbSplitPanel.hidden = !showSplit;
        if (vbbWorkflowHint) {
          vbbWorkflowHint.textContent = batch
            ? "多选短片时将逐个转换，无需切换模式。"
            : VBB_WORKFLOW_HINTS[vbbWorkflow] || VBB_WORKFLOW_HINTS.single;
        }
        if (vbbAdvanced) vbbAdvanced.hidden = isVbbManualMode() || batch;
        paintVbbManualUi();
        setVbbButtons();
      }
  
      async function packDownloadVbbGifs({ auto = false } = {}) {
        const gifs = vbbClips.map((c, i) => ({ c, i })).filter((x) => x.c.gifBlob);
        if (!gifs.length) {
          if (!auto) toast("请先生成 GIF");
          return false;
        }
        const packed = await zipBlobs(
          gifs.map((x) => ({ name: vbbGifDownloadName(x.c, x.i), blob: x.c.gifBlob })),
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
          const ranges = [];
          for (let i = 0; i < n; i++) {
            const start = (i * d) / n;
            const end = ((i + 1) * d) / n;
            ranges.push({ start, span: end - start });
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
        if (!ranges?.length) return Math.max(VBB_MIN_SPAN, Number(fallback) || VBB_MIN_SPAN);
        const avg = ranges.reduce((sum, r) => sum + r.span, 0) / ranges.length;
        const first = ranges[0].span;
        if (ranges.every((r) => Math.abs(r.span - first) < 0.08)) return avg;
        return first;
      }
  
      function formatVbbRangesSpanTip(ranges, equalize = false) {
        if (!ranges?.length) return "";
        const avg = ranges.reduce((sum, r) => sum + r.span, 0) / ranges.length;
        const first = ranges[0].span;
        const last = ranges[ranges.length - 1].span;
        if (equalize || ranges.length === 1 || ranges.every((r) => Math.abs(r.span - first) < 0.08)) {
          return `每段 ${avg.toFixed(1)}s`;
        }
        if (Math.abs(last - first) < 0.08) {
          return `每段 ${first.toFixed(1)}s`;
        }
        return `前${ranges.length - 1}段 ${first.toFixed(1)}s · 末段 ${last.toFixed(1)}s`;
      }
  
      function syncVbbEqualizeUi(active) {
        const equalize = isVbbEqualize();
        if (vbbTargetLabel) {
          vbbTargetLabel.textContent = equalize ? "每段时长（秒）" : "目标段时长（秒）";
        }
        if (vbbEqualizeHint) {
          vbbEqualizeHint.textContent = equalize
            ? "各段等长；滑块数值与下方预估一致"
            : "默认关：前面按目标时长切，末段吃剩余";
        }
        if (!vbbTargetSpan || !vbbTargetRange) return;
        if (equalize && active?.ranges?.length) {
          const span = Number(active.typicalSpan ?? typicalVbbSpan(active.ranges, active.maxSpan));
          if (!(span > 0)) return;
          const shown = Number(span.toFixed(1));
          vbbTargetSpan.value = String(shown);
          vbbTargetRange.value = String(shown);
          return;
        }
        const shown = Number((vbbSegmentTarget || Number(vbbTargetSpan.value) || VBB_MIN_SPAN).toFixed(1));
        vbbTargetSpan.value = String(shown);
        vbbTargetRange.value = String(shown);
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
        let target = Number(vbbSegmentTarget || vbbTargetSpan?.value);
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
        const planWasHidden = Boolean(vbbPlan?.hidden);
        const willShowPlan = Boolean(vbbAnalysis);
        const pin = planWasHidden && willShowPlan;
        runVbbLayoutUpdate(() => {
          if (!vbbAnalysis) {
            if (vbbPlan) vbbPlan.hidden = true;
            setVbbButtons();
            return;
          }
          const active = resolveActiveVbbPlan();
          vbbAnalysis.active = active;
          if (vbbPlan) vbbPlan.hidden = false;
          if (vbbAdvanced) vbbAdvanced.open = true;
          syncVbbModeUi();
  
          if (vbbPlanSummary && active) {
            const widthTip = active.maxW ? ` · 目标宽 ${active.maxW}` : "";
            const fpsTip = ` · ${formatVbbFpsTip(active.estFps || 15, active.estCompressRounds || 0)}`;
            const warn = active.unsafe ? " ⚠ 可能超预算，执行时超限会降宽或改走黑盒。" : "";
            vbbPlanSummary.textContent = `将生成 ${active.count} 个切片 · ${formatVbbRangesSpanTip(active.ranges, isVbbEqualize())}${widthTip}${fpsTip} · 预估约 ${formatKb(active.estBytes)}/段 · ${active.note}（体积为估算；各段预览在生成后显示）${warn}`;
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
              vbbSegmentTarget = cur;
              vbbTargetSpan.value = String(Number(cur.toFixed(1)));
            }
            vbbTargetRange.value = String(Number(cur.toFixed(1)));
            vbbTargetSpan.min = vbbTargetRange.min;
            vbbTargetSpan.max = vbbTargetRange.max;
          }
  
          syncVbbEqualizeUi(active);
  
          setVbbButtons();
        }, { pin });
      }
  
      function syncVbbResultSummary() {
        const gifCount = vbbClips.filter((c) => c.gifBlob).length;
        const failCount = vbbClips.filter((c) => c.error && !c.gifBlob).length;
        if (vbbResultBlock) vbbResultBlock.hidden = vbbClips.length === 0;
        if (vbbResultSummary && vbbClips.length) {
          const totalBytes = vbbClips.reduce((sum, c) => sum + (c.gifBlob?.size || 0), 0);
          const bits = [`${vbbClips.length} 段`];
          if (gifCount) bits.push(`${gifCount} 个 GIF · ${formatKb(totalBytes)}`);
          if (failCount) bits.push(`${failCount} 段失败`);
          vbbResultSummary.textContent = bits.join(" · ");
          vbbResultSummary.hidden = bits.length === 0;
        } else if (vbbResultSummary) {
          vbbResultSummary.hidden = true;
        }
      }
  
      function buildVbbClipPreviewWrap(c, idx) {
        if (!c.gifBlob || vbbPreviewIdx !== idx) return null;
        if (!c.gifUrl) c.gifUrl = URL.createObjectURL(c.gifBlob);
        const wrap = document.createElement("div");
        wrap.className = "vbb-clip-preview-wrap";
        const img = document.createElement("img");
        img.className = "vsplit-clip-gif";
        img.alt = `片段 ${idx + 1}`;
        img.loading = "lazy";
        img.decoding = "async";
        img.src = c.gifUrl;
        wrap.appendChild(img);
        return wrap;
      }
  
      function buildVbbClipActions(c, idx) {
        const actions = document.createElement("div");
        actions.className = "btn-row";
        if (!c.gifBlob) return actions;
        const dlBtn = document.createElement("button");
        dlBtn.type = "button";
        dlBtn.className = "secondary-btn";
        dlBtn.textContent = "下载 GIF";
        dlBtn.addEventListener("click", () => {
          if (!c.gifBlob) return;
          triggerLocalDownload(c.gifBlob, vbbGifDownloadName(c, idx));
        });
        actions.appendChild(dlBtn);
        const previewBtn = document.createElement("button");
        previewBtn.type = "button";
        previewBtn.className = "ghost-btn vbb-preview-btn";
        previewBtn.textContent = vbbPreviewIdx === idx ? "收起预览" : "预览";
        previewBtn.addEventListener("click", () => toggleVbbClipPreview(idx));
        actions.appendChild(previewBtn);
        return actions;
      }
  
      function buildVbbClipRow(c, idx) {
        const row = document.createElement("div");
        row.className = "gif-frame vsplit-clip";
        row.dataset.vbbClip = String(idx);
        const top = document.createElement("div");
        top.className = "vsplit-clip-top";
        const head = document.createElement("div");
        head.className = "vbb-clip-head";
        const title = document.createElement("strong");
        title.className = "vbb-clip-title";
        title.textContent = formatVbbClipTitle(c, idx);
        head.appendChild(title);
        const metaText = formatVbbClipMeta(c, { mobile: isLikelyMobileBrowser() });
        if (metaText) {
          const meta = document.createElement("span");
          meta.className = "hint tight vbb-clip-meta";
          meta.textContent = metaText;
          head.appendChild(meta);
        }
        top.append(head, buildVbbClipActions(c, idx));
        row.appendChild(top);
        const progressBox = buildClipProgressDom();
        row.appendChild(progressBox);
        syncClipProgressDom(progressBox, c);
        const preview = buildVbbClipPreviewWrap(c, idx);
        if (preview) row.appendChild(preview);
        return row;
      }
  
      function toggleVbbClipPreview(idx) {
        const next = vbbPreviewIdx === idx ? -1 : idx;
        const prev = vbbPreviewIdx;
        vbbPreviewIdx = next;
        if (prev >= 0 && prev !== next) {
          vbbList?.querySelector(`[data-vbb-clip="${prev}"]`)?.querySelector(".vbb-clip-preview-wrap")?.remove();
          const prevBtn = vbbList?.querySelector(`[data-vbb-clip="${prev}"] .vbb-preview-btn`);
          if (prevBtn) prevBtn.textContent = "预览";
        }
        if (next < 0) return;
        const c = vbbClips[next];
        const row = vbbList?.querySelector(`[data-vbb-clip="${next}"]`);
        if (!row || !c?.gifBlob) return;
        row.querySelector(".vbb-clip-preview-wrap")?.remove();
        const preview = buildVbbClipPreviewWrap(c, next);
        if (preview) row.appendChild(preview);
        const btn = row.querySelector(".vbb-preview-btn");
        if (btn) btn.textContent = "收起预览";
      }
  
      function refreshVbbClipRow(idx) {
        const c = vbbClips[idx];
        const row = vbbList?.querySelector(`[data-vbb-clip="${idx}"]`);
        if (!c || !row) return;
        const title = row.querySelector(".vbb-clip-title");
        if (title) title.textContent = formatVbbClipTitle(c, idx);
        const head = row.querySelector(".vbb-clip-head");
        const metaText = formatVbbClipMeta(c, { mobile: isLikelyMobileBrowser() });
        let meta = row.querySelector(".vbb-clip-meta");
        if (metaText) {
          if (!meta && head) {
            meta = document.createElement("span");
            meta.className = "hint tight vbb-clip-meta";
            head.appendChild(meta);
          }
          if (meta) meta.textContent = metaText;
        } else if (meta) {
          meta.remove();
        }
        const top = row.querySelector(".vsplit-clip-top");
        const oldActions = row.querySelector(".vsplit-clip-top .btn-row");
        const nextActions = buildVbbClipActions(c, idx);
        if (oldActions) oldActions.replaceWith(nextActions);
        else if (top) top.appendChild(nextActions);
        syncClipProgressDom(row.querySelector(".vsplit-clip-progress"), c);
        syncVbbResultSummary();
        setVbbButtons();
      }
  
      function renderVbbResults() {
        if (!vbbList) return;
        const prevCount = vbbList.childElementCount;
        const blockWasHidden = Boolean(vbbResultBlock?.hidden);
        const pin = blockWasHidden || prevCount !== vbbClips.length;
        runVbbLayoutUpdate(() => {
          vbbList.innerHTML = "";
          syncVbbResultSummary();
          vbbClips.forEach((c, idx) => {
            vbbList.appendChild(buildVbbClipRow(c, idx));
          });
          setVbbButtons();
        }, { pin });
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
        vbbBatchFiles = [];
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
        if (vbbPlanList) vbbPlanList.innerHTML = "";
        clearVbbMarks();
        clearTimeout(vbbSeekTimer);
        vbbSeekTimer = 0;
        vbbPendingSeek = null;
        setVbbProgress(false, 0, "");
        setError(vbbError, "");
        if (vbbMeta) vbbMeta.textContent = VBB_DEFAULT_META;
        renderVbbBatchList();
        resetVbbAbort();
        syncVbbWorkflowUi();
        setVbbButtons();
      }
  
      async function loadVbbFiles(fileList) {
        const files = [...(fileList || [])].filter(isLikelyVideoFile);
        if (!files.length) {
          setError(vbbError, "未识别为视频文件，请选择 MP4 / WebM / MOV 等格式");
          toast("未识别为视频文件");
          return;
        }
        if (files.length === 1) {
          await loadVbbFile(files[0]);
          return;
        }
        clearVbb();
        vbbWorkflow = "single";
        syncVbbWorkflowUi();
        setError(vbbError, "");
        toast(`已选择 ${files.length} 个视频，仅本机处理，不会上传`);
        const probed = [];
        for (const file of files) {
          probed.push(await probeVbbVideoFile(file));
        }
        vbbBatchFiles = probed;
        renderVbbBatchList();
        syncVbbBatchMeta();
        setVbbButtons();
        toast("全部视频已就绪，点「一键黑盒」开始批量转换");
      }
  
      async function loadVbbFile(file) {
        if (!file) return;
        clearVbb();
        vbbBatchFiles = [];
        renderVbbBatchList();
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
        if (isVbbManualMode() && duration >= VBB_LONG_VIDEO_SEC) {
          toast("长视频手动打点：拖动时自动暂停，建议少播放；也可先在「视频切分」打点");
        }
        syncVbbScrubFromVideo();
        syncVbbWorkflowUi();
        setVbbButtons();
        toast("视频已就绪，点「一键黑盒」即可");
      }
  
      async function runVbbManualBlackbox() {
        if (!vbbSourceFile || !vbbVideo?.src || vbbBusy) return;
        const ranges = computeVbbManualRanges();
        const srcW = vbbVideo.videoWidth || 0;
        const srcH = vbbVideo.videoHeight || 0;
        abortVbb = false;
        vbbBusy = true;
        setVbbButtons();
        if (vbbAbort) vbbAbort.hidden = false;
        setError(vbbError, "");
        clearVbbResults();
        vbbClips = ranges.map((r) => ({
          start: r.start,
          span: r.span,
          gifBlob: null,
          gifUrl: "",
          gifNote: "",
          gifDuration: 0,
          error: "",
          jobStatus: "pending",
          jobProgress: 0,
          jobText: "等待中…",
        }));
        renderVbbResults();
        try {
          await prewarmFfmpegEngine().catch(() => {});
          const fileBytes = vbbSourceFile?.size || 0;
          const hugeFile = fileBytes >= 120 * 1024 * 1024;
          const mobile = isLikelyMobileBrowser();
          if (mobile && (hugeFile || ranges.some((r) => r.span >= 90))) {
            toast("长片段在手机上易内存不足，建议每段控制在 30s 内或用电脑");
          }
          if (hugeFile || ranges.length >= 4) {
            try {
              const ff = await getFfmpegInstance();
              await ensureFfmpegInputWritten(ff, vbbSourceFile, () => {});
            } catch (_) {}
          }
          for (let i = 0; i < ranges.length; i++) {
            if (abortVbb) throw new Error("已取消");
            const r = ranges[i];
            const reuse = resolveVbbSegmentReuse(ranges, i, null, "blackbox");
            const followTip = reuse.fromCache ? " · 沿用方案" : "";
            setVbbClipJob(i, { status: "running", progress: 0.02, text: "准备编码…" });
            setVbbProgress(true, i / ranges.length, vbbClipProgressLine(i, ranges.length, { reuse: Boolean(reuse.fromCache) }), {
              sub: `${formatVbbClock(r.start)}–${formatVbbClock(r.start + r.span)}`,
              busy: true,
            });
            const encoded = await encodeBlackboxClip({
              file: vbbSourceFile,
              startSec: r.start,
              span: r.span,
              srcW,
              srcH,
              isAborted: () => abortVbb,
              seed: reuse.seed || undefined,
              onProgress: (local, text) => {
                const p = (i + Math.min(0.98, local)) / ranges.length;
                const stage = bumpVbbEncodeProgress(p, vbbClipProgressLine(i, ranges.length, { reuse: Boolean(reuse.fromCache) }), text);
                setVbbClipJob(i, { status: "running", progress: Math.min(0.98, local), text: stage });
              },
            });
            if (abortVbb) throw new Error("已取消");
            vbbClips[i].gifBlob = encoded.blob;
            vbbClips[i].gifUrl = "";
            applyVbbClipEncoded(vbbClips[i], encoded, reuse.fromCache ? ["沿用方案"] : []);
            if (!vbbClips[i].error) saveVbbSpanScheme(r.span, snapshotVbbEncodeSeed(encoded, {}), "blackbox");
            setVbbClipJob(i, { status: "done", progress: 1, text: "完成" });
            refreshVbbClipRow(i);
            if (mobile && i < ranges.length - 1) {
              await new Promise((r) => setTimeout(r, hugeFile ? 180 : 80));
            }
          }
          setVbbProgress(true, 1, `完成 · ${ranges.length} 段`);
          toast(`已完成 ${ranges.length} 段 · 可逐条下载或打包`);
        } catch (err) {
          if (String(err?.message) !== "已取消") setError(vbbError, err.message || String(err));
          else toast("已取消");
          setVbbProgress(false, 0, "");
        } finally {
          vbbBusy = false;
          resetVbbAbort();
          if (vbbAbort) vbbAbort.hidden = true;
          setVbbButtons();
        }
      }
  
      async function runVbbBatchBlackbox() {
        if (!isVbbBatchMode() || vbbBusy) return;
        abortVbb = false;
        vbbBusy = true;
        setVbbButtons();
        if (vbbAbort) vbbAbort.hidden = false;
        setError(vbbError, "");
        clearVbbResults();
        const total = vbbBatchFiles.length;
        vbbClips = vbbBatchFiles.map((item) => ({
          start: 0,
          span: item.duration,
          sourceName: vbbGifBaseName(item.file),
          sourceFile: item.file.name || "video",
          gifBlob: null,
          gifUrl: "",
          gifNote: "",
          gifDuration: 0,
          error: "",
          jobStatus: "pending",
          jobProgress: 0,
          jobText: "等待中…",
        }));
        renderVbbResults();
        let ok = 0;
        try {
          await prewarmFfmpegEngine().catch(() => {});
          for (let i = 0; i < total; i++) {
            if (abortVbb) throw new Error("已取消");
            const item = vbbBatchFiles[i];
            setVbbClipJob(i, { status: "running", progress: 0.02, text: "准备编码…" });
            const base = i / total;
            setVbbProgress(true, base + 0.02, `批量转换 · ${i + 1}/${total}`, {
              sub: item.file.name,
              busy: true,
            });
            try {
              const encoded = await encodeBlackboxClip({
                file: item.file,
                startSec: 0,
                span: item.duration,
                srcW: item.srcW,
                srcH: item.srcH,
                isAborted: () => abortVbb,
                onProgress: (local, text) => {
                  const p = base + Math.min(0.96, 0.04 + local * 0.92);
                  const stage = bumpVbbEncodeProgress(p, `批量转换 · ${i + 1}/${total}`, text);
                  setVbbClipJob(i, {
                    status: "running",
                    progress: Math.min(0.98, 0.05 + Math.min(0.9, local) * 0.9),
                    text: stage,
                  });
                },
              });
              if (abortVbb) throw new Error("已取消");
              applyVbbClipEncoded(vbbClips[i], encoded);
              setVbbClipJob(i, { status: "done", progress: 1, text: "完成" });
              ok += 1;
              refreshVbbClipRow(i);
            } catch (err) {
              if (String(err?.message) === "已取消") throw err;
              vbbClips[i].error = err.message || String(err);
              setVbbClipJob(i, { status: "error", progress: 0, text: "失败" });
              refreshVbbClipRow(i);
            }
          }
          if (abortVbb) throw new Error("已取消");
          renderVbbResults();
          setVbbProgress(true, 1, `批量完成 · ${ok}/${total}`);
          if (ok > 0) {
            toast(
              ok === total
                ? `批量完成 · ${ok} 个 · 可在下方逐条下载或点「打包下载」`
                : `批量完成 · 成功 ${ok}/${total} · 可在下方逐条下载或点「打包下载」`
            );
          } else {
            throw new Error("全部转换失败，请查看各条错误信息");
          }
        } catch (err) {
          if (String(err?.message) !== "已取消") setError(vbbError, err.message || String(err));
          else toast("已取消");
          setVbbProgress(false, 0, "");
        } finally {
          vbbBusy = false;
          resetVbbAbort();
          if (vbbAbort) vbbAbort.hidden = true;
          setVbbButtons();
        }
      }
  
      async function runVbbSingleBlackbox() {
        if (!vbbSourceFile || !vbbVideo?.src || vbbBusy) return;
        const duration = Number(vbbVideo.duration) || 0;
        if (!(duration >= VBB_MIN_SPAN)) throw new Error(`视频太短，至少约 ${VBB_MIN_SPAN} 秒`);
        const srcW = vbbVideo.videoWidth || 0;
        const srcH = vbbVideo.videoHeight || 0;
        abortVbb = false;
        vbbBusy = true;
        setVbbButtons();
        if (vbbAbort) vbbAbort.hidden = false;
        setError(vbbError, "");
        clearVbbResults();
        vbbClips = [
          {
            start: 0,
            span: duration,
            sourceName: vbbGifBaseName(vbbSourceFile),
            gifBlob: null,
            gifUrl: "",
            gifNote: "",
            gifDuration: 0,
            error: "",
            jobStatus: "pending",
            jobProgress: 0,
            jobText: "等待中…",
          },
        ];
        renderVbbResults();
        const durationLabel = `${duration.toFixed(1)}s`;
        try {
          await prewarmFfmpegEngine().catch(() => {});
          bumpVbbEncodeProgress(0.03, "整段转换", "准备编码器…");
          setVbbClipJob(0, { status: "running", progress: 0.02, text: "准备编码…" });
          const encoded = await encodeBlackboxClip({
            file: vbbSourceFile,
            startSec: 0,
            span: duration,
            srcW,
            srcH,
            isAborted: () => abortVbb,
            onProgress: (local, text) => {
              const p = Math.min(0.98, 0.05 + Math.min(0.93, local) * 0.93);
              const stage = bumpVbbEncodeProgress(p, "整段转换", text);
              setVbbClipJob(0, {
                status: "running",
                progress: Math.min(0.98, 0.08 + Math.min(0.9, local) * 0.9),
                text: stage,
              });
            },
          });
          if (abortVbb) throw new Error("已取消");
          applyVbbClipEncoded(vbbClips[0], encoded);
          setVbbClipJob(0, { status: "done", progress: 1, text: "完成" });
          refreshVbbClipRow(0);
          const doneBits = [
            formatKb(encoded.blob.size),
            encoded.fps ? `${encoded.fps} FPS` : "",
            encoded.outW && encoded.outH ? `${encoded.outW}×${encoded.outH}` : "",
          ].filter(Boolean);
          setVbbProgress(true, 1, `完成 · ${doneBits.join(" · ")}`, { sub: `时长 ${durationLabel}` });
          toast(`已完成 · ${formatKb(encoded.blob.size)} · 可点下方「下载 GIF」`);
        } catch (err) {
          if (String(err?.message) !== "已取消") setError(vbbError, err.message || String(err));
          else toast("已取消");
          setVbbProgress(false, 0, "");
        } finally {
          vbbBusy = false;
          resetVbbAbort();
          if (vbbAbort) vbbAbort.hidden = true;
          setVbbButtons();
        }
      }
  
      async function runVbbOneClick() {
        if (vbbBusy) return;
        if (isVbbBatchMode()) {
          await runVbbBatchBlackbox().catch((err) => setError(vbbError, err.message || String(err)));
          return;
        }
        if (!vbbSourceFile) return;
        if (isVbbSplitMode()) {
          toast("长视频切片请先「分析切分方案」，确认后再「按方案生成 GIF」");
          return;
        }
        if (vbbWorkflow === "single") {
          await runVbbSingleBlackbox().catch((err) => setError(vbbError, err.message || String(err)));
          return;
        }
        if (vbbWorkflow === "manual") {
          await runVbbManualBlackbox().catch((err) => setError(vbbError, err.message || String(err)));
        }
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
          setVbbProgress(true, 0.08, "分析样片", {
            sub: `${sampleSpan.toFixed(1)}s`,
            busy: true,
          });
          if (vbbMeta) vbbMeta.textContent = `分析中 · 样片 ${sampleSpan.toFixed(1)}s…`;
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
            onProgress: (local, text) => {
              const pct = 0.08 + Math.min(0.82, local * 0.82);
              setVbbProgress(true, pct, "分析样片", {
                sub: vbbTickerLine(text) || `${sampleSpan.toFixed(1)}s`,
                busy: true,
              });
              if (vbbMeta) vbbMeta.textContent = `分析中 · ${vbbTickerLine(text) || "样片"}`;
            },
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
          vbbSegmentTarget = clarity.maxSpan;
          vbbMode = "duration";
          paintVbbPlan();
          setVbbProgress(
            true,
            1,
            `分析完成 · ${formatKb(sample.blob.size)} / ${vbbAnalysis.sampleSpan.toFixed(1)}s`
          );
          toast(`分析完成 · 默认 ${durationPlan.count} 段 · 可调整方案后点「② 按方案生成 GIF」`);
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
            gifDuration: 0,
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
            const reuse = resolveVbbSegmentReuse(plan.ranges, i, firstSeed, plan.encode);
            const reuseSeed = reuse.seed;
            const activeEncode = reuse.fromCache && reuse.encode ? reuse.encode : plan.encode;
            const isWide = activeEncode === "clarity" || activeEncode === "sharp";
            const encodeTag = activeEncode === "sharp" ? "锐度" : activeEncode === "clarity" ? "清晰" : "";
            const clipLine = (extra = {}) =>
              vbbClipProgressLine(i, plan.ranges.length, {
                reuse: Boolean(reuse.fromCache || (reuseSeed && i > 0)),
                ...extra,
              });
            const timeRange = `${formatVbbClock(r.start)}–${formatVbbClock(r.start + r.span)}`;
            const mainLine = () => (encodeTag ? `${clipLine()} · ${encodeTag}` : clipLine());
            const bumpProgress = (localP, sub = timeRange) =>
              setVbbProgress(true, (i + localP) / plan.ranges.length, mainLine(), { sub, busy: true });
            setVbbClipJob(i, { status: "running", progress: 0.02, text: encodeTag ? `${encodeTag}…` : "编码…" });
            setVbbProgress(true, i / plan.ranges.length, mainLine(), { sub: timeRange, busy: true });
            try {
              let encoded;
              let usedFallback = false;
              let usedWidth = reuseSeed && !reuseSeed.usedFallback
                ? reuseSeed.maxW
                : plan.maxW || V2G_BLACKBOX_BASE_W;
              if (isWide && !(reuseSeed && reuseSeed.usedFallback)) {
                const tryEncodeWide = async (maxW, localBase, localSpan) =>
                  encodeV2gGifFfmpeg({
                    file: vbbSourceFile,
                    fps: reuseSeed?.fps || 15,
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
                      const stage = vbbTickerLine(text) || `宽${maxW}`;
                      setVbbClipJob(i, { status: "running", progress: Math.min(0.98, p), text: stage });
                      bumpProgress(p, stage);
                    },
                  });
  
                encoded = await tryEncodeWide(usedWidth, 0, 0.55);
                if (!encoded?.blob) throw new Error("未产出 GIF");
                encoded = { ...encoded, compressRounds: encoded.compressRounds || 0, maxW: usedWidth };
                while (encoded?.blob?.size > V2G_BLACKBOX_MAX_BYTES && usedWidth > V2G_BLACKBOX_BASE_W) {
                  usedWidth = Math.max(V2G_BLACKBOX_BASE_W, usedWidth - V2G_BLACKBOX_WIDTH_STEP);
                  setVbbClipJob(i, { status: "running", progress: 0.55, text: `降宽 ${usedWidth}` });
                  bumpProgress(0.55, `降宽 ${usedWidth}`);
                  encoded = await tryEncodeWide(usedWidth, 0.55, 0.25);
                  encoded = { ...encoded, compressRounds: 0, maxW: usedWidth };
                }
                if (reuseSeed && encoded?.blob?.size < V2G_BLACKBOX_WIDEN_BYTES && encoded?.blob?.size <= V2G_BLACKBOX_MAX_BYTES) {
                  const hardMax = srcW > 0 ? Math.min(V2G_BLACKBOX_WIDTH_CAP, srcW) : V2G_BLACKBOX_WIDTH_CAP;
                  let nextW = usedWidth + V2G_BLACKBOX_WIDTH_STEP;
                  while (nextW <= hardMax) {
                    if (isAborted()) throw new Error("已取消");
                    const wider = await tryEncodeWide(nextW, 0.72, 0.15);
                    if (wider?.blob?.size > V2G_BLACKBOX_MAX_BYTES) break;
                    encoded = { ...wider, compressRounds: 0, maxW: nextW };
                    usedWidth = nextW;
                    if (encoded.outW > 0 && encoded.outW < nextW - 2) break;
                    nextW += V2G_BLACKBOX_WIDTH_STEP;
                  }
                }
                if (encoded?.blob?.size > V2G_BLACKBOX_MAX_BYTES) {
                  setVbbClipJob(i, { status: "running", progress: 0.8, text: "超限压缩…" });
                  bumpProgress(0.8, "超限压缩");
                  encoded = await encodeBlackboxClip({
                    file: vbbSourceFile,
                    startSec: r.start,
                    span: r.span,
                    srcW,
                    srcH,
                    isAborted,
                    seed: reuseSeed || null,
                    onProgress: (local, text) => {
                      const p = 0.8 + Math.min(0.18, local) * 0.18;
                      const stage = vbbTickerLine(text) || "压缩";
                      setVbbClipJob(i, { status: "running", progress: Math.min(0.98, p), text: stage });
                      bumpProgress(p, stage);
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
                  seed: reuseSeed || null,
                  onProgress: (local, text) => {
                    const p = Math.min(0.98, Number(local) || 0);
                    const stage = vbbTickerLine(text) || "编码…";
                    setVbbClipJob(i, { status: "running", progress: p, text: stage });
                    bumpProgress(p, stage);
                  },
                });
                if (reuseSeed?.usedFallback) usedFallback = true;
                if (encoded?.maxW) usedWidth = encoded.maxW;
              }
              if (!encoded?.blob) throw new Error("未产出 GIF");
              attachVbbEncodedMeta(clip, encoded);
              // 延迟创建 ObjectURL：列表默认不解码预览
              clip.gifUrl = "";
              const bits = [];
              if (reuse.fromCache) bits.push("沿用方案");
              else if (reuseSeed) bits.push("沿用#01");
              if (usedFallback) bits.push("超限");
              else if (isWide && usedWidth !== (plan.maxW || V2G_BLACKBOX_BASE_W)) bits.push(`已降宽${usedWidth}`);
              if (encoded.fps) bits.push(`${encoded.fps}FPS`);
              if (encoded.outW && encoded.outH) bits.push(`${encoded.outW}×${encoded.outH}`);
              if (encoded.compressRounds > 0) bits.push(`已压 ${encoded.compressRounds} 轮`);
              if (encoded.maxW) bits.push(`宽≤${encoded.maxW}`);
              else if (isWide && !usedFallback) bits.push(`宽≤${usedWidth}`);
              if (encoded.framesCapped) bits.push(`已抽稀 ${encoded.frameCount} 帧`);
              clip.gifBlob = encoded.blob;
              clip.gifNote = bits.join(" · ");
              if (encoded.blob.size > V2G_BLACKBOX_MAX_BYTES) {
                clip.error = `仍超 6MB（${formatKb(encoded.blob.size)}）`;
              }
              if (i === 0) firstSeed = snapshotVbbEncodeSeed(encoded, { usedWidth, usedFallback });
              if (!clip.error) {
                saveVbbSpanScheme(
                  r.span,
                  snapshotVbbEncodeSeed(encoded, { usedWidth, usedFallback }),
                  usedFallback ? "blackbox" : activeEncode
                );
              }
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
            refreshVbbClipRow(i);
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
        hideVbbMergedBlock();
        try {
          let blob = await mergeGifBlobs(blobs, (ratio, text) =>
            setVbbProgress(true, ratio * 0.55, "合并 GIF", { sub: text, busy: ratio < 1 })
          );
          const mergedBefore = blob.size;
          let compressRounds = 0;
          if (blob.size > V2G_BLACKBOX_MAX_BYTES) {
            setVbbProgress(true, 0.58, "超限压缩", { busy: true });
            const compressed = await compressExistingGifToBlackbox(blob, (ratio, text) =>
              setVbbProgress(true, 0.58 + ratio * 0.4, "压缩", { sub: vbbTickerLine(text), busy: ratio < 1 })
            );
            blob = compressed.blob;
            compressRounds = compressed.compressRounds || 0;
            if (!compressed.ok) {
              setError(
                vbbError,
                `合并后仍超 6MB（${formatKb(blob.size)}）· 已压 ${compressRounds} 轮，建议减少段数或缩短片段`
              );
            }
          }
          showVbbMergedBlock(blob, {
            beforeSize: mergedBefore,
            compressRounds,
            downloadName: "blackbox-merged.gif",
          });
          const okTip = blob.size <= V2G_BLACKBOX_MAX_BYTES ? "≤6MB" : "仍超 6MB";
          setVbbProgress(true, 1, `合并完成 · ${formatKb(blob.size)} · ${okTip}`);
          toast(blob.size <= V2G_BLACKBOX_MAX_BYTES ? "已合并为一条 GIF" : `已合并，但体积仍超 6MB（${formatKb(blob.size)}）`);
        } catch (err) {
          setVbbProgress(false, 0, "");
          setError(vbbError, err.message || String(err));
        } finally {
          vbbBusy = false;
          setVbbButtons();
        }
      }
  
      function bindVbbOnce(el, key, handler) {
        if (!el || el.dataset[key]) return;
        el.dataset[key] = "1";
        el.addEventListener("click", handler);
      }
  
      bindPanel("vbb", (root) => {
        root = root || document.getElementById("vbb");
        ensureVbbScrollGuard();
        vbbFile = $("#vbb-file", root);
        vbbVideo = $("#vbb-video", root);
        vbbMeta = $("#vbb-meta", root);
        vbbError = $("#vbb-error", root);
        vbbAnalyze = $("#vbb-analyze", root);
        vbbRun = $("#vbb-run", root);
        vbbOneclick = $("#vbb-oneclick", root);
        vbbAdvanced = $("#vbb-advanced", root);
        vbbSplitPanel = $("#vbb-split-panel", root);
        vbbWorkflowHint = $("#vbb-workflow-hint", root);
        vbbMerge = $("#vbb-merge", root);
        vbbAbort = $("#vbb-abort", root);
        vbbZip = $("#vbb-zip", root);
        vbbMergedDl = $("#vbb-merged-dl", root);
        vbbMergedPreview = $("#vbb-merged-preview", root);
        vbbMergedBlock = $("#vbb-merged-block", root);
        vbbMergedMeta = $("#vbb-merged-meta", root);
        vbbResultSummary = $("#vbb-result-summary", root);
        vbbProgress = $("#vbb-progress", root);
        vbbProgressFill = $("#vbb-progress-fill", root);
        vbbProgressText = $("#vbb-progress-text", root);
        vbbProgressSub = $("#vbb-progress-sub", root);
        vbbProgressPct = $("#vbb-progress-pct", root);
        vbbPlan = $("#vbb-plan", root);
        vbbPlanSummary = $("#vbb-plan-summary", root);
        vbbPlanList = $("#vbb-plan-list", root);
        vbbList = $("#vbb-list", root);
        vbbBatchList = $("#vbb-batch-list", root);
        vbbResultBlock = $("#vbb-result-block", root);
        vbbCustomRow = $("#vbb-custom-row", root);
        vbbTargetSpan = $("#vbb-target-span", root);
        vbbTargetRange = $("#vbb-target-range", root);
        vbbTargetLabel = $("#vbb-target-label", root);
        vbbEqualizeHint = $("#vbb-equalize-hint", root);
        vbbEqualize = $("#vbb-equalize", root);
        vbbManualPanel = $("#vbb-manual-panel", root);
        vbbScrub = $("#vbb-scrub", root);
        vbbPlay = $("#vbb-play", root);
        vbbManualNow = $("#vbb-manual-now", root);
        vbbManualCount = $("#vbb-manual-count", root);
        vbbManualDraft = $("#vbb-manual-draft", root);
        vbbMarkTap = $("#vbb-mark-tap", root);
        vbbMarkUndo = $("#vbb-mark-undo", root);
        vbbMarkClear = $("#vbb-mark-clear", root);
        vbbNudgeM1 = $("#vbb-nudge-m1", root);
        vbbNudgeM01 = $("#vbb-nudge-m01", root);
        vbbNudgeP01 = $("#vbb-nudge-p01", root);
        vbbNudgeP1 = $("#vbb-nudge-p1", root);
        vbbScrubMarks = $("#vbb-scrub-marks", root);
        vbbMarkChips = $("#vbb-mark-chips", root);
        vbbJumpTime = $("#vbb-jump-time", root);
        vbbJumpGo = $("#vbb-jump-go", root);
        vbbLongHint = $("#vbb-long-hint", root);
        const syncCustomTarget = (raw) => {
          if (!vbbAnalysis) return;
          const min = Number(vbbTargetRange?.min) || VBB_MIN_SPAN;
          const max = Number(vbbTargetRange?.max) || VBB_DURATION_MAX_SPAN;
          const val = Math.max(min, Math.min(max, Number(raw) || min));
          vbbSegmentTarget = val;
          if (vbbTargetSpan) vbbTargetSpan.value = String(Number(val.toFixed(1)));
          if (vbbTargetRange) vbbTargetRange.value = String(Number(val.toFixed(1)));
          if (vbbMode !== "custom") vbbMode = "custom";
          paintVbbPlan();
        };
        if (vbbFile && !vbbFile.dataset.vbbBound) {
          vbbFile.dataset.vbbBound = "1";
          vbbFile.addEventListener("click", () => {
            vbbFile.value = "";
          });
          vbbFile.addEventListener("change", (e) => {
            loadVbbFiles(e.target.files).catch((err) => {
              clearVbb();
              setError(vbbError, err.message || String(err));
            });
          });
        }
        $("#vbb-clear", root)?.addEventListener("click", clearVbb);
        vbbTargetSpan?.addEventListener("change", () => syncCustomTarget(vbbTargetSpan.value));
        vbbTargetSpan?.addEventListener("input", () => syncCustomTarget(vbbTargetSpan.value));
        vbbTargetRange?.addEventListener("input", () => syncCustomTarget(vbbTargetRange.value));
        vbbEqualize?.addEventListener("change", () => {
          rebuildVbbDerivedPlans();
          paintVbbPlan();
        });
        bindVbbOnce($("#vbb-mode-custom", root), "vbbModeBound", () => {
          vbbMode = "custom";
          paintVbbPlan();
        });
        const workflowRow = root.querySelector(".blackbox-workflow-row");
        if (workflowRow && !workflowRow.dataset.vbbWorkflowBound) {
          workflowRow.dataset.vbbWorkflowBound = "1";
          workflowRow.addEventListener("click", (e) => {
            const btn = e.target.closest("[data-vbb-workflow]");
            if (!btn || !workflowRow.contains(btn)) return;
            const next = String(btn.dataset.vbbWorkflow || "").trim();
            if (!next || next === vbbWorkflow) return;
            vbbWorkflow = next;
            if (next === "manual") pauseVbbPreview();
            syncVbbWorkflowUi();
            if (next === "manual") {
              const d = vbbVideoDuration();
              if (d >= VBB_LONG_VIDEO_SEC) {
                toast("长视频：拖动定位即可，播放会占用更多内存");
              }
            }
          });
        }
      window.DevToolsTemp?.registerCleanup(clearVbb);
      // 供预估准确性测试读取（不影响 UI）
      window.DevToolsVbb = {
        getBps15: () => vbbAnalysis?.bps15 ?? null,
        getSrcW: () => vbbAnalysis?.srcW ?? 0,
        getActivePlan: () => (vbbAnalysis ? resolveActiveVbbPlan() : null),
        getClips: () => vbbClips.slice(),
        formatClipTitle: (c, idx) => formatVbbClipTitle(c, idx),
        formatClipMeta: (c, opts) => formatVbbClipMeta(c, opts || {}),
        shouldReuseFirstPlan: (ranges, index) => shouldReuseVbbFirstPlan(ranges, index),
        loadSpanScheme: (span) => loadVbbSpanScheme(span),
        saveSpanScheme: (span, seed, enc) => saveVbbSpanScheme(span, seed, enc),
        spanSchemeKey: (span) => vbbSpanSchemeKey(span),
        estimateBlackbox: (span) => {
          if (!vbbAnalysis) return null;
          return estimateVbbBlackboxPlan(vbbAnalysis.bps15, span, vbbAnalysis.srcW);
        },
        isEqualize: () => isVbbEqualize(),
        getMode: () => vbbMode,
        setMode: (mode) => {
          if (!vbbAnalysis) return;
          vbbMode = String(mode || "duration");
          paintVbbPlan();
        },
        getWorkflow: () => vbbWorkflow,
        getMarks: () => vbbMarks.map((m) => ({ ...m })),
        getDraftStart: () => vbbDraftStart,
        computeManualRanges: () => computeVbbManualRanges(),
      };
      vbbAnalyze?.addEventListener("click", (e) => {
        const btn = e.currentTarget;
        runVbbAnalyze()
          .catch((err) => setError(vbbError, err.message || String(err)))
          .finally(() => blurVbbActionButton(btn));
      });
      vbbOneclick?.addEventListener("click", () => runVbbOneClick().catch((err) => setError(vbbError, err.message || String(err))));
      vbbRun?.addEventListener("click", (e) => {
        const btn = e.currentTarget;
        runVbbExecute()
          .catch((err) => setError(vbbError, err.message || String(err)))
          .finally(() => blurVbbActionButton(btn));
      });
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
      vbbJumpGo?.addEventListener("click", () => {
        const t = parseVbbJumpTime(vbbJumpTime?.value);
        if (t == null) {
          toast("时间格式无效，如 2:30 或 150");
          return;
        }
        seekVbbPreview(t);
      });
      vbbJumpTime?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") vbbJumpGo?.click();
      });
      vbbPlay?.addEventListener("click", () => {
        if (!vbbVideo?.src) return;
        if (vbbVideo.paused) {
          const d = vbbVideoDuration();
          if (d >= VBB_LONG_VIDEO_SEC) toast("长视频播放较耗内存，建议拖动定位");
          vbbVideo.play().catch(() => {});
        } else {
          pauseVbbPreview();
        }
      });
      vbbVideo?.addEventListener("play", () => {
        vbbPlaying = true;
        if (vbbPlay) vbbPlay.textContent = "暂停";
      });
      vbbVideo?.addEventListener("pause", () => {
        vbbPlaying = false;
        if (vbbPlay) vbbPlay.textContent = "播放";
      });
      vbbVideo?.addEventListener("timeupdate", () => {
        if (!isVbbManualMode() || vbbScrubbing) return;
        paintVbbNow();
      });
      vbbVideo?.addEventListener("seeked", () => {
        if (!isVbbManualMode()) return;
        paintVbbNow();
      });
      vbbScrub?.addEventListener("input", () => {
        if (!vbbVideo?.src) return;
        vbbScrubbing = true;
        pauseVbbPreview();
        const t = vbbScrubValueToTime(vbbScrub.value);
        paintVbbNow();
        scheduleVbbSeek(t, { fromScrub: true, keepPlaying: false });
      });
      vbbScrub?.addEventListener("change", () => {
        vbbScrubbing = false;
        flushVbbSeek();
        paintVbbManualControls();
      });
      vbbMarkTap?.addEventListener("click", tapVbbMark);
      vbbMarkUndo?.addEventListener("click", undoVbbMark);
      vbbMarkClear?.addEventListener("click", () => {
        clearVbbMarks();
        toast("已清空标记");
      });
      vbbNudgeM1?.addEventListener("click", () => nudgeVbbPreview(-1));
      vbbNudgeM01?.addEventListener("click", () => nudgeVbbPreview(-0.1));
      vbbNudgeP01?.addEventListener("click", () => nudgeVbbPreview(0.1));
      vbbNudgeP1?.addEventListener("click", () => nudgeVbbPreview(1));
      syncVbbWorkflowUi();
      syncVbbModeUi();
      setVbbButtons();
      flushPendingFileInput(vbbFile, (files) =>
        loadVbbFiles(files).catch((err) => {
          clearVbb();
          setError(vbbError, err.message || String(err));
        })
      );
  
      });  } catch (err) {
      console.error("video to gif init failed", err);
    }
})();
