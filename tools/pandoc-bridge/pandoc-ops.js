"use strict";

/**
 * Pandoc 转换 + 一键安装（本机桥模块）。
 * Markdown → 任意格式；未装 pandoc 时可调 install 自动装（Windows/macOS）。
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
  pptx: "pptx",
  mediawiki: "wiki",
  org: "org",
  opml: "opml",
  html: "html",
  markdown: "md",
  gfm: "md",
  plain: "txt",
  asciidoc: "adoc",
  textile: "textile",
  dokuwiki: "txt",
  json: "json",
  native: "native",
};

function runCmd(file, args, { input, timeout = 90000, cwd } = {}) {
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

async function checkPandoc() {
  const bin = resolvePandocBin();
  try {
    const { stdout } = await runCmd(bin, ["--version"]);
    const first = String(stdout || "").split(/\r?\n/)[0] || "pandoc";
    return { ok: true, version: first, bin };
  } catch (err) {
    return { ok: false, error: "未找到 pandoc（可点「一键安装」或手动安装）" };
  }
}

async function hasCmd(cmd) {
  try {
    await runCmd(cmd, ["--version"], { timeout: 12000 });
    return true;
  } catch (err) {
    // winget --version 正常返回；若报错但存在也可视为有
    return /ENOENT/.test(String(err?.code || "")) ? false : true;
  }
}

function safeBase(title) {
  return String(title || "document").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "document";
}

async function convert({ text, to, from = "markdown", title, images }) {
  const toFmt = String(to || "").trim().toLowerCase();
  if (!toFmt) throw new Error("缺少目标格式");
  if (toFmt === "pdf") throw new Error("PDF 请用前端打印（Pandoc 出 PDF 需额外 LaTeX 引擎）");
  const ext = EXT[toFmt] || toFmt;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-pandoc-"));
  const outPath = path.join(tmp, `out.${ext}`);
  try {
    // 写入图片，让 Pandoc 能解析相对路径
    if (Array.isArray(images)) {
      for (const im of images.slice(0, 200)) {
        const rel = String(im?.path || "").replace(/\\/g, "/").replace(/\.\.+/g, "").replace(/^\/+/, "");
        if (!rel || !im?.dataBase64) continue;
        const dest = path.join(tmp, rel);
        if (!dest.startsWith(tmp)) continue;
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, Buffer.from(String(im.dataBase64), "base64"));
      }
    }
    await runCmd(resolvePandocBin(), ["-f", String(from || "markdown"), "-t", toFmt, "-o", outPath], {
      input: Buffer.from(String(text || ""), "utf8"),
      cwd: tmp,
    });
    const buf = fs.readFileSync(outPath);
    return { dataBase64: buf.toString("base64"), filename: `${safeBase(title)}.${ext}` };
  } catch (err) {
    const msg = String(err?.stderr || err?.message || err).trim();
    if (/ENOENT|not recognized|not found/i.test(msg)) {
      throw new Error("未找到 pandoc：可点「一键安装 pandoc」");
    }
    throw new Error(msg.slice(0, 400) || "pandoc 转换失败");
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) {}
  }
}

async function installPandoc() {
  const platform = process.platform;
  if (platform === "win32") {
    if (!(await hasCmd("winget"))) {
      return {
        installed: false,
        needsManual: true,
        command: "winget install --id JohnMacFarlane.Pandoc -e",
        message: "未找到 winget（Windows 10 1809+ 自带），请手动安装 pandoc",
      };
    }
    try {
      const { stdout, stderr } = await runCmd(
        "winget",
        [
          "install",
          "--id",
          "JohnMacFarlane.Pandoc",
          "-e",
          "--accept-source-agreements",
          "--accept-package-agreements",
          "--disable-interactivity",
        ],
        { timeout: 900000 }
      );
      resolvePandocBin({ refresh: true });
      const p = await checkPandoc();
      return {
        installed: p.ok,
        output: `${stdout}\n${stderr}`.trim().slice(-2000),
        pandoc: p,
        command: "winget install --id JohnMacFarlane.Pandoc -e",
      };
    } catch (err) {
      const out = `${err?.stdout || ""}\n${err?.stderr || ""}`.trim().slice(-2000);
      resolvePandocBin({ refresh: true });
      const p = await checkPandoc();
      return { installed: p.ok, output: out, pandoc: p, command: "winget install --id JohnMacFarlane.Pandoc -e" };
    }
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

module.exports = { checkPandoc, convert, installPandoc, resolvePandocBin };
