"use strict";

/**
 * Proxy Everything HTTP Server through the unified devtools bridge (CORS + PNA).
 * Everything itself does not send Access-Control-Allow-Origin.
 */

const http = require("http");
const https = require("https");

const DEFAULT_EVERYTHING_BASE = "http://127.0.0.1";

function normalizeBase(raw) {
  let s = String(raw || "").trim() || DEFAULT_EVERYTHING_BASE;
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  return s.replace(/\/+$/, "");
}

function defaultEverythingBase() {
  return normalizeBase(process.env.EVERYTHING_HTTP_BASE || process.env.EVERYTHING_BASE || DEFAULT_EVERYTHING_BASE);
}

function proxyGet(targetUrl, { authHeader, timeoutMs = 45_000, maxBytes = 64 * 1024 * 1024 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(targetUrl);
    } catch {
      reject(new Error("无效的 Everything 地址"));
      return;
    }
    const mod = u.protocol === "https:" ? https : http;
    const opts = {
      hostname: u.hostname,
      port: u.port || (u.protocol === "https:" ? 443 : 80),
      path: `${u.pathname}${u.search}`,
      method: "GET",
      headers: {
        "User-Agent": "devtools-bridge-everything",
        Accept: "application/json, text/plain, */*",
      },
      timeout: timeoutMs,
    };
    if (authHeader) opts.headers.Authorization = authHeader;
    const req = mod.request(opts, (res) => {
      const chunks = [];
      let size = 0;
      res.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          req.destroy();
          reject(new Error("Everything 响应过大"));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        resolve({
          status: res.statusCode || 502,
          body: Buffer.concat(chunks),
          headers: res.headers,
        });
      });
    });
    req.on("error", reject);
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("连接 Everything HTTP 超时"));
    });
    req.end();
  });
}

function pickTarget(url) {
  return normalizeBase(url.searchParams.get("target") || defaultEverythingBase());
}

function everythingAuthHeader(req) {
  const auth = req.headers.authorization;
  return auth && String(auth).trim() ? String(auth).trim() : "";
}

function buildEverythingSearchUrl(base, params) {
  const q = new URLSearchParams(params);
  if (!q.has("json")) q.set("json", "1");
  return `${normalizeBase(base)}/?${q.toString()}`;
}

function fileUrl(base, filePath) {
  const p = String(filePath || "").replace(/\\/g, "/");
  if (!p) return normalizeBase(base);
  if (/^[a-z]:\//i.test(p)) return `${normalizeBase(base)}/${encodeURI(p)}`;
  return `${normalizeBase(base)}/${encodeURI(p.replace(/^\/+/, ""))}`;
}

/**
 * @returns {boolean} handled
 */
async function handleApi(req, res, url, deps) {
  const { sendJson, requireToken, applyCors, origin } = deps;
  const pathname = url.pathname;

  if (pathname === "/everything/health" && req.method === "GET") {
    requireToken(req);
    const target = pickTarget(url);
    try {
      const probe = buildEverythingSearchUrl(target, { search: "", count: "1", json: "1" });
      const out = await proxyGet(probe, { authHeader: everythingAuthHeader(req), maxBytes: 512 * 1024 });
      if (out.status === 401) {
        sendJson(res, 401, { ok: false, error: "Everything HTTP 401：用户名或密码错误", target }, origin);
        return true;
      }
      let data = null;
      try {
        data = JSON.parse(out.body.toString("utf8"));
      } catch {
        sendJson(
          res,
          502,
          {
            ok: false,
            error: "Everything 响应不是 JSON。请确认 Everything 已启用 HTTP Server，且地址/端口正确。",
            target,
          },
          origin
        );
        return true;
      }
      sendJson(
        res,
        200,
        {
          ok: true,
          via: "bridge",
          target,
          totalResults: data.totalResults,
        },
        origin
      );
      return true;
    } catch (err) {
      sendJson(
        res,
        502,
        {
          ok: false,
          error: err.message || String(err),
          target,
          hint: "请确认 Everything 正在运行且 HTTP Server 已启用（默认 http://127.0.0.1）",
        },
        origin
      );
      return true;
    }
  }

  if (pathname === "/everything/search" && req.method === "GET") {
    requireToken(req);
    const target = pickTarget(url);
    const params = new URLSearchParams(url.searchParams);
    params.delete("target");
    const targetUrl = buildEverythingSearchUrl(target, params);
    try {
      const out = await proxyGet(targetUrl, {
        authHeader: everythingAuthHeader(req),
        maxBytes: 32 * 1024 * 1024,
      });
      if (out.status === 401) {
        sendJson(res, 401, { ok: false, error: "Everything HTTP 401：用户名或密码错误" }, origin);
        return true;
      }
      if (out.status !== 200) {
        sendJson(res, 502, { ok: false, error: `Everything HTTP ${out.status}` }, origin);
        return true;
      }
      let data;
      try {
        data = JSON.parse(out.body.toString("utf8"));
      } catch {
        sendJson(res, 502, { ok: false, error: "Everything 返回非 JSON" }, origin);
        return true;
      }
      sendJson(res, 200, { ok: true, via: "bridge", target, ...data }, origin);
      return true;
    } catch (err) {
      sendJson(res, 502, { ok: false, error: err.message || String(err), target }, origin);
      return true;
    }
  }

  if (pathname === "/everything/download" && req.method === "GET") {
    requireToken(req);
    const target = pickTarget(url);
    const filePath = url.searchParams.get("path") || "";
    if (!filePath) {
      sendJson(res, 400, { ok: false, error: "缺少 path" }, origin);
      return true;
    }
    const targetUrl = fileUrl(target, filePath);
    try {
      const out = await proxyGet(targetUrl, {
        authHeader: everythingAuthHeader(req),
        maxBytes: 512 * 1024 * 1024,
        timeoutMs: 120_000,
      });
      if (out.status === 401) {
        sendJson(res, 401, { ok: false, error: "Everything HTTP 401" }, origin);
        return true;
      }
      if (out.status !== 200) {
        sendJson(res, 502, { ok: false, error: `下载失败 HTTP ${out.status}` }, origin);
        return true;
      }
      const name = filePath.replace(/^.*[\\/]/, "") || "download.bin";
      const headers = {
        "Content-Type": out.headers["content-type"] || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${encodeURIComponent(name)}"`,
      };
      applyCors(headers, origin);
      res.writeHead(200, headers);
      res.end(out.body);
      return true;
    } catch (err) {
      sendJson(res, 502, { ok: false, error: err.message || String(err) }, origin);
      return true;
    }
  }

  return false;
}

module.exports = {
  handleApi,
  defaultEverythingBase,
  normalizeBase,
};
