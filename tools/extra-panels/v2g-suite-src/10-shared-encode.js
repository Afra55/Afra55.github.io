
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
            // 有片头偏移时禁用 copy；时长只多半帧，避免片尾多吃内容
            const cutDur = span + 0.5 / Math.max(8, fps);
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
            const cutDur = span + 0.5 / Math.max(8, fps);
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
            const absEnd = encodeSs + encodeT;
            // 只多半帧防末帧被切；并钳到片尾，避免旧 +0.15s 把片尾后画面带进 GIF
            const need = (chunkFrames / fps) * speed + 0.5 / Math.max(8, fps);
            const dur = Math.max(1 / Math.max(8, fps), Math.min(need, absEnd - ss + 0.5 / Math.max(8, fps)));
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
      function blackboxShouldSkipHighFpsByDuration(fps, span) {
        const f = Number(fps) || 0;
        const s = Number(span) || 0;
        if (Math.abs(f - 15) < 0.2) return false;
        if (!(s > 0) || !(f > 0)) return false;
        return s * f > V2G_BLACKBOX_HIGH_FPS_FRAME_SKIP + 0.01;
      }
      function blackboxShouldSkipFpsByCal(fps, calFps, calSize, budget) {
        const f = Number(fps) || 0;
        if (Math.abs(f - 15) < 0.2) return false;
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
              const keepQ = Number(candidate.quality) || Number(common.quality) || V2G_BLACKBOX_QUALITY;
              const shortFluent = span / speed <= V2G_BLACKBOX_HIGH_PRIMARY_SPAN_SEC + 0.01;
              const midFluent = span / speed <= V2G_BLACKBOX_MID_SPAN_SEC + 0.01;
              // ≤24s 保当前档帧率（含 25/12.5）：勿在硬压里先掉帧
              let rf;
              let retryQuality;
              if (shortFluent || midFluent) {
                rf = fps;
                retryQuality =
                  keepQ < V2G_BLACKBOX_RETRY_QUALITY
                    ? V2G_BLACKBOX_RETRY_QUALITY
                    : Math.min(30, Math.max(keepQ, V2G_BLACKBOX_RETRY_QUALITY) + 7);
              } else {
                rf = Math.max(blackboxFpsFloor(span / speed, srcFps), Math.round(fps * k * 2) / 2);
                retryQuality =
                  rf <= V2G_BLACKBOX_RETRY_MIN_FPS + 0.01 && k < 0.92
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
                  }`
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
          for (let round = 1; round <= maxRounds; round++) {
            if (isAborted()) throw new Error("已取消");
            const before = cur.blob.size;
            // 满画质禁止 lossy/减色硬塞；只 -O3，进不去就留给降质阶梯。
            const plan = isBest
              ? buildBlackboxSoftCompressArgs(1, { movie })
              : isLastFps
                ? buildBlackboxHardCompressArgs(round, { movie })
                : buildBlackboxSoftCompressArgs(round, { movie });
            if (isBest && round > 1) break;
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
        const fitFps = async (fps) => {
          const hardW = Math.max(64, Math.min(srcCap, floorW));
          const isFloorFps = fps <= fpsFloor + 0.01;
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
          if (conc >= 2 && keepMaxQi >= 1) {
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
              if (blackboxShouldSkipNarrowerWidth(lastSize, lastWTried, w, V2G_BLACKBOX_MAX_BYTES)) {
                const est = blackboxEstSizeAtWidth(lastSize, lastWTried, w);
                vbbLog(
                  `[vbb-phase] 面积外推跳过 ${w}px：${lastWTried}px ${formatKb(lastSize)} → 估 ${formatKb(est)}`
                );
                continue;
              }
            }
            if (!shortKeepQ && !isFloorFps && wi > 0) {
              vbbLog(`[vbb-phase] 长片 ${fps}fps 保 420 不缩宽 → 降帧`);
              break;
            }
            vbbLog(
              `[vbb-phase] ${fps}fps 让渡宽 ${w}px · 画质 ${
                shortKeepQ || isFloorFps ? "92→≥80" : "92→可<80（保帧）"
              }`
            );
            let hit = await tryQualities(w, 0, keepMaxQi);
            if (!hit && (!shortKeepQ || isFloorFps) && wi === 0) {
              hit = await tryQualities(w, keepMaxQi + 1, V2G_BLACKBOX_QUALITY_LADDER.length - 1);
            }
            lastWTried = w;
            if (hit) return hit;
          }
          if (isFloorFps) {
            const wLast = widthSteps[widthSteps.length - 1];
            vbbLog(`[vbb-phase] ${fps}fps 帧率底线 · ${wLast}px 允许画质<80`);
            const deep = await tryQualities(wLast, keepMaxQi + 1, V2G_BLACKBOX_QUALITY_LADDER.length - 1);
            if (deep) return deep;
            const deepLast = tried
              .filter((t) => Math.abs((Number(t.fps) || 0) - fps) < 0.01)
              .sort((a, b) => (Number(a.blob?.size) || 0) - (Number(b.blob?.size) || 0))[0];
            if (deepLast?.blob?.size > V2G_BLACKBOX_MAX_BYTES) {
              const pressed = await compressAt(deepLast, fps, true, 0.55);
              tried.push(pressed);
              if (pressed.blob.size <= V2G_BLACKBOX_MAX_BYTES) return pressed;
            }
          } else {
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
        // 整除档从高到低：短片每档 420→外推跳宽 @≥80；长片 420 可降质
        for (const fps of fpsList) {
          if (blackboxShouldSkipHighFpsByDuration(fps, effSpanForPick)) {
            vbbLog(
              `[vbb-phase] 跳过 ${fps}fps：时长×帧≈${Math.round(effSpanForPick * fps)} 超长片穷举门槛（15 仍试）`
            );
            continue;
          }
          const cal = tried[tried.length - 1];
          if (
            cal?.blob?.size &&
            Number(cal.fps) > 0 &&
            blackboxShouldSkipFpsByCal(fps, cal.fps, cal.blob.size, V2G_BLACKBOX_MAX_BYTES)
          ) {
            vbbLog(
              `[vbb-phase] 外推跳过 ${fps}fps：${cal.fps}fps ${formatKb(cal.blob.size)} 估仍超`
            );
            continue;
          }
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
          const fpsNow = Number(chosen.fps) || fpsFloor;
          const atFloor = fpsNow <= fpsFloor + 0.01 && wNow <= floorW + 2;
          const baseQ = blackboxLadderQuality(candidate);
          const at = V2G_BLACKBOX_QUALITY_LADDER.indexOf(baseQ);
          const qiEnd = atFloor ? V2G_BLACKBOX_QUALITY_LADDER.length : keepMaxQi + 1;
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
          candidate = await compressAt(candidate, chosen.fps, true, 0.9);
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
          return finished ? { ...finished, srcFps, quality: blackboxLadderQuality(finished) } : finished;
        }
        const fallback = tried.slice().sort((a, b) => a.blob.size - b.blob.size)[0] || null;
        return fallback ? { ...fallback, srcFps } : null;
      }
  