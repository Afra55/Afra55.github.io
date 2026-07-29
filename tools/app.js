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

  $$(".seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".seg-btn").forEach((b) => b.classList.remove("is-active"));
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
  const jsonOutput = $("#json-output");
  const jsonError = $("#json-error");
  const jsonMeta = $("#json-meta");

  function parseJsonInput() {
    const raw = jsonInput.value.trim();
    if (!raw) throw new Error("请先输入 JSON");
    return JSON.parse(raw);
  }

  function runJson(mode) {
    try {
      const data = parseJsonInput();
      setToolError(jsonError, "");
      if (mode === "validate") {
        jsonOutput.value = "";
        jsonMeta.textContent = `校验通过 · 根类型 ${Array.isArray(data) ? "array" : typeof data}`;
        showToast("JSON 合法");
        return;
      }
      const out = mode === "pretty" ? JSON.stringify(data, null, 2) : JSON.stringify(data);
      jsonOutput.value = out;
      jsonMeta.textContent =
        mode === "pretty"
          ? `已美化 · ${out.split("\n").length} 行 · ${out.length} 字符`
          : `已压缩 · ${out.length} 字符`;
    } catch (err) {
      jsonOutput.value = "";
      jsonMeta.textContent = "";
      setToolError(jsonError, `JSON 无效：${err.message || err}`);
    }
  }

  $("#json-pretty").addEventListener("click", () => runJson("pretty"));
  $("#json-minify").addEventListener("click", () => runJson("minify"));
  $("#json-validate").addEventListener("click", () => runJson("validate"));
  $("#json-clear").addEventListener("click", () => {
    jsonInput.value = "";
    jsonOutput.value = "";
    jsonMeta.textContent = "";
    setToolError(jsonError, "");
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

  // ---- Tool order (group default + user drag) ----
  const ORDER_KEY = "devtools-tool-order-v2";
  const DEFAULT_ORDER = [
    "timestamp",
    "timediff",
    "cron",
    "ahex",
    "color",
    "eyedropper",
    "password",
    "base64",
    "imgb64",
    "url",
    "hash",
    "uuid",
    "json",
    "yaml",
    "sharecard",
    "query",
    "text",
    "regex",
    "diff",
    "qrcode",
    "units",
    "numbase",
    "markdown",
  ];

  const navEl = $("#tool-nav") || $(".tool-nav");
  const shellEl = $(".shell");
  const comingEl = $("#coming");

  function getNavLinks() {
    return $$(".tool-nav-link", navEl);
  }

  function currentOrderFromDom() {
    return getNavLinks()
      .map((link) => link.dataset.tool || (link.getAttribute("href") || "").replace(/^#/, ""))
      .filter(Boolean);
  }

  function loadOrder() {
    try {
      const raw = localStorage.getItem(ORDER_KEY);
      if (!raw) return DEFAULT_ORDER.slice();
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return DEFAULT_ORDER.slice();
      const cleaned = parsed.filter((id) => DEFAULT_ORDER.includes(id));
      for (const id of DEFAULT_ORDER) {
        if (!cleaned.includes(id)) cleaned.push(id);
      }
      return cleaned;
    } catch (_) {
      return DEFAULT_ORDER.slice();
    }
  }

  function saveOrder(order) {
    localStorage.setItem(ORDER_KEY, JSON.stringify(order));
  }

  function applyOrder(order) {
    const linkMap = new Map(getNavLinks().map((link) => [link.dataset.tool, link]));
    order.forEach((id) => {
      const link = linkMap.get(id);
      if (link) navEl.appendChild(link);
    });

    order.forEach((id) => {
      const section = document.getElementById(id);
      if (section && shellEl) {
        if (comingEl) shellEl.insertBefore(section, comingEl);
        else shellEl.appendChild(section);
      }
    });
    if (comingEl && shellEl) shellEl.appendChild(comingEl);
  }

  function getSectionsInNavOrder() {
    return getNavLinks()
      .map((link) => document.getElementById(link.dataset.tool))
      .filter(Boolean);
  }

  function syncNav() {
    const sections = getSectionsInNavOrder();
    const y = window.scrollY + 140;
    let current = sections[0]?.id;
    for (const section of sections) {
      if (section && section.offsetTop <= y) current = section.id;
    }
    getNavLinks().forEach((link) => {
      link.classList.toggle("is-active", link.dataset.tool === current);
    });
  }

  applyOrder(loadOrder());

  let dragId = null;
  let didDrag = false;
  getNavLinks().forEach((link) => {
    link.addEventListener("dragstart", (e) => {
      dragId = link.dataset.tool;
      didDrag = true;
      link.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", dragId);
    });
    link.addEventListener("dragend", () => {
      link.classList.remove("is-dragging");
      getNavLinks().forEach((l) => l.classList.remove("drag-over"));
      dragId = null;
      setTimeout(() => {
        didDrag = false;
      }, 0);
    });
    link.addEventListener("click", (e) => {
      if (didDrag) e.preventDefault();
    });
    link.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      link.classList.add("drag-over");
    });
    link.addEventListener("dragleave", () => link.classList.remove("drag-over"));
    link.addEventListener("drop", (e) => {
      e.preventDefault();
      link.classList.remove("drag-over");
      const from = e.dataTransfer.getData("text/plain") || dragId;
      const to = link.dataset.tool;
      if (!from || !to || from === to) return;
      const order = currentOrderFromDom();
      const fromIdx = order.indexOf(from);
      const toIdx = order.indexOf(to);
      if (fromIdx < 0 || toIdx < 0) return;
      order.splice(fromIdx, 1);
      order.splice(toIdx, 0, from);
      applyOrder(order);
      saveOrder(order);
      syncNav();
      showToast("已保存排序");
    });
  });

  $("#nav-reset")?.addEventListener("click", () => {
    localStorage.removeItem(ORDER_KEY);
    applyOrder(DEFAULT_ORDER.slice());
    syncNav();
    showToast("已恢复默认排序");
  });

  window.addEventListener("scroll", syncNav, { passive: true });

  // Mobile: hide sticky nav on scroll down, show on scroll up
  const navBar = $(".nav-bar");
  const mobileNavMq = window.matchMedia("(max-width: 700px)");
  let lastScrollY = window.scrollY;
  let scrollAcc = 0;
  const NAV_HIDE_THRESHOLD = 28;
  const NAV_TOP_FORCE_SHOW = 56;

  function setNavCollapsed(collapsed) {
    if (!navBar) return;
    navBar.classList.toggle("is-collapsed", !!collapsed);
  }

  function onNavAutohideScroll() {
    if (!navBar) return;
    if (!mobileNavMq.matches) {
      setNavCollapsed(false);
      lastScrollY = window.scrollY;
      scrollAcc = 0;
      return;
    }
    const y = Math.max(0, window.scrollY);
    const dy = y - lastScrollY;
    lastScrollY = y;
    if (y <= NAV_TOP_FORCE_SHOW) {
      setNavCollapsed(false);
      scrollAcc = 0;
      return;
    }
    if (Math.abs(dy) < 1) return;
    if ((dy > 0 && scrollAcc < 0) || (dy < 0 && scrollAcc > 0)) scrollAcc = 0;
    scrollAcc += dy;
    if (scrollAcc > NAV_HIDE_THRESHOLD) {
      setNavCollapsed(true);
      scrollAcc = 0;
    } else if (scrollAcc < -NAV_HIDE_THRESHOLD) {
      setNavCollapsed(false);
      scrollAcc = 0;
    }
  }

  window.addEventListener("scroll", onNavAutohideScroll, { passive: true });
  if (typeof mobileNavMq.addEventListener === "function") {
    mobileNavMq.addEventListener("change", () => {
      if (!mobileNavMq.matches) setNavCollapsed(false);
    });
  } else if (typeof mobileNavMq.addListener === "function") {
    mobileNavMq.addListener(() => {
      if (!mobileNavMq.matches) setNavCollapsed(false);
    });
  }
  getNavLinks().forEach((link) => {
    link.addEventListener("click", () => setNavCollapsed(false));
  });

  // Init
  const now = Date.now();
  tsInput.value = String(Math.floor(now / 1000));
  dtInput.value = formatDateTime(now, timezone);
  convertTsToDate();
  renderFromAhexInput();
  syncChecksFromFlags();
  runRegex();
  syncNav();
})();
