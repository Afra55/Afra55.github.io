"use strict";

/**
 * MinerU 模块（挂到统一桥 /mineru/*）。
 * 高质量文档 → Markdown（PDF/扫描/表/公式/中文优先），供备忘录导入等调用。
 */

const { checkMinerU, convert, installMinerU } = require("./mineru-ops");

const BRIDGE_VERSION = "0.1.6";
const FEATURES = { mineru: true, ocr: true, gpuRecommended: true };

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
      const mineru = await checkMinerU();
      sendJson(res, 200, {
        ok: true,
        version: BRIDGE_VERSION,
        mineru,
        features: FEATURES,
        note: "MinerU：PDF/图 advanced；Office/HTML/EPUB 等 flash。模型与临时文件均在桥目录 mineru-data/（建议 GPU）",
      });
      return;
    }
    if (pathname === "/convert" && req.method === "POST") {
      console.log("");
      console.log("[mineru] ════ 收到文档转换请求（MDM 导入等）· 正在接收上传…");
      const raw = await readBody(req, 96 * 1024 * 1024, {
        onProgress: (n) => {
          console.log(`[mineru] 上传中… ${Math.round(n / 1024)} KB`);
        },
      });
      console.log(`[mineru] 上传完成 · ${Math.round(raw.length / 1024)} KB · 开始解析请求…`);
      const body = parseJsonBody(raw);
      const name = String(body.filename || body.name || "document.bin");
      console.log(`[mineru] 文件「${name}」· 进入转换（进度见下方日志 / 黑窗口）`);
      const t0 = Date.now();
      try {
        const data = await convert(body);
        console.log(`[mineru] /convert 成功 · ${Math.round((Date.now() - t0) / 1000)}s · 「${name}」`);
        console.log("");
        sendJson(res, 200, { ok: true, ...data });
      } catch (err) {
        console.log(`[mineru] /convert 失败 · ${Math.round((Date.now() - t0) / 1000)}s · ${err?.message || err}`);
        console.log("");
        throw err;
      }
      return;
    }
    if (pathname === "/install" && req.method === "POST") {
      console.log("[mineru] 开始安装 MinerU…");
      const data = await installMinerU();
      console.log(`[mineru] 安装结束 · installed=${!!data?.installed}`);
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
