"use strict";

/**
 * Pandoc 模块（挂到统一桥 /pandoc/*）。
 * 把 Markdown 转成 docx/odt/epub/rtf/rst/latex/pptx/html 等任意格式。
 */

const { checkPandoc, convert, installPandoc } = require("./pandoc-ops");

const BRIDGE_VERSION = "0.1.0";
const FEATURES = { pandoc: true };

function readBody(req, limit = 16 * 1024 * 1024) {
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
      sendJson(res, 200, { ok: true, version: BRIDGE_VERSION, pandoc, features: FEATURES });
      return;
    }
    if (pathname === "/convert" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req));
      const data = await convert(body);
      sendJson(res, 200, { ok: true, ...data });
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
