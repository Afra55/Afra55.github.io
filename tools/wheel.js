(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  const STORAGE_KEY = "devtools-wheel-v1";
  const WEIGHT_TOTAL = 100;
  const MIN_SEGMENTS = 2;
  const MAX_SEGMENTS = 36;
  const MIN_WEIGHT = 1;
  const MAX_LABEL_LEN = 120;

  const WHEEL_COLORS = [
    "#6366f1",
    "#8b5cf6",
    "#ec4899",
    "#f43f5e",
    "#f97316",
    "#eab308",
    "#22c55e",
    "#14b8a6",
    "#06b6d4",
    "#3b82f6",
    "#a855f7",
    "#d946ef",
  ];

  let root = null;
  let canvas = null;
  let ctx = null;
  let spinBtn = null;
  let resultEl = null;
  let countInput = null;
  let durationInput = null;
  let soundToggle = null;
  let segmentsList = null;
  let spinning = false;
  let rotation = 0;
  let segments = [];
  let soundOn = true;
  let audioCtx = null;
  let inited = false;
  let editorsReady = false;
  let panelFill = "";
  let resizeObserver = null;

  function defaultLabel(i) {
    return `选项 ${i + 1}`;
  }

  function defaultSegments(n) {
    const w = WEIGHT_TOTAL / n;
    return Array.from({ length: n }, (_, i) => ({
      label: defaultLabel(i),
      weight: w,
    }));
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!Array.isArray(data.segments) || data.segments.length < MIN_SEGMENTS) return null;
      return data;
    } catch (_) {
      return null;
    }
  }

  function saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          count: segments.length,
          duration: Number(durationInput?.value) || 5,
          sound: soundOn,
          segments: segments.map((s) => ({ label: s.label, weight: s.weight })),
        })
      );
    } catch (_) {}
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function roundWeight(n) {
    return Math.round(n * 100) / 100;
  }

  function setSegmentWeight(index, newVal) {
    const n = segments.length;
    if (n <= 1) return;
    const maxAllowed = WEIGHT_TOTAL - MIN_WEIGHT * (n - 1);
    newVal = roundWeight(clamp(newVal, MIN_WEIGHT, maxAllowed));
    const oldOthers = segments.reduce((s, seg, i) => (i === index ? s : s + seg.weight), 0);
    const targetOthers = WEIGHT_TOTAL - newVal;
    segments[index].weight = newVal;
    if (oldOthers <= 0) {
      const each = targetOthers / (n - 1);
      segments.forEach((seg, i) => {
        if (i !== index) seg.weight = roundWeight(each);
      });
    } else {
      const scale = targetOthers / oldOthers;
      segments.forEach((seg, i) => {
        if (i !== index) seg.weight = roundWeight(Math.max(MIN_WEIGHT, seg.weight * scale));
      });
    }
    normalizeWeights(index);
  }

  function normalizeWeights(pinnedIndex = -1) {
    const sum = segments.reduce((s, seg) => s + seg.weight, 0);
    if (Math.abs(sum - WEIGHT_TOTAL) < 0.05) return;
    const adjustable = segments.filter((_, i) => i !== pinnedIndex);
    const adjSum = adjustable.reduce((s, seg) => s + seg.weight, 0);
    const pinned = pinnedIndex >= 0 ? segments[pinnedIndex].weight : 0;
    const target = WEIGHT_TOTAL - pinned;
    if (adjSum <= 0 || !adjustable.length) {
      const each = target / (segments.length - (pinnedIndex >= 0 ? 1 : 0));
      segments.forEach((seg, i) => {
        if (i !== pinnedIndex) seg.weight = roundWeight(each);
      });
      return;
    }
    const scale = target / adjSum;
    segments.forEach((seg, i) => {
      if (i !== pinnedIndex) seg.weight = roundWeight(Math.max(MIN_WEIGHT, seg.weight * scale));
    });
    const fix = WEIGHT_TOTAL - segments.reduce((s, seg) => s + seg.weight, 0);
    if (Math.abs(fix) > 0.01) {
      const last = segments.findIndex((_, i) => i !== pinnedIndex);
      if (last >= 0) segments[last].weight = roundWeight(segments[last].weight + fix);
    }
  }

  function setSegmentCount(n) {
    n = clamp(Math.round(n), MIN_SEGMENTS, MAX_SEGMENTS);
    const old = segments.slice();
    segments = defaultSegments(n);
    for (let i = 0; i < n; i++) {
      if (old[i]) {
        segments[i].label = old[i].label;
        if (old.length === n) segments[i].weight = old[i].weight;
      }
    }
    normalizeWeights();
    if (countInput) countInput.value = String(n);
    renderSegmentEditors();
    drawWheel();
    saveState();
  }

  function escapeAttr(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function trimLabel(text) {
    return String(text || "").slice(0, MAX_LABEL_LEN);
  }

  function autosizeWheelTextarea(el) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(36, el.scrollHeight)}px`;
  }

  function bindSegmentEditorEvents() {
    if (!segmentsList || segmentsList.dataset.bound === "1") return;
    segmentsList.dataset.bound = "1";

    segmentsList.addEventListener("input", (ev) => {
      const input = ev.target;
      if (!(input instanceof HTMLTextAreaElement) || !input.classList.contains("wheel-seg-text")) return;
      autosizeWheelTextarea(input);
      const idx = Number(input.closest(".wheel-seg-row")?.dataset.idx);
      if (!Number.isFinite(idx)) return;
      segments[idx].label = trimLabel(input.value);
      drawWheel();
      saveState();
    });

    segmentsList.addEventListener("input", (ev) => {
      const input = ev.target;
      if (!(input instanceof HTMLInputElement) || !input.classList.contains("wheel-seg-range")) return;
      const idx = Number(input.closest(".wheel-seg-row")?.dataset.idx);
      if (!Number.isFinite(idx)) return;
      setSegmentWeight(idx, Number(input.value));
      syncSegmentRow(idx);
      drawWheel();
      saveState();
    });

    segmentsList.addEventListener("change", (ev) => {
      const input = ev.target;
      if (!(input instanceof HTMLInputElement) || !input.classList.contains("wheel-seg-num")) return;
      const idx = Number(input.closest(".wheel-seg-row")?.dataset.idx);
      if (!Number.isFinite(idx)) return;
      setSegmentWeight(idx, Number(input.value));
      renderSegmentEditors();
      drawWheel();
      saveState();
    });
  }

  function renderSegmentEditors() {
    if (!segmentsList) return;
    segmentsList.innerHTML = segments
      .map((seg, i) => {
        const pct = roundWeight(seg.weight);
        const maxW = WEIGHT_TOTAL - MIN_WEIGHT * (segments.length - 1);
        return `<div class="wheel-seg-row" data-idx="${i}">
          <span class="wheel-seg-swatch" style="background:${WHEEL_COLORS[i % WHEEL_COLORS.length]}"></span>
          <label class="wheel-seg-label-wrap">
            <span class="visually-hidden">第 ${i + 1} 块文字</span>
            <textarea rows="1" class="wheel-seg-text mono" data-field="label" maxlength="${MAX_LABEL_LEN}">${escapeHtml(seg.label)}</textarea>
          </label>
          <input type="range" class="wheel-seg-range" data-field="weight" min="${MIN_WEIGHT}" max="${maxW}" step="0.1" value="${pct}" />
          <input type="number" class="wheel-seg-num mono" data-field="weight-num" min="${MIN_WEIGHT}" max="${maxW}" step="0.1" value="${pct}" />
          <span class="wheel-seg-pct mono">${pct}%</span>
        </div>`;
      })
      .join("");

    segmentsList.querySelectorAll(".wheel-seg-text").forEach((input) => autosizeWheelTextarea(input));
    editorsReady = true;
  }

  function syncSegmentRow(index) {
    const row = segmentsList?.querySelector(`.wheel-seg-row[data-idx="${index}"]`);
    if (!row) {
      renderSegmentEditors();
      return;
    }
    const w = roundWeight(segments[index].weight);
    row.querySelector(".wheel-seg-range").value = String(w);
    row.querySelector(".wheel-seg-num").value = String(w);
    row.querySelector(".wheel-seg-pct").textContent = `${w}%`;
    segments.forEach((_, i) => {
      if (i === index) return;
      const r = segmentsList.querySelector(`.wheel-seg-row[data-idx="${i}"]`);
      if (!r) return;
      const wi = roundWeight(segments[i].weight);
      r.querySelector(".wheel-seg-range").value = String(wi);
      r.querySelector(".wheel-seg-num").value = String(wi);
      r.querySelector(".wheel-seg-pct").textContent = `${wi}%`;
    });
  }

  function wrapWheelLabel(ctx, text, maxWidth) {
    const raw = String(text || "").trim();
    if (!raw) return [""];
    const lines = [];
    let line = "";
    for (const ch of raw) {
      const next = line + ch;
      if (line && ctx.measureText(next).width > maxWidth) {
        lines.push(line);
        line = ch;
      } else {
        line = next;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function drawSegmentLabel(ctx, label, arc, radius) {
    const maxWidth = Math.max(28, arc.sweep * radius * 0.66);
    const maxLines = Math.max(1, Math.min(5, Math.floor(arc.sweep * radius / 22)));
    let fontSize = Math.max(10, Math.min(radius * 0.07, 20));

    let lines = [];
    for (;;) {
      ctx.font = `bold ${fontSize}px system-ui, sans-serif`;
      lines = wrapWheelLabel(ctx, label, maxWidth);
      if (lines.length <= maxLines || fontSize <= 9) break;
      fontSize -= 1;
    }

    if (lines.length > maxLines) {
      lines = lines.slice(0, maxLines);
      let last = lines[maxLines - 1];
      while (last.length > 1 && ctx.measureText(`${last}…`).width > maxWidth) {
        last = last.slice(0, -1);
      }
      lines[maxLines - 1] = `${last}…`;
    }

    const lineHeight = fontSize * 1.12;
    let y = -((lines.length - 1) * lineHeight) / 2;
    for (const ln of lines) {
      ctx.fillText(ln, radius * 0.82, y);
      y += lineHeight;
    }
  }

  function segmentAngles() {
    const total = segments.reduce((s, seg) => s + seg.weight, 0) || WEIGHT_TOTAL;
    let start = -Math.PI / 2;
    return segments.map((seg) => {
      const sweep = (seg.weight / total) * Math.PI * 2;
      const mid = start + sweep / 2;
      const arc = { start, end: start + sweep, mid, sweep };
      start += sweep;
      return arc;
    });
  }

  function pickWeightedIndex() {
    const total = segments.reduce((s, seg) => s + seg.weight, 0);
    let r = Math.random() * total;
    for (let i = 0; i < segments.length; i++) {
      r -= segments[i].weight;
      if (r <= 0) return i;
    }
    return segments.length - 1;
  }

  function isWheelRoute() {
    const raw = String(location.hash || "")
      .replace(/^#/, "")
      .trim();
    return raw.split(/[/?]/)[0] === "wheel";
  }

  function isWheelVisible() {
    return !!(root && !root.hidden && root.classList.contains("is-workspace-active"));
  }

  function resizeCanvas() {
    if (!canvas || !root) return;
    const box = canvas.parentElement;
    if (!box) return;
    const size = Math.floor(Math.min(box.clientWidth, box.clientHeight, window.innerHeight * 0.78));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const px = Math.max(280, size);
    if (canvas.width === px * dpr && canvas.height === px * dpr) {
      drawWheel();
      return;
    }
    canvas.width = px * dpr;
    canvas.height = px * dpr;
    canvas.style.width = `${px}px`;
    canvas.style.height = `${px}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawWheel();
  }

  function drawWheel(highlightIndex = -1) {
    if (!ctx || !canvas) return;
    const cssW = parseFloat(canvas.style.width) || canvas.width;
    const cssH = parseFloat(canvas.style.height) || canvas.height;
    const cx = cssW / 2;
    const cy = cssH / 2;
    const radius = Math.min(cx, cy) * 0.88;
    ctx.clearRect(0, 0, cssW, cssH);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rotation);

    const arcs = segmentAngles();
    arcs.forEach((arc, i) => {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, radius, arc.start, arc.end);
      ctx.closePath();
      ctx.fillStyle = WHEEL_COLORS[i % WHEEL_COLORS.length];
      ctx.globalAlpha = i === highlightIndex ? 1 : 0.92;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "rgba(255,255,255,0.35)";
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.save();
      ctx.rotate(arc.mid);
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#fff";
      if (highlightIndex < 0 && spinning) {
        ctx.shadowColor = "transparent";
        ctx.shadowBlur = 0;
      } else {
        ctx.shadowColor = "rgba(0,0,0,0.45)";
        ctx.shadowBlur = 4;
      }
      drawSegmentLabel(ctx, segments[i]?.label || "", arc, radius);
      ctx.restore();
    });

    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.12, 0, Math.PI * 2);
    ctx.fillStyle = panelFill || "#1e1e2e";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.5)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.translate(cx, cy - radius - 6);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-14, -22);
    ctx.lineTo(14, -22);
    ctx.closePath();
    ctx.fillStyle = "#f43f5e";
    ctx.fill();
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  function ensureAudio() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (_) {}
    }
    return audioCtx;
  }

  function playTick(intensity = 0.5) {
    if (!soundOn) return;
    const ac = ensureAudio();
    if (!ac) return;
    if (ac.state === "suspended") ac.resume().catch(() => {});
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "triangle";
    osc.frequency.value = 880 + intensity * 440;
    gain.gain.value = 0.08;
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.06);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + 0.07);
  }

  function playWinChime() {
    if (!soundOn) return;
    const ac = ensureAudio();
    if (!ac) return;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ac.currentTime + i * 0.08;
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.36);
    });
  }

  function speakResult(text) {
    if (!text || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "zh-CN";
    u.rate = 0.95;
    window.speechSynthesis.speak(u);
  }

  function easeOutCubic(t) {
    return 1 - (1 - t) ** 3;
  }

  async function spinWheel() {
    if (spinning || !segments.length) return;
    spinning = true;
    if (spinBtn) spinBtn.disabled = true;
    if (resultEl) resultEl.textContent = "旋转中…";

    const winIndex = pickWeightedIndex();
    const arcs = segmentAngles();
    const winMid = arcs[winIndex].mid;
    const pointerAngle = -Math.PI / 2;
    const currentMod = ((rotation % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const targetMod = pointerAngle - winMid;
    let delta = targetMod - currentMod;
    while (delta <= 0) delta += Math.PI * 2;
    const extraSpins = (5 + Math.floor(Math.random() * 4)) * Math.PI * 2;
    const totalDelta = delta + extraSpins;
    const startRot = rotation;
    const endRot = startRot + totalDelta;
    const durationSec = clamp(Number(durationInput?.value) || 5, 1, 60);
    const durationMs = durationSec * 1000;
    const startTime = performance.now();
    let lastTickSeg = -1;

    await new Promise((resolve) => {
      function frame(now) {
        const t = clamp((now - startTime) / durationMs, 0, 1);
        const eased = easeOutCubic(t);
        rotation = startRot + totalDelta * eased;
        drawWheel(t < 1 ? -1 : winIndex);

        const crossed = Math.floor((rotation - startRot) / (Math.PI / 8));
        if (crossed !== lastTickSeg && t < 0.98) {
          lastTickSeg = crossed;
          playTick(1 - t);
        }

        if (t < 1) requestAnimationFrame(frame);
        else resolve();
      }
      requestAnimationFrame(frame);
    });

    rotation = endRot;
    drawWheel(winIndex);
    playWinChime();

    const winner = segments[winIndex]?.label || `选项 ${winIndex + 1}`;
    if (resultEl) {
      resultEl.innerHTML = `🎯 <strong>${escapeHtml(winner)}</strong>`;
    }
    speakResult(winner);

    spinning = false;
    if (spinBtn) spinBtn.disabled = false;
    saveState();
  }

  function bindControls() {
    countInput?.addEventListener("change", () => setSegmentCount(Number(countInput.value)));
    durationInput?.addEventListener("change", saveState);
    soundToggle?.addEventListener("change", () => {
      soundOn = Boolean(soundToggle.checked);
      saveState();
    });
    spinBtn?.addEventListener("click", () => spinWheel().catch(() => {}));
    window.addEventListener("resize", () => {
      if (isWheelVisible()) resizeCanvas();
    }, { passive: true });
  }

  function observeWheelStage() {
    const stage = canvas?.parentElement;
    if (!stage || stage.dataset.wheelObserved === "1") return;
    stage.dataset.wheelObserved = "1";
    if (typeof ResizeObserver !== "function") return;
    resizeObserver = new ResizeObserver(() => {
      if (isWheelVisible()) resizeCanvas();
    });
    resizeObserver.observe(stage);
  }

  function scheduleSegmentEditors() {
    if (editorsReady) return;
    const run = () => {
      if (editorsReady || !segmentsList) return;
      renderSegmentEditors();
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(run, { timeout: 180 });
    } else {
      setTimeout(run, 0);
    }
  }

  function paintWheelSoon() {
    requestAnimationFrame(() => {
      resizeCanvas();
      requestAnimationFrame(resizeCanvas);
    });
  }

  function initWheelCore() {
    root = $("#wheel");
    if (!root || root.dataset.bound) return false;
    root.dataset.bound = "1";

    canvas = $("#wheel-canvas");
    ctx = canvas?.getContext("2d", { alpha: true });
    spinBtn = $("#wheel-spin");
    resultEl = $("#wheel-result");
    countInput = $("#wheel-count");
    durationInput = $("#wheel-duration");
    soundToggle = $("#wheel-sound");
    segmentsList = $("#wheel-segments");
    panelFill = getComputedStyle(document.documentElement).getPropertyValue("--panel").trim() || "#1e1e2e";

    const saved = loadState();
    if (saved) {
      segments = saved.segments.map((s, i) => ({
        label: trimLabel(s.label) || defaultLabel(i),
        weight: roundWeight(Number(s.weight) || MIN_WEIGHT),
      }));
      normalizeWeights();
      if (durationInput) durationInput.value = String(clamp(Number(saved.duration) || 5, 1, 60));
      soundOn = saved.sound !== false;
    } else {
      segments = defaultSegments(Number(countInput?.value) || 6);
    }
    if (countInput) countInput.value = String(segments.length);
    if (soundToggle) soundToggle.checked = soundOn;

    bindSegmentEditorEvents();
    bindControls();
    observeWheelStage();
    paintWheelSoon();
    scheduleSegmentEditors();
    return true;
  }

  function ensureWheel() {
    if (inited) {
      if (isWheelVisible()) paintWheelSoon();
      if (!editorsReady) scheduleSegmentEditors();
      return;
    }
    if (!initWheelCore()) return;
    inited = true;
  }

  function onRoute(ev) {
    const tool = ev?.detail?.tool || (isWheelRoute() ? "wheel" : "");
    if (tool === "wheel") ensureWheel();
  }

  window.addEventListener("devtools:route", onRoute);
  if (isWheelRoute()) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", ensureWheel, { once: true });
    } else {
      ensureWheel();
    }
  }
})();
