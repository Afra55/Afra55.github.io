(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const BASE_KEY = "devtools-git-base";
  const TOKEN_KEY = "devtools-git-token";
  const RECENT_KEY = "devtools-git-recent";
  const DEFAULT_BASE = "http://127.0.0.1:17890";
  const DEFAULT_TOKEN = "devtools-git";
  const LANE_COLORS = ["#5b8cff", "#3dd68c", "#f5a524", "#f31260", "#a78bfa", "#22d3ee", "#fb7185", "#84cc16"];

  const panel = $("#gitbridge");
  if (!panel) return;

  const baseInput = $("#git-base");
  const tokenInput = $("#git-token");
  const workspace = $("#git-workspace");
  const repoPanel = $("#git-repo-panel");
  const errEl = $("#git-error");
  const graphEl = $("#git-graph");
  const asciiEl = $("#git-ascii");
  const explainEl = $("#git-explain");
  const branchesEl = $("#git-branches");
  const cmdPreview = $("#git-cmd-preview");
  const opOut = $("#git-op-out");

  let connected = false;
  let fsPath = "";
  let repoPath = "";
  let graphCommits = [];
  let selectedSha = "";

  try {
    baseInput.value = localStorage.getItem(BASE_KEY) || DEFAULT_BASE;
    tokenInput.value = localStorage.getItem(TOKEN_KEY) || DEFAULT_TOKEN;
  } catch (_) {
    /* ignore */
  }

  function showError(msg) {
    if (!msg) {
      errEl.hidden = true;
      errEl.textContent = "";
      return;
    }
    errEl.hidden = false;
    errEl.textContent = msg;
  }

  function setStatus(kind, title, text) {
    const dot = $("#git-dot");
    panel.classList.toggle("is-connected", kind === "is-ok");
    dot.className = "adb-dot" + (kind === "is-ok" ? " is-ok" : kind === "is-err" ? " is-err" : "");
    $("#git-status-title").textContent = title;
    $("#git-status-text").textContent = text;
  }

  function baseUrl() {
    return String(baseInput.value || DEFAULT_BASE).replace(/\/+$/, "");
  }

  function token() {
    return String(tokenInput.value || DEFAULT_TOKEN).trim();
  }

  function persistConn() {
    try {
      localStorage.setItem(BASE_KEY, baseUrl());
      localStorage.setItem(TOKEN_KEY, token());
    } catch (_) {
      /* ignore */
    }
  }

  async function api(path, opts = {}) {
    const headers = Object.assign(
      { "X-Git-Token": token() },
      opts.body ? { "Content-Type": "application/json" } : {},
      opts.headers || {}
    );
    const res = await fetch(baseUrl() + path, {
      method: opts.method || "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
      cache: "no-store",
    });
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      data = null;
    }
    if (!res.ok) {
      const err = new Error((data && data.error) || `HTTP ${res.status}`);
      err.data = data;
      throw err;
    }
    return data;
  }

  function rememberRepo(p) {
    try {
      const list = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      const next = [p, ...list.filter((x) => x !== p)].slice(0, 8);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch (_) {
      /* ignore */
    }
  }

  function recentRepos() {
    try {
      return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    } catch (_) {
      return [];
    }
  }

  /** Deterministic lane assignment (newest → oldest). */
  function assignLanes(commits) {
    const active = [];
    const rows = [];
    const colorOf = new Map();
    let colorIdx = 0;

    function laneColor(lane) {
      if (!colorOf.has(lane)) {
        colorOf.set(lane, LANE_COLORS[colorIdx % LANE_COLORS.length]);
        colorIdx += 1;
      }
      return colorOf.get(lane);
    }

    for (const c of commits) {
      let lane = active.indexOf(c.hash);
      if (lane < 0) {
        lane = active.indexOf(null);
        if (lane < 0) {
          lane = active.length;
          active.push(c.hash);
        } else {
          active[lane] = c.hash;
        }
      }

      const parents = c.parents || [];
      const edges = [];
      const orphanLanes = [];

      // Continuing / branching edges from this commit's lane to parents
      parents.forEach((p, i) => {
        if (i === 0) {
          active[lane] = p;
          edges.push({ from: lane, to: lane, type: "parent0", color: laneColor(lane) });
        } else {
          let t = active.indexOf(p);
          if (t < 0) {
            t = active.indexOf(null);
            if (t < 0) {
              t = active.length;
              active.push(p);
            } else active[t] = p;
          }
          edges.push({ from: lane, to: t, type: "merge", color: laneColor(t) });
        }
      });

      if (!parents.length) {
        active[lane] = null;
      }

      // Pass-through lanes
      for (let i = 0; i < active.length; i++) {
        if (i === lane) continue;
        if (active[i] && active[i] !== c.hash) {
          edges.push({ from: i, to: i, type: "through", color: laneColor(i) });
        }
      }

      // Free lanes that pointed at this commit (merged away)
      for (let i = 0; i < active.length; i++) {
        if (active[i] === c.hash && i !== lane) {
          orphanLanes.push(i);
          active[i] = null;
        }
      }

      while (active.length && active[active.length - 1] == null) active.pop();

      rows.push({
        commit: c,
        lane,
        laneCount: Math.max(active.length, lane + 1, 1),
        edges,
        color: laneColor(lane),
      });
    }
    return rows;
  }

  function renderGraph(commits) {
    graphCommits = commits || [];
    const rows = assignLanes(graphCommits);
    const maxLanes = Math.max(1, ...rows.map((r) => r.laneCount));
    const colW = 14;
    const width = Math.max(48, maxLanes * colW + 8);
    graphEl.style.setProperty("--git-lane-w", `${Math.max(4.5, width / 14)}rem`);
    graphEl.innerHTML = "";

    rows.forEach((row) => {
      const c = row.commit;
      const el = document.createElement("div");
      el.className = "git-row" + (c.isMerge ? " is-merge" : "") + (c.hash === selectedSha ? " is-active" : "");
      el.dataset.sha = c.hash;
      el.setAttribute("role", "listitem");

      const laneBox = document.createElement("div");
      laneBox.className = "git-lanes";
      const h = 24;
      const svgNS = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(svgNS, "svg");
      svg.setAttribute("viewBox", `0 0 ${width} ${h}`);
      svg.setAttribute("width", String(width));
      svg.setAttribute("height", String(h));

      const xOf = (lane) => 8 + lane * colW;

      for (const e of row.edges) {
        const path = document.createElementNS(svgNS, "path");
        const x1 = xOf(e.from);
        const x2 = xOf(e.to);
        let d;
        if (e.type === "through" || (e.type === "parent0" && x1 === x2)) {
          d = `M ${x1} 0 V ${h}`;
        } else if (e.type === "parent0") {
          d = `M ${x1} ${h / 2} C ${x1} ${h} ${x2} 0 ${x2} ${h}`;
        } else {
          d = `M ${x1} ${h / 2} C ${x1} ${h} ${x2} 0 ${x2} ${h}`;
        }
        path.setAttribute("d", d);
        path.setAttribute("fill", "none");
        path.setAttribute("stroke", e.color);
        path.setAttribute("stroke-width", e.type === "through" ? "1.5" : "2");
        path.setAttribute("opacity", e.type === "through" ? "0.55" : "0.95");
        svg.appendChild(path);
      }

      const circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("cx", String(xOf(row.lane)));
      circle.setAttribute("cy", String(h / 2));
      circle.setAttribute("r", c.isMerge ? "4.5" : "3.5");
      circle.setAttribute("fill", row.color);
      svg.appendChild(circle);
      laneBox.appendChild(svg);

      const meta = document.createElement("div");
      meta.className = "git-meta";
      const subj = document.createElement("div");
      subj.className = "git-subj";
      subj.textContent = c.subject || "(无说明)";
      const sub = document.createElement("div");
      sub.className = "git-sub";
      const short = document.createElement("span");
      short.className = "mono";
      short.textContent = c.short;
      sub.appendChild(short);
      const when = document.createElement("span");
      when.textContent = c.timestamp ? new Date(c.timestamp * 1000).toLocaleString() : "";
      sub.appendChild(when);
      for (const ref of c.refs || []) {
        const chip = document.createElement("span");
        chip.className = "git-ref" + (/HEAD/.test(ref) ? " is-head" : "");
        chip.textContent = ref.replace(/^HEAD -> /, "HEAD→");
        sub.appendChild(chip);
      }
      meta.appendChild(subj);
      meta.appendChild(sub);

      el.appendChild(laneBox);
      el.appendChild(meta);
      el.addEventListener("click", () => selectCommit(c.hash));
      graphEl.appendChild(el);
    });
  }

  async function selectCommit(sha) {
    selectedSha = sha;
    $$(".git-row", graphEl).forEach((el) => el.classList.toggle("is-active", el.dataset.sha === sha));
    $("#git-op-target").value = sha.slice(0, 12);
    explainEl.innerHTML = `<p class="hint">加载中…</p>`;
    try {
      const data = await api(`/repo/explain?repo=${encodeURIComponent(repoPath)}&sha=${encodeURIComponent(sha)}`);
      const cmds = (data.cmds || [])
        .map((c) => (Array.isArray(c) ? c.join(" ") : String(c)))
        .filter(Boolean);
      explainEl.innerHTML = `
        <p><strong class="mono">${data.short}</strong> · ${escapeHtml(data.subject || "")}</p>
        <ul>${(data.bullets || []).map((b) => `<li>${escapeHtml(b.text)}</li>`).join("")}</ul>
        <p class="hint tight" style="margin-top:0.55rem">用到的 git：</p>
        <pre class="mono" style="white-space:pre-wrap;font-size:0.75rem;margin:0.25rem 0 0">${escapeHtml(
          cmds.slice(0, 6).join("\n") || "(无)"
        )}</pre>
      `;
    } catch (e) {
      explainEl.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
    }
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  async function connectBridge() {
    showError("");
    persistConn();
    try {
      const health = await api("/health");
      if (!health.ok) throw new Error("桥响应异常");
      if (!health.git) throw new Error("桥已启动，但本机找不到 git，请安装后重启桥");
      connected = true;
      workspace.hidden = false;
      $("#git-refresh").disabled = false;
      setStatus(
        "is-ok",
        `已连接 · v${health.version}`,
        `${health.git} · 端口见地址栏。下一步：选一个带「仓库」标记的文件夹。`
      );
      await loadRoots();
      const recent = recentRepos()[0];
      if (recent) {
        fsPath = recent;
        $("#git-fs-path").value = recent;
        try {
          await loadFs(recent);
        } catch (_) {
          const roots = await api("/fs/roots");
          await loadFs((roots.roots && roots.roots[0] && roots.roots[0].path) || ".");
        }
      } else {
        const roots = await api("/fs/roots");
        await loadFs((roots.roots && roots.roots[0] && roots.roots[0].path) || ".");
      }
      return true;
    } catch (e) {
      connected = false;
      workspace.hidden = true;
      $("#git-refresh").disabled = true;
      setStatus("is-err", "未连接 Git 桥", e.message || "连接失败");
      showError(e.message);
      return false;
    }
  }

  async function loadRoots() {
    const data = await api("/fs/roots");
    const box = $("#git-roots");
    box.innerHTML = "";
    for (const r of data.roots || []) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ghost-btn";
      btn.textContent = r.label;
      btn.addEventListener("click", () => loadFs(r.path));
      box.appendChild(btn);
    }
    for (const p of recentRepos()) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "secondary-btn";
      btn.textContent = "最近: " + p.split(/[/\\]/).filter(Boolean).slice(-2).join("/");
      btn.title = p;
      btn.addEventListener("click", () => openRepo(p));
      box.appendChild(btn);
    }
  }

  async function loadFs(dir) {
    const data = await api(`/fs/list?path=${encodeURIComponent(dir || ".")}`);
    // If relative failed, try home via roots
    fsPath = data.path;
    $("#git-fs-path").value = fsPath;
    $("#git-fs-meta").textContent = `${data.entries.length} 个文件夹`;
    const list = $("#git-fs-list");
    list.innerHTML = "";
    for (const ent of data.entries) {
      const row = document.createElement("div");
      row.className = "adb-fs-item";
      row.setAttribute("role", "listitem");
      row.innerHTML = `<span class="mono">${escapeHtml(ent.name)}</span>${
        ent.isRepo ? '<span class="git-repo-badge">仓库</span>' : ""
      }`;
      row.addEventListener("click", () => {
        if (ent.isRepo) openRepo(ent.path);
        else loadFs(ent.path);
      });
      row.addEventListener("dblclick", () => openRepo(ent.path));
      list.appendChild(row);
    }
  }

  async function openRepo(pathInput) {
    showError("");
    const data = await api("/repo/open", { method: "POST", body: { path: pathInput } });
    repoPath = data.repo;
    rememberRepo(repoPath);
    repoPanel.hidden = false;
    $("#git-repo-meta").textContent = repoPath;
    $("#git-repo-summary").textContent = `当前分支 ${data.head} · ${data.headSha.slice(0, 7)} · 未提交变更 ${
      data.dirtyCount
    } 项`;
    await refreshRepo();
  }

  async function refreshRepo() {
    if (!repoPath) return;
    showError("");
    const [graph, branches] = await Promise.all([
      api(`/repo/graph?repo=${encodeURIComponent(repoPath)}&max=150`),
      api(`/repo/branches?repo=${encodeURIComponent(repoPath)}`),
    ]);
    renderGraph(graph.commits || []);
    asciiEl.textContent = graph.ascii || "";
    cmdPreview.hidden = false;
    cmdPreview.textContent = "图数据命令：\n" + (graph.cmd || []).join(" ");

    branchesEl.innerHTML = "";
    for (const b of branches.local || []) {
      const row = document.createElement("div");
      row.className = "git-branch-item" + (b.current ? " is-current" : "");
      row.innerHTML = `<span class="mono">${escapeHtml(b.name)}</span>
        <span class="hint tight">${escapeHtml(b.sha.slice(0, 7))}${b.upstream ? " → " + escapeHtml(b.upstream) : ""}</span>`;
      row.title = b.subject || "";
      row.addEventListener("click", () => {
        $("#git-op-target").value = b.name;
        selectCommit(b.sha);
      });
      row.addEventListener("dblclick", () => runOp("checkout", { target: b.name }));
      branchesEl.appendChild(row);
    }
    if ((branches.local || []).length === 0) {
      branchesEl.innerHTML = `<p class="hint">无本地分支</p>`;
    }

    const headCommit = (graph.commits || []).find((c) => (c.refs || []).some((r) => /HEAD/.test(r)));
    if (headCommit) selectCommit(headCommit.hash);
    else if (graph.commits && graph.commits[0]) selectCommit(graph.commits[0].hash);
  }

  async function ensureJsZip() {
    if (typeof globalThis.JSZip === "function") return globalThis.JSZip;
    await new Promise((resolve, reject) => {
      const s = document.createElement("script");
      const v = window.TOOLS_BUILD || "";
      s.src = `./vendor/jszip.min.js${v ? `?v=${v}` : ""}`;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("JSZip 加载失败"));
      document.head.appendChild(s);
    });
    if (typeof globalThis.JSZip !== "function") throw new Error("JSZip 未加载");
    return globalThis.JSZip;
  }

  async function fetchTextAsset(path) {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error(`无法读取 ${path}（${res.status}）`);
    return res.text();
  }

  async function downloadBundle(platform) {
    const JSZip = await ensureJsZip();
    const map = {
      mac: {
        scriptPath: "./git-bridge/start-mac.command",
        scriptName: "start-git-bridge.command",
        zipName: "devtools-git-bridge-mac.zip",
        runHint: "chmod +x start-git-bridge.command && ./start-git-bridge.command",
      },
      win: {
        scriptPath: "./git-bridge/start-win.bat",
        scriptName: "start-git-bridge.bat",
        zipName: "devtools-git-bridge-win.zip",
        runHint: "双击 start-git-bridge.cmd 或 .bat，保持窗口打开",
      },
      linux: {
        scriptPath: "./git-bridge/start-linux.sh",
        scriptName: "start-git-bridge.sh",
        zipName: "devtools-git-bridge-linux.zip",
        runHint: "chmod +x start-git-bridge.sh && ./start-git-bridge.sh",
      },
    };
    const cfg = map[platform];
    if (!cfg) throw new Error("未知平台");
    const [serverJs, scriptRaw, winCmd] = await Promise.all([
      fetchTextAsset("./git-bridge/server.js"),
      fetchTextAsset(cfg.scriptPath),
      platform === "win" ? fetchTextAsset("./git-bridge/start-win.cmd") : Promise.resolve(""),
    ]);
    if (!/devtools-git-bridge|GIT_BRIDGE_TOKEN/.test(serverJs)) {
      throw new Error("server.js 异常，请刷新后重试");
    }
    const scriptText = platform === "win" ? String(scriptRaw).replace(/\r?\n/g, "\r\n") : scriptRaw;
    const readme = [
      "DevTools Git Bridge",
      "",
      "保留：server.js + 启动脚本 在同一文件夹",
      "需要：Node.js + git",
      "启动：" + cfg.runHint,
      "默认 http://127.0.0.1:17890  Token: devtools-git",
      "",
    ].join("\n");
    const zip = new JSZip();
    zip.file("server.js", serverJs);
    zip.file(cfg.scriptName, scriptText, platform === "win" ? {} : { unixPermissions: 0o755 });
    if (platform === "win" && winCmd) {
      zip.file("start-git-bridge.cmd", String(winCmd).replace(/\r?\n/g, "\r\n"));
    }
    zip.file(platform === "win" ? "README.txt" : "使用说明.txt", readme);
    const blob = await zip.generateAsync({ type: "blob" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = cfg.zipName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function runOp(op, params) {
    if (!repoPath) {
      showError("先打开一个仓库");
      return;
    }
    showError("");
    let p = { ...(params || {}) };
    const target = String($("#git-op-target").value || "").trim();
    const newBranch = String($("#git-new-branch").value || "").trim();

    if (op === "checkout" && !p.target) p.target = target;
    if (op === "merge" && !p.branch) {
      p.branch = target;
      p.noFf = true;
    }
    if (op === "rebase" && !p.onto) p.onto = target;
    if (op === "cherry-pick" && !p.sha) p.sha = target;
    if (op === "branch-create") {
      if (!newBranch) {
        showError("填写新分支名");
        return;
      }
      p.name = newBranch;
      if (target) p.start = target;
    }
    if (op === "branch-create-co") {
      if (!newBranch) {
        showError("填写新分支名");
        return;
      }
      // create then checkout -c
      op = "checkout";
      p = { target: newBranch, create: true };
    }

    // Preview via dry description
    const previewMap = {
      fetch: "git fetch --all --prune",
      pull: "git pull --ff-only",
      status: "git status",
      diff: "git diff --stat",
      reflog: "git reflog",
      "remote-list": "git remote -v",
      "worktree-list": "git worktree list --porcelain",
      "stash-push": "git stash push -u",
      "stash-pop": "git stash pop",
      "log-graph": "git log --all --decorate --graph --oneline",
      checkout: `git checkout${p.create ? " -b" : ""} ${p.target || ""}`,
      merge: `git merge --no-ff ${p.branch || ""}`,
      rebase: `git rebase ${p.onto || ""}`,
      "cherry-pick": `git cherry-pick ${p.sha || ""}`,
      "branch-create": `git branch ${p.name || ""}${p.start ? " " + p.start : ""}`,
    };
    cmdPreview.hidden = false;
    cmdPreview.textContent = "即将执行：\n" + (previewMap[op] || op);

    const dangerous = op === "rebase" || op === "merge" || op === "cherry-pick" || op === "stash-pop";
    if (dangerous && !window.confirm(`确认执行？\n\n${previewMap[op] || op}`)) return;

    try {
      const out = await api("/repo/exec", {
        method: "POST",
        body: { repo: repoPath, op, params: p },
      });
      opOut.hidden = false;
      opOut.textContent =
        (out.cmd || []).join(" ") +
        "\n\n" +
        String(out.stdout || "") +
        (out.stderr ? "\n" + out.stderr : "");
      cmdPreview.textContent = "已执行：\n" + (out.cmd || []).join(" ");
      await refreshRepo();
    } catch (e) {
      const d = e.data || {};
      opOut.hidden = false;
      opOut.textContent =
        (d.cmd ? (Array.isArray(d.cmd) ? d.cmd.join(" ") : d.cmd) + "\n\n" : "") +
        (e.message || "") +
        (d.stderr ? "\n" + d.stderr : "");
      showError(e.message);
    }
  }

  $("#git-connect").addEventListener("click", () => connectBridge());
  $("#git-refresh").addEventListener("click", () => refreshRepo().catch((e) => showError(e.message)));
  $("#git-fs-go").addEventListener("click", () => {
    loadFs($("#git-fs-path").value.trim()).catch((e) => showError(e.message));
  });
  $("#git-fs-up").addEventListener("click", () => {
    if (!fsPath) return;
    const parent = fsPath.replace(/[/\\]+$/, "").split(/[/\\]/).slice(0, -1).join(fsPath.includes("\\") ? "\\" : "/") || "/";
    loadFs(parent || "/").catch((e) => showError(e.message));
  });
  $("#git-open-repo").addEventListener("click", () => {
    openRepo($("#git-fs-path").value.trim()).catch((e) => showError(e.message));
  });
  $("#git-show-ascii").addEventListener("change", (ev) => {
    asciiEl.hidden = !ev.target.checked;
  });

  $$("[data-git-bundle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      downloadBundle(btn.getAttribute("data-git-bundle")).catch((e) => showError(e.message));
    });
  });

  $$("[data-git-op]").forEach((btn) => {
    btn.addEventListener("click", () => {
      runOp(btn.getAttribute("data-git-op")).catch((e) => showError(e.message));
    });
  });

  // Auto-try connect when panel shown
  connectBridge().catch(() => {});
})();
