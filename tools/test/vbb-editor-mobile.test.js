"use strict";

/** 手机编辑体验：触控文案、播放接点、红柄命中区 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const vtrim = fs.readFileSync(path.join(__dirname, "..", "lib", "vtrim-editor.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "styles", "panels", "vtrim.css"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("粗指针/窄屏用触控文案，不主推键盘", () => {
  assert.ok(vtrim.includes("pointer: coarse"));
  assert.ok(vtrim.includes("点画面播放"));
  assert.ok(vtrim.includes("拖黄柄/红段"));
  assert.ok(vtrim.includes("点「播放接点」核对"));
});

t("删中间有「播放接点」按钮（手机无空格）", () => {
  assert.ok(vtrim.includes('id="${p("cut-play-join")}"') || vtrim.includes("cut-play-join"));
  assert.ok(vtrim.includes("async function playCutJoinPreview"));
  assert.ok(vtrim.includes("正在播放接点（与成片一致）"));
  assert.ok(vtrim.includes("cutPlayJoinBtn"));
});

t("手机加高编辑层时间轴、放大红柄命中", () => {
  assert.ok(css.includes("height: 68px") || /height:\s*68px/.test(css));
  assert.ok(css.includes(".vtrim-cutout-handle::before"));
  assert.ok(/width:\s*44px/.test(css));
  assert.ok(css.includes("min-height: 2.85rem") || css.includes("min-height:2.85rem"));
});

t("对齐修复仍在（预览=成片）", () => {
  assert.ok(vtrim.includes("keepRangesForEncode"));
  assert.ok(vtrim.includes("ENCODE_BOUND_PAD_SEC"));
});

console.log(`vbb-editor-mobile.test.js: ${n} passed`);
