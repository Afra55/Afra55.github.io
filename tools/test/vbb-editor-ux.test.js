"use strict";

/** 编辑器体验：快捷键 + 预览=成片提示（对齐修复后的可见反馈） */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const vtrim = fs.readFileSync(path.join(__dirname, "..", "lib", "vtrim-editor.js"), "utf8");
const align = fs.readFileSync(path.join(__dirname, "vbb-preview-encode-align.test.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "styles", "panels", "vtrim.css"), "utf8");

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

t("编辑器头副标题已去掉（省纵向空间）", () => {
  assert.ok(!/vtrim-editor-sub/.test(vtrim) || /subEl\.hidden\s*=\s*true/.test(vtrim));
  assert.ok(!vtrim.includes("拖黄柄裁片头片尾"));
  assert.ok(!vtrim.includes("预览/GIF 同帧"));
  assert.ok(!vtrim.includes("拖红柄看该帧"));
  assert.ok(!vtrim.includes("点选红段后，用上方"));
  assert.ok(!vtrim.includes("cut-nudge-label"));
});

t("松手吸附有视觉反馈（pulse/tip 短留）", () => {
  assert.ok(vtrim.includes("flashSnapFeedback"));
  assert.ok(vtrim.includes("tipHoldKind"));
  assert.ok(vtrim.includes("snapNearCutouts"));
  assert.ok(css.includes(".vtrim-timeline.is-pulse"));
  assert.ok(css.includes(".vtrim-timeline.is-snap"));
});

t("快捷键：空格播放、Delete 删段、方向键微调进度", () => {
  const key = vtrim.slice(vtrim.indexOf("function onKeyDown"), vtrim.indexOf("let resizeFilmTimer"));
  assert.ok(/e\.key === " " \|\| e\.code === "Space"/.test(key));
  assert.ok(key.includes("togglePlay"));
  assert.ok(key.includes('e.key === "Delete"') && key.includes("Backspace"));
  assert.ok(key.includes("deleteSelectedCutout"));
  assert.ok(key.includes("ArrowLeft") && key.includes("ArrowRight"));
});

t("删中间可跳到接点再手动播放", () => {
  assert.ok(vtrim.includes("跳到接点") || vtrim.includes("seekCutJoinPreview"));
  assert.ok(vtrim.includes("flashSnapFeedback") || vtrim.includes("snapNearCutouts"));
  assert.ok(vtrim.includes("起始接点") && vtrim.includes("结尾接点"));
});

console.log(`vbb-editor-ux.test.js: ${n} passed`);
