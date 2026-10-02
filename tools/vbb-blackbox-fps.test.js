#!/usr/bin/env node
"use strict";

/**
 * 黑盒帧率硬约束单测 + 与 10-shared-encode.js 源码同步检查。
 * 产品约定：拼接仍为「多段→一条 MP4→一条 GIF」，不分段出多条。
 */
const fs = require("fs");
const path = require("path");
const {
  blackboxFpsCandidates,
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

function almost(a, b, eps = 0.05) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

// ---- 候选阶梯 ----
assert(
  JSON.stringify(blackboxFpsCandidates(25)) === JSON.stringify([25, 12.5]),
  "25fps 源必须 25→12.5"
);
assert(
  JSON.stringify(blackboxFpsCandidates(24.5)) === JSON.stringify([25, 12.5]),
  "≈25 容差"
);
assert(
  JSON.stringify(blackboxFpsCandidates(30)) === JSON.stringify([30, 15, 12]),
  "30fps 源必须 30→15→12"
);
assert(
  JSON.stringify(blackboxFpsCandidates(60)) === JSON.stringify([20, 15, 12]),
  "其它源默认 20→15→12"
);
assert(
  JSON.stringify(blackboxFpsCandidates(0)) === JSON.stringify([20, 15, 12]),
  "未知源默认阶梯"
);

// 禁止 25 源出现 20/15（不规则抽帧）
{
  const c = blackboxFpsCandidates(25);
  assert(!c.includes(20) && !c.includes(15), "25 源不得含 20/15");
}

// ---- 主档按时长 ----
assert(blackboxPrimaryFps(10, 25) === 25, "25 源短片主试 25");
assert(blackboxPrimaryFps(20, 25) === 12.5, "25 源中长主试 12.5");
assert(blackboxPrimaryFps(30, 25) === 12.5, "25 源长片 12.5");
assert(blackboxPrimaryFps(10, 30) === 30, "30 源短片主试 30");
assert(blackboxPrimaryFps(20, 30) === 15, "30 源中长主试 15");
assert(blackboxPrimaryFps(10, 0) === 20, "未知源短片主试 20");
assert(blackboxPrimaryFps(20, 0) === 15, "未知源中长主试 15");
assert(blackboxPrimaryFps(30, 0) === 12, "未知源长片主试 12");

assert(
  JSON.stringify(resolveBlackboxFpsList(10.3, 25)) === JSON.stringify([25, 12.5]),
  "549 类短片列表"
);
assert(
  JSON.stringify(resolveBlackboxFpsList(21.9, 25)) === JSON.stringify([12.5]),
  "548+549 类拼片列表仅 12.5"
);
assert(
  JSON.stringify(resolveBlackboxFpsList(10, 0)) === JSON.stringify([20, 15, 12]),
  "默认短片列表"
);

// ---- GIF 厘秒 / 成片允许集 ----
assert(gifEffectivePlaybackFps(25) === 25, "25 厘秒精确");
assert(gifEffectivePlaybackFps(20) === 20, "20 厘秒精确");
assert(almost(gifEffectivePlaybackFps(15), 14.3), "15 → ≈14.3");
assert(gifEffectivePlaybackFps(12.5) === 12.5, "12.5 厘秒精确");
assert(gifEffectivePlaybackFps(12) === 12.5, "12 → 12.5 显示");

assertGifFpsAllowed(25, 25, "549 成片 25");
assertGifFpsAllowed(25, 12.5, "拼片成片 12.5");
assertGifFpsAllowed(25, 12, "标称 12 经厘秒→12.5，对 25 源仍算同档");
let threw = false;
try {
  assertGifFpsAllowed(25, 20, "应拒绝 20");
} catch (_) {
  threw = true;
}
assert(threw, "25 源成片 20 必须失败");
threw = false;
try {
  assertGifFpsAllowed(25, 15, "应拒绝 15");
} catch (_) {
  threw = true;
}
assert(threw, "25 源成片 15 必须失败");

assert(isFluentTierFps(10, 25, 25), "短片 25 是流畅档");
assert(isFluentTierFps(22, 25, 12.5), "中长 12.5 是流畅档（不可再降）");
assert(!isFluentTierFps(30, 25, 12.5), ">24s 不按中长保档语义");
assert(HIGH_PRIMARY_SPAN_SEC === 16 && MID_SPAN_SEC === 24, "时长分档常量");

// ---- 与套件源码同步（防只改一处）----
{
  const encPath = path.join(__dirname, "extra-panels/v2g-suite-src/10-shared-encode.js");
  const src = fs.readFileSync(encPath, "utf8");
  assert(
    /if\s*\(\s*src\s*>=\s*24\.2\s*&&\s*src\s*<=\s*25\.8\s*\)\s*return\s*\[\s*25\s*,\s*12\.5\s*\]/.test(
      src
    ),
    "10-shared-encode.js 缺少 25→[25,12.5]"
  );
  assert(
    /if\s*\(\s*src\s*>=\s*29\.2\s*&&\s*src\s*<=\s*30\.8\s*\)\s*return\s*\[\s*30\s*,\s*15\s*,\s*12\s*\]/.test(
      src
    ),
    "10-shared-encode.js 缺少 30→[30,15,12]"
  );
  assert(/midKeepFluent/.test(src), "须保留 midKeepFluent（禁换宽降流畅档）");
  assert(
    /产品硬约定：始终|一条中间 MP4|不分段各出一条 GIF/.test(
      fs.readFileSync(path.join(__dirname, "extra-panels/v2g-suite-src/40-vbb.js"), "utf8")
    ),
    "拼接须保持「一条中间片→一条黑盒」，不分段"
  );
}

console.log("vbb-blackbox-fps.test.js: all passed");
