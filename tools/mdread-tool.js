(() => {
  "use strict";

  // 仅接线面板按钮；真正「点侧栏开新窗」由 app.js 的 launchUrl 处理，避免选中面板后反复 auto-open
  const url = new URL("./mdread/", location.href).href;
  const openBtn = document.getElementById("mdread-open");
  const linkEl = document.getElementById("mdread-link");

  function openRead() {
    try {
      const w = window.open(url, "_blank", "noopener,noreferrer");
      if (w) return;
    } catch (_) {}
    location.assign(url);
  }

  if (linkEl) {
    linkEl.href = url;
    linkEl.target = "_blank";
    linkEl.rel = "noopener noreferrer";
  }
  openBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    openRead();
  });
  linkEl?.addEventListener("click", (e) => {
    e.preventDefault();
    openRead();
  });
})();
