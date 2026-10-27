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

console.log(`enspeak-fill.test.js: ${n} passed`);
