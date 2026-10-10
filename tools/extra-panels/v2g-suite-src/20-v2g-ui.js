
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
            setError(v2gError, friendlyLocalFileError(err, err.message || String(err)));
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