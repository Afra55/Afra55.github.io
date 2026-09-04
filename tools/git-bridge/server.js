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
const PORT = Number(process.env.GIT_BRIDGE_PORT || 17888);
const TOKEN = String(process.env.GIT_BRIDGE_TOKEN || "devtools-bridge");
const ACCEPTED_TOKENS = new Set(
  [TOKEN, "devtools-bridge", "devtools-git"].map(String).filter(Boolean)
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

const { buildOp, listOpsCatalog, assertPath } = require("./git-ops");

const BRIDGE_VERSION = "0.2.14";
const FEATURES = [
  "fs-browse","fs-pick-dir","repo-open","repo-probe","repo-init","repo-clone","graph","branches",
  "status","commit-detail","explain","ops-catalog","ops-full","protocol-launch",
  "conflict-assist","read-write-file","beginner-plain-steps","beginner-sync-reset-patch",
  "diff-file","push-gerrit","gerrit-config-push","zero-difficulty","branch-track-stats",
  "conflict-stages"
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
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C", ...(opts.env || {}) },
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

function runExecFile(cmd, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      {
        encoding: "utf8",
        timeout: opts.timeout || 120000,
        maxBuffer: opts.maxBuffer || 2 * 1024 * 1024,
        windowsHide: true,
        env: { ...process.env, ...(opts.env || {}) },
      },
      (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout;
          err.stderr = stderr;
          reject(err);
          return;
        }
        resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
      }
    );
  });
}

/** 弹出本机「选择文件夹」对话框，返回绝对路径；取消则 path 为空 */
async function pickDirectory() {
  if (process.platform === "darwin") {
    const script =
      'try\nPOSIX path of (choose folder with prompt "选择 Git 仓库文件夹")\non error number -128\n""\nend try';
    const r = await runExecFile("osascript", ["-e", script], { timeout: 300000 });
    return String(r.stdout || "").trim().replace(/\/+$/, "") || "";
  }
  if (process.platform === "win32") {
    const ps = [
      "Add-Type -AssemblyName System.Windows.Forms | Out-Null",
      "$f = New-Object System.Windows.Forms.FolderBrowserDialog",
      '$f.Description = "选择 Git 仓库文件夹"',
      "$f.ShowNewFolderButton = $true",
      "if ($f.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $f.SelectedPath }",
    ].join("; ");
    const r = await runExecFile(
      "powershell.exe",
      ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", ps],
      { timeout: 300000 }
    );
    return String(r.stdout || "").trim() || "";
  }
  // Linux：优先 zenity，其次 kdialog
  try {
    const r = await runExecFile(
      "zenity",
      ["--file-selection", "--directory", "--title=选择 Git 仓库文件夹"],
      { timeout: 300000 }
    );
    return String(r.stdout || "").trim() || "";
  } catch (e) {
    if (e && Number(e.code) === 1) return ""; // 用户取消
    const missing = e && (e.code === "ENOENT" || /ENOENT|not found/i.test(String(e.message || "")));
    if (!missing) {
      throw Object.assign(new Error(e.message || "选择文件夹失败"), { status: 500 });
    }
  }
  try {
    const r = await runExecFile("kdialog", ["--getexistingdirectory", os.homedir()], {
      timeout: 300000,
    });
    return String(r.stdout || "").trim() || "";
  } catch (e) {
    if (e && Number(e.code) === 1) return "";
    if (e && (e.code === "ENOENT" || /ENOENT|not found/i.test(String(e.message || "")))) {
      throw Object.assign(
        new Error("本机没有可用的文件夹选择器（请安装 zenity 或 kdialog，或直接粘贴路径）"),
        { status: 501 }
      );
    }
    throw Object.assign(new Error(e.message || "选择文件夹失败"), { status: 500 });
  }
}

