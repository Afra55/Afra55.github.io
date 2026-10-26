"use strict";

/** 松手帧格：按片源真实 fps 吸附，拿不到回退 30 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const vtrim = fs.readFileSync(path.join(__dirname, "..", "lib", "vtrim-editor.js"), "utf8");
const vbb = fs.readFileSync(path.join(__dirname, "..", "extra-panels", "v2g-suite-src", "40-vbb.js"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

function loadFns() {
  const a = vtrim.indexOf("const DEFAULT_FRAME_FPS");
  const b = vtrim.indexOf("function toast(msg)");
  assert.ok(a > 0 && b > a);
  // eslint-disable-next-line no-new-func
  return new Function(
    `${vtrim.slice(a, b)}; return { normalizeSourceFps, frameSnapSecFromFps, DEFAULT_FRAME_FPS, FRAME_SNAP_SEC };`
  )();
}

t("导出 normalizeSourceFps / frameSnapSecFromFps", () => {
  assert.ok(vtrim.includes("function normalizeSourceFps"));
  assert.ok(vtrim.includes("function frameSnapSecFromFps"));
  assert.ok(vtrim.includes("DEFAULT_FRAME_FPS"));
  assert.ok(vtrim.includes("applySourceFps"));
  assert.ok(vtrim.includes("detectAndApplySourceFps"));
  assert.ok(vtrim.includes("normalizeSourceFps,"));
});

t("常见档规整：24/25/30/60，异常回 0", () => {
  const { normalizeSourceFps, frameSnapSecFromFps, DEFAULT_FRAME_FPS, FRAME_SNAP_SEC } = loadFns();
  assert.equal(DEFAULT_FRAME_FPS, 30);
  assert.ok(Math.abs(FRAME_SNAP_SEC - 1 / 30) < 1e-12);
  assert.equal(normalizeSourceFps(23.976), 24);
  assert.equal(normalizeSourceFps(24), 24);
  assert.equal(normalizeSourceFps(25), 25);
  assert.equal(normalizeSourceFps(29.97), 30);
  assert.equal(normalizeSourceFps(30), 30);
  assert.equal(normalizeSourceFps(59.94), 60);
  assert.equal(normalizeSourceFps(60), 60);
  assert.equal(normalizeSourceFps(0), 0);
  assert.equal(normalizeSourceFps(2), 0);
  assert.ok(Math.abs(frameSnapSecFromFps(24) - 1 / 24) < 1e-12);
  assert.ok(Math.abs(frameSnapSecFromFps(0) - 1 / 30) < 1e-12);
  assert.ok(Math.abs(frameSnapSecFromFps(60) - 1 / 60) < 1e-12);
});

t("打开编辑器用 opts.srcFps，并可后台探测", () => {
  assert.ok(vtrim.includes("opts.srcFps"));
  assert.ok(vtrim.includes("applySourceFps(knownFps)"));
  assert.ok(vtrim.includes("detectAndApplySourceFps(file)"));
  assert.ok(vbb.includes("srcFps: openSrcFps"));
  assert.ok(vbb.includes("detectSourceFps(item.file)"));
});

t("snapToFrameGrid 走可变 frameSnapSec", () => {
  const fn = vtrim.slice(
    vtrim.indexOf("function snapToFrameGrid"),
    vtrim.indexOf("function snapNearCutouts")
  );
  assert.ok(fn.includes("frameSnapSec"));
  assert.ok(!/FRAME_SNAP_SEC\s*\)/.test(fn) || fn.includes("frameSnapSec > 0 ? frameSnapSec"));
});

console.log(`vbb-snap-src-fps.test.js: ${n} passed`);
