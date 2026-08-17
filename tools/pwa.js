/**
 * DevTools PWA：注册 Service Worker，并在可安装时露出「安装应用」按钮。
 */
(function () {
  const btn = document.getElementById("pwa-install");
  let deferredPrompt = null;

  function setInstallVisible(on) {
    if (!btn) return;
    btn.hidden = !on;
    btn.setAttribute("aria-hidden", on ? "false" : "true");
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    setInstallVisible(true);
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    setInstallVisible(false);
  });

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

  if (!("serviceWorker" in navigator)) return;
  const ready = () => {
    navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
  };
  if (document.readyState === "complete") ready();
  else window.addEventListener("load", ready, { once: true });

  window.DevToolsPwa = {
    isStandalone: () =>
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true,
    canPromptInstall: () => Boolean(deferredPrompt),
  };
})();
