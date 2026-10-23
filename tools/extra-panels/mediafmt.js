(() => {
  "use strict";

  const K = window.DevToolsExtraKit;
  if (!K) return;
  const { $, bindPanel, toast } = K;

  const DEFAULT_BASE = "http://127.0.0.1:17888";
  const DEFAULT_TOKEN = "devtools-bridge";
  const BASE_KEY = "devtools-mediafmt-base";
  const TOKEN_KEY = "devtools-mediafmt-token";

  const VIDEO_TARGETS = [
    { value: "mp4", label: "MP4（高清 mp4-hq）", preset: "mp4-hq", tool: "vidkit" },
    { value: "mkv", label: "MKV", preset: "mkv", tool: "vidkit" },
    { value: "webm", label: "WebM", preset: "webm", tool: "vidkit" },
    { value: "mov", label: "MOV", preset: "mov", tool: "vidkit" },
  ];
  const AUDIO_TARGETS = [
    { value: "m4a", label: "M4A / AAC（抽轨）", preset: "extract-aac", tool: "audio", op: "extract-audio" },
    { value: "mp3", label: "MP3（抽轨）", preset: "extract-mp3", tool: "audio", op: "extract-audio" },
    { value: "wav", label: "WAV（抽轨）", preset: "extract-wav", tool: "audio", op: "extract-audio" },
  ];

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function downloadBlob(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name || "out.bin";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  function kindOf(file) {
    const name = String(file?.name || "");
    const type = String(file?.type || "");
    if (/^video\//i.test(type) || /\.(mp4|mov|mkv|webm|avi|m4v|wmv|flv)$/i.test(name)) return "video";
    if (/^audio\//i.test(type) || /\.(mp3|wav|aac|flac|m4a|ogg|opus)$/i.test(name)) return "audio";
    if (/^image\//i.test(type) || /\.(png|jpe?g|webp|gif|bmp|tiff?|avif)$/i.test(name)) return "image";
    return "other";
  }

  bindPanel("mediafmt", () => {
    if (!window.devtoolsBridgeShell?.mount) return;

    const shell = window.devtoolsBridgeShell.mount({
      host: "#mediafmt-bridge-shell",
      prefix: "mediafmt",
      kind: "unified",
      collapseAdvanced: true,
      refreshLabel: "刷新",
      hintDisconnected: "视频/音频最高质量转换建议启动统一桥（系统 FFmpeg）。图片可走图片工具，无需桥。",
      connHint:
        '共用统一桥 <strong>17888</strong> · Token <span class="mono">devtools-bridge</span> · API <span class="mono">/ff/*</span>',
    });

    const baseInput = shell.els.base;
    const tokenInput = shell.els.token;
    const errorEl = $("#mediafmt-error");
    const logEl = $("#mediafmt-log");
    const outEl = $("#mediafmt-out");
    const actions = $("#mediafmt-actions");
    const targetSel = $("#mediafmt-target");
    const routeEl = $("#mediafmt-route");
    const deepLink = $("#mediafmt-deep");

    try {
      const b = localStorage.getItem(BASE_KEY);
      const t = localStorage.getItem(TOKEN_KEY);
      if (b && baseInput) baseInput.value = b;
      if (t && tokenInput) tokenInput.value = t;
    } catch (_) {}

    const baseUrl = () => String(baseInput?.value || DEFAULT_BASE).replace(/\/$/, "");
    const token = () => String(tokenInput?.value || DEFAULT_TOKEN).trim();
    const setError = (m) => {
      if (!errorEl) return;
      errorEl.hidden = !m;
      errorEl.textContent = m || "";
    };
    const log = (m) => {
      if (logEl) logEl.textContent = m || "";
    };

    /** @type {File[]} */
    let files = [];
    let primaryKind = "";

    function persist() {
      try {
        localStorage.setItem(BASE_KEY, baseUrl());
        localStorage.setItem(TOKEN_KEY, token());
      } catch (_) {}
    }

    async function ffFetch(path, opts = {}) {
      persist();
      const headers = {
        "X-Adb-Token": token(),
        "X-Ffmpeg-Token": token(),
        ...(opts.headers || {}),
      };
      const res = await fetch(`${baseUrl()}/ff${path}`, { ...opts, headers });
      return res;
    }

    function renderList() {
      const ul = $("#mediafmt-list");
      if (!ul) return;
      ul.innerHTML = files
        .map((f) => {
          const k = kindOf(f);
          return `<li><span>${escapeHtml(f.name)} · ${Math.round((f.size || 0) / 1024)} KB</span><span class="hint tight">${k}</span></li>`;
        })
        .join("");
    }

    function syncActions() {
      if (!files.length) {
        actions.hidden = true;
        primaryKind = "";
        return;
      }
      primaryKind = kindOf(files[0]);
      actions.hidden = false;
      const opts =
        primaryKind === "video" ? VIDEO_TARGETS : primaryKind === "audio" ? AUDIO_TARGETS : [];
      if (primaryKind === "image") {
        targetSel.innerHTML = `<option value="imgkit">打开图片工具（mozjpeg / AVIF 最高质量）</option>`;
        routeEl.textContent = "图片：最高质量请用「图片工具」压缩/转码（本地，无桥亦可）。";
        deepLink.href = "#imgkit";
        deepLink.textContent = "打开图片工具";
        $("#mediafmt-run").textContent = "前往图片工具";
        return;
      }
      if (primaryKind === "other") {
        targetSel.innerHTML = `<option value="">无法识别</option>`;
        routeEl.textContent = "未识别为视频/音频/图片。";
        deepLink.href = "#ffbridge";
        $("#mediafmt-run").disabled = true;
        return;
      }
      $("#mediafmt-run").disabled = false;
      $("#mediafmt-run").textContent = "最高质量转换";
      targetSel.innerHTML = opts.map((o) => `<option value="${o.value}">${escapeHtml(o.label)}</option>`).join("");
      routeEl.textContent =
        primaryKind === "video"
          ? "视频：统一桥系统 FFmpeg（mp4-hq 等）→ 失败再考虑网页 FFmpeg（见视频工具）。"
          : "音频：本机桥抽轨 / 转换；精细修剪请用音频处理面板。";
      deepLink.href = primaryKind === "video" ? "#vidkit" : "#audio";
      deepLink.textContent = primaryKind === "video" ? "打开视频工具" : "打开音频处理";
    }

    async function waitJob(jobId, onProg) {
      for (;;) {
        await new Promise((r) => setTimeout(r, 800));
        const stRes = await ffFetch(`/jobs/${jobId}`);
        const st = await stRes.json().catch(() => null);
        const job = st?.job;
        if (!job) throw new Error("任务状态丢失");
        onProg?.(job);
        if (job.status === "done") return job;
        if (job.status === "error" || job.status === "cancelled") {
          throw new Error(job.error || "任务失败");
        }
      }
    }

    async function convertVideo(file, preset) {
      const q = new URLSearchParams({ op: "convert", preset, filename: file.name });
      log(`上传 ${file.name} → 本机 FFmpeg（${preset}）…`);
      const startRes = await ffFetch(`/jobs/browser-run?${q}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Filename": file.name,
        },
        body: file,
      });
      const started = await startRes.json().catch(() => null);
      const jobId = started?.job?.id;
      if (!jobId) throw new Error(started?.error || "桥未返回任务 ID（请确认 FFmpeg 模块已挂载）");
      const job = await waitJob(jobId, (j) => {
        log(`${file.name} · ${j.status || "running"} · ${j.phase || ""}`);
      });
      const dl = await ffFetch(`/jobs/${jobId}/download`);
      if (!dl.ok) throw new Error("下载结果失败");
      const blob = await dl.blob();
      const disp = dl.headers.get("Content-Disposition") || "";
      const m = /filename="?([^";]+)"?/i.exec(disp);
      const outName = m?.[1] || file.name.replace(/\.[^.]+$/, "") + ".mp4";
      downloadBlob(blob, outName);
      return outName;
    }

    async function convertAudio(file, preset) {
      // 抽轨/音频转换同样走 browser-run + convert/extract presets（若桥不支持则提示打开音频面板）
      const q = new URLSearchParams({
        op: preset.startsWith("extract") ? "extract-audio" : "convert",
        preset,
        filename: file.name,
      });
      log(`上传 ${file.name} → 本机 FFmpeg（${preset}）…`);
      const startRes = await ffFetch(`/jobs/browser-run?${q}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-Filename": file.name,
        },
        body: file,
      });
      const started = await startRes.json().catch(() => null);
      if (!started?.ok || !started?.job?.id) {
        throw new Error(started?.error || "音频转换需本机桥；也可打开「音频处理」面板");
      }
      const job = await waitJob(started.job.id, (j) => log(`${file.name} · ${j.status}`));
      const dl = await ffFetch(`/jobs/${started.job.id}/download`);
      const blob = await dl.blob();
      const outName = file.name.replace(/\.[^.]+$/, "") + (preset.includes("mp3") ? ".mp3" : preset.includes("wav") ? ".wav" : ".m4a");
      downloadBlob(blob, job.outName || outName);
      return outName;
    }

    async function run() {
      setError("");
      outEl.hidden = true;
      if (!files.length) {
        setError("请先选择文件");
        return;
      }
      if (primaryKind === "image") {
        location.hash = "#imgkit";
        return;
      }
      const val = targetSel.value;
      const table = primaryKind === "video" ? VIDEO_TARGETS : AUDIO_TARGETS;
      const plan = table.find((t) => t.value === val) || table[0];
      if (!plan) {
        setError("请选择目标格式");
        return;
      }
      const done = [];
      for (const f of files) {
        if (kindOf(f) !== primaryKind) {
          log(`跳过 ${f.name}（类型与首项不一致）`);
          continue;
        }
        try {
          const name =
            primaryKind === "video" ? await convertVideo(f, plan.preset) : await convertAudio(f, plan.preset);
          done.push(name);
        } catch (err) {
          setError(`${f.name}：${err.message || err}`);
          return;
        }
      }
      outEl.hidden = false;
      outEl.innerHTML = `<span class="hint tight">已完成：${escapeHtml(done.join(" · "))}</span>`;
      log(`完成 ${done.length} 个（本机 FFmpeg 最高质量档）`);
      toast("转换完成");
    }

    const drop = $("#mediafmt-drop");
    drop?.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("is-over");
    });
    drop?.addEventListener("dragleave", () => drop.classList.remove("is-over"));
    drop?.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("is-over");
      files = [...(e.dataTransfer?.files || [])];
      renderList();
      syncActions();
    });
    $("#mediafmt-file")?.addEventListener("change", (e) => {
      files = [...(e.target.files || [])];
      renderList();
      syncActions();
    });
    $("#mediafmt-clear")?.addEventListener("click", () => {
      files = [];
      if ($("#mediafmt-file")) $("#mediafmt-file").value = "";
      renderList();
      syncActions();
      log("");
      outEl.hidden = true;
    });
    $("#mediafmt-run")?.addEventListener("click", () => void run());

    renderList();
    syncActions();
  });
})();
