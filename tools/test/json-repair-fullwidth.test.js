"use strict";

/**
 * JSON 修复：全角冒号等结构标点应在字符串外被规范化。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const app = fs.readFileSync(path.join(__dirname, "..", "app.js"), "utf8");
const vendor = fs.readFileSync(path.join(__dirname, "..", "vendor/jsonrepair.min.js"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

function loadHelpers() {
  const start = app.indexOf("/** 去 BOM / 零宽字符 */");
  const end = app.indexOf("async function runJsonRepair");
  assert.ok(start > 0 && end > start, "helper block bounds");
  const box = {};
  vm.runInNewContext(vendor, {
    globalThis: box,
    self: box,
    window: box,
    module: undefined,
    exports: undefined,
    define: undefined,
  });
  const scope = {
    JSONRepair: box.JSONRepair,
  };
  vm.runInNewContext(
    `${app.slice(start, end)}\nthis.api = {\n  clean: cleanJsonInvisible,\n  norm: normalizeLooseJsonPunct,\n  describe: describeJsonRepairError,\n  repair: repairJsonText,\n};`,
    scope
  );
  return { api: scope.api, jsonrepair: box.JSONRepair.jsonrepair };
}

t("源码含全角规范化与二次修复", () => {
  assert.ok(app.includes("normalizeLooseJsonPunct"));
  assert.ok(app.includes("repairJsonText"));
  assert.ok(app.includes("describeJsonRepairError"));
  assert.ok(app.includes("已转换全角标点"));
});

t("字符串外全角冒号/逗号改半角，字符串内保留", () => {
  const { api } = loadHelpers();
  assert.equal(api.norm('{"a"：1，"b"：2}'), '{"a":1,"b":2}');
  assert.equal(api.norm('{"说明：内容":"仍：保留"}'), '{"说明：内容":"仍：保留"}');
  assert.equal(api.norm("{a=1}"), "{a:1}");
});

t("修复库对全角冒号：规范化后可 parse", () => {
  const { api, jsonrepair } = loadHelpers();
  const raw = '{"items":[1,2],"meta"：{"ok":true}}';
  assert.throws(() => jsonrepair(raw));
  const { text, usedNormalize } = api.repair(jsonrepair, raw);
  assert.equal(usedNormalize, true);
  assert.deepEqual(JSON.parse(text), { items: [1, 2], meta: { ok: true } });
});

t("报错描述含行列与附近片段", () => {
  const { api } = loadHelpers();
  const src = '{\n  "a"：1\n}';
  const err = Object.assign(new Error("Colon expected at position 7"), { position: 7 });
  const msg = api.describe(err, src);
  assert.ok(/第 2 行/.test(msg));
  assert.ok(/全角冒号/.test(msg));
  assert.ok(/附近/.test(msg));
});

console.log(`json-repair-fullwidth.test.js: ${n} passed`);
