"use strict";

/** MD 阅读：侧栏点击只开新窗，不切面板、不靠 auto-open */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const tools = path.join(__dirname, "..");
const app = fs.readFileSync(path.join(tools, "app.js"), "utf8");
const reg = JSON.parse(fs.readFileSync(path.join(tools, "registry/tools.json"), "utf8"));
const mdTool = fs.readFileSync(path.join(tools, "mdread-tool.js"), "utf8");
const lazy = fs.readFileSync(path.join(tools, "lib/lazy-scripts.js"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("registry 带 launchUrl", () => {
  assert.equal(reg.meta.mdread.launchUrl, "./mdread/");
});

t("navigateTo 对 launchUrl 提前返回", () => {
  assert.ok(app.includes("function toolLaunchUrl"));
  assert.ok(app.includes("function openToolLaunchUrl"));
  const nav = app.slice(app.indexOf("function navigateTo"), app.indexOf("let lastNavSearchQuery"));
  assert.ok(nav.includes("toolLaunchUrl(nextTool)"));
  assert.ok(nav.includes("return;"));
});

t("applyRoute 深链开一次后回退真实工具", () => {
  assert.ok(app.includes("fallbackToolAfterLaunch"));
  assert.ok(app.includes("launchUrl 深链"));
});

t("mdread-tool 不再 route auto-open", () => {
  assert.ok(!mdTool.includes("devtools:route"));
  assert.ok(!mdTool.includes("DevToolsOpenExternalSite"));
  assert.ok(lazy.includes('EXTERNAL_SITE_TOOLS = new Set([])') || /EXTERNAL_SITE_TOOLS = new Set\(\[\]\)/.test(lazy));
});

console.log(`mdread-launch-only.test.js: ${n} passed`);
