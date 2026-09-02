(() => {
  "use strict";

  /** 面板按需挂载后绑定 extra.js 事件（extra.js 只加载一次，不能仅在首屏绑 DOM） */
  const bound = new Set();
  const binders = Object.create(null);

  function register(panelId, fn) {
    const id = String(panelId || "").trim();
    if (!id || typeof fn !== "function") return;
    if (!binders[id]) binders[id] = [];
    binders[id].push(fn);
    if (!bound.has(id) && document.getElementById(id)) bind(id);
  }

  function bind(panelId) {
    const id = String(panelId || "").trim();
    if (!id || bound.has(id)) return;
    const root = document.getElementById(id);
    if (!root) return;
    const fns = binders[id];
    if (!fns?.length) return;
    bound.add(id);
    try {
      for (const fn of fns) fn(root);
    } catch (err) {
      console.error(`DevToolsExtraBind: ${id}`, err);
      bound.delete(id);
    }
  }

  function bindMounted() {
    const mount = document.getElementById("workspace-panels");
    if (!mount) return;
    mount.querySelectorAll(".tool-panel[id]").forEach((el) => bind(el.id));
  }

  window.addEventListener("devtools:panel-mounted", (e) => {
    const id = String(e.detail?.id || "").trim();
    if (id) bind(id);
  });

  window.DevToolsExtraBind = { register, bind, bindMounted };
})();
