"use strict";

/** Mermaid 角标放大 + lightbox 多格式下载 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "extra-panels", "mdm.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "styles", "panels", "mdm.css"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("渲染后挂角标「放大」，不抢双击选词", () => {
  assert.ok(src.includes("function decorateMermaidDiv"));
  assert.ok(src.includes("function mountMermaidFigure"));
  assert.ok(src.includes("mdm-mermaid-zoom"));
  assert.ok(src.includes('aria-label", "放大图表"'));
  assert.ok(css.includes(".mdm-mermaid-zoom"));
  const mount = src.slice(src.indexOf("function mountMermaidFigure"), src.indexOf("async function renderMermaidBlocks"));
  assert.ok(mount.includes("decorateMermaidDiv(div)"));
});

t("角标点击打开图表 lightbox（非双击图表）", () => {
  assert.ok(src.includes("function openMermaidLightbox"));
  assert.ok(src.includes('closest?.(".mdm-mermaid-zoom")'));
  assert.ok(src.includes("mermaidSvgForExport"));
  // 图表不走图片双击
  assert.ok(src.includes('img.closest?.(".mdm-mermaid")'));
});

t("lightbox 支持滚轮/拖拽且提供 SVG/PNG/JPEG/WebP 下载", () => {
  assert.ok(src.includes('id="mdm-lightbox-dl"'));
  assert.ok(src.includes('data-fmt="svg"'));
  assert.ok(src.includes('data-fmt="png"'));
  assert.ok(src.includes('data-fmt="jpeg"'));
  assert.ok(src.includes('data-fmt="webp"'));
  assert.ok(src.includes("function exportLightbox"));
  assert.ok(src.includes("rasterizeSvgMarkup"));
  assert.ok(src.includes("rasterizeSvgMarkupHtml2Canvas"));
  assert.ok(src.includes("foreignObject"));
  assert.ok(src.includes('"wheel"'));
  assert.ok(src.includes("pointerdown"));
  assert.ok(css.includes(".mdm-lightbox-dl-menu"));
});

t("导出尺寸走纯函数，避免 width=100% 压成屏上缩略", () => {
  assert.ok(src.includes("MP.measureSvgExportSize"));
  const pure = fs.readFileSync(path.join(__dirname, "..", "lib", "mdm-pure.js"), "utf8");
  assert.ok(pure.includes("function measureSvgExportSize"));
});

t("角标导出长图时忽略", () => {
  assert.ok(src.includes('data-html2canvas-ignore", "true"') || src.includes("data-html2canvas-ignore"));
  const deco = src.slice(src.indexOf("function decorateMermaidDiv"), src.indexOf("function mountMermaidFigure"));
  assert.ok(deco.includes("html2canvas-ignore"));
});

console.log(`mdm-mermaid-zoom.test.js: ${n} passed`);
