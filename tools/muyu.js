(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  const STORAGE_KEY = "devtools-muyu-v1";
  const HTML_POOL_SIZE = 4;
  const DEFAULT_FLOAT_PHRASES = ["功德 +1", "善哉", "福生无量", "随喜", "心安", "清净", "平安喜乐"];
  const VALID_THEMES = new Set(["zen", "ocean", "gold", "forest"]);
  const MODAL_MODES = [
    [1, 0.2, 0.55],
    [2.76, 0.13, 0.3],
    [5.4, 0.08, 0.16],
    [8.93, 0.05, 0.08],
  ];

  /** 木鱼造型参考 wooden-fish-dsh/docs/fish.svg 与 heyuan110/cyber-merit */
  function renderFishArt(prefix) {
    const p = prefix;
    return `<svg class="muyu-fish-svg" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="${p}-body" cx="40%" cy="32%" r="80%">
          <stop offset="0%" stop-color="#bd8244"/>
          <stop offset="45%" stop-color="#7d5022"/>
          <stop offset="100%" stop-color="#2c1a0a"/>
        </radialGradient>
        <linearGradient id="${p}-rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#e6bf80"/>
          <stop offset="50%" stop-color="#9a6a32"/>
          <stop offset="100%" stop-color="#553616"/>
        </linearGradient>
        <radialGradient id="${p}-mouth" cx="50%" cy="30%" r="75%">
          <stop offset="0%" stop-color="#3a2410"/>
          <stop offset="100%" stop-color="#0c0703"/>
        </radialGradient>
        <linearGradient id="${p}-hl" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="rgba(255,242,214,0.55)"/>
          <stop offset="100%" stop-color="rgba(255,242,214,0)"/>
        </linearGradient>
      </defs>
      <ellipse cx="100" cy="180" rx="72" ry="11" fill="rgba(0,0,0,0.28)"/>
      <ellipse cx="100" cy="102" rx="91" ry="80" fill="url(#${p}-rim)"/>
      <ellipse cx="100" cy="98" rx="83" ry="72" fill="url(#${p}-body)"/>
      <g stroke="#3a2410" stroke-opacity="0.32" fill="none" stroke-linecap="round">
        <path d="M40 92 Q100 64 160 92" stroke-width="2.3"/>
        <path d="M46 112 Q100 90 154 112" stroke-width="2"/>
        <path d="M56 132 Q100 116 144 132" stroke-width="1.7"/>
      </g>
      <g fill="none" stroke="#2c1a0a" stroke-opacity="0.55" stroke-linecap="round">
        <path d="M134 54 Q166 66 162 106" stroke-width="4.5"/>
        <path d="M146 62 Q168 78 164 102" stroke-width="2.8"/>
      </g>
      <circle cx="150" cy="84" r="7" fill="#221408"/>
      <circle cx="147.5" cy="81.5" r="2.2" fill="#6a4520"/>
      <path d="M50 116 Q100 156 150 116 Q126 138 100 138 Q74 138 50 116 Z" fill="url(#${p}-mouth)"/>
      <ellipse cx="100" cy="119" rx="42" ry="14" fill="url(#${p}-mouth)"/>
      <path d="M58 114 Q100 130 142 114" stroke="rgba(255,222,172,0.3)" stroke-width="2" fill="none" stroke-linecap="round"/>
      <ellipse cx="76" cy="60" rx="36" ry="21" fill="url(#${p}-hl)"/>
      <ellipse cx="62" cy="54" rx="12" ry="7" fill="rgba(255,250,230,0.6)"/>
      <rect x="34" y="168" width="132" height="16" rx="8" fill="#8A5A2B" stroke="#6B421A" stroke-width="2"/>
      <rect x="36" y="170" width="128" height="4" rx="2" fill="#A07038" opacity="0.75"/>
      <g class="muyu-mallet">
        <rect x="148" y="18" width="8" height="34" rx="4" fill="#8A5A2B" stroke="#6B421A" stroke-width="1.5"/>
        <ellipse cx="152" cy="14" rx="11" ry="8" fill="#B87A35" stroke="#6B421A" stroke-width="1.5"/>
      </g>
    </svg>`;
  }

  let root = null;
  let countEl = null;
  let countFsEl = null;
  let fishBtn = null;
  let fishFsBtn = null;
  let soundToggle = null;
  let soundFsToggle = null;
  let fsBtn = null;
  let fsRoot = null;
  let fsCloseBtn = null;
  let resetBtn = null;
  let inited = false;
  let fullscreen = false;
  let count = 0;
  let soundOn = true;
  let audioCtx = null;
  let webAudioReady = false;
  let htmlKnockUri = "";
  let htmlKnockPool = [];
  let htmlKnockCursor = 0;
  let htmlAudioPrimed = false;
  let syncingSound = false;
  let fsBgCanvas = null;
  let fsBgCtx = null;
  let fsBgRaf = 0;
  let fsBgRunning = false;
  let fsPulseEl = null;
  let fsRippleEl = null;
  let fsFloatsEl = null;
  let fsBgStars = [];
  let fsBgDust = [];
  let fsBgSparks = [];
  let fsBgT = 0;
  let themeId = "zen";
  let customPhrasesRaw = "";
  let comboCount = 0;
  let comboTimer = 0;
  let noiseBuf = null;
  let stageRoot = null;
  let stageBgCanvas = null;
  let stageBgCtx = null;
  let stageBgRaf = 0;
  let stageBgRunning = false;
  let stageRippleEl = null;
  let stageFloatsEl = null;
  let stageBgStars = [];
  let stageBgDust = [];
  let stageBgSparks = [];
  let stageBgT = 0;
  let themeSelect = null;
  let phrasesInput = null;

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

  function synthModalKnockSamples(sampleRate, pitch = 1) {
    const duration = 0.34;
    const n = Math.max(1, Math.floor(sampleRate * duration));
    const samples = new Float32Array(n);
    const base = 560 * pitch;
    const noiseLen = Math.max(1, Math.floor(sampleRate * 0.04));
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      let s = 0;
      for (let m = 0; m < MODAL_MODES.length; m++) {
        const mult = MODAL_MODES[m][0];
        const dec = MODAL_MODES[m][1];
        const amp = MODAL_MODES[m][2];
        const attack = t < 0.003 ? t / 0.003 : 1;
        s += Math.sin(Math.PI * 2 * base * mult * t) * amp * Math.exp(-t / dec) * attack;
      }
      if (t < 0.04) {
        const ne = Math.pow(1 - t / 0.04, 3);
        const ni = Math.min(noiseLen - 1, i);
        const noise = (Math.random() * 2 - 1) * 0.42 * ne;
        s += noise * Math.sin(Math.PI * 2 * 2300 * pitch * t);
      }
      samples[i] = s * 0.78;
    }
    return samples;
  }

  function synthKnockUri(pitch = 1) {
    const sampleRate = 22050;
    return encodeWavMono16(synthModalKnockSamples(sampleRate, pitch), sampleRate);
  }

  function initKnockAudio() {
    if (htmlKnockUri) return;
    htmlKnockUri = synthKnockUri(1);
    htmlKnockPool = Array.from({ length: HTML_POOL_SIZE }, () => {
      const a = new Audio(htmlKnockUri);
      a.preload = "auto";
      return a;
    });
  }

  function getNoiseBuffer(ac) {
    if (noiseBuf) return noiseBuf;
    const len = Math.floor(ac.sampleRate * 0.035);
    noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
    const ch = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    return noiseBuf;
  }

  function playKnockModal(pitch = 1) {
    const ac = ensureAudio();
    if (!ac || ac.state !== "running") return false;
    const t0 = ac.currentTime;
    const lp = ac.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 3800;
    lp.Q.value = 0.5;
    const out = ac.createGain();
    out.gain.value = 0.9;
    lp.connect(out).connect(ac.destination);

    const ns = ac.createBufferSource();
    ns.buffer = getNoiseBuffer(ac);
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 2300 * pitch;
    bp.Q.value = 0.9;
    const ng = ac.createGain();
    ng.gain.value = 0.4;
    ns.connect(bp).connect(ng).connect(lp);
    ns.start(t0);
    ns.stop(t0 + 0.04);

    const base = 560 * pitch;
    for (let i = 0; i < MODAL_MODES.length; i++) {
      const mult = MODAL_MODES[i][0];
      const dec = MODAL_MODES[i][1];
      const amp = MODAL_MODES[i][2];
      const o = ac.createOscillator();
      o.type = "sine";
      o.frequency.value = base * mult;
      const g = ac.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(amp, t0 + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dec);
      o.connect(g).connect(lp);
      o.start(t0);
      o.stop(t0 + dec + 0.02);
    }
    return true;
  }

  function ensureAudio() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (_) {}
    }
    return audioCtx;
  }

  function unlockMuyuAudio() {
    if (!soundOn) return;
    initKnockAudio();
    if (!htmlAudioPrimed) {
      htmlAudioPrimed = true;
      const prime = new Audio(htmlKnockUri);
      prime.volume = 0.0001;
      const p = prime.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
    const ac = ensureAudio();
    if (!ac) {
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
        });
    } else {
      webAudioReady = ac.state === "running";
    }
  }

  function playKnockWeb(pitch = 1) {
    return playKnockModal(pitch);
  }

  function playKnockHtml(pitch = 1) {
    if (!htmlKnockPool.length) return;
    const a = htmlKnockPool[htmlKnockCursor % HTML_POOL_SIZE];
    htmlKnockCursor += 1;
    a.volume = 0.72;
    if (Math.abs(pitch - 1) > 0.02) {
      a.src = synthKnockUri(pitch);
    } else if (htmlKnockUri) {
      a.src = htmlKnockUri;
    }
    try {
      a.currentTime = 0;
    } catch (_) {}
    const p = a.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }

  function registerCombo() {
    comboCount += 1;
    window.clearTimeout(comboTimer);
    comboTimer = window.setTimeout(() => {
      comboCount = 0;
    }, 1100);
    return 1 + Math.min(comboCount, 12) * 0.045;
  }

  function playKnock() {
    if (!soundOn) return;
    initKnockAudio();
    const pitch = registerCombo();
    const useHtml = prefersCoarsePointer() && !webAudioReady;
    if (useHtml || !playKnockWeb(pitch)) playKnockHtml(pitch);
  }

  function formatCount(n) {
    return String(Math.max(0, Math.floor(Number(n) || 0)));
  }

  function renderCount() {
    const text = formatCount(count);
    if (countEl) {
      countEl.textContent = text;
      countEl.classList.remove("is-bump");
      void countEl.offsetWidth;
      countEl.classList.add("is-bump");
      window.setTimeout(() => countEl.classList.remove("is-bump"), 120);
    }
    if (countFsEl) {
      countFsEl.textContent = text;
      countFsEl.classList.remove("is-bump");
      void countFsEl.offsetWidth;
      countFsEl.classList.add("is-bump");
      window.setTimeout(() => countFsEl.classList.remove("is-bump"), 120);
    }
  }

  function getFloatPhrases() {
    const lines = String(customPhrasesRaw || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    return lines.length ? lines : DEFAULT_FLOAT_PHRASES;
  }

  function pickFloatPhrase() {
    const list = getFloatPhrases();
    return list[Math.floor(Math.random() * list.length)];
  }

  function applyTheme(nextTheme) {
    themeId = VALID_THEMES.has(nextTheme) ? nextTheme : "zen";
    if (stageRoot) stageRoot.dataset.muyuTheme = themeId;
    if (fsRoot) fsRoot.dataset.muyuTheme = themeId;
    if (themeSelect && themeSelect.value !== themeId) themeSelect.value = themeId;
  }

  function themeParticleRgb() {
    const map = {
      zen: { star: "255,245,220", dust: "255,210,120", spark: "255" },
      ocean: { star: "220,240,255", dust: "140,200,255", spark: "180" },
      gold: { star: "255,245,220", dust: "255,200,100", spark: "255" },
      forest: { star: "220,255,240", dust: "140,220,180", spark: "180" },
    };
    return map[themeId] || map.zen;
  }

  function spawnFloat(floatsEl) {
    if (!floatsEl) return;
    const f = document.createElement("span");
    f.className = floatsEl.id === "muyu-stage-floats" ? "muyu-stage-float" : "muyu-fs-float";
    f.textContent = pickFloatPhrase();
    f.style.setProperty("--muyu-dx", `${Math.round(rnd(-24, 24))}px`);
    floatsEl.appendChild(f);
    window.setTimeout(() => f.remove(), 1000);
  }

  function triggerRipple(rippleEl) {
    if (!rippleEl) return;
    rippleEl.classList.remove("is-go");
    void rippleEl.offsetWidth;
    rippleEl.classList.add("is-go");
  }

  function burstSparks(sparks, stageEl, limit = 180, localCoords = false) {
    if (!stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    const cx = localCoords ? rect.width / 2 : rect.left + rect.width / 2;
    const cy = localCoords ? rect.height * 0.46 : rect.top + rect.height * 0.46;
    const n = 12;
    for (let i = 0; i < n; i++) {
      const ang = (Math.PI * 2 * i) / n + rnd(-0.3, 0.3);
      const sp = rnd(1.2, 3.8);
      sparks.push({
        x: cx,
        y: cy,
        vx: Math.cos(ang) * sp,
        vy: Math.sin(ang) * sp - 1.1,
        life: 1,
        r: rnd(1.2, 2.8),
      });
    }
    if (sparks.length > limit) sparks.splice(0, sparks.length - limit);
  }

  function paintBgFrame(ctx, w, h, tRef, stars, dust, sparks, getSparkRgb) {
    const rgb = themeParticleRgb();
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      const a = 0.35 + 0.45 * (0.5 + 0.5 * Math.sin(tRef.value * s.sp + s.tw));
      ctx.beginPath();
      ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb.star},${a.toFixed(3)})`;
      ctx.fill();
    }
    for (const d of dust) {
      d.y -= d.v / h;
      d.x += d.drift / w;
      if (d.y < -0.02) {
        d.y = 1.02;
        d.x = rnd(0, 1);
      }
      const a = d.a * (0.6 + 0.4 * Math.sin(tRef.value * 1.5 + d.ph));
      ctx.beginPath();
      ctx.arc(d.x * w, d.y * h, d.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb.dust},${a.toFixed(3)})`;
      ctx.fill();
    }
    for (const p of sparks) {
      p.vy += 0.11;
      p.x += p.vx;
      p.y += p.vy;
      p.life -= 0.024;
      if (p.life <= 0) continue;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
      const sparkG = getSparkRgb(p.life);
      ctx.fillStyle = `rgba(${rgb.spark},${sparkG},120,${p.life.toFixed(3)})`;
      ctx.fill();
    }
    return sparks.filter((p) => p.life > 0);
  }

  function rnd(a, b) {
    return a + Math.random() * (b - a);
  }

  function initStageBg() {
    stageBgCanvas = document.getElementById("muyu-stage-bg");
    stageRippleEl = document.getElementById("muyu-stage-ripple");
    stageFloatsEl = document.getElementById("muyu-stage-floats");
    stageRoot = document.getElementById("muyu-stage");
    if (!stageBgCanvas) return;
    stageBgCtx = stageBgCanvas.getContext("2d", { alpha: true });
    stageBgStars = Array.from({ length: 16 }, () => ({
      x: Math.random(),
      y: Math.random() * 0.75,
      r: rnd(0.4, 1.2),
      tw: rnd(0, Math.PI * 2),
      sp: rnd(1, 2),
    }));
    stageBgDust = Array.from({ length: 14 }, () => ({
      x: rnd(0, 1),
      y: rnd(0, 1),
      r: rnd(0.6, 1.8),
      v: rnd(0.04, 0.14),
      drift: rnd(-0.025, 0.025),
      a: rnd(0.18, 0.48),
      ph: rnd(0, 6.28),
    }));
  }

  function resizeStageBg() {
    if (!stageBgCanvas || !stageBgCtx || !stageRoot) return;
    const rect = stageRoot.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    stageBgCanvas.width = w * dpr;
    stageBgCanvas.height = h * dpr;
    stageBgCanvas.style.width = `${w}px`;
    stageBgCanvas.style.height = `${h}px`;
    stageBgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function paintStageBgFrame() {
    if (!stageBgCtx || !stageBgRunning || !stageRoot) return;
    const rect = stageRoot.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    stageBgT += 0.016;
    const tRef = { value: stageBgT };
    stageBgSparks = paintBgFrame(
      stageBgCtx,
      w,
      h,
      tRef,
      stageBgStars,
      stageBgDust,
      stageBgSparks,
      (life) => 190 + Math.floor(50 * life)
    );
    stageBgRaf = requestAnimationFrame(paintStageBgFrame);
  }

  function startStageBg() {
    if (!stageBgCanvas) initStageBg();
    if (!stageBgCtx || stageBgRunning || fullscreen) return;
    stageBgRunning = true;
    resizeStageBg();
    stageBgRaf = requestAnimationFrame(paintStageBgFrame);
  }

  function stopStageBg() {
    stageBgRunning = false;
    if (stageBgRaf) cancelAnimationFrame(stageBgRaf);
    stageBgRaf = 0;
    stageBgSparks = [];
    if (stageBgCtx && stageBgCanvas) stageBgCtx.clearRect(0, 0, stageBgCanvas.width, stageBgCanvas.height);
  }

  function initFsBg() {
    fsBgCanvas = document.getElementById("muyu-fs-bg");
    fsPulseEl = document.getElementById("muyu-fs-pulse");
    fsRippleEl = document.getElementById("muyu-fs-ripple");
    fsFloatsEl = document.getElementById("muyu-fs-floats");
    if (!fsBgCanvas) return;
    fsBgCtx = fsBgCanvas.getContext("2d", { alpha: true });
    fsBgStars = Array.from({ length: 28 }, () => ({
      x: Math.random(),
      y: Math.random() * 0.72,
      r: rnd(0.5, 1.5),
      tw: rnd(0, Math.PI * 2),
      sp: rnd(1, 2.2),
    }));
    fsBgDust = Array.from({ length: 24 }, () => ({
      x: rnd(0, 1),
      y: rnd(0, 1),
      r: rnd(0.8, 2.2),
      v: rnd(0.05, 0.18),
      drift: rnd(-0.03, 0.03),
      a: rnd(0.2, 0.55),
      ph: rnd(0, 6.28),
    }));
  }

  function resizeFsBg() {
    if (!fsBgCanvas || !fsBgCtx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    fsBgCanvas.width = w * dpr;
    fsBgCanvas.height = h * dpr;
    fsBgCanvas.style.width = `${w}px`;
    fsBgCanvas.style.height = `${h}px`;
    fsBgCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function burstFsSparks() {
    burstSparks(fsBgSparks, document.getElementById("muyu-fs-stage"));
  }

  function paintFsBgFrame() {
    if (!fsBgCtx || !fsBgRunning) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    fsBgT += 0.016;
    const tRef = { value: fsBgT };
    fsBgSparks = paintBgFrame(
      fsBgCtx,
      w,
      h,
      tRef,
      fsBgStars,
      fsBgDust,
      fsBgSparks,
      (life) => 190 + Math.floor(50 * life)
    );
    fsBgRaf = requestAnimationFrame(paintFsBgFrame);
  }

  function startFsBg() {
    if (!fsBgCanvas) initFsBg();
    if (!fsBgCtx || fsBgRunning) return;
    fsBgRunning = true;
    resizeFsBg();
    fsBgRaf = requestAnimationFrame(paintFsBgFrame);
  }

  function stopFsBg() {
    fsBgRunning = false;
    if (fsBgRaf) cancelAnimationFrame(fsBgRaf);
    fsBgRaf = 0;
    fsBgSparks = [];
    if (fsBgCtx && fsBgCanvas) fsBgCtx.clearRect(0, 0, fsBgCanvas.width, fsBgCanvas.height);
  }

  function playKnockFx() {
    if (fullscreen) {
      if (fsPulseEl) {
        fsPulseEl.classList.remove("is-flash");
        void fsPulseEl.offsetWidth;
        fsPulseEl.classList.add("is-flash");
      }
      triggerRipple(fsRippleEl);
      spawnFloat(fsFloatsEl);
      burstFsSparks();
    } else {
      triggerRipple(stageRippleEl);
      spawnFloat(stageFloatsEl);
      burstSparks(stageBgSparks, stageRoot || fishBtn, 80);
    }
    if (navigator.vibrate) navigator.vibrate(12);
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Number.isFinite(data.count) && data.count >= 0) count = Math.floor(data.count);
      if (typeof data.sound === "boolean") soundOn = data.sound;
      if (typeof data.theme === "string") applyTheme(data.theme);
      if (typeof data.phrases === "string") customPhrasesRaw = data.phrases;
    } catch (_) {}
  }

  function saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          count,
          sound: soundOn,
          theme: themeId,
          phrases: customPhrasesRaw,
        })
      );
    } catch (_) {}
  }

  function syncSoundToggles() {
    syncingSound = true;
    if (soundToggle) soundToggle.checked = soundOn;
    if (soundFsToggle) soundFsToggle.checked = soundOn;
    syncingSound = false;
  }

  function setSound(on) {
    soundOn = Boolean(on);
    syncSoundToggles();
    saveState();
    if (soundOn) unlockMuyuAudio();
  }

  function mountFishArt(btn, prefix, withHint) {
    if (!btn || btn.dataset.art === "1") return;
    btn.dataset.art = "1";
    btn.innerHTML = renderFishArt(prefix);
    if (withHint) {
      const hint = document.createElement("span");
      hint.className = "muyu-fish-hint";
      hint.textContent = "点击敲击";
      btn.appendChild(hint);
    }
  }

  function bumpFish(el) {
    if (!el) return;
    el.classList.remove("is-knocking");
    void el.offsetWidth;
    el.classList.add("is-knocking");
    window.setTimeout(() => el.classList.remove("is-knocking"), 320);
  }

  function knock(fromEl) {
    count += 1;
    renderCount();
    saveState();
    bumpFish(fromEl || (fullscreen ? fishFsBtn : fishBtn));
    playKnock();
    playKnockFx();
  }

  function resetCount() {
    if (count <= 0) return;
    if (!window.confirm(`确定清零？当前已敲 ${formatCount(count)} 次。`)) return;
    count = 0;
    renderCount();
    saveState();
  }

  function forceExitFullscreen() {
    fullscreen = false;
    stopFsBg();
    if (fsRoot) fsRoot.hidden = true;
    document.body.classList.remove("muyu-fs-active");
    if (isMuyuRoute()) startStageBg();
  }

  function enterFullscreen() {
    ensureMuyu();
    if (fullscreen || !fsRoot) return;
    stopStageBg();
    fullscreen = true;
    fsRoot.hidden = false;
    document.body.classList.add("muyu-fs-active");
    applyTheme(themeId);
    syncSoundToggles();
    startFsBg();
    fsCloseBtn?.focus();
  }

  function exitFullscreen() {
    forceExitFullscreen();
    fsBtn?.focus();
  }

  function isMuyuRoute() {
    const raw = String(location.hash || "")
      .replace(/^#/, "")
      .trim();
    return raw.split(/[/?]/)[0] === "muyu";
  }

  function bindKnock(btn) {
    if (!btn || btn.dataset.bound === "1") return;
    btn.dataset.bound = "1";
    let touchHandled = false;
    btn.addEventListener(
      "touchend",
      (e) => {
        e.preventDefault();
        touchHandled = true;
        window.setTimeout(() => {
          touchHandled = false;
        }, 450);
        unlockMuyuAudio();
        knock(btn);
      },
      { passive: false }
    );
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (touchHandled) return;
      unlockMuyuAudio();
      knock(btn);
    });
  }

  function bindControls() {
    bindKnock(fishBtn);
    bindKnock(fishFsBtn);

    fsBtn?.addEventListener("click", enterFullscreen);
    fsCloseBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      exitFullscreen();
    });

    soundToggle?.addEventListener("change", () => {
      if (syncingSound) return;
      setSound(Boolean(soundToggle.checked));
    });
    soundFsToggle?.addEventListener("change", () => {
      if (syncingSound) return;
      setSound(Boolean(soundFsToggle.checked));
    });

    resetBtn?.addEventListener("click", resetCount);

    window.addEventListener("resize", () => {
      if (fullscreen) resizeFsBg();
      else if (stageBgRunning) resizeStageBg();
    });

    themeSelect?.addEventListener("change", () => {
      applyTheme(themeSelect.value);
      saveState();
    });

    phrasesInput?.addEventListener("input", () => {
      customPhrasesRaw = phrasesInput.value;
      saveState();
    });

    document.addEventListener("keydown", (e) => {
      if (!fullscreen) return;
      if (e.key === "Escape") {
        e.preventDefault();
        exitFullscreen();
      }
    });
  }

  function bindFsShell() {
    const fs = document.getElementById("muyu-fs");
    const close = document.getElementById("muyu-fs-close");
    if (fs) fs.hidden = true;
    if (close && close.dataset.shellBound !== "1") {
      close.dataset.shellBound = "1";
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        exitFullscreen();
      });
    }
  }

  function mountFishArtEarly() {
    mountFishArt(document.getElementById("muyu-fish"), "muyu", true);
    mountFishArt(document.getElementById("muyu-fish-fs"), "muyu-fs", false);
  }

  function bootMuyuShell() {
    bindFsShell();
    mountFishArtEarly();
    initFsBg();
    initStageBg();
  }

  function initMuyuCore() {
    root = $("#muyu");
    if (!root || root.dataset.bound) return false;
    root.dataset.bound = "1";

    countEl = $("#muyu-count");
    countFsEl = $("#muyu-fs-count");
    fishBtn = $("#muyu-fish");
    fishFsBtn = $("#muyu-fish-fs");
    soundToggle = $("#muyu-sound");
    soundFsToggle = $("#muyu-sound-fs");
    fsBtn = $("#muyu-fullscreen");
    fsRoot = $("#muyu-fs");
    fsCloseBtn = $("#muyu-fs-close");
    resetBtn = $("#muyu-reset");
    themeSelect = $("#muyu-theme");
    phrasesInput = $("#muyu-phrases");
    stageRoot = $("#muyu-stage");

    mountFishArt(fishBtn, "muyu", true);
    mountFishArt(fishFsBtn, "muyu-fs", false);
    bindFsShell();
    initStageBg();

    loadState();
    applyTheme(themeId);
    if (phrasesInput) phrasesInput.value = customPhrasesRaw;
    syncSoundToggles();
    renderCount();
    initKnockAudio();
    bindControls();
    startStageBg();
    return true;
  }

  function ensureMuyu() {
    if (inited) return;
    if (!initMuyuCore()) return;
    inited = true;
  }

  function onRoute(ev) {
    const tool = ev?.detail?.tool || (isMuyuRoute() ? "muyu" : "");
    if (tool !== "muyu") {
      forceExitFullscreen();
      stopStageBg();
    }
    if (tool === "muyu") {
      ensureMuyu();
      startStageBg();
    }
  }

  bootMuyuShell();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootMuyuShell, { once: true });
  }
  window.addEventListener("devtools:route", onRoute);
  if (isMuyuRoute()) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", ensureMuyu, { once: true });
    } else {
      ensureMuyu();
    }
  }

  window.MuyuTool = {
    isFullscreen: () => fullscreen,
    exitFullscreen,
    getCount: () => count,
  };
})();
