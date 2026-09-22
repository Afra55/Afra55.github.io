#!/usr/bin/env node
/**
 * 全量 JS 语法检查：把 tools 下所有第一方 .js 过一遍 `node --check`。
 * 背景：ci.cjs 原来只逐个列了 app.js / 几个 lib/*.js，extra-panels/*.js（v2g-suite.js 等）
 * 完全没查 —— 曾出现「v2g-suite.js 有重复声明导致语法错误，但 CI 仍然全绿」。
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set(["vendor", "node_modules", "excalidraw", "ffmpeg", "sandspiel", ".git"]);

function walk(dir, out = []) {
  for (const name of fs.readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(full);
    } catch (_) {
      continue;
    }
    if (st.isDirectory()) walk(full, out);
    else if (name.endsWith(".js")) out.push(full);
  }
  return out;
}

const files = walk(ROOT);
const bad = [];
for (const f of files) {
  try {
    execFileSync(process.execPath, ["--check", f], { stdio: "pipe" });
  } catch (err) {
    const msg = (err.stderr ? err.stderr.toString() : "") || String(err.message);
    bad.push({ f: path.relative(ROOT, f), msg: msg.split("\n").filter((l) => l.trim()).slice(0, 3).join(" | ") });
  }
}

if (bad.length) {
  console.error(`syntax: ${bad.length}/${files.length} 个文件语法错误`);
  for (const b of bad) console.error(`  ${b.f}\n    ${b.msg}`);
  process.exit(1);
}
console.log(`syntax: ${files.length} 个 JS 文件全部通过`);
