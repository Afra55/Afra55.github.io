(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const BASE_KEY = "devtools-ffmpeg-base";
  const TOKEN_KEY = "devtools-ffmpeg-token";
  const OP_KEY = "devtools-ffmpeg-op";
  const DEFAULT_BASE = "http://127.0.0.1:17888";
  const DEFAULT_TOKEN = "devtools-bridge";
  /** 统一桥上 FFmpeg 挂载前缀；独立旧桥为空 */
  let apiPrefix = "/ff";

  /** 离线兜底目录（桥未连上时仍可渲染表单） */
  const FALLBACK_OPS = [
    {
      id: "extract-audio",
      label: "抽音频",
      group: "音频",
      desc: "从视频/音频抽出或转出音轨",
      accept: "media",
      fields: [
        {
          key: "format",
          type: "select",
          label: "格式",
          options: [
            { value: "mp3", label: "MP3" },
            { value: "m4a", label: "M4A/AAC" },
            { value: "wav", label: "WAV" },
            { value: "flac", label: "FLAC" },
            { value: "ogg", label: "OGG" },
          ],
          default: "mp3",
        },
        {
          key: "bitrate",
          type: "select",
          label: "码率",
          options: [
            { value: "128k", label: "128k" },
            { value: "192k", label: "192k" },
            { value: "256k", label: "256k" },
            { value: "320k", label: "320k" },
          ],
          default: "192k",
        },
      ],
    },
    {
      id: "convert",
      label: "转封装/转码",
      group: "视频",
      desc: "MP4 / WebM / MKV / MOV",
      accept: "video",
      fields: [
        {
          key: "preset",
          type: "select",
          label: "预设",
          options: [
            { value: "mp4-fast", label: "MP4 快速" },
            { value: "mp4-hq", label: "MP4 高清" },
            { value: "mp4-copy", label: "MP4 流拷贝" },
            { value: "webm", label: "WebM VP9" },
            { value: "mkv", label: "MKV" },
            { value: "mov", label: "MOV" },
          ],
          default: "mp4-fast",
        },
      ],
    },
  ];

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
  const opSelect = $("#ff-op");
  const opOptsEl = $("#ff-op-opts");
  const opDescEl = $("#ff-op-desc");
  const opWebHint = $("#ff-op-webhint");
  const opMoreChk = $("#ff-op-more");
  const probeOut = $("#ff-probe-out");

  let connected = false;
  let cwd = "";
  let entries = [];
  /** @type {Set<string>} */
  const selected = new Set();
  /** @type {any[]} */
  let opsCatalog = FALLBACK_OPS.slice();
  let opsTiers = { common: [], more: [] };
  let showMoreOps = false;
  let currentOpId = "extract-audio";
  let pollTimer = 0;
  let waitPollTimer = 0;

  function isLikelyBridgeHost() {
    const ua = navigator.userAgent || "";
    if (/Android|iPhone|iPod|Mobile/i.test(ua)) return false;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const narrow = window.matchMedia("(max-width: 900px)").matches;
    if (/iPad|tablet/i.test(ua) || (coarse && narrow && !/Windows|Macintosh|Linux/i.test(ua))) return false;
    if (/Macintosh/i.test(ua) && coarse && typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 1) {
      return false;
    }
    return true;
  }

  function webFallbackLinksHtml() {
    return `
      <a class="primary-btn" href="#audio">网页·音频处理</a>
      <a class="secondary-btn" href="#vtrim">网页·视频修剪</a>
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
          ? "本机桥已连接时，大量文件可到「FFmpeg 本机桥」批量处理。"
          : "本页可直接用。电脑批量可选本机桥。"
        : "手机可直接在本页处理，无需安装。";
    }
    if (vtrimTip) {
      vtrimTip.textContent = host
        ? connected
          ? "批量导出可选用本机桥。"
          : "本页可直接用。电脑批量可选本机桥。"
        : "手机可直接在本页处理，无需安装。";
    }
  }

  function applyDeviceMode() {
    const host = isLikelyBridgeHost();
    panel?.classList.toggle("is-mobile-fallback", !host);
    panel?.classList.toggle("is-desktop-bridge", host);
    panel?.classList.toggle("is-bridge-connected", connected);

    if (headDesc) {
      headDesc.innerHTML = host
        ? `电脑批量：连本机桥用系统 FFmpeg。没连上时，用网页 <a href="#audio">音频处理</a> / <a href="#vtrim">视频修剪</a> 保底。<a href="#setup">安装指南</a>`
        : `手机请直接用网页内工具（无需安装本机桥）：<a href="#audio">音频处理</a>、<a href="#vtrim">视频修剪</a>、<a href="#v2g">视频转 GIF</a>。`;
    }

    if (modeTitle && modeText && modeActions) {
      if (!host) {
        modeTitle.textContent = "手机：请用网页内 FFmpeg";
        modeText.textContent =
          "本机桥只适合电脑。手机上请用下面入口，文件在浏览器本地处理，不上传。";
        modeActions.innerHTML = `
          <a class="primary-btn" href="#audio">音频处理</a>
          <a class="secondary-btn" href="#vtrim">视频修剪</a>
          <a class="secondary-btn" href="#v2g">视频转 GIF</a>
        `;
        if (bridgePanel) bridgePanel.hidden = true;
        if (workspace) workspace.hidden = true;
      } else if (connected) {
        modeTitle.textContent = "已走更优路径：本机 FFmpeg 桥";
        modeText.textContent = `已整理为常用 ${opsTiers.common?.length || "…"} 项（可展开更多）。桥擅长批量；网页擅长少量交互预览。`;
        modeActions.innerHTML = `
          <a class="ghost-btn" href="#audio">网页·音频</a>
          <a class="ghost-btn" href="#vtrim">网页·修剪</a>
        `;
        if (bridgePanel) bridgePanel.hidden = false;
      } else {
        modeTitle.textContent = "电脑推荐：本机桥（未连接）";
        modeText.textContent =
          "批量、大文件优先连接本机桥。暂时没装时，先用网页工具处理少量文件。";
        modeActions.innerHTML = `${webFallbackLinksHtml()}`;
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
      const sharedToken = window.devtoolsBridgeToken?.read?.();
      const op = localStorage.getItem(OP_KEY);
      if (b && baseInput) baseInput.value = b;
      if (tokenInput) tokenInput.value = sharedToken || tokenInput.value || DEFAULT_TOKEN;
      if (op) currentOpId = op;
    } catch (_) {}
  }

  function savePrefs() {
    try {
      localStorage.setItem(BASE_KEY, baseInput?.value?.trim() || DEFAULT_BASE);
      const t = tokenInput?.value?.trim() || DEFAULT_TOKEN;
      if (window.devtoolsBridgeToken?.write) window.devtoolsBridgeToken.write(t);
      else localStorage.setItem(TOKEN_KEY, t);
      localStorage.setItem(OP_KEY, currentOpId);
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
    if (opts.auth !== false) {
      headers["X-Ffmpeg-Token"] = token();
      headers["X-Adb-Token"] = token();
    }
    if (opts.body && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    const rawPath = String(pathname || "/");
    const usePrefix = opts.noPrefix ? "" : apiPrefix;
    const fullPath =
      rawPath.startsWith("/ff/") || rawPath === "/ff"
        ? rawPath
        : `${usePrefix}${rawPath.startsWith("/") ? rawPath : `/${rawPath}`}`;
    const res = await fetch(`${baseUrl()}${fullPath}`, {
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

  function formatDur(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    const r = (s % 60).toFixed(1);
    return m > 0 ? `${m}:${String(Math.floor(s % 60)).padStart(2, "0")}.${String(r).split(".")[1] || "0"}` : `${s.toFixed(1)}s`;
  }

  function visibleOps() {
    if (showMoreOps) return opsCatalog;
    const commonIds = new Set(opsTiers.common?.length ? opsTiers.common : opsCatalog.filter((o) => o.tier !== "more").map((o) => o.id));
    const filtered = opsCatalog.filter((o) => commonIds.has(o.id) || o.tier === "common" || !o.tier);
    return filtered.length ? filtered : opsCatalog;
  }

  function currentOp() {
    return opsCatalog.find((o) => o.id === currentOpId) || visibleOps()[0] || FALLBACK_OPS[0];
  }

  function renderOpSelect() {
    if (!opSelect) return;
    const list = visibleOps();
    const groups = new Map();
    list.forEach((op) => {
      const g = op.group || "其他";
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(op);
    });
    const parts = [];
    for (const [g, ops] of groups) {
      parts.push(`<optgroup label="${escapeAttr(g)}">`);
      ops.forEach((op) => {
        parts.push(`<option value="${escapeAttr(op.id)}">${escapeHtml(op.label)}</option>`);
      });
      parts.push(`</optgroup>`);
    }
    opSelect.innerHTML = parts.join("");
    if (!list.some((o) => o.id === currentOpId)) currentOpId = list[0]?.id || "extract-audio";
    opSelect.value = currentOpId;
    renderOpOpts();
  }

  function renderOpOpts() {
    const op = currentOp();
    if (opDescEl) {
      const nCommon = opsTiers.common?.length || opsCatalog.filter((o) => o.tier !== "more").length;
      const nAll = opsCatalog.length;
      opDescEl.textContent = op?.desc || "选择操作后填写参数";
      if (nAll) {
        opDescEl.textContent += showMoreOps ? ` · 全部 ${nAll} 项` : ` · 常用 ${nCommon} 项（可展开更多）`;
      }
    }
    if (opWebHint) {
      if (op?.webHint) {
        opWebHint.hidden = false;
        opWebHint.innerHTML = op.webHref
          ? `${escapeHtml(op.webHint)} → <a href="${escapeAttr(op.webHref)}">打开</a>`
          : escapeHtml(op.webHint);
      } else {
        opWebHint.hidden = true;
        opWebHint.textContent = "";
      }
    }
    if (!opOptsEl) return;
    const fields = Array.isArray(op?.fields) ? op.fields : [];
    if (!fields.length) {
      opOptsEl.innerHTML = `<p class="hint tight">此操作无需额外参数</p>`;
      return;
    }
    opOptsEl.innerHTML = fields
      .map((f) => {
        const id = `ff-opt-${escapeAttr(f.key)}`;
        const label = `<label for="${id}">${escapeHtml(f.label || f.key)}</label>`;
        if (f.type === "select") {
          const opts = (f.options || [])
            .map((o) => {
              const v = typeof o === "string" ? o : o.value;
              const lab = typeof o === "string" ? o : o.label || o.value;
              const sel = String(v) === String(f.default) ? " selected" : "";
              return `<option value="${escapeAttr(v)}"${sel}>${escapeHtml(lab)}</option>`;
            })
            .join("");
          return `<div class="ff-opt-field">${label}<select id="${id}" class="mono select-input" data-ff-opt="${escapeAttr(
            f.key
          )}">${opts}</select></div>`;
        }
        if (f.type === "text") {
          return `<div class="ff-opt-field ff-opt-wide">${label}<input id="${id}" class="mono" type="text" data-ff-opt="${escapeAttr(
            f.key
          )}" value="${escapeAttr(f.default ?? "")}" spellcheck="false" /></div>`;
        }
        const min = f.min != null ? ` min="${f.min}"` : "";
        const max = f.max != null ? ` max="${f.max}"` : "";
        const step = f.step != null ? ` step="${f.step}"` : "";
        return `<div class="ff-opt-field">${label}<input id="${id}" class="mono" type="number" data-ff-opt="${escapeAttr(
          f.key
        )}" value="${escapeAttr(f.default ?? 0)}"${min}${max}${step} /></div>`;
      })
      .join("");
  }

  function readOpOptions() {
    const out = {};
    if (!opOptsEl) return out;
    opOptsEl.querySelectorAll("[data-ff-opt]").forEach((el) => {
      const key = el.getAttribute("data-ff-opt");
      if (!key) return;
      if (el.type === "number") {
        const n = Number(el.value);
        out[key] = Number.isFinite(n) ? n : el.value;
      } else {
        out[key] = el.value;
      }
    });
    return out;
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
        ent.type === "dir" ? "📁" : ent.kind === "video" ? "🎬" : ent.kind === "audio" ? "🎵" : ent.kind === "image" ? "🖼" : "📄";
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
        const label = job.meta?.opLabel || job.type;
        const out = job.meta?.outDir ? `<div class="hint tight mono">输出：${escapeHtml(job.meta.outDir)}</div>` : "";
        const arts = (job.artifacts || [])
          .slice(0, 5)
          .map((a) => escapeHtml(a.name))
          .join("、");
        return `<div class="adb-job">
          <div class="label-row">
            <strong class="mono">${escapeHtml(label)} · ${escapeHtml(job.id)}</strong>
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

  async function loadOpsCatalog() {
    try {
      const data = await ffFetch("/ops");
      if (Array.isArray(data.ops) && data.ops.length) {
        opsCatalog = data.ops;
        opsTiers = data.tiers || { common: [], more: [] };
        renderOpSelect();
      }
    } catch (_) {
      /* keep fallback */
    }
  }

  async function connectBridge({ fromPoll = false } = {}) {
    savePrefs();
    setError("");
    try {
      const discovered = await window.devtoolsBridgeToken?.discoverBase?.(baseUrl(), token());
      if (!discovered?.health) {
        throw new Error(
          "无法连接本机桥。请确认启动脚本窗口仍打开；若横幅端口不是 17888，会自动扫描 17888–17899。Token 默认 devtools-bridge。"
        );
      }
      if (baseInput && baseUrl() !== discovered.base) {
        baseInput.value = discovered.base;
        savePrefs();
        try {
          localStorage.setItem("devtools-adb-base", discovered.base);
        } catch (_) {
          /* ignore */
        }
      }
      let rootHealth = discovered.health;
      if (
        rootHealth?.unified ||
        rootHealth?.service === "devtools-bridge" ||
        rootHealth?.ffmpegMount === "/ff" ||
        rootHealth?.capabilities?.ffmpeg
      ) {
        apiPrefix = "/ff";
      } else if (rootHealth?.service === "devtools-ffmpeg-bridge") {
        apiPrefix = "";
      } else {
        apiPrefix = "/ff";
      }

      const health =
        rootHealth?.ffmpeg != null
          ? rootHealth
          : await ffFetch("/health", { auth: false });
      const ffOk = Boolean(health.ffmpeg?.ok);
      if (toolsProbe) {
        toolsProbe.hidden = false;
        const mode = apiPrefix === "/ff" ? "统一桥" : "独立 FFmpeg 桥";
        toolsProbe.textContent = `${mode} v${health.version || "?"} · ffmpeg ${
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
      setStatus(
        "is-ok",
        apiPrefix === "/ff" ? "已连接统一本机桥 · FFmpeg" : "已连接本机 FFmpeg 桥",
        `更优路径已就绪 · Token 已配置`
      );
      // 本机目录：统一桥用 /ff/local/roots
      let roots = health.roots || [];
      if (apiPrefix === "/ff") {
        try {
          const rr = await ffFetch("/local/roots");
          if (rr?.roots?.length) roots = rr.roots;
        } catch (_) {
          /* keep health.roots if any */
        }
      }
      renderRoots(roots);
      await loadOpsCatalog();
      const home = roots?.[0]?.path || "";
      if (home) await openPath(home);
      await refreshJobs();
      startJobPoll();
      applyDeviceMode();
      if (!fromPoll) toast(apiPrefix === "/ff" ? "已连接统一本机桥（FFmpeg）" : "已连接 FFmpeg 桥");
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
    const [serverJs, ytdlpJs, scriptRaw] = await Promise.all([
      fetchTextAsset("./ffmpeg-bridge/server.js"),
      fetchTextAsset("./ffmpeg-bridge/ytdlp-core.js").catch(() => ""),
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
      "  - ytdlp-core.js",
      "  - " + cfg.scriptName,
      "",
      "使用步骤：",
      "1. 解压到同一文件夹",
      "2. 本机已安装 Node.js 与 ffmpeg（下载视频建议同时安装 yt-dlp）",
      "3. " + cfg.runHint.replace(/\n/g, "\n   "),
      "4. 回到网页点「连接本机桥」",
      "",
      "默认地址 http://127.0.0.1:17889  Token: devtools-ffmpeg",
      "",
    ].join("\n");
    const zip = new JSZip();
    zip.file("server.js", serverJs);
    if (ytdlpJs) zip.file("ytdlp-core.js", ytdlpJs);
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

  function outDirHintForOp(opId) {
    const map = {
      "extract-audio": "audio_out",
      "audio-convert": "audio_out",
      volume: "audio_out",
      loudnorm: "audio_out",
      mono: "audio_out",
      "denoise-audio": "audio_out",
      gif: "gif_out",
      thumb: "thumbs_out",
      frames: "frames_out",
      concat: "merge_out",
    };
    return map[opId] || "ff_out";
  }

  async function runTask() {
    setError("");
    if (!selected.size) {
      setError("请先勾选文件或文件夹");
      return;
    }
    const outDir = String(outdirInput?.value || "").trim();
    if (!outDir) {
      setError("请填写输出目录");
      return;
    }
    const op = currentOp();
    const body = {
      op: op.id,
      paths: [...selected],
      outDir,
      recursive: Boolean($("#ff-recursive")?.checked),
      createOutDir: Boolean($("#ff-mkdir")?.checked),
      overwrite: Boolean($("#ff-overwrite")?.checked),
      ...readOpOptions(),
    };
    try {
      const data = await ffFetch("/jobs/run", { method: "POST", body });
      toast(`任务已排队 · ${data.job?.meta?.count || selected.size} 个输入 · ${op.label}`);
      await refreshJobs();
    } catch (err) {
      setError(err.message || String(err));
    }
  }

  async function probeSelected() {
    setError("");
    if (!selected.size) {
      setError("请先勾选要探测的文件");
      return;
    }
    const paths = [...selected].slice(0, 20);
    try {
      const data = await ffFetch("/probe/batch", { method: "POST", body: { paths } });
      const lines = (data.items || []).map((it) => {
        if (!it.ok) return `${it.path || "?"} · 失败：${it.error || "?"}`;
        const v = it.video ? `${it.video.width}x${it.video.height} ${it.video.codec || ""}` : "无视频";
        const a = it.audio ? `${it.audio.codec || ""} ${it.audio.sampleRate || ""}Hz` : "无音频";
        return `${it.name} · ${formatDur(it.duration)} · ${formatSize(it.size)} · ${v} · ${a}`;
      });
      if (probeOut) {
        probeOut.hidden = false;
        probeOut.textContent = lines.join("\n");
      }
      toast(`已探测 ${lines.length} 项`);
    } catch (err) {
      setError(err.message || String(err));
    }
  }

  function selectCurrentPageMedia() {
    const op = currentOp();
    const accept = op?.accept || "video";
    entries.forEach((ent) => {
      if (ent.type !== "file") return;
      const ok =
        accept === "audio"
          ? ent.kind === "audio"
          : accept === "image"
            ? ent.kind === "image"
            : accept === "media" || accept === "av"
              ? ent.kind === "video" || ent.kind === "audio"
              : ent.kind === "video";
      if (ok) selected.add(joinPath(cwd, ent.name));
    });
    syncSelMeta();
    renderList();
  }

  // events
  loadPrefs();
  renderOpSelect();
  syncSelMeta();

  opSelect?.addEventListener("change", () => {
    currentOpId = opSelect.value;
    savePrefs();
    renderOpOpts();
  });
  opMoreChk?.addEventListener("change", () => {
    showMoreOps = Boolean(opMoreChk.checked);
    renderOpSelect();
  });

  connectBtn?.addEventListener("click", () => connectBridge());
  refreshBtn?.addEventListener("click", async () => {
    try {
      await openPath(cwd || pathInput?.value || "");
      await refreshJobs();
      await loadOpsCatalog();
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
  $("#ff-select-videos")?.addEventListener("click", () => selectCurrentPageMedia());
  const selBtn = $("#ff-select-videos");
  if (selBtn) selBtn.textContent = "勾选当前页媒体";
  $("#ff-clear-sel")?.addEventListener("click", () => {
    selected.clear();
    syncSelMeta();
    renderList();
  });
  $("#ff-outdir-here")?.addEventListener("click", () => {
    if (!cwd || !outdirInput) return;
    outdirInput.value = joinPath(cwd, outDirHintForOp(currentOpId));
  });
  $("#ff-run")?.addEventListener("click", () => runTask());
  $("#ff-probe-sel")?.addEventListener("click", () => probeSelected());
  $("#ff-jobs-refresh")?.addEventListener("click", () => refreshJobs().catch((err) => setError(err.message || String(err))));

  ["mac", "win", "linux"].forEach((platform) => {
    $(`#ff-dl-${platform}`)?.addEventListener("click", () => {
      downloadBundle(platform).catch((err) => {
        setError(err.message || String(err));
        toast(err.message || String(err));
      });
    });
  });

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
  window.addEventListener("resize", () => {
    applyDeviceMode();
    // 尺寸变化可能导致桌面/手机判定切换，重绘导航由 app 侧监听
  });
  window.addEventListener("devtools:route", () => paintAdaptTips());

  // 手机不发起本机桥探测，避免无用请求与失败提示
  if (isLikelyBridgeHost()) {
    connectBridge({ fromPoll: true }).catch(() => {});
  } else {
    applyDeviceMode();
  }

  window.DevToolsFfmpegBridge = {
    connect: connectBridge,
    isConnected: () => connected,
    isLikelyBridgeHost,
    applyDeviceMode,
  };
})();