async function probeRepoPath(inputPath) {
  const dir = safePath(inputPath);
  let st;
  try {
    st = fs.statSync(dir);
  } catch {
    throw Object.assign(new Error("路径不存在"), { status: 404 });
  }
  if (!st.isDirectory()) {
    return { ok: true, path: dir, isDir: false, isRepo: false };
  }
  if (isGitDir(dir)) {
    try {
      const root = await resolveRepoRoot(dir);
      return { ok: true, path: dir, repo: root, isDir: true, isRepo: true };
    } catch {
      return { ok: true, path: dir, repo: dir, isDir: true, isRepo: true };
    }
  }
  try {
    const root = await resolveRepoRoot(dir);
    return { ok: true, path: dir, repo: root, isDir: true, isRepo: true };
  } catch {
    return { ok: true, path: dir, isDir: true, isRepo: false };
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
    "--format=%(refname:short)%00%(objectname)%00%(upstream:short)%00%(HEAD)%00%(subject)%00%(upstream:track)",
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

  function parseTrack(track) {
    const t = String(track || "");
    const ahead = Number((t.match(/ahead\s+(\d+)/i) || [])[1] || 0);
    const behind = Number((t.match(/behind\s+(\d+)/i) || [])[1] || 0);
    return { ahead, behind };
  }

  function parseLocal(text) {
    return String(text || "")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, sha, upstream, headMark, subject, track] = line.split("\0");
        const ab = parseTrack(track);
        return {
          name,
          sha,
          upstream: upstream || "",
          current: headMark === "*",
          subject: subject || "",
          kind: "local",
          ahead: ab.ahead,
          behind: ab.behind,
          isRemote: false,
        };
      });
  }
  function parseRemote(text) {
    return String(text || "")
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, sha, subject] = line.split("\0");
        return {
          name,
          sha,
          subject: subject || "",
          kind: "remote",
          ahead: 0,
          behind: 0,
          isRemote: true,
          current: false,
          upstream: "",
        };
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

function assertInsideRepo(repo, relPath) {
  const rel = assertPath(relPath);
  if (rel.startsWith("/") || /^[A-Za-z]:[\\/]/.test(rel) || rel.includes("..")) {
    throw Object.assign(new Error("路径必须是仓库内相对路径"), { status: 400 });
  }
  const abs = path.resolve(repo, rel);
  const root = path.resolve(repo);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw Object.assign(new Error("路径越出仓库"), { status: 400 });
  }
  return { rel, abs };
}

async function conflictStages(repo, relPath) {
  const filePath = assertPath(relPath);
  async function stage(n) {
    try {
      const r = await git(repo, ["show", `:${n}:${filePath}`], { maxBuffer: 2 * 1024 * 1024 });
      return String(r.stdout || "");
    } catch (_) {
      return null;
    }
  }
  const [base, ours, theirs] = await Promise.all([stage(1), stage(2), stage(3)]);
  return {
    path: filePath,
    base,
    ours,
    theirs,
    hasStages: ours != null || theirs != null || base != null,
  };
}

async function readRepoFile(repo, relPath) {
  const { rel, abs } = assertInsideRepo(repo, relPath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
    throw Object.assign(new Error("文件不存在"), { status: 404 });
  }
  const buf = fs.readFileSync(abs);
  if (buf.length > 2 * 1024 * 1024) {
    throw Object.assign(new Error("文件过大（>2MB），请用外部编辑器"), { status: 413 });
  }
  // reject obvious binary
  if (buf.includes(0)) {
    throw Object.assign(new Error("二进制文件不支持在线编辑"), { status: 415 });
  }
  return { path: rel, content: buf.toString("utf8"), bytes: buf.length };
}

async function writeRepoFile(repo, relPath, content) {
  const { rel, abs } = assertInsideRepo(repo, relPath);
  const text = String(content ?? "");
  if (Buffer.byteLength(text, "utf8") > 2 * 1024 * 1024) {
    throw Object.assign(new Error("内容过大（>2MB）"), { status: 413 });
  }
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, "utf8");
  return { path: rel, bytes: Buffer.byteLength(text, "utf8") };
}

