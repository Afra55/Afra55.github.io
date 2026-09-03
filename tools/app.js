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

  const initedCorePanels = new Set();

  function initTimestampPanel() {
  // ---- Timestamp ----
  const tsInput = $("#ts-input");
  const dtInput = $("#dt-input");
  if (!tsInput || !dtInput) return;
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

  const now = Date.now();
  tsInput.value = String(Math.floor(now / 1000));
  dtInput.value = formatDateTime(now, timezone);
  convertTsToDate();
  }

  function initAhexPanel() {
  // ---- AHEX ----
  const ahexInput = $("#ahex-input");
  if (!ahexInput) return;
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

  renderFromAhexInput();
  }

  function initBase64Panel() {
  // ---- Base64 ----
  const b64Text = $("#b64-text");
  if (!b64Text) return;
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
  }

  function initJsonPanel() {
  // ---- JSON ----
  const jsonInput = $("#json-input");
  if (!jsonInput) return;
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

  async function runJsonRepair() {
    const raw = jsonInput.value.trim();
    if (!raw) {
      jsonMeta.textContent = "";
      setToolError(jsonError, "请先输入 JSON");
      return;
    }
    const repairBtn = $("#json-repair");
    try {
      setToolError(jsonError, "");
      jsonMeta.textContent = "加载修复库…";
      if (repairBtn) repairBtn.disabled = true;
      await window.DevToolsLazy?.loadVendor("jsonrepair");
      const jsonrepair = globalThis.JSONRepair?.jsonrepair;
      if (typeof jsonrepair !== "function") throw new Error("JSON 修复库未就绪");
      const repaired = jsonrepair(raw);
      const data = JSON.parse(repaired);
      const pretty = JSON.stringify(data, null, 2);
      jsonInput.value = pretty;
      jsonMeta.textContent = `已修复并美化 · 根类型 ${Array.isArray(data) ? "array" : typeof data} · ${pretty.split("\n").length} 行 · ${pretty.length} 字符`;
      fitJsonArea();
      showToast(repaired.replace(/\s/g, "") === raw.replace(/\s/g, "") ? "JSON 已是合法格式" : "JSON 已修复");
    } catch (err) {
      jsonMeta.textContent = "";
      const msg = err?.position != null ? `${err.message}` : String(err?.message || err);
      setToolError(jsonError, `修复失败：${msg}`);
    } finally {
      if (repairBtn) repairBtn.disabled = false;
    }
  }

  $("#json-repair")?.addEventListener("click", () => {
    void runJsonRepair();
  });
  $("#json-pretty").addEventListener("click", () => runJson("pretty"));
  $("#json-minify").addEventListener("click", () => runJson("minify"));
  $("#json-validate").addEventListener("click", () => runJson("validate"));
  $("#json-clear").addEventListener("click", () => {
    jsonInput.value = "";
    jsonMeta.textContent = "";
    setToolError(jsonError, "");
    resetJsonAreaHeight();
  });
  }

  function initRegexPanel() {
  // ---- Regex ----
  const rePattern = $("#re-pattern");
  if (!rePattern) return;
  const reFlags = $("#re-flags");
  const reText = $("#re-text");
  const reHighlight = $("#re-highlight");
  const reMatches = $("#re-matches");
  const reMeta = $("#re-meta");
  const reError = $("#re-error");
  const reVisPaper = $("#re-vis-paper");
  const reVisError = $("#re-vis-error");
  const reVisHint = $("#re-vis-hint");
  const reVisFrame = $("#re-vis-frame");
  const reVisOpen = $("#re-vis-open");
  const reVisModeHint = $("#re-vis-mode-hint");
  const reVisEditWrap = $("#re-vis-edit-wrap");
  const reVisRailWrap = $("#re-vis-wrap");
  const reVisToolbarEdit = $("#re-vis-toolbar-edit");
  const reVisToolbarRail = $("#re-vis-toolbar-rail");
  const flagChecks = $$("[data-flag]");
  let flagsSyncing = false;
  let reVisTimer = 0;
  let reVisFrameTimer = 0;
  let regulexApi = null;
  let reVisMode = "edit"; // edit | rail
  let reVisFrameLoaded = false;
  let reVisLastSrc = "";

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

  function loadRegulex() {
    if (regulexApi) return Promise.resolve(regulexApi);
    return window.DevToolsLazy.loadVendor("regulex").then(
      () =>
        new Promise((resolve, reject) => {
          if (typeof require !== "function") {
            reject(new Error("Regulex 加载失败"));
            return;
          }
          require(["regulex"], (api) => {
            regulexApi = api;
            resolve(api);
          }, reject);
        })
    );
  }

  function setVisError(msg) {
    if (!reVisError) return;
    if (!msg) {
      reVisError.hidden = true;
      reVisError.textContent = "";
      return;
    }
    reVisError.hidden = false;
    reVisError.textContent = msg;
  }

  function regexVisUrl(pattern, flags) {
    const re = String(pattern || "");
    const f = uniqueFlags(flags);
    const qs = new URLSearchParams();
    if (re) qs.set("r", re);
    // Regex Vis 以 AST 编辑为主；flags 一并带上方便对照
    if (f) qs.set("f", f);
    const q = qs.toString();
    return q ? `https://regex-vis.com/?${q}` : "https://regex-vis.com/";
  }

  function syncRegexVisFrame({ force = false } = {}) {
    if (!reVisFrame || reVisMode !== "edit") return;
    const pattern = rePattern.value;
    const flags = uniqueFlags(reFlags.value);
    const src = regexVisUrl(pattern, flags);
    if (reVisOpen) reVisOpen.href = src;
    if (!force && src === reVisLastSrc && reVisFrameLoaded) return;
    reVisLastSrc = src;
    reVisFrameLoaded = true;
    reVisFrame.src = src;
  }

  function scheduleRegexVisFrame() {
    if (reVisMode !== "edit") return;
    clearTimeout(reVisFrameTimer);
    reVisFrameTimer = setTimeout(() => syncRegexVisFrame(), 450);
  }

  function setRegexVisMode(mode) {
    reVisMode = mode === "rail" ? "rail" : "edit";
    $$("[data-re-vis-mode]").forEach((btn) => {
      const on = btn.dataset.reVisMode === reVisMode;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (reVisEditWrap) reVisEditWrap.hidden = reVisMode !== "edit";
    if (reVisRailWrap) reVisRailWrap.hidden = reVisMode !== "rail";
    if (reVisToolbarEdit) reVisToolbarEdit.hidden = reVisMode !== "edit";
    if (reVisToolbarRail) reVisToolbarRail.hidden = reVisMode !== "rail";
    if (reVisModeHint) {
      reVisModeHint.textContent =
        reVisMode === "edit"
          ? "点选节点可编辑正则（嵌入 Regex Vis）"
          : "本地 Regulex 铁路图（只读，不能点选编辑）";
    }
    if (reVisMode === "edit") syncRegexVisFrame({ force: !reVisFrameLoaded });
    else drawRegexVis();
  }

  function drawRegexVis() {
    if (!reVisPaper || reVisMode !== "rail") return;
    const pattern = rePattern.value;
    const flags = uniqueFlags(reFlags.value);
    if (!pattern) {
      reVisPaper.innerHTML = "";
      if (reVisHint) reVisHint.hidden = false;
      setVisError("");
      return;
    }
    loadRegulex()
      .then((R) => {
        reVisPaper.innerHTML = "";
        if (reVisHint) reVisHint.hidden = true;
        const paper = R.Raphael(reVisPaper, 10, 10);
        try {
          R.visualize(R.parse(pattern), flags, paper);
          setVisError("");
        } catch (err) {
          reVisPaper.innerHTML = "";
          const tip = err?.message || String(err);
          setVisError(`结构图解析失败：${tip}`);
        }
      })
      .catch((err) => setVisError(err.message || String(err)));
  }

  function scheduleVis() {
    if (reVisMode === "edit") {
      scheduleRegexVisFrame();
      return;
    }
    clearTimeout(reVisTimer);
    reVisTimer = setTimeout(drawRegexVis, 220);
  }

  function runRegex() {
    const pattern = rePattern.value;
    const text = reText.value;
    const flags = uniqueFlags(reFlags.value);
    scheduleVis();

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
  $("#re-vis-refresh")?.addEventListener("click", drawRegexVis);
  $("#re-vis-sync")?.addEventListener("click", () => syncRegexVisFrame({ force: true }));
  $$("[data-re-vis-mode]").forEach((btn) => {
    btn.addEventListener("click", () => setRegexVisMode(btn.dataset.reVisMode || "edit"));
  });

  syncChecksFromFlags();
  setRegexVisMode("edit");
  runRegex();
  }

  function renderMarkdownPreview(src) {
    let html = String(src || "");
    html = html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    html = html.replace(/^### (.+)$/gm, "<h3>$1</h3>");
    html = html.replace(/^## (.+)$/gm, "<h2>$1</h2>");
    html = html.replace(/^# (.+)$/gm, "<h1>$1</h1>");
    html = html.replace(/```[\s\S]*?```/g, (m) => {
      const inner = m.slice(3, -3).replace(/^\w*\n/, "");
      return `<pre class="mono">${inner}</pre>`;
    });
    html = html.replace(/`([^`]+)`/g, '<code class="mono">$1</code>');
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");
    html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
    html = html.replace(/_(.+?)_/g, "<em>$1</em>");
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
    html = html.replace(/^[-*] (.+)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`);
    html = html.replace(/^\d+\. (.+)$/gm, "<li>$1</li>");
    html = html.replace(/((?:<li>.*<\/li>\n?)+)(?!<\/ul>)/g, (m) => `<ol>${m}</ol>`);
    html = html.replace(/\n{2,}/g, "</p><p>");
    html = `<p>${html}</p>`;
    html = html.replace(/<p>\s*(<h[1-6]>)/g, "$1").replace(/(<\/h[1-6]>)\s*<\/p>/g, "$1");
    html = html.replace(/<p>\s*(<pre)/g, "$1").replace(/(<\/pre>)\s*<\/p>/g, "$1");
    html = html.replace(/<p>\s*(<ul)/g, "$1").replace(/(<\/ul>)\s*<\/p>/g, "$1");
    html = html.replace(/<p>\s*(<ol)/g, "$1").replace(/(<\/ol>)\s*<\/p>/g, "$1");
    html = html.replace(/<p>\s*<\/p>/g, "");
    return html;
  }

  function initMarkdownPanel() {
    const root = document.getElementById("markdown");
    if (!root || root.dataset.mdInited === "1") return;
    const mdInput = $("#md-input", root);
    const mdPreview = $("#md-preview", root);
    if (!mdInput || !mdPreview) return;
    root.dataset.mdInited = "1";

    const refreshMarkdown = () => {
      mdPreview.innerHTML = renderMarkdownPreview(mdInput.value || "");
    };

    mdInput.addEventListener("input", refreshMarkdown);
    refreshMarkdown();
  }

  const CORE_PANEL_INIT = {
    timestamp: initTimestampPanel,
    ahex: initAhexPanel,
    base64: initBase64Panel,
    json: initJsonPanel,
    regex: initRegexPanel,
    markdown: initMarkdownPanel,
  };

  function initCorePanel(toolId) {
    const id = String(toolId || "").trim();
    if (!id || initedCorePanels.has(id)) return;
    const fn = CORE_PANEL_INIT[id];
    if (!fn) return;
    initedCorePanels.add(id);
    fn();
    const root = document.getElementById(id);
    if (root) bindCopyButtons(root);
  }

  function bindCopyButtons(root = document) {
  $$("[data-copy]", root).forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.copy);
      if (target?.textContent) copyText(target.textContent);
    });
  });
  $$("[data-copy-value]", root).forEach((btn) => {
    if (btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => copyFromValueEl(btn.dataset.copyValue));
  });
  }

  // ---- Copy / nav ----
  function copyFromValueEl(id) {
    const el = document.getElementById(id);
    if (!el) return;
    const text = "value" in el ? el.value : el.textContent;
    if (text) copyText(text);
  }

  bindCopyButtons();

  // ---- Workspace shell: groups, search, single-tool route ----
  const ORDER_KEY = "devtools-tool-order-v3";
  const GROUP_ORDER_KEY = "devtools-group-order-v1";
  const RECENT_KEY = "devtools-tool-recent-v1";
  const FAVORITES_KEY = "devtools-tool-favorites-v1";
  const LAST_TOOL_KEY = "devtools-tool-last-v1";
  const LAST_TOOL_SESSION_KEY = "devtools-tool-last-session-v1";
  const SORT_HINT_KEY = "devtools-nav-sort-hint-seen-v1";
  const NAV_COMPACT_KEY = "devtools-nav-compact-v1";
  /** 站点页不算「上次工具」，避免 about/setup 盖掉真实工具 */
  const SITE_NAV_IDS = new Set(["about", "setup"]);
  const LEGACY_MEDIA_TOOLS = ["gifmaker", "vsplit", "vtrim", "audio", "vplay"];
  /** 非紧凑侧栏时也显示顶栏分类条（工具数≥2） */
  const GROUPS_WITH_ALWAYS_SUBNAV = new Set(["gif", "video", "blackbox"]);
  const HASH_ALIASES = {
    gifmaker: { tool: "gifmaker" },
    vsplit: { tool: "vsplit" },
    vtrim: { tool: "vtrim" },
    audio: { tool: "audio" },
    vplay: { tool: "vplay" },
    vbb: { tool: "vbb" },
    blackbox: { tool: "vbb" },
    gifbb: { tool: "gifbb" },
    // 已并入外链导航，旧深链跳转过去
    pdfcraft: { tool: "sitenav" },
    insectworld: { tool: "sitenav" },
    prehmuseum: { tool: "sitenav" },
  };
  const REG = window.DEVTOOLS_REGISTRY || {};
  const TOOL_GROUPS = REG.groups || [];
  const TOOL_META = REG.meta || {};
  const ABOUT_DESC = REG.about || {};
  const DEFAULT_ORDER = TOOL_GROUPS.flatMap((g) => g.tools);
  const NAV_SCALE = window.DevToolsNavScale || {};
  const NAV_SEARCH_INDEX = NAV_SCALE.buildSearchIndex ? NAV_SCALE.buildSearchIndex(TOOL_META) : [];
  const NAV_SCALABLE_MIN_TOOLS = NAV_SCALE.NAV_SCALABLE_MIN_TOOLS ?? 100;
  const NAV_VIRTUAL_GROUP_MIN = NAV_SCALE.NAV_VIRTUAL_GROUP_MIN ?? 48;
  const DEFAULT_GROUP_ORDER = TOOL_GROUPS.map((g) => g.id);
  const GROUP_BY_ID = Object.fromEntries(TOOL_GROUPS.map((g) => [g.id, g]));
  const TOOL_TO_GROUP = Object.fromEntries(
    TOOL_GROUPS.flatMap((g) => g.tools.map((id) => [id, g.id]))
  );
  /** 新增工具：编辑 registry/tools.json → node tools/scripts/build-tool-registry.cjs → verify-registry */

  const navEl = $("#tool-nav") || $(".tool-nav");
  const navBar = $("#nav-bar") || $(".nav-bar");
  const navBarScroll = $("#nav-bar-scroll") || navBar;
  const navBackdrop = $("#nav-backdrop");
  const navOpenBtn = $("#nav-open");
  const navCloseBtn = $("#nav-close");
  const chromeToggleBtn = $("#site-chrome-toggle");
  const chromeToggleFloat = $("#site-chrome-toggle-float");
  const workspaceSwitch = $("#workspace-switch");
  const workspaceShare = $("#workspace-share");
  const headerMoreToggle = $("#header-more-toggle");
  const headerMoreMenu = $("#header-more-menu");
  const workspaceTitle = $("#workspace-title");
  const mediaSubnav = $("#category-subnav");
  const categorySubnav = mediaSubnav;
  const toolSearch = $("#tool-search");
  const recentWrap = $("#tool-recent");
  const recentList = $("#tool-recent-list");
  const recentToggle = $("#tool-recent-toggle");
  const recentCount = $("#tool-recent-count");
  const recentDlg = $("#nav-recent-dlg");
  const recentDlgList = $("#nav-recent-dlg-list");
  const recentDlgClose = $("#nav-recent-dlg-close");
  const favoritesWrap = $("#tool-favorites");
  const favoritesList = $("#tool-fav-list");
  const navToolCtx = $("#nav-tool-ctx");
  let navToolCtxId = "";
  const favAddBtn = $("#tool-fav-add");
  const favTitle = $("#tool-fav-title");
  const favPicker = $("#tool-fav-picker");
  const canDesktopDrag = () => window.matchMedia("(min-width: 901px)").matches;

  function isCoarsePointer() {
    try {
      return window.matchMedia("(pointer: coarse)").matches;
    } catch (_) {
      return false;
    }
  }

  /** 侧栏 Pointer 长按排序：仅手机抽屉 ⠿ 手柄（HTML5 DnD 在触控上不可靠） */
  function usePointerNavSort(pointerType, { fromHandle } = {}) {
    if (!fromHandle) return false;
    if (!canDesktopDrag()) return true;
    if (!navCompactActive()) return false;
    if (pointerType === "touch") return true;
    return isCoarsePointer();
  }

  function allowNavHtml5Drag() {
    if (!canDesktopDrag()) return false;
    if (!navCompactActive()) return true;
    if (isCoarsePointer()) return false;
    try {
      if (navigator.maxTouchPoints > 0) return false;
    } catch (_) {
      /* ignore */
    }
    return true;
  }

  function navSortInteractionActive() {
    return (
      document.body.classList.contains("nav-sorting") ||
      document.body.classList.contains("nav-sorting-tools") ||
      document.body.classList.contains("nav-sorting-favorites")
    );
  }

  let navSortClickSuppressUntil = 0;

  function shouldSuppressNavCompactClick() {
    return Date.now() < navSortClickSuppressUntil || navSortInteractionActive();
  }

  function navGroupSortHint() {
    if (showMobileSortHandles()) return "拖左侧 ⠿ 手柄排序分类";
    return allowNavHtml5Drag()
      ? "拖动分类可调整整组顺序"
      : navCompactActive()
        ? "长按分类标题再拖动排序（短按展开工具）"
        : "长按分类标题后拖动，可调整整组顺序";
  }

  function navToolSortHint() {
    if (showMobileSortHandles()) return "拖左侧 ⠿ 手柄排序；长按名称加入常用";
    return allowNavHtml5Drag() ? "拖动可调整工具顺序" : "长按工具名后拖动，可调整顺序";
  }

  function navFavSortHint() {
    if (showMobileSortHandles()) return "拖左侧 ⠿ 手柄排序常用工具；长按名称管理常用";
    return allowNavHtml5Drag() ? "拖动排序；右键更多操作" : "长按后拖动，可调整常用顺序";
  }

  function syncNavSortDragMode() {
    if (!navEl) return;
    const allowDrag = allowNavHtml5Drag();
    const groupHint = navGroupSortHint();
    const toolHint = navToolSortHint();
    $$(".nav-group-title", navEl).forEach((title) => {
      title.draggable = allowDrag;
      title.title = groupHint;
    });
    getNavLinks().forEach((link) => {
      link.draggable = allowDrag;
      link.title = toolHint;
    });
    if (favoritesList) {
      $$(".nav-fav-link", favoritesList).forEach((link) => {
        link.draggable = allowDrag;
        link.title = allowDrag ? "拖动排序；右键更多操作" : navFavSortHint();
      });
    }
  }

  let currentTool = "timestamp";
  let lastFocusBeforeDrawer = null;
  let drawerFocusTimer = 0;
  let drawerIgnoreOpenUntil = 0;
  let navCompact = false;
  try {
    const storedCompact = localStorage.getItem(NAV_COMPACT_KEY);
    if (storedCompact === null && compactNavOnMobile()) navCompact = true;
    else navCompact = storedCompact === "1";
  } catch (_) {
    navCompact = false;
  }

  let recentOpen = false;

  let navShellBootstrapped = false;
  let bootPasses = 0;

  function scheduleBootRoute() {
    requestAnimationFrame(() => {
      requestAnimationFrame(bootRoute);
    });
    if (isPhoneLikeClient()) {
      setTimeout(bootRoute, 60);
      setTimeout(bootRoute, 280);
    }
  }

  let navOrganizePromise = null;

  function ensureNavOrganizeScript() {
    if (window.DevToolsNavOrganize) return Promise.resolve();
    if (navOrganizePromise) return navOrganizePromise;
    const build = window.TOOLS_BUILD || "dev";
    navOrganizePromise = new Promise((resolve, reject) => {
      const src = `./nav-organize.js?v=${encodeURIComponent(build)}`;
      const existing = [...document.scripts].find((s) => String(s.src || "").includes("nav-organize.js"));
      if (existing) {
        if (existing.dataset.devtoolsLoaded === "1" || window.DevToolsNavOrganize) {
          resolve();
          return;
        }
        existing.addEventListener("load", () => resolve(), { once: true });
        existing.addEventListener("error", () => reject(new Error("nav-organize.js 加载失败")), { once: true });
        return;
      }
      const node = document.createElement("script");
      node.src = src;
      node.async = true;
      node.onload = () => {
        node.dataset.devtoolsLoaded = "1";
        resolve();
      };
      node.onerror = () => {
        navOrganizePromise = null;
        reject(new Error("nav-organize.js 加载失败"));
      };
      document.head.appendChild(node);
    });
    return navOrganizePromise;
  }

  function handleBuildUpgrade() {
    const info = window.__devtoolsBuildUpgraded;
    if (!info?.to) return;
    const toastKey = `devtools-upgrade-toast-${info.to}`;
    try {
      if (!sessionStorage.getItem(toastKey)) {
        sessionStorage.setItem(toastKey, "1");
        showToast(`已加载新版本 v${info.to}`);
      }
    } catch (_) {
      showToast(`已加载新版本 v${info.to}`);
    }
    if (window.caches?.keys) {
      window.caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys.filter((k) => k.startsWith("devtools-shell-") && k !== "devtools-shell-20260901-101500").map((k) => caches.delete(k))
          )
        )
        .catch(() => {});
    }
  }

  function bootstrapNavShell() {
    if (navShellBootstrapped) return;
    navShellBootstrapped = true;
    handleBuildUpgrade();
    renderNav(loadOrder());
    renderRecent();
    renderFavorites();
    bindFavoritesGroupInteractions();
    bindNavToolCtx();
    bindNavStripWheelScroll(recentList);
    recentToggle?.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      openRecentDialog();
    });
    recentDlgClose?.addEventListener("click", () => closeRecentDialog());
    recentDlg?.addEventListener("cancel", (e) => {
      e.preventDefault();
      closeRecentDialog();
    });
    recentDlg?.addEventListener("click", (e) => {
      if (e.target === recentDlg) closeRecentDialog();
    });
    syncSortHint();
    scheduleBootRoute();
  }

  function allNavGroups() {
    const list = navEl ? [...$$(".nav-group", navEl)] : [];
    if (favoritesWrap?.classList.contains("nav-group")) list.unshift(favoritesWrap);
    return list;
  }

  function navFlyoutScroller(wrap) {
    if (wrap && navEl?.contains(wrap)) return navEl;
    return navBar || wrap;
  }

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

  function isMobileDrawer() {
    return !canDesktopDrag();
  }

  function showMobileSortHandles() {
    return false;
  }

  function toolName(id) {
    return TOOL_META[id]?.name || id;
  }

  function sanitizeToolIds(raw) {
    const seen = new Set();
    const out = [];
    (Array.isArray(raw) ? raw : []).forEach((id) => {
      const expanded =
        id === "media" ? LEGACY_MEDIA_TOOLS.slice() : [id];
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

  function currentNavToolId() {
    return currentTool;
  }

  function groupToolsForSubnav(groupId) {
    const group = GROUP_BY_ID[groupId];
    if (!group) return [];
    const order = loadOrder();
    return order.filter((id) => group.tools.includes(id) && isNavToolVisible(id));
  }

  function shouldShowCategorySubnav(groupId, tools) {
    if (!groupId || tools.length < 2) return false;
    // 窄屏/抽屉导航时用侧栏切换，顶部分类条占纵向空间
    if (isMobileDrawer()) return false;
    if (navCompactActive()) return true;
    return GROUPS_WITH_ALWAYS_SUBNAV.has(groupId);
  }

  function renderCategorySubnav() {
    if (!categorySubnav) return;
    const groupId = TOOL_TO_GROUP[currentTool];
    const group = GROUP_BY_ID[groupId];
    const tools = groupToolsForSubnav(groupId);
    const show = shouldShowCategorySubnav(groupId, tools);
    categorySubnav.hidden = !show;
    if (!show) {
      categorySubnav.innerHTML = "";
      categorySubnav.removeAttribute("aria-label");
      return;
    }
    categorySubnav.setAttribute("aria-label", `${group?.label || "分类"}内工具`);
    categorySubnav.innerHTML = "";
    tools.forEach((id) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "category-tab media-tab";
      btn.dataset.categoryTab = id;
      btn.setAttribute("role", "tab");
      btn.id = `category-tab-${id}`;
      btn.setAttribute("aria-controls", id);
      const on = id === currentTool;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.tabIndex = on ? 0 : -1;
      btn.textContent = toolName(id);
      categorySubnav.appendChild(btn);
    });
    bindNavStripWheelScroll(categorySubnav);
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

  /** 「仅显示分类」：点击分类在下方展开工具；搜索时仍平铺全部匹配项 */
  function navCompactActive() {
    return navCompact;
  }

  function canHoverNavFlyout() {
    return false;
  }

  function navFlyoutPanel(wrap) {
    return wrap?.querySelector?.(".nav-group-tools");
  }

  function resetNavFlyoutPanel(panel) {
    if (!panel) return;
    panel.classList.remove("is-flyout-fixed");
    panel.style.position = "";
    panel.style.zIndex = "";
    panel.style.left = "";
    panel.style.right = "";
    panel.style.top = "";
    panel.style.bottom = "";
    panel.style.width = "";
    panel.style.maxHeight = "";
  }

  function positionNavFlyout(wrap) {
    const panel = navFlyoutPanel(wrap);
    if (!panel) return;
    resetNavFlyoutPanel(panel);
  }

  function closeNavFlyouts({ keepPinned = false } = {}) {
    window.clearTimeout(navFlyoutTimer);
    navFlyoutTimer = 0;
    allNavGroups().forEach((g) => {
      if (keepPinned && g.classList.contains("is-pinned")) {
        g.classList.remove("is-flyout-up", "is-flyout-left");
        g.querySelector(".nav-group-title, .nav-fav-title")?.setAttribute("aria-expanded", "true");
        return;
      }
      g.classList.remove("is-flyout-open", "is-flyout-up", "is-flyout-left");
      if (!keepPinned) g.classList.remove("is-pinned");
      g.querySelector(".nav-group-title, .nav-fav-title")?.setAttribute("aria-expanded", "false");
      resetNavFlyoutPanel(navFlyoutPanel(g));
    });
  }

  function openNavFlyout(wrap, { pin = false } = {}) {
    if (!wrap || !navCompactActive() || compactNavSearching()) return;
    window.clearTimeout(navFlyoutTimer);
    navFlyoutTimer = 0;
    allNavGroups().forEach((g) => {
      if (g === wrap) return;
      g.classList.remove("is-flyout-open", "is-flyout-up", "is-flyout-left", "is-pinned");
      g.querySelector(".nav-group-title, .nav-fav-title")?.setAttribute("aria-expanded", "false");
      resetNavFlyoutPanel(navFlyoutPanel(g));
    });
    if (pin) wrap.classList.add("is-pinned");
    wrap.classList.add("is-flyout-open");
    wrap.querySelector(".nav-group-title, .nav-fav-title")?.setAttribute("aria-expanded", "true");
    positionNavFlyout(wrap);
    if (pin && wrap.scrollIntoView) {
      requestAnimationFrame(() => {
        try {
          wrap.scrollIntoView({ block: "nearest", inline: "nearest" });
        } catch (_) {}
      });
    }
  }

  function scheduleCloseNavFlyout(wrap) {
    if (document.body.classList.contains("nav-sorting-tools")) return;
    window.clearTimeout(navFlyoutTimer);
    navFlyoutTimer = window.setTimeout(() => {
      navFlyoutTimer = 0;
      if (!wrap || wrap.classList.contains("is-pinned")) return;
      if (document.body.classList.contains("nav-sorting-tools")) return;
      wrap.classList.remove("is-flyout-open");
      wrap.querySelector(".nav-group-title, .nav-fav-title")?.setAttribute("aria-expanded", "false");
      resetNavFlyoutPanel(navFlyoutPanel(wrap));
    }, 200);
  }

  function bindNavFlyoutPanelHover() {}

  function isNavToolSorting() {
    return document.body.classList.contains("nav-sorting-tools") || dragPayload?.kind === "tool";
  }

  function clearSortFlyouts() {
    if (!navEl) return;
    $$(".nav-group.is-sort-flyout", navEl).forEach((g) => {
      g.classList.remove("is-sort-flyout");
      if (!g.classList.contains("is-pinned")) {
        g.classList.remove("is-flyout-open", "is-flyout-up", "is-flyout-left");
        g.querySelector(".nav-group-title, .nav-fav-title")?.setAttribute("aria-expanded", "false");
        resetNavFlyoutPanel(navFlyoutPanel(g));
      }
    });
  }

  function beginNavToolSort(wrap) {
    document.body.classList.add("nav-sorting-tools");
    window.clearTimeout(navFlyoutTimer);
    navFlyoutTimer = 0;
    if (wrap && navCompactActive() && !compactNavSearching()) {
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
    if (!wrap || !navCompactActive() || compactNavSearching()) return;
    if (!document.body.classList.contains("nav-sorting-tools")) return;
    window.clearTimeout(navFlyoutTimer);
    wrap.classList.add("is-flyout-open", "is-sort-flyout");
    wrap.querySelector(".nav-group-title")?.setAttribute("aria-expanded", "true");
    positionNavFlyout(wrap);
  }

  function syncNavCompactUi() {
    if (!navBar) return;
    const compactUi = navCompactActive();
    navBar.classList.toggle("is-compact", compactUi);
    const searching = compactNavSearching();
    navBar.classList.toggle("is-searching", searching);
    const compactToggle = $("#nav-compact");
    if (compactToggle) compactToggle.checked = navCompact;
    if (!navEl) return;
    if (!compactUi || searching) closeNavFlyouts();
    const currentId = currentNavToolId();
    allNavGroups().forEach((g) => {
      const ids = [...g.querySelectorAll(".tool-nav-link")].map((a) => a.dataset.tool);
      const isCurrent = ids.includes(currentId);
      g.classList.toggle("is-current", isCurrent);
      const title = g.querySelector(".nav-group-title");
      if (title) {
        const open = g.classList.contains("is-pinned") || g.classList.contains("is-flyout-open");
        title.setAttribute("aria-expanded", compactUi && !searching ? (open ? "true" : "false") : "true");
      }
    });
    syncNavSortDragMode();
  }

  function setNavCompact(on) {
    navCompact = Boolean(on);
    try {
      localStorage.setItem(NAV_COMPACT_KEY, navCompact ? "1" : "0");
    } catch (_) {}
    allNavGroups().forEach((g) => g.classList.remove("is-pinned"));
    syncNavCompactUi();
    renderCategorySubnav();
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
    document.body.classList.remove("nav-tool-ctx-open");
    document.removeEventListener("selectionchange", clearNavTextSelection);
  }

  function showNavToolCtx(x, y, toolId) {
    if (!navToolCtx || !toolId || !DEFAULT_ORDER.includes(toolId)) return;
    if (navToolCtx.parentElement !== document.body) document.body.appendChild(navToolCtx);
    clearNavTextSelection();
    document.body.classList.add("nav-tool-ctx-open");
    document.addEventListener("selectionchange", clearNavTextSelection);
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
    return `#${id}`;
  }

  function pushRecent(id) {
    if (!DEFAULT_ORDER.includes(id)) return;
    const next = [id, ...loadRecent().filter((x) => x !== id)];
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    // 占位路由上的默认 timestamp 不应覆盖已保存的上次工具（手机冷启动常见）
    if (!(id === "timestamp" && shouldRestoreLastTool())) saveLastTool(id);
    renderRecent();
  }

  function lastToolHash() {
    return toolIdToHash(loadLastToolId());
  }

  function routeFromToolId(id) {
    if (!id) return { tool: "timestamp" };
    if (HASH_ALIASES[id]) return { ...HASH_ALIASES[id] };
    if (DEFAULT_ORDER.includes(id)) return { tool: id };
    return { tool: "timestamp" };
  }

  function activeToolIdFromRoute(route) {
    if (!route) return "timestamp";
    if (route.tool === "media") return route.tab || "gifmaker";
    return route.tool || "timestamp";
  }

  function navToolIdForSave(tool, tab, nextTool, nextTab) {
    if (nextTool === "media") return nextTab || tab || "gifmaker";
    return nextTool || tool;
  }

  function persistActiveTool(route) {
    const id = activeToolIdFromRoute(route || { tool: currentTool });
    if (!id) return;
    if (id === "timestamp" && shouldRestoreLastTool()) return;
    saveLastTool(id);
  }

  /** iOS PWA / Safari 冷启动常带 #timestamp、空 hash 或裸 #media，在此类占位路由上恢复上次工具 */
  function shouldRestoreLastTool() {
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
    if (!shouldRestoreLastTool()) return false;
    const saved = loadLastToolId();
    if (!saved || saved === "timestamp") return false;
    const route = routeFromToolId(saved);
    const target = routeHash(activeToolIdFromRoute(route));
    const raw = String(location.hash || "").replace(/^#/, "").trim();
    const q = raw.indexOf("?");
    const path = q >= 0 ? raw.slice(0, q) : raw;
    if (`#${path}` !== target) history.replaceState(null, "", target);
    return true;
  }

  function bootRoute() {
    restoreLastToolOnStartup();
    applyRoute({ skipRecent: bootPasses > 0, deferAssets: true });
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
    if (el) el.hidden = true;
    return false;
  }

  function getNavLinks() {
    return $$(".tool-nav-link", navEl);
  }

  function createNavSortHandle({ kind, id, wrap }) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "nav-sort-handle";
    btn.textContent = "⠿";
    btn.setAttribute(
      "aria-label",
      kind === "group" ? "长按拖动排序分类" : kind === "favorite" ? "长按拖动排序常用工具" : "长按拖动排序工具"
    );
    btn.title =
      kind === "group" ? "长按后拖动排序分类" : kind === "favorite" ? "长按后拖动排序常用工具" : "长按后拖动排序工具";
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    bindMobileSortPress(btn, { kind, id, handle: btn, wrap, fromHandle: true });
    return btn;
  }

  function clearNavTextSelection() {
    try {
      const sel = window.getSelection?.();
      if (sel?.rangeCount) sel.removeAllRanges();
    } catch (_) {}
  }

  let navSelectBlockDepth = 0;
  let navSelectBlockHandler = null;

  function pushNavSelectBlock() {
    if (!navSelectBlockHandler) {
      navSelectBlockHandler = (e) => {
        if (e.target?.closest?.(".tool-nav-link, .nav-fav-link, .nav-group-title, .nav-recent-chip")) {
          e.preventDefault();
        }
      };
    }
    navSelectBlockDepth += 1;
    if (navSelectBlockDepth === 1) {
      document.addEventListener("selectstart", navSelectBlockHandler, true);
    }
  }

  function popNavSelectBlock() {
    if (navSelectBlockDepth <= 0) return;
    navSelectBlockDepth -= 1;
    if (navSelectBlockDepth === 0 && navSelectBlockHandler) {
      document.removeEventListener("selectstart", navSelectBlockHandler, true);
    }
  }

  function bindNavLinkNoNativeSelect(link) {
    if (!link || link.dataset.noNativeSelect === "1") return;
    link.dataset.noNativeSelect = "1";
    link.addEventListener("selectstart", (e) => e.preventDefault());
    link.addEventListener("contextmenu", (e) => {
      if (!canDesktopDrag()) e.preventDefault();
    });
  }

  function bindMobileToolCtxPress(link) {
    if (!link || link.dataset.boundMobileCtx === "1" || canDesktopDrag()) return;
    link.dataset.boundMobileCtx = "1";
    bindNavLinkNoNativeSelect(link);
    const LONG_MS = 480;
    const CANCEL_PX = 14;
    let timer = 0;
    let pointerId = null;
    let startX = 0;
    let startY = 0;

    const clearTimer = () => {
      if (timer) {
        clearTimeout(timer);
        timer = 0;
      }
    };

    const releasePress = () => {
      clearTimer();
      pointerId = null;
      popNavSelectBlock();
    };

    link.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      if (navSortInteractionActive()) return;
      pointerId = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      clearTimer();
      pushNavSelectBlock();
      clearNavTextSelection();
      timer = window.setTimeout(() => {
        timer = 0;
        const id = link.dataset.tool;
        if (!id) return;
        clearNavTextSelection();
        hideNavToolCtx();
        showNavToolCtx(startX, startY, id);
        navSortClickSuppressUntil = Date.now() + 520;
        try {
          link.setPointerCapture?.(pointerId);
        } catch (_) {}
        try {
          navigator.vibrate?.(10);
        } catch (_) {}
      }, LONG_MS);
    });

    const cancel = (e) => {
      if (pointerId == null || e.pointerId !== pointerId) return;
      try {
        if (link.hasPointerCapture?.(pointerId)) link.releasePointerCapture(pointerId);
      } catch (_) {}
      releasePress();
    };

    link.addEventListener("pointermove", (e) => {
      if (e.pointerId !== pointerId || !timer) return;
      const dx = Math.abs(e.clientX - startX);
      const dy = Math.abs(e.clientY - startY);
      if (dx + dy > CANCEL_PX) cancel(e);
    });
    link.addEventListener("pointerup", cancel);
    link.addEventListener("pointercancel", cancel);
  }

  const navVirtualLists = [];

  function appendToolNavLink(toolsWrap, id, { allowHtml5Drag, groupWrap, enableDrag = true }) {
    if (!isNavToolVisible(id)) return null;
    const a = document.createElement("a");
    a.className = "tool-nav-link";
    a.href = `#${id}`;
    a.dataset.tool = id;
    a.draggable = enableDrag && allowHtml5Drag;
    a.title = enableDrag ? navToolSortHint() : toolName(id);
    a.textContent = toolName(id);
    if (showMobileSortHandles()) {
      const row = document.createElement("div");
      row.className = "tool-nav-row";
      row.dataset.tool = id;
      row.appendChild(createNavSortHandle({ kind: "tool", id, wrap: groupWrap }));
      row.appendChild(a);
      toolsWrap.appendChild(row);
      return row;
    }
    toolsWrap.appendChild(a);
    return a;
  }

  function renderNav(order, opts = {}) {
    if (!navEl) return;
    navVirtualLists.forEach((v) => v.destroy?.());
    navVirtualLists.length = 0;
    const list = order || loadOrder();
    const allowHtml5Drag = allowNavHtml5Drag();
    const skipVirtual = Boolean(opts.skipVirtual || String(toolSearch?.value || "").trim());
    navEl.innerHTML = "";
    navEl.classList.toggle("nav-is-scalable", list.length >= NAV_SCALABLE_MIN_TOOLS);
    groupsInOrder().forEach((group) => {
      const tools = list.filter((id) => group.tools.includes(id));
      if (!tools.length) return;
      const wrap = document.createElement("div");
      wrap.className = "nav-group";
      wrap.dataset.group = group.id;
      const head = document.createElement("div");
      head.className = "nav-group-head";
      if (showMobileSortHandles()) {
        head.appendChild(createNavSortHandle({ kind: "group", id: group.id, wrap }));
      }
      const title = document.createElement("p");
      title.className = "nav-group-title is-sortable";
      title.textContent = group.label;
      title.setAttribute("aria-expanded", "true");
      title.draggable = allowHtml5Drag;
      title.title = navGroupSortHint();
      head.appendChild(title);
      wrap.appendChild(head);
      const toolsWrap = document.createElement("div");
      toolsWrap.className = "nav-group-tools";
      const visibleTools = tools.filter((id) => isNavToolVisible(id));
      const useVirtual =
        !skipVirtual &&
        NAV_SCALE.mountGroupVirtualList &&
        visibleTools.length >= NAV_VIRTUAL_GROUP_MIN &&
        !showMobileSortHandles();
      if (useVirtual) {
        const mount = NAV_SCALE.mountGroupVirtualList(
          toolsWrap,
          visibleTools,
          (id) => {
            const shell = document.createElement("div");
            shell.className = "nav-virtual-row";
            shell.dataset.tool = id;
            const a = document.createElement("a");
            a.className = "tool-nav-link";
            a.href = `#${id}`;
            a.dataset.tool = id;
            a.draggable = false;
            a.textContent = toolName(id);
            shell.appendChild(a);
            return shell;
          },
          { minItems: NAV_VIRTUAL_GROUP_MIN }
        );
        if (mount) navVirtualLists.push(mount);
        else visibleTools.forEach((id) => appendToolNavLink(toolsWrap, id, { allowHtml5Drag, groupWrap: wrap }));
      } else {
        visibleTools.forEach((id) => appendToolNavLink(toolsWrap, id, { allowHtml5Drag, groupWrap: wrap }));
      }
      wrap.appendChild(toolsWrap);
      bindNavGroupToolsWheelScroll(toolsWrap);
      if (![...wrap.querySelectorAll(".tool-nav-link")].length) return;
      navEl.appendChild(wrap);
    });
    bindNavInteractions();
    if (!opts.skipFilter) applySearchFilter(toolSearch?.value || "");
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

  /** 紧凑模式展开的工具列表：自身不可滚时把滚轮交给侧栏 scroll 容器 */
  function bindNavGroupToolsWheelScroll(panel) {
    if (!panel || panel.dataset.wheelNavBound === "1") return;
    panel.dataset.wheelNavBound = "1";
    panel.addEventListener(
      "wheel",
      (e) => {
        const scroller = navBarScroll || navBar;
        if (!scroller) return;
        const canSelf =
          panel.scrollHeight > panel.clientHeight + 1 &&
          getComputedStyle(panel).overflowY !== "visible";
        if (canSelf) {
          const atTop = panel.scrollTop <= 0;
          const atBottom = panel.scrollTop + panel.clientHeight >= panel.scrollHeight - 1;
          if ((e.deltaY < 0 && !atTop) || (e.deltaY > 0 && !atBottom)) return;
        }
        if (scroller.scrollHeight <= scroller.clientHeight + 1) return;
        scroller.scrollTop += e.deltaY;
        e.preventDefault();
      },
      { passive: false }
    );
  }

  function syncRecentOpenUi() {
    if (!recentToggle) return;
    recentToggle.setAttribute("aria-expanded", recentOpen ? "true" : "false");
    recentToggle.classList.toggle("is-open", recentOpen);
  }

  function closeRecentDialog() {
    recentOpen = false;
    syncRecentOpenUi();
    if (typeof recentDlg?.close === "function") recentDlg.close();
    else recentDlg?.removeAttribute("open");
    document.body.classList.remove("nav-recent-dlg-open");
  }

  function renderRecentDialogList() {
    if (!recentDlgList) return;
    recentDlgList.innerHTML = "";
    const items = loadRecent().filter((id) => isNavToolVisible(id));
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "hint tight nav-recent-dlg-empty";
      empty.textContent = "还没有最近使用的工具";
      recentDlgList.appendChild(empty);
      return;
    }
    items.forEach((id) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nav-recent-dlg-item";
      btn.setAttribute("role", "listitem");
      btn.textContent = toolName(id);
      btn.addEventListener("click", () => {
        closeRecentDialog();
        navigateTo(id);
        if (isMobileDrawer()) setDrawerOpen(false);
      });
      btn.addEventListener("contextmenu", (e) => {
        if (!canDesktopDrag()) {
          e.preventDefault();
          return;
        }
        e.preventDefault();
        hideNavToolCtx();
        showNavToolCtx(e.clientX, e.clientY, id);
      });
      recentDlgList.appendChild(btn);
    });
  }

  function openRecentDialog() {
    if (!recentDlg) return;
    renderRecentDialogList();
    recentOpen = true;
    syncRecentOpenUi();
    if (typeof recentDlg.showModal === "function") recentDlg.showModal();
    else recentDlg.setAttribute("open", "");
    document.body.classList.add("nav-recent-dlg-open");
  }

  function setRecentOpen(open) {
    if (open) openRecentDialog();
    else closeRecentDialog();
  }

  function renderRecent() {
    if (!recentWrap || !recentList) return;
    const items = loadRecent().filter((id) => isNavToolVisible(id));
    recentList.innerHTML = "";
    if (!items.length) {
      recentWrap.hidden = true;
      if (recentOpen) closeRecentDialog();
      return;
    }
    recentWrap.hidden = false;
    if (recentCount) recentCount.textContent = String(items.length);
    if (recentOpen) renderRecentDialogList();
    syncRecentOpenUi();
    items.forEach((id) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nav-recent-chip";
      btn.setAttribute("role", "listitem");
      btn.textContent = toolName(id);
      btn.addEventListener("click", () => {
        navigateTo(id);
        if (isMobileDrawer()) setDrawerOpen(false);
      });
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
    const allowHtml5Drag = allowNavHtml5Drag();
    favoritesList.innerHTML = "";
    items.forEach((id) => {
      if (!isNavToolVisible(id)) return;
      const link = document.createElement("a");
      link.className = "tool-nav-link nav-fav-link is-sortable";
      link.href = `#${id}`;
      link.dataset.tool = id;
      link.draggable = allowHtml5Drag;
      link.title = allowHtml5Drag ? "拖动排序；右键更多操作" : navFavSortHint();
      link.textContent = toolName(id);
      link.setAttribute("role", "listitem");
      if (showMobileSortHandles()) {
        const row = document.createElement("div");
        row.className = "tool-nav-row";
        row.appendChild(createNavSortHandle({ kind: "favorite", id, wrap: favoritesList }));
        row.appendChild(link);
        favoritesList.appendChild(row);
      } else {
        favoritesList.appendChild(link);
      }
    });
    bindFavoriteInteractions();
    bindNavGroupToolsWheelScroll(favoritesList);
    syncNavCompactUi();
    syncNavSortDragMode();
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

  function bindFavoritesGroupInteractions() {
    if (!favoritesWrap || favoritesWrap.dataset.boundFavGroup === "1") return;
    favoritesWrap.dataset.boundFavGroup = "1";
    const title = favTitle;
    if (!title) return;
    title.addEventListener("click", (e) => {
      if (!navCompactActive() || didDrag || compactNavSearching() || shouldSuppressNavCompactClick()) return;
      e.preventDefault();
      const willPin = !favoritesWrap.classList.contains("is-pinned");
      if (willPin) openNavFlyout(favoritesWrap, { pin: true });
      else {
        favoritesWrap.classList.remove("is-pinned", "is-flyout-open");
        title.setAttribute("aria-expanded", "false");
        resetNavFlyoutPanel(navFlyoutPanel(favoritesWrap));
      }
    });
    favoritesWrap.addEventListener("focusin", () => {
      if (!navCompactActive() || compactNavSearching() || navSortInteractionActive()) return;
      openNavFlyout(favoritesWrap, { pin: true });
    });
    favoritesWrap.addEventListener("focusout", (e) => {
      if (!navCompactActive() || compactNavSearching()) return;
      if (favoritesWrap.classList.contains("is-pinned")) return;
      if (isNavToolSorting()) return;
      const next = e.relatedTarget;
      if (next && favoritesWrap.contains(next)) return;
      scheduleCloseNavFlyout(favoritesWrap);
    });
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
      bindMobileToolCtxPress(link);
      link.addEventListener("contextmenu", (e) => {
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
    if (!raw) return { tool: "timestamp" };
    const parts = raw.split(/[/?]/).filter(Boolean);
    const head = parts[0] || "timestamp";
    if (HASH_ALIASES[head]) return { ...HASH_ALIASES[head] };
    if (head === "media") {
      if (parts[1] === "vbb") return { tool: "vbb" };
      const tab = parts[1];
      if (tab && DEFAULT_ORDER.includes(tab)) return { tool: tab };
      return { tool: "gifmaker" };
    }
    if (DEFAULT_ORDER.includes(head)) return { tool: head };
    return { tool: "timestamp" };
  }

  function routeHash(tool) {
    return `#${tool || "timestamp"}`;
  }

  function shareToolUrl() {
    try {
      const u = new URL(location.href);
      u.search = "";
      const raw = String(location.hash || "")
        .replace(/^#/, "")
        .trim();
      const head = raw.split(/[/?]/)[0];
      if (head === "lanshare" && raw.includes("?")) u.hash = raw;
      else u.hash = routeHash(currentTool).replace(/^#/, "");
      return u.toString();
    } catch (_) {
      return `${location.origin}${location.pathname || "/"}${routeHash(currentTool)}`;
    }
  }

  function activeToolShareTitle() {
    if (currentTool === "about") return "DevTools · 本地实用小工具合集";
    return `${toolName(currentTool)} · DevTools`;
  }

  async function copyTextFallback(text) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_) {}
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch (_) {
      return false;
    }
  }

  async function shareCurrentTool() {
    const url = shareToolUrl();
    const name = toolName(currentTool);
    const title = activeToolShareTitle();
    const text = `打开 DevTools「${name}」：`;
    const clip = `${title}\n${url}`;
    const prevTitle = document.title;
    document.title = title;
    const restoreTitle = () => {
      try {
        document.title = prevTitle;
      } catch (_) {}
    };

    // 电脑端系统分享基本无用：直接复制标题+链接并提示
    if (!isPhoneLikeClient()) {
      restoreTitle();
      if (await copyTextFallback(clip)) showToast("已复制标题和链接到剪贴板");
      else showToast("复制失败，请手动复制地址栏链接");
      return;
    }

    if (typeof navigator.share === "function") {
      const data = { title, text, url };
      try {
        if (!navigator.canShare || navigator.canShare(data)) {
          await navigator.share(data);
          restoreTitle();
          showToast("已打开系统分享");
          return;
        }
      } catch (err) {
        if (err && (err.name === "AbortError" || /abort|cancel|取消/i.test(String(err.message || "")))) {
          restoreTitle();
          return;
        }
        try {
          await navigator.share({ title, text: `${text}\n${url}` });
          restoreTitle();
          showToast("已打开系统分享");
          return;
        } catch (err2) {
          if (err2 && (err2.name === "AbortError" || /abort|cancel|取消/i.test(String(err2.message || "")))) {
            restoreTitle();
            return;
          }
        }
      }
    }

    restoreTitle();
    if (await copyTextFallback(clip)) showToast("已复制标题和链接到剪贴板");
    else showToast("复制失败，请手动复制地址栏链接");
  }

  function setHeaderMoreOpen(open) {
    if (!headerMoreMenu) return;
    const want = Boolean(open);
    headerMoreMenu.hidden = !want;
    headerMoreToggle?.setAttribute("aria-expanded", want ? "true" : "false");
  }

  let routeGen = 0;
  let toolLoadGen = 0;
  let toolLoadPanelId = "";

  function mountToolLoadBar(toolId) {
    const shell = document.getElementById("devtools-tool-load");
    const panel = document.getElementById(toolId);
    if (!shell || !panel) return;
    const head = panel.querySelector(".panel-head");
    if (head?.nextElementSibling === shell) return;
    if (head) head.insertAdjacentElement("afterend", shell);
    else panel.prepend(shell);
  }

  function setPanelAssetLoading(toolId, loading) {
    const panel = document.getElementById(toolId);
    if (!panel) return;
    panel.classList.toggle("is-tool-assets-loading", loading);
    if (loading) panel.setAttribute("aria-busy", "true");
    else panel.removeAttribute("aria-busy");
  }

  function setToolLoadProgress(pct, label, gen = toolLoadGen) {
    if (gen !== toolLoadGen) return;
    const shell = document.getElementById("devtools-tool-load");
    const fill = shell?.querySelector(".devtools-tool-load-fill");
    const bar = shell?.querySelector(".workspace-panel-load-bar");
    const labelEl = document.getElementById("devtools-tool-load-label");
    if (!shell || !fill) return;
    if (toolLoadPanelId) {
      mountToolLoadBar(toolLoadPanelId);
      setPanelAssetLoading(toolLoadPanelId, true);
    }
    const v = Math.min(100, Math.max(0, pct));
    shell.hidden = false;
    shell.setAttribute("aria-hidden", "false");
    shell.setAttribute("aria-busy", "true");
    if (bar) bar.setAttribute("aria-valuenow", String(Math.round(v)));
    fill.style.width = `${v}%`;
    if (labelEl) {
      const text = String(label || "").trim();
      if (text) {
        labelEl.hidden = false;
        labelEl.textContent = text;
      }
    }
  }

  function hideToolLoadProgress(gen = toolLoadGen) {
    if (gen !== toolLoadGen) return;
    const shell = document.getElementById("devtools-tool-load");
    const fill = shell?.querySelector(".devtools-tool-load-fill");
    const bar = shell?.querySelector(".workspace-panel-load-bar");
    const labelEl = document.getElementById("devtools-tool-load-label");
    if (toolLoadPanelId) setPanelAssetLoading(toolLoadPanelId, false);
    if (!shell) return;
    shell.hidden = true;
    shell.setAttribute("aria-hidden", "true");
    shell.setAttribute("aria-busy", "false");
    if (bar) bar.setAttribute("aria-valuenow", "0");
    if (fill) fill.style.width = "0%";
    if (labelEl) {
      labelEl.hidden = true;
      labelEl.textContent = "";
    }
  }

  function mapLazyLoadProgress(ratio, label, onProgress) {
    const pct = 12 + Math.max(0, Math.min(1, Number(ratio) || 0)) * 80;
    onProgress?.(pct, label);
  }

  async function ensureToolAssets(toolId, onProgress) {
    await window.DevToolsLazy?.ensureForTool?.(toolId, {
      onProgress: (ratio, label) => mapLazyLoadProgress(ratio, label, onProgress),
    });
  }

  function markShellBootReady() {
    if (window.__devtoolsBootReady) return;
    window.__devtoolsBootReady = true;
    window.DevToolsBoot?.bump?.(88, "界面就绪…");
    window.dispatchEvent(new CustomEvent("devtools:boot-ready"));
    idleLoadPwaOnce();
    scheduleDateremindReminders();
  }

  function startToolAssetLoad(gen, toolId) {
    const loadGen = ++toolLoadGen;
    toolLoadPanelId = String(toolId || "").trim();
    const name = toolName(toolId);
    let overlayShown = false;
    if (gen === routeGen) setPanelAssetLoading(toolLoadPanelId, true);
    const showDelay = window.setTimeout(() => {
      if (gen !== routeGen) return;
      overlayShown = true;
      setToolLoadProgress(12, `正在加载「${name}」…`, loadGen);
    }, 140);

    void (async () => {
      try {
        await ensureToolAssets(toolId, (pct, label) => {
          if (gen !== routeGen) return;
          if (!overlayShown) {
            window.clearTimeout(showDelay);
            overlayShown = true;
          }
          setToolLoadProgress(pct, label || `正在加载「${name}」…`, loadGen);
        });
      } catch (err) {
        console.error("tool lazy-load failed", toolId, err);
        if (gen === routeGen) {
          showToast(`「${name}」加载失败，可切换其他工具或稍后重试`);
          setPanelAssetLoading(toolLoadPanelId, false);
        }
        return;
      } finally {
        window.clearTimeout(showDelay);
      }

      if (gen !== routeGen) {
        if (loadGen === toolLoadGen) setPanelAssetLoading(toolLoadPanelId, false);
        return;
      }

      window.dispatchEvent(
        new CustomEvent("devtools:route", {
          detail: { tool: currentTool, groupId: TOOL_TO_GROUP[currentTool] || null },
        })
      );

      if (gen === routeGen) setPanelAssetLoading(toolLoadPanelId, false);

      if (!overlayShown) return;

      setToolLoadProgress(100, `${name} 已就绪`, loadGen);
      window.setTimeout(() => {
        if (gen === routeGen && loadGen === toolLoadGen) hideToolLoadProgress(loadGen);
      }, 220);
    })();
  }

  let dateremindIdleScheduled = false;
  function scheduleDateremindReminders() {
    if (dateremindIdleScheduled) return;
    dateremindIdleScheduled = true;
    const idle = window.requestIdleCallback || ((cb) => window.setTimeout(cb, 2500));
    idle(() => {
      window.DevToolsLazy?.ensureForTool?.("dateremind")
        .then(() => {
          window.DevToolsDateRemind?.checkOnVisit?.();
        })
        .catch(() => {});
    });
  }

  let routeSettled = Promise.resolve();

  async function applyRoute({ skipRecent, keepDrawer, deferAssets = false } = {}) {
    const gen = ++routeGen;
    const run = async () => {
    let route = parseRoute();
    if (shouldRestoreLastTool()) {
      const saved = loadLastToolId();
      if (saved && saved !== "timestamp") {
        route = routeFromToolId(saved);
        const target = routeHash(route.tool);
        const raw = String(location.hash || "").replace(/^#/, "").trim();
        const q = raw.indexOf("?");
        const path = q >= 0 ? raw.slice(0, q) : raw;
        if (`#${path}` !== target) history.replaceState(null, "", target);
      }
    }
    // 手机深链 #ffbridge / #adb → 网页视频工具，避免空白桥面板
    if (isPhoneLikeClient() && (route.tool === "ffbridge" || route.tool === "adb")) {
      const mobileTool = route.tool === "ffbridge" ? "audio" : loadLastToolId() || "gifmaker";
      route = { tool: mobileTool };
      const canonicalMobile = routeHash(route.tool);
      if (`#${String(location.hash || "").replace(/^#/, "")}` !== canonicalMobile) {
        history.replaceState(null, "", canonicalMobile);
      }
    }
    if (route.tool === "media") {
      route = { tool: route.tab || "gifmaker" };
    }
    currentTool = activeToolIdFromRoute(route);

    // 旧深链 #gifmaker / #media/... → #工具名
    const rawHash = String(location.hash || "")
      .replace(/^#/, "")
      .trim();
    const rawHead = rawHash.split(/[/?]/)[0];
    const canonical = routeHash(currentTool);
    const preserveLanshareJoin = rawHead === "lanshare" && rawHash.includes("?");
    if (/^media\/vbb\b/i.test(rawHash)) {
      if (rawHash !== "vbb") history.replaceState(null, "", "#vbb");
    } else if (rawHead === "media" && rawHash.includes("/")) {
      const legacyTab = rawHash.split("/").filter(Boolean)[1];
      const legacyTool = legacyTab && DEFAULT_ORDER.includes(legacyTab) ? legacyTab : "gifmaker";
      if (rawHash !== legacyTool) history.replaceState(null, "", routeHash(legacyTool));
      currentTool = legacyTool;
    } else if (
      !preserveLanshareJoin &&
      (HASH_ALIASES[rawHead] || (rawHead === "media" && !rawHash.includes("/")))
    ) {
      if (rawHash !== canonical.replace(/^#/, "")) {
        history.replaceState(null, "", canonical);
      }
    }

    const routeToolId = currentTool;

    try {
      await window.DevToolsPanels?.bootReady;
      window.DevToolsBoot?.bump?.(22, "加载面板…");
      await window.DevToolsPanels?.ensure?.(routeToolId);
      initCorePanel(routeToolId);
      if (window.__devtoolsExtraBundle) {
        window.DevToolsExtraBind?.bind?.(routeToolId);
      }
      bindCopyButtons(document.getElementById(routeToolId));
    } catch (err) {
      console.error("panel load failed", routeToolId, err);
      showToast(`加载「${toolName(routeToolId)}」失败，请点顶栏「强制刷新」后重试`);
    }

    $$(".tool-panel").forEach((panel) => {
      const id = panel.id;
      const active = id === currentTool;
      panel.classList.toggle("is-workspace-active", active);
      panel.hidden = !active;
      if (active) panel.removeAttribute("aria-hidden");
      else {
        panel.setAttribute("aria-hidden", "true");
        panel.classList.remove("is-tool-assets-loading");
        panel.removeAttribute("aria-busy");
      }
    });
    mountToolLoadBar(routeToolId);

    // 首屏 boot：data-boot-panel 仅用于 panel-loader 决定预拉哪个面板
    if (document.documentElement.hasAttribute("data-boot-panel")) {
      document.documentElement.removeAttribute("data-boot-panel");
    }

    renderCategorySubnav();

    const title = currentTool === "about" ? "实用小工具合集" : toolName(currentTool);
    if (workspaceTitle) workspaceTitle.textContent = title;
    document.title =
      currentTool === "about" ? "DevTools · 本地实用小工具合集" : `${title} · DevTools`;

    getNavLinks().forEach((link) => {
      const on = link.dataset.tool === currentTool;
      link.classList.toggle("is-active", on);
      link.setAttribute("aria-current", on ? "page" : "false");
    });
    $$(".nav-fav-link", favoritesList).forEach((link) => {
      const on = link.dataset.tool === currentTool;
      link.classList.toggle("is-active", on);
      link.setAttribute("aria-current", on ? "page" : "false");
    });
    closeNavFlyouts({ keepPinned: true });
    syncNavCompactUi();

    if (!skipRecent) pushRecent(currentTool);
    persistActiveTool({ tool: currentTool });
    try {
      window.DevToolsGiscus?.sync?.(currentTool);
    } catch (_) {}
    // 手机分类拖拽排序后需保持抽屉打开
    if (!keepDrawer) {
      setDrawerOpen(false);
      window.scrollTo(0, 0);
    }

    if (!window.__devtoolsShellBoot) {
      window.__devtoolsShellBoot = true;
      window.DevToolsBoot?.bump?.(48, `打开 ${toolName(routeToolId)}…`);
    }
    markShellBootReady();

    startToolAssetLoad(gen, routeToolId);
    };
    routeSettled = run().catch((err) => {
      console.error("applyRoute failed", err);
    });
    return routeSettled;
  }

  let pwaIdleScheduled = false;
  function idleLoadPwaOnce() {
    if (pwaIdleScheduled) return;
    pwaIdleScheduled = true;
    const idle = window.requestIdleCallback || ((cb) => window.setTimeout(cb, 800));
    idle(() => {
      window.DevToolsLazy?.loadPwa?.().catch(() => {});
    });
  }

  function navigateTo(tool, _tab, { replace = false } = {}) {
    let nextTool = String(tool || "").trim();
    if (!nextTool) return;
    // 手机打开本机桥/ADB：引导到网页视频能力，避免空白桥面板
    if (isPhoneLikeClient() && (nextTool === "ffbridge" || nextTool === "adb")) {
      nextTool = nextTool === "ffbridge" ? "audio" : loadLastToolId() || "gifmaker";
      replace = true;
    }
    const hash = routeHash(nextTool);
    saveLastTool(nextTool);
    const current = `#${String(location.hash || "").replace(/^#/, "")}`;
    // 每个工具独立深链，同分类切换也写入历史，便于后退/分享
    if (replace) history.replaceState(null, "", hash);
    else if (current !== hash) history.pushState(null, "", hash);
    applyRoute();
  }

  let lastNavSearchQuery = "";

  function applySearchFilter(query) {
    const q = String(query || "").trim();
    const matchSet = NAV_SCALE.matchTools ? NAV_SCALE.matchTools(NAV_SEARCH_INDEX, q) : null;
    if (q && !lastNavSearchQuery && navVirtualLists.length) {
      renderNav(loadOrder(), { skipVirtual: true, skipFilter: true });
    } else if (!q && lastNavSearchQuery) {
      lastNavSearchQuery = "";
      renderNav(loadOrder());
      return;
    }
    lastNavSearchQuery = q;
    $$(".nav-group", navEl).forEach((group) => {
      let any = false;
      $$(".tool-nav-link", group).forEach((link) => {
        const id = link.dataset.tool;
        const show = matchSet === null || matchSet.has(id);
        link.classList.toggle("is-filtered-out", !show);
        link.closest(".nav-virtual-row, .nav-nav-row")?.classList.toggle("is-filtered-out", !show);
        if (show) any = true;
      });
      group.classList.toggle("is-filtered-out", !any);
    });
    syncNavCompactUi();
  }

  const applySearchFilterDebounced =
    typeof NAV_SCALE.debounce === "function"
      ? NAV_SCALE.debounce((value) => applySearchFilter(value), NAV_SCALE.SEARCH_DEBOUNCE_MS ?? 120)
      : (value) => applySearchFilter(value);

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

  function navFavoriteAtPoint(x, y, { skipLink } = {}) {
    const stack = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
    for (const el of stack) {
      const link = el?.closest?.(".nav-fav-link");
      if (!link || !favoritesList?.contains(link)) continue;
      if (skipLink && link === skipLink) continue;
      return link;
    }
    return null;
  }

  function navGroupAtPoint(x, y, { skipGroup } = {}) {
    const stack = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
    for (const el of stack) {
      const group = el?.closest?.(".nav-group");
      if (!group || !navEl?.contains(group) || group.classList.contains("is-filtered-out")) continue;
      if (skipGroup && group === skipGroup) continue;
      return group;
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
    if (!pointerSort?.active || !navBarScroll) return;
    const dir = pointerSort.scrollDir || 0;
    const speed = pointerSort.scrollSpeed || 0;
    if (!dir || !speed) return;
    navBarScroll.scrollTop += dir * speed;
    // 滚动后按当前手指位置刷新高亮目标
    if (pointerSort.lastX != null && pointerSort.lastY != null) {
      clearNavDragStyles();
      if (pointerSort.kind === "tool") {
        pointerSort.handle?.classList.add("is-dragging");
        const group = navGroupAtPoint(pointerSort.lastX, pointerSort.lastY);
        if (group) peekNavFlyoutForSort(group);
        const target = navToolAtPoint(pointerSort.lastX, pointerSort.lastY, { skipLink: pointerSort.skipLink });
        if (target) target.classList.add("drag-over");
      } else if (pointerSort.kind === "favorite") {
        pointerSort.handle?.classList.add("is-dragging");
        const target = navFavoriteAtPoint(pointerSort.lastX, pointerSort.lastY, { skipLink: pointerSort.skipLink });
        if (target) target.classList.add("drag-over");
      } else {
        pointerSort.wrap?.classList.add("is-dragging");
        const target = navGroupAtPoint(pointerSort.lastX, pointerSort.lastY, { skipGroup: pointerSort.wrap });
        if (target) target.classList.add("drag-over");
      }
    }
    pointerSortScrollRaf = requestAnimationFrame(tickPointerSortAutoScroll);
  }

  function updatePointerSortAutoScroll(clientY, clientX) {
    if (!navBarScroll || !pointerSort?.active) {
      stopPointerSortAutoScroll();
      return;
    }
    const rect = navBarScroll.getBoundingClientRect();
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
    document.body.classList.remove("nav-sorting", "nav-sorting-tools", "nav-sorting-favorites");
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

  function navToolAtPoint(x, y, { skipLink } = {}) {
    const stack = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
    for (const el of stack) {
      const link = el?.closest?.(".tool-nav-link");
      if (!link || !navEl?.contains(link) || link.classList.contains("is-filtered-out")) continue;
      if (skipLink && link === skipLink) continue;
      return link;
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

  /** 绑定手机 ⠿ 手柄长按排序 */
  function bindMobileSortPress(el, opts) {
    if (!el || el.dataset.boundMobileSort === "1") return;
    el.dataset.boundMobileSort = "1";
    el.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      beginMobilePointerSort(e, opts);
    });
  }

  /** 手机 ⠿ 手柄长按后拖动排序 */
  function beginMobilePointerSort(e, opts) {
    if (!usePointerNavSort(e.pointerType, opts)) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (pointerSort) cancelPointerSort();
    stopPointerSortAutoScroll();

    const fromHandle = Boolean(opts.fromHandle);
    const LONG_MS = fromHandle ? 280 : navCompact ? 420 : 360;
    const CANCEL_PX = fromHandle ? 36 : 28;
    const SCROLL_SLOP_PX = 8;
    const handle = opts.handle;
    const kind = opts.kind; // group | tool | favorite
    const skipGroup = kind === "group" ? opts.wrap : null;
    const skipLink =
      kind === "tool" || kind === "favorite"
        ? opts.handle?.closest?.(".tool-nav-row")?.querySelector?.(".tool-nav-link, .nav-fav-link") || null
        : null;

    if (fromHandle && e.pointerType === "touch") e.preventDefault();

    const onMove = (ev) => {
      if (!pointerSort || pointerSort.pointerId !== ev.pointerId) return;
      const dx = Math.abs(ev.clientX - pointerSort.startX);
      const dy = Math.abs(ev.clientY - pointerSort.startY);
      if (!pointerSort.active) {
        if (!fromHandle && dy >= SCROLL_SLOP_PX && dy > dx * 1.08) {
          cancelPointerSort();
          return;
        }
        if (!fromHandle && dx + dy > CANCEL_PX) cancelPointerSort();
        return;
      }
      ev.preventDefault();
      pointerSort.lastX = ev.clientX;
      pointerSort.lastY = ev.clientY;
      clearNavDragStyles();
      if (kind === "group") {
        pointerSort.wrap?.classList.add("is-dragging");
        const target = navGroupAtPoint(ev.clientX, ev.clientY, { skipGroup: pointerSort.wrap });
        if (target) target.classList.add("drag-over");
      } else if (kind === "favorite") {
        pointerSort.handle?.classList.add("is-dragging");
        const target = navFavoriteAtPoint(ev.clientX, ev.clientY, { skipLink });
        if (target) target.classList.add("drag-over");
      } else {
        pointerSort.handle?.classList.add("is-dragging");
        const group = navGroupAtPoint(ev.clientX, ev.clientY);
        if (group) peekNavFlyoutForSort(group);
        const target = navToolAtPoint(ev.clientX, ev.clientY, { skipLink });
        if (target) target.classList.add("drag-over");
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
      const heldMs = Date.now() - (state.startTime || Date.now());
      cancelPointerSort({ keepDidDrag: wasActive });
      if (wasActive || (navCompact && heldMs >= 280)) {
        navSortClickSuppressUntil = Date.now() + 450;
      }
      if (cancelled || !wasActive) return;
      if (kind === "group") {
        const target = navGroupAtPoint(x, y, { skipGroup: state.wrap });
        commitGroupReorder(fromId, target?.dataset?.group, { keepDrawer: true });
      } else if (kind === "favorite") {
        const target = navFavoriteAtPoint(x, y, { skipLink });
        commitFavoriteReorder(fromId, target?.dataset?.tool, { keepDrawer: true });
      } else {
        const target = navToolAtPoint(x, y, { skipLink });
        commitToolReorder(fromId, target?.dataset?.tool, { keepDrawer: true });
      }
      setTimeout(() => {
        didDrag = false;
      }, 320);
    };

    const onUp = (ev) => finish(ev, false);
    const onCancel = (ev) => finish(ev, true);

    pointerSort = {
      kind,
      id: opts.id,
      wrap: opts.wrap || null,
      handle,
      skipLink,
      pointerId: e.pointerId,
      startTime: Date.now(),
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
      // 手机：长按工具名弹出常用菜单；排序仅通过 ⠿ 手柄
      bindMobileToolCtxPress(link);
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
      title.addEventListener("click", (e) => {
        if (!navCompactActive() || didDrag || compactNavSearching() || shouldSuppressNavCompactClick()) return;
        e.preventDefault();
        const willPin = !wrap.classList.contains("is-pinned");
        if (willPin) openNavFlyout(wrap, { pin: true });
        else {
          wrap.classList.remove("is-pinned", "is-flyout-open");
          title.setAttribute("aria-expanded", "false");
          resetNavFlyoutPanel(navFlyoutPanel(wrap));
        }
      });
      bindNavFlyoutPanelHover(wrap);
      wrap.addEventListener("focusin", () => {
        if (!navCompactActive() || compactNavSearching() || navSortInteractionActive()) return;
        openNavFlyout(wrap, { pin: true });
      });
      wrap.addEventListener("focusout", (e) => {
        if (!navCompactActive() || compactNavSearching()) return;
        if (wrap.classList.contains("is-pinned")) return;
        if (isNavToolSorting()) return;
        const next = e.relatedTarget;
        if (next && wrap.contains(next)) return;
        scheduleCloseNavFlyout(wrap);
      });
    });
  }

  function repositionOpenNavFlyouts() {}

  $("#nav-compact")?.addEventListener("change", (e) => {
    setNavCompact(Boolean(e.target?.checked));
  });

  navBarScroll?.addEventListener("scroll", repositionOpenNavFlyouts, { passive: true });
  navEl?.addEventListener("scroll", repositionOpenNavFlyouts, { passive: true });
  navBar?.addEventListener("scroll", repositionOpenNavFlyouts, { passive: true });
  window.addEventListener(
    "resize",
    () => {
      syncNavCompactUi();
      renderCategorySubnav();
      if (!navCompactActive()) return;
      const open = allNavGroups().find((g) => g.classList.contains("is-pinned") || g.classList.contains("is-flyout-open"));
      if (open) positionNavFlyout(open);
    },
    { passive: true }
  );

  $("#nav-reset")?.addEventListener("click", () => {
    if (!window.confirm("恢复工具与分类的默认排序？常用工具也会被清空。")) return;
    localStorage.removeItem(ORDER_KEY);
    localStorage.removeItem("devtools-tool-order-v2");
    localStorage.removeItem(GROUP_ORDER_KEY);
    localStorage.removeItem(FAVORITES_KEY);
    renderNav(DEFAULT_ORDER.slice());
    renderFavorites();
    applyRoute({ skipRecent: true });
    showToast("已恢复默认排序");
  });

  $("#nav-organize-open")?.addEventListener("click", () => {
    ensureNavOrganizeScript()
      .then(() => window.DevToolsNavOrganize?.open?.())
      .catch((err) => showToast(err?.message || "整理菜单加载失败"));
  });

  async function runForceHardRefresh() {
    const btns = [$("#site-force-refresh")].filter(Boolean);
    btns.forEach((b) => {
      b.disabled = true;
    });
    try {
      if (navigator.serviceWorker?.getRegistrations) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if (window.caches?.keys) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch (_) {}
    const url = new URL(location.href);
    url.searchParams.set("_fresh", Date.now().toString(36));
    location.replace(`${url.pathname}${url.search}${url.hash}`);
  }

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

  $("#site-force-refresh")?.addEventListener("click", () => {
    runForceHardRefresh();
  });

  headerMoreToggle?.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    setHeaderMoreOpen(headerMoreMenu?.hidden);
  });

  headerMoreMenu?.querySelectorAll("[data-header-proxy]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.preventDefault();
      setHeaderMoreOpen(false);
      const id = el.getAttribute("data-header-proxy");
      $("#" + id)?.click();
    });
  });

  headerMoreMenu?.querySelectorAll('a[role="menuitem"]').forEach((el) => {
    el.addEventListener("click", () => setHeaderMoreOpen(false));
  });

  document.addEventListener("click", (e) => {
    if (!headerMoreMenu || headerMoreMenu.hidden) return;
    if (e.target.closest(".header-more-wrap")) return;
    setHeaderMoreOpen(false);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && headerMoreMenu && !headerMoreMenu.hidden) setHeaderMoreOpen(false);
  });

  workspaceShare?.addEventListener("click", (e) => {
    e.preventDefault();
    shareCurrentTool().catch((err) => showToast(err?.message || "分享失败"));
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

  queueMicrotask(bootstrapNavShell);
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
  toolSearch?.addEventListener("input", () => applySearchFilterDebounced(toolSearch.value));
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
  categorySubnav?.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-category-tab]");
    if (!btn) return;
    navigateTo(btn.dataset.categoryTab);
  });
  categorySubnav?.addEventListener("keydown", (e) => {
    const tabs = $$(".category-tab", categorySubnav);
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
    navigateTo(tabs[next].dataset.categoryTab);
  });
  window.addEventListener("hashchange", () => {
    if (shouldRestoreLastTool()) restoreLastToolOnStartup();
    applyRoute();
  });
  window.addEventListener("popstate", () => {
    if (shouldRestoreLastTool()) restoreLastToolOnStartup();
    applyRoute();
  });
  // Safari：bfcache / 后台回收后恢复时强制关闭菜单，并重新套用路由（手机常回到 start_url）
  window.addEventListener("pageshow", () => {
    forceDrawerClosed();
    if (shouldRestoreLastTool()) restoreLastToolOnStartup();
    applyRoute({ skipRecent: true });
    window.DevToolsDateRemind?.reload?.();
    window.DevToolsDateRemind?.checkOnVisit?.();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      persistActiveTool();
      return;
    }
    forceDrawerClosed();
    if (shouldRestoreLastTool()) restoreLastToolOnStartup();
    applyRoute({ skipRecent: true });
    window.DevToolsDateRemind?.reload?.();
    window.DevToolsDateRemind?.checkOnVisit?.();
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
    const layout = $(".app-layout");
    const headerH = headerHidden || !header ? 0 : header.getBoundingClientRect().height;
    const layoutH = layout?.getBoundingClientRect().height;
    const topGap = 0.65 * 16;
    const bottomGap = 8;
    const maxH =
      layoutH && layoutH > 0
        ? Math.max(240, layoutH - topGap)
        : Math.max(240, window.innerHeight - headerH - topGap - bottomGap);
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

  if (!navShellBootstrapped) bootstrapNavShell();

  window.DevToolsCatalog = {
    groups: TOOL_GROUPS,
    meta: TOOL_META,
    about: ABOUT_DESC,
    legacyMediaTools: LEGACY_MEDIA_TOOLS,
  };
  window.DevToolsNav = {
    isCompact: () => navCompact,
    setCompact: (on) => setNavCompact(on),
    lastToolHash,
    shouldRestoreLastTool,
    restoreLastToolOnStartup,
    whenRouteSettled: () => routeSettled,
    syncSortHint,
    openFlyout: (el, opts) => openNavFlyout(el?.closest?.(".nav-group") || el, opts),
    closeFlyouts: () => closeNavFlyouts(),
    renderRecent,
    openRecentDialog,
    closeRecentDialog,
    setRecentOpen,
    isRecentOpen: () => recentOpen,
    renderFavorites,
    addFavorite,
    removeFavorite,
    loadFavorites,
    saveFavorites,
    loadOrder,
    saveOrder,
    loadGroupOrder,
    saveGroupOrder,
    refreshNav: () => {
      renderNav(loadOrder());
      renderFavorites();
      renderRecent();
      syncNavCompactUi();
    },
    toolName,
    isNavToolVisible,
    toolGroupId: (id) => TOOL_TO_GROUP[id],
    groupLabel: (gid) => GROUP_BY_ID[gid]?.label || gid,
    GROUP_BY_ID,
    TOOL_TO_GROUP,
    DEFAULT_GROUP_ORDER,
    DEFAULT_ORDER,
    isDesktopChromeHidden: () => desktopChromeHidden,
    setDesktopChromeHidden: (on) => applyDesktopChromeHidden(Boolean(on)),
    toggleDesktopChrome,
  };
  window.dispatchEvent(new CustomEvent("devtools:catalog"));
  window.DevToolsTemp?.refresh?.();
})();
