(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const panel = $("#textimg");
  if (!panel) return;

  const TI_THEMES = {
    solid: null,
    sunset: "linear-gradient(135deg, #ff7e5f 0%, #feb47b 45%, #ff6a88 100%)",
    ocean: "linear-gradient(145deg, #0b3d5c 0%, #1b6ca8 45%, #2ec4b6 100%)",
    aurora: "linear-gradient(135deg, #0f2027 0%, #203a43 35%, #2c5364 60%, #00d2ff 100%)",
    neon: "linear-gradient(135deg, #1a0533 0%, #6a11cb 50%, #2575fc 100%)",
    ink: "linear-gradient(160deg, #0b1220 0%, #1a2338 55%, #2a354f 100%)",
    paper: "linear-gradient(180deg, #f7f1e5 0%, #efe2cb 100%)",
    mesh: "radial-gradient(circle at 20% 20%, rgba(46,196,182,.55), transparent 40%), radial-gradient(circle at 80% 10%, rgba(244,162,97,.45), transparent 42%), radial-gradient(circle at 50% 80%, rgba(99,102,241,.4), transparent 45%), linear-gradient(160deg, #10182a, #0b1220)",
    spring: "linear-gradient(135deg, #5ee7df 0%, #b490ca 50%, #fbc2eb 100%)",
    ray: "radial-gradient(120% 80% at 10% 10%, #3b82f6 0%, transparent 45%), radial-gradient(100% 70% at 90% 20%, #ec4899 0%, transparent 40%), linear-gradient(160deg, #0b1020, #111827)",
    image: null,
  };

  const TI_CODE_THEME = {
    carbon: { bg: "#151718", fg: "#e6edf3", muted: "#8b949e" },
    dracula: { bg: "#282a36", fg: "#f8f8f2", muted: "#6272a4" },
    monokai: { bg: "#272822", fg: "#f8f8f2", muted: "#75715e" },
    nord: { bg: "#2e3440", fg: "#eceff4", muted: "#81a1c1" },
    github: { bg: "#ffffff", fg: "#24292f", muted: "#656d76" },
    "one-dark": { bg: "#282c34", fg: "#abb2bf", muted: "#5c6370" },
  };

  const TI_RATIO = {
    "1:1": { w: 720, h: 720 },
    "3:4": { w: 720, h: 960 },
    "4:3": { w: 840, h: 630 },
    "16:9": { w: 960, h: 540 },
    "9:16": { w: 540, h: 960 },
  };

  const state = { bgUrl: "", bgBlob: null };

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

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function clamp(n, min, max, fallback) {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.max(min, Math.min(max, Math.round(v)));
  }

  function applyRatio(ratio) {
    const dim = TI_RATIO[ratio];
    if (!dim) return;
    const wEl = $("#ti-w");
    const hEl = $("#ti-h");
    if (wEl) wEl.value = String(dim.w);
    if (hEl) hEl.value = String(dim.h);
  }

  function matchRatio(w, h) {
    return Object.keys(TI_RATIO).find((k) => TI_RATIO[k].w === w && TI_RATIO[k].h === h) || "custom";
  }

  function readSize() {
    const ratio = $("#ti-ratio")?.value || "1:1";
    if (ratio !== "custom" && TI_RATIO[ratio]) return { ...TI_RATIO[ratio], ratio };
    return {
      w: clamp($("#ti-w")?.value, 240, 2000, 720),
      h: clamp($("#ti-h")?.value, 240, 2400, 720),
      ratio: "custom",
    };
  }

  function inlineMd(s) {
    let t = escapeHtml(s);
    t = t.replace(/`([^`]+)`/g, "<code>$1</code>");
    t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    t = t.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    return t;
  }

  function renderLiteMarkdown(src) {
    const lines = String(src || "").replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let inCode = false;
    let codeBuf = [];
    let listType = "";
    const flushList = () => {
      if (!listType) return;
      out.push(listType === "ol" ? "</ol>" : "</ul>");
      listType = "";
    };
    for (const line of lines) {
      if (/^```/.test(line)) {
        if (inCode) {
          out.push(`<pre class="memo-ti-md-code"><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
          codeBuf = [];
          inCode = false;
        } else {
          flushList();
          inCode = true;
        }
        continue;
      }
      if (inCode) {
        codeBuf.push(line);
        continue;
      }
      if (/^\s*$/.test(line)) {
        flushList();
        continue;
      }
      const h = /^(#{1,3})\s+(.+)$/.exec(line);
      if (h) {
        flushList();
        out.push(`<h${h[1].length} class="memo-ti-md-h">${inlineMd(h[2])}</h${h[1].length}>`);
        continue;
      }
      if (/^>\s?/.test(line)) {
        flushList();
        out.push(`<blockquote class="memo-ti-md-quote">${inlineMd(line.replace(/^>\s?/, ""))}</blockquote>`);
        continue;
      }
      if (/^[-*]\s+/.test(line)) {
        if (listType !== "ul") {
          flushList();
          listType = "ul";
          out.push('<ul class="memo-ti-md-list">');
        }
        out.push(`<li>${inlineMd(line.replace(/^[-*]\s+/, ""))}</li>`);
        continue;
      }
      flushList();
      out.push(`<p class="memo-ti-md-p">${inlineMd(line)}</p>`);
    }
    if (inCode) out.push(`<pre class="memo-ti-md-code"><code>${escapeHtml(codeBuf.join("\n"))}</code></pre>`);
    flushList();
    return out.join("");
  }

  function fitPreview() {
    const wrap = $("#ti-preview-wrap");
    const stage = $("#ti-stage");
    const box = $("#ti-scale-box");
    if (!wrap || !stage || !box) return;
    const { w, h } = readSize();
    const availW = Math.max(120, wrap.clientWidth - 32);
    const availH = Math.max(120, Math.min(520, window.innerHeight * 0.42));
    const scale = Math.min(1, availW / w, availH / h);
    box.style.width = `${w}px`;
    box.style.height = `${h}px`;
    box.style.transform = `scale(${scale})`;
    stage.style.width = `${Math.round(w * scale)}px`;
    stage.style.height = `${Math.round(h * scale)}px`;
  }

  function paint() {
    const card = $("#ti-card");
    if (!card) return;
    const raw = $("#ti-src")?.value || "";
    const text = raw.trim() ? raw : "在此输入文字…";
    const mode = $("#ti-mode")?.value || "quote";
    let tpl = $("#ti-tpl")?.value || "default";
    const theme = $("#ti-theme")?.value || "sunset";
    const align = $("#ti-align")?.value || "center";
    const size = Number($("#ti-size")?.value) || 30;
    const lh = Number($("#ti-lh")?.value) || 1.45;
    const pad = Number($("#ti-pad")?.value) || 40;
    const winPad = Math.max(0, Number($("#ti-winpad")?.value) || 0);
    const radius = Number($("#ti-radius")?.value) || 20;
    const bg = $("#ti-bg")?.value || "#0f172a";
    const fg = $("#ti-fg")?.value || "#e8eef8";
    const overlay = Math.max(0, Math.min(85, Number($("#ti-overlay")?.value) || 0));
    const header = String($("#ti-header")?.value || "").trim();
    const footer = String($("#ti-footer")?.value || "").trim();
    const fname = String($("#ti-fname")?.value || "").trim() || (mode === "code" ? "snippet.js" : "note");
    const sign = String($("#ti-sign")?.value || "").trim();
    const wm = String($("#ti-wm")?.value || "").trim();
    const showLines = Boolean($("#ti-lines")?.checked);
    const wantWindow = Boolean($("#ti-window")?.checked) || mode === "code" || tpl === "carbon" || tpl === "terminal";
    const codeTheme = TI_CODE_THEME[$("#ti-code-theme")?.value || "carbon"] || TI_CODE_THEME.carbon;
    const { w, h } = readSize();
    const dim = $("#ti-dim");
    if (dim) dim.textContent = `${w}×${h}`;
    if (mode === "code" && tpl === "default") tpl = "carbon";
    const paperFg = theme === "paper" ? "#2a2118" : fg;
    const useImg = theme === "image" && state.bgUrl;
    const grad = TI_THEMES[theme];

    card.className = `memo-ti-card memo-ti-tpl-${tpl} memo-ti-mode-${mode}${wantWindow ? " is-windowed" : ""}`;
    card.style.width = `${w}px`;
    card.style.height = `${h}px`;
    card.style.padding = `${Math.max(winPad, wantWindow ? winPad || 48 : pad)}px`;
    card.style.borderRadius = `${radius}px`;
    card.style.color = paperFg;
    card.style.fontSize = `${size}px`;
    card.style.lineHeight = String(lh);
    card.style.textAlign = mode === "code" ? "left" : align;
    card.style.backgroundColor = theme === "solid" || !grad ? bg : "transparent";
    card.style.backgroundImage = useImg
      ? `linear-gradient(rgba(8,12,20,${overlay / 100}), rgba(8,12,20,${overlay / 100})), url(${state.bgUrl})`
      : grad || "none";
    card.style.backgroundSize = "cover";
    card.style.backgroundPosition = "center";
    card.style.fontFamily =
      mode === "code"
        ? "var(--mono)"
        : mode === "quote" || mode === "title"
          ? '"Noto Serif SC", "Songti SC", serif'
          : "var(--font)";

    let bodyInner = "";
    if (mode === "code") {
      bodyInner = `<pre class="memo-ti-code ${showLines ? "has-lines" : ""}">${String(text)
        .split("\n")
        .map((l, idx) => {
          const num = showLines ? `<span class="memo-ti-ln">${idx + 1}</span>` : "";
          return `<div class="memo-ti-code-line">${num}<span class="memo-ti-code-text">${escapeHtml(l || " ")}</span></div>`;
        })
        .join("")}</pre>`;
    } else if (mode === "markdown") {
      bodyInner = `<div class="memo-ti-md">${renderLiteMarkdown(text)}</div>`;
    } else {
      bodyInner = `<div class="memo-ti-lines">${String(text)
        .split("\n")
        .map((l) => `<div>${escapeHtml(l || " ")}</div>`)
        .join("")}</div>`;
    }

    const chrome = wantWindow
      ? `<div class="memo-ti-chrome"><div class="memo-ti-traffic" aria-hidden="true"><span></span><span></span><span></span></div><div class="memo-ti-fname mono">${escapeHtml(fname)}</div></div>`
      : tpl === "quote"
        ? `<div class="memo-ti-quote-mark" aria-hidden="true">“</div>`
        : "";
    const winStyle = mode === "code" ? `background:${codeTheme.bg};color:${codeTheme.fg};--memo-ti-muted:${codeTheme.muted}` : "";

    card.innerHTML = `
      ${header || tpl === "poster" ? `<div class="memo-ti-header">${escapeHtml(header || "Text Poster")}</div>` : ""}
      <div class="memo-ti-window" style="${winStyle}">
        ${chrome}
        <div class="memo-ti-body" style="padding:${wantWindow ? Math.max(12, Math.round(pad * 0.55)) : pad}px">${bodyInner}</div>
        ${sign ? `<div class="memo-ti-sign">${escapeHtml(sign)}</div>` : ""}
      </div>
      ${footer || tpl === "poster" ? `<div class="memo-ti-footer">${escapeHtml(footer || "DevTools TextImg")}</div>` : ""}
      ${wm ? `<div class="memo-ti-wm">${escapeHtml(wm)}</div>` : ""}
    `;
    requestAnimationFrame(fitPreview);
  }

  async function renderBlob() {
    const card = $("#ti-card");
    if (!card) throw new Error("预览未就绪");
    if (typeof html2canvas !== "function") throw new Error("html2canvas 未加载");
    paint();
    const scale = Math.max(1, Math.min(3, Number($("#ti-scale")?.value) || 2));
    const box = $("#ti-scale-box");
    const stage = $("#ti-stage");
    const prevT = box?.style.transform || "";
    const { w, h } = readSize();
    if (box) {
      box.style.transform = "none";
      box.style.width = `${w}px`;
      box.style.height = `${h}px`;
    }
    if (stage) {
      stage.style.width = `${w}px`;
      stage.style.height = `${h}px`;
    }
    try {
      const canvas = await html2canvas(card, { backgroundColor: null, scale, useCORS: true, width: w, height: h });
      const blob = await new Promise((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("导出失败"))), "image/png");
      });
      return { blob, w, h, scale };
    } finally {
      if (box) box.style.transform = prevT;
      fitPreview();
    }
  }

  function downloadBlob(blob, name) {
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function exportPng() {
    const err = $("#ti-error");
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
    try {
      const { blob, w, h, scale } = await renderBlob();
      downloadBlob(blob, `textimg-${w}x${h}-${Date.now()}.png`);
      toast(`已下载（${w}×${h} · ${scale}×）`);
    } catch (e) {
      if (err) {
        err.hidden = false;
        err.textContent = e.message || String(e);
      }
    }
  }

  async function copyPng() {
    const err = $("#ti-error");
    try {
      const { blob, w, h } = await renderBlob();
      if (!navigator.clipboard || typeof ClipboardItem === "undefined") throw new Error("当前环境不支持复制图片");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast(`已复制图片（${w}×${h}）`);
    } catch (e) {
      if (err) {
        err.hidden = false;
        err.textContent = e.message || String(e);
      }
    }
  }

  async function saveToMemo() {
    const err = $("#ti-error");
    try {
      if (!window.DevToolsMemo?.ingestBlob) throw new Error("备忘录未就绪，请先打开过备忘录工具");
      const { blob, w, h } = await renderBlob();
      await window.DevToolsMemo.ingestBlob(blob, `文字图-${w}x${h}.png`);
      toast("已保存到备忘录");
    } catch (e) {
      if (err) {
        err.hidden = false;
        err.textContent = e.message || String(e);
      }
    }
  }

  function consumePrefill() {
    try {
      const text = sessionStorage.getItem("devtools-textimg-prefill");
      if (text == null) return;
      sessionStorage.removeItem("devtools-textimg-prefill");
      const src = $("#ti-src");
      if (src) src.value = text;
      paint();
    } catch (_) {}
  }

  function bind() {
    [
      "ti-mode",
      "ti-tpl",
      "ti-theme",
      "ti-code-theme",
      "ti-align",
      "ti-size",
      "ti-lh",
      "ti-pad",
      "ti-winpad",
      "ti-radius",
      "ti-bg",
      "ti-fg",
      "ti-overlay",
      "ti-header",
      "ti-footer",
      "ti-fname",
      "ti-sign",
      "ti-wm",
      "ti-scale",
      "ti-src",
    ].forEach((id) => {
      $(`#${id}`)?.addEventListener("input", paint);
      $(`#${id}`)?.addEventListener("change", paint);
    });
    $("#ti-lines")?.addEventListener("change", paint);
    $("#ti-window")?.addEventListener("change", paint);
    $("#ti-ratio")?.addEventListener("change", () => {
      const ratio = $("#ti-ratio")?.value || "1:1";
      if (ratio !== "custom") applyRatio(ratio);
      paint();
    });
    const onCustom = () => {
      const w = clamp($("#ti-w")?.value, 240, 2000, 720);
      const h = clamp($("#ti-h")?.value, 240, 2400, 720);
      if ($("#ti-ratio")) $("#ti-ratio").value = matchRatio(w, h);
      paint();
    };
    $("#ti-w")?.addEventListener("change", onCustom);
    $("#ti-h")?.addEventListener("change", onCustom);
    $("#ti-w")?.addEventListener("input", () => {
      if ($("#ti-ratio")) $("#ti-ratio").value = "custom";
      paint();
    });
    $("#ti-h")?.addEventListener("input", () => {
      if ($("#ti-ratio")) $("#ti-ratio").value = "custom";
      paint();
    });
    $("#ti-bgimg")?.addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      if (state.bgUrl) URL.revokeObjectURL(state.bgUrl);
      state.bgBlob = f;
      state.bgUrl = URL.createObjectURL(f);
      if ($("#ti-theme")) $("#ti-theme").value = "image";
      paint();
      e.target.value = "";
    });
    $("#ti-bgimg-clear")?.addEventListener("click", () => {
      if (state.bgUrl) URL.revokeObjectURL(state.bgUrl);
      state.bgUrl = "";
      state.bgBlob = null;
      paint();
    });
    $("#ti-export")?.addEventListener("click", () => exportPng());
    $("#ti-copy")?.addEventListener("click", () => copyPng());
    $("#ti-to-memo")?.addEventListener("click", () => saveToMemo());
    window.addEventListener("resize", () => {
      if (panel.classList.contains("is-workspace-active")) fitPreview();
    });
    window.addEventListener("hashchange", consumePrefill);
    applyRatio($("#ti-ratio")?.value || "1:1");
    consumePrefill();
    paint();
  }

  window.DevToolsTextImg = {
    paint,
    setText(text) {
      const src = $("#ti-src");
      if (src) src.value = String(text || "");
      paint();
    },
    prefillAndGo(text) {
      try {
        sessionStorage.setItem("devtools-textimg-prefill", String(text || ""));
      } catch (_) {}
      location.hash = "textimg";
    },
  };

  bind();
})();
