"use strict";

/**
 * 编辑预览 ↔ 成片对齐：拖片头片尾 + 多段删中间，播放 keep 须与编码 keep 同一套。
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
  const fromEdit = vtrim.match(/function keepRangesFromEdit\(edit, duration\) \{[\s\S]*?\n  \}/);
  const forEnc = vtrim.match(/function keepRangesForEncode\(edit, duration\) \{[\s\S]*?\n  \}/);
  const norm = vtrim.match(/function normalizeCutouts\([\s\S]*?\n  \}/);
  assert.ok(fromEdit && forEnc && norm);
  const box = {};
  vm.runInNewContext(
    `
    const MIN_SPAN = 0.5, MIN_CUTOUT = 0.2;
    const END_KEEP_SEC = 1 / 25, START_KEEP_SEC = 1 / 50, ENCODE_BOUND_PAD_SEC = 0;
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

t("编辑内 keepRangesLocal 走 keepRangesForEncode（预览=成片）", () => {
  const block = vtrim.slice(
    vtrim.indexOf("function keepRangesLocal()"),
    vtrim.indexOf("function clipCutoutsToWindow")
  );
  assert.ok(block.includes("keepRangesForEncode("));
  assert.ok(!block.includes("keepRangesFromEdit("));
  assert.ok(/srcFps:\s*sourceFps/.test(block), "播放 keep 必须带 srcFps，与拖拽半开一致");
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
});

t("成片 keep ≡ 预览 keep（所见即所得）", () => {
  const { keepRangesFromEdit, keepRangesForEncode } = loadKeepFns();
  const edit = {
    trimStart: 5,
    trimEnd: 95,
    cutouts: [
      { start: 20, end: 30 },
      { start: 50, end: 60 },
      { start: 70, end: 78 },
    ],
  };
  const preview = keepRangesFromEdit(edit, 100);
  const enc = keepRangesForEncode(edit, 100);
  assert.ok(preview.length >= 3 && enc.length === preview.length);
  for (let i = 0; i < enc.length; i++) {
    assert.ok(Math.abs(enc[i].start - preview[i].start) < 1e-9, `段${i} 起点一致`);
    assert.ok(Math.abs(enc[i].end - preview[i].end) < 1e-9, `段${i} 终点一致`);
  }
  assert.ok(Math.abs(enc[0].start - 5) < 1e-9, "片头=黄柄");
});

t("仅裁片头片尾：成片起点=黄柄，片尾半开与预览一致", () => {
  const { keepRangesFromEdit, keepRangesForEncode } = loadKeepFns();
  const edit = { trimStart: 10, trimEnd: 40, cutouts: [] };
  const preview = keepRangesFromEdit(edit, 60);
  const enc = keepRangesForEncode(edit, 60);
  assert.strictEqual(enc.length, 1);
  assert.ok(Math.abs(enc[0].start - preview[0].start) < 1e-9);
  assert.ok(Math.abs(enc[0].end - preview[0].end) < 1e-9);
  assert.ok(Math.abs(enc[0].start - 10) < 1e-9);
});

t("exportKeepVideo -ss 回退须两端再收，防少删", () => {
  const start = vtrim.indexOf("async function exportKeepVideo");
  const end = vtrim.indexOf("window.DevToolsVtrimEditor =", start);
  const exp = vtrim.slice(start, end > start ? end : undefined);
  assert.ok(exp.includes("if (!useTrim)"));
  assert.ok(/bias\s*=\s*1\s*\/\s*30/.test(exp));
});

t("ENCODE_BOUND_PAD_SEC=0（取消成片多删垫）", () => {
  assert.ok(/ENCODE_BOUND_PAD_SEC\s*=\s*0/.test(vtrim));
});

t("片尾抬手只用 min(want,…) 收紧，禁止推过拖点", () => {
  assert.ok(/Math\.min\(\s*want\s*,\s*Math\.max\(\s*fromShown/.test(vtrim));
  assert.ok(!/Math\.max\(\s*want\s*,\s*shown\s*\+\s*END_KEEP_SEC\s*\)/.test(vtrim));
});

t("有 srcFps 时半开 = 1/fps，且拖拽落点=播放 keep 尾=成片 keep 尾", () => {
  const box = {};
  const fromEdit = vtrim.match(/function keepRangesFromEdit\(edit, duration\) \{[\s\S]*?\n  \}/);
  const forEnc = vtrim.match(/function keepRangesForEncode\(edit, duration\) \{[\s\S]*?\n  \}/);
  const norm = vtrim.match(/function normalizeCutouts\([\s\S]*?\n  \}/);
  vm.runInNewContext(
    `
    const MIN_SPAN = 0.5, MIN_CUTOUT = 0.2;
    const END_KEEP_SEC = 1 / 25, START_KEEP_SEC = 1 / 50, ENCODE_BOUND_PAD_SEC = 0;
    ${norm[0]}
    ${fromEdit[0]}
    ${forEnc[0]}
    this.keepRangesFromEdit = keepRangesFromEdit;
    this.keepRangesForEncode = keepRangesForEncode;
    `,
    box
  );
  for (const fps of [24, 30, 60]) {
    const trimEnd = 10;
    const edit = { trimStart: 0, trimEnd, cutouts: [], srcFps: fps };
    const preview = box.keepRangesFromEdit(edit, 12);
    const enc = box.keepRangesForEncode(edit, 12);
    const dragSeek = trimEnd - 1 / fps; // endKeepSec()
    assert.strictEqual(preview.length, 1);
    assert.ok(Math.abs(preview[0].end - dragSeek) < 1e-9, `${fps}fps 播放 keep 尾 = 拖拽落点`);
    assert.ok(Math.abs(enc[0].end - dragSeek) < 1e-9, `${fps}fps 成片 keep 尾 = 拖拽落点`);
  }
  const noFps = box.keepRangesFromEdit({ trimStart: 0, trimEnd: 10, cutouts: [] }, 12);
  assert.ok(Math.abs(noFps[0].end - (10 - 1 / 25)) < 1e-9, "无 fps 回退 1/25");
});

console.log(`vbb-preview-encode-align.test.js: ${n} passed`);
