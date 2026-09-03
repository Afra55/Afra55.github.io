#!/usr/bin/env node
"use strict";

/**
 * DevTools local Git bridge
 * - Bind 127.0.0.1 only
 * - Zero npm dependencies
 * - Shell-less: execFile("git", …) only, whitelisted ops
 */

const http = require("http");
const { URL } = require("url");
const { execFile } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const HOST = "127.0.0.1";
const PORT = Number(process.env.GIT_BRIDGE_PORT || 17890);
const TOKEN = String(process.env.GIT_BRIDGE_TOKEN || "devtools-git");
const ACCEPTED_TOKENS = new Set(
  [TOKEN, "devtools-git", "devtools-bridge"].map(String).filter(Boolean)
);
const ALLOWED_ORIGINS = new Set(
  String(
    process.env.GIT_BRIDGE_ORIGINS ||
      [
        "https://afra55.github.io",
        "http://127.0.0.1:8080",
        "http://localhost:8080",
        "http://127.0.0.1:5500",
        "http://localhost:5500",
        "http://127.0.0.1:8765",
        "http://localhost:8765",
      ].join(",")
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
);

const { buildOp, listOpsCatalog } = require("./git-ops");

const BRIDGE_VERSION = "0.2.0";
const FEATURES = [
  "fs-browse","repo-open","repo-init","repo-clone","graph","branches",
  "status","commit-detail","explain","ops-catalog","ops-full"
];

const GIT_TIMEOUT_MS = 120000;
const MAX_GRAPH = 500;

function sendJson(res, status, data, origin) {
  const body = JSON.stringify(data);
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  };
  applyCors(headers, origin);
  res.writeHead(status, headers);
  res.end(body);
}

function applyCors(headers, origin) {
  const ok =
    origin &&
    (ALLOWED_ORIGINS.has(origin) ||
      /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin));
  if (ok) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
    headers["Access-Control-Allow-Headers"] =
      "Content-Type, X-Git-Token, X-Adb-Token, X-Ffmpeg-Token";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Private-Network"] = "true";
  }
}

function readBody(req, limit = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("请求体过大"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseJsonBody(buf) {
  const text = Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf || "");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function requireToken(req) {
  const h =
    req.headers["x-git-token"] ||
    req.headers["x-adb-token"] ||
    req.headers["x-ffmpeg-token"] ||
    "";
  return ACCEPTED_TOKENS.has(String(h).trim());
}

function git(repo, args, opts = {}) {
  const cwd = repo || process.cwd();
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      {
        cwd,
        encoding: "utf8",
        maxBuffer: opts.maxBuffer || 16 * 1024 * 1024,
        timeout: opts.timeout || GIT_TIMEOUT_MS,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" },
      },
      (err, stdout, stderr) => {
        if (err) {
          const msg = String(stderr || err.message || "git 失败").trim();
          const e = new Error(msg || "git 失败");
          e.code = err.code;
          e.stdout = stdout;
          e.stderr = stderr;
          e.cmd = ["git", ...args];
          reject(e);
          return;
        }
        resolve({ stdout: String(stdout || ""), stderr: String(stderr || ""), cmd: ["git", ...args] });
      }
    );
  });
}

function safePath(input) {
  if (!input || typeof input !== "string") throw Object.assign(new Error("缺少路径"), { status: 400 });
  const resolved = path.resolve(input);
  if (resolved.includes("\0")) throw Object.assign(new Error("非法路径"), { status: 400 });
  return resolved;
}

function assertNoShellMeta(s) {
  if (/[\r\n\0]/.test(s)) throw Object.assign(new Error("参数含非法字符"), { status: 400 });
}

async function resolveRepoRoot(inputPath) {
  const p = safePath(inputPath);
  if (!fs.existsSync(p)) throw Object.assign(new Error("路径不存在"), { status: 404 });
  const r = await git(p, ["rev-parse", "--show-toplevel"]);
  const root = path.resolve(String(r.stdout).trim());
  if (!root || !fs.existsSync(path.join(root, ".git")) && !fs.existsSync(root)) {
    // bare or worktree: rev-parse succeeded is enough
  }
  return root;
}

function isGitDir(dir) {
  try {
    const gitPath = path.join(dir, ".git");
    if (fs.existsSync(gitPath)) return true;
    return false;
  } catch {
    return false;
  }
}

