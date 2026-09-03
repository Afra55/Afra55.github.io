#!/usr/bin/env node
/**
 * 读取本仓库 giscus 所需的 repo_id / category_id，并写回配置。
 * 前置：仓库已开启 Discussions；已安装 https://github.com/apps/giscus
 *
 * 用法：node tools/scripts/fetch-giscus-ids.cjs [categoryName]
 * 默认分类：Announcements（博客评论推荐；仅维护者与 giscus 可开新帖）
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const OWNER = "Afra55";
const REPO = "Afra55.github.io";
const WANT = process.argv[2] || "Announcements";

const query = `query {
  repository(owner: "${OWNER}", name: "${REPO}") {
    id
    hasDiscussionsEnabled
    discussionCategories(first: 20) {
      nodes { id name slug }
    }
  }
}`;

let raw;
try {
  raw = execFileSync("gh", ["api", "graphql", "-f", `query=${query}`], {
    encoding: "utf8",
  });
} catch (err) {
  console.error("gh api 失败，请确认已登录且有权读取该仓库。", err.message || err);
  process.exit(1);
}

const data = JSON.parse(raw)?.data?.repository;
if (!data) {
  console.error("无法解析 GraphQL 响应");
  process.exit(1);
}
if (!data.hasDiscussionsEnabled) {
  console.error("仓库尚未开启 Discussions：Settings → General → Features → Discussions");
  process.exit(1);
}

const cats = data.discussionCategories?.nodes || [];
const hit =
  cats.find((c) => c.name === WANT) ||
  cats.find((c) => /announcement/i.test(c.name)) ||
  cats.find((c) => /general/i.test(c.name)) ||
  cats[0];

if (!hit) {
  console.error("未找到 Discussion 分类。现有：", cats);
  process.exit(1);
}

const repoId = data.id;
const category = hit.name;
const categoryId = hit.id;

console.log("repo_id:", repoId);
console.log("category:", category);
console.log("category_id:", categoryId);

const ymlPath = path.join(ROOT, "_config.yml");
let yml = fs.readFileSync(ymlPath, "utf8");
if (!/giscus:\s*\n/.test(yml)) {
  console.error("_config.yml 缺少 giscus 段，请先合入 giscus 改动。");
  process.exit(1);
}
yml = yml
  .replace(/^(  repo_id:\s*).*$/m, `$1"${repoId}"`)
  .replace(/^(  category:\s*).*$/m, `$1"${category}"`)
  .replace(/^(  category_id:\s*).*$/m, `$1"${categoryId}"`);
fs.writeFileSync(ymlPath, yml);

const jsPath = path.join(ROOT, "tools/lib/giscus-config.js");
let js = fs.readFileSync(jsPath, "utf8");
js = js
  .replace(/repoId:\s*"[^"]*"/, `repoId: "${repoId}"`)
  .replace(/category:\s*"[^"]*"/, `category: "${category}"`)
  .replace(/categoryId:\s*"[^"]*"/, `categoryId: "${categoryId}"`);
fs.writeFileSync(jsPath, js);

console.log("已写入 _config.yml 与 tools/lib/giscus-config.js");
console.log("记得 bump 版本并提交。");
