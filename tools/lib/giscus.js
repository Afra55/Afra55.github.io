(() => {
  "use strict";

  const SETUP_HTML =
    '评论基于 <a href="https://giscus.app/zh-CN" rel="noopener noreferrer" target="_blank">giscus</a>（GitHub Discussions）。' +
    "请仓库管理员开启 Discussions、安装 " +
    '<a href="https://github.com/apps/giscus" rel="noopener noreferrer" target="_blank">giscus App</a>，' +
    "再运行 <code>node tools/scripts/fetch-giscus-ids.cjs</code> 写入 categoryId。";

  let lastTerm = "";
  let themeObserver = null;

  function cfg() {
    return window.DevToolsGiscusConfig || {};
  }

  function isReady() {
    const c = cfg();
    return !!(c.enabled && c.repo && c.repoId && c.category && c.categoryId);
  }

  function themeUtil() {
    return window.GiscusThemeUtil;
  }

  function resolveScheme() {
    return themeUtil()?.resolveScheme?.() || "dark";
  }

  function resolveTheme() {
    const util = themeUtil();
    if (!util) return resolveScheme() === "light" ? "noborder_light" : "noborder_dark";
    return util.themeCssUrl(resolveScheme(), window.TOOLS_BUILD || util.THEME_VER);
  }

  function termForTool(toolId) {
    const id = String(toolId || "timestamp").trim() || "timestamp";
    return `devtools/${id}`;
  }

  function hostEl() {
    return document.getElementById("devtools-giscus");
  }

  function setTheme(theme) {
    const iframe = hostEl()?.querySelector("iframe.giscus-frame");
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.postMessage(
      { giscus: { setConfig: { theme: theme || resolveTheme() } } },
      "https://giscus.app"
    );
  }

  function ensureThemeObserver() {
    if (themeObserver) return;
    themeObserver = new MutationObserver(() => setTheme());
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme-scheme", "data-theme"],
    });
  }

  function mount(toolId) {
    const host = hostEl();
    if (!host) return;
    const c = cfg();
    if (!isReady()) {
      host.hidden = false;
      host.innerHTML = `<p class="hint giscus-setup-note">${SETUP_HTML}</p>`;
      lastTerm = "";
      return;
    }

    const term = termForTool(toolId);
    if (term === lastTerm && host.querySelector("script[data-giscus]")) return;
    lastTerm = term;

    host.hidden = false;
    host.innerHTML = "";
    const script = document.createElement("script");
    script.src = "https://giscus.app/client.js";
    script.async = true;
    script.crossOrigin = "anonymous";
    script.dataset.giscus = "1";
    script.setAttribute("data-repo", c.repo);
    script.setAttribute("data-repo-id", c.repoId);
    script.setAttribute("data-category", c.category);
    script.setAttribute("data-category-id", c.categoryId);
    script.setAttribute("data-mapping", c.mapping || "specific");
    script.setAttribute("data-term", term);
    script.setAttribute("data-strict", c.strict || "0");
    script.setAttribute("data-reactions-enabled", c.reactionsEnabled || "0");
    script.setAttribute("data-emit-metadata", c.emitMetadata || "0");
    script.setAttribute("data-input-position", c.inputPosition || "bottom");
    script.setAttribute("data-theme", resolveTheme());
    script.setAttribute("data-lang", c.lang || "zh-CN");
    script.setAttribute("data-loading", "lazy");
    host.appendChild(script);
    ensureThemeObserver();
  }

  function sync(toolId) {
    try {
      mount(toolId);
    } catch (err) {
      console.warn("giscus sync failed", err);
    }
  }

  window.DevToolsGiscus = { sync, setTheme, termForTool, isReady, resolveTheme };
})();
