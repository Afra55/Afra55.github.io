(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const P = window.DevToolsPure;
  const MIN_SPAN = 0.5;
  const FILM_THUMBS = 18;

  function toast(msg) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.classList.add("is-show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.classList.remove("is-show");
      setTimeout(() => {
        el.hidden = true;
      }, 200);
    }, 2000);
  }

  function setError(el, msg) {
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }

  function formatClock(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    const whole = Math.floor(r);
    const frac = Math.round((r - whole) * 10);
    if (frac > 0 && frac < 10) return `${m}:${String(whole).padStart(2, "0")}.${frac}`;
    return `${m}:${String(whole).padStart(2, "0")}`;
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function even(n) {
    const x = Math.max(2, Math.round(n));
    return x % 2 === 0 ? x : x - 1;
  }

  function parseAspect(aspect) {
    const a = String(aspect || "free");
    if (a === "free") return null;
    const [w, h] = a.split(":").map(Number);
    if (!(w > 0 && h > 0)) return null;
    return w / h;
  }

  function waitSeek(video) {
    return new Promise((resolve) => {
      if (!video) return resolve();
      const done = () => {
        video.removeEventListener("seeked", done);
        resolve();
      };
      video.addEventListener("seeked", done);
      setTimeout(done, 800);
    });
  }

  const fileInput = $("#vtrim-file");
  const clearBtn = $("#vtrim-clear");
  const resetBtn = $("#vtrim-reset");
  const meta = $("#vtrim-meta");
  const stage = $("#vtrim-stage");
  const previewWrap = $("#vtrim-preview-wrap");
  const video = $("#vtrim-video");
  const cropBox = $("#vtrim-crop-box");
  const playBtn = $("#vtrim-play");
  const muteBtn = $("#vtrim-mute");
  const clockEl = $("#vtrim-clock");
  const rangeLabel = $("#vtrim-range-label");
  const timeline = $("#vtrim-timeline");
  const filmstrip = $("#vtrim-filmstrip");
  const selEl = $("#vtrim-sel");
  const handleStart = $("#vtrim-handle-start");
  const handleEnd = $("#vtrim-handle-end");
  const playhead = $("#vtrim-playhead");
  const windowEl = $("#vtrim-window");
  const nudgeStartM = $("#vtrim-nudge-start-m");
  const nudgeStartP = $("#vtrim-nudge-start-p");
  const nudgeEndM = $("#vtrim-nudge-end-m");
  const nudgeEndP = $("#vtrim-nudge-end-p");
  const cropEnable = $("#vtrim-crop-enable");
  const rotL = $("#vtrim-rot-l");
  const rotR = $("#vtrim-rot-r");
  const flipHBtn = $("#vtrim-flip-h");
  const exportBtn = $("#vtrim-export");
  const abortBtn = $("#vtrim-abort");
  const downloadA = $("#vtrim-download");
  const progress = $("#vtrim-progress");
  const progressFill = $("#vtrim-progress-fill");
  const progressText = $("#vtrim-progress-text");
  const progressPct = $("#vtrim-progress-pct");
  const progressSub = $("#vtrim-progress-sub");
  const resultVideo = $("#vtrim-result");
  const errorEl = $("#vtrim-error");

  if (!fileInput || !video) return;

  let sourceFile = null;
  let objectUrl = "";
  let duration = 0;
  let startSec = 0;
  let endSec = 0;
  let muted = true;
  let playing = false;
  let busy = false;
  let abortFlag = false;
  let aspect = "free";
  /** crop in source pixel space (pre-rotate display uses CSS; export uses rotate then crop on rotated frame) */
  let crop = { x: 0, y: 0, w: 1, h: 1 };
  let rotate = 0; // 0|90|180|270
  let flipH = false;
  let resultUrl = "";
  let drag = null;
  let filmReady = false;
  let filmGen = 0;
  let activeHandle = "start";

  const DEFAULT_META =
    "支持 MP4 / WebM / MOV。选择后仅本机读取，不会上传。关闭页面会释放本次视频。";

  function engine() {
    return window.DevToolsFfmpeg || null;
  }

  function setProgress(visible, ratio, text, opts = {}) {
    if (!progress) return;
    progress.hidden = !visible;
    const r = clamp(Number(ratio) || 0, 0, 1);
    if (progressFill) {
      progressFill.style.width = `${Math.round(r * 100)}%`;
      progressFill.classList.toggle("is-active", visible);
      progressFill.classList.toggle("is-busy", Boolean(opts.busy));
    }
    if (progressPct) {
      progressPct.hidden = !visible;
      progressPct.textContent = `${Math.round(r * 100)}%`;
    }
    if (progressText) progressText.textContent = text || "";
    if (progressSub) {
      const sub = opts.sub || "";
      progressSub.textContent = sub;
      progressSub.hidden = !sub;
    }
  }

  function revokeResult() {
    if (resultUrl) {
      try {
        URL.revokeObjectURL(resultUrl);
      } catch (_) {}
      resultUrl = "";
    }
    if (resultVideo) {
      resultVideo.removeAttribute("src");
      resultVideo.hidden = true;
      try {
        resultVideo.load();
      } catch (_) {}
    }
    if (downloadA) {
      downloadA.hidden = true;
      downloadA.removeAttribute("href");
    }
  }

  function clearAll() {
    abortFlag = true;
    try {
      video.pause();
    } catch (_) {}
    if (objectUrl) {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch (_) {}
      objectUrl = "";
    }
    sourceFile = null;
    duration = 0;
    startSec = 0;
    endSec = 0;
    crop = { x: 0, y: 0, w: 1, h: 1 };
    rotate = 0;
    flipH = false;
    aspect = "free";
    filmReady = false;
    playing = false;
    revokeResult();
    video.removeAttribute("src");
    try {
      video.load();
    } catch (_) {}
    if (stage) stage.hidden = true;
    if (meta) meta.textContent = DEFAULT_META;
    setError(errorEl, "");
    setProgress(false, 0, "");
    syncAspectUi();
    syncMuteUi();
    syncCropBoxVisibility();
    setButtons();
    paintTimeline();
  }

  function resetEdit() {
    if (!duration) return;
    startSec = 0;
    endSec = duration;
    crop = { x: 0, y: 0, w: video.videoWidth || 1, h: video.videoHeight || 1 };
    rotate = 0;
    flipH = false;
    aspect = "free";
    if (cropEnable) cropEnable.checked = true;
    syncAspectUi();
    applyVideoTransform();
    layoutCropBox();
    seekTo(startSec);
    paintTimeline();
    updateLabels();
    setButtons();
    toast("已重置为全长、未裁剪");
  }

  function setButtons() {
    const has = Boolean(sourceFile && duration > 0);
    if (playBtn) playBtn.disabled = !has || busy;
    if (muteBtn) muteBtn.disabled = !has;
    if (resetBtn) resetBtn.disabled = !has || busy;
    if (exportBtn) exportBtn.disabled = !has || busy;
    if (rotL) rotL.disabled = !has || busy;
    if (rotR) rotR.disabled = !has || busy;
    if (flipHBtn) flipHBtn.disabled = !has || busy;
    if (abortBtn) abortBtn.hidden = !busy;
    [nudgeStartM, nudgeStartP, nudgeEndM, nudgeEndP].forEach((btn) => {
      if (btn) btn.disabled = !has || busy;
    });
    syncActiveHandleUi();
  }

  function syncActiveHandleUi() {
    handleStart?.classList.toggle("is-active", activeHandle === "start");
    handleEnd?.classList.toggle("is-active", activeHandle === "end");
  }

  function syncMuteUi() {
    video.muted = muted;
    if (muteBtn) {
      muteBtn.textContent = muted ? "开声音" : "静音";
      muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    }
  }

  function syncAspectUi() {
    document.querySelectorAll("[data-vtrim-aspect]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.vtrimAspect === aspect);
    });
  }

  function syncCropBoxVisibility() {
    const on = Boolean(cropEnable?.checked) && Boolean(sourceFile);
    if (cropBox) cropBox.hidden = !on;
    if (previewWrap) previewWrap.classList.toggle("is-cropping", on);
  }

  function applyVideoTransform() {
    const parts = [];
    if (rotate) parts.push(`rotate(${rotate}deg)`);
    if (flipH) parts.push("scaleX(-1)");
    video.style.transform = parts.length ? parts.join(" ") : "";
    video.style.transformOrigin = "center center";
  }

  function displaySize() {
    const vw = video.videoWidth || 1;
    const vh = video.videoHeight || 1;
    const swapped = rotate === 90 || rotate === 270;
    return { w: swapped ? vh : vw, h: swapped ? vw : vh, srcW: vw, srcH: vh };
  }

  /** Map source crop rect into display (after rotate/flip) space for overlay */
  function cropToDisplayRect() {
    const { w: dw, h: dh, srcW, srcH } = displaySize();
    const mapPoint = (cx, cy) => {
      let nx = cx;
      let ny = cy;
      if (rotate === 90) {
        nx = srcH - cy;
        ny = cx;
      } else if (rotate === 180) {
        nx = srcW - cx;
        ny = srcH - cy;
      } else if (rotate === 270) {
        nx = cy;
        ny = srcW - cx;
      }
      if (flipH) nx = dw - nx;
      return [nx, ny];
    };
    const x = crop.x;
    const y = crop.y;
    const w = crop.w;
    const h = crop.h;
    const pts = [
      mapPoint(x, y),
      mapPoint(x + w, y),
      mapPoint(x + w, y + h),
      mapPoint(x, y + h),
    ];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    const right = Math.max(...xs);
    const bottom = Math.max(...ys);
    return {
      x: clamp(left, 0, dw),
      y: clamp(top, 0, dh),
      w: clamp(right - left, 1, dw),
      h: clamp(bottom - top, 1, dh),
      dw,
      dh,
    };
  }

  function displayRectToCrop(dx, dy, dwBox, dhBox) {
    const { w: dw, h: dh, srcW, srcH } = displaySize();
    const unmap = (px, py) => {
      let nx = px;
      let ny = py;
      if (flipH) nx = dw - nx;
      if (rotate === 90) {
        const sx = ny;
        const sy = srcH - nx;
        return [sx, sy];
      }
      if (rotate === 180) return [srcW - nx, srcH - ny];
      if (rotate === 270) {
        const sx = srcW - ny;
        const sy = nx;
        return [sx, sy];
      }
      return [nx, ny];
    };
    const pts = [
      unmap(dx, dy),
      unmap(dx + dwBox, dy),
      unmap(dx + dwBox, dy + dhBox),
      unmap(dx, dy + dhBox),
    ];
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    let x = Math.min(...xs);
    let y = Math.min(...ys);
    let w = Math.max(...xs) - x;
    let h = Math.max(...ys) - y;
    x = clamp(x, 0, srcW - 1);
    y = clamp(y, 0, srcH - 1);
    w = clamp(w, 1, srcW - x);
    h = clamp(h, 1, srcH - y);
    crop = { x, y, w, h };
  }

  function videoContentRect() {
    const wrap = previewWrap.getBoundingClientRect();
    const { w: dw, h: dh } = displaySize();
    const scale = Math.min(wrap.width / dw, wrap.height / dh);
    const rw = dw * scale;
    const rh = dh * scale;
    const left = (wrap.width - rw) / 2;
    const top = (wrap.height - rh) / 2;
    return { left, top, width: rw, height: rh, scale, dw, dh };
  }

  function layoutCropBox() {
    if (!cropBox || cropBox.hidden || !video.videoWidth) return;
    const geom = videoContentRect();
    const d = cropToDisplayRect();
    const left = geom.left + (d.x / d.dw) * geom.width;
    const top = geom.top + (d.y / d.dh) * geom.height;
    const width = (d.w / d.dw) * geom.width;
    const height = (d.h / d.dh) * geom.height;
    cropBox.style.left = `${left}px`;
    cropBox.style.top = `${top}px`;
    cropBox.style.width = `${width}px`;
    cropBox.style.height = `${height}px`;
  }

  function fitCropToAspect() {
    if (!video.videoWidth) return;
    const { w: dw, h: dh, srcW, srcH } = displaySize();
    // Fit aspect in *display* space, then map back to source crop.
    let x = 0;
    let y = 0;
    let w = dw;
    let h = dh;
    const ratio = parseAspect(aspect);
    if (ratio) {
      if (dw / dh > ratio) {
        h = dh;
        w = h * ratio;
        x = (dw - w) / 2;
        y = 0;
      } else {
        w = dw;
        h = w / ratio;
        x = 0;
        y = (dh - h) / 2;
      }
    } else if (P?.calcCropRect) {
      const rect = P.calcCropRect(srcW, srcH, { aspect: "free", center: true });
      crop = { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
      layoutCropBox();
      return;
    } else {
      crop = { x: 0, y: 0, w: srcW, h: srcH };
      layoutCropBox();
      return;
    }
    displayRectToCrop(x, y, w, h);
    layoutCropBox();
  }

  function updateLabels() {
    const now = video.currentTime || startSec;
    if (clockEl) clockEl.textContent = `${formatClock(now)} / ${formatClock(duration)}`;
    const span = Math.max(0, endSec - startSec);
    if (rangeLabel) {
      rangeLabel.textContent = `保留 ${formatClock(span)}（${formatClock(startSec)}–${formatClock(endSec)}）`;
    }
  }

  function paintTimeline() {
    if (!selEl || !duration) {
      if (selEl) {
        selEl.style.setProperty("--vtrim-start", "0%");
        selEl.style.setProperty("--vtrim-end", "100%");
        selEl.style.setProperty("--vtrim-play", "0%");
      }
      return;
    }
    const sPct = (startSec / duration) * 100;
    const ePct = (endSec / duration) * 100;
    const pPct = ((video.currentTime || 0) / duration) * 100;
    selEl.style.setProperty("--vtrim-start", `${sPct}%`);
    selEl.style.setProperty("--vtrim-end", `${ePct}%`);
    selEl.style.setProperty("--vtrim-play", `${clamp(pPct, 0, 100)}%`);
    if (handleStart) {
      handleStart.setAttribute("aria-valuemin", "0");
      handleStart.setAttribute("aria-valuemax", String(endSec - MIN_SPAN));
      handleStart.setAttribute("aria-valuenow", String(startSec));
    }
    if (handleEnd) {
      handleEnd.setAttribute("aria-valuemin", String(startSec + MIN_SPAN));
      handleEnd.setAttribute("aria-valuemax", String(duration));
      handleEnd.setAttribute("aria-valuenow", String(endSec));
    }
  }

  async function buildFilmstrip() {
    if (!filmstrip || !video.videoWidth || !duration) return;
    const gen = ++filmGen;
    filmReady = false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = timeline?.clientWidth || 640;
    const cssH = Math.max(56, timeline?.clientHeight || 64);
    filmstrip.width = Math.round(cssW * dpr);
    filmstrip.height = Math.round(cssH * dpr);
    filmstrip.style.width = "100%";
    filmstrip.style.height = `${cssH}px`;
    const ctx = filmstrip.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0a101c";
    ctx.fillRect(0, 0, cssW, cssH);
    const n = FILM_THUMBS;
    const tw = cssW / n;
    const wasTime = video.currentTime;
    const wasPaused = video.paused;
    try {
      video.pause();
    } catch (_) {}
    for (let i = 0; i < n; i++) {
      if (gen !== filmGen) return;
      const t = (duration * i) / Math.max(1, n - 1);
      try {
        video.currentTime = Math.min(duration - 0.05, Math.max(0, t));
        await waitSeek(video);
        if (gen !== filmGen) return;
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const scale = Math.max(tw / vw, cssH / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        ctx.drawImage(video, i * tw + (tw - dw) / 2, (cssH - dh) / 2, dw, dh);
      } catch (_) {
        ctx.fillStyle = "#1a2436";
        ctx.fillRect(i * tw, 0, tw, cssH);
      }
    }
    try {
      video.currentTime = clamp(wasTime, startSec, Math.max(startSec, endSec - 0.04));
      await waitSeek(video);
      if (!wasPaused) video.play().catch(() => {});
    } catch (_) {}
    if (gen !== filmGen) return;
    filmReady = true;
    paintTimeline();
  }

  function seekTo(t, { force = false } = {}) {
    const next = force
      ? clamp(t, 0, Math.max(0, duration - 0.04))
      : clamp(t, startSec, Math.max(startSec, endSec - 0.04));
    try {
      video.currentTime = next;
    } catch (_) {}
    paintTimeline();
    updateLabels();
  }

  function setStart(t, { preview = true } = {}) {
    startSec = clamp(t, 0, endSec - MIN_SPAN);
    activeHandle = "start";
    syncActiveHandleUi();
    if (preview) seekTo(startSec, { force: true });
    else if (video.currentTime < startSec) seekTo(startSec);
    paintTimeline();
    updateLabels();
  }

  function setEnd(t, { preview = true } = {}) {
    endSec = clamp(t, startSec + MIN_SPAN, duration);
    activeHandle = "end";
    syncActiveHandleUi();
    if (preview) seekTo(Math.max(startSec, endSec - 0.04), { force: true });
    else if (video.currentTime > endSec) seekTo(endSec - 0.04);
    paintTimeline();
    updateLabels();
  }

  function shiftWindow(deltaSec) {
    const span = endSec - startSec;
    let nextStart = startSec + deltaSec;
    let nextEnd = endSec + deltaSec;
    if (nextStart < 0) {
      nextStart = 0;
      nextEnd = span;
    }
    if (nextEnd > duration) {
      nextEnd = duration;
      nextStart = Math.max(0, duration - span);
    }
    startSec = nextStart;
    endSec = nextEnd;
    seekTo(clamp(video.currentTime || startSec, startSec, Math.max(startSec, endSec - 0.04)));
    paintTimeline();
    updateLabels();
  }

  function ratioFromClientX(clientX) {
    const rect = timeline.getBoundingClientRect();
    return clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
  }

  async function togglePlay() {
    if (!sourceFile || busy) return;
    if (!video.paused) {
      video.pause();
      playing = false;
      if (playBtn) playBtn.textContent = "播放";
      return;
    }
    if (video.currentTime < startSec || video.currentTime >= endSec - 0.05) {
      seekTo(startSec);
    }
    try {
      await video.play();
      playing = true;
      if (playBtn) playBtn.textContent = "暂停";
    } catch (err) {
      if (!muted) {
        muted = true;
        syncMuteUi();
        try {
          await video.play();
          playing = true;
          if (playBtn) playBtn.textContent = "暂停";
          toast("浏览器限制有声播放，已改为静音");
          return;
        } catch (_) {}
      }
      toast(err?.message || "无法播放");
    }
  }

  function needsReencode() {
    const fullCrop =
      Math.abs(crop.x) < 1 &&
      Math.abs(crop.y) < 1 &&
      Math.abs(crop.w - (video.videoWidth || 0)) < 2 &&
      Math.abs(crop.h - (video.videoHeight || 0)) < 2;
    const cropOn = Boolean(cropEnable?.checked) && !fullCrop;
    return cropOn || rotate !== 0 || flipH;
  }

  function buildVf() {
    const filters = [];
    if (rotate === 90) filters.push("transpose=1");
    else if (rotate === 180) filters.push("transpose=1,transpose=1");
    else if (rotate === 270) filters.push("transpose=2");
    if (flipH) filters.push("hflip");

    const srcW = video.videoWidth;
    const srcH = video.videoHeight;
    let cw = srcW;
    let ch = srcH;
    if (rotate === 90 || rotate === 270) {
      cw = srcH;
      ch = srcW;
    }

    // Map source crop → after rotate/flip space for ffmpeg (filters apply in order)
    // We apply rotate/flip first, then crop in the transformed frame.
    const d = cropToDisplayRect();
    const cropOn = Boolean(cropEnable?.checked);
    if (cropOn) {
      const x = even(clamp(d.x, 0, cw - 2));
      const y = even(clamp(d.y, 0, ch - 2));
      let w = even(clamp(d.w, 2, cw - x));
      let h = even(clamp(d.h, 2, ch - y));
      if (w < 2) w = 2;
      if (h < 2) h = 2;
      if (x + w > cw) w = even(cw - x) || 2;
      if (y + h > ch) h = even(ch - y) || 2;
      filters.push(`crop=${w}:${h}:${x}:${y}`);
    }
    return filters.join(",");
  }

  async function exportVideo() {
    const eng = engine();
    if (!eng?.getInstance) {
      setError(errorEl, "编码器未就绪，请刷新页面后重试");
      return;
    }
    if (!sourceFile || busy) return;
    const span = endSec - startSec;
    if (!(span >= MIN_SPAN)) {
      toast(`保留时长至少 ${MIN_SPAN} 秒`);
      return;
    }
    abortFlag = false;
    busy = true;
    setButtons();
    setError(errorEl, "");
    revokeResult();
    if (abortBtn) abortBtn.hidden = false;
    setProgress(true, 0.02, "准备导出…", { busy: true });
    try {
      await eng.prewarm?.().catch(() => {});
      const ffmpeg = await eng.getInstance((r, t) => setProgress(true, 0.05 + r * 0.2, t || "加载编码器…", { busy: true }));
      if (abortFlag) throw new Error("已取消");
      const inName = await eng.ensureInputWritten(ffmpeg, sourceFile, (r, t) =>
        setProgress(true, 0.25 + r * 0.15, t || "写入视频…", { busy: true })
      );
      const outName = `vtrim-out-${Date.now()}.mp4`;
      const ss = String(Math.max(0, startSec));
      const tt = String(Math.max(MIN_SPAN, span));
      const reencode = needsReencode();
      const attempts = [];
      if (!reencode) {
        attempts.push({
          label: "快速剪切",
          args: ["-ss", ss, "-t", tt, "-i", inName, "-c", "copy", "-avoid_negative_ts", "make_zero", "-movflags", "+faststart", "-y", outName],
        });
      }
      const vf = buildVf();
      const encArgs = ["-ss", ss, "-t", tt, "-i", inName];
      if (vf) encArgs.push("-vf", vf);
      encArgs.push(
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "23",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        "-y",
        outName
      );
      attempts.push({ label: reencode ? "裁剪重编码" : "重编码", args: encArgs });
      // fallback without audio if aac fails
      const encNoA = ["-ss", ss, "-t", tt, "-i", inName];
      if (vf) encNoA.push("-vf", vf);
      encNoA.push("-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", outName);
      attempts.push({ label: "无音轨重编码", args: encNoA });

      let outBlob = null;
      for (const attempt of attempts) {
        if (abortFlag) throw new Error("已取消");
        setProgress(true, 0.45, `${attempt.label}…`, { busy: true, sub: `${formatClock(startSec)}–${formatClock(endSec)}` });
        try {
          await ffmpeg.deleteFile(outName);
        } catch (_) {}
        try {
          const code = await ffmpeg.exec(attempt.args);
          if (code !== 0) continue;
          const data = await ffmpeg.readFile(outName);
          const raw = data instanceof Uint8Array ? data : new Uint8Array(data);
          if (raw.byteLength > 32) {
            const bytes = new Uint8Array(raw.byteLength);
            bytes.set(raw);
            outBlob = new Blob([bytes], { type: "video/mp4" });
            break;
          }
        } catch (err) {
          if (String(err?.message) === "已取消") throw err;
        }
      }
      try {
        await ffmpeg.deleteFile(outName);
      } catch (_) {}
      if (!outBlob) throw new Error("导出失败，可尝试缩短时长或关闭裁剪后重试");
      resultUrl = URL.createObjectURL(outBlob);
      if (resultVideo) {
        resultVideo.src = resultUrl;
        resultVideo.hidden = false;
      }
      if (downloadA) {
        downloadA.href = resultUrl;
        downloadA.download = `trimmed-${Date.now()}.mp4`;
        downloadA.hidden = false;
      }
      // auto download
      const a = document.createElement("a");
      a.href = resultUrl;
      a.download = downloadA?.download || "trimmed.mp4";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setProgress(true, 1, "导出完成");
      toast("已导出修剪后的视频");
    } catch (err) {
      if (String(err?.message) === "已取消") toast("已取消导出");
      else setError(errorEl, err?.message || String(err));
      setProgress(false, 0, "");
    } finally {
      busy = false;
      if (abortBtn) abortBtn.hidden = true;
      setButtons();
    }
  }

  async function onFile(file) {
    if (!file) return;
    clearAll();
    abortFlag = false;
    sourceFile = file;
    objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    video.muted = true;
    muted = true;
    syncMuteUi();
    setError(errorEl, "");
    try {
      await new Promise((resolve, reject) => {
        const onMeta = () => {
          cleanup();
          resolve();
        };
        const onErr = () => {
          cleanup();
          reject(new Error("无法读取视频"));
        };
        const cleanup = () => {
          video.removeEventListener("loadedmetadata", onMeta);
          video.removeEventListener("error", onErr);
        };
        video.addEventListener("loadedmetadata", onMeta);
        video.addEventListener("error", onErr);
        if (video.readyState >= 1 && video.videoWidth) resolve();
      });
      duration = Number(video.duration) || 0;
      if (!(duration > 0)) throw new Error("无法获取视频时长");
      startSec = 0;
      endSec = duration;
      crop = { x: 0, y: 0, w: video.videoWidth, h: video.videoHeight };
      if (stage) stage.hidden = false;
      if (meta) {
        meta.textContent = `本地文件，不上传 · ${file.name || "video"} · ${formatClock(duration)} · ${video.videoWidth}×${video.videoHeight}`;
      }
      syncCropBoxVisibility();
      applyVideoTransform();
      layoutCropBox();
      paintTimeline();
      updateLabels();
      setButtons();
      toast("已选择，仅本机处理，不会上传");
      engine()?.prewarm?.().catch(() => {});
      await buildFilmstrip();
      seekTo(0);
    } catch (err) {
      setError(errorEl, err?.message || String(err));
      clearAll();
    }
  }

  // ---- events ----
  fileInput.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    onFile(f).finally(() => {
      fileInput.value = "";
    });
  });
  clearBtn?.addEventListener("click", () => clearAll());
  resetBtn?.addEventListener("click", () => resetEdit());
  playBtn?.addEventListener("click", () => togglePlay().catch(() => {}));
  muteBtn?.addEventListener("click", () => {
    muted = !muted;
    syncMuteUi();
  });
  rotL?.addEventListener("click", () => {
    rotate = (rotate + 270) % 360;
    applyVideoTransform();
    fitCropToAspect();
    layoutCropBox();
  });
  rotR?.addEventListener("click", () => {
    rotate = (rotate + 90) % 360;
    applyVideoTransform();
    fitCropToAspect();
    layoutCropBox();
  });
  flipHBtn?.addEventListener("click", () => {
    flipH = !flipH;
    applyVideoTransform();
    layoutCropBox();
  });
  cropEnable?.addEventListener("change", () => {
    syncCropBoxVisibility();
    layoutCropBox();
  });
  document.querySelectorAll("[data-vtrim-aspect]").forEach((btn) => {
    btn.addEventListener("click", () => {
      aspect = btn.dataset.vtrimAspect || "free";
      syncAspectUi();
      if (cropEnable && !cropEnable.checked) cropEnable.checked = true;
      syncCropBoxVisibility();
      fitCropToAspect();
    });
  });
  exportBtn?.addEventListener("click", () => exportVideo().catch((err) => setError(errorEl, err.message || String(err))));
  abortBtn?.addEventListener("click", () => {
    abortFlag = true;
    try {
      engine()?.terminate?.({ revokeAssets: false });
    } catch (_) {}
  });

  video.addEventListener("timeupdate", () => {
    if (!sourceFile) return;
    if (!video.paused && video.currentTime >= endSec - 0.05) {
      seekTo(startSec);
      // loop within selection
      video.play().catch(() => {});
    }
    paintTimeline();
    updateLabels();
  });
  video.addEventListener("pause", () => {
    playing = false;
    if (playBtn) playBtn.textContent = "播放";
  });
  video.addEventListener("play", () => {
    playing = true;
    if (playBtn) playBtn.textContent = "暂停";
  });

  // timeline drag
  function hitKind(ratio, target) {
    if (target === handleStart || target?.classList?.contains("vtrim-handle-start")) return "start";
    if (target === handleEnd || target?.classList?.contains("vtrim-handle-end")) return "end";
    if (target === windowEl || target?.classList?.contains("vtrim-window")) return "window";
    const startR = startSec / duration;
    const endR = endSec / duration;
    const pxPad = 0.045; // ~ handle hit slop
    if (Math.abs(ratio - startR) <= pxPad) return "start";
    if (Math.abs(ratio - endR) <= pxPad) return "end";
    if (ratio < startR) return "start";
    if (ratio > endR) return "end";
    return "seek";
  }

  function onTimelinePointerDown(e) {
    if (!duration || busy) return;
    try {
      video.pause();
    } catch (_) {}
    const ratio = ratioFromClientX(e.clientX);
    const t = ratio * duration;
    const kind = hitKind(ratio, e.target);
    if (kind === "start") {
      drag = { kind: "start", pointerId: e.pointerId };
      handleStart?.setPointerCapture?.(e.pointerId);
      setStart(t);
    } else if (kind === "end") {
      drag = { kind: "end", pointerId: e.pointerId };
      handleEnd?.setPointerCapture?.(e.pointerId);
      setEnd(t);
    } else if (kind === "window") {
      drag = {
        kind: "window",
        pointerId: e.pointerId,
        originX: e.clientX,
        originStart: startSec,
        originEnd: endSec,
      };
      timeline?.classList.add("is-dragging-window");
      windowEl?.setPointerCapture?.(e.pointerId);
    } else {
      seekTo(t);
      drag = { kind: "seek", pointerId: e.pointerId };
    }
    e.preventDefault();
  }
  function onTimelinePointerMove(e) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.kind === "window") {
      const rect = timeline.getBoundingClientRect();
      const deltaSec = ((e.clientX - drag.originX) / Math.max(1, rect.width)) * duration;
      startSec = drag.originStart;
      endSec = drag.originEnd;
      shiftWindow(deltaSec);
      return;
    }
    const t = ratioFromClientX(e.clientX) * duration;
    if (drag.kind === "start") setStart(t);
    else if (drag.kind === "end") setEnd(t);
    else seekTo(clamp(t, startSec, endSec));
  }
  function onTimelinePointerUp(e) {
    if (!drag || drag.pointerId !== e.pointerId) return;
    timeline?.classList.remove("is-dragging-window");
    drag = null;
  }
  timeline?.addEventListener("pointerdown", onTimelinePointerDown);
  timeline?.addEventListener("pointermove", onTimelinePointerMove);
  timeline?.addEventListener("pointerup", onTimelinePointerUp);
  timeline?.addEventListener("pointercancel", onTimelinePointerUp);

  function onHandleKey(which, e) {
    if (!duration || busy) return;
    const step = e.shiftKey ? 1 : 0.1;
    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      if (which === "start") setStart(startSec - step);
      else setEnd(endSec - step);
    } else if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      if (which === "start") setStart(startSec + step);
      else setEnd(endSec + step);
    }
  }
  handleStart?.addEventListener("keydown", (e) => onHandleKey("start", e));
  handleEnd?.addEventListener("keydown", (e) => onHandleKey("end", e));
  handleStart?.addEventListener("focus", () => {
    activeHandle = "start";
    syncActiveHandleUi();
  });
  handleEnd?.addEventListener("focus", () => {
    activeHandle = "end";
    syncActiveHandleUi();
  });

  nudgeStartM?.addEventListener("click", () => setStart(startSec - 0.1));
  nudgeStartP?.addEventListener("click", () => setStart(startSec + 0.1));
  nudgeEndM?.addEventListener("click", () => setEnd(endSec - 0.1));
  nudgeEndP?.addEventListener("click", () => setEnd(endSec + 0.1));

  // crop box drag
  let cropDrag = null;
  function onCropPointerDown(e) {
    if (cropBox?.hidden || busy) return;
    const handle = e.target?.closest?.("[data-vtrim-handle]");
    const geom = videoContentRect();
    const d = cropToDisplayRect();
    cropDrag = {
      pointerId: e.pointerId,
      handle: handle?.dataset?.vtrimHandle || "move",
      startX: e.clientX,
      startY: e.clientY,
      box: { ...d },
      geom,
    };
    cropBox.setPointerCapture?.(e.pointerId);
    previewWrap?.classList.add("is-dragging");
    e.preventDefault();
    e.stopPropagation();
  }
  function onCropPointerMove(e) {
    if (!cropDrag || cropDrag.pointerId !== e.pointerId) return;
    const { geom, box, handle } = cropDrag;
    const dx = (e.clientX - cropDrag.startX) / geom.scale;
    const dy = (e.clientY - cropDrag.startY) / geom.scale;
    let x = box.x;
    let y = box.y;
    let w = box.w;
    let h = box.h;
    const ratio = parseAspect(aspect);
    const minSide = 16;
    const applyAspect = () => {
      if (!ratio) return;
      if (handle === "n" || handle === "s") {
        w = h * ratio;
      } else {
        h = w / ratio;
      }
    };
    if (handle === "move") {
      x = clamp(box.x + dx, 0, box.dw - w);
      y = clamp(box.y + dy, 0, box.dh - h);
    } else {
      if (handle.includes("w")) {
        const nx = clamp(box.x + dx, 0, box.x + box.w - minSide);
        w = box.x + box.w - nx;
        x = nx;
      }
      if (handle.includes("e")) {
        w = clamp(box.w + dx, minSide, box.dw - box.x);
      }
      if (handle.includes("n")) {
        const ny = clamp(box.y + dy, 0, box.y + box.h - minSide);
        h = box.y + box.h - ny;
        y = ny;
      }
      if (handle.includes("s")) {
        h = clamp(box.h + dy, minSide, box.dh - box.y);
      }
      if (ratio) {
        applyAspect();
        if (x + w > box.dw) {
          w = box.dw - x;
          h = w / ratio;
        }
        if (y + h > box.dh) {
          h = box.dh - y;
          w = h * ratio;
        }
        if (w < minSide) {
          w = minSide;
          h = w / ratio;
        }
        if (h < minSide) {
          h = minSide;
          w = h * ratio;
        }
      }
      x = clamp(x, 0, box.dw - w);
      y = clamp(y, 0, box.dh - h);
    }
    displayRectToCrop(x, y, w, h);
    layoutCropBox();
  }
  function onCropPointerUp(e) {
    if (!cropDrag || cropDrag.pointerId !== e.pointerId) return;
    cropDrag = null;
    previewWrap?.classList.remove("is-dragging");
  }
  cropBox?.addEventListener("pointerdown", onCropPointerDown);
  window.addEventListener("pointermove", onCropPointerMove);
  window.addEventListener("pointerup", onCropPointerUp);
  window.addEventListener("pointercancel", onCropPointerUp);
  let resizeFilmTimer = 0;
  window.addEventListener("resize", () => {
    layoutCropBox();
    if (sourceFile && duration) {
      clearTimeout(resizeFilmTimer);
      resizeFilmTimer = setTimeout(() => buildFilmstrip().catch(() => {}), 180);
    }
  });

  window.DevToolsTemp?.registerCleanup?.(clearAll);

  window.DevToolsVtrim = {
    getRange: () => ({ start: startSec, end: endSec, duration }),
    getCrop: () => ({ ...crop, rotate, flipH, aspect }),
    setRange: (start, end) => {
      if (!duration) return false;
      const s = clamp(Number(start) || 0, 0, duration - MIN_SPAN);
      const e = clamp(Number(end) || duration, s + MIN_SPAN, duration);
      startSec = s;
      endSec = e;
      seekTo(s);
      paintTimeline();
      updateLabels();
      return true;
    },
    clear: clearAll,
  };

  setButtons();
  syncMuteUi();
  syncAspectUi();
})();
