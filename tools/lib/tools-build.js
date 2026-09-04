(() => {
  "use strict";
  /** 全站构建版本（北京时间后缀）。每次合入功能/修复必须递增此号，并运行 node tools/bump-version.cjs 同步 ?v=。 */
  const BUILD = "2026.09.04-145958";
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
  } catch (_) {
    /* ignore */
  }
})();
