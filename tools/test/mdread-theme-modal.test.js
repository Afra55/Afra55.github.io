"use strict";

/** MD 阅读：更多护眼配色 + 大纲底栏弹框 + 自定义 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "mdread");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const js = fs.readFileSync(path.join(root, "app.js"), "utf8");
const css = fs.readFileSync(path.join(root, "app.css"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("空页保留三档 + 更多配色入口", () => {
  assert.ok(html.includes('data-read-theme="paper"'));
  assert.ok(html.includes('data-read-theme="sepia"'));
  assert.ok(html.includes('data-read-theme="soft"'));
  assert.ok(html.includes('id="mr-theme-more"'));
  assert.ok(html.includes("更多配色"));
});

t("大纲底部有配色按钮", () => {
  assert.ok(html.includes('id="mr-outline-theme-btn"'));
  assert.ok(css.includes(".outline-theme-btn"));
  assert.ok(css.includes(".outline-foot"));
});

t("弹框支持预置网格与自定义色", () => {
  assert.ok(html.includes('id="mr-theme-modal"'));
  assert.ok(html.includes('id="mr-custom-bg"'));
  assert.ok(html.includes('id="mr-custom-ink"'));
  assert.ok(js.includes("openThemeModal"));
  assert.ok(js.includes("READ_CUSTOM_KEY"));
  assert.ok(js.includes("buildCustomTheme"));
});

t("预置不少于 12 套护眼方案", () => {
  const keys = [
    "paper",
    "sepia",
    "soft",
    "ivory",
    "mist",
    "sage",
    "sand",
    "rose",
    "sky",
    "matcha",
    "slate",
    "night",
    "amber",
    "nord",
    "graphite",
  ];
  keys.forEach((k) => assert.ok(js.includes(`${k}:`), `missing ${k}`));
  assert.ok(keys.length >= 12);
});

console.log(`mdread-theme-modal.test.js: ${n} passed`);
