"use strict";

/**
 * Whitelisted git operations for DevTools git-bridge.
 * Every op maps to argv via execFile (no shell).
 */

function assertNoShellMeta(s) {
  if (/[\r\n\0]/.test(String(s))) {
    throw Object.assign(new Error("参数含非法字符"), { status: 400 });
  }
}

function assertRef(s, label = "ref") {
  const v = String(s || "");
  if (!v) throw Object.assign(new Error(`缺少 ${label}`), { status: 400 });
  assertNoShellMeta(v);
  // allow stash@{0}, refs, SHAs, branch names; block option injection
  if (v.startsWith("-")) throw Object.assign(new Error(`${label} 不能以 - 开头`), { status: 400 });
  return v;
}

function assertPath(s) {
  const v = String(s || "");
  if (!v) throw Object.assign(new Error("缺少 path"), { status: 400 });
  assertNoShellMeta(v);
  if (v.includes("\0")) throw Object.assign(new Error("非法 path"), { status: 400 });
  return v;
}

function need(p, ...keys) {
  for (const k of keys) {
    if (p[k] == null || p[k] === "") throw Object.assign(new Error(`缺少参数 ${k}`), { status: 400 });
    assertNoShellMeta(String(p[k]));
  }
}

/** @typedef {{ argv: string[], label: string, maxBuffer?: number, dangerous?: boolean }} BuiltOp */

