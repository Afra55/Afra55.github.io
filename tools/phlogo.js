(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const panel = $("#phlogo");
  if (!panel) return;

  const STORE_KEY = "devtools-phlogo-v1";
  const FONT =
    '900 1px Arial Black, Arial, Impact, "Helvetica Neue", "PingFang SC", "Microsoft YaHei", sans-serif';

  const PRESETS = {
    ph: { bg: "#000000", left: "#ffffff", box: "#ff9900", right: "#000000", leftText: "Porn", rightText: "Hub" },
    yt: { bg: "#ffffff", left: "#0f0f0f", box: "#ff0000", right: "#ffffff", leftText: "You", rightText: "Tube" },
    of: { bg: "#ffffff", left: "#00aff0", box: "#00aff0", right: "#ffffff", leftText: "Only", rightText: "Fans" },
  };

  const leftEl = $("#ph-left");
  const rightEl = $("#ph-right");
  const presetEl = $("#ph-preset");
  const reverseEl = $("#ph-reverse");
  const transparentEl = $("#ph-transparent");
  const bgEl = $("#ph-bg");
  const leftColorEl = $("#ph-left-color");
  const boxEl = $("#ph-box");
  const rightColorEl = $("#ph-right-color");
  const sizeEl = $("#ph-size");
  const radiusEl = $("#ph-radius");
  const gapEl = $("#ph-gap");
  const padEl = $("#ph-pad");
  const sizeVal = $("#ph-size-val");
  const radiusVal = $("#ph-radius-val");
  const gapVal = $("#ph-gap-val");
  const padVal = $("#ph-pad-val");
  const canvas = $("#ph-canvas");
  const metaEl = $("#ph-meta");
  const errorEl = $("#ph-error");
  const ctx = canvas?.getContext("2d");

  let lastLayout = null;

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
    }, 1600);
  }

  function setError(msg) {
    if (!errorEl) return;
    errorEl.hidden = !msg;
    errorEl.textContent = msg || "";
  }

  function readState() {
    return {
      left: String(leftEl?.value || "").slice(0, 32),
      right: String(rightEl?.value || "").slice(0, 32),
      preset: presetEl?.value || "ph",
      reverse: Boolean(reverseEl?.checked),
      transparent: Boolean(transparentEl?.checked),
      bg: bgEl?.value || "#000000",
      leftColor: leftColorEl?.value || "#ffffff",
      box: boxEl?.value || "#ff9900",
      rightColor: rightColorEl?.value || "#000000",
      size: clamp(Number(sizeEl?.value), 28, 140, 72),
      radius: clamp(Number(radiusEl?.value), 0, 40, 12),
      gap: clamp(Number(gapEl?.value), 0, 40, 10),
      pad: clamp(Number(padEl?.value), 8, 80, 36),
    };
  }

  function clamp(n, min, max, fallback) {
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  function applyPreset(id, { keepCustom, texts } = {}) {
    const p = PRESETS[id];
    if (!p) return;
    if (keepCustom && id === "custom") return;
    if (bgEl) bgEl.value = p.bg;
    if (leftColorEl) leftColorEl.value = p.left;
    if (boxEl) boxEl.value = p.box;
    if (rightColorEl) rightColorEl.value = p.right;
    if (texts) {
      if (leftEl) leftEl.value = p.leftText;
      if (rightEl) rightEl.value = p.rightText;
    }
  }

  function save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(readState()));
    } catch (_) {}
  }

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (leftEl && s.left != null) leftEl.value = s.left;
      if (rightEl && s.right != null) rightEl.value = s.right;
      if (presetEl && s.preset) presetEl.value = s.preset;
      if (reverseEl) reverseEl.checked = Boolean(s.reverse);
      if (transparentEl) transparentEl.checked = Boolean(s.transparent);
      if (sizeEl && s.size) sizeEl.value = String(s.size);
      if (radiusEl && s.radius != null) radiusEl.value = String(s.radius);
      if (gapEl && s.gap != null) gapEl.value = String(s.gap);
      if (padEl && s.pad) padEl.value = String(s.pad);
      if (s.preset && s.preset !== "custom") applyPreset(s.preset);
      else {
        if (bgEl && s.bg) bgEl.value = s.bg;
        if (leftColorEl && s.leftColor) leftColorEl.value = s.leftColor;
        if (boxEl && s.box) boxEl.value = s.box;
        if (rightColorEl && s.rightColor) rightColorEl.value = s.rightColor;
      }
    } catch (_) {}
  }

  function roundRect(c, x, y, w, h, r) {
    const rr = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + rr, y);
    c.arcTo(x + w, y, x + w, y + h, rr);
    c.arcTo(x + w, y + h, x, y + h, rr);
    c.arcTo(x, y + h, x, y, rr);
    c.arcTo(x, y, x + w, y, rr);
    c.closePath();
  }

  function measure(c, text, size) {
    c.font = FONT.replace("1px", `${size}px`);
    return c.measureText(text || " ").width;
  }

  function computeLayout(c, s) {
    const left = s.left || " ";
    const right = s.right || " ";
    const boxPadX = Math.round(s.size * 0.22);
    const boxPadY = Math.round(s.size * 0.16);
    const plainText = s.reverse ? right : left;
    const boxText = s.reverse ? left : right;
    const plainW = measure(c, plainText, s.size);
    const boxInnerW = measure(c, boxText, s.size);
    const boxW = boxInnerW + boxPadX * 2;
    const boxH = s.size + boxPadY * 2;
    const contentW = plainW + s.gap + boxW;
    const contentH = Math.max(s.size, boxH);
    const w = Math.ceil(contentW + s.pad * 2);
    const h = Math.ceil(contentH + s.pad * 2);
    const x0 = s.pad;
    const y0 = (h - contentH) / 2;
    const plainX = s.reverse ? x0 + boxW + s.gap : x0;
    const boxX = s.reverse ? x0 : x0 + plainW + s.gap;
    const plainY = y0 + contentH / 2;
    const boxY = y0 + (contentH - boxH) / 2;
    const plainColor = s.reverse ? s.rightColor : s.leftColor;
    const boxFg = s.reverse ? s.leftColor : s.rightColor;
    return {
      w,
      h,
      plainText,
      boxText,
      boxW,
      boxH,
      boxPadX,
      plainX,
      boxX,
      plainY,
      boxY,
      plainColor,
      boxFg,
    };
  }

  function paintTo(c, s, layout) {
    const dpr = 2;
    c.canvas.width = Math.max(1, Math.round(layout.w * dpr));
    c.canvas.height = Math.max(1, Math.round(layout.h * dpr));
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, layout.w, layout.h);
    if (!s.transparent) {
      c.fillStyle = s.bg;
      c.fillRect(0, 0, layout.w, layout.h);
    }
    c.font = FONT.replace("1px", `${s.size}px`);
    c.textBaseline = "middle";
    c.textAlign = "left";

    c.fillStyle = layout.plainColor;
    c.fillText(layout.plainText, layout.plainX, layout.plainY);

    c.fillStyle = s.box;
    roundRect(c, layout.boxX, layout.boxY, layout.boxW, layout.boxH, s.radius);
    c.fill();
    c.fillStyle = layout.boxFg;
    c.fillText(layout.boxText, layout.boxX + layout.boxPadX, layout.boxY + layout.boxH / 2);
  }

  function paint() {
    if (!ctx || !canvas) return;
    const s = readState();
    if (sizeVal) sizeVal.textContent = String(s.size);
    if (radiusVal) radiusVal.textContent = String(s.radius);
    if (gapVal) gapVal.textContent = String(s.gap);
    if (padVal) padVal.textContent = String(s.pad);
    const layout = computeLayout(ctx, s);
    lastLayout = { s, layout };
    paintTo(ctx, s, layout);
    canvas.style.width = `${layout.w}px`;
    canvas.style.maxWidth = "100%";
    canvas.style.height = "auto";
    if (metaEl) metaEl.textContent = `${layout.w}×${layout.h} · PNG/SVG 导出`;
  }

  function toBlob(c) {
    return new Promise((resolve, reject) => {
      c.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("导出失败"))), "image/png");
    });
  }

  function downloadBlob(blob, name) {
    const a = document.createElement("a");
    const url = URL.createObjectURL(blob);
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function escapeXml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function buildSvg(s, layout) {
    const bg = s.transparent ? "" : `<rect width="100%" height="100%" fill="${s.bg}"/>`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${layout.w}" height="${layout.h}" viewBox="0 0 ${layout.w} ${layout.h}">
  ${bg}
  <text x="${layout.plainX}" y="${layout.plainY}" fill="${layout.plainColor}" font-size="${s.size}" font-weight="900" font-family="Arial Black, Arial, Impact, sans-serif" dominant-baseline="middle">${escapeXml(layout.plainText)}</text>
  <rect x="${layout.boxX}" y="${layout.boxY}" width="${layout.boxW}" height="${layout.boxH}" rx="${s.radius}" ry="${s.radius}" fill="${s.box}"/>
  <text x="${layout.boxX + layout.boxPadX}" y="${layout.boxY + layout.boxH / 2}" fill="${layout.boxFg}" font-size="${s.size}" font-weight="900" font-family="Arial Black, Arial, Impact, sans-serif" dominant-baseline="middle">${escapeXml(layout.boxText)}</text>
</svg>`;
  }

  async function ensureMemoApi(fn) {
    for (let i = 0; i < 40; i++) {
      const api = window.DevToolsMemo;
      if (api && typeof api[fn] === "function") return api;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("备忘录未就绪，请稍后重试");
  }

  function onChange(fromPreset) {
    setError("");
    if (fromPreset && presetEl?.value && presetEl.value !== "custom") applyPreset(presetEl.value, { texts: true });
    if (!fromPreset && presetEl && PRESETS[presetEl.value]) {
      const p = PRESETS[presetEl.value];
      const cur = readState();
      if (p.bg !== cur.bg || p.left !== cur.leftColor || p.box !== cur.box || p.right !== cur.rightColor) {
        presetEl.value = "custom";
      }
    }
    paint();
    save();
  }

  [
    leftEl,
    rightEl,
    reverseEl,
    transparentEl,
    bgEl,
    leftColorEl,
    boxEl,
    rightColorEl,
    sizeEl,
    radiusEl,
    gapEl,
    padEl,
  ].forEach((el) => {
    el?.addEventListener("input", () => onChange(false));
    el?.addEventListener("change", () => onChange(false));
  });
  presetEl?.addEventListener("change", () => onChange(true));

  $("#ph-download")?.addEventListener("click", async () => {
    try {
      paint();
      const blob = await toBlob(ctx);
      const name = `${(readState().left + readState().right).replace(/\s+/g, "") || "phlogo"}.png`;
      downloadBlob(blob, name);
      toast("已下载 PNG");
    } catch (e) {
      setError(e.message || String(e));
    }
  });

  $("#ph-svg")?.addEventListener("click", () => {
    try {
      paint();
      const { s, layout } = lastLayout;
      const svg = buildSvg(s, layout);
      downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "phlogo.svg");
      toast("已下载 SVG");
    } catch (e) {
      setError(e.message || String(e));
    }
  });

  $("#ph-copy")?.addEventListener("click", async () => {
    try {
      paint();
      const blob = await toBlob(ctx);
      if (!navigator.clipboard || typeof ClipboardItem === "undefined") throw new Error("当前环境不支持复制图片");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      toast("已复制图片");
    } catch (e) {
      setError(e.message || String(e));
    }
  });

  $("#ph-to-memo")?.addEventListener("click", async () => {
    try {
      paint();
      const memo = await ensureMemoApi("ingestBlob");
      const blob = await toBlob(ctx);
      await memo.ingestBlob(blob, "phlogo.png");
      toast("已保存到备忘录");
    } catch (e) {
      setError(e.message || String(e));
    }
  });

  $("#ph-reset")?.addEventListener("click", () => {
    if (leftEl) leftEl.value = "Porn";
    if (rightEl) rightEl.value = "Hub";
    if (presetEl) presetEl.value = "ph";
    if (reverseEl) reverseEl.checked = false;
    if (transparentEl) transparentEl.checked = false;
    if (sizeEl) sizeEl.value = "72";
    if (radiusEl) radiusEl.value = "12";
    if (gapEl) gapEl.value = "10";
    if (padEl) padEl.value = "36";
    applyPreset("ph");
    onChange(true);
  });

  load();
  paint();
  document.addEventListener("devtools:route", (e) => {
    if (e.detail?.tool === "phlogo") paint();
  });
})();
