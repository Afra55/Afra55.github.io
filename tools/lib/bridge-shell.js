(() => {
  "use strict";

  /**
   * 统一本机桥连接壳：状态条 · 一键启动 · 完整包下载 · 解压目录 · Token。
   * 各桥面板（ADB / FFmpeg / yt-dlp / Git）共用；业务区仍由各工具自己渲染。
   *
   * 用法：
   *   const shell = window.devtoolsBridgeShell.mount({
   *     host: "#git-bridge-shell",
   *     prefix: "git",
   *     collapseAdvanced: true,
   *     showReadyCard: true,
   *     refreshLabel: "刷新仓库",
   *     primaryAction: "ready", // "ready" | "connect"
   *   });
   *   shell.bind({ onStatus, onConnected, onDownloadStart, toast, getPreferredBase, getToken });
   */

  const DEFAULT_BASE = "http://127.0.0.1:17888";
  const DEFAULT_TOKEN = "devtools-bridge";

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function resolveHost(host) {
    if (!host) return null;
    if (typeof host === "string") return document.querySelector(host);
    return host;
  }

  function buildHtml(opts) {
    const p = opts.prefix;
    const hint = escapeHtml(opts.hintDisconnected || "与其它工具共用一座桥（17888）。点连接或一键启动；高级项在折叠里。");
    const title = escapeHtml(opts.titleDisconnected || "未连接本机桥");
    const refreshLabel = escapeHtml(opts.refreshLabel || "刷新");
    const primaryIsReady = opts.primaryAction === "ready";
    const connectCls = primaryIsReady ? "secondary-btn" : "primary-btn";
    const readyCls = primaryIsReady ? "primary-btn" : "secondary-btn";
    const extraBtns = (opts.extraActions || [])
      .map((a) => {
        const id = a.id.startsWith(p + "-") ? a.id : `${p}-${a.id}`;
        const disabled = a.disabled ? " disabled" : "";
        const cls = a.className || "ghost-btn";
        return `<button type="button" class="${escapeHtml(cls)}" id="${escapeHtml(id)}"${disabled}>${escapeHtml(a.label || id)}</button>`;
      })
      .join("\n            ");

    const readyCard = opts.showReadyCard
      ? `<div class="bridge-ready panel-card" id="${p}-ready" style="margin-top:0.65rem">
          <h2 class="subhead">${escapeHtml(opts.readyTitle || "零难度就绪（约 2 分钟）")}</h2>
          <ol class="bridge-ready-steps hint">
            ${(opts.readySteps || [
              '去 <a href="#envkit">环境管家</a> 一键安装依赖并同步桥文件。',
              "或展开下方「连接与下载」，下载统一完整包，解压后运行启动脚本一次。",
              "回到本页点「一键启动并连接」。",
            ])
              .map((s) => `<li>${s}</li>`)
              .join("")}
          </ol>
          <div class="btn-row tool-actions" style="flex-wrap:wrap;margin-top:0.35rem">
            <a class="secondary-btn" href="#envkit">打开环境管家</a>
            <a class="ghost-btn" href="#adb">去 ADB 页下完整包</a>
          </div>
          <p class="hint tight" id="${p}-ready-hint">${escapeHtml(opts.readyHint || "本页只管连桥与操作；系统凭据请在本机自行完成。")}</p>
        </div>`
      : "";

    const advancedInner = `
          <div class="gif-progress bridge-dl-progress" id="${p}-dl-progress" hidden style="margin-top:0.55rem">
            <div class="gif-progress-head">
              <p class="hint gif-progress-title" id="${p}-dl-progress-text">准备下载包…</p>
              <span class="mono gif-progress-pct" id="${p}-dl-progress-pct">0%</span>
            </div>
            <div class="gif-progress-track" aria-hidden="true"><span class="gif-progress-fill is-busy" id="${p}-dl-progress-fill" style="width:0%"></span></div>
          </div>
          <div class="btn-row tool-actions" style="flex-wrap:wrap;margin-top:0.45rem" id="${p}-dl-bundle">
            <button type="button" class="secondary-btn" id="${p}-dl-mac" data-bridge-bundle="mac">下载 macOS 完整包</button>
            <button type="button" class="secondary-btn" id="${p}-dl-win" data-bridge-bundle="win">下载 Windows 完整包</button>
            <button type="button" class="secondary-btn" id="${p}-dl-linux" data-bridge-bundle="linux">下载 Linux 完整包</button>
          </div>
          <div class="field-block adb-install-dir" style="margin-top:0.65rem">
            <div class="field-row" style="flex-wrap:wrap;align-items:center;gap:0.4rem">
              <label for="${p}-install-dir">桥解压目录</label>
              <input id="${p}-install-dir" class="mono" type="text" placeholder="例如 C:\\Tools\\devtools-bridge" autocomplete="off" spellcheck="false" style="min-width:min(100%,22rem);flex:1" />
              <button type="button" class="secondary-btn" id="${p}-install-dir-save" title="在本机资源管理器中打开该目录（填写时已自动记住）">打开目录</button>
            </div>
            <label class="flag" style="margin-top:0.35rem;display:inline-flex;align-items:center;gap:0.35rem">
              <input type="checkbox" id="${p}-bridge-autostart" checked />
              进入本页时若未连接则尝试自动启动
            </label>
            <p class="hint tight" id="${p}-install-dir-hint">${opts.advancedHint || "协议 <span class=\"mono\">devtools-bridge://</span>。下载的是<strong>统一完整包</strong>（ADB / FFmpeg / yt-dlp / Git）。"}</p>
          </div>
          <div class="field-row" style="flex-wrap:wrap;margin-top:0.55rem">
            <label for="${p}-base">桥地址</label>
            <input id="${p}-base" class="mono" type="text" value="${escapeHtml(opts.defaultBase || DEFAULT_BASE)}" autocomplete="off" spellcheck="false" />
            <label for="${p}-token">Token</label>
            <input id="${p}-token" class="mono" type="text" value="${escapeHtml(opts.defaultToken || DEFAULT_TOKEN)}" autocomplete="off" spellcheck="false" />
          </div>
          <p class="hint tight">${opts.connHint || "默认统一桥 <span class=\"mono\">17888</span> · Token <span class=\"mono\">devtools-bridge</span>。"}</p>`;

    const advancedBlock = opts.collapseAdvanced
      ? `<details class="git-ops-details bridge-eng-fold" id="${p}-eng-fold">
          <summary class="hint">连接与下载（解压目录 · Token · 完整包）· 一般不用改</summary>
          ${advancedInner}
        </details>`
      : `<div class="bridge-eng-open" id="${p}-eng-fold">${advancedInner}</div>`;

    return `
        <div class="adb-status" id="${p}-status">
          <div class="adb-status-main">
            <span class="adb-dot" id="${p}-dot" aria-hidden="true"></span>
            <div>
              <strong id="${p}-status-title">${title}</strong>
              <p class="hint tight" id="${p}-status-text">${hint}</p>
            </div>
          </div>
          <div class="btn-row tool-actions adb-status-actions">
            ${
              primaryIsReady
                ? `<button type="button" class="${readyCls}" id="${p}-ready-go">一键启动并连接</button>`
                : ""
            }
            <button type="button" class="${connectCls}" id="${p}-connect">连接本机桥</button>
            <button type="button" class="secondary-btn" id="${p}-bridge-launch">启动本机桥</button>
            <button type="button" class="secondary-btn" id="${p}-refresh" disabled>${refreshLabel}</button>
            ${extraBtns}
          </div>
        </div>
        ${readyCard}
        ${advancedBlock}
    `;
  }

  function collectEls(host, prefix) {
    const id = (suffix) => $(`#${prefix}-${suffix}`, host) || document.getElementById(`${prefix}-${suffix}`);
    return {
      status: id("status"),
      dot: id("dot"),
      title: id("status-title"),
      text: id("status-text"),
      connect: id("connect"),
      launch: id("bridge-launch"),
      refresh: id("refresh"),
      readyGo: id("ready-go"),
      ready: id("ready"),
      engFold: id("eng-fold"),
      progress: id("dl-progress"),
      progressFill: id("dl-progress-fill"),
      progressText: id("dl-progress-text"),
      progressPct: id("dl-progress-pct"),
      dlBundle: id("dl-bundle"),
      dlMac: id("dl-mac"),
      dlWin: id("dl-win"),
      dlLinux: id("dl-linux"),
      installDir: id("install-dir"),
      installDirSave: id("install-dir-save"),
      autostart: id("bridge-autostart"),
      base: id("base"),
      token: id("token"),
    };
  }

  function mount(options = {}) {
    const host = resolveHost(options.host);
    if (!host) throw new Error("devtoolsBridgeShell.mount: 缺少 host");
    const prefix = String(options.prefix || "").trim();
    if (!prefix) throw new Error("devtoolsBridgeShell.mount: 缺少 prefix");

    const opts = {
      collapseAdvanced: true,
      showReadyCard: false,
      primaryAction: "connect",
      kind: "unified",
      ...options,
      prefix,
    };

    host.classList.add("bridge-shell-host");
    host.dataset.bridgePrefix = prefix;
    host.innerHTML = buildHtml(opts);

    const els = collectEls(host.closest(".panel") || document, prefix);
    let downloadBusy = false;

    function setStatus(kind, title, text) {
      const panel = host.closest(".panel") || host;
      panel.classList.toggle("is-connected", kind === "is-ok");
      panel.classList.toggle("has-bridge", kind === "is-ok");
      panel.classList.toggle("is-setup", kind !== "is-ok");
      if (els.dot) {
        const k = String(kind || "");
        els.dot.className =
          "adb-dot" +
          (k === "is-ok" || k === "ok"
            ? " is-ok"
            : k === "is-err" || k === "err"
              ? " is-err"
              : k === "is-warn" || k === "warn"
                ? " is-warn"
                : "");
      }
      if (els.title) els.title.textContent = title || "";
      if (els.text) els.text.textContent = text || "";
    }

    function setReadyVisible(show) {
      if (els.ready) els.ready.hidden = !show;
    }

    function setProgress(on, p = {}) {
      if (!els.progress) return;
      els.progress.hidden = !on;
      if (els.progressFill) {
        els.progressFill.style.width = `${Math.max(0, Math.min(100, Number(p.pct) || 0))}%`;
      }
      if (els.progressText && p.text) els.progressText.textContent = p.text;
      if (els.progressPct) els.progressPct.textContent = `${Math.round(Number(p.pct) || 0)}%`;
    }

    function getBase() {
      return String(els.base?.value || opts.defaultBase || DEFAULT_BASE).replace(/\/+$/, "");
    }

    function getToken() {
      return String(els.token?.value || opts.defaultToken || DEFAULT_TOKEN).trim() || DEFAULT_TOKEN;
    }

    function highlightOsDownload() {
      try {
        const os = window.devtoolsUnifiedBridgeBundle?.detectOs?.() || "";
        const prefer =
          os === "win" ? els.dlWin : os === "mac" ? els.dlMac : els.dlLinux;
        prefer?.classList.add("primary-btn");
        prefer?.classList.remove("secondary-btn");
      } catch (_) {
        /* ignore */
      }
    }

    async function downloadBundle(platform, hooks = {}) {
      const api = window.devtoolsUnifiedBridgeBundle;
      if (!api?.download) throw new Error("统一完整包模块未加载，请硬刷新页面");
      if (downloadBusy) throw new Error("正在准备完整包，请稍候…");
      downloadBusy = true;
      setStatus("is-warn", "正在打包…", "下载统一完整包，请稍候");
      setProgress(true, { pct: 4, text: "准备打包…" });
      try {
        if (typeof hooks.onStart === "function") await hooks.onStart(platform);
        await api.download(platform, {
          onProgress: (p) => setProgress(true, p),
        });
        setStatus(
          "is-warn",
          "等待本机桥启动…",
          "完整包已下载。解压后运行 start-adb-bridge.*，保持窗口打开，再点连接。"
        );
        if (typeof hooks.onDone === "function") await hooks.onDone(platform);
      } finally {
        downloadBusy = false;
        setProgress(false);
      }
    }

    function bind(handlers = {}) {
      const kind = opts.kind || "unified";
      const onStatus = handlers.onStatus || setStatus;
      const getPreferredBase = handlers.getPreferredBase || getBase;
      const getTok = handlers.getToken || getToken;

      window.devtoolsBridgeToken?.bindBridgeLaunchUI?.({
        kind,
        dirInput: els.installDir,
        saveBtn: els.installDirSave,
        launchBtn: els.launch,
        autoEl: els.autostart,
        getPreferredBase,
        getToken: getTok,
        onStatus,
        onConnected: handlers.onConnected,
        toast: handlers.toast,
      });

      const runDownload = (platform) => {
        downloadBundle(platform, {
          onStart: handlers.onDownloadStart,
          onDone: handlers.onDownloadDone,
        }).catch((err) => {
          if (typeof handlers.onDownloadError === "function") handlers.onDownloadError(err);
          else onStatus("is-err", "下载失败", err.message || String(err));
        });
      };

      [els.dlMac, els.dlWin, els.dlLinux].forEach((btn) => {
        btn?.addEventListener("click", (e) => {
          e.preventDefault();
          const platform = btn.getAttribute("data-bridge-bundle");
          if (platform) runDownload(platform);
        });
      });

      highlightOsDownload();

      if (els.connect && handlers.onConnect) {
        els.connect.addEventListener("click", () => handlers.onConnect());
      }
      if (els.refresh && handlers.onRefresh) {
        els.refresh.addEventListener("click", () => handlers.onRefresh());
      }
      if (els.readyGo && handlers.onReadyGo) {
        els.readyGo.addEventListener("click", () => handlers.onReadyGo());
      } else if (els.readyGo && handlers.onConnect) {
        els.readyGo.addEventListener("click", () => handlers.onConnect());
      }

      els.base?.addEventListener("change", () => handlers.onPersist?.());
      els.token?.addEventListener("change", () => handlers.onPersist?.());

      return api;
    }

    const api = {
      prefix,
      host,
      els,
      setStatus,
      setReadyVisible,
      setProgress,
      getBase,
      getToken,
      downloadBundle,
      bind,
      highlightOsDownload,
      options: opts,
    };
    host._bridgeShell = api;
    return api;
  }

  window.devtoolsBridgeShell = {
    mount,
    DEFAULT_BASE,
    DEFAULT_TOKEN,
  };
})();
