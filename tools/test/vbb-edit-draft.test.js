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

t("含编辑草稿保存/恢复/导出/清除", () => {
  assert.ok(src.includes("saveVbbEditDraftsSync"));
  assert.ok(src.includes("restoreVbbEditDrafts"));
  assert.ok(src.includes("downloadVbbEditDraftsJson"));
  assert.ok(src.includes("clearVbbStoredEditDrafts"));
  assert.ok(src.includes("devtools-vbb-edit-drafts-json-v1"));
  assert.ok(panel.includes('id="vbb-export-edits"'));
  assert.ok(panel.includes("备份编辑"));
  assert.ok(panel.includes('id="vbb-import-edits"'));
  assert.ok(panel.includes("导入备份"));
  assert.ok(panel.includes('id="vbb-clear-drafts"'));
  assert.ok(panel.includes("清除草稿"));
});

t("含 JSON 备份导入还原", () => {
  assert.ok(src.includes("importVbbEditDraftsFromFile"));
  assert.ok(src.includes("importEditDrafts:"));
  assert.ok(src.includes("buildVbbBackupPayload"));
  assert.ok(src.includes("mergeVbbFeatureSchemes"));
  assert.ok(src.includes("exportVbbFeatureSchemesMap"));
  assert.ok(src.includes("schemes"));
  assert.ok(panel.includes("撞档"));
  assert.ok(panel.includes("合并"));
});

t("批量可重跑失败且保留成功 GIF", () => {
  assert.ok(src.includes("retryFailed"));
  assert.ok(src.includes("skipOk"));
  assert.ok(src.includes("已成功的"));
  assert.ok(panel.includes('id="vbb-retry-failed"'));
});

t("进度文案分阶段：①准备/预裁 ②试档 ③出帧/写GIF ④加宽/压缩", () => {
  assert.ok(src.includes("①准备/预裁/删中间"));
  assert.ok(src.includes("②试档"));
  assert.ok(src.includes("③出帧"));
  assert.ok(src.includes("④加宽"));
  assert.ok(src.includes("formatVbbJobStage"));
});

t("未完成才进草稿，全部成功则清空 localStorage 键", () => {
  assert.ok(src.includes("isVbbFileEncodeFullyDone"));
  assert.ok(src.includes("还没生成成功"));
  assert.ok(src.includes("localStorage.removeItem(VBB_EDIT_DRAFT_LS_KEY)"));
});

t("保存草稿按会话合并，空会话不擦其它视频草稿", () => {
  assert.ok(src.includes("function vbbEditDraftSessionFiles"));
  const start = src.indexOf("function saveVbbEditDraftsSync");
  const end = src.indexOf("function readVbbEditDraftPayload");
  assert.ok(start > 0 && end > start);
  const body = src.slice(start, end);
  assert.ok(body.includes("vbbEditDraftSessionFiles"));
  assert.ok(body.includes("kept.concat(fresh)"));
  assert.ok(body.includes("无会话且无新草稿"));
  assert.ok(body.includes("pruneSession"));
  assert.ok(body.includes("仅显式 prune"));
  assert.ok(src.includes("防：同一次选文件双投递") || src.includes("会话有文件但 fresh 空时"));
  assert.ok(src.includes("已恢复上次编辑"));
});

/**
 * 与 saveVbbEditDraftsSync 合并语义对齐（防回归：双投递 clearVbb 空 fresh 误擦）。
 * @param {{ pruneSession?: boolean }} [opts]
 */
function mergeDraftItems(prev, fresh, sessionFiles, softKey, exactKey, opts = {}) {
  if (!sessionFiles.length && !fresh.length) return prev.slice();
  const pruneSession = Boolean(opts.pruneSession);
  const sessionExact = new Set(sessionFiles.map((f) => exactKey(f)).filter(Boolean));
  const sessionSoft = new Set(sessionFiles.map((f) => softKey(f)).filter(Boolean));
  const freshExact = new Set(fresh.map((d) => String(d?.key || "")).filter(Boolean));
  const freshSoft = new Set(fresh.map((d) => softKey(d)).filter(Boolean));
  const kept = prev.filter((d) => {
    const key = String(d?.key || "");
    const soft = softKey(d);
    if (key && freshExact.has(key)) return false;
    if (soft && freshSoft.has(soft)) return false;
    if (pruneSession) {
      if (key && sessionExact.has(key)) return false;
      if (soft && sessionSoft.has(soft)) return false;
    }
    return true;
  });
  return kept.concat(fresh);
}

