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
    const alpha = +(a / 255).toFixed(4);
    const css = `rgba(${r}, ${g}, ${b}, ${alpha})`;
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

      numA.value = String(a);
      numR.value = String(r);
      numG.value = String(g);
      numB.value = String(b);

      numOpacity.value = String(Math.round((a / 255) * 1000) / 10);
      editR.value = String(r);
      editG.value = String(g);
      editB.value = String(b);
      editHex.value = `#${toHex2(r)}${toHex2(g)}${toHex2(b)}`;

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
    const pct = Number(numOpacity.value);
    if (!Number.isFinite(pct)) return;
    const a = clampByte((Math.min(100, Math.max(0, pct)) / 100) * 255);
    if (a === null) return;
    applyColor({ ...color, a });
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

  // ---- Copy / nav ----
  $$("[data-copy]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = document.getElementById(btn.dataset.copy);
      if (target?.textContent) copyText(target.textContent);
    });
  });

  const navLinks = $$(".tool-nav-link");
  const sections = ["timestamp", "ahex", "coming"].map((id) => document.getElementById(id));

  function syncNav() {
    const y = window.scrollY + 120;
    let current = sections[0]?.id;
    for (const section of sections) {
      if (section && section.offsetTop <= y) current = section.id;
    }
    navLinks.forEach((link) => {
      link.classList.toggle("is-active", link.getAttribute("href") === `#${current}`);
    });
  }

  window.addEventListener("scroll", syncNav, { passive: true });

  // Init
  const now = Date.now();
  tsInput.value = String(Math.floor(now / 1000));
  dtInput.value = formatDateTime(now, timezone);
  convertTsToDate();
  renderFromAhexInput();
  syncNav();
})();
