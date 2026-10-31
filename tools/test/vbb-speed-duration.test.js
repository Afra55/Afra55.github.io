"use strict";

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
const gifskiCore = fs.readFileSync(
  path.join(__dirname, "..", "ffmpeg-bridge", "gifski-core.js"),
  "utf8"
);

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

t("倍速预切段：禁止 copy，须精确重编码", () => {
  assert.ok(shared.includes("buildVbbSegmentCutArgs"));
  assert.ok(shared.includes("accurate: speed > 1.01"));
  const fn = loadFn(shared, "buildVbbSegmentCutArgs");
  const copyArgs = fn("in.mp4", "seg.mp4", 0, 60, { accurate: false });
  assert.ok(copyArgs.includes("copy"), "无倍速可用 copy");
  const accArgs = fn("in.mp4", "seg.mp4", 0, 60, { accurate: true });
  assert.ok(accArgs.includes("libx264"), "倍速必须精确切");
  assert.ok(!accArgs.includes("copy"), "倍速禁止 copy");
});

t("目标时长均分 delay：少帧仍凑满目标秒数", () => {
  const fn = loadFn(shared, "buildGifDurationsForTargetSpanMs");
  const d = fn(300, 30);
  assert.strictEqual(d.length, 300);
  const sumMs = [...d].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sumMs / 1000 - 30) < 0.05, `sum=${sumMs}ms`);
});

t("成片时长：接近目标用 span，少帧太多则按帧数如实报", () => {
  const fn = loadFn(vbb, "vbbEncodedGifDurationSec");
  assert.ok(
    Math.abs(fn({ span: 30, frameCount: 450, fps: 15, playbackFps: 14.3 }) - 30) < 0.01
  );
  const short = fn({ span: 30, frameCount: 300, fps: 15, playbackFps: 15 });
  assert.ok(short < 22 && short > 18, `short=${short}`);
});

t("原生桥 -t 用片源 span，禁止再 ×speed", () => {
  assert.ok(gifskiCore.includes("禁止再 ×speed") || gifskiCore.includes("勿再 ×speed") || gifskiCore.includes("禁止再"));
  assert.ok(!/opts\.span\s*\*\s*opts\.speed/.test(gifskiCore));
  const m = gifskiCore.match(/if \(opts\.span > 0\.05\) \{[\s\S]*?args\.push\("-t", String\(([^)]+)\)\)/);
  assert.ok(m, "missing -t push");
  assert.strictEqual(m[1].trim(), "opts.span");
});

t("桥版本已递增（gifski-core 变更）", () => {
  const adb = fs.readFileSync(path.join(__dirname, "..", "adb-bridge", "server.js"), "utf8");
  const ver = adb.match(/const BRIDGE_VERSION = "([^"]+)"/);
  assert.ok(ver, "missing BRIDGE_VERSION");
  const parts = ver[1].split(".").map(Number);
  assert.ok(parts[2] >= 87, `BRIDGE_VERSION=${ver[1]}`);
});

t("resolveBlackboxSpeed：30s 目标；超上限标记 capped", () => {
  assert.ok(shared.includes("V2G_BLACKBOX_MAX_SPEED = 48"));
  assert.ok(shared.includes("function resolveBlackboxSpeed"));
  const m = shared.match(/function resolveBlackboxSpeed\([\s\S]*?\n      \}/);
  assert.ok(m, "missing resolveBlackboxSpeed");
  const box = {};
  vm.runInNewContext(
    `const V2G_BLACKBOX_MAX_SPEED = 48;\n${m[0]}\nthis.fn = resolveBlackboxSpeed;`,
    box
  );
  const resolve = box.fn;
  const a = resolve(60, 30);
  assert.ok(Math.abs(a.speed - 2) < 0.01 && !a.capped && Math.abs(a.effSpan - 30) < 0.01);
  const b = resolve(25, 30);
  assert.strictEqual(b.speed, 1);
  assert.ok(!b.capped);
  const c = resolve(60 * 60, 30); // 1h → 需 ×120，封顶 48
  assert.ok(c.capped);
  assert.ok(Math.abs(c.speed - 48) < 0.01);
  assert.ok(c.effSpan > 30);
});

t("静止合并 delay 可比例拉到目标秒数", () => {
  assert.ok(shared.includes("scaleGifDurationsToTargetMs"));
  const scale = loadFn(shared, "scaleGifDurationsToTargetMs");
  const src = Uint32Array.from([70, 70, 140, 70]); // 0.35s
  const out = scale(src, 1.0);
  const sum = [...out].reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(sum - 1000) <= 20, `sum=${sum}`);
});

t("结果卡会提示加速达上限", () => {
  assert.ok(vbb.includes("加速达上限"));
});

t("无倍速不强制对准目标秒数（避免均匀 delay 被拆成 60/70 顿挫）", () => {
  assert.ok(shared.includes("forceAlignSpan = speed > 1.01 && chunkTargetRequested > 0.05"));
  assert.ok(shared.includes("仍用均匀，保流畅"));
  assert.ok(shared.includes("buildUniformGifDurationsMs(encodedFrames, fps)"));
});

t("压缩时长按请求份额对准目标（少帧不按实际比例缩短目标）", () => {
  assert.ok(shared.includes("chunkTargetRequested"));
  assert.ok(shared.includes("speed > 1.01 ? chunkTargetRequested : chunkTargetActual"));
  assert.ok(shared.includes("speed > 1.01 || frameRatio >= 0.9"));
});

t("倍速预切仍只在大文件/非片头触发 wantSeg（避免小文件多一趟重编码）", () => {
  assert.ok(shared.includes("file.size >= FFMPEG_SEG_FILE_BYTES || Number(opts.startSec) > 0.05"));
  assert.ok(!/file\.size >= FFMPEG_SEG_FILE_BYTES \|\|[\s\S]{0,80}speed > 1\.01/.test(shared));
  assert.ok(shared.includes("accurate: speed > 1.01 || Boolean(opts.forceAccurateCut)"));
});

t("无倍速大文件预切仍可用 copy（行为与改前一致）", () => {
  // accurate 仅 speed>1.01；startSec≈0 且无倍速 → copy
  const fn = loadFn(shared, "buildVbbSegmentCutArgs");
  const args = fn("in.mp4", "seg.mp4", 0, 90, { accurate: false });
  assert.ok(args.includes("copy"));
  assert.ok(!args.includes("libx264"));
});

t("均匀 fps delay 全帧等长（可走 canPassFps）", () => {
  const fn = loadFn(shared, "buildUniformGifDurationsMs");
  const d = fn(450, 15);
  assert.ok(d.every((x) => x === d[0]), "须全等 delay");
  assert.strictEqual(d[0], 70);
});

console.log(`ok ${n}`);
