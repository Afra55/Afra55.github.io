(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const fileInput = $("#mr-file");
  const errEl = $("#mr-error");
  const layout = $("#mr-layout");
  const empty = $("#mr-empty");
  const titleEl = $("#mr-title");
  const previewEl = $("#mr-preview");
  const outlineBody = $("#mr-outline-body");

  const HANDOFF_KEY = "devtools-mdread-doc";
  const THEME_STATE_KEY = "devtools-theme-v1";
  const THEME_VARS_KEY = "devtools-theme-vars-v1";
  let currentName = "";
  let engine = null;
  let hasDoc = false;

  /** 与 tools/theme.js 同步：阅读页正文色跟 MDM 预览同一套变量 */
  function applyThemeVars(vars) {
    if (!vars || typeof vars !== "object") return;
    const root = document.documentElement;
    Object.entries(vars).forEach(([k, v]) => {
      if (k.startsWith("--") && v != null && String(v).trim() !== "") {
        root.style.setProperty(k, String(v));
      }
    });
    const scheme = vars["--theme-scheme"] || "dark";
    root.dataset.themeScheme = scheme;
    root.style.setProperty("--bg", vars["--bg-0"] || "");
    root.style.setProperty("--err", vars["--danger"] || "");
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta && vars["--bg-0"]) meta.setAttribute("content", String(vars["--bg-0"]).trim());
  }

  function syncThemeFromTools() {
    // 1) theme.js 落盘的完整变量（含自定义推导）
    try {
      const raw = localStorage.getItem(THEME_VARS_KEY);
      if (raw) {
        const vars = JSON.parse(raw);
        if (vars && typeof vars === "object" && vars["--bg-0"]) {
          applyThemeVars(vars);
          return;
        }
      }
    } catch (_) {}
    // 2) 从预设 id 重建（未跑过 theme.js 时）
    try {
      const presets = window.DevToolsThemePresets || [];
      const byId = (id) => presets.find((p) => p.id === id) || presets[0];
      let state = { preset: "default", useCustom: false, custom: {} };
      try {
        const raw = localStorage.getItem(THEME_STATE_KEY);
        if (raw) state = { ...state, ...JSON.parse(raw) };
      } catch (_) {}
      const legacy = { sage: "pine", dusk: "ink", charcoal: "graphite", fog: "paper", sepia: "sky" };
      if (legacy[state.preset]) state.preset = legacy[state.preset];
      let vars;
      if (state.useCustom && state.custom && typeof state.custom === "object") {
        vars = { ...(byId("default")?.vars || {}), ...state.custom };
      } else {
        vars = { ...(byId(state.preset)?.vars || {}) };
      }
      if (vars["--bg-0"]) applyThemeVars(vars);
    } catch (_) {}
  }

  syncThemeFromTools();
  window.addEventListener("storage", (e) => {
    if (e.key === THEME_VARS_KEY || e.key === THEME_STATE_KEY) syncThemeFromTools();
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

  // 空态：点击 / 回车选文件
  empty?.addEventListener("click", (e) => {
    e.preventDefault();
    pickFile();
  });
  empty?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pickFile();
    }
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
   * MDM 右键交接：优先 localStorage（noopener 新标签也能读），再 sessionStorage。
   * 读一次即删，避免刷新重复打开旧文。
   */
  function takeHandoff() {
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

  consumeHandoff();

  // MDM 慢路径：先开本窗再写 localStorage → 用 storage 事件灌入（同页写入不触发，故另轮询）
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

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();
