(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  const STORAGE_KEY = "devtools-piano-v1";
  /** 标准 88 键：A0–C8 */
  const FIRST = 21;
  const LAST = 108;
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  /**
   * 黑键几何来自 kevinsqi/react-piano Key.js（MIT）：
   * 不是「上一白键 + 固定 0.68」，而是按 C#/D# 一组、F#/G#/A# 一组的真实位置。
   */
  const PITCH_POS = {
    C: 0,
    "C#": 0.55,
    D: 1,
    "D#": 1.8,
    E: 2,
    F: 3,
    "F#": 3.5,
    G: 4,
    "G#": 4.7,
    A: 5,
    "A#": 5.85,
    B: 6,
  };
  const ACCIDENTAL_WIDTH_RATIO = 0.65;
  const OCTAVE_MIN = -3;
  const OCTAVE_MAX = 3;
  /**
   * 电脑键盘：Z 行 C3、Q 行 C4、I 行 C5（互不重叠，约 2.5 个八度）。
   * octave 平移整组映射。
   */
  const KEY_BINDS = [
    { code: "KeyZ", label: "Z", midi: 48 },
    { code: "KeyS", label: "S", midi: 49 },
    { code: "KeyX", label: "X", midi: 50 },
    { code: "KeyD", label: "D", midi: 51 },
    { code: "KeyC", label: "C", midi: 52 },
    { code: "KeyV", label: "V", midi: 53 },
    { code: "KeyG", label: "G", midi: 54 },
    { code: "KeyB", label: "B", midi: 55 },
    { code: "KeyH", label: "H", midi: 56 },
    { code: "KeyN", label: "N", midi: 57 },
    { code: "KeyJ", label: "J", midi: 58 },
    { code: "KeyM", label: "M", midi: 59 },
    { code: "KeyQ", label: "Q", midi: 60 },
    { code: "Digit2", label: "2", midi: 61 },
    { code: "KeyW", label: "W", midi: 62 },
    { code: "Digit3", label: "3", midi: 63 },
    { code: "KeyE", label: "E", midi: 64 },
    { code: "KeyR", label: "R", midi: 65 },
    { code: "Digit5", label: "5", midi: 66 },
    { code: "KeyT", label: "T", midi: 67 },
    { code: "Digit6", label: "6", midi: 68 },
    { code: "KeyY", label: "Y", midi: 69 },
    { code: "Digit7", label: "7", midi: 70 },
    { code: "KeyU", label: "U", midi: 71 },
    { code: "KeyI", label: "I", midi: 72 },
    { code: "Digit9", label: "9", midi: 73 },
    { code: "KeyO", label: "O", midi: 74 },
    { code: "Digit0", label: "0", midi: 75 },
    { code: "KeyP", label: "P", midi: 76 },
    { code: "BracketLeft", label: "[", midi: 77 },
    { code: "Minus", label: "-", midi: 78 },
    { code: "BracketRight", label: "]", midi: 79 },
    { code: "Equal", label: "=", midi: 80 },
    { code: "Backslash", label: "\\", midi: 81 },
    { code: "Quote", label: "'", midi: 82 },
  ];
  const HINT_KEYS =
    "电脑键盘：Z 行 C3、Q 行 C4、I 行 C5（约 2.5 八度）；↑↓ 移八度，空格延音。按键越靠下力度越大。";
  const SF_SCRIPT = "https://cdn.jsdelivr.net/npm/soundfont-player@0.12.0/dist/soundfont-player.min.js";
  const SF_FONT = (name, sf, format) =>
    `https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@gh-pages/${sf}/${name}-${format}.js`;
  const DEFAULT_VEL = 0.82;

  const SONGS = {
    twinkle: {
      bpm: 96,
      notes: [
        [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
        [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
        [67, 1], [67, 1], [65, 1], [65, 1], [64, 1], [64, 1], [62, 2],
        [67, 1], [67, 1], [65, 1], [65, 1], [64, 1], [64, 1], [62, 2],
        [60, 1], [60, 1], [67, 1], [67, 1], [69, 1], [69, 1], [67, 2],
        [65, 1], [65, 1], [64, 1], [64, 1], [62, 1], [62, 1], [60, 2],
      ],
    },
    ode: {
      bpm: 108,
      notes: [
        [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1],
        [60, 1], [60, 1], [62, 1], [64, 1], [64, 1.5], [62, 0.5], [62, 2],
        [64, 1], [64, 1], [65, 1], [67, 1], [67, 1], [65, 1], [64, 1], [62, 1],
        [60, 1], [60, 1], [62, 1], [64, 1], [62, 1.5], [60, 0.5], [60, 2],
      ],
    },
  };

  let bound = false;
  let engine = "synth";
  let volume = 0.72;
  let octave = 0;
  let sustainStick = false;
  let sustainHeld = false;
  let audioCtx = null;
  let master = null;
  let acoustic = null;
  let acousticLoading = null;
  let demoTimer = 0;
  let demoPlaying = false;
  let noiseBuf = null;

  const held = new Set();
  const pointerNotes = new Map();
  const keyNotes = new Map();
  const voices = new Map();
  const keyVel = new Map();

  function isAccidental(midi) {
    return [1, 3, 6, 8, 10].includes(midi % 12);
  }

  function midiName(midi) {
    return `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
  }

  function clampMidi(n) {
    return Math.max(FIRST, Math.min(LAST, n));
  }

  function hotkeyMap() {
    const byCode = new Map();
    const inv = new Map();
    for (const b of KEY_BINDS) {
      const midi = b.midi + octave * 12;
      if (midi < FIRST || midi > LAST) continue;
      byCode.set(b.code, midi);
      if (!inv.has(midi)) inv.set(midi, b.label);
    }
    return { byCode, inv };
  }

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

  function setStatus(text) {
    const el = $("#piano-status");
    if (el) el.textContent = text;
  }

  function loadPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (raw.engine === "acoustic" || raw.engine === "synth") engine = raw.engine;
      if (Number.isFinite(raw.volume)) volume = Math.max(0, Math.min(1, raw.volume));
      if (Number.isFinite(raw.octave)) octave = Math.max(OCTAVE_MIN, Math.min(OCTAVE_MAX, Math.round(raw.octave)));
      sustainStick = Boolean(raw.sustain);
    } catch (_) {
      /* ignore */
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ engine, volume, octave, sustain: sustainStick })
      );
    } catch (_) {
      /* ignore */
    }
  }

  function sustainOn() {
    return sustainStick || sustainHeld;
  }

  function getCtx() {
    if (audioCtx) return audioCtx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error("当前浏览器不支持 Web Audio");
    try {
      audioCtx = new AC({ latencyHint: "interactive" });
    } catch (_) {
      audioCtx = new AC();
    }
    master = audioCtx.createGain();
    master.gain.value = volume;
    master.connect(audioCtx.destination);
    return audioCtx;
  }

  function ensureNoiseBuf(ctx) {
    if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.028), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    noiseBuf = buf;
    return noiseBuf;
  }

  function unlockAudio() {
    try {
      const ctx = getCtx();
      if (master) master.gain.value = volume;
      if (ctx.state === "suspended") {
        const p = ctx.resume();
        if (p && typeof p.catch === "function") p.catch(() => {});
      }
      return ctx;
    } catch (_) {
      return null;
    }
  }

  function stopVoice(midi, quick) {
    const voice = voices.get(midi);
    if (!voice) return;
    voices.delete(midi);
    const now = audioCtx ? audioCtx.currentTime : 0;
    const rel = quick ? 0.04 : 0.14;
    try {
      if (voice.kind === "acoustic") {
        voice.node?.stop?.(now + (quick ? 0.01 : 0.03));
      } else {
        const g = voice.gain;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + rel);
        voice.oscs.forEach((o) => {
          try {
            o.stop(now + rel + 0.02);
          } catch (_) {}
        });
        window.setTimeout(() => {
          voice.oscs.forEach((o) => {
            try {
              o.disconnect();
            } catch (_) {}
          });
          try {
            g.disconnect();
          } catch (_) {}
        }, Math.ceil((rel + 0.05) * 1000));
      }
    } catch (_) {
      /* ignore */
    }
  }

  function startSynth(midi, velocity) {
    const ctx = getCtx();
    const now = ctx.currentTime;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const v = Math.max(0.2, Math.min(1, velocity == null ? DEFAULT_VEL : velocity));
    const rangeBoost = 0.2 + Math.min(1, (LAST - midi) / 40) * 0.1;
    const peak = (0.16 + v * 0.22) * (0.85 + rangeBoost);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.95;
    filter.frequency.setValueAtTime(700 + v * 3800, now);
    filter.frequency.exponentialRampToValueAtTime(380 + v * 120, now + 1.2);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.005);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.4), now + 0.18);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.2);

    const specs = [
      ["triangle", freq, 0.72],
      ["sine", freq * 2.003, 0.2],
      ["sine", freq * 3.01, 0.08],
    ];
    const oscs = specs.map(([type, f, mix]) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = mix;
      osc.connect(g);
      g.connect(filter);
      osc.start(now);
      osc.stop(now + 3.8);
      return osc;
    });

    const noise = ctx.createBufferSource();
    noise.buffer = ensureNoiseBuf(ctx);
    const ng = ctx.createGain();
    ng.gain.value = 0.03 + v * 0.035;
    const nf = ctx.createBiquadFilter();
    nf.type = "highpass";
    nf.frequency.value = 1400;
    noise.connect(nf);
    nf.connect(ng);
    ng.connect(filter);
    noise.start(now);

    filter.connect(gain);
    gain.connect(master);
    voices.set(midi, { kind: "synth", oscs, gain });
  }

  function startAcoustic(midi, velocity) {
    if (!acoustic) {
      startSynth(midi, velocity);
      return;
    }
    const v = Math.max(0.2, Math.min(1, velocity == null ? DEFAULT_VEL : velocity));
    const node = acoustic.play(midi, 0, {
      gain: (0.28 + volume * 0.85) * (0.55 + v * 0.7),
      attack: 0.004,
    });
    voices.set(midi, { kind: "acoustic", node });
  }

  function startVoice(midi, velocity) {
    if (voices.has(midi)) stopVoice(midi, true);
    if (engine === "acoustic" && acoustic) startAcoustic(midi, velocity);
    else startSynth(midi, velocity);
  }

  function noteOn(midi, velocity) {
    const n = clampMidi(midi);
    held.add(n);
    if (velocity != null) keyVel.set(n, velocity);
    paintKey(n, true);
    paintNow();
    try {
      unlockAudio();
      startVoice(n, velocity == null ? keyVel.get(n) : velocity);
    } catch (err) {
      setStatus(`无法发声：${err.message || err}`);
    }
  }

  function noteOff(midi) {
    const n = clampMidi(midi);
    held.delete(n);
    keyVel.delete(n);
    if (!sustainOn()) stopVoice(n);
    paintKey(n, false);
    paintNow();
  }

  function panicStop() {
    held.clear();
    pointerNotes.clear();
    keyNotes.clear();
    keyVel.clear();
    for (const midi of [...voices.keys()]) stopVoice(midi, true);
    paintKeys();
  }

  function applySustain(next) {
    const was = sustainOn();
    if (typeof next.stick === "boolean") sustainStick = next.stick;
    if (typeof next.held === "boolean") sustainHeld = next.held;
    if (was && !sustainOn()) {
      for (const midi of [...voices.keys()]) {
        if (!held.has(midi)) stopVoice(midi);
      }
    }
    paintKeys();
  }

  function paintNow() {
    const el = $("#piano-now");
    if (!el) return;
    const list = [...new Set([...voices.keys(), ...held])]
      .sort((a, b) => a - b)
      .map(midiName);
    el.textContent = list.length ? list.join(" · ") : "—";
  }

  function paintKey(midi, forceOn) {
    const kb = $("#piano-kb");
    const btn = kb?.querySelector(`[data-midi="${midi}"]`);
    if (!btn) return;
    const on = forceOn || voices.has(midi) || held.has(midi);
    btn.classList.toggle("is-active", on);
  }

  function paintKeys() {
    const kb = $("#piano-kb");
    if (!kb) return;
    kb.querySelectorAll("[data-midi]").forEach((btn) => {
      const midi = Number(btn.dataset.midi);
      btn.classList.toggle("is-active", voices.has(midi) || held.has(midi));
      const mapped = btn.dataset.mapped === "1";
      btn.classList.toggle("is-mapped", mapped);
    });
    paintNow();
  }

  function velocityFromPoint(clientY, el) {
    if (!el) return DEFAULT_VEL;
    const r = el.getBoundingClientRect();
    if (!r.height) return DEFAULT_VEL;
    const y = (clientY - r.top) / r.height;
    return 0.38 + Math.max(0, Math.min(1, y)) * 0.62;
  }

  function scrollKeyIntoView(midi) {
    const bed = $("#piano-bed");
    const kb = $("#piano-kb");
    const el = kb?.querySelector(`[data-midi="${midi}"]`);
    if (!bed || !el) return;
    const left = el.offsetLeft - Math.max(24, bed.clientWidth * 0.22);
    bed.scrollLeft = Math.max(0, left);
  }

  function midiOctave(midi) {
    return Math.floor(midi / 12) - 1;
  }

  function absKeyPos(midi) {
    return PITCH_POS[NAMES[midi % 12]] + 7 * midiOctave(midi);
  }

  function renderKeyboard() {
    const kb = $("#piano-kb");
    if (!kb) return;
    const { inv } = hotkeyMap();
    const whites = [];
    const keys = [];
    for (let m = FIRST; m <= LAST; m++) {
      if (isAccidental(m)) keys.push(m);
      else {
        whites.push(m);
        keys.push(m);
      }
    }
    const nWhite = whites.length;
    const origin = absKeyPos(FIRST);
    kb.style.setProperty("--piano-whites", String(nWhite));
    kb.replaceChildren();
    keys.forEach((midi) => {
      const sharp = isAccidental(midi);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = sharp ? "piano-black" : "piano-white";
      btn.dataset.midi = String(midi);
      btn.tabIndex = -1;
      btn.setAttribute("aria-label", midiName(midi));
      const left = (absKeyPos(midi) - origin) / nWhite;
      const width = (sharp ? ACCIDENTAL_WIDTH_RATIO : 1) / nWhite;
      btn.style.left = `${left * 100}%`;
      btn.style.width = `${width * 100}%`;
      if (!sharp && (midi % 12 === 0 || midi === FIRST || midi === LAST)) {
        const note = document.createElement("span");
        note.className = "piano-key-note";
        note.textContent = midiName(midi);
        btn.appendChild(note);
      }
      const hot = inv.get(midi);
      if (hot) {
        btn.dataset.mapped = "1";
        const k = document.createElement("span");
        k.className = "piano-key-hot";
        k.textContent = hot;
        btn.appendChild(k);
      }
      kb.appendChild(btn);
    });
    paintKeys();
    const mapped = [...hotkeyMap().byCode.values()].sort((a, b) => a - b);
    const focus = mapped.find((m) => m >= 60) || mapped[0] || 60;
    requestAnimationFrame(() => scrollKeyIntoView(focus));
  }

  function keyElFromPoint(x, y) {
    const stack = document.elementsFromPoint(x, y);
    for (const el of stack) {
      if (el.classList?.contains("piano-black") || el.classList?.contains("piano-white")) {
        return el;
      }
    }
    return null;
  }

  function midiFromPoint(x, y) {
    const el = keyElFromPoint(x, y);
    if (!el) return null;
    const n = Number(el.dataset.midi);
    return Number.isFinite(n) ? n : null;
  }

  function bindPointer(kb) {
    const bed = $("#piano-bed");
    const warm = () => {
      unlockAudio();
    };
    bed?.addEventListener("pointerenter", warm, { passive: true });
    kb.addEventListener("pointerdown", (e) => {
      const el = keyElFromPoint(e.clientX, e.clientY);
      const midi = el ? Number(el.dataset.midi) : null;
      if (midi == null || !Number.isFinite(midi)) return;
      e.preventDefault();
      try {
        kb.setPointerCapture(e.pointerId);
      } catch (_) {}
      const vel = velocityFromPoint(e.clientY, el);
      unlockAudio();
      pointerNotes.set(e.pointerId, midi);
      noteOn(midi, vel);
    });
    kb.addEventListener("pointermove", (e) => {
      if (!pointerNotes.has(e.pointerId)) return;
      const el = keyElFromPoint(e.clientX, e.clientY);
      const midi = el ? Number(el.dataset.midi) : null;
      const prev = pointerNotes.get(e.pointerId);
      if (midi == null || !Number.isFinite(midi) || midi === prev) return;
      pointerNotes.set(e.pointerId, midi);
      noteOff(prev);
      noteOn(midi, velocityFromPoint(e.clientY, el));
    });
    const end = (e) => {
      const prev = pointerNotes.get(e.pointerId);
      if (prev == null) return;
      pointerNotes.delete(e.pointerId);
      noteOff(prev);
    };
    kb.addEventListener("pointerup", end);
    kb.addEventListener("pointercancel", end);
    kb.addEventListener("lostpointercapture", end);
  }

  function isTypingTarget(el) {
    if (!el) return false;
    const tag = String(el.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea" || tag === "select") return true;
    return Boolean(el.isContentEditable);
  }

  function shiftOctave(delta) {
    const next = Math.max(OCTAVE_MIN, Math.min(OCTAVE_MAX, octave + delta));
    if (next === octave) return;
    octave = next;
    savePrefs();
    syncControls();
    renderKeyboard();
  }

  function onKeyDown(e) {
    if (!$("#piano")?.classList.contains("is-workspace-active")) return;
    if (isTypingTarget(e.target)) return;
    if (e.code === "Space") {
      e.preventDefault();
      if (!e.repeat) {
        unlockAudio();
        applySustain({ held: true });
      }
      return;
    }
    if (e.code === "ArrowUp" || e.code === "ArrowRight") {
      e.preventDefault();
      if (!e.repeat) shiftOctave(1);
      return;
    }
    if (e.code === "ArrowDown" || e.code === "ArrowLeft") {
      e.preventDefault();
      if (!e.repeat) shiftOctave(-1);
      return;
    }
    const { byCode } = hotkeyMap();
    const midi = byCode.get(e.code);
    if (midi == null) return;
    e.preventDefault();
    if (e.repeat || keyNotes.has(e.code)) return;
    unlockAudio();
    keyNotes.set(e.code, midi);
    noteOn(midi, DEFAULT_VEL);
  }

  function onKeyUp(e) {
    if (e.code === "Space") {
      applySustain({ held: false });
      return;
    }
    const midi = keyNotes.get(e.code);
    if (midi == null) return;
    keyNotes.delete(e.code);
    noteOff(midi);
  }

  function releaseAllKeyboard() {
    for (const midi of [...keyNotes.values()]) noteOff(midi);
    keyNotes.clear();
    if (sustainHeld) applySustain({ held: false });
  }

  function loadScriptOnce(src) {
    if (loadScriptOnce._p && loadScriptOnce._src === src) return loadScriptOnce._p;
    loadScriptOnce._src = src;
    loadScriptOnce._p = new Promise((resolve, reject) => {
      if (window.Soundfont) {
        resolve();
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("soundfont-player 脚本加载失败"));
      document.head.appendChild(s);
    });
    return loadScriptOnce._p;
  }

  async function ensureAcoustic() {
    if (acoustic) return acoustic;
    if (acousticLoading) return acousticLoading;
    setStatus("正在加载三角钢琴采样（约数 MB，需访问 jsDelivr）…");
    acousticLoading = (async () => {
      unlockAudio();
      const ctx = getCtx();
      if (ctx.state === "suspended") await ctx.resume();
      await loadScriptOnce(SF_SCRIPT);
      if (!window.Soundfont?.instrument) throw new Error("Soundfont 不可用");
      acoustic = await window.Soundfont.instrument(getCtx(), "acoustic_grand_piano", {
        soundfont: "MusyngKite",
        format: "mp3",
        nameToUrl: SF_FONT,
        destination: master,
      });
      setStatus(`三角钢琴采样已就绪。${HINT_KEYS}`);
      toast("采样已加载");
      return acoustic;
    })().catch((err) => {
      acousticLoading = null;
      engine = "synth";
      const sel = $("#piano-engine");
      if (sel) sel.value = "synth";
      savePrefs();
      setStatus(`采样加载失败，已回退合成器：${err.message || err}`);
      throw err;
    });
    return acousticLoading;
  }

  function stopDemo() {
    demoPlaying = false;
    if (demoTimer) {
      window.clearTimeout(demoTimer);
      demoTimer = 0;
    }
    const stopBtn = $("#piano-demo-stop");
    if (stopBtn) stopBtn.hidden = true;
    panicStop();
  }

  async function playDemo(id) {
    const song = SONGS[id];
    if (!song) return;
    stopDemo();
    unlockAudio();
    const ctx = getCtx();
    if (ctx.state === "suspended") await ctx.resume().catch(() => {});
    if (engine === "acoustic") {
      try {
        await ensureAcoustic();
      } catch (_) {}
    }
    demoPlaying = true;
    const stopBtn = $("#piano-demo-stop");
    if (stopBtn) stopBtn.hidden = false;
    const beat = 60000 / song.bpm;
    let i = 0;
    const step = () => {
      if (!demoPlaying) return;
      if (i >= song.notes.length) {
        demoPlaying = false;
        if (stopBtn) stopBtn.hidden = true;
        panicStop();
        return;
      }
      const [midi, beats] = song.notes[i++];
      noteOn(midi);
      const dur = Math.max(80, beat * beats * 0.92);
      window.setTimeout(() => noteOff(midi), dur * 0.88);
      demoTimer = window.setTimeout(step, dur);
    };
    step();
  }

  function syncControls() {
    const eng = $("#piano-engine");
    const vol = $("#piano-vol");
    const volN = $("#piano-vol-num");
    const oct = $("#piano-oct-label");
    const sus = $("#piano-sustain");
    if (eng) eng.value = engine;
    const pct = Math.round(volume * 100);
    if (vol) vol.value = String(pct);
    if (volN) volN.textContent = `${pct}%`;
    if (oct) oct.textContent = octave === 0 ? "0" : octave > 0 ? `+${octave}` : String(octave);
    if (sus) sus.checked = sustainStick;
  }

  async function bind() {
    if (!$("#piano")) return;
    if (bound) {
      renderKeyboard();
      syncControls();
      return;
    }
    bound = true;
    loadPrefs();
    renderKeyboard();
    syncControls();
    setStatus(`88 键 A0–C8，可左右滑动。高亮键为电脑键盘区。${HINT_KEYS}`);
    bindPointer($("#piano-kb"));

    $("#piano-engine")?.addEventListener("change", async (e) => {
      engine = e.target.value === "acoustic" ? "acoustic" : "synth";
      savePrefs();
      if (engine === "acoustic") {
        try {
          await ensureAcoustic();
        } catch (_) {}
      } else {
        setStatus(`合成器已就绪（离线可用）。${HINT_KEYS}`);
      }
    });
    $("#piano-vol")?.addEventListener("input", (e) => {
      volume = Math.max(0, Math.min(1, Number(e.target.value) / 100));
      if (master) master.gain.value = volume;
      syncControls();
      savePrefs();
    });
    $("#piano-oct-down")?.addEventListener("click", () => shiftOctave(-1));
    $("#piano-oct-up")?.addEventListener("click", () => shiftOctave(1));
    $("#piano-goto-c4")?.addEventListener("click", () => {
      scrollKeyIntoView(60);
      unlockAudio();
    });
    $("#piano-sustain")?.addEventListener("change", (e) => {
      applySustain({ stick: Boolean(e.target.checked) });
      savePrefs();
    });
    $("#piano-demo-twinkle")?.addEventListener("click", () => playDemo("twinkle"));
    $("#piano-demo-ode")?.addEventListener("click", () => playDemo("ode"));
    $("#piano-demo-stop")?.addEventListener("click", stopDemo);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseAllKeyboard);
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) releaseAllKeyboard();
    });

    if (engine === "acoustic") {
      ensureAcoustic().catch(() => {});
    }
  }

  function onRoute(e) {
    const tool = e.detail?.tool;
    if (tool === "piano") {
      bind();
      return;
    }
    stopDemo();
    panicStop();
  }

  bind();
  document.addEventListener("devtools:route", onRoute);

  window.PianoTool = {
    midiName,
    isAccidental,
    first: FIRST,
    last: LAST,
    keyBinds: KEY_BINDS,
  };
})();
