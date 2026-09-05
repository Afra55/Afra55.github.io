(() => {
  "use strict";
  const BUILD = "2026.09.05-120200";
  window.TOOLS_BUILD = BUILD;
  window.TOOLS_VERSION = BUILD;

  function paintVersion() {
    const el = document.getElementById("site-tools-version");
    if (!el) return;
    el.textContent = `v${BUILD}`;
    el.title = `工具页逻辑版本 ${BUILD}`;
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", paintVersion, { once: true });
  } else paintVersion();

  try {
    localStorage.setItem("devtools-seen-build-v1", BUILD);
  } catch (_) {}

  const synth = window.speechSynthesis || null;

  function isIOSLike() {
    const ua = navigator.userAgent || "";
    if (/iP(hone|ad|od)/i.test(ua)) return true;
    return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  }

  function primeVoices() {
    try {
      synth?.getVoices?.();
    } catch (_) {}
  }
  try {
    synth?.addEventListener?.("voiceschanged", primeVoices);
    primeVoices();
  } catch (_) {}

  function pickVoice(lang) {
    const voices = synth?.getVoices?.() || [];
    const low = String(lang || "").toLowerCase();
    const head = low.slice(0, 2);
    return (
      voices.find((v) => String(v.lang).toLowerCase().replace("_", "-").startsWith(low)) ||
      voices.find((v) => String(v.lang).toLowerCase().startsWith(head)) ||
      null
    );
  }

  function speakNow(text, lang) {
    if (!synth || !text) return;
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    u.rate = lang.indexOf("zh") === 0 ? 0.92 : 0.95;
    const voice = pickVoice(lang);
    if (voice) u.voice = voice;
    try {
      if (synth.paused) synth.resume();
    } catch (_) {}
    try {
      synth.speak(u);
    } catch (_) {}
  }

  function unlockSpeech() {
    if (!synth || synth.__devtoolsUnlocked) return;
    synth.__devtoolsUnlocked = true;
    try {
      const u = new SpeechSynthesisUtterance("。");
      u.volume = 0;
      u.rate = 2;
      synth.speak(u);
      synth.cancel();
    } catch (_) {}
    primeVoices();
  }

  function usableText(s) {
    const t = String(s || "").trim();
    if (!t) return "";
    if (t === "—" || t === "--" || t === "-") return "";
    if (t === "加载中" || t === "Loading" || t === "正在载入…" || t === "Loading pack") return "";
    return t;
  }

  function speakCardFrom(el) {
    const root = el.closest?.(".kidsflash-immerse, .animalearn-immerse, .tool-panel");
    if (!root || !synth) return false;
    const zh = usableText(root.querySelector(".kidsflash-zh, .animalearn-zh, [id$='-card-zh']")?.textContent);
    const en = usableText(root.querySelector(".kidsflash-en, .animalearn-en, [id$='-card-en']")?.textContent);
    if (!zh && !en) return false;
    unlockSpeech();
    try { synth.cancel(); } catch (_) {}
    try { if (synth.paused) synth.resume(); } catch (_) {}
    if (zh) speakNow(zh, "zh-CN");
    if (en) speakNow(en, "en-US");
    return true;
  }

  function isSpeakTarget(el) {
    if (!el || !el.closest) return false;
    return Boolean(
      el.closest(".kidsflash-speak-btn, .kidsflash-media-tap, .kidsflash-names, .kidsflash-names-tap, [id$='-speak'], [id$='-card-media']")
    );
  }

  if (isIOSLike()) {
    document.addEventListener("touchstart", unlockSpeech, { capture: true, passive: true });
    document.addEventListener(
      "pointerdown",
      (ev) => {
        if (ev.pointerType === "mouse" && ev.button !== 0) return;
        if (!isSpeakTarget(ev.target)) return;
        speakCardFrom(ev.target);
      },
      true
    );
  }

  try {
    if (synth && !synth.__devtoolsSpeakPatched) {
      synth.__devtoolsSpeakPatched = true;
      const origSpeak = synth.speak.bind(synth);
      const origCancel = synth.cancel.bind(synth);
      synth.cancel = function () {
        try { origCancel(); } catch (_) {}
        try { if (synth.paused) synth.resume(); } catch (_) {}
      };
      synth.speak = function (utterance) {
        if (!utterance) return;
        try { if (synth.paused) synth.resume(); } catch (_) {}
        try { origSpeak(utterance); } catch (_) {}
      };
    }
  } catch (_) {}

  if (!document.getElementById("devtools-ios-safe")) {
    const st = document.createElement("style");
    st.id = "devtools-ios-safe";
    st.textContent =
      "@supports (padding-top: env(safe-area-inset-top)){" +
      "@media (max-width: 900px){" +
      ".site-header{padding-top:calc(0.75rem + env(safe-area-inset-top,0px))!important;}" +
      ".nav-drawer-head{padding-top:max(0.35rem, env(safe-area-inset-top,0px));}" +
      ".nav-bar{padding-top:max(0.65rem, env(safe-area-inset-top,0px));}}}";
    document.head.appendChild(st);
  }
})();
