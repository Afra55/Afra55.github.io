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
      try {
        const health = await probeHealth(base, token, false);
        const port = Number(health.port) || Number(base.split(":").pop()) || 17888;
        return { base: `http://127.0.0.1:${port}`, health };
      } catch (_) {
        /* try next port */
      }
    }
    return null;
  }

  window.devtoolsBridgeToken = {
    read,
    write,
    DEFAULT,
    KEYS,
    normalizeBridgeBase,
    probeHealth,
    discoverBase,
  };
})();
