"use strict";

/**
 * 播放到 keep 段末帧：就地停住、补足该帧剩余时长、再跳下一段 / 回片头（编辑器 ≡ 外预览 ≡ GIF）。
 * 等删段首帧 / 片尾外一帧真呈现再跳，预览会多闪一帧成片里没有的画面。
 * 导出：有采样表时 keep 时长按真实 CTS 跨度；Chrome 兜底 VFR 按真实帧长铺网格。
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
const pending = [];
function t(name, fn) {
  const fail = (e) => {
    console.error(`✗ ${name}`);
    throw e;
  };
  try {
    const r = fn();
    if (r && typeof r.then === "function") pending.push(r.catch(fail));
  } catch (e) {
    fail(e);
  }
  n += 1;
}

function sliceOf(src, fromNeedle, toNeedle) {
  const a = src.indexOf(fromNeedle);
  const b = src.indexOf(toNeedle, a + fromNeedle.length);
  assert.ok(a >= 0 && b > a, `slice ${fromNeedle} → ${toNeedle}`);
  return src.slice(a, b);
}

function loadModule() {
  const sandbox = { window: {}, console, setTimeout, clearTimeout };
  vm.runInNewContext(mp4Src, sandbox);
  const api = sandbox.window.DevToolsMp4Timeline;
  assert.ok(api && typeof api.sampleSpanSec === "function");
  vm.runInNewContext(
    `${sliceOf(vtrim, "function keepBoundaryHold", "function evenDim")}
    this.keepBoundaryHold = keepBoundaryHold;
    this.armFramePainted = armFramePainted;`,
    sandbox
  );
  return { api, keepBoundaryHold: sandbox.keepBoundaryHold, armFramePainted: sandbox.armFramePainted };
}

const { api, keepBoundaryHold, armFramePainted } = loadModule();
const close = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

function cfr(fps, count) {
  const cts = new Float64Array(count);
  for (let i = 0; i < count; i++) cts[i] = i / fps;
  return { ctsSec: cts, fps };
}

/** 0–0.967 密集 30fps，第 29 帧静 8.03s，9.0–9.967 密集；fps = 全片平均（真机口径） */
function lowAvgVfr() {
  const cts = [];
  for (let i = 0; i < 30; i++) cts.push(i / 30);
  for (let i = 0; i < 30; i++) cts.push(9 + i / 30);
  const a = Float64Array.from(cts);
  return { ctsSec: a, fps: Math.round((59 / (a[59] - a[0])) * 1000) / 1000 };
}

function keepOf(tl, startF, endF) {
  const a = tl.ctsSec;
  return { start: a[startF], end: endF < a.length ? a[endF] : a[a.length - 1] + 1 / tl.fps, startF, endF };
}

t("CFR：末帧停帧 → 跳下一段首帧帧内，剩余 = 一帧", () => {
  const tl = cfr(30, 600);
  const keeps = [keepOf(tl, 30, 60), keepOf(tl, 90, 120)];
  const h = keepBoundaryHold(keeps, tl, tl.ctsSec[59]);
  assert.ok(h, "keep 0 末帧须停帧");
  assert.strictEqual(h.loop, false);
  assert.ok(close(h.nextStart, keeps[1].start));
  assert.ok(close(h.seekSec, api.frameSeekSec(tl, 90)));
  assert.ok(h.seekSec > tl.ctsSec[90] && h.seekSec < tl.ctsSec[91], "落在下一段首帧内部");
  assert.ok(close(h.remainSec, 1 / 30, 1e-4));
});

t("rVFC mediaTime 比 CTS 少几 µs 也认得末帧", () => {
  const tl = cfr(30, 600);
  const keeps = [keepOf(tl, 30, 60), keepOf(tl, 90, 120)];
  assert.ok(keepBoundaryHold(keeps, tl, tl.ctsSec[59] - 5e-6));
});

t("非末帧不停", () => {
  const tl = cfr(30, 600);
  const keeps = [keepOf(tl, 30, 60), keepOf(tl, 90, 120)];
  assert.strictEqual(keepBoundaryHold(keeps, tl, tl.ctsSec[58]), null);
  assert.strictEqual(keepBoundaryHold(keeps, tl, tl.ctsSec[30]), null);
  assert.strictEqual(keepBoundaryHold(keeps, tl, tl.ctsSec[95]), null);
});

