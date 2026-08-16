(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const BASE_KEY = "devtools-ffmpeg-base";
  const TOKEN_KEY = "devtools-ffmpeg-token";
  const DEFAULT_BASE = "http://127.0.0.1:17889";
  const DEFAULT_TOKEN = "devtools-ffmpeg";

  const panel = $("#ffbridge");
  if (!panel) return;

  const baseInput = $("#ff-base");
  const tokenInput = $("#ff-token");
  const statusTitle = $("#ff-status-title");
  const statusText = $("#ff-status-text");
  const dot = $("#ff-dot");
  const connectBtn = $("#ff-connect");
  const refreshBtn = $("#ff-refresh");
  const workspace = $("#ff-workspace");
  const toolsProbe = $("#ff-tools-probe");
  const rootsEl = $("#ff-roots");
  const pathInput = $("#ff-fs-path");
  const listEl = $("#ff-fs-list");
  const fsMeta = $("#ff-fs-meta");
  const selMeta = $("#ff-sel-meta");
  const outdirInput = $("#ff-outdir");
  const jobsList = $("#ff-jobs-list");
  const errorEl = $("#ff-error");
  const modeBanner = $("#ff-mode-banner");
  const modeTitle = $("#ff-mode-title");
  const modeText = $("#ff-mode-text");
  const modeActions = $("#ff-mode-actions");
  const bridgePanel = $("#ff-bridge-panel");
  const headDesc = $("#ff-head-desc");

  let connected = false;
  let cwd = "";
  let entries = [];
  /** @type {Set<string>} */
  const selected = new Set();
  let taskType = "extract-audio";
  let audioFmt = "mp3";
  let convertPreset = "mp4-fast";
  let pollTimer = 0;
  let waitPollTimer = 0;

  /** 手机/平板通常无法跑本机 Node 桥；电脑才是桥的更优场景 */
  function isLikelyBridgeHost() {
    const ua = navigator.userAgent || "";
    if (/Android|iPhone|iPod|Mobile/i.test(ua)) return false;
    // iPadOS 13+ 可能伪装成 Mac，再用触控+窄屏辅助判断
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const narrow = window.matchMedia("(max-width: 900px)").matches;
    if (/iPad|tablet/i.test(ua) || (coarse && narrow && !/Windows|Macintosh|Linux/i.test(ua))) return false;
    if (/Macintosh/i.test(ua) && coarse && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1) {
      return false; // iPad 桌面模式
    }
    return true;
  }

  function webFallbackLinksHtml() {
    return `
      <a class="primary-btn" href="#media/audio">网页·音频处理</a>
      <a class="secondary-btn" href="#media/vtrim">网页·视频修剪</a>
      <a class="ghost-btn" href="#setup">安装指南</a>
    `;
  }

  function paintAdaptTips() {
    const host = isLikelyBridgeHost();
    const audioTip = $("#audio-adapt-tip");
    const vtrimTip = $("#vtrim-adapt-tip");
    if (audioTip) {
      audioTip.textContent = host
        ? connected
          ? "本机桥已连接时，大量文件请到「FFmpeg 本机桥」批量处理。"
          : "当前为网页保底。电脑批量请连接本机桥。"
        : "当前为手机场景，使用网页内 FFmpeg。";
    }
    if (vtrimTip) {
      vtrimTip.textContent = host
        ? connected
          ? "批量导出请优先用本机桥。"
          : "未连桥时用本页保底；批量请连本机桥。"
        : "手机请用本页（网页 FFmpeg）。";
    }
  }

  function applyDeviceMode() {
    const host = isLikelyBridgeHost();
    panel?.classList.toggle("is-mobile-fallback", !host);
    panel?.classList.toggle("is-desktop-bridge", host);
    panel?.classList.toggle("is-bridge-connected", connected);

    if (headDesc) {
      headDesc.innerHTML = host
        ? `电脑更优：连本机桥用系统 FFmpeg 批量处理。没连上时，用网页 <a href="#media/audio">音频处理</a> / <a href="#media/vtrim">视频修剪</a> 保底。<a href="#setup">安装指南</a>`
        : `手机无法运行本机桥，请直接用网页内 FFmpeg：<a href="#media/audio">音频处理</a>、<a href="#media/vtrim">视频修剪</a>。电脑批量再回来用桥。`;
    }

    if (modeTitle && modeText && modeActions) {
      if (!host) {
        modeTitle.textContent = "手机场景：请用网页 FFmpeg";
        modeText.textContent =
          "本机桥需要电脑上的 Node.js + 系统 ffmpeg，手机浏览器跑不了。少量文件用下面入口即可（网页内编码器）。";
        modeActions.innerHTML = webFallbackLinksHtml();
        if (bridgePanel) bridgePanel.hidden = true;
        if (workspace) workspace.hidden = true;
      } else if (connected) {
        modeTitle.textContent = "已走更优路径：本机 FFmpeg 桥";
        modeText.textContent = "批量抽音频 / 转码请在下方选择文件。若只想随手剪一段，仍可用网页工具。";
        modeActions.innerHTML = `
          <a class="ghost-btn" href="#media/audio">网页保底·音频</a>
          <a class="ghost-btn" href="#media/vtrim">网页保底·修剪</a>
        `;
        if (bridgePanel) bridgePanel.hidden = false;
      } else {
        modeTitle.textContent = "电脑推荐：本机桥（未连接）";
        modeText.textContent =
          "批量、大文件优先下载并连接本机桥。若暂时没装或连不上，先用网页 FFmpeg 保底处理少量文件。";
        modeActions.innerHTML = `
          ${webFallbackLinksHtml()}
        `;
        if (bridgePanel) bridgePanel.hidden = false;
      }
    }
    if (modeBanner) modeBanner.hidden = false;
    paintAdaptTips();
  }

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
    }, 2200);
  }

  function setError(msg) {
    if (!errorEl) return;
    if (!msg) {
      errorEl.hidden = true;
      errorEl.textContent = "";
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent = msg;
  }

  function loadPrefs() {
    try {
      const b = localStorage.getItem(BASE_KEY);
      const t = localStorage.getItem(TOKEN_KEY);
      if (b && baseInput) baseInput.value = b;
      if (t && tokenInput) tokenInput.value = t;
    } catch (_) {}
  }

  function savePrefs() {
    try {
      localStorage.setItem(BASE_KEY, baseInput?.value?.trim() || DEFAULT_BASE);
      localStorage.setItem(TOKEN_KEY, tokenInput?.value?.trim() || DEFAULT_TOKEN);
    } catch (_) {}
  }

  function baseUrl() {
    return String(baseInput?.value || DEFAULT_BASE).replace(/\/$/, "");
  }

  function token() {
    return String(tokenInput?.value || DEFAULT_TOKEN).trim();
  }

  function setStatus(kind, title, text) {
    if (dot) {
      dot.classList.remove("is-ok", "is-err", "is-warn");
      if (kind) dot.classList.add(kind);
    }
    if (statusTitle) statusTitle.textContent = title;
    if (statusText) statusText.textContent = text;
  }

  async function ffFetch(pathname, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (opts.auth !== false) headers["X-Ffmpeg-Token"] = token();
    if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const res = await fetch(`${baseUrl()}${pathname}`, {
      method: opts.method || "GET",
      headers,
      body: opts.body ? (typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body)) : undefined,
    });
    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch (_) {
      data = null;
    }
    if (!res.ok || data?.ok === false) {
      const err = new Error(data?.error || text || `HTTP ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function formatSize(n) {
    const x = Number(n) || 0;
    if (x < 1024) return `${x} B`;
    if (x < 1024 * 1024) return `${(x / 1024).toFixed(1)} KB`;
    return `${(x / (1024 * 1024)).toFixed(2)} MB`;
  }

  function syncTaskUi() {
    $$("[data-ff-task]").forEach((b) => b.classList.toggle("is-active", b.dataset.ffTask === taskType));
    const audioSeg = $("#ff-audio-fmt-seg");
    const convSeg = $("#ff-convert-preset-seg");
    if (audioSeg) audioSeg.hidden = taskType !== "extract-audio";
    if (convSeg) convSeg.hidden = taskType !== "convert";
  }

  function syncSelMeta() {
    if (selMeta) selMeta.textContent = `已选 ${selected.size}`;
  }

  function renderRoots(roots) {
    if (!rootsEl) return;
    rootsEl.innerHTML = "";
    (roots || []).forEach((r) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "ghost-btn";
      btn.textContent = r.name || r.path;
      btn.title = r.path;
      btn.addEventListener("click", () => openPath(r.path));
      rootsEl.appendChild(btn);
    });
  }

  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = "";
    if (!entries.length) {
      listEl.innerHTML = `<p class="hint tight">空目录</p>`;
      return;
    }
    entries.forEach((ent) => {
      const row = document.createElement("div");
      row.className = "adb-fs-row";
      row.setAttribute("role", "listitem");
      const full = joinPath(cwd, ent.name);
      const checked = selected.has(full);
      const kind =
        ent.type === "dir" ? "📁" : ent.kind === "video" ? "🎬" : ent.kind === "audio" ? "🎵" : "📄";
      row.innerHTML = `
        <label class="ff-fs-check"><input type="checkbox" data-ff-path="${escapeAttr(full)}" ${checked ? "checked" : ""} /></label>
        <button type="button" class="ghost-btn ff-fs-name" data-ff-open="${escapeAttr(full)}" data-ff-type="${ent.type}">${kind} ${escapeHtml(ent.name)}</button>
        <span class="hint tight mono">${ent.type === "file" ? formatSize(ent.size) : ""}</span>
      `;
      listEl.appendChild(row);
    });
    listEl.querySelectorAll("input[data-ff-path]").forEach((input) => {
      input.addEventListener("change", () => {
        const p = input.getAttribute("data-ff-path");
        if (!p) return;
        if (input.checked) selected.add(p);
        else selected.delete(p);
        syncSelMeta();
      });
    });
    listEl.querySelectorAll("[data-ff-open]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = btn.getAttribute("data-ff-open");
        const type = btn.getAttribute("data-ff-type");
        if (!p) return;
        if (type === "dir") openPath(p);
        else {
          selected.add(p);
          syncSelMeta();
          toast("已加入选择");
        }
      });
    });
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function joinPath(dir, name) {
    if (!dir) return name;
    if (/^[A-Za-z]:\\/.test(dir) || dir.includes("\\")) {
      return dir.replace(/[\\/]+$/, "") + "\\" + name;
    }
    return dir.replace(/\/+$/, "") + "/" + name;
  }

  function parentPath(p) {
    if (!p) return p;
    if (/^[A-Za-z]:\\/.test(p) || p.includes("\\")) {
      const parts = p.replace(/[\\/]+$/, "").split(/[\\/]/);
      if (parts.length <= 1) return p;
      parts.pop();
      const out = parts.join("\\");
      return /^[A-Za-z]:$/.test(out) ? out + "\\" : out;
    }
    const cleaned = p.replace(/\/+$/, "");
    const idx = cleaned.lastIndexOf("/");
    if (idx <= 0) return "/";
    return cleaned.slice(0, idx) || "/";
  }

  async function openPath(p) {
    const data = await ffFetch(`/local/list?path=${encodeURIComponent(p)}`);
    cwd = data.path;
    entries = data.entries || [];
    if (pathInput) pathInput.value = cwd;
    if (fsMeta) fsMeta.textContent = `${entries.length} 项 · ${cwd}`;
    renderList();
  }

  function renderJobs(jobs) {
    if (!jobsList) return;
    if (!jobs?.length) {
      jobsList.innerHTML = `<p class="hint tight">暂无任务</p>`;
      return;
    }
    jobsList.innerHTML = jobs
      .map((job) => {
        const pct = Math.round((Number(job.progress) || 0) * 100);
        const canCancel = job.status === "queued" || job.status === "running";
        const out = job.meta?.outDir ? `<div class="hint tight mono">输出：${escapeHtml(job.meta.outDir)}</div>` : "";
        const arts = (job.artifacts || [])
          .slice(0, 5)
          .map((a) => escapeHtml(a.name))
          .join("、");
        return `<div class="adb-job">
          <div class="label-row">
            <strong class="mono">${escapeHtml(job.type)} · ${escapeHtml(job.id)}</strong>
            <span class="hint tight">${escapeHtml(job.status)} · ${pct}%</span>
          </div>
          <p class="hint tight">${escapeHtml(job.message || "")}</p>
          ${out}
          ${arts ? `<p class="hint tight">产物：${arts}${(job.artifacts || []).length > 5 ? "…" : ""}</p>` : ""}
          ${job.error ? `<p class="error">${escapeHtml(job.error)}</p>` : ""}
          ${canCancel ? `<button type="button" class="ghost-btn" data-ff-cancel="${escapeHtml(job.id)}">取消</button>` : ""}
        </div>`;
      })
      .join("");
    jobsList.querySelectorAll("[data-ff-cancel]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.getAttribute("data-ff-cancel");
        try {
          await ffFetch(`/jobs/${id}/cancel`, { method: "POST", body: {} });
          toast("已请求取消");
          refreshJobs().catch(() => {});
        } catch (err) {
          setError(err.message || String(err));
        }
      });
    });
  }

  async function refreshJobs() {
    const data = await ffFetch("/jobs");
    renderJobs(data.jobs || []);
  }

  function startJobPoll() {
    clearInterval(pollTimer);
    pollTimer = setInterval(() => {
      if (!connected) return;
      refreshJobs().catch(() => {});
    }, 1500);
  }

  async function connectBridge({ fromPoll = false } = {}) {
    savePrefs();
    setError("");
    try {
      const health = await ffFetch("/health", { auth: false });
      const ffOk = Boolean(health.ffmpeg?.ok);
      if (toolsProbe) {
        toolsProbe.hidden = false;
        toolsProbe.textContent = `桥 v${health.version || "?"} · ffmpeg ${
          ffOk ? health.ffmpeg.version || "ok" : "未找到"
        } · ffprobe ${health.ffprobe?.ok ? "ok" : "缺"}`;
      }
      if (!ffOk) {
        connected = false;
        if (workspace) workspace.hidden = true;
        if (refreshBtn) refreshBtn.disabled = true;
        setStatus("is-warn", "桥已启动但未找到 ffmpeg", health.setup?.ffmpeg || health.ffmpeg?.error || "请安装 ffmpeg");
        applyDeviceMode();
        return false;
      }
      connected = true;
      if (workspace) workspace.hidden = false;
      if (refreshBtn) refreshBtn.disabled = false;
      setStatus("is-ok", "已连接本机 FFmpeg 桥", `更优路径已就绪 · Token 已配置`);
      renderRoots(health.roots || []);
      const home = health.roots?.[0]?.path || "";
      if (home) await openPath(home);
      await refreshJobs();
      startJobPoll();
      applyDeviceMode();
      if (!fromPoll) toast("已连接 FFmpeg 桥");
      return true;
    } catch (err) {
      connected = false;
      if (workspace) workspace.hidden = true;
      if (refreshBtn) refreshBtn.disabled = true;
      setStatus(
        "is-err",
        "未连接本机桥",
        fromPoll
          ? "等待本机桥启动…未连接时可用网页音频/修剪保底"
          : err.message || "连接失败；可先用网页保底，或按指南安装后重试"
      );
      applyDeviceMode();
      return false;
    }
  }

  function startWaitPoll() {
    clearInterval(waitPollTimer);
    let n = 0;
    waitPollTimer = setInterval(async () => {
      n += 1;
      const ok = await connectBridge({ fromPoll: true });
      if (ok || n >= 60) clearInterval(waitPollTimer);
    }, 2000);
  }

  async function fetchTextAsset(path) {
    const res = await fetch(path, { cache: "no-cache" });
    if (!res.ok) throw new Error(`无法读取 ${path}（${res.status}）`);
    return res.text();
  }

  async function downloadBundle(platform) {
    if (typeof JSZip === "undefined") throw new Error("JSZip 未加载，无法打包下载");
    const map = {
      mac: {
        scriptPath: "./ffmpeg-bridge/start-mac.command",
        scriptName: "start-ffmpeg-bridge.command",
        zipName: "devtools-ffmpeg-bridge-mac.zip",
        runHint: "解压后执行：chmod +x start-ffmpeg-bridge.command && ./start-ffmpeg-bridge.command\n也可在 Finder 中双击。",
      },
      win: {
        scriptPath: "./ffmpeg-bridge/start-win.bat",
        scriptName: "start-ffmpeg-bridge.bat",
        zipName: "devtools-ffmpeg-bridge-win.zip",
        runHint: "解压后优先双击 start-ffmpeg-bridge.cmd；也可双击 .bat。请保持窗口打开。",
      },
      linux: {
        scriptPath: "./ffmpeg-bridge/start-linux.sh",
        scriptName: "start-ffmpeg-bridge.sh",
        zipName: "devtools-ffmpeg-bridge-linux.zip",
        runHint: "解压后执行：chmod +x start-ffmpeg-bridge.sh && ./start-ffmpeg-bridge.sh",
      },
    };
    const cfg = map[platform];
    if (!cfg) throw new Error("未知平台");
    const [serverJs, scriptRaw] = await Promise.all([
      fetchTextAsset("./ffmpeg-bridge/server.js"),
      fetchTextAsset(cfg.scriptPath),
    ]);
    const scriptText = platform === "win" ? String(scriptRaw).replace(/\r?\n/g, "\r\n") : scriptRaw;
    if (!/FFMPEG_BRIDGE_TOKEN|devtools-ffmpeg-bridge|DevTools FFmpeg bridge/.test(serverJs)) {
      throw new Error("server.js 内容异常，请刷新页面后重试");
    }
    const readme = [
      "DevTools FFmpeg Bridge 完整包",
      "",
      "必须保留：",
      "  - server.js",
      "  - " + cfg.scriptName,
      "",
      "使用步骤：",
      "1. 解压到同一文件夹",
      "2. 本机已安装 Node.js 与 ffmpeg",
      "3. " + cfg.runHint.replace(/\n/g, "\n   "),
      "4. 回到网页点「连接本机桥」",
      "",
      "默认地址 http://127.0.0.1:17889  Token: devtools-ffmpeg",
      "",
    ].join("\n");
    const zip = new JSZip();
    zip.file("server.js", serverJs);
    zip.file(cfg.scriptName, scriptText, {
      unixPermissions: platform === "win" ? undefined : 0o755,
    });
    if (platform === "win") {
      const wrapper = [
        "@echo off",
        'cd /d "%~dp0"',
        'cmd /d /c ""%~dp0start-ffmpeg-bridge.bat" & echo. & echo Log: %USERPROFILE%\\.devtools-ffmpeg-bridge\\last-start.log & pause"',
        "",
      ].join("\r\n");
      zip.file("start-ffmpeg-bridge.cmd", wrapper);
      // also include original start-win.cmd pattern name used by readme
    }
    zip.file(platform === "win" ? "README.txt" : "使用说明.txt", readme);
    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = cfg.zipName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    toast("已下载完整包，解压运行后点连接");
    startWaitPoll();
  }

  async function runTask() {
    setError("");
    if (!selected.size) {
      setError("请先勾选视频文件或文件夹");
      return;
    }
    const outDir = String(outdirInput?.value || "").trim();
    if (!outDir) {
      setError("请填写输出目录");
      return;
    }
    const body = {
      paths: [...selected],
      outDir,
      recursive: Boolean($("#ff-recursive")?.checked),
      createOutDir: Boolean($("#ff-mkdir")?.checked),
      overwrite: Boolean($("#ff-overwrite")?.checked),
    };
    let path = "/jobs/extract-audio";
    if (taskType === "extract-audio") {
      body.format = audioFmt;
      body.bitrate = "192k";
    } else {
      path = "/jobs/convert";
      body.preset = convertPreset;
    }
    try {
      const data = await ffFetch(path, { method: "POST", body });
      toast(`任务已排队 · ${data.job?.meta?.count || selected.size} 个输入`);
      await refreshJobs();
    } catch (err) {
      setError(err.message || String(err));
    }
  }

  // events
  loadPrefs();
  syncTaskUi();
  syncSelMeta();

  connectBtn?.addEventListener("click", () => connectBridge());
  refreshBtn?.addEventListener("click", async () => {
    try {
      await openPath(cwd || pathInput?.value || "");
      await refreshJobs();
    } catch (err) {
      setError(err.message || String(err));
    }
  });
  $("#ff-fs-go")?.addEventListener("click", () => {
    openPath(pathInput?.value || "").catch((err) => setError(err.message || String(err)));
  });
  $("#ff-fs-refresh")?.addEventListener("click", () => {
    openPath(cwd || pathInput?.value || "").catch((err) => setError(err.message || String(err)));
  });
  $("#ff-fs-up")?.addEventListener("click", () => {
    if (!cwd) return;
    openPath(parentPath(cwd)).catch((err) => setError(err.message || String(err)));
  });
  pathInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      openPath(pathInput.value).catch((err) => setError(err.message || String(err)));
    }
  });
  $("#ff-select-videos")?.addEventListener("click", () => {
    entries.forEach((ent) => {
      if (ent.type === "file" && ent.kind === "video") selected.add(joinPath(cwd, ent.name));
    });
    syncSelMeta();
    renderList();
  });
  $("#ff-clear-sel")?.addEventListener("click", () => {
    selected.clear();
    syncSelMeta();
    renderList();
  });
  $("#ff-outdir-here")?.addEventListener("click", () => {
    if (!cwd || !outdirInput) return;
    const sub = taskType === "convert" ? "convert_out" : "audio_out";
    outdirInput.value = joinPath(cwd, sub);
  });
  $("#ff-run")?.addEventListener("click", () => runTask());
  $("#ff-jobs-refresh")?.addEventListener("click", () => refreshJobs().catch((err) => setError(err.message || String(err))));

  $$("[data-ff-task]").forEach((btn) => {
    btn.addEventListener("click", () => {
      taskType = btn.dataset.ffTask === "convert" ? "convert" : "extract-audio";
      syncTaskUi();
    });
  });
  $$("[data-ff-audio-fmt]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const f = btn.dataset.ffAudioFmt;
      audioFmt = f === "m4a" || f === "wav" ? f : "mp3";
      $$("[data-ff-audio-fmt]").forEach((b) => b.classList.toggle("is-active", b.dataset.ffAudioFmt === audioFmt));
    });
  });
  $$("[data-ff-preset]").forEach((btn) => {
    btn.addEventListener("click", () => {
      convertPreset = btn.dataset.ffPreset || "mp4-fast";
      $$("[data-ff-preset]").forEach((b) => b.classList.toggle("is-active", b.dataset.ffPreset === convertPreset));
    });
  });

  ["mac", "win", "linux"].forEach((platform) => {
    $(`#ff-dl-${platform}`)?.addEventListener("click", () => {
      downloadBundle(platform).catch((err) => {
        setError(err.message || String(err));
        toast(err.message || String(err));
      });
    });
  });

  // highlight download for current OS
  const ua = navigator.userAgent || "";
  if (/Windows/i.test(ua)) {
    $("#ff-dl-win")?.classList.add("primary-btn");
    $("#ff-dl-win")?.classList.remove("secondary-btn");
  } else if (/Mac/i.test(ua)) {
    $("#ff-dl-mac")?.classList.add("primary-btn");
    $("#ff-dl-mac")?.classList.remove("secondary-btn");
  } else {
    $("#ff-dl-linux")?.classList.add("primary-btn");
    $("#ff-dl-linux")?.classList.remove("secondary-btn");
  }

  applyDeviceMode();
  window.addEventListener("resize", () => applyDeviceMode());
  window.addEventListener("devtools:route", () => paintAdaptTips());

  connectBridge({ fromPoll: true }).catch(() => {});

  window.DevToolsFfmpegBridge = {
    connect: connectBridge,
    isConnected: () => connected,
    isLikelyBridgeHost,
    applyDeviceMode,
  };
})();
