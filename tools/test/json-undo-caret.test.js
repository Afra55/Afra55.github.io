"use strict";

/**
 * JSON 自管撤销：快照须带 caret；撤回不得默认落到全文末尾。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("历史项为 { text, caret }", () => {
  assert.ok(app.includes("function jsonHistEntry(text, caret)"));
  assert.ok(app.includes("jsonHistEntry(seed, seed.length)"));
  assert.ok(app.includes("hist.stack[hist.idx]?.text === t"));
});

t("applyHistAt 用快照 caret，不再写死 t.length", () => {
  const fn = app.slice(app.indexOf("function applyHistAt"), app.indexOf("function undoJson"));
  assert.ok(fn.includes("entry.caret"));
  assert.ok(fn.includes("setJsonCaret"));
  assert.ok(!/setJsonCaret\(\s*el,\s*t\.length\s*\)/.test(fn));
});

t("beforeinput / idle commit 带上当前光标", () => {
  assert.ok(app.includes("commitHist(hist.before, getJsonCaret(el))"));
  assert.ok(app.includes("commitHist(getJsonText(el), getJsonCaret(el))"));
});

t("无 caret 时用首差异回退", () => {
  assert.ok(app.includes("function caretFromDiff"));
  assert.ok(app.includes("caretFromDiff(prevText, t)"));
});

console.log(`json-undo-caret.test.js: ${n} passed`);
