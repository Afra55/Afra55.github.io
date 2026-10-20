const assert = require("assert");
const P = require("../lib/apidebug-pure.js");

function test(name, fn) {
  try {
    fn();
    console.log("ok -", name);
  } catch (err) {
    console.error("fail -", name);
    throw err;
  }
}

test("emptyRequest defaults", () => {
  const r = P.emptyRequest();
  assert.strictEqual(r.method, "GET");
  assert.strictEqual(r.bodyType, "none");
  assert.ok(r.id);
  assert.deepStrictEqual(r.headers, []);
});

test("applyQueryToUrl + buildFetchInit", () => {
  const req = P.emptyRequest({
    method: "POST",
    url: "https://example.com/api?old=1",
    query: [
      { enabled: true, key: "q", value: "hi world" },
      { enabled: false, key: "skip", value: "1" },
    ],
    headers: [{ enabled: true, key: "X-Test", value: "1" }],
    cookies: [{ enabled: true, key: "sid", value: "abc" }],
    bodyType: "json",
    bodyText: '{"a":1}',
  });
  const { url, init } = P.buildFetchInit(req);
  assert.ok(url.includes("q=hi"));
  assert.ok(!url.includes("old="));
  assert.strictEqual(init.method, "POST");
  assert.strictEqual(init.headers["X-Test"], "1");
  assert.strictEqual(init.headers.Cookie, "sid=abc");
  assert.strictEqual(init.headers["Content-Type"], "application/json");
  assert.strictEqual(init.body, '{"a":1}');
});

test("requestToCurl / curlToRequest roundtrip", () => {
  const req = P.emptyRequest({
    name: "demo",
    method: "POST",
    url: "https://httpbin.org/post",
    query: [{ enabled: true, key: "x", value: "1" }],
    headers: [{ enabled: true, key: "Accept", value: "application/json" }],
    cookies: [{ enabled: true, key: "a", value: "b" }],
    bodyType: "json",
    bodyText: '{"ok":true}',
  });
  const curl = P.requestToCurl(req);
  assert.ok(curl.startsWith("curl "));
  assert.ok(curl.includes("-X POST"));
  assert.ok(curl.includes("-H") || curl.includes("-b"));
  const back = P.curlToRequest(curl, { name: "from-curl" });
  assert.strictEqual(back.method, "POST");
  assert.ok(String(back.url).includes("httpbin.org/post"));
  assert.ok(back.query.some((q) => q.key === "x" && q.value === "1"));
  assert.ok(back.cookies.some((c) => c.key === "a"));
  assert.strictEqual(back.bodyText, '{"ok":true}');
});

test("curl parse common flags", () => {
  const text = `curl -X GET 'https://api.example.com/v1' -H 'Authorization: Bearer t' -b 's=1; t=2'`;
  const r = P.curlToRequest(text);
  assert.strictEqual(r.method, "GET");
  assert.strictEqual(r.url, "https://api.example.com/v1");
  assert.ok(r.headers.some((h) => h.key === "Authorization" && h.value === "Bearer t"));
  assert.strictEqual(r.cookies.length, 2);
});

test("parseKvBulk headers colon lines", () => {
  const rows = P.parseKvBulk(
    "Content-Type: application/json\nAuthorization: Bearer abc\n# skip\nX-Id: 1",
    { style: "colon" }
  );
  assert.strictEqual(rows.length, 3);
  assert.strictEqual(rows[0].key, "Content-Type");
  assert.strictEqual(rows[0].value, "application/json");
  assert.strictEqual(rows[1].key, "Authorization");
  assert.strictEqual(rows[1].value, "Bearer abc");
});

test("parseKvBulk curl -H lines", () => {
  const rows = P.parseKvBulk(`-H 'Accept: application/json'\n-H "X-Token: t1"`, { style: "colon" });
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].key, "Accept");
  assert.strictEqual(rows[1].value, "t1");
});

test("parseKvBulk query equal + cookie semicolon", () => {
  const q = P.parseKvBulk("page=1\nlimit=20", { style: "auto" });
  assert.strictEqual(q.length, 2);
  assert.strictEqual(q[0].key, "page");
  const c = P.parseKvBulk("sid=abc; token=xyz", { style: "cookie" });
  assert.strictEqual(c.length, 2);
  assert.strictEqual(c[1].key, "token");
});

test("packExport / unpackImport", () => {
  const item = P.emptyRequest({ name: "one", url: "https://x.test/" });
  const pack = P.packExport([item], { all: false });
  assert.strictEqual(pack.kind, P.EXPORT_KIND);
  const items = P.unpackImport(JSON.stringify(pack));
  assert.strictEqual(items.length, 1);
  assert.strictEqual(items[0].name, "one");
  assert.throws(() => P.unpackImport({ kind: "other", items: [] }), /不是本工具/);
});

console.log("apidebug-pure: all ok");
