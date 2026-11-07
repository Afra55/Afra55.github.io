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

function loadKeepFns() {
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
  const box = {};
  vm.runInNewContext(
    `
    const MIN_SPAN = 0.5, MIN_CUTOUT = 0.2;
    const END_KEEP_SEC = 1 / 25, START_KEEP_SEC = 1 / 50, FRAME_SNAP_SEC = 1 / 30;
    const DEFAULT_FRAME_FPS = 30;
    const ENCODE_BOUND_PAD_SEC = 0;
    const ENCODE_CUT_JUNCTION_PAD_FRAMES = 0;
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

t("编辑内 keepRangesLocal 走 keepRangesForEncode（预览=成片）", () => {
  const block = vtrim.slice(
    vtrim.indexOf("function keepRangesLocal()"),
    vtrim.indexOf("function clipCutoutsToWindow")
  );
  assert.ok(block.includes("keepRangesForEncode("));
  assert.ok(!block.includes("keepRangesFromEdit("));
  assert.ok(/srcFps:\s*sourceFps/.test(block), "播放 keep 必须带 srcFps");
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

t("exportKeepVideo：有 stts 则 frameRaw 优先，否则 sec；frameGrid 回退才 fps=；禁止两端 bias", () => {
  const start = vtrim.indexOf("async function exportKeepVideo");
  const end = vtrim.indexOf("window.DevToolsVtrimEditor =", start);
  const exp = vtrim.slice(start, end > start ? end : undefined);
  assert.ok(exp.includes('["frameRaw", "sec", "ss", "frameGrid"]'), "有采样表须 frameRaw 优先");
  assert.ok(exp.includes('["sec", "ss", "frameRaw", "frameGrid"]'), "无采样表须 sec 优先");
  assert.ok(exp.includes("setpts=PTS-STARTPTS"), "trim 前须复位 PTS");
  assert.ok(exp.includes("segmentSpans"), "回传各段时长");
  assert.ok(exp.includes("sliceLog"), "须回传切片诊断");
  assert.ok(exp.includes("opts.keeps"), "须支持传入预览同套 keeps");
  assert.ok(exp.includes("MIN_PART_BYTES"));
  assert.ok(/useGrid \? `fps=\$\{keepFps\}:round=up`/.test(exp), "仅 frameGrid 才抽格");
  assert.ok(exp.includes("setsar=1"));
  assert.ok(!/bias\s*=\s*1\s*\/\s*30/.test(exp), "两端 bias 会把中间段首尾相对预览往前挪");
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

t("materialize：有编辑就导出；带回 segmentSpans；切片先 fps=round=up", () => {
  const start = vbb.indexOf("async function materializeVbbKeepVideo");
  const end = vbb.indexOf("function shouldPrecutVbbWindow", start);
  const body = vbb.slice(start, end > start ? end : undefined);
  assert.ok(body.includes("segmentSpans"), "导出片带回各段时长供按段 fps");
  assert.ok(!/keeps\.length\s*<=\s*1/.test(body) || body.includes("单段 keep 也会导出"), "单段也要能导出");
  assert.ok(body.includes("out.segmentSpans") || body.includes("segmentSpans = out"), "优先用导出实测段长");
  assert.ok(body.includes("frameGrid") && body.includes('["sec", "ss", "frameRaw", "frameGrid"]'), "兜底 PTS 优先");
  assert.ok(!/setsar=1,fps=\$\{keepFps\}/.test(body), "scalePad 勿再叠 fps=");
  assert.ok(!/\[\$\{i\}:v\]fps=\$\{keepFps\}/.test(body), "concat 勿再 fps=");
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

t("片尾抬手只用 min(want,…) 收紧，禁止推过拖点", () => {
  assert.ok(/Math\.min\(\s*want\s*,\s*Math\.max\(\s*fromShown/.test(vtrim));
  assert.ok(!/Math\.max\(\s*want\s*,\s*shown\s*\+\s*END_KEEP_SEC\s*\)/.test(vtrim));
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
