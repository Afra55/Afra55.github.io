(() => {
  "use strict";

  /**
   * 文档质量路由（MDM / 文档互转共用）
   * 目标：任意格式→MD、MD→其它格式，均走该场景最高规格引擎。
   *
   * 引擎约定：
   * - raw：直读文本
   * - pandoc：结构化文档（标题/列表/脚注/公式）最优
   * - mineru：PDF/扫描/图片 OCR 与复杂版式最优（advanced）
   * - docling：无 GPU / MinerU 失败时的 OCR 回退
   * - browser：mammoth/turndown/pdf.js 最后兜底
   */

  /** @typedef {"raw"|"pandoc"|"mineru"|"docling"|"browser"} Engine */

  /** 导入：扩展名 → 引擎链（前者优先） */
  const IMPORT_BY_EXT = {
    // 纯文本
    ".md": ["raw"],
    ".markdown": ["raw"],
    ".txt": ["raw"],
    ".text": ["raw"],
    // 结构化：Pandoc 第一
    ".docx": ["pandoc", "mineru", "docling", "browser"],
    ".odt": ["pandoc", "mineru", "docling", "browser"],
    ".rtf": ["pandoc", "mineru", "docling", "browser"],
    ".epub": ["pandoc", "mineru", "docling", "browser"],
    ".html": ["pandoc", "mineru", "docling", "browser"],
    ".htm": ["pandoc", "mineru", "docling", "browser"],
    ".shtml": ["pandoc", "mineru", "docling", "browser"],
    ".pptx": ["pandoc", "mineru", "docling"],
    ".xlsx": ["pandoc", "mineru", "docling"],
    ".csv": ["pandoc", "mineru", "docling"],
    ".tsv": ["pandoc", "mineru", "docling"],
    ".rst": ["pandoc", "mineru", "browser"],
    ".tex": ["pandoc", "mineru", "browser"],
    ".latex": ["pandoc", "mineru", "browser"],
    ".org": ["pandoc", "mineru", "browser"],
    // 视觉 / OCR / 旧二进制：MinerU 第一
    ".pdf": ["mineru", "docling", "browser"],
    ".doc": ["mineru", "docling"],
    ".ppt": ["mineru", "docling"],
    ".xls": ["mineru", "docling"],
    ".ods": ["mineru", "docling"],
    ".odp": ["mineru", "docling"],
    ".ofd": ["mineru", "docling"],
    ".mhtml": ["mineru", "docling"],
    ".mht": ["mineru", "docling"],
    ".png": ["mineru", "docling"],
    ".jpg": ["mineru", "docling"],
    ".jpeg": ["mineru", "docling"],
    ".webp": ["mineru", "docling"],
    ".gif": ["mineru", "docling"],
    ".bmp": ["mineru", "docling"],
    ".tif": ["mineru", "docling"],
    ".tiff": ["mineru", "docling"],
    ".jp2": ["mineru", "docling"],
  };

  /**
   * MD→目标格式：Pandoc 最高质量参数。
   * from 统一用 gfm（与编辑器 / 导出习惯一致）。
   */
  const EXPORT_PANDOC = {
    docx: { from: "gfm", args: [] },
    odt: { from: "gfm", args: [] },
    epub: { from: "gfm", args: ["--standalone"] },
    rtf: { from: "gfm", args: [] },
    rst: { from: "gfm", args: [] },
    latex: { from: "gfm", args: ["--standalone"] },
    pptx: { from: "gfm", args: [] },
    mediawiki: { from: "gfm", args: [] },
    org: { from: "gfm", args: [] },
    opml: { from: "gfm", args: [] },
    html: { from: "gfm", args: ["--standalone", "--embed-resources"] },
    pdf: { from: "gfm", args: ["--pdf-engine=typst|xelatex"], note: "印刷级：Typst > XeLaTeX" },
    asciidoc: { from: "gfm", args: [] },
    plain: { from: "gfm", args: [] },
    gfm: { from: "gfm", args: ["--wrap=none"] },
    markdown: { from: "gfm", args: ["--wrap=none"] },
  };

  /** 本地导出（不经 Pandoc）也算「该路径最高质量」 */
  const EXPORT_LOCAL = {
    md: { engine: "local", note: "原文 + 资源 ZIP" },
    "html-standalone": { engine: "local", note: "预览渲染内联资源" },
    pdf: { engine: "bridge-pandoc", note: "印刷级 PDF（Typst/XeLaTeX）；失败再浏览器打印" },
    png: { engine: "local", note: "html2canvas 单张长图" },
  };

  function extOf(name) {
    const m = String(name || "")
      .trim()
      .toLowerCase()
      .match(/(\.[a-z0-9]+)$/i);
    return m ? m[1].toLowerCase() : "";
  }

  function isLegacyWordDoc(name) {
    const n = String(name || "").toLowerCase();
    return n.endsWith(".doc") && !n.endsWith(".docx");
  }

  /**
   * @returns {{ ext: string, chain: Engine[], primary: Engine, wantsBridge: boolean }}
   */
  function importRoute(filename, mime = "") {
    const name = String(filename || "");
    const type = String(mime || "");
    let ext = extOf(name);

    if (!ext) {
      if (/markdown/i.test(type)) ext = ".md";
      else if (type === "text/plain") ext = ".txt";
      else if (type === "text/html") ext = ".html";
      else if (type === "application/pdf") ext = ".pdf";
      else if (/wordprocessingml/i.test(type)) ext = ".docx";
      else if (/presentationml/i.test(type)) ext = ".pptx";
      else if (/spreadsheetml/i.test(type)) ext = ".xlsx";
      else if (/^image\//i.test(type)) {
        const sub = type.split("/")[1] || "png";
        ext = sub === "jpeg" ? ".jpg" : `.${sub.replace(/[^a-z0-9]/g, "")}`;
        if (!IMPORT_BY_EXT[ext]) ext = ".png";
      }
    }

    if (isLegacyWordDoc(name)) ext = ".doc";

    const chain = IMPORT_BY_EXT[ext] ? [...IMPORT_BY_EXT[ext]] : null;
    if (!chain) {
      return { ext, chain: [], primary: "", wantsBridge: false, known: false };
    }
    return {
      ext,
      chain,
      primary: chain[0],
      wantsBridge: chain.some((e) => e === "pandoc" || e === "mineru" || e === "docling"),
      known: true,
    };
  }

  function prefersPandoc(filename, mime) {
    return importRoute(filename, mime).primary === "pandoc";
  }

  function exportPandocPlan(toFmt) {
    const to = String(toFmt || "")
      .trim()
      .toLowerCase();
    const plan = EXPORT_PANDOC[to];
    if (!plan) {
      return { to, from: "gfm", args: [], known: false };
    }
    return { to, from: plan.from, args: [...plan.args], known: true };
  }

  function exportLocalPlan(fmt) {
    const f = String(fmt || "").trim().toLowerCase();
    const plan = EXPORT_LOCAL[f];
    if (!plan) return { fmt: f, known: false };
    return { fmt: f, ...plan, known: true };
  }

  /** 完整矩阵自检：缺路由 / 错误主引擎则返回 problems[] */
  function auditQualityMatrix(opts = {}) {
    const problems = [];
    const mineruExts = opts.mineruExts || [];
    const pandocImportExts = opts.pandocImportExts || [];
    const pandocExportFmts = opts.pandocExportFmts || Object.keys(EXPORT_PANDOC);

    for (const [ext, chain] of Object.entries(IMPORT_BY_EXT)) {
      if (!chain.length) problems.push(`导入 ${ext}：引擎链为空`);
      if (chain[0] === "browser") problems.push(`导入 ${ext}：不应以 browser 为第一引擎`);
      const visual =
        ext === ".pdf" ||
        ext === ".doc" ||
        ext === ".ofd" ||
        ext === ".mhtml" ||
        ext === ".mht" ||
        /^\.(png|jpe?g|webp|gif|bmp|tiff?|jp2)$/.test(ext) ||
        ext === ".ppt" ||
        ext === ".xls" ||
        ext === ".ods" ||
        ext === ".odp";
      if (visual && chain[0] !== "mineru" && chain[0] !== "raw") {
        problems.push(`导入 ${ext}：视觉/OCR 类应以 mineru 为首，现为 ${chain[0]}`);
      }
      const structured = [
        ".docx",
        ".odt",
        ".rtf",
        ".epub",
        ".html",
        ".htm",
        ".shtml",
        ".pptx",
        ".xlsx",
        ".csv",
        ".tsv",
        ".rst",
        ".tex",
        ".latex",
        ".org",
      ];
      if (structured.includes(ext) && chain[0] !== "pandoc") {
        problems.push(`导入 ${ext}：结构化应以 pandoc 为首，现为 ${chain[0]}`);
      }
    }

    for (const ext of mineruExts) {
      const e = String(ext).toLowerCase();
      if (!IMPORT_BY_EXT[e]) problems.push(`MinerU 支持 ${e} 但路由表缺失`);
    }
    for (const ext of pandocImportExts) {
      const e = String(ext).toLowerCase();
      if (!IMPORT_BY_EXT[e]) problems.push(`Pandoc 可导入 ${e} 但路由表缺失`);
      else if (IMPORT_BY_EXT[e][0] !== "pandoc" && e !== ".md" && e !== ".markdown") {
        // md 走 raw；其它 pandoc 可读格式应优先 pandoc
        if (![".pdf"].includes(e)) {
          /* csv 等已在 structured；旧格式例外已在 visual */
        }
      }
    }

    for (const fmt of pandocExportFmts) {
      if (!EXPORT_PANDOC[fmt] && !EXPORT_LOCAL[fmt]) {
        problems.push(`导出格式 ${fmt} 无质量方案`);
      }
    }

    // HTML 导出必须 embed；EPUB/LaTeX 必须 standalone
    if (!EXPORT_PANDOC.html.args.includes("--embed-resources")) {
      problems.push("导出 html 缺少 --embed-resources");
    }
    if (!EXPORT_PANDOC.epub.args.includes("--standalone")) {
      problems.push("导出 epub 缺少 --standalone");
    }
    if (!EXPORT_PANDOC.latex.args.includes("--standalone")) {
      problems.push("导出 latex 缺少 --standalone");
    }

    return { ok: problems.length === 0, problems };
  }

  const api = {
    IMPORT_BY_EXT,
    EXPORT_PANDOC,
    EXPORT_LOCAL,
    extOf,
    isLegacyWordDoc,
    importRoute,
    prefersPandoc,
    exportPandocPlan,
    exportLocalPlan,
    auditQualityMatrix,
  };

  if (typeof window !== "undefined") window.DevToolsDocQualityRouter = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
