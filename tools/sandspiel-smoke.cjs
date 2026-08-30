#!/usr/bin/env node
"use strict";
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

const html = fs.readFileSync(path.join(ROOT, "tools/index.html"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "tools/app.js"), "utf8");
const lazy = fs.readFileSync(path.join(ROOT, "tools/lib/lazy-scripts.js"), "utf8");
const css = fs.readFileSync(path.join(ROOT, "tools/style.css"), "utf8");
const nav = fs.readFileSync(path.join(ROOT, "tools/workspace-nav.css"), "utf8");
const js = fs.readFileSync(path.join(ROOT, "tools/sandspiel.js"), "utf8");
const oss = fs.readFileSync(path.join(ROOT, "tools/lib/oss-deps.js"), "utf8");
const sw = fs.readFileSync(path.join(ROOT, "tools/sw.js"), "utf8");
const iframe = fs.readFileSync(path.join(ROOT, "tools/sandspiel/index.html"), "utf8");
const styles = fs.readFileSync(path.join(ROOT, "tools/sandspiel/styles.css"), "utf8");
const notice = fs.readFileSync(path.join(ROOT, "tools/sandspiel/NOTICE.txt"), "utf8");

assert(html.includes('id="sandspiel"') && html.includes("id=\"sandspiel-frame\""), "panel");
assert(app.includes('"sandspiel"') && app.includes("sandspiel:"), "catalog");
assert(lazy.includes('sandspiel: "./sandspiel.js"'), "lazy");
assert(css.includes(".sandspiel-shell") && nav.includes('data-boot-panel="sandspiel"'), "css");
assert(styles.includes("sandspiel-menu-open") && styles.includes("Info-tags"), "iframe css");
assert(fs.readFileSync(path.join(ROOT, "tools/sandspiel/embed-ui.js"), "utf8").includes("sandspiel-menu-open"), "embed ui");
assert(js.includes("sandspiel:pause") && js.includes("./sandspiel/index.html") && js.includes("isSandspielFullscreen"), "loader");
assert(oss.includes("MaxBittker/sandspiel"), "oss");
assert(/sandspiel/.test(sw), "sw bypass");
assert(iframe.includes("sand-canvas") && iframe.includes("fluid-canvas"), "iframe html");
assert(iframe.includes("lang=zh-CN") || iframe.includes('lang="zh-CN"'), "zh html");
assert(!iframe.includes("pagead2") && !iframe.includes("gtag") && !iframe.includes("firebase"), "no ads");
assert(styles.includes("touch-action: none"), "touch css");
assert(notice.includes("Max Bittker"), "notice");
assert(fs.existsSync(path.join(ROOT, "tools/sandspiel/LICENSE")), "license");
const files = fs.readdirSync(path.join(ROOT, "tools/sandspiel"));
assert(files.some((f) => f.endsWith(".wasm") || f.endsWith(".module.wasm")), "wasm");
assert(files.some((f) => f.startsWith("main.") && f.endsWith(".js")), "main js");
const chunk = files
  .filter((f) => f.endsWith(".js") && !f.endsWith(".LICENSE.txt"))
  .map((f) => fs.readFileSync(path.join(ROOT, "tools/sandspiel", f), "utf8"))
  .join("\n");
assert(chunk.includes("沙子") && chunk.includes("暂停") && chunk.includes("Info-tags"), "zh ui");
assert(chunk.includes("__sandspielMobile") && chunk.includes("?180:300"), "mobile grid");
assert(chunk.includes("sandspiel:pause") && !chunk.includes("pagead2"), "pause msg");
console.log("sandspiel-smoke ok");
