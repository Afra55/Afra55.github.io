(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  const ARTICLES = [
    {
      id: "jgj-longevity-16",
      title: "金刚长寿功十六式详解",
      file: "./lib/health-articles/jgj-longevity-16.json",
    },
  ];

  const state = {
    article: null,
    loading: false,
    err: "",
  };

  function esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function textToHtml(text) {
    return esc(text).replace(/\n/g, "<br>");
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
    return `${head}${paras}${blocks}`;
  }

  function renderSection(sec, idx) {
    const id = `hr-sec-${idx}`;
    const paras = (sec.paragraphs || [])
      .map((p) => `<p>${textToHtml(p)}</p>`)
      .join("");
    const subs = (sec.subsections || []).map(renderSubsection).join("");
    const head = sec.heading ? `<h2 class="hr-section-title" id="${id}">${esc(sec.heading)}</h2>` : "";
    return `<section class="hr-section" aria-labelledby="${id}">${head}${paras}${subs}</section>`;
  }

  function renderToc(sections) {
    const items = sections
      .filter((s) => s.heading && s.heading !== "导读")
      .map((s, i) => {
        const id = `hr-sec-${sections.indexOf(s)}`;
        return `<a class="hr-toc-link" href="#${id}" data-hr-toc="${id}">${esc(s.heading)}</a>`;
      })
      .join("");
    return items ? `<nav class="hr-toc panel-card" aria-label="目录">${items}</nav>` : "";
  }

  function renderArticle(a) {
    const root = $("#hr-article");
    if (!root) return;
    if (!a) {
      root.innerHTML = `<p class="hint">暂无文章</p>`;
      return;
    }

    const tags = (a.tags || []).map((t) => `<span class="hr-tag">${esc(t)}</span>`).join("");
    const gallery = (a.images || [])
      .map(
        (src, i) =>
          `<button type="button" class="hr-img-btn" data-hr-img="${esc(src)}" aria-label="查看配图 ${i + 1}"><img src="${esc(src)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" /></button>`
      )
      .join("");

    root.innerHTML = `
      <header class="hr-head panel-card">
        ${a.cover ? `<figure class="hr-cover"><img src="${esc(a.cover)}" alt="" loading="eager" decoding="async" referrerpolicy="no-referrer" /></figure>` : ""}
        <p class="hr-subtitle">${esc(a.subtitle || "")}</p>
        <div class="hr-meta">
          <span>${esc(a.author || "佚名")}</span>
          ${a.published ? `<span>${esc(a.published)}</span>` : ""}
          ${a.source?.name ? `<a href="${esc(a.source.url || "#")}" target="_blank" rel="noopener noreferrer external">来源：${esc(a.source.name)}</a>` : ""}
        </div>
        <div class="hr-tags">${tags}</div>
        <p class="hint tight hr-disclaimer">转载仅供养生自学对照；文中功效为传统说法，不能替代医疗诊断与治疗。版权归原作者与首发平台所有。</p>
      </header>
      ${renderToc(a.sections || [])}
      ${gallery ? `<div class="hr-gallery panel-card" aria-label="配图">${gallery}</div>` : ""}
      <div class="hr-body">${(a.sections || []).map(renderSection).join("")}</div>
    `;

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
  }

  async function loadArticle(id) {
    const meta = ARTICLES.find((x) => x.id === id) || ARTICLES[0];
    if (!meta) return;
    state.loading = true;
    state.err = "";
    const status = $("#hr-status");
    if (status) status.textContent = "加载中…";
    try {
      const res = await fetch(`${meta.file}?v=${window.TOOLS_BUILD || ""}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      state.article = data;
      renderArticle(data);
      if (status) status.textContent = data.title || meta.title;
    } catch (e) {
      state.err = String(e?.message || e);
      if (status) status.textContent = "加载失败";
      renderArticle(null);
    } finally {
      state.loading = false;
    }
  }

  function initPicker() {
    const sel = $("#hr-picker");
    if (!sel) return;
    sel.innerHTML = ARTICLES.map(
      (a) => `<option value="${esc(a.id)}">${esc(a.title)}</option>`
    ).join("");
    sel.addEventListener("change", () => {
      void loadArticle(sel.value);
    });
  }

  function init() {
    initPicker();
    const sel = $("#hr-picker");
    void loadArticle(sel?.value || ARTICLES[0]?.id);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
