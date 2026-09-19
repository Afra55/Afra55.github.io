(() => {
  "use strict";

  /** 文件名 slug：去掉非法字符，空白转 -，限长 */
  function slugify(name, fallback = "doc") {
    const s = String(name || "")
      .trim()
      .replace(/[\\/:*?"<>|]+/g, " ")
      .replace(/\s+/g, "-")
      .replace(/^[.\-]+|[.\-]+$/g, "")
      .slice(0, 60);
    return s || fallback;
  }

  /** 解析 YAML front-matter（title/category/tags；head=原始头部） */
  function parseFrontMatter(text) {
    const m = String(text || "").match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m) return { title: "", category: "", tags: [], body: text, head: "" };
    const head = m[1];
    const body = m[2];
    let title = "";
    let category = "";
    let tags = [];
    head.split(/\r?\n/).forEach((line) => {
      const mm = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
      if (!mm) return;
      const key = mm[1].toLowerCase();
      const val = mm[2].trim().replace(/^["']|["']$/g, "");
      if (key === "title") title = val;
      else if (key === "category" || key === "cat") category = val;
      else if (key === "tags") {
        tags = val
          .replace(/^\[|\]$/g, "")
          .split(/[,，]/)
          .map((x) => x.trim().replace(/^["']|["']$/g, ""))
          .filter(Boolean);
      }
    });
    return { title, category, tags, body, head };
  }

  function isRelativeRef(v) {
    return Boolean(v) && !/^(https?:|data:|blob:|#|mailto:|tel:|\/\/)/i.test(v);
  }

  /** 收集正文里引用的本地资源相对路径（图片 / 普通链接 / src·href，去重） */
  function collectRefs(text) {
    const refs = new Set();
    const s = String(text || "");
    const patterns = [
      /!\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, // 图片
      /(?<!!)\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, // 普通链接（附件）
      /(?:src|href)\s*=\s*["']([^"']+)["']/gi, // HTML 媒体/链接
    ];
    for (const re of patterns) {
      let m;
      while ((m = re.exec(s))) {
        if (isRelativeRef(m[1])) refs.add(m[1].replace(/^\.\//, "").replace(/^\/+/, ""));
      }
    }
    return [...refs];
  }

  /** 解析光标所在行的 Markdown 表格 → {start,end,grid,cols}；不在表格内返回 null */
  function parseTableAt(lines, idx) {
    const isRow = (l) => /^\s*\|.*\|\s*$/.test(String(l || ""));
    const isSep = (l) => /^\s*\|[\s:|-]+\|\s*$/.test(String(l || "")) && /-/.test(String(l));
    if (!isRow(lines[idx]) && !isRow(lines[idx - 1]) && !isRow(lines[idx + 1])) return null;
    let start = isRow(lines[idx]) ? idx : isRow(lines[idx + 1]) ? idx + 1 : idx - 1;
    let end = start;
    while (start > 0 && isRow(lines[start - 1])) start--;
    while (end < lines.length - 1 && isRow(lines[end + 1])) end++;
    const grid = [];
    for (let i = start; i <= end; i++) {
      if (isSep(lines[i])) continue;
      const cells = String(lines[i])
        .trim()
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((c) => c.trim());
      grid.push(cells);
    }
    if (!grid.length) return null;
    const cols = Math.max(...grid.map((r) => r.length));
    for (const r of grid) while (r.length < cols) r.push("");
    return { start, end, grid, cols };
  }

  /** 由二维数组生成 Markdown 表格（首行为表头） */
  function buildTable(grid) {
    if (!grid || !grid.length) return "";
    const cols = Math.max(...grid.map((r) => r.length));
    const pad = (r) => {
      const c = [...r];
      while (c.length < cols) c.push("");
      return c;
    };
    const head = pad(grid[0]);
    const out = [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`];
    for (let i = 1; i < grid.length; i++) out.push(`| ${pad(grid[i]).join(" | ")} |`);
    return out.join("\n");
  }

  const api = { slugify, parseFrontMatter, isRelativeRef, collectRefs, parseTableAt, buildTable };
  if (typeof window !== "undefined") window.DevToolsMdmPure = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
