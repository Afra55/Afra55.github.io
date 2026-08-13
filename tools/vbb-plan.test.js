#!/usr/bin/env node
"use strict";

/** 纯函数自测：一键黑盒切片规划逻辑（与 extra.js 对齐） */
const V2G_BLACKBOX_MAX_BYTES = 6 * 1024 * 1024;
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

function estimateVbbBytes(bps15, span, mode) {
  const s = Math.max(VBB_MIN_SPAN, Number(span) || VBB_MIN_SPAN);
  if (mode === "clarity") return Math.round(bps15 * s);
  const raw = bps15 * (10 / 15) * 0.55 * s;
  return Math.min(V2G_BLACKBOX_MAX_BYTES, Math.round(raw));
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

// ranges: short video fits one clip
{
  const r = buildVbbRanges(8, 12);
  assert(r.length === 1, "short video should be 1 clip");
  assert(almost(r[0].span, 8), "single clip span = duration");
}

// ranges: even split
{
  const r = buildVbbRanges(60, 20);
  assert(r.length === 3, "60/20 => 3 clips");
  assert(almost(r[0].span, 20) && almost(r[2].span, 20), "equal spans");
  assert(almost(r[0].start + r[0].span + r[1].span + r[2].span, 60, 1e-6), "cover full duration");
}

// ranges: last remainder
{
  const r = buildVbbRanges(50, 20);
  assert(r.length === 3, "50/20 => 3 clips");
  const sum = r.reduce((a, x) => a + x.span, 0);
  assert(almost(sum, 50), "spans sum to duration");
}

// clip cap
{
  const r = buildVbbRanges(600, 0.5);
  assert(r.length === VBB_MAX_CLIPS, "cap at max clips");
  assert(r[0].span > 0.5, "capped clips become longer than target");
}

// estimate clarity grows with span
{
  const bps = 400000;
  const a = estimateVbbBytes(bps, 5, "clarity");
  const b = estimateVbbBytes(bps, 10, "clarity");
  assert(b > a, "longer span => larger clarity estimate");
  assert(estimateVbbBytes(bps, 60, "duration") <= V2G_BLACKBOX_MAX_BYTES, "duration est capped");
}

// sample span never exceeds duration
{
  assert(sampleSpanFor(0.8) <= 0.8, "sample <= duration for short");
  assert(sampleSpanFor(30) === VBB_SAMPLE_SPAN, "sample uses default for long");
  assert(sampleSpanFor(5) <= 5 && sampleSpanFor(5) >= VBB_MIN_SPAN, "mid duration ok");
}

// clarity/duration max relationship
{
  const bps15 = (3 * 1024 * 1024) / 2.5; // 3MB / 2.5s
  const clarityMax = Math.max(
    VBB_MIN_SPAN,
    Math.min(VBB_CLARITY_MAX_SPAN, (V2G_BLACKBOX_MAX_BYTES * VBB_SAFETY) / bps15)
  );
  const durationMax = Math.max(
    clarityMax,
    Math.min(VBB_DURATION_MAX_SPAN, (V2G_BLACKBOX_MAX_BYTES * VBB_SAFETY) / Math.max(1, bps15 * (10 / 15) * 0.55))
  );
  assert(durationMax >= clarityMax, "duration max >= clarity max");
  assert(clarityMax <= VBB_CLARITY_MAX_SPAN, "clarity capped at 20s");
  const clarityPlan = buildVbbRanges(120, clarityMax);
  const durationPlan = buildVbbRanges(120, durationMax);
  assert(durationPlan.length <= clarityPlan.length, "duration mode should not need more clips");
}

console.log("vbb-plan.test.js: all passed");
