(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;

  const M = window.DevToolsExtraMedia || {};
  const {
    mergeGifBlobs, compressGifBlob, getFfmpegInstance, ensureFfmpegAssets, fetchFileBytes,
    ensureFfmpegInputWritten, loadGifsicle, buildGifCompressArgs, buildBlackboxSoftCompressArgs,
    buildBlackboxHardCompressArgs, gifCompressSummary, readGifWatermarkOptions, drawGifTextWatermark,
    encodeAnimatedWebpFromStillFrames, isAutoPackZipEnabled, setAutoPackZipEnabled, syncAutoPackZipToggles,
    bindAutoPackZipToggles, canEncodeStillWebp, gifQualityToWebpQuality, gifQualityToMaxColors,
    terminateFfmpegInstance, paintFfmpegWarmHint, prewarmFfmpegEngine, TOOLS_VERSION, GIF_TOOL_VERSION,
    AUTO_PACK_ZIP_KEY,
  } = M;
  const formatLocalPickMeta = K.formatLocalPickMeta;
  const attachLocalVideoPreview = K.attachLocalVideoPreview;
  const waitVideoMetadata = K.waitVideoMetadata;

    try {
      let jsZipLoadPromise = null;
      async function ensureJsZip() {
        if (typeof globalThis.JSZip === "function") return globalThis.JSZip;
        if (!jsZipLoadPromise) {
          jsZipLoadPromise = new Promise((resolve, reject) => {
            const done = () => {
              if (typeof globalThis.JSZip === "function") resolve(globalThis.JSZip);
              else reject(new Error("JSZip 未加载，无法打包下载"));
            };
            const timer = setTimeout(() => reject(new Error("JSZip 加载超时，请刷新页面后重试")), 20000);
            const finish = (fn) => {
              clearTimeout(timer);
              fn();
            };
            const existing = document.querySelector('script[src*="jszip"]');
            if (existing) {
              if (typeof globalThis.JSZip === "function") {
                clearTimeout(timer);
                resolve(globalThis.JSZip);
                return;
              }
              if (existing.readyState === "complete" || existing.readyState === "loaded") {
                queueMicrotask(() => finish(done));
                return;
              }
              existing.addEventListener("load", () => finish(done), { once: true });
              existing.addEventListener("error", () => finish(() => reject(new Error("JSZip 脚本加载失败"))), {
                once: true,
              });
              return;
            }
            const s = document.createElement("script");
            s.src = "./vendor/jszip.min.js";
            s.onload = () => finish(done);
            s.onerror = () => finish(() => reject(new Error("JSZip 脚本加载失败")));
            document.head.appendChild(s);
          });
        }
        return jsZipLoadPromise;
      }
  
      let adbBundleBusy = false;
      let adbBridgeShell = null;

      function adbBundleButtons() {
        return ["#adb-dl-mac", "#adb-dl-win", "#adb-dl-linux"].map((sel) => $(sel)).filter(Boolean);
      }

      function setAdbBundleProgress(visible, { pct = 0, text = "" } = {}) {
        if (adbBridgeShell?.setProgress) {
          adbBridgeShell.setProgress(visible, { pct, text });
          adbBundleButtons().forEach((btn) => {
            btn.disabled = visible;
            btn.setAttribute("aria-busy", visible ? "true" : "false");
          });
          return;
        }
        const box = $("#adb-dl-progress");
        const fill = $("#adb-dl-progress-fill");
        const title = $("#adb-dl-progress-text");
        const pctEl = $("#adb-dl-progress-pct");
        const clamped = Math.max(0, Math.min(100, Number(pct) || 0));
        if (box) box.hidden = !visible;
        if (title) title.textContent = text || "准备下载包…";
        if (pctEl) pctEl.textContent = `${Math.round(clamped)}%`;
        if (fill) {
          fill.style.width = `${clamped}%`;
          fill.classList.toggle("is-busy", visible && clamped < 100);
          fill.classList.toggle("is-active", visible && clamped < 100);
        }
        adbBundleButtons().forEach((btn) => {
          btn.disabled = visible;
          btn.setAttribute("aria-busy", visible ? "true" : "false");
        });
      }
  
      const ADB_STORE_BASE = "devtools-adb-base";
      const ADB_STORE_TOKEN = "devtools-adb-token";
      const ADB_FS_ROOTS_HINT_HTML =
        "对标桌面文件管理器：双栏互拖、拖入上传；文件夹优先桥端打包。Delete / F2 / Ctrl+A。「内部存储」= /storage/emulated/0。";
      let adbBaseInput;
      let adbTokenInput;
      let adbDot;
      let adbStatusTitle;
      let adbStatusText;
      let adbError;
      let adbSetupGuide;
      let adbSetupGuideDismiss;
      const ADB_SETUP_GUIDE_HIDDEN_KEY = "devtools-adb-setup-guide-hidden-v1";
  
      function isAdbSetupGuideHidden() {
        try {
          return localStorage.getItem(ADB_SETUP_GUIDE_HIDDEN_KEY) === "1";
        } catch (_) {
          return false;
        }
      }
  
      function syncAdbSetupGuide() {
        if (!adbSetupGuide) return;
        adbSetupGuide.hidden = isAdbSetupGuideHidden();
        syncAdbSetupGuideShowBtn();
      }
  
      function dismissAdbSetupGuide() {
        try {
          localStorage.setItem(ADB_SETUP_GUIDE_HIDDEN_KEY, "1");
        } catch (_) {}
        syncAdbSetupGuide();
      }

      function showAdbSetupGuide() {
        try {
          localStorage.removeItem(ADB_SETUP_GUIDE_HIDDEN_KEY);
        } catch (_) {}
        syncAdbSetupGuide();
      }

      function syncAdbSetupGuideShowBtn() {
        const btn = $("#adb-setup-guide-show");
        if (btn) btn.hidden = !isAdbSetupGuideHidden();
      }
  
      syncAdbSetupGuide();
  
      let adbWorkspace;
      let adbDeviceList;
      let adbDeviceMeta;
      let adbSelectedMeta;
      let adbFsList;
      let adbFsPath;
      let adbFsMeta;
      let adbInfoMeta;
      let adbAppsList;
      let adbAppsMeta;
      let adbJobsList;
      let adbJobsMeta;
      let adbInstallMeta;
      let adbApkName;
      let adbConnected = false;
      let adbDevices = [];
      let adbSelected = "";
      let adbChecked = new Set();
      let adbPollTimer = 0;
      let adbJobTimer = 0;
      let adbLogLiveTimer = 0;
      let adbApps = [];
      let adbJobs = [];
      let adbApkFile = null;
      let adbApkUploadId = "";
      let adbApkInfo = null;
      let adbFsSelected = "";
      let adbBridgeFeatures = [];
      let adbBridgeVersion = "";
      let adbFsChecked = new Map(); // path -> { path, name, isDir }
      let adbFsClipboard = null; // { mode: 'cut'|'copy', items: [{path, name}] }
      let adbFsPreviewUrl = "";
      let adbFsPreviewToken = 0;
      let adbFsEntriesCache = [];
      let adbFsPathCache = "/";
      let adbFsSortKey = "name"; // name | size | date
      let adbFsSortDir = 1; // 1 asc, -1 desc
      let adbFsXferBusy = false;
      let adbFsXferAbort = null; // AbortController for current transfer (upload/download/zip)
      let adbFsHistory = [];
      let adbFsHistIdx = -1;
      let adbFsDirWritable = true;
      const ADB_STORE_FSVIEW = "devtools-adb-fs-view";
      const ADB_STORE_LOCAL_PATH = "devtools-adb-local-path";
      let adbFsView = "list"; // list | grid
      let adbFsThumbUrls = []; // blob URLs to revoke on next repaint
      const ADB_FS_THUMB_MAX = 2 * 1024 * 1024;
      let adbLocalRoots = [];
      let adbLocalPath = "";
      let adbLocalEntries = [];
      let adbLocalChecked = new Map(); // path -> { path, name, isDir }
      let adbLocalBusy = false;
      let adbFsPreview;
      let adbFsPreviewTitle;
      let adbFsPreviewMeta;
      let adbFsPreviewBody;
      let adbFsBatch;
      let adbFsBatchMeta;
      const ADB_PREVIEW_IMAGE_MAX = 12 * 1024 * 1024;
      const ADB_PREVIEW_TEXT_MAX = 1.5 * 1024 * 1024;
      const ADB_PREVIEW_MEDIA_MAX = 28 * 1024 * 1024;
      let adbInputShotUrl = "";
      let adbInputLive = false;
      let adbInputLiveTimer = 0;
      /** @type {"" | "shot" | "live" | "mirror"} */
      let adbInputPreviewMode = "";
      let adbInputRefreshBusy = false;
      let adbInputRefreshAfter = false;
      let adbMirrorWs = null;
      let adbMirrorDecoder = null;
      let adbMirrorMeta = null;
      let adbMirrorPendingConfig = null;
      /** Annex-B SPS/PPS；configure 不带 description，关键帧前拼上 */
      let adbMirrorParamSets = null;
      let adbMirrorStarting = false;
      let adbMirrorFrameTs = 0;
      let adbMirrorNeedKey = false;
      let adbMirrorGotFrame = false;
      let adbMirrorWaitTimer = 0;
      let adbMirrorPkt = { config: 0, key: 0, delta: 0, decoded: 0 };
      /** @type {"prefer-hardware" | "prefer-software" | "no-preference"} */
      let adbMirrorHwPref = "prefer-hardware";
      let adbMirrorSoftTried = false;
      /** @type {Uint8Array|null} */
      let adbMirrorLastKeyData = null;
      /** @type {AudioDecoder|null} */
      let adbMirrorAudioDecoder = null;
      let adbMirrorAudioTs = 0;
      /** @type {AudioContext|null} */
      let adbMirrorAudioCtx = null;
      let adbMirrorAudioNext = 0;
      /** @type {MediaRecorder|null} */
      let adbMirrorLocalRec = null;
      let adbMirrorLocalChunks = [];
      let adbMirrorDisplayOff = false;
      const ADB_STORE_MIRROR_QUALITY = "devtools-adb-mirror-quality";
      const ADB_STORE_MIRROR_AUDIO = "devtools-adb-mirror-audio";
      const ADB_STORE_MIRROR_TOUCHES = "devtools-adb-mirror-touches";

      function sendMirrorCtrl(obj) {
        if (!adbMirrorWs || adbMirrorWs.readyState !== 1 || !adbMirrorMeta?.control) return false;
        try {
          adbMirrorWs.send(JSON.stringify(obj));
          return true;
        } catch {
          return false;
        }
      }

      function updateMirrorPowerUi() {
        const offBtn = $("#adb-mirror-power-off");
        const onBtn = $("#adb-mirror-power-on");
        const notifBtn = $("#adb-mirror-notif");
        const live = Boolean(adbMirrorWs && adbMirrorWs.readyState === 1 && adbMirrorMeta?.control);
        if (offBtn) offBtn.disabled = !live || adbMirrorDisplayOff;
        if (onBtn) onBtn.disabled = !live || !adbMirrorDisplayOff;
        if (notifBtn) notifBtn.disabled = !live;
      }

      function restoreMirrorOptions() {
        try {
          const q = localStorage.getItem(ADB_STORE_MIRROR_QUALITY);
          if (q && $("#adb-mirror-quality")) $("#adb-mirror-quality").value = q;
          const a = localStorage.getItem(ADB_STORE_MIRROR_AUDIO);
          if ($("#adb-mirror-audio") && a != null) $("#adb-mirror-audio").checked = a === "1";
          const t = localStorage.getItem(ADB_STORE_MIRROR_TOUCHES);
          if ($("#adb-mirror-show-touches") && t != null) $("#adb-mirror-show-touches").checked = t === "1";
        } catch {
          /* ignore */
        }
      }

      function persistMirrorOptions() {
        try {
          localStorage.setItem(ADB_STORE_MIRROR_QUALITY, $("#adb-mirror-quality")?.value || "balanced");
          localStorage.setItem(ADB_STORE_MIRROR_AUDIO, $("#adb-mirror-audio")?.checked ? "1" : "0");
          localStorage.setItem(ADB_STORE_MIRROR_TOUCHES, $("#adb-mirror-show-touches")?.checked ? "1" : "0");
        } catch {
          /* ignore */
        }
      }
      let adbInputRecordJobId = "";
      let adbInputRecordPoll = 0;
      const ADB_STORE_INPUT_SHOT_VH = "devtools-adb-input-shot-vh";
      const ADB_INPUT_SHOT_VH_DEFAULT = 56;
      let adbTab = "info";
      let adbPermPackage = "";
      let adbLogLive = false;
      let adbTrackedJobs = new Set(); // jobs shown inline on current panels
      let adbPerfTimer = 0;
      let adbPerfHistory = []; // { t, cpu, mem, fps }
      let adbProcList = [];
      /** @type {{ id: string, ws: WebSocket|null, buf: string, title: string }[]} */
      let adbShellSessions = [];
      let adbShellActive = "";
      let adbLayoutNodes = [];
      let adbLayoutXml = "";
      let adbLayoutSelected = -1;
  
      function normalizeAdbBase(raw) {
        let base = String(raw || "http://127.0.0.1:17888").trim().replace(/\/+$/, "");
        if (!/^https?:\/\//i.test(base)) base = `http://${base}`;
        return base;
      }
  
      function adbBase() {
        return normalizeAdbBase(adbBaseInput?.value || "http://127.0.0.1:17888");
      }
  
      function adbToken() {
        return String(adbTokenInput?.value || "devtools-bridge");
      }
  
      function sanitizeAppLabel(label) {
        const t = String(label || "").trim();
        if (!t || /^null$/i.test(t) || /^undefined$/i.test(t)) return "";
        return t;
      }
  
      function appDisplayLabel(app) {
        const label = sanitizeAppLabel(app?.label);
        const pkg = String(app?.packageName || "").trim();
        return label && label !== pkg ? label : pkg;
      }
  
      function adbMirrorWsUrl(serial) {
        let base = adbBase();
        if (/^https:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(base)) {
          base = base.replace(/^https:/i, "http:");
        }
        const wsBase = base.startsWith("https://")
          ? base.replace(/^https:\/\//i, "wss://")
          : base.replace(/^http:\/\//i, "ws://");
        const quality = $("#adb-mirror-quality")?.value || "balanced";
        const audio = $("#adb-mirror-audio")?.checked ? "1" : "0";
        const showTouches = $("#adb-mirror-show-touches")?.checked ? "1" : "0";
        const extra = `&quality=${encodeURIComponent(quality)}&audio=${audio}&show_touches=${showTouches}`;
        return `${wsBase}/mirror/ws?serial=${encodeURIComponent(serial)}&token=${encodeURIComponent(adbToken())}${extra}`;
      }
  
      function setInputDropHintVisible(visible) {
        const wrap = $("#adb-input-shot-wrap");
        const dropHint = $("#adb-input-drop-hint");
        if (wrap) wrap.classList.toggle("is-drop-target", Boolean(visible));
        if (dropHint) dropHint.hidden = !visible;
      }
  
      function persistAdbSettings() {
        try {
          localStorage.setItem(ADB_STORE_BASE, adbBase());
          const token = adbToken();
          if (window.devtoolsBridgeToken?.write) window.devtoolsBridgeToken.write(token);
          else localStorage.setItem(ADB_STORE_TOKEN, token);
        } catch (_) {
          /* ignore */
        }
      }
  
      function restoreAdbSettings() {
        try {
          const base = localStorage.getItem(ADB_STORE_BASE);
          const sharedToken = window.devtoolsBridgeToken?.read?.();
          const token = localStorage.getItem(ADB_STORE_TOKEN);
          if (base && adbBaseInput) adbBaseInput.value = normalizeAdbBase(base);
          if (adbTokenInput) adbTokenInput.value = sharedToken || token || adbTokenInput.value || "devtools-bridge";
          const view = localStorage.getItem(ADB_STORE_FSVIEW);
          if (view === "grid" || view === "list") adbFsView = view;
        } catch (_) {
          /* ignore */
        }
      }
  
      function setAdbStatus(kind, title, text) {
        if (adbBridgeShell?.setStatus) {
          adbBridgeShell.setStatus(kind, title, text);
          return;
        }
        if (adbDot) {
          adbDot.classList.remove("is-ok", "is-warn", "is-err");
          if (kind) adbDot.classList.add(kind);
        }
        if (adbStatusTitle) adbStatusTitle.textContent = title;
        if (adbStatusText) adbStatusText.textContent = text;
      }
  
      function formatBytes(n) {
        const num = Number(n);
        if (!Number.isFinite(num)) return "";
        if (num < 1024) return `${num} B`;
        if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
        if (num < 1024 * 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)} MB`;
        return `${(num / (1024 * 1024 * 1024)).toFixed(2)} GB`;
      }
  
      function joinRemote(dir, name) {
        const baseRaw = String(dir || "/");
        const base = baseRaw === "/" ? "" : baseRaw.replace(/\/+$/, "");
        return `${base}/${String(name || "").replace(/^\/+/, "")}` || "/";
      }
  
      function basenameRemote(remotePath) {
        const p = String(remotePath || "").replace(/\/+$/, "");
        const idx = p.lastIndexOf("/");
        return idx >= 0 ? p.slice(idx + 1) : p;
      }
  
      function checkedSerials() {
        return [...adbChecked];
      }
  
      function targetSerials(preferChecked) {
        const list = preferChecked ? checkedSerials() : [];
        if (list.length) return list;
        return adbSelected ? [adbSelected] : [];
      }
  
      function updateSelectedMeta() {
        if (!adbSelectedMeta) return;
        const n = adbChecked.size;
        adbSelectedMeta.textContent = adbSelected
          ? `当前：${adbSelected}${n ? ` · 已勾选 ${n} 台` : " · 未勾选批量设备"}`
          : "请选择当前设备；勾选用于批量安装与截图";
        if (adbInstallMeta) {
          adbInstallMeta.textContent = n
            ? `将安装到勾选的 ${n} 台设备`
            : adbSelected
              ? `未勾选时，「安装到勾选设备」会回退到当前设备`
              : "请先选择设备";
        }
      }
  
      async function adbFetch(pathname, options = {}) {
        const headers = Object.assign({}, options.headers || {});
        if (options.auth !== false) {
          const t = adbToken();
          headers["X-Adb-Token"] = t;
          headers["X-Ffmpeg-Token"] = t;
        }
        const res = await fetch(`${adbBase()}${pathname}`, {
          ...options,
          headers,
          cache: "no-store",
        });
        const type = res.headers.get("content-type") || "";
        if (type.includes("application/json")) {
          const data = await res.json();
          if (!res.ok || data.ok === false) {
            throw new Error(data.error || `请求失败 (${res.status})`);
          }
          return data;
        }
        if (!res.ok) {
          let msg = `请求失败 (${res.status})`;
          try {
            const data = await res.json();
            if (data?.error) msg = data.error;
          } catch (_) {
            /* ignore */
          }
          throw new Error(msg);
        }
        return res;
      }
  
      function requireCurrentSerial() {
        if (!adbSelected) throw new Error("请先选择当前设备");
        return adbSelected;
      }
  
      function switchAdbTab(tab) {
        const prev = adbTab;
        adbTab = tab;
        $$(".adb-tab[data-adb-tab]").forEach((btn) => {
          btn.classList.toggle("is-active", btn.dataset.adbTab === tab);
        });
        $$("[data-adb-panel]").forEach((panel) => {
          panel.hidden = panel.dataset.adbPanel !== tab;
        });
        if (prev === "logcat" && tab !== "logcat") stopAdbLogLive();
        if (prev === "input" && tab !== "input") stopInputLivePreview();
        if (prev === "perf" && tab !== "perf") stopAdbPerf();
        if (tab === "apps" && adbSelected && !adbApps.length) loadApps().catch(() => {});
        if (tab === "jobs") refreshJobs().catch(() => {});
        if (tab === "info" && adbSelected) loadSnapshot({ silent: true }).catch(() => {});
        if (tab === "network" && adbSelected) {
          refreshProxy({ silent: true }).catch(() => {});
          refreshForwards({ silent: true }).catch(() => {});
        }
        if (tab === "developer" && adbSelected) refreshDeveloper({ silent: true }).catch(() => {});
        if (tab === "procs" && adbSelected) refreshProcesses().catch(() => {});
        if (tab === "layout" && adbSelected && !adbLayoutNodes.length) {
          /* wait for user dump */
        }
        if (tab === "shell") renderShellTabs();
      }

      function canDeviceInspect() {
        return (
          bridgeHas("device-perf") ||
          bridgeHas("device-processes") ||
          bridgeHas("device-shell") ||
          bridgeHas("device-layout") ||
          bridgeAtLeast("0.9.0")
        );
      }

      function stopAdbPerf() {
        if (adbPerfTimer) {
          clearInterval(adbPerfTimer);
          adbPerfTimer = 0;
        }
        const stopBtn = $("#adb-perf-stop");
        const startBtn = $("#adb-perf-start");
        if (stopBtn) stopBtn.hidden = true;
        if (startBtn) startBtn.hidden = false;
      }

      function drawPerfChart() {
        const canvas = $("#adb-perf-chart");
        if (!canvas) return;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("--ink") || "#888";
        ctx.globalAlpha = 0.08;
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = 1;
        const series = [
          { key: "cpu", color: "#5b8cff" },
          { key: "mem", color: "#3ecf8e" },
          { key: "fps", color: "#f5a524", scale: 120 },
        ];
        const hist = adbPerfHistory.slice(-60);
        if (hist.length < 2) return;
        for (const s of series) {
          ctx.beginPath();
          ctx.strokeStyle = s.color;
          ctx.lineWidth = 1.5;
          hist.forEach((pt, i) => {
            const x = (i / (hist.length - 1)) * (w - 8) + 4;
            let v = Number(pt[s.key]) || 0;
            if (s.scale) v = Math.min(100, (v / s.scale) * 100);
            const y = h - 4 - (Math.max(0, Math.min(100, v)) / 100) * (h - 8);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          });
          ctx.stroke();
        }
      }

      function renderPerfSample(data) {
        const cpu = data?.cpu?.avgPct;
        const mem = data?.memory;
        const fps = data?.fps;
        const temp = data?.temperatureC;
        if ($("#adb-perf-cpu")) $("#adb-perf-cpu").textContent = cpu == null ? "—" : `${cpu}%`;
        if ($("#adb-perf-mem")) {
          $("#adb-perf-mem").textContent = mem?.totalKb
            ? `${formatBytes((mem.usedKb || 0) * 1024)} / ${formatBytes(mem.totalKb * 1024)} (${Math.round(
                (mem.usedRatio || 0) * 100
              )}%)`
            : "—";
        }
        if ($("#adb-perf-fps")) $("#adb-perf-fps").textContent = fps == null ? "—" : String(fps);
        if ($("#adb-perf-temp")) $("#adb-perf-temp").textContent = temp == null ? "—" : `${temp}°C`;
        if ($("#adb-perf-fg")) {
          $("#adb-perf-fg").textContent = `前台：${data?.foreground || "—"}`;
        }
        const coresEl = $("#adb-perf-cores");
        if (coresEl) {
          const cores = data?.cpu?.cores || [];
          coresEl.innerHTML = cores
            .map((c) => `<span class="adb-perf-core">${escapeHtml(c.id)} ${c.loadPct}%</span>`)
            .join("");
        }
        adbPerfHistory.push({
          t: Date.now(),
          cpu: Number(cpu) || 0,
          mem: Math.round((mem?.usedRatio || 0) * 100),
          fps: Number(fps) || 0,
        });
        if (adbPerfHistory.length > 90) adbPerfHistory = adbPerfHistory.slice(-90);
        drawPerfChart();
        if ($("#adb-perf-meta")) {
          $("#adb-perf-meta").textContent = `已采样 ${adbPerfHistory.length} 点 · 桥 ${adbBridgeVersion || "?"}`;
        }
      }

      async function samplePerfOnce() {
        if (!canDeviceInspect() && adbBridgeVersion) {
          throw new Error("性能监控需桥 ≥0.9.0，请重新下载完整 ZIP 并重启桥");
        }
        const serial = requireCurrentSerial();
        const data = await adbFetch(`/device/perf?serial=${encodeURIComponent(serial)}&period=200`);
        renderPerfSample(data);
        return data;
      }

      function startAdbPerf() {
        stopAdbPerf();
        const interval = Math.max(500, Math.min(5000, Number($("#adb-perf-interval")?.value) || 1000));
        const stopBtn = $("#adb-perf-stop");
        const startBtn = $("#adb-perf-start");
        if (stopBtn) stopBtn.hidden = false;
        if (startBtn) startBtn.hidden = true;
        samplePerfOnce().catch((err) => setError(adbError, err.message || String(err)));
        adbPerfTimer = setInterval(() => {
          if (adbTab !== "perf") {
            stopAdbPerf();
            return;
          }
          samplePerfOnce().catch((err) => setError(adbError, err.message || String(err)));
        }, interval);
      }

      function renderProcesses(list) {
        const body = $("#adb-procs-body");
        if (!body) return;
        if (!list.length) {
          body.innerHTML = `<tr><td colspan="5" class="hint">无匹配进程</td></tr>`;
          return;
        }
        body.innerHTML = list
          .map((p) => {
            const pkgGuess = String(p.name || "").includes(".") ? String(p.name).split(/\s+/)[0] : "";
            return `<tr>
              <td class="mono">${p.pid}</td>
              <td class="mono">${escapeHtml(p.user || "")}</td>
              <td class="mono">${p.rssKb ? formatBytes(p.rssKb * 1024) : "—"}</td>
              <td class="adb-procs-name">${escapeHtml(p.name || "")}</td>
              <td>
                <button type="button" class="ghost-btn" data-adb-kill-pid="${p.pid}">结束</button>
                ${
                  pkgGuess && /^[A-Za-z0-9._]+$/.test(pkgGuess)
                    ? `<button type="button" class="ghost-btn" data-adb-force-stop="${escapeHtml(pkgGuess)}">强停</button>`
                    : ""
                }
              </td>
            </tr>`;
          })
          .join("");
      }

      async function refreshProcesses() {
        if (!canDeviceInspect() && adbBridgeVersion) {
          throw new Error("进程列表需桥 ≥0.9.0，请重新下载完整 ZIP 并重启桥");
        }
        const serial = requireCurrentSerial();
        const q = ($("#adb-procs-query")?.value || "").trim();
        const params = new URLSearchParams({ serial, limit: "500" });
        if (q) params.set("query", q);
        const data = await adbFetch(`/device/processes?${params.toString()}`);
        adbProcList = data.processes || [];
        renderProcesses(adbProcList);
        if ($("#adb-procs-meta")) {
          $("#adb-procs-meta").textContent = `${adbProcList.length} 个${data.truncated ? "+" : ""} · 桥 ${
            adbBridgeVersion || "?"
          }`;
        }
      }

      function shellWsUrl(serial) {
        const base = adbBase().replace(/^http/i, (m) => (m.toLowerCase() === "https" ? "wss" : "ws"));
        return `${base}/shell/ws?serial=${encodeURIComponent(serial)}&token=${encodeURIComponent(adbToken())}`;
      }

      function renderShellTabs() {
        const el = $("#adb-shell-tabs");
        if (!el) return;
        if (!adbShellSessions.length) {
          el.innerHTML = `<span class="hint tight">尚无会话，点「新建会话」</span>`;
          return;
        }
        el.innerHTML = adbShellSessions
          .map(
            (s) =>
              `<button type="button" class="adb-shell-tab${s.id === adbShellActive ? " is-active" : ""}" data-adb-shell-id="${s.id}">${escapeHtml(
                s.title
              )}</button>`
          )
          .join("");
      }

      function activeShell() {
        return adbShellSessions.find((s) => s.id === adbShellActive) || null;
      }

      function renderShellOut() {
        const out = $("#adb-shell-out");
        if (!out) return;
        const s = activeShell();
        out.textContent = s ? s.buf : "";
        out.scrollTop = out.scrollHeight;
      }

      function appendShell(id, text) {
        const s = adbShellSessions.find((x) => x.id === id);
        if (!s) return;
        s.buf += text;
        if (s.buf.length > 200000) s.buf = s.buf.slice(-160000);
        if (id === adbShellActive) renderShellOut();
      }

      function closeShellSession(id) {
        const idx = adbShellSessions.findIndex((s) => s.id === id);
        if (idx < 0) return;
        const s = adbShellSessions[idx];
        try {
          if (s.ws && s.ws.readyState <= 1) {
            s.ws.send(JSON.stringify({ type: "close" }));
            s.ws.close();
          }
        } catch {
          /* ignore */
        }
        adbShellSessions.splice(idx, 1);
        if (adbShellActive === id) {
          adbShellActive = adbShellSessions[0]?.id || "";
        }
        renderShellTabs();
        renderShellOut();
      }

      function openShellSession() {
        if (!canDeviceInspect() && adbBridgeVersion) {
          throw new Error("交互 Shell 需桥 ≥0.9.0，请重新下载完整 ZIP 并重启桥");
        }
        const serial = requireCurrentSerial();
        const id = `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const title = `会话 ${adbShellSessions.length + 1}`;
        const session = { id, ws: null, buf: "", title };
        adbShellSessions.push(session);
        adbShellActive = id;
        renderShellTabs();
        renderShellOut();
        const ws = new WebSocket(shellWsUrl(serial));
        session.ws = ws;
        ws.addEventListener("open", () => appendShell(id, "[connected]\n"));
        ws.addEventListener("message", (ev) => {
          try {
            const msg = JSON.parse(String(ev.data || ""));
            if (msg.type === "data") appendShell(id, msg.data || "");
            else if (msg.type === "ready") appendShell(id, `[ready ${msg.sessionId || ""}]\n`);
            else if (msg.type === "error") appendShell(id, `\n[error] ${msg.error || ""}\n`);
            else if (msg.type === "exit") appendShell(id, `\n[exit code=${msg.code}]\n`);
            else appendShell(id, String(ev.data || ""));
          } catch {
            appendShell(id, String(ev.data || ""));
          }
        });
        ws.addEventListener("close", () => appendShell(id, "\n[disconnected]\n"));
        ws.addEventListener("error", () => appendShell(id, "\n[ws error]\n"));
        if ($("#adb-shell-meta")) {
          $("#adb-shell-meta").textContent = `WebSocket · ${serial} · 桥 ${adbBridgeVersion || "?"}`;
        }
      }

      function sendShellInput(raw, addNewline = true) {
        const s = activeShell();
        if (!s?.ws || s.ws.readyState !== 1) throw new Error("当前会话未连接");
        const data = addNewline && !String(raw).endsWith("\n") ? `${raw}\n` : String(raw);
        s.ws.send(JSON.stringify({ type: "stdin", data }));
        appendShell(s.id, data.startsWith("\n") ? data : data);
      }

      function renderLayoutTree(filter = "") {
        const tree = $("#adb-layout-tree");
        if (!tree) return;
        const q = String(filter || "").trim().toLowerCase();
        const list = !q
          ? adbLayoutNodes
          : adbLayoutNodes.filter((n) => {
              const hay = `${n.text} ${n.resourceId} ${n.class} ${n.contentDesc} ${n.package}`.toLowerCase();
              return hay.includes(q);
            });
        if (!list.length) {
          tree.innerHTML = `<div class="hint" style="padding:0.5rem">无节点</div>`;
          return;
        }
        tree.innerHTML = list
          .slice(0, 800)
          .map((n) => {
            const label = [
              n.class?.split(".").pop() || "node",
              n.text ? `"${n.text.slice(0, 40)}"` : "",
              n.resourceId ? `#${n.resourceId.split("/").pop()}` : "",
            ]
              .filter(Boolean)
              .join(" ");
            return `<button type="button" class="adb-layout-node${
              n.index === adbLayoutSelected ? " is-active" : ""
            }" data-adb-layout-idx="${n.index}">${escapeHtml(label)}</button>`;
          })
          .join("");
      }

      function showLayoutNode(idx) {
        adbLayoutSelected = idx;
        const n = adbLayoutNodes[idx];
        const el = $("#adb-layout-attrs");
        if (!el) return;
        if (!n) {
          el.textContent = "选择节点查看属性";
          return;
        }
        const lines = Object.entries(n.attrs || {}).map(([k, v]) => `${k}=${v}`);
        if (n.rect) lines.push(`parsed.bounds=${n.rect.w}x${n.rect.h} @ (${n.rect.x1},${n.rect.y1})`);
        el.textContent = lines.join("\n");
        renderLayoutTree($("#adb-layout-filter")?.value || "");
      }

      async function dumpLayout() {
        if (!canDeviceInspect() && adbBridgeVersion) {
          throw new Error("布局检查需桥 ≥0.9.0，请重新下载完整 ZIP 并重启桥");
        }
        const serial = requireCurrentSerial();
        if ($("#adb-layout-meta")) $("#adb-layout-meta").textContent = "Dumping…";
        const data = await adbFetch(`/device/layout?serial=${encodeURIComponent(serial)}`);
        adbLayoutNodes = data.nodes || [];
        adbLayoutXml = data.xml || "";
        adbLayoutSelected = adbLayoutNodes[0]?.index ?? -1;
        renderLayoutTree($("#adb-layout-filter")?.value || "");
        if (adbLayoutSelected >= 0) showLayoutNode(adbLayoutSelected);
        if ($("#adb-layout-meta")) {
          $("#adb-layout-meta").textContent = `${adbLayoutNodes.length} 节点 · 桥 ${adbBridgeVersion || "?"}`;
        }
      }
  
      function adbDeviceAccent(serial) {
        const s = String(serial || "");
        let h = 2166136261;
        for (let i = 0; i < s.length; i++) {
          h ^= s.charCodeAt(i);
          h = Math.imul(h, 16777619);
        }
        return Math.abs(h) % 360;
      }
  
      function renderAdbDevices() {
        if (!adbDeviceList) return;
        if (!adbDevices.length) {
          adbDeviceList.innerHTML = `<div class="adb-fs-empty">未检测到设备。请检查 USB 调试授权后点「刷新设备」。</div>`;
          if (adbDeviceMeta) adbDeviceMeta.textContent = "0 台";
          updateSelectedMeta();
          return;
        }
        if (adbDeviceMeta) adbDeviceMeta.textContent = `${adbDevices.length} 台`;
        adbDeviceList.innerHTML = adbDevices
          .map((d) => {
            const title = d.model || d.product || d.serial;
            const active = d.serial === adbSelected ? " is-active" : "";
            const checked = adbChecked.has(d.serial) ? "checked" : "";
            const hue = adbDeviceAccent(d.serial);
            return `<div class="adb-device${active}" data-serial-wrap="${escapeHtml(d.serial)}" style="--adb-accent: hsl(${hue} 58% 46%)">
              <span class="adb-device-stripe" aria-hidden="true"></span>
              <input class="adb-device-check" type="checkbox" data-adb-check="${escapeHtml(d.serial)}" ${checked} aria-label="勾选 ${escapeHtml(d.serial)}" />
              <button type="button" class="adb-device-body" data-serial="${escapeHtml(d.serial)}">
                <strong>${escapeHtml(title)}</strong>
                <span>${escapeHtml(d.serial)} · ${escapeHtml(d.state)}</span>
              </button>
            </div>`;
          })
          .join("");
        updateSelectedMeta();
      }
  
      function fillAdbInfo(info) {
        const set = (id, value) => {
          const el = $(id);
          if (el) el.textContent = value || "—";
        };
        if (!info) {
          ["#adb-info-serial", "#adb-info-state", "#adb-info-model", "#adb-info-android", "#adb-info-screen", "#adb-info-battery", "#adb-info-storage", "#adb-info-build"].forEach((id) => set(id, "—"));
          if (adbInfoMeta) adbInfoMeta.textContent = "未选择设备";
          resetGetpropPanel();
          return;
        }
        set("#adb-info-serial", info.serial || info.serialno);
        set("#adb-info-state", info.state);
        set("#adb-info-model", [info.manufacturer, info.model].filter(Boolean).join(" / "));
        set(
          "#adb-info-android",
          [info.androidVersion && `Android ${info.androidVersion}`, info.sdk && `SDK ${info.sdk}`]
            .filter(Boolean)
            .join(" · ")
        );
        set("#adb-info-screen", [info.screen, info.density && `${info.density} dpi`].filter(Boolean).join(" / "));
        set("#adb-info-battery", info.battery);
        set("#adb-info-storage", info.storage);
        set("#adb-info-build", [info.abi, info.buildId].filter(Boolean).join(" · "));
        if (adbInfoMeta) {
          adbInfoMeta.textContent = info.ready === false ? info.message || "设备未就绪" : "已加载";
        }
      }
  
      /** @type {{ serial: string, props: Array<{key:string,value:string}> }} */
      let adbGetpropCache = { serial: "", props: [] };
      let adbGetpropLoading = false;
  
      function resetGetpropPanel() {
        adbGetpropCache = { serial: "", props: [] };
        const dlg = $("#adb-getprop-dlg");
        if (dlg?.open && typeof dlg.close === "function") dlg.close();
        const list = $("#adb-getprop-list");
        if (list) {
          list.innerHTML = "";
          list.hidden = true;
        }
        const search = $("#adb-getprop-search");
        if (search) search.value = "";
        const meta = $("#adb-getprop-meta");
        if (meta) meta.textContent = "打开后加载";
        const empty = $("#adb-getprop-empty");
        if (empty) empty.hidden = true;
      }
  
      async function openGetpropDialog() {
        const dlg = $("#adb-getprop-dlg");
        if (!dlg) return;
        if (typeof dlg.showModal === "function") {
          if (!dlg.open) dlg.showModal();
        } else if (!dlg.hasAttribute("open")) {
          dlg.setAttribute("open", "");
        }
        await loadGetprop().catch((err) => setError(adbError, err.message || String(err)));
      }
  
      function filteredGetpropItems() {
        const q = String($("#adb-getprop-search")?.value || "")
          .trim()
          .toLowerCase();
        if (!q) return adbGetpropCache.props;
        return adbGetpropCache.props.filter(
          (p) => p.key.toLowerCase().includes(q) || String(p.value || "").toLowerCase().includes(q)
        );
      }
  
      function renderGetpropList() {
        const list = $("#adb-getprop-list");
        const empty = $("#adb-getprop-empty");
        const meta = $("#adb-getprop-meta");
        const items = filteredGetpropItems();
        const q = String($("#adb-getprop-search")?.value || "").trim();
        if (!list) return;
        if (!items.length) {
          list.innerHTML = "";
          list.hidden = true;
          if (empty) empty.hidden = !adbGetpropCache.props.length || !q;
          if (meta && adbGetpropCache.props.length) {
            meta.textContent = q ? `0 / ${adbGetpropCache.props.length} 项` : `${adbGetpropCache.props.length} 项`;
          }
          return;
        }
        if (empty) empty.hidden = true;
        list.hidden = false;
        list.innerHTML = items
          .map(
            (p) =>
              `<div class="meta-row adb-getprop-row"><span class="mono adb-getprop-key">${escapeHtml(p.key)}</span><strong class="mono adb-getprop-val">${escapeHtml(p.value || "—")}</strong></div>`
          )
          .join("");
        if (meta && adbGetpropCache.props.length) {
          meta.textContent = q ? `${items.length} / ${adbGetpropCache.props.length} 项` : `${adbGetpropCache.props.length} 项`;
        }
      }
  
      async function loadGetprop({ force = false } = {}) {
        const serial = requireCurrentSerial();
        if (adbGetpropLoading) return;
        if (!force && adbGetpropCache.serial === serial && adbGetpropCache.props.length) {
          renderGetpropList();
          return;
        }
        adbGetpropLoading = true;
        const meta = $("#adb-getprop-meta");
        if (meta) meta.textContent = "加载中…";
        try {
          const data = await adbFetch(`/device/getprop?serial=${encodeURIComponent(serial)}`);
          adbGetpropCache = { serial, props: data.props || [] };
          renderGetpropList();
          if (!adbGetpropCache.props.length && meta) meta.textContent = "无属性";
        } catch (err) {
          adbGetpropCache = { serial: "", props: [] };
          if (meta) meta.textContent = "加载失败";
          throw err;
        } finally {
          adbGetpropLoading = false;
        }
      }
  
      function renderFsCrumbs(pathValue) {
        const el = $("#adb-fs-crumbs");
        if (!el) return;
        const raw = String(pathValue || "/");
        if (raw === "/") {
          el.innerHTML = `<button type="button" class="linkish" data-adb-open="/">/</button>`;
          return;
        }
        const parts = raw.replace(/\/+$/, "").split("/").filter(Boolean);
        let acc = "";
        const bits = [`<button type="button" class="linkish" data-adb-open="/">/</button>`];
        parts.forEach((part) => {
          acc += `/${part}`;
          bits.push(
            `<button type="button" class="linkish" data-adb-open="${escapeHtml(acc)}">${escapeHtml(part)}</button>`
          );
        });
        el.innerHTML = bits.join(`<span class="adb-crumb-sep" aria-hidden="true">/</span>`);
      }
  
      function classifyAdbPreview(name) {
        const n = String(name || "");
        if (/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(n)) return "image";
        if (/\.(mp4|webm|mkv|3gp)$/i.test(n)) return "video";
        if (/\.(mp3|m4a|aac|ogg|wav)$/i.test(n)) return "audio";
        if (
          /\.(txt|log|md|csv|tsv|ini|conf|cfg|properties|prop|gradle|smali|java|kt|kts|xml|html?|css|js|mjs|cjs|ts|json|ya?ml|toml|sh|bat|cmd|rc|gitignore|pro)$/i.test(
            n
          )
        ) {
          return "text";
        }
        return "other";
      }
  
      function clearAdbFsPreview({ keepOpen = false } = {}) {
        if (adbFsPreviewUrl) {
          try {
            URL.revokeObjectURL(adbFsPreviewUrl);
          } catch (_) {
            /* ignore */
          }
          adbFsPreviewUrl = "";
        }
        if (adbFsPreviewBody) adbFsPreviewBody.innerHTML = "";
        if (adbFsPreviewMeta) adbFsPreviewMeta.textContent = "";
        if (adbFsPreviewTitle) adbFsPreviewTitle.textContent = "文件预览";
        const propsBox = $("#adb-fs-props");
        if (propsBox) {
          propsBox.hidden = true;
          propsBox.textContent = "";
        }
        if (adbFsPreview && !keepOpen) adbFsPreview.hidden = true;
      }
  
      function showAdbFsPreviewShell(name, metaText) {
        if (adbFsPreview) adbFsPreview.hidden = false;
        if (adbFsPreviewTitle) adbFsPreviewTitle.textContent = name || "文件预览";
        if (adbFsPreviewMeta) adbFsPreviewMeta.textContent = metaText || "";
      }
  
      function showFsProps(entry) {
        const box = $("#adb-fs-props");
        if (!box || !entry) return;
        if (adbFsPreview) adbFsPreview.hidden = false;
        if (adbFsPreviewTitle && (entry.isDir || entry.virtual)) {
          adbFsPreviewTitle.textContent = entry.name || basenameRemote(entry.path) || "属性";
        }
        const lines = [
          `路径：${entry.path || ""}`,
          `类型：${entry.virtual ? "虚拟（应用包名）" : entry.isDir ? "文件夹" : "文件"}`,
        ];
        if (!entry.isDir && !entry.virtual) {
          const size = Number(entry.size);
          lines.push(`大小：${Number.isFinite(size) ? `${formatBytes(size)} (${size} B)` : "未知"}`);
        }
        if (entry.date) lines.push(`修改时间：${entry.date}`);
        if (entry.mode) lines.push(`权限：${entry.mode}`);
        lines.push(`可写：${entry.virtual ? "否（虚拟）" : entry.writable === false ? "否" : "是"}`);
        box.textContent = lines.join("\n");
        box.hidden = false;
        if ((entry.isDir || entry.virtual) && adbFsPreviewBody) {
          adbFsPreviewBody.innerHTML = `<p class="adb-fs-preview-empty">文件夹无预览，可查看上方属性或双击打开。</p>`;
        }
      }
  
      async function previewAdbFile(remotePath, name, sizeHint) {
        if (!adbSelected || !remotePath) return;
        const kind = classifyAdbPreview(name);
        const size = Number(sizeHint);
        const knownSize = Number.isFinite(size) && size >= 0;
        clearAdbFsPreview({ keepOpen: true });
        showAdbFsPreviewShell(name || basenameRemote(remotePath), "加载预览…");
        if (kind === "other") {
          if (adbFsPreviewBody) {
            adbFsPreviewBody.innerHTML = `<p class="adb-fs-preview-empty">此类型暂不支持在线预览，请用「下载」到电脑查看。</p>`;
          }
          if (adbFsPreviewMeta) {
            adbFsPreviewMeta.textContent = knownSize ? formatBytes(size) : "未知大小";
          }
          return;
        }
        const limit =
          kind === "text" ? ADB_PREVIEW_TEXT_MAX : kind === "image" ? ADB_PREVIEW_IMAGE_MAX : ADB_PREVIEW_MEDIA_MAX;
        if (knownSize && size > limit) {
          if (adbFsPreviewBody) {
            adbFsPreviewBody.innerHTML = `<p class="adb-fs-preview-empty">文件约 ${formatBytes(
              size
            )}，超过预览上限（${formatBytes(limit)}）。请下载后本地打开。</p>`;
          }
          if (adbFsPreviewMeta) adbFsPreviewMeta.textContent = `${kind} · ${formatBytes(size)}`;
          return;
        }
        const token = ++adbFsPreviewToken;
        try {
          const res = await adbFetch(
            `/fs/download?serial=${encodeURIComponent(adbSelected)}&path=${encodeURIComponent(remotePath)}`
          );
          if (token !== adbFsPreviewToken) return;
          const blob = await res.blob();
          if (token !== adbFsPreviewToken) return;
          if (blob.size > limit) {
            if (adbFsPreviewBody) {
              adbFsPreviewBody.innerHTML = `<p class="adb-fs-preview-empty">已拉取 ${formatBytes(
                blob.size
              )}，超过预览上限。请下载后本地打开。</p>`;
            }
            return;
          }
          if (kind === "text") {
            const text = await blob.text();
            if (token !== adbFsPreviewToken) return;
            const pre = document.createElement("pre");
            pre.className = "mono";
            pre.textContent = text.slice(0, 200_000);
            if (adbFsPreviewBody) {
              adbFsPreviewBody.innerHTML = "";
              adbFsPreviewBody.appendChild(pre);
            }
            if (adbFsPreviewMeta) {
              adbFsPreviewMeta.textContent = `文本 · ${formatBytes(blob.size)}${
                text.length > 200_000 ? " · 已截断显示" : ""
              }`;
            }
            return;
          }
          adbFsPreviewUrl = URL.createObjectURL(blob);
          if (kind === "image") {
            const img = document.createElement("img");
            img.alt = name || "预览图";
            img.src = adbFsPreviewUrl;
            if (adbFsPreviewBody) {
              adbFsPreviewBody.innerHTML = "";
              adbFsPreviewBody.appendChild(img);
            }
          } else if (kind === "video") {
            const video = document.createElement("video");
            video.controls = true;
            video.playsInline = true;
            video.src = adbFsPreviewUrl;
            if (adbFsPreviewBody) {
              adbFsPreviewBody.innerHTML = "";
              adbFsPreviewBody.appendChild(video);
            }
          } else if (kind === "audio") {
            const audio = document.createElement("audio");
            audio.controls = true;
            audio.src = adbFsPreviewUrl;
            if (adbFsPreviewBody) {
              adbFsPreviewBody.innerHTML = "";
              adbFsPreviewBody.appendChild(audio);
            }
          }
          if (adbFsPreviewMeta) adbFsPreviewMeta.textContent = `${kind} · ${formatBytes(blob.size)}`;
        } catch (err) {
          if (token !== adbFsPreviewToken) return;
          if (adbFsPreviewBody) {
            adbFsPreviewBody.innerHTML = `<p class="adb-fs-preview-empty">${escapeHtml(
              err.message || String(err)
            )}</p>`;
          }
          if (adbFsPreviewMeta) adbFsPreviewMeta.textContent = "预览失败";
        }
      }
  
      function clipboardItems(clip = adbFsClipboard) {
        if (!clip) return [];
        if (Array.isArray(clip.items) && clip.items.length) return clip.items;
        if (clip.path) return [{ path: clip.path, name: clip.name || basenameRemote(clip.path) }];
        return [];
      }
  
      function setFsClipboard(mode, items) {
        const list = (items || [])
          .map((it) => ({
            path: it.path,
            name: it.name || basenameRemote(it.path),
          }))
          .filter((it) => it.path);
        adbFsClipboard = list.length ? { mode, items: list } : null;
        updateFsClipboardMeta();
      }
  
      function updateFsClipboardMeta() {
        const meta = $("#adb-fs-clip-meta");
        const pasteBtn = $("#adb-fs-paste");
        const items = clipboardItems();
        if (pasteBtn) pasteBtn.disabled = !items.length;
        if (!meta) return;
        if (!items.length) {
          meta.hidden = true;
          meta.textContent = "";
          return;
        }
        meta.hidden = false;
        const verb = adbFsClipboard.mode === "cut" ? "已剪切（移动）" : "已复制";
        const names = items.slice(0, 3).map((it) => it.name || basenameRemote(it.path));
        const more = items.length > 3 ? ` 等 ${items.length} 项` : items.length > 1 ? `（${items.length} 项）` : "";
        meta.textContent = `${verb}：${names.join("、")}${more} · 打开目标目录后点「粘贴到此处」`;
      }
  
      function syncFsBatchBar() {
        const n = adbFsChecked.size;
        if (adbFsBatch) adbFsBatch.hidden = n === 0;
        if (adbFsBatchMeta) adbFsBatchMeta.textContent = `已选 ${n} 项`;
        adbFsList?.querySelectorAll(".adb-fs-row[data-adb-entry]").forEach((row) => {
          const path = row.dataset.adbEntry || "";
          const on = adbFsChecked.has(path);
          row.classList.toggle("is-checked", on);
          const box = row.querySelector(".adb-fs-check");
          if (box) box.checked = on;
        });
      }
  
      function clearFsChecked() {
        adbFsChecked.clear();
        syncFsBatchBar();
      }
  
      function collectFsEntrySelection(row) {
        if (!row) return null;
        const path = row.dataset.adbEntry || row.dataset.adbFile || row.dataset.adbOpen || "";
        if (!path) return null;
        return {
          path,
          name: row.dataset.adbEntryName || row.dataset.adbFileName || basenameRemote(path),
          isDir: row.classList.contains("is-dir") || Boolean(row.dataset.adbOpen),
          virtual: row.classList.contains("is-virtual"),
          size: row.dataset.adbFileSize || "",
          writable: row.dataset.adbEntryWritable !== "0",
          mode: row.dataset.adbEntryMode || "",
          date: row.dataset.adbEntryDate || "",
        };
      }
  
      function hideFsCtxMenu() {
        const menu = $("#adb-fs-ctx");
        if (menu) menu.hidden = true;
      }
  
      function ensureFsCtxMenu() {
        let menu = $("#adb-fs-ctx");
        if (menu) return menu;
        menu = document.createElement("div");
        menu.id = "adb-fs-ctx";
        menu.className = "adb-fs-ctx";
        menu.hidden = true;
        menu.setAttribute("role", "menu");
        document.body.appendChild(menu);
        menu.addEventListener("click", async (e) => {
          const btn = e.target.closest("[data-adb-fs-act]");
          if (!btn || btn.disabled || btn.classList.contains("is-disabled")) return;
          e.preventDefault();
          e.stopPropagation();
          const action = btn.dataset.adbFsAct || "";
          const entry = {
            path: menu.dataset.path || "",
            name: menu.dataset.name || "",
            isDir: menu.dataset.isDir === "1",
            virtual: menu.dataset.virtual === "1",
            size: menu.dataset.size || "",
            writable: menu.dataset.writable !== "0",
            mode: menu.dataset.mode || "",
            date: menu.dataset.date || "",
          };
          hideFsCtxMenu();
          await runFsEntryAction(action, entry);
        });
        return menu;
      }
  
      function showFsCtxMenu(entry, clientX, clientY) {
        if (!entry) return;
        hideAppCtxMenu();
        const menu = ensureFsCtxMenu();
        menu.dataset.path = entry.path;
        menu.dataset.name = entry.name || "";
        menu.dataset.isDir = entry.isDir ? "1" : "0";
        menu.dataset.virtual = entry.virtual ? "1" : "0";
        menu.dataset.size = entry.size || "";
        menu.dataset.writable = entry.writable === false ? "0" : "1";
        menu.dataset.mode = entry.mode || "";
        menu.dataset.date = entry.date || "";
        const writable = entry.writable !== false && !entry.virtual;
        const dis = (cond) => (cond ? ` disabled title="只读路径或无写入权限"` : "");
        const bits = [];
        if (entry.virtual) {
          bits.push(`<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-fs-act="open">打开</button>`);
          bits.push(`<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-fs-act="copypath">复制路径</button>`);
          bits.push(`<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-fs-act="props">属性</button>`);
          menu.innerHTML = bits.join("");
          menu.hidden = false;
          positionFsCtxMenu(menu, clientX, clientY);
          return;
        }
        if (entry.isDir) {
          bits.push(`<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-fs-act="open">打开</button>`);
          bits.push(`<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-fs-act="downloadFolder">下载文件夹</button>`);
        } else {
          bits.push(`<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-fs-act="preview">预览</button>`);
          bits.push(`<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-fs-act="download">下载</button>`);
        }
        bits.push(`<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-fs-act="props">属性</button>`);
        bits.push(`<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-fs-act="copypath">复制路径</button>`);
        bits.push(`<button type="button" class="adb-fs-ctx-item"${dis(!writable)} role="menuitem" data-adb-fs-act="rename">重命名</button>`);
        bits.push(`<button type="button" class="adb-fs-ctx-item"${dis(!writable)} role="menuitem" data-adb-fs-act="cut">移动</button>`);
        bits.push(`<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-fs-act="copy">复制</button>`);
        bits.push(`<button type="button" class="adb-fs-ctx-item is-danger"${dis(!writable)} role="menuitem" data-adb-fs-act="delete">删除</button>`);
        menu.innerHTML = bits.join("");
        menu.hidden = false;
        positionFsCtxMenu(menu, clientX, clientY);
      }
  
      function positionFsCtxMenu(menu, clientX, clientY) {
        const pad = 8;
        const mw = menu.offsetWidth || 160;
        const mh = menu.offsetHeight || 200;
        let left = Number(clientX) || pad;
        let top = Number(clientY) || pad;
        left = Math.max(pad, Math.min(left, window.innerWidth - mw - pad));
        top = Math.max(pad, Math.min(top, window.innerHeight - mh - pad));
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
      }
  
      async function runFsEntryAction(action, entry) {
        if (!entry?.path || !adbSelected) return;
        try {
          if (action === "open") {
            await loadFs(entry.path);
            return;
          }
          if (action === "preview") {
            adbFsSelected = entry.path;
            await previewAdbFile(entry.path, entry.name, entry.size);
            showFsProps(entry);
            return;
          }
          if (action === "props") {
            showFsProps(entry);
            return;
          }
          if (action === "download") {
            await downloadAdbFile(entry.path, entry.name);
            return;
          }
          if (action === "downloadFolder") {
            await downloadFolder(entry.path, entry.name);
            return;
          }
          if (action === "copypath") {
            try {
              await navigator.clipboard.writeText(entry.path);
              toast("已复制路径");
            } catch (_) {
              toast("复制失败");
            }
            return;
          }
          if (action === "rename") {
            if (entry.writable === false || entry.virtual) {
              toast("只读路径，无法重命名");
              return;
            }
            const next = window.prompt("新名称", entry.name || "");
            if (!next || !next.trim()) return;
            await adbFetch("/fs/rename", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ serial: adbSelected, path: entry.path, name: next.trim() }),
            });
            toast("已重命名");
            await loadFs(adbFsPath?.value || "/");
            return;
          }
          if (action === "cut") {
            if (entry.writable === false || entry.virtual) {
              toast("只读路径，无法移动");
              return;
            }
            setFsClipboard("cut", [{ path: entry.path, name: entry.name }]);
            toast("已准备移动，请打开目标目录后点「粘贴到此处」");
            return;
          }
          if (action === "copy") {
            setFsClipboard("copy", [{ path: entry.path, name: entry.name }]);
            toast("已复制，请打开目标目录后点「粘贴到此处」");
            return;
          }
          if (action === "delete") {
            if (entry.writable === false || entry.virtual) {
              toast("只读路径，无法删除");
              return;
            }
            if (!window.confirm(`确认删除「${entry.name || entry.path}」？此操作不可恢复。`)) return;
            await adbFetch("/fs/delete", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ serial: adbSelected, path: entry.path }),
            });
            toast("已删除");
            await loadFs(adbFsPath?.value || "/");
          }
        } catch (err) {
          setError(adbError, err.message || String(err));
        }
      }
  
      function updateFsSortMeta() {
        const el = $("#adb-fs-sort-meta");
        if (!el) return;
        const labels = { name: "名称", size: "大小", date: "修改时间" };
        const arrow = adbFsSortDir > 0 ? "↑" : "↓";
        el.textContent = `排序：${labels[adbFsSortKey] || "名称"} ${arrow}`;
      }
  
      function sortFsEntries(entries) {
        const key = adbFsSortKey;
        const dir = adbFsSortDir;
        return [...entries].sort((a, b) => {
          const aDir = a.type === "dir" || a.virtual || a.mode === "virtual";
          const bDir = b.type === "dir" || b.virtual || b.mode === "virtual";
          if (aDir !== bDir) return aDir ? -1 : 1;
          let cmp = 0;
          if (key === "size") {
            cmp = (Number(a.size) || 0) - (Number(b.size) || 0);
          } else if (key === "date") {
            cmp = String(a.date || "").localeCompare(String(b.date || ""));
          } else {
            cmp = String(a.name || "").localeCompare(String(b.name || ""), undefined, {
              sensitivity: "base",
              numeric: true,
            });
          }
          return cmp * dir;
        });
      }
  
      function revokeFsThumbUrls() {
        adbFsThumbUrls.forEach((url) => {
          try {
            URL.revokeObjectURL(url);
          } catch (_) {
            /* ignore */
          }
        });
        adbFsThumbUrls = [];
      }
  
      function setAdbFsView(view) {
        adbFsView = view === "grid" ? "grid" : "list";
        try {
          localStorage.setItem(ADB_STORE_FSVIEW, adbFsView);
        } catch (_) {
          /* ignore */
        }
        $("#adb-fs-view-list")?.classList.toggle("is-active", adbFsView === "list");
        $("#adb-fs-view-grid")?.classList.toggle("is-active", adbFsView === "grid");
        paintFsList();
      }
  
      async function loadFsThumb(img, remotePath) {
        if (!adbSelected) return;
        try {
          const res = await adbFetch(
            `/fs/download?serial=${encodeURIComponent(adbSelected)}&path=${encodeURIComponent(remotePath)}`
          );
          const blob = await res.blob();
          if (blob.size > ADB_FS_THUMB_MAX) return;
          const url = URL.createObjectURL(blob);
          adbFsThumbUrls.push(url);
          if (!img.isConnected) {
            URL.revokeObjectURL(url);
            return;
          }
          const thumb = document.createElement("img");
          thumb.className = "adb-fs-thumb";
          thumb.alt = "";
          thumb.src = url;
          img.replaceWith(thumb);
        } catch (_) {
          /* leave placeholder */
        }
      }
  
      function paintFsList() {
        if (!adbFsList) return;
        hideFsCtxMenu();
        revokeFsThumbUrls();
        adbFsList.classList.toggle("is-grid", adbFsView === "grid");
        const pathValue = adbFsPathCache || "/";
        const q = String($("#adb-fs-filter")?.value || "")
          .trim()
          .toLowerCase();
        let entries = adbFsEntriesCache || [];
        if (q) {
          entries = entries.filter((item) => String(item.name || "").toLowerCase().includes(q));
        }
        entries = sortFsEntries(entries);
        updateFsSortMeta();
        if (!(adbFsEntriesCache || []).length) {
          adbFsList.innerHTML = `<div class="adb-fs-empty">目录为空或无权读取</div>`;
          return;
        }
        if (!entries.length) {
          adbFsList.innerHTML = `<div class="adb-fs-empty">无匹配项（可清空筛选）</div>`;
          return;
        }
        const sortMark = (key) =>
          adbFsSortKey === key ? (adbFsSortDir > 0 ? " ↑" : " ↓") : "";
        const head = `<div class="adb-fs-head" role="row">
          <span class="adb-fs-col-check" aria-hidden="true"></span>
          <button type="button" class="adb-fs-sort" data-adb-fs-sort="name">名称${sortMark("name")}</button>
          <button type="button" class="adb-fs-sort adb-fs-col-size" data-adb-fs-sort="size">大小${sortMark("size")}</button>
          <button type="button" class="adb-fs-sort adb-fs-col-date" data-adb-fs-sort="date">修改时间${sortMark("date")}</button>
          <span class="adb-fs-col-more" aria-hidden="true"></span>
        </div>`;
        const thumbQueue = [];
        const rows = entries
          .map((item) => {
            const full = joinRemote(pathValue, item.name);
            const isDir = item.type === "dir";
            const virtual = Boolean(item.virtual || item.mode === "virtual");
            const writable = virtual ? false : item.writable !== false;
            const sizeText = virtual ? "虚拟" : isDir ? "—" : formatBytes(item.size) || "—";
            const dateText = virtual ? "—" : item.date || "—";
            const checked = !virtual && adbFsChecked.has(full) ? "checked" : "";
            const selected = adbFsSelected && adbFsSelected === full ? " is-selected" : "";
            const checkedCls = !virtual && adbFsChecked.has(full) ? " is-checked" : "";
            const sizeAttr =
              !isDir && item.size != null && Number.isFinite(Number(item.size))
                ? ` data-adb-file-size="${escapeHtml(String(item.size))}"`
                : "";
            const entryAttr = `data-adb-entry="${escapeHtml(full)}" data-adb-entry-name="${escapeHtml(item.name)}" data-adb-entry-writable="${writable ? "1" : "0"}" data-adb-entry-mode="${escapeHtml(String(item.mode || ""))}" data-adb-entry-date="${escapeHtml(String(item.date || ""))}"`;
            const rowAttr = isDir
              ? `data-adb-open="${escapeHtml(full)}" ${entryAttr}${virtual ? "" : ' draggable="true"'}`
              : `data-adb-file="${escapeHtml(full)}" data-adb-file-name="${escapeHtml(item.name)}"${sizeAttr} ${entryAttr}${virtual ? "" : ' draggable="true"'}`;
            const checkHtml = virtual
              ? `<span class="adb-fs-col-check"></span>`
              : `<input type="checkbox" class="adb-fs-check" data-adb-check-path="${escapeHtml(full)}" aria-label="选择 ${escapeHtml(item.name)}" ${checked} />`;
            const moreHtml = virtual
              ? `<span class="adb-fs-col-more"></span>`
              : `<button type="button" class="adb-fs-more" data-adb-fs-more aria-label="更多操作" title="更多操作">⋯</button>`;
            const nameHtml = isDir
              ? `<span class="adb-fs-name">${escapeHtml(item.name)}/</span>`
              : `<span class="adb-fs-name mono">${escapeHtml(item.name)}</span>`;
            const isImage = !isDir && !virtual && classifyAdbPreview(item.name) === "image";
            const canThumb = isImage && Number(item.size) > 0 && Number(item.size) <= ADB_FS_THUMB_MAX;
            const thumbId = `fst-${thumbQueue.length}-${Math.random().toString(36).slice(2, 7)}`;
            if (adbFsView === "grid" && canThumb) thumbQueue.push({ id: thumbId, path: full });
            const thumbHtml =
              adbFsView === "grid"
                ? isDir
                  ? `<span class="adb-fs-thumb-ph" aria-hidden="true">📁</span>`
                  : canThumb
                    ? `<span class="adb-fs-thumb-ph" id="${thumbId}" data-adb-fs-thumb aria-hidden="true">…</span>`
                    : `<span class="adb-fs-thumb-ph" aria-hidden="true">${virtual ? "📦" : "📄"}</span>`
                : "";
            return `<div class="adb-fs-row${isDir ? " is-dir" : " is-file"}${virtual ? " is-virtual" : ""}${writable ? "" : " is-readonly"}${selected}${checkedCls}" ${rowAttr}>
              ${checkHtml}
              ${thumbHtml}
              <div class="adb-fs-col-name">${nameHtml}</div>
              <span class="adb-fs-col-size mono">${escapeHtml(sizeText)}</span>
              <span class="adb-fs-col-date mono">${escapeHtml(dateText)}</span>
              ${moreHtml}
            </div>`;
          })
          .join("");
        adbFsList.innerHTML = head + rows;
        syncFsBatchBar();
        if (adbFsView === "grid") {
          thumbQueue.forEach(({ id, path }) => {
            const el = document.getElementById(id);
            if (el) loadFsThumb(el, path);
          });
        }
      }
  
      function renderFsEntries(pathValue, entries) {
        if (!adbFsList) return;
        adbFsSelected = "";
        clearFsChecked();
        clearAdbFsPreview();
        hideFsCtxMenu();
        adbFsPathCache = pathValue || "/";
        adbFsEntriesCache = Array.isArray(entries) ? entries : [];
        paintFsList();
      }
  
      function joinLocalPath(dir, name) {
        const d = String(dir || "");
        if (!d) return name;
        return /[\\/]$/.test(d) ? `${d}${name}` : `${d}/${name}`;
      }
  
      function parentOfLocalPath(p) {
        const s = String(p || "").replace(/[\\/]+$/, "");
        const idx = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
        if (idx < 0) return s;
        return s.slice(0, idx) || s.slice(0, 1);
      }
  
      function syncLocalPushBtn() {
        const btn = $("#adb-fs-local-push");
        if (!btn) return;
        btn.disabled = !adbLocalChecked.size || !adbSelected || !adbFsDirWritable;
      }
  
      function renderLocalRoots() {
        const el = $("#adb-fs-local-roots");
        if (!el) return;
        el.innerHTML = adbLocalRoots
          .map(
            (r) =>
              `<button type="button" class="ghost-btn" data-adb-local-root="${escapeHtml(r.path)}">${escapeHtml(r.name || r.path)}</button>`
          )
          .join("");
      }
  
      function renderLocalList() {
        const el = $("#adb-fs-local-list");
        if (!el) return;
        if (!adbLocalEntries.length) {
          el.innerHTML = `<div class="adb-fs-empty">空文件夹</div>`;
          return;
        }
        const sorted = [...adbLocalEntries].sort((a, b) => {
          if (a.type === "dir" && b.type !== "dir") return -1;
          if (a.type !== "dir" && b.type === "dir") return 1;
          return String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" });
        });
        el.innerHTML = sorted
          .map((item) => {
            const full = joinLocalPath(adbLocalPath, item.name);
            const isDir = item.type === "dir";
            const checked = adbLocalChecked.has(full) ? "checked" : "";
            const checkedCls = adbLocalChecked.has(full) ? " is-checked" : "";
            const label = isDir ? `${item.name}/` : item.name;
            const sizeText = isDir ? "" : formatBytes(item.size) || "";
            return `<div class="adb-fs-local-row${checkedCls}" data-adb-local-path="${escapeHtml(full)}" data-adb-local-name="${escapeHtml(item.name)}" data-adb-local-dir="${isDir ? "1" : "0"}" draggable="true">
              <input type="checkbox" class="adb-fs-check" data-adb-local-check="${escapeHtml(full)}" aria-label="选择 ${escapeHtml(item.name)}" ${checked} />
              <span class="adb-fs-name${isDir ? "" : " mono"}"${isDir ? ` data-adb-local-open="${escapeHtml(full)}"` : ""}>${escapeHtml(label)}</span>
              <span class="hint tight mono">${escapeHtml(sizeText)}</span>
            </div>`;
          })
          .join("");
      }
  
      async function loadLocalRoots() {
        try {
          const data = await adbFetch("/local/roots");
          adbLocalRoots = data.roots || [];
          renderLocalRoots();
          let preferred = "";
          try {
            preferred = String(localStorage.getItem(ADB_STORE_LOCAL_PATH) || "").trim();
          } catch (_) {
            preferred = "";
          }
          if (preferred) {
            await loadLocalPath(preferred);
            if (adbLocalPath) return;
          }
          if (!adbLocalPath && adbLocalRoots.length) {
            await loadLocalPath(adbLocalRoots[0].path);
          } else {
            syncLocalSaveMeta();
          }
        } catch (err) {
          const meta = $("#adb-fs-local-meta");
          if (meta) meta.textContent = "本机浏览不可用：" + (err.message || String(err));
        }
      }
  
      async function loadLocalPath(p) {
        if (adbLocalBusy) return;
        adbLocalBusy = true;
        const meta = $("#adb-fs-local-meta");
        if (meta) meta.textContent = "加载中…";
        try {
          const data = await adbFetch(`/local/list?path=${encodeURIComponent(p)}`);
          adbLocalPath = data.path || p;
          adbLocalEntries = data.entries || [];
          adbLocalChecked.clear();
          if ($("#adb-fs-local-path")) $("#adb-fs-local-path").value = adbLocalPath;
          try {
            localStorage.setItem(ADB_STORE_LOCAL_PATH, adbLocalPath);
          } catch (_) {
            /* ignore */
          }
          renderLocalList();
          syncLocalSaveMeta();
          syncLocalPushBtn();
        } catch (err) {
          if ($("#adb-fs-local-list")) {
            $("#adb-fs-local-list").innerHTML = `<div class="adb-fs-empty">${escapeHtml(err.message || String(err))}</div>`;
          }
          if (meta) meta.textContent = err.message || "读取失败";
        } finally {
          adbLocalBusy = false;
        }
      }
  
      function renderApps() {
        if (!adbAppsList) return;
        const q = String($("#adb-apps-filter")?.value || "")
          .trim()
          .toLowerCase();
        const list = adbApps.filter((app) => {
          if (!q) return true;
          return (
            app.packageName.toLowerCase().includes(q) ||
            appDisplayLabel(app).toLowerCase().includes(q)
          );
        });
        if (adbAppsMeta) {
          const resolved = adbApps.filter((a) => sanitizeAppLabel(a.label) && sanitizeAppLabel(a.label) !== a.packageName)
            .length;
          adbAppsMeta.textContent = `${list.length}/${adbApps.length} · 应用名 ${resolved}/${adbApps.length} · ${
            adbSelected || "未选择"
          }`;
        }
        if (!list.length) {
          adbAppsList.innerHTML = `<div class="adb-fs-empty">无匹配应用</div>`;
          return;
        }
        adbAppsList.innerHTML = list
          .slice(0, 400)
          .map((app) => {
            const kind = app.isSystem ? "系统" : "三方";
            const pkg = escapeHtml(app.packageName);
            const label = sanitizeAppLabel(app.label);
            const hasLabel = Boolean(label && label !== app.packageName);
            const title = escapeHtml(appDisplayLabel(app));
            const checked = adbPermPackage === app.packageName ? "checked" : "";
            return `<div class="adb-fs-row adb-app-row" data-adb-app-pkg="${pkg}">
              <label class="adb-app-select">
                <input type="checkbox" data-adb-app-check="${pkg}" ${checked} />
                <span>
                  <strong>${title}</strong>
                  <div class="adb-fs-meta mono">${pkg}</div>
                  <div class="adb-fs-meta">${kind}${
                    hasLabel ? "" : " · 未解析应用名"
                  }${app.apkPath ? ` · ${escapeHtml(app.apkPath)}` : ""}</div>
                </span>
              </label>
              <div class="adb-app-actions">
                <button type="button" class="primary-btn" data-adb-app-open="${pkg}">打开</button>
                <button type="button" class="secondary-btn" data-adb-app-info="${pkg}">详情</button>
                <button type="button" class="ghost-btn" data-adb-app-uninstall="${pkg}">卸载</button>
              </div>
            </div>`;
          })
          .join("");
        if (list.length > 400) {
          adbAppsList.insertAdjacentHTML(
            "beforeend",
            `<div class="adb-fs-empty">仅显示前 400 条，请用过滤缩小范围</div>`
          );
        }
      }
  
      function hideAppCtxMenu() {
        const menu = $("#adb-app-ctx");
        if (menu) menu.hidden = true;
      }
  
      function ensureAppCtxMenu() {
        let menu = $("#adb-app-ctx");
        if (menu) return menu;
        menu = document.createElement("div");
        menu.id = "adb-app-ctx";
        menu.className = "adb-fs-ctx adb-app-ctx";
        menu.hidden = true;
        menu.setAttribute("role", "menu");
        document.body.appendChild(menu);
        menu.addEventListener("click", (e) => {
          const btn = e.target.closest("[data-adb-app-act]");
          if (!btn) return;
          e.preventDefault();
          const pkg = menu.dataset.pkg || "";
          const act = btn.dataset.adbAppAct || "";
          hideAppCtxMenu();
          if (pkg && act) runAppRowAction(act, pkg).catch((err) => setError(adbError, err.message || String(err)));
        });
        return menu;
      }
  
      function showAppCtxMenu(pkg, clientX, clientY) {
        if (!pkg) return;
        const menu = ensureAppCtxMenu();
        menu.dataset.pkg = pkg;
        menu.innerHTML = [
          `<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-app-act="open">打开</button>`,
          `<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-app-act="info">详情</button>`,
          `<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-app-act="stop">强停</button>`,
          `<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-app-act="clear">清数据</button>`,
          `<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-app-act="backup">备份</button>`,
          `<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-app-act="disable">停用</button>`,
          `<button type="button" class="adb-fs-ctx-item" role="menuitem" data-adb-app-act="enable">启用</button>`,
          `<button type="button" class="adb-fs-ctx-item is-danger" role="menuitem" data-adb-app-act="uninstall">卸载</button>`,
        ].join("");
        menu.hidden = false;
        const pad = 8;
        const rect = menu.getBoundingClientRect();
        let left = clientX;
        let top = clientY;
        if (left + rect.width > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - rect.width - pad);
        if (top + rect.height > window.innerHeight - pad) top = Math.max(pad, window.innerHeight - rect.height - pad);
        menu.style.left = `${left}px`;
        menu.style.top = `${top}px`;
      }
  
      async function runAppRowAction(act, pkg) {
        const packageName = String(pkg || "").trim();
        if (!packageName || !adbSelected) return;
        if (act === "open") {
          await adbFetch("/apps/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ serial: adbSelected, packageName, action: "open" }),
          });
          toast("已尝试打开应用");
          return;
        }
        if (act === "info") {
          await showAppInfo(packageName);
          return;
        }
        if (act === "stop") {
          await adbFetch("/apps/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ serial: adbSelected, packageName, action: "force-stop" }),
          });
          toast("已强制停止");
          return;
        }
        if (act === "clear") {
          if (!window.confirm(`确认清除 ${packageName} 的数据？`)) return;
          await adbFetch("/apps/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ serial: adbSelected, packageName, action: "clear" }),
          });
          toast("已清除数据");
          return;
        }
        if (act === "backup") {
          const data = await adbFetch("/apps/backup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ serial: adbSelected, packageName, async: true }),
          });
          await trackJob(data.job);
          return;
        }
        if (act === "disable") {
          if (!window.confirm(`确认停用 ${packageName}？`)) return;
          await adbFetch("/apps/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ serial: adbSelected, packageName, action: "disable" }),
          });
          toast("已请求停用");
          return;
        }
        if (act === "enable") {
          await adbFetch("/apps/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ serial: adbSelected, packageName, action: "enable" }),
          });
          toast("已请求启用");
          return;
        }
        if (act === "uninstall") {
          if (!window.confirm(`确认卸载 ${packageName}？此操作不可恢复。`)) return;
          await adbFetch("/apps/action", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ serial: adbSelected, packageName, action: "uninstall" }),
          });
          toast("已请求卸载");
          await loadApps();
        }
      }
  
      function jobTypeLabel(type) {
        return (
          {
            install: "安装 APK",
            screenshot: "截图",
            record: "录屏",
            backup: "备份 APK",
          }[type] || type
        );
      }
  
      function jobCardHtml(job) {
        const items = (job.items || [])
          .map((it) => `<li>${escapeHtml(it.serial || "")}: ${escapeHtml(it.status)} ${escapeHtml(it.message || "")}</li>`)
          .join("");
        const arts = (job.artifacts || [])
          .map(
            (a) =>
              `<button type="button" class="secondary-btn" data-adb-art-job="${escapeHtml(job.id)}" data-adb-art-name="${escapeHtml(a.name)}">下载 ${escapeHtml(a.name)}</button>`
          )
          .join("");
        const running = job.status === "running" || job.status === "pending" || job.status === "queued";
        const cancelBtn = running
          ? `<button type="button" class="ghost-btn" data-adb-job-cancel="${escapeHtml(job.id)}">取消</button>`
          : "";
        const zipBtn =
          (job.artifacts || []).length > 0
            ? `<button type="button" class="ghost-btn" data-adb-job-zip="${escapeHtml(job.id)}">打包下载全部</button>`
            : "";
        return `<div class="adb-job" data-adb-job-id="${escapeHtml(job.id)}">
          <div class="adb-job-head">
            <strong>${escapeHtml(jobTypeLabel(job.type))} · ${escapeHtml(job.status)}</strong>
            <span>${escapeHtml(String(job.progress || 0))}%</span>
          </div>
          <div class="gif-progress" style="margin-top:0.45rem">
            <div class="gif-progress-track"><span class="gif-progress-fill" style="width:${Number(job.progress) || 0}%"></span></div>
          </div>
          <p class="adb-job-msg">${escapeHtml(job.message || job.error || "")}</p>
          ${items ? `<ul class="adb-job-items">${items}</ul>` : ""}
          <div class="adb-job-arts">${cancelBtn}${zipBtn}${arts}</div>
        </div>`;
      }
  
      function renderInlineJobs() {
        const mediaEl = $("#adb-media-jobs");
        if (mediaEl) {
          const preferred = (adbJobs || []).filter(
            (j) => (j.type === "screenshot" || j.type === "record") && adbTrackedJobs.has(j.id)
          );
          const fallback = (adbJobs || [])
            .filter((j) => j.type === "screenshot" || j.type === "record")
            .slice(0, 2);
          const finalList = preferred.length ? preferred.slice(0, 6) : fallback;
          mediaEl.innerHTML = finalList.length
            ? finalList.map(jobCardHtml).join("")
            : `<div class="hint tight">截图/录屏任务会显示在这里，可直接预览下载</div>`;
        }
  
        const installEl = $("#adb-install-jobs");
        if (installEl) {
          const preferred = (adbJobs || []).filter((j) => j.type === "install" && adbTrackedJobs.has(j.id));
          const fallback = (adbJobs || []).filter((j) => j.type === "install").slice(0, 2);
          const finalList = preferred.length ? preferred.slice(0, 4) : fallback;
          installEl.innerHTML = finalList.length ? finalList.map(jobCardHtml).join("") : "";
        }
      }
  
      function renderJobs(jobs) {
        if (!adbJobsList) return;
        adbJobs = jobs || [];
        if (!jobs?.length) {
          adbJobsList.innerHTML = `<div class="adb-fs-empty">暂无任务</div>`;
          if (adbJobsMeta) adbJobsMeta.textContent = "暂无任务";
          renderInlineJobs();
          updateMediaPreviewFromJobs(jobs);
          return;
        }
        if (adbJobsMeta) adbJobsMeta.textContent = `${jobs.length} 条最近任务`;
        adbJobsList.innerHTML = jobs.map(jobCardHtml).join("");
        renderInlineJobs();
        updateMediaPreviewFromJobs(jobs);
      }
  
      function updateMediaPreviewFromJobs(jobs) {
        if ($("#adb-media-meta")) {
          const arts = (jobs || []).reduce((n, j) => n + ((j.artifacts || []).length || 0), 0);
          const running = (jobs || []).filter((j) => j.status === "running" || j.status === "pending").length;
          $("#adb-media-meta").textContent = running
            ? `${running} 个任务进行中 · 产物 ${arts}`
            : arts
              ? `可预览/打包 · 产物 ${arts}`
              : "截图支持多设备；录屏针对当前设备";
        }
        const preview = $("#adb-media-preview");
        if (!preview) return;
        const shot = (jobs || []).find(
          (j) =>
            j.type === "screenshot" &&
            (j.status === "done" || j.status === "completed" || j.status === "success") &&
            (j.artifacts || []).some((a) => /\.png$/i.test(a.name || ""))
        );
        if (!shot) return;
        const art = (shot.artifacts || []).find((a) => /\.png$/i.test(a.name || ""));
        if (!art) return;
        if (preview.dataset.adbPreviewJob === shot.id && preview.dataset.adbPreviewName === art.name) return;
        preview.dataset.adbPreviewJob = shot.id;
        preview.dataset.adbPreviewName = art.name;
        adbFetch(`/jobs/${encodeURIComponent(shot.id)}/artifact/${encodeURIComponent(art.name)}`)
          .then((res) => res.blob())
          .then((blob) => {
            const url = URL.createObjectURL(blob);
            const others = (shot.artifacts || [])
              .map(
                (a) =>
                  `<button type="button" class="secondary-btn" data-adb-art-job="${escapeHtml(shot.id)}" data-adb-art-name="${escapeHtml(a.name)}">下载 ${escapeHtml(a.name)}</button>`
              )
              .join("");
            preview.innerHTML = `<img alt="截图预览" src="${url}" /><div class="adb-job-arts" style="margin-top:0.55rem">${others}<button type="button" class="ghost-btn" data-adb-job-zip="${escapeHtml(shot.id)}">打包下载全部</button></div>`;
            preview.hidden = false;
          })
          .catch(() => {});
      }
  
      async function loadAdbInfo(serial) {
        if (!serial) {
          fillAdbInfo(null);
          return;
        }
        try {
          const data = await adbFetch(`/device/info?serial=${encodeURIComponent(serial)}`);
          fillAdbInfo(data.info);
        } catch (err) {
          fillAdbInfo({ serial, state: "error", ready: false, message: err.message || String(err) });
          setError(adbError, err.message || String(err));
        }
      }
  
      function updateHostToolsProbe(health) {
        adbBridgeFeatures = Array.isArray(health?.features) ? health.features.slice() : [];
        adbBridgeVersion = health?.version ? String(health.version) : "";
        const el = $("#adb-tools-probe");
        if (!el) return;
        const tools = health?.tools || {};
        const bits = ["adb", "keytool", "apksigner", "openssl", "aapt"]
          .map((name) => {
            const t = tools[name];
            if (!t) return null;
            const pathHint = t.ok && t.path ? `（${String(t.path).split(/[/\\]/).slice(-2).join("/")}）` : "";
            return `${name}${t.ok ? "✓" : "✗"}${name === "keytool" && t.ok ? pathHint : ""}`;
          })
          .filter(Boolean);
        const ver = health?.version ? `桥 ${health.version}` : "";
        const setupBits = [];
        if (health?.setup?.adb) setupBits.push(health.setup.adb);
        if (health?.setup?.signing) setupBits.push(health.setup.signing);
        el.textContent = [
          bits.length ? `本机工具：${bits.join(" · ")}` : "连接桥后显示本机工具探测",
          ver,
          setupBits.length ? setupBits.join(" ") : "",
        ]
          .filter(Boolean)
          .join(" · ");
        const signGuide = $("#adb-signing-guide");
        if (signGuide) {
          const signingOk =
            health?.signingOk === true ||
            tools.keytool?.ok ||
            tools.apksigner?.ok ||
            tools.openssl?.ok;
          // Show guide when connected and signing tools missing; keep hidden until we know
          if (health?.tools) signGuide.hidden = Boolean(signingOk);
        }
        syncLocalSaveMeta();
        applyAdbFeatureGates(health);
      }
  
      function bridgeHas(feature) {
        return adbBridgeFeatures.includes(feature);
      }
  
      function bridgeAtLeast(ver) {
        const cur = String(adbBridgeVersion || "")
          .split(".")
          .map((n) => Number(n) || 0);
        const need = String(ver || "")
          .split(".")
          .map((n) => Number(n) || 0);
        for (let i = 0; i < Math.max(cur.length, need.length); i++) {
          const a = cur[i] || 0;
          const b = need[i] || 0;
          if (a > b) return true;
          if (a < b) return false;
        }
        return true;
      }
  
      function applyAdbFeatureGates(health) {
        const connected = Boolean(health?.version);
        const bundle = $("#adb-dl-bundle");
        if (bundle) bundle.classList.toggle("is-hidden", connected);
  
        const inputRefresh = $("#adb-input-refresh-shot");
        const inputLive = $("#adb-input-live-stop");
        const canInput = !health || bridgeHas("screencap") || bridgeHas("input") || bridgeAtLeast("0.6.8");
        const canMirror = !health || bridgeHas("mirror") || bridgeHas("scrcpy-mirror") || bridgeAtLeast("0.7.0");
        const mirrorBtn = $("#adb-input-mirror-start");
        if (mirrorBtn) {
          mirrorBtn.disabled = !canMirror && Boolean(health);
          mirrorBtn.title = canMirror ? "" : "镜像需桥 ≥0.8.4（含 scrcpy-mirror 诊断）";
        }
        if (inputRefresh) {
          inputRefresh.disabled = Boolean(health) && !canInput;
          inputRefresh.title = canInput ? "" : "当前桥版本过旧，请更新到 ≥0.6.8";
        }
        if (inputLive && !canInput) inputLive.hidden = true;
  
        const analyzeBtn = $("#adb-apk-analyze");
        const canSign = !health || bridgeHas("apk-signing") || bridgeHas("apk-info") || bridgeAtLeast("0.6.10");
        if (analyzeBtn) {
          analyzeBtn.title = canSign ? "" : "签名分析需桥 ≥0.6.10";
        }
  
        const logLevel = $("#adb-log-level");
        if (logLevel) {
          const ok = !health || bridgeHas("logcat-level") || bridgeAtLeast("0.6.12");
          logLevel.disabled = Boolean(health) && !ok;
          logLevel.title = ok ? "" : "级别过滤需桥 ≥0.6.12";
        }
      }
  
      function canLocalPull() {
        return Boolean(adbLocalPath) && (bridgeHas("local-pull") || bridgeAtLeast("0.6.11"));
      }
  
      function canFsZip() {
        return bridgeHas("fs-zip") || bridgeAtLeast("0.6.12");
      }
  
      function syncLocalSaveMeta() {
        const meta = $("#adb-fs-local-meta");
        if (!meta) return;
        if (!adbConnected) {
          meta.textContent = "连接桥后可设置本机目录";
          return;
        }
        if (!canLocalPull()) {
          meta.textContent = adbBridgeVersion
            ? `桥 ${adbBridgeVersion} 无本机直存，请更新 ≥0.6.11`
            : "下载落点（需桥 ≥0.6.11）";
          return;
        }
        if (!adbLocalPath) {
          meta.textContent = "请选择本机目录作为下载落点";
          return;
        }
        meta.textContent = `落点：${adbLocalPath}`;
      }
  
      function updateFsHistButtons() {
        const back = $("#adb-fs-back");
        const forward = $("#adb-fs-forward");
        if (back) back.disabled = adbFsHistIdx <= 0;
        if (forward) forward.disabled = adbFsHistIdx < 0 || adbFsHistIdx >= adbFsHistory.length - 1;
      }
  
      function pushFsHistory(path, mode) {
        if (mode === "none") {
          updateFsHistButtons();
          return;
        }
        if (mode === "replace") {
          if (adbFsHistIdx >= 0) adbFsHistory[adbFsHistIdx] = path;
          else {
            adbFsHistory = [path];
            adbFsHistIdx = 0;
          }
          updateFsHistButtons();
          return;
        }
        if (adbFsHistIdx >= 0 && adbFsHistory[adbFsHistIdx] === path) {
          updateFsHistButtons();
          return;
        }
        adbFsHistory = adbFsHistory.slice(0, adbFsHistIdx + 1);
        adbFsHistory.push(path);
        adbFsHistIdx = adbFsHistory.length - 1;
        updateFsHistButtons();
      }
  
      function resetFsHistory() {
        adbFsHistory = [];
        adbFsHistIdx = -1;
        updateFsHistButtons();
      }
  
      function updateFsWriteState() {
        const uploadInput = $("#adb-fs-upload");
        const uploadDirInput = $("#adb-fs-upload-dir");
        const mkdirBtn = $("#adb-fs-mkdir");
        const pasteBtn = $("#adb-fs-paste");
        const writable = adbFsDirWritable !== false;
        [uploadInput, uploadDirInput].forEach((input) => {
          if (!input) return;
          input.disabled = !writable;
          const label = input.id ? document.querySelector(`label[for="${input.id}"]`) : null;
          if (label) label.classList.toggle("is-disabled", !writable);
        });
        if (mkdirBtn) mkdirBtn.disabled = !writable;
        if (pasteBtn) pasteBtn.disabled = !writable || !clipboardItems().length;
        syncLocalPushBtn();
      }
  
      async function loadFs(pathValue, { history = "push" } = {}) {
        if (!adbSelected) {
          toast("请先选择设备");
          return;
        }
        const pathText = pathValue || adbFsPath?.value || "/";
        if (adbFsPath) adbFsPath.value = pathText;
        const filterEl = $("#adb-fs-filter");
        if (filterEl && filterEl.value) filterEl.value = "";
        renderFsCrumbs(pathText);
        if (adbFsMeta) adbFsMeta.textContent = "加载中…";
        const accessEl = $("#adb-fs-access");
        try {
          const data = await adbFetch(
            `/fs/list?serial=${encodeURIComponent(adbSelected)}&path=${encodeURIComponent(pathText)}`
          );
          const resolved = data.path || pathText;
          adbFsDirWritable = data.writable !== false;
          renderFsEntries(resolved, data.entries || []);
          if (adbFsPath) adbFsPath.value = resolved;
          renderFsCrumbs(resolved);
          pushFsHistory(resolved, history);
          updateFsWriteState();
          if (adbFsMeta) {
            const total = (data.entries || []).length;
            adbFsMeta.textContent = `${total} 项 · ${resolved}${adbFsDirWritable ? "" : " · 只读"}`;
          }
          if (accessEl && (data.access || data.note)) {
            accessEl.hidden = false;
            accessEl.textContent = [data.access && `访问方式：${data.access}`, data.note]
              .filter(Boolean)
              .join(" · ");
          }
          setError(adbError, "");
        } catch (err) {
          adbFsEntriesCache = [];
          adbFsPathCache = pathText;
          if (adbFsList) adbFsList.innerHTML = `<div class="adb-fs-empty">${escapeHtml(err.message || String(err))}</div>`;
          if (adbFsMeta) adbFsMeta.textContent = "读取失败";
          setError(adbError, err.message || String(err));
        }
      }
  
      async function loadApps() {
        if (!adbSelected) return;
        if (adbAppsMeta) adbAppsMeta.textContent = "加载应用名中…（首次可能较慢）";
        const kind = $("#adb-apps-kind")?.value || "third";
        const data = await adbFetch(
          `/apps?serial=${encodeURIComponent(adbSelected)}&kind=${encodeURIComponent(kind)}`
        );
        adbApps = data.apps || [];
        const resolved =
          data.labelResolved != null
            ? Number(data.labelResolved)
            : adbApps.filter((a) => sanitizeAppLabel(a.label) && sanitizeAppLabel(a.label) !== a.packageName).length;
        if (adbAppsMeta) {
          adbAppsMeta.textContent = `${adbApps.length} 个 · 应用名 ${resolved}/${adbApps.length} · ${
            adbSelected || "未选择"
          }`;
        }
        renderApps();
        if (data.labelNote) {
          const tip = $("#adb-apps-label-tip");
          if (tip) {
            tip.hidden = false;
            tip.textContent = data.labelNote;
          } else if (resolved < Math.min(3, adbApps.length)) {
            toast(data.labelNote);
          }
        } else {
          const tip = $("#adb-apps-label-tip");
          if (tip) tip.hidden = true;
        }
      }
  
      async function loadSnapshot({ silent = false } = {}) {
        const serial = requireCurrentSerial();
        const snapMeta = $("#adb-snap-meta");
        const out = $("#adb-snap-out");
        if (snapMeta) snapMeta.textContent = "加载中…";
        const data = await adbFetch(`/device/snapshot?serial=${encodeURIComponent(serial)}`);
        const text = [
          `前台:\n${data.foreground || "—"}`,
          `uptime: ${data.uptime || "—"}`,
          `屏幕常亮(stay_on_while_plugged_in): ${data.stayOnWhilePluggedIn || "—"}`,
          `\n磁盘:\n${data.disk || "—"}`,
          `\n内存:\n${data.meminfo || "—"}`,
          `\n进程:\n${data.top || "—"}`,
        ].join("\n");
        if (out) out.textContent = text;
        if (snapMeta) snapMeta.textContent = "已更新";
        if (!silent) toast("快照已刷新");
      }
  
      async function deviceControl(action) {
        const serial = requireCurrentSerial();
        const data = await adbFetch("/device/control", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serial, action }),
        });
        toast(data.message || "已执行");
        return data;
      }
  
      async function fetchLogcat({ silent = false } = {}) {
        const serial = requireCurrentSerial();
        const lines = Number($("#adb-log-lines")?.value || 400);
        const packageName = String($("#adb-log-package")?.value || "").trim();
        const query = String($("#adb-log-query")?.value || "").trim();
        const tag = String($("#adb-log-tag")?.value || "").trim();
        const level = String($("#adb-log-level")?.value || "").trim();
        const params = new URLSearchParams({
          serial,
          lines: String(lines),
        });
        if (packageName) params.set("package", packageName);
        if (query) params.set("query", query);
        if (tag) params.set("tag", tag);
        if (level) params.set("level", level);
        if (!silent && $("#adb-log-meta")) $("#adb-log-meta").textContent = "拉取中…";
        const data = await adbFetch(`/logcat?${params.toString()}`);
        if ($("#adb-log-out")) $("#adb-log-out").textContent = data.text || "(无日志)";
        const note = data.note ? ` · ${data.note}` : "";
        if ($("#adb-log-meta")) {
          $("#adb-log-meta").textContent = `${adbLogLive ? "实时" : "已拉取"} ${data.lines || 0} 行${note}`;
        }
        if ($("#adb-log-note") && data.note) $("#adb-log-note").textContent = data.note;
        return data;
      }
  
      function stopAdbLogLive() {
        adbLogLive = false;
        clearInterval(adbLogLiveTimer);
        adbLogLiveTimer = 0;
        const live = $("#adb-log-live");
        if (live) {
          if (live.type === "checkbox") live.checked = false;
          else live.classList.remove("is-active");
        }
      }
  
      function startAdbLogLive() {
        adbLogLive = true;
        clearInterval(adbLogLiveTimer);
        const live = $("#adb-log-live");
        if (live) {
          if (live.type === "checkbox") live.checked = true;
          else live.classList.add("is-active");
        }
        fetchLogcat({ silent: true }).catch((err) => setError(adbError, err.message || String(err)));
        adbLogLiveTimer = setInterval(() => {
          if (!adbLogLive || adbTab !== "logcat") {
            stopAdbLogLive();
            return;
          }
          fetchLogcat({ silent: true }).catch(() => {});
        }, 2000);
      }
  
      function toggleAdbLogLive(force) {
        const next = force == null ? !adbLogLive : Boolean(force);
        if (next) startAdbLogLive();
        else stopAdbLogLive();
      }
  
      async function selectAdbDevice(serial) {
        if (serial !== adbSelected) resetGetpropPanel();
        adbSelected = serial;
        renderAdbDevices();
        resetFsHistory();
        await loadAdbInfo(serial);
        await loadFs("/");
        if (adbTab === "apps") await loadApps();
        if (adbTab === "info") await loadSnapshot({ silent: true }).catch(() => {});
      }
  
      function markAdbBridgeConnected(data) {
        adbConnected = true;
        if (adbWorkspace) adbWorkspace.hidden = false;
        if ($("#adb-refresh")) $("#adb-refresh").disabled = false;
        const adbLine = data?.adb?.version || "adb ok";
        const count = adbDevices.length;
        setAdbStatus(
          count ? "is-ok" : "is-warn",
          count ? `已连接 · ${count} 台设备` : "已连接桥 · 无设备",
          `${adbLine}。支持文件 / 安装 / 应用 / 截图录屏。`
        );
      }
  
      async function refreshAdbDevices({ silent = false } = {}) {
        const data = await adbFetch("/devices");
        adbDevices = data.devices || [];
        const serialSet = new Set(adbDevices.map((d) => d.serial));
        adbChecked = new Set([...adbChecked].filter((s) => serialSet.has(s)));
        if (!adbSelected || !serialSet.has(adbSelected)) {
          const ready = adbDevices.find((d) => d.state === "device");
          adbSelected = (ready || adbDevices[0] || {}).serial || "";
        }
        if (!adbChecked.size && adbSelected) adbChecked.add(adbSelected);
        renderAdbDevices();
        markAdbBridgeConnected(data);
        if (adbSelected) {
          try {
            await loadAdbInfo(adbSelected);
            resetFsHistory();
            await loadFs(adbFsPath?.value || "/");
          } catch (err) {
            if (!silent) setError(adbError, err.message || String(err));
          }
        } else {
          fillAdbInfo(null);
          if (adbFsList) adbFsList.innerHTML = `<div class="adb-fs-empty">请选择设备</div>`;
        }
        if (!silent) toast(adbDevices.length ? `已刷新 ${adbDevices.length} 台设备` : "桥已连接，未发现设备");
      }
  
      async function resolveAdbBridgeDiscovery() {
        let discovered = await window.devtoolsBridgeToken?.discoverBase?.(adbBase(), adbToken(), { kind: "unified" });
        if (discovered?.health) return discovered;
        const directBase = normalizeAdbBase(adbBase());
        try {
          const health = await window.devtoolsBridgeToken?.probeHealth?.(directBase, adbToken(), true);
          if (health) return { base: directBase, health };
        } catch (_) {
          /* fall through */
        }
        return null;
      }
  
      async function connectAdbBridge({ fromPoll = false } = {}) {
        persistAdbSettings();
        setError(adbError, "");
        try {
          const discovered = await resolveAdbBridgeDiscovery();
          if (!discovered?.health) {
            throw new Error(
              "无法连接本机桥。请确认启动脚本窗口仍打开；若横幅端口不是 17888，点连接会自动扫描 17888–17899。Token 默认 devtools-bridge。"
            );
          }
          if (adbBaseInput && normalizeAdbBase(adbBaseInput.value) !== discovered.base) {
            adbBaseInput.value = discovered.base;
            persistAdbSettings();
            try {
              localStorage.setItem("devtools-ffmpeg-base", discovered.base);
            } catch (_) {
              /* ignore */
            }
          }
          let health = discovered.health;
          try {
            window.devtoolsBridgeToken?.rememberFromHealth?.(health);
            const dir = window.devtoolsBridgeToken?.readInstallDir?.() || "";
            const dirInput = $("#adb-install-dir");
            if (dirInput && dir) dirInput.value = dir;
          } catch (_) {
            /* ignore */
          }
          updateHostToolsProbe(health);
          let adbReady = health.adb?.ok === true;
          if (!adbReady) {
            try {
              const dev = await adbFetch("/devices");
              adbReady = dev?.ok !== false;
              if (dev?.adb) health = { ...health, adb: dev.adb };
            } catch (_) {
              adbReady = false;
            }
          }
          if (!adbReady) {
            adbConnected = true;
            if (adbWorkspace) adbWorkspace.hidden = true;
            if ($("#adb-refresh")) $("#adb-refresh").disabled = true;
            const setupMsg =
              health.setup?.adb ||
              health.adb?.setup ||
              "请安装 platform-tools 并确保 adb 在 PATH 中，然后重启桥";
            setAdbStatus("is-err", "桥已启动，但未找到 adb", setupMsg);
            setError(
              adbError,
              health.adb?.error ||
                (isAdbSetupGuideHidden()
                  ? "本机未找到 adb 命令。请安装 platform-tools 并加入 PATH。"
                  : "本机未找到 adb 命令。见上方「本机依赖怎么配？」")
            );
            return false;
          }
          await refreshAdbDevices({ silent: fromPoll });
          return true;
        } catch (err) {
          if (fromPoll && adbConnected) {
            try {
              await refreshAdbDevices({ silent: true });
            } catch (_) {
              /* keep last good UI */
            }
            return true;
          }
          try {
            await refreshAdbDevices({ silent: true });
            setError(adbError, "");
            return true;
          } catch (_) {
            /* fall through to disconnected UI */
          }
          adbConnected = false;
          if (adbWorkspace) adbWorkspace.hidden = true;
          if ($("#adb-refresh")) $("#adb-refresh").disabled = true;
          updateHostToolsProbe(null);
          setAdbStatus(
            "is-err",
            "未连接本机桥",
            fromPoll
              ? "已下载完整包的话，请解压并运行启动脚本（同目录需有 server.js），保持窗口打开；正在等待桥启动…"
              : "请先下载完整 ZIP 并运行启动脚本，再点连接。需本机已安装 adb（platform-tools 加入 PATH）。"
          );
          if (!fromPoll) setError(adbError, err.message || "无法连接本机桥");
          return false;
        }
      }
  
      function startAdbWaitPoll() {
        clearInterval(adbPollTimer);
        let tries = 0;
        adbPollTimer = setInterval(async () => {
          tries += 1;
          const ok = await connectAdbBridge({ fromPoll: true });
          if (ok || tries >= 60) clearInterval(adbPollTimer);
        }, 2000);
      }
  
      function downloadBlobFile(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
      }
  
      async function fetchTextAsset(path) {
        const res = await fetch(path, { cache: "no-cache" });
        if (!res.ok) throw new Error(`无法读取 ${path}（${res.status}）`);
        return res.text();
      }
  
      async function downloadAdbBridgeBundle(platform) {
        if (adbBundleBusy) {
          toast("正在准备下载包…");
          return;
        }
        if (adbBridgeShell?.downloadBundle) {
          adbBundleBusy = true;
          try {
            await adbBridgeShell.downloadBundle(platform, {
              onDone: () => {
                toast("已下载完整包，请解压后运行");
                startAdbWaitPoll();
              },
            });
          } finally {
            adbBundleBusy = false;
          }
          return;
        }
        adbBundleBusy = true;
        setError(adbError, "");
        setAdbBundleProgress(true, { pct: 4, text: "准备打包工具…" });
        toast("正在准备完整包，请稍候…");
        try {
          const api = window.devtoolsUnifiedBridgeBundle;
          if (!api?.download) throw new Error("统一完整包模块未加载，请硬刷新页面");
          await api.download(platform, {
            onProgress: (p) => setAdbBundleProgress(true, p),
          });
          setAdbStatus(
            "is-warn",
            "等待本机桥启动…",
            "完整包已下载。请解压后运行启动脚本（同目录需有 server.js），并保持窗口打开；网页会自动重试连接。"
          );
          toast("已下载完整包，请解压后运行");
          startAdbWaitPoll();
          setAdbBundleProgress(true, { pct: 100, text: "下载已开始" });
        } finally {
          adbBundleBusy = false;
          setAdbBundleProgress(false);
        }
      }
  
      async function downloadAdbScriptAndWait(anchor) {
        const platform = anchor?.dataset?.adbBundle;
        if (platform) {
          try {
            await downloadAdbBridgeBundle(platform);
          } catch (err) {
            setError(adbError, err.message || String(err));
            setAdbStatus("is-err", "下载失败", err.message || String(err));
          }
          return;
        }
        const href = anchor?.getAttribute("href");
        const filename = anchor?.getAttribute("download") || "start-adb-bridge";
        if (href) {
          const a = document.createElement("a");
          a.href = href;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
        }
        setAdbStatus("is-warn", "等待本机桥启动…", "脚本开始下载。请双击运行，并保持终端窗口打开；网页会自动重试连接。");
        toast("请运行下载的启动脚本");
        startAdbWaitPoll();
      }
  
      function xhrUploadFile(file, dir, filename, { signal, onProgress } = {}) {
        return new Promise((resolve, reject) => {
          if (signal?.aborted) {
            reject(new DOMException("aborted", "AbortError"));
            return;
          }
          const xhr = new XMLHttpRequest();
          const url = `${adbBase()}/fs/upload?serial=${encodeURIComponent(adbSelected)}&path=${encodeURIComponent(dir)}&name=${encodeURIComponent(filename)}`;
          xhr.open("POST", url);
          xhr.setRequestHeader("X-Adb-Token", adbToken());
          xhr.setRequestHeader("Content-Type", "application/octet-stream");
          xhr.setRequestHeader("X-Filename", encodeURIComponent(filename));
          xhr.upload.onprogress = (e) => {
            if (onProgress) onProgress(e.loaded || 0, e.total || Number(file.size) || 0);
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
              resolve();
              return;
            }
            let msg = `上传失败 (${xhr.status})`;
            try {
              const data = JSON.parse(xhr.responseText);
              if (data?.error) msg = data.error;
            } catch (_) {
              /* ignore parse error */
            }
            reject(new Error(msg));
          };
          xhr.onerror = () => reject(new Error("网络错误，上传失败"));
          xhr.onabort = () => reject(new DOMException("aborted", "AbortError"));
          const onAbort = () => xhr.abort();
          if (signal) signal.addEventListener("abort", onAbort, { once: true });
          const cleanup = () => signal?.removeEventListener("abort", onAbort);
          xhr.addEventListener("loadend", cleanup);
          xhr.send(file);
        });
      }
  
      async function uploadAdbFiles(fileList, { relativePaths = false } = {}) {
        if (!adbSelected) return;
        const files = [...fileList];
        if (!files.length) return;
        if (!adbFsDirWritable) {
          toast("当前目录只读，无法上传");
          return;
        }
        if (adbFsXferBusy) {
          toast("已有传输进行中");
          return;
        }
        const dir = adbFsPath?.value || "/";
        setError(adbError, "");
        const totalBytes = files.reduce((sum, f) => sum + (Number(f.size) || 0), 0) || files.length;
        let doneBytes = 0;
        const started = performance.now();
        adbFsXferBusy = true;
        const controller = new AbortController();
        adbFsXferAbort = controller;
        const madeDirs = new Set();
        try {
          for (let i = 0; i < files.length; i++) {
            if (controller.signal.aborted) throw new DOMException("aborted", "AbortError");
            const file = files[i];
            const fileSize = Number(file.size) || 0;
            const relPath = (relativePaths && file.webkitRelativePath) || file.name;
            const relDir = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/")) : "";
            const targetDir = relDir ? joinRemote(dir, relDir) : dir;
            const filename = basenameRemote(relPath) || file.name;
            if (relDir && !madeDirs.has(targetDir)) {
              madeDirs.add(targetDir);
              try {
                await adbFetch("/fs/mkdir", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ serial: adbSelected, path: targetDir }),
                  signal: controller.signal,
                });
              } catch (_) {
                /* 目录可能已存在；若确实无权限会在上传时报错 */
              }
            }
            let lastLoaded = 0;
            updateFsXfer({
              title: `上传 ${i + 1}/${files.length}`,
              name: relPath,
              loaded: doneBytes,
              total: totalBytes,
              started,
            });
            await xhrUploadFile(file, targetDir, filename, {
              signal: controller.signal,
              onProgress: (loaded) => {
                doneBytes += loaded - lastLoaded;
                lastLoaded = loaded;
                updateFsXfer({
                  title: `上传 ${i + 1}/${files.length}`,
                  name: relPath,
                  loaded: Math.min(doneBytes, totalBytes),
                  total: totalBytes,
                  started,
                });
              },
            });
            doneBytes += Math.max(0, fileSize - lastLoaded);
          }
          toast(`已上传 ${files.length} 个文件`);
          await loadFs(dir, { history: "replace" });
        } catch (err) {
          if (err?.name === "AbortError") {
            toast("已取消上传");
            await loadFs(dir, { history: "replace" }).catch(() => {});
          } else {
            throw err;
          }
        } finally {
          adbFsXferBusy = false;
          adbFsXferAbort = null;
          hideFsXfer();
        }
      }
  
      async function pullRemoteToLocalDir(remotePath, name, { signal } = {}) {
        if (!canLocalPull()) throw new Error("本机直存不可用");
        return adbFetch("/local/pull", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            serial: adbSelected,
            remotePath,
            localDir: adbLocalPath,
            name: name || basenameRemote(remotePath),
          }),
          signal,
        });
      }
  
      async function downloadAdbFile(remotePath, name, { nested = false, signal: parentSignal } = {}) {
        if (!adbSelected) return;
        let controller = null;
        if (!nested) {
          if (adbFsXferBusy) {
            toast("已有传输进行中");
            return;
          }
          adbFsXferBusy = true;
          controller = new AbortController();
          adbFsXferAbort = controller;
        }
        const signal = parentSignal || controller?.signal;
        const started = performance.now();
        try {
          updateFsXfer({ title: nested ? "批量下载" : "下载中", name: name || remotePath, loaded: 0, total: 0, started });
          if (adbFsMeta) adbFsMeta.textContent = `下载中：${name || remotePath}`;
          if (canLocalPull()) {
            const data = await pullRemoteToLocalDir(remotePath, name, { signal });
            updateFsXfer({
              title: nested ? "批量下载" : "已保存到本机",
              name: data.localPath || name || remotePath,
              loaded: data.size || 1,
              total: data.size || 1,
              started,
            });
            if (!nested) toast(`已保存到 ${data.localPath || adbLocalPath}`);
            if (adbFsMeta) adbFsMeta.textContent = `已保存 ${name || ""} → ${adbLocalPath}`;
            loadLocalPath(adbLocalPath).catch(() => {});
            return data;
          }
          const res = await adbFetch(
            `/fs/download?serial=${encodeURIComponent(adbSelected)}&path=${encodeURIComponent(remotePath)}`,
            signal ? { signal } : {}
          );
          const total = Number(res.headers.get("content-length")) || 0;
          let blob;
          if (res.body && typeof res.body.getReader === "function") {
            const reader = res.body.getReader();
            const chunks = [];
            let loaded = 0;
            while (true) {
              if (signal?.aborted) {
                try {
                  await reader.cancel();
                } catch (_) {
                  /* ignore */
                }
                throw new DOMException("aborted", "AbortError");
              }
              const { done, value } = await reader.read();
              if (done) break;
              chunks.push(value);
              loaded += value.byteLength || 0;
              updateFsXfer({
                title: nested ? "批量下载" : "下载中",
                name: name || remotePath,
                loaded,
                total: total || loaded,
                started,
              });
            }
            blob = new Blob(chunks);
          } else {
            blob = await res.blob();
            updateFsXfer({
              title: nested ? "批量下载" : "下载中",
              name: name || remotePath,
              loaded: blob.size,
              total: blob.size,
              started,
            });
          }
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = name || "download.bin";
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
          if (!nested) toast("已开始下载到浏览器默认目录");
          if (adbFsMeta) adbFsMeta.textContent = `已下载 ${name || ""}`;
        } finally {
          if (!nested) {
            adbFsXferBusy = false;
            adbFsXferAbort = null;
            hideFsXfer();
          }
        }
      }
  
      async function downloadFolderBlob(remoteDir, { onProgress, signal, maxFiles = 400 } = {}) {
        const Zip = await ensureJsZip();
        const zip = new Zip();
        const queue = [{ remote: remoteDir, rel: "" }];
        let count = 0;
        let skipped = false;
        while (queue.length) {
          if (signal?.aborted) throw new DOMException("aborted", "AbortError");
          const { remote, rel } = queue.shift();
          const data = await adbFetch(
            `/fs/list?serial=${encodeURIComponent(adbSelected)}&path=${encodeURIComponent(remote)}`,
            signal ? { signal } : {}
          );
          for (const item of data.entries || []) {
            if (signal?.aborted) throw new DOMException("aborted", "AbortError");
            const childRemote = joinRemote(data.path || remote, item.name);
            const childRel = rel ? `${rel}/${item.name}` : item.name;
            if (item.type === "dir" && !item.virtual) {
              queue.push({ remote: childRemote, rel: childRel });
              continue;
            }
            if (item.virtual) continue;
            if (count >= maxFiles) {
              skipped = true;
              continue;
            }
            count += 1;
            if (onProgress) onProgress({ count, name: childRel });
            try {
              const res = await adbFetch(
                `/fs/download?serial=${encodeURIComponent(adbSelected)}&path=${encodeURIComponent(childRemote)}`,
                signal ? { signal } : {}
              );
              const blob = await res.blob();
              zip.file(childRel, blob);
            } catch (err) {
              zip.file(`${childRel}.error.txt`, String(err.message || err));
            }
          }
        }
        if (!count) throw new Error("文件夹为空或无可下载文件");
        const blob = await zip.generateAsync({ type: "blob" });
        return { blob, count, skipped };
      }
  
      async function downloadFolder(remotePath, name) {
        if (!adbSelected) return;
        if (adbFsXferBusy) {
          toast("已有传输进行中");
          return;
        }
        adbFsXferBusy = true;
        const controller = new AbortController();
        adbFsXferAbort = controller;
        const started = performance.now();
        try {
          if (canLocalPull()) {
            updateFsXfer({ title: "拉取文件夹到本机", name: name || remotePath, loaded: 0, total: 0, started });
            const data = await pullRemoteToLocalDir(remotePath, name, { signal: controller.signal });
            toast(`文件夹已保存到 ${data.localPath || adbLocalPath}`);
            loadLocalPath(adbLocalPath).catch(() => {});
            return;
          }
          if (canFsZip()) {
            updateFsXfer({ title: "桥端打包文件夹", name: name || remotePath, loaded: 0, total: 0, started });
            const res = await adbFetch(
              `/fs/zip?serial=${encodeURIComponent(adbSelected)}&path=${encodeURIComponent(remotePath)}`,
              { signal: controller.signal }
            );
            const blob = await res.blob();
            downloadBlobFile(blob, `${name || basenameRemote(remotePath) || "folder"}.zip`);
            toast(`已下载 ${formatBytes(blob.size)}（桥端打包）`);
            return;
          }
          updateFsXfer({ title: "打包文件夹", name: name || remotePath, loaded: 0, total: 0, started });
          const { blob, count, skipped } = await downloadFolderBlob(remotePath, {
            signal: controller.signal,
            onProgress: ({ count: c, name: n }) => {
              updateFsXfer({ title: `打包文件夹 (${c})`, name: n, loaded: c, total: 0, started });
            },
          });
          downloadBlobFile(blob, `${name || basenameRemote(remotePath) || "folder"}.zip`);
          toast(skipped ? `已打包 ${count} 个文件（已达上限，部分文件未包含）` : `已打包 ${count} 个文件`);
        } catch (err) {
          if (err?.name === "AbortError") {
            toast("已取消打包下载");
          } else {
            throw err;
          }
        } finally {
          adbFsXferBusy = false;
          adbFsXferAbort = null;
          hideFsXfer();
        }
      }
  
      function formatFsSpeed(bytesPerSec) {
        if (!Number.isFinite(bytesPerSec) || bytesPerSec <= 0) return "";
        return `${formatBytes(bytesPerSec)}/s`;
      }
  
      function updateFsXfer({ title, name, loaded, total, started }) {
        const box = $("#adb-fs-xfer");
        if (!box) return;
        box.hidden = false;
        const titleEl = $("#adb-fs-xfer-title");
        const metaEl = $("#adb-fs-xfer-meta");
        const fill = $("#adb-fs-xfer-fill");
        if (titleEl) titleEl.textContent = title || "传输中";
        const pct = total > 0 ? Math.max(0, Math.min(100, Math.round((loaded / total) * 100))) : 0;
        const elapsed = Math.max(0.001, (performance.now() - (started || performance.now())) / 1000);
        const speed = loaded > 0 ? formatFsSpeed(loaded / elapsed) : "";
        const sizeBit =
          total > 0 ? `${formatBytes(loaded)} / ${formatBytes(total)}` : loaded > 0 ? formatBytes(loaded) : "…";
        if (metaEl) {
          metaEl.textContent = [name, sizeBit, speed && `· ${speed}`, total > 0 && `${pct}%`].filter(Boolean).join(" ");
        }
        if (fill) fill.style.width = `${total > 0 ? pct : Math.min(95, 12 + (loaded ? 40 : 0))}%`;
        if (adbFsMeta && name) adbFsMeta.textContent = `${title || "传输"}：${name}`;
      }
  
      function hideFsXfer() {
        const box = $("#adb-fs-xfer");
        if (box) box.hidden = true;
        const fill = $("#adb-fs-xfer-fill");
        if (fill) fill.style.width = "0%";
      }
  
      async function downloadArtifact(jobId, name) {
        const res = await adbFetch(`/jobs/${encodeURIComponent(jobId)}/artifact/${encodeURIComponent(name)}`);
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        toast("已开始下载");
      }
  
      function watchJobs() {
        clearInterval(adbJobTimer);
        adbJobTimer = setInterval(() => {
          if (!adbConnected) return;
          if (adbTab === "jobs" || document.visibilityState === "visible") {
            refreshJobs({ silent: true }).catch(() => {});
          }
        }, 1500);
      }
  
      async function refreshJobs({ silent = false } = {}) {
        const data = await adbFetch("/jobs");
        renderJobs(data.jobs || []);
        if (!silent) toast("任务已刷新");
      }
  
      async function trackJob(job, { stay = true } = {}) {
        if (job?.id) adbTrackedJobs.add(job.id);
        if (!stay) switchAdbTab("jobs");
        toast(`任务已创建：${jobTypeLabel(job.type)}${stay ? "（可在当前页查看进度/下载）" : ""}`);
        await refreshJobs({ silent: true });
        watchJobs();
      }
  
      async function startInstall(serials) {
        if (!adbApkFile) throw new Error("请先选择 APK");
        if (!serials.length) throw new Error("请选择设备");
        const buffer = new Uint8Array(await adbApkFile.arrayBuffer());
        const uploaded = await adbFetch(`/upload?name=${encodeURIComponent(adbApkFile.name)}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Filename": encodeURIComponent(adbApkFile.name),
          },
          body: buffer,
        });
        adbApkUploadId = uploaded.uploadId;
        const payload = {
          uploadId: uploaded.uploadId,
          serials,
          replace: Boolean($("#adb-apk-replace")?.checked),
        };
        if ($("#adb-apk-downgrade")) {
          payload.allowDowngrade = Boolean($("#adb-apk-downgrade").checked);
        }
        const data = await adbFetch("/install", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        await trackJob(data.job);
      }
  
      function setApkButtonsEnabled(on) {
        if ($("#adb-apk-install-selected")) $("#adb-apk-install-selected").disabled = !on;
        if ($("#adb-apk-install-current")) $("#adb-apk-install-current").disabled = !on;
        if ($("#adb-apk-analyze")) $("#adb-apk-analyze").disabled = !on;
        if ($("#adb-apk-push-system")) $("#adb-apk-push-system").disabled = !on;
      }
  
      function setPermTarget(pkg) {
        adbPermPackage = pkg || "";
        if ($("#adb-perm-target")) {
          $("#adb-perm-target").textContent = adbPermPackage
            ? `权限目标：${adbPermPackage}`
            : "勾选应用后可授予/撤销权限";
        }
      }
  
      async function showAppInfo(packageName) {
        const serial = requireCurrentSerial();
        const data = await adbFetch(
          `/apps/info?serial=${encodeURIComponent(serial)}&package=${encodeURIComponent(packageName)}`
        );
        const el = $("#adb-app-detail");
        if (!el) return;
        el.hidden = false;
        el.textContent = [
          `包名: ${data.packageName}`,
          `版本: ${data.versionName || "—"} (${data.versionCode || "—"})`,
          `SDK: min ${data.minSdk || "—"} / target ${data.targetSdk || "—"}`,
          `启动 Activity: ${data.launchActivity || "—"}`,
          `已授予权限 (${(data.grantedPermissions || []).length}):`,
          ...(data.grantedPermissions || []).slice(0, 40),
          "",
          `声明权限 (${(data.permissions || []).length}):`,
          ...(data.permissions || []).slice(0, 40),
          "",
          "预览:",
          data.rawPreview || "",
        ].join("\n");
        setPermTarget(packageName);
        switchAdbTab("apps");
      }
  
      async function analyzeSelectedApk() {
        if (!adbApkFile) throw new Error("请先选择 APK");
        const buffer = new Uint8Array(await adbApkFile.arrayBuffer());
        const uploaded = await adbFetch(`/upload?name=${encodeURIComponent(adbApkFile.name)}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-Filename": encodeURIComponent(adbApkFile.name),
          },
          body: buffer,
        });
        adbApkUploadId = uploaded.uploadId;
        const data = await adbFetch("/apk/info", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ uploadId: uploaded.uploadId }),
        });
        adbApkInfo = data;
        let installedLine = "";
        if (data.packageName && adbSelected) {
          try {
            const installed = await adbFetch(
              `/apps/info?serial=${encodeURIComponent(adbSelected)}&package=${encodeURIComponent(data.packageName)}`
            );
            installedLine = `已安装版本: ${installed.versionName || "—"} (${installed.versionCode || "—"}) · APK: ${data.versionName || "—"} (${data.versionCode || "—"})`;
          } catch (_) {
            installedLine = `已安装版本: 未安装或无法读取 · APK: ${data.versionName || "—"} (${data.versionCode || "—"})`;
          }
        }
        const el = $("#adb-apk-info");
        if (!el) return;
        el.hidden = false;
        el.textContent = [
          `文件: ${data.filename || adbApkFile.name}`,
          `大小: ${formatBytes(data.size || adbApkFile.size)}`,
          `解析工具: ${data.tool || "无"}`,
          data.note || "",
          `应用名: ${data.label || "—"}`,
          `包名: ${data.packageName || "—"}`,
          `版本: ${data.versionName || "—"} (${data.versionCode || "—"})`,
          installedLine,
          `SDK: min ${data.minSdk || "—"} / target ${data.targetSdk || "—"}`,
          `启动: ${data.launchActivity || "—"}`,
          "",
          ...formatApkSigningLines(data),
          "",
          `权限 (${(data.permissions || []).length}):`,
          ...(data.permissions || []).slice(0, 60),
          "",
          data.rawPreview || "",
        ]
          .filter((line) => line !== "")
          .join("\n");
        if ($("#adb-apk-pkg") && data.packageName) $("#adb-apk-pkg").value = data.packageName;
        toast("APK 信息已解析");
      }
  
      function formatApkSigningLines(data) {
        const signing = data?.signing || {};
        const signers = data?.signatures || signing.signers || [];
        const lines = [
          `签名工具: ${signing.tool || "无"}`,
          `签名方案: ${(signing.schemes || []).length ? signing.schemes.join(" / ") : "—"}`,
        ];
        const found = signing.toolsFound
          ? Object.entries(signing.toolsFound)
              .filter(([, v]) => v)
              .map(([k]) => k)
          : [];
        if (signing.toolsFound) {
          lines.push(`本机工具: ${found.length ? found.join(", ") : "未检测到 keytool/openssl/apksigner"}`);
        }
        const paths = signing.resolvedPaths || {};
        const pathBits = ["apksigner", "keytool", "openssl"]
          .map((k) => (paths[k] ? `${k}=${paths[k]}` : ""))
          .filter(Boolean);
        if (pathBits.length) lines.push(`工具路径: ${pathBits.join(" · ")}`);
        if (paths.JAVA_HOME) lines.push(`JAVA_HOME: ${paths.JAVA_HOME}`);
        if (signing.note) lines.push(signing.note);
        const errs = Array.isArray(signing.errors) ? signing.errors : [];
        if (errs.length && !signers.length) {
          errs.slice(0, 3).forEach((e) => {
            lines.push(`错误(${e.tool || "?"}): ${e.message || ""}`);
          });
        }
        const signGuide = $("#adb-signing-guide");
        if (!signers.length) {
          lines.push("签名: 未能解析");
          if (found.length) {
            if (!found.includes("apksigner")) {
              lines.push(
                "说明：已检测到本机签名工具，但该 APK 可能只有 v2/v3 签名。请安装 Android build-tools 的 apksigner（不必重装 JDK/keytool），然后重启 ADB 桥再分析。"
              );
            } else {
              lines.push(
                "说明：探测到 apksigner 仍失败时，请看上方「错误」行（常见：缺 Java、Windows 未重启桥、APK 损坏）。也可在终端手动: apksigner verify --print-certs 你的.apk"
              );
            }
            // 工具已在，不误导展示「未安装 keytool」引导
            if (signGuide) signGuide.hidden = true;
          } else {
            lines.push(
              "配置：安装 JDK（keytool）或 Android build-tools（apksigner），可选 openssl；配好后重启 ADB 桥再分析。"
            );
            if (signGuide) signGuide.hidden = false;
          }
          return lines;
        }
        if (signGuide) signGuide.hidden = true;
        signers.forEach((s, idx) => {
          const n = s.index || idx + 1;
          lines.push(`签名 #${n}:`);
          lines.push(`  别名: ${s.alias || s.v1Entry || "—"}`);
          lines.push(`  CN: ${s.cn || "—"}`);
          lines.push(`  Owner: ${s.owner || "—"}`);
          if (s.issuer) lines.push(`  Issuer: ${s.issuer}`);
          if (s.serial) lines.push(`  Serial: ${s.serial}`);
          if (s.valid) lines.push(`  Valid: ${s.valid}`);
          lines.push(`  SHA1: ${s.sha1 || "—"}`);
          lines.push(`  SHA256: ${s.sha256 || "—"}`);
          if (s.md5) lines.push(`  MD5: ${s.md5}`);
          if (s.sigAlg) lines.push(`  算法: ${s.sigAlg}`);
        });
        return lines;
      }
  
      async function pushSystemApk() {
        if (!adbApkFile) throw new Error("请先选择 APK");
        const serial = requireCurrentSerial();
        let uploadId = adbApkUploadId;
        let packageName = String($("#adb-apk-pkg")?.value || adbApkInfo?.packageName || "").trim();
        if (!uploadId) {
          const buffer = new Uint8Array(await adbApkFile.arrayBuffer());
          const uploaded = await adbFetch(`/upload?name=${encodeURIComponent(adbApkFile.name)}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/octet-stream",
              "X-Filename": encodeURIComponent(adbApkFile.name),
            },
            body: buffer,
          });
          uploadId = uploaded.uploadId;
          adbApkUploadId = uploadId;
        }
        if (!packageName) {
          const data = await adbFetch("/apk/info", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ uploadId }),
          });
          adbApkInfo = data;
          packageName = data.packageName || "";
          if ($("#adb-apk-pkg") && packageName) $("#adb-apk-pkg").value = packageName;
        }
        if (!packageName) throw new Error("无法解析包名，请填写包名或先分析 APK");
        const data = await adbFetch("/install/push-system", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serial, uploadId, packageName }),
        });
        toast(
          data.message ||
            (data.replaced
              ? `已覆盖推送 ${data.remotePath || ""}`
              : `已推送至 ${data.remotePath || "系统/临时路径"}`)
        );
        return data;
      }
  
      async function refreshProxy({ silent = false } = {}) {
        const serial = requireCurrentSerial();
        const data = await adbFetch(`/network/proxy?serial=${encodeURIComponent(serial)}`);
        if ($("#adb-proxy-host") && data.host) $("#adb-proxy-host").value = data.host;
        if ($("#adb-proxy-port") && data.port) $("#adb-proxy-port").value = data.port;
        if ($("#adb-proxy-meta")) {
          $("#adb-proxy-meta").textContent = data.httpProxy
            ? `当前代理：${data.httpProxy}`
            : "当前未设置 HTTP 代理";
        }
        if (!silent) toast("代理状态已刷新");
      }
  
      async function refreshForwards({ silent = false } = {}) {
        const serial = requireCurrentSerial();
        const data = await adbFetch(`/network/forward?serial=${encodeURIComponent(serial)}`);
        const lines = [];
        lines.push("forward:");
        if (!(data.forwards || []).length) lines.push("  (无)");
        for (const f of data.forwards || []) {
          lines.push(`  ${f.serial}  ${f.local}  ->  ${f.remote}`);
        }
        lines.push("reverse:");
        const reverses = (data.reverses || []).filter((r) => r.local || r.raw);
        if (!reverses.length) lines.push("  (无)");
        for (const r of reverses) {
          lines.push(r.local ? `  ${r.local}  ->  ${r.remote}` : `  ${r.raw}`);
        }
        if ($("#adb-fwd-out")) $("#adb-fwd-out").textContent = lines.join("\n");
        if ($("#adb-forward-meta")) {
          $("#adb-forward-meta").textContent = `forward ${(data.forwards || []).length} · reverse ${reverses.length}`;
        }
        if (!silent) toast("转发列表已刷新");
      }
  
      async function refreshDeveloper({ silent = false } = {}) {
        const serial = requireCurrentSerial();
        const data = await adbFetch(`/developer?serial=${encodeURIComponent(serial)}`);
        const onOff = (v) => (v ? "开" : "关");
        if ($("#adb-dev-show-touches")) $("#adb-dev-show-touches").textContent = onOff(data.showTouches ?? data.show_touches);
        if ($("#adb-dev-pointer")) $("#adb-dev-pointer").textContent = onOff(data.pointerLocation ?? data.pointer_location);
        if ($("#adb-dev-layout")) $("#adb-dev-layout").textContent = onOff(data.layoutBounds ?? data.show_layout);
        if ($("#adb-dev-stay-on")) {
          const stayRaw = String(data.stay_on ?? data.stayOnWhilePluggedIn ?? "");
          const stayOn = stayRaw && stayRaw !== "0" && stayRaw !== "null" && stayRaw !== "—";
          $("#adb-dev-stay-on").textContent = stayOn ? `开(${stayRaw})` : stayRaw === "0" ? "关" : "—";
        }
        if ($("#adb-dev-force-rtl")) $("#adb-dev-force-rtl").textContent = onOff(data.force_rtl);
        if ($("#adb-dev-dont-keep")) $("#adb-dev-dont-keep").textContent = onOff(data.dont_keep_activities);
        if ($("#adb-dev-force-gpu")) $("#adb-dev-force-gpu").textContent = onOff(data.force_gpu);
        if ($("#adb-dev-hardware-ui")) $("#adb-dev-hardware-ui").textContent = onOff(data.hardware_ui);
        if ($("#adb-dev-usb-notify")) {
          $("#adb-dev-usb-notify").textContent = onOff(data.usb_debugging_notify);
        }
        if ($("#adb-dev-gpu-overdraw")) $("#adb-dev-gpu-overdraw").textContent = onOff(data.gpu_overdraw);
        if ($("#adb-dev-strict-mode")) $("#adb-dev-strict-mode").textContent = onOff(data.strict_mode);
        if ($("#adb-dev-show-anrs")) $("#adb-dev-show-anrs").textContent = onOff(data.show_all_anrs);
        if ($("#adb-dev-verify-adb")) $("#adb-dev-verify-adb").textContent = onOff(data.verify_adb_installs);
        if ($("#adb-dev-force-dark")) $("#adb-dev-force-dark").textContent = onOff(data.force_dark);
        if ($("#adb-dev-auto-rotate")) $("#adb-dev-auto-rotate").textContent = onOff(data.auto_rotate);
        if ($("#adb-dev-mobile-always")) $("#adb-dev-mobile-always").textContent = onOff(data.mobile_data_always_on);
        if ($("#adb-dev-scales")) {
          $("#adb-dev-scales").textContent = `window ${data.windowAnimationScale} / transition ${data.transitionAnimationScale} / animator ${data.animatorDurationScale}`;
        }
        if ($("#adb-dev-meta")) $("#adb-dev-meta").textContent = "已同步当前设备状态";
        if (!silent) toast("开发者选项已刷新");
      }
  
      restoreAdbSettings();
      window.addEventListener("devtools:theme", () => renderAdbDevices());
      $("#adb-fs-view-list")?.classList.toggle("is-active", adbFsView === "list");
      $("#adb-fs-view-grid")?.classList.toggle("is-active", adbFsView === "grid");
      setAdbStatus("is-err", "未连接本机桥", "使用本工具需要本机已安装 adb。请下载完整 ZIP（含 server.js）并运行后连接。");
      if ($("#adb-fs-hint")) $("#adb-fs-hint").innerHTML = ADB_FS_ROOTS_HINT_HTML;
      {
        const hostEl = $("#adb-proxy-host");
        if (hostEl && !hostEl.value) {
          const h = String(window.location.hostname || "");
          if (/^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) {
            hostEl.placeholder = h;
            if (!hostEl.dataset.adbFilled) {
              hostEl.value = h;
              hostEl.dataset.adbFilled = "1";
            }
          } else if (h === "localhost" || h === "127.0.0.1") {
            hostEl.placeholder = "本机局域网 IP，如 192.168.1.8";
          }
        }
      }
  
      async function cancelAdbJob(jobId) {
        const data = await adbFetch(`/jobs/${encodeURIComponent(jobId)}/cancel`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        });
        toast(data.message || "已请求取消");
        await refreshJobs({ silent: true });
        return data;
      }
  
      async function zipJobArtifacts(jobId) {
        const Zip = await ensureJsZip();
        const job = adbJobs.find((j) => j.id === jobId);
        const arts = job?.artifacts || [];
        if (!arts.length) throw new Error("该任务没有可打包的产物");
        const zip = new Zip();
        for (const a of arts) {
          const res = await adbFetch(`/jobs/${encodeURIComponent(jobId)}/artifact/${encodeURIComponent(a.name)}`);
          zip.file(a.name, await res.blob());
        }
        const blob = await zip.generateAsync({ type: "blob" });
        downloadBlobFile(blob, `adb-job-${jobId}.zip`);
        toast(`已打包 ${arts.length} 个文件`);
      }
  
      function adbCanvasCoords(el, clientX, clientY) {
        const rect = el.getBoundingClientRect();
        const nw =
          Number(el.dataset?.deviceW) ||
          el.naturalWidth ||
          el.width ||
          adbMirrorMeta?.width ||
          1;
        const nh =
          Number(el.dataset?.deviceH) ||
          el.naturalHeight ||
          el.height ||
          adbMirrorMeta?.height ||
          1;
        const x = Math.round(((clientX - rect.left) / Math.max(rect.width, 1)) * nw);
        const y = Math.round(((clientY - rect.top) / Math.max(rect.height, 1)) * nh);
        return {
          x: Math.max(0, Math.min(nw - 1, x)),
          y: Math.max(0, Math.min(nh - 1, y)),
        };
      }
  
      function adbPreviewSurface() {
        const mirror = $("#adb-input-mirror");
        if (mirror && !mirror.hidden && mirror.width > 0) return mirror;
        const img = $("#adb-input-canvas");
        if (img && !img.hidden && img.naturalWidth) return img;
        return mirror || img || null;
      }
  
      function findAnnexBNals(bytes) {
        const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
        const nals = [];
        let i = 0;
        while (i + 3 < u.length) {
          let hdr = -1;
          if (u[i] === 0 && u[i + 1] === 0 && u[i + 2] === 1) hdr = i + 3;
          else if (u[i] === 0 && u[i + 1] === 0 && u[i + 2] === 0 && i + 4 <= u.length && u[i + 3] === 1) hdr = i + 4;
          else {
            i += 1;
            continue;
          }
          let j = hdr;
          let next = -1;
          while (j + 3 < u.length) {
            if (u[j] === 0 && u[j + 1] === 0 && u[j + 2] === 1) {
              next = j;
              break;
            }
            if (u[j] === 0 && u[j + 1] === 0 && u[j + 2] === 0 && j + 4 <= u.length && u[j + 3] === 1) {
              next = j;
              break;
            }
            j += 1;
          }
          const end = next >= 0 ? next : u.length;
          if (end > hdr) nals.push(u.subarray(hdr, end));
          i = end;
        }
        return nals;
      }

      function looksAnnexB(bytes) {
        const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
        if (u.length < 4) return false;
        return u[0] === 0 && u[1] === 0 && (u[2] === 1 || (u[2] === 0 && u[3] === 1));
      }

      function isAvcDecoderConfig(bytes) {
        const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
        return u.length >= 7 && u.length <= 2048 && u[0] === 1;
      }

      /** avcC → Annex-B SPS/PPS（供无 description 的 WebCodecs 路径） */
      function avcCToAnnexBParamSets(bytes) {
        const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
        if (!isAvcDecoderConfig(u)) return null;
        const parts = [];
        let i = 5;
        if (i >= u.length) return null;
        const numSps = u[i++] & 0x1f;
        for (let s = 0; s < numSps; s++) {
          if (i + 2 > u.length) return null;
          const len = ((u[i] << 8) | u[i + 1]) >>> 0;
          i += 2;
          if (!len || i + len > u.length) return null;
          parts.push(new Uint8Array([0, 0, 0, 1]), u.subarray(i, i + len));
          i += len;
        }
        if (i >= u.length) return parts.length ? concatBytesMany(parts) : null;
        const numPps = u[i++];
        for (let p = 0; p < numPps; p++) {
          if (i + 2 > u.length) return null;
          const len = ((u[i] << 8) | u[i + 1]) >>> 0;
          i += 2;
          if (!len || i + len > u.length) return null;
          parts.push(new Uint8Array([0, 0, 0, 1]), u.subarray(i, i + len));
          i += len;
        }
        return parts.length ? concatBytesMany(parts) : null;
      }

      /** 部分机型 MediaCodec 输出 length-prefixed NAL，WebCodecs Annex-B 路径需要 start code */
      function toAnnexB(bytes) {
        const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
        if (!u.length || looksAnnexB(u)) return u;
        // 纯 avcC 配置不是帧；留给 param-sets 提取
        if (isAvcDecoderConfig(u) && u.length < 512) return u;
        const parts = [];
        let i = 0;
        let ok = false;
        while (i + 4 <= u.length) {
          const n = ((u[i] << 24) | (u[i + 1] << 16) | (u[i + 2] << 8) | u[i + 3]) >>> 0;
          i += 4;
          if (n === 0 || i + n > u.length) return u;
          const nal = u.subarray(i, i + n);
          const type = nal[0] & 0x1f;
          if (type === 0 || type > 12) return u;
          parts.push(new Uint8Array([0, 0, 0, 1]), nal);
          i += n;
          ok = true;
        }
        if (!ok || i !== u.length) return u;
        return concatBytesMany(parts);
      }

      function startsWithBytes(hay, needle) {
        const h = hay instanceof Uint8Array ? hay : new Uint8Array(hay || []);
        const n = needle instanceof Uint8Array ? needle : new Uint8Array(needle || []);
        if (!n.length || h.length < n.length) return false;
        for (let i = 0; i < n.length; i++) if (h[i] !== n[i]) return false;
        return true;
      }

      /** 去掉误并进关键帧的 codec config（尤其是 avcC） */
      function stripLeadingConfig(payload, config) {
        let data = payload instanceof Uint8Array ? payload : new Uint8Array(payload || []);
        const cfg = config instanceof Uint8Array ? config : new Uint8Array(config || []);
        if (cfg.length && startsWithBytes(data, cfg)) {
          data = data.subarray(cfg.length);
        } else if (isAvcDecoderConfig(data) && data.length > 64) {
          // 启发式：avcC 后紧跟 Annex-B 或 length-prefixed NAL
          for (let i = 7; i < Math.min(data.length - 4, 512); i++) {
            if (data[i] === 0 && data[i + 1] === 0 && (data[i + 2] === 1 || (data[i + 2] === 0 && data[i + 3] === 1))) {
              return data.subarray(i);
            }
          }
        }
        return data;
      }

      /**
       * scrcpy 帧多为 Annex-B。若 configure 时带了 avcC description，却喂 Annex-B，会黑屏无报错。
       * 统一走「无 description + Annex-B」，关键帧前补 SPS/PPS。
       */
      function prepareMirrorVideoData(payload, isKey) {
        let data = stripLeadingConfig(payload, adbMirrorPendingConfig);
        data = toAnnexB(data);
        const params = adbMirrorParamSets;
        if (isKey && params?.length && !payloadHasSps(data)) {
          data = concatBytes(params, data);
        }
        return data;
      }

      function concatBytesMany(chunks) {
        let total = 0;
        for (const c of chunks) total += c.length;
        const out = new Uint8Array(total);
        let off = 0;
        for (const c of chunks) {
          out.set(c, off);
          off += c.length;
        }
        return out;
      }

      function payloadHasSps(bytes) {
        for (const nal of findAnnexBNals(bytes)) {
          if (nal.length && (nal[0] & 0x1f) === 7) return true;
        }
        return false;
      }

      function codecStringFromConfig(bytes, codecName) {
        if (codecName === "h265") return "hev1.1.6.L93.B0";
        if (codecName === "av1") return "av01.0.04M.08";
        const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
        const hex3 = (a, b, c) =>
          `${a.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}${c.toString(16).padStart(2, "0")}`.toUpperCase();
        if (u.length >= 4 && u[0] === 1) {
          return `avc1.${hex3(u[1], u[2], u[3])}`;
        }
        const annex = toAnnexB(u);
        for (const nal of findAnnexBNals(annex)) {
          if (!nal.length) continue;
          if ((nal[0] & 0x1f) === 7 && nal.length >= 4) {
            return `avc1.${hex3(nal[1], nal[2], nal[3])}`;
          }
        }
        if (u.length >= 4 && (u[0] & 0x1f) === 7) {
          return `avc1.${hex3(u[1], u[2], u[3])}`;
        }
        return "avc1.42E01E";
      }

      function concatBytes(a, b) {
        const aa = a instanceof Uint8Array ? a : new Uint8Array(a);
        const bb = b instanceof Uint8Array ? b : new Uint8Array(b);
        const out = new Uint8Array(aa.length + bb.length);
        out.set(aa, 0);
        out.set(bb, aa.length);
        return out;
      }
  
      function clearInputPreviewSurface() {
        const img = $("#adb-input-canvas");
        const mirror = $("#adb-input-mirror");
        if (img) {
          img.hidden = true;
          img.removeAttribute("src");
        }
        if (mirror) mirror.hidden = true;
        if (adbInputShotUrl) {
          try {
            URL.revokeObjectURL(adbInputShotUrl);
          } catch {
            /* ignore */
          }
          adbInputShotUrl = "";
        }
        setInputDropHintVisible(false);
      }
  
      function stopMirrorPreview({ notifyBridge = true } = {}) {
        const serial = adbSelected;
        if (adbMirrorWs) {
          try {
            adbMirrorWs.onclose = null;
            adbMirrorWs.close();
          } catch {
            /* ignore */
          }
          adbMirrorWs = null;
        }
        if (adbMirrorDecoder) {
          try {
            adbMirrorDecoder.close();
          } catch {
            /* ignore */
          }
          adbMirrorDecoder = null;
        }
        adbMirrorPendingConfig = null;
        adbMirrorParamSets = null;
        adbMirrorFrameTs = 0;
        adbMirrorNeedKey = false;
        adbMirrorGotFrame = false;
        adbMirrorPkt = { config: 0, key: 0, delta: 0, decoded: 0 };
        adbMirrorHwPref = "prefer-hardware";
        adbMirrorSoftTried = false;
        adbMirrorLastKeyData = null;
        adbMirrorDisplayOff = false;
        if (adbMirrorAudioDecoder) {
          try {
            adbMirrorAudioDecoder.close();
          } catch {
            /* ignore */
          }
          adbMirrorAudioDecoder = null;
        }
        adbMirrorAudioTs = 0;
        adbMirrorAudioNext = 0;
        if (adbMirrorLocalRec && adbMirrorLocalRec.state !== "inactive") {
          try {
            adbMirrorLocalRec.stop();
          } catch {
            /* ignore */
          }
        }
        adbMirrorLocalRec = null;
        adbMirrorLocalChunks = [];
        updateMirrorPowerUi();
        if (adbMirrorWaitTimer) {
          clearTimeout(adbMirrorWaitTimer);
          adbMirrorWaitTimer = 0;
        }
        setInputDropHintVisible(false);
        const canvas = $("#adb-input-mirror");
        if (canvas) canvas.hidden = true;
        if (notifyBridge && serial) {
          adbFetch("/mirror/stop", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ serial }),
          }).catch(() => {});
        }
      }
  
      function ensureMirrorDecoder(meta) {
        const canvas = $("#adb-input-mirror");
        if (!canvas) throw new Error("缺少镜像画布");
        if (typeof VideoDecoder === "undefined") throw new Error("当前浏览器不支持 WebCodecs（请用较新的 Chrome / Edge）");
        // 避免 desynchronized 上下文在部分 GPU 上画不出 VideoFrame
        const ctx = canvas.getContext("2d", { alpha: false });
        if (!ctx) throw new Error("无法创建画布上下文");
        if (adbMirrorDecoder) {
          try {
            adbMirrorDecoder.close();
          } catch {
            /* ignore */
          }
        }
        adbMirrorGotFrame = false;
        adbMirrorPkt = { config: 0, key: 0, delta: 0, decoded: 0 };
        adbMirrorDecoder = new VideoDecoder({
          output: (frame) => {
            try {
              if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
                canvas.width = frame.displayWidth;
                canvas.height = frame.displayHeight;
              }
              ctx.drawImage(frame, 0, 0);
              adbMirrorPkt.decoded += 1;
              if (!adbMirrorGotFrame) {
                adbMirrorGotFrame = true;
                if (adbMirrorWaitTimer) {
                  clearTimeout(adbMirrorWaitTimer);
                  adbMirrorWaitTimer = 0;
                }
                if ($("#adb-input-meta")) {
                  $("#adb-input-meta").textContent =
                    "镜像预览中：单击 / 长按 / 双击 / 拖拽；拖文件到画面可 push 到 Download。";
                }
                toast("镜像画面已就绪");
              }
            } finally {
              frame.close();
            }
          },
          error: (err) => {
            const msg = err?.message || String(err);
            if ($("#adb-input-meta")) $("#adb-input-meta").textContent = `解码错误：${msg}`;
            adbMirrorNeedKey = true;
          },
        });
        canvas.dataset.deviceW = String(meta.width || 0);
        canvas.dataset.deviceH = String(meta.height || 0);
        canvas.width = meta.width || 720;
        canvas.height = meta.height || 1280;
        canvas.hidden = false;
        const img = $("#adb-input-canvas");
        if (img) img.hidden = true;
        return adbMirrorDecoder;
      }

      function configureMirrorFromPending() {
        if (!adbMirrorDecoder || !adbMirrorMeta || !adbMirrorPendingConfig) return false;
        const payload = adbMirrorPendingConfig;
        const codec = codecStringFromConfig(payload, adbMirrorMeta.codec);
        // 禁止 description+Annex-B 混用（会导致黑屏无报错）
        if (isAvcDecoderConfig(payload)) {
          adbMirrorParamSets = avcCToAnnexBParamSets(payload);
        } else {
          adbMirrorParamSets = toAnnexB(payload);
        }
        const cfg = {
          codec,
          codedWidth: adbMirrorMeta.width || undefined,
          codedHeight: adbMirrorMeta.height || undefined,
          optimizeForLatency: true,
          hardwareAcceleration: adbMirrorHwPref,
        };
        adbMirrorDecoder.configure(cfg);
        adbMirrorNeedKey = true;
        adbMirrorFrameTs = 0;
        return true;
      }

      function decodeMirrorKeyData(data) {
        if (!adbMirrorDecoder || adbMirrorDecoder.state !== "configured" || !data?.length) return;
        adbMirrorFrameTs += 33_333;
        adbMirrorDecoder.decode(
          new EncodedVideoChunk({
            type: "key",
            timestamp: adbMirrorFrameTs,
            data,
          })
        );
        adbMirrorNeedKey = false;
      }

      function scheduleMirrorBlankWatch(serial) {
        if (adbMirrorWaitTimer) clearTimeout(adbMirrorWaitTimer);
        adbMirrorWaitTimer = setTimeout(() => {
          if (adbMirrorGotFrame) return;
          const p = adbMirrorPkt;
          // 先要一帧关键帧（很多机型默认 I 间隔很长）
          if ((p.config > 0 || p.key > 0) && p.decoded === 0) {
            try {
              adbMirrorWs?.readyState === 1 && adbMirrorWs.send(JSON.stringify({ type: "reset_video" }));
            } catch {
              /* ignore */
            }
            adbMirrorNeedKey = true;
          }
          if ((p.config > 0 || p.key > 0) && p.decoded === 0 && !adbMirrorSoftTried && adbMirrorMeta) {
            adbMirrorSoftTried = true;
            adbMirrorHwPref = "prefer-software";
            if ($("#adb-input-meta")) {
              $("#adb-input-meta").textContent = "硬解无画面，正在改用软解重试…";
            }
            try {
              const savedCfg = adbMirrorPendingConfig;
              const savedKey = adbMirrorLastKeyData;
              ensureMirrorDecoder(adbMirrorMeta);
              adbMirrorPendingConfig = savedCfg;
              adbMirrorLastKeyData = savedKey;
              // 软解重试时保留计数，便于最终诊断
              adbMirrorPkt = { ...p, decoded: 0 };
              if (configureMirrorFromPending() && savedKey) {
                decodeMirrorKeyData(savedKey);
              }
              try {
                adbMirrorWs?.readyState === 1 && adbMirrorWs.send(JSON.stringify({ type: "reset_video" }));
              } catch {
                /* ignore */
              }
            } catch (err) {
              if ($("#adb-input-meta")) {
                $("#adb-input-meta").textContent = `软解重试失败：${err.message || err}`;
              }
            }
            scheduleMirrorBlankWatch(serial);
            return;
          }
          if ($("#adb-input-meta")) {
            $("#adb-input-meta").textContent =
              `仍无画面（config=${p.config} key=${p.key} delta=${p.delta} decoded=${p.decoded}）。` +
              (p.config === 0 && p.key === 0
                ? "桥未收到视频帧：请更新本机桥 ZIP（≥0.9.15）、只开一座桥，并解锁亮屏后重试"
                : "已收到码流但解不出画面：请硬刷新网页后重试；仍黑屏请换 Chrome/Edge 最新版，或更新桥 ZIP（≥0.9.15）");
          }
        }, 2800);
      }
  
      function handleMirrorAudioPacket(isConfig, _isKey, payload) {
        if (typeof AudioDecoder === "undefined") return;
        try {
          if (!adbMirrorAudioCtx) {
            adbMirrorAudioCtx = new (window.AudioContext || window.webkitAudioContext)();
            adbMirrorAudioNext = adbMirrorAudioCtx.currentTime;
          }
          if (adbMirrorAudioCtx.state === "suspended") adbMirrorAudioCtx.resume().catch(() => {});
          if (isConfig) {
            if (adbMirrorAudioDecoder) {
              try {
                adbMirrorAudioDecoder.close();
              } catch {
                /* ignore */
              }
            }
            adbMirrorAudioDecoder = new AudioDecoder({
              output: (audioData) => {
                try {
                  const channels = [];
                  for (let ch = 0; ch < audioData.numberOfChannels; ch++) {
                    const buf = new Float32Array(audioData.numberOfFrames);
                    audioData.copyTo(buf, { planeIndex: ch });
                    channels.push(buf);
                  }
                  const abuf = adbMirrorAudioCtx.createBuffer(
                    audioData.numberOfChannels,
                    audioData.numberOfFrames,
                    audioData.sampleRate
                  );
                  for (let i = 0; i < channels.length; i++) abuf.copyToChannel(channels[i], i);
                  const src = adbMirrorAudioCtx.createBufferSource();
                  src.buffer = abuf;
                  src.connect(adbMirrorAudioCtx.destination);
                  const t = Math.max(adbMirrorAudioCtx.currentTime + 0.02, adbMirrorAudioNext);
                  src.start(t);
                  adbMirrorAudioNext = t + abuf.duration;
                } finally {
                  audioData.close();
                }
              },
              error: () => {
                /* ignore sporadic audio decode errors */
              },
            });
            const desc = payload && payload.length ? payload.slice() : undefined;
            const cfg = { codec: "opus", numberOfChannels: 2, sampleRate: 48000 };
            if (desc) cfg.description = desc;
            try {
              adbMirrorAudioDecoder.configure(cfg);
            } catch {
              delete cfg.description;
              try {
                adbMirrorAudioDecoder.configure(cfg);
              } catch {
                /* give up audio */
              }
            }
            adbMirrorAudioTs = 0;
            return;
          }
          if (!adbMirrorAudioDecoder || adbMirrorAudioDecoder.state !== "configured") return;
          adbMirrorAudioTs += 20_000;
          adbMirrorAudioDecoder.decode(
            new EncodedAudioChunk({
              type: "key",
              timestamp: adbMirrorAudioTs,
              data: payload,
            })
          );
        } catch {
          /* ignore */
        }
      }

      async function mirrorFailureDetail(msg, serial) {
        let detail = String(msg || "镜像失败");
        if (/socket closed/i.test(detail) && !/握手失败|scrcpy-server/i.test(detail)) {
          detail =
            "镜像握手失败（视频 socket 已关闭）。请确认：① 手机已解锁并保持亮屏 ② USB 调试已授权 ③ 本机桥为最新完整 ZIP（含 scrcpy-server v3.1）④ 无其它投屏/录屏占用编码器";
        }
        if (/ECONNREFUSED|转发.*断开|forward 未在/i.test(detail) && !bridgeAtLeast("0.9.5")) {
          detail += "。请重新下载完整桥 ZIP（≥0.9.5 修复握手前抢连导致转发失效）并只留一座桥窗口";
        } else if (/socket closed|编码器|MediaCodec/i.test(detail) && !bridgeAtLeast("0.9.12")) {
          detail += "。请更新到桥 ≥0.9.12（scrcpy 全控制：按键/滚轮/剪贴板/熄屏/音频）";
        } else if (/socket closed|编码器|MediaCodec/i.test(detail) && !bridgeAtLeast("0.9.10")) {
          detail += "。请更新到桥 ≥0.9.10（scrcpy 帧合并 + 解码兼容，握手失败自动降级）";
        } else if (!bridgeAtLeast("0.9.12")) {
          detail += "。建议更新到桥 ≥0.9.12（画质档位 / 熄屏 / 音频 / 全控制）";
        } else if (!bridgeAtLeast("0.8.4")) {
          detail += "。建议重新下载桥 ZIP 并重启本机桥（≥0.8.4 含镜像诊断）";
        }
        try {
          const st = await adbFetch(`/mirror/status?serial=${encodeURIComponent(serial)}`);
          if (st?.deviceJar && !st.deviceJar.present) {
            detail += `。设备端未找到 ${st.deviceJar.path || "scrcpy-server"}，请重试「开始镜像」以自动 push v3.1`;
          } else if (st?.deviceJar?.present && st.deviceJar.size) {
            detail += `。设备 jar：${st.deviceJar.size} 字节 @ ${st.deviceJar.path || ""}`;
          }
          if (st?.jar && !st.jar.vendor && !st.jar.cached) {
            detail += "。本机未缓存 scrcpy-server，请确认桥可联网或 ZIP 含 vendor/scrcpy-server-v3.1";
          }
        } catch {
          /* ignore status enrichment */
        }
        return detail;
      }
  
      async function startMirrorPreview() {
        const serial = requireCurrentSerial();
        if (adbMirrorStarting || (adbMirrorWs && adbMirrorWs.readyState <= 1)) {
          stopMirrorPreview({ notifyBridge: true });
          adbMirrorStarting = false;
        }
        if (typeof VideoDecoder === "undefined") {
          toast("浏览器不支持 WebCodecs，已回退截图预览");
          startInputLivePreview({ forceShot: true });
          return;
        }
        adbMirrorStarting = true;
        stopInputLivePreview({ keepMirror: true });
        setInputDropHintVisible(false);
        try {
          if (!bridgeHas("mirror") && !bridgeHas("scrcpy-mirror") && !bridgeAtLeast("0.7.0")) {
            throw new Error("本机桥版本过旧，不支持镜像。请重新下载完整 ZIP 并重启桥（≥0.7.0）");
          }
          await adbFetch("/mirror/stop", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ serial }),
          }).catch(() => {});
          try {
            await adbFetch("/mirror/prepare", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
          } catch (err) {
            const prep = await adbFetch("/mirror/status").catch(() => null);
            if (!prep?.ok) throw err;
          }
          const wsUrl = adbMirrorWsUrl(serial);
          await new Promise((resolve, reject) => {
            let settled = false;
            let errTimer = 0;
            const ws = new WebSocket(wsUrl);
            ws.binaryType = "arraybuffer";
            adbMirrorWs = ws;
            const fail = (msg) => {
              if (settled) return;
              settled = true;
              if (errTimer) clearTimeout(errTimer);
              stopMirrorPreview({ notifyBridge: true });
              mirrorFailureDetail(msg, serial)
                .then((detail) => {
                  if ($("#adb-input-meta")) $("#adb-input-meta").textContent = `镜像失败：${detail}`;
                  reject(new Error(detail));
                })
                .catch(() => reject(new Error(msg)));
            };
            const scheduleGenericFail = (msg, delayMs = 900) => {
              if (settled || errTimer) return;
              errTimer = setTimeout(() => {
                errTimer = 0;
                fail(msg);
              }, delayMs);
            };
            ws.onopen = () => {
              adbInputLive = true;
              updateInputLiveUi();
              if ($("#adb-input-meta")) $("#adb-input-meta").textContent = "镜像连接中，正在启动 scrcpy-server…";
            };
            ws.onerror = () =>
              scheduleGenericFail(
                "镜像 WebSocket 连接失败（请确认本机桥已启动、Token 与网页一致，且地址形如 http://127.0.0.1:17888）"
              );
            ws.onclose = (ev) => {
              if (settled) {
                adbMirrorWs = null;
                if (adbInputLive) {
                  adbInputLive = false;
                  updateInputLiveUi();
                }
                return;
              }
              const hint =
                ev?.code === 1006
                  ? "镜像连接失败：请检查本机桥 Token（与 ADB/FFmpeg 页一致）及 scrcpy-server 是否已准备"
                  : "镜像连接已关闭";
              scheduleGenericFail(hint);
            };
            ws.onmessage = (ev) => {
              if (typeof ev.data === "string") {
                let msg = null;
                try {
                  msg = JSON.parse(ev.data);
                } catch {
                  return;
                }
                if (msg.type === "error") {
                  if (errTimer) {
                    clearTimeout(errTimer);
                    errTimer = 0;
                  }
                  fail(msg.error || "镜像错误");
                  return;
                }
                if (msg.type === "bye") {
                  if (errTimer) {
                    clearTimeout(errTimer);
                    errTimer = 0;
                  }
                  if (!settled) fail(msg.reason || "镜像结束");
                  return;
                }
                if (msg.type === "status") {
                  if (errTimer) {
                    clearTimeout(errTimer);
                    errTimer = 0;
                  }
                  if ($("#adb-input-meta")) $("#adb-input-meta").textContent = msg.message || "镜像启动中…";
                  return;
                }
                if (msg.type === "clipboard") {
                  if ($("#adb-clip-text")) $("#adb-clip-text").value = msg.text || "";
                  if (msg.text) {
                    navigator.clipboard?.writeText?.(msg.text).catch(() => {});
                    toast("已同步手机剪贴板");
                  }
                  return;
                }
                if (msg.type === "clipboard_ack") {
                  return;
                }
                if (msg.type === "hello") {
                  if (errTimer) {
                    clearTimeout(errTimer);
                    errTimer = 0;
                  }
                  adbMirrorMeta = msg;
                  adbInputPreviewMode = "mirror";
                  adbMirrorDisplayOff = false;
                  try {
                    ensureMirrorDecoder(msg);
                    if (!settled) {
                      settled = true;
                      resolve();
                    }
                    updateInputLiveUi();
                    updateMirrorPowerUi();
                    const meta = $("#adb-input-live-meta");
                    if (meta) {
                      meta.hidden = false;
                      const bits = [
                        msg.codec || "h264",
                        `${msg.width}×${msg.height}`,
                        msg.quality || "",
                        msg.control ? "scrcpy控制" : "",
                        msg.audio ? "音频" : "",
                        msg.deviceName || serial,
                      ].filter(Boolean);
                      meta.textContent = `镜像中 · ${bits.join(" · ")}`;
                    }
                    if ($("#adb-input-meta")) {
                      $("#adb-input-meta").textContent = "镜像已连接，等待首帧画面…";
                    }
                    scheduleMirrorBlankWatch(serial);
                  } catch (err) {
                    fail(err.message || String(err));
                  }
                  return;
                }
                return;
              }
              const buf = new Uint8Array(ev.data);
              if (buf.length < 5 || !adbMirrorMeta) return;
              const streamFlags = buf[0];
              const isAudio = (streamFlags & 0x80) !== 0;
              const flags = streamFlags & 0x7f;
              let payload = buf.subarray(5);
              const isConfig = (flags & 1) !== 0;
              const isKey = (flags & 2) !== 0;
              if (isAudio) {
                handleMirrorAudioPacket(isConfig, isKey, payload);
                return;
              }
              if (!adbMirrorDecoder) return;
              try {
                if (isConfig) {
                  adbMirrorPkt.config += 1;
                  const raw = payload.slice();
                  adbMirrorPendingConfig = raw;
                  if (isAvcDecoderConfig(raw)) {
                    adbMirrorParamSets = avcCToAnnexBParamSets(raw);
                  } else {
                    adbMirrorParamSets = toAnnexB(raw);
                  }
                  const codec = codecStringFromConfig(raw, adbMirrorMeta.codec);
                  if (adbMirrorDecoder.state === "configured") {
                    try {
                      adbMirrorDecoder.reset();
                    } catch {
                      ensureMirrorDecoder(adbMirrorMeta);
                    }
                  }
                  const cfg = {
                    codec,
                    codedWidth: adbMirrorMeta.width || undefined,
                    codedHeight: adbMirrorMeta.height || undefined,
                    optimizeForLatency: true,
                    hardwareAcceleration: adbMirrorHwPref,
                  };
                  // 统一 Annex-B：不要设 description
                  try {
                    adbMirrorDecoder.configure(cfg);
                  } catch (err) {
                    if ($("#adb-input-meta")) {
                      $("#adb-input-meta").textContent = `解码器配置失败：${err.message || err}（${codec}）`;
                    }
                    return;
                  }
                  adbMirrorNeedKey = true;
                  adbMirrorFrameTs = 0;
                  // 要一帧新 IDR，避免干等旧间隔
                  try {
                    adbMirrorWs?.readyState === 1 && adbMirrorWs.send(JSON.stringify({ type: "reset_video" }));
                  } catch {
                    /* ignore */
                  }
                  return;
                }
                if (isKey) adbMirrorPkt.key += 1;
                else adbMirrorPkt.delta += 1;
                if (adbMirrorDecoder.state !== "configured") return;
                if (adbMirrorNeedKey && !isKey) return;
                if (!isKey && adbMirrorDecoder.decodeQueueSize > 2) return;
                const data = prepareMirrorVideoData(payload, isKey);
                if (!data?.length) return;
                if (isKey) adbMirrorLastKeyData = data.slice();
                adbMirrorFrameTs += 33_333;
                adbMirrorDecoder.decode(
                  new EncodedVideoChunk({
                    type: isKey ? "key" : "delta",
                    timestamp: adbMirrorFrameTs,
                    data,
                  })
                );
                if (isKey) adbMirrorNeedKey = false;
              } catch (err) {
                adbMirrorNeedKey = true;
                if ($("#adb-input-meta")) $("#adb-input-meta").textContent = `解码失败：${err.message || err}`;
              }
            };
          });
        } finally {
          adbMirrorStarting = false;
        }
      }
  
      async function refreshInputScreencap({ quiet = false } = {}) {
        if (adbInputRefreshBusy) {
          adbInputRefreshAfter = true;
          return;
        }
        adbInputRefreshBusy = true;
        try {
          const serial = requireCurrentSerial();
          const img = $("#adb-input-canvas");
          if (!img) throw new Error("缺少预览元素 #adb-input-canvas");
          const res = await adbFetch(`/media/screencap?serial=${encodeURIComponent(serial)}`);
          const blob = await res.blob();
          if (adbInputShotUrl) URL.revokeObjectURL(adbInputShotUrl);
          adbInputShotUrl = URL.createObjectURL(blob);
          img.src = adbInputShotUrl;
          img.hidden = false;
          const mirror = $("#adb-input-mirror");
          if (mirror && adbMirrorWs) {
            /* keep mirror on top while streaming */
          } else if (mirror) {
            mirror.hidden = true;
          }
          if (!quiet) {
            adbInputPreviewMode = "shot";
            updateInputLiveUi();
          }
          if (!quiet && $("#adb-input-meta")) {
            $("#adb-input-meta").textContent = "截图预览：单击 / 长按 / 双击 / 拖拽。可点「开始镜像」低延迟投屏。";
          }
          if (!quiet) toast("已刷新屏幕预览");
        } finally {
          adbInputRefreshBusy = false;
          if (adbInputRefreshAfter) {
            adbInputRefreshAfter = false;
            refreshInputScreencap({ quiet: true }).catch(() => {});
          }
        }
      }
  
      function clampInputShotVh(raw) {
        const n = Number(raw);
        if (!Number.isFinite(n)) return ADB_INPUT_SHOT_VH_DEFAULT;
        return Math.max(32, Math.min(88, Math.round(n / 2) * 2));
      }
  
      function applyInputShotSize(vh, { persist = true } = {}) {
        const value = clampInputShotVh(vh);
        const wrap = $("#adb-input-shot-wrap");
        const slider = $("#adb-input-shot-size");
        const label = $("#adb-input-shot-size-val");
        if (wrap) wrap.style.setProperty("--adb-input-shot-vh", String(value));
        if (slider && String(slider.value) !== String(value)) slider.value = String(value);
        if (slider) slider.setAttribute("aria-valuetext", `${value}`);
        if (label) label.textContent = `${value}%`;
        if (persist) {
          try {
            localStorage.setItem(ADB_STORE_INPUT_SHOT_VH, String(value));
          } catch (_) {
            /* ignore */
          }
        }
        return value;
      }
  
      function restoreInputShotSize() {
        let saved = ADB_INPUT_SHOT_VH_DEFAULT;
        try {
          const raw = localStorage.getItem(ADB_STORE_INPUT_SHOT_VH);
          if (raw != null && raw !== "") saved = clampInputShotVh(raw);
        } catch (_) {
          saved = ADB_INPUT_SHOT_VH_DEFAULT;
        }
        applyInputShotSize(saved, { persist: false });
      }
  
      function updateInputLiveUi() {
        const stopBtn = $("#adb-input-live-stop");
        const meta = $("#adb-input-live-meta");
        const mirroring = Boolean(adbMirrorWs && adbMirrorWs.readyState <= 1);
        const previewing =
          Boolean(adbInputPreviewMode) || adbInputLive || mirroring || Boolean(adbInputLiveTimer);
        if (stopBtn) stopBtn.hidden = !previewing;
        const liveMeta = adbInputPreviewMode === "live" || adbInputPreviewMode === "mirror" || adbInputLive || mirroring;
        if (meta) meta.hidden = !liveMeta;
        const recBtn = $("#adb-input-record-toggle");
        if (recBtn) {
          const localRec = adbMirrorLocalRec && adbMirrorLocalRec.state !== "inactive";
          recBtn.textContent = adbInputRecordJobId || localRec ? "停止录屏" : "开始录屏";
        }
      }
  
      function startInputLivePreview({ forceShot = false } = {}) {
        if (!forceShot && (bridgeHas("mirror") || bridgeHas("scrcpy-mirror") || bridgeAtLeast("0.7.0"))) {
          startMirrorPreview().catch((err) => {
            toast(err.message || "镜像失败，回退截图预览");
            startInputLivePreview({ forceShot: true });
          });
          return;
        }
        if (adbInputLiveTimer) return;
        adbInputLive = true;
        adbInputPreviewMode = "live";
        updateInputLiveUi();
        const meta = $("#adb-input-live-meta");
        if (meta) {
          meta.hidden = false;
          meta.textContent = "截图轮询预览中…";
        }
        adbInputLiveTimer = setInterval(() => {
          if (adbTab !== "input" || !adbSelected) {
            stopInputLivePreview();
            return;
          }
          refreshInputScreencap({ quiet: true }).catch(() => {});
        }, 1200);
      }
  
      function stopInputLivePreview({ keepMirror = false } = {}) {
        if (adbInputLiveTimer) {
          clearInterval(adbInputLiveTimer);
          adbInputLiveTimer = 0;
        }
        if (!keepMirror) {
          stopMirrorPreview({ notifyBridge: true });
          adbInputPreviewMode = "";
          clearInputPreviewSurface();
          const meta = $("#adb-input-live-meta");
          if (meta) {
            meta.hidden = true;
            meta.textContent = "";
          }
        }
        adbInputLive = false;
        updateInputLiveUi();
      }
  
      function afterInputPreviewAction() {
        if (!adbSelected) return;
        if (adbInputPreviewMode === "mirror" || (adbMirrorWs && adbMirrorWs.readyState === 1)) return;
        if (adbInputPreviewMode !== "live" && !adbInputLiveTimer) return;
        setTimeout(() => {
          if (adbTab !== "input" || adbInputPreviewMode !== "live") return;
          refreshInputScreencap({ quiet: true }).catch(() => {});
        }, 350);
      }
  
      function updateInputRecordUi() {
        updateInputLiveUi();
      }
  
      async function toggleInputRecord() {
        const serial = requireCurrentSerial();
        // 镜像中：优先浏览器侧录 canvas（含画面；音频另轨未混入）
        const canvas = $("#adb-input-mirror");
        if (adbInputPreviewMode === "mirror" && canvas && !canvas.hidden && canvas.captureStream) {
          if (adbMirrorLocalRec && adbMirrorLocalRec.state !== "inactive") {
            await new Promise((resolve) => {
              adbMirrorLocalRec.onstop = resolve;
              try {
                adbMirrorLocalRec.stop();
              } catch {
                resolve();
              }
            });
            const blob = new Blob(adbMirrorLocalChunks, { type: adbMirrorLocalRec.mimeType || "video/webm" });
            adbMirrorLocalRec = null;
            adbMirrorLocalChunks = [];
            updateInputRecordUi();
            if (blob.size) {
              const a = document.createElement("a");
              a.href = URL.createObjectURL(blob);
              a.download = `adb-mirror-${Date.now()}.webm`;
              a.click();
              setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
              toast("已保存浏览器侧镜像录屏");
            }
            return;
          }
          const stream = canvas.captureStream(30);
          const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
            ? "video/webm;codecs=vp9"
            : MediaRecorder.isTypeSupported("video/webm")
              ? "video/webm"
              : "";
          adbMirrorLocalChunks = [];
          adbMirrorLocalRec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
          adbMirrorLocalRec.ondataavailable = (ev) => {
            if (ev.data?.size) adbMirrorLocalChunks.push(ev.data);
          };
          adbMirrorLocalRec.start(1000);
          updateInputRecordUi();
          toast("浏览器侧镜像录屏中，再点停止并下载");
          return;
        }
        if (adbInputRecordJobId) {
          try {
            await cancelAdbJob(adbInputRecordJobId);
          } catch (err) {
            setError(adbError, err.message || String(err));
          }
          adbInputRecordJobId = "";
          if (adbInputRecordPoll) {
            clearInterval(adbInputRecordPoll);
            adbInputRecordPoll = 0;
          }
          updateInputRecordUi();
          toast("已请求停止录屏");
          return;
        }
        const data = await adbFetch("/media/record", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serial, seconds: 0 }),
        });
        const job = data.job;
        adbInputRecordJobId = job?.id || "";
        updateInputRecordUi();
        toast("预览内录屏已开始，再点一次停止");
        if (job) await trackJob(job);
        adbInputRecordPoll = setInterval(async () => {
          try {
            await refreshJobs({ silent: true });
            const j = adbJobs.find((x) => x.id === adbInputRecordJobId);
            if (!j || ["done", "completed", "success", "error", "cancelled"].includes(j.status)) {
              adbInputRecordJobId = "";
              clearInterval(adbInputRecordPoll);
              adbInputRecordPoll = 0;
              updateInputRecordUi();
            }
          } catch {
            /* ignore */
          }
        }, 2000);
      }
  
      async function pushPcClipboard() {
        const serial = requireCurrentSerial();
        let text = "";
        try {
          text = await navigator.clipboard.readText();
        } catch {
          throw new Error("无法读取电脑剪贴板（请允许站点剪贴板权限）");
        }
        if (!String(text || "").trim()) throw new Error("电脑剪贴板为空");
        if ($("#adb-clip-text")) $("#adb-clip-text").value = text;
        if (sendMirrorCtrl({ type: "clipboard", text, paste: false })) {
          toast("已经 scrcpy 推送剪贴板到手机");
          return;
        }
        await adbFetch("/clipboard", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serial, text }),
        });
        toast("已推送电脑剪贴板到手机");
      }
  
      async function pushFilesToDeviceDownload(files) {
        const serial = requireCurrentSerial();
        const list = [...(files || [])].filter(Boolean);
        if (!list.length) return;
        const remoteDir = "/sdcard/Download";
        let ok = 0;
        let fail = 0;
        for (const file of list) {
          const name = file.name || `file-${Date.now()}`;
          try {
            const url = `${adbBase()}/fs/upload?serial=${encodeURIComponent(serial)}&path=${encodeURIComponent(remoteDir)}&name=${encodeURIComponent(name)}`;
            const res = await fetch(url, {
              method: "POST",
              headers: {
                "X-Adb-Token": adbToken(),
                "Content-Type": "application/octet-stream",
                "X-Filename": encodeURIComponent(name),
              },
              body: file,
            });
            if (!res.ok) {
              const text = await res.text();
              throw new Error(text || `HTTP ${res.status}`);
            }
            ok += 1;
          } catch (err) {
            fail += 1;
            console.warn("push drop failed", name, err);
          }
        }
        toast(fail ? `已推送 ${ok} 个到 Download，失败 ${fail}` : `已推送 ${ok} 个到 /sdcard/Download`);
      }
  
      function updateRecordTip() {
        const tip = $("#adb-record-tip");
        const secEl = $("#adb-record-sec");
        if (!tip || !secEl) return;
        const sec = Number(secEl.value);
        tip.textContent =
          sec === 0
            ? "0 秒 = 无时限录屏，请用「取消录屏」或任务中的取消结束。"
            : `将录制约 ${sec} 秒后结束（部分系统硬上限约 180 秒）。也可随时取消。`;
      }
  
  
      bindPanel("adb", () => {
        if (window.devtoolsBridgeShell?.mount && !adbBridgeShell) {
          adbBridgeShell = window.devtoolsBridgeShell.mount({
            host: "#adb-bridge-shell",
            prefix: "adb",
            kind: "unified",
            collapseAdvanced: true,
            refreshLabel: "刷新设备",
            hintDisconnected:
              "请下载完整 ZIP（含 server.js 与启动脚本），解压后只运行一个启动脚本，再点「连接本机桥」。不要连续双击两次。",
            advancedHint:
              '下载解压后把文件夹路径填在这里（输入即自动记住，各工具共用）。「打开目录」可在本机资源管理器查看。首次请手动双击启动脚本（会注册 <span class="mono">devtools-bridge://</span>）。',
            connHint:
              '默认 Token <span class="mono">devtools-bridge</span>。一座桥同时提供 ADB、Scrcpy 与 FFmpeg（<span class="mono">/ff</span>）。',
          });
        }
        adbBaseInput = adbBridgeShell?.els?.base || $("#adb-base");
        adbTokenInput = adbBridgeShell?.els?.token || $("#adb-token");
        adbDot = adbBridgeShell?.els?.dot || $("#adb-dot");
        adbStatusTitle = adbBridgeShell?.els?.title || $("#adb-status-title");
        adbStatusText = adbBridgeShell?.els?.text || $("#adb-status-text");
        adbError = $("#adb-error");
        adbSetupGuide = $("#adb-setup-guide");
        adbSetupGuideDismiss = $("#adb-setup-guide-dismiss");
        syncAdbSetupGuide();
        adbSetupGuideDismiss?.addEventListener("click", dismissAdbSetupGuide);
        $("#adb-setup-guide-show")?.addEventListener("click", showAdbSetupGuide);
        adbWorkspace = $("#adb-workspace");
        adbDeviceList = $("#adb-device-list");
        adbDeviceMeta = $("#adb-device-meta");
        adbSelectedMeta = $("#adb-selected-meta");
        adbFsList = $("#adb-fs-list");
        adbFsPath = $("#adb-fs-path");
        adbFsMeta = $("#adb-fs-meta");
        adbInfoMeta = $("#adb-info-meta");
        adbAppsList = $("#adb-apps-list");
        adbAppsMeta = $("#adb-apps-meta");
        adbJobsList = $("#adb-jobs-list");
        adbJobsMeta = $("#adb-jobs-meta");
        adbInstallMeta = $("#adb-install-meta");
        adbApkName = $("#adb-apk-name");
        adbFsPreview = $("#adb-fs-preview");
        adbFsPreviewTitle = $("#adb-fs-preview-title");
        adbFsPreviewMeta = $("#adb-fs-preview-meta");
        adbFsPreviewBody = $("#adb-fs-preview-body");
        adbFsBatch = $("#adb-fs-batch");
        adbFsBatchMeta = $("#adb-fs-batch-meta");

        if (adbBridgeShell?.bind) {
          adbBridgeShell.bind({
            onStatus: (kind, title, text) => setAdbStatus(kind, title, text),
            onConnected: async () => {
              startAdbWaitPoll?.();
              await connectAdbBridge();
            },
            onConnect: () => connectAdbBridge(),
            onRefresh: () =>
              refreshAdbDevices().catch((err) => setError(adbError, err.message || String(err))),
            onDownloadDone: () => {
              toast("已下载完整包，请解压后运行");
              startAdbWaitPoll();
            },
            onDownloadError: (err) => {
              setError(adbError, err.message || String(err));
              setAdbStatus("is-err", "下载失败", err.message || String(err));
            },
            onPersist: () => persistAdbSettings(),
            toast: (msg) => toast(msg),
          });
        } else {
          $("#adb-connect")?.addEventListener("click", () => connectAdbBridge());
          window.devtoolsBridgeToken?.bindBridgeLaunchUI?.({
            kind: "unified",
            dirInput: $("#adb-install-dir"),
            saveBtn: $("#adb-install-dir-save"),
            launchBtn: $("#adb-bridge-launch"),
            autoEl: $("#adb-bridge-autostart"),
            getPreferredBase: () => adbBase(),
            getToken: () => adbToken(),
            onStatus: (kind, title, text) => setAdbStatus(kind, title, text),
            onConnected: async () => {
              startAdbWaitPoll?.();
              await connectAdbBridge();
            },
            toast: (msg) => toast(msg),
          });
          $("#adb-dl-mac")?.addEventListener("click", (e) => {
            e.preventDefault();
            downloadAdbScriptAndWait($("#adb-dl-mac"));
          });
          $("#adb-dl-win")?.addEventListener("click", (e) => {
            e.preventDefault();
            downloadAdbScriptAndWait($("#adb-dl-win"));
          });
          $("#adb-dl-linux")?.addEventListener("click", (e) => {
            e.preventDefault();
            downloadAdbScriptAndWait($("#adb-dl-linux"));
          });
        }

        // 进入面板时：未连接则按开关尝试自动启动
        void (async () => {
          if (adbConnected) return;
          if (window.devtoolsBridgeToken?.readAutoStart?.("unified") === false) return;
          try {
            const found = await window.devtoolsBridgeToken?.ensureBridgeRunning?.({
              preferredBase: adbBase(),
              token: adbToken(),
              timeoutMs: 20000,
              launch: true,
              kind: "unified",
            });
            if (found?.health) await connectAdbBridge({ fromPoll: true });
          } catch (_) {
            /* ignore */
          }
        })();

        if (!adbBridgeShell?.bind) {
          $("#adb-refresh")?.addEventListener("click", () =>
            refreshAdbDevices().catch((err) => setError(adbError, err.message || String(err)))
          );
        }
        adbBaseInput?.addEventListener("change", persistAdbSettings);
        adbTokenInput?.addEventListener("change", persistAdbSettings);
        $$(".adb-tab[data-adb-tab]").forEach((btn) => {
        btn.addEventListener("click", () => switchAdbTab(btn.dataset.adbTab));
        });

        $("#adb-perf-start")?.addEventListener("click", () => {
          try {
            startAdbPerf();
          } catch (err) {
            setError(adbError, err.message || String(err));
          }
        });
        $("#adb-perf-stop")?.addEventListener("click", () => stopAdbPerf());
        $("#adb-perf-once")?.addEventListener("click", () => {
          samplePerfOnce().catch((err) => setError(adbError, err.message || String(err)));
        });

        $("#adb-procs-refresh")?.addEventListener("click", () => {
          refreshProcesses().catch((err) => setError(adbError, err.message || String(err)));
        });
        $("#adb-procs-query")?.addEventListener("keydown", (e) => {
          if (e.key === "Enter") refreshProcesses().catch((err) => setError(adbError, err.message || String(err)));
        });
        $("#adb-procs-body")?.addEventListener("click", async (e) => {
          const killBtn = e.target.closest("[data-adb-kill-pid]");
          const stopBtn = e.target.closest("[data-adb-force-stop]");
          try {
            const serial = requireCurrentSerial();
            if (killBtn) {
              const pid = Number(killBtn.getAttribute("data-adb-kill-pid"));
              if (!confirm(`结束 PID ${pid}？`)) return;
              await adbFetch("/device/process/kill", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ serial, pid, mode: "kill" }),
              });
              toast(`已发送 kill ${pid}`);
              await refreshProcesses();
            } else if (stopBtn) {
              const packageName = stopBtn.getAttribute("data-adb-force-stop") || "";
              if (!confirm(`force-stop ${packageName}？`)) return;
              await adbFetch("/device/process/kill", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ serial, packageName, mode: "force-stop" }),
              });
              toast(`已 force-stop ${packageName}`);
              await refreshProcesses();
            }
          } catch (err) {
            setError(adbError, err.message || String(err));
          }
        });

        $("#adb-shell-new")?.addEventListener("click", () => {
          try {
            openShellSession();
          } catch (err) {
            setError(adbError, err.message || String(err));
          }
        });
        $("#adb-shell-close")?.addEventListener("click", () => {
          if (adbShellActive) closeShellSession(adbShellActive);
        });
        $("#adb-shell-clear")?.addEventListener("click", () => {
          const s = activeShell();
          if (s) {
            s.buf = "";
            renderShellOut();
          }
        });
        $("#adb-shell-tabs")?.addEventListener("click", (e) => {
          const btn = e.target.closest("[data-adb-shell-id]");
          if (!btn) return;
          adbShellActive = btn.getAttribute("data-adb-shell-id") || "";
          renderShellTabs();
          renderShellOut();
        });
        const sendShellLine = () => {
          try {
            const input = $("#adb-shell-input");
            const line = input?.value || "";
            sendShellInput(line, true);
            if (input) input.value = "";
          } catch (err) {
            setError(adbError, err.message || String(err));
          }
        };
        $("#adb-shell-send")?.addEventListener("click", sendShellLine);
        $("#adb-shell-input")?.addEventListener("keydown", (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            sendShellLine();
          }
        });
        $("#adb-shell-once-run")?.addEventListener("click", async () => {
          try {
            const serial = requireCurrentSerial();
            const command = $("#adb-shell-once-cmd")?.value || "";
            const data = await adbFetch("/shell/exec", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ serial, command }),
            });
            const out = $("#adb-shell-once-out");
            if (out) {
              out.textContent = `${data.stdout || ""}${data.stderr ? `\n${data.stderr}` : ""}${
                data.error ? `\n[error] ${data.error}` : ""
              }`.trim() || "(空输出)";
            }
          } catch (err) {
            setError(adbError, err.message || String(err));
          }
        });

        $("#adb-layout-dump")?.addEventListener("click", () => {
          dumpLayout().catch((err) => setError(adbError, err.message || String(err)));
        });
        $("#adb-layout-copy")?.addEventListener("click", async () => {
          try {
            if (!adbLayoutXml) throw new Error("请先 Dump");
            await navigator.clipboard.writeText(adbLayoutXml);
            toast("已复制 XML");
          } catch (err) {
            setError(adbError, err.message || String(err));
          }
        });
        $("#adb-layout-filter")?.addEventListener("input", () => {
          renderLayoutTree($("#adb-layout-filter")?.value || "");
        });
        $("#adb-layout-tree")?.addEventListener("click", (e) => {
          const btn = e.target.closest("[data-adb-layout-idx]");
          if (!btn) return;
          showLayoutNode(Number(btn.getAttribute("data-adb-layout-idx")));
        });
  
        function ensureLocalPaneLoaded() {
        if (!adbLocalRoots.length) return loadLocalRoots();
        if (!adbLocalPath && adbLocalRoots.length) return loadLocalPath(adbLocalRoots[0].path);
        syncLocalSaveMeta();
        return Promise.resolve();
        }
  
        $("#adb-fs-local-fold")?.addEventListener("toggle", (e) => {
        const open = Boolean(e.currentTarget?.open);
        if (open) ensureLocalPaneLoaded().catch((err) => setError(adbError, err.message || String(err)));
        });
  
        $("#adb-select-all")?.addEventListener("click", () => {
        adbChecked = new Set(adbDevices.map((d) => d.serial));
        renderAdbDevices();
        });
        $("#adb-select-none")?.addEventListener("click", () => {
        adbChecked = new Set();
        renderAdbDevices();
        });
  
        adbDeviceList?.addEventListener("click", (e) => {
        const check = e.target.closest("[data-adb-check]");
        if (check) return;
        const btn = e.target.closest("[data-serial]");
        if (!btn) return;
        selectAdbDevice(btn.dataset.serial).catch((err) => setError(adbError, err.message || String(err)));
        });
        adbDeviceList?.addEventListener("change", (e) => {
        const check = e.target.closest("[data-adb-check]");
        if (!check) return;
        const serial = check.dataset.adbCheck;
        if (check.checked) adbChecked.add(serial);
        else adbChecked.delete(serial);
        updateSelectedMeta();
        });
  
        $("#adb-fs-go")?.addEventListener("click", () => loadFs(adbFsPath?.value || "/"));
        $("#adb-fs-refresh")?.addEventListener("click", () => loadFs(adbFsPath?.value || "/", { history: "replace" }));
        $("#adb-fs-back")?.addEventListener("click", () => {
        if (adbFsHistIdx <= 0) return;
        adbFsHistIdx -= 1;
        loadFs(adbFsHistory[adbFsHistIdx], { history: "none" });
        });
        $("#adb-fs-forward")?.addEventListener("click", () => {
        if (adbFsHistIdx < 0 || adbFsHistIdx >= adbFsHistory.length - 1) return;
        adbFsHistIdx += 1;
        loadFs(adbFsHistory[adbFsHistIdx], { history: "none" });
        });
        $("#adb-fs-shortcuts")?.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-adb-fs-jump]");
        if (!btn) return;
        e.preventDefault();
        const target = btn.getAttribute("data-adb-fs-jump") || "/";
        loadFs(target);
        });
        adbFsPath?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") loadFs(adbFsPath.value || "/");
        });
        $("#adb-fs-up")?.addEventListener("click", () => {
        const cur = adbFsPath?.value || "/";
        if (cur === "/" || cur === "") {
        loadFs("/");
        return;
        }
        const parts = cur.replace(/\/+$/, "").split("/");
        if (parts.length <= 1) {
        loadFs("/");
        return;
        }
        parts.pop();
        loadFs(parts.join("/") || "/");
        });
        $("#adb-fs-mkdir")?.addEventListener("click", async () => {
        if (!adbSelected) return;
        const name = window.prompt("新建文件夹名称");
        if (!name || !name.trim()) return;
        const target = joinRemote(adbFsPath?.value || "/", name.trim());
        try {
        await adbFetch("/fs/mkdir", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial: adbSelected, path: target }),
        });
        toast("已创建文件夹");
        await loadFs(adbFsPath?.value || "/");
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
        $("#adb-fs-upload")?.addEventListener("change", async (e) => {
        try {
        await uploadAdbFiles(e.target.files || []);
        } catch (err) {
        setError(adbError, err.message || String(err));
        } finally {
        e.target.value = "";
        }
        });
        $("#adb-fs-upload-dir")?.addEventListener("change", async (e) => {
        try {
        await uploadAdbFiles(e.target.files || [], { relativePaths: true });
        } catch (err) {
        setError(adbError, err.message || String(err));
        } finally {
        e.target.value = "";
        }
        });
        $("#adb-fs-xfer-cancel")?.addEventListener("click", () => {
        if (adbFsXferAbort) {
        adbFsXferAbort.abort();
        toast("正在取消…");
        } else {
        hideFsXfer();
        }
        });
        $("#adb-fs-view-list")?.addEventListener("click", () => setAdbFsView("list"));
        $("#adb-fs-view-grid")?.addEventListener("click", () => setAdbFsView("grid"));
  
        $("#adb-fs-local-list")?.addEventListener("click", (e) => {
        const check = e.target.closest("[data-adb-local-check]");
        if (check) {
        const path = check.dataset.adbLocalCheck || "";
        const row = check.closest(".adb-fs-local-row");
        const name = row?.dataset.adbLocalName || basenameRemote(path);
        const isDir = row?.dataset.adbLocalDir === "1";
        if (check.checked) adbLocalChecked.set(path, { path, name, isDir });
        else adbLocalChecked.delete(path);
        row?.classList.toggle("is-checked", check.checked);
        syncLocalPushBtn();
        return;
        }
        const openEl = e.target.closest("[data-adb-local-open]");
        if (openEl?.dataset.adbLocalOpen) {
        loadLocalPath(openEl.dataset.adbLocalOpen).catch((err) => setError(adbError, err.message || String(err)));
        }
        });
        $("#adb-fs-local-up")?.addEventListener("click", () => {
        if (!adbLocalPath) return;
        loadLocalPath(parentOfLocalPath(adbLocalPath)).catch((err) => setError(adbError, err.message || String(err)));
        });
        $("#adb-fs-local-go")?.addEventListener("click", () => {
        const p = $("#adb-fs-local-path")?.value || "";
        if (p) loadLocalPath(p).catch((err) => setError(adbError, err.message || String(err)));
        });
        $("#adb-fs-local-path")?.addEventListener("keydown", (e) => {
        if (e.key === "Enter") $("#adb-fs-local-go")?.click();
        });
        $("#adb-fs-local-roots")?.addEventListener("click", (e) => {
        const btn = e.target.closest("[data-adb-local-root]");
        if (!btn) return;
        loadLocalPath(btn.dataset.adbLocalRoot || "").catch((err) => setError(adbError, err.message || String(err)));
        });
        $("#adb-fs-local-push")?.addEventListener("click", async () => {
        if (!adbSelected) {
        toast("请先选择设备");
        return;
        }
        const items = [...adbLocalChecked.values()];
        if (!items.length) return;
        if (!adbFsDirWritable) {
        toast("当前设备目录只读，无法推送");
        return;
        }
        const remoteDir = adbFsPath?.value || "/";
        try {
        const data = await adbFetch("/local/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial: adbSelected, paths: items.map((it) => it.path), remoteDir }),
        });
        const results = data.results || [];
        const ok = results.filter((r) => r.ok).length;
        const fail = results.length - ok;
        toast(fail ? `已推送 ${ok} 项，失败 ${fail} 项` : `已推送 ${ok} 项`);
        adbLocalChecked.clear();
        renderLocalList();
        syncLocalPushBtn();
        await loadFs(remoteDir, { history: "replace" });
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
  
        adbFsList?.addEventListener("click", async (e) => {
        const sortBtn = e.target.closest("[data-adb-fs-sort]");
        if (sortBtn) {
        e.preventDefault();
        e.stopPropagation();
        const key = sortBtn.dataset.adbFsSort || "name";
        if (adbFsSortKey === key) adbFsSortDir *= -1;
        else {
        adbFsSortKey = key;
        adbFsSortDir = 1;
        }
        paintFsList();
        return;
        }
        const moreBtn = e.target.closest("[data-adb-fs-more]");
        if (moreBtn) {
        e.preventDefault();
        e.stopPropagation();
        const row = moreBtn.closest(".adb-fs-row");
        const entry = collectFsEntrySelection(row);
        const rect = moreBtn.getBoundingClientRect();
        showFsCtxMenu(entry, rect.left, rect.bottom + 4);
        return;
        }
        const check = e.target.closest(".adb-fs-check");
        if (check) {
        e.stopPropagation();
        hideFsCtxMenu();
        const row = check.closest(".adb-fs-row");
        const entry = collectFsEntrySelection(row);
        if (!entry || entry.virtual) return;
        if (check.checked) adbFsChecked.set(entry.path, entry);
        else adbFsChecked.delete(entry.path);
        syncFsBatchBar();
        return;
        }
        hideFsCtxMenu();
        const row = e.target.closest(".adb-fs-row[data-adb-entry]");
        if (!row) return;
        // 单击：目录/虚拟包打开，文件预览
        if (row.dataset.adbOpen) {
        loadFs(row.dataset.adbOpen);
        return;
        }
        if (row.dataset.adbFile) {
        adbFsList.querySelectorAll(".adb-fs-row.is-selected").forEach((r) => r.classList.remove("is-selected"));
        row.classList.add("is-selected");
        adbFsSelected = row.dataset.adbFile || "";
        showFsProps(collectFsEntrySelection(row));
        previewAdbFile(row.dataset.adbFile, row.dataset.adbFileName, row.dataset.adbFileSize).catch((err) =>
        setError(adbError, err.message || String(err))
        );
        }
        });
        $("#adb-fs-filter")?.addEventListener("input", () => {
        paintFsList();
        if (adbFsMeta && adbFsPathCache) {
        const total = (adbFsEntriesCache || []).length;
        const q = String($("#adb-fs-filter")?.value || "").trim();
        adbFsMeta.textContent = q
        ? `筛选中 · 共 ${total} 项 · ${adbFsPathCache}`
        : `${total} 项 · ${adbFsPathCache}`;
        }
        });
        {
        const dropEl = $("#adb-fs-workspace") || adbFsList;
        const localDrop = $("#adb-fs-local") || $(".adb-fs-pane-local");
        const hasFiles = (dt) => dt && [...(dt.types || [])].includes("Files");
        const hasLocalPaths = (dt) =>
        dt && ([...(dt.types || [])].includes("application/x-adb-local-paths") || dt.getData?.("application/x-adb-local-paths"));
        const hasDevicePaths = (dt) =>
        dt && ([...(dt.types || [])].includes("application/x-adb-device-paths") || dt.getData?.("application/x-adb-device-paths"));
        const readEntryFile = (fileEntry) =>
        new Promise((resolve, reject) => {
        fileEntry.file(resolve, reject);
        });
        const readEntries = (reader) =>
        new Promise((resolve, reject) => {
        reader.readEntries(resolve, reject);
        });
        async function walkEntry(entry, prefix, out) {
        if (!entry) return;
        if (entry.isFile) {
        const file = await readEntryFile(entry);
        try {
        Object.defineProperty(file, "webkitRelativePath", {
        configurable: true,
        value: prefix ? `${prefix}/${file.name}` : file.name,
        });
        } catch (_) {
        /* ignore */
        }
        out.push(file);
        return;
        }
        if (entry.isDirectory) {
        const reader = entry.createReader();
        const nextPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
        while (true) {
        const batch = await readEntries(reader);
        if (!batch.length) break;
        for (const child of batch) {
        await walkEntry(child, nextPrefix, out);
        }
        }
        }
        }
        async function collectDroppedFiles(dt) {
        const out = [];
        const items = dt?.items ? [...dt.items] : [];
        if (items.some((it) => typeof it.webkitGetAsEntry === "function" && it.webkitGetAsEntry())) {
        for (const item of items) {
        if (item.kind !== "file") continue;
        const entry = item.webkitGetAsEntry?.();
        if (entry) await walkEntry(entry, "", out);
        else if (item.getAsFile) {
        const f = item.getAsFile();
        if (f) out.push(f);
        }
        }
        return out;
        }
        return [...(dt?.files || [])];
        }
        async function pushLocalPathsToDevice(paths) {
        if (!paths?.length || !adbSelected) return;
        if (!adbFsDirWritable) {
        toast("当前设备目录只读，无法接收");
        return;
        }
        const remoteDir = adbFsPath?.value || "/";
        const data = await adbFetch("/local/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial: adbSelected, paths, remoteDir }),
        });
        const results = data.results || [];
        const ok = results.filter((r) => r.ok).length;
        const fail = results.length - ok;
        toast(fail ? `已推送 ${ok} 项，失败 ${fail} 项` : `已推送 ${ok} 项`);
        await loadFs(remoteDir, { history: "replace" });
        }
        async function pullDevicePathsToLocal(items) {
        if (!items?.length || !canLocalPull()) {
        toast(canLocalPull() ? "无项目" : "本机直存不可用，请更新桥 ≥0.6.11");
        return;
        }
        for (const it of items) {
        if (it.isDir) await pullRemoteToLocalDir(it.path, it.name);
        else await pullRemoteToLocalDir(it.path, it.name);
        }
        toast(`已保存 ${items.length} 项到本机`);
        loadLocalPath(adbLocalPath).catch(() => {});
        }
  
        // OS files → device
        dropEl?.addEventListener("dragenter", (e) => {
        if (!hasFiles(e.dataTransfer) && !hasLocalPaths(e.dataTransfer)) return;
        e.preventDefault();
        dropEl.classList.add("is-drop");
        adbFsList?.classList.add("is-drop");
        });
        dropEl?.addEventListener("dragover", (e) => {
        if (!hasFiles(e.dataTransfer) && !hasLocalPaths(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        dropEl.classList.add("is-drop");
        adbFsList?.classList.add("is-drop");
        });
        dropEl?.addEventListener("dragleave", (e) => {
        if (e.relatedTarget && dropEl.contains(e.relatedTarget)) return;
        dropEl.classList.remove("is-drop");
        adbFsList?.classList.remove("is-drop");
        });
        dropEl?.addEventListener("drop", (e) => {
        e.preventDefault();
        dropEl.classList.remove("is-drop");
        adbFsList?.classList.remove("is-drop");
        try {
        const rawLocal = e.dataTransfer.getData("application/x-adb-local-paths");
        if (rawLocal) {
        const paths = JSON.parse(rawLocal);
        pushLocalPathsToDevice(paths).catch((err) => setError(adbError, err.message || String(err)));
        return;
        }
        } catch (_) {
        /* fall through */
        }
        if (!hasFiles(e.dataTransfer)) return;
        collectDroppedFiles(e.dataTransfer)
        .then((files) => {
        if (!files.length) return;
        const hasRel = files.some((f) => f.webkitRelativePath && f.webkitRelativePath.includes("/"));
        return uploadAdbFiles(files, { relativePaths: hasRel });
        })
        .catch((err) => setError(adbError, err.message || String(err)));
        });
  
        // device → local
        localDrop?.addEventListener("dragenter", (e) => {
        if (!hasDevicePaths(e.dataTransfer)) return;
        e.preventDefault();
        localDrop.classList.add("is-drop");
        });
        localDrop?.addEventListener("dragover", (e) => {
        if (!hasDevicePaths(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        localDrop.classList.add("is-drop");
        });
        localDrop?.addEventListener("dragleave", (e) => {
        if (e.relatedTarget && localDrop.contains(e.relatedTarget)) return;
        localDrop.classList.remove("is-drop");
        });
        localDrop?.addEventListener("drop", (e) => {
        e.preventDefault();
        localDrop.classList.remove("is-drop");
        try {
        const raw = e.dataTransfer.getData("application/x-adb-device-paths");
        if (!raw) return;
        const items = JSON.parse(raw);
        pullDevicePathsToLocal(items).catch((err) => setError(adbError, err.message || String(err)));
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
  
        // dragstart: local rows → device
        $("#adb-fs-local-list")?.addEventListener("dragstart", (e) => {
        const row = e.target.closest(".adb-fs-local-row[data-adb-local-path]");
        if (!row) return;
        const path = row.dataset.adbLocalPath;
        if (!path) return;
        const paths =
        adbLocalChecked.size && adbLocalChecked.has(path)
        ? [...adbLocalChecked.keys()]
        : [path];
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData("application/x-adb-local-paths", JSON.stringify(paths));
        e.dataTransfer.setData("text/plain", paths.join("\n"));
        });
  
        // dragstart: device rows → local
        adbFsList?.addEventListener("dragstart", (e) => {
        const row = e.target.closest(".adb-fs-row[data-adb-entry]");
        if (!row || row.classList.contains("is-virtual")) return;
        if (e.target.closest(".adb-fs-check") || e.target.closest("[data-adb-fs-more]")) {
        e.preventDefault();
        return;
        }
        const entry = collectFsEntrySelection(row);
        if (!entry) return;
        const items =
        adbFsChecked.size && adbFsChecked.has(entry.path)
        ? [...adbFsChecked.values()]
        : [entry];
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData(
        "application/x-adb-device-paths",
        JSON.stringify(items.map((it) => ({ path: it.path, name: it.name, isDir: !!it.isDir })))
        );
        e.dataTransfer.setData("text/plain", items.map((it) => it.path).join("\n"));
        });
        }
        adbFsList?.addEventListener("contextmenu", (e) => {
        const row = e.target.closest(".adb-fs-row[data-adb-entry]");
        if (!row || row.classList.contains("is-virtual")) return;
        if (e.target.closest(".adb-fs-check")) return;
        e.preventDefault();
        const entry = collectFsEntrySelection(row);
        showFsCtxMenu(entry, e.clientX, e.clientY);
        });
        document.addEventListener("click", (e) => {
        if (e.target.closest("#adb-fs-ctx") || e.target.closest("[data-adb-fs-more]")) return;
        hideFsCtxMenu();
        if (!e.target.closest("#adb-app-ctx")) hideAppCtxMenu();
        });
        document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
        hideFsCtxMenu();
        hideAppCtxMenu();
        }
        });
        document.addEventListener("keydown", (e) => {
        if (adbTab !== "files") return;
        const tag = (e.target && e.target.tagName) || "";
        const typing =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (e.target && e.target.isContentEditable);
        if (typing) return;
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
        $("#adb-fs-select-all")?.click();
        return;
        }
        if (e.key === "Escape") {
        hideFsCtxMenu();
        clearFsChecked();
        clearAdbFsPreview();
        return;
        }
        const selectedRow =
        adbFsList?.querySelector(".adb-fs-row.is-selected[data-adb-entry]") ||
        adbFsList?.querySelector(".adb-fs-row.is-checked[data-adb-entry]");
        if (e.key === "F2") {
        e.preventDefault();
        const entry = collectFsEntrySelection(selectedRow);
        if (entry && !entry.virtual) runFsEntryAction("rename", entry);
        return;
        }
        if (e.key === "Delete" || e.key === "Backspace") {
        if (adbFsChecked.size) {
        e.preventDefault();
        $("#adb-fs-batch-del")?.click();
        return;
        }
        const entry = collectFsEntrySelection(selectedRow);
        if (entry && !entry.virtual) {
        e.preventDefault();
        runFsEntryAction("delete", entry);
        }
        return;
        }
        if (e.key === "Enter") {
        const entry = collectFsEntrySelection(selectedRow);
        if (!entry) return;
        e.preventDefault();
        if (entry.isDir || entry.virtual) runFsEntryAction("open", entry);
        else runFsEntryAction("preview", entry);
        }
        });
        window.addEventListener("scroll", hideFsCtxMenu, true);
        $("#adb-fs-preview-close")?.addEventListener("click", () => clearAdbFsPreview());
        $("#adb-fs-select-all")?.addEventListener("click", () => {
        adbFsList?.querySelectorAll(".adb-fs-row[data-adb-entry]:not(.is-virtual)").forEach((row) => {
        const entry = collectFsEntrySelection(row);
        if (entry) adbFsChecked.set(entry.path, entry);
        });
        syncFsBatchBar();
        });
        $("#adb-fs-select-none")?.addEventListener("click", () => clearFsChecked());
        $("#adb-fs-batch-dl")?.addEventListener("click", async () => {
        const items = [...adbFsChecked.values()];
        if (!items.length) {
        toast("请先勾选要下载的文件或文件夹");
        return;
        }
        if (adbFsXferBusy) {
        toast("已有传输进行中");
        return;
        }
        adbFsXferBusy = true;
        const controller = new AbortController();
        adbFsXferAbort = controller;
        const started = performance.now();
        try {
        for (let i = 0; i < items.length; i++) {
        if (controller.signal.aborted) throw new DOMException("aborted", "AbortError");
        const it = items[i];
        if (it.isDir) {
        updateFsXfer({
        title: `批量下载 ${i + 1}/${items.length} · ${canLocalPull() ? "拉取文件夹" : "打包文件夹"}`,
        name: it.name,
        loaded: i,
        total: items.length,
        started,
        });
        if (canLocalPull()) {
        await pullRemoteToLocalDir(it.path, it.name, { signal: controller.signal });
        toast(`「${it.name}」已保存到本机目录`);
        } else if (canFsZip()) {
        const res = await adbFetch(
        `/fs/zip?serial=${encodeURIComponent(adbSelected)}&path=${encodeURIComponent(it.path)}`,
        { signal: controller.signal }
        );
        const blob = await res.blob();
        downloadBlobFile(blob, `${it.name || basenameRemote(it.path) || "folder"}.zip`);
        toast(`「${it.name}」已桥端打包下载`);
        } else {
        const { blob, count, skipped } = await downloadFolderBlob(it.path, {
        signal: controller.signal,
        onProgress: ({ name: n }) => {
        updateFsXfer({
        title: `批量下载 ${i + 1}/${items.length} · 打包文件夹`,
        name: n,
        loaded: i,
        total: items.length,
        started,
        });
        },
        });
        downloadBlobFile(blob, `${it.name || basenameRemote(it.path) || "folder"}.zip`);
        toast(skipped ? `「${it.name}」已打包 ${count} 个文件（已达上限）` : `「${it.name}」已打包 ${count} 个文件`);
        }
        } else {
        updateFsXfer({
        title: `批量下载 ${i + 1}/${items.length}`,
        name: it.name,
        loaded: i,
        total: items.length,
        started,
        });
        await downloadAdbFile(it.path, it.name, { nested: true, signal: controller.signal });
        }
        }
        toast(canLocalPull() ? `已保存 ${items.length} 项到本机目录` : `已开始下载 ${items.length} 项`);
        if (canLocalPull()) {
        loadLocalPath(adbLocalPath).catch(() => {});
        }
        } catch (err) {
        if (err?.name === "AbortError") toast("已取消批量下载");
        else setError(adbError, err.message || String(err));
        } finally {
        adbFsXferBusy = false;
        adbFsXferAbort = null;
        hideFsXfer();
        }
        });
        $("#adb-fs-batch-cut")?.addEventListener("click", () => {
        const items = [...adbFsChecked.values()];
        if (!items.length) return;
        setFsClipboard("cut", items);
        clearFsChecked();
        toast(`已准备移动 ${items.length} 项，打开目标目录后粘贴`);
        });
        $("#adb-fs-batch-copy")?.addEventListener("click", () => {
        const items = [...adbFsChecked.values()];
        if (!items.length) return;
        setFsClipboard("copy", items);
        toast(`已复制 ${items.length} 项，打开目标目录后粘贴`);
        });
        $("#adb-fs-batch-del")?.addEventListener("click", async () => {
        const items = [...adbFsChecked.values()];
        if (!items.length) return;
        if (!window.confirm(`确认删除选中的 ${items.length} 项？此操作不可恢复。`)) return;
        try {
        for (let i = 0; i < items.length; i++) {
        if (adbFsMeta) adbFsMeta.textContent = `批量删除 ${i + 1}/${items.length}：${items[i].name}`;
        await adbFetch("/fs/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial: adbSelected, path: items[i].path }),
        });
        }
        toast(`已删除 ${items.length} 项`);
        clearFsChecked();
        await loadFs(adbFsPath?.value || "/");
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
        $("#adb-fs-paste")?.addEventListener("click", async () => {
        const items = clipboardItems();
        if (!items.length || !adbSelected) return;
        const dir = adbFsPath?.value || "/";
        const mode = adbFsClipboard.mode === "cut" ? "cut" : "copy";
        try {
        for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const destName = it.name || basenameRemote(it.path);
        const to = joinRemote(dir, destName);
        if (adbFsMeta) adbFsMeta.textContent = `${mode === "cut" ? "移动" : "复制"} ${i + 1}/${items.length}：${destName}`;
        if (mode === "cut") {
        await adbFetch("/fs/move", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial: adbSelected, from: it.path, to }),
        });
        } else {
        await adbFetch("/fs/copy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial: adbSelected, from: it.path, to }),
        });
        }
        }
        toast(mode === "cut" ? `已移动 ${items.length} 项到当前目录` : `已复制 ${items.length} 项到当前目录`);
        if (mode === "cut") adbFsClipboard = null;
        updateFsClipboardMeta();
        await loadFs(dir);
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
        adbFsList?.addEventListener("dblclick", (e) => {
        if (e.target.closest(".adb-fs-check, .adb-fs-more, #adb-fs-ctx")) return;
        const row = e.target.closest(".adb-fs-row[data-adb-entry]");
        if (!row) return;
        e.preventDefault();
        if (row.dataset.adbOpen) {
        loadFs(row.dataset.adbOpen);
        return;
        }
        if (row.dataset.adbFile) {
        adbFsList.querySelectorAll(".adb-fs-row.is-selected").forEach((r) => r.classList.remove("is-selected"));
        row.classList.add("is-selected");
        adbFsSelected = row.dataset.adbFile || "";
        showFsProps(collectFsEntrySelection(row));
        previewAdbFile(row.dataset.adbFile, row.dataset.adbFileName, row.dataset.adbFileSize).catch((err) =>
        setError(adbError, err.message || String(err))
        );
        }
        });
        $("#adb-fs-crumbs")?.addEventListener("click", (e) => {
        const openBtn = e.target.closest("[data-adb-open]");
        if (!openBtn) return;
        loadFs(openBtn.dataset.adbOpen);
        });
        $("[data-adb-panel='files']")?.addEventListener("click", (e) => {
        if (e.target.closest("#adb-fs-list, #adb-fs-crumbs")) return;
        const openBtn = e.target.closest("button[data-adb-open]");
        if (!openBtn) return;
        loadFs(openBtn.dataset.adbOpen);
        });
  
        $("#adb-apk-file")?.addEventListener("change", (e) => {
        adbApkFile = e.target.files?.[0] || null;
        adbApkUploadId = "";
        adbApkInfo = null;
        if ($("#adb-apk-pkg")) $("#adb-apk-pkg").value = "";
        if (adbApkName) {
        adbApkName.textContent = adbApkFile
        ? `${adbApkFile.name}（${formatBytes(adbApkFile.size)}）`
        : "尚未选择 APK";
        }
        setApkButtonsEnabled(Boolean(adbApkFile));
        const infoEl = $("#adb-apk-info");
        if (infoEl) {
        infoEl.hidden = true;
        infoEl.textContent = "";
        }
        });
        $("#adb-apk-analyze")?.addEventListener("click", () =>
        analyzeSelectedApk().catch((err) => setError(adbError, err.message || String(err)))
        );
        $("#adb-apk-push-system")?.addEventListener("click", () =>
        pushSystemApk().catch((err) => setError(adbError, err.message || String(err)))
        );
        $("#adb-apk-install-selected")?.addEventListener("click", async () => {
        try {
        await startInstall(targetSerials(true));
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
        $("#adb-apk-install-current")?.addEventListener("click", async () => {
        try {
        if (!adbSelected) throw new Error("请先选择当前设备");
        await startInstall([adbSelected]);
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
  
        $("#adb-apps-refresh")?.addEventListener("click", () =>
        loadApps().catch((err) => setError(adbError, err.message || String(err)))
        );
        async function runPermAction(action) {
        if (!adbPermPackage) throw new Error("请先在应用列表点「选中」");
        const permission = String($("#adb-perm-name")?.value || "").trim();
        if (!permission) throw new Error("请填写权限名");
        await adbFetch("/apps/permission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        serial: requireCurrentSerial(),
        packageName: adbPermPackage,
        action,
        permission,
        }),
        });
        toast(action === "grant" ? "已授予权限" : "已撤销权限");
        }
        $("#adb-perm-grant")?.addEventListener("click", () =>
        runPermAction("grant").catch((err) => setError(adbError, err.message || String(err)))
        );
        $("#adb-perm-revoke")?.addEventListener("click", () =>
        runPermAction("revoke").catch((err) => setError(adbError, err.message || String(err)))
        );
  
        $("#adb-proxy-refresh")?.addEventListener("click", () =>
        refreshProxy().catch((err) => setError(adbError, err.message || String(err)))
        );
        $("#adb-proxy-set")?.addEventListener("click", async () => {
        try {
        const data = await adbFetch("/network/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        serial: requireCurrentSerial(),
        host: $("#adb-proxy-host")?.value || "",
        port: $("#adb-proxy-port")?.value || "",
        }),
        });
        toast(data.message || "代理已设置");
        await refreshProxy({ silent: true });
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
        $("#adb-proxy-clear")?.addEventListener("click", async () => {
        try {
        const data = await adbFetch("/network/proxy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial: requireCurrentSerial(), clear: true }),
        });
        toast(data.message || "代理已清除");
        if ($("#adb-proxy-host")) $("#adb-proxy-host").value = "";
        if ($("#adb-proxy-port")) $("#adb-proxy-port").value = "";
        await refreshProxy({ silent: true });
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
        $("#adb-fwd-refresh")?.addEventListener("click", () =>
        refreshForwards().catch((err) => setError(adbError, err.message || String(err)))
        );
        $("#adb-fwd-add")?.addEventListener("click", async () => {
        try {
        const data = await adbFetch("/network/forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        serial: requireCurrentSerial(),
        direction: $("#adb-fwd-dir")?.value || "forward",
        local: $("#adb-fwd-local")?.value || "",
        remote: $("#adb-fwd-remote")?.value || "",
        }),
        });
        toast(data.message || "已添加转发");
        await refreshForwards({ silent: true });
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
        $("#adb-fwd-remove")?.addEventListener("click", async () => {
        try {
        const data = await adbFetch("/network/forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        serial: requireCurrentSerial(),
        direction: $("#adb-fwd-dir")?.value || "forward",
        local: $("#adb-fwd-local")?.value || "",
        remove: true,
        }),
        });
        toast(data.message || "已移除");
        await refreshForwards({ silent: true });
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
        $("#adb-fwd-clear")?.addEventListener("click", async () => {
        try {
        if (!window.confirm("确认清除当前方向的全部端口转发？")) return;
        const data = await adbFetch("/network/forward", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        serial: requireCurrentSerial(),
        direction: $("#adb-fwd-dir")?.value || "forward",
        removeAll: true,
        }),
        });
        toast(data.message || "已清除");
        await refreshForwards({ silent: true });
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
  
        $("#adb-dev-refresh")?.addEventListener("click", () =>
        refreshDeveloper().catch((err) => setError(adbError, err.message || String(err)))
        );
        $("#adb-open-dev-page")?.addEventListener("click", () =>
        deviceControl("open_developer").catch((err) => setError(adbError, err.message || String(err)))
        );
        $$("[data-adb-dev]").forEach((btn) => {
        btn.addEventListener("click", async () => {
        try {
        const key = btn.dataset.adbDev;
        const raw = btn.dataset.adbDevVal;
        const value = raw === "1" || raw === "true";
        const data = await adbFetch("/developer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial: requireCurrentSerial(), key, value }),
        });
        toast(data.message || "已更新");
        await refreshDeveloper({ silent: true });
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
        });
        $$("[data-adb-dev-quick]").forEach((btn) => {
        btn.addEventListener("click", async () => {
        try {
        const action = btn.dataset.adbDevQuick;
        const data = await adbFetch("/device/control", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial: requireCurrentSerial(), action }),
        });
        toast(data.message || "已执行");
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
        });
        $("#adb-anim-apply")?.addEventListener("click", async () => {
        try {
        const data = await adbFetch("/developer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        serial: requireCurrentSerial(),
        key: "animation_scale_all",
        value: $("#adb-anim-scale")?.value || "1",
        }),
        });
        toast(data.message || "动画倍率已应用");
        await refreshDeveloper({ silent: true });
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
        $("#adb-apps-kind")?.addEventListener("change", () =>
        loadApps().catch((err) => setError(adbError, err.message || String(err)))
        );
        $("#adb-apps-filter")?.addEventListener("input", () => renderApps());
        adbAppsList?.addEventListener("change", (e) => {
        const check = e.target.closest("[data-adb-app-check]");
        if (!check) return;
        if (check.checked) {
        adbAppsList.querySelectorAll("[data-adb-app-check]").forEach((el) => {
        if (el !== check) el.checked = false;
        });
        setPermTarget(check.dataset.adbAppCheck);
        } else if (adbPermPackage === check.dataset.adbAppCheck) {
        setPermTarget("");
        }
        });
        adbAppsList?.addEventListener("click", async (e) => {
        if (e.target.closest("[data-adb-app-check]") || e.target.closest(".adb-app-select")) {
        // checkbox handled in change; allow label click without triggering action buttons
        if (!e.target.closest("button")) return;
        }
        const openBtn = e.target.closest("[data-adb-app-open]");
        const infoBtn = e.target.closest("[data-adb-app-info]");
        const uninstallBtn = e.target.closest("[data-adb-app-uninstall]");
        try {
        if (openBtn) {
        await runAppRowAction("open", openBtn.dataset.adbAppOpen);
        return;
        }
        if (infoBtn) {
        await runAppRowAction("info", infoBtn.dataset.adbAppInfo);
        return;
        }
        if (uninstallBtn) {
        await runAppRowAction("uninstall", uninstallBtn.dataset.adbAppUninstall);
        }
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
        adbAppsList?.addEventListener("contextmenu", (e) => {
        const row = e.target.closest(".adb-app-row[data-adb-app-pkg]");
        if (!row) return;
        if (e.target.closest("button") || e.target.closest("input")) return;
        e.preventDefault();
        hideFsCtxMenu();
        showAppCtxMenu(row.dataset.adbAppPkg, e.clientX, e.clientY);
        });
  
        $("#adb-shot-selected")?.addEventListener("click", async () => {
        try {
        const serials = targetSerials(true);
        if (!serials.length) throw new Error("请选择设备");
        const data = await adbFetch("/media/screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serials }),
        });
        await trackJob(data.job);
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
        $("#adb-shot-current")?.addEventListener("click", async () => {
        try {
        if (!adbSelected) throw new Error("请先选择当前设备");
        const data = await adbFetch("/media/screenshot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serials: [adbSelected] }),
        });
        await trackJob(data.job);
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
        $("#adb-record-current")?.addEventListener("click", async () => {
        try {
        if (!adbSelected) throw new Error("请先选择当前设备");
        const raw = $("#adb-record-sec")?.value;
        const seconds = raw === "" || raw == null ? 30 : Number(raw);
        if (seconds === 0) {
        updateRecordTip();
        toast("无时限录屏已开始，请稍后取消结束");
        }
        const data = await adbFetch("/media/record", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial: adbSelected, seconds }),
        });
        await trackJob(data.job);
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
        $("#adb-record-sec")?.addEventListener("input", updateRecordTip);
        $("#adb-record-cancel")?.addEventListener("click", async () => {
        try {
        const job = adbJobs.find(
        (j) =>
        j.type === "record" &&
        (j.status === "running" || j.status === "pending" || j.status === "queued")
        );
        if (!job) throw new Error("没有进行中的录屏任务");
        await cancelAdbJob(job.id);
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
        $("#adb-media-zip")?.addEventListener("click", async () => {
        try {
        const done = (j) =>
        j.status === "done" || j.status === "completed" || j.status === "success" || j.status === "cancelled";
        const withArts = (adbJobs || []).filter((j) => (j.artifacts || []).length && done(j));
        const job =
        withArts.find((j) => j.type === "screenshot") ||
        withArts.find((j) => j.type === "record") ||
        withArts[0];
        if (!job) throw new Error("没有可打包的任务产物，请先截图/录屏并等待完成");
        await zipJobArtifacts(job.id);
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
  
        $("#adb-jobs-refresh")?.addEventListener("click", () =>
        refreshJobs().catch((err) => setError(adbError, err.message || String(err)))
        );
        async function onAdbJobClick(e) {
        const cancelBtn = e.target.closest("[data-adb-job-cancel]");
        if (cancelBtn) {
        try {
        await cancelAdbJob(cancelBtn.dataset.adbJobCancel);
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        return;
        }
        const zipBtn = e.target.closest("[data-adb-job-zip]");
        if (zipBtn) {
        try {
        await zipJobArtifacts(zipBtn.dataset.adbJobZip);
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        return;
        }
        const btn = e.target.closest("[data-adb-art-job]");
        if (!btn) return;
        try {
        await downloadArtifact(btn.dataset.adbArtJob, btn.dataset.adbArtName);
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        }
        adbJobsList?.addEventListener("click", onAdbJobClick);
        $("#adb-media-jobs")?.addEventListener("click", onAdbJobClick);
        $("#adb-install-jobs")?.addEventListener("click", onAdbJobClick);
        $("#adb-media-preview")?.addEventListener("click", onAdbJobClick);
  
        $("#adb-snap-refresh")?.addEventListener("click", () =>
        loadSnapshot().catch((err) => setError(adbError, err.message || String(err)))
        );
        $("#adb-getprop-open")?.addEventListener("click", () => {
        openGetpropDialog().catch((err) => setError(adbError, err.message || String(err)));
        });
        $("#adb-getprop-close")?.addEventListener("click", () => {
        const dlg = $("#adb-getprop-dlg");
        if (dlg?.open && typeof dlg.close === "function") dlg.close();
        });
        $("#adb-getprop-dlg")?.addEventListener("cancel", (ev) => {
        ev.preventDefault();
        const dlg = $("#adb-getprop-dlg");
        if (dlg?.open && typeof dlg.close === "function") dlg.close();
        });
        $("#adb-getprop-search")?.addEventListener("input", () => renderGetpropList());
        $("#adb-getprop-reload")?.addEventListener("click", () => {
        loadGetprop({ force: true }).catch((err) => setError(adbError, err.message || String(err)));
        });
        $("#adb-stay-on")?.addEventListener("click", () =>
        deviceControl("stay_awake_on").catch((err) => setError(adbError, err.message || String(err)))
        );
        $("#adb-stay-off")?.addEventListener("click", () =>
        deviceControl("stay_awake_off").catch((err) => setError(adbError, err.message || String(err)))
        );
        $("#adb-open-dev")?.addEventListener("click", () =>
        deviceControl("open_developer").catch((err) => setError(adbError, err.message || String(err)))
        );
        $("#adb-open-log")?.addEventListener("click", () =>
        deviceControl("open_logging").catch((err) => setError(adbError, err.message || String(err)))
        );
        $("#adb-usb-install")?.addEventListener("click", () =>
        deviceControl("enable_usb_install").catch((err) => setError(adbError, err.message || String(err)))
        );
        $("#adb-open-unknown")?.addEventListener("click", () =>
        deviceControl("open_install_unknown").catch((err) => setError(adbError, err.message || String(err)))
        );
  
        $("#adb-log-fetch")?.addEventListener("click", () =>
        fetchLogcat().catch((err) => setError(adbError, err.message || String(err)))
        );
        let adbLogLiveEl;
        if (adbLogLiveEl) {
        if (adbLogLiveEl.type === "checkbox") {
        adbLogLiveEl.addEventListener("change", () => {
        toggleAdbLogLive(adbLogLiveEl.checked);
        });
        } else {
        adbLogLiveEl.addEventListener("click", () => toggleAdbLogLive());
        }
        }
        $("#adb-log-clear")?.addEventListener("click", async () => {
        try {
        const serial = requireCurrentSerial();
        if (!window.confirm("确认清空设备 logcat 缓冲？")) return;
        await adbFetch("/logcat/clear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial }),
        });
        toast("已清空日志缓冲");
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
        $("#adb-log-copy")?.addEventListener("click", async () => {
        const text = $("#adb-log-out")?.textContent || "";
        if (!text || text === "尚未拉取") return;
        try {
        await navigator.clipboard.writeText(text);
        toast("日志已复制");
        } catch (_) {
        toast("复制失败");
        }
        });
        $("#adb-log-download")?.addEventListener("click", () => {
        const text = $("#adb-log-out")?.textContent || "";
        if (!text || text === "尚未拉取") return;
        const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `logcat-${adbSelected || "device"}-${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        });
  
        $("#adb-tap-run")?.addEventListener("click", async () => {
        try {
        await adbFetch("/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        serial: requireCurrentSerial(),
        action: "tap",
        x: Number($("#adb-tap-x")?.value),
        y: Number($("#adb-tap-y")?.value),
        }),
        });
        toast("已点击");
        if (!$("#adb-input-canvas")?.hidden) afterInputPreviewAction();
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
        $("#adb-swipe-run")?.addEventListener("click", async () => {
        try {
        await adbFetch("/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        serial: requireCurrentSerial(),
        action: "swipe",
        x1: Number($("#adb-swipe-x1")?.value),
        y1: Number($("#adb-swipe-y1")?.value),
        x2: Number($("#adb-swipe-x2")?.value),
        y2: Number($("#adb-swipe-y2")?.value),
        duration: Number($("#adb-swipe-ms")?.value || 300),
        }),
        });
        toast("已滑动");
        if (!$("#adb-input-canvas")?.hidden) afterInputPreviewAction();
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
        $$("[data-adb-key]").forEach((btn) => {
        btn.addEventListener("click", async () => {
        try {
        if (sendMirrorCtrl({ type: "key", key: btn.dataset.adbKey })) {
          toast(`按键 ${btn.dataset.adbKey}`);
          return;
        }
        await adbFetch("/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        serial: requireCurrentSerial(),
        action: "key",
        key: btn.dataset.adbKey,
        }),
        });
        toast(`按键 ${btn.dataset.adbKey}`);
        if (adbTab === "input" && !$("#adb-input-canvas")?.hidden) afterInputPreviewAction();
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
        });
        $("#adb-input-text-run")?.addEventListener("click", async () => {
        try {
        const text = $("#adb-input-text")?.value || "";
        if (sendMirrorCtrl({ type: "text", text })) {
          toast("已经 scrcpy 输入文本");
          return;
        }
        await adbFetch("/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        serial: requireCurrentSerial(),
        action: "text",
        text,
        }),
        });
        toast("已输入文本");
        if (!$("#adb-input-canvas")?.hidden) afterInputPreviewAction();
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
        $("#adb-input-refresh-shot")?.addEventListener("click", () => {
        if (adbInputLiveTimer) {
        clearInterval(adbInputLiveTimer);
        adbInputLiveTimer = 0;
        adbInputLive = false;
        }
        stopMirrorPreview({ notifyBridge: true });
        refreshInputScreencap().catch((err) => setError(adbError, err.message || String(err)));
        });
        $("#adb-input-mirror-start")?.addEventListener("click", () => {
        const meta = $("#adb-input-meta");
        const mirrorBtn = $("#adb-input-mirror-start");
        if (meta) meta.textContent = "正在启动镜像…";
        if (mirrorBtn) mirrorBtn.disabled = true;
        startMirrorPreview()
        .then(() => toast("镜像已连接，正在出画…"))
        .catch((err) => {
          const msg = err.message || String(err);
          setError(adbError, msg);
          if (meta) meta.textContent = `镜像失败：${msg}`;
        })
        .finally(() => {
          if (mirrorBtn && !mirrorBtn.title) mirrorBtn.disabled = false;
        });
        });
        $("#adb-input-live-stop")?.addEventListener("click", () => {
        stopInputLivePreview();
        toast("已停止预览");
        });
        $("#adb-input-record-toggle")?.addEventListener("click", () => {
        toggleInputRecord().catch((err) => setError(adbError, err.message || String(err)));
        });
        $("#adb-input-clip-pc")?.addEventListener("click", () => {
        pushPcClipboard().catch((err) => setError(adbError, err.message || String(err)));
        });
        $("#adb-input-clip-pull")?.addEventListener("click", () => {
          if (!sendMirrorCtrl({ type: "get_clipboard" })) {
            toast("需镜像 + scrcpy 控制通道");
            return;
          }
          toast("已请求手机剪贴板…");
        });
        $("#adb-mirror-power-off")?.addEventListener("click", () => {
          if (sendMirrorCtrl({ type: "display_power", on: false })) {
            adbMirrorDisplayOff = true;
            updateMirrorPowerUi();
            toast("已熄屏（镜像继续）");
          }
        });
        $("#adb-mirror-power-on")?.addEventListener("click", () => {
          if (sendMirrorCtrl({ type: "display_power", on: true })) {
            adbMirrorDisplayOff = false;
            updateMirrorPowerUi();
            toast("已亮屏");
          }
        });
        $("#adb-mirror-notif")?.addEventListener("click", () => {
          if (sendMirrorCtrl({ type: "expand_notification" })) toast("已展开通知栏");
        });
        ["adb-mirror-quality", "adb-mirror-audio", "adb-mirror-show-touches"].forEach((id) => {
          $(`#${id}`)?.addEventListener("change", () => persistMirrorOptions());
        });
        restoreMirrorOptions();
        {
        const sizeEl = $("#adb-input-shot-size");
        sizeEl?.addEventListener("input", () => applyInputShotSize(sizeEl.value));
        sizeEl?.addEventListener("change", () => applyInputShotSize(sizeEl.value));
        $("#adb-input-shot-size-reset")?.addEventListener("click", () => {
        applyInputShotSize(ADB_INPUT_SHOT_VH_DEFAULT);
        toast("已恢复默认预览大小");
        });
        restoreInputShotSize();
        }
        {
        const wrap = $("#adb-input-shot-wrap");
        const LONG_MS = 520;
        const DOUBLE_MS = 320;
        const MOVE_THRESH = 10;
        const MIRROR_MOVE_MS = 32;
        let drag = null;
        let longTimer = 0;
        let pendingTap = null; // { x, y, timer }
        let mirrorTouchBusy = false;
        let mirrorMoveLatest = null;
        let mirrorMovePumping = false;

        const clearLongTimer = () => {
        if (longTimer) {
        clearTimeout(longTimer);
        longTimer = 0;
        }
        };
        const clearPendingTap = () => {
        if (pendingTap?.timer) clearTimeout(pendingTap.timer);
        pendingTap = null;
        };
        const sendInput = (body) =>
        adbFetch("/input", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serial: requireCurrentSerial(), ...body }),
        });
        const mirrorLive = () =>
          adbInputPreviewMode === "mirror" && adbMirrorWs && adbMirrorWs.readyState === 1;
        const sendMirrorControlTouch = (phase, x, y) => {
          if (!adbMirrorWs || adbMirrorWs.readyState !== 1) return false;
          // 必须等 hello.control===true，避免旧桥吞掉 WS 消息却不注入
          if (!adbMirrorMeta?.control) return false;
          try {
            adbMirrorWs.send(JSON.stringify({ type: "touch", phase, x, y }));
            return true;
          } catch {
            return false;
          }
        };
        const pumpMirrorMoves = async () => {
          if (mirrorMovePumping) return;
          mirrorMovePumping = true;
          try {
            while (mirrorMoveLatest) {
              const m = mirrorMoveLatest;
              mirrorMoveLatest = null;
              try {
                if (sendMirrorControlTouch("MOVE", m.x, m.y)) continue;
                await sendInput({
                  action: "touch",
                  phase: "MOVE",
                  x: m.x,
                  y: m.y,
                  x0: m.x0,
                  y0: m.y0,
                });
              } catch {
                /* ignore move errors to keep drag fluid */
              }
            }
          } finally {
            mirrorMovePumping = false;
            if (mirrorMoveLatest) pumpMirrorMoves();
          }
        };
        const sendMirrorTouch = async (phase, x, y, x0, y0) => {
          if (phase === "MOVE") {
            mirrorMoveLatest = { x, y, x0, y0 };
            pumpMirrorMoves();
            return;
          }
          // DOWN/UP：优先 scrcpy control（低延迟）；失败再回退 adb motionevent
          if (sendMirrorControlTouch(phase, x, y)) return;
          while (mirrorMovePumping || mirrorMoveLatest) {
            await new Promise((r) => setTimeout(r, 8));
          }
          mirrorTouchBusy = true;
          try {
            await sendInput({
              action: "touch",
              phase,
              x,
              y,
              ...(Number.isFinite(x0) ? { x0, y0 } : {}),
            });
          } finally {
            mirrorTouchBusy = false;
          }
        };
        const surfaceReady = (el) => {
        if (!el) return false;
        if (el.tagName === "CANVAS") return el.width > 0 && !el.hidden;
        return Boolean(el.naturalWidth) && !el.hidden;
        };
  
        wrap?.addEventListener("wheel", (e) => {
          if (!mirrorLive() || !adbMirrorMeta?.control) return;
          const surface = adbPreviewSurface();
          if (!surfaceReady(surface)) return;
          e.preventDefault();
          const pt = adbCanvasCoords(surface, e.clientX, e.clientY);
          const v = Math.max(-1, Math.min(1, -e.deltaY / 240));
          const h = Math.max(-1, Math.min(1, -e.deltaX / 240));
          if (v === 0 && h === 0) return;
          sendMirrorCtrl({ type: "scroll", x: pt.x, y: pt.y, hScroll: h, vScroll: v });
        }, { passive: false });

        // 触控板/双指捏合（ctrl+wheel 作备选；pointer 双指）
        let pinchActive = null;
        wrap?.addEventListener("touchstart", (e) => {
          if (!mirrorLive() || !adbMirrorMeta?.control) return;
          if (e.touches.length !== 2) return;
          const surface = adbPreviewSurface();
          if (!surfaceReady(surface)) return;
          e.preventDefault();
          const a = adbCanvasCoords(surface, e.touches[0].clientX, e.touches[0].clientY);
          const b = adbCanvasCoords(surface, e.touches[1].clientX, e.touches[1].clientY);
          pinchActive = { a, b };
          sendMirrorCtrl({ type: "pinch", phase: "DOWN", x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        }, { passive: false });
        wrap?.addEventListener("touchmove", (e) => {
          if (!pinchActive || e.touches.length !== 2) return;
          const surface = adbPreviewSurface();
          if (!surfaceReady(surface)) return;
          e.preventDefault();
          const a = adbCanvasCoords(surface, e.touches[0].clientX, e.touches[0].clientY);
          const b = adbCanvasCoords(surface, e.touches[1].clientX, e.touches[1].clientY);
          sendMirrorCtrl({ type: "pinch", phase: "MOVE", x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        }, { passive: false });
        const endPinch = (e) => {
          if (!pinchActive) return;
          const surface = adbPreviewSurface();
          const a = pinchActive.a;
          const b = pinchActive.b;
          pinchActive = null;
          if (surfaceReady(surface)) {
            sendMirrorCtrl({ type: "pinch", phase: "UP", x1: a.x, y1: a.y, x2: b.x, y2: b.y });
          }
        };
        wrap?.addEventListener("touchend", endPinch);
        wrap?.addEventListener("touchcancel", endPinch);

        wrap?.addEventListener("pointerdown", (e) => {
        if (e.target?.closest?.(".adb-input-drop-hint")) return;
        const surface = adbPreviewSurface();
        if (!surfaceReady(surface)) return;
        surface.setPointerCapture?.(e.pointerId);
        const pt = adbCanvasCoords(surface, e.clientX, e.clientY);
        const now = Date.now();
        let asDouble = false;
        if (
        pendingTap &&
        now - pendingTap.at < DOUBLE_MS &&
        Math.abs(pt.x - pendingTap.x) + Math.abs(pt.y - pendingTap.y) <= 36
        ) {
        clearPendingTap();
        asDouble = true;
        }
        drag = {
        ...pt,
        moved: false,
        pointerId: e.pointerId,
        at: now,
        asDouble,
        fired: "",
        lastX: pt.x,
        lastY: pt.y,
        lastMoveAt: 0,
        streamTouch: false,
        };
        clearLongTimer();
        if (!asDouble && mirrorLive()) {
          drag.streamTouch = true;
          sendMirrorTouch("DOWN", pt.x, pt.y).catch(() => {});
        }
        if (!asDouble && !drag.streamTouch) {
        longTimer = setTimeout(async () => {
        longTimer = 0;
        if (!drag || drag.moved || drag.fired || drag.asDouble) return;
        drag.fired = "longpress";
        try {
        await sendInput({
        action: "longpress",
        x: drag.x,
        y: drag.y,
        duration: 1000,
        });
        if ($("#adb-tap-x")) $("#adb-tap-x").value = String(drag.x);
        if ($("#adb-tap-y")) $("#adb-tap-y").value = String(drag.y);
        toast(`已长按 ${drag.x},${drag.y}`);
        if ($("#adb-input-meta")) {
        $("#adb-input-meta").textContent = `长按 ${drag.x},${drag.y} · 单指手势：单击 / 长按 / 双击 / 拖拽`;
        }
        afterInputPreviewAction();
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        }, LONG_MS);
        }
        e.preventDefault();
        });
        wrap?.addEventListener("pointermove", (e) => {
        if (!drag || drag.pointerId !== e.pointerId) return;
        const surface = adbPreviewSurface();
        if (!surfaceReady(surface)) return;
        const pt = adbCanvasCoords(surface, e.clientX, e.clientY);
        if (Math.abs(pt.x - drag.x) + Math.abs(pt.y - drag.y) > MOVE_THRESH) {
        drag.moved = true;
        clearLongTimer();
        }
        if (drag.streamTouch && drag.moved) {
          const now = Date.now();
          if (now - drag.lastMoveAt >= MIRROR_MOVE_MS) {
            const fromX = drag.lastX;
            const fromY = drag.lastY;
            drag.lastX = pt.x;
            drag.lastY = pt.y;
            drag.lastMoveAt = now;
            sendMirrorTouch("MOVE", pt.x, pt.y, fromX, fromY);
          }
        }
        });
        wrap?.addEventListener("pointerup", async (e) => {
        if (!drag || drag.pointerId !== e.pointerId) return;
        const start = drag;
        drag = null;
        clearLongTimer();
        if (start.fired === "longpress") return;
        const surface = adbPreviewSurface();
        if (!surfaceReady(surface)) return;
        try {
        const end = adbCanvasCoords(surface, e.clientX, e.clientY);
        if (start.streamTouch) {
          clearPendingTap();
          if (start.moved) {
            await sendMirrorTouch("UP", end.x, end.y, start.lastX, start.lastY);
          } else if (start.asDouble) {
            await sendInput({ action: "doubletap", x: start.x, y: start.y });
            toast(`已双击 ${start.x},${start.y}`);
          } else {
            await sendMirrorTouch("UP", start.x, start.y, start.x, start.y);
            toast(`已点击 ${start.x},${start.y}`);
          }
          if ($("#adb-tap-x")) $("#adb-tap-x").value = String(end.x);
          if ($("#adb-tap-y")) $("#adb-tap-y").value = String(end.y);
          return;
        }
        if (start.moved) {
        clearPendingTap();
        await sendInput({
        action: "swipe",
        x1: start.x,
        y1: start.y,
        x2: end.x,
        y2: end.y,
        duration: Math.min(180, Number($("#adb-swipe-ms")?.value || 120)),
        });
        toast("已滑动");
        afterInputPreviewAction();
        return;
        }
        if (start.asDouble) {
        await sendInput({ action: "doubletap", x: start.x, y: start.y });
        if ($("#adb-tap-x")) $("#adb-tap-x").value = String(start.x);
        if ($("#adb-tap-y")) $("#adb-tap-y").value = String(start.y);
        toast(`已双击 ${start.x},${start.y}`);
        afterInputPreviewAction();
        return;
        }
        clearPendingTap();
        pendingTap = {
        x: start.x,
        y: start.y,
        at: Date.now(),
        timer: setTimeout(async () => {
        pendingTap = null;
        try {
        await sendInput({ action: "tap", x: start.x, y: start.y });
        if ($("#adb-tap-x")) $("#adb-tap-x").value = String(start.x);
        if ($("#adb-tap-y")) $("#adb-tap-y").value = String(start.y);
        toast(`已点击 ${start.x},${start.y}`);
        afterInputPreviewAction();
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        }, DOUBLE_MS),
        };
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
        wrap?.addEventListener("pointercancel", () => {
        if (drag?.streamTouch) {
          sendMirrorTouch("UP", drag.lastX, drag.lastY, drag.lastX, drag.lastY).catch(() => {});
        }
        clearLongTimer();
        drag = null;
        });
  
        const dropHint = $("#adb-input-drop-hint");
        let inputDropDepth = 0;
        const hasFiles = (dt) => dt && [...(dt.types || [])].includes("Files");
        const resetInputDropUi = () => {
        inputDropDepth = 0;
        setInputDropHintVisible(false);
        };
        wrap?.addEventListener("dragenter", (e) => {
        if (!hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        inputDropDepth += 1;
        setInputDropHintVisible(true);
        });
        wrap?.addEventListener("dragover", (e) => {
        if (!hasFiles(e.dataTransfer)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setInputDropHintVisible(true);
        });
        wrap?.addEventListener("dragleave", (e) => {
        if (!hasFiles(e.dataTransfer)) return;
        inputDropDepth = Math.max(0, inputDropDepth - 1);
        if (inputDropDepth > 0) return;
        resetInputDropUi();
        });
        wrap?.addEventListener("drop", (e) => {
        e.preventDefault();
        resetInputDropUi();
        const files = e.dataTransfer?.files;
        pushFilesToDeviceDownload(files).catch((err) => setError(adbError, err.message || String(err)));
        });
        document.addEventListener("dragend", resetInputDropUi);
        }
        updateRecordTip();
  
        $("#adb-clip-run")?.addEventListener("click", async () => {
        try {
        const text = $("#adb-clip-text")?.value || "";
        if (sendMirrorCtrl({ type: "clipboard", text, paste: false })) {
          toast("已经 scrcpy 推送剪贴板");
          return;
        }
        const data = await adbFetch("/clipboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
        serial: requireCurrentSerial(),
        text,
        }),
        });
        toast(data.note || "已推送剪贴板");
        } catch (err) {
        setError(adbError, err.message || String(err));
        }
        });
  
        const ua = navigator.userAgent || "";
        if (/Windows/i.test(ua)) {
        $("#adb-dl-win")?.classList.add("primary-btn");
        $("#adb-dl-win")?.classList.remove("secondary-btn");
        } else if (/Mac OS|Macintosh/i.test(ua)) {
        $("#adb-dl-mac")?.classList.add("primary-btn");
        $("#adb-dl-mac")?.classList.remove("secondary-btn");
        } else {
        $("#adb-dl-linux")?.classList.add("primary-btn");
        $("#adb-dl-linux")?.classList.remove("secondary-btn");
        }
  
        connectAdbBridge({ fromPoll: true }).catch(() => {});
  
      });
    } catch (err) {
      console.error("adb tool init failed", err);
    }
})();
