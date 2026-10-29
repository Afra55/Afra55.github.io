"use strict";

/** 安全擦除：护栏 + 文件/文件夹混选覆写删除 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { assertSafeTarget, purgePaths, inspectPaths } = require("../fileunlock-bridge/purge-ops.js");

let n = 0;

async function t(name, fn) {
  await fn();
  n += 1;
  console.log("ok", name);
}

(async () => {
  await t("拒绝盘符根与系统顶层", () => {
    if (process.platform === "win32") {
      assert.throws(() => assertSafeTarget("C:\\"), /拒绝/);
      assert.throws(() => assertSafeTarget("C:\\Windows"), /拒绝/);
      assert.throws(() => assertSafeTarget("C:\\Windows\\System32\\drivers"), /拒绝/);
      assert.throws(() => assertSafeTarget("C:\\Users"), /拒绝/);
    } else {
      assert.throws(() => assertSafeTarget("/"), /拒绝/);
    }
  });

  await t("inspect 混选文件与目录", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fp-inspect-"));
    const file = path.join(dir, "a.txt");
    fs.writeFileSync(file, "hello");
    const items = await inspectPaths([file, dir]);
    assert.strictEqual(items.length, 2);
    assert.ok(items.some((i) => i.kind === "file"));
    assert.ok(items.some((i) => i.kind === "dir"));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  await t("purge 混选：文件+文件夹覆写后消失", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "fp-purge-"));
    const file = path.join(root, "solo.bin");
    const folder = path.join(root, "folder");
    const nested = path.join(folder, "nested.txt");
    fs.mkdirSync(folder);
    const marker = "SECRET-MARKER-" + Date.now();
    fs.writeFileSync(file, marker);
    fs.writeFileSync(nested, marker + "-NESTED");

    const report = await purgePaths([file, folder], { passes: 1 });
    assert.strictEqual(report.failed, 0, JSON.stringify(report));
    assert.ok(!fs.existsSync(file));
    assert.ok(!fs.existsSync(folder));
    assert.ok(!fs.existsSync(nested));
    fs.rmSync(root, { recursive: true, force: true });
  });

  console.log(`forcepurge-ops.test.js: ${n} passed`);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
