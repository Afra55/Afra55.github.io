#!/usr/bin/env node
/**
 * 校验动态 import vendor：存在、HTTP、MIME、路径解析（含 /tools 无尾斜杠）。
 * 用法：node tools/scripts/verify-vendor-dynamic.cjs [baseUrl]
 */
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const https = require("https");

const TOOLS = path.resolve(__dirname, "..");
const ROOT = path.resolve(TOOLS, "..");
const baseArg = process.argv[2] || "http://127.0.0.1:8080/tools/";
const buildPath = path.join(TOOLS, "lib", "tools-build.js");
const buildSrc = fs.readFileSync(buildPath, "utf8");
const m = buildSrc.match(/const BUILD = "([^"]+)"/);
const BUILD = m ? m[1] : "";

const FILES = [
  "vendor/gifsicle.min.js",
  "vendor/gifski/gifski_wasm.js",
  "vendor/gifski/gifski_wasm_bg.wasm",
  "vendor/ffmpeg/ff/index.js",
  "vendor/ffmpeg/core/ffmpeg-core.wasm",
  "vendor/gif.worker.js",
  "vendor/jsquash/hub.js",
];

function fail(msg) {
  console.error(`FAIL  ${msg}`);
  process.exitCode = 1;
}
function ok(msg) {
  console.log(`ok    ${msg}`);
}

function resolveLikeBrowser(relPath, pageUrl, scriptSrc) {
  const clean = String(relPath || "").replace(/^\.\//, "").replace(/^\/+/, "");
  const ver = encodeURIComponent(String(BUILD || "").replace(/^v/, ""));
  const qs = ver ? `?v=${ver}` : "";
  const rel = `${clean}${qs}`;
  if (scriptSrc && /\/lib\/[^/]+\.js(\?|#|$)/i.test(scriptSrc)) {
    return new URL(`../${rel}`, scriptSrc).href;
  }
  let base = pageUrl;
  const u = new URL(base);
  if (/\/tools$/i.test(u.pathname)) {
    u.pathname += "/";
    base = u.href;
  }
  return new URL(`./${rel}`, base).href;
}

function fetchMeta(url) {
  return new Promise((resolve) => {
    const lib = url.startsWith("https") ? https : http;
    // 用 GET：部分本地静态服对 HEAD 会 ECONNRESET
    const req = lib.get(url, (res) => {
      const out = {
        status: res.statusCode,
        type: String(res.headers["content-type"] || ""),
        len: res.headers["content-length"],
      };
      res.resume();
      resolve(out);
    });
    req.on("error", (err) => resolve({ status: 0, type: "", err: err.message }));
    req.setTimeout(15000, () => {
      req.destroy();
      resolve({ status: 0, type: "", err: "timeout" });
    });
  });
}

async function main() {
  console.log(`base=${baseArg} build=${BUILD}`);

  for (const rel of FILES) {
    const abs = path.join(TOOLS, rel);
    if (!fs.existsSync(abs)) {
      fail(`missing on disk: ${rel}`);
      continue;
    }
    const size = fs.statSync(abs).size;
    ok(`disk ${rel} (${size} bytes)`);
  }

  const pageNoSlash = baseArg.replace(/\/+$/, "").replace(/\/tools\/?$/, "/tools");
  const pageSlash = pageNoSlash.endsWith("/") ? pageNoSlash : `${pageNoSlash}/`;
  const scriptSrc = new URL(`lib/tools-build.js?v=${BUILD}`, pageSlash).href;

  const gifsicleFromScript = resolveLikeBrowser("vendor/gifsicle.min.js", pageNoSlash, scriptSrc);
  const gifsicleFromNoSlash = resolveLikeBrowser("vendor/gifsicle.min.js", pageNoSlash, "");
  const badNoSlash = new URL("./vendor/gifsicle.min.js", pageNoSlash).href;

  if (!/\/tools\/vendor\/gifsicle\.min\.js\?v=/.test(gifsicleFromScript)) {
    fail(`script-based resolve wrong: ${gifsicleFromScript}`);
  } else ok(`script resolve → ${gifsicleFromScript}`);

  if (!/\/tools\/vendor\/gifsicle\.min\.js\?v=/.test(gifsicleFromNoSlash)) {
    fail(`no-slash page resolve wrong: ${gifsicleFromNoSlash}`);
  } else ok(`/tools 无尾斜杠 normalize → ${gifsicleFromNoSlash}`);

  if (/\/tools\/vendor\//.test(badNoSlash)) {
    ok(`注：当前 UA/URL 下 naive ./vendor 碰巧仍在 tools 下：${badNoSlash}`);
  } else {
    ok(`naive ./vendor 在无尾斜杠会指错：${badNoSlash}（已由 resolve 修复）`);
  }

  const origin = new URL(pageSlash).origin;
  for (const rel of FILES) {
    const url = `${origin}/tools/${rel}?v=${encodeURIComponent(BUILD)}`;
    const r = await fetchMeta(url);
    if (r.status !== 200) {
      fail(`HTTP ${r.status} ${url}${r.err ? ` (${r.err})` : ""}`);
      continue;
    }
    const isWasm = /\.wasm$/i.test(rel);
    const isJs = /\.js$/i.test(rel);
    if (isWasm && !/wasm|octet-stream/i.test(r.type)) {
      fail(`MIME ${r.type} for ${rel}`);
    } else if (isJs && !/javascript|ecmascript|text\/plain/i.test(r.type)) {
      // GitHub Pages / python http.server 通常给 application/javascript
      fail(`MIME ${r.type} for ${rel}`);
    } else {
      ok(`HTTP 200 ${rel} CT=${r.type || "?"} Len=${r.len || "?"}`);
    }
  }

  // 站根错误路径应 404
  const wrong = `${origin}/vendor/gifsicle.min.js`;
  const wr = await fetchMeta(wrong);
  if (wr.status === 404 || wr.status === 0) {
    ok(`站根 /vendor/gifsicle 不可达（${wr.status || "err"}）— 无尾斜杠隐患仍真实存在`);
  } else {
    fail(`站根意外可达：${wrong} → ${wr.status}`);
  }

  if (process.exitCode) {
    console.error("verify-vendor-dynamic: FAILED");
    process.exit(1);
  }
  console.log("verify-vendor-dynamic: all checks passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
