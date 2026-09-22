#!/usr/bin/env node
/**
 * 重新打包 tools/vendor/mdext/mdext.js（markdown-it 插件集合）。
 *
 * 用途：升级 markdown-it / 插件版本（例如 markdown-it-deflist 3.x → 4.0.0）后重建 bundle。
 * 仓库没有打包器，所以这里按需在临时目录装依赖再 esbuild 打包（与 *-smoke.cjs 的做法一致）。
 *
 * 用法：
 *   node tools/scripts/build-mdext.cjs            # 打包并覆盖 vendor/mdext/mdext.js
 *   node tools/scripts/build-mdext.cjs --dry-run  # 只打包到临时目录，并对比新旧渲染差异
 *
 * 打包产物：IIFE，挂到 globalThis.markdownItExtras = { footnote, deflist, emoji, mark, abbr, sub, sup }
 * 注意：emoji 用 markdown-it-emoji 的 full 数据集（与原 bundle 行为一致，勿改成 bare）。
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..", "..");
const OUT = path.join(ROOT, "tools", "vendor", "mdext", "mdext.js");
const DRY = process.argv.includes("--dry-run");

const DEPS = {
  esbuild: "^0.28.2",
  "markdown-it": "^15.0.2",
  "markdown-it-footnote": "^4.0.0",
  "markdown-it-deflist": "^4.0.0",
  "markdown-it-emoji": "^3.1.0",
  "markdown-it-mark": "^4.0.0",
  "markdown-it-abbr": "^2.0.0",
  "markdown-it-sub": "^2.0.0",
  "markdown-it-sup": "^2.0.0",
};

const ENTRY = `import footnote from "markdown-it-footnote";
import deflist from "markdown-it-deflist";
import { full as emoji } from "markdown-it-emoji";
import mark from "markdown-it-mark";
import abbr from "markdown-it-abbr";
import sub from "markdown-it-sub";
import sup from "markdown-it-sup";

globalThis.markdownItExtras = { footnote, deflist, emoji, mark, abbr, sub, sup };
`;

const BUILD = `import esbuild from "esbuild";
await esbuild.build({
  entryPoints: ["entry.mjs"],
  bundle: true,
  format: "iife",
  minify: true,
  target: "es2020",
  outfile: "mdext.js",
});
`;

function main() {
  const dir = path.join(os.tmpdir(), "devtools-mdext-build");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "mdext-build", private: true, type: "module", dependencies: DEPS }, null, 2));
  fs.writeFileSync(path.join(dir, "entry.mjs"), ENTRY);
  fs.writeFileSync(path.join(dir, "build.mjs"), BUILD);

  console.log("[mdext] 安装依赖…");
  execSync("npm install", { cwd: dir, stdio: "inherit" });

  console.log("[mdext] 打包…");
  execSync("node build.mjs", { cwd: dir, stdio: "inherit" });

  const built = path.join(dir, "mdext.js");
  const size = fs.statSync(built).size;
  console.log(`[mdext] 产物 ${size} 字节`);

  if (DRY) {
    console.log(`[mdext] --dry-run：未覆盖。产物在 ${built}`);
    console.log("[mdext] 提示：用 Node 分别 require 新旧 bundle 渲染同一批 markdown 对比输出即可验证。");
    return;
  }
  const before = fs.existsSync(OUT) ? fs.statSync(OUT).size : 0;
  fs.copyFileSync(built, OUT);
  console.log(`[mdext] 已写入 ${path.relative(ROOT, OUT)}（${before} → ${size} 字节）`);
  console.log("[mdext] 记得：bump tools/lib/lazy-scripts.js 的 VENDOR_V，并同步 tools/lib/oss-deps.js 版本号。");
}

main();
