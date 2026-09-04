(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const BASE_KEY = "devtools-git-base";
  const TOKEN_KEY = "devtools-git-token";
  const RECENT_KEY = "devtools-git-recent";
  const HIST_KEY = "devtools-git-exec-history-v1";
  const HIST_KEEP_MS = 7 * 86400000;
  const HIST_MAX = 300;
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
  /** apiPrefix：统一桥挂载为 "/git"（不再支持独立 17890） */
  let apiPrefix = "/git";
  let bridgeMode = "unified";
  let lastBranches = { local: [], remote: [], tags: [] };
  let confirmResolver = null;

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
    errEl.textContent = humanizeGitError(msg);
  }

  /** 面板内确认条，替代大部分 window.confirm */
  function askConfirm(message) {
    return new Promise((resolve) => {
      const bar = $("#git-confirm-bar");
      const text = $("#git-confirm-text");
      if (!bar || !text) {
        resolve(window.confirm(message));
        return;
      }
      if (confirmResolver) {
        const prev = confirmResolver;
        confirmResolver = null;
        prev(false);
      }
      confirmResolver = resolve;
      text.textContent = message;
      bar.hidden = false;
      try {
        bar.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } catch (_) {
        /* ignore */
      }
    });
  }

  function settleConfirm(ok) {
    const bar = $("#git-confirm-bar");
    if (bar) bar.hidden = true;
    if (!confirmResolver) return;
    const r = confirmResolver;
    confirmResolver = null;
    r(!!ok);
  }

  function setReadyVisible(show) {
    const el = $("#git-ready");
    if (el) el.hidden = !show;
  }

  function humanizeGitError(raw) {
    const s = String(raw || "");
    if (!s) return s;
    if (/non-fast-forward|Not possible to fast-forward|cannot fast-forward/i.test(s)) {
      return "网上和本地都有新改动，不能直接快进。把「更新方式」改成「合并更新」或「变基更新」再试。";
    }
    if (/divergent branches|need to specify how to reconcile/i.test(s)) {
      return "本地和网上各走各的了。请选「合并更新」或「变基更新」。";
    }
    if (/no upstream|no tracking information|has no upstream branch|set-upstream/i.test(s)) {
      return "这条工作线还没绑定网上对应线。点「② 上传我的改动」会自动建立绑定；或先确认远程已有同名分支。";
    }
    if (/prohibited by Gerrit|not permitted to create|can not update|You need 'Create Change'|remote rejected.*refs\/heads|Push to refs\/for/i.test(s)) {
      return "远程像是 Gerrit，禁止直接推分支。请先点「配置推送规则」（remote.origin.push → refs/heads/*:refs/for/*），再用「上传」或「送审」。";
    }
    if (/Authentication failed|could not read Username|Permission denied \(publickey\)|403 Forbidden|401 Unauthorized|terminal prompts disabled/i.test(s)) {
      return "远程拒绝访问（账号/权限问题）。请在本机自行登录 Git 后再试本页操作。";
    }
    if (/Your local changes|would be overwritten|uncommitted changes/i.test(s)) {
      return "有未保存的文件改动挡着了。先「收起改动」或先「保存到历史」，再重试。";
    }
    if (/CONFLICT|conflict|Merge conflict|fixing conflicts/i.test(s)) {
      return "出现冲突了。请到上方「两边改冲突了」区域：留我的 / 留对方 / 手改，然后继续合并。";
    }
    if (/not a git repository/i.test(s)) {
      return "当前目录还不是仓库。可点「在此新建空仓库」或「从网址下载仓库」。";
    }
    if (/pathspec|does not match any|ambiguous argument/i.test(s) && /reset|checkout/i.test(s)) {
      return "找不到对应的网上跟踪线。请先「只看网上有没有新的」，确认已设置上游分支。";
    }
    if (/Cannot rebase|no rebase in progress|no merge in progress/i.test(s)) {
      return "当前没有进行中的合并/变基，无需继续或中止。";
    }
    if (/patch does not apply|corrupt patch|does not exist/i.test(s) && /am|apply|patch/i.test(s)) {
      return "补丁套不上或路径不对。请检查补丁文件路径，或改用「只改文件不记提交」。";
    }
    return s;
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
      el.className =
        "git-row" +
        (c.isMerge ? " is-merge" : "") +
        (c.hash === selectedSha ? " is-active" : "") +
        ((c.refs || []).some((r) => /HEAD/.test(r)) ? " is-head-row" : "");
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
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "git-ref" + (/HEAD/.test(ref) ? " is-head" : "");
        chip.textContent = ref.replace(/^HEAD -> /, "HEAD→");
        const switchTarget = refToSwitchTarget(ref);
        if (switchTarget) {
          chip.title = `切换到 ${switchTarget.replace(/^remote:/, "")}`;
          chip.addEventListener("click", (ev) => {
            ev.stopPropagation();
            switchToBranch(switchTarget).catch((e) => showError(e.message));
          });
        } else {
          chip.disabled = true;
          chip.title = ref;
        }
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

      // 只认统一桥：不再回退独立 Git 桥 17890
      if (!health?.ok) {
        throw new Error(
          "无法连接统一桥（17888 /git）。请下载统一完整包，运行 adb-bridge 启动脚本；勿再单独启动 17890。"
        );
      }
      if (!health.git) throw new Error("桥已启动，但本机找不到 git，请安装后重启桥");

      try {
        const dirInput = $("#git-install-dir");
        if (dirInput && !dirInput.value) {
          dirInput.value = window.devtoolsBridgeToken?.readInstallDir?.("unified") || "";
        }
      } catch (_) {
        /* ignore */
      }

      connected = true;
      workspace.hidden = false;
      setReadyVisible(false);
      $("#git-refresh").disabled = false;
      setStatus(
        "is-ok",
        `已连接 · 统一桥 v${health.version}`,
        `${health.git} · API /git · 与 ADB/FFmpeg 同座`
      );
      await loadOpsCatalog();
      renderExecHistory();
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
      setReadyVisible(true);
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
    renderExecHistory();
  }

  function parseStatusPayload(data) {
    const rows = [];
    const text = String(data?.porcelain || data?.stdout || "");
    const lines = text.includes("\0") ? text.split("\0") : text.split("\n");
    for (const line of lines) {
      if (!line || line.startsWith("#")) continue;
      if (line.startsWith("? ") || line.startsWith("! ")) {
        const path = line.slice(2);
        if (path) rows.push({ path, xy: "??", staged: false, unstaged: true, kind: "新", label: `?? ${path}` });
        continue;
      }
      if (line.startsWith("u ")) {
        const m = line.match(/^u (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/);
        const path = m ? m[10] : "";
        const xyRaw = m ? m[1] : "UU";
        if (path) {
          rows.push({
            path,
            xy: xyRaw,
            staged: false,
            unstaged: true,
            kind: "冲突",
            label: `${xyRaw} ${path}`,
          });
        }
        continue;
      }
      if (line.startsWith("1 ")) {
        const m = line.match(/^1 (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/);
        const xyRaw = m ? m[1] : "..";
        const path = m ? m[8] : "";
        if (!path) continue;
        rows.push({
          path,
          xy: xyRaw,
          staged: xyRaw[0] !== ".",
          unstaged: xyRaw[1] !== ".",
          kind: xyRaw.includes("A") ? "加" : xyRaw.includes("D") ? "删" : "改",
          label: `${xyRaw} ${path}`,
        });
        continue;
      }
      if (line.startsWith("2 ")) {
        // 2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\t<origPath>
        const m = line.match(/^2 (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (\S+) (.*)$/);
        const xyRaw = m ? m[1] : "R.";
        let path = m ? m[9] : "";
        if (path.includes("\t")) path = path.split("\t")[0];
        if (!path) continue;
        rows.push({
          path,
          xy: xyRaw,
          staged: xyRaw[0] !== ".",
          unstaged: xyRaw[1] !== ".",
          kind: "改名",
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

  function refToSwitchTarget(ref) {
    let r = String(ref || "").trim();
    if (!r || r === "HEAD" || /^tag:/i.test(r)) return "";
    r = r.replace(/^HEAD\s*->\s*/, "");
    if (!r || r === "HEAD") return "";
    if (/^(origin|upstream)\//.test(r)) return "remote:" + r;
    return r;
  }

  function branchActionBtn(label, className, onClick) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = className || "ghost-btn";
    btn.textContent = label;
    btn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      Promise.resolve(onClick()).catch((e) => showError(e.message));
    });
    return btn;
  }

  function makeBranchCard(b, kind) {
    const card = document.createElement("div");
    card.className =
      "git-branch-card" +
      (b.current ? " is-current" : "") +
      (kind === "remote" ? " is-remote" : "");

    const head = document.createElement("div");
    head.className = "git-branch-card-head";
    const nameEl = document.createElement("button");
    nameEl.type = "button";
    nameEl.className = "git-branch-name mono";
    nameEl.textContent = b.name;
    nameEl.title = b.sha ? b.sha.slice(0, 12) : b.name;
    nameEl.addEventListener("click", () => {
      if ($("#git-op-target")) $("#git-op-target").value = b.name;
      if (b.sha) selectCommit(b.sha);
    });
    head.appendChild(nameEl);
    if (b.current) {
      const pill = document.createElement("span");
      pill.className = "git-branch-pill";
      pill.textContent = "当前";
      head.appendChild(pill);
    }
    const trackBits = [];
    if (b.upstream) trackBits.push(b.upstream);
    if (b.ahead) trackBits.push("↑" + b.ahead);
    if (b.behind) trackBits.push("↓" + b.behind);
    if (trackBits.length) {
      const track = document.createElement("span");
      track.className = "hint tight git-branch-track";
      track.textContent = trackBits.join(" · ");
      head.appendChild(track);
    }

    const subj = document.createElement("div");
    subj.className = "hint tight git-branch-subj";
    subj.textContent = (b.subject || "").slice(0, 72) || (b.sha ? b.sha.slice(0, 7) : "");

    const actions = document.createElement("div");
    actions.className = "git-branch-actions";
    if (kind === "local") {
      if (!b.current) {
        actions.appendChild(branchActionBtn("切换", "secondary-btn", () => switchToBranch(b.name)));
        actions.appendChild(branchActionBtn("并入当前", "ghost-btn", () => mergeBranchIntoCurrent(b.name)));
        actions.appendChild(branchActionBtn("删除", "ghost-btn", () => deleteLocalBranch(b.name)));
      } else {
        const tip = document.createElement("span");
        tip.className = "hint tight";
        tip.textContent = "正在这条线";
        actions.appendChild(tip);
      }
    } else {
      actions.appendChild(
        branchActionBtn("检出为本地", "secondary-btn", () => switchToBranch("remote:" + b.name))
      );
    }

    card.appendChild(head);
    card.appendChild(subj);
    card.appendChild(actions);
    return card;
  }

  function renderBranchWorkbench(branches) {
    if (!branchesEl) return;
    lastBranches = branches || { local: [], remote: [], tags: [] };
    branchesEl.innerHTML = "";
    const locals = lastBranches.local || [];
    const remotes = (lastBranches.remote || []).filter((b) => b.name && !/HEAD$/.test(b.name));

    if (!locals.length && !remotes.length) {
      branchesEl.innerHTML = `<p class="hint tight">无分支</p>`;
      return;
    }

    const addSec = (title) => {
      const h = document.createElement("div");
      h.className = "git-branch-sec";
      h.textContent = title;
      branchesEl.appendChild(h);
    };

    if (locals.length) {
      addSec("本地");
      for (const b of locals) branchesEl.appendChild(makeBranchCard(b, "local"));
    }
    if (remotes.length) {
      addSec("网上");
      for (const b of remotes.slice(0, 48)) branchesEl.appendChild(makeBranchCard(b, "remote"));
    }
  }

  function fillBranchSelect(branches) {
    const sel = $("#git-easy-branch");
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = "";
    const ogLocal = document.createElement("optgroup");
    ogLocal.label = "本地";
    for (const b of branches.local || []) {
      const opt = document.createElement("option");
      opt.value = b.name;
      opt.textContent = (b.current ? "● " : "") + b.name;
      if (b.current) opt.selected = true;
      ogLocal.appendChild(opt);
    }
    sel.appendChild(ogLocal);
    const remotes = (branches.remote || []).filter((b) => b.name && !/HEAD$/.test(b.name));
    if (remotes.length) {
      const ogRemote = document.createElement("optgroup");
      ogRemote.label = "网上";
      for (const b of remotes.slice(0, 80)) {
        const opt = document.createElement("option");
        opt.value = "remote:" + b.name;
        opt.textContent = "☁ " + b.name;
        ogRemote.appendChild(opt);
      }
      sel.appendChild(ogRemote);
    }
    if (prev && [...sel.options].some((o) => o.value === prev)) sel.value = prev;
  }

  async function syncBranchesUi() {
    if (!repoPath) return;
    const branches = await api(`/repo/branches?repo=${encodeURIComponent(repoPath)}`).catch(() => ({
      local: [],
      remote: [],
      tags: [],
    }));
    fillBranchSelect(branches);
    renderBranchWorkbench(branches);
    return branches;
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

      const pills = $("#git-status-pills");
      if (pills) {
        const bits = [];
        if (data.branch) bits.push({ t: `当前线 ${data.branch}`, k: "is-ok" });
        if (data.ahead) bits.push({ t: `可上传 ${data.ahead}`, k: "is-info" });
        if (data.behind) bits.push({ t: `可更新 ${data.behind}`, k: "is-info" });
        if (data.dirtyCount) bits.push({ t: `未保存 ${data.dirtyCount}`, k: "is-warn" });
        if (conflicts.length) bits.push({ t: `冲突 ${conflicts.length}`, k: "is-warn" });
        if (data.stashCount) bits.push({ t: `收起 ${data.stashCount}`, k: "" });
        if (data.gerritPushConfigured) bits.push({ t: "Gerrit 推送已配", k: "is-ok" });
        if (!bits.length) bits.push({ t: "干净", k: "is-ok" });
        pills.innerHTML = bits.map((b) => `<span class="git-pill ${b.k}">${escapeHtml(b.t)}</span>`).join("");
      }

      const gerritHint = $("#git-easy-gerrit-hint");
      if (gerritHint) {
        if (data.gerritPushConfigured) {
          const vals = (data.gerritPushValues || []).join(" · ") || "refs/heads/*:refs/for/*";
          gerritHint.innerHTML =
            `已配置：<span class="mono">remote.origin.push = ${escapeHtml(vals)}</span>。「上传」会走评审；也可用下方「送审」指定分支/topic。`;
        } else {
          gerritHint.innerHTML =
            `Gerrit 必须配置 <span class="mono">remote.origin.push = refs/heads/*:refs/for/*</span>，之后「上传」才会进评审；否则会直接推 heads 被拒。`;
        }
      }

      if (conflictBox) {
        const showConflict = Boolean(data.inProgress || conflicts.length);
        conflictBox.hidden = !showConflict;
        if (showConflict) {
          try {
            conflictBox.scrollIntoView({ block: "nearest", behavior: "smooth" });
          } catch (_) {
            /* ignore */
          }
        }
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
        box.innerHTML = `<p class="hint tight git-empty-hint">还没有改动 · 去改文件再回来</p>`;
        if (hint) hint.textContent = "改完文件后点「刷新」。";
      } else {
        for (const r of rows) {
          const row = document.createElement("label");
          row.className = "git-change-item";
          const checked = r.unstaged || !r.staged ? "checked" : "";
          row.innerHTML = `<input type="checkbox" data-git-path="${escapeHtml(r.path)}" ${checked} />
            <span class="git-change-badge mono">${escapeHtml(r.kind || "改")}</span>
            <button type="button" class="ghost-btn git-change-path mono" data-diff-path="${escapeHtml(r.path)}" title="看改动">${escapeHtml(r.path)}</button>`;
          box.appendChild(row);
        }
        box.querySelectorAll("[data-diff-path]").forEach((btn) => {
          btn.addEventListener("click", (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            showFileDiff(btn.getAttribute("data-diff-path")).catch((e) => showError(e.message));
          });
        });
        if (hint) hint.textContent = `共 ${rows.length} 项。点文件名看 diff → 勾选 → 写说明 →「保存到历史」→ 需要时「上传」。`;
      }

      // 分支下拉（隐藏兼容）+ 工作台卡片
      await syncBranchesUi().catch(() => {});

      const stashSel = $("#git-easy-stash-sel");
      if (stashSel) {
        const list = data.stash || [];
        stashSel.innerHTML = "";
        if (!list.length) {
          const opt = document.createElement("option");
          opt.value = "";
          opt.textContent = "（空）";
          stashSel.appendChild(opt);
        } else {
          list.forEach((line, i) => {
            const opt = document.createElement("option");
            const m = String(line).match(/^(stash@\{\d+\})/);
            opt.value = m ? m[1] : `stash@{${i}}`;
            opt.textContent = String(line).slice(0, 80);
            stashSel.appendChild(opt);
          });
        }
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

  let conflictStagesCache = null; // { base, ours, theirs }

  async function openConflictEditor(filePath) {
    conflictEditPath = filePath;
    conflictStagesCache = null;
    const editor = $("#git-conflict-editor");
    const pathEl = $("#git-conflict-path");
    const ta = $("#git-conflict-text");
    if (!editor || !ta) return;
    const data = await api(
      `/repo/read-file?repo=${encodeURIComponent(repoPath)}&path=${encodeURIComponent(filePath)}`
    );
    try {
      const sides = await api(
        `/repo/conflict-sides?repo=${encodeURIComponent(repoPath)}&path=${encodeURIComponent(filePath)}`
      );
      if (sides?.hasStages) conflictStagesCache = sides;
    } catch (_) {
      conflictStagesCache = null;
    }
    if (pathEl) pathEl.textContent = filePath;
    ta.value = data.content || "";
    editor.hidden = false;
    setConflictViewMode(/<<<<<<</.test(ta.value) || conflictStagesCache?.hasStages ? "split" : "raw");
    renderConflictPreview();
    renderConflictSplit();
    const pathInput = $("#git-op-path");
    if (pathInput && !pathInput.value.trim()) pathInput.value = filePath;
    $$(".git-conflict-item").forEach((el) => {
      el.classList.toggle("is-active", el.textContent.includes(filePath));
    });
  }

  let conflictViewMode = "split"; // split | raw

  function setConflictViewMode(mode) {
    conflictViewMode = mode === "raw" ? "raw" : "split";
    const split = $("#git-conflict-split");
    const ta = $("#git-conflict-text");
    const pre = $("#git-conflict-preview");
    if (split) split.hidden = conflictViewMode !== "split";
    if (ta) ta.hidden = conflictViewMode !== "raw";
    if (pre && conflictViewMode !== "raw") {
      pre.hidden = true;
    }
    if (conflictViewMode === "raw") renderConflictPreview();
    else renderConflictSplit();
  }

  function parseConflictHunks(text) {
    const lines = String(text || "").split("\n");
    const hunks = [];
    let i = 0;
    while (i < lines.length) {
      if (!/^<<<<<<< /.test(lines[i]) && lines[i] !== "<<<<<<<") {
        i += 1;
        continue;
      }
      const start = i;
      i += 1;
      const ours = [];
      while (i < lines.length && lines[i] !== "=======") {
        ours.push(lines[i]);
        i += 1;
      }
      if (i >= lines.length) break;
      i += 1; // skip =======
      const theirs = [];
      while (i < lines.length && !/^>>>>>>> /.test(lines[i]) && lines[i] !== ">>>>>>>") {
        theirs.push(lines[i]);
        i += 1;
      }
      const end = i < lines.length ? i : lines.length - 1;
      hunks.push({
        start,
        end,
        ours: ours.join("\n"),
        theirs: theirs.join("\n"),
      });
      i += 1;
    }
    return hunks;
  }

  function applyConflictHunkChoice(hunkIndex, side) {
    const ta = $("#git-conflict-text");
    if (!ta) return;
    const text = ta.value || "";
    const hunks = parseConflictHunks(text);
    const hunk = hunks[hunkIndex];
    if (!hunk) return;
    const lines = text.split("\n");
    const chosen = side === "theirs" ? hunk.theirs : hunk.ours;
    const replacement = chosen === "" ? [] : chosen.split("\n");
    const next = [...lines.slice(0, hunk.start), ...replacement, ...lines.slice(hunk.end + 1)];
    ta.value = next.join("\n");
    renderConflictSplit();
    renderConflictPreview();
  }

  function renderConflictSplit() {
    const box = $("#git-conflict-split");
    const ta = $("#git-conflict-text");
    if (!box || !ta || conflictViewMode !== "split") return;
    const hunks = parseConflictHunks(ta.value || "");
    const stages = conflictStagesCache;
    const parts = [];

    if (stages?.base != null) {
      parts.push(`<div class="git-conflict-base">
        <div class="git-conflict-side-head"><strong>共同祖先（base）</strong><span class="hint tight">三方对照参考</span></div>
        <pre class="mono">${escapeHtml(stages.base || "（空）")}</pre>
      </div>`);
    }

    if (!hunks.length) {
      if (stages?.ours != null || stages?.theirs != null) {
        parts.push(`<div class="git-conflict-hunk">
          <div class="git-conflict-side is-ours">
            <div class="git-conflict-side-head">
              <strong>我的（整文件）</strong>
              <button type="button" class="ghost-btn" data-conflict-stage-take="ours">整文件采用</button>
            </div>
            <pre class="mono">${escapeHtml(stages.ours ?? "（无）")}</pre>
          </div>
          <div class="git-conflict-side is-theirs">
            <div class="git-conflict-side-head">
              <strong>对方（整文件）</strong>
              <button type="button" class="ghost-btn" data-conflict-stage-take="theirs">整文件采用</button>
            </div>
            <pre class="mono">${escapeHtml(stages.theirs ?? "（无）")}</pre>
          </div>
        </div>`);
      } else {
        parts.push(`<p class="hint tight">没有冲突标记了。可切到「看全文」确认后保存。</p>`);
      }
      box.innerHTML = parts.join("");
      box.hidden = false;
      return;
    }

    parts.push(
      hunks
        .map((h, idx) => {
          return `<div class="git-conflict-hunk" data-hunk="${idx}">
          <div class="git-conflict-side is-ours">
            <div class="git-conflict-side-head">
              <strong>我的</strong>
              <button type="button" class="ghost-btn" data-hunk-take="ours" data-hunk-idx="${idx}">采用左边</button>
            </div>
            <pre class="mono">${escapeHtml(h.ours || "（空）")}</pre>
          </div>
          <div class="git-conflict-side is-theirs">
            <div class="git-conflict-side-head">
              <strong>对方</strong>
              <button type="button" class="ghost-btn" data-hunk-take="theirs" data-hunk-idx="${idx}">采用右边</button>
            </div>
            <pre class="mono">${escapeHtml(h.theirs || "（空）")}</pre>
          </div>
        </div>`;
        })
        .join("")
    );
    box.innerHTML = parts.join("");
    box.hidden = false;
  }

  function renderConflictPreview() {
    const ta = $("#git-conflict-text");
    const pre = $("#git-conflict-preview");
    if (!ta || !pre) return;
    if (conflictViewMode !== "raw") {
      pre.hidden = true;
      return;
    }
    const text = ta.value || "";
    if (!/<<<<<<</.test(text)) {
      pre.hidden = true;
      pre.innerHTML = "";
      return;
    }
    pre.hidden = false;
    let mode = "";
    pre.innerHTML = text
      .split("\n")
      .map((line) => {
        const esc = escapeHtml(line);
        if (/^<<<<<<< /.test(line) || line === "<<<<<<<") {
          mode = "ours";
          return `<span class="mk-mark">${esc}</span>`;
        }
        if (line === "=======") {
          mode = "theirs";
          return `<span class="mk-mark">${esc}</span>`;
        }
        if (/^>>>>>>> /.test(line) || line === ">>>>>>>") {
          mode = "";
          return `<span class="mk-mark">${esc}</span>`;
        }
        if (mode === "ours") return `<span class="mk-ours">${esc}</span>`;
        if (mode === "theirs") return `<span class="mk-theirs">${esc}</span>`;
        return esc;
      })
      .join("\n");
  }

  function jumpConflictMarker(dir) {
    const ta = $("#git-conflict-text");
    if (!ta) return;
    const text = ta.value || "";
    const re = /^<<<<<<< /gm;
    const indices = [];
    let m;
    while ((m = re.exec(text))) indices.push(m.index);
    if (!indices.length) {
      showError("当前文件里没有 <<<<<<< 冲突标记（可能已选边解决）");
      return;
    }
    const cur = ta.selectionStart || 0;
    let target = indices[0];
    if (dir > 0) {
      target = indices.find((i) => i > cur) ?? indices[0];
    } else {
      const before = indices.filter((i) => i < cur);
      target = before.length ? before[before.length - 1] : indices[indices.length - 1];
    }
    ta.focus();
    ta.setSelectionRange(target, Math.min(target + 7, text.length));
    const line = text.slice(0, target).split("\n").length;
    const lh = ta.scrollHeight / Math.max(1, text.split("\n").length);
    ta.scrollTop = Math.max(0, (line - 3) * lh);
  }

  async function showFileDiff(filePath) {
    if (!repoPath || !filePath) return;
    const panel = $("#git-diff-panel");
    const view = $("#git-diff-view");
    const title = $("#git-diff-title");
    $$(".git-change-item").forEach((el) => {
      const hit = el.querySelector("[data-diff-path]");
      el.classList.toggle("is-diffing", hit?.getAttribute("data-diff-path") === filePath);
    });
    const data = await api(
      `/repo/diff-file?repo=${encodeURIComponent(repoPath)}&path=${encodeURIComponent(filePath)}`
    );
    if (title) title.textContent = filePath;
    if (panel) panel.hidden = false;
    if (view) {
      const raw = String(data.diff || "(无差异)");
      view.innerHTML = raw
        .split("\n")
        .map((line) => {
          const esc = escapeHtml(line || " ");
          if (line.startsWith("+++") || line.startsWith("---") || line.startsWith("diff ") || line.startsWith("index ")) {
            return `<div class="d-meta">${esc}</div>`;
          }
          if (line.startsWith("@@")) return `<div class="d-hunk">${esc}</div>`;
          if (line.startsWith("+")) return `<div class="d-add">${esc}</div>`;
          if (line.startsWith("-")) return `<div class="d-del">${esc}</div>`;
          return `<div>${esc}</div>`;
        })
        .join("");
    }
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
    const filePath = conflictEditPath;
    if (!filePath) return showError("先打开一个冲突文件");
    const ta = $("#git-conflict-text");
    await api("/repo/write-file", {
      method: "POST",
      body: { repo: repoPath, file: filePath, content: ta?.value ?? "" },
    });
    await runOp("add", { path: filePath }, { skipConfirm: true, skipRefresh: true });
    showError("");
    opOut.hidden = false;
    opOut.textContent = `已保存并标记解决：${filePath}`;
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
    if (!(await askConfirm("确定放弃这次合并/改写？工作区会回到操作前。"))) return;
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
    const branch =
      lastStatus?.branch && lastStatus.branch !== "(detached)" ? lastStatus.branch : "";
    const needsU = lastStatus && !lastStatus.upstream;
    const gerritMode = Boolean(lastStatus?.gerritPushConfigured);

    if (gerritMode) {
      // 已配 remote.origin.push → refs/for/*：必须用裸 git push，不能 push -u origin branch（会直推 heads）
      if (needsU && branch) {
        try {
          await runOp(
            "branch-set-upstream",
            { upstream: `origin/${branch}`, branch },
            { skipConfirm: true, skipRefresh: true }
          );
        } catch (_) {
          /* 远程尚无同名分支时跟踪会失败，送审仍可继续 */
        }
      }
      await runOp("push", {}, { skipConfirm: true });
      await refreshChanges();
      return;
    }

    const params = needsU
      ? {
          setUpstream: true,
          remote: "origin",
          branch: branch || undefined,
        }
      : {};
    try {
      await runOp("push", params, { skipConfirm: true });
    } catch (e) {
      const msg = String(e.message || "") + " " + String(e.data?.stderr || "");
      if (/prohibited by Gerrit|not permitted to create|can not update|You need 'Create Change'|remote rejected.*refs\/heads|Push to refs\/for|refs\/for/i.test(msg)) {
        if (
          await askConfirm(
            "远程拒绝了直接推分支（常见于 Gerrit）。要先写入配置 remote.origin.push = refs/heads/*:refs/for/*，再按评审方式上传吗？"
          )
        ) {
          await runOp("gerrit-config-push", { remote: "origin" }, { skipConfirm: true, skipRefresh: true });
          if (needsU && branch) {
            try {
              await runOp(
                "branch-set-upstream",
                { upstream: `origin/${branch}`, branch },
                { skipConfirm: true, skipRefresh: true }
              );
            } catch (_) {
              /* ignore */
            }
          }
          await runOp("push", {}, { skipConfirm: true });
          await refreshChanges();
          return;
        }
      }
      throw e;
    }
    await refreshChanges();
  }

  async function easyGerritSetup() {
    if (!repoPath) return showError("先打开一个仓库");
    if (
      !(await askConfirm(
        "写入本地配置？\ngit config remote.origin.push refs/heads/*:refs/for/*\n之后点「上传」会按 Gerrit 评审推送，而不是直推分支。"
      ))
    ) {
      return;
    }
    await runOp("gerrit-config-push", { remote: "origin" }, { skipConfirm: true });
    await refreshChanges();
    showError("");
    opOut.hidden = false;
    opOut.textContent = (opOut.textContent || "") + "\n\n已配置 remote.origin.push = refs/heads/*:refs/for/*";
  }

  async function easyGerrit() {
    if (!repoPath) return showError("先打开一个仓库");
    if (!lastStatus?.gerritPushConfigured) {
      if (
        await askConfirm(
          "尚未配置 remote.origin.push = refs/heads/*:refs/for/*。先写入该配置（推荐），再送审？"
        )
      ) {
        await runOp("gerrit-config-push", { remote: "origin" }, { skipConfirm: true, skipRefresh: true });
      }
    }
    const branch =
      String($("#git-easy-gerrit")?.value || "").trim() ||
      lastStatus?.upstream?.split("/")?.pop() ||
      (lastStatus?.branch && lastStatus.branch !== "(detached)" ? lastStatus.branch : "") ||
      "master";
    const topic = String($("#git-easy-gerrit-topic")?.value || "").trim();
    if (
      !(await askConfirm(
        `送审到 Gerrit？push origin HEAD:refs/for/${branch}${topic ? "%topic=" + topic : ""}`
      ))
    ) {
      return;
    }
    await runOp("push-gerrit", { branch, topic: topic || undefined, remote: "origin" }, { skipConfirm: true });
    await refreshChanges();
  }

  async function easyPull() {
    if (!repoPath) return showError("先打开一个仓库");
    const mode = String($("#git-easy-pull-mode")?.value || "auto");

    const runPull = async (op) => runOp(op, {}, { skipConfirm: true, skipRefresh: true });

    try {
      if (mode === "ff") {
        await runPull("pull");
      } else if (mode === "merge") {
        await runPull("pull-merge");
      } else if (mode === "rebase") {
        await runPull("pull-rebase");
      } else {
        try {
          await runPull("pull");
        } catch (e) {
          const msg = String(e.message || "") + " " + String(e.data?.stderr || "");
          if (/fast-forward|divergent|reconcile|non-fast-forward/i.test(msg)) {
            opOut.hidden = false;
            opOut.textContent = "快进失败，改为合并更新…\n" + msg;
            await runPull("pull-merge");
          } else {
            throw e;
          }
        }
      }
      showError("");
      await refreshChanges();
      await refreshRepo();
    } catch (e) {
      await refreshChanges().catch(() => {});
      throw e;
    }
  }

  async function easyFetch() {
    if (!repoPath) return showError("先打开一个仓库");
    await runOp("fetch", {}, { skipConfirm: true });
    await refreshChanges();
  }

  async function easyAlignRemote() {
    if (!repoPath) return showError("先打开一个仓库");
    if (
      !(await askConfirm(
        "把本地这条线强制对齐到「网上跟踪线」最新？本地多出来的提交和未保存改动都会丢掉。适合：线上已变、想回到最新再重来。"
      ))
    ) {
      return;
    }
    await runOp("fetch", {}, { skipConfirm: true, skipRefresh: true });
    await runOp("reset-hard-upstream", { confirmHard: true }, { skipConfirm: true });
    await refreshChanges();
  }

  async function easyAmend() {
    if (!repoPath) return showError("先打开一个仓库");
    const msg = String($("#git-easy-msg")?.value || "").trim();
    const maybePublished = Boolean(lastStatus?.upstream);
    if (
      !(await askConfirm(
        msg
          ? "用当前说明改写「上一笔保存」？若还有勾选文件会一并补进去。"
          : "把勾选文件补进「上一笔保存」，说明文字不变？" +
              (maybePublished ? " 若上一笔已上传，之后可能需要安全强推。" : "")
      ))
    ) {
      return;
    }
    const paths = selectedChangePaths();
    if (paths.length) {
      for (const p of paths) await runOp("add", { path: p }, { skipConfirm: true, skipRefresh: true });
    } else {
      await runOp("add-all", {}, { skipConfirm: true, skipRefresh: true });
    }
    if (msg) await runOp("commit-amend", { message: msg }, { skipConfirm: true, skipRefresh: true });
    else await runOp("commit-amend", { noEdit: true }, { skipConfirm: true, skipRefresh: true });
    if (
      maybePublished &&
      (await askConfirm("上一笔可能已在网上。要用「安全强推」覆盖远程同名线吗？（force-with-lease）"))
    ) {
      await runOp("push-lease", {}, { skipConfirm: true });
    }
    await refreshChanges();
    await refreshRepo();
  }

  async function easyFixupIntoSelected() {
    if (!repoPath) return showError("先打开一个仓库");
    const sha = String(selectedSha || "").trim();
    if (!sha || sha.length < 7) {
      return showError("先在提交图里点中要改的那一笔，再点「补进选中提交」");
    }
    if (
      !(await askConfirm(
        `把当前勾选改动并入选中提交 ${sha.slice(0, 10)}…？\n会用 fixup + autosquash（保留原 Change-Id，适合 Gerrit 改更早一笔）。冲突时请在「进行中」里继续或放弃。`
      ))
    ) {
      return;
    }
    const paths = selectedChangePaths();
    if (paths.length) {
      for (const p of paths) await runOp("add", { path: p }, { skipConfirm: true, skipRefresh: true });
    } else {
      await runOp("add-all", {}, { skipConfirm: true, skipRefresh: true });
    }
    await runOp("commit-fixup", { sha }, { skipConfirm: true, skipRefresh: true });
    await runOp("rebase-autosquash", { onto: `${sha}^` }, { skipConfirm: true, skipRefresh: true });
    showError("");
    await refreshChanges();
    await refreshRepo();
    if ($("#git-easy-hint")) {
      $("#git-easy-hint").textContent = "已并入选中提交。Gerrit 请再点「送审」更新对应 Change（保留 Change-Id）。";
    }
  }

  async function switchToBranch(rawOverride) {
    if (!repoPath) return showError("先打开一个仓库");
    const raw = String(rawOverride != null ? rawOverride : $("#git-easy-branch")?.value || "").trim();
    if (!raw) return showError("先选一条工作线");

    async function checkoutOnce(params, label) {
      try {
        await runOp("checkout", params, { skipConfirm: true });
      } catch (e) {
        const msg = String(e.message || "") + String(e.data?.stderr || "");
        if (/local changes|would be overwritten|uncommitted/i.test(msg)) {
          if (!(await askConfirm(`切换到「${label}」时有未保存改动挡着。先收起来再切换？`))) throw e;
          await runOp("stash-push", {}, { skipConfirm: true, skipRefresh: true });
          await runOp("checkout", params, { skipConfirm: true });
          return;
        }
        throw e;
      }
    }

    if (raw.startsWith("remote:")) {
      const remoteRef = raw.slice("remote:".length);
      const local = remoteRef.includes("/") ? remoteRef.split("/").slice(1).join("/") : remoteRef;
      if (!local) return showError("远程分支名无效");
      const label = `远程 ${remoteRef} → 本地 ${local}`;
      try {
        await checkoutOnce({ target: local }, label);
      } catch (e) {
        const msg = String(e.message || "") + String(e.data?.stderr || "");
        // 本地没有该线：从远程创建并检出
        if (/pathspec|did not match|unknown revision|not a valid|invalid reference/i.test(msg)) {
          await checkoutOnce({ target: local, create: true, start: remoteRef }, label);
        } else {
          throw e;
        }
      }
    } else {
      await checkoutOnce({ target: raw }, raw);
    }
    await refreshChanges();
    await refreshRepo();
  }

  async function easySwitch() {
    return switchToBranch();
  }

  async function mergeBranchIntoCurrent(name) {
    if (!repoPath) return showError("先打开一个仓库");
    if (!(await askConfirm(`把「${name}」合并进当前工作线？两边改同一处时会出现冲突。`))) return;
    await runOp("merge", { branch: name }, { skipConfirm: true });
    await refreshChanges();
    await refreshRepo();
  }

  async function deleteLocalBranch(name) {
    if (!repoPath) return showError("先打开一个仓库");
    if (!(await askConfirm(`删除本地线「${name}」？未合并内容会被 git 拒绝（除非再强制）。`))) return;
    try {
      await runOp("branch-delete", { name }, { skipConfirm: true, skipRefresh: true });
    } catch (e) {
      const msg = String(e.message || "") + " " + String(e.data?.stderr || "");
      if (/not fully merged/i.test(msg)) {
        if (!(await askConfirm(`「${name}」尚未完全合并进其他线。强制删除？`))) throw e;
        await runOp("branch-delete", { name, force: true }, { skipConfirm: true, skipRefresh: true });
      } else {
        throw e;
      }
    }
    await refreshChanges();
    await refreshRepo();
  }

  async function easyReflog() {
    if (!repoPath) return showError("先打开一个仓库");
    await runOp("reflog", {}, { skipConfirm: true, skipRefresh: true });
    opOut.hidden = false;
    opOut.textContent =
      (opOut.textContent || "") +
      "\n\n—— 后悔药 ——\n上面每行前面的短编号，可到右侧高级区填进「目标」后重置。误点「对齐线上」后，找对齐前那一行即可。";
  }

  async function easyStashApplySel() {
    if (!repoPath) return showError("先打开一个仓库");
    const ref = String($("#git-easy-stash-sel")?.value || "").trim();
    if (!ref) return showError("收起柜是空的");
    await runOp("stash-apply", { ref }, { skipConfirm: true });
    await refreshChanges();
  }

  async function easyReadyGo() {
    showError("");
    setStatus("", "正在启动…", "尝试唤起统一桥并连接");
    try {
      if (window.devtoolsBridgeToken?.ensureBridgeRunning) {
        await window.devtoolsBridgeToken.ensureBridgeRunning({
          kind: "unified",
          preferredBase: baseUrl() || DEFAULT_BASE,
          token: token(),
        });
      }
    } catch (_) {
      /* connect 会给出更明确错误 */
    }
    await connectBridge();
  }

  async function easySquash() {
    if (!repoPath) return showError("先打开一个仓库");
    const n = Math.min(50, Math.max(2, Number($("#git-easy-squash-n")?.value) || 2));
    const msg =
      String($("#git-easy-squash-msg")?.value || "").trim() ||
      String($("#git-easy-msg")?.value || "").trim() ||
      `合并最近 ${n} 笔`;
    if (
      !(await askConfirm(
        `把最近 ${n} 笔保存合成一笔？说明：${msg}（只动本地历史；若已上传，之后上传会变复杂）`
      ))
    ) {
      return;
    }
    await runOp("reset-soft-n", { count: n }, { skipConfirm: true, skipRefresh: true });
    await runOp("commit", { message: msg }, { skipConfirm: true });
    await refreshChanges();
  }

  async function easyFormatPatch() {
    if (!repoPath) return showError("先打开一个仓库");
    const n = Math.min(50, Math.max(1, Number($("#git-easy-patch-n")?.value) || 1));
    const out = await runOp("format-patch", { count: n, outdir: ".devtools-patches" }, { skipConfirm: true });
    const files = String(out?.stdout || "")
      .trim()
      .split("\n")
      .filter(Boolean);
    if (files[0] && $("#git-easy-patch-path")) $("#git-easy-patch-path").value = files[0];
    showError("");
    opOut.hidden = false;
    opOut.textContent = `补丁已生成：\n${files.join("\n") || "(见 .devtools-patches/)"}`;
    await refreshChanges();
  }

  async function easyAm() {
    if (!repoPath) return showError("先打开一个仓库");
    const path = String($("#git-easy-patch-path")?.value || "").trim();
    if (!path) return showError("先填补丁文件路径（相对仓库根目录）");
    if (!(await askConfirm(`按提交方式应用补丁？\n${path}`))) return;
    await runOp("am", { path }, { skipConfirm: true });
    await refreshChanges();
  }

  async function easyApply() {
    if (!repoPath) return showError("先打开一个仓库");
    const path = String($("#git-easy-patch-path")?.value || "").trim();
    if (!path) return showError("先填补丁文件路径（相对仓库根目录）");
    if (!(await askConfirm(`只改工作区文件、不自动记提交？\n${path}`))) return;
    await runOp("apply", { path }, { skipConfirm: true });
    await refreshChanges();
  }

  async function easyStash() {
    if (!repoPath) return showError("先打开一个仓库");
    await runOp("stash-push", {}, { skipConfirm: true });
    await refreshChanges();
  }

  async function easyStashPop() {
    if (!repoPath) return showError("先打开一个仓库");
    if (!(await askConfirm("取出最近一次收起来的改动？若和当前文件打架会出现冲突。"))) return;
    await runOp("stash-pop", {}, { skipConfirm: true });
    await refreshChanges();
  }

  async function easyUndo() {
    if (!repoPath) return showError("先打开一个仓库");
    if (!(await askConfirm("撤销上一次「保存到历史」？改动还会留在文件里，只是从历史里拿掉最近一笔。"))) return;
    await runOp("reset-soft-1", {}, { skipConfirm: true });
    await refreshChanges();
  }

  async function easyNewBranch() {
    if (!repoPath) return showError("先打开一个仓库");
    const name = String($("#git-easy-newbr")?.value || "").trim();
    if (!name) return showError("先填新工作线名字");
    if ($("#git-new-branch")) $("#git-new-branch").value = name;
    await runOp("branch-create-co", {}, { skipConfirm: true });
    if ($("#git-easy-newbr")) $("#git-easy-newbr").value = "";
    await refreshChanges();
    await refreshRepo();
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
    const graph = await api(`/repo/graph?repo=${encodeURIComponent(repoPath)}&max=150`);
    renderGraph(graph.commits || []);
    asciiEl.textContent = graph.ascii || "";
    cmdPreview.hidden = false;
    cmdPreview.textContent = "图数据命令：\n" + (graph.cmd || []).join(" ");

    const headCommit = (graph.commits || []).find((c) => (c.refs || []).some((r) => /HEAD/.test(r)));
    if (headCommit) selectCommit(headCommit.hash);
    else if (graph.commits && graph.commits[0]) selectCommit(graph.commits[0].hash);
    await refreshChanges();
  }

  async function downloadBundle(platform) {
    const api = window.devtoolsUnifiedBridgeBundle;
    if (!api?.download) throw new Error("统一完整包模块未加载，请硬刷新页面");
    const box = $("#git-dl-progress");
    const fill = $("#git-dl-progress-fill");
    const title = $("#git-dl-progress-text");
    const pctEl = $("#git-dl-progress-pct");
    const setProg = (on, p = {}) => {
      if (!box) return;
      box.hidden = !on;
      if (fill) fill.style.width = `${Math.max(0, Math.min(100, Number(p.pct) || 0))}%`;
      if (title && p.text) title.textContent = p.text;
      if (pctEl) pctEl.textContent = `${Math.round(Number(p.pct) || 0)}%`;
    };
    setStatus("is-warn", "正在打包…", "下载统一完整包（含 Git），请稍候");
    setProg(true, { pct: 4, text: "准备打包…" });
    try {
      await api.download(platform, {
        onProgress: (p) => setProg(true, p),
      });
      setStatus(
        "is-warn",
        "等待本机桥启动…",
        "完整包已下载。解压后运行 start-adb-bridge.*，保持窗口打开，再点连接。"
      );
    } finally {
      setProg(false);
    }
  }

  let opsCatalog = { ops: [], groups: [] };

  function catalogItem(op) {
    for (const g of opsCatalog.groups || []) {
      const hit = (g.items || []).find((it) => it.id === op);
      if (hit) return hit;
    }
    return null;
  }

  function looksLikeCommitId(s) {
    return /^[0-9a-f]{7,40}$/i.test(String(s || "").trim());
  }

  function fillIf(p, key, val) {
    if (val && (p[key] == null || p[key] === "")) p[key] = val;
  }

  function fillOpParams(op, params) {
    const p = { ...(params || {}) };
    const typedTarget = String($("#git-op-target")?.value || "").trim();
    const newBranch = String($("#git-new-branch")?.value || "").trim();
    const typedPath = String($("#git-op-path")?.value || "").trim();
    const message = String($("#git-commit-msg")?.value || $("#git-easy-msg")?.value || "").trim();
    const cloneUrl = String($("#git-clone-url")?.value || "").trim();
    const branch =
      lastStatus?.branch && lastStatus.branch !== "(detached)" ? lastStatus.branch : "";
    const changePath =
      conflictEditPath ||
      (Array.isArray(lastStatus?.changes) && lastStatus.changes[0]?.path) ||
      (Array.isArray(lastStatus?.conflicts) && lastStatus.conflicts[0]?.path) ||
      "";
    const target = typedTarget || selectedSha || branch;
    const filePath = typedPath || changePath;
    const sha = typedTarget || selectedSha;

    // 把推断值回填到输入框，避免用户以为没带上
    const targetEl = $("#git-op-target");
    const pathEl = $("#git-op-path");
    if (targetEl && !typedTarget && target) targetEl.placeholder = `自动：${String(target).slice(0, 28)}`;
    if (pathEl && !typedPath && filePath) pathEl.placeholder = `自动：${String(filePath).slice(0, 36)}`;

    const hint = $("#git-op-autofill-hint");
    if (hint) {
      const bits = [];
      if (selectedSha) bits.push(`提交 ${String(selectedSha).slice(0, 7)}`);
      if (branch) bits.push(`分支 ${branch}`);
      if (filePath) bits.push(`路径 ${filePath}`);
      if (message) bits.push("有说明文字");
      hint.textContent = bits.length
        ? `自动带参：${bits.join(" · ")}（输入框有字时优先用手填）`
        : "点命令时会自动带上：选中提交、当前分支、冲突/改动文件路径、说明文字。";
    }

    if (op === "checkout" || op === "switch") fillIf(p, "target", target);
    if (op === "merge") {
      // 兼容误传 target
      if (!p.branch && p.target) p.branch = p.target;
      fillIf(p, "branch", typedTarget || selectedSha);
      if (p.noFf == null && p.ffOnly == null) p.noFf = true;
    }
    if (op === "rebase") fillIf(p, "onto", typedTarget || selectedSha);
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
      fillIf(p, "sha", sha || "HEAD");
      fillIf(p, "path", filePath);
    }
    if (op === "blame" || op === "add" || op === "restore" || op === "checkout-ours" || op === "checkout-theirs") {
      fillIf(p, "path", filePath);
    }
    if (op === "blame") fillIf(p, "sha", typedTarget || selectedSha || "HEAD");
    if (op === "commit") fillIf(p, "message", message);
    if (op === "commit-amend") {
      if (message) fillIf(p, "message", message);
      else if (p.noEdit == null) p.noEdit = true;
    }
    if (op === "format-patch") {
      if (p.count == null) p.count = 1;
      fillIf(p, "outdir", ".devtools-patches");
      fillIf(p, "sha", sha);
    }
    if (op === "am" || op === "apply") fillIf(p, "path", filePath);
    if (op === "reset-soft-n" && p.count == null) p.count = 2;
    if (op === "stash-push") fillIf(p, "message", message);
    if (op === "stash-apply" || op === "stash-drop" || op === "stash-show") fillIf(p, "ref", typedTarget || "stash@{0}");
    if (op === "stash-clear") p.confirmClear = true;
    if (op === "clean") p.confirmClean = true;
    if (op === "rev-parse") fillIf(p, "ref", target || "HEAD");
    if (op === "config-get") fillIf(p, "key", typedTarget || "user.name");
    if (op === "branch-create") {
      fillIf(p, "name", newBranch);
      fillIf(p, "start", typedTarget || selectedSha);
    }
    if (op === "branch-delete") fillIf(p, "name", typedTarget || newBranch);
    if (op === "branch-rename") {
      fillIf(p, "oldName", typedTarget || branch);
      fillIf(p, "newName", newBranch);
    }
    if (op === "tag-create" || op === "tag-annotate") {
      fillIf(p, "name", newBranch || typedTarget);
      fillIf(p, "sha", selectedSha);
      fillIf(p, "message", message);
    }
    if (op === "tag-delete") fillIf(p, "name", newBranch || typedTarget);
    if (op === "remote-add") {
      fillIf(p, "name", newBranch || "origin");
      fillIf(p, "url", cloneUrl || typedTarget);
    }
    if (op === "remote-remove") fillIf(p, "name", typedTarget || "origin");
    if (op === "remote-rename") {
      fillIf(p, "oldName", typedTarget || "origin");
      fillIf(p, "newName", newBranch);
    }
    if (op === "push" || op === "push-lease") {
      // 裸 git push / push --force-with-lease 不带参数（走 upstream / remote.*.push）
      // 禁止只填 branch 或把分支名当 remote，否则会变成 `git push <branch>`
      if (p.setUpstream) {
        fillIf(p, "remote", "origin");
        fillIf(p, "branch", typedTarget || branch);
      } else if (p.remote) {
        fillIf(p, "branch", typedTarget || branch);
      }
      // 目录里点「push」保持裸推（Gerrit 映射 / 已有 upstream）
    }
    if (op === "push-gerrit") {
      const gerritBranch =
        (typedTarget && !looksLikeCommitId(typedTarget) ? typedTarget : "") ||
        branch ||
        lastStatus?.upstream?.split("/")?.pop() ||
        "master";
      fillIf(p, "branch", gerritBranch);
      fillIf(p, "remote", "origin");
    }
    if (op === "gerrit-config-push") fillIf(p, "remote", typedTarget || "origin");
    if (op === "branch-set-upstream") {
      fillIf(p, "upstream", typedTarget || (branch ? `origin/${branch}` : ""));
      fillIf(p, "branch", branch);
    }
    if (op === "worktree-add") {
      fillIf(p, "path", filePath);
      fillIf(p, "ref", typedTarget || selectedSha || branch);
    }
    if (op === "worktree-remove") fillIf(p, "path", filePath || typedTarget);
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

  function pruneExecHistory(list) {
    const cut = Date.now() - HIST_KEEP_MS;
    return (Array.isArray(list) ? list : [])
      .filter((x) => x && Number(x.at) > cut)
      .sort((a, b) => Number(b.at) - Number(a.at))
      .slice(0, HIST_MAX);
  }

  function loadExecHistory() {
    try {
      const raw = JSON.parse(localStorage.getItem(HIST_KEY) || "[]");
      const next = pruneExecHistory(raw);
      if (next.length !== (raw || []).length) {
        try {
          localStorage.setItem(HIST_KEY, JSON.stringify(next));
        } catch (_) {}
      }
      return next;
    } catch (_) {
      return [];
    }
  }

  function saveExecHistory(list) {
    const next = pruneExecHistory(list);
    try {
      localStorage.setItem(HIST_KEY, JSON.stringify(next));
    } catch (_) {}
    return next;
  }

  function formatHistTime(ts) {
    const d = new Date(Number(ts) || Date.now());
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  function recordExecHistory(entry) {
    const list = loadExecHistory();
    list.unshift({
      id: `h-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      at: Date.now(),
      op: String(entry.op || ""),
      plain: String(entry.plain || ""),
      cmd: String(entry.cmd || ""),
      ok: Boolean(entry.ok),
      repo: String(entry.repo || repoPath || ""),
      error: entry.error ? String(entry.error).slice(0, 400) : "",
    });
    saveExecHistory(list);
    renderExecHistory();
  }

  function renderExecHistory() {
    const box = $("#git-hist-list");
    const count = $("#git-hist-count");
    if (!box) return;
    const list = loadExecHistory();
    if (count) count.textContent = list.length ? `${list.length} 条 · 保留 7 天` : "暂无 · 保留 7 天";
    if (!list.length) {
      box.innerHTML = `<p class="hint tight">还没有执行记录。点上面的命令或小白按钮后会出现在这里。</p>`;
      return;
    }
    box.innerHTML = list
      .map((it) => {
        const repoShort = String(it.repo || "")
          .replace(/\\/g, "/")
          .split("/")
          .filter(Boolean)
          .slice(-2)
          .join("/") || "—";
        const status = it.ok
          ? `<span class="git-hist-ok">成功</span>`
          : `<span class="git-hist-fail">失败</span>`;
        const err = !it.ok && it.error
          ? `<p class="hint tight git-hist-err">${escapeHtml(it.error)}</p>`
          : "";
        return `<article class="git-hist-item ${it.ok ? "" : "is-fail"}">
          <div class="git-hist-head">
            <time class="mono hint tight">${escapeHtml(formatHistTime(it.at))}</time>
            ${status}
          </div>
          <p class="git-hist-plain">${escapeHtml(it.plain || it.op || "（无描述）")}</p>
          <p class="mono git-hist-cmd">${escapeHtml(it.cmd || it.op || "")}</p>
          <p class="hint tight mono">仓库 · ${escapeHtml(repoShort)}</p>
          ${err}
        </article>`;
      })
      .join("");
  }

  function clearExecHistory() {
    try {
      localStorage.removeItem(HIST_KEY);
    } catch (_) {}
    renderExecHistory();
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
      h.textContent = g.label || g.name;
      if (g.label && g.name && g.label !== g.name) {
        const sub = document.createElement("span");
        sub.className = "git-ops-group-sub hint tight";
        sub.textContent = g.name;
        h.appendChild(document.createTextNode(" "));
        h.appendChild(sub);
      }
      wrap.appendChild(h);
      const row = document.createElement("div");
      row.className = "git-ops-plain-list";
      for (const item of g.items || []) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = item.dangerous ? "git-op-plain-btn is-danger" : "git-op-plain-btn";
        const plain = item.plain || item.title;
        const gitTitle = item.title || item.id;
        btn.title = item.dangerous
          ? `${plain}\n对应：git ${gitTitle}\n（会改仓库，执行前确认）`
          : `${plain}\n对应：git ${gitTitle}`;
        btn.innerHTML = `<span class="git-op-plain-text">${escapeHtml(plain)}</span><span class="git-op-cmd mono">对应 git ${escapeHtml(gitTitle)}</span>`;
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
    const plain = item?.plain || "";
    const preview = item ? `git ${item.title}` : op;
    cmdPreview.hidden = false;
    const paramBits = Object.keys(p)
      .filter((k) => p[k] != null && p[k] !== "")
      .map((k) => `${k}=${String(p[k]).slice(0, 48)}`);
    cmdPreview.textContent =
      (plain ? `白话：${plain}\n` : "") +
      "即将执行：\n" +
      preview +
      (paramBits.length ? "\n参数：" + paramBits.join(" · ") : "");

    // 常见缺参早失败，避免点了才报后端 400
    const needMsg = [];
    if ((op === "merge" || op === "rebase") && !(p.branch || p.onto)) needMsg.push("目标（选中提交或填目标框）");
    if ((op === "cherry-pick" || op === "revert" || op === "show") && !p.sha) needMsg.push("提交 sha（点图选中或填目标）");
    if ((op === "add" || op === "blame" || op === "checkout-ours" || op === "checkout-theirs") && !p.path)
      needMsg.push("文件路径（打开冲突编辑或填路径框）");
    if (op === "commit" && !p.message) needMsg.push("说明文字");
    if (op === "branch-create" && !p.name) needMsg.push("新分支名");
    if (needMsg.length) {
      showError("还缺：" + needMsg.join("；"));
      return;
    }

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
      "reset-soft-n",
      "reset-hard-upstream",
      "pull-merge",
      "pull-rebase",
      "am",
      "apply",
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
    if (dangerous && !opts.skipConfirm) {
      const confirmPlain = plain ? `${plain}\n` : "";
      if (!(await askConfirm(`确认执行？\n${confirmPlain}对应命令：${preview}\n操作代号：${op}`))) return;
    }
    if (op === "reset-hard-upstream") p.confirmHard = true;
    if (op === "reset" && p.mode === "hard") p.confirmHard = true;

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
      recordExecHistory({
        op,
        plain,
        cmd: Array.isArray(out.cmd) ? out.cmd.join(" ") : String(out.cmd || preview),
        ok: true,
        repo: repoPath,
      });
      if (!opts.skipRefresh) await refreshRepo();
      return out;
    } catch (e) {
      const d = e.data || {};
      const raw = [e.message, d.stderr, d.stdout].filter(Boolean).join("\n");
      const nice = humanizeGitError(raw);
      opOut.hidden = false;
      opOut.textContent =
        (d.cmd ? (Array.isArray(d.cmd) ? d.cmd.join(" ") : d.cmd) + "\n\n" : "") +
        nice +
        (raw && raw !== nice ? "\n\n—— 原始信息 ——\n" + raw : "");
      recordExecHistory({
        op,
        plain,
        cmd: Array.isArray(d.cmd) ? d.cmd.join(" ") : String(d.cmd || preview),
        ok: false,
        repo: repoPath,
        error: nice || e.message,
      });
      showError(nice);
      throw e;
    }
  }

  async function initRepoHere() {
    const dir = String($("#git-fs-path").value || "").trim();
    if (!dir) {
      showError("先打开一个目录");
      return;
    }
    if (!(await askConfirm(`在此目录新建空仓库？\n${dir}`))) return;
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
      showError("填写仓库网址");
      return;
    }
    if (!(await askConfirm(`从网址下载仓库到当前目录？\n${url}\n→ ${dir || "(默认 DevToolsRepos)"}`))) return;
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
  $("#git-easy-amend")?.addEventListener("click", () => easyAmend().catch((e) => showError(e.message)));
  $("#git-hist-refresh")?.addEventListener("click", () => renderExecHistory());
  $("#git-hist-clear")?.addEventListener("click", async () => {
    if (!(await askConfirm("清空本机保存的近 7 天执行历史？"))) return;
    clearExecHistory();
  });
  $("#git-easy-fixup")?.addEventListener("click", () => easyFixupIntoSelected().catch((e) => showError(e.message)));
  $("#git-easy-push")?.addEventListener("click", () => easyPush().catch((e) => showError(e.message)));
  $("#git-easy-pull")?.addEventListener("click", () => easyPull().catch((e) => showError(e.message)));
  $("#git-easy-fetch")?.addEventListener("click", () => easyFetch().catch((e) => showError(e.message)));
  $("#git-easy-align")?.addEventListener("click", () => easyAlignRemote().catch((e) => showError(e.message)));
  $("#git-easy-reflog")?.addEventListener("click", () => easyReflog().catch((e) => showError(e.message)));
  $("#git-easy-gerrit-go")?.addEventListener("click", () => easyGerrit().catch((e) => showError(e.message)));
  $("#git-easy-gerrit-setup")?.addEventListener("click", () => easyGerritSetup().catch((e) => showError(e.message)));
  $("#git-diff-close")?.addEventListener("click", () => {
    const panel = $("#git-diff-panel");
    if (panel) panel.hidden = true;
    $$(".git-change-item").forEach((el) => el.classList.remove("is-diffing"));
  });
  $("#git-easy-stash")?.addEventListener("click", () => easyStash().catch((e) => showError(e.message)));
  $("#git-easy-stash-pop")?.addEventListener("click", () => easyStashPop().catch((e) => showError(e.message)));
  $("#git-easy-stash-apply")?.addEventListener("click", () => easyStashApplySel().catch((e) => showError(e.message)));
  $("#git-easy-undo")?.addEventListener("click", () => easyUndo().catch((e) => showError(e.message)));
  $("#git-easy-squash")?.addEventListener("click", () => easySquash().catch((e) => showError(e.message)));
  $("#git-easy-format-patch")?.addEventListener("click", () => easyFormatPatch().catch((e) => showError(e.message)));
  $("#git-easy-am")?.addEventListener("click", () => easyAm().catch((e) => showError(e.message)));
  $("#git-easy-apply")?.addEventListener("click", () => easyApply().catch((e) => showError(e.message)));
  $("#git-easy-switch")?.addEventListener("click", () => easySwitch().catch((e) => showError(e.message)));
  $("#git-easy-newbr-go")?.addEventListener("click", () => easyNewBranch().catch((e) => showError(e.message)));
  $("#git-branch-refresh")?.addEventListener("click", () => syncBranchesUi().catch((e) => showError(e.message)));
  $("#git-confirm-ok")?.addEventListener("click", () => settleConfirm(true));
  $("#git-confirm-cancel")?.addEventListener("click", () => settleConfirm(false));
  $("#git-ready-go")?.addEventListener("click", () => easyReadyGo().catch((e) => showError(e.message)));
  $("#git-conflict-next")?.addEventListener("click", () => jumpConflictMarker(1));
  $("#git-conflict-prev")?.addEventListener("click", () => jumpConflictMarker(-1));
  $("#git-conflict-view-split")?.addEventListener("click", () => setConflictViewMode("split"));
  $("#git-conflict-view-raw")?.addEventListener("click", () => setConflictViewMode("raw"));
  $("#git-conflict-split")?.addEventListener("click", (e) => {
    const stageBtn = e.target.closest?.("[data-conflict-stage-take]");
    if (stageBtn) {
      const side = stageBtn.getAttribute("data-conflict-stage-take");
      conflictTake(side).catch((err) => showError(err.message));
      return;
    }
    const btn = e.target.closest?.("[data-hunk-take]");
    if (!btn) return;
    const idx = Number(btn.getAttribute("data-hunk-idx"));
    const side = btn.getAttribute("data-hunk-take");
    if (!Number.isFinite(idx) || (side !== "ours" && side !== "theirs")) return;
    applyConflictHunkChoice(idx, side);
  });
  $("#git-conflict-text")?.addEventListener("input", () => {
    renderConflictPreview();
    if (conflictViewMode === "split") renderConflictSplit();
  });
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
  try {
    const os = window.devtoolsUnifiedBridgeBundle?.detectOs?.() || "";
    const prefer = os === "win" ? $("#git-dl-win") : os === "mac" ? $("#git-dl-mac") : $("#git-dl-linux");
    prefer?.classList.add("primary-btn");
    prefer?.classList.remove("secondary-btn");
  } catch (_) {
    /* ignore */
  }

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
