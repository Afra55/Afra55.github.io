"use strict";

/**
 * 工具懒加载：大脚本须有下载字节进度，避免「正在加载」假死。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const lazy = fs.readFileSync(path.join(__dirname, "..", "lib", "lazy-scripts.js"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const panel = fs.readFileSync(path.join(__dirname, "..", "index.html"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("loadScript 支持 fetch 流式进度与体积提示", () => {
  assert.ok(lazy.includes("SCRIPT_SIZE_HINT"));
  assert.ok(lazy.includes("formatDlBytes"));
  assert.ok(lazy.includes("scriptProgressListeners"));
  assert.ok(lazy.includes("useFetchProgress"));
  assert.ok(lazy.includes("getReader"));
  assert.ok(lazy.includes("./extra-panels/v2g-suite.js"));
});

t("黑盒模块有友好下载文案并映射进度", () => {
  assert.ok(lazy.includes("黑盒 GIF 模块（约 650KB）"));
  assert.ok(lazy.includes("function toolScriptLabel"));
  assert.ok(lazy.includes("loadToolScript(id, (ratio, text)"));
});

t("进度条显示百分比，并缓存 delay 前的回调", () => {
  assert.ok(app.includes("lastPct"));
  assert.ok(app.includes("lastLabel"));
  assert.ok(app.includes("heavyFirstLoad"));
  assert.ok(app.includes("includes(\"%\")"));
  assert.ok(panel.includes("devtools-tool-load-hint"));
  assert.ok(panel.includes("不是卡住"));
});

console.log(`tool-load-progress.test.js: ${n} passed`);
