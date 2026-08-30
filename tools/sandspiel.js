(() => {
  "use strict";

  const frame = document.getElementById("sandspiel-frame");
  const panel = document.getElementById("sandspiel");
  if (!frame || !panel) return;

  const SRC = "./sandspiel/index.html";
  let loaded = false;

  function post(type) {
    try {
      frame.contentWindow?.postMessage(type, "*");
    } catch (_) {}
  }

  function ensureLoaded() {
    if (!panel.classList.contains("is-workspace-active")) {
      if (loaded) post("sandspiel:pause");
      return;
    }
    if (!loaded) {
      loaded = true;
      frame.referrerPolicy = "no-referrer";
      frame.src = SRC;
    } else {
      post("sandspiel:play");
    }
  }

  window.addEventListener("devtools:route", ensureLoaded);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) post("sandspiel:pause");
    else if (panel.classList.contains("is-workspace-active")) post("sandspiel:play");
  });
  if (panel.classList.contains("is-workspace-active")) ensureLoaded();
})();
