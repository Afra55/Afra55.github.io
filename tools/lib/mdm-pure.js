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

  /** 解析 YAML front-matter（title/category/tags） */
  function parseFrontMatter(text) {
    const m = String(text || "").match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m) return { title: "", category: "", tags: [], body: text };
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
    return { title, category, tags, body };
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

  const api = { slugify, parseFrontMatter, isRelativeRef, collectRefs };
  if (typeof window !== "undefined") window.DevToolsMdmPure = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
