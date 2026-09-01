(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const INDEX_URL = "./lib/health-articles/index.json";
  const LS_LAST_ID = "devtools:healthread:last-id";
  const LS_SCROLL_PREFIX = "devtools:healthread:scroll:";

  const state = {
    view: "list",
    index: [],
    article: null,
    articleId: "",
    query: "",
    tag: "",
    loading: false,
  };

  let scrollSaveTimer = 0;

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function assetUrl(path) {
    const p = String(path || "").trim();
    if (!p) return "";
    if (/^https?:\/\//i.test(p)) return p;
    return new URL(p.replace(/^\.\//, ""), new URL(".", window.location.href)).href;
  }

  function textToHtml(text) {
    return esc(text).replace(/\n/g, "<br>");
  }

  function scrollKey(id) {
    return `${LS_SCROLL_PREFIX}${id}`;
  }

  function saveScroll(id) {
    if (!id) return;
    try {
      const y = Math.max(0, Math.round(window.scrollY || 0));
      localStorage.setItem(scrollKey(id), String(y));
    } catch (_) {}
  }

  function restoreScroll(id) {
    if (!id) return;
    let y = 0;
    try {
      y = Number.parseInt(localStorage.getItem(scrollKey(id)) || "0", 10) || 0;
    } catch (_) {}
    if (y > 0) {
      requestAnimationFrame(() => window.scrollTo({ top: y, behavior: "auto" }));
    }
  }

  function bindScrollSave(id) {
    window.clearTimeout(scrollSaveTimer);
    const onScroll = () => {
      window.clearTimeout(scrollSaveTimer);
      scrollSaveTimer = window.setTimeout(() => saveScroll(id), 200);
    };
    window.removeEventListener("scroll", onScroll);
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  function allTags() {
    const set = new Set();
    for (const a of state.index) (a.tags || []).forEach((t) => set.add(t));
    return [...set].sort((a, b) => a.localeCompare(b, "zh"));
  }

  function filteredIndex() {
    const q = state.query.trim().toLowerCase();
    return state.index.filter((a) => {
      if (state.tag && !(a.tags || []).includes(state.tag)) return false;
      if (!q) return true;
      const hay = `${a.title} ${a.subtitle || ""} ${a.author || ""} ${(a.tags || []).join(" ")} ${a.summary || ""}`.toLowerCase();
      return hay.includes(q);
    });
  }

  function renderGifFigure(fig, i) {
    const src = assetUrl(fig?.src);
    if (!src) return "";
    const alt = esc(fig?.alt || fig?.caption || `动图演示 ${i + 1}`);
    const cap = fig?.caption ? `<figcaption>${esc(fig.caption)}</figcaption>` : "";
    return `<figure class="hr-figure hr-figure-gif hr-figure-defer">
      <button type="button" class="hr-gif-load" data-hr-gif-src="${esc(src)}" aria-label="加载：${alt}">
        <span class="hr-gif-load-icon" aria-hidden="true">▶</span>
        <span class="hr-gif-load-text">点击加载动图演示</span>
        <span class="hr-gif-load-hint">${alt}</span>
      </button>
      <img class="hr-gif-img" alt="${alt}" hidden decoding="async" />
      ${cap}
    </figure>`;
  }

  function renderFigures(figures) {
    const list = Array.isArray(figures) ? figures : [];
    if (!list.length) return "";
    return `<div class="hr-figures">${list
      .map((fig, i) => {
        const isGif = fig?.type === "gif" || /\.gif(\?|$)/i.test(fig?.src || "");
        if (isGif) return renderGifFigure(fig, i);
        const src = assetUrl(fig?.src);
        if (!src) return "";
        const alt = esc(fig?.alt || fig?.caption || `配图 ${i + 1}`);
        const cap = fig?.caption ? `<figcaption>${esc(fig.caption)}</figcaption>` : "";
        return `<figure class="hr-figure">
          <button type="button" class="hr-figure-btn" data-hr-img="${esc(src)}" aria-label="查看大图：${alt}">
            <img src="${esc(src)}" alt="${alt}" loading="lazy" decoding="async" />
          </button>
          ${cap}
        </figure>`;
      })
      .join("")}</div>`;
  }

  function renderSubsection(sub) {
    const blocks = (sub.blocks || [])
      .map((b) => {
        const label = b.label ? `<h4 class="hr-sub-label">${esc(b.label)}</h4>` : "";
        return `${label}<div class="hr-block">${textToHtml(b.text)}</div>`;
      })
      .join("");
    const paras = (sub.paragraphs || [])
      .map((p) => `<p>${textToHtml(p)}</p>`)
      .join("");
    const head = sub.heading ? `<h3 class="hr-move">${esc(sub.heading)}</h3>` : "";
    return `${head}${paras}${blocks}${renderFigures(sub.figures)}`;
  }

  function renderSection(sec, idx) {
    const id = `hr-sec-${idx}`;
    const paras = (sec.paragraphs || [])
      .map((p) => `<p>${textToHtml(p)}</p>`)
      .join("");
    const subs = (sec.subsections || []).map(renderSubsection).join("");
    const head = sec.heading ? `<h2 class="hr-section-title" id="${id}">${esc(sec.heading)}</h2>` : "";
    return `<section class="hr-section" aria-labelledby="${id}">${head}${paras}${renderFigures(sec.figures)}${subs}</section>`;
  }

  function renderToc(sections) {
    const items = sections
      .filter((s) => s.heading && s.heading !== "导读")
      .map((s) => {
        const id = `hr-sec-${sections.indexOf(s)}`;
        return `<a class="hr-toc-link" href="#${id}" data-hr-toc="${id}">${esc(s.heading)}</a>`;
      })
      .join("");
    return items ? `<nav class="hr-toc panel-card" aria-label="目录">${items}</nav>` : "";
  }

  function bindGifLoaders(root) {
    root.querySelectorAll("[data-hr-gif-src]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const src = btn.getAttribute("data-hr-gif-src");
        const fig = btn.closest(".hr-figure-defer");
        const img = fig?.querySelector(".hr-gif-img");
        if (!src || !img || img.dataset.loaded === "1") return;
        img.src = src;
        img.hidden = false;
        img.dataset.loaded = "1";
        btn.hidden = true;
        fig?.classList.add("is-loaded");
      });
    });
  }

  function bindArticleInteractions(root) {
    root.querySelectorAll("[data-hr-img]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const src = btn.getAttribute("data-hr-img");
        if (!src) return;
        window.open(src, "_blank", "noopener,noreferrer");
      });
    });

    root.querySelectorAll("[data-hr-toc]").forEach((link) => {
      link.addEventListener("click", (e) => {
        const id = link.getAttribute("data-hr-toc");
        const el = id ? document.getElementById(id) : null;
        if (!el) return;
        e.preventDefault();
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    });

    bindGifLoaders(root);
  }

  function renderArticleBody(a) {
    const tags = (a.tags || []).map((t) => `<span class="hr-tag">${esc(t)}</span>`).join("");
    const coverSrc = assetUrl(a.cover);
    const copyNote = a.copyright ? esc(a.copyright) : "版权归原作者与首发平台所有";
    const sourceLink = a.source?.url
      ? `<a href="${esc(a.source.url)}" target="_blank" rel="noopener noreferrer external">首发：${esc(a.source.name || "外链")}</a>`
      : "";

    return `
      <header class="hr-head panel-card">
        ${coverSrc ? `<figure class="hr-cover"><button type="button" class="hr-figure-btn" data-hr-img="${esc(coverSrc)}" aria-label="查看封面大图"><img src="${esc(coverSrc)}" alt="${esc(a.title || "")}封面" loading="eager" decoding="async" /></button></figure>` : ""}
        <h2 class="hr-title">${esc(a.title || "")}</h2>
        <p class="hr-subtitle">${esc(a.subtitle || "")}</p>
        <div class="hr-meta">
          <span>作者 ${esc(a.author || "佚名")}</span>
          ${a.published ? `<span>${esc(a.published)}</span>` : ""}
          ${sourceLink}
        </div>
        <div class="hr-tags">${tags}</div>
        <p class="hint tight hr-disclaimer">${copyNote}；文中功效为传统养生说法，不能替代医疗诊断与治疗。</p>
      </header>
      ${renderToc(a.sections || [])}
      <div class="hr-body">${(a.sections || []).map(renderSection).join("")}</div>
    `;
  }

  function renderList() {
    const listEl = $("#hr-list");
    const readerEl = $("#hr-reader");
    const backBtn = $("#hr-back");
    if (!listEl || !readerEl) return;

    state.view = "list";
    listEl.hidden = false;
    readerEl.hidden = true;
    if (backBtn) backBtn.hidden = true;

    const items = filteredIndex();
    const tags = allTags();
    const tagRow = tags.length
      ? `<div class="hr-tag-filter" role="group" aria-label="按标签筛选">
          <button type="button" class="hr-tag-chip${state.tag ? "" : " is-active"}" data-hr-tag="">全部</button>
          ${tags.map((t) => `<button type="button" class="hr-tag-chip${state.tag === t ? " is-active" : ""}" data-hr-tag="${esc(t)}">${esc(t)}</button>`).join("")}
        </div>`
      : "";

    listEl.innerHTML = `
      <div class="hr-list-toolbar panel-card">
        <input type="search" id="hr-search" class="hr-search" placeholder="搜索标题、作者、标签…" value="${esc(state.query)}" autocomplete="off" />
        ${tagRow}
        <p class="hint tight" id="hr-list-meta">${items.length} / ${state.index.length} 篇</p>
      </div>
      <div class="hr-cards" role="list">
        ${
          items.length
            ? items
                .map((a) => {
                  const cover = assetUrl(a.cover);
                  const coverHtml = cover
                    ? `<img class="hr-card-cover" src="${esc(cover)}" alt="" loading="lazy" decoding="async" />`
                    : `<div class="hr-card-cover hr-card-cover-empty" aria-hidden="true">文</div>`;
                  const tagHtml = (a.tags || []).slice(0, 4).map((t) => `<span class="hr-tag">${esc(t)}</span>`).join("");
                  return `<button type="button" class="hr-card" role="listitem" data-hr-open="${esc(a.id)}">
                    ${coverHtml}
                    <span class="hr-card-body">
                      <span class="hr-card-title">${esc(a.title)}</span>
                      ${a.subtitle ? `<span class="hr-card-sub">${esc(a.subtitle)}</span>` : ""}
                      ${a.summary ? `<span class="hr-card-sum">${esc(a.summary)}</span>` : ""}
                      <span class="hr-card-meta">${esc(a.author || "")}${a.published ? ` · ${esc(a.published)}` : ""}</span>
                      <span class="hr-card-tags">${tagHtml}</span>
                    </span>
                  </button>`;
                })
                .join("")
            : `<p class="hint hr-empty">没有匹配的文章</p>`
        }
      </div>
    `;

    $("#hr-search")?.addEventListener("input", (e) => {
      state.query = e.target.value || "";
      renderList();
    });

    listEl.querySelectorAll("[data-hr-tag]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.tag = btn.getAttribute("data-hr-tag") || "";
        renderList();
      });
    });

    listEl.querySelectorAll("[data-hr-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const id = btn.getAttribute("data-hr-open");
        if (id) void openArticle(id);
      });
    });
  }

  async function openArticle(id, { restore = true } = {}) {
    const meta = state.index.find((x) => x.id === id);
    const readerEl = $("#hr-reader");
    const listEl = $("#hr-list");
    const backBtn = $("#hr-back");
    const status = $("#hr-status");
    if (!meta || !readerEl) return;

    state.view = "reader";
    state.articleId = id;
    listEl && (listEl.hidden = true);
    readerEl.hidden = false;
    backBtn && (backBtn.hidden = false);
    if (status) status.textContent = "加载中…";
    readerEl.innerHTML = `<p class="hint">加载中…</p>`;

    try {
      localStorage.setItem(LS_LAST_ID, id);
    } catch (_) {}

    try {
      const file = meta.file?.replace(/^\.\//, "") || `lib/health-articles/${id}.json`;
      const res = await fetch(`${file.startsWith("lib/") ? "./" : ""}${file}?v=${window.TOOLS_BUILD || ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.article = data;
      readerEl.innerHTML = renderArticleBody(data);
      bindArticleInteractions(readerEl);
      if (status) status.textContent = data.title || meta.title;
      if (restore) restoreScroll(id);
      bindScrollSave(id);
    } catch (e) {
      state.article = null;
      readerEl.innerHTML = `<p class="hint">加载失败：${esc(String(e?.message || e))}</p>`;
      if (status) status.textContent = "加载失败";
    }
  }

  function showList() {
    if (state.articleId) saveScroll(state.articleId);
    state.article = null;
    state.articleId = "";
    renderList();
    const status = $("#hr-status");
    if (status) status.textContent = `${state.index.length} 篇文章`;
  }

  async function loadIndex() {
    const status = $("#hr-status");
    if (status) status.textContent = "加载目录…";
    const res = await fetch(`${INDEX_URL}?v=${window.TOOLS_BUILD || ""}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    state.index = Array.isArray(data?.articles) ? data.articles : [];
    if (!state.index.length) throw new Error("文章目录为空");
  }

  async function init() {
    const backBtn = $("#hr-back");
    backBtn?.addEventListener("click", () => showList());

    try {
      await loadIndex();
    } catch (e) {
      const listEl = $("#hr-list");
      if (listEl) listEl.innerHTML = `<p class="hint">目录加载失败：${esc(String(e?.message || e))}</p>`;
      return;
    }

    let lastId = "";
    try {
      lastId = localStorage.getItem(LS_LAST_ID) || "";
    } catch (_) {}

    if (lastId && state.index.some((a) => a.id === lastId)) {
      await openArticle(lastId);
    } else {
      renderList();
      const status = $("#hr-status");
      if (status) status.textContent = `${state.index.length} 篇文章`;
    }

    window.addEventListener("devtools:route", () => {
      if (!$("#healthread")?.classList.contains("is-workspace-active")) return;
      if (state.view === "reader" && state.articleId) saveScroll(state.articleId);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void init());
  } else {
    void init();
  }
})();
