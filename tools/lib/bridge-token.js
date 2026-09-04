(() => {
  "use strict";

  const DEFAULT = "devtools-bridge";
  const KEYS = ["devtools-bridge-token", "devtools-ffmpeg-token", "devtools-adb-token"];

  function read() {
    for (const key of KEYS) {
      try {
        const value = localStorage.getItem(key);
        if (value && String(value).trim()) return String(value).trim();
      } catch (_) {
        /* ignore */
      }
    }
    return DEFAULT;
  }

  function write(token) {
    const normalized = String(token || DEFAULT).trim() || DEFAULT;
    for (const key of KEYS) {
      try {
        localStorage.setItem(key, normalized);
      } catch (_) {
        /* ignore */
      }
    }
    return normalized;
  }

  function normalizeBridgeBase(raw) {
    let base = String(raw || "http://127.0.0.1:17888").trim().replace(/\/+$/, "");
    if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
    if (/^https:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(base)) {
      base = base.replace(/^https:/i, "http:");
    }
    return base;
  }

  async function probeHealth(base, token, auth = false) {
    const headers = {};
    if (auth !== false) {
      const t = String(token || read()).trim() || DEFAULT;
      headers["X-Adb-Token"] = t;
      headers["X-Ffmpeg-Token"] = t;
      headers["X-Git-Token"] = t;
    }
    const res = await fetch(`${normalizeBridgeBase(base)}/health`, {
      method: "GET",
      headers,
      cache: "no-store",
      mode: "cors",
    });
    const type = res.headers.get("content-type") || "";
    const data = type.includes("application/json") ? await res.json() : null;
    if (!res.ok || !data?.ok) {
      throw new Error(data?.error || `HTTP ${res.status}`);
    }
    return data;
  }

  function matchUnified(health) {
    if (!health?.ok) return false;
    if (health.service === "devtools-git-bridge") return false;
    return true;
  }

  function matchGit(health) {
    return Boolean(health?.ok && health.service === "devtools-git-bridge");
  }

  /** @type {Record<string, { installDirKey: string, autoStartKey: string, protocol: string, launchAtKey: string, defaultBase: string, ports: number[], match: (h: any) => boolean }>} */
  const KINDS = {
    unified: {
      installDirKey: "devtools-bridge-install-dir",
      autoStartKey: "devtools-bridge-autostart",
      protocol: "devtools-bridge://start",
      launchAtKey: "devtools-bridge-protocol-launch-at",
      defaultBase: "http://127.0.0.1:17888",
      // 扫 17888–17899，靠 match 排除 Git
      ports: null,
      match: matchUnified,
    },
    git: {
      // Git 已挂载统一桥：发现逻辑对齐 unified，不再默认扫 17890
      installDirKey: "devtools-bridge-install-dir",
      autoStartKey: "devtools-bridge-autostart",
      protocol: "devtools-bridge://start",
      launchAtKey: "devtools-bridge-protocol-launch-at",
      defaultBase: "http://127.0.0.1:17888",
      ports: [17888],
      match: (health) =>
        Boolean(
          health?.ok &&
            (health.unified ||
              health.capabilities?.git ||
              health.gitMount === "/git" ||
              health.service === "devtools-bridge" ||
              health.service === "devtools-bridge-git" ||
              health.service === "devtools-git-bridge")
        ),
    },
  };

  function kindConfig(kind) {
    return KINDS[kind] || KINDS.unified;
  }

  /** 扫描候选端口，可用 match 过滤服务类型 */
  async function discoverBase(preferredBase, token, opts = {}) {
    const kind = opts.kind || null;
    const cfg = kind ? kindConfig(kind) : null;
    const match = opts.match || cfg?.match || (() => true);
    const seen = new Set();
    const candidates = [];
    const push = (raw) => {
      const base = normalizeBridgeBase(raw);
      if (!seen.has(base)) {
        seen.add(base);
        candidates.push(base);
      }
    };
    push(preferredBase || cfg?.defaultBase);
    if (cfg?.ports?.length) {
      for (const port of cfg.ports) push(`http://127.0.0.1:${port}`);
    } else {
      for (let port = 17888; port < 17900; port += 1) {
        push(`http://127.0.0.1:${port}`);
      }
    }
    for (const base of candidates) {
      let health = null;
      try {
        health = await probeHealth(base, token, false);
      } catch (_) {
        try {
          health = await probeHealth(base, token, true);
        } catch (_) {
          /* try next */
        }
      }
      if (!health || !match(health)) continue;
      const port = Number(health.port) || Number(base.split(":").pop()) || 17888;
      return { base: `http://127.0.0.1:${port}`, health, kind: kind || null };
    }
    return null;
  }

  const LAUNCH_COOLDOWN_MS = 60000;

  // —— 向后兼容：默认指向统一桥（ADB） ——
  const INSTALL_DIR_KEY = KINDS.unified.installDirKey;
  const AUTO_START_KEY = KINDS.unified.autoStartKey;
  const PROTOCOL = KINDS.unified.protocol;
  const LAUNCH_AT_KEY = KINDS.unified.launchAtKey;

  function recentlyLaunchedProtocol(key = LAUNCH_AT_KEY) {
    try {
      const at = Number(sessionStorage.getItem(key) || 0);
      return at > 0 && Date.now() - at < LAUNCH_COOLDOWN_MS;
    } catch (_) {
      return false;
    }
  }

  function markProtocolLaunched(key = LAUNCH_AT_KEY) {
    try {
      sessionStorage.setItem(key, String(Date.now()));
    } catch (_) {
      /* ignore */
    }
  }

  function readInstallDir(kind = "unified") {
    const key = kindConfig(kind).installDirKey;
    try {
      return String(localStorage.getItem(key) || "").trim();
    } catch (_) {
      return "";
    }
  }

  function writeInstallDir(dir, kind = "unified") {
    const key = kindConfig(kind).installDirKey;
    const value = String(dir || "").trim();
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch (_) {
      /* ignore */
    }
    return value;
  }

  function readAutoStart(kind = "unified") {
    const key = kindConfig(kind).autoStartKey;
    try {
      const v = localStorage.getItem(key);
      return v == null ? true : v === "1" || v === "true";
    } catch (_) {
      return true;
    }
  }

  function writeAutoStart(on, kind = "unified") {
    const key = kindConfig(kind).autoStartKey;
    try {
      localStorage.setItem(key, on ? "1" : "0");
    } catch (_) {
      /* ignore */
    }
    return Boolean(on);
  }

  function rememberFromHealth(health, kind) {
    const dir = String(health?.installDir || health?.bridgeDir || "").trim();
    if (!dir) return "";
    const resolvedKind =
      kind ||
      (health?.service === "devtools-git-bridge"
        ? "git"
        : "unified");
    writeInstallDir(dir, resolvedKind);
    return dir;
  }

  /** 尝试通过自定义协议唤起本机启动脚本 */
  function tryLaunchBridge(kind = "unified") {
    const cfg = kindConfig(kind);
    if (recentlyLaunchedProtocol(cfg.launchAtKey)) return cfg.protocol;
    markProtocolLaunched(cfg.launchAtKey);
    try {
      const iframe = document.createElement("iframe");
      iframe.style.cssText = "display:none;width:0;height:0;border:0";
      iframe.src = cfg.protocol;
      document.body.appendChild(iframe);
      setTimeout(() => iframe.remove(), 2500);
    } catch (_) {
      try {
        window.location.href = cfg.protocol;
      } catch (_) {
        /* ignore */
      }
    }
    return cfg.protocol;
  }

  async function ensureBridgeRunning({
    preferredBase,
    token,
    timeoutMs = 45000,
    launch = true,
    kind = "unified",
  } = {}) {
    const cfg = kindConfig(kind);
    const t0 = Date.now();
    let found = await discoverBase(preferredBase || cfg.defaultBase, token || read(), { kind });
    if (found?.health) {
      rememberFromHealth(found.health, kind);
      return found;
    }
    if (launch && readAutoStart(kind)) {
      const graceEnd = Date.now() + 4000;
      while (Date.now() < graceEnd) {
        await new Promise((r) => setTimeout(r, 700));
        found = await discoverBase(preferredBase || cfg.defaultBase, token || read(), { kind });
        if (found?.health) {
          rememberFromHealth(found.health, kind);
          return found;
        }
      }
      tryLaunchBridge(kind);
    }
    while (Date.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, 1500));
      found = await discoverBase(preferredBase || cfg.defaultBase, token || read(), { kind });
      if (found?.health) {
        rememberFromHealth(found.health, kind);
        return found;
      }
    }
    return null;
  }

  /**
   * 绑定「桥解压目录 / 记住 / 启动 / 自动启动」控件（ADB 同款）。
   * @returns {{ autoEnsure: Function }}
   */
  function bindBridgeLaunchUI({
    kind = "unified",
    dirInput,
    saveBtn,
    launchBtn,
    autoEl,
    getPreferredBase,
    getToken,
    onStatus,
    onConnected,
    toast,
  } = {}) {
    const cfg = kindConfig(kind);
    const say = typeof toast === "function" ? toast : () => {};
    const status = typeof onStatus === "function" ? onStatus : () => {};

    try {
      if (dirInput) dirInput.value = readInstallDir(kind) || dirInput.value || "";
      if (autoEl) autoEl.checked = readAutoStart(kind) !== false;
    } catch (_) {
      /* ignore */
    }

    saveBtn?.addEventListener("click", () => {
      const dir = String(dirInput?.value || "").trim();
      writeInstallDir(dir, kind);
      say(dir ? "已记住桥目录" : "已清除桥目录");
    });

    autoEl?.addEventListener("change", (e) => {
      writeAutoStart(Boolean(e.target.checked), kind);
    });

    launchBtn?.addEventListener("click", async () => {
      const dir = String(dirInput?.value || "").trim();
      if (dir) writeInstallDir(dir, kind);
      status(
        "is-warn",
        "正在唤起本机桥…",
        `若已手动打开启动脚本，浏览器再询问时请点取消。协议：${cfg.protocol}`
      );
      tryLaunchBridge(kind);
      const found = await ensureBridgeRunning({
        preferredBase: getPreferredBase?.() || cfg.defaultBase,
        token: getToken?.() || read(),
        timeoutMs: 20000,
        launch: false,
        kind,
      });
      if (found?.health) {
        if (typeof onConnected === "function") await onConnected(found);
      } else {
        status(
          "is-warn",
          "等待本机桥…",
          "若未弹出启动，请到已记住的目录双击启动脚本，并保持窗口打开。"
        );
      }
    });

    return {
      async autoEnsure(timeoutMs = 20000) {
        if (readAutoStart(kind) === false) return null;
        return ensureBridgeRunning({
          preferredBase: getPreferredBase?.() || cfg.defaultBase,
          token: getToken?.() || read(),
          timeoutMs,
          launch: true,
          kind,
        });
      },
    };
  }

  /** 从拖放事件尽量解析本机绝对路径（浏览器通常不给 File.path，依赖 file:// / 文本） */
  function pathsFromDataTransfer(dt) {
    if (!dt) return [];
    const out = [];
    const push = (raw) => {
      let p = String(raw || "").trim().replace(/^["']|["']$/g, "");
      if (!p) return;
      if (p.startsWith("file:")) {
        try {
          const u = new URL(p);
          p = decodeURIComponent(u.pathname || "");
          // Windows: /C:/Users/... → C:/Users/...
          if (/^\/[A-Za-z]:\//.test(p)) p = p.slice(1);
          p = p.replace(/\//g, p.includes("\\") ? "\\" : "/");
        } catch (_) {
          return;
        }
      }
      // 绝对路径启发式
      if (!/^([A-Za-z]:[\\/]|\\\\|\/)/.test(p)) return;
      if (!out.includes(p)) out.push(p);
    };

    const uriList = dt.getData?.("text/uri-list") || "";
    for (const line of String(uriList).split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      push(line);
    }
    const plain = dt.getData?.("text/plain") || "";
    for (const line of String(plain).split(/\r?\n/)) push(line);

    try {
      for (const f of dt.files || []) {
        if (f && f.path) push(f.path);
      }
    } catch (_) {
      /* ignore */
    }
    return out;
  }

  window.devtoolsBridgeToken = {
    read,
    write,
    DEFAULT,
    KEYS,
    KINDS,
    INSTALL_DIR_KEY,
    AUTO_START_KEY,
    PROTOCOL,
    normalizeBridgeBase,
    probeHealth,
    discoverBase,
    matchUnified,
    matchGit,
    readInstallDir,
    writeInstallDir,
    readAutoStart,
    writeAutoStart,
    rememberFromHealth,
    tryLaunchBridge,
    ensureBridgeRunning,
    bindBridgeLaunchUI,
    pathsFromDataTransfer,
    kindConfig,
  };
})();
