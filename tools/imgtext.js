(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const panel = $("#imgtext");
  if (!panel) return;

  const state = {
    blob: null,
    url: "",
    worker: null,
    busy: false,
  };

  function toast(msg) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.classList.add("is-show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.classList.remove("is-show");
      setTimeout(() => {
        el.hidden = true;
      }, 200);
    }, 1800);
  }

  function setError(msg) {
    const el = $("#imgtext-error");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }

  function setProgress(visible, ratio, text) {
    const box = $("#imgtext-progress");
    const fill = $("#imgtext-progress-fill");
    const pct = $("#imgtext-progress-pct");
    const title = $("#imgtext-progress-text");
    if (!box) return;
    box.hidden = !visible;
    const p = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
    if (fill) fill.style.width = `${p}%`;
    if (pct) pct.textContent = `${p}%`;
    if (title) title.textContent = text || `${p}%`;
  }

  function revoke() {
    if (state.url) {
      try {
        URL.revokeObjectURL(state.url);
      } catch (_) {}
    }
    state.url = "";
  }

  function setImage(blob, name) {
    if (!blob) return;
    revoke();
    state.blob = blob;
    state.url = URL.createObjectURL(blob);
    const img = $("#imgtext-preview");
    const meta = $("#imgtext-meta");
    if (img) {
      img.hidden = false;
      img.src = state.url;
    }
    if (meta) meta.textContent = `${name || blob.name || "image"} · ${(blob.size / 1024).toFixed(1)} KB · ${blob.type || "image/*"}`;
    setError("");
  }

  async function loadTesseract() {
    if (window.Tesseract) return window.Tesseract;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error("无法加载 Tesseract.js（需网络）"));
      document.head.appendChild(s);
    });
    if (!window.Tesseract) throw new Error("Tesseract 加载失败");
    return window.Tesseract;
  }

  async function runOcr() {
    if (state.busy) {
      toast("正在识别中");
      return;
    }
    if (!state.blob) {
      setError("请先选择或粘贴图片");
      return;
    }
    state.busy = true;
    setError("");
    const lang = $("#imgtext-lang")?.value || "chi_sim+eng";
    setProgress(true, 0.05, "加载识别引擎…");
    try {
      const Tesseract = await loadTesseract();
      setProgress(true, 0.15, "识别中…首次会下载语言包");
      const result = await Tesseract.recognize(state.blob, lang, {
        logger: (m) => {
          if (m.status === "recognizing text") {
            setProgress(true, 0.2 + (m.progress || 0) * 0.75, `识别中… ${Math.round((m.progress || 0) * 100)}%`);
          } else if (m.status) {
            setProgress(true, 0.12, m.status);
          }
        },
      });
      const text = String(result?.data?.text || "").trim();
      const out = $("#imgtext-out");
      if (out) out.value = text || "";
      setProgress(false, 0, "");
      toast(text ? "识别完成" : "未识别到文字");
    } catch (err) {
      setProgress(false, 0, "");
      setError(err.message || String(err));
    } finally {
      state.busy = false;
    }
  }

  async function copyOut() {
    const text = $("#imgtext-out")?.value || "";
    if (!text.trim()) {
      toast("没有可复制的文字");
      return;
    }
    await navigator.clipboard.writeText(text);
    toast("已复制文字");
  }

  async function saveToMemo() {
    const text = String($("#imgtext-out")?.value || "").trim();
    if (!text) {
      setError("没有可保存的文字");
      return;
    }
    if (!window.DevToolsMemo?.ingestText) {
      setError("备忘录未就绪，请先打开过备忘录工具");
      return;
    }
    await window.DevToolsMemo.ingestText(text);
    toast("已保存到备忘录");
  }

  async function consumeHandoff() {
    const handoff = window.__devtoolsImgtextHandoff;
    if (handoff?.blob) {
      window.__devtoolsImgtextHandoff = null;
      setImage(handoff.blob, handoff.name || "memo-image");
      return;
    }
    try {
      const flag = sessionStorage.getItem("devtools-imgtext-pending");
      if (!flag) return;
      sessionStorage.removeItem("devtools-imgtext-pending");
    } catch (_) {}
  }

  function bind() {
    $("#imgtext-file")?.addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      if (f) setImage(f, f.name);
      e.target.value = "";
    });
    $("#imgtext-clear")?.addEventListener("click", () => {
      revoke();
      state.blob = null;
      const img = $("#imgtext-preview");
      if (img) {
        img.removeAttribute("src");
        img.hidden = true;
      }
      const meta = $("#imgtext-meta");
      if (meta) meta.textContent = "未选择图片";
      const out = $("#imgtext-out");
      if (out) out.value = "";
    });
    $("#imgtext-run")?.addEventListener("click", () => runOcr());
    $("#imgtext-copy")?.addEventListener("click", () => copyOut().catch((e) => setError(e.message || String(e))));
    $("#imgtext-to-memo")?.addEventListener("click", () => saveToMemo().catch((e) => setError(e.message || String(e))));
    $("#imgtext-drop")?.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.currentTarget.classList.add("is-drag");
    });
    $("#imgtext-drop")?.addEventListener("dragleave", (e) => e.currentTarget.classList.remove("is-drag"));
    $("#imgtext-drop")?.addEventListener("drop", (e) => {
      e.preventDefault();
      e.currentTarget.classList.remove("is-drag");
      const f = e.dataTransfer?.files?.[0];
      if (f && String(f.type || "").startsWith("image/")) setImage(f, f.name);
    });
    document.addEventListener(
      "paste",
      (e) => {
        if (!panel.classList.contains("is-workspace-active")) return;
        const items = [...(e.clipboardData?.items || [])];
        const img = items.find((it) => it.kind === "file" && String(it.type || "").startsWith("image/"));
        if (!img) return;
        const f = img.getAsFile();
        if (f) {
          e.preventDefault();
          setImage(f, f.name || "paste.png");
        }
      },
      true
    );
    window.addEventListener("hashchange", () => consumeHandoff());
    consumeHandoff();
  }

  window.DevToolsImgText = {
    openWithBlob(blob, name) {
      window.__devtoolsImgtextHandoff = { blob, name: name || "image" };
      try {
        sessionStorage.setItem("devtools-imgtext-pending", "1");
      } catch (_) {}
      location.hash = "imgtext";
    },
    setImage,
  };

  bind();
})();
