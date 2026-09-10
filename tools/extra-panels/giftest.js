(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, setError, toast, bindPanel, formatKb } = K;

  function hslToRgb(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
      const k = (n + h * 12) % 12;
      return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    };
    const r = Math.round(f(0) * 255);
    const g = Math.round(f(8) * 255);
    const b = Math.round(f(4) * 255);
    return (r << 16) | (g << 8) | b;
  }

  function makePalette() {
    const pal = new Array(256);
    for (let i = 0; i < 256; i++) pal[i] = hslToRgb((i * 3) / 256, 0.85, 0.5);
    return pal;
  }

  function setProgress(visible, ratio, text) {
    const box = $("#gt-progress");
    if (!box) return;
    box.hidden = !visible;
    if (!visible) return;
    const pct = Math.max(0, Math.min(100, Math.round((ratio || 0) * 100)));
    const fill = $("#gt-progress-fill");
    if (fill) fill.style.width = `${Math.max(pct, pct > 0 && pct < 8 ? 8 : pct)}%`;
    const pctEl = $("#gt-progress-pct");
    if (pctEl) pctEl.textContent = `${pct}%`;
    const t = $("#gt-progress-text");
    if (t) t.textContent = String(text || "");
  }

  function generate(targetBytes, w, h, onProgress) {
    const GifWriter = globalThis.GifWriter;
    if (typeof GifWriter !== "function") throw new Error("GIF 编码器未就绪");
    const palette = makePalette();
    const buf = new Uint8Array(Math.ceil(targetBytes * 1.6) + 2 * 1024 * 1024);
    const gw = new GifWriter(buf, w, h, { palette, loop: 0 });
    const frame = new Uint8Array(w * h);
    const maxFrames = 4000;
    let frames = 0;
    for (; frames < maxFrames; frames++) {
      const base = (frames * 3) % 256;
      for (let i = 0; i < frame.length; i++) {
        // 大部分为纯色（颜色随时间变化），少量噪点用于把体积抬到目标
        frame[i] = Math.random() < 0.5 ? (Math.random() * 256) | 0 : base;
      }
      gw.addFrame(0, 0, w, h, frame, { palette, delay: 6, disposal: 1 });
      const pos = gw.getOutputBufferPosition();
      if (frames % 8 === 0) onProgress?.(Math.min(1, pos / targetBytes), `${frames + 1} 帧 · ${formatKb(pos)}`);
      if (pos >= targetBytes) break;
    }
    gw.end();
    const size = gw.getOutputBufferPosition();
    const blob = new Blob([buf.subarray(0, size)], { type: "image/gif" });
    return { blob, frames: frames + 1, size };
  }

  bindPanel("giftest", (root) => {
    root = root || document.getElementById("giftest");
    const mbEl = $("#gt-mb", root);
    const wEl = $("#gt-w", root);
    const hEl = $("#gt-h", root);
    const runEl = $("#gt-run", root);
    const dlEl = $("#gt-dl", root);
    const metaEl = $("#gt-meta", root);
    const prevEl = $("#gt-preview", root);
    const errEl = $("#gt-error", root);
    let outBlob = null;
    let outUrl = "";

    runEl?.addEventListener("click", () => {
      try {
        setError(errEl, "");
        const targetMB = Math.max(0.2, Math.min(60, Number(mbEl.value) || 6));
        const w = Math.max(16, Math.min(1280, Math.round(Number(wEl.value) || 320)));
        const h = Math.max(16, Math.min(1280, Math.round(Number(hEl.value) || 240)));
        setProgress(true, 0, "生成中…");
        // 让 UI 先刷新
        setTimeout(() => {
          try {
            const res = generate(targetMB * 1024 * 1024, w, h, (r, t) => setProgress(true, r, t));
            outBlob = res.blob;
            if (outUrl) {
              try { URL.revokeObjectURL(outUrl); } catch (_) {}
            }
            outUrl = URL.createObjectURL(outBlob);
            if (prevEl) {
              prevEl.hidden = false;
              prevEl.innerHTML = `<div class="gif-frame vsplit-clip"><img src="${outUrl}" alt="测试 GIF" /></div>`;
            }
            if (metaEl) metaEl.textContent = `实际大小 ${formatKb(res.size)} · ${res.frames} 帧 · ${w}×${h}`;
            if (dlEl) dlEl.disabled = false;
            setProgress(false);
            toast("已生成测试 GIF");
          } catch (err) {
            setProgress(false);
            setError(errEl, err.message || String(err));
          }
        }, 30);
      } catch (err) {
        setProgress(false);
        setError(errEl, err.message || String(err));
      }
    });

    dlEl?.addEventListener("click", () => {
      if (!outBlob) return;
      const a = document.createElement("a");
      a.href = outUrl || URL.createObjectURL(outBlob);
      a.download = `test-${Math.round(outBlob.size / 1024)}KB.gif`;
      a.click();
    });
  });

  window.DevToolsExtraBoot = window.DevToolsExtraBoot || {};
  window.DevToolsExtraBoot["giftest"] = () => {};
})();
