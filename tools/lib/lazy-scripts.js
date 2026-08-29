(() => {
  "use strict";

  const BUILD = "2026.08.29-173000";

  const VENDOR_FILES = {
    "js-yaml": { src: "./vendor/js-yaml.min.js", probe: () => typeof globalThis.jsyaml !== "undefined" },
    "spark-md5": { src: "./vendor/spark-md5.min.js", probe: () => typeof globalThis.SparkMD5 !== "undefined" },
    qrcode: { src: "./vendor/qrcode.min.js", probe: () => typeof globalThis.QRCode !== "undefined" },
    jsQR: { src: "./vendor/jsQR.js", probe: () => typeof globalThis.jsQR === "function" },
    html2canvas: {
      src: "./vendor/html2canvas.min.js",
      probe: () => typeof globalThis.html2canvas === "function",
    },
    gif: { src: "./vendor/gif.js", probe: () => typeof globalThis.GIF === "function" },
    omggif: { src: "./vendor/omggif.js", probe: () => typeof globalThis.GifReader === "function" },
  };

  const TOOL_FILES = {
    acupoint: "./acupoint.js",
    vtrim: "./vtrim.js",
    vplay: "./vplay.js",
    audio: "./audio.js",
    ffbridge: "./ffbridge.js",
    lanshare: "./lanshare.js",
    setup: "./setup.js",
    imgkit: "./imgkit.js",
    memo: "./memo.js",
    textimg: "./textimg.js",
    imgtext: "./imgtext.js",
    imgpreview: "./imgpreview.js",
    whiteboard: "./whiteboard.js",
  };

  const TOOL_VENDORS = {
    yaml: ["js-yaml"],
    hash: ["spark-md5"],
    qrcode: ["qrcode", "jsQR"],
    sharecard: ["html2canvas"],
    gifmaker: ["gif", "omggif"],
    vsplit: ["gif", "omggif"],
    vbb: ["gif", "omggif"],
  };

  const scriptPromises = new Map();

  function withVersion(src) {
    const url = new URL(src, document.baseURI || window.location.href);
    url.searchParams.set("v", BUILD);
    return url.pathname + url.search;
  }

  function loadScript(src, { timeoutMs = 60000 } = {}) {
    const key = withVersion(src);
    if (scriptPromises.has(key)) return scriptPromises.get(key);
    const promise = new Promise((resolve, reject) => {
      let settled = false;
      const finishOk = () => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve();
      };
      const finishErr = (err) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        reject(err || new Error(`脚本加载失败：${src}`));
      };
      const timer = window.setTimeout(() => finishErr(new Error(`脚本加载超时：${src}`)), timeoutMs);
      const existing = [...document.scripts].find((s) => {
        try {
          const attr = s.getAttribute("src") || "";
          return withVersion(attr) === key || s.src.endsWith(src.replace(/^\.\//, ""));
        } catch (_) {
          return false;
        }
      });
      if (existing) {
        if (existing.dataset.devtoolsLoaded === "1") {
          finishOk();
          return;
        }
        existing.addEventListener("load", finishOk, { once: true });
        existing.addEventListener("error", () => finishErr(new Error(`脚本加载失败：${src}`)), { once: true });
        return;
      }
      const node = document.createElement("script");
      node.src = key;
      node.async = true;
      node.onload = () => {
        node.dataset.devtoolsLoaded = "1";
        finishOk();
      };
      node.onerror = () => finishErr(new Error(`脚本加载失败：${src}`));
      document.head.appendChild(node);
    }).catch((err) => {
      scriptPromises.delete(key);
      throw err;
    });
    scriptPromises.set(key, promise);
    return promise;
  }

  async function loadVendor(id) {
    const spec = VENDOR_FILES[id];
    if (!spec) return;
    if (spec.probe()) return;
    await loadScript(spec.src);
    if (!spec.probe()) throw new Error(`依赖未就绪：${id}`);
  }

  async function loadToolScript(toolId) {
    const src = TOOL_FILES[toolId];
    if (!src) return;
    await loadScript(src);
  }

  async function ensureForTool(toolId) {
    const id = String(toolId || "").trim();
    if (!id) return;
    const tasks = [];
    if (TOOL_FILES[id]) tasks.push(loadToolScript(id));
    const vendors = TOOL_VENDORS[id] || [];
    vendors.forEach((vendorId) => tasks.push(loadVendor(vendorId)));
    if (!tasks.length) return;
    await Promise.all(tasks);
  }

  window.DevToolsLazy = {
    BUILD,
    ensureForTool,
    loadVendor,
    loadToolScript,
  };
})();
