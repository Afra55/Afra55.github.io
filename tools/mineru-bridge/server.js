"use strict";

/**
 * MinerU 模块（挂到统一桥 /mineru/*）。
 * 高质量文档 → Markdown（PDF/扫描/表/公式/中文优先），供备忘录导入等调用。
 */

const { checkMinerU, convert, installMinerU } = require("./mineru-ops");

const BRIDGE_VERSION = "0.1.3";
const FEATURES = { mineru: true, ocr: true, gpuRecommended: true };

function readBody(req, limit = 96 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("请求体过大（单文件上限约 80MB）"), { status: 413 }));
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
    if (pathname === "/health" || pathname === "/") {
      const mineru = await checkMinerU();
      sendJson(res, 200, {
        ok: true,
        version: BRIDGE_VERSION,
        mineru,
        features: FEATURES,
        note: "MinerU：PDF/Office/图片 → Markdown（最高质量 advanced/hybrid-high，建议 GPU；本机处理不上传）",
      });
      return;
    }
    if (pathname === "/convert" && req.method === "POST") {
      const raw = await readBody(req);
      console.log(`[mineru] 收到 /convert · 请求体 ${Math.round(raw.length / 1024)} KB`);
      const body = parseJsonBody(raw);
      const t0 = Date.now();
      try {
        const data = await convert(body);
        console.log(`[mineru] /convert 成功 · ${Math.round((Date.now() - t0) / 1000)}s`);
        sendJson(res, 200, { ok: true, ...data });
      } catch (err) {
        console.log(`[mineru] /convert 失败 · ${Math.round((Date.now() - t0) / 1000)}s · ${err?.message || err}`);
        throw err;
      }
      return;
    }
    if (pathname === "/install" && req.method === "POST") {
      const data = await installMinerU();
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
