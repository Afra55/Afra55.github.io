"use strict";

/** md 阅读页外部改盘跟新 + MDM live 推送 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const app = fs.readFileSync(path.join(__dirname, "..", "mdread", "app.js"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "mdread", "index.html"), "utf8");
const mdm = fs.readFileSync(path.join(__dirname, "..", "extra-panels", "mdm.js"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("阅读页：FileSystemFileHandle + 轮询/前台检查", () => {
  assert.ok(app.includes("showOpenFilePicker"));
  assert.ok(app.includes("openFromHandle"));
  assert.ok(app.includes("checkExternalChange"));
  assert.ok(app.includes("startExternalWatch"));
  assert.ok(app.includes("visibilitychange"));
  assert.ok(app.includes("检测到外部修改，已重新加载"));
  assert.ok(app.includes("getAsFileSystemHandle"));
});

t("阅读页：听 MDM live 键", () => {
  assert.ok(app.includes("devtools-mdread-live"));
  assert.ok(app.includes("tryApplyLiveFromStore"));
  assert.ok(app.includes('source.kind = id ? "mdm"'));
});

t("MDM：handoff 带 id/mtime，并 pushMdReadLive", () => {
  assert.ok(mdm.includes("function pushMdReadLive"));
  assert.ok(mdm.includes("devtools-mdread-live"));
  assert.ok(mdm.includes("pushMdReadLive(item, text)") || mdm.includes("pushMdReadLive(item, full)"));
  assert.ok(mdm.includes("fileMtime: Number(item?.fileMtime)") || mdm.includes("fileMtime: Number(item.fileMtime)"));
  assert.ok(/writeMdReadHandoff[\s\S]*?id:\s*item\?\.id/.test(mdm));
});

t("空态提示含跟盘说明；资源版本 bump", () => {
  assert.ok(html.includes("外部改盘后会自动重载"));
  assert.ok(html.includes("app.js?v=20"));
});

console.log(`mdread-ext-watch.test.js: ${n} passed`);
