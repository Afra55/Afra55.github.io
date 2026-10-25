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

t("手机两行：上行阶段全文，下行已用时", () => {
  const fn = loadFormatMobileTwoLine();
  assert.strictEqual(fn("②试档 · 15帧/秒", "12s"), "②试档 · 15帧/秒\n已用 12s");
  assert.strictEqual(fn("①预裁 · 7.2s", "3.4s"), "①预裁 · 7.2s\n已用 3.4s");
});

t("手机两行：超 60s 提示可取消；剥离旧 stall 尾巴", () => {
  const fn = loadFormatMobileTwoLine();
  assert.strictEqual(fn("②试档", "83s"), "②试档\n已用 83s · 可取消");
  assert.strictEqual(
    fn("②试档 · 本条已90s（正常试档中，可取消）", "90s"),
    "②试档\n已用 90s · 可取消"
  );
});

t("手机两行：无已用时仍有下行", () => {
  const fn = loadFormatMobileTwoLine();
  assert.strictEqual(fn("③出帧 · 40%", ""), "③出帧 · 40%\n进行中");
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

console.log(`ok ${n}`);
