(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const panel = $("#countdown");
  if (!panel) return;

  const STORAGE_KEY = "devtools-countdown-v1";
  const listEl = $("#cd-list");
  const addBtn = $("#cd-add");
  const startBtn = $("#cd-start");
  const saveBtn = $("#cd-save");
  const clearBtn = $("#cd-clear");
  const savedEl = $("#cd-saved");
  const errorEl = $("#cd-error");
  const hintEl = $("#cd-hint");
  const overlay = $("#countdown-fs");
  const ovTitle = $("#cd-fs-kicker");
  const ovContent = $("#cd-fs-content");
  const ovTime = $("#cd-fs-time");
  const ovNext = $("#cd-fs-next");
  const ovDone = $("#cd-fs-done");
  const ovClose = $("#cd-fs-close");
  const ovStep = $("#cd-fs-step");

  let items = [];
  let snapshots = [];
  let runIndex = -1;
  let remainMs = 0;
  let tickTimer = 0;
  let deadline = 0;
  let audioCtx = null;
  let running = false;
  let awaitingAck = false;
  let dragId = "";

  function uid() {
    return `cd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function emptyItem() {
    return { id: uid(), content: "", h: "", m: "", s: "" };
  }

  function clampInt(raw, max) {
    const n = Number.parseInt(String(raw ?? "").trim(), 10);
    if (!Number.isFinite(n) || n < 0) return "";
    return String(Math.min(max, Math.floor(n)));
  }

  function itemSeconds(it) {
    const h = Number.parseInt(it.h, 10) || 0;
    const m = Number.parseInt(it.m, 10) || 0;
    const s = Number.parseInt(it.s, 10) || 0;
    return Math.max(0, h * 3600 + m * 60 + s);
  }

  function formatHms(totalSec) {
    const n = Math.max(0, Math.floor(totalSec));
    const h = Math.floor(n / 3600);
    const m = Math.floor((n % 3600) / 60);
    const s = n % 60;
    const pad = (x) => String(x).padStart(2, "0");
    if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
    return `${pad(m)}:${pad(s)}`;
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw);
      if (Array.isArray(data.items) && data.items.length) {
        items = data.items.map((it) => ({
          id: it.id || uid(),
          content: String(it.content || ""),
          h: it.h == null ? "" : String(it.h),
          m: it.m == null ? "" : String(it.m),
          s: it.s == null ? "" : String(it.s),
        }));
      }
      if (Array.isArray(data.snapshots)) snapshots = data.snapshots;
    } catch (_) {
      /* ignore */
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ items, snapshots }));
    } catch (_) {
      /* ignore */
    }
  }

  function setError(msg) {
    if (!errorEl) return;
    errorEl.hidden = !msg;
    errorEl.textContent = msg || "";
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function usableItems() {
    return items.filter((it) => String(it.content || "").trim());
  }

  function renderList() {
    if (!listEl) return;
    if (!items.length) items = [emptyItem()];
    listEl.innerHTML = items
      .map((it, idx) => {
        const n = idx + 1;
        return `<li class="cd-row" data-id="${it.id}" draggable="false">
          <button type="button" class="cd-drag" draggable="true" title="拖拽排序" aria-label="拖拽排序第 ${n} 项">⠿</button>
          <span class="cd-idx mono" aria-hidden="true">${n}</span>
          <input class="cd-content" type="text" data-field="content" placeholder="内容（必填才会参与倒计时）" value="${escapeHtml(it.content)}" autocomplete="off" />
          <div class="cd-hms">
            <label><span>时</span><input class="mono cd-num" type="number" min="0" max="99" inputmode="numeric" data-field="h" placeholder="0" value="${escapeHtml(it.h)}" /></label>
            <label><span>分</span><input class="mono cd-num" type="number" min="0" max="59" inputmode="numeric" data-field="m" placeholder="0" value="${escapeHtml(it.m)}" /></label>
            <label><span>秒</span><input class="mono cd-num" type="number" min="0" max="59" inputmode="numeric" data-field="s" placeholder="0" value="${escapeHtml(it.s)}" /></label>
          </div>
          <button type="button" class="ghost-btn cd-del" data-del="${it.id}" title="删除此项">删除</button>
        </li>`;
      })
      .join("");
    if (hintEl) {
      const n = usableItems().length;
      hintEl.textContent = n
        ? `已保存 ${n} 条内容。时分秒可留空：开始后只显示内容，不响铃。`
        : "输入内容会立刻保存到本机。时分秒可选。";
    }
  }

  function renderSaved() {
    if (!savedEl) return;
    if (!snapshots.length) {
      savedEl.innerHTML = `<p class="hint tight">还没有收藏。点「收藏」可为当前列表起一个标题保存。</p>`;
      return;
    }
    savedEl.innerHTML = snapshots
      .map(
        (snap) => `<div class="cd-snap" data-snap="${escapeHtml(snap.id)}">
          <div class="cd-snap-meta">
            <strong>${escapeHtml(snap.title)}</strong>
            <span class="hint tight">${snap.items?.length || 0} 条 · ${escapeHtml(snap.at || "")}</span>
          </div>
          <div class="btn-row">
            <button type="button" class="secondary-btn" data-load="${escapeHtml(snap.id)}">载入</button>
            <button type="button" class="ghost-btn" data-forget="${escapeHtml(snap.id)}">删除收藏</button>
          </div>
        </div>`
      )
      .join("");
  }

  function persistFromDom() {
    if (!listEl) return;
    [...listEl.querySelectorAll(".cd-row")].forEach((row) => {
      const id = row.dataset.id;
      const it = items.find((x) => x.id === id);
      if (!it) return;
      const content = row.querySelector('[data-field="content"]');
      const h = row.querySelector('[data-field="h"]');
      const m = row.querySelector('[data-field="m"]');
      const s = row.querySelector('[data-field="s"]');
      it.content = content?.value ?? "";
      it.h = clampInt(h?.value, 99);
      it.m = clampInt(m?.value, 59);
      it.s = clampInt(s?.value, 59);
      if (h && it.h !== h.value && h.value !== "") h.value = it.h;
      if (m && it.m !== m.value && m.value !== "") m.value = it.m;
      if (s && it.s !== s.value && s.value !== "") s.value = it.s;
    });
    saveState();
    if (hintEl) {
      const n = usableItems().length;
      hintEl.textContent = n
        ? `已保存 ${n} 条内容。时分秒可留空：开始后只显示内容，不响铃。`
        : "输入内容会立刻保存到本机。时分秒可选。";
    }
  }

  function ensureAudio() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (_) {}
    }
    return audioCtx;
  }

  function unlockAudio() {
    const ac = ensureAudio();
    if (!ac) return;
    try {
      const buf = ac.createBuffer(1, 1, ac.sampleRate);
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.connect(ac.destination);
      src.start(0);
    } catch (_) {}
    if (ac.state === "suspended") ac.resume().catch(() => {});
  }

  function playBell() {
    const ac = ensureAudio();
    if (!ac) return;
    const now = ac.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const osc = ac.createOscillator();
      const gain = ac.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.18, now + 0.02 + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55 + i * 0.12);
      osc.connect(gain);
      gain.connect(ac.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + 0.6 + i * 0.12);
    });
  }

  function vibrateAlarm() {
    try {
      navigator.vibrate?.([240, 80, 240, 80, 360]);
    } catch (_) {
      /* ignore */
    }
  }

  function stopTick() {
    if (tickTimer) {
      window.clearInterval(tickTimer);
      tickTimer = 0;
    }
  }

  function closeOverlay() {
    stopTick();
    running = false;
    awaitingAck = false;
    runIndex = -1;
    if (overlay) overlay.hidden = true;
    document.body.classList.remove("countdown-fs-active");
    if (startBtn) startBtn.disabled = false;
  }

  function hasNextUsable(fromIdx) {
    const list = usableItems();
    return fromIdx + 1 < list.length;
  }

  function showAck(it, withAlarm, hasMore) {
    awaitingAck = true;
    stopTick();
    if (ovTitle) ovTitle.textContent = withAlarm ? "时间到" : "下一步";
    if (ovContent) ovContent.textContent = it.content.trim();
    if (ovTime) {
      ovTime.hidden = !withAlarm;
      ovTime.textContent = withAlarm ? "00:00" : "";
    }
    if (ovStep) ovStep.textContent = "";
    if (ovNext) ovNext.hidden = !hasMore;
    if (ovDone) ovDone.hidden = hasMore;
    if (overlay) overlay.hidden = false;
    document.body.classList.add("countdown-fs-active");
    if (withAlarm) {
      playBell();
      vibrateAlarm();
    }
  }

  function paintRunning(it, remainSec, stepLabel) {
    if (ovTitle) ovTitle.textContent = "进行中";
    if (ovContent) ovContent.textContent = it.content.trim();
    if (ovTime) {
      ovTime.hidden = false;
      ovTime.textContent = formatHms(remainSec);
    }
    if (ovStep) ovStep.textContent = stepLabel;
    if (ovNext) ovNext.hidden = true;
    if (ovDone) ovDone.hidden = true;
    if (overlay) overlay.hidden = false;
    document.body.classList.add("countdown-fs-active");
  }

  function beginItem(idx) {
    const list = usableItems();
    if (idx >= list.length) {
      closeOverlay();
      return;
    }
    running = true;
    awaitingAck = false;
    runIndex = idx;
    const it = list[idx];
    const total = itemSeconds(it);
    const stepLabel = `第 ${idx + 1} / ${list.length} 步`;
    if (total <= 0) {
      showAck(it, false, hasNextUsable(idx));
      return;
    }
    remainMs = total * 1000;
    deadline = Date.now() + remainMs;
    paintRunning(it, total, stepLabel);
    stopTick();
    tickTimer = window.setInterval(() => {
      const left = Math.max(0, deadline - Date.now());
      remainMs = left;
      paintRunning(it, Math.ceil(left / 1000), stepLabel);
      if (left <= 0) {
        showAck(it, true, hasNextUsable(idx));
      }
    }, 200);
  }

  function goNext() {
    beginItem(runIndex + 1);
  }

  listEl?.addEventListener("input", () => {
    persistFromDom();
    setError("");
  });

  listEl?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-del]");
    if (!btn) return;
    persistFromDom();
    const id = btn.getAttribute("data-del");
    items = items.filter((it) => it.id !== id);
    if (!items.length) items = [emptyItem()];
    saveState();
    renderList();
  });

  listEl?.addEventListener("dragstart", (e) => {
    const handle = e.target.closest(".cd-drag");
    if (!handle) {
      e.preventDefault();
      return;
    }
    const row = handle.closest(".cd-row");
    if (!row) return;
    persistFromDom();
    dragId = row.dataset.id;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragId);
    row.classList.add("is-dragging");
  });

  listEl?.addEventListener("dragend", () => {
    listEl.querySelectorAll(".cd-row").forEach((el) => el.classList.remove("is-dragging", "drag-over"));
    dragId = "";
  });

  listEl?.addEventListener("dragover", (e) => {
    const row = e.target.closest(".cd-row");
    if (!row || !dragId) return;
    e.preventDefault();
    listEl.querySelectorAll(".cd-row").forEach((el) => el.classList.toggle("drag-over", el === row && el.dataset.id !== dragId));
  });

  listEl?.addEventListener("drop", (e) => {
    e.preventDefault();
    const row = e.target.closest(".cd-row");
    persistFromDom();
    const fromId = dragId || e.dataTransfer.getData("text/plain");
    const toId = row?.dataset.id;
    listEl.querySelectorAll(".cd-row").forEach((el) => el.classList.remove("is-dragging", "drag-over"));
    if (!fromId || !toId || fromId === toId) return;
    const fromIdx = items.findIndex((it) => it.id === fromId);
    const toIdx = items.findIndex((it) => it.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = items.splice(fromIdx, 1);
    items.splice(toIdx, 0, moved);
    saveState();
    renderList();
  });

  // 手机：长按把手拖动
  let pointerDrag = null;
  listEl?.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse") return;
    const handle = e.target.closest(".cd-drag");
    if (!handle) return;
    const row = handle.closest(".cd-row");
    if (!row) return;
    persistFromDom();
    pointerDrag = { id: row.dataset.id, startY: e.clientY };
    try {
      handle.setPointerCapture?.(e.pointerId);
    } catch (_) {
      /* ignore */
    }
  });
  listEl?.addEventListener("pointermove", (e) => {
    if (!pointerDrag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const row = el?.closest?.(".cd-row");
    listEl.querySelectorAll(".cd-row").forEach((r) => r.classList.toggle("drag-over", r === row && r.dataset.id !== pointerDrag.id));
  });
  listEl?.addEventListener("pointerup", (e) => {
    if (!pointerDrag) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const row = el?.closest?.(".cd-row");
    const fromId = pointerDrag.id;
    const toId = row?.dataset.id;
    pointerDrag = null;
    listEl.querySelectorAll(".cd-row").forEach((r) => r.classList.remove("drag-over"));
    if (!fromId || !toId || fromId === toId) return;
    const fromIdx = items.findIndex((it) => it.id === fromId);
    const toIdx = items.findIndex((it) => it.id === toId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = items.splice(fromIdx, 1);
    items.splice(toIdx, 0, moved);
    saveState();
    renderList();
  });

  addBtn?.addEventListener("click", () => {
    persistFromDom();
    items.push(emptyItem());
    saveState();
    renderList();
    listEl?.querySelector(".cd-row:last-child .cd-content")?.focus();
  });

  startBtn?.addEventListener("click", () => {
    persistFromDom();
    const list = usableItems();
    if (!list.length) {
      setError("请至少填写一条内容");
      return;
    }
    setError("");
    unlockAudio();
    if (startBtn) startBtn.disabled = true;
    beginItem(0);
  });

  saveBtn?.addEventListener("click", () => {
    persistFromDom();
    const list = usableItems();
    if (!list.length) {
      setError("没有可收藏的内容");
      return;
    }
    const title = window.prompt("给这次倒计时起个标题", `倒计时 ${new Date().toLocaleString()}`);
    if (title == null) return;
    const name = String(title).trim();
    if (!name) {
      setError("标题不能为空");
      return;
    }
    snapshots.unshift({
      id: uid(),
      title: name,
      at: new Date().toLocaleString(),
      items: list.map((it) => ({ ...it, id: uid() })),
    });
    snapshots = snapshots.slice(0, 40);
    saveState();
    renderSaved();
    setError("");
  });

  clearBtn?.addEventListener("click", () => {
    if (!window.confirm("清空当前列表全部内容？收藏不会删除。")) return;
    items = [emptyItem()];
    saveState();
    renderList();
    setError("");
  });

  savedEl?.addEventListener("click", (e) => {
    const loadId = e.target.closest("[data-load]")?.getAttribute("data-load");
    const forgetId = e.target.closest("[data-forget]")?.getAttribute("data-forget");
    if (loadId) {
      const snap = snapshots.find((s) => s.id === loadId);
      if (!snap) return;
      items = (snap.items || []).map((it) => ({ ...it, id: uid() }));
      if (!items.length) items = [emptyItem()];
      saveState();
      renderList();
      setError("");
      return;
    }
    if (forgetId) {
      snapshots = snapshots.filter((s) => s.id !== forgetId);
      saveState();
      renderSaved();
    }
  });

  ovNext?.addEventListener("click", () => {
    if (!awaitingAck) return;
    goNext();
  });
  ovDone?.addEventListener("click", closeOverlay);
  ovClose?.addEventListener("click", closeOverlay);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && overlay && !overlay.hidden) closeOverlay();
  });

  loadState();
  if (!items.length) items = [emptyItem(), emptyItem()];
  renderList();
  renderSaved();
})();
