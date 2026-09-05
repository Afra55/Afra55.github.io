(() => {
  "use strict";

  const BUILD = window.TOOLS_BUILD || "2026.08.30-232500";
  const mount = () => document.getElementById("workspace-panels");

  const htmlCache = new Map();
  const cssLoaded = new Set();
  const mounted = new Set();
  const inflight = new Map();

  function isForceFreshLoad() {
    try {
      return new URLSearchParams(location.search).has("_fresh");
    } catch (_) {
      return false;
    }
  }

  function fetchInit(extra = {}) {
    return isForceFreshLoad() ? { cache: "no-store", ...extra } : { cache: "default", ...extra };
  }

  function withVersion(src) {
    const url = new URL(src, document.baseURI || window.location.href);
    url.searchParams.set("v", BUILD);
    return url.href;
  }

  async function fetchText(url) {
    const res = await fetch(withVersion(url), fetchInit());
    if (!res.ok) throw new Error(`加载失败：${url} (${res.status})`);
    return res.text();
  }

  async function loadPanelHtml(toolId) {
    const id = String(toolId || "").trim();
    if (!id) throw new Error("panel id required");
    if (!isForceFreshLoad() && htmlCache.has(id)) return htmlCache.get(id);
    if (inflight.has(`html:${id}`)) return inflight.get(`html:${id}`);

    const promise = fetchText(`./panels/${id}.html`)
      .then((html) => {
        htmlCache.set(id, html);
        return html;
      })
      .finally(() => inflight.delete(`html:${id}`));
    inflight.set(`html:${id}`, promise);
    return promise;
  }

  function loadStylesheet(id, href) {
    const existing = [...document.querySelectorAll("link[data-panel-css]")].find(
      (l) => l.dataset.panelCss === id || l.href === href || l.getAttribute("href") === href
    );
    if (existing) {
      cssLoaded.add(id);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.dataset.panelCss = id;
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        cssLoaded.add(id);
        resolve();
      };
      link.addEventListener("load", done);
      link.addEventListener("error", done);
      document.head.appendChild(link);
      // 兜底：避免个别环境不触发 load
      window.setTimeout(done, 2000);
    });
  }

  function ensurePanelCss(toolId) {
    const id = String(toolId || "").trim();
    if (!id || cssLoaded.has(id)) return Promise.resolve();
    if (inflight.has(`css:${id}`)) return inflight.get(`css:${id}`);

    const href = withVersion(`./styles/panels/${id}.css`);
    const promise = (async () => {
      // 认物闪卡面板 CSS 多为 @import kidsflash；WebKit 上 link.onload 可能早于 @import 完成
      if (/earn$/.test(id) && id !== "animalearn") {
        const sharedId = "kidsflash-shared";
        if (!cssLoaded.has(sharedId)) {
          await loadStylesheet(sharedId, withVersion("./styles/panels/kidsflash.css"));
        }
      }
      try {
        const res = await fetch(withVersion(`./styles/panels/${id}.css`), fetchInit({ method: "HEAD" }));
        if (!res.ok) {
          cssLoaded.add(id);
          return;
        }
      } catch (_) {
        cssLoaded.add(id);
        return;
      }
      await loadStylesheet(id, href);
    })().finally(() => inflight.delete(`css:${id}`));
    inflight.set(`css:${id}`, promise);
    return promise;
  }

  function mountPanel(toolId, html) {
    const root = mount();
    if (!root) throw new Error("#workspace-panels missing");
    const id = String(toolId || "").trim();
    let panel = document.getElementById(id);
    if (!panel) {
      const wrap = document.createElement("div");
      wrap.innerHTML = html.trim();
      panel = wrap.firstElementChild;
      if (!panel || panel.id !== id) throw new Error(`panel markup invalid: ${id}`);
      root.appendChild(panel);
    }
    mounted.add(id);
    notifyExtraBind(id);
    return panel;
  }

  function notifyExtraBind(panelId) {
    const id = String(panelId || "").trim();
    if (!id) return;
    try {
      window.DevToolsExtraBind?.bind?.(id);
    } catch (_) {
      /* extra.js 尚未加载 */
    }
    try {
      window.dispatchEvent(new CustomEvent("devtools:panel-mounted", { detail: { id } }));
    } catch (_) {
      /* ignore */
    }
  }

  async function ensure(toolId) {
    const id = String(toolId || "").trim();
    if (!id) return null;
    if (mounted.has(id)) {
      await ensurePanelCss(id);
      notifyExtraBind(id);
      return document.getElementById(id);
    }
    const [html] = await Promise.all([loadPanelHtml(id), ensurePanelCss(id)]);
    return mountPanel(id, html);
  }

  function bootPanelId() {
    try {
      return document.documentElement.dataset.bootPanel || "timestamp";
    } catch (_) {
      return "timestamp";
    }
  }

  const bootPromise = (async () => {
    const id = bootPanelId();
    try {
      document.documentElement.dataset.panelLoading = id;
      await ensure(id);
    } catch (err) {
      console.error("boot panel load failed", id, err);
    } finally {
      delete document.documentElement.dataset.panelLoading;
    }
  })();

  function clearSessionCache() {
    htmlCache.clear();
    cssLoaded.clear();
    mounted.clear();
    inflight.clear();
  }

  if (isForceFreshLoad()) clearSessionCache();

  window.DevToolsPanels = {
    BUILD,
    ensure,
    bootReady: bootPromise,
    isMounted: (id) => mounted.has(String(id || "").trim()),
    clearSessionCache,
    isForceFreshLoad,
    prefetchHtml: (toolId) => loadPanelHtml(toolId).catch(() => null),
  };
})();
