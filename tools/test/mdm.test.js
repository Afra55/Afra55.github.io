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
  const r = P.parseFrontMatter("---\ntitle: 标题\ntags: [a, b]\n---\n\n正文");
  assert.strictEqual(r.title, "标题");
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

t("改名后更新引用", () => {
  const r = P.replaceDocRefs('[见](a.md) 和 ![x](./a.md#h) 与 <a href="a.md">看</a>', "a.md", "b.md");
  assert.strictEqual(r.count, 3);
  assert.ok(r.text.includes("](b.md)"));
  assert.ok(r.text.includes("./b.md#h"));
  assert.ok(r.text.includes('href="b.md"'));
  assert.strictEqual(P.replaceDocRefs("没有引用", "a.md", "b.md").count, 0);
  assert.strictEqual(P.replaceDocRefs("[c](sub/a.md)", "a.md", "b.md").text, "[c](sub/b.md)");
  assert.strictEqual(P.replaceDocRefs("[c](a.md.bak)", "a.md", "b.md").count, 0);
});

t("表格对齐与无表头", () => {
  const lines = ["| 左 | 中 | 右 |", "| :--- | :---: | ---: |", "| 1 | 2 | 3 |"];
  const r = P.parseTableAt(lines, 0);
  assert.deepStrictEqual(r.align, ["left", "center", "right"]);
  assert.strictEqual(
    P.buildTable(r.grid, { align: r.align }),
    "| 左 | 中 | 右 |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |"
  );
  assert.strictEqual(
    P.buildTable([["1", "2"]], { header: false }),
    "|  |  |\n| --- | --- |\n| 1 | 2 |"
  );
});

t("搜索语法 tag:", () => {
  const a = P.parseSearch("tag:工作 报告");
  assert.deepStrictEqual(a.tags, ["工作"]);
  assert.strictEqual(a.q, "报告");
  const b = P.parseSearch("tag:\"a b\"");
  assert.deepStrictEqual(b.tags, ["a b"]);
  assert.strictEqual(b.q, "");
  assert.strictEqual(P.parseSearch("普通搜索").q, "普通搜索");
});

t("joinDocPath 拼接文档路径", () => {
  assert.strictEqual(P.joinDocPath("D:\\notes", "a.md"), "D:\\notes\\a.md");
  assert.strictEqual(P.joinDocPath("D:\\notes\\", "a.md"), "D:\\notes\\a.md");
  assert.strictEqual(P.joinDocPath("/home/me/notes", "a.md"), "/home/me/notes/a.md");
  assert.strictEqual(P.joinDocPath("", "a.md"), "");
  assert.strictEqual(P.joinDocPath("D:\\notes", ""), "");
});

t("front-matter tags 多行 YAML 列表", () => {
  const r = P.parseFrontMatter("---\ntitle: T\ntags:\n  - a\n  - b\n---\nbody");
  assert.deepStrictEqual(r.tags, ["a", "b"]);
  assert.strictEqual(r.title, "T");
  const r2 = P.parseFrontMatter("---\ntags: a, b\ntag: c\n---\nx");
  assert.deepStrictEqual(r2.tags, ["c"]);
  const r3 = P.parseFrontMatter("---\ntags: [a, b]\n---\nx");
  assert.deepStrictEqual(r3.tags, ["a", "b"]);
});

t("sanitizeRelPath 拒穿越与绝对路径", () => {
  assert.strictEqual(P.sanitizeRelPath("assets/a.png"), "assets/a.png");
  assert.strictEqual(P.sanitizeRelPath("./x/y.png"), "x/y.png");
  assert.strictEqual(P.sanitizeRelPath("../secret.png"), null);
  assert.strictEqual(P.sanitizeRelPath("a/../../b.png"), null);
  assert.strictEqual(P.sanitizeRelPath("C:/Windows/a.png"), null);
  assert.strictEqual(P.sanitizeRelPath("https://x/a.png"), null);
  assert.strictEqual(P.sanitizeRelPath("data:image/png;base64,xx"), null);
  assert.strictEqual(P.sanitizeRelPath(""), null);
  assert.strictEqual(P.sanitizeRelPath("con.png"), null);
  assert.strictEqual(P.sanitizeRelPath("ok/a:b.png"), null);
});

