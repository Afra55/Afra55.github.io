(() => {
  "use strict";

  const frame = document.getElementById("whiteboard-frame");
  const panel = document.getElementById("whiteboard");
  if (!frame || !panel) return;

  const SRC = "./excalidraw/index.html";
  let loaded = false;

  function ensureLoaded() {
    if (loaded) return;
    if (!panel.classList.contains("is-workspace-active")) return;
    loaded = true;
    frame.referrerPolicy = "no-referrer";
    frame.src = SRC;
  }

  window.addEventListener("devtools:route", ensureLoaded);
  if (panel.classList.contains("is-workspace-active")) ensureLoaded();
})();
