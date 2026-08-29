(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  let timezone = "local";

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function formatDateTime(ms, tz) {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;

    const parts =
      tz === "utc"
        ? {
            y: d.getUTCFullYear(),
            m: d.getUTCMonth() + 1,
            day: d.getUTCDate(),
            h: d.getUTCHours(),
            min: d.getUTCMinutes(),
            s: d.getUTCSeconds(),
          }
        : {
            y: d.getFullYear(),
            m: d.getMonth() + 1,
            day: d.getDate(),
            h: d.getHours(),
            min: d.getMinutes(),
            s: d.getSeconds(),
          };

    return `${parts.y}-${pad(parts.m)}-${pad(parts.day)} ${pad(parts.h)}:${pad(parts.min)}:${pad(parts.s)}`;
  }

  function parseDateTime(text, tz) {
    const raw = text.trim();
    if (!raw) return null;

    // HTML datetime-local: 2024-06-30T12:00 or with seconds
    const localLike = raw.match(
      /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/
    );
    if (!localLike) return null;

    const y = Number(localLike[1]);
    const m = Number(localLike[2]) - 1;
    const day = Number(localLike[3]);
    const h = Number(localLike[4]);
    const min = Number(localLike[5]);
    const s = Number(localLike[6] || 0);

    const ms =
      tz === "utc"
        ? Date.UTC(y, m, day, h, min, s)
        : new Date(y, m, day, h, min, s).getTime();

    return Number.isNaN(ms) ? null : ms;
  }

  function normalizeTimestamp(raw) {
    const cleaned = String(raw).trim().replace(/[,\s_]/g, "");
    if (!/^-?\d+$/.test(cleaned)) return null;
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return null;

    // 10 digits (~seconds), 13 digits (~ms). Also handle slightly shorter/longer.
    const abs = Math.abs(n);
    if (abs < 1e11) return { ms: n * 1000, unit: "秒" };
    if (abs < 1e14) return { ms: n, unit: "毫秒" };
    // microseconds-ish
    if (abs < 1e17) return { ms: Math.trunc(n / 1000), unit: "微秒→毫秒" };
    return null;
  }

  function showToast(msg) {
    const el = $("#toast");
    el.textContent = msg;
    el.hidden = false;
    el.classList.add("is-show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => {
      el.classList.remove("is-show");
      setTimeout(() => {
        el.hidden = true;
      }, 200);
    }, 1600);
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      showToast("已复制");
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
      showToast("已复制");
    }
  }

  // ---- Timestamp ----
  const tsInput = $("#ts-input");
  const dtInput = $("#dt-input");
  const tsHint = $("#ts-hint");
  const tsError = $("#ts-error");
  const tsResult = $("#ts-result");
  const tsResultValue = $("#ts-result-value");
  const dtResult = $("#dt-result");
  const dtResultValue = $("#dt-result-value");

  function setTsError(msg) {
    if (!msg) {
      tsError.hidden = true;
      tsError.textContent = "";
      return;
    }
    tsError.hidden = false;
    tsError.textContent = msg;
  }

  function convertTsToDate() {
    const parsed = normalizeTimestamp(tsInput.value);
    if (!parsed) {
      tsResult.hidden = true;
      setTsError("请输入有效的数字时间戳（秒或毫秒）");
      return;
    }
    const formatted = formatDateTime(parsed.ms, timezone);
    if (!formatted) {
      tsResult.hidden = true;
      setTsError("时间戳超出可解析范围");
      return;
    }
    setTsError("");
    tsHint.textContent = `识别为${parsed.unit}时间戳`;
    tsResultValue.textContent = formatted + (timezone === "utc" ? " UTC" : "");
    tsResult.hidden = false;
  }

  function convertDateToTs(asMs) {
    const ms = parseDateTime(dtInput.value, timezone);
    if (ms === null) {
      dtResult.hidden = true;
      setTsError("日期格式应为 YYYY-MM-DD HH:mm:ss");
      return;
    }
    setTsError("");
    dtResultValue.textContent = String(asMs ? ms : Math.floor(ms / 1000));
    dtResult.hidden = false;
  }

  $$(".seg-btn[data-tz]").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".seg-btn[data-tz]").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      timezone = btn.dataset.tz;
      if (tsInput.value.trim()) convertTsToDate();
      if (dtInput.value.trim() && !dtResult.hidden) convertDateToTs(false);
    });
  });

  $("#ts-now").addEventListener("click", () => {
    const now = Date.now();
    tsInput.value = String(Math.floor(now / 1000));
    dtInput.value = formatDateTime(now, timezone);
    convertTsToDate();
  });

  $("#ts-to-date").addEventListener("click", convertTsToDate);
  $("#date-to-ts-s").addEventListener("click", () => convertDateToTs(false));
  $("#date-to-ts-ms").addEventListener("click", () => convertDateToTs(true));

  tsInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") convertTsToDate();
  });
  dtInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") convertDateToTs(false);
  });

  // ---- AHEX ----
  const ahexInput = $("#ahex-input");
  const ahexSwatch = $("#ahex-swatch");
  const ahexResult = $("#ahex-result");
  const ahexCss = $("#ahex-css");
  const ahexError = $("#ahex-error");
  const ahexChannels = $("#ahex-channels");

  const sliderA = $("#slider-a");
  const sliderR = $("#slider-r");
  const sliderG = $("#slider-g");
  const sliderB = $("#slider-b");
  const numA = $("#num-a");
  const numR = $("#num-r");
  const numG = $("#num-g");
  const numB = $("#num-b");
  const numOpacity = $("#num-opacity");
  const editR = $("#edit-r");
  const editG = $("#edit-g");
  const editB = $("#edit-b");
  const editHex = $("#edit-hex");

  /** @type {{a:number,r:number,g:number,b:number}} */
  let color = { a: 255, r: 0, g: 0, b: 0 };
  let syncing = false;

  function clampByte(n) {
    if (!Number.isFinite(n)) return null;
    return Math.min(255, Math.max(0, Math.round(n)));
  }

  function alphaToOpacityPct(a) {
    return Math.round((a / 255) * 100);
  }

  function opacityPctToAlpha(pct) {
    if (!Number.isFinite(pct)) return null;
    return clampByte((Math.min(100, Math.max(0, pct)) / 100) * 255);
  }

  function parseOpacityInput(raw) {
    const digits = String(raw ?? "").replace(/[^\d]/g, "");
    if (digits === "") return { text: "", pct: null };
    const pct = Math.min(100, parseInt(digits, 10));
    if (!Number.isFinite(pct)) return { text: "", pct: null };
    return { text: String(pct), pct };
  }

  function toHex2(n) {
    return n.toString(16).toUpperCase().padStart(2, "0");
  }

  function colorToAhex({ a, r, g, b }) {
    return `#${toHex2(a)}${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
  }

  function parseAhex(value) {
    let v = value.trim().toUpperCase();
    if (v.startsWith("0X")) v = v.slice(2);
    if (v.startsWith("#")) v = v.slice(1);

    // Allow 8-digit AARRGGBB, or 6-digit RRGGBB (assume FF alpha), or 4-digit shorthand ARGB
    if (/^[0-9A-F]{8}$/.test(v)) {
      return {
        a: parseInt(v.slice(0, 2), 16),
        r: parseInt(v.slice(2, 4), 16),
        g: parseInt(v.slice(4, 6), 16),
        b: parseInt(v.slice(6, 8), 16),
        normalized: `#${v}`,
      };
    }
    if (/^[0-9A-F]{6}$/.test(v)) {
      return {
        a: 255,
        r: parseInt(v.slice(0, 2), 16),
        g: parseInt(v.slice(2, 4), 16),
        b: parseInt(v.slice(4, 6), 16),
        normalized: `#FF${v}`,
      };
    }
    if (/^[0-9A-F]{4}$/.test(v)) {
      const a = parseInt(v[0] + v[0], 16);
      const r = parseInt(v[1] + v[1], 16);
      const g = parseInt(v[2] + v[2], 16);
      const b = parseInt(v[3] + v[3], 16);
      return { a, r, g, b, normalized: colorToAhex({ a, r, g, b }) };
    }
    return null;
  }

  function parseHexRgb(value) {
    let v = value.trim().toUpperCase();
    if (v.startsWith("#")) v = v.slice(1);
    if (/^[0-9A-F]{6}$/.test(v)) {
      return {
        r: parseInt(v.slice(0, 2), 16),
        g: parseInt(v.slice(2, 4), 16),
        b: parseInt(v.slice(4, 6), 16),
      };
    }
    if (/^[0-9A-F]{3}$/.test(v)) {
      return {
        r: parseInt(v[0] + v[0], 16),
        g: parseInt(v[1] + v[1], 16),
        b: parseInt(v[2] + v[2], 16),
      };
    }
    return null;
  }

  function setSliderFill(slider, value) {
    slider.style.setProperty("--slider-pct", `${(value / 255) * 100}%`);
  }

  function applyColor(next, { updateAhexInput = true } = {}) {
    color = {
      a: clampByte(next.a) ?? color.a,
      r: clampByte(next.r) ?? color.r,
      g: clampByte(next.g) ?? color.g,
      b: clampByte(next.b) ?? color.b,
    };

    const { a, r, g, b } = color;
    const opacityPct = alphaToOpacityPct(a);
    const css = `rgba(${r}, ${g}, ${b}, ${opacityPct / 100})`;
    const ahex = colorToAhex(color);

    syncing = true;
    try {
      if (updateAhexInput) ahexInput.value = ahex;

      sliderA.value = String(a);
      sliderR.value = String(r);
      sliderG.value = String(g);
      sliderB.value = String(b);
      setSliderFill(sliderA, a);
      setSliderFill(sliderR, r);
      setSliderFill(sliderG, g);
      setSliderFill(sliderB, b);

      if (document.activeElement !== numA) numA.value = String(a);
      if (document.activeElement !== numR) numR.value = String(r);
      if (document.activeElement !== numG) numG.value = String(g);
      if (document.activeElement !== numB) numB.value = String(b);

      // 始终以整数百分比显示；输入过程中也不要回写成小数
      if (document.activeElement !== numOpacity) {
        numOpacity.value = String(opacityPct);
      }
      if (document.activeElement !== editR) editR.value = String(r);
      if (document.activeElement !== editG) editG.value = String(g);
      if (document.activeElement !== editB) editB.value = String(b);
      if (document.activeElement !== editHex) {
        editHex.value = `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;
      }

      ahexSwatch.style.backgroundColor = css;
      ahexCss.textContent = css;
      ahexResult.hidden = false;
      ahexChannels.hidden = false;
      ahexError.hidden = true;
    } finally {
      syncing = false;
    }
  }

  function renderFromAhexInput() {
    const parsed = parseAhex(ahexInput.value);
    if (!parsed) {
      ahexResult.hidden = true;
      ahexChannels.hidden = true;
      ahexError.hidden = false;
      ahexError.textContent = "请输入有效 AHEX，例如 #FF000000";
      ahexSwatch.style.backgroundColor = "transparent";
      return;
    }
    applyColor(parsed, { updateAhexInput: false });
  }

  function updateChannel(key, raw) {
    const value = clampByte(Number(raw));
    if (value === null) return;
    applyColor({ ...color, [key]: value });
  }

  ahexInput.addEventListener("input", () => {
    if (syncing) return;
    renderFromAhexInput();
  });

  [
    [sliderA, numA, "a"],
    [sliderR, numR, "r"],
    [sliderG, numG, "g"],
    [sliderB, numB, "b"],
  ].forEach(([slider, num, key]) => {
    slider.addEventListener("input", () => {
      if (syncing) return;
      updateChannel(key, slider.value);
    });
    num.addEventListener("input", () => {
      if (syncing) return;
      updateChannel(key, num.value);
    });
  });

  numOpacity.addEventListener("input", () => {
    if (syncing) return;
    const parsed = parseOpacityInput(numOpacity.value);
    // 过滤小数点等非数字，输入框始终保持整数文本
    if (numOpacity.value !== parsed.text) {
      numOpacity.value = parsed.text;
    }
    if (parsed.pct === null) return;
    const a = opacityPctToAlpha(parsed.pct);
    if (a === null) return;
    applyColor({ ...color, a });
  });

  numOpacity.addEventListener("blur", () => {
    numOpacity.value = String(alphaToOpacityPct(color.a));
  });

  [
    [editR, "r"],
    [editG, "g"],
    [editB, "b"],
  ].forEach(([el, key]) => {
    el.addEventListener("input", () => {
      if (syncing) return;
      updateChannel(key, el.value);
    });
  });

  editHex.addEventListener("input", () => {
    if (syncing) return;
    const parsed = parseHexRgb(editHex.value);
    if (!parsed) return;
    applyColor({ ...color, ...parsed });
  });

  $$(".preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      ahexInput.value = btn.dataset.ahex;
      renderFromAhexInput();
    });
  });

  // ---- Base64 ----
  const b64Text = $("#b64-text");
  const b64Encoded = $("#b64-encoded");
  const b64Error = $("#b64-error");
  const b64Meta = $("#b64-meta");

  function setToolError(el, msg) {
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }

  function bytesToBase64(bytes) {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToBytes(b64) {
    const cleaned = b64.replace(/\s+/g, "");
    const binary = atob(cleaned);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function encodeTextToBase64(text) {
    return bytesToBase64(new TextEncoder().encode(text));
  }

  function decodeBase64ToText(b64) {
    return new TextDecoder().decode(base64ToBytes(b64));
  }

  function encodeBase64() {
    try {
      const encoded = encodeTextToBase64(b64Text.value);
      b64Encoded.value = encoded;
      setToolError(b64Error, "");
      b64Meta.textContent = `已编码 · 文本 ${b64Text.value.length} 字符 → Base64 ${encoded.length} 字符`;
    } catch (err) {
      setToolError(b64Error, `编码失败：${err.message || err}`);
    }
  }

  function decodeBase64() {
    try {
      const decoded = decodeBase64ToText(b64Encoded.value);
      b64Text.value = decoded;
      setToolError(b64Error, "");
      b64Meta.textContent = `已解码 · Base64 ${b64Encoded.value.replace(/\s+/g, "").length} 字符 → 文本 ${decoded.length} 字符`;
    } catch (err) {
      setToolError(b64Error, "解码失败：请检查 Base64 是否合法");
    }
  }

  $("#b64-encode").addEventListener("click", encodeBase64);
  $("#b64-decode").addEventListener("click", decodeBase64);
  $("#b64-swap").addEventListener("click", () => {
    const t = b64Text.value;
    b64Text.value = b64Encoded.value;
    b64Encoded.value = t;
    b64Meta.textContent = "已互换两侧内容";
    setToolError(b64Error, "");
  });
  $("#b64-clear").addEventListener("click", () => {
    b64Text.value = "";
    b64Encoded.value = "";
    b64Meta.textContent = "";
    setToolError(b64Error, "");
  });
  $("#b64-file").addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      const encoded = bytesToBase64(new Uint8Array(buffer));
      b64Encoded.value = encoded;
      b64Text.value = "";
      setToolError(b64Error, "");
      b64Meta.textContent = `已编码文件「${file.name}」· ${file.size} 字节 → Base64 ${encoded.length} 字符`;
    } catch (err) {
      setToolError(b64Error, `文件编码失败：${err.message || err}`);
    } finally {
      e.target.value = "";
    }
  });

  // ---- JSON ----
  const jsonInput = $("#json-input");
  const jsonError = $("#json-error");
  const jsonMeta = $("#json-meta");
  const JSON_AREA_MIN_PX = 192;

  function parseJsonInput() {
    const raw = jsonInput.value.trim();
    if (!raw) throw new Error("请先输入 JSON");
    return JSON.parse(raw);
  }

  /** 按内容适度撑高，但留出按钮区域，超出则框内滚动 */
  function fitJsonArea() {
    if (!jsonInput) return;
    const maxPx = Math.max(JSON_AREA_MIN_PX, Math.min(448, Math.floor(window.innerHeight * 0.42)));
    jsonInput.style.height = "auto";
    const needed = Math.ceil(jsonInput.scrollHeight + 2);
    const next = Math.min(maxPx, Math.max(JSON_AREA_MIN_PX, needed));
    jsonInput.style.height = `${next}px`;
    jsonInput.style.overflowY = needed > maxPx ? "auto" : "hidden";
  }

  function resetJsonAreaHeight() {
    if (!jsonInput) return;
    jsonInput.style.height = "";
    jsonInput.style.overflowY = "";
  }

  function runJson(mode) {
    try {
      const data = parseJsonInput();
      setToolError(jsonError, "");
      if (mode === "validate") {
        // 校验通过时顺带美化，便于完整预览
        const pretty = JSON.stringify(data, null, 2);
        jsonInput.value = pretty;
        jsonMeta.textContent = `校验通过 · 根类型 ${Array.isArray(data) ? "array" : typeof data} · ${pretty.split("\n").length} 行`;
        fitJsonArea();
        showToast("JSON 合法");
        return;
      }
      const out = mode === "pretty" ? JSON.stringify(data, null, 2) : JSON.stringify(data);
      jsonInput.value = out;
      jsonMeta.textContent =
        mode === "pretty"
          ? `已美化 · ${out.split("\n").length} 行 · ${out.length} 字符`
          : `已压缩 · ${out.length} 字符`;
      fitJsonArea();
    } catch (err) {
      jsonMeta.textContent = "";
      setToolError(jsonError, `JSON 无效：${err.message || err}`);
    }
  }

  $("#json-pretty").addEventListener("click", () => runJson("pretty"));
  $("#json-minify").addEventListener("click", () => runJson("minify"));
  $("#json-validate").addEventListener("click", () => runJson("validate"));
  $("#json-clear").addEventListener("click", () => {
    jsonInput.value = "";
    jsonMeta.textContent = "";
    setToolError(jsonError, "");
    resetJsonAreaHeight();
  });

  // ---- Regex ----
  const rePattern = $("#re-pattern");
  const reFlags = $("#re-flags");
  const reText = $("#re-text");
  const reHighlight = $("#re-highlight");
  const reMatches = $("#re-matches");
  const reMeta = $("#re-meta");
  const reError = $("#re-error");
  const flagChecks = $$("[data-flag]");
  let flagsSyncing = false;

  function uniqueFlags(raw) {
    const allowed = new Set(["g", "i", "m", "s", "u", "y", "d"]);
    const out = [];
    for (const ch of String(raw).toLowerCase()) {
      if (allowed.has(ch) && !out.includes(ch)) out.push(ch);
    }
    return out.join("");
  }

  function syncFlagsFromChecks() {
    flagsSyncing = true;
    reFlags.value = flagChecks
      .filter((el) => el.checked)
      .map((el) => el.dataset.flag)
      .join("");
    flagsSyncing = false;
  }

  function syncChecksFromFlags() {
    flagsSyncing = true;
    const flags = uniqueFlags(reFlags.value);
    reFlags.value = flags;
    flagChecks.forEach((el) => {
      el.checked = flags.includes(el.dataset.flag);
    });
    flagsSyncing = false;
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function runRegex() {
    const pattern = rePattern.value;
    const text = reText.value;
    const flags = uniqueFlags(reFlags.value);

    if (!pattern) {
      reHighlight.textContent = text;
      reMatches.innerHTML = `<p class="match-empty">输入正则后开始匹配</p>`;
      reMeta.textContent = "0 处匹配";
      setToolError(reError, "");
      return;
    }

    let regex;
    try {
      regex = new RegExp(pattern, flags);
      setToolError(reError, "");
    } catch (err) {
      reHighlight.textContent = text;
      reMatches.innerHTML = "";
      reMeta.textContent = "表达式无效";
      setToolError(reError, `正则无效：${err.message || err}`);
      return;
    }

    const matches = [];
    if (flags.includes("g")) {
      let m;
      let guard = 0;
      while ((m = regex.exec(text)) !== null) {
        matches.push(m);
        if (m[0] === "") {
          regex.lastIndex += 1;
        }
        guard += 1;
        if (guard > 5000) break;
      }
    } else {
      const m = regex.exec(text);
      if (m) matches.push(m);
    }

    // highlight
    if (!matches.length) {
      reHighlight.innerHTML = escapeHtml(text) || "&nbsp;";
      reMatches.innerHTML = `<p class="match-empty">无匹配</p>`;
      reMeta.textContent = "0 处匹配";
      return;
    }

    let html = "";
    let cursor = 0;
    matches.forEach((m) => {
      const start = m.index;
      const end = start + m[0].length;
      if (start < cursor) return; // overlapping / zero-width skip already advanced
      html += escapeHtml(text.slice(cursor, start));
      html += `<mark class="re-mark">${escapeHtml(text.slice(start, end)) || "∅"}</mark>`;
      cursor = end;
    });
    html += escapeHtml(text.slice(cursor));
    reHighlight.innerHTML = html || "&nbsp;";

    reMeta.textContent = `${matches.length} 处匹配`;
    reMatches.innerHTML = matches
      .map((m, i) => {
        const groups = m.slice(1)
          .map((g, gi) => `<li>组 ${gi + 1}: <strong class="mono">${escapeHtml(g ?? "undefined")}</strong></li>`)
          .join("");
        const named =
          m.groups && Object.keys(m.groups).length
            ? Object.entries(m.groups)
                .map(([k, v]) => `<li>${escapeHtml(k)}: <strong class="mono">${escapeHtml(v ?? "undefined")}</strong></li>`)
                .join("")
            : "";
        return `<article class="match-card">
          <div class="match-card-head">
            <span>#${i + 1}</span>
            <span class="mono">index ${m.index} · len ${m[0].length}</span>
          </div>
          <code class="match-text mono">${escapeHtml(m[0]) || "∅"}</code>
          ${groups || named ? `<ul class="match-groups">${groups}${named}</ul>` : ""}
        </article>`;
      })
      .join("");
  }

  flagChecks.forEach((el) => {
    el.addEventListener("change", () => {
      if (flagsSyncing) return;
      syncFlagsFromChecks();
      runRegex();
    });
  });
  reFlags.addEventListener("input", () => {
    if (flagsSyncing) return;
    syncChecksFromFlags();
    runRegex();
  });
  rePattern.addEventListener("input", runRegex);
  reText.addEventListener("input", runRegex);

  // ---- Copy / nav ----
  function copyFromValueEl(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const text = "value" in el ? el.value : el.textContent;
    if (text) copyText(text);
  }

  $$("[data-copy]").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.copy);
      if (target?.textContent) copyText(target.textContent);
    });
  });
  $$("[data-copy-value]").forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => copyFromValueEl(btn.dataset.copyValue));
  });

  // ---- Workspace shell: groups, search, single-tool route ----
  const ORDER_KEY = "devtools-tool-order-v3";
  const GROUP_ORDER_KEY = "devtools-group-order-v1";
  const RECENT_KEY = "devtools-tool-recent-v1";
  const FAVORITES_KEY = "devtools-tool-favorites-v1";
  const LAST_TOOL_KEY = "devtools-tool-last-v1";
  const LAST_TOOL_SESSION_KEY = "devtools-tool-last-session-v1";
  const SORT_HINT_KEY = "devtools-nav-sort-hint-seen-v1";
  /** 站点页不算「上次工具」，避免 about/setup 盖掉真实工具 */
  const SITE_NAV_IDS = new Set(["about", "setup"]);
  const MEDIA_TABS = ["gifmaker", "vsplit", "vtrim", "audio", "vplay"];
  const HASH_ALIASES = {
    gifmaker: { tool: "media", tab: "gifmaker" },
    vsplit: { tool: "media", tab: "vsplit" },
    vtrim: { tool: "media", tab: "vtrim" },
    audio: { tool: "media", tab: "audio" },
    vplay: { tool: "media", tab: "vplay" },
    vbb: { tool: "vbb" },
    blackbox: { tool: "vbb" },
  };
  const TOOL_GROUPS = [
    { id: "time", label: "时间", tools: ["timestamp", "timediff", "cron"] },
    { id: "color", label: "颜色", tools: ["ahex", "color", "eyedropper"] },
    { id: "encode", label: "编码与生成", tools: ["base64", "url", "hash", "password", "uuid"] },
    { id: "data", label: "数据格式", tools: ["json", "yaml", "query"] },
    {
      id: "text",
      label: "文本工具",
      tools: ["text", "caseconv", "regex", "diff", "markdown", "memo"],
    },
    { id: "blackbox", label: "黑盒", tools: ["vbb"] },
    { id: "media", label: "媒体", tools: ["gifmaker", "vsplit", "vtrim", "audio", "vplay"] },
    {
      id: "image",
      label: "图片",
      tools: ["imgpreview", "whiteboard", "imgkit", "textimg", "imgtext", "sharecard", "imgb64", "qrcode"],
    },
    { id: "convert", label: "换算", tools: ["units", "coord", "numbase"] },
    { id: "fun", label: "趣味", tools: ["wheel"] },
    { id: "health", label: "健康", tools: ["acupoint"] },
    { id: "device", label: "设备", tools: ["lanshare", "adb", "ffbridge"] },
    { id: "site", label: "站点", tools: ["about", "setup"] },
  ];
  const DEFAULT_GROUP_ORDER = TOOL_GROUPS.map((g) => g.id);
  const GROUP_BY_ID = Object.fromEntries(TOOL_GROUPS.map((g) => [g.id, g]));
  const TOOL_TO_GROUP = Object.fromEntries(
    TOOL_GROUPS.flatMap((g) => g.tools.map((id) => [id, g.id]))
  );
  /** 关于页说明：新增工具时请同步 TOOL_GROUPS、TOOL_META、ABOUT_DESC */
  const ABOUT_DESC = {
    timestamp: "秒/毫秒时间戳与日期互转，支持本地时区与 UTC。",
    timediff: "计算两个时间点的差值，支持时间戳或日期字符串。",
    cron: "解析 Cron 表达式并预览接下来的触发时间。",
    ahex: "Android AARRGGBB 颜色与通道滑块互转。",
    color: "HEX / RGB / HSL 颜色格式互转与预览。",
    eyedropper: "屏幕取色（需浏览器 EyeDropper 支持）。",
    password: "可配置字符集与长度的本地随机密码。",
    base64: "文本 Base64 编码与解码。",
    imgb64: "图片与 Base64 Data URL 互转。",
    url: "URL 编码 / 解码。",
    hash: "本地计算 MD5、SHA-256。",
    uuid: "生成 UUID / GUID。",
    json: "JSON 校验、美化与压缩。",
    yaml: "YAML 与 JSON 互转、校验。",
    sharecard: "代码/JSON 生成分享卡片图。",
    query: "Query 字符串与 JWT 解析查看。",
    text: "文本统计、去重、大小写等处理。",
    caseconv: "驼峰 / snake / kebab 等命名风格转换。",
    regex: "正则匹配测试与分组查看。",
    diff: "两段文本并排/合并比对，高亮增删改；可忽略空白、隐藏相同行。",
    qrcode: "生成与识别二维码。",
    markdown: "Markdown 预览。",
    memo: "本地备忘录：一键读剪贴板入库、搜索/点选筛选；文本图片可复制，其它类型可下载，手机可单条分享（文转图/OCR 见独立工具）。",
    gifmaker: "视频转 GIF/WebP、压缩、拼接、亮度等本地动图处理（≤6MB 黑盒见「黑盒」分类）。",
    vsplit: "预览打点切分视频片段，支持全屏标记与打包下载（黑盒 GIF 见「黑盒」分类）。",
    vbb: "预制参数一键出 ≤6MB 黑盒 GIF：整段或长视频自动切片，全程本地处理。",
    vtrim: "调整片头片尾时长、裁边框；网页 FFmpeg，手机可用。",
    vplay: "本地视频预览：滚轮缩放、拖拽移动、双击暂停/播放，双指捏合缩放。",
    audio: "修剪、音量、抽音轨；网页 FFmpeg 保底，电脑批量请用本机桥。",
    imgpreview:
      "多图叠放预览：拖拽定位、滚轮无极缩放、透明度与层级、边缘吸附对齐；底部缩略图快速选中。",
    whiteboard: "本地手绘白板（Excalidraw）：无限画布，自动存浏览器，可导出 PNG / SVG / .excalidraw。",
    imgkit: "图片压缩、裁剪、水印、拼接。",
    textimg: "文字/Markdown/代码生成分享图。",
    imgtext: "本地 OCR 图片转文字（Tesseract）。",
    units: "长度、质量等常用单位换算。",
    coord: "WGS84 / GCJ-02 / BD-09 等坐标系互转。",
    numbase: "二、八、十、十六进制互转。",
    wheel: "大转盘：自定义分块、比例与文字，旋转抽选并语音播报结果。",
    acupoint: "361 经穴 + 51 奇穴：Wellcome 经络参考图、搜索筛选列表；点条目看定位与主治（无需点图取穴）。",
    adb: "网页侧 ADB 调试辅助：设备、文件、输入、安装、命令大全等。",
    lanshare: "局域网互传：多机同房间共享文件列表，下载时从上传者手机 WebRTC 直传，不经房主中转；房主可退出或解散，退出时最近加入者接任。",
    ffbridge: "电脑批量用本机 FFmpeg 桥；手机请直接用媒体里的音频/修剪/GIF（网页内处理）。",
    about: "站点总览与能力目录；可分享/复制链接给他人，并进入主题设置。",
    setup: "小白向：如何下载安装 Node.js、ADB、FFmpeg；手机用网页保底、电脑用桥更优。",
  };
  const TOOL_META = {
    timestamp: { name: "时间戳", aliases: ["时间", "timestamp", "date"] },
    timediff: { name: "时间差", aliases: ["时差", "diff time"] },
    cron: { name: "Cron", aliases: ["定时", "crontab"] },
    ahex: { name: "AHEX", aliases: ["颜色", "alpha"] },
    color: { name: "颜色互转", aliases: ["rgb", "hex", "hsl"] },
    eyedropper: { name: "屏幕取色", aliases: ["取色", "eyedropper"] },
    password: { name: "密码生成", aliases: ["password", "随机密码"] },
    base64: { name: "Base64", aliases: ["编码", "b64"] },
    imgb64: { name: "图片 Base64", aliases: ["图片编码"] },
    url: { name: "URL", aliases: ["encode", "decode"] },
    hash: { name: "Hash", aliases: ["md5", "sha"] },
    uuid: { name: "UUID", aliases: ["guid"] },
    json: { name: "JSON", aliases: ["格式化", "压缩"] },
    yaml: { name: "YAML", aliases: ["yml"] },
    sharecard: { name: "代码卡片", aliases: ["分享", "卡片"] },
    query: { name: "Query / JWT", aliases: ["jwt", "token", "query"] },
    text: { name: "文本", aliases: ["统计", "去重"] },
    caseconv: { name: "命名转换", aliases: ["驼峰", "snake", "case"] },
    regex: { name: "正则", aliases: ["regexp", "正则表达式"] },
    diff: { name: "文本比对", aliases: ["对比", "差异", "diff", "compare", "比对"] },
    qrcode: { name: "二维码", aliases: ["qr", "扫码"] },
    gifmaker: { name: "GIF / 动图", aliases: ["gif", "动图", "webp", "ffmpeg"] },
    vsplit: { name: "视频切分", aliases: ["切分", "vsplit", "视频"] },
    vbb: { name: "黑盒 GIF", aliases: ["黑盒", "vbb", "批量切分", "blackbox", "6mb"] },
    vtrim: { name: "视频修剪", aliases: ["修剪", "裁剪", "vtrim"] },
    vplay: { name: "视频播放", aliases: ["播放", "预览", "vplay", "player"] },
    audio: { name: "音频处理", aliases: ["音频", "音量", "抽音轨", "audio"] },
    imgpreview: {
      name: "图片预览",
      aliases: ["多图", "叠图", "对比", "preview", "图层", "imgpreview"],
    },
    whiteboard: { name: "画板", aliases: ["白板", "涂鸦", "手绘", "excalidraw", "whiteboard", "sketch"] },
    imgkit: { name: "图片工具", aliases: ["裁剪", "压缩", "水印", "拼接"] },
    textimg: { name: "文字转图片", aliases: ["文转图", "海报", "卡片", "carbon", "text to image"] },
    imgtext: { name: "图片转文字", aliases: ["ocr", "识字", "图转文", "tesseract"] },
    units: { name: "单位换算", aliases: ["长度", "质量"] },
    coord: { name: "坐标系互转", aliases: ["gps", "坐标", "gcj", "wgs"] },
    acupoint: { name: "穴位图", aliases: ["穴位", "经络", "针灸", "acupoint", "361", "奇穴"] },
    numbase: { name: "进制转换", aliases: ["二进制", "十六进制"] },
    markdown: { name: "Markdown", aliases: ["md", "预览"] },
    memo: { name: "备忘录", aliases: ["笔记", "剪贴板", "memo", "note", "便签"] },
    adb: { name: "ADB 工具", aliases: ["安卓", "android", "设备", "adb"], desktopOnly: true },
    lanshare: { name: "局域网互传", aliases: ["互传", "传文件", "lan", "share", "webrtc", "局域网"] },
    ffbridge: {
      name: "FFmpeg 本机桥",
      aliases: ["本机桥", "ffbridge", "批量转码"],
      desktopOnly: true,
    },
    about: { name: "实用小工具合集", aliases: ["about", "介绍", "目录", "主题", "帮助", "总览", "关于"] },
    setup: {
      name: "安装本机工具",
      aliases: ["帮助", "安装", "nodejs", "node", "adb", "ffmpeg", "配置", "小白", "setup", "教程"],
    },
  };
  const DEFAULT_ORDER = TOOL_GROUPS.flatMap((g) => g.tools);

  const navEl = $("#tool-nav") || $(".tool-nav");
  const navBar = $("#nav-bar") || $(".nav-bar");
  const navBackdrop = $("#nav-backdrop");
  const navOpenBtn = $("#nav-open");
  const navCloseBtn = $("#nav-close");
  const chromeToggleBtn = $("#site-chrome-toggle");
  const chromeToggleFloat = $("#site-chrome-toggle-float");
  const workspaceSwitch = $("#workspace-switch");
  const workspaceTitle = $("#workspace-title");
  const mediaSubnav = $("#media-subnav");
  const toolSearch = $("#tool-search");
  const recentWrap = $("#tool-recent");
  const recentList = $("#tool-recent-list");
  const favoritesWrap = $("#tool-favorites");
  const favoritesList = $("#tool-fav-list");
  const navToolCtx = $("#nav-tool-ctx");
  let navToolCtxId = "";
  const favAddBtn = $("#tool-fav-add");
  const favPicker = $("#tool-fav-picker");
  const canDesktopDrag = () => window.matchMedia("(min-width: 901px)").matches;

  /** 手机/平板不适合本机桥与 ADB，导航中隐藏，避免误入 */
  function isPhoneLikeClient() {
    const ua = navigator.userAgent || "";
    if (/Android|iPhone|iPod|Mobile/i.test(ua)) return true;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const narrow = window.matchMedia("(max-width: 900px)").matches;
    if (/iPad|tablet/i.test(ua) || (coarse && narrow && !/Windows|Macintosh|Linux/i.test(ua))) return true;
    if (/Macintosh/i.test(ua) && coarse && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1) {
      return true;
    }
    return false;
  }

  function isNavToolVisible(id) {
    const meta = TOOL_META[id];
    if (meta?.desktopOnly && isPhoneLikeClient()) return false;
    return true;
  }

  let currentTool = "timestamp";
  let currentMediaTab = "gifmaker";
  let lastFocusBeforeDrawer = null;
  let drawerFocusTimer = 0;
  let drawerIgnoreOpenUntil = 0;

  function isMobileDrawer() {
    return !canDesktopDrag();
  }

  function toolName(id) {
    return TOOL_META[id]?.name || id;
  }

  function sanitizeToolIds(raw) {
    const seen = new Set();
    const out = [];
    (Array.isArray(raw) ? raw : []).forEach((id) => {
      const expanded = id === "media" ? MEDIA_TABS.slice() : [id];
      expanded.forEach((next) => {
        if (!DEFAULT_ORDER.includes(next) || seen.has(next)) return;
        seen.add(next);
        out.push(next);
      });
    });
    return out;
  }

  function normalizeOrder(raw) {
    const out = sanitizeToolIds(raw);
    const seen = new Set(out);
    DEFAULT_ORDER.forEach((id) => {
      if (seen.has(id)) return;
      seen.add(id);
      out.push(id);
    });
    return out;
  }

  function loadOrder() {
    try {
      const raw = localStorage.getItem(ORDER_KEY) || localStorage.getItem("devtools-tool-order-v2");
      if (!raw) return DEFAULT_ORDER.slice();
      return normalizeOrder(JSON.parse(raw));
    } catch (_) {
      return DEFAULT_ORDER.slice();
    }
  }

  function saveOrder(order) {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  }

  function normalizeGroupOrder(raw) {
    const out = [];
    const seen = new Set();
    (Array.isArray(raw) ? raw : []).forEach((id) => {
      if (!GROUP_BY_ID[id] || seen.has(id)) return;
      seen.add(id);
      out.push(id);
    });
    DEFAULT_GROUP_ORDER.forEach((id) => {
      if (seen.has(id)) return;
      seen.add(id);
      out.push(id);
    });
    return out;
  }

  function loadGroupOrder() {
    try {
      const raw = localStorage.getItem(GROUP_ORDER_KEY);
      if (!raw) return DEFAULT_GROUP_ORDER.slice();
      return normalizeGroupOrder(JSON.parse(raw));
    } catch (_) {
      return DEFAULT_GROUP_ORDER.slice();
    }
  }

  function saveGroupOrder(order) {
    localStorage.setItem(GROUP_ORDER_KEY, JSON.stringify(normalizeGroupOrder(order)));
  }

  function groupsInOrder() {
    return loadGroupOrder()
      .map((id) => GROUP_BY_ID[id])
      .filter(Boolean);
  }

  const NAV_COMPACT_KEY = "devtools-nav-compact-v1";
  let navCompact = false;
  try {
    navCompact = localStorage.getItem(NAV_COMPACT_KEY) === "1";
  } catch (_) {
    navCompact = false;
  }

  function currentNavToolId() {
    return currentTool === "media" ? currentMediaTab : currentTool;
  }

  let navFlyoutTimer = 0;

  function compactNavSearching() {
    return Boolean(String(toolSearch?.value || "").trim());
  }

  function compactNavOnMobile() {
    try {
      return window.matchMedia("(max-width: 900px)").matches;
    } catch (_) {
      return false;
    }
  }

  function canHoverNavFlyout(e) {
    if (!navCompact || compactNavSearching()) return false;
    if (
      document.body.classList.contains("nav-sorting") ||
      document.body.classList.contains("nav-sorting-tools") ||
      document.body.classList.contains("nav-sorting-favorites")
    ) {
      return false;
    }
    if (e?.pointerType && e.pointerType !== "mouse") return false;
    try {
      if (window.matchMedia && !window.matchMedia("(hover: hover) and (pointer: fine)").matches) return false;
    } catch (_) {}
    return true;
  }

  function positionNavFlyout(wrap) {
    const panel = wrap?.querySelector?.(".nav-group-tools");
    const title = wrap?.querySelector?.(".nav-group-title");
    if (!panel || !title || !navCompact || compactNavSearching()) return;
    if (compactNavOnMobile()) {
      wrap.classList.remove("is-flyout-up");
      panel.style.maxHeight = "";
      panel.style.width = "";
      panel.style.left = "";
      panel.style.top = "";
      panel.style.bottom = "";
      return;
    }
    const scroller = navEl;
    const scrollerRect = scroller.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const gap = 8;
    const spaceBelow = scrollerRect.bottom - titleRect.bottom - gap;
    const spaceAbove = titleRect.top - scrollerRect.top - gap;
    const openUp = spaceBelow < 132 && spaceAbove > spaceBelow;
    wrap.classList.toggle("is-flyout-up", openUp);
    panel.style.maxHeight = `${Math.round(Math.min(280, Math.max(96, openUp ? spaceAbove : spaceBelow)))}px`;
    panel.style.width = "";
    panel.style.left = "";
    panel.style.top = "";
    panel.style.bottom = "";
  }

  function closeNavFlyouts({ keepPinned = false } = {}) {
    window.clearTimeout(navFlyoutTimer);
    navFlyoutTimer = 0;
    if (!navEl) return;
    $$(".nav-group", navEl).forEach((g) => {
      g.classList.remove("is-flyout-open", "is-flyout-up");
      if (!keepPinned) g.classList.remove("is-pinned");
      g.querySelector(".nav-group-title")?.setAttribute("aria-expanded", "false");
    });
  }

  function openNavFlyout(wrap, { pin = false } = {}) {
    if (!wrap || !navCompact || compactNavSearching()) return;
    window.clearTimeout(navFlyoutTimer);
    navFlyoutTimer = 0;
    $$(".nav-group", navEl).forEach((g) => {
      if (g === wrap) return;
      g.classList.remove("is-flyout-open", "is-flyout-up", "is-pinned");
      g.querySelector(".nav-group-title")?.setAttribute("aria-expanded", "false");
    });
    if (pin) wrap.classList.add("is-pinned");
    wrap.classList.add("is-flyout-open");
    wrap.querySelector(".nav-group-title")?.setAttribute("aria-expanded", "true");
    positionNavFlyout(wrap);
  }

  function scheduleCloseNavFlyout(wrap) {
    if (document.body.classList.contains("nav-sorting-tools")) return;
    window.clearTimeout(navFlyoutTimer);
    navFlyoutTimer = window.setTimeout(() => {
      navFlyoutTimer = 0;
      if (!wrap || wrap.classList.contains("is-pinned")) return;
      if (document.body.classList.contains("nav-sorting-tools")) return;
      wrap.classList.remove("is-flyout-open");
      wrap.querySelector(".nav-group-title")?.setAttribute("aria-expanded", "false");
    }, 200);
  }

  function isNavToolSorting() {
    return document.body.classList.contains("nav-sorting-tools") || dragPayload?.kind === "tool";
  }

  function clearSortFlyouts() {
    if (!navEl) return;
    $$(".nav-group.is-sort-flyout", navEl).forEach((g) => {
      g.classList.remove("is-sort-flyout");
      if (!g.classList.contains("is-pinned")) {
        g.classList.remove("is-flyout-open", "is-flyout-up");
        g.querySelector(".nav-group-title")?.setAttribute("aria-expanded", "false");
      }
    });
  }

  function beginNavToolSort(wrap) {
    document.body.classList.add("nav-sorting-tools");
    window.clearTimeout(navFlyoutTimer);
    navFlyoutTimer = 0;
    if (wrap && navCompact && !compactNavSearching()) {
      wrap.classList.add("is-flyout-open", "is-sort-flyout");
      wrap.querySelector(".nav-group-title")?.setAttribute("aria-expanded", "true");
      positionNavFlyout(wrap);
    }
  }

  function endNavToolSort() {
    document.body.classList.remove("nav-sorting-tools");
    clearSortFlyouts();
  }

  function peekNavFlyoutForSort(wrap) {
    if (!wrap || !navCompact || compactNavSearching()) return;
    if (!document.body.classList.contains("nav-sorting-tools")) return;
    window.clearTimeout(navFlyoutTimer);
    wrap.classList.add("is-flyout-open", "is-sort-flyout");
    wrap.querySelector(".nav-group-title")?.setAttribute("aria-expanded", "true");
    positionNavFlyout(wrap);
  }

  function syncNavCompactUi() {
    if (!navBar) return;
    navBar.classList.toggle("is-compact", navCompact);
    const searching = compactNavSearching();
    navBar.classList.toggle("is-searching", searching);
    const compactToggle = $("#nav-compact");
    if (compactToggle) compactToggle.checked = navCompact;
    if (!navEl) return;
    if (!navCompact || searching) closeNavFlyouts();
    const currentId = currentNavToolId();
    $$(".nav-group", navEl).forEach((g) => {
      const ids = [...g.querySelectorAll(".tool-nav-link")].map((a) => a.dataset.tool);
      const isCurrent = ids.includes(currentId);
      g.classList.toggle("is-current", isCurrent);
      const title = g.querySelector(".nav-group-title");
      if (title) {
        const open = g.classList.contains("is-pinned") || g.classList.contains("is-flyout-open");
        title.setAttribute("aria-expanded", navCompact && !searching ? (open ? "true" : "false") : "true");
      }
    });
  }

  function setNavCompact(on) {
    navCompact = Boolean(on);
    try {
      localStorage.setItem(NAV_COMPACT_KEY, navCompact ? "1" : "0");
    } catch (_) {}
    if (navEl) $$(".nav-group", navEl).forEach((g) => g.classList.remove("is-pinned"));
    syncNavCompactUi();
  }

  function moveGroupOrder(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return loadGroupOrder();
    const order = loadGroupOrder();
    const fromIdx = order.indexOf(fromId);
    const toIdx = order.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return order;
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, fromId);
    return order;
  }

  function loadFavorites() {
    try {
      return sanitizeToolIds(JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]"));
    } catch (_) {
      return [];
    }
  }

  function saveFavorites(ids) {
    localStorage.setItem(FAVORITES_KEY, JSON.stringify(sanitizeToolIds(ids)));
    renderFavorites();
  }

  function addFavorite(id) {
    if (!DEFAULT_ORDER.includes(id) || !isNavToolVisible(id)) return false;
    const next = loadFavorites().filter((x) => x !== id);
    next.push(id);
    saveFavorites(next);
    showToast(`已加入常用：${toolName(id)}`);
    return true;
  }

  function removeFavorite(id) {
    const next = loadFavorites().filter((x) => x !== id);
    saveFavorites(next);
    showToast(`已从常用移除：${toolName(id)}`);
  }

  function hideNavToolCtx() {
    if (!navToolCtx) return;
    navToolCtx.hidden = true;
    navToolCtxId = "";
  }

  function showNavToolCtx(x, y, toolId) {
    if (!navToolCtx || !toolId || !DEFAULT_ORDER.includes(toolId)) return;
    if (navToolCtx.parentElement !== document.body) document.body.appendChild(navToolCtx);
    navToolCtxId = toolId;
    const inFav = loadFavorites().includes(toolId);
    const addBtn = navToolCtx.querySelector('[data-nav-ctx="fav-add"]');
    const remBtn = navToolCtx.querySelector('[data-nav-ctx="fav-remove"]');
    if (addBtn) addBtn.hidden = inFav;
    if (remBtn) remBtn.hidden = !inFav;
    navToolCtx.hidden = false;
    navToolCtx.style.left = `${x}px`;
    navToolCtx.style.top = `${y}px`;
    requestAnimationFrame(() => {
      const pad = 8;
      const rect = navToolCtx.getBoundingClientRect();
      let left = x;
      let top = y;
      if (rect.right > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - rect.width - pad);
      if (rect.left < pad) left = pad;
      if (rect.bottom > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - rect.height - pad);
      if (rect.top < pad) top = pad;
      navToolCtx.style.left = `${left}px`;
      navToolCtx.style.top = `${top}px`;
    });
  }

  function bindNavToolCtx() {
    if (!navToolCtx || navToolCtx.dataset.bound === "1") return;
    if (navToolCtx.parentElement !== document.body) document.body.appendChild(navToolCtx);
    navToolCtx.dataset.bound = "1";
    navToolCtx.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-nav-ctx]");
      if (!btn || !navToolCtxId) return;
      e.preventDefault();
      e.stopPropagation();
      const action = btn.dataset.navCtx;
      const id = navToolCtxId;
      hideNavToolCtx();
      if (action === "fav-add") addFavorite(id);
      else if (action === "fav-remove") removeFavorite(id);
      else if (action === "open") navigateTo(id);
    });
    document.addEventListener(
      "click",
      (e) => {
        if (navToolCtx?.hidden) return;
        if (e.target.closest("#nav-tool-ctx")) return;
        hideNavToolCtx();
      },
      true
    );
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") hideNavToolCtx();
    });
    window.addEventListener("scroll", hideNavToolCtx, true);
    window.addEventListener("resize", hideNavToolCtx);
  }

  function loadRecent() {
    try {
      const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      const cleaned = sanitizeToolIds(parsed);
      // 曾误把默认排序整表写入「最近」：若与默认前缀完全一致则清空
      const defPrefix = DEFAULT_ORDER.slice(0, cleaned.length);
      if (cleaned.length >= 6 && cleaned.every((id, i) => id === defPrefix[i])) {
        localStorage.removeItem(RECENT_KEY);
        return [];
      }
      return cleaned;
    } catch (_) {
      return [];
    }
  }

  function saveLastTool(id) {
    if (!DEFAULT_ORDER.includes(id) || SITE_NAV_IDS.has(id)) return;
    if (!isNavToolVisible(id)) return;
    try {
      localStorage.setItem(LAST_TOOL_KEY, id);
    } catch (_) {}
    try {
      sessionStorage.setItem(LAST_TOOL_SESSION_KEY, id);
    } catch (_) {}
  }

  function loadLastToolId() {
    try {
      let saved = localStorage.getItem(LAST_TOOL_KEY);
      if (!saved) {
        try {
          saved = sessionStorage.getItem(LAST_TOOL_SESSION_KEY);
        } catch (_) {}
      }
      if (saved && DEFAULT_ORDER.includes(saved) && !SITE_NAV_IDS.has(saved) && isNavToolVisible(saved)) {
        return saved;
      }
    } catch (_) {}
    return loadRecent().find((id) => !SITE_NAV_IDS.has(id) && isNavToolVisible(id)) || null;
  }

  function toolIdToHash(id) {
    if (!id) return "#timestamp";
    if (MEDIA_TABS.includes(id)) return `#media/${id}`;
    return `#${id}`;
  }

  function pushRecent(id) {
    if (!DEFAULT_ORDER.includes(id)) return;
    const next = [id, ...loadRecent().filter((x) => x !== id)];
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    saveLastTool(id);
    renderRecent();
  }

  function lastToolHash() {
    return toolIdToHash(loadLastToolId());
  }

  function routeFromToolId(id) {
    if (!id) return { tool: "timestamp", tab: "gifmaker" };
    if (HASH_ALIASES[id]) return { ...HASH_ALIASES[id] };
    if (MEDIA_TABS.includes(id)) return { tool: "media", tab: id };
    if (DEFAULT_ORDER.includes(id)) return { tool: id, tab: "gifmaker" };
    return { tool: "timestamp", tab: "gifmaker" };
  }

  function activeToolIdFromRoute(route) {
    if (!route) return "timestamp";
    return route.tool === "media" ? route.tab || "gifmaker" : route.tool;
  }

  function navToolIdForSave(tool, tab, nextTool, nextTab) {
    if (nextTool === "media") return nextTab || tab || currentMediaTab || "gifmaker";
    return nextTool || tool;
  }

  function persistActiveTool(route) {
    const id = activeToolIdFromRoute(route || { tool: currentTool, tab: currentMediaTab });
    if (!id) return;
    saveLastTool(id);
  }

  /** applyRoute 用：空 hash / 裸 #media 视为占位，不含 #timestamp（用户可显式打开时间戳） */
  function shouldRestoreLastTool() {
    const raw0 = String(location.hash || "").replace(/^#/, "").trim();
    if (!raw0 || raw0 === "/") return true;
    const q = raw0.indexOf("?");
    const path = q >= 0 ? raw0.slice(0, q) : raw0;
    if (q >= 0 && path === "lanshare") return false;
    if (!path || path === "/") return true;
    const head = path.split(/[/?]/).filter(Boolean)[0] || "";
    if (!head) return true;
    if (head === "media" && !path.includes("/")) return true;
    return false;
  }

  /** 冷启动占位 hash（含 iOS 常见的 #timestamp），仅 boot 时恢复上次工具 */
  function isStartupPlaceholderHash() {
    const raw0 = String(location.hash || "").replace(/^#/, "").trim();
    if (!raw0 || raw0 === "/") return true;
    const q = raw0.indexOf("?");
    const path = q >= 0 ? raw0.slice(0, q) : raw0;
    if (q >= 0 && path === "lanshare") return false;
    if (!path || path === "/") return true;
    const head = path.split(/[/?]/).filter(Boolean)[0] || "";
    if (!head) return true;
    if (head === "timestamp") return true;
    if (head === "media" && !path.includes("/")) return true;
    return false;
  }

  function restoreLastToolOnStartup() {
    if (!isStartupPlaceholderHash()) return false;
    const saved = loadLastToolId();
    if (!saved || saved === "timestamp") return false;
    const route = routeFromToolId(saved);
    const target = routeHash(route.tool, route.tab);
    const raw = String(location.hash || "").replace(/^#/, "").trim();
    const q = raw.indexOf("?");
    const path = q >= 0 ? raw.slice(0, q) : raw;
    if (`#${path}` !== target) history.replaceState(null, "", target);
    return true;
  }

  function bootRoute() {
    restoreLastToolOnStartup();
    applyRoute({ skipRecent: bootPasses > 0 });
    forceDrawerClosed();
    bootPasses += 1;
  }

  function rawHashHead() {
    const raw0 = String(location.hash || "").replace(/^#/, "").trim();
    const q = raw0.indexOf("?");
    const path = q >= 0 ? raw0.slice(0, q) : raw0;
    return path.split(/[/?]/).filter(Boolean)[0] || "";
  }

  function syncSortHint() {
    const el = document.querySelector(".nav-sort-hint");
    if (!el) return false;
    let seen = false;
    try {
      seen = localStorage.getItem(SORT_HINT_KEY) === "1";
    } catch (_) {
      seen = false;
    }
    if (seen) {
      el.hidden = true;
      return false;
    }
    el.hidden = false;
    try {
      localStorage.setItem(SORT_HINT_KEY, "1");
    } catch (_) {}
    return true;
  }

  function getNavLinks() {
    return $$(".tool-nav-link", navEl);
  }

  function renderNav(order) {
    if (!navEl) return;
    const list = order || loadOrder();
    const allowHtml5Drag = canDesktopDrag();
    navEl.innerHTML = "";
    groupsInOrder().forEach((group) => {
      const tools = list.filter((id) => group.tools.includes(id));
      if (!tools.length) return;
      const wrap = document.createElement("div");
      wrap.className = "nav-group";
      wrap.dataset.group = group.id;
      const title = document.createElement("p");
      title.className = "nav-group-title is-sortable";
      title.textContent = group.label;
      title.setAttribute("aria-expanded", "true");
      title.draggable = allowHtml5Drag;
      title.title = allowHtml5Drag
        ? "拖动分类可调整整组顺序"
        : "长按分类标题后拖动，可调整整组顺序";
      wrap.appendChild(title);
      const toolsWrap = document.createElement("div");
      toolsWrap.className = "nav-group-tools";
      tools.forEach((id) => {
        if (!isNavToolVisible(id)) return;
        const a = document.createElement("a");
        a.className = "tool-nav-link";
        a.href = MEDIA_TABS.includes(id) ? `#media/${id}` : `#${id}`;
        a.dataset.tool = id;
        a.draggable = allowHtml5Drag;
        a.title = allowHtml5Drag ? "拖动可调整工具顺序" : "长按工具名后拖动，可调整顺序";
        a.textContent = toolName(id);
        toolsWrap.appendChild(a);
      });
      wrap.appendChild(toolsWrap);
      if (![...wrap.querySelectorAll(".tool-nav-link")].length) return;
      navEl.appendChild(wrap);
    });
    bindNavInteractions();
    applySearchFilter(toolSearch?.value || "");
    syncNavCompactUi();
  }

  function bindNavStripWheelScroll(el) {
    if (!el || el.dataset.wheelBound === "1") return;
    el.dataset.wheelBound = "1";
    el.addEventListener(
      "wheel",
      (e) => {
        if (el.scrollWidth <= el.clientWidth + 1) return;
        const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
        if (!delta) return;
        el.scrollLeft += delta;
        e.preventDefault();
        e.stopPropagation();
      },
      { passive: false }
    );
  }

  function renderRecent() {
    if (!recentWrap || !recentList) return;
    const items = loadRecent();
    recentList.innerHTML = "";
    if (!items.length) {
      recentWrap.hidden = true;
      return;
    }
    recentWrap.hidden = false;
    items.forEach((id) => {
      if (!isNavToolVisible(id)) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nav-recent-chip";
      btn.textContent = toolName(id);
      btn.addEventListener("click", () => navigateTo(id));
      btn.addEventListener("contextmenu", (e) => {
        if (!canDesktopDrag()) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        hideNavToolCtx();
        showNavToolCtx(e.clientX, e.clientY, id);
      });
      recentList.appendChild(btn);
    });
    if (!recentList.children.length) {
      recentWrap.hidden = true;
    }
  }

  let favPickerOpen = false;

  function setFavPickerOpen(open) {
    favPickerOpen = !!open;
    if (favAddBtn) favAddBtn.setAttribute("aria-expanded", favPickerOpen ? "true" : "false");
    if (favPicker) {
      if (favPickerOpen) {
        favPicker.removeAttribute("hidden");
        renderFavPicker();
      } else favPicker.setAttribute("hidden", "");
    }
  }

  function renderFavPicker() {
    if (!favPicker) return;
    favPicker.innerHTML = "";
    const current = new Set(loadFavorites());
    const candidates = DEFAULT_ORDER.filter((id) => isNavToolVisible(id) && !current.has(id));
    if (!candidates.length) {
      const empty = document.createElement("p");
      empty.className = "nav-fav-picker-empty";
      empty.textContent = current.size ? "可添加的工具已全部加入常用" : "暂无可添加的工具";
      favPicker.appendChild(empty);
      return;
    }
    candidates.forEach((id) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nav-fav-picker-item";
      btn.textContent = toolName(id);
      btn.addEventListener("click", () => {
        addFavorite(id);
        renderFavPicker();
      });
      favPicker.appendChild(btn);
    });
  }

  function renderFavorites() {
    if (!favoritesList) return;
    const items = loadFavorites();
    const allowHtml5Drag = canDesktopDrag();
    favoritesList.innerHTML = "";
    items.forEach((id) => {
      if (!isNavToolVisible(id)) return;
      const link = document.createElement("a");
      link.className = "tool-nav-link nav-fav-link is-sortable";
      link.href = MEDIA_TABS.includes(id) ? `#media/${id}` : `#${id}`;
      link.dataset.tool = id;
      link.draggable = allowHtml5Drag;
      link.title = allowHtml5Drag ? "拖动排序；右键更多操作" : "长按拖动排序；右键更多操作";
      link.textContent = toolName(id);
      link.setAttribute("role", "listitem");
      favoritesList.appendChild(link);
    });
    bindFavoriteInteractions();
    if (favPickerOpen) renderFavPicker();
  }

  function commitFavoriteReorder(fromId, toId, { keepDrawer = true } = {}) {
    if (!fromId || !toId || fromId === toId) return false;
    const list = loadFavorites();
    const fromIdx = list.indexOf(fromId);
    const toIdx = list.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return false;
    list.splice(fromIdx, 1);
    list.splice(toIdx, 0, fromId);
    saveFavorites(list);
    applyRoute({ skipRecent: true, keepDrawer });
    showToast("已保存常用排序");
    return true;
  }

  function bindFavoriteInteractions() {
    if (!favoritesList) return;
    $$(".nav-fav-link", favoritesList).forEach((link) => {
      if (link.dataset.boundFav === "1") return;
      link.dataset.boundFav = "1";
      link.addEventListener("dragstart", (e) => {
        if (!link.draggable) {
          e.preventDefault();
          return;
        }
        dragPayload = { kind: "favorite", id: link.dataset.tool };
        didDrag = true;
        link.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/x-devtools-nav", JSON.stringify(dragPayload));
        e.dataTransfer.setData("text/plain", dragPayload.id);
      });
      link.addEventListener("dragend", () => {
        clearNavDragStyles();
        dragPayload = null;
        setTimeout(() => {
          didDrag = false;
        }, 0);
      });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        if (didDrag) return;
        navigateTo(link.dataset.tool);
      });
      link.addEventListener("dragover", (e) => {
        if (!canDesktopDrag()) return;
        const payload = dragPayload || readDragPayload(e);
        if (!payload || payload.kind !== "favorite") return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        link.classList.add("drag-over");
      });
      link.addEventListener("dragleave", () => link.classList.remove("drag-over"));
      link.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearNavDragStyles();
        if (!canDesktopDrag()) return;
        const payload = readDragPayload(e);
        const toTool = link.dataset.tool;
        if (!payload || payload.kind !== "favorite" || !toTool) return;
        commitFavoriteReorder(payload.id, toTool, { keepDrawer: false });
      });
      link.addEventListener("pointerdown", (e) => {
        beginMobilePointerSort(e, {
          kind: "favorite",
          id: link.dataset.tool,
          handle: link,
          wrap: favoritesList,
        });
      });
      link.addEventListener("contextmenu", (e) => {
        if (!canDesktopDrag()) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        hideNavToolCtx();
        showNavToolCtx(e.clientX, e.clientY, link.dataset.tool);
      });
    });
  }

  function drawerFocusables() {
    if (!navBar) return [];
    return [...navBar.querySelectorAll("a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])")].filter(
      (el) => !el.hasAttribute("hidden") && el.getAttribute("aria-hidden") !== "true"
    );
  }

  function setDrawerOpen(open) {
    const wantOpen = !!open && isMobileDrawer();
    if (!wantOpen) {
      // 部分手机在关闭时若立刻 focus「工具」按钮，会再次合成 click 把抽屉打开
      drawerIgnoreOpenUntil = Date.now() + 450;
      window.clearTimeout(drawerFocusTimer);
    }
    document.body.classList.toggle("nav-open", wantOpen);
    document.body.classList.toggle("nav-drawer-open", wantOpen);
    if (navOpenBtn) navOpenBtn.setAttribute("aria-expanded", wantOpen ? "true" : "false");
    if (navBackdrop) {
      if (wantOpen) navBackdrop.removeAttribute("hidden");
      else navBackdrop.setAttribute("hidden", "");
    }
    if (navBar) {
      const showForA11y = wantOpen || !isMobileDrawer();
      navBar.setAttribute("aria-hidden", showForA11y ? "false" : "true");
      if ("inert" in navBar) navBar.inert = isMobileDrawer() && !wantOpen;
      // Safari 后台恢复后 transform 可能卡住：关抽屉时清掉内联残留
      if (!wantOpen) {
        navBar.style.removeProperty("transform");
        navBar.style.removeProperty("visibility");
      }
      if (wantOpen && isMobileDrawer()) {
        navBar.setAttribute("role", "dialog");
        navBar.setAttribute("aria-modal", "true");
        navBar.setAttribute("aria-labelledby", "nav-drawer-title");
      } else {
        navBar.setAttribute("role", "navigation");
        navBar.removeAttribute("aria-modal");
        navBar.removeAttribute("aria-labelledby");
      }
    }
    if (wantOpen) {
      lastFocusBeforeDrawer = document.activeElement;
      window.clearTimeout(drawerFocusTimer);
      drawerFocusTimer = window.setTimeout(() => {
        try {
          (toolSearch || navCloseBtn || drawerFocusables()[0])?.focus?.({ preventScroll: true });
        } catch (_) {}
      }, 50);
      window.DevToolsTemp?.refresh?.();
      return;
    }

    navCloseBtn?.blur?.();
    const restore = lastFocusBeforeDrawer;
    lastFocusBeforeDrawer = null;
    const openerBtns = new Set([navOpenBtn, workspaceSwitch].filter(Boolean));
    // 不要把焦点立刻还回「工具/切换工具」，避免移动端二次点击重开
    if (restore && !openerBtns.has(restore) && typeof restore.focus === "function") {
      window.setTimeout(() => {
        try {
          restore.focus({ preventScroll: true });
        } catch (_) {}
      }, 0);
    } else if (workspaceTitle) {
      workspaceTitle.setAttribute("tabindex", "-1");
      window.setTimeout(() => {
        try {
          workspaceTitle.focus({ preventScroll: true });
        } catch (_) {}
      }, 0);
    }
  }

  /** 默认/恢复时强制关闭（Safari bfcache、后台回收后再开） */
  function forceDrawerClosed() {
    window.clearTimeout(drawerFocusTimer);
    document.body.classList.remove("nav-open", "nav-drawer-open");
    if (navOpenBtn) navOpenBtn.setAttribute("aria-expanded", "false");
    if (navBackdrop) navBackdrop.setAttribute("hidden", "");
    if (navBar) {
      navBar.style.removeProperty("transform");
      navBar.style.removeProperty("visibility");
      if ("inert" in navBar) navBar.inert = isMobileDrawer();
      navBar.setAttribute("aria-hidden", isMobileDrawer() ? "true" : "false");
      navBar.setAttribute("role", "navigation");
      navBar.removeAttribute("aria-modal");
      navBar.removeAttribute("aria-labelledby");
      // 触发一次重绘，避免 Safari 合成层残留
      void navBar.offsetWidth;
    }
    lastFocusBeforeDrawer = null;
  }

  function parseRoute() {
    let raw = String(location.hash || "").replace(/^#/, "").trim();
    const q = raw.indexOf("?");
    if (q >= 0) raw = raw.slice(0, q);
    if (!raw) return { tool: "timestamp", tab: "gifmaker" };
    const parts = raw.split(/[/?]/).filter(Boolean);
    const head = parts[0] || "timestamp";
    if (HASH_ALIASES[head]) return { ...HASH_ALIASES[head] };
    if (head === "media") {
      if (parts[1] === "vbb") return { tool: "vbb", tab: "gifmaker" };
      const tab = MEDIA_TABS.includes(parts[1]) ? parts[1] : "gifmaker";
      return { tool: "media", tab };
    }
    if (DEFAULT_ORDER.includes(head)) return { tool: head, tab: "gifmaker" };
    return { tool: "timestamp", tab: "gifmaker" };
  }

  function routeHash(tool, tab) {
    if (tool === "media") return `#media/${tab || "gifmaker"}`;
    return `#${tool}`;
  }

  function applyRoute({ skipRecent, keepDrawer } = {}) {
    let route = parseRoute();
    if (shouldRestoreLastTool()) {
      const saved = loadLastToolId();
      if (saved && saved !== "timestamp") {
        route = routeFromToolId(saved);
        const target = routeHash(route.tool, route.tab);
        const raw = String(location.hash || "").replace(/^#/, "").trim();
        const q = raw.indexOf("?");
        const path = q >= 0 ? raw.slice(0, q) : raw;
        if (`#${path}` !== target) history.replaceState(null, "", target);
      }
    }
    // 手机深链 #ffbridge / #adb → 网页媒体，避免无用桥页面
    if (isPhoneLikeClient() && (route.tool === "ffbridge" || route.tool === "adb")) {
      route = { tool: "media", tab: route.tool === "ffbridge" ? "audio" : currentMediaTab || "gifmaker" };
      const canonicalMobile = routeHash(route.tool, route.tab);
      if (`#${String(location.hash || "").replace(/^#/, "")}` !== canonicalMobile) {
        history.replaceState(null, "", canonicalMobile);
      }
    }
    currentTool = route.tool;
    currentMediaTab = route.tab || "gifmaker";

    // 旧深链 #gifmaker / #vsplit → #media/...；#media/vbb / #vbb → #vbb
    const rawHash = String(location.hash || "")
      .replace(/^#/, "")
      .trim();
    const rawHead = rawHash.split(/[/?]/)[0];
    const canonical = routeHash(currentTool, currentMediaTab);
    const preserveLanshareJoin = rawHead === "lanshare" && rawHash.includes("?");
    if (/^media\/vbb\b/i.test(rawHash)) {
      if (rawHash !== "vbb") history.replaceState(null, "", "#vbb");
    } else if (
      !preserveLanshareJoin &&
      (HASH_ALIASES[rawHead] || (rawHead === "media" && !rawHash.includes("/")))
    ) {
      if (rawHash !== canonical.replace(/^#/, "")) {
        history.replaceState(null, "", canonical);
      }
    }

    $$(".tool-panel").forEach((panel) => {
      const id = panel.id;
      let active = false;
      if (currentTool === "media") active = id === currentMediaTab;
      else active = id === currentTool;
      panel.classList.toggle("is-workspace-active", active);
      panel.hidden = !active;
      if (active) panel.removeAttribute("aria-hidden");
      else panel.setAttribute("aria-hidden", "true");
    });

    if (mediaSubnav) {
      const showMedia = currentTool === "media";
      mediaSubnav.hidden = !showMedia;
      $$("[data-media-tab]", mediaSubnav).forEach((btn) => {
        const on = btn.dataset.mediaTab === currentMediaTab;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
        btn.tabIndex = on ? 0 : -1;
      });
    }

    const title =
      currentTool === "about"
        ? "实用小工具合集"
        : currentTool === "media"
          ? toolName(currentMediaTab)
          : toolName(currentTool);
    if (workspaceTitle) workspaceTitle.textContent = title;
    document.title =
      currentTool === "about" ? "DevTools · 本地实用小工具合集" : `${title} · DevTools`;

    getNavLinks().forEach((link) => {
      const on = currentTool === "media" ? link.dataset.tool === currentMediaTab : link.dataset.tool === currentTool;
      link.classList.toggle("is-active", on);
      link.setAttribute("aria-current", on ? "page" : "false");
    });
    $$(".nav-fav-link", favoritesList).forEach((link) => {
      const on = currentTool === "media" ? link.dataset.tool === currentMediaTab : link.dataset.tool === currentTool;
      link.classList.toggle("is-active", on);
      link.setAttribute("aria-current", on ? "page" : "false");
    });
    closeNavFlyouts();
    syncNavCompactUi();

    if (!skipRecent) pushRecent(currentTool === "media" ? currentMediaTab : currentTool);
    persistActiveTool({ tool: currentTool, tab: currentMediaTab });
    // 手机分类拖拽排序后需保持抽屉打开
    if (!keepDrawer) {
      setDrawerOpen(false);
      window.scrollTo(0, 0);
    }
    window.dispatchEvent(
      new CustomEvent("devtools:route", {
        detail: { tool: currentTool, mediaTab: currentMediaTab },
      })
    );
  }

  function navigateTo(tool, tab, { replace = false } = {}) {
    let nextTool = tool;
    let nextTabArg = tab;
    // 侧栏媒体子项 → 统一走 #media/<tab>
    if (MEDIA_TABS.includes(tool)) {
      nextTool = "media";
      nextTabArg = tool;
    }
    // 手机打开本机桥/ADB：引导到网页媒体能力，避免空白桥面板
    if (isPhoneLikeClient() && (tool === "ffbridge" || tool === "adb")) {
      nextTool = "media";
      nextTabArg = tool === "ffbridge" ? "audio" : currentMediaTab || "gifmaker";
    }
    const nextTab = nextTabArg || (nextTool === "media" ? currentMediaTab : null);
    const hash = routeHash(nextTool, nextTab);
    const persistId = navToolIdForSave(tool, tab, nextTool, nextTab);
    if (persistId) saveLastTool(persistId);
    const current = `#${String(location.hash || "").replace(/^#/, "")}`;
    // 媒体内切 Tab 用 replace，避免系统返回在子功能间来回跳
    const mediaTabOnly =
      nextTool === "media" && currentTool === "media" && nextTab && nextTab !== currentMediaTab;
    const shouldReplace =
      replace || mediaTabOnly || (isPhoneLikeClient() && (tool === "ffbridge" || tool === "adb"));
    if (shouldReplace) history.replaceState(null, "", hash);
    else if (current !== hash) history.pushState(null, "", hash);
    applyRoute();
  }

  function applySearchFilter(query) {
    const q = String(query || "").trim().toLowerCase();
    $$(".nav-group", navEl).forEach((group) => {
      let any = false;
      $$(".tool-nav-link", group).forEach((link) => {
        const id = link.dataset.tool;
        const meta = TOOL_META[id] || { name: id, aliases: [] };
        const hay = `${meta.name} ${(meta.aliases || []).join(" ")} ${id}`.toLowerCase();
        const show = !q || hay.includes(q);
        link.classList.toggle("is-filtered-out", !show);
        if (show) any = true;
      });
      group.classList.toggle("is-filtered-out", !any);
    });
    syncNavCompactUi();
  }

  let dragPayload = null;
  let didDrag = false;
  /** 手机侧栏：长按分类标题后的 Pointer 排序状态（HTML5 DnD 在触控上不可靠） */
  let pointerSort = null;
  let pointerSortScrollRaf = 0;

  function clearNavDragStyles() {
    getNavLinks().forEach((l) => l.classList.remove("drag-over", "is-dragging"));
    $$(".nav-group", navEl).forEach((g) => g.classList.remove("drag-over", "is-dragging"));
    $$(".nav-fav-link", favoritesList).forEach((c) => c.classList.remove("drag-over", "is-dragging"));
  }

  function navFavoriteAtPoint(x, y) {
    const stack = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
    for (const el of stack) {
      const link = el?.closest?.(".nav-fav-link");
      if (link && favoritesList?.contains(link)) return link;
    }
    return null;
  }

  function navGroupAtPoint(x, y) {
    const stack = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
    for (const el of stack) {
      const group = el?.closest?.(".nav-group");
      if (group && navEl?.contains(group) && !group.classList.contains("is-filtered-out")) return group;
    }
    return null;
  }

  function stopPointerSortAutoScroll() {
    if (pointerSortScrollRaf) {
      cancelAnimationFrame(pointerSortScrollRaf);
      pointerSortScrollRaf = 0;
    }
    if (pointerSort) {
      pointerSort.scrollDir = 0;
      pointerSort.scrollSpeed = 0;
    }
  }

  function tickPointerSortAutoScroll() {
    pointerSortScrollRaf = 0;
    if (!pointerSort?.active || !navBar) return;
    const dir = pointerSort.scrollDir || 0;
    const speed = pointerSort.scrollSpeed || 0;
    if (!dir || !speed) return;
    navBar.scrollTop += dir * speed;
    // 滚动后按当前手指位置刷新高亮目标
    if (pointerSort.lastX != null && pointerSort.lastY != null) {
      clearNavDragStyles();
      if (pointerSort.kind === "tool") {
        pointerSort.handle?.classList.add("is-dragging");
        const group = navGroupAtPoint(pointerSort.lastX, pointerSort.lastY);
        if (group) peekNavFlyoutForSort(group);
        const target = navToolAtPoint(pointerSort.lastX, pointerSort.lastY);
        if (target && target !== pointerSort.handle) target.classList.add("drag-over");
      } else if (pointerSort.kind === "favorite") {
        pointerSort.handle?.classList.add("is-dragging");
        const target = navFavoriteAtPoint(pointerSort.lastX, pointerSort.lastY);
        if (target && target !== pointerSort.handle) target.classList.add("drag-over");
      } else {
        pointerSort.wrap?.classList.add("is-dragging");
        const target = navGroupAtPoint(pointerSort.lastX, pointerSort.lastY);
        if (target && target !== pointerSort.wrap) target.classList.add("drag-over");
      }
    }
    pointerSortScrollRaf = requestAnimationFrame(tickPointerSortAutoScroll);
  }

  function updatePointerSortAutoScroll(clientY, clientX) {
    if (pointerSort?.kind === "favorite" && favoritesList && clientY != null) {
      const rect = favoritesList.getBoundingClientRect();
      const edge = 40;
      let dir = 0;
      let speed = 0;
      if (clientY < rect.top + edge) {
        dir = -1;
        const t = Math.max(0, Math.min(1, (rect.top + edge - clientY) / edge));
        speed = 6 + t * 18;
      } else if (clientY > rect.bottom - edge) {
        dir = 1;
        const t = Math.max(0, Math.min(1, (clientY - (rect.bottom - edge)) / edge));
        speed = 6 + t * 18;
      }
      if (dir) {
        favoritesList.scrollTop += dir * speed;
        if (pointerSortScrollRaf) cancelAnimationFrame(pointerSortScrollRaf);
        pointerSortScrollRaf = requestAnimationFrame(tickPointerSortAutoScroll);
      }
      return;
    }
    if (!navBar || !pointerSort?.active) {
      stopPointerSortAutoScroll();
      return;
    }
    const rect = navBar.getBoundingClientRect();
    const edge = 64;
    let dir = 0;
    let speed = 0;
    if (clientY < rect.top + edge) {
      dir = -1;
      const t = Math.max(0, Math.min(1, (rect.top + edge - clientY) / edge));
      speed = 8 + t * 22;
    } else if (clientY > rect.bottom - edge) {
      dir = 1;
      const t = Math.max(0, Math.min(1, (clientY - (rect.bottom - edge)) / edge));
      speed = 8 + t * 22;
    }
    pointerSort.scrollDir = dir;
    pointerSort.scrollSpeed = speed;
    if (dir && !pointerSortScrollRaf) {
      pointerSortScrollRaf = requestAnimationFrame(tickPointerSortAutoScroll);
    }
    if (!dir) stopPointerSortAutoScroll();
  }

  function cancelPointerSort({ keepDidDrag = false } = {}) {
    if (pointerSort?.timer) clearTimeout(pointerSort.timer);
    stopPointerSortAutoScroll();
    if (pointerSort?.onMove) {
      document.removeEventListener("pointermove", pointerSort.onMove);
      document.removeEventListener("pointerup", pointerSort.onUp);
      document.removeEventListener("pointercancel", pointerSort.onCancel);
    }
    const wasToolSort = document.body.classList.contains("nav-sorting-tools");
    pointerSort = null;
    document.body.classList.remove("nav-sorting", "nav-sorting-tools", "nav-sorting-favorites", "nav-press-pending");
    if (wasToolSort) clearSortFlyouts();
    clearNavDragStyles();
    dragPayload = null;
    if (!keepDidDrag) {
      setTimeout(() => {
        didDrag = false;
      }, 0);
    }
  }

  function commitGroupReorder(fromId, toId, { keepDrawer = false } = {}) {
    if (!fromId || !toId || fromId === toId) return false;
    const next = moveGroupOrder(fromId, toId);
    saveGroupOrder(next);
    renderNav(loadOrder());
    applyRoute({ skipRecent: true, keepDrawer });
    showToast("已保存分类排序");
    return true;
  }

  function commitToolReorder(fromId, toId, { keepDrawer = true } = {}) {
    if (!fromId || !toId || fromId === toId) return false;
    const order = loadOrder();
    const fromIdx = order.indexOf(fromId);
    const toIdx = order.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0) return false;
    order.splice(fromIdx, 1);
    order.splice(toIdx, 0, fromId);
    saveOrder(order);
    renderNav(order);
    applyRoute({ skipRecent: true, keepDrawer });
    showToast("已保存工具排序");
    return true;
  }

  function navToolAtPoint(x, y) {
    const stack = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
    for (const el of stack) {
      const link = el?.closest?.(".tool-nav-link");
      if (link && navEl?.contains(link) && !link.classList.contains("is-filtered-out")) return link;
    }
    return null;
  }

  function readDragPayload(e) {
    try {
      const raw = e.dataTransfer?.getData("application/x-devtools-nav") || "";
      if (raw) return JSON.parse(raw);
    } catch (_) {
      /* ignore */
    }
    if (dragPayload) return dragPayload;
    const plain = e.dataTransfer?.getData("text/plain") || "";
    if (plain && DEFAULT_ORDER.includes(plain)) return { kind: "tool", id: plain };
    return null;
  }

  /** 手机长按排序：分类标题 / 工具项；用 document 级指针事件兼容 iOS */
  function beginMobilePointerSort(e, opts) {
    if (canDesktopDrag()) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (pointerSort?.timer) clearTimeout(pointerSort.timer);
    stopPointerSortAutoScroll();

    const LONG_MS = 360;
    // iOS 长按期间手指微抖较大，阈值过小会提前取消
    const CANCEL_PX = 28;
    const handle = opts.handle;
    const kind = opts.kind; // group | tool

    const onMove = (ev) => {
      if (!pointerSort || pointerSort.pointerId !== ev.pointerId) return;
      const dx = Math.abs(ev.clientX - pointerSort.startX);
      const dy = Math.abs(ev.clientY - pointerSort.startY);
      if (!pointerSort.active) {
        if (dx + dy > CANCEL_PX) cancelPointerSort();
        return;
      }
      ev.preventDefault();
      pointerSort.lastX = ev.clientX;
      pointerSort.lastY = ev.clientY;
      clearNavDragStyles();
      if (kind === "group") {
        pointerSort.wrap?.classList.add("is-dragging");
        const target = navGroupAtPoint(ev.clientX, ev.clientY);
        if (target && target !== pointerSort.wrap) target.classList.add("drag-over");
      } else if (kind === "favorite") {
        pointerSort.handle?.classList.add("is-dragging");
        const target = navFavoriteAtPoint(ev.clientX, ev.clientY);
        if (target && target !== pointerSort.handle) target.classList.add("drag-over");
      } else {
        pointerSort.handle?.classList.add("is-dragging");
        const group = navGroupAtPoint(ev.clientX, ev.clientY);
        if (group) peekNavFlyoutForSort(group);
        const target = navToolAtPoint(ev.clientX, ev.clientY);
        if (target && target !== pointerSort.handle) target.classList.add("drag-over");
      }
      updatePointerSortAutoScroll(ev.clientY, ev.clientX);
    };

    const finish = (ev, cancelled) => {
      if (!pointerSort || pointerSort.pointerId !== ev.pointerId) return;
      const state = pointerSort;
      const wasActive = state.active;
      const fromId = state.id;
      const x = ev.clientX;
      const y = ev.clientY;
      try {
        state.handle?.releasePointerCapture?.(ev.pointerId);
      } catch (_) {
        /* ignore */
      }
      cancelPointerSort({ keepDidDrag: wasActive });
      if (cancelled || !wasActive) return;
      if (kind === "group") {
        const target = navGroupAtPoint(x, y);
        commitGroupReorder(fromId, target?.dataset?.group, { keepDrawer: true });
      } else if (kind === "favorite") {
        const target = navFavoriteAtPoint(x, y);
        commitFavoriteReorder(fromId, target?.dataset?.tool, { keepDrawer: true });
      } else {
        const target = navToolAtPoint(x, y);
        commitToolReorder(fromId, target?.dataset?.tool, { keepDrawer: true });
      }
      setTimeout(() => {
        didDrag = false;
      }, 0);
    };

    const onUp = (ev) => finish(ev, false);
    const onCancel = (ev) => finish(ev, true);

    document.body.classList.add("nav-press-pending");
    pointerSort = {
      kind,
      id: opts.id,
      wrap: opts.wrap || null,
      handle,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      active: false,
      scrollDir: 0,
      scrollSpeed: 0,
      onMove,
      onUp,
      onCancel,
      timer: window.setTimeout(() => {
        if (!pointerSort || pointerSort.pointerId !== e.pointerId) return;
        pointerSort.active = true;
        didDrag = true;
        dragPayload = { kind, id: opts.id };
        document.body.classList.remove("nav-press-pending");
        document.body.classList.add(
          kind === "group" ? "nav-sorting" : kind === "favorite" ? "nav-sorting-favorites" : "nav-sorting-tools"
        );
        if (kind === "tool") beginNavToolSort(opts.wrap);
        else closeNavFlyouts();
        if (kind === "group") pointerSort.wrap?.classList.add("is-dragging");
        else pointerSort.handle?.classList.add("is-dragging");
        try {
          handle.setPointerCapture(e.pointerId);
        } catch (_) {
          /* ignore */
        }
        try {
          navigator.vibrate?.(12);
        } catch (_) {
          /* ignore */
        }
        showToast(
          kind === "group" ? "拖到目标分类后松手" : kind === "favorite" ? "拖到目标常用工具后松手" : "拖到目标工具后松手"
        );
      }, LONG_MS),
    };

    document.addEventListener("pointermove", onMove, { passive: false });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
  }

  function bindNavInteractions() {
    getNavLinks().forEach((link) => {
      if (link.dataset.boundNav === "1") return;
      link.dataset.boundNav = "1";
      link.addEventListener("dragstart", (e) => {
        if (!link.draggable) {
          e.preventDefault();
          return;
        }
        dragPayload = { kind: "tool", id: link.dataset.tool };
        didDrag = true;
        link.classList.add("is-dragging");
        beginNavToolSort(link.closest(".nav-group"));
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/x-devtools-nav", JSON.stringify(dragPayload));
        e.dataTransfer.setData("text/plain", dragPayload.id);
      });
      link.addEventListener("dragend", () => {
        clearNavDragStyles();
        dragPayload = null;
        endNavToolSort();
        setTimeout(() => {
          didDrag = false;
        }, 0);
      });
      link.addEventListener("click", (e) => {
        e.preventDefault();
        if (didDrag) return;
        navigateTo(link.dataset.tool);
      });
      link.addEventListener("contextmenu", (e) => {
        if (!canDesktopDrag()) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        hideNavToolCtx();
        showNavToolCtx(e.clientX, e.clientY, link.dataset.tool);
      });
      link.addEventListener("dragover", (e) => {
        if (!canDesktopDrag()) return;
        const payload = dragPayload || readDragPayload(e);
        if (!payload) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (payload.kind === "tool") {
          link.classList.add("drag-over");
          peekNavFlyoutForSort(link.closest(".nav-group"));
        } else link.closest(".nav-group")?.classList.add("drag-over");
      });
      link.addEventListener("dragleave", () => {
        link.classList.remove("drag-over");
        link.closest(".nav-group")?.classList.remove("drag-over");
      });
      link.addEventListener("drop", (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearNavDragStyles();
        if (!canDesktopDrag()) return;
        const payload = readDragPayload(e);
        const toTool = link.dataset.tool;
        if (!payload || !toTool) return;
        if (payload.kind === "group") {
          const toGroup = TOOL_TO_GROUP[toTool];
          if (!toGroup || payload.id === toGroup) return;
          const next = moveGroupOrder(payload.id, toGroup);
          saveGroupOrder(next);
          renderNav(loadOrder());
          applyRoute({ skipRecent: true });
          showToast("已保存分类排序");
          return;
        }
        commitToolReorder(payload.id, toTool, { keepDrawer: false });
      });
      // 手机：长按工具名排序
      link.addEventListener("pointerdown", (e) => {
        beginMobilePointerSort(e, {
          kind: "tool",
          id: link.dataset.tool,
          handle: link,
          wrap: link.closest(".nav-group"),
        });
      });
    });

    $$(".nav-group", navEl).forEach((wrap) => {
      const title = wrap.querySelector(".nav-group-title");
      if (!title || title.dataset.boundNavGroup === "1") return;
      title.dataset.boundNavGroup = "1";
      title.addEventListener("dragstart", (e) => {
        if (!title.draggable) {
          e.preventDefault();
          return;
        }
        dragPayload = { kind: "group", id: wrap.dataset.group };
        didDrag = true;
        wrap.classList.add("is-dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("application/x-devtools-nav", JSON.stringify(dragPayload));
        e.dataTransfer.setData("text/plain", `group:${dragPayload.id}`);
      });
      title.addEventListener("dragend", () => {
        clearNavDragStyles();
        dragPayload = null;
        setTimeout(() => {
          didDrag = false;
        }, 0);
      });
      const onGroupDragOver = (e) => {
        if (!canDesktopDrag()) return;
        const payload = dragPayload || readDragPayload(e);
        if (!payload) return;
        if (payload.kind === "tool") {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          peekNavFlyoutForSort(wrap);
          return;
        }
        if (payload.kind !== "group") return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        wrap.classList.add("drag-over");
      };
      title.addEventListener("dragover", onGroupDragOver);
      wrap.addEventListener("dragover", onGroupDragOver);
      title.addEventListener("dragleave", () => wrap.classList.remove("drag-over"));
      wrap.addEventListener("dragleave", (e) => {
        if (wrap.contains(e.relatedTarget)) return;
        wrap.classList.remove("drag-over");
      });
      const onGroupDrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        clearNavDragStyles();
        if (!canDesktopDrag()) return;
        const payload = readDragPayload(e);
        const toGroup = wrap.dataset.group;
        if (!payload || payload.kind !== "group" || !toGroup || payload.id === toGroup) return;
        commitGroupReorder(payload.id, toGroup);
      };
      title.addEventListener("drop", onGroupDrop);
      wrap.addEventListener("drop", onGroupDrop);
      title.addEventListener("contextmenu", (e) => {
        if (!canDesktopDrag()) e.preventDefault();
      });
      title.addEventListener("pointerdown", (e) => {
        beginMobilePointerSort(e, {
          kind: "group",
          id: wrap.dataset.group,
          handle: title,
          wrap,
        });
      });
      title.addEventListener("click", (e) => {
        if (!navCompact || didDrag || compactNavSearching()) return;
        e.preventDefault();
        const willPin = !wrap.classList.contains("is-pinned");
        if (willPin) openNavFlyout(wrap, { pin: true });
        else {
          wrap.classList.remove("is-pinned", "is-flyout-open");
          title.setAttribute("aria-expanded", "false");
        }
      });
      wrap.addEventListener("pointerenter", (e) => {
        if (!canHoverNavFlyout(e)) return;
        openNavFlyout(wrap);
      });
      wrap.addEventListener("pointerleave", (e) => {
        if (!navCompact || compactNavSearching()) return;
        if (wrap.classList.contains("is-pinned")) return;
        if (isNavToolSorting()) return;
        if (e?.pointerType && e.pointerType !== "mouse") return;
        scheduleCloseNavFlyout(wrap);
      });
      wrap.addEventListener("focusin", () => {
        if (!navCompact || compactNavSearching()) return;
        openNavFlyout(wrap);
      });
      wrap.addEventListener("focusout", (e) => {
        if (!navCompact || compactNavSearching()) return;
        if (wrap.classList.contains("is-pinned")) return;
        if (isNavToolSorting()) return;
        const next = e.relatedTarget;
        if (next && wrap.contains(next)) return;
        scheduleCloseNavFlyout(wrap);
      });
    });
  }

  $("#nav-compact")?.addEventListener("change", (e) => {
    setNavCompact(Boolean(e.target?.checked));
  });

  navEl?.addEventListener(
    "scroll",
    () => {
      if (!navCompact || compactNavSearching()) return;
      if (document.body.classList.contains("nav-sorting-tools")) {
        $$(".nav-group.is-sort-flyout", navEl).forEach((g) => positionNavFlyout(g));
        return;
      }
      const open = $(".nav-group.is-pinned, .nav-group.is-flyout-open", navEl);
      if (open?.classList.contains("is-pinned")) positionNavFlyout(open);
      else if (open) closeNavFlyouts();
    },
    { passive: true }
  );
  window.addEventListener(
    "resize",
    () => {
      if (!navCompact) return;
      const open = navEl && $(".nav-group.is-pinned, .nav-group.is-flyout-open", navEl);
      if (open) positionNavFlyout(open);
    },
    { passive: true }
  );

  $("#nav-reset")?.addEventListener("click", () => {
    localStorage.removeItem(ORDER_KEY);
    localStorage.removeItem("devtools-tool-order-v2");
    localStorage.removeItem(GROUP_ORDER_KEY);
    renderNav(DEFAULT_ORDER.slice());
    applyRoute({ skipRecent: true });
    showToast("已恢复默认排序");
  });

  async function runNavCacheClear() {
    const btn = $("#nav-cache-clear");
    if (btn?.disabled) return;
    if (btn) btn.disabled = true;
    try {
      if (typeof window.DevToolsTemp?.purgeSiteCache !== "function") {
        showToast("清理功能未就绪");
        return;
      }
      const result = await window.DevToolsTemp.purgeSiteCache();
      showToast(result?.message || "已清理本站缓存");
      try {
        if (navigator.serviceWorker?.getRegistrations) {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
        }
      } catch (_) {}
      const url = new URL(location.href);
      url.searchParams.set("_r", String(Date.now()).slice(-8));
      location.replace(`${url.pathname}${url.search}${url.hash}`);
      return;
    } catch (err) {
      showToast(err?.message || "清理失败");
    } finally {
      if (btn) btn.disabled = false;
      try {
        await window.DevToolsTemp?.refresh?.();
      } catch (_) {}
    }
  }

  $("#nav-cache-clear")?.addEventListener("click", () => {
    runNavCacheClear();
  });

  navOpenBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const isOpen = document.body.classList.contains("nav-open");
    // 已打开时点「工具」一律关闭，不受防抖限制
    if (isOpen) {
      setDrawerOpen(false);
      return;
    }
    if (Date.now() < drawerIgnoreOpenUntil) return;
    setDrawerOpen(true);
  });
  navCloseBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDrawerOpen(false);
  });
  // Safari 对 click 不稳定时，额外用 touchend/pointerup 关抽屉
  navCloseBtn?.addEventListener(
    "pointerup",
    (e) => {
      if (e.pointerType === "mouse") return;
      e.preventDefault();
      e.stopPropagation();
      setDrawerOpen(false);
    },
    { passive: false }
  );
  const closeFromBackdrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setDrawerOpen(false);
  };
  navBackdrop?.addEventListener("click", closeFromBackdrop);
  navBackdrop?.addEventListener("pointerdown", closeFromBackdrop);
  workspaceSwitch?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (document.body.classList.contains("nav-open")) {
      setDrawerOpen(false);
      return;
    }
    if (Date.now() < drawerIgnoreOpenUntil) return;
    setDrawerOpen(true);
  });
  toolSearch?.addEventListener("input", () => applySearchFilter(toolSearch.value));
  favAddBtn?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setFavPickerOpen(!favPickerOpen);
  });
  document.addEventListener("click", (e) => {
    if (!favPickerOpen) return;
    if (e.target.closest("#tool-fav-add") || e.target.closest("#tool-fav-picker")) return;
    setFavPickerOpen(false);
  });
  mediaSubnav?.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-media-tab]");
    if (!btn) return;
    navigateTo("media", btn.dataset.mediaTab);
  });
  mediaSubnav?.addEventListener("keydown", (e) => {
    const tabs = $$(".media-tab", mediaSubnav);
    if (!tabs.length) return;
    const idx = tabs.indexOf(document.activeElement);
    if (idx < 0) return;
    let next = -1;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = (idx + 1) % tabs.length;
    if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = (idx - 1 + tabs.length) % tabs.length;
    if (e.key === "Home") next = 0;
    if (e.key === "End") next = tabs.length - 1;
    if (next < 0) return;
    e.preventDefault();
    tabs[next].focus();
    navigateTo("media", tabs[next].dataset.mediaTab);
  });
  window.addEventListener("hashchange", () => {
    if (isStartupPlaceholderHash()) restoreLastToolOnStartup();
    applyRoute();
  });
  window.addEventListener("popstate", () => {
    if (isStartupPlaceholderHash()) restoreLastToolOnStartup();
    applyRoute();
  });
  // Safari：bfcache / 后台回收后恢复时强制关闭菜单，并重新套用路由（手机常回到 start_url）
  window.addEventListener("pageshow", () => {
    forceDrawerClosed();
    if (isStartupPlaceholderHash()) restoreLastToolOnStartup();
    applyRoute({ skipRecent: true });
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      persistActiveTool();
      return;
    }
    forceDrawerClosed();
    if (isStartupPlaceholderHash()) restoreLastToolOnStartup();
    applyRoute({ skipRecent: true });
  });
  window.addEventListener("pagehide", () => {
    persistActiveTool();
    forceDrawerClosed();
  });
  document.addEventListener("freeze", () => {
    persistActiveTool();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("nav-open")) {
      setDrawerOpen(false);
      return;
    }
    if (e.key !== "Tab" || !document.body.classList.contains("nav-open") || !isMobileDrawer()) return;
    const items = drawerFocusables();
    if (items.length < 2) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // Desktop sidebar max-height only
  const desktopNavMq = window.matchMedia("(min-width: 901px)");
  const DESKTOP_CHROME_HIDDEN_KEY = "devtools-desktop-chrome-hidden-v1";
  let desktopChromeHidden = false;

  function loadDesktopChromeHiddenPref() {
    try {
      return localStorage.getItem(DESKTOP_CHROME_HIDDEN_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function saveDesktopChromeHiddenPref(hidden) {
    try {
      localStorage.setItem(DESKTOP_CHROME_HIDDEN_KEY, hidden ? "1" : "0");
    } catch (_) {}
  }

  function syncDesktopChromeToggleUi() {
    const hidden = document.body.classList.contains("desktop-chrome-hidden");
    const label = hidden ? "显示顶栏" : "隐藏顶栏";
    if (chromeToggleBtn) {
      chromeToggleBtn.textContent = label;
      chromeToggleBtn.setAttribute("aria-pressed", hidden ? "true" : "false");
      chromeToggleBtn.title = hidden
        ? "显示 DevTools 标题栏与左侧工具菜单"
        : "隐藏 DevTools 标题栏与左侧工具菜单";
    }
    if (chromeToggleFloat) {
      chromeToggleFloat.hidden = !hidden || !desktopNavMq.matches;
      chromeToggleFloat.setAttribute("aria-pressed", hidden ? "true" : "false");
    }
  }

  function applyDesktopChromeHidden(hidden, { persist = true } = {}) {
    const want = Boolean(hidden) && desktopNavMq.matches;
    desktopChromeHidden = want;
    document.body.classList.toggle("desktop-chrome-hidden", want);
    if (persist) saveDesktopChromeHiddenPref(want);
    syncDesktopChromeToggleUi();
    syncDesktopNavMaxHeight();
  }

  function toggleDesktopChrome() {
    if (!desktopNavMq.matches) return;
    applyDesktopChromeHidden(!desktopChromeHidden);
  }

  chromeToggleBtn?.addEventListener("click", toggleDesktopChrome);
  chromeToggleFloat?.addEventListener("click", toggleDesktopChrome);

  function syncDesktopNavMaxHeight() {
    if (!navBar) return;
    if (!desktopNavMq.matches) {
      navBar.style.removeProperty("--nav-max-height");
      return;
    }
    const headerHidden = document.body.classList.contains("desktop-chrome-hidden");
    const header = $(".site-header");
    const headerH = headerHidden || !header ? 0 : header.getBoundingClientRect().height;
    const topGap = 0.65 * 16;
    const bottomGap = 16;
    const maxH = Math.max(240, window.innerHeight - headerH - topGap - bottomGap);
    navBar.style.setProperty("--nav-max-height", `${Math.floor(maxH)}px`);
  }
  window.addEventListener("resize", syncDesktopNavMaxHeight, { passive: true });
  if (typeof desktopNavMq.addEventListener === "function") {
    desktopNavMq.addEventListener("change", () => {
      forceDrawerClosed();
      applyDesktopChromeHidden(loadDesktopChromeHiddenPref(), { persist: false });
      syncDesktopNavMaxHeight();
      renderNav(loadOrder());
      renderFavorites();
    });
  }
  applyDesktopChromeHidden(loadDesktopChromeHiddenPref(), { persist: false });
  syncDesktopNavMaxHeight();

  renderNav(loadOrder());
  renderRecent();
  renderFavorites();
  bindNavToolCtx();
  bindNavStripWheelScroll(recentList);
  window.DevToolsCatalog = {
    groups: TOOL_GROUPS,
    meta: TOOL_META,
    about: ABOUT_DESC,
    mediaTabs: MEDIA_TABS,
  };
  window.DevToolsNav = {
    isCompact: () => navCompact,
    setCompact: (on) => setNavCompact(on),
    lastToolHash,
    shouldRestoreLastTool,
    restoreLastToolOnStartup,
    syncSortHint,
    openFlyout: (el) => openNavFlyout(el?.closest?.(".nav-group") || el),
    closeFlyouts: () => closeNavFlyouts(),
    renderRecent,
    renderFavorites,
    addFavorite,
    removeFavorite,
    loadFavorites,
    isDesktopChromeHidden: () => desktopChromeHidden,
    setDesktopChromeHidden: (on) => applyDesktopChromeHidden(Boolean(on)),
    toggleDesktopChrome,
  };
  window.dispatchEvent(new CustomEvent("devtools:catalog"));
  syncSortHint();
  // Safari / iOS：导航后 hash 可能短暂停留在上一页，延后 boot 并在 hashchange 时再次尝试恢复
  let bootPasses = 0;
  const scheduleBootRoute = () => {
    requestAnimationFrame(() => {
      requestAnimationFrame(bootRoute);
    });
    if (isPhoneLikeClient()) {
      setTimeout(bootRoute, 60);
      setTimeout(bootRoute, 280);
    }
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", scheduleBootRoute, { once: true });
  } else {
    scheduleBootRoute();
  }

  // Init
  const now = Date.now();
  tsInput.value = String(Math.floor(now / 1000));
  dtInput.value = formatDateTime(now, timezone);
  convertTsToDate();
  renderFromAhexInput();
  syncChecksFromFlags();
  runRegex();
  window.DevToolsTemp?.refresh?.();
})();
