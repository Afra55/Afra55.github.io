(() => {
  "use strict";

  const FPS_KEY = "sandspiel-show-fps";

  function getShowFps() {
    try {
      return localStorage.getItem(FPS_KEY) !== "0";
    } catch (_) {
      return true;
    }
  }

  function setShowFps(show) {
    try {
      localStorage.setItem(FPS_KEY, show ? "1" : "0");
    } catch (_) {}
    const el = document.getElementById("fps");
    if (!el) return;
    el.hidden = !show;
    el.style.display = show ? "" : "none";
    try {
      window.parent?.postMessage({ type: "sandspiel:fps-state", show: !!show }, "*");
    } catch (_) {}
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

  window.addEventListener("message", (e) => {
    const d = e.data;
    if (d === "sandspiel:fps-off" || d?.type === "sandspiel:fps-off") setShowFps(false);
    if (d === "sandspiel:fps-on" || d?.type === "sandspiel:fps-on") setShowFps(true);
    if (d === "sandspiel:fps-toggle" || d?.type === "sandspiel:fps-toggle") setShowFps(!getShowFps());
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", enhanceFps);
  else enhanceFps();
})();
