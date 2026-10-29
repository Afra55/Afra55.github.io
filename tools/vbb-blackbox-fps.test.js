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
  blackboxFpsFloor,
  blackboxIsFloorFps,
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
assert(blackboxShouldSkipHighFpsByDuration(12.5, 38.1, 25) === false, "底档 12.5 不得因时长跳过");
assert(blackboxShouldSkipFpsByCal(20, 25, 27e6, 10e6) === true, "25@27MB 外推 20 仍超");
assert(blackboxShouldSkipFpsByCal(15, 25, 27e6, 10e6) === false, "标定后 15 仍试");
assert(blackboxFpsFloor(16, 30) === 12, "30 源底档 12");
assert(blackboxFpsFloor(19, 25) === 12.5, "25 源底档 12.5");
assert(blackboxIsFloorFps(15, 24, 16) === false, "画质优先/长片：15 不是 floor");
assert(blackboxIsFloorFps(15, 25, 19) === false, "屏录长片：15 不是 floor");
assert(blackboxIsFloorFps(15, 28.4, 16) === false, "910 类源：15 不是 floor");
assert(blackboxIsFloorFps(12, 24, 16) === true, "24 源底档 12");
assert(blackboxIsFloorFps(12.5, 25, 19) === true, "25 源底档 12.5");
assert(blackboxIsFloorFps(12, 28.4, 16) === true, "默认档底档 12");
assert(
  blackboxShouldSkipFpsByCal(12, 15, 16e6, 10e6, 30) === false,
  "15@380 仍超不得外推跳过 12"
);
assert(
  blackboxShouldSkipFpsByCal(12.5, 15, 18e6, 10e6, 25) === false,
  "15 超限不得外推跳过 12.5"
);

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
  assert(/END_KEEP_SEC\s*=\s*1\s*\/\s*25/.test(vtrimEd), "编辑预览片尾半开兜底 1/25s");
  assert(/last\.end\s*=\s*Math\.max\(\s*last\.start\s*\+\s*0\.05\s*,\s*last\.end\s*-\s*endKeep\s*\)/.test(vtrimEd), "keepRanges 成片须收掉预览半开片尾");
  assert(/from currentTime|a = t|当前进度/.test(vtrimEd) && /addCutoutAtPlayhead/.test(vtrimEd), "删中间从播放头起");
  assert(/cutStart\s*-\s*endKeep/.test(vtrimEd) && /endKeep\s*\+\s*startKeep/.test(vtrimEd), "删中间须用 end/startKeep 对齐红柄");
  assert(/Math\.min\(\s*want\s*,\s*Math\.max\(\s*fromShown/.test(vtrimEd), "片尾抬手禁止推过拖点");
  assert(/trimStart:\s*quantizeTrimSec\(startSec\)/.test(vtrimEd), "完成编辑须提交黄柄所见 trimStart，勿预加 START_KEEP");
  assert(/function keepRangesForEncode/.test(vtrimEd), "成片须有 keepRangesForEncode（≡预览所见）");
  assert(/下载编辑后的视频/.test(vtrimEd) && /function exportKeepVideo/.test(vtrimEd), "编辑层须能下载编辑后 mp4");
  assert(/正在导出/.test(vtrimEd) && /export-progress/.test(vtrimEd), "下载编辑后视频须有进度反馈");
  assert(/keepRangesForEncode\(edit, duration\)/.test(vtrimEd), "exportKeepVideo 须按成片 keep 切片");
  {
    const n = vtrimEd.match(/function normalizeCutouts\([\s\S]*?return merged;\s*\}/);
    const k = vtrimEd.match(/function keepRangesFromEdit\(edit, duration\) \{[\s\S]*?return keeps;\s*\}/);
    const ke = vtrimEd.match(
      /function keepRangesForEncode\(edit, duration\) \{[\s\S]*?return keepRangesFromEdit\(edit, duration\);\s*\}/
    );
    assert(n && k && ke, "须能抽出 keepRangesFromEdit / keepRangesForEncode");
    const fns = new Function(`
      const MIN_SPAN = 0.5, MIN_CUTOUT = 0.2, END_KEEP_SEC = 1 / 25, START_KEEP_SEC = 1 / 50, ENCODE_BOUND_PAD_SEC = 0;
      ${n[0]}
      ${k[0]}
      ${ke[0]}
      return { keepRangesFromEdit, keepRangesForEncode };
    `)();
    const ks = fns.keepRangesFromEdit({ trimStart: 0, trimEnd: 10, cutouts: [{ start: 2, end: 4 }] }, 10);
    assert(ks.length === 2, "中间删除应得两段 keep");
    assert(Math.abs(ks[0].start - 0) < 1e-6, "预览 keep 片头须对齐黄柄（0）");
    assert(Math.abs(ks[0].end - (2 - 1 / 25)) < 1e-6, "上一段须在红柄起点前半开收掉（对齐片尾）");
    assert(ks[1].start >= 4 + 1 / 25 + 1 / 50 - 1e-6, "下一段须越过终点帧并加片头半开");
    assert(ks[1].end <= 10 - 1 / 25 + 1e-6, "末段仍半开片尾");
    const enc = fns.keepRangesForEncode({ trimStart: 0, trimEnd: 10, cutouts: [{ start: 2, end: 4 }] }, 10);
    assert(enc.length === 2, "成片 keep 仍两段");
    assert(Math.abs(enc[0].start - ks[0].start) < 1e-9, "成片片头 ≡ 预览（所见即所得）");
    assert(Math.abs(enc[0].end - ks[0].end) < 1e-9, "成片上一段终点 ≡ 预览");
    assert(Math.abs(enc[1].start - ks[1].start) < 1e-9, "成片下一段起点 ≡ 预览");
    assert(Math.abs(enc[0].start - 0) < 1e-9, "片头对齐黄柄 0");

    const p = vtrimEd.match(/function previewSeekForKeepRanges\(keeps, t, opts\) \{[\s\S]*?return first\.start;\s*\}/);
    assert(p, "须能抽出 previewSeekForKeepRanges");
    const seekFn = new Function(`
      const END_KEEP_SEC = 1 / 25;
      ${p[0]}
      return previewSeekForKeepRanges;
    `)();
    assert(seekFn(ks, 1, { paused: false }) == null, "keep 内不应跳");
    const skipTo = seekFn(ks, 3, { paused: false });
    assert(Math.abs(skipTo - ks[1].start) < 1e-6, "cutout 内须跳到下一段 keep");
    assert(Math.abs(seekFn(ks, ks[0].end, { paused: false }) - ks[1].start) < 1e-6, "keep 终点须跳下一段");
    assert(seekFn(ks, 2, { paused: false }) === ks[1].start, "红柄起点须已在删段内并跳下一段");
    const early = ks[1].start - 0.015;
    assert(Math.abs(seekFn(ks, early, { paused: false }) - ks[1].start) < 1e-6, "下一段前 15ms 仍须跳，勿少删");
    assert(Math.abs(seekFn(ks, ks[1].end, { paused: false }) - ks[0].start) < 1e-6, "末段后播放须循环到首段");
    const pausedAtEnd = seekFn(ks, ks[1].end, { paused: true });
    assert(
      pausedAtEnd != null && pausedAtEnd >= ks[1].end - 0.002 - 1e-6,
      "暂停在 keep 尾勿再减 END_KEEP（keep 已半开）"
    );
  }
  assert(/previewSeekForKeepRanges/.test(vbbUi) && /is-edit-crop/.test(vbbUi), "外预览须跳 cutouts 并套 crop");
  assert(/formatVbbQualityBit|gifskiQuality/.test(vbbUi), "结果卡须用字段展示 gifski 画质");
  assert(/snapNudgeToShown/.test(vtrimEd), "片头片尾微调松手须对齐解码画面");
  assert(/object-fit:\s*fill/.test(fs.readFileSync(path.join(__dirname, "styles/panels/vbb.css"), "utf8")), "裁切外预览须 fill 对齐绿框");
  assert(/vbb-file-edit-actions/.test(fs.readFileSync(path.join(__dirname, "panels/vbb.html"), "utf8")), "编辑按钮须独立 actions 行");
  assert(/vbbKeepRangesForEncode/.test(vbbUi), "黑盒编码须用成片 keep");
  assert(/devtools:pending-files/.test(vbbUi), "须接住 early capture 选文件");
  assert(/translate\(|clipPath/.test(vbbUi), "外预览裁切须 clip + 放大绿框");
  assert(/exportKeepVideo/.test(vbbUi), "黑盒删中间拼接须走同一套导出");
  assert(/force serial: cutouts|needsMaterialize/.test(vbbUi), "有删中间时批量须串行防第二路僵死");
  assert(!/编码无进度超时，已跳过该条|单条转换超时，已跳过|VBB_ITEM_STALL_MS|VBB_ITEM_HARD_MS/.test(vbbUi), "批量不得因进度/硬超时跳过");
  assert(/VBB_STALL_HINT_MS|still waiting \(no skip\)/.test(vbbUi), "无进度时只提示续等，不 skip");
  // 已用时改由进度条两行展示；stall 只刷新阶段，避免长串挤掉阶段信息
  assert(
    /已用时由进度条两行展示|formatMobileTwoLineProgress/.test(vbbUi + src),
    "stall 不写「本条已」长串；已用时由手机两行进度展示"
  );
  assert(!/本条已\$\{wall\}s（正常试档中，可取消）/.test(vbbUi), "stall 不得再塞本条已长串");
  assert(/导出 RGBA · 已 \$\{sec\}s（解码中）|解码中/.test(src), "分块导出须有心跳，避免手机批量假死提示");
  assert(/清理内存后继续/.test(vbbUi), "手机批量条间须清理内存再续");
  assert(/沿用帧率/.test(src), "seed 须只沿用帧率");
  assert(/忽略缓存宽/.test(src), "seed 不得直接从上次加宽后的宽度起编");
  assert(/VBB_SPAN_SCHEME_VER\s*=\s*8/.test(src), "改 seed 相似度策略须 bump 缓存版本");
  assert(/vbbSeedFitsMeta|vbbSchemeSizeBucket/.test(src), "沿用须校验源宽高/帧率");
  assert(/只按时长/.test(src), "须显式禁止只按时长沿用");
  assert(
    /firstSeed &&\s*meta &&\s*shouldReuseVbbFirstPlan/.test(src.replace(/\s+/g, " ")),
    "firstSeed 沿用也必须带 meta，禁止缺省退回时长"
  );
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
  assert(/function blackboxIsFloorFps/.test(src), "须有 15 非底档判定");
  assert(/Math\.abs\(\s*f\s*-\s*15\s*\)\s*<\s*0\.2\)\s*return false/.test(src), "isFloorFps 须排除 15");
  assert(
    /allowBelowKeepQ && !shortKeepQ && !isFloorFps && wi === 0/.test(src),
    "底档不得在 420 先降到 q<80"
  );
  assert(
    /!\(isFloorFps && lastStep && !belowKeepOnly\)/.test(src),
    "底档须实试 380@≥80，不得面积外推跳过"
  );
  assert(/底档≥80仍超/.test(src), "画质优先须先试完底档≥80 再允许<80");
  assert(/allowBelowKeepQ:\s*!shortKeepQPick/.test(src), "守80阶段不得选 q<80");
  assert(/keepQuality:\s*true/.test(src), "守80时 compressAt 不得锁 q70");
  assert(/vbbPickNote/.test(src), "≥80 塞不进须在结果说明");
  assert(
    /blackboxShouldSkipFpsByCal\(fps, cal\.fps, cal\.blob\.size, V2G_BLACKBOX_MAX_BYTES,\s*srcFps\)/.test(
      src
    ),
    "外推跳帧须传入 srcFps 以保住底档"
  );
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
