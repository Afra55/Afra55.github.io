(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput } = K;

  const MAX_EDGE = 2000;
  const PALETTE_MAX = 12;
  const MP_BASE = "https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation@0.1.1675465747/";
  const RMBG_URL = "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm";

  let els = {};
  let img = null;
  let fileBlob = null;
  let baseData = null;
  let workW = 0;
  let workH = 0;
  let srcColor = null;
  let rules = [{ src: null, target: { r: 255, g: 255, b: 255 }, transparent: false }];
  let unified = false;
  let multi = false;
  let mask = null; // Uint8Array 1=person
  let detectMode = "color";
  let aiState = { mp: null, rmbg: null, loading: false };
  let crop = null; // {x,y,w,h,aspect|null}
  let raf = 0;

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
  const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

  function effRules() {
    const list = multi ? rules.filter((r) => r.src) : rules.slice(0, 1).filter((r) => r.src || r.__keep);
    if (unified) {
      const t = hexToRgb(els.targetHex?.value || els.target?.value || "#ffffff") || { r: 255, g: 255, b: 255 };
      return list.map((r) => ({ src: r.src, target: t, transparent: !!els.transparent?.checked }));
    }
    return list;
  }

  // 计算「可替换区域」：按规则匹配 + 可选从四边泛洪
  function computeRegion(ruleList, tol, flood) {
    const n = workW * workH;
    const label = new Int16Array(n).fill(-1);
    const tol2 = tol * tol;
    for (let i = 0, px = 0; px < n; px++, i += 4) {
      const r = baseData[i], g = baseData[i + 1], b = baseData[i + 2];
      for (let k = 0; k < ruleList.length; k++) {
        const s = ruleList[k].src;
        if (!s) continue;
        const dr = r - s.r, dg = g - s.g, db = b - s.b;
        if (dr * dr + dg * dg + db * db <= tol2) { label[px] = k; break; }
      }
    }
    const region = new Uint8Array(n);
    if (!flood) {
      for (let px = 0; px < n; px++) if (label[px] >= 0) region[px] = 1;
      return region;
    }
    const stack = [];
    const push = (x, y) => { const px = y * workW + x; if (px >= 0 && px < n && label[px] >= 0 && !region[px]) { region[px] = 1; stack.push(px); } };
    for (let x = 0; x < workW; x++) { push(x, 0); push(x, workH - 1); }
    for (let y = 0; y < workH; y++) { push(0, y); push(workW - 1, y); }
    while (stack.length) {
      const px = stack.pop();
      const x = px % workW, y = (px / workW) | 0;
      push(x + 1, y); push(x - 1, y); push(x, y + 1); push(x, y - 1);
    }
    return region;
  }

  function render() {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const canvas = els.canvas;
      if (!canvas || !baseData) return;
      const ruleList = effRules();
      if (!ruleList.length || !ruleList.some((r) => r.src)) {
        canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(baseData), workW, workH), 0, 0);
        updateStatus();
        return;
      }
      const tol = Number(els.tol?.value) || 0;
      const feather = Number(els.feather?.value) || 0;
      const flood = (els.flood?.value || "1") === "1";
      const useMask = detectMode !== "color" && mask;
      const region = computeRegion(ruleList, tol, flood);
      const out = new Uint8ClampedArray(baseData);
      const f = Math.max(0, feather);
      const tol2 = tol * tol;
      for (let i = 0, px = 0; px < workW * workH; px++, i += 4) {
        if (!region[px]) continue;
        if (useMask && mask[px]) continue; // AI：人像区域跳过
        const k = labelOf(ruleList, baseData[i], baseData[i + 1], baseData[i + 2], tol2);
        if (k < 0) continue;
        const rule = ruleList[k];
        const r = baseData[i], g = baseData[i + 1], b = baseData[i + 2];
        let a = 1;
        if (f > 0) {
          const dr = r - rule.src.r, dg = g - rule.src.g, db = b - rule.src.b;
          const d = Math.sqrt(dr * dr + dg * dg + db * db);
          let x = (tol - d) / f;
          if (x > 1) x = 1; else if (x < 0) x = 0;
          a = x * x * (3 - 2 * x);
        }
        if (rule.transparent) {
          out[i + 3] = clamp255(baseData[i + 3] * (1 - a));
        } else {
          out[i] = clamp255(r + (rule.target.r - r) * a);
          out[i + 1] = clamp255(g + (rule.target.g - g) * a);
          out[i + 2] = clamp255(b + (rule.target.b - b) * a);
        }
      }
      canvas.getContext("2d").putImageData(new ImageData(out, workW, workH), 0, 0);
      updateStatus();
    });
  }

  function labelOf(ruleList, r, g, b, tol2) {
    for (let k = 0; k < ruleList.length; k++) {
      const s = ruleList[k].src;
      if (!s) continue;
      const dr = r - s.r, dg = g - s.g, db = b - s.b;
      if (dr * dr + dg * dg + db * db <= tol2) return k;
    }
    return -1;
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

  function renderRules() {
    const host = els.rulesEl;
    if (!host) return;
    if (!multi) { host.innerHTML = ""; els.srcChip.style.display = ""; els.srcHex.style.display = ""; return; }
    els.srcChip.style.display = "none";
    els.srcHex.style.display = "none";
    host.innerHTML = rules
      .map((r, i) => {
        const sh = r.src ? rgbToHex(r.src.r, r.src.g, r.src.b) : "transparent";
        const th = r.transparent ? "transparent" : rgbToHex(r.target.r, r.target.g, r.target.b);
        const thHex = r.transparent ? "#ffffff" : th;
        return `<div class="irc-rule" data-i="${i}">
          <span class="irc-chip" style="background:${sh}"></span>
          <span class="mono irc-arrow">→</span>
          <input type="color" class="irc-rule-color" data-i="${i}" value="${thHex}" ${r.transparent ? "disabled" : ""} />
          <label class="flag"><input type="checkbox" class="irc-rule-tr" data-i="${i}" ${r.transparent ? "checked" : ""} /> 透明</label>
          <button type="button" class="ghost-btn irc-rule-del" data-i="${i}">删</button>
        </div>`;
      })
      .join("");
  }

  function setSrcColor(rgb) {
    srcColor = rgb ? { r: rgb.r, g: rgb.g, b: rgb.b } : null;
    if (!multi && rules[0]) rules[0].src = srcColor;
    if (els.srcChip) els.srcChip.style.background = rgb ? rgbToHex(rgb.r, rgb.g, rgb.b) : "transparent";
    if (els.srcHex) els.srcHex.textContent = rgb ? rgbToHex(rgb.r, rgb.g, rgb.b).toUpperCase() : "未选（点图片或上面的色块）";
    render();
  }

  function setTarget(rgb) {
    if (!rgb) return;
    if (!multi) { rules[0].target = rgb; rules[0].transparent = !!els.transparent?.checked; }
    if (els.target) els.target.value = rgbToHex(rgb.r, rgb.g, rgb.b);
    if (els.targetHex) els.targetHex.value = rgbToHex(rgb.r, rgb.g, rgb.b);
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
    setError(els.error, "");
  }

  function setCropFromSize() {
    const size = els.size?.value || "";
    if (!size) { crop = null; els.crop.hidden = true; els.cropCenter.hidden = true; updateStatus(); return; }
    let ar = null;
    if (size !== "free") {
      const m = /^(\d+)x(\d+)$/.exec(size);
      if (m) ar = Number(m[1]) / Number(m[2]);
    }
    let cw = workW, ch = workH;
    if (ar) { ch = Math.round(workW / ar); if (ch > workH) { ch = workH; cw = Math.round(workH * ar); } }
    else { cw = Math.round(workW * 0.8); ch = Math.round(workH * 0.8); }
    crop = { x: Math.round((workW - cw) / 2), y: Math.round((workH - ch) / 2), w: cw, h: ch, aspect: ar };
    els.crop.hidden = false;
    els.cropCenter.hidden = false;
    drawCropOverlay();
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
    box.classList.toggle("is-free", !crop.aspect);
  }

  function updateStatus() {
    if (!baseData) { setStatus(""); return; }
    const bits = [`${workW}×${workH}`];
    if (crop) {
      const size = els.size?.value || "";
      const m = /^(\d+)x(\d+)$/.exec(size);
      bits.push(`裁剪 ${Math.round(crop.w)}×${Math.round(crop.h)}` + (m ? ` → 导出 ${m[1]}×${m[2]}` : ""));
    }
    const rl = effRules().filter((r) => r.src);
    if (rl.length) bits.push(`替换 ${rl.length} 色`);
    setStatus(bits.join(" · "));
  }
  function setStatus(t) { if (els.status) els.status.textContent = t || ""; }

  function setDetectStatus(t) { if (els.detectStatus) els.detectStatus.textContent = t || ""; }

  async function runDetect() {
    if (!img) return;
    const mode = els.detect?.value || "color";
    detectMode = mode;
    mask = null;
    if (mode === "color") { setDetectStatus("按颜色匹配（可从四条边泛洪排除孤立同色）"); render(); return; }
    setDetectStatus("加载 AI 模型…");
    try {
      const t0 = performance.now();
      if (mode === "mp") mask = await segmentMP();
      else mask = await segmentRMBG();
      const sec = ((performance.now() - t0) / 1000).toFixed(1);
      const personRatio = mask ? (mask.reduce((a, b) => a + b, 0) / mask.length) : 0;
      if (!mask || personRatio < 0.004) {
        mask = null;
        setDetectStatus(`未检测到人像（${sec}s）→ 已回退「按颜色」`);
      } else {
        setDetectStatus(`已识别人像（占比 ${(personRatio * 100).toFixed(0)}% · ${sec}s）；只替换背景`);
      }
      render();
    } catch (err) {
      mask = null;
      detectMode = "color";
      if (els.detect) els.detect.value = "color";
      setDetectStatus("AI 不可用，已回退「按颜色」：" + (err?.message || err));
      render();
    }
  }

  async function ensureScript(src) {
    if (document.querySelector(`script[data-irc="${src}"]`)) return;
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = src;
      s.dataset.irc = src;
      s.onload = res;
      s.onerror = () => rej(new Error("无法加载脚本：" + src));
      document.head.appendChild(s);
    });
  }

  async function segmentMP() {
    if (aiState.loading) throw new Error("正在加载中");
    aiState.loading = true;
    try {
      await ensureScript(MP_BASE + "selfie_segmentation.js");
      const SS = window.SelfieSegmentation;
      if (!SS) throw new Error("MediaPipe 初始化失败");
      const seg = new SS({ locateFile: (f) => MP_BASE + f });
      seg.setOptions({ modelSelection: 1 });
      const res = await new Promise((resolve, reject) => {
        seg.onResults((r) => resolve(r));
        seg.send({ image: img }).catch(reject);
      });
      const mc = document.createElement("canvas");
      mc.width = workW; mc.height = workH;
      const mctx = mc.getContext("2d");
      mctx.drawImage(res.segmentationMask, 0, 0, workW, workH);
      const data = mctx.getImageData(0, 0, workW, workH).data;
      const out = new Uint8Array(workW * workH);
      for (let i = 0; i < out.length; i++) out[i] = data[i * 4] > 127 ? 1 : 0;
      return out;
    } finally {
      aiState.loading = false;
    }
  }

  async function segmentRMBG() {
    if (aiState.loading) throw new Error("正在加载中");
    aiState.loading = true;
    try {
      const mod = await import(/* webpackIgnore: true */ RMBG_URL);
      const removeBg = mod.default || mod.removeBackground;
      if (typeof removeBg !== "function") throw new Error("RMBG 加载失败");
      const srcBlob = await new Promise((r) => els.canvas.toBlob(r, "image/png"));
      const maskBlob = await removeBg(srcBlob, {
        model: "isnet_quint8",
        device: "cpu",
        output: { format: "image/png", type: "mask" },
      });
      const bmp = await createImageBitmap(maskBlob);
      const mc = document.createElement("canvas");
      mc.width = workW; mc.height = workH;
      const mctx = mc.getContext("2d");
      mctx.drawImage(bmp, 0, 0, workW, workH);
      bmp.close?.();
      const data = mctx.getImageData(0, 0, workW, workH).data;
      const out = new Uint8Array(workW * workH);
      for (let i = 0; i < out.length; i++) out[i] = data[i * 4] > 127 ? 1 : 0;
      return out;
    } finally {
      aiState.loading = false;
    }
  }

  function download() {
    if (!baseData) return;
    const size = els.size?.value || "";
    const m = /^(\d+)x(\d+)$/.exec(size);
    const src = els.canvas;
    const out = document.createElement("canvas");
    let sx = 0, sy = 0, sw = workW, sh = workH;
    if (crop) { sx = Math.round(crop.x); sy = Math.round(crop.y); sw = Math.round(crop.w); sh = Math.round(crop.h); }
    const tw = m ? Number(m[1]) : sw;
    const th = m ? Number(m[2]) : sh;
    out.width = Math.max(1, tw); out.height = Math.max(1, th);
    const ctx = out.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, out.width, out.height);
    out.toBlob((blob) => {
      if (!blob) { setError(els.error, "导出失败"); return; }
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `${m ? `id-photo-${m[1]}x${m[2]}` : "recolored"}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast("已导出 PNG");
    }, "image/png");
  }

  function applyImage(image, blob) {
    workFromImage(image);
    els.canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(baseData), workW, workH), 0, 0);
    srcColor = null;
    rules = [{ src: null, target: { r: 255, g: 255, b: 255 }, transparent: false }];
    mask = null;
    detectMode = els.detect?.value || "color";
    resetCrop();
    refreshSwatches();
    renderRules();
    setSrcColor(null);
    if (els.download) els.download.disabled = false;
    if (els.reset) els.reset.disabled = false;
    if (els.clear) els.clear.hidden = false;
    setError(els.error, "");
    setDetectStatus("");
    requestAnimationFrame(drawCropOverlay);
    if (detectMode !== "color") runDetect();
  }

  bindPanel("imgrecolor", () => {
    els = {
      file: $("#irc-file"), clear: $("#irc-clear"), stage: $("#irc-stage"), canvas: $("#irc-canvas"),
      crop: $("#irc-crop"), meta: $("#irc-meta"), swatches: $("#irc-swatches"), rulesEl: $("#irc-rules"),
      srcChip: $("#irc-src-chip"), srcHex: $("#irc-src-hex"), target: $("#irc-target"), targetHex: $("#irc-target-hex"),
      transparent: $("#irc-transparent"), unified: $("#irc-unified"), multiEl: $("#irc-multi"), addRule: $("#irc-add-rule"),
      detect: $("#irc-detect"), detectRun: $("#irc-detect-run"), detectStatus: $("#irc-detect-status"),
      eyedrop: $("#irc-eyedrop"), tol: $("#irc-tol"), tolVal: $("#irc-tol-val"), feather: $("#irc-feather"),
      featherVal: $("#irc-feather-val"), flood: $("#irc-flood"), size: $("#irc-size"), cropCenter: $("#irc-crop-center"),
      download: $("#irc-download"), reset: $("#irc-reset"), status: $("#irc-status"), error: $("#irc-error"),
    };
    if (!els.canvas) return;

    flushPendingFileInput(els.file, (files) => loadFiles(files));
    els.file?.addEventListener("change", (e) => loadFiles(e.target.files));

    els.clear?.addEventListener("click", () => {
      baseData = null; img = null; mask = null; resetCrop();
      els.canvas.width = 0; els.canvas.height = 0;
      if (els.swatches) els.swatches.innerHTML = "";
      if (els.rulesEl) els.rulesEl.innerHTML = "";
      if (els.download) els.download.disabled = true;
      if (els.reset) els.reset.disabled = true;
      els.clear.hidden = true;
      setError(els.error, ""); setStatus(""); setDetectStatus("");
    });

    els.canvas.addEventListener("click", (e) => {
      if (!baseData) return;
      const rect = els.canvas.getBoundingClientRect();
      const x = Math.floor(((e.clientX - rect.left) / rect.width) * workW);
      const y = Math.floor(((e.clientY - rect.top) / rect.height) * workH);
      if (x < 0 || y < 0 || x >= workW || y >= workH) return;
      const i = (y * workW + x) * 4;
      setSrcColor({ r: baseData[i], g: baseData[i + 1], b: baseData[i + 2] });
    });

    els.swatches?.addEventListener("click", (e) => {
      const b = e.target.closest?.(".irc-swatch");
      if (!b) return;
      const rgb = hexToRgb(b.dataset.hex);
      if (rgb) setSrcColor(rgb);
    });

    els.multiEl?.addEventListener("click", (e) => {
      const b = e.target.closest?.("[data-multi]");
      if (!b) return;
      multi = b.dataset.multi === "1";
      $$("#irc-multi .seg-btn").forEach((x) => x.classList.toggle("is-active", x === b));
      if (els.addRule) els.addRule.hidden = !multi;
      renderRules();
      render();
    });
    els.addRule?.addEventListener("click", () => {
      if (!srcColor) { toast("先在图上取个色"); return; }
      rules.push({ src: { ...srcColor }, target: hexToRgb(els.targetHex.value) || { r: 255, g: 255, b: 255 }, transparent: !!els.transparent?.checked });
      renderRules();
      render();
    });
    els.rulesEl?.addEventListener("click", (e) => {
      const del = e.target.closest?.(".irc-rule-del");
      if (del) { rules.splice(Number(del.dataset.i), 1); if (!rules.length) rules.push({ src: null, target: { r: 255, g: 255, b: 255 }, transparent: false }); renderRules(); render(); }
    });
    els.rulesEl?.addEventListener("input", (e) => {
      const t = e.target;
      const i = Number(t.dataset?.i);
      if (Number.isNaN(i) || !rules[i]) return;
      if (t.classList.contains("irc-rule-color")) { const rgb = hexToRgb(t.value); if (rgb) { rules[i].target = rgb; rules[i].transparent = false; renderRules(); render(); } }
      if (t.classList.contains("irc-rule-tr")) { rules[i].transparent = t.checked; renderRules(); render(); }
    });

    els.unified?.addEventListener("change", () => { unified = els.unified.checked; render(); });
    els.target?.addEventListener("input", () => { const rgb = hexToRgb(els.target.value); if (rgb) { if (multi && els.unified.checked) { unified = true; } setTarget(rgb); } });
    els.targetHex?.addEventListener("input", () => { const rgb = hexToRgb(els.targetHex.value); if (rgb) setTarget(rgb); });
    els.transparent?.addEventListener("change", () => { if (!multi) { rules[0].transparent = els.transparent.checked; } render(); });

    els.eyedrop?.addEventListener("click", async () => {
      if (typeof window.EyeDropper !== "function") { setError(els.error, "当前浏览器不支持屏幕吸管（请用 Chrome/Edge）"); return; }
      try { const r = await new window.EyeDropper().open(); const rgb = hexToRgb(r.sRGBHex); if (rgb) setTarget(rgb); } catch (_) {}
    });

    const onSlide = () => {
      if (els.tolVal) els.tolVal.textContent = els.tol.value;
      if (els.featherVal) els.featherVal.textContent = els.feather.value;
      render();
    };
    els.tol?.addEventListener("input", onSlide);
    els.feather?.addEventListener("input", onSlide);
    els.flood?.addEventListener("change", render);
    if (els.tolVal) els.tolVal.textContent = els.tol.value;
    if (els.featherVal) els.featherVal.textContent = els.feather.value;

    els.detect?.addEventListener("change", () => { if (els.detectRun) els.detectRun.hidden = els.detect.value === "color"; runDetect(); });
    els.detectRun?.addEventListener("click", () => runDetect());

    els.size?.addEventListener("change", setCropFromSize);
    els.cropCenter?.addEventListener("click", () => { if (crop) { crop.x = Math.round((workW - crop.w) / 2); crop.y = Math.round((workH - crop.h) / 2); drawCropOverlay(); } });
    els.download?.addEventListener("click", download);
    els.reset?.addEventListener("click", () => {
      if (!baseData) return;
      els.canvas.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(baseData), workW, workH), 0, 0);
      setSrcColor(null); resetCrop(); render(); toast("已还原");
    });

    // 裁剪框拖动 / 四角缩放（自由模式不限比例）
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
          crop.x = Math.max(0, Math.min(workW - drag.w, drag.x + (p.x - drag.px)));
          crop.y = Math.max(0, Math.min(workH - drag.h, drag.y + (p.y - drag.py)));
        } else {
          const ar = crop.aspect;
          let x1 = drag.x, y1 = drag.y, x2 = drag.x + drag.w, y2 = drag.y + drag.h;
          if (drag.h.includes("w")) x1 = Math.max(0, Math.min(x2 - 24, drag.x + (p.x - drag.px)));
          if (drag.h.includes("e")) x2 = Math.min(workW, Math.max(x1 + 24, drag.x + drag.w + (p.x - drag.px)));
          if (ar) {
            let w = x2 - x1, h = w / ar;
            if (drag.h.includes("n")) y1 = Math.min(y1, y2 - h); else y2 = y1 + h;
          } else {
            if (drag.h.includes("n")) y1 = Math.max(0, Math.min(y2 - 24, drag.y + (p.y - drag.py)));
            if (drag.h.includes("s")) y2 = Math.min(workH, Math.max(y1 + 24, drag.y + drag.h + (p.y - drag.py)));
          }
          crop.x = x1; crop.y = y1; crop.w = x2 - x1; crop.h = y2 - y1;
        }
        drawCropOverlay();
      };
      const onUp = () => { drag = null; window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
      els.crop.addEventListener("pointerdown", (e) => {
        if (!crop) return;
        const handle = e.target.closest?.(".irc-crop-handle");
        if (handle) return;
        const p = toCanvas(e);
        drag = { mode: "move", px: p.x, py: p.y, x: crop.x, y: crop.y, w: crop.w, h: crop.h };
        window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
      });
      els.crop.querySelectorAll(".irc-crop-handle").forEach((h) =>
        h.addEventListener("pointerdown", (e) => {
          if (!crop) return;
          e.stopPropagation();
          const p = toCanvas(e);
          drag = { mode: "resize", h: h.dataset.h, px: p.x, py: p.y, x: crop.x, y: crop.y, w: crop.w, h: crop.h };
          window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp);
        })
      );
    }

    window.addEventListener("resize", () => drawCropOverlay());
    window.addEventListener("orientationchange", () => drawCropOverlay());

    function loadFiles(files) {
      const file = files && files[0];
      if (!file) return;
      if (!/^image\//.test(file.type || "")) { setError(els.error, "请选择图片文件"); return; }
      fileBlob = file;
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => {
        img = image;
        applyImage(image, file);
        if (els.meta) els.meta.textContent = `${file.name} · ${(file.size / 1024).toFixed(1)} KB · 原图 ${image.naturalWidth}×${image.naturalHeight}`;
        URL.revokeObjectURL(url);
      };
      image.onerror = () => { setError(els.error, "读取图片失败"); URL.revokeObjectURL(url); };
      image.src = url;
    }
  });
})();
