"use strict";

/** 槽位填充：不粘连单词；变体中文可读 */
const assert = require("assert");
const { fillEnTemplate, variantZhLine } = require("../lib/enspeak-fill.js");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("贴着单词的 {slot} 替换后自动补空格", () => {
  assert.strictEqual(
    fillEnTemplate("How's it going{extra}?", { extra: "with you" }),
    "How's it going with you?"
  );
  assert.strictEqual(
    fillEnTemplate("What are you up to{extra}?", { extra: "today" }),
    "What are you up to today?"
  );
  assert.strictEqual(fillEnTemplate("Hold on{hold}.", { hold: "a second" }), "Hold on a second.");
  assert.strictEqual(fillEnTemplate("I'm on my way{extra}.", { extra: "now" }), "I'm on my way now.");
});

t("空槽位不留痕迹；逗号开场不硬加空格", () => {
  assert.strictEqual(fillEnTemplate("Let me think{pause}.", { pause: "" }), "Let me think.");
  assert.strictEqual(fillEnTemplate("Hi{name_tag}!", { name_tag: ", there" }), "Hi, there!");
  assert.strictEqual(fillEnTemplate("Take care{extra}.", { extra: "" }), "Take care.");
});

t("示例自带前导空格时不叠成双空格", () => {
  assert.strictEqual(
    fillEnTemplate("Let me think{pause}.", { pause: " for a second" }),
    "Let me think for a second."
  );
});

t("槽位自带问号时不叠成 ?.", () => {
  assert.strictEqual(
    fillEnTemplate("Sorry, {sorry}.", { sorry: "can you say that again?" }),
    "Sorry, can you say that again?"
  );
  assert.strictEqual(
    fillEnTemplate("By the way, {aside}.", { aside: "have you eaten?" }),
    "By the way, have you eaten?"
  );
});

t("英文省略号 ... 不会被收成单点", () => {
  assert.strictEqual(
    fillEnTemplate("Let me think{pause}.", { pause: "... okay" }),
    "Let me think... okay."
  );
});

t("变体中文：有 fillZh 时填省略号或括号；无 fillZh 只保留意图", () => {
  assert.strictEqual(variantZhLine("我是……", "a teacher", "老师"), "我是老师");
  assert.strictEqual(variantZhLine("我是……", "a teacher"), "我是……");
  assert.strictEqual(
    variantZhLine("最近怎么样？", "these days", "最近这段时间"),
    "最近怎么样（最近这段时间）？"
  );
  assert.strictEqual(variantZhLine("最近怎么样？", "these days"), "最近怎么样？");
  assert.strictEqual(variantZhLine("保重……", ""), "保重……");
});

t("变体中文：尾巴型 fillZh 直接拼接，不套括号", () => {
  assert.strictEqual(variantZhLine("最近怎么样？", " with you", "，你呢"), "最近怎么样，你呢？");
  assert.strictEqual(variantZhLine("我在路上了……", " now", "，现在"), "我在路上了，现在");
  assert.strictEqual(variantZhLine("谢谢……", "your help", "你的帮助"), "谢谢你的帮助");
});

t("变体中文：避免 什么什么 / 你你 粘连", () => {
  assert.strictEqual(variantZhLine("你……什么？", "usually eat", "通常吃什么"), "你通常吃什么？");
});

console.log(`enspeak-fill.test.js: ${n} passed`);
