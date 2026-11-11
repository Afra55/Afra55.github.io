"use strict";

/**
 * 编辑预览 ↔ 成片：同一源帧半开窗，禁止叠垫。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const vtrim = fs.readFileSync(path.join(__dirname, "..", "lib", "vtrim-editor.js"), "utf8");
const vbb = fs.readFileSync(
  path.join(__dirname, "..", "extra-panels", "v2g-suite-src", "40-vbb.js"),
  "utf8"
);

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

function loadKeepFns(mp4Api) {
  const fromEdit = vtrim.match(/function keepRangesFromEdit\(edit, duration,? ?\w*\) \{[\s\S]*?\n  \}/);
  const forEnc = vtrim.match(/function keepRangesForEncode\(edit, duration,? ?\w*\) \{[\s\S]*?\n  \}/);
  const norm = vtrim.match(/function normalizeCutouts\([\s\S]*?\n  \}/);
  const resolveEnd = vtrim.match(/function resolveEndKeepSec\(editOrFps\) \{[\s\S]*?\n  \}/);
  const resolveStart = vtrim.match(/function resolveStartKeepSec\(editOrFps\) \{[\s\S]*?\n  \}/);
  const resolveKeep = vtrim.match(/function resolveKeepFps\(editOrFps\) \{[\s\S]*?\n  \}/);
  const secToFrame = vtrim.match(/function secToFrame\(sec, fps\) \{[\s\S]*?\n  \}/);
  const frameToSec = vtrim.match(/function frameToSec\(frame, fps\) \{[\s\S]*?\n  \}/);
  const displayFrame = vtrim.match(/function displayFrameAtSec\(sec, fps\) \{[\s\S]*?\n  \}/);
  const normalizeFps = vtrim.match(/function normalizeSourceFps\(raw\) \{[\s\S]*?\n  \}/);
  assert.ok(fromEdit && forEnc && norm && resolveEnd && resolveStart && resolveKeep && secToFrame && frameToSec && displayFrame && normalizeFps);
  const box = { window: { DevToolsMp4Timeline: mp4Api || null } };
  vm.runInNewContext(
    `
    const MIN_SPAN = 0.5, MIN_CUTOUT = 0.2;
    const END_KEEP_SEC = 1 / 25, START_KEEP_SEC = 1 / 50, FRAME_SNAP_SEC = 1 / 30;
    const DEFAULT_FRAME_FPS = 30;
    const ENCODE_BOUND_PAD_SEC = 0;
    const ENCODE_CUT_JUNCTION_PAD_FRAMES = 0;
    const window = this.window;
    ${normalizeFps[0]}
    ${resolveKeep[0]}
    ${secToFrame[0]}
    ${frameToSec[0]}
    ${displayFrame[0]}
    ${resolveEnd[0]}
    ${resolveStart[0]}
    ${norm[0]}
    ${fromEdit[0]}
    ${forEnc[0]}
    this.keepRangesFromEdit = keepRangesFromEdit;
    this.keepRangesForEncode = keepRangesForEncode;
    this.displayFrameAtSec = displayFrameAtSec;
    `,
    box
  );
  return box;
}

/** 均匀 25fps 假采样表：验证删中间接点 = 下一采样，而非 1/fps 近似 */
function mockTimeline25(n = 100) {
  const ctsSec = Float64Array.from({ length: n }, (_, i) => i / 25);
  return {
    ok: true,
    fps: 25,
    ctsSec,
    mediaCtsSec: ctsSec.slice(),
    sampleIndexAtSec(timeline, sec) {
      const arr = timeline.ctsSec;
      const t = Math.max(0, Number(sec) || 0);
      let ans = 0;
      for (let i = 0; i < arr.length; i++) {
        if (arr[i] <= t + 1e-9) ans = i;
        else break;
      }
      return ans;
    },
    sampleRangeForKeep(timeline, startSec, endSec) {
      const a = Math.max(0, Number(startSec) || 0);
      const b = Math.max(a, Number(endSec) || 0);
      const startF = this.sampleIndexAtSec(timeline, a);
      const endF = Math.min(timeline.ctsSec.length, this.sampleIndexAtSec(timeline, Math.max(0, b - 0.5 / 25)) + 1);
      return { startF, endF };
    },
  };
}

