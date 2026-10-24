"use strict";

const assert = require("assert");
const path = require("path");
const Series = require(path.join(__dirname, "..", "lib", "qr-series.js"));

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("parsePart 只认合法 [i/n]", () => {
  assert.deepStrictEqual(Series.parsePart("[1/3]hello"), { index: 1, total: 3, body: "hello" });
  assert.strictEqual(Series.parsePart("https://a.com"), null);
  assert.strictEqual(Series.parsePart("[0/3]x"), null);
  assert.strictEqual(Series.parsePart("[2/1]x"), null);
  assert.strictEqual(Series.parsePart("[1/99]x"), null);
});

t("无关多码不进入分片组", () => {
  const out = Series.ingestTexts(null, ["hello", "world", "https://a.com"]);
  assert.strictEqual(out.hasSeries, false);
  assert.strictEqual(out.plain.length, 3);
});

t("同 n 分片可拼；夹杂的无关码进 plain", () => {
  const out = Series.ingestTexts(null, ["[1/3]aaa", "https://x.test", "[2/3]bbb", "[3/3]ccc"]);
  assert.strictEqual(out.completed.length, 1);
  assert.strictEqual(out.completed[0].joined, "aaabbbccc");
  assert.deepStrictEqual(out.plain, ["https://x.test"]);
});

t("不同 n 的两套分片分开会话、各自拼接", () => {
  let bag = Series.createBag();
  let out = Series.ingestTexts(bag, ["[1/3]AAA", "[1/2]xx"]);
  bag = out.bag;
  assert.strictEqual(out.incomplete.length, 2);
  assert.ok(out.displayHits.some((h) => /套1/.test(h.format) || /部分拼接 1\/3/.test(h.format)));
  out = Series.ingestTexts(bag, ["[2/2]yy"]);
  assert.strictEqual(out.completed.length, 1);
  assert.strictEqual(out.completed[0].joined, "xxyy");
  assert.strictEqual(out.incomplete.length, 1);
  assert.strictEqual(out.incomplete[0].got, 1);
  assert.strictEqual(out.incomplete[0].total, 3);
  out = Series.ingestTexts(out.bag, ["[2/3]BBB", "[3/3]CCC"]);
  assert.strictEqual(out.completed.length, 1);
  assert.strictEqual(out.completed[0].joined, "AAABBBCCC");
  assert.strictEqual(out.bag.sessions.length, 0);
});

t("同 n 但同序号正文冲突 → 新开一套，不覆盖旧套", () => {
  let out = Series.ingestTexts(null, ["[1/3]hello"]);
  out = Series.ingestTexts(out.bag, ["[1/3]world"]);
  assert.strictEqual(out.incomplete.length, 2);
  const bodies = out.incomplete.map((r) => r.joined).sort();
  assert.deepStrictEqual(bodies, ["hello", "world"]);
});

t("未齐也拼已有：1+2/3 正文相连", () => {
  const out = Series.ingestTexts(null, ["[1/3]AA", "[2/3]BB"]);
  assert.strictEqual(out.incomplete.length, 1);
  assert.strictEqual(out.incomplete[0].joined, "AABB");
  assert.deepStrictEqual(out.incomplete[0].missing, [3]);
});

t("中间缺片插入占位", () => {
  const out = Series.ingestTexts(null, ["[1/3]A", "[3/3]C"]);
  assert.strictEqual(out.incomplete[0].joined, `A${Series.GAP_MARK(2)}C`);
});

t("连续收片：齐了从袋中移除", () => {
  let out = Series.ingestTexts(null, ["[1/3]A"]);
  assert.strictEqual(out.bag.sessions.length, 1);
  out = Series.ingestTexts(out.bag, ["[3/3]C"]);
  assert.strictEqual(out.incomplete[0].got, 2);
  out = Series.ingestTexts(out.bag, ["[2/3]B"]);
  assert.ok(out.completed[0].complete);
  assert.strictEqual(out.completed[0].joined, "ABC");
  assert.strictEqual(out.bag.sessions.length, 0);
});

t("buildDisplayHits 多套：完成与未齐都列出", () => {
  const out = Series.ingestTexts(null, ["[1/2]aa", "[2/2]bb", "[1/3]x"]);
  assert.ok(out.displayHits.length >= 2);
  assert.ok(out.displayHits.some((h) => h.text === "aabb"));
  assert.ok(out.displayHits.some((h) => h.text === "x"));
});

t("旧 ingest 仍可用（同 n 单套）", () => {
  let r = Series.ingest(null, new Map([[1, { index: 1, total: 2, body: "x" }]]), 2);
  r = Series.ingest(r.session, new Map([[2, { index: 2, total: 2, body: "y" }]]), 2);
  assert.ok(r.complete);
  assert.strictEqual(r.joined, "xy");
});

t("换一套 n：旧单会话 API 会开新会话", () => {
  let r = Series.ingest(null, new Map([[1, { index: 1, total: 2, body: "x" }]]), 2);
  r = Series.ingest(r.session, new Map([[1, { index: 1, total: 3, body: "y" }]]), 3);
  assert.strictEqual(r.session.total, 3);
  assert.strictEqual(r.got, 1);
});

console.log(`qr-series.test.js: ${n} passed`);
