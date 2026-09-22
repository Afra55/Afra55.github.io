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
    try {
      const s = document.documentElement.dataset.themeScheme;
      if (s === "light" || s === "dark") return s;
    } catch (_) {}
    // 兜底：跟随系统
    try {
      if (window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
    } catch (_) {}
    return "dark";
  }

  function resolveTheme() {
    return resolveScheme() === "light" ? "noborder_light" : "noborder_dark";
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

  function wrapEl() {
    return document.querySelector(".devtools-giscus-wrap");
  }

  /** 评价汇总页本身就是列表，不再挂底部评论框 */
  const HIDE_GISCUS_TOOLS = new Set(["feedbackhub", "mdm"]);

  /** 只有 giscus 真正渲染出 iframe（或降级提示）时，才显示占位区/横线，避免空占位 */
  function syncWrapVisibility(host) {
    const wrap = wrapEl();
    if (!wrap || host !== hostEl()) return;
    const hasContent =
      Boolean(host.querySelector("iframe.giscus-frame")) || Boolean(host.querySelector(".giscus-setup-note"));
    wrap.hidden = !hasContent;
  }

  /** 监听宿主，giscus 注入 iframe 后自动显示占位区 */
  function watchHost(host) {
    if (host !== hostEl()) return;
    syncWrapVisibility(host);
    if (host.__devtoolsGiscusObs) host.__devtoolsGiscusObs.disconnect();
    const obs = new MutationObserver(() => syncWrapVisibility(host));
    obs.observe(host, { childList: true, subtree: true });
    host.__devtoolsGiscusObs = obs;
  }

  function mount(toolId) {
    const host = hostEl();
    const wrap = wrapEl();
    if (!host) return;

    if (HIDE_GISCUS_TOOLS.has(String(toolId || "").trim())) {
      if (wrap) wrap.hidden = true;
      host.innerHTML = "";
      lastTerm = "";
      return;
    }

    const term = termForTool(toolId);
    if (term === lastTerm && host.querySelector("script[data-giscus]")) return;
    lastTerm = term;
    renderInto(host, toolId);
    watchHost(host);
  }

  /** 把 giscus 渲染进指定容器（供弹框复用） */
  function renderInto(host, toolId) {
    if (!host) return;
    const c = cfg();
    // 修复：term 原先只在 mount 里定义，重构后 renderInto 仍引用它 → 抛 "term is not defined"，
    // 评论脚本根本没插入，导致评论区空白（只剩 border-top 横线）。
    const term = termForTool(toolId);
    host.innerHTML = "";
    if (!isReady()) {
      host.hidden = false;
      host.innerHTML = `<p class="hint giscus-setup-note">${SETUP_HTML}</p>`;
      syncWrapVisibility(host);
      return;
    }
    host.hidden = false;
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
    // eager：之前 lazy 需要容器进入视口才加载，配合下面的「隐藏空占位」会互相卡住
    script.setAttribute("data-loading", "eager");
    host.appendChild(script);
    ensureThemeObserver();
    syncWrapVisibility(host);
  }

  function sync(toolId) {
    try {
      mount(toolId);
    } catch (err) {
      console.warn("giscus sync failed", err);
    }
  }

  window.DevToolsGiscus = { sync, setTheme, termForTool, isReady, resolveTheme, mountInto: renderInto };
})();
