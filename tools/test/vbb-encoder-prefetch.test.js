"use strict";

/** 编码器准备：资源与 Worker 拆开，编辑不中断 31MB 缓存 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const media = fs.readFileSync(path.join(__dirname, "..", "lib", "extra-media.js"), "utf8");
const vbb = fs.readFileSync(
  path.join(__dirname, "..", "extra-panels", "v2g-suite-src", "40-vbb.js"),
  "utf8"
);

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("ensureFfmpegAssets 单飞且资源下载不绑 abort signal", () => {
  const fn = media.slice(
    media.indexOf("async function ensureFfmpegAssets"),
    media.indexOf("function beginFfmpegLoadAbort")
  );
  assert.ok(fn.includes("ffmpegAssetLoadPromise"));
  assert.ok(fn.includes("loadEngineBuffer"));
  assert.ok(fn.includes(",\n            null") || fn.includes(", null)"));
  assert.ok(fn.includes("已取消"));
});

t("pause 编辑仍 prefetch 资源", () => {
  const fn = media.slice(
    media.indexOf("function pauseFfmpegForInteractiveUi"),
    media.indexOf("function armFfmpegPrewarmAfterPick")
  );
  assert.ok(fn.includes("prefetchFfmpegAssets()"));
  assert.ok(fn.includes("ffmpegEngineEpoch += 1"));
});

t("阶段文案：导出编辑片 / 下载 MB 可见", () => {
  assert.ok(vbb.includes("先导出编辑片"));
  assert.ok(vbb.includes("①导出编辑片"));
  assert.ok(vbb.includes("①准备编码器 ·"));
});

console.log(`vbb-encoder-prefetch.test.js: ${n} passed`);
