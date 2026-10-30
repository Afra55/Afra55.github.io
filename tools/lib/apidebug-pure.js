(() => {
  "use strict";

  const EXPORT_KIND = "devtools-apidebug-v1";
  const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

  function uid(n = 10) {
    const a = new Uint8Array(n);
    if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(a);
    else for (let i = 0; i < n; i++) a[i] = (Math.random() * 256) | 0;
    return [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  function emptyKv() {
    return { id: uid(4), enabled: true, key: "", value: "" };
  }

  function normalizeTagIds(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const id of raw) {
      const s = String(id || "").trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
    return out;
  }

  function emptyTag(partial = {}) {
    const name = String(partial.name || "").trim() || "未命名标签";
    return {
      id: partial.id || uid(8),
      name,
      createdAt: partial.createdAt || Date.now(),
    };
  }

  function normalizeTags(raw) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const t of raw) {
      if (!t || typeof t !== "object") continue;
      const tag = emptyTag(t);
      if (seen.has(tag.id)) continue;
      seen.add(tag.id);
      out.push(tag);
    }
    return out;
  }

  function emptyRequest(partial = {}) {
    return {
      id: partial.id || uid(12),
      name: partial.name || "未命名请求",
      method: METHODS.includes(partial.method) ? partial.method : "GET",
      url: partial.url || "",
      query: Array.isArray(partial.query) ? partial.query : [],
      headers: Array.isArray(partial.headers) ? partial.headers : [],
      cookies: Array.isArray(partial.cookies) ? partial.cookies : [],
      bodyType: partial.bodyType || "none",
      bodyText: partial.bodyText || "",
      tagIds: normalizeTagIds(partial.tagIds),
      createdAt: partial.createdAt || Date.now(),
      updatedAt: partial.updatedAt || Date.now(),
    };
  }

  function enabledPairs(rows) {
    return (rows || []).filter((r) => r && r.enabled !== false && String(r.key || "").trim());
  }

  function applyQueryToUrl(url, queryRows) {
    const raw = String(url || "").trim();
    if (!raw) return "";
    let u;
    try {
      u = new URL(raw);
    } catch {
      return raw;
    }
    [...u.searchParams.keys()].forEach((k) => u.searchParams.delete(k));
    for (const row of enabledPairs(queryRows)) {
      u.searchParams.append(String(row.key).trim(), String(row.value ?? ""));
    }
    return u.toString();
  }

  function parseQueryFromUrl(url) {
    return splitUrlAndQuery(url).query;
  }

  /**
   * 从完整链接拆出 path URL + query 行。
   * 支持无协议（example.com/a?x=1）、相对路径（/api?x=1）与完整 URL。
   * @returns {{ url: string, query: ReturnType<typeof emptyKv>[], changed: boolean }}
   */
  function splitUrlAndQuery(url) {
    const raw = String(url || "").trim();
    if (!raw) return { url: "", query: [], changed: false };

    const toRows = (sp) =>
      [...sp.entries()].map(([key, value]) => ({
        id: uid(4),
        enabled: true,
        key,
        value,
      }));

    try {
      const u = new URL(raw);
      const query = toRows(u.searchParams);
      if (!query.length) return { url: raw, query: [], changed: false };
      const next = `${u.origin}${u.pathname}${u.hash || ""}`;
      return { url: next, query, changed: true };
    } catch {
      /* fall through */
    }

    // 无协议：example.com/path?a=1
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) && !raw.startsWith("/") && raw.includes("?")) {
      try {
        const u = new URL(`https://${raw}`);
        const query = toRows(u.searchParams);
        if (!query.length) return { url: raw, query: [], changed: false };
        const qIdx = raw.indexOf("?");
        return { url: raw.slice(0, qIdx), query, changed: true };
      } catch {
        /* fall through */
      }
    }

    // 相对路径或其它：按第一个 ? 切开
    const qIdx = raw.indexOf("?");
    if (qIdx < 0) return { url: raw, query: [], changed: false };
    const pathPart = raw.slice(0, qIdx);
    const search = raw.slice(qIdx + 1);
    try {
      const query = toRows(new URLSearchParams(search));
      if (!query.length) return { url: raw, query: [], changed: false };
      return { url: pathPart, query, changed: true };
    } catch {
      return { url: raw, query: [], changed: false };
    }
  }

  function mergeCookieHeader(headers, cookies) {
    const list = enabledPairs(headers).map((r) => ({
      key: String(r.key).trim(),
      value: String(r.value ?? ""),
    }));
    const cookieBits = enabledPairs(cookies).map(
      (r) => `${String(r.key).trim()}=${String(r.value ?? "")}`
    );
    if (cookieBits.length) {
      const idx = list.findIndex((h) => h.key.toLowerCase() === "cookie");
      const joined = cookieBits.join("; ");
      if (idx >= 0) list[idx] = { key: list[idx].key, value: joined };
      else list.push({ key: "Cookie", value: joined });
    }
    return list;
  }

  function buildFetchInit(req) {
    const method = String(req.method || "GET").toUpperCase();
    const url = applyQueryToUrl(req.url, req.query);
    const headers = {};
    for (const h of mergeCookieHeader(req.headers, req.cookies)) {
      headers[h.key] = h.value;
    }
    const init = { method, headers };
    if (method !== "GET" && method !== "HEAD" && req.bodyType && req.bodyType !== "none") {
      init.body = String(req.bodyText || "");
      if (req.bodyType === "json" && !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")) {
        headers["Content-Type"] = "application/json";
      } else if (
        req.bodyType === "form" &&
        !Object.keys(headers).some((k) => k.toLowerCase() === "content-type")
      ) {
        headers["Content-Type"] = "application/x-www-form-urlencoded";
      }
    }
    return { url, init };
  }

  function shellQuote(s) {
    const str = String(s ?? "");
    if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(str)) return str;
    return `'${str.replace(/'/g, `'\\''`)}'`;
  }

  /** 请求 → curl */
  function requestToCurl(req) {
    const { url, init } = buildFetchInit(req);
    if (!url) return "curl";
    const parts = ["curl", "-X", init.method || "GET", shellQuote(url)];
    const headers = init.headers || {};
    for (const [k, v] of Object.entries(headers)) {
      if (k.toLowerCase() === "cookie") {
        parts.push("-b", shellQuote(v));
      } else {
        parts.push("-H", shellQuote(`${k}: ${v}`));
      }
    }
    if (init.body != null && init.body !== "") {
      parts.push("--data-raw", shellQuote(init.body));
    }
    return parts.join(" ");
  }

  function tokenizeCurl(input) {
    const s = String(input || "").replace(/\\\r?\n/g, " ").trim();
    const tokens = [];
    let i = 0;
    while (i < s.length) {
      if (/\s/.test(s[i])) {
        i += 1;
        continue;
      }
      if (s[i] === "'" || s[i] === '"') {
        const q = s[i++];
        let buf = "";
        while (i < s.length && s[i] !== q) {
          if (s[i] === "\\" && q === '"' && i + 1 < s.length) {
            buf += s[i + 1];
            i += 2;
            continue;
          }
          buf += s[i++];
        }
        if (s[i] === q) i += 1;
        tokens.push(buf);
        continue;
      }
      let buf = "";
      while (i < s.length && !/\s/.test(s[i])) buf += s[i++];
      tokens.push(buf);
    }
    return tokens;
  }

  function splitHeader(line) {
    const idx = String(line).indexOf(":");
    if (idx < 0) return { key: String(line).trim(), value: "" };
    return {
      key: String(line).slice(0, idx).trim(),
      value: String(line).slice(idx + 1).trim(),
    };
  }

  /** curl → 请求（覆盖常见写法） */
  function curlToRequest(curlText, base) {
    const tokens = tokenizeCurl(curlText);
    if (!tokens.length) throw new Error("空的 curl");
    let i = 0;
    if (/^curl(\.exe)?$/i.test(tokens[0])) i = 1;
    let method = "";
    let url = "";
    const headers = [];
    const cookies = [];
    let bodyText = "";
    let bodyType = "none";
    let dataAsQuery = false;

    const take = () => {
      if (i >= tokens.length) throw new Error("curl 参数不完整");
      return tokens[i++];
    };

    while (i < tokens.length) {
      const t = take();
      if (t === "-X" || t === "--request") {
        method = String(take()).toUpperCase();
      } else if (t === "-H" || t === "--header") {
        const { key, value } = splitHeader(take());
        if (key.toLowerCase() === "cookie") {
          String(value)
            .split(";")
            .map((p) => p.trim())
            .filter(Boolean)
            .forEach((pair) => {
              const eq = pair.indexOf("=");
              cookies.push({
                id: uid(4),
                enabled: true,
                key: eq >= 0 ? pair.slice(0, eq).trim() : pair,
                value: eq >= 0 ? pair.slice(eq + 1) : "",
              });
            });
        } else {
          headers.push({ id: uid(4), enabled: true, key, value });
        }
      } else if (t === "-b" || t === "--cookie") {
        const value = take();
        String(value)
          .split(";")
          .map((p) => p.trim())
          .filter(Boolean)
          .forEach((pair) => {
            const eq = pair.indexOf("=");
            cookies.push({
              id: uid(4),
              enabled: true,
              key: eq >= 0 ? pair.slice(0, eq).trim() : pair,
              value: eq >= 0 ? pair.slice(eq + 1) : "",
            });
          });
      } else if (
        t === "-d" ||
        t === "--data" ||
        t === "--data-raw" ||
        t === "--data-binary" ||
        t === "--data-urlencode"
      ) {
        bodyText = take();
        bodyType = "raw";
        if (!method) method = "POST";
      } else if (t === "--json") {
        bodyText = take();
        bodyType = "json";
        if (!method) method = "POST";
        if (!headers.some((h) => h.key.toLowerCase() === "content-type")) {
          headers.push({
            id: uid(4),
            enabled: true,
            key: "Content-Type",
            value: "application/json",
          });
        }
      } else if (t === "-G" || t === "--get") {
        dataAsQuery = true;
        method = "GET";
      } else if (t === "-I" || t === "--head") {
        method = "HEAD";
      } else if (t.startsWith("-") && t.includes("X") && t.length <= 4) {
        // ignore short combined flags we don't need
      } else if (t.startsWith("-")) {
        // skip unknown flag; if it looks like it takes a value, peek
        if (
          /^(--url|--user|-u|--proxy|-x|--connect-timeout|--max-time|-m|--output|-o|--user-agent|-A)$/.test(
            t
          )
        ) {
          if (t === "--url") url = take();
          else take();
        }
      } else if (!url) {
        url = t;
      }
    }

    if (dataAsQuery && bodyText) {
      const q = [];
      for (const part of bodyText.split("&")) {
        if (!part) continue;
        const eq = part.indexOf("=");
        q.push({
          id: uid(4),
          enabled: true,
          key: decodeURIComponent(eq >= 0 ? part.slice(0, eq) : part),
          value: decodeURIComponent(eq >= 0 ? part.slice(eq + 1) : ""),
        });
      }
      bodyText = "";
      bodyType = "none";
      return emptyRequest({
        ...base,
        method: method || "GET",
        url,
        query: q,
        headers,
        cookies,
        bodyType,
        bodyText,
      });
    }

    if (bodyType === "raw") {
      const ct = headers.find((h) => h.key.toLowerCase() === "content-type");
      if (ct && /json/i.test(ct.value)) bodyType = "json";
      else if (ct && /x-www-form-urlencoded/i.test(ct.value)) bodyType = "form";
    }

    const split = splitUrlAndQuery(url);
    url = split.url || url;
    const query = split.query;

    return emptyRequest({
      ...base,
      method: method || (bodyType !== "none" ? "POST" : "GET"),
      url,
      query,
      headers,
      cookies,
      bodyType,
      bodyText,
    });
  }

  /**
   * 多行 key:value / key=value / 制表符 解析成 KV 行。
   * @param {string} text
   * @param {{ style?: "auto"|"colon"|"equal"|"cookie" }} [opts]
   */
  function parseKvBulk(text, { style = "auto" } = {}) {
    const raw = String(text || "").replace(/\r\n/g, "\n").trim();
    if (!raw) return [];

    if (style === "cookie" || (style === "auto" && !raw.includes("\n") && /[=;]/.test(raw) && !raw.includes(":"))) {
      return parseCookieLine(raw);
    }

    const rows = [];
    for (let line of raw.split("\n")) {
      line = String(line || "").trim();
      if (!line || line.startsWith("#") || line.startsWith("//")) continue;

      const curlH = line.match(/^(-H|--header)\s+(.+)$/i);
      if (curlH) {
        let v = curlH[2].trim();
        if (
          (v.startsWith("'") && v.endsWith("'")) ||
          (v.startsWith('"') && v.endsWith('"'))
        ) {
          v = v.slice(1, -1);
        }
        line = v;
      }

      if (style === "cookie") {
        rows.push(...parseCookieLine(line));
        continue;
      }

      const pair = splitKvLine(line, style);
      if (pair) rows.push({ id: uid(4), enabled: true, key: pair.key, value: pair.value });
    }
    return rows;
  }

  function stripOuterQuotes(s) {
    const v = String(s ?? "").trim();
    if (
      (v.startsWith('"') && v.endsWith('"') && v.length >= 2) ||
      (v.startsWith("'") && v.endsWith("'") && v.length >= 2)
    ) {
      return v.slice(1, -1);
    }
    return v;
  }

  function splitKvLine(line, style = "auto") {
    const s = String(line || "").trim();
    if (!s) return null;
    if (s.includes("\t")) {
      const parts = s.split("\t");
      const key = parts[0].trim();
      if (!key) return null;
      return { key, value: stripOuterQuotes(parts.slice(1).join("\t")) };
    }
    const colon = s.indexOf(":");
    const eq = s.indexOf("=");
    let useColon = style === "colon";
    let useEqual = style === "equal";
    if (style === "auto") {
      if (colon >= 0 && (eq < 0 || colon <= eq)) useColon = true;
      else if (eq >= 0) useEqual = true;
    }
    if (useColon && colon >= 0) {
      const key = s.slice(0, colon).trim();
      if (!key) return null;
      return { key, value: stripOuterQuotes(s.slice(colon + 1)) };
    }
    if ((useEqual || style === "auto") && eq >= 0) {
      const key = s.slice(0, eq).trim();
      if (!key) return null;
      return { key, value: stripOuterQuotes(s.slice(eq + 1)) };
    }
    return null;
  }

  function parseCookieLine(text) {
    const rows = [];
    for (const part of String(text || "").split(";")) {
      const bit = part.trim();
      if (!bit) continue;
      const eq = bit.indexOf("=");
      rows.push({
        id: uid(4),
        enabled: true,
        key: eq >= 0 ? bit.slice(0, eq).trim() : bit,
        value: eq >= 0 ? bit.slice(eq + 1) : "",
      });
    }
    return rows.filter((r) => r.key);
  }

  function packExport(items, { all = false, tags = [] } = {}) {
    const list = (items || []).map((it) => emptyRequest(it));
    const used = new Set();
    for (const it of list) for (const id of it.tagIds || []) used.add(id);
    const catalog = normalizeTags(tags).filter((t) => used.has(t.id) || all);
    return {
      kind: EXPORT_KIND,
      version: 2,
      exportedAt: Date.now(),
      all: Boolean(all),
      tags: catalog,
      items: list,
    };
  }

  function unpackImport(raw) {
    let data = raw;
    if (typeof raw === "string") data = JSON.parse(raw);
    if (!data || typeof data !== "object") throw new Error("无效的导入文件");
    if (data.kind && data.kind !== EXPORT_KIND) {
      throw new Error("不是本工具的导出文件（devtools-apidebug-v1）");
    }
    const items = Array.isArray(data.items)
      ? data.items
      : Array.isArray(data)
        ? data
        : data.id || data.url
          ? [data]
          : [];
    if (!items.length) throw new Error("文件里没有请求");
    return {
      tags: normalizeTags(data.tags),
      items: items.map((it) => emptyRequest(it)),
    };
  }

  const api = {
    EXPORT_KIND,
    METHODS,
    uid,
    emptyKv,
    emptyTag,
    emptyRequest,
    normalizeTagIds,
    normalizeTags,
    enabledPairs,
    applyQueryToUrl,
    parseQueryFromUrl,
    splitUrlAndQuery,
    mergeCookieHeader,
    buildFetchInit,
    requestToCurl,
    curlToRequest,
    parseKvBulk,
    splitKvLine,
    parseCookieLine,
    packExport,
    unpackImport,
  };

  if (typeof window !== "undefined") window.DevToolsApiDebugPure = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
