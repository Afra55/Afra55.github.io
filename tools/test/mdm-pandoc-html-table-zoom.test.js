"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
const js = fs.readFileSync(path.join(root, "extra-panels/mdm.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles/panels/mdm.css"), "utf8");

assert(/widenPandocHtml/.test(js), "Pandoc HTML 须后处理铺满");
assert(/exportHtmlFullWidthCss/.test(js), "须有共用铺满 CSS");
assert(/mode:\s*isHtml\s*\?\s*"rawhtml"/.test(js) || /rawhtml/.test(js), "Pandoc HTML 须烤流体 SVG");
assert(/gfm\+raw_html/.test(js), "须请求 gfm+raw_html");
assert(/HTML（Pandoc · 铺满屏宽）/.test(js), "菜单须标明 Pandoc HTML 铺满");

assert(/addTableToolbars/.test(js), "须装饰表格工具条");
assert(/mdm-table-zoom/.test(js), "表格须有放大");
assert(/tableToCsv/.test(js), "表格须可下 CSV");
assert(/openTableLightbox/.test(js), "须有表格放大预览");
assert(/mdm-lightbox-tablehost/.test(js), "lightbox 须支持表格");

assert(/mdm-table-toolbar/.test(css), "CSS 含表格工具条");
assert(/mdm-lightbox-tablehost/.test(css), "CSS 含表格放大层");

console.log("mdm-pandoc-html-table-zoom.test.js OK");
