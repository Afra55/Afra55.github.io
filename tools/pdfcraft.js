(() => {
  "use strict";

  const URL_ZH = "https://pdfcraft.devtoolcafe.com/zh/";
  const panel = document.getElementById("pdfcraft");
  const openBtn = document.getElementById("pdfcraft-open");
  const linkEl = document.getElementById("pdfcraft-link");
  if (!panel) return;

  if (linkEl) {
    linkEl.href = URL_ZH;
    linkEl.target = "_blank";
    linkEl.rel = "noopener noreferrer external";
    linkEl.referrerPolicy = "no-referrer";
  }

  async function openSite() {
    try {
      await window.DevToolsLazy?.loadPwa?.();
    } catch (_) {}
    const api = window.DevToolsPwa?.openExternal;
    if (typeof api === "function") {
      const res = api(URL_ZH);
      if (res?.ok) return res;
    }
    try {
      const a = document.createElement("a");
      a.href = URL_ZH;
      a.target = "_blank";
      a.rel = "noopener noreferrer external";
      a.referrerPolicy = "no-referrer";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return { ok: true, mode: "fallback-anchor" };
    } catch (_) {
      return { ok: false, mode: "blocked" };
    }
  }

  function syncPwaHint() {
    const hint = document.getElementById("pdfcraft-pwa-hint");
    if (!hint) return;
    const standalone = window.DevToolsPwa?.isStandalone?.() === true;
    hint.hidden = !standalone;
  }

  async function onActivate() {
    if (!panel.classList.contains("is-workspace-active")) return;
    syncPwaHint();
    await openSite();
  }

  openBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    void openSite();
  });

  linkEl?.addEventListener("click", (e) => {
    e.preventDefault();
    void openSite();
  });

  window.addEventListener("devtools:route", () => {
    void onActivate();
  });
  if (panel.classList.contains("is-workspace-active")) void onActivate();
})();
