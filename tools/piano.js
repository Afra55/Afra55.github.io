(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  const STORAGE_KEY = "devtools-piano-v1";
  /** 标准 88 键：A0–C8 */
  const FIRST = 21;
  const LAST = 108;
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
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
  const HINT_KEYS = "电脑键盘：Z 行从 C3 起、Q 行从 C4 起、I 行从 C5 起（约 2.5 个八度）；↑↓ 调八度，空格延音。";
  const SF_SCRIPT = "https://cdn.jsdelivr.net/npm/soundfont-player@0.12.0/dist/soundfont-player.min.js";
  const SF_FONT = (name, sf, format) =>
    `https://cdn.jsdelivr.net/gh/gleitz/midi-js-soundfonts@gh-pages/${sf}/${name}-${format}.js`;

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

  const held = new Set();
  const pointerNotes = new Map();
  const keyNotes = new Map();
  const voices = new Map();

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
    audioCtx = new AC();
    master = audioCtx.createGain();
    master.gain.value = volume;
    master.connect(audioCtx.destination);
    return audioCtx;
  }

  async function unlockAudio() {
    const ctx = getCtx();
    if (ctx.state === "suspended") await ctx.resume();
    if (master) master.gain.value = volume;
  }

  function stopVoice(midi) {
    const voice = voices.get(midi);
    if (!voice) return;
    voices.delete(midi);
    const now = audioCtx ? audioCtx.currentTime : 0;
    try {
      if (voice.kind === "acoustic") {
        voice.node?.stop?.(now + 0.03);
      } else {
        const g = voice.gain;
        g.gain.cancelScheduledValues(now);
        g.gain.setValueAtTime(Math.max(0.0001, g.gain.value), now);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18);
        voice.oscs.forEach((o) => {
          try {
            o.stop(now + 0.2);
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
        }, 260);
      }
    } catch (_) {
      /* ignore */
    }
  }

  function startSynth(midi) {
    const ctx = getCtx();
    const now = ctx.currentTime;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const vel = 0.22 + Math.min(1, (LAST - midi) / 36) * 0.08;

    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 1.1;
    filter.frequency.setValueAtTime(900 + vel * 3200, now);
    filter.frequency.exponentialRampToValueAtTime(420, now + 1.4);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(vel, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(vel * 0.42, now + 0.22);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 3.6);

    const specs = [
      ["triangle", freq, 0.72],
      ["sine", freq * 2.003, 0.22],
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
      osc.stop(now + 4.2);
      return osc;
    });

    const noise = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.04), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    noise.buffer = buf;
    const ng = ctx.createGain();
    ng.gain.value = 0.045;
    const nf = ctx.createBiquadFilter();
    nf.type = "highpass";
    nf.frequency.value = 1200;
    noise.connect(nf);
    nf.connect(ng);
    ng.connect(filter);
    noise.start(now);

    filter.connect(gain);
    gain.connect(master);
    voices.set(midi, { kind: "synth", oscs, gain });
  }

  function startAcoustic(midi) {
    if (!acoustic) {
      startSynth(midi);
      return;
    }
    const node = acoustic.play(midi, 0, { gain: 0.35 + volume * 0.9, attack: 0.008 });
    voices.set(midi, { kind: "acoustic", node });
  }

  function startVoice(midi) {
    if (voices.has(midi)) stopVoice(midi);
    if (engine === "acoustic" && acoustic) startAcoustic(midi);
    else startSynth(midi);
  }

  function noteOn(midi) {
    const n = clampMidi(midi);
    held.add(n);
    try {
      startVoice(n);
    } catch (err) {
      setStatus(`无法发声：${err.message || err}`);
    }
    paintKeys();
  }

  function noteOff(midi) {
    const n = clampMidi(midi);
    held.delete(n);
    if (!sustainOn()) stopVoice(n);
    paintKeys();
  }

  function panicStop() {
    held.clear();
    pointerNotes.clear();
    keyNotes.clear();
    for (const midi of [...voices.keys()]) stopVoice(midi);
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
    const list = [...voices.keys()].sort((a, b) => a - b).map(midiName);
    el.textContent = list.length ? list.join(" · ") : "—";
  }

  function paintKeys() {
    const kb = $("#piano-kb");
    if (!kb) return;
    kb.querySelectorAll("[data-midi]").forEach((btn) => {
      const midi = Number(btn.dataset.midi);
      btn.classList.toggle("is-active", voices.has(midi) || held.has(midi));
    });
    paintNow();
  }

  function scrollKeyIntoView(midi) {
    const bed = $("#piano-bed");
    const kb = $("#piano-kb");
    const el = kb?.querySelector(`[data-midi="${midi}"]`);
    if (!bed || !el) return;
    const left = el.offsetLeft - Math.max(24, bed.clientWidth * 0.22);
    bed.scrollLeft = Math.max(0, left);
  }

  function renderKeyboard() {
    const kb = $("#piano-kb");
    if (!kb) return;
    const { inv } = hotkeyMap();
    const whites = [];
    const blacks = [];
    for (let m = FIRST; m <= LAST; m++) {
      if (isAccidental(m)) blacks.push(m);
      else whites.push(m);
    }
    kb.style.setProperty("--piano-whites", String(whites.length));
    kb.replaceChildren();
    whites.forEach((midi) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "piano-white";
      btn.dataset.midi = String(midi);
      btn.tabIndex = -1;
      btn.setAttribute("aria-label", midiName(midi));
      if (midi % 12 === 0 || midi === FIRST || midi === LAST) {
        const note = document.createElement("span");
        note.className = "piano-key-note";
        note.textContent = midiName(midi);
        btn.appendChild(note);
      }
      const hot = inv.get(midi);
      if (hot) {
        const k = document.createElement("span");
        k.className = "piano-key-hot";
        k.textContent = hot;
        btn.appendChild(k);
      }
      kb.appendChild(btn);
    });
    blacks.forEach((midi) => {
      const idx = whites.indexOf(midi - 1);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "piano-black";
      btn.dataset.midi = String(midi);
      btn.tabIndex = -1;
      btn.setAttribute("aria-label", midiName(midi));
      btn.style.left = `calc((100% / ${whites.length}) * ${idx + 0.68})`;
      btn.style.width = `calc(100% / ${whites.length} * 0.62)`;
      const hot = inv.get(midi);
      if (hot) {
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

  function midiFromPoint(x, y) {
    const stack = document.elementsFromPoint(x, y);
    for (const el of stack) {
      if (el.classList?.contains("piano-black") || el.classList?.contains("piano-white")) {
        const n = Number(el.dataset.midi);
        if (Number.isFinite(n)) return n;
      }
    }
    return null;
  }

  function bindPointer(kb) {
    kb.addEventListener("pointerdown", async (e) => {
      const midi = midiFromPoint(e.clientX, e.clientY);
      if (midi == null) return;
      e.preventDefault();
      try {
        kb.setPointerCapture(e.pointerId);
      } catch (_) {}
      await unlockAudio().catch(() => {});
      pointerNotes.set(e.pointerId, midi);
      noteOn(midi);
    });
    kb.addEventListener("pointermove", (e) => {
      if (!pointerNotes.has(e.pointerId)) return;
      const midi = midiFromPoint(e.clientX, e.clientY);
      const prev = pointerNotes.get(e.pointerId);
      if (midi == null || midi === prev) return;
      pointerNotes.set(e.pointerId, midi);
      noteOff(prev);
      noteOn(midi);
    });
    const end = (e) => {
      const prev = pointerNotes.get(e.pointerId);
      if (prev == null) return;
      pointerNotes.delete(e.pointerId);
      noteOff(prev);
    };
    kb.addEventListener("pointerup", end);
    kb.addEventListener("pointercancel", end);
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
        unlockAudio().catch(() => {});
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
    unlockAudio().catch(() => {});
    keyNotes.set(e.code, midi);
    noteOn(midi);
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
      await unlockAudio();
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
    await unlockAudio().catch(() => {});
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
    const oct = $("#piano-oct-label");
    const sus = $("#piano-sustain");
    if (eng) eng.value = engine;
    if (vol) vol.value = String(Math.round(volume * 100));
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
    setStatus(`88 键 A0–C8，可左右滑动。${HINT_KEYS}`);
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
      savePrefs();
    });
    $("#piano-oct-down")?.addEventListener("click", () => shiftOctave(-1));
    $("#piano-oct-up")?.addEventListener("click", () => shiftOctave(1));
    $("#piano-goto-c4")?.addEventListener("click", () => scrollKeyIntoView(60));
    $("#piano-sustain")?.addEventListener("change", (e) => {
      applySustain({ stick: Boolean(e.target.checked) });
      savePrefs();
    });
    $("#piano-demo-twinkle")?.addEventListener("click", () => playDemo("twinkle"));
    $("#piano-demo-ode")?.addEventListener("click", () => playDemo("ode"));
    $("#piano-demo-stop")?.addEventListener("click", stopDemo);

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

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
