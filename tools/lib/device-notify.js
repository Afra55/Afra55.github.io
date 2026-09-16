(() => {
  "use strict";

  if (window.DevToolsDeviceNotify) return;

  const WAKE_KEY = "devtools-wake-lock";
  const SOUND_KEY = "devtools-notify-sound";
  const VIBRATE_KEY = "devtools-notify-vibrate";
  const SCOPE_KEY = "devtools-notify-scope";

  function readBool(key, def) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? def : v === "1";
    } catch (_) {
      return def;
    }
  }
  function writeBool(key, v) {
    try {
      localStorage.setItem(key, v ? "1" : "0");
    } catch (_) {}
  }

  // ---------- 防息屏：引用计数，多任务共用一把锁 ----------
  let sentinel = null;
  let holders = 0;

  function wakeSupported() {
    return typeof navigator !== "undefined" && "wakeLock" in navigator;
  }

  async function requestLock() {
    if (!wakeSupported() || sentinel) return;
    if (holders <= 0 || !readBool(WAKE_KEY, true)) return;
    if (document.visibilityState !== "visible") return;
    try {
      sentinel = await navigator.wakeLock.request("screen");
      sentinel.addEventListener("release", () => {
        sentinel = null;
      });
    } catch (_) {
      sentinel = null;
    }
  }

  function dropLock() {
    const s = sentinel;
    sentinel = null;
    try {
      s?.release?.();
    } catch (_) {}
  }

  function acquire() {
    holders += 1;
    if (holders === 1) requestLock();
  }

  function release() {
    holders = Math.max(0, holders - 1);
    if (holders === 0) dropLock();
  }

  function setWakeEnabled(on) {
    writeBool(WAKE_KEY, Boolean(on));
    if (on && holders > 0) requestLock();
    else if (!on) dropLock();
  }

  function wakeEnabled() {
    return readBool(WAKE_KEY, true);
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && holders > 0 && readBool(WAKE_KEY, true)) {
      requestLock();
    }
  });

  // ---------- 提示音：Web Audio 现场合成，无需音频文件 ----------
  let audioCtx = null;

  function soundSupported() {
    return Boolean(window.AudioContext || window.webkitAudioContext);
  }

  function ensureCtx() {
    if (audioCtx) return audioCtx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      audioCtx = new AC();
    } catch (_) {
      audioCtx = null;
    }
    return audioCtx;
  }

  /** 用户手势里调用一次，解锁 iOS 音频 */
  function unlockAudio() {
    const ctx = ensureCtx();
    if (!ctx) return;
    try {
      if (ctx.state === "suspended") ctx.resume();
    } catch (_) {}
  }

  function beep() {
    if (!readBool(SOUND_KEY, true)) return;
    const ctx = ensureCtx();
    if (!ctx) return;
    try {
      if (ctx.state === "suspended") ctx.resume();
      const t0 = ctx.currentTime + 0.01;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, t0);
      osc.frequency.setValueAtTime(1318.5, t0 + 0.1);
      gain.gain.setValueAtTime(0.0001, t0);
      gain.gain.exponentialRampToValueAtTime(0.28, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.3);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.32);
    } catch (_) {}
  }

  // ---------- 震动 ----------
  function vibrateSupported() {
    return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
  }

  function vibrate() {
    if (!readBool(VIBRATE_KEY, true)) return;
    if (!vibrateSupported()) return;
    try {
      navigator.vibrate([140, 70, 140]);
    } catch (_) {}
  }

  function notifyDone() {
    beep();
    vibrate();
  }

  function scope() {
    try {
      return localStorage.getItem(SCOPE_KEY) === "done" ? "done" : "each";
    } catch (_) {
      return "each";
    }
  }
  function setScope(v) {
    try {
      localStorage.setItem(SCOPE_KEY, v === "done" ? "done" : "each");
    } catch (_) {}
  }
  function setSound(on) {
    writeBool(SOUND_KEY, Boolean(on));
  }
  function setVibrate(on) {
    writeBool(VIBRATE_KEY, Boolean(on));
  }
  function soundEnabled() {
    return readBool(SOUND_KEY, true);
  }
  function vibrateEnabled() {
    return readBool(VIBRATE_KEY, true);
  }

  window.DevToolsDeviceNotify = {
    acquire,
    release,
    unlockAudio,
    notifyDone,
    setWakeEnabled,
    setSound,
    setVibrate,
    setScope,
    wakeEnabled,
    soundEnabled,
    vibrateEnabled,
    scope,
    wakeSupported,
    vibrateSupported,
    soundSupported,
  };
})();
