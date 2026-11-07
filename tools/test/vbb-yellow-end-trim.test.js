"use strict";

/**
 * 黄柄预览对、GIF 尾多帧：
 * 源 trim + 成片 trim（再收 2 输出帧）+ select 限帧。
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

t("存在 vbbEncodeHardTrimFilters：setpts → trim → (PTS-STARTPTS)/speed", () => {
  assert.ok(shared.includes("function vbbEncodeHardTrimFilters"));
  const m = shared.match(/function vbbEncodeHardTrimFilters\([\s\S]*?\n      \}/);
  assert.ok(m);
  const box = {};
  vm.runInNewContext(`${m[0]}; this.fn = vbbEncodeHardTrimFilters;`, box);
  const s1 = box.fn(1, 10);
  assert.ok(s1.includes("trim=duration=9.999"));
  assert.ok(s1.includes("setpts=PTS-STARTPTS"));
  assert.ok(!s1.includes("(PTS-STARTPTS)/1"));
  const s2 = box.fn(2, 8.5);
  assert.ok(s2.includes("trim=duration=8.499"));
  assert.ok(s2.includes("(PTS-STARTPTS)/2"), `须带括号：${s2}`);
});

t("vbbEncodeOutTrimFilters：导出编辑片不砍 2 帧；旧路径仍可收", () => {
  assert.ok(shared.includes("function vbbEncodeOutTrimFilters"));
  const m = shared.match(/function vbbEncodeOutTrimFilters\([\s\S]*?\n      \}/);
  assert.ok(m);
  const box = {};
  vm.runInNewContext(`${m[0]}; this.fn = vbbEncodeOutTrimFilters;`, box);
  const exported = box.fn(2, 15, { exportedEdit: true });
  assert.ok(exported.includes("trim=duration=2"), exported);
  const legacy = box.fn(2, 15, {});
  assert.ok(legacy.includes("trim=duration=1.866"));
});

t("palette / gifski 链：源 trim → fps → outTrim → select", () => {
  assert.ok(shared.includes("fps=${fps}:round=up") || /fps=\$\{fps\}:round=up/.test(shared));
  assert.ok(shared.includes("${outTrim}") || shared.includes("outTrim"));
  assert.ok(shared.includes("select='lt(n"));
  assert.ok(shared.includes("buildRawArgs(useDenoise, dur, chunkFrames, ptsStart)"));
});

t("注释说明根因：凑帧读窗外 + fps EOF flush", () => {
  assert.ok(shared.includes("为凑帧") || shared.includes("凑帧"));
  assert.ok(shared.includes("黄柄"));
  assert.ok(shared.includes("EOF flush") || shared.includes("flush"));
});

console.log(`vbb-yellow-end-trim.test.js: ${n} passed`);
