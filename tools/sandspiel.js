(() => {
  "use strict";

  const frame = document.getElementById("sandspiel-frame");
  const panel = document.getElementById("sandspiel");
  const shell = document.querySelector(".sandspiel-shell");
  const fpsToggle = document.getElementById("sandspiel-show-fps");
  const fsBtn = document.getElementById("sandspiel-fullscreen");
  if (!frame || !panel) return;

  const SRC = "./sandspiel/index.html";
  const FPS_KEY = "sandspiel-show-fps";
  let loaded = false;

  function postMsg(payload) {
    try {
      frame.contentWindow?.postMessage(payload, "*");
    } catch (_) {}
  }

  function callFrame(fn, arg) {
    try {
      const win = frame.contentWindow;
      if (typeof win?.[fn] === "function") win[fn](arg);
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
    postMsg({ type: show ? "sandspiel:fps-on" : "sandspiel:fps-off" });
    callFrame("__sandspielSetFps", show);
  }

  fpsToggle?.addEventListener("change", () => {
    applyFpsPref(Boolean(fpsToggle.checked));
  });

  window.addEventListener("message", (e) => {
    if (e.source !== frame.contentWindow) return;
    const d = e.data;
    if (d?.type === "sandspiel:fps-state") {
      try {
        localStorage.setItem(FPS_KEY, d.show ? "1" : "0");
      } catch (_) {}
      syncFpsToggle(Boolean(d.show));
    }
  });

  function syncFsBtn() {
    if (!fsBtn || !shell) return;
    const on = document.fullscreenElement === shell;
    fsBtn.setAttribute("aria-pressed", on ? "true" : "false");
    fsBtn.textContent = on ? "退出全屏" : "全屏";
    shell.classList.toggle("is-fullscreen", on);
  }

  async function toggleFullscreen() {
    if (!shell) return;
    try {
      if (document.fullscreenElement === shell) {
        await document.exitFullscreen();
      } else if (shell.requestFullscreen) {
        await shell.requestFullscreen();
      } else {
        shell.classList.toggle("is-fullscreen");
        syncFsBtn();
      }
    } catch (_) {
      shell.classList.toggle("is-fullscreen");
      syncFsBtn();
    }
  }

  fsBtn?.addEventListener("click", () => {
    toggleFullscreen();
  });
  document.addEventListener("fullscreenchange", () => {
    syncFsBtn();
    if (loaded) {
      postMsg({ type: "sandspiel:relayout" });
      callFrame("__sandspielRelayout");
    }
  });

  function onFrameReady() {
    applyFpsPref(readShowFps());
    postMsg({ type: "sandspiel:relayout" });
    callFrame("__sandspielRelayout");
    window.setTimeout(() => {
      applyFpsPref(readShowFps());
      postMsg({ type: "sandspiel:relayout" });
      callFrame("__sandspielRelayout");
    }, 500);
  }

  function ensureLoaded() {
    if (!panel.classList.contains("is-workspace-active")) {
      if (loaded) postMsg("sandspiel:pause");
      if (document.fullscreenElement === shell) {
        document.exitFullscreen?.().catch(() => {});
      }
      return;
    }
    if (!loaded) {
      loaded = true;
      frame.referrerPolicy = "no-referrer";
      frame.src = SRC;
      frame.addEventListener("load", onFrameReady, { once: true });
    } else {
      postMsg("sandspiel:play");
      onFrameReady();
    }
  }

  syncFpsToggle(readShowFps());
  syncFsBtn();

  window.addEventListener("devtools:route", ensureLoaded);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) postMsg("sandspiel:pause");
    else if (panel.classList.contains("is-workspace-active")) postMsg("sandspiel:play");
  });
  if (panel.classList.contains("is-workspace-active")) ensureLoaded();
})();
