"use strict";

/** MD 阅读 lightbox：图表/表格空白处可拖，文字/单元格留给划词 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "mdread", "preview.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "mdread", "app.css"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("lightbox 绑定 pointer 拖动画布", () => {
  assert.ok(src.includes("function createLightbox"));
  assert.ok(src.includes('"pointerdown"'));
  assert.ok(src.includes('"pointermove"'));
  assert.ok(src.includes("view.dragging"));
  assert.ok(src.includes("setPointerCapture"));
});

t("图表：文字上不拖，空白/图形可拖", () => {
  assert.ok(src.includes("function isSvgTextTarget"));
  assert.ok(src.includes("空白处拖动"));
  const lb = src.slice(src.indexOf("function createLightbox"), src.indexOf("function bindPreviewClicks"));
  assert.ok(lb.includes('mode === "svg" && isSvgTextTarget'));
  assert.ok(css.includes(".lb-stage.is-svg-mode"));
  assert.ok(css.includes("cursor: grab"));
});

t("表格：空白可拖，单元格需 Shift+拖", () => {
  assert.ok(src.includes("单元格上 Shift+拖") || src.includes("Shift+拖"));
  const lb = src.slice(src.indexOf("function createLightbox"), src.indexOf("function bindPreviewClicks"));
  assert.ok(lb.includes('mode === "table" && e.target.closest?.("table, th, td")'));
  assert.ok(lb.includes("!e.shiftKey"));
});

console.log(`mdread-lightbox-pan.test.js: ${n} passed`);