/** @type {Record<string, { group: string, title: string, build: (p: object) => BuiltOp }>} */
const OP_DEFS = {
  // —— 状态 / 查阅 ——
  version: {
    group: "查阅",
    title: "git --version",
    build: () => ({ argv: ["--version"], label: "--version" }),
  },
  status: {
    group: "查阅",
    title: "status",
    build: () => ({ argv: ["status"], label: "status" }),
  },
  "status-short": {
    group: "查阅",
    title: "status -sb",
    build: () => ({ argv: ["status", "-sb"], label: "status -sb" }),
  },
  "status-porcelain": {
    group: "查阅",
    title: "status --porcelain=v2",
    build: () => ({ argv: ["status", "--porcelain=v2", "-b"], label: "status --porcelain=v2 -b" }),
  },
  "branch-list": {
    group: "查阅",
    title: "branch -a",
    build: () => ({ argv: ["branch", "-a", "-v"], label: "branch -a -v" }),
  },
  "branch-vv": {
    group: "查阅",
    title: "branch -vv",
    build: () => ({ argv: ["branch", "-vv"], label: "branch -vv" }),
  },
  "log-oneline": {
    group: "查阅",
    title: "log --oneline",
    build: (p) => {
      const n = Math.min(100, Number(p.max) || 40);
      return { argv: ["log", "--oneline", "--decorate", `-n${n}`], label: `log --oneline -n${n}` };
    },
  },
  "log-graph": {
    group: "查阅",
    title: "log --graph",
    build: (p) => {
      const n = Math.min(100, Number(p.max) || 40);
      return {
        argv: ["log", "--all", "--decorate", "--graph", "--oneline", `--max-count=${n}`],
        label: "log --graph --oneline --all",
      };
    },
  },
  "log-stat": {
    group: "查阅",
    title: "log --stat",
    build: (p) => {
      const n = Math.min(40, Number(p.max) || 15);
      return { argv: ["log", "--stat", `-n${n}`], label: `log --stat -n${n}` };
    },
  },
  show: {
    group: "查阅",
    title: "show",
    build: (p) => {
      need(p, "sha");
      return { argv: ["show", "--stat", assertRef(p.sha, "sha")], label: `show --stat ${p.sha}` };
    },
  },
  "show-patch": {
    group: "查阅",
    title: "show -p",
    build: (p) => {
      need(p, "sha");
      return {
        argv: ["show", "--patch", assertRef(p.sha, "sha")],
        label: `show -p ${p.sha}`,
        maxBuffer: 32 * 1024 * 1024,
      };
    },
  },
  "show-file": {
    group: "查阅",
    title: "show sha:path",
    build: (p) => {
      need(p, "sha", "path");
      return {
        argv: ["show", `${assertRef(p.sha, "sha")}:${assertPath(p.path)}`],
        label: `show ${p.sha}:${p.path}`,
        maxBuffer: 32 * 1024 * 1024,
      };
    },
  },
  "rev-parse": {
    group: "查阅",
    title: "rev-parse",
    build: (p) => {
      need(p, "ref");
      return { argv: ["rev-parse", assertRef(p.ref)], label: `rev-parse ${p.ref}` };
    },
  },
  describe: {
    group: "查阅",
    title: "describe --tags",
    build: (p) => {
      const argv = ["describe", "--tags", "--always"];
      if (p.sha) argv.push(assertRef(p.sha, "sha"));
      return { argv, label: argv.join(" ") };
    },
  },
  "name-rev": {
    group: "查阅",
    title: "name-rev",
    build: (p) => {
      need(p, "sha");
      return { argv: ["name-rev", "--name-only", assertRef(p.sha, "sha")], label: `name-rev ${p.sha}` };
    },
  },
  "merge-base": {
    group: "查阅",
    title: "merge-base",
    build: (p) => {
      need(p, "a", "b");
      return {
        argv: ["merge-base", assertRef(p.a, "a"), assertRef(p.b, "b")],
        label: `merge-base ${p.a} ${p.b}`,
      };
    },
  },
  shortlog: {
    group: "查阅",
    title: "shortlog -sn",
    build: () => ({ argv: ["shortlog", "-sn", "--all"], label: "shortlog -sn --all" }),
  },
  "ls-files": {
    group: "查阅",
    title: "ls-files",
    build: () => ({ argv: ["ls-files"], label: "ls-files" }),
  },
  "ls-tree": {
    group: "查阅",
    title: "ls-tree",
    build: (p) => {
      const ref = p.sha ? assertRef(p.sha, "sha") : "HEAD";
      return { argv: ["ls-tree", "-r", "--name-only", ref], label: `ls-tree -r ${ref}` };
    },
  },
  blame: {
    group: "查阅",
    title: "blame",
    build: (p) => {
      need(p, "path");
      const argv = ["blame", "-w"];
      if (p.sha) argv.push(assertRef(p.sha, "sha"));
      argv.push("--", assertPath(p.path));
      return { argv, label: `blame ${p.path}`, maxBuffer: 32 * 1024 * 1024 };
    },
  },
  reflog: {
    group: "查阅",
    title: "reflog",
    build: (p) => {
      const n = Math.min(100, Number(p.max) || 30);
      return { argv: ["reflog", `--max-count=${n}`], label: `reflog -n${n}` };
    },
  },
  "config-list-local": {
    group: "查阅",
    title: "config --local --list",
    build: () => ({ argv: ["config", "--local", "--list"], label: "config --local --list" }),
  },
  "config-get": {
    group: "查阅",
    title: "config --get",
    build: (p) => {
      need(p, "key");
      const key = String(p.key);
      if (!/^[A-Za-z0-9_.-]+$/.test(key)) throw Object.assign(new Error("非法 config key"), { status: 400 });
      return { argv: ["config", "--get", key], label: `config --get ${key}` };
    },
  },

  // —— diff ——
  diff: {
    group: "Diff",
    title: "diff --stat",
    build: (p) => {
      const argv = ["diff", "--stat"];
      if (p.a) argv.push(assertRef(p.a, "a"));
      if (p.b) argv.push(assertRef(p.b, "b"));
      return { argv, label: argv.join(" ") };
    },
  },
  "diff-patch": {
    group: "Diff",
    title: "diff（完整）",
    build: (p) => {
      const argv = ["diff"];
      if (p.a) argv.push(assertRef(p.a, "a"));
      if (p.b) argv.push(assertRef(p.b, "b"));
      return { argv, label: argv.join(" "), maxBuffer: 32 * 1024 * 1024 };
    },
  },
  "diff-staged": {
    group: "Diff",
    title: "diff --staged",
    build: () => ({ argv: ["diff", "--staged", "--stat"], label: "diff --staged --stat" }),
  },
  "diff-files": {
    group: "Diff",
    title: "diff --name-status",
    build: (p) => {
      const argv = ["diff", "--name-status"];
      if (p.a) argv.push(assertRef(p.a, "a"));
      if (p.b) argv.push(assertRef(p.b, "b"));
      return { argv, label: argv.join(" ") };
    },
  },
  "diff-word": {
    group: "Diff",
    title: "diff --word-diff",
    build: (p) => {
      const argv = ["diff", "--word-diff"];
      if (p.a) argv.push(assertRef(p.a, "a"));
      if (p.b) argv.push(assertRef(p.b, "b"));
      return { argv, label: argv.join(" "), maxBuffer: 16 * 1024 * 1024 };
    },
  },

  // —— 暂存 / 提交 ——
  "add-all": {
    group: "提交",
    title: "add -A",
    build: () => ({ argv: ["add", "-A"], label: "add -A" }),
  },
  "add-update": {
    group: "提交",
    title: "add -u",
    build: () => ({ argv: ["add", "-u"], label: "add -u" }),
  },
  add: {
    group: "提交",
    title: "add <path>",
    build: (p) => {
      need(p, "path");
      return { argv: ["add", "--", assertPath(p.path)], label: `add -- ${p.path}` };
    },
  },
  commit: {
    group: "提交",
    title: "commit -m",
    build: (p) => {
      need(p, "message");
      const argv = ["commit", "-m", String(p.message)];
      if (p.allowEmpty) argv.push("--allow-empty");
      return { argv, label: `commit -m …` };
    },
  },
  "commit-amend": {
    group: "提交",
    title: "commit --amend",
    build: (p) => {
      if (p.noEdit) return { argv: ["commit", "--amend", "--no-edit"], label: "commit --amend --no-edit" };
      need(p, "message");
      return { argv: ["commit", "--amend", "-m", String(p.message)], label: "commit --amend -m …" };
    },
  },

  // —— 分支 / 切换 ——
  checkout: {
    group: "分支",
    title: "checkout",
    build: (p) => {
      need(p, "target");
      const argv = ["checkout"];
      if (p.create) {
        argv.push("-b", assertRef(p.target, "target"));
        if (p.start) argv.push(assertRef(p.start, "start"));
      } else {
        argv.push(assertRef(p.target, "target"));
      }
      return { argv, label: argv.join(" ") };
    },
  },
  switch: {
    group: "分支",
    title: "switch",
    build: (p) => {
      need(p, "target");
      const argv = ["switch"];
      if (p.create) {
        argv.push("-c", assertRef(p.target, "target"));
        if (p.start) argv.push("--track", assertRef(p.start, "start"));
        else if (p.track) argv.push("--track");
      } else {
        argv.push(assertRef(p.target, "target"));
      }
      return { argv, label: argv.join(" ") };
    },
  },
  "branch-create": {
    group: "分支",
    title: "branch 创建",
    build: (p) => {
      need(p, "name");
      const argv = ["branch", assertRef(p.name, "name")];
      if (p.start) argv.push(assertRef(p.start, "start"));
      return { argv, label: argv.join(" ") };
    },
  },
  "branch-delete": {
    group: "分支",
    title: "branch -d",
    build: (p) => {
      need(p, "name");
      return {
        argv: ["branch", p.force ? "-D" : "-d", assertRef(p.name, "name")],
        label: `branch ${p.force ? "-D" : "-d"} ${p.name}`,
        dangerous: !!p.force,
      };
    },
  },
  "branch-rename": {
    group: "分支",
    title: "branch -m",
    build: (p) => {
      need(p, "oldName", "newName");
      return {
        argv: ["branch", "-m", assertRef(p.oldName, "oldName"), assertRef(p.newName, "newName")],
        label: `branch -m ${p.oldName} ${p.newName}`,
      };
    },
  },
  restore: {
    group: "分支",
    title: "restore",
    build: (p) => {
      need(p, "path");
      const argv = ["restore"];
      if (p.staged) argv.push("--staged");
      if (p.source) argv.push("--source", assertRef(p.source, "source"));
      argv.push("--", assertPath(p.path));
      return { argv, label: argv.join(" ") };
    },
  },
  "checkout-ours": {
    group: "合并",
    title: "checkout --ours",
    build: (p) => {
      need(p, "path");
      return {
        argv: ["checkout", "--ours", "--", assertPath(p.path)],
        label: `checkout --ours -- ${p.path}`,
        dangerous: true,
      };
    },
  },
  "checkout-theirs": {
    group: "合并",
    title: "checkout --theirs",
    build: (p) => {
      need(p, "path");
      return {
        argv: ["checkout", "--theirs", "--", assertPath(p.path)],
        label: `checkout --theirs -- ${p.path}`,
        dangerous: true,
      };
    },
  },
  "reset-soft-1": {
    group: "提交",
    title: "reset --soft HEAD~1",
    build: () => ({
      argv: ["reset", "--soft", "HEAD~1"],
      label: "reset --soft HEAD~1",
      dangerous: true,
    }),
  },
  "reset-soft-n": {
    group: "提交",
    title: "reset --soft HEAD~N",
    build: (p) => {
      const n = Math.min(50, Math.max(1, Number(p.count) || 1));
      if (!Number.isFinite(n)) throw Object.assign(new Error("count 无效"), { status: 400 });
      return {
        argv: ["reset", "--soft", `HEAD~${n}`],
        label: `reset --soft HEAD~${n}`,
        dangerous: true,
      };
    },
  },
  "reset-hard-upstream": {
    group: "远程",
    title: "reset --hard @{upstream}",
    build: (p) => {
      if (!p.confirmHard) {
        throw Object.assign(new Error("hard reset 需要 confirmHard=true"), { status: 400 });
      }
      const ref = p.ref ? assertRef(p.ref, "ref") : "@{upstream}";
      return {
        argv: ["reset", "--hard", ref],
        label: `reset --hard ${ref}`,
        dangerous: true,
      };
    },
  },
  "format-patch": {
    group: "提交",
    title: "format-patch",
    build: (p) => {
      const n = Math.min(50, Math.max(1, Number(p.count) || 1));
      const outdir = assertPath(p.outdir || ".devtools-patches");
      const argv = ["format-patch", `-${n}`, "-o", outdir];
      if (p.sha) argv.push(assertRef(p.sha, "sha"));
      return { argv, label: `format-patch -${n} -o ${outdir}`, maxBuffer: 16 * 1024 * 1024 };
    },
  },
  am: {
    group: "提交",
    title: "am <patch>",
    build: (p) => {
      need(p, "path");
      return {
        argv: ["am", assertPath(p.path)],
        label: `am ${p.path}`,
        dangerous: true,
      };
    },
  },
  apply: {
    group: "提交",
    title: "apply <patch>",
    build: (p) => {
      need(p, "path");
      const argv = ["apply"];
      if (p.check) argv.push("--check");
      argv.push(assertPath(p.path));
      return { argv, label: argv.join(" "), dangerous: !p.check };
    },
  },
  "restore-workdir": {
    group: "分支",
    title: "restore .",
    build: () => ({ argv: ["restore", "."], label: "restore .", dangerous: true }),
  },
  "clean-dry": {
    group: "分支",
    title: "clean -fdn",
    build: () => ({ argv: ["clean", "-fdn"], label: "clean -fdn" }),
  },
  clean: {
    group: "分支",
    title: "clean -fd",
    build: (p) => {
      if (!p.confirmClean) throw Object.assign(new Error("clean 需要 confirmClean=true"), { status: 400 });
      return { argv: ["clean", "-fd"], label: "clean -fd", dangerous: true };
    },
  },

  // —— stash ——
  "stash-push": {
    group: "Stash",
    title: "stash push -u",
    build: (p) => {
      const argv = ["stash", "push", "-u"];
      if (p.message) {
        assertNoShellMeta(p.message);
        argv.push("-m", String(p.message));
      }
      return { argv, label: argv.join(" ") };
    },
  },
  "stash-pop": {
    group: "Stash",
    title: "stash pop",
    build: () => ({ argv: ["stash", "pop"], label: "stash pop", dangerous: true }),
  },
  "stash-apply": {
    group: "Stash",
    title: "stash apply",
    build: (p) => {
      const ref = p.ref ? assertRef(p.ref, "ref") : "stash@{0}";
      return { argv: ["stash", "apply", ref], label: `stash apply ${ref}` };
    },
  },
  "stash-drop": {
    group: "Stash",
    title: "stash drop",
    build: (p) => {
      const ref = p.ref ? assertRef(p.ref, "ref") : "stash@{0}";
      return { argv: ["stash", "drop", ref], label: `stash drop ${ref}`, dangerous: true };
    },
  },
  "stash-list": {
    group: "Stash",
    title: "stash list",
    build: () => ({ argv: ["stash", "list"], label: "stash list" }),
  },
  "stash-show": {
    group: "Stash",
    title: "stash show -p",
    build: (p) => {
      const ref = p.ref ? assertRef(p.ref, "ref") : "stash@{0}";
      return { argv: ["stash", "show", "-p", ref], label: `stash show -p ${ref}`, maxBuffer: 16 * 1024 * 1024 };
    },
  },
  "stash-clear": {
    group: "Stash",
    title: "stash clear",
    build: (p) => {
      if (!p.confirmClear) throw Object.assign(new Error("stash clear 需要 confirmClear=true"), { status: 400 });
      return { argv: ["stash", "clear"], label: "stash clear", dangerous: true };
    },
  },

  // —— merge / rebase / cherry-pick / revert ——
  merge: {
    group: "合并",
    title: "merge",
    build: (p) => {
      need(p, "branch");
      const argv = ["merge"];
      if (p.noFf) argv.push("--no-ff");
      if (p.ffOnly) argv.push("--ff-only");
      if (p.squash) argv.push("--squash");
      argv.push(assertRef(p.branch, "branch"));
      return { argv, label: argv.join(" "), dangerous: true };
    },
  },
  "merge-abort": {
    group: "合并",
    title: "merge --abort",
    build: () => ({ argv: ["merge", "--abort"], label: "merge --abort", dangerous: true }),
  },
  "merge-continue": {
    group: "合并",
    title: "merge --continue",
    build: () => ({
      argv: ["-c", "core.editor=true", "merge", "--continue"],
      label: "merge --continue",
      dangerous: true,
    }),
  },
  rebase: {
    group: "合并",
    title: "rebase",
    build: (p) => {
      need(p, "onto");
      return { argv: ["rebase", assertRef(p.onto, "onto")], label: `rebase ${p.onto}`, dangerous: true };
    },
  },
  "rebase-abort": {
    group: "合并",
    title: "rebase --abort",
    build: () => ({ argv: ["rebase", "--abort"], label: "rebase --abort", dangerous: true }),
  },
  "rebase-continue": {
    group: "合并",
    title: "rebase --continue",
    build: () => ({
      argv: ["-c", "core.editor=true", "rebase", "--continue"],
      label: "rebase --continue",
      dangerous: true,
    }),
  },
  "rebase-skip": {
    group: "合并",
    title: "rebase --skip",
    build: () => ({ argv: ["rebase", "--skip"], label: "rebase --skip", dangerous: true }),
  },
  "cherry-pick": {
    group: "合并",
    title: "cherry-pick",
    build: (p) => {
      need(p, "sha");
      return { argv: ["cherry-pick", assertRef(p.sha, "sha")], label: `cherry-pick ${p.sha}`, dangerous: true };
    },
  },
  "cherry-pick-abort": {
    group: "合并",
    title: "cherry-pick --abort",
    build: () => ({ argv: ["cherry-pick", "--abort"], label: "cherry-pick --abort", dangerous: true }),
  },
  "cherry-pick-continue": {
    group: "合并",
    title: "cherry-pick --continue",
    build: () => ({
      argv: ["-c", "core.editor=true", "cherry-pick", "--continue"],
      label: "cherry-pick --continue",
      dangerous: true,
    }),
  },
  revert: {
    group: "合并",
    title: "revert",
    build: (p) => {
      need(p, "sha");
      return {
        argv: ["revert", "--no-edit", assertRef(p.sha, "sha")],
        label: `revert --no-edit ${p.sha}`,
        dangerous: true,
      };
    },
  },
  "revert-abort": {
    group: "合并",
    title: "revert --abort",
    build: () => ({ argv: ["revert", "--abort"], label: "revert --abort", dangerous: true }),
  },
  "revert-continue": {
    group: "合并",
    title: "revert --continue",
    build: () => ({
      argv: ["-c", "core.editor=true", "revert", "--continue"],
      label: "revert --continue",
      dangerous: true,
    }),
  },
  reset: {
    group: "合并",
    title: "reset",
    build: (p) => {
      need(p, "sha");
      const mode = p.mode === "soft" || p.mode === "hard" ? p.mode : "mixed";
      if (mode === "hard" && !p.confirmHard) {
        throw Object.assign(new Error("hard reset 需要 confirmHard=true"), { status: 400 });
      }
      return {
        argv: ["reset", `--${mode}`, assertRef(p.sha, "sha")],
        label: `reset --${mode} ${p.sha}`,
        dangerous: mode !== "soft",
      };
    },
  },

  // —— 远程 ——
  fetch: {
    group: "远程",
    title: "fetch --all --prune",
    build: () => ({ argv: ["fetch", "--all", "--prune"], label: "fetch --all --prune" }),
  },
  "fetch-origin": {
    group: "远程",
    title: "fetch origin",
    build: () => ({ argv: ["fetch", "origin", "--prune"], label: "fetch origin --prune" }),
  },
  pull: {
    group: "远程",
    title: "pull --ff-only",
    build: () => ({ argv: ["pull", "--ff-only"], label: "pull --ff-only", dangerous: true }),
  },
  "pull-rebase": {
    group: "远程",
    title: "pull --rebase",
    build: () => ({ argv: ["pull", "--rebase"], label: "pull --rebase", dangerous: true }),
  },
  "pull-merge": {
    group: "远程",
    title: "pull --no-rebase",
    build: () => ({ argv: ["pull", "--no-rebase"], label: "pull --no-rebase", dangerous: true }),
  },
  push: {
    group: "远程",
    title: "push",
    build: (p) => {
      const argv = ["push"];
      if (p.setUpstream) argv.push("-u");
      if (p.remote) argv.push(assertRef(p.remote, "remote"));
      if (p.branch) argv.push(assertRef(p.branch, "branch"));
      return { argv, label: argv.join(" "), dangerous: true };
    },
  },
  "push-gerrit": {
    group: "远程",
    title: "push refs/for/*",
    build: (p) => {
      need(p, "branch");
      const remote = assertRef(p.remote || "origin", "remote");
      const branch = assertRef(p.branch, "branch");
      let dest = `HEAD:refs/for/${branch}`;
      if (p.topic) {
        const topic = String(p.topic).replace(/[^A-Za-z0-9._/-]/g, "");
        if (topic) dest += `%topic=${topic}`;
      }
      return {
        argv: ["push", remote, dest],
        label: `push ${remote} ${dest}`,
        dangerous: true,
      };
    },
  },
  "push-lease": {
    group: "远程",
    title: "push --force-with-lease",
    build: (p) => {
      const argv = ["push", "--force-with-lease"];
      if (p.remote) argv.push(assertRef(p.remote, "remote"));
      if (p.branch) argv.push(assertRef(p.branch, "branch"));
      return { argv, label: argv.join(" "), dangerous: true };
    },
  },
  "push-tags": {
    group: "远程",
    title: "push --tags",
    build: (p) => {
      const argv = ["push", "--tags"];
      if (p.remote) argv.push(assertRef(p.remote, "remote"));
      return { argv, label: argv.join(" "), dangerous: true };
    },
  },
  "remote-list": {
    group: "远程",
    title: "remote -v",
    build: () => ({ argv: ["remote", "-v"], label: "remote -v" }),
  },
  "remote-add": {
    group: "远程",
    title: "remote add",
    build: (p) => {
      need(p, "name", "url");
      assertNoShellMeta(p.url);
      if (!/^https?:\/\//i.test(p.url) && !/^git@/i.test(p.url) && !/^ssh:\/\//i.test(p.url)) {
        throw Object.assign(new Error("url 仅允许 http(s)/git@/ssh"), { status: 400 });
      }
      return {
        argv: ["remote", "add", assertRef(p.name, "name"), String(p.url)],
        label: `remote add ${p.name}`,
      };
    },
  },
  "remote-remove": {
    group: "远程",
    title: "remote remove",
    build: (p) => {
      need(p, "name");
      return { argv: ["remote", "remove", assertRef(p.name, "name")], label: `remote remove ${p.name}`, dangerous: true };
    },
  },
  "remote-rename": {
    group: "远程",
    title: "remote rename",
    build: (p) => {
      need(p, "oldName", "newName");
      return {
        argv: ["remote", "rename", assertRef(p.oldName, "oldName"), assertRef(p.newName, "newName")],
        label: `remote rename ${p.oldName} ${p.newName}`,
      };
    },
  },
  "remote-set-url": {
    group: "远程",
    title: "remote set-url",
    build: (p) => {
      need(p, "name", "url");
      assertNoShellMeta(p.url);
      return {
        argv: ["remote", "set-url", assertRef(p.name, "name"), String(p.url)],
        label: `remote set-url ${p.name}`,
        dangerous: true,
      };
    },
  },
  "remote-prune": {
    group: "远程",
    title: "remote prune",
    build: (p) => {
      const remote = p.remote ? assertRef(p.remote, "remote") : "origin";
      return { argv: ["remote", "prune", remote], label: `remote prune ${remote}` };
    },
  },

  // —— tag ——
  "tag-list": {
    group: "Tag",
    title: "tag -l",
    build: () => ({ argv: ["tag", "-l", "--sort=-creatordate"], label: "tag -l" }),
  },
  "tag-create": {
    group: "Tag",
    title: "tag",
    build: (p) => {
      need(p, "name");
      const argv = ["tag"];
      if (p.annotate) {
        argv.push("-a", assertRef(p.name, "name"), "-m", String(p.message || p.name));
      } else argv.push(assertRef(p.name, "name"));
      if (p.sha) argv.push(assertRef(p.sha, "sha"));
      return { argv, label: argv.join(" ") };
    },
  },
  "tag-delete": {
    group: "Tag",
    title: "tag -d",
    build: (p) => {
      need(p, "name");
      return { argv: ["tag", "-d", assertRef(p.name, "name")], label: `tag -d ${p.name}`, dangerous: true };
    },
  },

  // —— worktree / submodule ——
  "worktree-list": {
    group: "Worktree",
    title: "worktree list",
    build: () => ({ argv: ["worktree", "list", "--porcelain"], label: "worktree list" }),
  },
  "worktree-add": {
    group: "Worktree",
    title: "worktree add",
    build: (p) => {
      need(p, "path", "ref");
      return {
        argv: ["worktree", "add", assertPath(p.path), assertRef(p.ref, "ref")],
        label: `worktree add ${p.path} ${p.ref}`,
        dangerous: true,
      };
    },
  },
  "worktree-remove": {
    group: "Worktree",
    title: "worktree remove",
    build: (p) => {
      need(p, "path");
      const argv = ["worktree", "remove"];
      if (p.force) argv.push("--force");
      argv.push(assertPath(p.path));
      return { argv, label: argv.join(" "), dangerous: true };
    },
  },
  "worktree-prune": {
    group: "Worktree",
    title: "worktree prune",
    build: () => ({ argv: ["worktree", "prune"], label: "worktree prune" }),
  },
  "submodule-status": {
    group: "Submodule",
    title: "submodule status",
    build: () => ({ argv: ["submodule", "status"], label: "submodule status" }),
  },
  "submodule-init": {
    group: "Submodule",
    title: "submodule init",
    build: () => ({ argv: ["submodule", "init"], label: "submodule init" }),
  },
  "submodule-update": {
    group: "Submodule",
    title: "submodule update --init",
    build: () => ({
      argv: ["submodule", "update", "--init", "--recursive"],
      label: "submodule update --init --recursive",
      dangerous: true,
    }),
  },
  "submodule-sync": {
    group: "Submodule",
    title: "submodule sync",
    build: () => ({ argv: ["submodule", "sync", "--recursive"], label: "submodule sync --recursive" }),
  },

  // —— bisect ——
  "bisect-start": {
    group: "Bisect",
    title: "bisect start",
    build: () => ({ argv: ["bisect", "start"], label: "bisect start", dangerous: true }),
  },
  "bisect-bad": {
    group: "Bisect",
    title: "bisect bad",
    build: (p) => {
      const argv = ["bisect", "bad"];
      if (p.sha) argv.push(assertRef(p.sha, "sha"));
      return { argv, label: argv.join(" "), dangerous: true };
    },
  },
  "bisect-good": {
    group: "Bisect",
    title: "bisect good",
    build: (p) => {
      const argv = ["bisect", "good"];
      if (p.sha) argv.push(assertRef(p.sha, "sha"));
      return { argv, label: argv.join(" "), dangerous: true };
    },
  },
  "bisect-reset": {
    group: "Bisect",
    title: "bisect reset",
    build: () => ({ argv: ["bisect", "reset"], label: "bisect reset", dangerous: true }),
  },
  "bisect-log": {
    group: "Bisect",
    title: "bisect log",
    build: () => ({ argv: ["bisect", "log"], label: "bisect log" }),
  },
  "bisect-status": {
    group: "Bisect",
    title: "status（bisect 中）",
    build: () => ({ argv: ["status"], label: "status" }),
  },

  // —— 维护 ——
  "gc-auto": {
    group: "维护",
    title: "gc --auto",
    build: () => ({ argv: ["gc", "--auto"], label: "gc --auto" }),
  },
  fsck: {
    group: "维护",
    title: "fsck",
    build: () => ({ argv: ["fsck", "--full"], label: "fsck --full", maxBuffer: 32 * 1024 * 1024 }),
  },
  "count-objects": {
    group: "维护",
    title: "count-objects -v",
    build: () => ({ argv: ["count-objects", "-vH"], label: "count-objects -vH" }),
  },
};

