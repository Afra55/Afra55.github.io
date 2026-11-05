"use strict";

/**
 * 黄柄所见即所得；删中间接点成片再收；单段片头/片尾由编码垫收。
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
  const normalizeFps = vtrim.match(/function normalizeSourceFps\(raw\) \{[\s\S]*?\n  \}/);
  assert.ok(fromEdit && forEnc && norm && resolveEnd && resolveStart && normalizeFps);
  const box = {};
  vm.runInNewContext(
    `
    const MIN_SPAN = 0.5, MIN_CUTOUT = 0.2;
    const END_KEEP_SEC = 1 / 25, START_KEEP_SEC = 1 / 50, FRAME_SNAP_SEC = 1 / 30;
    const ENCODE_BOUND_PAD_SEC = 0;
    const ENCODE_CUT_JUNCTION_PAD_FRAMES = 2;
    ${normalizeFps[0]}
    ${resolveEnd[0]}
    ${resolveStart[0]}
    ${norm[0]}
    ${fromEdit[0]}
    ${forEnc[0]}
    this.keepRangesFromEdit = keepRangesFromEdit;
    this.keepRangesForEncode = keepRangesForEncode;
    `,
    box
  );
  return box;
}

t("无删段：成片 keep ≡ 预览 keep（单段片头片尾由编码垫）", () => {
  assert.ok(/ENCODE_BOUND_PAD_SEC\s*=\s*0/.test(vtrim));
  assert.ok(/ENCODE_CUT_JUNCTION_PAD_FRAMES\s*=\s*2/.test(vtrim));
  const { keepRangesFromEdit, keepRangesForEncode } = loadKeepFns();
  const edit = { trimStart: 5, trimEnd: 95, cutouts: [] };
  const a = keepRangesFromEdit(edit, 100);
  const b = keepRangesForEncode(edit, 100);
  assert.strictEqual(a.length, 1);
  assert.strictEqual(b.length, 1);
  assert.ok(Math.abs(a[0].start - b[0].start) < 1e-9);
  assert.ok(Math.abs(a[0].end - b[0].end) < 1e-9);
  assert.ok(Math.abs(a[0].start - 5) < 1e-9);
});

t("多段删中间：预览两端空 2 帧；成片接点再收 2 帧 + 首末段", () => {
  const { keepRangesFromEdit, keepRangesForEncode } = loadKeepFns();
  const edit = {
    trimStart: 5,
    trimEnd: 95,
    cutouts: [
      { start: 20, end: 30 },
      { start: 50, end: 60 },
    ],
  };
  const a = keepRangesFromEdit(edit, 100);
  const b = keepRangesForEncode(edit, 100);
  assert.strictEqual(a.length, b.length);
  assert.ok(a.length >= 3);
  const pad = 1 / 25;
  // 预览：cut.start / cut.end 各空 2 帧
  assert.ok(Math.abs(a[0].end - (20 - pad * 2)) < 1e-9);
  assert.ok(Math.abs(a[1].start - (30 + pad * 2)) < 1e-9);
  assert.ok(Math.abs(a[1].end - (50 - pad * 2)) < 1e-9);
  assert.ok(Math.abs(a[2].start - (60 + pad * 2)) < 1e-9);
  // 成片：首段片头再推、接点再收、末段片尾再收（各 2 帧）
  const jPad = pad * 2;
  assert.ok(Math.abs(b[0].start - (a[0].start + jPad)) < 1e-9, "多段首段片头再推");
  assert.ok(Math.abs(b[0].end - (a[0].end - jPad)) < 1e-9, "上一段终点再收");
  assert.ok(Math.abs(b[1].start - (a[1].start + jPad)) < 1e-9, "下一段起点再推");
  assert.ok(Math.abs(b[2].end - (a[2].end - jPad)) < 1e-9, "末段片尾再收");
});

t("仅裁片头：成片 keep 起点仍 = 黄柄（编码 -ss 再垫）", () => {
  const { keepRangesForEncode } = loadKeepFns();
  const enc = keepRangesForEncode({ trimStart: 10, trimEnd: 40, cutouts: [] }, 60);
  assert.strictEqual(enc.length, 1);
  assert.ok(Math.abs(enc[0].start - 10) < 1e-9);
});

t("keepRangesForEncode 有删段时收接点 + 首末段", () => {
  const fn = vtrim.slice(
    vtrim.indexOf("function keepRangesForEncode"),
    vtrim.indexOf("function previewSeekForKeepRanges")
  );
  assert.ok(fn.includes("ENCODE_CUT_JUNCTION_PAD_FRAMES"));
  assert.ok(fn.includes("if (i > 0)"));
  assert.ok(fn.includes("i === 0") || fn.includes("i===0"));
  assert.ok(fn.includes("preview.length - 1"));
  assert.ok(!fn.includes("ENCODE_BOUND_PAD_SEC / 2"));
});

t("exportKeepVideo：trim 路径不额外 endBias；仅 -ss 回退可收", () => {
  const exp = vtrim.slice(
    vtrim.indexOf("async function exportKeepVideo"),
    vtrim.indexOf("window.DevToolsVtrimEditor =")
  );
  assert.ok(!/endBias\s*=\s*1\s*\/\s*60/.test(exp));
  assert.ok(exp.includes("if (!useTrim)"));
});

t("编辑后仍 forceAccurateCut（精确切）", () => {
  assert.ok(shared.includes("forceAccurateCut"));
  assert.ok(vbb.includes("forceAccurateCut: Boolean(prepared.cutNote)"));
});

t("编码：片头/片尾各收 2 帧（startSec>0 才垫片头）", () => {
  assert.ok(shared.includes("function vbbEncodeKeepEdgePadSec"));
  assert.ok(shared.includes("function vbbEncodeSpanHeadPadSec"));
  assert.ok(shared.includes("function vbbEncodeSpanTailPadSec"));
  const headHits = shared.match(/vbbEncodeSpanHeadPadSec\(/g) || [];
  const tailHits = shared.match(/vbbEncodeSpanTailPadSec\(/g) || [];
  assert.ok(headHits.length >= 3, `head sites=${headHits.length}`);
  assert.ok(tailHits.length >= 3, `tail sites=${tailHits.length}`);
  const mEdge = shared.match(/function vbbEncodeKeepEdgePadSec\([\s\S]*?\n      \}/);
  const mHead = shared.match(/function vbbEncodeSpanHeadPadSec\([\s\S]*?\n      \}/);
  const mTail = shared.match(/function vbbEncodeSpanTailPadSec\([\s\S]*?\n      \}/);
  assert.ok(mEdge && mHead && mTail);
  const box = {};
  vm.runInNewContext(
    `${mEdge[0]}\n${mHead[0]}\n${mTail[0]}
     this.edge = vbbEncodeKeepEdgePadSec;
     this.head = vbbEncodeSpanHeadPadSec;
     this.tail = vbbEncodeSpanTailPadSec;`,
    box
  );
  assert.ok(Math.abs(box.edge(15, 30) - 2 / 15) < 1e-9);
  assert.ok(box.head(15, 30, { startSec: 1.2 }, 1.2) + 1e-9 >= 2 / 15);
  assert.ok(box.head(15, 30, { startSec: 0 }, 0) === 0, "片头≈0 不垫");
  assert.ok(box.tail(15, 30, { startSec: 1.2 }) + 1e-9 >= 2 / 15);
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

t("时长标签为保留（黄柄=成片）", () => {
  assert.ok(vtrim.includes("保留 ${formatClock(keepSpan)}") || /保留 \$\{formatClock\(keepSpan\)\}/.test(vtrim));
  assert.ok(!/成片 \$\{formatClock\(keepSpan\)\}/.test(vtrim));
});

console.log(`vbb-preview-gif-align.test.js: ${n} passed`);
