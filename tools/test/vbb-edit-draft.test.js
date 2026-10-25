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

t("取消后解锁 UI，且用任务世代避免旧 finally 误清", () => {
  assert.ok(src.includes("function beginVbbJob"));
  assert.ok(src.includes("function finishVbbJob"));
  assert.ok(src.includes("vbbJobActiveEpoch"));
  assert.ok(src.includes("unlockUi"));
  assert.ok(src.includes("已停止转换"));
  assert.ok(src.includes('throw new Error("已取消")'));
  assert.ok(/abortVbb \|\| String\(err/.test(src));
});

t("含编辑草稿保存/恢复/导出", () => {
  assert.ok(src.includes("saveVbbEditDraftsSync"));
  assert.ok(src.includes("restoreVbbEditDrafts"));
  assert.ok(src.includes("downloadVbbEditDraftsJson"));
  assert.ok(src.includes("devtools-vbb-edit-drafts-json-v1"));
  assert.ok(panel.includes('id="vbb-export-edits"'));
  assert.ok(panel.includes("备份编辑"));
  assert.ok(panel.includes('id="vbb-import-edits"'));
  assert.ok(panel.includes("导入备份"));
});

t("含 JSON 备份导入还原", () => {
  assert.ok(src.includes("importVbbEditDraftsFromFile"));
  assert.ok(src.includes("importEditDrafts:"));
});

t("批量可重跑失败且保留成功 GIF", () => {
  assert.ok(src.includes("retryFailed"));
  assert.ok(src.includes("skipOk"));
  assert.ok(src.includes("已成功的"));
  assert.ok(panel.includes('id="vbb-retry-failed"'));
});

t("未完成才进草稿，全部成功则清空 localStorage 键", () => {
  assert.ok(src.includes("isVbbFileEncodeFullyDone"));
  assert.ok(src.includes("还没生成成功"));
  assert.ok(src.includes("localStorage.removeItem(VBB_EDIT_DRAFT_LS_KEY)"));
});

t("手机草稿：软匹配名+大小，且 pagehide/visibility 落盘", () => {
  assert.ok(src.includes("vbbFileDraftSoftKey"));
  assert.ok(src.includes("findVbbEditDraftForItem"));
  assert.ok(src.includes('addEventListener("pagehide"'));
  assert.ok(src.includes("visibilitychange"));
  assert.ok(src.includes("别刷新，直接再点「一键黑盒」"));
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

t("强制取消不清空编辑字段，只标任务状态", () => {
  assert.ok(src.includes("编辑方案绝不清空"));
  assert.ok(/jobStatus === "pending" \|\| c\.jobStatus === "running"/.test(src));
  const start = src.indexOf("function forceAbortVbb");
  const end = src.indexOf("\n      function formatVbbClock", start);
  assert.ok(start > 0 && end > start);
  const body = src.slice(start, end);
  assert.ok(!/vbbSingleEdit\s*=\s*null/.test(body));
  assert.ok(!/vbbBatchFiles\s*=\s*\[\]/.test(body));
  assert.ok(!/item\.edit\s*=/.test(body));
  assert.ok(body.includes("saveVbbEditDraftsSync"));
  assert.ok(body.includes("destroyVbbLiveFfmpegPool"));
});

/** 从源码抽出纯函数做行为断言（手机 mtime 变化仍能恢复） */
function loadDraftMatchers() {
  const start = src.indexOf("function vbbFileDraftKey(file)");
  const end = src.indexOf("function serializeVbbEditDraft(edit)");
  assert.ok(start > 0 && end > start);
  // eslint-disable-next-line no-new-func
  return new Function(`${src.slice(start, end)}; return { vbbFileDraftKey, vbbFileDraftSoftKey, findVbbEditDraftForItem };`)();
}

t("软匹配：mtime 变了仍能按名+大小找回草稿", () => {
  const { findVbbEditDraftForItem } = loadDraftMatchers();
  const drafts = [
    {
      key: "a.mp4|1000|111",
      name: "a.mp4",
      size: 1000,
      lastModified: 111,
      duration: 12.5,
      srcW: 1280,
      srcH: 720,
      edit: { trimStart: 1, trimEnd: 8 },
    },
  ];
  const used = new Set();
  const item = {
    file: { name: "a.mp4", size: 1000, lastModified: 999999 },
    duration: 12.5,
    srcW: 1280,
    srcH: 720,
  };
  const hit = findVbbEditDraftForItem(item, drafts, used);
  assert.ok(hit);
  assert.equal(hit.edit.trimStart, 1);
  assert.equal(used.size, 1);
});

t("软匹配：同名同大小按时长消歧，且 used 不重复占用", () => {
  const { findVbbEditDraftForItem } = loadDraftMatchers();
  const drafts = [
    { key: "x.mp4|200|1", name: "x.mp4", size: 200, duration: 10, srcW: 720, srcH: 1280, edit: { id: "short" } },
    { key: "x.mp4|200|2", name: "x.mp4", size: 200, duration: 40, srcW: 720, srcH: 1280, edit: { id: "long" } },
  ];
  const used = new Set();
  const a = findVbbEditDraftForItem(
    { file: { name: "x.mp4", size: 200, lastModified: 9 }, duration: 40, srcW: 720, srcH: 1280 },
    drafts,
    used
  );
  const b = findVbbEditDraftForItem(
    { file: { name: "x.mp4", size: 200, lastModified: 8 }, duration: 10, srcW: 720, srcH: 1280 },
    drafts,
    used
  );
  assert.equal(a.edit.id, "long");
  assert.equal(b.edit.id, "short");
  assert.equal(used.size, 2);
});

t("任务世代：begin/finish/forceAbort 协同存在且 busy 只在 begin 置 true", () => {
  assert.ok(src.includes("vbbJobActiveEpoch = 0"));
  assert.ok(src.includes("vbbJobEpoch += 1"));
  assert.equal((src.match(/vbbBusy\s*=\s*true/g) || []).length, 1);
  assert.ok(src.includes("if (epoch !== vbbJobActiveEpoch) return false"));
});

console.log(`vbb-edit-draft.test.js: ${n} passed`);
