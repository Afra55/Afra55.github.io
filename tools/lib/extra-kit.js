(() => {
  "use strict";

  const P = window.DevToolsPure;
  if (!P) {
    console.error("DevToolsPure missing");
    return;
  }

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function flushPendingFileInput(input, handler) {
    if (!input?.files?.length) return;
    const files = input.files;
    void Promise.resolve(handler(files)).catch(() => {});
  }

  function setError(el, msg) {
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }

  function toast(msg) {
    const el = $("#toast");
    if (!el) return;
    el.textContent = msg;
    el.hidden = false;
    el.classList.add("is-show");
    clearTimeout(toast._t);
    clearTimeout(toast._tHide);
    toast._t = setTimeout(() => {
      el.classList.remove("is-show");
      toast._tHide = setTimeout(() => {
        el.hidden = true;
      }, 200);
    }, 1400);
  }

  function formatKb(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
  }

  function formatLocalPickMeta(file, extra) {
    const name = file?.name || "未命名";
    const size = formatKb(file?.size || 0);
    const tail = extra ? ` · ${extra}` : "";
    return `${name} · ${size} · 本地文件，不上传${tail}`;
  }

  function attachLocalVideoPreview(video, url) {
    if (!video) throw new Error("视频预览未找到");
    video.hidden = false;
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    try {
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      video.disableRemotePlayback = true;
    } catch (_) {
      /* ignore */
    }
    video.src = url;
    video.load();
  }

  function waitVideoMetadata(video, timeoutMs = 12000) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (ok, arg) => {
        if (settled) return;
        settled = true;
        video.removeEventListener("loadedmetadata", onMeta);
        video.removeEventListener("error", onErr);
        window.clearTimeout(timer);
        if (ok) resolve(arg);
        else reject(arg);
      };
      const onMeta = () => finish(true);
      const onErr = () => finish(false, new Error("无法读取该视频"));
      const timer = window.setTimeout(() => {
        if (video.videoWidth) finish(true);
        else finish(false, new Error("读取视频信息超时（文件仍在本地，未上传）"));
      }, timeoutMs);
      video.addEventListener("loadedmetadata", onMeta);
      video.addEventListener("error", onErr);
      if (video.readyState >= 1 && video.videoWidth) finish(true);
    });
  }

  /** 全站逻辑版本；后缀为中国标准时间 Asia/Shanghai（UTC+8）。与 lib/tools-build.js 同步。 */

  const EBind = () => window.DevToolsExtraBind;
  const bindPanel = (id, fn) => EBind()?.register?.(id, fn);

  window.DevToolsExtraKit = {
    P,
    escapeHtml: P.escapeHtml,
    $,
    $$,
    flushPendingFileInput,
    setError,
    toast,
    formatKb,
    formatLocalPickMeta,
    attachLocalVideoPreview,
    waitVideoMetadata,
    bindPanel,
    EBind,
  };
})();
