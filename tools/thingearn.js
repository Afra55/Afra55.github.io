(() => {
  "use strict";

  const TOOL_ID = "thingearn";
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

  async function boot() {
    if (mounted) return;
    await ensureFlash();
    if (mounted) return;
    mounted = true;
    window.DevToolsKidsFlash.mount({
      toolId: TOOL_ID,
      title: "认用品",
      dataUrl: "./data/things-kids.json",
      prefix: "th",
      namespace: "thingearn",
      defaultEmoji: "🧸",
    });
  }

  const start = () => {
    boot().catch((err) => console.error("[thingearn]", err));
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  window.addEventListener("devtools:route", () => {
    const head = location.hash.replace(/^#/, "").split(/[/?]/)[0];
    if (head === TOOL_ID) start();
  });
})();
