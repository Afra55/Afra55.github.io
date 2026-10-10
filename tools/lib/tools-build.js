(() => {
  "use strict";
  const BUILD = "2026.10.10-135314";
  window.TOOLS_BUILD = BUILD;
  window.TOOLS_VERSION = BUILD;

  /**
   * 解析 tools/ 下资源 URL。
   * 避免 location 落在 /tools（无尾斜杠）时 `./vendor/...` 指到站根 404；
   * 动态 import / fetch 统一带 ?v=TOOLS_VERSION。
   * 锚点优先 tools-build.js /tools/lib/*，避免误用错误相对路径注入的 /scripts/lib/*。
   * @param {string} relPath 相对 tools 根，如 vendor/gifsicle.min.js 或 ./vendor/gifski/gifski_wasm.js
   * @param {{ cacheBust?: string|number, version?: string|boolean }} [opts]
   */
  function resolveToolsAssetUrl(relPath, opts = {}) {
    const clean = String(relPath || "")
      .replace(/^\.\//, "")
      .replace(/^\/+/, "");
    const useVer = opts.version !== false;
    const ver = encodeURIComponent(
      String(opts.version && opts.version !== true ? opts.version : BUILD || "").replace(/^v/, "")
    );
    const q = [];
    if (useVer && ver) q.push(`v=${ver}`);
    if (opts.cacheBust != null && opts.cacheBust !== "") {
      q.push(`r=${encodeURIComponent(String(opts.cacheBust))}`);
    }
    const qs = q.length ? `?${q.join("&")}` : "";
    const rel = `${clean}${qs}`;
    const nodes = document.getElementsByTagName("script");
    const prefer = [];
    const fallbackLib = [];
    const fallbackRoot = [];
    for (let i = nodes.length - 1; i >= 0; i--) {
      const src = nodes[i].src || "";
      if (!src) continue;
      if (/\/tools\/lib\/tools-build\.js(\?|#|$)/i.test(src)) prefer.push(src);
      else if (/\/tools\/lib\/[^/]+\.js(\?|#|$)/i.test(src)) fallbackLib.push(src);
      else if (/\/tools\/(?:app|extra|lazy-scripts|pwa)\.js(\?|#|$)/i.test(src)) fallbackRoot.push(src);
    }
    const libSrc = prefer[0] || fallbackLib[0];
    if (libSrc) return new URL(`../${rel}`, libSrc).href;
    if (fallbackRoot[0]) return new URL(`./${rel}`, fallbackRoot[0]).href;

    // 自身脚本 URL（tools-build 正在执行时 document 上已有本标签）
    try {
      const cur = document.currentScript && document.currentScript.src;
      if (cur && /\/tools\/lib\//i.test(cur)) return new URL(`../${rel}`, cur).href;
    } catch (_) {
      /* ignore */
    }

    let base = document.baseURI || window.location.href;
    try {
      const u = new URL(base);
      // /repo/tools 或 /tools → 补尾斜杠；已在 /tools/xxx 子路径时提到 /tools/
      if (/\/tools$/i.test(u.pathname)) {
        u.pathname += "/";
        base = u.href;
      } else {
        const m = u.pathname.match(/^(.*?\/tools)\//i);
        if (m) {
          u.pathname = `${m[1]}/`;
          u.search = "";
          u.hash = "";
          base = u.href;
        }
      }
    } catch (_) {
      /* ignore */
    }
    return new URL(`./${rel}`, base).href;
  }
  window.resolveToolsAssetUrl = resolveToolsAssetUrl;
  window.DevToolsResolveToolsAsset = resolveToolsAssetUrl;

  /** 本脚本绝对 URL（DOMContentLoaded 后 currentScript 已空，须启动时缓存） */
  const TOOLS_BUILD_SCRIPT_SRC = (() => {
    try {
      if (document.currentScript && document.currentScript.src) return document.currentScript.src;
    } catch (_) {
      /* ignore */
    }
    const nodes = document.getElementsByTagName("script");
    for (let i = nodes.length - 1; i >= 0; i--) {
      const src = nodes[i].src || "";
      if (/\/tools\/lib\/tools-build\.js(\?|#|$)/i.test(src)) return src;
    }
    return "";
  })();

  /** 相对「本 tools-build.js」解析，避免页面不在 /tools/ 根时 ./lib 指错 */
  function resolveFromToolsBuild(rel) {
    if (TOOLS_BUILD_SCRIPT_SRC) {
      try {
        return new URL(rel, TOOLS_BUILD_SCRIPT_SRC).href;
      } catch (_) {
        /* ignore */
      }
    }
    return resolveToolsAssetUrl(String(rel || "").replace(/^\.\.\//, ""), { version: false });
  }

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
    const hostsUrl = resolveFromToolsBuild("./shell-hosts.html?v=" + encodeURIComponent(BUILD));
    fetch(hostsUrl, { cache: "no-store" })
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
  addCss(resolveFromToolsBuild("../styles/bridge-shell.css?v=" + encodeURIComponent(BUILD)));
  addScript(resolveFromToolsBuild("./bridge-token.js?v=" + encodeURIComponent(BUILD)));
  addScript(resolveFromToolsBuild("./unified-bridge-bundle.js?v=" + encodeURIComponent(BUILD)));
  addScript(resolveFromToolsBuild("./bridge-shell.js?v=" + encodeURIComponent(BUILD)));

  try {
    if (!document.querySelector("script[data-kidsflash-nav]")) {
      const s = document.createElement("script");
      s.src = resolveFromToolsBuild("./kids-flash-nav.js?v=" + encodeURIComponent(BUILD));
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
