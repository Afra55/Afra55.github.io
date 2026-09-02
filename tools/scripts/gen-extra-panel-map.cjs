#!/usr/bin/env node
"use strict";
/** 由 split-extra.cjs 生成，勿手改 */
const fs = require("fs");
const path = require("path");
const m = JSON.parse(fs.readFileSync(path.join(__dirname, "extra-panels-manifest.json"), "utf8"));
const lines = [
  "  const EXTRA_PANEL_FILES = " + JSON.stringify(m.toolFiles, null, 4).replace(/\n/g, "\n  ") + ";",
  "  const EXTRA_MEDIA_TOOLS = new Set(" + JSON.stringify(m.mediaTools) + ");",
];
process.stdout.write(lines.join("\n"));
