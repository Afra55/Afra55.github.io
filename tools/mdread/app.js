(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const fileInput = $("#mr-file");
  const errEl = $("#mr-error");
  const layout = $("#mr-layout");
  const empty = $("#mr-empty");
  const emptyZone = $("#mr-empty-zone");
  const openBtn = $("#mr-open-btn");
  const pasteBtn = $("#mr-paste-btn");
  const titleEl = $("#mr-title");
  const previewEl = $("#mr-preview");
  const outlineBody = $("#mr-outline-body");

  const HANDOFF_KEY = "devtools-mdread-doc";
  const READ_THEME_KEY = "devtools-mdread-theme-v1";
  let currentName = "";
  let engine = null;
  let hasDoc = false;

  /** 长读专用三档（与工具站主题拆开）；默认纸张更护眼 */
  const READ_THEMES = {
    paper: {
      label: "纸张",
      scheme: "light",
      vars: {
        "--bg-0": "#FAF7F2",
        "--bg-1": "#F3EEE6",
        "--ink": "#292524",
        "--muted": "#78716C",
        "--line": "rgba(41, 37, 36, 0.14)",
        "--accent": "#B45309",
        "--accent-2": "#C08457",
        "--link": "#9A3412",
        "--link-hover": "#7C2D12",
        "--danger": "#B91C1C",
        "--panel": "rgba(255, 252, 248, 0.88)",
        "--panel-strong": "rgba(250, 247, 242, 0.97)",
        "--ok": "#15803D",
      },
    },
    sepia: {
      label: "羊皮纸",
      scheme: "light",
      vars: {
        "--bg-0": "#FBF0D9",
        "--bg-1": "#F3E4C4",
        "--ink": "#5F4B32",
        "--muted": "#8A7355",
        "--line": "rgba(95, 75, 50, 0.16)",
        "--accent": "#A16207",
        "--accent-2": "#CA8A04",
        "--link": "#92400E",
        "--link-hover": "#78350F",
        "--danger": "#B45309",
        "--panel": "rgba(255, 248, 230, 0.9)",
        "--panel-strong": "rgba(251, 240, 217, 0.97)",
        "--ok": "#3F6212",
      },
    },
    soft: {
      label: "柔和深色",
      scheme: "dark",
      vars: {
        "--bg-0": "#1C1917",
        "--bg-1": "#292524",
        "--ink": "#E7E5E4",
        "--muted": "#A8A29E",
        "--line": "rgba(231, 229, 228, 0.14)",
        "--accent": "#D6A06C",
        "--accent-2": "#E7B98A",
        "--link": "#F0C48A",
        "--link-hover": "#FDE68A",
        "--danger": "#F87171",
        "--panel": "rgba(28, 25, 23, 0.9)",
        "--panel-strong": "rgba(22, 19, 17, 0.97)",
        "--ok": "#4ADE80",
      },
    },
  };

  function getReadThemeId() {
    try {
      const id = String(localStorage.getItem(READ_THEME_KEY) || "").trim();
      if (READ_THEMES[id]) return id;
    } catch (_) {}
    return "paper";
  }

  const themeHint = document.getElementById("mr-theme-hint");
  const themeFab = document.getElementById("mr-theme-fab");
  const themePop = document.getElementById("mr-theme-pop");

  function applyReadTheme(id) {
    const key = READ_THEMES[id] ? id : "paper";
    const conf = READ_THEMES[key];
    const root = document.documentElement;
    root.dataset.readTheme = key;
    root.dataset.themeScheme = conf.scheme;
    root.style.colorScheme = conf.scheme;
    Object.entries(conf.vars).forEach(([k, v]) => root.style.setProperty(k, v));
    root.style.setProperty("--bg", conf.vars["--bg-0"]);
    root.style.setProperty("--err", conf.vars["--danger"]);
    root.style.setProperty("--theme-scheme", conf.scheme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", conf.vars["--bg-0"]);
    document.querySelectorAll("[data-read-theme]").forEach((btn) => {
      const on = btn.getAttribute("data-read-theme") === key;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
    if (themeHint) {
      themeHint.textContent = `当前：${conf.label} · 点另一档立刻换色并记住`;
    }
    try {
      localStorage.setItem(READ_THEME_KEY, key);
    } catch (_) {}
  }

  function bindThemeClicks(root) {
    root?.addEventListener("click", (e) => {
      const btn = e.target?.closest?.("[data-read-theme]");
      if (!btn || (root !== document && !root.contains(btn))) return;
      e.preventDefault();
      e.stopPropagation();
      applyReadTheme(btn.getAttribute("data-read-theme"));
      if (themePop && !themePop.hidden && root === themePop) {
        themePop.hidden = true;
        if (themeFab) themeFab.setAttribute("aria-expanded", "false");
      }
    });
  }

  applyReadTheme(getReadThemeId());
  bindThemeClicks(document.getElementById("mr-theme"));
  bindThemeClicks(document.getElementById("mr-outline-theme"));
  bindThemeClicks(themePop);

  themeFab?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!themePop) return;
    const open = themePop.hidden;
    themePop.hidden = !open;
    themeFab.setAttribute("aria-expanded", open ? "true" : "false");
  });
  document.addEventListener("click", (e) => {
    if (!themePop || themePop.hidden) return;
    if (e.target?.closest?.("#mr-theme-pop, #mr-theme-fab")) return;
    themePop.hidden = true;
    themeFab?.setAttribute("aria-expanded", "false");
  });

  window.addEventListener("storage", (e) => {
    if (e.key === READ_THEME_KEY && e.newValue && READ_THEMES[e.newValue]) {
      applyReadTheme(e.newValue);
    }
  });

  function setError(text) {
    if (!errEl) return;
    const msg = String(text || "").trim();
    errEl.hidden = !msg;
    errEl.textContent = msg;
  }

  function toast(_msg) {
    /* 专注阅读：不刷顶栏状态文案 */
  }

  function showDocUi(on) {
    hasDoc = Boolean(on);
    if (layout) layout.hidden = !on;
    if (empty) empty.hidden = on;
    document.body.classList.toggle("has-doc", on);
    if (themeFab) {
      themeFab.hidden = !on;
      if (!on) {
        themeFab.setAttribute("aria-expanded", "false");
        if (themePop) themePop.hidden = true;
      }
    } else if (themePop) {
      themePop.hidden = true;
    }
  }

  function pickFile() {
    try {
      if (typeof fileInput?.showPicker === "function") {
        fileInput.showPicker();
        return;
      }
    } catch (_) {}
    fileInput?.click();
  }

  async function ensureEngine() {
    if (engine) return engine;
    const API = window.DevToolsMdReadPreview;
    if (!API?.createPreview) throw new Error("预览模块未加载");
    engine = API.createPreview({
      preview: previewEl,
      outline: outlineBody,
      toast,
    });
    await engine.ready();
    return engine;
  }

  async function openText(text, name) {
    setError("");
    const src = String(text || "");
    if (!src.trim()) {
      setError("文件为空");
      return;
    }
    currentName = String(name || "document.md").replace(/^.*[\\/]/, "") || "document.md";
    document.title = `${currentName} · MD 阅读`;
    if (titleEl) titleEl.textContent = currentName.replace(/\.(md|markdown|txt)$/i, "") || currentName;
    showDocUi(true);
    try {
      const eng = await ensureEngine();
      await eng.render(src);
    } catch (err) {
      setError(err?.message || String(err));
      showDocUi(false);
    }
  }

  async function openFile(file) {
    if (!file) return;
    const name = file.name || "document.md";
    if (!/\.(md|markdown|txt)$/i.test(name) && !/^text\//i.test(file.type || "")) {
      setError("请选择 Markdown / 纯文本文件");
      return;
    }
    const text = await file.text();
    await openText(text, name);
  }

  fileInput?.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f) void openFile(f);
    try {
      fileInput.value = "";
    } catch (_) {}
  });

  function bindPick(el) {
    if (!el) return;
    el.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      pickFile();
    });
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        pickFile();
      }
    });
  }
  bindPick(emptyZone);
  bindPick(openBtn);

  async function pasteMarkdownText() {
    setError("");
    try {
      let text = "";
      if (navigator.clipboard?.readText) {
        text = await navigator.clipboard.readText();
      }
      if (!String(text || "").trim()) {
        setError("剪贴板没有文本，请先复制 Markdown 后再试");
        return;
      }
      await openText(text, "clipboard.md");
    } catch (err) {
      setError(err?.message || "无法读取剪贴板，可改用 Ctrl+V / ⌘V 直接粘贴");
    }
  }
  pasteBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    void pasteMarkdownText();
  });

  // 空页直接粘贴正文
  window.addEventListener("paste", (e) => {
    if (hasDoc) return;
    const text = e.clipboardData?.getData("text/plain");
    if (!String(text || "").trim()) return;
    e.preventDefault();
    void openText(text, "clipboard.md");
  });

  // 拖拽换文：有文无文都接；一次一篇
  ["dragenter", "dragover"].forEach((type) => {
    window.addEventListener(type, (e) => {
      e.preventDefault();
      document.body.classList.add("is-dragging");
    });
  });
  window.addEventListener("dragleave", (e) => {
    if (e.target === document.body || e.relatedTarget == null) {
      document.body.classList.remove("is-dragging");
    }
  });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    document.body.classList.remove("is-dragging");
    const f = [...(e.dataTransfer?.files || [])].find(
      (x) => /\.(md|markdown|txt)$/i.test(x.name) || /^text\//i.test(x.type || "")
    );
    if (!f) {
      setError("请拖入一个 .md / .txt 文件");
      return;
    }
    void openFile(f);
  });

  /**
   * MDM 交接：仅当 URL 带 ?handoff=1（或 from=mdm）才消费。
   * 工具站 / 桌面图标默认空页，绝不自动打开残留 localStorage 文档。
   */
  const HANDOFF_MAX_AGE_MS = 60 * 1000;
  const allowHandoff = (() => {
    try {
      const q = new URLSearchParams(location.search);
      return q.has("handoff") || q.get("from") === "mdm";
    } catch (_) {
      return false;
    }
  })();

  function clearHandoffStores() {
    try {
      localStorage.removeItem(HANDOFF_KEY);
    } catch (_) {}
    try {
      sessionStorage.removeItem(HANDOFF_KEY);
    } catch (_) {}
  }

  function takeHandoff() {
    if (!allowHandoff) {
      clearHandoffStores();
      return null;
    }
    const tryStore = (store) => {
      if (!store) return null;
      try {
        const raw = store.getItem(HANDOFF_KEY);
        if (!raw) return null;
        store.removeItem(HANDOFF_KEY);
        return raw;
      } catch (_) {
        return null;
      }
    };
    const raw = tryStore(localStorage) || tryStore(sessionStorage);
    if (!raw) return null;
    try {
      const data = JSON.parse(raw);
      if (data?.text == null) return null;
      const t = Number(data.t) || 0;
      if (!t || Date.now() - t > HANDOFF_MAX_AGE_MS) return null;
      return data;
    } catch (_) {
      return null;
    }
  }

  function consumeHandoff() {
    const handoff = takeHandoff();
    if (!handoff) return false;
    void openText(String(handoff.text), handoff.title ? `${handoff.title}.md` : "from-mdm.md");
    return true;
  }

  if (!allowHandoff) {
    clearHandoffStores();
  } else {
    consumeHandoff();
    window.addEventListener("storage", (e) => {
      if (e.key === HANDOFF_KEY && e.newValue) consumeHandoff();
    });
    let handoffPolls = 0;
    const handoffTimer = window.setInterval(() => {
      handoffPolls += 1;
      if (consumeHandoff() || handoffPolls >= 40 || hasDoc) {
        window.clearInterval(handoffTimer);
      }
    }, 120);
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();
