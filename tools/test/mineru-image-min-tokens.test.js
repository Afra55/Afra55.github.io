"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const mineru = require(path.join(__dirname, "..", "mineru-bridge", "mineru-ops.js"));
const adbServer = fs.readFileSync(path.join(__dirname, "..", "adb-bridge", "server.js"), "utf8");
const hookPy = path.join(__dirname, "..", "mineru-bridge", "pyhooks", "ensure_image_min_tokens.py");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("默认 QWEN_IMAGE_MIN_TOKENS 为 1024", () => {
  assert.strictEqual(String(mineru.QWEN_IMAGE_MIN_TOKENS), "1024");
});

t("mineruEnv 默认写入 LLAMA_ARG_IMAGE_MIN_TOKENS=1024", () => {
  const prev = process.env.LLAMA_ARG_IMAGE_MIN_TOKENS;
  delete process.env.LLAMA_ARG_IMAGE_MIN_TOKENS;
  try {
    const env = mineru.mineruEnv();
    assert.strictEqual(env.LLAMA_ARG_IMAGE_MIN_TOKENS, "1024");
  } finally {
    if (prev == null) delete process.env.LLAMA_ARG_IMAGE_MIN_TOKENS;
    else process.env.LLAMA_ARG_IMAGE_MIN_TOKENS = prev;
  }
});

t("mineruEnv 不覆盖用户已设的 LLAMA_ARG_IMAGE_MIN_TOKENS", () => {
  const prev = process.env.LLAMA_ARG_IMAGE_MIN_TOKENS;
  process.env.LLAMA_ARG_IMAGE_MIN_TOKENS = "2048";
  try {
    const env = mineru.mineruEnv();
    assert.strictEqual(env.LLAMA_ARG_IMAGE_MIN_TOKENS, "2048");
  } finally {
    if (prev == null) delete process.env.LLAMA_ARG_IMAGE_MIN_TOKENS;
    else process.env.LLAMA_ARG_IMAGE_MIN_TOKENS = prev;
  }
});

t("pyhooks/ensure_image_min_tokens.py 存在", () => {
  assert.ok(fs.existsSync(hookPy), "缺少 ensure_image_min_tokens.py");
});

t("桥版本已 bump（含 mineru image-min）", () => {
  assert.ok(/const BRIDGE_VERSION = "0\.9\.82"/.test(adbServer));
});

t("convert 会调用 image-min 预抬", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "mineru-bridge", "mineru-ops.js"), "utf8");
  assert.ok(src.includes("ensureQwenImageMinTokens"));
  assert.ok(src.includes("LLAMA_ARG_IMAGE_MIN_TOKENS"));
});

t("pyhooks selftest 通过", () => {
  const r = spawnSync(process.env.PYTHON || "python3", [hookPy, "--selftest"], {
    encoding: "utf8",
    timeout: 30000,
  });
  assert.strictEqual(r.status, 0, `selftest failed: ${r.stdout || ""}\n${r.stderr || ""}`);
  assert.ok(/selftest ok/.test(r.stdout || ""), r.stdout);
});

console.log(`mineru-image-min-tokens.test.js: ${n} passed`);
