(() => {
  "use strict";

  const BUILD = window.TOOLS_BUILD || "2026.08.30-232500";
  // 第三方库单独版本号：不随站点构建变化，浏览器缓存才能跨发布复用（升级 vendor 时手动 +1）
  const VENDOR_V = "4";
  const isVendorSrc = (src) => /(^|\/)vendor\//.test(String(src || ""));

  function getMqttConnect() {
    const m = globalThis.mqtt;
    if (!m) return null;
    if (typeof m.connect === "function") return m.connect.bind(m);
    if (typeof m.default?.connect === "function") return m.default.connect.bind(m.default);
    if (typeof m.default === "function") return m.default;
    return null;
  }

  const VENDOR_FILES = {
    "js-yaml": { src: "./vendor/js-yaml.min.js", noAmd: true, probe: () => typeof globalThis.jsyaml !== "undefined" },
    "spark-md5": { src: "./vendor/spark-md5.min.js", noAmd: true, probe: () => typeof globalThis.SparkMD5 !== "undefined" },
    qrcodegen: {
      src: "./vendor/qrcodegen.js",
      probe: () => typeof globalThis.qrcodegen?.QrCode !== "undefined",
    },
    qrcode: { src: "./vendor/qrcode.min.js", probe: () => typeof globalThis.QRCode !== "undefined" },
    jsQR: { src: "./vendor/jsQR.js", probe: () => typeof globalThis.jsQR === "function" },
    zxing: {
      src: "./vendor/zxing-library.min.js",
      noAmd: true,
      probe: () => typeof globalThis.ZXing?.MultiFormatReader === "function",
    },
    mqtt: {
      src: "./vendor/mqtt.min.js",
      probe: () => typeof globalThis.mqtt !== "undefined" && !!getMqttConnect(),
    },
    html2canvas: {
      src: "./vendor/html2canvas.min.js",
      // 页面存在 AMD define 时它的 UMD 初始化会抛错 → 加载期间临时屏蔽 define
      noAmd: true,
      probe: () => typeof globalThis.html2canvas === "function",
    },
    gif: { src: "./vendor/gif.js", noAmd: true, probe: () => typeof globalThis.GIF === "function" },
    omggif: { src: "./vendor/omggif.js", probe: () => typeof globalThis.GifReader === "function" },
    solarlunar: {
      src: "./vendor/solarlunar.min.js",
      probe: () => typeof globalThis.solarlunar === "object",
    },
    jsonrepair: {
      src: "./vendor/jsonrepair.min.js",
      probe: () => typeof globalThis.JSONRepair?.jsonrepair === "function",
    },
    regulex: {
      src: "./vendor/regulex.js",
      probe: () => typeof globalThis.require === "function",
    },
    leaflet: {
      src: "./vendor/leaflet/leaflet.js",
      probe: () => typeof globalThis.L !== "undefined" || typeof globalThis.leaflet !== "undefined",
    },
    markdownit: { src: "./vendor/markdown-it.min.js", probe: () => typeof globalThis.markdownit === "function" },
    purify: {
      src: "./vendor/purify.min.js",
      probe: () => typeof globalThis.DOMPurify === "object" || typeof globalThis.DOMPurify === "function",
    },
    hljs: { src: "./vendor/highlight/highlight.min.js", probe: () => typeof globalThis.hljs === "object" },
    cm6: { src: "./vendor/cm6/cm6.bundle.js", probe: () => typeof globalThis.DevToolsCM6 === "object" },
    katexmd: { src: "./vendor/katex/markdown-it-katex.js", probe: () => typeof globalThis.markdownItKatex === "function" },
    mermaid: { src: "./vendor/mermaid/mermaid.min.js", probe: () => typeof globalThis.mermaid === "object" },
    jszip: { src: "./vendor/jszip.min.js", noAmd: true, probe: () => typeof globalThis.JSZip === "function" },
    turndown: { src: "./vendor/turndown/turndown.js", probe: () => typeof globalThis.TurndownService === "function" },
    mammoth: {
      src: "./vendor/mammoth/mammoth.browser.min.js",
      noAmd: true,
      probe: () => typeof globalThis.mammoth?.convertToHtml === "function",
    },
    pdfjs: {
      src: "./vendor/pdfjs/pdf.min.js",
      noAmd: true,
      probe: () => typeof globalThis.pdfjsLib?.getDocument === "function",
    },
    mdext: { src: "./vendor/mdext/mdext.js", probe: () => typeof globalThis.markdownItExtras === "object" },
    mdmpure: { src: "./lib/mdm-pure.js", probe: () => typeof globalThis.DevToolsMdmPure === "object" },
    docquality: {
      src: "./lib/doc-quality-router.js",
      probe: () => typeof globalThis.DevToolsDocQualityRouter === "object",
    },
    pandocprogress: {
      src: "./lib/pandoc-export-progress.js",
      probe: () => typeof globalThis.DevToolsPandocExportProgress?.open === "function",
    },
    enspeakfill: {
      src: "./lib/enspeak-fill.js",
      probe: () => typeof globalThis.DevToolsEnspeakFill?.fillEnTemplate === "function",
    },
  };

  const EXTERNAL_SITE_TOOLS = new Set([]);

  const TOOL_FILES = {
    mdread: "./mdread-tool.js",
    acupoint: "./acupoint.js",
    healthread: "./healthread.js",
    vtrim: "./vtrim.js",
    vidkit: "./vidkit.js",
    vplay: "./vplay.js",
    audio: "./audio.js",
    ffbridge: "./ffbridge.js",
    ytdlp: "./ytdlp.js",
    gitbridge: "./gitbridge.js",
    passvault: "./passvault.js",
    apidebug: "./apidebug.js",
    lanshare: "./lanshare.js",
    lanboard: "./lanboard.js",
    setup: "./setup.js",
    envkit: "./envkit.js",
    feedbackhub: "./feedbackhub.js",
    imgkit: "./imgkit.js",
    imgtrim: "./imgtrim.js",
    xorenc: "./xorenc.js",
    morse: "./morse.js",
    countdown: "./countdown.js",
    dateremind: "./dateremind.js",
    wheel: "./wheel.js",
    ruler: "./ruler.js",
    muyu: "./muyu.js",
    piano: "./piano.js",
    minigames: "./minigames.js",
    ambient: "./ambient.js",
    enspeak: "./enspeak.js",
    animalearn: "./animalearn.js",
    insectearn: "./insectearn.js",
    plantearn: "./plantearn.js",
    colorearn: "./colorearn.js",
    numearn: "./numearn.js",
    fruitearn: "./fruitearn.js",
    homeearn: "./homeearn.js",
    sportsearn: "./sportsearn.js",
    foodearn: "./foodearn.js",
    thingearn: "./thingearn.js",
    jobearn: "./jobearn.js",
    weatherearn: "./weatherearn.js",
    bodyearn: "./bodyearn.js",
    vegearn: "./vegearn.js",
    vehicleearn: "./vehicleearn.js",
    shapeearn: "./shapeearn.js",
    ipgeo: "./ipgeo.js",
    sandspiel: "./sandspiel.js",
    memo: "./memo.js",
    sitenav: "./sitenav.js",
    mdslides: "./mdslides.js",
    mathedit: "./mathedit.js",
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
    imgrecolor: "./extra-panels/imgrecolor.js",
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
    interpolator: "./extra-panels/interpolator.js",
    giftest: "./extra-panels/giftest.js",
    fileunlock: "./extra-panels/fileunlock.js",
    forcepurge: "./extra-panels/forcepurge.js",
    mdm: "./extra-panels/mdm.js",
    docfmt: "./extra-panels/docfmt.js",
    mediafmt: "./extra-panels/mediafmt.js",
  };

  const EXTRA_PANEL_IDS = new Set([
    "timediff", "color", "url", "query", "uuid", "hash", "text", "caseconv", "coord",
    "yaml", "imgb64", "imgrecolor", "qrcode", "cron", "units", "sharecard", "numbase", "markdown",
    "eyedropper", "password", "gifmaker", "gifx", "v2g", "gifbb", "gifc", "gife", "gifm",
    "adb", "vsplit", "vbb", "interpolator", "giftest", "fileunlock", "forcepurge", "mdm", "docfmt", "mediafmt",
  ]);

  const EXTRA_MEDIA_TOOLS = new Set([
    "sharecard", "gifmaker", "gifx", "v2g", "vsplit", "vbb", "gifbb", "gifc", "gife", "gifm", "adb",
    "vtrim", "vidkit", "vplay", "audio",
  ]);

  const TOOL_VENDORS = {
    regex: ["regulex"],
    yaml: ["js-yaml"],
    hash: ["spark-md5"],
    qrcode: ["qrcodegen", "qrcode", "zxing", "jsQR"],
    lanshare: ["qrcode", "jsQR"],
    lanboard: ["qrcode", "mqtt"],
    sharecard: ["html2canvas"],
    gifmaker: ["gif", "omggif"],
    // v2g / vbb / vsplit：进面板先可点「选视频」；gif.js 延后到真正编码再拉（见 ensureGifEncodeLibs）
    v2g: [],
    gifx: ["gif", "omggif"],
    gifc: ["gif", "omggif"],
    gife: ["gif", "omggif"],
    gifm: ["gif", "omggif"],
    vsplit: [],
    vbb: [],
    gifbb: ["gif", "omggif"],
    giftest: ["omggif"],
    dateremind: ["solarlunar"],
    ipgeo: ["leaflet"],
    mdm: ["markdownit", "purify", "hljs", "cm6", "mdext", "mdmpure", "docquality", "pandocprogress"],
    docfmt: ["docquality", "pandocprogress"],
    enspeak: ["enspeakfill"],
  };

  /** 独立脚本，不走 extra 面板栈 */
  const STANDALONE_NO_EXTRA = new Set([
    "memo",
    "sitenav",
    "mdslides",
    "mathedit",
    "whiteboard",
    "acupoint",
    "healthread",
    "textimg",
    "imgtext",
    "imgpreview",
    "setup",
    "envkit",
    "imgkit",
    "imgtrim",
    "xorenc",
    "morse",
    "countdown",
    "dateremind",
    "wheel",
    "ruler",
    "muyu",
    "piano",
    "minigames",
    "ambient",
    "enspeak",
    "animalearn",
    "insectearn",
    "plantearn",
    "colorearn",
    "numearn",
    "fruitearn", "homeearn", "sportsearn", "foodearn", "thingearn", "jobearn", "weatherearn", "bodyearn", "vegearn",
    "vehicleearn",
    "shapeearn",
    "ipgeo",
    "sandspiel",
    "lanshare",
    "lanboard",
    "ffbridge",
    "ytdlp",
    "gitbridge",
    "passvault",
    "apidebug",
    "phlogo",
    "nokiasms",
  ]);

  const NO_PURE = new Set([
    "acupoint", "healthread", "textimg", "imgtext", "whiteboard", "lanshare", "lanboard", "ffbridge", "ytdlp",
    "gitbridge", "passvault", "apidebug", "envkit", "feedbackhub",
    "setup", "about", "xorenc", "morse", "countdown",
    "dateremind", "phlogo", "nokiasms", "sandspiel", "wheel", "ruler", "muyu", "piano", "minigames", "ambient", "enspeak", "animalearn",
    "insectearn", "plantearn", "colorearn", "numearn", "shapeearn", "vehicleearn", "fruitearn", "homeearn", "sportsearn", "foodearn", "thingearn", "jobearn", "weatherearn", "bodyearn", "vegearn", "ipgeo",
  ]);

  const scriptPromises = new Map();
  /** 本会话已成功执行过的脚本 URL（绝对地址 + ?v=）：比扫 DOM 更稳，再次进入直接命中 */
  const loadedScriptKeys = new Set();
  let extraCorePromise = null;
  /** 本会话已完整加载过的工具：再次进入跳过下载与进度条 */
  const readyTools = new Set();
  /** 同工具并发 ensure 合并为一次，避免进度条抖动 */
  const ensureInflight = new Map();

  function isToolReady(toolId) {
    return readyTools.has(String(toolId || "").trim());
  }

  function markToolReady(toolId) {
    const id = String(toolId || "").trim();
    if (!id) return;
    readyTools.add(id);
    // 共享同一入口脚本的工具（如 vbb/v2g/vsplit）在依赖已齐时一并标记，避免同组切换再走全量进度
    const src = TOOL_FILES[id];
    if (!src) return;
    for (const [other, otherSrc] of Object.entries(TOOL_FILES)) {
      if (other === id || otherSrc !== src || readyTools.has(other)) continue;
      if (toolRuntimeOk(other) && scriptLikelyLoaded(otherSrc)) readyTools.add(other);
    }
  }

  function clearReadyTools() {
    readyTools.clear();
    ensureInflight.clear();
  }

  function vendorReady(vendorId) {
    const spec = VENDOR_FILES[vendorId];
    return Boolean(spec?.probe?.());
  }

  function scriptKeysMatch(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    try {
      const ua = new URL(a, document.baseURI || location.href);
      const ub = new URL(b, document.baseURI || location.href);
      return ua.pathname === ub.pathname && ua.search === ub.search;
    } catch (_) {
      return false;
    }
  }

  function scriptLikelyLoaded(src) {
    if (!src) return true;
    const key = withVersion(src);
    if (loadedScriptKeys.has(key)) return true;
    // 仅「已成功执行」算 loaded；in-flight / 失败标签不算（否则 isToolWarm 会跳过 await）
    return [...document.scripts].some((s) => {
      try {
        if (s.dataset.devtoolsLoaded !== "1") return false;
        if (s.dataset.devtoolsSrcKey && scriptKeysMatch(s.dataset.devtoolsSrcKey, key)) return true;
        const attr = s.getAttribute("src") || s.src || "";
        return scriptKeysMatch(withVersion(attr), key);
      } catch (_) {
        return false;
      }
    });
  }

  /** 运行时全局是否齐（不含 readyTools / 脚本标签） */
  function toolRuntimeOk(toolId) {
    const id = String(toolId || "").trim();
    if (!id) return false;
    const vendors = TOOL_VENDORS[id] || [];
    if (!vendors.every((v) => vendorReady(v))) return false;
    if (!NO_PURE.has(id) && !window.DevToolsPure) return false;
    if (EXTRA_MEDIA_TOOLS.has(id) && !window.DevToolsExtraMedia) return false;
    if (EXTRA_PANEL_IDS.has(id) && !window.__devtoolsExtraCore) return false;
    if (id === "diff" && !window.DiffCore) return false;
    if (id === "memo" && !window.DevToolsMemo) return false;
    if (id === "lanboard" && !window.DevToolsLanBoard) return false;
    if (id === "qrcode" && !window.DevToolsCodeScan && !scriptLikelyLoaded("./lib/code-scan.js")) return false;
    return true;
  }

  /** 依赖是否已在内存：再次进入或同组切换时可跳过加载条 */
  function isToolWarm(toolId) {
    const id = String(toolId || "").trim();
    if (!id) return false;
    if (readyTools.has(id)) return true;
    if (!toolRuntimeOk(id)) return false;
    if (id === "diff" && !scriptLikelyLoaded("./diff.js")) return false;
    if (TOOL_FILES[id] && !scriptLikelyLoaded(TOOL_FILES[id])) return false;
    return true;
  }

  function bustToolScript(src) {
    if (!src) return;
    const key = withVersion(src);
    scriptPromises.delete(key);
    loadedScriptKeys.delete(key);
    [...document.scripts].forEach((s) => {
      try {
        const attr = s.getAttribute("src") || s.src || "";
        const same =
          scriptKeysMatch(withVersion(attr), key) ||
          (s.src && s.src.includes(src.replace(/^\.\//, "")));
        if (same) s.remove();
      } catch (_) {}
    });
  }

  function withVersion(src) {
    const raw = String(src || "").trim();
    if (!raw) return raw;
    const resolve = window.resolveToolsAssetUrl || window.DevToolsResolveToolsAsset;
    const bare = raw.replace(/^\.\//, "").replace(/[?#].*$/, "");
    if (typeof resolve === "function" && /^(?:vendor|lib|extra-panels|styles|panels)\//i.test(bare)) {
      try {
        const abs = resolve(bare, {
          version: isVendorSrc(raw) || isVendorSrc(bare) ? VENDOR_V : BUILD,
        });
        return new URL(abs, document.baseURI || location.href).href;
      } catch (_) {
        /* fall through */
      }
    }
    let base = document.baseURI || window.location.href;
    try {
      const bu = new URL(base);
      if (/\/tools$/i.test(bu.pathname)) {
        bu.pathname += "/";
        base = bu.href;
      }
    } catch (_) {
      /* ignore */
    }
    const url = new URL(raw, base);
    url.searchParams.set("v", isVendorSrc(raw) || /\/vendor\//i.test(url.pathname) ? VENDOR_V : BUILD);
    return url.href;
  }

  /** 已知大脚本体积提示（无 Content-Length 时估算进度，避免条卡住） */
  const SCRIPT_SIZE_HINT = {
    "./extra-panels/v2g-suite.js": 666000,
    "./lib/extra-media.js": 74000,
    "./lib/pure.js": 56000,
    "./lib/oss-deps.js": 19000,
    "./temp.js": 10000,
  };

  function formatDlBytes(n) {
    const b = Math.max(0, Number(n) || 0);
    if (b < 1024) return `${Math.round(b)}B`;
    if (b < 1024 * 1024) {
      const kb = b / 1024;
      return `${kb >= 100 ? Math.round(kb) : kb.toFixed(1)}KB`;
    }
    return `${(b / (1024 * 1024)).toFixed(2)}MB`;
  }

  function scriptSizeHint(src) {
    const bare = String(src || "").replace(/[?#].*$/, "");
    if (SCRIPT_SIZE_HINT[bare]) return SCRIPT_SIZE_HINT[bare];
    const hit = Object.keys(SCRIPT_SIZE_HINT).find((k) => bare.endsWith(k.replace(/^\.\//, "")));
    return hit ? SCRIPT_SIZE_HINT[hit] : 0;
  }

  function scrubStaleScriptTags(key, src) {
    [...document.scripts].forEach((s) => {
      try {
        const attr = s.getAttribute("src") || s.src || "";
        const same =
          scriptKeysMatch(withVersion(attr), key) ||
          (s.src && s.src.includes(String(src || "").replace(/^\.\//, "")));
        if (!same) return;
        if (s.dataset.devtoolsLoaded === "1") return;
        s.remove();
      } catch (_) {}
    });
  }

  function findLoadedScriptTag(key) {
    return [...document.scripts].find((s) => {
      try {
        if (s.dataset.devtoolsLoaded !== "1") return false;
        if (s.dataset.devtoolsSrcKey && scriptKeysMatch(s.dataset.devtoolsSrcKey, key)) return true;
        const attr = s.getAttribute("src") || s.src || "";
        return scriptKeysMatch(withVersion(attr), key);
      } catch (_) {
        return false;
      }
    });
  }

  /**
   * @param {string} src
   * @param {{ timeoutMs?: number, onProgress?: (ratio:number,label:string)=>void, label?: string }} [opts]
   * onProgress 有值时走 fetch 流式下载，便于大脚本显示 KB 进度（否则用户以为卡住）。
   */
  /** 同 URL 并发加载时，后到的 onProgress 也能收到字节进度 */
  const scriptProgressListeners = new Map();
  /** 按 BUILD 分桶；发版 ?v= 与桶名都变，旧桶启动时清掉 */
  const SCRIPT_CACHE_PREFIX = "devtools-scripts-";
  let scriptCachePrunePromise = null;

  function scriptCacheName() {
    return SCRIPT_CACHE_PREFIX + String(BUILD || "dev").replace(/[^\w.-]+/g, "_");
  }

  function pruneOldScriptCaches() {
    if (!window.caches?.keys) return Promise.resolve();
    if (scriptCachePrunePromise) return scriptCachePrunePromise;
    const keep = scriptCacheName();
    scriptCachePrunePromise = caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith(SCRIPT_CACHE_PREFIX) && k !== keep)
            .map((k) => caches.delete(k))
        )
      )
      .catch(() => {})
      .then(() => {});
    return scriptCachePrunePromise;
  }

  async function matchScriptCache(url) {
    if (!window.caches?.match) return null;
    try {
      await pruneOldScriptCaches();
      const hit = await caches.match(url, { ignoreSearch: false });
      if (hit && hit.ok) return hit;
      const named = await caches.open(scriptCacheName());
      const exact = await named.match(url);
      return exact && exact.ok ? exact : null;
    } catch (_) {
      return null;
    }
  }

  async function putScriptCache(url, res) {
    if (!window.caches?.open || !res || !res.ok || res.type === "opaque") return;
    try {
      await pruneOldScriptCaches();
      const cache = await caches.open(scriptCacheName());
      await cache.put(url, res.clone());
    } catch (_) {
      /* private mode / quota */
    }
  }

  function loadScript(src, { timeoutMs = 60000, onProgress = null, label = "" } = {}) {
    const key = withVersion(src);
    if (loadedScriptKeys.has(key)) return Promise.resolve();
    if (typeof onProgress === "function") {
      let set = scriptProgressListeners.get(key);
      if (!set) {
        set = new Set();
        scriptProgressListeners.set(key, set);
      }
      set.add(onProgress);
    }
    if (scriptPromises.has(key)) {
      const pending = scriptPromises.get(key);
      return pending.finally(() => {
        const set = scriptProgressListeners.get(key);
        if (set && typeof onProgress === "function") {
          set.delete(onProgress);
          if (!set.size) scriptProgressListeners.delete(key);
        }
      });
    }

    const displayName = String(label || "").trim() || "脚本";
    const reportDl = (ratio, text) => {
      const r = Math.max(0, Math.min(1, Number(ratio) || 0));
      const msg = text || displayName;
      const set = scriptProgressListeners.get(key);
      if (set) {
        for (const fn of set) {
          try {
            fn(r, msg);
          } catch (_) {}
        }
      } else if (typeof onProgress === "function") {
        onProgress(r, msg);
      }
    };

    const injectFromUrl = (url, { revoke = false } = {}) =>
      new Promise((resolve, reject) => {
        const node = document.createElement("script");
        node.src = url;
        node.async = false;
        node.onload = () => {
          node.dataset.devtoolsLoaded = "1";
          try {
            node.dataset.devtoolsSrcKey = key;
          } catch (_) {}
          if (revoke) {
            try {
              URL.revokeObjectURL(url);
            } catch (_) {}
          }
          resolve();
        };
        node.onerror = () => {
          try {
            node.remove();
          } catch (_) {}
          if (revoke) {
            try {
              URL.revokeObjectURL(url);
            } catch (_) {}
          }
          reject(new Error(`脚本加载失败：${src}`));
        };
        document.head.appendChild(node);
      });

    const promise = (async () => {
      scrubStaleScriptTags(key, src);
      if (findLoadedScriptTag(key) || loadedScriptKeys.has(key)) {
        loadedScriptKeys.add(key);
        return;
      }

      let timeoutId = 0;
      const timed = new Promise((_, reject) => {
        timeoutId = window.setTimeout(() => reject(new Error(`脚本加载超时：${src}`)), timeoutMs);
      });

      try {
        // 大脚本或显式要进度：走 fetch，避免 <script src> 长时间无反馈像卡住
        const useFetchProgress =
          typeof onProgress === "function" ||
          scriptProgressListeners.get(key)?.size > 0 ||
          scriptSizeHint(src) >= 50000;
        if (useFetchProgress) {
          const runFetch = async () => {
            // 同版本优先本地 Cache（URL 含 ?v=BUILD）；发版换 v= 自然 miss 再下
            const cached = await matchScriptCache(key);
            if (cached) {
              reportDl(0.4, `${displayName} · 本地缓存`);
              const buf = await cached.arrayBuffer();
              reportDl(0.92, `${displayName}已从缓存加载 ${formatDlBytes(buf.byteLength)}，解析中…`);
              const blobUrl = URL.createObjectURL(
                new Blob([buf], { type: "application/javascript" })
              );
              await injectFromUrl(blobUrl, { revoke: true });
              return;
            }

            reportDl(0.02, `首次下载${displayName}…`);
            let res;
            try {
              // default：允许 HTTP 磁盘缓存；force-cache 在无条目时部分环境反而怪异
              res = await fetch(key, { credentials: "same-origin", cache: "default" });
            } catch (err) {
              throw new Error(`脚本下载失败：${src}（${err?.message || err}）`);
            }
            if (!res.ok) throw new Error(`脚本下载失败：${src}（HTTP ${res.status}）`);
            void putScriptCache(key, res);
            const hinted = scriptSizeHint(src);
            const totalHeader = Number(res.headers.get("content-length")) || 0;
            const total = totalHeader > 0 ? totalHeader : hinted;
            const reader = res.body?.getReader?.();
            if (!reader) {
              const buf = await res.arrayBuffer();
              reportDl(0.92, `${displayName}已下载 ${formatDlBytes(buf.byteLength)}，解析中…`);
              const blobUrl = URL.createObjectURL(
                new Blob([buf], { type: "application/javascript" })
              );
              await injectFromUrl(blobUrl, { revoke: true });
              return;
            }
            const chunks = [];
            let received = 0;
            let lastReport = 0;
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              if (value?.byteLength) {
                chunks.push(value);
                received += value.byteLength;
              }
              const now = Date.now();
              if (now - lastReport < 80 && !(total > 0 && received >= total)) continue;
              lastReport = now;
              if (total > 0) {
                reportDl(
                  Math.min(0.9, received / total),
                  `下载${displayName} ${formatDlBytes(received)}/${formatDlBytes(total)}`
                );
              } else {
                reportDl(
                  Math.min(0.85, received / Math.max(received + 1, 256 * 1024)),
                  `下载${displayName} ${formatDlBytes(received)}…`
                );
              }
            }
            reportDl(0.93, `${displayName}已下载 ${formatDlBytes(received)}，下次走缓存`);
            const blobUrl = URL.createObjectURL(
              new Blob(chunks, { type: "application/javascript" })
            );
            await injectFromUrl(blobUrl, { revoke: true });
          };
          await Promise.race([runFetch(), timed]);
        } else {
          await Promise.race([injectFromUrl(key), timed]);
        }
        loadedScriptKeys.add(key);
      } finally {
        window.clearTimeout(timeoutId);
        scriptProgressListeners.delete(key);
      }
    })().catch((err) => {
      scriptPromises.delete(key);
      loadedScriptKeys.delete(key);
      scriptProgressListeners.delete(key);
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
    const dl = (base, span, name) => (ratio, text) => {
      const r = Math.max(0, Math.min(1, Number(ratio) || 0));
      onProgress?.(base + r * span, text || name);
    };
    if (window.__devtoolsExtraCore && (!media || window.DevToolsExtraMedia)) return;
    if (extraCorePromise) {
      return extraCorePromise.then(async () => {
        // 首次以非 media 路径加载后再次需要 media（如 adb / gifmaker 等）：
        // 补齐媒体核心，避免媒体工具因缺 DevToolsExtraMedia 而卡住。
        if (media && !window.DevToolsExtraMedia) {
          onProgress?.(0.48, "下载媒体编码核心…");
          if (!window.DevToolsTemp) {
            await loadScript("./temp.js", { onProgress: dl(0.48, 0.04, "临时存储"), label: "临时存储" });
          }
          await loadScript("./lib/oss-deps.js", {
            onProgress: dl(0.52, 0.04, "依赖清单"),
            label: "依赖清单",
          });
          await loadScript("./lib/extra-media.js", {
            onProgress: dl(0.56, 0.06, "媒体核心"),
            label: "媒体核心（约 70KB）",
          });
          onProgress?.(0.62, "媒体核心已就绪");
        }
      });
    }
    extraCorePromise = (async () => {
      onProgress?.(0.1, "初始化面板绑定…");
      if (!window.DevToolsExtraBind) await loadScript("./lib/extra-bind.js");
      onProgress?.(0.22, "加载工具基础库…");
      if (!window.DevToolsExtraKit) await loadScript("./lib/extra-kit.js");
      if (!window.DevToolsDeviceNotify) await loadScript("./lib/device-notify.js");
      if (!window.__devtoolsExtraBootstrap) {
        await loadScript("./lib/extra-bootstrap.js");
        window.__devtoolsExtraBootstrap = true;
      }
      if (media) {
        onProgress?.(0.35, "下载临时存储…");
        if (!window.DevToolsTemp) {
          await loadScript("./temp.js", { onProgress: dl(0.35, 0.05, "临时存储"), label: "临时存储" });
        }
        await loadScript("./lib/oss-deps.js", {
          onProgress: dl(0.4, 0.05, "依赖清单"),
          label: "依赖清单",
        });
        onProgress?.(0.48, "下载媒体编码核心…");
        if (!window.DevToolsExtraMedia) {
          await loadScript("./lib/extra-media.js", {
            onProgress: dl(0.48, 0.12, "媒体核心"),
            label: "媒体核心（约 70KB）",
          });
        }
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
    // regulex 自带 RequireJS 并会创建全局 AMD define，其它 UMD 库会被它带崩（初始化抛错）。
    // 除 regulex 外，加载期间一律临时屏蔽 define，避免误入 AMD 分支。
    const keepAmd = id === "regulex" && !spec.noAmd;
    if (keepAmd) {
      await loadScript(spec.src);
    } else {
      const saved = window.define;
      try {
        window.define = undefined;
        await loadScript(spec.src);
      } finally {
        window.define = saved;
      }
    }
    if (!spec.probe()) throw new Error(`依赖未就绪：${id}`);
  }

  /** 黑盒/切分等面板延后加载的 gif.js + omggif；编码前调用 */
  async function ensureGifEncodeLibs() {
    await loadVendor("gif");
    await loadVendor("omggif");
  }

  function toolScriptLabel(toolId) {
    const id = String(toolId || "").trim();
    if (id === "vbb") return "黑盒 GIF 模块（约 650KB）";
    if (id === "v2g") return "视频转 GIF 模块（约 650KB）";
    if (id === "vsplit") return "视频切分模块（约 650KB）";
    if (/v2g-suite/.test(TOOL_FILES[id] || "")) return "视频套件模块（约 650KB）";
    return `${id || "工具"}模块`;
  }

  async function loadToolScript(toolId, onProgress) {
    const src = TOOL_FILES[toolId];
    if (!src) return;
    if (EXTERNAL_SITE_TOOLS.has(toolId)) {
      await loadScript("./lib/open-external-site.js");
    }
    const label = toolScriptLabel(toolId);
    const track = typeof onProgress === "function";
    await loadScript(
      src,
      track
        ? {
            label,
            onProgress: (ratio, text) => onProgress(Math.max(0, Math.min(1, Number(ratio) || 0)), text || label),
          }
        : {}
    );
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
    jsQR: "扫码库(QR)",
    zxing: "扫码库(ZXing)",
    mqtt: "MQTT 库",
    html2canvas: "截图库",
    gif: "GIF 编码库",
    omggif: "GIF 解码库",
    solarlunar: "农历库",
    jsonrepair: "JSON 修复库",
    regulex: "正则结构图库",
    leaflet: "地图库 Leaflet",
    markdownit: "Markdown 解析库",
    purify: "HTML 净化库",
    hljs: "代码高亮库",
    cm6: "编辑器（CodeMirror）",
    katexmd: "数学公式（KaTeX）",
    mermaid: "图表（Mermaid）",
    jszip: "ZIP 打包库",
    turndown: "富文本转 Markdown",
    mdext: "Markdown 扩展（脚注/定义列表）",
  };

  async function ensureForTool(toolId, opts = {}) {
    const id = String(toolId || "").trim();
    if (!id) return;
    // 注意：不再把 isForceFreshLoad 当成每次 ensure 的 force——?_fresh 只影响首次拉网，
    // 本会话 readyTools / loadedScriptKeys 仍应复用，否则每次进面板都全量走进度条。
    const force = Boolean(opts.force);
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
    const report = (ratio, label) => onProgress?.(Math.max(0, Math.min(1, Number(ratio) || 0)), label);

    if (!force && readyTools.has(id)) {
      if (id === "memo" && !window.DevToolsMemo) {
        readyTools.delete("memo");
        bustToolScript(TOOL_FILES.memo);
      } else if (id === "lanboard" && !window.DevToolsLanBoard) {
        readyTools.delete("lanboard");
        bustToolScript(TOOL_FILES.lanboard);
      } else {
        report(1, "已缓存");
        return;
      }
    }

    // 依赖已在内存：静默标记，避免重复进度条
    if (!force && isToolWarm(id)) {
      markToolReady(id);
      report(1, "已缓存");
      return;
    }

    let run = ensureInflight.get(id);
    if (!force && run) {
      await run;
      report(1, "已缓存");
      return;
    }

    run = (async () => {
    if (id === "about") {
      report(0.2, "加载关于页…");
      await loadScript("./about.js");
      report(1, "关于页已就绪");
      markToolReady(id);
      return;
    }
    if (id === "diff") {
      report(0.2, "加载文本比对…");
      await loadDiffBundle();
      report(1, "文本比对已就绪");
      markToolReady(id);
      return;
    }

    if (!NO_PURE.has(id)) {
      report(0.08, "下载计算核心…");
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
      report(0.74 + (i / Math.max(1, vendors.length)) * 0.18, `下载${name}…`);
      await loadVendor(vendorId);
    }

    if (id === "healthread") {
      const v = encodeURIComponent(BUILD);
      fetch(`./lib/health-articles/index.json?v=${v}`).catch(() => {});
    }

    if (TOOL_FILES[id]) {
      const modLabel = toolScriptLabel(id);
      report(0.9, `准备下载${modLabel}…`);
      if (id === "qrcode") {
        await loadScript("./lib/qr-series.js");
        await loadScript("./lib/code-scan.js");
      }
      if (id === "apidebug") {
        await loadScript("./lib/diff-core.js").catch(() => {});
        await loadScript("./lib/pure.js").catch(() => {});
        await loadScript("./lib/apidebug-pure.js");
        try {
          await window.DevToolsPanels?.ensure?.(id);
        } catch (_) {}
      }
      if (id === "forcepurge" || id === "fileunlock") {
        try {
          await window.DevToolsPanels?.ensure?.(id);
        } catch (_) {}
      }
      // 备忘录 / 局域网看板：必须先有面板节点，否则脚本会空跑且不再初始化
      if (id === "memo" || id === "lanboard") {
        try {
          await window.DevToolsPanels?.ensure?.(id);
        } catch (_) {}
        if (id === "memo" && scriptLikelyLoaded(TOOL_FILES.memo) && !window.DevToolsMemo) {
          bustToolScript(TOOL_FILES.memo);
          readyTools.delete("memo");
        }
        if (id === "lanboard" && scriptLikelyLoaded(TOOL_FILES.lanboard) && !window.DevToolsLanBoard) {
          bustToolScript(TOOL_FILES.lanboard);
          readyTools.delete("lanboard");
        }
      }
      await loadToolScript(id, (ratio, text) => report(0.9 + ratio * 0.09, text || modLabel));
      if (id === "memo" && !window.DevToolsMemo) {
        // 仍未挂上：再强制重载一次（面板已在 DOM）
        bustToolScript(TOOL_FILES.memo);
        readyTools.delete("memo");
        await loadToolScript(id, (ratio, text) => report(0.9 + ratio * 0.09, text || modLabel));
      }
      if (id === "lanboard" && !window.DevToolsLanBoard) {
        bustToolScript(TOOL_FILES.lanboard);
        readyTools.delete("lanboard");
        await loadToolScript(id, (ratio, text) => report(0.9 + ratio * 0.09, text || modLabel));
      }
    }
    report(1, "工具已就绪 · 不是卡住");
    // 空跑脚本勿标 ready，否则下次进面板会误判已缓存又立刻 bust 重拉
    if (id === "memo" && !window.DevToolsMemo) return;
    if (id === "lanboard" && !window.DevToolsLanBoard) return;
    markToolReady(id);
    })();

    if (!force) ensureInflight.set(id, run);
    try {
      await run;
    } finally {
      if (ensureInflight.get(id) === run) ensureInflight.delete(id);
    }
  }

  /** 空闲预取：不弹进度条；失败静默 */
  let prefetchChain = Promise.resolve();
  function prefetchTool(toolId) {
    const id = String(toolId || "").trim();
    if (!id || readyTools.has(id) || isToolWarm(id)) return prefetchChain;
    prefetchChain = prefetchChain
      .then(async () => {
        if (readyTools.has(id) || isToolWarm(id)) return;
        try {
          await window.DevToolsPanels?.ensure?.(id);
        } catch (_) {
          /* panel html optional */
        }
        try {
          await ensureForTool(id, { force: false });
        } catch (_) {
          /* ignore prefetch errors */
        }
      })
      .catch(() => {});
    return prefetchChain;
  }

  function prefetchTools(ids, { limit = 6 } = {}) {
    const list = [...new Set((ids || []).map((x) => String(x || "").trim()).filter(Boolean))];
    const todo = list.filter((id) => !readyTools.has(id) && !isToolWarm(id)).slice(0, Math.max(0, limit));
    for (const id of todo) prefetchTool(id);
    return prefetchChain;
  }

  window.DevToolsLazy = {
    BUILD,
    ensureForTool,
    isToolReady,
    isToolWarm,
    clearReadyTools,
    prefetchTool,
    prefetchTools,
    loadExtraBundle,
    loadExtraCore,
    loadVendor,
    ensureGifEncodeLibs,
    loadToolScript,
    loadScript,
    loadPwa,
  };
})();
