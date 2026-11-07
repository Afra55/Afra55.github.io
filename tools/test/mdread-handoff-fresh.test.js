"use strict";

/** 工具入口 ?fresh=1 不误开旧交接；交接有 60s 时效 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const app = fs.readFileSync(path.join(__dirname, "..", "mdread", "app.js"), "utf8");
const tool = fs.readFileSync(path.join(__dirname, "..", "mdread-tool.js"), "utf8");
const reg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "registry", "tools.json"), "utf8"));

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("工具入口带 fresh=1", () => {
  assert.ok(tool.includes("mdread/?fresh=1"));
  assert.equal(reg.meta.mdread.launchUrl, "./mdread/?fresh=1");
});

t("阅读页：fresh 清交接；交接有时效", () => {
  assert.ok(app.includes("wantFresh"));
  assert.ok(app.includes("HANDOFF_MAX_AGE_MS"));
  assert.ok(app.includes("clearHandoffStores"));
  assert.ok(app.includes("Date.now() - t > HANDOFF_MAX_AGE_MS"));
});

console.log(`mdread-handoff-fresh.test.js: ${n} passed`);
