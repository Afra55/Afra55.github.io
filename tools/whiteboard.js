(() => {
  "use strict";

  const frame = document.getElementById("whiteboard-frame");
  const panel = document.getElementById("whiteboard");
  const shell = document.getElementById("whiteboard-shell");
  const fsBtn = document.getElementById("whiteboard-fullscreen");
  const loadWrap = document.getElementById("whiteboard-load");
  const loadFill = document.getElementById("whiteboard-load-fill");
  const loadText = document.getElementById("whiteboard-load-text");
  if (!frame || !panel) return;

  const SRC = "./excalidraw/index.html";
  let loaded = false;
  let loading = false;
  let loadTicker = 0;
  let shellNativeFs = false;

  function setLoadProgress(pct, text) {
    if (!loadWrap || !loadFill) return;
    const v = Math.max(0, Math.min(100, Math.round(pct)));
    loadWrap.hidden = false;
    loadFill.style.width = `${Math.max(v, v > 0 && v < 100 ? 8 : v)}%`;
    if (loadText && text) loadText.textContent = text;
  }

  function hideLoadProgress() {
    if (loadTicker) {
      clearInterval(loadTicker);
      loadTicker = 0;
    }
    if (loadWrap) loadWrap.hidden = true;
    if (loadFill) loadFill.style.width = "0%";
    frame.classList.remove("is-loading");
  }

  function startLoadTicker() {
    if (loadTicker) return;
    const started = Date.now();
    let p = 8;
    setLoadProgress(p, "正在加载画板资源…");
    frame.classList.add("is-loading");
    loadTicker = window.setInterval(() => {
      if (!loading) return;
      const elapsed = Math.max(1, Math.round((Date.now() - started) / 1000));
      p = Math.min(88, p + (p < 42 ? 2.4 : p < 72 ? 1.1 : 0.35));
      let line = "正在加载画板资源…";
      if (elapsed >= 10) line = `加载中 · ${elapsed}s · 资源较多请稍候`;
      else if (elapsed >= 4) line = `加载中 · ${elapsed}s · 首次约 46MB`;
      setLoadProgress(p, line);
    }, 480);
  }

  function relayoutFrame() {
    if (!loaded) return;
    try {
      frame.contentWindow?.dispatchEvent(new Event("resize"));
    } catch (_) {}
    window.setTimeout(() => {
      try {
        frame.contentWindow?.dispatchEvent(new Event("resize"));
      } catch (_) {}
    }, 80);
  }

  function isWhiteboardFullscreen() {
    return !!shell && (document.fullscreenElement === shell || shell.classList.contains("is-fullscreen"));
  }

  function syncFsBtn() {
    if (!fsBtn) return;
    const on = isWhiteboardFullscreen();
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
    document.body.classList.toggle("whiteboard-fs-active", on);
  }

  async function enterFullscreen() {
    if (!shell || isWhiteboardFullscreen()) return;
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
    if (!shell || !isWhiteboardFullscreen()) return;
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
    if (isWhiteboardFullscreen()) await exitFullscreen();
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
    if (e.key !== "Escape" || !isWhiteboardFullscreen()) return;
    if (document.fullscreenElement === shell) return;
    exitFullscreen();
  });

  async function waitForEditorReady() {
    const deadline = Date.now() + 120000;
    while (Date.now() < deadline) {
      if (!panel.classList.contains("is-workspace-active")) return false;
      try {
        const root = frame.contentDocument?.getElementById("root");
        if (root?.childElementCount > 0) return true;
      } catch (_) {}
      await new Promise((r) => window.setTimeout(r, 120));
    }
    return true;
  }

  async function ensureLoaded() {
    if (!panel.classList.contains("is-workspace-active")) {
      if (isWhiteboardFullscreen()) exitFullscreen();
      return;
    }
    if (loaded) {
      relayoutFrame();
      return;
    }
    if (loading) return;

    loading = true;
    startLoadTicker();
    frame.referrerPolicy = "no-referrer";
    frame.src = SRC;

    await new Promise((resolve) => {
      frame.addEventListener("load", resolve, { once: true });
    });
    if (!panel.classList.contains("is-workspace-active")) {
      loading = false;
      hideLoadProgress();
      return;
    }

    setLoadProgress(72, "正在启动编辑器…");
    await waitForEditorReady();

    loaded = true;
    loading = false;
    setLoadProgress(100, "画板已就绪");
    frame.classList.remove("is-loading");
    window.setTimeout(() => {
      hideLoadProgress();
      relayoutFrame();
    }, 220);
  }

  window.addEventListener("devtools:route", () => {
    ensureLoaded();
  });
  if (panel.classList.contains("is-workspace-active")) ensureLoaded();
})();
