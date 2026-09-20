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
    let align = [];
    for (let i = start; i <= end; i++) {
      if (isSep(lines[i])) {
        align = String(lines[i])
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => {
            const t = c.trim();
            const l = t.startsWith(":");
            const r = t.endsWith(":");
            if (l && r) return "center";
            if (r) return "right";
            if (l) return "left";
            return "";
          });
        continue;
      }
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
    return { start, end, grid, cols, align };
  }

  /**
   * 由二维数组生成 Markdown 表格。
   * opts.header !== false 时首行作为表头；否则表头留空、首行降为正文。
   * opts.align 为每列对齐："" | "left" | "center" | "right"。
   */
  function buildTable(grid, opts) {
    if (!grid || !grid.length) return "";
    const o = opts || {};
    const align = Array.isArray(o.align) ? o.align : [];
    const header = o.header !== false;
    const cols = Math.max(...grid.map((r) => r.length), 1);
    const pad = (r) => {
      const c = [...r];
      while (c.length < cols) c.push("");
      return c;
    };
    const sep = (i) => {
      const a = align[i] || "";
      if (a === "center") return ":---:";
      if (a === "right") return "---:";
      if (a === "left") return ":---";
      return "---";
    };
    const rows = grid.map(pad);
    const sepRow = `| ${Array.from({ length: cols }, (_, i) => sep(i)).join(" | ")} |`;
    const out = [];
    if (header) {
      out.push(`| ${rows[0].join(" | ")} |`, sepRow);
      for (let i = 1; i < rows.length; i++) out.push(`| ${rows[i].join(" | ")} |`);
    } else {
      out.push(`| ${Array.from({ length: cols }, () => "").join(" | ")} |`, sepRow);
      for (const r of rows) out.push(`| ${r.join(" | ")} |`);
    }
    return out.join("\n");
  }

  /**
   * 文档改名后，把其它正文里指向 oldName 的引用改成 newName。
   * 覆盖 Markdown 链接/图片（含 <...> 与 #锚点、可选标题）与 HTML href/src。
   * 返回 { text, count }；count 为替换处数。
   */
  function replaceDocRefs(text, oldName, newName) {
    const s = String(text || "");
    const from = String(oldName || "");
    const to = String(newName || "");
    if (!from || !to || from === to) return { text: s, count: 0 };
    let count = 0;
    const swap = (target) => {
      const parts = String(target).split("#");
      const pathPart = parts[0];
      const hash = parts.length > 1 ? parts.slice(1).join("#") : "";
      const base = pathPart.split("/").pop();
      if (base !== from) return null;
      count++;
      const dir = pathPart.slice(0, pathPart.length - base.length);
      return `${dir}${to}${hash ? `#${hash}` : ""}`;
    };
    let out = s.replace(
      /(\]\(\s*)(<)?([^)\s>]+)(>)?(\s+(?:"[^"]*"|'[^']*'))?(\s*\))/g,
      (m, pre, lt, tgt, gt, title, post) => {
        const r = swap(tgt);
        return r == null ? m : `${pre}${lt || ""}${r}${gt || ""}${title || ""}${post}`;
      }
    );
    out = out.replace(/(\b(?:href|src)\s*=\s*)(["'])([^"']+)\2/gi, (m, pre, q, tgt) => {
      const r = swap(tgt);
      return r == null ? m : `${pre}${q}${r}${q}`;
    });
    return { text: out, count };
  }

  /** 解析搜索串：支持 tag:xxx / cat:xxx（也接受 标签:/分类:），返回 { q, tags, cats } */
  function parseSearch(raw) {
    const s = String(raw || "").trim();
    const tags = [];
    const cats = [];
    const rest = s
      .replace(/(^|\s)(tag|cat|标签|分类):("[^"]*"|\S+)/gi, (m, sp, kind, val) => {
        const v = String(val).replace(/^"|"$/g, "").toLowerCase();
        if (!v) return sp;
        if (/^(tag|标签)$/i.test(kind)) tags.push(v);
        else cats.push(v);
        return sp;
      })
      .trim();
    return { q: rest.toLowerCase(), tags, cats };
  }

  /** 拼出文档在所选文件夹里的完整路径（dir 可为 Windows 或 POSIX 风格） */
  function joinDocPath(dir, fileName) {
    const base = String(dir || "").trim().replace(/[\\/]+$/, "");
    const name = String(fileName || "").trim().replace(/^[\\/]+/, "");
    if (!base || !name) return "";
    const sep = base.includes("\\") ? "\\" : "/";
    return `${base}${sep}${name}`;
  }

  const api = {
    slugify,
    parseFrontMatter,
    isRelativeRef,
    collectRefs,
    parseTableAt,
    buildTable,
    replaceDocRefs,
    parseSearch,
    joinDocPath,
  };
  if (typeof window !== "undefined") window.DevToolsMdmPure = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
