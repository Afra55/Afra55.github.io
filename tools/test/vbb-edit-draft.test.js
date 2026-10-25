"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
  path.join(__dirname, "..", "extra-panels", "v2g-suite-src", "40-vbb.js"),
  "utf8"
);
const panel = fs.readFileSync(path.join(__dirname, "..", "panels", "vbb.html"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("含强制取消与并行池销毁", () => {
  assert.ok(src.includes("function forceAbortVbb"));
  assert.ok(src.includes("destroyVbbLiveFfmpegPool"));
  assert.ok(src.includes("vbbLiveFfmpegPool"));
  assert.ok(/vbbAbort\?\.addEventListener\("click".*forceAbortVbb/s.test(src));
});

t("含编辑草稿保存/恢复/导出", () => {
  assert.ok(src.includes("saveVbbEditDraftsSync"));
  assert.ok(src.includes("restoreVbbEditDrafts"));
  assert.ok(src.includes("downloadVbbEditDraftsJson"));
  assert.ok(src.includes("devtools-vbb-edit-drafts-json-v1"));
  assert.ok(panel.includes('id="vbb-export-edits"'));
});

t("DevToolsVbb 暴露紧急导出与强制取消", () => {
  assert.ok(src.includes("exportEditDrafts:"));
  assert.ok(src.includes("forceAbort:"));
  assert.ok(src.includes("getEditDraftPayload:"));
});

t("批处理开始前与结束后会保存草稿", () => {
  assert.ok(src.includes("saveVbbEditDraftsSync();"));
  assert.ok(/runVbbBatchBlackbox[\s\S]*saveVbbEditDraftsSync/.test(src));
});

console.log(`vbb-edit-draft.test.js: ${n} passed`);
