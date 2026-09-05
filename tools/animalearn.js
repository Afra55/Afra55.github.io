(() => {
  "use strict";

  const TOOL_ID = "animalearn";
  let mounted = false;

  function buildQs() {
    const v = encodeURIComponent(window.TOOLS_BUILD || window.TOOLS_VERSION || "");
    return v ? `?v=${v}` : "";
  }

  function warmAnimalsJson() {
    try {
      fetch(`./data/animals-kids.json${buildQs()}`, { credentials: "same-origin" }).catch(() => {});
    } catch (_) {}
  }
  warmAnimalsJson();

  function waitForPanel(ms = 5000) {
    return new Promise((resolve) => {
      if (document.getElementById(TOOL_ID)) return resolve(true);
      const t0 = Date.now();
      const tick = () => {
        if (document.getElementById(TOOL_ID)) return resolve(true);
        if (Date.now() - t0 >= ms) return resolve(false);
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  function markStatus(zhText, enText) {
    const root = document.getElementById(TOOL_ID);
    if (!root) return;
    const zh = root.querySelector("#ae-card-zh");
    const en = root.querySelector("#ae-card-en");
    if (zh && (!zh.textContent || /加载|—|Loading/.test(zh.textContent))) zh.textContent = zhText;
    if (en && (!en.textContent || /加载|Loading|—/.test(en.textContent))) en.textContent = enText;
  }

  async function ensureFlash() {
    if (window.DevToolsKidsFlash?.mount) return;
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = `./lib/kids-flash.js${buildQs()}`;
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
    markStatus("正在载入…", "Loading pack");
    const ready = await waitForPanel(5000);
    if (!ready) return;
    markStatus("正在载入…", "Loading pack");
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
      markStatus("加载失败", "Load failed");
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
  try {
    window.DevToolsPanels?.bootReady?.then(() => start());
  } catch (_) {}
})();
