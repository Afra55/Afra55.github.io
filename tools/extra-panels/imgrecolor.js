(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput } = K;

  const MAX_EDGE = 2400; // 工作画布最长边上限（性能）
  const PALETTE_MAX = 12;

  let els = {};
  let img = null; // HTMLImageElement
  let baseData = null; // 原图（工作尺寸）RGBA
  let workW = 0;
  let workH = 0;
  let srcColor = null; // {r,g,b}
  let targetColor = { r: 255, g: 255, b: 255 };
  let crop = null; // {x,y,w,h} 工作画布坐标

  function hexToRgb(hex) {
    const h = String(hex || "").trim().replace(/^#/, "");
    const m = /^([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(h);
    if (!m) return null;
    let s = m[1];
    if (s.length === 3) s = s.split("").map((c) => c + c).join("");
    const n = parseInt(s, 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
  }
  function clamp255(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  function setStatus(text) {
    if (els.status) els.status.textContent = text || "";
  }

  function recolor(src, sc, tc, tol, feather) {
    const out = new Uint8ClampedArray(src.length);
    const tol2 = tol * tol;
    const f = Math.max(0, feather || 0);
    for (let i = 0; i < src.length; i += 4) {
      const r = src[i], g = src[i + 1], b = src[i + 2];
      out[i] = r; out[i + 1] = g; out[i + 2] = b; out[i + 3] = src[i + 3];
      const dr = r - sc.r, dg = g - sc.g, db = b - sc.b;
      const d2 = dr * dr + dg * dg + db * db;
      if (d2 > tol2) continue;
      let a = 1;
      if (f > 0) {
        const d = Math.sqrt(d2);
        let x = (tol - d) / f;
        if (x > 1) x = 1; else if (x < 0) x = 0;
        a = x * x * (3 - 2 * x);
      }
      out[i] = clamp255(r + (tc.r - r) * a);
      out[i + 1] = clamp255(g + (tc.g - g) * a);
      out[i + 2] = clamp255(b + (tc.b - b) * a);
    }
    return out;
  }

  function render() {
    const canvas = els.canvas;
    if (!canvas || !baseData) return;
    if (!srcColor) {
      canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(baseData), workW, workH), 0, 0);
      return;
    }
    const tol = Number(els.tol?.value) || 0;
    const feather = Number(els.feather?.value) || 0;
    const out = recolor(baseData, srcColor, targetColor, tol, feather);
    canvas.getContext("2d").putImageData(new ImageData(out, workW, workH), 0, 0);
  }

  function refreshSwatches() {
    if (!els.swatches) return;
    if (!baseData) { els.swatches.innerHTML = ""; return; }
    const counts = new Map();
    const total = baseData.length / 4;
    const step = Math.max(1, Math.floor(total / 24000)) * 4;
    for (let i = 0; i < baseData.length; i += step) {
      const key = ((baseData[i] >> 4) << 8) | ((baseData[i + 1] >> 4) << 4) | (baseData[i + 2] >> 4);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, PALETTE_MAX);
    els.swatches.innerHTML = top
      .map(([k]) => {
        const r = ((k >> 8) & 15) * 16 + 8, g = ((k >> 4) & 15) * 16 + 8, b = (k & 15) * 16 + 8;
        const hex = rgbToHex(r, g, b);
        return `<button type="button" class="irc-swatch" data-hex="${hex}" style="background:${hex}" title="${hex}"></button>`;
      })
      .join("");
  }

  function setSrcColor(rgb) {
    srcColor = rgb ? { r: rgb.r, g: rgb.g, b: rgb.b } : null;
    if (els.srcChip) els.srcChip.style.background = rgb ? rgbToHex(rgb.r, rgb.g, rgb.b) : "transparent";
    if (els.srcHex) els.srcHex.textContent = rgb ? rgbToHex(rgb.r, rgb.g, rgb.b).toUpperCase() : "未选（点图片或上面的色块）";
    render();
  }

  function setTargetColor(rgb) {
    if (!rgb) return;
    targetColor = rgb;
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    if (els.target) els.target.value = hex;
    if (els.targetHex) els.targetHex.value = hex;
    render();
  }

  function workFromImage(image) {
    const nw = image.naturalWidth || image.width;
    const nh = image.naturalHeight || image.height;
    const scale = Math.min(1, MAX_EDGE / Math.max(nw, nh));
    workW = Math.max(1, Math.round(nw * scale));
    workH = Math.max(1, Math.round(nh * scale));
    const canvas = els.canvas;
    canvas.width = workW;
    canvas.height = workH;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(image, 0, 0, workW, workH);
    baseData = ctx.getImageData(0, 0, workW, workH).data;
  }

  function resetCrop() {
    crop = null;
    if (els.crop) els.crop.hidden = true;
    if (els.cropCenter) els.cropCenter.hidden = true;
    if (els.size) els.size.value = "";
  }

  function centeredCrop(w, h) {
    const size = els.size?.value || "";
    const m = /^(\d+)x(\d+)$/.exec(size);
    if (!m) return;
    const tw = Number(m[1]), th = Number(m[2]);
    const ar = tw / th;
    // 以图片能容纳的最大等比矩形为初始裁剪框
    let cw = workW, ch = Math.round(workW / ar);
    if (ch > workH) { ch = workH; cw = Math.round(workH * ar); }
    cw = Math.max(8, Math.min(workW, cw));
    ch = Math.max(8, Math.min(workH, ch));
    crop = { x: Math.round((workW - cw) / 2), y: Math.round((workH - ch) / 2), w: cw, h: ch };
    crop.aspect = ar;
    drawCropOverlay();
    if (els.cropCenter) els.cropCenter.hidden = false;
    updateStatus();
  }

  function drawCropOverlay() {
    const stage = els.stage, box = els.crop, canvas = els.canvas;
    if (!stage || !box || !canvas) return;
    if (!crop || !baseData) { box.hidden = true; return; }
    const rect = canvas.getBoundingClientRect();
    if (!rect.width) { box.hidden = true; return; }
    const sx = rect.width / workW, sy = rect.height / workH;
    const stageRect = stage.getBoundingClientRect();
    box.hidden = false;
    box.style.left = (rect.left - stageRect.left + crop.x * sx) + "px";
    box.style.top = (rect.top - stageRect.top + crop.y * sy) + "px";
    box.style.width = (crop.w * sx) + "px";
    box.style.height = (crop.h * sy) + "px";
  }

  function updateStatus() {
    if (!baseData) { setStatus(""); return; }
    const bits = [`${workW}×${workH}`];
    if (crop) {
      const size = els.size?.value || "";
      const m = /^(\d+)x(\d+)$/.exec(size);
      bits.push(`裁剪 ${Math.round(crop.w)}×${Math.round(crop.h)}` + (m ? ` → 导出 ${m[1]}×${m[2]}` : ""));
    }
    if (srcColor) bits.push(`替换 ${rgbToHex(srcColor.r, srcColor.g, srcColor.b).toUpperCase()} → ${rgbToHex(targetColor.r, targetColor.g, targetColor.b).toUpperCase()}`);
    setStatus(bits.join(" · "));
  }

  function applyImage(image) {
    workFromImage(image);
    els.canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(baseData), workW, workH), 0, 0);
    srcColor = null;
    resetCrop();
    refreshSwatches();
    setSrcColor(null);
    setTargetColor(targetColor);
    if (els.download) els.download.disabled = false;
    if (els.reset) els.reset.disabled = false;
    if (els.clear) els.clear.hidden = false;
    setError(els.error, "");
    setStatus("");
    updateStatus();
    requestAnimationFrame(drawCropOverlay);
  }

  function download() {
    if (!baseData) return;
    const size = els.size?.value || "";
    const m = /^(\d+)x(\d+)$/.exec(size);
    const src = els.canvas;
    const out = document.createElement("canvas");
    let sx = 0, sy = 0, sw = workW, sh = workH;
    if (crop && m) { sx = crop.x; sy = crop.y; sw = crop.w; sh = crop.h; }
    const tw = m ? Number(m[1]) : sw;
    const th = m ? Number(m[2]) : sh;
    out.width = tw;
    out.height = th;
    const ctx = out.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, tw, th);
    out.toBlob((blob) => {
      if (!blob) { setError(els.error, "导出失败"); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = m ? `id-photo-${m[1]}x${m[2]}.png` : "recolored.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast("已导出 PNG");
    }, "image/png");
  }

  bindPanel("imgrecolor", () => {
    els = {
      file: $("#irc-file"),
      clear: $("#irc-clear"),
      stage: $("#irc-stage"),
      canvas: $("#irc-canvas"),
      crop: $("#irc-crop"),
      cropHandle: $("#irc-crop-handle"),
      meta: $("#irc-meta"),
      swatches: $("#irc-swatches"),
      srcChip: $("#irc-src-chip"),
      srcHex: $("#irc-src-hex"),
      target: $("#irc-target"),
      targetHex: $("#irc-target-hex"),
      eyedrop: $("#irc-eyedrop"),
      tol: $("#irc-tol"),
      tolVal: $("#irc-tol-val"),
      feather: $("#irc-feather"),
      featherVal: $("#irc-feather-val"),
      size: $("#irc-size"),
      cropCenter: $("#irc-crop-center"),
      download: $("#irc-download"),
      reset: $("#irc-reset"),
      status: $("#irc-status"),
      error: $("#irc-error"),
    };
    if (!els.canvas) return;

    flushPendingFileInput(els.file, (files) => loadFiles(files));

    els.file?.addEventListener("change", (e) => loadFiles(e.target.files));

    els.clear?.addEventListener("click", () => {
      img = null; baseData = null; srcColor = null; resetCrop();
      els.canvas.getContext("2d").clearRect(0, 0, els.canvas.width, els.canvas.height);
      els.canvas.width = 0; els.canvas.height = 0;
      if (els.swatches) els.swatches.innerHTML = "";
      if (els.srcChip) els.srcChip.style.background = "transparent";
      if (els.srcHex) els.srcHex.textContent = "未选（点图片或上面的色块）";
      if (els.download) els.download.disabled = true;
      if (els.reset) els.reset.disabled = true;
      els.clear.hidden = true;
      setError(els.error, "");
      setStatus("");
      toast("已清空");
    });

    // 点图片取色
    els.canvas.addEventListener("click", (e) => {
      if (!baseData) return;
      const rect = els.canvas.getBoundingClientRect();
      const x = Math.floor(((e.clientX - rect.left) / rect.width) * workW);
      const y = Math.floor(((e.clientY - rect.top) / rect.height) * workH);
      if (x < 0 || y < 0 || x >= workW || y >= workH) return;
      const i = (y * workW + x) * 4;
      setSrcColor({ r: baseData[i], g: baseData[i + 1], b: baseData[i + 2] });
      updateStatus();
    });

    els.swatches?.addEventListener("click", (e) => {
      const b = e.target.closest?.(".irc-swatch");
      if (!b) return;
      const rgb = hexToRgb(b.dataset.hex);
      if (rgb) { setSrcColor(rgb); updateStatus(); }
    });

    els.target?.addEventListener("input", () => {
      const rgb = hexToRgb(els.target.value);
      if (rgb) setTargetColor(rgb);
    });
    els.targetHex?.addEventListener("input", () => {
      const rgb = hexToRgb(els.targetHex.value);
      if (rgb) setTargetColor(rgb);
    });
    els.eyedrop?.addEventListener("click", async () => {
      if (typeof window.EyeDropper !== "function") { setError(els.error, "当前浏览器不支持屏幕吸管（请用 Chrome/Edge）"); return; }
      try {
        const res = await new window.EyeDropper().open();
        const rgb = hexToRgb(res.sRGBHex);
        if (rgb) setTargetColor(rgb);
      } catch (_) {}
    });

    const onTol = () => {
      if (els.tolVal) els.tolVal.textContent = els.tol.value;
      render();
    };
    const onFeather = () => {
      if (els.featherVal) els.featherVal.textContent = els.feather.value;
      render();
    };
    els.tol?.addEventListener("input", onTol);
    els.feather?.addEventListener("input", onFeather);
    if (els.tolVal) els.tolVal.textContent = els.tol.value;
    if (els.featherVal) els.featherVal.textContent = els.feather.value;

    els.size?.addEventListener("change", () => {
      if (els.size.value) centeredCrop();
      else { crop = null; if (els.crop) els.crop.hidden = true; if (els.cropCenter) els.cropCenter.hidden = true; }
      updateStatus();
    });
    els.cropCenter?.addEventListener("click", () => { centeredCrop(); });

    els.download?.addEventListener("click", download);
    els.reset?.addEventListener("click", () => {
      if (!baseData) return;
      els.canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(baseData), workW, workH), 0, 0);
      srcColor = null;
      setSrcColor(null);
      resetCrop();
      updateStatus();
      toast("已还原");
    });

    // 裁剪框拖动 / 缩放
    if (els.crop) {
      let drag = null;
      const toCanvas = (e) => {
        const rect = els.canvas.getBoundingClientRect();
        return { x: ((e.clientX - rect.left) / rect.width) * workW, y: ((e.clientY - rect.top) / rect.height) * workH };
      };
      const onMove = (e) => {
        if (!drag || !crop) return;
        const p = toCanvas(e);
        if (drag.mode === "move") {
          const w = drag.w, h = drag.h;
          crop.x = Math.max(0, Math.min(workW - w, drag.x + (p.x - drag.px)));
          crop.y = Math.max(0, Math.min(workH - h, drag.y + (p.y - drag.py)));
        } else {
          const ar = crop.aspect || (crop.w / crop.h);
          let w = Math.max(40, drag.w + (p.x - drag.px));
          let h = w / ar;
          if (drag.y + h > workH) { h = workH - drag.y; w = h * ar; }
          if (drag.x + w > workW) { w = workW - drag.x; h = w / ar; }
          crop.w = Math.max(24, w);
          crop.h = Math.max(24, h);
        }
        drawCropOverlay();
      };
      const onUp = () => {
        if (drag) { drag = null; updateStatus(); }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      els.crop.addEventListener("pointerdown", (e) => {
        if (!crop || e.target === els.cropHandle) return;
        const p = toCanvas(e);
        drag = { mode: "move", px: p.x, py: p.y, x: crop.x, y: crop.y, w: crop.w, h: crop.h };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      });
      els.cropHandle?.addEventListener("pointerdown", (e) => {
        if (!crop) return;
        e.stopPropagation();
        const p = toCanvas(e);
        drag = { mode: "resize", px: p.x, py: p.y, x: crop.x, y: crop.y, w: crop.w, h: crop.h };
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
      });
    }

    window.addEventListener("resize", () => drawCropOverlay());

    function loadFiles(files) {
      const file = files && files[0];
      if (!file) return;
      if (!/^image\//.test(file.type || "")) { setError(els.error, "请选择图片文件"); return; }
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        img = image;
        applyImage(image);
        if (els.meta) els.meta.textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB · 原图 ${image.naturalWidth}×${image.naturalHeight}（点图取色）`;
        URL.revokeObjectURL(url);
      };
      image.onerror = () => { setError(els.error, "读取图片失败"); URL.revokeObjectURL(url); };
      image.src = url;
    }
  });
})();
