"use strict";

/**
 * Pandoc 转换 + 一键安装（本机桥模块）。
 * - 文本模式：Markdown → docx/odt/epub/…（MDM 导出）
 * - 文件模式：docx/odt/epub/html/… → Markdown（MDM 高质量导入）
 */

const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const EXT = {
  docx: "docx",
  odt: "odt",
  epub: "epub",
  rtf: "rtf",
  rst: "rst",
  latex: "tex",
  beamer: "pdf",
  pdf: "pdf",
  pptx: "pptx",
  mediawiki: "wiki",
  org: "org",
  opml: "opml",
  html: "html",
  markdown: "md",
  gfm: "md",
  commonmark: "md",
  plain: "txt",
  asciidoc: "adoc",
  textile: "textile",
  dokuwiki: "txt",
  json: "json",
  native: "native",
};

/** 印刷级 PDF 引擎优先级：Typst > XeLaTeX > LuaLaTeX > pdfLaTeX > wkhtmltopdf */
const PDF_ENGINE_ORDER = ["typst", "xelatex", "lualatex", "pdflatex", "wkhtmltopdf"];

/** 文件 → Markdown 时的 -f 映射（结构化文档优先 Pandoc） */
const FILE_FROM = {
  ".docx": "docx",
  ".odt": "odt",
  ".epub": "epub",
  ".html": "html",
  ".htm": "html",
  ".shtml": "html",
  ".rtf": "rtf",
  ".rst": "rst",
  ".tex": "latex",
  ".latex": "latex",
  ".pptx": "pptx",
  ".xlsx": "xlsx",
  ".csv": "csv",
  ".tsv": "tsv",
  ".md": "markdown",
  ".markdown": "markdown",
  ".org": "org",
};

function runCmd(file, args, { input, timeout = 300000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { timeout, maxBuffer: 128 * 1024 * 1024, windowsHide: true, encoding: "buffer", cwd },
      (err, stdout, stderr) => {
        if (err) {
          err.stdout = Buffer.isBuffer(stdout) ? stdout.toString("utf8") : String(stdout || "");
          err.stderr = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr || "");
          reject(err);
          return;
        }
        resolve({
          stdout: Buffer.isBuffer(stdout) ? stdout.toString("utf8") : String(stdout || ""),
          stderr: Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr || ""),
        });
      }
    );
    if (input != null) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

let cachedBin = null;
/** 解析 pandoc 可执行文件：优先 PATH，其次常见安装路径（装完无需重启桥） */
function resolvePandocBin({ refresh = false } = {}) {
  if (cachedBin && !refresh) return cachedBin;
  const candidates = [];
  if (process.platform === "win32") {
    const la = process.env.LOCALAPPDATA || "";
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    if (la) {
      candidates.push(path.join(la, "Pandoc", "pandoc.exe"));
      candidates.push(path.join(la, "Microsoft", "WinGet", "Links", "pandoc.exe"));
    }
    candidates.push(path.join(pf, "Pandoc", "pandoc.exe"));
    candidates.push(path.join(pf86, "Pandoc", "pandoc.exe"));
  } else {
    candidates.push("/opt/homebrew/bin/pandoc", "/usr/local/bin/pandoc", "/usr/bin/pandoc", "/snap/bin/pandoc");
  }
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        cachedBin = c;
        return c;
      }
    } catch (_) {}
  }
  cachedBin = "pandoc"; // 交给 PATH
  return cachedBin;
}

function resolveBridgeRoot() {
  const fromEnv = String(process.env.ADB_BRIDGE_DIR || process.env.DEVTOOLS_BRIDGE_DIR || "").trim();
  if (fromEnv) {
    try {
      if (fs.existsSync(fromEnv)) return path.resolve(fromEnv);
    } catch (_) {}
  }
  return path.resolve(__dirname, "..");
}

function makeBridgeTemp(prefix) {
  const base = path.join(resolveBridgeRoot(), "tmp");
  try {
    fs.mkdirSync(base, { recursive: true });
  } catch (_) {}
  try {
    return fs.mkdtempSync(path.join(base, prefix));
  } catch (_) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  }
}

