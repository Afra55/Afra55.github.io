#!/usr/bin/env node
"use strict";

/** 纯函数自测：一键黑盒切片规划逻辑（与 extra.js 对齐） */
const V2G_BLACKBOX_MAX_BYTES = 6 * 1024 * 1024;
const V2G_BLACKBOX_WIDEN_BYTES = 5 * 1024 * 1024;
const V2G_BLACKBOX_BASE_W = 420;
const V2G_BLACKBOX_WIDTH_STEP = 60;
const V2G_BLACKBOX_WIDTH_CAP = 720;
const MAX_V2G_FRAMES = 300;
const VBB_SAFETY = 0.85;
const VBB_CLARITY_FILL = 0.97;
const VBB_MAX_CLIPS = 50;
const VBB_MIN_SPAN = 0.5;
const VBB_CLARITY_MAX_SPAN = 20;
const VBB_DURATION_MAX_SPAN = 30;
const VBB_SAMPLE_SPAN = 2.5;
const VBB_SOFT_COMPRESS_KEEP = 0.72;
const VBB_BLACKBOX_LONG_SPAN_SEC = 20;

function buildVbbRanges(duration, targetSpan, equalize) {
  const d = Number(duration) || 0;
  const part = Math.max(VBB_MIN_SPAN, Number(targetSpan) || VBB_MIN_SPAN);
  if (!(d > 0)) throw new Error("无法读取视频时长");
  const needed = Math.max(1, Math.ceil(d / part - 1e-9));
  const useEqual = Boolean(equalize) || needed > VBB_MAX_CLIPS;
  if (useEqual) {
    const n = Math.min(VBB_MAX_CLIPS, needed);
    const slice = d / n;
    const ranges = [];
    for (let i = 0; i < n; i++) {
      const start = i * slice;
      const end = i === n - 1 ? d : (i + 1) * slice;
      ranges.push({ start, span: Math.max(VBB_MIN_SPAN, end - start) });
    }
    return ranges;
  }
  const ranges = [];
  let start = 0;
  while (start < d - 1e-9) {
    const remaining = d - start;
    if (remaining <= part + 1e-6 || remaining - part < VBB_MIN_SPAN) {
      ranges.push({ start, span: remaining });
      break;
    }
    ranges.push({ start, span: part });
    start += part;
  }
  if (!ranges.length) ranges.push({ start: 0, span: d });
  return ranges;
}

function vbbWidthLadder(srcW) {
  const hard = Math.min(V2G_BLACKBOX_WIDTH_CAP, srcW > 0 ? srcW : V2G_BLACKBOX_WIDTH_CAP);
  const start = Math.min(V2G_BLACKBOX_BASE_W, hard);
  const list = [];
  for (let w = start; w <= hard + 0.1; w += V2G_BLACKBOX_WIDTH_STEP) {
    list.push(Math.min(hard, Math.round(w)));
  }
  if (!list.length) list.push(Math.max(64, hard || V2G_BLACKBOX_BASE_W));
  const last = list[list.length - 1];
  if (last < hard) list.push(hard);
  return [...new Set(list)];
}

function vbbSampleBaseWidth(srcW) {
  return Math.min(V2G_BLACKBOX_BASE_W, srcW > 0 ? srcW : V2G_BLACKBOX_BASE_W);
}

function estimateVbbBytesAtWidth(bps15, span, width, srcW) {
  const s = Math.max(VBB_MIN_SPAN, Number(span) || VBB_MIN_SPAN);
  const baseW = vbbSampleBaseWidth(srcW);
  const w = Math.max(64, Number(width) || baseW);
  const scale = (w / Math.max(1, baseW)) ** 2;
  return Math.round(bps15 * s * scale);
}

function estimateVbbBytesAtFpsWidth(bps15, span, fps, width, srcW) {
  const f = Math.max(1, Number(fps) || 15);
  return Math.round(estimateVbbBytesAtWidth(bps15, span, width, srcW) * (f / 15));
}

