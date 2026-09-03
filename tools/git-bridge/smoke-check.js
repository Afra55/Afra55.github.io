#!/usr/bin/env node
"use strict";

const http = require("http");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const SERVER = path.join(__dirname, "server.js");
const PORT = 17991;
const TOKEN = "devtools-git";

function req(method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request(
      {
        host: "127.0.0.1",
        port: PORT,
        path: urlPath,
        method,
        headers: {
          "X-Git-Token": TOKEN,
          ...(data
            ? { "Content-Type": "application/json", "Content-Length": data.length }
            : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = { raw: text };
          }
          resolve({ status: res.statusCode, json });
        });
      }
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

async function main() {
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, GIT_BRIDGE_PORT: String(PORT), GIT_BRIDGE_TOKEN: TOKEN },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let boot = "";
  child.stdout.on("data", (d) => {
    boot += d;
  });
  child.stderr.on("data", (d) => {
    boot += d;
  });

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 100));
    try {
      const h = await req("GET", "/health");
      if (h.status === 200 && h.json.ok) break;
    } catch {
      /* wait */
    }
    if (i === 39) {
      child.kill();
      throw new Error("bridge did not start: " + boot);
    }
  }

  const health = await req("GET", "/health");
  if (!health.json.git) throw new Error("git missing on host");

  const opened = await req("POST", "/repo/open", { path: ROOT });
  if (opened.status !== 200 || !opened.json.repo) throw new Error("open failed: " + JSON.stringify(opened.json));

  const graph = await req("GET", `/repo/graph?repo=${encodeURIComponent(opened.json.repo)}&max=30`);
  if (!graph.json.commits || !graph.json.commits.length) throw new Error("empty graph");

  const sha = graph.json.commits[0].hash;
  const explain = await req("GET", `/repo/explain?repo=${encodeURIComponent(opened.json.repo)}&sha=${sha}`);
  if (!explain.json.bullets || !explain.json.bullets.length) throw new Error("explain empty");

  const status = await req("POST", "/repo/exec", {
    repo: opened.json.repo,
    op: "status",
    params: {},
  });
  if (status.status !== 200 || !status.json.ok) throw new Error("status op failed");

  const denied = await req("POST", "/repo/exec", {
    repo: opened.json.repo,
    op: "rm-rf",
    params: {},
  });
  if (denied.status === 200) throw new Error("dangerous op should be denied");

  console.log("git-bridge smoke OK", {
    version: health.json.version,
    commits: graph.json.commits.length,
    explain: explain.json.bullets[0].text.slice(0, 40),
    cmd: (status.json.cmd || []).join(" "),
  });
  child.kill();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