function resolveCmdCandidates(name) {
  const n = String(name || "").trim();
  const candidates = [];
  if (process.platform === "win32") {
    const la = process.env.LOCALAPPDATA || "";
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    if (n === "typst") {
      if (la) {
        candidates.push(path.join(la, "Microsoft", "WinGet", "Links", "typst.exe"));
        candidates.push(path.join(la, "Programs", "typst", "typst.exe"));
      }
      candidates.push(path.join(pf, "Typst", "typst.exe"));
      candidates.push("typst.exe");
    } else {
      candidates.push(`${n}.exe`);
    }
  } else {
    candidates.push(`/opt/homebrew/bin/${n}`, `/usr/local/bin/${n}`, `/usr/bin/${n}`, n);
  }
  candidates.push(n);
  return candidates;
}

function resolveCmdBin(name, { refresh = false } = {}) {
  const key = String(name || "");
  if (!resolveCmdBin._cache) resolveCmdBin._cache = Object.create(null);
  if (!refresh && resolveCmdBin._cache[key]) return resolveCmdBin._cache[key];
  for (const c of resolveCmdCandidates(key)) {
    try {
      if (c.includes(path.sep) || c.includes("/")) {
        if (fs.existsSync(c)) {
          resolveCmdBin._cache[key] = c;
          return c;
        }
      }
    } catch (_) {}
  }
  resolveCmdBin._cache[key] = key; // PATH
  return key;
}

async function probeCmd(name) {
  const bin = resolveCmdBin(name, { refresh: true });
  try {
    const args = name === "typst" ? ["--version"] : ["--version"];
    const { stdout, stderr } = await runCmd(bin, args, { timeout: 12000 });
    const line = String(stdout || stderr || "")
      .split(/\r?\n/)
      .find((s) => s.trim()) || name;
    return { ok: true, bin, version: line.trim().slice(0, 120) };
  } catch (_) {
    return { ok: false, bin, error: `未找到 ${name}` };
  }
}

async function probePdfEngines() {
  const engines = {};
  for (const name of PDF_ENGINE_ORDER) {
    engines[name] = await probeCmd(name);
  }
  const preferred = PDF_ENGINE_ORDER.find((n) => engines[n]?.ok) || "";
  return { engines, preferred, printReady: !!preferred };
}

function cjkFontVars() {
  const fonts =
    process.platform === "win32"
      ? ["Microsoft YaHei", "SimSun", "Noto Sans CJK SC"]
      : process.platform === "darwin"
        ? ["PingFang SC", "Heiti SC", "Noto Sans CJK SC", "Songti SC"]
        : ["Noto Sans CJK SC", "Source Han Sans SC", "WenQuanYi Micro Hei", "DejaVu Sans"];
  const main = fonts[0];
  return { main, fonts };
}

async function checkPandoc() {
  const bin = resolvePandocBin();
  try {
    const { stdout } = await runCmd(bin, ["--version"], { timeout: 15000 });
    const first = String(stdout || "").split(/\r?\n/)[0] || "pandoc";
    const pdf = await probePdfEngines();
    return {
      ok: true,
      version: first,
      bin,
      importFormats: Object.keys(FILE_FROM),
      pdf,
      features: { printPdf: pdf.printReady, preferredPdfEngine: pdf.preferred || null },
    };
  } catch (err) {
    return { ok: false, error: "未找到 pandoc（可点「一键安装」或手动安装）" };
  }
}

async function hasCmd(cmd) {
  try {
    await runCmd(cmd, ["--version"], { timeout: 12000 });
    return true;
  } catch (err) {
    return /ENOENT/.test(String(err?.code || "")) ? false : true;
  }
}

function safeBase(title) {
  return String(title || "document").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "document";
}

