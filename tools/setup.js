(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const panel = $("#setup");
  if (!panel) return;

  function detectOs() {
    const ua = navigator.userAgent || "";
    if (/Windows/i.test(ua)) return "win";
    if (/Mac/i.test(ua)) return "mac";
    return "linux";
  }

  function setOs(os) {
    const next = os === "win" || os === "linux" ? os : "mac";
    $$("[data-setup-os]", panel).forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.setupOs === next);
    });
    $$("[data-setup-panel]", panel).forEach((el) => {
      el.hidden = el.dataset.setupPanel !== next;
    });
    try {
      localStorage.setItem("devtools-setup-os", next);
    } catch (_) {}
  }

  $$("[data-setup-os]", panel).forEach((btn) => {
    btn.addEventListener("click", () => setOs(btn.dataset.setupOs));
  });

  let initial = detectOs();
  try {
    const saved = localStorage.getItem("devtools-setup-os");
    if (saved === "mac" || saved === "win" || saved === "linux") initial = saved;
  } catch (_) {}
  setOs(initial);

  window.DevToolsSetup = { setOs, detectOs };
})();
