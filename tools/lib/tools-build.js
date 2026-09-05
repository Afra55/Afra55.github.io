(() => {
  "use strict";
  const BUILD = "2026.09.05-113700";
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

  if (!window.__devtoolsPanelRouteRelay) {
    window.__devtoolsPanelRouteRelay = true;
    window.addEventListener("devtools:panel-mounted", () => {
      try {
        window.dispatchEvent(new CustomEvent("devtools:route"));
      } catch (_) {}
    });
  }

  try {
    const href = "./styles/panels/kidsflash.css?v=" + encodeURIComponent(BUILD);
    if (!document.querySelector("link[data-kidsflash-css]")) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.dataset.kidsflashCss = "1";
      document.head.appendChild(link);
    }
  } catch (_) {}
})();
