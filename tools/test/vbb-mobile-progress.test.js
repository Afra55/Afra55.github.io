"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const vsplit = fs.readFileSync(
  path.join(__dirname, "..", "extra-panels", "v2g-suite-src", "30-vsplit.js"),
  "utf8"
);
const vbbCss = fs.readFileSync(path.join(__dirname, "..", "styles", "panels", "vbb.css"), "utf8");
const vsplitCss = fs.readFileSync(
  path.join(__dirname, "..", "styles", "panels", "vsplit.css"),
  "utf8"
);
const vbb = fs.readFileSync(
  path.join(__dirname, "..", "extra-panels", "v2g-suite-src", "40-vbb.js"),
  "utf8"
);

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

function loadFormatMobileTwoLine() {
  const m = vsplit.match(/function formatMobileTwoLineProgress\([\s\S]*?\n      \}/);
  assert.ok(m, "missing formatMobileTwoLineProgress");
  const box = {};
  vm.runInNewContext(`${m[0]}\nthis.fn = formatMobileTwoLineProgress;`, box);
  return box.fn;
}

function loadVbbStageText() {
  const m = vbb.match(/function vbbStageText\([\s\S]*?\n      \}/);
  assert.ok(m, "missing vbbStageText");
  const box = {};
  vm.runInNewContext(`${m[0]}\nthis.fn = vbbStageText;`, box);
  return box.fn;
}

t("手机两行：阶段+帧率+画质 / 宽高+时长+已用", () => {
  const fn = loadFormatMobileTwoLine();
  assert.strictEqual(
    fn("②试档 · 15帧/秒 · 宽420 · 画质3", "12s", { span: 7.2, srcW: 1080, srcH: 1920 }),
    "②试档 · 15帧/秒 · 画质3\n420×747 · 时长7.2s · 已用 12s"
  );
});

t("手机两行：无宽高时仍有时长；超60s可取消", () => {
  const fn = loadFormatMobileTwoLine();
  assert.strictEqual(fn("③出帧 · 40%", "83s", { span: 10 }), "③出帧 · 40%\n时长10s · 已用 83s · 可取消");
  assert.strictEqual(
    fn("②试档 · 本条已90s（正常试档中，可取消）", "90s", { span: 5 }),
    "②试档\n时长5s · 已用 90s · 可取消"
  );
});

t("手机两行：无已用时仍有下行", () => {
  const fn = loadFormatMobileTwoLine();
  assert.strictEqual(fn("①准备中…", "", {}), "①准备中…\n进行中");
});

t("阶段映射：FPS·宽·q 保留帧率宽画质", () => {
  const stage = loadVbbStageText();
  assert.strictEqual(stage("15FPS·宽420·q3"), "②试档 · 15帧/秒 · 宽420 · 画质3");
  assert.strictEqual(stage("尝试 12FPS·宽380"), "②试档 · 12帧/秒 · 宽380");
  assert.strictEqual(stage("黑盒编码 · 15FPS"), "②试档 · 15帧/秒");
});

t("手机 CSS：进度 hint 两行 clamp", () => {
  assert.ok(vbbCss.includes("-webkit-line-clamp: 2"));
  assert.ok(vbbCss.includes("white-space: pre-line"));
  assert.ok(vsplitCss.includes("-webkit-line-clamp: 2"));
  assert.ok(vsplitCss.includes("white-space: pre-line"));
});

t("stall 只刷新阶段，不再塞「本条已Xs」长串", () => {
  assert.ok(!vbb.includes("本条已${wall}s（正常试档中，可取消）"));
  assert.ok(vbb.includes("已用时由进度条两行展示"));
});

t("批量卡片壳带 srcW/srcH 供宽高估算", () => {
  assert.ok(vbb.includes("srcW: Number(job.item?.srcW)"));
  assert.ok(vbb.includes("srcH: Number(job.item?.srcH)"));
});

console.log(`ok ${n}`);
