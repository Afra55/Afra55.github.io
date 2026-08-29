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
  assert.ok(d.some((x) => x.type === "change" && x.left === "b" && x.right === "x"));
  assert.ok(d.some((x) => x.type === "same" && x.text === "a"));
  const stats = P.diffStats(d);
  assert.strictEqual(stats.change, 1);
  assert.strictEqual(stats.same, 2);
});

test("diff align and ignore whitespace", () => {
  const rows = P.diffAlign("foo  \nbar", "foo\nbar", { trimTrailing: true });
  assert.ok(rows.every((r) => r.kind === "same"));
  const d2 = P.diffLines("foo  bar", "foo bar", { ignoreWhitespace: true });
  assert.ok(d2.every((r) => r.type === "same"));
  const tail = P.diffLines("a\nb\nc", "a\nb");
  assert.ok(tail.some((x) => x.type === "del" && x.text === "c"));
});

test("diff change merge", () => {
  const rows = P.diffLines("alpha\nkeep", "beta\nkeep");
  assert.ok(rows.some((r) => r.type === "change"));
  const aligned = P.diffAlignFromRows(rows);
  assert.ok(aligned.some((r) => r.kind === "change"));
});

test("diff too large guard", () => {
  const big = Array.from({ length: 13000 }, (_, i) => `line-${i}`).join("\n");
  assert.throws(() => P.diffLines(big, "x"), /行数过多/);
});

