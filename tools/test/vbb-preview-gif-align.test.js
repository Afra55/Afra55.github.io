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
  const fromEdit = vtrim.match(/function keepRangesFromEdit\(edit, duration\) \{[\s\S]*?\n  \}/);
  const forEnc = vtrim.match(/function keepRangesForEncode\(edit, duration\) \{[\s\S]*?\n  \}/);
  const norm = vtrim.match(/function normalizeCutouts\([\s\S]*?\n  \}/);
  const resolveEnd = vtrim.match(/function resolveEndKeepSec\(editOrFps\) \{[\s\S]*?\n  \}/);
  const resolveStart = vtrim.match(/function resolveStartKeepSec\(editOrFps\) \{[\s\S]*?\n  \}/);
  const resolveKeep = vtrim.match(/function resolveKeepFps\(editOrFps\) \{[\s\S]*?\n  \}/);
  const secToFrame = vtrim.match(/function secToFrame\(sec, fps\) \{[\s\S]*?\n  \}/);
  const frameToSec = vtrim.match(/function frameToSec\(frame, fps\) \{[\s\S]*?\n  \}/);
  const normalizeFps = vtrim.match(/function normalizeSourceFps\(raw\) \{[\s\S]*?\n  \}/);
  assert.ok(
    fromEdit && forEnc && norm && resolveEnd && resolveStart && resolveKeep && secToFrame && frameToSec && normalizeFps
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
    ${resolveEnd[0]}
    ${resolveStart[0]}
    ${norm[0]}
    ${fromEdit[0]}
    ${forEnc[0]}
    this.keepRangesFromEdit = keepRangesFromEdit;
    this.keepRangesForEncode = keepRangesForEncode;
    this.secToFrame = secToFrame;
    this.frameToSec = frameToSec;
    `,
    box
  );
  return box;
}

t("无删段：成片 keep ≡ 预览 keep；end = 黄柄半开上界", () => {
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
  // 不再减 1/fps：黄柄即 exclusive end
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

t("仅裁片头：起点 = 黄柄 trimStart", () => {
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
  assert.ok(fn.includes("return keepRangesFromEdit(edit, duration)"));
});

t("exportKeepVideo：帧号优先+体积校验回退；禁止两端 bias", () => {
  const exp = vtrim.slice(
    vtrim.indexOf("async function exportKeepVideo"),
    vtrim.indexOf("window.DevToolsVtrimEditor =")
  );
  const frameAt = exp.indexOf('trySlice(keeps[i], i, "frame")');
  const secAt = exp.indexOf('trySlice(keeps[i], i, "sec")');
  assert.ok(frameAt > 0 && secAt > frameAt, "须 frame 先于 sec，避免成片相对预览前移");
  assert.ok(exp.includes("MIN_PART_BYTES"));
  assert.ok(!/bias\s*=\s*1\s*\/\s*30/.test(exp));
  assert.ok(!/endBias\s*=\s*1\s*\/\s*60/.test(exp));
});

t("编辑后仍 forceAccurateCut", () => {
  assert.ok(shared.includes("forceAccurateCut"));
  assert.ok(vbb.includes("forceAccurateCut: Boolean(prepared.cutNote)"));
});

t("编码：keep 对齐路径片尾垫>0；窗函数 encodeT 严小于半开上界", () => {
  assert.ok(shared.includes("function vbbEncodeWindowFromKeepSpan"));
  assert.ok(shared.includes("function vbbEncodeSpanTailPadSec"));
  assert.ok(shared.includes("function vbbEncodeKeepEdgePadSec"));
  const mEdge = shared.match(/function vbbEncodeKeepEdgePadSec\([\s\S]*?\n      \}/);
  const m = shared.match(/function vbbEncodeSpanTailPadSec\([\s\S]*?\n      \}/);
  const mWin = shared.match(/function vbbEncodeWindowFromKeepSpan\([\s\S]*?\n      \}/);
  assert.ok(mEdge && m && mWin);
  const box = {};
  vm.runInNewContext(
    `${mEdge[0]}\n${m[0]}\n${mWin[0]}
     function vbbEncodeHalfOpenPadSec(gifFps, srcFps) {
       return Math.max(0.5 / Math.max(8, gifFps || 15), 1 / 120);
     }
     this.edge = vbbEncodeKeepEdgePadSec;
     this.tail = vbbEncodeSpanTailPadSec;
     this.win = vbbEncodeWindowFromKeepSpan;`,
    box
  );
  // 编辑路径收 4 帧垫；窗函数再 floor-2
  const pad = box.tail(15, 30, { startSec: 1.2 });
  assert.ok(pad + 1e-9 >= box.edge(15, 30));
  assert.ok(pad + 1e-9 >= 4 / 30);
  assert.ok(box.tail(15, 30, {}) + 1e-9 >= 0.5 / 15);
  const w = box.win(10, 1, 15);
  assert.ok(w.encodeT < 10 - 1e-9, `encodeT=${w.encodeT} 须 < 10`);
  assert.ok(w.frameCount <= Math.floor((10 - 1 / 15) * 15 + 1e-9) - 2);
  assert.ok((w.frameCount - 1) / 15 < 10 - 1e-9);
  assert.ok(w.encodeT + 1e-9 >= w.frameCount / 15);
  assert.ok(shared.includes("function vbbEncodeOutTrimFilters"));
});

t("预裁切不再对 keep span 二次减半帧", () => {
  const fn = vbb.slice(
    vbb.indexOf("async function materializeVbbTrimClip"),
    vbb.indexOf("async function prepareVbbEncodeSource")
  );
  assert.ok(!/1\s*\/\s*60/.test(fn) || fn.includes("禁止再减半帧"), "预裁勿再 span-1/60");
  assert.ok(fn.includes("禁止再减半帧") || /const dur = Math\.max\(0\.05, Number\(span\)/.test(fn));
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
