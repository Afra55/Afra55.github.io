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
  return execSync("TZ=Asia/Shanghai date +%Y.%m.%d-%H%M%S", { encoding: "utf8" }).trim();
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
  console.log(JSON.stringify({ ok: true, oldVer, newVer, changed, timezone: "Asia/Shanghai" }, null, 2));
}

main();
