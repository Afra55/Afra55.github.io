"use strict";

/** 片尾±停帧 ≡ 播放截断点（所见即所得）；根因修复，禁止盲目减帧 */
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
  const p = vtrim.match(
    /function previewSeekForKeepRanges\(keeps, t, opts\) \{[\s\S]*?return first\.start \+ DISPLAY_SEEK_EPS;\s*\}/
  );
  assert.ok(p);
  const box = {};
  vm.runInNewContext(
    `
    const DISPLAY_SEEK_EPS = 1e-4;
    function resolveEndKeepSec() { return 1 / 30; }
    ${p[0]}
    this.fn = previewSeekForKeepRanges;
    `,
    box
  );
  return box.fn;
}

t("末帧播完再回绕；暂停停在帧内而不是裸 CTS", () => {
  const seek = loadSeek();
  const keeps = [{ start: 1, end: 5 }];
  const ek = 1 / 30;
  const lastStart = 5 - ek;
  assert.strictEqual(seek(keeps, lastStart, { paused: true, endKeepSec: ek }), null);
  // 末帧 CTS 仍在半开窗内。在这里回绕会先闪这一帧，seek 再画一次
  assert.strictEqual(seek(keeps, lastStart, { paused: false, endKeepSec: ek }), null);
  assert.strictEqual(seek(keeps, lastStart + ek * 0.4, { paused: false, endKeepSec: ek }), null);
  assert.strictEqual(seek(keeps, lastStart - ek * 0.5, { paused: false, endKeepSec: ek }), null);
  const atEnd = seek(keeps, 5, { paused: false, endKeepSec: ek });
  assert.ok(atEnd != null && Math.abs(atEnd - (1 + 1e-4)) < 1e-9);
  const park = seek(keeps, 5, { paused: true, endKeepSec: ek });
  assert.ok(park != null && park > lastStart + ek * 0.15 && park < 5 - 1e-4);
});

t("clipPlayWindow 在半开上界回绕，不在末帧 CTS 上截断", () => {
  const fn = vtrim.slice(vtrim.indexOf("function mediaTimeForCut"), vtrim.indexOf("function armFrameWatch"));
  assert.ok(fn.includes("playCutParkSec()"));
  assert.ok(fn.includes("exclusivePlayEndSec"));
  assert.ok(!fn.includes("cur >= park - 1e-4"));
  assert.ok(!fn.includes("park - step +"));
  assert.ok(fn.includes("video.pause()"));
  assert.ok(!fn.includes("video.currentTime = park"));
  assert.ok(fn.includes("freezeClockSec"));
  assert.ok(fn.includes("presented - clock"));
});

t("停帧记录 endParkAtSec；只在末帧这一格预约切断", () => {
  assert.ok(vtrim.includes("let endParkAtSec"));
  assert.ok(/endParkAtSec = (shown|Number\.isFinite)/.test(vtrim) || vtrim.includes("endParkAtSec ="));
  assert.ok(vtrim.includes("parkCutTimer"));
  assert.ok(vtrim.includes("remain <= step * 1.05"));
  const arm = vtrim.slice(vtrim.indexOf("function armFrameWatch"), vtrim.indexOf("async function togglePlay"));
  assert.ok(arm.includes("clipPlayWindow(exclusive)"));
  assert.ok(!arm.includes("clipPlayWindow(park)"));
});

t("播放放到半开终点，暂停停进末帧内部（不贴裸 CTS，不提前整帧）", () => {
  assert.ok(!vtrim.includes("playEndPad = Math.max(endEps, endKeep)"));
  assert.ok(!vtrim.includes("playEndPad = Math.max(endEps, endKeep * 2)"));
  assert.ok(vtrim.includes("ctsApprox"));
  const fallback = vbb.slice(
    vbb.indexOf("function vbbPreviewSeekForKeepRanges"),
    vbb.indexOf("function vbbKeepRangesFromEdit")
  );
  assert.ok(fallback.includes("ctsApprox"));
  assert.ok(!fallback.includes("endKeep * 2"));
  assert.ok(!fallback.includes("k.end - playEndPad"));
});

t("seekEndPreviewExact 停成片 CTS，不改写 endSec（片尾+ 不被顶死）", () => {
  assert.ok(vtrim.includes("function encodeParkSecForEdge"));
  const fn = vtrim.slice(
    vtrim.indexOf("async function seekEndPreviewExact"),
    vtrim.indexOf("async function seekStartPreviewExact")
  );
  assert.ok(fn.includes("encodeParkSecForEdge(\"end\")") || fn.includes('encodeParkSecForEdge("end")'));
  assert.ok(fn.includes("endParkAtSec"));
  assert.ok(!fn.includes("endSec = quantizeTrimSec"));
  assert.ok(!fn.includes("shown + step"));
});

t("外预览播放态 pastSlop=0，不吞片尾越过", () => {
  const enforce = vbb.slice(
    vbb.indexOf("function enforceVbbEditPlaybackWindow"),
    vbb.indexOf("function scheduleVbbEditEndCut")
  );
  assert.ok(enforce.includes("vbbLastPresentedMediaTime") || enforce.includes("presented"));
  assert.ok(/pastSlop = vbbVideo\.paused \?/.test(enforce));
  assert.ok(enforce.includes("presented - clock"));
  assert.ok(enforce.includes("vbbLastPresentedMediaTime = NaN"));
});

t("外预览只在末帧这一格预约切断", () => {
  const fn = vbb.slice(
    vbb.indexOf("function scheduleVbbEditEndCut"),
    vbb.indexOf("function armVbbEditFrameWatch")
  );
  assert.ok(fn.includes("remain <= step * 1.05"));
  assert.ok(fn.includes("enforceVbbEditPlaybackWindow(end)"));
});

console.log(`vbb-end-play-align.test.js: ${n} passed`);
