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

const html = fs.readFileSync(path.join(ROOT, "tools/index.html"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "tools/app.js"), "utf8");
const lazy = fs.readFileSync(path.join(ROOT, "tools/lib/lazy-scripts.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "tools/style.css"), "utf8");
const nav = fs.readFileSync(path.join(ROOT, "tools/workspace-nav.css"), "utf8");
const ph = fs.readFileSync(path.join(ROOT, "tools/phlogo.js"), "utf8");
const nk = fs.readFileSync(path.join(ROOT, "tools/nokiasms.js"), "utf8");
const oss = fs.readFileSync(path.join(ROOT, "tools/lib/oss-deps.js"), "utf8");

assert(html.includes('id="phlogo"') && html.includes('id="nokiasms"'), "panels missing");
assert(html.includes("id=\"ph-download\"") && html.includes("id=\"ph-svg\""), "ph toolbar");
assert(html.includes("id=\"nk-download\"") && html.includes("id=\"nk-tilt\""), "nk toolbar");
assert(html.includes("bestony/logoly") && html.includes("dcalsky/zzkia"), "attribution");
assert(app.includes('"phlogo"') && app.includes('"nokiasms"'), "TOOL_GROUPS");
assert(app.includes("phlogo:") && app.includes("nokiasms:"), "ABOUT/META");
assert(lazy.includes('phlogo: "./phlogo.js"') && lazy.includes('nokiasms: "./nokiasms.js"'), "lazy files");
assert(lazy.includes('"phlogo"') && lazy.includes('"nokiasms"'), "standalone set");
assert(nav.includes('data-boot-panel="phlogo"') && nav.includes('data-boot-panel="nokiasms"'), "boot css");
assert(css.includes(".phlogo-stage") && css.includes(".nokia-stage"), "styles");
assert(ph.includes("devtools-phlogo-v1") && ph.includes("buildSvg"), "ph features");
assert(nk.includes("devtools-nokiasms-v1") && nk.includes("wrapLines") && nk.includes("drawPhone"), "nk features");
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
