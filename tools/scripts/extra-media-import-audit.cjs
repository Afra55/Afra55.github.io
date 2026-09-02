#!/usr/bin/env node
"use strict";

/**
 * 审计 extra-panels 是否漏导入 DevToolsExtraMedia 导出项（拆分后易漏 scheduleFfmpegPrewarm 等）
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const MEDIA = path.join(ROOT, "lib/extra-media.js");
const PANELS = path.join(ROOT, "extra-panels");
const failures = [];

const media = fs.readFileSync(MEDIA, "utf8");
const exportBlock = media.match(/window\.DevToolsExtraMedia\s*=\s*\{([\s\S]*?)\n\s*\};/);
if (!exportBlock) {
  console.error("extra-media-import-audit: 找不到 DevToolsExtraMedia 导出块");
  process.exit(1);
}

const exported = new Set(
  exportBlock[1]
    .split(/[\s,]+/)
    .filter((x) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(x))
    .filter((x) => !["formatLocalPickMeta", "attachLocalVideoPreview", "waitVideoMetadata", "escapeHtml"].includes(x))
);

const kitSrc = fs.readFileSync(path.join(ROOT, "lib/extra-kit.js"), "utf8");
if (!/const FFMPEG_SEG_FILE_BYTES\s*=/.test(media)) {
  failures.push("extra-media.js: 应导出 FFMPEG_SEG_FILE_BYTES");
}
if (!exportBlock[1].includes("FFMPEG_SEG_FILE_BYTES")) {
  failures.push("extra-media.js: DevToolsExtraMedia 未导出 FFMPEG_SEG_FILE_BYTES");
}

const v2gSuite = fs.readFileSync(path.join(PANELS, "v2g-suite.js"), "utf8");
if (/FFMPEG_SEG_FILE_BYTES/.test(v2gSuite) && !/const FFMPEG_SEG_FILE_BYTES\s*=/.test(v2gSuite)) {
  failures.push("v2g-suite.js: 使用 FFMPEG_SEG_FILE_BYTES 但未定义");
}

for (const file of fs.readdirSync(PANELS).filter((f) => f.endsWith(".js"))) {
  const src = fs.readFileSync(path.join(PANELS, file), "utf8");
  if (!src.includes("DevToolsExtraMedia")) continue;

  const destructure = src.match(/const\s*\{([\s\S]*?)\}\s*=\s*M\s*;/);
  if (!destructure) {
    failures.push(`${file}: 使用 DevToolsExtraMedia 但缺少 const { … } = M`);
    continue;
  }

  const imported = new Set(
    destructure[1]
      .split(/[\s,]+/)
      .filter((x) => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(x))
  );
  if (/FFMPEG_SEG_FILE_BYTES/.test(src)) imported.add("FFMPEG_SEG_FILE_BYTES");

  const used = new Set();
  for (const m of src.matchAll(/\b([a-z][a-zA-Z0-9_]*)\s*\(/g)) used.add(m[1]);

  const missing = [...used].filter((fn) => exported.has(fn) && !imported.has(fn));
  if (missing.length) {
    failures.push(`${file}: 未从 M 导入 ${[...new Set(missing)].sort().join(", ")}`);
  }
}

if (failures.length) {
  console.error("extra-media-import-audit: 发现回归风险\n");
  failures.forEach((f) => console.error(`  - ${f}`));
  process.exit(1);
}

console.log("extra-media-import-audit: OK");