test("diff chars", () => {
  const c = P.diffChars("abc", "axc");
  assert.ok(c.left.some((x) => x.type === "del" && x.ch === "b"));
  assert.ok(c.right.some((x) => x.type === "add" && x.ch === "x"));
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

test("case convert", () => {
  const one = P.convertIdentifier("userOrderId");
  assert.deepStrictEqual(one.words, ["user", "order", "id"]);
  assert.strictEqual(one.camel, "userOrderId");
  assert.strictEqual(one.pascal, "UserOrderId");
  assert.strictEqual(one.snake, "user_order_id");
  assert.strictEqual(one.screaming, "USER_ORDER_ID");
  assert.strictEqual(one.kebab, "user-order-id");
  assert.strictEqual(one.dot, "user.order.id");
  assert.strictEqual(P.convertIdentifier("XMLParser").pascal, "XmlParser");
  assert.strictEqual(P.convertIdentifier("user-order-id").camel, "userOrderId");
  assert.strictEqual(P.convertIdentifier("USER_ORDER_ID").kebab, "user-order-id");
  const multi = P.convertCaseLines("userOrderId\nxml_parser\n");
  assert.strictEqual(multi.count, 2);
  assert.strictEqual(multi.snake, "user_order_id\nxml_parser");
  assert.strictEqual(multi.pascal, "UserOrderId\nXmlParser");
});

test("coord convert", () => {
  const p = P.parseCoordPair("116.397428, 39.90923");
  assert.ok(Math.abs(p.lng - 116.397428) < 1e-9);
  assert.ok(Math.abs(p.lat - 39.90923) < 1e-9);
  assert.throws(() => P.parseCoordPair("bad"), /格式/);

  const gcj = P.wgs84ToGcj02(116.397428, 39.90923);
  assert.ok(Math.abs(gcj.lng - 116.397428) > 0.001);
  const back = P.gcj02ToWgs84(gcj.lng, gcj.lat);
  assert.ok(Math.abs(back.lng - 116.397428) < 1e-6);
  assert.ok(Math.abs(back.lat - 39.90923) < 1e-6);

  const bd = P.gcj02ToBd09(gcj.lng, gcj.lat);
  const gcj2 = P.bd09ToGcj02(bd.lng, bd.lat);
  assert.ok(Math.abs(gcj2.lng - gcj.lng) < 1e-6);
  assert.ok(Math.abs(gcj2.lat - gcj.lat) < 1e-6);

  const one = P.convertCoordinates("wgs84", "116.397428,39.90923");
  assert.ok(one.results.gcj02.decimal.includes(","));
  assert.ok(one.results.wgs84.dms.includes("°"));
  assert.ok(Math.abs(one.results.cgcs2000.lng - one.results.wgs84.lng) < 1e-12);

  const multi = P.convertCoordinateLines("wgs84", "116.397428,39.90923\nbad\n121.4737 31.2304");
  assert.strictEqual(multi.ok, 2);
  assert.strictEqual(multi.fail, 1);
  assert.ok(multi.decimal.gcj02.split("\n").length === 3);
  assert.ok(multi.decimal.gcj02.includes("—"));
});

test("image toolkit helpers", () => {
  const resized = P.calcResizeSize(1000, 500, { mode: "max", maxEdge: 200 });
  assert.strictEqual(resized.width, 200);
  assert.strictEqual(resized.height, 100);
  const pct = P.calcResizeSize(200, 100, { mode: "percent", percent: 50 });
  assert.strictEqual(pct.width, 100);
  assert.strictEqual(pct.height, 50);
  const crop = P.calcCropRect(1600, 900, { aspect: "1:1", center: true });
  assert.strictEqual(crop.width, crop.height);
  assert.strictEqual(crop.width, 900);
  const manual = P.calcCropRect(1000, 500, {
    aspect: "1:1",
    usePercent: true,
    xPercent: 10,
    yPercent: 0,
    wPercent: 40,
    hPercent: 80,
    center: false,
  });
  assert.strictEqual(manual.width, manual.height);
  assert.ok(manual.x >= 0 && manual.y >= 0);
  assert.ok(manual.x + manual.width <= 1000);
  assert.ok(manual.y + manual.height <= 500);
  // Manual percent must not be forced to image center when center:false
  assert.notStrictEqual(manual.x, Math.round((1000 - manual.width) / 2));
  const freePct = P.calcCropRect(200, 100, {
    aspect: "free",
    usePercent: true,
    xPercent: 25,
    yPercent: 10,
    wPercent: 50,
    hPercent: 40,
    center: false,
  });
  assert.strictEqual(freePct.x, 50);
  assert.strictEqual(freePct.y, 10);
  assert.strictEqual(freePct.width, 100);
  assert.strictEqual(freePct.height, 40);
  const grids = P.calcNineGridRects(300, 300);
  assert.strictEqual(grids.length, 9);
  assert.strictEqual(grids[8].width + grids[8].x, 300);
  const stitch = P.calcStitchLayout(
    [
      { width: 10, height: 20 },
      { width: 30, height: 10 },
    ],
    { mode: "horizontal", gap: 5 }
  );
  assert.strictEqual(stitch.width, 45);
  assert.strictEqual(stitch.height, 20);
  const stitchEqual = P.calcStitchLayout(
    [
      { width: 400, height: 200 },
      { width: 300, height: 200 },
    ],
    { mode: "horizontal", gap: 10, equalEdge: 200 }
  );
  assert.strictEqual(stitchEqual.height, 200);
  assert.strictEqual(stitchEqual.width, 710);
  const stitchEqualV = P.calcStitchLayout(
    [
      { width: 200, height: 100 },
      { width: 200, height: 150 },
    ],
    { mode: "vertical", gap: 0, equalEdge: 200 }
  );
  assert.strictEqual(stitchEqualV.width, 200);
  assert.strictEqual(stitchEqualV.height, 250);
  const aligned = P.calcAlignedStitchCrop(1000, 500, "horizontal", 200, 100, 50, 50);
  assert.strictEqual(aligned.outH, 200);
  assert.ok(aligned.outW > 0);
  assert.ok(Number.isInteger(aligned.cropX));
  assert.ok(Number.isInteger(aligned.cropY));
  assert.ok(Number.isInteger(aligned.cropW));
  assert.ok(Number.isInteger(aligned.cropH));
  assert.ok(aligned.cropX + aligned.cropW <= 1000);
  assert.ok(aligned.cropY + aligned.cropH <= 500);
  const alignedV = P.calcAlignedStitchCrop(1000, 500, "vertical", 200, 200, 0, 50);
  assert.strictEqual(alignedV.outW, 200);
  assert.ok(alignedV.cropX + alignedV.cropW <= 1000);
  assert.ok(alignedV.cropY + alignedV.cropH <= 500);
  // Zoomed pan extremes must stay inside source
  for (const pan of [0, 50, 100]) {
    for (const cross of [0, 50, 100]) {
      const z = P.calcAlignedStitchCrop(1920, 1080, "horizontal", 720, 350, pan, cross);
      assert.ok(z.cropX >= 0 && z.cropY >= 0);
      assert.ok(z.cropX + z.cropW <= 1920);
      assert.ok(z.cropY + z.cropH <= 1080);
      assert.strictEqual(z.outH, 720);
    }
  }
  // Free stitch crop: arbitrary aspect, not locked to source
  const free = P.calcFreeStitchCrop(1000, 500, "horizontal", 200, { x: 10, y: 20, w: 40, h: 30 });
  assert.strictEqual(free.outH, 200);
  assert.ok(Math.abs(free.outW / free.outH - free.cropW / free.cropH) < 0.02);
  assert.ok(free.cropW / free.cropH !== 1000 / 500);
  assert.ok(free.cropX + free.cropW <= 1000);
  assert.ok(free.cropY + free.cropH <= 500);
  const freeV = P.calcFreeStitchCrop(800, 600, "vertical", 300, { x: 0, y: 0, w: 50, h: 100 });
  assert.strictEqual(freeV.outW, 300);
  assert.ok(freeV.cropW < freeV.cropH || freeV.outH > freeV.outW);
  assert.ok(freeV.cropX + freeV.cropW <= 800);
  assert.ok(freeV.cropY + freeV.cropH <= 600);
  assert.strictEqual(P.suggestStitchEdge([{ width: 100, height: 40 }, { width: 80, height: 60 }], "horizontal"), 40);
  assert.strictEqual(P.suggestStitchEdge([{ width: 100, height: 40 }, { width: 80, height: 60 }], "vertical"), 80);
  assert.strictEqual(P.extFromFormat("jpeg"), "jpg");
  assert.strictEqual(P.mimeFromFormat("webp"), "image/webp");
  assert.ok(P.APP_ICON_SIZES.android.includes(512));
});

console.log("\nAll pure tests passed.");