function resolveBlackboxEstimateFpsList(span) {
  const s = Math.max(VBB_MIN_SPAN, Number(span) || VBB_MIN_SPAN);
  const framesAt15 = Math.floor(s * 15) + 1;
  if (s > VBB_BLACKBOX_LONG_SPAN_SEC || framesAt15 > MAX_V2G_FRAMES) return [12, 10];
  return [15, 12, 10];
}

function resolveVbbWidenWidthForEst(bps15, span, fps, srcW, startBytes, startW) {
  const budget = V2G_BLACKBOX_MAX_BYTES;
  const widenGate = V2G_BLACKBOX_WIDEN_BYTES;
  let best = Math.max(64, Number(startW) || vbbSampleBaseWidth(srcW));
  let bestBytes = Math.max(1, Number(startBytes) || estimateVbbBytesAtFpsWidth(bps15, span, fps, best, srcW));
  if (bestBytes >= widenGate) return { maxW: best, bytes: bestBytes };
  for (const w of vbbWidthLadder(srcW)) {
    if (w <= best) continue;
    const est = estimateVbbBytesAtFpsWidth(bps15, span, fps, w, srcW);
    if (est <= budget) {
      best = w;
      bestBytes = est;
    } else break;
  }
  return { maxW: best, bytes: bestBytes };
}

function estimateVbbBlackboxPlan(bps15, span, srcW) {
  const s = Math.max(VBB_MIN_SPAN, Number(span) || VBB_MIN_SPAN);
  const maxBytes = V2G_BLACKBOX_MAX_BYTES;
  const baseW = vbbSampleBaseWidth(srcW);
  const fpsList = resolveBlackboxEstimateFpsList(s);

  for (let i = 0; i < fpsList.length; i++) {
    const fps = fpsList[i];
    const isLast = i >= fpsList.length - 1;
    const atBase = estimateVbbBytesAtFpsWidth(bps15, s, fps, baseW, srcW);

    if (atBase <= maxBytes) {
      const wide = resolveVbbWidenWidthForEst(bps15, s, fps, srcW, atBase, baseW);
      return { bytes: wide.bytes, fps, compressRounds: 0, maxW: wide.maxW };
    }

    const soft = Math.round(atBase * VBB_SOFT_COMPRESS_KEEP);
    if (soft <= maxBytes) {
      if (soft < V2G_BLACKBOX_WIDEN_BYTES) {
        const wide = resolveVbbWidenWidthForEst(bps15, s, fps, srcW, soft, baseW);
        if (wide.maxW > baseW) {
          return { bytes: wide.bytes, fps, compressRounds: 0, maxW: wide.maxW };
        }
      }
      return {
        bytes: Math.min(maxBytes, Math.max(soft, Math.round(maxBytes * 0.88))),
        fps,
        compressRounds: 1,
        maxW: baseW,
      };
    }

    if (isLast) {
      return { bytes: maxBytes, fps, compressRounds: 2, maxW: baseW };
    }
  }

  return { bytes: maxBytes, fps: 10, compressRounds: 2, maxW: baseW };
}

function estimateVbbBlackboxBytesCalibrated(blackboxBps, span, cal, srcW) {
  const s = Math.max(VBB_MIN_SPAN, Number(span) || VBB_MIN_SPAN);
  const calFps = Math.max(1, Number(cal?.fps) || 15);
  const calSpan = Math.max(VBB_MIN_SPAN, Number(cal?.span) || VBB_SAMPLE_SPAN);
  const calBytes = Math.max(1, Number(cal?.bytes) || blackboxBps * calSpan);
  const targetFps = resolveBlackboxEstimateFpsList(s)[0];
  let bytes;
  if (Math.abs(s - calSpan) < 0.12) {
    bytes = calBytes * (targetFps / calFps);
  } else {
    bytes = blackboxBps * s * (targetFps / calFps);
  }
  bytes = Math.round(bytes);
  if (bytes <= V2G_BLACKBOX_MAX_BYTES) return bytes;
  return Math.round(V2G_BLACKBOX_MAX_BYTES * (cal?.compressRounds > 0 ? 0.92 : 0.96));
}

function estimateVbbBytesBlackbox(bps15, span, srcW) {
  return estimateVbbBlackboxPlan(bps15, span, srcW).bytes;
}

