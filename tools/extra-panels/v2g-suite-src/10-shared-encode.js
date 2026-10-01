
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
      const MAX_V2G_SECONDS = 600;
      // 黑盒体积上限：可配置并持久化（默认 10MB），全局通用
      let V2G_BLACKBOX_MAX_BYTES = (M.blackboxUseMaxBytes ? M.blackboxUseMaxBytes() : 10 * 1024 * 1024);
      /** 体积有余（约上限 5/6 ≈ 8.3MB）时尝试加宽，把预算用在清晰度上 */
      let V2G_BLACKBOX_WIDEN_BYTES = Math.round(V2G_BLACKBOX_MAX_BYTES * (5 / 6));
      window.addEventListener("devtools:blackbox-size", () => {
        V2G_BLACKBOX_MAX_BYTES = M.blackboxUseMaxBytes ? M.blackboxUseMaxBytes() : V2G_BLACKBOX_MAX_BYTES;
        V2G_BLACKBOX_WIDEN_BYTES = Math.round(V2G_BLACKBOX_MAX_BYTES * (5 / 6));
      });
      function blackboxBudgetLabel() {
        return `${Math.max(1, Math.round(V2G_BLACKBOX_MAX_BYTES / (1024 * 1024)))}MB`;
      }
      /**
       * 黑盒：起点 420 宽 · q1 · 上限默认 10MB；整段处理（不为 ≈30s 自动切两段）。
       * 主档 20→15→12（10MB 下短片优先 20；≈20s 主 15 有余量冲 20；≈30s 主 12）。
       * SPAN 分档（有效时长 = span/speed）：
       *   ≤ HIGH_PRIMARY(16s)：主试 20 @ 420
       *   ≤ MID(24s)：主试 15 @ 420；余量先加宽再冲 20
       *   > MID：主试 12 @ 420；很松抬 15 再加宽
       * 「压缩时长」= 倍速缩短成片时长，帧延迟仍按目标 fps 均匀写，不是更顿的原因。
       * 小于规则：加宽 → 提帧；超过规则：缩宽 → 降质 → 降帧到 12。
       */
      const V2G_BLACKBOX_MAX_FPS = 20;
      const V2G_BLACKBOX_FPS_LIST = [20, 15, 12];
      /** ≤16s：主打 20fps（10MB 流畅优化） */
      const V2G_BLACKBOX_HIGH_PRIMARY_SPAN_SEC = 16;
      /** ≤24s：走 15 主档（≈20s）；更长走 12 主档（≈30s） */
      const V2G_BLACKBOX_SHORT_SPAN_SEC = 24;
      const V2G_BLACKBOX_MID_SPAN_SEC = 24;
      /** 产品：单段整段拉满；不因时长自动切片成多条 GIF */
      const V2G_BLACKBOX_OPT_MAX_SPAN_SEC = 36;
      /** 余量提帧 20fps：≈20s 档有预算也可冲（ffmpeg fps= 可处理 30→20） */
      const V2G_BLACKBOX_HIGH_FPS = 20;
      const V2G_BLACKBOX_HIGH_FPS_MAX_SPAN = 20;
      const V2G_BLACKBOX_HIGH_FPS_MIN_W = 420;
      const V2G_BLACKBOX_BASE_W = 420;
        /** 收窄/加宽步进：要细，否则 420 一步就掉到 380，白白少给 20–40px */
        const V2G_BLACKBOX_WIDTH_STEP = 20;
        /** 10MB 预算下加宽上限抬到 900，短片更清晰 */
        const V2G_BLACKBOX_WIDTH_CAP = 900;
        /** 黑盒编码的硬宽度上限（一键黑盒可放宽到这里，短视频预算用不完时可换更高清晰度） */
        const V2G_ENCODE_HARD_W = 1280;
        /** 智能分配的分辨率底线：某帧率若只能做到比这更窄，就换更低帧率 */
      const V2G_BLACKBOX_MIN_ACCEPT_W = 380;
      /** 实测超预算时「无损重编」的绝对下限（宽度 px / 帧率）：宁可到这两个底线，也不轻易用 gifsicle --lossy */
      const V2G_BLACKBOX_RETRY_MIN_W = 380;
      /** 帧率硬底线 12：超限靠缩宽/降质，不再掉到 10fps */
      const V2G_BLACKBOX_RETRY_MIN_FPS = 12;
      /** 帧率已到 12fps 底线但体积还超 → 优先降编码质量而不是继续降帧率。
       *  gifski：quality 档 18 → gifski 70（约省 20% 体积，观感损失远小于继续掉帧的卡顿）。 */
      const V2G_BLACKBOX_RETRY_QUALITY = 18;
      /** 源宽未知时的加宽兜底（等同不设上限） */
      const V2G_BLACKBOX_WIDTH_HARD_FALLBACK = 4096;
      // 质量档位：1 = 最高画质。gifski 路径 → gifQualityToGifskiQuality(1) = 92（近无损）；
      // ffmpeg 回退路径 → gifQualityToMaxColors(1) = 256 色（GIF 上限）。实测 234→256 仅 +1% 体积，几乎免费。
      const V2G_BLACKBOX_QUALITY = 1;
      /** 超预算时的质量让渡阶梯（gifski quality：92→83→73→66→55；ffmpeg 路径等价降色 256→…→96）。
       *  让渡顺序：先收窄宽度 → 再降质量 → 再降帧率 → 最后才动 gifsicle lossy。
       *  降 gifski quality 是「自适应量化」，比固定降到 32 色耐看得多。 */
      const V2G_BLACKBOX_QUALITY_LADDER = [1, 8, 15, 22, 30];
      /** 是否触屏（手机/平板）：分块 UI 显示仍以它为准；内存预算改走性能档 */
      function isCoarsePointer() {
        return typeof isCoarsePointerMedia === "function"
          ? isCoarsePointerMedia()
          : (() => {
              try { return window.matchMedia("(pointer: coarse)").matches; } catch (_) { return false; }
            })();
      }
      function currentMediaPerf() {
        return typeof mediaPerfProfile === "function"
          ? mediaPerfProfile()
          : {
              tier: isCoarsePointer() ? "eco" : "desktop",
              gifskiRawBudget: isCoarsePointer() ? 32 * 1024 * 1024 : 320 * 1024 * 1024,
              gifskiMaxFrames: isCoarsePointer() ? 240 : 1500,
              widenProbes: isCoarsePointer() ? 2 : 4,
              allowQualityBoost: !isCoarsePointer(),
              preferChunkByDefault: isCoarsePointer(),
              singlePassPeakBytes: isCoarsePointer() ? 0.2 * 1024 * 1024 * 1024 : 1.5 * 1024 * 1024 * 1024,
              manualFpsCap: isCoarsePointer() ? 15 : 30,
              manualWidthCap: isCoarsePointer() ? 720 : 1280,
              batchConcurrency: isCoarsePointer() ? 1 : 2,
              label: isCoarsePointer() ? "省电" : "桌面",
            };
      }
      function resolveBatchConcurrency(total) {
        const n = Math.max(1, Math.min(3, Math.floor(Number(currentMediaPerf().batchConcurrency) || 1)));
        return Math.max(1, Math.min(n, Math.max(1, Number(total) || 1)));
      }
      /** 单段 gifski 编码的原始 RGBA 内存预算（帧数×宽×高×4）。按性能档，不再「触屏=一律弱机」。 */
      function gifskiRawBudget() {
        return currentMediaPerf().gifskiRawBudget;
      }
      /** 单段 gifski 编码的帧数上限：拉满档约 600，可覆盖 ≤30s@15fps 单次编码。 */
      function gifskiMaxFrames() {
        return currentMediaPerf().gifskiMaxFrames;
      }
      /** 桌面/拉满：峰值估算超上限才自动分块；峰值 = 帧数据 ×3（JS + wasm + 工作区） */
      function gifskiSinglePassPeakBytes() {
        return currentMediaPerf().singlePassPeakBytes;
      }

      /** 分块设置（手机端）持久化：记住用户改过的块数 */
      const VBB_CHUNK_KEY = "devtools-vbb-chunk-v1";
      function readVbbChunkCfg() {
        try {
          const j = JSON.parse(localStorage.getItem(VBB_CHUNK_KEY) || "{}");
          const n = Math.floor(Number(j.count));
          return { on: j.on !== false, count: n >= 1 ? n : null };
        } catch (_) {
          return { on: true, count: null };
        }
      }
      function saveVbbChunkCfg(cfg) {
        try {
          localStorage.setItem(
            VBB_CHUNK_KEY,
            JSON.stringify({ on: cfg.on !== false, count: cfg.count >= 1 ? Math.floor(cfg.count) : null })
          );
        } catch (_) {}
      }
      /** 面板当前设置 → 传给编码器的 chunkCount；0 = 自动（桌面默认不分块，手机按内存预算分） */
      function readVbbChunkCount() {
        const el = document.getElementById("vbb-chunk-enable");
        if (!el) return 0; // 无该控件（桌面）→ 自动
        if (!el.checked) return 1; // 用户选择「不分块」
        const raw = String(document.getElementById("vbb-chunk-count")?.value ?? "").trim();
        const n = Math.floor(Number(raw));
        return n >= 1 ? Math.min(64, n) : 0; // 留空 = 自动
      }
      /** 按当前视频估算「建议块数」（= 手机自动分块的块数） */
      function vbbRecommendChunkCount() {
        const v = document.getElementById("vbb-video");
        const dur = Number(v && v.duration) || 0;
        if (!dur || !v.videoWidth) return null;
        const frames = Math.max(2, Math.floor(dur * 12) + 1);
        const w = Math.min(V2G_BLACKBOX_BASE_W, v.videoWidth);
        const h = Math.max(2, Math.round(w * (v.videoHeight / v.videoWidth)));
        const perFrame = Math.max(1, w * h * 4);
        const budgetFrames = Math.max(1, Math.floor(gifskiRawBudget() / perFrame));
        const chunkMax = Math.max(1, Math.min(gifskiMaxFrames(), budgetFrames));
        return Math.max(1, Math.ceil(frames / chunkMax));
      }
      const V2G_BLACKBOX_MAX_COMPRESS_ROUNDS = 10;
      /** 非最后一档：每轮轻lossy（对齐 -l），最多 3 轮不减色；多给高帧档机会再降 FPS */
      const V2G_BLACKBOX_SOFT_COMPRESS_ROUNDS = 3;
      const V2G_FFMPEG_WARN_BYTES = 40 * 1024 * 1024;
      /** 滑块默认上限；数字框可更高，滑块 max 会跟着扩展 */
      const V2G_BRIGHT_SLIDER_MAX = 200;
      /** 防误触软顶（%）；实际无业务硬限 */
      const V2G_BRIGHT_SOFT_MAX = 999;
      const V2G_DEFAULT_META =
        "支持 MP4 / WebM / MOV。选择后仅本机读取，不会上传。默认 20FPS / 宽480 / 最好质量。关闭页面会释放本次视频和 GIF；编码器缓存可在侧栏一键清理。";
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
          const shareOk = typeof preferShareToGallery === "function" && preferShareToGallery();
          if (shareOk) {
            v2gDownload.textContent =
              latestV2gFormat === "webp" ? "分享/保存 WebP" : "分享到相册";
            v2gDownload.title = "调起系统分享，可选存到相册或文件";
          } else {
            v2gDownload.textContent = latestV2gFormat === "webp" ? "下载 WebP" : "下载 GIF";
            v2gDownload.removeAttribute("title");
          }
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
        const fps = Math.min(30, Math.max(2, Number(opts.fps) || 8));
        const maxW = Math.min(1280, Math.max(64, Number(opts.maxW) || 360));
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
        let frameCount = naturalFrames;
        const framesCapped = false;
  
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
              const delay = Math.round(1000 / Math.min(30, Math.max(2, Number(opts.fps) || 8)));
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
      function normalizeV2gCrop(crop, srcW, srcH) {
        if (!crop || !(crop.w > 0) || !(crop.h > 0)) return null;
        const x = Math.max(0, Math.round(Number(crop.x) || 0));
        const y = Math.max(0, Math.round(Number(crop.y) || 0));
        let w = Math.round(Number(crop.w));
        let h = Math.round(Number(crop.h));
        if (srcW > 0) w = Math.min(w, srcW - x);
        if (srcH > 0) h = Math.min(h, srcH - y);
        w -= w % 2;
        h -= h % 2;
        if (w < 8 || h < 8) return null;
        return { x, y, w, h };
      }

      /**
       * 是否需要轻度降噪：只有「极大倍率下采样（≥4×）」时才开 hqdn3d。
       * 实测它不是无损的——会抹掉约 20% 的数据量（就是细节），对录屏/干净源纯粹是模糊。
       * 你的 1170→380 是 3.08×，属于「lanczos 已能抗混叠」的区间，所以默认不降噪、画面更清晰。
       * 若遇到噪点很重的实拍源，把 4 调回 3 即可。
       */
      const V2G_DENOISE_MIN_DOWNSCALE = 4;
      function needDenoise(srcEffW, outW) {
        const s = Number(srcEffW);
        const o = Number(outW);
        return s > 0 && o > 0 && s / o >= V2G_DENOISE_MIN_DOWNSCALE;
      }

      async function encodeV2gGifFfmpeg(opts) {
        const tPhase = performance.now();
        const file = opts.file || v2gSourceFile;
        if (!file) throw new Error("缺少原始视频文件，请重新选择视频");
        const fpsCap = opts.allowWide ? 30 : Math.max(15, Number(currentMediaPerf().manualFpsCap) || 15);
        const fps = Math.min(fpsCap, Math.max(2, Number(opts.fps) || 8));
        const hardCapW = opts.allowWide
          ? V2G_ENCODE_HARD_W
          : Math.max(720, Number(currentMediaPerf().manualWidthCap) || 720);
        const maxW = Math.min(hardCapW, Math.max(64, Number(opts.maxW) || 360));
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
        const speed = Math.max(1, Math.min(16, Number(opts.speed) || 1));
        const effSpan = span / speed;
        // 不设帧数上限：帧率按所选档位(15/12，短片可余量提 20)；体积由后续压缩(减色/缩放)兜底
        const naturalFrames = Math.max(2, Math.floor(effSpan * fps) + 1);
        const framesCapped = false;
        const frameCount = naturalFrames;
        const srcW = Number(opts.srcW) || v2gVideo?.videoWidth || 0;
        const srcH = Number(opts.srcH) || v2gVideo?.videoHeight || 0;
        const crop = normalizeV2gCrop(opts.crop, srcW, srcH);
        const cropFilter = crop ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},` : "";
        const effW = crop ? crop.w : srcW;
        const effH = crop ? crop.h : srcH;
        const scale = effW > maxW && effW > 0 ? maxW / effW : 1;
        const outW = effW ? Math.max(2, Math.round((effW * scale) / 2) * 2) : maxW;
        const outH = effH ? Math.max(2, Math.round((effH * scale) / 2) * 2) : Math.round(outW * 0.75);
        const stageLabel = (speed > 1 ? `加速${speed.toFixed(2)}× · ` : "") + (opts.stageLabel ? `${opts.stageLabel} · ` : "");
  
        const mapProgress = (local, text) => {
          if (typeof opts.onProgress === "function") opts.onProgress(local, text);
          else setV2gProgress(true, local, text);
        };
  
        if (aborted()) throw new Error("已取消");
        mapProgress(0.03, `${stageLabel}准备 FFmpeg 引擎…`);
        let ticker = null;
        const ffmpeg =
          opts.ffmpeg ||
          (await getFfmpegInstance((ratio, text) => {
            mapProgress(0.03 + Math.min(0.12, (ratio || 0) * 0.12), `${stageLabel}${text || "加载引擎…"}`);
          }));
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
            mapProgress(0.16, `${stageLabel}载入本地编码器（不上传）…`);
          });
          vbbLog(
            `[vbb-phase] 写入输入 ${Math.round(performance.now() - tPhase)}ms · ${(file.size / 1048576).toFixed(1)}MB`
          );
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
              vbbLog(`[vbb-phase] 抽片段 ${Math.round(performance.now() - tPhase)}ms`);
            } else {
              try {
                await ffmpeg.deleteFile(segName);
              } catch (_) {}
              segName = null;
            }
          }
  
          const wmBytes = skipWm ? null : await buildV2gWatermarkPng(outW, outH);
          const speedFilter = speed > 1 ? `setpts=PTS/${speed},` : "";
          // 噪点：源有颗粒 + 大幅下采样（如 1170→300 是 4 倍）时，bicubic 会混叠、GIF 看着全是噪点。
          // 先轻度 hqdn3d 降噪、再用 lanczos 缩放。若 wasm 核心未编入 hqdn3d，exec 返回非 0，下面自动回退重跑。
          const DENOISE = "hqdn3d=1.5:1.5:6:6,";
          const buildFilterArgs = (denoise) => {
            const chain =
              `${cropFilter}${speedFilter}fps=${fps},${denoise ? DENOISE : ""}` +
              `scale=${maxW}:-2:flags=lanczos${brightFilter}`;
            if (wmBytes && wmBytes.length) {
              return [
                "-filter_complex",
                `[0:v]${chain}[base];` +
                  `[1:v]format=rgba[wm];[base][wm]overlay=0:0:format=auto[v];` +
                  `[v]split[s0][s1];[s0]palettegen=max_colors=${maxColors}:stats_mode=full[p];` +
                  `[s1][p]paletteuse=dither=none:diff_mode=rectangle`,
              ];
            }
            return [
              "-vf",
              `${chain},split[s0][s1];[s0]palettegen=max_colors=${maxColors}:stats_mode=full[p];` +
                `[s1][p]paletteuse=dither=none:diff_mode=rectangle`,
            ];
          };
          if (wmBytes && wmBytes.length) {
            usedWm = true;
            await ffmpeg.writeFile(wmName, wmBytes);
          }

          ticker.setPhase(`${stageLabel}双通道调色板编码`);
          ticker.setProgress(0.05);
          const baseArgs = [];
          if (encodeSs > 0.001) baseArgs.push("-ss", String(encodeSs));
          baseArgs.push("-t", String(encodeT), "-i", encodeInput);
          if (usedWm) baseArgs.push("-i", wmName);
          const outArgs = ["-frames:v", String(frameCount), "-loop", "0", "-y", outName];
          const useDenoise = needDenoise(effW, outW);
          let code = await ffmpeg.exec([...baseArgs, ...buildFilterArgs(useDenoise), ...outArgs]);
          if (code !== 0 && useDenoise) {
            vbbLog("[vbb] 带降噪编码失败（可能 hqdn3d 未编入核心），回退无降噪重跑");
            code = await ffmpeg.exec([...baseArgs, ...buildFilterArgs(false), ...outArgs]);
          }
          vbbLog(
            `[vbb-phase] ffmpeg编码 ${Math.round(performance.now() - tPhase)}ms(累计) · ${fps}fps 宽${maxW} ${outW}x${outH} ${frameCount}帧`
          );
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
            span: effSpan,
            fps,
            playbackFps: gifEffectivePlaybackFps(fps),
            speed,
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
  
      let gifskiModPromise = null;
      /** gifski 共享 wasm.memory，并行批处理必须串行 encode */
      let gifskiEncodeChain = Promise.resolve();
      function withGifskiEncodeLock(fn) {
        const run = gifskiEncodeChain.then(fn, fn);
        gifskiEncodeChain = run.then(
          () => undefined,
          () => undefined
        );
        return run;
      }
      /** 懒加载 gifski wasm（ES module）；失败不缓存，下次重试 */
      function loadGifskiMods() {
        if (!gifskiModPromise) {
          const entry = new URL("./vendor/gifski/gifski_wasm.js", document.baseURI || window.location.href).href;
          gifskiModPromise = import(entry)
            .then(async (mod) => {
              await mod.default();
              return mod;
            })
            .catch((err) => {
              gifskiModPromise = null;
              throw err;
            });
        }
        return gifskiModPromise;
      }

      /**
       * ffmpeg 预处理（裁剪 / 加速 / 帧率 / 降噪 / 缩放 / 调亮 / 水印）→ 原始 RGBA 帧 → gifski wasm 编码。
       * gifski 自带调色板量化：同规格比 palettegen 管线体积更小、画质更好（实测 -7%）。
       * 失败（wasm 未加载 / 内存不足 / 帧数据过大）由 encodeBlackboxGif 回退 ffmpeg 管线。
       */
      /** 逐 32 位比较两帧 RGBA 是否完全相同（静止帧判定；比逐字节快 ~4×） */
      function makeFrameComparer(view) {
        const aligned = view.byteOffset % 4 === 0;
        const w32 = aligned ? new Uint32Array(view.buffer, view.byteOffset, view.byteLength >> 2) : null;
        return (offA, offB, stride) => {
          if (w32) {
            const a = offA >> 2;
            const b = offB >> 2;
            const words = stride >> 2;
            for (let i = 0; i < words; i++) if (w32[a + i] !== w32[b + i]) return false;
            return true;
          }
          for (let i = 0; i < stride; i++) if (view[offA + i] !== view[offB + i]) return false;
          return true;
        };
      }

      /**
       * GIF 时基只有百分之一秒：为目标 fps 生成逐帧 delay（毫秒）。
       * 一律固定厘秒 delay（15→70ms、12→80ms、20→50ms），避免累计取整造成
       * 15fps 出现 70/60 交替、观感一顿一顿（总时长略偏可接受，播放更顺）。
       */
      function buildUniformGifDurationsMs(frameCount, fps) {
        const n = Math.max(1, Math.floor(Number(frameCount) || 1));
        const f = Math.max(1, Number(fps) || 15);
        const cs = Math.max(1, Math.round(100 / f));
        const ms = cs * 10;
        const durations = new Uint32Array(n);
        durations.fill(ms);
        return durations;
      }

      /** 标称 fps 经 GIF 厘秒量化后的有效播放 fps（20→20，15→≈14.3，12→12.5） */
      function gifEffectivePlaybackFps(fps) {
        const f = Math.max(1, Number(fps) || 15);
        const cs = Math.max(1, Math.round(100 / f));
        return Math.round((100 / cs) * 10) / 10;
      }

      /**
       * 源是否允许冲 20fps：源≥20 或未知即可。
       * 抽帧走 ffmpeg `fps=` 滤波器（非整除隔帧），30→20 可用；不再要求整数分之一。
       */
      function blackboxSrcAllowsHighFps(srcFps) {
        const src = Number(srcFps) || 0;
        if (src <= 0) return true;
        return src + 0.5 >= V2G_BLACKBOX_HIGH_FPS;
      }

      /**
       * 合并连续相同的静止帧（屏幕录制常有大段静止）：原地压缩帧数据，重复帧只留一帧、
       * 时长叠加到该帧 → 体积大降且零画质损失。返回 null 表示没有可合并的帧。
       * durations 单位=毫秒（已实测），且长度必须等于帧数。
       */
      function mergeStaticFramesInPlace(view, n, stride, fps) {
        if (n < 3) return null;
        const eq = makeFrameComparer(view);
        const counts = [];
        let write = 0;
        let prevOff = 0;
        for (let f = 0; f < n; f++) {
          const off = f * stride;
          if (f > 0 && eq(prevOff, off, stride)) {
            counts[counts.length - 1] += 1;
            continue;
          }
          if (write !== f) view.copyWithin(write * stride, off, off + stride);
          prevOff = write * stride;
          counts.push(1);
          write += 1;
        }
        if (write >= n) return null;
        // 累计取整到 10ms（GIF 时基为厘秒），避免逐帧四舍五入造成整体时长漂移
        const durations = new Uint32Array(write);
        const perFrameCs = 100 / Math.max(1, fps);
        let accCs = 0;
        let prevCs = 0;
        for (let i = 0; i < write; i++) {
          accCs += counts[i] * perFrameCs;
          const cs = Math.round(accCs);
          durations[i] = Math.max(1, cs - prevCs) * 10;
          prevCs = cs;
        }
        return { count: write, durations, saved: n - write };
      }

      async function encodeV2gGifGifski(opts) {
        const tPhase = performance.now();
        const file = opts.file || v2gSourceFile;
        if (!file) throw new Error("缺少原始视频文件，请重新选择视频");
        const fpsCap = opts.allowWide ? 30 : Math.max(15, Number(currentMediaPerf().manualFpsCap) || 15);
        const fps = Math.min(fpsCap, Math.max(2, Number(opts.fps) || 8));
        const hardCapW = opts.allowWide
          ? V2G_ENCODE_HARD_W
          : Math.max(720, Number(currentMediaPerf().manualWidthCap) || 720);
        const maxW = Math.min(hardCapW, Math.max(64, Number(opts.maxW) || 360));
        const quality = Math.min(30, Math.max(1, Number(opts.quality) || 12));
        const rawGifski = Number(opts.gifskiQuality);
        const gifskiQuality = Number.isFinite(rawGifski)
          ? Math.max(1, Math.min(100, Math.round(rawGifski)))
          : gifQualityToGifskiQuality(quality);
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
        const speed = Math.max(1, Math.min(16, Number(opts.speed) || 1));
        const effSpan = span / speed;
        const frameCount = Math.max(2, Math.floor(effSpan * fps) + 1);
        const framesCapped = false;
        const srcW = Number(opts.srcW) || v2gVideo?.videoWidth || 0;
        const srcH = Number(opts.srcH) || v2gVideo?.videoHeight || 0;
        const crop = normalizeV2gCrop(opts.crop, srcW, srcH);
        const cropFilter = crop ? `crop=${crop.w}:${crop.h}:${crop.x}:${crop.y},` : "";
        const effW = crop ? crop.w : srcW;
        const effH = crop ? crop.h : srcH;
        const scale = effW > maxW && effW > 0 ? maxW / effW : 1;
        const outW = effW ? Math.max(2, Math.round((effW * scale) / 2) * 2) : maxW;
        const outH = effH ? Math.max(2, Math.round((effH * scale) / 2) * 2) : Math.round(outW * 0.75);
        const stageLabel = (speed > 1 ? `加速${speed.toFixed(2)}× · ` : "") + (opts.stageLabel ? `${opts.stageLabel} · ` : "");

        const mapProgress = (local, text) => {
          if (typeof opts.onProgress === "function") opts.onProgress(local, text);
          else setV2gProgress(true, local, text);
        };

        // 单次 gifski 要一次性持有全部帧（JS + wasm 各一份）。超过单次上限就「分段编码 + 合并」：
        // 每段帧数 ≤ min(320, 内存预算可容纳的帧数)，逐段 gifski 后用 gifsicle --merge 拼回一个 GIF。
        // 这样长视频也能吃 gifski 的画质/体积，同时每段内存可控（不再整片 OOM）。
        const perFrameBytes = outW * outH * 4;
        const forcedChunks = Math.max(0, Math.floor(Number(opts.chunkCount) || 0));
        let chunkMax;
        let chunkCount;
        const perf = currentMediaPerf();
        const preferSingle =
          !perf.preferChunkByDefault || perf.tier === "desktop" || perf.tier === "max";
        if (forcedChunks >= 1) {
          // 用户显式指定块数（手机端输入框）：完全尊重，1 = 单次编码（可能因内存不足失败）
          chunkMax = Math.max(1, Math.ceil(frameCount / Math.min(forcedChunks, frameCount)));
          chunkCount = Math.ceil(frameCount / chunkMax);
        } else if (preferSingle) {
          // 桌面 / 拉满 / 关闭默认分块：尽量单次；仅当峰值估算超上限才自动分块
          const peakCap = Math.max(1, Math.floor(gifskiSinglePassPeakBytes() / (perFrameBytes * 3)));
          const hardMax = Math.max(1, Math.min(gifskiMaxFrames(), peakCap));
          if (frameCount <= hardMax) {
            chunkMax = frameCount;
            chunkCount = 1;
          } else {
            chunkMax = hardMax;
            chunkCount = Math.ceil(frameCount / chunkMax);
          }
        } else {
          // 省电 / 均衡默认：按内存预算保守分块（防 OOM）
          const budgetFrames = Math.max(1, Math.floor(gifskiRawBudget() / perFrameBytes));
          chunkMax = Math.max(1, Math.min(gifskiMaxFrames(), budgetFrames));
          chunkCount = Math.ceil(frameCount / chunkMax);
        }
        vbbLog(
          `[vbb-phase] gifski 分块 chunkCount=${chunkCount} chunkMax=${chunkMax} 帧${frameCount} 每帧${formatKb(
            perFrameBytes
          )}（${forcedChunks >= 1 ? "用户指定" : preferSingle ? `单次优先·${perf.label}` : `分块优先·${perf.label}`}）`
        );
        if (aborted()) throw new Error("已取消");
        // 先加载 gifski：wasm 不可用就立刻抛错回退，不白跑一趟 ffmpeg 预处理
        const mod = await loadGifskiMods();
        if (aborted()) throw new Error("已取消");

        mapProgress(0.03, `${stageLabel}准备 FFmpeg 引擎…`);
        const ffmpeg =
          opts.ffmpeg ||
          (await getFfmpegInstance((ratio, text) => {
            mapProgress(0.03 + Math.min(0.12, (ratio || 0) * 0.12), `${stageLabel}${text || "加载引擎…"}`);
          }));
        if (aborted()) throw new Error("已取消");

        const ticker = createEncodeProgressTicker(mapProgress, 0.2, 0.45, `${stageLabel}导出 RGBA 帧`, aborted);
        const onFfmpegProgress = ({ progress }) => {
          if (aborted()) return;
          ticker.setProgress(Math.max(0, Math.min(1, Number(progress) || 0)));
        };
        const onFfmpegLog = () => ticker.bump();
        ffmpeg.on("progress", onFfmpegProgress);
        try {
          ffmpeg.on("log", onFfmpegLog);
        } catch (_) {}

        const ext = v2gSourceExt(file);
        const rawName = "out.rgba";
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
          inName = await ensureFfmpegInputWritten(ffmpeg, file, () => {
            mapProgress(0.16, `${stageLabel}载入本地编码器（不上传）…`);
          });
          encodeInput = inName;
          if (aborted()) throw new Error("已取消");

          // 大文件先按段 remux（同 ffmpeg 管线），避免整片反复解复用
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
          const speedFilter = speed > 1 ? `setpts=PTS/${speed},` : "";
          const DENOISE = "hqdn3d=1.5:1.5:6:6,";
          const buildRawArgs = (denoise) => {
            const chain =
              `${cropFilter}${speedFilter}fps=${fps},${denoise ? DENOISE : ""}` +
              `scale=${outW}:${outH}:flags=lanczos${brightFilter},format=rgba`;
            if (wmBytes && wmBytes.length) {
              return [
                "-filter_complex",
                `[0:v]${chain}[base];` +
                  `[1:v]format=rgba[wm];[base][wm]overlay=0:0:format=auto,format=rgba[v]`,
                "-map",
                "[v]",
              ];
            }
            return ["-vf", chain];
          };
          if (wmBytes && wmBytes.length) {
            usedWm = true;
            await ffmpeg.writeFile(wmName, wmBytes);
          }

          const encodeChunk = async (chunkStartFrame, chunkFrames) => {
            const startEff = chunkStartFrame / fps; // effSpan 时间轴（秒）
            const ss = encodeSs + startEff * speed; // 原始时间轴
            const dur = (chunkFrames / fps) * speed + 0.15; // 略多给一点，避免末帧被切
            const baseArgs = [];
            if (ss > 0.001) baseArgs.push("-ss", String(ss));
            baseArgs.push("-t", String(dur), "-i", encodeInput);
            if (usedWm) baseArgs.push("-i", wmName);
            const outArgs = ["-frames:v", String(chunkFrames), "-f", "rawvideo", "-pix_fmt", "rgba", "-y", rawName];
            const useDenoise = needDenoise(effW, outW);
            let code = await ffmpeg.exec([...baseArgs, ...buildRawArgs(useDenoise), ...outArgs]);
            if (code !== 0 && useDenoise) {
              code = await ffmpeg.exec([...baseArgs, ...buildRawArgs(false), ...outArgs]);
            }
            if (aborted()) throw new Error("已取消");
            if (code !== 0) throw new Error(`FFmpeg 导出 RGBA 失败（code=${code}）`);
            const data = await ffmpeg.readFile(rawName);
            const frames = data instanceof Uint8Array ? data : new Uint8Array(data);
            // 先释放 ffmpeg 侧文件，降低 gifski 拷贝帧时的峰值内存
            try {
              await ffmpeg.deleteFile(rawName);
            } catch (_) {}
            const stride = outW * outH * 4;
            let n = Math.floor(frames.length / stride);
            if (n < 2) throw new Error("导出的 RGBA 帧不足");
            if (n > chunkFrames) n = chunkFrames;
            const view = n * stride === frames.length ? frames : frames.subarray(0, n * stride);
            // 静止帧合并：可变长 delay 在连续动作里易「一顿一顿」。
            // ≥18fps（含 20）一律均匀 delay 保流畅；15/12 仍可合并省体积。
            let encodedFrames = n;
            let durations = null;
            if (fps < 18) {
              try {
                const merged = mergeStaticFramesInPlace(view, n, stride, fps);
                if (merged && merged.count >= 2) {
                  encodedFrames = merged.count;
                  durations = merged.durations;
                  vbbLog(`[vbb-phase] gifski 静止帧合并 ${n} → ${merged.count} 帧（省 ${merged.saved} 帧）`);
                }
              } catch (_) {}
            }
            // 一律显式写 delay（毫秒→厘秒）：20→50ms / 15→70ms / 12→80ms 固定均匀
            if (!durations) durations = buildUniformGifDurationsMs(encodedFrames, fps);
            const mergedView = view.subarray(0, encodedFrames * stride);
            // gifski.encode 是同步 wasm 调用，期间主线程会卡住；共享 memory 不可并发 → 上锁
            const gifBytes = await withGifskiEncodeLock(() =>
              mod.encode(mergedView, encodedFrames, outW, outH, undefined, durations, gifskiQuality)
            );
            if (!gifBytes || !gifBytes.length) throw new Error("gifski 未产出 GIF");
            return { blob: new Blob([gifBytes], { type: "image/gif" }), n, mergedOut: encodedFrames };
          };

          let blob;
          let actualFrames;
          if (chunkCount <= 1) {
            ticker.setPhase(`${stageLabel}导出 RGBA 帧`);
            ticker.setProgress(0.05);
            const { blob: b, n } = await encodeChunk(0, frameCount);
            blob = b;
            actualFrames = n;
            ticker.stop();
            vbbLog(
              `[vbb-phase] gifski rawvideo ${Math.round(performance.now() - tPhase)}ms · ${fps}fps 宽${outW} ${n}帧`
            );
          } else {
            ticker.stop();
            const chunks = [];
            let totalFrames = 0;
            for (let k = 0; k < chunkCount; k++) {
              if (aborted()) throw new Error("已取消");
              const startFrame = k * chunkMax;
              const cFrames = Math.min(chunkMax, frameCount - startFrame);
              const base = 0.2 + (k / chunkCount) * 0.45;
              mapProgress(base, `${stageLabel}分段 ${k + 1}/${chunkCount} · 导出 RGBA…`);
              const { blob: cb, n } = await encodeChunk(startFrame, cFrames);
              totalFrames += n;
              chunks.push(cb);
              mapProgress(base + 0.4 / chunkCount, `${stageLabel}分段 ${k + 1}/${chunkCount} · gifski 编码完成`);
              vbbLog(
                `[vbb-phase] gifski 分段 ${k + 1}/${chunkCount} · ${n}帧 ${formatKb(cb.size)}（累计 ${Math.round(performance.now() - tPhase)}ms）`
              );
            }
            mapProgress(0.66, `${stageLabel}合并 ${chunkCount} 段…`);
            blob = await mergeGifBlobs(chunks, () => {});
            actualFrames = totalFrames;
            if (!blob?.size) throw new Error("分段合并未产出 GIF");
          }
          mapProgress(0.99, `${stageLabel}完成`);
          vbbLog(
            `[vbb-phase] gifski编码 ${Math.round(performance.now() - tPhase)}ms(累计) · ${formatKb(blob.size)} q=${gifskiQuality}${chunkCount > 1 ? ` · ${chunkCount}段` : ""}`
          );
          const playbackFps = gifEffectivePlaybackFps(fps);
          return {
            blob,
            frameCount: actualFrames,
            span: effSpan,
            fps,
            playbackFps,
            speed,
            outW,
            outH,
            framesCapped,
            quality,
            maxW,
            maxColors: 0,
            engine: "gifski",
            gifskiQuality,
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
          if (segName) {
            try {
              await ffmpeg.deleteFile(segName);
            } catch (_) {}
          }
          try {
            await ffmpeg.deleteFile(rawName);
          } catch (_) {}
          if (usedWm) {
            try {
              await ffmpeg.deleteFile(wmName);
            } catch (_) {}
          }
        }
      }

      /**
       * 黑盒 GIF 编码入口：优先 gifski（更小更清晰），失败回退 ffmpeg palettegen 管线。
       * 取消不算失败，直接抛出（不触发回退）。
       */
      const VBB_RUN_KEY = "devtools-vbb-running";
      async function encodeBlackboxGif(opts) {
        // 处理中途被系统杀掉（OOM）时该标记会留下 → 下次进面板自动调大分块数
        try { localStorage.setItem(VBB_RUN_KEY, "1"); } catch (_) {}
        try {
          if (opts && opts.forceFfmpeg) return await encodeV2gGifFfmpeg(opts);
          try {
            return await encodeV2gGifGifski(opts);
          } catch (err) {
            if (String(err && err.message) === "已取消") throw err;
            vbbLog(`[vbb] gifski 引擎不可用，回退 ffmpeg：${err && err.message ? err.message : err}`);
            return await encodeV2gGifFfmpeg(opts);
          }
        } finally {
          try { localStorage.removeItem(VBB_RUN_KEY); } catch (_) {}
        }
      }

      /** UI 展示用帧率：优先成片有效播放 fps；倍速只标明加速，不误写成「更卡/观感掉帧」 */
      function formatBlackboxFpsLabel(c) {
        if (!c) return "";
        const play = Number(c.playbackFps) || gifEffectivePlaybackFps(c.fps) || Number(c.fps) || 0;
        const speed = Math.max(1, Number(c.speed) || 1);
        if (!(play > 0)) return "";
        const target = Number(c.fps) || play;
        const fpsTip =
          Math.abs(play - target) >= 0.6 ? `${play}FPS` : `${Math.round(play)}FPS`;
        // 压缩时长 = 内容倍速，成片仍按目标 fps 均匀刷新，不是掉帧
        if (speed > 1.02) return `${fpsTip}·${speed.toFixed(1)}×倍速`;
        return fpsTip;
      }

      function describeBlackboxCandidate(c) {
        if (!c) return "";
        const compressTip = c.compressRounds > 0 ? ` · 已压 ${c.compressRounds} 轮` : " · 未压缩";
        const effFps = c.frameCount > 1 ? (c.frameCount - 1) / c.span : c.fps;
        const capTip = c.framesCapped
          ? ` · 已抽稀到 ${c.frameCount} 帧（约 ${effFps.toFixed(1)} FPS）`
          : "";
        const widthTip = c.maxW ? ` · 宽≤${c.maxW}` : "";
        // 质量档位：gifski 显示其自适应量化 quality（1-100），ffmpeg 回退显示色数
        let qTip = "";
        if (c.engine === "gifski") {
          const gq = Number(c.gifskiQuality);
          qTip = Number.isFinite(gq)
            ? ` · 画质 ${gq}${c.quality && c.quality > 1 ? `（档${c.quality}）` : ""}`
            : "";
        } else if (c.maxColors) {
          qTip = ` · ${c.maxColors} 色`;
        }
        const fpsTip = formatBlackboxFpsLabel(c) || `${c.fps} FPS`;
        return `${fpsTip}${widthTip} · ${c.outW}×${c.outH} · ${formatKb(c.blob.size)}${qTip}${compressTip}${capTip}`;
      }
  
      function summarizeBlackboxCandidates(list) {
        return (list || [])
          .map((c) => `${c.fps}FPS ${formatKb(c.blob.size)}`)
          .join(" · ");
      }
  
      /** 探测源视频帧率（缓存）：挑选「整数分之一」帧率用，保证抽帧步长恒定 */
      async function detectSourceFps(srcFile) {
        if (!srcFile) return 0;
        const cache = (detectSourceFps._cache = detectSourceFps._cache || new Map());
        const key = `${srcFile.name || ""}|${srcFile.size || 0}|${srcFile.lastModified || 0}`;
        if (cache.has(key)) return cache.get(key);
        let fps = 0;
        const url = URL.createObjectURL(srcFile);
        const v = document.createElement("video");
        v.muted = true;
        v.playsInline = true;
        v.preload = "auto";
        try {
          v.src = url;
          await new Promise((resolve, reject) => {
            const to = setTimeout(() => reject(new Error("probe timeout")), 8000);
            v.onloadeddata = () => { clearTimeout(to); resolve(); };
            v.onerror = () => { clearTimeout(to); reject(new Error("probe error")); };
          });
          if (typeof v.requestVideoFrameCallback === "function") {
            const times = [];
            await new Promise((resolve) => {
              const to = setTimeout(resolve, 2500);
              const onFrame = (_now, meta) => {
                times.push(Number(meta?.mediaTime) || 0);
                if (times.length >= 2 && times[times.length - 1] - times[0] >= 0.6) {
                  clearTimeout(to);
                  resolve();
                  return;
                }
                if (times.length >= 240) { clearTimeout(to); resolve(); return; }
                v.requestVideoFrameCallback(onFrame);
              };
              v.requestVideoFrameCallback(onFrame);
              v.play().catch(() => { clearTimeout(to); resolve(); });
            });
            if (times.length >= 3) {
              const spanT = times[times.length - 1] - times[0];
              if (spanT > 0.15) {
                const est = (times.length - 1) / spanT;
                if (Number.isFinite(est) && est >= 5 && est <= 240) fps = Math.round(est);
              }
            }
          }
        } catch (_) {
          fps = 0;
        } finally {
          try { v.pause(); } catch (_) {}
          try { URL.revokeObjectURL(url); } catch (_) {}
          try { v.removeAttribute("src"); v.load(); } catch (_) {}
        }
        cache.set(key, fps);
        return fps;
      }

      /**
       * 按时长选主试帧率：≤16→20；≤24→15；更长→12。
       */
      function blackboxPrimaryFps(span) {
        const s = Number(span) || 0;
        if (s <= V2G_BLACKBOX_HIGH_PRIMARY_SPAN_SEC + 0.01) return V2G_BLACKBOX_HIGH_FPS;
        if (s <= V2G_BLACKBOX_MID_SPAN_SEC + 0.01) return 15;
        return 12;
      }

      /**
       * 黑盒主决策帧率阶梯：20 → 15 → 12（去掉 10）。
       */
      function blackboxFpsCandidates(srcFps) {
        void srcFps;
        return V2G_BLACKBOX_FPS_LIST.slice();
      }

      /** 帧率底线：一律 12fps（超预算靠缩宽/降质；不切片、不用 10fps） */
      function blackboxFpsFloor(_span) {
        void _span;
        return V2G_BLACKBOX_RETRY_MIN_FPS;
      }

      /** 主试列表：从主档往下（≤16s [20,15,12] / ≈20s [15,12] / ≈30s [12]） */
      function resolveBlackboxFpsList(span, srcFps) {
        const primary = blackboxPrimaryFps(span);
        const list = blackboxFpsCandidates(srcFps).filter((f) => f <= primary + 0.01);
        return list.length ? list : [V2G_BLACKBOX_RETRY_MIN_FPS];
      }

      /**
       * 余量提帧候选（finish 加宽之后）：
       * - ≈30s（>MID）：优先 15
       * - ≤20s 档：预算松、宽≥420、源允许 → 冲 20（倍速不挡；帧率仍均匀）
       */
      function blackboxRaiseFpsCandidates(span, srcFps, width, curSize, speed = 1) {
        const s = Number(span) || 0;
        const w = Number(width) || 0;
        const src = Number(srcFps) || 0;
        const size = Number(curSize) || 0;
        void speed;
        const list = [];
        const srcOk15 = src <= 0 || src >= 15 - 0.5;
        if (!srcOk15) return list;
        if (s > V2G_BLACKBOX_MID_SPAN_SEC + 0.01) {
          list.push(15);
          return list;
        }
        if (
          s > 0.05 &&
          s <= V2G_BLACKBOX_HIGH_FPS_MAX_SPAN + 0.01 &&
          w >= V2G_BLACKBOX_HIGH_FPS_MIN_W - 0.5 &&
          blackboxSrcAllowsHighFps(src) &&
          size > 0 &&
          size < V2G_BLACKBOX_MAX_BYTES * 0.88
        ) {
          list.push(V2G_BLACKBOX_HIGH_FPS);
        }
        return list;
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
        if (typeof maybeAutoShareGallery === "function") {
          maybeAutoShareGallery([{ name: "from-video.gif", blob: candidate.blob }], {
            title: "黑盒 GIF",
          }).catch(() => {});
        }
      }
  
      function resolveBlackboxWidthCap() {
        const srcW = Number(v2gVideo?.videoWidth) || 0;
        if (srcW > 0) return srcW;
        return V2G_BLACKBOX_WIDTH_HARD_FALLBACK;
      }
  
      /**
       * 体积有余（<5MB）时按步进加宽；某档超过预算 则回退上一档。
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
          const encoded = await encodeBlackboxGif({
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
       * 单档：编码后若超预算再压缩。
       * 非最后一档：轻柔 lossy（对齐 -l，不减色），不够则降帧。
       * 最后一档：标准/强力多轮（每轮都有 lossy），尽量挤进预算。
       * @returns {{ candidate: object, underBudget: boolean }}
       */
      async function encodeAndCompressBlackboxTier(fps, tierIndex, tierTotal, maxW = V2G_BLACKBOX_BASE_W) {
        if (abortV2g) throw new Error("已取消");
        const base = tierIndex / Math.max(1, tierTotal);
        const spanShare = 1 / Math.max(1, tierTotal);
        const isLastTier = tierIndex >= tierTotal - 1;
        const maxRounds = isLastTier ? V2G_BLACKBOX_MAX_COMPRESS_ROUNDS : V2G_BLACKBOX_SOFT_COMPRESS_ROUNDS;
        const width = Math.max(64, Number(maxW) || V2G_BLACKBOX_BASE_W);
  
        setV2gProgress(true, base + 0.02 * spanShare, `黑盒编码 · ${fps}FPS`, {
          sub: `宽≤${width} · 档位 ${tierIndex + 1}/${tierTotal}`,
        });
  
        const encoded = await encodeBlackboxGif({
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

        // 实测超预算（标定估偏）→ 先做一次「无损重编」：按实测体积把宽度/帧率一起缩。
        // 尽量不走到 gifsicle --lossy —— 它是「有损优化」，会改动像素，画面会出颗粒。
        {
          const target = V2G_BLACKBOX_MAX_BYTES * 0.9;
          const k = Math.min(1, Math.sqrt(target / Math.max(1, candidate.blob.size)));
          const rw = Math.max(V2G_BLACKBOX_RETRY_MIN_W, Math.floor((width * k) / 2) * 2);
          const rf = Math.max(V2G_BLACKBOX_RETRY_MIN_FPS, Math.round(fps * k * 2) / 2);
          // 帧率已到 12fps 底线、体积还不够 → 优先「减色」（比降帧率便宜得多）
          const retryQuality =
            rf <= V2G_BLACKBOX_RETRY_MIN_FPS + 0.01 && k < 0.92 ? V2G_BLACKBOX_RETRY_QUALITY : V2G_BLACKBOX_QUALITY;
          if (rw < width - 4 || rf < fps - 0.4) {
            setV2gProgress(true, base + 0.3 * spanShare, `黑盒重编 · ${rf}FPS`, {
              sub: `${formatKb(candidate.blob.size)} 超预算 → 无损重编 宽${rw}`,
              busy: true,
            });
            const retry = await encodeBlackboxGif({
              file: v2gSourceFile,
              fps: rf,
              maxW: rw,
              quality: retryQuality,
              stageLabel: `${rf}FPS·宽${rw}`,
              onProgress: (local, text) => {
                setV2gProgress(true, base + 0.3 * spanShare, `黑盒重编 · ${rf}FPS`, {
                  sub: text || `编码宽 ${rw}…`,
                  busy: local > 0 && local < 1,
                });
              },
            });
            const rc = { ...retry, compressRounds: 0, maxW: rw };
            if (rc.blob.size <= V2G_BLACKBOX_MAX_BYTES) return { candidate: rc, underBudget: true };
            candidate = rc;
          }
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
            `黑盒 · ${fps}FPS 仍超 ${blackboxBudgetLabel()}`,
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
  
      function vbbSpanSchemeKey(span, speed = 1) {
        const s = Math.max(VBB_MIN_SPAN, Number(span) || VBB_MIN_SPAN);
        const sp = Math.max(1, Number(speed) || 1);
        // 加速与否分桶，避免「压时长开/关」互相沿用错误档位
        if (sp > 1.02) return `${s.toFixed(1)}@x${sp.toFixed(2)}`;
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
  
      /** 「沿用方案」缓存版本：编码参数/分配算法变更时递增，旧缓存自动失效（避免沿用旧的低帧率） */
      const VBB_SPAN_SCHEME_VER = 5;

      function loadVbbSpanScheme(span, speed = 1) {
        const hit = loadVbbSpanSchemes()[vbbSpanSchemeKey(span, speed)];
        if (!hit || !(Number(hit.fps) > 0)) return null;
        // 旧版本（编码参数不同）算出的档位不再沿用
        if (Number(hit.ver) !== VBB_SPAN_SCHEME_VER) return null;
        return hit;
      }

      function saveVbbSpanScheme(span, seed, encode) {
        if (!seed?.fps) return;
        try {
          const map = loadVbbSpanSchemes();
          const speed = Math.max(1, Number(seed.speed) || 1);
          const key = vbbSpanSchemeKey(span, speed);
          map[key] = {
            ver: VBB_SPAN_SCHEME_VER,
            fps: Number(seed.fps) || 15,
            maxW: Math.max(64, Number(seed.maxW) || V2G_BLACKBOX_BASE_W),
            compressRounds: Number(seed.compressRounds) || 0,
            usedFallback: Boolean(seed.usedFallback),
            speed,
            encode: encode || "blackbox",
            at: Date.now(),
          };
          const keys = Object.keys(map).sort((a, b) => (map[b].at || 0) - (map[a].at || 0));
          while (keys.length > VBB_SPAN_SCHEME_MAX) delete map[keys.pop()];
          localStorage.setItem(VBB_SPAN_SCHEME_KEY, JSON.stringify(map));
        } catch (_) {}
      }
  
      function resolveVbbSegmentReuse(ranges, index, firstSeed, planEncode, speed = 1) {
        const sp = Math.max(1, Number(speed) || 1);
        const cached = loadVbbSpanScheme(ranges[index]?.span, sp);
        if (cached) {
          return { seed: cached, fromCache: true, encode: cached.encode || planEncode };
        }
        const seedSp = Math.max(1, Number(firstSeed?.speed) || 1);
        if (firstSeed && shouldReuseVbbFirstPlan(ranges, index) && Math.abs(seedSp - sp) < 0.05) {
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
          speed: Math.max(1, Number(encoded.speed) || 1),
        };
      }
  
      /** 黑盒编码对外入口：选优 → gifsicle -O3 → 若 O3 腾出预算再加宽一次 → 硬闸 ≤上限 */
      async function encodeBlackboxClip(clipOpts) {
        let result = await encodeBlackboxClipCore(clipOpts);
        if (!result?.blob || !(result.blob.size > 0)) return result;

        try {
          const tO3 = performance.now();
          const before = result.blob.size;
          const optimized = await compressGifBlob(result.blob, "standard", null, {
            plan: { label: "优化", args: "-O3", round: 1, lossy: 0 },
          });
          vbbLog(
            `[vbb-phase] gifsicle-O3 ${Math.round(performance.now() - tO3)}ms ${formatKb(before)}→${formatKb(
              optimized?.size || 0
            )}`
          );
          if (optimized && optimized.size && optimized.size < before) {
            result = { ...result, blob: optimized };
          }
        } catch (_) {}

        // O3 常再瘦一点：仅当已在上限内且仍 <95% 时试加宽（超限走硬闸，禁止把超限当完成）
        try {
          if (
            result.blob.size <= V2G_BLACKBOX_MAX_BYTES &&
            result.blob.size < V2G_BLACKBOX_MAX_BYTES * 0.95 &&
            !clipOpts.isAborted?.()
          ) {
          const srcW = Number(clipOpts.srcW) || 0;
          const hardMax = Math.min(srcW > 0 ? srcW : V2G_ENCODE_HARD_W, V2G_ENCODE_HARD_W);
          let curW = Math.max(64, Number(result.maxW) || Number(result.outW) || V2G_BLACKBOX_BASE_W);
          if (curW < hardMax - 2) {
          const fps = Number(result.fps) || 15;
          // 必须沿用核心阶段的加速倍率：clipOpts 只有 speedLimitSec，直接展开会丢掉 speed → 缩时长失效
          const speed = Math.max(1, Number(result.speed) || 1);
          const quality = Number(result.quality) || V2G_BLACKBOX_QUALITY;
          const gifskiQuality = Number.isFinite(Number(result.gifskiQuality))
            ? Number(result.gifskiQuality)
            : undefined;
          const onProgress = clipOpts.onProgress || (() => {});
          const widenMax = Math.min(
            hardMax,
            Math.max(curW + V2G_BLACKBOX_WIDTH_STEP, Math.round(curW * 1.5))
          );
          let best = result;
          let lo = curW;
          let hiW = widenMax;
          const capBytes = Math.round(V2G_BLACKBOX_MAX_BYTES * 0.99);
          const maxProbes = Math.max(1, Math.min(3, Number(currentMediaPerf().widenProbes) || 2));
          for (let i = 0; i < maxProbes && hiW - lo > 16; i++) {
            if (clipOpts.isAborted?.()) break;
            const w =
              i === 0
                ? Math.min(hiW, Math.max(lo + 2, Math.round((lo * Math.sqrt(capBytes / Math.max(1, best.blob.size))) / 2) * 2))
                : Math.round((lo + hiW) / 2 / 2) * 2;
            if (w <= lo || w >= hiW + 1) break;
            onProgress(0.985, `O3后加宽试探 ${w}px`);
            const enc = await encodeBlackboxGif({
              file: clipOpts.file,
              startSec: clipOpts.startSec,
              span: clipOpts.span,
              srcW: clipOpts.srcW,
              srcH: clipOpts.srcH,
              crop: clipOpts.crop || null,
              chunkCount: clipOpts.chunkCount,
              ffmpeg: clipOpts.ffmpeg || null,
              isAborted: clipOpts.isAborted,
              speed,
              fps,
              maxW: w,
              quality,
              gifskiQuality,
              allowWide: true,
              skipWatermark: true,
              skipBright: true,
              brightness: 0,
              stageLabel: `O3后·${fps}FPS·宽${w}`,
              onProgress: (local, text) => onProgress(0.985 + Math.min(0.01, (local || 0) * 0.01), text),
            });
            if (enc?.blob && enc.blob.size <= capBytes) {
              best = { ...enc, compressRounds: 0, maxW: w, speed };
              lo = w;
              if (best.outW > 0 && best.outW < w - 2) break;
            } else {
              hiW = w;
            }
          }
          if (best !== result) {
            vbbLog(
              `[vbb-phase] O3后加宽 ${curW}→${best.maxW} ${formatKb(result.blob.size)}→${formatKb(best.blob.size)}`
            );
            result = best;
          }
          }
          }
        } catch (_) {}

        return await enforceBlackboxMaxBytes(result, clipOpts);
      }

      /**
       * 最后一道硬闸：bytes 必须 ≤ V2G_BLACKBOX_MAX_BYTES（含边界）。
       * 超限则继续压缩/缩宽/降质/降帧；仍超则抛错，禁止把超限文件当成功结果。
       */
      async function enforceBlackboxMaxBytes(result, clipOpts) {
        if (!result?.blob) return result;
        if (result.blob.size <= V2G_BLACKBOX_MAX_BYTES) return result;
        const onProgress = clipOpts?.onProgress || (() => {});
        const isAborted = clipOpts?.isAborted || (() => abortV2g);
        const speed = Math.max(1, Number(result.speed) || 1);
        let best = result;

        // 1) gifsicle 硬压（含缩放档）
        if (typeof compressExistingGifToBlackbox === "function") {
          onProgress(0.97, `硬闸压缩到 ${blackboxBudgetLabel()}…`);
          try {
            const c = await compressExistingGifToBlackbox(
              best.blob,
              (ratio, text) => onProgress(0.97 + Math.min(0.01, (ratio || 0) * 0.01), text || "硬闸压缩"),
              isAborted
            );
            if (c?.blob && c.blob.size < best.blob.size) {
              best = {
                ...best,
                blob: c.blob,
                compressRounds: (best.compressRounds || 0) + (c.compressRounds || 0),
              };
            }
            if (best.blob.size <= V2G_BLACKBOX_MAX_BYTES) return best;
          } catch (err) {
            if (String(err && err.message) === "已取消") throw err;
          }
        }

        // 2) 重编码阶梯：缩宽 → 降质 → 底线 12fps
        const w0 = Math.max(
          V2G_BLACKBOX_RETRY_MIN_W,
          Number(best.maxW) || Number(best.outW) || V2G_BLACKBOX_BASE_W
        );
        const ladder = [
          { fps: Math.min(Number(best.fps) || 12, 15), wScale: 0.82, q: 18, gq: 55 },
          { fps: 12, wScale: 0.7, q: 22, gq: 45 },
          { fps: 12, wScale: 0.58, q: 30, gq: 40 },
          { fps: 12, wScale: 0.48, q: 30, gq: 35 },
        ];
        for (let i = 0; i < ladder.length; i++) {
          if (isAborted()) throw new Error("已取消");
          const step = ladder[i];
          const w = Math.max(V2G_BLACKBOX_RETRY_MIN_W, Math.round((w0 * step.wScale) / 2) * 2);
          onProgress(0.98, `硬闸重编 · ${step.fps}FPS 宽${w}`);
          vbbLog(
            `[vbb-phase] 硬闸重编 #${i + 1} ${step.fps}fps 宽${w} · 当前 ${formatKb(best.blob.size)} > ${blackboxBudgetLabel()}`
          );
          try {
            const enc = await encodeBlackboxGif({
              file: clipOpts.file,
              startSec: clipOpts.startSec,
              span: clipOpts.span,
              srcW: clipOpts.srcW,
              srcH: clipOpts.srcH,
              crop: clipOpts.crop || null,
              chunkCount: clipOpts.chunkCount,
              ffmpeg: clipOpts.ffmpeg || null,
              isAborted,
              speed,
              fps: step.fps,
              maxW: w,
              quality: step.q,
              gifskiQuality: step.gq,
              allowWide: true,
              skipWatermark: true,
              skipBright: true,
              brightness: 0,
              stageLabel: `硬闸·${step.fps}FPS·宽${w}`,
              onProgress: (local, text) =>
                onProgress(0.98 + Math.min(0.015, (local || 0) * 0.015), text || `硬闸重编宽${w}`),
            });
            let cand = { ...enc, compressRounds: 0, maxW: w, speed };
            if (cand.blob.size > V2G_BLACKBOX_MAX_BYTES && typeof compressExistingGifToBlackbox === "function") {
              const c2 = await compressExistingGifToBlackbox(
                cand.blob,
                (ratio, text) => onProgress(0.99, text || "硬闸再压"),
                isAborted
              );
              if (c2?.blob && c2.blob.size < cand.blob.size) {
                cand = {
                  ...cand,
                  blob: c2.blob,
                  compressRounds: c2.compressRounds || 0,
                };
              }
            }
            if (cand.blob.size < best.blob.size) best = cand;
            if (best.blob.size <= V2G_BLACKBOX_MAX_BYTES) return best;
          } catch (err) {
            if (String(err && err.message) === "已取消") throw err;
            vbbLog(`[vbb-phase] 硬闸重编失败：${err && err.message ? err.message : err}`);
          }
        }

        throw new Error(
          `无法压到 ${blackboxBudgetLabel()}（当前 ${formatKb(best.blob.size)}）。请缩短片段、关掉「压缩时长」或略降上限后再试`
        );
      }

      async function encodeBlackboxClipCore(clipOpts) {
        const file = clipOpts.file;
        const startSec = clipOpts.startSec;
        const span = clipOpts.span;
        const srcW = clipOpts.srcW;
        const srcH = clipOpts.srcH;
        // 目标时长（秒，0=不压缩时长）：源比目标长则加速到目标时长内
        const speedLimitSec = Math.max(0, Number(clipOpts.speedLimitSec) || 0);
        const speed =
          speedLimitSec > 0 && span > speedLimitSec
            ? Math.max(1, Math.min(16, span / speedLimitSec))
            : 1;
        const isAborted = clipOpts.isAborted || (() => abortV2g);
        const onProgress = clipOpts.onProgress || (() => {});
        // 并行探测源帧率（不挡引擎加载；最多等 1.5s，超时就用默认档位）
        const srcFpsProbe = detectSourceFps(file).catch(() => 0);
        const srcFps = await Promise.race([
          srcFpsProbe,
          new Promise((r) => setTimeout(() => r(0), 1500)),
        ]);
        // 主档按有效时长：≤24s → [15,12]；更长 → [12]。加速也不冲 20。
        const fpsList = resolveBlackboxFpsList(span / speed, srcFps);
        if (!fpsList.length) throw new Error("没有可用的黑盒帧率方案");
        const tried = [];
        const common = {
          file,
          startSec,
          span,
          srcW,
          srcH,
          speed,
          skipWatermark: true,
          skipBright: true,
          brightness: 0,
          isAborted,
          quality: V2G_BLACKBOX_QUALITY,
          crop: clipOpts.crop || null,
          allowWide: true, // 一键黑盒允许超过 720px（预算用不完时换清晰度）
          chunkCount: clipOpts.chunkCount != null ? clipOpts.chunkCount : readVbbChunkCount(),
          ffmpeg: clipOpts.ffmpeg || null,
        };

        /**
         * 宽度够用且仍有预算时，把剩余预算换成更高帧率（不降清晰度）。
         * 长片优先抬 15；短片仅在源可整除抽 20 且未加速时才冲 20。
         * @param {{ maxFps?: number }} [opts]
         */
        async function raiseBlackboxFps(best, curFps, encodeAtWidthFps, srcFps, effSpan, opts) {
          const cap = Math.min(30, srcFps > 0 ? srcFps : 30);
          const maxFpsOpt = Number(opts?.maxFps) || 0;
          if (!(cap > curFps)) return best;
          const width = Number(best.maxW) || V2G_BLACKBOX_BASE_W;
          let out = best;
          // 压缩后体积基本随帧率线性 → 直接算出能负担的最高帧率，只编一次
          const curSize = best.blob.size || 1;
          const maxF = curFps * ((V2G_BLACKBOX_MAX_BYTES * 0.98) / curSize);
          const raiseList = blackboxRaiseFpsCandidates(effSpan, srcFps, width, curSize, speed);
          const cands = raiseList
            .filter((f) => f > curFps + 0.01 && f <= Math.min(cap, maxF + 0.01))
            .filter((f) => !(maxFpsOpt > 0) || f <= maxFpsOpt + 0.01)
            .sort((a, b) => b - a);
          if (!cands.length) return best;
          const f = cands[0];
          // 冲 20 时要求宽仍 ≥420：宁可留在 15+更宽，也不为高帧掉到糊字区
          if (f >= V2G_BLACKBOX_HIGH_FPS - 0.01 && width < V2G_BLACKBOX_HIGH_FPS_MIN_W - 0.5) {
            return best;
          }
          if (isAborted()) throw new Error("已取消");
          onProgress(0.96, `提帧率到 ${f}fps`);
          vbbLog(
            `[vbb-phase] 余量提帧 ${curFps}→${f}fps 宽${width} span=${Number(effSpan).toFixed(1)}s ${formatKb(curSize)}`
          );
          const enc = await encodeAtWidthFps(f, width);
          if (!enc?.blob) return best;
          let cand = { ...enc, compressRounds: 0, maxW: width };
          if (cand.blob.size > V2G_BLACKBOX_MAX_BYTES) cand = await compressAt(cand, f, true, 0.96);
          if (cand.blob.size <= V2G_BLACKBOX_MAX_BYTES) out = cand;
          return out;
        }

        async function finishBlackbox(best, curFps, encodeAtWidthFps, hardMax) {
          if (!best?.blob) return best;
          if (best.blob.size >= V2G_BLACKBOX_MAX_BYTES * 0.95) return best; // 已用满预算
          let cur = best;
          let fpsNow = Number(cur.fps) || curFps;
          const effSpan = span / speed;
          const isLong = effSpan > V2G_BLACKBOX_MID_SPAN_SEC + 0.01;
          const atCap = () =>
            (srcW > 0 && cur.outW >= srcW - 2) || (Number(cur.maxW) || 0) >= Number(hardMax) - 2;
          const widthOkForRaise = () => {
            const w = Number(cur.maxW) || V2G_BLACKBOX_BASE_W;
            return w >= V2G_BLACKBOX_HIGH_FPS_MIN_W - 0.5 || atCap();
          };
          // ≈30s：很松时先抬到 15，再加宽（避免 12@很宽占满预算后抬不动帧）
          if (isLong && cur.blob.size < V2G_BLACKBOX_MAX_BYTES * 0.75 && fpsNow < 15 - 0.01) {
            const srcFpsEarly = await detectSourceFps(file).catch(() => 0);
            const raised = await raiseBlackboxFps(cur, fpsNow, encodeAtWidthFps, srcFpsEarly, effSpan, {
              maxFps: 15,
            });
            if (raised?.blob) {
              cur = raised;
              fpsNow = Number(cur.fps) || fpsNow;
            }
          }
          if (cur.blob.size >= V2G_BLACKBOX_MAX_BYTES * 0.95) return cur;
          // 小于规则：先加宽，再用余量提帧
          if (!atCap()) {
            onProgress(0.95, "体积有余 · 自动增宽");
            // gifski 已支持分段编码（内部自动切段），不再有「帧数/内存超限回退」问题；
            // 这里只把二分探测上限压到 2× 当前宽度，避免长视频对超预算宽度做整段（分段）编码白跑。
            const widenMax = Math.min(hardMax, Math.max(V2G_BLACKBOX_BASE_W, Math.round((Number(cur.maxW) || V2G_BLACKBOX_BASE_W) * 2)));
            const wider = await blackboxWidenBest(cur, (w) => encodeAtWidthFps(fpsNow, w), {
              minW: Math.max(64, Number(cur.maxW) || V2G_BLACKBOX_BASE_W),
              maxW: widenMax,
            });
            if (wider?.blob?.size) cur = wider;
          }
          if (cur.blob.size >= V2G_BLACKBOX_MAX_BYTES * 0.95) return cur;
          // 加宽后再提帧（短片源可整除才冲 20；长片抬 15）
          if (widthOkForRaise()) {
            const srcFpsNow = await detectSourceFps(file).catch(() => 0);
            cur = await raiseBlackboxFps(cur, Number(cur.fps) || fpsNow, encodeAtWidthFps, srcFpsNow, effSpan);
            fpsNow = Number(cur.fps) || fpsNow;
          }
          if (!cur?.blob) return cur;
          // 帧率也到顶、预算仍有富余 → gifski 质量从 92 上探到 100（源很窄/很短时用得上）
          // 省电/均衡不做：多一次编码就多一份 wasm 堆占用
          if (currentMediaPerf().allowQualityBoost && cur.blob.size < V2G_BLACKBOX_WIDEN_BYTES && (Number(cur.gifskiQuality) || 0) < 100) {
            onProgress(0.97, "体积有余 · 画质上探");
            const hi = await encodeAtWidthFps(
              Number(cur.fps) || fpsNow,
              Number(cur.maxW) || V2G_BLACKBOX_BASE_W,
              V2G_BLACKBOX_QUALITY,
              100
            );
            if (hi?.blob?.size && hi.blob.size <= V2G_BLACKBOX_MAX_BYTES) cur = hi;
          }
          return cur;
        }
  
        const encodeAt = async (fps, maxW, progressBase, progressSpan, stageLabel, quality, gifskiQuality) => {
          const encoded = await encodeBlackboxGif({
            ...common,
            fps,
            maxW,
            quality: quality || common.quality,
            gifskiQuality: Number.isFinite(Number(gifskiQuality)) ? Number(gifskiQuality) : undefined,
            stageLabel,
            onProgress: (local, text) => onProgress(progressBase + Math.min(1, local) * progressSpan, text),
          });
          return { ...encoded, compressRounds: 0, maxW };
        };
  
        const compressAt = async (candidate, fps, isLastFps, progressBase) => {
          if (!(candidate?.blob?.size > V2G_BLACKBOX_MAX_BYTES)) return candidate;
          // 先做一次「无损重编」：按实测体积把宽度/帧率一起缩（体积 ∝ 宽度²×帧数），
          // 尽量不走到 gifsicle --lossy —— 它是「有损优化」，会改动像素，画面会出颗粒。
          {
            const width = Number(candidate.maxW) || 0;
            if (width > 0) {
              const target = V2G_BLACKBOX_MAX_BYTES * 0.9;
              const k = Math.min(1, Math.sqrt(target / Math.max(1, candidate.blob.size)));
              const rw = Math.max(V2G_BLACKBOX_RETRY_MIN_W, Math.floor((width * k) / 2) * 2);
              // 帧率底线跟时长走：一律不低于 12，宁可靠压缩/减色兜
              const rf = Math.max(blackboxFpsFloor(span / speed), Math.round(fps * k * 2) / 2);
              // 帧率已到 12fps 底线、体积还不够 → 优先「减色」而不是继续掉帧率
              // （减色比降帧率便宜得多：见 V2G_BLACKBOX_RETRY_QUALITY 注释）
              const retryQuality =
                rf <= V2G_BLACKBOX_RETRY_MIN_FPS + 0.01 && k < 0.92
                  ? V2G_BLACKBOX_RETRY_QUALITY
                  : quality || common.quality;
              if (rw < width - 4 || rf < fps - 0.4) {
                vbbLog(
                  `[vbb-phase] 超预算 ${formatKb(candidate.blob.size)} → 无损重编 ${rf}fps 宽${rw}${
                    retryQuality !== (quality || common.quality) ? " 减色" : ""
                  }（避免 --lossy）`
                );
                const retry = await encodeAt(rf, rw, progressBase, 0.18, `${rf}FPS·宽${rw}·无损重编`, retryQuality);
                if (!(retry.blob.size > V2G_BLACKBOX_MAX_BYTES)) return retry;
                candidate = retry;
                fps = rf;
              }
            }
          }
          const maxRounds = isLastFps ? V2G_BLACKBOX_MAX_COMPRESS_ROUNDS : V2G_BLACKBOX_SOFT_COMPRESS_ROUNDS;
          let cur = candidate;
          for (let round = 1; round <= maxRounds; round++) {
            if (isAborted()) throw new Error("已取消");
            const before = cur.blob.size;
            const plan = isLastFps ? buildBlackboxHardCompressArgs(round) : buildBlackboxSoftCompressArgs(round);
          const tComp = performance.now();
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
          vbbLog(
            `[vbb-phase] gifsicle ${fps}fps 第${round}轮 ${Math.round(
              performance.now() - tComp
            )}ms ${formatKb(before)}→${formatKb(out.size)}`
          );
            cur = { ...cur, blob: out, compressRounds: round };
            if (out.size <= V2G_BLACKBOX_MAX_BYTES) break;
            if (out.size >= before * 0.99) break;
          }
          return cur;
        };
  
        /**
         * 找「最大且 ≤ 预算」的宽度：体积近似 ∝ 宽度²，先用解析式估起点，再二分收敛。
         * 目标贴到 0.99×预算（≤4 次编码）。旧实现「超一点就回退 45% 且只试 3 次」会卡在预算下方，
         * 实测 7 个真实录屏里 6 个只用掉 71~86% 预算（同帧率下宽度本可再大 8~22%）。
         */
        const blackboxWidenBest = async (candidate, encodeAtWidth, { minW, maxW }) => {
          if (!candidate?.blob) return candidate;
          if (candidate.blob.size > V2G_BLACKBOX_MAX_BYTES) return candidate;
          let best = candidate;
          let lo = Math.max(64, Number(candidate.maxW) || minW || V2G_BLACKBOX_BASE_W);
          const hi = Math.max(lo, Number(maxW) || lo);
          if (lo >= hi - 2) return best;
          const capBytes = Math.round(V2G_BLACKBOX_MAX_BYTES * 0.99);
          const fits = (c) => Boolean(c?.blob) && c.blob.size <= capBytes;
          let guess = Math.round((lo * Math.min(4, Math.sqrt(capBytes / Math.max(1, best.blob.size)))) / 2) * 2;
          guess = Math.max(lo + 2, Math.min(hi, guess));
          let hiW = hi;
          // 探次按性能档：拉满/桌面 4，均衡 3，省电 2（每次试探都是一整次 gifski）
          const maxProbes = Math.max(2, Math.min(6, Number(currentMediaPerf().widenProbes) || 2));
          for (let i = 0; i < maxProbes && hiW - lo > 16; i++) {
            if (isAborted()) throw new Error("已取消");
            const w = i === 0 ? guess : Math.round((lo + hiW) / 2 / 2) * 2;
            if (w <= lo || w >= hiW) break;
            onProgress(0.92, `加宽试探 ${w}px`);
            const enc = await encodeAtWidth(w);
            if (fits(enc)) {
              best = { ...enc, compressRounds: 0, maxW: w };
              lo = w;
              if (best.outW > 0 && best.outW < w - 2) break; // 已达源宽
            } else {
              hiW = w;
            }
          }
          return best;
        };

        const widenFrom = async (candidate, fps) => {
          if (!candidate?.blob || candidate.blob.size >= V2G_BLACKBOX_WIDEN_BYTES) return candidate;
          const hardMax = srcW > 0 ? srcW : V2G_BLACKBOX_WIDTH_HARD_FALLBACK;
          return blackboxWidenBest(
            candidate,
            (w) => encodeAt(fps, w, 0.92, 0.05, `${fps}FPS·宽${w}`),
            { minW: V2G_BLACKBOX_BASE_W, maxW: hardMax }
          );
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
            const seedHardMax = srcW > 0 ? srcW : V2G_BLACKBOX_WIDTH_HARD_FALLBACK;
            const widened = await widenFrom(candidate, fps);
            return await finishBlackbox(
              widened,
              fps,
              (f, w) => encodeAt(f, w, 0.96, 0.03, `${f}FPS·宽${w}`),
              seedHardMax
            );
          }
          // 沿用失败再走完整探测
        }
  
        // ---- 智能分配：标定一次 + 压缩一轮量出「压缩比」→ 目标只压 1 轮（画质最优）----
        // 实测：同体积下「收窄一点 + 只压 1 轮」比「宽度拉满 + 压 4 轮」PSNR 高 9dB。
        // 10MB 预算：编码目标略抬高，少浪费余量；仍留一点给封装/抖动
        const targetBytes = Math.round(V2G_BLACKBOX_MAX_BYTES * 0.88);
        const srcCap = Math.min(srcW > 0 ? srcW : V2G_BLACKBOX_WIDTH_HARD_FALLBACK, V2G_ENCODE_HARD_W);
        // 宽度底线统一 380（含加速场景）：录屏文字可读优先，不再为帧率把宽度降到 200/290
        const floorW = Math.min(V2G_BLACKBOX_MIN_ACCEPT_W, srcCap);
        const encodeAtWidthFps = (f, w, quality, gifskiQuality) =>
          encodeBlackboxGif({
            ...common,
            fps: f,
            maxW: w,
            quality: quality || common.quality,
            gifskiQuality: Number.isFinite(Number(gifskiQuality)) ? Number(gifskiQuality) : undefined,
            stageLabel: `${f}FPS·宽${w}`,
            onProgress: (local, text) => onProgress(0.92 + local * 0.05, text),
          });
        const fpsFloor = blackboxFpsFloor(span / speed);
        const effSpanForPick = span / speed;
        vbbLog(
          `[vbb-phase] 决策 fpsList=${JSON.stringify(fpsList)} srcFps=${srcFps} srcW=${srcW} floorW=${floorW} span=${effSpanForPick.toFixed(1)}s · 全程真实编码判定（无估算）· ${currentMediaPerf().label}`
        );
        // ---- 决策：全部用「真实编码」判定，不用估算；整段处理，不为 ≈30s 自动切两段 ----
        // ≤24s（≈20s 主打）：先 15 再 12；进预算后 finish 里先加宽，短片源合适再冲 20
        // >24s（≈30s）：先 12；很松抬 15 再加宽；底线 12，不用 10fps
        const trial = async (fps, w, q) => {
          if (isAborted()) throw new Error("已取消");
          const label = `${fps}FPS·宽${w}${q && q > 1 ? `·q${q}` : ""}`;
          onProgress(0.3, `尝试 ${label}`);
          const enc = await encodeAt(fps, w, 0.3, 0.28, label, q);
          tried.push(enc);
          vbbLog(
            `[vbb-phase] 试 ${label} → ${formatKb(enc.blob.size)}${enc.blob.size <= V2G_BLACKBOX_MAX_BYTES ? " ✓" : " ✗"}`
          );
          return enc.blob.size <= V2G_BLACKBOX_MAX_BYTES ? enc : null;
        };
        // 对某帧率做「宽度 420→400→380（步进 20）→ 底线宽度上降质量档」梯度尝试，返回第一个进预算的
        const fitFps = async (fps) => {
          const wTop = Math.max(floorW, Math.min(srcCap, V2G_BLACKBOX_BASE_W));
          for (let w = wTop; w >= floorW; w -= V2G_BLACKBOX_WIDTH_STEP) {
            const e = await trial(fps, w, V2G_BLACKBOX_QUALITY);
            if (e) return e;
            if (w - V2G_BLACKBOX_WIDTH_STEP < floorW) break;
          }
          // ≥15fps 只允许让渡到档 15（gifski 73）：再往下不如用更低帧的高质量
          const maxQi = fps >= 15 - 0.01 ? 2 : V2G_BLACKBOX_QUALITY_LADDER.length - 1;
          for (let qi = 1; qi <= maxQi; qi++) {
            const e = await trial(fps, floorW, V2G_BLACKBOX_QUALITY_LADDER[qi]);
            if (e) return e;
          }
          return null;
        };
        let chosen = null;
        // 按 resolveBlackboxFpsList 的主档顺序试（≤24s 15→12 / ≈30s 仅 12）
        for (const fps of fpsList) {
          const c = await fitFps(fps);
          if (c) {
            chosen = { enc: c, fps };
            break;
          }
        }
        if (!chosen) {
          // 全都不行 → 取最小的一档走 gifsicle 硬压兜底
          const smallest = tried.slice().sort((a, b) => a.blob.size - b.blob.size)[0];
          if (!smallest) return null;
          const c = await compressAt(smallest, Number(smallest.fps) || fpsFloor, true, 0.9);
          tried.push(c);
          if (c.blob.size <= V2G_BLACKBOX_MAX_BYTES) chosen = { enc: c, fps: Number(smallest.fps) || fpsFloor };
        }
        if (!chosen) return tried.slice().sort((a, b) => a.blob.size - b.blob.size)[0] || null;
        // 实验/排查用（仅 ?debug）：localStorage devtools-vbb-force="fps:宽" 强制指定档位
        try {
          if (VBB_DEBUG) {
            const m = /^(\d+(?:\.\d+)?)(?::(\d+))?$/.exec(String(localStorage.getItem("devtools-vbb-force") || "").trim());
            if (m) {
              const f = Number(m[1]);
              const w = m[2] ? Number(m[2]) : V2G_BLACKBOX_BASE_W;
              const e = await trial(f, w, V2G_BLACKBOX_QUALITY);
              chosen = { enc: e || (await encodeAt(f, w, 0.5, 0.3, `debug·${f}FPS`)), fps: f };
            }
          }
        } catch (_) {}
        const chosenQuality = V2G_BLACKBOX_QUALITY;
        vbbLog(`[vbb-phase] 选定 ${chosen.fps}fps · 宽${chosen.enc.maxW || floorW} · ${formatKb(chosen.enc.blob.size)}`);
        onProgress(0.62, `选定 ${chosen.fps}FPS · 宽${chosen.enc.maxW || floorW} · ${formatKb(chosen.enc.blob.size)}`);
        let candidate = chosen.enc;
        // 超预算 → 按比例回缩一次
        if (candidate.blob.size > V2G_BLACKBOX_MAX_BYTES && (candidate.maxW || 0) > V2G_BLACKBOX_BASE_W) {
          const back = Math.max(
            V2G_BLACKBOX_BASE_W,
            Math.round((candidate.maxW * Math.sqrt(targetBytes / candidate.blob.size)) / 2) * 2
          );
          if (back < candidate.maxW - 2) {
            onProgress(0.88, `回缩 ${back}px`);
            const shrunk = await encodeAt(chosen.fps, back, 0.88, 0.06, `${chosen.fps}FPS·宽${back}`, chosenQuality);
            tried.push(shrunk);
            if (shrunk.blob.size <= V2G_BLACKBOX_MAX_BYTES) candidate = shrunk;
          }
        }
        // 仍超 → 先降质量档重编（gifski 自适应量化 / ffmpeg 等价降色），比直接上 gifsicle lossy 耐看
        if (candidate.blob.size > V2G_BLACKBOX_MAX_BYTES) {
          const wNow = Number(candidate.maxW) || chosen.width;
          const baseQ = chosenQuality || V2G_BLACKBOX_QUALITY;
          const at = V2G_BLACKBOX_QUALITY_LADDER.indexOf(baseQ);
          for (let qi = (at >= 0 ? at : 0) + 1; qi < V2G_BLACKBOX_QUALITY_LADDER.length; qi++) {
            if (abortV2g) throw new Error("已取消");
            const q = V2G_BLACKBOX_QUALITY_LADDER[qi];
            onProgress(0.9, `降质量档重编（q${q} · ${formatKb(candidate.blob.size)}）`);
            const qc = await encodeAt(chosen.fps, wNow, 0.9, 0.05, `${chosen.fps}FPS·宽${wNow}·q${q}`, q);
            tried.push(qc);
            candidate = qc;
            if (qc.blob.size <= V2G_BLACKBOX_MAX_BYTES) break;
          }
          // 阶梯走完仍超 → gifski 极限压低（quality 40），比继续收窄宽度耐看
          if (candidate.blob.size > V2G_BLACKBOX_MAX_BYTES) {
            onProgress(0.92, `gifski 极限压质量（q40 · ${formatKb(candidate.blob.size)}）`);
            const g40 = await encodeAt(
              chosen.fps,
              wNow,
              0.92,
              0.04,
              `${chosen.fps}FPS·宽${wNow}·g40`,
              V2G_BLACKBOX_QUALITY_LADDER[V2G_BLACKBOX_QUALITY_LADDER.length - 1],
              40
            );
            tried.push(g40);
            candidate = g40;
          }
        }
        // 仍超 → 压缩兜底
        if (candidate.blob.size > V2G_BLACKBOX_MAX_BYTES) {
          candidate = await compressAt(candidate, chosen.fps, true, 0.9);
          tried.push(candidate);
        }
        if (candidate.blob.size <= V2G_BLACKBOX_MAX_BYTES) {
          return await finishBlackbox(
            candidate,
            chosen.fps,
            (f, w) => encodeAtWidthFps(f, w, chosenQuality),
            srcCap
          );
        }
        return tried.slice().sort((a, b) => a.blob.size - b.blob.size)[0] || null;
      }
  