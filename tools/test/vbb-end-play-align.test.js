"use strict";

/**
 * 片尾：编辑停帧 ≡ 播放截断；拖拽 ≡ 按钮 1 源帧；播放须先 pause 再 seek。
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

t("暂停可停在末帧；播放在停帧处截断", () => {
  const seek = loadSeek();
  const keeps = [{ start: 1, end: 5 }];
  const ek = 1 / 30;
  const lastStart = 5 - ek;
  assert.strictEqual(seek(keeps, lastStart, { paused: true, endKeepSec: ek }), null);
  assert.strictEqual(seek(keeps, lastStart + ek * 0.2, { paused: true, endKeepSec: ek }), null);
  // 播放：到达停帧即循环（endLimit = end - endKeep）
  const atPark = seek(keeps, lastStart, { paused: false, endKeepSec: ek });
  assert.ok(atPark != null && Math.abs(atPark - 1) < 1e-9);
  const pastPark = seek(keeps, lastStart + ek * 0.5, { paused: false, endKeepSec: ek });
  assert.ok(pastPark != null && Math.abs(pastPark - 1) < 1e-9);
  // 停帧前一帧仍可播
  assert.strictEqual(seek(keeps, lastStart - ek * 0.5, { paused: false, endKeepSec: ek }), null);
  const park = seek(keeps, 5, { paused: true, endKeepSec: ek });
  assert.ok(park != null && Math.abs(park - lastStart) < 1e-9);
});

t("编辑内 clipPlayWindow 先 pause、钉停帧、finally 必清 looping", () => {
  const fn = vtrim.slice(vtrim.indexOf("function clipPlayWindow"), vtrim.indexOf("function armFrameWatch"));
  assert.ok(fn.includes("video.pause()"));
  assert.ok(fn.includes("endKeepSec()"));
  assert.ok(fn.includes("seekPlayheadExact(jump)"));
  assert.ok(fn.includes("video.currentTime = park"));
  assert.ok(fn.includes("finally"));
  assert.ok(fn.includes("playWindowLooping = false"));
  assert.ok(fn.includes("armFrameWatch()"));
  assert.ok(fn.includes("永久短路") || fn.includes("第 3 遍"));
});

t("拖拽中用 snapTrimHandle（与按钮同帧格）", () => {
  const move = vtrim.slice(
    vtrim.indexOf("function onTimelinePointerMove"),
    vtrim.indexOf("function onTimelinePointerUp")
  );
  assert.ok(move.includes('snapTrimHandle(raw, "end")'));
  assert.ok(move.includes('snapTrimHandle(raw, "start")'));
  assert.ok(!/snapNearCutouts\(snapEdgeOnly\(raw/.test(move));
});

t("外预览 enforce：越过片尾先 pause，keepPlaying 不带播 seek", () => {
  const enforce = vbb.slice(
    vbb.indexOf("function enforceVbbEditPlaybackWindow"),
    vbb.indexOf("function armVbbEditFrameWatch")
  );
  assert.ok(enforce.includes("earlySlop"));
  assert.ok(enforce.includes("pastSlop"));
  assert.ok(enforce.includes("vbbVideo.pause()"));
  assert.ok(enforce.includes("keepPlaying: false"));
  assert.ok(!/applyVbbSeek\(next, \{ keepPlaying: true \}\)/.test(enforce));
});

console.log(`vbb-end-play-align.test.js: ${n} passed`);
