#!/usr/bin/env node
"use strict";

/**
 * 静态审计 extra.js 的 bindPanel 延迟绑定，防止面板拆分后回归：
 * - 函数内 let 遮蔽 + if (!x) return 导致逻辑永不执行
 * - bindPanel 写在 forEach 内（重复注册 / 监听器绑错时机）
 * - bootExtraPanel 调用的工具必须有 bindPanel 注册
 */

const fs = require("fs");
const path = require("path");

const EXTRA = path.join(__dirname, "../extra.js");
const src = fs.readFileSync(EXTRA, "utf8");
const failures = [];

// 1) 函数开头声明局部 let 后立即 if (!same) return — 典型变量遮蔽死代码
const shadowRe = /function\s+(\w+)\s*\(\)\s*\{[\s\S]*?\n\s+let\s+(\w+);\s*\n(?:\s+let\s+\w+;\s*\n)?\s+if\s*\(\s*!\2\b/g;
let m;
while ((m = shadowRe.exec(src))) {
  failures.push(`变量遮蔽：${m[1]}() 内 let ${m[2]} 导致 if (!${m[2]}) return 恒为真`);
}

// 2) bindPanel 不应出现在 .forEach( 块内
if (/\.forEach\s*\([^)]*\)\s*=>\s*\{[^}]*bindPanel\s*\(/s.test(src)) {
  failures.push("结构错误：bindPanel 写在 forEach 回调内（应只在面板挂载后绑定一次）");
}

// 3) bootExtraPanel 中调用的 id 必须存在 bindPanel 注册
const bootBlock = src.match(/function bootExtraPanel\([\s\S]*?window\.addEventListener\("devtools:route"/);
if (bootBlock) {
  const bootCalls = [...bootBlock[0].matchAll(/if\s*\(id\s*===\s*"([^"]+)"\)/g)].map((x) => x[1]);
  for (const id of bootCalls) {
    if (!src.includes(`bindPanel("${id}"`)) {
      failures.push(`bootExtraPanel 调用 "${id}" 但缺少 bindPanel("${id}") 注册`);
    }
  }
}

// 4) bindPanel 回调内赋值给未在区块顶层声明的标识符（粗检：赋值行上方无 let/var）
const panelSections = src.split(/bindPanel\("([^"]+)"/);
for (let i = 1; i < panelSections.length; i += 2) {
  const panelId = panelSections[i];
  const body = panelSections[i + 1] || "";
  const closeIdx = body.indexOf("});");
  const callback = closeIdx >= 0 ? body.slice(0, closeIdx) : body.slice(0, 1200);
  const assigns = [...callback.matchAll(/^\s{6,}(\w+)\s*=\s*\$\(/gm)].map((x) => x[1]);
  const pre = src.slice(0, src.indexOf(`bindPanel("${panelId}"`));
  const sectionStart = Math.max(pre.lastIndexOf("// ----"), pre.lastIndexOf("});// ----"));
  const header = pre.slice(sectionStart);
  for (const name of assigns) {
    if (new RegExp(`\\blet\\s+${name}\\b`).test(header)) continue;
    if (new RegExp(`\\bvar\\s+${name}\\b`).test(header)) continue;
    if (/^\s*try\s*\{/.test(header) && new RegExp(`\\blet\\s+${name}\\b`).test(header)) continue;
    failures.push(`面板 "${panelId}"：bindPanel 内赋值 ${name} 但区块顶部未声明 let ${name}`);
  }
}

if (failures.length) {
  console.error("extra-bind-audit: 发现回归风险\n");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}

console.log("extra-bind-audit: OK");
