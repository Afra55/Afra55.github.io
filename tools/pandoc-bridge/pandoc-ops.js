"use strict";

/**
 * Pandoc 转换（本机桥模块）：Markdown → 任意格式。
 * 需要本机 PATH 里有 pandoc。
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

function runPandoc(args, { input, timeout = 90000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      "pandoc",
      args,
      { timeout, maxBuffer: 128 * 1024 * 1024, windowsHide: true, encoding: "buffer" },
      (err, stdout, stderr) => {
        if (err) {
          err.stderr = Buffer.isBuffer(stderr) ? stderr.toString("utf8") : String(stderr || "");
          reject(err);
          return;
        }
        resolve({ stdout, stderr });
      }
    );
    if (input != null) {
      child.stdin.write(input);
      child.stdin.end();
    }
  });
}

async function checkPandoc() {
  try {
    const { stdout } = await runPandoc(["--version"]);
    const first = String(stdout || "").split(/\r?\n/)[0] || "pandoc";
    return { ok: true, version: first };
  } catch (err) {
    return { ok: false, error: "未找到 pandoc（请安装并加入 PATH）" };
  }
}

function safeBase(title) {
  return String(title || "document").replace(/[\\/:*?"<>|]+/g, "_").slice(0, 80) || "document";
}

async function convert({ text, to, from = "markdown", title }) {
  const toFmt = String(to || "").trim().toLowerCase();
  if (!toFmt) throw new Error("缺少目标格式");
  if (toFmt === "pdf") throw new Error("PDF 请用前端打印（Pandoc 出 PDF 需额外 LaTeX 引擎）");
  const ext = EXT[toFmt] || toFmt;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-pandoc-"));
  const outPath = path.join(tmp, `out.${ext}`);
  try {
    await runPandoc(["-f", String(from || "markdown"), "-t", toFmt, "-o", outPath], {
      input: Buffer.from(String(text || ""), "utf8"),
    });
    const buf = fs.readFileSync(outPath);
    return { dataBase64: buf.toString("base64"), filename: `${safeBase(title)}.${ext}` };
  } catch (err) {
    const msg = String(err?.stderr || err?.message || err).trim();
    throw new Error(msg.slice(0, 400) || "pandoc 转换失败");
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (_) {}
  }
}

module.exports = { checkPandoc, convert };
