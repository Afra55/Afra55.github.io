#!/usr/bin/env node
"use strict";

/**
 * 拉取仓库 Discussions 快照，供评价汇总页离线回退。
 * 用法：node tools/scripts/fetch-giscus-discussions.cjs
 * 需要本机已登录 gh（或设置 GITHUB_TOKEN）。
 */

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const ROOT = path.join(__dirname, "..", "..");
const OUT = path.join(ROOT, "tools", "data", "giscus-discussions.json");

const query = `query {
  repository(owner: "Afra55", name: "Afra55.github.io") {
    discussions(first: 100, orderBy: { field: UPDATED_AT, direction: DESC }) {
      nodes {
        number
        title
        url
        createdAt
        updatedAt
        bodyText
        comments { totalCount }
        category { name }
        author { login }
      }
    }
  }
}`;

function main() {
  let raw;
  if (process.env.GITHUB_TOKEN) {
    raw = execFileSync(
      "curl",
      [
        "-sS",
        "-H",
        `Authorization: bearer ${process.env.GITHUB_TOKEN}`,
        "-H",
        "Content-Type: application/json",
        "-d",
        JSON.stringify({ query }),
        "https://api.github.com/graphql",
      ],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }
    );
  } else {
    raw = execFileSync("gh", ["api", "graphql", "-f", `query=${query}`], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
  }
  const data = JSON.parse(raw);
  if (data.errors?.length) {
    throw new Error(data.errors.map((e) => e.message).join("; "));
  }
  const nodes = data.data?.repository?.discussions?.nodes || [];
  const payload = {
    generatedAt: new Date().toISOString(),
    repo: "Afra55/Afra55.github.io",
    count: nodes.length,
    nodes,
  };
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
  console.log(`wrote ${OUT} (${nodes.length} discussions)`);
}

main();
