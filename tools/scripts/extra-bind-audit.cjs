#!/usr/bin/env node
"use strict";

/**
 * 静态审计 extra-panels/*.js 的 bindPanel 延迟绑定
 */

const fs = require("fs");
const path = require("path");

const PANELS_DIR = path.join(__dirname, "../extra-panels");
const KIT_PATH = path.join(__dirname, "../lib/extra-kit.js");
const failures = [];

const kitSrc = fs.readFileSync(KIT_PATH, "utf8");
if (!/const \$ = \(sel, root = document\)/.test(kitSrc)) {
  failures.push("extra-kit.js: 缺少 $ 定义（拆分后会导致 DevToolsExtraKit 初始化失败）");
}
if (!/const \$\$ = \(sel, root = document\)/.test(kitSrc)) {
  failures.push("extra-kit.js: 缺少 $$ 定义");
}

const files = fs.readdirSync(PANELS_DIR).filter((f) => f.endsWith(".js"));

const shadowRe = /function\s+(\w+)\s*\(\)\s*\{[\s\S]*?\n\s+let\s+(\w+);\s*\n(?:\s+let\s+\w+;\s*\n)?\s+if\s*\(\s*!\2\b/g;

for (const file of files) {
  const src = fs.readFileSync(path.join(PANELS_DIR, file), "utf8");
  let m;
  while ((m = shadowRe.exec(src))) {
    failures.push(`${file}: ${m[1]}() 内 let ${m[2]} 遮蔽导致 if (!${m[2]}) return 恒为真`);
  }
  if (/\.forEach\s*\([^)]*\)\s*=>\s*\{[^}]*bindPanel\s*\(/s.test(src)) {
    failures.push(`${file}: bindPanel 写在 forEach 内`);
  }
}

if (failures.length) {
  console.error("extra-bind-audit: 发现回归风险\n");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}

console.log(`extra-bind-audit: OK (${files.length} panel files)`);
