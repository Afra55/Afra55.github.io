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
  const MEDIA_TABS = ["gifmaker", "vsplit", "vbb"];
  const HASH_ALIASES = {
    gifmaker: { tool: "media", tab: "gifmaker" },
    vsplit: { tool: "media", tab: "vsplit" },
    vbb: { tool: "media", tab: "vbb" },
  };
  const TOOL_GROUPS = [
    { id: "time", label: "时间", tools: ["timestamp", "timediff", "cron"] },
    { id: "color", label: "颜色", tools: ["ahex", "color", "eyedropper"] },
    { id: "encode", label: "编码与安全", tools: ["base64", "imgb64", "url", "hash", "password", "uuid"] },
    {
      id: "data",
      label: "数据与文本",
      tools: ["json", "yaml", "sharecard", "query", "text", "caseconv", "regex", "diff", "qrcode", "markdown"],
    },
    { id: "media", label: "媒体", tools: ["media"] },
    { id: "image", label: "图片", tools: ["imgkit"] },
    { id: "convert", label: "换算", tools: ["units", "coord", "numbase"] },
    { id: "device", label: "设备", tools: ["adb"] },
  ];
  const DEFAULT_GROUP_ORDER = TOOL_GROUPS.map((g) => g.id);
  const GROUP_BY_ID = Object.fromEntries(TOOL_GROUPS.map((g) => [g.id, g]));
  const TOOL_TO_GROUP = Object.fromEntries(
    TOOL_GROUPS.flatMap((g) => g.tools.map((id) => [id, g.id]))
  );
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
    diff: { name: "Diff", aliases: ["对比", "差异"] },
    qrcode: { name: "二维码", aliases: ["qr", "扫码"] },
    media: {
      name: "媒体 / 动图",
      aliases: [
        "gif",
        "gifmaker",
        "视频",
        "视频切分",
        "vsplit",
        "黑盒",
        "一键黑盒",
        "vbb",
        "切分",
        "webp",
        "ffmpeg",
        "动图",
      ],
    },
    imgkit: { name: "图片工具", aliases: ["裁剪", "压缩", "水印", "拼接"] },
    units: { name: "单位换算", aliases: ["长度", "质量"] },
    coord: { name: "坐标系互转", aliases: ["gps", "坐标", "gcj", "wgs"] },
    numbase: { name: "进制转换", aliases: ["二进制", "十六进制"] },
    markdown: { name: "Markdown", aliases: ["md", "预览"] },
    adb: { name: "ADB 工具", aliases: ["安卓", "android", "设备"] },
  };
  const DEFAULT_ORDER = TOOL_GROUPS.flatMap((g) => g.tools);

  const navEl = $("#tool-nav") || $(".tool-nav");
  const navBar = $("#nav-bar") || $(".nav-bar");
  const navBackdrop = $("#nav-backdrop");
  const navOpenBtn = $("#nav-open");
  const navCloseBtn = $("#nav-close");
  const workspaceSwitch = $("#workspace-switch");
  const workspaceTitle = $("#workspace-title");
  const mediaSubnav = $("#media-subnav");
  const toolSearch = $("#tool-search");
  const recentWrap = $("#tool-recent");
  const recentList = $("#tool-recent-list");
  const canDesktopDrag = () => window.matchMedia("(min-width: 901px)").matches;

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
    const legacyMap = { gifmaker: "media", vsplit: "media", vbb: "media" };
    const seen = new Set();
    const out = [];
    (Array.isArray(raw) ? raw : []).forEach((id) => {
      const next = legacyMap[id] || id;
      if (!DEFAULT_ORDER.includes(next) || seen.has(next)) return;
      seen.add(next);
      out.push(next);
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

  function loadRecent() {
    try {
      const parsed = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      const cleaned = sanitizeToolIds(parsed).slice(0, 8);
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

  function pushRecent(id) {
    if (!DEFAULT_ORDER.includes(id)) return;
    const next = [id, ...loadRecent().filter((x) => x !== id)].slice(0, 8);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    renderRecent();
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
      title.draggable = allowHtml5Drag;
      title.title = allowHtml5Drag
        ? "拖动分类可调整整组顺序"
        : "长按分类标题后拖动，可调整整组顺序";
      wrap.appendChild(title);
      tools.forEach((id) => {
        const a = document.createElement("a");
        a.className = "tool-nav-link";
        a.href = id === "media" ? "#media/gifmaker" : `#${id}`;
        a.dataset.tool = id;
        a.draggable = allowHtml5Drag;
        if (allowHtml5Drag) a.title = "拖动可调整工具顺序";
        a.textContent = toolName(id);
        wrap.appendChild(a);
      });
      navEl.appendChild(wrap);
    });
    bindNavInteractions();
    applySearchFilter(toolSearch?.value || "");
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
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nav-recent-chip";
      btn.textContent = toolName(id);
      btn.addEventListener("click", () => navigateTo(id, id === "media" ? currentMediaTab : null));
      recentList.appendChild(btn);
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
    const raw = String(location.hash || "").replace(/^#/, "").trim();
    if (!raw) return { tool: "timestamp", tab: "gifmaker" };
    const parts = raw.split(/[/?]/).filter(Boolean);
    const head = parts[0] || "timestamp";
    if (HASH_ALIASES[head]) return { ...HASH_ALIASES[head] };
    if (head === "media") {
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

  function applyRoute({ skipRecent } = {}) {
    const route = parseRoute();
    currentTool = route.tool;
    currentMediaTab = route.tab || "gifmaker";

    // 旧深链 #gifmaker / #vsplit / #vbb → 规范为 #media/...
    const rawHead = String(location.hash || "")
      .replace(/^#/, "")
      .trim()
      .split(/[/?]/)[0];
    const canonical = routeHash(currentTool, currentMediaTab);
    if (HASH_ALIASES[rawHead] || (rawHead === "media" && !String(location.hash || "").includes("/"))) {
      if (`#${String(location.hash || "").replace(/^#/, "")}` !== canonical) {
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
      mediaSubnav.hidden = currentTool !== "media";
      $$(".media-tab", mediaSubnav).forEach((btn) => {
        const on = btn.dataset.mediaTab === currentMediaTab;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
        btn.tabIndex = on ? 0 : -1;
      });
    }

    const title =
      currentTool === "media"
        ? `${toolName("media")} · ${
            currentMediaTab === "vsplit" ? "视频切分" : currentMediaTab === "vbb" ? "一键黑盒" : "GIF"
          }`
        : toolName(currentTool);
    if (workspaceTitle) workspaceTitle.textContent = title;
    document.title = `${title} · DevTools`;

    getNavLinks().forEach((link) => {
      link.classList.toggle("is-active", link.dataset.tool === currentTool);
      link.setAttribute("aria-current", link.dataset.tool === currentTool ? "page" : "false");
    });

    if (!skipRecent) pushRecent(currentTool);
    setDrawerOpen(false);
    window.scrollTo(0, 0);
    window.dispatchEvent(
      new CustomEvent("devtools:route", {
        detail: { tool: currentTool, mediaTab: currentMediaTab },
      })
    );
  }

  function navigateTo(tool, tab, { replace = false } = {}) {
    const nextTab = tab || (tool === "media" ? currentMediaTab : null);
    const hash = routeHash(tool, nextTab);
    const current = `#${String(location.hash || "").replace(/^#/, "")}`;
    // 媒体内切 Tab 用 replace，避免系统返回在子功能间来回跳
    const mediaTabOnly =
      tool === "media" && currentTool === "media" && nextTab && nextTab !== currentMediaTab;
    const shouldReplace = replace || mediaTabOnly;
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
  }

  let dragPayload = null;
  let didDrag = false;
  /** 手机侧栏：长按分类标题后的 Pointer 排序状态（HTML5 DnD 在触控上不可靠） */
  let pointerSort = null;

  function clearNavDragStyles() {
    getNavLinks().forEach((l) => l.classList.remove("drag-over", "is-dragging"));
    $$(".nav-group", navEl).forEach((g) => g.classList.remove("drag-over", "is-dragging"));
  }

  function navGroupAtPoint(x, y) {
    const stack = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
    for (const el of stack) {
      const group = el?.closest?.(".nav-group");
      if (group && navEl?.contains(group) && !group.classList.contains("is-filtered-out")) return group;
    }
    return null;
  }

  function cancelPointerSort({ keepDidDrag = false } = {}) {
    if (pointerSort?.timer) clearTimeout(pointerSort.timer);
    pointerSort = null;
    document.body.classList.remove("nav-sorting");
    clearNavDragStyles();
    dragPayload = null;
    if (!keepDidDrag) {
      setTimeout(() => {
        didDrag = false;
      }, 0);
    }
  }

  function commitGroupReorder(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return false;
    const next = moveGroupOrder(fromId, toId);
    saveGroupOrder(next);
    renderNav(loadOrder());
    applyRoute({ skipRecent: true });
    showToast("已保存分类排序");
    return true;
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
        navigateTo(link.dataset.tool, link.dataset.tool === "media" ? currentMediaTab : null);
      });
      link.addEventListener("dragover", (e) => {
        if (!canDesktopDrag()) return;
        const payload = dragPayload || readDragPayload(e);
        if (!payload) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        if (payload.kind === "tool") link.classList.add("drag-over");
        else link.closest(".nav-group")?.classList.add("drag-over");
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
        const from = payload.id;
        if (!from || from === toTool) return;
        const order = loadOrder();
        const fromIdx = order.indexOf(from);
        const toIdx = order.indexOf(toTool);
        if (fromIdx < 0 || toIdx < 0) return;
        order.splice(fromIdx, 1);
        order.splice(toIdx, 0, from);
        saveOrder(order);
        renderNav(order);
        applyRoute({ skipRecent: true });
        showToast("已保存排序");
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
        if (!payload || payload.kind !== "group") return;
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

      // 手机抽屉：HTML5 DnD 不可用，长按分类标题再拖动
      const LONG_MS = 420;
      const CANCEL_PX = 14;
      title.addEventListener("pointerdown", (e) => {
        if (canDesktopDrag()) return;
        if (e.pointerType === "mouse" && e.button !== 0) return;
        if (pointerSort?.timer) clearTimeout(pointerSort.timer);
        pointerSort = {
          kind: "group",
          id: wrap.dataset.group,
          wrap,
          title,
          pointerId: e.pointerId,
          startX: e.clientX,
          startY: e.clientY,
          active: false,
          timer: window.setTimeout(() => {
            if (!pointerSort || pointerSort.pointerId !== e.pointerId) return;
            pointerSort.active = true;
            didDrag = true;
            dragPayload = { kind: "group", id: wrap.dataset.group };
            wrap.classList.add("is-dragging");
            document.body.classList.add("nav-sorting");
            try {
              title.setPointerCapture(e.pointerId);
            } catch (_) {
              /* ignore */
            }
            try {
              navigator.vibrate?.(12);
            } catch (_) {
              /* ignore */
            }
            showToast("拖动到目标分类处松开");
          }, LONG_MS),
        };
      });
      title.addEventListener(
        "pointermove",
        (e) => {
          if (!pointerSort || pointerSort.pointerId !== e.pointerId) return;
          const dx = Math.abs(e.clientX - pointerSort.startX);
          const dy = Math.abs(e.clientY - pointerSort.startY);
          if (!pointerSort.active) {
            if (dx + dy > CANCEL_PX) cancelPointerSort();
            return;
          }
          e.preventDefault();
          clearNavDragStyles();
          pointerSort.wrap.classList.add("is-dragging");
          const target = navGroupAtPoint(e.clientX, e.clientY);
          if (target && target !== pointerSort.wrap) target.classList.add("drag-over");
        },
        { passive: false }
      );
      const endPointer = (e) => {
        if (!pointerSort || pointerSort.pointerId !== e.pointerId) return;
        const state = pointerSort;
        const wasActive = state.active;
        const fromId = state.id;
        const x = e.clientX;
        const y = e.clientY;
        try {
          state.title.releasePointerCapture(e.pointerId);
        } catch (_) {
          /* ignore */
        }
        cancelPointerSort({ keepDidDrag: wasActive });
        if (!wasActive) return;
        const target = navGroupAtPoint(x, y);
        commitGroupReorder(fromId, target?.dataset?.group);
        setTimeout(() => {
          didDrag = false;
        }, 0);
      };
      title.addEventListener("pointerup", endPointer);
      title.addEventListener("pointercancel", (e) => {
        if (!pointerSort || pointerSort.pointerId !== e.pointerId) return;
        try {
          title.releasePointerCapture(e.pointerId);
        } catch (_) {
          /* ignore */
        }
        cancelPointerSort();
      });
    });
  }

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
  window.addEventListener("hashchange", () => applyRoute());
  window.addEventListener("popstate", () => applyRoute());
  // Safari：bfcache / 后台回收后恢复时强制关闭菜单
  window.addEventListener("pageshow", () => {
    forceDrawerClosed();
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) forceDrawerClosed();
  });
  window.addEventListener("pagehide", () => {
    forceDrawerClosed();
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
  function syncDesktopNavMaxHeight() {
    if (!navBar) return;
    if (!desktopNavMq.matches) {
      navBar.style.removeProperty("--nav-max-height");
      return;
    }
    const header = $(".site-header");
    const headerH = header ? header.getBoundingClientRect().height : 64;
    const topGap = 0.65 * 16;
    const bottomGap = 16;
    const maxH = Math.max(240, window.innerHeight - headerH - topGap - bottomGap);
    navBar.style.setProperty("--nav-max-height", `${Math.floor(maxH)}px`);
  }
  window.addEventListener("resize", syncDesktopNavMaxHeight, { passive: true });
  if (typeof desktopNavMq.addEventListener === "function") {
    desktopNavMq.addEventListener("change", () => {
      forceDrawerClosed();
      syncDesktopNavMaxHeight();
      renderNav(loadOrder());
    });
  }
  syncDesktopNavMaxHeight();

  renderNav(loadOrder());
  renderRecent();
  if (!location.hash) history.replaceState(null, "", "#timestamp");
  applyRoute();
  // 默认关闭；防止 Safari 恢复残留开态
  forceDrawerClosed();

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
