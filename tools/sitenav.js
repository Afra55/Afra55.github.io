(() => {
  "use strict";

  /** 外链卡片：只列站外服务；已在本站做成工具的不再单独展示 */
  const LINKS = [
    {
      id: "pdfcraft",
      title: "PDF 工具箱",
      desc: "合并 / 拆分 / 压缩 / 转换等 100+ PDF 工具，浏览器本地处理。",
      url: "https://pdfcraft.devtoolcafe.com/zh/",
      tags: ["pdf", "办公"],
    },
    {
      id: "tubatools",
      title: "图吧工具箱",
      desc: "WinUI3 版 Windows 装机/硬件工具箱：一键启动 CPU-Z、GPU-Z、磁盘检测等百款工具，含系统优化与硬件信息。",
      url: "https://tubawinui3.cn/",
      tags: ["windows", "硬件", "装机"],
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
      id: "slidev",
      title: "Slidev",
      desc: "开发者向 Markdown 演示工具（本机 Node 使用更完整）。",
      url: "https://sli.dev/",
      tags: ["ppt", "markdown", "vue"],
    },
    {
      id: "i-have-adhd",
      title: "I Have ADHD",
      desc: "给 AI 编程助手用的 Skill：先给结论、少绕弯，输出更适合 ADHD 阅读习惯（MIT）。",
      url: "https://github.com/ayghri/i-have-adhd",
      tags: ["ai", "skill", "github"],
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

  function render(filter) {
    const grid = $("#sitenav-grid");
    const empty = $("#sitenav-empty");
    if (!grid) return;
    const q = String(filter || "")
      .trim()
      .toLowerCase();
    // 有 tool 字段的是站内已有工具，外链导航不重复展示
    const list = LINKS.filter((item) => !item.tool).filter((item) => {
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
      }
    });
    render("");
  }

  bind();
  document.addEventListener("devtools:route", (e) => {
    if (e.detail?.tool === "sitenav") bind();
  });
})();
