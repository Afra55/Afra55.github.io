(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const SCRUB_STEPS = 1000;
  const LONG_VIDEO_SEC = 180;

  const fileInput = $("#vplay-file");
  const clearBtn = $("#vplay-clear");
  const meta = $("#vplay-meta");
  const errorEl = $("#vplay-error");
  const stage = $("#vplay-stage");
  const zoomWrap = $("#vplay-zoom-wrap");
  const video = $("#vplay-video");
  const zoomPct = $("#vplay-zoom-pct");
  const playBtn = $("#vplay-play");
  const muteBtn = $("#vplay-mute");
  const scrub = $("#vplay-scrub");
  const clock = $("#vplay-clock");
  const fsBtn = $("#vplay-fs");
  const emptyHint = $("#vplay-empty-hint");
  const zoomHud = $(".vplay-zoom-hud", zoomWrap || document);
  const heightResize = $("#vplay-height-resize");
  const infoPanel = $("#vplay-info");
  const infoGrid = $("#vplay-info-grid");

  const HEIGHT_MIN = 280;
  const HEIGHT_DEFAULT = 480;
  const HEIGHT_STORAGE = "vplay-wrap-height-v1";

  let sourceFile = null;
  let objectUrl = "";
  let scrubbing = false;
  let muted = true;
  let seekReady = false;
  let primePromise = null;
  let seekGen = 0;

  const zoom = {
    scale: 1,
    x: 0,
    y: 0,
    fit: 1,
    rotate: 0,
    dragging: false,
    lastX: 0,
    lastY: 0,
    pointers: new Map(),
    pinchStartDist: 0,
    pinchStartScale: 1,
  };

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
    }, 1600);
  }

  function setError(msg) {
    if (!errorEl) return;
    if (!msg) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = msg;
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

  function formatKb(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  function gcd(a, b) {
    let x = Math.abs(Math.round(a));
    let y = Math.abs(Math.round(b));
    while (y) {
      const t = y;
      y = x % y;
      x = t;
    }
    return x || 1;
  }

  function aspectLabel(w, h) {
    if (!(w > 0 && h > 0)) return "—";
    const g = gcd(w, h);
    return `${Math.round(w / g)}∶${Math.round(h / g)}`;
  }

  function formatFileTime(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return "—";
    try {
      return new Date(n).toLocaleString("zh-CN", { hour12: false });
    } catch (_) {
      return "—";
    }
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function hasAudioTrack() {
    if (!video) return "未知";
    try {
      if (typeof video.audioTracks !== "undefined" && video.audioTracks?.length != null) {
        return video.audioTracks.length > 0 ? "有音轨" : "无音轨";
      }
      if (typeof video.mozHasAudio === "boolean") return video.mozHasAudio ? "有音轨" : "无音轨";
      if (typeof video.webkitAudioDecodedByteCount === "number") {
        return video.webkitAudioDecodedByteCount > 0 ? "有音轨" : "待解码";
      }
    } catch (_) {}
    return "未知";
  }

  function infoRow(label, value, mono = false) {
    const ddClass = mono ? ' class="mono"' : "";
    return `<div class="preview-info-item"><dt>${label}</dt><dd${ddClass}>${value}</dd></div>`;
  }

  function syncInfoPanel() {
    if (!infoPanel || !infoGrid) return;
    if (!sourceFile || !video?.videoWidth) {
      infoPanel.hidden = true;
      infoGrid.innerHTML = "";
      return;
    }
    infoPanel.hidden = false;
    const name = sourceFile.name || "未命名";
    const mime = sourceFile.type || "—";
    const d = duration();
    const w = video.videoWidth;
    const h = video.videoHeight;
    const mp = ((w * h) / 1_000_000).toFixed(2);
    const cur = currentTime();
    const paused = video.paused;
    const mutedNow = video.muted;
    const rate = video.playbackRate || 1;
    const seekable = video.seekable?.length ? video.seekable.end(video.seekable.length - 1) : d;
    infoGrid.innerHTML = [
      infoRow("文件名", escapeHtml(name)),
      infoRow("文件大小", formatKb(sourceFile.size), true),
      infoRow("MIME / 类型", mime || "—", true),
      infoRow("时长", `${formatClock(d)}（${d.toFixed(2)} s）`, true),
      infoRow("当前进度", `${formatClock(cur)} / ${formatClock(d)}`, true),
      infoRow("分辨率", `${w} × ${h} px`, true),
      infoRow("像素总量", `${(w * h).toLocaleString("zh-CN")}（约 ${mp} MP）`, true),
      infoRow("宽高比", aspectLabel(w, h), true),
      infoRow("画面缩放", `${Math.round((zoom.scale / Math.max(zoom.fit, 0.001)) * 100)}%`, true),
      infoRow("旋转", `${zoom.rotate}°`, true),
      infoRow("播放状态", paused ? "暂停" : "播放中"),
      infoRow("音量", mutedNow ? "静音" : "有声"),
      infoRow("播放速率", `${rate}×`, true),
      infoRow("音频", hasAudioTrack()),
      infoRow("可 seek 至", `${formatClock(seekable)}`, true),
      infoRow("修改时间", formatFileTime(sourceFile.lastModified)),
    ].join("");
  }

  function duration() {
    return Math.max(0, Number(video?.duration) || 0);
  }

  function currentTime() {
    if (!video) return 0;
    return Math.max(0, Math.min(duration(), Number(video.currentTime) || 0));
  }

  function waitVideoMetadata(videoEl, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (ok, arg) => {
        if (settled) return;
        settled = true;
        videoEl.removeEventListener("loadedmetadata", onMeta);
        videoEl.removeEventListener("error", onErr);
        window.clearTimeout(timer);
        if (ok) resolve(arg);
        else reject(arg);
      };
      const onMeta = () => finish(true);
      const onErr = () => finish(false, new Error("无法读取该视频"));
      const timer = window.setTimeout(() => {
        if (videoEl.videoWidth) finish(true);
        else finish(false, new Error("读取视频信息超时"));
      }, timeoutMs);
      videoEl.addEventListener("loadedmetadata", onMeta);
      videoEl.addEventListener("error", onErr);
      if (videoEl.readyState >= 1 && videoEl.videoWidth) finish(true);
    });
  }

  function fitZoomAfterLayout() {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => fitZoom());
    });
  }

  function heightMax() {
    return Math.max(HEIGHT_MIN, Math.min(Math.round(window.innerHeight * 0.92), 960));
  }

  function clampHeight(px) {
    return Math.max(HEIGHT_MIN, Math.min(heightMax(), Math.round(Number(px) || HEIGHT_DEFAULT)));
  }

  function readStoredHeight() {
    try {
      const raw = localStorage.getItem(HEIGHT_STORAGE);
      const n = Number(raw);
      if (Number.isFinite(n) && n >= HEIGHT_MIN) return clampHeight(n);
    } catch (_) {}
    return clampHeight(HEIGHT_DEFAULT);
  }

  function applyWrapHeight(px, opts = {}) {
    if (!zoomWrap) return HEIGHT_DEFAULT;
    const h = clampHeight(px);
    zoomWrap.style.setProperty("--vplay-wrap-height", `${h}px`);
    zoomWrap.style.height = `${h}px`;
    if (opts.persist !== false) {
      try {
        localStorage.setItem(HEIGHT_STORAGE, String(h));
      } catch (_) {}
    }
    if (opts.refit !== false && sourceFile && video?.videoWidth) fitZoomAfterLayout();
    return h;
  }

  function bindHeightControls() {
    applyWrapHeight(readStoredHeight(), { persist: false, refit: false });
    if (!heightResize || heightResize.dataset.bound === "1") return;
    heightResize.dataset.bound = "1";
    let startY = 0;
    let startH = HEIGHT_DEFAULT;
    const onMove = (e) => {
      const dy = e.clientY - startY;
      applyWrapHeight(startH + dy, { persist: true, refit: true });
    };
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
    heightResize.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      startY = e.clientY;
      startH = zoomWrap?.getBoundingClientRect().height || readStoredHeight();
      try {
        heightResize.setPointerCapture?.(e.pointerId);
      } catch (_) {}
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
    });
  }

  function resetSeekReady() {
    seekReady = false;
    primePromise = null;
  }

  function primeVideoForSeek() {
    if (!video?.src) return Promise.resolve();
    if (seekReady && video.readyState >= 2) return Promise.resolve();
    if (primePromise) return primePromise;
    video.preload = "auto";
    primePromise = new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        video.removeEventListener("loadeddata", finish);
        video.removeEventListener("seeked", finish);
        video.removeEventListener("canplay", finish);
        window.clearTimeout(timer);
        seekReady = true;
        primePromise = null;
        resolve();
      };
      const timer = window.setTimeout(finish, 1500);
      video.addEventListener("loadeddata", finish, { once: true });
      video.addEventListener("seeked", finish, { once: true });
      video.addEventListener("canplay", finish, { once: true });
      try {
        if (video.readyState >= 1) {
          const d = duration();
          video.currentTime = d > 0 ? Math.min(0.001, Math.max(0, d - 0.001)) : 0;
        } else {
          video.load();
        }
      } catch (_) {
        finish();
      }
      if (video.readyState >= 2) finish();
    });
    return primePromise;
  }

  function ensureSeekReady() {
    return primeVideoForSeek();
  }

  function syncEmptyState() {
    const has = Boolean(sourceFile && video?.src);
    if (emptyHint) emptyHint.hidden = has;
    if (video) video.hidden = !has;
    if (zoomHud) zoomHud.hidden = !has;
    if (zoomWrap) zoomWrap.classList.toggle("is-empty", !has);
  }

  function displayBox() {
    const nw = video?.videoWidth || 640;
    const nh = video?.videoHeight || 360;
    const rot = ((zoom.rotate % 360) + 360) % 360;
    if (rot === 90 || rot === 270) return { w: nh, h: nw };
    return { w: nw, h: nh };
  }

  function applyZoom() {
    if (!video) return;
    const nw = video.videoWidth || 1;
    const nh = video.videoHeight || 1;
    video.style.width = `${nw}px`;
    video.style.height = `${nh}px`;
    video.style.transform = `translate(${zoom.x}px, ${zoom.y}px) rotate(${zoom.rotate}deg) scale(${zoom.scale})`;
    zoomWrap?.classList.toggle("is-zoomed", zoom.scale > zoom.fit + 0.01);
    zoomWrap?.classList.toggle("is-panning", zoom.dragging);
    if (zoomPct) {
      const pct = zoom.fit ? Math.round((zoom.scale / zoom.fit) * 100) : 100;
      zoomPct.textContent = `${pct}%`;
    }
    syncInfoPanel();
  }

  function fitZoom() {
    if (!zoomWrap || !video?.videoWidth) return;
    const { w, h } = displayBox();
    const rw = zoomWrap.clientWidth || 1;
    const rh = zoomWrap.clientHeight || 1;
    const fit = Math.min(rw / w, rh / h) || 1;
    zoom.fit = fit;
    zoom.scale = fit;
    zoom.x = (rw - w * fit) / 2;
    zoom.y = (rh - h * fit) / 2;
    applyZoom();
  }

  function resetZoom() {
    zoom.scale = 1;
    zoom.x = 0;
    zoom.y = 0;
    zoom.fit = 1;
    zoom.rotate = 0;
    zoom.dragging = false;
    zoom.pointers.clear();
    if (video) video.style.transform = "";
    zoomWrap?.classList.remove("is-zoomed", "is-panning");
    if (zoomPct) zoomPct.textContent = "100%";
  }

  function zoomAt(clientX, clientY, nextScale) {
    if (!zoomWrap || !video) return;
    const rect = zoomWrap.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const min = zoom.fit * 0.5;
    const max = Math.max(zoom.fit * 12, 4);
    const scale = Math.min(max, Math.max(min, nextScale));
    const wx = (px - zoom.x) / (zoom.scale || 1);
    const wy = (py - zoom.y) / (zoom.scale || 1);
    zoom.scale = scale;
    zoom.x = px - wx * scale;
    zoom.y = py - wy * scale;
    applyZoom();
  }

  function bumpZoom(factor, clientX, clientY) {
    if (!zoomWrap) return;
    const rect = zoomWrap.getBoundingClientRect();
    const cx = clientX ?? rect.left + rect.width / 2;
    const cy = clientY ?? rect.top + rect.height / 2;
    zoomAt(cx, cy, zoom.scale * factor);
  }

  function syncMuteUi() {
    if (!video || !muteBtn) return;
    video.muted = muted;
    muteBtn.textContent = muted ? "开声音" : "静音";
    muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
    syncInfoPanel();
  }

  function syncPlayUi() {
    if (!playBtn || !video) return;
    playBtn.textContent = video.paused ? "播放" : "暂停";
    syncInfoPanel();
  }

  function setControlsEnabled(on) {
    [playBtn, muteBtn, fsBtn, $("#vplay-zoom-in"), $("#vplay-zoom-out"), $("#vplay-zoom-reset"), $("#vplay-zoom-rotate")].forEach((btn) => {
      if (btn) btn.disabled = !on;
    });
  }

  function syncClock() {
    if (!clock) return;
    clock.textContent = `${formatClock(currentTime())} / ${formatClock(duration())}`;
    syncInfoPanel();
  }

  function syncScrubFromVideo() {
    if (!scrub || scrubbing) return;
    const d = duration();
    scrub.disabled = !(d > 0);
    if (!(d > 0)) {
      scrub.value = "0";
      return;
    }
    scrub.max = String(SCRUB_STEPS);
    scrub.value = String(Math.round((currentTime() / d) * SCRUB_STEPS));
  }

  function applySeek(sec, opts = {}) {
    if (!video?.src) return;
    const t = Math.max(0, Math.min(duration(), Number(sec) || 0));
    if (!video.paused) video.pause();
    const gen = ++seekGen;
    const doSeek = () => {
      if (gen !== seekGen) return;
      try {
        if (opts.fromScrub || video.readyState < 3) video.currentTime = t;
        else if (typeof video.fastSeek === "function") video.fastSeek(t);
        else video.currentTime = t;
      } catch (_) {}
      if (!opts.fromScrub) syncScrubFromVideo();
      syncClock();
      syncPlayUi();
    };
    if (seekReady && video.readyState >= 2) {
      doSeek();
      return;
    }
    ensureSeekReady().then(doSeek);
  }

  function beginScrub() {
    if (!video?.src) return;
    scrubbing = true;
    if (!video.paused) {
      video.pause();
      syncPlayUi();
    }
    ensureSeekReady();
  }

  function scrubToValue() {
    if (!video?.src || !scrub) return;
    const t = (Number(scrub.value) / SCRUB_STEPS) * duration();
    syncClock();
    applySeek(t, { fromScrub: true });
  }

  function togglePlay() {
    if (!video?.src) return;
    if (video.paused) {
      if (duration() >= LONG_VIDEO_SEC) toast("长视频播放较耗内存，可多用拖动定位");
      video.play().catch(() => toast("无法播放"));
    } else {
      video.pause();
    }
  }

  function isVideoFile(file) {
    if (!file) return false;
    if (String(file.type || "").startsWith("video/")) return true;
    return /\.(mp4|webm|mov|m4v|mkv|avi)$/i.test(String(file.name || ""));
  }

  function pickVideoFromDataTransfer(dt) {
    const files = [...(dt?.files || [])];
    return files.find(isVideoFile) || null;
  }

  function hasFileDrop(dt) {
    return [...(dt?.types || [])].includes("Files");
  }

  let fileDragDepth = 0;

  function setFileDrag(on) {
    zoomWrap?.classList.toggle("is-file-drag", on);
    stage?.classList.toggle("is-file-drag", on);
  }

  function bindFileDrop() {
    const targets = [zoomWrap, stage].filter(Boolean);
    if (!targets.length) return;
    const onEnter = (e) => {
      if (!hasFileDrop(e.dataTransfer)) return;
      e.preventDefault();
      fileDragDepth += 1;
      setFileDrag(true);
    };
    const onLeave = (e) => {
      if (!hasFileDrop(e.dataTransfer)) return;
      fileDragDepth = Math.max(0, fileDragDepth - 1);
      if (fileDragDepth === 0) setFileDrag(false);
    };
    const onOver = (e) => {
      if (!hasFileDrop(e.dataTransfer)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      setFileDrag(true);
    };
    const onDrop = (e) => {
      if (!hasFileDrop(e.dataTransfer)) return;
      e.preventDefault();
      fileDragDepth = 0;
      setFileDrag(false);
      const file = pickVideoFromDataTransfer(e.dataTransfer);
      if (!file) {
        toast("请拖入视频文件");
        return;
      }
      loadFile(file, { autoplay: true }).catch((err) => setError(err.message || String(err)));
    };
    targets.forEach((el) => {
      el.addEventListener("dragenter", onEnter);
      el.addEventListener("dragleave", onLeave);
      el.addEventListener("dragover", onOver);
      el.addEventListener("drop", onDrop);
    });
  }

  function bindZoom() {
    if (!zoomWrap || zoomWrap.dataset.bound === "1") return;
    zoomWrap.dataset.bound = "1";
    zoomWrap.addEventListener("click", (e) => {
      if (sourceFile || e.target.closest?.(".vplay-zoom-hud, .vplay-height-resize")) return;
      fileInput?.click();
    });
    zoomWrap.addEventListener(
      "wheel",
      (e) => {
        if (!sourceFile) return;
        e.preventDefault();
        bumpZoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
      },
      { passive: false }
    );
    zoomWrap.addEventListener("pointerdown", (e) => {
      if (!sourceFile) return;
      if (e.target.closest?.(".vplay-zoom-hud, .vplay-height-resize")) return;
      try {
        zoomWrap.setPointerCapture?.(e.pointerId);
      } catch (_) {}
      zoom.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (zoom.pointers.size === 1) {
        zoom.dragging = true;
        zoom.lastX = e.clientX;
        zoom.lastY = e.clientY;
        zoomWrap.classList.add("is-panning");
      } else if (zoom.pointers.size === 2) {
        const pts = [...zoom.pointers.values()];
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        zoom.pinchStartDist = Math.hypot(dx, dy) || 1;
        zoom.pinchStartScale = zoom.scale;
        zoom.dragging = false;
      }
    });
    zoomWrap.addEventListener("pointermove", (e) => {
      if (!sourceFile || !zoom.pointers.has(e.pointerId)) return;
      zoom.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (zoom.pointers.size >= 2) {
        const pts = [...zoom.pointers.values()];
        const dx = pts[0].x - pts[1].x;
        const dy = pts[0].y - pts[1].y;
        const dist = Math.hypot(dx, dy) || 1;
        const midX = (pts[0].x + pts[1].x) / 2;
        const midY = (pts[0].y + pts[1].y) / 2;
        zoomAt(midX, midY, zoom.pinchStartScale * (dist / zoom.pinchStartDist));
        return;
      }
      if (!zoom.dragging) return;
      zoom.x += e.clientX - zoom.lastX;
      zoom.y += e.clientY - zoom.lastY;
      zoom.lastX = e.clientX;
      zoom.lastY = e.clientY;
      applyZoom();
    });
    const endPtr = (e) => {
      zoom.pointers.delete(e.pointerId);
      if (zoom.pointers.size === 0) {
        zoom.dragging = false;
        zoomWrap.classList.remove("is-panning");
      }
    };
    zoomWrap.addEventListener("pointerup", endPtr);
    zoomWrap.addEventListener("pointercancel", endPtr);
    zoomWrap.addEventListener("dblclick", (e) => {
      if (!sourceFile) return;
      if (e.target.closest?.(".vplay-zoom-hud, .vplay-height-resize")) return;
      togglePlay();
    });
  }

  function clearVplay() {
    sourceFile = null;
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = "";
    }
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    if (fileInput) fileInput.value = "";
    resetZoom();
    resetSeekReady();
    setError("");
    if (meta) meta.textContent = "支持 MP4 / WebM / MOV。点「选择视频」、拖入下方黑色区域，或点击黑色区域选择。滚轮缩放 · 拖拽移动 · 双击暂停/播放。";
    syncEmptyState();
    syncPlayUi();
    syncClock();
    syncScrubFromVideo();
    setControlsEnabled(false);
    syncInfoPanel();
  }

  async function loadFile(file, opts = {}) {
    if (!file) return;
    clearVplay();
    setError("");
    const type = String(file.type || "").toLowerCase();
    const name = String(file.name || "");
    if (type && !type.startsWith("video/") && !/\.(mp4|webm|mov|m4v|mkv|avi)$/i.test(name)) {
      setError("请选择视频文件");
      return;
    }
    sourceFile = file;
    objectUrl = URL.createObjectURL(file);
    if (meta) meta.textContent = `${name} · ${formatKb(file.size)} · 正在读取…`;
    if (video) {
      video.hidden = false;
      if (emptyHint) emptyHint.hidden = true;
      video.playsInline = true;
      video.preload = "auto";
      video.muted = muted;
      video.src = objectUrl;
      video.load();
    }
    try {
      await waitVideoMetadata(video);
      await primeVideoForSeek();
      const d = duration();
      if (!(d > 0) || !video.videoWidth) throw new Error("视频时长或尺寸无效");
      syncEmptyState();
      fitZoomAfterLayout();
      syncMuteUi();
      syncPlayUi();
      syncClock();
      syncScrubFromVideo();
      setControlsEnabled(true);
      if (meta) {
        meta.textContent = `${name} · ${formatKb(file.size)} · ${d.toFixed(1)}s · ${video.videoWidth}×${video.videoHeight}`;
      }
      syncInfoPanel();
      if (d >= LONG_VIDEO_SEC) toast("长视频：滚轮/拖拽定位，双击播放/暂停");
      else toast(opts.autoplay ? "已加载并开始播放" : "视频已加载");
      if (!opts.autoplay) applySeek(0, { fromScrub: true });
      if (opts.autoplay) {
        video.play().catch(() => toast("无法自动播放，请点播放"));
      }
    } catch (err) {
      clearVplay();
      setError(err.message || String(err));
    }
  }

  function toggleFullscreen() {
    if (!stage) return;
    if (document.fullscreenElement === stage) {
      document.exitFullscreen?.().catch(() => {});
      return;
    }
    stage.requestFullscreen?.().catch(() => toast("无法进入全屏"));
  }

  bindFileDrop();
  bindZoom();
  bindHeightControls();
  fileInput?.addEventListener("change", (e) => {
    loadFile(e.target.files?.[0]).catch((err) => setError(err.message || String(err)));
  });
  clearBtn?.addEventListener("click", clearVplay);
  window.DevToolsTemp?.registerCleanup(clearVplay);
  playBtn?.addEventListener("click", togglePlay);
  muteBtn?.addEventListener("click", () => {
    muted = !muted;
    syncMuteUi();
  });
  $("#vplay-zoom-in")?.addEventListener("click", () => bumpZoom(1.25));
  $("#vplay-zoom-out")?.addEventListener("click", () => bumpZoom(1 / 1.25));
  $("#vplay-zoom-reset")?.addEventListener("click", () => {
    zoom.rotate = 0;
    fitZoom();
  });
  $("#vplay-zoom-rotate")?.addEventListener("click", () => {
    zoom.rotate = (zoom.rotate + 90) % 360;
    fitZoom();
  });
  fsBtn?.addEventListener("click", toggleFullscreen);
  scrub?.addEventListener("pointerdown", () => {
    beginScrub();
    scrubToValue();
  });
  scrub?.addEventListener("input", () => {
    if (!video?.src) return;
    beginScrub();
    scrubToValue();
  });
  scrub?.addEventListener("change", () => {
    scrubbing = false;
    syncScrubFromVideo();
  });
  video?.addEventListener("timeupdate", () => {
    if (scrubbing) return;
    syncClock();
    syncScrubFromVideo();
  });
  video?.addEventListener("play", syncPlayUi);
  video?.addEventListener("pause", syncPlayUi);
  video?.addEventListener("loadedmetadata", () => fitZoomAfterLayout());
  window.addEventListener("resize", () => {
    if (!sourceFile || !video?.videoWidth) return;
    const rel = zoom.fit > 0 ? zoom.scale / zoom.fit : 1;
    fitZoom();
    zoom.scale = zoom.fit * rel;
    applyZoom();
  });
  window.addEventListener("devtools:route", () => {
    if (!sourceFile || !video?.videoWidth) return;
    const panel = document.getElementById("vplay");
    if (panel?.classList.contains("is-workspace-active") && !panel.hidden) {
      fitZoomAfterLayout();
    }
  });
  document.addEventListener("fullscreenchange", () => {
    if (!sourceFile) return;
    window.setTimeout(() => fitZoomAfterLayout(), 80);
  });
  syncMuteUi();
  syncEmptyState();
  setControlsEnabled(false);
})();
