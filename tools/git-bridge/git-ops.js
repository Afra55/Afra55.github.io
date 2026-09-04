"use strict";

/**
 * Whitelisted git operations for DevTools git-bridge.
 * Every op maps to argv via execFile (no shell).
 */

const path = require("path");

function pathResolveNoopEditor() {
  // rebase -i --autosquash 会先改好 todo；编辑器只需成功退出（路径勿含空格参数）
  return process.platform === "win32"
    ? path.join(__dirname, "noop-editor.cmd")
    : path.join(__dirname, "noop-editor.sh");
}

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
  /** 把当前暂存改动记成 fixup，随后配合 rebase-autosquash 并入目标提交（Gerrit 改更早一笔） */
  "commit-fixup": {
    group: "提交",
    title: "commit --fixup",
    build: (p) => {
      need(p, "sha");
      const sha = assertRef(p.sha, "sha");
      return {
        argv: ["commit", `--fixup=${sha}`],
        label: `commit --fixup=${sha}`,
        dangerous: true,
      };
    },
  },
  "rebase-autosquash": {
    group: "历史",
    title: "rebase -i --autosquash",
    build: (p) => {
      need(p, "onto");
      const onto = assertRef(p.onto, "onto");
      const editor = pathResolveNoopEditor();
      return {
        argv: ["rebase", "-i", "--autosquash", onto],
        label: `rebase -i --autosquash ${onto}`,
        dangerous: true,
        env: {
          GIT_SEQUENCE_EDITOR: editor,
          GIT_EDITOR: editor,
        },
      };
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
      // 禁止 `git push <branch>`（把分支名当远程）；要带 branch 必须同时有 remote，或保持裸 push
      if (p.branch && !p.remote) {
        throw Object.assign(
          new Error("push 指定 branch 时必须同时指定 remote（或留空做裸 push）"),
          { status: 400 }
        );
      }
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
  /** Gerrit 必配：使裸 git push 映射到 refs/for/*，而不是直接推 refs/heads/* */
  "gerrit-config-push": {
    group: "远程",
    title: "config remote.*.push → refs/for/*",
    build: (p) => {
      const remote = assertRef(p.remote || "origin", "remote");
      if (!/^[A-Za-z0-9._-]+$/.test(remote)) {
        throw Object.assign(new Error("非法 remote 名"), { status: 400 });
      }
      const key = `remote.${remote}.push`;
      const value = "refs/heads/*:refs/for/*";
      return {
        argv: ["config", key, value],
        label: `config ${key} ${value}`,
      };
    },
  },
  "branch-set-upstream": {
    group: "分支",
    title: "branch --set-upstream-to",
    build: (p) => {
      need(p, "upstream");
      const upstream = assertRef(p.upstream, "upstream");
      const argv = ["branch", `--set-upstream-to=${upstream}`];
      if (p.branch) argv.push(assertRef(p.branch, "branch"));
      return { argv, label: argv.join(" ") };
    },
  },
  "push-lease": {
    group: "远程",
    title: "push --force-with-lease",
    build: (p) => {
      if (p.branch && !p.remote) {
        throw Object.assign(
          new Error("push-lease 指定 branch 时必须同时指定 remote（或留空做裸 push）"),
          { status: 400 }
        );
      }
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
  "commit-fixup",
  "merge",
  "merge-abort",
  "merge-continue",
  "pull",
  "pull-merge",
  "pull-rebase",
  "push",
  "push-gerrit",
  "gerrit-config-push",
  "push-lease",
  "push-tags",
  "branch-set-upstream",
  "rebase",
  "rebase-abort",
  "rebase-autosquash",
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

const GROUP_LABEL = {
  查阅: "查看信息",
  Diff: "看改了什么",
  提交: "保存进历史",
  历史: "改历史顺序",
  分支: "工作线",
  合并: "合并 / 改写",
  远程: "网上同步",
  Stash: "临时收起",
  Tag: "版本标签",
  Worktree: "多目录打工",
  Submodule: "子仓库",
  Bisect: "二分找坏点",
  维护: "仓库保养",
};

/** 小白话说明：目录按钮主文案；git 原命令仍放 title */
const OP_PLAIN = {
  version: "看本机 git 版本号",
  status: "看现在有哪些改动（详细）",
  "status-short": "看现在有哪些改动（一行摘要）",
  "status-porcelain": "看改动（程序可读格式）",
  "branch-list": "列出本地和网上的所有工作线",
  "branch-vv": "看每条线跟踪网上哪条、超前/落后多少",
  "log-oneline": "用一句话列表看最近提交",
  "log-graph": "用字符图画分支分叉（终端风格）",
  "log-stat": "看最近提交并统计改了哪些文件",
  show: "看某个提交改了什么（摘要）",
  "show-patch": "看某个提交的完整差异补丁",
  "show-file": "取出某次提交里某个文件的内容",
  "rev-parse": "把名字解析成完整提交号",
  describe: "用最近标签描述当前版本",
  "name-rev": "给提交号起个好记的名字",
  "merge-base": "找两条线最近的共同祖先",
  shortlog: "按作者统计谁提交得多",
  "ls-files": "列出仓库正跟踪的文件",
  "ls-tree": "列出某次提交里的文件树",
  blame: "看某文件每一行最后是谁改的",
  reflog: "看「后悔药」：指针最近去过哪里",
  "config-list-local": "列出本仓库本地配置",
  "config-get": "读取某一项配置的值",
  diff: "看未保存改动的文件清单（统计）",
  "diff-patch": "看未保存改动的完整差异",
  "diff-staged": "看待保存区里准备提交的差异",
  "diff-files": "只列出改动文件名和状态",
  "diff-word": "按「词」级别看文字差异",
  "add-all": "把所有改动放进「待保存」",
  "add-update": "只把已跟踪文件的改动放进待保存",
  add: "把指定文件放进待保存",
  commit: "把待保存内容记入历史（写说明）",
  "commit-amend": "改写「上一笔」保存（可补文件/改说明）",
  "commit-fixup": "把当前改动记成「补丁包」，准备并进更早一笔",
  "rebase-autosquash": "自动把补丁包并进目标提交（改历史）",
  checkout: "切换到某条线或某个提交",
  switch: "切换工作线（较新写法）",
  "branch-create": "新建一条工作线",
  "branch-delete": "删除一条本地工作线",
  "branch-rename": "给工作线改名",
  restore: "把某个文件恢复成上次保存的样子",
  "checkout-ours": "冲突时：这一文件留「我的」版本",
  "checkout-theirs": "冲突时：这一文件留「对方」版本",
  "reset-soft-1": "撤销上一笔保存，但改动还留在待保存",
  "reset-soft-n": "撤销最近 N 笔保存，改动仍留着",
  "reset-hard-upstream": "强制对齐网上跟踪线（会丢掉本地多出来的）",
  "format-patch": "把最近几笔打成补丁文件",
  am: "按补丁文件「整笔」恢复提交",
  apply: "只把补丁改动应用到文件（不生成提交）",
  "restore-workdir": "工作区全部恢复到上次保存（慎用）",
  "clean-dry": "预览：会删哪些未跟踪的垃圾文件",
  clean: "删除未跟踪的文件和目录（慎用）",
  "stash-push": "把改动临时收进「收起柜」",
  "stash-pop": "取出最近一份收起，并从柜子拿走",
  "stash-apply": "取出一份收起，但柜子里还留着",
  "stash-drop": "丢掉柜子里某一份",
  "stash-list": "列出收起柜里有哪些",
  "stash-show": "看某一份收起具体改了什么",
  "stash-clear": "清空整个收起柜",
  merge: "把另一条线合进当前线",
  "merge-abort": "放弃正在进行的合并",
  "merge-continue": "冲突处理好后继续合并",
  rebase: "把我的提交接到另一条线后面（改历史）",
  "rebase-abort": "放弃正在进行的改写",
  "rebase-continue": "冲突处理好后继续改写",
  "rebase-skip": "跳过当前有问题的那一笔继续",
  "cherry-pick": "只拣选某一笔提交过来",
  "cherry-pick-abort": "放弃正在进行的拣选",
  "cherry-pick-continue": "冲突处理好后继续拣选",
  revert: "新增一笔「反做」来撤销某次提交",
  "revert-abort": "放弃正在进行的反做",
  "revert-continue": "冲突处理好后继续反做",
  reset: "把当前线指针挪到某处（可丢改动，慎用）",
  fetch: "从网上拉最新信息（不改你的文件）",
  "fetch-origin": "只从 origin 拉最新信息",
  pull: "更新：只允许快进（更安全）",
  "pull-rebase": "更新：把我的接到最新后面",
  "pull-merge": "更新：用合并方式接上最新",
  push: "把本地提交上传到网上",
  "push-gerrit": "【Gerrit】送审：推到评审区 refs/for（不是直推分支）",
  "gerrit-config-push": "【Gerrit】先配：以后「上传」默认走评审 refs/for",
  "branch-set-upstream": "设置当前线跟踪网上哪条",
  "push-lease": "安全强推：覆盖远程同名线（有保护）",
  "push-tags": "把标签上传到网上",
  "remote-list": "列出配置了哪些远程地址",
  "remote-add": "添加一个远程地址",
  "remote-remove": "删除一个远程配置",
  "remote-rename": "给远程改名",
  "remote-set-url": "改远程的网址",
  "remote-prune": "清理网上已删分支的本地缓存",
  "tag-list": "列出所有版本标签",
  "tag-create": "打一个新标签",
  "tag-delete": "删除本地标签",
  "worktree-list": "列出额外检出的工作目录",
  "worktree-add": "再开一个目录检出另一条线",
  "worktree-remove": "删掉某个额外工作目录",
  "worktree-prune": "清理失效的工作目录记录",
  "submodule-status": "看子仓库状态",
  "submodule-init": "初始化子仓库配置",
  "submodule-update": "拉取并更新子仓库",
  "submodule-sync": "同步子仓库远程地址",
  "bisect-start": "开始二分查找：哪次提交引入了问题",
  "bisect-bad": "标记：当前这次是坏的",
  "bisect-good": "标记：当前这次是好的",
  "bisect-reset": "结束二分，回到原来状态",
  "bisect-log": "看二分查找的记录",
  "bisect-status": "二分进行中时看状态",
  "gc-auto": "自动清理仓库垃圾（轻量）",
  fsck: "检查仓库对象是否损坏",
  "count-objects": "统计仓库对象占用空间",
};

function listOpsCatalog() {
  const groups = {};
  for (const [id, def] of Object.entries(OP_DEFS)) {
    const groupKey = def.group;
    if (!groups[groupKey]) groups[groupKey] = [];
    const gerrit = /gerrit/i.test(id) || id === "push-gerrit";
    groups[groupKey].push({
      id,
      title: def.title,
      plain: OP_PLAIN[id] || def.title,
      group: groupKey,
      groupLabel: GROUP_LABEL[groupKey] || groupKey,
      dangerous: isDangerousOp(id, def),
      gerrit,
    });
  }
  return {
    ops: listOps(),
    groups: Object.keys(groups).map((name) => ({
      name,
      label: GROUP_LABEL[name] || name,
      items: groups[name],
    })),
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
