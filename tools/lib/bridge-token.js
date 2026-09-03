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

  /** 扫描 17888–17899，返回实际监听端口（health.port） */
  async function discoverBase(preferredBase, token) {
    const seen = new Set();
    const candidates = [];
    const push = (raw) => {
      const base = normalizeBridgeBase(raw);
      if (!seen.has(base)) {
        seen.add(base);
        candidates.push(base);
      }
    };
    push(preferredBase);
    for (let port = 17888; port < 17900; port += 1) {
      push(`http://127.0.0.1:${port}`);
    }
    for (const base of candidates) {
      let health = null;
      try {
        health = await probeHealth(base, token, false);
      } catch (_) {
        try {
          health = await probeHealth(base, token, true);
        } catch (_) {
          /* try next port */
        }
      }
      if (!health) continue;
      const port = Number(health.port) || Number(base.split(":").pop()) || 17888;
      return { base: `http://127.0.0.1:${port}`, health };
    }
    return null;
  }

  const INSTALL_DIR_KEY = "devtools-bridge-install-dir";
  const AUTO_START_KEY = "devtools-bridge-autostart";
  const PROTOCOL = "devtools-bridge://start";

  function readInstallDir() {
    try {
      return String(localStorage.getItem(INSTALL_DIR_KEY) || "").trim();
    } catch (_) {
      return "";
    }
  }

  function writeInstallDir(dir) {
    const value = String(dir || "").trim();
    try {
      if (value) localStorage.setItem(INSTALL_DIR_KEY, value);
      else localStorage.removeItem(INSTALL_DIR_KEY);
    } catch (_) {
      /* ignore */
    }
    return value;
  }

  function readAutoStart() {
    try {
      const v = localStorage.getItem(AUTO_START_KEY);
      return v == null ? true : v === "1" || v === "true";
    } catch (_) {
      return true;
    }
  }

  function writeAutoStart(on) {
    try {
      localStorage.setItem(AUTO_START_KEY, on ? "1" : "0");
    } catch (_) {
      /* ignore */
    }
    return Boolean(on);
  }

  function rememberFromHealth(health) {
    const dir = String(health?.installDir || health?.bridgeDir || "").trim();
    if (dir) writeInstallDir(dir);
    return dir;
  }

  /** 尝试通过自定义协议唤起本机启动脚本（需用户曾运行过带注册逻辑的启动脚本） */
  function tryLaunchBridge() {
    try {
      const iframe = document.createElement("iframe");
      iframe.style.cssText = "display:none;width:0;height:0;border:0";
      iframe.src = PROTOCOL;
      document.body.appendChild(iframe);
      setTimeout(() => iframe.remove(), 2500);
    } catch (_) {
      try {
        window.location.href = PROTOCOL;
      } catch (_) {
        /* ignore */
      }
    }
    return PROTOCOL;
  }

  async function ensureBridgeRunning({ preferredBase, token, timeoutMs = 45000, launch = true } = {}) {
    const t0 = Date.now();
    let found = await discoverBase(preferredBase, token || read());
    if (found?.health) {
      rememberFromHealth(found.health);
      return found;
    }
    if (launch && readAutoStart()) tryLaunchBridge();
    while (Date.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, 1500));
      found = await discoverBase(preferredBase, token || read());
      if (found?.health) {
        rememberFromHealth(found.health);
        return found;
      }
    }
    return null;
  }

  window.devtoolsBridgeToken = {
    read,
    write,
    DEFAULT,
    KEYS,
    INSTALL_DIR_KEY,
    AUTO_START_KEY,
    PROTOCOL,
    normalizeBridgeBase,
    probeHealth,
    discoverBase,
    readInstallDir,
    writeInstallDir,
    readAutoStart,
    writeAutoStart,
    rememberFromHealth,
    tryLaunchBridge,
    ensureBridgeRunning,
  };
})();
