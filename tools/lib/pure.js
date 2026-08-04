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
    let text = String(raw || "").trim();
    if (!text) return null;

    // 允许 1719792000、1_719_792_000、1,719,792,000 等时间戳写法
    const compact = text.replace(/[,_\s]/g, "");
    if (/^-?\d+$/.test(compact)) {
      const n = Number(compact);
      if (!Number.isFinite(n)) return null;
      const abs = Math.abs(n);
      let ms;
      let unit;
      if (abs < 1e11) {
        ms = n * 1000;
        unit = "秒时间戳";
      } else if (abs < 1e14) {
        ms = n;
        unit = "毫秒时间戳";
      } else if (abs < 1e17) {
        ms = Math.trunc(n / 1000);
        unit = "微秒时间戳";
      } else {
        return null;
      }
      if (!Number.isFinite(ms)) return null;
      return { ms, unit, input: compact };
    }

    const m = text.match(
      /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/
    );
    if (m) {
      const ms = new Date(
        Number(m[1]),
        Number(m[2]) - 1,
        Number(m[3]),
        Number(m[4] || 0),
        Number(m[5] || 0),
        Number(m[6] || 0)
      ).getTime();
      if (Number.isNaN(ms)) return null;
      return { ms, unit: "日期时间", input: text };
    }

    const t = Date.parse(text);
    if (Number.isNaN(t)) return null;
    return { ms: t, unit: "日期时间", input: text };
  }

  function timeDiff(aRaw, bRaw) {
    const a = parseFlexibleTime(aRaw);
    const b = parseFlexibleTime(bRaw);
    if (!a || !b) throw new Error("时间格式无效，请输入时间戳或 YYYY-MM-DD HH:mm:ss");
    const delta = Math.abs(b.ms - a.ms);
    const sign = b.ms >= a.ms ? "B - A" : "A - B";
    const sec = Math.floor(delta / 1000);
    const days = Math.floor(sec / 86400);
    const hours = Math.floor((sec % 86400) / 3600);
    const mins = Math.floor((sec % 3600) / 60);
    const secs = sec % 60;
    return {
      ms: delta,
      a,
      b,
      text: [
        `A: ${formatDateTime(a.ms)}（${a.unit}）`,
        `B: ${formatDateTime(b.ms)}（${b.unit}）`,
        `${sign} = ${days}天 ${hours}时 ${mins}分 ${secs}秒（${delta} ms）`,
      ].join("\n"),
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

  function splitIdentifierWords(input) {
    const raw = String(input ?? "").trim();
    if (!raw) return [];
    const spaced = raw
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
      .replace(/[_\-.]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    return spaced
      .split(" ")
      .filter(Boolean)
      .map((w) => w.toLowerCase());
  }

  function wordsToCamel(words) {
    return words
      .map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
      .join("");
  }

  function wordsToPascal(words) {
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
  }

  function wordsToSnake(words) {
    return words.join("_");
  }

  function wordsToScreamingSnake(words) {
    return words.map((w) => w.toUpperCase()).join("_");
  }

  function wordsToKebab(words) {
    return words.join("-");
  }

  function wordsToDot(words) {
    return words.join(".");
  }

  function wordsToPath(words) {
    return words.join("/");
  }

  function convertIdentifier(input) {
    const words = splitIdentifierWords(input);
    if (!words.length) {
      return {
        words: [],
        camel: "",
        pascal: "",
        snake: "",
        screaming: "",
        kebab: "",
        dot: "",
        path: "",
        title: "",
      };
    }
    return {
      words,
      camel: wordsToCamel(words),
      pascal: wordsToPascal(words),
      snake: wordsToSnake(words),
      screaming: wordsToScreamingSnake(words),
      kebab: wordsToKebab(words),
      dot: wordsToDot(words),
      path: wordsToPath(words),
      title: words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" "),
    };
  }

  function convertCaseLines(text) {
    const lines = String(text ?? "").split(/\r\n|\n|\r/);
    const keys = ["camel", "pascal", "snake", "screaming", "kebab", "dot", "path", "title"];
    const out = Object.fromEntries(keys.map((k) => [k, []]));
    let converted = 0;
    for (const line of lines) {
      if (!line.trim()) {
        keys.forEach((k) => out[k].push(""));
        continue;
      }
      const one = convertIdentifier(line);
      if (!one.words.length) {
        keys.forEach((k) => out[k].push(""));
        continue;
      }
      converted += 1;
      keys.forEach((k) => out[k].push(one[k]));
    }
    const join = (arr) => arr.join("\n").replace(/\n+$/, "");
    return {
      count: converted,
      camel: join(out.camel),
      pascal: join(out.pascal),
      snake: join(out.snake),
      screaming: join(out.screaming),
      kebab: join(out.kebab),
      dot: join(out.dot),
      path: join(out.path),
      title: join(out.title),
    };
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


  function rgbStringToAhex(rgbText) {
    const m = String(rgbText || "").match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i);
    if (!m) throw new Error("RGB 格式无效");
    const vals = [Number(m[1]), Number(m[2]), Number(m[3])].map((n) => clamp(n, 0, 255));
    return `#FF${vals.map((n) => Math.round(n).toString(16).toUpperCase().padStart(2, "0")).join("")}`;
  }

  function generatePasswords({ length = 16, count = 1, upper = true, lower = true, number = true, symbol = true, noAmbiguous = false } = {}) {
    const sets = [];
    if (upper) sets.push("ABCDEFGHIJKLMNOPQRSTUVWXYZ");
    if (lower) sets.push("abcdefghijklmnopqrstuvwxyz");
    if (number) sets.push("0123456789");
    if (symbol) sets.push("!@#$%^&*()-_=+[]{};:,.?/\|");
    if (!sets.length) throw new Error("至少选择一种字符类型");

    const ambiguous = new Set(["0", "O", "o", "1", "l", "I"]);
    const normalize = (s) => (noAmbiguous ? [...s].filter((ch) => !ambiguous.has(ch)).join("") : s);
    const normalizedSets = sets.map(normalize).filter(Boolean);
    if (!normalizedSets.length) throw new Error("可用字符为空");
    const pool = normalizedSets.join("");
    const rnd = (max) => {
      if (typeof crypto !== "undefined" && crypto.getRandomValues) {
        const arr = new Uint32Array(1);
        crypto.getRandomValues(arr);
        return arr[0] % max;
      }
      if (typeof require === "function") {
        try {
          const buf = require("crypto").randomBytes(4);
          return buf.readUInt32BE(0) % max;
        } catch (_) {}
      }
      return Math.floor(Math.random() * max);
    };
    const out = [];
    for (let i = 0; i < count; i++) {
      const chars = [];
      // guarantee one from each selected set
      normalizedSets.forEach((set) => chars.push(set[rnd(set.length)]));
      while (chars.length < length) chars.push(pool[rnd(pool.length)]);
      for (let j = chars.length - 1; j > 0; j--) {
        const k = rnd(j + 1);
        [chars[j], chars[k]] = [chars[k], chars[j]];
      }
      out.push(chars.slice(0, length).join(""));
    }
    return out;
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

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function detectShareLang(text, preferred) {
    if (preferred && preferred !== "auto") return preferred;
    const t = String(text || "").trim();
    if (!t) return "text";
    if (/^[\[{]/.test(t)) {
      try {
        JSON.parse(t);
        return "json";
      } catch (_) {}
    }
    if (
      /@Composable\b|fun\s+\w+\s*\(|val\s+\w+\s*[:=]|var\s+\w+\s*[:=]|suspend\s+fun\b|import\s+androidx\.|package\s+[\w.]+/.test(t) &&
      !/\bpublic\s+class\b|\bSystem\.out\b/.test(t)
    ) {
      return "kotlin";
    }
    if (
      /\b(public|private|protected)\s+(static\s+)?(class|interface|void|int|String)\b|\bSystem\.out\.println\b|@Override\b|import\s+java\./.test(
        t
      )
    ) {
      return "java";
    }
    if (/=>|function\b|const\b|let\b|var\b|console\.log\b|import\s+.*\s+from\s+/.test(t)) return "javascript";
    if (/:\s*(string|number|boolean|any|void)\b|interface\s+\w+\s*\{|<[A-Z]\w*>/.test(t) && /\b(const|let|function|import)\b/.test(t)) return "typescript";
    if (/\bdef\s+\w+\s*\(|\bimport\s+\w+|print\s*\(/.test(t)) return "python";
    if (/\bfunc\s+\w+\s*\(.*\)\s*(->|\{)|import\s+"/.test(t)) return "go";
    if (/\bfn\s+\w+|let\s+mut\b|use\s+\w+::|impl\b/.test(t)) return "rust";
    if (/\bfunc\s+\w+\s*\(|import\s+(UIKit|SwiftUI|Foundation)\b|var\s+\w+\s*:\s*some\b/.test(t)) return "swift";
    if (/\bWidget\b.*build\b|\bStatelessWidget\b|\bStatefulWidget\b|import\s+'package:/.test(t)) return "dart";
    if (/SELECT\s+.*\s+FROM\s+/i.test(t)) return "sql";
    if (/<\/?[a-zA-Z][^>]*>/.test(t)) return "xml";
    return "text";
  }

  function prettyJsonText(text) {
    const raw = String(text || "").trim();
    if (!raw) return "";
    const data = JSON.parse(raw);
    return JSON.stringify(data, null, 2);
  }

  function highlightJson(text) {
    const src = String(text);
    let out = "";
    let i = 0;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '"') {
        let j = i + 1;
        let esc = false;
        while (j < src.length) {
          if (esc) {
            esc = false;
          } else if (src[j] === "\\") {
            esc = true;
          } else if (src[j] === '"') {
            break;
          }
          j += 1;
        }
        const end = Math.min(j + 1, src.length);
        const token = src.slice(i, end);
        let k = end;
        while (k < src.length && /\s/.test(src[k])) k += 1;
        const isKey = src[k] === ":";
        out += `<span class="tok-${isKey ? "key" : "str"}">${escapeHtml(token)}</span>`;
        i = end;
        continue;
      }
      if (/[-0-9]/.test(ch)) {
        const m = src.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
        if (m) {
          out += `<span class="tok-num">${escapeHtml(m[0])}</span>`;
          i += m[0].length;
          continue;
        }
      }
      if (/[a-zA-Z]/.test(ch)) {
        const m = src.slice(i).match(/^(true|false|null)/);
        if (m) {
          out += `<span class="tok-bool">${m[0]}</span>`;
          i += m[0].length;
          continue;
        }
      }
      if (/[{}\[\]:,]/.test(ch)) {
        out += `<span class="tok-punc">${escapeHtml(ch)}</span>`;
        i += 1;
        continue;
      }
      out += escapeHtml(ch);
      i += 1;
    }
    return out;
  }

  const LANG_KEYWORDS = {
    javascript:
      "const let var function return if else for while class new import export from async await try catch throw typeof instanceof of in switch case break continue default yield",
    typescript:
      "const let var function return if else for while class new import export from async await try catch throw typeof instanceof of in switch case break continue default yield type interface enum namespace declare abstract implements extends readonly as keyof infer never unknown any void",
    java:
      "abstract assert boolean break byte case catch char class const continue default do double else enum extends final finally float for goto if implements import instanceof int interface long native new package private protected public return short static strictfp super switch synchronized this throw throws transient try void volatile while var record sealed permits yields true false null",
    kotlin:
      "abstract actual annotation as break by catch class companion const constructor continue crossinline data do dynamic else enum expect external final finally for fun get if import infix inline inner interface internal is lateinit noinline null object open operator override package private protected public reified return sealed set super suspend this throw try typealias typeof val var when where while true false",
    python:
      "False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield",
    go:
      "break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var true false nil iota",
    rust:
      "as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while",
    swift:
      "associatedtype class deinit enum extension fileprivate func import init inout internal let open operator private protocol public rethrows return static struct subscript super typealias var break case continue default defer do else fallthrough for guard if in repeat switch where while as Any catch false is nil self Self super throw throws true try",
    c:
      "auto break case char const continue default do double else enum extern float for goto if inline int long register restrict return short signed sizeof static struct switch typedef union unsigned void volatile while true false NULL",
    cpp:
      "alignas alignof and and_eq asm auto bitand bitor bool break case catch char char8_t char16_t char32_t class compl concept const consteval constexpr constinit const_cast continue co_await co_return co_yield decltype default delete do double dynamic_cast else enum explicit export extern false float for friend goto if inline int long mutable namespace new noexcept not not_eq nullptr operator or or_eq private protected public register reinterpret_cast requires return short signed sizeof static static_assert static_cast struct switch template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile wchar_t while",
    dart:
      "abstract as assert async await break case catch class const continue covariant default deferred do dynamic else enum export extends extension external factory false final finally for Function get hide if implements import in interface is late library mixin new null on operator part required rethrow return sealed set show static super switch sync this throw true try typedef var void while with yield",
    ruby:
      "alias and begin break case class def defined? do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true undef unless until when while yield",
    php:
      "abstract and array as break callable case catch class clone const continue declare default die do echo else elseif empty enddeclare endfor endforeach endif endswitch endwhile eval exit extends final finally fn for foreach function global goto if implements include include_once instanceof insteadof interface isset list match namespace new or print private protected public readonly require require_once return static switch throw trait try unset use var while xor yield true false null",
    sql:
      "SELECT FROM WHERE AND OR NOT IN IS NULL LIKE BETWEEN JOIN INNER LEFT RIGHT OUTER ON AS INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE ALTER DROP INDEX PRIMARY KEY FOREIGN REFERENCES UNIQUE CHECK DEFAULT CONSTRAINT ORDER BY GROUP HAVING LIMIT OFFSET UNION ALL DISTINCT EXISTS CASE WHEN THEN ELSE END COUNT SUM AVG MIN MAX ASC DESC TRUE FALSE",
    shell:
      "if then else elif fi case esac for while until do done in function select time coproc true false",
    css:
      "important charset media keyframes font-face import page supports namespace",
  };

  function highlightByKeywords(text, lang) {
    const keywordSet = new Set(
      (LANG_KEYWORDS[lang] || "")
        .split(/\s+/)
        .filter(Boolean)
        .map((k) => (lang === "sql" ? k.toUpperCase() : k))
    );
    const src = String(text ?? "");
    let out = "";
    let i = 0;

    const wrap = (cls, value) => `<span class="tok-${cls}">${escapeHtml(value)}</span>`;
    const hashComment = lang === "python" || lang === "ruby" || lang === "shell";
    const dashComment = lang === "sql";

    while (i < src.length) {
      const ch = src[i];
      const next = src[i + 1];

      // line comments
      if (ch === "/" && next === "/") {
        let j = i + 2;
        while (j < src.length && src[j] !== "\n") j += 1;
        out += wrap("comment", src.slice(i, j));
        i = j;
        continue;
      }
      if (hashComment && ch === "#") {
        let j = i + 1;
        while (j < src.length && src[j] !== "\n") j += 1;
        out += wrap("comment", src.slice(i, j));
        i = j;
        continue;
      }
      if (dashComment && ch === "-" && next === "-") {
        let j = i + 2;
        while (j < src.length && src[j] !== "\n") j += 1;
        out += wrap("comment", src.slice(i, j));
        i = j;
        continue;
      }

      // block comments
      if (ch === "/" && next === "*") {
        let j = i + 2;
        while (j < src.length - 1 && !(src[j] === "*" && src[j + 1] === "/")) j += 1;
        j = Math.min(src.length, j + 2);
        out += wrap("comment", src.slice(i, j));
        i = j;
        continue;
      }

      // strings / chars
      if (ch === '"' || ch === "'" || ch === "`") {
        const quote = ch;
        let j = i + 1;
        let esc = false;
        while (j < src.length) {
          if (esc) {
            esc = false;
          } else if (src[j] === "\\") {
            esc = true;
          } else if (src[j] === quote) {
            j += 1;
            break;
          } else if (quote !== "`" && src[j] === "\n") {
            break;
          }
          j += 1;
        }
        out += wrap("str", src.slice(i, j));
        i = j;
        continue;
      }

      // annotations / decorators / attributes
      if (ch === "@" && /[A-Za-z_]/.test(next || "")) {
        let j = i + 1;
        while (j < src.length && /[A-Za-z0-9_.]/.test(src[j])) j += 1;
        out += wrap("anno", src.slice(i, j));
        i = j;
        continue;
      }

      // numbers
      if (/\d/.test(ch) || (ch === "." && /\d/.test(next || ""))) {
        const m = src.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?[fFlLuU]?/);
        if (m) {
          out += wrap("num", m[0]);
          i += m[0].length;
          continue;
        }
      }

      // identifiers / keywords
      if (/[A-Za-z_$]/.test(ch)) {
        let j = i + 1;
        while (j < src.length && /[A-Za-z0-9_$]/.test(src[j])) j += 1;
        const word = src.slice(i, j);
        const key = lang === "sql" ? word.toUpperCase() : word;
        out += keywordSet.has(key) ? wrap("kw", word) : escapeHtml(word);
        i = j;
        continue;
      }

      out += escapeHtml(ch);
      i += 1;
    }
    return out;
  }

  function highlightXml(text) {
    const src = String(text ?? "");
    let out = "";
    let i = 0;
    const wrap = (cls, value) => `<span class="tok-${cls}">${escapeHtml(value)}</span>`;

    while (i < src.length) {
      if (src.startsWith("<!--", i)) {
        let j = src.indexOf("-->", i + 4);
        j = j === -1 ? src.length : j + 3;
        out += wrap("comment", src.slice(i, j));
        i = j;
        continue;
      }

      if (src[i] === "<") {
        let j = i + 1;
        const isClose = src[j] === "/";
        if (isClose) j += 1;
        const nameStart = j;
        while (j < src.length && /[A-Za-z0-9:_-]/.test(src[j])) j += 1;
        if (j > nameStart) {
          out += wrap("kw", src.slice(i, j));
          i = j;
          while (i < src.length && src[i] !== ">") {
            if (/\s/.test(src[i])) {
              out += escapeHtml(src[i]);
              i += 1;
              continue;
            }
            if (/[A-Za-z_:]/.test(src[i])) {
              let k = i + 1;
              while (k < src.length && /[A-Za-z0-9:._-]/.test(src[k])) k += 1;
              out += wrap("key", src.slice(i, k));
              i = k;
              continue;
            }
            if (src[i] === '"' || src[i] === "'") {
              const quote = src[i];
              let k = i + 1;
              while (k < src.length && src[k] !== quote) k += 1;
              if (k < src.length) k += 1;
              out += wrap("str", src.slice(i, k));
              i = k;
              continue;
            }
            out += escapeHtml(src[i]);
            i += 1;
          }
          if (i < src.length && src[i] === ">") {
            out += escapeHtml(">");
            i += 1;
          }
          continue;
        }
      }

      out += escapeHtml(src[i]);
      i += 1;
    }
    return out;
  }

  function renderShareCode(text, { lang = "auto", prettyJson = true, lineNumbers = true } = {}) {
    let source = String(text ?? "");
    let resolved = detectShareLang(source, lang);
    if (resolved === "json" && prettyJson) {
      try {
        source = prettyJsonText(source);
      } catch (_) {
        resolved = detectShareLang(source, "text");
      }
    }
    let html;
    if (resolved === "json") html = highlightJson(source);
    else if (resolved === "xml") html = highlightXml(source);
    else if (LANG_KEYWORDS[resolved]) html = highlightByKeywords(source, resolved);
    else html = escapeHtml(source);

    const lines = html.split("\n");
    if (!lineNumbers) {
      return {
        lang: resolved,
        html: lines.map((line) => `<div class="sc-line"><span class="sc-code">${line || " "}</span></div>`).join(""),
        lineCount: lines.length,
      };
    }
    return {
      lang: resolved,
      html: lines
        .map((line, idx) => {
          const n = String(idx + 1).padStart(String(lines.length).length, " ");
          return `<div class="sc-line"><span class="sc-ln">${n}</span><span class="sc-code">${line || " "}</span></div>`;
        })
        .join(""),
      lineCount: lines.length,
    };
  }

  // ---- Map coordinate transforms (offline formulas) ----
  const COORD_PI = Math.PI;
  const COORD_X_PI = (COORD_PI * 3000.0) / 180.0;
  const COORD_A = 6378245.0;
  const COORD_EE = 0.00669342162296594323;

  function outOfChina(lng, lat) {
    return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
  }

  function transformLat(lng, lat) {
    let ret =
      -100.0 +
      2.0 * lng +
      3.0 * lat +
      0.2 * lat * lat +
      0.1 * lng * lat +
      0.2 * Math.sqrt(Math.abs(lng));
    ret += ((20.0 * Math.sin(6.0 * lng * COORD_PI) + 20.0 * Math.sin(2.0 * lng * COORD_PI)) * 2.0) / 3.0;
    ret += ((20.0 * Math.sin(lat * COORD_PI) + 40.0 * Math.sin((lat / 3.0) * COORD_PI)) * 2.0) / 3.0;
    ret += ((160.0 * Math.sin((lat / 12.0) * COORD_PI) + 320.0 * Math.sin((lat * COORD_PI) / 30.0)) * 2.0) / 3.0;
    return ret;
  }

  function transformLng(lng, lat) {
    let ret =
      300.0 +
      lng +
      2.0 * lat +
      0.1 * lng * lng +
      0.1 * lng * lat +
      0.1 * Math.sqrt(Math.abs(lng));
    ret += ((20.0 * Math.sin(6.0 * lng * COORD_PI) + 20.0 * Math.sin(2.0 * lng * COORD_PI)) * 2.0) / 3.0;
    ret += ((20.0 * Math.sin(lng * COORD_PI) + 40.0 * Math.sin((lng / 3.0) * COORD_PI)) * 2.0) / 3.0;
    ret += ((150.0 * Math.sin((lng / 12.0) * COORD_PI) + 300.0 * Math.sin((lng / 30.0) * COORD_PI)) * 2.0) / 3.0;
    return ret;
  }

  function deltaWGS84ToGCJ02(lng, lat) {
    let dLat = transformLat(lng - 105.0, lat - 35.0);
    let dLng = transformLng(lng - 105.0, lat - 35.0);
    const radLat = (lat / 180.0) * COORD_PI;
    let magic = Math.sin(radLat);
    magic = 1 - COORD_EE * magic * magic;
    const sqrtMagic = Math.sqrt(magic);
    dLat = (dLat * 180.0) / (((COORD_A * (1 - COORD_EE)) / (magic * sqrtMagic)) * COORD_PI);
    dLng = (dLng * 180.0) / ((COORD_A / sqrtMagic) * Math.cos(radLat) * COORD_PI);
    return { dLng, dLat };
  }

  function wgs84ToGcj02(lng, lat) {
    if (outOfChina(lng, lat)) return { lng, lat };
    const { dLng, dLat } = deltaWGS84ToGCJ02(lng, lat);
    return { lng: lng + dLng, lat: lat + dLat };
  }

  function gcj02ToWgs84(lng, lat) {
    if (outOfChina(lng, lat)) return { lng, lat };
    // iterative approximation for better accuracy
    let wgsLng = lng;
    let wgsLat = lat;
    for (let i = 0; i < 8; i++) {
      const { dLng, dLat } = deltaWGS84ToGCJ02(wgsLng, wgsLat);
      const nextLng = lng - dLng;
      const nextLat = lat - dLat;
      if (Math.abs(nextLng - wgsLng) < 1e-9 && Math.abs(nextLat - wgsLat) < 1e-9) {
        return { lng: nextLng, lat: nextLat };
      }
      wgsLng = nextLng;
      wgsLat = nextLat;
    }
    return { lng: wgsLng, lat: wgsLat };
  }

  function gcj02ToBd09(lng, lat) {
    const z = Math.sqrt(lng * lng + lat * lat) + 0.00002 * Math.sin(lat * COORD_X_PI);
    const theta = Math.atan2(lat, lng) + 0.000003 * Math.cos(lng * COORD_X_PI);
    return {
      lng: z * Math.cos(theta) + 0.0065,
      lat: z * Math.sin(theta) + 0.006,
    };
  }

  function bd09ToGcj02(lng, lat) {
    const x = lng - 0.0065;
    const y = lat - 0.006;
    const z = Math.sqrt(x * x + y * y) - 0.00002 * Math.sin(y * COORD_X_PI);
    const theta = Math.atan2(y, x) - 0.000003 * Math.cos(x * COORD_X_PI);
    return {
      lng: z * Math.cos(theta),
      lat: z * Math.sin(theta),
    };
  }

  function wgs84ToBd09(lng, lat) {
    const gcj = wgs84ToGcj02(lng, lat);
    return gcj02ToBd09(gcj.lng, gcj.lat);
  }

  function bd09ToWgs84(lng, lat) {
    const gcj = bd09ToGcj02(lng, lat);
    return gcj02ToWgs84(gcj.lng, gcj.lat);
  }

  // CGCS2000 ≈ WGS84 for web map purposes (sub-meter level for most apps)
  function toWGS84(system, lng, lat) {
    switch (system) {
      case "wgs84":
      case "cgcs2000":
        return { lng, lat };
      case "gcj02":
        return gcj02ToWgs84(lng, lat);
      case "bd09":
        return bd09ToWgs84(lng, lat);
      default:
        throw new Error("不支持的坐标系");
    }
  }

  function fromWGS84(system, lng, lat) {
    switch (system) {
      case "wgs84":
      case "cgcs2000":
        return { lng, lat };
      case "gcj02":
        return wgs84ToGcj02(lng, lat);
      case "bd09":
        return wgs84ToBd09(lng, lat);
      default:
        throw new Error("不支持的坐标系");
    }
  }

  function parseCoordPair(text) {
    const raw = String(text || "").trim();
    if (!raw) throw new Error("请输入经纬度");
    const cleaned = raw
      .replace(/[，]/g, ",")
      .replace(/[^\deE+\-.,\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    let lng;
    let lat;
    if (cleaned.includes(",")) {
      const parts = cleaned.split(",").map((s) => s.trim()).filter(Boolean);
      if (parts.length < 2) throw new Error("格式应为 lng,lat");
      lng = Number(parts[0]);
      lat = Number(parts[1]);
    } else {
      const parts = cleaned.split(" ").filter(Boolean);
      if (parts.length < 2) throw new Error("格式应为 lng lat 或 lng,lat");
      lng = Number(parts[0]);
      lat = Number(parts[1]);
    }
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) throw new Error("经纬度数值无效");
    if (Math.abs(lng) > 180 || Math.abs(lat) > 90) throw new Error("经纬度超出范围");
    return { lng, lat };
  }

  function formatCoord(value, digits = 8) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "";
    return Number(n.toFixed(digits)).toString();
  }

  function toDms(value, isLng) {
    const abs = Math.abs(value);
    const deg = Math.floor(abs);
    const minFloat = (abs - deg) * 60;
    const min = Math.floor(minFloat);
    const sec = (minFloat - min) * 60;
    const hemi = isLng ? (value >= 0 ? "E" : "W") : value >= 0 ? "N" : "S";
    return `${deg}°${String(min).padStart(2, "0")}′${sec.toFixed(2).padStart(5, "0")}″${hemi}`;
  }

  function convertCoordinates(system, text) {
    const input = parseCoordPair(text);
    const wgs = toWGS84(system, input.lng, input.lat);
    const systems = ["wgs84", "gcj02", "bd09", "cgcs2000"];
    const out = {};
    for (const key of systems) {
      const point = fromWGS84(key, wgs.lng, wgs.lat);
      out[key] = {
        lng: point.lng,
        lat: point.lat,
        decimal: `${formatCoord(point.lng)},${formatCoord(point.lat)}`,
        dms: `${toDms(point.lng, true)}, ${toDms(point.lat, false)}`,
      };
    }
    return {
      input,
      source: system,
      results: out,
    };
  }

  function convertCoordinateLines(system, text) {
    const lines = String(text ?? "").split(/\r\n|\n|\r/);
    const systems = ["wgs84", "gcj02", "bd09", "cgcs2000"];
    const decimal = Object.fromEntries(systems.map((k) => [k, []]));
    const dms = Object.fromEntries(systems.map((k) => [k, []]));
    let ok = 0;
    let fail = 0;
    let firstError = "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const row = convertCoordinates(system, line);
        for (const key of systems) {
          decimal[key].push(row.results[key].decimal);
          dms[key].push(row.results[key].dms);
        }
        ok += 1;
      } catch (err) {
        fail += 1;
        if (!firstError) firstError = err.message || String(err);
        for (const key of systems) {
          decimal[key].push("—");
          dms[key].push("—");
        }
      }
    }
    if (!ok && !fail) throw new Error("请输入至少一行坐标");
    return {
      ok,
      fail,
      error: fail ? firstError || "部分坐标无效" : "",
      decimal: Object.fromEntries(systems.map((k) => [k, decimal[k].join("\n")])),
      dms: Object.fromEntries(systems.map((k) => [k, dms[k].join("\n")])),
    };
  }

  // ---- Image toolkit helpers ----
  const APP_ICON_SIZES = {
    android: [512, 192, 144, 96, 72, 48, 36],
    ios: [1024, 180, 167, 152, 120, 87, 80, 76, 60, 58, 40, 29, 20],
  };

  function clampNumber(n, min, max) {
    const x = Number(n);
    if (!Number.isFinite(x)) return min;
    return Math.min(max, Math.max(min, x));
  }

  function calcResizeSize(srcW, srcH, opts = {}) {
    const sw = Math.max(1, Math.round(Number(srcW) || 1));
    const sh = Math.max(1, Math.round(Number(srcH) || 1));
    const mode = opts.mode || "max"; // wh | max | percent
    const keep = opts.keepAspect !== false;
    let tw = Number(opts.width);
    let th = Number(opts.height);
    const maxEdge = Number(opts.maxEdge);
    const percent = Number(opts.percent);

    if (mode === "percent" && Number.isFinite(percent) && percent > 0) {
      return {
        width: Math.max(1, Math.round((sw * percent) / 100)),
        height: Math.max(1, Math.round((sh * percent) / 100)),
      };
    }
    if (mode === "max" && Number.isFinite(maxEdge) && maxEdge > 0) {
      const edge = Math.max(sw, sh);
      if (edge <= maxEdge) return { width: sw, height: sh };
      const scale = maxEdge / edge;
      return {
        width: Math.max(1, Math.round(sw * scale)),
        height: Math.max(1, Math.round(sh * scale)),
      };
    }
    if (!Number.isFinite(tw) || tw <= 0) tw = sw;
    if (!Number.isFinite(th) || th <= 0) th = sh;
    if (keep) {
      if (opts.width && !opts.height) {
        th = Math.max(1, Math.round((sh * tw) / sw));
      } else if (opts.height && !opts.width) {
        tw = Math.max(1, Math.round((sw * th) / sh));
      } else {
        const scale = Math.min(tw / sw, th / sh);
        tw = Math.max(1, Math.round(sw * scale));
        th = Math.max(1, Math.round(sh * scale));
      }
    }
    return { width: Math.max(1, Math.round(tw)), height: Math.max(1, Math.round(th)) };
  }

  function calcCropRect(srcW, srcH, opts = {}) {
    const sw = Math.max(1, Number(srcW) || 1);
    const sh = Math.max(1, Number(srcH) || 1);
    const aspect = opts.aspect || "free"; // free | 1:1 | 16:9 | 4:3 | 9:16
    let x = clampNumber(opts.x, 0, sw - 1);
    let y = clampNumber(opts.y, 0, sh - 1);
    let w = clampNumber(opts.width ?? sw, 1, sw);
    let h = clampNumber(opts.height ?? sh, 1, sh);

    if (opts.usePercent) {
      x = (clampNumber(opts.xPercent ?? 0, 0, 100) / 100) * sw;
      y = (clampNumber(opts.yPercent ?? 0, 0, 100) / 100) * sh;
      w = (clampNumber(opts.wPercent ?? 100, 1, 100) / 100) * sw;
      h = (clampNumber(opts.hPercent ?? 100, 1, 100) / 100) * sh;
    }

    if (aspect !== "free") {
      const [aw, ah] = aspect.split(":").map(Number);
      if (aw > 0 && ah > 0) {
        const target = aw / ah;
        const current = w / h;
        if (opts.center !== false) {
          // Fit largest rect with aspect inside image
          if (sw / sh > target) {
            h = sh;
            w = h * target;
          } else {
            w = sw;
            h = w / target;
          }
          x = (sw - w) / 2;
          y = (sh - h) / 2;
        } else if (current > target) {
          w = h * target;
        } else {
          h = w / target;
        }
      }
    }

    w = Math.min(w, sw - x);
    h = Math.min(h, sh - y);
    return {
      x: Math.max(0, Math.round(x)),
      y: Math.max(0, Math.round(y)),
      width: Math.max(1, Math.round(w)),
      height: Math.max(1, Math.round(h)),
    };
  }

  function calcNineGridRects(width, height) {
    const w = Math.max(1, Math.round(Number(width) || 1));
    const h = Math.max(1, Math.round(Number(height) || 1));
    const cw = Math.floor(w / 3);
    const ch = Math.floor(h / 3);
    const rects = [];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const x = col * cw;
        const y = row * ch;
        const rw = col === 2 ? w - x : cw;
        const rh = row === 2 ? h - y : ch;
        rects.push({ index: row * 3 + col + 1, row, col, x, y, width: rw, height: rh });
      }
    }
    return rects;
  }

  function calcStitchLayout(sizes, opts = {}) {
    const mode = opts.mode || "horizontal"; // horizontal | vertical | grid
    const gap = Math.max(0, Math.round(Number(opts.gap) || 0));
    const cols = Math.max(1, Math.round(Number(opts.cols) || 2));
    const list = (sizes || []).map((s) => ({
      width: Math.max(1, Math.round(s.width || 1)),
      height: Math.max(1, Math.round(s.height || 1)),
    }));
    if (!list.length) return { width: 0, height: 0, items: [] };

    if (mode === "horizontal") {
      // Prefer equal height layout when provided; fall back to max height padding.
      const equalH = Number(opts.equalEdge);
      const height = Number.isFinite(equalH) && equalH > 0 ? Math.round(equalH) : Math.max(...list.map((s) => s.height));
      let x = 0;
      const items = list.map((s) => {
        const item = {
          x,
          y: Math.round((height - s.height) / 2),
          width: s.width,
          height: Number.isFinite(equalH) && equalH > 0 ? height : s.height,
        };
        x += item.width + gap;
        return item;
      });
      return { width: Math.max(0, x - gap), height, items };
    }
    if (mode === "vertical") {
      const equalW = Number(opts.equalEdge);
      const width = Number.isFinite(equalW) && equalW > 0 ? Math.round(equalW) : Math.max(...list.map((s) => s.width));
      let y = 0;
      const items = list.map((s) => {
        const item = {
          x: Math.round((width - s.width) / 2),
          y,
          width: Number.isFinite(equalW) && equalW > 0 ? width : s.width,
          height: s.height,
        };
        y += item.height + gap;
        return item;
      });
      return { width, height: Math.max(0, y - gap), items };
    }

    const items = [];
    const rowHeights = [];
    const rowWidths = [];
    for (let i = 0; i < list.length; i += cols) {
      const row = list.slice(i, i + cols);
      rowHeights.push(Math.max(...row.map((s) => s.height)));
      rowWidths.push(row.reduce((sum, s, idx) => sum + s.width + (idx ? gap : 0), 0));
    }
    const width = Math.max(...rowWidths, 0);
    let y = 0;
    for (let r = 0; r < rowHeights.length; r++) {
      const row = list.slice(r * cols, r * cols + cols);
      let x = 0;
      const rh = rowHeights[r];
      for (const s of row) {
        items.push({ x, y: y + Math.round((rh - s.height) / 2), ...s });
        x += s.width + gap;
      }
      y += rh + gap;
    }
    return { width, height: Math.max(0, y - gap), items };
  }

  /**
   * Cover-crop a source image into an equal-edge stitch cell.
   * horizontal: output height = commonEdge, width follows zoomed aspect
   * vertical: output width = commonEdge, height follows zoomed aspect
   * panPct 0-100 moves the crop window along the free axis (and slightly on both when zoomed).
   * Returns integer crop rects fully inside the source (safe for canvas drawImage).
   */
  function calcAlignedStitchCrop(srcW, srcH, mode, commonEdge, zoomPct = 100, panPct = 50, panCrossPct = 50) {
    const sw = Math.max(1, Math.round(Number(srcW) || 1));
    const sh = Math.max(1, Math.round(Number(srcH) || 1));
    const edge = Math.max(1, Math.round(Number(commonEdge) || 1));
    const zoom = Math.max(1, Math.min(5, (Number(zoomPct) || 100) / 100));
    const pan = clampNumber(panPct, 0, 100) / 100;
    const panCross = clampNumber(panCrossPct, 0, 100) / 100;

    const cropW0 = Math.min(sw, Math.max(1, sw / zoom));
    const cropH0 = Math.min(sh, Math.max(1, sh / zoom));

    let cropX;
    let cropY;
    let outW;
    let outH;

    if (mode === "vertical") {
      // Equal width
      outW = edge;
      cropX = (sw - cropW0) * pan;
      cropY = (sh - cropH0) * panCross;
      outH = Math.max(1, Math.round((outW * cropH0) / cropW0));
    } else {
      // horizontal (default): equal height
      outH = edge;
      cropX = (sw - cropW0) * panCross;
      cropY = (sh - cropH0) * pan;
      outW = Math.max(1, Math.round((outH * cropW0) / cropH0));
    }

    // Integerize and clamp so the source rect never exceeds the image.
    cropX = Math.floor(clampNumber(cropX, 0, Math.max(0, sw - cropW0)));
    cropY = Math.floor(clampNumber(cropY, 0, Math.max(0, sh - cropH0)));
    let cropW = Math.min(Math.ceil(cropW0), sw - cropX);
    let cropH = Math.min(Math.ceil(cropH0), sh - cropY);
    cropW = Math.max(1, cropW);
    cropH = Math.max(1, cropH);
    if (cropX + cropW > sw) cropX = Math.max(0, sw - cropW);
    if (cropY + cropH > sh) cropY = Math.max(0, sh - cropH);

    return { cropX, cropY, cropW, cropH, outW, outH };
  }

  function suggestStitchEdge(sizes, mode) {
    const list = sizes || [];
    if (!list.length) return 1;
    if (mode === "vertical") {
      return Math.max(1, Math.round(Math.min(...list.map((s) => Number(s.width) || 1))));
    }
    return Math.max(1, Math.round(Math.min(...list.map((s) => Number(s.height) || 1))));
  }

  function readExifAscii(view, offset, length) {
    let out = "";
    for (let i = 0; i < length; i++) {
      const c = view.getUint8(offset + i);
      if (c === 0) break;
      out += String.fromCharCode(c);
    }
    return out.trim();
  }

  function parseJpegExif(buffer) {
    const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer || []);
    if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
      return { ok: false, format: "non-jpeg", tags: {}, orientation: 1 };
    }
    let offset = 2;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (offset + 4 < bytes.length) {
      if (bytes[offset] !== 0xff) break;
      const marker = bytes[offset + 1];
      const size = view.getUint16(offset + 2, false);
      if (marker === 0xe1) {
        const start = offset + 4;
        if (start + 6 >= bytes.length) break;
        const head = String.fromCharCode(...bytes.slice(start, start + 4));
        if (head !== "Exif") break;
        const tiff = start + 6;
        if (tiff + 8 >= bytes.length) break;
        const le = view.getUint16(tiff, false) === 0x4949;
        const magic = view.getUint16(tiff + 2, le);
        if (magic !== 0x002a) break;
        const ifd0 = tiff + view.getUint32(tiff + 4, le);
        if (ifd0 + 2 >= bytes.length) break;
        const count = view.getUint16(ifd0, le);
        const tags = {};
        let orientation = 1;
        for (let i = 0; i < count; i++) {
          const entry = ifd0 + 2 + i * 12;
          if (entry + 12 > bytes.length) break;
          const tag = view.getUint16(entry, le);
          const type = view.getUint16(entry + 2, le);
          const num = view.getUint32(entry + 4, le);
          let valueOffset = entry + 8;
          const typeSize = type === 3 ? 2 : type === 4 ? 4 : type === 2 ? 1 : 0;
          if (typeSize && num * typeSize > 4) valueOffset = tiff + view.getUint32(entry + 8, le);
          if (tag === 0x0112 && type === 3) orientation = view.getUint16(valueOffset, le);
          if (type === 2) {
            const text = readExifAscii(view, valueOffset, num);
            if (tag === 0x010f) tags.Make = text;
            if (tag === 0x0110) tags.Model = text;
            if (tag === 0x0132) tags.DateTime = text;
            if (tag === 0x0131) tags.Software = text;
          }
          if (tag === 0x0112) tags.Orientation = String(orientation);
          if (tag === 0x00a002 && type === 3) tags.PixelXDimension = String(view.getUint16(valueOffset, le));
          if (tag === 0x00a002 && type === 4) tags.PixelXDimension = String(view.getUint32(valueOffset, le));
          if (tag === 0x00a003 && type === 3) tags.PixelYDimension = String(view.getUint16(valueOffset, le));
          if (tag === 0x00a003 && type === 4) tags.PixelYDimension = String(view.getUint32(valueOffset, le));
        }
        return { ok: true, format: "jpeg", tags, orientation: orientation || 1 };
      }
      if (size < 2) break;
      offset += 2 + size;
      if (marker === 0xda) break;
    }
    return { ok: true, format: "jpeg", tags: {}, orientation: 1 };
  }

  function mimeFromFormat(format) {
    const f = String(format || "png").toLowerCase();
    if (f === "jpeg" || f === "jpg") return "image/jpeg";
    if (f === "webp") return "image/webp";
    return "image/png";
  }

  function extFromFormat(format) {
    const f = String(format || "png").toLowerCase();
    if (f === "jpeg" || f === "jpg") return "jpg";
    if (f === "webp") return "webp";
    return "png";
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
    splitIdentifierWords,
    convertIdentifier,
    convertCaseLines,
    diffLines,
    describeCron,
    nextCronTimes,
    UNIT_TABLES,
    convertUnit,
    rgbStringToAhex,
    generatePasswords,
    escapeHtml,
    detectShareLang,
    prettyJsonText,
    renderShareCode,
    outOfChina,
    wgs84ToGcj02,
    gcj02ToWgs84,
    gcj02ToBd09,
    bd09ToGcj02,
    wgs84ToBd09,
    bd09ToWgs84,
    parseCoordPair,
    convertCoordinates,
    convertCoordinateLines,
    APP_ICON_SIZES,
    calcResizeSize,
    calcCropRect,
    calcNineGridRects,
    calcStitchLayout,
    calcAlignedStitchCrop,
    suggestStitchEdge,
    parseJpegExif,
    mimeFromFormat,
    extFromFormat,
  };
});
