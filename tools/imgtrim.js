(() => {
  "use strict";

  const P = window.DevToolsPure;
  const $ = (sel, root = document) => root.querySelector(sel);
  const panel = $("#imgtrim");
  if (!panel) return;

  const fileInput = $("#imgtrim-file");
  const metaEl = $("#imgtrim-meta");
  const errorEl = $("#imgtrim-error");
  const listEl = $("#imgtrim-list");
  const previewEl = $("#imgtrim-preview");
  const previewMeta = $("#imgtrim-preview-meta");
  const modeEl = $("#imgtrim-mode");
  const tolEl = $("#imgtrim-tolerance");
  const customColorEl = $("#imgtrim-custom-color");
  const customRow = $("#imgtrim-custom-row");
  const runBtn = $("#imgtrim-run");
  const zipBtn = $("#imgtrim-zip");
  const clearBtn = $("#imgtrim-clear");

  /** @type {{ id: string, file: File, img?: HTMLImageElement, bounds?: {x:number,y:number,w:number,h:number}, outBlob?: Blob, note: string, selected: boolean }[]} */
  let items = [];
  let previewId = "";
  let busy = false;

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

  function setError(msg) {
    if (!errorEl) return;
    if (!msg) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = msg;
  }

  function formatBytes(n) {
    const num = Number(n);
    if (!Number.isFinite(num)) return "—";
    if (num < 1024) return `${num} B`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
    return `${(num / (1024 * 1024)).toFixed(2)} MB`;
  }

  function uid() {
    return `it-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function parseHexColor(raw) {
    const text = String(raw || "").trim();
    const m = text.match(/^#?([0-9a-f]{6})$/i);
    if (!m) return null;
    const hex = m[1];
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: 255,
    };
  }

  function colorKey(r, g, b, a, tol) {
    const q = (v) => Math.round(v / Math.max(1, tol)) * Math.max(1, tol);
    return `${q(r)}|${q(g)}|${q(b)}|${a < 128 ? 0 : 255}`;
  }

  function colorsMatch(a, b, tol) {
    if (a.a < 128 && b.a < 128) return true;
    if (Math.abs(a.a - b.a) > tol + 8) return false;
    return (
      Math.abs(a.r - b.r) <= tol &&
      Math.abs(a.g - b.g) <= tol &&
      Math.abs(a.b - b.b) <= tol
    );
  }

  function pixelAt(data, w, x, y) {
    const i = (y * w + x) * 4;
    return { r: data[i], g: data[i + 1], b: data[i + 2], a: data[i + 3] };
  }

  function detectBorderColor(imageData, mode, custom) {
    const { width: w, height: h, data } = imageData;
    if (mode === "white") return { r: 255, g: 255, b: 255, a: 255 };
    if (mode === "black") return { r: 0, g: 0, b: 0, a: 255 };
    if (mode === "custom" && custom) return custom;

    const tol = 12;
    const counts = new Map();
    const sample = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const p = pixelAt(data, w, x, y);
      const key = colorKey(p.r, p.g, p.b, p.a, tol);
      counts.set(key, (counts.get(key) || 0) + 1);
    };
    for (let x = 0; x < w; x++) {
      sample(x, 0);
      sample(x, h - 1);
    }
    for (let y = 0; y < h; y++) {
      sample(0, y);
      sample(w - 1, y);
    }
    let best = pixelAt(data, w, 0, 0);
    let bestN = 0;
    counts.forEach((n, key) => {
      if (n > bestN) {
        bestN = n;
        const [r, g, b, a] = key.split("|").map(Number);
        best = { r, g, b, a };
      }
    });
    return best;
  }

  function rowMatchesBorder(data, w, y, x0, x1, border, tol) {
    for (let x = x0; x <= x1; x++) {
      if (!colorsMatch(pixelAt(data, w, x, y), border, tol)) return false;
    }
    return true;
  }

  function colMatchesBorder(data, w, h, x, y0, y1, border, tol) {
    for (let y = y0; y <= y1; y++) {
      if (!colorsMatch(pixelAt(data, w, x, y), border, tol)) return false;
    }
    return true;
  }

  function detectSolidBorderBounds(imageData, mode, customColor, tolerance) {
    const { width: w, height: h, data } = imageData;
    const tol = Math.max(0, Math.min(64, Number(tolerance) || 0));
    const border = detectBorderColor(imageData, mode, customColor);
    let top = 0;
    let bottom = h - 1;
    let left = 0;
    let right = w - 1;

    while (top < bottom && rowMatchesBorder(data, w, top, left, right, border, tol)) top++;
    while (bottom > top && rowMatchesBorder(data, w, bottom, left, right, border, tol)) bottom--;
    while (left < right && colMatchesBorder(data, w, h, left, top, bottom, border, tol)) left++;
    while (right > left && colMatchesBorder(data, w, h, right, top, bottom, border, tol)) right--;

    const cw = right - left + 1;
    const ch = bottom - top + 1;
    if (cw < 1 || ch < 1 || (top === 0 && left === 0 && cw === w && ch === h)) {
      return { x: 0, y: 0, w, h, trimmed: false, border };
    }
    return { x: left, y: top, w: cw, h: ch, trimmed: true, border };
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
          if (!blob) reject(new Error("导出失败"));
          else resolve(blob);
        },
        mime,
        quality
      );
    });
  }

  function mimeFromName(name) {
    const n = String(name || "").toLowerCase();
    if (/\.jpe?g$/i.test(n)) return "image/jpeg";
    if (/\.webp$/i.test(n)) return "image/webp";
    if (/\.gif$/i.test(n)) return "image/png";
    return "image/png";
  }

  function outName(file, bounds) {
    const base = String(file.name || "image").replace(/\.[^.]+$/, "") || "image";
    if (!bounds?.trimmed) return `${base}.png`;
    return `${base}-trim.png`;
  }

  async function trimItem(item, mode, custom, tolerance) {
    const img = item.img;
    if (!img) throw new Error("图片未加载");
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth || img.width;
    canvas.height = img.naturalHeight || img.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const bounds = detectSolidBorderBounds(imageData, mode, custom, tolerance);
    item.bounds = bounds;
    if (!bounds.trimmed) {
      item.note = `${canvas.width}×${canvas.height} · 未检测到可裁纯色边`;
      item.outBlob = await canvasToBlob(canvas, mimeFromName(item.file.name), 0.92);
      return item;
    }
    const out = document.createElement("canvas");
    out.width = bounds.w;
    out.height = bounds.h;
    out.getContext("2d").drawImage(canvas, bounds.x, bounds.y, bounds.w, bounds.h, 0, 0, bounds.w, bounds.h);
    item.outBlob = await canvasToBlob(out, "image/png", 0.92);
    const cutX = bounds.x + (canvas.width - bounds.x - bounds.w);
    const cutY = bounds.y + (canvas.height - bounds.y - bounds.h);
    item.note = `${canvas.width}×${canvas.height} → ${bounds.w}×${bounds.h} · 裁边 上${bounds.y} 下${cutY} 左${bounds.x} 右${cutX}`;
    return item;
  }

  function syncCustomRow() {
    if (customRow) customRow.hidden = modeEl?.value !== "custom";
  }

  function setButtons() {
    const ready = items.filter((it) => it.outBlob).length;
    if (runBtn) runBtn.disabled = items.length === 0 || busy;
    if (zipBtn) zipBtn.disabled = ready < 1 || busy;
    if (clearBtn) clearBtn.disabled = busy && items.length === 0;
  }

  function renderPreview() {
    const item = items.find((it) => it.id === previewId);
    if (!item?.outBlob) {
      if (previewEl) {
        previewEl.hidden = true;
        previewEl.removeAttribute("src");
      }
      if (previewMeta) previewMeta.textContent = "处理后会显示预览";
      return;
    }
    const url = URL.createObjectURL(item.outBlob);
    if (previewEl._url) {
      try {
        URL.revokeObjectURL(previewEl._url);
      } catch (_) {}
    }
    previewEl._url = url;
    previewEl.src = url;
    previewEl.hidden = false;
    if (previewMeta) previewMeta.textContent = item.note || item.file.name;
  }

  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = "";
    if (!items.length) {
      if (metaEl) metaEl.textContent = "支持 PNG / JPEG / WebP / GIF（动图仅首帧）。本地处理，不会上传。";
      setButtons();
      return;
    }
    if (metaEl) metaEl.textContent = `已选 ${items.length} 张 · 点「裁掉色边」批量处理`;
    items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "imgtrim-row";
      const head = document.createElement("div");
      head.className = "imgtrim-row-head";
      const title = document.createElement("strong");
      title.textContent = item.file.name;
      const meta = document.createElement("span");
      meta.className = "hint tight";
      meta.textContent = item.note || formatBytes(item.file.size);
      const actions = document.createElement("div");
      actions.className = "btn-row";
      const previewBtn = document.createElement("button");
      previewBtn.type = "button";
      previewBtn.className = "ghost-btn";
      previewBtn.textContent = previewId === item.id ? "预览中" : "预览";
      previewBtn.disabled = !item.outBlob;
      previewBtn.addEventListener("click", () => {
        previewId = item.id;
        renderPreview();
        renderList();
      });
      actions.appendChild(previewBtn);
      if (item.outBlob) {
        const dlBtn = document.createElement("button");
        dlBtn.type = "button";
        dlBtn.className = "secondary-btn";
        dlBtn.textContent = "下载";
        dlBtn.addEventListener("click", () => {
          downloadBlob(item.outBlob, outName(item.file, item.bounds));
        });
        actions.appendChild(dlBtn);
      }
      head.append(title, meta, actions);
      row.appendChild(head);
      listEl.appendChild(row);
    });
    setButtons();
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  async function ensureJsZip() {
    if (typeof globalThis.JSZip === "function") return globalThis.JSZip;
    const build = window.TOOLS_BUILD || "";
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = `./vendor/jszip.min.js?v=${encodeURIComponent(build)}`;
      s.onload = resolve;
      s.onerror = () => reject(new Error("JSZip 加载失败"));
      document.head.appendChild(s);
    });
    if (typeof globalThis.JSZip !== "function") throw new Error("JSZip 未加载");
    return globalThis.JSZip;
  }

  async function addFiles(fileList) {
    const files = [...(fileList || [])].filter((f) => {
      const type = String(f.type || "").toLowerCase();
      return type.startsWith("image/") || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name || "");
    });
    if (!files.length) {
      setError("请选择图片文件");
      return;
    }
    setError("");
    for (const file of files) {
      try {
        const img = await loadImageFromFile(file);
        items.push({
          id: uid(),
          file,
          img,
          note: `${img.naturalWidth || img.width}×${img.naturalHeight || img.height}`,
          selected: true,
        });
      } catch (err) {
        setError(err.message || String(err));
      }
    }
    if (items.length && !previewId) previewId = items[0].id;
    renderList();
    toast(`已添加 ${files.length} 张`);
  }

  async function runTrimAll() {
    if (!items.length || busy) return;
    busy = true;
    setError("");
    setButtons();
    const mode = modeEl?.value || "auto";
    const custom = mode === "custom" ? parseHexColor(customColorEl?.value) : null;
    if (mode === "custom" && !custom) {
      setError("自定义模式请输入有效色值，如 #000000");
      busy = false;
      setButtons();
      return;
    }
    const tolerance = Number(tolEl?.value) || 8;
    let trimmed = 0;
    try {
      for (const item of items) {
        item.outBlob = undefined;
        await trimItem(item, mode, custom, tolerance);
        if (item.bounds?.trimmed) trimmed++;
      }
      renderList();
      renderPreview();
      toast(trimmed ? `完成，${trimmed} 张已裁边` : "完成，均未检测到可裁纯色边");
    } catch (err) {
      setError(err.message || String(err));
    } finally {
      busy = false;
      setButtons();
    }
  }

  async function packZip() {
    const ready = items.filter((it) => it.outBlob);
    if (!ready.length) {
      toast("请先处理图片");
      return;
    }
    const JSZip = await ensureJsZip();
    const zip = new JSZip();
    ready.forEach((it) => zip.file(outName(it.file, it.bounds), it.outBlob));
    const blob = await zip.generateAsync({ type: "blob" });
    downloadBlob(blob, "trimmed-images.zip");
    toast(`已打包 ${ready.length} 张`);
  }

  function clearAll() {
    items = [];
    previewId = "";
    if (fileInput) fileInput.value = "";
    if (previewEl) {
      if (previewEl._url) {
        try {
          URL.revokeObjectURL(previewEl._url);
        } catch (_) {}
      }
      previewEl.hidden = true;
      previewEl.removeAttribute("src");
    }
    setError("");
    renderList();
    renderPreview();
  }

  fileInput?.addEventListener("change", (e) => {
    addFiles(e.target.files).catch((err) => setError(err.message || String(err)));
  });
  modeEl?.addEventListener("change", syncCustomRow);
  runBtn?.addEventListener("click", () => {
    runTrimAll().catch((err) => setError(err.message || String(err)));
  });
  zipBtn?.addEventListener("click", () => {
    packZip().catch((err) => setError(err.message || String(err)));
  });
  clearBtn?.addEventListener("click", clearAll);
  window.DevToolsTemp?.registerCleanup(clearAll);

  const drop = $("#imgtrim-drop");
  drop?.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.classList.add("is-drag");
  });
  drop?.addEventListener("dragleave", () => drop.classList.remove("is-drag"));
  drop?.addEventListener("drop", (e) => {
    e.preventDefault();
    drop.classList.remove("is-drag");
    addFiles(e.dataTransfer?.files).catch((err) => setError(err.message || String(err)));
  });

  syncCustomRow();
  renderList();
  renderPreview();
})();
