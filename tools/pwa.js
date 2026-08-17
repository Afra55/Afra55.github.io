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

  window.DevToolsPwa = {
    isStandalone,
    setInstallVisible,
    canPromptInstall: () => Boolean(deferredPrompt),
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
