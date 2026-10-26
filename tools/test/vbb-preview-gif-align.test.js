"use strict";

/**
 * 裁剪预览 ↔ 最终 GIF 对齐加固：
 * 抬手落到成片 keep、边界垫 3/30、编辑强制精确切、切片尾再收半帧。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const vtrim = fs.readFileSync(path.join(__dirname, "..", "lib", "vtrim-editor.js"), "utf8");
const shared = fs.readFileSync(
  path.join(__dirname, "..", "extra-panels", "v2g-suite-src", "10-shared-encode.js"),
  "utf8"
);
const vbb = fs.readFileSync(
  path.join(__dirname, "..", "extra-panels", "v2g-suite-src", "40-vbb.js"),
  "utf8"
);

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("成片边界垫约 3 帧@30fps", () => {
  assert.ok(/ENCODE_BOUND_PAD_SEC\s*=\s*3\s*\/\s*30/.test(vtrim));
});

t("黄柄/红柄抬手后 seekPlayheadExact（成片 keep，非裸 trimStart）", () => {
  const fin = vtrim.slice(vtrim.indexOf("async function finishTrimDrag"), vtrim.indexOf("function ratioFromClientX"));
  assert.ok(fin.includes("await seekPlayheadExact(startSec)"));
  assert.ok(fin.includes("await seekPlayheadExact(endKeepSec())") || fin.includes("seekPlayheadExact(endKeepSec"));
  assert.ok(fin.includes("红柄抬手") || fin.includes("接点保留侧"));
});

t("打开编辑首帧落到成片 keep", () => {
  assert.ok(vtrim.includes("seekPlayheadExact(startSec)"));
  assert.ok(vtrim.includes("与 GIF 对齐") || vtrim.includes("成片 keep 起点"));
});

t("时长标签标明成片（与 GIF 同源 keep）", () => {
  assert.ok(vtrim.includes("成片 ${formatClock(keepSpan)}") || /成片 \$\{formatClock\(keepSpan\)\}/.test(vtrim));
});

t("exportKeepVideo 切片尾再收 1/60", () => {
  const exp = vtrim.slice(
    vtrim.indexOf("async function exportKeepVideo"),
    vtrim.indexOf("window.DevToolsVtrimEditor =")
  );
  assert.ok(/endBias\s*=\s*1\s*\/\s*60/.test(exp));
});

t("黑盒编辑后 forceAccurateCut（禁 copy 关键帧）", () => {
  assert.ok(shared.includes("forceAccurateCut"));
  assert.ok(/accurate:\s*speed\s*>\s*1\.01\s*\|\|\s*Boolean\(opts\.forceAccurateCut\)/.test(shared));
  assert.ok(vbb.includes("forceAccurateCut: Boolean(prepared.cutNote)"));
});

console.log(`vbb-preview-gif-align.test.js: ${n} passed`);
