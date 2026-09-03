(() => {
  "use strict";

  const CDN = "https://cdn.jsdelivr.net/npm/mathlive@0.110.0/mathlive.min.mjs";
  let loading = null;
  let bound = false;

  function $(sel) {
    return document.querySelector(sel);
  }

  function setErr(msg) {
    const el = $("#math-error");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }

  async function ensureMathLive() {
    if (customElements.get("math-field")) return;
    if (loading) return loading;
    const status = $("#math-status");
    if (status) status.textContent = "正在加载 MathLive…";
    loading = import(/* webpackIgnore: true */ CDN)
      .then(async (mod) => {
        if (mod?.MathfieldElement && !customElements.get("math-field")) {
          customElements.define("math-field", mod.MathfieldElement);
        }
        await customElements.whenDefined("math-field").catch(() => {});
        if (status) status.textContent = "MathLive 已就绪。";
      })
      .catch((err) => {
        loading = null;
        throw err;
      });
    return loading;
  }

  function syncOut() {
    const mf = $("#math-field");
    const out = $("#math-latex-out");
    if (!mf || !out) return;
    try {
      out.value = typeof mf.getValue === "function" ? mf.getValue("latex") : mf.value || "";
    } catch (_) {
      out.value = mf.value || "";
    }
  }

  async function copyFmt(fmt) {
    const mf = $("#math-field");
    if (!mf) return;
    let text = "";
    try {
      text = typeof mf.getValue === "function" ? mf.getValue(fmt) : mf.value || "";
    } catch (err) {
      setErr(`导出失败：${err.message || err}`);
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      window.DevToolsApp?.showToast?.(`已复制 ${fmt}`);
    } catch (_) {
      setErr("复制失败，请手动选择文本复制");
    }
  }

  async function bind() {
    if (bound) {
      ensureMathLive().then(syncOut).catch((e) => setErr(e.message || String(e)));
      return;
    }
    if (!$("#mathedit")) return;
    bound = true;
    try {
      await ensureMathLive();
      setErr("");
    } catch (err) {
      setErr(`加载失败：${err.message || err}（需可访问 jsDelivr）`);
      return;
    }
    const mf = $("#math-field");
    mf?.addEventListener("input", syncOut);
    try {
      if (mf) mf.mathVirtualKeyboardPolicy = "auto";
    } catch (_) {}
    $("#math-copy-latex")?.addEventListener("click", () => copyFmt("latex"));
    $("#math-copy-mathml")?.addEventListener("click", () => copyFmt("math-ml"));
    $("#math-copy-ascii")?.addEventListener("click", () => copyFmt("ascii-math"));
    $("#math-clear")?.addEventListener("click", () => {
      if (!mf) return;
      if (typeof mf.executeCommand === "function") mf.executeCommand("deleteAll");
      else mf.value = "";
      syncOut();
    });
    syncOut();
  }

  bind().catch(() => {});
  document.addEventListener("devtools:route", (e) => {
    if (e.detail?.tool === "mathedit") bind().catch(() => {});
  });
})();
