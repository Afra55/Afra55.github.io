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
  /** 片头/片尾/红段边磁吸半径；过大易在抬手时「跳一下」 */
  const SNAP_EDGE_SEC = 0.08;
  /**
   * 手机送手抖动：抬手瞬间触点常再偏一点。
   * 用抬手前约 LIFT_LAG_MS 的位置定黄/红柄，再对齐解码器所见帧。
   */
  const LIFT_LAG_MS = 55;
  /** 拿不到片源 fps 时的回退帧率 */
  const DEFAULT_FRAME_FPS = 30;
  /** 默认帧格（约 30fps）；编辑器内会按真实源 fps 覆盖 */
  const FRAME_SNAP_SEC = 1 / DEFAULT_FRAME_FPS;

  /**
   * 规整片源帧率：贴近常见档（24/25/30/60…），异常值丢弃。
   * @param {number} raw
   * @returns {number} 0=不可用
   */
  function normalizeSourceFps(raw) {
    const f = Number(raw) || 0;
    if (!(f >= 5 && f <= 120)) return 0;
    if (f >= 23.5 && f < 24.5) return 24;
    if (f >= 24.5 && f <= 25.8) return 25;
    if (f >= 29.2 && f <= 30.8) return 30;
    if (f >= 49.5 && f <= 50.5) return 50;
    if (f >= 59 && f <= 61) return 60;
    if (Math.abs(f - 12.5) <= 0.35) return 12.5;
    if (Math.abs(f - 15) <= 0.4) return 15;
    if (Math.abs(f - 20) <= 0.4) return 20;
    if (Math.abs(f - 12) <= 0.35) return 12;
    return Math.round(f * 1000) / 1000;
  }

  /** 用相邻 mediaTime 中位数估 fps，避免 (n-1)/span 把 24 估成 30 */
  function estimateFpsFromMediaTimes(times) {
    const arr = Array.isArray(times) ? times.map((t) => Number(t) || 0).filter((t) => t >= 0) : [];
    if (arr.length < 3) return 0;
    const deltas = [];
    for (let i = 1; i < arr.length; i++) {
      const d = arr[i] - arr[i - 1];
      if (d > 0.008 && d < 0.28) deltas.push(d);
    }
    let est = 0;
    if (deltas.length >= 2) {
      deltas.sort((a, b) => a - b);
      const med = deltas[Math.floor(deltas.length / 2)];
      if (med > 0) est = 1 / med;
    } else {
      const spanT = arr[arr.length - 1] - arr[0];
      if (spanT > 0.15) est = (arr.length - 1) / spanT;
    }
    return normalizeSourceFps(est) || (est >= 5 && est <= 120 ? Math.round(est) : 0);
  }

  /** @param {number} fps @returns {number} 单帧秒数 */
  function frameSnapSecFromFps(fps) {
    const f = normalizeSourceFps(fps) || DEFAULT_FRAME_FPS;
    return 1 / f;
  }
  /** 拖拽中预览 seek 节流（ms），对齐系统相册：手势跟手、画面稍后跟上 */
  const DRAG_SEEK_MS = 72;
  /** 半开片尾兜底（约 1 帧 @25fps）；有片源 fps 时用 1/fps */
  const END_KEEP_SEC = 1 / 25;
  /**
   * 删段后下一段片头半开兜底；有片源 fps 时随 endKeep 收紧。
   * 不做「再多删几帧」——拖到哪一帧，预览/GIF 就对准哪一帧。
   */
  const START_KEEP_SEC = 1 / 50;

  /** 按片源 fps 取半开片尾；无有效 fps 回退 max(1/25, 1/30)，与编辑器 endKeepStepSec 一致 */
  function resolveEndKeepSec(editOrFps) {
    const fps =
      editOrFps && typeof editOrFps === "object"
        ? Number(editOrFps.srcFps) || 0
        : Number(editOrFps) || 0;
    const n = normalizeSourceFps(fps);
    if (n >= 5) return 1 / n;
    return Math.max(END_KEEP_SEC, FRAME_SNAP_SEC);
  }

  function resolveStartKeepSec(editOrFps) {
    const endKeep = resolveEndKeepSec(editOrFps);
    return Math.min(START_KEEP_SEC, endKeep * 0.5);
  }
  /**
   * @deprecated 根因已改为源帧半开窗，预览≡成片不再叠接点垫；保留 0 兼容旧读取。
   */
  const ENCODE_CUT_JUNCTION_PAD_FRAMES = 0;
  /** @deprecated 全局黄柄垫已取消；保留 0 以免旧调用/测试读字段报错 */
  const ENCODE_BOUND_PAD_SEC = 0;

  /** keep / 预览 / 成片共用的源帧时钟（永远 >0） */
  function resolveKeepFps(editOrFps) {
    const raw =
      editOrFps && typeof editOrFps === "object"
        ? Number(editOrFps.srcFps) || 0
        : Number(editOrFps) || 0;
    return normalizeSourceFps(raw) || DEFAULT_FRAME_FPS;
  }

  function secToFrame(sec, fps) {
    const f = Math.max(1, Number(fps) || DEFAULT_FRAME_FPS);
    return Math.round(Math.max(0, Number(sec) || 0) * f);
  }

  function frameToSec(frame, fps) {
    const f = Math.max(1, Number(fps) || DEFAULT_FRAME_FPS);
    return Math.max(0, Math.round(Number(frame) || 0)) / f;
  }

  /**
   * Chrome 在时刻 t 显示的源帧号（CFR 近似：pts[k]=k/fps）。
   * 规则与实测一致：last k where round(pts*1e6) <= floor(t*1e6)。
   * 手柄常被量化到毫秒（如 31/30→1.033），round(t*fps) 会得到 31，但 Chrome 仍显示 30——
   * keep/导出必须用本函数，否则「预览对、导出偏一帧」。
   */
  function displayFrameAtSec(sec, fps) {
    const f = Math.max(1, Number(fps) || DEFAULT_FRAME_FPS);
    const t = Math.max(0, Number(sec) || 0);
    const targetUs = Math.floor(t * 1e6 + 1e-7);
    // 与 Chrome 一致：last k where round((k/f)*1e6) <= floor(t*1e6)（CFR pts=k/f）
    let lo = 0;
    let hi = Math.max(0, Math.ceil(t * f) + 4);
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (Math.round((mid / f) * 1e6) <= targetUs) lo = mid;
      else hi = mid - 1;
    }
    return Math.max(0, lo);
  }

  /** seek 落到「该手柄时刻 Chrome 所见帧」的 PTS 之后 0.1ms，避免停在 k−1 */
  const DISPLAY_SEEK_EPS = 1e-4;
  function displaySeekSec(sec, fps) {
    const f = normalizeSourceFps(fps) || DEFAULT_FRAME_FPS;
    return frameToSec(displayFrameAtSec(sec, f), f) + DISPLAY_SEEK_EPS;
  }
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
    // 相对 tools/ 根解析，避免 pathname 丢失站点前缀或错误 base
    const base = new URL(".", document.baseURI || window.location.href);
    // 若当前页在 /tools/mdread/ 等子路径，退回到 /tools/
    const toolsBase = /\/tools\//.test(base.pathname)
      ? new URL(base.pathname.replace(/\/tools\/.*$/, "/tools/"), base.origin)
      : base;
    const url = new URL("styles/panels/vtrim.css", toolsBase);
    if (build) url.searchParams.set("v", build);
    link.href = url.href;
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
    </header>
    <div class="vtrim-editor-body">
      <div class="vtrim-stage is-mode-trim" id="${p("stage")}">
        <div class="vtrim-preview-wrap" id="${p("preview-wrap")}">
          <video id="${p("video")}" class="vtrim-video" playsinline muted preload="metadata"></video>
          <!-- 预览中间不再叠播放钮：底部已有播放/暂停，避免手机重复 -->
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
          <div class="btn-row tool-actions vtrim-nudge" id="${p("trim-nudge")}" aria-label="微调（可长按）">
            <button type="button" class="ghost-btn" id="${p("nudge-start-m")}" data-nudge-role="start-m" title="片头 −1 源帧，可长按">片头−</button>
            <button type="button" class="ghost-btn" id="${p("nudge-start-p")}" data-nudge-role="start-p" title="片头 +1 源帧，可长按">片头+</button>
            <button type="button" class="ghost-btn" id="${p("nudge-end-m")}" data-nudge-role="end-m" title="片尾 −1 源帧，可长按">片尾−</button>
            <button type="button" class="ghost-btn" id="${p("nudge-end-p")}" data-nudge-role="end-p" title="片尾 +1 源帧，可长按">片尾+</button>
          </div>
          <p class="hint tight vtrim-cut-nudge-label" id="${p("cut-nudge-label")}" hidden>点选红段后，用上方片头/片尾按钮按源帧 ±1 精调</p>
          <div class="vtrim-cut-panel" id="${p("cut-panel")}" hidden>
            <div class="btn-row tool-actions vtrim-cut-tools" id="${p("cut-tools")}" aria-label="删中间">
              <button type="button" class="secondary-btn" id="${p("cut-add")}" title="从进度条当前位置起添加删除区（当前帧=删除起点；红柄两端所见帧都会删）">添加删除段</button>
              <button type="button" class="secondary-btn" id="${p("cut-play-join")}" title="跳到删段接点前（不自动播放），再点底部播放核对">跳到接点</button>
              <button type="button" class="ghost-btn" id="${p("cut-del")}" title="删除当前选中的删除段" disabled>删选中段</button>
              <button type="button" class="ghost-btn" id="${p("cut-clear")}" title="清空全部删除段">清空</button>
            </div>
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
      <div class="vtrim-export-progress" id="${p("export-progress")}" hidden>
        <div class="vtrim-export-progress-head">
          <p class="hint vtrim-export-progress-text" id="${p("export-text")}">正在导出…</p>
          <span class="mono vtrim-export-progress-pct" id="${p("export-pct")}">0%</span>
        </div>
        <div class="vtrim-export-progress-track" aria-hidden="true"><span class="vtrim-export-progress-fill" id="${p("export-fill")}"></span></div>
      </div>
      <p class="hint tight vtrim-export-status" id="${p("export-status")}" hidden></p>
      <button type="button" class="ghost-btn" id="${p("close")}">关闭</button>
      <button type="button" class="secondary-btn" id="${p("download")}" title="导出修剪+删中间后的 MP4（不是 GIF）">下载编辑后的视频</button>
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
    const cutPanel = $("cut-panel");
    const cutTools = $("cut-tools");
    const cutNudgeLabel = $("cut-nudge-label");
    const cutAddBtn = $("cut-add");
    const cutPlayJoinBtn = $("cut-play-join");
    const cutDelBtn = $("cut-del");
    const cutClearBtn = $("cut-clear");
    const nudgeStartM = $("nudge-start-m");
    const nudgeStartP = $("nudge-start-p");
    const nudgeEndM = $("nudge-end-m");
    const nudgeEndP = $("nudge-end-p");
    const sharedNudgeBtns = [nudgeStartM, nudgeStartP, nudgeEndM, nudgeEndP].filter(Boolean);
    const coarseUi = () => {
      try {
        return window.matchMedia("(pointer: coarse), (max-width: 640px)").matches;
      } catch (_) {
        return true;
      }
    };
    const downloadBtn = $("download");
    const exportProgress = $("export-progress");
    const exportFill = $("export-fill");
    const exportText = $("export-text");
    const exportPct = $("export-pct");
    const exportStatus = $("export-status");

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
    /** 松手帧格：默认 30fps，打开后按片源真实 fps 更新 */
    let sourceFps = DEFAULT_FRAME_FPS;
    /** @type {null|{fps:number,fpsRaw?:number,sampleCount?:number,ctsSec?:Float64Array,hasCtts?:boolean,elstMediaTime?:number}} */
    let sourceTimeline = null;
    let frameSnapSec = FRAME_SNAP_SEC;
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
    /** 松手后短暂保留黄/红柄时间戳，方便确认吸附落点 */
    let tipHoldTimer = 0;
    let tipHoldKind = "";
    let playheadRaf = 0;
    let playWindowGen = 0;
    let playWindowLooping = false;
    /** 最近一帧 rVFC 已呈现的 mediaTime；currentTime 常滞后于画面，截断必须跟已绘帧 */
    let lastPresentedMediaTime = NaN;
    /**
     * 片尾±/抬手停帧的实际 currentTime。播放硬闸钉在此点（≡所见），
     * 不单靠 endKeepSec()——量化/fps 抖动会让理论 park 比画面多出约 0.1s。
     */
    let endParkAtSec = NaN;
    /** 切断后冻结时钟，避免 pause 前 currentTime 已越过停帧把 UI 刷成多 0.1s */
    let freezeClockSec = NaN;
    /** 按 rVFC 剩余时间预约 pause，弥补采样间隔导致的晚切 */
    let parkCutTimer = 0;
    let cropLiveRaf = 0;
    let filmGen = 0;
    let closed = false;
    let settled = false;
    /** @type {((v: any) => void) | null} */
    let resolveOpen = null;

    const fileName = String(opts.title || file.name || "视频");
    if (titleEl) titleEl.textContent = `编辑 · ${fileName}`;
    if (subEl) {
      subEl.textContent = "";
      subEl.hidden = true;
    }

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
      // 修剪 / 删中间共用时间轴下方同一排 ±1 源帧按钮（手机不用往下翻）
      if (trimNudge) trimNudge.hidden = !(editMode === "trim" || editMode === "cut");
      if (cutPanel) cutPanel.hidden = editMode !== "cut";
      if (cutTools) cutTools.hidden = editMode !== "cut";
      if (cutNudgeLabel) cutNudgeLabel.hidden = editMode !== "cut";
      syncSharedNudgeLabels();
      if (modeHint) {
        const phone = coarseUi();
        // 修剪模式不再占位说明；裁切/删中间仍给一句操作提示
        modeHint.textContent =
          editMode === "crop"
            ? phone
              ? "拖绿框裁切 · 双击重置"
              : "拖绿框 · 双击重置 · 空格播放"
            : editMode === "cut"
              ? phone
                ? "拖红柄看该帧 · 起点/终点 ±1 帧 · 「跳到接点」"
                : "拖红柄 · 起点/终点 ±1 帧 · 「跳到接点」核对"
              : "";
        modeHint.hidden = !modeHint.textContent;
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

    /** 微调一步时长（无时间轴时）：1 源帧 */
    function nudgeStepSec() {
      return Math.max(1 / 240, endKeepStepSec());
    }

    /**
     * 微调落到相邻成片采样 CTS（有 stts 时）；否则 ±1/fps。
     * 点一下必须换一帧：夹在两采样之间时 − 也至少退一格，避免「点没反应、长按才动」。
     * @param {number} cur
     * @param {number} dir  +1 / -1
     */
    function nudgeEncodeSec(cur, dir) {
      const sign = dir < 0 ? -1 : 1;
      const raw = clamp(Number(cur) || 0, 0, duration);
      const tl = sourceTimeline;
      const api = window.DevToolsMp4Timeline;
      if (tl?.ctsSec?.length && typeof api?.sampleIndexAtSec === "function") {
        const n = tl.ctsSec.length;
        let idx = api.sampleIndexAtSec(tl, raw);
        if (sign > 0) {
          idx = Math.min(n - 1, idx + 1);
        } else {
          // 在采样点上 / 两帧之间：都退到上一采样，保证画面必变
          idx = Math.max(0, idx - 1);
        }
        const t = Number(tl.ctsSec[idx]);
        if (Number.isFinite(t) && Math.abs(t - raw) > 1e-7) return clamp(t, 0, duration);
        // 已顶到边界仍同值时再尝试一格
        const j = Math.max(0, Math.min(n - 1, idx + sign));
        const t2 = Number(tl.ctsSec[j]);
        if (Number.isFinite(t2)) return clamp(t2, 0, duration);
      }
      return clamp(raw + sign * nudgeStepSec(), 0, duration);
    }

    /**
     * 片头/片尾按 keep 半开窗 ±1 采样（根因：片尾是 exclusive，只挪黄柄可能末帧不变）。
     * @param {"start"|"end"} edge
     * @param {number} dir +1 / -1
     */
    function nudgeTrimEdgeSec(edge, dir) {
      const sign = dir < 0 ? -1 : 1;
      const tl = sourceTimeline;
      const api = window.DevToolsMp4Timeline;
      if (tl?.ctsSec?.length && typeof api?.sampleRangeForKeep === "function") {
        const n = tl.ctsSec.length;
        const fr = api.sampleRangeForKeep(tl, startSec, endSec);
        if (fr) {
          if (edge === "end") {
            let endF = Math.round(Number(fr.endF) || 0);
            const minF = Math.round(Number(fr.startF) || 0) + 1;
            endF = Math.max(minF, Math.min(n, endF + sign));
            if (endF >= n) return duration;
            const t = Number(tl.ctsSec[endF]);
            if (Number.isFinite(t)) return clamp(t, startSec + MIN_SPAN, duration);
          } else {
            let startF = Math.round(Number(fr.startF) || 0);
            const maxF = Math.max(0, Math.round(Number(fr.endF) || 1) - 1);
            startF = Math.max(0, Math.min(maxF, startF + sign));
            const t = Number(tl.ctsSec[startF]);
            if (Number.isFinite(t)) return clamp(t, 0, endSec - MIN_SPAN);
          }
        }
      }
      return nudgeEncodeSec(edge === "end" ? endSec : startSec, sign);
    }

    /** 同一排按钮：修剪=片头/片尾；删中间=红段起点/终点 */
    function syncSharedNudgeLabels() {
      const cut = editMode === "cut";
      const map = cut
        ? {
            "start-m": { text: "起点−", title: "红段起点 −1 源帧，可长按" },
            "start-p": { text: "起点+", title: "红段起点 +1 源帧，可长按" },
            "end-m": { text: "终点−", title: "红段终点 −1 源帧，可长按" },
            "end-p": { text: "终点+", title: "红段终点 +1 源帧，可长按" },
          }
        : {
            "start-m": { text: "片头−", title: "片头 −1 源帧，可长按" },
            "start-p": { text: "片头+", title: "片头 +1 源帧，可长按" },
            "end-m": { text: "片尾−", title: "片尾 −1 源帧，可长按" },
            "end-p": { text: "片尾+", title: "片尾 +1 源帧，可长按" },
          };
      for (const btn of sharedNudgeBtns) {
        const role = btn.dataset.nudgeRole || "";
        const conf = map[role];
        if (!conf) continue;
        btn.textContent = conf.text;
        btn.title = conf.title;
      }
      if (trimNudge) {
        trimNudge.setAttribute("aria-label", cut ? "微调红段（可长按）" : "微调时长（可长按）");
        trimNudge.classList.toggle("is-cut-nudge", cut);
      }
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

    /**
     * 拖拽预览 / 点播放 / 成片：同一套 keep（必须带 srcFps，半开才与 endKeepStepSec 一致）。
     */
    function keepRangesLocal() {
      return keepRangesForEncode(
        { trimStart: startSec, trimEnd: endSec, cutouts, srcFps: sourceFps },
        duration || endSec,
        sourceTimeline
      );
    }

    function clipCutoutsToWindow() {
      cutouts = normalizeCutoutsList(cutouts, startSec, endSec);
      if (selectedCutout >= cutouts.length) selectedCutout = cutouts.length ? cutouts.length - 1 : -1;
    }

    function syncCutoutUi() {
      const inCut = editMode === "cut";
      const hasSel = inCut && selectedCutout >= 0 && selectedCutout < cutouts.length;
      if (cutDelBtn) cutDelBtn.disabled = !hasSel;
      // 删中间时：未选中红段则禁用共用 ± 按钮；修剪模式始终可用
      if (inCut) {
        for (const btn of sharedNudgeBtns) btn.disabled = !hasSel;
      } else if (editMode === "trim") {
        for (const btn of sharedNudgeBtns) btn.disabled = false;
      }
      if (cutNudgeLabel) {
        if (!inCut) {
          cutNudgeLabel.hidden = true;
        } else if (!hasSel) {
          cutNudgeLabel.hidden = false;
          cutNudgeLabel.textContent =
            cutouts.length > 0
              ? `已有 ${cutouts.length} 段 · 点选红段后，用上方起点/终点 ±1 帧`
              : "点选红段后，用上方起点/终点 ±1 帧精调";
        } else {
          cutNudgeLabel.hidden = false;
          const c = cutouts[selectedCutout];
          cutNudgeLabel.textContent = `第 ${selectedCutout + 1}/${cutouts.length} 段 · 起点 ${formatClock(
            Number(c?.start) || 0
          )} · 终点 ${formatClock(Number(c?.end) || 0)}`;
        }
      }
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
      const t = clamp(Number(video.currentTime) || startSec, startSec, endKeepSec());
      const existing = normalizeCutoutsList(cutouts, startSec, endSec);
      if (existing.some((c) => t >= c.start - 0.01 && t < c.end - 0.01)) {
        toast("当前进度已在删除段内，请拖到要删的起点");
        return;
      }
      const remain = endSec - t;
      if (remain < MIN_CUTOUT - 0.001) {
        toast("请把进度拖到要删除的起点（后面至少留 0.2s）");
        return;
      }
      const want = Math.max(MIN_CUTOUT, Math.min(2.4, (endSec - startSec) * 0.12, remain));
      const a = t;
      const b = Math.min(endSec, a + want);
      cutouts = normalizeCutoutsList([...cutouts, { start: a, end: b }], startSec, endSec);
      selectedCutout = Math.max(
        0,
        cutouts.findIndex((c) => a >= c.start - 0.05 && a <= c.end + 0.05)
      );
      if (selectedCutout < 0) selectedCutout = cutouts.length - 1;
      syncCutoutUi();
      updateLabels();
      // 落到删段前约 0.4s，方便再「跳到接点」后点底部播放核对（不自动播）
      const keeps = keepRangesLocal();
      const prevKeep = [...keeps].reverse().find((k) => Number(k.end) <= a + 0.08);
      const joinAt = prevKeep
        ? Math.max(Number(prevKeep.start) || startSec, Number(prevKeep.end) - 0.4)
        : Math.max(startSec, a - 0.4);
      previewSeek(joinAt, { throttle: false });
      hapticLight();
      toast(
        coarseUi()
          ? "已添加 · 用上方起点/终点 ±1 帧 · 「跳到接点」后播放"
          : "已添加删除段 · 用片头/片尾位按钮 ±1 帧 · 可跳到接点后播放核对"
      );
    }

    /** 跳到选中/首个删段接点前；不自动播放——须用户点底部播放 */
    async function seekCutJoinPreview() {
      const cuts = normalizeCutoutsList(cutouts, startSec, endSec);
      if (!cuts.length) {
        toast("还没有删除段");
        return;
      }
      const keeps = keepRangesLocal();
      const cut =
        selectedCutout >= 0 && selectedCutout < cuts.length ? cuts[selectedCutout] : cuts[0];
      const prevKeep = [...keeps].reverse().find((k) => Number(k.end) <= Number(cut.start) + 0.08);
      const joinAt = prevKeep
        ? Math.max(Number(prevKeep.start) || startSec, Number(prevKeep.end) - 0.45)
        : Math.max(startSec, Number(cut.start) - 0.45);
      playWindowLooping = false;
      try {
        video.pause();
      } catch (_) {}
      await seekPlayheadExact(joinAt);
      hapticLight();
      // 提醒点底部播放（不自动播）
      playBtn?.classList.add("is-attn");
      window.setTimeout(() => playBtn?.classList.remove("is-attn"), 1600);
      toast("已跳到接点前 · 点底部播放核对");
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

    /** 对选中红段端点做 ± 步进（成片 CTS；与预览/导出同一套） */
    function nudgeSelectedCutout(edge, dirOrDelta) {
      if (selectedCutout < 0 || selectedCutout >= cutouts.length) {
        toast("先点选一条红段");
        return false;
      }
      const kind = edge === "end" ? "end" : "start";
      const c = cutouts[selectedCutout];
      const cur = kind === "end" ? Number(c.end) || 0 : Number(c.start) || 0;
      const dir = Number(dirOrDelta);
      const next =
        dir === 1 || dir === -1
          ? nudgeEncodeSec(cur, dir)
          : quantizeTrimSec(cur + dir);
      setCutoutEdge(selectedCutout, kind, quantizeTrimSec(next));
      return true;
    }

    /**
     * 红段微调松手：吸到成片帧格，停在该端点画面。
     * 点起点停起点、点终点停终点（勿再跳回接点/片头）。
     */
    async function snapCutNudgeToShown(edge) {
      const idx = selectedCutout;
      if (idx < 0 || idx >= cutouts.length) return;
      const kindEdge = edge === "end" ? "end" : "start";
      const live = kindEdge === "end" ? cutouts[idx].end : cutouts[idx].start;
      const want = quantizeTrimSec(snapToEncodeClock(live));
      setCutoutEdge(idx, kindEdge, want);
      try {
        video.pause();
      } catch (_) {}
      scrubSeekWanted = null;
      if (dragSeekTimer) {
        clearTimeout(dragSeekTimer);
        dragSeekTimer = 0;
      }
      await seekRawExact(kindEdge === "end" ? cutouts[idx].end : cutouts[idx].start);
      syncCutoutUi();
      paintTimeline();
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
      const showStart =
        (dragging && (drag.kind === "start" || drag.kind === "window")) ||
        tipHoldKind === "start" ||
        tipHoldKind === "window";
      const showEnd =
        (dragging && (drag.kind === "end" || drag.kind === "window")) ||
        tipHoldKind === "end" ||
        tipHoldKind === "window";
      if (tipStart) tipStart.hidden = !showStart;
      if (tipEnd) tipEnd.hidden = !showEnd;
    }

    function pumpPreviewScrubSeek() {
      if (!video?.src || scrubSeekInflight) return;
      if (scrubSeekWanted == null) return;
      const t = Math.max(0, Math.min(duration || 0, scrubSeekWanted));
      scrubSeekWanted = null;
      // 近邻阈值跟帧格走：固定 0.03s 在 ≥30fps 上会吞掉约 1 帧，造成「预览总靠前几帧」
      const nearEps = Math.max(0.001, Math.min(0.012, frameSnapSec * 0.2));
      if (Math.abs((Number(video.currentTime) || 0) - t) < nearEps && !video.seeking) {
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

    /**
     * 半开一步 ≡ keepRangesFromEdit 的 endKeep（resolveEndKeepSec(sourceFps)）。
     * 拖拽 seek、播放截断、成片切片必须用同一个值。
     */
    function endKeepStepSec() {
      // 与 keepRangesFromEdit / 成片同一半开一步
      if (sourceFps >= 5) return resolveEndKeepSec(sourceFps);
      // 编辑中途尚未写入 srcFps：跟当前帧格，避免和默认 1/25 拧着
      return Math.max(resolveEndKeepSec(0), frameSnapSec || FRAME_SNAP_SEC);
    }

    function endKeepSec() {
      return Math.max(startSec, endSec - endKeepStepSec());
    }

    function startKeepSec() {
      // 半开片头：与 keepRangesFromEdit 的 startKeep 同一公式
      return Math.min(endKeepSec(), startSec + resolveStartKeepSec(sourceFps));
    }

    /** 片尾停帧世代：按钮按下与松手可能连续触发，只保留最后一次 */
    let endParkGen = 0;
    function clearParkCutTimer() {
      if (parkCutTimer) {
        clearTimeout(parkCutTimer);
        parkCutTimer = 0;
      }
    }

    /** 播放截断点 ≡ 片尾停帧画面（优先 endParkAtSec） */
    function playCutParkSec() {
      if (Number.isFinite(endParkAtSec)) return Math.max(startSec, endParkAtSec);
      return endKeepSec();
    }

    /**
     * 成片时钟停帧：有 MP4 stts 时用采样 CTS（≡ ffmpeg 会留下的那一帧）。
     * 只算时间，不改写黄柄——片尾±才不会被 Chrome 偏早 seek 顶死。
     */
    function encodeParkSecForEdge(edge) {
      const tl = sourceTimeline;
      const api = window.DevToolsMp4Timeline;
      if (tl?.ctsSec?.length && api?.sampleRangeForKeep) {
        const fr = api.sampleRangeForKeep(tl, startSec, endSec);
        if (fr) {
          if (edge === "end") {
            const idx = Math.max(0, Math.min(tl.ctsSec.length - 1, Number(fr.endF) - 1));
            const t = Number(tl.ctsSec[idx]);
            if (Number.isFinite(t)) return clamp(t, startSec, Math.max(startSec, endSec));
          } else {
            const idx = Math.max(0, Math.min(tl.ctsSec.length - 1, Number(fr.startF) || 0));
            const t = Number(tl.ctsSec[idx]);
            if (Number.isFinite(t)) return clamp(t, 0, endSec);
          }
        }
      }
      return edge === "end" ? endKeepSec() : startSec;
    }

    /**
     * 片尾停预览：seek 到成片末帧 CTS，只记 endParkAtSec，不改写 endSec。
     */
    async function seekEndPreviewExact() {
      const gen = ++endParkGen;
      const target = encodeParkSecForEdge("end");
      scrubSeekWanted = null;
      if (dragSeekTimer) {
        clearTimeout(dragSeekTimer);
        dragSeekTimer = 0;
      }
      scrubSeekInflight = false;
      freezeClockSec = NaN;
      try {
        video.pause();
      } catch (_) {}
      try {
        video.currentTime = displaySeekSec(target, sourceFps);
      } catch (_) {}
      await waitSeek(video);
      if (gen !== endParkGen || closed) return target;
      const shown = Number(video.currentTime);
      endParkAtSec = Number.isFinite(shown) ? shown : target;
      paintTimeline();
      updateLabels();
      return endParkAtSec;
    }

    /**
     * 片头停预览：seek 到成片首帧 CTS，不改写 startSec。
     */
    async function seekStartPreviewExact() {
      scrubSeekWanted = null;
      if (dragSeekTimer) {
        clearTimeout(dragSeekTimer);
        dragSeekTimer = 0;
      }
      scrubSeekInflight = false;
      try {
        video.pause();
      } catch (_) {}
      const target = encodeParkSecForEdge("start");
      try {
        video.currentTime = displaySeekSec(target, sourceFps);
      } catch (_) {}
      await waitSeek(video);
      paintTimeline();
      updateLabels();
      return Number(video.currentTime) || target;
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
      const now = Number.isFinite(freezeClockSec)
        ? freezeClockSec
        : video.currentTime || startSec;
      if (clockEl) clockEl.textContent = `${formatClock(now)} / ${formatClock(duration)}`;
      const keeps = keepRangesLocal();
      const keepSpan = keeps.reduce((s, k) => s + Math.max(0, k.end - k.start), 0);
      const cutN = normalizeCutoutsList(cutouts, startSec, endSec).length;
      if (rangeLabel) {
        // keepSpan 与 GIF 同源；黄柄即成片外框（所见即所得）
        if (cutN > 0) {
          rangeLabel.textContent = `保留 ${formatClock(keepSpan)}（${formatClock(startSec)}–${formatClock(endSec)} · 删 ${cutN} 段）`;
        } else {
          rangeLabel.textContent = `保留 ${formatClock(keepSpan)}（${formatClock(startSec)}–${formatClock(endSec)}）`;
        }
      }
      syncHandleTips();
      if (editMode === "cut") syncCutoutUi();
      else if (cutDelBtn) cutDelBtn.disabled = true;
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

    function applySourceFps(fps) {
      const n = normalizeSourceFps(fps);
      if (!(n >= 5)) return false;
      sourceFps = n;
      frameSnapSec = frameSnapSecFromFps(n);
      // fps 从默认 30 探成 24 时，重算片尾停帧，避免 endPark 仍按 1/30
      if (Number.isFinite(endSec) && endSec > 0) {
        endParkAtSec = Math.max(0, endSec - 1 / n);
      }
      return true;
    }

    /** 抬手帧格吸附：按片源真实 fps（拿不到则 30），给「咔」一下 */
    function snapToFrameGrid(t) {
      const raw = clamp(t, 0, duration);
      const step = frameSnapSec > 0 ? frameSnapSec : FRAME_SNAP_SEC;
      if (!(duration > 0) || !(step > 0)) return raw;
      const snapped = Math.round(raw / step) * step;
      return clamp(snapped, 0, duration);
    }

    /**
     * 成片时钟吸附：优先吸到 MP4 采样 CTS（≡ ffmpeg 切点）；无时间轴再回退 fps 格。
     * 不用 ffmpeg 实时预览（太慢），吸到同一时间点即可。
     */
    function snapToEncodeClock(t) {
      const raw = clamp(t, 0, duration);
      const tl = sourceTimeline;
      const api = window.DevToolsMp4Timeline;
      if (tl?.ctsSec?.length && typeof api?.sampleIndexAtSec === "function") {
        const idx = api.sampleIndexAtSec(tl, raw);
        const cts = Number(tl.ctsSec[Math.max(0, Math.min(tl.ctsSec.length - 1, idx))]);
        if (Number.isFinite(cts)) return clamp(cts, 0, duration);
      }
      return snapToFrameGrid(raw);
    }

    /**
     * 后台探测片源 fps（优先共用 detectSourceFps；否则本页 rVFC 轻量估）。
     * 不阻塞打开；探测到后更新 frameSnapSec，后续松手即用真实格。
     */
    async function detectAndApplySourceTimeline(srcFile) {
      if (closed || !srcFile) return;
      const probe = window.DevToolsMp4Timeline?.probeMp4VideoTimeline;
      if (typeof probe !== "function") return;
      try {
        const tl = await probe(srcFile);
        if (closed || !tl?.ok || !(tl.fps >= 5)) return;
        sourceTimeline = tl;
        applySourceFps(tl.fps);
      } catch (_) {}
    }

    async function detectAndApplySourceFps(srcFile, detectOpts) {
      if (closed) return;
      // 优先 MP4 stts（容器真实帧率）；再 rVFC / 共用探测
      await detectAndApplySourceTimeline(srcFile);
      if (closed) return;
      if (sourceTimeline?.fps >= 5) return;
      // 已有方案/调用方 fps：勿被 rVFC 误估覆盖（典型 24→30）
      if (detectOpts?.preferKnown && sourceFps >= 5) return;
      let fps = 0;
      // 优先共用 detectSourceFps（独立 video 探测，不搅乱编辑预览）
      if (typeof detectSourceFps === "function" && srcFile) {
        try {
          fps = Number(await detectSourceFps(srcFile).catch(() => 0)) || 0;
        } catch (_) {
          fps = 0;
        }
      } else if (video && typeof video.requestVideoFrameCallback === "function") {
        // 无共用探测时才用编辑器 video 轻量估（会短暂 play，结束后停并回到黄柄）
        try {
          const times = [];
          const wasMuted = video.muted;
          video.muted = true;
          await new Promise((resolve) => {
            const to = setTimeout(resolve, 1800);
            const onFrame = (_now, meta) => {
              if (closed) {
                clearTimeout(to);
                resolve();
                return;
              }
              times.push(Number(meta?.mediaTime) || 0);
              if (times.length >= 2 && times[times.length - 1] - times[0] >= 0.45) {
                clearTimeout(to);
                resolve();
                return;
              }
              if (times.length >= 180) {
                clearTimeout(to);
                resolve();
                return;
              }
              try {
                video.requestVideoFrameCallback(onFrame);
              } catch (_) {
                clearTimeout(to);
                resolve();
              }
            };
            try {
              video.requestVideoFrameCallback(onFrame);
            } catch (_) {
              clearTimeout(to);
              resolve();
              return;
            }
            video.play().catch(() => {
              clearTimeout(to);
              resolve();
            });
          });
          try {
            video.pause();
          } catch (_) {}
          video.muted = wasMuted;
          if (times.length >= 3) {
            fps = estimateFpsFromMediaTimes(times) || 0;
          }
          try {
            await seekPlayheadExact(startSec);
          } catch (_) {
            previewSeek(startSec);
          }
        } catch (_) {}
      }
      if (!closed) applySourceFps(fps);
    }

    /** 靠近红段边也吸一下（删中间接点好对齐） */
    function snapNearCutouts(t) {
      let best = clamp(t, 0, duration);
      let bestDist = SNAP_EDGE_SEC;
      const list = normalizeCutoutsList(cutouts, startSec, endSec);
      for (const c of list) {
        for (const edge of [Number(c.start) || 0, Number(c.end) || 0]) {
          const d = Math.abs(best - edge);
          if (d <= bestDist) {
            bestDist = d;
            best = edge;
          }
        }
      }
      return best;
    }

    function snapTrimHandle(t, which) {
      return snapNearCutouts(snapEdgeOnly(snapToEncodeClock(t), which));
    }

    /** 记录拖拽采样，供送手时回看抬手前稳定位置 */
    function pushDragSample(t) {
      if (!drag) return;
      if (!Array.isArray(drag.samples)) drag.samples = [];
      const at = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
      drag.samples.push({ t: Number(t) || 0, at });
      if (drag.samples.length > 16) drag.samples.shift();
    }

    /**
     * 送手瞬间触点常再偏几像素；取抬手前 LIFT_LAG_MS 的采样，避免黄柄偏移。
     */
    function dragSecBeforeLift(fallback) {
      const samples = drag?.samples;
      if (!Array.isArray(samples) || !samples.length) return fallback;
      const now = typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
      const targetAt = now - LIFT_LAG_MS;
      for (let i = samples.length - 1; i >= 0; i--) {
        if (samples[i].at <= targetAt) return samples[i].t;
      }
      return samples[0].t;
    }

    /** 松手后短留时间戳，让人看清吸到哪一帧 */
    function flashSnapFeedback(kind, moved) {
      if (moved) {
        timeline?.classList.remove("is-pulse", "is-snap");
        // 强制重启动画
        void timeline?.offsetWidth;
        timeline?.classList.add("is-pulse", "is-snap");
        hapticLight();
      }
      tipHoldKind = kind || "";
      if (tipStart) tipStart.hidden = !(tipHoldKind === "start" || tipHoldKind === "window");
      if (tipEnd) tipEnd.hidden = !(tipHoldKind === "end" || tipHoldKind === "window");
      if (tipHoldTimer) clearTimeout(tipHoldTimer);
      tipHoldTimer = setTimeout(() => {
        tipHoldKind = "";
        tipHoldTimer = 0;
        timeline?.classList.remove("is-snap");
        syncHandleTips();
      }, 700);
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
      if (preview) {
        if (immediateSeek || !drag) void seekStartPreviewExact();
        else previewSeek(startSec, { throttle: true });
      }
      paintTimeline();
      updateLabels();
    }

    function setEnd(t, { preview = true, immediateSeek = false } = {}) {
      const prev = endSec;
      endSec = clamp(t, startSec + MIN_SPAN, duration);
      // 拖拽中尚未停帧：先跟理论 park，抬手 seekEndPreviewExact 再钉 shown
      if (!(immediateSeek || !drag)) endParkAtSec = endKeepSec();
      activeHandle = "end";
      syncActiveHandleUi();
      clipCutoutsToWindow();
      const atMin = Math.abs(endSec - startSec - MIN_SPAN) < 0.02;
      timeline?.classList.toggle("is-min-span", atMin);
      if (atMin && Math.abs(prev - endSec) > 0.001) {
        timeline?.classList.add("is-pulse");
        hapticLight();
      }
      if (preview) {
        // 拖拽中节流跟手；按钮/抬手用精确回拉，避免片尾预览多出几帧
        if (immediateSeek || !drag) void seekEndPreviewExact();
        else previewSeek(endKeepSec(), { throttle: true });
      }
      paintTimeline();
      updateLabels();
    }

    function shiftWindow(deltaSec) {
      const span = endSec - startSec;
      let nextStart = startSec + deltaSec;
      nextStart = clamp(nextStart, 0, duration - span);
      startSec = nextStart;
      endSec = nextStart + span;
      endParkAtSec = endKeepSec();
      previewSeek(startSec, { throttle: Boolean(drag) });
      paintTimeline();
      updateLabels();
    }

    async function finishTrimDrag() {
      if (!drag) return;
      const kind = drag.kind;
      const cutIndex = drag.cutIndex;
      // 抬手：去送手抖动 → 成片时钟吸附 → 预览停 CTS（不按 Chrome 停帧改写黄柄）
      if (kind === "start") {
        const before = startSec;
        const want = quantizeTrimSec(
          clamp(snapTrimHandle(dragSecBeforeLift(startSec), "start"), 0, endSec - MIN_SPAN)
        );
        startSec = want;
        try {
          video.pause();
        } catch (_) {}
        scrubSeekWanted = null;
        if (dragSeekTimer) {
          clearTimeout(dragSeekTimer);
          dragSeekTimer = 0;
        }
        clipCutoutsToWindow();
        await seekStartPreviewExact();
        paintTimeline();
        updateLabels();
        flashSnapFeedback("start", Math.abs(before - startSec) > frameSnapSec * 0.35);
      } else if (kind === "end") {
        const before = endSec;
        const want = quantizeTrimSec(
          clamp(snapTrimHandle(dragSecBeforeLift(endSec), "end"), startSec + MIN_SPAN, duration)
        );
        setEnd(want, {
          preview: false,
          immediateSeek: false,
        });
        try {
          video.pause();
        } catch (_) {}
        scrubSeekWanted = null;
        if (dragSeekTimer) {
          clearTimeout(dragSeekTimer);
          dragSeekTimer = 0;
        }
        clipCutoutsToWindow();
        await seekEndPreviewExact();
        paintTimeline();
        updateLabels();
        flashSnapFeedback("end", Math.abs(before - endSec) > frameSnapSec * 0.35);
      } else if (kind === "window") {
        const beforeStart = startSec;
        const span = Math.max(MIN_SPAN, endSec - startSec);
        const liftStart = dragSecBeforeLift(startSec);
        startSec = quantizeTrimSec(
          clamp(snapTrimHandle(liftStart, "start"), 0, duration - span)
        );
        endSec = clamp(startSec + span, startSec + MIN_SPAN, duration);
        endSec = quantizeTrimSec(
          clamp(snapTrimHandle(endSec, "end"), startSec + MIN_SPAN, duration)
        );
        if (endSec - startSec < MIN_SPAN) endSec = Math.min(duration, startSec + MIN_SPAN);
        endParkAtSec = endKeepSec();
        clipCutoutsToWindow();
        await seekPlayheadExact(encodeParkSecForEdge("start"));
        paintTimeline();
        updateLabels();
        flashSnapFeedback("window", Math.abs(beforeStart - startSec) > frameSnapSec * 0.35);
      } else if (kind === "cut-start" || kind === "cut-end") {
        const idx = Number(cutIndex);
        if (idx >= 0 && idx < cutouts.length) {
          const c = cutouts[idx];
          const live = kind === "cut-end" ? c.end : c.start;
          const preLift = quantizeTrimSec(
            snapTrimHandle(dragSecBeforeLift(live), kind === "cut-end" ? "end" : "start")
          );
          setCutoutEdge(idx, kind === "cut-end" ? "end" : "start", preLift);
          try {
            video.pause();
          } catch (_) {}
          scrubSeekWanted = null;
          if (dragSeekTimer) {
            clearTimeout(dragSeekTimer);
            dragSeekTimer = 0;
          }
          selectedCutout = idx;
          const parkT =
            kind === "cut-end"
              ? Number(cutouts[idx]?.end) || preLift
              : Number(cutouts[idx]?.start) || preLift;
          await seekRawExact(snapToEncodeClock(parkT));
          flashSnapFeedback(
            kind === "cut-end" ? "end" : "start",
            Math.abs(preLift - live) > frameSnapSec * 0.35
          );
        } else {
          clipCutoutsToWindow();
          paintCutouts();
          updateLabels();
        }
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

    /**
     * 原始精确 seek：不走 keep 重映射。
     * 红柄落在「将删除」的闭区间上，必须能停在起点/终点所见帧；
     * seekPlayheadExact 会把删段内时间跳到下一段保留区，终点预览会跑丢。
     */
    async function seekRawExact(t) {
      const target = clamp(Number(t) || 0, 0, Math.max(0, (duration || 0) - 1e-4));
      scrubSeekWanted = null;
      if (dragSeekTimer) {
        clearTimeout(dragSeekTimer);
        dragSeekTimer = 0;
      }
      scrubSeekInflight = false;
      try {
        video.pause();
      } catch (_) {}
      try {
        video.currentTime = target;
      } catch (_) {}
      await waitSeek(video);
      paintTimeline();
      updateLabels();
      return Number(video.currentTime) || target;
    }

    async function seekPlayheadExact(t) {
      let target = clamp(t, startSec, endKeepSec());
      // 与外预览同一套 keepRanges：落在删段/半开尾则跳到应播点
      const jump = previewSeekForKeepRanges(keepRangesLocal(), target, {
        paused: true,
        endKeepSec: endKeepStepSec(),
      });
      if (jump != null && Number.isFinite(jump)) {
        target = clamp(jump, startSec, endKeepSec());
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

    /** 当前播放头落在哪一段删区（含两端所见帧）；不在则 null */
    function cutoutAtTime(t) {
      const cur = Number(t);
      if (!Number.isFinite(cur)) return null;
      const list = normalizeCutoutsList(cutouts, startSec, endSec);
      for (let i = 0; i < list.length; i++) {
        const c = list[i];
        if (cur >= c.start - 0.02 && cur <= c.end + 0.02) return { cut: c, index: i };
      }
      return null;
    }

    /**
     * 停在红段内时点播放：按靠近起点/终点决定开播位置，避免被 keep 重映射甩到错误侧。
     * - 靠近起点 → 接点前（上一段保留区尾），核对跳切
     * - 靠近终点 → 删段后第一帧，勿跳回起点
     */
    function playFromWhenInsideCut(hit) {
      const cut = hit.cut;
      const cur = Number(video.currentTime) || 0;
      const distStart = Math.abs(cur - cut.start);
      const distEnd = Math.abs(cur - cut.end);
      const keeps = keepRangesLocal();
      const frame = Math.max(1 / 240, endKeepStepSec());
      if (distStart <= distEnd) {
        const prevKeep = [...keeps].reverse().find((k) => Number(k.end) <= cut.start + 0.08);
        if (prevKeep) {
          return Math.max(Number(prevKeep.start) || startSec, Number(prevKeep.end) - frame);
        }
        return Math.max(startSec, cut.start - frame);
      }
      const after = previewSeekForKeepRanges(keeps, cut.end + 1e-4, {
        paused: true,
        endKeepSec: endKeepStepSec(),
      });
      if (after != null && Number.isFinite(after)) return after;
      return Math.min(endKeepSec(), cut.end + frame);
    }

    function loopPlayToStart() {
      if (playWindowLooping) return;
      playWindowLooping = true;
      const gen = ++playWindowGen;
      lastPresentedMediaTime = NaN;
      freezeClockSec = NaN;
      clearParkCutTimer();
      try {
        video.pause();
      } catch (_) {}
      seekPlayheadExact(startSec)
        .then(async () => {
          if (closed || gen !== playWindowGen) return;
          await video.play().catch(() => {});
          if (!closed && gen === playWindowGen && !video.paused) armFrameWatch();
        })
        .catch(() => {})
        .finally(() => {
          if (gen === playWindowGen) playWindowLooping = false;
        });
    }

    function clipPlayWindow(mediaTime) {
      if (closed || !duration || video.paused || playWindowLooping || drag) return false;
      const clock = Number(video.currentTime) || 0;
      // 根因：播放时 currentTime 常滞后于已呈现帧；只用 currentTime 会在画面已过 park 后才切
      const presented = Number.isFinite(mediaTime)
        ? mediaTime
        : Number.isFinite(lastPresentedMediaTime)
          ? lastPresentedMediaTime
          : clock;
      const cur = Math.max(clock, presented);
      const park = playCutParkSec();
      const step = endKeepStepSec();
      // 硬闸钉停帧 shown（endParkAtSec）；并封顶 exclusive end，防止多出约 0.1s
      let jump = null;
      if (cur >= park - 1e-4 || cur >= endSec - 1e-4) {
        jump = startSec;
      } else {
        jump = previewSeekForKeepRanges(keepRangesLocal(), cur, {
          paused: false,
          endKeepSec: step,
        });
      }
      if (jump == null || !Number.isFinite(jump)) return false;
      if (Math.abs(jump - cur) < 0.001) return false;
      clearParkCutTimer();
      // 先冻时钟再 pause：避免 UI 把越过停帧的 currentTime 刷成多 0.1s
      freezeClockSec = park;
      try {
        video.pause();
      } catch (_) {}
      updateLabels();
      paintTimeline();
      playWindowLooping = true;
      const gen = ++playWindowGen;
      lastPresentedMediaTime = NaN;
      void (async () => {
        try {
          await seekPlayheadExact(jump);
          if (closed || gen !== playWindowGen) return;
          freezeClockSec = NaN;
          await video.play().catch(() => {});
          if (closed || gen !== playWindowGen || video.paused) return;
          armFrameWatch();
          if (!playheadRaf) playheadRaf = requestAnimationFrame(tickPlayhead);
        } catch (_) {
          /* finally 清 looping */
        } finally {
          // 须在 play + arm 之后才放行，避免空窗期靠滞后 currentTime 漏切
          if (gen === playWindowGen) playWindowLooping = false;
        }
      })();
      return true;
    }

    function armFrameWatch() {
      if (typeof video.requestVideoFrameCallback !== "function") return;
      const gen = playWindowGen;
      const onFrame = (_now, meta) => {
        if (closed || gen !== playWindowGen || video.paused || playWindowLooping) return;
        const mt = Number(meta?.mediaTime);
        if (Number.isFinite(mt)) lastPresentedMediaTime = mt;
        if (clipPlayWindow(Number.isFinite(mt) ? mt : undefined)) return;
        // 距停帧 < 2 源帧：按剩余媒体时间预约切断（对冲 rVFC/currentTime 采样间隔，不改 park）
        const park = playCutParkSec();
        if (Number.isFinite(mt) && mt < park - 1e-4) {
          const remain = park - mt;
          const step = endKeepStepSec();
          if (remain <= step * 2 && !parkCutTimer) {
            const rate = Math.max(0.05, Number(video.playbackRate) || 1);
            const waitMs = Math.max(0, (remain / rate) * 1000 - 4);
            parkCutTimer = window.setTimeout(() => {
              parkCutTimer = 0;
              if (closed || gen !== playWindowGen || video.paused || playWindowLooping) return;
              clipPlayWindow(park);
            }, waitMs);
          }
        }
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
        const keep = playCutParkSec();
        playWindowLooping = false;
        lastPresentedMediaTime = NaN;
        freezeClockSec = NaN;
        clearParkCutTimer();
        const hitCut = cutoutAtTime(cur);
        if (hitCut) {
          // 停在红柄/删段内：按端点开播，终点侧不要被拉去起点
          const from = playFromWhenInsideCut(hitCut);
          await seekRawExact(from);
        } else {
          const needStart = cur < startSec - 0.01 || cur >= keep - 0.001 || Math.abs(cur - startSec) < 0.02;
          // 刚拖完片头时 currentTime≈startSec，仍强制精确 seek 再播，锁住用户拖到的位置
          await seekPlayheadExact(needStart ? startSec : cur);
        }
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
        // 提交黄/红柄所见时间：预览与 GIF 都按此精确对齐（所见即所得）
        trimStart: quantizeTrimSec(startSec),
        trimEnd: quantizeTrimSec(endSec),
        // 只写入探测到的真实 fps；未探测勿填默认 30（否则导出会误判走帧号切）
        ...(sourceFps >= 5 ? { srcFps: sourceFps } : {}),
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

    let exporting = false;
    function setExportProgress(visible, ratio, text, opts = {}) {
      const r = Math.max(0, Math.min(1, Number(ratio) || 0));
      const pct = Math.round(r * 100);
      const busy = Boolean(opts.busy) || (visible && r < 0.99);
      if (exportProgress) exportProgress.hidden = !visible;
      if (exportFill) {
        exportFill.style.width = `${Math.max(pct, busy && pct < 8 ? 8 : pct)}%`;
        exportFill.classList.toggle("is-active", busy);
      }
      if (exportPct) exportPct.textContent = `${pct}%`;
      if (exportText && text) exportText.textContent = String(text);
      if (exportStatus) {
        if (opts.error) {
          exportStatus.hidden = false;
          exportStatus.textContent = String(opts.error);
          exportStatus.classList.add("is-error");
        } else if (opts.ok) {
          exportStatus.hidden = false;
          exportStatus.textContent = String(opts.ok);
          exportStatus.classList.remove("is-error");
        } else if (!visible) {
          exportStatus.hidden = true;
          exportStatus.textContent = "";
          exportStatus.classList.remove("is-error");
        }
      }
    }
    function triggerLocalDownload(blob, name) {
      const dl = window.DevToolsExtraMedia?.triggerBlobDownload;
      if (typeof dl === "function") {
        dl(blob, name);
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }

    async function downloadEditedVideo() {
      if (closed || exporting) return;
      const edit = getEditState();
      // 与预览同一套 keep（勿用毫秒量化后的 edit 重算，否则相对预览偏帧）
      const previewKeeps = keepRangesLocal();
      exporting = true;
      const prev = downloadBtn?.textContent;
      if (downloadBtn) {
        downloadBtn.disabled = true;
        downloadBtn.textContent = "正在导出…";
      }
      setExportProgress(true, 0.04, "正在导出编辑后的视频…", { busy: true });
      toast("正在导出编辑后的视频…");
      try {
        const onProgress = (r, text) => {
          const ratio = Number(r);
          const label = String(text || "正在导出…");
          setExportProgress(true, Number.isFinite(ratio) ? ratio : 0.12, label, { busy: true });
          if (downloadBtn) downloadBtn.textContent = "正在导出…";
        };
        const filenameBase = String(file.name || "video").replace(/\.[^.]+$/, "");
        // 成片时钟：预览停 CTS、导出优先 ffmpeg（快）。chrome 仅兜底。
        let out = null;
        try {
          onProgress(0.08, "编码器切片…");
          out = await exportKeepVideo(file, edit, duration, {
            srcW: video.videoWidth || 0,
            srcH: video.videoHeight || 0,
            applyCrop: Boolean(edit.cropOn),
            keeps: previewKeeps,
            timeline: sourceTimeline || undefined,
            onProgress,
          });
          if (!(out?.blob?.size > 0)) out = null;
        } catch (_) {
          out = null;
        }
        if (!out) {
          onProgress(0.05, "按预览帧导出…");
          out = await exportKeepByChromeDisplay(video, previewKeeps, {
            keepFps: sourceFps || resolveKeepFps(edit),
            applyCrop: Boolean(edit.cropOn),
            timeline: sourceTimeline || undefined,
            filenameBase,
            srcW: video.videoWidth || 0,
            srcH: video.videoHeight || 0,
            onProgress,
          });
        }
        const blob = out?.blob || (out?.file ? new Blob([out.file], { type: "video/mp4" }) : null);
        if (!blob || !blob.size) throw new Error("未产出视频");
        const name = out?.filename || filenameBase + "-edit.mp4";
        const diagName = String(name).replace(/\.mp4$/i, "") + "-export-diag.json";
        const build =
          (typeof window !== "undefined" && (window.TOOLS_BUILD || window.TOOLS_VERSION)) || "";
        const isChromeFrames = String(out?.exportMethod || "").includes("chrome");
        const diag = {
          kind: "vbb-export-diag",
          ver: 5,
          build: String(build || ""),
          at: new Date().toISOString(),
          ua: typeof navigator !== "undefined" ? String(navigator.userAgent || "") : "",
          note: isChromeFrames
            ? "预览帧兜底导出（VideoFrame）；时长=各 keep 之和"
            : "成片时钟：预览停 CTS、ffmpeg 精切；拖柄不吸附，底部 ±1 精调；时长=各 keep 之和",
          file: {
            name: String(file?.name || ""),
            size: Number(file?.size) || 0,
            type: String(file?.type || ""),
          },
          source: {
            duration,
            srcW: video.videoWidth || 0,
            srcH: video.videoHeight || 0,
            sourceFps,
            mp4Fps: sourceTimeline?.fps || null,
            mp4SampleCount: sourceTimeline?.sampleCount || null,
            currentTime: Number(video.currentTime) || 0,
            paused: Boolean(video.paused),
          },
          handles: {
            startSec,
            endSec,
            endParkAtSec: Number.isFinite(endParkAtSec) ? endParkAtSec : null,
            cutouts: (cutouts || []).map((c) => ({ start: c.start, end: c.end })),
          },
          edit,
          previewKeeps,
          export: {
            exportMethod: out?.exportMethod || "ffmpeg",
            mime: blob.type || "video/mp4",
            keepFps: out?.keepFps,
            segmentSpans: out?.segmentSpans,
            keeps: out?.keeps,
            sliceLog: out?.sliceLog,
            outDuration: out?.duration,
            outW: out?.srcW,
            outH: out?.srcH,
            filename: name,
            bytes: blob.size,
            ptsResetBeforeTrim: false,
            keepStyle: out?.mp4Timeline?.sampleCount
              ? "mp4-sample-half-open"
              : "handle-sec-half-open",
            timelineErr: out?.timelineErr || null,
            mp4Timeline: out?.mp4Timeline || null,
          },
        };
        setExportProgress(true, 1, "开始下载…");
        triggerLocalDownload(blob, name);
        triggerLocalDownload(
          new Blob([JSON.stringify(diag, null, 2)], { type: "application/json" }),
          diagName
        );
        setExportProgress(true, 1, "已开始下载", {
          ok: `已下载 ${name} + 诊断 ${diagName}（发给开发即可）`,
        });
        toast("已下载视频和诊断 JSON，请把 JSON 发我");
      } catch (err) {
        const msg = err?.message || String(err) || "导出失败";
        setExportProgress(true, 0, "导出失败", { error: msg });
        toast(msg);
        throw err;
      } finally {
        exporting = false;
        if (downloadBtn) {
          downloadBtn.disabled = false;
          downloadBtn.textContent = prev || "下载编辑后的视频";
        }
      }
    }

    function cleanup() {
      if (closed) return;
      closed = true;
      filmGen += 1;
      playWindowGen += 1;
      playWindowLooping = false;
      freezeClockSec = NaN;
      clearParkCutTimer();
      if (tipHoldTimer) {
        clearTimeout(tipHoldTimer);
        tipHoldTimer = 0;
      }
      tipHoldKind = "";
      if (dragSeekTimer) {
        clearTimeout(dragSeekTimer);
        dragSeekTimer = 0;
      }
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
      const tag = String(e.target?.tagName || "").toLowerCase();
      if (tag === "input" || tag === "textarea" || e.target?.isContentEditable) return;
      if (e.key === "Escape") {
        e.preventDefault();
        finish(false);
        return;
      }
      // 空格：播放/暂停（视频编辑器习惯）
      if (e.key === " " || e.code === "Space") {
        e.preventDefault();
        togglePlay().catch(() => {});
        return;
      }
      // Delete / Backspace：删选中删除段
      if ((e.key === "Delete" || e.key === "Backspace") && editMode === "cut") {
        if (selectedCutout >= 0 && selectedCutout < cutouts.length) {
          e.preventDefault();
          deleteSelectedCutout();
          toast("已删除选中段");
        }
        return;
      }
      // ←/→：微调播放进度；Shift 步进 1s，默认 0.1s（不改黄/红柄，避免误触）
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (!duration) return;
        e.preventDefault();
        const step = e.shiftKey ? 1 : 0.1;
        const dir = e.key === "ArrowLeft" ? -1 : 1;
        const cur = Number(video.currentTime) || startSec;
        const next = clamp(cur + dir * step, startSec, endKeepSec());
        try {
          video.pause();
        } catch (_) {}
        previewSeek(next, { throttle: false });
        updateLabels();
        paintTimeline();
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
    /** 微调松手后对齐解码器实际画面，与拖拽抬手一致，避免 nudge 所见 ≠ 提交/成片 */
    let nudgeSnapKind = null;
    let nudgeSnapGen = 0;
    /**
     * 微调松手：吸到成片帧格（源 fps），再停预览。
     * 不以浏览器「显示偏了一帧」改写黄柄——成片时钟是锚点。
     */
    async function snapNudgeToShown(kind) {
      const gen = ++nudgeSnapGen;
      if (kind === "cut-start" || kind === "cut-end") {
        await snapCutNudgeToShown(kind === "cut-end" ? "end" : "start");
        return;
      }
      try {
        video.pause();
      } catch (_) {}
      scrubSeekWanted = null;
      if (dragSeekTimer) {
        clearTimeout(dragSeekTimer);
        dragSeekTimer = 0;
      }
      // 按钮已按 keep 采样落点；松手只停预览，勿再 snapToEncodeClock 把片尾 exclusive 拧回去
      if (kind === "start") {
        if (gen !== nudgeSnapGen || closed) return;
        clipCutoutsToWindow();
        await seekStartPreviewExact();
      } else {
        endParkAtSec = endKeepSec();
        if (gen !== nudgeSnapGen || closed) return;
        clipCutoutsToWindow();
        await seekEndPreviewExact();
      }
      paintTimeline();
      updateLabels();
    }
    function bindNudgeHold(btn, stepFn, kindOrFn) {
      if (!btn) return;
      let holdTimer = 0;
      let holdRepeat = 0;
      let armed = false;
      let pointerId = null;
      const resolveKind = typeof kindOrFn === "function" ? kindOrFn : () => kindOrFn;
      const stopRepeat = () => {
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
        nudgeSnapKind = resolveKind();
        stepFn();
      };
      const onRelease = (e) => {
        if (!armed) return;
        if (e && pointerId != null && e.pointerId != null && e.pointerId !== pointerId) return;
        armed = false;
        pointerId = null;
        stopRepeat();
        window.removeEventListener("pointerup", onRelease, true);
        window.removeEventListener("pointercancel", onRelease, true);
        if (nudgeSnapKind) {
          const k = nudgeSnapKind;
          nudgeSnapKind = null;
          void snapNudgeToShown(k);
        }
      };
      btn.addEventListener("pointerdown", (e) => {
        if (e.button != null && e.button !== 0) return;
        if (btn.disabled) return;
        e.preventDefault();
        // 不用 setPointerCapture：部分安卓会立刻 lostpointercapture，短按像没点到
        armed = true;
        pointerId = e.pointerId;
        stopRepeat();
        fire();
        window.addEventListener("pointerup", onRelease, true);
        window.addEventListener("pointercancel", onRelease, true);
        holdTimer = window.setTimeout(() => {
          holdTimer = 0;
          if (!armed) return;
          holdRepeat = window.setInterval(() => {
            if (!armed) return;
            fire();
          }, 70);
        }, 280);
      });
      // 避免 click 再触发一次
      btn.addEventListener("click", (e) => e.preventDefault());
    }
    bindNudgeHold(
      nudgeStartM,
      () => {
        if (editMode === "cut") nudgeSelectedCutout("start", -1);
        else setStart(nudgeTrimEdgeSec("start", -1), { immediateSeek: true });
      },
      () => (editMode === "cut" ? "cut-start" : "start")
    );
    bindNudgeHold(
      nudgeStartP,
      () => {
        if (editMode === "cut") nudgeSelectedCutout("start", 1);
        else setStart(nudgeTrimEdgeSec("start", 1), { immediateSeek: true });
      },
      () => (editMode === "cut" ? "cut-start" : "start")
    );
    bindNudgeHold(
      nudgeEndM,
      () => {
        if (editMode === "cut") nudgeSelectedCutout("end", -1);
        else setEnd(nudgeTrimEdgeSec("end", -1), { immediateSeek: true });
      },
      () => (editMode === "cut" ? "cut-end" : "end")
    );
    bindNudgeHold(
      nudgeEndP,
      () => {
        if (editMode === "cut") nudgeSelectedCutout("end", 1);
        else setEnd(nudgeTrimEdgeSec("end", 1), { immediateSeek: true });
      },
      () => (editMode === "cut" ? "cut-end" : "end")
    );
    cutAddBtn?.addEventListener("click", () => addCutoutAtPlayhead());
    cutPlayJoinBtn?.addEventListener("click", () => {
      seekCutJoinPreview().catch((err) => toast(err?.message || String(err) || "跳转失败"));
    });
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
    downloadBtn?.addEventListener("click", () => {
      downloadEditedVideo().catch((err) => toast(err?.message || String(err) || "导出失败"));
    });

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
        drag = { kind: "start", pointerId: e.pointerId, samples: [] };
        handleStart?.setPointerCapture?.(e.pointerId);
        pushDragSample(t);
        setStart(t);
      } else if (kind === "end") {
        drag = { kind: "end", pointerId: e.pointerId, samples: [] };
        handleEnd?.setPointerCapture?.(e.pointerId);
        pushDragSample(t);
        setEnd(t);
      } else if (kind === "window") {
        drag = {
          kind: "window",
          pointerId: e.pointerId,
          originX: e.clientX,
          originStart: startSec,
          originEnd: endSec,
          samples: [],
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
        syncCutoutUi();
        drag = { kind, pointerId: e.pointerId, cutIndex: selectedCutout, samples: [] };
        timeline?.setPointerCapture?.(e.pointerId);
        pushDragSample(t);
        setCutoutEdge(selectedCutout, kind === "cut-end" ? "end" : "start", t);
      } else {
        previewSeek(clamp(t, startSec, endKeepSec()));
        drag = { kind: "seek", pointerId: e.pointerId, samples: [] };
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
        pushDragSample(startSec);
        syncHandleTips();
        return;
      }
      const raw = ratioFromClientX(e.clientX) * duration;
      // 拖拽按成片时钟吸附（CTS/帧格），预览与 ffmpeg 切点同锚
      let t = raw;
      if (drag.kind === "start") t = snapTrimHandle(raw, "start");
      else if (drag.kind === "end") t = snapTrimHandle(raw, "end");
      else if (drag.kind === "cut-start") t = snapTrimHandle(raw, "start");
      else if (drag.kind === "cut-end") t = snapTrimHandle(raw, "end");
      if (Math.abs(t - raw) > 0.0005 && Math.abs(t - raw) <= SNAP_EDGE_SEC) {
        if (!drag._magnetAt || Math.abs(drag._magnetAt - t) > 0.001) {
          drag._magnetAt = t;
          hapticLight();
        }
      } else {
        drag._magnetAt = null;
      }
      pushDragSample(t);
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
      // 预览只负责左右滑 scrub；播放/暂停只用底部按钮（手机误触点画面不再开播）
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
      previewScrub = null;
      // 轻点画面不 toggle 播放——与「只点底部播放」一致
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

    return new Promise((resolve, reject) => {
      resolveOpen = resolve;
      const onMeta = () => {
        video.removeEventListener("loadedmetadata", onMeta);
        video.removeEventListener("error", onErr);
        duration = Number(video.duration) || 0;
        const srcW = video.videoWidth || 1;
        const srcH = video.videoHeight || 1;
        const initial = opts.initial || {};
        // 方案/调用方 fps 先用上；后台探 MP4 stts（更准可覆盖）；无 stts 时不让 rVFC 盖掉已知值
        const knownFps = Number(opts.srcFps) || Number(initial.srcFps) || 0;
        const knownOk = applySourceFps(knownFps);
        detectAndApplySourceFps(file, { preferKnown: knownOk }).catch(() => {});
        startSec = clamp(Number(initial.trimStart) || 0, 0, Math.max(0, duration - MIN_SPAN));
        endSec = clamp(Number(initial.trimEnd) || duration, startSec + MIN_SPAN, duration || MIN_SPAN);
        endParkAtSec = endKeepSec();
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
        // 首帧 = 黄柄所见 = GIF 首帧
        seekPlayheadExact(startSec).catch(() => previewSeek(startSec));
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

  /**
   * 预览/成片共用 keep：按手柄秒值半开窗（≡预览 currentTime / 导出 PTS trim）。
   * - 黄柄 trimStart 含、trimEnd 不含
   * - 红柄闭区间删：上一段止于 cut.start；下一段从下一源采样起
   * 有 MP4 stts 时间轴时：用 CTS 表算 startF/endF 与下一段起点（根因对齐）。
   */
  function keepRangesFromEdit(edit, duration, timeline) {
    const fps =
      Number(timeline?.fps) >= 5 ? Number(timeline.fps) : resolveKeepFps(edit);
    const step = 1 / fps;
    const d = Math.max(0, Number(duration) || 0);
    let lo = Math.max(0, Number(edit?.trimStart) || 0);
    let hi = Math.max(lo + MIN_SPAN, Number(edit?.trimEnd) || 0);
    if (d > 0) hi = Math.min(hi, d);
    if (hi < lo + MIN_SPAN) hi = lo + MIN_SPAN;
    const cuts = normalizeCutouts(edit?.cutouts, lo, hi);
    const hasTl = Boolean(timeline?.ctsSec && timeline.ctsSec.length);
    const mp4Api =
      typeof window !== "undefined" && window.DevToolsMp4Timeline
        ? window.DevToolsMp4Timeline
        : null;
    const rangeOf = (a, b) => {
      if (hasTl && mp4Api?.sampleRangeForKeep) {
        return mp4Api.sampleRangeForKeep(timeline, a, b);
      }
      return {
        startF: displayFrameAtSec(a, fps),
        endF: Math.max(displayFrameAtSec(a, fps) + 1, displayFrameAtSec(b, fps)),
      };
    };
    const nextStartAfterCutEnd = (ce) => {
      if (hasTl && mp4Api?.sampleIndexAtSec) {
        const lastDel = mp4Api.sampleIndexAtSec(timeline, ce);
        const next = Math.min(timeline.ctsSec.length - 1, lastDel + 1);
        const t = Number(timeline.ctsSec[next]);
        if (Number.isFinite(t) && t > ce - 1e-6) return t;
      }
      return ce + step;
    };
    const keeps = [];
    let cur = lo;
    for (const c of cuts) {
      const cs = Math.max(cur, Number(c.start) || 0);
      const ce = Math.max(cs, Number(c.end) || 0);
      if (cs > cur + 1e-6) {
        const fr = rangeOf(cur, cs) || {};
        keeps.push({
          start: cur,
          end: cs,
          startF: fr.startF,
          endF: fr.endF,
        });
      }
      // 闭区间：删到 end 柄所见帧，下一段从下一源采样起
      cur = Math.max(cur, nextStartAfterCutEnd(ce));
    }
    if (hi > cur + 1e-6) {
      const fr = rangeOf(cur, hi) || {};
      keeps.push({
        start: cur,
        end: hi,
        startF: fr.startF,
        endF: fr.endF,
      });
    }
    if (!keeps.length) {
      const fr = rangeOf(lo, hi) || {};
      keeps.push({
        start: lo,
        end: hi,
        startF: fr.startF,
        endF: fr.endF,
      });
    }
    return keeps;
  }

  /**
   * 成片 keep ≡ 预览 keep（同一源帧半开窗）。根因修复：禁止再叠编码接点/片头片尾垫。
   */
  function keepRangesForEncode(edit, duration, timeline) {
    return keepRangesFromEdit(edit, duration, timeline);
  }

  /**
   * 外预览 / 编辑内播放：源时间若落在 keep 外（删中间 / 片头片尾外），返回应 seek 到的时间；否则 null。
   * keep 为半开 [start,end)；暂停停在末段最后一源帧（end - 1/fps）。
   * 播放与暂停同一停帧（end-1/fps）：点片尾±所见 = 播放最后一帧。
   * 调用方须先 pause 再 seek，避免解码器在 seek 前继续吐帧。
   * @param {{start:number,end:number}[]} keeps
   * @param {number} t
   * @param {{ paused?: boolean, endKeepSec?: number, srcFps?: number }} [opts]
   * @returns {number|null}
   */
  function previewSeekForKeepRanges(keeps, t, opts) {
    if (!Array.isArray(keeps) || !keeps.length) return null;
    const paused = Boolean(opts && opts.paused);
    const time = Number(t);
    if (!Number.isFinite(time)) return null;
    const first = keeps[0];
    const last = keeps[keeps.length - 1];
    const endEps = 0.0005;
    const startEps = 0.0005;
    const endKeep =
      Number(opts?.endKeepSec) > 0
        ? Number(opts.endKeepSec)
        : resolveEndKeepSec(opts?.srcFps || opts?.edit || 0);
    // 播放截断点 = 停帧（end-1/fps）；勿再提前整帧，否则片尾±预览与播放末帧错位
    const playEndPad = Math.max(endEps, endKeep);
    for (let i = 0; i < keeps.length; i++) {
      const k = keeps[i];
      const endLimit = paused ? k.end - endEps : k.end - playEndPad;
      if (time >= k.start - startEps && time < endLimit) return null;
    }
    if (time < first.start - startEps) return first.start + DISPLAY_SEEK_EPS;
    for (let i = 0; i < keeps.length; i++) {
      const nxt = keeps[i + 1];
      if (nxt && time < nxt.start) return nxt.start + DISPLAY_SEEK_EPS;
    }
    // 半开上界：暂停停在末帧起点，勿贴到 exclusive end（那一帧已不进 GIF）
    if (paused) return Math.max(last.start, last.end - endKeep) + DISPLAY_SEEK_EPS;
    return first.start + DISPLAY_SEEK_EPS;
  }

  function evenDim(n) {
    return Math.max(2, Math.round((Number(n) || 2) / 2) * 2);
  }

  function cropVfFromEdit(edit) {
    if (!edit?.cropOn || !edit.crop) return "";
    const x = Math.max(0, Math.round(Number(edit.crop.x) || 0));
    const y = Math.max(0, Math.round(Number(edit.crop.y) || 0));
    const w = evenDim(Math.max(2, Number(edit.crop.w) || 2));
    const h = evenDim(Math.max(2, Number(edit.crop.h) || 2));
    return `crop=${w}:${h}:${x}:${y}`;
  }

  /**
   * 所见即所得（保画质）：按预览 video 实际显示帧抽 VideoFrame → VideoEncoder → ffmpeg remux。
   * 与 captureStream 不同：逐帧取 Chrome 解码画面再高码率重编码，不对着屏幕实时录。
   * @returns {Promise<null|object>}
   */
  async function exportKeepByChromeDisplay(videoEl, keeps, opts = {}) {
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : () => {};
    if (!videoEl || !Array.isArray(keeps) || !keeps.length) return null;
    if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return null;
    if (opts.applyCrop) return null;

    const getFf =
      window.DevToolsFfmpeg?.getInstance || window.DevToolsExtraMedia?.getFfmpegInstance;
    if (typeof getFf !== "function") return null;

    const W = evenDim(videoEl.videoWidth || opts.srcW || 720);
    const H = evenDim(videoEl.videoHeight || opts.srcH || 404);
    if (!(W >= 2 && H >= 2)) return null;

    const keepFps = Math.max(5, Number(opts.keepFps) || 24);
    const timeline = opts.timeline || null;
    const durUs = Math.round(1e6 / keepFps);
    const wasMuted = videoEl.muted;
    const wasPaused = videoEl.paused;
    const resumeAt = Number(videoEl.currentTime) || 0;
    videoEl.muted = true;
    try {
      videoEl.pause();
    } catch (_) {}

    const waitPresented = () =>
      new Promise((resolve) => {
        if (typeof videoEl.requestVideoFrameCallback !== "function") {
          setTimeout(resolve, 40);
          return;
        }
        let done = false;
        const finish = (meta) => {
          if (done) return;
          done = true;
          resolve(meta || null);
        };
        try {
          videoEl.requestVideoFrameCallback((_n, meta) => finish(meta));
        } catch (_) {
          finish(null);
          return;
        }
        setTimeout(() => finish(null), 600);
      });

    const chunks = [];
    let encoderError = null;
    let encoder;
    try {
      encoder = new VideoEncoder({
        output: (chunk) => {
          if (!chunk) return;
          const buf = new Uint8Array(chunk.byteLength);
          chunk.copyTo(buf);
          chunks.push(buf);
        },
        error: (e) => {
          encoderError = e;
        },
      });
      const tryConfigs = [
        { codec: "avc1.640028", avc: { format: "annexb" }, bitrate: 12_000_000 },
        { codec: "avc1.42E01E", avc: { format: "annexb" }, bitrate: 8_000_000 },
        { codec: "avc1.640028", bitrate: 12_000_000 },
        { codec: "avc1.42E01E", bitrate: 8_000_000 },
      ];
      let configured = false;
      for (const cfg of tryConfigs) {
        try {
          const full = {
            width: W,
            height: H,
            framerate: keepFps,
            hardwareAcceleration: "prefer-hardware",
            ...cfg,
          };
          if (typeof VideoEncoder.isConfigSupported === "function") {
            const ok = await VideoEncoder.isConfigSupported(full).catch(() => null);
            if (ok && ok.supported === false) continue;
          }
          encoder.configure(full);
          configured = true;
          break;
        } catch (_) {}
      }
      if (!configured) return null;
    } catch (_) {
      return null;
    }

    const sliceLog = [];
    const segmentSpans = [];
    let outTs = 0;
    let outFrames = 0;
    const totalKeepFrames = keeps.reduce((s, k) => {
      const a = Number.isFinite(Number(k.startF)) ? Number(k.startF) : displayFrameAtSec(k.start, keepFps);
      const b = Number.isFinite(Number(k.endF)) ? Number(k.endF) : displayFrameAtSec(k.end, keepFps);
      return s + Math.max(1, b - a);
    }, 0);

    try {
      for (let ki = 0; ki < keeps.length; ki++) {
        if (opts.isAborted?.()) throw new Error("已取消");
        const k = keeps[ki];
        let startF = Number.isFinite(Number(k.startF))
          ? Math.round(Number(k.startF))
          : displayFrameAtSec(k.start, keepFps);
        let endF = Number.isFinite(Number(k.endF))
          ? Math.round(Number(k.endF))
          : displayFrameAtSec(k.end, keepFps);
        if (endF <= startF) endF = startF + 1;
        const segStartTs = outTs;
        for (let fi = startF; fi < endF; fi++) {
          if (encoderError) throw encoderError;
          const seekT = timeline?.ctsSec?.[fi]
            ? Number(timeline.ctsSec[fi]) + DISPLAY_SEEK_EPS
            : frameToSec(fi, keepFps) + DISPLAY_SEEK_EPS;
          videoEl.currentTime = Math.max(0, seekT);
          await waitSeek(videoEl);
          await waitPresented();
          let frame;
          try {
            frame = new VideoFrame(videoEl, {
              timestamp: outTs,
              duration: durUs,
            });
          } catch (_) {
            // 部分机型需 canvas 中转
            const c = document.createElement("canvas");
            c.width = W;
            c.height = H;
            const ctx = c.getContext("2d", { alpha: false });
            if (!ctx) throw new Error("无法读取预览帧");
            ctx.drawImage(videoEl, 0, 0, W, H);
            frame = new VideoFrame(c, { timestamp: outTs, duration: durUs });
          }
          const keyFrame = outFrames % Math.max(1, Math.round(keepFps)) === 0;
          try {
            while (encoder.encodeQueueSize > 4) {
              await new Promise((r) => setTimeout(r, 8));
            }
            encoder.encode(frame, { keyFrame });
          } finally {
            try {
              frame.close();
            } catch (_) {}
          }
          outTs += durUs;
          outFrames += 1;
          if (outFrames % 8 === 0 || outFrames === 1) {
            onProgress(
              0.08 + (outFrames / Math.max(1, totalKeepFrames)) * 0.75,
              `对齐预览帧 ${outFrames}/${totalKeepFrames}`
            );
          }
        }
        const spanSec = Math.max(0.05, (outTs - segStartTs) / 1e6);
        segmentSpans.push(spanSec);
        sliceLog.push({
          i: ki,
          mode: "chrome-VideoFrame",
          startF,
          endF,
          start: Number(k.start) || 0,
          end: Number(k.end) || 0,
          spanSec,
        });
      }
      await encoder.flush();
      encoder.close();
      if (encoderError) throw encoderError;
      if (!chunks.length || !outFrames) return null;

      onProgress(0.88, "封装 MP4…");
      const ffmpeg = opts.ffmpeg || (await getFf((r, t) => onProgress(0.88 + r * 0.1, t || "封装…")));
      if (!ffmpeg) return null;
      let total = 0;
      for (const c of chunks) total += c.byteLength;
      const annexb = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        annexb.set(c, off);
        off += c.byteLength;
      }
      const h264Name = "chrome-keep.h264";
      const outName = "chrome-keep.mp4";
      await ffmpeg.writeFile(h264Name, annexb);
      const code = await ffmpeg
        .exec([
          "-f",
          "h264",
          "-r",
          String(keepFps),
          "-i",
          h264Name,
          "-c",
          "copy",
          "-movflags",
          "+faststart",
          "-y",
          outName,
        ])
        .catch(() => 1);
      if (code !== 0) {
        // 非 annexb 时尝试按 raw H264 再包一层
        const code2 = await ffmpeg
          .exec([
            "-framerate",
            String(keepFps),
            "-i",
            h264Name,
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-crf",
            "18",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-y",
            outName,
          ])
          .catch(() => 1);
        if (code2 !== 0) return null;
      }
      const data = await ffmpeg.readFile(outName);
      const raw = data instanceof Uint8Array ? data : new Uint8Array(data);
      const bytes = new Uint8Array(raw.byteLength);
      bytes.set(raw);
      try {
        await ffmpeg.deleteFile(h264Name);
      } catch (_) {}
      try {
        await ffmpeg.deleteFile(outName);
      } catch (_) {}
      const blob = new Blob([bytes], { type: "video/mp4" });
      if (!blob.size) return null;
      const filename =
        String(opts.filenameBase || "video").replace(/\.[^.]+$/, "") + "-edit.mp4";
      return {
        blob,
        file: new File([blob], filename, { type: "video/mp4" }),
        filename,
        duration: segmentSpans.reduce((s, x) => s + x, 0),
        srcW: W,
        srcH: H,
        segmentSpans,
        keeps,
        sliceLog,
        keepFps,
        exportMethod: "chrome-VideoFrame",
        mp4Timeline: timeline
          ? {
              fps: timeline.fps,
              fpsRaw: timeline.fpsRaw,
              sampleCount: timeline.sampleCount,
              hasCtts: Boolean(timeline.hasCtts),
              elstMediaTime: timeline.elstMediaTime || 0,
              firstPresentIdx: timeline.firstPresentIdx || 0,
            }
          : null,
      };
    } catch (_) {
      try {
        encoder?.close();
      } catch (_) {}
      return null;
    } finally {
      videoEl.muted = wasMuted;
      try {
        videoEl.pause();
      } catch (_) {}
      try {
        videoEl.currentTime = resumeAt;
        await waitSeek(videoEl);
      } catch (_) {}
      if (!wasPaused) {
        try {
          videoEl.play().catch(() => {});
        } catch (_) {}
      }
    }
  }

  /**
   * 按 keepRangesForEncode 切出 trim+cutouts 后的 mp4（wasm ffmpeg）。
   * @returns {Promise<{ file: File, blob: Blob, duration: number, srcW: number, srcH: number, filename: string }>}
   */
  async function exportKeepVideo(file, edit, duration, opts = {}) {
    const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : () => {};
    const getFf =
      window.DevToolsFfmpeg?.getInstance || window.DevToolsExtraMedia?.getFfmpegInstance;
    const writeIn =
      window.DevToolsFfmpeg?.ensureInputWritten || window.DevToolsExtraMedia?.ensureFfmpegInputWritten;
    if (typeof getFf !== "function" || typeof writeIn !== "function") {
      throw new Error("编码器未就绪，请稍等本机 FFmpeg 加载后再试");
    }
    const ffmpeg =
      opts.ffmpeg || (await getFf((r, t) => onProgress(r, t || "准备编码器…")));
    if (!ffmpeg) throw new Error("无法加载编码器");

    let timeline = opts.timeline || null;
    let timelineErr = "";
    if (!timeline?.ctsSec) {
      try {
        if (!window.DevToolsMp4Timeline?.probeMp4VideoTimeline && window.DevToolsLazy?.loadScript) {
          await window.DevToolsLazy
            .loadScript("./lib/mp4-timeline.js", { timeoutMs: 12000, label: "片源时间轴" })
            .catch((e) => {
              timelineErr = String(e?.message || e || "load failed");
            });
        }
        const probe = window.DevToolsMp4Timeline?.probeMp4VideoTimeline;
        if (typeof probe === "function") {
          onProgress(0.03, "读取片源时间轴…");
          timeline = await probe(file);
          if (!timeline?.ok) timelineErr = timelineErr || "probe-null";
        } else if (!timelineErr) {
          timelineErr = "api-missing";
        }
      } catch (e) {
        timeline = null;
        timelineErr = String(e?.message || e || "probe-throw");
      }
    }
    if (timeline?.fps >= 5 && !(Number(edit?.srcFps) >= 5)) {
      try {
        edit = { ...edit, srcFps: timeline.fps };
      } catch (_) {}
    }

    const keeps =
      Array.isArray(opts.keeps) && opts.keeps.length
        ? opts.keeps
        : keepRangesForEncode(edit, duration, timeline);
    if (!keeps.length) throw new Error("没有可保留的片段");
    const inName = await writeIn(ffmpeg, file, () => onProgress(0.05, "载入视频…"));
    const srcW = Math.max(2, Number(opts.srcW) || 720);
    const srcH = Math.max(2, Number(opts.srcH) || 404);
    const W = evenDim(srcW);
    const H = evenDim(srcH);
    const cropVf = opts.applyCrop ? cropVfFromEdit(edit) : "";
    const keepFps =
      Number(timeline?.fps) >= 5 ? Number(timeline.fps) : resolveKeepFps(edit);
    const preferSampleFrames = Boolean(timeline?.ctsSec && timeline.ctsSec.length);
    // 已知 fps 时也可用 displayFrame 帧号（Chrome 规则）；有 stts 则更准
    const preferFrame =
      preferSampleFrames ||
      (keepFps >= 5 &&
        keeps.every(
          (k) => Number.isFinite(Number(k.startF)) && Number.isFinite(Number(k.endF))
        ));
    const needScale = Boolean(cropVf) || srcW !== W || srcH !== H;
    const fmtSec = (t) => {
      const n = Math.max(0, Number(t) || 0);
      return (Math.round(n * 1e6) / 1e6).toFixed(6);
    };
    const resolveBounds = (k) => {
      let start = Math.max(0, Number(k.start) || 0);
      let end = Math.max(start + 0.05, Number(k.end) || 0);
      let startF = Number.isFinite(Number(k.startF))
        ? Math.round(Number(k.startF))
        : displayFrameAtSec(start, keepFps);
      let endF = Number.isFinite(Number(k.endF))
        ? Math.round(Number(k.endF))
        : displayFrameAtSec(end, keepFps);
      if (preferSampleFrames && window.DevToolsMp4Timeline?.sampleRangeForKeep) {
        const fr = window.DevToolsMp4Timeline.sampleRangeForKeep(timeline, start, end);
        if (fr) {
          startF = fr.startF;
          endF = fr.endF;
        }
        // 用采样 CTS 作半开秒窗 ≡ 预览停帧，避免手柄毫秒落在帧中部
        const cts = timeline.ctsSec;
        if (cts && cts.length) {
          const t0 = Number(cts[Math.min(startF, cts.length - 1)]);
          const t1 =
            endF < cts.length
              ? Number(cts[endF])
              : Number(cts[cts.length - 1]) + 1 / keepFps;
          if (Number.isFinite(t0) && Number.isFinite(t1) && t1 > t0 + 1e-4) {
            start = Math.max(0, t0);
            end = Math.max(start + 0.05, t1);
          }
        }
      }
      if (endF <= startF) endF = startF + 1;
      // ffmpeg start_frame 从 demux 后第 0 帧计（editlist 后），不是裸 stts 下标
      let demuxStartF = startF;
      let demuxEndF = endF;
      if (preferSampleFrames && window.DevToolsMp4Timeline?.toDemuxFrameIndex) {
        demuxStartF = window.DevToolsMp4Timeline.toDemuxFrameIndex(timeline, startF);
        demuxEndF = window.DevToolsMp4Timeline.toDemuxFrameIndex(timeline, endF);
        if (demuxEndF <= demuxStartF) demuxEndF = demuxStartF + 1;
      }
      return {
        start,
        end,
        startF,
        endF,
        demuxStartF,
        demuxEndF,
        dur: Math.max(0.05, end - start),
      };
    };

    const x264 = [
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-crf",
      "18",
      "-bf",
      "0",
      "-g",
      "1",
      "-keyint_min",
      "1",
      "-sc_threshold",
      "0",
      "-pix_fmt",
      "yuv420p",
      "-vsync",
      "passthrough",
      "-movflags",
      "+faststart",
    ];

    const tailVf = [
      cropVf,
      needScale ? `scale=${W}:${H}:force_original_aspect_ratio=decrease` : "",
      needScale ? `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2` : "",
      "setsar=1",
      "format=yuv420p",
    ]
      .filter(Boolean)
      .join(",");

    /** 单次滤镜：各 keep trim 后 concat，避免分段再编码在接点丢帧 */
    const tryOnePass = async (mode) => {
      const useFrame = mode === "frameRaw";
      const chains = [];
      const labels = [];
      const log = [];
      const spans = [];
      for (let i = 0; i < keeps.length; i++) {
        const b = resolveBounds(keeps[i]);
        // 勿在 trim 前 setpts：PTS ≡ Chrome currentTime（editlist 后）
        // sec：用采样 CTS 半开秒；frameRaw：demux 相对帧号
        const trim = useFrame
          ? `trim=start_frame=${b.demuxStartF}:end_frame=${b.demuxEndF},setpts=PTS-STARTPTS`
          : `trim=start=${fmtSec(b.start)}:end=${fmtSec(b.end)},setpts=PTS-STARTPTS`;
        const vf = [trim, tailVf].filter(Boolean).join(",");
        chains.push(`[0:v]${vf}[k${i}]`);
        labels.push(`[k${i}]`);
        const spanSec = useFrame
          ? (b.demuxEndF - b.demuxStartF) / keepFps
          : b.dur;
        spans.push(Math.max(0.05, spanSec));
        log.push({
          i,
          mode: `onepass-${mode}`,
          startF: b.startF,
          endF: b.endF,
          demuxStartF: b.demuxStartF,
          demuxEndF: b.demuxEndF,
          start: b.start,
          end: b.end,
          spanSec: spans[i],
        });
      }
      const filter =
        keeps.length === 1
          ? `${chains[0].replace("[k0]", "[v]")}`
          : `${chains.join(";")};${labels.join("")}concat=n=${keeps.length}:v=1:a=0[v]`;
      const out = "keep-onepass.mp4";
      const args = ["-i", inName, "-filter_complex", filter, "-map", "[v]", "-an", ...x264, "-y", out];
      const code = await ffmpeg.exec(args).catch(() => 1);
      if (code !== 0) return null;
      try {
        const data = await ffmpeg.readFile(out);
        const n = data instanceof Uint8Array ? data.byteLength : Number(data?.length) || 0;
        if (n < 512) return null;
      } catch (_) {
        return null;
      }
      return { out, segmentSpans: spans, sliceLog: log, mode: `onepass-${mode}` };
    };

    onProgress(0.1, "一次精切…");
    // 有采样表：先 CTS 秒（≡预览 currentTime），再 demux 帧号；避免 stts 下标当 start_frame 切偏
    const onePassModes = preferSampleFrames
      ? ["sec", "frameRaw"]
      : preferFrame
        ? ["frameRaw", "sec"]
        : ["sec", "frameRaw"];
    let hit = null;
    for (const mode of onePassModes) {
      hit = await tryOnePass(mode);
      if (hit) break;
    }

    let segmentSpans = hit?.segmentSpans || [];
    let sliceLog = hit?.sliceLog || [];
    let merged = hit?.out || "";
    let exportMethod = hit ? `ffmpeg-${hit.mode}` : "ffmpeg";
    const parts = [];

    if (!hit) {
      // 回退：逐段 trim（旧路径）；仍去掉 trim 前的 setpts
      const MIN_PART_BYTES = 512;
      const trySlice = async (k, i, mode) => {
        const b = resolveBounds(k);
        const out = `keep${i}.mp4`;
        const useGrid = mode === "frameGrid";
        const useFrame = mode === "frameRaw" || mode === "frameGrid" || mode === "frame";
        const trimVf = useFrame
          ? `trim=start_frame=${b.demuxStartF}:end_frame=${b.demuxEndF},setpts=PTS-STARTPTS`
          : mode === "sec"
            ? `trim=start=${fmtSec(b.start)}:end=${fmtSec(b.end)},setpts=PTS-STARTPTS`
            : "";
        const vfCore = [
          useGrid ? `fps=${keepFps}:round=up` : "",
          trimVf,
          tailVf,
        ]
          .filter(Boolean)
          .join(",");
        const args =
          mode === "ss"
            ? ["-i", inName, "-ss", fmtSec(b.start), "-t", fmtSec(b.dur), "-an", "-vf", vfCore]
            : ["-i", inName, "-an", "-vf", vfCore];
        args.push(...x264, "-y", out);
        const code = await ffmpeg.exec(args).catch(() => 1);
        if (code !== 0) return null;
        try {
          const data = await ffmpeg.readFile(out);
          const n = data instanceof Uint8Array ? data.byteLength : Number(data?.length) || 0;
          if (n < MIN_PART_BYTES) return null;
        } catch (_) {
          return null;
        }
        const spanSec = useFrame ? (b.endF - b.startF) / keepFps : b.dur;
        return { out, spanSec, mode, startF: b.startF, endF: b.endF, start: b.start, end: b.end };
      };
      for (let i = 0; i < keeps.length; i++) {
        onProgress(0.12 + (i / keeps.length) * 0.5, `切片 ${i + 1}/${keeps.length}`);
        const modes = preferFrame
          ? ["frameRaw", "sec", "ss", "frameGrid"]
          : ["sec", "ss", "frameRaw", "frameGrid"];
        let one = null;
        for (const mode of modes) {
          one = await trySlice(keeps[i], i, mode);
          if (one) break;
        }
        if (!one) throw new Error(`切片失败（段 ${i + 1}/${keeps.length}）`);
        parts.push(one.out);
        segmentSpans.push(Math.max(0.05, Number(one.spanSec) || 0));
        sliceLog.push({
          i,
          mode: one.mode,
          startF: one.startF,
          endF: one.endF,
          start: one.start,
          end: one.end,
          spanSec: Number(one.spanSec) || 0,
        });
      }
      onProgress(0.7, "拼接…");
      merged = parts[0];
      if (parts.length > 1) {
        merged = "keep-merged.mp4";
        const norm = parts.map((_, i) => `[${i}:v]format=yuv420p,setsar=1[v${i}]`).join(";");
        const cat = parts.map((_, i) => `[v${i}]`).join("") + `concat=n=${parts.length}:v=1:a=0[v]`;
        const runConcat = async (filter) => {
          const args = [];
          parts.forEach((p) => args.push("-i", p));
          args.push("-filter_complex", filter, "-map", "[v]", "-an", ...x264, "-y", merged);
          return ffmpeg.exec(args).catch(() => 1);
        };
        let code = await runConcat(`${norm};${cat}`);
        if (code !== 0) {
          code = await runConcat(
            parts.map((_, i) => `[${i}:v]`).join("") + `concat=n=${parts.length}:v=1:a=0[v]`
          );
        }
        if (code !== 0) throw new Error(`拼接失败（${parts.length} 段 keep）`);
      }
      exportMethod = "ffmpeg-segmented";
    }

    const filename = String(file?.name || "video").replace(/\.[^.]+$/, "") + "-edit.mp4";
    const data = await ffmpeg.readFile(merged);
    const raw = data instanceof Uint8Array ? data : new Uint8Array(data);
    const bytes = new Uint8Array(raw.byteLength);
    bytes.set(raw);
    const blob = new Blob([bytes], { type: "video/mp4" });
    const outFile = new File([blob], filename, { type: "video/mp4" });
    for (const p of parts) {
      try {
        await ffmpeg.deleteFile(p);
      } catch (_) {}
    }
    if (merged && merged !== parts[0]) {
      try {
        await ffmpeg.deleteFile(merged);
      } catch (_) {}
    }
    const totalSpan = segmentSpans.reduce((s, d) => s + Math.max(0, d), 0);
    onProgress(1, "完成");
    return {
      file: outFile,
      blob,
      duration: totalSpan,
      srcW: W,
      srcH: H,
      filename,
      segmentSpans,
      keepFps,
      slicedByFrame: /frame/i.test(String(sliceLog[0]?.mode || "")),
      exportMethod,
      keeps: keeps.map((k) => ({
        start: Number(k.start) || 0,
        end: Number(k.end) || 0,
        startF: Number.isFinite(Number(k.startF)) ? Number(k.startF) : null,
        endF: Number.isFinite(Number(k.endF)) ? Number(k.endF) : null,
      })),
      sliceLog,
      timelineErr: timelineErr || null,
      mp4Timeline: timeline
        ? {
            fps: timeline.fps,
            fpsRaw: timeline.fpsRaw,
            sampleCount: timeline.sampleCount,
            hasCtts: Boolean(timeline.hasCtts),
            elstMediaTime: timeline.elstMediaTime || 0,
            firstPresentIdx: timeline.firstPresentIdx || 0,
          }
        : null,
    };
  }

  window.DevToolsVtrimEditor = {
    open: openEditor,
    ensureCss: ensureVtrimCss,
    normalizeCutouts,
    keepRangesFromEdit,
    keepRangesForEncode,
    previewSeekForKeepRanges,
    exportKeepVideo,
    exportKeepByChromeDisplay,
    estimateFpsFromMediaTimes,
    normalizeSourceFps,
    frameSnapSecFromFps,
    resolveKeepFps,
    secToFrame,
    frameToSec,
    displayFrameAtSec,
    displaySeekSec,
    resolveEndKeepSec,
    resolveStartKeepSec,
    DEFAULT_FRAME_FPS,
    END_KEEP_SEC,
    START_KEEP_SEC,
    ENCODE_BOUND_PAD_SEC,
    ENCODE_CUT_JUNCTION_PAD_FRAMES,
    FRAME_SNAP_SEC,
  };
})();
