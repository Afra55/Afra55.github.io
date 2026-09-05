(() => {
  "use strict";

  const TOOL_ID = "animalearn";
  let mounted = false;

  async function ensureFlash() {
    if (window.DevToolsKidsFlash?.mount) return;
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      const v = encodeURIComponent(window.TOOLS_BUILD || window.TOOLS_VERSION || "");
      s.src = `./lib/kids-flash.js${v ? `?v=${v}` : ""}`;
      s.async = true;
      s.onload = res;
      s.onerror = () => rej(new Error("kids-flash 加载失败"));
      document.head.appendChild(s);
    });
  }

  async function dataUrlWithItems() {
    const v = window.TOOLS_BUILD || "";
    const res = await fetch(`./data/animals-kids.json${v ? `?v=${encodeURIComponent(v)}` : ""}`);
    if (!res.ok) throw new Error(`加载动物数据失败（${res.status}）`);
    const data = await res.json();
    if (!data.items) data.items = data.animals || [];
    const blob = new Blob([JSON.stringify(data)], { type: "application/json" });
    return URL.createObjectURL(blob);
  }

  async function boot() {
    if (mounted) return;
    if (!document.getElementById(TOOL_ID)) return;
    await ensureFlash();
    if (mounted) return;
    mounted = true;
    const dataUrl = await dataUrlWithItems();
    window.DevToolsKidsFlash.mount({
      toolId: TOOL_ID,
      title: "认动物",
      dataUrl,
      prefix: "ae",
      namespace: "animalearn",
      defaultEmoji: "🐾",
    });
  }

  const start = () => {
    boot().catch((err) => console.error("[animalearn]", err));
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  window.addEventListener("devtools:route", () => {
    const head = location.hash.replace(/^#/, "").split(/[/?]/)[0];
    if (head === TOOL_ID) start();
  });
  window.addEventListener("devtools:panel-mounted", (ev) => {
    if (ev?.detail?.id === TOOL_ID) start();
  });
})();