t("合并语义：默认不因空 fresh 剔会话草稿；pruneSession 才剔", () => {
  const { vbbFileDraftKey, vbbFileDraftSoftKey } = loadDraftMatchers();
  const prev = [
    { key: "a.mp4|100|1", name: "a.mp4", size: 100, edit: { trimStart: 1 } },
    { key: "b.mp4|200|2", name: "b.mp4", size: 200, edit: { trimStart: 2 } },
  ];
  const soft = (x) => vbbFileDraftSoftKey(x);
  const exact = (f) => vbbFileDraftKey(f);
  // 刷新后 clearVbb：无会话
  const keep = mergeDraftItems(prev, [], [], soft, exact);
  assert.equal(keep.length, 2);
  // 双投递第二遍：会话有 a、fresh 空 → 默认保留 a（否则刚要恢复的草稿被擦）
  const noPrune = mergeDraftItems(prev, [], [{ name: "a.mp4", size: 100, lastModified: 9 }], soft, exact);
  assert.equal(noPrune.length, 2);
  // 重置/出片成功：显式 prune → 只删 a
  const afterA = mergeDraftItems(
    prev,
    [],
    [{ name: "a.mp4", size: 100, lastModified: 9 }],
    soft,
    exact,
    { pruneSession: true }
  );
  assert.equal(afterA.length, 1);
  assert.equal(afterA[0].name, "b.mp4");
  // 保存 a 新编辑（默认 upsert）
  const fresh = [{ key: "a.mp4|100|9", name: "a.mp4", size: 100, edit: { trimStart: 3 } }];
  const upsert = mergeDraftItems(prev, fresh, [{ name: "a.mp4", size: 100, lastModified: 9 }], soft, exact);
  assert.equal(upsert.length, 2);
  assert.equal(upsert.find((d) => d.name === "a.mp4").edit.trimStart, 3);
});

t("同一次选文件双投递：WeakSet 去重 + loadEpoch 作废半截恢复", () => {
  assert.ok(src.includes("vbbIngestedFiles"));
  assert.ok(src.includes("WeakSet"));
  assert.ok(src.includes("vbbLoadEpoch"));
  assert.ok(src.includes("files.every((f) => vbbIngestedFiles.has(f))"));
  assert.ok(src.includes("loadEpoch !== vbbLoadEpoch"));
  assert.ok(src.includes("document capture + input change") || src.includes("双投递"));
});

t("出片成功清草稿：消费签名 + 手动/整段 prune + 来源 key", () => {
  assert.ok(src.includes("markVbbFileDraftConsumed"));
  assert.ok(src.includes("isVbbItemDraftConsumed"));
  assert.ok(src.includes("vbbDraftConsumeSig"));
  assert.ok(src.includes("draftOrigins"));
  assert.ok(src.includes("vbbCollectDraftOriginSets"));
  assert.ok(src.includes("pruneVbbEditDraftsForFiles"));
  const manual = src.slice(
    src.indexOf("async function runVbbManualBlackbox"),
    src.indexOf("function vbbSpeedLimitSec")
  );
  assert.ok(manual.includes("pruneSession: true"));
  assert.ok(manual.includes("markVbbFileDraftConsumed"));
  assert.ok(src.includes("sourceKey: vbbFileDraftKey"));
  // 批量缩到 1 个时保留 cutouts，勿丢掉删中间
  const rm = src.slice(src.indexOf("async function removeVbbBatchItem"), src.indexOf("function vbbGifBaseName"));
  assert.ok(rm.includes("cutouts"));
});

t("无实质编辑不写草稿，避免清除后被 pagehide 复活", () => {
  assert.ok(src.includes("vbbDraftPayloadWorthSaving"));
  assert.ok(src.includes("确有编辑内容"));
  const start = src.indexOf("function collectVbbEditDraftItems");
  const end = src.indexOf("function saveVbbEditDraftsSync");
  assert.ok(start > 0 && end > start);
  const body = src.slice(start, end);
  assert.ok(body.includes("vbbDraftPayloadWorthSaving"));
});

t("手机草稿：软匹配名+大小，且 pagehide/visibility 落盘", () => {
  assert.ok(src.includes("vbbFileDraftSoftKey"));
  assert.ok(src.includes("findVbbEditDraftForItem"));
  assert.ok(src.includes('addEventListener("pagehide"'));
  assert.ok(src.includes("visibilitychange"));
  assert.ok(src.includes("别刷新，直接再点「一键黑盒」"));
});

t("DevToolsVbb 暴露紧急导出/清除与强制取消", () => {
  assert.ok(src.includes("exportEditDrafts:"));
  assert.ok(src.includes("clearEditDrafts:"));
  assert.ok(src.includes("forceAbort:"));
  assert.ok(src.includes("getEditDraftPayload:"));
});

t("批处理开始前与结束后会保存草稿", () => {
  assert.ok(src.includes("saveVbbEditDraftsSync();"));
  assert.ok(/runVbbBatchBlackbox[\s\S]*saveVbbEditDraftsSync/.test(src));
});

