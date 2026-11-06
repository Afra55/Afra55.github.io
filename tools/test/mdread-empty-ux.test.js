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
  assert.ok(/mdread-shell-v8/.test(sw));
});

console.log(`mdread-empty-ux.test.js: ${n} passed`);
