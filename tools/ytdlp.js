(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const panel = $("#ytdlp");
  if (!panel) return;

  if (!window.devtoolsBridgeShell?.mount) {
    console.error("devtoolsBridgeShell 未加载");
    return;
  }

  const bridgeShell = window.devtoolsBridgeShell.mount({
    host: "#yd-bridge-shell",
    prefix: "yd",
    kind: "unified",
    collapseAdvanced: true,
    refreshLabel: "刷新",
    hintDisconnected: "请先下载完整 ZIP 并运行启动脚本；本机 PATH 需有 yt-dlp，合并/抽音还要 ffmpeg。",
    connHint: '与 ADB / FFmpeg <strong>共用一座桥</strong>：17888 · Token <span class="mono">devtools-bridge</span> · API <span class="mono">/ytdlp/*</span>。',
    extraActions: [{ id: "update", label: "更新 yt-dlp", disabled: true, className: "ghost-btn" }],
  });

  const BASE_KEY = "devtools-ffmpeg-base";
  const TOKEN_KEY = "devtools-ffmpeg-token";
  const DIR_KEY = "devtools-ytdlp-outdir";
  const DEFAULT_BASE = "http://127.0.0.1:17888";
  const DEFAULT_TOKEN = "devtools-bridge";

  const baseInput = bridgeShell.els.base;
  const tokenInput = bridgeShell.els.token;
  const dot = bridgeShell.els.dot;
  const statusTitle = bridgeShell.els.title;
  const statusText = bridgeShell.els.text;
  const toolsProbe = $("#yd-tools-probe");
  const setupGuide = $("#yd-setup-guide");
  const setupGuideDismiss = $("#yd-setup-guide-dismiss");
  const YD_SETUP_GUIDE_HIDDEN_KEY = "devtools-ytdlp-setup-guide-hidden-v1";
  const installGuide = $("#yd-install-guide");
  const errorEl = $("#yd-error");
  const workspace = $("#yd-workspace");
  const connectBtn = bridgeShell.els.connect;
  const refreshBtn = bridgeShell.els.refresh;
  const updateBtn = $("#yd-update");
  const rootsEl = $("#yd-roots");
  const pathInput = $("#yd-fs-path");
  const listEl = $("#yd-fs-list");
  const fsMeta = $("#yd-fs-meta");
  const urlsEl = $("#yd-urls");
  const probeOut = $("#yd-probe-out");
  const jobsEl = $("#yd-jobs");
  const extractorsOut = $("#yd-extractors-out");

  let connected = false;
  let ffPrefix = "/ff";
  let cwd = "";
  let entries = [];
  let pollTimer = 0;
  let selectedFormat = "";

  function toast(msg) {
    if (window.devtoolsToast) window.devtoolsToast(msg);
    else if (statusText) statusText.textContent = msg;
  }

  function isSetupGuideHidden() {
    try {
      return localStorage.getItem(YD_SETUP_GUIDE_HIDDEN_KEY) === "1";
    } catch (_) {
      return false;
    }
  }

  function syncSetupGuide() {
    if (!setupGuide) return;
    setupGuide.hidden = isSetupGuideHidden();
  }

  function dismissSetupGuide() {
    try {
      localStorage.setItem(YD_SETUP_GUIDE_HIDDEN_KEY, "1");
    } catch (_) {}
    syncSetupGuide();
  }

  syncSetupGuide();
  setupGuideDismiss?.addEventListener("click", dismissSetupGuide);

  function detectOs() {
    const ua = navigator.userAgent || "";
    if (/Windows/i.test(ua)) return "win";
    if (/Mac/i.test(ua)) return "mac";
    return "linux";
  }

  function setInstallGuideOs(os) {
    if (!installGuide) return;
    const next = os === "win" || os === "linux" ? os : "mac";
    $$("[data-yd-setup-os]", installGuide).forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.ydSetupOs === next);
    });
    $$("[data-yd-setup-panel]", installGuide).forEach((el) => {
      el.hidden = el.dataset.ydSetupPanel !== next;
    });
    try {
      localStorage.setItem("devtools-ytdlp-setup-os", next);
    } catch (_) {}
  }

  if (installGuide) {
    let initialOs = detectOs();
    try {
      const saved = localStorage.getItem("devtools-ytdlp-setup-os");
      if (saved === "mac" || saved === "win" || saved === "linux") initialOs = saved;
    } catch (_) {}
    setInstallGuideOs(initialOs);
    $$("[data-yd-setup-os]", installGuide).forEach((btn) => {
      btn.addEventListener("click", () => setInstallGuideOs(btn.dataset.ydSetupOs));
    });
  }

  async function fetchTextAsset(path) {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error(`无法读取 ${path}（${res.status}）`);
    return res.text();
  }

  async function downloadBundle(platform) {
    await bridgeShell.downloadBundle(platform, {
      onDone: () => startWaitPoll(),
    });
  }

  let waitPollTimer = 0;
  function startWaitPoll() {
    clearInterval(waitPollTimer);
    let n = 0;
    waitPollTimer = setInterval(async () => {
      n += 1;
      try {
        await connectBridge();
        if (connected || n >= 60) clearInterval(waitPollTimer);
      } catch (_) {
        if (n >= 60) clearInterval(waitPollTimer);
      }
    }, 2000);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function baseUrl() {
    return String(baseInput?.value || DEFAULT_BASE).replace(/\/$/, "");
  }

  function token() {
    return String(tokenInput?.value || DEFAULT_TOKEN).trim();
  }

  function savePrefs() {
    try {
      localStorage.setItem(BASE_KEY, baseUrl());
      localStorage.setItem(TOKEN_KEY, token());
      if (cwd) localStorage.setItem(DIR_KEY, cwd);
    } catch (_) {
      /* ignore */
    }
  }

  function loadPrefs() {
    try {
      const b = localStorage.getItem(BASE_KEY);
      const t = localStorage.getItem(TOKEN_KEY);
      const d = localStorage.getItem(DIR_KEY);
      if (baseInput && b) baseInput.value = b;
      if (tokenInput && t) tokenInput.value = t;
      if (d) cwd = d;
    } catch (_) {
      /* ignore */
    }
  }

  function setStatus(kind, title, text) {
    bridgeShell.setStatus(kind, title, text);
  }

  function setError(msg) {
    if (!errorEl) return;
    errorEl.hidden = !msg;
    errorEl.textContent = msg || "";
  }

  async function api(pathname, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (opts.auth !== false) {
      headers["X-Ffmpeg-Token"] = token();
      headers["X-Adb-Token"] = token();
    }
    if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const res = await fetch(`${baseUrl()}${pathname}`, {
      method: opts.method || "GET",
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = null;
    }
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || text || `HTTP ${res.status}`);
    }
    return data;
  }

  function yd(path, opts) {
    return api(`/ytdlp${path.startsWith("/") ? path : `/${path}`}`, opts);
  }

  function ff(path, opts) {
    const p = path.startsWith("/") ? path : `/${path}`;
    return api(`${ffPrefix}${p}`, opts);
  }

  function val(id) {
    return $(id)?.value?.trim() || "";
  }
  function checked(id) {
    return Boolean($(id)?.checked);
  }
  function num(id) {
    const n = Number.parseInt(val(id), 10);
    return Number.isFinite(n) ? n : "";
  }

  function collectOpts() {
    const mode = val("#yd-mode") || "best";
    const body = {
      urls: urlsEl?.value || "",
      outDir: pathInput?.value || cwd,
      mode,
      height: num("#yd-height") || 1080,
      format: selectedFormat || val("#yd-format"),
      formatSort: val("#yd-sort"),
      mergeOutputFormat: val("#yd-merge"),
      audioFormat: val("#yd-audio-fmt") || "mp3",
      audioQuality: num("#yd-audio-q"),
      recodeVideo: val("#yd-recode"),
      remuxVideo: val("#yd-remux"),
      playlistItems: val("#yd-pl-items"),
      playlistStart: num("#yd-pl-start"),
      playlistEnd: num("#yd-pl-end"),
      maxDownloads: num("#yd-max-dl"),
      dateAfter: val("#yd-date-after"),
      dateBefore: val("#yd-date-before"),
      matchFilter: val("#yd-match"),
      yesPlaylist: checked("#yd-yes-playlist"),
      noPlaylist: checked("#yd-no-playlist") && !checked("#yd-yes-playlist"),
      playlistRandom: checked("#yd-pl-random"),
      lazyPlaylist: checked("#yd-lazy-pl"),
      downloadArchive: checked("#yd-archive"),
      ignoreErrors: checked("#yd-ignore-err"),
      writeSubs: checked("#yd-subs"),
      writeAutoSubs: checked("#yd-auto-subs"),
      embedSubs: checked("#yd-embed-subs"),
      subLangs: val("#yd-sub-langs"),
      convertSubs: val("#yd-sub-conv"),
      writeThumbnail: checked("#yd-thumb"),
      embedThumbnail: checked("#yd-embed-thumb"),
      writeInfoJson: checked("#yd-infojson"),
      writeDescription: checked("#yd-desc"),
      writeComments: checked("#yd-comments"),
      writeLink: checked("#yd-link"),
      embedMetadata: checked("#yd-meta"),
      embedChapters: checked("#yd-chapters"),
      splitChapters: checked("#yd-split-ch"),
      sponsorblockMark: val("#yd-sb-mark"),
      sponsorblockRemove: val("#yd-sb-rm"),
      cookiesFromBrowser: val("#yd-browser"),
      cookiesFile: val("#yd-cookies-file"),
      proxy: val("#yd-proxy"),
      extractorArgs: val("#yd-client"),
      limitRate: val("#yd-rate"),
      concurrentFragments: num("#yd-conc") || 4,
      retries: num("#yd-retries") || 10,
      geoBypass: checked("#yd-geo"),
      forceIpv4: checked("#yd-v4"),
      forceIpv6: checked("#yd-v6"),
      liveFromStart: checked("#yd-live-start"),
      waitForVideo: num("#yd-wait") || 0,
      hlsUseMpegts: checked("#yd-hls-ts"),
      outputTemplate: val("#yd-template"),
      restrictFilenames: checked("#yd-restrict"),
      windowsFilenames: checked("#yd-win-names"),
      noOverwrites: checked("#yd-no-ow"),
      keepVideo: checked("#yd-keep"),
      simulate: checked("#yd-simulate"),
    };
    return body;
  }

  function formatSize(n) {
    const x = Number(n) || 0;
    if (!x) return "";
    if (x < 1024) return `${x} B`;
    if (x < 1024 * 1024) return `${(x / 1024).toFixed(1)} KB`;
    return `${(x / (1024 * 1024)).toFixed(1)} MB`;
  }

  function formatDur(sec) {
    const s = Math.max(0, Math.floor(Number(sec) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    if (h) return `${h}:${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
    return `${m}:${String(r).padStart(2, "0")}`;
  }

  function renderProbe(data) {
    if (!probeOut) return;
    const results = data.results || [];
    probeOut.hidden = !results.length;
    probeOut.innerHTML = results
      .map((r) => {
        if (!r.ok) {
          return `<div class="panel-card yd-card"><p class="error">${escapeHtml(r.url)}</p><p>${escapeHtml(r.error)}</p></div>`;
        }
        const info = r.info || {};
        if (info.type === "playlist") {
          const rows = (info.entries || [])
            .slice(0, 80)
            .map(
              (e) =>
                `<tr><td>${e.index}</td><td>${escapeHtml(e.title)}</td><td class="mono">${formatDur(e.duration)}</td></tr>`
            )
            .join("");
          return `<div class="panel-card yd-card">
            <p><strong>${escapeHtml(info.title)}</strong> · 播放列表 ${info.nEntries} 条 · ${escapeHtml(info.extractor || "")}</p>
            <p class="hint tight mono">${escapeHtml(info.webpage_url || r.url)}</p>
            <div class="yd-table-wrap"><table class="yd-table"><thead><tr><th>#</th><th>标题</th><th>时长</th></tr></thead><tbody>${rows}</tbody></table></div>
          </div>`;
        }
        const fmts = (info.formats || [])
          .slice()
          .sort((a, b) => (b.height || 0) - (a.height || 0) || (b.tbr || 0) - (a.tbr || 0))
          .slice(0, 80);
        const fmtRows = fmts
          .map((f) => {
            const kind = f.audioOnly ? "音频" : f.videoOnly ? "视频" : "音画";
            return `<tr>
              <td><label class="flag"><input type="radio" name="yd-fmt" value="${escapeAttr(f.id)}" /> ${escapeHtml(f.id)}</label></td>
              <td>${escapeHtml(kind)}</td>
              <td>${escapeHtml(f.resolution || "")}</td>
              <td>${f.fps || ""}</td>
              <td>${escapeHtml(f.vcodec || f.acodec || "")}</td>
              <td>${formatSize(f.filesize)}</td>
              <td>${escapeHtml(f.note || "")}</td>
            </tr>`;
          })
          .join("");
        const thumb = info.thumbnail
          ? `<img class="yd-thumb" src="${escapeAttr(info.thumbnail)}" alt="" referrerpolicy="no-referrer" />`
          : "";
        const subs = (info.subtitles || []).join(", ");
        return `<div class="panel-card yd-card">
          <div class="yd-video-head">${thumb}<div>
            <p><strong>${escapeHtml(info.title)}</strong></p>
            <p class="hint tight">${escapeHtml(info.uploader || "")} · ${formatDur(info.duration)} · ${escapeHtml(info.extractor || "")}${info.isLive ? " · 直播" : ""}</p>
            <p class="hint tight mono">${escapeHtml(info.webpage_url || r.url)}</p>
            ${subs ? `<p class="hint tight">字幕：${escapeHtml(subs)}</p>` : ""}
            ${info.chapters?.length ? `<p class="hint tight">章节 ${info.chapters.length} 段</p>` : ""}
          </div></div>
          <div class="yd-table-wrap"><table class="yd-table">
            <thead><tr><th>id</th><th>类型</th><th>分辨率</th><th>fps</th><th>编码</th><th>体积</th><th>备注</th></tr></thead>
            <tbody>${fmtRows}</tbody>
          </table></div>
        </div>`;
      })
      .join("");
    probeOut.querySelectorAll('input[name="yd-fmt"]').forEach((el) => {
      el.addEventListener("change", () => {
        selectedFormat = el.value;
        const fmtInput = $("#yd-format");
        if (fmtInput) fmtInput.value = el.value;
        const mode = $("#yd-mode");
        if (mode) mode.value = "format";
      });
    });
  }

  function renderRoots(roots) {
    if (!rootsEl) return;
    rootsEl.innerHTML = "";
    (roots || []).forEach((r) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ghost-btn";
      btn.textContent = r.name || r.path;
      btn.title = r.path;
      btn.addEventListener("click", () => openPath(r.path));
      rootsEl.appendChild(btn);
    });
  }

  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = "";
    const dirs = entries.filter((e) => e.isDir);
    if (!dirs.length) {
      listEl.innerHTML = `<p class="hint tight">（目录内文件夹会显示在这里；下载将写入当前路径）</p>`;
      return;
    }
    dirs.slice(0, 80).forEach((e) => {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "adb-fs-row";
      row.textContent = e.name;
      row.addEventListener("click", () => openPath(e.path));
      listEl.appendChild(row);
    });
  }

  async function openPath(dir) {
    const data = await ff("/local/list?path=" + encodeURIComponent(dir));
    cwd = data.path || dir;
    const sep = cwd.includes("\\") ? "\\" : "/";
    entries = (data.entries || []).map((e) => ({
      ...e,
      isDir: e.type === "dir" || e.isDir,
      path: e.path || `${cwd.replace(/[\\/]+$/, "")}${sep}${e.name}`,
    }));
    if (pathInput) pathInput.value = cwd;
    if (fsMeta) fsMeta.textContent = cwd;
    savePrefs();
    renderList();
  }

  function renderJobs(jobs) {
    if (!jobsEl) return;
    if (!jobs.length) {
      jobsEl.innerHTML = `<p class="hint tight">暂无下载任务</p>`;
      return;
    }
    jobsEl.innerHTML = jobs
      .map((j) => {
        const pct = Math.round((Number(j.progress) || 0) * 100);
        const arts = (j.artifacts || [])
          .slice(0, 4)
          .map((a) => escapeHtml(a.name))
          .join(" · ");
        const cancel =
          j.status === "running" || j.status === "queued"
            ? `<button type="button" class="ghost-btn" data-yd-cancel="${escapeAttr(j.id)}">取消</button>`
            : "";
        const reveal =
          j.meta?.outDir && (j.status === "done" || j.status === "error")
            ? `<button type="button" class="ghost-btn" data-yd-reveal="${escapeAttr(j.meta.outDir)}">打开目录</button>`
            : "";
        return `<div class="adb-job">
          <div class="adb-job-main">
            <strong>${escapeHtml(j.meta?.title || j.id)}</strong>
            <span class="hint tight">${escapeHtml(j.status)} · ${pct}%</span>
            <p class="hint tight">${escapeHtml(j.message || "")}</p>
            ${arts ? `<p class="hint tight mono">${arts}</p>` : ""}
            ${j.error ? `<p class="error">${escapeHtml(j.error)}</p>` : ""}
          </div>
          <div class="btn-row">${cancel}${reveal}</div>
        </div>`;
      })
      .join("");
    jobsEl.querySelectorAll("[data-yd-cancel]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await yd(`/jobs/${btn.getAttribute("data-yd-cancel")}/cancel`, { method: "POST", body: {} });
          toast("已请求取消");
        } catch (err) {
          setError(err.message);
        }
      });
    });
    jobsEl.querySelectorAll("[data-yd-reveal]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await yd("/reveal", { method: "POST", body: { path: btn.getAttribute("data-yd-reveal") } });
        } catch (err) {
          setError(err.message);
        }
      });
    });
  }

  async function refreshJobs() {
    const data = await yd("/jobs");
    renderJobs(data.jobs || []);
  }

  function startPoll() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (!connected) return;
      refreshJobs().catch(() => {});
    }, 1500);
  }

  async function connectBridge() {
    savePrefs();
    setError("");
    try {
      let discovered = await window.devtoolsBridgeToken?.discoverBase?.(baseUrl(), token(), { kind: "unified" });
      if (!discovered?.health && window.devtoolsBridgeToken?.readAutoStart?.("unified") !== false) {
        discovered = await window.devtoolsBridgeToken?.ensureBridgeRunning?.({
          preferredBase: baseUrl(),
          token: token(),
          timeoutMs: 12000,
          launch: true,
          kind: "unified",
        });
      }
      if (!discovered?.health) throw new Error("无法连接本机桥。请确认启动脚本窗口仍打开，或点「启动本机桥」。");
      try {
        window.devtoolsBridgeToken?.rememberFromHealth?.(discovered.health, "unified");
      } catch (_) {
        /* ignore */
      }
      if (baseInput && baseUrl() !== discovered.base) {
        baseInput.value = discovered.base;
        savePrefs();
      }
      const health = discovered.health;
      if (health?.unified || health?.ffmpegMount === "/ff" || health?.service === "devtools-bridge") {
        ffPrefix = "/ff";
      } else if (health?.service === "devtools-ffmpeg-bridge") {
        ffPrefix = "";
      } else {
        ffPrefix = "/ff";
      }
      const ydHealth = await yd("/health", { auth: false });
      const ok = Boolean(ydHealth.ytdlp?.ok);
      if (toolsProbe) {
        toolsProbe.hidden = false;
        toolsProbe.textContent = `yt-dlp ${ok ? ydHealth.ytdlp.version : "未找到"} · ffmpeg ${
          ydHealth.ffmpeg?.ok ? "ok" : "缺"
        } · ${ydHealth.ytdlp?.path || ""}`;
      }
      if (!ok) {
        connected = false;
        if (workspace) workspace.hidden = true;
        setStatus("is-warn", "桥已连上但未找到 yt-dlp", ydHealth.ytdlp?.setup || ydHealth.ytdlp?.error || "");
        if (refreshBtn) refreshBtn.disabled = true;
        if (updateBtn) updateBtn.disabled = true;
        setError(
          isSetupGuideHidden()
            ? "本机未找到 yt-dlp。请安装并加入 PATH 后重启桥。"
            : "本机未找到 yt-dlp。见上方「本机依赖怎么配？」或底部安装教程。"
        );
        return;
      }
      connected = true;
      if (workspace) workspace.hidden = false;
      if (refreshBtn) refreshBtn.disabled = false;
      if (updateBtn) updateBtn.disabled = false;
      setStatus("is-ok", "已连接 · yt-dlp", ydHealth.ytdlp.version || "ok");
      const roots = ydHealth.roots || [];
      renderRoots(roots);
      const home = cwd && roots.some((r) => cwd.startsWith(r.path)) ? cwd : roots[0]?.path || "";
      if (home) await openPath(home);
      await refreshJobs();
      startPoll();
    } catch (err) {
      connected = false;
      if (workspace) workspace.hidden = true;
      setStatus("is-err", "未连接本机桥", err.message || String(err));
      setError(
        err.message ||
          (isSetupGuideHidden()
            ? "无法连接本机桥。请下载完整 ZIP、运行启动脚本并保持窗口打开。"
            : "无法连接本机桥。见上方「本机依赖怎么配？」或底部安装教程。")
      );
    }
  }

  async function doProbe(asPlaylist) {
    setError("");
    selectedFormat = "";
    try {
      const body = collectOpts();
      body.flat = Boolean(asPlaylist);
      body.yesPlaylist = Boolean(asPlaylist);
      if (asPlaylist) body.noPlaylist = false;
      const data = await yd("/probe", { method: "POST", body });
      renderProbe(data);
      const first = data.results?.find((r) => r.ok);
      toast(first ? "解析完成" : "解析结束（有失败项）");
    } catch (err) {
      setError(err.message || String(err));
    }
  }

  bridgeShell.bind({
    onStatus: (kind, title, text) => setStatus(kind, title, text),
    onConnected: async () => {
      await connectBridge();
    },
    onConnect: () => connectBridge(),
    onRefresh: () => connectBridge(),
    onDownloadDone: () => startWaitPoll(),
    onDownloadError: (err) => setError(err.message || String(err)),
    onPersist: () => savePrefs(),
    toast: (msg) => setStatus("is-ok", "桥目录", msg),
  });

  updateBtn?.addEventListener("click", async () => {
    try {
      const data = await yd("/update", { method: "POST", body: {} });
      toast("更新完成");
      if (toolsProbe) toolsProbe.textContent = data.output?.slice(0, 200) || "updated";
      await connectBridge();
    } catch (err) {
      setError(err.message);
    }
  });
  $("#yd-probe")?.addEventListener("click", () => doProbe(false));
  $("#yd-probe-list")?.addEventListener("click", () => doProbe(true));
  $("#yd-download")?.addEventListener("click", async () => {
    setError("");
    try {
      const body = collectOpts();
      if (!String(body.urls || "").trim()) throw new Error("请先粘贴链接");
      if (!body.outDir) throw new Error("请选择保存目录");
      const data = await yd("/download", { method: "POST", body });
      toast("已加入下载队列");
      renderJobs([data.job, ...[]]);
      await refreshJobs();
    } catch (err) {
      setError(err.message || String(err));
    }
  });
  $("#yd-extractors")?.addEventListener("click", async () => {
    try {
      const data = await yd("/extractors");
      if (extractorsOut) {
        extractorsOut.hidden = false;
        extractorsOut.textContent = `${data.count} 个站点\n${(data.extractors || []).join("\n")}`;
      }
    } catch (err) {
      setError(err.message);
    }
  });
  $("#yd-fs-go")?.addEventListener("click", () => openPath(pathInput.value).catch((e) => setError(e.message)));
  $("#yd-fs-up")?.addEventListener("click", () => {
    const p = pathInput.value.replace(/[\\/]+$/, "");
    const parent = p.replace(/[\\/][^\\/]+$/, "") || p;
    openPath(parent || cwd).catch((e) => setError(e.message));
  });
  $("#yd-fs-mkdir")?.addEventListener("click", async () => {
    const name = window.prompt("新文件夹名");
    if (!name) return;
    try {
      await ff("/local/mkdir", { method: "POST", body: { path: `${cwd.replace(/[\\/]+$/, "")}/${name}` } });
      await openPath(cwd);
    } catch (err) {
      setError(err.message);
    }
  });
  $("#yd-fs-reveal")?.addEventListener("click", async () => {
    try {
      await yd("/reveal", { method: "POST", body: { path: pathInput.value || cwd } });
    } catch (err) {
      setError(err.message);
    }
  });

  loadPrefs();
  document.addEventListener("devtools:route", (e) => {
    if (e.detail?.tool === "ytdlp" && !connected) connectBridge().catch(() => {});
  });
  void (async () => {
    if (window.devtoolsBridgeToken?.readAutoStart?.("unified") === false) return;
    try {
      const found = await window.devtoolsBridgeToken?.ensureBridgeRunning?.({
        preferredBase: baseUrl(),
        token: token(),
        timeoutMs: 12000,
        launch: true,
        kind: "unified",
      });
      if (found?.health) await connectBridge();
    } catch (_) {
      /* ignore */
    }
  })();
})();
