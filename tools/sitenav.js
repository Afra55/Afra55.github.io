(() => {
  "use strict";

  /** 外链卡片：集中展示「打开对应网站」类工具，参考 nav 站点卡片布局 */
  const LINKS = [
    {
      id: "pdfcraft",
      title: "PDF 工具箱",
      desc: "合并 / 拆分 / 压缩 / 转换等 100+ PDF 工具，浏览器本地处理。",
      url: "https://pdfcraft.devtoolcafe.com/zh/",
      tags: ["pdf", "办公"],
    },
    {
      id: "insectworld",
      title: "昆虫世界",
      desc: "互动昆虫图鉴与观察站。",
      url: "https://insect-world.pages.dev/",
      tags: ["科普", "趣味"],
    },
    {
      id: "prehmuseum",
      title: "史前博物馆",
      desc: "史前生物互动展馆（中文）。",
      url: "https://leon-made-this.work/museum/zh-CN/",
      tags: ["科普", "博物馆"],
    },
    {
      id: "revealjs",
      title: "Reveal.js",
      desc: "经典网页幻灯片框架；本站「MD 幻灯片」基于它做本地演示。",
      url: "https://revealjs.com/",
      tags: ["ppt", "markdown"],
      tool: "mdslides",
    },
    {
      id: "slidev",
      title: "Slidev",
      desc: "开发者向 Markdown 演示工具（本机 Node 使用更完整）。",
      url: "https://sli.dev/",
      tags: ["ppt", "markdown", "vue"],
    },
    {
      id: "regexvis",
      title: "Regex Vis",
      desc: "正则可视化编辑器原站；本站「正则」面板默认可点选编辑（嵌入）。",
      url: "https://regex-vis.com/",
      tags: ["正则"],
      tool: "regex",
    },
    {
      id: "mathlive",
      title: "MathLive",
      desc: "数学公式编辑组件官网；本站「公式编辑」已本地集成。",
      url: "https://mathlive.io/",
      tags: ["公式", "latex"],
      tool: "mathedit",
    },
    {
      id: "regulex",
      title: "Regulex",
      desc: "铁路图正则可视化（只读）；本站「正则」面板可切换查看。",
      url: "https://jex.im/regulex/",
      tags: ["正则"],
      tool: "regex",
    },
  ];

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function openExternal(url) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer external";
    a.click();
  }

  function goTool(id) {
    if (!id) return;
    location.hash = `#${id}`;
  }

  function render(filter) {
    const grid = $("#sitenav-grid");
    const empty = $("#sitenav-empty");
    if (!grid) return;
    const q = String(filter || "")
      .trim()
      .toLowerCase();
    const list = LINKS.filter((item) => {
      if (!q) return true;
      const hay = `${item.title} ${item.desc} ${(item.tags || []).join(" ")} ${item.id}`.toLowerCase();
      return hay.includes(q);
    });
    grid.innerHTML = list
      .map(
        (item) => `<article class="sitenav-card" role="listitem" data-url="${item.url}">
        <div class="sitenav-card-top">
          <h3 class="sitenav-card-title">${item.title}</h3>
          <span class="sitenav-card-tags">${(item.tags || []).map((t) => `<span>${t}</span>`).join("")}</span>
        </div>
        <p class="sitenav-card-desc">${item.desc}</p>
        <div class="sitenav-card-actions">
          <button type="button" class="primary-btn sitenav-open" data-url="${item.url}">打开网站</button>
          ${
            item.tool
              ? `<button type="button" class="ghost-btn sitenav-tool" data-tool="${item.tool}">站内工具</button>`
              : ""
          }
        </div>
      </article>`
      )
      .join("");
    if (empty) empty.hidden = list.length > 0;
  }

  let bound = false;
  function bind() {
    if (bound) {
      render($("#sitenav-q")?.value || "");
      return;
    }
    bound = true;
    const q = $("#sitenav-q");
    q?.addEventListener("input", () => render(q.value));
    $("#sitenav-grid")?.addEventListener("click", (e) => {
      const openBtn = e.target.closest?.(".sitenav-open");
      if (openBtn) {
        void openExternal(openBtn.dataset.url);
        return;
      }
      const toolBtn = e.target.closest?.(".sitenav-tool");
      if (toolBtn) {
        goTool(toolBtn.dataset.tool);
        return;
      }
    });
    render("");
  }

  bind();
  document.addEventListener("devtools:route", (e) => {
    if (e.detail?.tool === "sitenav") bind();
  });
})();
