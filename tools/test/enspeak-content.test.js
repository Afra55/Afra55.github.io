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
  assert.ok(content.frames?.length >= 60, `frames ${content.frames?.length}`);
  assert.ok(content.islands?.length >= 20, `islands ${content.islands?.length}`);
  assert.ok(content.sentences?.length >= 500, `sentences ${content.sentences?.length}`);
});

t("架子带 group，且有日常对话组", () => {
  assert.ok(Array.isArray(content.frameGroups) && content.frameGroups.some((g) => g.id === "chat"));
  for (const f of content.frames) {
    assert.ok(f.id && f.en && f.zh && f.slot, `frame fields ${f.id}`);
    assert.ok(f.group, `missing group ${f.id}`);
    assert.ok(Array.isArray(f.examples) && f.examples.length >= 3, `examples ${f.id}`);
  }
  assert.ok(content.frames.filter((f) => f.group === "chat").length >= 20, "chat frames");
});

t("日常核心岛齐全：闲聊/情绪/邀请/电话/通勤/天气/居家/付钱", () => {
  const need = ["chat", "mood", "invite", "phone", "commute", "weather", "home", "pay"];
  for (const id of need) {
    const isl = content.islands.find((i) => i.id === id);
    assert.ok(isl?.starter, `${id} should be starter`);
    const lines = content.sentences.filter((s) => s.island === id);
    assert.ok(lines.length >= 12, `${id} sentences ${lines.length}`);
    assert.ok(Array.isArray(content.dialogues?.[id]) && content.dialogues[id].length >= 4, `${id} dialogue`);
  }
});

t("全部岛有伪对话，且开场→追问→接话→收尾链标签齐全", () => {
  const chain = ["opener", "ask", "reply", "closer"];
  for (const isl of content.islands) {
    const dlg = content.dialogues?.[isl.id];
    assert.ok(Array.isArray(dlg) && dlg.length >= 4, `dialogue ${isl.id}`);
    const lines = content.sentences.filter((s) => s.island === isl.id);
    for (const tag of chain) {
      assert.ok(
        lines.some((s) => (s.tags || []).includes(tag)),
        `${isl.id} missing tag ${tag}`
      );
    }
  }
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
});

t("架子变体走 fill 库、带中文，今日闭环文案落地", () => {
  assert.ok(js.includes("DevToolsEnspeakFill") || js.includes("fillApi"));
  assert.ok(js.includes("variantZhFor"));
  assert.ok(js.includes("无稿开口"));
  assert.ok(html.includes("听跟 → 裂变换词 → 接话 → 无稿开口") || html.includes("听跟 → 裂变"));
  const fillSrc = fs.readFileSync(path.join(root, "lib/enspeak-fill.js"), "utf8");
  assert.ok(fillSrc.includes("fillEnTemplate"));
});

t("架子 examplesZh 与 examples 对齐，非空槽位尽量有中文", () => {
  let slots = 0;
  let zh = 0;
  for (const f of content.frames) {
    assert.ok(Array.isArray(f.examplesZh), `examplesZh ${f.id}`);
    assert.strictEqual(f.examplesZh.length, f.examples.length, `zh len ${f.id}`);
    for (let i = 0; i < f.examples.length; i++) {
      const en = String(f.examples[i] ?? "").trim();
      if (!en) continue;
      slots += 1;
      if (String(f.examplesZh[i] || "").trim()) zh += 1;
    }
  }
  assert.ok(slots >= 500, `slot fills ${slots}`);
  assert.ok(zh / slots >= 0.9, `examplesZh cover ${(zh / slots).toFixed(2)}`);
});

t("对话链 / 无稿倒计时 / 手机吸底下一句", () => {
  assert.ok(js.includes("buildIslandChain"));
  assert.ok(js.includes("startBlindCountdown") || js.includes("blindTimer"));
  assert.ok(js.includes("enspeak-frame-dock") || js.includes("enspeak-frame-next"));
  assert.ok(html.includes("enspeak-chain"));
  assert.ok(html.includes("对话链"));
});

t("开口打卡日历与录音自评", () => {
  assert.ok(js.includes("renderCheckin"));
  assert.ok(js.includes("recordSelfEval"));
  assert.ok(js.includes("bumpHistory"));
  assert.ok(html.includes("enspeak-checkin"));
  assert.ok(html.includes("data-eval"));
  assert.ok(html.includes("流畅"));
});

t("开口句英文不含「A / B」二选一粘连（避免整句练错）", () => {
  for (const s of content.sentences) {
    assert.ok(!/ \/ /.test(s.en), `slash alt ${s.id}: ${s.en}`);
  }
  for (const f of content.frames) {
    for (const ex of f.examples || []) {
      assert.ok(!/ \/ /.test(String(ex)), `frame slash ${f.id}: ${ex}`);
    }
  }
});

console.log(`enspeak-content.test.js: ${n} passed`);
