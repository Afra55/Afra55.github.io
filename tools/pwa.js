/**
 * DevTools PWA：注册 Service Worker，并在可安装时露出「安装应用」按钮。
 * 已作为独立窗口 / 桌面应用打开时不显示安装入口。
 */
(function () {
  const btn = document.getElementById("pwa-install");
  let deferredPrompt = null;

  function isStandalone() {
    try {
      if (window.matchMedia("(display-mode: standalone)").matches) return true;
      if (window.matchMedia("(display-mode: window-controls-overlay)").matches) return true;
    } catch (_) {}
    return window.navigator.standalone === true;
  }

  function syncStandaloneClass() {
    document.documentElement.classList.toggle("is-pwa-standalone", isStandalone());
  }

  function setInstallVisible(on) {
    if (!btn) return;
    const show = Boolean(on) && !isStandalone();
    btn.hidden = !show;
    btn.setAttribute("aria-hidden", show ? "false" : "true");
    const menuPwa = document.getElementById("header-more-pwa");
    if (menuPwa) {
      menuPwa.hidden = !show;
      menuPwa.setAttribute("aria-hidden", show ? "false" : "true");
    }
  }

  syncStandaloneClass();
  setInstallVisible(false);

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    setInstallVisible(!isStandalone());
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    syncStandaloneClass();
    setInstallVisible(false);
  });

  try {
    const mq = window.matchMedia("(display-mode: standalone)");
    const onMode = () => {
      syncStandaloneClass();
      if (isStandalone()) setInstallVisible(false);
    };
    if (typeof mq.addEventListener === "function") mq.addEventListener("change", onMode);
    else if (typeof mq.addListener === "function") mq.addListener(onMode);
  } catch (_) {}

  btn?.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    try {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch (_) {
      /* user dismissed or unsupported */
    }
    deferredPrompt = null;
    setInstallVisible(false);
  });

  /**
   * 在外部浏览器打开链接（PWA 独立窗口内尽量跳出到系统浏览器）。
   * @returns {{ ok: boolean, mode?: string }}
   */
  function openExternal(url) {
    const raw = String(url || "").trim();
    if (!raw) return { ok: false, mode: "empty" };

    const standalone = isStandalone();

    /** @param {string} href @param {"anchor"|"blank"|"open"} kind */
    function tryOpen(href, kind) {
      try {
        if (kind === "anchor") {
          const a = document.createElement("a");
          a.href = href;
          a.target = "_blank";
          a.rel = "noopener noreferrer external";
          a.referrerPolicy = "no-referrer";
          document.body.appendChild(a);
          a.click();
          a.remove();
          return true;
        }
        const features = "noopener,noreferrer";
        const win = window.open(kind === "blank" ? "" : href, "_blank", features);
        if (!win) return false;
        try {
          win.opener = null;
        } catch (_) {}
        if (kind === "blank") {
          win.location.href = href;
        }
        return true;
      } catch (_) {
        return false;
      }
    }

    if (!standalone) {
      if (tryOpen(raw, "anchor") || tryOpen(raw, "open")) return { ok: true, mode: "browser" };
      return { ok: false, mode: "blocked" };
    }

    // PWA：先 blank 再赋值 location，iOS/Android 上更容易落到系统浏览器
    if (tryOpen(raw, "blank")) return { ok: true, mode: "pwa-blank" };
    if (tryOpen(raw, "anchor")) return { ok: true, mode: "pwa-anchor" };
    if (tryOpen(raw, "open")) return { ok: true, mode: "pwa-open" };
    return { ok: false, mode: "blocked" };
  }

  window.DevToolsPwa = {
    isStandalone,
    setInstallVisible,
    canPromptInstall: () => Boolean(deferredPrompt),
    openExternal,
  };

  if (!("serviceWorker" in navigator)) return;
  const ready = () => {
    const ver = window.TOOLS_VERSION || document.getElementById("site-tools-version")?.textContent || "1";
    navigator.serviceWorker
      .register(`./sw.js?v=${encodeURIComponent(String(ver).replace(/^v/, ""))}`, { scope: "./" })
      .then((reg) => {
        try {
          reg.update();
        } catch (_) {}
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") {
            try {
              reg.update();
            } catch (_) {}
          }
        });
      })
      .catch(() => {});
  };
  if (document.readyState === "complete") ready();
  else window.addEventListener("load", ready, { once: true });
})();