function listRoots() {
  const home = os.homedir();
  const roots = [{ id: "home", label: "主目录", path: home }];
  if (process.platform === "win32") {
    for (const letter of "CDEFG") {
      const drive = `${letter}:\\`;
      try {
        if (fs.existsSync(drive)) roots.push({ id: `drive-${letter}`, label: `${letter}:`, path: drive });
      } catch {
        /* ignore */
      }
    }
  } else {
    roots.push({ id: "root", label: "/", path: "/" });
    const vols = "/Volumes";
    if (fs.existsSync(vols)) roots.push({ id: "volumes", label: "Volumes", path: vols });
  }
  return roots;
}

function listDir(dirPath) {
  const dir = safePath(dirPath);
  const st = fs.statSync(dir);
  if (!st.isDirectory()) throw Object.assign(new Error("不是目录"), { status: 400 });
  const names = fs.readdirSync(dir);
  const entries = [];
  for (const name of names) {
    if (name === "." || name === "..") continue;
    if (name.startsWith(".") && name !== ".git") continue;
    const full = path.join(dir, name);
    let isDir = false;
    try {
      isDir = fs.statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (!isDir) continue;
    entries.push({
      name,
      path: full,
      isDir: true,
      isRepo: isGitDir(full),
    });
  }
  entries.sort((a, b) => {
    if (a.isRepo !== b.isRepo) return a.isRepo ? -1 : 1;
    return a.name.localeCompare(b.name, "zh");
  });
  return { path: dir, parent: path.dirname(dir), entries };
}

async function repoSummary(repo) {
  const cmds = {};
  const head = await git(repo, ["rev-parse", "--abbrev-ref", "HEAD"]).catch(() => ({ stdout: "HEAD" }));
  const sha = await git(repo, ["rev-parse", "HEAD"]).catch(() => ({ stdout: "" }));
  const status = await git(repo, ["status", "--porcelain=v1", "-b"]).catch((e) => ({ stdout: "", stderr: e.message }));
  const branchLines = String(status.stdout || "").split("\n");
  const branchHeader = branchLines[0] || "";
  const dirty = branchLines.slice(1).filter((l) => l.trim()).length;
  const remotes = await git(repo, ["remote", "-v"]).catch(() => ({ stdout: "" }));
  cmds.head = head.cmd;
  return {
    repo,
    head: String(head.stdout).trim(),
    headSha: String(sha.stdout).trim(),
    branchHeader,
    dirtyCount: dirty,
    remotes: String(remotes.stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean),
  };
}

async function repoBranches(repo) {
  const local = await git(repo, [
    "for-each-ref",
    "--sort=-committerdate",
    "--format=%(refname:short)%00%(objectname)%00%(upstream:short)%00%(HEAD)%00%(subject)",
    "refs/heads",
  ]);
  const remote = await git(repo, [
    "for-each-ref",
    "--sort=-committerdate",
    "--format=%(refname:short)%00%(objectname)%00%(subject)",
    "refs/remotes",
  ]);
  const tags = await git(repo, [
    "for-each-ref",
    "--sort=-creatordate",
    "--format=%(refname:short)%00%(objectname)%00%(subject)",
    "refs/tags",
    "--count=80",
  ]);

  function parseLocal(text) {
    return String(text || "")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, sha, upstream, headMark, subject] = line.split("\0");
        return {
          name,
          sha,
          upstream: upstream || "",
          current: headMark === "*",
          subject: subject || "",
          kind: "local",
        };
      });
  }
  function parseRemote(text) {
    return String(text || "")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, sha, subject] = line.split("\0");
        return { name, sha, subject: subject || "", kind: "remote" };
      });
  }
  function parseTags(text) {
    return String(text || "")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, sha, subject] = line.split("\0");
        return { name, sha, subject: subject || "", kind: "tag" };
      });
  }

  return {
    local: parseLocal(local.stdout),
    remote: parseRemote(remote.stdout),
    tags: parseTags(tags.stdout),
    cmd: local.cmd,
  };
}