t("编辑内 keepRangesLocal 走 keepRangesForEncode（预览=成片）", () => {
  const block = vtrim.slice(
    vtrim.indexOf("function keepRangesLocal()"),
    vtrim.indexOf("function clipCutoutsToWindow")
  );
  assert.ok(block.includes("keepRangesForEncode("));
  assert.ok(!block.includes("keepRangesFromEdit("));
  assert.ok(/srcFps:\s*sourceFps/.test(block), "播放 keep 必须带 srcFps");
  assert.ok(block.includes("sourceTimeline"), "编辑播放须带采样表");
});

t("编辑器须能复用外预览 timeline（三者同表）", () => {
  assert.ok(vtrim.includes("opts.timeline"));
  assert.ok(vtrim.includes("复用同一引用") || vtrim.includes("禁止另 probe"));
  assert.ok(vtrim.includes("__vbbTimeline"), "完成须回写采样表");
  assert.ok(vbb.includes("timeline: item.timeline") || /timeline:\s*item\.timeline/.test(vbb));
  assert.ok(vbb.includes("__vbbTimeline"), "外预览须接回编辑器表");
});

t("拖拽半开 endKeepStepSec ≡ resolveEndKeepSec(sourceFps)", () => {
  assert.ok(/function endKeepStepSec\(\)\s*\{[\s\S]*?return resolveEndKeepSec\(sourceFps\)/.test(vtrim));
});

t("外预览播放/落点走 vbbKeepRangesForEncode", () => {
  const enforce = vbb.slice(
    vbb.indexOf("function enforceVbbEditPlaybackWindow"),
    vbb.indexOf("function armVbbEditFrameWatch")
  );
  assert.ok(enforce.includes("vbbKeepRangesForEncode("));
  assert.ok(!enforce.includes("vbbKeepRangesFromEdit("));
  assert.ok(vbb.includes("外预览落点与成片 keep 首帧一致"));
  assert.ok(/vbbKeepRangesForEncode\(item\.edit,\s*item\.duration\)/.test(vbb));
  assert.ok(enforce.includes("earlySlop"), "keep-seek 须容忍偏早关键帧，防播放按钮狂切");
  assert.ok(enforce.includes("pastSlop"), "越过片尾停帧必须拉回");
});

t("多段删中间：预览≡成片；红柄闭区间；片尾=黄柄半开", () => {
  const { keepRangesFromEdit, keepRangesForEncode } = loadKeepFns();
  const edit = {
    trimStart: 5,
    trimEnd: 95,
    srcFps: 25,
    cutouts: [
      { start: 20, end: 30 },
      { start: 50, end: 60 },
      { start: 70, end: 78 },
    ],
  };
  const preview = keepRangesFromEdit(edit, 100);
  const enc = keepRangesForEncode(edit, 100);
  assert.ok(preview.length >= 3 && enc.length === preview.length);
  const f = 1 / 25;
  assert.ok(Math.abs(preview[0].start - 5) < 1e-9);
  assert.ok(Math.abs(preview[0].end - 20) < 1e-9);
  assert.ok(Math.abs(preview[1].start - (30 + f)) < 1e-9);
  assert.ok(Math.abs(preview[preview.length - 1].end - 95) < 1e-9, "末段 end=黄柄");
  for (let i = 0; i < enc.length; i++) {
    assert.ok(Math.abs(enc[i].start - preview[i].start) < 1e-9);
    assert.ok(Math.abs(enc[i].end - preview[i].end) < 1e-9);
  }
});

t("删中间有采样表：下一段起点=下一 CTS（外预览≡编辑≡GIF 同公式）", () => {
  const api = mockTimeline25(100);
  const { keepRangesFromEdit, keepRangesForEncode } = loadKeepFns(api);
  const tl = {
    fps: 25,
    ctsSec: api.ctsSec,
    mediaCtsSec: api.mediaCtsSec,
  };
  const edit = {
    trimStart: 1,
    trimEnd: 3.5,
    srcFps: 25,
    cutouts: [{ start: 1.6, end: 2.0 }],
  };
  // 模拟三处各自调用但传入同一张表
  const outer = keepRangesForEncode(edit, 4, tl);
  const editor = keepRangesFromEdit(edit, 4, tl);
  const gif = keepRangesForEncode(edit, 4, tl);
  assert.strictEqual(outer.length, 2);
  assert.strictEqual(editor.length, 2);
  assert.strictEqual(gif.length, 2);
  // cut end=2.0 → sampleIndex 50 → 下一采样 51 → 2.04
  const resume = 51 / 25;
  assert.ok(Math.abs(outer[1].start - resume) < 1e-9, `outer resume=${outer[1].start}`);
  assert.ok(Math.abs(editor[1].start - resume) < 1e-9);
  assert.ok(Math.abs(gif[1].start - resume) < 1e-9);
  // 无表时会是 2+1/25=2.04，此处刻意用非整数 cut end 证明走表
  const odd = keepRangesForEncode(
    { ...edit, cutouts: [{ start: 1.6, end: 2.01 }] },
    4,
    tl
  );
  // 2.01 → index 50 (cts=2.0) → next 2.04；1/fps 近似会是 2.05
  assert.ok(Math.abs(odd[1].start - resume) < 1e-9, `table resume not 1/fps: ${odd[1].start}`);
  const noTl = keepRangesForEncode({ ...edit, cutouts: [{ start: 1.6, end: 2.01 }] }, 4, null);
  assert.ok(Math.abs(noTl[1].start - (2.01 + 1 / 25)) < 1e-9, "无表退回 1/fps");
});

t("仅裁片头片尾：起点/终点=黄柄秒值半开", () => {
  const { keepRangesFromEdit, keepRangesForEncode } = loadKeepFns();
  const edit = { trimStart: 10, trimEnd: 40, cutouts: [], srcFps: 30 };
  const preview = keepRangesFromEdit(edit, 60);
  const enc = keepRangesForEncode(edit, 60);
  assert.strictEqual(enc.length, 1);
  assert.ok(Math.abs(enc[0].start - preview[0].start) < 1e-9);
  assert.ok(Math.abs(enc[0].end - preview[0].end) < 1e-9);
  assert.ok(Math.abs(enc[0].start - 10) < 1e-9);
  assert.ok(Math.abs(enc[0].end - 40) < 1e-9);
});

t("exportKeepVideo：一次精切优先；回退分段；禁止两端 bias", () => {
  const start = vtrim.indexOf("async function exportKeepVideo");
  const end = vtrim.indexOf("window.DevToolsVtrimEditor =", start);
  const exp = vtrim.slice(start, end > start ? end : undefined);
  assert.ok(exp.includes("tryOnePass") || exp.includes("onepass"), "须一次滤镜精切");
  assert.ok(exp.includes("filter_complex"), "一次精切走 filter_complex");
  assert.ok(exp.includes("setpts=PTS-STARTPTS"), "trim 后复位段内 PTS");
  assert.ok(exp.includes("segmentSpans"), "回传各段时长");
  assert.ok(exp.includes("sliceLog"), "须回传切片诊断");
  assert.ok(exp.includes("opts.keeps"), "须支持传入预览同套 keeps");
  assert.ok(exp.includes("setsar=1"));
  assert.ok(!/bias\s*=\s*1\s*\/\s*30/.test(exp), "两端 bias 会把中间段首尾相对预览往前挪");
  assert.ok(!/vfCore = \[[\s\S]*?setpts=PTS-STARTPTS[\s\S]*?trim=/.test(exp) || exp.includes("勿在 trim 前 setpts"), "勿在 trim 前 setpts");
});

t("下载编辑后视频：用预览 keep + 附带 export-diag.json", () => {
  const block = vtrim.slice(
    vtrim.indexOf("async function downloadEditedVideo"),
    vtrim.indexOf("function cleanup()")
  );
  assert.ok(block.includes("keepRangesLocal()"), "下载须用预览同套 keep");
  assert.ok(block.includes("keeps: previewKeeps"));
  assert.ok(block.includes("export-diag.json") || block.includes("-export-diag.json"));
  assert.ok(block.includes("vbb-export-diag"));
  assert.ok(block.includes("sliceLog"));
});

t("getEditState：未探测 fps 勿填默认 30（避免误判帧切）", () => {
  const block = vtrim.slice(
    vtrim.indexOf("function getEditState()"),
    vtrim.indexOf("async function downloadEditedVideo")
  );
  assert.ok(block.includes("...(sourceFps >= 5 ? { srcFps: sourceFps } : {})"));
  assert.ok(!/srcFps:\s*sourceFps\s*>=\s*5\s*\?\s*sourceFps\s*:\s*DEFAULT_FRAME_FPS/.test(block));
});

t("displayFrameAtSec：毫秒量化手柄跟 Chrome 所见帧", () => {
  const m = vtrim.match(/function displayFrameAtSec\(sec, fps\) \{[\s\S]*?\n  \}/);
  assert.ok(m, "须有 displayFrameAtSec");
  const box = {};
  vm.runInNewContext(`${m[0]}; this.displayFrameAtSec = displayFrameAtSec;`, box);
  assert.strictEqual(box.displayFrameAtSec(1.033, 30), 30, "1.033s@30 → 帧30（非 round→31）");
  assert.strictEqual(box.displayFrameAtSec(31 / 30, 30), 31, "精确 31/30 → 帧31（round(pts µs)）");
  assert.strictEqual(box.displayFrameAtSec(31 / 30 + 1e-4, 30), 31, "+0.1ms 仍为帧31");
  assert.strictEqual(box.displayFrameAtSec(3.2, 30), 96, "3.2s@30 → 帧96");
  const keepM = vtrim.match(/function keepRangesFromEdit\(edit, duration,? ?\w*\) \{[\s\S]*?\n  \}/);
  assert.ok(keepM && keepM[0].includes("ce + step"), "无采样表时 keep 须按手柄秒+1/fps");
  assert.ok(keepM[0].includes("sampleIndexAtSec") || keepM[0].includes("nextStartAfterCutEnd"), "有采样表时按下一样本");
});

t("materialize：校准可信 ffmpeg 先，否则 chrome；带回 segmentSpans", () => {
  const start = vbb.indexOf("async function materializeVbbKeepVideo");
  const end = vbb.indexOf("function shouldPrecutVbbWindow", start);
  const body = vbb.slice(start, end > start ? end : undefined);
  assert.ok(body.includes("segmentSpans"), "导出片带回各段时长供按段 fps");
  assert.ok(body.includes("exportKeepByChromeDisplay"), "chrome 兜底");
  assert.ok(body.includes("exportKeepVideo"), "ffmpeg 快切");
  assert.ok(body.includes("canFfmpegFirst"), "校准门槛");
  assert.ok(body.includes("快速切片") || body.includes("ffFirst"), "快切优先文案/分支");
  assert.ok(!/keeps\.length\s*<=\s*1/.test(body) || body.includes("单段 keep 也会导出"), "单段也要能导出");
  assert.ok(body.includes("out.segmentSpans") || body.includes("segmentSpans = out") || body.includes("finishMat"), "优先用导出实测段长");
  assert.ok(
    body.includes("frameGrid") &&
      (body.includes('["sec", "ss", "frameRaw", "frameGrid"]') ||
        body.includes('["frameRaw", "frameGrid", "sec", "ss"]')),
    "ffmpeg 兜底须含 frameRaw/frameGrid"
  );
  assert.ok(body.includes("mid-check-fail") || body.includes("校准显示时钟"), "GIF 校准可重试");
  assert.ok(!/setsar=1,fps=\$\{keepFps\}/.test(body), "scalePad 勿再叠 fps=");
  assert.ok(!/\[\$\{i\}:v\]fps=\$\{keepFps\}/.test(body), "concat 勿再 fps=");
  assert.ok(body.includes("calibrateToElement"), "GIF materialize 须校准显示时钟");
  assert.ok(body.includes("matTimeline"), "共用校准 timeline");
  assert.ok(body.includes("matKeeps"), "ffmpeg/chrome 同 keeps");
  assert.ok(
    body.includes("vbbSingleTimeline") || body.includes("getActiveVbbEditItem()?.timeline"),
    "GIF 须优先复用外预览采样表（删中间接点）"
  );
});

t("vtrim：帧内 seek + 校准", () => {
  assert.ok(vtrim.includes("function seekSecForSample"));
  assert.ok(vtrim.includes("function seekSecForTime"));
  assert.ok(vtrim.includes("calibrateToElement"));
  assert.ok(vtrim.includes("frameSeekSec") || vtrim.includes("seekSecForTime(sourceTimeline"));
  assert.ok(vtrim.includes("mediaCtsSec"), "ffmpeg sec 用媒体时钟");
  assert.ok(vtrim.includes("chromeOffsetSec"));
  const park = vtrim.slice(
    vtrim.indexOf("async function seekEndPreviewExact"),
    vtrim.indexOf("async function seekStartPreviewExact")
  );
  assert.ok(park.includes("seekSecForTime"), "片尾停帧走帧内点");
});

t("校准 rematch 须同时吸附红段，防删中间被 normalize 静默清空", () => {
  assert.ok(vtrim.includes("function rematchHandlesAfterCalibrate"));
  const fn = vtrim.slice(
    vtrim.indexOf("function rematchHandlesAfterCalibrate"),
    vtrim.indexOf("async function detectAndApplySourceTimeline")
  );
  assert.ok(fn.includes("clipCutoutsToWindow"), "须 clip 红段");
  assert.ok(fn.includes("snapToEncodeClock"), "红段两端须吸附");
  assert.ok(vtrim.includes("rematchHandlesAfterCalibrate()"), "校准后须调用");
});

t("prepare：时间编辑先导出再 GIF", () => {
  assert.ok(vbb.includes("function vbbEditNeedsExport"));
  assert.ok(vbb.includes("exportedEdit"));
  const prep = vbb.slice(
    vbb.indexOf("async function prepareVbbEncodeSource"),
    vbb.indexOf("function intersectVbbCrops")
  );
  assert.ok(prep.includes("vbbEditNeedsExport"));
  assert.ok(prep.includes("先导出编辑片"));
  assert.ok(prep.includes("segmentSpans"));
});

t("ENCODE 叠垫已清零（根因用源帧窗）", () => {
  assert.ok(/ENCODE_BOUND_PAD_SEC\s*=\s*0/.test(vtrim));
  assert.ok(/ENCODE_CUT_JUNCTION_PAD_FRAMES\s*=\s*0/.test(vtrim));
});

t("片尾抬手成片时钟吸附；不按 Chrome shown 改写黄柄", () => {
  const finish = vtrim.slice(
    vtrim.indexOf("async function finishTrimDrag"),
    vtrim.indexOf("function ratioFromClientX")
  );
  assert.ok(finish.includes("snapTrimHandle") || finish.includes("snapToEncodeClock"));
  assert.ok(finish.includes("成片时钟吸附") || finish.includes("seekEndPreviewExact"));
  assert.ok(!finish.includes("fromShown"));
  assert.ok(!/Math\.max\(\s*want\s*,\s*shown\s*\+\s*END_KEEP_SEC\s*\)/.test(finish));
});

t("下载：默认 ffmpeg 快切，chrome 仅异常兜底", () => {
  const marker = vtrim.indexOf("默认 ffmpeg frameRaw 快切");
  const dl = vtrim.slice(
    marker > 0 ? marker : vtrim.indexOf("async function downloadEditedVideo"),
    vtrim.indexOf("const blob = out?.blob")
  );
  assert.ok(dl.includes("canFfmpegFirst") || dl.includes("ctsSec"), "须试快切");
  assert.ok(dl.includes("exportKeepByChromeDisplay"));
  assert.ok(dl.includes("exportKeepVideo"));
  assert.ok(dl.includes("快速切片") || dl.includes("ffFirst"));
  assert.ok(dl.indexOf("ffFirst") < dl.indexOf("exportKeepByChromeDisplay"));
  assert.ok(
    vtrim.includes("ensureSourceTimelineForExport") &&
      vtrim.includes("sourceTimelineReady"),
    "导出前须 await 校准，防误走对齐预览帧"
  );
  assert.ok(dl.includes("校准显示时钟") || vtrim.includes("校准显示时钟"), "导出前校准文案");
  assert.ok(dl.includes("异常") || vtrim.includes("异常："), "chrome 兜底须标异常");
  assert.ok(dl.includes("绝不当默认") || vtrim.includes("绝不当默认"), "预览帧不当默认");
});

t("ffmpeg onepass：有采样表只用 frameRaw（校准后禁止 sec）", () => {
  const block = vtrim.slice(
    vtrim.indexOf("一次精切…"),
    vtrim.indexOf("let hit = null")
  );
  assert.ok(block.includes('preferSampleFrames') && block.includes('["frameRaw"]'), "有 stts 仅 frameRaw");
  assert.ok(block.includes("ctsSec 可能已校准") || block.includes("sec 切会偏"));
});

t("有 srcFps：keep.end=黄柄秒值半开", () => {
  const box = loadKeepFns();
  for (const fps of [24, 30, 60]) {
    const trimEnd = 10;
    const edit = { trimStart: 0, trimEnd, cutouts: [], srcFps: fps };
    const preview = box.keepRangesFromEdit(edit, 12);
    const enc = box.keepRangesForEncode(edit, 12);
    assert.strictEqual(preview.length, 1);
    assert.ok(Math.abs(preview[0].end - trimEnd) < 1e-9, `${fps}fps keep.end=黄柄`);
    assert.ok(Math.abs(enc[0].end - trimEnd) < 1e-9, `${fps}fps 成片 end=黄柄`);
  }
});

console.log(`vbb-preview-encode-align.test.js: ${n} passed`);