t("单段黑盒：开跑前+失败/finally 都落盘，刷新可恢复", () => {
  const start = src.indexOf("async function runVbbSingleBlackbox");
  const end = src.indexOf("async function runVbbOneClick");
  assert.ok(start > 0 && end > start);
  const body = src.slice(start, end);
  assert.ok(body.includes("开跑前先落盘"));
  assert.ok(body.includes("生成失败 · 编辑已保存"));
  assert.ok(/finally\s*\{[\s\S]*saveVbbEditDraftsSync/.test(body));
  // 无 gifBlob 不得 prune（假成功会清掉删中间草稿）
  assert.ok(body.includes("!vbbClips[0]?.gifBlob") || body.includes("!vbbClips[0].gifBlob"));
  assert.ok(body.includes("确有 GIF 才清草稿") || body.includes("勿 prune"));
});

t("草稿匹配含指纹/放宽时长/唯一文件名，防 size 漂移丢恢复", () => {
  const start = src.indexOf("function findVbbEditDraftForItem");
  const end = src.indexOf("function serializeVbbEditDraft");
  assert.ok(start > 0 && end > start);
  const body = src.slice(start, end);
  assert.ok(body.includes("contentSig") || body.includes("byNameOnly") || body.includes("唯一文件名"));
  assert.ok(src.includes("function vbbFileContentSig"));
  assert.ok(src.includes("function vbbDraftDurationClose"));
  assert.ok(src.includes("刷新后重选同片会自动套用") || src.includes("回读校验"));
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
  return new Function(
    `${src.slice(start, end)}; return { vbbFileDraftKey, vbbFileDraftSoftKey, findVbbEditDraftForItem, vbbDraftDurationClose };`
  )();
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

t("末档：size 变了仍能按名+时长找回唯一草稿", () => {
  const { findVbbEditDraftForItem } = loadDraftMatchers();
  const drafts = [
    {
      key: "clip.mp4|999|1",
      name: "clip.mp4",
      size: 999,
      duration: 76.2,
      srcW: 1280,
      srcH: 720,
      edit: { trimStart: 0, trimEnd: 16.4, cutouts: [{ start: 2, end: 3 }] },
    },
  ];
  const used = new Set();
  const hit = findVbbEditDraftForItem(
    { file: { name: "clip.mp4", size: 1000000, lastModified: 42 }, duration: 76.2, srcW: 1280, srcH: 720 },
    drafts,
    used
  );
  assert.ok(hit);
  assert.equal(hit.edit.trimEnd, 16.4);
  assert.equal(hit.edit.cutouts.length, 1);
});

t("时长差约 1s 仍能按名匹配；内容指纹优先", () => {
  const { findVbbEditDraftForItem, vbbDraftDurationClose } = loadDraftMatchers();
  assert.ok(vbbDraftDurationClose(76.2, 75.1));
  assert.ok(!vbbDraftDurationClose(76.2, 70));
  const drafts = [
    {
      key: "a.mp4|1|1",
      name: "a.mp4",
      size: 1,
      duration: 76.2,
      contentSig: "s256:1:1:abcd",
      edit: { trimStart: 2, trimEnd: 10 },
    },
  ];
  const bySig = findVbbEditDraftForItem(
    {
      file: { name: "other.mp4", size: 9, lastModified: 1 },
      duration: 10,
      contentSig: "s256:1:1:abcd",
    },
    drafts,
    new Set()
  );
  assert.ok(bySig);
  assert.equal(bySig.edit.trimStart, 2);
  const byDur = findVbbEditDraftForItem(
    { file: { name: "a.mp4", size: 999, lastModified: 2 }, duration: 75.2 },
    drafts,
    new Set()
  );
  assert.ok(byDur);
});

t("任务世代：begin/finish/forceAbort 协同存在且 busy 只在 begin 置 true", () => {
  assert.ok(src.includes("vbbJobActiveEpoch = 0"));
  assert.ok(src.includes("vbbJobEpoch += 1"));
  assert.equal((src.match(/vbbBusy\s*=\s*true/g) || []).length, 1);
  assert.ok(src.includes("if (epoch !== vbbJobActiveEpoch) return false"));
});

t("备份/导入走成片时钟字段：serialize/apply 保留 srcFps，打开编辑也带入", () => {
  assert.ok(src.includes("function serializeVbbEditDraft"));
  assert.ok(src.includes("function applyVbbEditDraftToItem"));
  const ser = src.slice(
    src.indexOf("function serializeVbbEditDraft"),
    src.indexOf("function vbbEditDraftSessionFiles")
  );
  assert.ok(ser.includes("srcFps"));
  assert.ok(!ser.includes("chrome") && !ser.includes("VideoFrame"));
  assert.ok(!ser.includes("__vbbTimeline"), "采样表禁止进 LS / JSON 备份");
  assert.ok(!ser.includes("...edit"), "草稿须白名单字段，禁止整对象展开");
  const apply = src.slice(
    src.indexOf("function applyVbbEditDraftToItem"),
    src.indexOf("function restoreVbbEditDrafts")
  );
  assert.ok(apply.includes("draft.edit.srcFps") || apply.includes("srcFps: fps"));
  assert.ok(apply.includes("item.srcFps = fps") || apply.includes("item.srcFps = fps"));
  // 打开编辑：备份还原的 fps 进 initial，成片锚点不丢
  assert.ok(src.includes("备份/导入还原的 srcFps 一并带进编辑器") || src.includes("draftFps"));
  const open = src.slice(src.indexOf("const draftFps"), src.indexOf("vbbEditOpening = true"));
  assert.ok(open.includes("srcFps: draftFps") || open.includes("srcFps: draftFps"));
});

console.log(`vbb-edit-draft.test.js: ${n} passed`);
