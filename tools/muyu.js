(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  const STORAGE_KEY = "devtools-muyu-v1";
  const HTML_POOL_SIZE = 4;
  const DEFAULT_FLOAT_PHRASES = [
    "功德 +1",
    "善哉",
    "福生无量",
    "随喜",
    "心安",
    "清净",
    "平安喜乐",
    "阿弥陀佛",
    "南无",
    "功德无量",
    "福德增长",
    "智慧增长",
    "业障消除",
    "烦恼轻",
    "菩提心",
    "吉祥",
    "如意",
    "安乐",
    "慈悲",
    "自在",
    "无碍",
    "圆融",
    "光明",
    "消灾",
    "延寿",
    "福寿安康",
    "吉祥如意",
    "诸事顺遂",
    "心想事成",
    "善念",
    "正念",
    "欢喜",
    "寂静",
    "安详",
    "祥和",
    "知足",
    "感恩",
    "放下",
    "当下",
    "禅心",
    "一念清净",
    "功德圆满",
    "福慧双修",
    "消灾解难",
    "六时吉祥",
    "日日是好日",
    "好事发生",
    "善有善报",
    "福报 +1",
    "回向",
  ];
  const VALID_THEMES = new Set(["zen", "ocean", "gold", "forest"]);
  const SOUND_PRESETS = [
    { file: "sound_1.mp3", label: "清亮" },
    { file: "sound_2.mp3", label: "浑厚" },
    { file: "sound_3.mp3", label: "高音" },
    { file: "sound_4.mp3", label: "低沉" },
    { file: "sound_5.mp3", label: "回响" },
    { file: "sound_6.mp3", label: "短促" },
  ];
  const SOUND_FILES = SOUND_PRESETS.map((p) => p.file);
  /** 造型与音效来自 jwenjian/wooden-fish（fork Ares-Chang/wooden-fish，MIT） */
  const FISH_ART_VER = "jwenjian";

  function assetUrl(name) {
    const v = window.TOOLS_BUILD || "";
    return `./assets/muyu/${name}${v ? `?v=${encodeURIComponent(v)}` : ""}`;
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
  let soundVariant = 0;
  let audioCtx = null;
  let webAudioReady = false;
  /** @type {(AudioBuffer|null)[]} */
  let knockBuffers = [];
  let knockDecodePromise = null;
  let knockPools = [];
  let htmlKnockCursor = 0;
  let htmlAudioPrimed = false;
  let knockAudioReady = false;
  let syncingSound = false;
  let fsBgCanvas = null;
  let fsBgCtx = null;
  let fsBgRaf = 0;
  let fsBgRunning = false;
  let fsPulseEl = null;
  let fsRippleEl = null;
  let fsFxEl = null;
  let fsFloatsEl = null;
  let fsBgStars = [];
  let fsBgDust = [];
  let fsBgSparks = [];
  let fsBgT = 0;
  let themeId = "zen";
  let customPhrasesRaw = "";
  let comboCount = 0;
  let comboTimer = 0;
  let stageRoot = null;
  let stageBgCanvas = null;
  let stageBgCtx = null;
  let stageBgRaf = 0;
  let stageBgRunning = false;
  let stageRippleEl = null;
  let stageFxEl = null;
  let stageFloatsEl = null;
  let stageBgStars = [];
  let stageBgDust = [];
  let stageBgSparks = [];
  let stageBgT = 0;
  let themeSelect = null;
  let phrasesInput = null;
  let soundVariantSelect = null;

  function ensureAudio() {
    if (audioCtx) return audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
    return audioCtx;
  }

  function decodeKnockBuffers() {
    if (knockDecodePromise) return knockDecodePromise;
    knockDecodePromise = (async () => {
      const ac = ensureAudio();
      if (!ac) return;
      await Promise.all(
        SOUND_FILES.map(async (file, idx) => {
          if (knockBuffers[idx]) return;
          try {
            const res = await fetch(assetUrl(file));
            if (!res.ok) return;
            const ab = await res.arrayBuffer();
            knockBuffers[idx] = await ac.decodeAudioData(ab.slice(0));
          } catch (_) {
            /* fallback to HTML Audio */
          }
        })
      );
    })();
    return knockDecodePromise;
  }

  function initKnockAudio() {
    SOUND_FILES.forEach((file, idx) => {
      if (knockPools[idx]?.length) return;
      const uri = assetUrl(file);
      knockPools[idx] = Array.from({ length: HTML_POOL_SIZE }, () => {
        const a = new Audio(uri);
        a.preload = "auto";
        return a;
      });
    });
  }

  function preloadKnockAudio() {
    initKnockAudio();
    if (knockAudioReady) return;
    const all = knockPools.flat();
    if (!all.length) return;
    let pending = all.length;
    const done = () => {
      pending -= 1;
      if (pending <= 0) knockAudioReady = true;
    };
    all.forEach((a) => {
      const finish = () => done();
      if (a.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
        finish();
        return;
      }
      a.addEventListener("canplaythrough", finish, { once: true });
      a.addEventListener("error", finish, { once: true });
      try {
        a.load();
      } catch (_) {
        finish();
      }
    });
  }

  function unlockMuyuAudio() {
    if (!soundOn) return Promise.resolve();
    initKnockAudio();
    preloadKnockAudio();
    const decode = decodeKnockBuffers();
    const ac = ensureAudio();
    const resume =
      ac && ac.state === "suspended"
        ? ac
            .resume()
            .then(() => {
              webAudioReady = ac.state === "running";
            })
            .catch(() => {
              webAudioReady = false;
            })
        : Promise.resolve().then(() => {
            if (ac) webAudioReady = ac.state === "running";
          });
    if (!htmlAudioPrimed && !webAudioReady) {
      htmlAudioPrimed = true;
      const prime = new Audio(assetUrl(SOUND_FILES[soundVariant] || SOUND_FILES[0]));
      prime.volume = 0.0001;
      const p = prime.play();
      if (p && typeof p.catch === "function") p.catch(() => {});
    }
    return Promise.all([decode, resume]).then(() => {});
  }

  function playKnockWeb() {
    const buf = knockBuffers[soundVariant] || knockBuffers[0];
    const ac = ensureAudio();
    if (!buf || !ac || ac.state !== "running") return false;
    try {
      const src = ac.createBufferSource();
      src.buffer = buf;
      const gain = ac.createGain();
      gain.gain.value = 0.85;
      src.connect(gain);
      gain.connect(ac.destination);
      src.start(0);
      return true;
    } catch (_) {
      return false;
    }
  }

  function playKnockHtml() {
    initKnockAudio();
    const pool = knockPools[soundVariant] || knockPools[0];
    if (!pool?.length) return false;
    const a = pool[htmlKnockCursor % HTML_POOL_SIZE];
    htmlKnockCursor += 1;
    a.volume = 0.85;
    try {
      a.pause();
      a.currentTime = 0;
    } catch (_) {}
    const p = a.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
    return true;
  }

  function playKnock() {
    if (!soundOn) return;
    if (!playKnockWeb()) playKnockHtml();
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

  function pointerFromEvent(ev, fallbackEl) {
    if (ev) {
      if (ev.type === "touchend" && ev.changedTouches?.length) {
        const t = ev.changedTouches[0];
        if (Number.isFinite(t.clientX) && Number.isFinite(t.clientY)) {
          return { x: t.clientX, y: t.clientY };
        }
      }
      if (ev.type === "touchstart" && ev.touches?.length) {
        const t = ev.touches[0];
        if (Number.isFinite(t.clientX) && Number.isFinite(t.clientY)) {
          return { x: t.clientX, y: t.clientY };
        }
      }
      if (Number.isFinite(ev.clientX) && Number.isFinite(ev.clientY)) {
        return { x: ev.clientX, y: ev.clientY };
      }
    }
    if (fallbackEl) {
      const r = fallbackEl.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }
    return null;
  }

  function spawnRippleAt(container, localX, localY) {
    if (!container || !Number.isFinite(localX) || !Number.isFinite(localY)) return;
    const el = document.createElement("span");
    el.className = "muyu-hit-ripple";
    el.style.left = `${localX}px`;
    el.style.top = `${localY}px`;
    el.setAttribute("aria-hidden", "true");
    container.appendChild(el);
    void el.offsetWidth;
    el.classList.add("is-go");
    el.addEventListener("animationend", () => el.remove(), { once: true });
    window.setTimeout(() => el.remove(), 600);
  }

  function burstSparks(sparks, stageEl, limit = 180, localCoords = false, at = null) {
    if (!stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    let cx;
    let cy;
    if (at && Number.isFinite(at.x) && Number.isFinite(at.y)) {
      cx = localCoords ? at.x : at.x;
      cy = localCoords ? at.y : at.y;
    } else if (localCoords) {
      cx = rect.width / 2;
      cy = rect.height * 0.46;
    } else {
      cx = rect.left + rect.width / 2;
      cy = rect.top + rect.height * 0.46;
    }
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
    stageFxEl = document.getElementById("muyu-stage-fx");
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
    fsFxEl = document.getElementById("muyu-fs-fx");
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

  function burstFsSparks(at) {
    burstSparks(fsBgSparks, document.getElementById("muyu-fs-stage"), 180, false, at);
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

  function playKnockImmediate() {
    if (!soundOn) return;
    if (playKnockWeb()) return;
    if (playKnockHtml()) return;
    void unlockMuyuAudio().then(() => {
      if (!playKnockWeb()) playKnockHtml();
    });
  }

  function playKnockFx(ev) {
    const fishEl = fullscreen ? fishFsBtn : fishBtn;
    const pt = pointerFromEvent(ev, fishEl);
    const fxEl = fullscreen ? fsRoot : stageFxEl || stageRoot;
    if (fxEl && pt) {
      const rect = fxEl.getBoundingClientRect();
      spawnRippleAt(fxEl, pt.x - rect.left, pt.y - rect.top);
    }
    if (fullscreen) {
      if (fsPulseEl) {
        fsPulseEl.classList.remove("is-flash");
        void fsPulseEl.offsetWidth;
        fsPulseEl.classList.add("is-flash");
      }
      spawnFloat(fsFloatsEl);
      burstFsSparks(pt);
    } else {
      spawnFloat(stageFloatsEl);
      if (pt) {
        const rect = (stageRoot || fishBtn).getBoundingClientRect();
        burstSparks(stageBgSparks, stageRoot || fishBtn, 80, true, {
          x: pt.x - rect.left,
          y: pt.y - rect.top,
        });
      } else {
        burstSparks(stageBgSparks, stageRoot || fishBtn, 80, true);
      }
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
      if (Number.isFinite(data.soundVariant) && data.soundVariant >= 0 && data.soundVariant < SOUND_FILES.length) {
        soundVariant = Math.floor(data.soundVariant);
      }
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
          soundVariant,
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
    if (soundOn) void unlockMuyuAudio();
  }

  function mountFishArt(btn) {
    if (!btn || btn.dataset.art === FISH_ART_VER) return;
    btn.dataset.art = FISH_ART_VER;
    btn.replaceChildren();
    const img = document.createElement("img");
    img.className = "muyu-fish-img";
    img.src = assetUrl("WoodenFish.svg");
    img.alt = "";
    img.draggable = false;
    img.setAttribute("aria-hidden", "true");
    btn.appendChild(img);
  }

  function bumpFish(el) {
    if (!el) return;
    el.classList.remove("is-knocking");
    void el.offsetWidth;
    el.classList.add("is-knocking");
    window.setTimeout(() => el.classList.remove("is-knocking"), 320);
  }

  function knock(fromEl, ev) {
    count += 1;
    renderCount();
    saveState();
    void unlockMuyuAudio();
    playKnockImmediate();
    bumpFish(fromEl || (fullscreen ? fishFsBtn : fishBtn));
    playKnockFx(ev);
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

  function populateSoundSelect() {
    if (!soundVariantSelect) return;
    soundVariantSelect.replaceChildren();
    SOUND_PRESETS.forEach((p, i) => {
      const opt = document.createElement("option");
      opt.value = String(i);
      opt.textContent = p.label;
      soundVariantSelect.appendChild(opt);
    });
    soundVariant = Math.min(Math.max(0, soundVariant), SOUND_PRESETS.length - 1);
    soundVariantSelect.value = String(soundVariant);
  }

  function isFsUiTarget(el) {
    return !!el?.closest?.(".muyu-fs-close, .muyu-fs-sound");
  }

  function bindFsKnockArea() {
    const fs = fsRoot || document.getElementById("muyu-fs");
    if (!fs || fs.dataset.knockAreaBound === "1") return;
    fs.dataset.knockAreaBound = "1";
    let touchHandled = false;
    fs.addEventListener(
      "touchend",
      (e) => {
        if (!fullscreen) return;
        if (isFsUiTarget(e.target)) return;
        e.preventDefault();
        touchHandled = true;
        window.setTimeout(() => {
          touchHandled = false;
        }, 450);
        void unlockMuyuAudio();
        knock(fishFsBtn, e);
      },
      { passive: false }
    );
    fs.addEventListener("click", (e) => {
      if (!fullscreen) return;
      if (isFsUiTarget(e.target)) return;
      if (touchHandled) return;
      void unlockMuyuAudio();
      knock(fishFsBtn, e);
    });
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
        void unlockMuyuAudio();
        knock(btn, e);
      },
      { passive: false }
    );
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      if (touchHandled) return;
      void unlockMuyuAudio();
      knock(btn, e);
    });
  }

  function bindControls() {
    bindKnock(fishBtn);
    bindFsKnockArea();

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

    soundVariantSelect?.addEventListener("change", () => {
      const n = Number(soundVariantSelect.value);
      soundVariant = Number.isFinite(n) && n >= 0 && n < SOUND_FILES.length ? Math.floor(n) : 0;
      saveState();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === " " && isMuyuRoute()) {
        const tag = String(e.target?.tagName || "").toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select" || e.target?.isContentEditable) return;
        e.preventDefault();
        void unlockMuyuAudio();
        knock(fullscreen ? fishFsBtn : fishBtn, e);
      }
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
    bindFsKnockArea();
  }

  function mountFishArtEarly() {
    mountFishArt(document.getElementById("muyu-fish"));
    mountFishArt(document.getElementById("muyu-fish-fs"));
  }

  function bootMuyuShell() {
    bindFsShell();
    mountFishArtEarly();
    initFsBg();
    initStageBg();
    decodeKnockBuffers();
    initKnockAudio();
    preloadKnockAudio();
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
    soundVariantSelect = $("#muyu-sound-variant");
    stageRoot = $("#muyu-stage");

    mountFishArt(fishBtn);
    mountFishArt(fishFsBtn);
    bindFsShell();
    initStageBg();

    loadState();
    applyTheme(themeId);
    if (phrasesInput) phrasesInput.value = customPhrasesRaw;
    populateSoundSelect();
    syncSoundToggles();
    renderCount();
    initKnockAudio();
    preloadKnockAudio();
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
