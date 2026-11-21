"use strict";

/**
 * 撞档库备份/导入合并：同键保留较新 at；IndexedDB 为主，内存同步读写。
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
    V2G_BLACKBOX_KEEP_Q_MAX_SPAN_SEC: 10,
    V2G_BLACKBOX_FPS_LIST: [20, 15, 12],
    blackboxKeepQualityUntilFloor(span, qualityFirst) {
      if (qualityFirst) return true;
      return (Number(span) || 0) <= 10.01;
    },
    blackboxFpsCandidates(srcFps) {
      const src = Number(srcFps) || 0;
      if (src >= 24.5 && src <= 25.8) return [25, 15, 12.5];
      if (src >= 29.2 && src <= 30.8) return [30, 15, 12];
      return [20, 15, 12];
    },
    vbbLog() {},
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
    `${shared.slice(start, end)}\nthis.api = {\n  exportMap: exportVbbFeatureSchemesMap,\n  merge: mergeVbbFeatureSchemes,\n  load: loadVbbFeatureSchemes,\n  persist: persistVbbFeatureSchemes,\n  key: VBB_FEATURE_SCHEME_KEY,\n  quotaDrop: VBB_FEATURE_SCHEME_QUOTA_DROP,\n  ver: VBB_FEATURE_SCHEME_VER,\n  canon: vbbCanonicalSchemeKey,\n  schemeKey: vbbSpanSchemeKey,\n  fits: vbbSeedFitsMeta,\n  adjust: adjustVbbSeedForQuality,\n  saveSpan: saveVbbSpanScheme,\n  loadSpan: loadVbbSpanScheme,\n};`,
    box
  );
  return { api: box.api, store, box };
}

function sampleEntry(over = {}) {
  return {
    ver: 3,
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

t("源码含导出/合并撞档与备份 payload v2 + IndexedDB", () => {
  assert.ok(shared.includes("function exportVbbFeatureSchemesMap"));
  assert.ok(shared.includes("function mergeVbbFeatureSchemes"));
  assert.ok(shared.includes("function persistVbbFeatureSchemes"));
  assert.ok(shared.includes("devtools-vbb-scheme"));
  assert.ok(shared.includes("vbbEnsureSchemeReady"));
  assert.ok(shared.includes("vbbSchemeIdbLoaded"));
  assert.ok(shared.includes("refuse clear"));
  assert.ok(shared.includes("VBB_FEATURE_SCHEME_VER = 3"));
  assert.ok(shared.includes("adjustVbbSeedForQuality"));
  assert.ok(vbb.includes("buildVbbBackupPayload"));
  assert.ok(vbb.includes("downloadVbbSchemeDbJson"));
  assert.ok(vbb.includes("importVbbSchemeDbFromFile"));
  assert.ok(vbb.includes("schemes"));
  assert.ok(vbb.includes('v: 2'));
  assert.ok(vbb.includes("mergeVbbFeatureSchemesAndFlush") || vbb.includes("mergeVbbFeatureSchemes(data.schemes)"));
  assert.ok(panel.includes("撞档"));
  assert.ok(panel.includes("导出撞档库"));
  assert.ok(panel.includes("导入撞档库"));
  assert.ok(panel.includes("合并"));
  assert.ok(suite.includes("mergeVbbFeatureSchemes"));
  assert.ok(suite.includes("devtools-vbb-scheme"));
  assert.ok(suite.includes("downloadVbbSchemeDbJson"));
});

t("合并：新增键写入，本机更新的同键保留；旧 qf 键折成 v3", () => {
  const { api } = loadSchemeApi();
  const k1 = "3.0#1280x720|30";
  const k2 = "5.0#1280x720|30";
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
    "7.0#1280x720|30": sampleEntry({ at: 300, fps: 15 }),
    "7.0@x2.00#1280x720|30|qf": sampleEntry({ ver: 2, at: 400, fps: 18, qualityFirst: true }),
  });
  assert.equal(r.added, 1);
  assert.equal(r.updated, 2); // k2 + folded 7.0
  assert.ok(r.skipped >= 1);
  map = api.load();
  assert.equal(map[k1].fps, 10);
  assert.equal(map[k2].fps, 8);
  assert.equal(map["7.0#1280x720|30"].fps, 18);
  assert.equal(api.canon("12.0@x2.00#880x600|25|15-40|bb"), "12.0#880x600|25");
  assert.equal(r.total, 3);
});

t("导出只含当前 ver，坏条目丢弃", () => {
  const { api, box } = loadSchemeApi();
  // 直接灌内存 store（无 IDB 时仍可读）
  api.persist({
    good: sampleEntry({ at: 1 }),
    old: sampleEntry({ ver: 0, at: 2 }),
    bad: { ver: 1, fps: 0, at: 3 },
  });
  // ver0 会进 store，但 export 过滤
  const out = api.exportMap();
  assert.ok(out.good);
  assert.equal(out.old, undefined);
  assert.equal(out.bad, undefined);
  void box;
});

t("合并可持续增长，无 64 条硬上限", () => {
  const { api } = loadSchemeApi();
  /** @type {Record<string, any>} */
  const incoming = {};
  const nItems = 80;
  for (let i = 0; i < nItems; i += 1) {
    incoming[`span${i}#1280x720|30`] = sampleEntry({ at: i + 1, fps: 10 + (i % 5) });
  }
  const r = api.merge(incoming);
  assert.equal(r.total, nItems);
  const map = api.load();
  assert.equal(Object.keys(map).length, nItems);
  assert.equal(map[`span0#1280x720|30`].at, 1);
  assert.equal(map[`span${nItems - 1}#1280x720|30`].at, nItems);
});

