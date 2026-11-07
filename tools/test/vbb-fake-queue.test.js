"use strict";

/** 黑盒无前置任务时不得显示「排队」；预热阶段应是准备中 / running */
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const vsplit = fs.readFileSync(
  path.join(__dirname, "..", "extra-panels", "v2g-suite-src", "30-vsplit.js"),
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

function loadFormatPending() {
  const m = vsplit.match(/function formatPendingWaitText\(job\) \{[\s\S]*?\n      \}/);
  assert.ok(m, "missing formatPendingWaitText");
  const clock = vsplit.match(/function formatWaitClockSec\(ms\) \{[\s\S]*?\n      \}/);
  assert.ok(clock);
  const box = { vbbClips: [], Date };
  vm.runInNewContext(
    `${clock[0]}\n${m[0]}\nthis.formatPendingWaitText = formatPendingWaitText;`,
    box
  );
  return box;
}

t("单条 pending 显示准备中，不是排队", () => {
  const box = loadFormatPending();
  const job = { jobStatus: "pending", jobQueuedAt: Date.now() - 5000, jobText: "等待中…" };
  box.vbbClips = [job];
  const text = box.formatPendingWaitText(job);
  assert.ok(/准备中/.test(text), text);
  assert.ok(!/排队/.test(text), text);
});

t("前面有 running 时才显示排队", () => {
  const box = loadFormatPending();
  const a = { jobStatus: "running", jobStartedAt: Date.now(), jobText: "①准备编码器…" };
  const b = { jobStatus: "pending", jobQueuedAt: Date.now() - 2000, jobText: "等待中…" };
  box.vbbClips = [a, b];
  const text = box.formatPendingWaitText(b);
  assert.ok(/排队/.test(text), text);
});

t("一键黑盒预热前就把队首标成 running 准备编码器", () => {
  assert.ok(vbb.includes("预热前就标 running") || vbb.includes("队首立刻标准备中"));
  assert.ok(vbb.includes('text: "①准备编码器…"'));
  const start = vbb.indexOf("async function runVbbSingleBlackbox");
  assert.ok(start >= 0);
  const single = vbb.slice(start, start + 4500);
  const renderAt = single.indexOf("renderVbbResults()");
  const prepAt = single.indexOf('text: "①准备编码器…"');
  const warmAt = single.indexOf("prewarmFfmpegEngine");
  assert.ok(renderAt >= 0 && prepAt > renderAt && warmAt > prepAt, "须 render → 准备编码器 → prewarm");
  const batch = vbb.slice(
    vbb.indexOf("async function runVbbBatchBlackbox"),
    vbb.indexOf("async function runVbbSingleBlackbox")
  );
  assert.ok(batch.includes("队首立刻标准备中"));
  assert.ok(batch.indexOf('text: "①准备编码器…"') < batch.indexOf("prewarmFfmpegEngine"));
});

console.log(`vbb-fake-queue.test.js: ${n} passed`);
