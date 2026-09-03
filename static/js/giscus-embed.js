(() => {
  "use strict";

  function mountFrom(el) {
    if (!el || el.dataset.giscusMounted === "1") return;
    const repo = el.dataset.repo;
    const repoId = el.dataset.repoId;
    const categoryId = el.dataset.categoryId;
    if (!repo || !repoId || !categoryId) return;

    const util = window.GiscusThemeUtil;
    const scheme = util?.resolveScheme?.() || "dark";
    const theme = util?.themeCssUrl?.(scheme, el.dataset.themeVer) || "preferred_color_scheme";

    const script = document.createElement("script");
    script.src = "https://giscus.app/client.js";
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.giscus = "1";
    script.setAttribute("data-repo", repo);
    script.setAttribute("data-repo-id", repoId);
    script.setAttribute("data-category", el.dataset.category || "Announcements");
    script.setAttribute("data-category-id", categoryId);
    script.setAttribute("data-mapping", el.dataset.mapping || "pathname");
    script.setAttribute("data-strict", el.dataset.strict || "0");
    script.setAttribute("data-reactions-enabled", el.dataset.reactionsEnabled || "0");
    script.setAttribute("data-emit-metadata", el.dataset.emitMetadata || "0");
    script.setAttribute("data-input-position", el.dataset.inputPosition || "bottom");
    script.setAttribute("data-theme", theme);
    script.setAttribute("data-lang", el.dataset.lang || "zh-CN");
    script.setAttribute("data-loading", "lazy");
    el.appendChild(script);
    el.dataset.giscusMounted = "1";

    if (!window.__giscusThemeObserver) {
      window.__giscusThemeObserver = new MutationObserver(() => {
        const iframe = el.querySelector("iframe.giscus-frame");
        if (!iframe?.contentWindow || !util) return;
        iframe.contentWindow.postMessage(
          { giscus: { setConfig: { theme: util.themeCssUrl(util.resolveScheme(), el.dataset.themeVer) } } },
          "https://giscus.app"
        );
      });
      window.__giscusThemeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme-scheme", "class"],
      });
      window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
        const iframe = el.querySelector("iframe.giscus-frame");
        if (!iframe?.contentWindow || !util) return;
        iframe.contentWindow.postMessage(
          { giscus: { setConfig: { theme: util.themeCssUrl(util.resolveScheme(), el.dataset.themeVer) } } },
          "https://giscus.app"
        );
      });
    }
  }

  document.querySelectorAll("[data-giscus-embed]").forEach(mountFrom);
})();
