(() => {
  "use strict";

  const url = new URL("./mdread/", location.href).href;
  const api = window.DevToolsOpenExternalSite;
  if (api && typeof api.init === "function") {
    api.init({ id: "mdread", url });
    return;
  }

  // 兜底：未加载 open-external-site 时仍可手动打开
  const openBtn = document.getElementById("mdread-open");
  const linkEl = document.getElementById("mdread-link");
  const open = () => {
    try {
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (_) {
      location.assign(url);
    }
  };
  openBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    open();
  });
  if (linkEl) {
    linkEl.href = url;
    linkEl.addEventListener("click", (e) => {
      e.preventDefault();
      open();
    });
  }
})();
