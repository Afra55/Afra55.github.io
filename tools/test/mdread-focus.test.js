"use strict";

/**
 * MD 阅读：专注预览；MDM 右键交接须用 localStorage + 手势内先 open。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "mdread", "index.html"), "utf8");
const app = fs.readFileSync(path.join(root, "mdread", "app.js"), "utf8");
const mdm = fs.readFileSync(path.join(root, "extra-panels", "mdm.js"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("阅读页无顶部三按钮（选择/关闭/回工具站）", () => {
  assert.ok(!html.includes("选择 MD"));
  assert.ok(!html.includes("mr-clear"));
  assert.ok(!html.includes("回工具站"));
  assert.ok(!html.includes("mr-install"));
  assert.ok(!html.includes('class="top"'));
});

t("空态可点选；隐藏 file input 仍在", () => {
  assert.ok(/id="mr-file"/.test(html));
  assert.ok(/id="mr-empty"/.test(html));
  assert.ok(/点击选择/.test(html) || /点击/.test(html));
  assert.ok(app.includes("pickFile") || app.includes("showPicker"));
  assert.ok(app.includes('empty?.addEventListener("click"'));
});

t("拖入换文：全局 drop → openFile", () => {
  assert.ok(app.includes('window.addEventListener("drop"'));
  assert.ok(app.includes("openFile"));
});

t("MDM 交接：直接开阅读页应用窗（禁止 about:blank）", () => {
  assert.ok(mdm.includes("function openMdReadAppWindow"));
  const fn = mdm.slice(mdm.indexOf("async function openInMdRead"), mdm.indexOf("function showListCtx"));
  assert.ok(fn.includes("openMdReadAppWindow"));
  assert.ok(fn.includes("writeMdReadHandoff"));
  assert.ok(!fn.includes("about:blank"));
  assert.ok(mdm.includes("popup=yes"));
});

t("阅读页 takeHandoff + storage/轮询接慢路径", () => {
  assert.ok(app.includes("function takeHandoff"));
  assert.ok(app.includes("localStorage") && app.includes("sessionStorage"));
  assert.ok(app.includes('removeItem(HANDOFF_KEY)'));
  assert.ok(app.includes('addEventListener("storage"'));
  assert.ok(app.includes("handoffTimer") || app.includes("setInterval"));
});

t("大文档默认渲染，不卡「仍然渲染一次」", () => {
  assert.ok(!mdm.includes("largeDocHint"));
  assert.ok(!mdm.includes("data-render-now"));
  const apply = mdm.slice(mdm.indexOf("function applyViewMode"), mdm.indexOf("(function bindSplitter"));
  assert.ok(apply.includes("renderPreview(true)"));
  const sched = mdm.slice(mdm.indexOf("function schedulePreview"), mdm.indexOf("function renderPreview"));
  assert.ok(sched.includes("renderPreview()"));
  assert.ok(!sched.includes("largeDocHint"));
});

console.log(`mdread-focus.test.js: ${n} passed`);
