(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const panel = $("#nokiasms");
  if (!panel) return;

  const STORE_KEY = "devtools-nokiasms-v1";
  const MAX_CHARS = 900;
  const W = 640;
  const H = 1080;

  const textEl = $("#nk-text");
  const countEl = $("#nk-count");
  const titleEl = $("#nk-title");
  const opEl = $("#nk-op");
  const timeEl = $("#nk-time");
  const leftKeyEl = $("#nk-left-key");
  const rightKeyEl = $("#nk-right-key");
  const signalEl = $("#nk-signal");
  const battEl = $("#nk-batt");
  const sizeEl = $("#nk-size");
  const sizeVal = $("#nk-size-val");
  const tiltEl = $("#nk-tilt");
  const counterEl = $("#nk-counter");
  const canvas = $("#nk-canvas");
  const metaEl = $("#nk-meta");
  const errorEl = $("#nk-error");
  const ctx = canvas?.getContext("2d");

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

  function clamp(n, min, max, fallback) {
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, Math.round(n)));
  }

  function readState() {
    return {
      text: String(textEl?.value || "").slice(0, MAX_CHARS),
      title: String(titleEl?.value || "短信").slice(0, 12),
      op: String(opEl?.value || "中国移动").slice(0, 12),
      time: String(timeEl?.value || "12:00").slice(0, 8),
      leftKey: String(leftKeyEl?.value || "选项").slice(0, 6),
      rightKey: String(rightKeyEl?.value || "返回").slice(0, 6),
      signal: clamp(Number(signalEl?.value), 0, 5, 4),
      batt: clamp(Number(battEl?.value), 0, 5, 3),
      size: clamp(Number(sizeEl?.value), 14, 32, 22),
      tilt: Boolean(tiltEl?.checked),
      counter: Boolean(counterEl?.checked),
    };
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
      if (textEl && s.text != null) textEl.value = s.text;
      if (titleEl && s.title != null) titleEl.value = s.title;
      if (opEl && s.op != null) opEl.value = s.op;
      if (timeEl && s.time != null) timeEl.value = s.time;
      if (leftKeyEl && s.leftKey != null) leftKeyEl.value = s.leftKey;
      if (rightKeyEl && s.rightKey != null) rightKeyEl.value = s.rightKey;
      if (signalEl && s.signal != null) signalEl.value = String(s.signal);
      if (battEl && s.batt != null) battEl.value = String(s.batt);
      if (sizeEl && s.size) sizeEl.value = String(s.size);
      if (tiltEl) tiltEl.checked = Boolean(s.tilt);
      if (counterEl) counterEl.checked = s.counter !== false;
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

  function wrapLines(c, text, maxWidth, font) {
    c.font = font;
    const lines = [];
    const paragraphs = String(text || "").split("\n");
    paragraphs.forEach((para, pi) => {
      if (!para) {
        lines.push("");
        return;
      }
      let line = "";
      for (const ch of para) {
        const next = line + ch;
        if (c.measureText(next).width > maxWidth && line) {
          lines.push(line);
          line = ch;
        } else {
          line = next;
        }
      }
      if (line || pi === 0) lines.push(line);
    });
    return lines;
  }

  function drawSignal(c, x, y, bars, on) {
    c.save();
    for (let i = 0; i < 5; i++) {
      const h = 4 + i * 3.2;
      c.fillStyle = i < bars ? on : "rgba(28,34,20,0.28)";
      c.fillRect(x + i * 5.2, y - h, 4, h);
    }
    c.restore();
  }

  function drawBattery(c, x, y, level, on) {
    c.save();
    c.strokeStyle = on;
    c.lineWidth = 1.4;
    c.strokeRect(x, y - 8, 18, 10);
    c.fillStyle = on;
    c.fillRect(x + 18, y - 5, 2.5, 4);
    const inner = Math.max(0, Math.min(5, level)) / 5;
    c.fillRect(x + 2, y - 6, 14 * inner, 6);
    c.restore();
  }

  function lcdFont(px, bold) {
    const weight = bold ? "700" : "600";
    return `${weight} ${px}px "SimHei", "Heiti SC", "PingFang SC", "Microsoft YaHei", sans-serif`;
  }

  function drawKey(c, x, y, w, h, label, sub, fill, fg) {
    const g = c.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, fill[0]);
    g.addColorStop(1, fill[1]);
    c.fillStyle = g;
    roundRect(c, x, y, w, h, 10);
    c.fill();
    c.fillStyle = "rgba(255,255,255,0.12)";
    roundRect(c, x + 3, y + 2, w - 6, h * 0.38, 6);
    c.fill();
    c.fillStyle = fg;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.font = lcdFont(label.length > 1 ? 15 : 18, true);
    c.fillText(label, x + w / 2, y + h * (sub ? 0.42 : 0.52));
    if (sub) {
      c.font = "500 9px Arial, sans-serif";
      c.fillStyle = "rgba(230,230,230,0.7)";
      c.fillText(sub, x + w / 2, y + h * 0.72);
    }
  }

  function drawPhone(c, s) {
    const px = 78;
    const py = 36;
    const pw = 484;
    const ph = 1008;

    c.save();
    c.shadowColor = "rgba(0,0,0,0.45)";
    c.shadowBlur = 28;
    c.shadowOffsetY = 18;
    const body = c.createLinearGradient(px, py, px + pw, py + ph);
    body.addColorStop(0, "#4a4e55");
    body.addColorStop(0.18, "#2c3036");
    body.addColorStop(0.7, "#1c1f24");
    body.addColorStop(1, "#14161a");
    c.fillStyle = body;
    roundRect(c, px, py, pw, ph, 86);
    c.fill();
    c.restore();

    c.fillStyle = "#2a2e34";
    roundRect(c, px + 168, py - 10, 70, 18, 8);
    c.fill();

    c.fillStyle = "#0d0f12";
    roundRect(c, px + pw - 42, py + 22, 18, 46, 6);
    c.fill();

    c.fillStyle = "#0a0c0e";
    roundRect(c, px + 198, py + 28, 88, 10, 5);
    c.fill();
    c.fillStyle = "#3a3e44";
    for (let i = 0; i < 8; i++) {
      c.beginPath();
      c.arc(px + 208 + i * 9, py + 33, 1.6, 0, Math.PI * 2);
      c.fill();
    }

    const sx = px + 42;
    const sy = py + 56;
    const sw = pw - 84;
    const sh = 318;
    c.fillStyle = "#0e1013";
    roundRect(c, sx, sy, sw, sh, 14);
    c.fill();
    c.fillStyle = "#6a6f76";
    roundRect(c, sx + 8, sy + 8, sw - 16, sh - 16, 8);
    c.fill();

    const lx = sx + 16;
    const ly = sy + 16;
    const lw = sw - 32;
    const lh = sh - 32;
    const lcd = c.createLinearGradient(lx, ly, lx, ly + lh);
    lcd.addColorStop(0, "#d4ddb0");
    lcd.addColorStop(0.5, "#c2cd9a");
    lcd.addColorStop(1, "#b3bf88");
    c.fillStyle = lcd;
    c.fillRect(lx, ly, lw, lh);

    c.save();
    c.beginPath();
    c.rect(lx, ly, lw, lh);
    c.clip();
    c.strokeStyle = "rgba(255,255,255,0.12)";
    c.lineWidth = 1;
    for (let y = ly; y < ly + lh; y += 3) {
      c.beginPath();
      c.moveTo(lx, y);
      c.lineTo(lx + lw, y);
      c.stroke();
    }

    const ink = "#1a2210";
    const pad = 10;
    drawSignal(c, lx + pad, ly + 18, s.signal, ink);
    c.fillStyle = ink;
    c.font = lcdFont(13, true);
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillText(s.op, lx + pad + 32, ly + 14);
    c.textAlign = "right";
    c.font = lcdFont(13, true);
    c.fillText(s.time, lx + lw - pad - 28, ly + 14);
    drawBattery(c, lx + lw - pad - 22, ly + 18, s.batt, ink);

    c.textAlign = "center";
    c.font = lcdFont(18, true);
    c.fillText(s.title, lx + lw / 2, ly + 42);
    c.strokeStyle = ink;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(lx + pad, ly + 54);
    c.lineTo(lx + lw - pad, ly + 54);
    c.stroke();

    const bodyFont = lcdFont(s.size, true);
    const lines = wrapLines(c, s.text, lw - pad * 2, bodyFont);
    const lineH = s.size + 6;
    const maxLines = Math.max(1, Math.floor((lh - 54 - 36) / lineH));
    c.textAlign = "left";
    c.textBaseline = "top";
    c.font = bodyFont;
    c.fillStyle = ink;
    lines.slice(0, maxLines).forEach((line, i) => {
      c.fillText(line, lx + pad, ly + 62 + i * lineH);
    });
    if (lines.length > maxLines) {
      c.fillText("…", lx + pad, ly + 62 + maxLines * lineH);
    }

    c.font = lcdFont(14, true);
    c.textAlign = "left";
    c.textBaseline = "middle";
    c.fillText(s.leftKey, lx + pad, ly + lh - 16);
    c.textAlign = "right";
    c.fillText(s.rightKey, lx + lw - pad, ly + lh - 16);

    if (s.counter) {
      c.font = lcdFont(11, true);
      c.fillStyle = "#2a6f9a";
      c.textAlign = "right";
      c.fillText(`${s.text.length}/${MAX_CHARS}`, lx + lw - pad, ly + 42);
    }
    c.restore();

    const nx = px + pw / 2;
    const ny = sy + sh + 52;
    const navi = c.createRadialGradient(nx - 8, ny - 10, 8, nx, ny, 46);
    navi.addColorStop(0, "#5b6168");
    navi.addColorStop(1, "#1a1d22");
    c.fillStyle = navi;
    c.beginPath();
    c.ellipse(nx, ny, 58, 36, 0, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#2e333a";
    c.beginPath();
    c.ellipse(nx, ny, 22, 14, 0, 0, Math.PI * 2);
    c.fill();

    drawKey(c, px + 58, ny - 22, 78, 44, "C", "呼叫", ["#3d8f4a", "#1e5a28"], "#d8f5d4");
    drawKey(c, px + pw - 136, ny - 22, 78, 44, "U", "关机", ["#a33b3b", "#6a1f1f"], "#f8d4d4");

    const keys = [
      ["1", ""],
      ["2", "ABC"],
      ["3", "DEF"],
      ["4", "GHI"],
      ["5", "JKL"],
      ["6", "MNO"],
      ["7", "PQRS"],
      ["8", "TUV"],
      ["9", "WXYZ"],
      ["*", ""],
      ["0", "+"],
      ["#", ""],
    ];
    const kw = 108;
    const kh = 52;
    const k0x = px + 70;
    const k0y = ny + 48;
    keys.forEach((k, i) => {
      const col = i % 3;
      const row = Math.floor(i / 3);
      drawKey(
        c,
        k0x + col * (kw + 14),
        k0y + row * (kh + 12),
        kw,
        kh,
        k[0],
        k[1],
        ["#3a3f46", "#1c1f24"],
        "#e8edf2"
      );
    });

    c.fillStyle = "rgba(180,186,194,0.55)";
    c.font = '600 13px Arial, "Helvetica Neue", sans-serif';
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText("NOKIA", nx, py + ph - 28);
  }

  function paint() {
    if (!ctx || !canvas) return;
    const s = readState();
    if (sizeVal) sizeVal.textContent = String(s.size);
    if (countEl) countEl.textContent = `${s.text.length} / ${MAX_CHARS}`;
    const dpr = 2;
    const tilt = s.tilt ? -9.8 * (Math.PI / 180) : 0;
    const pad = s.tilt ? 70 : 0;
    const outW = W + pad * 2;
    const outH = H + pad * 2;
    canvas.width = Math.round(outW * dpr);
    canvas.height = Math.round(outH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, outW, outH);
    ctx.fillStyle = "#0b0d10";
    ctx.fillRect(0, 0, outW, outH);
    ctx.save();
    if (tilt) {
      ctx.translate(outW / 2, outH / 2);
      ctx.rotate(tilt);
      ctx.translate(-W / 2, -H / 2);
    } else {
      ctx.translate(pad, pad);
    }
    drawPhone(ctx, s);
    ctx.restore();
    canvas.style.width = `${Math.round(outW * 0.58)}px`;
    canvas.style.maxWidth = "100%";
    canvas.style.height = "auto";
    if (metaEl) metaEl.textContent = `${outW}×${outH} · 2× PNG`;
  }

  function toBlob() {
    return new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("导出失败"))), "image/png");
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

  async function ensureMemoApi(fn) {
    for (let i = 0; i < 40; i++) {
      const api = window.DevToolsMemo;
      if (api && typeof api[fn] === "function") return api;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("备忘录未就绪，请稍后重试");
  }

  function onChange() {
    setError("");
    paint();
    save();
  }

  [textEl, titleEl, opEl, timeEl, leftKeyEl, rightKeyEl, signalEl, battEl, sizeEl, tiltEl, counterEl].forEach((el) => {
    el?.addEventListener("input", onChange);
    el?.addEventListener("change", onChange);
  });

  $("#nk-download")?.addEventListener("click", async () => {
    try {
      paint();
      downloadBlob(await toBlob(), "nokia-sms.png");
      toast("已下载 PNG");
    } catch (e) {
      setError(e.message || String(e));
    }
  });

  $("#nk-copy")?.addEventListener("click", async () => {
    try {
      paint();
      if (!navigator.clipboard || typeof ClipboardItem === "undefined") throw new Error("当前环境不支持复制图片");
      await navigator.clipboard.write([new ClipboardItem({ "image/png": await toBlob() })]);
      toast("已复制图片");
    } catch (e) {
      setError(e.message || String(e));
    }
  });

  $("#nk-to-memo")?.addEventListener("click", async () => {
    try {
      paint();
      const memo = await ensureMemoApi("ingestBlob");
      await memo.ingestBlob(await toBlob(), "nokia-sms.png");
      toast("已保存到备忘录");
    } catch (e) {
      setError(e.message || String(e));
    }
  });

  $("#nk-now")?.addEventListener("click", () => {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    if (timeEl) timeEl.value = `${hh}:${mm}`;
    onChange();
  });

  load();
  paint();
  document.addEventListener("devtools:route", (e) => {
    if (e.detail?.tool === "nokiasms") paint();
  });
})();
