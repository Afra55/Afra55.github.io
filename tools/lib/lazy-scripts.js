(() => {
  "use strict";

  const BUILD = window.TOOLS_BUILD || "2026.08.30-232500";

  function getMqttConnect() {
    const m = globalThis.mqtt;
    if (!m) return null;
    if (typeof m.connect === "function") return m.connect.bind(m);
    if (typeof m.default?.connect === "function") return m.default.connect.bind(m.default);
    if (typeof m.default === "function") return m.default;
    return null;
  }

  const VENDOR_FILES = {
    "js-yaml": { src: "./vendor/js-yaml.min.js", probe: () => typeof globalThis.jsyaml !== "undefined" },
    "spark-md5": { src: "./vendor/spark-md5.min.js", probe: () => typeof globalThis.SparkMD5 !== "undefined" },
    qrcode: { src: "./vendor/qrcode.min.js", probe: () => typeof globalThis.QRCode !== "undefined" },
    jsQR: { src: "./vendor/jsQR.js", probe: () => typeof globalThis.jsQR === "function" },
    mqtt: {
      src: "./vendor/mqtt.min.js",
      probe: () => typeof globalThis.mqtt !== "undefined" && !!getMqttConnect(),
    },
    html2canvas: {
      src: "./vendor/html2canvas.min.js",
      probe: () => typeof globalThis.html2canvas === "function",
    },
    gif: { src: "./vendor/gif.js", probe: () => typeof globalThis.GIF === "function" },
    omggif: { src: "./vendor/omggif.js", probe: () => typeof globalThis.GifReader === "function" },
    solarlunar: {
      src: "./vendor/solarlunar.min.js",
      probe: () => typeof globalThis.solarlunar === "object",
    },
  };

  const EXTERNAL_SITE_TOOLS = new Set(["pdfcraft", "insectworld", "prehmuseum"]);

  const TOOL_FILES = {
    acupoint: "./acupoint.js",
    healthread: "./healthread.js",
    vtrim: "./vtrim.js",
    vplay: "./vplay.js",
    audio: "./audio.js",
    ffbridge: "./ffbridge.js",
    ytdlp: "./ytdlp.js",
    lanshare: "./lanshare.js",
    setup: "./setup.js",
    imgkit: "./imgkit.js",
    imgtrim: "./imgtrim.js",
    xorenc: "./xorenc.js",
    morse: "./morse.js",
    countdown: "./countdown.js",
    dateremind: "./dateremind.js",
    pdfcraft: "./pdfcraft.js",
    insectworld: "./insectworld.js",
    prehmuseum: "./prehmuseum.js",
    wheel: "./wheel.js",
    ruler: "./ruler.js",
    muyu: "./muyu.js",
    minigames: "./minigames.js",
    ambient: "./ambient.js",
    sandspiel: "./sandspiel.js",
    memo: "./memo.js",
    textimg: "./textimg.js",
    imgtext: "./imgtext.js",
    imgpreview: "./imgpreview.js",
    whiteboard: "./whiteboard.js",
    phlogo: "./phlogo.js",
    nokiasms: "./nokiasms.js",
    sandspiel: "./sandspiel.js",
  };

  const TOOL_VENDORS = {
    yaml: ["js-yaml"],
    hash: ["spark-md5"],
    qrcode: ["qrcode", "jsQR"],
    lanshare: ["qrcode", "jsQR"],
    sharecard: ["html2canvas"],
    gifmaker: ["gif", "omggif"],
    vsplit: ["gif", "omggif"],
    vbb: ["gif", "omggif"],
    gifbb: ["gif", "omggif"],
    dateremind: ["solarlunar"],
  };

  /** 独立脚本即可运行，不必拉 extra.js（~580KB） */
  const STANDALONE_NO_EXTRA = new Set([
    "memo",
    "whiteboard",
    "acupoint",
    "healthread",
    "textimg",
    "imgtext",
    "imgpreview",
    "setup",
    "imgkit",
    "imgtrim",
    "xorenc",
    "morse",
    "countdown",
    "dateremind",
    "pdfcraft",
    "insectworld",
    "prehmuseum",
    "wheel",
    "ruler",
    "muyu",
    "minigames",
    "ambient",
    "sandspiel",
    "lanshare",
    "ffbridge",
    "ytdlp",
    "phlogo",
    "nokiasms",
    "sandspiel",
  ]);

  /** 不依赖 DevToolsPure */
  const NO_PURE = new Set(["acupoint", "healthread", "textimg", "imgtext", "whiteboard", "lanshare", "ffbridge", "ytdlp", "setup", "about", "pdfcraft", "insectworld", "prehmuseum", "xorenc", "morse", "countdown", "dateremind", "phlogo", "nokiasms", "sandspiel", "wheel", "ruler", "muyu", "minigames", "ambient"]);

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

  async function loadExtraBundle(onProgress) {
    if (window.__devtoolsExtraBundle) return;
    if (extraBundlePromise) return extraBundlePromise;
    extraBundlePromise = (async () => {
      await ensurePure();
      onProgress?.(0.28, "加载工具基础库…");
      await loadScript("./temp.js");
      onProgress?.(0.38, "加载临时存储模块…");
      await loadScript("./lib/oss-deps.js");
      onProgress?.(0.44, "初始化面板绑定…");
      await loadScript("./lib/extra-bind.js");
      onProgress?.(0.52, "加载媒体工具脚本（首次约数秒）…");
      await loadScript("./extra.js");
      onProgress?.(0.72, "媒体工具脚本已就绪");
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
    if (EXTERNAL_SITE_TOOLS.has(toolId)) {
      await loadScript("./lib/open-external-site.js");
    }
    await loadScript(src);
  }

  async function loadPwa() {
    if (window.__devtoolsPwaLoaded) return;
    await loadScript("./pwa.js");
    window.__devtoolsPwaLoaded = true;
  }

  const VENDOR_LABELS = {
    "js-yaml": "YAML 库",
    "spark-md5": "MD5 库",
    qrcode: "二维码库",
    jsQR: "扫码库",
    mqtt: "MQTT 库",
    html2canvas: "截图库",
    gif: "GIF 编码库",
    omggif: "GIF 解码库",
    solarlunar: "农历库",
  };

  async function ensureForTool(toolId, opts = {}) {
    const id = String(toolId || "").trim();
    if (!id) return;
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
    const report = (ratio, label) => onProgress?.(Math.max(0, Math.min(1, Number(ratio) || 0)), label);

    if (id === "about") {
      report(0.2, "加载关于页…");
      await loadScript("./about.js");
      report(1, "关于页已就绪");
      return;
    }
    if (id === "diff") {
      report(0.2, "加载文本比对…");
      await loadDiffBundle();
      report(1, "文本比对已就绪");
      return;
    }

    if (!NO_PURE.has(id)) {
      report(0.08, "加载计算核心…");
      await ensurePure();
      report(0.16, "计算核心已就绪");
    }

    if (!STANDALONE_NO_EXTRA.has(id)) {
      await loadExtraBundle((ratio, label) => {
        report(0.16 + ratio * 0.56, label);
      });
    }

    const vendors = TOOL_VENDORS[id] || [];
    for (let i = 0; i < vendors.length; i++) {
      const vendorId = vendors[i];
      const name = VENDOR_LABELS[vendorId] || vendorId;
      report(0.74 + (i / Math.max(1, vendors.length)) * 0.18, `加载${name}…`);
      await loadVendor(vendorId);
    }

    if (id === "healthread") {
      const v = encodeURIComponent(BUILD);
      fetch(`./lib/health-articles/index.json?v=${v}`).catch(() => {});
    }

    if (TOOL_FILES[id]) {
      report(0.94, `加载${id} 模块…`);
      await loadToolScript(id);
    }
    report(1, "工具已就绪");
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
