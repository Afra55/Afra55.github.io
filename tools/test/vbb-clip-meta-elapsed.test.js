"use strict";

/**
 * 结果卡描述末尾须带编码耗时（encodeMs → 耗时 Xs）。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const vbb = fs.readFileSync(
  path.join(__dirname, "..", "extra-panels", "v2g-suite-src", "40-vbb.js"),
  "utf8"
);

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("源码：formatVbbClipMeta 在画质后挂耗时", () => {
  assert.ok(vbb.includes("function formatVbbEncodeElapsed"));
  const meta = vbb.slice(
    vbb.indexOf("function formatVbbClipMeta"),
    vbb.indexOf("function applyVbbClipEncoded")
  );
  assert.ok(meta.includes("formatVbbEncodeElapsed(c.encodeMs)"));
  assert.ok(meta.includes("画质 · 耗时") || meta.includes("耗时"));
});

t("formatVbbEncodeElapsed：短<10s 一位小数，长整秒", () => {
  const fn = vbb.match(/function formatVbbEncodeElapsed\(ms\) \{[\s\S]*?\n      \}/);
  assert.ok(fn);
  const box = {};
  vm.runInNewContext(`${fn[0]}; this.formatVbbEncodeElapsed = formatVbbEncodeElapsed;`, box);
  assert.strictEqual(box.formatVbbEncodeElapsed(0), "");
  assert.strictEqual(box.formatVbbEncodeElapsed(40), "");
  assert.strictEqual(box.formatVbbEncodeElapsed(8300), "耗时 8.3秒");
  assert.strictEqual(box.formatVbbEncodeElapsed(45300), "耗时 45秒");
});

console.log(`vbb-clip-meta-elapsed.test.js: ${n} passed`);
