#!/usr/bin/env node
"use strict";
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

const ROOT = path.resolve(__dirname, "..");
const app = fs.readFileSync(path.join(ROOT, "tools/app.js"), "utf8");
const extra = fs.readFileSync(path.join(ROOT, "tools/extra.js"), "utf8");
const lazy = fs.readFileSync(path.join(ROOT, "tools/lib/lazy-scripts.js"), "utf8");
const panel = fs.readFileSync(path.join(ROOT, "tools/panels/markdown.html"), "utf8");

execSync("node --check tools/app.js", { cwd: ROOT, stdio: "inherit" });
execSync("node --check tools/extra.js", { cwd: ROOT, stdio: "inherit" });

assert(panel.includes('id="md-input"') && panel.includes('id="md-preview"'), "panel missing md fields");
assert(app.includes("initMarkdownPanel"), "app.js missing initMarkdownPanel");
assert(app.includes("markdown: initMarkdownPanel"), "CORE_PANEL_INIT missing markdown");
assert(app.includes("renderMarkdownPreview"), "app.js missing renderMarkdownPreview");
assert(lazy.includes('"markdown"'), "lazy-scripts STANDALONE_NO_EXTRA missing markdown");
assert(extra.includes('bindPanel("markdown"'), "extra.js missing markdown bind");
assert(extra.includes("mdInited"), "extra.js should skip when mdInited");

console.log("markdown-smoke ok");
