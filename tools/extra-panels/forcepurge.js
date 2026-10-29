(() => {
  "use strict";

  const K = window.DevToolsExtraKit;
  if (!K) return;
  const { $, bindPanel } = K;

  if (!window.devtoolsBridgeShell?.mount) return;

  const DEFAULT_BASE = "http://127.0.0.1:17888";
  const DEFAULT_TOKEN = "devtools-bridge";
  const BASE_KEY = "devtools-unlock-base";
  const TOKEN_KEY = "devtools-unlock-token";

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function formatBytes(n) {
    const x = Number(n) || 0;
    if (x < 1024) return `${x} B`;
    if (x < 1024 * 1024) return `${(x / 1024).toFixed(1)} KB`;
    if (x < 1024 * 1024 * 1024) return `${(x / 1024 / 1024).toFixed(1)} MB`;
    return `${(x / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  bindPanel("forcepurge", () => {
    const host = $("#fp-bridge-shell");
    if (!host) return;

    const shell = window.devtoolsBridgeShell.mount({
      host: "#fp-bridge-shell",
      prefix: "fp",
      kind: "unified",
      collapseAdvanced: true,
      refreshLabel: "刷新",
      hintDisconnected: "请先下载完整 ZIP 并运行启动脚本；本功能仅 Windows 有效。",
      connHint:
        '与占用解锁共用统一桥：17888 · Token <span class="mono">devtools-bridge</span> · API <span class="mono">/unlock/purge</span>。',
    });

    const baseInput = shell.els.base;
    const tokenInput = shell.els.token;
    const errorEl = $("#fp-error");
    const workspace = $("#fp-workspace");
    const listEl = $("#fp-list");
    const emptyEl = $("#fp-empty");
    const metaEl = $("#fp-meta");
    const resultEl = $("#fp-result");
    const ackEl = $("#fp-ack");
    const confirmEl = $("#fp-confirm-text");
    const runBtn = $("#fp-run");
    const pasteEl = $("#fp-paste");

    /** @type {{ path: string, kind: string, size: number, safe: boolean, reason: string }[]} */
    let queue = [];

    try {
      const b = localStorage.getItem(BASE_KEY);
      const t = localStorage.getItem(TOKEN_KEY);
      if (b && baseInput) baseInput.value = b;
      if (t && tokenInput) tokenInput.value = t;
    } catch (_) {}

    const baseUrl = () => String(baseInput?.value || DEFAULT_BASE).replace(/\/$/, "");
    const token = () => String(tokenInput?.value || DEFAULT_TOKEN).trim();
    const setError = (m) => {
      if (!errorEl) return;
      errorEl.hidden = !m;
      errorEl.textContent = m || "";
    };

    async function api(pathname, opts = {}) {
      const headers = { ...(opts.headers || {}) };
      if (opts.auth !== false) {
        headers["X-Ffmpeg-Token"] = token();
        headers["X-Adb-Token"] = token();
      }
      if (opts.body) headers["Content-Type"] = "application/json";
      const res = await fetch(`${baseUrl()}/unlock${pathname}`, {
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

    function syncRunEnabled() {
      const has = queue.some((q) => q.safe !== false);
      const ack = Boolean(ackEl?.checked);
      const typed = String(confirmEl?.value || "").trim() === "删除";
      if (runBtn) runBtn.disabled = !(has && ack && typed);
    }

    function renderList() {
      if (!listEl) return;
      const n = queue.length;
      if (metaEl) metaEl.textContent = `${n} 项`;
      if (emptyEl) emptyEl.hidden = n > 0;
      listEl.innerHTML = queue
        .map((item, i) => {
          const kindLabel =
            item.kind === "dir" ? "文件夹" : item.kind === "file" ? "文件" : item.kind === "missing" ? "不存在" : item.kind || "?";
          const size =
            item.kind === "file" && item.size != null ? ` · ${formatBytes(item.size)}` : item.kind === "dir" ? " · 将递归擦除内部全部文件" : "";
          const bad = item.safe === false;
          return `<div class="fp-item ${bad ? "is-blocked" : ""}" role="listitem" data-idx="${i}">
            <div class="fp-item-main">
              <span class="fp-kind">${escapeHtml(kindLabel)}</span>
              <code class="fp-path mono">${escapeHtml(item.path)}</code>
              <span class="fp-item-meta">${escapeHtml(size)}${bad ? ` · ${escapeHtml(item.reason || "不可删")}` : ""}</span>
            </div>
            <button type="button" class="ghost-btn" data-fp-remove="${i}">移除</button>
          </div>`;
        })
        .join("");
      syncRunEnabled();
    }

    async function addPaths(rawList) {
      const incoming = [...new Set((rawList || []).map((p) => String(p || "").trim()).filter(Boolean))];
      if (!incoming.length) return;
      setError("");
      try {
        const data = await api("/inspect", { method: "POST", body: { paths: incoming } });
        for (const item of data.items || []) {
          if (!item?.path) continue;
          if (queue.some((q) => q.path.toLowerCase() === String(item.path).toLowerCase())) continue;
          queue.push({
            path: item.path,
            kind: item.kind || "unknown",
            size: item.size || 0,
            safe: item.safe !== false,
            reason: item.reason || "",
          });
        }
        renderList();
      } catch (err) {
        // 桥未通时仍先入队，删时再报错
        for (const p of incoming) {
          if (queue.some((q) => q.path.toLowerCase() === p.toLowerCase())) continue;
          queue.push({ path: p, kind: "unknown", size: 0, safe: true, reason: "" });
        }
        renderList();
        setError(err.message || String(err));
      }
    }

    async function doPick(kind) {
      setError("");
      try {
        const data = await api("/pick", { method: "POST", body: { kind } });
        const paths = Array.isArray(data.paths) && data.paths.length ? data.paths : data.path ? [data.path] : [];
        await addPaths(paths);
      } catch (err) {
        setError(err.message || String(err));
      }
    }

    async function handleDrop(e) {
      if (!e.dataTransfer) return;
      e.preventDefault();
      $("#fp-drop")?.classList.remove("is-over");
      let paths = [];
      try {
        paths = window.devtoolsBridgeToken?.pathsFromDataTransfer?.(e.dataTransfer) || [];
      } catch (_) {}
      if (!paths.length) {
        const names = [...(e.dataTransfer.files || [])].map((f) => f.name).filter(Boolean);
        for (const name of names) {
          try {
            const r = await api("/resolve", { method: "POST", body: { name } });
            if (r?.path) paths.push(r.path);
          } catch (err) {
            setError(err.message || String(err));
          }
        }
      }
      if (!paths.length) {
        setError("浏览器通常不提供完整本地路径。请用「添加文件 / 文件夹」或粘贴绝对路径。");
        return;
      }
      await addPaths(paths);
    }

    async function runPurge() {
      setError("");
      if (resultEl) {
        resultEl.hidden = true;
        resultEl.innerHTML = "";
      }
      const targets = queue.filter((q) => q.safe !== false).map((q) => q.path);
      if (!targets.length) {
        setError("没有可删除的项");
        return;
      }
      if (!ackEl?.checked || String(confirmEl?.value || "").trim() !== "删除") {
        setError("请勾选确认并输入「删除」");
        return;
      }
      if (runBtn) runBtn.disabled = true;
      if (metaEl) metaEl.textContent = `正在安全删除 ${targets.length} 项…（大文件夹可能较久）`;
      try {
        const data = await api("/purge", {
          method: "POST",
          body: { paths: targets, confirm: true, passes: 2 },
        });
        const lines = (data.results || [])
          .map((r) => {
            if (r.ok) {
              const killed = (r.killed || []).map((k) => k.name || k.pid).join(", ");
              return `<div class="fp-res ok">✓ ${escapeHtml(r.path)} · 擦除 ${r.wipedFiles || 0} 个文件 · ${formatBytes(
                r.wipedBytes || 0
              )}${killed ? ` · 已结束占用：${escapeHtml(killed)}` : ""}${r.missing ? " · 原本不存在" : ""}</div>`;
            }
            return `<div class="fp-res err">✗ ${escapeHtml(r.path)} · ${escapeHtml(r.error || "失败")}</div>`;
          })
          .join("");
        if (resultEl) {
          resultEl.hidden = false;
          resultEl.innerHTML = `<p class="hint tight">${escapeHtml(data.note || "")} · 成功 ${data.succeeded || 0} / 失败 ${
            data.failed || 0
          }</p>${lines}`;
        }
        // 成功的从清单移除
        const okSet = new Set((data.results || []).filter((r) => r.ok).map((r) => String(r.path).toLowerCase()));
        queue = queue.filter((q) => !okSet.has(q.path.toLowerCase()));
        if (ackEl) ackEl.checked = false;
        if (confirmEl) confirmEl.value = "";
        renderList();
        if (metaEl) metaEl.textContent = `完成 · 成功 ${data.succeeded || 0} · 失败 ${data.failed || 0}`;
      } catch (err) {
        setError(err.message || String(err));
        if (metaEl) metaEl.textContent = `${queue.length} 项`;
      } finally {
        syncRunEnabled();
      }
    }

    $("#fp-pick-files")?.addEventListener("click", () => void doPick("files"));
    $("#fp-pick-dir")?.addEventListener("click", () => void doPick("dir"));
    $("#fp-clear")?.addEventListener("click", () => {
      queue = [];
      renderList();
      setError("");
    });
    $("#fp-add-paste")?.addEventListener("click", () => {
      const lines = String(pasteEl?.value || "")
        .split(/\r?\n/)
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      void addPaths(lines).then(() => {
        if (pasteEl) pasteEl.value = "";
      });
    });
    $("#fp-run")?.addEventListener("click", () => void runPurge());
    ackEl?.addEventListener("change", syncRunEnabled);
    confirmEl?.addEventListener("input", syncRunEnabled);

    listEl?.addEventListener("click", (e) => {
      const btn = e.target.closest?.("[data-fp-remove]");
      if (!btn) return;
      const i = Number(btn.dataset.fpRemove);
      if (!Number.isFinite(i)) return;
      queue.splice(i, 1);
      renderList();
    });

    const dropEl = $("#fp-drop");
    const panelEl = $("#forcepurge");
    ["dragenter", "dragover"].forEach((ev) =>
      panelEl?.addEventListener(ev, (e) => {
        if (!e.dataTransfer) return;
        e.preventDefault();
        dropEl?.classList.add("is-over");
      })
    );
    panelEl?.addEventListener("dragleave", (e) => {
      if (e.target === panelEl || e.target === dropEl) dropEl?.classList.remove("is-over");
    });
    panelEl?.addEventListener("drop", (e) => void handleDrop(e));

    async function connectBridge() {
      try {
        localStorage.setItem(BASE_KEY, baseUrl());
        localStorage.setItem(TOKEN_KEY, token());
      } catch (_) {}
      setError("");
      try {
        shellApi?.setStatus?.("is-warn", "正在连接本机桥…", baseUrl());
      } catch (_) {}
      try {
        const h = await api("/health", { auth: false });
        if (!h?.ok) throw new Error("本机桥无响应");
        if (!h.isWin) {
          if (workspace) workspace.hidden = true;
          try {
            shellApi?.setStatus?.("is-err", "非 Windows 系统", "此工具仅 Windows 可用");
          } catch (_) {}
          return;
        }
        if (workspace) workspace.hidden = false;
        try {
          shellApi?.setStatus?.("is-ok", "已连接本机桥", `统一桥 ${baseUrl()} · /unlock/purge`);
        } catch (_) {}
      } catch (err) {
        const msg = err?.message || String(err);
        setError(msg);
        try {
          shellApi?.setStatus?.("is-err", "未连接本机桥", msg);
        } catch (_) {}
      }
    }

    let shellApi = null;
    shellApi = shell.bind({
      onStatus: () => {},
      onConnected: async () => {
        setError("");
        try {
          const h = await api("/health", { auth: false });
          if (!h.isWin) {
            if (workspace) workspace.hidden = true;
            setError("当前桥运行在非 Windows 系统，此工具仅 Windows 可用。");
            return;
          }
          if (workspace) workspace.hidden = false;
        } catch (err) {
          setError(err.message || String(err));
        }
      },
      onConnect: () => {
        void connectBridge();
      },
      onRefresh: () => {
        void connectBridge();
      },
      onPersist: () => {
        try {
          localStorage.setItem(BASE_KEY, baseUrl());
          localStorage.setItem(TOKEN_KEY, token());
        } catch (_) {}
      },
      toast: (msg) => {
        if (metaEl) metaEl.textContent = msg;
      },
    });

    renderList();
    void connectBridge();
  });
})();
