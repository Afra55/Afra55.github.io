(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const SCRUB_STEPS = 1000;
  const SEEK_DEBOUNCE_MS = 100;
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

  let sourceFile = null;
  let objectUrl = "";
  let scrubbing = false;
  let seekTimer = 0;
  let pendingSeek = null;
  let muted = true;

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

  function syncEmptyState() {
    const has = Boolean(sourceFile && video?.src);
    if (emptyHint) emptyHint.hidden = has;
    if (video) video.hidden = !has;
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
  }

  function syncPlayUi() {
    if (!playBtn || !video) return;
    playBtn.textContent = video.paused ? "播放" : "暂停";
  }

  function setControlsEnabled(on) {
    [playBtn, muteBtn, fsBtn, $("#vplay-zoom-in"), $("#vplay-zoom-out"), $("#vplay-zoom-reset"), $("#vplay-zoom-rotate")].forEach((btn) => {
      if (btn) btn.disabled = !on;
    });
  }

  function syncClock() {
    if (!clock) return;
    clock.textContent = `${formatClock(currentTime())} / ${formatClock(duration())}`;
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
    if (!opts.keepPlaying && !video.paused) video.pause();
    try {
      if (typeof video.fastSeek === "function") video.fastSeek(t);
      else video.currentTime = t;
    } catch (_) {}
    if (!opts.fromScrub) syncScrubFromVideo();
    syncClock();
    syncPlayUi();
  }

  function scheduleSeek(sec, opts = {}) {
    pendingSeek = { sec, opts };
    clearTimeout(seekTimer);
    seekTimer = window.setTimeout(() => {
      seekTimer = 0;
      if (pendingSeek) {
        applySeek(pendingSeek.sec, pendingSeek.opts);
        pendingSeek = null;
      }
    }, SEEK_DEBOUNCE_MS);
  }

  function flushSeek() {
    clearTimeout(seekTimer);
    seekTimer = 0;
    if (pendingSeek) {
      applySeek(pendingSeek.sec, pendingSeek.opts);
      pendingSeek = null;
    }
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

  function bindZoom() {
    if (!zoomWrap || zoomWrap.dataset.bound === "1") return;
    zoomWrap.dataset.bound = "1";
    zoomWrap.addEventListener("click", (e) => {
      if (sourceFile || e.target.closest?.(".vplay-zoom-hud")) return;
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
      if (e.target.closest?.(".vplay-zoom-hud")) return;
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
      if (e.target.closest?.(".vplay-zoom-hud")) return;
      togglePlay();
    });
  }

  function clearVplay() {
    sourceFile = null;
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl);
      objectUrl = "";
    }
    flushSeek();
    if (video) {
      video.pause();
      video.removeAttribute("src");
      video.load();
    }
    if (fileInput) fileInput.value = "";
    resetZoom();
    setError("");
    if (meta) meta.textContent = "支持 MP4 / WebM / MOV。点「选择视频」或点击下方黑色区域。滚轮缩放 · 拖拽移动 · 双击暂停/播放。";
    syncEmptyState();
    syncPlayUi();
    syncClock();
    syncScrubFromVideo();
    setControlsEnabled(false);
  }

  async function loadFile(file) {
    if (!file) return;
    clearVplay();
    setError("");
    const type = String(file.type || "");
    const name = String(file.name || "");
    if (type && !type.startsWith("video/") && !/\.(mp4|webm|mov|m4v)$/i.test(name)) {
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
      video.preload = "metadata";
      video.muted = muted;
      video.src = objectUrl;
      video.load();
    }
    try {
      await waitVideoMetadata(video);
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
      if (d >= LONG_VIDEO_SEC) toast("长视频：滚轮/拖拽定位，双击播放/暂停");
      else toast("视频已加载");
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

  bindZoom();
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
  scrub?.addEventListener("input", () => {
    if (!video?.src) return;
    scrubbing = true;
    const t = (Number(scrub.value) / SCRUB_STEPS) * duration();
    syncClock();
    scheduleSeek(t, { fromScrub: true, keepPlaying: !video.paused });
  });
  scrub?.addEventListener("change", () => {
    scrubbing = false;
    flushSeek();
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
