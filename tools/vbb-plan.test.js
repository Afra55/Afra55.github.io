#!/usr/bin/env node
"use strict";

/** 纯函数自测：一键黑盒切片规划逻辑（与 extra.js 对齐） */
const V2G_BLACKBOX_MAX_BYTES = 6 * 1024 * 1024;
const V2G_BLACKBOX_BASE_W = 420;
const V2G_BLACKBOX_WIDTH_STEP = 60;
const V2G_BLACKBOX_WIDTH_CAP = 720;
const VBB_SAFETY = 0.85;
const VBB_MAX_CLIPS = 50;
const VBB_MIN_SPAN = 0.5;
const VBB_CLARITY_MAX_SPAN = 20;
const VBB_DURATION_MAX_SPAN = 30;
const VBB_SAMPLE_SPAN = 2.5;

function buildVbbRanges(duration, targetSpan) {
  const d = Number(duration) || 0;
  const part = Math.max(VBB_MIN_SPAN, Number(targetSpan) || VBB_MIN_SPAN);
  if (!(d > 0)) throw new Error("无法读取视频时长");
  const n = Math.min(VBB_MAX_CLIPS, Math.max(1, Math.ceil(d / part - 1e-9)));
  const slice = d / n;
  const ranges = [];
  for (let i = 0; i < n; i++) {
    const start = i * slice;
    const end = i === n - 1 ? d : (i + 1) * slice;
    ranges.push({ start, span: Math.max(VBB_MIN_SPAN, end - start) });
  }
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

function estimateVbbBytes(bps15, span, mode, width, srcW) {
  const s = Math.max(VBB_MIN_SPAN, Number(span) || VBB_MIN_SPAN);
  if (mode === "duration" || mode === "blackbox") {
    const raw = bps15 * (10 / 15) * 0.55 * s;
    return Math.min(V2G_BLACKBOX_MAX_BYTES, Math.round(raw));
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

function sampleSpanFor(duration) {
  return Math.min(VBB_SAMPLE_SPAN, Math.max(VBB_MIN_SPAN, duration * 0.12), duration);
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
  assert(sampleSpanFor(0.8) <= 0.8, "sample <= duration for short");
  assert(sampleSpanFor(30) === VBB_SAMPLE_SPAN, "sample uses default for long");
}

{
  const bps15 = (3 * 1024 * 1024) / 2.5;
  const clarityMax = Math.max(
    VBB_MIN_SPAN,
    Math.min(VBB_CLARITY_MAX_SPAN, (V2G_BLACKBOX_MAX_BYTES * VBB_SAFETY) / bps15)
  );
  const durationMax = Math.max(
    clarityMax,
    Math.min(VBB_DURATION_MAX_SPAN, (V2G_BLACKBOX_MAX_BYTES * VBB_SAFETY) / Math.max(1, bps15 * (10 / 15) * 0.55))
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
  // 高码率：缩短后应能抬宽
  const bps15 = (5.5 * 1024 * 1024) / 10; // ~5.5MB / 10s @420
  const wAt10 = resolveVbbWidthForSpan(bps15, 10, 1280);
  const wAt5 = resolveVbbWidthForSpan(bps15, 5, 1280);
  assert(wAt10 === 420, `10s should stay near base, got ${wAt10}`);
  assert(wAt5 > wAt10, `shorter span should allow wider (5s=${wAt5}, 10s=${wAt10})`);
  const span720 = resolveVbbSpanForWidth(bps15, 720, 1280);
  assert(span720 < 10, "720 needs shorter span than 10s");
  assert(resolveVbbWidthForSpan(bps15, span720, 1280) >= 660, "span for 720 should allow near-top width");
}

console.log("vbb-plan.test.js: all passed");
