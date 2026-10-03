/**
 * 黑盒帧率硬规则（与 v2g-suite-src/10-shared-encode.js 对齐）。
 * Node 单测 / CI 用；浏览器套件内另有同名实现，改一处必须两边一起改。
 */
"use strict";

const HIGH_PRIMARY_SPAN_SEC = 16;
const MID_SPAN_SEC = 24;
const DEFAULT_FPS_LIST = [20, 15, 12];
const RETRY_MIN_FPS = 12;

/** ≈24 电影 → 24/12；≈25 屏录 → 25/12.5；≈30 → 30/15/12；其它 → 20/15/12 */
function blackboxFpsCandidates(srcFps) {
  const src = Number(srcFps) || 0;
  if (src >= 23.5 && src < 24.5) return [24, 12];
  if (src >= 24.5 && src <= 25.8) return [25, 12.5];
  if (src >= 29.2 && src <= 30.8) return [30, 15, 12];
  return DEFAULT_FPS_LIST.slice();
}

/** 电影/摄像内容（非典型 25 屏录）→ 压缩更敢用 lossy */
function blackboxIsMovieLike(srcFps) {
  const src = Number(srcFps) || 0;
  if (!(src > 0)) return true;
  if (src >= 23.5 && src < 24.5) return true;
  if (src >= 29.2 && src <= 30.8) return true;
  if (src >= 47 && src <= 60.5) return true;
  if (src >= 24.5 && src <= 25.8) return false;
  return true;
}

function blackboxPrimaryFps(span, srcFps) {
  void span;
  const cands = blackboxFpsCandidates(srcFps);
  return cands[0] || RETRY_MIN_FPS;
}

function blackboxFpsFloor(span, srcFps) {
  void span;
  const cands = blackboxFpsCandidates(srcFps);
  const last = cands[cands.length - 1];
  return last > 0 ? last : RETRY_MIN_FPS;
}

function resolveBlackboxFpsList(span, srcFps) {
  const cands = blackboxFpsCandidates(srcFps);
  return cands.length ? cands.slice() : [blackboxFpsFloor(span, srcFps)];
}

function gifEffectivePlaybackFps(fps) {
  const f = Math.max(1, Number(fps) || 15);
  const cs = Math.max(1, Math.round(100 / f));
  return Math.round((100 / cs) * 10) / 10;
}

function allowedGifFpsSet(srcFps) {
  const cands = blackboxFpsCandidates(srcFps);
  const set = new Set();
  for (const f of cands) {
    set.add(f);
    set.add(gifEffectivePlaybackFps(f));
  }
  return set;
}

function assertGifFpsAllowed(srcFps, outFps, label = "gif fps") {
  const out = Number(outFps);
  if (!(out > 0)) throw new Error(`${label}: missing fps`);
  const allowed = allowedGifFpsSet(srcFps);
  const eff = gifEffectivePlaybackFps(out);
  if (![out, eff].some((x) => [...allowed].some((a) => Math.abs(a - x) < 0.15))) {
    throw new Error(
      `${label}: src=${srcFps} out=${out}(eff=${eff}) not in [${[...allowed].join(", ")}]`
    );
  }
  return true;
}

function isFluentTierFps(span, srcFps, fps) {
  const s = Number(span) || 0;
  if (s > MID_SPAN_SEC + 0.01) return false;
  const cands = blackboxFpsCandidates(srcFps);
  const mid = cands.length >= 2 ? cands[1] : cands[0];
  return Number(fps) >= mid - 0.01;
}

module.exports = {
  HIGH_PRIMARY_SPAN_SEC,
  MID_SPAN_SEC,
  DEFAULT_FPS_LIST,
  blackboxFpsCandidates,
  blackboxIsMovieLike,
  blackboxPrimaryFps,
  blackboxFpsFloor,
  resolveBlackboxFpsList,
  gifEffectivePlaybackFps,
  allowedGifFpsSet,
  assertGifFpsAllowed,
  isFluentTierFps,
};
