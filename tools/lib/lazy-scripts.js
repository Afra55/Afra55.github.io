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
    qrcodegen: {
      src: "./vendor/qrcodegen.js",
      probe: () => typeof globalThis.qrcodegen?.QrCode !== "undefined",
    },
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
    jsonrepair: {
      src: "./vendor/jsonrepair.min.js",
      probe: () => typeof globalThis.JSONRepair?.jsonrepair === "function",
    },
  };

  const EXTERNAL_SITE_TOOLS = new Set(["pdfcraft", "insectworld", "prehmuseum"]);

  const TOOL_FILES = {
    acupoint: "./acupoint.js",
    healthread: "./healthread.js",
    vtrim: "./vtrim.js",
    vplay: "./vplay.js",
    audio: "./audio.js",
    everything: "./everything.js",
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
    timediff: "./extra-panels/timediff.js",
    color: "./extra-panels/color.js",
    url: "./extra-panels/url.js",
    query: "./extra-panels/query.js",
    uuid: "./extra-panels/uuid.js",
    hash: "./extra-panels/hash.js",
    text: "./extra-panels/text.js",
    caseconv: "./extra-panels/caseconv.js",
    coord: "./extra-panels/coord.js",
    yaml: "./extra-panels/yaml.js",
    imgb64: "./extra-panels/imgb64.js",
    qrcode: "./extra-panels/qrcode.js",
    cron: "./extra-panels/cron.js",
    units: "./extra-panels/units.js",
    sharecard: "./extra-panels/sharecard.js",
    numbase: "./extra-panels/numbase.js",
    markdown: "./extra-panels/markdown.js",
    eyedropper: "./extra-panels/eyedropper.js",
    password: "./extra-panels/password.js",
    gifmaker: "./extra-panels/gifmaker.js",
    gifx: "./extra-panels/gifx.js",
    v2g: "./extra-panels/v2g-suite.js",
    gifbb: "./extra-panels/gifbb.js",
    gifc: "./extra-panels/gifc.js",
    gife: "./extra-panels/gife.js",
    gifm: "./extra-panels/gifm.js",
    adb: "./extra-panels/adb.js",
    vsplit: "./extra-panels/v2g-suite.js",
    vbb: "./extra-panels/v2g-suite.js",
  };

  const EXTRA_PANEL_IDS = new Set([
    "timediff", "color", "url", "query", "uuid", "hash", "text", "caseconv", "coord",
    "yaml", "imgb64", "qrcode", "cron", "units", "sharecard", "numbase", "markdown",
    "eyedropper", "password", "gifmaker", "gifx", "v2g", "gifbb", "gifc", "gife", "gifm",
    "adb", "vsplit", "vbb",
  ]);

  const EXTRA_MEDIA_TOOLS = new Set([
    "sharecard", "gifmaker", "gifx", "v2g", "vsplit", "vbb", "gifbb", "gifc", "gife", "gifm", "adb",
  ]);

  const TOOL_VENDORS = {
    yaml: ["js-yaml"],
    hash: ["spark-md5"],
    qrcode: ["qrcodegen", "qrcode", "jsQR"],
    lanshare: ["qrcode", "jsQR"],
    sharecard: ["html2canvas"],
    gifmaker: ["gif", "omggif"],
    v2g: ["gif", "omggif"],
    gifx: ["gif", "omggif"],
    gifc: ["gif", "omggif"],
    gife: ["gif", "omggif"],
    gifm: ["gif", "omggif"],
    vsplit: ["gif", "omggif"],
    vbb: ["gif", "omggif"],
    gifbb: ["gif", "omggif"],
    dateremind: ["solarlunar"],
  };

  /** 独立脚本，不走 extra 面板栈 */
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
    "everything",
    "ffbridge",
    "ytdlp",
    "phlogo",
    "nokiasms",
  ]);

  const NO_PURE = new Set([
    "acupoint", "healthread", "textimg", "imgtext", "whiteboard", "lanshare", "everything", "ffbridge", "ytdlp",
    "setup", "about", "pdfcraft", "insectworld", "prehmuseum", "xorenc", "morse", "countdown",
    "dateremind", "phlogo", "nokiasms", "sandspiel", "wheel", "ruler", "muyu", "minigames", "ambient",
  ]);

  const scriptPromises = new Map();
  let extraCorePromise = null;

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

  async function loadExtraCore(onProgress, { media = false } = {}) {
    if (window.__devtoolsExtraCore && (!media || window.DevToolsExtraMedia)) return;
    if (extraCorePromise) return extraCorePromise;
    extraCorePromise = (async () => {
      onProgress?.(0.1, "初始化面板绑定…");
      if (!window.DevToolsExtraBind) await loadScript("./lib/extra-bind.js");
      onProgress?.(0.22, "加载工具基础库…");
      if (!window.DevToolsExtraKit) await loadScript("./lib/extra-kit.js");
      if (!window.__devtoolsExtraBootstrap) {
        await loadScript("./lib/extra-bootstrap.js");
        window.__devtoolsExtraBootstrap = true;
      }
      if (media) {
        onProgress?.(0.35, "加载临时存储…");
        if (!window.DevToolsTemp) await loadScript("./temp.js");
        await loadScript("./lib/oss-deps.js");
        onProgress?.(0.48, "加载媒体编码核心…");
        if (!window.DevToolsExtraMedia) await loadScript("./lib/extra-media.js");
      }
      window.__devtoolsExtraCore = true;
      window.__devtoolsExtraBundle = true;
      onProgress?.(0.62, "工具基础库已就绪");
    })().catch((err) => {
      extraCorePromise = null;
      throw err;
    });
    return extraCorePromise;
  }

  async function loadExtraBundle(onProgress) {
    await ensurePure();
    await loadExtraCore(onProgress, { media: true });
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
    jsonrepair: "JSON 修复库",
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

    if (EXTRA_PANEL_IDS.has(id)) {
      await loadExtraCore((ratio, label) => report(0.16 + ratio * 0.5, label), {
        media: EXTRA_MEDIA_TOOLS.has(id),
      });
    } else if (!STANDALONE_NO_EXTRA.has(id)) {
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
    loadExtraCore,
    loadVendor,
    loadToolScript,
    loadPwa,
  };
})();
