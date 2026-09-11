(() => {
  "use strict";
  const BUILD = "2026.09.11-120946";
  window.TOOLS_BUILD = BUILD;
  window.TOOLS_VERSION = BUILD;

  function paintVersion() {
    const el = document.getElementById("site-tools-version");
    if (!el) return;
    el.textContent = `v${BUILD}`;
    el.title = `工具页逻辑版本 ${BUILD}`;
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", paintVersion, { once: true });
  } else paintVersion();

  try { localStorage.setItem("devtools-seen-build-v1", BUILD); } catch (_) {}

  function injectHosts() {
    if (document.getElementById("muyu-fs") && document.getElementById("nav-organize") && document.getElementById("vsplit-fs")) return;
    fetch("./lib/shell-hosts.html?v=" + encodeURIComponent(BUILD), { cache: "no-store" })
      .then((r) => (r.ok ? r.text() : Promise.reject()))
      .then((html) => {
        const box = document.createElement("div");
        box.innerHTML = html;
        [...box.children].forEach((node) => {
          const id = node.id;
          if (id && document.getElementById(id)) return;
          document.body.appendChild(node);
        });
      })
      .catch(() => {});
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", injectHosts, { once: true });
  } else injectHosts();

  function addCss(href) {
    const file = href.split("?")[0];
    if (document.querySelector(`link[href*="${file}"]`)) return;
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    document.head.appendChild(l);
  }
  function addScript(src) {
    const file = src.split("?")[0];
    if (document.querySelector(`script[src*="${file}"]`)) return;
    const s = document.createElement("script");
    s.src = src;
    document.head.appendChild(s);
  }
  addCss("./styles/bridge-shell.css?v=" + encodeURIComponent(BUILD));
  addScript("./lib/bridge-token.js?v=" + encodeURIComponent(BUILD));
  addScript("./lib/unified-bridge-bundle.js?v=" + encodeURIComponent(BUILD));
  addScript("./lib/bridge-shell.js?v=" + encodeURIComponent(BUILD));

  try {
    if (!document.querySelector("script[data-kidsflash-nav]")) {
      const s = document.createElement("script");
      s.src = "./lib/kids-flash-nav.js?v=" + encodeURIComponent(BUILD);
      s.async = true;
      s.dataset.kidsflashNav = "1";
      document.head.appendChild(s);
    }
  } catch (_) {}

  try {
    const synth = window.speechSynthesis;
    if (synth && !synth.__devtoolsSpeakPatched) {
      synth.__devtoolsSpeakPatched = true;
      const origSpeak = synth.speak.bind(synth);
      const origCancel = synth.cancel.bind(synth);
      synth.cancel = function () {
        try { origCancel(); } catch (_) {}
        try { if (synth.paused) synth.resume(); } catch (_) {}
      };
      synth.speak = function (utterance) {
        if (!utterance) return;
        try { if (synth.paused) synth.resume(); } catch (_) {}
        try { origSpeak(utterance); } catch (_) {}
      };
    }
  } catch (_) {}
})();
