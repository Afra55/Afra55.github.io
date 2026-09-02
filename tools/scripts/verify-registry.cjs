#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { extractJsConst, extractJsSet } = require("./lib/extract-js-const.cjs");

const TOOLS = path.resolve(__dirname, "..");
const REGISTRY_JSON = path.join(TOOLS, "registry/tools.json");
const REGISTRY_JS = path.join(TOOLS, "lib/tool-registry.js");
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

function expectedRegistryJs(data) {
  return `(() => {
  "use strict";
  /** 由 registry/tools.json 生成，勿手改。运行: node tools/scripts/build-tool-registry.cjs */
  window.DEVTOOLS_REGISTRY = ${JSON.stringify(data, null, 2)};
})();
`;
}

function main() {
  const registry = JSON.parse(read(REGISTRY_JSON));
  const lazy = read(LAZY_JS);
  const manifest = JSON.parse(read(MANIFEST));

  const groups = registry.groups;
  const meta = registry.meta;
  const about = registry.about;

  if (!Array.isArray(groups) || !meta || !about) {
    fail("registry/tools.json 缺少 groups / meta / about");
    return;
  }

  const built = read(REGISTRY_JS);
  const expected = expectedRegistryJs(registry);
  if (built !== expected) {
    fail("lib/tool-registry.js 与 registry/tools.json 不同步，请运行 node tools/scripts/build-tool-registry.cjs");
  }

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
    fail(`groups 存在重复工具：${[...new Set(dup)].join(", ")}`);
  }

  for (const g of groups) {
    if (!g.id || !g.label || !Array.isArray(g.tools) || !g.tools.length) {
      fail(`分组结构无效：${JSON.stringify(g)}`);
    }
  }

  for (const id of toolIds) {
    if (!meta[id]) fail(`meta 缺少：${id}`);
    if (!about[id]) fail(`about 缺少：${id}`);
    if (!panelIds.has(id)) fail(`panels/manifest.json 缺少面板：${id}`);
    const htmlPath = path.join(PANELS_DIR, `${id}.html`);
    if (!fs.existsSync(htmlPath)) fail(`缺少面板文件：panels/${id}.html`);
  }

  for (const id of Object.keys(meta)) {
    if (!unique.has(id)) fail(`meta 多余条目（未在 groups）：${id}`);
  }

  for (const id of panelIds) {
    if (!unique.has(id)) fail(`manifest 面板未注册到 groups：${id}`);
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
