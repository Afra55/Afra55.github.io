(() => {
  "use strict";
  /** 全站构建版本（北京时间后缀）。每次合入功能/修复必须递增此号，并运行 node tools/bump-version.cjs 同步 ?v=。 */
  const BUILD = "2026.09.05-114800";
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
  } else {
    paintVersion();
  }

  const SEEN_KEY = "devtools-seen-build-v1";
  try {
    const prev = localStorage.getItem(SEEN_KEY);
    localStorage.setItem(SEEN_KEY, BUILD);
    if (prev && prev !== BUILD) {
      window.__devtoolsBuildUpgraded = { from: prev, to: BUILD };
    }
  } catch (_) {}

  try {
    const synth = window.speechSynthesis;
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
        const kick = () => {
          resume();
          try {
            origSpeak(utterance);
          } catch (_) {}
        };
        kick();
        [60, 180].forEach((ms) => {
          window.setTimeout(() => {
            try {
              if (synth.speaking || synth.pending) return;
              kick();
            } catch (_) {}
          }, ms);
        });
      };
    }
  } catch (_) {}

  // iOS PWA / viewport-fit=cover：顶栏让出状态栏，不改桌面间距
  if (!document.getElementById("devtools-ios-safe")) {
    const st = document.createElement("style");
    st.id = "devtools-ios-safe";
    st.textContent =
      "@supports (padding-top: env(safe-area-inset-top)){" +
      "@media (max-width: 900px){" +
      ".site-header{padding-top:calc(0.85rem + env(safe-area-inset-top,0px))!important;" +
      "padding-left:max(1rem,env(safe-area-inset-left,0px));" +
      "padding-right:max(1rem,env(safe-area-inset-right,0px));}}}" +
      "@supports (padding-top: constant(safe-area-inset-top)){" +
      "@media (max-width: 900px){" +
      ".site-header{padding-top:calc(0.85rem + constant(safe-area-inset-top))!important;}}}";
    document.head.appendChild(st);
  }
})();
