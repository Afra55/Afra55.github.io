(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  const panel = $("#everything");
  if (!panel) return;

  const BASE_KEY = "devtools-everything-base";
  const USER_KEY = "devtools-everything-user";
  const SETUP_GUIDE_HIDDEN_KEY = "devtools-everything-setup-guide-hidden-v1";
  const DEFAULT_BASE = "http://127.0.0.1";

  const baseInput = $("#ev-base");
  const userInput = $("#ev-user");
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

  const optCase = $("#ev-case");
  const optWhole = $("#ev-wholeword");
  const optPath = $("#ev-path");
  const optRegex = $("#ev-regex");
  const optDiacritics = $("#ev-diacritics");
  const optSort = $("#ev-sort");
  const optAsc = $("#ev-asc");
  const optCount = $("#ev-count");

  let connected = false;
  let apiBlocked = false;
  let lastQuery = "";
  let lastTotal = 0;
  let offset = 0;
  let searching = false;

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

  function normalizeBase(raw) {
    let s = String(raw || "").trim();
    if (!s) s = DEFAULT_BASE;
    if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
    return s.replace(/\/+$/, "");
  }

  function baseUrl() {
    return normalizeBase(baseInput?.value || localStorage.getItem(BASE_KEY) || DEFAULT_BASE);
  }

  function persistSettings() {
    try {
      localStorage.setItem(BASE_KEY, baseUrl());
      localStorage.setItem(USER_KEY, userInput?.value?.trim() || "");
    } catch (_) {}
  }

  function loadSettings() {
    try {
      const savedBase = localStorage.getItem(BASE_KEY);
      if (savedBase && baseInput) baseInput.value = savedBase;
      const savedUser = localStorage.getItem(USER_KEY);
      if (savedUser && userInput) userInput.value = savedUser;
    } catch (_) {}
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
    if (apiBlocked) {
      modeBanner.hidden = false;
      if (modeTitle) modeTitle.textContent = "无法从当前页面直连本机 Everything";
      if (modeText) {
        modeText.innerHTML =
          "HTTPS 页面访问 <span class=\"mono\">http://127.0.0.1</span> 可能被浏览器拦截。请用「Everything 网页」在新标签打开，或在本机用 localhost / file 打开本站后再试。";
      }
    } else if (connected) {
      modeBanner.hidden = false;
      if (modeTitle) modeTitle.textContent = "已连接 Everything HTTP";
      if (modeText) modeText.textContent = "JSON 搜索可用；也可随时用 Everything 自带网页界面。";
      modeBanner.style.background = "";
    } else {
      modeBanner.hidden = true;
    }
    panel.classList.toggle("is-connected", connected);
  }

  function isSetupGuideHidden() {
    try {
      return localStorage.getItem(SETUP_GUIDE_HIDDEN_KEY) === "1";
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
    params.delete("path_column");
    params.delete("size_column");
    params.delete("date_modified_column");
    return `${baseUrl()}/?${params.toString()}`;
  }

  function apiSearchUrl(query, opts) {
    return `${baseUrl()}/?${buildSearchParams(query, opts).toString()}`;
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

  function fileDownloadUrl(full) {
    const base = baseUrl();
    const p = String(full || "").replace(/\\/g, "/");
    if (!p) return base;
    if (/^[a-z]:\//i.test(p)) return `${base}/${encodeURI(p)}`;
    return `${base}/${encodeURI(p.replace(/^\/+/, ""))}`;
  }

  async function apiFetch(url) {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json, text/plain, */*",
        ...authHeaders(),
      },
    });
    if (res.status === 401) throw new Error("HTTP 401：用户名或密码错误");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch (_) {
      throw new Error("响应不是 JSON，请确认 Everything HTTP Server 已启用");
    }
  }

  async function testConnection() {
    persistSettings();
    showError("");
    setStatus("", "正在连接…", "探测 Everything HTTP 服务");
    connectBtn.disabled = true;
    try {
      const data = await apiFetch(apiSearchUrl("", { ...currentOpts(), offset: 0, count: 1 }));
      if (!data || typeof data !== "object") throw new Error("无效响应");
      connected = true;
      apiBlocked = false;
      setStatus("is-ok", "已连接 Everything", `HTTP 服务正常${Number.isFinite(data.totalResults) ? ` · 索引约 ${data.totalResults.toLocaleString()} 条` : ""}`);
      syncModeBanner();
      return true;
    } catch (err) {
      connected = false;
      const msg = err?.message || String(err);
      const blocked =
        /Failed to fetch|NetworkError|Load failed|CORS|Mixed Content|Network request failed/i.test(msg);
      apiBlocked = blocked;
      if (blocked) {
        setStatus("is-warn", "无法直连本机", "请用「Everything 网页」或在本机打开本站后重试");
      } else {
        setStatus("is-err", "连接失败", msg);
        showError(msg);
      }
      syncModeBanner();
      return false;
    } finally {
      connectBtn.disabled = false;
    }
  }

  function renderResults(data) {
    if (!resultsEl) return;
    resultsEl.innerHTML = "";
    const rows = Array.isArray(data?.results) ? data.results : [];
    if (!rows.length) {
      resultsEl.innerHTML = '<p class="ev-empty">没有匹配结果</p>';
      return;
    }
    for (const item of rows) {
      const row = document.createElement("div");
      row.className = "ev-row";
      row.setAttribute("role", "listitem");
      const fp = fullPath(item);
      const isFolder = item.type === "folder";
      const icon = isFolder ? "📁" : "📄";
      const size = item.size != null && !isFolder ? formatBytes(item.size) : isFolder ? "文件夹" : "";
      const modified = item.date_modified ? String(item.date_modified) : "";

      row.innerHTML = `
        <span class="ev-row-icon" aria-hidden="true">${icon}</span>
        <div class="ev-row-main">
          <div class="ev-row-name">${escapeHtml(item.name || fp)}</div>
          <div class="ev-row-path mono">${escapeHtml(fp)}</div>
        </div>
        <div class="ev-row-meta">
          ${size ? `<span>${escapeHtml(size)}</span>` : ""}
          ${modified ? `<span>${escapeHtml(modified)}</span>` : ""}
        </div>
        <div class="ev-row-actions">
          <button type="button" class="ghost-btn" data-ev-copy="${escapeAttr(fp)}">复制路径</button>
          <button type="button" class="ghost-btn" data-ev-web="${escapeAttr(fp)}">网页打开</button>
          ${!isFolder ? `<a class="ghost-btn" href="${escapeAttr(fileDownloadUrl(fp))}" target="_blank" rel="noopener noreferrer">下载</a>` : ""}
        </div>`;
      resultsEl.appendChild(row);
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

  function updatePager() {
    const count = Number(optCount?.value) || 100;
    if (prevBtn) prevBtn.disabled = offset <= 0 || searching;
    if (nextBtn) nextBtn.disabled = offset + count >= lastTotal || searching;
    if (metaEl) {
      if (!lastQuery && !searching) metaEl.textContent = "输入关键词后搜索";
      else if (searching) metaEl.textContent = "搜索中…";
      else {
        const from = lastTotal ? offset + 1 : 0;
        const to = Math.min(offset + count, lastTotal);
        metaEl.textContent = `「${lastQuery}」共 ${lastTotal.toLocaleString()} 条 · 显示 ${from}–${to}`;
      }
    }
  }

  async function runSearch(resetOffset = true) {
    const query = queryInput?.value?.trim() ?? "";
    if (!query) {
      showError("请输入搜索关键词");
      return;
    }
    persistSettings();
    showError("");
    if (resetOffset) offset = 0;
    lastQuery = query;
    searching = true;
    updatePager();
    searchBtn.disabled = true;
    try {
      if (!connected && !apiBlocked) {
        const ok = await testConnection();
        if (!ok && apiBlocked) {
          window.open(webSearchUrl(query), "_blank", "noopener,noreferrer");
          toast("已在 Everything 网页打开搜索");
          return;
        }
        if (!ok) return;
      }
      if (apiBlocked) {
        window.open(webSearchUrl(query), "_blank", "noopener,noreferrer");
        toast("无法直连，已在 Everything 网页打开");
        return;
      }
      const data = await apiFetch(apiSearchUrl(query, currentOpts()));
      lastTotal = Number(data?.totalResults) || 0;
      renderResults(data);
    } catch (err) {
      const msg = err?.message || String(err);
      if (/Failed to fetch|NetworkError|Load failed|CORS|Mixed Content/i.test(msg)) {
        apiBlocked = true;
        syncModeBanner();
        window.open(webSearchUrl(query), "_blank", "noopener,noreferrer");
        toast("连接失败，已在 Everything 网页打开");
      } else {
        showError(msg);
        if (resultsEl) resultsEl.innerHTML = "";
      }
    } finally {
      searching = false;
      searchBtn.disabled = false;
      updatePager();
    }
  }

  function openWebSearch() {
    persistSettings();
    const q = queryInput?.value?.trim() || "";
    window.open(webSearchUrl(q), "_blank", "noopener,noreferrer");
  }

  function copyText(text) {
    const s = String(text || "");
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(s).then(() => toast("已复制路径")).catch(() => fallbackCopy(s));
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
      toast("已复制路径");
    } catch (_) {
      toast("复制失败");
    }
    ta.remove();
  }

  loadSettings();
  syncSetupGuide();

  if (!isWindows()) {
    setStatus("is-warn", "Everything 仅支持 Windows", "本工具需 Windows + Everything HTTP Server；其他系统可浏览教程或跳转官网");
  }

  connectBtn?.addEventListener("click", () => testConnection());
  openWebTopBtn?.addEventListener("click", openWebSearch);
  openWebBtn?.addEventListener("click", openWebSearch);
  setupGuideDismiss?.addEventListener("click", dismissSetupGuide);
  searchBtn?.addEventListener("click", () => runSearch(true));
  queryInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") runSearch(true);
  });
  prevBtn?.addEventListener("click", () => {
    const count = Number(optCount?.value) || 100;
    offset = Math.max(0, offset - count);
    runSearch(false);
  });
  nextBtn?.addEventListener("click", () => {
    const count = Number(optCount?.value) || 100;
    offset += count;
    runSearch(false);
  });

  resultsEl?.addEventListener("click", (e) => {
    const copyBtn = e.target.closest("[data-ev-copy]");
    if (copyBtn) {
      copyText(copyBtn.getAttribute("data-ev-copy"));
      return;
    }
    const webBtn = e.target.closest("[data-ev-web]");
    if (webBtn) {
      const fp = webBtn.getAttribute("data-ev-web") || "";
      window.open(webSearchUrl(fp), "_blank", "noopener,noreferrer");
    }
  });

  [baseInput, userInput, passInput].forEach((el) => {
    el?.addEventListener("change", persistSettings);
  });

  updatePager();
})();
