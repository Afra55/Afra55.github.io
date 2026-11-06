"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const mdm = fs.readFileSync(path.join(__dirname, "../extra-panels/mdm.js"), "utf8");
let n = 0;
function t(name, fn) {
  fn();
  n += 1;
  console.log(`ok - ${name}`);
}

t("HTML 导出用 PNG 占位注入，不再依赖 height=auto SVG", () => {
  assert.ok(mdm.includes('kind: "png"'));
  assert.ok(mdm.includes("data:image/png;base64,${im.b64}") || mdm.includes("data:image/png;base64,${im.b64}"));
  assert.ok(mdm.includes("injectHtmlChartPlaceholders"));
  assert.ok(mdm.includes('mode: "html", scale: 2') || mdm.includes("{ mode: \"html\", scale: 2 }"));
});

t("mermaidSvgForHtmlEmbed 不写 height=auto", () => {
  const fn = mdm.slice(mdm.indexOf("function mermaidSvgForHtmlEmbed"), mdm.indexOf("async function rasterizeSvgMarkup"));
  assert.ok(fn.includes('removeAttribute("height")'));
  assert.ok(!/setAttribute\("height",\s*"auto"\)/.test(fn));
  assert.ok(fn.includes("aspect-ratio"));
});

t("导出页浅色配色", () => {
  assert.ok(mdm.includes("function exportDocThemeVars"));
  assert.ok(mdm.includes('bg: "#ffffff"'));
});

console.log(`mdm-html-chart-export.test.js: ${n} passed`);
