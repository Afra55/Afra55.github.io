#!/usr/bin/env node
"use strict";

const http = require("http");
const path = require("path");
const os = require("os");
const fs = require("fs");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "../..");
const SERVER = path.join(__dirname, "server.js");
const PORT = Number(process.env.GIT_BRIDGE_PORT || 17991);
const TOKEN = process.env.GIT_BRIDGE_TOKEN || "devtools-bridge";

const { listOps, listOpsCatalog, buildOp } = require("./git-ops");

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
  const ops = listOps();
  if (ops.length < 80) throw new Error("ops catalog too small: " + ops.length);
  if (!ops.includes("status") || !ops.includes("log-graph")) throw new Error("missing core ops");
  try {
    buildOp("rm-rf", {});
    throw new Error("illegal op should be rejected");
  } catch (e) {
    if (String(e.message).includes("should be rejected")) throw e;
  }
  const catalog = listOpsCatalog();
  if (!catalog.groups || !catalog.groups.length) throw new Error("empty catalog groups");

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

  try {
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        const h = await req("GET", "/health");
        if (h.status === 200 && h.json.ok) break;
      } catch {
        /* wait */
      }
      if (i === 39) {
        throw new Error("bridge did not start: " + boot);
      }
    }

    const health = await req("GET", "/health");
    if (!health.json.git) throw new Error("git missing on host");
    if (health.json.version !== "0.2.9") {
      throw new Error("unexpected version " + health.json.version);
    }

  const remoteOps = await req("GET", "/repo/ops");
  if (remoteOps.status !== 200 || (remoteOps.json.ops || []).length < 80) {
    throw new Error("GET /repo/ops failed: " + JSON.stringify(remoteOps.json));
  }
  for (const need of [
    "pull-merge",
    "reset-hard-upstream",
    "format-patch",
    "am",
    "reset-soft-n",
    "commit-amend",
    "push-gerrit",
    "gerrit-config-push",
    "branch-set-upstream",
  ]) {
    if (!(remoteOps.json.ops || []).includes(need)) throw new Error("missing op " + need);
  }

    const opened = await req("POST", "/repo/open", { path: ROOT });
    if (opened.status !== 200 || !opened.json.repo) throw new Error("open failed: " + JSON.stringify(opened.json));

    const graph = await req("GET", `/repo/graph?repo=${encodeURIComponent(opened.json.repo)}&max=30`);
    if (!graph.json.commits || !graph.json.commits.length) throw new Error("empty graph");

    const branches = await req("GET", `/repo/branches?repo=${encodeURIComponent(opened.json.repo)}`);
    if (branches.status !== 200 || !Array.isArray(branches.json.local) || !branches.json.local.length) {
      throw new Error("branches local missing: " + JSON.stringify(branches.json));
    }
    const cur = branches.json.local.find((b) => b.current) || branches.json.local[0];
    if (!("ahead" in cur) || !("behind" in cur)) {
      throw new Error("branch track stats missing: " + JSON.stringify(cur));
    }

    const sha = graph.json.commits[0].hash;
    const explain = await req("GET", `/repo/explain?repo=${encodeURIComponent(opened.json.repo)}&sha=${sha}`);
    if (!explain.json.bullets || !explain.json.bullets.length) throw new Error("explain empty");

    const status = await req("POST", "/repo/exec", {
      repo: opened.json.repo,
      op: "status",
      params: {},
    });
    if (status.status !== 200 || !status.json.ok) throw new Error("status op failed");

    const st = await req("GET", `/repo/status?repo=${encodeURIComponent(opened.json.repo)}`);
    if (st.status !== 200 || !Array.isArray(st.json.plainSteps)) throw new Error("status plainSteps missing");
    if (!("conflicts" in st.json) || !("changes" in st.json)) throw new Error("status structured fields missing");

    // 路径含空格 + 重命名：porcelain -z 解析必须正确
    const spaceTmp = fs.mkdtempSync(path.join(os.tmpdir(), "gitbridge-space-"));
    const spaceRepo = path.join(spaceTmp, "repo");
    fs.mkdirSync(spaceRepo);
    const { execFileSync } = require("child_process");
    execFileSync("git", ["init"], { cwd: spaceRepo });
    execFileSync("git", ["config", "user.email", "smoke@test"], { cwd: spaceRepo });
    execFileSync("git", ["config", "user.name", "smoke"], { cwd: spaceRepo });
    fs.writeFileSync(path.join(spaceRepo, "old name.txt"), "a\n");
    execFileSync("git", ["add", "old name.txt"], { cwd: spaceRepo });
    execFileSync("git", ["commit", "-m", "init"], { cwd: spaceRepo });
    execFileSync("git", ["mv", "old name.txt", "new name.txt"], { cwd: spaceRepo });
    fs.writeFileSync(path.join(spaceRepo, "file with spaces.txt"), "new\n");
    const spaceOpen = await req("POST", "/repo/open", { path: spaceRepo });
    if (spaceOpen.status !== 200) throw new Error("space repo open failed");
    const spaceSt = await req("GET", `/repo/status?repo=${encodeURIComponent(spaceOpen.json.repo)}`);
    if (spaceSt.status !== 200) throw new Error("space status failed");
    const paths = (spaceSt.json.changes || []).map((c) => c.path);
    if (!paths.includes("new name.txt")) {
      throw new Error("rename path with spaces not parsed: " + JSON.stringify(spaceSt.json.changes));
    }
    if (!paths.includes("file with spaces.txt")) {
      throw new Error("untracked path with spaces not parsed: " + JSON.stringify(spaceSt.json.changes));
    }
    if (paths.some((p) => p.includes("R100") || /^\d+$/.test(p))) {
      throw new Error("rename score leaked into path: " + JSON.stringify(paths));
    }
    fs.rmSync(spaceTmp, { recursive: true, force: true });

    // 裸 push 不得带 branch-only 参数
    const barePush = buildOp("push", {});
    if (barePush.argv.join(" ") !== "push") throw new Error("bare push should be just `push`: " + barePush.argv.join(" "));
    const leaseBare = buildOp("push-lease", {});
    if (leaseBare.argv.join(" ") !== "push --force-with-lease") {
      throw new Error("bare push-lease wrong: " + leaseBare.argv.join(" "));
    }
    try {
      buildOp("push", { branch: "main" });
      throw new Error("push branch-only should be rejected");
    } catch (e) {
      if (String(e.message).includes("should be rejected")) throw e;
    }
    const gerritPush = buildOp("push-gerrit", { branch: "master", remote: "origin" });
    if (!String(gerritPush.argv.join(" ")).includes("refs/for/master")) {
      throw new Error("push-gerrit dest wrong: " + gerritPush.argv.join(" "));
    }

    const readme = await req(
      "GET",
      `/repo/read-file?repo=${encodeURIComponent(opened.json.repo)}&path=${encodeURIComponent("AGENTS.md")}`
    );
    if (readme.status !== 200 || !readme.json.content) throw new Error("read-file failed");

    const diffFile = await req(
      "GET",
      `/repo/diff-file?repo=${encodeURIComponent(opened.json.repo)}&path=${encodeURIComponent("AGENTS.md")}`
    );
    if (diffFile.status !== 200 || !("diff" in diffFile.json)) throw new Error("diff-file failed");

    const logGraph = await req("POST", "/repo/exec", {
      repo: opened.json.repo,
      op: "log-graph",
      params: { max: 8 },
    });
    if (logGraph.status !== 200 || !logGraph.json.ok) throw new Error("log-graph failed");

    const denied = await req("POST", "/repo/exec", {
      repo: opened.json.repo,
      op: "rm-rf",
      params: {},
    });
    if (denied.status === 200) throw new Error("dangerous op should be denied");

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "gitbridge-init-"));
    const inited = await req("POST", "/repo/init", { path: tmp });
    if (inited.status !== 200 || !inited.json.ok) throw new Error("init failed: " + JSON.stringify(inited.json));
    fs.rmSync(tmp, { recursive: true, force: true });

    const badClone = await req("POST", "/repo/clone", { url: "file:///etc/passwd", dir: os.tmpdir() });
    if (badClone.status !== 400) throw new Error("clone should reject file:// : " + JSON.stringify(badClone));

    const shellClone = await req("POST", "/repo/clone", { url: "https://example.com/x.git\n-u", dir: os.tmpdir() });
    if (shellClone.status === 200) throw new Error("clone should reject newline in url");

    console.log("git-bridge smoke OK", {
      version: health.json.version,
      ops: remoteOps.json.ops.length,
      commits: graph.json.commits.length,
      explain: explain.json.bullets[0].text.slice(0, 40),
      cmd: (status.json.cmd || []).join(" "),
    });
  } finally {
    child.kill();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
