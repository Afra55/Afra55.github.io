"use strict";

/**
 * Pandoc 模块（挂到统一桥 /pandoc/*）。
 * - 文本：Markdown → docx/odt/epub/pdf(印刷级)…
 * - 文件：docx/odt/epub/html/… → Markdown（高质量导入）
 */

const {
  checkPandoc,
  convert,
  installPackage,
  probePdfEngines,
} = require("./pandoc-ops");

const BRIDGE_VERSION = "0.1.4";
const FEATURES = { pandoc: true, importToMarkdown: true, printPdf: true };

function readBody(req, limit = 96 * 1024 * 1024, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let lastLog = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("请求体过大"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
      const now = Date.now();
      if (typeof onProgress === "function" && now - lastLog >= 400) {
        lastLog = now;
        onProgress(size);
      }
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseJsonBody(buf) {
  const text = Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf || "");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function handleRequest(req, res, opts = {}) {
  const pathname = String(opts.pathname || "/").replace(/\/+$/, "") || "/";
  try {
    if (pathname === "/health") {
      const pandoc = await checkPandoc();
      sendJson(res, 200, {
        ok: true,
        version: BRIDGE_VERSION,
        pandoc,
        features: {
          ...FEATURES,
          printPdf: !!pandoc?.pdf?.printReady,
          preferredPdfEngine: pandoc?.pdf?.preferred || null,
        },
        note: "Pandoc：结构化互转；PDF 印刷级优先 Typst / XeLaTeX",
      });
      return;
    }
    if (pathname === "/pdf-engines" && req.method === "GET") {
      const pdf = await probePdfEngines();
      sendJson(res, 200, { ok: true, ...pdf });
      return;
    }
    if (pathname === "/convert" && req.method === "POST") {
      console.log("");
      console.log("[pandoc] ════ 收到转换请求 · 正在接收上传…");
      const raw = await readBody(req, 96 * 1024 * 1024, {
        onProgress: (n) => {
          console.log(`[pandoc] 上传中… ${Math.round(n / 1024)} KB`);
        },
      });
      console.log(`[pandoc] 上传完成 · ${Math.round(raw.length / 1024)} KB`);
      const body = parseJsonBody(raw);
      const name = String(body.filename || body.name || "(text)");
      console.log(`[pandoc] 开始处理「${name}」…`);
      const t0 = Date.now();
      try {
        const data = await convert(body);
        console.log(`[pandoc] /convert 成功 · ${Math.round((Date.now() - t0) / 1000)}s · 「${name}」`);
        console.log("");
        sendJson(res, 200, { ok: true, ...data });
      } catch (err) {
        console.log(`[pandoc] /convert 失败 · ${err?.message || err}`);
        console.log("");
        throw err;
      }
      return;
    }
    if (pathname === "/install" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req));
      const data = await installPackage(body);
      sendJson(res, 200, { ok: true, ...data });
      return;
    }
    sendJson(res, 404, { ok: false, error: "未知接口" });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err?.message || String(err) });
  }
}

module.exports = { handleRequest, BRIDGE_VERSION, FEATURES };