t("末段末帧 → 回第一段（loop）", () => {
  const tl = cfr(30, 600);
  const keeps = [keepOf(tl, 30, 60), keepOf(tl, 90, 120)];
  const h = keepBoundaryHold(keeps, tl, tl.ctsSec[119]);
  assert.ok(h && h.loop === true);
  assert.ok(close(h.nextStart, keeps[0].start));
  assert.ok(close(h.seekSec, api.frameSeekSec(tl, 30)));
});

t("相邻 keep（删段为空）不停帧，自然播过去", () => {
  const tl = cfr(30, 600);
  const keeps = [keepOf(tl, 30, 60), keepOf(tl, 60, 120)];
  assert.strictEqual(keepBoundaryHold(keeps, tl, tl.ctsSec[59]), null);
});

t("无帧号 / 无采样表 → null（调用方走按时间回退）", () => {
  const tl = cfr(30, 600);
  assert.strictEqual(keepBoundaryHold([{ start: 1, end: 2 }], tl, 1.9667), null);
  assert.strictEqual(keepBoundaryHold([keepOf(tl, 30, 60)], { ctsSec: new Float64Array(0), fps: 30 }, 1.9), null);
  assert.strictEqual(keepBoundaryHold([], tl, 1.9), null);
});

t("文件最后一枚采样作 keep 末帧：剩余到 keep.end，回片头", () => {
  const tl = cfr(30, 60);
  const keeps = [{ start: 0.5, end: 2, startF: 15, endF: 60 }];
  const h = keepBoundaryHold(keeps, tl, tl.ctsSec[59]);
  assert.ok(h && h.loop === true);
  assert.ok(close(h.remainSec, 2 - tl.ctsSec[59], 1e-6));
});

t("VFR 静帧作 keep 末帧：停满真实时长（≡ GIF 里这帧的时长）", () => {
  const tl = lowAvgVfr();
  const keeps = [keepOf(tl, 3, 30), keepOf(tl, 35, 54)];
  const h = keepBoundaryHold(keeps, tl, tl.ctsSec[29]);
  assert.ok(h, "第 29 帧（静 8s）是 keep 0 末帧");
  assert.ok(close(h.remainSec, tl.ctsSec[30] - tl.ctsSec[29], 1e-6));
  assert.ok(h.remainSec > 8);
  assert.ok(close(h.seekSec, api.frameSeekSec(tl, 35)));
});

t("VFR 密集段：按本地帧距认帧，不按 1/平均fps 把几帧当一帧", () => {
  const tl = lowAvgVfr();
  assert.ok(tl.fps < 7, "夹具平均 fps 应很低");
  const keeps = [keepOf(tl, 30, 40), keepOf(tl, 45, 54)];
  assert.strictEqual(keepBoundaryHold(keeps, tl, tl.ctsSec[38]), null, "倒数第二帧不能被当成末帧");
  assert.ok(keepBoundaryHold(keeps, tl, tl.ctsSec[39]));
});

t("armFramePainted：rVFC 来了立刻放行；不支持 rVFC 不等", async () => {
  let cb = null;
  const fake = { requestVideoFrameCallback: (f) => (cb = f) };
  const p = armFramePainted(fake);
  let done = false;
  const w = p.wait(5000).then(() => (done = true));
  cb();
  await w;
  assert.ok(done);
  await armFramePainted({}).wait(5000);
});

