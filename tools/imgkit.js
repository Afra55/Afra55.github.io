(() => {
  "use strict";

  const P = window.DevToolsPure;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  if (!P || !$("#imgkit")) return;

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
    }, 1400);
  }

  function setError(el, msg) {
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }

  function formatBytes(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return "—";
    if (num < 1024) return `${num} B`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
    return `${(num / (1024 * 1024)).toFixed(2)} MB`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function loadImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        resolve(img);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error(`无法读取图片：${file.name}`));
      };
      img.src = url;
    });
  }

  function canvasToBlob(canvas, mime, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => {
          if (!blob) reject(new Error("导出失败（浏览器可能不支持该格式）"));
          else resolve(blob);
        },
        mime,
        quality
      );
    });
  }

  async function encodeCanvas(canvas, format, quality, targetBytes) {
    const mime = P.mimeFromFormat(format);
    const supportsQuality = mime === "image/jpeg" || mime === "image/webp";
    if (!supportsQuality || !targetBytes || targetBytes <= 0) {
      const q = supportsQuality ? Math.min(1, Math.max(0.05, Number(quality) || 0.9)) : undefined;
      return canvasToBlob(canvas, mime, q);
    }
    let lo = 0.05;
    let hi = 1;
    let best = await canvasToBlob(canvas, mime, Number(quality) || 0.9);
    for (let i = 0; i < 10; i++) {
      const mid = (lo + hi) / 2;
      const blob = await canvasToBlob(canvas, mime, mid);
      if (blob.size > targetBytes) {
        hi = mid;
      } else {
        lo = mid;
        best = blob;
      }
    }
    if (best.size > targetBytes) {
      // last attempt at lowest quality
      best = await canvasToBlob(canvas, mime, 0.05);
    }
    return best;
  }

  function drawRoundedRectPath(ctx, x, y, w, h, r) {
    const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.arcTo(x + w, y, x + w, y + h, radius);
    ctx.arcTo(x + w, y + h, x, y + h, radius);
    ctx.arcTo(x, y + h, x, y, radius);
    ctx.arcTo(x, y, x + w, y, radius);
    ctx.closePath();
  }

  function applyOrientation(img, orientation) {
    const o = Number(orientation) || 1;
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    const swap = o >= 5 && o <= 8;
    const canvas = document.createElement("canvas");
    canvas.width = swap ? srcH : srcW;
    canvas.height = swap ? srcW : srcH;
    const ctx = canvas.getContext("2d");
    switch (o) {
      case 2:
        ctx.translate(srcW, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0);
        break;
      case 3:
        ctx.translate(srcW, srcH);
        ctx.rotate(Math.PI);
        ctx.drawImage(img, 0, 0);
        break;
      case 4:
        ctx.translate(0, srcH);
        ctx.scale(1, -1);
        ctx.drawImage(img, 0, 0);
        break;
      case 5:
        ctx.rotate(0.5 * Math.PI);
        ctx.scale(1, -1);
        ctx.drawImage(img, 0, 0);
        break;
      case 6:
        ctx.rotate(0.5 * Math.PI);
        ctx.translate(0, -srcH);
        ctx.drawImage(img, 0, 0);
        break;
      case 7:
        ctx.rotate(0.5 * Math.PI);
        ctx.translate(srcW, -srcH);
        ctx.scale(-1, 1);
        ctx.drawImage(img, 0, 0);
        break;
      case 8:
        ctx.rotate(-0.5 * Math.PI);
        ctx.translate(-srcW, 0);
        ctx.drawImage(img, 0, 0);
        break;
      default:
        ctx.drawImage(img, 0, 0);
        break;
    }
    return canvas;
  }

  const state = {
    items: [], // {id,file,img,buffer,exif,name,stitch:{zoom,pan,panCross}}
    selected: "",
    watermarkImage: null,
    previewUrl: "",
    stitchPreviewToken: 0,
  };

  const els = {
    error: $("#imgkit-error"),
    list: $("#imgkit-list"),
    file: $("#imgkit-file"),
    wmFile: $("#imgkit-wm-file"),
    info: $("#imgkit-info"),
    exif: $("#imgkit-exif"),
    preview: $("#imgkit-preview"),
    meta: $("#imgkit-meta"),
  };

  function selectedItem() {
    return state.items.find((it) => it.id === state.selected) || state.items[0] || null;
  }

  function readOptions() {
    const aspect = $("#imgkit-aspect")?.value || "free";
    const resizeMode = $("#imgkit-resize-mode")?.value || "max";
    return {
      format: $("#imgkit-format")?.value || "png",
      quality: Number($("#imgkit-quality")?.value || 0.9),
      targetKB: Number($("#imgkit-target-kb")?.value || 0),
      resizeMode,
      keepAspect: Boolean($("#imgkit-keep-aspect")?.checked),
      width: Number($("#imgkit-width")?.value || 0) || undefined,
      height: Number($("#imgkit-height")?.value || 0) || undefined,
      maxEdge: Number($("#imgkit-max-edge")?.value || 0) || undefined,
      percent: Number($("#imgkit-percent")?.value || 100) || 100,
      aspect,
      cropX: Number($("#imgkit-crop-x")?.value || 0),
      cropY: Number($("#imgkit-crop-y")?.value || 0),
      cropW: Number($("#imgkit-crop-w")?.value || 100),
      cropH: Number($("#imgkit-crop-h")?.value || 100),
      rotate: Number($("#imgkit-rotate")?.value || 0),
      flipH: Boolean($("#imgkit-flip-h")?.checked),
      flipV: Boolean($("#imgkit-flip-v")?.checked),
      stripExif: Boolean($("#imgkit-strip-exif")?.checked),
      round: Number($("#imgkit-round")?.value || 0),
      border: Number($("#imgkit-border")?.value || 0),
      borderColor: $("#imgkit-border-color")?.value || "#000000",
      wmText: $("#imgkit-wm-text")?.value || "",
      wmSize: Number($("#imgkit-wm-size")?.value || 24),
      wmColor: $("#imgkit-wm-color")?.value || "#ffffff",
      wmOpacity: Number($("#imgkit-wm-opacity")?.value || 0.45),
      wmPos: $("#imgkit-wm-pos")?.value || "br",
      wmScale: Number($("#imgkit-wm-scale")?.value || 20),
      stitchMode: $("#imgkit-stitch-mode")?.value || "horizontal",
      stitchEdge: Number($("#imgkit-stitch-edge")?.value || 0) || 0,
      stitchGap: Number($("#imgkit-stitch-gap")?.value || 8),
      stitchCols: Number($("#imgkit-stitch-cols")?.value || 2),
      stitchBg: $("#imgkit-stitch-bg")?.value || "#ffffff",
      iconPlatform: $("#imgkit-icon-platform")?.value || "android",
    };
  }

  function defaultStitchCrop() {
    return { zoom: 100, pan: 50, panCross: 50 };
  }

  function sourceSize(src) {
    if (!src) return { width: 1, height: 1 };
    const width = Math.max(1, Math.round(src.naturalWidth || src.width || 1));
    const height = Math.max(1, Math.round(src.naturalHeight || src.height || 1));
    return { width, height };
  }

  function cssAttrEscape(value) {
    if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
    return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function getOrientedSource(item) {
    if (!item) return null;
    if (item._oriented) return item._oriented;
    const orientation = Number(item.exif?.orientation) || 1;
    // Orientation 1: reuse the original image to avoid an extra full-size canvas copy.
    item._oriented = orientation === 1 ? item.img : applyOrientation(item.img, orientation);
    return item._oriented;
  }

  function resolveStitchEdge(mode, items, explicit) {
    const edge = Number(explicit);
    if (Number.isFinite(edge) && edge > 0) return Math.round(edge);
    const sizes = items.map((it) => sourceSize(getOrientedSource(it)));
    return P.suggestStitchEdge(sizes, mode === "vertical" ? "vertical" : "horizontal");
  }

  function buildAlignedStitchPieces(items, mode, edge) {
    return items.map((it) => {
      const src = getOrientedSource(it);
      const size = sourceSize(src);
      const crop = it.stitch || defaultStitchCrop();
      const aligned = P.calcAlignedStitchCrop(
        size.width,
        size.height,
        mode,
        edge,
        crop.zoom,
        crop.pan,
        crop.panCross
      );
      return { src, ...aligned };
    });
  }

  const STITCH_MAX_SIDE = 8192;
  const STITCH_MAX_PIXELS = 64 * 1024 * 1024;

  function assertStitchCanvasSize(width, height) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w > STITCH_MAX_SIDE || h > STITCH_MAX_SIDE || w * h > STITCH_MAX_PIXELS) {
      throw new Error(
        `拼接尺寸过大（${w}×${h}）。请减小「统一边长」或图片数量后再试（单边≤${STITCH_MAX_SIDE}）。`
      );
    }
    return { width: w, height: h };
  }

  function buildStitchCanvas(opts = {}) {
    const mode = opts.stitchMode || "horizontal";
    const gap = Math.max(0, Math.round(Number(opts.stitchGap) || 0));
    const cols = Math.max(1, Math.round(Number(opts.stitchCols) || 2));
    const bg = opts.stitchBg || "#ffffff";
    const maxEdge = Number(opts.previewMaxEdge) || 0;
    const items = state.items;
    if (items.length < 2) return null;

    let layout;
    let drawers;
    let edge = 0;

    if (mode === "grid") {
      drawers = items.map((it) => {
        const src = getOrientedSource(it);
        const size = sourceSize(src);
        return {
          src,
          cropX: 0,
          cropY: 0,
          cropW: size.width,
          cropH: size.height,
          outW: size.width,
          outH: size.height,
        };
      });
      layout = P.calcStitchLayout(
        drawers.map((d) => ({ width: d.outW, height: d.outH })),
        { mode: "grid", gap, cols }
      );
    } else {
      edge = resolveStitchEdge(mode, items, opts.stitchEdge);
      drawers = buildAlignedStitchPieces(items, mode, edge);
      layout = P.calcStitchLayout(
        drawers.map((d) => ({ width: d.outW, height: d.outH })),
        { mode, gap, equalEdge: edge }
      );
    }

    let scale = 1;
    if (maxEdge > 0) {
      const longest = Math.max(layout.width, layout.height, 1);
      if (longest > maxEdge) scale = maxEdge / longest;
    }

    const outW = Math.max(1, Math.round(layout.width * scale));
    const outH = Math.max(1, Math.round(layout.height * scale));
    // Export (no previewMaxEdge) must stay within safe canvas limits.
    if (!maxEdge) assertStitchCanvasSize(layout.width, layout.height);

    const canvas = document.createElement("canvas");
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建画布");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    layout.items.forEach((slot, idx) => {
      const d = drawers[idx];
      if (!d) return;
      // Round edges independently so scaled preview tiles do not leave 1px gaps.
      const dx = Math.round(slot.x * scale);
      const dy = Math.round(slot.y * scale);
      const dw = Math.max(1, Math.round((slot.x + slot.width) * scale) - dx);
      const dh = Math.max(1, Math.round((slot.y + slot.height) * scale) - dy);
      try {
        ctx.drawImage(d.src, d.cropX, d.cropY, d.cropW, d.cropH, dx, dy, dw, dh);
      } catch (err) {
        throw new Error(`拼接绘制失败（第 ${idx + 1} 张）：${err.message || err}`);
      }
    });
    return {
      canvas,
      layout,
      scale,
      width: layout.width,
      height: layout.height,
      mode,
      edge,
    };
  }

  function drawCropThumb(canvas, item, mode) {
    const src = getOrientedSource(item);
    if (!src || !canvas) return;
    const size = sourceSize(src);
    const css = 88;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(css * dpr);
    canvas.height = Math.round(css * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, css, css);
    ctx.fillStyle = "#0a101c";
    ctx.fillRect(0, 0, css, css);

    const fit = Math.min(css / size.width, css / size.height);
    const dw = size.width * fit;
    const dh = size.height * fit;
    const dx = (css - dw) / 2;
    const dy = (css - dh) / 2;
    ctx.drawImage(src, dx, dy, dw, dh);

    if (mode === "grid") return;
    const edge = resolveStitchEdge(mode, state.items, Number($("#imgkit-stitch-edge")?.value || 0) || 0);
    const crop = item.stitch || defaultStitchCrop();
    const aligned = P.calcAlignedStitchCrop(
      size.width,
      size.height,
      mode,
      edge,
      crop.zoom,
      crop.pan,
      crop.panCross
    );
    const rx = dx + aligned.cropX * fit;
    const ry = dy + aligned.cropY * fit;
    const rw = Math.max(2, aligned.cropW * fit);
    const rh = Math.max(2, aligned.cropH * fit);
    ctx.fillStyle = "rgba(8, 14, 26, 0.45)";
    ctx.beginPath();
    ctx.rect(dx, dy, dw, dh);
    ctx.rect(rx, ry, rw, rh);
    ctx.fill("evenodd");
    ctx.strokeStyle = "rgba(46, 196, 182, 0.95)";
    ctx.lineWidth = 2;
    ctx.strokeRect(rx, ry, rw, rh);
  }

  function renderStitchCrops() {
    const host = $("#imgkit-stitch-crops");
    const studio = $("#imgkit-stitch-studio");
    if (!host) return;
    const mode = $("#imgkit-stitch-mode")?.value || "horizontal";
    studio?.classList.toggle("is-grid", mode === "grid");

    if (state.items.length < 2) {
      host.innerHTML = `<p class="hint">添加至少 2 张图后，可在此调节每张图的取景区域。</p>`;
      return;
    }

    if (mode === "grid") {
      host.innerHTML = `<p class="hint">宫格模式按原图尺寸拼合，无需取景裁剪。切换横向/竖向可调节齐高/齐宽取景。</p>`;
      return;
    }

    const panLabel = mode === "vertical" ? "左右" : "上下";
    const crossLabel = mode === "vertical" ? "上下" : "左右";
    host.innerHTML = state.items
      .map((it) => {
        const s = it.stitch || defaultStitchCrop();
        const safeName = P.escapeHtml(it.name || "image");
        const safeId = P.escapeHtml(it.id);
        return `<div class="imgkit-stitch-crop" data-stitch-id="${safeId}">
          <div class="imgkit-stitch-crop-view" data-stitch-drag="${safeId}" title="拖拽平移取景">
            <canvas data-stitch-thumb="${safeId}"></canvas>
          </div>
          <div>
            <div class="imgkit-stitch-crop-meta">${safeName}</div>
            <div class="imgkit-stitch-crop-fields">
              <label>缩放<input type="range" min="100" max="400" step="1" value="${s.zoom}" data-stitch-field="zoom" data-stitch-id="${safeId}" /><span class="mono" data-stitch-val="zoom">${s.zoom}%</span></label>
              <label>${panLabel}<input type="range" min="0" max="100" step="1" value="${s.pan}" data-stitch-field="pan" data-stitch-id="${safeId}" /><span class="mono" data-stitch-val="pan">${s.pan}</span></label>
              <label>${crossLabel}<input type="range" min="0" max="100" step="1" value="${s.panCross}" data-stitch-field="panCross" data-stitch-id="${safeId}" /><span class="mono" data-stitch-val="panCross">${s.panCross}</span></label>
            </div>
          </div>
        </div>`;
      })
      .join("");

    state.items.forEach((it) => {
      const c = host.querySelector(`canvas[data-stitch-thumb="${cssAttrEscape(it.id)}"]`);
      drawCropThumb(c, it, mode);
    });
  }

  function scheduleStitchPreview() {
    const token = ++state.stitchPreviewToken;
    requestAnimationFrame(() => {
      if (token !== state.stitchPreviewToken) return;
      updateStitchPreview();
    });
  }

  function updateStitchPreview() {
    const canvas = $("#imgkit-stitch-preview");
    const meta = $("#imgkit-stitch-meta");
    if (!canvas) return;
    if (state.items.length < 2) {
      canvas.width = 1;
      canvas.height = 1;
      if (meta) meta.textContent = "添加至少 2 张图后显示拼接预览";
      renderStitchCrops();
      return;
    }
    const opts = readOptions();
    let built;
    try {
      built = buildStitchCanvas({ ...opts, previewMaxEdge: 1400 });
    } catch (err) {
      if (meta) meta.textContent = err.message || String(err);
      return;
    }
    if (!built) return;
    const ctx = canvas.getContext("2d");
    canvas.width = built.canvas.width;
    canvas.height = built.canvas.height;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(built.canvas, 0, 0);
    if (meta) {
      const edgeTip =
        built.mode === "grid"
          ? "宫格"
          : built.mode === "vertical"
            ? `齐宽 ${built.edge}px`
            : `齐高 ${built.edge}px`;
      meta.textContent = `预览 ${built.width}×${built.height} · ${edgeTip} · ${state.items.length} 张`;
    }
    const host = $("#imgkit-stitch-crops");
    const mode = opts.stitchMode;
    const cards = host ? host.querySelectorAll("[data-stitch-id]").length : 0;
    // Rebuild controls when count drifts or when leaving/entering grid mode leftovers.
    if (mode === "grid") {
      if (!host || host.querySelector("[data-stitch-id]")) renderStitchCrops();
    } else if (!host || cards !== state.items.length) {
      renderStitchCrops();
    } else {
      state.items.forEach((it) => {
        const c = host.querySelector(`canvas[data-stitch-thumb="${cssAttrEscape(it.id)}"]`);
        drawCropThumb(c, it, mode);
      });
    }
  }

  function setStitchField(id, field, value) {
    const item = state.items.find((it) => it.id === id);
    if (!item) return;
    if (!item.stitch) item.stitch = defaultStitchCrop();
    let v = Number(value);
    if (!Number.isFinite(v)) return;
    if (field === "zoom") v = Math.max(100, Math.min(400, Math.round(v)));
    else if (field === "pan" || field === "panCross") v = Math.max(0, Math.min(100, Math.round(v)));
    else return;
    item.stitch[field] = v;
    const card = document.querySelector(`.imgkit-stitch-crop[data-stitch-id="${cssAttrEscape(id)}"]`);
    const valEl = card?.querySelector(`[data-stitch-val="${field}"]`);
    const input = card?.querySelector(`input[data-stitch-field="${field}"]`);
    if (valEl) valEl.textContent = field === "zoom" ? `${v}%` : String(v);
    if (input && Number(input.value) !== v) input.value = String(v);
    scheduleStitchPreview();
  }

  function watermarkAnchor(pos, canvasW, canvasH, markW, markH, pad = 16) {
    const p = String(pos || "br");
    let x = pad;
    let y = pad;
    if (p.includes("c") && !p.includes("l") && !p.includes("r")) x = Math.round((canvasW - markW) / 2);
    if (p.includes("r")) x = canvasW - markW - pad;
    if (p.includes("m") || p === "c") y = Math.round((canvasH - markH) / 2);
    if (p.includes("b")) y = canvasH - markH - pad;
    if (p === "c") {
      x = Math.round((canvasW - markW) / 2);
      y = Math.round((canvasH - markH) / 2);
    }
    return { x: Math.max(0, x), y: Math.max(0, y) };
  }

  async function processItem(item, opts, { skipResize } = {}) {
    const exif = item.exif || { orientation: 1 };
    // Canvas re-encode cannot preserve EXIF; always bake orientation into pixels.
    const base = applyOrientation(item.img, exif.orientation || 1);

    const rot = ((Number(opts.rotate) || 0) % 360 + 360) % 360;
    let w = base.width;
    let h = base.height;
    const swap = rot === 90 || rot === 270;
    const rotated = document.createElement("canvas");
    rotated.width = swap ? h : w;
    rotated.height = swap ? w : h;
    const rctx = rotated.getContext("2d");
    rctx.translate(rotated.width / 2, rotated.height / 2);
    rctx.rotate((rot * Math.PI) / 180);
    rctx.scale(opts.flipH ? -1 : 1, opts.flipV ? -1 : 1);
    rctx.drawImage(base, -w / 2, -h / 2);
    w = rotated.width;
    h = rotated.height;

    const crop = P.calcCropRect(w, h, {
      aspect: opts.aspect,
      usePercent: true,
      xPercent: opts.cropX,
      yPercent: opts.cropY,
      wPercent: opts.cropW,
      hPercent: opts.cropH,
      center: opts.aspect !== "free",
    });

    let outW = crop.width;
    let outH = crop.height;
    if (!skipResize) {
      const resized = P.calcResizeSize(crop.width, crop.height, {
        mode: opts.resizeMode,
        keepAspect: opts.keepAspect,
        width: opts.width,
        height: opts.height,
        maxEdge: opts.maxEdge,
        percent: opts.percent,
      });
      outW = resized.width;
      outH = resized.height;
    }

    const border = Math.max(0, Math.round(opts.border || 0));
    const canvas = document.createElement("canvas");
    canvas.width = outW + border * 2;
    canvas.height = outH + border * 2;
    const ctx = canvas.getContext("2d");

    if (border > 0) {
      ctx.fillStyle = opts.borderColor || "#000";
      drawRoundedRectPath(ctx, 0, 0, canvas.width, canvas.height, (opts.round || 0) + border);
      ctx.fill();
    }

    ctx.save();
    if (opts.round > 0) {
      drawRoundedRectPath(ctx, border, border, outW, outH, opts.round);
      ctx.clip();
    }
    ctx.drawImage(
      rotated,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      border,
      border,
      outW,
      outH
    );
    ctx.restore();

    // watermark
    ctx.save();
    ctx.globalAlpha = Math.min(1, Math.max(0, Number(opts.wmOpacity) || 0.45));
    if (opts.wmText) {
      ctx.font = `bold ${Math.max(10, opts.wmSize || 24)}px sans-serif`;
      ctx.fillStyle = opts.wmColor || "#fff";
      const metrics = ctx.measureText(opts.wmText);
      const tw = metrics.width;
      const th = Math.max(10, opts.wmSize || 24);
      const pos = watermarkAnchor(opts.wmPos, canvas.width, canvas.height, tw, th);
      ctx.fillText(opts.wmText, pos.x, pos.y + th);
    }
    if (state.watermarkImage) {
      const scale = Math.min(1, Math.max(0.02, (Number(opts.wmScale) || 20) / 100));
      const mw = Math.max(1, Math.round(canvas.width * scale));
      const mh = Math.max(
        1,
        Math.round((mw * state.watermarkImage.naturalHeight) / state.watermarkImage.naturalWidth)
      );
      const pos = watermarkAnchor(opts.wmPos, canvas.width, canvas.height, mw, mh);
      ctx.drawImage(state.watermarkImage, pos.x, pos.y, mw, mh);
    }
    ctx.restore();

    const targetBytes = opts.targetKB > 0 ? opts.targetKB * 1024 : 0;
    const blob = await encodeCanvas(canvas, opts.format, opts.quality, targetBytes);
    return { canvas, blob, width: canvas.width, height: canvas.height };
  }

  function renderList() {
    if (!els.list) return;
    if (!state.items.length) {
      els.list.innerHTML = `<div class="imgkit-empty">尚未添加图片</div>`;
      return;
    }
    els.list.innerHTML = state.items
      .map((it) => {
        const active = it.id === state.selected ? " is-active" : "";
        return `<button type="button" class="imgkit-thumb${active}" data-img-id="${it.id}">
          <img src="${it.thumbUrl}" alt="" />
          <span>${P.escapeHtml(it.name)}</span>
        </button>`;
      })
      .join("");
  }

  function updateInfo(item, processed) {
    if (!els.info) return;
    if (!item) {
      els.info.textContent = "选择或添加图片后显示信息";
      if (els.exif) els.exif.textContent = "—";
      return;
    }
    const type = item.file.type || "unknown";
    const colorMode =
      type.includes("png") || type.includes("webp")
        ? "RGBA / sRGB（画布导出）"
        : type.includes("jpeg")
          ? "YCbCr / sRGB（常见 JPEG）"
          : "浏览器解码后按 RGBA 处理";
    const lines = [
      `文件: ${item.name}`,
      `原始体积: ${formatBytes(item.file.size)}`,
      `原始分辨率: ${item.img.naturalWidth} × ${item.img.naturalHeight}`,
      `格式: ${type}`,
      `色彩: ${colorMode}`,
    ];
    if (processed) {
      lines.push(
        `导出分辨率: ${processed.width} × ${processed.height}`,
        `导出体积: ${formatBytes(processed.blob.size)}`,
        `导出格式: ${processed.blob.type || "—"}`
      );
    }
    els.info.textContent = lines.join("\n");
    if (els.exif) {
      const tags = item.exif?.tags || {};
      const keys = Object.keys(tags);
      els.exif.textContent = keys.length
        ? keys.map((k) => `${k}: ${tags[k]}`).join("\n")
        : item.exif?.format === "jpeg"
          ? "未解析到常用 EXIF 字段（或已被清除）"
          : "非 JPEG，或无可读 EXIF";
    }
  }

  async function refreshPreview() {
    const item = selectedItem();
    setError(els.error, "");
    if (!item) {
      if (els.preview) {
        els.preview.removeAttribute("src");
        els.preview.hidden = true;
      }
      updateInfo(null);
      if (els.meta) els.meta.textContent = "本地处理，不会上传";
      return;
    }
    try {
      if (els.meta) els.meta.textContent = "处理中…";
      const result = await processItem(item, readOptions());
      if (state.previewUrl) URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = URL.createObjectURL(result.blob);
      if (els.preview) {
        els.preview.src = state.previewUrl;
        els.preview.hidden = false;
      }
      updateInfo(item, result);
      if (els.meta) els.meta.textContent = `预览约 ${formatBytes(result.blob.size)}`;
    } catch (err) {
      setError(els.error, err.message || String(err));
      if (els.meta) els.meta.textContent = "处理失败";
    }
  }

  async function addFiles(fileList) {
    const files = [...fileList].filter((f) => f.type.startsWith("image/"));
    if (!files.length) {
      toast("请选择图片文件");
      return;
    }
    for (const file of files) {
      const img = await loadImageFromFile(file);
      const buffer = await file.arrayBuffer();
      const exif = P.parseJpegExif(buffer);
      const thumbUrl = URL.createObjectURL(file);
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      state.items.push({
        id,
        file,
        img,
        buffer,
        exif,
        name: file.name,
        thumbUrl,
        stitch: defaultStitchCrop(),
        _oriented: null,
      });
      state.selected = id;
    }
    renderList();
    renderStitchCrops();
    await refreshPreview();
    scheduleStitchPreview();
    toast(`已添加 ${files.length} 张`);
  }

  async function exportCurrent() {
    const item = selectedItem();
    if (!item) throw new Error("请先添加图片");
    const opts = readOptions();
    const result = await processItem(item, opts);
    const base = item.name.replace(/\.[^.]+$/, "");
    downloadBlob(result.blob, `${base}.${P.extFromFormat(opts.format)}`);
    toast("已导出当前图片");
  }

  async function exportBatchZip() {
    if (!state.items.length) throw new Error("请先添加图片");
    if (typeof JSZip === "undefined") throw new Error("JSZip 未加载");
    const opts = readOptions();
    const zip = new JSZip();
    const folder = zip.folder("images");
    for (let i = 0; i < state.items.length; i++) {
      const item = state.items[i];
      if (els.meta) els.meta.textContent = `批量处理 ${i + 1}/${state.items.length}`;
      const result = await processItem(item, opts);
      const base = item.name.replace(/\.[^.]+$/, "");
      folder.file(`${base}.${P.extFromFormat(opts.format)}`, result.blob);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `images-batch-${Date.now()}.zip`);
    toast("批量 ZIP 已下载");
    if (els.meta) els.meta.textContent = "批量完成";
  }

  async function exportStitch() {
    if (state.items.length < 2) throw new Error("拼接至少需要 2 张图");
    const opts = readOptions();
    const built = buildStitchCanvas(opts);
    if (!built) throw new Error("无法生成拼接图");
    const blob = await encodeCanvas(built.canvas, opts.format, opts.quality, 0);
    downloadBlob(blob, `stitch.${P.extFromFormat(opts.format)}`);
    toast(`拼接图已导出（${built.width}×${built.height}）`);
  }

  async function exportNineGrid() {
    const item = selectedItem();
    if (!item) throw new Error("请先选择图片");
    if (typeof JSZip === "undefined") throw new Error("JSZip 未加载");
    const opts = readOptions();
    const result = await processItem(item, opts);
    const url = URL.createObjectURL(result.blob);
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    URL.revokeObjectURL(url);
    const rects = P.calcNineGridRects(img.naturalWidth, img.naturalHeight);
    const zip = new JSZip();
    const folder = zip.folder("nine-grid");
    for (const rect of rects) {
      const c = document.createElement("canvas");
      c.width = rect.width;
      c.height = rect.height;
      c.getContext("2d").drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, rect.width, rect.height);
      const blob = await encodeCanvas(c, opts.format, opts.quality, 0);
      folder.file(`part-${rect.index}.${P.extFromFormat(opts.format)}`, blob);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `nine-grid-${Date.now()}.zip`);
    toast("九宫格已导出");
  }

  async function exportAppIcons() {
    const item = selectedItem();
    if (!item) throw new Error("请先选择图片");
    if (typeof JSZip === "undefined") throw new Error("JSZip 未加载");
    const opts = readOptions();
    // Use square center crop then scale to each size
    const squareOpts = { ...opts, aspect: "1:1", resizeMode: "wh", keepAspect: false };
    const base = await processItem(item, { ...squareOpts, width: 1024, height: 1024 }, {});
    const url = URL.createObjectURL(base.blob);
    const img = await new Promise((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = url;
    });
    URL.revokeObjectURL(url);
    const sizes = P.APP_ICON_SIZES[opts.iconPlatform] || P.APP_ICON_SIZES.android;
    const zip = new JSZip();
    const folder = zip.folder(`app-icons-${opts.iconPlatform}`);
    for (const size of sizes) {
      const c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      c.getContext("2d").drawImage(img, 0, 0, size, size);
      const blob = await encodeCanvas(c, "png", 1, 0);
      folder.file(`icon-${size}.png`, blob);
    }
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, `app-icons-${opts.iconPlatform}-${Date.now()}.zip`);
    toast("App 图标包已导出");
  }

  function syncResizeFields() {
    const mode = $("#imgkit-resize-mode")?.value || "max";
    $$("[data-resize-field]").forEach((el) => {
      const show = el.dataset.resizeField === mode;
      el.hidden = !show;
    });
  }

  // events
  $("#imgkit-file")?.addEventListener("change", async (e) => {
    try {
      await addFiles(e.target.files || []);
    } catch (err) {
      setError(els.error, err.message || String(err));
    } finally {
      e.target.value = "";
    }
  });

  $("#imgkit-clear")?.addEventListener("click", () => {
    state.items.forEach((it) => {
      try {
        URL.revokeObjectURL(it.thumbUrl);
      } catch (_) {
        /* ignore */
      }
    });
    state.items = [];
    state.selected = "";
    renderList();
    refreshPreview();
    renderStitchCrops();
    scheduleStitchPreview();
  });

  els.list?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-img-id]");
    if (!btn) return;
    state.selected = btn.dataset.imgId;
    renderList();
    refreshPreview();
  });

  [
    "imgkit-format",
    "imgkit-quality",
    "imgkit-target-kb",
    "imgkit-resize-mode",
    "imgkit-keep-aspect",
    "imgkit-width",
    "imgkit-height",
    "imgkit-max-edge",
    "imgkit-percent",
    "imgkit-aspect",
    "imgkit-crop-x",
    "imgkit-crop-y",
    "imgkit-crop-w",
    "imgkit-crop-h",
    "imgkit-rotate",
    "imgkit-flip-h",
    "imgkit-flip-v",
    "imgkit-strip-exif",
    "imgkit-round",
    "imgkit-border",
    "imgkit-border-color",
    "imgkit-wm-text",
    "imgkit-wm-size",
    "imgkit-wm-color",
    "imgkit-wm-opacity",
    "imgkit-wm-pos",
    "imgkit-wm-scale",
  ].forEach((id) => {
    const el = document.getElementById(id);
    el?.addEventListener("input", () => {
      if (id === "imgkit-resize-mode") syncResizeFields();
      refreshPreview();
    });
    el?.addEventListener("change", () => {
      if (id === "imgkit-resize-mode") syncResizeFields();
      refreshPreview();
    });
  });

  [
    "imgkit-stitch-mode",
    "imgkit-stitch-edge",
    "imgkit-stitch-gap",
    "imgkit-stitch-cols",
    "imgkit-stitch-bg",
  ].forEach((id) => {
    const el = document.getElementById(id);
    el?.addEventListener("input", () => {
      if (id === "imgkit-stitch-mode") renderStitchCrops();
      scheduleStitchPreview();
    });
    el?.addEventListener("change", () => {
      if (id === "imgkit-stitch-mode") renderStitchCrops();
      scheduleStitchPreview();
    });
  });

  const stitchCropsHost = $("#imgkit-stitch-crops");
  stitchCropsHost?.addEventListener("input", (e) => {
    const input = e.target.closest("input[data-stitch-field]");
    if (!input) return;
    setStitchField(input.dataset.stitchId, input.dataset.stitchField, input.value);
  });

  // Drag to pan crop window on thumbnails
  let dragState = null;
  stitchCropsHost?.addEventListener("pointerdown", (e) => {
    const view = e.target.closest("[data-stitch-drag]");
    if (!view) return;
    const id = view.dataset.stitchDrag;
    const item = state.items.find((it) => it.id === id);
    if (!item) return;
    if (!item.stitch) item.stitch = defaultStitchCrop();
    view.setPointerCapture(e.pointerId);
    view.classList.add("is-dragging");
    dragState = {
      id,
      x: e.clientX,
      y: e.clientY,
      pan: item.stitch.pan,
      panCross: item.stitch.panCross,
    };
    e.preventDefault();
  });
  stitchCropsHost?.addEventListener("pointermove", (e) => {
    if (!dragState) return;
    const mode = $("#imgkit-stitch-mode")?.value || "horizontal";
    const dx = e.clientX - dragState.x;
    const dy = e.clientY - dragState.y;
    // Dragging content feels natural: move opposite to pan direction
    if (mode === "vertical") {
      setStitchField(dragState.id, "pan", dragState.pan - dx * 0.6);
      setStitchField(dragState.id, "panCross", dragState.panCross - dy * 0.6);
    } else {
      setStitchField(dragState.id, "pan", dragState.pan - dy * 0.6);
      setStitchField(dragState.id, "panCross", dragState.panCross - dx * 0.6);
    }
  });
  const endDrag = (e) => {
    if (!dragState) return;
    const view = stitchCropsHost?.querySelector(`[data-stitch-drag="${cssAttrEscape(dragState.id)}"]`);
    view?.classList.remove("is-dragging");
    try {
      view?.releasePointerCapture?.(e.pointerId);
    } catch (_) {
      /* ignore */
    }
    dragState = null;
  };
  stitchCropsHost?.addEventListener("pointerup", endDrag);
  stitchCropsHost?.addEventListener("pointercancel", endDrag);

  $("#imgkit-wm-file")?.addEventListener("change", async (e) => {
    try {
      const file = e.target.files?.[0];
      if (!file) {
        state.watermarkImage = null;
        await refreshPreview();
        return;
      }
      state.watermarkImage = await loadImageFromFile(file);
      await refreshPreview();
      toast("水印图已加载");
    } catch (err) {
      setError(els.error, err.message || String(err));
    } finally {
      e.target.value = "";
    }
  });

  $("#imgkit-wm-clear")?.addEventListener("click", async () => {
    state.watermarkImage = null;
    await refreshPreview();
  });

  $("#imgkit-export")?.addEventListener("click", () =>
    exportCurrent().catch((err) => setError(els.error, err.message || String(err)))
  );
  $("#imgkit-batch")?.addEventListener("click", () =>
    exportBatchZip().catch((err) => setError(els.error, err.message || String(err)))
  );
  $("#imgkit-stitch")?.addEventListener("click", () =>
    exportStitch().catch((err) => setError(els.error, err.message || String(err)))
  );
  $("#imgkit-nine")?.addEventListener("click", () =>
    exportNineGrid().catch((err) => setError(els.error, err.message || String(err)))
  );
  $("#imgkit-icons")?.addEventListener("click", () =>
    exportAppIcons().catch((err) => setError(els.error, err.message || String(err)))
  );

  // drop zone
  const drop = $("#imgkit-drop");
  drop?.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("is-drag");
  });
  drop?.addEventListener("dragleave", () => drop.classList.remove("is-drag"));
  drop?.addEventListener("drop", async (e) => {
    e.preventDefault();
    drop.classList.remove("is-drag");
    try {
      await addFiles(e.dataTransfer?.files || []);
    } catch (err) {
      setError(els.error, err.message || String(err));
    }
  });

  syncResizeFields();
  renderList();
  updateInfo(null);
  renderStitchCrops();
  scheduleStitchPreview();
})();
