"use strict";

/**
 * MinerU 文档 → Markdown（本机桥模块，质量主力）。
 * 优先 PDF / 扫描件 / 表 / 公式 / 中文；Office/图片亦支持。
 * 依赖本机 Python + `pip install "mineru[full]"`（建议 GPU；不进 GitHub Pages）。
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
  ".epub",
  ".md",
  ".txt",
]);

function runCmd(file, args, { timeout = 120000, cwd, env } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
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

function runSpawn(file, args, { timeout = 1200000, cwd, env } = {}) {
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
let cachedMinerU = null;

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
      const { stdout, stderr } = await runCmd(c.file, [...c.argsPrefix, "--version"], { timeout: 12000 });
      if (/Python\s+3\./i.test(stdout + stderr) || /Python\s+3\./i.test(c.file)) {
        cachedPython = c;
        return c;
      }
      cachedPython = c;
      return c;
    } catch (_) {}
  }
  cachedPython = null;
  return null;
}

function winScriptDirs() {
  const dirs = [];
  const la = process.env.LOCALAPPDATA || "";
  const home = os.homedir();
  for (const ver of ["Python314", "Python313", "Python312", "Python311", "Python310"]) {
    if (la) dirs.push(path.join(la, "Programs", "Python", ver, "Scripts"));
    dirs.push(path.join(home, "AppData", "Roaming", "Python", ver, "Scripts"));
  }
  return dirs;
}

function unixBinDirs() {
  return [
    path.join(os.homedir(), ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
  ];
}

async function probeTool(file, argsPrefix, style) {
  try {
    if (style === "kit") {
      await runCmd(file, [...argsPrefix, "--help"], { timeout: 25000 });
      return { kind: "bin", file, argsPrefix, style: "kit" };
    }
    if (style === "parse") {
      // mineru version / --help 因版本差异；任一成功即可
      try {
        await runCmd(file, [...argsPrefix, "version"], { timeout: 25000 });
      } catch (_) {
        await runCmd(file, [...argsPrefix, "--help"], { timeout: 25000 });
      }
      return { kind: "bin", file, argsPrefix, style: "parse" };
    }
    if (style === "legacy") {
      await runCmd(file, [...argsPrefix, "--version"], { timeout: 25000 });
      return { kind: "bin", file, argsPrefix, style: "legacy" };
    }
  } catch (_) {}
  return null;
}

/**
 * 解析可用入口：优先 mineru-kit（无状态整篇），其次 mineru parse，再兼容旧版 mineru -p。
 */
async function resolveMinerU({ refresh = false } = {}) {
  if (cachedMinerU && !refresh) return cachedMinerU;

  const pathCandidates = [];
  if (process.platform === "win32") {
    for (const dir of winScriptDirs()) {
      pathCandidates.push({ file: path.join(dir, "mineru-kit.exe"), style: "kit" });
      pathCandidates.push({ file: path.join(dir, "mineru.exe"), style: "parse" });
    }
  } else {
    for (const dir of unixBinDirs()) {
      pathCandidates.push({ file: path.join(dir, "mineru-kit"), style: "kit" });
      pathCandidates.push({ file: path.join(dir, "mineru"), style: "parse" });
    }
  }

  for (const c of pathCandidates) {
    try {
      if (!fs.existsSync(c.file)) continue;
      const hit = await probeTool(c.file, [], c.style);
      if (hit) {
        cachedMinerU = hit;
        return hit;
      }
    } catch (_) {}
  }

  for (const name of [
    { cmd: "mineru-kit", style: "kit" },
    { cmd: "mineru", style: "parse" },
  ]) {
    const hit = await probeTool(name.cmd, [], name.style);
    if (hit) {
      cachedMinerU = hit;
      return hit;
    }
  }

  const py = await resolvePython({ refresh });
  if (py) {
    // v4：python -m mineru.cli 不稳定；优先探测 PATH 装好的入口，再试 -m mineru
    try {
      await runCmd(py.file, [...py.argsPrefix, "-m", "mineru", "--help"], { timeout: 30000 });
      cachedMinerU = {
        kind: "module",
        file: py.file,
        argsPrefix: [...py.argsPrefix, "-m", "mineru"],
        style: "parse",
      };
      return cachedMinerU;
    } catch (_) {}
  }

  cachedMinerU = null;
  return null;
}

