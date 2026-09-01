#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const TOOLS = path.resolve(__dirname, "..");
const INDEX = path.join(TOOLS, "index.html");
const PANELS_DIR = path.join(TOOLS, "panels");
const MANIFEST = path.join(PANELS_DIR, "manifest.json");

const PANEL_OPEN_RE = /<section\s+id="([^"]+)"\s+class="panel tool-panel[^"]*"[^>]*>/gi;

function findPanelBlocks(html) {
  const blocks = [];
  let m;
  while ((m = PANEL_OPEN_RE.exec(html)) !== null) {
    const id = m[1];
    const start = m.index;
    let depth = 0;
    let i = start;
    while (i < html.length) {
      const open = html.slice(i).match(/^<section\b/i);
      const close = html.slice(i).match(/^<\/section>/i);
      if (open) {
        depth += 1;
        i += open[0].length;
        continue;
      }
      if (close) {
        depth -= 1;
        i += close[0].length;
        if (depth === 0) {
          blocks.push({ id, start, end: i, html: html.slice(start, i) });
          break;
        }
        continue;
      }
      i += 1;
    }
    if (depth !== 0) throw new Error(`Unclosed panel section: ${id}`);
  }
  return blocks;
}

function normalizePanelHtml(raw) {
  return raw.replace(/\r\n/g, "\n").trimEnd() + "\n";
}

function buildShell(html, blocks) {
  if (!blocks.length) throw new Error("No tool panels found");
  const first = blocks[0].start;
  const last = blocks[blocks.length - 1].end;
  const before = html.slice(0, first);
  const after = html.slice(last);
  const mount =
    '      <div id="workspace-panels" class="workspace-panels" aria-live="polite"></div>\n';
  return before + mount + after;
}

function ensurePanelLoaderScript(html) {
  if (html.includes("panel-loader.js")) return html;
  const build = fs.readFileSync(path.join(TOOLS, "lib/tools-build.js"), "utf8").match(/BUILD = "([^"]+)"/)?.[1] || "";
  const v = build ? `?v=${build}` : "";
  return html.replace(
    /(<script src="\.\/lib\/lazy-scripts\.js[^"]*"><\/script>)/,
    `$1\n  <script src="./lib/panel-loader.js${v}"></script>`
  );
}

function main() {
  const html = fs.readFileSync(INDEX, "utf8");
  const blocks = findPanelBlocks(html);
  fs.mkdirSync(PANELS_DIR, { recursive: true });

  const manifest = {
    version: 1,
    generatedAt: new Date().toISOString(),
    panels: [],
  };

  for (const block of blocks) {
    const file = path.join(PANELS_DIR, `${block.id}.html`);
    const content = normalizePanelHtml(block.html);
    fs.writeFileSync(file, content, "utf8");
    manifest.panels.push({ id: block.id, file: `./panels/${block.id}.html`, bytes: Buffer.byteLength(content) });
    console.log(`panel ${block.id}: ${content.split("\n").length} lines`);
  }

  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  let shell = buildShell(html, blocks);
  shell = ensurePanelLoaderScript(shell);
  fs.writeFileSync(INDEX, shell, "utf8");

  const beforeKb = Math.round(Buffer.byteLength(html) / 1024);
  const afterKb = Math.round(Buffer.byteLength(shell) / 1024);
  console.log(`\nindex.html ${beforeKb}KB → shell ${afterKb}KB (${blocks.length} panels extracted)`);
}

main();
