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
    items: [], // {id,file,img,buffer,exif,name}
    selected: "",
    watermarkImage: null,
    previewUrl: "",
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
      stitchGap: Number($("#imgkit-stitch-gap")?.value || 8),
      stitchCols: Number($("#imgkit-stitch-cols")?.value || 2),
      stitchBg: $("#imgkit-stitch-bg")?.value || "#ffffff",
      iconPlatform: $("#imgkit-icon-platform")?.value || "android",
    };
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
      });
      state.selected = id;
    }
    renderList();
    await refreshPreview();
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
    const processed = [];
    for (const item of state.items) {
      const result = await processItem(item, opts);
      const url = URL.createObjectURL(result.blob);
      const img = await loadImageFromFile(new File([result.blob], item.name, { type: result.blob.type }));
      URL.revokeObjectURL(url);
      processed.push({ img, width: img.naturalWidth, height: img.naturalHeight });
    }
    const layout = P.calcStitchLayout(
      processed.map((p) => ({ width: p.width, height: p.height })),
      { mode: opts.stitchMode, gap: opts.stitchGap, cols: opts.stitchCols }
    );
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, layout.width);
    canvas.height = Math.max(1, layout.height);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = opts.stitchBg || "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    layout.items.forEach((slot, idx) => {
      ctx.drawImage(processed[idx].img, slot.x, slot.y, slot.width, slot.height);
    });
    const blob = await encodeCanvas(canvas, opts.format, opts.quality, 0);
    downloadBlob(blob, `stitch.${P.extFromFormat(opts.format)}`);
    toast("拼接图已导出");
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
})();
