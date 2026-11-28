"use strict";

/**
 * 片头±/片尾±/红柄±：每点一下 = keep 半开窗换一个真实源帧（≡ 预览 ≡ GIF）。
 * 录屏 VFR 静帧也照跳；禁止 maxStep 退成 1/fps 时间步（时间变、画面不变）。
 * 容器空尾巴（音轨更长）：打开即收到片源轨末，片尾− 不再一次跳十几秒。
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
const mp4Src = fs.readFileSync(path.join(__dirname, "..", "lib", "mp4-timeline.js"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

function loadMp4Api() {
  const sandbox = { window: {}, console };
  vm.runInNewContext(mp4Src, sandbox);
  const api = sandbox.window.DevToolsMp4Timeline;
  assert.ok(api && typeof api.sampleRangeForKeep === "function");
  return api;
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
    this.nudgeKeepEdgeSec = nudgeKeepEdgeSec;
    `,
    box
  );
  return box;
}

function slice(fromNeedle, toNeedle) {
  const a = vtrim.indexOf(fromNeedle);
  const b = vtrim.indexOf(toNeedle, a + fromNeedle.length);
  assert.ok(a >= 0 && b > a, `slice ${fromNeedle} → ${toNeedle}`);
  return vtrim.slice(a, b);
}

const api = loadMp4Api();
const H = loadHelpers();
const MIN_SPAN = 0.5;

function cfr(fps, count) {
  const cts = new Float64Array(count);
  for (let i = 0; i < count; i++) cts[i] = i / fps;
  return { ctsSec: cts, fps };
}

/** 安卓录屏式稀疏 VFR：静帧数秒才一枚采样，末尾还有音轨空尾巴 */
function sparseVfr() {
  const cts = [0, 4.0, 4.0 + 1 / 30, 4.0 + 2 / 30, 4.1, 9.0, 9.0 + 1 / 30, 15.0];
  return { ctsSec: Float64Array.from(cts), fps: 30 };
}

/** 真机 timeline.fps = 全片平均帧率（静帧拉低），不是密集段帧率；夹具按 buildTimelineFromTrack 口径算 */
function withAvgFps(tl) {
  const a = tl.ctsSec;
  const n = a.length;
  const avg = n > 1 ? (n - 1) / (a[n - 1] - a[0]) : 30;
  return { ctsSec: a, fps: Math.round(avg * 1000) / 1000 };
}

/** 平均 ≈6fps：首尾各 1s 密集 30fps，中间 8s 静帧（无音轨、无空尾） */
function lowAvgVfr() {
  const cts = [];
  for (let i = 0; i < 30; i++) cts.push(i / 30);
  for (let i = 0; i < 30; i++) cts.push(9 + i / 30);
  return withAvgFps({ ctsSec: Float64Array.from(cts) });
}

function nudge(tl, st, edge, dir) {
  return H.nudgeKeepEdgeSec(tl, api, { ...st, minSpan: MIN_SPAN }, edge, dir);
}

function keep(tl, st) {
  return api.sampleRangeForKeep(tl, st.startSec, st.endSec);
}

function isCts(tl, v) {
  return Array.from(tl.ctsSec).some((c) => Math.abs(c - v) < 1e-9);
}

t("导出 contentExclusiveEndSec / snapExclusiveEndSec / nudgeKeepEdgeSec", () => {
  assert.ok(vtrim.includes("contentExclusiveEndSec,"));
  assert.ok(vtrim.includes("snapExclusiveEndSec,"));
  assert.ok(vtrim.includes("nudgeKeepEdgeSec,"));
});

t("容器空尾巴：contentEnd 收到片源轨末，不钉 duration", () => {
  const tl = cfr(30, 30 * 60);
  const end = H.contentExclusiveEndSec(tl, 70, api);
  const last = tl.ctsSec[tl.ctsSec.length - 1];
  assert.ok(end > last && end < 60.05, `end=${end} last=${last}`);
});

t("无空尾：contentEnd 保留接近 last 的 duration", () => {
  const tl = cfr(30, 300);
  const dur = tl.ctsSec[299] + 1 / 30;
  assert.ok(Math.abs(H.contentExclusiveEndSec(tl, dur, api) - dur) < 1e-9);
});

