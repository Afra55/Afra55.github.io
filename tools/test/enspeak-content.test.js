"use strict";

/** 日常开口句库：架子分组 + 日常闲聊岛可扩展 */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const content = JSON.parse(fs.readFileSync(path.join(root, "data/en-speak/content.json"), "utf8"));
const js = fs.readFileSync(path.join(root, "enspeak.js"), "utf8");
const html = fs.readFileSync(path.join(root, "panels/enspeak.html"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("句库有架子 / 岛 / 句子", () => {
  assert.ok(content.frames?.length >= 30, `frames ${content.frames?.length}`);
  assert.ok(content.islands?.length >= 10, `islands ${content.islands?.length}`);
  assert.ok(content.sentences?.length >= 200, `sentences ${content.sentences?.length}`);
});

t("架子带 group，且有日常对话组", () => {
  assert.ok(Array.isArray(content.frameGroups) && content.frameGroups.some((g) => g.id === "chat"));
  for (const f of content.frames) {
    assert.ok(f.id && f.en && f.zh && f.slot, `frame fields ${f.id}`);
    assert.ok(f.group, `missing group ${f.id}`);
    assert.ok(Array.isArray(f.examples) && f.examples.length >= 3, `examples ${f.id}`);
  }
  assert.ok(content.frames.some((f) => f.group === "chat" && f.id === "f21"));
});

t("日常闲聊岛 + 示例句 + 伪对话", () => {
  const chat = content.islands.find((i) => i.id === "chat");
  assert.ok(chat?.starter, "chat should be starter island");
  const lines = content.sentences.filter((s) => s.island === "chat");
  assert.ok(lines.length >= 8, `chat sentences ${lines.length}`);
  assert.ok(Array.isArray(content.dialogues?.chat) && content.dialogues.chat.length >= 4);
});

t("句子 id 唯一，岛引用有效", () => {
  const ids = new Set();
  const islandIds = new Set(content.islands.map((i) => i.id));
  // lifeline 等特殊岛可只出现在句子里（急救接话）
  const allowedExtra = new Set(["lifeline"]);
  for (const s of content.sentences) {
    assert.ok(s.id && !ids.has(s.id), `dup/missing id ${s.id}`);
    ids.add(s.id);
    assert.ok(
      islandIds.has(s.island) || allowedExtra.has(s.island),
      `unknown island ${s.island} on ${s.id}`
    );
    assert.ok(s.en && s.zh, `text ${s.id}`);
  }
});

t("UI 支持架子分组筛选", () => {
  assert.ok(js.includes("function renderFrameFilters"));
  assert.ok(js.includes("activeFrameGroup"));
  assert.ok(html.includes("enspeak-frame-filters"));
  assert.ok(html.includes("固定架子") || html.includes("固定框架"));
});

console.log(`enspeak-content.test.js: ${n} passed`);
