(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const panel = $("#everything");
  if (!panel) return;

  const BRIDGE_KEY = "devtools-ffmpeg-base";
  const TOKEN_KEY = "devtools-ffmpeg-token";
  const TARGET_KEY = "devtools-everything-target";
  const USER_KEY = "devtools-everything-user";
  const LEGACY_BASE_KEY = "devtools-everything-base";
  const RECENT_KEY = "devtools-everything-recent-v1";
  const LIVE_KEY = "devtools-everything-live-v1";
  const SETUP_GUIDE_HIDDEN_KEY = "devtools-everything-setup-guide-hidden-v1";
  const DEFAULT_BRIDGE = "http://127.0.0.1:17888";
  const DEFAULT_TARGET = "http://127.0.0.1";
  const DEFAULT_TOKEN = "devtools-bridge";
  const LIVE_DEBOUNCE_MS = 280;
  const MAX_RECENT = 16;

  const bridgeInput = $("#ev-bridge");
  const tokenInput = $("#ev-token");
  const targetInput = $("#ev-target");
  const passInput = $("#ev-pass");
  const dot = $("#ev-dot");
  const statusTitle = $("#ev-status-title");
  const statusText = $("#ev-status-text");
  const connectBtn = $("#ev-connect");
  const openWebTopBtn = $("#ev-open-web-top");
  const openWebBtn = $("#ev-open-web");
  const modeBanner = $("#ev-mode-banner");
  const modeTitle = $("#ev-mode-title");
  const modeText = $("#ev-mode-text");
  const setupGuide = $("#ev-setup-guide");
  const setupGuideDismiss = $("#ev-setup-guide-dismiss");
  const errorEl = $("#ev-error");
  const queryInput = $("#ev-query");
  const searchBtn = $("#ev-search");
  const resultsEl = $("#ev-results");
  const metaEl = $("#ev-meta");
  const prevBtn = $("#ev-prev");
  const nextBtn = $("#ev-next");
  const recentSelect = $("#ev-recent");
  const optLive = $("#ev-live");

  const optCase = $("#ev-case");
  const optWhole = $("#ev-wholeword");
  const optPath = $("#ev-path");
  const optRegex = $("#ev-regex");
  const optDiacritics = $("#ev-diacritics");
  const optSort = $("#ev-sort");
  const optAsc = $("#ev-asc");
  const optCount = $("#ev-count");

  let connected = false;
  let bridgeDown = false;
  let lastQuery = "";
  let lastTotal = 0;
  let offset = 0;
  let searching = false;
  let liveTimer = 0;
  let searchGen = 0;
  /** @type {string[]} */
  let lastResults = [];

  function toast(msg) {
    if (window.devtoolsToast) window.devtoolsToast(msg);
    else if (statusText) statusText.textContent = msg;
  }

  function showError(msg) {
    if (!errorEl) return;
    if (msg) {
      errorEl.textContent = msg;
      errorEl.hidden = false;
    } else {
      errorEl.hidden = true;
      errorEl.textContent = "";
    }
  }

  function isWindows() {
    return /Windows/i.test(navigator.userAgent || "");
  }

  function normalizeBase(raw, fallback = DEFAULT_TARGET) {
    let s = String(raw || "").trim();
    if (!s) s = fallback;
    if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
    return s.replace(/\/+$/, "");
  }

  function bridgeBase() {
    return normalizeBase(bridgeInput?.value || localStorage.getItem(BRIDGE_KEY) || DEFAULT_BRIDGE, DEFAULT_BRIDGE);
  }

  function everythingTarget() {
    return normalizeBase(targetInput?.value || localStorage.getItem(TARGET_KEY) || DEFAULT_TARGET, DEFAULT_TARGET);
  }

  function bridgeToken() {
    return String(tokenInput?.value || localStorage.getItem(TOKEN_KEY) || DEFAULT_TOKEN).trim() || DEFAULT_TOKEN;
  }

  function persistSettings() {
    try {
      localStorage.setItem(BRIDGE_KEY, bridgeBase());
      localStorage.setItem(TOKEN_KEY, bridgeToken());
      localStorage.setItem(TARGET_KEY, everythingTarget());
      localStorage.setItem(USER_KEY, userInput?.value?.trim() || "");
      localStorage.setItem(LIVE_KEY, optLive?.checked ? "1" : "0");
    } catch (_) {}
  }

  function loadSettings() {
    try {
      const savedBridge = localStorage.getItem(BRIDGE_KEY);
      if (savedBridge && bridgeInput) bridgeInput.value = savedBridge;
      const savedToken = localStorage.getItem(TOKEN_KEY);
      if (savedToken && tokenInput) tokenInput.value = savedToken;
      let savedTarget = localStorage.getItem(TARGET_KEY);
      if (!savedTarget) savedTarget = localStorage.getItem(LEGACY_BASE_KEY);
      if (savedTarget && targetInput) targetInput.value = savedTarget;
      const savedUser = localStorage.getItem(USER_KEY);
      if (savedUser && userInput) userInput.value = savedUser;
      const live = localStorage.getItem(LIVE_KEY);
      if (optLive && live != null) optLive.checked = live !== "0";
    } catch (_) {}
  }

  function readRecent() {
    try {
      const raw = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      return Array.isArray(raw) ? raw.filter((s) => typeof s === "string" && s.trim()) : [];
    } catch {
      return [];
    }
  }

  function pushRecent(q) {
    const s = String(q || "").trim();
    if (!s) return;
    const list = readRecent().filter((x) => x !== s);
    list.unshift(s);
    const next = list.slice(0, MAX_RECENT);
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch (_) {}
    syncRecentSelect(next);
  }

  function syncRecentSelect(list = readRecent()) {
    if (!recentSelect) return;
    recentSelect.innerHTML = '<option value="">最近搜索…</option>';
    for (const q of list) {
      const opt = document.createElement("option");
      opt.value = q;
      opt.textContent = q.length > 48 ? `${q.slice(0, 48)}…` : q;
      recentSelect.appendChild(opt);
    }
    recentSelect.hidden = list.length === 0;
  }

  function authHeaders() {
    const user = userInput?.value?.trim() || "";
    const pass = passInput?.value || "";
    if (!user) return {};
    const token = btoa(unescape(encodeURIComponent(`${user}:${pass}`)));
    return { Authorization: `Basic ${token}` };
  }

  function setStatus(kind, title, text) {
    dot?.classList.remove("is-ok", "is-warn", "is-err");
    if (kind) dot?.classList.add(kind);
    if (statusTitle) statusTitle.textContent = title;
    if (statusText) statusText.textContent = text;
  }

  function syncModeBanner() {
    if (!modeBanner) return;
    if (bridgeDown) {
      modeBanner.hidden = false;
      if (modeTitle) modeTitle.textContent = "本机桥未连接";
      if (modeText) {
        modeText.innerHTML =
          "请先运行 <span class=\"mono\">start-adb-bridge.cmd</span>（与 ADB 共用，端口 <span class=\"mono\">17888</span>），再点「测试连接」。仍可用「Everything 网页」直连。";
      }
    } else if (connected) {
      modeBanner.hidden = false;
      if (modeTitle) modeTitle.textContent = "已通过本机桥连接 Everything";
      if (modeText) modeText.textContent = "搜索经桥转发，HTTPS 站点也可正常使用。";
    } else {
      modeBanner.hidden = true;
    }
    panel.classList.toggle("is-connected", connected);
  }

  function isSetupGuideHidden() {
    try {
      return localStorage.getItem(SETUP_GUIDE_HIDDEN_KEY) === "1";
    } catch {
      return false;
    }
  }

  function syncSetupGuide() {
    if (!setupGuide) return;
    setupGuide.hidden = isSetupGuideHidden();
  }

  function dismissSetupGuide() {
    try {
      localStorage.setItem(SETUP_GUIDE_HIDDEN_KEY, "1");
    } catch (_) {}
    syncSetupGuide();
  }

  function formatBytes(n) {
    const num = Number(n);
    if (!Number.isFinite(num) || num < 0) return "";
    if (num < 1024) return `${num} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let v = num;
    let i = -1;
    do {
      v /= 1024;
      i += 1;
    } while (v >= 1024 && i < units.length - 1);
    return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
  }

  function buildSearchParams(query, opts = {}) {
    const params = new URLSearchParams();
    params.set("search", query);
    params.set("json", "1");
    params.set("path_column", "1");
    params.set("size_column", "1");
    params.set("date_modified_column", "1");
    params.set("date_created_column", "1");
    params.set("attributes_column", "1");
    params.set("offset", String(opts.offset ?? 0));
    params.set("count", String(opts.count ?? 100));
    params.set("sort", opts.sort || "name");
    params.set("ascending", opts.ascending ? "1" : "0");
    if (opts.case) params.set("case", "1");
    if (opts.wholeword) params.set("wholeword", "1");
    if (opts.path) params.set("path", "1");
    if (opts.regex) params.set("regex", "1");
    if (opts.diacritics) params.set("diacritics", "1");
    return params;
  }

  function webSearchUrl(query) {
    const params = buildSearchParams(query, currentOpts());
    params.delete("json");
    for (const k of ["path_column", "size_column", "date_modified_column", "date_created_column", "attributes_column"]) {
      params.delete(k);
    }
    return `${everythingTarget()}/?${params.toString()}`;
  }

  function searchParamsObject(query, opts) {
    const params = buildSearchParams(query, opts);
    const out = {};
    for (const [k, v] of params.entries()) out[k] = v;
    return out;
  }

  function bridgeHeaders() {
    const t = bridgeToken();
    const headers = {
      Accept: "application/json, text/plain, */*",
      "X-Adb-Token": t,
      "X-Ffmpeg-Token": t,
      ...authHeaders(),
    };
    return headers;
  }

  function bridgeApiUrl(path, extraParams = {}) {
    const url = new URL(`${bridgeBase()}${path}`);
    url.searchParams.set("target", everythingTarget());
    for (const [k, v] of Object.entries(extraParams)) url.searchParams.set(k, String(v));
    return url.toString();
  }

  async function bridgeFetch(path, extraParams = {}) {
    const res = await fetch(bridgeApiUrl(path, extraParams), {
      method: "GET",
      cache: "no-store",
      headers: bridgeHeaders(),
    });
    const type = res.headers.get("content-type") || "";
    if (type.includes("application/json")) {
      const data = await res.json();
      if (!res.ok || data.ok === false) {
        throw new Error(data.error || data.hint || `请求失败 (${res.status})`);
      }
      return data;
    }
    if (!res.ok) throw new Error(`请求失败 (${res.status})`);
    return res;
  }

  function currentOpts(extra = {}) {
    const count = Number(optCount?.value) || 100;
    return {
      offset,
      count,
      sort: optSort?.value || "name",
      ascending: !!optAsc?.checked,
      case: !!optCase?.checked,
      wholeword: !!optWhole?.checked,
      path: !!optPath?.checked,
      regex: !!optRegex?.checked,
      diacritics: !!optDiacritics?.checked,
      ...extra,
    };
  }

  function fullPath(item) {
    const path = String(item.path || "").trim();
    const name = String(item.name || "").trim();
    if (!path) return name;
    if (!name) return path;
    const sep = path.includes("\\") ? "\\" : "/";
    if (path.endsWith(sep) || path.endsWith(name)) return path;
    return `${path}${sep}${name}`;
  }

  function parentFolderPath(fp) {
    const s = String(fp || "").replace(/[\\/]+$/, "");
    const i = Math.max(s.lastIndexOf("\\"), s.lastIndexOf("/"));
    return i > 0 ? s.slice(0, i) : s;
  }

  function folderBrowseQuery(fp) {
    const p = String(fp || "").replace(/\//g, "\\");
    if (!p) return "";
    const q = p.endsWith("\\") ? p : `${p}\\`;
    return `parent:"${q}"`;
  }

  function desktopSearchCommand(query) {
    const q = String(query || "").replace(/"/g, '\\"');
    return `Everything.exe -search "${q}"`;
  }

  async function downloadViaBridge(fp) {
    const url = bridgeApiUrl("/everything/download", { path: fp });
    const res = await fetch(url, { headers: bridgeHeaders(), cache: "no-store" });
    if (!res.ok) {
      let msg = `下载失败 (${res.status})`;
      try {
        const data = await res.json();
        if (data?.error) msg = data.error;
      } catch (_) {}
      throw new Error(msg);
    }
    const blob = await res.blob();
    const name = String(fp).replace(/^.*[\\/]/, "") || "download.bin";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`已开始下载 ${name}`);
  }

  async function testConnection() {
    persistSettings();
    showError("");
    setStatus("", "正在连接…", "经本机桥探测 Everything");
    connectBtn.disabled = true;
    try {
      if (window.devtoolsBridgeToken?.readAutoStart?.("unified") !== false) {
        const found = await window.devtoolsBridgeToken?.ensureBridgeRunning?.({
          preferredBase: bridgeBase(),
          token: bridgeToken(),
          timeoutMs: 12000,
          launch: true,
          kind: "unified",
        });
        if (found?.base && bridgeInput && bridgeBase() !== found.base) {
          bridgeInput.value = found.base;
          persistSettings();
        }
        if (found?.health) {
          try {
            window.devtoolsBridgeToken?.rememberFromHealth?.(found.health, "unified");
          } catch (_) {
            /* ignore */
          }
        }
      }
      const data = await bridgeFetch("/everything/health", { count: "1", json: "1", search: "" });
      connected = true;
      bridgeDown = false;
      setStatus(
        "is-ok",
        "已连接 Everything",
        `经本机桥正常${Number.isFinite(data.totalResults) ? ` · 索引约 ${data.totalResults.toLocaleString()} 条` : ""}`
      );
      syncModeBanner();
      return true;
    } catch (err) {
      connected = false;
      const msg = err?.message || String(err);
      bridgeDown = /Failed to fetch|NetworkError|Load failed|Network request failed|ECONNREFUSED/i.test(msg);
      if (bridgeDown) {
        setStatus("is-err", "本机桥未连接", "请先运行 start-adb-bridge.cmd 并保持窗口打开，或点「启动本机桥」");
        showError(`${msg}。请确认本机桥已启动（${bridgeBase()}）且 Token 为 devtools-bridge`);
      } else {
        setStatus("is-err", "Everything 连接失败", msg);
        showError(msg);
      }
      syncModeBanner();
      return false;
    } finally {
      connectBtn.disabled = false;
    }
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

  function renderResults(data) {
    if (!resultsEl) return;
    resultsEl.innerHTML = "";
    lastResults = [];
    const rows = Array.isArray(data?.results) ? data.results : [];
    if (!rows.length) {
      resultsEl.innerHTML = '<p class="ev-empty">没有匹配结果</p>';
      return;
    }
    let idx = 0;
    for (const item of rows) {
      const fp = fullPath(item);
      lastResults.push(fp);
      const isFolder = item.type === "folder";
      const icon = isFolder ? "📁" : "📄";
      const size = item.size != null && !isFolder ? formatBytes(item.size) : isFolder ? "文件夹" : "";
      const modified = item.date_modified ? String(item.date_modified) : "";
      const created = item.date_created ? String(item.date_created) : "";
      const attrs = item.attributes ? String(item.attributes) : "";

      const row = document.createElement("div");
      row.className = "ev-row";
      row.dataset.evIdx = String(idx);
      row.setAttribute("role", "listitem");
      row.tabIndex = 0;
      row.innerHTML = `
        <span class="ev-row-icon" aria-hidden="true">${icon}</span>
        <div class="ev-row-main">
          <div class="ev-row-name">${escapeHtml(item.name || fp)}</div>
          <div class="ev-row-path mono">${escapeHtml(fp)}</div>
        </div>
        <div class="ev-row-meta">
          ${size ? `<span>${escapeHtml(size)}</span>` : ""}
          ${modified ? `<span title="修改时间">${escapeHtml(modified)}</span>` : ""}
          ${created ? `<span title="创建时间">${escapeHtml(created)}</span>` : ""}
          ${attrs ? `<span title="属性">${escapeHtml(attrs)}</span>` : ""}
        </div>
        <div class="ev-row-actions">
          <button type="button" class="ghost-btn" data-ev-copy="${escapeAttr(fp)}">复制路径</button>
          <button type="button" class="ghost-btn" data-ev-cmd="${escapeAttr(desktopSearchCommand(fp))}">桌面搜索</button>
          ${isFolder ? `<button type="button" class="ghost-btn" data-ev-enter="${escapeAttr(fp)}">进入文件夹</button>` : ""}
          ${!isFolder ? `<button type="button" class="ghost-btn" data-ev-parent="${escapeAttr(parentFolderPath(fp))}">上级目录</button>` : ""}
          <button type="button" class="ghost-btn" data-ev-web="${escapeAttr(fp)}">网页打开</button>
          ${!isFolder ? `<button type="button" class="ghost-btn" data-ev-dl="${escapeAttr(fp)}">下载</button>` : ""}
        </div>`;
      if (isFolder) {
        row.addEventListener("dblclick", (e) => {
          if (e.target.closest("button,a")) return;
          enterFolder(fp);
        });
      }
      row.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          copyText(fp);
        }
      });
      resultsEl.appendChild(row);
      idx += 1;
    }
  }

  function updatePager() {
    const count = Number(optCount?.value) || 100;
    if (prevBtn) prevBtn.disabled = offset <= 0 || searching;
    if (nextBtn) nextBtn.disabled = offset + count >= lastTotal || searching;
    if (metaEl) {
      if (!lastQuery && !searching) metaEl.textContent = "输入关键词；开启「实时搜索」时随输入过滤";
      else if (searching) metaEl.textContent = "搜索中…";
      else {
        const from = lastTotal ? offset + 1 : 0;
        const to = Math.min(offset + count, lastTotal);
        metaEl.textContent = `「${lastQuery}」共 ${lastTotal.toLocaleString()} 条 · 显示 ${from}–${to}`;
      }
    }
  }

  function mergePreset(base, preset) {
    const b = String(base || "").trim();
    const p = String(preset || "").trim();
    if (!p) return b;
    if (!b) return p;
    if (b.includes(p)) return b;
    return `${b} ${p}`;
  }

  function enterFolder(fp) {
    const q = folderBrowseQuery(fp);
    if (!q || !queryInput) return;
    queryInput.value = q;
    runSearch(true);
  }

  async function runSearch(resetOffset = true, opts = {}) {
    const query = queryInput?.value?.trim() ?? "";
    if (!query) {
      if (!opts.allowEmpty) {
        showError("请输入搜索关键词");
        return;
      }
      if (resultsEl) resultsEl.innerHTML = "";
      lastQuery = "";
      lastTotal = 0;
      updatePager();
      return;
    }
    persistSettings();
    showError("");
    if (resetOffset) offset = 0;
    lastQuery = query;
    searching = true;
    const gen = ++searchGen;
    updatePager();
    searchBtn.disabled = true;
    try {
      if (!connected) {
        const ok = await testConnection();
        if (!ok) return;
      }
      const params = searchParamsObject(query, currentOpts());
      const data = await bridgeFetch("/everything/search", params);
      if (gen !== searchGen) return;
      lastTotal = Number(data?.totalResults) || 0;
      renderResults(data);
      if (!opts.skipRecent) pushRecent(query);
    } catch (err) {
      if (gen !== searchGen) return;
      const msg = err?.message || String(err);
      if (/Failed to fetch|NetworkError|Load failed|Network request failed/i.test(msg)) {
        bridgeDown = true;
        connected = false;
        syncModeBanner();
        showError(`${msg}。本机桥可能已关闭，请重启 start-adb-bridge.cmd`);
      } else {
        showError(msg);
        if (resultsEl) resultsEl.innerHTML = "";
      }
    } finally {
      if (gen === searchGen) {
        searching = false;
        searchBtn.disabled = false;
        updatePager();
      }
    }
  }

  function scheduleLiveSearch() {
    if (!optLive?.checked) return;
    if (liveTimer) clearTimeout(liveTimer);
    liveTimer = setTimeout(() => {
      liveTimer = 0;
      const q = queryInput?.value?.trim() ?? "";
      if (!q) {
        runSearch(true, { allowEmpty: true, skipRecent: true });
        return;
      }
      runSearch(true, { skipRecent: true });
    }, LIVE_DEBOUNCE_MS);
  }

  function openWebSearch() {
    persistSettings();
    const q = queryInput?.value?.trim() || "";
    window.open(webSearchUrl(q), "_blank", "noopener,noreferrer");
  }

  function copyText(text) {
    const s = String(text || "");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(s).then(() => toast("已复制")).catch(() => fallbackCopy(s));
    } else fallbackCopy(s);
  }

  function fallbackCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      toast("已复制");
    } catch (_) {
      toast("复制失败");
    }
    ta.remove();
  }

  loadSettings();
  syncSetupGuide();
  syncRecentSelect();

  if (!isWindows()) {
    setStatus("is-warn", "Everything 仅支持 Windows", "需 Windows + Everything HTTP Server；其他系统可浏览教程");
  }

  connectBtn?.addEventListener("click", () => testConnection());
  openWebTopBtn?.addEventListener("click", openWebSearch);
  openWebBtn?.addEventListener("click", openWebSearch);

  window.devtoolsBridgeToken?.bindBridgeLaunchUI?.({
    kind: "unified",
    dirInput: $("#ev-install-dir"),
    saveBtn: $("#ev-install-dir-save"),
    launchBtn: $("#ev-bridge-launch"),
    autoEl: $("#ev-bridge-autostart"),
    getPreferredBase: () => bridgeBase(),
    getToken: () => bridgeToken(),
    onStatus: (kind, title, text) => setStatus(kind, title, text),
    onConnected: async () => {
      await testConnection();
    },
    toast: (msg) => setStatus("is-ok", "桥目录", msg),
  });

  void (async () => {
    if (window.devtoolsBridgeToken?.readAutoStart?.("unified") === false) return;
    if (!isWindows()) return;
    try {
      await testConnection();
    } catch (_) {
      /* ignore */
    }
  })();

  setupGuideDismiss?.addEventListener("click", dismissSetupGuide);
  searchBtn?.addEventListener("click", () => runSearch(true));
  queryInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch(true);
  });
  queryInput?.addEventListener("input", scheduleLiveSearch);
  optLive?.addEventListener("change", () => {
    persistSettings();
    scheduleLiveSearch();
  });
  recentSelect?.addEventListener("change", () => {
    const v = recentSelect.value;
    if (!v || !queryInput) return;
    queryInput.value = v;
    runSearch(true);
    recentSelect.value = "";
  });

  $$("[data-ev-preset]", panel).forEach((btn) => {
    btn.addEventListener("click", () => {
      const preset = btn.getAttribute("data-ev-preset") || "";
      if (!queryInput) return;
      queryInput.value = mergePreset(queryInput.value, preset);
      queryInput.focus();
      runSearch(true);
    });
  });

  [optCase, optWhole, optPath, optRegex, optDiacritics, optSort, optAsc, optCount].forEach((el) => {
    el?.addEventListener("change", () => {
      if (lastQuery || queryInput?.value?.trim()) runSearch(true, { skipRecent: true });
    });
  });

  prevBtn?.addEventListener("click", () => {
    const count = Number(optCount?.value) || 100;
    offset = Math.max(0, offset - count);
    runSearch(false, { skipRecent: true });
  });
  nextBtn?.addEventListener("click", () => {
    const count = Number(optCount?.value) || 100;
    offset += count;
    runSearch(false, { skipRecent: true });
  });

  resultsEl?.addEventListener("click", (e) => {
    const copyBtn = e.target.closest("[data-ev-copy]");
    if (copyBtn) {
      copyText(copyBtn.getAttribute("data-ev-copy"));
      return;
    }
    const cmdBtn = e.target.closest("[data-ev-cmd]");
    if (cmdBtn) {
      copyText(cmdBtn.getAttribute("data-ev-cmd"));
      toast("已复制桌面版命令，可在 cmd 或 Win+R 运行");
      return;
    }
    const enterBtn = e.target.closest("[data-ev-enter]");
    if (enterBtn) {
      enterFolder(enterBtn.getAttribute("data-ev-enter") || "");
      return;
    }
    const parentBtn = e.target.closest("[data-ev-parent]");
    if (parentBtn) {
      const p = parentBtn.getAttribute("data-ev-parent") || "";
      if (queryInput) {
        queryInput.value = folderBrowseQuery(p);
        runSearch(true);
      }
      return;
    }
    const webBtn = e.target.closest("[data-ev-web]");
    if (webBtn) {
      const fp = webBtn.getAttribute("data-ev-web") || "";
      window.open(webSearchUrl(fp), "_blank", "noopener,noreferrer");
      return;
    }
    const dlBtn = e.target.closest("[data-ev-dl]");
    if (dlBtn) {
      downloadViaBridge(dlBtn.getAttribute("data-ev-dl") || "").catch((err) => showError(err.message || String(err)));
    }
  });

  [bridgeInput, tokenInput, targetInput, userInput, passInput].forEach((el) => {
    el?.addEventListener("change", persistSettings);
  });

  updatePager();
})();
