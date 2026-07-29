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
    const keywords = (LANG_KEYWORDS[lang] || "")
      .split(/\s+/)
      .filter(Boolean)
      .map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|");
    let out = escapeHtml(text);
    out = out.replace(/(&quot;.*?&quot;|'.*?'|`.*?`)/g, '<span class="tok-str">$1</span>');
    out = out.replace(/(@[A-Za-z_][\w.]*)/g, '<span class="tok-anno">$1</span>');
    out = out.replace(/\b(\d+(?:\.\d+)?[fFlLuU]?)\b/g, '<span class="tok-num">$1</span>');
    if (keywords) {
      const flags = lang === "sql" ? "gi" : "g";
      out = out.replace(new RegExp(`\\b(${keywords})\\b`, flags), '<span class="tok-kw">$1</span>');
    }
    out = out.replace(/(\/\/.*?$)/gm, '<span class="tok-comment">$1</span>');
    out = out.replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="tok-comment">$1</span>');
    if (lang === "python" || lang === "ruby" || lang === "shell") {
      out = out.replace(/(#.*?$)/gm, '<span class="tok-comment">$1</span>');
    }
    if (lang === "sql") {
      out = out.replace(/(--.*?$)/gm, '<span class="tok-comment">$1</span>');
    }
    return out;
  }

  function highlightXml(text) {
    let out = escapeHtml(text);
    out = out.replace(/(&lt;\/?[A-Za-z][\w:.-]*)/g, '<span class="tok-kw">$1</span>');
    out = out.replace(/\s([A-Za-z_:][\w:.-]*)=/g, ' <span class="tok-key">$1</span>=');
    out = out.replace(/(&quot;.*?&quot;)/g, '<span class="tok-str">$1</span>');
    out = out.replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="tok-comment">$1</span>');
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
    escapeHtml,
    detectShareLang,
    prettyJsonText,
    renderShareCode,
  };
});
