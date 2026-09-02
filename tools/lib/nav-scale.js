(() => {
  "use strict";

  /** 分组内工具数 ≥ 此值时启用侧栏虚拟列表（当前站点不会触发，为未来扩展预留） */
  const NAV_VIRTUAL_GROUP_MIN = 48;
  const NAV_VIRTUAL_ROW_PX = 36;
  const NAV_SCALABLE_MIN_TOOLS = 100;
  const SEARCH_DEBOUNCE_MS = 120;

  function buildSearchIndex(meta) {
    const entries = [];
    for (const [id, m] of Object.entries(meta || {})) {
      if (!m || typeof m !== "object") continue;
      const hay = `${m.name || ""} ${(m.aliases || []).join(" ")} ${id}`.toLowerCase();
      entries.push({ id, hay });
    }
    return entries;
  }

  /** @returns {Set<string>|null} null 表示不过滤（显示全部） */
  function matchTools(index, query) {
    const q = String(query || "").trim().toLowerCase();
    if (!q) return null;
    const out = new Set();
    for (const e of index) {
      if (e.hay.includes(q)) out.add(e.id);
    }
    return out;
  }

  function debounce(fn, ms) {
    let timer = 0;
    return (...args) => {
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = 0;
        fn(...args);
      }, ms);
    };
  }

  /**
   * 轻量虚拟列表：仅渲染可见区 ±overscan 的条目；条目数不足 minItems 时不启用。
   * renderItem(index) 应返回已挂好事件的 DOM 节点。
   */
  function mountGroupVirtualList(toolsWrap, indices, renderItem, opts = {}) {
    const minItems = opts.minItems ?? NAV_VIRTUAL_GROUP_MIN;
    const rowPx = opts.rowPx ?? NAV_VIRTUAL_ROW_PX;
    if (!toolsWrap || indices.length < minItems) return null;

    toolsWrap.classList.add("nav-group-tools-virtual");
    toolsWrap.style.maxHeight = opts.maxHeight || "min(52vh, 420px)";
    toolsWrap.style.overflow = "auto";

    const host = document.createElement("div");
    host.className = "nav-virtual-host";
    host.style.position = "relative";
    host.style.height = `${indices.length * rowPx}px`;
    toolsWrap.innerHTML = "";
    toolsWrap.appendChild(host);

    const state = { indices, renderItem, rowPx, host, toolsWrap, raf: 0 };

    const paint = () => {
      state.raf = 0;
      const scrollTop = toolsWrap.scrollTop;
      const viewH = toolsWrap.clientHeight || 320;
      const start = Math.max(0, Math.floor(scrollTop / rowPx) - 3);
      const end = Math.min(indices.length, Math.ceil((scrollTop + viewH) / rowPx) + 3);
      host.innerHTML = "";
      for (let i = start; i < end; i++) {
        const id = indices[i];
        const node = renderItem(id, i);
        if (!node) continue;
        node.style.position = "absolute";
        node.style.top = `${i * rowPx}px`;
        node.style.left = "0";
        node.style.right = "0";
        node.style.minHeight = `${rowPx}px`;
        host.appendChild(node);
      }
    };

    const onScroll = () => {
      if (state.raf) return;
      state.raf = requestAnimationFrame(paint);
    };

    toolsWrap.addEventListener("scroll", onScroll, { passive: true });
    paint();

    return {
      refresh(nextIndices) {
        state.indices = nextIndices;
        host.style.height = `${nextIndices.length * rowPx}px`;
        paint();
      },
      destroy() {
        toolsWrap.removeEventListener("scroll", onScroll);
        toolsWrap.classList.remove("nav-group-tools-virtual");
        toolsWrap.style.maxHeight = "";
        toolsWrap.style.overflow = "";
      },
    };
  }

  window.DevToolsNavScale = {
    NAV_VIRTUAL_GROUP_MIN,
    NAV_VIRTUAL_ROW_PX,
    NAV_SCALABLE_MIN_TOOLS,
    SEARCH_DEBOUNCE_MS,
    buildSearchIndex,
    matchTools,
    debounce,
    mountGroupVirtualList,
  };
})();