function safeName(name) {
  const base = path.basename(String(name || "document.bin")).replace(/[\\/:*?"<>|]+/g, "_");
  return base.slice(0, 180) || "document.bin";
}

function mimeOfImage(p) {
  const e = path.extname(String(p || "")).toLowerCase();
  if (e === ".png") return "image/png";
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".gif") return "image/gif";
  if (e === ".webp") return "image/webp";
  if (e === ".svg") return "image/svg+xml";
  if (e === ".bmp") return "image/bmp";
  return "application/octet-stream";
}

/** 把 Markdown 里相对图片路径内联为 data URI，便于 MDM 入库后不依赖临时目录 */
function embedLocalImages(md, rootDir) {
  let text = String(md || "");
  let embedded = 0;
  let missing = 0;
  let total = 0;
  const MAX_ONE = 16 * 1024 * 1024;
  const MAX_ALL = 200 * 1024 * 1024;
  const re = /(!?\[[^\]]*\]\()([^)\s]+)(\))/g;
  text = text.replace(re, (full, pre, rawUrl, end) => {
    const url = String(rawUrl || "").trim().replace(/^<|>$/g, "");
    if (!url || /^https?:\/\//i.test(url) || /^data:/i.test(url) || /^#/.test(url)) return full;
    const rel = url.replace(/\\/g, "/").replace(/^\.\//, "");
    const candidates = [
      path.resolve(rootDir, rel),
      path.resolve(rootDir, "media", path.basename(rel)),
      path.resolve(rootDir, path.basename(rel)),
    ];
    let hit = null;
    const rootNorm = path.resolve(rootDir).toLowerCase();
    for (const c of candidates) {
      try {
        const abs = path.resolve(c);
        if (!abs.toLowerCase().startsWith(rootNorm)) continue;
        if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
          hit = abs;
          break;
        }
      } catch (_) {}
    }
    if (!hit) {
      missing += 1;
      return full;
    }
    try {
      const buf = fs.readFileSync(hit);
      if (buf.length > MAX_ONE || total + buf.length > MAX_ALL) {
        missing += 1;
        return full;
      }
      total += buf.length;
      embedded += 1;
      const uri = `data:${mimeOfImage(hit)};base64,${buf.toString("base64")}`;
      return `${pre}${uri}${end}`;
    } catch (_) {
      missing += 1;
      return full;
    }
  });
  if (embedded || missing) {
    console.log(`[pandoc] 图片内联：成功 ${embedded} · 跳过 ${missing} · 约 ${Math.round(total / 1024)} KB`);
  }
  return { text, embedded, missing };
}

function isMarkdownTarget(toFmt) {
  return /^(gfm|markdown|commonmark|commonmark_x|markdown_strict|plain)$/i.test(String(toFmt || ""));
}

/** MD→目标：最高质量附加参数（与 tools/lib/doc-quality-router.js 对齐） */
const EXPORT_QUALITY_ARGS = {
  html: ["--standalone", "--embed-resources"],
  epub: ["--standalone"],
  latex: ["--standalone"],
  gfm: ["--wrap=none"],
  markdown: ["--wrap=none"],
  commonmark: ["--wrap=none"],
};

function writeExportImages(tmp, images) {
  if (!Array.isArray(images)) return;
  for (const im of images.slice(0, 200)) {
    const rel = String(im?.path || "").replace(/\\/g, "/").replace(/\.\.+/g, "").replace(/^\/+/, "");
    if (!rel || !im?.dataBase64) continue;
    const dest = path.join(tmp, rel);
    if (!dest.startsWith(tmp)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, Buffer.from(String(im.dataBase64), "base64"));
  }
}

