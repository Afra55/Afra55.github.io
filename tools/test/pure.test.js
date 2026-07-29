const assert = require("assert");
const P = require("../lib/pure.js");

function test(name, fn) {
  try {
    fn();
    console.log("ok -", name);
  } catch (err) {
    console.error("fail -", name);
    throw err;
  }
}

test("md5", () => {
  assert.strictEqual(P.md5(""), "d41d8cd98f00b204e9800998ecf8427e");
  assert.strictEqual(P.md5("abc"), "900150983cd24fb0d6963f7d28e17f72");
  assert.strictEqual(P.md5("你好"), require("crypto").createHash("md5").update("你好", "utf8").digest("hex"));
});

test("color convert roundtrip-ish", () => {
  const c = P.colorFrom("hex", "#2EC4B6");
  assert.strictEqual(c.rgb, "rgb(46, 196, 182)");
  const back = P.colorFrom("rgb", c.rgb);
  assert.strictEqual(back.hex, "#2EC4B6");
  const hsl = P.colorFrom("hsl", c.hsl);
  assert.ok(Math.abs(hsl.r - 46) <= 2);
});

test("query parse", () => {
  assert.deepStrictEqual(P.parseQuery("a=1&b=hello%20world"), { a: "1", b: "hello world" });
  assert.strictEqual(P.parseQuery("https://x.test/?q=1&q=2").q[1], "2");
});

test("jwt parse", () => {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ sub: "u1", name: "tom" })).toString("base64url");
  const parsed = P.parseJwt(`${header}.${payload}.sig`);
  assert.strictEqual(parsed.payload.name, "tom");
  assert.strictEqual(parsed.header.typ, "JWT");
});

test("uuid", () => {
  const id = P.uuidv4();
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.strictEqual(P.formatUuid(id, { noHyphen: true }).includes("-"), false);
});

test("time diff", () => {
  const r = P.timeDiff("2024-01-01 00:00:00", "2024-01-02 01:02:03");
  assert.strictEqual(r.ms, ((24 + 1) * 3600 + 2 * 60 + 3) * 1000);
});

test("text tools", () => {
  assert.strictEqual(P.transformText("a\n\nb\n", "dedupe-empty"), "a\nb");
  assert.strictEqual(P.transformText("b\na", "sort"), "a\nb");
  assert.strictEqual(P.textStats("hello world").words, 2);
});

test("diff lines", () => {
  const d = P.diffLines("a\nb\nc", "a\nx\nc");
  assert.ok(d.some((x) => x.type === "del" && x.text === "b"));
  assert.ok(d.some((x) => x.type === "add" && x.text === "x"));
});

test("units", () => {
  assert.ok(Math.abs(P.convertUnit("temp", 0, "C", "F") - 32) < 1e-9);
  assert.ok(Math.abs(P.convertUnit("length", 1, "km", "m") - 1000) < 1e-9);
  assert.ok(Math.abs(P.convertUnit("weight", 1, "kg", "g") - 1000) < 1e-9);
});

test("cron next", () => {
  const base = new Date(2024, 0, 1, 0, 0, 0, 0).getTime();
  const next = P.nextCronTimes("*/15 * * * *", base, 4);
  assert.strictEqual(next.length, 4);
  assert.strictEqual(new Date(next[0]).getMinutes() % 15, 0);
  assert.throws(() => P.describeCron("* * *"), /5/);
});

console.log("\nAll pure tests passed.");
