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

t("提供 pauseFfmpegForInteractiveUi：停预热并中断下载", () => {
  assert.ok(media.includes("function pauseFfmpegForInteractiveUi"));
  assert.ok(media.includes("ffmpegLoadAbort"));
  assert.ok(media.includes("编辑优先：本地编码器稍后再准备"));
  assert.ok(media.includes("beginFfmpegLoadAbort"));
});

t("选片后预热延迟加长，给编辑留窗口", () => {
  assert.ok(media.includes("return 8000"));
  assert.ok(media.includes("return 3500"));
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

console.log(`vbb-edit-ffmpeg-stall.test.js: ${n} passed`);
