"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "..", "extra-panels", "v2g-suite-src", "40-vbb.js"),
  "utf8"
);

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("含 materializeVbbTrimClip 预裁切", () => {
  assert.ok(src.includes("async function materializeVbbTrimClip"));
  assert.ok(src.includes("后续阶梯不再啃整段原片"));
});

t("prepareVbbEncodeSource 对单段 trim / 打点会预裁", () => {
  assert.ok(src.includes("单段 trim / 打点：只要不是整段，就预裁一次"));
  assert.ok(/const trimmed =[\s\S]*startSec > 0\.05/.test(src));
  assert.ok(src.includes("await materializeVbbTrimClip("));
});

t("预裁切不做 pad（避免假黑边）", () => {
  const fn = src.slice(src.indexOf("async function materializeVbbTrimClip"), src.indexOf("async function prepareVbbEncodeSource"));
  assert.ok(fn.includes("不要 pad"));
  assert.ok(!/pad=\$\{W\}:\$\{H\}/.test(fn), "trim 预裁不应 pad 到画布");
});

t("整段/批量/手动/切分 编码前走 prepare", () => {
  const prepareCalls = src.split("await prepareVbbEncodeSource(").length - 1;
  assert.ok(prepareCalls >= 4, `prepare 调用过少: ${prepareCalls}`);
});

t("去色边在预裁短片上取样", () => {
  assert.ok(src.includes("去色边在预裁后的短片上取样") || /resolveVbbEncodeCrop\(\s*prepared\.file/.test(src));
});

console.log(`vbb-precut-trim.test.js: ${n} passed`);
