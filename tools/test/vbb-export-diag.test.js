"use strict";

/**
 * 诊断导出：按钮 + 组装函数 + 环形日志必须存在。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const prelude = fs.readFileSync(path.join(root, "extra-panels/v2g-suite-src/00-prelude.js"), "utf8");
const vbb = fs.readFileSync(path.join(root, "extra-panels/v2g-suite-src/40-vbb.js"), "utf8");
const panel = fs.readFileSync(path.join(root, "panels/vbb.html"), "utf8");
const suite = fs.readFileSync(path.join(root, "extra-panels/v2g-suite.js"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("面板有导出诊断按钮", () => {
  assert.ok(panel.includes('id="vbb-export-diag"'));
  assert.ok(panel.includes("导出诊断"));
});

t("prelude 环形日志始终写入", () => {
  assert.ok(prelude.includes("vbbLogRing"));
  assert.ok(prelude.includes("function getVbbLogRing"));
  assert.ok(prelude.includes("function pushVbbLogLine"));
  assert.ok(prelude.includes("VBB_LOG_RING_MAX"));
});

t("vbb 组装/下载诊断", () => {
  assert.ok(vbb.includes("function buildVbbDiagPayload"));
  assert.ok(vbb.includes("function downloadVbbDiagJson"));
  assert.ok(vbb.includes('kind: "vbb-diag"'));
  assert.ok(vbb.includes("exportDiag"));
  assert.ok(vbb.includes('vbb-export-diag'));
});

t("suite 已含诊断导出", () => {
  assert.ok(suite.includes("buildVbbDiagPayload"));
  assert.ok(suite.includes("vbb-export-diag") || suite.includes("downloadVbbDiagJson"));
});

console.log(`vbb-export-diag.test.js: ${n} passed`);