t("exclusive 吸附 duration 空尾 → contentEnd，禁止 last inclusive CTS", () => {
  const tl = cfr(30, 30 * 60);
  const snapped = H.snapExclusiveEndSec(tl, 70, 70, api);
  assert.ok(Math.abs(snapped - H.contentExclusiveEndSec(tl, 70, api)) < 1e-9);
  assert.ok(Math.abs(snapped - tl.ctsSec[tl.ctsSec.length - 1]) > 1e-3, "吸成 lastCts 会少最后一帧");
});

t("稀疏 VFR 片头+：落到下一真实采样（4.0s），首帧必变", () => {
  const tl = sparseVfr();
  const dur = 20;
  const st = { startSec: 0, endSec: H.contentExclusiveEndSec(tl, dur, api), duration: dur };
  const next = nudge(tl, st, "start", 1);
  assert.ok(Math.abs(next - 4.0) < 1e-9, `片头+ 应到 4.0，实际 ${next}`);
  assert.strictEqual(keep(tl, { ...st, startSec: next }).startF, keep(tl, st).startF + 1);
  const back = nudge(tl, { ...st, startSec: next }, "start", -1);
  assert.ok(Math.abs(back - 0) < 1e-9, `片头− 应回 0，实际 ${back}`);
});

t("稀疏 VFR 连点：每次片头+/片尾− 都是真实 CTS 且只换一帧", () => {
  const tl = sparseVfr();
  const dur = 20;
  let st = { startSec: 0, endSec: H.contentExclusiveEndSec(tl, dur, api), duration: dur };
  for (let i = 0; i < 4; i++) {
    const before = keep(tl, st);
    const next = nudge(tl, st, "start", 1);
    assert.ok(isCts(tl, next), `片头+ #${i} 不在采样上：${next}`);
    st = { ...st, startSec: next };
    assert.strictEqual(keep(tl, st).startF, before.startF + 1, `片头+ #${i} 帧号没 +1`);
  }
  st = { startSec: 0, endSec: H.contentExclusiveEndSec(tl, dur, api), duration: dur };
  for (let i = 0; i < 3; i++) {
    const before = keep(tl, st);
    const next = nudge(tl, st, "end", -1);
    assert.ok(isCts(tl, next), `片尾− #${i} 不在采样上：${next}`);
    st = { ...st, endSec: next };
    assert.strictEqual(keep(tl, st).endF, before.endF - 1, `片尾− #${i} 帧号没 −1`);
  }
  // 第二次片尾− 跨 6s 静帧：必须照跳，不能只退 1/30s
  assert.ok(Math.abs(st.endSec - 9.0) < 1e-9, `连退三次应停在 9.0，实际 ${st.endSec}`);
});

t("片尾+：逐帧加回，含满后不动；空尾巴上 + 不往回拉", () => {
  const tl = sparseVfr();
  const dur = 20;
  const contentEnd = H.contentExclusiveEndSec(tl, dur, api);
  const fromLast = nudge(tl, { startSec: 0, endSec: 15.0, duration: dur }, "end", 1);
  assert.ok(Math.abs(fromLast - contentEnd) < 1e-9, `片尾+ 应收回末帧：${fromLast}`);
  const atFull = nudge(tl, { startSec: 0, endSec: contentEnd, duration: dur }, "end", 1);
  assert.ok(Math.abs(atFull - contentEnd) < 1e-9);
  const inTail = nudge(tl, { startSec: 0, endSec: dur, duration: dur }, "end", 1);
  assert.ok(Math.abs(inTail - dur) < 1e-9, `空尾巴上片尾+ 不得往回拉：${inTail}`);
});

t("片尾− 从空尾巴：只退末帧（≡ 少一帧），不先空收 contentEnd", () => {
  const tl = sparseVfr();
  const dur = 20;
  const st = { startSec: 0, endSec: dur, duration: dur };
  const next = nudge(tl, st, "end", -1);
  assert.ok(Math.abs(next - 15.0) < 1e-9, `应到末帧 CTS 15.0，实际 ${next}`);
  assert.strictEqual(keep(tl, { ...st, endSec: next }).endF, tl.ctsSec.length - 1);
});

