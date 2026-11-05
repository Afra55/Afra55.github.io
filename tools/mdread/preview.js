(() => {
  "use strict";

  /**
   * MD 阅读预览核：markdown-it + KaTeX + Mermaid + 高亮 + 大纲 + 图表/代码/表格放大下载。
   * 无本机桥依赖。
   */
  const VENDOR_BASE = new URL("../vendor/", document.baseURI).href;

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function slugify(name, fallback = "h") {
    return (
      String(name || "")
        .trim()
        .replace(/[\\/:*?"<>|#]+/g, " ")
        .replace(/\s+/g, "-")
        .replace(/^[.\-]+|[.\-]+$/g, "")
        .slice(0, 60) || fallback
    );
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-mdread-src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === "1") return resolve();
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error(src)));
        return;
      }
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.dataset.mdreadSrc = src;
      s.onload = () => {
        s.dataset.loaded = "1";
        resolve();
      };
      s.onerror = () => reject(new Error(`无法加载 ${src}`));
      document.head.appendChild(s);
    });
  }

  function ensureCss(id, href) {
    if (document.getElementById(id)) return;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }

  let vendorsPromise = null;
  function ensureVendors() {
    if (vendorsPromise) return vendorsPromise;
    vendorsPromise = (async () => {
      ensureCss("mdread-katex-css", `${VENDOR_BASE}katex/katex.min.css`);
      await loadScript(`${VENDOR_BASE}markdown-it.min.js`);
      await loadScript(`${VENDOR_BASE}purify.min.js`);
      await Promise.all([
        loadScript(`${VENDOR_BASE}highlight/highlight.min.js`).catch(() => null),
        loadScript(`${VENDOR_BASE}mdext/mdext.js`).catch(() => null),
        loadScript(`${VENDOR_BASE}katex/markdown-it-katex.js`).catch(() => null),
      ]);
    })();
    return vendorsPromise;
  }

  let mermaidPromise = null;
  function ensureMermaid() {
    if (window.mermaid) return Promise.resolve(true);
    if (mermaidPromise) return mermaidPromise;
    mermaidPromise = loadScript(`${VENDOR_BASE}mermaid/mermaid.min.js`)
      .then(() => true)
      .catch(() => false);
    return mermaidPromise;
  }

  function createMd() {
    if (typeof window.markdownit !== "function") return null;
    const md = window.markdownit({
      html: true,
      linkify: true,
      breaks: false,
      highlight(str, lang) {
        const hljs = window.hljs;
        const L = String(lang || "").trim().toLowerCase();
        if (L === "mermaid") {
          return `<pre class="mdm-mermaid-pre"><code class="language-mermaid">${escapeHtml(str)}</code></pre>`;
        }
        const safe = /^[a-z0-9_+-]+$/.test(L) ? L : "";
        if (safe && hljs?.getLanguage?.(safe)) {
          try {
            return `<pre class="hljs"><code class="language-${safe}">${
              hljs.highlight(str, { language: safe, ignoreIllegals: true }).value
            }</code></pre>`;
          } catch (_) {}
        }
        return `<pre class="hljs"><code>${escapeHtml(str)}</code></pre>`;
      },
    });
    try {
      if (typeof window.markdownItKatex === "function") md.use(window.markdownItKatex);
    } catch (_) {}
    try {
      const ex = window.markdownItExtras || {};
      if (ex.footnote) md.use(ex.footnote);
      if (ex.deflist) md.use(ex.deflist);
      if (ex.emoji) md.use(ex.emoji);
      if (ex.mark) md.use(ex.mark);
      if (ex.abbr) md.use(ex.abbr);
      if (ex.sub) md.use(ex.sub);
      if (ex.sup) md.use(ex.sup);
    } catch (_) {}
    return md;
  }

  function renderMarkdown(md, text) {
    const raw = md ? md.render(String(text || "")) : `<pre>${escapeHtml(text || "")}</pre>`;
    return window.DOMPurify
      ? window.DOMPurify.sanitize(raw, {
          USE_PROFILES: { html: true },
          ADD_TAGS: ["video", "audio", "source", "figure", "figcaption", "mark", "details", "summary"],
          ADD_ATTR: ["controls", "playsinline", "poster", "style", "width", "height", "align", "target", "rel"],
        })
      : raw;
  }

  function applyTaskLists(root) {
    root.querySelectorAll("li").forEach((li) => {
      const holder = li.firstElementChild?.tagName === "P" ? li.firstElementChild : li;
      const node = holder.firstChild;
      if (!node || node.nodeType !== 3) return;
      const m = node.nodeValue.match(/^\[([ xX])\]\s+/);
      if (!m) return;
      node.nodeValue = node.nodeValue.slice(m[0].length);
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = m[1].toLowerCase() === "x";
      cb.className = "mdm-task-cb";
      cb.disabled = true;
      holder.insertBefore(cb, holder.firstChild);
      li.classList.add("mdm-task");
    });
  }

  function applyHeadingAnchors(root) {
    const used = new Set();
    root.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((h) => {
      const base = slugify(h.textContent || "", "h");
      let id = base;
      let i = 2;
      while (used.has(id)) {
        id = `${base}-${i++}`;
      }
      used.add(id);
      h.id = id;
    });
  }

  function buildOutline(root, outlineEl) {
    if (!outlineEl) return;
    const heads = [...root.querySelectorAll("h1,h2,h3,h4,h5,h6")];
    if (!heads.length) {
      outlineEl.innerHTML = `<p class="hint tight">无标题</p>`;
      return;
    }
    outlineEl.innerHTML = heads
      .map((h) => {
        const lvl = Number(h.tagName.slice(1)) || 1;
        return `<button type="button" class="outline-item lv${lvl}" data-id="${escapeHtml(h.id)}">${escapeHtml(
          h.textContent || ""
        )}</button>`;
      })
      .join("");
  }

  function downloadBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name || "download.bin";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function measureSvgSize(svg) {
    try {
      const vb = svg.viewBox?.baseVal;
      if (vb?.width && vb?.height) return { w: vb.width, h: vb.height };
    } catch (_) {}
    const r = svg.getBoundingClientRect?.() || { width: 800, height: 600 };
    return { w: r.width || 800, h: r.height || 600 };
  }

  function svgForExport(svg) {
    const clone = svg.cloneNode(true);
    if (!clone.getAttribute("xmlns")) clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const { w, h } = measureSvgSize(svg);
    clone.setAttribute("width", String(Math.round(w)));
    clone.setAttribute("height", String(Math.round(h)));
    const body = new XMLSerializer().serializeToString(clone);
    return body.startsWith("<?xml") ? body : `<?xml version="1.0" encoding="UTF-8"?>${body}`;
  }

  function tableToCsv(table) {
    return [...table.querySelectorAll("tr")]
      .map((tr) =>
        [...tr.children]
          .map((c) => `"${String(c.innerText || "").replace(/\r?\n/g, " ").replace(/"/g, '""')}"`)
          .join(",")
      )
      .join("\n");
  }

  function decorateTools(root, api) {
    root.querySelectorAll(".mdm-mermaid").forEach((div) => {
      if (div.querySelector(".mdm-mermaid-zoom")) return;
      const zoom = document.createElement("button");
      zoom.type = "button";
      zoom.className = "ghost-btn mdm-mermaid-zoom";
      zoom.textContent = "放大";
      const dl = document.createElement("button");
      dl.type = "button";
      dl.className = "ghost-btn mdm-mermaid-dl";
      dl.textContent = "下载";
      div.appendChild(dl);
      div.appendChild(zoom);
    });

    root.querySelectorAll("pre").forEach((pre) => {
      if (pre.classList.contains("mdm-mermaid-pre") || pre.querySelector("code.language-mermaid")) return;
      if (pre.querySelector(".mdm-code-toolbar")) return;
      const bar = document.createElement("div");
      bar.className = "mdm-code-toolbar";
      [["放大", "zoom"], ["下载", "dl"], ["复制", "copy"]].forEach(([label, act]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ghost-btn mdm-code-btn";
        b.dataset.act = act;
        b.textContent = label;
        bar.appendChild(b);
      });
      pre.appendChild(bar);
    });

    root.querySelectorAll("table").forEach((table) => {
      if (table.closest(".mdm-table-wrap")) return;
      const wrap = document.createElement("div");
      wrap.className = "mdm-table-wrap";
      table.parentNode.insertBefore(wrap, table);
      wrap.appendChild(table);
      const bar = document.createElement("div");
      bar.className = "mdm-table-toolbar";
      [["放大", "zoom"], ["CSV", "csv"], ["HTML", "html"]].forEach(([label, act]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "ghost-btn mdm-table-btn";
        b.dataset.act = act;
        b.textContent = label;
        bar.appendChild(b);
      });
      wrap.appendChild(bar);
    });
  }

  async function renderMermaid(root, toast) {
    const codes = [...root.querySelectorAll("pre > code.language-mermaid, code.language-mermaid")];
    if (!codes.length) return;
    const ok = await ensureMermaid();
    if (!ok || !window.mermaid) {
      toast?.("Mermaid 未加载，图表保留为源码");
      return;
    }
    try {
      window.mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        suppressErrorRendering: true,
        theme: matchMedia("(prefers-color-scheme: light)").matches ? "default" : "dark",
      });
    } catch (_) {}
    for (const code of codes) {
      const src = (code.textContent || "").trim();
      const pre = code.closest("pre") || code.parentElement;
      if (!src || !pre) continue;
      try {
        const id = `mrm${Math.random().toString(36).slice(2, 9)}`;
        const { svg } = await window.mermaid.render(id, src);
        const div = document.createElement("div");
        div.className = "mdm-mermaid";
        div.innerHTML = svg;
        pre.replaceWith(div);
      } catch (err) {
        pre.classList.add("mdm-mermaid-error");
        console.warn("[mdread] mermaid", err);
      }
    }
  }

  function createLightbox(toast) {
    let dlg = document.getElementById("mdread-lightbox");
    if (!dlg) {
      dlg = document.createElement("dialog");
      dlg.id = "mdread-lightbox";
      dlg.className = "mdread-lightbox";
      dlg.innerHTML =
        `<div class="lb-inner">` +
        `<div class="lb-head"><p class="hint tight" id="mdread-lb-cap"></p>` +
        `<button type="button" class="ghost-btn" id="mdread-lb-close">关闭</button></div>` +
        `<div class="lb-stage" id="mdread-lb-stage">` +
        `<div id="mdread-lb-host" class="lb-host"></div></div>` +
        `<div class="lb-toolbar">` +
        `<button type="button" class="ghost-btn" id="mdread-lb-out">－</button>` +
        `<span class="mono" id="mdread-lb-pct">100%</span>` +
        `<button type="button" class="ghost-btn" id="mdread-lb-in">＋</button>` +
        `<button type="button" class="ghost-btn" id="mdread-lb-reset">还原</button>` +
        `<button type="button" class="ghost-btn" id="mdread-lb-dl">下载</button>` +
        `</div></div>`;
      document.body.appendChild(dlg);
    }
    const stage = dlg.querySelector("#mdread-lb-stage");
    const host = dlg.querySelector("#mdread-lb-host");
    const cap = dlg.querySelector("#mdread-lb-cap");
    const pct = dlg.querySelector("#mdread-lb-pct");
    const view = { scale: 1, x: 0, y: 0 };
    let mode = "svg";
    let payload = null;

    const sync = () => {
      host.style.transform = `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px)) scale(${view.scale})`;
      if (pct) pct.textContent = `${Math.round(view.scale * 100)}%`;
    };
    const fit = () => {
      view.scale = mode === "code" || mode === "table" ? 0.95 : 1;
      view.x = 0;
      view.y = 0;
      sync();
    };
    const close = () => {
      try {
        dlg.close();
      } catch (_) {
        dlg.removeAttribute("open");
      }
      host.innerHTML = "";
      payload = null;
    };

    dlg.querySelector("#mdread-lb-close")?.addEventListener("click", close);
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) close();
    });
    dlg.querySelector("#mdread-lb-in")?.addEventListener("click", () => {
      view.scale = Math.min(6, view.scale * 1.2);
      sync();
    });
    dlg.querySelector("#mdread-lb-out")?.addEventListener("click", () => {
      view.scale = Math.max(0.25, view.scale / 1.2);
      sync();
    });
    dlg.querySelector("#mdread-lb-reset")?.addEventListener("click", fit);
    stage?.addEventListener(
      "wheel",
      (e) => {
        if (!dlg.open) return;
        e.preventDefault();
        view.scale = Math.min(6, Math.max(0.25, view.scale * Math.exp(-e.deltaY * 0.0015)));
        sync();
      },
      { passive: false }
    );
    dlg.querySelector("#mdread-lb-dl")?.addEventListener("click", () => {
      if (!payload) return;
      if (mode === "svg" && payload.svg) {
        downloadBlob(new Blob([payload.svg], { type: "image/svg+xml;charset=utf-8" }), "mermaid-chart.svg");
        toast?.("已下载 mermaid-chart.svg");
      } else if (mode === "code") {
        downloadBlob(new Blob([payload.text || ""], { type: "text/plain;charset=utf-8" }), payload.name || "code.txt");
        toast?.(`已下载 ${payload.name || "code.txt"}`);
      } else if (mode === "table") {
        downloadBlob(new Blob(["\ufeff" + (payload.csv || "")], { type: "text/csv;charset=utf-8" }), "table.csv");
        toast?.("已下载 table.csv");
      }
    });

    function open(kind, data, caption) {
      mode = kind;
      payload = data;
      host.innerHTML = "";
      host.className = `lb-host is-${kind}`;
      if (kind === "svg") host.innerHTML = data.html || data.svg || "";
      else if (kind === "code") {
        const pre = document.createElement("pre");
        const code = document.createElement("code");
        if (data.html) code.innerHTML = data.html;
        else code.textContent = data.text || "";
        pre.appendChild(code);
        host.appendChild(pre);
      } else if (kind === "table") {
        host.appendChild(data.node);
      }
      if (cap) cap.textContent = caption || "";
      try {
        dlg.showModal();
      } catch (_) {
        dlg.setAttribute("open", "");
      }
      requestAnimationFrame(fit);
    }

    return { open, close };
  }

  function bindPreviewClicks(root, lb, toast) {
    root.addEventListener("click", (e) => {
      const zoomM = e.target.closest?.(".mdm-mermaid-zoom");
      if (zoomM && root.contains(zoomM)) {
        e.preventDefault();
        const div = zoomM.closest(".mdm-mermaid");
        const svg = div?.querySelector("svg");
        if (!svg) return toast?.("图表尚未渲染");
        const markup = svgForExport(svg);
        lb.open("svg", { svg: markup, html: markup }, "图表 · 滚轮缩放 · 可下载 SVG");
        return;
      }
      const dlM = e.target.closest?.(".mdm-mermaid-dl");
      if (dlM && root.contains(dlM)) {
        e.preventDefault();
        const div = dlM.closest(".mdm-mermaid");
        const svg = div?.querySelector("svg");
        if (!svg) return toast?.("图表尚未渲染");
        downloadBlob(new Blob([svgForExport(svg)], { type: "image/svg+xml;charset=utf-8" }), "mermaid-chart.svg");
        toast?.("已下载 mermaid-chart.svg");
        return;
      }
      const codeBtn = e.target.closest?.(".mdm-code-btn");
      if (codeBtn && root.contains(codeBtn)) {
        e.preventDefault();
        const pre = codeBtn.closest("pre");
        const code = pre?.querySelector("code");
        const text = (code || pre)?.innerText || "";
        const act = codeBtn.dataset.act;
        if (act === "copy") {
          navigator.clipboard?.writeText(text).then(
            () => toast?.("已复制代码"),
            () => toast?.("复制失败")
          );
          return;
        }
        if (act === "dl") {
          const cls = code?.className || "";
          const m = cls.match(/language-([a-z0-9_+-]+)/i);
          const ext = (m?.[1] || "txt").replace(/javascript/i, "js").replace(/typescript/i, "ts");
          downloadBlob(new Blob([text], { type: "text/plain;charset=utf-8" }), `code.${ext}`);
          toast?.(`已下载 code.${ext}`);
          return;
        }
        if (act === "zoom") {
          lb.open(
            "code",
            { text, html: code?.innerHTML || "", name: "code.txt" },
            "代码 · 滚轮缩放 · 可下载"
          );
        }
        return;
      }
      const tableBtn = e.target.closest?.(".mdm-table-btn");
      if (tableBtn && root.contains(tableBtn)) {
        e.preventDefault();
        const wrap = tableBtn.closest(".mdm-table-wrap");
        const table = wrap?.querySelector("table");
        if (!table) return;
        const act = tableBtn.dataset.act;
        if (act === "csv") {
          downloadBlob(new Blob(["\ufeff" + tableToCsv(table)], { type: "text/csv;charset=utf-8" }), "table.csv");
          toast?.("已下载 table.csv");
          return;
        }
        if (act === "html") {
          const html = `<!doctype html><meta charset="utf-8"><style>table{border-collapse:collapse;width:100%}th,td{border:1px solid #ccc;padding:.35rem}</style>${table.outerHTML}`;
          downloadBlob(new Blob([html], { type: "text/html;charset=utf-8" }), "table.html");
          toast?.("已下载 table.html");
          return;
        }
        if (act === "zoom") {
          const clone = table.cloneNode(true);
          lb.open("table", { node: clone, csv: tableToCsv(table) }, "表格 · 滚轮缩放 · 可下载 CSV");
        }
      }
    });
  }

  /**
   * @param {{ preview: HTMLElement, outline?: HTMLElement|null, toast?: (s:string)=>void }} opts
   */
  function createPreview(opts) {
    const preview = opts.preview;
    const outline = opts.outline || null;
    const toast = opts.toast || (() => {});
    let md = null;
    const lb = createLightbox(toast);
    bindPreviewClicks(preview, lb, toast);

    outline?.addEventListener("click", (e) => {
      const btn = e.target.closest?.("[data-id]");
      if (!btn) return;
      const target = preview.querySelector(`#${CSS.escape(btn.dataset.id)}`);
      target?.scrollIntoView({ behavior: "smooth", block: "start" });
    });

    return {
      async ready() {
        await ensureVendors();
        md = createMd();
      },
      async render(text) {
        await ensureVendors();
        if (!md) md = createMd();
        preview.innerHTML = renderMarkdown(md, text);
        applyTaskLists(preview);
        applyHeadingAnchors(preview);
        await renderMermaid(preview, toast);
        decorateTools(preview);
        buildOutline(preview, outline);
      },
      clear() {
        preview.innerHTML = "";
        if (outline) outline.innerHTML = "";
        lb.close();
      },
    };
  }

  window.DevToolsMdReadPreview = { createPreview, ensureVendors, escapeHtml, slugify };
})();
