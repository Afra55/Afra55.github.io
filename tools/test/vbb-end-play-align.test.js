"use strict";

/** 片尾±停帧 ≡ 播放截断点（所见即所得） */
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

function loadSeek() {
  const p = vtrim.match(/function previewSeekForKeepRanges\(keeps, t, opts\) \{[\s\S]*?return first\.start;\s*\}/);
  assert.ok(p);
  const box = {};
  vm.runInNewContext(
    `
    function resolveEndKeepSec() { return 1 / 30; }
    ${p[0]}
    this.fn = previewSeekForKeepRanges;
    `,
    box
  );
  return box.fn;
}

t("停帧与播放截断同一点 end-1/fps", () => {
  const seek = loadSeek();
  const keeps = [{ start: 1, end: 5 }];
  const ek = 1 / 30;
  const lastStart = 5 - ek;
  assert.strictEqual(seek(keeps, lastStart, { paused: true, endKeepSec: ek }), null);
  // 播放到达停帧即循环（playEndPad = endKeep）
  const atPark = seek(keeps, lastStart, { paused: false, endKeepSec: ek });
  assert.ok(atPark != null && Math.abs(atPark - 1) < 1e-9);
  // 停帧前仍可播
  assert.strictEqual(seek(keeps, lastStart - ek * 0.5, { paused: false, endKeepSec: ek }), null);
  const park = seek(keeps, 5, { paused: true, endKeepSec: ek });
  assert.ok(park != null && Math.abs(park - lastStart) < 1e-9);
});

t("clipPlayWindow 硬闸用 park 而非 park-step", () => {
  const fn = vtrim.slice(vtrim.indexOf("function clipPlayWindow"), vtrim.indexOf("function armFrameWatch"));
  assert.ok(fn.includes("cur >= park - 1e-4"));
  assert.ok(!fn.includes("park - step +"));
  assert.ok(fn.includes("video.pause()"));
  assert.ok(!fn.includes("video.currentTime = park"));
  assert.ok(fn.includes("片尾±停帧同一点") || fn.includes("点片尾所见"));
});

t("playEndPad 为 1×endKeep（与停帧对齐）", () => {
  assert.ok(vtrim.includes("playEndPad = Math.max(endEps, endKeep)"));
  assert.ok(!vtrim.includes("playEndPad = Math.max(endEps, endKeep * 2)"));
  const fallback = vbb.slice(
    vbb.indexOf("function vbbPreviewSeekForKeepRanges"),
    vbb.indexOf("function vbbKeepRangesFromEdit")
  );
  assert.ok(fallback.includes("Math.max(endEps, endKeep)"));
  assert.ok(!fallback.includes("endKeep * 2"));
});

console.log(`vbb-end-play-align.test.js: ${n} passed`);