async function checkMinerU() {
  const bin = await resolveMinerU();
  if (!bin) {
    const py = await resolvePython();
    return {
      ok: false,
      error: "未找到 MinerU（需本机 Python 3.10+，可点「一键安装」；建议 NVIDIA GPU）",
      python: py ? { file: py.file } : null,
      formats: [...SUPPORTED_EXT],
      gpuRecommended: true,
      installHint: 'pip install -U "mineru[full]"',
    };
  }
  try {
    let ver = "mineru";
    try {
      const { stdout, stderr } = await runCmd(
        bin.file,
        bin.style === "kit" ? [...bin.argsPrefix, "--help"] : [...bin.argsPrefix, "version"],
        { timeout: 30000 }
      );
      const line = String(stdout || stderr || "")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .find((s) => s && !/^usage:/i.test(s));
      if (line) ver = line.slice(0, 120);
    } catch (_) {
      ver = bin.style === "kit" ? "mineru-kit" : "mineru";
    }
    return {
      ok: true,
      version: ver,
      bin: bin.kind === "bin" ? bin.file : `${bin.file} ${bin.argsPrefix.join(" ")}`.trim(),
      style: bin.style,
      python: await resolvePython(),
      formats: [...SUPPORTED_EXT],
      ocr: true,
      gpuRecommended: true,
      note: "MinerU：PDF/扫描/表/公式/中文质量优先；建议 GPU。无 GPU 可跑但较慢；也可回退 Docling。",
    };
  } catch (err) {
    return {
      ok: false,
      error: String(err?.stderr || err?.message || "MinerU 不可用").slice(0, 300),
      formats: [...SUPPORTED_EXT],
      gpuRecommended: true,
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
    const st = fs.statSync(outPath);
    if (st.isFile()) return fs.readFileSync(outPath, "utf8");
  }
  const prefer = [
    path.join(outDir, `${stem}.md`),
    path.join(outDir, `${stem}.markdown`),
    path.join(outDir, "out.md"),
  ];
  for (const p of prefer) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return fs.readFileSync(p, "utf8");
  }
  const walk = (dir, depth = 0) => {
    if (depth > 4) return null;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (_) {
      return null;
    }
    // 优先常见 MinerU 输出名
    for (const ent of entries) {
      if (ent.isFile() && /\.md$/i.test(ent.name)) {
        const full = path.join(dir, ent.name);
        if (/auto|ocr|txt|content|full/i.test(ent.name) || ent.name === `${stem}.md`) {
          return fs.readFileSync(full, "utf8");
        }
      }
    }
    for (const ent of entries) {
      if (ent.isFile() && /\.md$/i.test(ent.name)) {
        return fs.readFileSync(path.join(dir, ent.name), "utf8");
      }
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

function mineruEnv() {
  const env = { ...process.env };
  // 国内模型源更稳；可用环境变量覆盖
  if (!env.MINERU_MODEL_SOURCE) env.MINERU_MODEL_SOURCE = "modelscope";
  return env;
}

async function convert({ filename, dataBase64, forceOcr = false, ocrLang = "" } = {}) {
  const name = safeName(filename);
  const ext = extOf(name);
  if (ext && !SUPPORTED_EXT.has(ext)) {
    throw new Error(`MinerU 不支持该扩展名：${ext}`);
  }
  if (!dataBase64) throw new Error("缺少文件数据");
  const buf = Buffer.from(String(dataBase64), "base64");
  if (!buf.length) throw new Error("文件为空");
  if (buf.length > 80 * 1024 * 1024) throw new Error("文件过大（上限 80MB）");

  const bin = await resolveMinerU();
  if (!bin) {
    throw new Error('未找到 MinerU：可点「一键安装 MinerU」或 pip install -U "mineru[full]"');
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-mineru-"));
  const inPath = path.join(tmp, name);
  const outDir = path.join(tmp, "out");
  const outFile = path.join(outDir, "out.md");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(inPath, buf);
  const stem = path.basename(name, path.extname(name)) || "out";
  const env = mineruEnv();
  const errors = [];

  const attempts = [];
  if (bin.style === "kit") {
    const kitArgs = [...bin.argsPrefix, "parse", inPath, "-o", outFile, "--tier", "standard"];
    if (forceOcr || /\.(png|jpe?g|webp|tiff?|bmp)$/i.test(name)) {
      kitArgs.push("--ocr-mode", "ocr");
    }
    attempts.push({ file: bin.file, args: kitArgs, outHint: outFile });
  }
  // parse 风格（含把 kit 当 mineru 失败时的回退命令）
  attempts.push({
    file: bin.file,
    args: [...bin.argsPrefix, "parse", inPath, "--pages", "all", "-o", outFile, "--wait", "900"],
    outHint: outFile,
  });
  // 旧版 CLI：mineru -p in -o outDir
  if (bin.style === "legacy" || bin.style === "parse") {
    const legacyArgs = [...bin.argsPrefix, "-p", inPath, "-o", outDir];
    if (forceOcr) legacyArgs.push("-m", "ocr");
    else legacyArgs.push("-m", "auto");
    const lang = String(ocrLang || "").trim();
    if (lang) legacyArgs.push("-l", lang);
    else legacyArgs.push("-l", "ch");
    attempts.push({ file: bin.file, args: legacyArgs, outHint: null });
  }

  try {
    let lastErr = null;
    for (const att of attempts) {
      try {
        await runSpawn(att.file, att.args, { timeout: 1200000, cwd: tmp, env });
        const md = collectMarkdown(att.outHint, outDir, stem);
        if (md && String(md).trim()) {
          return {
            markdown: String(md),
            engine: "mineru",
            ocr: true,
            forceOcr: !!forceOcr,
            filename: name,
            style: bin.style,
          };
        }
        lastErr = new Error("MinerU 输出为空");
      } catch (err) {
        lastErr = err;
        errors.push(String(err?.stderr || err?.message || err).slice(0, 200));
      }
    }
    const msg = String(lastErr?.stderr || lastErr?.message || errors.join(" | ") || "MinerU 转换失败").trim();
    if (/ENOENT|not recognized|not found/i.test(msg)) {
      throw new Error('未找到 MinerU：可点「一键安装 MinerU」或 pip install -U "mineru[full]"');
    }
    throw new Error((msg || "MinerU 转换失败").slice(0, 600));
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) {}
  }
}

async function installMinerU() {
  const py = await resolvePython({ refresh: true });
  if (!py) {
    return {
      installed: false,
      needsManual: true,
      command: process.platform === "win32" ? "winget install Python.Python.3.12" : "brew install python",
      message:
        '未找到 Python 3，请先安装 Python 3.10–3.14，再执行：pip install -U "mineru[full]"（建议 NVIDIA GPU + CUDA）',
      gpuRecommended: true,
    };
  }
  const cmdFull = `${py.file} ${py.argsPrefix.join(" ")} -m pip install -U "mineru[full]"`.replace(/\s+/g, " ").trim();
  const cmdBase = `${py.file} ${py.argsPrefix.join(" ")} -m pip install -U "mineru>=4.0,<5"`.replace(/\s+/g, " ").trim();
  try {
    const { stdout, stderr } = await runSpawn(
      py.file,
      [...py.argsPrefix, "-m", "pip", "install", "-U", "mineru[full]"],
      { timeout: 1800000, env: mineruEnv() }
    );
    cachedMinerU = null;
    let p = await checkMinerU();
    if (!p.ok) {
      try {
        await runSpawn(
          py.file,
          [...py.argsPrefix, "-m", "pip", "install", "-U", "mineru>=4.0,<5"],
          { timeout: 1800000, env: mineruEnv() }
        );
      } catch (_) {}
      cachedMinerU = null;
      p = await checkMinerU();
    }
    return {
      installed: p.ok,
      output: `${stdout}\n${stderr}`.trim().slice(-2500),
      mineru: p,
      command: p.ok ? cmdFull : cmdBase,
      gpuRecommended: true,
      message: p.ok
        ? "MinerU 已安装。首次转换会下载模型；有 NVIDIA GPU 质量/速度更好。"
        : `自动安装未完成，请手动执行：${cmdFull}`,
      needsManual: !p.ok,
    };
  } catch (err) {
    const out = `${err?.stdout || ""}\n${err?.stderr || err?.message || ""}`.trim().slice(-2500);
    // full 失败再试 base
    try {
      await runSpawn(
        py.file,
        [...py.argsPrefix, "-m", "pip", "install", "-U", "mineru>=4.0,<5"],
        { timeout: 1800000, env: mineruEnv() }
      );
    } catch (_) {}
    cachedMinerU = null;
    const p = await checkMinerU();
    return {
      installed: p.ok,
      output: out,
      mineru: p,
      command: cmdFull,
      needsManual: !p.ok,
      gpuRecommended: true,
      message: p.ok
        ? "MinerU 已安装（基础包）。建议有 GPU 时再装 mineru[full]。"
        : `自动安装未完成，请手动执行：${cmdFull}（无 GPU 可改：${cmdBase}）`,
    };
  }
}

module.exports = {
  checkMinerU,
  convert,
  installMinerU,
  resolveMinerU,
  SUPPORTED_EXT,
};
