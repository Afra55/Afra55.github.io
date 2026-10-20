(() => {
  "use strict";

  const panel = document.getElementById("apidebug");
  if (!panel) return;

  const P = window.DevToolsApiDebugPure;
  if (!P) {
    console.warn("[apidebug] DevToolsApiDebugPure missing");
    return;
  }

  const $ = (sel, root = panel) => root.querySelector(sel);
  const IDB_NAME = "devtools-apidebug";
  const IDB_STORE = "kv";
  const IDB_KEY = "collection-v1";
  const BRIDGE_PREF_KEY = "devtools-apidebug-use-bridge";

  const els = {
    error: $("#apid-error"),
    list: $("#apid-list"),
    count: $("#apid-count"),
    method: $("#apid-method"),
    url: $("#apid-url"),
    name: $("#apid-name"),
    query: $("#apid-query"),
    headers: $("#apid-headers"),
    cookies: $("#apid-cookies"),
    body: $("#apid-body"),
    respMeta: $("#apid-resp-meta"),
    respHeaders: $("#apid-resp-headers"),
    respBody: $("#apid-resp-body"),
    useBridge: $("#apid-use-bridge"),
    bridgeShell: $("#apid-bridge-shell"),
    bridgeNote: $("#apid-bridge-note"),
    curlDlg: $("#apid-curl-dlg"),
    curlInput: $("#apid-curl-input"),
    importFile: $("#apid-import-file"),
  };

  const state = {
    items: [],
    currentId: "",
    dirty: false,
    sending: false,
    bridgeBase: "http://127.0.0.1:17888",
    bridgeToken: "devtools-bridge",
    bridgeOk: false,
    ctxEl: null,
  };

  function setError(msg) {
    if (!els.error) return;
    if (!msg) {
      els.error.hidden = true;
      els.error.textContent = "";
      return;
    }
    els.error.hidden = false;
    els.error.textContent = msg;
  }

  function toast(msg) {
    try {
      window.DevToolsExtraKit?.toast?.(msg) || window.toast?.(msg);
    } catch (_) {}
    if (!window.DevToolsExtraKit?.toast && typeof window.toast !== "function") {
      /* fallback silent */
    }
  }

  function openIdb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IDB 打开失败"));
    });
  }

  async function idbGet(key) {
    const db = await openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readonly");
      const req = tx.objectStore(IDB_STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbSet(key, value) {
    const db = await openIdb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(IDB_STORE, "readwrite");
      tx.objectStore(IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function loadCollection() {
    try {
      const raw = await idbGet(IDB_KEY);
      const items = Array.isArray(raw?.items) ? raw.items.map((it) => P.emptyRequest(it)) : [];
      state.items = items;
    } catch {
      state.items = [];
    }
  }

  async function persistCollection() {
    await idbSet(IDB_KEY, { v: 1, items: state.items, savedAt: Date.now() });
  }

  function findItem(id) {
    return state.items.find((x) => x.id === id);
  }

  function readEditor() {
    const bodyType =
      panel.querySelector('input[name="apid-body-type"]:checked')?.value || "none";
    return P.emptyRequest({
      id: state.currentId || P.uid(12),
      name: String(els.name?.value || "").trim() || "未命名请求",
      method: String(els.method?.value || "GET").toUpperCase(),
      url: String(els.url?.value || "").trim(),
      query: readKv(els.query),
      headers: readKv(els.headers),
      cookies: readKv(els.cookies),
      bodyType,
      bodyText: String(els.body?.value || ""),
    });
  }

  function writeEditor(req) {
    const r = P.emptyRequest(req);
    state.currentId = r.id;
    if (els.method) els.method.value = r.method;
    if (els.url) els.url.value = r.url;
    if (els.name) els.name.value = r.name;
    if (els.body) els.body.value = r.bodyText || "";
    const radio = panel.querySelector(`input[name="apid-body-type"][value="${r.bodyType || "none"}"]`);
    if (radio) radio.checked = true;
    renderKv(els.query, r.query);
    renderKv(els.headers, r.headers);
    renderKv(els.cookies, r.cookies);
    state.dirty = false;
    paintList();
  }

  function readKv(host) {
    if (!host) return [];
    return [...host.querySelectorAll(".apid-kv-row")].map((row) => ({
      id: row.dataset.id || P.uid(4),
      enabled: Boolean(row.querySelector('[data-k="on"]')?.checked),
      key: String(row.querySelector('[data-k="key"]')?.value || ""),
      value: String(row.querySelector('[data-k="val"]')?.value || ""),
    }));
  }

  function renderKv(host, rows) {
    if (!host) return;
    const list = rows?.length ? rows : [P.emptyKv()];
    host.innerHTML = list
      .map(
        (r) =>
          `<div class="apid-kv-row" data-id="${escapeAttr(r.id)}">` +
          `<input type="checkbox" data-k="on" ${r.enabled !== false ? "checked" : ""} title="启用" />` +
          `<input type="text" data-k="key" placeholder="名称" value="${escapeAttr(r.key)}" spellcheck="false" />` +
          `<input type="text" data-k="val" placeholder="值" value="${escapeAttr(r.value)}" spellcheck="false" />` +
          `<button type="button" class="ghost-btn" data-k="del" title="删除">×</button>` +
          `</div>`
      )
      .join("");
  }

  function escapeAttr(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;");
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function paintList() {
    if (!els.list) return;
    if (els.count) els.count.textContent = String(state.items.length);
    if (!state.items.length) {
      els.list.innerHTML = `<li class="hint tight" style="padding:0.35rem">暂无收藏。编辑后点「保存」，或导入 JSON / cURL。</li>`;
      return;
    }
    els.list.innerHTML = state.items
      .slice()
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .map(
        (it) =>
          `<li><button type="button" class="apid-item${it.id === state.currentId ? " is-active" : ""}" data-id="${escapeAttr(
            it.id
          )}" title="${escapeAttr(it.url)}">` +
          `<span class="apid-item-method mono">${escapeHtml(it.method)}</span>` +
          `<span class="apid-item-name">${escapeHtml(it.name)}</span>` +
          `<span class="apid-item-url mono">${escapeHtml(it.url || "（无 URL）")}</span>` +
          `</button></li>`
      )
      .join("");
  }

  function markDirty() {
    state.dirty = true;
  }

  async function saveCurrent({ asNew = false } = {}) {
    const req = readEditor();
    req.updatedAt = Date.now();
    if (asNew || !findItem(req.id)) {
      if (asNew) {
        req.id = P.uid(12);
        req.createdAt = Date.now();
        req.name = req.name.endsWith("（副本）") ? req.name : `${req.name}（副本）`;
      }
      state.items.push(req);
      state.currentId = req.id;
    } else {
      const idx = state.items.findIndex((x) => x.id === req.id);
      req.createdAt = state.items[idx].createdAt || req.createdAt;
      state.items[idx] = req;
    }
    await persistCollection();
    writeEditor(findItem(state.currentId));
    setError("");
    toast("已保存");
  }

  async function deleteItem(id) {
    state.items = state.items.filter((x) => x.id !== id);
    if (state.currentId === id) {
      state.currentId = "";
      writeEditor(P.emptyRequest({ name: "未命名请求", method: "GET" }));
    }
    await persistCollection();
    paintList();
    toast("已删除");
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(String(text ?? ""));
      return true;
    } catch (_) {
      try {
        const ta = document.createElement("textarea");
        ta.value = String(text ?? "");
        ta.style.position = "fixed";
        ta.style.left = "-9999px";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  function downloadJson(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function sendRequest() {
    if (state.sending) return;
    const req = readEditor();
    if (!req.url) {
      setError("请填写 URL");
      return;
    }
    setError("");
    state.sending = true;
    if (els.respMeta) els.respMeta.textContent = "发送中…";
    const t0 = performance.now();
    try {
      let result;
      if (els.useBridge?.checked) {
        result = await sendViaBridge(req);
      } else {
        result = await sendViaBrowser(req);
      }
      const ms = Math.round(performance.now() - t0);
      paintResponse(result, ms);
    } catch (err) {
      const ms = Math.round(performance.now() - t0);
      if (els.respMeta) els.respMeta.textContent = `失败 · ${ms} ms`;
      if (els.respHeaders) els.respHeaders.textContent = "—";
      if (els.respBody) els.respBody.textContent = err?.message || String(err);
      setError(err?.message || "请求失败");
    } finally {
      state.sending = false;
    }
  }

  async function sendViaBrowser(req) {
    const { url, init } = P.buildFetchInit(req);
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 60000);
    try {
      const res = await fetch(url, { ...init, signal: ac.signal });
      const text = await res.text();
      const headers = {};
      res.headers.forEach((v, k) => {
        headers[k] = v;
      });
      return { status: res.status, statusText: res.statusText, headers, bodyText: text };
    } finally {
      clearTimeout(timer);
    }
  }

  async function sendViaBridge(req) {
    const { url, init } = P.buildFetchInit(req);
    const token = state.bridgeToken || "devtools-bridge";
    const base = String(state.bridgeBase || "http://127.0.0.1:17888").replace(/\/$/, "");
    const res = await fetch(`${base}/http/proxy`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Adb-Token": token,
        "X-Ffmpeg-Token": token,
      },
      body: JSON.stringify({
        url,
        method: init.method,
        headers: init.headers || {},
        body: init.body != null ? String(init.body) : null,
        timeoutMs: 60000,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data?.ok === false) {
      throw new Error(data?.error || `桥代发失败（HTTP ${res.status}）`);
    }
    return {
      status: data.status,
      statusText: data.statusText || "",
      headers: data.headers || {},
      bodyText: data.bodyText != null ? data.bodyText : "",
    };
  }

  function paintResponse(result, ms) {
    const size = new TextEncoder().encode(result.bodyText || "").length;
    if (els.respMeta) {
      els.respMeta.textContent = `${result.status} ${result.statusText || ""} · ${ms} ms · ${size} B`;
    }
    if (els.respHeaders) {
      const lines = Object.entries(result.headers || {}).map(([k, v]) => `${k}: ${v}`);
      els.respHeaders.textContent = lines.length ? lines.join("\n") : "（无）";
    }
    let body = result.bodyText || "";
    try {
      body = JSON.stringify(JSON.parse(body), null, 2);
    } catch (_) {
      /* keep */
    }
    if (els.respBody) els.respBody.textContent = body || "（空正文）";
  }

  function closeCtx() {
    if (state.ctxEl) {
      state.ctxEl.remove();
      state.ctxEl = null;
    }
  }

  function showCtx(x, y, item) {
    closeCtx();
    const el = document.createElement("div");
    el.className = "apid-ctx";
    el.innerHTML =
      `<button type="button" data-act="open">打开</button>` +
      `<button type="button" data-act="send">发送</button>` +
      `<button type="button" data-act="curl">复制为 cURL</button>` +
      `<button type="button" data-act="dup">复制一份</button>` +
      `<button type="button" data-act="export">导出此条</button>` +
      `<button type="button" data-act="del" class="is-danger">删除</button>`;
    document.body.appendChild(el);
    const rect = el.getBoundingClientRect();
    el.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 8))}px`;
    el.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 8))}px`;
    state.ctxEl = el;
    el.addEventListener("click", async (e) => {
      const act = e.target.closest?.("[data-act]")?.dataset?.act;
      if (!act) return;
      closeCtx();
      if (act === "open") writeEditor(item);
      else if (act === "send") {
        writeEditor(item);
        await sendRequest();
      } else if (act === "curl") {
        const ok = await copyText(P.requestToCurl(item));
        toast(ok ? "已复制 cURL" : "复制失败");
      } else if (act === "dup") {
        const copy = P.emptyRequest({
          ...item,
          id: P.uid(12),
          name: `${item.name}（副本）`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        state.items.push(copy);
        await persistCollection();
        writeEditor(copy);
        toast("已复制一份");
      } else if (act === "export") {
        downloadJson(P.packExport([item], { all: false }), `${slug(item.name)}.apidebug.json`);
      } else if (act === "del") {
        if (window.confirm(`删除「${item.name}」？`)) await deleteItem(item.id);
      }
    });
  }

  function slug(name) {
    return String(name || "request")
      .replace(/[\\/:*?"<>|]+/g, "_")
      .slice(0, 40);
  }

  function switchTab(name) {
    panel.querySelectorAll(".apid-tab").forEach((b) => {
      b.classList.toggle("is-on", b.dataset.apidTab === name);
    });
    panel.querySelectorAll(".apid-tab-panel").forEach((p) => {
      p.hidden = p.dataset.apidPanel !== name;
    });
  }

  function bindBridge() {
    if (!window.devtoolsBridgeShell?.mount || !els.bridgeShell) {
      if (els.bridgeNote) els.bridgeNote.textContent = "桥连接组件未加载；可仍用浏览器直连。";
      return;
    }
    try {
      const shell = window.devtoolsBridgeShell.mount({
        host: els.bridgeShell,
        prefix: "apid",
        kind: "unified",
        collapseAdvanced: true,
        refreshLabel: "刷新连接",
        hintDisconnected: "跨域或自定义 Cookie 时请下载完整 ZIP 并启动统一桥（17888）。",
        connHint:
          '与 ADB / FFmpeg <strong>共用一座桥</strong>：17888 · Token <span class="mono">devtools-bridge</span> · API <span class="mono">/http/proxy</span>。',
      });
      const baseInput = shell.els.base;
      const tokenInput = shell.els.token;
      const syncState = () => {
        state.bridgeBase = String(baseInput?.value || "http://127.0.0.1:17888").replace(/\/$/, "");
        state.bridgeToken = String(tokenInput?.value || "devtools-bridge").trim() || "devtools-bridge";
      };
      syncState();

      async function connectBridge() {
        syncState();
        try {
          shell.setStatus("is-warn", "正在连接…", state.bridgeBase);
          const h = await window.devtoolsBridgeToken?.probeHealth?.(
            state.bridgeBase,
            state.bridgeToken,
            false
          );
          if (!h?.ok) throw new Error("本机桥无响应");
          state.bridgeOk = true;
          shell.setStatus("is-ok", "已连接", `${state.bridgeBase} · /http/proxy`);
          if (els.bridgeNote) els.bridgeNote.textContent = `桥已连接 · ${state.bridgeBase}`;
        } catch (err) {
          state.bridgeOk = false;
          const msg = err?.message || String(err);
          shell.setStatus("is-err", "未连接", msg);
          if (els.bridgeNote) els.bridgeNote.textContent = msg;
        }
      }

      shell.bind({
        onStatus: (kind, _title, text) => {
          state.bridgeOk = kind === "is-ok" || kind === "ok";
          syncState();
          if (els.bridgeNote) {
            els.bridgeNote.textContent = state.bridgeOk
              ? `桥已连接 · ${state.bridgeBase}`
              : text || "未连接：跨域或自定义 Cookie 时请启动统一桥（17888）。";
          }
        },
        onConnected: async (found) => {
          if (found?.base) {
            state.bridgeBase = found.base;
            if (baseInput) baseInput.value = found.base;
          }
          syncState();
          state.bridgeOk = true;
          if (els.bridgeNote) els.bridgeNote.textContent = `桥已连接 · ${state.bridgeBase}`;
        },
        onConnect: () => {
          void connectBridge();
        },
        onRefresh: () => {
          void connectBridge();
        },
        toast,
      });
    } catch (err) {
      if (els.bridgeNote) els.bridgeNote.textContent = err?.message || "桥 UI 初始化失败";
    }
  }

  function bindUi() {
    try {
      els.useBridge.checked = localStorage.getItem(BRIDGE_PREF_KEY) === "1";
    } catch (_) {}
    els.useBridge?.addEventListener("change", () => {
      try {
        localStorage.setItem(BRIDGE_PREF_KEY, els.useBridge.checked ? "1" : "0");
      } catch (_) {}
    });

    $("#apid-new")?.addEventListener("click", () => {
      writeEditor(P.emptyRequest({ name: "未命名请求", method: "GET" }));
      setError("");
    });
    $("#apid-save")?.addEventListener("click", () => saveCurrent().catch((e) => setError(e.message)));
    $("#apid-save-as")?.addEventListener("click", () =>
      saveCurrent({ asNew: true }).catch((e) => setError(e.message))
    );
    $("#apid-send")?.addEventListener("click", () => sendRequest());
    $("#apid-clear")?.addEventListener("click", () => {
      writeEditor(P.emptyRequest({ name: "未命名请求", method: "GET" }));
      if (els.respMeta) els.respMeta.textContent = "尚未发送";
      if (els.respHeaders) els.respHeaders.textContent = "—";
      if (els.respBody) els.respBody.textContent = "—";
    });
    $("#apid-to-curl")?.addEventListener("click", async () => {
      const ok = await copyText(P.requestToCurl(readEditor()));
      toast(ok ? "已复制 cURL" : "复制失败");
    });
    $("#apid-from-curl")?.addEventListener("click", () => {
      if (els.curlInput) els.curlInput.value = "";
      els.curlDlg?.showModal?.();
    });
    $("#apid-curl-apply")?.addEventListener("click", () => {
      try {
        const parsed = P.curlToRequest(els.curlInput?.value || "", {
          name: String(els.name?.value || "").trim() || "从 cURL 导入",
        });
        writeEditor(parsed);
        els.curlDlg?.close?.();
        setError("");
        toast("已从 cURL 填入");
      } catch (err) {
        setError(err?.message || "解析失败");
      }
    });
    $("#apid-export-one")?.addEventListener("click", () => {
      const req = readEditor();
      downloadJson(P.packExport([req], { all: false }), `${slug(req.name)}.apidebug.json`);
    });
    $("#apid-export-all")?.addEventListener("click", () => {
      if (!state.items.length) {
        toast("没有可导出的收藏");
        return;
      }
      downloadJson(P.packExport(state.items, { all: true }), `apidebug-all.json`);
    });
    $("#apid-import")?.addEventListener("click", () => els.importFile?.click());
    els.importFile?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      try {
        const items = P.unpackImport(await file.text());
        let added = 0;
        let skipped = 0;
        for (const it of items) {
          if (findItem(it.id)) {
            skipped += 1;
            continue;
          }
          state.items.push(P.emptyRequest({ ...it, updatedAt: Date.now() }));
          added += 1;
        }
        await persistCollection();
        paintList();
        if (added && items.length === 1) writeEditor(state.items[state.items.length - 1]);
        toast(`导入完成：新增 ${added}${skipped ? `，跳过 ${skipped}` : ""}`);
      } catch (err) {
        setError(err?.message || "导入失败");
      }
    });

    panel.querySelectorAll(".apid-tab").forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.apidTab));
    });
    panel.querySelectorAll("[data-apid-add]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const kind = btn.dataset.apidAdd;
        const host = kind === "query" ? els.query : kind === "headers" ? els.headers : els.cookies;
        const rows = readKv(host);
        rows.push(P.emptyKv());
        renderKv(host, rows);
        markDirty();
      });
    });

    panel.addEventListener("input", (e) => {
      if (e.target?.closest?.(".apid-kv, #apid-url, #apid-name, #apid-body, #apid-method")) markDirty();
      if (e.target?.id === "apid-url") {
        // sync query table from URL when typing finishes is noisy; only on blur
      }
    });
    els.url?.addEventListener("change", () => {
      const q = P.parseQueryFromUrl(els.url.value);
      if (q.length) renderKv(els.query, q);
    });
    panel.addEventListener("click", (e) => {
      const del = e.target.closest?.("[data-k='del']");
      if (del) {
        const row = del.closest(".apid-kv-row");
        row?.remove();
        markDirty();
      }
    });

    els.list?.addEventListener("click", (e) => {
      const btn = e.target.closest?.("[data-id]");
      if (!btn) return;
      const item = findItem(btn.dataset.id);
      if (item) writeEditor(item);
    });
    els.list?.addEventListener("contextmenu", (e) => {
      const btn = e.target.closest?.("[data-id]");
      if (!btn) return;
      e.preventDefault();
      const item = findItem(btn.dataset.id);
      if (item) showCtx(e.clientX, e.clientY, item);
    });

    els.respBody?.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      closeCtx();
      const el = document.createElement("div");
      el.className = "apid-ctx";
      el.innerHTML =
        `<button type="button" data-act="copy-body">复制正文</button>` +
        `<button type="button" data-act="copy-headers">复制响应头</button>`;
      document.body.appendChild(el);
      el.style.left = `${e.clientX}px`;
      el.style.top = `${e.clientY}px`;
      state.ctxEl = el;
      el.addEventListener("click", async (ev) => {
        const act = ev.target.closest?.("[data-act]")?.dataset?.act;
        closeCtx();
        if (act === "copy-body") toast((await copyText(els.respBody.textContent)) ? "已复制正文" : "复制失败");
        if (act === "copy-headers")
          toast((await copyText(els.respHeaders.textContent)) ? "已复制响应头" : "复制失败");
      });
    });

    document.addEventListener("click", (e) => {
      if (!e.target.closest?.(".apid-ctx")) closeCtx();
    });
  }

  async function boot() {
    bindUi();
    bindBridge();
    await loadCollection();
    if (state.items.length) writeEditor(state.items.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]);
    else writeEditor(P.emptyRequest({ name: "未命名请求", method: "GET", url: "https://httpbin.org/get" }));
    paintList();
    window.DevToolsApiDebug = { version: 1 };
  }

  function panelLooksActive() {
    return (
      panel.classList.contains("is-workspace-active") ||
      panel.classList.contains("is-active") ||
      (!panel.hidden && panel.offsetParent !== null)
    );
  }

  const start = () => boot().catch((e) => setError(e?.message || "启动失败"));
  if (panelLooksActive() || location.hash.replace(/^#/, "").split("?")[0] === "apidebug") start();
  else {
    const obs = new MutationObserver(() => {
      if (panelLooksActive()) {
        obs.disconnect();
        start();
      }
    });
    obs.observe(panel, { attributes: true, attributeFilter: ["class", "hidden", "style"] });
  }
})();
