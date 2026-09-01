#!/usr/bin/env node
"use strict";
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

const ROOT = path.resolve(__dirname, "..");
const shell = fs.readFileSync(path.join(ROOT, "tools/index.html"), "utf8");
const panel = fs.readFileSync(path.join(ROOT, "tools/panels/countdown.html"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "tools/app.js"), "utf8");
const lazy = fs.readFileSync(path.join(ROOT, "tools/lib/lazy-scripts.js"), "utf8");
const loader = fs.readFileSync(path.join(ROOT, "tools/lib/panel-loader.js"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "tools/countdown.js"), "utf8");

execSync("node --check tools/countdown.js", { cwd: ROOT, stdio: "inherit" });
assert(shell.includes('id="workspace-panels"'), "shell missing workspace-panels");
assert(panel.includes('id="countdown"'), "panel missing");
assert(panel.includes('id="cd-start"') && panel.includes('id="cd-save"') && panel.includes('id="cd-clear"'), "toolbar missing");
assert(shell.includes('id="countdown-fs"'), "overlay missing");
assert(app.includes('"countdown"'), "TOOL_GROUPS missing countdown");
assert(app.includes("countdown:"), "ABOUT/META missing");
assert(lazy.includes('countdown: "./countdown.js"'), "lazy missing");
assert(lazy.includes('"countdown"'), "standalone set missing");
assert(loader.includes("panels/") && loader.includes("ensure"), "panel-loader missing");
assert(js.includes("devtools-countdown-v1"), "storage key missing");
assert(js.includes("playBell") && js.includes("vibrate"), "alarm missing");
console.log("countdown-smoke ok");