t("编辑器：rVFC 末帧停帧接线 + 停帧中暂停/拖/关都取消", () => {
  const arm = sliceOf(vtrim, "function armFrameWatch", "function tickPlayhead");
  assert.ok(arm.includes("holdAtKeepBoundary(mt, meta)"));
  const hold = sliceOf(vtrim, "function holdAtKeepBoundary", "function clipPlayWindow");
  assert.ok(hold.includes("keepBoundaryHold(keepRangesLocal(), sourceTimeline, mt)"));
  assert.ok(hold.includes("video.pause()"));
  assert.ok(hold.includes("expectedDisplayTime"), "扣掉 rVFC 回调已迟到的时间");
  const paintAt = hold.indexOf("armFramePainted(video)");
  const seekAt = hold.indexOf("await seekPlayheadExact(");
  const waitAt = hold.indexOf("paint.wait(");
  const playAt = hold.indexOf("video.play()");
  assert.ok(paintAt > 0 && paintAt < seekAt && seekAt < waitAt && waitAt < playAt, "seek 前挂 rVFC，呈现后再 play");
  assert.ok(hold.includes("function cancelBoundaryHold"));
  const toggle = sliceOf(vtrim, "async function togglePlay", "if (video.paused) {");
  assert.ok(/if \(boundaryHold\) \{\s*(\/\/[^\n]*\n\s*)?cancelBoundaryHold\(\);\s*return;/.test(toggle), "停帧中点播放按钮 = 暂停");
  assert.ok(
    /addEventListener\("seeking", \(\) => \{\s*(\/\/[^\n]*\n\s*)?if \(boundaryHold\) cancelBoundaryHold\(\);/.test(vtrim)
  );
  assert.ok(/addEventListener\("pause", \(\) => \{\s*(\/\/[^\n]*\n\s*)?if \(boundaryHold\) return;/.test(vtrim), "停帧暂停不刷按钮");
  assert.ok(/closed = true;[\s\S]{0,200}boundaryHold = null;/.test(vtrim), "关编辑器清停帧");
});

t("外预览：同一 keepBoundaryHold；暂停/拖/手动播/换片都取消停帧", () => {
  const arm = sliceOf(vbb, "function armVbbEditFrameWatch", "async function selectVbbBatchItem");
  const holdAt = arm.indexOf("holdVbbEditAtKeepBoundary(mt, meta)");
  const cutAt = arm.indexOf("scheduleVbbEditEndCut(mt)");
  assert.ok(holdAt > 0 && cutAt > holdAt, "停帧优先于按时间预约切断");
  const hold = sliceOf(vbb, "function holdVbbEditAtKeepBoundary", "function cancelVbbEditHold");
  assert.ok(hold.includes("DevToolsVtrimEditor?.keepBoundaryHold"));
  assert.ok(hold.includes("vbbEditSeekKeepTarget(hold.seekSec, keeps, item, srcFps, true"));
  assert.ok(hold.includes("vbbEditHold.gen !== gen"));
  const pause = sliceOf(vbb, "function pauseVbbPreview", "function vbbScrubValueToTime");
  assert.ok(pause.includes("cancelVbbEditHold()"));
  assert.ok(
    /addEventListener\("play", \(\) => \{\s*vbbMediaPlaying = true;\s*\/\/[^\n]*\n\s*if \(vbbEditHold\) cancelVbbEditHold\(\);/.test(vbb)
  );
  assert.ok(/addEventListener\("seeking", \(\) => \{\s*\/\/[^\n]*\n\s*if \(vbbEditHold\) cancelVbbEditHold\(\);/.test(vbb));
  const seek = sliceOf(vbb, "function vbbEditSeekKeepTarget", "function scheduleVbbEditEndCut");
  assert.ok(seek.includes("armFramePainted(vbbVideo)"));
  assert.ok(seek.indexOf("let paint = armPaint()") < seek.indexOf("applyVbbSeek(next"));
  assert.ok(seek.includes("paint = armPaint();"), "补推 seek 前重挂");
  assert.ok(seek.includes("paint.wait(120)"));
});

t("外预览文件尾：暂停拖到末尾不续播；只有 pause 监听（播完自停）回绕", () => {
  const enforce = sliceOf(vbb, "function enforceVbbEditPlaybackWindow", "function vbbEditSeekKeepTarget");
  const guard = enforce.indexOf("if (vbbVideo.paused && vbbVideo.ended && !vbbLoopFromFileEnd)");
  assert.ok(guard > 0 && guard < enforce.indexOf("const holding"), "paused+ended 先拦住");
  // Chrome 暂停 seek 到文件尾时 ended 事件时有时无：不能靠 ended 监听，要靠「pause 事件还没到」
  assert.ok(enforce.includes("if (vbbMediaPlaying) return;"), "播完自停留给 pause 监听");
  assert.ok(!vbb.includes("vbbParkFromEnded"));
  assert.ok(/lastKeep\?\.endF\) >= n/.test(enforce), "末帧已在 keep 里不再停（防 seek↔ended 打转）");
  const pause = vbb.slice(vbb.indexOf('vbbVideo?.addEventListener("pause"'), vbb.indexOf('vbbVideo?.addEventListener("timeupdate"'));
  assert.ok(pause.indexOf("vbbVideo.ended") >= 0 && pause.indexOf("vbbLoopFromFileEnd = true") > 0);
  assert.ok(
    pause.indexOf("vbbLoopFromFileEnd = true") < pause.indexOf("if (vbbPlayUiLock) return;"),
    "回绕判断不能被按钮锁挡掉"
  );
  const offAt = pause.indexOf("vbbMediaPlaying = false;");
  assert.ok(offAt > pause.indexOf("vbbLoopFromFileEnd = false"), "回绕判断之后才清");
  assert.ok(offAt < pause.indexOf("if (vbbPlayUiLock) return;"), "按钮锁不能挡住清标记");
  assert.ok(/addEventListener\("emptied", \(\) => \{[\s\S]{0,80}vbbMediaPlaying = false;/.test(vbb), "换源不派 pause");
  assert.ok(!pause.includes('addEventListener("ended"'));
});

t("外预览暂停越过停帧的容差按停帧那一帧的真实时长，不按 1/平均fps", () => {
  const enforce = sliceOf(vbb, "function enforceVbbEditPlaybackWindow", "function vbbEditSeekKeepTarget");
  assert.ok(enforce.includes("mp4.sampleSpanSec(tl, mp4.sampleIndexAtSec(tl, next))"));
  assert.ok(enforce.includes("const pastSlop = holding ? Math.max(0.012, 0.35 * parkSpan) : 0;"));
  assert.ok(!enforce.includes("0.35 * frame"));
});

t("导出：有采样表时 keep 时长 = 真实 CTS 跨度（VFR 静帧不被截断）", () => {
  const exp = sliceOf(vtrim, "async function exportKeepVideo", "window.DevToolsVtrimEditor = {");
  const spans = exp.match(/spanSec = useFrame && !preferSampleFrames/g) || [];
  assert.strictEqual(spans.length, 2, "onePass / 分段两处都要按 preferSampleFrames 分流");
  assert.ok(!/spanSec = useFrame \? \(b\.endF - b\.startF\) \/ keepFps/.test(exp));
});

t("Chrome 兜底：VFR 按真实帧长铺 gridFps 网格；密集段可跳帧不拖慢", () => {
  const fn = sliceOf(vtrim, "async function exportKeepByChromeDisplay", "async function exportKeepVideo");
  assert.ok(fn.includes("const gridFps ="));
  assert.ok(fn.includes("framerate: gridFps"));
  assert.ok(fn.includes("while (outTs + durUs / 2 <= srcClockUs || outFrames === 0)"));
  assert.ok(fn.includes("srcClockUs += Math.round(realDurSec(fi) * 1e6)"));
  assert.ok((fn.match(/String\(gridFps\)/g) || []).length >= 2, "-r / -framerate 用 gridFps");
  assert.ok(fn.includes('["prefer-hardware", "no-preference"]'), "无硬编机器退软编，兜底才可用");
});

t("本地 concat 兜底：有采样表按 keep 帧号 frameRaw，不按时间换帧", () => {
  const m = sliceOf(vbb, "const tryPart = async (start0, end0, out, mode, sampleFrames)", "ok = await tryPart(");
  assert.ok(m.includes("const raw = useFrame && !useGrid && sampleFrames"));
  assert.ok(m.includes("sampleFrames.startF") && m.includes("sampleFrames.endF"));
});

Promise.all(pending).then(
  () => console.log(`vbb-keep-boundary-hold.test.js: ${n} passed`),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
