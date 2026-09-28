#!/usr/bin/env node
"use strict";

/**
 * 把 v2g-suite.js 拆成可维护源文件，再拼接回「字节级一致」的发布文件。
 *
 * 源目录：tools/extra-panels/v2g-suite-src/
 * 产物：  tools/extra-panels/v2g-suite.js（懒加载入口不变）
 *
 * 用法：
 *   node tools/scripts/build-v2g-suite.cjs           # 拼接并校验语法
 *   node tools/scripts/build-v2g-suite.cjs --split   # 从现有 suite 初次/重新拆分（覆盖 src）
 *   node tools/scripts/build-v2g-suite.cjs --check   # 仅检查：src 拼接 === 当前 suite
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const TOOLS = path.resolve(__dirname, "..");
const OUT = path.join(TOOLS, "extra-panels/v2g-suite.js");
const SRC_DIR = path.join(TOOLS, "extra-panels/v2g-suite-src");
const MANIFEST = path.join(SRC_DIR, "parts.json");

const PART_ORDER = [
  "00-prelude.js",
  "10-shared-encode.js",
  "20-v2g-ui.js",
  "30-vsplit.js",
  "40-vbb.js",
  "99-epilogue.js",
];

function read(file) {
  return fs.readFileSync(file);
}

function write(file, buf) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
}

function findAll(haystack, needle) {
  const out = [];
  let from = 0;
  while (from <= haystack.length) {
    const i = haystack.indexOf(needle, from);
    if (i < 0) break;
    out.push(i);
    from = i + Math.max(1, needle.length);
  }
  return out;
}

/** 按稳定锚点切分（保留原文件全部字节，含 CRLF） */
function splitSuite(rawBuf) {
  const raw = rawBuf.toString("binary");
  const nl = raw.includes("\r\n") ? "\r\n" : "\n";

  const anchors = [
    { name: "convertVideoToGif", needle: `${nl}      async function convertVideoToGif() {` },
    { name: "vsplit", needle: `${nl}      // ---- Video split (shares FFmpeg / blackbox encoder) ----` },
    { name: "vbb", needle: `${nl}      // ---- One-click blackbox split planner (vbb) ----` },
    { name: "epilogue", needle: `${nl}      });  } catch (err) {` },
  ];

  const cuts = [];
  for (const a of anchors) {
    const hits = findAll(raw, a.needle);
    if (hits.length !== 1) {
      throw new Error(`split anchor "${a.name}" expected 1 hit, got ${hits.length}`);
    }
    // hits[0] = 该段起始（含前置换行），下一段从这里切开
    cuts.push({ name: a.name, index: hits[0] });
  }

  // prelude: from 0 until `    try {` line (exclusive of shared) — actually prelude is before try
  // 外层 try（勿匹配 VBB_DEBUG 里的 try）
  const tryNeedle = `${nl}    try {${nl}      let v2gFile;`;
  const tryHits = findAll(raw, tryNeedle);
  if (tryHits.length !== 1) {
    throw new Error(`outer try anchor expected 1 hit, got ${tryHits.length}`);
  }
  const tryAt = tryHits[0];

  // parts:
  // 00: [0, tryAt)  — includes leading content ending before `    try {`
  // 10: [tryAt, convertAt)
  // 20: [convertAt, vsplitAt)
  // 30: [vsplitAt, vbbAt)
  // 40: [vbbAt, epilogueAt)
  // 99: [epilogueAt, end)

  const convertAt = cuts[0].index;
  const vsplitAt = cuts[1].index;
  const vbbAt = cuts[2].index;
  const epilogueAt = cuts[3].index;

  if (!(0 < tryAt && tryAt < convertAt && convertAt < vsplitAt && vsplitAt < vbbAt && vbbAt < epilogueAt)) {
    throw new Error(
      `bad cut order try=${tryAt} convert=${convertAt} vsplit=${vsplitAt} vbb=${vbbAt} epi=${epilogueAt}`
    );
  }

  return {
    "00-prelude.js": Buffer.from(raw.slice(0, tryAt), "binary"),
    "10-shared-encode.js": Buffer.from(raw.slice(tryAt, convertAt), "binary"),
    "20-v2g-ui.js": Buffer.from(raw.slice(convertAt, vsplitAt), "binary"),
    "30-vsplit.js": Buffer.from(raw.slice(vsplitAt, vbbAt), "binary"),
    "40-vbb.js": Buffer.from(raw.slice(vbbAt, epilogueAt), "binary"),
    "99-epilogue.js": Buffer.from(raw.slice(epilogueAt), "binary"),
  };
}

function buildFromSrc() {
  if (!fs.existsSync(MANIFEST)) {
    throw new Error(`missing ${MANIFEST}; run with --split first`);
  }
  const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
  const order = manifest.parts || PART_ORDER;
  const chunks = [];
  for (const name of order) {
    const p = path.join(SRC_DIR, name);
    if (!fs.existsSync(p)) throw new Error(`missing part ${name}`);
    chunks.push(read(p));
  }
  return Buffer.concat(chunks);
}

function doSplit() {
  if (!fs.existsSync(OUT)) throw new Error(`missing ${OUT}`);
  const raw = read(OUT);
  const parts = splitSuite(raw);
  fs.mkdirSync(SRC_DIR, { recursive: true });
  const sizes = {};
  for (const name of PART_ORDER) {
    write(path.join(SRC_DIR, name), parts[name]);
    sizes[name] = parts[name].length;
  }
  const rebuilt = Buffer.concat(PART_ORDER.map((n) => parts[n]));
  if (!raw.equals(rebuilt)) {
    throw new Error("split rebuild mismatch (internal bug)");
  }
  write(
    MANIFEST,
    Buffer.from(
      JSON.stringify(
        {
          version: 1,
          generatedFrom: "extra-panels/v2g-suite.js",
          parts: PART_ORDER,
          sizes,
          note: "编辑 src 分片后执行 node tools/scripts/build-v2g-suite.cjs；勿直接改拼接产物除非临时热修。",
        },
        null,
        2
      ) + "\n",
      "utf8"
    )
  );
  console.log("[build-v2g-suite] split ok → extra-panels/v2g-suite-src/");
  for (const name of PART_ORDER) {
    console.log(`  ${name}  ${sizes[name]} bytes`);
  }
}

function doBuild() {
  const buf = buildFromSrc();
  write(OUT, buf);
  execFileSync(process.execPath, ["--check", OUT], { stdio: "pipe" });
  console.log(`[build-v2g-suite] wrote ${path.relative(TOOLS, OUT)} (${buf.length} bytes)`);
}

function doCheck() {
  const built = buildFromSrc();
  const cur = read(OUT);
  if (!built.equals(cur)) {
    console.error("[build-v2g-suite] CHECK FAIL: src 拼接与当前 v2g-suite.js 不一致");
    console.error("  若刚改过分片：先 build；若刚改过产物：先 --split 再核对。");
    process.exitCode = 1;
    return;
  }
  execFileSync(process.execPath, ["--check", OUT], { stdio: "pipe" });
  console.log("[build-v2g-suite] CHECK ok (src ≡ suite, syntax ok)");
}

const args = new Set(process.argv.slice(2));
try {
  if (args.has("--split")) doSplit();
  else if (args.has("--check")) doCheck();
  else {
    if (!fs.existsSync(MANIFEST)) {
      console.log("[build-v2g-suite] no src yet → auto --split");
      doSplit();
    }
    doBuild();
    doCheck();
  }
} catch (err) {
  console.error("[build-v2g-suite]", err.message || err);
  process.exitCode = 1;
}
