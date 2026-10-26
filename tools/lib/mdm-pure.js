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

  /**
   * 把「导入用的文件夹名」规整成可用标签名。
   * 保留可读性（空格/中文/emoji），只去掉会捣乱的控制符与路径非法字符。
   * @returns {string} 空串表示不可用
   */
  function normalizeImportFolderTagName(raw, opts) {
    const o = opts || {};
    const defaultName = String(o.defaultTagName || "默认");
    let s = String(raw || "");
    try {
      s = s.normalize("NFKC");
    } catch (_) {}
    s = s.replace(/[\u0000-\u001f\u007f]/g, "");
    s = s.replace(/[\u200b-\u200d\ufeff]/g, "");
    // 路径/文件名非法符 → 空格；勿整段丢掉
    s = s.replace(/[\\/:*?"<>|]+/g, " ");
    s = s.replace(/\s+/g, " ").trim();
    // Windows 尾点/尾空格；开头的 . 与 #
    s = s.replace(/^[.#\s]+/, "").replace(/[.\s]+$/g, "").trim();
    if (!s || s === "." || s === "..") return "";
    if (s.length > 48) s = s.slice(0, 48).replace(/\s+$/g, "");
    if (!s) return "";
    // 设备保留名整词时加后缀，避免个别系统怪异
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s)) s = `${s}_文件夹`;
    // 「默认」是系统固定标签，导入文件夹勿抢占
    if (s === defaultName) s = `${defaultName}文件夹`;
    return s;
  }

  /**
   * 从 webkitRelativePath / __relPath 取导入根文件夹名并规整为标签。
   * 仅当路径至少两段（文件夹/文件）时才有文件夹名；单文件导入返回 ""。
   */
  function folderTagFromRelPath(relPath, opts) {
    const rel = String(relPath || "")
      .replace(/\\/g, "/")
      .replace(/^\/+/, "");
    if (!rel) return "";
    const parts = rel.split("/").filter((p) => p && p !== "." && p !== "..");
    if (parts.length < 2) return "";
    return normalizeImportFolderTagName(parts[0], opts);
  }

  /** 解析 YAML front-matter（title/tags；head=原始头部） */
  function parseFrontMatter(text) {
    const m = String(text || "").match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m) return { title: "", tags: [], body: text, head: "" };
    const head = m[1];
    const body = m[2];
    let title = "";
    let tags = [];
    const clean = (v) => String(v).trim().replace(/^["']|["']$/g, "");
    const lines = head.split(/\r?\n/);
    for (let i = 0; i < lines.length; i += 1) {
      const mm = lines[i].match(/^([A-Za-z_-]+):\s*(.*)$/);
      if (!mm) continue;
      const key = mm[1].toLowerCase();
      const val = mm[2].trim();
      if (key === "title") title = clean(val);
      else if (key === "tags" || key === "tag") {
        if (val) {
          // 行内：tags: [a, b] / tags: a, b / tags: a
          tags = val
            .replace(/^\[|\]$/g, "")
            .split(/[,，]/)
            .map(clean)
            .filter(Boolean);
        } else {
          // 多行 YAML 列表：tags:\n  - a\n  - b
          const list = [];
          for (let j = i + 1; j < lines.length; j += 1) {
            const li = lines[j].match(/^\s*-\s+(.*)$/);
            if (!li) break;
            const v = clean(li[1]);
            if (v) list.push(v);
            i = j;
          }
          tags = list;
        }
      }
    }
    return { title, tags, body, head };
  }

  function isRelativeRef(v) {
    return Boolean(v) && !/^(https?:|data:|blob:|#|mailto:|tel:|\/\/)/i.test(v);
  }

  /**
   * 规范化本地资源相对路径；拒绝穿越 / 绝对盘符 / 空段。
   * 返回 posix 相对路径，或 null（不可写入）。
   */
  function sanitizeRelPath(ref) {
    let s = String(ref || "").trim().replace(/\\/g, "/");
    if (!s) return null;
    // 去掉 query / hash（Markdown 里偶发）
    s = s.replace(/[?#].*$/, "");
    if (!s || !isRelativeRef(s)) return null;
    if (/^[a-zA-Z]:/.test(s)) return null; // Windows 盘符
    s = s.replace(/^\.\//, "").replace(/^\/+/, "");
    const parts = s.split("/").filter((p) => p && p !== ".");
    if (!parts.length) return null;
    if (parts.some((p) => p === ".." || p.includes("\0"))) return null;
    // 文件名禁止控制字符与 Windows 保留符
    const base = parts[parts.length - 1];
    if (/[\u0000-\u001f<>:"|?*]/.test(base)) return null;
    if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(base)) return null;
    return parts.join("/");
  }

  /**
   * 导入前校验 Markdown 文本：必须是字符串、非二进制、可解析。
   * 返回 { ok, text, title, body, head, tags, error }；ok=false 时 error 为可读原因。
   */
  function validateImportMarkdown(raw, opts) {
    const o = opts || {};
    const fileName = String(o.fileName || o.name || "").trim();
    if (raw == null) {
      return { ok: false, text: "", title: "", body: "", head: "", tags: [], error: "转换结果为空" };
    }
    if (typeof raw !== "string") {
      return { ok: false, text: "", title: "", body: "", head: "", tags: [], error: "转换结果不是文本" };
    }
    let text = raw;
    // 去 BOM（readTextSmart 已处理多数情况，这里兜底）
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
    // 空文件允许导入为空白文
    if (!text.length) {
      const titleFallback = fileName.replace(/\.[^.]+$/, "") || "未命名";
      return { ok: true, text: "", title: titleFallback, body: "", head: "", tags: [], error: "" };
    }
    // 含 NUL → 几乎肯定是二进制误标成 .md
    if (text.includes("\0")) {
      return {
        ok: false,
        text: "",
        title: "",
        body: "",
        head: "",
        tags: [],
        error: "文件含二进制内容，无法作为 Markdown 导入",
      };
    }
    // 抽样：前 4KB 若控制字符占比过高，拒收
    const sample = text.slice(0, 4096);
    let ctrl = 0;
    for (let i = 0; i < sample.length; i += 1) {
      const c = sample.charCodeAt(i);
      if (c < 9 || (c > 13 && c < 32)) ctrl += 1;
    }
    if (sample.length >= 64 && ctrl / sample.length > 0.05) {
      return {
        ok: false,
        text: "",
        title: "",
        body: "",
        head: "",
        tags: [],
        error: "文件不像文本 Markdown（控制字符过多）",
      };
    }
    const fm = parseFrontMatter(text);
    const titleFromFile = fileName.replace(/\.[^.]+$/, "");
    const title = String(fm.title || titleFromFile || "未命名").trim() || "未命名";
    // 标题净化：去掉路径分隔与控制符，避免写文件名炸掉
    const safeTitle = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim() || "未命名";
    return {
      ok: true,
      text,
      title: safeTitle,
      body: fm.body,
      head: fm.head || "",
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      error: "",
    };
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
        const clean = sanitizeRelPath(m[1]);
        if (clean) refs.add(clean);
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

  /** 解析搜索串：支持 tag:xxx（也接受 标签:），返回 { q, tags } */
  function parseSearch(raw) {
    const s = String(raw || "").trim();
    const tags = [];
    const rest = s
      .replace(/(^|\s)(tag|标签):("[^"]*"|\S+)/gi, (m, sp, kind, val) => {
        const v = String(val).replace(/^"|"$/g, "").toLowerCase();
        if (!v) return sp;
        tags.push(v);
        return sp;
      })
      .trim();
    return { q: rest.toLowerCase(), tags };
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
    normalizeImportFolderTagName,
    folderTagFromRelPath,
    parseFrontMatter,
    isRelativeRef,
    sanitizeRelPath,
    validateImportMarkdown,
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
