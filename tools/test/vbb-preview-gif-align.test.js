"use strict";

/**
 * 预览/成片 keep 共用源帧半开窗 [startF,endF)。
 * 编码 -t/frameCount 另收片尾垫 + 半帧 epsilon（防 fps= 多吐），不改预览 keep。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const vtrim = fs.readFileSync(path.join(__dirname, "..", "lib", "vtrim-editor.js"), "utf8");
const shared = fs.readFileSync(
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
  assert.ok(
    fromEdit && forEnc && norm && resolveEnd && resolveStart && resolveKeep && secToFrame && frameToSec && displayFrame && normalizeFps
  );
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
    this.secToFrame = secToFrame;
    this.frameToSec = frameToSec;
    this.displayFrameAtSec = displayFrameAtSec;
    `,
    box
  );
  return box;
}

t("无删段：成片 keep ≡ 预览 keep；end = 黄柄半开", () => {
  assert.ok(/ENCODE_CUT_JUNCTION_PAD_FRAMES\s*=\s*0/.test(vtrim));
  const { keepRangesFromEdit, keepRangesForEncode } = loadKeepFns();
  const edit = { trimStart: 5, trimEnd: 95, cutouts: [], srcFps: 25 };
  const a = keepRangesFromEdit(edit, 100);
  const b = keepRangesForEncode(edit, 100);
  assert.strictEqual(a.length, 1);
  assert.strictEqual(b.length, 1);
  assert.ok(Math.abs(a[0].start - b[0].start) < 1e-9);
  assert.ok(Math.abs(a[0].end - b[0].end) < 1e-9);
  assert.ok(Math.abs(a[0].start - 5) < 1e-9);
  assert.ok(Math.abs(a[0].end - 95) < 1e-9);
});

t("多段删中间：闭区间删红柄帧；预览≡成片；无叠垫", () => {
  const { keepRangesFromEdit, keepRangesForEncode } = loadKeepFns();
  const edit = {
    trimStart: 5,
    trimEnd: 95,
    srcFps: 25,
    cutouts: [
      { start: 20, end: 30 },
      { start: 50, end: 60 },
    ],
  };
  const a = keepRangesFromEdit(edit, 100);
  const b = keepRangesForEncode(edit, 100);
  assert.strictEqual(a.length, b.length);
  assert.ok(a.length >= 3);
  const f = 1 / 25;
  // cut.start 帧删除 → 上一段 exclusive end = 20
  assert.ok(Math.abs(a[0].end - 20) < 1e-9);
  // cut.end 帧删除 → 下一段从 30+1/fps 起
  assert.ok(Math.abs(a[1].start - (30 + f)) < 1e-9);
  assert.ok(Math.abs(a[1].end - 50) < 1e-9);
  assert.ok(Math.abs(a[2].start - (60 + f)) < 1e-9);
  for (let i = 0; i < a.length; i++) {
    assert.ok(Math.abs(a[i].start - b[i].start) < 1e-9, `段${i} start`);
    assert.ok(Math.abs(a[i].end - b[i].end) < 1e-9, `段${i} end`);
  }
});

t("仅裁片头：起点/终点 = 黄柄秒值半开", () => {
  const { keepRangesForEncode } = loadKeepFns();
  const enc = keepRangesForEncode({ trimStart: 10, trimEnd: 40, cutouts: [], srcFps: 30 }, 60);
  assert.strictEqual(enc.length, 1);
  assert.ok(Math.abs(enc[0].start - 10) < 1e-9);
  assert.ok(Math.abs(enc[0].end - 40) < 1e-9);
});

t("keepRangesForEncode 直接 return keepRangesFromEdit", () => {
  const fn = vtrim.slice(
    vtrim.indexOf("function keepRangesForEncode"),
    vtrim.indexOf("function previewSeekForKeepRanges")
  );
  assert.ok(fn.includes("return keepRangesFromEdit(edit, duration, timeline)"));
});

t("exportKeepVideo：一次精切；接 MP4 时间轴；勿 -r cfr；禁止两端 bias", () => {
  const exp = vtrim.slice(
    vtrim.indexOf("async function exportKeepVideo"),
    vtrim.indexOf("window.DevToolsVtrimEditor =")
  );
  assert.ok(exp.includes("tryOnePass") || exp.includes("onepass"), "须一次精切");
  assert.ok(exp.includes("probeMp4VideoTimeline") || exp.includes("preferSampleFrames"), "须接 MP4 时间轴");
  assert.ok(exp.includes("displayFrameAtSec"), "须用 Chrome 显示帧映射");
  assert.ok(!/"-r"[\s\S]{0,40}String\(keepFps\)/.test(exp), "切片勿 -r keepFps（强制 CFR 丢段首）");
  assert.ok(exp.includes("passthrough") || exp.includes("vfr"), "保段首帧");
  assert.ok(!/bias\s*=\s*1\s*\/\s*30/.test(exp));
  assert.ok(!/endBias\s*=\s*1\s*\/\s*60/.test(exp));
});

t("编码抽段/硬切用 PTS trim，避免 demux -ss 片头前移", () => {
  const cut = shared.slice(
    shared.indexOf("function buildVbbSegmentCutArgs"),
    shared.indexOf("function buildVbbSegmentCutArgs") + 900
  );
  assert.ok(cut.includes("trim=start=${ss}:end=${end}"));
  assert.ok(cut.includes('"vfr"'));
  const hard = shared.slice(
    shared.indexOf("function vbbEncodeHardTrimFilters"),
    shared.indexOf("function vbbEncodeOutTrimFilters")
  );
  assert.ok(hard.includes("startSec"));
  assert.ok(hard.includes("trim=start=${start}:end=${end}"));
  assert.ok(shared.includes("ptsStart"));
  assert.ok(shared.includes("PTS 起点已进 timeFilter") || shared.includes("勿再 -ss"));
});

t("编辑后仍 forceAccurateCut", () => {
  assert.ok(shared.includes("forceAccurateCut"));
  assert.ok(vbb.includes("forceAccurateCut: Boolean(prepared.cutNote)"));
});

t("O3加宽/硬闸重编须带 vbbKeepFrameEncodeOpts；按段 -t=frameCount/fps", () => {
  assert.ok(shared.includes("function vbbKeepFrameEncodeOpts"));
  assert.ok((shared.match(/vbbKeepFrameEncodeOpts\(/g) || []).length >= 3, "核心+O3+硬闸三处共用");
  assert.ok(/encodeT = \(frameCount \/ fps\) \* speed/.test(shared), "按段采样 -t 须盖住 ceil 帧之和");
});

t("编码：导出编辑片片尾垫=0；倍速括号正确；按段 fps；round=up", () => {
  assert.ok(shared.includes("function vbbEncodeWindowFromKeepSpan"));
  assert.ok(shared.includes("function vbbEncodeSpanTailPadSec"));
  assert.ok(shared.includes("function vbbEncodeSegmentedFpsFilter"));
  assert.ok(shared.includes("setpts=(PTS-STARTPTS)/${spd}") || shared.includes("setpts=(PTS-STARTPTS)/"));
  assert.ok(shared.includes("fps=${fps}:round=up") || shared.includes("fps=${fps}:round=up"));
  const m = shared.match(/function vbbEncodeSpanTailPadSec\([\s\S]*?\n      \}/);
  const mWin = shared.match(/function vbbEncodeWindowFromKeepSpan\([\s\S]*?\n      \}/);
  const mHard = shared.match(/function vbbEncodeHardTrimFilters\([\s\S]*?\n      \}/);
  assert.ok(m && mWin && mHard);
  const box = {};
  vm.runInNewContext(
    `${m[0]}\n${mWin[0]}\n${mHard[0]}
     function vbbEncodeHalfOpenPadSec(gifFps, srcFps) {
       return Math.max(0.5 / Math.max(8, gifFps || 15), 1 / 120);
     }
     this.tail = vbbEncodeSpanTailPadSec;
     this.win = vbbEncodeWindowFromKeepSpan;
     this.hard = vbbEncodeHardTrimFilters;`,
    box
  );
  assert.strictEqual(box.tail(15, 30, { exportedEdit: true }), 0);
  assert.strictEqual(box.tail(15, 30, { exactKeepFrames: true }), 0);
  assert.ok(box.tail(15, 30, {}) + 1e-9 >= 0.5 / 15);
  const w = box.win(10, 1, 15, { exportedEdit: true });
  assert.ok(w.frameCount >= Math.ceil(10 * 15 - 1e-6) - 1);
  const h = box.hard(2, 8, 0);
  assert.ok(h.includes("(PTS-STARTPTS)/2"), `倍速须带括号：${h}`);
  assert.ok(!/PTS-STARTPTS\/2/.test(h.replace(/\(PTS-STARTPTS\)\/2/g, "")), "禁止无括号写法");
});

t("预裁切不再对 keep span 二次减半帧", () => {
  const fn = vbb.slice(
    vbb.indexOf("async function materializeVbbTrimClip"),
    vbb.indexOf("async function prepareVbbEncodeSource")
  );
  assert.ok(!/1\s*\/\s*60/.test(fn) || fn.includes("禁止再减半帧"), "预裁勿再 span-1/60");
  assert.ok(fn.includes("禁止再减半帧") || /const dur = Math\.max\(0\.05, Number\(span\)/.test(fn));
});

t("删中间 materialize 优先 ffmpeg，chrome 兜底勿 -r cfr", () => {
  const fn = vbb.slice(
    vbb.indexOf("async function materializeVbbKeepVideo"),
    vbb.indexOf("async function shouldPrecutVbbWindow")
  );
  assert.ok(fn.includes("exportKeepVideo"), "优先 ffmpeg");
  assert.ok(fn.includes("exportKeepByChromeDisplay"), "chrome 兜底");
  assert.ok(fn.indexOf("exportKeepVideo") < fn.indexOf("exportKeepByChromeDisplay"));
  assert.ok(!/"-r"[\s\S]{0,40}String\(keepFps\)/.test(fn));
  assert.ok(fn.includes('"vfr"'));
  assert.ok(fn.includes('["sec", "ss", "frameRaw", "frameGrid"]') || fn.includes("frameGrid"), "ffmpeg 兜底");
});

t("预裁后编码窗不得长于 keep（防 GIF 多帧）", () => {
  assert.ok(vbb.includes("禁止用上报时长撑长编码窗"));
  assert.ok(/Math\.min\(\s*requestedSpan\s*,\s*reported\s*\)/.test(vbb));
  assert.ok(vbb.includes("编码窗不得超过 keep"));
  assert.ok(!/rep <= keep \* 1\.25/.test(vbb));
});

t("时长标签为保留", () => {
  assert.ok(vtrim.includes("保留 ${formatClock(keepSpan)}") || /保留 \$\{formatClock\(keepSpan\)\}/.test(vtrim));
  assert.ok(!/成片 \$\{formatClock\(keepSpan\)\}/.test(vtrim));
});

console.log(`vbb-preview-gif-align.test.js: ${n} passed`);