/** 印刷级 PDF：Pandoc + Typst/XeLaTeX/… */
async function convertToPrintPdf({ text, from = "gfm", title, images, pdfEngine = "" } = {}) {
  const pdfInfo = await probePdfEngines();
  const engine = String(pdfEngine || pdfInfo.preferred || "").trim();
  if (!engine || !pdfInfo.engines[engine]?.ok) {
    const hint =
      process.platform === "win32"
        ? '可点「一键安装 Typst」或 winget install --id Typst.Typst -e'
        : process.platform === "darwin"
          ? "可 brew install typst"
          : "可安装 typst 或 texlive-xetex";
    throw new Error(`未找到印刷级 PDF 引擎（Typst / XeLaTeX）。${hint}`);
  }

  const tmp = makeBridgeTemp("mdm-pdf-");
  const inPath = path.join(tmp, "in.md");
  const outPath = path.join(tmp, "out.pdf");
  const fromFmt = String(from || "gfm").trim() || "gfm";
  const { main: cjkFont } = cjkFontVars();
  fs.writeFileSync(inPath, String(text || ""), "utf8");
  writeExportImages(tmp, images);

  const args = ["-f", fromFmt, "-t", "pdf", `--pdf-engine=${engine}`, "-o", outPath];
  // 中文/CJK：Xe/LuaLaTeX 用 CJKmainfont；Typst 用 mainfont
  if (engine === "xelatex" || engine === "lualatex") {
    args.push("-V", `CJKmainfont=${cjkFont}`, "-V", `mainfont=${cjkFont}`, "--pdf-engine-opt=-interaction=nonstopmode");
  } else if (engine === "typst") {
    args.push("-V", `mainfont=${cjkFont}`);
  }
  if (title) args.push("-V", `title=${String(title).slice(0, 120)}`);

  console.log(`[pandoc] 印刷级 PDF · engine=${engine} · font=${cjkFont} · tmp=${tmp}`);
  try {
    await runCmd(resolvePandocBin(), args, { cwd: tmp, timeout: 900000 });
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 20) {
      throw new Error("PDF 输出为空（请检查字体与 Typst/LaTeX 是否完整）");
    }
    const buf = fs.readFileSync(outPath);
    return {
      dataBase64: buf.toString("base64"),
      filename: `${safeBase(title)}.pdf`,
      engine: "pandoc",
      pdfEngine: engine,
      quality: "print",
      from: fromFmt,
      to: "pdf",
      cjkFont,
    };
  } catch (err) {
    const msg = String(err?.stderr || err?.message || err).trim();
    if (/ENOENT|not recognized|not found/i.test(msg) && /pandoc/i.test(msg)) {
      throw new Error("未找到 pandoc：可点「一键安装 pandoc」");
    }
    throw new Error((msg || "印刷级 PDF 失败").slice(0, 500));
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) {}
  }
}

/** Markdown 文本 → 其它格式（导出，默认最高质量） */
async function convertFromTextOnce({ text, to, from = "gfm", title, images, quality = "max", pdfEngine } = {}) {
  const toFmt = String(to || "").trim().toLowerCase();
  if (!toFmt) throw new Error("缺少目标格式");
  if (toFmt === "pdf") {
    return convertToPrintPdf({ text, from, title, images, pdfEngine });
  }
  const ext = EXT[toFmt] || toFmt;
  const tmp = makeBridgeTemp("mdm-pandoc-");
  const outPath = path.join(tmp, `out.${ext}`);
  const fromFmt = String(from || "gfm").trim() || "gfm";
  try {
    writeExportImages(tmp, images);
    const args = ["-f", fromFmt, "-t", toFmt];
    if (quality !== "fast") {
      const extras = EXPORT_QUALITY_ARGS[toFmt] || [];
      for (const a of extras) args.push(a);
    }
    args.push("-o", outPath);
    console.log(`[pandoc] 文本导出 · ${fromFmt} → ${toFmt} · quality=${quality || "max"} · args=${args.join(" ")}`);
    await runCmd(resolvePandocBin(), args, {
      input: Buffer.from(String(text || ""), "utf8"),
      cwd: tmp,
      timeout: 600000,
    });
    const buf = fs.readFileSync(outPath);
    return {
      dataBase64: buf.toString("base64"),
      filename: `${safeBase(title)}.${ext}`,
      engine: "pandoc",
      quality: quality || "max",
      from: fromFmt,
      to: toFmt,
    };
  } catch (err) {
    const msg = String(err?.stderr || err?.message || err).trim();
    if (/ENOENT|not recognized|not found/i.test(msg)) {
      throw new Error("未找到 pandoc：可点「一键安装 pandoc」");
    }
    const e = new Error(msg.slice(0, 400) || "pandoc 转换失败");
    e.causeMsg = msg;
    throw e;
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) {}
  }
}

