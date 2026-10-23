"use strict";

/**
 * Docling 模块（挂到统一桥 /docling/*）。
 * 高质量文档 → Markdown（含 PDF OCR），供备忘录导入等调用。
 */

const { checkDocling, convert, installDocling } = require("./docling-ops");

const BRIDGE_VERSION = "0.1.1";
const FEATURES = { docling: true, ocr: true };

function readBody(req, limit = 96 * 1024 * 1024, { onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let lastLog = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("请求体过大（单文件上限约 80MB）"), { status: 413 }));
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
    if (pathname === "/health" || pathname === "/") {
      const docling = await checkDocling();
      sendJson(res, 200, {
        ok: true,
        version: BRIDGE_VERSION,
        docling,
        features: FEATURES,
        note: "IBM Docling：PDF/DOCX/PPTX/XLSX/HTML/图片 → Markdown（本机 OCR，不上传）",
      });
      return;
    }
    if (pathname === "/convert" && req.method === "POST") {
      console.log("");
      console.log("[docling] ════ 收到文档转换请求（MDM 导入等）· 正在接收上传…");
      const raw = await readBody(req, 96 * 1024 * 1024, {
        onProgress: (n) => {
          console.log(`[docling] 上传中… ${Math.round(n / 1024)} KB`);
        },
      });
      console.log(`[docling] 上传完成 · ${Math.round(raw.length / 1024)} KB`);
      const body = parseJsonBody(raw);
      const name = String(body.filename || body.name || "document.bin");
      console.log(`[docling] 文件「${name}」· 进入转换（进度见下方）`);
      const t0 = Date.now();
      try {
        const data = await convert(body);
        console.log(`[docling] /convert 成功 · ${Math.round((Date.now() - t0) / 1000)}s · 「${name}」`);
        console.log("");
        sendJson(res, 200, { ok: true, ...data });
      } catch (err) {
        console.log(`[docling] /convert 失败 · ${Math.round((Date.now() - t0) / 1000)}s · ${err?.message || err}`);
        console.log("");
        throw err;
      }
      return;
    }
    if (pathname === "/install" && req.method === "POST") {
      console.log("[docling] 开始安装 Docling…");
      const data = await installDocling();
      console.log(`[docling] 安装结束 · installed=${!!data?.installed}`);
      sendJson(res, 200, { ok: true, ...data });
      return;
    }
    sendJson(res, 404, { ok: false, error: "未知接口" });
  } catch (err) {
    const status = err?.status || 400;
    sendJson(res, status, { ok: false, error: err?.message || String(err) });
  }
}

module.exports = { handleRequest, BRIDGE_VERSION, FEATURES };
