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

t("粗指针 gifski 前清 RGBA，成功后再 put 预合并帧", () => {
  const start = enc.indexOf("const encodeChunk = async");
  const end = enc.indexOf("let blob;", start);
  assert.ok(start > 0 && end > start);
  const chunk = enc.slice(start, end);
  const lockAt = chunk.indexOf("withGifskiEncodeLock(");
  const clearAt = chunk.indexOf("clearVbbRgbaTrialCache(");
  const putAt = chunk.indexOf("putVbbRgbaTrialCache(");
  const mergeAt = chunk.indexOf("mergeStaticFramesInPlace(");
  assert.ok(lockAt > 0 && clearAt > 0 && putAt > 0 && mergeAt > 0);
  assert.ok(clearAt < lockAt, "clear before encode");
  assert.ok(putAt > lockAt, "put after encode");
  assert.ok(/if \(isCoarsePointer\(\)\) clearVbbRgbaTrialCache\(\)/.test(chunk));
  assert.ok(chunk.indexOf("rgbaPreMerge = store") < mergeAt, "store pre-merge copy before merge");
  assert.ok(chunk.includes("view = store"), "coarse encodes from the store buffer");
  assert.ok(chunk.includes("performance.now() - tPerf"));
  assert.ok(chunk.includes("document.visibilityState"));
  assert.ok(chunk.includes("gifski wasm"));
});

t("抬质轻压前清缓存并打开始/心跳日志", () => {
  const start = enc.indexOf("async function blackboxAcceptBoostIfFits");
  const end = enc.indexOf("function isCoarsePointer()", start);
  assert.ok(start > 0 && end > start);
  const fn = enc.slice(start, end);
  const compressAt = fn.indexOf("compressGifBlob(");
  assert.ok(compressAt > 0);
  assert.ok(fn.indexOf("clearVbbRgbaTrialCache(") > 0);
  assert.ok(fn.indexOf("clearVbbRgbaTrialCache(") < compressAt);
  assert.ok(fn.indexOf("抬质轻压开始") < compressAt);
  assert.ok(/isCoarsePointer\(\)/.test(fn));
  assert.ok(fn.includes("15000"));
  assert.ok(fn.includes("抬质轻压心跳"));
  assert.ok(fn.includes("Date.now() - boostWall0"));
  assert.ok(fn.includes("performance.now() - tPerfBoost"));
  assert.ok(fn.includes("抬质轻压进预算"));
  assert.ok(fn.includes("抬质未进预算"));
});

console.log(`vbb-rgba-stall.test.js: ${n} passed`);
