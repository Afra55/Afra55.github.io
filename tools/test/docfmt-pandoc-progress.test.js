"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
const lib = fs.readFileSync(path.join(root, "lib/pandoc-export-progress.js"), "utf8");
const docfmt = fs.readFileSync(path.join(root, "extra-panels/docfmt.js"), "utf8");
const mdm = fs.readFileSync(path.join(root, "extra-panels/mdm.js"), "utf8");
const lazy = fs.readFileSync(path.join(root, "lib/lazy-scripts.js"), "utf8");
const html = fs.readFileSync(path.join(root, "panels/docfmt.html"), "utf8");
const css = fs.readFileSync(path.join(root, "styles/panels/docfmt.css"), "utf8");

assert(/DevToolsPandocExportProgress/.test(lib), "共享进度模块须挂到全局");
assert(/\/pandoc\/progress/.test(lib), "须轮询 /pandoc/progress");
assert(/Escape/.test(lib), "Esc 应可取消");

assert(/pandocprogress/.test(lazy), "lazy-scripts 须登记 pandocprogress");
assert(/docfmt:\s*\[[^\]]*pandocprogress/.test(lazy), "docfmt 须加载 pandocprogress");
assert(/mdm:\s*\[[^\]]*pandocprogress/.test(lazy), "mdm 须加载 pandocprogress");

assert(/pandocConvertWithProgress/.test(docfmt), "docfmt 须走带进度的 convert");
assert(/DevToolsPandocExportProgress/.test(docfmt), "docfmt 须调用共享进度壳");
assert(/AbortController/.test(docfmt), "docfmt 须支持取消");
assert(/已取消导出/.test(docfmt), "PDF 取消文案");
assert(/docfmt-pandoc-modal/.test(html), "docfmt 面板须有进度弹框宿主");
assert(/gif-shared\.css/.test(css), "docfmt 样式须含进度条");

assert(/DevToolsPandocExportProgress/.test(mdm), "mdm 须改用共享进度壳");
assert(!/mdm-pandoc-export-alive/.test(mdm) || /idPrefix:\s*"mdm-pandoc-export"/.test(mdm), "mdm 不应再内联整段进度 DOM");

console.log("docfmt-pandoc-progress.test.js OK");
