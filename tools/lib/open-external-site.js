(() => {
  "use strict";

  /**
   * @param {string} url
   */
  async function openExternalUrl(url) {
    const target = String(url || "").trim();
    if (!target) return { ok: false, mode: "empty" };

    try {
      await window.DevToolsLazy?.loadPwa?.();
    } catch (_) {}

    const api = window.DevToolsPwa?.openExternal;
    if (typeof api === "function") {
      const res = api(target);
      if (res?.ok) return res;
    }

    try {
      const a = document.createElement("a");
      a.href = target;
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

  /**
   * @param {{ id: string, url: string }} cfg
   */
  function initExternalSite(cfg) {
    const id = String(cfg?.id || "").trim();
    const url = String(cfg?.url || "").trim();
    if (!id || !url) return;

    const panel = document.getElementById(id);
    const openBtn = document.getElementById(`${id}-open`);
    const linkEl = document.getElementById(`${id}-link`);
    if (!panel) return;

    if (linkEl) {
      linkEl.href = url;
      linkEl.target = "_blank";
      linkEl.rel = "noopener noreferrer external";
      linkEl.referrerPolicy = "no-referrer";
    }

    function syncPwaHint() {
      const hint = document.getElementById(`${id}-pwa-hint`);
      if (!hint) return;
      hint.hidden = window.DevToolsPwa?.isStandalone?.() !== true;
    }

    async function openSite() {
      await openExternalUrl(url);
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
  }

  window.DevToolsOpenExternalSite = {
    init: initExternalSite,
    openUrl: openExternalUrl,
  };
})();
