"use strict";

/**
 * 三联：片头片尾裁切 + 中间多段删除 + 压缩时长，同时作用于同一视频。
 * 防回归：拼接后倍速按 keep 总和算，禁止回退原片整段导致成片偏短。
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
const vtrim = fs.readFileSync(path.join(__dirname, "..", "lib", "vtrim-editor.js"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

function loadFn(src, name) {
  const m = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n      \\}`));
  assert.ok(m, `missing ${name}`);
  const box = {};
  vm.runInNewContext(`${m[0]}\nthis.fn = ${name};`, box);
  return box.fn;
}

function loadVtrimKeepFns() {
  const fromEdit = vtrim.match(/function keepRangesFromEdit\(edit, duration\) \{[\s\S]*?\n  \}/);
  const forEnc = vtrim.match(/function keepRangesForEncode\(edit, duration\) \{[\s\S]*?\n  \}/);
  const norm = vtrim.match(/function normalizeCutouts\([\s\S]*?\n  \}/);
  assert.ok(fromEdit && forEnc && norm, "vtrim keep helpers");
  const box = {};
  vm.runInNewContext(
    `
    const MIN_SPAN = 0.5;
    const MIN_CUTOUT = 0.2;
    const END_KEEP_SEC = 1 / 25;
    const START_KEEP_SEC = 1 / 50;
    const ENCODE_BOUND_PAD_SEC = 3 / 30;
    ${norm[0]}
    ${fromEdit[0]}
    ${forEnc[0]}
    this.keepRangesForEncode = keepRangesForEncode;
    this.keepRangesFromEdit = keepRangesFromEdit;
    `,
    box
  );
  return box;
}

t("源码：materialize 禁止 Number(out.duration)||原片 duration", () => {
  const block = vbb.slice(
    vbb.indexOf("async function materializeVbbKeepVideo"),
    vbb.indexOf("async function materializeVbbTrimClip")
  );
  assert.ok(block.includes("vbbMaterializedKeepDuration"));
  assert.ok(!/duration:\s*Number\(out\.duration\)\s*\|\|\s*duration/.test(block));
});

t("源码：prepare 多段 keep 后 span 走 keep 时长（再交给 speedLimitSec）", () => {
  const block = vbb.slice(
    vbb.indexOf("async function prepareVbbEncodeSource"),
    vbb.indexOf("async function resolveVbbEncodeCrop")
  );
  assert.ok(block.includes("vbbMaterializedKeepDuration"));
  assert.ok(block.includes("vbbKeepSpanSec"));
  assert.ok(block.includes("keeps.length > 1"));
});

t("vbbMaterializedKeepDuration：缺上报/回退整段 → 用 keep 总和", () => {
  const fn = loadFn(vbb, "vbbMaterializedKeepDuration");
  assert.ok(Math.abs(fn(64.7, 64.7, 100) - 64.7) < 0.01, "正常上报");
  assert.ok(Math.abs(fn(0, 64.7, 100) - 64.7) < 0.01, "缺 duration");
  assert.ok(Math.abs(fn(100, 64.7, 100) - 64.7) < 0.01, "误回退原片");
  assert.ok(Math.abs(fn(NaN, 50, 120) - 50) < 0.01);
});

t("三联时长：裁片头片尾+两段删中间后，压缩到 30s 按 keep 总和倍速", () => {
  const { keepRangesForEncode } = loadVtrimKeepFns();
  const keepSpanFn = loadFn(vbb, "vbbKeepSpanSec");
  const matDur = loadFn(vbb, "vbbMaterializedKeepDuration");
  const speedM = shared.match(/function resolveBlackboxSpeed\([\s\S]*?\n      \}/);
  assert.ok(speedM);
  const box = {};
  vm.runInNewContext(
    `const V2G_BLACKBOX_MAX_SPEED = 48;\n${speedM[0]}\nthis.fn = resolveBlackboxSpeed;`,
    box
  );
  const resolve = box.fn;

  const fullDur = 100;
  const edit = {
    trimStart: 5,
    trimEnd: 95,
    cutouts: [
      { start: 20, end: 30 },
      { start: 50, end: 60 },
    ],
  };
  const keeps = keepRangesForEncode(edit, fullDur);
  assert.ok(keeps.length >= 3, `keeps=${keeps.length}`);
  const keepSpan = keepSpanFn(keeps);
  assert.ok(keepSpan > 55 && keepSpan < 80, `keepSpan=${keepSpan}`);

  // 模拟 export 漏 duration / 误回原片
  const spanOk = matDur(keepSpan, keepSpan, fullDur);
  const spanBug = matDur(fullDur, keepSpan, fullDur);
  assert.ok(Math.abs(spanOk - keepSpan) < 0.01);
  assert.ok(Math.abs(spanBug - keepSpan) < 0.01, "误回原片须纠正");

  const plan = resolve(spanOk, 30);
  assert.ok(!plan.capped);
  assert.ok(Math.abs(plan.effSpan - 30) < 0.05, `eff=${plan.effSpan}`);
  assert.ok(Math.abs(plan.speed - keepSpan / 30) < 0.05);

  // 若未修：按 100s 算 ×3.33，65s 拼接片 → 成片 ~19s
  const bad = resolve(fullDur, 30);
  const wrongGif = keepSpan / bad.speed;
  assert.ok(wrongGif < 25, "对照：用原片算倍速会明显短于 30s");
});

t("整段/批量编码入口：prepare 后再带 speedLimitSec（三联同管线）", () => {
  assert.ok(/prepareVbbEncodeSource\([\s\S]*?speedLimitSec:\s*vbbSpeedLimitSec\(\)/.test(vbb));
  const single = vbb.slice(
    vbb.indexOf("async function runVbbSingleBlackbox"),
    vbb.indexOf("async function runVbbOneClick")
  );
  assert.ok(single.includes("prepareVbbEncodeSource"));
  assert.ok(single.includes("speedLimitSec: vbbSpeedLimitSec()"));
  assert.ok(/startSec:\s*prepared\.startSec/.test(single));
  assert.ok(/span:\s*prepared\.span/.test(single));
});

t("拼接批量：多段 keep 的 span 也走 vbbMaterializedKeepDuration", () => {
  assert.ok(vbb.includes("vbbMaterializedKeepDuration("));
  assert.ok(vbb.includes("vbbKeepSpanSec(win.keepRanges)"));
});

console.log(`vbb-trim-cutouts-speed.test.js: ${n} passed`);
