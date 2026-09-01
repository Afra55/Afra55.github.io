(() => {
  "use strict";

  const BUILD = window.TOOLS_BUILD || "2026.08.30-232500";
  const mount = () => document.getElementById("workspace-panels");

  const htmlCache = new Map();
  const cssLoaded = new Set();
  const mounted = new Set();
  const inflight = new Map();

  function withVersion(src) {
    const url = new URL(src, document.baseURI || window.location.href);
    url.searchParams.set("v", BUILD);
    return url.pathname + url.search;
  }

  async function fetchText(url) {
    const res = await fetch(withVersion(url), { cache: "no-cache" });
    if (!res.ok) throw new Error(`加载失败：${url} (${res.status})`);
    return res.text();
  }

  async function loadPanelHtml(toolId) {
    const id = String(toolId || "").trim();
    if (!id) throw new Error("panel id required");
    if (htmlCache.has(id)) return htmlCache.get(id);
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

  function ensurePanelCss(toolId) {
    const id = String(toolId || "").trim();
    if (!id || cssLoaded.has(id)) return Promise.resolve();
    if (inflight.has(`css:${id}`)) return inflight.get(`css:${id}`);

    const href = withVersion(`./styles/panels/${id}.css`);
    const existing = [...document.querySelectorAll('link[data-panel-css]')].find(
      (l) => l.getAttribute("href") === href
    );
    if (existing) {
      cssLoaded.add(id);
      return Promise.resolve();
    }

    const promise = fetch(withVersion(`./styles/panels/${id}.css`), { method: "HEAD", cache: "no-cache" })
      .then((res) => {
        if (!res.ok) {
          cssLoaded.add(id);
          return;
        }
        const link = document.createElement("link");
        link.rel = "stylesheet";
        link.href = href;
        link.dataset.panelCss = id;
        document.head.appendChild(link);
        cssLoaded.add(id);
      })
      .catch(() => {
        cssLoaded.add(id);
      })
      .finally(() => inflight.delete(`css:${id}`));
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
    return panel;
  }

  async function ensure(toolId) {
    const id = String(toolId || "").trim();
    if (!id) return null;
    if (mounted.has(id)) {
      await ensurePanelCss(id);
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

  window.DevToolsPanels = {
    BUILD,
    ensure,
    bootReady: bootPromise,
    isMounted: (id) => mounted.has(String(id || "").trim()),
  };
})();
