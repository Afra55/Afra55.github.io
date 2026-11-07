"use strict";

/** 点「编辑」不得被 FFmpeg 预热锁死整页 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const media = fs.readFileSync(path.join(__dirname, "..", "lib", "extra-media.js"), "utf8");
const vbb = fs.readFileSync(
  path.join(__dirname, "..", "extra-panels", "v2g-suite-src", "40-vbb.js"),
  "utf8"
);
const suite = fs.readFileSync(path.join(__dirname, "..", "extra-panels", "v2g-suite.js"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("提供 pauseFfmpegForInteractiveUi：停 Worker，资源下载继续", () => {
  assert.ok(media.includes("function pauseFfmpegForInteractiveUi"));
  assert.ok(media.includes("ffmpegLoadAbort"));
  assert.ok(media.includes("prefetchFfmpegAssets"));
  assert.ok(media.includes("编码器资源后台继续缓存"));
  assert.ok(media.includes("beginFfmpegLoadAbort"));
  assert.ok(media.includes("ffmpegAssetLoadPromise"));
});

t("选片后先缓存资源，Worker 预热仍延迟给编辑留窗口", () => {
  assert.ok(media.includes("return 8000"));
  assert.ok(media.includes("return 3500"));
  const arm = media.slice(
    media.indexOf("function armFfmpegPrewarmAfterPick"),
    media.indexOf("function scheduleFfmpegPrewarm")
  );
  assert.ok(arm.includes("prefetchFfmpegAssets"));
  assert.ok(arm.includes("400"));
});

t("打开编辑先 pause FFmpeg，且不提前锁 body 滚动", () => {
  const fn = vbb.slice(
    vbb.indexOf("async function openVbbEditEditor"),
    vbb.indexOf("function resetActiveVbbEdit")
  );
  assert.ok(fn.includes("pauseFfmpegForInteractiveUi"));
  assert.ok(fn.includes("data-vbb-edit-boot-cancel"));
  assert.ok(fn.includes("armFfmpegPrewarmAfterPick"));
  assert.ok(!/document\.body\.style\.position\s*=\s*"fixed"/.test(fn));
  assert.ok(suite.includes("pauseFfmpegForInteractiveUi"));
});

t("编辑打开有超时解锁与加载超时，避免卡死无反应", () => {
  assert.ok(vbb.includes("resetStaleVbbEditOpening"));
  assert.ok(vbb.includes("编辑器加载超时"));
  assert.ok(vbb.includes("上次打开编辑超时"));
  assert.ok(vbb.includes("正在处理中，请稍后再点编辑"));
  const ensure = vbb.slice(
    vbb.indexOf("async function ensureVbbVtrimEditor"),
    vbb.indexOf("function prefetchVbbVtrimEditor")
  );
  assert.ok(ensure.includes("Promise.race"));
  assert.ok(ensure.includes("15000"));
});

console.log(`vbb-edit-ffmpeg-stall.test.js: ${n} passed`);
