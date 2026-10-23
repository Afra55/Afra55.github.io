"use strict";

/**
 * Pandoc 模块（挂到统一桥 /pandoc/*）。
 * - 文本：Markdown → docx/odt/epub/…（导出）
 * - 文件：docx/odt/epub/html/… → Markdown（高质量导入）
 */

const { checkPandoc, convert, installPandoc } = require("./pandoc-ops");

const BRIDGE_VERSION = "0.1.1";
const FEATURES = { pandoc: true, importToMarkdown: true };

function readBody(req, limit = 96 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("请求体过大"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
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
        features: FEATURES,
        note: "Pandoc：结构化文档互转；文件→MD 用于 MDM 高质量导入",
      });
      return;
    }
    if (pathname === "/convert" && req.method === "POST") {
      const raw = await readBody(req);
      console.log(`[pandoc] 收到 /convert · 请求体 ${Math.round(raw.length / 1024)} KB`);
      const body = parseJsonBody(raw);
      const t0 = Date.now();
      try {
        const data = await convert(body);
        console.log(`[pandoc] /convert 成功 · ${Math.round((Date.now() - t0) / 1000)}s`);
        sendJson(res, 200, { ok: true, ...data });
      } catch (err) {
        console.log(`[pandoc] /convert 失败 · ${err?.message || err}`);
        throw err;
      }
      return;
    }
    if (pathname === "/install" && req.method === "POST") {
      const data = await installPandoc();
      sendJson(res, 200, { ok: true, ...data });
      return;
    }
    sendJson(res, 404, { ok: false, error: "未知接口" });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err?.message || String(err) });
  }
}

module.exports = { handleRequest, BRIDGE_VERSION, FEATURES };
