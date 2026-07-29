(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DevToolsPure = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function pad(n) {
    return String(n).padStart(2, "0");
  }

  function formatDateTime(ms) {
    const d = new Date(ms);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  function parseFlexibleTime(raw) {
    const text = String(raw || "").trim();
    if (!text) return null;
    if (/^-?\d+$/.test(text)) {
      const n = Number(text);
      const abs = Math.abs(n);
      const ms = abs < 1e11 ? n * 1000 : n;
      return Number.isFinite(ms) ? ms : null;
    }
    const m = text.match(
      /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/
    );
    if (!m) {
      const t = Date.parse(text);
      return Number.isNaN(t) ? null : t;
    }
    return new Date(
      Number(m[1]),
      Number(m[2]) - 1,
      Number(m[3]),
      Number(m[4] || 0),
      Number(m[5] || 0),
      Number(m[6] || 0)
    ).getTime();
  }

  function timeDiff(aRaw, bRaw) {
    const a = parseFlexibleTime(aRaw);
    const b = parseFlexibleTime(bRaw);
    if (a === null || b === null) throw new Error("时间格式无效");
    const delta = Math.abs(b - a);
    const sign = b >= a ? "B - A" : "A - B";
    const sec = Math.floor(delta / 1000);
    const days = Math.floor(sec / 86400);
    const hours = Math.floor((sec % 86400) / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = sec % 60;
    return {
      ms: delta,
      text: `${sign} = ${days}天 ${hours}时 ${mins}分 ${secs}秒（${delta} ms）`,
      a,
      b,
    };
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function hexToRgb(hex) {
    let v = String(hex).trim().replace(/^#/, "").toUpperCase();
    if (/^[0-9A-F]{3}$/.test(v)) {
      v = v.split("").map((c) => c + c).join("");
    }
    if (!/^[0-9A-F]{6}$/.test(v)) return null;
    return {
      r: parseInt(v.slice(0, 2), 16),
      g: parseInt(v.slice(2, 4), 16),
      b: parseInt(v.slice(4, 6), 16),
    };
  }

  function rgbToHex(r, g, b) {
    return (
      "#" +
      [r, g, b]
        .map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, "0"))
        .join("")
        .toUpperCase()
    );
  }

  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    let h = 0;
    let s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4; break;
      }
      h /= 6;
    }
    return {
      h: Math.round(h * 360),
      s: Math.round(s * 100),
      l: Math.round(l * 100),
    };
  }

  function hslToRgb(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = clamp(s, 0, 100) / 100;
    l = clamp(l, 0, 100) / 100;
    if (s === 0) {
      const v = Math.round(l * 255);
      return { r: v, g: v, b: v };
    }
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const hk = h / 360;
    return {
      r: Math.round(hue2rgb(p, q, hk + 1 / 3) * 255),
      g: Math.round(hue2rgb(p, q, hk) * 255),
      b: Math.round(hue2rgb(p, q, hk - 1 / 3) * 255),
    };
  }

  function parseRgb(text) {
    const m = String(text).trim().match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/i);
    if (!m) return null;
    return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
  }

  function parseHsl(text) {
    const m = String(text).trim().match(/^hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%/i);
    if (!m) return null;
    return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
  }

  function colorFrom(source, value) {
    let rgb = null;
    if (source === "hex") rgb = hexToRgb(value);
    else if (source === "rgb") rgb = parseRgb(value);
    else if (source === "hsl") {
      const hsl = parseHsl(value);
      if (hsl) rgb = hslToRgb(hsl.h, hsl.s, hsl.l);
    }
    if (!rgb) throw new Error("颜色格式无效");
    const hsl = rgbToHsl(rgb.r, rgb.g, rgb.b);
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    return {
      hex,
      rgb: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})`,
      hsl: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)`,
      r: rgb.r,
      g: rgb.g,
      b: rgb.b,
    };
  }

  function parseQuery(input) {
    let q = String(input || "").trim();
    if (!q) throw new Error("请输入 URL 或查询串");
    if (q.includes("://") || q.startsWith("?")) {
      try {
        const u = new URL(q, "https://example.local");
        q = u.search.startsWith("?") ? u.search.slice(1) : u.search;
      } catch (_) {
        const idx = q.indexOf("?");
        q = idx >= 0 ? q.slice(idx + 1) : q;
      }
    }
    const params = new URLSearchParams(q);
    const obj = {};
    for (const [k, v] of params.entries()) {
      if (Object.prototype.hasOwnProperty.call(obj, k)) {
        obj[k] = [].concat(obj[k], v);
      } else {
        obj[k] = v;
      }
    }
    return obj;
  }

  function base64UrlToUtf8(str) {
    const padLen = (4 - (str.length % 4)) % 4;
    const b64 = (str + "=".repeat(padLen)).replace(/-/g, "+").replace(/_/g, "/");
    if (typeof atob === "function") {
      const bin = atob(b64);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder().decode(bytes);
    }
    return Buffer.from(b64, "base64").toString("utf8");
  }

  function parseJwt(token) {
    const parts = String(token || "").trim().split(".");
    if (parts.length < 2) throw new Error("JWT 格式无效");
    const header = JSON.parse(base64UrlToUtf8(parts[0]));
    const payload = JSON.parse(base64UrlToUtf8(parts[1]));
    return { header, payload, signature: parts[2] || "" };
  }

  function uuidv4() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    const bytes = new Uint8Array(16);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  }

  function formatUuid(id, { upper = false, noHyphen = false } = {}) {
    let s = id;
    if (noHyphen) s = s.replace(/-/g, "");
    return upper ? s.toUpperCase() : s.toLowerCase();
  }

  function md5(str) {
    const input = String(str);
    if (typeof SparkMD5 !== "undefined" && SparkMD5.hash) return SparkMD5.hash(input);
    if (typeof require === "function") {
      try {
        return require("crypto").createHash("md5").update(input, "utf8").digest("hex");
      } catch (_) {}
    }
    throw new Error("MD5 不可用");
  }

  function textStats(text) {
    const lines = text.split(/\r\n|\n|\r/);
    const nonEmpty = lines.filter((l) => l.trim() !== "").length;
    return {
      chars: text.length,
      charsNoSpace: text.replace(/\s/g, "").length,
      lines: lines.length,
      nonEmptyLines: nonEmpty,
      words: (text.trim().match(/\S+/g) || []).length,
    };
  }

  function transformText(text, action) {
    switch (action) {
      case "upper": return text.toUpperCase();
      case "lower": return text.toLowerCase();
      case "trim": return text.split(/\r\n|\n|\r/).map((l) => l.trim()).join("\n");
      case "dedupe-empty": return text.split(/\r\n|\n|\r/).filter((l) => l.trim() !== "").join("\n");
      case "sort": return text.split(/\r\n|\n|\r/).slice().sort((a, b) => a.localeCompare(b, "zh")).join("\n");
      case "reverse": return text.split(/\r\n|\n|\r/).slice().reverse().join("\n");
      default: return text;
    }
  }

  function diffLines(aText, bText) {
    const a = String(aText).split(/\r\n|\n|\r/);
    const b = String(bText).split(/\r\n|\n|\r/);
    const n = a.length;
    const m = b.length;
    const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const out = [];
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        out.push({ type: "same", text: a[i] });
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        out.push({ type: "del", text: a[i++] });
      } else {
        out.push({ type: "add", text: b[j++] });
      }
    }
    while (i < n) out.push({ type: "del", text: a[i++] });
    while (j < m) out.push({ type: "add", text: b[j++] });
    return out;
  }

  function parseCronField(field, min, max) {
    const values = new Set();
    for (const part of String(field).split(",")) {
      const stepMatch = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
      if (!stepMatch) throw new Error(`Cron 字段无效: ${field}`);
      const step = Number(stepMatch[2] || 1);
      let start = min;
      let end = max;
      if (stepMatch[1] !== "*") {
        if (stepMatch[1].includes("-")) {
          const [s, e] = stepMatch[1].split("-").map(Number);
          start = s; end = e;
        } else {
          start = end = Number(stepMatch[1]);
        }
      }
      if (start < min || end > max || start > end || step < 1) throw new Error(`Cron 字段越界: ${field}`);
      for (let v = start; v <= end; v += step) values.add(v);
    }
    return values;
  }

  function describeCron(expr) {
    const parts = String(expr).trim().split(/\s+/);
    if (parts.length !== 5) throw new Error("需要 5 段：分 时 日 月 周");
    const [minute, hour, dom, month, dow] = parts;
    return `分=${minute} 时=${hour} 日=${dom} 月=${month} 周=${dow}`;
  }

  function nextCronTimes(expr, fromMs = Date.now(), count = 5) {
    const parts = String(expr).trim().split(/\s+/);
    if (parts.length !== 5) throw new Error("需要 5 段：分 时 日 月 周");
    const minutes = parseCronField(parts[0], 0, 59);
    const hours = parseCronField(parts[1], 0, 23);
    const doms = parseCronField(parts[2], 1, 31);
    const months = parseCronField(parts[3], 1, 12);
    const dows = parseCronField(parts[4], 0, 7); // 0 and 7 = Sunday
    if (dows.has(7)) dows.add(0);

    const out = [];
    let cursor = new Date(fromMs);
    cursor.setSeconds(0, 0);
    cursor = new Date(cursor.getTime() + 60000);

    for (let guard = 0; guard < 366 * 24 * 60 && out.length < count; guard++) {
      const y = cursor.getFullYear();
      const mo = cursor.getMonth() + 1;
      const d = cursor.getDate();
      const h = cursor.getHours();
      const mi = cursor.getMinutes();
      const dow = cursor.getDay();
      const domOk = doms.has(d);
      const dowOk = dows.has(dow);
      // standard cron: if both dom and dow are restricted, either may match
      const dayOk =
        (parts[2] === "*" && parts[4] === "*") ||
        (parts[2] === "*" && dowOk) ||
        (parts[4] === "*" && domOk) ||
        (parts[2] !== "*" && parts[4] !== "*" && (domOk || dowOk)) ||
        (domOk && dowOk);

      if (minutes.has(mi) && hours.has(h) && months.has(mo) && dayOk) {
        // validate day exists in month
        const dim = new Date(y, mo, 0).getDate();
        if (d <= dim) out.push(cursor.getTime());
      }
      cursor = new Date(cursor.getTime() + 60000);
    }
    return out;
  }

  const UNIT_TABLES = {
    length: {
      label: "长度",
      base: "m",
      units: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 },
    },
    weight: {
      label: "重量",
      base: "g",
      units: { mg: 0.001, g: 1, kg: 1000, t: 1e6, oz: 28.349523125, lb: 453.59237 },
    },
    temp: {
      label: "温度",
      units: ["C", "F", "K"],
    },
  };

  function convertTemp(value, from, to) {
    let c;
    if (from === "C") c = value;
    else if (from === "F") c = (value - 32) * (5 / 9);
    else if (from === "K") c = value - 273.15;
    else throw new Error("未知温度单位");
    if (to === "C") return c;
    if (to === "F") return c * (9 / 5) + 32;
    if (to === "K") return c + 273.15;
    throw new Error("未知温度单位");
  }

  function convertUnit(category, value, from, to) {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error("数值无效");
    if (category === "temp") return convertTemp(n, from, to);
    const table = UNIT_TABLES[category];
    if (!table || !(from in table.units) || !(to in table.units)) throw new Error("单位无效");
    const base = n * table.units[from];
    return base / table.units[to];
  }

  return {
    formatDateTime,
    parseFlexibleTime,
    timeDiff,
    hexToRgb,
    rgbToHex,
    rgbToHsl,
    hslToRgb,
    colorFrom,
    parseQuery,
    parseJwt,
    uuidv4,
    formatUuid,
    md5,
    textStats,
    transformText,
    diffLines,
    describeCron,
    nextCronTimes,
    UNIT_TABLES,
    convertUnit,
  };
});
