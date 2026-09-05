(() => {
  "use strict";
  const BUILD = "2026.09.05-115400";
  window.TOOLS_BUILD = BUILD;
  window.TOOLS_VERSION = BUILD;

  function paintVersion() {
    const el = document.getElementById("site-tools-version");
    if (!el) return;
    el.textContent = `v${BUILD}`;
    el.title = `工具页逻辑版本 ${BUILD}（更新后应看到此号变化）`;
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", paintVersion, { once: true });
  } else paintVersion();

  try {
    const prev = localStorage.getItem("devtools-seen-build-v1");
    localStorage.setItem("devtools-seen-build-v1", BUILD);
    if (prev && prev !== BUILD) window.__devtoolsBuildUpgraded = { from: prev, to: BUILD };
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
    const zh = usableText(
      root.querySelector(".kidsflash-zh, .animalearn-zh, [id$='-card-zh']")?.textContent
    );
    const en = usableText(
      root.querySelector(".kidsflash-en, .animalearn-en, [id$='-card-en']")?.textContent
    );
    if (!zh && !en) return false;
    unlockSpeech();
    try {
      synth.cancel();
    } catch (_) {}
    try {
      if (synth.paused) synth.resume();
    } catch (_) {}
    if (zh) speakNow(zh, "zh-CN");
    if (en) speakNow(en, "en-US");
    return true;
  }

  function isSpeakTarget(el) {
    if (!el || !el.closest) return false;
    return Boolean(
      el.closest(
        ".kidsflash-speak-btn, .kidsflash-media-tap, .kidsflash-names, .kidsflash-names-tap, .animalearn-speak-btn, .animalearn-media-tap, .animalearn-names, [id$='-speak'], [id$='-card-media']"
      )
    );
  }

  if (isIOSLike()) {
    document.addEventListener("touchstart", unlockSpeech, { capture: true, passive: true });
    document.addEventListener(
      "pointerdown",
      (ev) => {
        if (ev.pointerType === "mouse" && ev.button !== 0) return;
        const t = ev.target;
        if (!isSpeakTarget(t)) return;
        speakCardFrom(t);
      },
      true
    );
  }

  try {
    if (synth && !synth.__devtoolsSpeakPatched) {
      synth.__devtoolsSpeakPatched = true;
      const origSpeak = synth.speak.bind(synth);
      const origCancel = synth.cancel.bind(synth);
      const resume = () => {
        try {
          if (synth.paused) synth.resume();
        } catch (_) {}
      };
      synth.cancel = function patchedCancel() {
        try {
          origCancel();
        } catch (_) {}
        resume();
      };
      synth.speak = function patchedSpeak(utterance) {
        if (!utterance) return;
        resume();
        try {
          origSpeak(utterance);
        } catch (_) {}
      };
    }
  } catch (_) {}

  if (!document.getElementById("devtools-ios-safe")) {
    const st = document.createElement("style");
    st.id = "devtools-ios-safe";
    st.textContent =
      "@supports (padding-top: env(safe-area-inset-top)){" +
      "@media (max-width: 900px){" +
      ".site-header{padding-top:calc(0.85rem + env(safe-area-inset-top,0px))!important;" +
      "padding-left:max(1rem,env(safe-area-inset-left,0px));" +
      "padding-right:max(1rem,env(safe-area-inset-right,0px));}}}" +
      ".kidsflash-load-bar{display:block;min-height:0.42rem;background:rgba(255,255,255,.25);}" +
      ".kidsflash-load-bar-indeterminate{background:rgba(91,140,255,.38);}" +
      ".kidsflash-load-bar-indeterminate::after{transform:none;left:0;width:42%;}";
    document.head.appendChild(st);
  }
})();
