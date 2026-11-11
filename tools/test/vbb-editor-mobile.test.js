"use strict";

/** 手机编辑体验：触控文案、跳到接点（不自动播）、红柄命中区 */
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
  assert.ok(vtrim.includes("const coarseUi") || vtrim.includes("coarseUi ="));
  // 头副标题/删中间说明行已去掉省空间；按钮「跳到接点」仍保留
  assert.ok(vtrim.includes("跳到接点"));
  assert.ok(!vtrim.includes("拖红柄看该帧"));
  assert.ok(!vtrim.includes("点选红段后，用上方"));
});

t("手机送手防抖：抬手前采样 + 成片时钟吸附 + 反馈", () => {
  assert.ok(vtrim.includes("LIFT_LAG_MS"));
  assert.ok(vtrim.includes("FRAME_SNAP_SEC"));
  assert.ok(vtrim.includes("frameSnapSecFromFps") || vtrim.includes("DEFAULT_FRAME_FPS"));
  assert.ok(vtrim.includes("function dragSecBeforeLift"));
  assert.ok(vtrim.includes("function snapToFrameGrid"));
  assert.ok(vtrim.includes("function snapToEncodeClock"));
  assert.ok(vtrim.includes("function snapNearCutouts"));
  assert.ok(vtrim.includes("function flashSnapFeedback"));
  assert.ok(vtrim.includes("pushDragSample"));
  const finish = vtrim.slice(
    vtrim.indexOf("async function finishTrimDrag"),
    vtrim.indexOf("function ratioFromClientX")
  );
  assert.ok(finish.includes("dragSecBeforeLift"));
  assert.ok(finish.includes("snapTrimHandle") || finish.includes("snapToEncodeClock"));
  assert.ok(finish.includes("成片时钟吸附") || finish.includes("flashSnapFeedback"));
  assert.ok(finish.includes("flashSnapFeedback"));
});

t("预览轻点不 toggle 播放（只用底部按钮）", () => {
  const block = vtrim.slice(
    vtrim.indexOf("previewWrap?.addEventListener(\"pointerup\""),
    vtrim.indexOf("previewWrap?.addEventListener(\"pointercancel\"")
  );
  assert.ok(block.includes("不 toggle") || block.includes("不 toggle 播放"));
  assert.ok(!block.includes("togglePlay"));
});

t("删中间「跳到接点」只 seek、不 video.play；起始/结尾交替", () => {
  assert.ok(vtrim.includes("跳到接点"));
  assert.ok(vtrim.includes("async function seekCutJoinPreview"));
  const fn = vtrim.slice(
    vtrim.indexOf("async function seekCutJoinPreview"),
    vtrim.indexOf("function deleteSelectedCutout")
  );
  assert.ok(fn.includes("cutJoinVisit"));
  assert.ok(fn.includes("起始接点"));
  assert.ok(fn.includes("结尾接点"));
  assert.ok(fn.includes("seekRawExact"), "接点须 raw seek，勿被 keep 重映射");
  assert.ok(fn.includes("video.pause()"));
  assert.ok(!fn.includes("video.play("), "跳到接点不得自动播放");
});

t("删中间起点+/终点+：非拖拽走 seekRawExact，避免进度卡住", () => {
  const fn = vtrim.slice(
    vtrim.indexOf("function setCutoutEdge"),
    vtrim.indexOf("function nudgeSelectedCutout")
  );
  assert.ok(fn.includes("seekRawExact"));
  assert.ok(fn.includes("scrubSeekInflight = false"));
  assert.ok(fn.includes("if (drag)"));
  assert.ok(vtrim.includes("ensureSelectedCutout"), "± 须能自动选红段");
  const sync = vtrim.slice(vtrim.indexOf("function syncCutoutUi"), vtrim.indexOf("function ensureSelectedCutout"));
  assert.ok(!/btn\.disabled\s*=\s*!hasSel/.test(sync), "± 勿因未选中 disabled");
});

t("编辑层去掉中间播放钮", () => {
  assert.ok(!/id=\$\{p\("tap-play"\)\}/.test(vtrim) && !vtrim.includes('id="${p("tap-play")}"'));
  assert.ok(css.includes(".vtrim-editor-overlay .vtrim-tap-play"));
  assert.ok(/display:\s*none\s*!important/.test(css));
});

t("手机加高编辑层时间轴、放大红柄命中", () => {
  assert.ok(/height:\s*68px/.test(css));
  assert.ok(css.includes(".vtrim-cutout-handle::before"));
  assert.ok(/width:\s*44px/.test(css));
});

t("对齐修复仍在（预览=成片）", () => {
  assert.ok(vtrim.includes("keepRangesForEncode"));
  assert.ok(vtrim.includes("ENCODE_BOUND_PAD_SEC"));
});

console.log(`vbb-editor-mobile.test.js: ${n} passed`);