function estimateVbbFps(bps15, span, mode, width, srcW) {
  if (mode !== "duration" && mode !== "blackbox") return 15;
  return estimateVbbBlackboxPlan(bps15, span, srcW).fps;
}

function estimateVbbBytes(bps15, span, mode, width, srcW) {
  const s = Math.max(VBB_MIN_SPAN, Number(span) || VBB_MIN_SPAN);
  if (mode === "duration" || mode === "blackbox") {
    return estimateVbbBytesBlackbox(bps15, s, srcW);
  }
  return estimateVbbBytesAtWidth(bps15, s, width || vbbSampleBaseWidth(srcW), srcW);
}

function resolveVbbWidthForSpan(bps15, span, srcW) {
  const budget = V2G_BLACKBOX_MAX_BYTES * VBB_SAFETY;
  let best = vbbSampleBaseWidth(srcW);
  for (const w of vbbWidthLadder(srcW)) {
    if (estimateVbbBytesAtWidth(bps15, span, w, srcW) <= budget) best = w;
    else break;
  }
  return best;
}

function resolveVbbSpanForWidth(bps15, width, srcW) {
  const baseW = vbbSampleBaseWidth(srcW);
  const scale = (Math.max(baseW, Number(width) || baseW) / Math.max(1, baseW)) ** 2;
  const span = (V2G_BLACKBOX_MAX_BYTES * VBB_SAFETY) / Math.max(1, bps15 * scale);
  return Math.max(VBB_MIN_SPAN, Math.min(VBB_CLARITY_MAX_SPAN, span));
}

function shouldReuseVbbFirstPlan(ranges, index) {
  if (!Array.isArray(ranges) || index <= 0 || index >= ranges.length - 1) return false;
  const a = Number(ranges[0]?.span) || 0;
  const b = Number(ranges[index]?.span) || 0;
  return a > 0 && Math.abs(a - b) < 0.08;
}

