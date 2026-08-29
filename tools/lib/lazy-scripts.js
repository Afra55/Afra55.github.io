(() => {
  "use strict";

  const BUILD = window.TOOLS_BUILD || "2026.08.29-205000";

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

  /** 独立脚本即可运行，不必拉 extra.js（~580KB） */
  const STANDALONE_NO_EXTRA = new Set([
    "memo",
    "whiteboard",
    "acupoint",
    "textimg",
    "imgtext",
    "imgpreview",
    "setup",
    "imgkit",
    "lanshare",
    "ffbridge",
  ]);

  /** 不依赖 DevToolsPure */
  const NO_PURE = new Set(["acupoint", "textimg", "imgtext", "whiteboard", "lanshare", "ffbridge", "setup", "about"]);

  const scriptPromises = new Map();
  let extraBundlePromise = null;

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
      node.async = false;
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

  async function ensurePure() {
    if (window.DevToolsPure) return;
    if (!window.DiffCore) await loadScript("./lib/diff-core.js");
    await loadScript("./lib/pure.js");
  }

  async function loadExtraBundle() {
    if (window.__devtoolsExtraBundle) return;
    if (extraBundlePromise) return extraBundlePromise;
    extraBundlePromise = (async () => {
      await ensurePure();
      await loadScript("./temp.js");
      await loadScript("./lib/oss-deps.js");
      await loadScript("./extra.js");
      window.__devtoolsExtraBundle = true;
    })().catch((err) => {
      extraBundlePromise = null;
      throw err;
    });
    return extraBundlePromise;
  }

  async function loadDiffBundle() {
    await ensurePure();
    if (!window.DiffCore) await loadScript("./lib/diff-core.js");
    await loadScript("./diff.js");
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

  async function loadPwa() {
    if (window.__devtoolsPwaLoaded) return;
    await loadScript("./pwa.js");
    window.__devtoolsPwaLoaded = true;
  }

  async function ensureForTool(toolId) {
    const id = String(toolId || "").trim();
    if (!id) return;

    if (id === "about") {
      await loadScript("./about.js");
      return;
    }
    if (id === "diff") {
      await loadDiffBundle();
      return;
    }

    if (!NO_PURE.has(id)) await ensurePure();

    if (!STANDALONE_NO_EXTRA.has(id)) {
      await loadExtraBundle();
    }

    if (TOOL_FILES[id]) await loadToolScript(id);

    const vendors = TOOL_VENDORS[id] || [];
    for (const vendorId of vendors) await loadVendor(vendorId);
  }

  window.DevToolsLazy = {
    BUILD,
    ensureForTool,
    loadExtraBundle,
    loadVendor,
    loadToolScript,
    loadPwa,
  };
})();
