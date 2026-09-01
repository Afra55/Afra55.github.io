#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const file = path.join(__dirname, "../extra.js");
let src = fs.readFileSync(file, "utf8");

src = src.replace(
  /    let gifbbPanel;\n    if \(!gifbbPanel\) throw new Error\("skip gifbb"\);\n/,
  ""
);

if (!src.includes("const EBind = () => window.DevToolsExtraBind")) {
  const anchor = "  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];\n";
  if (!src.includes(anchor)) throw new Error("extra.js anchor missing for EBind injection");
  src = src.replace(
    anchor,
    () =>
      `${anchor}\n  const EBind = () => window.DevToolsExtraBind;\n  const bindPanel = (id, fn) => EBind()?.register?.(id, fn);\n`
  );
}

if (!src.includes("EBind()?.bind?.(id)")) {
  src = src.replace(
    "  function bootExtraPanel(toolId) {\n    const id = String(toolId || \"\").trim();\n    if (!id) return;",
    "  function bootExtraPanel(toolId) {\n    const id = String(toolId || \"\").trim();\n    if (!id) return;\n    EBind()?.bind?.(id);"
  );
}

if (!src.includes("EBind()?.bindMounted?.()")) {
  src = src.replace(/\n\}\)\(\);\s*$/, "\n  EBind()?.bindMounted?.();\n})();\n");
}

/** @type {{ panelId: string, start: string, end: string, tryBlock?: boolean }[]} */
const SECTIONS = [
  { panelId: "timediff", start: "// ---- Time diff ----", end: "// ---- Color convert ----" },
  { panelId: "color", start: "// ---- Color convert ----", end: "// ---- URL ----" },
  { panelId: "url", start: "// ---- URL ----", end: "// ---- Query / JWT ----" },
  { panelId: "query", start: "// ---- Query / JWT ----", end: "// ---- UUID ----" },
  { panelId: "uuid", start: "// ---- UUID ----", end: "// ---- Hash ----" },
  { panelId: "hash", start: "// ---- Hash ----", end: "// ---- Text ----" },
  { panelId: "text", start: "// ---- Text ----", end: "// ---- Case convert ----" },
  { panelId: "caseconv", start: "// ---- Case convert ----", end: "// ---- Coordinate convert ----", tryBlock: true },
  { panelId: "coord", start: "// ---- Coordinate convert ----", end: "// ---- 文本比对（见 diff.js） ----", tryBlock: true },
  { panelId: "yaml", start: "// ---- YAML ----", end: "// ---- Image Base64 ----" },
  { panelId: "imgb64", start: "// ---- Image Base64 ----", end: "// ---- QR generate + decode ----" },
  { panelId: "qrcode", start: "// ---- QR generate + decode ----", end: "// ---- Cron ----" },
  { panelId: "cron", start: "// ---- Cron ----", end: "// ---- Units ----" },
  { panelId: "units", start: "// ---- Units ----", end: "// ---- Share card ----" },
  { panelId: "sharecard", start: "// ---- Share card ----", end: "// ---- Number base ----" },
  { panelId: "numbase", start: "// ---- Number base ----", end: "// ---- Markdown preview ----" },
  { panelId: "markdown", start: "// ---- Markdown preview ----", end: "  function bootExtraPanel(toolId)" },
  { panelId: "eyedropper", start: "// ---- EyeDropper / image color picker ----", end: "// ---- Password generator ----", tryBlock: true },
  { panelId: "password", start: "// ---- Password generator ----", end: "// ---- GIF maker ----", tryBlock: true },
  { panelId: "gifmaker", start: "// ---- GIF maker ----", end: "// ---- GIF extract / to video ----", tryBlock: true, bindMarker: 'gifFile?.addEventListener("change"' },
  { panelId: "gifmaker", start: "// ---- GIF extract / to video ----", end: "// ---- Video to GIF ----", tryBlock: true, bindMarker: 'gifxFile?.addEventListener("change"' },
  { panelId: "gifbb", start: "// ---- 已有 GIF 压黑盒（gifbb，独立工具） ----", end: "// ---- Compress existing GIF ----", tryBlock: true, bindMarker: 'gifbbFile?.addEventListener("change"' },
  { panelId: "gifmaker", start: "// ---- Compress existing GIF ----", end: "// ---- Edit existing GIF (crop / trim frames) ----", tryBlock: true, bindMarker: 'gifcFile?.addEventListener("change"' },
  { panelId: "gifmaker", start: "// ---- Edit existing GIF (crop / trim frames) ----", end: "// ---- Merge GIFs ----", tryBlock: true, bindMarker: 'gifeFile?.addEventListener("change"' },
  { panelId: "gifmaker", start: "// ---- Merge GIFs ----", end: "  // Rebind copy buttons added dynamically in HTML for new panels", tryBlock: true, bindMarker: 'gifmFile?.addEventListener("change"' },
];

