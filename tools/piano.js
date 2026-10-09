(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  const STORAGE_KEY = "devtools-piano-v2";
  /** 标准 88 键：A0–C8 */
  const FIRST_88 = 21;
  const LAST_88 = 108;
  const FIRST_61 = 36; // C2
  const LAST_61 = 96; // C7
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  /**
   * 黑键几何来自 kevinsqi/react-piano Key.js（MIT）：
   * 按 C#/D# 一组、F#/G#/A# 一组的真实位置，而非固定偏移。
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
  const DEFAULT_VEL = 0.82;
  const SF_SCRIPT = "https://cdn.jsdelivr.net/npm/soundfont-player@0.12.0/dist/soundfont-player.min.js";
  const SF_FONT = (name, sf, format) =>
    `https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@gh-pages/${sf}/${name}-${format}.js`;

  /**
   * VirtualPiano / AutoPiano 字母谱白键序列（数字行→字母行→底行）。
   * Shift + 白键 = 该白键上方的升号（若存在）。
   */
  const VP_WHITES = [
    { code: "Digit1", label: "1" },
    { code: "Digit2", label: "2" },
    { code: "Digit3", label: "3" },
    { code: "Digit4", label: "4" },
    { code: "Digit5", label: "5" },
    { code: "Digit6", label: "6" },
    { code: "Digit7", label: "7" },
    { code: "Digit8", label: "8" },
    { code: "Digit9", label: "9" },
    { code: "Digit0", label: "0" },
    { code: "KeyQ", label: "Q" },
    { code: "KeyW", label: "W" },
    { code: "KeyE", label: "E" },
    { code: "KeyR", label: "R" },
    { code: "KeyT", label: "T" },
    { code: "KeyY", label: "Y" },
    { code: "KeyU", label: "U" },
    { code: "KeyI", label: "I" },
    { code: "KeyO", label: "O" },
    { code: "KeyP", label: "P" },
    { code: "KeyA", label: "A" },
    { code: "KeyS", label: "S" },
    { code: "KeyD", label: "D" },
    { code: "KeyF", label: "F" },
    { code: "KeyG", label: "G" },
    { code: "KeyH", label: "H" },
    { code: "KeyJ", label: "J" },
    { code: "KeyK", label: "K" },
    { code: "KeyL", label: "L" },
    { code: "KeyZ", label: "Z" },
    { code: "KeyX", label: "X" },
    { code: "KeyC", label: "C" },
    { code: "KeyV", label: "V" },
    { code: "KeyB", label: "B" },
    { code: "KeyN", label: "N" },
    { code: "KeyM", label: "M" },
  ];
  const VP_BASE = 36; // C2

  /**
   * 钢琴家布局：react-piano KeyboardShortcuts 思路（BOTTOM + QWERTY 两排）。
   * Z 行 ≈ C4，Q 行 ≈ C5；黑键落在上行/数字键。
   */
  const PIANO_BINDS = [
    // Q 行在前：与 Z 行重叠的 C5–E5 优先标 Q/2/W…
    { code: "KeyQ", label: "Q", midi: 72 },
    { code: "Digit2", label: "2", midi: 73 },
    { code: "KeyW", label: "W", midi: 74 },
    { code: "Digit3", label: "3", midi: 75 },
    { code: "KeyE", label: "E", midi: 76 },
    { code: "KeyR", label: "R", midi: 77 },
    { code: "Digit5", label: "5", midi: 78 },
    { code: "KeyT", label: "T", midi: 79 },
    { code: "Digit6", label: "6", midi: 80 },
    { code: "KeyY", label: "Y", midi: 81 },
    { code: "Digit7", label: "7", midi: 82 },
    { code: "KeyU", label: "U", midi: 83 },
    { code: "KeyI", label: "I", midi: 84 },
    { code: "Digit9", label: "9", midi: 85 },
    { code: "KeyO", label: "O", midi: 86 },
    { code: "Digit0", label: "0", midi: 87 },
    { code: "KeyP", label: "P", midi: 88 },
    { code: "KeyZ", label: "Z", midi: 60 },
    { code: "KeyS", label: "S", midi: 61 },
    { code: "KeyX", label: "X", midi: 62 },
    { code: "KeyD", label: "D", midi: 63 },
    { code: "KeyC", label: "C", midi: 64 },
    { code: "KeyV", label: "V", midi: 65 },
    { code: "KeyG", label: "G", midi: 66 },
    { code: "KeyB", label: "B", midi: 67 },
    { code: "KeyH", label: "H", midi: 68 },
    { code: "KeyN", label: "N", midi: 69 },
    { code: "KeyJ", label: "J", midi: 70 },
    { code: "KeyM", label: "M", midi: 71 },
    { code: "Comma", label: ",", midi: 72 },
    { code: "KeyL", label: "L", midi: 73 },
    { code: "Period", label: ".", midi: 74 },
    { code: "Semicolon", label: ";", midi: 75 },
    { code: "Slash", label: "/", midi: 76 },
  ];

  const GUIDE_ROWS_VIRTUAL = [
    ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"],
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
    ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
    ["Z", "X", "C", "V", "B", "N", "M"],
  ];
  const GUIDE_ROWS_PIANO = [
    ["2", "3", "", "5", "6", "7", "", "9", "0"],
    ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
    ["", "S", "D", "", "G", "H", "J", "", "L", ";"],
    ["Z", "X", "C", "V", "B", "N", "M", ",", ".", "/"],
  ];

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
  let layout = "virtual";
  let rangeMode = "auto";
  let engine = "synth";
  let labels = "hot";
  let volume = 0.72;
  let octave = 0;
  let sustainStick = false;
  let sustainHeld = false;
  let audioCtx = null;
  let master = null;
  let compressor = null;
  let acoustic = null;
  let acousticLoading = null;
  let demoTimer = 0;
  let demoPlaying = false;
  let noiseBuf = null;
  let midiAccess = null;
  let midiInputId = "";
  let midiHandler = null;

  const held = new Set();
  const pointerNotes = new Map();
  const keyNotes = new Map();
  const voices = new Map();
  const keyVel = new Map();
  const guideTimers = new Map();

  function isAccidental(midi) {
    return [1, 3, 6, 8, 10].includes(midi % 12);
  }

  function midiName(midi) {
    return `${NAMES[midi % 12]}${Math.floor(midi / 12) - 1}`;
  }

  function clampMidi(n) {
    return Math.max(FIRST_88, Math.min(LAST_88, n));
  }

  function nextWhite(midi) {
    let m = midi + 1;
    while (m <= LAST_88 && isAccidental(m)) m += 1;
    return m;
  }

  function sharpOfWhite(midi) {
    if (isAccidental(midi)) return null;
    const sharp = midi + 1;
    if (sharp > LAST_88 || !isAccidental(sharp)) return null;
    return sharp;
  }

  function buildVirtualBinds(oct) {
    const binds = [];
    let midi = VP_BASE + oct * 12;
    for (const w of VP_WHITES) {
      if (midi < FIRST_88 || midi > LAST_88) break;
      binds.push({ code: w.code, label: w.label, midi, sharp: false });
      const sh = sharpOfWhite(midi);
      if (sh != null) {
        binds.push({
          code: w.code,
          label: w.label.toUpperCase() === w.label ? `⇧${w.label}` : w.label.toUpperCase(),
          midi: sh,
          sharp: true,
          shift: true,
        });
      }
      midi = nextWhite(midi);
    }
    return binds;
  }

  function buildPianoBinds(oct) {
    return PIANO_BINDS.map((b) => ({
      ...b,
      midi: b.midi + oct * 12,
      sharp: isAccidental(b.midi),
      shift: false,
    })).filter((b) => b.midi >= FIRST_88 && b.midi <= LAST_88);
  }

  function currentBinds() {
    return layout === "piano" ? buildPianoBinds(octave) : buildVirtualBinds(octave);
  }

  function hotkeyMap() {
    const byCode = new Map(); // code -> { white?, sharp? } or for piano code -> midi
    const inv = new Map(); // midi -> label
    const binds = currentBinds();
    if (layout === "virtual") {
      for (const b of binds) {
        let slot = byCode.get(b.code);
        if (!slot) {
          slot = {};
          byCode.set(b.code, slot);
        }
        if (b.shift) slot.sharp = b.midi;
        else slot.natural = b.midi;
        if (!inv.has(b.midi)) inv.set(b.midi, b.label);
      }
    } else {
      for (const b of binds) {
        byCode.set(b.code, b.midi);
        if (!inv.has(b.midi)) inv.set(b.midi, b.label);
      }
    }
    return { byCode, inv, binds };
  }

  function visibleRange() {
    if (rangeMode === "88") return { first: FIRST_88, last: LAST_88 };
    if (rangeMode === "61") return { first: FIRST_61, last: LAST_61 };
    const { inv } = hotkeyMap();
    const midis = [...inv.keys()].sort((a, b) => a - b);
    if (!midis.length) return { first: 48, last: 84 };
    let first = midis[0];
    let last = midis[midis.length - 1];
    while (first > FIRST_88 && isAccidental(first)) first -= 1;
    while (last < LAST_88 && isAccidental(last)) last += 1;
    // 两侧各扩一点白键边距
    first = Math.max(FIRST_88, first - 1);
    last = Math.min(LAST_88, last + 1);
    while (first > FIRST_88 && isAccidental(first)) first -= 1;
    while (last < LAST_88 && isAccidental(last)) last += 1;
    return { first, last };
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

  function hintText() {
    if (layout === "virtual") {
      return "VirtualPiano：数字/字母=白键，Shift+同键=升号；↑↓ 移八度，空格延音。可跟网上字母谱。";
    }
    return "钢琴家：Z 行 C4、Q 行 C5；黑键在 S/D/G… 与 2/3/5…；↑↓ 移八度，空格延音。";
  }

  function loadPrefs() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      if (raw.layout === "virtual" || raw.layout === "piano") layout = raw.layout;
      if (raw.range === "auto" || raw.range === "61" || raw.range === "88") rangeMode = raw.range;
      if (raw.engine === "acoustic" || raw.engine === "synth") engine = raw.engine;
      if (raw.labels === "hot" || raw.labels === "note" || raw.labels === "both" || raw.labels === "none") {
        labels = raw.labels;
      }
      if (Number.isFinite(raw.volume)) volume = Math.max(0, Math.min(1, raw.volume));
      if (Number.isFinite(raw.octave)) octave = Math.max(OCTAVE_MIN, Math.min(OCTAVE_MAX, Math.round(raw.octave)));
      sustainStick = Boolean(raw.sustain);
      if (typeof raw.midiInputId === "string") midiInputId = raw.midiInputId;
    } catch (_) {
      /* ignore */
    }
  }

  function savePrefs() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          layout,
          range: rangeMode,
          engine,
          labels,
          volume,
          octave,
          sustain: sustainStick,
          midiInputId,
        })
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
    compressor = audioCtx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.knee.value = 18;
    compressor.ratio.value = 3.2;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.12;
    master.connect(compressor);
    compressor.connect(audioCtx.destination);
    return audioCtx;
  }

  function ensureNoiseBuf(ctx) {
    if (noiseBuf && noiseBuf.sampleRate === ctx.sampleRate) return noiseBuf;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.03), ctx.sampleRate);
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
    const rel = quick ? 0.04 : 0.16;
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
    const v = Math.max(0.18, Math.min(1, velocity == null ? DEFAULT_VEL : velocity));
    const bright = 0.55 + v * 0.45;
    const peak = (0.14 + v * 0.24) * (0.9 + Math.min(1, (LAST_88 - midi) / 50) * 0.12);

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 0.85;
    filter.frequency.setValueAtTime(900 + bright * 4200, now);
    filter.frequency.exponentialRampToValueAtTime(320 + bright * 180, now + 1.4);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(peak, now + 0.004);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, peak * 0.42), now + 0.16);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.4);

    const specs = [
      ["triangle", freq, 0.62],
      ["sine", freq * 2.002, 0.22 * bright],
      ["sine", freq * 3.01, 0.09 * bright],
      ["sine", freq * 4.04, 0.04 * bright],
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
      osc.stop(now + 4);
      return osc;
    });

    const noise = ctx.createBufferSource();
    noise.buffer = ensureNoiseBuf(ctx);
    const ng = ctx.createGain();
    ng.gain.value = 0.028 + v * 0.04;
    const nf = ctx.createBiquadFilter();
    nf.type = "bandpass";
    nf.frequency.value = 1800 + v * 1200;
    nf.Q.value = 0.7;
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
    const v = Math.max(0.18, Math.min(1, velocity == null ? DEFAULT_VEL : velocity));
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
    for (const [midi, t] of guideTimers) {
      window.clearTimeout(t);
      guideTimers.delete(midi);
      $("#piano-kb")?.querySelector(`[data-midi="${midi}"]`)?.classList.remove("is-guide");
    }
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
      btn.classList.toggle("is-mapped", btn.dataset.mapped === "1");
    });
    paintNow();
  }

  function flashGuide(midi, ms = 420) {
    const btn = $("#piano-kb")?.querySelector(`[data-midi="${midi}"]`);
    if (!btn) return;
    btn.classList.add("is-guide");
    if (guideTimers.has(midi)) window.clearTimeout(guideTimers.get(midi));
    guideTimers.set(
      midi,
      window.setTimeout(() => {
        btn.classList.remove("is-guide");
        guideTimers.delete(midi);
      }, ms)
    );
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
    if (!bed || !el || kb.classList.contains("is-fill")) return;
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
    const { first, last } = visibleRange();
    const whites = [];
    const keys = [];
    for (let m = first; m <= last; m++) {
      if (isAccidental(m)) keys.push(m);
      else {
        whites.push(m);
        keys.push(m);
      }
    }
    const nWhite = whites.length || 1;
    const origin = absKeyPos(first);
    const fill = nWhite <= 40;
    kb.classList.toggle("is-fill", fill);
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
      const hot = inv.get(midi);
      if (hot) btn.dataset.mapped = "1";
      const showHot = (labels === "hot" || labels === "both") && hot;
      const showNoteAll = labels === "note" || labels === "both";
      const showNoteMark =
        !showNoteAll &&
        labels !== "none" &&
        !sharp &&
        (midi % 12 === 0 || midi === first || midi === last);
      if (showNoteAll || showNoteMark) {
        const note = document.createElement("span");
        note.className = "piano-key-note";
        note.textContent = midiName(midi);
        btn.appendChild(note);
      }
      if (showHot) {
        const k = document.createElement("span");
        k.className = "piano-key-hot";
        k.textContent = hot;
        btn.appendChild(k);
      }
      kb.appendChild(btn);
    });
    paintKeys();
    renderGuide();
    const mapped = [...inv.keys()].sort((a, b) => a - b);
    const focus = mapped.find((m) => m >= 60) || mapped[0] || 60;
    requestAnimationFrame(() => scrollKeyIntoView(focus));
    const hk = $("#piano-hint-keys");
    if (hk) {
      const span = `${midiName(first)}–${midiName(last)} · ${keys.length} 键`;
      hk.textContent = span;
    }
  }

  function labelToMidiLookup() {
    const map = new Map();
    for (const b of currentBinds()) {
      const key = String(b.label).toUpperCase().replace(/^⇧/, "");
      if (!map.has(key)) map.set(key, { midi: b.midi, sharp: Boolean(b.sharp || b.shift) });
      if (b.shift) map.set(`⇧${key}`, { midi: b.midi, sharp: true });
    }
    return map;
  }

  function renderGuide() {
    const host = $("#piano-guide-rows");
    if (!host) return;
    const rows = layout === "piano" ? GUIDE_ROWS_PIANO : GUIDE_ROWS_VIRTUAL;
    const lookup = labelToMidiLookup();
    host.replaceChildren();
    rows.forEach((row) => {
      const line = document.createElement("div");
      line.className = "piano-guide-row";
      row.forEach((lab) => {
        const cell = document.createElement("span");
        cell.className = "piano-guide-key";
        if (!lab) {
          cell.classList.add("is-empty");
          cell.textContent = "·";
          line.appendChild(cell);
          return;
        }
        const hit = lookup.get(lab.toUpperCase());
        const strong = document.createElement("strong");
        strong.textContent = lab;
        cell.appendChild(strong);
        if (hit) {
          if (hit.sharp || isAccidental(hit.midi)) cell.classList.add("is-sharp");
          const sub = document.createElement("span");
          sub.textContent = midiName(hit.midi);
          cell.appendChild(sub);
          cell.title = midiName(hit.midi);
        } else {
          cell.style.opacity = "0.35";
        }
        line.appendChild(cell);
      });
      host.appendChild(line);
    });
    if (layout === "virtual") {
      const tip = document.createElement("p");
      tip.className = "hint tight";
      tip.style.margin = "0.45rem 0 0";
      tip.textContent = "VirtualPiano：按住 Shift 再按同键 = 升号（黑键）。网上字母谱可直接照着弹。";
      host.appendChild(tip);
    }
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
    releaseAllKeyboard();
    octave = next;
    savePrefs();
    syncControls();
    renderKeyboard();
    setStatus(hintText());
  }

  function resolveKeyMidi(e) {
    const { byCode } = hotkeyMap();
    if (layout === "virtual") {
      const slot = byCode.get(e.code);
      if (!slot) return null;
      if (e.shiftKey && slot.sharp != null) return slot.sharp;
      return slot.natural != null ? slot.natural : null;
    }
    const midi = byCode.get(e.code);
    return midi == null ? null : midi;
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
    const midi = resolveKeyMidi(e);
    if (midi == null) return;
    e.preventDefault();
    const slotKey = `${e.code}:${e.shiftKey ? 1 : 0}`;
    if (e.repeat || keyNotes.has(slotKey)) return;
    unlockAudio();
    keyNotes.set(slotKey, midi);
    noteOn(midi, DEFAULT_VEL);
  }

  function onKeyUp(e) {
    if (e.code === "Space") {
      applySustain({ held: false });
      return;
    }
    // 松开时同时清掉 shift/非 shift 槽，避免粘键
    const keys = [`${e.code}:0`, `${e.code}:1`];
    for (const k of keys) {
      const midi = keyNotes.get(k);
      if (midi == null) continue;
      keyNotes.delete(k);
      noteOff(midi);
    }
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
      setStatus(`三角钢琴采样已就绪。${hintText()}`);
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
      flashGuide(midi, Math.max(120, beat * beats * 0.9));
      noteOn(midi);
      scrollKeyIntoView(midi);
      const dur = Math.max(80, beat * beats * 0.92);
      window.setTimeout(() => noteOff(midi), dur * 0.88);
      demoTimer = window.setTimeout(step, dur);
    };
    step();
  }

  function syncControls() {
    const lay = $("#piano-layout");
    const rng = $("#piano-range");
    const eng = $("#piano-engine");
    const lab = $("#piano-labels");
    const vol = $("#piano-vol");
    const volN = $("#piano-vol-num");
    const oct = $("#piano-oct-label");
    const sus = $("#piano-sustain");
    if (lay) lay.value = layout;
    if (rng) rng.value = rangeMode;
    if (eng) eng.value = engine;
    if (lab) lab.value = labels;
    const pct = Math.round(volume * 100);
    if (vol) vol.value = String(pct);
    if (volN) volN.textContent = `${pct}%`;
    if (oct) oct.textContent = octave === 0 ? "0" : octave > 0 ? `+${octave}` : String(octave);
    if (sus) sus.checked = sustainStick;
  }

  function refreshMidiSelect() {
    const sel = $("#piano-midi");
    if (!sel) return;
    const prev = midiInputId;
    sel.replaceChildren();
    if (!midiAccess) {
      const opt = document.createElement("option");
      opt.value = "";
      opt.textContent = navigator.requestMIDIAccess ? "未授权 / 无设备" : "浏览器不支持 Web MIDI";
      sel.appendChild(opt);
      return;
    }
    const inputs = [...midiAccess.inputs.values()];
    const none = document.createElement("option");
    none.value = "";
    none.textContent = inputs.length ? "不使用 MIDI" : "未发现 MIDI 设备";
    sel.appendChild(none);
    for (const input of inputs) {
      const opt = document.createElement("option");
      opt.value = input.id;
      opt.textContent = input.name || input.id;
      sel.appendChild(opt);
    }
    if (prev && inputs.some((i) => i.id === prev)) {
      sel.value = prev;
      midiInputId = prev;
    } else {
      sel.value = "";
      midiInputId = "";
    }
    bindMidiInput();
  }

  function bindMidiInput() {
    if (!midiAccess) return;
    if (midiHandler) {
      for (const input of midiAccess.inputs.values()) {
        input.onmidimessage = null;
      }
      midiHandler = null;
    }
    if (!midiInputId) return;
    const input = midiAccess.inputs.get(midiInputId);
    if (!input) return;
    midiHandler = (ev) => {
      if (!$("#piano")?.classList.contains("is-workspace-active")) return;
      const [status, data1, data2] = ev.data || [];
      if (status == null) return;
      const cmd = status & 0xf0;
      const midi = data1;
      if (cmd === 0x90 && data2 > 0) {
        unlockAudio();
        noteOn(midi, data2 / 127);
      } else if (cmd === 0x80 || (cmd === 0x90 && data2 === 0)) {
        noteOff(midi);
      } else if (cmd === 0xb0 && data1 === 64) {
        applySustain({ held: data2 >= 64 });
      }
    };
    input.onmidimessage = midiHandler;
  }

  async function initMidi() {
    if (!navigator.requestMIDIAccess) {
      refreshMidiSelect();
      return;
    }
    try {
      midiAccess = await navigator.requestMIDIAccess({ sysex: false });
      midiAccess.onstatechange = () => refreshMidiSelect();
      refreshMidiSelect();
    } catch (_) {
      midiAccess = null;
      refreshMidiSelect();
    }
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
    setStatus(hintText());
    bindPointer($("#piano-kb"));
    initMidi();

    $("#piano-layout")?.addEventListener("change", (e) => {
      releaseAllKeyboard();
      layout = e.target.value === "piano" ? "piano" : "virtual";
      savePrefs();
      renderKeyboard();
      setStatus(hintText());
    });
    $("#piano-range")?.addEventListener("change", (e) => {
      const v = e.target.value;
      rangeMode = v === "61" || v === "88" ? v : "auto";
      savePrefs();
      renderKeyboard();
    });
    $("#piano-labels")?.addEventListener("change", (e) => {
      const v = e.target.value;
      labels = v === "note" || v === "both" || v === "none" ? v : "hot";
      savePrefs();
      renderKeyboard();
    });
    $("#piano-engine")?.addEventListener("change", async (e) => {
      engine = e.target.value === "acoustic" ? "acoustic" : "synth";
      savePrefs();
      if (engine === "acoustic") {
        try {
          await ensureAcoustic();
        } catch (_) {}
      } else {
        setStatus(`合成器已就绪（离线可用）。${hintText()}`);
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
      flashGuide(60, 800);
      unlockAudio();
    });
    $("#piano-sustain")?.addEventListener("change", (e) => {
      applySustain({ stick: Boolean(e.target.checked) });
      savePrefs();
    });
    $("#piano-midi")?.addEventListener("change", (e) => {
      midiInputId = e.target.value || "";
      savePrefs();
      bindMidiInput();
      toast(midiInputId ? "已连接 MIDI" : "已断开 MIDI");
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
    first: FIRST_88,
    last: LAST_88,
    get layout() {
      return layout;
    },
    get rangeMode() {
      return rangeMode;
    },
    get keyBinds() {
      return currentBinds().filter((b) => !b.shift);
    },
    get allBinds() {
      return currentBinds();
    },
    hotkeyMap,
    visibleRange,
  };
})();
