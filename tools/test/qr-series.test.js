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
  const cls = Series.classifyTexts(["hello", "world", "https://a.com"]);
  assert.strictEqual(cls.hasSeries, false);
  assert.strictEqual(cls.plain.length, 3);
});

t("同 n 分片可拼；夹杂的无关码进 plain", () => {
  const cls = Series.classifyTexts(["[1/3]aaa", "https://x.test", "[2/3]bbb", "[3/3]ccc"]);
  assert.strictEqual(cls.hasSeries, true);
  assert.strictEqual(cls.seriesTotal, 3);
  assert.strictEqual(cls.seriesParts.size, 3);
  assert.deepStrictEqual(cls.plain, ["https://x.test"]);
  const r = Series.ingest(null, cls.seriesParts, cls.seriesTotal);
  assert.ok(r.complete);
  assert.strictEqual(r.joined, "aaabbbccc");
});

t("不同 n 的分片不互相拼：次要组进 plain", () => {
  const cls = Series.classifyTexts(["[1/2]aa", "[2/2]bb", "[1/3]xx"]);
  assert.strictEqual(cls.seriesTotal, 2);
  assert.ok(cls.plain.includes("[1/3]xx"));
  const r = Series.ingest(null, cls.seriesParts, cls.seriesTotal);
  assert.ok(r.complete);
  assert.strictEqual(r.joined, "aabb");
});

t("未齐也拼已有：1+2/3 正文相连，缺片只在标签", () => {
  const r = Series.ingest(
    null,
    new Map([
      [1, { index: 1, total: 3, body: "AA" }],
      [2, { index: 2, total: 3, body: "BB" }],
    ]),
    3
  );
  assert.strictEqual(r.complete, false);
  assert.strictEqual(r.joined, "AABB");
  assert.deepStrictEqual(r.missing, [3]);
  assert.ok(r.format.includes("部分拼接 2/3"));
  assert.ok(r.format.includes("缺第3片"));
});

t("中间缺片插入占位，前后已有仍拼进正文", () => {
  const r = Series.ingest(
    null,
    new Map([
      [1, { index: 1, total: 3, body: "A" }],
      [3, { index: 3, total: 3, body: "C" }],
    ]),
    3
  );
  assert.strictEqual(r.complete, false);
  assert.strictEqual(r.joined, `A${Series.GAP_MARK(2)}C`);
  assert.deepStrictEqual(r.missing, [2]);
});

t("连续收片：未齐有 partial joined，齐了无占位", () => {
  let r = Series.ingest(null, new Map([[1, { index: 1, total: 3, body: "A" }]]), 3);
  assert.strictEqual(r.complete, false);
  assert.strictEqual(r.joined, "A");
  r = Series.ingest(r.session, new Map([[3, { index: 3, total: 3, body: "C" }]]), 3);
  assert.strictEqual(r.complete, false);
  assert.strictEqual(r.got, 2);
  assert.ok(r.joined.includes(Series.GAP_MARK(2)));
  r = Series.ingest(r.session, new Map([[2, { index: 2, total: 3, body: "B" }]]), 3);
  assert.ok(r.complete);
  assert.strictEqual(r.joined, "ABC");
});

t("buildDisplayHits：部分拼接在前，无关码在后", () => {
  const r = Series.ingest(
    null,
    new Map([
      [1, { index: 1, total: 3, body: "hi" }],
      [2, { index: 2, total: 3, body: "yo" }],
    ]),
    3
  );
  const hits = Series.buildDisplayHits(r, ["https://x.test"]);
  assert.strictEqual(hits.length, 2);
  assert.strictEqual(hits[0].text, "hiyo");
  assert.ok(hits[0].format.startsWith("部分拼接"));
  assert.strictEqual(hits[1].text, "https://x.test");
  assert.strictEqual(hits[1].format, "其它码（未拼接）");
});

t("换一套 n 会开新会话", () => {
  let r = Series.ingest(null, new Map([[1, { index: 1, total: 2, body: "x" }]]), 2);
  r = Series.ingest(r.session, new Map([[1, { index: 1, total: 3, body: "y" }]]), 3);
  assert.strictEqual(r.session.total, 3);
  assert.strictEqual(r.got, 1);
  assert.strictEqual(r.session.parts.get(1), "y");
});

console.log(`qr-series.test.js: ${n} passed`);
