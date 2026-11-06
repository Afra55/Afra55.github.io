"use strict";

/**
 * 黑盒「选择视频」要点几下/刷新才有反应：加载态勿把 file input 设成 opacity:0，
 * 且 early capture 须程序化打开选择器（勿只靠原生 label→input）。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const navCss = fs.readFileSync(path.join(__dirname, "..", "workspace-nav.css"), "utf8");
const styleCss = fs.readFileSync(path.join(__dirname, "..", "style.css"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("加载态 file input 不得 opacity:0（安卓会吞点击）", () => {
  const re = /\.is-tool-assets-loading[\s\S]*?label\.file-btn\s*>\s*input\[type="file"\]\s*\{[^}]*\}/g;
  for (const css of [navCss, styleCss]) {
    const blocks = css.match(re) || [];
    assert.ok(blocks.length >= 1, "须有 loading 态 file input 规则");
    for (const b of blocks) {
      assert.ok(!/opacity:\s*0\s*;/.test(b), `禁止 opacity:0\n${b}`);
      assert.ok(/opacity:\s*0\.01/.test(b), `须用 0.01\n${b}`);
    }
  }
});

t("early capture：嵌套 file-btn 也程序化打开，勿 return 交给原生", () => {
  const fn = app.slice(
    app.indexOf("function bindEarlyToolFileCapture"),
    app.indexOf("bindEarlyToolFileCapture();")
  );
  assert.ok(fn.includes("一律程序化打开") || fn.includes("程序化打开"));
  assert.ok(!/if\s*\(\s*label\.contains\(\s*input\s*\)\s*\)\s*return\s*;/.test(fn));
  assert.ok(fn.includes("showPicker") && fn.includes("fallbackClick"));
  assert.ok(fn.includes("setPanelAssetLoading"));
});

t("loading 粘滞有安全超时清掉", () => {
  assert.ok(app.includes("panelLoadSafetyTimers"));
  assert.ok(/20000/.test(app.slice(app.indexOf("panelLoadSafetyTimers"), app.indexOf("function setToolLoadProgress"))));
});

t("vbb 仍接 early pending-files", () => {
  const vbb = fs.readFileSync(path.join(__dirname, "..", "extra-panels", "v2g-suite-src", "40-vbb.js"), "utf8");
  assert.ok(vbb.includes("devtools:pending-files"));
  assert.ok(vbb.includes('DevToolsPendingFiles?.take?.("vbb")'));
});

console.log(`vbb-pick-click.test.js: ${n} passed`);
