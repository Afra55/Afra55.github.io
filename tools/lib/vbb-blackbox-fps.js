/**
 * 黑盒帧率硬规则（与 v2g-suite-src/10-shared-encode.js 对齐）。
 * Node 单测 / CI 用；浏览器套件内另有同名实现，改一处必须两边一起改。
 */
"use strict";

const HIGH_PRIMARY_SPAN_SEC = 16;
const MID_SPAN_SEC = 24;
const DEFAULT_FPS_LIST = [20, 15, 12];
const RETRY_MIN_FPS = 12;

/** ≈25 → 25/12.5；≈30 → 30/15/12；其它 → 20/15/12 */
function blackboxFpsCandidates(srcFps) {
  const src = Number(srcFps) || 0;
  if (src >= 24.2 && src <= 25.8) return [25, 12.5];
  if (src >= 29.2 && src <= 30.8) return [30, 15, 12];
  return DEFAULT_FPS_LIST.slice();
}

function blackboxPrimaryFps(span, srcFps) {
  const s = Number(span) || 0;
  const cands = blackboxFpsCandidates(srcFps);
  if (!cands.length) return RETRY_MIN_FPS;
  if (s <= HIGH_PRIMARY_SPAN_SEC + 0.01) return cands[0];
  if (s <= MID_SPAN_SEC + 0.01) return cands.length >= 2 ? cands[1] : cands[0];
  return cands[cands.length - 1];
}

function blackboxFpsFloor(span, srcFps) {
  void span;
  const cands = blackboxFpsCandidates(srcFps);
  const last = cands[cands.length - 1];
  return last > 0 ? last : RETRY_MIN_FPS;
}

function resolveBlackboxFpsList(span, srcFps) {
  const primary = blackboxPrimaryFps(span, srcFps);
  const list = blackboxFpsCandidates(srcFps).filter((f) => f <= primary + 0.01);
  return list.length ? list : [blackboxFpsFloor(span, srcFps)];
}

/**
 * 成片标称 fps 是否落在片源允许集合（含 GIF 厘秒量化后的有效值）。
 * 例：15 → 有效 ≈14.3；12 → 12.5；12.5 → 12.5；25 → 25。
 */
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

/** ≤24s 中档及以上视为「流畅档」，禁止为换宽再降到更低档 */
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
  blackboxPrimaryFps,
  blackboxFpsFloor,
  resolveBlackboxFpsList,
  gifEffectivePlaybackFps,
  allowedGifFpsSet,
  assertGifFpsAllowed,
  isFluentTierFps,
};
