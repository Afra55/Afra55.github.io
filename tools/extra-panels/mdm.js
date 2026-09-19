(() => {
  "use strict";

  const K = window.DevToolsExtraKit;
  if (!K) return;
  const { $, $$, setError, toast, bindPanel, escapeHtml } = K;
  const MP = window.DevToolsMdmPure || {};

  const IDB_NAME = "devtools-mdm";
  const IDB_VER = 3;
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

  const slugify = (name, fallback = "doc") =>
    MP.slugify
      ? MP.slugify(name, fallback)
      : String(name || "")
          .trim()
          .replace(/[\\/:*?"<>|]+/g, " ")
          .replace(/\s+/g, "-")
          .replace(/^[.\-]+|[.\-]+$/g, "")
          .slice(0, 60) || fallback;

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, IDB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
        if (!db.objectStoreNames.contains("docs")) db.createObjectStore("docs");
        if (!db.objectStoreNames.contains("assets")) db.createObjectStore("assets");
        if (!db.objectStoreNames.contains("trash")) db.createObjectStore("trash");
        if (!db.objectStoreNames.contains("history")) db.createObjectStore("history");
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
      tx.onerror = () => reject(quotaErr(tx.error));
      tx.onabort = () => reject(quotaErr(tx.error));
    });
  }

  function quotaErr(err) {
    if (err && (err.name === "QuotaExceededError" || err.code === 22)) {
      return new Error("浏览器存储空间不足（配额超限）：请清理或改用「文件夹」模式");
    }
    return err || new Error("存储写入失败");
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
    sort: "order",
    activeCat: "all",
    activeTag: "",
    viewMode: "edit",
    previewTimer: 0,
    autoSaveTimer: 0,
    ftTimer: 0,
    searchMatches: null,
    bodyCache: new Map(),
    persistedIdx: new Map(),
    mermaidCache: new Map(),
    warmCap: (() => {
      try {
        const n = Number(localStorage.getItem("devtools-mdm-warmcap"));
        return Number.isFinite(n) && n >= 0 ? n : 3000;
      } catch (_) {
        return 3000;
      }
    })(),
    syncing: false,
    selected: new Set(),
    dragFromHandle: false,
    conflictItem: null,
    lastDeleted: null,
    keys: { bold: "Mod-b", italic: "Mod-i", link: "Mod-k" },
    trashMode: false,
    trashEntries: [],
    historyMode: false,
    historyEntries: [],
    historyItem: null,
    lastSnap: new Map(),
    lastSnapText: new Map(),
    splitRatio: 0.5,
  };
  try {
    const r = Number(localStorage.getItem("devtools-mdm-split"));
    if (r >= 0.15 && r <= 0.85) state.splitRatio = r;
  } catch (_) {}
  try {
    const k = JSON.parse(localStorage.getItem("devtools-mdm-keys") || "null");
    if (k && typeof k === "object") state.keys = { ...state.keys, ...k };
  } catch (_) {}
  try {
    const s = localStorage.getItem("devtools-mdm-sort");
    if (s) state.sort = s;
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
      useIdb: $("#mdm-use-idb"),
      newBtn: $("#mdm-new"),
      importBtn: $("#mdm-import"),
      importDirBtn: $("#mdm-import-dir"),
      importDirInput: $("#mdm-import-dir-input"),
      exportLib: $("#mdm-export-lib"),
      importLib: $("#mdm-import-lib"),
      importLibInput: $("#mdm-import-lib-input"),
      save: $("#mdm-save"),
      exportFmt: $("#mdm-export-fmt"),
      exportBtn: $("#mdm-export"),
      dirLabel: $("#mdm-dir-label"),
      error: $("#mdm-error"),
      conflict: $("#mdm-conflict"),
      layout: $("#mdm-layout"),
      search: $("#mdm-search"),
      sort: $("#mdm-sort"),
      batchbar: $("#mdm-batchbar"),
      batchCount: $("#mdm-batch-count"),
      cats: $("#mdm-cats"),
      tags: $("#mdm-tags"),
      list: $("#mdm-list"),
      listWrap: $("#mdm-list-wrap"),
      modeEdit: $("#mdm-mode-edit"),
      modeSplit: $("#mdm-mode-split"),
      modePreview: $("#mdm-mode-preview"),
      title: $("#mdm-title"),
      del: $("#mdm-delete"),
      fileInput: $("#mdm-file-input"),
      insertToggle: $("#mdm-insert-toggle"),
      insertDropdown: $("#mdm-insert-dropdown"),
      imgCompress: $("#mdm-img-compress"),
      saveStatus: $("#mdm-save-status"),
      docStats: $("#mdm-doc-stats"),
      cat: $("#mdm-cat"),
      catList: $("#mdm-cat-list"),
      tagChips: $("#mdm-tag-chips"),
      tagInput: $("#mdm-tag-input"),
      tagList: $("#mdm-tag-list"),
      editorWrap: $("#mdm-editor-wrap"),
      editor: $("#mdm-editor"),
      splitter: $("#mdm-splitter"),
      preview: $("#mdm-preview"),
      empty: $("#mdm-empty"),
      outline: $("#mdm-outline-body"),
      backlinks: $("#mdm-backlinks"),
      modal: $("#mdm-modal"),
      modalBox: $("#mdm-modal-box"),
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
        item.fileMtime = file.lastModified || 0;
        return file.text();
      }
      const rec = await idbGet("docs", item.id);
      item.fileMtime = rec?.updatedAt || 0;
      return rec?.text || "";
    }

    async function writeDocText(item, text) {
      if (state.mode === "dir" && state.dirHandle) {
        const fh = await state.dirHandle.getFileHandle(item.fileName, { create: true });
        const w = await fh.createWritable();
        await w.write(text);
        await w.close();
        try {
          const f = await (await state.dirHandle.getFileHandle(item.fileName)).getFile();
          item.fileMtime = f.lastModified || Date.now();
        } catch (_) {
          item.fileMtime = Date.now();
        }
      } else {
        await idbSet("docs", item.id, { text, updatedAt: Date.now() });
        item.fileMtime = Date.now();
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

    async function manageTag(id) {
      const tag = state.index.tags.find((t) => t.id === id);
      if (!tag) return;
      const name = window.prompt(`标签「${tag.name}」：改名字（留空取消，输入 - 删除）`, tag.name);
      if (name === null) return;
      const v = name.trim();
      if (!v || v === tag.name) return;
      if (v === "-") {
        if (!window.confirm(`删除标签「${tag.name}」？`)) return;
        state.index.tags = state.index.tags.filter((t) => t.id !== id);
        for (const it of state.index.items) it.tagIds = (it.tagIds || []).filter((x) => x !== id);
        if (state.activeTag === id) state.activeTag = "";
      } else {
        tag.name = v;
      }
      await saveIndexToStorage();
      const n = await refreshFrontMatter(state.index.items.filter((it) => (it.tagIds || []).includes(id)));
      renderSidebar();
      renderMeta();
      if (n) toast(`已同步 ${n} 篇文档的标签`);
    }

    async function manageCat(id) {
      const cat = state.index.cats.find((c) => c.id === id);
      if (!cat) return;
      const name = window.prompt(`分类「${cat.name}」：改名字（留空取消，输入 - 删除）`, cat.name);
      if (name === null) return;
      const v = name.trim();
      if (!v || v === cat.name) return;
      const affected = state.index.items.filter((it) => it.catId === id);
      if (v === "-") {
        if (!window.confirm(`删除分类「${cat.name}」？其文档会变为未分类`)) return;
        state.index.cats = state.index.cats.filter((c) => c.id !== id);
        for (const it of state.index.items) if (it.catId === id) it.catId = "";
        if (state.activeCat === id) state.activeCat = "all";
      } else {
        cat.name = v;
      }
      await saveIndexToStorage();
      const n = await refreshFrontMatter(affected);
      renderSidebar();
      renderMeta();
      if (n) toast(`已同步 ${n} 篇文档的分类`);
    }

    /** 解析搜索串：支持 tag:xxx / cat:xxx（也接受 标签:/分类:），其余为正文关键词 */
    function parseSearch(raw) {
      if (MP.parseSearch) return MP.parseSearch(raw);
      const s = String(raw || "").trim();
      return { q: s.toLowerCase(), tags: [], cats: [] };
    }

    // ---- rendering: sidebar ----
    function filteredItems() {
      const { q, tags, cats } = parseSearch(state.search);
      const ft = state.searchMatches;
      return (state.index.items || [])
        .filter((it) => {
          if (state.activeCat !== "all" && it.catId !== state.activeCat) return false;
          if (state.activeTag && !(it.tagIds || []).includes(state.activeTag)) return false;
          if (cats.length) {
            const name = (state.index.cats.find((c) => c.id === it.catId)?.name || "").toLowerCase();
            if (!cats.some((c) => name.includes(c))) return false;
          }
          if (tags.length) {
            const names = (it.tagIds || []).map((t) =>
              String(state.index.tags.find((x) => x.id === t)?.name || "").toLowerCase()
            );
            if (!tags.every((t) => names.some((n) => n.includes(t)))) return false;
          }
          if (q) {
            const hay = `${it.title} ${it.excerpt || ""}`.toLowerCase();
            if (!hay.includes(q) && !(ft && ft.has(it.id))) return false;
          }
          return true;
        })
        .sort((a, b) => {
          if (state.sort === "title") return String(a.title || "").localeCompare(String(b.title || ""), "zh");
          if (state.sort === "updated") return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
          if (state.sort === "size") return (Number(b.size) || 0) - (Number(a.size) || 0);
          return (Number(a.order) || 0) - (Number(b.order) || 0);
        });
    }

    function reorderItem(fromId, toId) {
      const items = state.index.items;
      const fromIdx = items.findIndex((x) => x.id === fromId);
      if (fromIdx < 0) return;
      const [moved] = items.splice(fromIdx, 1);
      const toIdx = items.findIndex((x) => x.id === toId);
      items.splice(toIdx < 0 ? items.length : toIdx, 0, moved);
      items.forEach((it, i) => { it.order = i; });
    }

    function normalizeOrders() {
      (state.index.items || []).forEach((it, i) => { it.order = i; });
    }

    // ---- 全文搜索（按需读取正文，带缓存） ----
    /** 后台预热正文缓存：连接后静默读取，首次全文搜索即快（大库限量） */
    function warmBodyCache() {
      const items = state.index.items || [];
      if (!state.warmCap || items.length < 40 || items.length > state.warmCap) return;
      let i = 0;
      const worker = async () => {
        while (i < items.length) {
          const it = items[i++];
          if (state.bodyCache.has(it.id)) continue;
          try {
            state.bodyCache.set(it.id, await readDocText(it));
          } catch (_) {}
          if (state.bodyCache.size > 600) {
            const keys = [...state.bodyCache.keys()];
            for (let k = 0; k < keys.length - 400; k++) state.bodyCache.delete(keys[k]);
          }
          await new Promise((r) => setTimeout(r, 0));
        }
      };
      Promise.all(Array.from({ length: 2 }, worker))
        .then(() => {
          renderBacklinks();
          return persistSearchIdx();
        })
        .catch(() => {});
    }

    // ---- #16 跨会话持久化搜索索引（IDB kv，限量 2MB） ----
    const SEARCH_IDX_KEY = "searchIdx";
    async function persistSearchIdx() {
      try {
        const obj = {};
        let bytes = 0;
        const merged = new Map([...state.persistedIdx, ...state.bodyCache]);
        for (const [id, text] of merged) {
          const t = String(text || "");
          if (!t) continue;
          bytes += t.length;
          if (bytes > 2 * 1024 * 1024) break;
          obj[id] = t;
        }
        await idbSet("kv", SEARCH_IDX_KEY, { v: 1, ts: Date.now(), map: obj });
      } catch (_) {}
    }
    async function loadSearchIdx() {
      try {
        const rec = await idbGet("kv", SEARCH_IDX_KEY);
        if (!rec || rec.v !== 1 || !rec.map) return;
        const ids = new Set((state.index.items || []).map((x) => x.id));
        for (const [id, text] of Object.entries(rec.map)) {
          if (ids.has(id)) state.persistedIdx.set(id, text);
        }
      } catch (_) {}
    }
    function scheduleFullTextSearch() {
      window.clearTimeout(state.ftTimer);
      const q = parseSearch(state.search).q;
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
        const cached = state.bodyCache.has(it.id) ? state.bodyCache.get(it.id) : state.persistedIdx.get(it.id);
        if (cached != null) {
          if (String(cached).toLowerCase().includes(q)) matched.add(it.id);
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
      // 控制正文缓存规模（简单 LRU：保留最近 300 篇）
      if (state.bodyCache.size > 400) {
        const keys = [...state.bodyCache.keys()];
        for (let i = 0; i < keys.length - 300; i++) state.bodyCache.delete(keys[i]);
      }
      renderSidebar();
      setSaveStatus(`全文匹配 ${matched.size} 篇`);
    }

    function renderSidebar() {
      if (state.trashMode) {
        if (els.cats) els.cats.innerHTML = "";
        if (els.tags) els.tags.innerHTML = "";
        if (els.list) {
          els.list.innerHTML =
            `<div class="mdm-group-title">回收站 (${state.trashEntries.length})</div>` +
            `<div class="mdm-trash-actions"><button type="button" class="ghost-btn" data-trash="back">返回文档</button><button type="button" class="ghost-btn" data-trash="restore-all">全部恢复</button><button type="button" class="ghost-btn" data-trash="empty">清空回收站</button></div>` +
            (state.trashEntries.length
              ? state.trashEntries
                  .map(
                    (t) =>
                      `<div class="mdm-item" data-trash-row><span class="mdm-item-title">${escapeHtml(
                        t.title || String(t.name).replace(/^[0-9a-z]+-/, "")
                      )}</span><span class="mdm-item-meta"><button type="button" class="ghost-btn" data-trash-restore="${escapeHtml(
                        t.key
                      )}">恢复</button><button type="button" class="ghost-btn" data-trash-purge="${escapeHtml(t.key)}">彻底删除</button></span></div>`
                  )
                  .join("")
              : `<span class="hint tight">回收站为空</span>`);
        }
        if (els.batchbar) els.batchbar.hidden = true;
        return;
      }
      if (state.historyMode) {
        if (els.cats) els.cats.innerHTML = "";
        if (els.tags) els.tags.innerHTML = "";
        if (els.list) {
          els.list.innerHTML =
            `<div class="mdm-group-title">历史版本 (${state.historyEntries.length})</div>` +
            `<div class="mdm-trash-actions"><button type="button" class="ghost-btn" data-hist="back">返回文档</button></div>` +
            (state.historyEntries.length
              ? state.historyEntries
                  .map(
                    (e) =>
                      `<div class="mdm-item" data-hist-row><span class="mdm-item-title">${escapeHtml(
                        new Date(e.ts || 0).toLocaleString()
                      )}</span><span class="mdm-item-meta"><button type="button" class="ghost-btn" data-hist-restore="${escapeHtml(
                        e.key
                      )}">恢复</button></span></div>`
                  )
                  .join("")
              : `<span class="hint tight">暂无历史版本</span>`);
        }
        if (els.batchbar) els.batchbar.hidden = true;
        return;
      }
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
      renderList();
      updateBatchBar();
      renderMeta();
    }

    /** 文件夹专属功能在本地存储模式下置灰（避免点了只报错） */
    function applyModeUI() {
      const dirOnly = state.mode === "dir";
      if (els.importDirBtn) {
        els.importDirBtn.disabled = !dirOnly;
        els.importDirBtn.title = dirOnly ? "" : "仅「文件夹」模式可用";
      }
      if (els.useIdb) {
        els.useIdb.disabled = state.mode === "idb";
        els.useIdb.title = state.mode === "idb" ? "当前已在本地存储模式" : "改用浏览器本地存储（不写文件夹）";
      }
      if (els.pickDir && state.mode === "idb") els.pickDir.textContent = "改用文件夹";
      const rescan = els.insertDropdown?.querySelector('[data-insert="rescan"]');
      if (rescan) {
        rescan.disabled = !dirOnly;
        rescan.title = dirOnly ? "" : "仅「文件夹」模式可用";
      }
    }

    /** 批量栏状态（不重建列表，供细粒度更新复用） */
    function updateBatchBar() {
      if (!els.batchbar) return;
      els.batchbar.hidden = state.selected.size === 0;
      if (els.batchCount) els.batchCount.textContent = `已选 ${state.selected.size} 项`;
    }

    /** #17 细粒度更新：仅同步列表项的选中/当前态，避免整表重建 */
    function updateItemClasses() {
      if (!els.list) return;
      els.list.querySelectorAll(".mdm-item[data-id]").forEach((el) => {
        const id = el.dataset.id;
        el.classList.toggle("is-active", id === state.currentId);
        el.classList.toggle("is-selected", state.selected.has(id));
      });
      updateBatchBar();
    }

    /** 搜索命中高亮（先转义再包 mark） */
    function hl(text, q) {
      const t = String(text || "");
      if (!q) return escapeHtml(t);
      const idx = t.toLowerCase().indexOf(q);
      if (idx < 0) return escapeHtml(t);
      return (
        escapeHtml(t.slice(0, idx)) +
        "<mark>" +
        escapeHtml(t.slice(idx, idx + q.length)) +
        "</mark>" +
        escapeHtml(t.slice(idx + q.length))
      );
    }

    function itemHtml(it) {
      const q = parseSearch(state.search).q;
      const cat = state.index.cats.find((c) => c.id === it.catId);
      const tags = (it.tagIds || [])
        .map((tid) => state.index.tags.find((t) => t.id === tid)?.name)
        .filter(Boolean)
        .map((n) => `#${escapeHtml(n)}`)
        .join(" ");
      const canDrag = state.sort === "order";
      return `<button type="button" class="mdm-item${it.id === state.currentId ? " is-active" : ""}${state.selected.has(it.id) ? " is-selected" : ""}" data-id="${escapeHtml(it.id)}" draggable="${canDrag}">
        ${
          canDrag
            ? `<span class="mdm-drag-handle" title="拖动排序" aria-hidden="true">⋮⋮</span>`
            : `<span class="mdm-drag-handle is-off" aria-hidden="true"></span>`
        }
        <span class="mdm-item-body">
          <span class="mdm-item-title">${hl(it.title || "未命名", q)}</span>
          <span class="mdm-item-meta hint tight">${cat ? escapeHtml(cat.name) + " · " : ""}${tags}</span>
        </span>
      </button>`;
    }

    const LIST_ROW_H = 56;
    let listRaf = 0;
    /** 列表虚拟化：条目多时只渲染可视区，避免万级 DOM 卡顿 */
    function renderList() {
      if (!els.list) return;
      const items = filteredItems();
      const wrap = els.listWrap;
      if (!wrap || items.length <= 60) {
        els.list.innerHTML = items.length
          ? items.map(itemHtml).join("")
          : `<span class="hint tight">没有匹配的文档</span>`;
        return;
      }
      const viewH = wrap.clientHeight || 400;
      const total = items.length;
      const start = Math.max(0, Math.floor(wrap.scrollTop / LIST_ROW_H) - 6);
      const end = Math.min(total, start + Math.ceil(viewH / LIST_ROW_H) + 12);
      const topPad = start * LIST_ROW_H;
      const bottomPad = Math.max(0, (total - end) * LIST_ROW_H);
      els.list.innerHTML =
        `<div style="height:${topPad}px" aria-hidden="true"></div>` +
        items.slice(start, end).map(itemHtml).join("") +
        `<div style="height:${bottomPad}px" aria-hidden="true"></div>`;
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

    function buildKeymap(CM) {
      return CM.keymap.of([
        { key: "Enter", run: CM.insertNewlineContinueMarkup },
        { key: "Backspace", run: CM.deleteMarkupBackward },
        { key: state.keys.bold || "Mod-b", run: (v) => wrapSelection(v, "**", "**") },
        { key: state.keys.italic || "Mod-i", run: (v) => wrapSelection(v, "*", "*") },
        { key: state.keys.link || "Mod-k", run: (v) => wrapSelection(v, "[", "](https://)") },
        { key: "Mod-s", run: () => { void saveCurrent(); return true; } },
        ...(CM.historyKeymap || []),
      ]);
    }

    function syncKeys() {
      const CM = window.DevToolsCM6;
      if (!state.view || !CM || !state.keyCompartment) return;
      try {
        state.view.dispatch({ effects: state.keyCompartment.reconfigure(buildKeymap(CM)) });
      } catch (_) {}
    }

    function wrapSelection(view, before, after) {
      const { from, to } = view.state.selection.main;
      const sel = view.state.sliceDoc(from, to);
      view.dispatch({
        changes: { from, to, insert: `${before}${sel}${after}` },
        selection: { anchor: from + before.length, head: from + before.length + sel.length },
      });
      return true;
    }

    function bindEditorScroll() {
      const view = state.view;
      const pv = els.preview;
      if (!view || !pv || !view.scrollDOM) return;
      const sc = view.scrollDOM;
      const onEditor = () => {
        if (state.syncing) return;
        const eMax = sc.scrollHeight - sc.clientHeight;
        const pMax = pv.scrollHeight - pv.clientHeight;
        if (eMax <= 0 || pMax <= 0) return;
        state.syncing = true;
        pv.scrollTop = (sc.scrollTop / eMax) * pMax;
        window.requestAnimationFrame(() => { state.syncing = false; });
      };
      const onPreview = () => {
        if (state.syncing) return;
        const eMax = sc.scrollHeight - sc.clientHeight;
        const pMax = pv.scrollHeight - pv.clientHeight;
        if (eMax <= 0 || pMax <= 0) return;
        state.syncing = true;
        sc.scrollTop = (pv.scrollTop / pMax) * eMax;
        window.requestAnimationFrame(() => { state.syncing = false; });
      };
      sc.addEventListener("scroll", onEditor, { passive: true });
      pv.addEventListener("scroll", onPreview, { passive: true });
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
      state.keyCompartment = state.keyCompartment || new CM.Compartment();
      exts.push(state.keyCompartment.of(buildKeymap(CM)));
      exts.push(
        CM.EditorView.updateListener.of((u) => {
          if (u.docChanged && !state.suppressEditorChange) {
            state.dirty = true;
            updateSaveBtn();
            schedulePreview();
            scheduleAutoSave();
          }
          if (u.docChanged || u.selectionSet) {
            updateDocStats(u.state.doc.toString(), u.state.selection.main);
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
      const src = getEditorText();
      els.preview.innerHTML = renderMarkdown(src);
      els.preview.querySelectorAll("a[href]").forEach((a) => {
        a.setAttribute("target", "_blank");
        a.setAttribute("rel", "noopener noreferrer");
      });
      applyTaskLists(els.preview);
      updateDocStats(src, state.view?.state.selection.main);
      void resolvePreviewAssets();
      void renderMermaidBlocks();
    }

    function updateDocStats(src, sel) {
      if (!els.docStats) return;
      const s = String(src || "");
      const chars = s.length;
      const words = (s.match(/[\u4e00-\u9fa5]|[A-Za-z0-9_'-]+/g) || []).length;
      const lines = s ? s.split("\n").length : 0;
      const selN = sel && sel.to > sel.from ? sel.to - sel.from : 0;
      els.docStats.textContent = `${words} 词 · ${chars} 字符 · ${lines} 行${selN ? ` · 选中 ${selN} 字符` : ""}`;
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
    function findItemByFileName(name) {
      const n = String(name || "").split("/").pop();
      return (state.index.items || []).find((x) => x.fileName === n) || null;
    }

    function parseTableAt(lines, idx) {
      return MP.parseTableAt ? MP.parseTableAt(lines, idx) : null;
    }
    function buildTable(grid) {
      return MP.buildTable ? MP.buildTable(grid) : "";
    }
    function replaceDocRefs(text, oldName, newName) {
      return MP.replaceDocRefs ? MP.replaceDocRefs(text, oldName, newName) : { text, count: 0 };
    }

    /** 改名后同步其它文档里的引用（当前文档若未保存则直接改编辑器，避免覆盖编辑） */
    async function updateIncomingRefs(oldName, newName) {
      if (!oldName || !newName || oldName === newName) return 0;
      let updated = 0;
      let currentWritten = false;
      for (const it of state.index.items || []) {
        try {
          const isCur = it.id === state.currentId;
          if (isCur && state.dirty && state.view) {
            const rr = replaceDocRefs(getEditorText(), oldName, newName);
            if (rr.count) {
              setEditorText(rr.text);
              state.dirty = true;
              updateSaveBtn();
              updated++;
            }
            continue;
          }
          const raw = await readDocText(it);
          const fm = parseFrontMatter(raw);
          const rr = replaceDocRefs(fm.body, oldName, newName);
          if (!rr.count) continue;
          const hadFm = /^\uFEFF?---\r?\n/.test(String(raw));
          const rebuilt = hadFm ? buildFrontMatterBlock({ ...it, fmHead: fm.head }, rr.text) : rr.text;
          await writeDocText(it, rebuilt);
          state.bodyCache.set(it.id, rr.text);
          state.persistedIdx.delete(it.id);
          it.updatedAt = Date.now();
          updated++;
          if (isCur) currentWritten = true;
        } catch (_) {}
      }
      if (updated) {
        await saveIndexToStorage();
        if (currentWritten && !state.dirty) {
          const cur = findItem(state.currentId);
          if (cur && state.view) {
            const raw = await readDocText(cur).catch(() => "");
            const fm = parseFrontMatter(raw);
            cur.fmHead = fm.head || "";
            setEditorText(fm.body);
            renderPreview();
          }
        }
        renderSidebar();
      }
      return updated;
    }

    // ---- #2 表格可视化编辑（光标所在表格 → 网格弹窗） ----
    function closeModal() {
      if (!els.modal) return;
      els.modal.hidden = true;
      els.modalBox.innerHTML = "";
    }

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && els.modal && !els.modal.hidden) closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (!(e.ctrlKey || e.metaKey) || e.shiftKey || String(e.key).toLowerCase() !== "z") return;
      const t = e.target;
      if (t && (t.closest?.(".cm-editor") || t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      if (state.lastDeleted && undoDelete()) e.preventDefault();
    });

    function openTableEditor() {
      const view = state.view;
      if (!view) return;
      const doc = view.state.doc;
      const pos = view.state.selection.main.head;
      const lineIdx = doc.lineAt(pos).number - 1;
      const t = parseTableAt(doc.toString().split("\n"), lineIdx);
      if (!t) {
        setErr("光标不在表格内：请把光标放到表格任意一行再试");
        return;
      }
      const grid = t.grid.map((r) => [...r]);
      const align = Array.isArray(t.align) ? [...t.align] : [];
      let header = true;
      const box = els.modalBox;
      const colCount = () => Math.max(...grid.map((r) => r.length), 1);
      const ALIGN_LABEL = { "": "默认", left: "左", center: "中", right: "右" };
      const render = () => {
        box.innerHTML =
          `<div class="mdm-modal-head"><strong>表格编辑</strong><button type="button" class="ghost-btn" data-mdl="close">关闭</button></div>` +
          `<div class="mdm-grid-wrap"><table class="mdm-grid"><tbody>` +
          grid
            .map(
              (row, ri) =>
                `<tr>` +
                row
                  .map(
                    (c, ci) =>
                      `<td><input data-r="${ri}" data-c="${ci}" value="${escapeHtml(c)}"${
                        ri === 0 && header ? ' class="is-head"' : ""
                      } />` +
                      (ri === 0 && header
                        ? `<select class="mdm-align-sel" data-align="${ci}">` +
                          ["", "left", "center", "right"]
                            .map(
                              (v) =>
                                `<option value="${v}"${(align[ci] || "") === v ? " selected" : ""}>${
                                  ALIGN_LABEL[v]
                                }</option>`
                            )
                            .join("") +
                          `</select>`
                        : "") +
                      `</td>`
                  )
                  .join("") +
                `</tr>`
            )
            .join("") +
          `</tbody></table></div>` +
          `<div class="mdm-modal-foot">` +
          `<button type="button" class="ghost-btn" data-mdl="addrow">+ 行</button>` +
          `<button type="button" class="ghost-btn" data-mdl="delrow">- 行</button>` +
          `<button type="button" class="ghost-btn" data-mdl="addcol">+ 列</button>` +
          `<button type="button" class="ghost-btn" data-mdl="delcol">- 列</button>` +
          `<label class="mdm-hdr-toggle"><input type="checkbox" id="mdm-tbl-header"${
            header ? " checked" : ""
          } /> 首行为表头</label>` +
          `<button type="button" class="primary-btn" data-mdl="ok">确定</button>` +
          `</div>`;
      };
      const collect = () => {
        box.querySelectorAll("input[data-r]").forEach((inp) => {
          const r = Number(inp.dataset.r);
          const c = Number(inp.dataset.c);
          if (grid[r]) grid[r][c] = inp.value;
        });
        box.querySelectorAll("select[data-align]").forEach((sel) => {
          align[Number(sel.dataset.align)] = sel.value;
        });
        const cb = box.querySelector("#mdm-tbl-header");
        if (cb) header = Boolean(cb.checked);
      };
      render();
      els.modal.hidden = false;
      els.modal.onclick = (e) => {
        if (e.target === els.modal) closeModal();
      };
      box.onclick = (e) => {
        const b = e.target.closest?.("[data-mdl]");
        if (!b) return;
        const act = b.dataset.mdl;
        if (act === "close") return closeModal();
        collect();
        if (act === "addrow") grid.push(new Array(colCount()).fill(""));
        else if (act === "delrow") {
          if (grid.length > 1) grid.pop();
        } else if (act === "addcol") {
          grid.forEach((r) => r.push(""));
          align.push("");
        } else if (act === "delcol") {
          if (colCount() > 1) {
            grid.forEach((r) => r.pop());
            align.pop();
          }
        } else if (act === "ok") {
          view.dispatch({
            changes: {
              from: doc.line(t.start + 1).from,
              to: doc.line(t.end + 1).to,
              insert: buildTable(grid, { align, header }),
            },
          });
          closeModal();
          toast("表格已更新");
          return;
        }
        render();
      };
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
      return MP.isRelativeRef
        ? MP.isRelativeRef(v)
        : Boolean(v) && !/^(https?:|data:|blob:|#|mailto:|tel:|\/\/)/i.test(v);
    }
    async function resolvePreviewAssets() {
      if (!state.mode || !els.preview) return;
      const nodes = [...els.preview.querySelectorAll("img, video, audio, source, a[href]")];
      for (const el of nodes) {
        const attr = el.tagName === "A" ? "href" : "src";
        const v = el.getAttribute(attr) || "";
        if (!isRelativeRef(v)) continue;
        const rel = v.replace(/^\.\//, "").replace(/^\/+/, "");
        if (el.tagName === "A" && /\.(md|markdown)$/i.test(rel)) {
          const target = findItemByFileName(rel);
          if (target) {
            el.setAttribute("data-mdm-open", target.id);
            el.setAttribute("href", "#");
            el.removeAttribute("download");
            continue;
          }
        }
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
      if (MP.collectRefs) return MP.collectRefs(text);
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
      // 先看缓存：源码没变就直接用缓存 SVG，避免每次编辑重渲所有图表
      const pending = [];
      for (const code of codes) {
        const src = code.textContent || "";
        const cached = state.mermaidCache.get(src);
        const pre = code.closest("pre") || code.parentElement;
        if (cached) {
          const div = document.createElement("div");
          div.className = "mdm-mermaid";
          div.innerHTML = cached;
          pre.replaceWith(div);
        } else {
          pending.push({ pre, src });
        }
      }
      if (!pending.length) return;
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
      for (const { pre, src } of pending) {
        try {
          const { svg } = await window.mermaid.render(`mmd${Math.random().toString(36).slice(2, 9)}`, src);
          state.mermaidCache.set(src, svg);
          if (state.mermaidCache.size > 80) {
            const first = state.mermaidCache.keys().next().value;
            state.mermaidCache.delete(first);
          }
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
      file = await maybeCompressImage(file);
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

    function markdownForAsset(file, rel, altOverride) {
      const mime = String(file.type || "");
      const label = String(file.name || rel.split("/").pop() || "文件");
      const noExt = label.replace(/\.[^.]+$/, "");
      if (/^image\//.test(mime) || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(label))
        return `![${altOverride != null ? altOverride : noExt}](${rel})`;
      if (/^video\//.test(mime) || /\.(mp4|webm|mov|m4v|ogv)$/i.test(label)) return `<video src="${rel}" controls playsinline></video>`;
      if (/^audio\//.test(mime) || /\.(mp3|wav|ogg|m4a|flac|aac)$/i.test(label)) return `<audio src="${rel}" controls></audio>`;
      return `[${label}](${rel})`;
    }

    async function maybeCompressImage(file) {
      const on = els.imgCompress ? els.imgCompress.checked : true;
      if (!on || !/^image\//.test(file.type || "")) return file;
      if (/gif|svg/i.test(file.type || "")) return file;
      if (typeof createImageBitmap !== "function") return file;
      try {
        const bmp = await createImageBitmap(file);
        const maxW = 1600;
        if (bmp.width <= maxW && file.size < 800 * 1024) {
          bmp.close?.();
          return file;
        }
        const scale = Math.min(1, maxW / bmp.width);
        const w = Math.max(1, Math.round(bmp.width * scale));
        const h = Math.max(1, Math.round(bmp.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(bmp, 0, 0, w, h);
        bmp.close?.();
        const blob = await new Promise((r) => canvas.toBlob(r, "image/webp", 0.9));
        if (!blob || blob.size >= file.size) return file;
        return new File([blob], String(file.name || "img").replace(/\.[^.]+$/, "") + ".webp", { type: "image/webp" });
      } catch (_) {
        return file;
      }
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
      const singleImg = list.length === 1 && /^image\//.test(list[0].type || "");
      let alt = null;
      if (singleImg) {
        const dflt = String(list[0].name || "").replace(/\.[^.]+$/, "");
        const got = window.prompt("图片描述（alt，可留空）", dflt);
        alt = got == null ? dflt : got;
      }
      const parts = [];
      for (const f of list) {
        try {
          const a = await saveAsset(f);
          parts.push(markdownForAsset(f, a.rel, singleImg ? alt : undefined));
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
        date: () => new Date().toLocaleDateString(),
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

    /** 重新扫描文件夹：把目录里已有但未纳入索引的 .md 加进来 */
    async function rescanFolder() {
      if (state.mode !== "dir" || !state.dirHandle) {
        setErr("仅「文件夹」模式支持重新扫描");
        return;
      }
      setSaveStatus("扫描文件夹…");
      try {
        const known = new Set((state.index.items || []).map((x) => x.fileName));
        let added = 0;
        for await (const [name, handle] of state.dirHandle.entries()) {
          if (handle.kind !== "file" || !/\.(md|markdown)$/i.test(name)) continue;
          if (name === INDEX_FILE || known.has(name)) continue;
          let text = "";
          try {
            text = await (await handle.getFile()).text();
          } catch (_) {}
          const fm = parseFrontMatter(text);
          const title = fm.title || name.replace(/\.[^.]+$/, "");
          state.index.items.push({
            id: uid(),
            title,
            titleSaved: title,
            fileName: name,
            fmHead: fm.head || "",
            catId: ensureCat(fm.category),
            tagIds: (fm.tags || []).map((t) => ensureTag(t)).filter(Boolean),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            size: new Blob([fm.body]).size,
            excerpt: fm.body.replace(/\s+/g, " ").trim().slice(0, 160),
          });
          added += 1;
        }
        normalizeOrders();
        await saveIndexToStorage();
        renderSidebar();
        setSaveStatus("");
        toast(added ? `已纳入 ${added} 篇已有文档` : "没有新的 .md 文件");
      } catch (err) {
        setErr(`扫描失败：${err.message || err}`);
      }
    }

    /** 整库导出：ZIP（mdindex.json + 全部 .md + assets/） */
    async function exportLibrary() {
      if (typeof window.JSZip !== "function") {
        setErr("ZIP 库未就绪");
        return;
      }
      setSaveStatus("打包整库…");
      try {
        const zip = new window.JSZip();
        zip.file(INDEX_FILE, JSON.stringify(state.index, null, 2));
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
          zip.file(it.fileName || `${slugify(it.title)}.md`, text);
        }
        for (const rel of await listAssetNames()) {
          try {
            zip.file(rel, await readAssetBlob(rel));
          } catch (_) {}
        }
        const blob = await zip.generateAsync({ type: "blob" });
        downloadBlob(blob, `markdown-library-${Date.now()}.zip`);
        setSaveStatus("整库已导出");
        toast("整库已导出");
      } catch (err) {
        setErr(`导出库失败：${err.message || err}`);
      }
    }

    /** 整库导入：读取 ZIP，写入 .md 与 assets，合并索引 */
    async function importLibrary(file) {
      if (typeof window.JSZip !== "function") {
        setErr("ZIP 库未就绪");
        return;
      }
      if (!state.mode) {
        setErr("请先选择文件夹或进入本地存储模式");
        return;
      }
      setSaveStatus("读取整库…");
      try {
        const zip = await window.JSZip.loadAsync(file);
        let indexJson = null;
        if (zip.file(INDEX_FILE)) {
          try {
            indexJson = JSON.parse(await zip.file(INDEX_FILE).async("string"));
          } catch (_) {
            indexJson = null;
          }
        }
        const byName = new Map();
        if (indexJson && Array.isArray(indexJson.items)) {
          for (const it of indexJson.items) if (it?.fileName) byName.set(it.fileName, it);
        }
        const seen = [];
        for (const entry of Object.values(zip.files)) {
          if (entry.dir) continue;
          const name = entry.name;
          if (name === INDEX_FILE) continue;
          if (/^assets\//i.test(name)) {
            await writeAssetFile(name, await entry.async("blob"));
          } else if (/\.(md|markdown)$/i.test(name)) {
            const text = await entry.async("string");
            const idx = byName.get(name);
            const it = idx
              ? { ...idx, order: undefined }
              : { id: uid(), fileName: name, title: name.replace(/\.[^.]+$/, "") };
            await writeDocText(it, text);
            seen.push(it);
          }
        }
        const known = new Set((state.index.items || []).map((x) => x.fileName));
        if (indexJson && Array.isArray(indexJson.items)) {
          for (const c of indexJson.cats || [])
            if (c?.id && !state.index.cats.find((x) => x.id === c.id)) state.index.cats.push(c);
          for (const t of indexJson.tags || [])
            if (t?.id && !state.index.tags.find((x) => x.id === t.id)) state.index.tags.push(t);
          for (const it of indexJson.items) {
            if (!it?.fileName || known.has(it.fileName)) continue;
            state.index.items.push({ ...it, id: it.id || uid(), order: undefined });
            known.add(it.fileName);
          }
        } else {
          for (const it of seen) {
            if (known.has(it.fileName)) continue;
            state.index.items.push({ ...it, order: undefined });
            known.add(it.fileName);
          }
        }
        normalizeOrders();
        await saveIndexToStorage();
        renderSidebar();
        setSaveStatus("");
        toast("整库已导入");
      } catch (err) {
        setErr(`导入库失败：${err.message || err}`);
      }
    }

    // ---- 回收站（文件夹：.trash/ ；IDB：trash 存储） ----
    async function trashDoc(item) {
      if (state.mode === "dir" && state.dirHandle) {
        try {
          const trash = await state.dirHandle.getDirectoryHandle(".trash", { create: true });
          const src = await state.dirHandle.getFileHandle(item.fileName);
          const f = await src.getFile();
          const name = `${Date.now().toString(36)}-${item.fileName}`;
          const dst = await trash.getFileHandle(name, { create: true });
          const w = await dst.createWritable();
          await w.write(f);
          await w.close();
          await state.dirHandle.removeEntry(item.fileName);
          return true;
        } catch (_) {
          return false;
        }
      }
      try {
        const text = await readDocText(item).catch(() => "");
        await idbSet("trash", item.id, {
          fileName: item.fileName,
          title: item.title,
          text,
          deletedAt: Date.now(),
        });
        await idbDel("docs", item.id);
      } catch (_) {}
      return false;
    }

    async function listTrash() {
      const out = [];
      if (state.mode === "dir" && state.dirHandle) {
        try {
          const trash = await state.dirHandle.getDirectoryHandle(".trash");
          for await (const [name, handle] of trash.entries()) {
            if (handle.kind === "file") out.push({ key: name, name });
          }
        } catch (_) {}
      } else {
        const db = await idbOpen();
        await new Promise((resolve) => {
          const tx = db.transaction("trash", "readonly");
          const req = tx.objectStore("trash").openCursor();
          req.onsuccess = () => {
            const c = req.result;
            if (c) {
              const v = c.value || {};
              out.push({
                key: String(c.key),
                name: `${(Number(v.deletedAt) || 0).toString(36)}-${v.fileName || c.key}`,
                title: v.title || "",
              });
              c.continue();
            } else resolve();
          };
          req.onerror = () => resolve();
        });
      }
      return out;
    }

    async function openTrash() {
      state.trashEntries = await listTrash();
      state.trashMode = true;
      renderSidebar();
    }

    async function restoreTrash(key) {
      try {
        let text = "";
        let orig = "";
        let title = "";
        if (state.mode === "dir" && state.dirHandle) {
          const trash = await state.dirHandle.getDirectoryHandle(".trash");
          const src = await trash.getFileHandle(key);
          text = await (await src.getFile()).text();
          orig = key.replace(/^[0-9a-z]+-/, "");
        } else {
          const rec = await idbGet("trash", key);
          if (!rec) throw new Error("回收站记录不存在");
          text = rec.text || "";
          orig = rec.fileName || "restored.md";
          title = rec.title || "";
        }
        const fm = parseFrontMatter(text);
        const item = {
          id: uid(),
          title: title || fm.title || orig.replace(/\.[^.]+$/, ""),
          titleSaved: title || fm.title || orig.replace(/\.[^.]+$/, ""),
          fileName: uniqueFileName(orig, ""),
          catId: ensureCat(fm.category),
          tagIds: (fm.tags || []).map((t) => ensureTag(t)).filter(Boolean),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          size: new Blob([fm.body]).size,
          excerpt: fm.body.replace(/\s+/g, " ").trim().slice(0, 160),
        };
        await writeDocText(item, text);
        state.index.items.push(item);
        normalizeOrders();
        await saveIndexToStorage();
        if (state.mode === "dir" && state.dirHandle) {
          const trash = await state.dirHandle.getDirectoryHandle(".trash");
          await trash.removeEntry(key);
        } else {
          await idbDel("trash", key);
        }
        await openTrash();
        toast("已恢复");
      } catch (err) {
        setErr(`恢复失败：${err.message || err}`);
      }
    }

    async function purgeTrash(key) {
      try {
        if (state.mode === "dir" && state.dirHandle) {
          const trash = await state.dirHandle.getDirectoryHandle(".trash");
          await trash.removeEntry(key);
        } else {
          await idbDel("trash", key);
        }
        await openTrash();
      } catch (_) {}
    }

    async function restoreAllTrash() {
      const keys = state.trashEntries.map((t) => t.key);
      if (!keys.length) return;
      for (const k of keys) await restoreTrash(k);
      toast(`已恢复 ${keys.length} 篇`);
    }

    async function emptyTrash() {
      try {
        if (state.mode === "dir" && state.dirHandle) {
          const trash = await state.dirHandle.getDirectoryHandle(".trash");
          for (const t of state.trashEntries) {
            try {
              await trash.removeEntry(t.key);
            } catch (_) {}
          }
        } else {
          for (const t of state.trashEntries) {
            try {
              await idbDel("trash", t.key);
            } catch (_) {}
          }
        }
        await openTrash();
        toast("回收站已清空");
      } catch (_) {}
    }

    // ---- 版本历史（文件夹：.history/ ；IDB：history 存储；各留最近 20） ----
    const SNAP_MIN_MS = 5 * 60 * 1000;
    async function snapshotHistory(item) {
      if (!state.mode) return;
      if (Date.now() - (state.lastSnap.get(item.id) || 0) < SNAP_MIN_MS) return;
      try {
        const cur = await readDocText(item);
        // 去重：内容与上次快照相同则跳过
        if (state.lastSnapText.get(item.id) === cur) {
          state.lastSnap.set(item.id, Date.now());
          return;
        }
        if (state.mode === "dir" && state.dirHandle) {
          const root = await state.dirHandle.getDirectoryHandle(".history", { create: true });
          const dir = await root.getDirectoryHandle(item.fileName, { create: true });
          const fh = await dir.getFileHandle(`${Date.now()}.md`, { create: true });
          const w = await fh.createWritable();
          await w.write(cur);
          await w.close();
          const names = [];
          for await (const [n, h] of dir.entries()) if (h.kind === "file") names.push(n);
          names.sort();
          while (names.length > 20) {
            try {
              await dir.removeEntry(names.shift());
            } catch (_) {}
          }
        } else {
          await idbSet("history", `${item.id}|${Date.now()}`, {
            id: item.id,
            fileName: item.fileName,
            ts: Date.now(),
            text: cur,
          });
        }
        state.lastSnap.set(item.id, Date.now());
        state.lastSnapText.set(item.id, cur);
      } catch (_) {}
    }

    async function openHistory(item) {
      if (!state.mode || !item) {
        setErr("历史版本需先连接存储");
        return;
      }
      const entries = [];
      if (state.mode === "dir" && state.dirHandle) {
        try {
          const root = await state.dirHandle.getDirectoryHandle(".history");
          const dir = await root.getDirectoryHandle(item.fileName);
          for await (const [n, h] of dir.entries()) {
            if (h.kind === "file") entries.push({ key: n, ts: Number(String(n).replace(/\.md$/, "")) || 0 });
          }
        } catch (_) {}
      } else {
        const db = await idbOpen();
        await new Promise((resolve) => {
          const tx = db.transaction("history", "readonly");
          const req = tx.objectStore("history").openCursor();
          req.onsuccess = () => {
            const c = req.result;
            if (c) {
              const v = c.value || {};
              if (v.id === item.id) entries.push({ key: String(c.key), ts: Number(v.ts) || 0 });
              c.continue();
            } else resolve();
          };
          req.onerror = () => resolve();
        });
      }
      entries.sort((a, b) => b.ts - a.ts);
      state.historyEntries = entries;
      state.historyMode = true;
      state.historyItem = item;
      renderSidebar();
    }

    async function restoreHistory(item, key) {
      try {
        let text = "";
        if (state.mode === "dir" && state.dirHandle) {
          const root = await state.dirHandle.getDirectoryHandle(".history");
          const dir = await root.getDirectoryHandle(item.fileName);
          text = await (await (await dir.getFileHandle(key)).getFile()).text();
        } else {
          const rec = await idbGet("history", key);
          text = rec?.text || "";
        }
        setEditorText(text);
        state.dirty = true;
        updateSaveBtn();
        renderPreview();
        renderOutline();
        toast("已载入历史版本（保存后生效）");
      } catch (err) {
        setErr(`载入历史失败：${err.message || err}`);
      }
    }

    // ---- 运维：回收站/历史自动过期（30 天） ----
    const EXPIRE_DAYS = 30;
    async function autoExpireTrash() {
      const cutoff = Date.now() - EXPIRE_DAYS * 86400000;
      if (state.mode === "dir" && state.dirHandle) {
        try {
          const trash = await state.dirHandle.getDirectoryHandle(".trash");
          const del = [];
          for await (const [n, h] of trash.entries()) {
            if (h.kind !== "file") continue;
            const ts = parseInt(String(n).split("-")[0], 36);
            if (Number.isFinite(ts) && ts < cutoff) del.push(n);
          }
          for (const n of del) {
            try {
              await trash.removeEntry(n);
            } catch (_) {}
          }
        } catch (_) {}
        try {
          const root = await state.dirHandle.getDirectoryHandle(".history");
          for await (const [, dh] of root.entries()) {
            if (dh.kind !== "directory") continue;
            const del = [];
            for await (const [n, h] of dh.entries()) {
              if (h.kind !== "file") continue;
              const ts = Number(String(n).replace(/\.md$/, ""));
              if (Number.isFinite(ts) && ts < cutoff) del.push(n);
            }
            for (const n of del) {
              try {
                await dh.removeEntry(n);
              } catch (_) {}
            }
          }
        } catch (_) {}
      } else {
        for (const [store, field] of [["trash", "deletedAt"], ["history", "ts"]]) {
          try {
            const db = await idbOpen();
            const del = [];
            await new Promise((resolve) => {
              const tx = db.transaction(store, "readonly");
              const req = tx.objectStore(store).openCursor();
              req.onsuccess = () => {
                const c = req.result;
                if (c) {
                  if ((c.value?.[field] || 0) < cutoff) del.push(c.key);
                  c.continue();
                } else resolve();
              };
              req.onerror = () => resolve();
            });
            for (const k of del) await idbDel(store, k);
          } catch (_) {}
        }
      }
    }

    async function checkLinks() {
      const text = getEditorText();
      const refs = collectReferencedAssets(text);
      if (!refs.length) {
        toast("链接检查：本篇无本地引用");
        return;
      }
      let names = new Set();
      try {
        names = new Set(await listAssetNames());
      } catch (_) {}
      const missing = [];
      for (const rel of refs) {
        const n = rel.split("/").pop();
        if (names.has(rel) || names.has(n) || findItemByFileName(rel)) continue;
        missing.push(rel);
      }
      if (!missing.length) {
        toast(`链接检查：${refs.length} 个本地引用全部有效`);
        return;
      }
      setErr(`发现 ${missing.length} 个失效引用：${missing.slice(0, 5).join("、")}${missing.length > 5 ? " …" : ""}`);
    }

    function fmtBytes(n) {
      const b = Number(n) || 0;
      if (b < 1024) return `${b} B`;
      if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
      if (b < 1024 * 1024 * 1024) return `${(b / 1024 / 1024).toFixed(1)} MB`;
      return `${(b / 1024 / 1024 / 1024).toFixed(2)} GB`;
    }

    async function showUsage() {
      try {
        const docs = (state.index.items || []).length;
        const assets = await listAssetNames();
        let bytes = 0;
        for (const rel of assets) {
          try {
            bytes += (await readAssetBlob(rel)).size;
          } catch (_) {}
        }
        let quota = "";
        if (navigator.storage?.estimate) {
          try {
            const est = await navigator.storage.estimate();
            quota = ` · 浏览器用量 ${fmtBytes(est.usage || 0)} / 配额 ${fmtBytes(est.quota || 0)}`;
          } catch (_) {}
        }
        const msg = `文档 ${docs} 篇 · 资源 ${assets.length} 个（${fmtBytes(bytes)}）${quota}`;
        setSaveStatus(msg);
        toast(msg);
      } catch (err) {
        setErr(`统计失败：${err.message || err}`);
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
          const plain = e.clipboardData?.getData?.("text/plain") || "";
          if (/^https?:\/\/\S+\.(png|jpe?g|gif|webp|bmp|svg)(\?\S*)?$/i.test(plain.trim())) {
            e.preventDefault();
            view.dispatch(view.state.replaceSelection(`![](${plain.trim()})`));
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
        cb.checked = m[1].toLowerCase() === "x";
        cb.className = "mdm-task-cb";
        cb.title = "点击切换完成状态";
        holder.insertBefore(cb, holder.firstChild);
        li.classList.add("mdm-task");
      });
    }

    /** 预览里点击任务复选框 → 回写编辑器里第 n 个 `- [ ]` 状态 */
    function toggleTaskCheckbox(cb) {
      const view = state.view;
      if (!view || !els.preview) return;
      const all = [...els.preview.querySelectorAll("input.mdm-task-cb")];
      const n = all.indexOf(cb);
      if (n < 0) return;
      const text = getEditorText();
      const re = /^(\s*(?:[-*+]|\d+[.)])\s+)\[([ xX])\]/gm;
      let i = 0;
      let m;
      let target = null;
      while ((m = re.exec(text))) {
        if (i === n) {
          target = m;
          break;
        }
        i++;
      }
      if (!target) return;
      const at = target.index + target[1].length + 1;
      const next = String(text[at]).toLowerCase() === "x" ? " " : "x";
      view.dispatch({ changes: { from: at, to: at + 1, insert: next } });
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
      syncOutlineActive();
    }

    function syncOutlineActive() {
      if (!els.outline || !els.preview) return;
      const heads = [...els.preview.querySelectorAll("h1,h2,h3,h4,h5,h6")];
      const items = els.outline.querySelectorAll(".mdm-outline-item");
      if (!heads.length || !items.length) return;
      const top = els.preview.scrollTop + 8;
      let active = 0;
      for (let i = 0; i < heads.length; i++) {
        if (heads[i].offsetTop <= top) active = i;
        else break;
      }
      items.forEach((el, i) => el.classList.toggle("is-active", i === active));
    }

    /** 反向链接：哪些文档引用了当前文档（仅用已缓存正文，不阻塞） */
    function renderBacklinks() {
      const box = els.backlinks;
      if (!box) return;
      const cur = findItem(state.currentId);
      if (!cur || !cur.fileName) {
        box.innerHTML = "";
        return;
      }
      const target = cur.fileName;
      const hits = [];
      for (const it of state.index.items || []) {
        if (it.id === cur.id) continue;
        const text = state.bodyCache.has(it.id) ? state.bodyCache.get(it.id) : state.persistedIdx.get(it.id);
        if (text == null) continue;
        if (collectReferencedAssets(text).some((r) => r.split("/").pop() === target)) hits.push(it);
      }
      box.innerHTML = hits.length
        ? `<div class="mdm-group-title">反向链接 (${hits.length})</div>` +
          hits
            .map(
              (it) =>
                `<button type="button" class="mdm-backlink" data-backlink="${escapeHtml(it.id)}">${escapeHtml(
                  it.title || "未命名"
                )}</button>`
            )
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
        const fm = parseFrontMatter(text);
        item.fmHead = fm.head || "";
        setEditorText(fm.body);
        renderPreview();
        renderOutline();
        renderBacklinks();
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
      normalizeOrders();
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

    function showConflict(item) {
      state.conflictItem = item;
      if (els.conflict) els.conflict.hidden = false;
      window.clearTimeout(state.autoSaveTimer);
      setSaveStatus("检测到外部修改，已暂停保存");
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
      // 版本快照（节流：每 5 分钟最多一次）
      await snapshotHistory(item);
      // 冲突检测：文件被外部改过 → 暂停本次保存并提示（不静默覆盖）
      if (state.mode === "dir" && state.dirHandle && item.fileMtime) {
        try {
          const cur = await (await state.dirHandle.getFileHandle(item.fileName)).getFile();
          if (cur.lastModified && Math.abs(cur.lastModified - item.fileMtime) > 1500) {
            showConflict(item);
            return;
          }
        } catch (_) {}
      }
      // 写回 front-matter（标题/分类/标签），正文为编辑器内容
      const full = buildFrontMatterBlock(item, text);
      try {
        await writeDocText(item, full);
        await saveIndexToStorage();
        state.bodyCache.set(item.id, text);
        state.persistedIdx.delete(item.id);
        renderBacklinks();
        try { mdmChannel?.postMessage({ type: "saved", mode: state.mode }); } catch (_) {}
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
      if (!window.confirm(`删除「${item.title}」？（会移入回收站，可恢复）`)) return;
      let raw = "";
      try {
        raw = await readDocText(item);
      } catch (_) {}
      try {
        await trashDoc(item);
      } catch (_) {}
      state.lastDeleted = { item: { ...item }, raw };
      state.index.items = state.index.items.filter((x) => x.id !== item.id);
      state.bodyCache.delete(item.id);
      state.persistedIdx.delete(item.id);
      state.searchMatches = null;
      normalizeOrders();
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
      toast("已删除（Ctrl+Z 撤销）");
    }

    /** 撤销最近一次删除（Ctrl+Z） */
    async function undoDelete() {
      const rec = state.lastDeleted;
      if (!rec) return false;
      state.lastDeleted = null;
      try {
        await writeDocText(rec.item, rec.raw);
      } catch (_) {}
      state.index.items.push(rec.item);
      normalizeOrders();
      await saveIndexToStorage();
      renderSidebar();
      toast(`已恢复「${rec.item.title}」`);
      return true;
    }

    async function deleteCurrent() {
      await deleteItemById(findItem(state.currentId));
    }

    async function duplicateItem(item) {
      try {
        const text = await readDocText(item).catch(() => "");
        const title = `${item.title}（副本）`;
        const copy = {
          ...item,
          id: uid(),
          title,
          titleSaved: title,
          fileName: uniqueFileName(title, ""),
          fileMtime: 0,
          order: undefined,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await writeDocText(copy, text);
        state.index.items.push(copy);
        normalizeOrders();
        await saveIndexToStorage();
        renderSidebar();
        toast("已复制");
      } catch (err) {
        setErr(`复制失败：${err.message || err}`);
      }
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
      let refs = 0;
      try {
        if (oldName && oldName !== item.fileName) {
          const text = await readDocText({ ...item, fileName: oldName }).catch(() => "");
          await writeDocText(item, text);
          await removeDocFile({ ...item, fileName: oldName });
          refs = await updateIncomingRefs(oldName, item.fileName);
        }
      } catch (_) {}
      await saveIndexToStorage();
      renderSidebar();
      if (state.currentId === item.id && els.title) els.title.value = title;
      toast(refs ? `已重命名，并更新 ${refs} 篇文档中的引用` : "已重命名");
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
        `<button type="button" data-ctx="duplicate">复制</button>` +
        `<button type="button" data-ctx="rename">重命名</button>` +
        `<div class="mdm-ctx-sub"><button type="button" data-ctx="export-toggle">导出 ▸</button>` +
        `<div class="mdm-ctx-submenu" hidden>${fmts
          .map(([v, l]) => `<button type="button" data-ctx-export="${v}">${escapeHtml(l)}</button>`)
          .join("")}</div></div>` +
        `<button type="button" data-ctx="delete" class="is-danger">删除</button>`;
      document.body.appendChild(el);
      if (!x && !y) {
        const btn = els.list?.querySelector(`[data-id="${item.id}"]`);
        const r = btn?.getBoundingClientRect();
        if (r) {
          x = r.left + 8;
          y = r.top + 8;
        }
      }
      const rect = el.getBoundingClientRect();
      el.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 8))}px`;
      el.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 8))}px`;
      listCtxEl = el;
      // 键盘可达
      el.tabIndex = -1;
      el.focus();
      el.addEventListener("keydown", (e) => {
        const btns = [...el.querySelectorAll("button")].filter((b) => b.offsetParent !== null);
        const idx = btns.indexOf(document.activeElement);
        if (e.key === "ArrowDown") {
          e.preventDefault();
          (btns[idx + 1] || btns[0])?.focus();
        } else if (e.key === "ArrowUp") {
          e.preventDefault();
          (btns[idx - 1] || btns[btns.length - 1])?.focus();
        } else if (e.key === "Escape") {
          e.preventDefault();
          closeListCtx();
        }
      });
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
        else if (act === "duplicate") void duplicateItem(item);
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
    }

    // ---- 分类 / 标签 ----
    function renderMeta() {
      const item = findItem(state.currentId);
      if (els.catList) {
        els.catList.innerHTML = (state.index.cats || [])
          .map((c) => `<option value="${escapeHtml(c.name)}"></option>`)
          .join("");
      }
      if (els.tagList) {
        els.tagList.innerHTML = (state.index.tags || [])
          .map((t) => `<option value="${escapeHtml(t.name)}"></option>`)
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

    // 多标签页冲突提示
    let mdmChannel = null;
    try {
      mdmChannel = new BroadcastChannel("devtools-mdm");
      mdmChannel.onmessage = (e) => {
        if (e.data?.type === "saved" && state.mode && e.data.mode === state.mode) {
          setSaveStatus("⚠ 另一个标签页也在用同一存储，注意冲突");
        }
      };
    } catch (_) {}

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
        item.fmHead = fm.head || "";
        try {
          await writeDocText(item, buildFrontMatterBlock(item, res.text));
          state.index.items.push(item);
          n += 1;
        } catch (err) {
          setErr(`导入失败（${f.name}）：${err.message || err}`);
        }
      }
      normalizeOrders();
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

    /** 生成写回文件的完整内容：front-matter（标题/分类/标签 + 保留原有其它键）+ 正文 */
    function buildFrontMatterBlock(item, body) {
      const extra = [];
      for (const line of String(item.fmHead || "").split(/\r?\n/)) {
        if (/^(title|category|cat|tags)\s*:/i.test(line)) continue;
        if (line.trim()) extra.push(line);
      }
      const cat = state.index.cats.find((c) => c.id === item.catId);
      const tags = (item.tagIds || [])
        .map((t) => state.index.tags.find((x) => x.id === t)?.name)
        .filter(Boolean);
      const head = [
        `title: ${item.title || "未命名"}`,
        `category: ${cat ? cat.name : ""}`,
        `tags: [${tags.join(", ")}]`,
        ...extra,
      ].join("\n");
      return `---\n${head}\n---\n\n${String(body || "").replace(/^\s*\n+/, "")}`;
    }

    /** 分类/标签改名后，把受影响文档的 front-matter 重写为新名（仅原本就有 front-matter 的文件） */
    async function refreshFrontMatter(items) {
      let n = 0;
      for (const it of items) {
        try {
          const raw = await readDocText(it);
          const fm = parseFrontMatter(raw);
          if (!/^\uFEFF?---\r?\n/.test(String(raw))) continue;
          await writeDocText(it, buildFrontMatterBlock({ ...it, fmHead: fm.head }, fm.body));
          state.bodyCache.set(it.id, fm.body);
          state.persistedIdx.delete(it.id);
          it.updatedAt = Date.now();
          n++;
        } catch (_) {}
      }
      return n;
    }

    function parseFrontMatter(text) {
      if (MP.parseFrontMatter) return MP.parseFrontMatter(text);
      const m = String(text || "").match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
      if (!m) return { title: "", category: "", tags: [], body: text };
      return { title: "", category: "", tags: [], body: m[2] };
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

    function themeVars() {
      const cs = getComputedStyle(document.documentElement);
      const g = (n, d) => (cs.getPropertyValue(n) || d).trim();
      return {
        bg: g("--bg-0", "#ffffff"),
        ink: g("--ink", "#1f2328"),
        line: g("--line", "#d0d7de"),
        accent: g("--accent", "#2ec4b6"),
        panel: g("--panel-strong", "#f6f8fa"),
        muted: g("--muted", "#57606a"),
      };
    }

    function buildToc(bodyHtml) {
      const heads = [...String(bodyHtml).matchAll(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi)];
      if (heads.length < 3) return "";
      return (
        `<nav class="toc"><strong>目录</strong><ul>` +
        heads
          .map((m) => `<li class="toc-l${m[1]}">${m[2].replace(/<[^>]+>/g, "").trim()}</li>`)
          .join("") +
        `</ul></nav>`
      );
    }

    function standaloneHtml(title, bodyHtml) {
      const v = themeVars();
      return `<!doctype html><html lang="zh"><head><meta charset="utf-8" /><title>${escapeHtml(title)}</title>
<style>
:root{color-scheme:${isDarkScheme() ? "dark" : "light"}}
body{max-width:820px;margin:2rem auto;padding:0 1rem;line-height:1.7;background:${v.bg};color:${v.ink};font-family:-apple-system,Segoe UI,Roboto,"PingFang SC","Microsoft YaHei",sans-serif}
pre{background:${v.panel};padding:.8rem;border-radius:8px;overflow:auto}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
pre code{background:none}
table{border-collapse:collapse}th,td{border:1px solid ${v.line};padding:.35rem .6rem}
img{max-width:100%}blockquote{border-left:3px solid ${v.line};margin:0;padding-left:1rem;color:${v.muted}}
a{color:${v.accent}}
.toc{border:1px solid ${v.line};border-radius:8px;padding:.6rem .9rem;margin-bottom:1.4rem}
.toc ul{margin:.35rem 0 0;padding-left:1.2rem}
.toc-l2{padding-left:.8rem}.toc-l3,.toc-l4,.toc-l5,.toc-l6{padding-left:1.6rem}
@media print{body{max-width:none;margin:0;padding:0}pre,table,blockquote,img{page-break-inside:avoid}h1,h2,h3{page-break-after:avoid}.toc{page-break-after:always}}
</style></head><body>${buildToc(bodyHtml)}${bodyHtml}</body></html>`;
    }

    async function exportItemsToZip(ids) {
      if (typeof window.JSZip !== "function") {
        setErr("ZIP 库未就绪，请稍后重试");
        return;
      }
      const zip = new window.JSZip();
      const usedNames = new Set();
      let n = 0;
      for (const id of ids) {
        const it = findItem(id);
        if (!it) continue;
        let text = state.bodyCache.get(id);
        if (text == null) {
          try {
            text = await readDocText(it);
            state.bodyCache.set(id, text);
          } catch (_) {
            text = "";
          }
        }
        let name = `${slugify(it.title)}.md`;
        let k = 2;
        while (usedNames.has(name)) name = `${slugify(it.title)}-${k++}.md`;
        usedNames.add(name);
        zip.file(name, text);
        for (const rel of collectReferencedAssets(text)) {
          try {
            zip.file(rel, await readAssetBlob(rel));
          } catch (_) {}
        }
        n += 1;
      }
      if (!n) {
        toast("没有可导出的文档");
        return;
      }
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, `markdown-${Date.now()}.zip`);
      toast(`已导出 ${n} 篇（含资源）`);
    }

    async function exportCurrent(fmt, target) {
      const item = target?.item || findItem(state.currentId);
      if (!item) return;
      const text = target && target.text != null ? target.text : getEditorText();
      const title = item.title || "document";
      const html = await inlineAssetsForExport(renderMarkdown(text));
      try {
        if (fmt === "md") {
          const mdText = buildFrontMatterBlock(item, text);
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
      state.bodyCache.clear();
      state.persistedIdx.clear();
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
      const total = (state.index.items || []).length;
      if (total > 3000 && els.dirLabel) els.dirLabel.textContent += ` · ${total} 篇（库较大，建议分库或筛选）`;
      [els.newBtn, els.importDirBtn].forEach((b) => b && (b.disabled = false));
      applyModeUI();
      [els.exportLib, els.importLib].forEach((b) => b && (b.disabled = false));
      els.importBtn && (els.importBtn.disabled = false);
      renderSidebar();
      updateSaveBtn();
      els.empty && (els.empty.hidden = Boolean(state.currentId));
      ensureEditor();
      ensureKatexCss();
      bindEditorMedia();
      bindEditorScroll();
      await loadSearchIdx();
      warmBodyCache();
      void autoExpireTrash();
      if (state.view && CMresize) CMresize();
      toast(`已连接：${label}`);
    }

    function CMresize() {
      try { state.view?.requestMeasure?.(); } catch (_) {}
    }

    // ---- events ----
    els.pickDir?.addEventListener("click", () => void pickDir());
    els.useIdb?.addEventListener("click", () => {
      if (state.mode === "idb") return;
      const ok = window.confirm(
        "切换到「浏览器本地存储」模式？\n\n文档会存在浏览器里（不写入文件夹），适合没有文件夹权限或想快速试用。可随时点「改用文件夹」切回。"
      );
      if (ok) void useIdbMode();
    });
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
    els.exportLib?.addEventListener("click", () => void exportLibrary());
    els.importLib?.addEventListener("click", () => els.importLibInput?.click());
    els.importLibInput?.addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      e.target.value = "";
      if (f) void importLibrary(f);
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
    els.tags?.addEventListener("contextmenu", (e) => {
      const b = e.target.closest?.("[data-tag]");
      if (!b) return;
      e.preventDefault();
      void manageTag(b.dataset.tag);
    });
    els.cats?.addEventListener("contextmenu", (e) => {
      const b = e.target.closest?.("[data-cat]");
      if (!b || b.dataset.cat === "all") return;
      e.preventDefault();
      void manageCat(b.dataset.cat);
    });
    els.list?.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      const items = [...els.list.querySelectorAll("[data-id]")];
      const cur = items.indexOf(document.activeElement);
      const next = e.key === "ArrowDown" ? cur + 1 : cur - 1;
      if (items[next]) {
        e.preventDefault();
        items[next].focus();
      }
    });
    if (els.sort) {
      els.sort.value = state.sort;
      els.sort.addEventListener("change", () => {
        state.sort = els.sort.value;
        try {
          localStorage.setItem("devtools-mdm-sort", state.sort);
        } catch (_) {}
        renderSidebar();
      });
    }
    els.list?.addEventListener("click", (e) => {
      const b = e.target.closest?.("[data-id]");
      if (!b) return;
      if (e.ctrlKey || e.metaKey) {
        const id = b.dataset.id;
        if (state.selected.has(id)) state.selected.delete(id);
        else state.selected.add(id);
        updateItemClasses();
        return;
      }
      void openDoc(b.dataset.id);
    });
    let dragId = "";
    els.list?.addEventListener("pointerdown", (e) => {
      state.dragFromHandle = Boolean(e.target.closest?.(".mdm-drag-handle"));
    });
    els.list?.addEventListener("dragstart", (e) => {
      const b = e.target.closest?.("[data-id]");
      if (!b) return;
      if (!state.dragFromHandle) {
        e.preventDefault();
        return;
      }
      dragId = b.dataset.id;
      b.classList.add("is-dragging");
      try {
        e.dataTransfer.setData("text/plain", dragId);
        e.dataTransfer.effectAllowed = "move";
      } catch (_) {}
    });
    els.list?.addEventListener("dragover", (e) => {
      if (!dragId) return;
      e.preventDefault();
      try { e.dataTransfer.dropEffect = "move"; } catch (_) {}
      const b = e.target.closest?.("[data-id]");
      els.list?.querySelectorAll(".is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
      if (b && b.dataset.id !== dragId) b.classList.add("is-drop-target");
    });
    els.list?.addEventListener("drop", (e) => {
      const b = e.target.closest?.("[data-id]");
      els.list?.querySelectorAll(".is-drop-target,.is-dragging").forEach((el) => el.classList.remove("is-drop-target", "is-dragging"));
      if (!b || !dragId) return;
      e.preventDefault();
      if (state.sort !== "order") {
        dragId = "";
        toast("拖拽排序仅在「自定义顺序」下可用");
        return;
      }
      const targetId = b.dataset.id;
      const from = dragId;
      dragId = "";
      if (targetId === from) return;
      reorderItem(from, targetId);
      saveIndexToStorage().then(() => renderSidebar());
    });
    els.list?.addEventListener("dragend", () => {
      dragId = "";
      els.list?.querySelectorAll(".is-drop-target,.is-dragging").forEach((el) => el.classList.remove("is-drop-target", "is-dragging"));
    });
    // 触屏拖拽排序（HTML5 DnD 在触屏无效）
    (function bindTouchReorder() {
      const list = els.list;
      if (!list) return;
      let touchId = "";
      let dragging = false;
      let startY = 0;
      list.addEventListener("pointerdown", (e) => {
        if (e.pointerType !== "touch" || state.sort !== "order") return;
        const b = e.target.closest?.("[data-id]");
        if (!b) return;
        touchId = b.dataset.id;
        startY = e.clientY;
      });
      list.addEventListener(
        "pointermove",
        (e) => {
          if (e.pointerType !== "touch" || !touchId) return;
          if (!dragging && Math.abs(e.clientY - startY) > 12) {
            dragging = true;
            els.list?.querySelector(`[data-id="${touchId}"]`)?.classList.add("is-dragging");
          }
          if (!dragging) return;
          e.preventDefault();
          const over = document.elementFromPoint(e.clientX, e.clientY)?.closest?.("[data-id]");
          els.list?.querySelectorAll(".is-drop-target").forEach((el) => el.classList.remove("is-drop-target"));
          if (over && over.dataset.id !== touchId) {
            over.classList.add("is-drop-target");
            reorderItem(touchId, over.dataset.id);
            renderList();
            els.list?.querySelector(`[data-id="${touchId}"]`)?.classList.add("is-dragging");
          }
        },
        { passive: false }
      );
      const end = () => {
        els.list?.querySelectorAll(".is-drop-target,.is-dragging").forEach((el) => el.classList.remove("is-drop-target", "is-dragging"));
        if (dragging) {
          saveIndexToStorage().then(() => renderSidebar());
        }
        touchId = "";
        dragging = false;
      };
      list.addEventListener("pointerup", end);
      list.addEventListener("pointercancel", end);
    })();
    els.listWrap?.addEventListener(
      "scroll",
      () => {
        if (listRaf) return;
        listRaf = window.requestAnimationFrame(() => {
          listRaf = 0;
          renderList();
        });
      },
      { passive: true }
    );
    els.batchbar?.addEventListener("click", async (e) => {
      const b = e.target.closest?.("[data-batch]");
      if (!b) return;
      const act = b.dataset.batch;
      const ids = [...state.selected];
      if (act === "clear") {
        state.selected.clear();
        updateItemClasses();
        return;
      }
      if (act === "all") {
        for (const it of filteredItems()) state.selected.add(it.id);
        updateItemClasses();
        return;
      }
      if (!ids.length) return;
      if (act === "tag") {
        const name = window.prompt("给选中文档添加标签：");
        if (!name) return;
        const tid = ensureTag(String(name).replace(/^#/, ""));
        for (const id of ids) {
          const it = findItem(id);
          if (it) {
            it.tagIds = it.tagIds || [];
            if (tid && !it.tagIds.includes(tid)) it.tagIds.push(tid);
          }
        }
        await saveIndexToStorage();
        renderSidebar();
        toast(`已给 ${ids.length} 篇加标签`);
        return;
      }
      if (act === "delete") {
        if (!window.confirm(`删除选中的 ${ids.length} 篇？（会移入回收站）`)) return;
        for (const id of ids) {
          const it = findItem(id);
          if (it) {
            let raw = "";
            try {
              raw = await readDocText(it);
            } catch (_) {}
            try {
              await trashDoc(it);
            } catch (_) {}
            state.lastDeleted = { item: { ...it }, raw };
            state.bodyCache.delete(id);
            state.persistedIdx.delete(id);
          }
        }
        const sel = new Set(ids);
        state.index.items = state.index.items.filter((x) => !sel.has(x.id));
        normalizeOrders();
        if (sel.has(state.currentId)) {
          state.currentId = "";
          setEditorText("");
          renderPreview();
          els.empty && (els.empty.hidden = false);
        }
        state.selected.clear();
        await saveIndexToStorage();
        renderSidebar();
        updateSaveBtn();
        toast(`已删除 ${ids.length} 篇`);
        return;
      }
      if (act === "cat") {
        const name = window.prompt("移动到分类（留空=未分类）：");
        if (name === null) return;
        const cid = name.trim() ? ensureCat(name) : "";
        for (const id of ids) {
          const it = findItem(id);
          if (it) it.catId = cid;
        }
        await saveIndexToStorage();
        renderSidebar();
        toast(`已移动 ${ids.length} 篇`);
        return;
      }
      if (act === "rename") {
        const pre = window.prompt("标题前缀（可留空）：", "");
        if (pre === null) return;
        const suf = window.prompt("标题后缀（可留空）：", "");
        if (suf === null) return;
        for (const id of ids) {
          const it = findItem(id);
          if (!it) continue;
          const nt = `${pre}${it.title}${suf}`;
          const oldName = it.fileName;
          it.title = nt;
          it.fileName = uniqueFileName(nt, it.id);
          it.titleSaved = nt;
          try {
            const t = await readDocText({ ...it, fileName: oldName }).catch(() => "");
            await writeDocText(it, t);
            if (oldName && oldName !== it.fileName) await removeDocFile({ ...it, fileName: oldName });
          } catch (_) {}
        }
        await saveIndexToStorage();
        renderSidebar();
        toast(`已重命名 ${ids.length} 篇`);
        return;
      }
      if (act === "export") {
        await exportItemsToZip(ids);
      }
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
    els.preview?.addEventListener("click", (e) => {
      const cb = e.target.closest?.("input.mdm-task-cb");
      if (cb) {
        e.preventDefault();
        toggleTaskCheckbox(cb);
        return;
      }
      const a = e.target.closest?.("a[data-mdm-open]");
      if (!a) return;
      e.preventDefault();
      void openDoc(a.dataset.mdmOpen);
    });
    els.backlinks?.addEventListener("click", (e) => {
      const b = e.target.closest?.("[data-backlink]");
      if (b) void openDoc(b.dataset.backlink);
    });
    let outlineRaf = 0;
    els.preview?.addEventListener(
      "scroll",
      () => {
        if (outlineRaf) return;
        outlineRaf = window.requestAnimationFrame(() => {
          outlineRaf = 0;
          syncOutlineActive();
        });
      },
      { passive: true }
    );
    els.list?.addEventListener("click", (e) => {
      const back = e.target.closest?.('[data-trash="back"]');
      if (back) {
        state.trashMode = false;
        renderSidebar();
        return;
      }
      const empty = e.target.closest?.('[data-trash="empty"]');
      if (empty) {
        if (window.confirm("清空回收站？不可恢复")) void emptyTrash();
        return;
      }
      const all = e.target.closest?.('[data-trash="restore-all"]');
      if (all) {
        void restoreAllTrash();
        return;
      }
      const restore = e.target.closest?.("[data-trash-restore]");
      if (restore) {
        void restoreTrash(restore.dataset.trashRestore);
        return;
      }
      const purge = e.target.closest?.("[data-trash-purge]");
      if (purge) {
        void purgeTrash(purge.dataset.trashPurge);
        return;
      }
      const hback = e.target.closest?.('[data-hist="back"]');
      if (hback) {
        state.historyMode = false;
        renderSidebar();
        return;
      }
      const hrestore = e.target.closest?.("[data-hist-restore]");
      if (hrestore) {
        void restoreHistory(state.historyItem, hrestore.dataset.histRestore);
      }
    });
    els.conflict?.addEventListener("click", async (e) => {
      const b = e.target.closest?.("[data-conflict]");
      if (!b) return;
      const item = state.conflictItem;
      if (els.conflict) els.conflict.hidden = true;
      state.conflictItem = null;
      if (!item) return;
      const act = b.dataset.conflict;
      try {
        if (act === "overwrite") {
          item.fileMtime = 0;
          await saveCurrent({ silent: true });
        } else if (act === "reload") {
          const text = await readDocText(item);
          setEditorText(text);
          state.dirty = false;
          updateSaveBtn();
          renderPreview();
          renderOutline();
          setSaveStatus("已重新加载外部版本");
        } else if (act === "copy") {
          const text = getEditorText();
          const title = `${item.title}（副本）`;
          const copy = { ...item, id: uid(), title, titleSaved: title, fileName: uniqueFileName(title, ""), fileMtime: 0, order: undefined };
          await writeDocText(copy, text);
          state.index.items.push(copy);
          normalizeOrders();
          await saveIndexToStorage();
          renderSidebar();
          setSaveStatus("已另存为副本");
        }
      } catch (err) {
        setErr(`处理冲突失败：${err.message || err}`);
      }
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
      if (kind === "rescan") {
        void rescanFolder();
        return;
      }
      if (kind === "trash") {
        void openTrash();
        return;
      }
      if (kind === "history") {
        void openHistory(findItem(state.currentId));
        return;
      }
      if (kind === "tableedit") {
        openTableEditor();
        return;
      }
      if (kind === "usage") {
        void showUsage();
        return;
      }
      if (kind === "checklinks") {
        void checkLinks();
        return;
      }
      if (kind === "warm") {
        const got = window.prompt("全文搜索预热上限（文档数；0 = 关闭预热）", String(state.warmCap));
        if (got == null) return;
        const n = Number(got);
        if (!Number.isFinite(n) || n < 0) {
          setErr("请输入 0 或正整数");
          return;
        }
        state.warmCap = n;
        try {
          localStorage.setItem("devtools-mdm-warmcap", String(n));
        } catch (_) {}
        toast(n === 0 ? "已关闭搜索预热" : `预热上限：${n} 篇`);
        if (n > 0) warmBodyCache();
        return;
      }
      if (kind === "help") {
        toast("Ctrl+S 保存 · Ctrl+B 加粗 · Ctrl+I 斜体 · Ctrl+K 链接 · Ctrl+Z 撤销 · 双击列表改名 · 右键列表更多");
        return;
      }
      if (kind === "keys") {
        const cur = state.keys;
        const b = window.prompt("加粗快捷键（如 Mod-b）：", cur.bold);
        if (b === null) return;
        const i = window.prompt("斜体快捷键（如 Mod-i）：", cur.italic);
        if (i === null) return;
        const l = window.prompt("链接快捷键（如 Mod-k）：", cur.link);
        if (l === null) return;
        state.keys = { bold: b.trim() || "Mod-b", italic: i.trim() || "Mod-i", link: l.trim() || "Mod-k" };
        try {
          localStorage.setItem("devtools-mdm-keys", JSON.stringify(state.keys));
        } catch (_) {}
        syncKeys();
        toast("快捷键已更新");
        return;
      }
      if (kind === "img-url") {
        const url = window.prompt("图片 URL：");
        if (url && state.view) state.view.dispatch(state.view.state.replaceSelection(`![](${url.trim()})`));
        return;
      }
      insertTemplate(kind);
    });
    if (els.imgCompress) {
      try {
        const v = localStorage.getItem("devtools-mdm-img-compress");
        if (v != null) els.imgCompress.checked = v === "1";
      } catch (_) {}
      els.imgCompress.addEventListener("change", () => {
        try {
          localStorage.setItem("devtools-mdm-img-compress", els.imgCompress.checked ? "1" : "0");
        } catch (_) {}
      });
    }
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

    // 错误边界：面板激活时的未处理异常给出可见提示，避免「静默失败」
    window.addEventListener("unhandledrejection", (e) => {
      const p = document.getElementById("mdm");
      if (!p || !p.classList.contains("is-workspace-active")) return;
      const msg = e?.reason?.message || String(e?.reason || "");
      if (msg) toast(`出错了：${msg}`);
    });
  });
})();
