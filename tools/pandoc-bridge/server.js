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
  setXelatexPath,
  getConvertProgress,
} = require("./pandoc-ops");

const BRIDGE_VERSION = "0.1.10";
const FEATURES = { pandoc: true, importToMarkdown: true, printPdf: true, convertProgress: true };

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
        note: "Pandoc：结构化互转；PDF 印刷级仅 XeLaTeX",
      });
      return;
    }
    if (pathname === "/pdf-engines" && req.method === "GET") {
      const pdf = await probePdfEngines();
      sendJson(res, 200, { ok: true, ...pdf });
      return;
    }
    if (pathname === "/progress" && req.method === "GET") {
      sendJson(res, 200, getConvertProgress());
      return;
    }
    if (pathname === "/set-xelatex-path" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req));
      console.log(`[pandoc] 收到用户指定 xelatex 路径：${String(body?.path || "").slice(0, 200)}`);
      const data = await setXelatexPath(body);
      sendJson(res, 200, { ok: true, ...data });
      return;
    }
    if (pathname === "/convert" && req.method === "POST") {
      console.log("");
      console.log("[pandoc] ════ 收到转换请求 · 正在接收上传…");
      let body = opts.preloadedBody;
      if (body == null) {
        const raw = await readBody(req, 96 * 1024 * 1024, {
          onProgress: (n) => {
            console.log(`[pandoc] 上传中… ${Math.round(n / 1024)} KB`);
          },
        });
        console.log(`[pandoc] 上传完成 · ${Math.round(raw.length / 1024)} KB`);
        body = parseJsonBody(raw);
      } else {
        console.log("[pandoc] 使用预读 body（统一桥已拦截校验）");
      }
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
      console.log("");
      console.log("[pandoc] ← 已收到 /install 请求，正在读参数…");
      const body =
        opts.preloadedBody != null ? opts.preloadedBody : parseJsonBody(await readBody(req));
      const pkg = String(body?.package || body?.pkg || "pandoc").toLowerCase();
      const pathInput = String(body?.path || body?.xelatex || body?.bin || "").trim();
      const label =
        pathInput
          ? "指定 xelatex 路径"
          : pkg === "typst" ||
              pkg === "pdf" ||
              pkg === "pdf-engine" ||
              pkg === "xelatex" ||
              pkg === "miktex" ||
              pkg === "latex" ||
              pkg === "xelatex-path" ||
              pkg === "set-xelatex-path" ||
              pkg === "set-path"
            ? "XeLaTeX（PDF 引擎）"
            : "pandoc";
      if (pathInput) {
        console.log(`[pandoc] ════ ${label} · 不会下载 · ${pathInput.slice(0, 160)} ════`);
      } else {
        console.log(`[pandoc] ════ 开始安装 ${label} · 下方为实时进度 ════`);
      }
      const t0 = Date.now();
      try {
        const data = await installPackage(body);
        const sec = Math.round((Date.now() - t0) / 1000);
        console.log(
          `[pandoc] ════ 结束 · ${sec}s · ${label} · installed=${data.installed ? "是" : "否"} ════`
        );
        if (data.needsManual) {
          console.log(`[pandoc] 需手动安装：${data.command || data.message || ""}`);
        }
        console.log("");
        sendJson(res, 200, { ok: true, ...data });
      } catch (err) {
        console.log(`[pandoc] 安装失败 · ${err?.message || err}`);
        console.log("");
        throw err;
      }
      return;
    }
    sendJson(res, 404, { ok: false, error: "未知接口" });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err?.message || String(err) });
  }
}

module.exports = { handleRequest, BRIDGE_VERSION, FEATURES };
