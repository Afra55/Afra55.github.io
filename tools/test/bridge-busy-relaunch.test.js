"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const adb = fs.readFileSync(path.join(__dirname, "..", "adb-bridge", "server.js"), "utf8");
const hookPy = path.join(__dirname, "..", "mineru-bridge", "pyhooks", "ensure_image_min_tokens.py");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("桥版本 0.9.83+", () => {
  const m = adb.match(/const BRIDGE_VERSION = "([^"]+)"/);
  assert.ok(m, "missing BRIDGE_VERSION");
  const parts = m[1].split(".").map(Number);
  assert.ok(parts[0] > 0 || parts[1] > 9 || parts[2] >= 83, `version ${m[1]} too old`);
});

t("长任务 busy 会延后 relaunch", () => {
  assert.ok(adb.includes("beginBridgeBusy"));
  assert.ok(adb.includes("endBridgeBusy"));
  assert.ok(adb.includes("relaunchWhenIdle"));
  assert.ok(/bridgeBusyCount > 0/.test(adb));
  assert.ok(adb.includes("黑窗口不会现在关掉") || adb.includes("延后重启"));
});

t("MinerU/Docling/Pandoc convert 包在 busy 里", () => {
  assert.ok(adb.includes('beginBridgeBusy("mineru-convert")'));
  assert.ok(adb.includes('beginBridgeBusy("docling-convert")'));
  assert.ok(adb.includes('beginBridgeBusy("pandoc-convert")'));
  assert.ok(adb.includes('endBridgeBusy("mineru-convert")'));
});

t("unhandledRejection 保持窗口", () => {
  assert.ok(adb.includes("unhandledRejection"));
  assert.ok(adb.includes("窗口将保持打开"));
});

t("mmproj 补丁 selftest（低内存路径）", () => {
  const r = spawnSync(process.env.PYTHON || "python3", [hookPy, "--selftest"], {
    encoding: "utf8",
    timeout: 30000,
  });
  assert.strictEqual(r.status, 0, `${r.stdout}\n${r.stderr}`);
  assert.ok(/selftest ok/.test(r.stdout || ""));
});

console.log(`bridge-busy-relaunch.test.js: ${n} passed`);
