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
      let gifeFile;
      let gifeMeta;
      let gifeError;
  let gifeTrimHead;
  let gifeTrimTail;
  let gifeTrim;
  let gifeTrimHint;
  let gifePlay;
  let gifePrev;
  let gifeNext;
  let gifeMarkStart;
  let gifeMarkEnd;
  let gifeClock;
  let gifeTimeline;
  let gifeFilmstrip;
  let gifeWindow;
  let gifeHandleStart;
  let gifeHandleEnd;
  let gifePlayheadEl;
      let gifeCropX;
      let gifeCropY;
      let gifeCropW;
      let gifeCropH;
      let gifeAutoCrop;
      let gifeResetCrop;
      let gifeCropEditor;
      let gifeCropStage;
      let gifeCropCanvas;
      let gifeCropBox;
      let gifeApply;
      let gifeDownload;
      let gifePreview;
      let gifeProgress;
      let gifeProgressFill;
      let gifeProgressText;
      const GIFE_DEFAULT_META =
        "拖进度看当前帧，拖黄柄去片头片尾；删中间：进度到该帧 →「添加删除段」（红段），或「删除起点 / 删除终点」。只改时长走原文件删帧，不糊画面。";
      /** @type {{ canvas: HTMLCanvasElement, delay: number }[]} */
      let gifeFrames = [];
      let gifeSrcW = 0;
      let gifeSrcH = 0;
      let gifeSourceName = "edited.gif";
      /** @type {Blob | null} */
      let gifeSourceBlob = null;
      let gifeSourceBytes = 0;
      /** @type {Uint8Array | null} */
      let gifeSourceU8 = null;
      let gifeOutUrl = "";
      let gifeBusy = false;
      let gifeCropDrag = null;
      let gifeCursor = 0;
      let gifeCumMs = [0];
      let gifeTotalMs = 0;
      let gifePlaying = false;
      let gifePlayTimer = 0;
      let gifeTrimDrag = null;
      /** @type {{ start: number, end: number }[]} */
      let gifeCuts = [];
      let gifeSelectedCut = -1;
      let gifeCutPendingStart = -1;
      let gifeCutoutsEl;
      let gifeCutAdd;
      let gifeCutMarkStart;
      let gifeCutMarkEnd;
      let gifeCutDel;
      let gifeCutClear;
  
      function setGifeProgress(visible, ratio, text) {
        if (!gifeProgress) return;
        gifeProgress.hidden = !visible;
        const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
        if (gifeProgressFill) gifeProgressFill.style.width = `${pct}%`;
        if (gifeProgressText) gifeProgressText.textContent = text || `${pct}%`;
      }
  
      function readGifeCropPct() {
        const x = Math.max(0, Math.min(99, Number(gifeCropX?.value) || 0));
        const y = Math.max(0, Math.min(99, Number(gifeCropY?.value) || 0));
        let w = Math.max(1, Math.min(100, Number(gifeCropW?.value) || 100));
        let h = Math.max(1, Math.min(100, Number(gifeCropH?.value) || 100));
        w = Math.min(w, 100 - x);
        h = Math.min(h, 100 - y);
        return { x, y, w, h };
      }
  
      function setGifeCropPct(x, y, w, h) {
        if (gifeCropX) gifeCropX.value = String(Math.round(x * 10) / 10);
        if (gifeCropY) gifeCropY.value = String(Math.round(y * 10) / 10);
        if (gifeCropW) gifeCropW.value = String(Math.round(w * 10) / 10);
        if (gifeCropH) gifeCropH.value = String(Math.round(h * 10) / 10);
        paintGifeCropEditor();
      }
  
      function gifeCropRectPx() {
        const p = readGifeCropPct();
        return {
          x: Math.round((p.x / 100) * gifeSrcW),
          y: Math.round((p.y / 100) * gifeSrcH),
          w: Math.max(1, Math.round((p.w / 100) * gifeSrcW)),
          h: Math.max(1, Math.round((p.h / 100) * gifeSrcH)),
        };
      }
  
      function paintGifeCropEditor() {
        if (!gifeCropStage || !gifeCropCanvas || !gifeCropBox || !gifeFrames.length) {
          if (gifeCropEditor) gifeCropEditor.hidden = true;
          return;
        }
        if (gifeCropEditor) gifeCropEditor.hidden = false;
        const src = (gifeFrames[gifeCursor] || gifeFrames[0]).canvas;
        const stageW = Math.max(160, Math.round(gifeCropStage.clientWidth || 320));
        const stageH = Math.max(160, Math.round(stageHFromWidth(stageW, gifeSrcW, gifeSrcH)));
        const fit = Math.min(stageW / gifeSrcW, stageH / gifeSrcH);
        const dw = gifeSrcW * fit;
        const dh = gifeSrcH * fit;
        const ox = (stageW - dw) / 2;
        const oy = (stageH - dh) / 2;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        gifeCropCanvas.width = Math.round(stageW * dpr);
        gifeCropCanvas.height = Math.round(stageH * dpr);
        const ctx = gifeCropCanvas.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, stageW, stageH);
        ctx.fillStyle = window.DevToolsTheme?.stageBg?.() || "#0a101c";
        ctx.fillRect(0, 0, stageW, stageH);
        ctx.drawImage(src, ox, oy, dw, dh);
        const p = readGifeCropPct();
        const box = {
          x: ox + (p.x / 100) * dw,
          y: oy + (p.y / 100) * dh,
          w: (p.w / 100) * dw,
          h: (p.h / 100) * dh,
        };
        gifeCropBox.hidden = false;
        gifeCropBox.style.left = `${box.x}px`;
        gifeCropBox.style.top = `${box.y}px`;
        gifeCropBox.style.width = `${box.w}px`;
        gifeCropBox.style.height = `${box.h}px`;
        gifeCropStage.classList.add("has-image");
        gifeCropStage._gifeGeom = { ox, oy, dw, dh, fit, sw: gifeSrcW, sh: gifeSrcH, box };
      }
  
      function stageHFromWidth(stageW, srcW, srcH) {
        if (!(srcW > 0 && srcH > 0)) return 280;
        return Math.max(160, Math.min(360, Math.round((stageW * srcH) / srcW)));
      }
  
      function detectGifContentBounds(canvas) {
        const w = canvas.width;
        const h = canvas.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const data = ctx.getImageData(0, 0, w, h).data;
        const isContent = (x, y) => {
          const i = (y * w + x) * 4;
          const a = data[i + 3];
          if (a < 12) return false;
          const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
          return lum > 18;
        };
        let top = 0;
        let bottom = h - 1;
        let left = 0;
        let right = w - 1;
        outer: for (; top < h; top++) {
          for (let x = 0; x < w; x++) if (isContent(x, top)) break outer;
        }
        outer: for (; bottom > top; bottom--) {
          for (let x = 0; x < w; x++) if (isContent(x, bottom)) break outer;
        }
        outer: for (; left < w; left++) {
          for (let y = top; y <= bottom; y++) if (isContent(left, y)) break outer;
        }
        outer: for (; right > left; right--) {
          for (let y = top; y <= bottom; y++) if (isContent(right, y)) break outer;
        }
        if (right <= left || bottom <= top) return { x: 0, y: 0, w, h };
        return { x: left, y: top, w: right - left + 1, h: bottom - top + 1 };
      }
  
      function gifeCanvasToBlob(canvas, type, quality) {
        return new Promise((resolve, reject) => {
          canvas.toBlob((blob) => {
            if (!blob) reject(new Error("导出图片失败"));
            else resolve(blob);
          }, type, quality);
        });
      }
  
      async function decodeGifeGifWithImageDecoder(buffer) {
        if (typeof ImageDecoder !== "function") return null;
        try {
          const decoder = new ImageDecoder({ data: buffer, type: "image/gif" });
          await decoder.tracks.ready;
          const track = decoder.tracks.selectedTrack;
          if (!track || !track.frameCount) return null;
          const frames = [];
          for (let i = 0; i < track.frameCount; i++) {
            const result = await decoder.decode({ frameIndex: i });
            const frame = result.image;
            const canvas = document.createElement("canvas");
            canvas.width = frame.displayWidth || frame.codedWidth;
            canvas.height = frame.displayHeight || frame.codedHeight;
            const ctx = canvas.getContext("2d");
            ctx.drawImage(frame, 0, 0);
            const delayUs = frame.duration || result.duration || 100000;
            const delay = Math.max(20, Math.round(delayUs / 1000));
            frame.close();
            frames.push({ canvas, delay });
          }
          decoder.close?.();
          return frames;
        } catch (_) {
          return null;
        }
      }
  
      function decodeGifeGifWithOmggif(buffer) {
        if (typeof GifReader !== "function") throw new Error("GIF 解码库未加载");
        const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
        const reader = new GifReader(bytes);
        const width = reader.width;
        const height = reader.height;
        const count = reader.numFrames();
        const frames = [];
        const full = document.createElement("canvas");
        full.width = width;
        full.height = height;
        const fullCtx = full.getContext("2d", { willReadFrequently: true });
        fullCtx.clearRect(0, 0, width, height);
        let saved = null;
        for (let i = 0; i < count; i++) {
          const info = reader.frameInfo(i);
          if (i > 0) {
            const prev = reader.frameInfo(i - 1);
            if (prev.disposal === 2) fullCtx.clearRect(prev.x, prev.y, prev.width, prev.height);
            else if (prev.disposal === 3 && saved) fullCtx.putImageData(saved, 0, 0);
          }
          if (info.disposal === 3) saved = fullCtx.getImageData(0, 0, width, height);
          else saved = null;
          const imageData = fullCtx.getImageData(0, 0, width, height);
          reader.decodeAndBlitFrameRGBA(i, imageData.data);
          fullCtx.putImageData(imageData, 0, 0);
          const snap = document.createElement("canvas");
          snap.width = width;
          snap.height = height;
          snap.getContext("2d").drawImage(full, 0, 0);
          const delay = Math.max(20, (info.delay || 10) * 10);
          frames.push({ canvas: snap, delay });
        }
        return frames;
      }
  
      function setGifeButtons() {
        const ready = gifeFrames.length > 0 && !gifeBusy;
        if (gifeApply) gifeApply.disabled = !ready;
        if (gifeAutoCrop) gifeAutoCrop.disabled = !ready;
        if (gifeResetCrop) gifeResetCrop.disabled = !ready;
        if (gifePlay) gifePlay.disabled = !ready;
        if (gifePrev) gifePrev.disabled = !ready;
        if (gifeNext) gifeNext.disabled = !ready;
        if (gifeMarkStart) gifeMarkStart.disabled = !ready;
        if (gifeMarkEnd) gifeMarkEnd.disabled = !ready;
        if (gifeCutAdd) gifeCutAdd.disabled = !ready;
        if (gifeCutMarkStart) gifeCutMarkStart.disabled = !ready;
        if (gifeCutMarkEnd) gifeCutMarkEnd.disabled = !ready;
        if (gifeCutClear) gifeCutClear.disabled = !ready || !gifeCuts.length;
        if (gifeCutDel) gifeCutDel.disabled = !ready || gifeSelectedCut < 0;
        if (gifePlay) gifePlay.textContent = gifePlaying ? "暂停" : "预览保留段";
      }
  
      function revokeGifeOut() {
        if (gifeOutUrl) {
          URL.revokeObjectURL(gifeOutUrl);
          gifeOutUrl = "";
        }
        if (gifePreview) {
          gifePreview.hidden = true;
          gifePreview.removeAttribute("src");
        }
        if (gifeDownload) {
          gifeDownload.hidden = true;
          gifeDownload.removeAttribute("href");
        }
      }
  
      function stopGifePlay() {
        gifePlaying = false;
        if (gifePlayTimer) {
          clearTimeout(gifePlayTimer);
          gifePlayTimer = 0;
        }
        setGifeButtons();
      }

      function rebuildGifeTiming() {
        gifeCumMs = [0];
        let t = 0;
        for (const f of gifeFrames) {
          t += Math.max(20, Number(f.delay) || 100);
          gifeCumMs.push(t);
        }
        gifeTotalMs = t;
      }

      function clearGife() {
        stopGifePlay();
        gifeFrames = [];
        gifeSrcW = 0;
        gifeSrcH = 0;
        gifeCursor = 0;
        gifeCumMs = [0];
        gifeTotalMs = 0;
        gifeTrimDrag = null;
        gifeCuts = [];
        gifeSelectedCut = -1;
        gifeCutPendingStart = -1;
        gifeSourceBlob = null;
        gifeSourceBytes = 0;
        gifeSourceU8 = null;
        revokeGifeOut();
        if (gifeFile) gifeFile.value = "";
        if (gifeTrimHead) gifeTrimHead.value = "0";
        if (gifeTrimTail) gifeTrimTail.value = "0";
        setGifeCropPct(0, 0, 100, 100);
        if (gifeCropEditor) gifeCropEditor.hidden = true;
        if (gifeCropStage) gifeCropStage.classList.remove("has-image", "is-dragging");
        if (gifeTrim) gifeTrim.hidden = true;
        setGifeProgress(false, 0, "");
        setError(gifeError, "");
        if (gifeMeta) gifeMeta.textContent = GIFE_DEFAULT_META;
        if (gifeClock) gifeClock.textContent = "—";
        gifeBusy = false;
        layoutGifeTimeline();
        setGifeButtons();
      }

      function gifeNormalizeCuts() {
        const { start, end } = gifeTrimValues();
        const raw = (gifeCuts || [])
          .map((c) => {
            const a = Math.max(start, Math.min(end, Number(c.start)));
            const b = Math.max(start, Math.min(end, Number(c.end)));
            return { start: Math.min(a, b), end: Math.max(a, b) };
          })
          .filter((c) => c.end >= c.start)
          .sort((x, y) => x.start - y.start);
        const merged = [];
        for (const c of raw) {
          const last = merged[merged.length - 1];
          if (last && c.start <= last.end + 1) last.end = Math.max(last.end, c.end);
          else merged.push({ start: c.start, end: c.end });
        }
        return merged;
      }

      function gifeKeepIndices() {
        const { start, end } = gifeTrimValues();
        const cuts = gifeNormalizeCuts();
        const keep = [];
        for (let i = start; i <= end; i++) {
          if (cuts.some((c) => i >= c.start && i <= c.end)) continue;
          keep.push(i);
        }
        return keep;
      }

      function gifeIsKeptIndex(i) {
        const keep = gifeKeepIndices();
        return keep.includes(i);
      }

      function gifeNextKept(from, dir) {
        const keep = gifeKeepIndices();
        if (!keep.length) return from;
        if (dir > 0) {
          const hit = keep.find((i) => i > from);
          return hit == null ? keep[0] : hit;
        }
        for (let k = keep.length - 1; k >= 0; k--) {
          if (keep[k] < from) return keep[k];
        }
        return keep[keep.length - 1];
      }

      function paintGifeCutouts() {
        if (!gifeCutoutsEl) return;
        gifeCutoutsEl.replaceChildren();
        if (!gifeFrames.length || gifeTotalMs <= 0) return;
        const cuts = gifeNormalizeCuts();
        gifeCuts = cuts;
        if (gifeSelectedCut >= cuts.length) gifeSelectedCut = cuts.length ? cuts.length - 1 : -1;
        cuts.forEach((c, i) => {
          const el = document.createElement("span");
          el.className = "gife-cutout" + (i === gifeSelectedCut ? " is-selected" : "");
          el.dataset.cutIndex = String(i);
          const startPct = (gifeCumMs[c.start] / gifeTotalMs) * 100;
          const endPct = (gifeCumMs[c.end + 1] / gifeTotalMs) * 100;
          el.style.setProperty("--cut-start", `${startPct}%`);
          el.style.setProperty("--cut-end", `${endPct}%`);
          const hs = document.createElement("span");
          hs.className = "gife-cutout-handle gife-cutout-handle-start";
          hs.dataset.cutIndex = String(i);
          hs.dataset.cutEdge = "start";
          const he = document.createElement("span");
          he.className = "gife-cutout-handle gife-cutout-handle-end";
          he.dataset.cutIndex = String(i);
          he.dataset.cutEdge = "end";
          el.append(hs, he);
          gifeCutoutsEl.appendChild(el);
        });
        setGifeButtons();
      }

      function setGifeCutEdge(index, edge, frame) {
        const { start, end } = gifeTrimValues();
        if (index < 0 || index >= gifeCuts.length) return;
        const next = gifeCuts.map((c) => ({ ...c }));
        const c = next[index];
        if (edge === "start") c.start = Math.max(start, Math.min(c.end, frame));
        else c.end = Math.min(end, Math.max(c.start, frame));
        gifeCuts = next;
        gifeSelectedCut = index;
        const el = gifeCutoutsEl?.children?.[index];
        if (el && gifeTotalMs > 0) {
          el.style.setProperty("--cut-start", `${(gifeCumMs[c.start] / gifeTotalMs) * 100}%`);
          el.style.setProperty("--cut-end", `${(gifeCumMs[c.end + 1] / gifeTotalMs) * 100}%`);
          el.classList.add("is-selected");
        } else {
          paintGifeCutouts();
        }
        syncGifeMeta();
        layoutGifeTimeline();
      }

      function addGifeCutAtCursor() {
        const keep = gifeKeepIndices();
        if (keep.length <= 1) {
          toast("至少留 1 帧，没法再删");
          return;
        }
        const { start, end } = gifeTrimValues();
        let a = Math.max(start, Math.min(end, gifeCursor));
        if (!gifeIsKeptIndex(a)) {
          toast("当前帧已在删除段里，请先拖到要删的起点");
          return;
        }
        const after = keep.filter((i) => i > a);
        const remainAfterCut = keep.length - 1;
        if (remainAfterCut < 1) {
          toast("删完会没有帧");
          return;
        }
        const b = a;
        gifeCuts = gifeNormalizeCuts().concat([{ start: a, end: b }]);
        gifeCuts = gifeNormalizeCuts();
        gifeSelectedCut = gifeCuts.findIndex((c) => a >= c.start && a <= c.end);
        if (gifeSelectedCut < 0) gifeSelectedCut = gifeCuts.length - 1;
        paintGifeCutouts();
        syncGifeMeta();
        toast("已添加删除段 · 拖红柄调长短");
        void after;
      }

      function markGifeCutStart() {
        const { start, end } = gifeTrimValues();
        gifeCutPendingStart = Math.max(start, Math.min(end, gifeCursor));
        toast(`删除起点：第 ${gifeCutPendingStart + 1} 帧，再点「删除终点」`);
      }

      function markGifeCutEnd() {
        const { start, end } = gifeTrimValues();
        const b = Math.max(start, Math.min(end, gifeCursor));
        const a = gifeCutPendingStart >= 0 ? gifeCutPendingStart : b;
        const lo = Math.min(a, b);
        const hi = Math.max(a, b);
        const keep = gifeKeepIndices().filter((i) => i < lo || i > hi);
        if (!keep.length) {
          toast("不能把全部帧都删掉");
          return;
        }
        gifeCuts = gifeNormalizeCuts().concat([{ start: lo, end: hi }]);
        gifeCuts = gifeNormalizeCuts();
        gifeSelectedCut = gifeCuts.findIndex((c) => lo >= c.start && hi <= c.end);
        gifeCutPendingStart = -1;
        paintGifeCutouts();
        syncGifeMeta();
        toast(`已删除第 ${lo + 1}–${hi + 1} 帧`);
      }

      function deleteSelectedGifeCut() {
        if (gifeSelectedCut < 0 || gifeSelectedCut >= gifeCuts.length) return;
        gifeCuts = gifeCuts.filter((_, i) => i !== gifeSelectedCut);
        gifeSelectedCut = -1;
        gifeCuts = gifeNormalizeCuts();
        paintGifeCutouts();
        syncGifeMeta();
      }

      function clearGifeCuts() {
        gifeCuts = [];
        gifeSelectedCut = -1;
        gifeCutPendingStart = -1;
        paintGifeCutouts();
        syncGifeMeta();
      }

      function syncGifeMeta() {
        if (!gifeMeta || !gifeFrames.length) return;
        const { n } = gifeTrimValues();
        const keep = gifeKeepIndices();
        const remain = keep.length;
        const keepMs = keep.reduce((s, i) => s + Math.max(20, Number(gifeFrames[i]?.delay) || 100), 0);
        const cutN = gifeNormalizeCuts().length;
        const cutNote = cutN ? ` · 中间删 ${cutN} 段` : "";
        gifeMeta.textContent = `${gifeSourceName.replace(/\.gif$/i, "")} · ${gifeSrcW}×${gifeSrcH} · ${n} 帧 · 约 ${(gifeTotalMs / 1000).toFixed(2)}s · 保留 ${remain} 帧（约 ${(keepMs / 1000).toFixed(2)}s）${cutNote}`;
      }

      function gifeTrimValues() {
        const n = gifeFrames.length;
        if (n < 1) return { head: 0, tail: 0, n: 0, start: 0, end: 0 };
        const head = Math.max(0, Math.min(n - 1, Number(gifeTrimHead?.value) || 0));
        const tail = Math.max(0, Math.min(n - head - 1, Number(gifeTrimTail?.value) || 0));
        const start = head;
        const end = n - tail - 1;
        return { head, tail, n, start, end };
      }

      function writeGifeTrim(head, tail) {
        const n = gifeFrames.length;
        if (n < 1) return;
        const h = Math.max(0, Math.min(n - 1, head));
        const t = Math.max(0, Math.min(n - h - 1, tail));
        if (gifeTrimHead) gifeTrimHead.value = String(h);
        if (gifeTrimTail) gifeTrimTail.value = String(t);
        gifeCuts = gifeNormalizeCuts();
        if (gifeSelectedCut >= gifeCuts.length) gifeSelectedCut = gifeCuts.length ? gifeCuts.length - 1 : -1;
        paintGifeCutouts();
        syncGifeMeta();
        layoutGifeTimeline();
      }

      function gifeFrameAtTime(ms) {
        const n = gifeFrames.length;
        if (n < 1) return 0;
        const t = Math.max(0, Math.min(gifeTotalMs - 0.001, ms));
        let lo = 0;
        let hi = n - 1;
        while (lo < hi) {
          const mid = (lo + hi + 1) >> 1;
          if (gifeCumMs[mid] <= t) lo = mid;
          else hi = mid - 1;
        }
        return lo;
      }

      function layoutGifeTimeline() {
        if (!gifeTimeline) return;
        if (!gifeFrames.length) return;
        const { start, end, n } = gifeTrimValues();
        const startPct = gifeTotalMs > 0 ? (gifeCumMs[start] / gifeTotalMs) * 100 : 0;
        const endPct = gifeTotalMs > 0 ? (gifeCumMs[end + 1] / gifeTotalMs) * 100 : 100;
        const cur = Math.max(0, Math.min(n - 1, gifeCursor));
        const playPct = gifeTotalMs > 0
          ? ((gifeCumMs[cur] + (gifeFrames[cur].delay || 0) * 0.5) / gifeTotalMs) * 100
          : 0;
        gifeTimeline.style.setProperty("--gife-start", `${startPct}%`);
        gifeTimeline.style.setProperty("--gife-end", `${endPct}%`);
        gifeTimeline.style.setProperty("--gife-play", `${playPct}%`);
        if (gifeClock) {
          const t = gifeCumMs[cur] / 1000;
          const kept = cur >= start && cur <= end && gifeIsKeptIndex(cur);
          const why = cur < start || cur > end ? " · 将去掉" : kept ? "" : " · 中间删除";
          gifeClock.textContent = `第 ${cur + 1}/${n} 帧 · ${t.toFixed(2)}s${why}`;
        }
      }

      function setGifeCursor(i, { paint = true, clampToKeep = false } = {}) {
        const n = gifeFrames.length;
        if (n < 1) return;
        const { start, end } = gifeTrimValues();
        let next = Math.max(0, Math.min(n - 1, i));
        if (clampToKeep) {
          next = Math.max(start, Math.min(end, next));
          if (!gifeIsKeptIndex(next)) {
            const keep = gifeKeepIndices();
            next = keep.includes(next) ? next : (keep[0] ?? start);
          }
        }
        gifeCursor = next;
        layoutGifeTimeline();
        if (paint) paintGifeCropEditor();
      }

      function paintGifeFilmstrip() {
        if (!gifeFilmstrip || !gifeTimeline || !gifeFrames.length) return;
        const cssW = Math.max(160, Math.round(gifeTimeline.clientWidth || 320));
        const cssH = 56;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        gifeFilmstrip.width = Math.round(cssW * dpr);
        gifeFilmstrip.height = Math.round(cssH * dpr);
        const ctx = gifeFilmstrip.getContext("2d");
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.fillStyle = window.DevToolsTheme?.stageBg?.() || "#0a101c";
        ctx.fillRect(0, 0, cssW, cssH);
        const n = gifeFrames.length;
        const samples = Math.max(6, Math.min(n, Math.floor(cssW / 22)));
        const cellW = cssW / samples;
        for (let s = 0; s < samples; s++) {
          const i = Math.min(n - 1, Math.round((s / Math.max(1, samples - 1)) * (n - 1)));
          const src = gifeFrames[i].canvas;
          const dw = cellW;
          const dh = cssH;
          const fit = Math.max(dw / src.width, dh / src.height);
          const sw = dw / fit;
          const sh = dh / fit;
          const sx = (src.width - sw) / 2;
          const sy = (src.height - sh) / 2;
          ctx.drawImage(src, sx, sy, sw, sh, s * cellW, 0, dw, dh);
        }
      }

      function showGifeTrimUi() {
        if (gifeTrim) gifeTrim.hidden = !gifeFrames.length;
        requestAnimationFrame(() => {
          paintGifeFilmstrip();
          layoutGifeTimeline();
          paintGifeCropEditor();
        });
      }

      function playGifeKeepRange() {
        const keep = gifeKeepIndices();
        if (!keep.length) return;
        if (gifePlaying) {
          stopGifePlay();
          return;
        }
        gifePlaying = true;
        setGifeButtons();
        if (!gifeIsKeptIndex(gifeCursor)) setGifeCursor(keep[0]);
        else paintGifeCropEditor();
        const tick = () => {
          if (!gifePlaying) return;
          const delay = Math.max(40, gifeFrames[gifeCursor]?.delay || 100);
          gifePlayTimer = window.setTimeout(() => {
            if (!gifePlaying) return;
            const next = gifeNextKept(gifeCursor, 1);
            setGifeCursor(next, { clampToKeep: true });
            tick();
          }, delay);
        };
        tick();
      }

      function markGifeStart() {
        const { n, end } = gifeTrimValues();
        const start = Math.max(0, Math.min(end, gifeCursor));
        writeGifeTrim(start, n - end - 1);
      }

      function markGifeEnd() {
        const { n, start } = gifeTrimValues();
        const end = Math.max(start, Math.min(n - 1, gifeCursor));
        writeGifeTrim(start, n - end - 1);
      }

      function timeFromClientX(clientX) {
        if (!gifeTimeline || gifeTotalMs <= 0) return 0;
        const rect = gifeTimeline.getBoundingClientRect();
        const p = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
        return p * gifeTotalMs;
      }

      function bindGifeTimeline() {
        if (!gifeTimeline || gifeTimeline.dataset.trimBound) return;
        gifeTimeline.dataset.trimBound = "1";
        const endDrag = (e) => {
          if (!gifeTrimDrag) return;
          gifeTimeline.classList.remove("is-dragging-window");
          try { gifeTimeline.releasePointerCapture(e.pointerId); } catch (_) {}
          const wasCut = gifeTrimDrag.kind === "cut";
          gifeTrimDrag = null;
          if (wasCut) {
            gifeCuts = gifeNormalizeCuts();
            paintGifeCutouts();
            syncGifeMeta();
          }
        };
        gifeTimeline.addEventListener("pointerdown", (e) => {
          if (!gifeFrames.length) return;
          stopGifePlay();
          const t = timeFromClientX(e.clientX);
          const handle = e.target.closest?.(".gife-handle");
          const cutHandle = e.target.closest?.(".gife-cutout-handle");
          const cutEl = e.target.closest?.(".gife-cutout");
          const windowEl = e.target.closest?.(".gife-window");
          const { start, end } = gifeTrimValues();
          if (cutHandle) {
            const idx = Number(cutHandle.dataset.cutIndex);
            gifeSelectedCut = idx;
            gifeTrimDrag = { kind: "cut", index: idx, edge: cutHandle.dataset.cutEdge || "end" };
            paintGifeCutouts();
          } else if (cutEl) {
            gifeSelectedCut = Number(cutEl.dataset.cutIndex);
            gifeTrimDrag = { kind: "scrub" };
            setGifeCursor(gifeFrameAtTime(t));
            paintGifeCutouts();
          } else if (handle === gifeHandleStart) {
            gifeTrimDrag = { kind: "start" };
          } else if (handle === gifeHandleEnd) {
            gifeTrimDrag = { kind: "end" };
          } else if (windowEl) {
            gifeTrimDrag = {
              kind: "window",
              grab: t - gifeCumMs[start],
              span: gifeCumMs[end + 1] - gifeCumMs[start],
            };
            gifeTimeline.classList.add("is-dragging-window");
          } else {
            gifeTrimDrag = { kind: "scrub" };
            setGifeCursor(gifeFrameAtTime(t));
          }
          e.preventDefault();
          try { gifeTimeline.setPointerCapture(e.pointerId); } catch (_) {}
        });
        gifeTimeline.addEventListener("pointermove", (e) => {
          if (!gifeTrimDrag || !gifeFrames.length) return;
          const t = timeFromClientX(e.clientX);
          const n = gifeFrames.length;
          const cur = gifeTrimValues();
          if (gifeTrimDrag.kind === "scrub") {
            setGifeCursor(gifeFrameAtTime(t));
            return;
          }
          if (gifeTrimDrag.kind === "cut") {
            setGifeCutEdge(gifeTrimDrag.index, gifeTrimDrag.edge, gifeFrameAtTime(t));
            setGifeCursor(gifeFrameAtTime(t));
            return;
          }
          if (gifeTrimDrag.kind === "start") {
            const start = Math.max(0, Math.min(cur.end, gifeFrameAtTime(t)));
            writeGifeTrim(start, n - cur.end - 1);
            setGifeCursor(start);
            return;
          }
          if (gifeTrimDrag.kind === "end") {
            const end = Math.max(cur.start, Math.min(n - 1, gifeFrameAtTime(Math.max(0, t - 0.001))));
            writeGifeTrim(cur.start, n - end - 1);
            setGifeCursor(end);
            return;
          }
          if (gifeTrimDrag.kind === "window") {
            const span = gifeTrimDrag.span;
            let startT = t - gifeTrimDrag.grab;
            startT = Math.max(0, Math.min(gifeTotalMs - span, startT));
            const start = gifeFrameAtTime(startT);
            const endT = startT + span;
            const end = Math.max(start, gifeFrameAtTime(Math.max(0, endT - 0.001)));
            writeGifeTrim(start, n - end - 1);
            setGifeCursor(Math.max(start, Math.min(end, gifeCursor)));
          }
        });
        gifeTimeline.addEventListener("pointerup", endDrag);
        gifeTimeline.addEventListener("pointercancel", endDrag);
        gifeHandleStart?.addEventListener("keydown", (e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          const { start, end, n } = gifeTrimValues();
          writeGifeTrim(start + (e.key === "ArrowLeft" ? -1 : 1), n - end - 1);
        });
        gifeHandleEnd?.addEventListener("keydown", (e) => {
          if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
          e.preventDefault();
          const { start, end, n } = gifeTrimValues();
          writeGifeTrim(start, n - (end + (e.key === "ArrowLeft" ? -1 : 1)) - 1);
        });
      }
  
      async function loadGifeFile(file) {
        if (!file) return;
        clearGife();
        const type = String(file.type || "").toLowerCase();
        const name = String(file.name || "");
        if (type && type !== "image/gif" && !/\.gif$/i.test(name)) {
          setError(gifeError, "请选择 GIF 文件");
          return;
        }
        setError(gifeError, "");
        setGifeProgress(true, 0.02, "读取 GIF…");
        try {
          const buffer = await file.arrayBuffer();
          let frames = await decodeGifeGifWithImageDecoder(buffer);
          if (!frames?.length) frames = decodeGifeGifWithOmggif(buffer);
          if (!frames.length) throw new Error("未解析到帧");
          gifeFrames = frames;
          gifeSourceBlob = file instanceof Blob ? file : new Blob([buffer], { type: "image/gif" });
          gifeSourceBytes = gifeSourceBlob.size || buffer.byteLength || 0;
          gifeSourceU8 = new Uint8Array(buffer);
          gifeCuts = [];
          gifeSelectedCut = -1;
          gifeCutPendingStart = -1;
          gifeSrcW = frames[0].canvas.width;
          gifeSrcH = frames[0].canvas.height;
          gifeSourceName = `${(name.replace(/\.gif$/i, "") || "edited")}-edited.gif`;
          gifeCursor = 0;
          rebuildGifeTiming();
          setGifeCropPct(0, 0, 100, 100);
          paintGifeCropEditor();
          syncGifeMeta();
          showGifeTrimUi();
          setGifeButtons();
          setGifeProgress(true, 1, `已加载 ${frames.length} 帧`);
          toast(`GIF 已加载 · ${frames.length} 帧`);
        } catch (err) {
          clearGife();
          setError(gifeError, err.message || String(err));
          setGifeProgress(false, 0, "");
        }
      }
  
      function applyGifeCropToCanvas(srcCanvas, rect) {
        const out = document.createElement("canvas");
        out.width = rect.w;
        out.height = rect.h;
        out.getContext("2d").drawImage(srcCanvas, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);
        return out;
      }
  
      function getGifeProcessedFrames() {
        const keep = gifeKeepIndices();
        if (keep.length < 1) throw new Error("删帧后至少需要保留 1 帧");
        const sliced = keep.map((i) => gifeFrames[i]);
        const rect = gifeCropRectPx();
        if (rect.w < 2 || rect.h < 2) throw new Error("裁剪区域过小");
        return sliced.map((f) => ({
          canvas: applyGifeCropToCanvas(f.canvas, rect),
          delay: f.delay,
        }));
      }

      function gifeIsIdentityCrop(rect) {
        return rect.x === 0 && rect.y === 0 && rect.w === gifeSrcW && rect.h === gifeSrcH;
      }

      function gifeSkipGifSubBlocks(u8, p) {
        while (p < u8.length) {
          const sz = u8[p++];
          if (!sz) break;
          p += sz;
        }
        return p;
      }

      function gifeSplitGifFrames(u8) {
        if (!u8 || u8.length < 14 || u8[0] !== 0x47 || u8[1] !== 0x49 || u8[2] !== 0x46) {
          throw new Error("不是 GIF");
        }
        let p = 6;
        p += 4;
        const packed = u8[p++];
        p += 2;
        if (packed & 0x80) p += 3 * (1 << ((packed & 7) + 1));
        let headerEnd = p;
        const frames = [];
        while (p < u8.length) {
          const b = u8[p];
          if (b === 0x3b) break;
          if (b === 0x21) {
            const label = u8[p + 1];
            if (frames.length === 0 && label !== 0xf9) {
              p += 2;
              p = gifeSkipGifSubBlocks(u8, p);
              headerEnd = p;
              continue;
            }
          }
          const start = p;
          while (p < u8.length && u8[p] === 0x21) {
            p += 2;
            p = gifeSkipGifSubBlocks(u8, p);
          }
          if (u8[p] !== 0x2c) throw new Error("GIF 帧结构异常");
          p += 9;
          const ip = u8[p++];
          if (ip & 0x80) p += 3 * (1 << ((ip & 7) + 1));
          p += 1;
          p = gifeSkipGifSubBlocks(u8, p);
          frames.push(u8.subarray(start, p));
        }
        return { header: u8.subarray(0, headerEnd), frames };
      }

      function gifeKeepIsContiguous(keepIndices) {
        return keepIndices.every((v, k) => k === 0 || v === keepIndices[k - 1] + 1);
      }

      function gifeAssembleKeptGif(keepIndices) {
        if (!gifeSourceU8) throw new Error("没有原始 GIF 字节");
        const { header, frames } = gifeSplitGifFrames(gifeSourceU8);
        if (frames.length !== gifeFrames.length) {
          throw new Error(`帧数不一致 ${frames.length}≠${gifeFrames.length}`);
        }
        let size = header.length + 1;
        for (const i of keepIndices) size += frames[i].length;
        const out = new Uint8Array(size);
        let p = 0;
        out.set(header, p);
        p += header.length;
        for (const i of keepIndices) {
          out.set(frames[i], p);
          p += frames[i].length;
        }
        out[p] = 0x3b;
        return new Blob([out], { type: "image/gif" });
      }

      function gifeDropRanges(keepIndices) {
        const keep = new Set(keepIndices);
        const n = gifeFrames.length;
        const drops = [];
        for (let i = 0; i < n; i++) if (!keep.has(i)) drops.push(i);
        const ranges = [];
        for (const i of drops) {
          const last = ranges[ranges.length - 1];
          if (last && last.b === i - 1) last.b = i;
          else ranges.push({ a: i, b: i });
        }
        return ranges;
      }

      async function encodeGifeWithGifsicle(keepIndices, cropRect, onProgress) {
        if (!gifeSourceBlob) throw new Error("没有原始 GIF");
        const gifsicle = await loadGifsicle();
        if (!gifsicle || typeof gifsicle.run !== "function") throw new Error("gifsicle 未加载");
        const keepRanges = [];
        for (const i of keepIndices) {
          const last = keepRanges[keepRanges.length - 1];
          if (last && last.b === i - 1) last.b = i;
          else keepRanges.push({ a: i, b: i });
        }
        const keepSels = keepRanges.map((r) => (r.a === r.b ? String(r.a) : `${r.a}-${r.b}`));
        const drop = gifeDropRanges(keepIndices);
        const dropSels = drop.map((r) => (r.a === r.b ? String(r.a) : `${r.a}-${r.b}`));
        const crop =
          cropRect && !gifeIsIdentityCrop(cropRect)
            ? `--crop ${cropRect.x},${cropRect.y}+${cropRect.w}x${cropRect.h}`
            : "";
        const commands = [
          [crop, "--unoptimize", "in.gif", ...keepSels, "-O3", "-o", "/out/out.gif"].filter(Boolean).join(" "),
          [crop, "in.gif", ...keepSels, "-O3", "-o", "/out/out.gif"].filter(Boolean).join(" "),
          [crop, "--unoptimize", "--delete", ...dropSels, "-O3", "in.gif", "-o", "/out/out.gif"].filter(Boolean).join(" "),
        ];
        onProgress?.(0.25, "原文件删帧并优化…");
        let lastErr = "gifsicle 无输出";
        for (const cmd of commands) {
          try {
            const out = await gifsicle.run({
              input: [{ file: gifeSourceBlob, name: "in.gif" }],
              command: [cmd],
            });
            const file = Array.isArray(out) ? out[0] : null;
            if (!file) {
              lastErr = `无输出: ${cmd}`;
              continue;
            }
            const blob = file instanceof Blob ? file : new Blob([file], { type: "image/gif" });
            if (!blob.size) {
              lastErr = `空文件: ${cmd}`;
              continue;
            }
            return blob;
          } catch (err) {
            lastErr = `${err?.message || err} · ${cmd}`;
          }
        }
        throw new Error(lastErr);
      }
  
      async function encodeGifeGif(frames, onProgress) {
        if (typeof GIF !== "function") throw new Error("gif.js 未加载");
        const outW = frames[0].canvas.width;
        const outH = frames[0].canvas.height;
        const workerSource = await fetch(new URL("./vendor/gif.worker.js", document.baseURI || window.location.href)).then((r) => {
          if (!r.ok) throw new Error("无法加载 gif.worker.js");
          return r.text();
        });
        const workerScript = URL.createObjectURL(new Blob([workerSource], { type: "application/javascript" }));
        try {
          const gif = new GIF({
            workers: 2,
            quality: 1,
            width: outW,
            height: outH,
            workerScript,
            repeat: 0,
            background: "#000000",
          });
          frames.forEach((frame, idx) => {
            gif.addFrame(frame.canvas, { delay: frame.delay, copy: true });
            onProgress?.(0.1 + (idx / frames.length) * 0.2, `准备帧 ${idx + 1}/${frames.length}`);
          });
          return await new Promise((resolve, reject) => {
            gif.on("progress", (p) => onProgress?.(0.3 + p * 0.7, `编码中… ${Math.round(p * 100)}%`));
            gif.on("finished", (b) => resolve(b));
            gif.on("abort", () => reject(new Error("已取消")));
            try {
              gif.render();
            } catch (err) {
              reject(err);
            }
          });
        } finally {
          try {
            URL.revokeObjectURL(workerScript);
          } catch (_) {}
        }
      }
  
      async function applyGifeEdit() {
        if (!gifeFrames.length || gifeBusy) return;
        gifeBusy = true;
        setGifeButtons();
        setError(gifeError, "");
        revokeGifeOut();
        try {
          const keep = gifeKeepIndices();
          if (keep.length < 1) throw new Error("删帧后至少需要保留 1 帧");
          const rect = gifeCropRectPx();
          if (rect.w < 2 || rect.h < 2) throw new Error("裁剪区域过小");
          const identity = gifeIsIdentityCrop(rect);
          const noFrameEdit = keep.length === gifeFrames.length && keep.every((i, k) => i === k);
          setGifeProgress(true, 0.05, `处理 ${keep.length} 帧…`);
          let blob = null;
          let how = "";
          let gifsicleNote = "";
          if (identity && noFrameEdit && gifeSourceBlob) {
            blob = gifeSourceBlob;
            how = "未改时长/画面，原文件";
          }
          if (!blob && identity && gifeSourceU8) {
            try {
              const contiguous = gifeKeepIsContiguous(keep);
              if (!contiguous && typeof GifReader === "function") {
                const reader = new GifReader(gifeSourceU8);
                const depends = keep.some((i) => {
                  if (keep.includes(i - 1) || i === keep[0]) return false;
                  const info = reader.frameInfo(i);
                  return !(info.x === 0 && info.y === 0 && info.width === reader.width && info.height === reader.height);
                });
                if (depends) throw new Error("中间删帧碰到差分帧，改走重编码");
              }
              blob = gifeAssembleKeptGif(keep);
              how = contiguous ? "原文件剪帧" : "原文件剪中间帧";
            } catch (err) {
              gifsicleNote = err?.message || String(err);
              blob = null;
            }
          }
          if (!blob && gifeSourceBlob) {
            try {
              blob = await encodeGifeWithGifsicle(keep, rect, (ratio, text) => setGifeProgress(true, ratio, text));
              if (!blob || !blob.size) throw new Error("gifsicle 无输出");
              how = "原文件删帧 -O3";
            } catch (err) {
              gifsicleNote = [gifsicleNote, err?.message || String(err)].filter(Boolean).join("；");
              console.warn("gife gifsicle trim failed", err);
              blob = null;
            }
          }
          if (!blob || !blob.size) {
            const processed = getGifeProcessedFrames();
            const raw = await encodeGifeGif(processed, (ratio, text) => setGifeProgress(true, ratio, text));
            try {
              const o3 = await compressGifBlob(raw, "standard", (ratio, text) => setGifeProgress(true, 0.85 + ratio * 0.14, text || "O3 优化…"), {
                plan: { label: "O3", args: "-O3", round: 1, lossy: 0 },
              });
              blob = o3 && o3.size && o3.size <= raw.size ? o3 : raw;
            } catch (_) {
              blob = raw;
            }
            how = gifsicleNote ? `逐帧重编码 + O3（gifsicle: ${gifsicleNote}）` : "逐帧重编码 + O3";
          }
          gifeOutUrl = URL.createObjectURL(blob);
          if (gifePreview) {
            gifePreview.src = gifeOutUrl;
            gifePreview.hidden = false;
          }
          if (gifeDownload) {
            gifeDownload.href = gifeOutUrl;
            gifeDownload.download = gifeSourceName;
            gifeDownload.hidden = false;
          }
          const sizeNote = gifeSourceBytes
            ? ` · 原 ${formatKb(gifeSourceBytes)} → ${formatKb(blob.size)}`
            : ` · ${formatKb(blob.size)}`;
          setGifeProgress(true, 1, `完成 · ${rect.w}×${rect.h} · ${keep.length} 帧${sizeNote} · ${how}`);
          toast(`已导出 · ${formatKb(blob.size)}`);
        } catch (err) {
          setError(gifeError, err.message || String(err));
          setGifeProgress(false, 0, "");
        } finally {
          gifeBusy = false;
          setGifeButtons();
        }
      }
  
      function autoGifeCrop() {
        if (!gifeFrames.length) return;
        const bounds = detectGifContentBounds(gifeFrames[0].canvas);
        setGifeCropPct(
          (bounds.x / gifeSrcW) * 100,
          (bounds.y / gifeSrcH) * 100,
          (bounds.w / gifeSrcW) * 100,
          (bounds.h / gifeSrcH) * 100
        );
        syncGifeMeta();
        toast("已按首帧检测黑边");
      }
  
      function applyGifeBoxToInputs(box, geom) {
        const x = Math.max(0, Math.min(geom.sw, (box.x - geom.ox) / geom.fit));
        const y = Math.max(0, Math.min(geom.sh, (box.y - geom.oy) / geom.fit));
        const w = Math.max(1, Math.min(geom.sw - x, box.w / geom.fit));
        const h = Math.max(1, Math.min(geom.sh - y, box.h / geom.fit));
        setGifeCropPct((x / geom.sw) * 100, (y / geom.sh) * 100, (w / geom.sw) * 100, (h / geom.sh) * 100);
        syncGifeMeta();
      }
  
      bindPanel("gife", () => {
            gifeFile = $("#gife-file");
            gifeMeta = $("#gife-meta");
            gifeError = $("#gife-error");
            gifeTrimHead = $("#gife-trim-head");
            gifeTrimTail = $("#gife-trim-tail");
            gifeTrim = $("#gife-trim");
            gifeTrimHint = $("#gife-trim-hint");
            gifePlay = $("#gife-play");
            gifePrev = $("#gife-prev");
            gifeNext = $("#gife-next");
            gifeMarkStart = $("#gife-mark-start");
            gifeMarkEnd = $("#gife-mark-end");
            gifeClock = $("#gife-clock");
            gifeTimeline = $("#gife-timeline");
            gifeFilmstrip = $("#gife-filmstrip");
            gifeWindow = $("#gife-window");
            gifeHandleStart = $("#gife-handle-start");
            gifeHandleEnd = $("#gife-handle-end");
            gifePlayheadEl = $("#gife-playhead");
            gifeCutoutsEl = $("#gife-cutouts");
            gifeCutAdd = $("#gife-cut-add");
            gifeCutMarkStart = $("#gife-cut-mark-start");
            gifeCutMarkEnd = $("#gife-cut-mark-end");
            gifeCutDel = $("#gife-cut-del");
            gifeCutClear = $("#gife-cut-clear");
            gifeCropX = $("#gife-crop-x");
            gifeCropY = $("#gife-crop-y");
            gifeCropW = $("#gife-crop-w");
            gifeCropH = $("#gife-crop-h");
            gifeAutoCrop = $("#gife-auto-crop");
            gifeResetCrop = $("#gife-reset-crop");
            gifeCropEditor = $("#gife-crop-editor");
            gifeCropStage = $("#gife-crop-stage");
            gifeCropCanvas = $("#gife-crop-canvas");
            gifeCropBox = $("#gife-crop-box");
            gifeApply = $("#gife-apply");
            gifeDownload = $("#gife-download");
            gifePreview = $("#gife-preview");
            gifeProgress = $("#gife-progress");
            gifeProgressFill = $("#gife-progress-fill");
            gifeProgressText = $("#gife-progress-text");
  
            gifeFile?.addEventListener("change", (e) => {
        loadGifeFile(e.target.files?.[0]).catch((err) => setError(gifeError, err.message || String(err)));
      });
      $("#gife-clear")?.addEventListener("click", clearGife);
      window.DevToolsTemp?.registerCleanup(clearGife);
      gifeApply?.addEventListener("click", () => {
        applyGifeEdit().catch((err) => setError(gifeError, err.message || String(err)));
      });
      gifeAutoCrop?.addEventListener("click", autoGifeCrop);
      gifeResetCrop?.addEventListener("click", () => {
        setGifeCropPct(0, 0, 100, 100);
        syncGifeMeta();
      });
      [gifeTrimHead, gifeTrimTail].forEach((el) => {
        el?.addEventListener("input", () => {
          stopGifePlay();
          syncGifeMeta();
          layoutGifeTimeline();
        });
      });
      [gifeCropX, gifeCropY, gifeCropW, gifeCropH].forEach((el) => {
        el?.addEventListener("input", () => {
          syncGifeMeta();
          paintGifeCropEditor();
        });
      });
      gifePlay?.addEventListener("click", playGifeKeepRange);
      gifePrev?.addEventListener("click", () => {
        stopGifePlay();
        setGifeCursor(gifeCursor - 1);
      });
      gifeNext?.addEventListener("click", () => {
        stopGifePlay();
        setGifeCursor(gifeCursor + 1);
      });
      gifeMarkStart?.addEventListener("click", markGifeStart);
      gifeMarkEnd?.addEventListener("click", markGifeEnd);
      gifeCutAdd?.addEventListener("click", addGifeCutAtCursor);
      gifeCutMarkStart?.addEventListener("click", markGifeCutStart);
      gifeCutMarkEnd?.addEventListener("click", markGifeCutEnd);
      gifeCutDel?.addEventListener("click", deleteSelectedGifeCut);
      gifeCutClear?.addEventListener("click", clearGifeCuts);
      bindGifeTimeline();
      gifeCropStage?.addEventListener("pointerdown", (e) => {
        const box = e.target.closest("#gife-crop-box");
        if (!box || box.hidden || !gifeFrames.length) return;
        const geom = gifeCropStage._gifeGeom;
        if (!geom) return;
        const handle = e.target.closest("[data-gife-handle]")?.dataset?.gifeHandle || "";
        gifeCropStage.setPointerCapture(e.pointerId);
        gifeCropStage.classList.add("is-dragging");
        gifeCropDrag = {
          handle,
          kind: handle ? "resize" : "pan",
          x0: e.clientX,
          y0: e.clientY,
          box0: { ...geom.box },
          geom,
        };
        e.preventDefault();
      });
      gifeCropStage?.addEventListener("pointermove", (e) => {
        if (!gifeCropDrag) return;
        const dx = e.clientX - gifeCropDrag.x0;
        const dy = e.clientY - gifeCropDrag.y0;
        const geom = gifeCropDrag.geom;
        const img = { x: geom.ox, y: geom.oy, w: geom.dw, h: geom.dh };
        let next = { ...gifeCropDrag.box0 };
        if (gifeCropDrag.kind === "pan") {
          next.x = gifeCropDrag.box0.x + dx;
          next.y = gifeCropDrag.box0.y + dy;
          next.x = Math.max(img.x, Math.min(img.x + img.w - next.w, next.x));
          next.y = Math.max(img.y, Math.min(img.y + img.h - next.h, next.y));
        } else {
          const h = gifeCropDrag.handle;
          if (h.includes("e")) next.w = gifeCropDrag.box0.w + dx;
          if (h.includes("w")) {
            next.w = gifeCropDrag.box0.w - dx;
            next.x = gifeCropDrag.box0.x + dx;
          }
          if (h.includes("s")) next.h = gifeCropDrag.box0.h + dy;
          if (h.includes("n")) {
            next.h = gifeCropDrag.box0.h - dy;
            next.y = gifeCropDrag.box0.y + dy;
          }
          next.w = Math.max(24, next.w);
          next.h = Math.max(24, next.h);
          if (h.includes("w")) next.x = gifeCropDrag.box0.x + gifeCropDrag.box0.w - next.w;
          if (h.includes("n")) next.y = gifeCropDrag.box0.y + gifeCropDrag.box0.h - next.h;
          next.x = Math.max(img.x, Math.min(img.x + img.w - next.w, next.x));
          next.y = Math.max(img.y, Math.min(img.y + img.h - next.h, next.y));
          next.w = Math.min(next.w, img.x + img.w - next.x);
          next.h = Math.min(next.h, img.y + img.h - next.y);
        }
        gifeCropBox.style.left = `${next.x}px`;
        gifeCropBox.style.top = `${next.y}px`;
        gifeCropBox.style.width = `${next.w}px`;
        gifeCropBox.style.height = `${next.h}px`;
        applyGifeBoxToInputs(next, geom);
      });
      const endGifeCropDrag = (e) => {
        if (!gifeCropDrag) return;
        gifeCropStage?.classList.remove("is-dragging");
        try {
          gifeCropStage?.releasePointerCapture?.(e.pointerId);
        } catch (_) {}
        gifeCropDrag = null;
        paintGifeCropEditor();
      };
      gifeCropStage?.addEventListener("pointerup", endGifeCropDrag);
      gifeCropStage?.addEventListener("pointercancel", endGifeCropDrag);
      window.addEventListener("resize", () => {
        if (!gifeFrames.length) return;
        paintGifeCropEditor();
        paintGifeFilmstrip();
        layoutGifeTimeline();
      });
      });
    } catch (err) {
      console.error("gif edit init failed", err);
    }
})();