t("CFR 30fps：± 一次正好一帧（1/30s）", () => {
  const tl = cfr(30, 1800);
  const dur = 70;
  const ce = H.contentExclusiveEndSec(tl, dur, api);
  const s1 = nudge(tl, { startSec: 1.0, endSec: ce, duration: dur }, "start", 1);
  assert.ok(Math.abs(s1 - (1.0 + 1 / 30)) < 1e-9, `s1=${s1}`);
  const e1 = nudge(tl, { startSec: 0, endSec: ce, duration: dur }, "end", -1);
  assert.ok(Math.abs(e1 - tl.ctsSec[1799]) < 1e-9, `e1=${e1}`);
  const e2 = nudge(tl, { startSec: 0, endSec: e1, duration: dur }, "end", -1);
  assert.ok(Math.abs(e2 - tl.ctsSec[1798]) < 1e-9, `e2=${e2}`);
});

t("最短片段：片头+/片尾− 到顶不越过 MIN_SPAN", () => {
  const tl = cfr(30, 300);
  const st = { startSec: 2.0, endSec: 2.5, duration: 10 };
  const s = nudge(tl, st, "start", 1);
  assert.ok(s <= st.endSec - MIN_SPAN + 1e-9, `s=${s}`);
  const e = nudge(tl, st, "end", -1);
  assert.ok(e >= st.startSec + MIN_SPAN - 1e-9, `e=${e}`);
});

t("低平均 fps VFR：片尾± 每次正好 ±1 帧，片尾+ 不倒退，含满后不动", () => {
  const tl = lowAvgVfr();
  assert.ok(tl.fps < 7, `夹具应是低平均 fps：${tl.fps}`);
  const n = tl.ctsSec.length;
  const dur = tl.ctsSec[n - 1] + 1 / 30;
  const ce = H.contentExclusiveEndSec(tl, dur, api);
  let st = { startSec: 0, endSec: ce, duration: dur };
  assert.strictEqual(keep(tl, st).endF, n, "满窗须含末帧");
  for (let i = 0; i < 6; i++) {
    const before = keep(tl, st).endF;
    st = { ...st, endSec: nudge(tl, st, "end", -1) };
    assert.strictEqual(keep(tl, st).endF, before - 1, `片尾− #${i}`);
  }
  for (let i = 0; i < 6; i++) {
    const before = keep(tl, st).endF;
    const next = nudge(tl, st, "end", 1);
    assert.ok(next > st.endSec, `片尾+ #${i} 倒退：${st.endSec} → ${next}`);
    st = { ...st, endSec: next };
    assert.strictEqual(keep(tl, st).endF, before + 1, `片尾+ #${i}`);
  }
  assert.strictEqual(keep(tl, st).endF, n);
  assert.ok(Math.abs(nudge(tl, st, "end", 1) - st.endSec) < 1e-9, "含满后片尾+ 不动");
});

t("低平均 fps VFR：片头± 逐帧", () => {
  const tl = lowAvgVfr();
  const n = tl.ctsSec.length;
  const dur = tl.ctsSec[n - 1] + 1 / 30;
  let st = { startSec: tl.ctsSec[32], endSec: dur, duration: dur };
  for (let i = 0; i < 4; i++) {
    const before = keep(tl, st).startF;
    st = { ...st, startSec: nudge(tl, st, "start", 1) };
    assert.strictEqual(keep(tl, st).startF, before + 1, `片头+ #${i}`);
  }
  for (let i = 0; i < 4; i++) {
    const before = keep(tl, st).startF;
    st = { ...st, startSec: nudge(tl, st, "start", -1) };
    assert.strictEqual(keep(tl, st).startF, before - 1, `片头− #${i}`);
  }
});

