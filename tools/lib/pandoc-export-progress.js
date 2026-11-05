(() => {
  "use strict";

  /**
   * Pandoc 长导出进度弹框（MDM / 文档互转共用）。
   * 仅在 convert 进行中轮询 /pandoc/progress；结束 / Esc / 取消必须停。
   */
  const HOST_ID = "devtools-pandoc-export-modal";
  const BOX_ID = "devtools-pandoc-export-modal-box";
  const UID = "dt-pandoc-export";

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function ensureHost() {
    let modal = document.getElementById(HOST_ID);
    if (modal) {
      return { modal, box: document.getElementById(BOX_ID) || modal.querySelector(".dt-pandoc-export-box") };
    }
    modal = document.createElement("div");
    modal.id = HOST_ID;
    modal.className = "dt-pandoc-export-modal";
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    const box = document.createElement("div");
    box.id = BOX_ID;
    box.className = "dt-pandoc-export-box";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "Pandoc 导出进度");
    modal.appendChild(box);
    document.body.appendChild(modal);
    return { modal, box };
  }

  /** @type {null | ReturnType<typeof open>} */
  let activeCtl = null;

  /**
   * @param {string} toLabel
   * @param {{
   *   baseUrl: () => string,
   *   token: () => string,
   *   onCancel?: () => void,
   *   hint?: string,
   *   modal?: HTMLElement | null,
   *   modalBox?: HTMLElement | null,
   *   idPrefix?: string,
   * }} opts
   */
  function open(toLabel, opts = {}) {
    try {
      activeCtl?.stop?.();
    } catch (_) {}
    activeCtl = null;

    const host = opts.modal && opts.modalBox ? { modal: opts.modal, box: opts.modalBox } : ensureHost();
    const { modal, box } = host;
    if (!modal || !box) throw new Error("进度弹框容器不可用");

    const prefix = String(opts.idPrefix || UID).replace(/[^a-zA-Z0-9_-]/g, "") || UID;
    const id = (name) => `${prefix}-${name}`;
    const t0 = Date.now();
    let stopped = false;
    let tick = null;
    let pollTimer = null;
    let cancelled = false;
    let lastPct = 0;
    let pollStarted = false;
    let convertPosted = false;

    const hint =
      opts.hint ||
      "进度条来自本机桥（XeLaTeX 页码 / Pandoc 阶段）。PDF <strong>无超时</strong>，跑完为止。";

    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    box.innerHTML =
      `<div class="mdm-modal-head dt-pandoc-export-head"><strong>正在导出 ${escapeHtml(toLabel)}</strong></div>` +
      `<div class="mdm-modal-body dt-pandoc-export-body" style="text-align:left">` +
      `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin:0 0 6px">` +
      `<p id="${id("stage")}" style="margin:0">准备中…</p>` +
      `<p class="mono" id="${id("pct")}" style="margin:0;font-weight:700">0%</p>` +
      `</div>` +
      `<div class="gif-progress" style="margin:0 0 10px" aria-hidden="true">` +
      `<div class="gif-progress-track"><span class="gif-progress-fill" id="${id("fill")}" style="width:0%;transition:width .35s ease"></span></div>` +
      `</div>` +
      `<p class="hint tight" id="${id("detail")}" style="margin:0 0 8px;min-height:1.2em"></p>` +
      `<p class="hint tight" id="${id("pages")}" style="margin:0 0 8px;min-height:1.2em"></p>` +
      `<p class="hint tight" id="${id("alive")}" style="margin:0 0 8px;min-height:1.2em;font-weight:600">浏览器准备中（尚未连桥）…</p>` +
      `<p class="hint tight" id="${id("lastlog")}" style="margin:0 0 8px;min-height:1.2em;word-break:break-all"></p>` +
      `<p class="hint tight">${hint}</p>` +
      `</div>` +
      `<div class="mdm-modal-foot dt-pandoc-export-foot" style="flex-wrap:wrap;gap:8px;justify-content:space-between;align-items:center">` +
      `<p class="hint tight" id="${id("elapsed")}" style="margin:0">已用时 0 秒</p>` +
      `<button type="button" class="ghost-btn" id="${id("cancel")}">取消导出</button>` +
      `</div>`;

    const el = (name) => document.getElementById(id(name));

    const setAliveText = (text, color) => {
      const a = el("alive");
      if (!a) return;
      a.textContent = text;
      a.style.color = color || "";
    };

    const setLocal = (stage, detail = "") => {
      if (stopped) return;
      const s = el("stage");
      const d = el("detail");
      if (s) s.textContent = stage || "处理中…";
      if (d) d.textContent = detail || "";
      if (!pollStarted) {
        setAliveText("浏览器本地准备中（还没问桥）…", "");
      } else if (!convertPosted) {
        setAliveText("已开始轮询桥进度…", "");
      }
    };

    const setLocalPct = (pct) => {
      if (stopped) return;
      let n = Math.round(Number(pct) || 0);
      if (n < lastPct) n = lastPct;
      lastPct = n;
      const pctNode = el("pct");
      const fill = el("fill");
      if (pctNode) pctNode.textContent = `${n}%`;
      if (fill) fill.style.width = `${n}%`;
    };

    const setAliveUi = (data) => {
      if (stopped || !data) return;
      const a = el("alive");
      const lg = el("lastlog");
      const elapsedNode = el("elapsed");
      const pg = el("pages");
      const hb = data.heartbeatAgeSec != null ? Number(data.heartbeatAgeSec) : null;
      let pct = Math.round(Number(data.percent) || 0);
      if (pct < lastPct) pct = lastPct;
      lastPct = pct;
      setLocalPct(pct);
      if (pg) {
        const bits = [];
        if (data.page > 0 && data.pageEst > 0) {
          bits.push(`排版约第 ${data.page} / ${data.pageEst} 页`);
        } else if (data.pageEst > 0) {
          bits.push(`估约 ${data.pageEst} 页（尚未打出页码）`);
        }
        if (data.pass > 0) {
          bits.push(`第 ${data.pass}/${data.passMax || 3} 遍`);
        }
        if (data.phase === "packages") {
          bits.push(`装宏包${data.pkgCount ? ` · ${data.pkgCount} 条日志` : ""}`);
        }
        if (data.percentSource === "pages") bits.push("按页码计");
        else if (data.percentSource === "packages") bits.push("装包中");
        else if (data.percentSource === "estimate") bits.push("估算");
        else if (data.percentSource === "stage") bits.push("阶段");
        pg.textContent = bits.join(" · ");
      }
      if (a) {
        if (data.active && data.alive) {
          a.textContent =
            hb != null ? `● 桥进度正常（心跳 ${hb}s 前）` : "● 桥进度正常";
          a.style.color = "var(--ok, #15803d)";
        } else if (data.active) {
          a.textContent =
            hb != null
              ? `○ 超过 ${hb}s 无心跳 — 可能卡住，可看黑窗或取消`
              : "○ 暂无心跳 — 可能卡住，可看黑窗或取消";
          a.style.color = "var(--warn, #b45309)";
        } else if (convertPosted) {
          a.textContent = "桥暂无活跃任务（可能在排队/刚结束）";
          a.style.color = "var(--warn, #b45309)";
        } else {
          a.textContent = "已连上桥，等待开始上传…";
          a.style.color = "";
        }
      }
      if (lg) {
        const bits = [];
        if (data.lastLog) bits.push(`最近：${data.lastLog}`);
        if (data.outPdfBytes > 0) {
          bits.push(`临时 PDF ${Math.round(data.outPdfBytes / 1024)} KB`);
        }
        lg.textContent = bits.join(" · ");
      }
      if (elapsedNode && data.elapsedSec != null) {
        elapsedNode.textContent = `已用时 ${data.elapsedSec} 秒 · 无超时上限${
          data.active ? (data.alive ? " · 进行中" : " · 无心跳") : ""
        }`;
      }
    };

    const stop = () => {
      if (stopped) return;
      stopped = true;
      if (tick) clearInterval(tick);
      if (pollTimer) clearInterval(pollTimer);
      tick = null;
      pollTimer = null;
      if (activeCtl && activeCtl.stop === stop) activeCtl = null;
      document.removeEventListener("keydown", onKey);
    };

    const close = () => {
      stop();
      if (modal && !modal.hidden) {
        modal.hidden = true;
        modal.setAttribute("aria-hidden", "true");
        box.innerHTML = "";
      }
    };

    const onCancelClick = () => {
      cancelled = true;
      try {
        opts.onCancel?.();
      } catch (_) {}
      setLocal("已取消", "正在中止请求…");
      stop();
      if (modal && !modal.hidden) {
        modal.hidden = true;
        modal.setAttribute("aria-hidden", "true");
        box.innerHTML = "";
      }
    };

    el("cancel")?.addEventListener("click", onCancelClick);

    function onKey(e) {
      if (e.key === "Escape" && !stopped && modal && !modal.hidden) {
        e.preventDefault();
        onCancelClick();
      }
    }
    document.addEventListener("keydown", onKey);

    tick = setInterval(() => {
      if (stopped || modal?.hidden || !el("stage")) {
        stop();
        return;
      }
      const elapsedNode = el("elapsed");
      if (elapsedNode && !elapsedNode.dataset.fromBridge) {
        const sec = Math.round((Date.now() - t0) / 1000);
        elapsedNode.textContent =
          sec >= 480
            ? `已用时 ${sec} 秒 · 大文档仍可能在排版；看上方「仍在转换」`
            : `已用时 ${sec} 秒`;
      }
    }, 500);

    const startPoll = () => {
      if (stopped || pollTimer) return;
      pollStarted = true;
      setAliveText("正在拉取桥进度…", "");
      const poll = async () => {
        if (stopped || modal?.hidden || !el("stage")) {
          stop();
          return;
        }
        try {
          const base = String(typeof opts.baseUrl === "function" ? opts.baseUrl() : opts.baseUrl || "")
            .replace(/\/$/, "");
          const tok = String(typeof opts.token === "function" ? opts.token() : opts.token || "").trim();
          const res = await fetch(`${base}/pandoc/progress`, {
            headers: { "X-Adb-Token": tok, "X-Ffmpeg-Token": tok },
            cache: "no-store",
          });
          const data = await res.json().catch(() => null);
          if (stopped) return;
          if (res.status === 404) {
            setAliveText(
              "桥过旧无 /progress（请退出黑窗重启更新）；转换可能仍在黑窗进行",
              "var(--warn, #b45309)"
            );
            return;
          }
          if (!res.ok) {
            setAliveText(
              `进度接口失败 HTTP ${res.status}${data?.error ? ` · ${data.error}` : ""}`,
              "var(--warn, #b45309)"
            );
            return;
          }
          if (data) {
            if (data.stage) {
              const s = el("stage");
              const d = el("detail");
              if (s) s.textContent = data.stage;
              if (d) d.textContent = data.detail || "";
            }
            const elapsedNode = el("elapsed");
            if (elapsedNode) elapsedNode.dataset.fromBridge = "1";
            setAliveUi(data);
            try {
              ctl.onProgress?.(data);
            } catch (_) {}
          }
        } catch (err) {
          setAliveText(
            `拉进度失败：${String(err?.message || err).slice(0, 80)}（转换可能仍在进行，请看黑窗）`,
            "var(--warn, #b45309)"
          );
        }
      };
      void poll();
      pollTimer = setInterval(poll, 1000);
    };

    const ctl = {
      setLocal,
      setLocalPct,
      setAliveText,
      setAliveUi,
      startPoll,
      markConvertPosted() {
        convertPosted = true;
      },
      stop,
      onProgress: null,
      wasCancelled: () => cancelled,
      close,
    };
    activeCtl = ctl;
    return ctl;
  }

  window.DevToolsPandocExportProgress = {
    ensureHost,
    open,
    get active() {
      return activeCtl;
    },
  };
})();
