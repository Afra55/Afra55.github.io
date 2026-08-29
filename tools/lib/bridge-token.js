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

  window.devtoolsBridgeToken = { read, write, DEFAULT, KEYS };
})();