async function repoStatus(repo) {
  const porcelain = await git(repo, ["status", "--porcelain=v2", "-b", "-z", "--untracked-files=all"]);
  const stash = await git(repo, ["stash", "list"]).catch(() => ({ stdout: "" }));
  const text = String(porcelain.stdout || "");
  const changes = [];
  const conflicts = [];
  let branch = "";
  let upstream = "";
  let ahead = 0;
  let behind = 0;
  for (const line of text.split("\0")) {
    if (!line) continue;
    if (line.startsWith("# branch.head ")) {
      branch = line.slice("# branch.head ".length).trim();
      continue;
    }
    if (line.startsWith("# branch.upstream ")) {
      upstream = line.slice("# branch.upstream ".length).trim();
      continue;
    }
    if (line.startsWith("# branch.ab ")) {
      const m = line.match(/\+(\d+)\s+-(\d+)/);
      if (m) {
        ahead = Number(m[1]) || 0;
        behind = Number(m[2]) || 0;
      }
      continue;
    }
    if (line.startsWith("#")) continue;
    if (line.startsWith("u ")) {
      // u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
      const m = line.match(/^u (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/);
      const path = m ? m[10] : line.slice(2).trim();
      if (path) conflicts.push({ path, label: path });
      continue;
    }
    if (line.startsWith("? ") || line.startsWith("! ")) {
      const path = line.slice(2);
      if (path) changes.push({ path, kind: "新", staged: false, unstaged: true, conflict: false });
      continue;
    }
    if (line.startsWith("1 ")) {
      // 1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
      const m = line.match(/^1 (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/);
      const xy = m ? m[1] : "..";
      const path = m ? m[8] : "";
      if (!path) continue;
      changes.push({
        path,
        kind: xy.includes("A") ? "加" : xy.includes("D") ? "删" : "改",
        staged: xy[0] !== ".",
        unstaged: xy[1] !== ".",
        conflict: false,
        xy,
      });
      continue;
    }
    if (line.startsWith("2 ")) {
      // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\t<origPath>
      const m = line.match(/^2 (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/);
      const xy = m ? m[1] : "R.";
      let path = m ? m[9] : "";
      if (path.includes("\t")) path = path.split("\t")[0];
      if (!path) continue;
      changes.push({
        path,
        kind: "改名",
        staged: xy[0] !== ".",
        unstaged: xy[1] !== ".",
        conflict: false,
        xy,
      });
    }
  }

  let inProgress = null;
  const markers = [
    [".git/MERGE_HEAD", "merge"],
    [".git/REBASE_HEAD", "rebase"],
    [".git/CHERRY_PICK_HEAD", "cherry-pick"],
    [".git/REVERT_HEAD", "revert"],
  ];
  for (const [rel, kind] of markers) {
    if (fs.existsSync(path.join(repo, rel))) {
      inProgress = kind;
      break;
    }
  }
  // rebase may use .git/rebase-merge or rebase-apply
  if (!inProgress) {
    if (fs.existsSync(path.join(repo, ".git/rebase-merge")) || fs.existsSync(path.join(repo, ".git/rebase-apply"))) {
      inProgress = "rebase";
    }
  }

  const pushCfg = await git(repo, ["config", "--get-all", "remote.origin.push"]).catch(() => ({ stdout: "" }));
  const gerritPushValues = String(pushCfg.stdout || "")
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const gerritPushConfigured = gerritPushValues.some((v) => /refs\/for\//.test(v));

  const plainSteps = [];
  if (inProgress === "merge") plainSteps.push("正在合并两条线，请先处理冲突文件");
  else if (inProgress === "rebase") plainSteps.push("正在改写提交顺序，请先处理冲突");
  else if (inProgress === "cherry-pick") plainSteps.push("正在拣选某个提交，请先处理冲突");
  else if (inProgress === "revert") plainSteps.push("正在撤销某个提交，请先处理冲突");
  if (conflicts.length) plainSteps.push(`有 ${conflicts.length} 个文件两边改得不一样，需要你选`);
  // 顺序与小白焦点一致：先更新 → 再保存 → 再上传
  if (behind > 0) plainSteps.push(`网上还有 ${behind} 个更新可以拉下来`);
  if (changes.length) plainSteps.push(`有 ${changes.length} 个文件改动还没保存`);
  if (ahead > 0) {
    plainSteps.push(
      gerritPushConfigured
        ? `你本地多出 ${ahead} 个提交可以送审（Gerrit refs/for）`
        : `你本地多出 ${ahead} 个提交可以上传`
    );
  }
  const stashList = String(stash.stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean);
  const stashCount = stashList.length;
  if (stashCount > 0) plainSteps.push(`收起柜里还有 ${stashCount} 份临时改动`);
  if (!plainSteps.length) plainSteps.push("一切就绪。去改文件，改完回来刷新状态即可");

  return {
    porcelain: porcelain.stdout,
    stash: stashList,
    stashCount,
    cmd: porcelain.cmd,
    branch,
    upstream,
    ahead,
    behind,
    changes,
    conflicts,
    inProgress,
    plainSteps,
    dirtyCount: changes.length + conflicts.length,
    gerritPushConfigured,
    gerritPushValues,
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

  const remoteContains = await git(repo, [
    "branch",
    "-r",
    "--contains",
    detail.hash,
    "--format=%(refname:short)",
  ]).catch(() => ({ stdout: "", cmd: null }));
  const remoteList = String(remoteContains.stdout || "")
    .trim()
    .split("\n")
    .filter(Boolean);
  if (remoteContains.cmd) cmds.push(remoteContains.cmd);
  if (remoteList.length) {
    bullets.push({
      kind: "remote",
      text: `网上已有这条提交（出现在：${remoteList.slice(0, 8).join("、")}${
        remoteList.length > 8 ? "…" : ""
      }）→ 可以理解为「已经推上去 / 别人也能看到」。`,
    });
  } else {
    bullets.push({
      kind: "remote",
      text: "网上远程分支里还没有它 → 多半还在你本机，别人看不见（未上传，或 Gerrit 仅送审未合入）。",
    });
  }

  const upstreamRef = await git(repo, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"]).catch(
    () => ({ stdout: "", cmd: null })
  );
  if (upstreamRef.cmd) cmds.push(upstreamRef.cmd);
  const up = String(upstreamRef.stdout || "").trim();
  if (up) {
    const onUp = await git(repo, ["merge-base", "--is-ancestor", detail.hash, up])
      .then(() => true)
      .catch(() => false);
    bullets.push({
      kind: "upstream",
      text: onUp
        ? `你当前跟踪的「${up}」已经包含它 → 相对这条线上线，可算「已同步」。`
        : `你当前跟踪的「${up}」还没有它 → 本地多出来的笔；要让线上有，需「上传」或 Gerrit「送审」。`,
    });
  }

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
    containingRemotes: remoteList,
    cmds: cmds.filter(Boolean),
  };
}

async function runOp(repo, op, params) {
  const built = buildOp(op, params);
  const result = await git(repo, built.argv, {
    ...(built.maxBuffer ? { maxBuffer: built.maxBuffer } : {}),
    ...(built.env ? { env: built.env } : {}),
  });
  return {
    ok: true,
    op,
    label: built.label,
    cmd: ["git", "-C", repo, ...built.argv],
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

async function handleRequest(req, res, opts = {}) {
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

  let pathname = opts.pathname != null ? String(opts.pathname) : url.pathname;
  pathname = pathname.replace(/\/+$/, "") || "/";
  const embedded = Boolean(opts.embedded);

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
          service: embedded ? "devtools-bridge-git" : "devtools-git-bridge",
          version: BRIDGE_VERSION,
          features: FEATURES,
          git: gitVer,
          port: embedded ? undefined : PORT,
          defaultToken: "devtools-bridge",
          installDir: process.env.GIT_BRIDGE_DIR || process.env.ADB_BRIDGE_DIR || __dirname,
          bridgeDir: process.env.GIT_BRIDGE_DIR || process.env.ADB_BRIDGE_DIR || __dirname,
          embedded,
          mount: embedded ? "/git" : "",
        },
        origin
      );
      return;
    }

    if (!opts.alreadyAuthed && !requireToken(req)) {
      sendJson(res, 401, { error: "Token 无效。请求头加 X-Git-Token / X-Adb-Token: devtools-bridge" }, origin);
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

    if (pathname === "/fs/pick-dir" && req.method === "POST") {
      const picked = await pickDirectory();
      sendJson(res, 200, { ok: true, path: picked, cancelled: !picked }, origin);
      return;
    }

    if (pathname === "/repo/probe" && (req.method === "GET" || req.method === "POST")) {
      let input = url.searchParams.get("path") || "";
      if (req.method === "POST") {
        const body = parseJsonBody(await readBody(req));
        input = body.path || input;
      }
      sendJson(res, 200, await probeRepoPath(input), origin);
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

    if (pathname === "/repo/read-file" && req.method === "GET") {
      const repo = await resolveRepoRoot(url.searchParams.get("repo"));
      const filePath = url.searchParams.get("path");
      sendJson(res, 200, { ok: true, ...(await readRepoFile(repo, filePath)) }, origin);
      return;
    }

    if (pathname === "/repo/conflict-sides" && req.method === "GET") {
      const repo = await resolveRepoRoot(url.searchParams.get("repo"));
      const filePath = url.searchParams.get("path");
      sendJson(res, 200, { ok: true, ...(await conflictStages(repo, filePath)) }, origin);
      return;
    }

    if (pathname === "/repo/diff-file" && req.method === "GET") {
      const repo = await resolveRepoRoot(url.searchParams.get("repo"));
      const filePath = assertPath(url.searchParams.get("path"));
      const staged = url.searchParams.get("staged") === "1" || url.searchParams.get("staged") === "true";
      const argv = staged ? ["diff", "--cached", "--", filePath] : ["diff", "--", filePath];
      const r = await git(repo, argv, { maxBuffer: 8 * 1024 * 1024 });
      sendJson(
        res,
        200,
        {
          ok: true,
          path: filePath,
          staged,
          diff: String(r.stdout || "") || "(无差异或为新文件未暂存内容；可先「勾选进待保存」再看)",
          cmd: r.cmd,
        },
        origin
      );
      return;
    }

    if (pathname === "/repo/write-file" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req));
      const repo = await resolveRepoRoot(body.repo || body.path);
      const written = await writeRepoFile(repo, body.file || body.filePath, body.content);
      sendJson(res, 200, { ok: true, ...written }, origin);
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
