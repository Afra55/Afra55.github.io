"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(
  path.join(__dirname, "..", "extra-panels", "v2g-suite-src", "40-vbb.js"),
  "utf8"
);
const shared = fs.readFileSync(
  path.join(__dirname, "..", "extra-panels", "v2g-suite-src", "10-shared-encode.js"),
  "utf8"
);

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

/** 抽出 shouldPrecutVbbWindow 做门闩单测（不跑整面板） */
function loadShouldPrecut() {
  const m = src.match(/function shouldPrecutVbbWindow\([\s\S]*?\n      \}/);
  assert.ok(m, "missing shouldPrecutVbbWindow");
  const box = {};
  vm.runInNewContext(`const VBB_MIN_SPAN = 0.5;\n${m[0]}\nthis.fn = shouldPrecutVbbWindow;`, box);
  return box.fn;
}

t("含保守门闩 shouldPrecutVbbWindow", () => {
  assert.ok(src.includes("function shouldPrecutVbbWindow"));
  assert.ok(src.includes("明显裁短才启用") || src.includes("明显裁短才预裁"));
});

t("门闩：30s→7s 启用；轻微裁切/整段不启用", () => {
  const should = loadShouldPrecut();
  assert.strictEqual(should(30, 5, 7), true, "30s 裁 7s 应预裁");
  assert.strictEqual(should(30, 0, 7), true, "30s 从头裁 7s 应预裁");
  assert.strictEqual(should(30, 0, 30), false, "整段不预裁");
  assert.strictEqual(should(30, 0, 28), false, "只砍 2s 不预裁");
  assert.strictEqual(should(12, 0, 5), false, "短源不预裁");
  assert.strictEqual(should(20, 0, 12), false, "保留过半不预裁");
});

t("预裁优先 copy，失败才回退", () => {
  const fn = src.slice(
    src.indexOf("async function materializeVbbTrimClip"),
    src.indexOf("async function prepareVbbEncodeSource")
  );
  assert.ok(fn.includes('"copy"') || fn.includes("'copy'"));
  assert.ok(src.includes("预裁切失败，回退整片 seek"));
});

t("手动打点 / 切分方案未强行改接线（仍可直接 encode）", () => {
  // 手动：应有一次整片 vbbResolveCrop，且 encode 用 vbbSourceFile + r.start（旧路径）
  const manual = src.slice(src.indexOf("async function runVbbManualBlackbox"), src.indexOf("function vbbSpeedLimitSec"));
  assert.ok(manual.includes("vbbResolveCrop("));
  assert.ok(/encodeBlackboxClip\(\{\s*file:\s*vbbSourceFile/.test(manual));
  assert.ok(!manual.includes("prepareVbbEncodeSource("), "手动模式勿强行 prepare");
});

t("编码器：非片头窗也允许 wantSeg（失败回退原片）", () => {
  assert.ok(shared.includes("Number(opts.startSec) > 0.05"));
  assert.ok(shared.includes("file.size >= FFMPEG_SEG_FILE_BYTES || Number(opts.startSec) > 0.05"));
});

console.log(`vbb-precut-trim.test.js: ${n} passed`);