async function convertFromText(opts = {}) {
  try {
    return await convertFromTextOnce({ ...opts, quality: opts.quality || "max" });
  } catch (err) {
    const msg = String(err?.causeMsg || err?.message || err);
    // 旧版 pandoc 可能无 --embed-resources：降级重试一次
    if (/embed-resources|Unrecognized option/i.test(msg) && opts.quality !== "fast") {
      console.log("[pandoc] 导出降级重试（去掉不受支持的质量参数）…");
      return convertFromTextOnce({ ...opts, quality: "fast" });
    }
    throw err;
  }
}

/** 结构化文档文件 → Markdown（导入，质量优先于 MinerU flash） */
async function convertFromFile({ filename, dataBase64, to = "gfm", from } = {}) {
  const name = safeName(filename);
  const ext = path.extname(name).toLowerCase();
  const fromFmt = String(from || FILE_FROM[ext] || "").trim();
  if (!fromFmt) {
    throw new Error(`Pandoc 不支持导入该扩展名：${ext || "(无)"}（可用：${Object.keys(FILE_FROM).join(" ")}）`);
  }
  if (!dataBase64) throw new Error("缺少文件数据");
  const buf = Buffer.from(String(dataBase64), "base64");
  if (!buf.length) throw new Error("文件为空");
  if (buf.length > 80 * 1024 * 1024) throw new Error("文件过大（上限 80MB）");

  const toFmt = String(to || "gfm").trim().toLowerCase() || "gfm";
  const outIsMd = isMarkdownTarget(toFmt);
  const outExt = outIsMd ? "md" : EXT[toFmt] || toFmt;
  const tmp = makeBridgeTemp("mdm-pandoc-");
  const inPath = path.join(tmp, name);
  const outPath = path.join(tmp, `out.${outExt}`);
  const mediaDir = path.join(tmp, "media");
  fs.writeFileSync(inPath, buf);

  const args = ["-f", fromFmt, "-t", toFmt];
  if (outIsMd) args.push("--wrap=none");
  args.push("--extract-media", mediaDir, "-o", outPath, inPath);

  console.log(`[pandoc] 文件转换「${name}」· ${fromFmt} → ${toFmt} · tmp=${tmp}`);
  try {
    await runCmd(resolvePandocBin(), args, { cwd: tmp, timeout: 600000 });
    if (outIsMd) {
      let md = fs.readFileSync(outPath, "utf8");
      const embedded = embedLocalImages(md, tmp);
      const hasTable =
        (/^\s*\|.+\|\s*$/m.test(embedded.text) && /\|\s*:?-{3,}/.test(embedded.text)) ||
        /<table[\s>]/i.test(embedded.text);
      return {
        markdown: embedded.text,
        imagesEmbedded: embedded.embedded,
        hasTable: !!hasTable,
        engine: "pandoc",
        filename: name,
        from: fromFmt,
        to: toFmt,
      };
    }
    const outBuf = fs.readFileSync(outPath);
    return {
      dataBase64: outBuf.toString("base64"),
      filename: `${safeBase(path.basename(name, ext))}.${outExt}`,
      engine: "pandoc",
      from: fromFmt,
      to: toFmt,
    };
  } catch (err) {
    const msg = String(err?.stderr || err?.message || err).trim();
    if (/ENOENT|not recognized|not found/i.test(msg)) {
      throw new Error("未找到 pandoc：可点「一键安装 pandoc」");
    }
    throw new Error(msg.slice(0, 500) || "pandoc 转换失败");
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) {}
  }
}

async function convert(body = {}) {
  if (body && body.dataBase64 && body.filename) {
    return convertFromFile(body);
  }
  return convertFromText(body);
}

