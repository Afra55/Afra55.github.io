#!/usr/bin/env node
"use strict";
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

execSync("node --check tools/phlogo.js", { cwd: ROOT, stdio: "inherit" });
execSync("node --check tools/nokiasms.js", { cwd: ROOT, stdio: "inherit" });

const shell = fs.readFileSync(path.join(ROOT, "tools/index.html"), "utf8");
const phPanel = fs.readFileSync(path.join(ROOT, "tools/panels/phlogo.html"), "utf8");
const nkPanel = fs.readFileSync(path.join(ROOT, "tools/panels/nokiasms.html"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "tools/app.js"), "utf8");
const lazy = fs.readFileSync(path.join(ROOT, "tools/lib/lazy-scripts.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "tools/style.css"), "utf8");
const ph = fs.readFileSync(path.join(ROOT, "tools/phlogo.js"), "utf8");
const nk = fs.readFileSync(path.join(ROOT, "tools/nokiasms.js"), "utf8");
const oss = fs.readFileSync(path.join(ROOT, "tools/lib/oss-deps.js"), "utf8");

assert(shell.includes('id="workspace-panels"'), "shell missing");
assert(phPanel.includes('id="phlogo"') && nkPanel.includes('id="nokiasms"'), "panels missing");
assert(phPanel.includes('id="ph-download"') && phPanel.includes('id="ph-svg"'), "ph toolbar");
assert(nkPanel.includes('id="nk-download"') && nkPanel.includes('id="nk-tilt"'), "nk toolbar");
assert(phPanel.includes("bestony/logoly") && nkPanel.includes("dcalsky/zzkia"), "attribution");
assert(app.includes('"phlogo"') && app.includes('"nokiasms"'), "TOOL_GROUPS");
assert(app.includes("phlogo:") && app.includes("nokiasms:"), "ABOUT/META");
assert(lazy.includes('phlogo: "./phlogo.js"') && lazy.includes('nokiasms: "./nokiasms.js"'), "lazy files");
assert(lazy.includes('"phlogo"') && lazy.includes('"nokiasms"'), "standalone set");
assert(css.includes(".phlogo-stage") || fs.existsSync(path.join(ROOT, "tools/styles/panels/phlogo.css")), "ph styles");
assert(nkPanel.includes("nokia") || css.includes(".nokia-stage"), "nk styles");
assert(ph.includes("devtools-phlogo-v1") && ph.includes("buildSvg"), "ph features");
assert(nk.includes("devtools-nokiasms-v1") && nk.includes("wrapLines") && nk.includes("drawPhone"), "nk features");
assert(nk.includes("trimCanvasToAlpha") && !nk.includes('fillStyle = "#0b0d10"'), "nk transparent export");
assert(oss.includes("bestony/logoly") && oss.includes("dcalsky/zzkia"), "oss inspired");

function wrapByWidth(text, max) {
  const lines = [];
  String(text || "")
    .split("\n")
    .forEach((para) => {
      if (!para) {
        lines.push("");
        return;
      }
      let line = "";
      for (const ch of para) {
        const next = line + ch;
        if (next.length > max && line) {
          lines.push(line);
          line = ch;
        } else line = next;
      }
      lines.push(line);
    });
  return lines;
}
const wrapped = wrapByWidth("abcdefghij", 4);
assert(wrapped.join("|") === "abcd|efgh|ij", "wrap");
const cjk = wrapByWidth("下班了吗？记得带饭。", 5);
assert(cjk[0] === "下班了吗？" && cjk[1] === "记得带饭。", "cjk wrap");

console.log("phlogo-nokia-smoke ok");
