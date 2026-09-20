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

  bindPanel("fileunlock", () => {
    const host = $("#fu-bridge-shell");
    if (!host) return;

    const shell = window.devtoolsBridgeShell.mount({
      host: "#fu-bridge-shell",
      prefix: "fu",
      kind: "unified",
      collapseAdvanced: true,
      refreshLabel: "刷新",
      hintDisconnected: "请先下载完整 ZIP 并运行启动脚本；本功能仅 Windows 有效。",
      connHint:
        '与 ADB / FFmpeg <strong>共用一座桥</strong>：17888 · Token <span class="mono">devtools-bridge</span> · API <span class="mono">/unlock/*</span>。',
    });

    const baseInput = shell.els.base;
    const tokenInput = shell.els.token;
    const errorEl = $("#fu-error");
    const workspace = $("#fu-workspace");
    const pathInput = $("#fu-path");
    const metaEl = $("#fu-meta");
    const resultEl = $("#fu-result");

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
    const setMeta = (m) => {
      if (metaEl) metaEl.textContent = m || "";
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

    function renderResult(data) {
      if (!resultEl) return;
      const procs = data.processes || [];
      resultEl.hidden = false;
      if (!procs.length) {
        resultEl.innerHTML = `<p class="hint tight">未发现占用进程：可能已释放，或该文件没有被其它程序打开。</p>`;
        return;
      }
      resultEl.innerHTML = procs
        .map(
          (p) => `<div class="fu-proc">
            <div class="fu-proc-name">
              <strong>${escapeHtml(p.name)}</strong>
              <div class="fu-proc-meta mono">PID ${p.pid} · ${escapeHtml(p.typeLabel || "应用")}</div>
            </div>
            <button type="button" class="secondary-btn" data-fu-kill="${p.pid}" data-force="0">关闭</button>
            <button type="button" class="ghost-btn" data-fu-kill="${p.pid}" data-force="1">强制关闭</button>
          </div>`
        )
        .join("");
    }

    async function doCheck() {
      setError("");
      const p = String(pathInput?.value || "").trim();
      if (!p) {
        setError("请先输入或选择路径");
        return;
      }
      setMeta("检测中…");
      if (resultEl) {
        resultEl.hidden = true;
        resultEl.innerHTML = "";
      }
      try {
        const data = await api("/check", { method: "POST", body: { path: p } });
        const n = (data.processes || []).length;
        setMeta(
          `扫描 ${data.scanned || 0} 个文件 · 发现 ${n} 个占用进程${data.truncated ? "（文件夹过大，仅扫描前 600 个文件）" : ""}`
        );
        renderResult(data);
      } catch (err) {
        setMeta("");
        setError(err.message || String(err));
      }
    }

    async function doPick(kind) {
      setError("");
      try {
        const data = await api("/pick", { method: "POST", body: { kind } });
        if (data.path && pathInput) {
          pathInput.value = data.path;
          await doCheck();
        }
      } catch (err) {
        setError(err.message || String(err));
      }
    }

    $("#fu-check")?.addEventListener("click", () => void doCheck());
    $("#fu-pick-file")?.addEventListener("click", () => void doPick("file"));
    $("#fu-pick-dir")?.addEventListener("click", () => void doPick("dir"));
    pathInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") void doCheck();
    });

    resultEl?.addEventListener("click", async (e) => {
      const btn = e.target.closest?.("[data-fu-kill]");
      if (!btn) return;
      const pid = Number(btn.dataset.fuKill);
      const force = btn.dataset.force === "1";
      const name = btn.closest(".fu-proc")?.querySelector("strong")?.textContent || `PID ${pid}`;
      const tip = force
        ? `强制关闭「${name}」？未保存的数据会丢失。`
        : `关闭「${name}」？请先保存它的内容。`;
      if (!window.confirm(tip)) return;
      btn.disabled = true;
      try {
        await api("/kill", { method: "POST", body: { pid, force } });
        await doCheck();
      } catch (err) {
        setError(err.message || String(err));
      } finally {
        btn.disabled = false;
      }
    });

    let shellApi = null;
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
          shellApi?.setStatus?.("is-ok", "已连接本机桥", `统一桥 ${baseUrl()} · API /unlock`);
        } catch (_) {}
      } catch (err) {
        const msg = err?.message || String(err);
        setError(msg);
        try {
          shellApi?.setStatus?.("is-err", "未连接本机桥", msg);
        } catch (_) {}
      }
    }

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
      toast: (msg) => setMeta(msg),
    });

    // 打开面板先自动尝试连接一次
    void connectBridge();
  });
})();