async function repoGraph(repo, maxN) {
  const n = Math.min(MAX_GRAPH, Math.max(20, Number(maxN) || 120));
  const fmt = ["%H", "%P", "%an", "%ae", "%at", "%s", "%D"].join("%x00");
  const log = await git(repo, [
    "log",
    "--all",
    "--date-order",
    `-n${n}`,
    `--pretty=format:${fmt}`,
  ]);
  const commits = String(log.stdout || "")
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [hash, parents, author, email, at, subject, deco] = line.split("\0");
      const parentList = String(parents || "")
        .trim()
        .split(/\s+/)
        .filter(Boolean);
      const refs = String(deco || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      return {
        hash,
        short: hash.slice(0, 7),
        parents: parentList,
        author,
        email,
        timestamp: Number(at) || 0,
        subject,
        refs,
        isMerge: parentList.length > 1,
      };
    });

  const ascii = await git(repo, [
    "log",
    "--all",
    "--decorate",
    "--graph",
    "--oneline",
    "--date-order",
    `-n${Math.min(n, 80)}`,
  ]).catch(() => ({ stdout: "", cmd: ["git", "log", "--graph"] }));

  return { commits, ascii: ascii.stdout, cmd: log.cmd, limit: n };
}

async function repoStatus(repo) {
  const porcelain = await git(repo, ["status", "--porcelain=v2", "-b", "--untracked-files=all"]);
  const stash = await git(repo, ["stash", "list"]).catch(() => ({ stdout: "" }));
  return {
    porcelain: porcelain.stdout,
    stash: String(stash.stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean),
    cmd: porcelain.cmd,
  };
}

