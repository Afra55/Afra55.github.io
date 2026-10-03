#!/usr/bin/env node
"use strict";

/**
 * 黑盒帧率硬约束单测 + 与 10-shared-encode.js 源码同步检查。
 * 产品约定：拼接仍为「多段→一条 MP4→一条 GIF」；电影片段走整除档 + 电影向压缩。
 */
const fs = require("fs");
const path = require("path");
const {
  blackboxFpsCandidates,
  blackboxIsMovieLike,
  blackboxPrimaryFps,
  resolveBlackboxFpsList,
  gifEffectivePlaybackFps,
  assertGifFpsAllowed,
  isFluentTierFps,
  HIGH_PRIMARY_SPAN_SEC,
  MID_SPAN_SEC,
} = require("./lib/vbb-blackbox-fps.js");

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}

assert(JSON.stringify(blackboxFpsCandidates(24)) === JSON.stringify([24, 12]), "24 电影 → 24/12");
assert(JSON.stringify(blackboxFpsCandidates(23.976)) === JSON.stringify([24, 12]), "23.976 → 24/12");
assert(JSON.stringify(blackboxFpsCandidates(25)) === JSON.stringify([25, 12.5]), "25 屏录 → 25/12.5");
assert(JSON.stringify(blackboxFpsCandidates(30)) === JSON.stringify([30, 15, 12]), "30 → 30/15/12");
assert(JSON.stringify(blackboxFpsCandidates(0)) === JSON.stringify([20, 15, 12]), "未知默认");
assert(!blackboxFpsCandidates(25).includes(20), "25 源不得含 20");
assert(!blackboxFpsCandidates(24).includes(20), "24 源不得含 20");

assert(blackboxIsMovieLike(24) === true, "24 是电影");
assert(blackboxIsMovieLike(23.976) === true, "23.976 是电影");
assert(blackboxIsMovieLike(30) === true, "30 是电影向");
assert(blackboxIsMovieLike(25) === false, "25 是屏录向");
assert(blackboxIsMovieLike(0) === true, "未知默认电影向");

assert(blackboxPrimaryFps(10, 24) === 24, "电影短片主试 24");
assert(blackboxPrimaryFps(20, 24) === 24, "电影长片仍先试最高整除档 24");
assert(blackboxPrimaryFps(30, 30) === 30, "30fps 源一律先 30");
assert(blackboxPrimaryFps(10, 25) === 25, "屏录短片主试 25");
assert(JSON.stringify(resolveBlackboxFpsList(10, 24)) === JSON.stringify([24, 12]), "电影短片列表");
assert(JSON.stringify(resolveBlackboxFpsList(30, 30)) === JSON.stringify([30, 15, 12]), "30 源长片仍含高档");

assert(gifEffectivePlaybackFps(24) === 25, "24→厘秒4→25 有效（GIF 限制）");
assertGifFpsAllowed(24, 24, "电影 24");
assertGifFpsAllowed(24, 12, "电影 12");
assertGifFpsAllowed(25, 25, "屏录 25");

let threw = false;
try {
  assertGifFpsAllowed(24, 20, "应拒绝");
} catch (_) {
  threw = true;
}
assert(threw, "24 源不得成片 20");

assert(isFluentTierFps(10, 24, 24), "电影短片 24 流畅");
assert(HIGH_PRIMARY_SPAN_SEC === 16 && MID_SPAN_SEC === 24, "时长分档");

{
  const encPath = path.join(__dirname, "extra-panels/v2g-suite-src/10-shared-encode.js");
  const src = fs.readFileSync(encPath, "utf8");
  assert(
    /src\s*>=\s*23\.5\s*&&\s*src\s*<\s*24\.5\s*\)\s*return\s*\[\s*24\s*,\s*12\s*\]/.test(src),
    "源码须含 24→[24,12]"
  );
  assert(
    /src\s*>=\s*24\.5\s*&&\s*src\s*<=\s*25\.8\s*\)\s*return\s*\[\s*25\s*,\s*12\.5\s*\]/.test(src),
    "源码须含 25→[25,12.5]"
  );
  assert(/blackboxIsMovieLike/.test(src), "须有电影向判定");
  assert(/bisectWidthAtQuality|trialCache/.test(src), "须有宽度二分/试档缓存");
  assert(/V2G_BLACKBOX_LETGO_WIDTHS\s*=\s*\[\s*420\s*,\s*400\s*,\s*380\s*\]/.test(src), "须有 420→400→380");
  assert(/V2G_BLACKBOX_QUALITY_KEEP_MIN_GQ\s*=\s*80/.test(src), "降帧前画质底须 ≥80");
  const v2gUi = fs.readFileSync(path.join(__dirname, "extra-panels/v2g-suite-src/20-v2g-ui.js"), "utf8");
  assert(!/manualFpsCap/.test(v2gUi), "非黑盒视频转 GIF 不得套性能档帧率帽");
  const vsplitUi = fs.readFileSync(path.join(__dirname, "extra-panels/v2g-suite-src/30-vsplit.js"), "utf8");
  assert(!/manualFpsCap/.test(vsplitUi), "非黑盒切片 GIF 不得套性能档帧率帽");
  assert(
    /产品硬约定：始终|一条中间 MP4|不分段各出一条 GIF/.test(
      fs.readFileSync(path.join(__dirname, "extra-panels/v2g-suite-src/40-vbb.js"), "utf8")
    ),
    "拼接须保持一条 GIF"
  );
}

console.log("vbb-blackbox-fps.test.js: all passed");
