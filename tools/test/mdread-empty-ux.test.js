"use strict";

/** MD 阅读空态：要有品牌、主按钮、拖放区，不能只剩两行字 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "mdread");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const css = fs.readFileSync(path.join(root, "app.css"), "utf8");
const js = fs.readFileSync(path.join(root, "app.js"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("空态有品牌与主 CTA", () => {
  assert.ok(html.includes('class="empty-brand"'));
  assert.ok(html.includes("MD 阅读"));
  assert.ok(html.includes('id="mr-open-btn"'));
  assert.ok(html.includes('id="mr-paste-btn"'));
  assert.ok(html.includes('id="mr-empty-zone"'));
});

t("空态可选阅读三档配色，进入后专注阅读", () => {
  assert.ok(html.includes('id="mr-theme"'));
  assert.ok(html.includes('data-read-theme="paper"'));
  assert.ok(html.includes('data-read-theme="sepia"'));
  assert.ok(html.includes('data-read-theme="soft"'));
  assert.ok(js.includes("READ_THEMES"));
  assert.ok(js.includes("applyReadTheme"));
  assert.ok(js.includes("devtools-mdread-theme-v1"));
  assert.ok(js.includes('return "paper"'));
  assert.ok(css.includes(".empty-theme-chip"));
});

t("样式覆盖拖放区与空态氛围", () => {
  assert.ok(css.includes(".empty-zone"));
  assert.ok(css.includes(".empty-cta"));
  assert.ok(css.includes("body:not(.has-doc)"));
});

t("空态可打开 / 粘贴", () => {
  assert.ok(js.includes("bindPick(emptyZone)"));
  assert.ok(js.includes("pasteMarkdownText"));
  assert.ok(js.includes('openText(text, "clipboard.md")'));
});

t("SW 壳缓存已升版", () => {
  assert.ok(/mdread-shell-v10/.test(sw));
});

t("空页不会被 display:grid 顶出「未命名」", () => {
  assert.ok(css.includes(".layout[hidden]"));
  assert.ok(css.includes("body:not(.has-doc) .layout"));
  assert.ok(css.includes("body.has-doc .drop-hint"));
  assert.ok(!html.includes(">未命名<"));
});

console.log(`mdread-empty-ux.test.js: ${n} passed`);
