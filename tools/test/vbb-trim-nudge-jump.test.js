"use strict";

/**
 * 片头+/片尾−：未改动时不得一次跳数秒（空尾巴 / exclusive 误吸 lastCts）。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const vtrim = fs.readFileSync(path.join(__dirname, "..", "lib", "vtrim-editor.js"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

function loadHelpers() {
  const start = vtrim.indexOf("function alignTrimSecToSamples");
  const end = vtrim.indexOf("const DRAG_SEEK_MS");
  assert.ok(start > 0 && end > start);
  const box = {};
  vm.runInNewContext(
    `
    const DEFAULT_FRAME_FPS = 30;
    ${vtrim.slice(start, end)}
    this.contentExclusiveEndSec = contentExclusiveEndSec;
    this.snapExclusiveEndSec = snapExclusiveEndSec;
    `,
    box
  );
  return box;
}

function sampleIndexAtSec(timeline, sec) {
  const arr = timeline.ctsSec;
  const t = Math.max(0, Number(sec) || 0);
  let lo = 0;
  let hi = arr.length - 1;
  let ans = 0;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= t + 1e-9) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

t("导出 contentExclusiveEndSec / snapExclusiveEndSec", () => {
  assert.ok(vtrim.includes("function contentExclusiveEndSec"));
  assert.ok(vtrim.includes("function snapExclusiveEndSec"));
  assert.ok(vtrim.includes("contentExclusiveEndSec,"));
  assert.ok(vtrim.includes("snapExclusiveEndSec,"));
});

t("容器空尾巴：contentEnd 收到片源轨末，不钉 duration", () => {
  const { contentExclusiveEndSec } = loadHelpers();
  const cts = new Float64Array(30 * 60); // 60s @30fps
  for (let i = 0; i < cts.length; i++) cts[i] = i / 30;
  const tl = { ctsSec: cts, fps: 30 };
  const end = contentExclusiveEndSec(tl, 70); // Chrome duration 多 10s
  const last = cts[cts.length - 1];
  assert.ok(end > last && end < 60.05, `end=${end} last=${last}`);
  assert.ok(end < 65, "不得停在空尾巴上");
});

t("无空尾：contentEnd 保留接近 last 的 duration", () => {
  const { contentExclusiveEndSec } = loadHelpers();
  const cts = new Float64Array(30 * 10);
  for (let i = 0; i < cts.length; i++) cts[i] = i / 30;
  const last = cts[cts.length - 1];
  const dur = last + 1 / 30;
  const end = contentExclusiveEndSec({ ctsSec: cts, fps: 30 }, dur);
  assert.ok(Math.abs(end - dur) < 1e-9, `end=${end} dur=${dur}`);
});

t("exclusive 吸附 duration 空尾 → contentEnd，禁止 last inclusive CTS", () => {
  const { snapExclusiveEndSec, contentExclusiveEndSec } = loadHelpers();
  const cts = new Float64Array(30 * 60);
  for (let i = 0; i < cts.length; i++) cts[i] = i / 30;
  const tl = { ctsSec: cts, fps: 30 };
  const last = cts[cts.length - 1];
  const snapped = snapExclusiveEndSec(tl, 70, 70, sampleIndexAtSec);
  const content = contentExclusiveEndSec(tl, 70);
  assert.ok(Math.abs(snapped - content) < 1e-9, `snapped=${snapped}`);
  assert.ok(Math.abs(snapped - last) > 1e-3, "不得吸成 lastCts（会少最后一帧）");
});

t("校准 rematch / 拖柄 / nudge 走 exclusive 片尾", () => {
  assert.ok(vtrim.includes('snapToEncodeClock(endSec, { exclusive: true })'));
  assert.ok(vtrim.includes("exclusive: which === \"end\"") || vtrim.includes("exclusive: which === 'end'"));
  assert.ok(vtrim.includes("tightenTrimToContentTimeline"));
  assert.ok(vtrim.includes("音轨/空尾巴") || vtrim.includes("空尾巴"));
  const nudge = vtrim.slice(
    vtrim.indexOf("function nudgeTrimEdgeSec"),
    vtrim.indexOf("function syncSharedNudgeLabels")
  );
  assert.ok(nudge.includes("contentExclusiveEndSec"));
  assert.ok(nudge.includes("maxStep"));
});

t("片尾− 在空尾巴上先收 contentEnd（源码契约）", () => {
  const nudge = vtrim.slice(
    vtrim.indexOf("function nudgeTrimEdgeSec"),
    vtrim.indexOf("function syncSharedNudgeLabels")
  );
  assert.ok(nudge.includes("endSec > contentEnd"));
  assert.ok(nudge.includes("return clamp(contentEnd"));
});

t("红柄拖/松手走 cut-start|cut-end，禁止复用黄柄 exclusive", () => {
  const snap = vtrim.slice(
    vtrim.indexOf("function snapTrimHandle"),
    vtrim.indexOf("function snapTrimHandle") + 900
  );
  assert.ok(snap.includes('"cut-start"') || snap.includes("'cut-start'"));
  assert.ok(snap.includes('"cut-end"') || snap.includes("'cut-end'"));
  assert.ok(snap.includes("cutClosed"));
  assert.ok(/exclusive:\s*which\s*===\s*["']end["']\s*&&\s*!cutClosed/.test(snap));
  // 拖动中
  assert.ok(vtrim.includes('snapTrimHandle(raw, "cut-start")') || vtrim.includes("snapTrimHandle(raw, 'cut-start')"));
  assert.ok(vtrim.includes('snapTrimHandle(raw, "cut-end")') || vtrim.includes("snapTrimHandle(raw, 'cut-end')"));
  // 松手 finish
  const finish = vtrim.slice(
    vtrim.indexOf("async function finishTrimDrag"),
    vtrim.indexOf("function onTimelinePointerDown")
  );
  assert.ok(finish.includes('"cut-end"') || finish.includes("'cut-end'"));
  assert.ok(finish.includes('"cut-start"') || finish.includes("'cut-start'"));
});

t("红柄 ± 步进有 maxStep 护栏", () => {
  const cut = vtrim.slice(
    vtrim.indexOf("function nudgeSelectedCutout"),
    vtrim.indexOf("async function snapCutNudgeToShown")
  );
  assert.ok(cut.includes("maxStep"));
  assert.ok(cut.includes("nudgeEncodeSec"));
});

t("微调 pointerdown 钉 parkHoldPause，禁止一点就播放", () => {
  assert.ok(vtrim.includes("parkHoldPause"));
  const bindStart = vtrim.indexOf("function bindNudgeHold");
  const bind = vtrim.slice(bindStart, vtrim.indexOf("nudgeStartM,", bindStart));
  assert.ok(bind.includes("parkHoldPause = true"));
  assert.ok(bind.includes("video.pause()"));
  const clip = vtrim.slice(vtrim.indexOf("function clipPlayWindow"), vtrim.indexOf("function armFrameWatch"));
  assert.ok(clip.includes("if (parkHoldPause) return false") || clip.includes("parkHoldPause) return false"));
});

t("rematch 红柄默认 sampleIndexAtSec，黄柄片尾仍 exclusive", () => {
  const rematch = vtrim.slice(
    vtrim.indexOf("function rematchHandlesAfterCalibrate"),
    vtrim.indexOf("async function calibrateSourceTimelineToEditorVideo")
  );
  assert.ok(rematch.includes('snapToEncodeClock(endSec, { exclusive: true })'));
  // 红柄两行不得带 exclusive/inclusive
  const cutMap = rematch.slice(rematch.indexOf("cutouts = cutouts.map"), rematch.indexOf("clipCutoutsToWindow"));
  assert.ok(!/snapToEncodeClock\([^)]*exclusive/.test(cutMap));
  assert.ok(!/snapToEncodeClock\([^)]*inclusive/.test(cutMap));
});

console.log(`vbb-trim-nudge-jump.test.js: ${n} passed`);
