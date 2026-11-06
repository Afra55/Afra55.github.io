"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
const ops = fs.readFileSync(path.join(root, "pandoc-bridge/pandoc-ops.js"), "utf8");
const lua = fs.readFileSync(path.join(root, "pandoc-bridge/table-wrap.lua"), "utf8");
const files = JSON.parse(fs.readFileSync(path.join(root, "bridge-files.json"), "utf8"));
const server = fs.readFileSync(path.join(root, "adb-bridge/server.js"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
  console.log(`ok - ${name}`);
}

t("table-wrap.lua 给每列相对宽度", () => {
  assert.ok(lua.includes("function Table"));
  assert.ok(lua.includes("colspecs"));
  assert.ok(lua.includes("0.92"));
});

t("pandoc-ops 注入 lua-filter + 收紧边距", () => {
  assert.ok(ops.includes("resolveTableWrapLua"));
  assert.ok(ops.includes("--lua-filter"));
  assert.ok(ops.includes("geometry:margin=1.2cm"));
  assert.ok(ops.includes("\\\\setlength{\\\\LTleft}{0pt}") || ops.includes("\\setlength{\\LTleft}{0pt}"));
});

t("桥清单与版本含 table-wrap", () => {
  assert.ok(files.files.includes("pandoc-bridge/table-wrap.lua"));
  assert.ok(server.includes('BRIDGE_VERSION = "0.9.134"'));
});

console.log(`pdf-table-wrap.test.js: ${n} passed`);
