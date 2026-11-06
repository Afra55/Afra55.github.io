"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const panel = fs.readFileSync(path.join(__dirname, "../panels/json.html"), "utf8");
const app = fs.readFileSync(path.join(__dirname, "../app.js"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
  console.log(`ok - ${name}`);
}

t("A/B 各有下载按钮", () => {
  assert.ok(panel.includes('id="json-dl-a"'));
  assert.ok(panel.includes('id="json-dl-b"'));
});

t("下载会美化/修复并写出 .json", () => {
  assert.ok(app.includes("function downloadJsonPane"));
  assert.ok(app.includes("downloadJsonText"));
  assert.ok(app.includes("application/json"));
  assert.ok(app.includes("json-${label.toLowerCase()}-") || app.includes("json-${label.toLowerCase()}-${Date.now()}.json"));
});

console.log(`json-download.test.js: ${n} passed`);
