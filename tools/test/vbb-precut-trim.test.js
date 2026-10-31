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
const suite = fs.readFileSync(path.join(__dirname, "..", "extra-panels", "v2g-suite.js"), "utf8");

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
  assert.strictEqual(should(16, 0, 8), true, "刚好 16s 砍半应预裁");
  assert.strictEqual(should(15.9, 0, 5), false, "不足 16s 不预裁");
});

t("预裁用精确重编码，禁止 copy 优先（避免关键帧多出片头）", () => {
  const fn = src.slice(
    src.indexOf("async function materializeVbbTrimClip"),
    src.indexOf("async function prepareVbbEncodeSource")
  );
  assert.ok(fn.includes("trim=start="), "须用 trim 滤镜精确裁");
  assert.ok(!/"copy"/.test(fn) && !/'copy'/.test(fn), "预裁勿优先 copy");
  assert.ok(src.includes("预裁切失败，回退整片 seek"));
});

t("预裁会话缓存：命中只复用，算法仍是精确重编码", () => {
  assert.ok(src.includes("vbbPrecutClipCache"));
  assert.ok(src.includes("预裁切缓存命中"));
  assert.ok(src.includes("rememberVbbPrecutClip"));
  assert.ok(src.includes("clearVbbPrecutClipCache"));
  const fn = src.slice(
    src.indexOf("async function materializeVbbTrimClip"),
    src.indexOf("async function prepareVbbEncodeSource")
  );
  assert.ok(fn.includes("trim=start="));
  assert.ok(!/"copy"/.test(fn));
});

t("整段结果卡时间轴保留编辑起点（勿写成 prepared 的 0）", () => {
  assert.ok(src.includes("vbbClips[0].start = win.startSec"));
  assert.ok(src.includes("prepared.startSec 常为 0"));
});

t("手动打点 / 切分方案未强行改接线（仍可直接 encode）", () => {
  const manual = src.slice(src.indexOf("async function runVbbManualBlackbox"), src.indexOf("function vbbSpeedLimitSec"));
  assert.ok(manual.includes("vbbResolveCrop("));
  assert.ok(/encodeBlackboxClip\(\{\s*file:\s*vbbSourceFile/.test(manual));
  assert.ok(!manual.includes("prepareVbbEncodeSource("), "手动模式勿强行 prepare");

  const exec = src.slice(src.indexOf("async function runVbbExecute"), src.indexOf("async function runVbbMerge"));
  assert.ok(exec.includes("vbbResolveCrop("));
  assert.ok(!exec.includes("prepareVbbEncodeSource("), "切分执行勿强行 prepare");
});

t("去色边仍对原片取样（单段/批量）", () => {
  assert.ok(/resolveVbbEncodeCrop\(\s*vbbSourceFile/.test(src) || /resolveVbbEncodeCrop\(\s*item\.file/.test(src));
  // 单段路径须传原片 duration，而非 prepared.span
  const single = src.slice(src.indexOf("async function runVbbSingleBlackbox"), src.indexOf("async function runVbbOneClick"));
  assert.ok(/resolveVbbEncodeCrop\(\s*vbbSourceFile[\s\S]*?\bduration\b/.test(single));
});

t("编码器：非片头窗 / 压缩时长也允许 wantSeg（失败回退原片）", () => {
  assert.ok(shared.includes("Number(opts.startSec) > 0.05"));
  assert.ok(shared.includes("speed > 1.01"));
  assert.ok(
    /file\.size >= FFMPEG_SEG_FILE_BYTES[\s\S]{0,120}speed > 1\.01/.test(shared),
    "wantSeg 须覆盖大文件/非片头/倍速"
  );
});

t("构建产物含门闩与精确预裁标记", () => {
  assert.ok(suite.includes("shouldPrecutVbbWindow"));
  assert.ok(suite.includes("vbbClips[0].start = win.startSec"));
  assert.ok(suite.includes("trim=start="));
});

console.log(`vbb-precut-trim.test.js: ${n} passed`);