t("validateImportMarkdown 正常 / 拒二进制 / 空文件", () => {
  const ok = P.validateImportMarkdown("---\ntitle: 你好\n---\n\n正文", { fileName: "x.md" });
  assert.strictEqual(ok.ok, true);
  assert.strictEqual(ok.title, "你好");
  assert.strictEqual(ok.body.trim(), "正文");

  const empty = P.validateImportMarkdown("", { fileName: "empty.md" });
  assert.strictEqual(empty.ok, true);
  assert.strictEqual(empty.title, "empty");

  const bin = P.validateImportMarkdown("abc\0def", { fileName: "b.md" });
  assert.strictEqual(bin.ok, false);
  assert.ok(/二进制/.test(bin.error));

  const badType = P.validateImportMarkdown(null, { fileName: "n.md" });
  assert.strictEqual(badType.ok, false);

  const fromName = P.validateImportMarkdown("# hi", { fileName: "my-note.md" });
  assert.strictEqual(fromName.title, "my-note");

  const dirtyTitle = P.validateImportMarkdown("---\ntitle: a/b:c\n---\nx", { fileName: "z.md" });
  assert.ok(!/[\\/:*?]/.test(dirtyTitle.title));
});

t("collectRefs 跳过穿越路径", () => {
  const refs = P.collectRefs('![a](assets/a.png) ![bad](../x.png) <img src="ok/b.png">');
  assert.deepStrictEqual(refs.sort(), ["assets/a.png", "ok/b.png"]);
});

t("mdm.js 导入走 validateImportMarkdown", () => {
  const src = require("fs").readFileSync(path.join(__dirname, "..", "extra-panels", "mdm.js"), "utf8");
  assert.ok(/validateImportMarkdown/.test(src));
  assert.ok(/sanitizeRelPath/.test(src));
  assert.ok(/校验并入库/.test(src));
});

t("normalizeImportFolderTagName 适配怪名字", () => {
  assert.strictEqual(P.normalizeImportFolderTagName("工作笔记"), "工作笔记");
  assert.strictEqual(P.normalizeImportFolderTagName("  My Docs  "), "My Docs");
  assert.strictEqual(P.normalizeImportFolderTagName("a/b:c*d?e"), "a b c d e");
  assert.strictEqual(P.normalizeImportFolderTagName("...hidden..."), "hidden");
  assert.strictEqual(P.normalizeImportFolderTagName("#话题"), "话题");
  assert.strictEqual(P.normalizeImportFolderTagName("默认"), "默认文件夹");
  assert.strictEqual(P.normalizeImportFolderTagName("默认", { defaultTagName: "默认" }), "默认文件夹");
  assert.strictEqual(P.normalizeImportFolderTagName("con"), "con_文件夹");
  assert.strictEqual(P.normalizeImportFolderTagName(""), "");
  assert.strictEqual(P.normalizeImportFolderTagName("."), "");
  assert.strictEqual(P.normalizeImportFolderTagName("..\u0000.."), "");
  assert.ok(P.normalizeImportFolderTagName("📚 读书").includes("读书"));
  assert.strictEqual(P.normalizeImportFolderTagName("x".repeat(80)).length, 48);
  // 零宽字符剥掉
  assert.strictEqual(P.normalizeImportFolderTagName("ab\u200bcd"), "abcd");
});

t("folderTagFromRelPath 仅文件夹导入才出标签", () => {
  assert.strictEqual(P.folderTagFromRelPath("笔记/a.md"), "笔记");
  assert.strictEqual(P.folderTagFromRelPath("笔记/子/a.md"), "笔记");
  assert.strictEqual(P.folderTagFromRelPath("My Docs/x.md"), "My Docs");
  assert.strictEqual(P.folderTagFromRelPath("a\\b\\c.md"), "a");
  assert.strictEqual(P.folderTagFromRelPath("alone.md"), "");
  assert.strictEqual(P.folderTagFromRelPath(""), "");
  assert.strictEqual(P.folderTagFromRelPath("默认/x.md"), "默认文件夹");
});

t("mdm.js 导入文件夹自动打文件夹名标签", () => {
  const src = require("fs").readFileSync(path.join(__dirname, "..", "extra-panels", "mdm.js"), "utf8");
  assert.ok(/folderTagFromRelPath/.test(src));
  assert.ok(/文件夹名/.test(src));
  const ingest = src.slice(src.indexOf("async function ingestMarkdownText"), src.indexOf("for (let i = 0; i < list.length"));
  assert.ok(ingest.includes("folderTagName"));
  assert.ok(ingest.includes("ensureTag(folderTagName)"));
  assert.ok(!/导入不自动建标签/.test(ingest));
});

console.log(`mdm.test: ${n} passed`);
