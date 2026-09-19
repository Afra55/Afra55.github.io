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

console.log(`mdm.test: ${n} passed`);