function findIndex(hay, needle, from = 0) {
  const i = hay.indexOf(needle, from);
  if (i < 0) throw new Error(`marker not found: ${needle}`);
  return i;
}

const DOM_CONST_RE = /^(\s*)const (\w+) = (\$\([^;]+\));(\s*)$/;

function collectDomAssigns(section) {
  const assigns = [];
  for (const line of section.split("\n")) {
    const m = line.match(DOM_CONST_RE);
    if (m) assigns.push(`${m[1]}${m[2]} = ${m[3]};`);
  }
  return assigns;
}

function replaceDomConsts(section) {
  return section
    .split("\n")
    .map((line) => {
      const m = line.match(DOM_CONST_RE);
      if (m) return `${m[1]}let ${m[2]};${m[4]}`;
      return line;
    })
    .join("\n");
}

function findBindStart(lines, { tryBlock = false, bindMarker = "" } = {}) {
  if (bindMarker) {
    const idx = lines.findIndex((l) => l.includes(bindMarker));
    if (idx >= 0) return idx;
  }
  if (tryBlock) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (/^    [^ ].*addEventListener/.test(line)) return i;
      if (/^    \$\("#/.test(line) && line.includes("addEventListener")) return i;
      if (/^    window\.DevToolsTemp/.test(line)) return i;
      if (/^    if \(!hasEyeDropper\)/.test(line)) return i;
      if (/^    applyPickedColor\(/.test(line)) return i;
      if (/^    genPasswords\(/.test(line)) return i;
    }
    return -1;
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.includes("addEventListener")) return i;
    if (line.includes("DevToolsTemp?.registerCleanup")) return i;
    if (line.includes('window.addEventListener("pagehide"')) return i;
    if (/^\s{2}\w+\?\.\w+\(/.test(line) && !line.includes("function")) return i;
    if (/^\s{2}if \(\$\("#/.test(line)) return i;
    if (/^\s{2}applyPickedColor\(/.test(line)) return i;
    if (/^\s{2}genPasswords\(/.test(line)) return i;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const t = lines[i].trim();
    if (!t || t.startsWith("//") || t.startsWith("function ") || t.startsWith("async function")) continue;
    if (t.startsWith("let ") || t.startsWith("const ") || t.startsWith("}") || t.startsWith("try") || t.startsWith("catch")) continue;
    return i;
  }
  return -1;
}

function wrapBody(body, panelId, indent, opts = {}) {
  if (body.includes(`bindPanel("${panelId}"`)) return body;
  const lines = body.split("\n");
  const bindStart = findBindStart(lines, opts);
  if (bindStart < 0) return replaceDomConsts(body);

  const head = replaceDomConsts(lines.slice(0, bindStart).join("\n"));
  const tail = lines.slice(bindStart).join("\n");
  const assigns = collectDomAssigns(body);
  const bindLines = [...assigns, "", tail].map((l) => (l ? `${indent}  ${l}` : l));
  return `${head}\n${indent}bindPanel("${panelId}", () => {\n${bindLines.join("\n")}\n${indent}});`;
}

function wrapSection(section, panelId, { tryBlock = false, bindMarker = "" } = {}) {
  if (section.includes(`bindPanel("${panelId}"`)) return section;

  let header = "";
  let body = section;
  let footer = "";

  if (tryBlock) {
    const catchIdx = body.search(/\n  \} catch \(err\) \{/);
    if (catchIdx >= 0) {
      footer = body.slice(catchIdx);
      body = body.slice(0, catchIdx);
    }
    const tryMatch = body.match(/\n  try \{\n?/);
    if (tryMatch) {
      const tryIdx = body.indexOf(tryMatch[0]);
      header = body.slice(0, tryIdx + tryMatch[0].length);
      body = body.slice(tryIdx + tryMatch[0].length);
    }
  }

  const indent = tryBlock ? "    " : "  ";
  const wrappedBody = wrapBody(body, panelId, indent, { tryBlock, bindMarker });
  return `${header}${wrappedBody}${footer}`;
}

for (const spec of SECTIONS) {
  const start = findIndex(src, spec.start);
  const end = findIndex(src, spec.end, start + spec.start.length);
  const section = src.slice(start, end);
  const wrapped = wrapSection(section, spec.panelId, { tryBlock: spec.tryBlock, bindMarker: spec.bindMarker || "" });
  src = src.slice(0, start) + wrapped + src.slice(end);
}

// v2g + vsplit + vbb mega try
const V2G_START = findIndex(src, "// ---- Video to GIF ----");
const V2G_TRY = findIndex(src, "  try {", V2G_START);
const V2G_CATCH = findIndex(src, '  } catch (err) {\n    console.error("video to gif init failed", err);', V2G_TRY);

let mega = src.slice(V2G_TRY, V2G_CATCH);
if (!mega.includes('bindPanel("gifmaker"')) {
  mega = replaceDomConsts(mega);

  const VSPLIT_MARK = "    // ---- Video split (shares FFmpeg / blackbox encoder) ----";
  const VBB_MARK = "    // ---- One-click blackbox split planner (vbb) ----";
  const vsplitIdx = mega.indexOf(VSPLIT_MARK);
  const vbbIdx = mega.indexOf(VBB_MARK);
  if (vsplitIdx < 0 || vbbIdx < 0) throw new Error("vsplit/vbb markers missing in v2g block");

  const v2gPart = mega.slice(0, vsplitIdx);
  const vsplitPart = mega.slice(vsplitIdx, vbbIdx);
  const vbbPart = mega.slice(vbbIdx);

  function listenerTail(block, bindMarker) {
    const lines = block.split("\n");
    const start = findBindStart(lines, { tryBlock: true, bindMarker });
    if (start < 0) return { head: block, tail: "" };
    return { head: lines.slice(0, start).join("\n"), tail: lines.slice(start).join("\n") };
  }

  const wrapMega = (panelId, block, bindMarker) => {
    const { head, tail } = listenerTail(block, bindMarker);
    const assigns = collectDomAssigns(block);
    const body = [...assigns, "", tail].map((l) => (l ? `      ${l}` : l)).join("\n");
    return `${head}\n    bindPanel("${panelId}", () => {\n${body}\n    });`;
  };

  mega =
    wrapMega("gifmaker", v2gPart, 'v2gFile?.addEventListener("change"') +
    "\n" +
    wrapMega("vsplit", vsplitPart, 'vsplitFile?.addEventListener("change"') +
    "\n" +
    wrapMega("vbb", vbbPart, 'vbbFile?.addEventListener("change"');
  src = src.slice(0, V2G_TRY) + mega + src.slice(V2G_CATCH);
}

// gifbb panel
const GIFBB_START = findIndex(src, "// ---- 已有 GIF 压黑盒（gifbb，独立工具） ----");
const GIFBB_TRY = findIndex(src, "  try {", GIFBB_START);
const GIFBB_CATCH = findIndex(src, '  } catch (err) {', GIFBB_TRY);
let gifbb = src.slice(GIFBB_TRY, GIFBB_CATCH);
if (!gifbb.includes('bindPanel("gifbb"')) {
  gifbb = wrapSection(gifbb, "gifbb", { tryBlock: true });
  src = src.slice(0, GIFBB_TRY) + gifbb + src.slice(GIFBB_CATCH);
}

fs.writeFileSync(file, src);
console.log("apply-extra-panel-bind: done");
