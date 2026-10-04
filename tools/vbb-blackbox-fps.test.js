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
  blackboxKeepQualityUntilFloor,
  blackboxShouldSkipFineQi,
  blackboxShouldSkipNarrowerWidth,
  blackboxShouldSkipHighFpsByDuration,
  blackboxShouldSkipFpsByCal,
  KEEP_Q_MAX_SPAN_SEC,
} = require("./lib/vbb-blackbox-fps.js");

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}

assert(JSON.stringify(blackboxFpsCandidates(24)) === JSON.stringify([24, 15, 12]), "24 电影 → 24/15/12");
assert(JSON.stringify(blackboxFpsCandidates(23.976)) === JSON.stringify([24, 15, 12]), "23.976 → 24/15/12");
assert(JSON.stringify(blackboxFpsCandidates(25)) === JSON.stringify([25, 15, 12.5]), "25 屏录 → 25/15/12.5");
assert(JSON.stringify(blackboxFpsCandidates(30)) === JSON.stringify([30, 15, 12]), "30 → 30/15/12");
assert(JSON.stringify(blackboxFpsCandidates(0)) === JSON.stringify([20, 15, 12]), "未知默认");
assert(blackboxFpsCandidates(24).includes(15), "24 源必须含 15");
assert(blackboxFpsCandidates(25).includes(15), "25 源必须含 15");
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
assert(JSON.stringify(resolveBlackboxFpsList(10, 24)) === JSON.stringify([24, 15, 12]), "电影短片列表含 15");
assertGifFpsAllowed(24, 15, "电影 15");
assertGifFpsAllowed(25, 15, "屏录 15");
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
assert(KEEP_Q_MAX_SPAN_SEC === 10, "守80仅≤10s");
assert(blackboxKeepQualityUntilFloor(6.5) === true, "0087 短片守80");
assert(blackboxKeepQualityUntilFloor(15.8) === false, "601 长片不守80掉帧");
assert(blackboxKeepQualityUntilFloor(15.8, false) === false, "默认关：长片不守80");
assert(blackboxKeepQualityUntilFloor(15.8, true) === true, "画质优先：长片也守80");
assert(blackboxKeepQualityUntilFloor(28.3, true) === true, "画质优先：任意时长守80");
assert(blackboxShouldSkipFineQi(1, 1.4) === true, "远超预算跳 q4");
assert(blackboxShouldSkipFineQi(1, 1.1) === false, "贴预算打细档");
assert(blackboxShouldSkipFineQi(3, 2) === false, "q8 不跳");
assert(blackboxShouldSkipNarrowerWidth(13.25e6, 420, 400, 10e6) === true, "面积外推跳 400");
assert(blackboxShouldSkipNarrowerWidth(12.86e6, 420, 380, 10e6) === false, "贴线不跳 380");
assert(blackboxShouldSkipHighFpsByDuration(25, 28.3) === true, "28s@25 跳过高档穷举");
assert(blackboxShouldSkipHighFpsByDuration(15, 28.3) === false, "15 必试");
assert(blackboxShouldSkipHighFpsByDuration(20, 15.8) === false, "16s@20 仍试");
assert(blackboxShouldSkipFpsByCal(20, 25, 27e6, 10e6) === true, "25@27MB 外推 20 仍超");
assert(blackboxShouldSkipFpsByCal(15, 25, 27e6, 10e6) === false, "标定后 15 仍试");

