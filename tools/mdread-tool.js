(() => {
  "use strict";

  // 仅接线面板按钮；真正「点侧栏开新窗」由 app.js 的 launchUrl 处理，避免选中面板后反复 auto-open
  // ?fresh=1：不消费 MDM 残留交接，避免工具入口误开旧文档
  const url = new URL("./mdread/?fresh=1", location.href).href;
  const openBtn = document.getElementById("mdread-open");
  const linkEl = document.getElementById("mdread-link");

  function openRead() {
    // 勿用 window.open(..., "noopener")：成功也常返回 null，易误判失败再开一次
    try {
      const w = window.open(url, "_blank");
      if (w) {
        try {
          w.opener = null;
        } catch (_) {}
        return;
      }
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
