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
       * 黑盒：起点 420 宽 · q1（gifski 92）· 上限默认 10MB；整段处理。
       * 帧率阶梯必含 15：24→15→12；25→15→12.5；30→15→12；其它 20→15→12。
       * 超限让渡（本路径仅黑盒）：短片（≤10s）最高帧 @420 @92 → 同宽降到画质≥80
       *   → 面积外推跳过注定超限的 400/380 → 再降整除帧（15 必试）。
       * 长片：420 允许 q<80 保帧，不先缩宽；时长×fps 过大则跳过该高档（15 仍试）。
       * 细档 q4/q6 仅体积已贴预算（≤1.18×）时才打。
       * 非黑盒「视频转 GIF / 切片高清 GIF」不走这套，按用户帧率/宽度/质量编码。
       * 有余量：先抬画质到满档 → 再加宽（禁止「宽一点但糊」）。
       */
      const V2G_BLACKBOX_MAX_FPS = 30;
      const V2G_BLACKBOX_FPS_LIST = [20, 15, 12];
      /** ≤16s：主打高帧（10MB 流畅优化） */
      const V2G_BLACKBOX_HIGH_PRIMARY_SPAN_SEC = 16;
      /** ≤24s：走中档；更长走低档 */
      const V2G_BLACKBOX_SHORT_SPAN_SEC = 24;
      const V2G_BLACKBOX_MID_SPAN_SEC = 24;
      /** 产品：单段整段拉满；不因时长自动切片成多条 GIF */
      const V2G_BLACKBOX_OPT_MAX_SPAN_SEC = 36;
      /** 默认余量提帧目标（30fps 源等）；25fps 源见 blackboxFpsCandidates */
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
        /** 非黑盒 GIF：用户可选最高帧率（黑盒仍只走整除档 ≤30） */
        const V2G_MANUAL_MAX_FPS = 60;
        /** 非黑盒「质量 1」对应 gifski 100；黑盒满档仍是 q1→92 */
        const V2G_MANUAL_GIFSKI_BEST = 100;
        /** 智能分配的分辨率底线：某帧率若只能做到比这更窄，就换更低帧率 */
      const V2G_BLACKBOX_MIN_ACCEPT_W = 380;
      /** 实测超预算时「无损重编」的绝对下限（宽度 px / 帧率）：宁可到这两个底线，也不轻易用 gifsicle --lossy */
      const V2G_BLACKBOX_RETRY_MIN_W = 380;
      /**
       * 清晰工作点：手机默认够用的宽。超限先收到这里再降画质；有余量先满画质再考虑比这更宽。
       * 硬底线仍是 MIN_ACCEPT/RETRY_MIN（380）。
       */
      const V2G_BLACKBOX_COMFORT_W = V2G_BLACKBOX_BASE_W;
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
      /** 超预算时的质量让渡阶梯（gifski：92→88→86→83→74→…→55）。降帧前只走到 ≥80。 */
      const V2G_BLACKBOX_QUALITY_LADDER = [1, 4, 6, 8, 15, 18, 22, 30];
      /** 未到最低帧率前，画质不得低于约 80（q8→gq83）。仅 ≤10s 短片；长片优先保帧。 */
      const V2G_BLACKBOX_QUALITY_KEEP_MIN_GQ = 80;
      /** ≤此时长才守 80 再掉帧（601 15.8s 不算短） */
      const V2G_BLACKBOX_KEEP_Q_MAX_SPAN_SEC = 10;
      const V2G_BLACKBOX_FINE_NEAR_BUDGET = 1.18;
      const V2G_BLACKBOX_AREA_SKIP_SLACK = 1.12;
      const V2G_BLACKBOX_HIGH_FPS_FRAME_SKIP = 420;
      /** wasm 单段帧上限，避免 700 帧 OOM（用户选「1 块」也强制切开） */
      const V2G_GIFSKI_WASM_MAX_FRAMES = 240;
      /** 超限收窄：420 → 400 → 380（偶数） */
      const V2G_BLACKBOX_LETGO_WIDTHS = [420, 400, 380];
      /** 满档 gifski quality（q1→92）；加宽门闩以此为准，避免 quality 字段丢失时误加宽 */
      const V2G_BLACKBOX_GIFSKI_BEST =
        typeof gifQualityToGifskiQuality === "function"
          ? gifQualityToGifskiQuality(V2G_BLACKBOX_QUALITY)
          : 92;
      /**
       * 解析黑盒画质档：优先 ladder `quality`；缺失则从 gifskiQuality 反推。
       * 修复：quality 丢失时 `Number(x)||1` 会误判「已满档」→ 按 q65 加宽成「宽而不清」。
       */
      function blackboxLadderQuality(c) {
        const gq = Number(c?.gifskiQuality);
        const q = Number(c?.quality);
        // gq 未满档时以反推为准，避免 quality=1 但 gq=65 的脏状态误导抬质/加宽
        const preferGq =
          Number.isFinite(gq) && gq > 0 && gq < V2G_BLACKBOX_GIFSKI_BEST - 1;
        if (!preferGq && Number.isFinite(q) && q >= 1 && q <= 30) return q;
        if (Number.isFinite(gq) && gq > 0) {
          const est = 1 + ((92 - gq) * 29) / 37;
          let best = V2G_BLACKBOX_QUALITY_LADDER[0];
          let bestD = Infinity;
          for (let i = 0; i < V2G_BLACKBOX_QUALITY_LADDER.length; i++) {
            const step = V2G_BLACKBOX_QUALITY_LADDER[i];
            const d = Math.abs(step - est);
            if (d < bestD) {
              bestD = d;
              best = step;
            }
          }
          return best;
        }
        if (Number.isFinite(q) && q >= 1 && q <= 30) return q;
        return V2G_BLACKBOX_QUALITY;
      }
      function blackboxQualityIsBest(c) {
        const gq = Number(c?.gifskiQuality);
        if (Number.isFinite(gq) && gq < V2G_BLACKBOX_GIFSKI_BEST - 1) return false;
        return blackboxLadderQuality(c) <= V2G_BLACKBOX_QUALITY + 0.01;
      }
      function blackboxLadderGifskiQ(q) {
        return typeof gifQualityToGifskiQuality === "function"
          ? gifQualityToGifskiQuality(q)
          : Math.max(50, Math.min(100, Math.round(92 - (Number(q) - 1) * ((92 - 55) / 29))));
      }
      /** 画质≥80 的最高阶梯下标（当前为 q8） */
      function blackboxKeepQualityMaxQi() {
        let maxQi = 0;
        for (let i = 0; i < V2G_BLACKBOX_QUALITY_LADDER.length; i++) {
          if (blackboxLadderGifskiQ(V2G_BLACKBOX_QUALITY_LADDER[i]) >= V2G_BLACKBOX_QUALITY_KEEP_MIN_GQ - 0.5) {
            maxQi = i;
          }
        }
        return maxQi;
      }
      function blackboxEncMeetsKeepQ(c) {
        const gq = Number(c?.gifskiQuality);
        if (Number.isFinite(gq) && gq > 0) {
          return gq >= V2G_BLACKBOX_QUALITY_KEEP_MIN_GQ - 0.5;
        }
        return (
          blackboxLadderGifskiQ(blackboxLadderQuality(c)) >= V2G_BLACKBOX_QUALITY_KEEP_MIN_GQ - 0.5
        );
      }
      function manualGifskiQuality(quality) {
        const q = Math.min(30, Math.max(1, Number(quality) || 1));
        if (q <= 1) return V2G_MANUAL_GIFSKI_BEST;
        return typeof gifQualityToGifskiQuality === "function" ? gifQualityToGifskiQuality(q) : 90;
      }
      /**
       * 抬质试编若略超 10MB：尽量无损进预算后再接受。
       * 历史：9a98dc6 用硬压前 4 档（movie lossy≈92–176）硬塞满档 → 标签 q92 但密麻颗粒
       * （617/618：满 256 色调色板 + 近 10MB，典型 lossy 抖动噪点，非 --colors 泥色）。
       * 规则：满画质只许 -O3；非满档最多 O3 + 一轮很轻 soft；O3 后禁止再叠 lossy 留底。
       * 干净次档进预算 > 脏满档贴上限。
       */
      async function blackboxAcceptBoostIfFits(enc, { onProgress, isAborted, softGate = 1.22, curSize = 0 } = {}) {
        if (!enc?.blob?.size) return null;
        if (enc.blob.size <= V2G_BLACKBOX_MAX_BYTES) return enc;
        // 抬质试压：默认可试到 2×；更远则直接放弃（勿靠大 lossy 硬塞）
        let gate = Math.max(softGate, 2);
        const cur = Number(curSize) || 0;
        if (cur > 0 && cur < V2G_BLACKBOX_MAX_BYTES * 0.75) {
          gate = Math.max(gate, 2.1);
        }
        if (enc.blob.size > V2G_BLACKBOX_MAX_BYTES * gate) {
          vbbLog(
            `[vbb-phase] 抬质跳过试压：原始 ${formatKb(enc.blob.size)} > 门闩 ${gate.toFixed(2)}×预算`
          );
          return null;
        }
        if (typeof compressGifBlob !== "function") return null;
        const aborted = typeof isAborted === "function" ? isAborted : () => abortV2g;
        const isBest = blackboxQualityIsBest(enc);
        // 满档：只 -O3。非满档：O3 + 至多一轮电影轻压（lossy≈28），禁止 hard movie 高档。
        const plans = [];
        if (typeof buildBlackboxSoftCompressArgs === "function") {
          plans.push(buildBlackboxSoftCompressArgs(1, { movie: true })); // -O3
          if (!isBest) plans.push(buildBlackboxSoftCompressArgs(2, { movie: true })); // lossy≈28
        } else if (typeof buildBlackboxHardCompressArgs === "function") {
          plans.push(buildBlackboxHardCompressArgs(1, { movie: true }));
        } else {
          return null;
        }
        let best = enc.blob;
        let rounds = 0;
        try {
          for (let i = 0; i < plans.length; i++) {
            if (aborted()) throw new Error("已取消");
            const plan = plans[i];
            const out = await compressGifBlob(
              best,
              "standard",
              (ratio, text) =>
                typeof onProgress === "function"
                  ? onProgress(Math.min(0.99, 0.9 + (ratio || 0) * 0.05), text || plan.label || "抬质轻压")
                  : undefined,
              { round: plan.round || i + 1, plan }
            );
            rounds = i + 1;
            if (out?.size && out.size < best.size) best = out;
            if (best.size <= V2G_BLACKBOX_MAX_BYTES) {
              // 满档且本轮带了 lossy：拒绝留底（防以后改 plans 误放行）
              if (isBest && Number(plan.lossy) > 0) {
                vbbLog(
                  `[vbb-phase] 抬质满档拒绝lossy留底 · lossy=${plan.lossy} ${formatKb(best.size)}`
                );
                return null;
              }
              vbbLog(
                `[vbb-phase] 抬质轻压进预算 ${formatKb(enc.blob.size)}→${formatKb(best.size)} · q${
                  Number(enc.quality) || "?"
                }/gq${Number(enc.gifskiQuality) || "?"}${isBest ? " ·满档仅O3" : " ·禁硬lossy"}`
              );
              return {
                ...enc,
                blob: best,
                compressRounds: (Number(enc.compressRounds) || 0) + rounds,
              };
            }
          }
          vbbLog(
            `[vbb-phase] 抬质未进预算（禁lossy颗粒） ${formatKb(enc.blob.size)}→${formatKb(best.size)} · 放弃 q${
              Number(enc.quality) || "?"
            }/gq${Number(enc.gifskiQuality) || "?"}${isBest ? " ·满档" : ""}`
          );
        } catch (err) {
          if (String(err && err.message) === "已取消") throw err;
        }
        return null;
      }
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
              encodeConcurrency: isCoarsePointer() ? 1 : 2,
              label: isCoarsePointer() ? "省电" : "桌面",
            };
      }
      function resolveBatchConcurrency(total) {
        // 手机强制单路：多选也逐个转，避免两路抢内存拖慢当前任务
        if (isCoarsePointer()) return 1;
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
        "支持 MP4 / WebM / MOV。选择后仅本机读取，不会上传。默认 60FPS / 宽1280 / gifski 100。关闭页面会释放本次视频和 GIF；编码器缓存可在侧栏一键清理。";
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
        const fps = Math.min(V2G_MANUAL_MAX_FPS, Math.max(2, Number(opts.fps) || 60));
        const maxW = Math.min(V2G_ENCODE_HARD_W, Math.max(64, Number(opts.maxW) || V2G_ENCODE_HARD_W));
        const quality = Math.min(30, Math.max(1, Number(opts.quality) || 1));
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
        const naturalFrames = Math.max(2, Math.round(span * fps));
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
            // 半开 [start, end)：末帧落在 end 前，不取到片尾点上的下一画面
            const t = startSec + (span * i) / frameCount;
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
          const resolve = window.resolveToolsAssetUrl || window.DevToolsResolveToolsAsset;
          const workerUrl =
            typeof resolve === "function"
              ? resolve("vendor/gif.worker.js")
              : new URL("./vendor/gif.worker.js", document.baseURI || window.location.href).href;
          const workerSource = await fetch(workerUrl).then((r) => {
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
                  quality: Math.min(30, Math.max(1, Number(opts.quality) || 1)),
                  width: outW,
                  height: outH,
                  workerScript,
                  repeat: 0,
                  background: "#000000",
                });
                activeV2gGifs.add(gif);
              }
              const delay = Math.round(1000 / Math.min(V2G_MANUAL_MAX_FPS, Math.max(2, Number(opts.fps) || 60)));
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
        const fpsCap = opts.allowWide ? V2G_MANUAL_MAX_FPS : Math.max(15, Number(currentMediaPerf().manualFpsCap) || 15);
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
        // 半开区间 [start, end)：不 +1，避免片尾比编辑拖到的位置多出几帧
        const naturalFrames = Math.max(2, Math.round(effSpan * fps));
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
            // 时长不加正垫：半开 [start, start+span)，避免片尾多吃编辑没预览到的帧
            const cutDur = span;
            const cutArgs =
              startSec > 0.05
                ? [
                    "-i",
                    inName,
                    "-ss",
                    String(startSec),
                    "-t",
                    String(cutDur),
                    "-an",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "ultrafast",
                    "-crf",
                    "18",
                    "-pix_fmt",
                    "yuv420p",
                    "-movflags",
                    "+faststart",
                    "-y",
                    segName,
                  ]
                : [
                    "-i",
                    inName,
                    "-ss",
                    String(startSec),
                    "-t",
                    String(cutDur),
                    "-c",
                    "copy",
                    "-avoid_negative_ts",
                    "make_zero",
                    "-movflags",
                    "+faststart",
                    "-y",
                    segName,
                  ];
            const cutCode = await ffmpeg.exec(cutArgs);
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
          const speedFilter = speed > 1 ? `setpts=(PTS-STARTPTS)/${speed},` : "setpts=PTS-STARTPTS,";
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
          const baseArgs = ["-i", encodeInput];
          if (encodeSs > 0.001) baseArgs.push("-ss", String(encodeSs));
          baseArgs.push("-t", String(encodeT));
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
      /** 让出主线程，避免连续 wasm/试档把滑动事件饿死 */
      function yieldToUi() {
        return new Promise((resolve) => {
          let done = false;
          const go = () => {
            if (done) return;
            done = true;
            resolve();
          };
          if (typeof scheduler !== "undefined" && typeof scheduler.yield === "function") {
            scheduler.yield().then(go, go);
          }
          requestAnimationFrame(() => setTimeout(go, 0));
        });
      }
      /** 懒加载 gifski wasm（ES module）；带 ?v= + /tools 根解析；失败不缓存，下次重试 */
      function loadGifskiMods() {
        if (!gifskiModPromise) {
          const resolve = window.resolveToolsAssetUrl || window.DevToolsResolveToolsAsset;
          const entry =
            typeof resolve === "function"
              ? resolve("vendor/gifski/gifski_wasm.js")
              : (() => {
                  let base = document.baseURI || window.location.href;
                  try {
                    const u = new URL(base);
                    if (/\/tools$/i.test(u.pathname)) {
                      u.pathname += "/";
                      base = u.href;
                    }
                  } catch (_) {
                    /* ignore */
                  }
                  const ver = encodeURIComponent(String(TOOLS_VERSION || window.TOOLS_VERSION || "").replace(/^v/, ""));
                  return new URL(`./vendor/gifski/gifski_wasm.js${ver ? `?v=${ver}` : ""}`, base).href;
                })();
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

      /**
       * gifski-wasm（jamsinclair）把 durations[最后一帧] 当成第 0 帧 PTS。
       * 片尾静止合并若把剩余时长叠在末帧，会变成「片头冻住几秒」。
       * 把末帧改回一拍，差额加到倒数第二帧，片尾仍能停住、片头按一帧 delay 开拍。
       */
      function durationsForGifskiWasmPts(durations) {
        const n = durations?.length || 0;
        if (n < 2) return durations;
        const out = durations instanceof Uint32Array ? new Uint32Array(durations) : Uint32Array.from(durations);
        const last = out[n - 1];
        const tick = Math.max(10, out[0] || 50);
        out[n - 1] = tick;
        if (last > tick) out[n - 2] += last - tick;
        return out;
      }

      function gifskiWasmDurationsAreUniform(durations) {
        if (!durations || durations.length < 2) return true;
        const a = durations[0];
        for (let i = 1; i < durations.length; i++) if (durations[i] !== a) return false;
        return true;
      }

      /** 标称 fps 经 GIF 厘秒量化后的有效播放 fps（20→20，15→≈14.3，12→12.5） */
      function gifEffectivePlaybackFps(fps) {
        const f = Math.max(1, Number(fps) || 15);
        const cs = Math.max(1, Math.round(100 / f));
        return Math.round((100 / cs) * 10) / 10;
      }

      /** 本机桥原生 GIF：探测缓存（失败冷却 20s） */
      let nativeGifskiProbe = { at: 0, ok: false, base: "", prefix: "/ff", engine: "" };
      function nativeGifskiToken() {
        try {
          return (
            (window.devtoolsBridgeToken && window.devtoolsBridgeToken.read && window.devtoolsBridgeToken.read()) ||
            localStorage.getItem("devtools-bridge-token") ||
            "devtools-bridge"
          );
        } catch (_) {
          return "devtools-bridge";
        }
      }
      function nativeGifskiHeaders(extra = {}) {
        const t = String(nativeGifskiToken() || "devtools-bridge").trim() || "devtools-bridge";
        return {
          "X-Adb-Token": t,
          "X-Ffmpeg-Token": t,
          ...extra,
        };
      }
      async function probeNativeGifski(force = false) {
        const now = Date.now();
        if (!force && nativeGifskiProbe.at && now - nativeGifskiProbe.at < 20000) {
          return nativeGifskiProbe;
        }
        let base = "http://127.0.0.1:17888";
        try {
          base = (
            localStorage.getItem("devtools-ffmpeg-base") ||
            localStorage.getItem("devtools-adb-base") ||
            base
          ).replace(/\/$/, "");
        } catch (_) {}
        const token = nativeGifskiToken();
        try {
          if (window.devtoolsBridgeToken?.discoverBase) {
            const discovered = await window.devtoolsBridgeToken.discoverBase(base, token, { kind: "unified" });
            if (discovered?.base) base = String(discovered.base).replace(/\/$/, "");
          }
        } catch (_) {}
        const candidates = [
          { base, prefix: "/ff" },
          { base: "http://127.0.0.1:17888", prefix: "/ff" },
          { base: "http://127.0.0.1:17889", prefix: "" },
        ];
        for (const c of candidates) {
          try {
            // auto=1：缺 gifski 时自动下载到桥解压目录 vendor/gifski/
            const res = await fetch(`${c.base}${c.prefix}/gifski/status?auto=1`, {
              method: "GET",
              headers: nativeGifskiHeaders(),
              cache: "no-store",
              mode: "cors",
            });
            if (!res.ok) continue;
            const data = await res.json();
            if (data?.nativeEncode || data?.ok) {
              // 仍无 gifski 二进制时，再显式装一次（可带用户记住的解压目录）
              if (!data?.gifski?.available && data?.canInstall) {
                try {
                  let installDir = "";
                  try {
                    installDir = String(localStorage.getItem("devtools-bridge-install-dir") || "").trim();
                  } catch (_) {}
                  await fetch(`${c.base}${c.prefix}/gifski/install`, {
                    method: "POST",
                    headers: {
                      ...nativeGifskiHeaders(),
                      "Content-Type": "application/json",
                    },
                    body: JSON.stringify(installDir ? { dir: installDir } : {}),
                    mode: "cors",
                  });
                  const res2 = await fetch(`${c.base}${c.prefix}/gifski/status`, {
                    method: "GET",
                    headers: nativeGifskiHeaders(),
                    cache: "no-store",
                    mode: "cors",
                  });
                  const data2 = res2.ok ? await res2.json() : data;
                  nativeGifskiProbe = {
                    at: Date.now(),
                    ok: Boolean(data2.nativeEncode),
                    base: c.base,
                    prefix: c.prefix,
                    engine: data2.engine || "",
                    gifski: Boolean(data2.gifski?.available),
                    installDir: data2.installDir || "",
                  };
                  return nativeGifskiProbe;
                } catch (_) {}
              }
              nativeGifskiProbe = {
                at: now,
                ok: Boolean(data.nativeEncode),
                base: c.base,
                prefix: c.prefix,
                engine: data.engine || "",
                gifski: Boolean(data.gifski?.available),
                installDir: data.installDir || "",
              };
              return nativeGifskiProbe;
            }
          } catch (_) {}
        }
        nativeGifskiProbe = { at: now, ok: false, base: "", prefix: "/ff", engine: "" };
        return nativeGifskiProbe;
      }

      /** 同一源文件复用上传会话，黑盒多档试探不重复传片 */
      const nativeGifskiSessions = new Map();
      function nativeSessionKey(file) {
        if (!file) return "";
        return `${file.name || ""}|${file.size || 0}|${file.lastModified || 0}`;
      }
      async function ensureNativeGifskiSession(file, probe) {
        const key = nativeSessionKey(file);
        const hit = nativeGifskiSessions.get(key);
        if (hit && hit.sessionId && Date.now() - hit.at < 40 * 60 * 1000) {
          hit.at = Date.now();
          return hit.sessionId;
        }
        const url = `${probe.base}${probe.prefix}/gifski/session`;
        const res = await fetch(url, {
          method: "POST",
          headers: nativeGifskiHeaders({
            "X-Filename": encodeURIComponent(file.name || "video.bin"),
            "Content-Type": "application/octet-stream",
          }),
          body: file,
          mode: "cors",
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.sessionId) {
          throw new Error(data?.error || `原生会话失败 HTTP ${res.status}`);
        }
        nativeGifskiSessions.set(key, { sessionId: data.sessionId, at: Date.now(), base: probe.base, prefix: probe.prefix });
        return data.sessionId;
      }

      /**
       * 统一桥 /ff/gifski：本机多线程原生编码（有 gifski 用 gifski，否则 ffmpeg palette）。
       * 失败返回 null，由上层回退 wasm。
       */
      async function encodeV2gGifNative(opts) {
        const file = opts.file || v2gSourceFile;
        if (!file) return null;
        // 需要水印时不走原生（桥路径未烧水印）
        if (!opts.skipWatermark && !opts.forceNative) return null;
        const probe = await probeNativeGifski();
        if (!probe.ok) return null;
        const tPhase = performance.now();
        const fpsCap = opts.allowWide ? V2G_MANUAL_MAX_FPS : Math.max(15, Number(currentMediaPerf().manualFpsCap) || 15);
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
        const bright = opts.skipBright
          ? 0
          : Number.isFinite(opts.brightness)
            ? Number(opts.brightness)
            : readV2gBrightness();
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
        const frameCount = Math.max(2, Math.round(effSpan * fps));
        const srcW = Number(opts.srcW) || v2gVideo?.videoWidth || 0;
        const srcH = Number(opts.srcH) || v2gVideo?.videoHeight || 0;
        const crop = normalizeV2gCrop(opts.crop, srcW, srcH);
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
        mapProgress(0.08, `${stageLabel}连接本机原生编码器…`);
        const sessionId = await ensureNativeGifskiSession(file, probe);
        if (aborted()) throw new Error("已取消");
        mapProgress(0.22, `${stageLabel}本机编码 GIF（多线程）…`);
        const q = new URLSearchParams();
        q.set("sessionId", sessionId);
        q.set("fps", String(fps));
        q.set("width", String(outW));
        q.set("quality", String(gifskiQuality));
        q.set("startSec", String(startSec));
        q.set("span", String(span));
        q.set("speed", String(speed));
        if (Math.abs(bright) >= 0.01) q.set("brightness", String(bright));
        if (crop) q.set("crop", JSON.stringify({ w: crop.w, h: crop.h, x: crop.x, y: crop.y }));
        if (Number(opts.lossy) > 0 && gifskiQuality < 90) {
          q.set("lossy", String(Math.round(Number(opts.lossy))));
        }
        const cores = Math.max(2, Math.min(16, Number(navigator.hardwareConcurrency) || 8));
        q.set("threads", String(cores));
        const encUrl = `${probe.base}${probe.prefix}/gifski/encode?${q.toString()}`;
        const res = await fetch(encUrl, {
          method: "POST",
          headers: nativeGifskiHeaders(),
          mode: "cors",
        });
        if (aborted()) throw new Error("已取消");
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          let msg = `原生编码 HTTP ${res.status}`;
          try {
            msg = JSON.parse(errText)?.error || msg;
          } catch (_) {
            if (errText) msg = errText.slice(0, 200);
          }
          throw new Error(msg);
        }
        const buf = await res.arrayBuffer();
        const blob = new Blob([buf], { type: "image/gif" });
        if (!blob.size) throw new Error("原生编码未产出 GIF");
        const engine = res.headers.get("X-Gifski-Engine") || probe.engine || "gifski-native";
        mapProgress(0.99, `${stageLabel}完成`);
        vbbLog(
          `[vbb-phase] 原生${engine} ${Math.round(performance.now() - tPhase)}ms · ${fps}fps 宽${outW} ${formatKb(blob.size)} q=${gifskiQuality}`
        );
        return {
          blob,
          frameCount,
          span: effSpan,
          fps,
          playbackFps: gifEffectivePlaybackFps(fps),
          speed,
          outW,
          outH,
          framesCapped: false,
          quality,
          maxW,
          maxColors: 0,
          engine: engine.indexOf("gifski") >= 0 ? "gifski" : "ffmpeg",
          gifskiQuality,
          watermark: false,
          brightness: bright,
          native: true,
          multithreaded: res.headers.get("X-Gifski-Multithreaded") === "1",
        };
      }

      /**
       * 源是否允许冲高帧：未知或源 ≥ 目标即可。
       * 抽帧走 ffmpeg `fps=`；但 25→20 / 25→15 会不规则抽帧，候选列表已避开。
       */
      function blackboxSrcAllowsHighFps(srcFps, targetFps = V2G_BLACKBOX_HIGH_FPS) {
        const src = Number(srcFps) || 0;
        const t = Number(targetFps) || V2G_BLACKBOX_HIGH_FPS;
        if (src <= 0) return true;
        return src + 0.5 >= t;
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
        const fpsCap = opts.allowWide ? V2G_MANUAL_MAX_FPS : Math.max(15, Number(currentMediaPerf().manualFpsCap) || 15);
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
        // 半开区间 [start, end)：不 +1，避免片尾比编辑拖到的位置多出几帧
        const frameCount = Math.max(2, Math.round(effSpan * fps));
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
        const wasmSafeMax = Math.max(
          80,
          Math.min(
            V2G_GIFSKI_WASM_MAX_FRAMES,
            gifskiMaxFrames(),
            Math.max(1, Math.floor((384 * 1024 * 1024) / Math.max(1, perFrameBytes * 3)))
          )
        );
        if (forcedChunks >= 1) {
          chunkMax = Math.max(1, Math.ceil(frameCount / Math.min(forcedChunks, frameCount)));
          chunkCount = Math.ceil(frameCount / chunkMax);
        } else if (preferSingle) {
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
          const budgetFrames = Math.max(1, Math.floor(gifskiRawBudget() / perFrameBytes));
          chunkMax = Math.max(1, Math.min(gifskiMaxFrames(), budgetFrames));
          chunkCount = Math.ceil(frameCount / chunkMax);
        }
        // wasm 路径：即使用户选 1 块，超安全帧数也强制切开（502 类 700 帧会 OOM）
        if (chunkMax > wasmSafeMax && frameCount > wasmSafeMax) {
          chunkMax = wasmSafeMax;
          chunkCount = Math.ceil(frameCount / chunkMax);
          vbbLog(`[vbb-phase] wasm 强制分块 ${chunkCount}×${chunkMax} 帧（防 OOM，原单段 ${frameCount}）`);
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
            const cutDur = span;
            const cutArgs =
              startSec > 0.05
                ? [
                    "-i",
                    inName,
                    "-ss",
                    String(startSec),
                    "-t",
                    String(cutDur),
                    "-an",
                    "-c:v",
                    "libx264",
                    "-preset",
                    "ultrafast",
                    "-crf",
                    "18",
                    "-pix_fmt",
                    "yuv420p",
                    "-movflags",
                    "+faststart",
                    "-y",
                    segName,
                  ]
                : [
                    "-i",
                    inName,
                    "-ss",
                    String(startSec),
                    "-t",
                    String(cutDur),
                    "-c",
                    "copy",
                    "-avoid_negative_ts",
                    "make_zero",
                    "-movflags",
                    "+faststart",
                    "-y",
                    segName,
                  ];
            const cutCode = await ffmpeg.exec(cutArgs);
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
          const speedFilter = speed > 1 ? `setpts=(PTS-STARTPTS)/${speed},` : "setpts=PTS-STARTPTS,";
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
            const absEnd = encodeSs + encodeT;
            // 钳到片尾，不再 +半帧，避免末段把编辑黄柄后的画面带进 GIF
            const need = (chunkFrames / fps) * speed;
            const dur = Math.max(1 / Math.max(8, fps), Math.min(need, Math.max(0, absEnd - ss)));
            // -ss 在 -i 后：与编辑器片头对齐，避免关键帧往前多取
            const baseArgs = ["-i", encodeInput];
            if (ss > 0.001) baseArgs.push("-ss", String(ss));
            baseArgs.push("-t", String(dur));
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
            // ≥18fps 一律均匀 delay；短片（≤16s）即使 15/12 也不合并，优先跟手不卡。
            let encodedFrames = n;
            let durations = null;
            const effSpanForMerge =
              Math.max(0.05, Number(opts.span) || 0) / Math.max(1, Number(opts.speed) || 1);
            const allowStillMerge =
              fps < 18 - 0.01 && effSpanForMerge > V2G_BLACKBOX_HIGH_PRIMARY_SPAN_SEC + 0.01;
            if (allowStillMerge) {
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
            // gifski.encode 是同步 wasm：先让出一帧给滚动，再编码
            await yieldToUi();
            if (aborted()) throw new Error("已取消");
            const fpsInt = Math.max(1, Math.round(fps));
            const canPassFps = gifskiWasmDurationsAreUniform(durations) && Math.abs(fps - fpsInt) < 0.01;
            const wasmDurations = canPassFps ? undefined : durationsForGifskiWasmPts(durations);
            const gifBytes = await withGifskiEncodeLock(() =>
              mod.encode(
                mergedView,
                encodedFrames,
                outW,
                outH,
                canPassFps ? fpsInt : undefined,
                wasmDurations,
                gifskiQuality
              )
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
              await yieldToUi();
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
       * 黑盒 GIF 编码入口：桥上原生 gifski（多线程）→ wasm gifski → ffmpeg palette。
       * 取消不算失败，直接抛出（不触发回退）。
       * 需要水印时跳过原生（桥路径暂不烧水印），走 wasm。
       */
      const VBB_RUN_KEY = "devtools-vbb-running";
      async function encodeBlackboxGif(opts) {
        // 处理中途被系统杀掉（OOM）时该标记会留下 → 下次进面板自动调大分块数
        try { localStorage.setItem(VBB_RUN_KEY, "1"); } catch (_) {}
        try {
          if (opts && opts.forceFfmpeg) return await encodeV2gGifFfmpeg(opts);
          const forceWasm =
            Boolean(opts && opts.forceWasm) ||
            (typeof window !== "undefined" && Boolean(window.__VBB_FORCE_WASM));
          if (forceWasm) {
            try {
              return await encodeV2gGifGifski(opts);
            } catch (err) {
              if (String(err && err.message) === "已取消") throw err;
              vbbLog(`[vbb] gifski wasm 不可用，回退 ffmpeg：${err && err.message ? err.message : err}`);
              return await encodeV2gGifFfmpeg(opts);
            }
          }
          // 原生桥：黑盒默认 skipWatermark，可走本机多线程；需水印则跳过
          if (opts?.forceNative || opts?.skipWatermark) {
            try {
              const native = await encodeV2gGifNative(opts);
              if (native) return native;
            } catch (err) {
              if (String(err && err.message) === "已取消") throw err;
              vbbLog(`[vbb] 原生 gifski 跳过：${err && err.message ? err.message : err}`);
            }
          }
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
       * 主试帧率：一律先最高整除档；时长只影响余量加宽，不再提前锁低帧。
       */
      function blackboxPrimaryFps(span, srcFps) {
        void span;
        const cands = blackboxFpsCandidates(srcFps);
        return cands[0] || V2G_BLACKBOX_RETRY_MIN_FPS;
      }

      function blackboxKeepQualityUntilFloor(span, qualityFirst) {
        if (qualityFirst) return true;
        return (Number(span) || 0) <= V2G_BLACKBOX_KEEP_Q_MAX_SPAN_SEC + 0.01;
      }
      function blackboxShouldSkipFineQi(qi, lastOverRatio) {
        const i = Number(qi);
        if (i !== 1 && i !== 2) return false;
        return (Number(lastOverRatio) || 0) > V2G_BLACKBOX_FINE_NEAR_BUDGET;
      }
      function blackboxEstSizeAtWidth(size, fromW, toW) {
        const a = Math.max(1, Number(fromW) || 1);
        const b = Math.max(1, Number(toW) || 1);
        return (Number(size) || 0) * ((b * b) / (a * a));
      }
      function blackboxShouldSkipNarrowerWidth(lastSize, lastW, nextW, budget) {
        const est = blackboxEstSizeAtWidth(lastSize, lastW, nextW);
        return est > (Number(budget) || 0) * V2G_BLACKBOX_AREA_SKIP_SLACK;
      }
      function blackboxShouldSkipHighFpsByDuration(fps, span, srcFps) {
        const f = Number(fps) || 0;
        const s = Number(span) || 0;
        if (Math.abs(f - 15) < 0.2) return false;
        if (blackboxIsFloorFps(f, srcFps, 0)) return false;
        if (!(s > 0) || !(f > 0)) return false;
        return s * f > V2G_BLACKBOX_HIGH_FPS_FRAME_SKIP + 0.01;
      }
      function blackboxShouldSkipFpsByCal(fps, calFps, calSize, budget, srcFps) {
        const f = Number(fps) || 0;
        if (Math.abs(f - 15) < 0.2) return false;
        if (blackboxIsFloorFps(f, srcFps, 0)) return false;
        const cf = Math.max(0.01, Number(calFps) || 0);
        const estQ8 = (((Number(calSize) || 0) * f) / cf) * 0.9;
        return estQ8 > (Number(budget) || 0) * 1.08;
      }

      /**
       * 黑盒帧率阶梯：按片源选档，15 必含。
       * - ≈24fps 电影：24 → 15 → 12（15 必试，不从 24 直接跳 12）
       * - ≈25fps 屏录：25 → 15 → 12.5
       * - ≈30fps：30 → 15 → 12
       * - 其它：20 → 15 → 12
       * 硬约束单测：tools/lib/vbb-blackbox-fps.js + vbb-blackbox-fps.test.js（改这里必须同步）
       */
      function blackboxFpsCandidates(srcFps) {
        const src = Number(srcFps) || 0;
        // 电影 23.976/24：24→15→12（勿落到 20；15 必试）
        if (src >= 23.5 && src < 24.5) return [24, 15, 12];
        if (src >= 24.5 && src <= 25.8) return [25, 15, 12.5];
        if (src >= 29.2 && src <= 30.8) return [30, 15, 12];
        return V2G_BLACKBOX_FPS_LIST.slice();
      }

      /** 用户常处理电影片段：摄影/渐变内容对 gifsicle lossy 更敏感（体积可省约 40%） */
      function blackboxIsMovieLike(srcFps) {
        const src = Number(srcFps) || 0;
        if (!(src > 0)) return true;
        if (src >= 23.5 && src < 24.5) return true;
        if (src >= 29.2 && src <= 30.8) return true;
        if (src >= 47 && src <= 60.5) return true;
        if (src >= 24.5 && src <= 25.8) return false; // 典型屏录/PAL
        return true;
      }

      /** 帧率底线：候选最低档（通常 12 / 12.5） */
      function blackboxFpsFloor(_span, srcFps) {
        const cands = blackboxFpsCandidates(srcFps);
        const last = cands[cands.length - 1];
        return last > 0 ? last : V2G_BLACKBOX_RETRY_MIN_FPS;
      }

      /** 15 是中档必试，不是底档。底档只有候选末档 12 / 12.5。 */
      function blackboxIsFloorFps(fps, srcFps, span) {
        const f = Number(fps) || 0;
        if (!(f > 0)) return false;
        if (Math.abs(f - 15) < 0.2) return false;
        return f <= blackboxFpsFloor(span, srcFps) + 0.01;
      }

      /** 主试列表：整除档从高到低（不再按时长砍掉高档） */
      function resolveBlackboxFpsList(span, srcFps) {
        const cands = blackboxFpsCandidates(srcFps);
        return cands.length ? cands.slice() : [blackboxFpsFloor(span, srcFps)];
      }

      /**
       * 余量提帧候选（finish 加宽之后）：只提到片源整除档。
       * - ≈30s（>MID）：优先抬到中档（15 / 对 25 源则无更高）
       * - ≤20s 档：预算松、宽够 → 冲高档（20/25/30）
       */
      function blackboxRaiseFpsCandidates(span, srcFps, width, curSize, speed = 1) {
        const s = Number(span) || 0;
        const w = Number(width) || 0;
        const src = Number(srcFps) || 0;
        const size = Number(curSize) || 0;
        void speed;
        const list = [];
        const cands = blackboxFpsCandidates(srcFps);
        if (s > V2G_BLACKBOX_MID_SPAN_SEC + 0.01) {
          if (cands.length >= 2) list.push(cands[1]);
          return list;
        }
        const high = cands[0];
        if (
          s > 0.05 &&
          s <= V2G_BLACKBOX_HIGH_FPS_MAX_SPAN + 0.01 &&
          w >= V2G_BLACKBOX_HIGH_FPS_MIN_W - 0.5 &&
          blackboxSrcAllowsHighFps(src, high) &&
          size > 0 &&
          size < V2G_BLACKBOX_MAX_BYTES * 0.88
        ) {
          list.push(high);
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
          const movieLike = true; // 黑盒成片默认摄影友好：勿早 --colors
          const isBest = blackboxQualityIsBest(candidate);
          const plan = isBest
            ? buildBlackboxSoftCompressArgs(1, { movie: movieLike })
            : isLastTier
              ? buildBlackboxHardCompressArgs(round, { movie: movieLike })
              : buildBlackboxSoftCompressArgs(round, { movie: movieLike });
          if (isBest && round > 1) break;
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
      const VBB_SPAN_SCHEME_VER = 6;

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

        // 不再「电影lossy 腾预算」：gifsicle --lossy 会合并调色板（摄影片色数可从数百掉到 <100），
        // 而随后加宽是干净重编，吃不到 lossy 省下的体积；加宽失败时却留下崩色成片（601：画质92 标签 + 泥色）。
        // 加宽试探一律基于 O3 成片；超预算时由 blackboxAcceptBoostIfFits / 硬闸再压。

        // O3 常再瘦一点：已在上限内且仍 <99% 时再加宽；短片直接探到源宽吃满，长片仍限约 1.5×
        try {
          if (
            result.blob.size <= V2G_BLACKBOX_MAX_BYTES &&
            result.blob.size < V2G_BLACKBOX_MAX_BYTES * 0.99 &&
            !clipOpts.isAborted?.()
          ) {
          const srcW = Number(clipOpts.srcW) || 0;
          const hardMax = Math.min(srcW > 0 ? srcW : V2G_ENCODE_HARD_W, V2G_ENCODE_HARD_W);
          let curW = Math.max(64, Number(result.maxW) || Number(result.outW) || V2G_BLACKBOX_BASE_W);
          const fps = Number(result.fps) || 15;
          // 必须沿用核心阶段的加速倍率：clipOpts 只有 speedLimitSec，直接展开会丢掉 speed → 缩时长失效
          const speed = Math.max(1, Number(result.speed) || 1);
          const effSpan = Math.max(0.05, Number(clipOpts.span) || 0) / speed;
          const isShortFill = effSpan <= V2G_BLACKBOX_SHORT_SPAN_SEC + 0.01;
          let quality = blackboxLadderQuality(result);
          let gifskiQuality = Number.isFinite(Number(result.gifskiQuality))
            ? Number(result.gifskiQuality)
            : undefined;
          // 补回可能丢失的 ladder 档，避免后续门闩误判
          if (!(Number(result.quality) >= 1)) {
            result = { ...result, quality };
          }
          const onProgress = clipOpts.onProgress || (() => {});
          const comfortO3 = Math.min(hardMax, V2G_BLACKBOX_COMFORT_W);
          // finish 已抬过；O3 后再连抬是重复白跑。手机禁用；桌面仅在仍有余量且未到顶时试一档
          if (
            !isCoarsePointer() &&
            !result.boostHitCeiling &&
            quality > V2G_BLACKBOX_QUALITY + 0.01 &&
            result.blob.size <= V2G_BLACKBOX_MAX_BYTES * 0.88
          ) {
            const at = V2G_BLACKBOX_QUALITY_LADDER.indexOf(quality);
            const targetW = Math.max(curW, comfortO3);
            for (let qi = Math.max(0, at - 1); qi >= 0; qi--) {
              if (clipOpts.isAborted?.()) break;
              const q = V2G_BLACKBOX_QUALITY_LADDER[qi];
              onProgress(0.97, `O3后抬画质 · q${q}·宽${targetW}`);
              vbbLog(`[vbb-phase] O3后抬画质 q${quality}→q${q} 宽${targetW}`);
              const enc = await encodeBlackboxGif({
                ...clipOpts,
                fps,
                maxW: targetW,
                quality: q,
                speed,
                stageLabel: `${fps}FPS·宽${targetW}·q${q}`,
                onProgress: (local, text) => onProgress(0.97 + local * 0.02, text),
              });
              if (!enc?.blob) break;
              let cand = {
                ...enc,
                compressRounds: result.compressRounds || 0,
                maxW: targetW,
                srcFps: result.srcFps,
                quality: q,
              };
              if (cand.blob.size > V2G_BLACKBOX_MAX_BYTES) {
                const fitted = await blackboxAcceptBoostIfFits(cand, {
                  onProgress,
                  isAborted: clipOpts.isAborted,
                  curSize: result.blob.size,
                });
                if (!fitted) break;
                cand = fitted;
              }
              result = cand;
              curW = targetW;
              quality = q;
              gifskiQuality = Number.isFinite(Number(cand.gifskiQuality))
                ? Number(cand.gifskiQuality)
                : undefined;
            }
          }
          const canWidenO3 = blackboxQualityIsBest(result);
          if (!canWidenO3) {
            vbbLog(
              `[vbb-phase] O3后跳过加宽：画质档 q${quality}（gq${gifskiQuality || "?"}）未满，先保清晰（宽${curW}）`
            );
          } else if (curW < hardMax - 2) {
          const widenMax = isShortFill
            ? hardMax
            : Math.min(
                hardMax,
                Math.max(curW + V2G_BLACKBOX_WIDTH_STEP, Math.round(curW * 1.5))
              );
          let best = result;
          let lo = curW;
          let hiW = widenMax;
          const capBytes = Math.round(V2G_BLACKBOX_MAX_BYTES * 0.99);
          const baseProbes = Math.max(1, Number(currentMediaPerf().widenProbes) || 2);
          const coarsePhone = isCoarsePointer();
          // 手机单路：加宽探次压到 ≤2，把时间留给当前这一次编码
          const maxProbes = coarsePhone
            ? Math.max(1, Math.min(2, baseProbes))
            : isShortFill
              ? Math.max(3, Math.min(6, baseProbes + 2))
              : Math.max(1, Math.min(3, baseProbes));
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
            if (enc?.blob && enc.blob.size <= V2G_BLACKBOX_MAX_BYTES) {
              best = { ...enc, compressRounds: 0, maxW: w, speed };
              lo = w;
              if (best.outW > 0 && best.outW < w - 2) break;
              if (best.blob.size >= capBytes) break;
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

        // 1) gifsicle 硬压（含缩放档）；默认摄影友好（晚减色），避免画质标签高但调色板崩
        if (typeof compressExistingGifToBlackbox === "function") {
          onProgress(0.97, `硬闸压缩到 ${blackboxBudgetLabel()}…`);
          try {
            const c = await compressExistingGifToBlackbox(
              best.blob,
              (ratio, text) => onProgress(0.97 + Math.min(0.01, (ratio || 0) * 0.01), text || "硬闸压缩"),
              isAborted,
              {
                movie: blackboxIsMovieLike(Number(best.srcFps) || Number(clipOpts?.srcFps) || 0),
                qualityBest: blackboxQualityIsBest(best),
                mode: blackboxQualityIsBest(best) ? "o3" : "hard",
              }
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
                isAborted,
                {
                  movie: blackboxIsMovieLike(Number(best.srcFps) || Number(clipOpts?.srcFps) || 0),
                  qualityBest: blackboxQualityIsBest(cand),
                  mode: blackboxQualityIsBest(cand) ? "o3" : "hard",
                }
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
        const qualityFirst = !!(clipOpts && clipOpts.qualityFirst);
        const isAborted = clipOpts.isAborted || (() => abortV2g);
        const onProgress = clipOpts.onProgress || (() => {});
        // 并行探测源帧率（不挡引擎加载；最多等 1.5s，超时就用默认档位）
        const srcFpsProbe = detectSourceFps(file).catch(() => 0);
        const srcFps = await Promise.race([
          srcFpsProbe,
          new Promise((r) => setTimeout(() => r(0), 1500)),
        ]);
        // 整除档从高到低：先最高帧，超限再按宽/画质让渡后降帧
        let fpsList = resolveBlackboxFpsList(span / speed, srcFps);
        let fpsCapDbg = 0;
        try {
          if (VBB_DEBUG) {
            fpsCapDbg = Number(localStorage.getItem("devtools-vbb-fps-cap")) || 0;
            if (fpsCapDbg > 0) {
              const next = fpsList.filter((f) => Number(f) <= fpsCapDbg + 0.01);
              if (next.length) fpsList = next;
              vbbLog(`[vbb-phase] debug fps cap=${fpsCapDbg} → ${JSON.stringify(fpsList)}`);
            }
          }
        } catch (_) {}
        {
          const floorFps = blackboxFpsFloor(span / speed, srcFps);
          if (!fpsList.some((f) => Number(f) <= floorFps + 0.01)) {
            fpsList = fpsList.concat(floorFps);
            vbbLog(`[vbb-phase] 补回帧率底档 ${floorFps}（15 不是底档）`);
          }
        }
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
          // 冲高档（≥20，含 25/30）时要求宽仍 ≥420：宁可留在中档+更宽，也不为高帧掉到糊字区
          if (f >= 18 - 0.01 && width < V2G_BLACKBOX_HIGH_FPS_MIN_W - 0.5) {
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
          const startW = Number(best.maxW) || Number(best.outW) || 0;
          const hardMaxN = Number(hardMax) || startW;
          // 仅「已贴 ~99%」或「已到加宽上限」才早退；旧 95% 门槛会让短片卡在 420 不吃满
          if (best.blob.size >= V2G_BLACKBOX_MAX_BYTES * 0.99) return best;
          if (
            best.blob.size >= V2G_BLACKBOX_MAX_BYTES * 0.95 &&
            startW >= V2G_BLACKBOX_BASE_W - 0.5 &&
            startW >= hardMaxN - 2
          ) {
            return best;
          }
          let cur = {
            ...best,
            quality: blackboxLadderQuality(best),
          };
          let fpsNow = Number(cur.fps) || curFps;
          const effSpan = span / speed;
          const isLong = effSpan > V2G_BLACKBOX_MID_SPAN_SEC + 0.01;
          // ≤24s：预算优先换成宽度（吃满上限）；更长仍限 2× 控探测成本
          const isShortFill = !isLong;
          const atCap = () =>
            (srcW > 0 && cur.outW >= srcW - 2) || (Number(cur.maxW) || 0) >= Number(hardMax) - 2;
          const widthOkForRaise = () => {
            const w = Number(cur.maxW) || V2G_BLACKBOX_BASE_W;
            return w >= V2G_BLACKBOX_HIGH_FPS_MIN_W - 0.5 || atCap();
          };
          const resolveWidenMax = () => {
            const curMaxW = Number(cur.maxW) || V2G_BLACKBOX_BASE_W;
            if (isShortFill) return Math.max(curMaxW, Number(hardMax) || curMaxW);
            return Math.min(
              Number(hardMax) || curMaxW,
              Math.max(V2G_BLACKBOX_BASE_W, Math.round(curMaxW * 2))
            );
          };
          // 加宽必须沿用当前画质档，否则 q65 入选后会用 q92 重探导致全失败白跑
          const encodeKeepQ = (f, w) =>
            encodeAtWidthFps(
              f,
              w,
              blackboxLadderQuality(cur),
              Number.isFinite(Number(cur.gifskiQuality)) ? Number(cur.gifskiQuality) : undefined
            );
          /** 有余量先抬画质到满档（同宽），禁止「宽一点但糊」。失败即停，避免连抬白跑。 */
          let boostHitCeiling = Boolean(best.boostHitCeiling);
          const boostQualityPass = async () => {
            const qNow = blackboxLadderQuality(cur);
            if (!(qNow > V2G_BLACKBOX_QUALITY + 0.01)) return;
            if (boostHitCeiling) return;
            if (cur.blob.size >= V2G_BLACKBOX_MAX_BYTES * 0.92) {
              vbbLog(`[vbb-phase] 加速：已用≥92%预算 → 停抬质（保流畅档/420）`);
              boostHitCeiling = true;
              return;
            }
            const coarse = isCoarsePointer();
            if (coarse && cur.blob.size >= V2G_BLACKBOX_MAX_BYTES * 0.88) {
              vbbLog(`[vbb-phase] 手机加速：已用≥88%预算 → 跳过抬质`);
              boostHitCeiling = true;
              return;
            }
            const w = Number(cur.maxW) || V2G_BLACKBOX_COMFORT_W;
            const at = V2G_BLACKBOX_QUALITY_LADDER.indexOf(qNow);
            const startQi = at > 0 ? at - 1 : -1;
            const qiMin = coarse ? startQi : 0;
            for (let qi = startQi; qi >= qiMin; qi--) {
              if (isAborted()) throw new Error("已取消");
              const q = V2G_BLACKBOX_QUALITY_LADDER[qi];
              onProgress(0.94, `余量抬画质 · q${q}`);
              vbbLog(
                `[vbb-phase] 余量抬画质 q${qNow}→q${q} 宽${w} ${formatKb(cur.blob.size)}`
              );
              const enc = await encodeAtWidthFps(fpsNow, w, q);
              if (!enc?.blob) break;
              let cand = { ...enc, compressRounds: 0, maxW: w, quality: q };
              if (cand.blob.size > V2G_BLACKBOX_MAX_BYTES) {
                const fitted = await blackboxAcceptBoostIfFits(cand, {
                  onProgress,
                  isAborted,
                  curSize: cur.blob.size,
                });
                if (!fitted) {
                  boostHitCeiling = true;
                  // 半档仅在仍有明显余量时试一次；已近满则停（保当前流畅+已抬清晰）
                  if (coarse || cur.blob.size >= V2G_BLACKBOX_MAX_BYTES * 0.82) {
                    vbbLog(
                      `[vbb-phase] 加速：上一档未进预算 → 停抬质（沿用 q${blackboxLadderQuality(
                        cur
                      )}/gq${Number(cur.gifskiQuality) || "?"}）`
                    );
                    break;
                  }
                  const curGq = Number(cur.gifskiQuality) || 0;
                  const nextGq =
                    Number(enc.gifskiQuality) ||
                    (typeof gifQualityToGifskiQuality === "function"
                      ? gifQualityToGifskiQuality(q)
                      : 0);
                  const midGq =
                    curGq > 0 && nextGq > curGq + 3
                      ? Math.round((curGq + nextGq) / 2)
                      : 0;
                  if (!(midGq > curGq)) break;
                  vbbLog(
                    `[vbb-phase] 余量抬画质半档 gq${curGq}→${midGq} 宽${w}`
                  );
                  const midEnc = await encodeAtWidthFps(fpsNow, w, q, midGq);
                  if (!midEnc?.blob) break;
                  let midCand = {
                    ...midEnc,
                    compressRounds: 0,
                    maxW: w,
                    quality: q,
                    gifskiQuality: midGq,
                  };
                  if (midCand.blob.size > V2G_BLACKBOX_MAX_BYTES) {
                    const midFit = await blackboxAcceptBoostIfFits(midCand, {
                      onProgress,
                      isAborted,
                      curSize: cur.blob.size,
                    });
                    if (!midFit) break;
                    midCand = midFit;
                  }
                  cur = midCand;
                  break;
                }
                cand = fitted;
              }
              cur = cand;
              if (coarse) break;
            }
          };
          const qualityIsBest = () => blackboxQualityIsBest(cur);
          const widenPass = async (label) => {
            // 画质未满档时不加宽：预算优先换清晰度，不换「更宽但更糊」
            if (!qualityIsBest()) {
              vbbLog(
                `[vbb-phase] 跳过加宽：画质档 q${blackboxLadderQuality(cur)}（gq${
                  Number(cur.gifskiQuality) || "?"
                }）未满，先保清晰`
              );
              return;
            }
            // 目标贴 ~99%；未到加宽上限时勿因 95% 停探
            if (atCap() || cur.blob.size >= V2G_BLACKBOX_MAX_BYTES * 0.99) return;
            onProgress(0.95, label);
            const widenMax = resolveWidenMax();
            const wider = await blackboxWidenBest(cur, (w) => encodeKeepQ(fpsNow, w), {
              minW: Math.max(64, Number(cur.maxW) || V2G_BLACKBOX_BASE_W),
              maxW: widenMax,
            });
            if (wider?.blob?.size) cur = wider;
          };
          // ≈30s：很松时先抬到 15，再加宽（避免 12@很宽占满预算后抬不动帧）
          if (isLong && cur.blob.size < V2G_BLACKBOX_MAX_BYTES * 0.75 && fpsNow < 15 - 0.01) {
            const srcFpsEarly = await detectSourceFps(file).catch(() => 0);
            const raised = await raiseBlackboxFps(cur, fpsNow, encodeKeepQ, srcFpsEarly, effSpan, {
              maxFps: fpsCapDbg > 0 ? Math.min(15, fpsCapDbg) : 15,
            });
            if (raised?.blob) {
              cur = raised;
              fpsNow = Number(cur.fps) || fpsNow;
            }
          }
          if (
            cur.blob.size >= V2G_BLACKBOX_MAX_BYTES * 0.99 ||
            (cur.blob.size >= V2G_BLACKBOX_MAX_BYTES * 0.95 && atCap() && (Number(cur.maxW) || 0) >= V2G_BLACKBOX_BASE_W - 0.5)
          ) {
            return cur;
          }
          // 小于规则：先抬画质（同宽保流畅），满档才加宽
          await boostQualityPass();
          if (!isCoarsePointer()) {
            const wBefore = Number(cur.maxW) || 0;
            await widenPass(isShortFill ? "短片有余 · 加宽吃满预算" : "体积有余 · 自动增宽");
            const widened = (Number(cur.maxW) || 0) > wBefore + 2;
            if (widened && !boostHitCeiling && qualityIsBest()) {
              await boostQualityPass();
            } else if (!widened) {
              vbbLog(`[vbb-phase] 加速：未加宽/抬质已到顶 → 跳过第二轮抬质`);
            }
          } else {
            vbbLog(`[vbb-phase] 手机加速：跳过加宽/第二轮抬质（单路稳妥）`);
          }
          if (
            cur.blob.size >= V2G_BLACKBOX_MAX_BYTES * 0.99 ||
            (cur.blob.size >= V2G_BLACKBOX_MAX_BYTES * 0.95 && atCap() && (Number(cur.maxW) || 0) >= V2G_BLACKBOX_BASE_W - 0.5)
          ) {
            return { ...cur, boostHitCeiling };
          }
          // 加宽后再提帧（短片源可整除才冲 20；长片抬 15）
          if (widthOkForRaise() && qualityIsBest() && cur.blob.size < V2G_BLACKBOX_MAX_BYTES * 0.99) {
            const srcFpsNow = await detectSourceFps(file).catch(() => 0);
            cur = await raiseBlackboxFps(
              cur,
              Number(cur.fps) || fpsNow,
              encodeKeepQ,
              srcFpsNow,
              effSpan,
              fpsCapDbg > 0 ? { maxFps: fpsCapDbg } : undefined
            );
            fpsNow = Number(cur.fps) || fpsNow;
          }
          // 短片提帧后若又腾出预算（或提帧未动），再加宽一轮吃满（手机跳过：少一次完整编码）
          if (
            isShortFill &&
            !isCoarsePointer() &&
            qualityIsBest() &&
            cur.blob.size < V2G_BLACKBOX_MAX_BYTES * 0.99
          ) {
            await widenPass("短片有余 · 再加宽吃满");
          }
          // 可读宽优先：已接近贴满但宽 <420（录屏字偏糊）→ 降到下一档整除帧率换宽度
          // 例外：已是中档及以上（≥15，或 25 源的 12.5）且 ≤24s 时，不继续降帧换宽
          {
            const curMaxW = Number(cur.maxW) || V2G_BLACKBOX_BASE_W;
            const readableMin = V2G_BLACKBOX_BASE_W;
            const fpsCands = blackboxFpsCandidates(srcFps);
            const midKeepFluent =
              effSpan <= V2G_BLACKBOX_MID_SPAN_SEC + 0.01 &&
              fpsNow >= (fpsCands.length >= 2 ? fpsCands[1] : 15) - 0.01;
            const keepQ = V2G_BLACKBOX_QUALITY_LADDER[blackboxKeepQualityMaxQi()] || 8;
            const qualityStillKeep = blackboxLadderQuality(cur) <= keepQ + 0.01;
            if (
              !midKeepFluent &&
              !qualityStillKeep &&
              curMaxW < readableMin - 0.5 &&
              cur.blob.size >= V2G_BLACKBOX_MAX_BYTES * 0.88 &&
              !atCap()
            ) {
              const lowerFps = fpsCands.find((f) => f < fpsNow - 0.01) || 0;
              const floor = blackboxFpsFloor(effSpan, srcFps);
              if (lowerFps >= floor - 0.01) {
                // 0.93 留余量：实测等比换算常略超（12@434≈10.00 被硬闸挡回）
                const scale = Math.sqrt(
                  (fpsNow / lowerFps) * ((V2G_BLACKBOX_MAX_BYTES * 0.93) / Math.max(1, cur.blob.size))
                );
                const scaledW = Math.min(
                  Number(hardMax) || curMaxW,
                  Math.max(readableMin, Math.round((curMaxW * scale) / 2) * 2)
                );
                // 先试可读底线 420，再试保守加宽；略超限允许轻压进预算
                // 门槛用 +24：388→420 只多 32px，旧 +36 会整段跳过
                const tryWs = [];
                if (readableMin >= curMaxW + 24) tryWs.push(readableMin);
                if (
                  scaledW >= curMaxW + 24 &&
                  (tryWs.length === 0 || scaledW >= tryWs[0] + 24)
                ) {
                  tryWs.push(scaledW);
                }
                for (const targetW of tryWs) {
                  onProgress(0.96, `偏窄 · 降到 ${lowerFps}fps 换宽${targetW}`);
                  vbbLog(
                    `[vbb-phase] 可读宽优先 ${fpsNow}fps·宽${curMaxW} ${formatKb(cur.blob.size)} → 试 ${lowerFps}fps·宽${targetW}`
                  );
                  let swapped = await encodeKeepQ(lowerFps, targetW);
                  if (!swapped?.blob?.size) continue;
                  const gotW = Number(swapped.maxW) || Number(swapped.outW) || 0;
                  const wideEnough = gotW >= readableMin - 0.5 || gotW >= curMaxW + 24;
                  if (!wideEnough) continue;
                  if (
                    swapped.blob.size > V2G_BLACKBOX_MAX_BYTES &&
                    swapped.blob.size <= V2G_BLACKBOX_MAX_BYTES * 1.06
                  ) {
                    const fitted = await blackboxAcceptBoostIfFits(swapped, {
                      onProgress,
                      isAborted,
                      softGate: 1.08,
                      curSize: cur.blob.size,
                    });
                    if (fitted) swapped = fitted;
                  }
                  if (swapped.blob.size <= V2G_BLACKBOX_MAX_BYTES) {
                    cur = { ...swapped, compressRounds: swapped.compressRounds || 0, maxW: targetW };
                    fpsNow = lowerFps;
                    if (
                      !isCoarsePointer() &&
                      cur.blob.size < V2G_BLACKBOX_MAX_BYTES * 0.95
                    ) {
                      await widenPass("降帧后 · 再加宽");
                    }
                    break;
                  }
                }
              }
            }
          }
          if (!cur?.blob) return cur;
          // 帧率也到顶、预算仍有富余 → gifski 质量从 92 上探到 100（源很窄/很短时用得上）
          // 省电/均衡/手机不做：多一次编码就多一份 wasm 堆占用，拖慢单路
          if (
            !isCoarsePointer() &&
            currentMediaPerf().allowQualityBoost &&
            cur.blob.size < V2G_BLACKBOX_WIDEN_BYTES &&
            (Number(cur.gifskiQuality) || 0) < 100 &&
            blackboxQualityIsBest(cur)
          ) {
            onProgress(0.97, "体积有余 · 画质上探");
            const hi = await encodeAtWidthFps(
              Number(cur.fps) || fpsNow,
              Number(cur.maxW) || V2G_BLACKBOX_BASE_W,
              V2G_BLACKBOX_QUALITY,
              100
            );
            if (hi?.blob?.size && hi.blob.size <= V2G_BLACKBOX_MAX_BYTES) cur = hi;
          }
          return { ...cur, boostHitCeiling };
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
  
        const compressAt = async (candidate, fps, isLastFps, progressBase, compressOpts = {}) => {
          if (!(candidate?.blob?.size > V2G_BLACKBOX_MAX_BYTES)) return candidate;
          const lockKeepQ =
            Boolean(compressOpts.keepQuality) ||
            (qualityFirst &&
              blackboxEncMeetsKeepQ(candidate) &&
              compressOpts.allowBelowKeepQ !== true);
          // 先做一次「无损重编」：按实测体积把宽度/帧率一起缩（体积 ∝ 宽度²×帧数），
          // 尽量不走到 gifsicle --lossy —— 它是「有损优化」，会改动像素，画面会出颗粒。
          {
            const width = Number(candidate.maxW) || 0;
            if (width > 0) {
              const target = V2G_BLACKBOX_MAX_BYTES * 0.9;
              const k = Math.min(1, Math.sqrt(target / Math.max(1, candidate.blob.size)));
              const rw = Math.max(V2G_BLACKBOX_RETRY_MIN_W, Math.floor((width * k) / 2) * 2);
              const keepQ = Number(candidate.quality) || Number(common.quality) || V2G_BLACKBOX_QUALITY;
              const shortFluent = span / speed <= V2G_BLACKBOX_HIGH_PRIMARY_SPAN_SEC + 0.01;
              const midFluent = span / speed <= V2G_BLACKBOX_MID_SPAN_SEC + 0.01;
              // ≤24s 保当前档帧率（含 25/12.5）：勿在硬压里先掉帧
              let rf;
              let retryQuality;
              if (shortFluent || midFluent) {
                rf = fps;
                retryQuality = lockKeepQ
                  ? keepQ
                  : keepQ < V2G_BLACKBOX_RETRY_QUALITY
                    ? V2G_BLACKBOX_RETRY_QUALITY
                    : Math.min(30, Math.max(keepQ, V2G_BLACKBOX_RETRY_QUALITY) + 7);
              } else {
                rf = Math.max(blackboxFpsFloor(span / speed, srcFps), Math.round(fps * k * 2) / 2);
                retryQuality = lockKeepQ
                  ? keepQ
                  : rf <= V2G_BLACKBOX_RETRY_MIN_FPS + 0.01 && k < 0.92
                    ? V2G_BLACKBOX_RETRY_QUALITY
                    : keepQ;
              }
              if (rw < width - 4 || rf < fps - 0.4 || retryQuality > keepQ + 0.01) {
                vbbLog(
                  `[vbb-phase] 超预算 ${formatKb(candidate.blob.size)} → 无损重编 ${rf}fps 宽${rw}${
                    retryQuality !== keepQ ? ` 减色q${retryQuality}` : ""
                  }${
                    (shortFluent || midFluent) && Math.abs(rf - fps) < 0.01
                      ? " · 保帧率"
                      : "（避免 --lossy）"
                  }${lockKeepQ ? " · 守≥80" : ""}`
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
          const movie = blackboxIsMovieLike(srcFps);
          const isBest = blackboxQualityIsBest(candidate);
          const softOnly = isBest || lockKeepQ;
          for (let round = 1; round <= maxRounds; round++) {
            if (isAborted()) throw new Error("已取消");
            const before = cur.blob.size;
            // 满画质 / 画质优先守80：禁止 lossy 减色硬塞；只 -O3。
            const plan = softOnly
              ? buildBlackboxSoftCompressArgs(1, { movie })
              : isLastFps
                ? buildBlackboxHardCompressArgs(round, { movie })
                : buildBlackboxSoftCompressArgs(round, { movie });
            if (softOnly && round > 1) break;
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
            )}ms ${formatKb(before)}→${formatKb(out.size)}${movie && plan.lossy > 0 ? " ·电影lossy" : ""}`
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
          // 接纳上限用硬闸 10MB；0.99 只作探宽目标。否则 420→426 略超 99% 会被整档丢掉
          const fitsHard = (c) => Boolean(c?.blob) && c.blob.size <= V2G_BLACKBOX_MAX_BYTES;
          let guess = Math.round((lo * Math.min(4, Math.sqrt(capBytes / Math.max(1, best.blob.size)))) / 2) * 2;
          guess = Math.max(lo + 2, Math.min(hi, guess));
          let hiW = hi;
          // 探次按性能档：拉满/桌面 4，均衡 3，省电 2（每次试探都是一整次 gifski）
          const maxProbes = Math.max(2, Math.min(6, Number(currentMediaPerf().widenProbes) || 2));
          for (let i = 0; i < maxProbes && hiW - lo > 8; i++) {
            if (isAborted()) throw new Error("已取消");
            const w = i === 0 ? guess : Math.round((lo + hiW) / 2 / 2) * 2;
            if (w <= lo || w >= hiW) break;
            onProgress(0.92, `加宽试探 ${w}px`);
            const enc = await encodeAtWidth(w);
            if (fitsHard(enc)) {
              best = { ...enc, compressRounds: 0, maxW: w };
              lo = w;
              if (best.outW > 0 && best.outW < w - 2) break; // 已达源宽
              if (best.blob.size >= capBytes) break; // 已贴 ~99%，停探
              // 按剩余预算收紧上界，避免短片 hardMax=源宽时下一次中点跳到近 2× 白跑
              const headroomGuess =
                Math.round((lo * Math.min(4, Math.sqrt(capBytes / Math.max(1, best.blob.size)))) / 2) * 2;
              if (Number.isFinite(headroomGuess)) {
                if (headroomGuess <= lo + 2) break; // 几乎贴满，别再二分跳到源宽中点
                hiW = Math.min(hiW, Math.max(lo + 2, headroomGuess + Math.max(32, headroomGuess - lo)));
              }
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
        // 宽度底线统一 380（硬底）；清晰工作点 420——超限先守 420 再降质
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
        const fpsFloor = blackboxFpsFloor(span / speed, srcFps);
        const effSpanForPick = span / speed;
        // ---- 决策：真实编码；短片守 80 掉帧；长片 420 可降质保帧 ----
        const trialCache = new Map();
        const blackboxSingleTaskEncodeConcurrency = () => {
          if (isCoarsePointer()) return 1;
          if (!nativeGifskiProbe.ok) return 1;
          const p = currentMediaPerf();
          if (p.tier === "eco" || p.tier === "balanced") return 1;
          return Math.max(1, Math.min(2, Number(p.encodeConcurrency) || 2));
        };
        const trial = async (fps, w, q) => {
          if (isAborted()) throw new Error("已取消");
          await yieldToUi();
          if (isAborted()) throw new Error("已取消");
          const qq = q && q > 1 ? q : V2G_BLACKBOX_QUALITY;
          const key = `${Number(fps)}|${Number(w)}|${qq}`;
          if (trialCache.has(key)) {
            const cached = trialCache.get(key);
            vbbLog(
              `[vbb-phase] 试 ${fps}FPS·宽${w}${qq > 1 ? `·q${qq}` : ""} → ${formatKb(cached.blob.size)}（缓存）${
                cached.blob.size <= V2G_BLACKBOX_MAX_BYTES ? " ✓" : " ✗"
              }`
            );
            return cached.blob.size <= V2G_BLACKBOX_MAX_BYTES ? cached : null;
          }
          const label = `${fps}FPS·宽${w}${qq > 1 ? `·q${qq}` : ""}`;
          onProgress(0.3, `尝试 ${label}`);
          const enc = await encodeAt(fps, w, 0.3, 0.28, label, qq);
          tried.push(enc);
          trialCache.set(key, enc);
          vbbLog(
            `[vbb-phase] 试 ${label} → ${formatKb(enc.blob.size)}${enc.blob.size <= V2G_BLACKBOX_MAX_BYTES ? " ✓" : " ✗"}`
          );
          return enc.blob.size <= V2G_BLACKBOX_MAX_BYTES ? enc : null;
        };
        const cacheEncodeAtWidthFps = async (f, w, q, gq) => {
          const qq = Number.isFinite(Number(q)) && Number(q) > 1 ? Number(q) : V2G_BLACKBOX_QUALITY;
          const customGq = Number.isFinite(Number(gq));
          const key = customGq
            ? `${Number(f)}|${Number(w)}|${qq}|g${Math.round(Number(gq))}`
            : `${Number(f)}|${Number(w)}|${qq}`;
          if (trialCache.has(key)) {
            const cached = trialCache.get(key);
            vbbLog(
              `[vbb-phase] 试 ${f}FPS·宽${w}${qq > 1 ? `·q${qq}` : ""}${
                customGq ? `·gq${Math.round(Number(gq))}` : ""
              } → ${formatKb(cached.blob.size)}（缓存）`
            );
            return { ...cached, compressRounds: cached.compressRounds || 0, maxW: w };
          }
          const enc = await encodeAtWidthFps(f, w, qq, customGq ? gq : undefined);
          if (enc?.blob) trialCache.set(key, enc);
          return enc;
        };
        /** 同帧率：按 w² 估起点，再二分宽度（少白跑阶梯宽） */
        const bisectWidthAtQuality = async (fps, quality, wLo, wHi) => {
          let lo = Math.max(floorW, Number(wLo) || floorW);
          let hi = Math.max(lo, Number(wHi) || lo);
          let best = null;
          let closestOver = null;
          const first = await trial(fps, hi, quality);
          if (first) return { best: first, closestOver: null };
          const top = tried[tried.length - 1];
          const topSize = Number(top?.blob?.size) || 0;
          if (top) closestOver = top;
          if (topSize > 0 && hi > lo + 2) {
            let guess =
              Math.round((hi * Math.sqrt((V2G_BLACKBOX_MAX_BYTES * 0.96) / topSize)) / 2) * 2;
            guess = Math.max(lo, Math.min(hi - 2, guess));
            const probes = Math.max(2, Math.min(5, Number(currentMediaPerf().widenProbes) || 3));
            for (let i = 0; i < probes && hi - lo > 8; i++) {
              if (isAborted()) throw new Error("已取消");
              const w = i === 0 ? guess : Math.round((lo + hi) / 2 / 2) * 2;
              if (w <= lo || w >= hi) break;
              const e = await trial(fps, w, quality);
              const last = tried[tried.length - 1];
              if (e) {
                best = e;
                lo = w;
              } else {
                hi = w;
                if (last?.blob?.size) {
                  if (!closestOver || last.blob.size < closestOver.blob.size) closestOver = last;
                }
              }
            }
          }
          if (!best && lo >= floorW) {
            const eLo = await trial(fps, lo, quality);
            if (eLo) best = eLo;
            else {
              const last = tried[tried.length - 1];
              if (last?.blob?.size && (!closestOver || last.blob.size < closestOver.blob.size)) {
                closestOver = last;
              }
            }
          }
          return { best, closestOver };
        };
        const keepMaxQi = blackboxKeepQualityMaxQi();
        const squeezeKeepQ = async (fps, w) => {
          const qKeep = V2G_BLACKBOX_QUALITY_LADDER[keepMaxQi];
          const last =
            trialCache.get(`${Number(fps)}|${Number(w)}|${qKeep}`) ||
            tried
              .filter(
                (t) =>
                  Math.abs((Number(t.fps) || 0) - fps) < 0.01 &&
                  Math.abs((Number(t.maxW) || 0) - w) < 1 &&
                  blackboxEncMeetsKeepQ(t)
              )
              .sort((a, b) => (Number(a.blob?.size) || 0) - (Number(b.blob?.size) || 0))[0];
          if (!(last?.blob?.size > V2G_BLACKBOX_MAX_BYTES)) return null;
          vbbLog(
            `[vbb-phase] ${fps}fps ${w}px q${qKeep} 超限 ${formatKb(last.blob.size)} → O3 守≥80`
          );
          const fitted = await blackboxAcceptBoostIfFits(last, {
            onProgress,
            isAborted,
            softGate: 2,
            curSize: 0,
          });
          if (fitted) {
            tried.push(fitted);
            return fitted;
          }
          const pressed = await compressAt(last, fps, true, 0.55, { keepQuality: true });
          tried.push(pressed);
          if (pressed.blob.size <= V2G_BLACKBOX_MAX_BYTES && blackboxEncMeetsKeepQ(pressed)) {
            return pressed;
          }
          return null;
        };
        const fitFps = async (fps, fitOpts = {}) => {
          const allowBelowKeepQ = fitOpts.allowBelowKeepQ === true;
          const belowKeepOnly = fitOpts.belowKeepOnly === true;
          const hardW = Math.max(64, Math.min(srcCap, floorW));
          const isFloorFps = blackboxIsFloorFps(fps, srcFps, effSpanForPick);
          const widthSteps = [];
          for (const raw of V2G_BLACKBOX_LETGO_WIDTHS) {
            const w = Math.round(Math.max(hardW, Math.min(srcCap, raw)) / 2) * 2;
            if (w >= hardW - 0.5 && !widthSteps.some((x) => Math.abs(x - w) < 0.5)) {
              widthSteps.push(w);
            }
          }
          if (!widthSteps.length) widthSteps.push(hardW);
          const lastOverRatio = () =>
            (Number(tried[tried.length - 1]?.blob?.size) || 0) / V2G_BLACKBOX_MAX_BYTES;
          const tryQualities = async (w, qiFrom, qiTo) => {
            for (let qi = qiFrom; qi <= qiTo; qi++) {
              if (blackboxShouldSkipFineQi(qi, lastOverRatio())) {
                vbbLog(
                  `[vbb-phase] 细档跳过 q${V2G_BLACKBOX_QUALITY_LADDER[qi]}：已 ${lastOverRatio().toFixed(2)}×，未贴预算`
                );
                continue;
              }
              const q = V2G_BLACKBOX_QUALITY_LADDER[qi];
              const e = await trial(fps, w, q);
              if (e) {
                vbbLog(`[vbb-phase] ${fps}fps ${w}px q${q} 进预算`);
                return e;
              }
              if (qi === 0) {
                const hqKey = `${Number(fps)}|${Number(w)}|${V2G_BLACKBOX_QUALITY}`;
                const last = trialCache.get(hqKey) || tried[tried.length - 1];
                if (
                  last?.blob?.size > V2G_BLACKBOX_MAX_BYTES &&
                  last.blob.size <= V2G_BLACKBOX_MAX_BYTES * 1.12
                ) {
                  vbbLog(
                    `[vbb-phase] ${fps}fps ${w}px 近超限 ${formatKb(last.blob.size)} → 干净轻压`
                  );
                  const fitted = await blackboxAcceptBoostIfFits(last, {
                    onProgress,
                    isAborted,
                    softGate: 1.12,
                    curSize: 0,
                  });
                  if (fitted) {
                    tried.push(fitted);
                    return fitted;
                  }
                }
              }
              if (isCoarsePointer() && qi < qiTo && lastOverRatio() > 2.5) {
                vbbLog(
                  `[vbb-phase] 手机加速：q${q} 已 ${lastOverRatio().toFixed(2)}× → 结束本宽画质试`
                );
                break;
              }
            }
            return null;
          };
          const shortKeepQ = blackboxKeepQualityUntilFloor(effSpanForPick, qualityFirst);
          const w0 = widthSteps[0];
          const qKeep = V2G_BLACKBOX_QUALITY_LADDER[keepMaxQi];
          const conc = blackboxSingleTaskEncodeConcurrency();
          if (!belowKeepOnly && conc >= 2 && keepMaxQi >= 1) {
            vbbLog(
              `[vbb-phase] 单任务并行试档 conc=2 · ${fps}fps ${w0}px q${V2G_BLACKBOX_QUALITY}+q${qKeep}`
            );
            await Promise.all([
              trial(fps, w0, V2G_BLACKBOX_QUALITY),
              trial(fps, w0, qKeep),
            ]);
          }
          let lastWTried = 0;
          for (let wi = 0; wi < widthSteps.length; wi++) {
            const w = widthSteps[wi];
            if (
              wi === 1 &&
              widthSteps.length >= 3 &&
              isCoarsePointer() &&
              lastOverRatio() > 2
            ) {
              vbbLog(
                `[vbb-phase] 手机加速：${widthSteps[0]}px 已 ${lastOverRatio().toFixed(2)}× → 跳过 400`
              );
              continue;
            }
            if (wi > 0 && lastWTried > 0) {
              const lastSize = Number(tried[tried.length - 1]?.blob?.size) || 0;
              const lastStep = wi === widthSteps.length - 1;
              // 底档必须实打实试 380@≥80，不能面积外推直接降到 q<80
              if (
                !(isFloorFps && lastStep && !belowKeepOnly) &&
                blackboxShouldSkipNarrowerWidth(lastSize, lastWTried, w, V2G_BLACKBOX_MAX_BYTES)
              ) {
                const est = blackboxEstSizeAtWidth(lastSize, lastWTried, w);
                vbbLog(
                  `[vbb-phase] 面积外推跳过 ${w}px：${lastWTried}px ${formatKb(lastSize)} → 估 ${formatKb(est)}`
                );
                continue;
              }
            }
            if (!shortKeepQ && !isFloorFps && wi > 0 && !belowKeepOnly) {
              vbbLog(`[vbb-phase] 长片 ${fps}fps 保 420 不缩宽 → 降帧`);
              break;
            }
            vbbLog(
              `[vbb-phase] ${fps}fps 让渡宽 ${w}px · 画质 ${
                belowKeepOnly
                  ? "<80（底档≥80已试完）"
                  : shortKeepQ || isFloorFps
                    ? "92→≥80"
                    : "92→可<80（保帧）"
              }`
            );
            let hit = null;
            if (belowKeepOnly) {
              hit = await tryQualities(w, keepMaxQi + 1, V2G_BLACKBOX_QUALITY_LADDER.length - 1);
            } else {
              hit = await tryQualities(w, 0, keepMaxQi);
              if (!hit && shortKeepQ) hit = await squeezeKeepQ(fps, w);
              // 默认长片保帧：仅 420 允许 q<80。底档（12/12.5）不得在 420 先降质，须先缩到 380。
              if (!hit && allowBelowKeepQ && !shortKeepQ && !isFloorFps && wi === 0) {
                hit = await tryQualities(w, keepMaxQi + 1, V2G_BLACKBOX_QUALITY_LADDER.length - 1);
              }
            }
            lastWTried = w;
            if (hit) return hit;
          }
          if (isFloorFps && allowBelowKeepQ) {
            const wLast = widthSteps[widthSteps.length - 1];
            vbbLog(`[vbb-phase] ${fps}fps 帧率底线 · ${wLast}px 允许画质<80`);
            const deep = await tryQualities(wLast, keepMaxQi + 1, V2G_BLACKBOX_QUALITY_LADDER.length - 1);
            if (deep) return deep;
            const deepLast = tried
              .filter((t) => Math.abs((Number(t.fps) || 0) - fps) < 0.01)
              .sort((a, b) => (Number(a.blob?.size) || 0) - (Number(b.blob?.size) || 0))[0];
            if (deepLast?.blob?.size > V2G_BLACKBOX_MAX_BYTES) {
              const pressed = await compressAt(deepLast, fps, true, 0.55, {
                allowBelowKeepQ: true,
              });
              tried.push(pressed);
              if (pressed.blob.size <= V2G_BLACKBOX_MAX_BYTES) return pressed;
            }
          } else if (!belowKeepOnly) {
            vbbLog(
              `[vbb-phase] ${fps}fps ${shortKeepQ ? "420/400/380 @≥80 仍超" : "420 含<80 仍超"} → 降整除帧`
            );
          }
          return null;
        };
        let chosen = null;
        await probeNativeGifski();
        const shortKeepQPick = blackboxKeepQualityUntilFloor(effSpanForPick, qualityFirst);
        vbbLog(
          `[vbb-phase] 决策 fpsList=${JSON.stringify(fpsList)} srcFps=${srcFps} srcW=${srcW} floorW=${floorW} span=${effSpanForPick.toFixed(1)}s · ${
            blackboxIsMovieLike(srcFps) ? "电影向" : "屏录向"
          } · ${currentMediaPerf().label} · ${
            qualityFirst ? "画质优先守80" : shortKeepQPick ? "短片守80掉帧" : "长片保帧可<80"
          }`
        );
        const skipFps = (fps) => {
          if (blackboxShouldSkipHighFpsByDuration(fps, effSpanForPick, srcFps)) {
            vbbLog(
              `[vbb-phase] 跳过 ${fps}fps：时长×帧≈${Math.round(effSpanForPick * fps)} 超长片穷举门槛（15 仍试）`
            );
            return true;
          }
          const cal = tried[tried.length - 1];
          if (
            cal?.blob?.size &&
            Number(cal.fps) > 0 &&
            blackboxShouldSkipFpsByCal(fps, cal.fps, cal.blob.size, V2G_BLACKBOX_MAX_BYTES, srcFps)
          ) {
            vbbLog(
              `[vbb-phase] 外推跳过 ${fps}fps：${cal.fps}fps ${formatKb(cal.blob.size)} 估仍超`
            );
            return true;
          }
          return false;
        };
        // 整除档从高到低：守80时每档 420→380 @≥80；默认长片 420 可降质。未试完底档≥80 不得选 q<80。
        for (const fps of fpsList) {
          if (skipFps(fps)) continue;
          const c = await fitFps(fps, { allowBelowKeepQ: !shortKeepQPick });
          if (c) {
            chosen = { enc: c, fps };
            break;
          }
        }
        if (!chosen && shortKeepQPick) {
          vbbLog(
            `[vbb-phase] 底档≥80仍超 10MB → 允许<80，优先更高帧（勿无意义降到12.5仍70）`
          );
          for (const fps of fpsList) {
            if (blackboxShouldSkipHighFpsByDuration(fps, effSpanForPick, srcFps)) continue;
            const c = await fitFps(fps, { allowBelowKeepQ: true, belowKeepOnly: true });
            if (c) {
              chosen = {
                enc: {
                  ...c,
                  vbbPickNote: "超限：底档≥80塞不进10MB，已保更高帧",
                },
                fps,
              };
              break;
            }
          }
        }
        if (!chosen) {
          // 全都不行 → 取最小的一档走 gifsicle 硬压兜底；画质优先优先更高帧
          const pool = tried.slice().sort((a, b) => {
            if (qualityFirst) {
              const fd = (Number(b.fps) || 0) - (Number(a.fps) || 0);
              if (Math.abs(fd) > 0.2) return fd;
            }
            return (Number(a.blob?.size) || 0) - (Number(b.blob?.size) || 0);
          });
          const smallest = pool[0];
          if (!smallest) return null;
          const c = await compressAt(smallest, Number(smallest.fps) || fpsFloor, true, 0.9, {
            allowBelowKeepQ: true,
          });
          tried.push(c);
          if (c.blob.size <= V2G_BLACKBOX_MAX_BYTES) {
            chosen = {
              enc: qualityFirst
                ? { ...c, vbbPickNote: "超限：底档≥80塞不进10MB，已保更高帧" }
                : c,
              fps: Number(smallest.fps) || fpsFloor,
            };
          }
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
          const fpsNow = Number(chosen.fps) || fpsFloor;
          const atFloor = blackboxIsFloorFps(fpsNow, srcFps, effSpanForPick) && wNow <= floorW + 2;
          const baseQ = blackboxLadderQuality(candidate);
          const at = V2G_BLACKBOX_QUALITY_LADDER.indexOf(baseQ);
          const alreadyBelowKeep = !blackboxEncMeetsKeepQ(candidate);
          const qiEnd =
            (atFloor && (!qualityFirst || alreadyBelowKeep)) || alreadyBelowKeep
              ? V2G_BLACKBOX_QUALITY_LADDER.length
              : keepMaxQi + 1;
          for (let qi = (at >= 0 ? at : 0) + 1; qi < qiEnd; qi++) {
            if (abortV2g) throw new Error("已取消");
            const q = V2G_BLACKBOX_QUALITY_LADDER[qi];
            onProgress(0.9, `降质量档重编（q${q} · ${formatKb(candidate.blob.size)}）`);
            const qc = await encodeAt(chosen.fps, wNow, 0.9, 0.05, `${chosen.fps}FPS·宽${wNow}·q${q}`, q);
            tried.push(qc);
            candidate = qc;
            if (qc.blob.size <= V2G_BLACKBOX_MAX_BYTES) break;
          }
          if (atFloor && candidate.blob.size > V2G_BLACKBOX_MAX_BYTES) {
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
          const keepLock = qualityFirst && blackboxEncMeetsKeepQ(candidate);
          candidate = await compressAt(candidate, chosen.fps, true, 0.9, {
            keepQuality: keepLock,
            allowBelowKeepQ: !keepLock,
          });
          tried.push(candidate);
        }
        if (candidate.blob.size <= V2G_BLACKBOX_MAX_BYTES) {
          const qKeep = blackboxLadderQuality(candidate);
          const gqKeep = Number.isFinite(Number(candidate.gifskiQuality))
            ? Number(candidate.gifskiQuality)
            : undefined;
          candidate = { ...candidate, quality: qKeep };
          const finished = await finishBlackbox(
            candidate,
            chosen.fps,
            (f, w, q, gq) => {
              const useQ = Number.isFinite(Number(q)) ? Number(q) : qKeep;
              const useGq = Number.isFinite(Number(gq))
                ? Number(gq)
                : useQ === qKeep
                  ? gqKeep
                  : undefined;
              return cacheEncodeAtWidthFps(f, w, useQ, useGq);
            },
            srcCap
          );
          return finished
            ? {
                ...finished,
                srcFps,
                quality: blackboxLadderQuality(finished),
                vbbPickNote: candidate.vbbPickNote || finished.vbbPickNote,
              }
            : finished;
        }
        const fallback = tried.slice().sort((a, b) => a.blob.size - b.blob.size)[0] || null;
        return fallback ? { ...fallback, srcFps } : null;
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
          const fps = Math.max(2, Number(v2gFps?.value) || 60);
          const maxW = Math.max(64, Number(v2gWidth?.value) || 1280);
          const quality = Math.min(30, Math.max(1, Number(v2gQuality?.value) || 1));
          // 非黑盒也走 gifski 优先（画质/体积更好），失败回退 ffmpeg；allowWide 放开 UI 上限
          const result = await encodeBlackboxGif({
            fps,
            maxW,
            quality,
            gifskiQuality: manualGifskiQuality(quality),
            file: v2gSourceFile,
            allowWide: true,
          });
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
            const eng = result.engine === "gifski" ? "gifski" : "FFmpeg";
            v2gMeta.textContent = `已转换 GIF（${eng}） ${result.frameCount} 帧 · ${result.span.toFixed(1)}s · ${result.fps} FPS · ${result.outW}×${result.outH} · ${formatKb(result.blob.size)}${wmTip}${brightTip}${capTip}`;
          }
          toast("GIF 已生成");
          if (typeof maybeAutoShareGallery === "function") {
            maybeAutoShareGallery([{ name: "from-video.gif", blob: result.blob }], {
              title: "视频转 GIF",
            }).catch(() => {});
          }
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
          const fps = Math.max(2, Number(v2gFps?.value) || 60);
          const maxW = Math.max(64, Number(v2gWidth?.value) || 1280);
          const quality = Math.min(30, Math.max(1, Number(v2gQuality?.value) || 1));
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
          if (typeof maybeAutoShareGallery === "function") {
            maybeAutoShareGallery([{ name: "from-video.webp", blob: result.blob }], {
              title: "动画 WebP",
            }).catch(() => {});
          }
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
          sub: `与「黑盒 GIF」同一套规则 · ${currentMediaPerf().label}`,
          busy: true,
        });

        try {
          await prewarmFfmpegEngine().catch(() => {});
          const { startSec, span } = resolveV2gSpan();
          const srcW = Number(v2gVideo?.videoWidth) || 0;
          const srcH = Number(v2gVideo?.videoHeight) || 0;
          setV2gProgress(true, 0.03, "黑盒开始", {
            sub: `约 ${span.toFixed(1)}s · 智能分配`,
            busy: true,
          });
          const result = await encodeBlackboxClip({
            file: v2gSourceFile,
            startSec,
            span,
            srcW,
            srcH,
            isAborted: () => abortV2g,
            onProgress: (local, text) => {
              setV2gProgress(true, Math.min(0.99, Number(local) || 0), text || "黑盒编码…", {
                busy: true,
              });
            },
          });
          if (!result?.blob) throw new Error("黑盒转换失败");
          if (result.blob.size > V2G_BLACKBOX_MAX_BYTES) {
            throw new Error(
              `无法压到 ${blackboxBudgetLabel()}（${formatKb(result.blob.size)}）。请缩短「最长秒数」后重试`
            );
          }
          applyBlackboxSuccess(result, "黑盒完成");
          return;
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
        const v2gPerf = $("#v2g-perf", root);
        if (v2gPerf && typeof readMediaPerfMode === "function") {
          try { v2gPerf.value = readMediaPerfMode(); } catch (_) { v2gPerf.value = "auto"; }
          v2gPerf.addEventListener("change", () => {
            const mode = setMediaPerfMode(v2gPerf.value);
            v2gPerf.value = mode;
            try {
              const p = mediaPerfProfile();
              toast(`性能：${p.label} · 帧上限 ${p.gifskiMaxFrames}`);
            } catch (_) {}
          });
        }
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
        try {
          revealAutoShareGalleryUi?.();
        } catch (_) {}

        if (v2gDownload && !v2gDownload.dataset.shareBound) {
          v2gDownload.dataset.shareBound = "1";
          v2gDownload.addEventListener("click", (e) => {
            if (!(typeof preferShareToGallery === "function" && preferShareToGallery())) return;
            if (!latestV2gBlob || typeof shareMediaBlob !== "function") return;
            e.preventDefault();
            const name =
              latestV2gFormat === "webp" ? "from-video.webp" : "from-video.gif";
            shareMediaBlob(latestV2gBlob, name, { title: name, fallbackDownload: true }).then((r) => {
              if (r.shared) toast("已调起系统分享 · 可选存到相册");
            });
          });
        }
  
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
  
      function formatWaitClockSec(ms) {
        const n = Math.max(0, Number(ms) || 0);
        const sec = n >= 10000 ? Math.round(n / 1000) : Math.max(0.1, Math.round(n / 100) / 10);
        return `${sec}s`;
      }

      function formatPendingWaitText(job) {
        const status = job?.jobStatus || "";
        if (status === "running") {
          const origin = Number(job.jobStartedAt) || 0;
          if (!(origin > 0)) return "";
          return formatWaitClockSec(Date.now() - origin);
        }
        if (status !== "pending") return "";
        const origin = Number(job.jobQueuedAt) || 0;
        if (!(origin > 0)) return "排队中";
        return `排队 ${formatWaitClockSec(Date.now() - origin)}`;
      }

      /** 进度条上方主文案：排队用秒数；运行中阶段优先，时长只作后缀。 */
      function formatClipProgressText(job) {
        const status = job?.jobStatus || "";
        const stage = String(job?.jobText || "").trim();
        const waitLabel =
          typeof formatPendingWaitText === "function" ? formatPendingWaitText(job) : "";
        if (status === "pending") return waitLabel || stage || "等待中…";
        if (status === "running") {
          const main = stage && stage !== "等待中…" ? stage : "处理中…";
          if (waitLabel && !main.includes(waitLabel)) return `${main} · ${waitLabel}`;
          return main;
        }
        if (stage) return stage;
        if (status === "done") return "完成";
        if (status === "error") return "失败";
        return "";
      }

      function syncClipProgressDom(box, job) {
        if (!box) return;
        const status = job?.jobStatus || "";
        // 生成成功后隐藏进度条，只保留文案信息（时长/宽高/尺寸）
        const show = status === "pending" || status === "running" || status === "error";
        box.hidden = !show;
        if (!show) return;
        // 运行中节流 DOM 写入（≤90ms 一次），状态切换(完成/失败)始终刷新
        if (status === "running") {
          const now = Date.now();
          if (now - (box._lastSync || 0) < 90) return;
          box._lastSync = now;
        }
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
            typeof formatClipProgressText === "function"
              ? formatClipProgressText(job)
              : job.jobText ||
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
        const fps = Math.max(2, Number(vsplitFps?.value) || 60);
        const maxW = Math.max(64, Number(vsplitWidth?.value) || 1280);
        const quality = Math.min(30, Math.max(1, Number(vsplitQuality?.value) || 1));
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
                  : await encodeBlackboxGif({
                      file: vsplitSourceFile,
                      fps,
                      maxW,
                      quality,
                      gifskiQuality: manualGifskiQuality(quality),
                      startSec: c.start,
                      span: c.span,
                      srcW,
                      srcH,
                      skipWatermark: true,
                      skipBright: true,
                      brightness: 0,
                      allowWide: true,
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
            if (typeof maybeAutoShareGallery === "function") {
              await maybeAutoShareGallery(
                gifs.map((x) => ({ name: `clip-${String(x.i + 1).padStart(2, "0")}.gif`, blob: x.c.gifBlob })),
                { zipName: "clips-gif.zip", title: "切片 GIF", zipBlobs }
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
        try {
          revealAutoShareGalleryUi?.();
        } catch (_) {}
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
      /** 一键黑盒：只显示每个 GIF 卡片的进度，隐藏总进度条 */
      let vbbSuppressGlobalProgress = false;
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
      /** 清晰优先：按接近预算规划段长（略留余量，避免实测偶发超限） */
      const VBB_CLARITY_FILL = 0.97;
      const VBB_MAX_CLIPS = 50;
      const VBB_MIN_SPAN = 0.5;
      const VBB_CLARITY_MAX_SPAN = 20;
      const VBB_DURATION_MAX_SPAN = 30;
      /** Soft keep≈0.72 对应约 1–2 轮 --lossy 轻压 */
      const VBB_SOFT_COMPRESS_KEEP = 0.72;
      const VBB_DEFAULT_META = "";
      const VBB_QUALITY_FIRST_KEY = "devtools-vbb-quality-first";
      function vbbQualityFirstOn() {
        try {
          const el = document.getElementById("vbb-quality-first");
          if (el) return !!el.checked;
          return localStorage.getItem(VBB_QUALITY_FIRST_KEY) === "1";
        } catch (_) {
          return false;
        }
      }
      const VBB_WORKFLOW_HINTS = {
        single:
          "选视频 → 可选编辑 → 一键黑盒。",
        split: "长视频切片：先点「① 分析切分方案」查看段数与预估，调整满意后点「② 按方案生成 GIF」。",
        manual: "手动打点：拖到起点/终点点「打起点」「打终点」，标记多段后点「一键黑盒」。",
      };
      const VBB_BATCH_MANUAL_HINT =
        "多选 · 打点仅作用于当前预览视频；切换列表条目会保留各自的点。未打点的条目按整段/编辑范围转 GIF。";
  
      let vbbSourceFile = null;
      /** @type {{ file: File, duration: number, srcW: number, srcH: number, edit?: object, marks?: {start:number,end:number}[], draftStart?: number|null }[]} */
      let vbbBatchFiles = [];
      /** 批量模式当前预览/编辑的下标；单文件模式为 -1 */
      let vbbEditBatchIdx = -1;
      /** 单文件可选 trim/crop（整段模式） */
      let vbbSingleEdit = null;
      let vbbObjectUrl = "";
      let vbbBusy = false;
      let vbbFileEdit = null;
      let vbbFileEditLabel = null;
      let vbbEditOpen = null;
      let vbbEditReset = null;
      let vbbEditOpening = false;
      let vbbPreviewWrap = null;
      let vbbScrubSeekWanted = null;
      let vbbScrubSeekInflight = false;
      let vbbScrubSeekToken = 0;
      let vbbEditSkipBusy = false;
      let vbbScrubRaf = 0;
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
        // 拖进度走 pumpVbbScrubSeek；其它跳转直接设 currentTime（勿密集 fastSeek）
        try {
          vbbVideo.currentTime = t;
        } catch (_) {}
        if (!opts.fromScrub) syncVbbScrubFromVideo();
        paintVbbNow();
        if (opts.fromEdit) syncVbbEditUi();
      }

      function pumpVbbScrubSeek() {
        if (!vbbVideo?.src || vbbScrubSeekInflight) return;
        if (vbbScrubSeekWanted == null) return;
        const d = vbbVideoDuration();
        const t = Math.max(0, Math.min(d || 0, vbbScrubSeekWanted));
        vbbScrubSeekWanted = null;
        if (Math.abs((Number(vbbVideo.currentTime) || 0) - t) < 0.04 && !vbbVideo.seeking) {
          paintVbbNow();
          return;
        }
        const token = vbbScrubSeekToken;
        vbbScrubSeekInflight = true;
        let settled = false;
        const finish = () => {
          if (settled || token !== vbbScrubSeekToken) return;
          settled = true;
          window.clearTimeout(watchdog);
          vbbVideo.removeEventListener("seeked", finish);
          vbbVideo.removeEventListener("error", finish);
          vbbScrubSeekInflight = false;
          paintVbbNow();
          if (vbbScrubSeekWanted != null) pumpVbbScrubSeek();
        };
        const watchdog = window.setTimeout(finish, 320);
        vbbVideo.addEventListener("seeked", finish);
        vbbVideo.addEventListener("error", finish);
        try {
          vbbVideo.currentTime = t;
        } catch (_) {
          finish();
          return;
        }
        if (!vbbVideo.seeking && Math.abs((Number(vbbVideo.currentTime) || 0) - t) < 0.04) {
          finish();
        }
      }

      function scheduleVbbScrubSeek(sec) {
        pauseVbbPreview();
        vbbScrubSeekWanted = sec;
        if (vbbScrubRaf) return;
        vbbScrubRaf = requestAnimationFrame(() => {
          vbbScrubRaf = 0;
          pumpVbbScrubSeek();
        });
      }

      function flushVbbScrubSeek() {
        if (vbbScrubRaf) {
          cancelAnimationFrame(vbbScrubRaf);
          vbbScrubRaf = 0;
        }
        vbbScrubSeekToken += 1;
        vbbScrubSeekInflight = false;
        if (vbbScrubSeekWanted != null) {
          const t = vbbScrubSeekWanted;
          vbbScrubSeekWanted = null;
          applyVbbSeek(t, { fromScrub: true });
        }
      }
  
      function scheduleVbbSeek(sec, opts = {}) {
        if (opts.fromScrub) {
          scheduleVbbScrubSeek(sec);
          vbbPendingSeek = null;
          return;
        }
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
        flushVbbScrubSeek();
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
        if (vbbOneclick && isVbbManualMode() && !isVbbBatchMode()) {
          const count = completeVbbMarks().length;
          vbbOneclick.textContent = count > 0 ? `一键黑盒（${count} 段）` : "一键黑盒";
        }
        const batchHint = $("#vbb-manual-batch-hint");
        if (batchHint) batchHint.hidden = !(manual && isVbbBatchMode());
        paintVbbNow();
        paintVbbScrubMarks();
        paintVbbMarkChips();
      }
  
      function isVbbManualMode() {
        return vbbWorkflow === "manual";
      }
  
      function isVbbSplitMode() {
        return vbbWorkflow === "split" && !isVbbBatchMode();
      }

      function completeMarksList(marks) {
        return (Array.isArray(marks) ? marks : []).filter(
          (m) => m && m.start != null && m.end != null && m.end - m.start >= VBB_MIN_SPAN - 0.001
        );
      }

      /** 把当前全局打点写回多选当前条目 */
      function persistActiveVbbMarks() {
        if (!isVbbBatchMode()) return;
        if (vbbEditBatchIdx < 0 || vbbEditBatchIdx >= vbbBatchFiles.length) return;
        const item = vbbBatchFiles[vbbEditBatchIdx];
        if (!item) return;
        item.marks = vbbMarks.map((m) => ({ start: m.start, end: m.end }));
        item.draftStart = vbbDraftStart;
      }

      function loadItemVbbMarks(item) {
        const marks = Array.isArray(item?.marks) ? item.marks.map((m) => ({ start: m.start, end: m.end })) : [];
        vbbMarks = marks;
        vbbDraftStart = item?.draftStart != null && Number.isFinite(Number(item.draftStart)) ? Number(item.draftStart) : null;
      }

      function countVbbBatchManualSegments() {
        let n = 0;
        vbbBatchFiles.forEach((item, idx) => {
          const marks =
            idx === vbbEditBatchIdx ? completeVbbMarks() : completeMarksList(item?.marks);
          n += marks.length;
        });
        return n;
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
        persistActiveVbbMarks();
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
          persistActiveVbbMarks();
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
        persistActiveVbbMarks();
        paintVbbManualUi();
        toast(`已添加 · ${(next.end - next.start).toFixed(1)}s`);
      }
  
      function undoVbbMark() {
        if (vbbDraftStart != null) {
          vbbDraftStart = null;
          persistActiveVbbMarks();
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
          persistActiveVbbMarks();
          paintVbbManualUi();
          toast("已取消上一段终点");
          return;
        }
        vbbMarks.pop();
        persistActiveVbbMarks();
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

      function makeVbbEditState(duration, srcW, srcH) {
        const d = Math.max(0, Number(duration) || 0);
        const w = Math.max(1, Math.round(Number(srcW) || 1));
        const h = Math.max(1, Math.round(Number(srcH) || 1));
        return {
          trimStart: 0,
          trimEnd: d,
          cutouts: [],
          cropOn: false,
          crop: { x: 0, y: 0, w, h },
        };
      }

      function ensureVbbItemEdit(item) {
        if (!item) return null;
        if (!item.edit) {
          item.edit = makeVbbEditState(item.duration, item.srcW, item.srcH);
        }
        if (!Array.isArray(item.edit.cutouts)) item.edit.cutouts = [];
        return item.edit;
      }

      function vbbNormalizeCutouts(list, trimStart, trimEnd) {
        const fn = window.DevToolsVtrimEditor?.normalizeCutouts;
        if (typeof fn === "function") return fn(list, trimStart, trimEnd);
        const a = Math.max(0, Number(trimStart) || 0);
        const b = Math.max(a + 0.5, Number(trimEnd) || 0);
        return (Array.isArray(list) ? list : [])
          .map((c) => ({
            start: Math.max(a, Number(c?.start) || 0),
            end: Math.min(b, Number(c?.end) || 0),
          }))
          .filter((c) => c.end - c.start >= 0.2)
          .sort((x, y) => x.start - y.start);
      }

      function vbbPreviewSeekForKeepRanges(keeps, t, opts) {
        const fn = window.DevToolsVtrimEditor?.previewSeekForKeepRanges;
        if (typeof fn === "function") return fn(keeps, t, opts);
        if (!Array.isArray(keeps) || !keeps.length) return null;
        const paused = Boolean(opts && opts.paused);
        const time = Number(t);
        if (!Number.isFinite(time)) return null;
        const first = keeps[0];
        const last = keeps[keeps.length - 1];
        const endEps = 0.0005;
        const endKeep =
          Number(window.DevToolsVtrimEditor?.END_KEEP_SEC) > 0
            ? window.DevToolsVtrimEditor.END_KEEP_SEC
            : 1 / 25;
        for (let i = 0; i < keeps.length; i++) {
          const k = keeps[i];
          if (time >= k.start - 0.02 && time < k.end - endEps) return null;
        }
        if (time < first.start - 0.02) return first.start;
        for (let i = 0; i < keeps.length; i++) {
          const nxt = keeps[i + 1];
          if (nxt && time < nxt.start) return nxt.start;
        }
        if (paused) return Math.max(last.start, last.end - endKeep);
        return first.start;
      }

      function vbbKeepRangesFromEdit(edit, duration) {
        const fn = window.DevToolsVtrimEditor?.keepRangesFromEdit;
        if (typeof fn === "function") return fn(edit, duration);
        const d = Math.max(0, Number(duration) || 0);
        const trimStart = Math.max(0, Number(edit?.trimStart) || 0);
        const trimEnd = Math.min(d, Math.max(trimStart + VBB_MIN_SPAN, Number(edit?.trimEnd) || d));
        const cuts = vbbNormalizeCutouts(edit?.cutouts, trimStart, trimEnd);
        const keeps = [];
        let cursor = trimStart;
        const endKeep =
          Number(window.DevToolsVtrimEditor?.END_KEEP_SEC) > 0
            ? window.DevToolsVtrimEditor.END_KEEP_SEC
            : 1 / 25;
        for (const c of cuts) {
          const delFrom = Math.max(trimStart, Number(c.start) || 0);
          const delTo = Math.min(trimEnd, (Number(c.end) || 0) + endKeep);
          if (delFrom > cursor + 0.02) keeps.push({ start: cursor, end: delFrom });
          cursor = Math.max(cursor, delTo);
        }
        if (trimEnd > cursor + 0.02) keeps.push({ start: cursor, end: trimEnd });
        if (!keeps.length) keeps.push({ start: trimStart, end: trimEnd });
        const lastKeep = keeps[keeps.length - 1];
        if (lastKeep && lastKeep.end >= trimEnd - 0.001) {
          lastKeep.end = Math.max(lastKeep.start + 0.05, lastKeep.end - endKeep);
        }
        return keeps;
      }

      function vbbEditIsDirty(edit, duration, srcW, srcH) {
        if (!edit) return false;
        const d = Math.max(0, Number(duration) || 0);
        const fullTrim =
          Math.abs(Number(edit.trimStart) || 0) < 0.05 &&
          Math.abs((Number(edit.trimEnd) || 0) - d) < 0.05;
        const cuts = vbbNormalizeCutouts(edit.cutouts, edit.trimStart, edit.trimEnd);
        if (!fullTrim || cuts.length) return true;
        if (!edit.cropOn) return false;
        const c = edit.crop || {};
        const w = Math.max(1, Math.round(Number(srcW) || 1));
        const h = Math.max(1, Math.round(Number(srcH) || 1));
        return !(
          Math.abs(Number(c.x) || 0) < 2 &&
          Math.abs(Number(c.y) || 0) < 2 &&
          Math.abs((Number(c.w) || 0) - w) < 2 &&
          Math.abs((Number(c.h) || 0) - h) < 2
        );
      }

      function vbbEditBadge(edit, duration, srcW, srcH) {
        if (!vbbEditIsDirty(edit, duration, srcW, srcH)) return "";
        const bits = [];
        const d = Math.max(0, Number(duration) || 0);
        const fullTrim =
          Math.abs(Number(edit.trimStart) || 0) < 0.05 &&
          Math.abs((Number(edit.trimEnd) || 0) - d) < 0.05;
        const keeps = vbbKeepRangesFromEdit(edit, d);
        const keepSpan = keeps.reduce((s, k) => s + Math.max(0, k.end - k.start), 0);
        const cuts = vbbNormalizeCutouts(edit.cutouts, edit.trimStart, edit.trimEnd);
        if (!fullTrim || cuts.length) {
          bits.push(`裁 ${keepSpan.toFixed(1)}s`);
        }
        if (cuts.length) bits.push(`删${cuts.length}段`);
        if (edit.cropOn) bits.push("裁画面");
        return bits.join(" · ");
      }

      function getActiveVbbEditItem() {
        if (isVbbBatchMode()) {
          if (vbbEditBatchIdx < 0 || vbbEditBatchIdx >= vbbBatchFiles.length) return null;
          return vbbBatchFiles[vbbEditBatchIdx];
        }
        if (!vbbSourceFile || !vbbVideo?.src) return null;
        if (!vbbSingleEdit) {
          vbbSingleEdit = makeVbbEditState(
            Number(vbbVideo.duration) || 0,
            vbbVideo.videoWidth || 0,
            vbbVideo.videoHeight || 0
          );
        }
        return {
          file: vbbSourceFile,
          duration: Number(vbbVideo.duration) || 0,
          srcW: vbbVideo.videoWidth || 0,
          srcH: vbbVideo.videoHeight || 0,
          edit: vbbSingleEdit,
        };
      }

      function canShowVbbFileEdit() {
        if (vbbBusy) return false;
        if (isVbbManualMode() || isVbbSplitMode()) return false;
        if (isVbbBatchMode()) return vbbEditBatchIdx >= 0 && Boolean(vbbBatchFiles[vbbEditBatchIdx]);
        return Boolean(vbbSourceFile) && vbbWorkflow === "single";
      }

      function clampVbbEdit(edit, duration, srcW, srcH) {
        if (!edit) return;
        const d = Math.max(0, Number(duration) || 0);
        let start = Math.max(0, Math.min(d, Number(edit.trimStart) || 0));
        let end = Math.max(0, Math.min(d, Number(edit.trimEnd) || d));
        if (end - start < VBB_MIN_SPAN) {
          if (start + VBB_MIN_SPAN <= d) end = start + VBB_MIN_SPAN;
          else {
            end = d;
            start = Math.max(0, end - VBB_MIN_SPAN);
          }
        }
        edit.trimStart = start;
        edit.trimEnd = end;
        edit.cutouts = vbbNormalizeCutouts(edit.cutouts, start, end);
        const w = Math.max(1, Math.round(Number(srcW) || 1));
        const h = Math.max(1, Math.round(Number(srcH) || 1));
        const c = edit.crop || { x: 0, y: 0, w, h };
        let cx = Math.max(0, Math.round(Number(c.x) || 0));
        let cy = Math.max(0, Math.round(Number(c.y) || 0));
        let cw = Math.max(2, Math.round(Number(c.w) || w));
        let ch = Math.max(2, Math.round(Number(c.h) || h));
        if (cx + cw > w) cw = Math.max(2, w - cx);
        if (cy + ch > h) ch = Math.max(2, h - cy);
        if (cw > w) {
          cw = w;
          cx = 0;
        }
        if (ch > h) {
          ch = h;
          cy = 0;
        }
        edit.crop = { x: cx, y: cy, w: cw, h: ch };
      }

      function resolveVbbEncodeEdits(item, file, duration, srcW, srcH) {
        const edit = item?.edit || (item === null ? vbbSingleEdit : null);
        let startSec = 0;
        let span = Math.max(0, Number(duration) || 0);
        let keepRanges = [{ start: 0, end: span }];
        if (edit) {
          clampVbbEdit(edit, duration, srcW, srcH);
          keepRanges = vbbKeepRangesFromEdit(edit, duration);
          startSec = Number(keepRanges[0]?.start) || 0;
          const last = keepRanges[keepRanges.length - 1];
          const end = Number(last?.end) || duration;
          // 单段 keep 时沿用旧语义；多段 keep 由 materialize 拼成一条再编
          if (keepRanges.length === 1) {
            span = Math.max(VBB_MIN_SPAN, end - startSec);
            if (startSec + span > duration) span = Math.max(VBB_MIN_SPAN, duration - startSec);
          } else {
            span = keepRanges.reduce((s, k) => s + Math.max(0, k.end - k.start), 0);
          }
        }
        return { startSec, span, edit, keepRanges };
      }

      /**
       * 有多段 keep（删中间）时，先拼成一条临时片再黑盒，保证仍是一条 GIF。
       * @returns {Promise<{ file: File, duration: number, srcW: number, srcH: number, materialized: boolean }>}
       */
      async function materializeVbbKeepVideo(file, edit, srcW, srcH, duration, onProgress) {
        const keeps = vbbKeepRangesFromEdit(edit, duration);
        if (keeps.length <= 1) {
          return { file, duration, srcW, srcH, materialized: false };
        }
        const exp = window.DevToolsVtrimEditor?.exportKeepVideo;
        if (typeof exp === "function") {
          const out = await exp(file, edit, duration, {
            srcW,
            srcH,
            applyCrop: false,
            onProgress,
          });
          return {
            file: out.file,
            duration: Number(out.duration) || duration,
            srcW: out.srcW || srcW,
            srcH: out.srcH || srcH,
            materialized: true,
          };
        }
        const ffmpeg =
          typeof getFfmpegInstance === "function"
            ? await getFfmpegInstance((r, t) => onProgress?.(r, t || "准备拼接编辑…"))
            : null;
        if (!ffmpeg) throw new Error("无法加载编码器以应用「删中间」");
        const ext = typeof v2gSourceExt === "function" ? v2gSourceExt(file) : "mp4";
        const inName = await ensureFfmpegInputWritten(ffmpeg, file, () => onProgress?.(0.05, "载入视频…"));
        const W = Math.max(2, Math.round((Number(srcW) || 720) / 2) * 2);
        const H = Math.max(2, Math.round((Number(srcH) || 404) / 2) * 2);
        const parts = [];
        for (let i = 0; i < keeps.length; i++) {
          if (abortVbb || abortV2g) throw new Error("已取消");
          onProgress?.(0.08 + (i / keeps.length) * 0.5, `应用删中间 ${i + 1}/${keeps.length}`);
          const k = keeps[i];
          const dur = Math.max(0.05, k.end - k.start);
          const out = `keep${i}.mp4`;
          const args = [
            "-i",
            inName,
            "-ss",
            String(k.start),
            "-t",
            String(dur),
            "-an",
            "-vf",
            `scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p`,
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-y",
            out,
          ];
          const code = await ffmpeg.exec(args).catch(() => 1);
          if (code !== 0) throw new Error(`删中间切片失败（段 ${i + 1}）`);
          parts.push(out);
        }
        onProgress?.(0.65, "拼接保留段…");
        const listName = "keep-concat.txt";
        const listBody = parts.map((p) => `file '${p}'`).join("\n");
        await ffmpeg.writeFile(listName, new TextEncoder().encode(listBody));
        const merged = "keep-merged.mp4";
        let code = await ffmpeg
          .exec(["-f", "concat", "-safe", "0", "-i", listName, "-c", "copy", "-y", merged])
          .catch(() => 1);
        if (code !== 0) {
          // copy 失败则重编码拼接
          const filter = parts.map((_, i) => `[${i}:v]`).join("") + `concat=n=${parts.length}:v=1:a=0[v]`;
          const args = [];
          parts.forEach((p) => args.push("-i", p));
          args.push(
            "-filter_complex",
            filter,
            "-map",
            "[v]",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-y",
            merged
          );
          code = await ffmpeg.exec(args).catch(() => 1);
        }
        if (code !== 0) throw new Error("删中间拼接失败");
        const data = await ffmpeg.readFile(merged);
        const raw = data instanceof Uint8Array ? data : new Uint8Array(data);
        const bytes = new Uint8Array(raw.byteLength);
        bytes.set(raw);
        const outFile = new File([bytes], (file.name || "edit").replace(/\.[^.]+$/, "") + "-cut.mp4", {
          type: "video/mp4",
        });
        const totalSpan = keeps.reduce((s, k) => s + Math.max(0, k.end - k.start), 0);
        for (const p of parts) {
          try {
            await ffmpeg.deleteFile(p);
          } catch (_) {}
        }
        try {
          await ffmpeg.deleteFile(listName);
        } catch (_) {}
        try {
          await ffmpeg.deleteFile(merged);
        } catch (_) {}
        return { file: outFile, duration: totalSpan, srcW: W, srcH: H, materialized: true };
      }

      /**
       * 编码前：多段 keep（删中间）先拼成一条；单段直接用 trim 窗。
       * @returns {Promise<{ file: File, startSec: number, span: number, srcW: number, srcH: number, edit: any, cutNote: string }>}
       */
      async function prepareVbbEncodeSource(file, edit, srcW, srcH, duration, opts = {}) {
        const fromMark = Boolean(opts.fromMark);
        let startSec = Math.max(0, Number(opts.startSec) || 0);
        let span = Math.max(VBB_MIN_SPAN, Number(opts.span) || VBB_MIN_SPAN);
        let outFile = file;
        let outW = Math.max(1, Math.round(Number(srcW) || 1));
        let outH = Math.max(1, Math.round(Number(srcH) || 1));
        let cutNote = "";
        if (!fromMark && edit) {
          const keeps = vbbKeepRangesFromEdit(edit, duration);
          const cuts = vbbNormalizeCutouts(edit.cutouts, edit.trimStart, edit.trimEnd);
          if (keeps.length > 1) {
            const mat = await materializeVbbKeepVideo(file, edit, srcW, srcH, duration, opts.onProgress);
            outFile = mat.file;
            startSec = 0;
            span = Math.max(VBB_MIN_SPAN, Number(mat.duration) || span);
            outW = mat.srcW;
            outH = mat.srcH;
            cutNote = cuts.length ? `删${cuts.length}段` : "删中间";
          } else if (cuts.length) {
            cutNote = `删${cuts.length}段`;
          }
        }
        return { file: outFile, startSec, span, srcW: outW, srcH: outH, edit, cutNote };
      }

      async function resolveVbbEncodeCrop(file, edit, srcW, srcH, duration) {
        if (edit?.cropOn && edit.crop) {
          return normalizeV2gCrop(edit.crop, srcW, srcH);
        }
        // 用户进编辑只裁了时长、没开裁画面 → 尊重整幅，禁止再叠「自动去色边」
        if (edit && !edit.cropOn && vbbEditIsDirty(edit, duration, srcW, srcH)) {
          return null;
        }
        return vbbResolveCrop(file);
      }

      function paintVbbEditStatusLabel(el, { badge, name, batch }) {
        if (!el) return;
        el.replaceChildren();
        if (badge) {
          const tag = document.createElement("span");
          tag.className = "vbb-edit-badge";
          tag.textContent = `已编辑 · ${badge}`;
          if (batch) {
            el.append(`「${name || "视频"}」 `, tag);
          } else {
            el.append(tag, " · 可裁时长 / 画面 / 删中间");
          }
        } else if (batch) {
          el.textContent = `「${name || "视频"}」 · 未编辑`;
        } else {
          el.textContent = "未编辑 · 默认可裁片头片尾，绿框可裁画面 / 删中间";
        }
      }

      function syncVbbEditUi() {
        const show = canShowVbbFileEdit();
        if (vbbFileEdit) {
          vbbFileEdit.hidden = !show;
          if (!show) vbbFileEdit.classList.remove("is-edited");
        }
        if (!show) return;
        const item = getActiveVbbEditItem();
        if (!item) return;
        const edit = ensureVbbItemEdit(item);
        clampVbbEdit(edit, item.duration, item.srcW, item.srcH);
        const badge = vbbEditBadge(edit, item.duration, item.srcW, item.srcH);
        const name = item.file?.name || "视频";
        const dirty = Boolean(badge);
        if (vbbFileEdit) vbbFileEdit.classList.toggle("is-edited", dirty);
        paintVbbEditStatusLabel(vbbFileEditLabel, {
          badge,
          name,
          batch: isVbbBatchMode(),
        });
        const enabled = !vbbBusy && !vbbEditOpening;
        if (vbbEditOpen) vbbEditOpen.disabled = !enabled;
        if (vbbEditReset) vbbEditReset.disabled = !enabled || !vbbEditIsDirty(edit, item.duration, item.srcW, item.srcH);
      }

      async function ensureVbbVtrimEditor() {
        if (window.DevToolsVtrimEditor?.open) return window.DevToolsVtrimEditor;
        const load = window.DevToolsLazy?.loadScript;
        if (typeof load !== "function") throw new Error("脚本加载器不可用");
        await load("./lib/vtrim-editor.js");
        if (!window.DevToolsVtrimEditor?.open) throw new Error("视频编辑器加载失败");
        return window.DevToolsVtrimEditor;
      }

      function prefetchVbbVtrimEditor() {
        ensureVbbVtrimEditor().catch(() => {});
      }

      function unlockVbbEditBootScroll(lockY, shell, shellY) {
        document.body.classList.remove("vtrim-editor-open");
        document.body.style.position = "";
        document.body.style.top = "";
        document.body.style.left = "";
        document.body.style.right = "";
        document.body.style.width = "";
        document.body.style.overflow = "";
        if (shell) {
          shell.style.overflow = "";
          shell.scrollTop = shellY;
        }
        window.scrollTo(0, lockY);
      }

      async function openVbbEditEditor(targetItem) {
        if (vbbBusy || vbbEditOpening) return;
        const item = targetItem || getActiveVbbEditItem();
        if (!item?.file) {
          toast("请先选择视频");
          return;
        }
        ensureVbbItemEdit(item);
        clampVbbEdit(item.edit, item.duration, item.srcW, item.srcH);
        const draft = {
          trimStart: item.edit.trimStart,
          trimEnd: item.edit.trimEnd,
          cutouts: Array.isArray(item.edit.cutouts)
            ? item.edit.cutouts.map((c) => ({ start: c.start, end: c.end }))
            : [],
          cropOn: Boolean(item.edit.cropOn),
          crop: item.edit.crop ? { ...item.edit.crop } : { x: 0, y: 0, w: item.srcW, h: item.srcH },
        };
        vbbEditOpening = true;
        // 先失焦再锁位：手机点按钮会把焦点控件滚进视口，看起来像「先滚一下再出编辑框」
        try {
          document.activeElement?.blur?.();
        } catch (_) {}
        const scrollRoot = typeof vbbScrollRoot === "function" ? vbbScrollRoot() : null;
        const shell =
          scrollRoot && scrollRoot !== document.documentElement && scrollRoot !== document.scrollingElement
            ? scrollRoot
            : document.querySelector("main.shell, .shell");
        const lockY = window.scrollY || document.documentElement.scrollTop || 0;
        const shellY = shell ? shell.scrollTop || 0 : 0;
        const boot = document.createElement("div");
        boot.className = "vtrim-editor-boot";
        boot.setAttribute("aria-busy", "true");
        // 内联兜底：vtrim.css 可能尚未加载，避免空白间隙里底层页被滚走
        boot.style.cssText =
          "position:fixed;inset:0;z-index:9195;display:grid;place-items:center;background:rgba(11,18,32,0.72);";
        boot.innerHTML = `<div class="vtrim-editor-boot-card" style="padding:0.85rem 1.15rem;border-radius:12px;background:#121826;color:#e8eefc;font-size:0.95rem;">正在打开编辑…</div>`;
        document.body.classList.add("vtrim-editor-open");
        document.body.style.position = "fixed";
        document.body.style.top = `-${lockY}px`;
        document.body.style.left = "0";
        document.body.style.right = "0";
        document.body.style.width = "100%";
        document.body.style.overflow = "hidden";
        if (shell) shell.style.overflow = "hidden";
        document.body.appendChild(boot);
        syncVbbEditUi();
        renderVbbBatchList({ keepSelection: true });
        let editorOpened = false;
        try {
          const editor = await ensureVbbVtrimEditor();
          pauseVbbPreview();
          // open 同步挂上真正编辑层后再撤 boot，中间不露底层
          const openP = editor.open({
            file: item.file,
            title: item.file.name || "视频",
            initial: draft,
            initialMode: "trim",
          });
          editorOpened = true;
          boot.remove();
          const next = await openP;
          if (next) {
            item.edit = {
              trimStart: Number(next.trimStart) || 0,
              trimEnd: Number(next.trimEnd) || item.duration,
              cutouts: Array.isArray(next.cutouts)
                ? next.cutouts.map((c) => ({
                    start: Number(c.start) || 0,
                    end: Number(c.end) || 0,
                  }))
                : [],
              cropOn: Boolean(next.cropOn),
              crop: next.crop
                ? { ...next.crop }
                : { x: 0, y: 0, w: item.srcW, h: item.srcH },
            };
            clampVbbEdit(item.edit, item.duration, item.srcW, item.srcH);
            if (!isVbbBatchMode()) vbbSingleEdit = item.edit;
            applyVbbSeek(Number(item.edit.trimStart) || 0, { keepPlaying: false });
            syncVbbEditPreview();
            toast(
              vbbEditIsDirty(item.edit, item.duration, item.srcW, item.srcH)
                ? "已保存编辑 · 预览为裁切后片段"
                : "已恢复为原片范围"
            );
          } else {
            toast("已关闭，未保存本次改动");
          }
        } catch (err) {
          setError(vbbError, err?.message || String(err));
        } finally {
          try {
            boot.remove();
          } catch (_) {}
          if (!editorOpened) unlockVbbEditBootScroll(lockY, shell, shellY);
          vbbEditOpening = false;
          syncVbbEditUi();
          renderVbbBatchList({ keepSelection: true });
          syncVbbBatchMeta();
        }
      }

      function resetActiveVbbEdit() {
        const item = getActiveVbbEditItem();
        if (!item) return;
        item.edit = makeVbbEditState(item.duration, item.srcW, item.srcH);
        if (!isVbbBatchMode()) vbbSingleEdit = item.edit;
        syncVbbEditUi();
        syncVbbEditPreview();
        applyVbbSeek(0, { keepPlaying: false });
        renderVbbBatchList({ keepSelection: true });
        syncVbbBatchMeta();
        toast("已重置该视频的编辑");
      }

      function clearVbbEditPreviewStyles() {
        const video = vbbVideo;
        const wrap = vbbPreviewWrap;
        if (video) {
          video.style.clipPath = "";
          video.style.webkitClipPath = "";
          video.style.transform = "";
          video.style.transformOrigin = "";
        }
        wrap?.classList.remove("is-edit-preview", "is-edit-crop");
      }

      /** 主预览跟随当前编辑：keep 跳过删中间 + 裁画面 clip/放大到绿框 */
      function syncVbbEditPreview() {
        const item = getActiveVbbEditItem();
        const video = vbbVideo;
        const wrap = vbbPreviewWrap;
        if (!video) return;
        if (!item?.edit || !vbbEditIsDirty(item.edit, item.duration, item.srcW, item.srcH)) {
          clearVbbEditPreviewStyles();
          return;
        }
        wrap?.classList.add("is-edit-preview");
        const edit = item.edit;
        if (edit.cropOn && edit.crop && item.srcW > 0 && item.srcH > 0) {
          wrap?.classList.add("is-edit-crop");
          const c = edit.crop;
          const srcW = item.srcW;
          const srcH = item.srcH;
          const left = Math.max(0, Number(c.x) || 0) / srcW;
          const top = Math.max(0, Number(c.y) || 0) / srcH;
          const rw = Math.max(0.02, (Number(c.w) || srcW) / srcW);
          const rh = Math.max(0.02, (Number(c.h) || srcH) / srcH);
          const right = Math.max(0, 1 - left - rw);
          const bottom = Math.max(0, 1 - top - rh);
          const scale = Math.min(1 / rw, 1 / rh);
          const ox = (left + rw / 2) * 100;
          const oy = (top + rh / 2) * 100;
          video.style.transformOrigin = `${ox}% ${oy}%`;
          video.style.transform = `translate(${50 - ox}%, ${50 - oy}%) scale(${scale})`;
          const inset = `inset(${top * 100}% ${right * 100}% ${bottom * 100}% ${left * 100}%)`;
          video.style.clipPath = inset;
          video.style.webkitClipPath = inset;
        } else {
          wrap?.classList.remove("is-edit-crop");
          video.style.clipPath = "";
          video.style.webkitClipPath = "";
          video.style.transform = "";
          video.style.transformOrigin = "";
        }
      }

      function enforceVbbEditPlaybackWindow(mediaTime) {
        if (isVbbManualMode() || vbbBusy || !vbbVideo?.src || vbbEditSkipBusy) return;
        const item = getActiveVbbEditItem();
        if (!item?.edit || !vbbEditIsDirty(item.edit, item.duration, item.srcW, item.srcH)) return;
        const keeps = vbbKeepRangesFromEdit(item.edit, item.duration);
        if (!keeps.length) return;
        const t = Number.isFinite(mediaTime) ? mediaTime : Number(vbbVideo.currentTime) || 0;
        const next = vbbPreviewSeekForKeepRanges(keeps, t, { paused: vbbVideo.paused });
        if (next == null || !Number.isFinite(next)) return;
        if (Math.abs(t - next) < 0.04) return;
        const keepPlaying = !vbbVideo.paused;
        vbbEditSkipBusy = true;
        applyVbbSeek(next, { keepPlaying: true });
        const finish = () => {
          vbbVideo.removeEventListener("seeked", finish);
          window.clearTimeout(watch);
          vbbEditSkipBusy = false;
          if (keepPlaying && vbbVideo.paused) vbbVideo.play().catch(() => {});
        };
        const watch = window.setTimeout(finish, 360);
        vbbVideo.addEventListener("seeked", finish);
      }

      function armVbbEditFrameWatch() {
        if (typeof vbbVideo?.requestVideoFrameCallback !== "function") return;
        const onFrame = (_now, meta) => {
          if (!vbbVideo || vbbVideo.paused || vbbBusy) return;
          enforceVbbEditPlaybackWindow(Number(meta?.mediaTime));
          if (!vbbVideo.paused) {
            try {
              vbbVideo.requestVideoFrameCallback(onFrame);
            } catch (_) {}
          }
        };
        try {
          vbbVideo.requestVideoFrameCallback(onFrame);
        } catch (_) {}
      }

      async function selectVbbBatchItem(idx, { force = false } = {}) {
        if (!isVbbBatchMode()) return;
        if (!force && idx === vbbEditBatchIdx && vbbVideo?.src) {
          syncVbbEditUi();
          paintVbbManualUi();
          return;
        }
        const item = vbbBatchFiles[idx];
        if (!item) return;
        persistActiveVbbMarks();
        pauseVbbPreview();
        if (vbbObjectUrl) {
          try {
            URL.revokeObjectURL(vbbObjectUrl);
          } catch (_) {}
          vbbObjectUrl = "";
        }
        vbbEditBatchIdx = idx;
        vbbSourceFile = item.file;
        ensureVbbItemEdit(item);
        loadItemVbbMarks(item);
        vbbObjectUrl = URL.createObjectURL(item.file);
        attachLocalVideoPreview(vbbVideo, vbbObjectUrl);
        await waitVideoMetadata(vbbVideo);
        if (vbbVideo) {
          vbbVideo.hidden = false;
          vbbVideo.controls = !isVbbManualMode();
        }
        const edit = item.edit;
        clampVbbEdit(edit, item.duration, item.srcW, item.srcH);
        const seekTo = isVbbManualMode()
          ? vbbDraftStart != null
            ? vbbDraftStart
            : completeVbbMarks()[0]?.start ?? 0
          : edit.trimStart;
        applyVbbSeek(seekTo, { keepPlaying: false });
        renderVbbBatchList({ keepSelection: true });
        syncVbbEditUi();
        syncVbbEditPreview();
        paintVbbManualUi();
        setVbbButtons();
      }

      /** 多选手动排序：from → to（含两端），保持当前预览条目 */
      function moveVbbBatchItem(from, to) {
        if (vbbBusy || vbbEditOpening) return false;
        const n = vbbBatchFiles.length;
        if (!isVbbBatchMode() || n < 2) return false;
        if (
          !Number.isFinite(from) ||
          !Number.isFinite(to) ||
          from < 0 ||
          to < 0 ||
          from >= n ||
          to >= n ||
          from === to
        ) {
          return false;
        }
        persistActiveVbbMarks();
        const active = vbbEditBatchIdx >= 0 ? vbbBatchFiles[vbbEditBatchIdx] : null;
        const [item] = vbbBatchFiles.splice(from, 1);
        vbbBatchFiles.splice(to, 0, item);
        if (active) {
          const next = vbbBatchFiles.indexOf(active);
          vbbEditBatchIdx = next >= 0 ? next : Math.min(from, vbbBatchFiles.length - 1);
        }
        renderVbbBatchList({ keepSelection: true });
        syncVbbBatchMeta();
        setVbbButtons();
        return true;
      }

      /** 从多选列表移除一条：释放预览 URL、清 edit/marks；余 1 条时退回单文件模式 */
      async function removeVbbBatchItem(idx) {
        if (vbbBusy || vbbEditOpening) return;
        if (idx < 0 || idx >= vbbBatchFiles.length) return;
        const removing = vbbBatchFiles[idx];
        if (!removing) return;
        const wasActive = idx === vbbEditBatchIdx;
        if (!wasActive) persistActiveVbbMarks();
        else {
          pauseVbbPreview();
          if (vbbObjectUrl) {
            try {
              URL.revokeObjectURL(vbbObjectUrl);
            } catch (_) {}
            vbbObjectUrl = "";
          }
          vbbMarks = [];
          vbbDraftStart = null;
        }
        removing.edit = null;
        removing.marks = null;
        removing.draftStart = null;
        vbbBatchFiles.splice(idx, 1);

        if (!vbbBatchFiles.length) {
          clearVbb();
          toast("已移除该视频");
          return;
        }

        if (vbbBatchFiles.length === 1) {
          const only = vbbBatchFiles[0];
          const savedEdit = only.edit ? { ...only.edit, crop: only.edit.crop ? { ...only.edit.crop } : null } : null;
          const savedMarks = Array.isArray(only.marks) ? only.marks.map((m) => ({ start: m.start, end: m.end })) : [];
          const savedDraft = only.draftStart != null ? Number(only.draftStart) : null;
          const keepWorkflow = vbbWorkflow === "manual" ? "manual" : "single";
          const file = only.file;
          await loadVbbFile(file);
          vbbWorkflow = keepWorkflow;
          if (savedEdit) {
            vbbSingleEdit = {
              trimStart: Number(savedEdit.trimStart) || 0,
              trimEnd: Number(savedEdit.trimEnd) || Number(vbbVideo?.duration) || 0,
              cropOn: Boolean(savedEdit.cropOn),
              crop: savedEdit.crop
                ? { ...savedEdit.crop }
                : makeVbbEditState(Number(vbbVideo?.duration) || 0, vbbVideo?.videoWidth || 0, vbbVideo?.videoHeight || 0).crop,
            };
          }
          vbbMarks = savedMarks;
          vbbDraftStart = Number.isFinite(savedDraft) ? savedDraft : null;
          syncVbbWorkflowUi();
          syncVbbEditUi();
          setVbbButtons();
          toast("已移除 · 余 1 个视频");
          return;
        }

        let nextIdx = vbbEditBatchIdx;
        if (wasActive) nextIdx = Math.min(idx, vbbBatchFiles.length - 1);
        else if (idx < vbbEditBatchIdx) nextIdx = vbbEditBatchIdx - 1;
        vbbEditBatchIdx = -1;
        await selectVbbBatchItem(Math.max(0, nextIdx), { force: true });
        syncVbbBatchMeta();
        syncVbbWorkflowUi();
        toast("已移除该视频");
      }
  
      function vbbGifBaseName(file) {
        const name = String(file?.name || "clip");
        return name.replace(/\.[^.]+$/i, "").replace(/[^\w\u4e00-\u9fff.-]+/g, "_") || "clip";
      }
  
      function vbbGifDownloadName(clip, idx) {
        if (clip?.sourceName) return `${clip.sourceName}.gif`;
        return `bb-${String((idx ?? 0) + 1).padStart(2, "0")}.gif`;
      }

      /** 每个 GIF 编码完成后立刻下载（默认关；与打包 zip / 合并不冲突） */
      const VBB_AUTO_DL_EACH_KEY = "devtools-vbb-auto-dl-each-v1";

      function isVbbAutoDlEachEnabled() {
        try {
          return localStorage.getItem(VBB_AUTO_DL_EACH_KEY) === "1";
        } catch (_) {
          return false;
        }
      }

      function setVbbAutoDlEachEnabled(on) {
        try {
          localStorage.setItem(VBB_AUTO_DL_EACH_KEY, on ? "1" : "0");
        } catch (_) {}
      }

      function maybeAutoDownloadVbbGif(clip, idx) {
        if (!isVbbAutoDlEachEnabled() || !clip?.gifBlob) return false;
        if (clip.error || clip.gifBlob.size > V2G_BLACKBOX_MAX_BYTES) return false;
        try {
          triggerLocalDownload(clip.gifBlob, vbbGifDownloadName(clip, idx));
          return true;
        } catch (_) {
          return false;
        }
      }

      /** 当前「压缩时长」对应的加速倍率（相对该段 span） */
      function vbbSpeedFactorForSpan(span) {
        const lim = vbbSpeedLimitSec();
        const s = Number(span) || 0;
        if (lim > 0 && s > lim) return Math.max(1, Math.min(16, s / lim));
        return 1;
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
          if (isVbbUserScrolling() || vbbBusy) return;
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
        // 编码中禁止把滚动钉回去，否则处理时整页像卡死、滑不动
        if (vbbBusy) return mutator();
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
  
      function renderVbbBatchList(opts = {}) {
        if (!vbbBatchList) return;
        if (!isVbbBatchMode()) {
          vbbBatchList.hidden = true;
          vbbBatchList.innerHTML = "";
          return;
        }
        vbbBatchList.hidden = false;
        vbbBatchList.innerHTML = "";
        vbbBatchFiles.forEach((item, idx) => {
          ensureVbbItemEdit(item);
          const row = document.createElement("div");
          row.className = "vbb-batch-row hint tight" + (idx === vbbEditBatchIdx ? " is-active" : "");
          row.dataset.vbbBatchIdx = String(idx);
          const main = document.createElement("div");
          main.className = "vbb-batch-row-main";
          const name = document.createElement("span");
          name.className = "vbb-batch-row-name";
          name.textContent = `${idx + 1}. ${item.file.name}`;
          const meta = document.createElement("span");
          meta.className = "vbb-batch-row-meta";
          const badge = vbbEditBadge(item.edit, item.duration, item.srcW, item.srcH);
          const markCount =
            idx === vbbEditBatchIdx ? completeVbbMarks().length : completeMarksList(item.marks).length;
          const markBadge = markCount > 0 ? `${markCount} 段打点` : "";
          const baseMeta = [`${item.duration.toFixed(1)}s`, formatKb(item.file.size), `${item.srcW}×${item.srcH}`]
            .filter(Boolean)
            .join(" · ");
          meta.append(baseMeta);
          if (markBadge) {
            meta.append(" · ", markBadge);
          } else if (badge) {
            const tag = document.createElement("span");
            tag.className = "vbb-edit-badge";
            tag.textContent = `已编辑 · ${badge}`;
            meta.append(" · ", tag);
            row.classList.add("is-edited");
          } else if (!isVbbManualMode()) {
            meta.append(" · 未编辑");
          }
          main.appendChild(name);
          main.appendChild(meta);
          const btn = document.createElement("button");
          btn.type = "button";
          btn.className = "secondary-btn";
          btn.textContent = "编辑";
          btn.disabled = vbbBusy || vbbEditOpening || isVbbManualMode();
          btn.hidden = isVbbManualMode();
          btn.addEventListener("click", (e) => {
            e.stopPropagation();
            blurVbbActionButton(btn);
            openVbbEditEditor(item).catch((err) => setError(vbbError, err.message || String(err)));
          });
          const previewBtn = document.createElement("button");
          previewBtn.type = "button";
          previewBtn.className = "ghost-btn";
          previewBtn.textContent = idx === vbbEditBatchIdx ? "预览中" : "预览";
          previewBtn.disabled = vbbBusy;
          previewBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            selectVbbBatchItem(idx).catch((err) => setError(vbbError, err.message || String(err)));
          });
          const upBtn = document.createElement("button");
          upBtn.type = "button";
          upBtn.className = "ghost-btn vbb-batch-row-move";
          upBtn.setAttribute("aria-label", "上移");
          upBtn.title = "上移";
          upBtn.textContent = "↑";
          upBtn.disabled = vbbBusy || vbbEditOpening || idx === 0;
          upBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (moveVbbBatchItem(idx, idx - 1)) toast(`已上移到第 ${idx} 位`);
          });
          const downBtn = document.createElement("button");
          downBtn.type = "button";
          downBtn.className = "ghost-btn vbb-batch-row-move";
          downBtn.setAttribute("aria-label", "下移");
          downBtn.title = "下移";
          downBtn.textContent = "↓";
          downBtn.disabled = vbbBusy || vbbEditOpening || idx >= vbbBatchFiles.length - 1;
          downBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (moveVbbBatchItem(idx, idx + 1)) toast(`已下移到第 ${idx + 2} 位`);
          });
          const removeBtn = document.createElement("button");
          removeBtn.type = "button";
          removeBtn.className = "ghost-btn vbb-batch-row-remove";
          removeBtn.setAttribute("aria-label", `移除 ${item.file.name || "视频"}`);
          removeBtn.title = "从多选中移除";
          removeBtn.textContent = "×";
          removeBtn.disabled = vbbBusy || vbbEditOpening;
          removeBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            removeVbbBatchItem(idx).catch((err) => setError(vbbError, err.message || String(err)));
          });
          const handle = document.createElement("span");
          handle.className = "vbb-batch-row-handle";
          handle.title = "拖拽排序";
          handle.setAttribute("aria-hidden", "true");
          handle.textContent = "⋮⋮";
          const actions = document.createElement("div");
          actions.className = "vbb-batch-row-actions";
          actions.appendChild(upBtn);
          actions.appendChild(downBtn);
          actions.appendChild(previewBtn);
          if (!isVbbManualMode()) actions.appendChild(btn);
          actions.appendChild(removeBtn);
          row.draggable = !(vbbBusy || vbbEditOpening);
          row.appendChild(handle);
          row.appendChild(main);
          row.appendChild(actions);
          row.addEventListener("click", () => {
            if (vbbBusy) return;
            selectVbbBatchItem(idx).catch((err) => setError(vbbError, err.message || String(err)));
          });
          vbbBatchList.appendChild(row);
        });
        if (!opts.keepSelection && vbbEditBatchIdx < 0 && vbbBatchFiles.length) {
          // 首次渲染由调用方 select；此处不自动异步选中，避免重复
        }
      }
  
      function syncVbbBatchMeta() {
        if (!vbbMeta) return;
        if (!isVbbBatchMode()) return;
        const totalDur = vbbBatchFiles.reduce((sum, item) => sum + item.duration, 0);
        const totalSize = vbbBatchFiles.reduce((sum, item) => sum + (item.file.size || 0), 0);
        const edited = vbbBatchFiles.filter((item) =>
          vbbEditIsDirty(item.edit, item.duration, item.srcW, item.srcH)
        ).length;
        const marked = countVbbBatchManualSegments();
        const tip = isVbbManualMode()
          ? ` · 打点仅作用于当前视频${marked ? ` · 共 ${marked} 段` : ""} · ↑↓/拖拽排序 · 点 × 可移除`
          : ` · ↑↓/拖拽排序 · 点「编辑」裁时长/画面 · 点 × 可移除`;
        vbbMeta.replaceChildren();
        vbbMeta.append(
          `已选 ${vbbBatchFiles.length} 个视频 · 共 ${totalDur.toFixed(1)}s · ${formatKb(totalSize)}`
        );
        if (edited && !isVbbManualMode()) {
          const tag = document.createElement("span");
          tag.className = "vbb-edit-badge";
          tag.textContent = `已编辑 ${edited} 个`;
          vbbMeta.append(" · ", tag);
        }
        vbbMeta.append(tip);
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
        // 一键黑盒：进度只放在每个 GIF 卡片里，总进度条不显示
        if (vbbSuppressGlobalProgress) {
          if (!vbbProgress.hidden) {
            vbbProgress.hidden = true;
            if (vbbProgressFill) {
              vbbProgressFill.style.width = "0%";
              vbbProgressFill.classList.remove("is-active", "is-busy");
            }
            if (vbbProgressPct) vbbProgressPct.hidden = true;
            if (vbbProgressSub) {
              vbbProgressSub.hidden = true;
              vbbProgressSub.classList.remove("is-empty");
            }
          }
          return;
        }
        // 进度 UI 节流：中间态最多 ~90ms 刷一次，隐藏/0/100% 等重要更新不节流（省手机 CPU/防卡顿）
        const r = Number(ratio) || 0;
        const important = !visible || r <= 0 || r >= 1;
        const now = Date.now();
        if (!important && now - (setVbbProgress._last || 0) < 90) return;
        setVbbProgress._last = now;
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
          bits.push(blob.size <= V2G_BLACKBOX_MAX_BYTES ? `≤${blackboxBudgetLabel()}` : `仍超 ${blackboxBudgetLabel()}`);
          vbbMergedMeta.textContent = bits.join(" · ");
        }
        if (vbbResultBlock) vbbResultBlock.hidden = false;
      }
  
      function setVbbClipJob(idx, patch = {}) {
        const c = vbbClips[idx];
        if (!c) return;
        if (patch.status != null) {
          c.jobStatus = patch.status;
          if (patch.status === "running" && !c.jobStartedAt) {
            c.jobStartedAt = Date.now();
          }
          if (patch.status === "done" || patch.status === "error") {
            if (c.jobStartedAt) {
              c.encodeMs = Math.max(0, Date.now() - c.jobStartedAt);
            }
            c.jobStartedAt = 0;
          }
          if (patch.status === "pending") {
            c.jobStartedAt = 0;
            c.encodeMs = 0;
          }
        }
        if (patch.progress != null) c.jobProgress = Math.max(0, Math.min(1, Number(patch.progress) || 0));
        if (patch.text != null) {
          c.jobText = vbbStageText(String(patch.text || "")) || String(patch.text || "");
        }
        const row = vbbList?.querySelector(`[data-vbb-clip="${idx}"]`);
        if (row && !(vbbBusy && isVbbUserScrolling() && patch.status !== "done" && patch.status !== "error")) {
          syncClipProgressDom(row.querySelector(".vsplit-clip-progress"), c);
        }
        if (c.jobStatus === "pending" || c.jobStatus === "running") startVbbWaitClock();
      }

      function clearVbbClipJobs() {
        stopVbbWaitClock();
        vbbClips.forEach((c) => {
          c.jobStatus = "";
          c.jobProgress = 0;
          c.jobText = "";
          c.jobStartedAt = 0;
          c.jobQueuedAt = 0;
          c.encodeMs = 0;
        });
      }

      let vbbWaitClockTimer = 0;
      function stopVbbWaitClock() {
        if (vbbWaitClockTimer) {
          clearInterval(vbbWaitClockTimer);
          vbbWaitClockTimer = 0;
        }
      }
      function startVbbWaitClock() {
        if (vbbWaitClockTimer) return;
        vbbWaitClockTimer = setInterval(() => {
          if (typeof isVbbUserScrolling === "function" && isVbbUserScrolling()) return;
          let live = false;
          vbbClips.forEach((c, i) => {
            if (c.jobStatus !== "pending" && c.jobStatus !== "running") return;
            live = true;
            const progressText =
              typeof formatClipProgressText === "function"
                ? formatClipProgressText(c)
                : formatPendingWaitText(c);
            if (!progressText) return;
            const row = vbbList?.querySelector(`[data-vbb-clip="${i}"]`);
            if (!row) return;
            const textEl = row.querySelector(".vsplit-clip-progress-text");
            if (textEl) textEl.textContent = progressText;
            const meta = row.querySelector(".vbb-clip-meta");
            if (meta && !c.gifBlob) {
              if (c.jobStatus === "pending") {
                meta.textContent = formatPendingWaitText(c) || progressText;
              } else {
                const stage = String(c.jobText || "").trim();
                meta.textContent = stage && stage !== "等待中…" ? stage : progressText;
              }
            }
          });
          if (!live) stopVbbWaitClock();
        }, 250);
      }
      function vbbPendingJobFields() {
        return {
          jobStatus: "pending",
          jobProgress: 0,
          jobText: "等待中…",
          jobQueuedAt: Date.now(),
          jobStartedAt: 0,
          encodeMs: 0,
        };
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
        // UI 帧率用成片有效播放 fps（GIF 厘秒量化后）
        const play = Number(encoded.playbackFps) || (typeof gifEffectivePlaybackFps === "function" ? gifEffectivePlaybackFps(encoded.fps) : 0);
        clip.gifFps = play || Number(encoded.fps) || 0;
        clip.gifSpeed = Math.max(1, Number(encoded.speed) || 1);
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
          const qm = part.match(/^画质\s*(\d+)/);
          if (qm) {
            out.push(`画质${qm[1]}`);
            continue;
          }
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
  
      /** 紧凑体积：6.00 MB → 10MB / 55.7 KB → 56KB */
      function fmtShortBytes(n) {
        const b = Math.max(0, Number(n) || 0);
        if (b >= 1024 * 1024) {
          const mb = b / 1024 / 1024;
          return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10}`.replace(/\.0$/, "") + "MB";
        }
        return `${Math.max(1, Math.round(b / 1024))}KB`;
      }

      function formatVbbClipMeta(c, { mobile = false } = {}) {
        if (c.error && !c.gifBlob) return c.error;
        if (!c.gifBlob) {
          if (c.jobStatus === "pending") {
            return formatPendingWaitText(c) || c.jobText || "";
          }
          if (c.jobStatus === "running") {
            const stage = String(c.jobText || "").trim();
            if (stage && stage !== "等待中…") return stage;
            return typeof formatClipProgressText === "function"
              ? formatClipProgressText(c)
              : stage || "";
          }
          return c.error || "";
        }
        // 顺序固定：帧率 · 尺寸 · 体积 · 时长（其余附加信息尽量少）
        const bits = [];
        const fps = Number(c.gifFps) || 0;
        const speed = Math.max(1, Number(c.gifSpeed) || 1);
        if (fps) {
          if (speed > 1.02) {
            bits.push(`${fps}FPS·${speed.toFixed(1)}×倍速`);
          } else {
            bits.push(`${fps}FPS`);
          }
        }
        const w = Number(c.gifOutW) || 0;
        const h = Number(c.gifOutH) || 0;
        if (w && h) bits.push(`${w}×${h}`);
        bits.push(fmtShortBytes(c.gifBlob.size));
        const videoSec = Number(c.gifDuration) > 0 ? Number(c.gifDuration) : Number(c.span) || 0;
        if (videoSec > 0) bits.push(formatVsplitSpanSec(videoSec));
        const extra = simplifyVbbGifNote(c.gifNote, { mobile });
        if (extra) {
          extra.split(" · ").forEach((part) => {
            if (!part) return;
            if (/^\d+\s*×\s*\d+$/.test(part) || /^GIF\s*\d+×\d+$/.test(part)) return; // 尺寸已在前面
            if (/^\d+\s*FPS$/i.test(part)) return; // 帧率已在最前
            if (/^宽/.test(part)) return; // 宽度不再展示
            if (/^已压|^超限|^已抽稀|^降宽|^沿用|^耗时|^加速|^已重启|^画质|^\d+\s*色/.test(part)) bits.push(part);
          });
        }
        if (c.error) bits.push(c.error);
        return bits.join(" · ");
      }
  
      function applyVbbClipEncoded(clip, encoded, extraBits = []) {
        if (!clip || !encoded?.blob) return;
        // 硬闸：超上限绝不挂成功下载（编码层也会抛错；此处双保险）
        if (encoded.blob.size > V2G_BLACKBOX_MAX_BYTES) {
          clip.gifBlob = null;
          clip.gifUrl = "";
          clip.error = `超过 ${blackboxBudgetLabel()}（${formatKb(encoded.blob.size)}）· 未交付下载`;
          clip.gifNote = "";
          attachVbbEncodedMeta(clip, encoded);
          return;
        }
        clip.error = "";
        clip.gifBlob = encoded.blob;
        clip.gifUrl = "";
        attachVbbEncodedMeta(clip, encoded);
        const bits = [];
        extraBits.forEach((b) => {
          if (b) bits.push(b);
        });
        const fpsLabel =
          typeof formatBlackboxFpsLabel === "function"
            ? formatBlackboxFpsLabel(encoded)
            : encoded.fps
              ? `${encoded.fps} FPS`
              : "";
        if (fpsLabel) bits.push(fpsLabel.replace(/FPS$/i, "FPS"));
        if (encoded.outW && encoded.outH) bits.push(`${encoded.outW}×${encoded.outH}`);
        // 质量档位：gifski 显示自适应量化 quality，ffmpeg 回退显示色数
        if (encoded.engine === "gifski" && Number.isFinite(Number(encoded.gifskiQuality))) {
          bits.push(`画质 ${Number(encoded.gifskiQuality)}${encoded.quality > 1 ? `(档${encoded.quality})` : ""}`);
        } else if (encoded.maxColors) {
          bits.push(`${encoded.maxColors} 色`);
        }
        if (encoded.vbbPickNote) bits.push(encoded.vbbPickNote);
        if (encoded.compressRounds > 0) bits.push(`已压 ${encoded.compressRounds} 轮`);
        if (encoded.maxW) bits.push(`宽≤${encoded.maxW}`);
        if (encoded.framesCapped && encoded.frameCount) bits.push(`已抽稀 ${encoded.frameCount} 帧`);
        clip.gifNote = bits.filter(Boolean).join(" · ");
      }
  
      function clearVbbResults() {
        stopVbbWaitClock();
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
          // 多选不强制每条都有打点（未打点的走整段/编辑）；单文件手动模式仍需至少一段
          const manualNeedMarks = isVbbManualMode() && !isVbbBatchMode() && manualCount < 1;
          vbbOneclick.hidden = isVbbSplitMode();
          vbbOneclick.disabled = !hasVideo || vbbBusy || manualNeedMarks || isVbbSplitMode();
          if (isVbbBatchMode()) {
            if (isVbbManualMode()) {
              const segs = countVbbBatchManualSegments();
              vbbOneclick.textContent = segs > 0
                ? `一键黑盒（${vbbBatchFiles.length} 个 · ${segs} 段）`
                : `一键黑盒（${vbbBatchFiles.length} 个）`;
            } else {
              vbbOneclick.textContent = `一键黑盒（${vbbBatchFiles.length} 个）`;
            }
          } else if (isVbbManualMode()) {
            vbbOneclick.textContent = manualCount > 0 ? `一键黑盒（${manualCount} 段）` : "一键黑盒";
          } else {
            vbbOneclick.textContent = "一键黑盒";
          }
        }
        if (vbbAnalyze) vbbAnalyze.disabled = !hasVideo || vbbBusy || isVbbBatchMode() || isVbbManualMode();
        const mergeVideoBtn = $("#vbb-merge-video");
        if (mergeVideoBtn) {
          // 仅在「整段视频」流程（含多选整段）出现；切片/打点模式隐藏
          mergeVideoBtn.hidden = isVbbSplitMode() || isVbbManualMode();
          mergeVideoBtn.disabled = !isVbbBatchMode() || vbbBusy;
        }
        if (vbbRun) {
          vbbRun.disabled = !hasPlan || vbbBusy || isVbbBatchMode() || isVbbManualMode();
          vbbRun.classList.toggle("is-ready", hasPlan && !vbbBusy && isVbbSplitMode());
        }
        // 合并 GIF：只要有 ≥2 个已生成的 GIF 就能合并（批量模式下同样可用）
        if (vbbMerge) vbbMerge.disabled = gifCount < 2 || vbbBusy;
        if (vbbZip) vbbZip.disabled = gifCount < 1 || vbbBusy;
        if (isVbbManualMode()) paintVbbManualControls();
      }
  
      function syncVbbWorkflowUi() {
        const batch = isVbbBatchMode();
        const workflowRow = document.querySelector(".blackbox-workflow-row");
        if (workflowRow) workflowRow.hidden = false;
        const splitBtn = $("#vbb-workflow-split");
        if (splitBtn) {
          // 多选时隐藏「长视频切片」入口（非 disabled）；单文件长视频仍显示
          splitBtn.hidden = batch;
          splitBtn.disabled = false;
          splitBtn.title = "";
          if (batch && vbbWorkflow === "split") vbbWorkflow = "single";
        }
        $("#vbb-workflow-single")?.classList.toggle("is-active", vbbWorkflow === "single");
        $("#vbb-workflow-split")?.classList.toggle("is-active", vbbWorkflow === "split");
        $("#vbb-workflow-manual")?.classList.toggle("is-active", vbbWorkflow === "manual");
        const showSplit = isVbbSplitMode();
        if (vbbSplitPanel) vbbSplitPanel.hidden = !showSplit;
        if (vbbWorkflowHint) {
          if (batch && isVbbManualMode()) {
            vbbWorkflowHint.textContent = VBB_BATCH_MANUAL_HINT;
          } else if (batch) {
            vbbWorkflowHint.textContent = isCoarsePointer()
              ? `多选下请用整段或手动打点。点「编辑」单独裁时长/裁画面；可切到「手动打点」按当前视频打点。手机一次只转一路，性能全给当前任务。`
              : `多选下请用整段或手动打点。点「编辑」单独裁时长/裁画面；可切到「手动打点」按当前视频打点。旗舰/桌面可并行 ${Math.max(1, Number(currentMediaPerf().batchConcurrency) || 1)} 路（均衡/省电仍逐个）。`;
          } else {
            vbbWorkflowHint.textContent = VBB_WORKFLOW_HINTS[vbbWorkflow] || VBB_WORKFLOW_HINTS.single;
          }
        }
        if (vbbAdvanced) vbbAdvanced.hidden = isVbbManualMode() || batch;
        // 压时长对所有流程生效/显示（整段 / 手动打点 / 长视频切片 / 拼接后转黑盒）
        const speedRow = $("#vbb-speed-row");
        if (speedRow) speedRow.hidden = false;
        paintVbbManualUi();
        syncVbbEditUi();
        if (batch) {
          renderVbbBatchList({ keepSelection: true });
          syncVbbBatchMeta();
        }
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
        const hard = srcW > 0 ? srcW : V2G_BLACKBOX_WIDTH_HARD_FALLBACK;
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
          // 与 resolveBlackboxFpsList 保持一致，否则预估与实际不符
          return resolveBlackboxFpsList(span, 0);
        }
  
      /**
       * 对齐 encodeBlackboxClip 加宽：仅当当前体积 < 5MB 才尝试加宽，
       * 并取仍 ≤预算的最大宽（加宽重编码不带压缩）。
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
       * - ≤24s 从 15 起；≈30s 从 12 起（20 仅短片余量提帧，估算不预判）
       * - 每档先 420 宽；超限轻柔压缩；体积有余再加宽
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
            // 实装：轻压进预算后若有余量，会用不带压缩的更宽重编码加宽（compressRounds 归零）
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
  
        return { bytes: maxBytes, fps: 12, compressRounds: 2, maxW: baseW };
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
        if (mode === "clarity") return `不压缩 · ≤${blackboxBudgetLabel()}`;
        if (mode === "sharp") return `缩短加宽 · 不压缩 · ≤${blackboxBudgetLabel()}`;
        if (mode === "duration")
          return `≤${blackboxBudgetLabel()}${compressTip}`;
        if (targetSpan < clarityMax - 0.05) {
          return `短于清晰档 · 目标宽${maxW || "?"} · 不压缩`;
        }
        if (targetSpan <= clarityMax + 0.05) return "接近清晰优先 · 尽量不压缩";
        if (targetSpan <= durationMax + 0.05) {
          return `超过清晰安全时长 · 走黑盒（预计 ${fps}FPS${compressTip}）`;
        }
        return `目标偏长 · 走黑盒（预计 ${fps}FPS${compressTip}），个别段可能接近 ${blackboxBudgetLabel()} 上限`;
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
          note = `${note} · 预估超 ${blackboxBudgetLabel()}`;
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
          `宽${maxW} · 缩短加宽 · 不压缩 · ≤${blackboxBudgetLabel()}`,
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
          `宽420 · 贴紧${blackboxBudgetLabel()} · 不压缩`,
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
        const shareOk = typeof preferShareToGallery === "function" && preferShareToGallery();
        const dlBtn = document.createElement("button");
        dlBtn.type = "button";
        dlBtn.className = "secondary-btn";
        dlBtn.textContent = shareOk ? "分享到相册" : "下载 GIF";
        dlBtn.title = shareOk ? "调起系统分享，可选存到相册" : "";
        dlBtn.addEventListener("click", () => {
          if (!c.gifBlob) return;
          if (shareOk && typeof shareMediaBlob === "function") {
            shareMediaBlob(c.gifBlob, vbbGifDownloadName(c, idx), {
              title: vbbGifDownloadName(c, idx),
              fallbackDownload: true,
            }).then((r) => {
              if (r.shared) toast("已调起系统分享 · 可选存到相册");
            });
            return;
          }
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
          if (vbbClips.some((c) => c.jobStatus === "pending" || c.jobStatus === "running")) startVbbWaitClock();
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
        vbbEditBatchIdx = -1;
        vbbSingleEdit = null;
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
        clearVbbEditPreviewStyles();
        vbbEditSkipBusy = false;
        if (vbbFile) vbbFile.value = "";
        if (vbbAbort) vbbAbort.hidden = true;
        if (vbbPlan) vbbPlan.hidden = true;
        if (vbbPlanList) vbbPlanList.innerHTML = "";
        clearVbbMarks();
        clearTimeout(vbbSeekTimer);
        vbbSeekTimer = 0;
        vbbPendingSeek = null;
        flushVbbScrubSeek();
        setVbbProgress(false, 0, "");
        setError(vbbError, "");
        if (vbbMeta) vbbMeta.textContent = VBB_DEFAULT_META;
        renderVbbBatchList();
        syncVbbEditUi();
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
          const item = await probeVbbVideoFile(file);
          ensureVbbItemEdit(item);
          probed.push(item);
        }
        vbbBatchFiles = probed;
        renderVbbBatchList();
        syncVbbBatchMeta();
        setVbbButtons();
        await selectVbbBatchItem(0, { force: true });
        prefetchVbbVtrimEditor();
        toast("全部视频已就绪 · 可逐个预览/打点或「编辑」，点 × 可移除，再「一键黑盒」");
      }
  
      async function loadVbbFile(file) {
        if (!file) return;
        clearVbb();
        vbbBatchFiles = [];
        vbbEditBatchIdx = -1;
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
        vbbSingleEdit = makeVbbEditState(duration, vbbVideo.videoWidth, vbbVideo.videoHeight);
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
        syncVbbEditUi();
        syncVbbEditPreview();
        setVbbButtons();
        prefetchVbbVtrimEditor();
        toast(vbbWorkflow === "single" ? "视频已就绪 · 可点「编辑」裁时长/画面，再「一键黑盒」" : "视频已就绪，点「一键黑盒」即可");
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
          ...vbbPendingJobFields(),
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
          const vbbCrop = await vbbResolveCrop(vbbSourceFile);
          for (let i = 0; i < ranges.length; i++) {
            if (abortVbb) throw new Error("已取消");
            const r = ranges[i];
            const reuse = resolveVbbSegmentReuse(ranges, i, null, "blackbox", vbbSpeedFactorForSpan(r.span));
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
              qualityFirst: vbbQualityFirstOn(),
              isAborted: () => abortVbb,
              seed: reuse.seed || undefined,
              speedLimitSec: vbbSpeedLimitSec(),
              crop: vbbCrop,
              onProgress: (local, text) => {
                const p = (i + Math.min(0.98, local)) / ranges.length;
                const stage = bumpVbbEncodeProgress(p, vbbClipProgressLine(i, ranges.length, { reuse: Boolean(reuse.fromCache) }), text);
                setVbbClipJob(i, { status: "running", progress: Math.min(0.98, local), text: stage });
              },
            });
            if (abortVbb) throw new Error("已取消");
            applyVbbClipEncoded(vbbClips[i], encoded, reuse.fromCache ? ["沿用方案"] : []);
            if (vbbClips[i].error || !vbbClips[i].gifBlob) {
              setVbbClipJob(i, { status: "error", progress: 1, text: "失败" });
              refreshVbbClipRow(i);
              continue;
            }
            saveVbbSpanScheme(r.span, snapshotVbbEncodeSeed(encoded, {}), "blackbox");
            setVbbClipJob(i, { status: "done", progress: 1, text: "完成" });
            notifyVbbProgress(i, ranges.length);
            maybeAutoDownloadVbbGif(vbbClips[i], i);
            refreshVbbClipRow(i);
            if (mobile && i < ranges.length - 1) {
              await new Promise((r) => setTimeout(r, hugeFile ? 180 : 80));
            }
          }
          setVbbProgress(true, 1, `完成 · ${ranges.length} 段`);
          toast(
            isVbbAutoDlEachEnabled()
              ? `已完成 ${ranges.length} 段 · 已逐个自动下载`
              : `已完成 ${ranges.length} 段 · 可逐条下载或打包`
          );
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
  
      // 目标时长（秒）：0=不压缩时长；源更长则加速到该时长内
      function vbbSpeedLimitSec() {
        try {
          if (!$("#vbb-speed-limit")?.checked) return 0;
          const sec = Number($("#vbb-speed-sec")?.value);
          if (!(sec > 0)) return 0;
          return Math.max(3, Math.min(120, sec));
        } catch (_) {
          return 0;
        }
      }

      /** 完成通知：按范围设置决定「每个」还是「仅全部完成」 */
      function notifyVbbProgress(index, total) {
        try {
          DN.unlockAudio?.(); // 长任务后音频常被挂起，响前再解锁一次
          if (DN.scope?.() === "done") {
            if (Number(index) >= Number(total) - 1) DN.notifyDone?.();
          } else {
            DN.notifyDone?.();
          }
        } catch (_) {}
      }

      /** 处理期间防息屏 + 首次点击解锁提示音，结束后释放 */
      function withVbbWake(fn) {
        try { DN.unlockAudio?.(); } catch (_) {}
        try { DN.acquire?.(); } catch (_) {}
        return Promise.resolve()
          .then(fn)
          .finally(() => {
            try { DN.release?.(); } catch (_) {}
          });
      }

      // ---- 自动裁剪纯色边框（视频版「去色边」） ----
      const vbbCropCache = new Map();

      function vbbAutoCropEnabled() {
        return Boolean($("#vbb-auto-crop")?.checked);
      }

      function vbbColorsNear(a, b, tol) {
        return Math.abs(a.r - b.r) <= tol && Math.abs(a.g - b.g) <= tol && Math.abs(a.b - b.b) <= tol;
      }

      /** 从一帧里估算纯色边框，返回保留区域（不含边框）；无边则 null
       *  四边各自独立：任意纯色边（黑/白/灰/绿…）都能裁。
       *  防误裁：容差与离群从严、单边≤18%、回退 1px；雾气等「看起来像边」但不够纯的行会判失败。 */
      function detectFrameContentRect(img, tol) {
        const w = img.width;
        const h = img.height;
        const data = img.data;
        const px = (x, y) => {
          const i = (y * w + x) * 4;
          return { r: data[i], g: data[i + 1], b: data[i + 2] };
        };
        const near = (a, b) =>
          Math.abs(a.r - b.r) <= tol && Math.abs(a.g - b.g) <= tol && Math.abs(a.b - b.b) <= tol;
        /** 该行/该列是否「纯色」，是则返回平均色，否则 null。
         *  离群 ≤1.2%：只吞压缩噪点；真 letterbox 够平，雾气/渐变过不了。 */
        const OUTLIER_RATIO = 0.012;
        const lineColor = (get, n) => {
          let r = 0;
          let g = 0;
          let b = 0;
          for (let i = 0; i < n; i++) {
            const p = get(i);
            r += p.r;
            g += p.g;
            b += p.b;
          }
          const avg = { r: r / n, g: g / n, b: b / n };
          const limit = Math.max(1, Math.floor(n * OUTLIER_RATIO));
          let bad = 0;
          let maxDev = 0;
          for (let i = 0; i < n; i++) {
            const p = get(i);
            const dr = Math.abs(p.r - avg.r);
            const dg = Math.abs(p.g - avg.g);
            const db = Math.abs(p.b - avg.b);
            maxDev = Math.max(maxDev, dr, dg, db);
            if (!near(p, avg)) {
              bad += 1;
              if (bad > limit) return null;
            }
          }
          // 峰值偏差过大也不是「纯色边」（雾气横纹常有局部起伏）
          if (maxDev > tol + 6) return null;
          return avg;
        };
        const rowAt = (y) => (i) => px(i, y);
        const colAt = (x) => (i) => px(x, i);
        let top = 0;
        let bottom = h - 1;
        let left = 0;
        let right = w - 1;
        const cTop = lineColor(rowAt(0), w);
        const cBottom = lineColor(rowAt(h - 1), w);
        const cLeft = lineColor(colAt(0), h);
        const cRight = lineColor(colAt(w - 1), h);
        // 单边最多吃 18%：再深多半是内容区「碰巧纯色」，不是 letterbox
        const maxTop = Math.floor(h * 0.18);
        const maxBottom = Math.floor(h * 0.18);
        const maxLeft = Math.floor(w * 0.18);
        const maxRight = Math.floor(w * 0.18);
        if (cTop) {
          while (top < bottom && top < maxTop) {
            const c = lineColor(rowAt(top), w);
            if (!c || !near(c, cTop)) break;
            top++;
          }
        }
        if (cBottom) {
          while (bottom > top && h - 1 - bottom < maxBottom) {
            const c = lineColor(rowAt(bottom), w);
            if (!c || !near(c, cBottom)) break;
            bottom--;
          }
        }
        if (cLeft) {
          while (left < right && left < maxLeft) {
            const c = lineColor(colAt(left), h);
            if (!c || !near(c, cLeft)) break;
            left++;
          }
        }
        if (cRight) {
          while (right > left && w - 1 - right < maxRight) {
            const c = lineColor(colAt(right), h);
            if (!c || !near(c, cRight)) break;
            right--;
          }
        }
        // 回退 1px，避免贴齐内容抗锯齿被啃掉
        if (top > 0) top -= 1;
        if (bottom < h - 1) bottom += 1;
        if (left > 0) left -= 1;
        if (right < w - 1) right += 1;
        if (right <= left || bottom <= top) return null;
        if (top === 0 && left === 0 && right === w - 1 && bottom === h - 1) return null;
        return { left, top, right, bottom, w, h };
      }

      /** 采样多帧取「内容并集」（各边取最浅裁），只裁所有帧都同意是边框的区域；无边框返回 null */
      async function detectVideoCrop(file) {
        if (!file) return null;
        // v5：任意纯色边 + 严纯度；编辑只裁时长时不走自动裁（见 resolveVbbEncodeCrop）
        const cacheKey = `v5|${file.name}|${file.size}|${file.lastModified || 0}`;
        if (vbbCropCache.has(cacheKey)) return vbbCropCache.get(cacheKey);
        let result = null;
        const url = URL.createObjectURL(file);
        const v = document.createElement("video");
        v.muted = true;
        v.playsInline = true;
        v.preload = "auto";
        v.src = url;
        try {
          await new Promise((resolve, reject) => {
            const to = setTimeout(() => reject(new Error("读取视频超时")), 30000);
            v.onloadeddata = () => { clearTimeout(to); resolve(); };
            v.onerror = () => { clearTimeout(to); reject(new Error("无法读取视频")); };
          });
          const vw = v.videoWidth || 0;
          const vh = v.videoHeight || 0;
          if (vw < 16 || vh < 16) throw new Error("视频尺寸无效");
          const cw = Math.min(360, vw);
          const ch = Math.max(1, Math.round(vh * (cw / vw)));
          const canvas = document.createElement("canvas");
          canvas.width = cw;
          canvas.height = ch;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          const dur = Number.isFinite(v.duration) ? v.duration : 0;
          const marks = dur > 0.6 ? [0.2, 0.5, 0.8].map((r) => Math.min(dur * r, Math.max(0, dur - 0.05))) : [0];
          let acc = null;
          let hits = 0;
          for (const t of marks) {
            await new Promise((resolve) => {
              if (Math.abs(v.currentTime - t) < 0.02) { resolve(); return; }
              const to = setTimeout(resolve, 8000);
              v.onseeked = () => { clearTimeout(to); resolve(); };
              try { v.currentTime = t; } catch (_) { clearTimeout(to); resolve(); }
            });
            ctx.drawImage(v, 0, 0, cw, ch);
            // tol 14：旧 24 在深色录屏里容易把导航栏/底栏当边框
            const rect = detectFrameContentRect(ctx.getImageData(0, 0, cw, ch), 14);
            if (!rect) continue;
            hits += 1;
            // 内容并集 = 各边取最小裁切量（任一帧有内容就保留）
            acc = acc
              ? {
                  left: Math.min(acc.left, rect.left),
                  top: Math.min(acc.top, rect.top),
                  right: Math.max(acc.right, rect.right),
                  bottom: Math.max(acc.bottom, rect.bottom),
                  w: rect.w,
                  h: rect.h,
                }
              : rect;
          }
          if (acc && hits > 0 && acc.right > acc.left && acc.bottom > acc.top) {
            const sx = vw / acc.w;
            const sy = vh / acc.h;
            const x = Math.max(0, Math.round(acc.left * sx));
            const y = Math.max(0, Math.round(acc.top * sy));
            let w = Math.round((acc.right - acc.left + 1) * sx);
            let h = Math.round((acc.bottom - acc.top + 1) * sy);
            if (x + w > vw) w = vw - x;
            if (y + h > vh) h = vh - y;
            // 至少裁掉 6 源像素才算有效，避免缩略图取整抖一下
            if (w >= 8 && h >= 8 && (w < vw - 6 || h < vh - 6)) result = { x, y, w, h };
          }
        } catch (_) {
          result = null;
        } finally {
          try { URL.revokeObjectURL(url); } catch (_) {}
          try { v.removeAttribute("src"); v.load(); } catch (_) {}
        }
        vbbCropCache.set(cacheKey, result);
        return result;
      }

      /** 按开关取裁剪矩形（关闭时 null） */
      async function vbbResolveCrop(file) {
        if (!vbbAutoCropEnabled()) return null;
        try {
          return await detectVideoCrop(file);
        } catch (_) {
          return null;
        }
      }

      /**
       * 拼接中间片帧率：保留片源帧率（常见 25/30），不要压成黑盒主档 20。
       * 旧逻辑 blackboxPrimaryFps(总时长) 会把 25fps 源抽成 20 → 预览/GIF 都「一顿一顿」。
       * 抽到黑盒目标帧率只在转 GIF 时做一次。
       */
      async function resolveVbbMergeFps(items) {
        let maxFps = 0;
        await Promise.all(
          (items || []).map(async (item) => {
            let f = Number(item?.srcFps) || 0;
            if (!(f >= 5) && item?.file && typeof detectSourceFps === "function") {
              f = Number(await detectSourceFps(item.file).catch(() => 0)) || 0;
              if (f >= 5) item.srcFps = f;
            }
            if (f > maxFps) maxFps = f;
          })
        );
        if (!(maxFps >= 12)) maxFps = 30; // 探测失败时用 30，避免默认 20 误伤 25 源
        // 片源已是清晰整数（25/30）时直接用，勿再「就近吸附」误收到 24
        const rounded = Math.round(maxFps);
        if (Math.abs(maxFps - rounded) <= 0.6) {
          return Math.max(12, Math.min(60, rounded));
        }
        const common = [24, 25, 30, 50, 60];
        let best = rounded;
        let bestDist = Infinity;
        for (const c of common) {
          const d = Math.abs(maxFps - c);
          if (d <= 1.25 && d < bestDist - 1e-9) {
            best = c;
            bestDist = d;
          }
        }
        return Math.max(12, Math.min(60, best));
      }

      // 把已选的多个视频按顺序拼接成一个 MP4，再走单段黑盒。
      // 产品硬约定：始终「多段 → 一条中间 MP4 → 一条 GIF」；不分段各出一条 GIF。
      // 只要画面；中间片保留源帧率（25/30…），转 GIF 时再抽到黑盒档，避免双重/错误抽帧顿挫。
      // 各段若做过「编辑」（裁时长/裁画面），拼接时一并带上。
      async function mergeVbbVideosToOne() {
        if (!isVbbBatchMode() || vbbBusy) return;
        abortVbb = false;
        vbbBusy = true;
        setVbbButtons();
        if (vbbAbort) vbbAbort.hidden = false;
        setError(vbbError, "");
        const items = vbbBatchFiles.slice();
        const total = items.length;
        const names = [];
        try {
          await prewarmFfmpegEngine().catch(() => {});
          const ffmpeg = await getFfmpegInstance();
          for (let i = 0; i < total; i++) {
            if (abortVbb) throw new Error("已取消");
            setVbbProgress(true, (i / total) * 0.45, `拼接 · 写入 ${i + 1}/${total}`, {
              sub: items[i].file.name,
              busy: true,
            });
            const ext = v2gSourceExt(items[i].file);
            const nm = `mj${i}.${ext}`;
            await ffmpeg.writeFile(nm, await fetchFileBytes(items[i].file));
            names.push(nm);
          }
          const W = Math.max(2, Math.round((items[0].srcW || 1280) / 2) * 2);
          const H = Math.max(2, Math.round((items[0].srcH || 720) / 2) * 2);
          const wins = [];
          for (let i = 0; i < total; i++) {
            const item = items[i];
            ensureVbbItemEdit(item);
            const win = resolveVbbEncodeEdits(item, item.file, item.duration, item.srcW, item.srcH);
            let startSec = win.startSec;
            let span = win.span;
            if ((win.keepRanges?.length || 0) > 1) {
              setVbbProgress(true, 0.42 + (i / total) * 0.05, `拼接 · 应用删中间 ${i + 1}/${total}`, {
                sub: item.file.name,
                busy: true,
              });
              const mat = await materializeVbbKeepVideo(
                item.file,
                win.edit,
                item.srcW,
                item.srcH,
                item.duration,
                (p, t) =>
                  setVbbProgress(
                    true,
                    0.42 + (i / total) * 0.05 + Math.min(0.04, p * 0.04),
                    t || "删中间…",
                    { busy: true }
                  )
              );
              startSec = 0;
              span = mat.duration;
              const extM = v2gSourceExt(mat.file);
              const nmM = `mj${i}.${extM}`;
              await ffmpeg.writeFile(nmM, await fetchFileBytes(mat.file));
              try {
                await ffmpeg.deleteFile(names[i]);
              } catch (_) {}
              names[i] = nmM;
            }
            const crop =
              win.edit?.cropOn && win.edit.crop
                ? typeof normalizeV2gCrop === "function"
                  ? normalizeV2gCrop(win.edit.crop, item.srcW, item.srcH)
                  : win.edit.crop
                : null;
            wins.push({ ...win, startSec, span, crop });
          }
          setVbbProgress(true, 0.48, "拼接 · 探测片源帧率…", { busy: true });
          const mergeFps = await resolveVbbMergeFps(items);
          const vparts = names
            .map((_, i) => {
              const win = wins[i];
              const start = Math.max(0, Number(win.startSec) || 0);
              const span = Math.max(0.05, Number(win.span) || 0.05);
              const crop = win.crop
                ? `crop=${Math.max(2, win.crop.w)}:${Math.max(2, win.crop.h)}:${Math.max(0, win.crop.x)}:${Math.max(0, win.crop.y)},`
                : "";
              // 片尾按半开区间：duration 略短半帧，避免拼接后再转 GIF 多出片尾后画面
              const mergeDur = Math.max(0.05, span - 0.5 / mergeFps);
              // fps 放 trim/setpts 之后：先按源时间裁切，再统一到保留的片源帧率
              return (
                `[${i}:v]trim=start=${start}:duration=${mergeDur},setpts=PTS-STARTPTS,` +
                `${crop}scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
                `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,setsar=1,format=yuv420p,fps=${mergeFps}[v${i}]`
              );
            })
            .join(";");
          const vlist = names.map((_, i) => `[v${i}]`).join("");
          const baseArgs = [];
          names.forEach((nm) => baseArgs.push("-i", nm));
          const filter = `${vparts};${vlist}concat=n=${total}:v=1:a=0[v]`;
          const args = [
            ...baseArgs,
            "-filter_complex",
            filter,
            "-map",
            "[v]",
            "-an",
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-y",
            "merged.mp4",
          ];
          setVbbProgress(true, 0.5, `拼接编码中（保留 ${mergeFps}fps）…`, { busy: true });
          vbbLog(
            `[vbb-phase] 拼接中间片 ${mergeFps}fps（片源 ${items
              .map((it) => Number(it.srcFps) || "?")
              .join("+")}，不再压成黑盒主档）`
          );
          const code = await ffmpeg.exec(args).catch(() => 1);
          if (abortVbb) throw new Error("已取消");
          if (code !== 0) throw new Error(`拼接失败（code=${code}）`);
          const data = await ffmpeg.readFile("merged.mp4");
          const raw = data instanceof Uint8Array ? data : new Uint8Array(data);
          const bytes = new Uint8Array(raw.byteLength);
          bytes.set(raw);
          const blob = new Blob([bytes], { type: "video/mp4" });
          if (!blob.size) throw new Error("拼接结果为空");
          const mergedFile = new File([blob], `merged-${Date.now()}.mp4`, { type: "video/mp4" });
          setVbbProgress(true, 0.92, `拼接完成 · ${formatKb(blob.size)} · 开始转黑盒 GIF…`);
          vbbBusy = false;
          if (vbbAbort) vbbAbort.hidden = true;
          await loadVbbFile(mergedFile);
          toast("已拼接，开始生成黑盒 GIF…");
          await runVbbSingleBlackbox();
        } catch (err) {
          if (String(err?.message) !== "已取消") setError(vbbError, err.message || String(err));
          else toast("已取消");
          setVbbProgress(false, 0, "");
        } finally {
          try {
            for (const nm of names) await getFfmpegInstance().then((ff) => ff.deleteFile(nm)).catch(() => {});
            const ff = await getFfmpegInstance();
            await ff.deleteFile("merged.mp4");
          } catch (_) {}
          vbbBusy = false;
          resetVbbAbort();
          if (vbbAbort) vbbAbort.hidden = true;
          setVbbButtons();
        }
      }

      function isLikelyMemoryError(err) {
        const msg = String(err && (err.message || err) || "");
        return /memory|OOM|out of memory|Allocation failed|Array buffer allocation|Cannot allocate|oom/i.test(msg);
      }

      async function runVbbBatchBlackbox() {
        if (!isVbbBatchMode() || vbbBusy) return;
        persistActiveVbbMarks();
        abortVbb = false;
        vbbBusy = true;
        vbbSuppressGlobalProgress = true; // 只留卡片进度
        setVbbButtons();
        if (vbbAbort) vbbAbort.hidden = false;
        setError(vbbError, "");
        clearVbbResults();
        /** @type {{ item: any, startSec: number, span: number, edit: any, sourceName: string, fromMark: boolean }[]} */
        const jobs = [];
        vbbBatchFiles.forEach((item) => {
          ensureVbbItemEdit(item);
          const marks = completeMarksList(item.marks);
          if (vbbWorkflow === "manual" && marks.length) {
            marks.forEach((m, mi) => {
              jobs.push({
                item,
                startSec: m.start,
                span: Math.max(VBB_MIN_SPAN, m.end - m.start),
                edit: item.edit,
                sourceName: `${vbbGifBaseName(item.file)}-${String(mi + 1).padStart(2, "0")}`,
                fromMark: true,
              });
            });
            return;
          }
          const win = resolveVbbEncodeEdits(item, item.file, item.duration, item.srcW, item.srcH);
          jobs.push({
            item,
            startSec: win.startSec,
            span: win.span,
            edit: win.edit,
            sourceName: vbbGifBaseName(item.file),
            fromMark: false,
          });
        });
        const total = jobs.length;
        if (!total) {
          vbbBusy = false;
          vbbSuppressGlobalProgress = false;
          if (vbbAbort) vbbAbort.hidden = true;
          setVbbButtons();
          toast("没有可转换的片段");
          return;
        }
        vbbClips = jobs.map((job) => ({
          start: job.startSec,
          span: job.span,
          sourceName: job.sourceName,
          sourceFile: job.item.file.name || "video",
          gifBlob: null,
          gifUrl: "",
          gifNote: "",
          gifDuration: 0,
          error: "",
          ...vbbPendingJobFields(),
        }));
        renderVbbResults();
        let ok = 0;
        let doneCount = 0;
        const finishedIdx = new Set();
        // 沿用成功方案(fps/宽)：时长一致(±0.08s)时复用；并行时靠 span 缓存共享
        let reuseSeed = null;
        const pool = [];
        let conc = 1;
        try {
          await prewarmFfmpegEngine().catch(() => {});
          conc = resolveBatchConcurrency(total);
          // 旗舰/桌面：预开 N 路独立 FFmpeg Worker；gifski/gifsicle 仍上锁串行
          if (conc > 1 && typeof createFfmpegInstance === "function") {
            try {
              for (let s = 0; s < conc; s++) {
                if (abortVbb) throw new Error("已取消");
                pool.push(await createFfmpegInstance());
              }
              toast(`并行 ${conc} 路转换 · ${currentMediaPerf().label}`);
              vbbLog(`[vbb] batch parallel concurrency=${conc} total=${total}`);
            } catch (err) {
              vbbLog(`[vbb] parallel pool fail → serial: ${err?.message || err}`);
              while (pool.length) {
                try {
                  destroyFfmpegInstance?.(pool.pop());
                } catch (_) {}
              }
              conc = 1;
              toast("并行引擎启动失败 · 改为逐个转换");
            }
          }

          const encodeOne = async (i, ffmpegLease) => {
            if (abortVbb) throw new Error("已取消");
            const job = jobs[i];
            const item = job.item;
            setVbbClipJob(i, { status: "running", progress: 0.02, text: conc > 1 ? `并行编码…` : "准备编码…" });
              const win = { startSec: job.startSec, span: job.span, edit: job.edit };
              const cachedSeed = loadVbbSpanScheme(win.span, vbbSpeedFactorForSpan(win.span));
              const seedForItem =
                cachedSeed ||
                (reuseSeed && Math.abs((Number(reuseSeed.span) || 0) - (Number(win.span) || 0)) < 0.08
                  && Math.abs((Number(reuseSeed.speed) || 1) - vbbSpeedFactorForSpan(win.span)) < 0.05
                  ? reuseSeed
                  : null);
              const t0 = performance.now();
              const usedSeed = Boolean(seedForItem);
              try {
                // 串行才重启单例：并行用租赁实例，避免互踢
                if (conc <= 1 && i > 0 && !ffmpegLease) {
                  try {
                    terminateFfmpegInstance({ revokeAssets: false });
                  } catch (_) {}
                  await new Promise((r) => setTimeout(r, 50));
                }
                const prepared = await prepareVbbEncodeSource(
                  item.file,
                  win.edit,
                  item.srcW,
                  item.srcH,
                  item.duration,
                  {
                    fromMark: job.fromMark,
                    startSec: win.startSec,
                    span: win.span,
                    onProgress: (local, text) => {
                      setVbbClipJob(i, {
                        status: "running",
                        progress: Math.min(0.12, 0.02 + Math.min(0.1, local) * 0.1),
                        text: text || "应用删中间…",
                      });
                    },
                  }
                );
                // crop 相对原片坐标；删中间成片尺寸≈原片，仍用原宽高归一化
                const vbbCrop = await resolveVbbEncodeCrop(
                  item.file,
                  win.edit,
                  item.srcW,
                  item.srcH,
                  item.duration
                );
                const encoded = await encodeBlackboxClip({
                  file: prepared.file,
                  startSec: prepared.startSec,
                  span: prepared.span,
                  srcW: prepared.srcW,
                  srcH: prepared.srcH,
                  qualityFirst: vbbQualityFirstOn(),
                  seed: seedForItem,
                  speedLimitSec: vbbSpeedLimitSec(),
                  crop: vbbCrop,
                  ffmpeg: ffmpegLease || null,
                  isAborted: () => abortVbb,
                  onProgress: (local, text) => {
                    const stage = vbbTickerLine(text) || (conc > 1 ? "并行编码" : "编码");
                    setVbbClipJob(i, {
                      status: "running",
                      progress: Math.min(0.98, 0.12 + Math.min(0.86, local) * 0.86),
                      text: stage,
                    });
                    const overall = (doneCount + Math.min(0.95, Number(local) || 0)) / total;
                    setVbbProgress(true, overall, `批量转换 · ${doneCount}/${total}${conc > 1 ? ` · ${conc}路` : ""}`, {
                      sub: item.file.name,
                      busy: true,
                    });
                  },
                });
                if (abortVbb) throw new Error("已取消");
                applyVbbClipEncoded(vbbClips[i], encoded);
                if (encoded && encoded.fps) {
                  reuseSeed = {
                    fps: encoded.fps,
                    maxW: encoded.maxW,
                    span: prepared.span,
                    speed: Math.max(1, Number(encoded.speed) || 1),
                  };
                  saveVbbSpanScheme(prepared.span, reuseSeed, "blackbox");
                }
                const elapsedSec = (performance.now() - t0) / 1000;
                const editBits = [];
                if (job.fromMark) editBits.push("打点");
                if (prepared.startSec > 0.05 || Math.abs(prepared.span - item.duration) > 0.05) {
                  editBits.push(`裁 ${prepared.span.toFixed(1)}s`);
                }
                if (prepared.cutNote) editBits.push(prepared.cutNote);
                if (win.edit?.cropOn) editBits.push("裁画面");
                vbbClips[i].gifNote = [
                  vbbClips[i].gifNote,
                  ...editBits,
                  encoded.speed > 1 ? `加速${Number(encoded.speed).toFixed(1)}×` : "",
                  conc > 1 ? `${conc}路并行` : "",
                ]
                  .filter(Boolean)
                  .join(" · ");
                setVbbClipJob(i, { status: "done", progress: 1, text: "完成" });
                notifyVbbProgress(i, total);
                ok += 1;
                maybeAutoDownloadVbbGif(vbbClips[i], i);
                refreshVbbClipRow(i);
                vbbLog(
                  `[vbb] #${i + 1} ${usedSeed ? "seed" : "ladder"} ${Math.round(elapsedSec * 1000)}ms · ${encoded.fps}FPS · ${encoded.outW}×${encoded.outH} · ${formatKb(encoded.blob.size)} · ${encoded.compressRounds || 0}轮 · conc=${conc}`
                );
                return { ok: true };
            } catch (err) {
              if (String(err?.message) === "已取消") throw err;
              const elapsedSec = (performance.now() - t0) / 1000;
              vbbLog(`[vbb] #${i + 1} FAIL ${Math.round(elapsedSec * 1000)}ms · ${err?.message || err}`);
              vbbClips[i].error = err.message || String(err);
              setVbbClipJob(i, { status: "error", progress: 0, text: "失败" });
              refreshVbbClipRow(i);
              return { ok: false, memory: isLikelyMemoryError(err), err };
            } finally {
              if (!finishedIdx.has(i)) {
                finishedIdx.add(i);
                doneCount += 1;
              }
              setVbbProgress(true, doneCount / total, `批量转换 · ${doneCount}/${total}${conc > 1 ? ` · ${conc}路` : ""}`, {
                busy: doneCount < total,
              });
            }
          };

          if (conc <= 1) {
            for (let i = 0; i < total; i++) {
              if (abortVbb) throw new Error("已取消");
              await encodeOne(i, null);
            }
          } else {
            let nextIdx = 0;
            let forceSerialRest = false;
            const workers = Array.from({ length: conc }, (_, slot) =>
              (async () => {
                const lease = pool[slot] || null;
                while (true) {
                  if (abortVbb) throw new Error("已取消");
                  if (forceSerialRest) return;
                  const i = nextIdx++;
                  if (i >= total) return;
                  const result = await encodeOne(i, lease);
                  // 并行中途 OOM：停掉后续并行，剩余改串行（本 worker 退出；主流程再扫失败项）
                  if (result && result.memory) {
                    forceSerialRest = true;
                    vbbLog(`[vbb] parallel OOM at #${i + 1} → stop new parallel work`);
                    return;
                  }
                }
              })()
            );
            await Promise.all(workers);
            // 若 OOM 中断：对仍 pending 的条目串行补跑
            if (forceSerialRest) {
              toast("内存紧张 · 剩余改为逐个转换");
              while (pool.length) {
                try {
                  destroyFfmpegInstance?.(pool.pop());
                } catch (_) {}
              }
              conc = 1;
              for (let i = 0; i < total; i++) {
                if (abortVbb) throw new Error("已取消");
                if (vbbClips[i]?.gifBlob || vbbClips[i]?.jobStatus === "done") continue;
                if (vbbClips[i]?.error && !isLikelyMemoryError({ message: vbbClips[i].error })) continue;
                // 内存失败或未跑的：清错重试
                vbbClips[i].error = "";
                finishedIdx.delete(i);
                setVbbClipJob(i, { status: "pending", progress: 0, text: "串行补跑…" });
                await encodeOne(i, null);
              }
            }
          }

          if (abortVbb) throw new Error("已取消");
          renderVbbResults();
          setVbbProgress(true, 1, `批量完成 · ${ok}/${total}`);
          if (ok > 0) {
            const autoDl = isVbbAutoDlEachEnabled();
            toast(
              ok === total
                ? autoDl
                  ? `批量完成 · ${ok} 个 · 已逐个自动下载（仍可合并/打包）`
                  : `批量完成 · ${ok} 个 · 可在下方逐条下载或点「打包下载」`
                : autoDl
                  ? `批量完成 · 成功 ${ok}/${total} · 成功项已自动下载`
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
          while (pool.length) {
            try {
              destroyFfmpegInstance?.(pool.pop());
            } catch (_) {}
          }
          vbbBusy = false;
          vbbSuppressGlobalProgress = false;
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
          if (!vbbSingleEdit) vbbSingleEdit = makeVbbEditState(duration, srcW, srcH);
          const win = resolveVbbEncodeEdits({ edit: vbbSingleEdit, duration, srcW, srcH }, vbbSourceFile, duration, srcW, srcH);
          abortVbb = false;
          vbbBusy = true;
          vbbSuppressGlobalProgress = true; // 只留卡片进度
          setVbbButtons();
        if (vbbAbort) vbbAbort.hidden = false;
        setError(vbbError, "");
        clearVbbResults();
        vbbClips = [
          {
            start: win.startSec,
            span: win.span,
            sourceName: vbbGifBaseName(vbbSourceFile),
            gifBlob: null,
            gifUrl: "",
            gifNote: "",
            gifDuration: 0,
            error: "",
            ...vbbPendingJobFields(),
          },
        ];
        renderVbbResults();
        let durationLabel = `${win.span.toFixed(1)}s`;
        try {
          await prewarmFfmpegEngine().catch(() => {});
          bumpVbbEncodeProgress(0.03, "整段转换", "准备编码器…");
          setVbbClipJob(0, { status: "running", progress: 0.02, text: "准备编码…" });
          const prepared = await prepareVbbEncodeSource(
            vbbSourceFile,
            win.edit,
            srcW,
            srcH,
            duration,
            {
              startSec: win.startSec,
              span: win.span,
              onProgress: (local, text) => {
                const stage = bumpVbbEncodeProgress(Math.min(0.12, local * 0.12), "整段转换", text || "应用删中间…");
                setVbbClipJob(0, { status: "running", progress: Math.min(0.12, local * 0.12), text: stage });
              },
            }
          );
          durationLabel = `${prepared.span.toFixed(1)}s`;
          vbbClips[0].start = prepared.startSec;
          vbbClips[0].span = prepared.span;
          const vbbCrop = await resolveVbbEncodeCrop(
            vbbSourceFile,
            win.edit,
            srcW,
            srcH,
            duration
          );
          const encoded = await encodeBlackboxClip({
            file: prepared.file,
            startSec: prepared.startSec,
            span: prepared.span,
            srcW: prepared.srcW,
            srcH: prepared.srcH,
            qualityFirst: vbbQualityFirstOn(),
            speedLimitSec: vbbSpeedLimitSec(),
            crop: vbbCrop,
            isAborted: () => abortVbb,
            onProgress: (local, text) => {
              const p = Math.min(0.98, 0.12 + Math.min(0.86, local) * 0.86);
              const stage = bumpVbbEncodeProgress(p, "整段转换", text);
              setVbbClipJob(0, {
                status: "running",
                progress: Math.min(0.98, 0.12 + Math.min(0.86, local) * 0.86),
                text: stage,
              });
            },
          });
          if (abortVbb) throw new Error("已取消");
          applyVbbClipEncoded(vbbClips[0], encoded);
          const editBits = [];
          if (prepared.startSec > 0.05 || Math.abs(prepared.span - duration) > 0.05) {
            editBits.push(`裁 ${prepared.span.toFixed(1)}s`);
          }
          if (prepared.cutNote) editBits.push(prepared.cutNote);
          if (win.edit?.cropOn) editBits.push("裁画面");
          vbbClips[0].gifNote = [
            vbbClips[0].gifNote,
            ...editBits,
            encoded.speed > 1 ? `加速${Number(encoded.speed).toFixed(1)}×` : "",
          ]
            .filter(Boolean)
            .join(" · ");
          setVbbClipJob(0, { status: "done", progress: 1, text: "完成" });
          notifyVbbProgress(0, 1);
          maybeAutoDownloadVbbGif(vbbClips[0], 0);
          refreshVbbClipRow(0);
          const doneBits = [
            formatKb(encoded.blob.size),
            encoded.fps ? `${encoded.fps} FPS` : "",
            encoded.outW && encoded.outH ? `${encoded.outW}×${encoded.outH}` : "",
          ].filter(Boolean);
          setVbbProgress(true, 1, `完成 · ${doneBits.join(" · ")}`, { sub: `时长 ${durationLabel}` });
          toast(
            isVbbAutoDlEachEnabled()
              ? `已完成 · ${formatKb(encoded.blob.size)} · 已自动下载`
              : `已完成 · ${formatKb(encoded.blob.size)} · 可点下方「下载 GIF」`
          );
        } catch (err) {
          if (String(err?.message) !== "已取消") setError(vbbError, err.message || String(err));
          else toast("已取消");
          setVbbProgress(false, 0, "");
        } finally {
          vbbBusy = false;
          vbbSuppressGlobalProgress = false;
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
          const sample = await encodeBlackboxGif({
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
            `宽420 · 贴紧${blackboxBudgetLabel()} · 不压缩`,
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
            ...vbbPendingJobFields(),
          }));
          renderVbbResults();
          const vbbCrop = await vbbResolveCrop(vbbSourceFile);
          for (let i = 0; i < plan.ranges.length; i++) {
            if (abortVbb) throw new Error("已取消");
            const r = plan.ranges[i];
            const clip = vbbClips[i];
            const reuse = resolveVbbSegmentReuse(
              plan.ranges,
              i,
              firstSeed,
              plan.encode,
              vbbSpeedFactorForSpan(r.span)
            );
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
                  encodeBlackboxGif({
                    file: vbbSourceFile,
                    fps: reuseSeed?.fps || 15,
                    maxW,
                    quality: V2G_BLACKBOX_QUALITY,
                    startSec: r.start,
                    span: r.span,
                    srcW,
                    srcH,
                    speed: vbbSpeedFactorForSpan(r.span),
                    crop: vbbCrop,
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
                  const hardMax = srcW > 0 ? srcW : V2G_BLACKBOX_WIDTH_HARD_FALLBACK;
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
                    qualityFirst: vbbQualityFirstOn(),
                    isAborted,
                    seed: reuseSeed || null,
                    speedLimitSec: vbbSpeedLimitSec(),
                    crop: vbbCrop,
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
                  qualityFirst: vbbQualityFirstOn(),
                  isAborted,
                  seed: reuseSeed || null,
                  speedLimitSec: vbbSpeedLimitSec(),
                  crop: vbbCrop,
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
              if (encoded.blob.size > V2G_BLACKBOX_MAX_BYTES) {
                throw new Error(`仍超 ${blackboxBudgetLabel()}（${formatKb(encoded.blob.size)}）`);
              }
              attachVbbEncodedMeta(clip, encoded);
              // 延迟创建 ObjectURL：列表默认不解码预览
              clip.gifUrl = "";
              const bits = [];
              if (reuse.fromCache) bits.push("沿用方案");
              else if (reuseSeed) bits.push("沿用#01");
              if (usedFallback) bits.push("超限");
              else if (isWide && usedWidth !== (plan.maxW || V2G_BLACKBOX_BASE_W)) bits.push(`已降宽${usedWidth}`);
              if (encoded.fps) bits.push(`${encoded.playbackFps || encoded.fps}FPS`);
              if (encoded.outW && encoded.outH) bits.push(`${encoded.outW}×${encoded.outH}`);
              if (encoded.compressRounds > 0) bits.push(`已压 ${encoded.compressRounds} 轮`);
              if (encoded.maxW) bits.push(`宽≤${encoded.maxW}`);
              else if (isWide && !usedFallback) bits.push(`宽≤${usedWidth}`);
              if (encoded.framesCapped) bits.push(`已抽稀 ${encoded.frameCount} 帧`);
              clip.gifBlob = encoded.blob;
              clip.gifNote = bits.join(" · ");
              clip.error = "";
              if (i === 0) firstSeed = snapshotVbbEncodeSeed(encoded, { usedWidth, usedFallback });
              saveVbbSpanScheme(
                r.span,
                snapshotVbbEncodeSeed(encoded, { usedWidth, usedFallback }),
                usedFallback ? "blackbox" : activeEncode
              );
              setVbbClipJob(i, {
                status: "done",
                progress: 1,
                text: "完成",
              });
              notifyVbbProgress(i, plan.ranges.length);
              maybeAutoDownloadVbbGif(clip, i);
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
            if (typeof maybeAutoShareGallery === "function") {
              await maybeAutoShareGallery(
                gifs.map((x) => ({ name: vbbGifDownloadName(x.c, x.i), blob: x.c.gifBlob })),
                { zipName: "blackbox-clips.zip", title: "黑盒 GIF", zipBlobs }
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
        if (vbbBusy) return;
        if (blobs.length < 2) {
          // 原来是静默 return，点了像没反应 → 给出明确提示
          toast("至少要 2 条已生成的 GIF 才能合并");
          setError(vbbError, "至少要 2 条已生成的 GIF 才能合并");
          return;
        }
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
            const compressed = await M.compressExistingGifToBlackbox(blob, (ratio, text) =>
              setVbbProgress(true, 0.58 + ratio * 0.4, "压缩", { sub: vbbTickerLine(text), busy: ratio < 1 })
            , () => abortVbb);
            blob = compressed.blob;
            compressRounds = compressed.compressRounds || 0;
            if (!compressed.ok || blob.size > V2G_BLACKBOX_MAX_BYTES) {
              setError(
                vbbError,
                `合并后仍超 ${blackboxBudgetLabel()}（${formatKb(blob.size)}）· 已压 ${compressRounds} 轮，未提供下载。建议减少段数或缩短片段`
              );
              setVbbProgress(true, 1, `合并失败 · 仍超 ${blackboxBudgetLabel()}`);
              toast(`合并失败：仍超 ${blackboxBudgetLabel()}（${formatKb(blob.size)}）`);
              return;
            }
          }
          showVbbMergedBlock(blob, {
            beforeSize: mergedBefore,
            compressRounds,
            downloadName: "blackbox-merged.gif",
          });
          setVbbProgress(true, 1, `合并完成 · ${formatKb(blob.size)} · ≤${blackboxBudgetLabel()}`);
          toast("已合并为一条 GIF");
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
        try {
          revealAutoShareGalleryUi?.();
        } catch (_) {}
        vbbFile = $("#vbb-file", root);
        vbbVideo = $("#vbb-video", root);
        vbbMeta = $("#vbb-meta", root);
        const vbbMaxMb = $("#vbb-max-mb", root);
        if (vbbMaxMb) {
          const snapMb = (raw) => {
            const n = Math.max(1, Math.min(200, Number(raw) || 10));
            if (vbbMaxMb.tagName === "SELECT") {
              const opts = [...vbbMaxMb.options].map((o) => Number(o.value)).filter((x) => x > 0);
              if (!opts.includes(n)) {
                let best = opts[0] || 10;
                let bestD = Math.abs(best - n);
                for (const o of opts) {
                  const d = Math.abs(o - n);
                  if (d < bestD) {
                    best = o;
                    bestD = d;
                  }
                }
                return best;
              }
            }
            return n;
          };
          try { vbbMaxMb.value = String(snapMb(blackboxMaxMb())); } catch (_) {}
          vbbMaxMb.addEventListener("change", () => {
            const v = setBlackboxMaxMb(snapMb(vbbMaxMb.value));
            vbbMaxMb.value = String(v);
            toast(`黑盒上限已设为 ${v} MB`);
          });
        }
        const vbbQFirst = $("#vbb-quality-first", root);
        if (vbbQFirst) {
          try {
            vbbQFirst.checked = localStorage.getItem(VBB_QUALITY_FIRST_KEY) === "1";
          } catch (_) {}
          vbbQFirst.addEventListener("change", () => {
            try {
              localStorage.setItem(VBB_QUALITY_FIRST_KEY, vbbQFirst.checked ? "1" : "0");
            } catch (_) {}
            toast(
              vbbQFirst.checked
                ? "画质优先：全程守 ≥80 再降宽/降帧"
                : "已关画质优先：长片仍保流畅（可低于80）"
            );
          });
        }
        // ---- 性能档 + 分块编码（仅手机显示分块）：建议值预填 + 记住用户改过的值 ----
        (function bindVbbPerfAndChunk() {
          const perfEl = $("#vbb-perf", root);
          if (perfEl && typeof readMediaPerfMode === "function") {
            try { perfEl.value = readMediaPerfMode(); } catch (_) { perfEl.value = "auto"; }
            const tipPerf = () => {
              try {
                const p = mediaPerfProfile();
                toast(`性能：${p.label}（${p.tier}）· 帧上限 ${p.gifskiMaxFrames} · 加宽探 ${p.widenProbes} 次`);
              } catch (_) {}
            };
            perfEl.addEventListener("change", () => {
              const mode = setMediaPerfMode(perfEl.value);
              perfEl.value = mode;
              tipPerf();
              // 切换档位后刷新分块建议
              try { vbbVideo?.dispatchEvent(new Event("loadedmetadata")); } catch (_) {}
            });
          }
          const enable = $("#vbb-chunk-enable", root);
          const countEl = $("#vbb-chunk-count", root);
          const hintEl = $("#vbb-chunk-hint", root);
          if (!enable && !countEl) return;
          // 上次编码中途被系统杀掉（OOM）→ 自动调大分块数，避免再撞同一堵墙
          try {
            if (localStorage.getItem("devtools-vbb-running")) {
              localStorage.removeItem("devtools-vbb-running");
              const prev = readVbbChunkCfg();
              const next = Math.min(64, Math.max(2, (prev.count || 1) * 2));
              saveVbbChunkCfg({ on: true, count: next });
              setTimeout(() => toast(`上次处理因内存不足被系统中断，已把分块数调到 ${next}`), 400);
            }
          } catch (_) {}
          const cfg = readVbbChunkCfg();
          let userSet = cfg.count != null; // 用户手动改过 → 不再跟随建议值
          const hasSavedOn = (() => {
            try {
              const raw = localStorage.getItem(VBB_CHUNK_KEY);
              if (!raw) return false;
              const j = JSON.parse(raw);
              return Object.prototype.hasOwnProperty.call(j, "on");
            } catch (_) {
              return false;
            }
          })();
          if (enable) {
            if (hasSavedOn) enable.checked = cfg.on;
            else enable.checked = Boolean(currentMediaPerf().preferChunkByDefault);
          }
          if (countEl && userSet) countEl.value = String(cfg.count);
          const sync = () => {
            const rec = vbbRecommendChunkCount();
            if (countEl) {
              countEl.disabled = enable ? !enable.checked : false;
              // 未手改 → 用「自动」档，由编码器按内存预算分块
              if (!userSet) countEl.value = "";
            }
            if (hintEl) {
              hintEl.textContent = "";
              hintEl.hidden = true;
            }
          };
          const persist = () => {
            const raw = String(countEl && countEl.value != null ? countEl.value : "").trim();
            const n = Math.floor(Number(raw));
            saveVbbChunkCfg({ on: enable ? enable.checked : true, count: n >= 1 ? Math.min(64, n) : null });
          };
          enable?.addEventListener("change", () => { persist(); sync(); });
          countEl?.addEventListener("change", () => {
            userSet = String(countEl.value || "").trim() !== "";
            persist();
          });
          // 每换一支视频都重新按「当前视频」自动填写建议块数（上一支手改的值不沿用到新视频）
          vbbVideo?.addEventListener("loadedmetadata", () => { userSet = false; sync(); });
          sync();
        })();
        // ---- 多图 → GIF：只有一个「每张时长」输入，宽度/质量按黑盒规则自动 ----
        (function bindVbbImages() {
          const imagesPanel = $("#vbb-images-panel", root);
          const videoBtn = $("#vbb-input-video", root);
          const imagesBtn = $("#vbb-input-images", root);
          const fileInput = $("#vbb-img-file", root);
          const dropEl = $("#vbb-img-drop", root);
          const listEl = $("#vbb-img-list", root);
          const holdRange = $("#vbb-hold", root);
          const holdNum = $("#vbb-hold-num", root);
          const previewEl = $("#vbb-img-preview", root);
          const resultEl = $("#vbb-img-result", root);
          const resultWrap = $("#vbb-img-result-wrap", root);
          const fillSel = $("#vbb-fill", root);
          const metaEl = $("#vbb-img-meta", root);
          const genBtn = $("#vbb-img-generate", root);
          const dlEl = $("#vbb-img-download", root);
          const errEl = $("#vbb-img-error", root);
          const progEl = $("#vbb-img-progress", root);
          const progFill = $("#vbb-img-progress-fill", root);
          const progPct = $("#vbb-img-progress-pct", root);
          const progText = $("#vbb-img-progress-text", root);
          if (!imagesPanel || !holdRange || !fileInput) return;

          const MAX_IMAGES = 60;
          const st = {
            items: [],
            hold: 1,
            blob: null,
            url: "",
            playTimer: 0,
            playIdx: 0,
            encTimer: 0,
            gen: 0,
            busy: false,
            autoNote: "",
            fill: "auto",
            manualDone: false,
          };
          const setErr = (m) => setError(errEl, m || "");
          const setMeta = (m) => {
            if (metaEl) metaEl.textContent = m || "";
          };
          const setProg = (on, ratio, text) => {
            if (!progEl) return;
            progEl.hidden = !on;
            const r = Math.max(0, Math.min(1, Number(ratio) || 0));
            if (progFill) progFill.style.width = `${Math.round(r * 100)}%`;
            if (progPct) progPct.textContent = `${Math.round(r * 100)}%`;
            if (progText && text) progText.textContent = text;
          };
          const bytesOf = (data) => {
            const src = data instanceof Uint8Array ? data : new Uint8Array(data);
            const copy = new Uint8Array(src.byteLength);
            copy.set(src);
            return copy;
          };
          const fmt = (n) => (typeof formatKb === "function" ? formatKb(n) : `${Math.round(n / 1024)}KB`);

          function updateButtons() {
            const has = st.items.length > 0;
            // 生成按钮始终可点：自动预览编码期间点了就作废自动任务、立刻手动生成（不再等它跑完）
            if (genBtn) genBtn.disabled = !has;
            if (dlEl) dlEl.hidden = !(st.url && st.manualDone);
          }

          const previewNoteEl = $("#vbb-img-preview-note", root);
          const setPreviewNote = (m) => {
            if (previewNoteEl) previewNoteEl.textContent = m || "";
          };

          function clearItems() {
            stopPlay();
            window.clearTimeout(st.encTimer);
            st.gen += 1; // 作废在跑的编码
            st.items.forEach((it) => {
              try {
                URL.revokeObjectURL(it.url);
              } catch (_) {}
            });
            st.items = [];
            invalidateResult();
            if (previewEl) {
              previewEl.hidden = true;
              previewEl.removeAttribute("src");
            }
            setPreviewNote("");
            setProg(false, 0);
            renderList();
            updateButtons();
          }

          /** 图片集合变化 → 作废旧结果（并恢复自动预览编码） */
          function invalidateResult() {
            st.manualDone = false;
            if (st.url) {
              try {
                URL.revokeObjectURL(st.url);
              } catch (_) {}
            }
            st.url = "";
            st.blob = null;
            if (resultWrap) resultWrap.hidden = true;
            if (resultEl) {
              resultEl.hidden = true;
              resultEl.removeAttribute("src");
            }
            if (dlEl) {
              dlEl.hidden = true;
              dlEl.removeAttribute("href");
            }
          }

          function stopPlay() {
            if (st.playTimer) {
              clearInterval(st.playTimer);
              st.playTimer = 0;
            }
          }
          function startPlay() {
            stopPlay();
            if (!previewEl || st.items.length === 0) return;
            previewEl.hidden = false;
            st.playIdx = Math.min(st.playIdx, st.items.length - 1);
            previewEl.src = st.items[st.playIdx].url;
            setPreviewNote(`第 ${st.playIdx + 1}/${st.items.length} 张 · 每张 ${st.hold}s`);
            if (st.items.length < 2) return;
            st.playTimer = setInterval(() => {
              st.playIdx = (st.playIdx + 1) % st.items.length;
              try {
                previewEl.src = st.items[st.playIdx].url;
              } catch (_) {}
              setPreviewNote(`第 ${st.playIdx + 1}/${st.items.length} 张 · 每张 ${st.hold}s`);
            }, Math.max(100, Math.round(st.hold * 1000)));
          }

          function renderList() {
            if (!listEl) return;
            listEl.innerHTML = st.items
              .map(
                (it, i) =>
                  `<div class="vbb-img-item" data-i="${i}" draggable="true">` +
                  `<img src="${it.url}" alt="" loading="lazy" />` +
                  `<span class="vbb-img-name">${escapeHtml(String(it.file.name || "").slice(0, 18))}</span>` +
                  `<span class="vbb-img-ops">` +
                  `<button type="button" class="ghost-btn" data-img-move="-1" data-i="${i}" title="前移"${
                    i === 0 ? " disabled" : ""
                  }>‹</button>` +
                  `<button type="button" class="ghost-btn" data-img-move="1" data-i="${i}" title="后移"${
                    i === st.items.length - 1 ? " disabled" : ""
                  }>›</button>` +
                  `<button type="button" class="ghost-btn" data-img-rm="${i}" title="移除">✕</button>` +
                  `</span></div>`
              )
              .join("");
          }

          function scheduleEncode(delay = 520) {
            window.clearTimeout(st.encTimer);
            if (!st.items.length) return;
            // 点过「生成」后不再自动重编码：改时长只影响下次手动生成，预览保持不动
            if (st.manualDone) return;
            st.encTimer = window.setTimeout(() => void requestEncode(false), delay);
          }

          /** 取图片边缘平均色做填充色：尺寸不一时比纯黑边好看（自动，无需用户输入） */
          function edgeColorOf(ctx, w, h) {
            try {
              const pts = [];
              const step = Math.max(1, Math.floor(Math.min(w, h) / 24));
              for (let x = 0; x < w; x += step) {
                pts.push([x, 1], [x, h - 2]);
              }
              for (let y = 0; y < h; y += step) {
                pts.push([1, y], [w - 2, y]);
              }
              let r = 0;
              let g = 0;
              let b = 0;
              let n = 0;
              for (const [x, y] of pts) {
                const d = ctx.getImageData(Math.min(w - 1, Math.max(0, x)), Math.min(h - 1, Math.max(0, y)), 1, 1).data;
                r += d[0];
                g += d[1];
                b += d[2];
                n += 1;
              }
              if (!n) return "#000";
              return `rgb(${Math.round(r / n)},${Math.round(g / n)},${Math.round(b / n)})`;
            } catch (_) {
              return "#000";
            }
          }

          async function normalizePng(item, W, H, fill) {
            const bmp = await createImageBitmap(item.file);
            const canvas = document.createElement("canvas");
            canvas.width = W;
            canvas.height = H;
            const ctx = canvas.getContext("2d");
            if (fill !== "transparent") {
              // 填充色：自动 = 该图边缘平均色（比纯黑边好看）；黑/白按选择
              let pad = "#000";
              if (fill === "white") pad = "#fff";
              else if (fill !== "black") {
                const tmp = document.createElement("canvas");
                tmp.width = bmp.width;
                tmp.height = bmp.height;
                const tctx = tmp.getContext("2d");
                tctx.drawImage(bmp, 0, 0);
                pad = edgeColorOf(tctx, bmp.width, bmp.height);
              }
              ctx.fillStyle = pad;
              ctx.fillRect(0, 0, W, H);
            }
            const scale = Math.min(W / bmp.width, H / bmp.height);
            const dw = Math.max(1, Math.round(bmp.width * scale));
            const dh = Math.max(1, Math.round(bmp.height * scale));
            ctx.drawImage(bmp, Math.round((W - dw) / 2), Math.round((H - dh) / 2), dw, dh);
            bmp.close?.();
            return await new Promise((res) => canvas.toBlob((b) => res(b), "image/png"));
          }

          /** 一次编码：多图 → 调色板 GIF（temp 文件名带 runId，避免并发互相覆盖） */
          async function encodeOnce(ff, W, H, colors, onRatio, runId, fill) {
            const rid = String(runId || 0);
            const names = [];
            for (let i = 0; i < st.items.length; i += 1) {
              const nm = `vim-${rid}-${i}.png`;
              const png = await normalizePng(st.items[i], W, H, fill);
              await ff.writeFile(nm, await fetchFileBytes(png));
              names.push(nm);
              onRatio?.(0.1 + (i / st.items.length) * 0.35, `处理图片 ${i + 1}/${st.items.length}`);
            }
            const hold = Math.max(0.1, st.hold);
            onRatio?.(0.5, "编码 GIF…");
            // 透明填充需保留 alpha（GIF 只支持 1-bit 透明）
            const vf =
              fill === "transparent"
                ? `scale=${W}:${H}:flags=lanczos,split[a][b];` +
                  `[a]palettegen=max_colors=${colors}:stats_mode=full:reserve_transparent=1[p];` +
                  `[b][p]paletteuse=dither=sierra2:alpha_threshold=128:diff_mode=rectangle`
                : `scale=${W}:${H}:flags=lanczos,split[a][b];` +
                  `[a]palettegen=max_colors=${colors}:stats_mode=full[p];` +
                  `[b][p]paletteuse=dither=sierra2:diff_mode=rectangle`;
            // 用 image2 定帧率：每帧时长 = hold（精确，不会像 concat 那样多算末帧）
            const fps = Math.max(0.02, 1 / hold);
            const outName = `vim-out-${rid}.gif`;
            const code = await ff.exec([
              "-framerate", fps.toFixed(6),
              "-start_number", "0",
              "-i", `vim-${rid}-%d.png`,
              "-vf", vf,
              "-loop", "0", "-y", outName,
            ]);
            if (code !== 0) throw new Error(`编码失败（code=${code}）`);
            const data = await ff.readFile(outName);
            let blob = new Blob([bytesOf(data)], { type: "image/gif" });
            onRatio?.(0.75, "优化 GIF…");
            try {
              blob = await compressGifBlob(blob, "standard", () => {});
            } catch (_) {}
            for (const nm of names) {
              try {
                await ff.deleteFile(nm);
              } catch (_) {}
            }
            try {
              await ff.deleteFile(outName);
            } catch (_) {}
            return blob;
          }

          // 串行化：同一时刻只跑一个编码，避免「点生成」与防抖自动编码抢 ffmpeg 实例/临时文件
          let encodeChain = Promise.resolve();
          function requestEncode(isManual) {
            const myGen = ++st.gen; // 作废在跑/排队的旧任务
            encodeChain = encodeChain
              .catch(() => {})
              .then(() => (myGen === st.gen ? encode(isManual, myGen) : null))
              .catch(() => {});
            return encodeChain;
          }

          async function encode(isManual, myGen) {
            if (!st.items.length) return;
            st.busy = true;
            updateButtons();
            setErr("");
            if (isManual) setProg(true, 0.02, "准备…");
            try {
              const W0 = V2G_BLACKBOX_BASE_W;
              const colors0 = gifQualityToMaxColors(V2G_BLACKBOX_QUALITY);
              const first = st.items[0];
              const ratio0 = first.w > 0 && first.h > 0 ? first.h / first.w : 0.5625;
              const H0 = Math.max(2, Math.round((W0 * ratio0) / 2) * 2);
              const ff = await getFfmpegInstance((ratio, text) => {
                if (isManual) setProg(true, 0.02 + (Number(ratio) || 0) * 0.08, text || "加载编码器…");
              });
              let blob = await encodeOnce(ff, W0, H0, colors0, (r, t) => {
                if (isManual) setProg(true, r, t);
              }, myGen, st.fill);
              // 超黑盒上限 → 自动降级（先降宽度，再降色数）
              const budget = blackboxMaxMb() * 1024 * 1024;
              let W = W0;
              let colors = colors0;
              let round = 0;
              while (blob.size > budget && round < 5) {
                round += 1;
                W = Math.max(120, Math.round(W0 * Math.pow(0.82, round)));
                colors = round >= 3 ? Math.max(96, Math.round(colors0 / 2)) : colors0;
                const H = Math.max(2, Math.round((W * ratio0) / 2) * 2);
                if (isManual) setProg(true, 0.8, `超上限，自动降到 ${W}px / ${colors} 色…`);
                blob = await encodeOnce(ff, W, H, colors, () => {}, myGen, st.fill);
              }
              if (myGen !== st.gen) return; // 期间又改了时长 → 丢弃这次结果
              // 体积有余（< 上限的 5/6）→ 与黑盒视频一致：自动加宽，把预算用在清晰度上
              const widenGate = Math.round(budget * (5 / 6));
              let srcMinW = 0;
              try {
                const ws = st.items.map((i) => Number(i.w) || 0).filter((w) => w > 0);
                srcMinW = ws.length ? Math.min(...ws) : 0;
              } catch (_) {}
              if (blob.size < widenGate && srcMinW > W) {
                let lo = W;
                let hi = srcMinW;
                for (let i = 0; i < 6 && hi - lo > 16; i += 1) {
                  const mid = Math.max(lo + 2, Math.round((lo + hi) / 4) * 2);
                  if (mid >= hi) break;
                  if (isManual) setProg(true, 0.86, `有余量，加宽试探 ${mid}px…`);
                  const Hm = Math.max(2, Math.round((mid * ratio0) / 2) * 2);
                  const cand = await encodeOnce(ff, mid, Hm, colors, () => {}, myGen, st.fill);
                  if (myGen !== st.gen) return;
                  if (cand.size <= budget) {
                    blob = cand;
                    W = mid;
                    lo = mid;
                  } else {
                    hi = mid;
                  }
                }
              }
              if (myGen !== st.gen) return; // 期间又改了时长 → 丢弃这次结果
              if (blob.size > budget) {
                if (isManual) {
                  setErr(`无法压到 ${Math.round(budget / (1024 * 1024))}MB（当前 ${fmt(blob.size)}）· 未提供下载`);
                  setProg(false, 0);
                }
                return;
              }
              if (st.url) {
                try {
                  URL.revokeObjectURL(st.url);
                } catch (_) {}
              }
              st.blob = blob;
              st.url = URL.createObjectURL(blob);
              if (previewEl) {
                previewEl.hidden = false;
              }
              // 只有点「生成」才显示结果图（自动预览编码不出结果，避免提前出现）
              if (isManual) {
                if (resultWrap) resultWrap.hidden = false;
                if (resultEl) {
                  resultEl.hidden = false;
                  resultEl.src = st.url;
                }
                stopPlay(); // 生成后停止轮播，省电；改时长会重新开始
                if (dlEl) {
                  dlEl.hidden = false;
                  dlEl.href = st.url;
                  dlEl.download = `images-${st.items.length}x${String(st.hold).replace(".", "_")}s.gif`;
                }
              }
              setPreviewNote(`第 ${(st.playIdx || 0) + 1}/${st.items.length} 张 · 每张 ${st.hold}s`);
              st.autoNote = `自动：宽 ${W} · ${colors} 色`;
              const fpsTxt = String(Math.round((1 / Math.max(0.1, st.hold)) * 10) / 10);
              setMeta(
                `${st.items.length} 张 · 每张 ${st.hold}s · ${fpsTxt} fps · 共 ${(st.items.length * st.hold).toFixed(1)}s · ${st.autoNote} · ${fmt(
                  blob.size
                )}${round ? ` · 已自动降级 ${round} 次` : ""}`
              );
              setProg(false, 0);
            } catch (err) {
              if (isManual) setErr(err?.message || String(err));
              setProg(false, 0);
            } finally {
              st.busy = false;
              updateButtons();
            }
          }

          function syncHold(v, fromRange) {
            let n = Number(v);
            if (!Number.isFinite(n)) n = 1;
            // 白名单 0.5 步进（与下拉档位一致）
            n = Math.max(0.5, Math.min(5, Math.round(n * 2) / 2));
            st.hold = n;
            if (fromRange && holdNum) holdNum.value = String(n);
            if (!fromRange && holdRange) holdRange.value = String(n);
            startPlay();
            scheduleEncode();
          }

          function setMode(mode) {
            const images = mode === "images";
            root.classList.toggle("is-images-mode", images);
            imagesPanel.hidden = !images;
            videoBtn?.classList.toggle("is-active", !images);
            imagesBtn?.classList.toggle("is-active", images);
            if (images) {
              startPlay();
              scheduleEncode();
            } else {
              stopPlay();
            }
          }

          videoBtn?.addEventListener("click", () => setMode("video"));
          imagesBtn?.addEventListener("click", () => setMode("images"));

          fileInput.addEventListener("change", () => {
            void addFiles(fileInput.files);
            fileInput.value = "";
          });
          $("#vbb-img-clear", root)?.addEventListener("click", () => {
            clearItems();
            setMeta("拖入图片即可");
          });
          holdRange.addEventListener("input", () => syncHold(holdRange.value, true));
          holdNum?.addEventListener("change", () => syncHold(holdNum.value, false));
          holdNum?.addEventListener("input", () => syncHold(holdNum.value, false));
          // 填充方式：自动色（默认）/ 黑 / 白 / 透明
          if (fillSel) {
            try {
              const v = localStorage.getItem("devtools-vbb-img-fill");
              if (v) fillSel.value = v;
            } catch (_) {}
            st.fill = fillSel.value || "auto";
            fillSel.addEventListener("change", () => {
              st.fill = fillSel.value || "auto";
              try {
                localStorage.setItem("devtools-vbb-img-fill", st.fill);
              } catch (_) {}
              invalidateResult();
              if (!st.manualDone) scheduleEncode(200);
            });
          }
          genBtn?.addEventListener("click", () => {
            if (!st.items.length) {
              setErr("先拖入图片再生成");
              return;
            }
            // 自动预览编码还在跑 → 直接作废它并立刻手动生成（requestEncode 会 ++gen 作废旧任务）
            st.manualDone = true; // 之后改时长不再自动重编码
            void requestEncode(true);
          });
          listEl?.addEventListener("click", (e) => {
            const rm = e.target.closest?.("[data-img-rm]");
            if (rm) {
              const i = Number(rm.dataset.imgRm);
              const it = st.items[i];
              if (it) {
                try {
                  URL.revokeObjectURL(it.url);
                } catch (_) {}
                st.items.splice(i, 1);
              }
              invalidateResult();
              renderList();
              updateButtons();
              startPlay();
              scheduleEncode(200);
              return;
            }
            const mv = e.target.closest?.("[data-img-move]");
            if (mv) {
              const i = Number(mv.dataset.i);
              const dir = Number(mv.dataset.imgMove);
              const j = i + dir;
              if (j >= 0 && j < st.items.length) {
                const [it] = st.items.splice(i, 1);
                st.items.splice(j, 0, it);
                invalidateResult();
                renderList();
                startPlay();
                scheduleEncode(200);
              }
            }
          });
          // 拖拽排序（桌面）
          listEl?.addEventListener("dragover", (e) => {
            if (e.target.closest?.(".vbb-img-item")) e.preventDefault();
          });
          listEl?.addEventListener("drop", (e) => {
            e.preventDefault();
            const from = Number(e.dataTransfer?.getData("text/plain"));
            const to = Number(e.target.closest?.(".vbb-img-item")?.dataset?.i);
            if (!Number.isFinite(from) || !Number.isFinite(to) || from === to) return;
            const [it] = st.items.splice(from, 1);
            st.items.splice(to, 0, it);
            invalidateResult();
            renderList();
            scheduleEncode(200);
          });
          listEl?.addEventListener("dragstart", (e) => {
            const it = e.target.closest?.(".vbb-img-item");
            if (!it) return;
            try {
              e.dataTransfer.setData("text/plain", it.dataset.i);
            } catch (_) {}
          });

          // 面板拖入图片
          const panelEl = $("#vbb", root) || root;
          ["dragenter", "dragover"].forEach((ev) =>
            panelEl.addEventListener(ev, (e) => {
              if (!e.dataTransfer) return;
              e.preventDefault();
              dropEl?.classList.add("is-over");
            })
          );
          panelEl.addEventListener("dragleave", (e) => {
            if (e.target === panelEl || e.target === dropEl) dropEl?.classList.remove("is-over");
          });
          panelEl.addEventListener("drop", (e) => {
            dropEl?.classList.remove("is-over");
            const files = [...(e.dataTransfer?.files || [])];
            if (!files.length) return;
            const onlyImages = files.every(
              (f) => /^image\//.test(f.type || "") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name || "")
            );
            if (!onlyImages) return; // 视频交给原流程
            e.preventDefault();
            setMode("images");
            void addFiles(files);
          });

          async function addFiles(fileList) {
            const files = [...(fileList || [])].filter(
              (f) => /^image\//.test(f.type || "") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name || "")
            );
            if (!files.length) {
              setErr("没有可用的图片（支持 PNG / JPG / WebP / GIF / BMP）");
              return;
            }
            setErr("");
            const room = MAX_IMAGES - st.items.length;
            if (room <= 0) {
              setErr(`最多 ${MAX_IMAGES} 张`);
              return;
            }
            if (files.length > room) setErr(`最多 ${MAX_IMAGES} 张，已忽略多余的 ${files.length - room} 张`);
            for (const f of files.slice(0, room)) {
              const url = URL.createObjectURL(f);
              let w = 0;
              let h = 0;
              try {
                const bmp = await createImageBitmap(f);
                w = bmp.width;
                h = bmp.height;
                bmp.close?.();
              } catch (_) {}
              st.items.push({ file: f, url, w, h });
            }
            invalidateResult();
            renderList();
            updateButtons();
            startPlay();
            scheduleEncode();
          }

          // 初始：按黑盒默认值
          syncHold(holdRange.value, true);
          setMeta("拖入图片即可");
        })();

        const vbbSpeedChk = $("#vbb-speed-limit", root);
        const vbbSpeedSec = $("#vbb-speed-sec", root);
        const vbbAutoDlEach = $("#vbb-auto-dl-each", root);
        if (vbbAutoDlEach) {
          try {
            vbbAutoDlEach.checked = isVbbAutoDlEachEnabled();
          } catch (_) {}
          vbbAutoDlEach.addEventListener("change", () => {
            const on = Boolean(vbbAutoDlEach.checked);
            setVbbAutoDlEachEnabled(on);
            toast(on ? "已开启：每段 GIF 完成后立刻下载" : "已关闭：需手动下载或打包");
          });
        }
        if (vbbSpeedChk) {
          try { vbbSpeedChk.checked = localStorage.getItem("devtools-vbb-speed-on") === "1"; } catch (_) {}
          vbbSpeedChk.addEventListener("change", () => {
            try { localStorage.setItem("devtools-vbb-speed-on", vbbSpeedChk.checked ? "1" : "0"); } catch (_) {}
          });
        }
        if (vbbSpeedSec) {
          const snapSpeed = (raw) => {
            const n = Math.max(3, Math.min(120, Number(raw) || 20));
            if (vbbSpeedSec.tagName !== "SELECT") return n;
            const opts = [...vbbSpeedSec.options].map((o) => Number(o.value)).filter((x) => x > 0);
            if (opts.includes(n)) return n;
            let best = opts[0] || 20;
            let bestD = Math.abs(best - n);
            for (const o of opts) {
              const d = Math.abs(o - n);
              if (d < bestD) {
                best = o;
                bestD = d;
              }
            }
            return best;
          };
          try {
            const sv = localStorage.getItem("devtools-vbb-speed-sec");
            if (sv) vbbSpeedSec.value = String(snapSpeed(sv));
          } catch (_) {}
          vbbSpeedSec.addEventListener("change", () => {
            const v = snapSpeed(vbbSpeedSec.value);
            vbbSpeedSec.value = String(v);
            try { localStorage.setItem("devtools-vbb-speed-sec", String(v)); } catch (_) {}
          });
        }
        // 完成通知 / 防息屏设置（默认全开，范围默认「每个都提示」）
        const vbbWakeChk = $("#vbb-wake-lock", root);
        const vbbSoundChk = $("#vbb-notify-sound", root);
        const vbbVibChk = $("#vbb-notify-vibrate", root);
        const vbbScopeSel = $("#vbb-notify-scope", root);
        if (vbbWakeChk) {
          vbbWakeChk.checked = DN.wakeEnabled?.() ?? true;
          vbbWakeChk.addEventListener("change", () => DN.setWakeEnabled?.(vbbWakeChk.checked));
        }
        if (vbbSoundChk) {
          vbbSoundChk.checked = DN.soundEnabled?.() ?? true;
          vbbSoundChk.addEventListener("change", () => {
            DN.setSound?.(vbbSoundChk.checked);
            if (vbbSoundChk.checked) DN.unlockAudio?.();
          });
        }
        if (vbbVibChk) {
          vbbVibChk.checked = DN.vibrateEnabled?.() ?? true;
          vbbVibChk.addEventListener("change", () => {
            DN.setVibrate?.(vbbVibChk.checked);
            if (vbbVibChk.checked) {
              try { navigator.vibrate?.([80]); } catch (_) {}
            }
          });
        }
        if (vbbScopeSel) {
          vbbScopeSel.value = DN.scope?.() === "done" ? "done" : "each";
          vbbScopeSel.addEventListener("change", () => DN.setScope?.(vbbScopeSel.value));
        }
        const vbbCropChk = $("#vbb-auto-crop", root);
        if (vbbCropChk) {
          try { vbbCropChk.checked = localStorage.getItem("devtools-vbb-auto-crop") === "1"; } catch (_) {}
          vbbCropChk.addEventListener("change", () => {
            try { localStorage.setItem("devtools-vbb-auto-crop", vbbCropChk.checked ? "1" : "0"); } catch (_) {}
            toast(vbbCropChk.checked ? "已开启：自动裁纯色边" : "已关闭自动裁剪");
          });
        }
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
        if (vbbBatchList && !vbbBatchList.dataset.vbbSortBound) {
          vbbBatchList.dataset.vbbSortBound = "1";
          let dragFrom = -1;
          vbbBatchList.addEventListener("dragstart", (e) => {
            const row = e.target?.closest?.(".vbb-batch-row");
            if (!row || vbbBusy || vbbEditOpening) {
              e.preventDefault();
              return;
            }
            // 点按钮时不要开拖
            if (e.target?.closest?.("button")) {
              e.preventDefault();
              return;
            }
            dragFrom = Number(row.dataset.vbbBatchIdx);
            try {
              e.dataTransfer.effectAllowed = "move";
              e.dataTransfer.setData("text/plain", String(dragFrom));
            } catch (_) {}
            row.classList.add("is-dragging");
          });
          vbbBatchList.addEventListener("dragend", () => {
            dragFrom = -1;
            vbbBatchList.querySelectorAll(".vbb-batch-row.is-dragging, .vbb-batch-row.is-drag-over").forEach((el) => {
              el.classList.remove("is-dragging", "is-drag-over");
            });
          });
          vbbBatchList.addEventListener("dragover", (e) => {
            const row = e.target?.closest?.(".vbb-batch-row");
            if (!row) return;
            e.preventDefault();
            try {
              e.dataTransfer.dropEffect = "move";
            } catch (_) {}
            vbbBatchList.querySelectorAll(".vbb-batch-row.is-drag-over").forEach((el) => {
              if (el !== row) el.classList.remove("is-drag-over");
            });
            row.classList.add("is-drag-over");
          });
          vbbBatchList.addEventListener("dragleave", (e) => {
            const row = e.target?.closest?.(".vbb-batch-row");
            if (row && !row.contains(e.relatedTarget)) row.classList.remove("is-drag-over");
          });
          vbbBatchList.addEventListener("drop", (e) => {
            e.preventDefault();
            const row = e.target?.closest?.(".vbb-batch-row");
            const to = Number(row?.dataset?.vbbBatchIdx);
            let from = dragFrom;
            try {
              const raw = e.dataTransfer?.getData("text/plain");
              if (raw !== "" && Number.isFinite(Number(raw))) from = Number(raw);
            } catch (_) {}
            vbbBatchList.querySelectorAll(".vbb-batch-row.is-drag-over, .vbb-batch-row.is-dragging").forEach((el) => {
              el.classList.remove("is-drag-over", "is-dragging");
            });
            if (moveVbbBatchItem(from, to)) toast(`已排到第 ${to + 1} 位`);
            dragFrom = -1;
          });
        }
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
        vbbPreviewWrap = $("#vbb-preview-wrap", root);
        vbbFileEdit = $("#vbb-file-edit", root);
        vbbFileEditLabel = $("#vbb-file-edit-label", root);
        vbbEditOpen = $("#vbb-edit-open", root);
        vbbEditReset = $("#vbb-edit-reset", root);
        vbbEditOpen?.addEventListener("click", (ev) => {
          blurVbbActionButton(ev?.currentTarget || vbbEditOpen);
          openVbbEditEditor().catch((err) => setError(vbbError, err?.message || String(err)));
        });
        vbbEditReset?.addEventListener("click", () => resetActiveVbbEdit());
        const syncCustomTarget = (raw) => {
          if (!vbbAnalysis) return;
          const choices = [8, 10, 12, 15, 16, 20, 24, 30];
          const min = Number(vbbTargetRange?.min) || choices[0];
          const max = Number(vbbTargetRange?.max) || choices[choices.length - 1];
          let val = Math.max(min, Math.min(max, Number(raw) || min));
          // 白名单就近吸附，手机点选更稳
          let best = choices[0];
          let bestD = Math.abs(best - val);
          for (const c of choices) {
            if (c < min - 0.01 || c > max + 0.01) continue;
            const d = Math.abs(c - val);
            if (d < bestD) {
              best = c;
              bestD = d;
            }
          }
          val = best;
          vbbSegmentTarget = val;
          if (vbbTargetSpan) vbbTargetSpan.value = String(val);
          if (vbbTargetRange) vbbTargetRange.value = String(val);
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
          const pending = window.DevToolsPendingFiles?.take?.("vbb");
          if (pending?.length) {
            loadVbbFiles(pending).catch((err) => {
              clearVbb();
              setError(vbbError, err.message || String(err));
            });
          }
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
            if (btn.disabled) return;
            const next = String(btn.dataset.vbbWorkflow || "").trim();
            if (!next || next === vbbWorkflow) return;
            if (isVbbBatchMode() && next === "split") {
              toast("多选时请用「整段视频」或「手动打点」");
              return;
            }
            if (isVbbBatchMode() && vbbWorkflow === "manual") persistActiveVbbMarks();
            vbbWorkflow = next;
            if (isVbbBatchMode() && next === "manual") {
              const cur = vbbBatchFiles[vbbEditBatchIdx];
              if (cur) loadItemVbbMarks(cur);
            }
            if (next === "manual") pauseVbbPreview();
            syncVbbWorkflowUi();
            if (next === "manual") {
              const d = vbbVideoDuration();
              if (d >= VBB_LONG_VIDEO_SEC) {
                toast("长视频：拖动定位即可，播放会占用更多内存");
              } else if (isVbbBatchMode()) {
                toast("打点仅作用于当前预览视频");
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
        getBatchFiles: () => vbbBatchFiles.slice(),
        syncUi: () => {
          syncVbbEditUi();
          renderVbbBatchList({ keepSelection: true });
          syncVbbBatchMeta();
          setVbbButtons();
        },
        formatClipTitle: (c, idx) => formatVbbClipTitle(c, idx),
        formatClipMeta: (c, opts) => formatVbbClipMeta(c, opts || {}),
        shouldReuseFirstPlan: (ranges, index) => shouldReuseVbbFirstPlan(ranges, index),
        loadSpanScheme: (span, speed) => loadVbbSpanScheme(span, speed),
        saveSpanScheme: (span, seed, enc) => saveVbbSpanScheme(span, seed, enc),
        spanSchemeKey: (span, speed) => vbbSpanSchemeKey(span, speed),
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
        previewSeekForTime: vbbPreviewSeekForKeepRanges,
        syncEditPreview: syncVbbEditPreview,
        applySavedEdit: (next) => {
          const item = getActiveVbbEditItem();
          if (!item) return false;
          ensureVbbItemEdit(item);
          item.edit = {
            trimStart: Number(next?.trimStart) || 0,
            trimEnd: Number(next?.trimEnd) || item.duration,
            cutouts: Array.isArray(next?.cutouts)
              ? next.cutouts.map((c) => ({
                  start: Number(c.start) || 0,
                  end: Number(c.end) || 0,
                }))
              : [],
            cropOn: Boolean(next?.cropOn),
            crop: next?.crop
              ? { ...next.crop }
              : { x: 0, y: 0, w: item.srcW, h: item.srcH },
          };
          clampVbbEdit(item.edit, item.duration, item.srcW, item.srcH);
          if (!isVbbBatchMode()) vbbSingleEdit = item.edit;
          applyVbbSeek(Number(item.edit.trimStart) || 0, { keepPlaying: false });
          syncVbbEditPreview();
          syncVbbEditUi();
          return true;
        },
      };
      vbbAnalyze?.addEventListener("click", (e) => {
        const btn = e.currentTarget;
        withVbbWake(() => runVbbAnalyze())
          .catch((err) => setError(vbbError, err.message || String(err)))
          .finally(() => blurVbbActionButton(btn));
      });
        vbbOneclick?.addEventListener("click", () => withVbbWake(() => runVbbOneClick()).catch((err) => setError(vbbError, err.message || String(err))));
        $("#vbb-merge-video")?.addEventListener("click", () =>
          withVbbWake(() => mergeVbbVideosToOne()).catch((err) => setError(vbbError, err.message || String(err)))
        );
      vbbRun?.addEventListener("click", (e) => {
        const btn = e.currentTarget;
        withVbbWake(() => runVbbExecute())
          .catch((err) => setError(vbbError, err.message || String(err)))
          .finally(() => blurVbbActionButton(btn));
      });
      vbbMerge?.addEventListener("click", () => withVbbWake(() => runVbbMerge()).catch((err) => setError(vbbError, err.message || String(err))));
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
        armVbbEditFrameWatch();
      });
      vbbVideo?.addEventListener("pause", () => {
        vbbPlaying = false;
        if (vbbPlay) vbbPlay.textContent = "播放";
      });
      vbbVideo?.addEventListener("timeupdate", () => {
        if (isVbbManualMode()) {
          if (!vbbScrubbing) paintVbbNow();
          return;
        }
        enforceVbbEditPlaybackWindow();
      });
      vbbVideo?.addEventListener("seeked", () => {
        if (isVbbManualMode()) {
          paintVbbNow();
          return;
        }
        enforceVbbEditPlaybackWindow();
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
