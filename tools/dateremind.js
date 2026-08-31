(() => {
  "use strict";

  const STORAGE_KEY = "devtools-dateremind-v1";
  const DISMISS_KEY = "devtools-dateremind-dismiss-v1";
  const $ = (sel, root = document) => root.querySelector(sel);

  const LUNAR_MONTHS = [
    "正月",
    "二月",
    "三月",
    "四月",
    "五月",
    "六月",
    "七月",
    "八月",
    "九月",
    "十月",
    "冬月",
    "腊月",
  ];
  const LUNAR_DAYS = [
    "初一",
    "初二",
    "初三",
    "初四",
    "初五",
    "初六",
    "初七",
    "初八",
    "初九",
    "初十",
    "十一",
    "十二",
    "十三",
    "十四",
    "十五",
    "十六",
    "十七",
    "十八",
    "十九",
    "二十",
    "廿一",
    "廿二",
    "廿三",
    "廿四",
    "廿五",
    "廿六",
    "廿七",
    "廿八",
    "廿九",
    "三十",
  ];

  const CATEGORIES = {
    birthday: { label: "生日", color: "#e91e8c" },
    holiday: { label: "节日", color: "#f59e0b" },
    memo: { label: "事项", color: "#3b82f6" },
    custom: { label: "其它", color: "#6b7280" },
  };

  let settings = { defaultAdvanceDays: 7, showBadge: true };
  /** @type {ReminderItem[]} */
  let items = [];
  let dismissMap = {};
  let editingId = "";

  function uid() {
    return `dr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function sl() {
    return typeof globalThis.solarlunar === "object" ? globalThis.solarlunar : null;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function todayKey(d = new Date()) {
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function parseTime(text) {
    const m = String(text || "").trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return { h, min };
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  function addDays(d, n) {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return startOfDay(x);
  }

  function dayDiff(a, b) {
    return Math.round((startOfDay(b) - startOfDay(a)) / 86400000);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        if (data.settings) settings = { ...settings, ...data.settings };
        if (Array.isArray(data.items)) items = data.items;
      }
    } catch (_) {}
    try {
      const raw = localStorage.getItem(DISMISS_KEY);
      if (raw) dismissMap = JSON.parse(raw) || {};
    } catch (_) {
      dismissMap = {};
    }
    autoArchiveOnce();
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ settings, items }));
    } catch (_) {}
  }

  function saveDismiss() {
    try {
      localStorage.setItem(DISMISS_KEY, JSON.stringify(dismissMap));
    } catch (_) {}
  }

  function autoArchiveOnce() {
    let changed = false;
    const now = startOfDay(new Date());
    items.forEach((it) => {
      if (it.archived || it.repeat !== "once" || !it.enabled) return;
      const target = resolveTargetDate(it, now);
      if (!target) return;
      if (addDays(target, 1) <= now) {
        it.archived = true;
        changed = true;
      }
    });
    if (changed) saveState();
  }

  function advanceFor(item) {
    if (item.advanceDays != null && item.advanceDays !== "") {
      const n = Number(item.advanceDays);
      if (Number.isFinite(n) && n >= 0) return Math.min(365, Math.floor(n));
    }
    const d = Number(settings.defaultAdvanceDays);
    return Math.min(365, Math.max(0, Number.isFinite(d) ? Math.floor(d) : 7));
  }

  function advanceLabel(days) {
    const n = Math.min(365, Math.max(0, Math.floor(Number(days) || 0)));
    if (n === 0) return "当天提醒";
    return `提前 ${n} 天提醒`;
  }

  function lunarToSolar(lYear, lMonth, lDay, isLeap) {
    const lib = sl();
    if (!lib?.lunar2solar) return null;
    const r = lib.lunar2solar(lYear, lMonth, lDay, Boolean(isLeap));
    if (!r || r === -1 || !r.cYear) return null;
    return new Date(r.cYear, r.cMonth - 1, r.cDay);
  }

  function resolveTargetDate(item, fromDate = new Date()) {
    const from = startOfDay(fromDate);
    if (item.calendar === "solar") {
      const y = item.repeat === "once" ? Number(item.year) : from.getFullYear();
      if (!(y > 1900)) return null;
      const d = new Date(y, Number(item.month) - 1, Number(item.day));
      if (Number.isNaN(d.getTime())) return null;
      if (item.repeat === "yearly" && d < from) {
        const next = new Date(y + 1, Number(item.month) - 1, Number(item.day));
        return startOfDay(next);
      }
      return startOfDay(d);
    }
    const lib = sl();
    if (!lib?.solar2lunar || !lib?.lunar2solar) return null;
    const cur = lib.solar2lunar(from.getFullYear(), from.getMonth() + 1, from.getDate());
    if (!cur?.lYear) return null;
    if (item.repeat === "once") {
      const ly = Number(item.year) || cur.lYear;
      const d = lunarToSolar(ly, Number(item.month), Number(item.day), item.isLeap);
      return d ? startOfDay(d) : null;
    }
    for (let ly = cur.lYear; ly <= cur.lYear + 2; ly++) {
      const d = lunarToSolar(ly, Number(item.month), Number(item.day), item.isLeap);
      if (!d) continue;
      const sd = startOfDay(d);
      if (sd >= from) return sd;
    }
    return null;
  }

  function formatDateLabel(item, target) {
    if (!target) return "—";
    const y = target.getFullYear();
    const m = target.getMonth() + 1;
    const d = target.getDate();
    if (item.calendar === "lunar") {
      const lib = sl();
      const cn = lib?.solar2lunar?.(y, m, d);
      const lm = LUNAR_MONTHS[(Number(item.month) || 1) - 1] || `${item.month}月`;
      const ld = LUNAR_DAYS[(Number(item.day) || 1) - 1] || `${item.day}日`;
      const leap = item.isLeap ? "闰" : "";
      const solar = `${y}-${pad2(m)}-${pad2(d)}`;
      if (cn?.monthCn && cn?.dayCn) {
        return `农历${leap}${lm}${ld}（${solar}）`;
      }
      return `农历${leap}${lm}${ld}（${solar}）`;
    }
    if (item.repeat === "once") return `${y}-${pad2(m)}-${pad2(d)}`;
    return `${pad2(m)}-${pad2(d)}（${y}）`;
  }

  function dismissKey(id, dateKey = todayKey()) {
    return `${id}:${dateKey}`;
  }

  function isDismissedToday(id) {
    return Boolean(dismissMap[dismissKey(id)]);
  }

  function dismissToday(ids) {
    const key = todayKey();
    (ids || []).forEach((id) => {
      dismissMap[dismissKey(id, key)] = true;
    });
    saveDismiss();
  }

  function enrichItem(item, fromDate = new Date()) {
    const target = resolveTargetDate(item, fromDate);
    const today = startOfDay(fromDate);
    const daysUntil = target ? dayDiff(today, target) : null;
    const advance = advanceFor(item);
    const inWindow =
      target &&
      daysUntil !== null &&
      daysUntil >= 0 &&
      daysUntil <= advance;
    const isToday = daysUntil === 0;
    const time = parseTime(item.time);
    let showNow = inWindow;
    if (isToday && time) {
      const now = fromDate;
      const moment = new Date(today);
      moment.setHours(time.h, time.min, 0, 0);
      if (now < moment) showNow = true;
    }
    return {
      ...item,
      target,
      daysUntil,
      advance,
      inWindow: showNow,
      duePopup: showNow && item.enabled && !item.archived && !isDismissedToday(item.id),
      dateLabel: formatDateLabel(item, target),
      categoryMeta: CATEGORIES[item.category] || CATEGORIES.custom,
    };
  }

  function getDueItems(fromDate = new Date()) {
    return items
      .map((it) => enrichItem(it, fromDate))
      .filter((it) => it.duePopup)
      .sort((a, b) => (a.daysUntil ?? 999) - (b.daysUntil ?? 999));
  }

  function getActiveCount(fromDate = new Date()) {
    return items
      .map((it) => enrichItem(it, fromDate))
      .filter((it) => it.inWindow && it.enabled && !it.archived && !isDismissedToday(it.id)).length;
  }

  function daysUntilText(days) {
    if (days === 0) return "就是今天";
    if (days === 1) return "明天";
    if (days > 1) return `还有 ${days} 天`;
    return "已临近";
  }

  // ---- 全屏进站提醒 ----
  const fs = $("#dateremind-fs");
  const fsList = $("#dr-fs-list");
  const fsDismiss = $("#dr-fs-dismiss-today");
  const fsGoto = $("#dr-fs-goto");
  const fsOk = $("#dr-fs-ok");
  const fsClose = $("#dr-fs-close");
  let fsDueIds = [];

  function closeFullscreen() {
    if (fs) fs.hidden = true;
    document.body.classList.remove("dateremind-fs-active");
    fsDueIds = [];
  }

  function renderFullscreen(due) {
    if (!fs || !fsList) return;
    fsDueIds = due.map((d) => d.id);
    fsList.innerHTML = due
      .map((it) => {
        const cat = it.categoryMeta;
        const timeTip = it.time ? ` · ${it.time}` : "";
        return `<article class="dr-fs-card" style="--dr-cat:${cat.color}">
          <span class="dr-fs-cat">${escapeHtml(cat.label)}</span>
          <h3 class="dr-fs-title">${escapeHtml(it.title || "未命名")}</h3>
          <p class="dr-fs-when">${escapeHtml(daysUntilText(it.daysUntil))} · ${escapeHtml(it.dateLabel)}${escapeHtml(timeTip)}</p>
          ${it.note ? `<p class="dr-fs-note">${escapeHtml(it.note)}</p>` : ""}
        </article>`;
      })
      .join("");
    fs.hidden = false;
    document.body.classList.add("dateremind-fs-active");
  }

  function checkOnVisit() {
    if (document.body.classList.contains("countdown-fs-active")) return;
    const due = getDueItems();
    if (!due.length) return;
    renderFullscreen(due);
  }

  function updateBadge() {
    const badge = $("#dr-top-badge");
    if (!badge) return;
    if (!settings.showBadge) {
      badge.hidden = true;
      return;
    }
    const n = getActiveCount();
    if (n > 0) {
      badge.hidden = false;
      badge.textContent = String(n);
      badge.title = `${n} 条日期提醒进行中`;
    } else {
      badge.hidden = true;
    }
  }

  // ---- ICS ----
  function icsEscape(s) {
    return String(s || "")
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\n/g, "\\n");
  }

  function formatIcsDate(d) {
    return `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  }

  function formatIcsDateTime(d, time) {
    const t = parseTime(time);
    if (!t) return `DTSTART;VALUE=DATE:${formatIcsDate(d)}`;
    const dt = new Date(d);
    dt.setHours(t.h, t.min, 0, 0);
    const iso = `${dt.getFullYear()}${pad2(dt.getMonth() + 1)}${pad2(dt.getDate())}T${pad2(dt.getHours())}${pad2(dt.getMinutes())}00`;
    return `DTSTART:${iso}`;
  }

  function buildIcs(list) {
    const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//DevTools//DateRemind//CN"];
    list.forEach((it) => {
      const target = resolveTargetDate(it) || new Date();
      lines.push("BEGIN:VEVENT");
      lines.push(`UID:${it.id}@devtools.local`);
      lines.push(formatIcsDateTime(target, it.time));
      lines.push(`SUMMARY:${icsEscape(it.title || "提醒")}`);
      if (it.note) lines.push(`DESCRIPTION:${icsEscape(it.note)}`);
      if (it.repeat === "yearly") lines.push("RRULE:FREQ=YEARLY");
      lines.push("END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n");
  }

  function downloadText(text, filename, mime) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  // ---- 管理面板 UI ----
  let renderListsRef = null;

  loadState();

  const panel = $("#dateremind");
  if (panel) {
    const listEl = $("#dr-list");
    const archivedEl = $("#dr-archived-list");
    const form = $("#dr-form");
    const errorEl = $("#dr-error");
    const showBadgeEl = $("#dr-show-badge");
    const importInput = $("#dr-import-file");

    function setError(msg) {
      if (!errorEl) return;
      errorEl.hidden = !msg;
      errorEl.textContent = msg || "";
    }

    function emptyItem() {
      return {
        id: uid(),
        title: "",
        note: "",
        category: "custom",
        calendar: "solar",
        month: 1,
        day: 1,
        year: new Date().getFullYear(),
        isLeap: false,
        repeat: "yearly",
        advanceDays: null,
        time: "",
        enabled: true,
        archived: false,
      };
    }

    function fillLunarSelects() {
      const mSel = $("#dr-lunar-month");
      const dSel = $("#dr-lunar-day");
      if (mSel && !mSel.options.length) {
        LUNAR_MONTHS.forEach((name, i) => {
          const o = document.createElement("option");
          o.value = String(i + 1);
          o.textContent = name;
          mSel.appendChild(o);
        });
      }
      if (dSel && !dSel.options.length) {
        LUNAR_DAYS.forEach((name, i) => {
          const o = document.createElement("option");
          o.value = String(i + 1);
          o.textContent = name;
          dSel.appendChild(o);
        });
      }
    }

    function syncFormVisibility() {
      const cal = $("#dr-calendar")?.value || "solar";
      $("#dr-solar-fields")?.toggleAttribute("hidden", cal !== "solar");
      $("#dr-lunar-fields")?.toggleAttribute("hidden", cal !== "lunar");
      const rep = $("#dr-repeat")?.value || "yearly";
      $("#dr-year-row")?.toggleAttribute("hidden", rep !== "once");
      const isLunar = cal === "lunar";
      $("#dr-leap-row")?.toggleAttribute("hidden", !isLunar);
    }

    function readForm() {
      const cal = $("#dr-calendar")?.value || "solar";
      const repeat = $("#dr-repeat")?.value || "yearly";
      const advRaw = String($("#dr-advance")?.value ?? "").trim();
      let advanceDays = null;
      if (advRaw !== "") {
        const n = Number(advRaw);
        if (!Number.isFinite(n) || n < 0) throw new Error("提前天数须为非负整数");
        advanceDays = Math.min(365, Math.floor(n));
      }
      const timeRaw = String($("#dr-time")?.value ?? "").trim();
      if (timeRaw && !parseTime(timeRaw)) throw new Error("时刻格式应为 HH:MM，如 09:00");
      const title = String($("#dr-title")?.value ?? "").trim();
      if (!title) throw new Error("请填写标题");
      const item = {
        id: editingId || uid(),
        title,
        note: String($("#dr-note")?.value ?? "").trim(),
        category: $("#dr-category")?.value || "custom",
        calendar: cal,
        month: cal === "lunar" ? Number($("#dr-lunar-month")?.value) : Number($("#dr-solar-month")?.value),
        day: cal === "lunar" ? Number($("#dr-lunar-day")?.value) : Number($("#dr-solar-day")?.value),
        year: Number($("#dr-year")?.value) || new Date().getFullYear(),
        isLeap: Boolean($("#dr-leap")?.checked),
        repeat,
        advanceDays,
        time: timeRaw,
        enabled: Boolean($("#dr-enabled")?.checked),
        archived: false,
      };
      if (!(item.month >= 1 && item.month <= 12)) throw new Error("月份无效");
      if (!(item.day >= 1 && item.day <= 31)) throw new Error("日期无效");
      return item;
    }

    function fillForm(item) {
      editingId = item?.id || "";
      $("#dr-title").value = item?.title || "";
      $("#dr-note").value = item?.note || "";
      $("#dr-category").value = item?.category || "custom";
      $("#dr-calendar").value = item?.calendar || "solar";
      $("#dr-repeat").value = item?.repeat || "yearly";
      $("#dr-solar-month").value = String(item?.month || 1);
      $("#dr-solar-day").value = String(item?.day || 1);
      $("#dr-lunar-month").value = String(item?.month || 1);
      $("#dr-lunar-day").value = String(item?.day || 1);
      $("#dr-year").value = String(item?.year || new Date().getFullYear());
      $("#dr-leap").checked = Boolean(item?.isLeap);
      $("#dr-advance").value = item?.advanceDays == null ? "" : String(item.advanceDays);
      $("#dr-time").value = item?.time || "";
      $("#dr-enabled").checked = item?.enabled !== false;
      $("#dr-form-title").textContent = editingId ? "编辑提醒" : "添加提醒";
      syncFormVisibility();
    }

    function renderLists() {
      const active = items
        .filter((it) => !it.archived)
        .map((it) => enrichItem(it))
        .sort((a, b) => {
          const da = a.daysUntil ?? 9999;
          const db = b.daysUntil ?? 9999;
          if (da !== db) return da - db;
          return String(a.title).localeCompare(String(b.title), "zh");
        });
      const archived = items.filter((it) => it.archived).map((it) => enrichItem(it));

      if (listEl) {
        if (!active.length) {
          listEl.innerHTML = '<p class="hint dr-empty">暂无提醒，在下方添加。</p>';
        } else {
          listEl.innerHTML = active
            .map((it) => {
              const cat = it.categoryMeta;
              const status =
                it.daysUntil == null
                  ? "日期无效"
                  : it.inWindow
                    ? it.daysUntil === 0
                      ? "今天"
                      : `提前 ${it.daysUntil} 天`
                    : it.daysUntil < 0
                      ? "已过"
                      : `还有 ${it.daysUntil} 天`;
              const rep = it.repeat === "once" ? "一次" : "每年";
              const adv = advanceLabel(advanceFor(it));
              return `<article class="dr-card${it.enabled ? "" : " is-off"}" style="--dr-cat:${cat.color}" data-id="${it.id}">
                <div class="dr-card-head">
                  <span class="dr-card-cat">${escapeHtml(cat.label)}</span>
                  <strong class="dr-card-title">${escapeHtml(it.title)}</strong>
                  <span class="dr-card-status hint tight">${escapeHtml(status)}</span>
                </div>
                <p class="hint tight dr-card-meta">${escapeHtml(it.dateLabel)} · ${rep} · ${adv}${it.time ? ` · ${escapeHtml(it.time)}` : ""}</p>
                ${it.note ? `<p class="dr-card-note">${escapeHtml(it.note)}</p>` : ""}
                <div class="btn-row dr-card-actions">
                  <button type="button" class="ghost-btn" data-dr-edit="${it.id}">编辑</button>
                  <button type="button" class="ghost-btn" data-dr-archive="${it.id}">归档</button>
                  <button type="button" class="ghost-btn" data-dr-del="${it.id}">删除</button>
                </div>
              </article>`;
            })
            .join("");
        }
      }

      if (archivedEl) {
        archivedEl.hidden = !archived.length;
        archivedEl.innerHTML = archived
          .map(
            (it) => `<article class="dr-card is-archived" data-id="${it.id}">
              <strong>${escapeHtml(it.title)}</strong>
              <span class="hint tight"> ${escapeHtml(it.dateLabel)}</span>
              <div class="btn-row"><button type="button" class="ghost-btn" data-dr-restore="${it.id}">恢复</button>
              <button type="button" class="ghost-btn" data-dr-del="${it.id}">删除</button></div>
            </article>`
          )
          .join("");
      }
      updateBadge();
    }

    renderListsRef = renderLists;

    function persistSettingsFromUi() {
      settings.showBadge = Boolean(showBadgeEl?.checked);
      saveState();
      updateBadge();
    }

    form?.addEventListener("submit", (e) => {
      e.preventDefault();
      try {
        const item = readForm();
        const idx = items.findIndex((x) => x.id === item.id);
        if (idx >= 0) items[idx] = { ...items[idx], ...item };
        else items.push(item);
        saveState();
        autoArchiveOnce();
        editingId = "";
        fillForm(emptyItem());
        renderLists();
        setError("");
      } catch (err) {
        setError(err.message || String(err));
      }
    });

    $("#dr-reset-form")?.addEventListener("click", () => {
      editingId = "";
      fillForm(emptyItem());
      setError("");
    });

    ["dr-calendar", "dr-repeat"].forEach((id) => {
      $("#" + id)?.addEventListener("change", syncFormVisibility);
    });

    showBadgeEl?.addEventListener("change", persistSettingsFromUi);

    listEl?.addEventListener("click", (e) => {
      const edit = e.target.closest("[data-dr-edit]")?.getAttribute("data-dr-edit");
      const del = e.target.closest("[data-dr-del]")?.getAttribute("data-dr-del");
      const arch = e.target.closest("[data-dr-archive]")?.getAttribute("data-dr-archive");
      const restore = e.target.closest("[data-dr-restore]")?.getAttribute("data-dr-restore");
      if (edit) {
        const it = items.find((x) => x.id === edit);
        if (it) fillForm(it);
        return;
      }
      if (arch) {
        const it = items.find((x) => x.id === arch);
        if (it) it.archived = true;
        saveState();
        renderLists();
        return;
      }
      if (restore) {
        const it = items.find((x) => x.id === restore);
        if (it) {
          it.archived = false;
          it.enabled = true;
        }
        saveState();
        renderLists();
        return;
      }
      if (del) {
        if (!window.confirm("删除这条提醒？")) return;
        items = items.filter((x) => x.id !== del);
        saveState();
        renderLists();
      }
    });

    archivedEl?.addEventListener("click", (e) => {
      const restore = e.target.closest("[data-dr-restore]")?.getAttribute("data-dr-restore");
      const del = e.target.closest("[data-dr-del]")?.getAttribute("data-dr-del");
      if (restore) {
        const it = items.find((x) => x.id === restore);
        if (it) {
          it.archived = false;
          it.enabled = true;
        }
        saveState();
        renderLists();
      }
      if (del) {
        if (!window.confirm("删除这条提醒？")) return;
        items = items.filter((x) => x.id !== del);
        saveState();
        renderLists();
      }
    });

    $("#dr-export-json")?.addEventListener("click", () => {
      downloadText(JSON.stringify({ settings, items }, null, 2), "dateremind-backup.json", "application/json");
    });

    $("#dr-export-ics")?.addEventListener("click", () => {
      const active = items.filter((it) => !it.archived);
      if (!active.length) {
        setError("没有可导出的提醒");
        return;
      }
      downloadText(buildIcs(active), "dateremind.ics", "text/calendar;charset=utf-8");
      setError("");
    });

    importInput?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(String(reader.result || ""));
          if (data.settings) settings = { ...settings, ...data.settings };
          if (Array.isArray(data.items)) items = data.items;
          saveState();
          if (showBadgeEl) showBadgeEl.checked = settings.showBadge !== false;
          renderLists();
          setError("");
        } catch (err) {
          setError(err.message || "JSON 无效");
        }
        importInput.value = "";
      };
      reader.readAsText(file);
    });

    fillLunarSelects();
    if (showBadgeEl) showBadgeEl.checked = settings.showBadge !== false;
    fillForm(emptyItem());
    renderLists();
    window.DevToolsTemp?.registerCleanup(() => {
      closeFullscreen();
    });
  }

  fsDismiss?.addEventListener("click", () => {
    dismissToday(fsDueIds);
    closeFullscreen();
    updateBadge();
  });
  fsOk?.addEventListener("click", () => {
    closeFullscreen();
  });
  fsClose?.addEventListener("click", () => {
    closeFullscreen();
  });
  fsGoto?.addEventListener("click", () => {
    closeFullscreen();
    if (location.hash !== "#dateremind") location.hash = "#dateremind";
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && fs && !fs.hidden) closeFullscreen();
  });

  globalThis.DevToolsDateRemind = {
    checkOnVisit,
    updateBadge,
    getDueItems,
    getActiveCount,
    dismissToday,
    reload: () => {
      loadState();
      renderListsRef?.();
      updateBadge();
    },
  };

  document.addEventListener("devtools:route", () => {
    if (location.hash.replace(/^#/, "").split(/[/?]/)[0] === "dateremind") {
      renderListsRef?.();
    }
  });

  queueMicrotask(() => {
    updateBadge();
    checkOnVisit();
  });
})();
