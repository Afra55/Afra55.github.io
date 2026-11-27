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
  const lift = vtrim.slice(
    vtrim.indexOf("function dragSecBeforeLift"),
    vtrim.indexOf("function flashSnapFeedback")
  );
  assert.ok(lift.includes("samples[samples.length - 1]"), "短拖要用最近采样");
  assert.ok(lift.includes("0.12"), "回看点离松手太远时不能弹回按下位置");
  assert.ok(!lift.includes("return samples[0]"));
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
    vtrim.indexOf("function onPreviewPointerUp"),
    vtrim.indexOf("previewWrap?.addEventListener(\"pointerdown\", onPreviewPointerDown)")
  );
  assert.ok(block.includes("不 toggle") || block.includes("不 toggle 播放"));
  assert.ok(!block.includes("togglePlay"));
});

t("编辑器按 BUILD 覆盖旧 open（防粘坏版本）", () => {
  assert.ok(vtrim.includes("EDITOR_REV"));
  assert.ok(vtrim.includes("__rev"));
  assert.ok(vtrim.includes("DevToolsVtrimEditor.__rev === EDITOR_REV") || vtrim.includes("__rev === EDITOR_REV"));
});

t("后台校准勿在拖/点时 rematch 黄柄", () => {
  const rematch = vtrim.slice(
    vtrim.indexOf("function rematchHandlesAfterCalibrate"),
    vtrim.indexOf("async function calibrateSourceTimelineToEditorVideo")
  );
  assert.ok(rematch.includes("parkHoldPause"), "用户微调中禁止 rematch");
  assert.ok(rematch.includes("drag") && rematch.includes("previewScrub"));
  const calib = vtrim.slice(
    vtrim.indexOf("async function calibrateSourceTimelineToEditorVideo"),
    vtrim.indexOf("async function detectAndApplySourceTimeline")
  );
  assert.ok(calib.includes("parkHoldPause") || calib.includes("if (drag"));
});

t("paused seek 的 rVFC 超时不能当成已经画出", () => {
  const fn = vtrim.slice(vtrim.indexOf("async function forcePreviewFrame"), vtrim.indexOf("function tryPointerCapture"));
  assert.ok(fn.includes("fromRvfc"), "超时和真正的 rVFC 要分开");
  assert.ok(fn.includes("if (fromRvfc) return"));
  assert.ok(fn.includes("videoEl.play()"), "rVFC 不来时要短 play 踢帧");
});

t("片头片尾接受触摸 button=-1，metadata 错过时仍读 duration", () => {
  const bindAt = vtrim.indexOf("function bindNudgeHold");
  const bind = vtrim.slice(bindAt, vtrim.indexOf("bindNudgeHold(", bindAt + 24));
  assert.ok(bind.includes("e.button > 0"), "只忽略右键；button=-1 仍要步进");
  assert.ok(!bind.includes("e.button !== 0"));
  assert.ok(vtrim.includes("if (video.readyState >= 1) onMeta()"));
  const down = vtrim.slice(
    vtrim.indexOf("function onTimelinePointerDown"),
    vtrim.indexOf("function onTimelinePointerMove")
  );
  assert.ok(down.includes("Number(video.duration)"));
});

t("黄柄按下先改位置，setPointerCapture 抛错不能跳过 setStart", () => {
  assert.ok(vtrim.includes("function tryPointerCapture"));
  const down = vtrim.slice(
    vtrim.indexOf("function onTimelinePointerDown"),
    vtrim.indexOf("function onTimelinePointerMove")
  );
  assert.ok(!down.includes(".setPointerCapture"), "pointerdown 里不要裸调 setPointerCapture");
  assert.ok(down.includes("tryPointerCapture(handleStart"));
  assert.ok(down.includes("tryPointerCapture(handleEnd"));
  const startBlock = down.slice(down.indexOf('kind === "start"'), down.indexOf('kind === "end"'));
  assert.ok(startBlock.indexOf("setStart(t)") < startBlock.indexOf("tryPointerCapture(handleStart"));
  const endBlock = down.slice(down.indexOf('kind === "end"'), down.indexOf('kind === "window"'));
  assert.ok(endBlock.indexOf("setEnd(t)") < endBlock.indexOf("tryPointerCapture(handleEnd"));
  const helper = vtrim.slice(vtrim.indexOf("function tryPointerCapture"), vtrim.indexOf("function hapticLight"));
  assert.ok(helper.includes("catch"));
});

t("微调 click 兜底不在 pointerdown 之后再步进一次", () => {
  const bindStart = vtrim.indexOf("function bindNudgeHold");
  const bind = vtrim.slice(bindStart, vtrim.indexOf("nudgeStartM", bindStart));
  assert.ok(bind.includes("pointerStepped"));
  assert.ok(bind.includes("if (armed || pointerStepped)"));
});

t("拖拽/滑画面：window 跟指针，忽略按下瞬间的假 pointercancel", () => {
  assert.ok(vtrim.includes("function spuriousPointerCancel"));
  const up = vtrim.slice(
    vtrim.indexOf("function onTimelinePointerUp"),
    vtrim.indexOf("timeline?.addEventListener(\"pointerdown\"")
  );
  assert.ok(up.includes("spuriousPointerCancel"));
  assert.ok(vtrim.includes('window.addEventListener("pointermove", onTimelinePointerMove, true)'));
  assert.ok(vtrim.includes('window.addEventListener("pointermove", onPreviewPointerMove, true)'));
  assert.ok(vtrim.includes("if (parkHoldPause || drag || previewScrub)"));
  const cssNudge = css.slice(css.indexOf(".vtrim-nudge {"), css.indexOf(".vtrim-nudge {") + 280);
  assert.ok(/touch-action:\s*none/.test(cssNudge), "微调长按不要被滚动抢走");
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
  assert.ok(fn.includes("if (drag") || fn.includes("if (drag || soft)"), "拖/长按走 soft preview");
  assert.ok(vtrim.includes("ensureSelectedCutout"), "± 须能自动选红段");
  const sync = vtrim.slice(vtrim.indexOf("function syncCutoutUi"), vtrim.indexOf("function ensureSelectedCutout"));
  assert.ok(!/btn\.disabled\s*=\s*!hasSel/.test(sync), "± 勿因未选中 disabled");
  // 松手勿再 floor 吸附，否则 + 会被吸回上一帧
  const snap = vtrim.slice(
    vtrim.indexOf("async function snapCutNudgeToShown"),
    vtrim.indexOf("function syncAspectUi")
  );
  assert.ok(snap.includes("seekRawExact"), "松手只停端点");
  assert.ok(!snap.includes("snapToEncodeClock"), "松手勿 floor 吸附 undo +");
  assert.ok(fn.includes("cutouts[index + 1]") || fn.includes("index < cutouts.length - 1"), "多段终点勿并段");
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
