(() => {
  "use strict";
  const parts = ["animalearn.p1.js", "animalearn.p2.js", "animalearn.p3.js", "animalearn.p4.js"];
  const v = encodeURIComponent(window.TOOLS_BUILD || window.TOOLS_VERSION || "");
  function loadOne(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "./" + src + (v ? "?v=" + v : "");
      s.onload = resolve;
      s.onerror = () => reject(new Error("load " + src));
      document.head.appendChild(s);
    });
  }
  (async () => {
    try {
      for (const p of parts) await loadOne(p);
      const js = decodeURIComponent(escape(atob(window.__AE_B64 || "")));
      (0, eval)(js);
    } catch (err) {
      console.error("[animalearn]", err);
    }
  })();
})();
