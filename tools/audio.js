(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const MIN_SPAN = 0.2;
  const HISTORY_MAX = 30;

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

  const fileInput = $("#audio-file");
  const clearBtn = $("#audio-clear");
  const undoBtn = $("#audio-undo");
  const resetBtn = $("#audio-reset");
  const meta = $("#audio-meta");
  const stage = $("#audio-stage");
  const audioEl = $("#audio-el");
  const playBtn = $("#audio-play");
  const clockEl = $("#audio-clock");
  const rangeLabel = $("#audio-range-label");
  const wave = $("#audio-wave");
  const timeline = $("#audio-timeline");
  const selEl = $("#audio-sel");
  const handleStart = $("#audio-handle-start");
  const handleEnd = $("#audio-handle-end");
  const playhead = $("#audio-playhead");
  const windowEl = $("#audio-window");
  const nudgeSM = $("#audio-nudge-sm");
  const nudgeSP = $("#audio-nudge-sp");
  const nudgeEM = $("#audio-nudge-em");
  const nudgeEP = $("#audio-nudge-ep");
  const gainRange = $("#audio-gain");
  const gainVal = $("#audio-gain-val");
  const gainReset = $("#audio-gain-reset");
  const exportBar = $("#audio-export-bar");
  const summaryEl = $("#audio-summary");
  const exportBtn = $("#audio-export");
  const abortBtn = $("#audio-abort");
  const downloadA = $("#audio-download");
  const progress = $("#audio-progress");
  const progressFill = $("#audio-progress-fill");
  const progressText = $("#audio-progress-text");
  const progressPct = $("#audio-progress-pct");
  const resultAudio = $("#audio-result");
  const errorEl = $("#audio-error");

  if (!fileInput || !audioEl) return;

  let sourceFile = null;
  let objectUrl = "";
  let duration = 0;
  let startSec = 0;
  let endSec = 0;
  let gainPct = 100;
  let exportFmt = "m4a";
  let busy = false;
  let abortFlag = false;
  let resultUrl = "";
  let drag = null;
  let activeHandle = "start";
  let history = [];
  let applyingHistory = false;
  let peaks = null;
  let audioCtx = null;
  let mediaSource = null;
  let gainNode = null;
  let graphReady = false;
  let playheadRaf = 0;

  const DEFAULT_META = "支持常见音频与视频（将抽取音轨）。选择后仅本机读取。";

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
  }

  function revokeResult() {
    if (resultUrl) {
      try {
        URL.revokeObjectURL(resultUrl);
      } catch (_) {}
      resultUrl = "";
    }
    if (resultAudio) {
      resultAudio.removeAttribute("src");
      resultAudio.hidden = true;
      try {
        resultAudio.load();
      } catch (_) {}
    }
    if (downloadA) {
      downloadA.hidden = true;
      downloadA.removeAttribute("href");
    }
  }

  function ensureAudioGraph() {
    if (graphReady || !audioEl) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
      mediaSource = audioCtx.createMediaElementSource(audioEl);
      gainNode = audioCtx.createGain();
      gainNode.gain.value = gainPct / 100;
      mediaSource.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      graphReady = true;
    } catch (_) {
      graphReady = false;
    }
  }

  function applyGainLive() {
    if (gainNode) {
      try {
        gainNode.gain.value = Math.max(0.01, gainPct / 100);
      } catch (_) {}
    }
    if (audioEl && !graphReady) {
      // fallback: element volume capped at 1
      audioEl.volume = Math.min(1, Math.max(0.05, gainPct / 100));
    }
    if (gainVal) gainVal.textContent = `${Math.round(gainPct)}%`;
    if (gainRange && Number(gainRange.value) !== gainPct) gainRange.value = String(gainPct);
  }

  function snapshotState() {
    return { startSec, endSec, gainPct };
  }

  function pushHistory() {
    if (applyingHistory || !sourceFile) return;
    const snap = snapshotState();
    const last = history[history.length - 1];
    if (
      last &&
      Math.abs(last.startSec - snap.startSec) < 0.001 &&
      Math.abs(last.endSec - snap.endSec) < 0.001 &&
      last.gainPct === snap.gainPct
    ) {
      return;
    }
    history.push(snap);
    if (history.length > HISTORY_MAX) history.shift();
    setButtons();
  }

  function applySnapshot(snap) {
    if (!snap) return;
    applyingHistory = true;
    startSec = snap.startSec;
    endSec = snap.endSec;
    gainPct = snap.gainPct;
    applyGainLive();
    paintTimeline();
    paintWave();
    updateLabels();
    applyingHistory = false;
    setButtons();
  }

  function undoEdit() {
    if (history.length < 2) return;
    history.pop();
    applySnapshot(history[history.length - 1]);
    toast("已撤销");
  }

  function resetEdit() {
    if (!duration) return;
    pushHistory();
    startSec = 0;
    endSec = duration;
    gainPct = 100;
    applyGainLive();
    seekTo(0, { force: true });
    paintTimeline();
    paintWave();
    updateLabels();
    pushHistory();
    toast("已重置");
  }

  function clearAll() {
    abortFlag = true;
    busy = false;
    try {
      audioEl.pause();
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
    gainPct = 100;
    peaks = null;
    history = [];
    revokeResult();
    audioEl.removeAttribute("src");
    try {
      audioEl.load();
    } catch (_) {}
    if (stage) stage.hidden = true;
    if (exportBar) exportBar.hidden = true;
    if (meta) meta.textContent = DEFAULT_META;
    setProgress(false, 0, "");
    setError(errorEl, "");
    applyGainLive();
    paintTimeline();
    paintWave();
    updateLabels();
    setButtons();
  }

  function setButtons() {
    const has = Boolean(sourceFile && duration > 0);
    if (playBtn) playBtn.disabled = !has || busy;
    if (exportBtn) exportBtn.disabled = !has || busy;
    if (undoBtn) undoBtn.disabled = !has || busy || history.length < 2;
    if (resetBtn) resetBtn.disabled = !has || busy;
    if (gainRange) gainRange.disabled = !has || busy;
    if (gainReset) gainReset.disabled = !has || busy;
    [nudgeSM, nudgeSP, nudgeEM, nudgeEP].forEach((b) => {
      if (b) b.disabled = !has || busy;
    });
    if (exportBar) exportBar.hidden = !has;
    if (playBtn) playBtn.textContent = audioEl && !audioEl.paused ? "暂停" : "播放";
  }

  function updateLabels() {
    const now = audioEl.currentTime || startSec;
    if (clockEl) clockEl.textContent = `${formatClock(now)} / ${formatClock(duration)}`;
    const span = Math.max(0, endSec - startSec);
    if (rangeLabel) {
      rangeLabel.textContent = `保留 ${formatClock(span)}（${formatClock(startSec)}–${formatClock(endSec)}）`;
    }
    updateSummary();
  }

  function updateSummary() {
    if (!summaryEl) return;
    if (!sourceFile || !duration) {
      summaryEl.textContent = "—";
      return;
    }
    const span = endSec - startSec;
    const fmtLabel = exportFmt === "wav" ? "WAV" : exportFmt === "mp3" ? "MP3" : "M4A";
    summaryEl.textContent = `将导出 ${formatClock(span)} · 音量 ${Math.round(gainPct)}% · ${fmtLabel}`;
  }

  function paintTimeline() {
    if (!selEl || !duration) {
      if (selEl) {
        selEl.style.setProperty("--audio-start", "0%");
        selEl.style.setProperty("--audio-end", "100%");
        selEl.style.setProperty("--audio-play", "0%");
      }
      return;
    }
    const sPct = (startSec / duration) * 100;
    const ePct = (endSec / duration) * 100;
    const pPct = ((audioEl.currentTime || 0) / duration) * 100;
    selEl.style.setProperty("--audio-start", `${sPct}%`);
    selEl.style.setProperty("--audio-end", `${ePct}%`);
    selEl.style.setProperty("--audio-play", `${clamp(pPct, 0, 100)}%`);
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

  function paintWave() {
    if (!wave) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = wave.clientWidth || timeline?.clientWidth || 640;
    const cssH = 72;
    wave.width = Math.round(cssW * dpr);
    wave.height = Math.round(cssH * dpr);
    wave.style.width = "100%";
    wave.style.height = `${cssH}px`;
    const ctx = wave.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = window.DevToolsTheme?.stageBg?.() || "#0a101c";
    ctx.fillRect(0, 0, cssW, cssH);
    const mid = cssH / 2;
    const data = peaks && peaks.length ? peaks : null;
    const n = data ? data.length : Math.max(64, Math.floor(cssW / 3));
    const barW = cssW / n;
    for (let i = 0; i < n; i++) {
      const t = i / Math.max(1, n - 1);
      const amp = data ? data[i] : 0.12 + 0.08 * Math.sin(i * 0.35) * Math.sin(i * 0.07);
      const h = Math.max(2, amp * (cssH * 0.78));
      const inRange = duration ? t * duration >= startSec && t * duration <= endSec : true;
      ctx.fillStyle = inRange ? "rgba(120, 190, 255, 0.78)" : "rgba(90, 110, 140, 0.35)";
      ctx.fillRect(i * barW + 0.5, mid - h / 2, Math.max(1, barW - 1), h);
    }
    // dim outside trim
    if (duration) {
      const sX = (startSec / duration) * cssW;
      const eX = (endSec / duration) * cssW;
      ctx.fillStyle = "rgba(6, 10, 18, 0.45)";
      ctx.fillRect(0, 0, sX, cssH);
      ctx.fillRect(eX, 0, cssW - eX, cssH);
    }
  }

  async function buildPeaks(file) {
    peaks = null;
    try {
      const buf = await file.arrayBuffer();
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const tmp = new AC();
      const decoded = await tmp.decodeAudioData(buf.slice(0));
      const ch = decoded.getChannelData(0);
      const bins = 180;
      const block = Math.max(1, Math.floor(ch.length / bins));
      const out = new Array(bins);
      for (let i = 0; i < bins; i++) {
        let peak = 0;
        const base = i * block;
        for (let j = 0; j < block; j++) {
          const v = Math.abs(ch[base + j] || 0);
          if (v > peak) peak = v;
        }
        out[i] = Math.min(1, peak * 1.35);
      }
      peaks = out;
      try {
        await tmp.close();
      } catch (_) {}
    } catch (_) {
      peaks = null;
    }
    paintWave();
  }

  function seekTo(t, { force = false } = {}) {
    const next = force
      ? clamp(t, 0, Math.max(0, duration - 0.04))
      : clamp(t, startSec, Math.max(startSec, endSec - 0.04));
    try {
      audioEl.currentTime = next;
    } catch (_) {}
    paintTimeline();
    updateLabels();
  }

  function setStart(t, { preview = true, record = false } = {}) {
    startSec = clamp(t, 0, endSec - MIN_SPAN);
    activeHandle = "start";
    if (preview) seekTo(startSec, { force: true });
    else if (audioEl.currentTime < startSec) seekTo(startSec);
    paintTimeline();
    paintWave();
    updateLabels();
    if (record) pushHistory();
  }

  function setEnd(t, { preview = true, record = false } = {}) {
    endSec = clamp(t, startSec + MIN_SPAN, duration);
    activeHandle = "end";
    if (preview) seekTo(Math.max(startSec, endSec - 0.04), { force: true });
    else if (audioEl.currentTime > endSec) seekTo(endSec - 0.04);
    paintTimeline();
    paintWave();
    updateLabels();
    if (record) pushHistory();
  }

  async function togglePlay() {
    if (!sourceFile) return;
    ensureAudioGraph();
    if (audioCtx?.state === "suspended") {
      try {
        await audioCtx.resume();
      } catch (_) {}
    }
    if (!audioEl.paused) {
      audioEl.pause();
      setButtons();
      return;
    }
    if (audioEl.currentTime < startSec || audioEl.currentTime >= endSec - 0.02) {
      seekTo(startSec, { force: true });
    }
    try {
      await audioEl.play();
    } catch (err) {
      toast(err?.message || "无法播放");
    }
    setButtons();
    tickPlayhead();
  }

  function tickPlayhead() {
    cancelAnimationFrame(playheadRaf);
    const loop = () => {
      if (!sourceFile) return;
      if (!audioEl.paused) {
        if (audioEl.currentTime >= endSec - 0.02) {
          seekTo(startSec, { force: true });
          audioEl.play().catch(() => {});
        }
        paintTimeline();
        updateLabels();
        playheadRaf = requestAnimationFrame(loop);
      } else {
        paintTimeline();
        setButtons();
      }
    };
    playheadRaf = requestAnimationFrame(loop);
  }

  async function exportAudio() {
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
        setProgress(true, 0.25 + r * 0.15, t || "写入文件…", { busy: true })
      );
      const vol = Math.max(0.01, gainPct / 100);
      const needVol = Math.abs(vol - 1) > 0.01;
      const ss = String(Math.max(0, startSec));
      const tt = String(Math.max(MIN_SPAN, span));
      const isWav = exportFmt === "wav";
      const isMp3 = exportFmt === "mp3";
      const ext = isWav ? "wav" : isMp3 ? "mp3" : "m4a";
      const outName = `audio-out-${Date.now()}.${ext}`;
      const attempts = [];

      if (isWav) {
        const args = ["-ss", ss, "-t", tt, "-i", inName, "-vn"];
        if (needVol) args.push("-af", `volume=${vol}`);
        args.push("-c:a", "pcm_s16le", "-ar", "44100", "-ac", "2", "-y", outName);
        attempts.push({ label: "导出 WAV", args });
      } else if (isMp3) {
        if (!needVol) {
          attempts.push({
            label: "快速抽取 MP3",
            args: ["-ss", ss, "-t", tt, "-i", inName, "-vn", "-c:a", "copy", "-f", "mp3", "-y", outName],
          });
        }
        const enc = ["-ss", ss, "-t", tt, "-i", inName, "-vn"];
        if (needVol) enc.push("-af", `volume=${vol}`);
        enc.push("-c:a", "libmp3lame", "-b:a", "192k", "-y", outName);
        attempts.push({ label: needVol ? "MP3 音量重编码" : "MP3 重编码", args: enc });
      } else {
        if (!needVol) {
          attempts.push({
            label: "快速抽取",
            args: ["-ss", ss, "-t", tt, "-i", inName, "-vn", "-c:a", "copy", "-y", outName],
          });
        }
        const enc = ["-ss", ss, "-t", tt, "-i", inName, "-vn"];
        if (needVol) enc.push("-af", `volume=${vol}`);
        enc.push("-c:a", "aac", "-b:a", "192k", "-y", outName);
        attempts.push({ label: needVol ? "音量重编码" : "AAC 重编码", args: enc });
      }

      let outBlob = null;
      const mime = isWav ? "audio/wav" : isMp3 ? "audio/mpeg" : "audio/mp4";
      for (const attempt of attempts) {
        if (abortFlag) throw new Error("已取消");
        setProgress(true, 0.5, `${attempt.label}…`, { busy: true });
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
            outBlob = new Blob([bytes], { type: mime });
            break;
          }
        } catch (err) {
          if (String(err?.message) === "已取消") throw err;
        }
      }
      try {
        await ffmpeg.deleteFile(outName);
      } catch (_) {}
      if (!outBlob) throw new Error("导出失败，可换格式或缩短时长后重试");

      resultUrl = URL.createObjectURL(outBlob);
      if (resultAudio) {
        resultAudio.src = resultUrl;
        resultAudio.hidden = false;
      }
      const name = `audio-${Date.now()}.${ext}`;
      if (downloadA) {
        downloadA.href = resultUrl;
        downloadA.download = name;
        downloadA.hidden = false;
      }
      const a = document.createElement("a");
      a.href = resultUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setProgress(true, 1, "导出完成");
      const mb = (outBlob.size / (1024 * 1024)).toFixed(2);
      toast(`已导出 · ${formatClock(span)} · ${Math.round(gainPct)}% · 约 ${mb} MB`);
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
    audioEl.src = objectUrl;
    setError(errorEl, "");
    try {
      await new Promise((resolve, reject) => {
        const onMeta = () => {
          cleanup();
          resolve();
        };
        const onErr = () => {
          cleanup();
          reject(new Error("无法读取音频"));
        };
        const cleanup = () => {
          audioEl.removeEventListener("loadedmetadata", onMeta);
          audioEl.removeEventListener("error", onErr);
        };
        audioEl.addEventListener("loadedmetadata", onMeta);
        audioEl.addEventListener("error", onErr);
        if (audioEl.readyState >= 1 && Number.isFinite(audioEl.duration) && audioEl.duration > 0) {
          cleanup();
          resolve();
        }
      });
      duration = Number(audioEl.duration) || 0;
      if (!(duration > 0) || !Number.isFinite(duration)) throw new Error("无法获取音频时长");
      startSec = 0;
      endSec = duration;
      gainPct = 100;
      applyGainLive();
      if (stage) stage.hidden = false;
      if (meta) {
        const kind = String(file.type || "").startsWith("video/") ? "视频音轨" : "音频";
        meta.textContent = `本地文件，不上传 · ${file.name || "audio"} · ${kind} · ${formatClock(duration)}`;
      }
      history = [];
      paintTimeline();
      paintWave();
      updateLabels();
      pushHistory();
      setButtons();
      toast("已选择，仅本机处理，不会上传");
      engine()?.prewarm?.().catch(() => {});
      buildPeaks(file).catch(() => {});
      seekTo(0, { force: true });
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
  undoBtn?.addEventListener("click", () => undoEdit());
  resetBtn?.addEventListener("click", () => resetEdit());
  playBtn?.addEventListener("click", () => togglePlay().catch(() => {}));
  gainRange?.addEventListener("input", () => {
    gainPct = clamp(Number(gainRange.value) || 100, 10, 300);
    applyGainLive();
    updateSummary();
  });
  gainRange?.addEventListener("change", () => pushHistory());
  gainReset?.addEventListener("click", () => {
    pushHistory();
    gainPct = 100;
    applyGainLive();
    updateSummary();
    pushHistory();
  });
  document.querySelectorAll("[data-audio-fmt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const f = btn.dataset.audioFmt;
      exportFmt = f === "wav" || f === "mp3" ? f : "m4a";
      document.querySelectorAll("[data-audio-fmt]").forEach((b) => {
        b.classList.toggle("is-active", b.dataset.audioFmt === exportFmt);
      });
      updateSummary();
    });
  });
  nudgeSM?.addEventListener("click", () => {
    pushHistory();
    setStart(startSec - 0.1, { preview: true });
    pushHistory();
  });
  nudgeSP?.addEventListener("click", () => {
    pushHistory();
    setStart(startSec + 0.1, { preview: true });
    pushHistory();
  });
  nudgeEM?.addEventListener("click", () => {
    pushHistory();
    setEnd(endSec - 0.1, { preview: true });
    pushHistory();
  });
  nudgeEP?.addEventListener("click", () => {
    pushHistory();
    setEnd(endSec + 0.1, { preview: true });
    pushHistory();
  });
  exportBtn?.addEventListener("click", () => exportAudio().catch((err) => setError(errorEl, err.message || String(err))));
  abortBtn?.addEventListener("click", () => {
    abortFlag = true;
    try {
      engine()?.terminate?.();
    } catch (_) {}
  });

  audioEl.addEventListener("timeupdate", () => {
    if (audioEl.paused) {
      paintTimeline();
      updateLabels();
    }
    if (!audioEl.paused && audioEl.currentTime >= endSec - 0.02) {
      seekTo(startSec, { force: true });
    }
  });
  audioEl.addEventListener("play", () => {
    setButtons();
    tickPlayhead();
  });
  audioEl.addEventListener("pause", () => setButtons());
  audioEl.addEventListener("ended", () => {
    seekTo(startSec, { force: true });
    setButtons();
  });

  function ptrRatio(e) {
    const rect = timeline.getBoundingClientRect();
    if (!rect.width) return 0;
    return clamp((e.clientX - rect.left) / rect.width, 0, 1);
  }

  function beginDrag(kind, e) {
    if (!duration || busy) return;
    e.preventDefault();
    drag = { kind, pointerId: e.pointerId, winStart: startSec, winSpan: endSec - startSec };
    try {
      timeline.setPointerCapture(e.pointerId);
    } catch (_) {}
    timeline.classList.add("is-dragging");
    if (kind === "window") timeline.classList.add("is-dragging-window");
  }

  handleStart?.addEventListener("pointerdown", (e) => beginDrag("start", e));
  handleEnd?.addEventListener("pointerdown", (e) => beginDrag("end", e));
  windowEl?.addEventListener("pointerdown", (e) => beginDrag("window", e));
  timeline?.addEventListener("pointerdown", (e) => {
    if (e.target === handleStart || e.target === handleEnd || e.target === windowEl) return;
    if (!duration || busy) return;
    const t = ptrRatio(e) * duration;
    if (Math.abs(t - startSec) < Math.abs(t - endSec)) setStart(t, { preview: true, record: true });
    else setEnd(t, { preview: true, record: true });
  });
  timeline?.addEventListener("pointermove", (e) => {
    if (!drag || drag.pointerId !== e.pointerId) return;
    const t = ptrRatio(e) * duration;
    if (drag.kind === "start") setStart(t, { preview: true });
    else if (drag.kind === "end") setEnd(t, { preview: true });
    else if (drag.kind === "window") {
      const span = drag.winSpan;
      let ns = clamp(t - span / 2, 0, duration - span);
      startSec = ns;
      endSec = ns + span;
      seekTo(startSec + span * ((t - ns) / span || 0.5));
      paintTimeline();
      paintWave();
      updateLabels();
    }
  });
  function endDrag(e) {
    if (!drag || (e && drag.pointerId !== e.pointerId)) return;
    const kind = drag.kind;
    drag = null;
    timeline?.classList.remove("is-dragging", "is-dragging-window");
    if (kind) pushHistory();
  }
  timeline?.addEventListener("pointerup", endDrag);
  timeline?.addEventListener("pointercancel", endDrag);

  [handleStart, handleEnd].forEach((h) => {
    h?.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 1 : 0.1;
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        pushHistory();
        if (h === handleStart) setStart(startSec + dir * step, { preview: true });
        else setEnd(endSec + dir * step, { preview: true });
        pushHistory();
      }
    });
  });

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      paintWave();
      paintTimeline();
    }, 120);
  });

  window.DevToolsTemp?.registerCleanup?.(clearAll);

  window.DevToolsAudio = {
    getRange: () => ({ start: startSec, end: endSec, duration, gain: gainPct }),
    setRange: (start, end) => {
      if (!duration) return false;
      const s = clamp(Number(start) || 0, 0, duration - MIN_SPAN);
      const e = clamp(Number(end) || duration, s + MIN_SPAN, duration);
      startSec = s;
      endSec = e;
      seekTo(s, { force: true });
      paintTimeline();
      paintWave();
      updateLabels();
      pushHistory();
      return true;
    },
    setGain: (pct) => {
      gainPct = clamp(Number(pct) || 100, 10, 300);
      applyGainLive();
      updateSummary();
    },
    undo: undoEdit,
    clear: clearAll,
  };

  applyGainLive();
  setButtons();
  document.querySelectorAll("[data-audio-fmt]").forEach((b) => {
    b.classList.toggle("is-active", b.dataset.audioFmt === exportFmt);
  });
})();
