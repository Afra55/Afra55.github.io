(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const fileInput = $("#mr-file");
  const clearBtn = $("#mr-clear");
  const statusEl = $("#mr-status");
  const errEl = $("#mr-error");
  const layout = $("#mr-layout");
  const empty = $("#mr-empty");
  const titleEl = $("#mr-title");
  const previewEl = $("#mr-preview");
  const outlineBody = $("#mr-outline-body");
  const installCard = $("#mr-install");
  const installBtn = $("#mr-install-btn");
  const installHint = $("#mr-install-hint");

  const HANDOFF_KEY = "devtools-mdread-doc";
  let currentName = "";
  let deferredPrompt = null;
  let engine = null;

  function isStandalone() {
    try {
      if (window.matchMedia("(display-mode: standalone)").matches) return true;
      if (window.matchMedia("(display-mode: window-controls-overlay)").matches) return true;
    } catch (_) {}
    return window.navigator.standalone === true;
  }

  function setStatus(text) {
    if (statusEl) statusEl.textContent = text || "";
  }

  function setError(text) {
    if (!errEl) return;
    const msg = String(text || "").trim();
    errEl.hidden = !msg;
    errEl.textContent = msg;
  }

  function toast(msg) {
    setStatus(msg);
  }

  function showDocUi(on) {
    if (layout) layout.hidden = !on;
    if (empty) empty.hidden = on;
    if (clearBtn) clearBtn.hidden = !on;
  }

  async function ensureEngine() {
    if (engine) return engine;
    const API = window.DevToolsMdReadPreview;
    if (!API?.createPreview) throw new Error("预览模块未加载");
    setStatus("正在加载预览引擎…");
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
      setStatus(`正在渲染 ${currentName}…`);
      await eng.render(src);
      setStatus(`${currentName} · 专注预览（一次一个文件）`);
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

  function clearDoc() {
    currentName = "";
    document.title = "MD 阅读";
    engine?.clear?.();
    if (titleEl) titleEl.textContent = "未命名";
    if (fileInput) fileInput.value = "";
    showDocUi(false);
    setError("");
    setStatus("点「选择 MD」或把一个 .md 拖进本页 · 一次只预览一个文件");
  }

  fileInput?.addEventListener("change", () => {
    const f = fileInput.files?.[0];
    if (f) void openFile(f);
  });
  clearBtn?.addEventListener("click", () => clearDoc());

  // 拖拽：一次一个
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

  // MDM 右键 / 其它入口：sessionStorage 交接（只读一次）
  try {
    const raw = sessionStorage.getItem(HANDOFF_KEY);
    if (raw) {
      sessionStorage.removeItem(HANDOFF_KEY);
      const data = JSON.parse(raw);
      if (data?.text != null) {
        void openText(String(data.text), data.title ? `${data.title}.md` : "from-mdm.md");
      }
    }
  } catch (_) {}

  // 也可 ?name= 仅作标题占位；正文仍靠交接或选文件
  try {
    const q = new URLSearchParams(location.search);
    const n = q.get("name");
    if (n && titleEl && layout?.hidden) titleEl.textContent = n;
  } catch (_) {}

  // PWA 安装（仿扫码）
  function refreshInstallUi() {
    if (!installCard) return;
    if (isStandalone()) {
      installCard.hidden = true;
      return;
    }
    installCard.hidden = false;
    if (deferredPrompt && installBtn) {
      installBtn.hidden = false;
      if (installHint) {
        installHint.hidden = false;
        installHint.textContent = "可单独加到桌面，专注阅读 Markdown。";
      }
    } else if (installHint) {
      installBtn && (installBtn.hidden = true);
      installHint.hidden = false;
      const ua = navigator.userAgent || "";
      installHint.textContent = /iPhone|iPad|iPod/i.test(ua)
        ? "iOS：Safari 分享 → 添加到主屏幕"
        : "可用浏览器菜单「安装应用 / 添加到主屏幕」";
    }
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    refreshInstallUi();
  });
  installBtn?.addEventListener("click", async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    try {
      await deferredPrompt.userChoice;
    } catch (_) {}
    deferredPrompt = null;
    refreshInstallUi();
  });
  refreshInstallUi();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
})();
