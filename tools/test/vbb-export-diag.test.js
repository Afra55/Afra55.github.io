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

t("诊断 v2：时间轴校准 + seed 路径 + 墙钟保留", () => {
  assert.ok(vbb.includes("v: 2") || /v:\s*2/.test(vbb), "diag payload ver 2");
  assert.ok(vbb.includes("calibrateMethod"), "timeline 须含 calibrateMethod");
  assert.ok(vbb.includes("ctsLen"), "timeline 须用 ctsLen 而非空 frames");
  assert.ok(vbb.includes("seedDelivered"), "clip 须含 seedDelivered");
  assert.ok(vbb.includes("encodePath"), "clip 须含 encodePath");
  assert.ok(vbb.includes("schemeKey"), "clip 须含 schemeKey");
  assert.ok(vbb.includes("encodeFps"), "clip 须含 encodeFps");
  assert.ok(vbb.includes("jobEndedAt"), "须记录 jobEndedAt");
  assert.ok(vbb.includes("保留 jobStartedAt") || vbb.includes("勿清零"), "done 后保留 jobStartedAt");
  assert.ok(vbb.includes("encodeMsSum") || vbb.includes("encodeSecSum"), "summary 须有总耗时");
  assert.ok(vbb.includes("featureSchemeVer") || vbb.includes("schemeIdbLoaded"), "env 须含撞档库状态");
  assert.ok(vbb.includes("attachVbbEncodeDiagHints"), "编码前挂诊断线索");
});

t("suite 已含诊断导出", () => {
  assert.ok(suite.includes("buildVbbDiagPayload"));
  assert.ok(suite.includes("vbb-export-diag") || suite.includes("downloadVbbDiagJson"));
});

console.log(`vbb-export-diag.test.js: ${n} passed`);
