#!/usr/bin/env node
/**
 * 统一 bump TOOLS_VERSION 与全站 ?v= 缓存戳。
 * 时间戳使用中国标准时间（Asia/Shanghai，UTC+8）。
 *
 * 用法：node tools/bump-version.cjs
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = __dirname;
const TOOLS_BUILD = path.join(ROOT, "lib/tools-build.js");

function chinaVersionStamp() {
  // 纯 JS 计算北京时间（原来用 `TZ=Asia/Shanghai date`，在 Windows 上会直接失败）
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date());
  const p = {};
  for (const x of parts) p[x.type] = x.value;
  return `${p.year}.${p.month}.${p.day}-${p.hour}${p.minute}${p.second}`;
}

function readCurrentVersion() {
  const text = fs.readFileSync(TOOLS_BUILD, "utf8");
  const m = text.match(/const BUILD = "([^"]+)"/) || text.match(/window\.TOOLS_BUILD = "([^"]+)"/);
  return m ? m[1] : "";
}

function shouldScanFile(filePath) {
  const base = path.basename(filePath);
  if (base === "bump-version.cjs") return false;
  const ext = path.extname(filePath);
  return [".html", ".js", ".css", ".cjs", ".mjs"].includes(ext);
}

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (name === "node_modules" || name === "vendor" || name === "ffmpeg" || name === "excalidraw") continue;
      walk(full, out);
      continue;
    }
    if (shouldScanFile(full)) out.push(full);
  }
  return out;
}

function main() {
  const oldVer = readCurrentVersion();
  const newVer = chinaVersionStamp();
  if (!oldVer) {
    console.error("BUILD not found in tools/lib/tools-build.js");
    process.exit(1);
  }
  if (oldVer === newVer) {
    console.log(JSON.stringify({ ok: true, oldVer, newVer, changed: 0, note: "same second, skipped" }));
    return;
  }
  let changed = 0;
  for (const file of walk(ROOT)) {
    const text = fs.readFileSync(file, "utf8");
    if (!text.includes(oldVer)) continue;
    fs.writeFileSync(file, text.split(oldVer).join(newVer));
    changed += 1;
  }
  // service worker 的 shell 缓存名必须随版本变化，否则缓存优先策略会一直发旧的 index.html
  // （进而引到旧的 ?v= 资源，用户永远拿不到新代码）。格式：devtools-shell-YYYYMMDD-HHMMSS
  const swPath = path.join(ROOT, "sw.js");
  const cacheStamp = `devtools-shell-${newVer.replace(/\./g, "")}`;
  if (fs.existsSync(swPath)) {
    const sw = fs.readFileSync(swPath, "utf8");
    const next = sw.replace(/devtools-shell-[0-9]{8}-[0-9]{6}/, cacheStamp);
    if (next !== sw) {
      fs.writeFileSync(swPath, next);
      changed += 1;
      console.log(`[bump-version] sw.js SHELL_CACHE -> ${cacheStamp}`);
    }
  }
  console.log(JSON.stringify({ ok: true, oldVer, newVer, changed, timezone: "Asia/Shanghai" }, null, 2));
}

main();
