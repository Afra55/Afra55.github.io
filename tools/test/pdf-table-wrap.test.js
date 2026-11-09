"use strict";

const fs = require("fs");
const path = require("path");
const assert = require("assert");
const vm = require("vm");

const root = path.join(__dirname, "..");
const ops = fs.readFileSync(path.join(root, "pandoc-bridge/pandoc-ops.js"), "utf8");
const lua = fs.readFileSync(path.join(root, "pandoc-bridge/table-wrap.lua"), "utf8");
const files = JSON.parse(fs.readFileSync(path.join(root, "bridge-files.json"), "utf8"));
const server = fs.readFileSync(path.join(root, "adb-bridge/server.js"), "utf8");
const mdm = fs.readFileSync(path.join(root, "extra-panels/mdm.js"), "utf8");
const docfmt = fs.readFileSync(path.join(root, "extra-panels/docfmt.js"), "utf8");
const docfmtHtml = fs.readFileSync(path.join(root, "panels/docfmt.html"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
  console.log(`ok - ${name}`);
}

function loadNormalize() {
  const m = ops.match(/const PDF_PAPER_PRESETS = \{[\s\S]*?\n\};/);
  const fn = ops.match(/function normalizePdfPaper\(raw\) \{[\s\S]*?\n\}/);
  assert.ok(m && fn, "missing paper helpers");
  const box = {};
  vm.runInNewContext(`${m[0]}\n${fn[0]}\nthis.normalize = normalizePdfPaper;\nthis.presets = PDF_PAPER_PRESETS;`, box);
  return box;
}

t("table-wrap.lua 给每列相对宽度", () => {
  assert.ok(lua.includes("function Table"));
  assert.ok(lua.includes("colspecs"));
  assert.ok(lua.includes("0.92"));
});

t("pandoc-ops 默认纸张 A4 + 可关表格压缩", () => {
  assert.ok(ops.includes("PDF_PAPER_PRESETS"));
  assert.ok(ops.includes("normalizePdfPaper"));
  assert.ok(ops.includes("a4paper,margin=1.2cm"));
  assert.ok(ops.includes("paperwidth=80cm"));
  assert.ok(ops.includes("fitTables: false"));
  assert.ok(ops.includes("resolveTableWrapLua"));
  assert.ok(ops.includes("--lua-filter"));
  assert.ok(ops.includes("\\\\setlength{\\\\LTleft}{0pt}") || ops.includes("\\setlength{\\LTleft}{0pt}"));
  // 旧「只 margin」不得再当唯一布局
  assert.ok(!/geometry:margin=1\.2cm(?!,)/.test(ops) || ops.includes("geometry:${paper.geometry}"));
});

t("normalizePdfPaper：默认 a4；ultrawide 别名", () => {
  const { normalize, presets } = loadNormalize();
  assert.strictEqual(normalize("").id, "a4");
  assert.strictEqual(normalize("A4").id, "a4");
  assert.strictEqual(normalize("letter").id, "letter");
  assert.strictEqual(normalize("a3-land").geometry.includes("landscape"), true);
  assert.strictEqual(normalize("ultrawide").fitTables, false);
  assert.strictEqual(normalize("full-table").id, "ultrawide");
  assert.strictEqual(normalize("fulltable").fitTables, false);
  assert.ok(presets.a4.fitTables);
  assert.ok(!presets.ultrawide.fitTables);
});

t("pushPdfLayoutArgs 按 paper 分支", () => {
  assert.ok(ops.includes("function pushPdfLayoutArgs(args, tmp, opts"));
  assert.ok(ops.includes("if (paper.fitTables)"));
  assert.ok(ops.includes("超宽预览：不压表格列宽"));
  assert.ok(ops.includes("paperInfo = pushPdfLayoutArgs") || ops.includes("pushPdfLayoutArgs(args, tmp,"));
});

t("MDM / docfmt 透传 paper", () => {
  assert.ok(mdm.includes("PDF_PAPER_OPTIONS"));
  assert.ok(mdm.includes("pickPdfPaperModal"));
  assert.ok(/paper:\s*pdfPaper/.test(mdm));
  assert.ok(mdm.includes("ultrawide"));
  assert.ok(/\.\.\.\(paper \? \{ paper \} : \{\}\)/.test(docfmt) || docfmt.includes("...(paper ? { paper } : {})"));
  assert.ok(docfmtHtml.includes("docfmt-paper-md"));
  assert.ok(docfmtHtml.includes("超宽预览"));
});

t("桥清单与版本含 table-wrap + 纸张版", () => {
  assert.ok(files.files.includes("pandoc-bridge/table-wrap.lua"));
  assert.ok(server.includes('BRIDGE_VERSION = "0.9.135"'));
});

console.log(`pdf-table-wrap.test.js: ${n} passed`);
