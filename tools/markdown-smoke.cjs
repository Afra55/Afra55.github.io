#!/usr/bin/env node
"use strict";

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const md = fs.readFileSync(path.join(ROOT, "tools/extra-panels/markdown.js"), "utf8");

execSync("node --check tools/extra-panels/markdown.js", { cwd: ROOT, stdio: "inherit" });
execSync("node --check tools/lib/extra-kit.js", { cwd: ROOT, stdio: "inherit" });
execSync("node --check tools/lib/extra-bootstrap.js", { cwd: ROOT, stdio: "inherit" });

assert(md.includes('bindPanel("markdown"'), "markdown.js missing bindPanel");
assert(md.includes("mdInited"), "markdown.js should skip when mdInited");

console.log("markdown-smoke ok");
