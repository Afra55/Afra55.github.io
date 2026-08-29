(() => {
  "use strict";

  const P = window.DevToolsPure;
  const DC = window.DiffCore;
  if (!P || !DC) return;

  const $ = (sel, root = document) => root.querySelector(sel);

  const DIFF_ROW_PX = 24;
  const DIFF_OVERSCAN = 12;
  const DIFF_RENDER_CAP = 12000;

  let diffWorker = null;
  let diffJobId = 0;
  let diffBusy = false;
  let diffTimer = 0;
  let diffView = {
    mode: "split",
    rows: [],
    aligned: [],
    unified: [],
    changeIdx: [],
    scrollKey: 0,
  };

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

  function diffOptsFromUi() {
    return {
      ignoreWhitespace: Boolean($("#diff-ignore-ws")?.checked),
      trimTrailing: Boolean($("#diff-trim-trail")?.checked),
    };
  }

  function isDiffPanelActive() {
    const panel = $("#diff");
    return !!(panel && panel.classList.contains("is-workspace-active") && !panel.hidden);
  }

  function ensureDiffWorker() {
    if (diffWorker) return diffWorker;
    if (typeof Worker === "undefined") return null;
    try {
      const ver = window.TOOLS_VERSION || "";
      diffWorker = new Worker(`./lib/diff-worker.js?v=${encodeURIComponent(ver)}`);
      diffWorker.onmessage = (ev) => {
        const data = ev.data || {};
        if (data.id !== diffJobId) return;
        diffBusy = false;
        if (!data.ok) {
          renderDiffError(data.error, data.code);
          return;
        }
        applyDiffResult(data.rows, data.aligned, data.stats);
      };
      diffWorker.onerror = () => {
        diffBusy = false;
        diffWorker = null;
        runTextDiffSync();
      };
    } catch (_) {
      diffWorker = null;
    }
    return diffWorker;
  }

  function escapeHtml(str) {
    return DC.escapeHtml(str);
  }

  function renderPlainLine(text, kind) {
    if (kind === "empty" || !text) return "&nbsp;";
    const raw = String(text);
    const clipped = raw.length > 8000 ? `${raw.slice(0, 8000)}…` : raw;
    const safe = escapeHtml(clipped).replace(/ /g, "&nbsp;");
    if (kind === "same") return safe;
    return `<span class="diff-line-${kind}">${safe}</span>`;
  }

  function renderChangeSide(left, right, side) {
    try {
      const parts = DC.diffChars(left || "", right || "");
      return DC.diffCharHtml(side === "left" ? parts.left : parts.right, side);
    } catch (_) {
      return renderPlainLine(side === "left" ? left : right, side === "left" ? "del" : "add");
    }
  }

  function buildUnifiedRows(rows, hideSame) {
    const list = hideSame ? rows.filter((r) => r.type !== "same") : rows;
    return list.slice(0, DIFF_RENDER_CAP);
  }

  function buildAlignedRows(aligned, hideSame) {
    const list = hideSame ? aligned.filter((r) => r.kind !== "same") : aligned;
    return list.slice(0, DIFF_RENDER_CAP);
  }

  function collectChangeIndices(rows, aligned, mode) {
    const idx = [];
    if (mode === "unified") {
      rows.forEach((r, i) => {
        if (r.type !== "same") idx.push(i);
      });
    } else {
      aligned.forEach((r, i) => {
        if (r.kind !== "same") idx.push(i);
      });
    }
    return idx;
  }

  function updateDiffNav() {
    const prev = $("#diff-prev");
    const next = $("#diff-next");
    const has = diffView.changeIdx.length > 0;
    if (prev) prev.disabled = !has;
    if (next) next.disabled = !has;
  }

  function renderDiffError(message, code) {
    const meta = $("#diff-meta");
    const splitOut = $("#diff-split-out");
    const unifiedOut = $("#diff-out");
    if (meta) {
      meta.textContent =
        code === "DIFF_TOO_LARGE" ? message : message || "比对失败";
    }
    if (splitOut) splitOut.innerHTML = "";
    if (unifiedOut) unifiedOut.innerHTML = "";
    diffView.changeIdx = [];
    updateDiffNav();
  }

  function rowHtmlUnified(row) {
    if (row.type === "change") {
      const ch = DC.diffChars(row.left || "", row.right || "");
      const leftHtml = DC.diffCharHtml(ch.left, "left");
      const rightHtml = DC.diffCharHtml(ch.right, "right");
      return `<div class="diff-change"><div class="diff-change-side diff-change-old"><span class="diff-mark">−</span>${leftHtml}</div><div class="diff-change-side diff-change-new"><span class="diff-mark">+</span>${rightHtml}</div></div>`;
    }
    const cls = row.type === "add" ? "diff-add" : row.type === "del" ? "diff-del" : "diff-same";
    const mark = row.type === "add" ? "+" : row.type === "del" ? "-" : " ";
    return `<div class="${cls}"><span class="diff-mark">${mark}</span>${escapeHtml(row.text)}</div>`;
  }

  function rowHtmlSplit(row) {
    const lk = row.kind;
    const leftNum = row.left.num != null ? String(row.left.num) : "";
    const rightNum = row.right.num != null ? String(row.right.num) : "";
    let leftHtml;
    let rightHtml;
    if (lk === "change") {
      leftHtml = renderChangeSide(row.left.text, row.right.text, "left");
      rightHtml = renderChangeSide(row.left.text, row.right.text, "right");
    } else {
      leftHtml = renderPlainLine(row.left.text, lk === "add" ? "empty" : lk);
      rightHtml = renderPlainLine(row.right.text, lk === "del" ? "empty" : lk);
    }
    return `<div class="diff-split-row diff-row-${lk}" data-diff-row="1"><div class="diff-split-cell diff-side-left"><span class="diff-ln">${leftNum}</span><span class="diff-txt">${leftHtml}</span></div><div class="diff-split-cell diff-side-right"><span class="diff-ln">${rightNum}</span><span class="diff-txt">${rightHtml}</span></div></div>`;
  }

  function paintVirtualList(container, rows, renderRow, { scrollTop = 0 } = {}) {
    if (!container || !rows.length) {
      if (container) container.innerHTML = "";
      return;
    }
    const viewH = container.clientHeight || 400;
    const totalH = rows.length * DIFF_ROW_PX;
    const start = Math.max(0, Math.floor(scrollTop / DIFF_ROW_PX) - DIFF_OVERSCAN);
    const visible = Math.ceil(viewH / DIFF_ROW_PX) + DIFF_OVERSCAN * 2;
    const end = Math.min(rows.length, start + visible);
    const slice = rows.slice(start, end);
    container.innerHTML = `<div class="diff-vp" style="height:${totalH}px"><div class="diff-vp-inner" style="transform:translateY(${start * DIFF_ROW_PX}px)">${slice.map(renderRow).join("")}</div></div>`;
  }

  function bindVirtualScroll(container, rows, renderRow) {
    if (!container) return;
    const key = ++diffView.scrollKey;
    container.dataset.diffScrollKey = String(key);
    const onScroll = () => {
      if (container.dataset.diffScrollKey !== String(diffView.scrollKey)) return;
      paintVirtualList(container, rows, renderRow, { scrollTop: container.scrollTop });
    };
    container.onscroll = onScroll;
    paintVirtualList(container, rows, renderRow, { scrollTop: container.scrollTop });
  }

  function renderDiffView() {
    const splitWrap = $("#diff-split-wrap");
    const splitOut = $("#diff-split-out");
    const unifiedOut = $("#diff-out");
    const hideSame = Boolean($("#diff-hide-same")?.checked);

    if (diffView.mode === "unified") {
      if (splitWrap) splitWrap.hidden = true;
      if (unifiedOut) unifiedOut.hidden = false;
      const rows = buildUnifiedRows(diffView.rows, hideSame);
      bindVirtualScroll(unifiedOut, rows, rowHtmlUnified);
      return;
    }

    if (splitWrap) splitWrap.hidden = false;
    if (unifiedOut) unifiedOut.hidden = true;
    const aligned = buildAlignedRows(diffView.aligned, hideSame);
    bindVirtualScroll(splitOut, aligned, rowHtmlSplit);
  }

  function applyDiffResult(rows, aligned, stats) {
    const meta = $("#diff-meta");
    const hideSame = Boolean($("#diff-hide-same")?.checked);
    const mode = $("#diff-mode-unified")?.classList.contains("is-active") ? "unified" : "split";

    diffView.mode = mode;
    diffView.rows = rows;
    diffView.aligned = aligned;

    const changed = stats.add + stats.del + stats.change;
    const identical = changed === 0 && stats.same > 0;
    const truncated =
      (hideSame
        ? rows.filter((r) => r.type !== "same").length
        : rows.length) > DIFF_RENDER_CAP;

    if (meta) {
      let summary = identical
        ? `完全相同 · ${stats.same} 行`
        : `相同 ${stats.same} · 删除 ${stats.del} · 新增 ${stats.add}${stats.change ? ` · 修改 ${stats.change}` : ""}`;
      if (truncated) summary += ` · 仅渲染前 ${DIFF_RENDER_CAP} 行`;
      meta.textContent = summary;
    }

    diffView.changeIdx = collectChangeIndices(
      buildUnifiedRows(rows, hideSame),
      buildAlignedRows(aligned, hideSame),
      mode
    );
    updateDiffNav();
    renderDiffView();
  }

  function runTextDiffSync() {
    const aEl = $("#diff-a");
    const bEl = $("#diff-b");
    if (!aEl || !bEl) return;
    const aText = aEl.value;
    const bText = bEl.value;
    if (!aText && !bText) {
      renderDiffError("");
      if ($("#diff-meta")) $("#diff-meta").textContent = "粘贴或输入两段文本后开始比对";
      return;
    }
    try {
      const opts = diffOptsFromUi();
      const rows = P.diffLines(aText, bText, opts);
      const aligned = P.diffAlignFromRows(rows);
      const stats = P.diffStats(rows);
      applyDiffResult(rows, aligned, stats);
    } catch (err) {
      renderDiffError(err?.message, err?.code);
    }
  }

  function runTextDiff() {
    if (!isDiffPanelActive()) return;
    const aEl = $("#diff-a");
    const bEl = $("#diff-b");
    const meta = $("#diff-meta");
    if (!aEl || !bEl) return;

    const aText = aEl.value;
    const bText = bEl.value;
    if (!aText && !bText) {
      if (meta) meta.textContent = "粘贴或输入两段文本后开始比对";
      renderDiffError("");
      return;
    }

    const worker = ensureDiffWorker();
    if (!worker) {
      runTextDiffSync();
      return;
    }

    diffJobId += 1;
    const id = diffJobId;
    diffBusy = true;
    if (meta) meta.textContent = "比对中…";
    worker.postMessage({ id, a: aText, b: bText, opts: diffOptsFromUi() });
  }

  function scheduleTextDiff() {
    if (!isDiffPanelActive()) return;
    const aEl = $("#diff-a");
    const bEl = $("#diff-b");
    const auto = $("#diff-auto");
    const policy = DC.diffAutoPolicy(aEl?.value || "", bEl?.value || "");
    if (auto && !policy.allowAuto) {
      auto.checked = false;
      toast("文本较大，已关闭自动对比，请手动点击「对比」");
      return;
    }
    clearTimeout(diffTimer);
    const delay = auto?.checked ? policy.debounce : 0;
    if (!delay) {
      runTextDiff();
      return;
    }
    diffTimer = setTimeout(runTextDiff, delay);
  }

  function setDiffMode(mode) {
    const splitBtn = $("#diff-mode-split");
    const unifiedBtn = $("#diff-mode-unified");
    const onSplit = mode !== "unified";
    splitBtn?.classList.toggle("is-active", onSplit);
    unifiedBtn?.classList.toggle("is-active", !onSplit);
    splitBtn?.setAttribute("aria-selected", onSplit ? "true" : "false");
    unifiedBtn?.setAttribute("aria-selected", onSplit ? "false" : "true");
    if (diffView.rows.length) {
      diffView.mode = onSplit ? "split" : "unified";
      const hideSame = Boolean($("#diff-hide-same")?.checked);
      diffView.changeIdx = collectChangeIndices(
        buildUnifiedRows(diffView.rows, hideSame),
        buildAlignedRows(diffView.aligned, hideSame),
        diffView.mode
      );
      updateDiffNav();
      renderDiffView();
    } else {
      runTextDiff();
    }
  }

  function jumpDiff(step) {
    if (!diffView.changeIdx.length) return;
    const container =
      diffView.mode === "unified" ? $("#diff-out") : $("#diff-split-out");
    if (!container) return;
    const rows = diffView.changeIdx;
    const scrollT = container.scrollTop;
    const current = Math.floor(scrollT / DIFF_ROW_PX);
    let target;
    if (step > 0) {
      target = rows.find((i) => i > current + 1) ?? rows[0];
    } else {
      target = [...rows].reverse().find((i) => i < current - 1) ?? rows[rows.length - 1];
    }
    container.scrollTop = Math.max(0, target * DIFF_ROW_PX - DIFF_ROW_PX * 2);
    container.dispatchEvent(new Event("scroll"));
  }

  function initDiffTool() {
    $("#diff-run")?.addEventListener("click", runTextDiff);
    ["diff-a", "diff-b"].forEach((id) => {
      $("#" + id)?.addEventListener("input", () => {
        if ($("#diff-auto")?.checked) scheduleTextDiff();
      });
    });
    ["diff-ignore-ws", "diff-trim-trail", "diff-hide-same"].forEach((id) => {
      $("#" + id)?.addEventListener("change", () => {
        if (!isDiffPanelActive()) return;
        if (diffView.rows.length) {
          applyDiffResult(diffView.rows, diffView.aligned, P.diffStats(diffView.rows));
        } else {
          runTextDiff();
        }
      });
    });
    $("#diff-auto")?.addEventListener("change", () => scheduleTextDiff());
    $("#diff-mode-split")?.addEventListener("click", () => setDiffMode("split"));
    $("#diff-mode-unified")?.addEventListener("click", () => setDiffMode("unified"));
    $("#diff-prev")?.addEventListener("click", () => jumpDiff(-1));
    $("#diff-next")?.addEventListener("click", () => jumpDiff(1));
    $("#diff-swap")?.addEventListener("click", () => {
      const a = $("#diff-a");
      const b = $("#diff-b");
      if (!a || !b) return;
      const t = a.value;
      a.value = b.value;
      b.value = t;
      runTextDiff();
    });
    $("#diff-clear")?.addEventListener("click", () => {
      const a = $("#diff-a");
      const b = $("#diff-b");
      if (a) a.value = "";
      if (b) b.value = "";
      diffView = { mode: diffView.mode, rows: [], aligned: [], unified: [], changeIdx: [], scrollKey: 0 };
      if ($("#diff-meta")) $("#diff-meta").textContent = "粘贴或输入两段文本后开始比对";
      renderDiffError("");
    });

    async function diffPaste(side) {
      const el = side === "a" ? $("#diff-a") : $("#diff-b");
      if (!el) return;
      try {
        el.value = await navigator.clipboard.readText();
        runTextDiff();
        toast("已粘贴");
      } catch (_) {
        toast("无法读取剪贴板");
      }
    }
    $("#diff-paste-a")?.addEventListener("click", () => diffPaste("a"));
    $("#diff-paste-b")?.addEventListener("click", () => diffPaste("b"));

    if ($("#diff-meta")) $("#diff-meta").textContent = "粘贴或输入两段文本后开始比对";
    window.addEventListener("devtools:route", (e) => {
      if (e.detail?.tool === "diff") scheduleTextDiff();
    });
    window.addEventListener("resize", () => {
      if (isDiffPanelActive() && diffView.rows.length) renderDiffView();
    });
  }

  initDiffTool();
})();