function listOps() {
  return Object.keys(OP_DEFS).sort();
}

const CONFIRM_OPS = new Set([
  "add-all",
  "bisect-bad",
  "bisect-good",
  "bisect-reset",
  "bisect-start",
  "branch-delete",
  "cherry-pick",
  "cherry-pick-abort",
  "cherry-pick-continue",
  "clean",
  "commit-amend",
  "merge",
  "merge-abort",
  "merge-continue",
  "pull",
  "pull-merge",
  "pull-rebase",
  "push",
  "push-gerrit",
  "push-lease",
  "push-tags",
  "rebase",
  "rebase-abort",
  "rebase-continue",
  "rebase-skip",
  "remote-remove",
  "remote-set-url",
  "reset",
  "reset-soft-1",
  "reset-soft-n",
  "reset-hard-upstream",
  "am",
  "apply",
  "restore-workdir",
  "revert",
  "revert-abort",
  "revert-continue",
  "stash-clear",
  "stash-drop",
  "stash-pop",
  "submodule-update",
  "tag-delete",
  "worktree-add",
  "worktree-remove",
  "checkout-ours",
  "checkout-theirs",
]);

function isDangerousOp(id, def) {
  if (CONFIRM_OPS.has(id) || (def && def.dangerous)) return true;
  try {
    const built = def.build({});
    return !!built.dangerous;
  } catch {
    try {
      const built = def.build({
        sha: "HEAD",
        target: "HEAD",
        branch: "HEAD",
        onto: "HEAD",
        name: "x",
        path: "x",
        message: "x",
        key: "user.name",
        ref: "HEAD",
        oldName: "a",
        newName: "b",
        url: "https://example.com/r.git",
        remote: "origin",
        confirmClean: true,
        confirmClear: true,
        confirmHard: true,
        mode: "mixed",
      });
      return !!built.dangerous;
    } catch {
      return false;
    }
  }
}

function listOpsCatalog() {
  const groups = {};
  for (const [id, def] of Object.entries(OP_DEFS)) {
    if (!groups[def.group]) groups[def.group] = [];
    groups[def.group].push({
      id,
      title: def.title,
      group: def.group,
      dangerous: isDangerousOp(id, def),
    });
  }
  return {
    ops: listOps(),
    groups: Object.keys(groups).map((name) => ({ name, items: groups[name] })),
  };
}

function buildOp(op, params = {}) {
  const def = OP_DEFS[op];
  if (!def) throw Object.assign(new Error(`不支持的操作：${op}`), { status: 400 });
  return def.build(params || {});
}

module.exports = {
  OP_DEFS,
  buildOp,
  listOps,
  listOpsCatalog,
  isDangerousOp,
  CONFIRM_OPS,
  assertNoShellMeta,
  assertRef,
  assertPath,
};
