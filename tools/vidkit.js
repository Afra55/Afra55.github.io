(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  if (!$("#vidkit")) return;

  const DEFAULT_BASE = "http://127.0.0.1:17888";
  const DEFAULT_TOKEN = "devtools-bridge";
  const WASM_SOFT_LIMIT = 120 * 1024 * 1024;
  const WASM_HARD_LIMIT = 280 * 1024 * 1024;

  const COMPRESS = {
    quality: {
      label: "画质优先",
      crf: 20,
      x264Preset: "medium",
      bridgePreset: "compress-low",
      audioBitrate: "160k",
      needBridge: false,
    },
    balanced: {
      label: "均衡",
      crf: 23,
      x264Preset: "veryfast",
      bridgePreset: "compress-medium",
      audioBitrate: "128k",
      needBridge: false,
    },
    small: {
      label: "强压体积",
      crf: 28,
      x264Preset: "veryfast",
      bridgePreset: "compress-high",
      audioBitrate: "96k",
      needBridge: false,
    },
    extreme: {
      label: "极致保画质",
      crf: 18,
      x264Preset: "slow",
      bridgePreset: "keep-quality",
      audioBitrate: "192k",
      needBridge: true,
    },
    "extreme-hevc": {
      label: "极致·H.265",
      crf: 22,
      x264Preset: "medium",
      bridgePreset: "keep-quality-hevc",
      audioBitrate: "160k",
      needBridge: true,
      hevc: true,
    },
  };

  const FORMAT_BRIDGE = {
    mp4: "mp4-hq",
    webm: "webm",
    mkv: "mkv",
    mov: "mov",
    copy: "mp4-copy",
  };

  const state = {
    items: [],
    selected: "",
    tab: "convert",
    compressPreset: "quality",
    bridge: { ok: false, base: "", prefix: "/ff", token: DEFAULT_TOKEN, version: "" },
    previewUrl: "",
    abort: false,
    busy: false,
  };

  const els = {
    error: $("#vidkit-error"),
    list: $("#vidkit-list"),
    meta: $("#vidkit-meta"),
    file: $("#vidkit-file"),
    preview: $("#vidkit-preview"),
    previewMeta: $("#vidkit-preview-meta"),
    bridgeDot: $("#vidkit-bridge-dot"),
    bridgeTitle: $("#vidkit-bridge-title"),
    bridgeText: $("#vidkit-bridge-text"),
    progress: $("#vidkit-progress"),
    progressFill: $("#vidkit-progress-fill"),
    progressText: $("#vidkit-progress-text"),
    cancel: $("#vidkit-cancel"),
    preferBridge: $("#vidkit-prefer-bridge"),
    format: $("#vidkit-format"),
    scale: $("#vidkit-scale"),
    compressHint: $("#vidkit-compress-hint"),
    actionHint: $("#vidkit-action-hint"),
  };

  function toast(msg) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.classList.add("is-show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      el.classList.remove("is-show");
      setTimeout(() => {
        el.hidden = true;
      }, 200);
    }, 1800);
  }

  function setError(msg) {
    if (!els.error) return;
    if (!msg) {
      els.error.hidden = true;
      els.error.textContent = "";
      return;
    }
    els.error.hidden = false;
    els.error.textContent = msg;
  }

  function formatBytes(n) {
    const num = Number(n) || 0;
    if (num < 1024) return `${num} B`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
    return `${(num / (1024 * 1024)).toFixed(2)} MB`;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function selectedItem() {
    return state.items.find((it) => it.id === state.selected) || state.items[0] || null;
  }

  function setProgress(show, ratio, text) {
    if (!els.progress) return;
    els.progress.hidden = !show;
    if (els.cancel) els.cancel.hidden = !show;
    if (els.progressFill) {
      els.progressFill.style.width = `${Math.round(Math.min(1, Math.max(0, Number(ratio) || 0)) * 100)}%`;
    }
    if (els.progressText) els.progressText.textContent = text || "处理中…";
  }

  function paintBridge() {
    const ok = state.bridge.ok;
    if (els.bridgeDot) {
      els.bridgeDot.classList.toggle("is-ok", ok);
      els.bridgeDot.classList.toggle("is-err", !ok);
    }
    if (els.bridgeTitle) {
      els.bridgeTitle.textContent = ok ? `本机桥已连接 · v${state.bridge.version || "?"}` : "未连接本机桥";
    }
    if (els.bridgeText) {
      els.bridgeText.textContent = ok
        ? "极致保画质 / H.265 / 大文件将走系统 FFmpeg（仅 127.0.0.1）。"
        : "网页 FFmpeg 可做格式转换与常规压缩；极致档与大文件请启动本机桥。";
    }
  }

  function storedBridgeBase() {
    try {
      return (localStorage.getItem("devtools-ffmpeg-base") || DEFAULT_BASE).replace(/\/$/, "");
    } catch {
      return DEFAULT_BASE;
    }
  }

  function storedBridgeToken() {
    try {
      return (
        localStorage.getItem("devtools-ffmpeg-token") ||
        localStorage.getItem("devtools-bridge-token") ||
        DEFAULT_TOKEN
      );
    } catch {
      return DEFAULT_TOKEN;
    }
  }

  function prefixFromHealth(health) {
    if (!health) return "/ff";
    if (health.service === "devtools-ffmpeg-bridge") return "";
    if (
      health.unified ||
      health.service === "devtools-bridge" ||
      health.ffmpegMount === "/ff" ||
      health.capabilities?.ffmpeg ||
      health.embedded
    ) {
      return "/ff";
    }
    if (health.service === "devtools-bridge-ffmpeg") return "/ff";
    return "/ff";
  }

  async function probeBridge() {
    const token = storedBridgeToken();
    state.bridge.token = token;
    let base = storedBridgeBase();
    let prefix = "/ff";
    let rootHealth = null;
    try {
      const discovered = await window.devtoolsBridgeToken?.discoverBase?.(base, token);
      if (discovered?.base) base = String(discovered.base).replace(/\/$/, "");
      rootHealth = discovered?.health || null;
      prefix = prefixFromHealth(rootHealth);
    } catch {
      /* ignore */
    }

    const candidates = [
      { base, prefix },
      { base: "http://127.0.0.1:17888", prefix: "/ff" },
      { base: "http://127.0.0.1:17889", prefix: "" },
    ];
    const seen = new Set();

    for (const c of candidates) {
      const key = `${c.base}|${c.prefix}`;
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const res = await fetch(`${c.base}${c.prefix}/health`, {
          headers: { "X-Ffmpeg-Token": token, "X-Adb-Token": token },
          cache: "no-store",
          mode: "cors",
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (!data?.ok) continue;
        // 统一桥根 health 无 ffmpeg 字段时仍可用 /ff/health
        const ffOk = data.ffmpeg?.ok !== false || data.features || data.service;
        if (!ffOk) continue;
        state.bridge = {
          ok: true,
          base: c.base,
          prefix: c.prefix,
          token,
          version: data.version || rootHealth?.version || "",
        };
        paintBridge();
        return true;
      } catch {
        /* try next */
      }
    }
    // 未连上时按开关尝试协议唤起（与 ADB 页共用安装目录记忆）
    if (window.devtoolsBridgeToken?.readAutoStart?.() !== false) {
      try {
        const found = await window.devtoolsBridgeToken.ensureBridgeRunning?.({
          preferredBase: storedBridgeBase(),
          token,
          timeoutMs: 10000,
          launch: true,
        });
        if (found?.health) {
          const c = { base: found.base, prefix: prefixFromHealth(found.health) };
          state.bridge = {
            ok: true,
            base: c.base,
            prefix: c.prefix,
            token,
            version: found.health.version || "",
          };
          paintBridge();
          return true;
        }
      } catch (_) {
        /* ignore */
      }
    }
    state.bridge.ok = false;
    paintBridge();
    return false;
  }

  async function bridgeFetch(pathname, opts = {}) {
    if (!state.bridge.ok) throw new Error("本机桥未连接");
    const headers = Object.assign({}, opts.headers || {});
    headers["X-Ffmpeg-Token"] = state.bridge.token;
    headers["X-Adb-Token"] = state.bridge.token;
    const res = await fetch(`${state.bridge.base}${state.bridge.prefix}${pathname}`, {
      ...opts,
      headers,
    });
    if (!res.ok) {
      let msg = `桥请求失败 HTTP ${res.status}`;
      try {
        const j = await res.json();
        if (j?.error) msg = j.error;
      } catch {
        /* ignore */
      }
      throw new Error(msg);
    }
    return res;
  }

  function renderList() {
    if (!els.list) return;
    if (!state.items.length) {
      els.list.innerHTML = `<div class="vidkit-empty">尚未添加视频</div>`;
      return;
    }
    els.list.innerHTML = state.items
      .map((it) => {
        const active = it.id === state.selected ? " is-active" : "";
        return `<button type="button" class="vidkit-item${active}" data-vid-id="${it.id}">
          <span class="vidkit-item-name">${escapeHtml(it.name)}</span>
          <span class="vidkit-item-meta">${formatBytes(it.file.size)}</span>
        </button>`;
      })
      .join("");
  }

  function refreshPreview() {
    const item = selectedItem();
    if (state.previewUrl) {
      URL.revokeObjectURL(state.previewUrl);
      state.previewUrl = "";
    }
    if (!item) {
      if (els.preview) {
        els.preview.removeAttribute("src");
        els.preview.hidden = true;
      }
      if (els.previewMeta) els.previewMeta.textContent = "添加后可预览";
      return;
    }
    state.previewUrl = URL.createObjectURL(item.file);
    if (els.preview) {
      els.preview.src = state.previewUrl;
      els.preview.hidden = false;
    }
    if (els.previewMeta) els.previewMeta.textContent = `${item.name} · ${formatBytes(item.file.size)}`;
  }

  function addFiles(fileList) {
    const files = [...fileList].filter(
      (f) => /video\//.test(f.type) || /\.(mp4|mov|mkv|webm|m4v|avi)$/i.test(f.name)
    );
    if (!files.length) {
      toast("请选择视频文件");
      return;
    }
    for (const file of files) {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      state.items.push({ id, file, name: file.name });
      state.selected = id;
    }
    renderList();
    refreshPreview();
    if (els.meta) els.meta.textContent = `已添加 ${state.items.length} 个 · 本地处理`;
    toast(`已添加 ${files.length} 个视频`);
  }

  function switchTab(tab) {
    state.tab = tab === "compress" ? "compress" : "convert";
    $$(".vidkit-tab").forEach((btn) => {
      const on = btn.dataset.vidkitTab === state.tab;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    $$("[data-vidkit-panel]").forEach((panel) => {
      const on = panel.dataset.vidkitPanel === state.tab;
      panel.classList.toggle("is-active", on);
      panel.hidden = !on;
    });
    updateHints();
  }

  function setCompressPreset(key) {
    if (!COMPRESS[key]) return;
    state.compressPreset = key;
    $$("[data-vidkit-preset]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.vidkitPreset === key);
    });
    updateHints();
  }

  function updateHints() {
    const p = COMPRESS[state.compressPreset];
    if (els.compressHint && p) {
      els.compressHint.textContent = p.needBridge
        ? `${p.label}：需本机桥（${p.bridgePreset}）。未连桥时会提示连接。`
        : `${p.label}：网页 CRF ${p.crf}；有桥且勾选优先本机时走 ${p.bridgePreset}。`;
    }
    if (els.actionHint) {
      els.actionHint.textContent =
        state.tab === "convert"
          ? "转换封装/编码。流拷贝最快；不兼容时自动重编码。"
          : "高观感压缩：优先观感，再尽量缩小体积（有损）。";
    }
  }

  function shouldUseBridge(item, profile) {
    if (!state.bridge.ok) return false;
    if (profile?.needBridge) return true;
    if (els.preferBridge && !els.preferBridge.checked) return false;
    if (item?.file?.size > WASM_SOFT_LIMIT) return true;
    return Boolean(els.preferBridge?.checked);
  }

  function scaleFilter(height) {
    const h = Number(height) || 0;
    if (h <= 0) return "";
    return `scale=-2:min(ih\\,${h})`;
  }

  async function encodeViaWasm(item, { mode, format, compressKey, scaleHeight, onProgress }) {
    const eng = window.DevToolsFfmpeg;
    if (!eng?.getInstance) throw new Error("网页 FFmpeg 未加载，请稍后重试或硬刷新");
    if (item.file.size > WASM_HARD_LIMIT) {
      throw new Error(`文件过大（${formatBytes(item.file.size)}），请连接本机桥处理`);
    }
    onProgress?.(0.05, "加载网页编码器…");
    await eng.prewarm?.().catch(() => {});
    const ffmpeg = await eng.getInstance((r, t) => onProgress?.(0.05 + r * 0.2, t || "加载编码器…"));
    const inName = await eng.ensureInputWritten(ffmpeg, item.file, (r, t) =>
      onProgress?.(0.25 + r * 0.15, t || "写入输入…")
    );
    const profile = COMPRESS[compressKey] || COMPRESS.balanced;
    const vf = scaleFilter(scaleHeight);
    let outExt = "mp4";
    let mime = "video/mp4";
    const attempts = [];

    if (mode === "convert") {
      if (format === "copy") {
        attempts.push(["-i", inName, "-c", "copy", "-movflags", "+faststart", "-y", "out.mp4"]);
        const fb = ["-i", inName];
        if (vf) fb.push("-vf", vf);
        fb.push(
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          "-y",
          "out.mp4"
        );
        attempts.push(fb);
      } else if (format === "webm") {
        outExt = "webm";
        mime = "video/webm";
        const args = ["-i", inName];
        if (vf) args.push("-vf", vf);
        args.push(
          "-c:v",
          "libvpx-vp9",
          "-b:v",
          "0",
          "-crf",
          "32",
          "-c:a",
          "libopus",
          "-b:a",
          "128k",
          "-y",
          "out.webm"
        );
        attempts.push(args);
      } else {
        outExt = format === "mov" ? "mov" : format === "mkv" ? "mkv" : "mp4";
        const args = ["-i", inName];
        if (vf) args.push("-vf", vf);
        args.push(
          "-c:v",
          "libx264",
          "-preset",
          "veryfast",
          "-crf",
          "23",
          "-c:a",
          "aac",
          "-b:a",
          "128k",
          "-movflags",
          "+faststart",
          "-y",
          `out.${outExt}`
        );
        attempts.push(args);
      }
    } else {
      if (profile.needBridge) throw new Error("该档位需要本机桥");
      if (profile.hevc) throw new Error("网页不支持 H.265，请连接本机桥");
      const args = ["-i", inName];
      if (vf) args.push("-vf", vf);
      args.push(
        "-c:v",
        "libx264",
        "-preset",
        profile.x264Preset,
        "-crf",
        String(profile.crf),
        "-c:a",
        "aac",
        "-b:a",
        profile.audioBitrate,
        "-movflags",
        "+faststart",
        "-y",
        "out.mp4"
      );
      attempts.push(args);
    }

    const outName = `out.${outExt}`;
    onProgress?.(0.45, "编码中…");
    let blob = null;
    for (const args of attempts) {
      if (state.abort) throw new Error("已取消");
      try {
        await ffmpeg.deleteFile(outName);
      } catch {
        /* ignore */
      }
      try {
        const code = await ffmpeg.exec(args);
        if (code !== 0) continue;
        const data = await ffmpeg.readFile(outName);
        const raw = data instanceof Uint8Array ? data : new Uint8Array(data);
        if (raw.byteLength > 64) {
          const bytes = new Uint8Array(raw.byteLength);
          bytes.set(raw);
          blob = new Blob([bytes], { type: mime });
          break;
        }
      } catch (err) {
        if (String(err?.message) === "已取消") throw err;
      }
    }
    try {
      await ffmpeg.deleteFile(outName);
    } catch {
      /* ignore */
    }
    if (!blob) throw new Error("编码失败，可换 MP4 或连接本机桥重试");
    onProgress?.(1, "完成");
    return { blob, ext: outExt };
  }

  async function encodeViaBridge(item, { mode, format, compressKey, scaleHeight, onProgress }) {
    const profile = COMPRESS[compressKey] || COMPRESS.balanced;
    const preset = mode === "convert" ? FORMAT_BRIDGE[format] || "mp4-hq" : profile.bridgePreset;

    onProgress?.(0.08, "上传到本机桥…");
    const q = new URLSearchParams({
      op: "convert",
      preset,
      filename: item.name,
    });
    if (scaleHeight > 0) q.set("scaleHeight", String(scaleHeight));

    const startRes = await bridgeFetch(`/jobs/browser-run?${q}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Filename": item.name,
      },
      body: item.file,
    });
    const started = await startRes.json();
    const jobId = started?.job?.id;
    if (!jobId) throw new Error("本机桥未返回任务 ID");

    onProgress?.(0.2, "本机编码中…");
    for (;;) {
      if (state.abort) {
        try {
          await bridgeFetch(`/jobs/${jobId}/cancel`, { method: "POST", body: "{}" });
        } catch {
          /* ignore */
        }
        throw new Error("已取消");
      }
      await new Promise((r) => setTimeout(r, 700));
      const stRes = await bridgeFetch(`/jobs/${jobId}`);
      const st = await stRes.json();
      const job = st.job;
      onProgress?.(0.2 + (Number(job?.progress) || 0) * 0.7, job?.message || "本机编码中…");
      if (job?.status === "done" || job?.status === "success") break;
      if (job?.status === "error" || job?.status === "failed") {
        throw new Error(job?.error || job?.message || "本机桥编码失败");
      }
      if (job?.status === "cancelled") throw new Error("已取消");
    }

    onProgress?.(0.92, "下载结果…");
    const dl = await bridgeFetch(`/jobs/${jobId}/download`);
    const buf = await dl.arrayBuffer();
    const cd = dl.headers.get("Content-Disposition") || "";
    const m = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(cd);
    const filename = decodeURIComponent(m?.[1] || m?.[2] || `out-${Date.now()}.mp4`);
    const ext = (filename.split(".").pop() || "mp4").toLowerCase();
    const mime =
      ext === "webm"
        ? "video/webm"
        : ext === "mkv"
          ? "video/x-matroska"
          : ext === "mov"
            ? "video/quicktime"
            : "video/mp4";
    onProgress?.(1, "完成");
    return { blob: new Blob([buf], { type: mime }), ext, filename };
  }

  async function processOne(item) {
    const mode = state.tab;
    const format = els.format?.value || "mp4";
    const compressKey = state.compressPreset;
    const scaleHeight = Number(els.scale?.value || 0) || 0;
    const profile = COMPRESS[compressKey];

    if (mode === "compress" && profile?.needBridge && !state.bridge.ok) {
      throw new Error("「极致」档需要本机桥：请打开「本机桥」面板启动后点重新连接（#ffbridge）");
    }

    const useBridge = shouldUseBridge(item, mode === "compress" ? profile : null);
    const onProgress = (r, t) => setProgress(true, r, t);

    if (useBridge) {
      try {
        return await encodeViaBridge(item, { mode, format, compressKey, scaleHeight, onProgress });
      } catch (err) {
        if (profile?.needBridge) throw err;
        console.warn("[vidkit] 本机桥失败，回退网页编码", err);
        onProgress(0.05, "桥失败，改用网页编码…");
      }
    }
    return encodeViaWasm(item, { mode, format, compressKey, scaleHeight, onProgress });
  }

  async function runSelected() {
    const item = selectedItem();
    if (!item) throw new Error("请先添加视频");
    if (state.busy) return;
    state.busy = true;
    state.abort = false;
    setError("");
    try {
      const result = await processOne(item);
      const base = item.name.replace(/\.[^.]+$/, "") || "video";
      downloadBlob(result.blob, result.filename || `${base}-vidkit.${result.ext}`);
      toast(`已导出 ${formatBytes(result.blob.size)}`);
      if (els.meta) els.meta.textContent = `完成 · ${formatBytes(result.blob.size)}`;
    } finally {
      state.busy = false;
      setProgress(false, 0, "");
    }
  }

  async function runAll() {
    if (!state.items.length) throw new Error("请先添加视频");
    if (state.busy) return;
    state.busy = true;
    state.abort = false;
    setError("");
    let ok = 0;
    try {
      for (let i = 0; i < state.items.length; i++) {
        if (state.abort) throw new Error("已取消");
        const item = state.items[i];
        state.selected = item.id;
        renderList();
        refreshPreview();
        setProgress(true, i / state.items.length, `批量 ${i + 1}/${state.items.length}：${item.name}`);
        const result = await processOne(item);
        const base = item.name.replace(/\.[^.]+$/, "") || `video-${i + 1}`;
        downloadBlob(result.blob, result.filename || `${base}-vidkit.${result.ext}`);
        ok += 1;
      }
      toast(`批量完成 ${ok}/${state.items.length}`);
    } finally {
      state.busy = false;
      setProgress(false, 0, "");
    }
  }

  $("#vidkit-file")?.addEventListener("change", (e) => {
    addFiles(e.target.files || []);
    e.target.value = "";
  });
  $("#vidkit-clear")?.addEventListener("click", () => {
    state.items = [];
    state.selected = "";
    renderList();
    refreshPreview();
    setError("");
    if (els.meta) els.meta.textContent = "支持拖拽多段视频。本地处理。";
  });
  els.list?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-vid-id]");
    if (!btn) return;
    state.selected = btn.dataset.vidId;
    renderList();
    refreshPreview();
  });
  $$(".vidkit-tab").forEach((btn) => btn.addEventListener("click", () => switchTab(btn.dataset.vidkitTab)));
  $$("[data-vidkit-preset]").forEach((btn) =>
    btn.addEventListener("click", () => setCompressPreset(btn.dataset.vidkitPreset))
  );
  $("#vidkit-run")?.addEventListener("click", () => {
    runSelected().catch((err) => setError(err.message || String(err)));
  });
  $("#vidkit-run-all")?.addEventListener("click", () => {
    runAll().catch((err) => setError(err.message || String(err)));
  });
  $("#vidkit-cancel")?.addEventListener("click", () => {
    state.abort = true;
    toast("正在取消…");
  });
  $("#vidkit-bridge-reconnect")?.addEventListener("click", () => {
    probeBridge().then((ok) => toast(ok ? "本机桥已连接" : "仍未连上本机桥"));
  });

  const drop = $("#vidkit-drop");
  if (drop) {
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("is-dragover");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("is-dragover"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("is-dragover");
      addFiles(e.dataTransfer?.files || []);
    });
  }

  renderList();
  refreshPreview();
  switchTab("convert");
  setCompressPreset("quality");
  paintBridge();
  probeBridge();
  window.DevToolsFfmpeg?.prewarm?.().catch(() => {});
})();