t("键不含加速/画质；撞档后可按画质调 fps", () => {
  const { api } = loadSchemeApi();
  const metaBb = {
    srcW: 1280,
    srcH: 720,
    srcFps: 30,
    fileBytes: 8 * 1024 * 1024,
    qualityFirst: false,
  };
  const metaQf = { ...metaBb, qualityFirst: true };
  assert.equal(api.schemeKey(18, 2, metaBb), "18.0#1280x720|30");
  assert.equal(api.schemeKey(18, 1, metaQf), "18.0#1280x720|30");
  assert.ok(api.fits({ fps: 15, ...metaBb }, metaQf));
  const seed = { fps: 15, qualityFirst: false, srcFps: 30, srcW: 1280, srcH: 720 };
  const adj = api.adjust(seed, metaQf, 18, 1);
  assert.equal(adj.fps, 12); // 长片开画质：15→更低一档
  const adjShort = api.adjust(seed, metaQf, 8, 1);
  assert.equal(adjShort.fps, 15); // ≤10s 不挪
});

t("成片 fps 写回后下次命中该档，不是失败的高帧", () => {
  const { api } = loadSchemeApi();
  const meta = {
    srcW: 1280,
    srcH: 720,
    srcFps: 24,
    fileBytes: 9 * 1024 * 1024,
    qualityFirst: true,
  };
  api.saveSpan(
    18,
    {
      fps: 15,
      maxW: 480,
      compressRounds: 1,
      usedFallback: false,
      speed: 1,
      ...meta,
    },
    "blackbox"
  );
  const hit = api.loadSpan(18, 1, meta);
  assert.equal(hit.fps, 15);
  assert.equal(hit.qualityFirst, true);
  assert.ok(hit.maxW >= 420);
});

t("无 IDB 时 persist 仍写进同步内存", () => {
  const { api } = loadSchemeApi();
  const map = {};
  const nItems = api.quotaDrop + 4;
  for (let i = 0; i < nItems; i += 1) {
    map[`k${i}#1280x720|30`] = sampleEntry({ at: i + 1 });
  }
  api.persist(map);
  assert.equal(Object.keys(api.load()).length, nItems);
  assert.ok(api.load()[`k0#1280x720|30`]);
  assert.ok(api.load()[`k${nItems - 1}#1280x720|30`]);
});

console.log(`vbb-scheme-backup.test.js: ${n} passed`);
