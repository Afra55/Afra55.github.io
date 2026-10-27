"use strict";

/** Mermaid 语法错误不得在页面底部画出大横条；渲染须走离屏 container */
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
  const mark = src.slice(
    src.indexOf("function markMermaidBlockError"),
    src.indexOf("function clearMermaidBlockError")
  );
  assert.ok(mark.includes("previousElementSibling"), "tip 在 pre 前，须复用 previousSibling");
  assert.ok(!/let tip = pre\.querySelector/.test(mark), "勿在 pre 内找 tip（会叠多层）");
});

t("不把「Syntax error」SVG 当成功图缓存", () => {
  const fn = src.slice(src.indexOf("async function renderMermaidBlocks"), src.indexOf("async function saveAsset"));
  assert.ok(/Syntax error in text/i.test(fn));
  assert.ok(fn.includes("throw new Error"));
});

t("根治：mermaid.render 传入离屏 stage，不依赖监听藏节点", () => {
  assert.ok(src.includes("function ensureMermaidStage"));
  assert.ok(src.includes("function clearMermaidStage"));
  assert.ok(src.includes('data-mdm-mermaid-stage'));
  const fn = src.slice(src.indexOf("async function renderMermaidBlocks"), src.indexOf("async function saveAsset"));
  assert.ok(fn.includes("ensureMermaidStage()"));
  assert.ok(/mermaid\.render\(\s*id\s*,\s*src\s*,\s*stage\s*\)/.test(fn), "须传第三参 container");
  assert.ok(!src.includes("ensureMermaidBodyGuard"), "勿再依赖 MutationObserver 闪藏");
  assert.ok(!src.includes("cloakMermaidTempNode"), "勿再依赖节点闪藏");
  assert.ok(css.includes('body > svg[id^="mmd"]') || css.includes("body > svg[id^=\"mmd\"]"), "CSS 兜底仍保留");
});

console.log(`mdm-mermaid-error.test.js: ${n} passed`);
