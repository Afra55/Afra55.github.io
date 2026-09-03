(() => {
  "use strict";

  const THEME_VER = "2026.09.03-theme1";
  const CDN_BASE = "https://cdn.jsdelivr.net/gh/Afra55/Afra55.github.io@master/static/giscus";

  function resolveScheme(root) {
    const el = root || document.documentElement;
    const scheme = el.dataset.themeScheme;
    if (scheme === "light" || scheme === "dark") return scheme;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }

  function themeCssUrl(scheme, ver) {
    const file = scheme === "light" ? "giscus-theme-light.css" : "giscus-theme-dark.css";
    const q = `?v=${encodeURIComponent(ver || THEME_VER)}`;
    const host = location.hostname;
    if (host === "localhost" || host === "127.0.0.1") {
      return `${location.origin}/static/giscus/${file}${q}`;
    }
    if (/\.github\.io$/i.test(host)) {
      return `${CDN_BASE}/${file}${q}`;
    }
    return `${location.origin}/static/giscus/${file}${q}`;
  }

  window.GiscusThemeUtil = { resolveScheme, themeCssUrl, THEME_VER };
})();
