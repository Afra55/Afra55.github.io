"use strict";

/**
 * 片尾：编辑停帧 ≡ 外预览/播放截断；拖拽步进 ≡ 按钮 1 源帧。
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

t("播放在末帧后半提前截断，暂停可停在末帧起点", () => {
  const seek = loadSeek();
  const keeps = [{ start: 1, end: 5 }];
  const ek = 1 / 30;
  const lastStart = 5 - ek;
  assert.strictEqual(seek(keeps, lastStart, { paused: true, endKeepSec: ek }), null);
  assert.strictEqual(seek(keeps, lastStart + ek * 0.2, { paused: true, endKeepSec: ek }), null);
  // 播放：越过 end-0.75帧 须循环
  const playCut = seek(keeps, 5 - ek * 0.2, { paused: false, endKeepSec: ek });
  assert.ok(playCut != null && Math.abs(playCut - 1) < 1e-9);
  // 暂停贴 exclusive end → 拉回末帧
  const park = seek(keeps, 5, { paused: true, endKeepSec: ek });
  assert.ok(park != null && Math.abs(park - lastStart) < 1e-9);
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

t("外预览 enforce：越过片尾不吞，仅容忍偏早关键帧", () => {
  const enforce = vbb.slice(
    vbb.indexOf("function enforceVbbEditPlaybackWindow"),
    vbb.indexOf("function armVbbEditFrameWatch")
  );
  assert.ok(enforce.includes("earlySlop"));
  assert.ok(enforce.includes("pastSlop"));
  assert.ok(enforce.includes("delta >= 0"));
  assert.ok(!/Math\.abs\(t - next\) < nearSlop/.test(enforce));
});

console.log(`vbb-end-play-align.test.js: ${n} passed`);
