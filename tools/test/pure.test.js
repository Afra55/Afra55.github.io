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
  const mixed = P.timeDiff("1719792000", "1719878400000");
  assert.strictEqual(mixed.ms, 86400000);
  assert.strictEqual(mixed.a.unit, "秒时间戳");
  assert.strictEqual(mixed.b.unit, "毫秒时间戳");
  const spaced = P.timeDiff("1_719_792_000", "2024-07-02 08:00:00");
  assert.ok(spaced.ms >= 0);
  assert.match(spaced.text, /秒时间戳/);
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


test("share card render", () => {
  const json = P.renderShareCode('{"a":1,"b":"x"}', { lang: "json", prettyJson: true, lineNumbers: true });
  assert.strictEqual(json.lang, "json");
  assert.ok(json.html.includes("tok-key"));
  assert.ok(json.html.includes("tok-num"));
  assert.ok(json.lineCount >= 4);
  assert.strictEqual(P.detectShareLang('{"ok":true}', "auto"), "json");
  assert.strictEqual(P.detectShareLang("@Composable\nfun Hi() {}", "auto"), "kotlin");
  assert.strictEqual(P.detectShareLang("public class Main { public static void main(String[] a) {} }", "auto"), "java");
  const kt = P.renderShareCode(
    '@Composable\nfun Greeting(name: String) {\n    Text(text = "Hello, $name!")\n}',
    { lang: "auto" }
  );
  assert.strictEqual(kt.lang, "kotlin");
  assert.ok(kt.html.includes("tok-kw"));
  assert.ok(kt.html.includes("tok-anno"));
  assert.ok(kt.html.includes("tok-str"));
  assert.ok(!kt.html.includes('<span <span'));
  assert.ok(!kt.html.includes('class="tok-kw">class</span>="tok-'));
  assert.ok(kt.html.includes('<span class="tok-anno">@Composable</span>'));
  assert.ok(kt.html.includes('<span class="tok-kw">fun</span>'));
  assert.ok(kt.html.includes('<span class="tok-str">&quot;Hello, $name!&quot;</span>'));
  const java = P.renderShareCode("public class Main {}", { lang: "java", lineNumbers: false });
  assert.ok(java.html.includes('<span class="tok-kw">class</span>'));
  assert.ok(!java.html.includes('<span <span'));
  const js = P.renderShareCode("const x = 1; // hi", { lang: "javascript", lineNumbers: false });
  assert.ok(js.html.includes("tok-kw"));
  assert.ok(js.html.includes("tok-comment"));
  const xml = P.renderShareCode('<div class="box">hi</div>', { lang: "xml", lineNumbers: false });
  assert.ok(xml.html.includes("tok-kw"));
  assert.ok(xml.html.includes("tok-key"));
  assert.ok(!xml.html.includes('<span <span'));
});


test("password generator", () => {
  const list = P.generatePasswords({ length: 12, count: 3, upper: true, lower: true, number: true, symbol: false, noAmbiguous: true });
  assert.strictEqual(list.length, 3);
  assert.ok(list.every((s) => s.length === 12));
  assert.ok(list.every((s) => !/[0Ool1I]/.test(s)));
  assert.throws(() => P.generatePasswords({ upper: false, lower: false, number: false, symbol: false }), /至少/);
  assert.strictEqual(P.rgbStringToAhex('rgb(46, 196, 182)'), '#FF2EC4B6');
});

console.log("\nAll pure tests passed.");


