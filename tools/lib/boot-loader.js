(() => {
  "use strict";

  const MIN_SHOW_MS = 320;
  const startedAt = Date.now();
  let finished = false;
  let pct = 4;
  let label = "正在启动…";

  const root = document.documentElement;
  root.dataset.bootLoading = "1";

  const overlay = document.createElement("div");
  overlay.id = "devtools-boot-overlay";
  overlay.setAttribute("role", "status");
  overlay.setAttribute("aria-live", "polite");
  overlay.setAttribute("aria-busy", "true");
  overlay.innerHTML =
    '<div class="devtools-boot-card">' +
    '<div class="devtools-boot-title">DevTools</div>' +
    '<div class="devtools-boot-bar" aria-hidden="true"><span class="devtools-boot-bar-fill"></span></div>' +
    '<div class="devtools-boot-label">正在启动…</div>' +
    "</div>";

  const fill = overlay.querySelector(".devtools-boot-bar-fill");
  const labelEl = overlay.querySelector(".devtools-boot-label");

  function paint() {
    if (fill) fill.style.width = `${Math.min(100, Math.max(0, pct))}%`;
    if (labelEl) labelEl.textContent = label;
  }

  function bump(next, nextLabel) {
    if (finished) return;
    pct = Math.max(pct, next);
    if (nextLabel) label = nextLabel;
    paint();
  }

  function mount() {
    if (overlay.isConnected) return;
    (document.body || root).appendChild(overlay);
    paint();
  }

  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });

  let routeReady = false;
  let scriptsReady = false;

  function tryFinish() {
    if (routeReady && scriptsReady) finish();
  }

  function markScriptsReady() {
    scriptsReady = true;
    tryFinish();
  }

  function trackDeferScripts() {
    // defer 脚本保证在 DOMContentLoaded 之前已顺序执行完毕，无需再等 load 事件
    bump(88, "准备界面…");
    markScriptsReady();
  }

  function hideOverlay() {
    if (finished) return;
    finished = true;
    delete root.dataset.bootLoading;
    overlay.classList.add("is-done");
    overlay.setAttribute("aria-busy", "false");
    window.setTimeout(() => overlay.remove(), 420);
  }

  function maybeFinishSoon() {
    const wait = Math.max(0, MIN_SHOW_MS - (Date.now() - startedAt));
    window.setTimeout(() => {
      if (!finished) bump(96, "即将完成…");
    }, wait);
  }

  function finish() {
    bump(100, "完成");
    const wait = Math.max(0, MIN_SHOW_MS - (Date.now() - startedAt));
    window.setTimeout(hideOverlay, wait);
  }

  bump(8, "加载核心…");

  document.addEventListener("DOMContentLoaded", () => {
    bump(14, "加载模块…");
    trackDeferScripts();
  });

  window.addEventListener(
    "devtools:boot-ready",
    () => {
      routeReady = true;
      bump(94, "即将完成…");
      tryFinish();
    },
    { once: true }
  );

  window.setTimeout(() => {
    if (!finished) finish();
  }, 45000);

  window.DevToolsBoot = {
    bump,
    setLabel(nextLabel) {
      bump(pct, nextLabel);
    },
    finish,
  };
})();
