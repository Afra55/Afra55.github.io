#!/usr/bin/env node
"use strict";
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

const ROOT = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(ROOT, "tools/index.html"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "tools/app.js"), "utf8");
const lazy = fs.readFileSync(path.join(ROOT, "tools/lib/lazy-scripts.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "tools/workspace-nav.css"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "tools/countdown.js"), "utf8");

execSync("node --check tools/countdown.js", { cwd: ROOT, stdio: "inherit" });
assert(html.includes('id="countdown"'), "panel missing");
assert(html.includes("id=\"cd-start\"") && html.includes("id=\"cd-save\"") && html.includes("id=\"cd-clear\""), "toolbar missing");
assert(html.includes("id=\"countdown-fs\""), "overlay missing");
assert(app.includes('"countdown"'), "TOOL_GROUPS missing countdown");
assert(app.includes("countdown:"), "ABOUT/META missing");
assert(lazy.includes('countdown: "./countdown.js"'), "lazy missing");
assert(lazy.includes('"countdown"'), "standalone set missing");
assert(css.includes('data-boot-panel="countdown"'), "boot css missing");
assert(js.includes("devtools-countdown-v1"), "storage key missing");
assert(js.includes("playBell") && js.includes("vibrate"), "alarm missing");
console.log("countdown-smoke ok");
