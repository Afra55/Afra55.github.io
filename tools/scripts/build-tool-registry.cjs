#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const TOOLS = path.resolve(__dirname, "..");
const REGISTRY_JSON = path.join(TOOLS, "registry/tools.json");
const OUT_JS = path.join(TOOLS, "lib/tool-registry.js");

function main() {
  const raw = fs.readFileSync(REGISTRY_JSON, "utf8");
  const data = JSON.parse(raw);
  if (!Array.isArray(data.groups) || !data.meta || typeof data.meta !== "object") {
    throw new Error("registry/tools.json 缺少 groups 或 meta");
  }
  const body = `(() => {
  "use strict";
  /** 由 registry/tools.json 生成，勿手改。运行: node tools/scripts/build-tool-registry.cjs */
  window.DEVTOOLS_REGISTRY = ${JSON.stringify(data, null, 2)};
})();
`;
  fs.writeFileSync(OUT_JS, body);
  console.log(
    `build-tool-registry: ${OUT_JS} · ${data.groups.length} 组 · ${Object.keys(data.meta).length} 工具`
  );
}

main();
