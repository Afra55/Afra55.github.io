(() => {
  "use strict";
  /** 全站构建版本（北京时间后缀）。每次合入功能/修复必须递增此号，并运行 node tools/bump-version.cjs 同步 ?v=。 */
  const BUILD = "2026.09.05-111900";
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

  // Chromium: cancel() 后同拍 speak() 常被丢弃；paused 状态也会全程静音。
  // 打在原型上，认动物 / kids-flash 各类目 / 日常开口 都会走这里。
  try {
    const synth = window.speechSynthesis;
    if (synth && !synth.__devtoolsSpeakPatched) {
      synth.__devtoolsSpeakPatched = true;
      const origSpeak = synth.speak.bind(synth);
      const origCancel = synth.cancel.bind(synth);
      synth.cancel = function patchedCancel() {
        try {
          origCancel();
        } catch (_) {}
        try {
          if (this.paused) this.resume();
        } catch (_) {}
      };
      synth.speak = function patchedSpeak(utterance) {
        if (!utterance) return;
        try {
          if (this.paused) this.resume();
        } catch (_) {}
        try {
          origSpeak(utterance);
        } catch (_) {}
        window.setTimeout(() => {
          try {
            if (this.speaking || this.pending) return;
            if (this.paused) this.resume();
            origSpeak(utterance);
          } catch (_) {}
        }, 50);
      };
    }
  } catch (_) {}
})();
