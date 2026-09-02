#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const STEPS = [
  { name: "syntax app.js", cmd: "node", args: ["--check", "app.js"] },
  { name: "syntax extra-kit", cmd: "node", args: ["--check", "lib/extra-kit.js"] },
  { name: "syntax extra-media", cmd: "node", args: ["--check", "lib/extra-media.js"] },
  { name: "syntax extra-bootstrap", cmd: "node", args: ["--check", "lib/extra-bootstrap.js"] },
  { name: "syntax lazy-scripts", cmd: "node", args: ["--check", "lib/lazy-scripts.js"] },
  { name: "extra bind audit", cmd: "node", args: ["scripts/extra-bind-audit.cjs"] },
  { name: "extra panel smoke", cmd: "node", args: ["extra-panel-smoke.cjs"] },
  { name: "markdown smoke", cmd: "node", args: ["markdown-smoke.cjs"] },
  { name: "registry verify", cmd: "node", args: ["scripts/verify-registry.cjs"] },
  { name: "pure tests", cmd: "node", args: ["test/pure.test.js"] },
  { name: "vbb plan tests", cmd: "node", args: ["vbb-plan.test.js"] },
  { name: "adb bridge smoke", cmd: "node", args: ["adb-bridge/smoke-check.js"] },
  { name: "ffmpeg bridge smoke", cmd: "node", args: ["ffmpeg-bridge/smoke-check.js"] },
];

let failed = 0;

for (const step of STEPS) {
  process.stdout.write(`→ ${step.name}… `);
  const res = spawnSync(step.cmd, step.args, {
    cwd: ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (res.status === 0) {
    console.log("OK");
    continue;
  }
  failed += 1;
  console.log("FAIL");
  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);
}

if (failed) {
  console.error(`\nci: ${failed}/${STEPS.length} 项失败`);
  process.exit(1);
}

console.log(`\nci: 全部 ${STEPS.length} 项通过`);
