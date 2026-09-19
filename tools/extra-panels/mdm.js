(() => {
  "use strict";

  const K = window.DevToolsExtraKit;
  if (!K) return;
  const { $, $$, setError, toast, bindPanel, escapeHtml } = K;

  const IDB_NAME = "devtools-mdm";
  const IDB_VER = 2;
  const DIR_KEY = "mdm-dir-handle";
  const BASE_KEY = "devtools-mdm-base";
  const TOKEN_KEY = "devtools-mdm-token";
  const SPLIT_KEY = "devtools-mdm-split";
  const DEFAULT_BASE = "http://127.0.0.1:17888";
  const DEFAULT_TOKEN = "devtools-bridge";
  const INDEX_FILE = "mdindex.json";

  const PANDOC_FORMATS = [
    ["docx", "Word (.docx)"],
    ["odt", "OpenDocument (.odt)"],
    ["epub", "EPUB (.epub)"],
    ["rtf", "RTF (.rtf)"],
    ["rst", "reStructuredText (.rst)"],
    ["latex", "LaTeX (.tex)"],
    ["pptx", "PowerPoint (.pptx)"],
    ["mediawiki", "MediaWiki (.wiki)"],
    ["org", "Org-mode (.org)"],
    ["opml", "OPML (.opml)"],
    ["html", "HTML（Pandoc）"],
  ];
  const LOCAL_FORMATS = [
    ["md", "Markdown (.md)"],
    ["html-standalone", "HTML（单文件）"],
    ["pdf", "PDF（打印）"],
    ["png", "长图 PNG"],
  ];

  function uid() {
    return `m${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  }

  function slugify(name, fallback = "doc") {
    const s = String(name || "")
      .trim()
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, "-")
      .replace(/^[.\-]+|[.\-]+$/g, "")
      .slice(0, 60);
    return s || fallback;
  }

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("docs")) db.createObjectStore("docs");
        if (!db.objectStoreNames.contains("assets")) db.createObjectStore("assets");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGet(store, key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readonly");
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(store, key, val) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).put(val, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function idbDel(store, key) {
    const db = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  const state = {
    mode: "", // dir | idb
    dirHandle: null,
    index: null,
    currentId: "",
    dirty: false,
    view: null,
    suppressEditorChange: false,
    search: "",
    activeCat: "all",
    activeTag: "",
    viewMode: "edit",
    previewTimer: 0,
    autoSaveTimer: 0,
    ftTimer: 0,
    searchMatches: null,
    bodyCache: new Map(),
    splitRatio: 0.5,
  };
  try {
    const r = Number(localStorage.getItem("devtools-mdm-split"));
    if (r >= 0.15 && r <= 0.85) state.splitRatio = r;
  } catch (_) {}

  function emptyIndex() {
    return { version: 1, cats: [], tags: [], items: [] };
  }

  function readIndexRaw() {
    try {
      const raw = localStorage.getItem("devtools-mdm-index-cache");
      if (raw) return JSON.parse(raw);
    } catch (_) {}
    return null;
  }

  function cacheIndex() {
    try {
      const json = JSON.stringify(state.index || emptyIndex());
      // 大索引不写 localStorage（约 5MB 上限），避免写失败/变慢；只靠 mdindex.json
      if (json.length > 900 * 1024) {
        try { localStorage.removeItem("devtools-mdm-index-cache"); } catch (_) {}
        return;
      }
      localStorage.setItem("devtools-mdm-index-cache", json);
    } catch (_) {}
  }

  bindPanel("mdm", () => {
    const els = {
      pickDir: $("#mdm-pick-dir"),
      newBtn: $("#mdm-new"),
      importBtn: $("#mdm-import"),
      importDirBtn: $("#mdm-import-dir"),
      importDirInput: $("#mdm-import-dir-input"),
      save: $("#mdm-save"),
      exportFmt: $("#mdm-export-fmt"),
      exportBtn: $("#mdm-export"),
      dirLabel: $("#mdm-dir-label"),
      error: $("#mdm-error"),
      layout: $("#mdm-layout"),
      search: $("#mdm-search"),
      cats: $("#mdm-cats"),
      tags: $("#mdm-tags"),
      list: $("#mdm-list"),
      modeEdit: $("#mdm-mode-edit"),
      modeSplit: $("#mdm-mode-split"),
      modePreview: $("#mdm-mode-preview"),
      title: $("#mdm-title"),
      del: $("#mdm-delete"),
      insertImg: $("#mdm-insert-img"),
      fileInput: $("#mdm-file-input"),
      insertToggle: $("#mdm-insert-toggle"),
      insertDropdown: $("#mdm-insert-dropdown"),
      saveStatus: $("#mdm-save-status"),
      cat: $("#mdm-cat"),
      catList: $("#mdm-cat-list"),
      tagChips: $("#mdm-tag-chips"),
      tagInput: $("#mdm-tag-input"),
      editorWrap: $("#mdm-editor-wrap"),
      editor: $("#mdm-editor"),
      splitter: $("#mdm-splitter"),
      preview: $("#mdm-preview"),
      empty: $("#mdm-empty"),
      outline: $("#mdm-outline"),
    };
    if (!els.pickDir) return;

    const setErr = (m) => setError(els.error, m);

    function baseUrl() {
      return String(localStorage.getItem(BASE_KEY) || DEFAULT_BASE).replace(/\/$/, "");
    }
    function token() {
      return String(localStorage.getItem(TOKEN_KEY) || DEFAULT_TOKEN).trim();
    }

    // ---- markdown render ----
    /** 宽松 ATX 标题：允许 `#标题`（# 后无空格），兼容常见中文写法 */
    function headingLoose(state, startLine, endLine, silent) {
      let pos = state.bMarks[startLine] + state.tShift[startLine];
      let max = state.eMarks[startLine];
      if (state.sCount[startLine] - state.blkIndent >= 4) return false;
      if (state.src.charCodeAt(pos) !== 0x23 || pos >= max) return false;
      let level = 1;
      let ch = state.src.charCodeAt(++pos);
      while (ch === 0x23 && pos < max && level <= 6) {
        level++;
        ch = state.src.charCodeAt(++pos);
      }
      if (level > 6) return false;
      if (silent) return true;
      max = state.skipSpacesBack(max, pos);
      const tmp = state.skipCharsBack(max, 0x23, pos);
      if (tmp > pos && (state.src.charCodeAt(tmp - 1) === 0x20 || state.src.charCodeAt(tmp - 1) === 0x09)) {
        max = tmp;
      }
      state.line = startLine + 1;
      const tokenO = state.push("heading_open", `h${level}`, 1);
      tokenO.markup = "########".slice(0, level);
      tokenO.map = [startLine, state.line];
      const tokenI = state.push("inline", "", 0);
      tokenI.content = state.src.slice(pos, max).trim();
      tokenI.map = [startLine, state.line];
      tokenI.children = [];
      const tokenC = state.push("heading_close", `h${level}`, -1);
      tokenC.markup = "########".slice(0, level);
      return true;
    }

    let md = null;
    function getMd() {
      if (md) return md;
      if (typeof window.markdownit !== "function") return null;
      md = window.markdownit({
        html: true,
        linkify: true,
        breaks: false,
        highlight(str, lang) {
          const hljs = window.hljs;
          if (lang && hljs?.getLanguage?.(lang)) {
            try {
              return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
            } catch (_) {}
          }
          return `<pre class="hljs"><code>${escapeHtml(str)}</code></pre>`;
        },
      });
      try {
        md.block.ruler.at("heading", headingLoose, {
          alt: ["paragraph", "reference", "blockquote", "list"],
        });
      } catch (_) {}
      try {
        if (typeof window.markdownItKatex === "function") md.use(window.markdownItKatex);
      } catch (_) {}
      return md;
    }

    /** 注入 KaTeX 样式（字体相对 CSS 解析） */
    function ensureKatexCss() {
      if (document.getElementById("mdm-katex-css")) return;
      const link = document.createElement("link");
      link.id = "mdm-katex-css";
      link.rel = "stylesheet";
      link.href = `./vendor/katex/katex.min.css?v=${encodeURIComponent(window.TOOLS_BUILD || "")}`;
      document.head.appendChild(link);
    }

    function renderMarkdown(text) {
      const inst = getMd();
      const rawHtml = inst ? inst.render(String(text || "")) : `<pre>${escapeHtml(text || "")}</pre>`;
      const safe = window.DOMPurify
        ? window.DOMPurify.sanitize(rawHtml, {
            USE_PROFILES: { html: true },
            ADD_TAGS: ["video", "audio", "source", "track", "figure", "figcaption", "mark", "details", "summary"],
            ADD_ATTR: [
              "controls", "playsinline", "poster", "preload", "loop", "muted", "download",
              "target", "rel", "start", "type",
            ],
          })
        : rawHtml;
      return safe;
    }

    // ---- storage layer ----
    async function loadIndexFromStorage() {
      if (state.mode === "dir" && state.dirHandle) {
        try {
          const fh = await state.dirHandle.getFileHandle(INDEX_FILE);
          const file = await fh.getFile();
          const text = await file.text();
          if (text.trim()) return JSON.parse(text);
        } catch (_) {
          return emptyIndex();
        }
      }
      if (state.mode === "idb") {
        const val = await idbGet("kv", "index");
        if (val) return val;
      }
      return emptyIndex();
    }

    async function saveIndexToStorage() {
      cacheIndex();
      if (state.mode === "dir" && state.dirHandle) {
        const fh = await state.dirHandle.getFileHandle(INDEX_FILE, { create: true });
        const w = await fh.createWritable();
        await w.write(JSON.stringify(state.index, null, 2));
        await w.close();
      } else if (state.mode === "idb") {
        await idbSet("kv", "index", state.index);
      }
    }

    async function readDocText(item) {
      if (state.mode === "dir" && state.dirHandle) {
        const fh = await state.dirHandle.getFileHandle(item.fileName);
        const file = await fh.getFile();
        return file.text();
      }
      const rec = await idbGet("docs", item.id);
      return rec?.text || "";
    }

    async function writeDocText(item, text) {
      if (state.mode === "dir" && state.dirHandle) {
        const fh = await state.dirHandle.getFileHandle(item.fileName, { create: true });
        const w = await fh.createWritable();
        await w.write(text);
        await w.close();
      } else {
        await idbSet("docs", item.id, { text, updatedAt: Date.now() });
      }
    }

    async function removeDocFile(item) {
      if (state.mode === "dir" && state.dirHandle) {
        try {
          await state.dirHandle.removeEntry(item.fileName);
        } catch (_) {}
      } else {
        await idbDel("docs", item.id);
      }
    }

    function uniqueFileName(title, excludeId) {
      const used = new Set(
        (state.index.items || []).filter((x) => x.id !== excludeId).map((x) => x.fileName)
      );
      const base = slugify(title, "doc");
      let name = `${base}.md`;
      let n = 2;
      while (used.has(name)) name = `${base}-${n++}.md`;
      return name;
    }

    // ---- index helpers ----
    function findItem(id) {
      return (state.index?.items || []).find((x) => x.id === id) || null;
    }

    function ensureCat(name) {
      const n = String(name || "").trim();
      if (!n) return "";
      let c = state.index.cats.find((x) => x.name === n);
      if (!c) {
        c = { id: uid(), name: n };
        state.index.cats.push(c);
      }
      return c.id;
    }

    function ensureTag(name) {
      const n = String(name || "").trim();
      if (!n) return "";
      let t = state.index.tags.find((x) => x.name === n);
      if (!t) {
        t = { id: uid(), name: n };
        state.index.tags.push(t);
      }
      return t.id;
    }

    // ---- rendering: sidebar ----
    function filteredItems() {
      const q = state.search.trim().toLowerCase();
      const ft = state.searchMatches;
      return (state.index.items || []).filter((it) => {
        if (state.activeCat !== "all" && it.catId !== state.activeCat) return false;
        if (state.activeTag && !(it.tagIds || []).includes(state.activeTag)) return false;
        if (q) {
          const hay = `${it.title} ${it.excerpt || ""}`.toLowerCase();
          if (!hay.includes(q) && !(ft && ft.has(it.id))) return false;
        }
        return true;
      });
    }

    // ---- 全文搜索（按需读取正文，带缓存） ----
    function scheduleFullTextSearch() {
      window.clearTimeout(state.ftTimer);
      const q = state.search.trim().toLowerCase();
      if (q.length < 2) {
        state.searchMatches = null;
        renderSidebar();
        return;
      }
      state.ftTimer = window.setTimeout(() => void runFullTextSearch(q), 350);
    }
    async function runFullTextSearch(q) {
      const items = state.index.items || [];
      const matched = new Set();
      const need = [];
      for (const it of items) {
        if (state.bodyCache.has(it.id)) {
          if (state.bodyCache.get(it.id).toLowerCase().includes(q)) matched.add(it.id);
        } else need.push(it);
      }
      if (need.length) {
        let i = 0;
        let done = 0;
        const worker = async () => {
          while (i < need.length) {
            const it = need[i++];
            try {
              const t = await readDocText(it);
              state.bodyCache.set(it.id, t);
              if (t.toLowerCase().includes(q)) matched.add(it.id);
            } catch (_) {}
            done += 1;
          }
        };
        await Promise.all(Array.from({ length: 6 }, worker));
      }
      if (state.search.trim().toLowerCase() !== q) return;
      state.searchMatches = matched;
      renderSidebar();
      setSaveStatus(`全文匹配 ${matched.size} 篇`);
    }

    function renderSidebar() {
      const items = filteredItems();
      if (els.cats) {
        const cats = state.index.cats || [];
        els.cats.innerHTML =
          `<div class="mdm-group-title">分类</div>` +
          `<button type="button" class="mdm-chip${state.activeCat === "all" ? " is-active" : ""}" data-cat="all">全部 (${(state.index.items || []).length})</button>` +
          cats
            .map((c) => {
              const n = (state.index.items || []).filter((x) => x.catId === c.id).length;
              return `<button type="button" class="mdm-chip${state.activeCat === c.id ? " is-active" : ""}" data-cat="${escapeHtml(c.id)}">${escapeHtml(c.name)} (${n})</button>`;
            })
            .join("");
      }
      if (els.tags) {
        const tags = state.index.tags || [];
        els.tags.innerHTML =
          `<div class="mdm-group-title">标签</div>` +
          (tags.length
            ? tags
                .map(
                  (t) =>
                    `<button type="button" class="mdm-chip${state.activeTag === t.id ? " is-active" : ""}" data-tag="${escapeHtml(t.id)}">#${escapeHtml(t.name)}</button>`
                )
                .join("")
            : `<span class="hint tight">暂无标签</span>`);
      }
      if (els.list) {
        els.list.innerHTML = items.length
          ? items
              .map((it) => {
                const cat = state.index.cats.find((c) => c.id === it.catId);
                const tags = (it.tagIds || [])
                  .map((tid) => state.index.tags.find((t) => t.id === tid)?.name)
                  .filter(Boolean)
                  .map((n) => `#${escapeHtml(n)}`)
                  .join(" ");
                return `<button type="button" class="mdm-item${it.id === state.currentId ? " is-active" : ""}" data-id="${escapeHtml(it.id)}">
                  <span class="mdm-item-title">${escapeHtml(it.title || "未命名")}</span>
                  <span class="mdm-item-meta hint tight">${cat ? escapeHtml(cat.name) + " · " : ""}${tags}</span>
                </button>`;
              })
              .join("")
          : `<span class="hint tight">没有匹配的文档</span>`;
      }
      renderMeta();
    }

    // ---- editor (CM6) ----
    function isDarkScheme() {
      return document.documentElement.dataset.themeScheme !== "light";
    }

    function buildHighlightStyle(CM) {
      const dark = isDarkScheme();
      return CM.HighlightStyle.define([
        { tag: CM.tags.heading, color: "var(--accent)", fontWeight: "700" },
        { tag: CM.tags.strong, fontWeight: "700" },
        { tag: CM.tags.emphasis, fontStyle: "italic" },
        { tag: [CM.tags.link, CM.tags.url], color: "var(--accent)", textDecoration: "underline" },
        { tag: [CM.tags.keyword, CM.tags.operator], color: dark ? "#c678dd" : "#a626a4" },
        { tag: [CM.tags.string, CM.tags.special(CM.tags.string)], color: dark ? "#98c379" : "#50a14f" },
        { tag: [CM.tags.number, CM.tags.bool], color: dark ? "#d19a66" : "#986801" },
        { tag: CM.tags.comment, color: "var(--muted)", fontStyle: "italic" },
        { tag: CM.tags.monospace, color: dark ? "#e5c07b" : "#c18401" },
        { tag: [CM.tags.tagName, CM.tags.attributeName], color: dark ? "#e06c75" : "#e45649" },
        { tag: CM.tags.strikethrough, textDecoration: "line-through" },
      ]);
    }

    function buildEditorTheme(CM) {
      return CM.EditorView.theme(
        {
          "&": { height: "100%", fontSize: "14px", backgroundColor: "transparent", color: "var(--ink)" },
          ".cm-scroller": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", lineHeight: "1.7" },
          ".cm-content": { caretColor: "var(--ink)" },
          ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--ink)" },
          "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
            backgroundColor: "color-mix(in srgb, var(--accent) 28%, transparent)",
          },
          ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--accent) 7%, transparent)" },
          ".cm-gutters": { backgroundColor: "transparent", color: "var(--muted)", border: "none" },
          ".cm-activeLineGutter": {
            backgroundColor: "color-mix(in srgb, var(--accent) 7%, transparent)",
            color: "var(--ink)",
          },
          ".cm-lineNumbers .cm-gutterElement": { color: "var(--muted)" },
          ".cm-foldPlaceholder": { backgroundColor: "transparent", border: "none", color: "var(--muted)" },
          ".cm-panels": { backgroundColor: "var(--panel-strong, var(--bg-0))", color: "var(--ink)" },
          ".cm-searchMatch": { backgroundColor: "color-mix(in srgb, var(--accent) 30%, transparent)" },
          ".cm-searchMatch.cm-searchMatch-selected": {
            backgroundColor: "color-mix(in srgb, var(--accent) 55%, transparent)",
          },
          ".cm-tooltip": {
            backgroundColor: "var(--panel-strong, var(--bg-0))",
            color: "var(--ink)",
            border: "1px solid var(--line)",
          },
        },
        { dark: isDarkScheme() }
      );
    }

    function ensureEditor() {
      if (state.view) return state.view;
      const CM = window.DevToolsCM6;
      if (!CM?.EditorView || !els.editor) return null;
      state.themeCompartment = state.themeCompartment || new CM.Compartment();
      state.hlCompartment = state.hlCompartment || new CM.Compartment();
      const exts = [
        CM.basicSetup,
        CM.markdown(),
        CM.EditorView.lineWrapping,
        state.themeCompartment.of(buildEditorTheme(CM)),
        state.hlCompartment.of(CM.syntaxHighlighting(buildHighlightStyle(CM))),
      ];
      exts.push(
        CM.keymap.of([
          { key: "Mod-s", run: () => { void saveCurrent(); return true; } },
          ...(CM.historyKeymap || []),
        ])
      );
      exts.push(
        CM.EditorView.updateListener.of((u) => {
          if (u.docChanged && !state.suppressEditorChange) {
            state.dirty = true;
            updateSaveBtn();
            schedulePreview();
            scheduleAutoSave();
          }
        })
      );
      state.view = new CM.EditorView({
        state: CM.EditorState.create({ doc: "", extensions: exts }),
        parent: els.editor,
      });
      return state.view;
    }

    /** 主题切换时让编辑器跟随站点主题 */
    function syncEditorTheme() {
      const CM = window.DevToolsCM6;
      if (!state.view || !CM || !state.themeCompartment) return;
      try {
        state.view.dispatch({
          effects: [
            state.themeCompartment.reconfigure(buildEditorTheme(CM)),
            state.hlCompartment.reconfigure(CM.syntaxHighlighting(buildHighlightStyle(CM))),
          ],
        });
      } catch (_) {}
    }
    try {
      new MutationObserver(syncEditorTheme).observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme-scheme", "data-theme-bg"],
      });
    } catch (_) {}


    function setEditorText(text) {
      const v = ensureEditor();
      if (!v) {
        if (els.editor) els.editor.textContent = text;
        return;
      }
      state.suppressEditorChange = true;
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: String(text || "") } });
      state.suppressEditorChange = false;
    }

    function getEditorText() {
      if (state.view) return state.view.state.doc.toString();
      return els.editor?.textContent || "";
    }

    // ---- preview + outline ----
    function schedulePreview() {
      window.clearTimeout(state.previewTimer);
      state.previewTimer = window.setTimeout(() => {
        renderPreview();
        renderOutline();
      }, 260);
    }

    function renderPreview() {
      if (!els.preview) return;
      els.preview.innerHTML = renderMarkdown(getEditorText());
      els.preview.querySelectorAll("a[href]").forEach((a) => {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
      });
      applyTaskLists(els.preview);
      void resolvePreviewAssets();
      void renderMermaidBlocks();
    }

    // ---- 本地资源（图片/视频/音频/附件，存在所选文件夹里，相对路径引用） ----
    const assetUrlCache = new Map();
    function blobToDataUrl(blob) {
      return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result || ""));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
    }
    async function readAssetBlob(rel) {
      const parts = String(rel || "").split("/").filter((p) => p && p !== ".");
      if (!parts.length) throw new Error("空路径");
      const clean = parts.join("/");
      if (state.mode === "dir" && state.dirHandle) {
        let dir = state.dirHandle;
        for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i]);
        const fh = await dir.getFileHandle(parts[parts.length - 1]);
        return await fh.getFile();
      }
      const rec = await idbGet("assets", clean);
      if (!rec) throw new Error("找不到资源");
      return rec instanceof Blob ? rec : new Blob([rec]);
    }
    function isRelativeRef(v) {
      return v && !/^(https?:|data:|blob:|#|mailto:|tel:|\/\/)/i.test(v);
    }
    async function resolvePreviewAssets() {
      if (!state.mode || !els.preview) return;
      const nodes = [...els.preview.querySelectorAll("img, video, audio, source, a[href]")];
      for (const el of nodes) {
        const attr = el.tagName === "A" ? "href" : "src";
        const v = el.getAttribute(attr) || "";
        if (!isRelativeRef(v)) continue;
        const rel = v.replace(/^\.\//, "").replace(/^\/+/, "");
        if (assetUrlCache.has(rel)) {
          el.setAttribute(attr, assetUrlCache.get(rel));
          continue;
        }
        try {
          const blob = await readAssetBlob(rel);
          const url = URL.createObjectURL(blob);
          assetUrlCache.set(rel, url);
          el.setAttribute(attr, url);
          if (el.tagName === "A") {
            el.setAttribute("download", rel.split("/").pop() || "");
            el.setAttribute("target", "_blank");
            el.setAttribute("rel", "noopener noreferrer");
          }
        } catch (_) {
          if (el.tagName === "IMG") {
            el.classList.add("mdm-img-missing");
            el.alt = el.alt || `图片缺失：${rel}`;
          }
        }
      }
    }
    /** 收集正文里引用的本地资源（图/视频/音频/附件链接） */
    function collectReferencedAssets(text) {
      const refs = new Set();
      const s = String(text || "");
      for (const re of [/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, /(?:src|href)\s*=\s*["']([^"']+)["']/gi]) {
        let m;
        while ((m = re.exec(s))) if (isRelativeRef(m[1])) refs.add(m[1].replace(/^\.\//, "").replace(/^\/+/, ""));
      }
      return [...refs];
    }
    async function inlineAssetsForExport(html) {
      if (!state.mode) return html;
      let root;
      try {
        root = new DOMParser().parseFromString(`<div id="__mdmroot">${html}</div>`, "text/html").getElementById("__mdmroot");
      } catch (_) {
        return html;
      }
      if (!root) return html;
      for (const el of [...root.querySelectorAll("img, video, audio, source, a[href]")]) {
        const attr = el.tagName === "A" ? "href" : "src";
        const v = el.getAttribute(attr) || "";
        if (!isRelativeRef(v)) continue;
        const rel = v.replace(/^\.\//, "").replace(/^\/+/, "");
        try {
          const blob = await readAssetBlob(rel);
          if (blob.size > 12 * 1024 * 1024) continue; // 过大不内联
          el.setAttribute(attr, await blobToDataUrl(blob));
        } catch (_) {}
      }
      return root.innerHTML;
    }

    // ---- Mermaid（按需懒加载，5MB+ 只在出现 mermaid 代码块时加载） ----
    let mermaidLoading = null;
    async function renderMermaidBlocks() {
      if (!els.preview) return;
      const codes = [...els.preview.querySelectorAll("pre > code.language-mermaid, code.language-mermaid")];
      if (!codes.length) return;
      if (!window.mermaid) {
        try {
          if (!mermaidLoading) mermaidLoading = window.DevToolsLazy?.loadVendor?.("mermaid");
          await mermaidLoading;
        } catch (_) {
          return;
        }
      }
      if (!window.mermaid) return;
      try {
        window.mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: document.documentElement.dataset.themeScheme === "light" ? "default" : "dark",
        });
      } catch (_) {}
      for (const code of codes) {
        const pre = code.closest("pre") || code.parentElement;
        const src = code.textContent || "";
        try {
          const { svg } = await window.mermaid.render(`mmd${Math.random().toString(36).slice(2, 9)}`, src);
          const div = document.createElement("div");
          div.className = "mdm-mermaid";
          div.innerHTML = svg;
          pre.replaceWith(div);
        } catch (_) {
          pre.classList.add("mdm-mermaid-error");
        }
      }
    }

    // ---- 编辑器内插入资源：图片/视频/音频/任意文件 → 存到 assets/ → 插入对应 Markdown ----
    async function saveAsset(file) {
      const ext = (String(file.name || "file").split(".").pop() || "bin").toLowerCase();
      const base = slugify(String(file.name || "file").replace(/\.[^.]+$/, ""), "file");
      const name = `${Date.now().toString(36)}-${base}.${ext}`;
      const rel = `assets/${name}`;
      if (state.mode === "dir" && state.dirHandle) {
        const dir = await state.dirHandle.getDirectoryHandle("assets", { create: true });
        const fh = await dir.getFileHandle(name, { create: true });
        const w = await fh.createWritable();
        await w.write(file);
        await w.close();
      } else {
        await idbSet("assets", rel, file);
      }
      return { rel };
    }

    function markdownForAsset(file, rel) {
      const mime = String(file.type || "");
      const label = String(file.name || rel.split("/").pop() || "文件");
      const noExt = label.replace(/\.[^.]+$/, "");
      if (/^image\//.test(mime) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(label)) return `![${noExt}](${rel})`;
      if (/^video\//.test(mime) || /\.(mp4|webm|mov|m4v|ogv)$/i.test(label)) return `<video src="${rel}" controls playsinline></video>`;
      if (/^audio\//.test(mime) || /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(label)) return `<audio src="${rel}" controls></audio>`;
      return `[${label}](${rel})`;
    }

    async function insertAssetFiles(files) {
      const list = [...(files || [])].filter(Boolean);
      if (!list.length) return false;
      const view = state.view;
      if (!view) return false;
      if (!state.mode) {
        setErr("插入文件需要先「选择文件夹」或进入本地存储模式");
        return true;
      }
      const parts = [];
      for (const f of list) {
        try {
          const a = await saveAsset(f);
          parts.push(markdownForAsset(f, a.rel));
        } catch (err) {
          setErr(`插入失败（${f.name}）：${err.message || err}`);
        }
      }
      if (parts.length) {
        view.dispatch(view.state.replaceSelection(parts.join("\n\n") + "\n"));
        toast(`已插入 ${parts.length} 个`);
      }
      return true;
    }

    function insertTemplate(kind) {
      const view = state.view;
      if (!view) return;
      const sel = view.state.selection.main;
      const selected = view.state.sliceDoc(sel.from, sel.to);
      const tpl = {
        link: () => `[${selected || "文字"}](https://)`,
        code: () => "```\n" + (selected || "") + "\n```",
        table: () => "| 列1 | 列2 | 列3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |",
        task: () => (selected ? selected.split("\n").map((l) => `- [ ] ${l}`).join("\n") : "- [ ] "),
        "math-inline": () => `$${selected || ""}$`,
        "math-block": () => `$$\n${selected || ""}\n$$`,
        mermaid: () => "```mermaid\nflowchart TD\n  A[开始] --> B{判断}\n  B -->|是| C[结束]\n```",
        divider: () => "\n---\n",
      }[kind];
      if (!tpl) return;
      view.dispatch(view.state.replaceSelection(tpl()));
      view.focus();
    }

    async function listAssetNames() {
      const out = [];
      if (state.mode === "dir" && state.dirHandle) {
        let dir;
        try {
          dir = await state.dirHandle.getDirectoryHandle("assets");
        } catch (_) {
          return out;
        }
        try {
          for await (const [name, handle] of dir.entries()) {
            if (handle.kind === "file") out.push(`assets/${name}`);
          }
        } catch (_) {}
      } else {
        const db = await idbOpen();
        await new Promise((resolve) => {
          const tx = db.transaction("assets", "readonly");
          const req = tx.objectStore("assets").openKeyCursor();
          req.onsuccess = () => {
            const c = req.result;
            if (c) {
              out.push(String(c.key));
              c.continue();
            } else resolve();
          };
          req.onerror = () => resolve();
        });
      }
      return out;
    }

    async function removeAsset(rel) {
      if (state.mode === "dir" && state.dirHandle) {
        const parts = String(rel || "").split("/").filter(Boolean);
        if (!parts.length) return;
        let dir = state.dirHandle;
        for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i]);
        try {
          await dir.removeEntry(parts[parts.length - 1]);
        } catch (_) {}
      } else {
        await idbDel("assets", rel);
      }
    }

    async function cleanOrphanAssets() {
      if (!state.mode) {
        setErr("请先选择文件夹或进入本地存储模式");
        return;
      }
      setSaveStatus("清理中…");
      try {
        const used = new Set();
        for (const it of state.index.items || []) {
          let text = state.bodyCache.get(it.id);
          if (text == null) {
            try {
              text = await readDocText(it);
              state.bodyCache.set(it.id, text);
            } catch (_) {
              text = "";
            }
          }
          for (const rel of collectReferencedAssets(text)) used.add(rel);
        }
        const all = await listAssetNames();
        const orphans = all.filter((n) => !used.has(n));
        if (!orphans.length) {
          setSaveStatus("");
          toast("没有可清理的未引用资源");
          return;
        }
        if (!window.confirm(`发现 ${orphans.length} 个未被引用的资源，删除？`)) {
          setSaveStatus("");
          return;
        }
        for (const n of orphans) await removeAsset(n);
        setSaveStatus(`已清理 ${orphans.length} 个未引用资源`);
        toast(`已清理 ${orphans.length} 个`);
      } catch (err) {
        setErr(`清理失败：${err.message || err}`);
      }
    }

    function hasRichHtml(html) {
      return /<(p|h[1-6]|ul|ol|li|table|thead|tbody|tr|td|th|strong|b|em|i|a\s|pre|code|blockquote|img|hr)\b/i.test(
        String(html || "")
      );
    }

    function htmlToMarkdown(html) {
      if (typeof window.TurndownService !== "function") return "";
      try {
        const svc = new window.TurndownService({
          headingStyle: "atx",
          codeBlockStyle: "fenced",
          bulletListMarker: "-",
          emDelimiter: "*",
        });
        return svc.turndown(String(html || ""));
      } catch (_) {
        return "";
      }
    }

    function bindEditorMedia() {
      const view = state.view;
      if (!view) return;
      const dom = view.dom;
      dom.addEventListener(
        "paste",
        (e) => {
          const files = [...(e.clipboardData?.files || [])];
          for (const it of e.clipboardData?.items || []) {
            if (it.kind === "file") {
              const f = it.getAsFile?.();
              if (f && !files.includes(f)) files.push(f);
            }
          }
          if (files.length) {
            e.preventDefault();
            void insertAssetFiles(files);
            return;
          }
          // 富文本 → Markdown
          const html = e.clipboardData?.getData?.("text/html") || "";
          if (html && hasRichHtml(html) && typeof window.TurndownService === "function") {
            const md = htmlToMarkdown(html);
            if (md.trim()) {
              e.preventDefault();
              view.dispatch(view.state.replaceSelection(md));
            }
          }
        },
        true
      );
      dom.addEventListener(
        "drop",
        (e) => {
          const files = [...(e.dataTransfer?.files || [])];
          if (files.length) {
            e.preventDefault();
            e.stopPropagation();
            void insertAssetFiles(files);
          }
        },
        true
      );
    }

    /** `- [ ]` / `- [x]` → 复选框（markdown-it 默认不支持任务列表） */
    function applyTaskLists(root) {
      root.querySelectorAll("li").forEach((li) => {
        const holder = li.firstElementChild && li.firstElementChild.tagName === "P" ? li.firstElementChild : li;
        const node = holder.firstChild;
        if (!node || node.nodeType !== 3) return;
        const m = node.nodeValue.match(/^\[([ xX])\]\s+/);
        if (!m) return;
        node.nodeValue = node.nodeValue.slice(m[0].length);
        const cb = document.createElement("input");
        cb.type = "checkbox";
        cb.disabled = true;
        cb.checked = m[1].toLowerCase() === "x";
        cb.className = "mdm-task-cb";
        holder.insertBefore(cb, holder.firstChild);
        li.classList.add("mdm-task");
      });
    }

    function renderOutline() {
      if (!els.outline) return;
      const heads = [...els.preview.querySelectorAll("h1,h2,h3,h4,h5,h6")];
      els.outline.innerHTML = heads.length
        ? `<div class="mdm-group-title">大纲</div>` +
          heads
            .map((h, i) => {
              const lvl = Number(h.tagName.slice(1));
              const text = h.textContent || "";
              return `<div class="mdm-outline-item lv${lvl}" data-h="${i}" role="button" tabindex="0" title="${escapeHtml(text)}">${escapeHtml(text)}</div>`;
            })
            .join("")
        : "";
    }

    function applySplit() {
      const wrap = els.editorWrap;
      if (!wrap) return;
      if (state.viewMode === "split") {
        const r = Math.max(0.15, Math.min(0.85, state.splitRatio));
        wrap.style.gridTemplateColumns = `${(r * 100).toFixed(2)}% 6px minmax(0, 1fr)`;
      } else {
        wrap.style.gridTemplateColumns = "";
      }
    }

    function applyViewMode() {
      const wrap = els.editorWrap;
      if (!wrap) return;
      wrap.dataset.mode = state.viewMode;
      [els.modeEdit, els.modeSplit, els.modePreview].forEach((b) => b?.classList.remove("is-active"));
      ({ edit: els.modeEdit, split: els.modeSplit, preview: els.modePreview }[state.viewMode] || els.modeEdit)?.classList.add("is-active");
      applySplit();
      if (state.viewMode !== "edit") renderPreview();
      if (state.viewMode !== "edit") renderOutline();
      CMresize();
    }

    (function bindSplitter() {
      const sp = els.splitter;
      const wrap = els.editorWrap;
      if (!sp || !wrap) return;
      let dragging = false;
      const onMove = (e) => {
        if (!dragging) return;
        e.preventDefault();
        const rect = wrap.getBoundingClientRect();
        if (!rect.width) return;
        state.splitRatio = Math.max(0.15, Math.min(0.85, (e.clientX - rect.left) / rect.width));
        applySplit();
      };
      const onUp = () => {
        if (!dragging) return;
        dragging = false;
        document.removeEventListener("pointermove", onMove);
        document.removeEventListener("pointerup", onUp);
        try { localStorage.setItem(SPLIT_KEY, String(state.splitRatio)); } catch (_) {}
      };
      sp.addEventListener("pointerdown", (e) => {
        dragging = true;
        document.addEventListener("pointermove", onMove);
        document.addEventListener("pointerup", onUp);
        e.preventDefault();
      });
    })();

    // ---- current doc ----
    async function openDoc(id) {
      // 自动保存：切换前先把未保存的写入
      if (state.dirty && findItem(state.currentId)) {
        window.clearTimeout(state.autoSaveTimer);
        try { await saveCurrent({ silent: true }); } catch (_) {}
      }
      const item = findItem(id);
      if (!item) return;
      setErr("");
      state.currentId = id;
      state.dirty = false;
      updateSaveBtn();
      if (els.title) els.title.value = item.title || "";
      try {
        const text = await readDocText(item);
        setEditorText(text);
        renderPreview();
        renderOutline();
      } catch (err) {
        const msg = String(err?.message || err);
        if (/could not be found|NotFound|not found|找不到|不存在/i.test(msg)) {
          // 索引里的文件缺失（被移动/删除/换目录）：按空文档打开，保存会重新创建
          setEditorText("");
          renderPreview();
          renderOutline();
          setErr(`「${item.title}」的 .md 文件不存在（可能被移动或删除）。已按空文档打开，保存会重新创建。`);
        } else {
          setErr(`读取失败：${msg}`);
        }
      }
      els.empty && (els.empty.hidden = true);
      renderSidebar();
    }

    function newDoc() {
      const item = {
        id: uid(),
        title: "未命名",
        titleSaved: "未命名",
        fileName: "",
        catId: "",
        tagIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
        size: 0,
        excerpt: "",
      };
      item.fileName = uniqueFileName(item.title, item.id);
      state.index.items.unshift(item);
      state.currentId = item.id;
      state.dirty = true;
      if (els.title) els.title.value = item.title;
      setEditorText("");
      renderPreview();
      renderSidebar();
      updateSaveBtn();
      els.empty && (els.empty.hidden = true);
      els.title?.focus();
      els.title?.select?.();
    }

    function setSaveStatus(text) {
      if (els.saveStatus) els.saveStatus.textContent = text || "";
    }

    async function saveCurrent(opts = {}) {
      const silent = Boolean(opts.silent);
      const item = findItem(state.currentId);
      if (!item) return;
      const text = getEditorText();
      const title = String(els.title?.value || item.title || "未命名").trim() || "未命名";
      item.title = title;
      // 标题变化 → 文件名跟随（用 titleSaved 记录上次写盘时的标题）
      if (item.titleSaved !== title) {
        const oldName = item.fileName;
        item.fileName = uniqueFileName(title, item.id);
        if (oldName && oldName !== item.fileName) {
          try { await removeDocFile({ ...item, fileName: oldName }); } catch (_) {}
        }
        item.titleSaved = title;
      }
      item.updatedAt = Date.now();
      item.size = new Blob([text]).size;
      item.excerpt = text.replace(/\s+/g, " ").trim().slice(0, 160);
      try {
        await writeDocText(item, text);
        await saveIndexToStorage();
        state.bodyCache.set(item.id, text);
        state.dirty = false;
        updateSaveBtn();
        renderSidebar();
        if (silent) {
          setSaveStatus(`已自动保存 ${new Date().toLocaleTimeString()}`);
        } else {
          setSaveStatus("已保存");
          toast("已保存");
        }
      } catch (err) {
        setErr(`保存失败：${err.message || err}`);
      }
    }

    // ---- 自动保存（停止输入后 ~1.8s） ----
    const AUTO_SAVE_MS = 1800;
    function scheduleAutoSave() {
      window.clearTimeout(state.autoSaveTimer);
      state.autoSaveTimer = window.setTimeout(() => {
        if (state.dirty && findItem(state.currentId)) void saveCurrent({ silent: true });
      }, AUTO_SAVE_MS);
    }

    async function deleteItemById(item) {
      if (!item) return;
      if (!window.confirm(`删除「${item.title}」？此操作会删除对应 .md 文件。`)) return;
      try {
        await removeDocFile(item);
      } catch (_) {}
      state.index.items = state.index.items.filter((x) => x.id !== item.id);
      state.bodyCache.delete(item.id);
      state.searchMatches = null;
      if (state.currentId === item.id) {
        state.currentId = "";
        state.dirty = false;
        setEditorText("");
        if (els.title) els.title.value = "";
        renderPreview();
        renderOutline();
        els.empty && (els.empty.hidden = false);
      }
      renderSidebar();
      updateSaveBtn();
      await saveIndexToStorage();
      toast("已删除");
    }

    async function deleteCurrent() {
      await deleteItemById(findItem(state.currentId));
    }

    async function renameItem(item, newTitle) {
      if (!item) return;
      const title = String(newTitle || "").trim() || "未命名";
      if (title === item.title) {
        renderSidebar();
        return;
      }
      const oldName = item.fileName;
      item.title = title;
      item.fileName = uniqueFileName(title, item.id);
      item.titleSaved = title;
      item.updatedAt = Date.now();
      try {
        if (oldName && oldName !== item.fileName) {
          const text = await readDocText({ ...item, fileName: oldName }).catch(() => "");
          await writeDocText(item, text);
          await removeDocFile({ ...item, fileName: oldName });
        }
      } catch (_) {}
      await saveIndexToStorage();
      renderSidebar();
      if (state.currentId === item.id && els.title) els.title.value = title;
      toast("已重命名");
    }

    function startInlineRename(id) {
      const btn = els.list?.querySelector(`[data-id="${id}"]`);
      const span = btn?.querySelector(".mdm-item-title");
      const item = findItem(id);
      if (!span || !item) return;
      const input = document.createElement("input");
      input.className = "mdm-rename-input mono";
      input.value = item.title || "";
      span.replaceWith(input);
      input.focus();
      input.select();
      let done = false;
      const commit = async (save) => {
        if (done) return;
        done = true;
        if (save) await renameItem(item, input.value);
        else renderSidebar();
      };
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          void commit(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          void commit(false);
        }
      });
      input.addEventListener("blur", () => void commit(true));
      input.addEventListener("click", (e) => e.stopPropagation());
    }

    let listCtxEl = null;
    function closeListCtx() {
      if (listCtxEl) {
        listCtxEl.remove();
        listCtxEl = null;
      }
    }
    function showListCtx(x, y, item) {
      closeListCtx();
      const el = document.createElement("div");
      el.className = "mdm-ctxmenu";
      const fmts = [...LOCAL_FORMATS, ...PANDOC_FORMATS];
      el.innerHTML =
        `<button type="button" data-ctx="open">打开</button>` +
        `<button type="button" data-ctx="rename">重命名</button>` +
        `<div class="mdm-ctx-sub"><button type="button" data-ctx="export-toggle">导出 ▸</button>` +
        `<div class="mdm-ctx-submenu" hidden>${fmts
          .map(([v, l]) => `<button type="button" data-ctx-export="${v}">${escapeHtml(l)}</button>`)
          .join("")}</div></div>` +
        `<button type="button" data-ctx="delete" class="is-danger">删除</button>`;
      document.body.appendChild(el);
      const rect = el.getBoundingClientRect();
      el.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 8))}px`;
      el.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 8))}px`;
      listCtxEl = el;
      el.addEventListener("click", async (e) => {
        const exp = e.target.closest?.("[data-ctx-export]");
        if (exp) {
          closeListCtx();
          const text = await readDocText(item).catch(() => "");
          await exportCurrent(exp.dataset.ctxExport, { item, text });
          return;
        }
        const b = e.target.closest?.("[data-ctx]");
        if (!b) return;
        const act = b.dataset.ctx;
        if (act === "export-toggle") {
          const sub = el.querySelector(".mdm-ctx-submenu");
          if (sub) sub.hidden = !sub.hidden;
          return;
        }
        closeListCtx();
        if (act === "open") void openDoc(item.id);
        else if (act === "rename") startInlineRename(item.id);
        else if (act === "delete") void deleteItemById(item);
      });
    }

    function updateSaveBtn() {
      const has = Boolean(findItem(state.currentId));
      if (els.save) {
        els.save.disabled = !has || !state.dirty;
        els.save.textContent = state.dirty ? "保存 *" : "保存";
      }
      if (els.exportBtn) els.exportBtn.disabled = !has;
      if (els.exportFmt) els.exportFmt.disabled = !has;
      if (els.del) els.del.disabled = !has;
      if (els.insertImg) els.insertImg.disabled = !has;
    }

    // ---- 分类 / 标签 ----
    function renderMeta() {
      const item = findItem(state.currentId);
      if (els.catList) {
        els.catList.innerHTML = (state.index.cats || [])
          .map((c) => `<option value="${escapeHtml(c.name)}"></option>`)
          .join("");
      }
      const cat = item ? (state.index.cats || []).find((c) => c.id === item.catId) : null;
      if (els.cat) els.cat.value = cat ? cat.name : "";
      if (els.tagChips) {
        const tags = item
          ? (item.tagIds || []).map((tid) => (state.index.tags || []).find((t) => t.id === tid)).filter(Boolean)
          : [];
        els.tagChips.innerHTML = tags.length
          ? tags
              .map(
                (t) =>
                  `<span class="mdm-tag">#${escapeHtml(t.name)}<button type="button" class="mdm-tag-x" data-tag-rm="${escapeHtml(t.id)}" aria-label="移除标签">×</button></span>`
              )
              .join("")
          : `<span class="hint tight">暂无</span>`;
      }
    }

    function persistIndexSoon() {
      saveIndexToStorage().catch(() => {});
    }

    function setCategory(name) {
      const item = findItem(state.currentId);
      if (!item) return;
      const n = String(name || "").trim();
      item.catId = n ? ensureCat(n) : "";
      persistIndexSoon();
      renderSidebar();
      renderMeta();
    }

    function addTag(name) {
      const item = findItem(state.currentId);
      if (!item) return;
      const n = String(name || "").trim().replace(/^#/, "");
      if (!n) return;
      const id = ensureTag(n);
      if (!id) return;
      item.tagIds = item.tagIds || [];
      if (!item.tagIds.includes(id)) item.tagIds.push(id);
      persistIndexSoon();
      renderSidebar();
      renderMeta();
    }

    function removeTag(id) {
      const item = findItem(state.currentId);
      if (!item) return;
      item.tagIds = (item.tagIds || []).filter((x) => x !== id);
      persistIndexSoon();
      renderSidebar();
      renderMeta();
    }

    // ---- import ----
    async function importFiles(files) {
      const all = [...(files || [])];
      const list = all.filter((f) => /\.(md|markdown|txt)$/i.test(f.name) || /markdown/.test(f.type || ""));
      if (!list.length) {
        toast("没有可导入的 Markdown 文件");
        return;
      }
      // 相对路径 → File（用于把 .md 引用的图片一起导入）
      const assetMap = new Map();
      for (const f of all) {
        const rel = String(f.webkitRelativePath || f.__relPath || f.name || "").replace(/\\/g, "/");
        if (!rel) continue;
        if (!assetMap.has(rel)) assetMap.set(rel, f);
        const base = rel.split("/").pop();
        if (base && !assetMap.has(base)) assetMap.set(base, f);
      }
      let n = 0;
      let imgN = 0;
      for (const f of list) {
        const text = await f.text();
        const fm = parseFrontMatter(text);
        const title = fm.title || f.name.replace(/\.[^.]+$/, "");
        const baseDir = String(f.webkitRelativePath || f.__relPath || f.name || "")
          .replace(/\\/g, "/")
          .split("/")
          .slice(0, -1)
          .join("/");
        const res = await importDocImages(fm.body, baseDir, assetMap);
        imgN += res.imported;
        const item = {
          id: uid(),
          title,
          titleSaved: title,
          fileName: uniqueFileName(title, ""),
          catId: ensureCat(fm.category),
          tagIds: (fm.tags || []).map((t) => ensureTag(t)).filter(Boolean),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          size: new Blob([res.text]).size,
          excerpt: res.text.replace(/\s+/g, " ").trim().slice(0, 160),
        };
        try {
          await writeDocText(item, res.text);
          state.index.items.unshift(item);
          n += 1;
        } catch (err) {
          setErr(`导入失败（${f.name}）：${err.message || err}`);
        }
      }
      await saveIndexToStorage();
      renderSidebar();
      if (n) toast(imgN ? `已导入 ${n} 篇 · 含 ${imgN} 张图片` : `已导入 ${n} 篇`);
    }

    /** 把 .md 引用的本地资源（图/视频/音频/附件）一并写入目标文件夹（保留相对路径） */
    async function importDocImages(body, baseDir, assetMap) {
      if (!state.mode || !assetMap.size) return { text: body, imported: 0 };
      let imported = 0;
      const tasks = [];
      const text = String(body || "");
      const refs = new Set();
      for (const re of [/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, /(?:src|href)\s*=\s*["']([^"']+)["']/gi]) {
        let m;
        while ((m = re.exec(text))) if (isRelativeRef(m[1])) refs.add(m[1]);
      }
      for (const ref of refs) {
        const clean = String(ref).replace(/^\.\//, "").replace(/^\/+/, "");
        const cands = [];
        if (baseDir) cands.push(`${baseDir}/${clean}`);
        cands.push(clean, clean.split("/").pop());
        let file = null;
        for (const c of cands) {
          if (assetMap.has(c)) {
            file = assetMap.get(c);
            break;
          }
        }
        if (!file) continue;
        tasks.push(writeAssetFile(clean, file));
        imported += 1;
      }
      await Promise.all(tasks);
      return { text, imported };
    }

    async function writeAssetFile(rel, file) {
      const parts = String(rel || "").split("/").filter((p) => p && p !== ".");
      if (!parts.length) return false;
      const clean = parts.join("/");
      if (state.mode === "dir" && state.dirHandle) {
        let dir = state.dirHandle;
        for (let i = 0; i < parts.length - 1; i++) dir = await dir.getDirectoryHandle(parts[i], { create: true });
        const fh = await dir.getFileHandle(parts[parts.length - 1], { create: true });
        const w = await fh.createWritable();
        await w.write(file);
        await w.close();
        return true;
      }
      await idbSet("assets", clean, file);
      return true;
    }

    function parseFrontMatter(text) {
      const m = String(text || "").match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
      if (!m) return { title: "", category: "", tags: [], body: text };
      const head = m[1];
      const body = m[2];
      let title = "";
      let category = "";
      let tags = [];
      head.split(/\r?\n/).forEach((line) => {
        const mm = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
        if (!mm) return;
        const key = mm[1].toLowerCase();
        let val = mm[2].trim().replace(/^["']|["']$/g, "");
        if (key === "title") title = val;
        else if (key === "category" || key === "cat") category = val;
        else if (key === "tags") {
          tags = val
            .replace(/^\[|\]$/g, "")
            .split(/[,，]/)
            .map((x) => x.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean);
        }
      });
      return { title, category, tags, body };
    }

    // ---- export ----
    function downloadBlob(blob, name) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    function standaloneHtml(title, bodyHtml) {
      return `<!doctype html><html lang="zh"><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title>
<style>
body{max-width:820px;margin:2rem auto;padding:0 1rem;line-height:1.7;font-family:-apple-system,Segoe UI,Roboto,"PingFang SC","Microsoft YaHei",sans-serif;color:#1f2328}
pre{background:#f6f8fa;padding:.8rem;border-radius:8px;overflow:auto}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
pre code{background:none}
table{border-collapse:collapse}th,td{border:1px solid #d0d7de;padding:.35rem .6rem}
img{max-width:100%}blockquote{border-left:3px solid #d0d7de;margin:0;padding-left:1rem;color:#57606a}
</style></head><body>${bodyHtml}</body></html>`;
    }

    async function exportCurrent(fmt, target) {
      const item = target?.item || findItem(state.currentId);
      if (!item) return;
      const text = target && target.text != null ? target.text : getEditorText();
      const title = item.title || "document";
      const html = await inlineAssetsForExport(renderMarkdown(text));
      try {
        if (fmt === "md") {
          const fm = `---\ntitle: ${title}\ncategory: ${state.index.cats.find((c) => c.id === item.catId)?.name || ""}\ntags: [${(item.tagIds || []).map((t) => state.index.tags.find((x) => x.id === t)?.name).filter(Boolean).join(", ")}]\n---\n\n`;
          const mdText = fm + text;
          const images = await collectReferencedAssetsWithData(text).catch(() => []);
          if (images.length && window.JSZip) {
            const zip = new window.JSZip();
            zip.file(`${slugify(title)}.md`, mdText);
            for (const im of images) {
              const rel = String(im.path || "").replace(/^\.\//, "").replace(/^\/+/, "");
              if (rel) zip.file(rel, im.dataBase64, { base64: true });
            }
            const blob = await zip.generateAsync({ type: "blob" });
            downloadBlob(blob, `${slugify(title)}.zip`);
            toast(`已打包导出（含 ${images.length} 张图片）`);
            return;
          }
          downloadBlob(new Blob([mdText], { type: "text/markdown;charset=utf-8" }), `${slugify(title)}.md`);
          return;
        }
        if (fmt === "html-standalone") {
          downloadBlob(new Blob([standaloneHtml(title, html)], { type: "text/html;charset=utf-8" }), `${slugify(title)}.html`);
          return;
        }
        if (fmt === "pdf") {
          const w = window.open("", "_blank");
          if (!w) throw new Error("弹窗被拦截，无法打印");
          w.document.write(standaloneHtml(title, html));
          w.document.close();
          w.focus();
          setTimeout(() => w.print(), 300);
          return;
        }
        if (fmt === "png") {
          if (typeof window.html2canvas !== "function") throw new Error("截图库未就绪");
          const canvas = await window.html2canvas(els.preview, { backgroundColor: "#ffffff", scale: 2 });
          canvas.toBlob((b) => b && downloadBlob(b, `${slugify(title)}.png`), "image/png");
          return;
        }
        await exportViaPandoc(text, fmt, title);
      } catch (err) {
        setErr(`导出失败：${err.message || err}`);
      }
    }

    async function collectReferencedAssetsWithData(text) {
      if (!state.mode) return [];
      const refs = new Set();
      const s = String(text || "");
      for (const re of [/!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, /(?:src|href)\s*=\s*["']([^"']+)["']/gi]) {
        let m;
        while ((m = re.exec(s))) if (isRelativeRef(m[1])) refs.add(m[1].replace(/^\.\//, "").replace(/^\/+/, ""));
      }
      const out = [];
      for (const rel of refs) {
        try {
          const blob = await readAssetBlob(rel);
          if (blob.size > 64 * 1024 * 1024) continue;
          const dataUrl = await blobToDataUrl(blob);
          out.push({ path: rel, dataBase64: dataUrl.split(",")[1] || "" });
        } catch (_) {}
      }
      return out;
    }

    async function exportViaPandoc(text, to, title, retried = false) {
      const images = await collectReferencedAssetsWithData(text).catch(() => []);
      const res = await fetch(`${baseUrl()}/pandoc/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Adb-Token": token(), "X-Ffmpeg-Token": token() },
        body: JSON.stringify({ text, to, title, images }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) {
        const msg = data?.error || `本机桥未响应（HTTP ${res.status}）· 请确认桥已启动且装了 pandoc`;
        if (!retried && /pandoc/i.test(msg) && /未找到|not found|ENOENT|未安装/i.test(msg)) {
          if (window.confirm("导出该格式需要 pandoc，当前未安装。\n现在用本机桥自动安装？（Windows/macOS 支持，约 100–150MB）")) {
            await runPandocInstall();
            return await exportViaPandoc(text, to, title, true);
          }
        }
        throw new Error(msg);
      }
      const bytes = Uint8Array.from(atob(data.dataBase64 || ""), (c) => c.charCodeAt(0));
      downloadBlob(new Blob([bytes]), data.filename || `${slugify(title)}.${to}`);
    }

    async function runPandocInstall() {
      toast("正在安装 pandoc，请稍候（可能 1–3 分钟）…");
      const res = await fetch(`${baseUrl()}/pandoc/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Adb-Token": token(), "X-Ffmpeg-Token": token() },
        body: "{}",
      });
      const data = await res.json().catch(() => null);
      if (!data?.ok) throw new Error(data?.error || "安装请求失败");
      if (data.installed) {
        toast("pandoc 已安装，正在重试导出…");
        return;
      }
      if (data.needsManual) throw new Error(`请手动安装：${data.command || "pandoc"}`);
      throw new Error(data.message || data.output || "安装未完成，请手动安装 pandoc");
    }

    // ---- dir picking ----
    async function pickDir() {
      if (!window.showDirectoryPicker) {
        setErr("当前浏览器不支持选择文件夹（请用 Chrome / Edge）。已切换到浏览器本地存储模式。");
        await useIdbMode();
        return;
      }
      try {
        const handle = await window.showDirectoryPicker({ mode: "readwrite" });
        const perm = await handle.requestPermission?.({ mode: "readwrite" });
        if (perm && perm !== "granted") throw new Error("未获得文件夹读写权限");
        state.dirHandle = handle;
        state.mode = "dir";
        await idbSet("kv", DIR_KEY, handle);
        await initAfterStorage(handle.name);
      } catch (err) {
        if (String(err?.name) !== "AbortError") setErr(err.message || String(err));
      }
    }

    async function useIdbMode() {
      state.mode = "idb";
      state.dirHandle = null;
      await initAfterStorage("浏览器本地存储");
    }

    async function initAfterStorage(label) {
      setErr("");
      state.index = await loadIndexFromStorage();
      if (!state.index || typeof state.index !== "object") state.index = emptyIndex();
      state.index.cats = state.index.cats || [];
      state.index.tags = state.index.tags || [];
      state.index.items = (state.index.items || []).map((it, i) => ({
        ...it,
        titleSaved: it.titleSaved == null ? it.title : it.titleSaved,
        order: Number.isFinite(it.order) ? it.order : i,
      }));
      cacheIndex();
      els.layout && (els.layout.hidden = false);
      els.dirLabel && (els.dirLabel.textContent = `存储：${label}`);
      [els.newBtn, els.importDirBtn].forEach((b) => b && (b.disabled = false));
      els.importBtn && (els.importBtn.disabled = false);
      renderSidebar();
      updateSaveBtn();
      els.empty && (els.empty.hidden = Boolean(state.currentId));
      ensureEditor();
      ensureKatexCss();
      bindEditorMedia();
      if (state.view && CMresize) CMresize();
      toast(`已连接：${label}`);
    }

    function CMresize() {
      try { state.view?.requestMeasure?.(); } catch (_) {}
    }

    // ---- events ----
    els.pickDir?.addEventListener("click", () => void pickDir());
    els.newBtn?.addEventListener("click", newDoc);
    els.save?.addEventListener("click", () => void saveCurrent());
    els.del?.addEventListener("click", () => void deleteCurrent());
    els.importBtn?.addEventListener("change", (e) => {
      void importFiles(e.target.files);
      e.target.value = "";
    });
    els.importDirBtn?.addEventListener("click", () => els.importDirInput?.click());
    els.importDirInput?.addEventListener("change", (e) => {
      void importFiles(e.target.files);
      e.target.value = "";
    });
    els.search?.addEventListener("input", () => {
      state.search = els.search.value;
      state.searchMatches = null;
      renderSidebar();
      scheduleFullTextSearch();
    });
    els.cats?.addEventListener("click", (e) => {
      const b = e.target.closest?.("[data-cat]");
      if (!b) return;
      state.activeCat = b.dataset.cat;
      renderSidebar();
    });
    els.tags?.addEventListener("click", (e) => {
      const b = e.target.closest?.("[data-tag]");
      if (!b) return;
      state.activeTag = state.activeTag === b.dataset.tag ? "" : b.dataset.tag;
      renderSidebar();
    });
    els.list?.addEventListener("click", (e) => {
      const b = e.target.closest?.("[data-id]");
      if (b) void openDoc(b.dataset.id);
    });
    els.list?.addEventListener("dblclick", (e) => {
      const b = e.target.closest?.("[data-id]");
      if (b) startInlineRename(b.dataset.id);
    });
    els.list?.addEventListener("contextmenu", (e) => {
      const b = e.target.closest?.("[data-id]");
      if (!b) return;
      e.preventDefault();
      const item = findItem(b.dataset.id);
      if (item) showListCtx(e.clientX, e.clientY, item);
    });
    document.addEventListener("click", closeListCtx);
    window.addEventListener("scroll", closeListCtx, true);
    const outlineGo = (e) => {
      const item = e.target.closest?.("[data-h]");
      if (!item) return;
      const idx = Number(item.dataset.h);
      const heads = [...(els.preview?.querySelectorAll("h1,h2,h3,h4,h5,h6") || [])];
      const h = heads[idx];
      if (h) h.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    els.outline?.addEventListener("click", outlineGo);
    els.outline?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") outlineGo(e);
    });
    els.title?.addEventListener("input", () => {
      const item = findItem(state.currentId);
      if (item) {
        item.title = String(els.title.value || "").trim() || "未命名";
        // 只更新该条目标题，避免每次按键全量重建侧栏
        const titleEl = els.list?.querySelector(`[data-id="${item.id}"] .mdm-item-title`);
        if (titleEl) titleEl.textContent = item.title;
        else renderSidebar();
      }
      state.dirty = true;
      updateSaveBtn();
      scheduleAutoSave();
    });
    els.cat?.addEventListener("change", () => setCategory(els.cat.value));
    els.cat?.addEventListener("blur", () => setCategory(els.cat.value));
    els.tagInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === "," || e.key === "，") {
        e.preventDefault();
        addTag(els.tagInput.value);
        els.tagInput.value = "";
      }
    });
    els.tagChips?.addEventListener("click", (e) => {
      const b = e.target.closest?.("[data-tag-rm]");
      if (b) removeTag(b.dataset.tagRm);
    });
    els.insertImg?.addEventListener("click", () => els.imgInput?.click());
    els.fileInput?.addEventListener("change", (e) => {
      const files = [...(e.target.files || [])];
      e.target.value = "";
      void insertAssetFiles(files);
    });
    els.insertToggle?.addEventListener("click", (e) => {
      e.stopPropagation();
      if (els.insertDropdown) els.insertDropdown.hidden = !els.insertDropdown.hidden;
    });
    document.addEventListener("click", () => {
      if (els.insertDropdown) els.insertDropdown.hidden = true;
    });
    els.insertDropdown?.addEventListener("click", (e) => {
      const b = e.target.closest?.("[data-insert]");
      if (!b) return;
      els.insertDropdown.hidden = true;
      const kind = b.dataset.insert;
      if (kind === "file") {
        els.fileInput?.click();
        return;
      }
      if (kind === "clean-assets") {
        void cleanOrphanAssets();
        return;
      }
      insertTemplate(kind);
    });
    els.modeEdit?.addEventListener("click", () => { state.viewMode = "edit"; applyViewMode(); });
    els.modeSplit?.addEventListener("click", () => { state.viewMode = "split"; applyViewMode(); });
    els.modePreview?.addEventListener("click", () => { state.viewMode = "preview"; applyViewMode(); });
    els.exportBtn?.addEventListener("click", () => void exportCurrent(els.exportFmt?.value || "md"));

    // export format options
    if (els.exportFmt) {
      const mk = (list) => list.map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join("");
      els.exportFmt.innerHTML =
        `<optgroup label="本地">${mk(LOCAL_FORMATS)}</optgroup>` +
        `<optgroup label="本机桥 · Pandoc（任意格式）">${mk(PANDOC_FORMATS)}</optgroup>`;
      els.exportFmt.value = "md";
    }

    // ---- 拖拽导入：拖 md 文件（或整个文件夹）进来 = 导入 ----
    const panelEl = $("#mdm");
    function collectDroppedFiles(dt) {
      const files = [];
      const entries = [];
      const items = dt?.items;
      if (items && items.length) {
        for (const it of items) {
          if (it.kind !== "file") continue;
          const entry = it.webkitGetAsEntry?.();
          if (entry) entries.push(entry);
          else {
            const f = it.getAsFile?.();
            if (f) files.push(f);
          }
        }
      }
      if (!entries.length) return Promise.resolve(files);
      const out = [];
      const walk = (entry, prefix) =>
        new Promise((resolve) => {
          if (entry.isFile) {
            entry.file(
              (f) => {
                try { f.__relPath = `${prefix}${f.name}`; } catch (_) {}
                out.push(f);
                resolve();
              },
              () => resolve()
            );
          } else if (entry.isDirectory) {
            const reader = entry.createReader();
            const readAll = () =>
              reader.readEntries(async (batch) => {
                if (!batch.length) { resolve(); return; }
                for (const e of batch) await walk(e, `${prefix}${entry.name}/`);
                readAll();
              }, () => resolve());
            readAll();
          } else resolve();
        });
      return Promise.all(entries.map((e) => walk(e, ""))).then(() => out);
    }
    if (panelEl) {
      const setHover = (on) => panelEl.classList.toggle("is-mdm-drop", on);
      panelEl.addEventListener("dragover", (e) => {
        const types = e.dataTransfer?.types ? [...e.dataTransfer.types] : [];
        if (!types.includes("Files")) return;
        e.preventDefault();
        setHover(true);
      });
      panelEl.addEventListener("dragleave", (e) => {
        if (e.target === panelEl) setHover(false);
      });
      panelEl.addEventListener("drop", (e) => {
        if (!e.dataTransfer) return;
        e.preventDefault();
        setHover(false);
        if (!state.index) {
          setErr("请先点「选择文件夹」再拖入文档");
          return;
        }
        void (async () => {
          try {
            const files = await collectDroppedFiles(e.dataTransfer);
            const hasMd = files.some((f) => /\.(md|markdown|txt)$/i.test(f.name) || /markdown/.test(f.type || ""));
            if (hasMd) await importFiles(files);
            else await insertAssetFiles(files);
          } catch (err) {
            setErr(`拖入失败：${err.message || err}`);
          }
        })();
      });
    }

    // restore dir handle
    (async () => {
      try {
        const handle = await idbGet("kv", DIR_KEY);
        if (handle) {
          state.dirHandle = handle;
          state.mode = "dir";
          const perm = await handle.queryPermission?.({ mode: "readwrite" });
          if (perm === "granted") {
            await initAfterStorage(handle.name);
            return;
          }
          els.dirLabel && (els.dirLabel.textContent = `存储：${handle.name}（需重新授权）`);
          els.pickDir && (els.pickDir.textContent = "重新连接文件夹");
        }
      } catch (_) {}
      // 未绑定目录：显示上次缓存索引（若有），等用户选择
      const cached = readIndexRaw();
      if (cached) {
        state.index = cached;
        state.index.items = state.index.items || [];
        state.index.cats = state.index.cats || [];
        state.index.tags = state.index.tags || [];
        els.layout && (els.layout.hidden = false);
        els.dirLabel && (els.dirLabel.textContent = "存储：未连接（点「选择文件夹」）");
        renderSidebar();
      }
    })();

    applyViewMode();
  });
})();
