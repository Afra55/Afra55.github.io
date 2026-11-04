"use strict";

/**
 * Pandoc 转换 + 一键安装（本机桥模块）。
 * - 文本模式：Markdown → docx/odt/epub/pdf/…（MDM / 文档互转导出）
 * - 文件模式：docx/odt/epub/html/… → Markdown 或其它格式（文档互转：Word↔PDF 等）
 */

const { execFile, spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const https = require("https");
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

/** 印刷级 PDF：只保留效果最好的 XeLaTeX（复杂图表 + 中文排版） */
const PDF_ENGINE_ORDER = ["xelatex"];

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

/**
 * 安装类命令：stdio 继承到桥黑窗。
 * winget 在 pipe 模式下几乎不吐进度，黑窗会像卡住；inherit 才能看见下载条。
 */
function runCmdInherit(file, args, { timeout = 900000, cwd, logPrefix = "[pandoc]" } = {}) {
  const label = [file, ...(args || [])].join(" ");
  console.log(`${logPrefix} ▶ ${label}`);
  console.log(`${logPrefix} （安装器输出直接显示在下方；若长时间无字请稍候）`);
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      windowsHide: false,
      shell: false,
      stdio: ["ignore", "inherit", "inherit"],
    });
    let settled = false;
    const t0 = Date.now();
    const beat = setInterval(() => {
      const sec = Math.round((Date.now() - t0) / 1000);
      console.log(`${logPrefix} …仍在安装 · 已用时 ${sec}s`);
    }, 8000);
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch (_) {}
      finish(() => {
        const err = new Error("安装超时");
        err.stdout = "";
        err.stderr = "timeout";
        reject(err);
      });
    }, timeout);

    function finish(fn) {
      if (settled) return;
      settled = true;
      clearInterval(beat);
      clearTimeout(timer);
      fn();
    }

    child.on("error", (err) => {
      finish(() => {
        err.stdout = "";
        err.stderr = err.message;
        reject(err);
      });
    });
    child.on("close", (code) => {
      finish(() => {
        const sec = Math.round((Date.now() - t0) / 1000);
        // winget「已安装」有时非 0；交给后续探测判断成败
        console.log(`${logPrefix} ✔ 命令结束 · exit=${code} · ${sec}s`);
        resolve({ stdout: "", stderr: "", code: code == null ? 1 : code });
      });
    });
  });
}

/** @deprecated 兼容旧调用；安装请用 runCmdInherit */
function runCmdLive(file, args, opts = {}) {
  return runCmdInherit(file, args, opts);
}

function typstBridgeBinDir() {
  return path.join(resolveBridgeRoot(), "bin", "typst");
}

function typstBridgeBinPath() {
  const exe = process.platform === "win32" ? "typst.exe" : "typst";
  return path.join(typstBridgeBinDir(), exe);
}

/** 递归找 typst 可执行文件（限制深度，避免扫盘） */
function findTypstInDir(dir, depth = 0) {
  if (!dir || depth > 4) return "";
  try {
    if (!fs.existsSync(dir)) return "";
    const want = process.platform === "win32" ? "typst.exe" : "typst";
    const direct = path.join(dir, want);
    if (fs.existsSync(direct)) return direct;
    for (const name of fs.readdirSync(dir)) {
      if (name === want) return path.join(dir, name);
      const p = path.join(dir, name);
      let st;
      try {
        st = fs.statSync(p);
      } catch (_) {
        continue;
      }
      if (!st.isDirectory()) continue;
      if (/node_modules|\.git|__pycache__/i.test(name)) continue;
      const hit = findTypstInDir(p, depth + 1);
      if (hit) return hit;
    }
  } catch (_) {}
  return "";
}

async function whereCmd(name) {
  if (process.platform === "win32") {
    try {
      const { stdout } = await runCmd("where.exe", [name], { timeout: 12000 });
      return (
        String(stdout || "")
          .split(/\r?\n/)
          .map((s) => s.trim())
          .find((s) => s && fs.existsSync(s)) || ""
      );
    } catch (_) {
      return "";
    }
  }
  try {
    const { stdout } = await runCmd("which", [name], { timeout: 12000 });
    const p = String(stdout || "").trim().split(/\r?\n/)[0] || "";
    return p && fs.existsSync(p) ? p : "";
  } catch (_) {
    return "";
  }
}

