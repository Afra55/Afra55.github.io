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

  function patchAnimalsCatalogFetch() {
    if (window.__aeAnimalsFetchPatched) return;
    window.__aeAnimalsFetchPatched = true;
    const orig = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : String(input && input.url ? input.url : input);
      const res = await orig(input, init);
      if (!/animals-kids\.json/i.test(url)) return res;
      try {
        const data = await res.clone().json();
        if (!Array.isArray(data.items)) data.items = data.animals || [];
        return new Response(JSON.stringify(data), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      } catch (_) {
        return res;
      }
    };
  }

  async function boot() {
    if (mounted) return;
    if (!document.getElementById(TOOL_ID)) return;
    await ensureFlash();
    if (mounted) return;
    patchAnimalsCatalogFetch();
    mounted = true;
    window.DevToolsKidsFlash.mount({
      toolId: TOOL_ID,
      title: "认动物",
      dataUrl: "./data/animals-kids.json",
      prefix: "ae",
      namespace: "animalearn",
      defaultEmoji: "🐾",
    });
  }

  const start = () => {
    boot().catch((err) => {
      mounted = false;
      console.error("[animalearn]", err);
    });
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
