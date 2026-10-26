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
    const END_KEEP_SEC = 1 / 25, START_KEEP_SEC = 1 / 50, ENCODE_BOUND_PAD_SEC = 2 / 30;
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

t("成片 keep ⊆ 预览 keep：多段删中间两端更紧，不越过预览", () => {
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
  assert.ok(enc[0].start >= preview[0].start - 1e-9, "成片片头不得早于预览");
  for (let i = 0; i < enc.length; i++) {
    assert.ok(enc[i].start >= preview[i].start - 1e-9, `段${i} 起点`);
    assert.ok(enc[i].end <= preview[i].end + 1e-9, `段${i} 终点不得越过预览`);
  }
  // 边界垫加严后，接点应比旧 1/25 更收
  assert.ok(enc[0].end <= 20 - 1 / 25 - 2 / 30 + 1e-6, "上一段终点须含 bound pad");
  assert.ok(enc[1].start >= 30 + 1 / 25 + 1 / 50 + 2 / 30 - 1e-6, "下一段起点须含 bound pad");
});

t("仅裁片头片尾：成片片头加垫且片尾不越过预览半开", () => {
  const { keepRangesFromEdit, keepRangesForEncode } = loadKeepFns();
  const edit = { trimStart: 10, trimEnd: 40, cutouts: [] };
  const preview = keepRangesFromEdit(edit, 60);
  const enc = keepRangesForEncode(edit, 60);
  assert.strictEqual(enc.length, 1);
  assert.ok(enc[0].start >= preview[0].start + 1 / 50 - 1e-6);
  assert.ok(enc[0].end <= preview[0].end + 1e-6);
});

t("exportKeepVideo -ss 回退须两端再收，防少删", () => {
  const start = vtrim.indexOf("async function exportKeepVideo");
  const end = vtrim.indexOf("window.DevToolsVtrimEditor =", start);
  const exp = vtrim.slice(start, end > start ? end : undefined);
  assert.ok(exp.includes("if (!useTrim)"));
  assert.ok(/bias\s*=\s*1\s*\/\s*30/.test(exp));
});

t("暴露 ENCODE_BOUND_PAD_SEC 供外层 fallback", () => {
  assert.ok(vtrim.includes("ENCODE_BOUND_PAD_SEC"));
  const api = vtrim.slice(vtrim.indexOf("window.DevToolsVtrimEditor ="));
  assert.ok(api.includes("ENCODE_BOUND_PAD_SEC"));
});

console.log(`vbb-preview-encode-align.test.js: ${n} passed`);
