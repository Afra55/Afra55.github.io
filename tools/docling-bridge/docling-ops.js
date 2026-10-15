"use strict";

/**
 * Docling 文档 → Markdown（本机桥模块）。
 * 质量优先：PDF 扫描件 / 图片页走 OCR（RapidOCR，CPU 可用）；
 * 另支持 DOCX / PPTX / XLSX / HTML / 常见图片等。
 * 依赖本机 Python + `pip install "docling[rapidocr]"`（不进 GitHub Pages）。
 */

const { execFile, spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SUPPORTED_EXT = new Set([
  ".pdf",
  ".docx",
  ".pptx",
  ".xlsx",
  ".html",
  ".htm",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".tif",
  ".tiff",
  ".bmp",
  ".md",
  ".txt",
  ".asciidoc",
  ".adoc",
]);

function runCmd(file, args, { timeout = 120000, cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        timeout,
        maxBuffer: 64 * 1024 * 1024,
        windowsHide: true,
        encoding: "utf8",
        cwd,
        env: env || process.env,
      },
      (err, stdout, stderr) => {
        if (err) {
          err.stdout = String(stdout || "");
          err.stderr = String(stderr || "");
          reject(err);
          return;
        }
        resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
      }
    );
  });
}

/** 长时间 pip / 转换：用 spawn 便于超时杀进程 */
function runSpawn(file, args, { timeout = 900000, cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env: env || process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch (_) {}
      const err = new Error(`命令超时（${Math.round(timeout / 1000)}s）`);
      err.stdout = stdout;
      err.stderr = stderr;
      reject(err);
    }, timeout);
    child.stdout.on("data", (d) => {
      stdout += String(d);
      if (stdout.length > 8 * 1024 * 1024) stdout = stdout.slice(-4 * 1024 * 1024);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
      if (stderr.length > 8 * 1024 * 1024) stderr = stderr.slice(-4 * 1024 * 1024);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      err.stdout = stdout;
      err.stderr = stderr;
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr, code });
      else {
        const err = new Error(`exit ${code}`);
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      }
    });
  });
}

let cachedPython = null;
let cachedDocling = null;

function pythonCandidates() {
  if (process.platform === "win32") {
    return [
      { file: "py", argsPrefix: ["-3"] },
      { file: "python", argsPrefix: [] },
      { file: "python3", argsPrefix: [] },
    ];
  }
  return [
    { file: "python3", argsPrefix: [] },
    { file: "python", argsPrefix: [] },
  ];
}

async function resolvePython({ refresh = false } = {}) {
  if (cachedPython && !refresh) return cachedPython;
  for (const c of pythonCandidates()) {
    try {
      const { stdout } = await runCmd(c.file, [...c.argsPrefix, "--version"], { timeout: 12000 });
      if (/Python\s+3\./i.test(stdout) || /Python\s+3\./i.test(c.file)) {
        cachedPython = c;
        return c;
      }
      // py -3 有时只打 stderr
      cachedPython = c;
      return c;
    } catch (_) {}
  }
  cachedPython = null;
  return null;
}

async function resolveDoclingBin({ refresh = false } = {}) {
  if (cachedDocling && !refresh) return cachedDocling;
  const pathCandidates = [];
  if (process.platform === "win32") {
    const la = process.env.LOCALAPPDATA || "";
    const home = os.homedir();
    if (la) {
      pathCandidates.push(path.join(la, "Programs", "Python", "Python312", "Scripts", "docling.exe"));
      pathCandidates.push(path.join(la, "Programs", "Python", "Python311", "Scripts", "docling.exe"));
      pathCandidates.push(path.join(la, "Programs", "Python", "Python310", "Scripts", "docling.exe"));
    }
    pathCandidates.push(path.join(home, "AppData", "Roaming", "Python", "Python312", "Scripts", "docling.exe"));
    pathCandidates.push(path.join(home, "AppData", "Roaming", "Python", "Python311", "Scripts", "docling.exe"));
  } else {
    pathCandidates.push(
      path.join(os.homedir(), ".local", "bin", "docling"),
      "/opt/homebrew/bin/docling",
      "/usr/local/bin/docling",
      "/usr/bin/docling"
    );
  }
  for (const c of pathCandidates) {
    try {
      if (fs.existsSync(c)) {
        cachedDocling = { kind: "bin", file: c, argsPrefix: [] };
        return cachedDocling;
      }
    } catch (_) {}
  }
  try {
    await runCmd("docling", ["--version"], { timeout: 20000 });
    cachedDocling = { kind: "bin", file: "docling", argsPrefix: [] };
    return cachedDocling;
  } catch (_) {}
  const py = await resolvePython({ refresh });
  if (py) {
    try {
      await runCmd(py.file, [...py.argsPrefix, "-m", "docling", "--help"], { timeout: 30000 });
      cachedDocling = { kind: "module", file: py.file, argsPrefix: [...py.argsPrefix, "-m", "docling"] };
      return cachedDocling;
    } catch (_) {}
  }
  cachedDocling = null;
  return null;
}

