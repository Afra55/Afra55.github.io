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
  let audioBackend = "auto"; // auto | web | html
  let htmlTickPool = [];
  let htmlWinPool = [];
  let htmlTickUri = "";
  let htmlWinUri = "";
  let htmlPoolCursor = 0;
  let htmlAudioPrimed = false;
  let webAudioReady = false;
  let lastTickAt = 0;
  let spinDisplaySize = 0;
  let zhVoice = null;
  let speechPrimed = false;
  const HTML_POOL_SIZE = 8;
  const TICK_MIN_MS = 110;
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

  function wheelDisplaySize() {
    if (!canvas) return 0;
    const rect = canvas.getBoundingClientRect();
    return Math.max(1, Math.floor(Math.min(rect.width, rect.height)));
  }

  function resizeCanvas() {
    if (!canvas || !ctx || !root) return;
    const displaySize = wheelDisplaySize();
    if (displaySize < 40) {
      requestAnimationFrame(resizeCanvas);
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const buf = Math.round(displaySize * dpr);
    if (canvas.width !== buf || canvas.height !== buf) {
      canvas.width = buf;
      canvas.height = buf;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    drawWheel();
  }

  function drawWheel(highlightIndex = -1) {
    if (!ctx || !canvas) return;
    const cssW = spinning ? spinDisplaySize || wheelDisplaySize() : wheelDisplaySize();
    const cssH = cssW;
    if (cssW < 1) return;
    const cx = cssW / 2;
    const cy = cssH / 2;
    const radius = Math.min(cx, cy) * 0.88;
    const liteSpin = spinning && highlightIndex < 0;
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

      if (!liteSpin) {
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
      }
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

  function prefersCoarsePointer() {
    try {
      return window.matchMedia("(pointer: coarse)").matches || navigator.maxTouchPoints > 0;
    } catch (_) {
      return navigator.maxTouchPoints > 0;
    }
  }

  function encodeWavMono16(samples, sampleRate) {
    const numSamples = samples.length;
    const buffer = new ArrayBuffer(44 + numSamples * 2);
    const view = new DataView(buffer);
    const writeStr = (off, s) => {
      for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + numSamples * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, numSamples * 2, true);
    let offset = 44;
    for (let i = 0; i < numSamples; i++) {
      const s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s * 0x7fff, true);
      offset += 2;
    }
    const bytes = new Uint8Array(buffer);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return `data:audio/wav;base64,${btoa(bin)}`;
  }

  function synthBeepUri(freq, durationSec, volume) {
    const sampleRate = 22050;
    const count = Math.max(1, Math.floor(sampleRate * durationSec));
    const samples = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * 36);
      samples[i] = Math.sin(Math.PI * 2 * freq * t) * volume * env;
    }
    return encodeWavMono16(samples, sampleRate);
  }

  function initHtmlWheelAudio() {
    if (htmlTickUri) return;
    htmlTickUri = synthBeepUri(920, 0.07, 0.55);
    htmlWinUri = synthBeepUri(660, 0.22, 0.5);
    htmlTickPool = Array.from({ length: HTML_POOL_SIZE }, () => {
      const a = new Audio(htmlTickUri);
      a.preload = "auto";
      return a;
    });
    htmlWinPool = [523, 659, 784].map((freq) => {
      const a = new Audio(synthBeepUri(freq, 0.28, 0.45));
      a.preload = "auto";
      return a;
    });
  }

  function shouldUseHtmlAudio() {
    if (audioBackend === "html") return true;
    if (audioBackend === "web") return false;
    return prefersCoarsePointer() && !webAudioReady;
  }

  function loadZhVoice() {
    if (!window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices();
    zhVoice =
      voices.find((v) => /^zh-(CN|Hans)/i.test(v.lang)) ||
      voices.find((v) => /^zh/i.test(v.lang)) ||
      null;
  }

  function primeSpeechSynthesis() {
    if (!window.speechSynthesis || speechPrimed) return;
    speechPrimed = true;
    loadZhVoice();
    try {
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    } catch (_) {}
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0.01;
      u.rate = 2;
      if (zhVoice) u.voice = zhVoice;
      window.speechSynthesis.speak(u);
      window.speechSynthesis.cancel();
    } catch (_) {}
  }

  if (typeof window !== "undefined" && window.speechSynthesis) {
    window.speechSynthesis.addEventListener("voiceschanged", loadZhVoice);
    loadZhVoice();
  }

  function playHtmlFromPool(pool, cursorRef, volume = 0.55) {
    if (!pool.length) return false;
    const a = pool[cursorRef.idx % pool.length];
    cursorRef.idx += 1;
    a.volume = volume;
    try {
      a.currentTime = 0;
    } catch (_) {}
    const p = a.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
    return true;
  }

  const htmlTickCursor = { idx: 0 };

  function primeHtmlWheelAudio() {
    if (!soundOn) return;
    initHtmlWheelAudio();
    if (htmlAudioPrimed) return;
    htmlAudioPrimed = true;
    const prime = new Audio(htmlTickUri);
    prime.volume = 0.0001;
    const p = prime.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }

  function ensureAudio() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (_) {}
    }
    return audioCtx;
  }

  /** 在用户手势回调里同步调用（touchend / click） */
  function unlockWheelAudio() {
    primeSpeechSynthesis();
    if (!soundOn) return;
    initHtmlWheelAudio();
    primeHtmlWheelAudio();

    const ac = ensureAudio();
    if (!ac) {
      audioBackend = "html";
      webAudioReady = false;
      return;
    }
    try {
      const buf = ac.createBuffer(1, 1, ac.sampleRate);
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.connect(ac.destination);
      src.start(0);
    } catch (_) {}
    if (ac.state === "suspended") {
      ac.resume()
        .then(() => {
          webAudioReady = ac.state === "running";
        })
        .catch(() => {
          webAudioReady = false;
          audioBackend = "html";
        });
    } else {
      webAudioReady = ac.state === "running";
    }
  }

  function playTickWeb(intensity = 0.5) {
    const ac = ensureAudio();
    if (!ac || ac.state !== "running") return false;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "triangle";
    osc.frequency.value = 880 + intensity * 440;
    gain.gain.value = 0.14;
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + 0.06);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start();
    osc.stop(ac.currentTime + 0.07);
    return true;
  }

  function playWinChimeWeb() {
    const ac = ensureAudio();
    if (!ac || ac.state !== "running") return false;
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const t = ac.currentTime + i * 0.08;
      gain.gain.setValueAtTime(0.16, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(t);
      osc.stop(t + 0.36);
    });
    return true;
  }

  function playTick(intensity = 0.5) {
    if (!soundOn) return;
    const now = performance.now();
    if (now - lastTickAt < TICK_MIN_MS) return;
    lastTickAt = now;
    initHtmlWheelAudio();
    if (shouldUseHtmlAudio() || !playTickWeb(intensity)) {
      playHtmlFromPool(htmlTickPool, htmlTickCursor, 0.55 + intensity * 0.1);
    }
  }

  function playWinChime() {
    if (!soundOn) return;
    initHtmlWheelAudio();
    if (shouldUseHtmlAudio() || !playWinChimeWeb()) {
      htmlWinPool.forEach((a, i) => {
        window.setTimeout(() => {
          a.volume = 0.5;
          try {
            a.currentTime = 0;
          } catch (_) {}
          const p = a.play();
          if (p && typeof p.catch === "function") p.catch(() => {});
        }, i * 80);
      });
    }
  }

  function bindWheelAudioUnlock() {
    if (!root || root.dataset.wheelAudioBound === "1") return;
    root.dataset.wheelAudioBound = "1";
    initHtmlWheelAudio();
    soundToggle?.addEventListener("change", () => {
      if (soundToggle.checked) unlockWheelAudio();
    });
  }

  function speakResult(text) {
    if (!text || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    loadZhVoice();
    try {
      if (synth.paused) synth.resume();
    } catch (_) {}
    synth.cancel();
    window.setTimeout(() => {
      try {
        if (synth.paused) synth.resume();
      } catch (_) {}
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "zh-CN";
      u.rate = 0.95;
      if (zhVoice) u.voice = zhVoice;
      synth.speak(u);
    }, prefersCoarsePointer() ? 180 : 60);
  }

  function speakResultAfterEffects(text) {
    if (!text) return;
    if (!soundOn) {
      speakResult(text);
      return;
    }
    initHtmlWheelAudio();
    let spoke = false;
    const fire = () => {
      if (spoke) return;
      spoke = true;
      speakResult(text);
    };
    window.setTimeout(fire, prefersCoarsePointer() ? 900 : 520);
    if (htmlWinPool.length) {
      const last = htmlWinPool[htmlWinPool.length - 1];
      last.addEventListener("ended", fire, { once: true });
    }
  }

  function easeOutCubic(t) {
    return 1 - (1 - t) ** 3;
  }

  async function spinWheel() {
    if (spinning || !segments.length) return;
    spinning = true;
    spinDisplaySize = wheelDisplaySize();
    lastTickAt = 0;
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
    speakResultAfterEffects(winner);

    spinning = false;
    spinDisplaySize = 0;
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
    spinBtn?.addEventListener("touchend", () => {
      unlockWheelAudio();
    }, { passive: true });
    spinBtn?.addEventListener("click", () => {
      unlockWheelAudio();
      const ac = ensureAudio();
      if (ac && ac.state === "suspended") {
        ac.resume()
          .then(() => {
            webAudioReady = ac.state === "running";
            spinWheel().catch(() => {});
          })
          .catch(() => {
            webAudioReady = false;
            audioBackend = "html";
            spinWheel().catch(() => {});
          });
        return;
      }
      if (ac) webAudioReady = ac.state === "running";
      spinWheel().catch(() => {});
    });
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
    bindWheelAudioUnlock();
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
