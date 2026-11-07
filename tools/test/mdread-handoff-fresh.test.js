"use strict";

/** 工具入口空页；仅 MDM ?handoff=1 才接交接 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const app = fs.readFileSync(path.join(__dirname, "..", "mdread", "app.js"), "utf8");
const tool = fs.readFileSync(path.join(__dirname, "..", "mdread-tool.js"), "utf8");
const mdm = fs.readFileSync(path.join(__dirname, "..", "extra-panels", "mdm.js"), "utf8");
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

t("阅读页默认不接交接：须 handoff/from=mdm", () => {
  assert.ok(app.includes("allowHandoff"));
  assert.ok(app.includes('q.has("handoff")') || app.includes('has("handoff")'));
  assert.ok(app.includes('from") === "mdm"') || app.includes("from=mdm") || app.includes('get("from") === "mdm"'));
  assert.ok(app.includes("clearHandoffStores"));
  assert.ok(app.includes("!allowHandoff"));
});

t("MDM 打开阅读页带 handoff=1", () => {
  assert.ok(mdm.includes("mdread/?handoff=1"));
});

console.log(`mdread-handoff-fresh.test.js: ${n} passed`);
