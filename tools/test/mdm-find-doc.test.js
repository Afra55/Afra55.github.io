#!/usr/bin/env node
"use strict";

/**
 * MDM findMdmDocFile：只按 hintDirs 探测，禁止全盘/常见目录 walk。
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ff = require(path.join(__dirname, "..", "ffmpeg-bridge", "server.js"));

let n = 0;
function t(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      n += 1;
    });
}

async function main() {
  assert.equal(typeof ff.findMdmDocFile, "function");
  assert.equal(typeof ff.pickLocalDirectory, "function");

  await t("无 hint 应快速失败且提示不扫盘", async () => {
    const t0 = Date.now();
    let err = null;
    try {
      await ff.findMdmDocFile({ folderName: "notes", fileName: "a.md", hintDirs: [] });
    } catch (e) {
      err = e;
    }
    assert.ok(err, "应抛错");
    assert.ok(/未提供|记住|不.*扫/.test(String(err.message)), err.message);
    assert.ok(Date.now() - t0 < 2000, `无 hint 应很快失败，实际 ${Date.now() - t0}ms`);
  });

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdm-find-"));
  try {
    const lib = path.join(root, "notes");
    fs.mkdirSync(lib);
    const file = path.join(lib, "hello.md");
    fs.writeFileSync(file, "# hi\n");

    await t("hint 为库目录时直接命中", async () => {
      const found = await ff.findMdmDocFile({
        folderName: "notes",
        fileName: "hello.md",
        hintDirs: [lib],
      });
      assert.strictEqual(path.resolve(found), path.resolve(file));
    });

    await t("hint 为父目录时拼 folderName 命中", async () => {
      const found = await ff.findMdmDocFile({
        folderName: "notes",
        fileName: "hello.md",
        hintDirs: [root],
      });
      assert.strictEqual(path.resolve(found), path.resolve(file));
    });

    await t("错误 hint 应快速失败（不扫家目录）", async () => {
      const t0 = Date.now();
      let err = null;
      try {
        await ff.findMdmDocFile({
          folderName: "notes",
          fileName: "hello.md",
          hintDirs: [path.join(root, "missing-dir")],
        });
      } catch (e) {
        err = e;
      }
      assert.ok(err);
      assert.ok(Date.now() - t0 < 2000, `错误 hint 应很快失败，实际 ${Date.now() - t0}ms`);
    });

    await t("非法文件名拒绝", async () => {
      let err = null;
      try {
        await ff.findMdmDocFile({ folderName: "notes", fileName: "../x.md", hintDirs: [lib] });
      } catch (e) {
        err = e;
      }
      assert.ok(err);
      assert.ok(/非法/.test(String(err.message)));
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }

  // 源码守卫：findMdmDocFile 函数体内不得再出现 walk/maxScan/盘符种子
  await t("源码无全盘 walk", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "ffmpeg-bridge", "server.js"), "utf8");
    const start = src.indexOf("async function findMdmDocFile");
    const end = src.indexOf("async function revealLocalPath");
    assert.ok(start >= 0 && end > start, "定位 findMdmDocFile 失败");
    const body = src.slice(start, end);
    assert.ok(!/async function walk\b/.test(body), "不应再有 walk");
    assert.ok(!/\bmaxScan\b/.test(body), "不应再有 maxScan");
    assert.ok(!/OneDrive|CDEFGHIJKLMNOPQRSTUVWXYZ/.test(body), "不应再有盘符/OneDrive 种子");
  });

  console.log(`mdm-find-doc.test: ${n} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
