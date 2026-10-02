(() => {
  "use strict";

  /**
   * 可挂载的视频修剪/裁画面编辑器（复用 #vtrim 交互：胶片黄框 + 绿裁剪框）。
   * 供黑盒 GIF 等工具以全屏层打开；不含导出/旋转/翻转。
   */
  if (window.DevToolsVtrimEditor?.open) return;

  const MIN_SPAN = 0.5;
  /** 删中间段最小长度 */
  const MIN_CUTOUT = 0.2;
  /** 两段保留区之间最小间隙 */
  const MIN_KEEP_GAP = 0.25;
  /** 仅贴片头/片尾时吸附；过大易在抬手时「跳一下」 */
  const SNAP_EDGE_SEC = 0.06;
  /** 拖拽中预览 seek 节流（ms），对齐系统相册：手势跟手、画面稍后跟上 */
  const DRAG_SEEK_MS = 72;
  /** 半开片尾：拖拽预览与停播共用，约 1 帧（勿只靠 timeupdate，否则会多播） */
  const END_KEEP_SEC = 1 / 25;
  /** 半开片头：成片少收约半帧，避免预览落点后 ffmpeg 又多吸前几帧 */
  const START_KEEP_SEC = 1 / 50;
  let uidSeq = 0;

  function toast(msg) {
    const el = document.getElementById("toast");
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
    }, 2000);
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function formatClock(sec) {
    const s = Math.max(0, Number(sec) || 0);
    const m = Math.floor(s / 60);
    const r = s - m * 60;
    const whole = Math.floor(r);
    const frac = Math.round((r - whole) * 10);
    if (frac > 0 && frac < 10) return `${m}:${String(whole).padStart(2, "0")}.${frac}`;
    return `${m}:${String(whole).padStart(2, "0")}`;
  }

  function parseAspect(aspect) {
    const a = String(aspect || "free");
    if (a === "free") return null;
    const [w, h] = a.split(":").map(Number);
    if (!(w > 0 && h > 0)) return null;
    return w / h;
  }

  function waitSeek(videoEl) {
    return new Promise((resolve) => {
      if (!videoEl) return resolve();
      const done = () => {
        videoEl.removeEventListener("seeked", done);
        resolve();
      };
      videoEl.addEventListener("seeked", done);
      setTimeout(done, 800);
    });
  }

  function hapticLight() {
    try {
      if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
        navigator.vibrate(8);
      }
    } catch (_) {}
  }

  function ensureVtrimCss() {
    if (document.querySelector('link[data-panel-css="vtrim"]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    const build = window.TOOLS_BUILD || window.DevToolsLazy?.BUILD || "";
    const url = new URL("./styles/panels/vtrim.css", document.baseURI || window.location.href);
    if (build) url.searchParams.set("v", build);
    link.href = url.pathname + url.search;
    link.dataset.panelCss = "vtrim";
    document.head.appendChild(link);
  }

  function buildOverlayHtml(id) {
    const p = (name) => `${id}-${name}`;
    return `
<div class="vtrim-editor-overlay" id="${p("overlay")}" role="dialog" aria-modal="true" aria-labelledby="${p("title")}">
  <div class="vtrim-editor-sheet">
    <header class="vtrim-editor-head">
      <h2 class="vtrim-editor-title" id="${p("title")}">编辑视频</h2>
      <p class="hint tight vtrim-editor-sub" id="${p("sub")}" hidden>裁切画面 · 修剪时长 · 删中间</p>
    </header>
    <div class="vtrim-editor-body">
      <div class="vtrim-stage is-mode-trim" id="${p("stage")}">
        <div class="vtrim-preview-wrap" id="${p("preview-wrap")}">
          <video id="${p("video")}" class="vtrim-video" playsinline muted preload="metadata"></video>
          <button type="button" class="vtrim-tap-play" id="${p("tap-play")}" hidden aria-label="播放或暂停"></button>
          <p class="vtrim-film-loading hint" id="${p("film-loading")}" hidden>正在生成胶片预览…</p>
          <div class="vtrim-crop-box" id="${p("crop-box")}" hidden>
            <span class="vtrim-crop-grid" aria-hidden="true"></span>
            <span class="vtrim-crop-handle" data-vte-handle="nw"></span>
            <span class="vtrim-crop-handle" data-vte-handle="n"></span>
            <span class="vtrim-crop-handle" data-vte-handle="ne"></span>
            <span class="vtrim-crop-handle" data-vte-handle="e"></span>
            <span class="vtrim-crop-handle" data-vte-handle="se"></span>
            <span class="vtrim-crop-handle" data-vte-handle="s"></span>
            <span class="vtrim-crop-handle" data-vte-handle="sw"></span>
            <span class="vtrim-crop-handle" data-vte-handle="w"></span>
          </div>
        </div>
        <div class="vtrim-transport">
          <button type="button" class="secondary-btn" id="${p("play")}">播放</button>
          <button type="button" class="ghost-btn" id="${p("mute")}" aria-pressed="true">开声音</button>
          <span class="mono vtrim-clock" id="${p("clock")}">0:00 / 0:00</span>
          <span class="hint tight" id="${p("range-label")}">保留全程</span>
        </div>
        <div class="field-row" style="flex-wrap:wrap;margin-top:0.35rem;align-items:center;gap:0.55rem">
          <span class="seg" role="group" aria-label="编辑模式">
            <button type="button" class="seg-btn is-active" data-vte-mode="trim">修剪时长</button>
            <button type="button" class="seg-btn" data-vte-mode="crop">裁切画面</button>
            <button type="button" class="seg-btn" data-vte-mode="cut">删中间</button>
          </span>
          <span class="hint tight" id="${p("mode-hint")}"></span>
        </div>
        <div class="vtrim-trim-tools" id="${p("trim-tools")}">
          <div class="vtrim-timeline" id="${p("timeline")}" aria-label="修剪片头片尾或删除中间段">
            <canvas id="${p("filmstrip")}" class="vtrim-filmstrip" width="640" height="56" aria-hidden="true"></canvas>
            <div class="vtrim-sel" id="${p("sel")}">
              <span class="vtrim-window" id="${p("window")}" aria-hidden="true"></span>
              <span class="vtrim-cutouts" id="${p("cutouts")}" aria-hidden="true"></span>
              <span class="vtrim-handle vtrim-handle-start" id="${p("handle-start")}" role="slider" aria-label="片头" tabindex="0">
                <span class="vtrim-handle-tip" id="${p("tip-start")}" hidden>0:00</span>
              </span>
              <span class="vtrim-handle vtrim-handle-end" id="${p("handle-end")}" role="slider" aria-label="片尾" tabindex="0">
                <span class="vtrim-handle-tip" id="${p("tip-end")}" hidden>0:00</span>
              </span>
              <span class="vtrim-playhead" id="${p("playhead")}" aria-hidden="true"></span>
            </div>
          </div>
          <div class="btn-row tool-actions vtrim-nudge" id="${p("trim-nudge")}" aria-label="微调时长（可长按）">
            <button type="button" class="ghost-btn" id="${p("nudge-start-m")}" title="片头 −0.1s，可长按">片头−</button>
            <button type="button" class="ghost-btn" id="${p("nudge-start-p")}" title="片头 +0.1s，可长按">片头+</button>
            <button type="button" class="ghost-btn" id="${p("nudge-end-m")}" title="片尾 −0.1s，可长按">片尾−</button>
            <button type="button" class="ghost-btn" id="${p("nudge-end-p")}" title="片尾 +0.1s，可长按">片尾+</button>
          </div>
          <div class="btn-row tool-actions vtrim-cut-tools" id="${p("cut-tools")}" hidden aria-label="删中间">
            <button type="button" class="secondary-btn" id="${p("cut-add")}" title="在播放头附近添加一段删除区">添加删除段</button>
            <button type="button" class="ghost-btn" id="${p("cut-del")}" title="删除当前选中的删除段" disabled>删选中段</button>
            <button type="button" class="ghost-btn" id="${p("cut-clear")}" title="清空全部删除段">清空</button>
          </div>
        </div>
        <div class="vtrim-crop-tools" id="${p("crop-panel")}" hidden>
          <div class="field-row vtrim-crop-tools-row" style="flex-wrap:wrap;margin-top:0.35rem;align-items:center">
            <span class="seg" role="group" aria-label="裁剪比例">
              <button type="button" class="seg-btn is-active" data-vte-aspect="free">自由</button>
              <button type="button" class="seg-btn" data-vte-aspect="1:1">1:1</button>
              <button type="button" class="seg-btn" data-vte-aspect="16:9">16:9</button>
              <button type="button" class="seg-btn" data-vte-aspect="4:3">4:3</button>
              <button type="button" class="seg-btn" data-vte-aspect="9:16">9:16</button>
            </span>
            <button type="button" class="ghost-btn" id="${p("crop-reset")}" title="恢复为当前比例下的最大裁剪">重置裁剪</button>
            <label class="flag"><input type="checkbox" id="${p("crop-enable")}" checked /> 启用裁剪框</label>
          </div>
          <p class="hint tight">拖绿框裁切 · 双击重置</p>
          <canvas id="${p("crop-live")}" class="vtrim-crop-live" width="160" height="90" hidden aria-label="裁剪成片预览"></canvas>
        </div>
      </div>
    </div>
    <footer class="vtrim-editor-foot">
      <button type="button" class="ghost-btn" id="${p("close")}">关闭</button>
      <button type="button" class="primary-btn" id="${p("done")}">完成</button>
    </footer>
  </div>
</div>`;
  }

  let pageScrollLockY = 0;
  let pageScrollLocked = false;
  /** @type {HTMLElement | null} */
  let pageScrollShell = null;
  let pageScrollShellY = 0;

  function lockPageScroll() {
    const b = document.body;
    const shell = document.querySelector("main.shell, .shell");
    // 调用方（黑盒）可能已先锁滚动并盖 boot；勿把 Y 读成 0
    if (pageScrollLocked || (b.classList.contains("vtrim-editor-open") && b.style.position === "fixed")) {
      pageScrollLocked = true;
      const m = /^(-?\d+(?:\.\d+)?)px$/.exec(b.style.top || "");
      if (m) pageScrollLockY = Math.abs(Number(m[1]) || 0);
      pageScrollShell = shell;
      pageScrollShellY = shell ? shell.scrollTop || 0 : 0;
      if (shell) shell.style.overflow = "hidden";
      b.classList.add("vtrim-editor-open");
      return;
    }
    pageScrollLocked = true;
    pageScrollLockY = window.scrollY || document.documentElement.scrollTop || 0;
    pageScrollShell = shell;
    pageScrollShellY = shell ? shell.scrollTop || 0 : 0;
    b.classList.add("vtrim-editor-open");
    b.style.position = "fixed";
    b.style.top = `-${pageScrollLockY}px`;
    b.style.left = "0";
    b.style.right = "0";
    b.style.width = "100%";
    b.style.overflow = "hidden";
    if (shell) shell.style.overflow = "hidden";
  }

  function unlockPageScroll() {
    const b = document.body;
    pageScrollLocked = false;
    b.classList.remove("vtrim-editor-open");
    b.style.position = "";
    b.style.top = "";
    b.style.left = "";
    b.style.right = "";
    b.style.width = "";
    b.style.overflow = "";
    const shell = pageScrollShell || document.querySelector("main.shell, .shell");
    if (shell) {
      shell.style.overflow = "";
      if (pageScrollShell) shell.scrollTop = pageScrollShellY;
    }
    pageScrollShell = null;
    window.scrollTo(0, pageScrollLockY);
  }

  function openEditor(opts = {}) {
    ensureVtrimCss();
    const file = opts.file;
    if (!file) return Promise.reject(new Error("缺少视频文件"));

    const id = `vte${++uidSeq}`;
    const wrap = document.createElement("div");
    wrap.innerHTML = buildOverlayHtml(id);
    const overlay = wrap.firstElementChild;
    // 先锁滚动再挂层，避免手机点编辑时底层页先滚一下
    lockPageScroll();
    document.body.appendChild(overlay);

    const $ = (name) => overlay.querySelector(`#${id}-${name}`);
    const stage = $("stage");
    const previewWrap = $("preview-wrap");
    const video = $("video");
    const cropBox = $("crop-box");
    const tapPlay = $("tap-play");
    const filmLoading = $("film-loading");
    const playBtn = $("play");
    const muteBtn = $("mute");
    const clockEl = $("clock");
    const rangeLabel = $("range-label");
    const modeHint = $("mode-hint");
    const trimTools = $("trim-tools");
    const cropPanel = $("crop-panel");
    const timeline = $("timeline");
    const filmstrip = $("filmstrip");
    const selEl = $("sel");
    const handleStart = $("handle-start");
    const handleEnd = $("handle-end");
    const tipStart = $("tip-start");
    const tipEnd = $("tip-end");
    const windowEl = $("window");
    const cropEnable = $("crop-enable");
    const cropResetBtn = $("crop-reset");
    const cropLive = $("crop-live");
    const titleEl = $("title");
    const subEl = $("sub");
    const cutoutsEl = $("cutouts");
    const trimNudge = $("trim-nudge");
    const cutTools = $("cut-tools");
    const cutAddBtn = $("cut-add");
    const cutDelBtn = $("cut-del");
    const cutClearBtn = $("cut-clear");

    const filmVideo = document.createElement("video");
    filmVideo.muted = true;
    filmVideo.preload = "auto";
    filmVideo.playsInline = true;
    filmVideo.setAttribute("playsinline", "");
    filmVideo.setAttribute("aria-hidden", "true");
    filmVideo.style.cssText =
      "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none;z-index:-1";
    document.body.appendChild(filmVideo);

    let objectUrl = "";
    let duration = 0;
    let startSec = 0;
    let endSec = 0;
    let muted = true;
    let aspect = "free";
    let crop = { x: 0, y: 0, w: 1, h: 1 };
    /** @type {{ start: number, end: number }[]} */
    let cutouts = [];
    let selectedCutout = -1;
    const initMode = String(opts.initialMode || "trim");
    let editMode = initMode === "crop" || initMode === "cut" ? initMode : "trim";
    let drag = null;
    let cropDrag = null;
    let previewScrub = null;
    let activeHandle = "start";
    let scrubSeekWanted = null;
    let scrubSeekInflight = false;
    let dragSeekTimer = 0;
    let playheadRaf = 0;
    let playWindowGen = 0;
    let playWindowLooping = false;
    let cropLiveRaf = 0;
    let filmGen = 0;
    let closed = false;
    let settled = false;
    /** @type {((v: any) => void) | null} */
    let resolveOpen = null;

    const fileName = String(opts.title || file.name || "视频");
    if (titleEl) titleEl.textContent = `编辑 · ${fileName}`;
    if (subEl) subEl.textContent = "裁切画面 · 修剪时长 · 删中间（可反复改，互相融合）";

    function syncActiveHandleUi() {
      handleStart?.classList.toggle("is-active", activeHandle === "start" && editMode !== "cut");
      handleEnd?.classList.toggle("is-active", activeHandle === "end" && editMode !== "cut");
    }

    function syncModeUi() {
      overlay.querySelectorAll("[data-vte-mode]").forEach((btn) => {
        btn.classList.toggle("is-active", btn.dataset.vteMode === editMode);
      });
      const showTimeline = editMode === "trim" || editMode === "cut";
      if (trimTools) trimTools.hidden = !showTimeline;
      if (cropPanel) cropPanel.hidden = editMode !== "crop";
      if (trimNudge) trimNudge.hidden = editMode !== "trim";
      if (cutTools) cutTools.hidden = editMode !== "cut";
      if (modeHint) {
        modeHint.textContent =
          editMode === "crop"
            ? "拖绿框 · 双击重置"
            : editMode === "cut"
              ? "点「添加删除段」· 再拖红柄微调"
              : "拖黄柄裁片头片尾";
      }
      syncCropBoxVisibility();
      stage?.classList.toggle("is-mode-crop", editMode === "crop");
      stage?.classList.toggle("is-mode-trim", editMode === "trim");
      stage?.classList.toggle("is-mode-cut", editMode === "cut");
      handleStart?.classList.toggle("is-locked", editMode === "cut");
      handleEnd?.classList.toggle("is-locked", editMode === "cut");
      syncCutoutUi();
      scheduleCropLive();
    }

    function syncMuteUi() {
      video.muted = muted;
      if (muteBtn) {
        muteBtn.textContent = muted ? "开声音" : "静音";
        muteBtn.setAttribute("aria-pressed", muted ? "true" : "false");
      }
    }

    function normalizeCutoutsList(list, lo, hi) {
      const a = Math.max(0, Number(lo) || 0);
      const b = Math.max(a + MIN_SPAN, Number(hi) || 0);
      const raw = (Array.isArray(list) ? list : [])
        .map((c) => ({
          start: Math.max(a, Number(c?.start) || 0),
          end: Math.min(b, Number(c?.end) || 0),
        }))
        .filter((c) => c.end - c.start >= MIN_CUTOUT)
        .sort((x, y) => x.start - y.start);
      const merged = [];
      for (const c of raw) {
        const last = merged[merged.length - 1];
        if (last && c.start <= last.end + 0.02) last.end = Math.max(last.end, c.end);
        else merged.push({ start: c.start, end: c.end });
      }
      return merged;
    }

    function keepRangesLocal() {
      const cuts = normalizeCutoutsList(cutouts, startSec, endSec);
      const keeps = [];
      let cursor = startSec;
      for (const c of cuts) {
        if (c.start > cursor + 0.04) keeps.push({ start: cursor, end: c.start });
        cursor = Math.max(cursor, c.end);
      }
      if (endSec > cursor + 0.04) keeps.push({ start: cursor, end: endSec });
      if (!keeps.length) keeps.push({ start: startSec, end: endSec });
      return keeps;
    }

    function clipCutoutsToWindow() {
      cutouts = normalizeCutoutsList(cutouts, startSec, endSec);
      if (selectedCutout >= cutouts.length) selectedCutout = cutouts.length ? cutouts.length - 1 : -1;
    }

    function syncCutoutUi() {
      if (cutDelBtn) cutDelBtn.disabled = !(editMode === "cut" && selectedCutout >= 0);
      paintCutouts();
    }

    function paintCutouts() {
      if (!cutoutsEl || !duration) return;
      cutoutsEl.replaceChildren();
      const list = normalizeCutoutsList(cutouts, startSec, endSec);
      list.forEach((c, i) => {
        const el = document.createElement("span");
        el.className = "vtrim-cutout" + (i === selectedCutout ? " is-selected" : "");
        el.dataset.cutIndex = String(i);
        el.style.setProperty("--cut-start", `${(c.start / duration) * 100}%`);
        el.style.setProperty("--cut-end", `${(c.end / duration) * 100}%`);
        const hs = document.createElement("span");
        hs.className = "vtrim-cutout-handle vtrim-cutout-handle-start";
        hs.dataset.cutIndex = String(i);
        hs.dataset.cutEdge = "start";
        const he = document.createElement("span");
        he.className = "vtrim-cutout-handle vtrim-cutout-handle-end";
        he.dataset.cutIndex = String(i);
        he.dataset.cutEdge = "end";
        el.append(hs, he);
        cutoutsEl.appendChild(el);
      });
    }

    function addCutoutAtPlayhead() {
      const mid = clamp(Number(video.currentTime) || (startSec + endSec) / 2, startSec, endSec);
      const half = Math.max(MIN_CUTOUT / 2, Math.min(1.2, (endSec - startSec) * 0.12));
      let a = clamp(mid - half, startSec, endSec);
      let b = clamp(mid + half, startSec, endSec);
      if (b - a < MIN_CUTOUT) {
        b = Math.min(endSec, a + MIN_CUTOUT);
        a = Math.max(startSec, b - MIN_CUTOUT);
      }
      cutouts = normalizeCutoutsList([...cutouts, { start: a, end: b }], startSec, endSec);
      selectedCutout = Math.max(
        0,
        cutouts.findIndex((c) => a >= c.start - 0.01 && b <= c.end + 0.01)
      );
      if (selectedCutout < 0) selectedCutout = cutouts.length - 1;
      syncCutoutUi();
      updateLabels();
      previewSeek((a + b) / 2, { throttle: false });
      toast("已添加删除段 · 拖红柄微调");
    }

    function deleteSelectedCutout() {
      if (selectedCutout < 0 || selectedCutout >= cutouts.length) return;
      cutouts = cutouts.filter((_, i) => i !== selectedCutout);
      selectedCutout = -1;
      clipCutoutsToWindow();
      syncCutoutUi();
      updateLabels();
    }

    function clearAllCutouts() {
      cutouts = [];
      selectedCutout = -1;
      syncCutoutUi();
      updateLabels();
    }

    function setCutoutEdge(index, edge, t) {
      if (index < 0 || index >= cutouts.length) return;
      const c = { ...cutouts[index] };
      if (edge === "start") {
        c.start = clamp(t, startSec, c.end - MIN_CUTOUT);
        previewSeek(c.start, { throttle: Boolean(drag) });
      } else {
        c.end = clamp(t, c.start + MIN_CUTOUT, endSec);
        previewSeek(c.end, { throttle: Boolean(drag) });
      }
      const next = cutouts.slice();
      next[index] = c;
      cutouts = normalizeCutoutsList(next, startSec, endSec);
      selectedCutout = Math.min(index, cutouts.length - 1);
      paintCutouts();
      updateLabels();
    }

    function syncAspectUi() {
      overlay.querySelectorAll("[data-vte-aspect]").forEach((btn) => {
        btn.classList.toggle("is-active", btn.dataset.vteAspect === aspect);
      });
    }

    function syncCropBoxVisibility() {
      // 裁剪框默认常显（修剪/删中间时也能看到范围）；仅「裁切画面」模式可拖
      const on = Boolean(cropEnable?.checked) && duration > 0;
      if (cropBox) cropBox.hidden = !on;
      previewWrap?.classList.toggle("is-cropping", on);
      cropBox?.classList.toggle("is-interactive", on && editMode === "crop");
    }

    function displaySize() {
      const vw = video.videoWidth || 1;
      const vh = video.videoHeight || 1;
      return { w: vw, h: vh, srcW: vw, srcH: vh };
    }

    function cropToDisplayRect() {
      const { w: dw, h: dh } = displaySize();
      return {
        x: clamp(crop.x, 0, dw),
        y: clamp(crop.y, 0, dh),
        w: clamp(crop.w, 1, dw),
        h: clamp(crop.h, 1, dh),
        dw,
        dh,
      };
    }

    function displayRectToCrop(dx, dy, dwBox, dhBox) {
      const { srcW, srcH } = displaySize();
      let x = clamp(dx, 0, srcW - 1);
      let y = clamp(dy, 0, srcH - 1);
      let w = clamp(dwBox, 1, srcW - x);
      let h = clamp(dhBox, 1, srcH - y);
      crop = { x, y, w, h };
    }

    function videoContentRect() {
      const wrap = previewWrap.getBoundingClientRect();
      const { w: dw, h: dh } = displaySize();
      const scale = Math.min(wrap.width / dw, wrap.height / dh);
      const rw = dw * scale;
      const rh = dh * scale;
      const left = (wrap.width - rw) / 2;
      const top = (wrap.height - rh) / 2;
      return { left, top, width: rw, height: rh, scale, dw, dh };
    }

    function layoutCropBox() {
      if (!cropBox || cropBox.hidden || !video.videoWidth) {
        scheduleCropLive();
        return;
      }
      const geom = videoContentRect();
      const d = cropToDisplayRect();
      cropBox.style.left = `${geom.left + (d.x / d.dw) * geom.width}px`;
      cropBox.style.top = `${geom.top + (d.y / d.dh) * geom.height}px`;
      cropBox.style.width = `${(d.w / d.dw) * geom.width}px`;
      cropBox.style.height = `${(d.h / d.dh) * geom.height}px`;
      scheduleCropLive();
    }

    function fitCropToAspect() {
      if (!video.videoWidth) return;
      const { w: dw, h: dh, srcW, srcH } = displaySize();
      let x = 0;
      let y = 0;
      let w = dw;
      let h = dh;
      const ratio = parseAspect(aspect);
      if (ratio) {
        if (dw / dh > ratio) {
          h = dh;
          w = h * ratio;
          x = (dw - w) / 2;
        } else {
          w = dw;
          h = w / ratio;
          y = (dh - h) / 2;
        }
        displayRectToCrop(x, y, w, h);
      } else {
        // 自由比例默认整幅可选中框，避免小框难拖
        crop = { x: 0, y: 0, w: srcW, h: srcH };
      }
      layoutCropBox();
    }

    function syncHandleTips() {
      if (tipStart) tipStart.textContent = formatClock(startSec);
      if (tipEnd) tipEnd.textContent = formatClock(endSec);
      const dragging = Boolean(drag);
      const showStart = dragging && (drag.kind === "start" || drag.kind === "window");
      const showEnd = dragging && (drag.kind === "end" || drag.kind === "window");
      if (tipStart) tipStart.hidden = !showStart;
      if (tipEnd) tipEnd.hidden = !showEnd;
    }

    function pumpPreviewScrubSeek() {
      if (!video?.src || scrubSeekInflight) return;
      if (scrubSeekWanted == null) return;
      const t = Math.max(0, Math.min(duration || 0, scrubSeekWanted));
      scrubSeekWanted = null;
      if (Math.abs((Number(video.currentTime) || 0) - t) < 0.03 && !video.seeking) {
        paintTimeline();
        updateLabels();
        return;
      }
      scrubSeekInflight = true;
      const onSeeked = () => {
        video.removeEventListener("seeked", onSeeked);
        scrubSeekInflight = false;
        paintTimeline();
        updateLabels();
        pumpPreviewScrubSeek();
      };
      video.addEventListener("seeked", onSeeked, { once: true });
      try {
        video.currentTime = t;
      } catch (_) {}
    }

    function endKeepSec() {
      return Math.max(startSec, endSec - END_KEEP_SEC);
    }

    function startKeepSec() {
      // 半开片头：成片从略晚于预览落点开始，避免多吸前几帧
      return Math.min(endKeepSec(), startSec + START_KEEP_SEC);
    }

    function previewSeek(t, { throttle = false } = {}) {
      scrubSeekWanted = clamp(t, 0, Math.max(0, duration - END_KEEP_SEC));
      if (!throttle) {
        if (dragSeekTimer) {
          clearTimeout(dragSeekTimer);
          dragSeekTimer = 0;
        }
        pumpPreviewScrubSeek();
        return;
      }
      if (dragSeekTimer) return;
      dragSeekTimer = window.setTimeout(() => {
        dragSeekTimer = 0;
        pumpPreviewScrubSeek();
      }, DRAG_SEEK_MS);
    }

    function updateLabels() {
      const now = video.currentTime || startSec;
      if (clockEl) clockEl.textContent = `${formatClock(now)} / ${formatClock(duration)}`;
      const keeps = keepRangesLocal();
      const keepSpan = keeps.reduce((s, k) => s + Math.max(0, k.end - k.start), 0);
      const cutN = normalizeCutoutsList(cutouts, startSec, endSec).length;
      if (rangeLabel) {
        if (cutN > 0) {
          rangeLabel.textContent = `保留 ${formatClock(keepSpan)}（外框 ${formatClock(startSec)}–${formatClock(endSec)} · 删 ${cutN} 段）`;
        } else {
          rangeLabel.textContent = `保留 ${formatClock(Math.max(0, endSec - startSec))}（${formatClock(startSec)}–${formatClock(endSec)}）`;
        }
      }
      syncHandleTips();
      if (cutDelBtn) cutDelBtn.disabled = !(editMode === "cut" && selectedCutout >= 0);
    }

    function paintTimeline() {
      if (!selEl || !duration) {
        if (selEl) {
          selEl.style.setProperty("--vtrim-start", "0%");
          selEl.style.setProperty("--vtrim-end", "100%");
          selEl.style.setProperty("--vtrim-play", "0%");
        }
        return;
      }
      const sPct = (startSec / duration) * 100;
      const ePct = (endSec / duration) * 100;
      // 拖片头/片尾时播放头跟手柄，避免 seek 滞后造成抬手「回弹」
      let playT = Number(video.currentTime) || 0;
      if (drag?.kind === "start") playT = startSec;
      else if (drag?.kind === "end") playT = endKeepSec();
      else if (drag?.kind === "window") playT = startSec;
      else if (drag?.kind === "cut-start" && drag.cutIndex >= 0) playT = cutouts[drag.cutIndex]?.start ?? playT;
      else if (drag?.kind === "cut-end" && drag.cutIndex >= 0) playT = cutouts[drag.cutIndex]?.end ?? playT;
      const pPct = (playT / duration) * 100;
      selEl.style.setProperty("--vtrim-start", `${sPct}%`);
      selEl.style.setProperty("--vtrim-end", `${ePct}%`);
      selEl.style.setProperty("--vtrim-play", `${clamp(pPct, 0, 100)}%`);
      paintCutouts();
    }

    function paintCropLive() {
      if (!cropLive || !video?.videoWidth) {
        if (cropLive) cropLive.hidden = true;
        return;
      }
      const show = editMode === "crop" && Boolean(cropEnable?.checked);
      cropLive.hidden = !show;
      if (!show) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const maxW = 160;
      const maxH = 90;
      const sx = Math.max(0, crop.x);
      const sy = Math.max(0, crop.y);
      const sw = Math.max(2, crop.w);
      const sh = Math.max(2, crop.h);
      const scale = Math.min(maxW / sw, maxH / sh, 1);
      const cssW = Math.max(48, Math.round(sw * scale));
      const cssH = Math.max(28, Math.round(sh * scale));
      cropLive.width = Math.round(cssW * dpr);
      cropLive.height = Math.round(cssH * dpr);
      cropLive.style.width = `${cssW}px`;
      cropLive.style.height = `${cssH}px`;
      const ctx = cropLive.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssW, cssH);
      ctx.fillStyle = window.DevToolsTheme?.stageBg?.() || "#0a101c";
      ctx.fillRect(0, 0, cssW, cssH);
      try {
        ctx.drawImage(video, sx, sy, sw, sh, 0, 0, cssW, cssH);
      } catch (_) {}
    }

    function scheduleCropLive() {
      cancelAnimationFrame(cropLiveRaf);
      cropLiveRaf = requestAnimationFrame(() => paintCropLive());
    }

    async function ensureFilmProbe() {
      if (!objectUrl) return false;
      if (filmVideo.src === objectUrl && filmVideo.readyState >= 1) return true;
      try {
        filmVideo.src = objectUrl;
        await new Promise((resolve, reject) => {
          const ok = () => {
            cleanup();
            resolve();
          };
          const fail = () => {
            cleanup();
            reject(new Error("film probe"));
          };
          const cleanup = () => {
            filmVideo.removeEventListener("loadedmetadata", ok);
            filmVideo.removeEventListener("error", fail);
          };
          filmVideo.addEventListener("loadedmetadata", ok);
          filmVideo.addEventListener("error", fail);
          setTimeout(fail, 8000);
        });
        return true;
      } catch (_) {
        return false;
      }
    }

    async function buildFilmstrip() {
      if (!filmstrip || !duration || !video.videoWidth) return;
      const gen = ++filmGen;
      if (filmLoading) {
        filmLoading.hidden = false;
        filmLoading.textContent = "正在生成胶片预览…";
      }
      previewWrap?.classList.add("is-film-loading");
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const cssW = Math.max(320, Math.round(timeline?.clientWidth || 640));
      const cssH = 56;
      filmstrip.width = Math.round(cssW * dpr);
      filmstrip.height = Math.round(cssH * dpr);
      filmstrip.style.width = `${cssW}px`;
      filmstrip.style.height = `${cssH}px`;
      const ctx = filmstrip.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = window.DevToolsTheme?.stageBg?.() || "#0a101c";
      ctx.fillRect(0, 0, cssW, cssH);
      const nBase = Math.min(36, Math.max(12, Math.round(cssW / 36)));
      const n =
        duration > 900 ? Math.min(nBase, 10) : duration > 300 ? Math.min(nBase, 14) : duration > 120 ? Math.min(nBase, 20) : nBase;
      const tw = cssW / n;
      const probeOk = await ensureFilmProbe();
      if (gen !== filmGen) return;
      const probe = probeOk ? filmVideo : video;
      const pauseMain = probe === video;
      const wasTime = pauseMain ? video.currentTime : 0;
      const wasPaused = pauseMain ? video.paused : true;
      if (pauseMain) {
        try {
          video.pause();
        } catch (_) {}
      }
      for (let i = 0; i < n; i++) {
        if (gen !== filmGen || closed) return;
        const t = (duration * i) / Math.max(1, n - 1);
        try {
          probe.currentTime = Math.min(duration - 0.05, Math.max(0, t));
          await waitSeek(probe);
          if (gen !== filmGen) return;
          const vw = probe.videoWidth || video.videoWidth;
          const vh = probe.videoHeight || video.videoHeight;
          if (!(vw > 0 && vh > 0)) throw new Error("no frame");
          const scale = Math.max(tw / vw, cssH / vh);
          const dw = vw * scale;
          const dh = vh * scale;
          ctx.drawImage(probe, i * tw + (tw - dw) / 2, (cssH - dh) / 2, dw, dh);
        } catch (_) {
          ctx.fillStyle = "#1a2436";
          ctx.fillRect(i * tw, 0, tw, cssH);
        }
        if (filmLoading) filmLoading.textContent = `胶片预览 ${i + 1}/${n}`;
        await new Promise((r) => requestAnimationFrame(r));
      }
      if (pauseMain) {
        try {
          video.currentTime = clamp(wasTime, startSec, endKeepSec());
          await waitSeek(video);
          if (!wasPaused) video.play().catch(() => {});
        } catch (_) {}
      }
      if (gen !== filmGen) return;
      if (filmLoading) {
        filmLoading.hidden = true;
        filmLoading.textContent = "正在生成胶片预览…";
      }
      previewWrap?.classList.remove("is-film-loading");
      paintTimeline();
    }

    /** 仅贴两端磁吸；中间保持拖拽精确秒数（抬手再按 30fps 取整会往前跳几帧） */
    function snapEdgeOnly(t, which) {
      const next = clamp(t, 0, duration);
      if (which === "start") {
        if (next <= SNAP_EDGE_SEC) {
          if (next > 0) hapticLight();
          return 0;
        }
        return next;
      }
      if (next >= duration - SNAP_EDGE_SEC) {
        if (next < duration) hapticLight();
        return duration;
      }
      return next;
    }

    /** 毫秒对齐，避免浮点噪点；不改变用户拖到的画面 */
    function quantizeTrimSec(t) {
      return Math.round(clamp(t, 0, duration) * 1000) / 1000;
    }

    function setStart(t, { preview = true, immediateSeek = false } = {}) {
      const prev = startSec;
      startSec = clamp(t, 0, endSec - MIN_SPAN);
      activeHandle = "start";
      syncActiveHandleUi();
      clipCutoutsToWindow();
      const atMin = Math.abs(endSec - startSec - MIN_SPAN) < 0.02;
      timeline?.classList.toggle("is-min-span", atMin);
      if (atMin && Math.abs(prev - startSec) > 0.001) {
        timeline?.classList.add("is-pulse");
        hapticLight();
      }
      if (preview) previewSeek(startSec, { throttle: Boolean(drag) && !immediateSeek });
      paintTimeline();
      updateLabels();
    }

    function setEnd(t, { preview = true, immediateSeek = false } = {}) {
      const prev = endSec;
      endSec = clamp(t, startSec + MIN_SPAN, duration);
      activeHandle = "end";
      syncActiveHandleUi();
      clipCutoutsToWindow();
      const atMin = Math.abs(endSec - startSec - MIN_SPAN) < 0.02;
      timeline?.classList.toggle("is-min-span", atMin);
      if (atMin && Math.abs(prev - endSec) > 0.001) {
        timeline?.classList.add("is-pulse");
        hapticLight();
      }
      if (preview) previewSeek(endKeepSec(), { throttle: Boolean(drag) && !immediateSeek });
      paintTimeline();
      updateLabels();
    }

    function shiftWindow(deltaSec) {
      const span = endSec - startSec;
      let nextStart = startSec + deltaSec;
      nextStart = clamp(nextStart, 0, duration - span);
      startSec = nextStart;
      endSec = nextStart + span;
      previewSeek(startSec, { throttle: Boolean(drag) });
      paintTimeline();
      updateLabels();
    }

    async function finishTrimDrag() {
      if (!drag) return;
      const kind = drag.kind;
      // 抬手只用已提交的 start/end，再对齐到浏览器实际显示帧（防预览/成片偏差）
      if (kind === "start") {
        const want = quantizeTrimSec(snapEdgeOnly(startSec, "start"));
        startSec = want;
        try {
          video.pause();
        } catch (_) {}
        scrubSeekWanted = null;
        if (dragSeekTimer) {
          clearTimeout(dragSeekTimer);
          dragSeekTimer = 0;
        }
        try {
          video.currentTime = want;
        } catch (_) {}
        await waitSeek(video);
        // 解码器常落到稍后关键帧；以「用户实际看到的画面」为准，避免成片多吸前面几帧
        const shown = Number(video.currentTime) || want;
        startSec = quantizeTrimSec(clamp(Math.max(want, shown), 0, endSec - MIN_SPAN));
        clipCutoutsToWindow();
        previewSeek(startSec, { throttle: false });
        paintTimeline();
        updateLabels();
      } else if (kind === "end") {
        setEnd(quantizeTrimSec(snapEdgeOnly(endSec, "end")), {
          preview: true,
          immediateSeek: true,
        });
      } else if (kind === "window") {
        const span = Math.max(MIN_SPAN, endSec - startSec);
        startSec = quantizeTrimSec(snapEdgeOnly(startSec, "start"));
        endSec = clamp(startSec + span, startSec + MIN_SPAN, duration);
        endSec = quantizeTrimSec(snapEdgeOnly(endSec, "end"));
        if (endSec - startSec < MIN_SPAN) endSec = Math.min(duration, startSec + MIN_SPAN);
        clipCutoutsToWindow();
        previewSeek(startSec, { throttle: false });
        paintTimeline();
        updateLabels();
      } else if (kind === "cut-start" || kind === "cut-end") {
        clipCutoutsToWindow();
        paintCutouts();
        updateLabels();
      }
    }

    function ratioFromClientX(clientX) {
      const rect = timeline.getBoundingClientRect();
      return clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
    }

    function hitKind(ratio, target) {
      const cutHandle = target?.closest?.(".vtrim-cutout-handle");
      if (cutHandle && editMode === "cut") {
        const idx = Number(cutHandle.dataset.cutIndex);
        const edge = cutHandle.dataset.cutEdge === "end" ? "end" : "start";
        return { kind: edge === "end" ? "cut-end" : "cut-start", cutIndex: idx };
      }
      const cutBody = target?.closest?.(".vtrim-cutout");
      if (cutBody && editMode === "cut") {
        return { kind: "cut-select", cutIndex: Number(cutBody.dataset.cutIndex) };
      }
      if (editMode === "cut") {
        // 删中间：空白处只 scrub 进度；红段须点「添加删除段」创建
        return { kind: "seek" };
      }
      if (target === handleStart || target?.classList?.contains("vtrim-handle-start")) return { kind: "start" };
      if (target === handleEnd || target?.classList?.contains("vtrim-handle-end")) return { kind: "end" };
      if (target === windowEl || target?.classList?.contains("vtrim-window")) return { kind: "window" };
      const startR = startSec / duration;
      const endR = endSec / duration;
      const pxPad = 0.045;
      if (Math.abs(ratio - startR) <= pxPad) return { kind: "start" };
      if (Math.abs(ratio - endR) <= pxPad) return { kind: "end" };
      if (ratio < startR) return { kind: "start" };
      if (ratio > endR) return { kind: "end" };
      return { kind: "seek" };
    }

    async function seekPlayheadExact(t) {
      let target = clamp(t, startSec, endKeepSec());
      // 若落在删除段内，跳到下一段保留起点
      for (const c of normalizeCutoutsList(cutouts, startSec, endSec)) {
        if (target >= c.start - 0.001 && target < c.end) {
          target = clamp(c.end, startSec, endKeepSec());
          break;
        }
      }
      scrubSeekWanted = null;
      if (dragSeekTimer) {
        clearTimeout(dragSeekTimer);
        dragSeekTimer = 0;
      }
      try {
        video.pause();
      } catch (_) {}
      try {
        video.currentTime = target;
      } catch (_) {}
      await waitSeek(video);
      if ((Number(video.currentTime) || 0) < startSec - 0.001) {
        try {
          video.currentTime = startSec;
        } catch (_) {}
        await waitSeek(video);
      }
      return target;
    }

    function loopPlayToStart() {
      if (playWindowLooping) return;
      playWindowLooping = true;
      playWindowGen += 1;
      const gen = playWindowGen;
      try {
        video.pause();
      } catch (_) {}
      seekPlayheadExact(startSec)
        .then(() => {
          if (closed || gen !== playWindowGen) return;
          return video.play();
        })
        .catch(() => {})
        .finally(() => {
          if (gen === playWindowGen) playWindowLooping = false;
        });
    }

    function clipPlayWindow(mediaTime) {
      if (closed || !duration || video.paused || playWindowLooping || drag) return false;
      const cur = Number.isFinite(mediaTime) ? mediaTime : Number(video.currentTime) || 0;
      if (cur < startSec - 0.02) {
        loopPlayToStart();
        return true;
      }
      // 跳过删除段
      for (const c of normalizeCutoutsList(cutouts, startSec, endSec)) {
        if (cur >= c.start - 0.01 && cur < c.end - 0.001) {
          playWindowLooping = true;
          const gen = ++playWindowGen;
          seekPlayheadExact(c.end)
            .then(() => {
              if (closed || gen !== playWindowGen) return;
              playWindowLooping = false;
              return video.play();
            })
            .catch(() => {
              playWindowLooping = false;
            });
          return true;
        }
      }
      if (cur >= endKeepSec() - 0.0005) {
        loopPlayToStart();
        return true;
      }
      return false;
    }

    function armFrameWatch() {
      if (typeof video.requestVideoFrameCallback !== "function") return;
      const gen = playWindowGen;
      const onFrame = (_now, meta) => {
        if (closed || gen !== playWindowGen || video.paused || playWindowLooping) return;
        if (clipPlayWindow(Number(meta?.mediaTime))) return;
        try {
          video.requestVideoFrameCallback(onFrame);
        } catch (_) {}
      };
      try {
        video.requestVideoFrameCallback(onFrame);
      } catch (_) {}
    }

    async function togglePlay() {
      if (!video.src) return;
      if (video.paused) {
        const cur = Number(video.currentTime) || 0;
        const keep = endKeepSec();
        const needStart = cur < startSec - 0.01 || cur >= keep - 0.001 || Math.abs(cur - startSec) < 0.02;
        // 刚拖完片头时 currentTime≈startSec，仍强制精确 seek 再播，锁住用户拖到的位置
        playWindowLooping = false;
        await seekPlayheadExact(needStart ? startSec : cur);
        await video.play().catch(() => {});
      } else {
        playWindowGen += 1;
        video.pause();
      }
    }

    function getEditState() {
      const srcW = video.videoWidth || 1;
      const srcH = video.videoHeight || 1;
      const enabled = Boolean(cropEnable?.checked);
      const full =
        Math.abs(crop.x) < 2 &&
        Math.abs(crop.y) < 2 &&
        Math.abs(crop.w - srcW) < 2 &&
        Math.abs(crop.h - srcH) < 2;
      const cuts = normalizeCutoutsList(cutouts, startSec, endSec);
      return {
        // 片头半开：提交略晚于预览锁定帧，与片尾 END_KEEP 对称
        trimStart: quantizeTrimSec(startKeepSec()),
        trimEnd: quantizeTrimSec(endSec),
        cutouts: cuts.map((c) => ({
          start: quantizeTrimSec(c.start),
          end: quantizeTrimSec(c.end),
        })),
        cropOn: enabled && !full,
        crop: {
          x: Math.round(clamp(crop.x, 0, srcW)),
          y: Math.round(clamp(crop.y, 0, srcH)),
          w: Math.round(clamp(crop.w, 2, srcW)),
          h: Math.round(clamp(crop.h, 2, srcH)),
        },
      };
    }

    function cleanup() {
      if (closed) return;
      closed = true;
      filmGen += 1;
      playWindowGen += 1;
      playWindowLooping = false;
      cancelAnimationFrame(playheadRaf);
      cancelAnimationFrame(cropLiveRaf);
      try {
        video.pause();
      } catch (_) {}
      try {
        filmVideo.removeAttribute("src");
        filmVideo.load();
      } catch (_) {}
      filmVideo.remove();
      if (objectUrl) {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch (_) {}
        objectUrl = "";
      }
      unlockPageScroll();
      overlay.remove();
      window.removeEventListener("pointermove", onCropPointerMove);
      window.removeEventListener("pointerup", onCropPointerUp);
      window.removeEventListener("pointercancel", onCropPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    }

    function finish(ok) {
      if (settled) return;
      settled = true;
      const edit = ok ? getEditState() : null;
      cleanup();
      if (ok) {
        try {
          opts.onComplete?.(edit);
        } catch (_) {}
      } else {
        try {
          opts.onCancel?.();
        } catch (_) {}
      }
      try {
        resolveOpen?.(edit);
      } catch (_) {}
      resolveOpen = null;
    }

    function onKeyDown(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
      }
    }

    let resizeFilmTimer = 0;
    function onResize() {
      layoutCropBox();
      if (duration) {
        clearTimeout(resizeFilmTimer);
        resizeFilmTimer = setTimeout(() => buildFilmstrip().catch(() => {}), 180);
      }
    }

    // --- events ---
    overlay.querySelectorAll("[data-vte-mode]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const m = btn.dataset.vteMode;
        editMode = m === "crop" || m === "cut" || m === "trim" ? m : "crop";
        syncModeUi();
        layoutCropBox();
      });
    });
    overlay.querySelectorAll("[data-vte-aspect]").forEach((btn) => {
      btn.addEventListener("click", () => {
        aspect = btn.dataset.vteAspect || "free";
        syncAspectUi();
        if (cropEnable && !cropEnable.checked) cropEnable.checked = true;
        if (editMode !== "crop") {
          editMode = "crop";
          syncModeUi();
        }
        syncCropBoxVisibility();
        fitCropToAspect();
      });
    });
    cropEnable?.addEventListener("change", () => {
      syncCropBoxVisibility();
      layoutCropBox();
    });
    cropResetBtn?.addEventListener("click", () => {
      fitCropToAspect();
      toast("已重置裁剪框");
    });
    function bindNudgeHold(btn, stepFn) {
      if (!btn) return;
      let holdTimer = 0;
      let holdRepeat = 0;
      const clearHold = () => {
        if (holdTimer) {
          clearTimeout(holdTimer);
          holdTimer = 0;
        }
        if (holdRepeat) {
          clearInterval(holdRepeat);
          holdRepeat = 0;
        }
      };
      const fire = () => {
        stepFn();
      };
      btn.addEventListener("pointerdown", (e) => {
        if (e.button != null && e.button !== 0) return;
        e.preventDefault();
        try {
          btn.setPointerCapture?.(e.pointerId);
        } catch (_) {}
        fire();
        clearHold();
        holdTimer = window.setTimeout(() => {
          holdTimer = 0;
          holdRepeat = window.setInterval(fire, 70);
        }, 280);
      });
      btn.addEventListener("pointerup", clearHold);
      btn.addEventListener("pointercancel", clearHold);
      btn.addEventListener("lostpointercapture", clearHold);
      // 避免 click 再触发一次
      btn.addEventListener("click", (e) => e.preventDefault());
    }
    bindNudgeHold($("nudge-start-m"), () => setStart(startSec - 0.1, { immediateSeek: true }));
    bindNudgeHold($("nudge-start-p"), () => setStart(startSec + 0.1, { immediateSeek: true }));
    bindNudgeHold($("nudge-end-m"), () => setEnd(endSec - 0.1, { immediateSeek: true }));
    bindNudgeHold($("nudge-end-p"), () => setEnd(endSec + 0.1, { immediateSeek: true }));
    cutAddBtn?.addEventListener("click", () => addCutoutAtPlayhead());
    cutDelBtn?.addEventListener("click", () => deleteSelectedCutout());
    cutClearBtn?.addEventListener("click", () => {
      clearAllCutouts();
      toast("已清空删除段");
    });
    playBtn?.addEventListener("click", () => togglePlay().catch(() => {}));
    muteBtn?.addEventListener("click", () => {
      muted = !muted;
      syncMuteUi();
    });
    $("close")?.addEventListener("click", () => finish(false));
    $("done")?.addEventListener("click", () => finish(true));

    function onTimelinePointerDown(e) {
      if (!duration) return;
      try {
        video.pause();
      } catch (_) {}
      const ratio = ratioFromClientX(e.clientX);
      const t = ratio * duration;
      const hit = hitKind(ratio, e.target);
      const kind = hit.kind;
      timeline?.classList.add("is-dragging");
      if (kind === "start") {
        drag = { kind: "start", pointerId: e.pointerId };
        handleStart?.setPointerCapture?.(e.pointerId);
        setStart(t);
      } else if (kind === "end") {
        drag = { kind: "end", pointerId: e.pointerId };
        handleEnd?.setPointerCapture?.(e.pointerId);
        setEnd(t);
      } else if (kind === "window") {
        drag = {
          kind: "window",
          pointerId: e.pointerId,
          originX: e.clientX,
          originStart: startSec,
          originEnd: endSec,
        };
        timeline?.classList.add("is-dragging-window");
        windowEl?.setPointerCapture?.(e.pointerId);
        syncHandleTips();
      } else if (kind === "cut-select") {
        selectedCutout = Number(hit.cutIndex) || 0;
        syncCutoutUi();
        drag = null;
        timeline?.classList.remove("is-dragging");
      } else if (kind === "cut-start" || kind === "cut-end") {
        selectedCutout = Number(hit.cutIndex) || 0;
        drag = { kind, pointerId: e.pointerId, cutIndex: selectedCutout };
        timeline?.setPointerCapture?.(e.pointerId);
        setCutoutEdge(selectedCutout, kind === "cut-end" ? "end" : "start", t);
      } else {
        previewSeek(clamp(t, startSec, endKeepSec()));
        drag = { kind: "seek", pointerId: e.pointerId };
      }
      e.preventDefault();
    }
    function onTimelinePointerMove(e) {
      if (!drag || drag.pointerId !== e.pointerId) return;
      if (drag.kind === "window") {
        const rect = timeline.getBoundingClientRect();
        const deltaSec = ((e.clientX - drag.originX) / Math.max(1, rect.width)) * duration;
        startSec = drag.originStart;
        endSec = drag.originEnd;
        shiftWindow(deltaSec);
        syncHandleTips();
        return;
      }
      const t = ratioFromClientX(e.clientX) * duration;
      if (drag.kind === "start") setStart(t);
      else if (drag.kind === "end") setEnd(t);
      else if (drag.kind === "cut-start" || drag.kind === "cut-end") {
        setCutoutEdge(drag.cutIndex, drag.kind === "cut-end" ? "end" : "start", t);
      } else previewSeek(clamp(t, startSec, endKeepSec()));
    }
    function onTimelinePointerUp(e) {
      if (!drag || drag.pointerId !== e.pointerId) return;
      const finishing = finishTrimDrag();
      timeline?.classList.remove("is-dragging-window", "is-dragging");
      drag = null;
      syncHandleTips();
      e.preventDefault();
      Promise.resolve(finishing).catch(() => {});
    }
    timeline?.addEventListener("pointerdown", onTimelinePointerDown);
    timeline?.addEventListener("pointermove", onTimelinePointerMove);
    timeline?.addEventListener("pointerup", onTimelinePointerUp);
    timeline?.addEventListener("pointercancel", onTimelinePointerUp);
    timeline?.addEventListener("animationend", () => timeline.classList.remove("is-pulse"));

    function onCropPointerDown(e) {
      if (cropBox?.hidden) return;
      const handle = e.target?.closest?.("[data-vte-handle]");
      const geom = videoContentRect();
      const d = cropToDisplayRect();
      cropDrag = {
        pointerId: e.pointerId,
        handle: handle?.dataset?.vteHandle || "move",
        startX: e.clientX,
        startY: e.clientY,
        box: { ...d },
        geom,
      };
      cropBox.setPointerCapture?.(e.pointerId);
      previewWrap?.classList.add("is-dragging");
      e.preventDefault();
      e.stopPropagation();
    }
    function onCropPointerMove(e) {
      if (!cropDrag || cropDrag.pointerId !== e.pointerId) return;
      const { geom, box, handle } = cropDrag;
      const dx = (e.clientX - cropDrag.startX) / geom.scale;
      const dy = (e.clientY - cropDrag.startY) / geom.scale;
      let x = box.x;
      let y = box.y;
      let w = box.w;
      let h = box.h;
      const ratio = parseAspect(aspect);
      const minSide = 16;
      if (handle === "move") {
        x = clamp(box.x + dx, 0, box.dw - w);
        y = clamp(box.y + dy, 0, box.dh - h);
      } else {
        if (handle.includes("w")) {
          const nx = clamp(box.x + dx, 0, box.x + box.w - minSide);
          w = box.x + box.w - nx;
          x = nx;
        }
        if (handle.includes("e")) w = clamp(box.w + dx, minSide, box.dw - box.x);
        if (handle.includes("n")) {
          const ny = clamp(box.y + dy, 0, box.y + box.h - minSide);
          h = box.y + box.h - ny;
          y = ny;
        }
        if (handle.includes("s")) h = clamp(box.h + dy, minSide, box.dh - box.y);
        if (ratio) {
          if (handle === "n" || handle === "s") w = h * ratio;
          else h = w / ratio;
          if (x + w > box.dw) {
            w = box.dw - x;
            h = w / ratio;
          }
          if (y + h > box.dh) {
            h = box.dh - y;
            w = h * ratio;
          }
        }
        x = clamp(x, 0, box.dw - w);
        y = clamp(y, 0, box.dh - h);
      }
      displayRectToCrop(x, y, w, h);
      layoutCropBox();
    }
    function onCropPointerUp(e) {
      if (!cropDrag || cropDrag.pointerId !== e.pointerId) return;
      cropDrag = null;
      previewWrap?.classList.remove("is-dragging");
    }
    cropBox?.addEventListener("pointerdown", onCropPointerDown);
    cropBox?.addEventListener("dblclick", (e) => {
      e.preventDefault();
      fitCropToAspect();
      toast("已重置裁剪框");
    });
    window.addEventListener("pointermove", onCropPointerMove);
    window.addEventListener("pointerup", onCropPointerUp);
    window.addEventListener("pointercancel", onCropPointerUp);

    previewWrap?.addEventListener("pointerdown", (e) => {
      // 拖绿框/把手时不触发播放切换；点按再 toggle，左右滑才 scrub
      if (!duration || e.target?.closest?.(".vtrim-crop-box")) return;
      previewScrub = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startT: video.currentTime || startSec,
        moved: false,
      };
      previewWrap.setPointerCapture?.(e.pointerId);
    });
    previewWrap?.addEventListener("pointermove", (e) => {
      if (!previewScrub || previewScrub.pointerId !== e.pointerId) return;
      const dx = e.clientX - previewScrub.startX;
      if (Math.abs(dx) > 8) {
        if (!previewScrub.moved) {
          previewScrub.moved = true;
          try {
            video.pause();
          } catch (_) {}
        }
      }
      if (!previewScrub.moved) return;
      const geom = previewWrap.getBoundingClientRect();
      const span = Math.max(MIN_SPAN, endSec - startSec);
      const delta = (dx / Math.max(1, geom.width)) * span;
      const target = clamp(previewScrub.startT + delta, startSec, endKeepSec());
      scrubSeekWanted = target;
      pumpPreviewScrubSeek();
    });
    previewWrap?.addEventListener("pointerup", (e) => {
      if (!previewScrub || previewScrub.pointerId !== e.pointerId) return;
      const wasMove = previewScrub.moved;
      previewScrub = null;
      if (!wasMove) togglePlay().catch(() => {});
    });
    previewWrap?.addEventListener("pointercancel", () => {
      previewScrub = null;
    });

    function tickPlayhead() {
      if (closed) {
        playheadRaf = 0;
        return;
      }
      clipPlayWindow();
      paintTimeline();
      updateLabels();
      if (!video.paused) playheadRaf = requestAnimationFrame(tickPlayhead);
      else playheadRaf = 0;
    }
    video.addEventListener("timeupdate", () => {
      if (!duration) return;
      if (clipPlayWindow()) {
        scheduleCropLive();
        return;
      }
      if (!playheadRaf) {
        paintTimeline();
        updateLabels();
      }
      scheduleCropLive();
    });
    video.addEventListener("pause", () => {
      if (playBtn) playBtn.textContent = "播放";
      previewWrap?.classList.remove("is-playing");
      if (playheadRaf) {
        cancelAnimationFrame(playheadRaf);
        playheadRaf = 0;
      }
      paintTimeline();
    });
    video.addEventListener("play", () => {
      if (playBtn) playBtn.textContent = "暂停";
      previewWrap?.classList.add("is-playing");
      armFrameWatch();
      if (!playheadRaf) playheadRaf = requestAnimationFrame(tickPlayhead);
    });

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);

    // load file
    objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    video.muted = true;
    if (tapPlay) tapPlay.hidden = false;

    return new Promise((resolve, reject) => {
      resolveOpen = resolve;
      const onMeta = () => {
        video.removeEventListener("loadedmetadata", onMeta);
        video.removeEventListener("error", onErr);
        duration = Number(video.duration) || 0;
        const srcW = video.videoWidth || 1;
        const srcH = video.videoHeight || 1;
        const initial = opts.initial || {};
        startSec = clamp(Number(initial.trimStart) || 0, 0, Math.max(0, duration - MIN_SPAN));
        endSec = clamp(Number(initial.trimEnd) || duration, startSec + MIN_SPAN, duration || MIN_SPAN);
        cutouts = normalizeCutoutsList(initial.cutouts || [], startSec, endSec);
        selectedCutout = -1;
        if (initial.crop && initial.cropOn) {
          crop = {
            x: Number(initial.crop.x) || 0,
            y: Number(initial.crop.y) || 0,
            w: Number(initial.crop.w) || srcW,
            h: Number(initial.crop.h) || srcH,
          };
          if (cropEnable) cropEnable.checked = true;
        } else {
          crop = { x: 0, y: 0, w: srcW, h: srcH };
          // 默认显示裁剪框（自由=整幅）；用户缩框后才真正 cropOn
          if (cropEnable) cropEnable.checked = initial.cropOn !== false;
        }
        syncMuteUi();
        syncAspectUi();
        syncModeUi();
        previewSeek(startSec);
        paintTimeline();
        updateLabels();
        layoutCropBox();
        buildFilmstrip().catch(() => {});
        // 手机 focus 完成按钮会连带把底层页滚一下；触控设备不抢焦点
        const coarse =
          typeof window.matchMedia === "function" &&
          window.matchMedia("(hover: none), (pointer: coarse)").matches;
        if (!coarse) {
          try {
            $("done")?.focus?.({ preventScroll: true });
          } catch (_) {}
        }
      };
      const onErr = () => {
        video.removeEventListener("loadedmetadata", onMeta);
        video.removeEventListener("error", onErr);
        cleanup();
        resolveOpen = null;
        reject(new Error("无法读取该视频"));
      };
      video.addEventListener("loadedmetadata", onMeta);
      video.addEventListener("error", onErr);
    });
  }

  function normalizeCutouts(list, trimStart, trimEnd) {
    const a = Math.max(0, Number(trimStart) || 0);
    const b = Math.max(a + MIN_SPAN, Number(trimEnd) || 0);
    const raw = (Array.isArray(list) ? list : [])
      .map((c) => ({
        start: Math.max(a, Number(c?.start) || 0),
        end: Math.min(b, Number(c?.end) || 0),
      }))
      .filter((c) => c.end - c.start >= MIN_CUTOUT)
      .sort((x, y) => x.start - y.start);
    const merged = [];
    for (const c of raw) {
      const last = merged[merged.length - 1];
      if (last && c.start <= last.end + 0.02) last.end = Math.max(last.end, c.end);
      else merged.push({ start: c.start, end: c.end });
    }
    return merged;
  }

  function keepRangesFromEdit(edit, duration) {
    const d = Math.max(0, Number(duration) || 0);
    const trimStart = Math.max(0, Number(edit?.trimStart) || 0);
    const trimEnd = Math.min(d, Math.max(trimStart + MIN_SPAN, Number(edit?.trimEnd) || d));
    const cuts = normalizeCutouts(edit?.cutouts, trimStart, trimEnd);
    const keeps = [];
    let cursor = trimStart;
    for (const c of cuts) {
      if (c.start > cursor + 0.04) keeps.push({ start: cursor, end: c.start });
      cursor = Math.max(cursor, c.end);
    }
    if (trimEnd > cursor + 0.04) keeps.push({ start: cursor, end: trimEnd });
    if (!keeps.length) keeps.push({ start: trimStart, end: trimEnd });
    return keeps;
  }

  window.DevToolsVtrimEditor = {
    open: openEditor,
    ensureCss: ensureVtrimCss,
    normalizeCutouts,
    keepRangesFromEdit,
  };
})();
