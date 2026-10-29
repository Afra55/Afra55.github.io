(() => {
  "use strict";

  /** 外链卡片：只列站外服务；已在本站做成工具的不再单独展示 */
  const LINKS = [
    {
      id: "everything",
      title: "Everything",
      desc: "Windows 瞬时全盘文件搜索（voidtools 官网客户端）。",
      url: "https://www.voidtools.com/zh-cn/",
      tags: ["windows", "搜索", "文件"],
    },
    {
      id: "puter-everything",
      title: "Everything Project",
      desc: "HeyPuter 开源重建全球常用软件：Office / 协作 / 创意 / CAD 等到 Slack、Photoshop 等替代（单仓多应用，MIT，需 Node ≥22）。",
      url: "https://github.com/HeyPuter/everything",
      tags: ["开源", "办公", "协作", "github", "puter"],
    },
    {
      id: "how-to-live-better",
      title: "HowToLiveBetter",
      desc: "高性价比人生指南：长寿防病、急救、省钱理财、法律红线、失业工伤、医保社保、恋爱婚育、怀孕育儿、创业合规、出国与技能；每条写成本/收益/证据等级与出处（期刊与官方文件）。",
      url: "https://github.com/eternity4719/HowToLiveBetter",
      tags: ["人生", "健康", "理财", "指南", "github"],
    },
    {
      id: "voicestudio",
      title: "VoiceStudio",
      desc: "开源、全本地的 ElevenLabs 替代：语音克隆、声音设计、视频配音、听写、转写与有声书，支持大量语言（本机运行，不上传）。",
      url: "https://github.com/debpalash/VoiceStudio",
      tags: ["语音", "克隆", "配音", "本地", "github"],
    },
    {
      id: "myspeed",
      title: "MySpeed",
      desc: "自托管网速监控：定时测速、历史图表、多服务器；支持 LibreSpeed / Ookla / Cloudflare。需本机 Docker 或安装包（MIT）。",
      url: "https://myspeed.dev/",
      tags: ["测速", "监控", "自托管", "docker"],
    },
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
    {
      id: "strix",
      title: "Strix",
      desc: "开源 AI 渗透测试工具：自主 AI 黑客动态运行你的代码，发现并验证漏洞（真实 PoC），多智能体协同；需 Docker + LLM 密钥（Apache-2.0）。仅限已授权目标。",
      url: "https://github.com/usestrix/strix",
      tags: ["ai", "安全", "渗透", "docker", "github"],
    },
    {
      id: "rea",
      title: "REA 逆向",
      desc: "Reverse Engineer Anything：把 Ghidra / Hopper / IDA 等接成 MCP，让 Claude Code、Cursor 等 Agent 从应用行为逆向到原生二进制，结论带证据（MIT）。分析在本地跑。",
      url: "https://github.com/morluto/rea",
      tags: ["ai", "逆向", "mcp", "agent", "github"],
    },
    {
      id: "codebase-memory-mcp",
      title: "Codebase Memory MCP",
      desc: "本地代码智能引擎（原生可执行文件）：tree-sitter 建知识图谱，函数/调用链/路由/死代码/语义搜索等 15 个 MCP 工具；100% 本地、无需 API key，支持多个编码 Agent。",
      url: "https://github.com/DeusData/codebase-memory-mcp",
      tags: ["ai", "mcp", "代码库", "graph", "本地"],
    },
    {
      id: "claude-mem",
      title: "Claude Mem",
      desc: "给 AI 编程助手（Claude Code / OpenCode / Cursor / Copilot 等）的跨会话记忆：自动记录每次会话、AI 压缩成结构化记忆，下次会话注入相关上下文（TypeScript，Apache-2.0）。",
      url: "https://github.com/thedotmack/claude-mem",
      tags: ["ai", "memory", "agent", "github"],
    },
    {
      id: "ponytail",
      title: "Ponytail",
      desc: "给 AI 编程 Agent 的「懒惰资深工程师」技能：让 agent 少造轮子、能不写就不写，专治过度工程（MIT）。",
      url: "https://github.com/DietrichGebert/ponytail",
      tags: ["ai", "agent", "skill", "github"],
    },
    {
      id: "hallmark",
      title: "Hallmark",
      desc: "给 Claude Code / Cursor / Codex 的「反 AI 味」设计技能：让 agent 生成的前端界面不那么像模板（CSS）。",
      url: "https://github.com/Nutlope/hallmark",
      tags: ["ai", "design", "skill", "css"],
    },
    {
      id: "tolaria",
      title: "Tolaria",
      desc: "桌面应用：管理 Markdown 知识库（TypeScript，refactoringhq）。",
      url: "https://github.com/refactoringhq/tolaria",
      tags: ["markdown", "知识库", "desktop"],
    },
    {
      id: "firecrawl",
      title: "Firecrawl",
      desc: "把网站转成 LLM 友好数据的抓取/搜索/爬取引擎与 API，输出干净 Markdown 喂给 AI（TypeScript）。",
      url: "https://github.com/firecrawl/firecrawl",
      tags: ["爬虫", "ai", "api", "github"],
    },
    {
      id: "crawl4ai",
      title: "Crawl4AI",
      desc: "开源、面向 LLM 的网页爬虫/抓取器（Python）：输出 Markdown 等结构化数据，便于喂给 AI。",
      url: "https://github.com/unclecode/crawl4ai",
      tags: ["爬虫", "ai", "python"],
    },
    {
      id: "scrapling",
      title: "Scrapling",
      desc: "自适应网页抓取框架（Python）：从单请求到全站爬取，抗反爬、自动适配页面结构变化。",
      url: "https://github.com/D4Vinci/Scrapling",
      tags: ["爬虫", "python", "scraping"],
    },
  ];

  const ACTIVE_LINKS = LINKS.filter((item) => !item.tool);
  /** @type {Set<string>} */
  const selectedTags = new Set();

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function openExternal(url) {
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer external";
    a.click();
  }

  function allTags() {
    const counts = new Map();
    for (const item of ACTIVE_LINKS) {
      for (const t of item.tags || []) {
        counts.set(t, (counts.get(t) || 0) + 1);
      }
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "zh"))
      .map(([tag, count]) => ({ tag, count }));
  }

  function filteredList(query) {
    const q = String(query || "")
      .trim()
      .toLowerCase();
    return ACTIVE_LINKS.filter((item) => {
      if (selectedTags.size) {
        const tags = item.tags || [];
        for (const t of selectedTags) {
          if (!tags.includes(t)) return false;
        }
      }
      if (!q) return true;
      const hay = `${item.title} ${item.desc} ${(item.tags || []).join(" ")} ${item.id}`.toLowerCase();
      return hay.includes(q);
    });
  }

  function renderFilters() {
    const host = $("#sitenav-filters");
    if (!host) return;
    const tags = allTags();
    host.innerHTML = [
      `<button type="button" class="sitenav-chip ${selectedTags.size ? "" : "is-on"}" data-tag="__all" aria-pressed="${
        selectedTags.size ? "false" : "true"
      }">全部</button>`,
      ...tags.map(
        ({ tag, count }) =>
          `<button type="button" class="sitenav-chip ${selectedTags.has(tag) ? "is-on" : ""}" data-tag="${escapeHtml(
            tag
          )}" aria-pressed="${selectedTags.has(tag) ? "true" : "false"}">${escapeHtml(tag)} · ${count}</button>`
      ),
    ].join("");
  }

  function updateCount(shown) {
    const el = $("#sitenav-count");
    if (!el) return;
    const total = ACTIVE_LINKS.length;
    el.textContent = shown === total ? `共 ${total}` : `共 ${total} · 显示 ${shown}`;
  }

  function render(filter) {
    const grid = $("#sitenav-grid");
    const empty = $("#sitenav-empty");
    if (!grid) return;
    const list = filteredList(filter);
    updateCount(list.length);
    const reduceMotion =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    grid.innerHTML = list
      .map((item, i) => {
        const delay = reduceMotion ? "" : `style="animation-delay:${Math.min(i, 12) * 28}ms"`;
        const desc = String(item.desc || "");
        const long = desc.length > 56;
        return `<article class="sitenav-card${reduceMotion ? "" : " is-enter"}" role="listitem" tabindex="0" data-url="${escapeHtml(
          item.url
        )}" data-id="${escapeHtml(item.id)}" ${delay}>
        <div class="sitenav-card-top">
          <h3 class="sitenav-card-title">${escapeHtml(item.title)}</h3>
          <span class="sitenav-card-tags">${(item.tags || [])
            .map((t) => `<span>${escapeHtml(t)}</span>`)
            .join("")}</span>
        </div>
        <p class="sitenav-card-desc${long ? "" : " is-short"}">${escapeHtml(desc)}</p>
        ${long ? `<button type="button" class="sitenav-more" data-more>展开简介</button>` : ""}
        <div class="sitenav-card-actions">
          <button type="button" class="ghost-btn sitenav-open" data-url="${escapeHtml(item.url)}">打开网站</button>
        </div>
      </article>`;
      })
      .join("");
    if (empty) empty.hidden = list.length > 0;
  }

  function refresh() {
    renderFilters();
    render($("#sitenav-q")?.value || "");
  }

  let bound = false;
  function bind() {
    if (bound) {
      refresh();
      return;
    }
    bound = true;
    const q = $("#sitenav-q");
    q?.addEventListener("input", () => render(q.value));

    $("#sitenav-filters")?.addEventListener("click", (e) => {
      const btn = e.target.closest?.(".sitenav-chip");
      if (!btn) return;
      const tag = btn.dataset.tag || "";
      if (tag === "__all") {
        selectedTags.clear();
      } else if (selectedTags.has(tag)) {
        selectedTags.delete(tag);
      } else {
        selectedTags.add(tag);
      }
      refresh();
    });

    $("#sitenav-grid")?.addEventListener("click", (e) => {
      const more = e.target.closest?.("[data-more]");
      if (more) {
        e.preventDefault();
        e.stopPropagation();
        const card = more.closest(".sitenav-card");
        if (!card) return;
        const on = card.classList.toggle("is-expanded");
        more.textContent = on ? "收起简介" : "展开简介";
        return;
      }
      const openBtn = e.target.closest?.(".sitenav-open");
      if (openBtn) {
        e.stopPropagation();
        void openExternal(openBtn.dataset.url);
        return;
      }
      const card = e.target.closest?.(".sitenav-card");
      if (card?.dataset.url) void openExternal(card.dataset.url);
    });

    $("#sitenav-grid")?.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const card = e.target.closest?.(".sitenav-card");
      if (!card || e.target.closest("button")) return;
      e.preventDefault();
      if (card.dataset.url) void openExternal(card.dataset.url);
    });

    refresh();
  }

  bind();
  document.addEventListener("devtools:route", (e) => {
    if (e.detail?.tool === "sitenav") bind();
  });
})();
