(() => {
  "use strict";

  const frame = document.getElementById("sandspiel-frame");
  const panel = document.getElementById("sandspiel");
  const shell = document.querySelector("#sandspiel .sandspiel-shell");
  const fpsToggle = document.getElementById("sandspiel-show-fps");
  const fsBtn = document.getElementById("sandspiel-fullscreen");
  if (!frame || !panel) return;

  const SRC = "./sandspiel/index.html";
  const FPS_KEY = "sandspiel-show-fps";
  let loaded = false;
  let shellNativeFs = false;

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

  function isSandspielFullscreen() {
    return !!shell && (document.fullscreenElement === shell || shell.classList.contains("is-fullscreen"));
  }

  function relayoutFrame() {
    if (!loaded) return;
    postMsg({ type: "sandspiel:relayout" });
    callFrame("__sandspielRelayout");
  }

  function syncFsBtn() {
    if (!fsBtn) return;
    const on = isSandspielFullscreen();
    fsBtn.setAttribute("aria-pressed", on ? "true" : "false");
    fsBtn.textContent = on ? "退出全屏" : "全屏";
  }

  function requestShellFullscreen() {
    if (!shell) return Promise.reject(new Error("no shell"));
    const req = shell.requestFullscreen || shell.webkitRequestFullscreen;
    if (!req) return Promise.reject(new Error("no requestFullscreen"));
    return Promise.resolve(req.call(shell));
  }

  function exitShellFullscreen() {
    const exit = document.exitFullscreen || document.webkitExitFullscreen;
    if (document.fullscreenElement && exit) {
      return Promise.resolve(exit.call(document)).catch(() => {});
    }
    return Promise.resolve();
  }

  function applyPseudoFullscreen(on) {
    if (!shell) return;
    shell.classList.toggle("is-fullscreen", on);
    document.body.classList.toggle("sandspiel-fs-active", on);
  }

  async function enterFullscreen() {
    if (!shell || isSandspielFullscreen()) return;
    let nativeOk = false;
    try {
      await requestShellFullscreen();
      nativeOk = document.fullscreenElement === shell;
      if (nativeOk) shellNativeFs = true;
    } catch (_) {}
    if (!nativeOk) applyPseudoFullscreen(true);
    syncFsBtn();
    window.setTimeout(relayoutFrame, 60);
  }

  async function exitFullscreen() {
    if (!shell || !isSandspielFullscreen()) return;
    const wasNative = document.fullscreenElement === shell;
    applyPseudoFullscreen(false);
    if (wasNative) {
      shellNativeFs = false;
      await exitShellFullscreen();
    }
    syncFsBtn();
    window.setTimeout(relayoutFrame, 60);
  }

  async function toggleFullscreen() {
    if (isSandspielFullscreen()) await exitFullscreen();
    else await enterFullscreen();
  }

  fsBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    toggleFullscreen();
  });

  function onFullscreenChange() {
    if (!shell) return;
    const nativeOn = document.fullscreenElement === shell;
    if (nativeOn) {
      shellNativeFs = true;
      applyPseudoFullscreen(false);
    } else if (shellNativeFs) {
      shellNativeFs = false;
      applyPseudoFullscreen(false);
    }
    syncFsBtn();
    relayoutFrame();
  }

  document.addEventListener("fullscreenchange", onFullscreenChange);
  document.addEventListener("webkitfullscreenchange", onFullscreenChange);

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !isSandspielFullscreen()) return;
    if (document.fullscreenElement === shell) return;
    exitFullscreen();
  });

  function onFrameReady() {
    applyFpsPref(readShowFps());
    relayoutFrame();
    window.setTimeout(() => {
      applyFpsPref(readShowFps());
      relayoutFrame();
    }, 500);
  }

  function ensureLoaded() {
    if (!panel.classList.contains("is-workspace-active")) {
      if (loaded) postMsg("sandspiel:pause");
      if (isSandspielFullscreen()) exitFullscreen();
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