function sampleSpanFor(duration) {
  return Math.min(VBB_SAMPLE_SPAN, Math.max(VBB_MIN_SPAN, duration));
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function almost(a, b, eps = 1e-6) {
  return Math.abs(a - b) <= eps;
}

{
  const r = buildVbbRanges(8, 12);
  assert(r.length === 1, "short video should be 1 clip");
  assert(almost(r[0].span, 8), "single clip span = duration");
}

{
  const r = buildVbbRanges(60, 20);
  assert(r.length === 3, "60/20 => 3 clips");
  assert(almost(r[0].span, 20) && almost(r[2].span, 20), "equal spans");
}

{
  const r = buildVbbRanges(50, 20);
  assert(r.length === 3, "50/20 => 3 clips");
  assert(almost(r.reduce((a, x) => a + x.span, 0), 50), "spans sum to duration");
  assert(almost(r[0].span, 20) && almost(r[1].span, 20), "front clips keep target");
  assert(almost(r[2].span, 10), "last clip takes remainder");
}

{
  const r = buildVbbRanges(71.2, 10);
  assert(r.length === 8, "71.2/10 => 7 full + remainder");
  assert(r.slice(0, 7).every((x) => almost(x.span, 10)), "front 7 clips are 10s");
  assert(almost(r[7].span, 1.2, 1e-6), `last remainder 1.2s, got ${r[7].span}`);
}

{
  const r = buildVbbRanges(71.2, 10, true);
  assert(r.length === 8, "equalize 71.2/10 => 8 clips");
  assert(r.every((x) => almost(x.span, 8.9, 0.01)), "equalize makes even spans");
  const off = buildVbbRanges(71.2, 10, false);
  assert(almost(off[0].span, 10) && almost(off[7].span, 1.2), "equalize off restores remainder");
}

{
  const off = buildVbbRanges(50, 20, false);
  const on = buildVbbRanges(50, 20, true);
  assert(almost(off[0].span, 20) && almost(off[2].span, 10), "default remainder 20+20+10");
  assert(on.length === 3 && on.every((x) => almost(x.span, 50 / 3, 1e-6)), "equalize 50/20 even thirds");
  assert(almost(on[0].start, 0) && almost(on[2].start + on[2].span, 50), "equalize covers full duration");
}

{
  const r = buildVbbRanges(10.3, 10);
  assert(r.length === 1, "tiny leftover merges into last clip");
  assert(almost(r[0].span, 10.3), "merged span = duration");
}

{
  const r = buildVbbRanges(20.4, 10);
  assert(r.length === 2, "20.4/10 => 10 + merged 10.4");
  assert(almost(r[0].span, 10), "front stays 10");
  assert(almost(r[1].span, 10.4), "tail shorter than min span merges into last");
}

{
  const cases = [
    [71.2, 10],
    [22, 10],
    [4, 3],
    [50, 20],
    [8, 12],
    [10.3, 10],
    [148, 8.3],
    [56, 7],
    [56, 8],
  ];
  for (const [d, t] of cases) {
    const r = buildVbbRanges(d, t);
    const sum = r.reduce((a, x) => a + x.span, 0);
    assert(almost(sum, d, 1e-6), `coverage sum ${sum} != ${d} (t=${t})`);
    assert(almost(r[0].start, 0), "starts at 0");
    assert(almost(r[r.length - 1].start + r[r.length - 1].span, d, 1e-6), "ends at duration");
    for (let i = 1; i < r.length; i++) {
      assert(almost(r[i].start, r[i - 1].start + r[i - 1].span, 1e-6), `gap/overlap at ${i}`);
    }
    for (let i = 0; i < r.length - 1; i++) {
      assert(almost(r[i].span, t, 1e-6), `front clip ${i} should be ${t}, got ${r[i].span}`);
    }
  }
}

{
  const r = buildVbbRanges(600, 0.5);
  assert(r.length === VBB_MAX_CLIPS, "cap at max clips");
  assert(r[0].span > 0.5, "capped clips become longer than target");
}

{
  const bps = 400000;
  const a = estimateVbbBytes(bps, 5, "clarity", 420);
  const b = estimateVbbBytes(bps, 10, "clarity", 420);
  assert(b > a, "longer span => larger clarity estimate");
  assert(estimateVbbBytes(bps, 60, "duration") <= V2G_BLACKBOX_MAX_BYTES, "duration est capped");
  const w540 = estimateVbbBytesAtWidth(bps, 5, 540, 1280);
  const w420 = estimateVbbBytesAtWidth(bps, 5, 420, 1280);
  assert(w540 > w420, "wider => larger estimate");
  assert(almost(w540 / w420, (540 / 420) ** 2, 0.02), "width scales ~square");
}

{
  const bps = 800000;
  const e4 = estimateVbbBytes(bps, 4, "duration");
  const e20 = estimateVbbBytes(bps, 20, "duration");
  // 短段会加宽、长段会降帧/轻压，体积不必随秒数单调递增
  assert(e4 <= V2G_BLACKBOX_MAX_BYTES, "short blackbox under 6MB");
  assert(e20 <= V2G_BLACKBOX_MAX_BYTES, "long blackbox under 6MB");
  assert(e20 >= 4 * 1024 * 1024, `long blackbox should be sizable, got ${e20}`);
  assert(estimateVbbFps(bps, 4, "duration") === 15, "short blackbox stays 15fps");
  assert(estimateVbbFps(bps, 20, "duration") <= 12, "long blackbox drops fps");
  const p4 = estimateVbbBlackboxPlan(bps, 4, 1280);
  assert(p4.maxW > 420, "short low-bps should widen");
}

{
  // 12s：未压超 6MB、轻压可进预算 → 仍应预估 15FPS（与实装「先压再降帧」一致）
  const bps = (7.2 * 1024 * 1024) / 12; // 12s 原始约 7.2MB
  const plan = estimateVbbBlackboxPlan(bps, 12);
  assert(plan.fps === 15, `12s soft-fit should stay 15fps, got ${plan.fps}`);
  assert(plan.compressRounds >= 1, "12s over raw should expect compress");
  assert(plan.bytes <= V2G_BLACKBOX_MAX_BYTES, "soft plan under 6MB");
}

{
  // 短段够小应预估加宽（<5MB 门槛）
  const bps = (2.0 * 1024 * 1024) / 4; // 4s @420 ≈ 2MB
  const plan = estimateVbbBlackboxPlan(bps, 4, 1280);
  assert(plan.fps === 15, "small 4s stays 15fps");
  assert(plan.compressRounds === 0, "small 4s no compress");
  assert(plan.maxW > 420, `small 4s should widen, got maxW=${plan.maxW}`);
  assert(plan.bytes > 2 * 1024 * 1024, "widened estimate > base");
  assert(plan.bytes <= V2G_BLACKBOX_MAX_BYTES, "widened under 6MB");
}

{
  // 贴近 5–6MB 不应加宽
  const bps = (5.4 * 1024 * 1024) / 8;
  const plan = estimateVbbBlackboxPlan(bps, 8, 1280);
  assert(plan.maxW === 420, `near-cap should stay 420, got ${plan.maxW}`);
}

{
  // 20s：帧上限触发，从 12FPS 起
  const bps = (3 * 1024 * 1024) / 2.5;
  const plan = estimateVbbBlackboxPlan(bps, 20, 1280);
  assert(plan.fps <= 12, `20s should start <=12fps, got ${plan.fps}`);
}

{
  const bps15 = (3.2 * 1024 * 1024) / 2.5;
  const duration = 56;
  const r8 = buildVbbRanges(duration, 7);
  const r7 = buildVbbRanges(duration, 8);
  assert(r8.length === 8, `expect 8 clips, got ${r8.length}`);
  assert(r7.length === 7, `expect 7 clips, got ${r7.length}`);
  const avg8 = r8.reduce((a, x) => a + x.span, 0) / r8.length;
  const avg7 = r7.reduce((a, x) => a + x.span, 0) / r7.length;
  assert(avg7 > avg8, "7 clips should be longer each");
  const est8 = estimateVbbBytes(bps15, avg8, "duration");
  const est7 = estimateVbbBytes(bps15, avg7, "duration");
  assert(est7 >= est8, `7 clips est should >= 8 clips (${est7} vs ${est8})`);
}

{
  assert(sampleSpanFor(0.8) <= 0.8, "sample <= duration for short");
  assert(sampleSpanFor(2) === 2, "under-cap video samples full clip");
  assert(sampleSpanFor(4) === VBB_SAMPLE_SPAN, "4s samples up to 2.5s cap");
  assert(sampleSpanFor(30) === VBB_SAMPLE_SPAN, "sample uses default for long");
}

{
  // 清晰优先：按 CLARITY_FILL 贴紧 6MB，而不是 0.85 安全系数
  const bps15 = (4.93 * 1024 * 1024) / 8.3;
  const clarityMax = Math.max(
    VBB_MIN_SPAN,
    Math.min(VBB_CLARITY_MAX_SPAN, (V2G_BLACKBOX_MAX_BYTES * VBB_CLARITY_FILL) / bps15)
  );
  const oldMax = (V2G_BLACKBOX_MAX_BYTES * VBB_SAFETY) / bps15;
  assert(clarityMax > oldMax + 0.5, `clarity span should extend vs 0.85 safety (${clarityMax} vs ${oldMax})`);
  const est = estimateVbbBytes(bps15, clarityMax, "clarity", 420);
  assert(est >= V2G_BLACKBOX_MAX_BYTES * 0.94, `clarity est should near 6MB, got ${est}`);
  assert(est <= V2G_BLACKBOX_MAX_BYTES * 1.02, `clarity est should not far exceed 6MB, got ${est}`);
}

{
  const bps15 = (3 * 1024 * 1024) / 2.5;
  const clarityMax = Math.max(
    VBB_MIN_SPAN,
    Math.min(VBB_CLARITY_MAX_SPAN, (V2G_BLACKBOX_MAX_BYTES * VBB_CLARITY_FILL) / bps15)
  );
  const durationMax = Math.max(
    clarityMax,
    Math.min(VBB_DURATION_MAX_SPAN, (V2G_BLACKBOX_MAX_BYTES * 0.92) / Math.max(1, bps15 * (10 / 15) * 0.55))
  );
  assert(durationMax >= clarityMax, "duration max >= clarity max");
  const clarityPlan = buildVbbRanges(120, clarityMax);
  const durationPlan = buildVbbRanges(120, durationMax);
  assert(durationPlan.length <= clarityPlan.length, "duration mode should not need more clips");
}

{
  const ladder = vbbWidthLadder(1280);
  assert(ladder[0] === 420, "ladder starts at 420");
  assert(ladder.includes(720), "ladder reaches cap 720");
  assert(ladder.every((w, i) => i === 0 || w > ladder[i - 1]), "ladder increasing");
  const narrow = vbbWidthLadder(320);
  assert(narrow[0] === 320 && narrow[narrow.length - 1] === 320, "srcW<420 ladder = srcW");
}

{
  const bps15 = (5.5 * 1024 * 1024) / 10;
  const wAt10 = resolveVbbWidthForSpan(bps15, 10, 1280);
  const wAt5 = resolveVbbWidthForSpan(bps15, 5, 1280);
  assert(wAt10 === 420, `10s should stay near base, got ${wAt10}`);
  assert(wAt5 > wAt10, `shorter span should allow wider (5s=${wAt5}, 10s=${wAt10})`);
  const span720 = resolveVbbSpanForWidth(bps15, 720, 1280);
  assert(span720 < 10, "720 needs shorter span than 10s");
  assert(resolveVbbWidthForSpan(bps15, span720, 1280) >= 660, "span for 720 should allow near-top width");
}

{
  const nine = Array.from({ length: 9 }, (_, i) => ({ start: i * 12, span: 12 }));
  assert(!shouldReuseVbbFirstPlan(nine, 0), "first clip probes");
  assert(shouldReuseVbbFirstPlan(nine, 1), "middle same-span reuses #01");
  assert(shouldReuseVbbFirstPlan(nine, 7), "penultimate same-span reuses");
  assert(!shouldReuseVbbFirstPlan(nine, 8), "last clip does not reuse");
  const mixed = [{ span: 12 }, { span: 12 }, { span: 12 }, { span: 3.2 }];
  assert(shouldReuseVbbFirstPlan(mixed, 1) && shouldReuseVbbFirstPlan(mixed, 2), "front same-span reuse");
  assert(!shouldReuseVbbFirstPlan(mixed, 3), "remainder last does not reuse");
  const two = [{ span: 3 }, { span: 1 }];
  assert(!shouldReuseVbbFirstPlan(two, 1), "two clips: last never reuses");
  const threeSame = [{ span: 0.8 }, { span: 0.8 }, { span: 0.8 }];
  assert(shouldReuseVbbFirstPlan(threeSame, 1), "3 equal clips: middle reuses");
  assert(!shouldReuseVbbFirstPlan(threeSame, 2), "3 equal clips: last does not reuse");
}

{
  function vbbSpanSchemeKey(span) {
    const s = Math.max(0.5, Number(span) || 0.5);
    return s.toFixed(1);
  }
  assert(vbbSpanSchemeKey(12.04) === "12.0", "span scheme key rounds to 0.1s");
  assert(vbbSpanSchemeKey(12.06) === "12.1", "span scheme key rounds");
  assert(vbbSpanSchemeKey(12.02) === vbbSpanSchemeKey(12.04), "same 0.1s bucket shares key");
}

{
  const cal = { fps: 15, span: 2.5, bytes: 1.8 * 1024 * 1024, compressRounds: 0, maxW: 480 };
  const bps = cal.bytes / cal.span;
  const e25 = estimateVbbBlackboxBytesCalibrated(bps, 2.5, cal, 1280);
  assert(Math.abs(e25 - cal.bytes) < 64 * 1024, `same span should match cal, got ${e25}`);
  const e10 = estimateVbbBlackboxBytesCalibrated(bps, 10, cal, 1280);
  assert(e10 > cal.bytes * 3 && e10 < cal.bytes * 4.2, `10s should scale ~4x, got ${e10}`);
  assert(e10 <= V2G_BLACKBOX_MAX_BYTES, "scaled est under 6MB");
}

console.log("vbb-plan.test.js: all passed");
