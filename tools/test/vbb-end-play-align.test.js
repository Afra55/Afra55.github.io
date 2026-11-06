"use strict";

/**
 * 片尾：暂停停末帧；播放提前 1 源帧截断（防解码超前多画）。
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

t("暂停可停在末帧；播放在停帧前一帧截断", () => {
  const seek = loadSeek();
  const keeps = [{ start: 1, end: 5 }];
  const ek = 1 / 30;
  const lastStart = 5 - ek;
  assert.strictEqual(seek(keeps, lastStart, { paused: true, endKeepSec: ek }), null);
  // 播放：endLimit = end - 2/fps → 到达停帧即循环
  const atPark = seek(keeps, lastStart, { paused: false, endKeepSec: ek });
  assert.ok(atPark != null && Math.abs(atPark - 1) < 1e-9);
  // 停帧再往前超过 1 帧才仍可播（播放 endLimit = end-2/fps）
  assert.strictEqual(seek(keeps, lastStart - ek * 1.1, { paused: false, endKeepSec: ek }), null);
  const park = seek(keeps, 5, { paused: true, endKeepSec: ek });
  assert.ok(park != null && Math.abs(park - lastStart) < 1e-9);
});

t("clipPlayWindow：提前截断、先 pause、无钉回 park、finally 清 looping", () => {
  const fn = vtrim.slice(vtrim.indexOf("function clipPlayWindow"), vtrim.indexOf("function armFrameWatch"));
  assert.ok(fn.includes("video.pause()"));
  assert.ok(fn.includes("park - step"));
  assert.ok(!fn.includes("video.currentTime = park"));
  assert.ok(fn.includes("finally"));
  assert.ok(fn.includes("playWindowLooping = false"));
  assert.ok(fn.includes("钉回 park 反而") || fn.includes("解码画面常超前"));
});

t("外预览 playEndPad 为 2×endKeep", () => {
  const fallback = vbb.slice(
    vbb.indexOf("function vbbPreviewSeekForKeepRanges"),
    vbb.indexOf("function vbbKeepRangesFromEdit")
  );
  assert.ok(fallback.includes("endKeep * 2"));
});

console.log(`vbb-end-play-align.test.js: ${n} passed`);
