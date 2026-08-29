(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  const STORAGE_KEY = "devtools-ruler-v1";
  const BAND = 52;

  let root = null;
  let previewCanvas = null;
  let previewCtx = null;
  let fsRoot = null;
  let fsCanvas = null;
  let fsCtx = null;
  let coordEl = null;
  let coordFsEl = null;
  let unitSel = null;
  let ppiInput = null;
  let crossToggle = null;
  let fsBtn = null;
  let fsCloseBtn = null;
  let inited = false;
  let fullscreen = false;
  let pointerX = 0;
  let pointerY = 0;
  let hasPointer = false;
  let resizeObserver = null;

  const state = {
    unit: "px",
    ppi: 96,
    crosshair: true,
  };

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data.unit === "px" || data.unit === "mm" || data.unit === "cm") state.unit = data.unit;
      if (Number(data.ppi) > 0) state.ppi = Number(data.ppi);
      if (typeof data.crosshair === "boolean") state.crosshair = data.crosshair;
    } catch (_) {}
  }

  function saveState() {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ unit: state.unit, ppi: state.ppi, crosshair: state.crosshair })
      );
    } catch (_) {}
  }

  function syncControls() {
    if (unitSel) unitSel.value = state.unit;
    if (ppiInput) ppiInput.value = String(state.ppi);
    if (crossToggle) crossToggle.checked = state.crosshair;
  }

  function readControls() {
    if (unitSel) state.unit = unitSel.value || "px";
    if (ppiInput) state.ppi = Math.max(72, Math.min(600, Number(ppiInput.value) || 96));
    if (crossToggle) state.crosshair = Boolean(crossToggle.checked);
    saveState();
  }

  function themeColors() {
    const rootEl = document.documentElement;
    const cs = getComputedStyle(rootEl);
    const pick = (name, fallback) => cs.getPropertyValue(name).trim() || fallback;
    return {
      bg: pick("--panel", "#1a1f2e"),
      fg: pick("--text", "#e8eaef"),
      muted: pick("--muted", "#9aa3b2"),
      accent: pick("--accent", "#6ea8fe"),
      line: pick("--border", "#3a4254"),
    };
  }

  function unitScale(unit, ppi) {
    const p = Math.max(72, Number(ppi) || 96);
    if (unit === "mm") return { pxPerU: p / 25.4, suffix: "mm" };
    if (unit === "cm") return { pxPerU: p / 2.54, suffix: "cm" };
    return { pxPerU: 1, suffix: "px" };
  }

  function tickPlan(unit) {
    if (unit === "px") return { minor: 10, medium: 50, major: 100, labelEvery: 100 };
    if (unit === "mm") return { minor: 1, medium: 5, major: 10, labelEvery: 10 };
    return { minor: 0.5, medium: 1, major: 1, labelEvery: 1 };
  }

  function formatUnit(value, unit) {
    if (unit === "px") return String(Math.round(value));
    if (unit === "mm") return Number(value).toFixed(value % 1 === 0 ? 0 : 1);
    return Number(value).toFixed(1).replace(/\.0$/, "");
  }

  function nearlyMod(a, step) {
    if (!(step > 0)) return false;
    const r = ((a % step) + step) % step;
    return r < step * 0.001 || step - r < step * 0.001;
  }

  function drawHorizontalRuler(ctx, x, y, width, bandH, side, colors, unit, ppi) {
    const scale = unitScale(unit, ppi);
    const plan = tickPlan(unit);
    const { pxPerU } = scale;
    const baseline = side === "top" ? y + bandH - 1 : y + 1;

    ctx.save();
    ctx.strokeStyle = colors.line;
    ctx.fillStyle = colors.fg;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, baseline);
    ctx.lineTo(x + width, baseline);
    ctx.stroke();

    const maxU = width / pxPerU;
    const startU = 0;
    const step = plan.minor;
    for (let u = startU; u <= maxU + step * 0.001; u += step) {
      const px = x + u * pxPerU;
      if (px > x + width + 0.5) break;
      let tickLen = bandH * 0.32;
      if (nearlyMod(u, plan.medium)) tickLen = bandH * 0.55;
      if (nearlyMod(u, plan.major)) tickLen = bandH * 0.82;
      const y0 = side === "top" ? baseline - tickLen : baseline;
      const y1 = side === "top" ? baseline : baseline + tickLen;
      ctx.beginPath();
      ctx.moveTo(px + 0.5, y0);
      ctx.lineTo(px + 0.5, y1);
      ctx.stroke();
      if (nearlyMod(u, plan.labelEvery) && u > 0.001) {
        const label = formatUnit(u, unit);
        ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = side === "top" ? "bottom" : "top";
        const ty = side === "top" ? baseline - tickLen - 2 : baseline + tickLen + 2;
        ctx.fillText(label, px, ty);
      }
    }
    ctx.restore();
  }

  function drawVerticalRuler(ctx, x, y, bandW, height, side, colors, unit, ppi) {
    const scale = unitScale(unit, ppi);
    const plan = tickPlan(unit);
    const { pxPerU } = scale;
    const baseline = side === "left" ? x + bandW - 1 : x + 1;

    ctx.save();
    ctx.strokeStyle = colors.line;
    ctx.fillStyle = colors.fg;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(baseline, y);
    ctx.lineTo(baseline, y + height);
    ctx.stroke();

    const maxU = height / pxPerU;
    const step = plan.minor;
    for (let u = 0; u <= maxU + step * 0.001; u += step) {
      const py = y + u * pxPerU;
      if (py > y + height + 0.5) break;
      let tickLen = bandW * 0.32;
      if (nearlyMod(u, plan.medium)) tickLen = bandW * 0.55;
      if (nearlyMod(u, plan.major)) tickLen = bandW * 0.82;
      const x0 = side === "left" ? baseline - tickLen : baseline;
      const x1 = side === "left" ? baseline : baseline + tickLen;
      ctx.beginPath();
      ctx.moveTo(x0, py + 0.5);
      ctx.lineTo(x1, py + 0.5);
      ctx.stroke();
      if (nearlyMod(u, plan.labelEvery) && u > 0.001) {
        const label = formatUnit(u, unit);
        ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.save();
        const lx = side === "left" ? baseline - tickLen - 4 : baseline + tickLen + 4;
        ctx.translate(lx, py);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "center";
        ctx.textBaseline = side === "left" ? "top" : "bottom";
        ctx.fillText(label, 0, 0);
        ctx.restore();
      }
    }
    ctx.restore();
  }

  function drawRulerFrame(ctx, w, h, band, colors, unit, ppi, opts = {}) {
    const { crosshair = false, mx = 0, my = 0, showPointer = false, dimCenter = true } = opts;
    ctx.clearRect(0, 0, w, h);

    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, w, h);

    const innerW = Math.max(0, w - band * 2);
    const innerH = Math.max(0, h - band * 2);

    if (dimCenter && innerW > 0 && innerH > 0) {
      ctx.fillStyle = colors.bg;
      ctx.globalAlpha = 0.55;
      ctx.fillRect(band, band, innerW, innerH);
      ctx.globalAlpha = 1;
    }

    ctx.fillStyle = colors.bg;
    ctx.fillRect(0, 0, w, band);
    ctx.fillRect(0, h - band, w, band);
    ctx.fillRect(0, 0, band, h);
    ctx.fillRect(w - band, 0, band, h);

    if (innerW > 0) {
      drawHorizontalRuler(ctx, band, 0, innerW, band, "top", colors, unit, ppi);
      drawHorizontalRuler(ctx, band, h - band, innerW, band, "bottom", colors, unit, ppi);
    }
    if (innerH > 0) {
      drawVerticalRuler(ctx, 0, band, band, innerH, "left", colors, unit, ppi);
      drawVerticalRuler(ctx, w - band, band, band, innerH, "right", colors, unit, ppi);
    }

    if (crosshair && showPointer && mx >= band && mx <= w - band && my >= band && my <= h - band) {
      ctx.save();
      ctx.strokeStyle = colors.accent;
      ctx.globalAlpha = 0.75;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(band, my + 0.5);
      ctx.lineTo(w - band, my + 0.5);
      ctx.moveTo(mx + 0.5, band);
      ctx.lineTo(mx + 0.5, h - band);
      ctx.stroke();
      ctx.restore();
    }
  }

  function pointerCoords(w, h, band) {
    if (!hasPointer) return null;
    const scale = unitScale(state.unit, state.ppi);
    const xU = (pointerX - band) / scale.pxPerU;
    const yU = (pointerY - band) / scale.pxPerU;
    if (pointerX < band || pointerY < band || pointerX > w - band || pointerY > h - band) return null;
    return { xU, yU, suffix: scale.suffix };
  }

  function updateCoordHud(w, h, band) {
    const pt = pointerCoords(w, h, band);
    const text = !pt
      ? hasPointer
        ? "指针在刻度区外"
        : "移动指针查看坐标"
      : `X ${formatUnit(pt.xU, state.unit)} ${pt.suffix} · Y ${formatUnit(pt.yU, state.unit)} ${pt.suffix}`;
    if (coordEl && !fullscreen) coordEl.textContent = text;
    if (coordFsEl && fullscreen) coordFsEl.textContent = text;
  }

  function paintPreview() {
    if (!previewCanvas || !previewCtx) return;
    const rect = previewCanvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(200, Math.round(rect.width));
    const h = Math.max(160, Math.round(rect.height));
    if (previewCanvas.width !== Math.round(w * dpr) || previewCanvas.height !== Math.round(h * dpr)) {
      previewCanvas.width = Math.round(w * dpr);
      previewCanvas.height = Math.round(h * dpr);
    }
    previewCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const band = Math.max(28, Math.round(Math.min(w, h) * 0.11));
    const colors = themeColors();
    const localX = hasPointer ? (pointerX / window.innerWidth) * w : w * 0.55;
    const localY = hasPointer ? (pointerY / window.innerHeight) * h : h * 0.45;
    drawRulerFrame(previewCtx, w, h, band, colors, state.unit, state.ppi, {
      crosshair: state.crosshair,
      mx: localX,
      my: localY,
      showPointer: true,
      dimCenter: true,
    });
    updateCoordHud(w, h, band);
  }

  function paintFullscreen() {
    if (!fsCanvas || !fsCtx || !fullscreen) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (fsCanvas.width !== Math.round(w * dpr) || fsCanvas.height !== Math.round(h * dpr)) {
      fsCanvas.width = Math.round(w * dpr);
      fsCanvas.height = Math.round(h * dpr);
      fsCanvas.style.width = `${w}px`;
      fsCanvas.style.height = `${h}px`;
    }
    fsCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const colors = themeColors();
    drawRulerFrame(fsCtx, w, h, BAND, colors, state.unit, state.ppi, {
      crosshair: state.crosshair,
      mx: pointerX,
      my: pointerY,
      showPointer: hasPointer,
      dimCenter: false,
    });
    updateCoordHud(w, h, BAND);
  }

  function repaintAll() {
    paintPreview();
    if (fullscreen) paintFullscreen();
  }

  function onPointerMove(clientX, clientY) {
    pointerX = clientX;
    pointerY = clientY;
    hasPointer = true;
    repaintAll();
  }

  function enterFullscreen() {
    if (fullscreen || !fsRoot) return;
    readControls();
    fullscreen = true;
    fsRoot.hidden = false;
    document.body.classList.add("ruler-fs-active");
    paintFullscreen();
    fsCloseBtn?.focus();
  }

  function exitFullscreen() {
    if (!fullscreen || !fsRoot) return;
    fullscreen = false;
    fsRoot.hidden = true;
    document.body.classList.remove("ruler-fs-active");
    fsBtn?.focus();
    paintPreview();
  }

  function bindEvents() {
    unitSel?.addEventListener("change", () => {
      readControls();
      repaintAll();
    });
    ppiInput?.addEventListener("change", () => {
      readControls();
      repaintAll();
    });
    crossToggle?.addEventListener("change", () => {
      readControls();
      repaintAll();
    });

    fsBtn?.addEventListener("click", enterFullscreen);
    fsCloseBtn?.addEventListener("click", (e) => {
      e.stopPropagation();
      exitFullscreen();
    });

    window.addEventListener(
      "pointermove",
      (e) => {
        if (!inited) return;
        onPointerMove(e.clientX, e.clientY);
      },
      { passive: true }
    );

    window.addEventListener("resize", () => {
      if (!inited) return;
      repaintAll();
    });

    document.addEventListener("keydown", (e) => {
      if (!fullscreen) return;
      if (e.key === "Escape") {
        e.preventDefault();
        exitFullscreen();
      }
    });

    fsRoot?.addEventListener("click", (e) => {
      if (e.target === fsCanvas || e.target === fsRoot) exitFullscreen();
    });
  }

  function observePreview() {
    const stage = $("#ruler-preview-wrap");
    if (!stage || resizeObserver) return;
    resizeObserver = new ResizeObserver(() => paintPreview());
    resizeObserver.observe(stage);
  }

  function isRulerRoute() {
    const raw = String(location.hash || "").replace(/^#/, "").trim();
    return raw.split(/[/?]/)[0] === "ruler";
  }

  function isRulerVisible() {
    return Boolean(root?.classList.contains("is-workspace-active"));
  }

  function initRulerCore() {
    root = $("#ruler");
    if (!root || root.dataset.bound) return false;
    root.dataset.bound = "1";

    previewCanvas = $("#ruler-preview");
    previewCtx = previewCanvas?.getContext("2d", { alpha: false });
    fsRoot = $("#ruler-fs");
    fsCanvas = $("#ruler-fs-canvas");
    fsCtx = fsCanvas?.getContext("2d", { alpha: false });
    coordEl = $("#ruler-coord");
    coordFsEl = $("#ruler-coord-fs");
    coordFsEl = $("#ruler-coord-fs");
    unitSel = $("#ruler-unit");
    ppiInput = $("#ruler-ppi");
    crossToggle = $("#ruler-crosshair");
    fsBtn = $("#ruler-fullscreen");
    fsCloseBtn = $("#ruler-fs-close");

    loadState();
    syncControls();
    bindEvents();
    observePreview();
    repaintAll();
    return true;
  }

  function ensureRuler() {
    if (inited) {
      if (isRulerVisible()) repaintAll();
      return;
    }
    if (!initRulerCore()) return;
    inited = true;
  }

  function onRoute(ev) {
    const tool = ev?.detail?.tool || (isRulerRoute() ? "ruler" : "");
    if (tool === "ruler") ensureRuler();
    else if (fullscreen) exitFullscreen();
  }

  window.DevToolsRuler = {
    enterFullscreen,
    exitFullscreen,
    repaint: repaintAll,
    isFullscreen: () => fullscreen,
  };

  window.addEventListener("devtools:route", onRoute);
  if (isRulerRoute()) {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", ensureRuler, { once: true });
    } else {
      ensureRuler();
    }
  }
})();
