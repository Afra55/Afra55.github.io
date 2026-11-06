"use strict";

/** 阅读页代码块背景须与文档管理预览一致 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const mdreadCss = fs.readFileSync(path.join(__dirname, "..", "mdread", "app.css"), "utf8");
const mdmCss = fs.readFileSync(path.join(__dirname, "..", "styles", "panels", "mdm.css"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("MDM 深色最终 pre 背景为 0.3", () => {
  assert.ok(/\.markdown-body pre\s*\{[^}]*background:\s*rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\.3\s*\)/.test(mdmCss));
});

t("mdread 深色 pre 背景对齐 0.3，禁止 0.28", () => {
  assert.ok(!/background:\s*rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\.28\s*\)/.test(mdreadCss));
  assert.ok(/\.preview pre[\s\S]*?background:\s*rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\.3\s*\)/.test(mdreadCss));
});

t("mdread 浅色 pre 背景对齐 MDM 0.06", () => {
  assert.ok(mdmCss.includes("rgba(0, 0, 0, 0.06)"));
  assert.ok(/prefers-color-scheme:\s*light[\s\S]*?background:\s*rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\.06\s*\)/.test(mdreadCss));
});

console.log(`mdread-code-bg.test.js: ${n} passed`);
