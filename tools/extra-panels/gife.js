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
        "拖进度看当前帧，拖黄柄或点「设为起点 / 设为终点」去掉片头片尾；也可裁画面、去黑边后导出。";
      /** @type {{ canvas: HTMLCanvasElement, delay: number }[]} */
      let gifeFrames = [];
      let gifeSrcW = 0;
      let gifeSrcH = 0;
      let gifeSourceName = "edited.gif";
      let gifeOutUrl = "";
      let gifeBusy = false;
      let gifeCropDrag = null;
      let gifeCursor = 0;
      let gifeCumMs = [0];
      let gifeTotalMs = 0;
      let gifePlaying = false;
      let gifePlayTimer = 0;
      let gifeTrimDrag = null;
  
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

      function syncGifeMeta() {
        if (!gifeMeta || !gifeFrames.length) return;
        const { head, tail, n, start, end } = gifeTrimValues();
        const remain = Math.max(0, n - head - tail);
        const keepMs = gifeCumMs[end + 1] - gifeCumMs[start];
        gifeMeta.textContent = `${gifeSourceName.replace(/\.gif$/i, "")} · ${gifeSrcW}×${gifeSrcH} · ${n} 帧 · 约 ${(gifeTotalMs / 1000).toFixed(2)}s · 保留 ${remain} 帧（约 ${(keepMs / 1000).toFixed(2)}s）`;
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
          const kept = cur >= start && cur <= end;
          gifeClock.textContent = `第 ${cur + 1}/${n} 帧 · ${t.toFixed(2)}s${kept ? "" : " · 将去掉"}`;
        }
      }

      function setGifeCursor(i, { paint = true, clampToKeep = false } = {}) {
        const n = gifeFrames.length;
        if (n < 1) return;
        const { start, end } = gifeTrimValues();
        let next = Math.max(0, Math.min(n - 1, i));
        if (clampToKeep) next = Math.max(start, Math.min(end, next));
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
        if (!gifeFrames.length) return;
        if (gifePlaying) {
          stopGifePlay();
          return;
        }
        const { start, end } = gifeTrimValues();
        gifePlaying = true;
        setGifeButtons();
        if (gifeCursor < start || gifeCursor > end) setGifeCursor(start);
        else paintGifeCropEditor();
        const tick = () => {
          if (!gifePlaying) return;
          const range = gifeTrimValues();
          const delay = Math.max(40, gifeFrames[gifeCursor]?.delay || 100);
          gifePlayTimer = window.setTimeout(() => {
            if (!gifePlaying) return;
            const next = gifeCursor >= range.end ? range.start : gifeCursor + 1;
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
          gifeTrimDrag = null;
        };
        gifeTimeline.addEventListener("pointerdown", (e) => {
          if (!gifeFrames.length) return;
          stopGifePlay();
          const t = timeFromClientX(e.clientX);
          const handle = e.target.closest?.(".gife-handle");
          const windowEl = e.target.closest?.(".gife-window");
          const { start, end } = gifeTrimValues();
          if (handle === gifeHandleStart) {
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
        const { start, end } = gifeTrimValues();
        const sliced = gifeFrames.slice(start, end + 1);
        if (sliced.length < 1) throw new Error("删帧后至少需要保留 1 帧");
        const rect = gifeCropRectPx();
        if (rect.w < 2 || rect.h < 2) throw new Error("裁剪区域过小");
        return sliced.map((f) => ({
          canvas: applyGifeCropToCanvas(f.canvas, rect),
          delay: f.delay,
        }));
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
            quality: 10,
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
          const processed = getGifeProcessedFrames();
          setGifeProgress(true, 0.05, `处理 ${processed.length} 帧…`);
          const blob = await encodeGifeGif(processed, (ratio, text) => setGifeProgress(true, ratio, text));
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
          setGifeProgress(true, 1, `完成 · ${processed[0].canvas.width}×${processed[0].canvas.height} · ${formatKb(blob.size)}`);
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