async function wingetInstall(id) {
  if (!(await hasCmd("winget"))) {
    return {
      installed: false,
      needsManual: true,
      command: `winget install --id ${id} -e`,
      message: "未找到 winget（Windows 10 1809+ 自带）",
    };
  }
  try {
    const { stdout, stderr } = await runCmd(
      "winget",
      [
        "install",
        "--id",
        id,
        "-e",
        "--accept-source-agreements",
        "--accept-package-agreements",
        "--disable-interactivity",
      ],
      { timeout: 900000 }
    );
    return { output: `${stdout}\n${stderr}`.trim().slice(-2000), command: `winget install --id ${id} -e` };
  } catch (err) {
    return {
      output: `${err?.stdout || ""}\n${err?.stderr || ""}`.trim().slice(-2000),
      command: `winget install --id ${id} -e`,
    };
  }
}

async function installPandoc() {
  const platform = process.platform;
  if (platform === "win32") {
    const r = await wingetInstall("JohnMacFarlane.Pandoc");
    resolvePandocBin({ refresh: true });
    const p = await checkPandoc();
    return { ...r, installed: p.ok, pandoc: p };
  }
  if (platform === "darwin") {
    if (await hasCmd("brew")) {
      try {
        const { stdout, stderr } = await runCmd("brew", ["install", "pandoc"], { timeout: 900000 });
        resolvePandocBin({ refresh: true });
        const p = await checkPandoc();
        return { installed: p.ok, output: `${stdout}\n${stderr}`.trim().slice(-2000), pandoc: p, command: "brew install pandoc" };
      } catch (err) {
        return { installed: false, output: `${err?.stderr || err?.message || ""}`.slice(-2000), command: "brew install pandoc" };
      }
    }
    return { installed: false, needsManual: true, command: "brew install pandoc", message: "未找到 Homebrew，请手动安装 pandoc" };
  }
  return {
    installed: false,
    needsManual: true,
    command: "sudo apt install pandoc   # 或 dnf / pacman",
    message: "Linux 安装需要 sudo，请手动执行",
  };
}

/** 安装 Typst（印刷级 PDF 首选引擎，体积远小于完整 TeX） */
async function installTypst() {
  const platform = process.platform;
  if (platform === "win32") {
    const r = await wingetInstall("Typst.Typst");
    resolveCmdBin("typst", { refresh: true });
    const pdf = await probePdfEngines();
    return {
      ...r,
      installed: !!pdf.engines.typst?.ok,
      pdf,
      package: "typst",
    };
  }
  if (platform === "darwin") {
    if (await hasCmd("brew")) {
      try {
        const { stdout, stderr } = await runCmd("brew", ["install", "typst"], { timeout: 900000 });
        resolveCmdBin("typst", { refresh: true });
        const pdf = await probePdfEngines();
        return {
          installed: !!pdf.engines.typst?.ok,
          output: `${stdout}\n${stderr}`.trim().slice(-2000),
          pdf,
          command: "brew install typst",
          package: "typst",
        };
      } catch (err) {
        return {
          installed: false,
          output: `${err?.stderr || err?.message || ""}`.slice(-2000),
          command: "brew install typst",
          package: "typst",
        };
      }
    }
    return {
      installed: false,
      needsManual: true,
      command: "brew install typst",
      message: "未找到 Homebrew",
      package: "typst",
    };
  }
  return {
    installed: false,
    needsManual: true,
    command: "请按 https://github.com/typst/typst 安装 typst，或 sudo apt install typst（若源可用）",
    message: "Linux 请手动安装 Typst",
    package: "typst",
  };
}

async function installPackage(body = {}) {
  const pkg = String(body.package || body.pkg || "pandoc").toLowerCase();
  if (pkg === "typst" || pkg === "pdf" || pkg === "pdf-engine") return installTypst();
  return installPandoc();
}

module.exports = {
  checkPandoc,
  convert,
  convertFromFile,
  convertFromText,
  convertToPrintPdf,
  installPandoc,
  installTypst,
  installPackage,
  probePdfEngines,
  resolvePandocBin,
  FILE_FROM,
  PDF_ENGINE_ORDER,
};
