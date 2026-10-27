#!/usr/bin/env node
"use strict";

const { spawnSync } = require("child_process");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");

const STEPS = [
  { name: "syntax app.js", cmd: "node", args: ["--check", "app.js"] },
  { name: "syntax extra-kit", cmd: "node", args: ["--check", "lib/extra-kit.js"] },
  { name: "syntax extra-media", cmd: "node", args: ["--check", "lib/extra-media.js"] },
  { name: "syntax v2g-suite", cmd: "node", args: ["--check", "extra-panels/v2g-suite.js"] },
  { name: "syntax extra-bootstrap", cmd: "node", args: ["--check", "lib/extra-bootstrap.js"] },
  { name: "syntax lazy-scripts", cmd: "node", args: ["--check", "lib/lazy-scripts.js"] },
  { name: "syntax all js", cmd: "node", args: ["scripts/check-syntax.cjs"] },
  { name: "arch verify", cmd: "node", args: ["scripts/verify-arch.cjs"] },
  { name: "extra bind audit", cmd: "node", args: ["scripts/extra-bind-audit.cjs"] },
  { name: "extra media import audit", cmd: "node", args: ["scripts/extra-media-import-audit.cjs"] },
  { name: "extra panel smoke", cmd: "node", args: ["extra-panel-smoke.cjs"] },
  { name: "piano smoke", cmd: "node", args: ["piano-smoke.cjs"] },
  { name: "markdown smoke", cmd: "node", args: ["markdown-smoke.cjs"] },
  { name: "registry verify", cmd: "node", args: ["scripts/verify-registry.cjs"] },
  { name: "pure tests", cmd: "node", args: ["test/pure.test.js"] },
  { name: "apidebug pure tests", cmd: "node", args: ["test/apidebug-pure.test.js"] },
  { name: "vbb plan tests", cmd: "node", args: ["vbb-plan.test.js"] },
  { name: "vbb blackbox fps", cmd: "node", args: ["vbb-blackbox-fps.test.js"] },
  { name: "vbb auto crop", cmd: "node", args: ["vbb-auto-crop.test.js"] },
  { name: "mdm smoke", cmd: "node", args: ["mdm-smoke.cjs"] },
  { name: "mdm tests", cmd: "node", args: ["test/mdm.test.js"] },
  { name: "mdm find-doc tests", cmd: "node", args: ["test/mdm-find-doc.test.js"] },
  { name: "mdm mermaid zoom", cmd: "node", args: ["test/mdm-mermaid-zoom.test.js"] },
  { name: "mdm mermaid error", cmd: "node", args: ["test/mdm-mermaid-error.test.js"] },
  { name: "mdm mermaid offscreen probe", cmd: "node", args: ["scripts/mdm-mermaid-offscreen-probe.cjs"] },
  { name: "enspeak content", cmd: "node", args: ["test/enspeak-content.test.js"] },
  { name: "mineru image-min tokens", cmd: "node", args: ["test/mineru-image-min-tokens.test.js"] },
  { name: "bridge busy relaunch", cmd: "node", args: ["test/bridge-busy-relaunch.test.js"] },
  { name: "qrcode long text", cmd: "node", args: ["test/qrcode-long-text.test.js"] },
  { name: "qrcode decode roundtrip", cmd: "node", args: ["test/qrcode-decode-roundtrip.test.js"] },
  { name: "qr series stitch", cmd: "node", args: ["test/qr-series.test.js"] },
  { name: "imgrecolor birefnet", cmd: "node", args: ["test/imgrecolor-birefnet.test.js"] },
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
