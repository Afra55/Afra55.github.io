"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "extra-panels", "imgrecolor.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "panels", "imgrecolor.html"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("BiRefNet 走 AutoModel 专用路径，不用 background-removal pipeline", () => {
  assert.ok(/kind:\s*"biref"/.test(src));
  assert.ok(/getBiRefBundle|segmentBiRef/.test(src));
  assert.ok(/AutoModel\.from_pretrained/.test(src));
  assert.ok(/input_image/.test(src) && /output_image/.test(src));
  // 全量模型不得再挂到 tj+pipeline
  assert.ok(/BiRefNet_lite-ONNX/.test(src));
  assert.ok(/BiRefNet-ONNX/.test(src));
});

t("纯数字大体积错误映射为内存提示", () => {
  assert.ok(/512048000|onlyNum|约需 \$\{fmtMB/.test(src) || /bytes >= 50 \* 1048576/.test(src));
  assert.ok(/内存\/缓存不足|内存不足/.test(src));
});

t("面板提供 Lite 与全量选项", () => {
  assert.ok(/birefnet_full/.test(html));
  assert.ok(/BiRefNet Lite/.test(html));
  assert.ok(/BiRefNet 全量/.test(html));
});

console.log(`imgrecolor-birefnet.test.js: ${n} passed`);
