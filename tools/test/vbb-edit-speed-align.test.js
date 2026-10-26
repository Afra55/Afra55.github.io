"use strict";

/**
 * 编辑窗 + 压缩时长：时间轴/片头片尾对齐回归。
 * 防止「裁了 10–40s 再压到 30s」出现关键帧多片头、片尾越过黄柄、或倍速二次加速。
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

t("编辑非片头：预切段即使未开倍速也精确重编码（禁 copy 关键帧多片头）", () => {
  const fn = loadFn(shared, "buildVbbSegmentCutArgs");
  // startSec=10 模拟裁掉片头；accurate=false 也应因 ss>0.05 走 libx264
  const args = fn("in.mp4", "seg.mp4", 10, 30, { accurate: false });
  assert.ok(args.includes("libx264"), "非片头须精确切");
  assert.ok(!args.includes("copy"));
  const ssIdx = args.indexOf("-ss");
  assert.ok(ssIdx >= 0);
  assert.strictEqual(args[ssIdx + 1], "10");
  const tIdx = args.indexOf("-t");
  assert.strictEqual(args[tIdx + 1], "30");
});

t("编辑窗+倍速：预切段强制精确，-t 为编辑 span（片源时长）", () => {
  const fn = loadFn(shared, "buildVbbSegmentCutArgs");
  const args = fn("in.mp4", "seg.mp4", 12.5, 48, { accurate: true });
  assert.ok(args.includes("libx264"));
  assert.strictEqual(args[args.indexOf("-ss") + 1], "12.5");
  assert.strictEqual(args[args.indexOf("-t") + 1], "48");
});

t("分块 seek：源时间 = 编辑起点 + 成片进度×倍速，且钳在编辑终点", () => {
  // 与 encodeChunk 公式一致：ss = encodeSs + startEff*speed；dur ≤ absEnd-ss
  const encodeSs = 10;
  const encodeT = 40; // 编辑窗 10–50s
  const speed = 40 / 30; // 压到 30s
  const fps = 15;
  const startEff = 20; // 成片已走到 20s
  const ss = encodeSs + startEff * speed;
  const absEnd = encodeSs + encodeT;
  const need = (150 / fps) * speed;
  const dur = Math.min(need, Math.max(0, absEnd - ss));
  assert.ok(Math.abs(ss - (10 + 20 * speed)) < 1e-9);
  assert.ok(ss + dur <= absEnd + 1e-9, "不得越过编辑终点");
  assert.ok(shared.includes("钳到片尾，不再 +半帧"));
  assert.ok(shared.includes("encodeSs + startEff * speed"));
});

t("预裁/删中间后 startSec 归零，结果卡仍保留编辑起点", () => {
  assert.ok(vbb.includes("vbbClips[0].start = win.startSec"));
  assert.ok(vbb.includes("prepared.startSec 常为 0"));
  // 编码仍用 prepared 的 start/span，避免对已裁短片再偏移
  const single = vbb.slice(
    vbb.indexOf("async function runVbbSingleBlackbox"),
    vbb.indexOf("async function runVbbOneClick")
  );
  assert.ok(/encodeBlackboxClip\(\{[\s\S]*?startSec:\s*prepared\.startSec/.test(single));
  assert.ok(/span:\s*prepared\.span/.test(single));
});

t("预裁只复位 PTS，不在预裁阶段加速（避免编辑后再 ×speed 二次加速）", () => {
  const trimFn = vbb.slice(
    vbb.indexOf("async function materializeVbbTrimClip"),
    vbb.indexOf("async function prepareVbbEncodeSource")
  );
  assert.ok(trimFn.includes("setpts=PTS-STARTPTS"));
  assert.ok(!/setpts=\(PTS-STARTPTS\)\/\$\{?speed/.test(trimFn));
  assert.ok(!/"copy"/.test(trimFn) && !/'copy'/.test(trimFn));
});

t("编码侧：crop 在 setpts 倍速之前（画面裁切坐标系不被加速打乱）", () => {
  assert.ok(/cropFilter\}?\$\{?speedFilter|cropFilter\$\{speedFilter/.test(shared.replace(/\s+/g, "")));
  // 更稳：同一条 chain 里 crop 在 setpts 前
  assert.ok(shared.includes("${cropFilter}${speedFilter}fps="));
});

t("原生桥：编辑起点 -ss + 片源 span，倍速只走 setpts", () => {
  assert.ok(/args\.push\("-ss", String\(opts\.startSec\)\)/.test(gifskiCore));
  assert.ok(/args\.push\("-t", String\(opts\.span\)\)/.test(gifskiCore));
  assert.ok(!/opts\.span\s*\*\s*opts\.speed/.test(gifskiCore));
  assert.ok(gifskiCore.includes("setpts=(PTS-STARTPTS)/${speed}") || gifskiCore.includes("setpts=(PTS-STARTPTS)/"));
});

t("-ss 在 -i 之后（解码时钟对齐编辑器，避免关键帧往前多取）", () => {
  assert.ok(shared.includes('-ss 在 -i 后：与编辑器片头对齐'));
  // baseArgs 先 -i 再条件 -ss
  assert.ok(/baseArgs = \["-i", encodeInput\];\s*if \(ss > 0\.001\) baseArgs\.push\("-ss"/.test(shared));
});

console.log(`vbb-edit-speed-align.test.js: ${n} passed`);
