"use strict";

const assert = require("assert");
const path = require("path");
const P = require(path.join(__dirname, "..", "lib", "mdm-pure.js"));

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("slugify 基本", () => {
  assert.strictEqual(P.slugify("Hello World"), "Hello-World");
  assert.strictEqual(P.slugify("a/b:c*d?e"), "a-b-c-d-e");
  assert.strictEqual(P.slugify(""), "doc");
  assert.strictEqual(P.slugify("  ..x..  "), "x");
  assert.strictEqual(P.slugify("x".repeat(100)).length, 60);
  assert.strictEqual(P.slugify("", "fb"), "fb");
});

t("parseFrontMatter", () => {
  const r = P.parseFrontMatter("---\ntitle: 标题\ncategory: 分类\ntags: [a, b]\n---\n\n正文");
  assert.strictEqual(r.title, "标题");
  assert.strictEqual(r.category, "分类");
  assert.deepStrictEqual(r.tags, ["a", "b"]);
  assert.strictEqual(r.body.trim(), "正文");

  const nofm = P.parseFrontMatter("没有 fm 的正文");
  assert.strictEqual(nofm.title, "");
  assert.deepStrictEqual(nofm.tags, []);
  assert.strictEqual(nofm.body, "没有 fm 的正文");
});

t("isRelativeRef", () => {
  assert.strictEqual(P.isRelativeRef("assets/a.png"), true);
  assert.strictEqual(P.isRelativeRef("./assets/a.png"), true);
  assert.strictEqual(P.isRelativeRef("https://x/a.png"), false);
  assert.strictEqual(P.isRelativeRef("data:image/png;base64,xx"), false);
  assert.strictEqual(P.isRelativeRef("#anchor"), false);
  assert.strictEqual(P.isRelativeRef(""), false);
});

t("collectRefs", () => {
  const text =
    '![a](assets/a.png) <video src="assets/v.mp4"></video> [f](files/x.zip) ![](https://e.com/z.png) ![d](data:image/png;base64,xx)';
  assert.deepStrictEqual(P.collectRefs(text).sort(), ["assets/a.png", "assets/v.mp4", "files/x.zip"]);
});

t("front-matter CRLF + 引号", () => {
  const r = P.parseFrontMatter('---\r\ntitle: "A B"\r\ntags: [x, y]\r\n---\r\nbody');
  assert.strictEqual(r.title, "A B");
  assert.deepStrictEqual(r.tags, ["x", "y"]);
});

t("collectRefs HTML src/href", () => {
  assert.deepStrictEqual(P.collectRefs('<img src="a/b.png"><a href="c/d.pdf">x</a>').sort(), [
    "a/b.png",
    "c/d.pdf",
  ]);
});

t("slugify 中文/空格", () => {
  assert.strictEqual(P.slugify("我的 文档"), "我的-文档");
});

t("front-matter head 保留其它键", () => {
  const r = P.parseFrontMatter("---\ntitle: T\ndate: 2024-01-01\n---\nbody");
  assert.strictEqual(r.title, "T");
  assert.ok(r.head.includes("date: 2024-01-01"));
  assert.strictEqual(r.body.trim(), "body");
});

t("表格解析与生成", () => {
  const lines = ["前文", "| A | B |", "| --- | --- |", "| 1 | 2 |", "后文"];
  const r = P.parseTableAt(lines, 3);
  assert.strictEqual(r.start, 1);
  assert.strictEqual(r.end, 3);
  assert.deepStrictEqual(r.grid, [["A", "B"], ["1", "2"]]);
  assert.strictEqual(P.buildTable(r.grid), "| A | B |\n| --- | --- |\n| 1 | 2 |");
  assert.strictEqual(P.parseTableAt(lines, 0).start, 1);
  assert.strictEqual(P.parseTableAt(["foo", "bar", "baz"], 1), null);
});

console.log(`mdm.test: ${n} passed`);