async function checkDocling() {
  const bin = await resolveDoclingBin();
  if (!bin) {
    const py = await resolvePython();
    return {
      ok: false,
      error: "未找到 Docling（需本机 Python 3.10+，可点「一键安装」）",
      python: py ? { file: py.file } : null,
      formats: [...SUPPORTED_EXT],
    };
  }
  try {
    const { stdout, stderr } = await runCmd(bin.file, [...bin.argsPrefix, "--version"], { timeout: 30000 });
    const ver = String(stdout || stderr || "")
      .split(/\r?\n/)
      .map((s) => s.trim())
      .find(Boolean) || "docling";
    return {
      ok: true,
      version: ver,
      bin: bin.kind === "bin" ? bin.file : `${bin.file} -m docling`,
      python: await resolvePython(),
      formats: [...SUPPORTED_EXT],
      ocr: true,
      note: "PDF 扫描件默认 OCR（RapidOCR/auto）；无 GPU 可走 CPU",
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err?.stderr || err?.message || "Docling 不可用").slice(0, 300),
      formats: [...SUPPORTED_EXT],
    };
  }
}

function safeName(name) {
  const base = path.basename(String(name || "document.bin")).replace(/[\\/:*?"<>|]+/g, "_");
  return base.slice(0, 120) || "document.bin";
}

function extOf(name) {
  const m = String(name || "").toLowerCase().match(/(\.[a-z0-9]+)$/);
  return m ? m[1] : "";
}

function collectMarkdown(outPath, outDir, stem) {
  if (outPath && fs.existsSync(outPath)) {
    return fs.readFileSync(outPath, "utf8");
  }
  const prefer = [
    path.join(outDir, `${stem}.md`),
    path.join(outDir, `${stem}.markdown`),
  ];
  for (const p of prefer) {
    if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");
  }
  const walk = (dir, depth = 0) => {
    if (depth > 3) return null;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return null;
    }
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isFile() && /\.md$/i.test(ent.name)) return fs.readFileSync(full, "utf8");
    }
    for (const ent of entries) {
      if (ent.isDirectory()) {
        const hit = walk(path.join(dir, ent.name), depth + 1);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(outDir);
}

async function convert({ filename, dataBase64, forceOcr = false, ocrLang = "" } = {}) {
  const name = safeName(filename);
  const ext = extOf(name);
  if (ext && !SUPPORTED_EXT.has(ext)) {
    throw new Error(`Docling 不支持该扩展名：${ext}`);
  }
  if (!dataBase64) throw new Error("缺少文件数据");
  const buf = Buffer.from(String(dataBase64), "base64");
  if (!buf.length) throw new Error("文件为空");
  if (buf.length > 80 * 1024 * 1024) throw new Error("文件过大（上限 80MB）");

  const bin = await resolveDoclingBin();
  if (!bin) throw new Error("未找到 Docling：可点「一键安装 Docling」或 pip install \"docling[rapidocr]\"");

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-docling-"));
  const inPath = path.join(tmp, name);
  const outDir = path.join(tmp, "out");
  const outFile = path.join(outDir, "out.md");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(inPath, buf);

  const stem = path.basename(name, path.extname(name)) || "out";
  const args = [
    ...bin.argsPrefix,
    "convert",
    inPath,
    "--to",
    "md",
    "--output",
    outDir,
    "--output-file",
    outFile,
    "--image-export-mode",
    "embedded",
    "--ocr",
    "--device",
    "auto",
    "--quiet",
  ];
  // 扫描件 / 图片：整页 OCR；数字 PDF 由客户端传 forceOcr 时再全页
  const fullPage = !!(forceOcr || /\.(png|jpe?g|webp|tiff?|bmp)$/i.test(name));
  if (fullPage) {
    args.push("--ocr-mode", "full_page");
  }
  // 优先 RapidOCR（跨平台 CPU）；失败时外层可再试 auto
  args.push("--ocr-engine", "rapidocr");
  const lang = String(ocrLang || "").trim();
  if (lang) args.push("--ocr-lang", lang);

  try {
    try {
      await runSpawn(bin.file, args, { timeout: 900000, cwd: tmp });
    } catch (err1) {
      // rapidocr 未装或 CLI 旧：去掉 engine / output-file 再试
      const soft = [
        ...bin.argsPrefix,
        "convert",
        inPath,
        "--to",
        "md",
        "--output",
        outDir,
        "--image-export-mode",
        "embedded",
        "--ocr",
        "--device",
        "auto",
      ];
      if (forceOcr || /\.(png|jpe?g|webp|tiff?|bmp)$/i.test(name)) {
        soft.push("--force-ocr");
      }
      try {
        await runSpawn(bin.file, soft, { timeout: 900000, cwd: tmp });
      } catch (err2) {
        const msg = String(err2?.stderr || err1?.stderr || err2?.message || err1?.message || "").trim();
        if (/ENOENT|not recognized|not found/i.test(msg)) {
          throw new Error("未找到 Docling：可点「一键安装 Docling」");
        }
        throw new Error((msg || "Docling 转换失败").slice(0, 600));
      }
    }
    const md = collectMarkdown(outFile, outDir, stem);
    if (!md || !String(md).trim()) throw new Error("Docling 输出为空");
    return {
      markdown: String(md),
      engine: "docling",
      ocr: true,
      forceOcr: fullPage,
      filename: name,
    };
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) {}
  }
}

async function installDocling() {
  const py = await resolvePython({ refresh: true });
  if (!py) {
    return {
      installed: false,
      needsManual: true,
      command: process.platform === "win32" ? "winget install Python.Python.3.12" : "brew install python",
      message: "未找到 Python 3，请先安装 Python 3.10+，再执行：pip install \"docling[rapidocr]\"",
    };
  }
  const cmd = `${py.file} ${py.argsPrefix.join(" ")} -m pip install -U "docling[rapidocr]"`.replace(/\s+/g, " ").trim();
  try {
    const { stdout, stderr } = await runSpawn(
      py.file,
      [...py.argsPrefix, "-m", "pip", "install", "-U", "docling[rapidocr]"],
      { timeout: 1200000 }
    );
    resolveDoclingBin({ refresh: true });
    cachedDocling = null;
    const p = await checkDocling();
    if (!p.ok) {
      // 部分环境 extras 名不同：拆开装
      try {
        await runSpawn(
          py.file,
          [...py.argsPrefix, "-m", "pip", "install", "-U", "docling", "rapidocr", "onnxruntime"],
          { timeout: 1200000 }
        );
      } catch (_) {}
      cachedDocling = null;
      const p2 = await checkDocling();
      return {
        installed: p2.ok,
        output: `${stdout}\n${stderr}`.trim().slice(-2500),
        docling: p2,
        command: cmd,
      };
    }
    return {
      installed: true,
      output: `${stdout}\n${stderr}`.trim().slice(-2500),
      docling: p,
      command: cmd,
    };
  } catch (err) {
    const out = `${err?.stdout || ""}\n${err?.stderr || err?.message || ""}`.trim().slice(-2500);
    cachedDocling = null;
    const p = await checkDocling();
    return {
      installed: p.ok,
      output: out,
      docling: p,
      command: cmd,
      needsManual: !p.ok,
      message: p.ok ? "" : "自动安装未完成，请手动执行：" + cmd,
    };
  }
}

module.exports = {
  checkDocling,
  convert,
  installDocling,
  resolveDoclingBin,
  SUPPORTED_EXT,
};
