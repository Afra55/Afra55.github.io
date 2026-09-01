#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const TOOLS = path.resolve(__dirname, "..");
const STYLE = path.join(TOOLS, "style.css");
const CORE = path.join(TOOLS, "style.css");
const PANELS_DIR = path.join(TOOLS, "styles", "panels");

/** 壳层/全局选择器：永不拆到 panel CSS */
const SHELL_SELECTOR_PREFIXES = [
  ".header-",
  ".workspace-",
  ".app-layout",
  ".shell",
  ".site-header",
  ".site-footer",
  ".site-chrome-",
  ".brand",
  ".tagline",
  ".nav-bar",
  ".nav-footer",
  ".nav-search",
  ".nav-drawer",
  ".nav-compact",
  ".nav-sort-hint",
  ".nav-reset",
  ".nav-menu-btn",
  ".nav-backdrop",
  ".tool-nav",
  ".panel-head",
  ".panel-body",
  ".panel-wrap",
  ".input-with-action",
  ".media-subnav",
  ".ghost-btn",
  ".primary-btn",
  ".secondary-btn",
  "html",
  "body",
];

const SHELL_MEDIA_SNIPPETS = [
  "min-width: 901px",
  "max-width: 900px",
  "max-width: 700px",
  "max-width: 600px",
  "prefers-reduced-motion",
];

function isShellSelector(selectorText) {
  const sel = String(selectorText || "").toLowerCase();
  return SHELL_SELECTOR_PREFIXES.some((pfx) => sel.includes(pfx));
}

function isShellMedia(head) {
  const h = String(head || "").toLowerCase();
  return SHELL_MEDIA_SNIPPETS.some((s) => h.includes(s));
}

const PANEL_SELECTORS = {
  timestamp: ["#timestamp", "#ts-", ".ts-"],
  timediff: ["#timediff", "#td-", ".td-"],
  cron: ["#cron", "#cron-"],
  countdown: ["#countdown", "#cd-", ".countdown-"],
  dateremind: ["#dateremind", "#dr-", ".dr-", ".dateremind-"],
  ahex: ["#ahex", "#slider-a", "#slider-r", "#slider-g", "#slider-b", "#num-a", "#num-r", "#num-g", "#num-b", "#num-opacity", "#edit-r", "#edit-g", "#edit-b", "#edit-hex", ".preset[data-ahex]", ".ahex-"],
  color: ["#color", "#color-"],
  eyedropper: ["#eyedropper", "#eyedrop", ".eyedrop"],
  password: ["#password", "#pwd-", ".pwd-"],
  base64: ["#base64", "#b64-"],
  imgb64: ["#imgb64", "#ib64-"],
  url: ["#url", "#url-"],
  hash: ["#hash", "#hash-"],
  xorenc: ["#xorenc", "#xor-", ".xor-"],
  morse: ["#morse", "#morse-", ".morse-"],
  uuid: ["#uuid", "#uuid-"],
  json: ["#json", "#json-"],
  yaml: ["#yaml", "#yaml-"],
  sharecard: ["#sharecard", "#sc-", ".sharecard", ".sc-"],
  phlogo: ["#phlogo", "#phlogo-", ".phlogo-"],
  nokiasms: ["#nokiasms", "#nokia-", ".nokia-"],
  query: ["#query", "#query-"],
  text: ["#text", "#text-tool"],
  caseconv: ["#caseconv", "#case-"],
  regex: ["#regex", "#re-", ".re-mark", ".match-card", ".match-empty", ".match-groups"],
  diff: ["#diff", ".diff-"],
  qrcode: ["#qrcode", "#qr-"],
  units: ["#units", "#units-"],
  coord: ["#coord", "#coord-"],
  numbase: ["#numbase", "#numbase-"],
  markdown: ["#markdown", "#md-"],
  textimg: ["#textimg", "#ti-", ".textimg-"],
  imgtext: ["#imgtext", "#it-", ".imgtext-"],
  memo: ["#memo", ".memo-", ".memo "],
  gifmaker: ["#gifmaker", "#gif-", ".gif-frame", ".gif-progress", ".gif-preview"],
  vsplit: ["#vsplit", ".vsplit-", "#vsplit-"],
  vbb: ["#vbb", ".vbb-", "#vbb-"],
  gifbb: ["#gifbb", ".gifbb-", "#gifbb-"],
  vtrim: ["#vtrim", ".vtrim-", "#vtrim-"],
  vplay: ["#vplay", ".vplay-", "#vplay-"],
  audio: ["#audio", ".audio-", "#audio-"],
  adb: ["#adb", ".adb-", "#adb-"],
  wheel: ["#wheel", ".wheel-", "#wheel-"],
  ruler: ["#ruler", ".ruler-", "#ruler-"],
  muyu: ["#muyu", ".muyu-", "#muyu-"],
  minigames: ["#minigames", ".minigames-", "#mg-"],
  ambient: ["#ambient", ".ambient-", "#ambient-"],
  sandspiel: ["#sandspiel", ".sandspiel-"],
  lanshare: ["#lanshare", ".lanshare-", "#ls-"],
  ffbridge: ["#ffbridge", ".ffbridge-", "#ffb-"],
  ytdlp: ["#ytdlp", ".ytdlp-", "#ytdlp-"],
  imgpreview: ["#imgpreview", ".imgpreview-", "#imgprev-"],
  whiteboard: ["#whiteboard", ".whiteboard-", "#wb-"],
  imgtrim: ["#imgtrim", ".imgtrim-", "#imgtrim-"],
  imgkit: ["#imgkit", ".imgkit-", "#imgkit-", ".stitch-", ".crop-"],
  about: ["#about", ".about-"],
  acupoint: ["#acupoint", ".acupoint-", "#acu-"],
  healthread: ["#healthread", ".healthread-", ".hr-"],
  pdfcraft: ["#pdfcraft", ".pdfcraft-"],
  insectworld: ["#insectworld", ".insectworld-"],
  prehmuseum: ["#prehmuseum", ".prehmuseum-"],
  setup: ["#setup", ".setup-", "#setup-"],
};

