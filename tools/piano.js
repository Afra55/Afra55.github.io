(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  const STORAGE_KEY = "devtools-piano-v1";
  const FIRST = 48; // C3
  const LAST = 77; // F5
  const HOME_BASE = 60; // C4 → A
  const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const HOME_ROW = [
    ["a", 0],
    ["w", 1],
    ["s", 2],
    ["e", 3],
    ["d", 4],
    ["f", 5],
    ["t", 6],
    ["g", 7],
    ["y", 8],
    ["h", 9],
    ["u", 10],
    ["j", 11],
    ["k", 12],
    ["o", 13],
    ["l", 14],
    ["p", 15],
    [";", 16],
  ];
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
    const map = new Map();
    const inv = new Map();
    for (const [key, delta] of HOME_ROW) {
      const midi = HOME_BASE + octave * 12 + delta;
      if (midi < FIRST || midi > LAST) continue;
      map.set(key, midi);
      inv.set(midi, key);
    }
    return { map, inv };
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
      if (Number.isFinite(raw.octave)) octave = Math.max(-2, Math.min(2, Math.round(raw.octave)));
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
    kb.replaceChildren();
    whites.forEach((midi) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "piano-white";
      btn.dataset.midi = String(midi);
      btn.tabIndex = -1;
      btn.setAttribute("aria-label", midiName(midi));
      const note = document.createElement("span");
      note.className = "piano-key-note";
      note.textContent = midiName(midi);
      btn.appendChild(note);
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
      const note = document.createElement("span");
      note.className = "piano-key-note";
      note.textContent = midiName(midi).replace("#", "♯");
      btn.appendChild(note);
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
    const { map } = hotkeyMap();
    const midi = map.get(String(e.key).toLowerCase());
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
      setStatus("三角钢琴采样已就绪。电脑键盘 A–L 为白键；空格延音。");
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
    bindPointer($("#piano-kb"));

    $("#piano-engine")?.addEventListener("change", async (e) => {
      engine = e.target.value === "acoustic" ? "acoustic" : "synth";
      savePrefs();
      if (engine === "acoustic") {
        try {
          await ensureAcoustic();
        } catch (_) {}
      } else {
        setStatus("合成器已就绪（离线可用）。电脑键盘 A–L 为白键；空格延音。");
      }
    });
    $("#piano-vol")?.addEventListener("input", (e) => {
      volume = Math.max(0, Math.min(1, Number(e.target.value) / 100));
      if (master) master.gain.value = volume;
      savePrefs();
    });
    $("#piano-oct-down")?.addEventListener("click", () => {
      octave = Math.max(-2, octave - 1);
      savePrefs();
      syncControls();
      renderKeyboard();
    });
    $("#piano-oct-up")?.addEventListener("click", () => {
      octave = Math.min(2, octave + 1);
      savePrefs();
      syncControls();
      renderKeyboard();
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
    homeRow: HOME_ROW,
  };
})();
