"use strict";

/** MDM「用阅读页打开」走应用窗；点预览默认渲染 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const mdm = fs.readFileSync(path.join(root, "extra-panels", "mdm.js"), "utf8");
const manifest = fs.readFileSync(path.join(root, "mdread", "manifest.webmanifest"), "utf8");
const app = fs.readFileSync(path.join(root, "mdread", "app.js"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("mdread manifest 含 launch_handler", () => {
  assert.ok(manifest.includes("launch_handler"));
  assert.ok(manifest.includes("focus-existing") || manifest.includes("navigate-existing"));
});

t("openInMdRead 不用 about:blank，用 popup 命名窗", () => {
  const open = mdm.slice(mdm.indexOf("function openMdReadAppWindow"), mdm.indexOf("function writeMdReadHandoff"));
  assert.ok(open.includes("popup=yes"));
  assert.ok(open.includes("devtools-mdread"));
  assert.ok(!open.includes("about:blank"));
});

t("applyViewMode 对预览强制 renderPreview(true)", () => {
  const apply = mdm.slice(mdm.indexOf("function applyViewMode"), mdm.indexOf("(function bindSplitter"));
  assert.ok(/renderPreview\(\s*true\s*\)/.test(apply));
});

t("阅读页可接晚到的 handoff", () => {
  assert.ok(app.includes('addEventListener("storage"'));
  assert.ok(app.includes("consumeHandoff"));
});

console.log(`mdread-pwa-open.test.js: ${n} passed`);
