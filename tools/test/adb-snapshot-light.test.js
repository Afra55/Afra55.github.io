"use strict";

/**
 * 状态快照不得再嵌套完整 deviceInfo，否则与「抓取信息」叠跑会堵死 adb。
 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const adbServer = fs.readFileSync(path.join(__dirname, "..", "adb-bridge", "server.js"), "utf8");
const adbUi = fs.readFileSync(path.join(__dirname, "..", "extra-panels", "adb.js"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("deviceSnapshot 不调用 deviceInfo", () => {
  const start = adbServer.indexOf("async function deviceSnapshot");
  const end = adbServer.indexOf("async function deviceControl", start);
  assert.ok(start > 0 && end > start, "missing deviceSnapshot");
  const body = adbServer.slice(start, end);
  assert.ok(!/deviceInfo\s*\(/.test(body), "snapshot must not call deviceInfo");
  assert.ok(body.includes("dumpsys activity") || body.includes("mResumedActivity"));
  assert.ok(body.includes("禁止再调完整 deviceInfo") || body.includes("只采快照字段"));
});

t("桥版本 ≥ 0.9.91", () => {
  const m = adbServer.match(/const BRIDGE_VERSION = "0\.9\.(\d+)"/);
  assert.ok(m, "missing BRIDGE_VERSION");
  assert.ok(Number(m[1]) >= 91, `got 0.9.${m[1]}`);
});

t("面板：快照可取消/超时；选设备时信息与文件并行", () => {
  assert.ok(adbUi.includes("adbSnapAbort"));
  assert.ok(adbUi.includes("已取消或超时"));
  assert.ok(adbUi.includes("信息 / 文件 / 快照并行") || adbUi.includes("抓信息与列目录并行"));
  assert.ok(adbUi.includes('tasks = [loadAdbInfo(serial), loadFs("/")]') || adbUi.includes("loadAdbInfo(serial), loadFs(\"/\")"));
  assert.ok(adbUi.includes("Promise.all([loadAdbInfo(adbSelected), loadFs("));
});

console.log(`adb-snapshot-light.test.js: ${n} passed`);