async function commitDetail(repo, sha) {
  assertNoShellMeta(sha);
  if (!/^[0-9a-fA-F]{4,40}$/.test(sha) && !/^[^\s]+$/.test(sha)) {
    throw Object.assign(new Error("非法 commit"), { status: 400 });
  }
  const show = await git(repo, [
    "show",
    "-s",
    "--format=%H%n%P%n%an%n%ae%n%at%n%cn%n%ce%n%ct%n%s%n%b",
    sha,
  ]);
  const lines = show.stdout.split("\n");
  const hash = lines[0] || "";
  const parents = String(lines[1] || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const subject = lines[8] || "";
  const body = lines.slice(9).join("\n").trim();
  const nameStatus = await git(repo, ["diff-tree", "--no-commit-id", "--name-status", "-r", hash]);
  const decorate = await git(repo, ["log", "-1", "--decorate=full", "--oneline", hash]);
  return {
    hash,
    short: hash.slice(0, 7),
    parents,
    author: lines[2],
    email: lines[3],
    timestamp: Number(lines[4]) || 0,
    committer: lines[5],
    subject,
    body,
    files: String(nameStatus.stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((row) => {
        const m = row.match(/^(\S+)\s+(.+)$/);
        return m ? { status: m[1], path: m[2] } : { status: "?", path: row };
      }),
    oneline: String(decorate.stdout || "").trim(),
    cmd: show.cmd,
  };
}

async function explainCommit(repo, sha) {
  const detail = await commitDetail(repo, sha);
  const bullets = [];
  const cmds = [detail.cmd];

  if (detail.parents.length > 1) {
    bullets.push({
      kind: "merge",
      text: `这是一次「合并提交」（merge）：它有 ${detail.parents.length} 个父提交，表示把多条线的历史合到一起。`,
    });
    for (let i = 0; i < detail.parents.length; i++) {
      const p = detail.parents[i];
      const name = await git(repo, ["name-rev", "--name-only", "--no-undefined", p]).catch(() => ({
        stdout: p.slice(0, 7),
      }));
      bullets.push({
        kind: "parent",
        text: `父提交 ${i + 1}：${p.slice(0, 7)}（${String(name.stdout).trim() || "无命名"}）`,
        sha: p,
      });
      cmds.push(name.cmd);
    }
  } else if (detail.parents.length === 1) {
    bullets.push({
      kind: "normal",
      text: `普通提交：只有 1 个父提交 ${detail.parents[0].slice(0, 7)}。图上通常是同一条线往前走一格。`,
      sha: detail.parents[0],
    });
  } else {
    bullets.push({ kind: "root", text: "这是仓库最早的提交之一（没有父提交）。" });
  }

  const contains = await git(repo, ["branch", "--contains", detail.hash, "--format=%(refname:short)"]).catch(
    () => ({ stdout: "" })
  );
  const branchList = String(contains.stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean);
  if (branchList.length) {
    bullets.push({
      kind: "branches",
      text: `这些本地分支的历史里包含它：${branchList.slice(0, 12).join("、")}${
        branchList.length > 12 ? "…" : ""
      }`,
    });
  }
  cmds.push(contains.cmd);

  const head = await git(repo, ["rev-parse", "HEAD"]);
  const headSha = String(head.stdout).trim();
  if (headSha === detail.hash) {
    bullets.push({ kind: "head", text: "你现在就在这个提交上（HEAD）。" });
  } else {
    const isAnc = await git(repo, ["merge-base", "--is-ancestor", detail.hash, "HEAD"])
      .then(() => true)
      .catch(() => false);
    const isDesc = await git(repo, ["merge-base", "--is-ancestor", "HEAD", detail.hash])
      .then(() => true)
      .catch(() => false);
    if (isAnc) {
      bullets.push({
        kind: "rel",
        text: "它在当前 HEAD 的「过去」：从那时一路走到了你现在的位置。",
      });
    } else if (isDesc) {
      bullets.push({
        kind: "rel",
        text: "当前 HEAD 在它的「过去」：这个提交在你当前位置的「未来」（例如别人推的更新，或你还没 checkout 的提交）。",
      });
    } else {
      const mb = await git(repo, ["merge-base", detail.hash, "HEAD"]).catch(() => ({ stdout: "" }));
      const base = String(mb.stdout).trim().slice(0, 7);
      bullets.push({
        kind: "rel",
        text: base
          ? `它和当前 HEAD 不在同一条直线上；最近共同祖先是 ${base}。要合起来通常用 merge 或 rebase。`
          : "它和当前 HEAD 似乎没有共同祖先（少见）。",
      });
      if (mb.cmd) cmds.push(mb.cmd);
    }
  }

  return {
    ...detail,
    bullets,
    containingBranches: branchList,
    cmds: cmds.filter(Boolean),
  };
}

async function runOp(repo, op, params) {
  const built = buildOp(op, params);
  const result = await git(repo, built.argv, built.maxBuffer ? { maxBuffer: built.maxBuffer } : {});
  return {
    ok: true,
    op,
    label: built.label,
    cmd: ["git", "-C", repo, ...built.argv],
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function handleRequest(req, res) {
  const origin = req.headers.origin || "";
  if (req.method === "OPTIONS") {
    const headers = {};
    applyCors(headers, origin);
    headers["Access-Control-Allow-Private-Network"] = "true";
    res.writeHead(204, headers);
    res.end();
    return;
  }

  let url;
  try {
    url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  } catch {
    sendJson(res, 400, { error: "坏请求" }, origin);
    return;
  }

  const pathname = url.pathname.replace(/\/+$/, "") || "/";

  try {
    if (pathname === "/health" && req.method === "GET") {
      let gitVer = "";
      try {
        const v = await git(process.cwd(), ["--version"]);
        gitVer = String(v.stdout).trim();
      } catch (e) {
        gitVer = "";
      }
      sendJson(
        res,
        200,
        {
          ok: true,
          service: "devtools-git-bridge",
          version: BRIDGE_VERSION,
          features: FEATURES,
          git: gitVer,
          port: PORT,
          defaultToken: "devtools-git",
        },
        origin
      );
      return;
    }

    if (!requireToken(req)) {
      sendJson(res, 401, { error: "Token 无效。请求头加 X-Git-Token: devtools-git" }, origin);
      return;
    }

    if (pathname === "/fs/roots" && req.method === "GET") {
      sendJson(res, 200, { roots: listRoots() }, origin);
      return;
    }

    if (pathname === "/fs/list" && req.method === "GET") {
      const dir = url.searchParams.get("path") || os.homedir();
      sendJson(res, 200, listDir(dir), origin);
      return;
    }

    if (pathname === "/repo/open" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req));
      const root = await resolveRepoRoot(body.path);
      const summary = await repoSummary(root);
      sendJson(res, 200, { ok: true, ...summary }, origin);
      return;
    }

    if (pathname === "/repo/summary" && req.method === "GET") {
      const repo = await resolveRepoRoot(url.searchParams.get("repo"));
      sendJson(res, 200, await repoSummary(repo), origin);
      return;
    }

    if (pathname === "/repo/graph" && req.method === "GET") {
      const repo = await resolveRepoRoot(url.searchParams.get("repo"));
      const max = url.searchParams.get("max");
      sendJson(res, 200, await repoGraph(repo, max), origin);
      return;
    }

    if (pathname === "/repo/branches" && req.method === "GET") {
      const repo = await resolveRepoRoot(url.searchParams.get("repo"));
      sendJson(res, 200, await repoBranches(repo), origin);
      return;
    }

    if (pathname === "/repo/status" && req.method === "GET") {
      const repo = await resolveRepoRoot(url.searchParams.get("repo"));
      sendJson(res, 200, await repoStatus(repo), origin);
      return;
    }

    if (pathname === "/repo/commit" && req.method === "GET") {
      const repo = await resolveRepoRoot(url.searchParams.get("repo"));
      const sha = url.searchParams.get("sha");
      sendJson(res, 200, await commitDetail(repo, sha), origin);
      return;
    }

    if (pathname === "/repo/explain" && req.method === "GET") {
      const repo = await resolveRepoRoot(url.searchParams.get("repo"));
      const sha = url.searchParams.get("sha");
      sendJson(res, 200, await explainCommit(repo, sha), origin);
      return;
    }

    if (pathname === "/repo/ops" && req.method === "GET") {
      sendJson(res, 200, listOpsCatalog(), origin);
      return;
    }

    if (pathname === "/repo/init" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req));
      const dir = safePath(body.path);
      fs.mkdirSync(dir, { recursive: true });
      const r = await git(dir, ["init"]);
      const root = await resolveRepoRoot(dir);
      const summary = await repoSummary(root);
      sendJson(res, 200, { ok: true, ...summary, stdout: r.stdout, cmd: r.cmd }, origin);
      return;
    }

    if (pathname === "/repo/clone" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req));
      const url = String(body.url || "");
      if (!/^https?:\/\//i.test(url) && !/^git@/i.test(url) && !/^ssh:\/\//i.test(url)) {
        throw Object.assign(new Error("clone url 仅允许 http(s)/git@/ssh"), { status: 400 });
      }
      if (/[\r\n\0]/.test(url)) throw Object.assign(new Error("非法 url"), { status: 400 });
      const parent = safePath(body.dir || path.join(os.homedir(), "DevToolsRepos"));
      fs.mkdirSync(parent, { recursive: true });
      const argv = ["clone", "--", url];
      if (body.name) {
        if (/[\r\n\0\/]/.test(String(body.name)) || String(body.name).startsWith("-")) {
          throw Object.assign(new Error("非法目录名"), { status: 400 });
        }
        argv.push(String(body.name));
      }
      const r = await git(parent, argv);
      const dest = body.name ? path.join(parent, String(body.name)) : path.join(parent, path.basename(url).replace(/\.git$/i, ""));
      const root = await resolveRepoRoot(dest);
      const summary = await repoSummary(root);
      sendJson(res, 200, { ok: true, ...summary, stdout: r.stdout, cmd: ["git", "-C", parent, ...argv] }, origin);
      return;
    }

    if (pathname === "/repo/exec" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req));
      const repo = await resolveRepoRoot(body.repo || body.path);
      const out = await runOp(repo, body.op, body.params || {});
      sendJson(res, 200, out, origin);
      return;
    }

    sendJson(res, 404, { error: "未找到接口" }, origin);
  } catch (err) {
    const status = err.status || (err.code === "ENOENT" ? 404 : 500);
    sendJson(
      res,
      status,
      {
        error: err.message || String(err),
        cmd: err.cmd || undefined,
        stderr: err.stderr || undefined,
      },
      origin
    );
  }
}

function start() {
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch((err) => {
      try {
        sendJson(res, 500, { error: err.message || String(err) }, req.headers.origin || "");
      } catch {
        res.end();
      }
    });
  });
  server.listen(PORT, HOST, () => {
    console.log(`[devtools-git-bridge] v${BRIDGE_VERSION} http://${HOST}:${PORT}`);
    console.log(`Token: ${TOKEN}（也接受 devtools-bridge）`);
    console.log("需要本机已安装 git，并在 PATH 中。");
  });
  server.on("error", (err) => {
    console.error(err);
    process.exit(1);
  });
}

if (require.main === module) start();

module.exports = { handleRequest, BRIDGE_VERSION, FEATURES, PORT, TOKEN };