t("真实平均 fps 的稀疏 VFR：连点片尾− 仍逐帧并停在 9.0", () => {
  const tl = withAvgFps(sparseVfr());
  const dur = 20;
  let st = { startSec: 0, endSec: H.contentExclusiveEndSec(tl, dur, api), duration: dur };
  assert.strictEqual(keep(tl, st).endF, tl.ctsSec.length);
  for (let i = 0; i < 3; i++) {
    const before = keep(tl, st).endF;
    st = { ...st, endSec: nudge(tl, st, "end", -1) };
    assert.strictEqual(keep(tl, st).endF, before - 1, `片尾− #${i}`);
  }
  assert.ok(Math.abs(st.endSec - 9.0) < 1e-9, `应停在 9.0：${st.endSec}`);
});

t("半开片尾按本地帧距判：落在 CTS 不含、过半帧才含；吸附同一公式", () => {
  const tl = lowAvgVfr();
  const k = 40;
  const tk = tl.ctsSec[k];
  assert.strictEqual(api.exclusiveEndIndexAtSec(tl, tk), k);
  assert.strictEqual(api.exclusiveEndIndexAtSec(tl, tk + 0.3 / 30), k);
  assert.strictEqual(api.exclusiveEndIndexAtSec(tl, tk + 0.6 / 30), k + 1);
  assert.strictEqual(api.sampleRangeForKeep(tl, 0, tk).endF, k);
  const dur = tl.ctsSec[tl.ctsSec.length - 1] + 1 / 30;
  assert.ok(Math.abs(H.snapExclusiveEndSec(tl, tk + 0.3 / 30, dur, api) - tk) < 1e-9);
  assert.ok(Math.abs(H.snapExclusiveEndSec(tl, tk + 0.6 / 30, dur, api) - tl.ctsSec[k + 1]) < 1e-9);
});

t("CFR：半开片尾与旧 0.5/fps 公式逐值一致", () => {
  const tl = cfr(30, 300);
  for (const b of [0, 0.5, 1, 1 + 0.4 / 30, 1 + 0.6 / 30, 3.3333, 9.95, 10, 12]) {
    const old = Math.max(1, Math.min(300, api.sampleIndexAtSec(tl, Math.max(0, b - 0.5 / 30)) + 1));
    assert.strictEqual(api.sampleRangeForKeep(tl, 0, b).endF, old, `b=${b}`);
  }
  assert.ok(Math.abs(api.sampleSpanSec(tl, 299) - 1 / 30) < 1e-12);
});

t("末帧停帧点不越过片尾（低平均 fps 不能按 1/平均fps 估末帧）", () => {
  const tl = lowAvgVfr();
  const n = tl.ctsSec.length;
  const last = tl.ctsSec[n - 1];
  const seek = api.frameSeekSec(tl, n - 1);
  assert.ok(seek > last && seek < last + 1 / 30, `seek=${seek} last=${last}`);
  const ce = H.contentExclusiveEndSec(tl, last + 5, api);
  assert.ok(ce > last && ce <= last + 1 / 30 + 1e-9, `空尾巴收到末帧后一帧：${ce}`);
});

t("暂停态不自动播：clipPlayWindow 只在 pause 监听「播放中触底」时回绕", () => {
  const clip = slice("function clipPlayWindow", "function armFrameWatch");
  assert.ok(/if \(video\.paused && !loopFromFileEnd\) return false;/.test(clip));
  assert.ok(!clip.includes("video.ended"), "暂停态勿据 ended/clock 判播完：片尾+ 到末帧会自己从头播");
  const onPause = slice('video.addEventListener("pause"', 'video.addEventListener("play"');
  assert.ok(onPause.includes("video.ended"));
  assert.ok(onPause.includes("loopFromFileEnd = true") && onPause.includes("loopFromFileEnd = false"));
  const timer = slice("parkCutTimer = window.setTimeout", "}, waitMs);");
  assert.ok(timer.includes("video.paused) return"), "预约切点在暂停态不得续播");
});

