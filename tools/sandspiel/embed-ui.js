(() => {
  "use strict";

  const FPS_KEY = "sandspiel-show-fps";
  let layoutQueued = 0;

  function getShowFps() {
    try {
      return localStorage.getItem(FPS_KEY) !== "0";
    } catch (_) {
      return true;
    }
  }

  function notifyParentFps(show) {
    try {
      window.parent?.postMessage({ type: "sandspiel:fps-state", show: !!show }, "*");
    } catch (_) {}
  }

  function setShowFps(show) {
    const on = !!show;
    try {
      localStorage.setItem(FPS_KEY, on ? "1" : "0");
    } catch (_) {}
    document.documentElement.classList.toggle("sandspiel-hide-fps", !on);
    const el = document.getElementById("fps");
    if (el) {
      el.hidden = !on;
      el.style.display = on ? "" : "none";
      el.style.visibility = on ? "" : "hidden";
    }
    notifyParentFps(on);
  }

  function layoutSandspiel() {
    const ui = document.getElementById("ui");
    const sand = document.getElementById("sand-canvas");
    const fluid = document.getElementById("fluid-canvas");
    if (!ui || !sand || !fluid) return;

    const w = window.innerWidth;
    const h = window.innerHeight;
    const isMobile = window.__sandspielMobile || w < 700;

    if (!isMobile && w > h) {
      const side = Math.min(240, Math.max(168, w - h - 16));
      const canvas = Math.min(h, w - side - 8);
      ui.style.cssText =
        "width:" +
        side +
        "px;margin:2px;max-height:" +
        (h - 8) +
        "px;overflow-x:hidden;overflow-y:auto;float:right;box-sizing:border-box;";
      const canvasCss =
        "height:" +
        canvas +
        "px;width:" +
        canvas +
        "px;margin:0;left:auto;right:" +
        (side + 8) +
        "px;bottom:0;top:auto;max-width:none;position:absolute;";
      sand.style.cssText = canvasCss;
      fluid.style.cssText = canvasCss;
      return;
    }

    const needed = ui.scrollHeight + 10;
    const cap = Math.min(isMobile ? 380 : 320, Math.round(h * (isMobile ? 0.62 : 0.5)));
    const uiH = Math.min(Math.max(needed, isMobile ? 200 : 160), cap);
    const canvasSize = Math.max(140, Math.min(w - 8, h - uiH - 10));

    ui.style.cssText =
      "width:100%;max-height:" +
      uiH +
      "px;overflow-x:hidden;overflow-y:auto;-webkit-overflow-scrolling:touch;float:none;box-sizing:border-box;padding:2px 4px;";
    const canvasCss =
      "width:" +
      canvasSize +
      "px;height:" +
      canvasSize +
      "px;bottom:4px;left:50%;transform:translateX(-50%);max-width:calc(100% - 6px);position:absolute;";
    sand.style.cssText = canvasCss;
    fluid.style.cssText = canvasCss;
  }

  function queueLayout() {
    if (layoutQueued) return;
    layoutQueued = window.requestAnimationFrame(() => {
      layoutQueued = 0;
      layoutSandspiel();
    });
  }

  function enhanceFps() {
    const el = document.getElementById("fps");
    if (!el || el.dataset.enhanced === "1") return;
    el.dataset.enhanced = "1";
    setShowFps(getShowFps());
    el.style.pointerEvents = "auto";
    el.style.cursor = "pointer";
    el.title = "点击隐藏 FPS";
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      setShowFps(false);
    });
  }

  function syncMenuLayer() {
    const ui = document.getElementById("ui");
    const open = !!(ui && ui.querySelector(".menu-scrim"));
    document.documentElement.classList.toggle("sandspiel-menu-open", open);
  }

  function observeMenuLayer() {
    const ui = document.getElementById("ui");
    if (!ui || ui.dataset.menuObserved === "1") return;
    ui.dataset.menuObserved = "1";
    new MutationObserver(syncMenuLayer).observe(ui, { childList: true, subtree: true });
    syncMenuLayer();
  }

  function boot() {
    enhanceFps();
    queueLayout();
    observeMenuLayer();

    const ui = document.getElementById("ui");
    if (ui && !ui.dataset.layoutObserved) {
      ui.dataset.layoutObserved = "1";
      new MutationObserver(queueLayout).observe(ui, { childList: true, subtree: true, attributes: true });
    }

    window.addEventListener("resize", queueLayout);
    window.addEventListener("orientationchange", () => window.setTimeout(queueLayout, 120));
    window.setTimeout(queueLayout, 80);
    window.setTimeout(queueLayout, 400);
    window.setTimeout(queueLayout, 1200);
  }

  window.__sandspielSetFps = setShowFps;
  window.__sandspielRelayout = queueLayout;

  window.addEventListener("message", (e) => {
    const d = e.data;
    if (d === "sandspiel:fps-off" || d?.type === "sandspiel:fps-off") setShowFps(false);
    if (d === "sandspiel:fps-on" || d?.type === "sandspiel:fps-on") setShowFps(true);
    if (d === "sandspiel:fps-toggle" || d?.type === "sandspiel:fps-toggle") setShowFps(!getShowFps());
    if (d === "sandspiel:relayout" || d?.type === "sandspiel:relayout") queueLayout();
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
