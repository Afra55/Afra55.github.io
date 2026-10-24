"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const mineru = require(path.join(__dirname, "..", "mineru-bridge", "mineru-ops.js"));
const adbServer = fs.readFileSync(path.join(__dirname, "..", "adb-bridge", "server.js"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("classifyGpuName：独显", () => {
  assert.strictEqual(mineru.classifyGpuName("NVIDIA GeForce RTX 4060"), "discrete");
  assert.strictEqual(mineru.classifyGpuName("AMD Radeon RX 6800 XT"), "discrete");
  assert.strictEqual(mineru.classifyGpuName("Intel(R) Arc(TM) A770 Graphics"), "discrete");
  assert.strictEqual(mineru.classifyGpuName("Apple M2"), "discrete");
});

t("classifyGpuName：集显", () => {
  assert.strictEqual(mineru.classifyGpuName("Intel(R) UHD Graphics 770"), "igpu");
  assert.strictEqual(mineru.classifyGpuName("Intel(R) Iris(R) Xe Graphics"), "igpu");
  assert.strictEqual(mineru.classifyGpuName("AMD Radeon(TM) Graphics"), "igpu");
  assert.strictEqual(mineru.classifyGpuName("AMD Radeon Graphics"), "igpu");
});

t("summarizeGpuClass：有独显优先独显", () => {
  assert.strictEqual(
    mineru.summarizeGpuClass(["Intel(R) UHD Graphics", "NVIDIA GeForce GTX 1660"]),
    "discrete"
  );
  assert.strictEqual(mineru.summarizeGpuClass(["Intel(R) UHD Graphics 630"]), "igpu");
  assert.strictEqual(mineru.summarizeGpuClass([]), "unknown");
});

t("looksLikeGpuBackendLost 识别 Vulkan device lost", () => {
  assert.ok(
    mineru.looksLikeGpuBackendLost({
      stderr: "ggml_vulkan: device lost on Vulkan0\nvk::Queue::submit: ErrorDeviceLost",
    })
  );
  assert.ok(!mineru.looksLikeGpuBackendLost({ stderr: "parse_wait_timeout" }));
});

t("applyLlamaCppBackendPolicy：用户指定不覆盖", () => {
  const env = { MINERU_LLAMA_CPP_BACKEND: "vulkan" };
  mineru.applyLlamaCppBackendPolicy(env);
  assert.strictEqual(env.MINERU_LLAMA_CPP_BACKEND, "vulkan");
});

t("mineruEnv 会写入 MINERU_LLAMA_CPP_BACKEND（除非用户已设）", () => {
  const prev = process.env.MINERU_LLAMA_CPP_BACKEND;
  delete process.env.MINERU_LLAMA_CPP_BACKEND;
  try {
    const env = mineru.mineruEnv();
    assert.ok(
      /^(auto|cpu|vulkan|metal)$/i.test(String(env.MINERU_LLAMA_CPP_BACKEND || "")),
      `unexpected backend: ${env.MINERU_LLAMA_CPP_BACKEND}`
    );
  } finally {
    if (prev == null) delete process.env.MINERU_LLAMA_CPP_BACKEND;
    else process.env.MINERU_LLAMA_CPP_BACKEND = prev;
  }
});

t("convert 含 GPU 失败后同档 CPU 重试", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "mineru-bridge", "mineru-ops.js"), "utf8");
  assert.ok(src.includes("looksLikeGpuBackendLost"));
  assert.ok(src.includes("同档改用 CPU 重试"));
  assert.ok(src.includes("applyLlamaCppBackendPolicy"));
});

t("桥版本 0.9.85+", () => {
  const m = adbServer.match(/const BRIDGE_VERSION = "0\.9\.(\d+)"/);
  assert.ok(m, "adb bridge version");
  assert.ok(Number(m[1]) >= 85, `expected >= 0.9.85, got 0.9.${m[1]}`);
});

console.log(`mineru-gpu-backend.test.js: ${n} passed`);
