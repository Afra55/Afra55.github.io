#!/usr/bin/env node
"use strict";

/**
 * 架构卫生检查：v2g-suite 分片一致性、SW 大资源旁路、媒体并行导出口。
 * 用法：node tools/scripts/verify-arch.cjs
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const TOOLS = path.resolve(__dirname, "..");
let failed = 0;

function fail(msg) {
  console.error(`verify-arch: FAIL  ${msg}`);
  failed += 1;
}

function ok(msg) {
  console.log(`verify-arch: ok    ${msg}`);
}

function read(rel) {
  return fs.readFileSync(path.join(TOOLS, rel), "utf8");
}

function main() {
  // 1) v2g-suite src ≡ built
  try {
    execFileSync(process.execPath, [path.join(__dirname, "build-v2g-suite.cjs"), "--check"], {
      stdio: "pipe",
    });
    ok("v2g-suite src ≡ extra-panels/v2g-suite.js");
  } catch (err) {
    fail(`v2g-suite build check: ${err.stderr?.toString() || err.message}`);
  }

  // 2) 关键符号仍在拼接产物里（防拆分丢段）
  const suite = read("extra-panels/v2g-suite.js");
  for (const needle of [
    "async function encodeBlackboxClip(",
    "async function runVbbBatchBlackbox(",
    "function resolveBatchConcurrency(",
    'bindPanel("v2g"',
    'bindPanel("vsplit"',
    'bindPanel("vbb"',
    "createFfmpegInstance",
    "withGifskiEncodeLock",
  ]) {
    if (!suite.includes(needle)) fail(`v2g-suite missing symbol/marker: ${needle}`);
  }
  if (!failed) ok("v2g-suite key markers present");

  // 3) SW 旁路大资源（源码是正则字面量：\/health-articles\/ 等）
  const sw = read("sw.js");
  for (const needle of ["health-articles", "assets\\/ambient", "lib\\/health-articles"]) {
    if (!sw.includes(needle)) fail(`sw.js missing bypass marker: ${needle}`);
  }
  if (!/function shouldBypass[\s\S]*health-articles[\s\S]*function shouldCacheResponse/.test(sw)) {
    fail("sw shouldBypass must mention health-articles before shouldCacheResponse");
  }
  if (!/function shouldCacheResponse[\s\S]*health-articles/.test(sw)) {
    fail("sw shouldCacheResponse must refuse health-articles");
  }
  if (!failed) ok("sw.js bypasses health-articles + ambient");

  // 4) 媒体核导出并行 API
  const media = read("lib/extra-media.js");
  for (const needle of ["createFfmpegInstance", "destroyFfmpegInstance", "batchConcurrency", "ffmpegInputCacheByInstance"]) {
    if (!media.includes(needle)) fail(`extra-media missing ${needle}`);
  }
  if (!failed) ok("extra-media parallel/pool APIs present");

  // 5) 语法
  for (const rel of [
    "extra-panels/v2g-suite.js",
    "lib/extra-media.js",
    "lib/lazy-scripts.js",
    "sw.js",
  ]) {
    try {
      execFileSync(process.execPath, ["--check", path.join(TOOLS, rel)], { stdio: "pipe" });
    } catch (err) {
      fail(`syntax ${rel}: ${err.message}`);
    }
  }
  if (!failed) ok("syntax checks");

  if (failed) {
    console.error(`verify-arch: ${failed} failure(s)`);
    process.exit(1);
  }
  console.log("verify-arch: all checks passed");
}

main();
