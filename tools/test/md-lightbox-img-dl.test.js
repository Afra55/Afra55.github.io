"use strict";

/**
 * MD 预览：代码/表格放大后，下载菜单须含图片格式（PNG/JPEG/WebP）。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const mdm = fs.readFileSync(path.join(root, "extra-panels", "mdm.js"), "utf8");
const mdread = fs.readFileSync(path.join(root, "mdread", "preview.js"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("MDM：代码/表格放大不隐藏图片格式，且可 html2canvas 导出", () => {
  assert.ok(mdm.includes("function rasterizeLightboxDom"));
  assert.ok(!mdm.includes("代码请用「源码文件」下载"));
  assert.ok(!mdm.includes("表格请用 CSV / HTML 下载"));
  const sync = mdm.slice(mdm.indexOf("function syncDownloadUi"), mdm.indexOf("async function rasterizeLightboxDom"));
  assert.ok(sync.includes('b.hidden = false'));
  assert.ok(!/b\.hidden\s*=\s*isCode\s*\|\|\s*isTable/.test(sync));
  const exp = mdm.slice(mdm.indexOf("async function exportLightbox"), mdm.indexOf("els.preview.addEventListener(\"click\""));
  assert.ok(exp.includes('previewMode === "code" || previewMode === "table"'));
  assert.ok(exp.includes("rasterizeLightboxDom"));
});

t("mdread：下载菜单含 PNG/JPEG/WebP + 源文件", () => {
  assert.ok(mdread.includes('data-fmt="png"'));
  assert.ok(mdread.includes('data-fmt="jpeg"'));
  assert.ok(mdread.includes('data-fmt="webp"'));
  assert.ok(mdread.includes("function rasterizeDomAsImage"));
  assert.ok(mdread.includes("html2canvas.min.js"));
  assert.ok(mdread.includes("PNG 图片"));
});

console.log(`md-lightbox-img-dl.test.js: ${n} passed`);
