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
      let gifFile;
      let gifFramesEl;
      let gifDelay;
      let gifWidth;
      let gifQuality;
      let gifMeta;
      let gifError;
      let gifProgress;
      let gifProgressFill;
      let gifProgressText;
      let gifPreview;
      let gifDownload;
      let gifGenerate;
      let gifAbort;
      let gifCompress;
      let gifCompressAgain;
      let gifCompressLevel;
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
  
      bindPanel("gifmaker", () => {
            gifFile = $("#gif-file");
            gifFramesEl = $("#gif-frames");
            gifDelay = $("#gif-delay");
            gifWidth = $("#gif-width");
            gifQuality = $("#gif-quality");
            gifMeta = $("#gif-meta");
            gifError = $("#gif-error");
            gifProgress = $("#gif-progress");
            gifProgressFill = $("#gif-progress-fill");
            gifProgressText = $("#gif-progress-text");
            gifPreview = $("#gif-preview");
            gifDownload = $("#gif-download");
            gifGenerate = $("#gif-generate");
            gifAbort = $("#gif-abort");
            gifCompress = $("#gif-compress");
            gifCompressAgain = $("#gif-compress-again");
            gifCompressLevel = $("#gif-compress-level");
  
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
      });
    } catch (err) {
      console.error("gif maker init failed", err);
    }
})();
