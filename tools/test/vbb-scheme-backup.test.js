"use strict";

/**
 * 撞档库备份/导入合并：同键保留较新 at，不整库覆盖。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const shared = fs.readFileSync(
  path.join(__dirname, "..", "extra-panels", "v2g-suite-src", "10-shared-encode.js"),
  "utf8"
);
const vbb = fs.readFileSync(
  path.join(__dirname, "..", "extra-panels", "v2g-suite-src", "40-vbb.js"),
  "utf8"
);
const panel = fs.readFileSync(path.join(__dirname, "..", "panels", "vbb.html"), "utf8");
const suite = fs.readFileSync(path.join(__dirname, "..", "extra-panels", "v2g-suite.js"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

function loadSchemeApi() {
  const start = shared.indexOf("const VBB_FEATURE_SCHEME_KEY");
  const end = shared.indexOf("/** 同轮/跨次统一查找：只按特征键");
  assert.ok(start > 0 && end > start, "scheme block bounds");
  const store = Object.create(null);
  const box = {
    V2G_BLACKBOX_BASE_W: 480,
    localStorage: {
      getItem(k) {
        return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
      },
      setItem(k, v) {
        store[k] = String(v);
      },
      removeItem(k) {
        delete store[k];
      },
    },
  };
  vm.runInNewContext(
    `${shared.slice(start, end)}\nthis.api = {\n  exportMap: exportVbbFeatureSchemesMap,\n  merge: mergeVbbFeatureSchemes,\n  load: loadVbbFeatureSchemes,\n  key: VBB_FEATURE_SCHEME_KEY,\n  max: VBB_FEATURE_SCHEME_MAX,\n  ver: VBB_FEATURE_SCHEME_VER,\n};`,
    box
  );
  return { api: box.api, store };
}

function sampleEntry(over = {}) {
  return {
    ver: 1,
    fps: 12,
    maxW: 480,
    compressRounds: 1,
    usedFallback: false,
    speed: 1,
    srcW: 1280,
    srcH: 720,
    effW: 1280,
    effH: 720,
    srcFps: 30,
    fileBytes: 8 * 1024 * 1024,
    qualityFirst: false,
    encode: "blackbox",
    at: 1000,
    ...over,
  };
}

t("源码含导出/合并撞档与备份 payload v2", () => {
  assert.ok(shared.includes("function exportVbbFeatureSchemesMap"));
  assert.ok(shared.includes("function mergeVbbFeatureSchemes"));
  assert.ok(shared.includes("function persistVbbFeatureSchemes"));
  assert.ok(vbb.includes("buildVbbBackupPayload"));
  assert.ok(vbb.includes("schemes"));
  assert.ok(vbb.includes('v: 2'));
  assert.ok(vbb.includes("mergeVbbFeatureSchemes(data.schemes)"));
  assert.ok(panel.includes("撞档"));
  assert.ok(panel.includes("合并"));
  assert.ok(suite.includes("mergeVbbFeatureSchemes"));
  assert.ok(suite.includes("exportVbbFeatureSchemesMap"));
});

t("合并：新增键写入，本机更新的同键保留", () => {
  const { api } = loadSchemeApi();
  const k1 = "3.0#1280x720|30|5-15|bb";
  const k2 = "5.0#1280x720|30|5-15|bb";
  api.merge({
    [k1]: sampleEntry({ at: 100, fps: 10 }),
    [k2]: sampleEntry({ at: 200, fps: 14 }),
  });
  let map = api.load();
  assert.equal(map[k1].fps, 10);
  assert.equal(map[k2].fps, 14);

  const r = api.merge({
    [k1]: sampleEntry({ at: 50, fps: 99 }), // 更旧 → 跳过
    [k2]: sampleEntry({ at: 500, fps: 8 }), // 更新 → 覆盖
    "7.0#1280x720|30|5-15|bb": sampleEntry({ at: 300, fps: 15 }),
  });
  assert.equal(r.added, 1);
  assert.equal(r.updated, 1);
  assert.ok(r.skipped >= 1);
  map = api.load();
  assert.equal(map[k1].fps, 10);
  assert.equal(map[k2].fps, 8);
  assert.equal(map["7.0#1280x720|30|5-15|bb"].fps, 15);
  assert.equal(r.total, 3);
});

t("导出只含当前 ver，坏条目丢弃", () => {
  const { api, store } = loadSchemeApi();
  store[api.key] = JSON.stringify({
    good: sampleEntry({ at: 1 }),
    old: sampleEntry({ ver: 0, at: 2 }),
    bad: { ver: 1, fps: 0, at: 3 },
  });
  const out = api.exportMap();
  assert.ok(out.good);
  assert.equal(out.old, undefined);
  assert.equal(out.bad, undefined);
});

t("合并后不超过 MAX，按 at LRU", () => {
  const { api } = loadSchemeApi();
  /** @type {Record<string, any>} */
  const incoming = {};
  for (let i = 0; i < api.max + 5; i += 1) {
    incoming[`span${i}#1280x720|30|5-15|bb`] = sampleEntry({ at: i + 1, fps: 10 + (i % 5) });
  }
  const r = api.merge(incoming);
  assert.equal(r.total, api.max);
  const map = api.load();
  assert.equal(Object.keys(map).length, api.max);
  assert.equal(map[`span${api.max + 4}#1280x720|30|5-15|bb`].at, api.max + 5);
  assert.equal(map[`span0#1280x720|30|5-15|bb`], undefined);
});

console.log(`vbb-scheme-backup.test.js: ${n} passed`);
