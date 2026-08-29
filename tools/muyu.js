(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  const STORAGE_KEY = "devtools-muyu-v1";
  const HTML_POOL_SIZE = 4;

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

  function synthKnockUri() {
    const sampleRate = 22050;
    const duration = 0.16;
    const n = Math.max(1, Math.floor(sampleRate * duration));
    const samples = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / sampleRate;
      const env = Math.exp(-t * 34);
      const tone =
        Math.sin(Math.PI * 2 * 320 * t) * 0.42 +
        Math.sin(Math.PI * 2 * 640 * t) * 0.12 +
        Math.sin(Math.PI * 2 * 180 * t) * 0.22;
      const noise = (Math.random() * 2 - 1) * 0.08 * Math.exp(-t * 52);
      samples[i] = (tone + noise) * env * 0.72;
    }
    return encodeWavMono16(samples, sampleRate);
  }

  function initKnockAudio() {
    if (htmlKnockUri) return;
    htmlKnockUri = synthKnockUri();
    htmlKnockPool = Array.from({ length: HTML_POOL_SIZE }, () => {
      const a = new Audio(htmlKnockUri);
      a.preload = "auto";
      return a;
    });
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

  function playKnockWeb() {
    const ac = ensureAudio();
    if (!ac || ac.state !== "running") return false;
    const t0 = ac.currentTime;
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(340, t0);
    osc.frequency.exponentialRampToValueAtTime(220, t0 + 0.08);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.28, t0 + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
    osc.connect(gain);
    gain.connect(ac.destination);
    osc.start(t0);
    osc.stop(t0 + 0.15);
    return true;
  }

  function playKnockHtml() {
    if (!htmlKnockPool.length) return;
    const a = htmlKnockPool[htmlKnockCursor % HTML_POOL_SIZE];
    htmlKnockCursor += 1;
    a.volume = 0.72;
    try {
      a.currentTime = 0;
    } catch (_) {}
    const p = a.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }

  function playKnock() {
    if (!soundOn) return;
    initKnockAudio();
    const useHtml = prefersCoarsePointer() && !webAudioReady;
    if (useHtml || !playKnockWeb()) playKnockHtml();
  }

  function formatCount(n) {
    return String(Math.max(0, Math.floor(Number(n) || 0)));
  }

  function renderCount() {
    const text = formatCount(count);
    if (countEl) countEl.textContent = text;
    if (countFsEl) countFsEl.textContent = text;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Number.isFinite(data.count) && data.count >= 0) count = Math.floor(data.count);
      if (typeof data.sound === "boolean") soundOn = data.sound;
    } catch (_) {}
  }

  function saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          count,
          sound: soundOn,
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
    if (fsRoot) fsRoot.hidden = true;
    document.body.classList.remove("muyu-fs-active");
  }

  function enterFullscreen() {
    ensureMuyu();
    if (fullscreen || !fsRoot) return;
    fullscreen = true;
    fsRoot.hidden = false;
    document.body.classList.add("muyu-fs-active");
    syncSoundToggles();
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

    mountFishArt(fishBtn, "muyu", true);
    mountFishArt(fishFsBtn, "muyu-fs", false);
    bindFsShell();

    loadState();
    syncSoundToggles();
    renderCount();
    initKnockAudio();
    bindControls();
    return true;
  }

  function ensureMuyu() {
    if (inited) return;
    if (!initMuyuCore()) return;
    inited = true;
  }

  function onRoute(ev) {
    const tool = ev?.detail?.tool || (isMuyuRoute() ? "muyu" : "");
    if (tool !== "muyu") forceExitFullscreen();
    if (tool === "muyu") ensureMuyu();
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