{
  const encPath = path.join(__dirname, "extra-panels/v2g-suite-src/10-shared-encode.js");
  const src = fs.readFileSync(encPath, "utf8");
  assert(
    /src\s*>=\s*23\.5\s*&&\s*src\s*<\s*24\.5\s*\)\s*return\s*\[\s*24\s*,\s*15\s*,\s*12\s*\]/.test(src),
    "源码须含 24→[24,15,12]"
  );
  assert(
    /src\s*>=\s*24\.5\s*&&\s*src\s*<=\s*25\.8\s*\)\s*return\s*\[\s*25\s*,\s*15\s*,\s*12\.5\s*\]/.test(src),
    "源码须含 25→[25,15,12.5]"
  );
  assert(/blackboxIsMovieLike/.test(src), "须有电影向判定");
  assert(/bisectWidthAtQuality|trialCache/.test(src), "须有宽度二分/试档缓存");
  assert(/V2G_BLACKBOX_LETGO_WIDTHS\s*=\s*\[\s*420\s*,\s*400\s*,\s*380\s*\]/.test(src), "须有 420→400→380");
  assert(/V2G_BLACKBOX_QUALITY_KEEP_MIN_GQ\s*=\s*80/.test(src), "短片降帧前画质底须 ≥80");
  assert(/V2G_BLACKBOX_KEEP_Q_MAX_SPAN_SEC\s*=\s*10/.test(src), "守80仅≤10s");
  assert(/blackboxKeepQualityUntilFloor\(span,\s*qualityFirst\)/.test(src), "守80须接受画质优先开关");
  assert(/clipOpts\.qualityFirst/.test(src), "画质优先须由调用方显式传入");
  const vbbUi = fs.readFileSync(path.join(__dirname, "extra-panels/v2g-suite-src/40-vbb.js"), "utf8");
  assert(/devtools-vbb-quality-first/.test(vbbUi), "黑盒面板须记住画质优先");
  assert(/qualityFirst:\s*vbbQualityFirstOn\(\)/.test(vbbUi), "黑盒编码须传入画质优先");
  const vtrimEd = fs.readFileSync(path.join(__dirname, "lib/vtrim-editor.js"), "utf8");
  assert(/END_KEEP_SEC\s*=\s*1\s*\/\s*25/.test(vtrimEd), "编辑预览片尾半开 1/25s");
  assert(/last\.end\s*=\s*Math\.max\([\s\S]{0,80}END_KEEP_SEC/.test(vtrimEd), "keepRanges 成片须收掉预览半开片尾");
  assert(/from currentTime|a = t|当前进度/.test(vtrimEd) && /addCutoutAtPlayhead/.test(vtrimEd), "删中间从播放头起");
  const gifskiCore = fs.readFileSync(path.join(__dirname, "ffmpeg-bridge/gifski-core.js"), "utf8");
  assert(!/srcSpan\s*\+\s*0\.05/.test(gifskiCore), "原生 gifski 不得再给片尾 +50ms");
  assert(/-ss"[\s\S]{0,80}opts\.startSec/.test(gifskiCore), "原生裁剪须有 -ss");
  assert(/setpts=PTS-STARTPTS/.test(gifskiCore), "原生须复位 PTS，避免片头 delay 被 start_time 拉长");
  assert(/"-r"[\s\S]{0,40}opts\.fps/.test(gifskiCore), "原生 gifski 须显式 -r fps");
  assert(!/gsArgs[\s\S]{0,220}--threads/.test(gifskiCore), "gifski 1.34 不得传 --threads");
  assert(/durationsForGifskiWasmPts/.test(src), "wasm 须修正末帧 delay 当片头 PTS");
  assert(/canPassFps \? fpsInt : undefined/.test(src), "均匀 delay 须走 fps 参数而非 durations");
  {
    const m = src.match(/function durationsForGifskiWasmPts\([\s\S]*?return out;\s*\}/);
    assert(m, "须能抽出 durationsForGifskiWasmPts");
    const fn = new Function(`${m[0]}; return durationsForGifskiWasmPts;`)();
    const got = fn([50, 50, 2900]);
    assert(got[0] === 50 && got[1] === 2900 && got[2] === 50, "末帧 2.9s 须挪到倒数第二帧");
    assert(got[got.length - 1] === 50, "wasm 第 0 帧 PTS 须为一拍");
  }
  assert(/blackboxShouldSkipNarrowerWidth/.test(src), "须有面积外推跳宽");
  assert(/blackboxShouldSkipHighFpsByDuration/.test(src), "须有长片跳过高档穷举");
  assert(/V2G_GIFSKI_WASM_MAX_FRAMES/.test(src), "须有 wasm 分块安全帧上限");
  assert(/V2G_BLACKBOX_QUALITY_LADDER\s*=\s*\[\s*1\s*,\s*4\s*,\s*6\s*,\s*8\s*,/.test(src), "92–83 须有细档 q4/q6");
  const v2gUi = fs.readFileSync(path.join(__dirname, "extra-panels/v2g-suite-src/20-v2g-ui.js"), "utf8");
  assert(!/manualFpsCap/.test(v2gUi), "非黑盒视频转 GIF 不得套性能档帧率帽");
  assert(/gifskiQuality:\s*manualGifskiQuality/.test(v2gUi), "非黑盒须走 gifski 100 满档");
  const v2gHtml = fs.readFileSync(path.join(__dirname, "panels/v2g.html"), "utf8");
  assert(/value="60" selected/.test(v2gHtml), "非黑盒默认 60fps");
  assert(/value="1280" selected/.test(v2gHtml), "非黑盒默认宽 1280");
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
