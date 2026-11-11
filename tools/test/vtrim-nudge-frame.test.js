"use strict";

/** 片头/片尾微调：按 1 源帧步进，不再写死 0.1s */
const assert = require("assert");
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(path.join(__dirname, "..", "lib", "vtrim-editor.js"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("存在 nudgeStepSec = endKeepStepSec", () => {
  assert.ok(src.includes("function nudgeStepSec"));
  assert.ok(src.includes("endKeepStepSec()"));
});

t("按钮绑定按帧步进（nudgeTrimEdgeSec / nudgeSelectedCutout），不再 ±0.1", () => {
  const start = src.indexOf("bindNudgeHold(");
  const end = src.indexOf("cutAddBtn?.addEventListener", start);
  const bind = src.slice(start, end > start ? end : start + 2000);
  assert.ok(bind.includes("nudgeTrimEdgeSec(") || bind.includes("nudgeStepSec()"));
  assert.ok(bind.includes('nudgeSelectedCutout("start"'));
  assert.ok(!/nudgeSelectedCutout\("start", -0\.1\)/.test(bind));
  assert.ok(!/setStart\(startSec - 0\.1/.test(bind));
  assert.ok(!/setEnd\(endSec - 0\.1/.test(src));
});

t("文案写明 ±1 源帧", () => {
  assert.ok(src.includes("片头 −1 源帧"));
  assert.ok(src.includes("±1 帧"));
});

console.log(`vtrim-nudge-frame.test.js: ${n} passed`);
