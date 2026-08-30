(() => {
  "use strict";

  const frame = document.getElementById("sandspiel-frame");
  const panel = document.getElementById("sandspiel");
  const fpsToggle = document.getElementById("sandspiel-show-fps");
  if (!frame || !panel) return;

  const SRC = "./sandspiel/index.html";
  const FPS_KEY = "sandspiel-show-fps";
  let loaded = false;

  function post(type, payload) {
    try {
      frame.contentWindow?.postMessage(payload ?? type, "*");
    } catch (_) {}
  }

  function readShowFps() {
    try {
      return localStorage.getItem(FPS_KEY) !== "0";
    } catch (_) {
      return true;
    }
  }

  function syncFpsToggle(show) {
    if (fpsToggle) fpsToggle.checked = !!show;
  }

  function applyFpsPref(show) {
    try {
      localStorage.setItem(FPS_KEY, show ? "1" : "0");
    } catch (_) {}
    syncFpsToggle(show);
    if (loaded) post(null, { type: show ? "sandspiel:fps-on" : "sandspiel:fps-off" });
  }

  fpsToggle?.addEventListener("change", () => {
    applyFpsPref(Boolean(fpsToggle.checked));
  });

  window.addEventListener("message", (e) => {
    if (e.source !== frame.contentWindow) return;
    const d = e.data;
    if (d?.type !== "sandspiel:fps-state") return;
    try {
      localStorage.setItem(FPS_KEY, d.show ? "1" : "0");
    } catch (_) {}
    syncFpsToggle(Boolean(d.show));
  });

  function ensureLoaded() {
    if (!panel.classList.contains("is-workspace-active")) {
      if (loaded) post("sandspiel:pause");
      return;
    }
    if (!loaded) {
      loaded = true;
      frame.referrerPolicy = "no-referrer";
      frame.src = SRC;
      frame.addEventListener(
        "load",
        () => {
          applyFpsPref(readShowFps());
        },
        { once: true }
      );
    } else {
      post("sandspiel:play");
      applyFpsPref(readShowFps());
    }
  }

  syncFpsToggle(readShowFps());

  window.addEventListener("devtools:route", ensureLoaded);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) post("sandspiel:pause");
    else if (panel.classList.contains("is-workspace-active")) post("sandspiel:play");
  });
  if (panel.classList.contains("is-workspace-active")) ensureLoaded();
})();
