"use strict";

/**
 * 外预览：编辑后点播放不应因 keep-seek 关键帧吸附导致播放/暂停狂切。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const vbb = fs.readFileSync(
  path.join(__dirname, "..", "extra-panels", "v2g-suite-src", "40-vbb.js"),
  "utf8"
);

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("enforce 准跳 keep：1ms 到位 + accept 防狂切，无 earlySlop", () => {
  const enforce = vbb.slice(
    vbb.indexOf("function enforceVbbEditPlaybackWindow"),
    vbb.indexOf("function armVbbEditFrameWatch")
  );
  assert.ok(!enforce.includes("earlySlop"));
  assert.ok(enforce.includes("pastSlop"));
  assert.ok(enforce.includes("vbbEditEnforceAcceptTarget"));
  assert.ok(/Math\.abs\(delta\) < 0\.001/.test(enforce));
  assert.ok(enforce.includes("lockVbbPlayUi"));
  // seek 偏早落在下一段前：再推一次并续播，勿停在接点
  assert.ok(enforce.includes("finish._bumped"));
  assert.ok(enforce.includes("bumpTo = again + gap"));
  assert.ok(enforce.includes("vbbVideo.currentTime"));
  assert.ok(enforce.includes("vbbVideo.seeking"));
  // 补偿点必须裸写 currentTime，不能再走 displaySeek 吸附
  const bumpBlock = enforce.slice(enforce.indexOf("finish._bumped"), enforce.indexOf("vbbVideo.play()"));
  assert.ok(!bumpBlock.includes("applyVbbSeek(again"));
});

t("play/pause 事件在 UiLock 下不改按钮文案", () => {
  assert.ok(vbb.includes("let vbbPlayUiLock = false"));
  assert.ok(vbb.includes("if (vbbPlayUiLock) return"));
  assert.ok(vbb.includes("if (!vbbPlayUiLock)"));
  assert.ok(/paintVbbNow[\s\S]*vbbPlay && !vbbPlayUiLock/.test(vbb));
});

t("用户点播放会清 accept，便于重新校正", () => {
  const click = vbb.slice(vbb.indexOf("vbbPlay?.addEventListener(\"click\""), vbb.indexOf("vbbVideo?.addEventListener(\"play\""));
  assert.ok(click.includes("vbbEditEnforceAcceptTarget = null"));
});

console.log(`vbb-preview-play-toggle.test.js: ${n} passed`);