/** 尽量找到本机 typst；优先桥自带目录 */
async function locateTypstBinary() {
  const local = typstBridgeBinPath();
  if (fs.existsSync(local)) return local;

  for (const c of resolveCmdCandidates("typst")) {
    try {
      if ((c.includes(path.sep) || c.includes("/")) && fs.existsSync(c)) return c;
    } catch (_) {}
  }

  const fromWhere = await whereCmd(process.platform === "win32" ? "typst.exe" : "typst");
  if (fromWhere) return fromWhere;

  if (process.platform === "win32") {
    const la = process.env.LOCALAPPDATA || "";
    if (la) {
      const hit = findTypstInDir(path.join(la, "Microsoft", "WinGet", "Packages"));
      if (hit) return hit;
      const hit2 = findTypstInDir(path.join(la, "Microsoft", "WinGet", "Links"));
      if (hit2) return hit2;
    }
    const scoop = path.join(process.env.USERPROFILE || "", "scoop", "apps", "typst");
    const hit3 = findTypstInDir(scoop);
    if (hit3) return hit3;
  }

  return "";
}

function downloadToFile(url, dest, { logPrefix = "[pandoc]", timeout = 1800000 } = {}) {
  return new Promise((resolve, reject) => {
    const idleMs = Math.min(Math.max(Number(timeout) || 1800000, 60000), 1800000);
    const follow = (u, n = 0) => {
      if (n > 10) return reject(new Error("下载重定向过多"));
      const mod = String(u).startsWith("https") ? https : http;
      const req = mod.get(
        u,
        {
          headers: { "User-Agent": "devtools-bridge-pandoc", Accept: "*/*" },
          timeout: idleMs,
        },
        (res) => {
          if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
            res.resume();
            const next = new URL(res.headers.location, u).href;
            console.log(`${logPrefix} 跟随重定向…`);
            return follow(next, n + 1);
          }
          if (res.statusCode !== 200) {
            res.resume();
            return reject(new Error(`下载失败 HTTP ${res.statusCode}`));
          }
          const total = Number(res.headers["content-length"]) || 0;
          let got = 0;
          let lastLog = 0;
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          const out = fs.createWriteStream(dest);
          res.on("data", (chunk) => {
            got += chunk.length;
            const now = Date.now();
            if (now - lastLog >= 400) {
              lastLog = now;
              if (total > 0) {
                const pct = Math.min(100, Math.round((got / total) * 100));
                console.log(
                  `${logPrefix} 下载中… ${pct}% · ${(got / 1048576).toFixed(1)}/${(total / 1048576).toFixed(1)} MB`
                );
              } else {
                console.log(`${logPrefix} 下载中… ${(got / 1048576).toFixed(1)} MB`);
              }
            }
          });
          res.pipe(out);
          out.on("finish", () => {
            console.log(`${logPrefix} 下载完成 · ${(got / 1048576).toFixed(1)} MB`);
            resolve({ bytes: got });
          });
          out.on("error", reject);
        }
      );
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("下载超时"));
      });
    };
    follow(url);
  });
}

function typstReleaseAsset() {
  const arch = process.arch === "arm64" ? "aarch64" : "x86_64";
  if (process.platform === "win32") {
    return {
      url: `https://github.com/typst/typst/releases/latest/download/typst-${arch}-pc-windows-msvc.zip`,
      kind: "zip",
    };
  }
  if (process.platform === "darwin") {
    return {
      url: `https://github.com/typst/typst/releases/latest/download/typst-${arch}-apple-darwin.tar.xz`,
      kind: "tarxz",
    };
  }
  return {
    url: `https://github.com/typst/typst/releases/latest/download/typst-${arch}-unknown-linux-musl.tar.xz`,
    kind: "tarxz",
  };
}

async function extractTypstArchive(archivePath, destDir, kind) {
  fs.mkdirSync(destDir, { recursive: true });
  if (kind === "zip") {
    if (process.platform === "win32") {
      await runCmdInherit(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
        ],
        { timeout: 180000, logPrefix: "[pandoc/typst]" }
      );
      return;
    }
    await runCmd("unzip", ["-o", archivePath, "-d", destDir], { timeout: 180000 });
    return;
  }
  // tar.xz
  await runCmd("tar", ["-xJf", archivePath, "-C", destDir], { timeout: 180000 });
}

