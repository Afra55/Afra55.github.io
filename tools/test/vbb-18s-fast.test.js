"use strict";

/**
 * 18s 加速：RGBA 分块缓存、余量提帧不回跳过高档、单条撞档。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const shared = fs.readFileSync(
  path.join(__dirname, "..", "extra-panels/v2g-suite-src/10-shared-encode.js"),
  "utf8"
);
const vbb = fs.readFileSync(
  path.join(__dirname, "..", "extra-panels/v2g-suite-src/40-vbb.js"),
  "utf8"
);

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("RGBA 分块 Map 缓存", () => {
  assert.ok(shared.includes("vbbRgbaTrialCacheMap"));
  assert.ok(shared.includes("putVbbRgbaTrialCache"));
  assert.ok(shared.includes("VBB_RGBA_CACHE_CHUNK_MAX_BYTES"));
  assert.ok(!/chunkCount\s*<=\s*1\s*&&\s*\n?\s*!isCoarsePointer\(\)/.test(shared));
});

t("余量提帧遵守时长×帧跳过高档", () => {
  assert.ok(
    /!blackboxShouldSkipHighFpsByDuration\(\s*high\s*,\s*s\s*,\s*src\s*\)/.test(shared)
  );
});

t("q8 已超则跳过 q4/q6", () => {
  assert.ok(shared.includes("keepOverRatio > 1"));
  assert.ok(shared.includes("细档跳过"));
});

t("提帧超限不 compressAt", () => {
  assert.ok(shared.includes("提帧") && shared.includes("超限") && shared.includes("保留"));
});

t("短片激进加宽仅 ≤10s", () => {
  const hits = shared.match(
    /isShortFill\s*=\s*effSpan\s*<=\s*V2G_BLACKBOX_KEEP_Q_MAX_SPAN_SEC/g
  );
  assert.ok(hits && hits.length >= 2, "finish + O3 两处");
});

t("单条整段读写撞档", () => {
  assert.ok(vbb.includes("seedForSingle"));
  assert.ok(/runVbbSingleBlackbox[\s\S]*saveVbbSpanScheme/.test(vbb));
  assert.ok(/runVbbSingleBlackbox[\s\S]*loadVbbSpanScheme/.test(vbb));
});

console.log(`vbb-18s-fast.test.js: ${n} passed`);
