"use strict";

const assert = require("assert");
const path = require("path");
const R = require(path.join(__dirname, "..", "lib", "doc-quality-router.js"));
const mineru = require(path.join(__dirname, "..", "mineru-bridge", "mineru-ops.js"));
const pandoc = require(path.join(__dirname, "..", "pandoc-bridge", "pandoc-ops.js"));

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("docx 导入以 pandoc 为首", () => {
  const r = R.importRoute("a.docx");
  assert.strictEqual(r.primary, "pandoc");
  assert.deepStrictEqual(r.chain.slice(0, 2), ["pandoc", "mineru"]);
});

t("pdf/图片导入以 mineru 为首", () => {
  assert.strictEqual(R.importRoute("x.pdf").primary, "mineru");
  assert.strictEqual(R.importRoute("x.png").primary, "mineru");
  assert.strictEqual(R.importRoute("scan.jpg").primary, "mineru");
});

t("旧 doc 走 mineru 且无 browser", () => {
  const r = R.importRoute("legacy.doc");
  assert.strictEqual(r.primary, "mineru");
  assert.ok(!r.chain.includes("browser"));
});

t("md/txt 直读", () => {
  assert.strictEqual(R.importRoute("a.md").primary, "raw");
  assert.strictEqual(R.importRoute("a.txt").primary, "raw");
});

t("prefersPandoc 与 primary 一致", () => {
  assert.strictEqual(R.prefersPandoc("a.docx"), true);
  assert.strictEqual(R.prefersPandoc("a.pdf"), false);
  assert.strictEqual(R.prefersPandoc("a.doc"), false);
});

t("导出 html/epub/latex 含最高质量参数", () => {
  const html = R.exportPandocPlan("html");
  assert.ok(html.args.includes("--standalone"));
  assert.ok(html.args.includes("--embed-resources"));
  assert.strictEqual(html.from, "gfm");
  assert.ok(R.exportPandocPlan("epub").args.includes("--standalone"));
  assert.ok(R.exportPandocPlan("latex").args.includes("--standalone"));
});

t("MDM 导出菜单格式均有方案", () => {
  const menu = ["docx", "odt", "epub", "rtf", "rst", "latex", "pptx", "mediawiki", "org", "opml", "html"];
  for (const fmt of menu) {
    assert.ok(R.exportPandocPlan(fmt).known, `缺少导出方案：${fmt}`);
  }
  for (const fmt of ["md", "html-standalone", "pdf", "png"]) {
    assert.ok(R.exportLocalPlan(fmt).known, `缺少本地导出方案：${fmt}`);
  }
});

t("与 MinerU SUPPORTED_EXT 对齐", () => {
  for (const ext of mineru.SUPPORTED_EXT || []) {
    const r = R.importRoute(`file${ext}`);
    assert.ok(r.known, `路由表缺少 MinerU 格式 ${ext}`);
  }
});

t("与 Pandoc FILE_FROM 对齐（md 除外走 raw）", () => {
  for (const ext of Object.keys(pandoc.FILE_FROM || {})) {
    const r = R.importRoute(`file${ext}`);
    assert.ok(r.known, `路由表缺少 Pandoc 导入格式 ${ext}`);
    if (ext === ".md" || ext === ".markdown") {
      assert.strictEqual(r.primary, "raw");
    } else {
      assert.strictEqual(r.primary, "pandoc", `${ext} 应以 pandoc 为首`);
    }
  }
});

t("auditQualityMatrix 通过", () => {
  const audit = R.auditQualityMatrix({
    mineruExts: [...(mineru.SUPPORTED_EXT || [])],
    pandocImportExts: Object.keys(pandoc.FILE_FROM || {}),
    pandocExportFmts: ["docx", "odt", "epub", "rtf", "rst", "latex", "pptx", "mediawiki", "org", "opml", "html"],
  });
  assert.strictEqual(audit.ok, true, audit.problems.join("\n"));
});

console.log(`doc-quality-router.test.js: ${n} ok`);
