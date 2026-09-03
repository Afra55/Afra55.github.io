(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const BASE_KEY = "devtools-git-base";
  const TOKEN_KEY = "devtools-git-token";
  const RECENT_KEY = "devtools-git-recent";
  const DEFAULT_BASE = "http://127.0.0.1:17888";
  const DEFAULT_TOKEN = "devtools-bridge";
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
  /** "" = 独立 Git 桥；"/git" = 统一桥挂载 */
  let apiPrefix = "/git";
  let bridgeMode = "unified";

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
      {
        "X-Git-Token": token(),
        "X-Adb-Token": token(),
        "X-Ffmpeg-Token": token(),
      },
      opts.body ? { "Content-Type": "application/json" } : {},
      opts.headers || {}
    );
    const res = await fetch(baseUrl() + apiPrefix + path, {
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
      // 1) 优先统一桥（17888，/git）
      let discovered = await window.devtoolsBridgeToken?.discoverBase?.(baseUrl(), token(), {
        kind: "unified",
      });
      if (!discovered?.health && window.devtoolsBridgeToken?.readAutoStart?.("unified") !== false) {
        discovered = await window.devtoolsBridgeToken?.ensureBridgeRunning?.({
          preferredBase: baseUrl() || DEFAULT_BASE,
          token: token(),
          timeoutMs: 12000,
          launch: true,
          kind: "unified",
        });
      }

      let health = null;
      if (
        discovered?.health &&
        (discovered.health.capabilities?.git ||
          discovered.health.gitMount === "/git" ||
          discovered.health.unified)
      ) {
        // 探测 /git/health
        try {
          if (discovered.base && baseUrl() !== discovered.base) {
            baseInput.value = discovered.base;
            persistConn();
          }
          apiPrefix = "/git";
          bridgeMode = "unified";
          const res = await fetch(`${baseUrl()}/git/health`, {
            headers: { "X-Adb-Token": token(), "X-Git-Token": token() },
            cache: "no-store",
          });
          health = await res.json();
          if (!res.ok || !health?.ok) throw new Error(health?.error || "统一桥未挂载 Git");
          try {
            window.devtoolsBridgeToken?.rememberFromHealth?.(discovered.health, "unified");
          } catch (_) {
            /* ignore */
          }
        } catch (e) {
          health = null;
          if (discovered.health.capabilities?.git === false) {
            /* fall through to standalone */
          } else if (!discovered.health.unified) {
            health = null;
          } else {
            // unified but no git module
            throw new Error(
              "统一桥已连接但未挂载 Git。请重新下载「ADB 完整包」（含 git-bridge/）或用 EnvKit 同步后重启桥。"
            );
          }
        }
      }

      // 2) 回退独立 Git 桥 17890
      if (!health) {
        const gitFound = await window.devtoolsBridgeToken?.discoverBase?.(
          "http://127.0.0.1:17890",
          token() === "devtools-bridge" ? "devtools-git" : token(),
          { kind: "git" }
        );
        if (gitFound?.health) {
          baseInput.value = gitFound.base;
          if (tokenInput && token() === "devtools-bridge") tokenInput.value = "devtools-git";
          persistConn();
          apiPrefix = "";
          bridgeMode = "standalone";
          health = gitFound.health;
          try {
            window.devtoolsBridgeToken?.rememberFromHealth?.(health, "git");
          } catch (_) {
            /* ignore */
          }
        }
      }

      if (!health?.ok) {
        throw new Error(
          "无法连接本机桥。推荐：下载 ADB 完整包并启动一次（含 Git）。或单独启动 Git 桥（17890）。"
        );
      }
      if (!health.git) throw new Error("桥已启动，但本机找不到 git，请安装后重启桥");

      try {
        const dirInput = $("#git-install-dir");
        if (dirInput && !dirInput.value) {
          dirInput.value =
            window.devtoolsBridgeToken?.readInstallDir?.(bridgeMode === "git" ? "git" : "unified") ||
            "";
        }
      } catch (_) {
        /* ignore */
      }

      connected = true;
      workspace.hidden = false;
      $("#git-refresh").disabled = false;
      const modeLabel = bridgeMode === "unified" ? "统一桥" : "独立 Git 桥";
      setStatus(
        "is-ok",
        `已连接 · ${modeLabel} v${health.version}`,
        `${health.git} · ${bridgeMode === "unified" ? "API /git · 与 ADB/FFmpeg 同座" : "端口 17890"}`
      );
      await loadOpsCatalog();
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
      setStatus("is-err", "未连接本机桥", e.message || "连接失败");
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

  function parseStatusPayload(data) {
    const rows = [];
    const text = String(data?.porcelain || data?.stdout || "");
    for (const line of text.split("\n")) {
      if (!line || line.startsWith("#")) continue;
      if (line.startsWith("? ")) {
        const path = line.slice(2);
        rows.push({ path, xy: "??", staged: false, unstaged: true, kind: "新", label: `?? ${path}` });
        continue;
      }
      if (line.startsWith("1 ") || line.startsWith("2 ") || line.startsWith("u ")) {
        const parts = line.split(" ");
        const xy = (parts[1] || "..").replace(/\./g, " ");
        const path = parts[parts.length - 1];
        const xyRaw = parts[1] || "..";
        rows.push({
          path,
          xy: xyRaw,
          staged: xyRaw[0] !== ".",
          unstaged: xyRaw[1] !== ".",
          kind: xyRaw.includes("A") ? "加" : xyRaw.includes("D") ? "删" : xyRaw.includes("R") ? "改名" : "改",
          label: `${xyRaw} ${path}`,
        });
        continue;
      }
      // porcelain v1 fallback: XY path
      if (/^[ \\?ACDMRU!]{2} /.test(line)) {
        const xy = line.slice(0, 2);
        let path = line.slice(3);
        if (path.includes(" -> ")) path = path.split(" -> ").pop();
        rows.push({
          path,
          xy,
          staged: xy[0] !== " " && xy[0] !== "?",
          unstaged: xy[1] !== " " || xy[0] === "?",
          kind: xy === "??" ? "新" : xy.includes("A") ? "加" : xy.includes("D") ? "删" : "改",
          label: `${xy} ${path}`,
        });
      }
    }
    return rows;
  }

  let conflictEditPath = "";
  let lastStatus = null;

  async function refreshChanges() {
    const box = $("#git-change-list");
    const hint = $("#git-easy-hint");
    const nowEl = $("#git-easy-now");
    const conflictBox = $("#git-conflict-box");
    const conflictList = $("#git-conflict-list");
    const conflictMeta = $("#git-conflict-meta");
    if (!box || !repoPath) return;
    try {
      const data = await api(`/repo/status?repo=${encodeURIComponent(repoPath)}`);
      lastStatus = data;
      const rows = Array.isArray(data.changes) && data.changes.length
        ? data.changes
        : parseStatusPayload(data).filter((r) => !String(r.xy || "").startsWith("u"));
      const conflicts = Array.isArray(data.conflicts) ? data.conflicts : [];

      if (nowEl) {
        const steps = data.plainSteps || [];
        nowEl.textContent = "现在：" + (steps.join("；") || "一切正常");
        nowEl.classList.toggle("git-easy-now-warn", Boolean(data.inProgress || conflicts.length));
      }

      if (conflictBox) {
        conflictBox.hidden = !(data.inProgress || conflicts.length);
        if (conflictMeta) {
          conflictMeta.textContent = data.inProgress
            ? `进行中：${data.inProgress} · 冲突 ${conflicts.length} 个`
            : `冲突 ${conflicts.length} 个`;
        }
        if (conflictList) {
          conflictList.innerHTML = "";
          if (!conflicts.length) {
            conflictList.innerHTML = `<p class="hint tight">没有冲突文件了。若合并仍在进行，点「继续合并」。</p>`;
          } else {
            for (const c of conflicts) {
              const row = document.createElement("div");
              row.className = "git-change-item git-conflict-item";
              row.innerHTML = `<span class="git-change-badge mono">冲突</span>
                <span class="mono" title="${escapeHtml(c.path)}">${escapeHtml(c.path)}</span>
                <button type="button" class="ghost-btn" data-conflict-ours="${escapeHtml(c.path)}">留我的</button>
                <button type="button" class="ghost-btn" data-conflict-theirs="${escapeHtml(c.path)}">留对方</button>
                <button type="button" class="ghost-btn" data-conflict-edit="${escapeHtml(c.path)}">打开编辑</button>`;
              conflictList.appendChild(row);
            }
            conflictList.querySelectorAll("[data-conflict-edit]").forEach((btn) => {
              btn.addEventListener("click", () => {
                openConflictEditor(btn.getAttribute("data-conflict-edit")).catch((e) => showError(e.message));
              });
            });
            conflictList.querySelectorAll("[data-conflict-ours]").forEach((btn) => {
              btn.addEventListener("click", () => {
                conflictTake("ours", btn.getAttribute("data-conflict-ours")).catch((e) => showError(e.message));
              });
            });
            conflictList.querySelectorAll("[data-conflict-theirs]").forEach((btn) => {
              btn.addEventListener("click", () => {
                conflictTake("theirs", btn.getAttribute("data-conflict-theirs")).catch((e) => showError(e.message));
              });
            });
          }
        }
      }

      box.innerHTML = "";
      if (!rows.length) {
        box.innerHTML = `<p class="hint tight">没有待保存的改动。</p>`;
        if (hint) hint.textContent = "改完文件后点「刷新状态」。";
      } else {
        for (const r of rows) {
          const row = document.createElement("label");
          row.className = "git-change-item";
          const checked = r.unstaged || !r.staged ? "checked" : "";
          row.innerHTML = `<input type="checkbox" data-git-path="${escapeHtml(r.path)}" ${checked} />
            <span class="git-change-badge mono">${escapeHtml(r.kind || "改")}</span>
            <span class="mono" title="${escapeHtml(r.path)}">${escapeHtml(r.path)}</span>`;
          box.appendChild(row);
        }
        if (hint) hint.textContent = `共 ${rows.length} 项。勾选 → 写说明 →「保存到历史」→ 需要时「上传」。`;
      }

      // branch select for 换工作线
      const sel = $("#git-easy-branch");
      if (sel && !sel.dataset.wiredOnce) {
        sel.dataset.wiredOnce = "1";
      }
      if (sel) {
        const prev = sel.value;
        const branches = await api(`/repo/branches?repo=${encodeURIComponent(repoPath)}`).catch(() => ({ local: [] }));
        sel.innerHTML = "";
        for (const b of branches.local || []) {
          const opt = document.createElement("option");
          opt.value = b.name;
          opt.textContent = (b.current ? "● " : "") + b.name;
          if (b.current) opt.selected = true;
          sel.appendChild(opt);
        }
        if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
      }

      if ($("#git-repo-summary") && data.branch) {
        const bits = [`当前工作线 ${data.branch}`];
        if (data.upstream) bits.push(`跟踪 ${data.upstream}`);
        if (data.ahead) bits.push(`可上传 ${data.ahead}`);
        if (data.behind) bits.push(`可更新 ${data.behind}`);
        bits.push(`未保存 ${data.dirtyCount || 0} 项`);
        $("#git-repo-summary").textContent = bits.join(" · ");
      }
    } catch (e) {
      box.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
    }
  }

  async function openConflictEditor(filePath) {
    conflictEditPath = filePath;
    const editor = $("#git-conflict-editor");
    const pathEl = $("#git-conflict-path");
    const ta = $("#git-conflict-text");
    if (!editor || !ta) return;
    const data = await api(
      `/repo/read-file?repo=${encodeURIComponent(repoPath)}&path=${encodeURIComponent(filePath)}`
    );
    if (pathEl) pathEl.textContent = filePath;
    ta.value = data.content || "";
    editor.hidden = false;
    $$(".git-conflict-item").forEach((el) => {
      el.classList.toggle("is-active", el.textContent.includes(filePath));
    });
  }

  async function conflictTake(side, filePath) {
    const target = filePath || conflictEditPath;
    if (!target) return showError("先点一个冲突文件的「留我的 / 留对方」或打开编辑");
    conflictEditPath = target;
    const op = side === "ours" ? "checkout-ours" : "checkout-theirs";
    await runOp(op, { path: target }, { skipConfirm: true, skipRefresh: true });
    await runOp("add", { path: target }, { skipConfirm: true, skipRefresh: true });
    showError("");
    opOut.hidden = false;
    opOut.textContent = `已选${side === "ours" ? "我的" : "对方"}版本并标记解决：${target}`;
    const editor = $("#git-conflict-editor");
    if (editor && !editor.hidden) await openConflictEditor(target);
    await refreshChanges();
  }

  async function conflictSaveResolved() {
    if (!conflictEditPath) return showError("先打开一个冲突文件");
    const ta = $("#git-conflict-text");
    await api("/repo/write-file", {
      method: "POST",
      body: { repo: repoPath, file: conflictEditPath, content: ta?.value ?? "" },
    });
    await runOp("add", { path: conflictEditPath }, { skipConfirm: true, skipRefresh: true });
    showError("");
    opOut.hidden = false;
    opOut.textContent = `已保存并标记解决：${conflictEditPath}`;
    await refreshChanges();
  }

  async function conflictContinue() {
    const kind = lastStatus?.inProgress || "merge";
    const op =
      kind === "rebase"
        ? "rebase-continue"
        : kind === "cherry-pick"
          ? "cherry-pick-continue"
          : kind === "revert"
            ? "revert-continue"
            : "merge-continue";
    await runOp(op, {}, { skipConfirm: true });
    await refreshChanges();
  }

  async function conflictAbort() {
    const kind = lastStatus?.inProgress || "merge";
    const op =
      kind === "rebase"
        ? "rebase-abort"
        : kind === "cherry-pick"
          ? "cherry-pick-abort"
          : kind === "revert"
            ? "revert-abort"
            : "merge-abort";
    if (!window.confirm("确定放弃这次合并/改写？工作区会回到操作前。")) return;
    await runOp(op, {}, { skipConfirm: true });
    await refreshChanges();
  }

  function selectedChangePaths() {
    return $$("#git-change-list input[type=checkbox]:checked")
      .map((el) => el.getAttribute("data-git-path"))
      .filter(Boolean);
  }

  async function easyStage(all) {
    if (!repoPath) return showError("先打开一个仓库");
    if (all) {
      await runOp("add-all", {}, { skipConfirm: true });
    } else {
      const paths = selectedChangePaths();
      if (!paths.length) return showError("先勾选要保存的文件");
      for (const p of paths) {
        await runOp("add", { path: p }, { skipConfirm: true, skipRefresh: true });
      }
    }
    await refreshChanges();
  }

  async function easyUnstage() {
    if (!repoPath) return showError("先打开一个仓库");
    const paths = selectedChangePaths();
    if (!paths.length) return showError("先勾选文件");
    for (const p of paths) {
      await runOp("restore", { path: p, staged: true }, { skipConfirm: true, skipRefresh: true });
    }
    await refreshChanges();
  }

  async function easyCommit() {
    if (!repoPath) return showError("先打开一个仓库");
    const msg = String($("#git-easy-msg")?.value || $("#git-commit-msg")?.value || "").trim();
    if (!msg) return showError("先写一句说明，比如「修好登录按钮」");
    if ($("#git-commit-msg")) $("#git-commit-msg").value = msg;
    const paths = selectedChangePaths();
    if (paths.length) {
      for (const p of paths) await runOp("add", { path: p }, { skipConfirm: true, skipRefresh: true });
    }
    await runOp("commit", { message: msg }, { skipConfirm: true });
    if ($("#git-easy-msg")) $("#git-easy-msg").value = "";
    await refreshChanges();
  }

  async function easyPush() {
    if (!repoPath) return showError("先打开一个仓库");
    if (!window.confirm("把本地已保存的改动上传到网上？\n（相当于 git push）")) return;
    await runOp("push", {}, { skipConfirm: true });
    await refreshChanges();
  }

  async function easyPull() {
    if (!repoPath) return showError("先打开一个仓库");
    if (!window.confirm("从网上拉最新改动到本地？\n（相当于 git pull，若两边都改过同一文件可能产生冲突）")) return;
    await runOp("pull", {}, { skipConfirm: true });
    await refreshChanges();
  }

  async function easyStash() {
    if (!repoPath) return showError("先打开一个仓库");
    if (!window.confirm("先把未保存的改动临时收起来，让工作区变干净？\n之后可用「取出收起的改动」拿回来。")) return;
    await runOp("stash-push", {}, { skipConfirm: true });
    await refreshChanges();
  }

  async function easyStashPop() {
    if (!repoPath) return showError("先打开一个仓库");
    if (!window.confirm("取出最近一次收起来的改动？\n若和当前文件打架，会出现冲突，按上方提示处理即可。")) return;
    await runOp("stash-pop", {}, { skipConfirm: true });
    await refreshChanges();
  }

  async function easyUndo() {
    if (!repoPath) return showError("先打开一个仓库");
    if (!window.confirm("撤销上一次「保存到历史」？改动还会留在文件里，只是从历史里拿掉最近一笔。")) return;
    await runOp("reset-soft-1", {}, { skipConfirm: true });
    await refreshChanges();
  }

  async function easySwitch() {
    if (!repoPath) return showError("先打开一个仓库");
    const name = String($("#git-easy-branch")?.value || "").trim();
    if (!name) return showError("先选一条工作线");
    if (!window.confirm(`切换到工作线「${name}」？\n未保存的改动若冲突会失败，可先「收起来」再切。`)) return;
    await runOp("checkout", { target: name }, { skipConfirm: true });
    await refreshChanges();
  }

  async function easyNewBranch() {
    if (!repoPath) return showError("先打开一个仓库");
    const name = String($("#git-easy-newbr")?.value || "").trim();
    if (!name) return showError("先填新工作线名字");
    if (!window.confirm(`创建并切换到新工作线「${name}」？`)) return;
    if ($("#git-new-branch")) $("#git-new-branch").value = name;
    await runOp("branch-create-co", {}, { skipConfirm: true });
    await refreshChanges();
  }

  async function handleDroppedPaths(paths) {
    if (!paths.length) {
      showError("浏览器没给出文件夹绝对路径。请把路径粘贴到上方输入框，或用目录列表点开。");
      return;
    }
    const target = paths[0];
    $("#git-fs-path").value = target;
    try {
      await openRepo(target);
    } catch (_) {
      await loadFs(target);
      showError("已打开该目录。若它是 git 仓库，再点「当作仓库打开」。");
    }
  }

  function wireDropzone() {
    const zone = $("#git-dropzone");
    if (!zone) return;
    const mark = (on) => zone.classList.toggle("is-dragover", on);
    ["dragenter", "dragover"].forEach((evName) => {
      zone.addEventListener(evName, (e) => {
        e.preventDefault();
        mark(true);
      });
    });
    zone.addEventListener("dragleave", (e) => {
      e.preventDefault();
      mark(false);
    });
    zone.addEventListener("drop", (e) => {
      e.preventDefault();
      mark(false);
      const paths = window.devtoolsBridgeToken?.pathsFromDataTransfer?.(e.dataTransfer) || [];
      handleDroppedPaths(paths).catch((err) => showError(err.message));
    });
    const also = [$("#git-fs-path"), $("#git-fs-list"), workspace].filter(Boolean);
    for (const el of also) {
      el.addEventListener("dragover", (e) => e.preventDefault());
      el.addEventListener("drop", (e) => {
        e.preventDefault();
        const paths = window.devtoolsBridgeToken?.pathsFromDataTransfer?.(e.dataTransfer) || [];
        handleDroppedPaths(paths).catch((err) => showError(err.message));
      });
    }
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
    await refreshChanges();
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
    const [serverJs, opsJs, scriptRaw, winCmd] = await Promise.all([
      fetchTextAsset("./git-bridge/server.js"),
      fetchTextAsset("./git-bridge/git-ops.js"),
      fetchTextAsset(cfg.scriptPath),
      platform === "win" ? fetchTextAsset("./git-bridge/start-win.cmd") : Promise.resolve(""),
    ]);
    if (!/devtools-git-bridge|GIT_BRIDGE_TOKEN/.test(serverJs)) {
      throw new Error("server.js 异常，请刷新后重试");
    }
    if (!/OP_DEFS|buildOp/.test(opsJs)) {
      throw new Error("git-ops.js 异常，请刷新后重试");
    }
    const scriptText = platform === "win" ? String(scriptRaw).replace(/\r?\n/g, "\r\n") : scriptRaw;
    const readme = [
      "DevTools Git Bridge",
      "",
      "保留：server.js + git-ops.js + 启动脚本 在同一文件夹",
      "需要：Node.js + git",
      "启动：" + cfg.runHint,
      "默认 http://127.0.0.1:17890  Token: devtools-git",
      "",
    ].join("\n");
    const zip = new JSZip();
    zip.file("server.js", serverJs);
    zip.file("git-ops.js", opsJs);
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

  let opsCatalog = { ops: [], groups: [] };

  function catalogItem(op) {
    for (const g of opsCatalog.groups || []) {
      const hit = (g.items || []).find((it) => it.id === op);
      if (hit) return hit;
    }
    return null;
  }

  function fillIf(p, key, val) {
    if (val && (p[key] == null || p[key] === "")) p[key] = val;
  }

  function fillOpParams(op, params) {
    const p = { ...(params || {}) };
    const target = String($("#git-op-target")?.value || "").trim();
    const newBranch = String($("#git-new-branch")?.value || "").trim();
    const filePath = String($("#git-op-path")?.value || "").trim();
    const message = String($("#git-commit-msg")?.value || "").trim();
    const cloneUrl = String($("#git-clone-url")?.value || "").trim();
    const sha = target || selectedSha;

    if (op === "checkout" || op === "switch") fillIf(p, "target", target);
    if (op === "merge") {
      fillIf(p, "branch", target);
      if (p.noFf == null && p.ffOnly == null) p.noFf = true;
    }
    if (op === "rebase") fillIf(p, "onto", target);
    if (
      op === "cherry-pick" ||
      op === "revert" ||
      op === "show" ||
      op === "show-patch" ||
      op === "reset" ||
      op === "describe" ||
      op === "name-rev" ||
      op === "bisect-bad" ||
      op === "bisect-good"
    ) {
      fillIf(p, "sha", sha);
    }
    if (op === "show-file") {
      fillIf(p, "sha", sha);
      fillIf(p, "path", filePath);
    }
    if (op === "blame" || op === "add" || op === "restore" || op === "checkout-ours" || op === "checkout-theirs") {
      fillIf(p, "path", filePath);
    }
    if (op === "blame") fillIf(p, "sha", target);
    if (op === "commit") fillIf(p, "message", message);
    if (op === "commit-amend") {
      if (message) fillIf(p, "message", message);
      else if (p.noEdit == null) p.noEdit = true;
    }
    if (op === "stash-push") fillIf(p, "message", message);
    if (op === "stash-apply" || op === "stash-drop" || op === "stash-show") fillIf(p, "ref", target);
    if (op === "stash-clear") p.confirmClear = true;
    if (op === "clean") p.confirmClean = true;
    if (op === "rev-parse") fillIf(p, "ref", target);
    if (op === "config-get") fillIf(p, "key", target);
    if (op === "branch-create") {
      fillIf(p, "name", newBranch);
      fillIf(p, "start", target);
    }
    if (op === "branch-delete") fillIf(p, "name", target || newBranch);
    if (op === "branch-rename") {
      fillIf(p, "oldName", target);
      fillIf(p, "newName", newBranch);
    }
    if (op === "tag-create" || op === "tag-delete") {
      fillIf(p, "name", newBranch || target);
      fillIf(p, "sha", selectedSha);
      fillIf(p, "message", message);
    }
    if (op === "remote-add" || op === "remote-set-url") {
      fillIf(p, "name", newBranch || "origin");
      fillIf(p, "url", cloneUrl || target);
    }
    if (op === "remote-remove") fillIf(p, "name", target || "origin");
    if (op === "remote-rename") {
      fillIf(p, "oldName", target);
      fillIf(p, "newName", newBranch);
    }
    if (op === "push" || op === "push-lease") fillIf(p, "branch", target);
    if (op === "worktree-add") {
      fillIf(p, "path", filePath);
      fillIf(p, "ref", target);
    }
    if (op === "worktree-remove") fillIf(p, "path", filePath || target);
    return p;
  }

  async function loadOpsCatalog() {
    const box = $("#git-ops-catalog");
    const count = $("#git-ops-count");
    if (!box) return;
    try {
      const data = await api("/repo/ops");
      opsCatalog = data || { ops: [], groups: [] };
      renderOpsCatalog(opsCatalog);
    } catch (e) {
      opsCatalog = { ops: [], groups: [] };
      if (count) count.textContent = "";
      box.innerHTML = `<p class="hint">当前桥没有完整命令目录（需要 v0.2.0+）。请重新下载 ZIP 并重启桥。${
        e.message ? " " + escapeHtml(e.message) : ""
      }</p>`;
    }
  }

  function renderOpsCatalog(data) {
    const box = $("#git-ops-catalog");
    const count = $("#git-ops-count");
    if (!box) return;
    const ops = data.ops || [];
    if (count) count.textContent = `${ops.length} 条`;
    box.innerHTML = "";
    for (const g of data.groups || []) {
      const wrap = document.createElement("div");
      wrap.className = "git-ops-group";
      const h = document.createElement("h3");
      h.className = "git-ops-group-title";
      h.textContent = g.name;
      wrap.appendChild(h);
      const row = document.createElement("div");
      row.className = "btn-row tool-actions";
      for (const item of g.items || []) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = item.dangerous ? "ghost-btn" : "secondary-btn";
        btn.textContent = item.title;
        btn.title = item.dangerous ? `${item.id}（会改仓库，执行前确认）` : item.id;
        btn.addEventListener("click", () => runOp(item.id).catch((e) => showError(e.message)));
        row.appendChild(btn);
      }
      wrap.appendChild(row);
      box.appendChild(wrap);
    }
  }

  async function runOp(op, params, opts = {}) {
    if (!repoPath) {
      showError("先打开一个仓库");
      return;
    }
    showError("");
    let p = fillOpParams(op, params);
    if (op === "branch-create") {
      if (!p.name) {
        showError("填写新分支名");
        return;
      }
    }
    if (op === "branch-create-co") {
      const name = String($("#git-new-branch")?.value || "").trim();
      if (!name) {
        showError("填写新分支名");
        return;
      }
      op = "checkout";
      p = { target: name, create: true };
    }

    const item = catalogItem(op);
    const preview = item ? `git ${item.title}` : op;
    cmdPreview.hidden = false;
    cmdPreview.textContent = "即将执行：\n" + preview;

    const fallbackDangerous = new Set([
      "merge",
      "rebase",
      "cherry-pick",
      "stash-pop",
      "stash-clear",
      "stash-drop",
      "pull",
      "push",
      "reset",
      "reset-soft-1",
      "clean",
      "commit-amend",
      "restore-workdir",
      "checkout-ours",
      "checkout-theirs",
      "merge-continue",
      "merge-abort",
      "rebase-continue",
      "rebase-abort",
    ]);
    const dangerous = !!(item && item.dangerous) || fallbackDangerous.has(op);
    if (dangerous && !opts.skipConfirm && !window.confirm(`确认执行？\n\n${preview}\n操作：${op}`)) return;

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
      if (!opts.skipRefresh) await refreshRepo();
      return out;
    } catch (e) {
      const d = e.data || {};
      opOut.hidden = false;
      opOut.textContent =
        (d.cmd ? (Array.isArray(d.cmd) ? d.cmd.join(" ") : d.cmd) + "\n\n" : "") +
        (e.message || "") +
        (d.stderr ? "\n" + d.stderr : "");
      showError(e.message);
      throw e;
    }
  }

  async function initRepoHere() {
    const dir = String($("#git-fs-path").value || "").trim();
    if (!dir) {
      showError("先打开一个目录");
      return;
    }
    if (!window.confirm(`在此目录执行 git init？\n\n${dir}`)) return;
    showError("");
    const data = await api("/repo/init", { method: "POST", body: { path: dir } });
    await openRepo(data.repo || dir);
    opOut.hidden = false;
    opOut.textContent = (Array.isArray(data.cmd) ? data.cmd.join(" ") : data.cmd || "git init");
  }

  async function cloneRepoHere() {
    const url = String($("#git-clone-url")?.value || "").trim();
    const dir = String($("#git-fs-path").value || "").trim();
    if (!url) {
      showError("填写 clone URL");
      return;
    }
    if (!window.confirm(`克隆到当前目录？\n\n${url}\n→ ${dir || "(默认 DevToolsRepos)"}`)) return;
    showError("");
    const data = await api("/repo/clone", { method: "POST", body: { url, dir: dir || undefined } });
    await openRepo(data.repo);
    opOut.hidden = false;
    opOut.textContent = (Array.isArray(data.cmd) ? data.cmd.join(" ") : "") + "\n\n" + (data.stdout || "");
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
  $("#git-init")?.addEventListener("click", () => initRepoHere().catch((e) => showError(e.message)));
  $("#git-clone")?.addEventListener("click", () => cloneRepoHere().catch((e) => showError(e.message)));
  $("#git-easy-refresh")?.addEventListener("click", () => refreshChanges().catch((e) => showError(e.message)));
  $("#git-easy-stage")?.addEventListener("click", () => easyStage(false).catch((e) => showError(e.message)));
  $("#git-easy-stage-all")?.addEventListener("click", () => easyStage(true).catch((e) => showError(e.message)));
  $("#git-easy-unstage")?.addEventListener("click", () => easyUnstage().catch((e) => showError(e.message)));
  $("#git-easy-commit")?.addEventListener("click", () => easyCommit().catch((e) => showError(e.message)));
  $("#git-easy-push")?.addEventListener("click", () => easyPush().catch((e) => showError(e.message)));
  $("#git-easy-pull")?.addEventListener("click", () => easyPull().catch((e) => showError(e.message)));
  $("#git-easy-stash")?.addEventListener("click", () => easyStash().catch((e) => showError(e.message)));
  $("#git-easy-stash-pop")?.addEventListener("click", () => easyStashPop().catch((e) => showError(e.message)));
  $("#git-easy-undo")?.addEventListener("click", () => easyUndo().catch((e) => showError(e.message)));
  $("#git-easy-switch")?.addEventListener("click", () => easySwitch().catch((e) => showError(e.message)));
  $("#git-easy-newbr-go")?.addEventListener("click", () => easyNewBranch().catch((e) => showError(e.message)));
  $("#git-conflict-ours")?.addEventListener("click", () => conflictTake("ours").catch((e) => showError(e.message)));
  $("#git-conflict-theirs")?.addEventListener("click", () => conflictTake("theirs").catch((e) => showError(e.message)));
  $("#git-conflict-save")?.addEventListener("click", () => conflictSaveResolved().catch((e) => showError(e.message)));
  $("#git-conflict-close")?.addEventListener("click", () => {
    const ed = $("#git-conflict-editor");
    if (ed) ed.hidden = true;
    conflictEditPath = "";
  });
  $("#git-conflict-continue")?.addEventListener("click", () => conflictContinue().catch((e) => showError(e.message)));
  $("#git-conflict-abort")?.addEventListener("click", () => conflictAbort().catch((e) => showError(e.message)));
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

  wireDropzone();

  window.devtoolsBridgeToken?.bindBridgeLaunchUI?.({
    kind: "unified",
    dirInput: $("#git-install-dir"),
    saveBtn: $("#git-install-dir-save"),
    launchBtn: $("#git-bridge-launch"),
    autoEl: $("#git-bridge-autostart"),
    getPreferredBase: () => baseUrl() || DEFAULT_BASE,
    getToken: () => token(),
    onStatus: (kind, title, text) => setStatus(kind, title, text),
    onConnected: async () => {
      await connectBridge();
    },
    toast: (msg) => {
      showError("");
      setStatus("is-ok", "桥目录", msg);
    },
  });

  // Auto-try connect when panel shown（统一桥协议）
  void (async () => {
    if (window.devtoolsBridgeToken?.readAutoStart?.("unified") === false) {
      connectBridge().catch(() => {});
      return;
    }
    try {
      const found = await window.devtoolsBridgeToken?.ensureBridgeRunning?.({
        preferredBase: baseUrl() || DEFAULT_BASE,
        token: token(),
        timeoutMs: 20000,
        launch: true,
        kind: "unified",
      });
      if (found?.health) await connectBridge();
      else connectBridge().catch(() => {});
    } catch (_) {
      connectBridge().catch(() => {});
    }
  })();
})();
