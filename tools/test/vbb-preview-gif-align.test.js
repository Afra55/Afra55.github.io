"use strict";

/**
 * 黄柄所见即所得；删中间接点成片可再收 1 帧（防 GIF 多吐）。
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
    const ENCODE_CUT_JUNCTION_PAD_FRAMES = 1;
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

t("无删段：成片 keep ≡ 预览 keep（黄柄所见即所得）", () => {
  assert.ok(/ENCODE_BOUND_PAD_SEC\s*=\s*0/.test(vtrim));
  assert.ok(/ENCODE_CUT_JUNCTION_PAD_FRAMES\s*=\s*1/.test(vtrim));
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

t("删中间：成片接点相对预览再收 1 帧", () => {
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
  // 片头仍对齐黄柄
  assert.ok(Math.abs(a[0].start - 5) < 1e-9);
  assert.ok(Math.abs(b[0].start - 5) < 1e-9);
  // 上一段终点：成片再提前 1 帧
  assert.ok(Math.abs(b[0].end - (a[0].end - pad)) < 1e-9);
  // 下一段起点：成片再推后 1 帧（中间段片尾接点）
  assert.ok(Math.abs(b[1].start - (a[1].start + pad)) < 1e-9);
  // 预览 keep 已从 cut.end 空 2 帧
  assert.ok(Math.abs(a[1].start - (30 + pad * 2)) < 1e-9);
});

t("仅裁片头：成片起点 = 黄柄 trimStart", () => {
  const { keepRangesForEncode } = loadKeepFns();
  const enc = keepRangesForEncode({ trimStart: 10, trimEnd: 40, cutouts: [] }, 60);
  assert.strictEqual(enc.length, 1);
  assert.ok(Math.abs(enc[0].start - 10) < 1e-9);
});

t("keepRangesForEncode 有删段时收接点垫", () => {
  const fn = vtrim.slice(
    vtrim.indexOf("function keepRangesForEncode"),
    vtrim.indexOf("function previewSeekForKeepRanges")
  );
  assert.ok(fn.includes("ENCODE_CUT_JUNCTION_PAD_FRAMES"));
  assert.ok(fn.includes("if (i > 0)"));
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

t("编辑后仍 forceAccurateCut（精确切，不靠多删垫）", () => {
  assert.ok(shared.includes("forceAccurateCut"));
  assert.ok(vbb.includes("forceAccurateCut: Boolean(prepared.cutNote)"));
});

t("编码：keep 已半开时不再二次垫（编辑/带 startSec 路径 pad=0）", () => {
  assert.ok(shared.includes("function vbbEncodeHalfOpenPadSec"));
  // 两处 encode 均：forceAccurateCut / keepAligned / 有 startSec → pad 0
  const hits = shared.match(/halfOpenPad\s*=\s*[\s\S]*?vbbEncodeHalfOpenPadSec/g) || [];
  assert.ok(hits.length >= 2, `encode sites=${hits.length}`);
  for (const h of hits) {
    assert.ok(
      /forceAccurateCut|keepAligned|Number\.isFinite\(opts\.startSec\)/.test(h),
      "keep 对齐路径须跳过二次半开垫"
    );
  }
  const m = shared.match(/function vbbEncodeHalfOpenPadSec\([\s\S]*?\n      \}/);
  assert.ok(m);
  const box = {};
  vm.runInNewContext(`${m[0]}\nthis.fn = vbbEncodeHalfOpenPadSec;`, box);
  // 旧路径函数仍保留合理下限
  assert.ok(box.fn(20, 30) + 1e-9 >= 0.5 / 30);
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
