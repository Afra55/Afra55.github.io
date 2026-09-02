(() => {
  "use strict";

  const K = window.DevToolsExtraKit;
  if (!K) return;
  const { $$, toast, EBind } = K;

  function bootExtraPanel(toolId) {
    const id = String(toolId || "").trim();
    if (!id) return;
    EBind()?.bind?.(id);
    window.DevToolsExtraBoot?.[id]?.();
  }

  window.addEventListener("devtools:route", (e) => {
    const d = e.detail || {};
    const id = String(d.tool || "").trim();
    bootExtraPanel(id);
  });

$$("[data-copy]").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      const target = document.getElementById(btn.dataset.copy);
      const text = target?.textContent || "";
      if (!text || text === "—") return;
      try {
        await navigator.clipboard.writeText(text);
        toast("已复制");
      } catch (_) {
        toast("复制失败");
      }
    });
  });
  $$("[data-copy-value]").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", async () => {
      const target = document.getElementById(btn.dataset.copyValue);
      const text = target?.value || "";
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        toast("已复制");
      } catch (_) {
        toast("复制失败");
      }
    });
  });

  EBind()?.bindMounted?.();
})();
