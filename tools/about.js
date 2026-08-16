(() => {
  "use strict";

  const MEDIA_EXTRA = [
    {
      id: "gifmaker",
      href: "#media/gifmaker",
      name: "GIF / 动图",
      desc: "视频转 GIF/WebP、压缩、拼接、亮度等本地处理。",
    },
    {
      id: "vsplit",
      href: "#media/vsplit",
      name: "视频切分",
      desc: "预览打点切分片段，支持全屏标记与打包下载。",
    },
    {
      id: "vbb",
      href: "#media/vbb",
      name: "一键黑盒",
      desc: "按估算快速切出可用视频段，偏批量效率。",
    },
  ];

  /** 新增工具时：在 app.js 的 TOOL_GROUPS / TOOL_META / ABOUT_DESC 同步更新 */
  function $(sel, root = document) {
    return root.querySelector(sel);
  }

  function escapeHtml(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderAbout() {
    const host = $("#about-catalog");
    if (!host) return;
    const catalog = window.DevToolsCatalog;
    if (!catalog?.groups?.length) {
      host.innerHTML = `<p class="hint">工具目录加载中…刷新页面即可。</p>`;
      return;
    }

    const meta = catalog.meta || {};
    const about = catalog.about || {};
    const version = window.TOOLS_VERSION || document.getElementById("site-tools-version")?.textContent || "";

    const verEl = $("#about-version");
    if (verEl) verEl.textContent = version ? `当前版本 ${version}` : "";

    host.innerHTML = catalog.groups
      .map((g) => {
        const cards = (g.tools || [])
          .map((id) => {
            const name = meta[id]?.name || id;
            const desc = about[id] || meta[id]?.aliases?.slice(0, 4).join(" · ") || "本地实用工具";
            const href = id === "media" ? "#media/gifmaker" : `#${id}`;
            let extra = "";
            if (id === "media") {
              extra = `<div class="about-sublinks">${MEDIA_EXTRA.map(
                (m) =>
                  `<a class="about-sublink" href="${m.href}">${escapeHtml(m.name)}</a>`
              ).join("")}</div>
              <ul class="about-subdesc hint tight">${MEDIA_EXTRA.map(
                (m) => `<li><strong>${escapeHtml(m.name)}</strong> — ${escapeHtml(m.desc)}</li>`
              ).join("")}</ul>`;
            }
            return `<article class="about-card">
              <div class="about-card-head">
                <h3>${escapeHtml(name)}</h3>
                <a class="secondary-btn about-go" href="${href}">打开</a>
              </div>
              <p class="hint tight">${escapeHtml(desc)}</p>
              ${extra}
            </article>`;
          })
          .join("");
        return `<section class="about-group" data-about-group="${escapeHtml(g.id)}">
          <h2 class="subhead">${escapeHtml(g.label)}</h2>
          <div class="about-grid">${cards}</div>
        </section>`;
      })
      .join("");
  }

  function boot() {
    renderAbout();
    // catalog may init slightly later
    if (!window.DevToolsCatalog) {
      let n = 0;
      const t = setInterval(() => {
        n += 1;
        if (window.DevToolsCatalog || n > 40) {
          clearInterval(t);
          renderAbout();
        }
      }, 50);
    }
    window.addEventListener("devtools:catalog", renderAbout);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.DevToolsAbout = { render: renderAbout };
})();
