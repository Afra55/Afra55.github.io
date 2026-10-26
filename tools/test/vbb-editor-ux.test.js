"use strict";

/** 编辑器体验：快捷键 + 预览=成片提示（对齐修复后的可见反馈） */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const vtrim = fs.readFileSync(path.join(__dirname, "..", "lib", "vtrim-editor.js"), "utf8");
const align = fs.readFileSync(path.join(__dirname, "vbb-preview-encode-align.test.js"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("对齐修复仍在：keepRangesLocal / 外预览用 encode keep", () => {
  assert.ok(align.includes("keepRangesLocal 走 keepRangesForEncode"));
  assert.ok(vtrim.includes("keepRangesForEncode("));
  assert.ok(vtrim.includes("ENCODE_BOUND_PAD_SEC"));
});

t("副标题提示预览与成片对齐", () => {
  assert.ok(vtrim.includes("预览与成片对齐"));
  assert.ok(/subEl\.hidden\s*=\s*false/.test(vtrim));
});

t("快捷键：空格播放、Delete 删段、方向键微调进度", () => {
  const key = vtrim.slice(vtrim.indexOf("function onKeyDown"), vtrim.indexOf("let resizeFilmTimer"));
  assert.ok(/e\.key === " " \|\| e\.code === "Space"/.test(key));
  assert.ok(key.includes("togglePlay"));
  assert.ok(key.includes('e.key === "Delete"') && key.includes("Backspace"));
  assert.ok(key.includes("deleteSelectedCutout"));
  assert.ok(key.includes("ArrowLeft") && key.includes("ArrowRight"));
});

t("删中间模式提示可核对接点", () => {
  assert.ok(vtrim.includes("播放接点") || vtrim.includes("播放核对接点"));
  assert.ok(vtrim.includes("与成片一致") || vtrim.includes("预览=成片"));
});

console.log(`vbb-editor-ux.test.js: ${n} passed`);