function skipSpace(css, i) {
  while (i < css.length) {
    if (/\s/.test(css[i])) {
      i += 1;
      continue;
    }
    if (css[i] === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    break;
  }
  return i;
}

function readBalanced(css, start) {
  let i = start;
  let depth = 0;
  let inStr = false;
  let str = "";
  for (; i < css.length; i += 1) {
    const ch = css[i];
    if (inStr) {
      if (ch === str && css[i - 1] !== "\\") inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      str = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return css.length;
}

function assignPanel(selectorText) {
  if (isShellSelector(selectorText)) return null;
  const sel = selectorText.toLowerCase();
  let hit = null;
  let hits = 0;
  for (const [panelId, needles] of Object.entries(PANEL_SELECTORS)) {
    if (needles.some((n) => sel.includes(n.toLowerCase()))) {
      hit = panelId;
      hits += 1;
    }
  }
  return hits === 1 ? hit : null;
}

function parseRules(css) {
  const rules = [];
  let i = 0;
  while (i < css.length) {
    i = skipSpace(css, i);
    if (i >= css.length) break;
    const start = i;
    if (css[i] === "@") {
      const brace = css.indexOf("{", i);
      if (brace === -1) break;
      const end = readBalanced(css, brace);
      rules.push({ text: css.slice(start, end), head: css.slice(start, brace).trim() });
      i = end;
      continue;
    }
    const brace = css.indexOf("{", i);
    if (brace === -1) break;
    const end = readBalanced(css, brace);
    const selectors = css.slice(start, brace).trim();
    rules.push({ text: css.slice(start, end), head: selectors });
    i = end;
  }
  return rules;
}

function splitRule(rule) {
  if (/^@media/i.test(rule.head)) {
    if (isShellMedia(rule.head)) {
      const open = rule.text.indexOf("{");
      const close = rule.text.lastIndexOf("}");
      const inner = rule.text.slice(open + 1, close);
      const innerRules = parseRules(inner);
      if (innerRules.some((r) => isShellSelector(r.head) || isShellMedia(r.head))) {
        return { text: rule.text, panel: null };
      }
    }
    const open = rule.text.indexOf("{");
    const close = rule.text.lastIndexOf("}");
    const mediaHead = rule.text.slice(0, open + 1);
    const inner = rule.text.slice(open + 1, close);
    const innerRules = parseRules(inner);
    const buckets = { core: [], panels: {} };
    for (const innerRule of innerRules) {
      const sub = splitRule(innerRule);
      if (sub.panel) {
        buckets.panels[sub.panel] = buckets.panels[sub.panel] || [];
        buckets.panels[sub.panel].push(sub.text);
      } else if (sub.core) buckets.core.push(sub.text);
      else if (sub.chunks) {
        sub.chunks.forEach((c) => {
          if (c.panel) {
            buckets.panels[c.panel] = buckets.panels[c.panel] || [];
            buckets.panels[c.panel].push(c.text);
          } else buckets.core.push(c.text);
        });
      }
    }
    const chunks = [];
    if (buckets.core.length) chunks.push({ text: `${mediaHead}\n${buckets.core.join("\n\n")}\n}`, panel: null });
    for (const [panel, parts] of Object.entries(buckets.panels)) {
      chunks.push({ text: `${mediaHead}\n${parts.join("\n\n")}\n}`, panel });
    }
    return { chunks };
  }
  if (/^@keyframes/i.test(rule.head)) {
    const name = rule.head.match(/@keyframes\s+([^\s{]+)/i)?.[1];
    return { text: rule.text, panel: null, keyframe: name };
  }
  if (/^@/i.test(rule.head)) return { text: rule.text, panel: null };
  return { text: rule.text, panel: assignPanel(rule.head) };
}

function main() {
  const force = process.argv.includes("--force");
  const css = fs.readFileSync(STYLE, "utf8");
  const panelCssExists = fs.existsSync(PANELS_DIR) && fs.readdirSync(PANELS_DIR).some((f) => f.endsWith(".css"));
  if (panelCssExists && !force) {
    console.error("split-styles: panel CSS already exists; pass --force to re-split (may strip comments).");
    process.exit(1);
  }
  const rules = parseRules(css);
  const core = [];
  const panels = Object.fromEntries(Object.keys(PANEL_SELECTORS).map((k) => [k, []]));
  const keyframes = new Map();

  for (const rule of rules) {
    const split = splitRule(rule);
    if (split.keyframe) {
      keyframes.set(split.keyframe, split.text);
      core.push(split.text);
      continue;
    }
    if (split.chunks) {
      for (const chunk of split.chunks) {
        if (chunk.panel) panels[chunk.panel].push(chunk.text);
        else core.push(chunk.text);
      }
      continue;
    }
    if (split.panel) panels[split.panel].push(split.text);
    else core.push(split.text);
  }

  fs.mkdirSync(PANELS_DIR, { recursive: true });
  const coreText = `${core.join("\n\n").trim()}\n`;
  fs.writeFileSync(CORE, coreText, "utf8");

  let panelBytes = 0;
  let panelCount = 0;
  for (const [id, chunks] of Object.entries(panels)) {
    if (!chunks.length) continue;
    panelCount += 1;
    const text = `${chunks.join("\n\n").trim()}\n`;
    panelBytes += Buffer.byteLength(text);
    fs.writeFileSync(path.join(PANELS_DIR, `${id}.css`), text, "utf8");
    console.log(`styles/panels/${id}.css: ${Math.round(Buffer.byteLength(text) / 1024)}KB`);
  }

  const origKb = Math.round(Buffer.byteLength(css) / 1024);
  const coreKb = Math.round(Buffer.byteLength(coreText) / 1024);
  console.log(`\nstyle.css ${origKb}KB → style-core.css ${coreKb}KB + ${panelCount} panel files (${Math.round(panelBytes / 1024)}KB)`);
}

main();
