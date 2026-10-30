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

t("10 分钟极简 / 对方接话 / 卡壳复习 / 档案无稿", () => {
  assert.ok(js.includes("startExpress"));
  assert.ok(js.includes("renderExpressDrill"));
  assert.ok(js.includes("partnerPromptBundle"));
  assert.ok(js.includes("queueForReview"));
  assert.ok(js.includes("profileSpeakTargets"));
  assert.ok(js.includes("reviewQueue"));
  assert.ok(html.includes("enspeak-express"));
  assert.ok(html.includes("10 分钟极简"));
  assert.ok(content.method?.expressMinutes === 10 || content.method?.dailyMinutes);
});

t("按钮反馈：本地面包屑 toast + 朗读失败提示 + 裂变开口计入", () => {
  assert.ok(js.includes('getElementById("toast")'), "toast 须直写 #toast，不依赖 extra-kit");
  assert.ok(js.includes("markAdhocSpoken"), "架子裂变「已开口」须计入今日");
  assert.ok(js.includes("warmSpeakVoices"), "朗读须预热 voices");
  assert.ok(js.includes("enspeak-print-frame"), "打印被拦时须 iframe 回退");
  assert.ok(js.includes("请自己出声跟读") || js.includes("不支持朗读"), "朗读失败须可见提示");
});

t("准确度门禁：禁易练错英文 / 禁中文斜杠二选一 / 问句中文要像问句", () => {
  const { fillEnTemplate } = require("../lib/enspeak-fill.js");
  const banEn =
    /pretty well|\bOOO\b|Same energy|You got a point|pay by splitting|How much is per person|How much is one night|help me with a photo|going to go home|I work as a student/i;
  for (const s of content.sentences) {
    assert.ok(!banEn.test(s.en), `banned en ${s.id}: ${s.en}`);
    assert.ok(!String(s.zh).includes("/") && !String(s.zh).includes("／"), `zh slash ${s.id}: ${s.zh}`);
    assert.ok(!/^\{[a-z_]+\}\.?$/i.test(String(s.en).trim()), `slot-only ${s.id}`);
    if (String(s.en).trim().endsWith("?")) {
      assert.ok(
        /[？?]|吗|呢|么|吧|哪|什么|怎么|为什么|能否|可以|要不要|有没有|是不是|行吗|好吗/.test(s.zh),
        `q-zh ${s.id}: ${s.en} | ${s.zh}`
      );
    }
  }
  for (const f of content.frames) {
    assert.strictEqual((f.examples || []).length, (f.examplesZh || []).length, `ex/zh len ${f.id}`);
    for (const ex of f.examples || []) {
      const en = fillEnTemplate(f.en, { [f.slot]: ex });
      assert.ok(!banEn.test(en), `banned filled ${f.id}: ${en}`);
      assert.ok(!/\?\./.test(en), `punct stack ${f.id}: ${en}`);
    }
  }
  for (const [k, lines] of Object.entries(content.dialogues || {})) {
    for (const line of lines || []) {
      assert.ok(!/ \/ /.test(line.text), `dlg slash ${k}: ${line.text}`);
      assert.ok(!banEn.test(line.text), `dlg banned ${k}: ${line.text}`);
    }
  }
  const who5 = content.sentences.find((s) => s.id === "who05");
  assert.ok(who5 && /^I'm \{job\}\.?$/i.test(who5.en), "who05 should be I'm {job}");
  assert.ok(
    (content.dialogues.who || []).some((l) => /I'm \{job\}/i.test(l.text)),
    "who dialogue should use I'm {job}"
  );
});

console.log(`enspeak-content.test.js: ${n} passed`);