/** 从 GitHub Release 下载便携 Typst 到桥目录（有明确百分比进度） */
async function installTypstPortable() {
  const asset = typstReleaseAsset();
  const destDir = typstBridgeBinDir();
  const tmpDir = makeBridgeTemp("typst-dl-");
  const archive = path.join(tmpDir, asset.kind === "zip" ? "typst.zip" : "typst.tar.xz");
  console.log(`[pandoc/typst] 改为下载官方便携包（黑窗可见百分比）…`);
  console.log(`[pandoc/typst] ${asset.url}`);
  try {
    await downloadToFile(asset.url, archive, { logPrefix: "[pandoc/typst]" });
    console.log(`[pandoc/typst] 正在解压到 ${destDir}`);
    await extractTypstArchive(archive, destDir, asset.kind);
    // zip/tar 往往带一层目录，把 typst 提到 destDir
    let bin = findTypstInDir(destDir);
    if (bin && path.dirname(bin) !== destDir) {
      const target = typstBridgeBinPath();
      try {
        fs.copyFileSync(bin, target);
        bin = target;
      } catch (_) {}
    }
    if (!bin || !fs.existsSync(bin)) {
      bin = await locateTypstBinary();
    }
    if (!bin) throw new Error("解压后未找到 typst 可执行文件");
    try {
      fs.chmodSync(bin, 0o755);
    } catch (_) {}
    resolveCmdBin._cache = resolveCmdBin._cache || Object.create(null);
    resolveCmdBin._cache.typst = bin;
    console.log(`[pandoc/typst] 便携包就绪 · ${bin}`);
    return { ok: true, bin, command: `portable:${asset.url}` };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
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
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    if (n === "xelatex") {
      const tiny = findXelatexInTinytex(tinytexBridgeRoot());
      if (tiny) candidates.push(tiny);
      for (const root of [pf, pf86, la ? path.join(la, "Programs") : "", la || ""]) {
        if (!root) continue;
        candidates.push(path.join(root, "MiKTeX", "miktex", "bin", "x64", "xelatex.exe"));
        candidates.push(path.join(root, "MiKTeX", "miktex", "bin", "win64", "xelatex.exe"));
        candidates.push(path.join(root, "MiKTeX", "miktex", "bin", "xelatex.exe"));
      }
      candidates.push("xelatex.exe");
    } else {
      candidates.push(`${n}.exe`);
    }
  } else {
    if (n === "xelatex") {
      const tiny = findXelatexInTinytex(tinytexBridgeRoot());
      if (tiny) candidates.push(tiny);
      candidates.push(
        "/Library/TeX/texbin/xelatex",
        "/usr/local/texlive/2025/bin/universal-darwin/xelatex",
        "/usr/local/texlive/2024/bin/universal-darwin/xelatex",
        "/usr/local/texlive/2025/bin/x86_64-linux/xelatex",
        "/usr/local/texlive/2024/bin/x86_64-linux/xelatex"
      );
    }
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
  let bin = resolveCmdBin(name, { refresh: true });
  if (name === "xelatex") {
    const located = await locateXelatexBinary();
    if (located) {
      bin = located;
      resolveCmdBin._cache = resolveCmdBin._cache || Object.create(null);
      resolveCmdBin._cache.xelatex = located;
    }
  }
  try {
    const { stdout, stderr } = await runCmd(bin, ["--version"], { timeout: 12000 });
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

/** pandoc --pdf-engine 优先用绝对路径（MiKTeX 装完 PATH 未刷新也能找到） */
function pdfEngineCliArg(engineName, pdfInfo) {
  const name = String(engineName || "").trim();
  const bin = String(pdfInfo?.engines?.[name]?.bin || "").trim();
  if (bin && (bin.includes(path.sep) || bin.includes("/")) && fs.existsSync(bin)) return bin;
  return name;
}

/** 印刷级 PDF：仅 XeLaTeX（复杂图表 + 中文） */
async function convertToPrintPdf({ text, from = "gfm", title, images, pdfEngine = "" } = {}) {
  const pdfInfo = await probePdfEngines();
  const engine = String(pdfEngine || pdfInfo.preferred || "").trim() || "xelatex";
  if (!pdfInfo.engines.xelatex?.ok && !pdfInfo.engines[engine]?.ok) {
    const hint =
      process.platform === "win32"
        ? "可一键安装 MiKTeX（XeLaTeX）或 winget install --id MiKTeX.MiKTeX -e"
        : process.platform === "darwin"
          ? "可 brew install --cask basictex"
          : "请安装 texlive-xetex";
    throw new Error(`未找到印刷级 PDF 引擎（XeLaTeX）。${hint}`);
  }
  const useEngine = pdfInfo.engines.xelatex?.ok ? "xelatex" : engine;

  const tmp = makeBridgeTemp("mdm-pdf-");
  const inPath = path.join(tmp, "in.md");
  const outPath = path.join(tmp, "out.pdf");
  const fromFmt = String(from || "gfm").trim() || "gfm";
  const { main: cjkFont } = cjkFontVars();
  fs.writeFileSync(inPath, String(text || ""), "utf8");
  writeExportImages(tmp, images);

  const engineCli = pdfEngineCliArg(useEngine, pdfInfo);
  const args = ["-f", fromFmt, "-t", "pdf", `--pdf-engine=${engineCli}`, "-o", outPath];
  // 中文 + 页边距；复杂图表依赖前端先烤成高清 PNG
  args.push(
    "-V",
    `CJKmainfont=${cjkFont}`,
    "-V",
    `mainfont=${cjkFont}`,
    "-V",
    "geometry:margin=2cm",
    "--pdf-engine-opt=-interaction=nonstopmode"
  );
  if (title) args.push("-V", `title=${String(title).slice(0, 120)}`);

  console.log(`[pandoc] 印刷级 PDF · engine=${useEngine} · bin=${engineCli} · font=${cjkFont} · tmp=${tmp}`);
  try {
    await runCmd(resolvePandocBin(), args, { cwd: tmp, timeout: 900000 });
    if (!fs.existsSync(outPath) || fs.statSync(outPath).size < 20) {
      throw new Error("PDF 输出为空（请检查字体与 XeLaTeX/MiKTeX 是否完整）");
    }
    const buf = fs.readFileSync(outPath);
    return {
      dataBase64: buf.toString("base64"),
      filename: `${safeBase(title)}.pdf`,
      engine: "pandoc",
      pdfEngine: useEngine,
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
async function convertFromFile({ filename, dataBase64, to = "gfm", from, pdfEngine = "", quality = "max" } = {}) {
  const name = safeName(filename);
  const ext = path.extname(name).toLowerCase();
  const fromFmt = String(from || FILE_FROM[ext] || "").trim();
  if (!fromFmt) {
    throw new Error(`Pandoc 不支持直接导入该扩展名：${ext || "(无)"}（可用：${Object.keys(FILE_FROM).join(" ")}；PDF/扫描件请走 MinerU 路由）`);
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

  /** @type {string[]} */
  let args;
  let usedPdfEngine = "";
  if (toFmt === "pdf") {
    const pdfInfo = await probePdfEngines();
    usedPdfEngine = pdfInfo.engines.xelatex?.ok
      ? "xelatex"
      : String(pdfEngine || pdfInfo.preferred || "").trim();
    if (!usedPdfEngine || !pdfInfo.engines[usedPdfEngine]?.ok) {
      const hint =
        process.platform === "win32"
          ? "可一键安装 MiKTeX（XeLaTeX）或 winget install --id MiKTeX.MiKTeX -e"
          : process.platform === "darwin"
            ? "可 brew install --cask basictex"
            : "请安装 texlive-xetex";
      throw new Error(`未找到印刷级 PDF 引擎（XeLaTeX）。${hint}`);
    }
    const engineCli = pdfEngineCliArg(usedPdfEngine, pdfInfo);
    const { main: cjkFont } = cjkFontVars();
    args = [
      "-f",
      fromFmt,
      "-t",
      "pdf",
      `--pdf-engine=${engineCli}`,
      "-V",
      `CJKmainfont=${cjkFont}`,
      "-V",
      `mainfont=${cjkFont}`,
      "-V",
      "geometry:margin=2cm",
      "--pdf-engine-opt=-interaction=nonstopmode",
      "-o",
      outPath,
      inPath,
    ];
  } else {
    args = ["-f", fromFmt, "-t", toFmt];
    if (outIsMd) args.push("--wrap=none");
    if (quality !== "fast") {
      const extras = EXPORT_QUALITY_ARGS[toFmt] || [];
      for (const a of extras) args.push(a);
    }
    args.push("--extract-media", mediaDir, "-o", outPath, inPath);
  }

  console.log(`[pandoc] 文件转换「${name}」· ${fromFmt} → ${toFmt}${usedPdfEngine ? ` · pdf-engine=${usedPdfEngine}` : ""} · tmp=${tmp}`);
  try {
    await runCmd(resolvePandocBin(), args, { cwd: tmp, timeout: 600000 });
    if (outIsMd) {
      const md = fs.readFileSync(outPath, "utf8");
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
    if (!outBuf.length) throw new Error("输出为空");
    return {
      dataBase64: outBuf.toString("base64"),
      filename: `${safeBase(path.basename(name, ext))}.${outExt}`,
      engine: "pandoc",
      from: fromFmt,
      to: toFmt,
      ...(usedPdfEngine ? { pdfEngine: usedPdfEngine, quality: "print" } : { quality: quality || "max" }),
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

async function wingetInstall(id, extraArgs = []) {
  if (!(await hasCmd("winget"))) {
    return {
      installed: false,
      needsManual: true,
      command: `winget install --id ${id} -e`,
      message: "未找到 winget（Windows 10 1809+ 自带）",
    };
  }
  const extras = Array.isArray(extraArgs) ? extraArgs.filter(Boolean) : [];
  console.log(`[pandoc] winget 安装 ${id}${extras.length ? " " + extras.join(" ") : ""}（进度直接刷在黑窗）…`);
  try {
    const { code } = await runCmdInherit(
      "winget",
      [
        "install",
        "--id",
        id,
        "-e",
        "--accept-source-agreements",
        "--accept-package-agreements",
        "--disable-interactivity",
        ...extras,
      ],
      { timeout: 1800000, logPrefix: "[pandoc/winget]" }
    );
    return {
      output: `winget exit=${code}`,
      command: `winget install --id ${id} -e ${extras.join(" ")}`.trim(),
      wingetCode: code,
    };
  } catch (err) {
    console.log(`[pandoc/winget] 异常：${err?.message || err}`);
    return {
      output: `${err?.stderr || err?.message || ""}`.trim().slice(-2000),
      command: `winget install --id ${id} -e`,
    };
  }
}

/** 安装后刷新进程 PATH（winget/MiKTeX 常改注册表但不更新当前桥进程） */
function refreshWindowsPathEnv() {
  if (process.platform !== "win32") return;
  try {
    const { execFileSync } = require("child_process");
    const read = (key) => {
      try {
        const out = execFileSync("reg", ["query", key, "/v", "Path"], {
          encoding: "utf8",
          windowsHide: true,
          timeout: 8000,
        });
        const m = String(out).match(/Path\s+REG_(?:EXPAND_)?SZ\s+(.+)/i);
        return m ? m[1].trim() : "";
      } catch (_) {
        return "";
      }
    };
    const machine = read("HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment");
    const user = read("HKCU\\Environment");
    const cur = process.env.PATH || "";
    const merged = [user, machine, cur].filter(Boolean).join(";");
    if (merged) process.env.PATH = merged;
    console.log("[pandoc] 已刷新进程 PATH（合并用户/系统）");
  } catch (err) {
    console.log(`[pandoc] PATH 刷新跳过：${err?.message || err}`);
  }
}

function tinytexBridgeRoot() {
  return path.join(resolveBridgeRoot(), "bin", "tinytex");
}

/** 在 TinyTeX 解压目录里找 xelatex */
function findXelatexInTinytex(root, depth = 0) {
  if (!root || depth > 5) return "";
  try {
    if (!fs.existsSync(root)) return "";
    const want = process.platform === "win32" ? "xelatex.exe" : "xelatex";
    const direct = path.join(root, want);
    if (fs.existsSync(direct)) return direct;
    // 常见布局：bin/windows、bin/universal-darwin、bin/x86_64-linux
    for (const rel of ["bin/windows", "bin/universal-darwin", "bin/x86_64-linux", "bin/aarch64-linux"]) {
      const p = path.join(root, rel, want);
      if (fs.existsSync(p)) return p;
    }
    for (const name of fs.readdirSync(root)) {
      if (name === want) return path.join(root, name);
      const p = path.join(root, name);
      let st;
      try {
        st = fs.statSync(p);
      } catch (_) {
        continue;
      }
      if (!st.isDirectory()) continue;
      if (/node_modules|\.git|__pycache__/i.test(name)) continue;
      const hit = findXelatexInTinytex(p, depth + 1);
      if (hit) return hit;
    }
  } catch (_) {}
  return "";
}

function tinytexBinDirFromXelatex(xelatexBin) {
  return xelatexBin ? path.dirname(xelatexBin) : "";
}

function prependPath(dir) {
  if (!dir) return;
  const cur = process.env.PATH || "";
  const parts = cur.split(path.delimiter);
  if (parts.includes(dir)) return;
  process.env.PATH = `${dir}${path.delimiter}${cur}`;
}

function tinytexReleaseAsset() {
  if (process.platform === "win32") {
    return {
      url: "https://github.com/rstudio/tinytex-releases/releases/latest/download/TinyTeX-1.zip",
      kind: "zip",
    };
  }
  if (process.platform === "darwin") {
    return {
      url: "https://github.com/rstudio/tinytex-releases/releases/latest/download/TinyTeX-1.tgz",
      kind: "tgz",
    };
  }
  return {
    url: "https://github.com/rstudio/tinytex-releases/releases/latest/download/TinyTeX-1.tgz",
    kind: "tgz",
  };
}

async function extractTinytexArchive(archivePath, destDir, kind) {
  fs.mkdirSync(destDir, { recursive: true });
  if (kind === "zip") {
    if (process.platform === "win32") {
      await runCmdInherit(
        "powershell.exe",
        [
          "-NoProfile",
          "-Command",
          `Expand-Archive -LiteralPath '${archivePath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force`,
        ],
        { timeout: 600000, logPrefix: "[pandoc/tinytex]" }
      );
      return;
    }
    await runCmd("unzip", ["-o", archivePath, "-d", destDir], { timeout: 600000 });
    return;
  }
  await runCmd("tar", ["-xzf", archivePath, "-C", destDir], { timeout: 600000 });
}

/** Pandoc + XeLaTeX + 中文常用宏包（TinyTeX 精简包需补装） */
async function ensureTinytexPandocPackages(xelatexBin) {
  const binDir = tinytexBinDirFromXelatex(xelatexBin);
  if (!binDir) return;
  prependPath(binDir);
  const pkgs = [
    "latex-bin",
    "xetex",
    "fontspec",
    "xecjk",
    "ctex",
    "geometry",
    "fancyhdr",
    "setspace",
    "booktabs",
    "longtable",
    "fancyvrb",
    "hyperref",
    "xcolor",
    "graphics",
    "tools",
    "amsmath",
    "unicode-math",
    "lm",
    "lm-math",
  ];
  console.log("[pandoc/tinytex] 补装 Pandoc/中文常用宏包（黑窗可见）…");
  try {
    if (process.platform === "win32") {
      // .bat 必须经 cmd，否则 spawn shell:false 会立刻失败
      await runCmdInherit("cmd.exe", ["/d", "/s", "/c", "tlmgr install " + pkgs.join(" ")], {
        timeout: 1800000,
        cwd: binDir,
        logPrefix: "[pandoc/tlmgr]",
      });
    } else {
      const tlmgr = path.join(binDir, "tlmgr");
      await runCmdInherit(fs.existsSync(tlmgr) ? tlmgr : "tlmgr", ["install", ...pkgs], {
        timeout: 1800000,
        cwd: binDir,
        logPrefix: "[pandoc/tlmgr]",
      });
    }
  } catch (err) {
    console.log(`[pandoc/tlmgr] 部分宏包可能已存在或失败：${err?.message || err}`);
  }
}

/**
 * 下载 TinyTeX 到桥目录（自带 xelatex；黑窗有下载百分比）。
 * 比 winget MiKTeX 更稳：不需要管理员，也不会因 UAC 几秒就失败。
 */
async function installTinytexPortable() {
  const asset = tinytexReleaseAsset();
  const destDir = tinytexBridgeRoot();
  const tmpDir = makeBridgeTemp("tinytex-dl-");
  const archive = path.join(tmpDir, asset.kind === "zip" ? "TinyTeX.zip" : "TinyTeX.tgz");
  console.log("[pandoc/tinytex] 下载精简 TeX（含 XeLaTeX，约 100–200MB+）…");
  console.log(`[pandoc/tinytex] ${asset.url}`);
  try {
    await downloadToFile(asset.url, archive, { logPrefix: "[pandoc/tinytex]", timeout: 1800000 });
    console.log(`[pandoc/tinytex] 正在解压到 ${destDir}`);
    try {
      fs.rmSync(destDir, { recursive: true, force: true });
    } catch (_) {}
    fs.mkdirSync(destDir, { recursive: true });
    await extractTinytexArchive(archive, destDir, asset.kind);
    let bin = findXelatexInTinytex(destDir);
    if (!bin) {
      // 解压可能多一层 TinyTeX/
      bin = findXelatexInTinytex(destDir);
    }
    if (!bin) throw new Error("解压后未找到 xelatex");
    prependPath(path.dirname(bin));
    resolveCmdBin._cache = resolveCmdBin._cache || Object.create(null);
    resolveCmdBin._cache.xelatex = bin;
    await ensureTinytexPandocPackages(bin);
    console.log(`[pandoc/tinytex] 就绪 · ${bin}`);
    return { bin, command: `tinytex-portable:${asset.url}`, destDir };
  } finally {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

async function installPandoc() {
  const platform = process.platform;
  console.log("[pandoc] 准备安装 pandoc…");
  if (platform === "win32") {
    const r = await wingetInstall("JohnMacFarlane.Pandoc");
    resolvePandocBin({ refresh: true });
    const p = await checkPandoc();
    console.log(`[pandoc] pandoc 探测：${p.ok ? "已就绪 " + (p.version || "") : "仍未找到"}`);
    return { ...r, installed: p.ok, pandoc: p };
  }
  if (platform === "darwin") {
    if (await hasCmd("brew")) {
      try {
        const { stdout, stderr } = await runCmdLive("brew", ["install", "pandoc"], {
          timeout: 900000,
          logPrefix: "[pandoc/brew]",
        });
        resolvePandocBin({ refresh: true });
        const p = await checkPandoc();
        console.log(`[pandoc] pandoc 探测：${p.ok ? "已就绪 " + (p.version || "") : "仍未找到"}`);
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

async function finalizeTypstProbe(extra = {}) {
  resolveCmdBin("typst", { refresh: true });
  const located = await locateTypstBinary();
  if (located) {
    resolveCmdBin._cache = resolveCmdBin._cache || Object.create(null);
    resolveCmdBin._cache.typst = located;
  }
  const pdf = await probePdfEngines();
  const ok = !!pdf.engines.typst?.ok;
  console.log(
    `[pandoc] Typst 探测：${ok ? "已就绪 · " + (pdf.engines.typst?.bin || located || "") : "仍未找到"} · preferred=${pdf.preferred || "-"}`
  );
  return { installed: ok, pdf, package: "typst", bin: pdf.engines.typst?.bin || located || "", ...extra };
}

/** @deprecated 印刷级 PDF 已改为仅 XeLaTeX；保留符号以免旧调用崩 */
async function installTypst() {
  console.log("[pandoc] 印刷级 PDF 仅保留 XeLaTeX，改走 MiKTeX/xelatex 安装…");
  return installXelatex();
}

async function locateXelatexBinary() {
  // 桥自带 TinyTeX 优先
  {
    const tiny = findXelatexInTinytex(tinytexBridgeRoot());
    if (tiny) {
      prependPath(path.dirname(tiny));
      return tiny;
    }
  }
  const candidates = [];
  if (process.platform === "win32") {
    const la = process.env.LOCALAPPDATA || "";
    const pf = process.env.ProgramFiles || "C:\\Program Files";
    const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const home = process.env.USERPROFILE || "";
    for (const root of [pf, pf86, la ? path.join(la, "Programs") : "", la, home]) {
      if (!root) continue;
      candidates.push(path.join(root, "MiKTeX", "miktex", "bin", "x64", "xelatex.exe"));
      candidates.push(path.join(root, "MiKTeX", "miktex", "bin", "win64", "xelatex.exe"));
      candidates.push(path.join(root, "MiKTeX", "miktex", "bin", "xelatex.exe"));
    }
    // TinyTeX 默认用户目录
    if (home) {
      candidates.push(path.join(home, "AppData", "Roaming", "TinyTeX", "bin", "windows", "xelatex.exe"));
      candidates.push(path.join(home, ".TinyTeX", "bin", "windows", "xelatex.exe"));
    }
    candidates.push("xelatex.exe");
  } else {
    const home = os.homedir();
    candidates.push(
      path.join(home, ".TinyTeX", "bin", "universal-darwin", "xelatex"),
      path.join(home, ".TinyTeX", "bin", "x86_64-linux", "xelatex"),
      path.join(home, ".TinyTeX", "bin", "aarch64-linux", "xelatex"),
      path.join(home, "Library", "TinyTeX", "bin", "universal-darwin", "xelatex"),
      "/Library/TeX/texbin/xelatex",
      "/usr/local/texlive/2025/bin/universal-darwin/xelatex",
      "/usr/local/texlive/2024/bin/universal-darwin/xelatex",
      "/usr/local/texlive/2025/bin/x86_64-linux/xelatex",
      "/usr/local/texlive/2024/bin/x86_64-linux/xelatex",
      "/usr/bin/xelatex",
      "xelatex"
    );
  }
  for (const c of candidates) {
    try {
      if ((c.includes(path.sep) || c.includes("/")) && fs.existsSync(c)) {
        prependPath(path.dirname(c));
        return c;
      }
    } catch (_) {}
  }
  return whereCmd(process.platform === "win32" ? "xelatex.exe" : "xelatex");
}

async function finalizeXelatexProbe(extra = {}) {
  resolveCmdBin("xelatex", { refresh: true });
  const located = await locateXelatexBinary();
  if (located) {
    resolveCmdBin._cache = resolveCmdBin._cache || Object.create(null);
    resolveCmdBin._cache.xelatex = located;
  }
  const pdf = await probePdfEngines();
  const ok = !!pdf.engines.xelatex?.ok;
  console.log(
    `[pandoc] XeLaTeX 探测：${ok ? "已就绪 · " + (pdf.engines.xelatex?.bin || located || "") : "仍未找到"}`
  );
  return {
    installed: ok,
    pdf,
    package: "xelatex",
    bin: pdf.engines.xelatex?.bin || located || "",
    ...extra,
  };
}

/** 安装 XeLaTeX：先试本机已有 → winget 用户级 MiKTeX → 失败则 TinyTeX 便携包（有下载进度） */
async function installXelatex() {
  const platform = process.platform;
  console.log("[pandoc] 准备安装 XeLaTeX（印刷级唯一引擎；复杂图表 + 中文）…");

  {
    const existing = await locateXelatexBinary();
    if (existing) {
      console.log(`[pandoc] 已找到 XeLaTeX：${existing}`);
      return finalizeXelatexProbe({ command: "already-present", output: existing });
    }
  }

  let last = { command: "", output: "", message: "" };

  // Windows：先 winget --scope user（避免管理员 UAC 几秒就失败），再 TinyTeX 便携
  if (platform === "win32" && (await hasCmd("winget"))) {
    console.log("[pandoc] 尝试 winget 用户级安装 MiKTeX（无需管理员）…");
    last = await wingetInstall("MiKTeX.MiKTeX", ["--scope", "user"]);
    refreshWindowsPathEnv();
    await new Promise((res) => setTimeout(res, 1500));
    let hit = await locateXelatexBinary();
    if (!hit) {
      await new Promise((res) => setTimeout(res, 2500));
      hit = await locateXelatexBinary();
    }
    if (hit) return finalizeXelatexProbe(last);
    console.log("[pandoc] winget 用户级后仍未找到 xelatex，改下 TinyTeX 便携包…");
  } else if (platform === "win32") {
    console.log("[pandoc] 无 winget，改下 TinyTeX 便携包…");
  }

  if (platform === "darwin" && (await hasCmd("brew"))) {
    try {
      console.log("[pandoc] 尝试 brew cask 安装 BasicTeX…");
      await runCmdInherit("brew", ["install", "--cask", "basictex"], {
        timeout: 1800000,
        logPrefix: "[pandoc/brew]",
      });
      process.env.PATH = `/Library/TeX/texbin:${process.env.PATH || ""}`;
      last = { command: "brew install --cask basictex", output: "" };
      const hit = await locateXelatexBinary();
      if (hit) return finalizeXelatexProbe(last);
      console.log("[pandoc] BasicTeX 后仍未定位，改下 TinyTeX 便携包…");
    } catch (err) {
      last = { command: "brew install --cask basictex", output: String(err?.message || err), message: String(err?.message || err) };
      console.log(`[pandoc/brew] 失败：${last.output}，改下 TinyTeX…`);
    }
  }

  // 主回退：TinyTeX 便携（下载有百分比，不会「几秒假失败」）
  try {
    const portable = await installTinytexPortable();
    refreshWindowsPathEnv();
    prependPath(path.dirname(portable.bin));
    return finalizeXelatexProbe({
      command: portable.command,
      output: portable.bin,
    });
  } catch (err) {
    const msg = String(err?.message || err);
    console.log(`[pandoc/tinytex] 便携包安装失败：${msg}`);
    return {
      installed: false,
      needsManual: true,
      package: "xelatex",
      command:
        platform === "win32"
          ? "winget install --id MiKTeX.MiKTeX -e --scope user"
          : platform === "darwin"
            ? "brew install --cask basictex"
            : "sudo apt install texlive-xetex texlive-lang-chinese",
      message: msg || "XeLaTeX 安装失败（请看黑窗；也可手动装 MiKTeX/BasicTeX）",
      output: last.output || msg,
      pdf: await probePdfEngines(),
    };
  }
}

async function installPackage(body = {}) {
  const pkg = String(body.package || body.pkg || "pandoc").toLowerCase();
  // 印刷级 PDF 只认 XeLaTeX；旧前端传 typst 也改走 xelatex
  if (
    pkg === "typst" ||
    pkg === "pdf" ||
    pkg === "pdf-engine" ||
    pkg === "xelatex" ||
    pkg === "miktex" ||
    pkg === "latex"
  ) {
    return installXelatex();
  }
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
  installXelatex,
  installPackage,
  probePdfEngines,
  resolvePandocBin,
  FILE_FROM,
  PDF_ENGINE_ORDER,
};
