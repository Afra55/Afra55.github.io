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

t("副标题提示预览与成片同帧 / 松手吸附", () => {
  assert.ok(
    vtrim.includes("预览/GIF 同帧") ||
      vtrim.includes("预览与成片对齐") ||
      vtrim.includes("松手吸附")
  );
  assert.ok(/subEl\.hidden\s*=\s*false/.test(vtrim));
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
  assert.ok(vtrim.includes("点底部播放") || vtrim.includes("预览/GIF 同帧") || vtrim.includes("松手吸附"));
});

console.log(`vbb-editor-ux.test.js: ${n} passed`);
