#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { extractJsConst, extractJsSet } = require("./lib/extract-js-const.cjs");

const TOOLS = path.resolve(__dirname, "..");
const APP_JS = path.join(TOOLS, "app.js");
const LAZY_JS = path.join(TOOLS, "lib/lazy-scripts.js");
const MANIFEST = path.join(TOOLS, "panels/manifest.json");
const PANELS_DIR = path.join(TOOLS, "panels");

function fail(msg) {
  console.error(`verify-registry: ${msg}`);
  process.exitCode = 1;
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function main() {
  const app = read(APP_JS);
  const lazy = read(LAZY_JS);
  const manifest = JSON.parse(read(MANIFEST));

  const groups = extractJsConst(app, "TOOL_GROUPS");
  const meta = extractJsConst(app, "TOOL_META");
  const about = extractJsConst(app, "ABOUT_DESC");
  const toolFiles = extractJsConst(lazy, "TOOL_FILES");
  const toolVendors = extractJsConst(lazy, "TOOL_VENDORS");
  const standalone = extractJsSet(lazy, "STANDALONE_NO_EXTRA");
  const noPure = extractJsSet(lazy, "NO_PURE");
  const externalSite = extractJsSet(lazy, "EXTERNAL_SITE_TOOLS");

  const toolIds = groups.flatMap((g) => g.tools);
  const unique = new Set(toolIds);
  const panelIds = new Set(manifest.panels.map((p) => p.id));

  if (unique.size !== toolIds.length) {
    const dup = toolIds.filter((id, i) => toolIds.indexOf(id) !== i);
    fail(`TOOL_GROUPS 存在重复工具：${[...new Set(dup)].join(", ")}`);
  }

  for (const g of groups) {
    if (!g.id || !g.label || !Array.isArray(g.tools) || !g.tools.length) {
      fail(`分组结构无效：${JSON.stringify(g)}`);
    }
  }

  for (const id of toolIds) {
    if (!meta[id]) fail(`TOOL_META 缺少：${id}`);
    if (!about[id]) fail(`ABOUT_DESC 缺少：${id}`);
    if (!panelIds.has(id)) fail(`panels/manifest.json 缺少面板：${id}`);
    const htmlPath = path.join(PANELS_DIR, `${id}.html`);
    if (!fs.existsSync(htmlPath)) fail(`缺少面板文件：panels/${id}.html`);
  }

  for (const id of Object.keys(meta)) {
    if (!unique.has(id)) fail(`TOOL_META 多余条目（未在 TOOL_GROUPS）：${id}`);
  }

  for (const id of panelIds) {
    if (!unique.has(id)) fail(`manifest 面板未注册到 TOOL_GROUPS：${id}`);
  }

  for (const id of Object.keys(toolFiles)) {
    if (!unique.has(id)) fail(`TOOL_FILES 未在导航注册：${id}`);
  }

  for (const id of Object.keys(toolVendors)) {
    if (!unique.has(id)) fail(`TOOL_VENDORS 未在导航注册：${id}`);
  }

  for (const id of standalone) {
    if (!unique.has(id)) fail(`STANDALONE_NO_EXTRA 未在导航注册：${id}`);
  }

  for (const id of noPure) {
    if (!unique.has(id)) fail(`NO_PURE 未在导航注册：${id}`);
  }

  for (const id of externalSite) {
    if (!unique.has(id)) fail(`EXTERNAL_SITE_TOOLS 未在导航注册：${id}`);
  }

  if (process.exitCode) {
    console.error("verify-registry: 校验失败");
    process.exit(process.exitCode);
  }

  console.log(
    `verify-registry: OK · ${groups.length} 组 · ${toolIds.length} 工具 · ${manifest.panels.length} 面板 · lazy ${Object.keys(toolFiles).length} 脚本`
  );
}

main();