t("源码：黄/红柄 ± 无 maxStep / 1/fps 时间步回退", () => {
  const trim = slice("function nudgeTrimEdgeSec", "function syncSharedNudgeLabels");
  assert.ok(trim.includes("nudgeKeepEdgeSec("));
  assert.ok(!trim.includes("maxStep"));
  const cut = slice("function nudgeSelectedCutout", "async function snapCutNudgeToShown");
  assert.ok(cut.includes("nudgeEncodeSec"));
  assert.ok(!cut.includes("maxStep"));
  const helper = slice("function nudgeKeepEdgeSec", "const DRAG_SEEK_MS");
  assert.ok(!helper.includes("maxStep"));
  assert.ok(!/1\s*\/\s*fps/.test(helper), "helper 不得按 1/fps 挪时间");
});

t("打开即收空尾巴：detect 在黄柄初值之后；共用表可信/不可信都先收", () => {
  const meta = slice("const onMeta = () => {", "const onErr = () => {");
  const initEnd = meta.indexOf("endSec = clamp(Number(initial.trimEnd)");
  const detect = meta.indexOf("sourceTimelineReady = detectAndApplySourceFps");
  assert.ok(initEnd > 0 && detect > initEnd, "detect 必须在 endSec 初值之后，否则同步收尾巴落空");
  const detectFn = slice("async function detectAndApplySourceTimeline", "function tightenTrimAndRepaint");
  const shared = detectFn.slice(0, detectFn.indexOf("if (!srcFile) return;"));
  assert.ok(shared.indexOf("tightenTrimAndRepaint()") >= 0);
  assert.ok(
    shared.indexOf("tightenTrimAndRepaint()") < shared.indexOf("calibrateSourceTimelineToEditorVideo()"),
    "不可信表也要先收，不等校准"
  );
});

t("校准 rematch / 拖柄走 exclusive 片尾", () => {
  assert.ok(vtrim.includes("snapToEncodeClock(endSec, { exclusive: true })"));
  assert.ok(vtrim.includes('exclusive: which === "end"'));
  const rematch = slice("function rematchHandlesAfterCalibrate", "async function calibrateSourceTimelineToEditorVideo");
  assert.ok(rematch.includes("tightenTrimToContentTimeline()"));
  const cutMap = rematch.slice(rematch.indexOf("cutouts = cutouts.map"), rematch.indexOf("clipCutoutsToWindow"));
  assert.ok(!/snapToEncodeClock\([^)]*exclusive/.test(cutMap));
  assert.ok(!/snapToEncodeClock\([^)]*inclusive/.test(cutMap));
});

t("红柄拖/松手走 cut-start|cut-end，禁止复用黄柄 exclusive", () => {
  const snap = vtrim.slice(vtrim.indexOf("function snapTrimHandle"), vtrim.indexOf("function snapTrimHandle") + 900);
  assert.ok(snap.includes("cutClosed"));
  assert.ok(/exclusive:\s*which\s*===\s*["']end["']\s*&&\s*!cutClosed/.test(snap));
  assert.ok(vtrim.includes('snapTrimHandle(raw, "cut-start")'));
  assert.ok(vtrim.includes('snapTrimHandle(raw, "cut-end")'));
  const finish = slice("async function finishTrimDrag", "function onTimelinePointerDown");
  assert.ok(finish.includes('"cut-end"') && finish.includes('"cut-start"'));
});

t("交互热路径保持 145922：微调不 play、不踢帧，无 parkHold/假取消补丁", () => {
  const bind = slice("function bindNudgeHold", "nudgeStartM,");
  assert.ok(!bind.includes(".play("), "微调不得开播");
  assert.ok(bind.includes("fire()"));
  for (const word of ["parkHoldPause", "forcePreviewFrame", "kickPreviewPaint", "spuriousPointerCancel", "commitCoarseRelease"]) {
    assert.ok(!vtrim.includes(word), `不应再有 ${word}`);
  }
  assert.ok(!vtrim.includes('window.addEventListener("pointermove", onTimelinePointerMove, true)'));
  const ensure = vbb.slice(vbb.indexOf("async function ensureVbbVtrimEditor"), vbb.indexOf("function prefetchVbbVtrimEditor"));
  assert.ok(!ensure.includes("__rev"), "勿按 BUILD 删模块重载（加载器去重时编辑器会打不开）");
});

console.log(`vbb-trim-nudge-jump.test.js: ${n} passed`);
