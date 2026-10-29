"use strict";

/**
 * 文件占用解锁 + 安全擦除模块（挂到统一桥 /unlock/*）。
 * 仅 Windows 生效；其他平台 /health 会返回 isWin=false，前端据此隐藏。
 */

const { isWindows, checkLocks, killProcess, pickPath, resolveByName } = require("./lock-ops");
const { inspectPaths, purgePaths, DEFAULT_PASSES } = require("./purge-ops");

const BRIDGE_VERSION = "0.2.0";
const FEATURES = { unlock: true, purge: true, secureWipe: true, winOnly: true };

function readBody(req, limit = 1024 * 1024) {
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
      sendJson(res, 200, {
        ok: true,
        isWin: isWindows(),
        platform: process.platform,
        version: BRIDGE_VERSION,
        features: FEATURES,
      });
      return;
    }
    if (!isWindows()) {
      sendJson(res, 400, { ok: false, error: "该功能仅支持 Windows" });
      return;
    }
    if (pathname === "/check" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req));
      const data = await checkLocks(body.path);
      sendJson(res, 200, { ok: true, ...data });
      return;
    }
    if (pathname === "/kill" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req));
      const data = await killProcess(body.pid, { force: Boolean(body.force) });
      sendJson(res, 200, { ok: true, ...data });
      return;
    }
    if (pathname === "/resolve" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req));
      const found = await resolveByName(body.name);
      sendJson(res, 200, { ok: true, path: found });
      return;
    }
    if (pathname === "/pick" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req));
      const kind = body.kind === "dir" ? "dir" : body.kind === "files" ? "files" : "file";
      const data = await pickPath(kind);
      sendJson(res, 200, { ok: true, ...data });
      return;
    }
    if (pathname === "/inspect" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req));
      const items = await inspectPaths(body.paths || (body.path ? [body.path] : []));
      sendJson(res, 200, { ok: true, items });
      return;
    }
    if (pathname === "/purge" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req));
      if (!body.confirm) {
        sendJson(res, 400, { ok: false, error: "缺少确认标记 confirm=true" });
        return;
      }
      const passes = Math.min(5, Math.max(1, Number(body.passes) || DEFAULT_PASSES));
      const data = await purgePaths(body.paths || [], { passes });
      sendJson(res, 200, { ok: data.ok, ...data });
      return;
    }
    sendJson(res, 404, { ok: false, error: "未知接口" });
  } catch (err) {
    sendJson(res, 400, { ok: false, error: err?.message || String(err) });
  }
}

module.exports = { handleRequest, BRIDGE_VERSION, FEATURES };
