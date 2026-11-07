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
  const READ_CUSTOM_KEY = "devtools-mdread-theme-custom-v1";
  let currentName = "";
  let engine = null;
  let hasDoc = false;

  /**
   * 护眼取向：偏低对比、少纯黑纯白、暖/中性纸感；默认纸张。
   * 三档常用 + 更多预置；custom 来自用户色板。
   */
  function packTheme(label, scheme, bg0, bg1, ink, muted, accent, link) {
    const isDark = scheme === "dark";
    return {
      label,
      scheme,
      vars: {
        "--bg-0": bg0,
        "--bg-1": bg1,
        "--ink": ink,
        "--muted": muted,
        "--line": isDark ? "rgba(231, 229, 228, 0.14)" : "rgba(41, 37, 36, 0.14)",
        "--accent": accent,
        "--accent-2": accent,
        "--link": link || accent,
        "--link-hover": link || accent,
        "--danger": isDark ? "#F87171" : "#B91C1C",
        "--panel": isDark ? "rgba(28, 25, 23, 0.9)" : "rgba(255, 252, 248, 0.88)",
        "--panel-strong": isDark ? "rgba(22, 19, 17, 0.97)" : "rgba(250, 247, 242, 0.97)",
        "--ok": isDark ? "#4ADE80" : "#15803D",
      },
    };
  }

  const READ_THEMES = {
    paper: packTheme("纸张", "light", "#FAF7F2", "#F3EEE6", "#292524", "#78716C", "#B45309", "#9A3412"),
    sepia: packTheme("羊皮纸", "light", "#FBF0D9", "#F3E4C4", "#5F4B32", "#8A7355", "#A16207", "#92400E"),
    soft: packTheme("柔和深色", "dark", "#1C1917", "#292524", "#E7E5E4", "#A8A29E", "#D6A06C", "#F0C48A"),
    ivory: packTheme("象牙", "light", "#F7F4EC", "#EFEBE0", "#2C2A26", "#7A756C", "#A16207", "#9A3412"),
    mist: packTheme("雾灰", "light", "#EEF2F6", "#E4EAF1", "#1F2937", "#64748B", "#0369A1", "#0C4A6E"),
    sage: packTheme("鼠尾草", "light", "#F2F5EF", "#E7EDE3", "#2F3A32", "#6B7A6E", "#4D7C5A", "#3F6B4A"),
    sand: packTheme("细沙", "light", "#F6F0E6", "#EDE4D4", "#3F3428", "#8A7A66", "#B45309", "#9A3412"),
    rose: packTheme("蔷薇纸", "light", "#F8F1F2", "#F0E4E7", "#3F2E32", "#8A6E74", "#BE185D", "#9D174D"),
    sky: packTheme("晴空", "light", "#F0F5FA", "#E4EDF6", "#243447", "#5B6B7C", "#2563EB", "#1D4ED8"),
    matcha: packTheme("抹茶", "light", "#F3F6EE", "#E8EEDF", "#2A3828", "#6A7A64", "#4D7C0F", "#3F6212"),
    slate: packTheme("岩灰", "dark", "#23272E", "#2C323C", "#E6E8EC", "#9AA3B2", "#93C5FD", "#BFDBFE"),
    night: packTheme("静夜", "dark", "#141820", "#1C2430", "#D8DEE9", "#94A3B8", "#7DD3FC", "#BAE6FD"),
    amber: packTheme("琥珀夜", "dark", "#1A1612", "#262019", "#E8DCC8", "#B8A890", "#F0C48A", "#FDE68A"),
    nord: packTheme("北境", "dark", "#2E3440", "#3B4252", "#ECEFF4", "#D8DEE9", "#88C0D0", "#8FBCBB"),
    graphite: packTheme("石墨", "dark", "#1E1E1E", "#2A2A2A", "#D4D4D4", "#A3A3A3", "#A3E635", "#BEF264"),
  };

  const QUICK_THEME_IDS = ["paper", "sepia", "soft"];

  function buildCustomTheme(bg, ink, scheme) {
    const isDark = scheme === "dark";
    const muted = isDark ? "#A8A29E" : "#78716C";
    const accent = isDark ? "#D6A06C" : "#B45309";
    const bg1 = isDark ? "#292524" : "#F3EEE6";
    return packTheme("自定义", isDark ? "dark" : "light", bg, bg1, ink, muted, accent, accent);
  }

  function loadCustomTheme() {
    try {
      const raw = localStorage.getItem(READ_CUSTOM_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      const bg = String(data?.bg || "").trim();
      const ink = String(data?.ink || "").trim();
      const scheme = data?.scheme === "dark" ? "dark" : "light";
      if (!/^#[0-9a-fA-F]{6}$/.test(bg) || !/^#[0-9a-fA-F]{6}$/.test(ink)) return null;
      return buildCustomTheme(bg, ink, scheme);
    } catch (_) {
      return null;
    }
  }

  function saveCustomTheme(bg, ink, scheme) {
    try {
      localStorage.setItem(READ_CUSTOM_KEY, JSON.stringify({ bg, ink, scheme }));
    } catch (_) {}
  }

  function resolveTheme(id) {
    if (id === "custom") {
      return loadCustomTheme() || READ_THEMES.paper;
    }
    return READ_THEMES[id] || READ_THEMES.paper;
  }

  function getReadThemeId() {
    try {
      const id = String(localStorage.getItem(READ_THEME_KEY) || "").trim();
      if (id === "custom" && loadCustomTheme()) return "custom";
      if (READ_THEMES[id]) return id;
    } catch (_) {}
    return "paper";
  }

  const themeHint = document.getElementById("mr-theme-hint");
  const themeModal = document.getElementById("mr-theme-modal");
  const themeModalGrid = document.getElementById("mr-theme-modal-grid");
  const customBg = document.getElementById("mr-custom-bg");
  const customInk = document.getElementById("mr-custom-ink");
  const customScheme = document.getElementById("mr-custom-scheme");

  function applyReadTheme(id) {
    const key = id === "custom" || READ_THEMES[id] ? id : "paper";
    const conf = resolveTheme(key);
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
    document.querySelectorAll("#mr-theme [data-read-theme]").forEach((btn) => {
      const on = btn.getAttribute("data-read-theme") === key;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
    themeModalGrid?.querySelectorAll("[data-read-theme]").forEach((btn) => {
      const on = btn.getAttribute("data-read-theme") === key;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (themeHint) {
      themeHint.textContent = `当前：${conf.label} · 可点「更多配色」或大纲底部切换`;
    }
    try {
      localStorage.setItem(READ_THEME_KEY, key);
    } catch (_) {}
  }

  function paintThemeModalGrid() {
    if (!themeModalGrid) return;
    const current = getReadThemeId();
    const ids = Object.keys(READ_THEMES);
    const custom = loadCustomTheme();
    const parts = ids.map((id) => {
      const t = READ_THEMES[id];
      const on = current === id;
      return `<button type="button" class="theme-preset-chip${on ? " is-active" : ""}" data-read-theme="${id}" role="option" aria-selected="${on ? "true" : "false"}" title="${t.label}">
        <span class="theme-preset-swatch" style="background:${t.vars["--bg-0"]};color:${t.vars["--ink"]}">Aa</span>
        <span class="theme-preset-name">${t.label}</span>
      </button>`;
    });
    if (custom) {
      const on = current === "custom";
      parts.push(`<button type="button" class="theme-preset-chip${on ? " is-active" : ""}" data-read-theme="custom" role="option" aria-selected="${on ? "true" : "false"}" title="自定义">
        <span class="theme-preset-swatch" style="background:${custom.vars["--bg-0"]};color:${custom.vars["--ink"]}">Aa</span>
        <span class="theme-preset-name">自定义</span>
      </button>`);
    }
    themeModalGrid.innerHTML = parts.join("");
  }

  function openThemeModal() {
    if (!themeModal) return;
    const cur = resolveTheme(getReadThemeId());
    if (customBg) customBg.value = cur.vars["--bg-0"].slice(0, 7);
    if (customInk) customInk.value = cur.vars["--ink"].slice(0, 7);
    if (customScheme) customScheme.value = cur.scheme === "dark" ? "dark" : "light";
    paintThemeModalGrid();
    themeModal.hidden = false;
    document.body.classList.add("theme-modal-open");
  }

  function closeThemeModal() {
    if (!themeModal) return;
    themeModal.hidden = true;
    document.body.classList.remove("theme-modal-open");
  }

  applyReadTheme(getReadThemeId());

  document.getElementById("mr-theme")?.addEventListener("click", (e) => {
    const more = e.target?.closest?.("#mr-theme-more");
    if (more) {
      e.preventDefault();
      openThemeModal();
      return;
    }
    const btn = e.target?.closest?.("[data-read-theme]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    applyReadTheme(btn.getAttribute("data-read-theme"));
  });

  document.getElementById("mr-outline-theme-btn")?.addEventListener("click", (e) => {
    e.preventDefault();
    openThemeModal();
  });

  themeModal?.addEventListener("click", (e) => {
    if (e.target?.closest?.("[data-theme-modal-close]")) {
      e.preventDefault();
      closeThemeModal();
      return;
    }
    const chip = e.target?.closest?.("[data-read-theme]");
    if (chip && themeModalGrid?.contains(chip)) {
      e.preventDefault();
      applyReadTheme(chip.getAttribute("data-read-theme"));
      closeThemeModal();
    }
  });

  document.getElementById("mr-custom-apply")?.addEventListener("click", (e) => {
    e.preventDefault();
    const bg = String(customBg?.value || "#FAF7F2");
    const ink = String(customInk?.value || "#292524");
    const scheme = customScheme?.value === "dark" ? "dark" : "light";
    saveCustomTheme(bg, ink, scheme);
    applyReadTheme("custom");
    paintThemeModalGrid();
    closeThemeModal();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && themeModal && !themeModal.hidden) {
      closeThemeModal();
    }
  });

  window.addEventListener("storage", (e) => {
    if (e.key === READ_THEME_KEY && e.newValue) {
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
    if (!on) closeThemeModal();
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

  window.addEventListener("paste", (e) => {
    if (hasDoc) return;
    const text = e.clipboardData?.getData("text/plain");
    if (!String(text || "").trim()) return;
    e.preventDefault();
    void openText(text, "clipboard.md");
  });

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

  // 供测试 / 调试读取
  window.DevToolsMdReadThemes = {
    list: () => Object.keys(READ_THEMES),
    quick: () => QUICK_THEME_IDS.slice(),
    openModal: openThemeModal,
  };
})();
