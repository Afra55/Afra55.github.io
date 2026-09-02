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
    terminateFfmpegInstance, paintFfmpegWarmHint, prewarmFfmpegEngine, TOOLS_VERSION, GIF_TOOL_VERSION,
    AUTO_PACK_ZIP_KEY,
  } = M;
  const formatLocalPickMeta = K.formatLocalPickMeta;
  const attachLocalVideoPreview = K.attachLocalVideoPreview;
  const waitVideoMetadata = K.waitVideoMetadata;

    try {
      let gifcFile;
      let gifcMeta;
      let gifcError;
      let gifcLevel;
      let gifcCompress;
      let gifcCompressAgain;
      let gifcDownload;
      let gifcSource;
      let gifcPreview;
      let gifcProgress;
      let gifcProgressFill;
      let gifcProgressText;
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
  
      bindPanel("gifc", () => {
            gifcFile = $("#gifc-file");
            gifcMeta = $("#gifc-meta");
            gifcError = $("#gifc-error");
            gifcLevel = $("#gifc-compress-level");
            gifcCompress = $("#gifc-compress");
            gifcCompressAgain = $("#gifc-compress-again");
            gifcDownload = $("#gifc-download");
            gifcSource = $("#gifc-source");
            gifcPreview = $("#gifc-preview");
            gifcProgress = $("#gifc-progress");
            gifcProgressFill = $("#gifc-progress-fill");
            gifcProgressText = $("#gifc-progress-text");
  
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
      });
    } catch (err) {
      console.error("gif compress existing init failed", err);
    }
})();
