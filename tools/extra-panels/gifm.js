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
      let gifmFile;
      let gifmList;
      let gifmMeta;
      let gifmError;
      let gifmMerge;
      let gifmDownload;
      let gifmPreview;
      let gifmProgress;
      let gifmProgressFill;
      let gifmProgressText;
      const items = [];
      let mergedUrl = "";
      let merging = false;
  
      function setGifmProgress(visible, ratio, text) {
        if (!gifmProgress) return;
        gifmProgress.hidden = !visible;
        const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
        if (gifmProgressFill) gifmProgressFill.style.width = `${pct}%`;
        if (gifmProgressText) gifmProgressText.textContent = text || `${pct}%`;
      }
  
      function revokeMerged() {
        if (mergedUrl) {
          URL.revokeObjectURL(mergedUrl);
          mergedUrl = "";
        }
        if (gifmPreview) {
          gifmPreview.hidden = true;
          gifmPreview.removeAttribute("src");
        }
        if (gifmDownload) {
          gifmDownload.hidden = true;
          gifmDownload.removeAttribute("href");
        }
      }
  
      function renderGifmList() {
        if (!gifmList) return;
        gifmList.innerHTML = "";
        items.forEach((it, idx) => {
          const row = document.createElement("div");
          row.className = "gif-frame";
          const img = document.createElement("img");
          img.className = "gif-frame-thumb gifm-thumb";
          img.alt = `GIF ${idx + 1}`;
          img.src = it.url;
          const meta = document.createElement("div");
          meta.className = "gif-frame-meta";
          const nameEl = document.createElement("strong");
          nameEl.className = "gif-frame-name";
          nameEl.textContent = `${idx + 1}. ${it.name}`;
          const sizeEl = document.createElement("span");
          sizeEl.className = "hint tight";
          sizeEl.textContent = formatKb(it.blob.size);
          meta.append(nameEl, sizeEl);
          const actions = document.createElement("div");
          actions.className = "gif-frame-actions";
          const up = document.createElement("button");
          up.type = "button";
          up.className = "ghost-btn";
          up.textContent = "上移";
          up.disabled = idx === 0;
          up.addEventListener("click", () => {
            if (idx <= 0) return;
            const cur = items.splice(idx, 1)[0];
            items.splice(idx - 1, 0, cur);
            renderGifmList();
          });
          const down = document.createElement("button");
          down.type = "button";
          down.className = "ghost-btn";
          down.textContent = "下移";
          down.disabled = idx === items.length - 1;
          down.addEventListener("click", () => {
            if (idx >= items.length - 1) return;
            const cur = items.splice(idx, 1)[0];
            items.splice(idx + 1, 0, cur);
            renderGifmList();
          });
          const del = document.createElement("button");
          del.type = "button";
          del.className = "ghost-btn";
          del.textContent = "移除";
          del.addEventListener("click", () => {
            URL.revokeObjectURL(it.url);
            items.splice(idx, 1);
            renderGifmList();
          });
          actions.append(up, down, del);
          row.append(img, meta, actions);
          gifmList.appendChild(row);
        });
        if (gifmMerge) gifmMerge.disabled = merging || items.length < 2;
        if (gifmMeta) {
          gifmMeta.textContent =
            items.length >= 2
              ? `已选 ${items.length} 个 GIF，点「合并为一条 GIF」按当前顺序拼接（不重编码）`
              : "按添加顺序拼接成一条长 GIF，不重新调色板（各段宽高需一致）。至少 2 个。";
        }
      }
  
      function clearGifm() {
        items.splice(0, items.length).forEach((it) => {
          try {
            URL.revokeObjectURL(it.url);
          } catch (_) {}
        });
        revokeMerged();
        if (gifmFile) gifmFile.value = "";
        setGifmProgress(false, 0, "");
        setError(gifmError, "");
        renderGifmList();
      }
  
      bindPanel("gifm", () => {
            gifmFile = $("#gifm-file");
            gifmList = $("#gifm-list");
            gifmMeta = $("#gifm-meta");
            gifmError = $("#gifm-error");
            gifmMerge = $("#gifm-merge");
            gifmDownload = $("#gifm-download");
            gifmPreview = $("#gifm-preview");
            gifmProgress = $("#gifm-progress");
            gifmProgressFill = $("#gifm-progress-fill");
            gifmProgressText = $("#gifm-progress-text");
  
            gifmFile?.addEventListener("change", (e) => {
        const files = [...(e.target.files || [])];
        files.forEach((file) => {
          const type = String(file.type || "").toLowerCase();
          const name = String(file.name || "");
          if (type && type !== "image/gif" && !/\.gif$/i.test(name)) return;
          items.push({ blob: file, name: name || "clip.gif", url: URL.createObjectURL(file) });
        });
        if (gifmFile) gifmFile.value = "";
        renderGifmList();
      });
      $("#gifm-clear")?.addEventListener("click", clearGifm);
      window.DevToolsTemp?.registerCleanup(clearGifm);
      gifmMerge?.addEventListener("click", async () => {
        if (items.length < 2 || merging) return;
        merging = true;
        gifmMerge.disabled = true;
        setError(gifmError, "");
        revokeMerged();
        try {
          const blob = await mergeGifBlobs(
            items.map((it) => it.blob),
            (ratio, text) => setGifmProgress(true, ratio, text)
          );
          mergedUrl = URL.createObjectURL(blob);
          if (gifmPreview) {
            gifmPreview.src = mergedUrl;
            gifmPreview.hidden = false;
          }
          if (gifmDownload) {
            gifmDownload.href = mergedUrl;
            gifmDownload.hidden = false;
          }
          setGifmProgress(true, 1, `合并完成 · ${formatKb(blob.size)}`);
          toast("GIF 已合并，可预览下载");
        } catch (err) {
          setError(gifmError, err.message || String(err));
          setGifmProgress(false, 0, "");
        } finally {
          merging = false;
          renderGifmList();
        }
      });
      renderGifmList();
      });
    } catch (err) {
      console.error("gif merge init failed", err);
    }
})();
