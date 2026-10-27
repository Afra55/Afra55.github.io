"use strict";

/** Mermaid 语法错误不得在页面底部画出大横条 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "extra-panels", "mdm.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "styles", "panels", "mdm.css"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("initialize 含 suppressErrorRendering", () => {
  assert.ok(/suppressErrorRendering\s*:\s*true/.test(src));
});

t("失败时 scrub 残留 SVG / 临时节点", () => {
  assert.ok(src.includes("function scrubMermaidErrorArtifacts"));
  assert.ok(src.includes("Syntax error in text"));
  assert.ok(src.includes("scrubMermaidErrorArtifacts(id)"));
});

t("错误提示留在代码块旁，不占页面底部", () => {
  assert.ok(src.includes("function markMermaidBlockError"));
  assert.ok(src.includes("mdm-mermaid-err-tip"));
  assert.ok(css.includes(".mdm-mermaid-err-tip"));
});

t("不把「Syntax error」SVG 当成功图缓存", () => {
  const fn = src.slice(src.indexOf("async function renderMermaidBlocks"), src.indexOf("async function saveAsset"));
  assert.ok(/Syntax error in text/i.test(fn));
  assert.ok(fn.includes("throw new Error"));
});

console.log(`mdm-mermaid-error.test.js: ${n} passed`);
