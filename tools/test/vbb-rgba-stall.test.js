"use strict";

/**
 * 手机长片：出帧进度顶满后须有收尾心跳 + 超时掐断；长片强压分块。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const enc = fs.readFileSync(
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

t("RGBA 顶满后心跳带「收尾」并超时终止", () => {
  assert.ok(enc.includes("RGBA_TAIL_STALL_MS"));
  assert.ok(enc.includes("导出 RGBA · 100% · 收尾"));
  assert.ok(enc.includes("出帧收尾超时") || enc.includes("进度已满仍未返回"));
  assert.ok(enc.includes("terminateFfmpegInstance"));
});

t("手机长片≥18s 强压分块≤72 帧", () => {
  assert.ok(enc.includes("手机长片≥18s 强压分块"));
  assert.ok(/chunkMax = 72/.test(enc));
});

t("读帧阶段有进度心跳", () => {
  assert.ok(enc.includes("读取帧数据 · 已"));
});

t("阶段文案映射出帧收尾/读帧", () => {
  assert.ok(vbb.includes("③出帧收尾"));
  assert.ok(vbb.includes("③读帧"));
});

t("批量完成后清 RGBA 试档缓存", () => {
  assert.ok(vbb.includes("clearVbbRgbaTrialCache"));
});

console.log(`vbb-rgba-stall.test.js: ${n} passed`);
