(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const panel = $("#imgpreview");
  if (!panel) return;

  const fileInput = $("#imgprev-file");
  const clearBtn = $("#imgprev-clear");
  const resetAllBtn = $("#imgprev-reset-all");
  const resetSelBtn = $("#imgprev-reset-sel");
  const meta = $("#imgprev-meta");
  const errorEl = $("#imgprev-error");
  const stage = $("#imgprev-stage");
  const viewport = $("#imgprev-viewport");
  const world = $("#imgprev-world");
  const emptyHint = $("#imgprev-empty-hint");
  const heightResize = $("#imgprev-height-resize");
  const thumbStrip = $("#imgprev-thumbs");
  const opacityInput = $("#imgprev-opacity");
  const opacityVal = $("#imgprev-opacity-val");
  const layerUpBtn = $("#imgprev-layer-up");
  const layerDownBtn = $("#imgprev-layer-down");
  const viewPctEl = $("#imgprev-view-pct");
  const selScaleEl = $("#imgprev-sel-scale");
  const infoPanel = $("#imgprev-info");
  const infoGrid = $("#imgprev-info-grid");

  const HEIGHT_MIN = 280;
  const HEIGHT_DEFAULT = 480;
  const HEIGHT_STORAGE = "imgprev-wrap-height-v1";
  const SNAP_PX = 6;
  const SNAP_RELEASE_MULT = 1.4;
  const SNAP_SWITCH_PX = 2;
  const WHEEL_ZOOM_GAIN = 0.00006;
  const WHEEL_ZOOM_STEP_MAX = 0.012;

  let uid = 0;
  /** @type {Array<{id:string,file:File,url:string,name:string,x:number,y:number,scale:number,opacity:number,z:number,nw:number,nh:number,ix:number,iy:number,iscale:number,iopacity:number,el:HTMLImageElement}>} */
  let items = [];
  let selectedId = null;

  const view = {
    scale: 1,
    x: 0,
    y: 0,
    dragging: false,
    lastX: 0,
    lastY: 0,
    pointers: new Map(),
  };

  let dragItem = null;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  /** @type {{ xEdge: number|null, xLine: number|null, yEdge: number|null, yLine: number|null, boxOtherId: string|null }|null} */
  let snapSession = null;

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
    if (!msg) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = msg;
  }

  function isImageFile(file) {
    if (!file) return false;
    if (String(file.type || "").startsWith("image/")) return true;
    return /\.(png|jpe?g|gif|webp|bmp|svg|avif|heic|heif)$/i.test(String(file.name || ""));
  }

  function selectedItem() {
    return items.find((it) => it.id === selectedId) || null;
  }

  function heightMax() {
    return Math.max(HEIGHT_MIN, Math.min(Math.round(window.innerHeight * 0.92), 960));
  }

  function clampHeight(px) {
    return Math.max(HEIGHT_MIN, Math.min(heightMax(), Math.round(Number(px) || HEIGHT_DEFAULT)));
  }

  function readStoredHeight() {
    try {
      const n = Number(localStorage.getItem(HEIGHT_STORAGE));
      if (Number.isFinite(n) && n >= HEIGHT_MIN) return clampHeight(n);
    } catch (_) {}
    return clampHeight(HEIGHT_DEFAULT);
  }

  function applyWrapHeight(px, opts = {}) {
    if (!viewport) return HEIGHT_DEFAULT;
    const h = clampHeight(px);
    viewport.style.setProperty("--imgprev-wrap-height", `${h}px`);
    viewport.style.height = `${h}px`;
    if (opts.persist !== false) {
      try {
        localStorage.setItem(HEIGHT_STORAGE, String(h));
      } catch (_) {}
    }
    if (opts.refit !== false && items.length) fitView();
    return h;
  }

  function bindHeightControls() {
    applyWrapHeight(readStoredHeight(), { persist: false, refit: false });
    if (!heightResize || heightResize.dataset.bound === "1") return;
    heightResize.dataset.bound = "1";
    let startY = 0;
    let startH = HEIGHT_DEFAULT;
    const onMove = (e) => {
      applyWrapHeight(startH + (e.clientY - startY), { persist: true, refit: true });
    };
    const onEnd = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
    heightResize.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      startY = e.clientY;
      startH = viewport?.getBoundingClientRect().height || readStoredHeight();
      try {
        heightResize.setPointerCapture?.(e.pointerId);
      } catch (_) {}
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onEnd);
      window.addEventListener("pointercancel", onEnd);
    });
  }

  function clientToWorld(clientX, clientY) {
    const rect = viewport.getBoundingClientRect();
    return {
      x: (clientX - rect.left - view.x) / view.scale,
      y: (clientY - rect.top - view.y) / view.scale,
    };
  }

  function itemBounds(it) {
    const w = it.nw * it.scale;
    const h = it.nh * it.scale;
    return {
      l: it.x,
      r: it.x + w,
      t: it.y,
      b: it.y + h,
      cx: it.x + w / 2,
      cy: it.y + h / 2,
      w,
      h,
    };
  }

  function applyViewTransform() {
    if (!world) return;
    world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.scale})`;
    if (viewPctEl) viewPctEl.textContent = `${Math.round(view.scale * 100)}%`;
  }

  function applyItemTransform(it) {
    if (!it.el) return;
    it.el.style.transform = `translate(${it.x}px, ${it.y}px) scale(${it.scale})`;
    it.el.style.opacity = String(it.opacity);
    it.el.style.zIndex = String(it.z);
    it.el.classList.toggle("is-selected", it.id === selectedId);
  }

  function renderAllItems(opts = {}) {
    items.forEach(applyItemTransform);
    if (!opts.skipThumbs) renderThumbs();
    syncControls();
    syncMeta();
    syncInfoPanel();
  }

  function snapThresholdWorld() {
    return SNAP_PX / Math.max(view.scale, 0.05);
  }

  function snapSwitchWorld() {
    return SNAP_SWITCH_PX / Math.max(view.scale, 0.05);
  }

  function wheelDeltaY(e) {
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    else if (e.deltaMode === 2) dy *= viewport?.clientHeight || 480;
    return dy;
  }

  function wheelZoomFactor(e) {
    const step = Math.max(-WHEEL_ZOOM_STEP_MAX, Math.min(WHEEL_ZOOM_STEP_MAX, -wheelDeltaY(e) * WHEEL_ZOOM_GAIN));
    return Math.exp(step);
  }

  function bestAxisSnap(candidates, lines, thr, lockedEdge, lockedLine) {
    const releaseThr = thr * SNAP_RELEASE_MULT;
    const switchThr = snapSwitchWorld();
    if (lockedEdge != null && lockedLine != null && candidates[lockedEdge] != null) {
      const dist = Math.abs(candidates[lockedEdge] - lockedLine);
      if (dist <= releaseThr) {
        return { delta: lockedLine - candidates[lockedEdge], line: lockedLine, edge: lockedEdge };
      }
    }
    let best = null;
    for (let ei = 0; ei < candidates.length; ei += 1) {
      const c = candidates[ei];
      for (const line of lines) {
        const dist = Math.abs(c - line);
        if (dist <= thr && (!best || dist < best.dist)) {
          best = { dist, delta: line - c, line, edge: ei };
        }
      }
    }
    if (best && lockedEdge != null && lockedLine != null && candidates[lockedEdge] != null) {
      const lockedDist = Math.abs(candidates[lockedEdge] - lockedLine);
      if (lockedDist <= thr && best.dist + switchThr > lockedDist) {
        return { delta: lockedLine - candidates[lockedEdge], line: lockedLine, edge: lockedEdge };
      }
    }
    if (best) return { delta: best.delta, line: best.line, edge: best.edge };
    return { delta: 0, line: null, edge: null };
  }

  function tryBoxSnap(it, nx, ny, thr, session) {
    const b = itemBounds({ ...it, x: nx, y: ny });
    const releaseThr = thr * SNAP_RELEASE_MULT;
    if (session?.boxOtherId) {
      const other = items.find((o) => o.id === session.boxOtherId);
      if (other) {
        const o = itemBounds(other);
        const edges = [b.l - o.l, b.r - o.r, b.t - o.t, b.b - o.b];
        if (edges.every((d) => Math.abs(d) <= releaseThr)) {
          return { x: other.x, y: other.y, otherId: other.id };
        }
      }
      session.boxOtherId = null;
    }
    let best = null;
    items.forEach((other) => {
      if (other.id === it.id) return;
      const o = itemBounds(other);
      const dl = Math.abs(b.l - o.l);
      const dr = Math.abs(b.r - o.r);
      const dt = Math.abs(b.t - o.t);
      const db = Math.abs(b.b - o.b);
      const aligned = [dl, dr, dt, db].filter((d) => d <= thr).length;
      if (aligned < 3) return;
      const score = dl + dr + dt + db;
      if (!best || score < best.score) {
        best = { score, x: other.x, y: other.y, otherId: other.id };
      }
    });
    if (!best) return null;
    if (session) session.boxOtherId = best.otherId;
    return { x: best.x, y: best.y, otherId: best.otherId };
  }

  function snapPosition(it, nx, ny, session = snapSession) {
    const thr = snapThresholdWorld();
    const box = tryBoxSnap(it, nx, ny, thr, session);
    if (box) {
      if (session) {
        session.xEdge = null;
        session.xLine = null;
        session.yEdge = null;
        session.yLine = null;
      }
      return { x: box.x, y: box.y };
    }
    const b = itemBounds({ ...it, x: nx, y: ny });
    const xLines = [];
    const yLines = [];
    items.forEach((other) => {
      if (other.id === it.id) return;
      const o = itemBounds(other);
      xLines.push(o.l, o.r, o.cx);
      yLines.push(o.t, o.b, o.cy);
    });
    if (session) session.boxOtherId = null;
    const snapX = bestAxisSnap([b.l, b.r, b.cx], xLines, thr, session?.xEdge ?? null, session?.xLine ?? null);
    const sx = nx + snapX.delta;
    const nb = itemBounds({ ...it, x: sx, y: ny });
    const snapY = bestAxisSnap([nb.t, nb.b, nb.cy], yLines, thr, session?.yEdge ?? null, session?.yLine ?? null);
    if (session) {
      session.xEdge = snapX.edge;
      session.xLine = snapX.line;
      session.yEdge = snapY.edge;
      session.yLine = snapY.line;
    }
    return { x: sx, y: ny + snapY.delta };
  }

  function fitView() {
    if (!viewport || !items.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    items.forEach((it) => {
      const b = itemBounds(it);
      minX = Math.min(minX, b.l);
      minY = Math.min(minY, b.t);
      maxX = Math.max(maxX, b.r);
      maxY = Math.max(maxY, b.b);
    });
    const pad = 24;
    const bw = Math.max(1, maxX - minX + pad * 2);
    const bh = Math.max(1, maxY - minY + pad * 2);
    const rw = viewport.clientWidth || 1;
    const rh = viewport.clientHeight || 1;
    const fit = Math.min(rw / bw, rh / bh, 2);
    view.scale = fit;
    view.x = (rw - bw * fit) / 2 - (minX - pad) * fit;
    view.y = (rh - bh * fit) / 2 - (minY - pad) * fit;
    applyViewTransform();
  }

  function selectItem(id, opts = {}) {
    selectedId = id;
    renderAllItems(opts);
  }

  function syncControls() {
    const sel = selectedItem();
    const on = Boolean(sel);
    [opacityInput, resetSelBtn, layerUpBtn, layerDownBtn].forEach((el) => {
      if (el) el.disabled = !on;
    });
    if (opacityInput) {
      opacityInput.value = sel ? String(Math.round(sel.opacity * 100)) : "100";
    }
    if (opacityVal) opacityVal.textContent = sel ? `${Math.round(sel.opacity * 100)}%` : "—";
    if (selScaleEl) selScaleEl.textContent = sel ? `${Math.round(sel.scale * 100)}%` : "—";
  }

  function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatMime(file) {
    const t = String(file?.type || "").trim();
    if (t) return t;
    const ext = String(file?.name || "").split(".").pop()?.toUpperCase();
    return ext ? `.${ext}` : "—";
  }

  function gcd(a, b) {
    let x = Math.abs(Math.round(a));
    let y = Math.abs(Math.round(b));
    while (y) {
      const t = y;
      y = x % y;
      x = t;
    }
    return x || 1;
  }

  function aspectLabel(w, h) {
    if (!(w > 0 && h > 0)) return "—";
    const g = gcd(w, h);
    return `${Math.round(w / g)}∶${Math.round(h / g)}`;
  }

  function formatFileTime(ms) {
    const n = Number(ms);
    if (!Number.isFinite(n) || n <= 0) return "—";
    try {
      return new Date(n).toLocaleString("zh-CN", { hour12: false });
    } catch (_) {
      return "—";
    }
  }

  function infoRow(label, value, mono = false) {
    const ddClass = mono ? ' class="mono"' : "";
    return `<div class="preview-info-item"><dt>${label}</dt><dd${ddClass}>${value}</dd></div>`;
  }

  function syncInfoPanel() {
    if (!infoPanel || !infoGrid) return;
    if (!items.length) {
      infoPanel.hidden = true;
      infoGrid.innerHTML = "";
      return;
    }
    infoPanel.hidden = false;
    const sel = selectedItem();
    const totalBytes = items.reduce((sum, it) => sum + (Number(it.file?.size) || 0), 0);
    const sorted = items.slice().sort((a, b) => a.z - b.z);
    if (sel) {
      const dispW = Math.round(sel.nw * sel.scale);
      const dispH = Math.round(sel.nh * sel.scale);
      const layerIdx = sorted.findIndex((it) => it.id === sel.id) + 1;
      const mp = ((sel.nw * sel.nh) / 1_000_000).toFixed(2);
      infoGrid.innerHTML = [
        infoRow("文件名", escapeHtml(sel.name)),
        infoRow("文件大小", formatBytes(sel.file?.size), true),
        infoRow("MIME / 类型", formatMime(sel.file), true),
        infoRow("原始像素", `${sel.nw} × ${sel.nh} px`, true),
        infoRow("显示尺寸", `${dispW} × ${dispH} px`, true),
        infoRow("像素总量", `${(sel.nw * sel.nh).toLocaleString("zh-CN")}（约 ${mp} MP）`, true),
        infoRow("宽高比", aspectLabel(sel.nw, sel.nh), true),
        infoRow("位置", `X ${Math.round(sel.x)} · Y ${Math.round(sel.y)}`, true),
        infoRow("缩放", `${Math.round(sel.scale * 100)}%`, true),
        infoRow("透明度", `${Math.round(sel.opacity * 100)}%`, true),
        infoRow("图层", `#${layerIdx} / 共 ${items.length} 张`, true),
        infoRow("画布缩放", `${Math.round(view.scale * 100)}%`, true),
        infoRow("修改时间", formatFileTime(sel.file?.lastModified)),
        infoRow("全部合计", `${items.length} 张 · ${formatBytes(totalBytes)}`, true),
      ].join("");
      return;
    }
    const maxW = Math.max(...items.map((it) => it.nw));
    const maxH = Math.max(...items.map((it) => it.nh));
    infoGrid.innerHTML = [
      infoRow("图片数量", `${items.length} 张`, true),
      infoRow("合计大小", formatBytes(totalBytes), true),
      infoRow("最大原始尺寸", `${maxW} × ${maxH} px`, true),
      infoRow("画布缩放", `${Math.round(view.scale * 100)}%`, true),
      infoRow("提示", "单击某张图片可查看该图详细信息"),
    ].join("");
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function syncMeta() {
    if (!meta) return;
    if (!items.length) {
      meta.textContent =
        "支持多选 / 拖拽添加。滚轮无极缩放选中图（无选中则缩放画布）；拖拽移动图片；底边可拉高预览区。";
      return;
    }
    meta.textContent = `${items.length} 张 · 选中：${selectedItem()?.name || "无"} · 滚轮缩放 · 边缘吸附 · 底栏可拖拽排序`;
  }

  function syncEmpty() {
    const has = items.length > 0;
    if (emptyHint) emptyHint.hidden = has;
    viewport?.classList.toggle("is-empty", !has);
    if (thumbStrip) thumbStrip.hidden = !has;
  }

  function reorderThumbZ(fromId, toId, insertBefore) {
    const sorted = items.slice().sort((a, b) => a.z - b.z);
    const fromIdx = sorted.findIndex((it) => it.id === fromId);
    const toIdx = sorted.findIndex((it) => it.id === toId);
    if (fromIdx < 0 || toIdx < 0 || fromId === toId) return;
    const [moved] = sorted.splice(fromIdx, 1);
    let insertIdx = sorted.findIndex((it) => it.id === toId);
    if (!insertBefore) insertIdx += 1;
    sorted.splice(insertIdx, 0, moved);
    sorted.forEach((it, i) => {
      it.z = i + 1;
    });
    renderAllItems();
  }

  function clearThumbDropMarkers() {
    $$(".imgprev-thumb.is-drop-before, .imgprev-thumb.is-drop-after, .imgprev-thumb.is-dragging", thumbStrip).forEach((el) => {
      el.classList.remove("is-drop-before", "is-drop-after", "is-dragging");
    });
  }

  function bindThumbStrip() {
    if (!thumbStrip || thumbStrip.dataset.bound === "1") return;
    thumbStrip.dataset.bound = "1";
    const THRESH = 6;
    /** @type {{ id: string, startX: number, startY: number, pointerId: number, moved: boolean, btn: HTMLElement, dropTarget: { id: string, before: boolean }|null }|null} */
    let drag = null;

    thumbStrip.addEventListener("pointerdown", (e) => {
      const btn = e.target.closest?.(".imgprev-thumb");
      if (!btn || e.button !== 0) return;
      e.preventDefault();
      drag = {
        id: btn.dataset.id,
        startX: e.clientX,
        startY: e.clientY,
        pointerId: e.pointerId,
        moved: false,
        btn,
        dropTarget: null,
      };
      try {
        btn.setPointerCapture(e.pointerId);
      } catch (_) {}
    });

    thumbStrip.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (!drag.moved) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < THRESH) return;
        drag.moved = true;
        drag.btn.classList.add("is-dragging");
        selectedId = drag.id;
        renderAllItems({ skipThumbs: true });
        $$(".imgprev-thumb", thumbStrip).forEach((btn) => {
          btn.classList.toggle("is-active", btn.dataset.id === drag.id);
        });
      }
      clearThumbDropMarkers();
      drag.btn.classList.add("is-dragging");
      const hit = document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".imgprev-thumb");
      if (hit && hit.dataset.id !== drag.id) {
        const rect = hit.getBoundingClientRect();
        const before = e.clientX < rect.left + rect.width / 2;
        hit.classList.add(before ? "is-drop-before" : "is-drop-after");
        drag.dropTarget = { id: hit.dataset.id, before };
      } else {
        drag.dropTarget = null;
      }
    });

    const endDrag = (e) => {
      if (!drag || e.pointerId !== drag.pointerId) return;
      if (drag.moved && drag.dropTarget) {
        reorderThumbZ(drag.id, drag.dropTarget.id, drag.dropTarget.before);
      } else if (!drag.moved) {
        selectItem(drag.id);
      }
      clearThumbDropMarkers();
      try {
        drag.btn.releasePointerCapture(e.pointerId);
      } catch (_) {}
      drag = null;
    };

    thumbStrip.addEventListener("pointerup", endDrag);
    thumbStrip.addEventListener("pointercancel", endDrag);
  }

  function renderThumbs() {
    if (!thumbStrip) return;
    thumbStrip.innerHTML = items
      .slice()
      .sort((a, b) => a.z - b.z)
      .map((it) => {
        const active = it.id === selectedId ? " is-active" : "";
        return `<button type="button" class="imgprev-thumb${active}" data-id="${it.id}" title="${it.name.replace(/"/g, "&quot;")} · 拖拽排序">
          <img src="${it.url}" alt="" draggable="false" />
        </button>`;
      })
      .join("");
  }

  function removeItem(id) {
    const idx = items.findIndex((it) => it.id === id);
    if (idx < 0) return;
    const [it] = items.splice(idx, 1);
    if (it.url) URL.revokeObjectURL(it.url);
    it.el?.remove();
    if (selectedId === id) selectedId = items[items.length - 1]?.id || null;
  }

  function clearAll() {
    items.forEach((it) => {
      if (it.url) URL.revokeObjectURL(it.url);
      it.el?.remove();
    });
    items = [];
    selectedId = null;
    view.scale = 1;
    view.x = 0;
    view.y = 0;
    if (fileInput) fileInput.value = "";
    setError("");
    applyViewTransform();
    syncEmpty();
    renderAllItems();
  }

  function resetSelected() {
    const sel = selectedItem();
    if (!sel) return;
    sel.x = sel.ix;
    sel.y = sel.iy;
    sel.scale = sel.iscale;
    sel.opacity = sel.iopacity;
    applyItemTransform(sel);
    renderThumbs();
    syncControls();
    toast("已还原选中图片");
  }

  function resetAllItems() {
    items.forEach((it) => {
      it.x = it.ix;
      it.y = it.iy;
      it.scale = it.iscale;
      it.opacity = it.iopacity;
    });
    fitView();
    renderAllItems();
    toast("已全部还原");
  }

  function moveLayer(delta) {
    const sel = selectedItem();
    if (!sel) return;
    const sorted = items.slice().sort((a, b) => a.z - b.z);
    const idx = sorted.findIndex((it) => it.id === sel.id);
    const next = sorted[idx + delta];
    if (!next) return;
    const tmp = sel.z;
    sel.z = next.z;
    next.z = tmp;
    renderAllItems();
  }

  async function addFiles(fileList) {
    const files = [...(fileList || [])].filter(isImageFile);
    if (!files.length) {
      setError("请选择图片文件");
      return;
    }
    setError("");
    const startZ = items.reduce((m, it) => Math.max(m, it.z), 0);
    let col = 0;
    let row = 0;
    const gap = 20;
    const maxW = 320;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.decoding = "async";
      await new Promise((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(`无法读取：${file.name}`));
        img.src = url;
      });
      const nw = img.naturalWidth || 1;
      const nh = img.naturalHeight || 1;
      const scale = nw > maxW ? maxW / nw : 1;
      const w = nw * scale;
      const h = nh * scale;
      const x = col * (maxW + gap) + 24;
      const y = row * (maxW + gap) + 24;
      col += 1;
      if (col >= 3) {
        col = 0;
        row += 1;
      }
      const id = `img-${++uid}`;
      const el = document.createElement("img");
      el.className = "imgprev-layer";
      el.src = url;
      el.alt = file.name;
      el.draggable = false;
      el.dataset.id = id;
      el.style.width = `${nw}px`;
      el.style.height = `${nh}px`;
      el.style.transformOrigin = "0 0";
      world?.appendChild(el);
      const item = {
        id,
        file,
        url,
        name: file.name,
        x,
        y,
        scale,
        opacity: 1,
        z: startZ + i + 1,
        nw,
        nh,
        ix: x,
        iy: y,
        iscale: scale,
        iopacity: 1,
        el,
      };
      items.push(item);
      applyItemTransform(item);
      el.addEventListener("pointerdown", (e) => onItemPointerDown(e, item));
    }
    if (!selectedId && items.length) selectedId = items[items.length - 1].id;
    syncEmpty();
    fitView();
    renderAllItems();
    toast(`已添加 ${files.length} 张`);
  }

  function zoomViewAt(clientX, clientY, nextScale) {
    const rect = viewport.getBoundingClientRect();
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    const min = 0.05;
    const max = 32;
    const scale = Math.min(max, Math.max(min, nextScale));
    const wx = (px - view.x) / (view.scale || 1);
    const wy = (py - view.y) / (view.scale || 1);
    view.scale = scale;
    view.x = px - wx * scale;
    view.y = py - wy * scale;
    applyViewTransform();
  }

  function scaleItemAt(it, clientX, clientY, nextScale) {
    const min = 0.02;
    const max = 32;
    const scale = Math.min(max, Math.max(min, nextScale));
    const before = clientToWorld(clientX, clientY);
    const ratio = scale / (it.scale || 1);
    it.x = before.x - (before.x - it.x) * ratio;
    it.y = before.y - (before.y - it.y) * ratio;
    it.scale = scale;
    applyItemTransform(it);
    syncControls();
  }

  function onItemPointerDown(e, it) {
    e.stopPropagation();
    selectItem(it.id);
    dragItem = it;
    snapSession = { xEdge: null, xLine: null, yEdge: null, yLine: null, boxOtherId: null };
    const p = clientToWorld(e.clientX, e.clientY);
    dragOffsetX = p.x - it.x;
    dragOffsetY = p.y - it.y;
    viewport?.classList.add("is-panning");

    const onMove = (ev) => {
      if (!dragItem) return;
      const wp = clientToWorld(ev.clientX, ev.clientY);
      let nx = wp.x - dragOffsetX;
      let ny = wp.y - dragOffsetY;
      const snapped = snapPosition(dragItem, nx, ny);
      dragItem.x = snapped.x;
      dragItem.y = snapped.y;
      applyItemTransform(dragItem);
    };
    const onEnd = () => {
      dragItem = null;
      snapSession = null;
      viewport?.classList.remove("is-panning");
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onEnd);
      window.removeEventListener("pointercancel", onEnd);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onEnd);
    window.addEventListener("pointercancel", onEnd);
  }

  function bindViewport() {
    if (!viewport || viewport.dataset.bound === "1") return;
    viewport.dataset.bound = "1";

    viewport.addEventListener(
      "wheel",
      (e) => {
        if (!items.length) return;
        e.preventDefault();
        const factor = wheelZoomFactor(e);
        const sel = selectedItem();
        if (sel && !e.altKey) {
          scaleItemAt(sel, e.clientX, e.clientY, sel.scale * factor);
        } else {
          zoomViewAt(e.clientX, e.clientY, view.scale * factor);
        }
      },
      { passive: false }
    );

    viewport.addEventListener("pointerdown", (e) => {
      if (e.target.closest?.(".imgprev-layer, .imgprev-height-resize, .imgprev-hud")) return;
      if (!items.length) {
        fileInput?.click();
        return;
      }
      selectItem(null);
      dragItem = null;
      view.dragging = true;
      view.lastX = e.clientX;
      view.lastY = e.clientY;
      try {
        viewport.setPointerCapture?.(e.pointerId);
      } catch (_) {}
      viewport.classList.add("is-panning");
    });

    viewport.addEventListener("pointermove", (e) => {
      if (dragItem) return;
      if (!view.dragging) return;
      view.x += e.clientX - view.lastX;
      view.y += e.clientY - view.lastY;
      view.lastX = e.clientX;
      view.lastY = e.clientY;
      applyViewTransform();
    });

    const endPtr = () => {
      view.dragging = false;
      viewport.classList.remove("is-panning");
    };
    viewport.addEventListener("pointerup", endPtr);
    viewport.addEventListener("pointercancel", endPtr);
  }

  function bindFileDrop() {
    if (!stage || stage.dataset.dropBound === "1") return;
    stage.dataset.dropBound = "1";
    let depth = 0;
    const setDrag = (on) => viewport?.classList.toggle("is-file-drag", on);
    stage.addEventListener("dragenter", (e) => {
      if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
      e.preventDefault();
      depth += 1;
      setDrag(true);
    });
    stage.addEventListener("dragleave", (e) => {
      if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDrag(false);
    });
    stage.addEventListener("dragover", (e) => {
      if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    stage.addEventListener("drop", (e) => {
      if (![...(e.dataTransfer?.types || [])].includes("Files")) return;
      e.preventDefault();
      depth = 0;
      setDrag(false);
      addFiles(e.dataTransfer.files).catch((err) => setError(err.message || String(err)));
    });
  }

  fileInput?.addEventListener("change", (e) => {
    addFiles(e.target.files).catch((err) => setError(err.message || String(err)));
    e.target.value = "";
  });
  clearBtn?.addEventListener("click", clearAll);
  resetAllBtn?.addEventListener("click", resetAllItems);
  resetSelBtn?.addEventListener("click", resetSelected);
  layerUpBtn?.addEventListener("click", () => moveLayer(1));
  layerDownBtn?.addEventListener("click", () => moveLayer(-1));
  opacityInput?.addEventListener("input", () => {
    const sel = selectedItem();
    if (!sel) return;
    const v = Math.max(0, Math.min(100, Number(opacityInput.value) || 0));
    sel.opacity = v / 100;
    applyItemTransform(sel);
    if (opacityVal) opacityVal.textContent = `${v}%`;
  });

  bindViewport();
  bindHeightControls();
  bindFileDrop();
  bindThumbStrip();
  syncEmpty();
  syncControls();

  window.DevToolsTemp?.registerCleanup(clearAll);

  window.addEventListener("devtools:route", () => {
    if (panel.classList.contains("is-workspace-active") && items.length) {
      requestAnimationFrame(() => fitView());
    }
  });
})();
