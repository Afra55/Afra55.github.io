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

function teeSpawnLines(state, chunk, prefix) {
  const text = String(chunk || "");
  state.carry = (state.carry || "") + text;
  const parts = state.carry.split(/\r?\n/);
  state.carry = parts.pop() || "";
  for (const line of parts) {
    const s = String(line || "").replace(/\s+$/g, "");
    if (!s) continue;
    // 控制台别被进度条刷爆：同前缀短时重复只打一次
    const now = Date.now();
    if (state.lastLine === s && now - (state.lastAt || 0) < 1500) continue;
    state.lastLine = s;
    state.lastAt = now;
    console.log(`${prefix}${s}`);
  }
}

function runSpawn(file, args, { timeout = 1200000, cwd, env, logPrefix = "[mineru] " } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd,
      env: env || process.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const outTee = { carry: "", lastLine: "", lastAt: 0 };
    const errTee = { carry: "", lastLine: "", lastAt: 0 };
    const started = Date.now();
    let heartbeat = null;
    if (logPrefix) {
      console.log(`${logPrefix}执行: ${file} ${args.join(" ")}`);
      heartbeat = setInterval(() => {
        const sec = Math.round((Date.now() - started) / 1000);
        console.log(`${logPrefix}仍在运行… 已 ${sec}s（首次下模型 / 无 GPU 可能较久，请耐心等待）`);
      }, 15000);
    }
    const timer = setTimeout(() => {
      if (heartbeat) clearInterval(heartbeat);
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
      if (logPrefix) teeSpawnLines(outTee, d, logPrefix);
    });
    child.stderr.on("data", (d) => {
      stderr += String(d);
      if (stderr.length > 8 * 1024 * 1024) stderr = stderr.slice(-4 * 1024 * 1024);
      if (logPrefix) teeSpawnLines(errTee, d, logPrefix);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      if (heartbeat) clearInterval(heartbeat);
      err.stdout = stdout;
      err.stderr = stderr;
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (heartbeat) clearInterval(heartbeat);
      if (logPrefix && outTee.carry.trim()) console.log(`${logPrefix}${outTee.carry.trim()}`);
      if (logPrefix && errTee.carry.trim()) console.log(`${logPrefix}${errTee.carry.trim()}`);
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

function pythonInstallGuide() {
  if (process.platform === "win32") {
    return {
      command: "winget install Python.Python.3.12",
      message:
        "未找到 Python 3。请先安装 Python 3.10–3.14（自带 pip），再点「一键安装 MinerU」：\n" +
        "1) 终端执行：winget install Python.Python.3.12\n" +
        "2) 或官网 https://www.python.org/downloads/ （勾选 Add python.exe to PATH）\n" +
        "装完请重启本机桥，再点自动安装。",
    };
  }
  if (process.platform === "darwin") {
    return {
      command: "brew install python",
      message:
        "未找到 Python 3。请先执行：brew install python（自带 pip）；无 Homebrew 可打开 https://www.python.org/downloads/\n" +
        "装完请重启本机桥，再点「一键安装 MinerU」。",
    };
  }
  return {
    command: "sudo apt install python3 python3-pip python3-venv",
    message:
      "未找到 Python 3。请先安装 python3 与 pip（如：sudo apt install python3 python3-pip python3-venv 或等价包），装完重启本机桥后再点自动安装。",
  };
}

function pyLabel(py) {
  return `${py.file} ${py.argsPrefix.join(" ")}`.replace(/\s+/g, " ").trim();
}

function pipMissingGuide(py) {
  const ensureCmd = `${pyLabel(py)} -m ensurepip --upgrade`;
  if (process.platform === "win32") {
    return {
      command: ensureCmd,
      message:
        `已找到 Python（${pyLabel(py)}），但缺少 pip。请先装好 pip 再点自动安装：\n` +
        `1) 终端执行：${ensureCmd}\n` +
        `2) 仍失败：winget install Python.Python.3.12（官方包自带 pip）\n` +
        `3) 或官网重装并勾选 pip / Add to PATH\n` +
        `装好后重启本机桥，再点「一键安装 MinerU」。`,
    };
  }
  if (process.platform === "darwin") {
    return {
      command: ensureCmd,
      message:
        `已找到 Python（${pyLabel(py)}），但缺少 pip。请先执行：${ensureCmd}\n` +
        `仍失败可：brew install python 或 brew reinstall python\n` +
        `装好后重启本机桥，再点「一键安装 MinerU」。`,
    };
  }
  return {
    command: ensureCmd,
    message:
      `已找到 Python（${pyLabel(py)}），但缺少 pip。请先执行：${ensureCmd}\n` +
      `或：sudo apt install python3-pip python3-venv\n` +
      `装好后重启本机桥，再点「一键安装 MinerU」。`,
  };
}

function isPipMissingError(text) {
  return /No module named ['"]?pip['"]?|pip is not available|ensurepip is not available|No module named ensurepip/i.test(
    String(text || "")
  );
}

async function hasPipModule(py) {
  try {
    await runCmd(py.file, [...py.argsPrefix, "-m", "pip", "--version"], { timeout: 20000 });
    return true;
  } catch (_) {
    return false;
  }
}

/** 探测 pip；缺失时尝试 python -m ensurepip（安全、官方内置）。 */
async function ensurePipReady(py) {
  if (await hasPipModule(py)) return { ok: true };
  for (const args of [
    ["-m", "ensurepip", "--upgrade"],
    ["-m", "ensurepip", "--default-pip"],
  ]) {
    try {
      await runSpawn(py.file, [...py.argsPrefix, ...args], { timeout: 180000 });
    } catch (_) {}
    if (await hasPipModule(py)) return { ok: true, repaired: true };
  }
  return { ok: false, ...pipMissingGuide(py) };
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
      note: "MinerU：PDF 默认最高质量（advanced / hybrid-high）；时长可很长。建议 GPU。也可回退 Docling。",
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

function listMarkdownFiles(root, depth = 0, acc = []) {
  if (depth > 6) return acc;
  let entries = [];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (_) {
    return acc;
  }
  for (const ent of entries) {
    const full = path.join(root, ent.name);
    if (ent.isFile() && /\.(md|markdown)$/i.test(ent.name)) acc.push(full);
    else if (ent.isDirectory() && !/^(node_modules|\.git)$/i.test(ent.name)) {
      listMarkdownFiles(full, depth + 1, acc);
    }
  }
  return acc;
}

/** 给候选 MD 打分：优先带表格/图片/HTML 表的完整稿，避开纯文本/中间产物 */
function scoreMarkdownCandidate(filePath, stem) {
  const base = path.basename(filePath);
  let text = "";
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch (_) {
    return { score: -1, text: "", path: filePath };
  }
  if (!String(text).trim()) return { score: -1, text: "", path: filePath };

  let score = Math.min(String(text).length, 200000) / 1000;
  // GFM 表 / HTML 表
  if (/^\s*\|.+\|\s*$/m.test(text) && /\|\s*:?-{3,}/.test(text)) score += 80;
  if (/<table[\s>]/i.test(text)) score += 70;
  // 图片引用
  if (/!\[[^\]]*\]\([^)]+\)/i.test(text) || /<img\s[^>]*src=/i.test(text)) score += 50;
  // 标题结构
  if (/^#{1,6}\s+\S/m.test(text)) score += 20;
  // 路径/文件名启发式
  if (/(^|[\\/])auto([\\/]|$)/i.test(filePath)) score += 35;
  if (/(^|[\\/])ocr([\\/]|$)/i.test(filePath)) score += 25;
  if (new RegExp(`(^|[\\\\/])${stem}\\.(md|markdown)$`, "i").test(filePath)) score += 15;
  if (/^(out|full|content)\.(md|markdown)$/i.test(base)) score += 10;
  // 惩罚：纯文本/中间清单类
  if (/(_txt|plain|content_list|middle|span|layout)\.(md|markdown)$/i.test(base)) score -= 60;
  if (/txt/i.test(base) && !/markdown/i.test(base)) score -= 30;
  return { score, text, path: filePath };
}

/**
 * @returns {{ text: string, path: string } | null}
 */
function collectMarkdown(outPath, outDir, stem) {
  const candidates = [];
  if (outPath && fs.existsSync(outPath) && fs.statSync(outPath).isFile()) {
    candidates.push(outPath);
  }
  for (const p of [
    path.join(outDir, `${stem}.md`),
    path.join(outDir, `${stem}.markdown`),
    path.join(outDir, "out.md"),
  ]) {
    if (fs.existsSync(p) && fs.statSync(p).isFile()) candidates.push(p);
  }
  listMarkdownFiles(outDir).forEach((p) => candidates.push(p));

  const uniq = [...new Set(candidates.map((p) => path.resolve(p)))];
  let best = null;
  for (const p of uniq) {
    const hit = scoreMarkdownCandidate(p, stem);
    if (!best || hit.score > best.score) best = hit;
  }
  if (!best || best.score < 0 || !String(best.text || "").trim()) return null;
  console.log(
    `[mineru] 选用 MD：${path.relative(outDir, best.path) || path.basename(best.path)} · score=${Math.round(best.score)} · ${best.text.length} 字符`
  );
  return { text: best.text, path: best.path };
}

const IMAGE_EXT_MIME = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".svg": "image/svg+xml",
  ".tif": "image/tiff",
  ".tiff": "image/tiff",
};

function resolveImagePath(mdDir, ref, outDir) {
  const clean = String(ref || "")
    .trim()
    .replace(/^<|>$/g, "")
    .split(/[?#]/)[0]
    .replace(/\\/g, "/");
  if (!clean || /^(https?:|data:|file:)/i.test(clean)) return null;
  const rel = clean.replace(/^\.\//, "");
  const tried = [
    path.resolve(mdDir, rel),
    path.resolve(mdDir, path.basename(rel)),
    path.resolve(outDir, rel),
    path.resolve(outDir, "images", path.basename(rel)),
    path.resolve(outDir, "image", path.basename(rel)),
    path.resolve(mdDir, "images", path.basename(rel)),
    path.resolve(mdDir, "image", path.basename(rel)),
  ];
  // MinerU 常见：md 同级 images/、上级 auto/images/
  tried.push(path.resolve(mdDir, "..", "images", path.basename(rel)));
  for (const p of tried) {
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch (_) {}
  }
  return null;
}

/** 把相对路径图片嵌进 Markdown（data URI），避免删临时目录后裂图 */
function embedLocalImages(markdown, mdPath, outDir) {
  const mdDir = path.dirname(mdPath);
  let text = String(markdown || "");
  let embedded = 0;
  let missing = 0;
  // 质量优先：尽量内联全部图（时长/体积可接受）
  const maxEach = 16 * 1024 * 1024;
  const maxTotal = 200 * 1024 * 1024;
  let total = 0;
  const cache = new Map();

  function toDataUri(abs) {
    if (cache.has(abs)) return cache.get(abs);
    const st = fs.statSync(abs);
    if (st.size > maxEach || total + st.size > maxTotal) {
      cache.set(abs, null);
      return null;
    }
    const ext = path.extname(abs).toLowerCase();
    const mime = IMAGE_EXT_MIME[ext] || "application/octet-stream";
    const b64 = fs.readFileSync(abs).toString("base64");
    total += st.size;
    const uri = `data:${mime};base64,${b64}`;
    cache.set(abs, uri);
    return uri;
  }

  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (full, alt, src) => {
    const abs = resolveImagePath(mdDir, src, outDir);
    if (!abs) {
      missing += 1;
      return full;
    }
    const uri = toDataUri(abs);
    if (!uri) {
      missing += 1;
      return full;
    }
    embedded += 1;
    return `![${alt}](${uri})`;
  });

  text = text.replace(/(<img\b[^>]*?\bsrc\s*=\s*)(["'])([^"']+)\2/gi, (full, pre, q, src) => {
    const abs = resolveImagePath(mdDir, src, outDir);
    if (!abs) {
      missing += 1;
      return full;
    }
    const uri = toDataUri(abs);
    if (!uri) {
      missing += 1;
      return full;
    }
    embedded += 1;
    return `${pre}${q}${uri}${q}`;
  });

  console.log(`[mineru] 图片内联：成功 ${embedded} · 未找到/过大 ${missing} · 约 ${Math.round(total / 1024)} KB`);
  return { text, embedded, missing };
}

/** 桥解压根目录：优先启动脚本写入的 ADB_BRIDGE_DIR，否则 mineru-bridge 的上一级 */
function resolveBridgeRoot() {
  const fromEnv = String(process.env.ADB_BRIDGE_DIR || process.env.DEVTOOLS_BRIDGE_DIR || "").trim();
  if (fromEnv) {
    try {
      if (fs.existsSync(fromEnv)) return path.resolve(fromEnv);
    } catch (_) {}
  }
  // ZIP：<bridgeRoot>/mineru-bridge/mineru-ops.js → 上一级即桥目录
  return path.resolve(__dirname, "..");
}

let loggedMineruDataDirs = false;

/**
 * MinerU 运行环境：模型默认落到桥目录 mineru-data/，避免占满 C: 用户目录。
 * 可用环境变量覆盖：MINERU_HOME / MINERU_MODEL_BASE_DIR / MINERU_CONFIG
 */
function mineruEnv() {
  const env = { ...process.env };
  // 国内模型源更稳；可用环境变量覆盖
  if (!env.MINERU_MODEL_SOURCE) env.MINERU_MODEL_SOURCE = "modelscope";
  // 管道捕获时默认块缓冲，黑窗口会像死机；强制行缓冲
  env.PYTHONUNBUFFERED = "1";
  env.PYTHONIOENCODING = env.PYTHONIOENCODING || "utf-8";

  const bridgeRoot = resolveBridgeRoot();
  const dataHome = path.join(bridgeRoot, "mineru-data");
  const modelsDir = path.join(dataHome, "models");
  const configPath = path.join(dataHome, "config.yaml");
  try {
    fs.mkdirSync(modelsDir, { recursive: true });
  } catch (_) {}

  // MinerU 4.x：若设置了 MINERU_CONFIG，文件必须已存在，否则直接 FileNotFoundError
  ensureMineruConfigYaml(configPath, modelsDir);

  // 未显式指定时：配置与模型都放桥目录（mmproj / GGUF / 小模型同此）
  if (!env.MINERU_HOME) env.MINERU_HOME = dataHome;
  if (!env.MINERU_MODEL_BASE_DIR) env.MINERU_MODEL_BASE_DIR = modelsDir;
  if (!env.MINERU_CONFIG) env.MINERU_CONFIG = configPath;

  if (!loggedMineruDataDirs) {
    loggedMineruDataDirs = true;
    console.log(`[mineru] 模型目录：${env.MINERU_MODEL_BASE_DIR}`);
    console.log(`[mineru] MINERU_HOME：${env.MINERU_HOME}`);
    console.log(`[mineru] 配置文件：${env.MINERU_CONFIG}`);
  }
  return env;
}

/**
 * 写出一份可用的默认 config.yaml（不覆盖用户已有文件）。
 * 路径用正斜杠，避免 Windows YAML 转义问题。
 */
function ensureMineruConfigYaml(configPath, modelsDir) {
  try {
    if (fs.existsSync(configPath)) return;
    const base = String(modelsDir || "").replace(/\\/g, "/");
    const yaml =
      `# Auto-created by DevTools mineru-bridge — models live under the bridge folder.\n` +
      `model:\n` +
      `  source: modelscope\n` +
      `  base_dir: ${JSON.stringify(base)}\n` +
      `  small_backend: auto\n` +
      `  vlm:\n` +
      `    engine: auto\n`;
    fs.writeFileSync(configPath, yaml, "utf8");
    console.log(`[mineru] 已创建默认配置：${configPath}`);
  } catch (err) {
    console.log(`[mineru] 创建 config.yaml 失败：${err?.message || err}`);
  }
}

function isImageName(name) {
  return /\.(png|jpe?g|webp|tiff?|bmp)$/i.test(String(name || ""));
}

/** MinerU kit：advanced/standard 仅 PDF/图片；Office 等只能 flash */
function kitTiersForExt(ext) {
  const e = String(ext || "").toLowerCase();
  if (e === ".pdf" || isImageName(`x${e}`)) {
    return ["advanced", "standard", "flash"];
  }
  return ["flash"];
}

function looksLikeWaitTimeout(err) {
  const msg = `${err?.stderr || ""}\n${err?.stdout || ""}\n${err?.message || ""}`;
  return /parse_wait_timeout|wait[_\s-]?timeout|client wait|仍在解析|继续等待/i.test(msg);
}

/**
 * 质量优先转换：优先 advanced / hybrid-high；时长可很长。
 * forceOcr 仅建议用于扫描图；数字 PDF 用 auto，避免 OCR 打乱表格。
 */
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
  const t0 = Date.now();
  const sizeKb = Math.max(1, Math.round(buf.length / 1024));
  const wantOcr = !!(forceOcr || isImageName(name));
  const lang = String(ocrLang || "").trim() || "ch";
  // 质量优先：单次最长约 4 小时；library wait 2 小时一轮，可续等
  const SPAWN_TIMEOUT_MS = 4 * 60 * 60 * 1000;
  const LIBRARY_WAIT_SEC = 7200;
  console.log(
    `[mineru] 开始转换「${name}」· ${sizeKb} KB · ocr=${wantOcr ? "force" : "auto"} · tiers=${kitTiersForExt(ext).join("|")} · style=${bin.style} · bin=${bin.kind === "bin" ? bin.file : `${bin.file} ${bin.argsPrefix.join(" ")}`.trim()}`
  );

  /** @type {{ file: string, args: string[], outHint: string|null, label: string, retryWait?: boolean }[]} */
  const attempts = [];
  const kitTiers = kitTiersForExt(ext);
  const highTierOk = kitTiers.includes("advanced");

  // 1) mineru-kit：PDF/图 advanced→standard→flash；docx 等仅 flash（官方限制）
  if (bin.style === "kit") {
    for (const tier of kitTiers) {
      const kitArgs = [...bin.argsPrefix, "parse", inPath, "-o", outFile, "--tier", tier];
      if (wantOcr) kitArgs.push("--ocr-mode", "ocr");
      attempts.push({
        file: bin.file,
        args: kitArgs,
        outHint: outFile,
        label: `kit/${tier}`,
      });
    }
  }

  // 2) mineru parse（文档库）：整篇 + 超长 wait；超时续等而非立刻降级
  if (bin.style === "parse" || bin.style === "kit") {
    const baseParse = [
      ...bin.argsPrefix,
      "parse",
      inPath,
      "--pages",
      "all",
      "-o",
      outFile,
      "--wait",
      String(LIBRARY_WAIT_SEC),
    ];
    // 新版可能支持 --tier；非 PDF/图不要传 advanced/standard（会秒拒）
    if (bin.style === "parse" && highTierOk) {
      attempts.push({
        file: bin.file,
        args: [...baseParse, "--tier", "advanced"],
        outHint: outFile,
        label: "parse/advanced",
        retryWait: true,
      });
      attempts.push({
        file: bin.file,
        args: [...baseParse, "--tier", "standard"],
        outHint: outFile,
        label: "parse/standard",
        retryWait: true,
      });
    }
    if (bin.style === "parse" && !highTierOk) {
      attempts.push({
        file: bin.file,
        args: [...baseParse, "--tier", "flash"],
        outHint: outFile,
        label: "parse/flash",
        retryWait: true,
      });
    }
    attempts.push({
      file: bin.file,
      args: baseParse,
      outHint: outFile,
      label: "parse/wait",
      retryWait: true,
    });
  }

  // 3) 旧版 mineru -p：hybrid high → vlm；开表/公式/图分析
  if (bin.style === "legacy" || bin.style === "parse") {
    const method = wantOcr ? "ocr" : "auto";
    for (const backend of ["hybrid-engine", "vlm-engine", "pipeline"]) {
      const legacyArgs = [
        ...bin.argsPrefix,
        "-p",
        inPath,
        "-o",
        outDir,
        "-b",
        backend,
        "-m",
        method,
        "-l",
        lang,
        "-f",
        "true",
        "-t",
        "true",
      ];
      if (backend === "hybrid-engine") {
        legacyArgs.push("--effort", "high");
        legacyArgs.push("--image-analysis", "true");
      } else if (backend === "vlm-engine") {
        legacyArgs.push("--image-analysis", "true");
      }
      attempts.push({
        file: bin.file,
        args: legacyArgs,
        outHint: null,
        label: `legacy/${backend}`,
      });
    }
  }

  function finishFromPicked(picked, label) {
    const embedded = embedLocalImages(picked.text, picked.path, outDir);
    const md = embedded.text;
    const hasTable =
      (/^\s*\|.+\|\s*$/m.test(md) && /\|\s*:?-{3,}/.test(md)) || /<table[\s>]/i.test(md);
    const sec = Math.round((Date.now() - t0) / 1000);
    console.log(
      `[mineru] 完成「${name}」· ${label} · ${sec}s · Markdown ${String(md).length} 字符 · 表=${hasTable ? "有" : "无"} · 图=${embedded.embedded}`
    );
    return {
      markdown: String(md),
      engine: "mineru",
      quality: "max",
      ocr: wantOcr,
      forceOcr: !!forceOcr,
      filename: name,
      style: bin.style,
      attempt: label,
      imagesEmbedded: embedded.embedded,
      hasTable: !!hasTable,
    };
  }

  try {
    let lastErr = null;
    for (let i = 0; i < attempts.length; i += 1) {
      const att = attempts[i];
      console.log(`[mineru] 尝试 ${i + 1}/${attempts.length} · ${att.label}`);
      const maxRounds = att.retryWait ? 6 : 1;
      let roundOk = false;
      for (let round = 0; round < maxRounds; round += 1) {
        if (round > 0) {
          console.log(`[mineru] ${att.label} 续等第 ${round + 1}/${maxRounds} 轮（质量优先，可很久）…`);
        }
        try {
          await runSpawn(att.file, att.args, {
            timeout: SPAWN_TIMEOUT_MS,
            cwd: tmp,
            env,
            logPrefix: "[mineru] ",
          });
          roundOk = true;
          break;
        } catch (err) {
          lastErr = err;
          const pickedEarly = collectMarkdown(att.outHint, outDir, stem);
          if (pickedEarly?.text && String(pickedEarly.text).trim()) {
            console.log(`[mineru] ${att.label} 进程非 0 但已产出 MD，按成功处理`);
            return finishFromPicked(pickedEarly, att.label);
          }
          if (att.retryWait && looksLikeWaitTimeout(err) && round < maxRounds - 1) {
            console.log(`[mineru] ${att.label} 仅客户端等待超时，任务可能仍在跑，继续等…`);
            continue;
          }
          const detail = String(err?.stderr || err?.message || err).slice(0, 240);
          errors.push(`${att.label}: ${detail}`);
          console.log(`[mineru] ${att.label} 失败：${detail}`);
          break;
        }
      }
      if (!roundOk && !att.retryWait) continue;
      const picked = collectMarkdown(att.outHint, outDir, stem);
      if (picked?.text && String(picked.text).trim()) {
        return finishFromPicked(picked, att.label);
      }
      if (roundOk) {
        lastErr = new Error("MinerU 输出为空");
        console.log(`[mineru] ${att.label} 输出为空，换下一命令…`);
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
    const guide = pythonInstallGuide();
    return {
      installed: false,
      needsManual: true,
      command: guide.command,
      message: guide.message,
      gpuRecommended: true,
    };
  }
  const pipReady = await ensurePipReady(py);
  if (!pipReady.ok) {
    return {
      installed: false,
      needsManual: true,
      command: pipReady.command,
      message: pipReady.message,
      gpuRecommended: true,
    };
  }
  const cmdFull = `${pyLabel(py)} -m pip install -U "mineru[full]"`;
  const cmdBase = `${pyLabel(py)} -m pip install -U "mineru>=4.0,<5"`;
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
    if (isPipMissingError(out)) {
      const guide = pipMissingGuide(py);
      return {
        installed: false,
        needsManual: true,
        command: guide.command,
        message: guide.message,
        output: out,
        gpuRecommended: true,
      };
    }
    // full 失败再试 base
    try {
      await runSpawn(
        py.file,
        [...py.argsPrefix, "-m", "pip", "install", "-U", "mineru>=4.0,<5"],
        { timeout: 1800000, env: mineruEnv() }
      );
    } catch (err2) {
      const out2 = `${err2?.stdout || ""}\n${err2?.stderr || err2?.message || ""}`.trim();
      if (isPipMissingError(out2)) {
        const guide = pipMissingGuide(py);
        return {
          installed: false,
          needsManual: true,
          command: guide.command,
          message: guide.message,
          output: (out + "\n" + out2).trim().slice(-2500),
          gpuRecommended: true,
        };
      }
    }
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
