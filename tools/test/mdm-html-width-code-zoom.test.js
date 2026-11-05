"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
const js = fs.readFileSync(path.join(root, "extra-panels/mdm.js"), "utf8");
const css = fs.readFileSync(path.join(root, "styles/panels/mdm.css"), "utf8");

assert(/mermaidSvgForHtmlEmbed/.test(js), "须有 HTML 流体 SVG 嵌入");
assert(/width:\s*100%!important/.test(js) || /width:100%!important/.test(js), "导出 HTML CSS 须强制铺满");
assert(/max-width:none!important/.test(js), "导出 HTML 不得再锁 max-width");
assert(/mode === "html"[\s\S]*mermaidSvgForHtmlEmbed/.test(js), "HTML 导出须用流体 SVG");

assert(/mdm-code-toolbar/.test(js), "代码块须有工具条");
assert(/mdm-code-zoom/.test(js), "代码块须有放大");
assert(/mdm-code-dl/.test(js), "代码块须有下载");
assert(/openCodeLightbox/.test(js), "须有代码放大预览");
assert(/mdm-lightbox-codehost/.test(js), "lightbox 须支持代码模式");
assert(/mdm-mermaid-dl/.test(js), "图表须有下载角标");

assert(/mdm-code-toolbar/.test(css), "CSS 含代码工具条");
assert(/mdm-lightbox-codehost/.test(css), "CSS 含代码放大层");
assert(/mdm-mermaid-dl/.test(css), "CSS 含图表下载角标");

console.log("mdm-html-width-code-zoom.test.js OK");
