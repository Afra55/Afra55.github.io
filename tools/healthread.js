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

  function assetUrl(path) {
    const p = String(path || "").trim();
    if (!p) return "";
    if (/^https?:\/\//i.test(p)) return p;
    return new URL(p.replace(/^\.\//, ""), new URL(".", window.location.href)).href;
  }

  function textToHtml(text) {
    return esc(text).replace(/\n/g, "<br>");
  }

  function renderFigures(figures) {
    const list = Array.isArray(figures) ? figures : [];
    if (!list.length) return "";
    return `<div class="hr-figures">${list
      .map((fig, i) => {
        const src = assetUrl(fig?.src);
        if (!src) return "";
        const alt = esc(fig?.alt || fig?.caption || `配图 ${i + 1}`);
        const cap = fig?.caption ? `<figcaption>${esc(fig.caption)}</figcaption>` : "";
        const isGif = fig?.type === "gif" || /\.gif(\?|$)/i.test(fig?.src || "");
        const cls = isGif ? "hr-figure hr-figure-gif" : "hr-figure";
        return `<figure class="${cls}">
          <button type="button" class="hr-figure-btn" data-hr-img="${esc(src)}" aria-label="查看大图：${alt}">
            <img src="${esc(src)}" alt="${alt}" loading="lazy" decoding="async"${isGif ? ' data-hr-gif="1"' : ""} />
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
  }

  function renderArticle(a) {
    const root = $("#hr-article");
    if (!root) return;
    if (!a) {
      root.innerHTML = `<p class="hint">暂无文章</p>`;
      return;
    }

    const tags = (a.tags || []).map((t) => `<span class="hr-tag">${esc(t)}</span>`).join("");
    const coverSrc = assetUrl(a.cover);
    const copyNote = a.copyright
      ? esc(a.copyright)
      : "版权归原作者与首发平台所有";
    const sourceLink = a.source?.url
      ? `<a href="${esc(a.source.url)}" target="_blank" rel="noopener noreferrer external">首发：${esc(a.source.name || "外链")}</a>`
      : "";

    root.innerHTML = `
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

    bindArticleInteractions(root);
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
