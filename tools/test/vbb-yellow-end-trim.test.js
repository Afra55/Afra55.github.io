"use strict";

/**
 * 黄柄预览对、GIF 尾多帧：fps= 前须 trim 硬切，禁止 -frames:v 为凑帧读窗外。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const shared = fs.readFileSync(
  path.join(__dirname, "..", "extra-panels", "v2g-suite-src", "10-shared-encode.js"),
  "utf8"
);

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("存在 vbbEncodeHardTrimFilters：setpts → trim=duration → setpts(/speed)", () => {
  assert.ok(shared.includes("function vbbEncodeHardTrimFilters"));
  const m = shared.match(/function vbbEncodeHardTrimFilters\([\s\S]*?\n      \}/);
  assert.ok(m);
  const box = {};
  vm.runInNewContext(`${m[0]}; this.fn = vbbEncodeHardTrimFilters;`, box);
  const s1 = box.fn(1, 10);
  assert.ok(s1.includes("trim=duration=10"));
  assert.ok(s1.includes("setpts=PTS-STARTPTS"));
  assert.ok(!s1.includes("/1,") && !s1.includes("/1."));
  const s2 = box.fn(2, 8.5);
  assert.ok(s2.includes("trim=duration=8.5"));
  assert.ok(s2.includes("/2"));
});

t("palette / gifski 链：crop + timeFilter + fps（硬切在 fps 前）", () => {
  assert.ok(shared.includes("${cropFilter}${timeFilter}fps="));
  assert.ok(shared.includes("buildRawArgs(useDenoise, dur)"));
});

t("注释说明根因：-frames:v 凑帧读过黄柄", () => {
  assert.ok(shared.includes("为凑帧") || shared.includes("凑帧"));
  assert.ok(shared.includes("黄柄"));
});

console.log(`vbb-yellow-end-trim.test.js: ${n} passed`);
