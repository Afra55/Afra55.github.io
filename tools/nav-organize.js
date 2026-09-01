(() => {
  "use strict";

  const dlg = document.getElementById("nav-organize");
  if (!dlg) return;

  const closeBtn = document.getElementById("nav-organize-close");
  const cancelBtn = document.getElementById("nav-organize-cancel");
  const doneBtn = document.getElementById("nav-organize-done");
  const resetBtn = document.getElementById("nav-organize-reset");
  const openBtn = document.getElementById("nav-organize-open");
  const searchInput = document.getElementById("nav-org-search");
  const groupSelect = document.getElementById("nav-org-tool-group");
  const groupPickWrap = document.querySelector(".nav-organize-group-pick");
  const toolList = document.getElementById("nav-org-tool-list");
  const panelGroups = document.getElementById("nav-org-panel-groups");
  const panelFav = document.getElementById("nav-org-panel-favorites");

  let activeTab = "groups";
  let draftGroupOrder = [];
  let draftToolOrder = [];
  let draftFavorites = [];
  let dirty = false;

  function nav() {
    return window.DevToolsNav;
  }

  function toast(msg) {
    try {
      if (typeof window.showToast === "function") window.showToast(msg);
    } catch (_) {}
  }

  function cloneList(arr) {
    return Array.isArray(arr) ? arr.slice() : [];
  }

  function searchQuery() {
    return String(searchInput?.value || "")
      .trim()
      .toLowerCase();
  }

  function matchesQuery(label, query) {
    if (!query) return true;
    return String(label || "")
      .toLowerCase()
      .includes(query);
  }

  function moveInList(list, fromIdx, delta) {
    const toIdx = fromIdx + delta;
    if (fromIdx < 0 || toIdx < 0 || fromIdx >= list.length || toIdx >= list.length) return false;
    const item = list[fromIdx];
    list.splice(fromIdx, 1);
    list.splice(toIdx, 0, item);
    return true;
  }

  function reorderById(list, fromId, toId) {
    const fromIdx = list.indexOf(fromId);
    const toIdx = list.indexOf(toId);
    if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return false;
    const [item] = list.splice(fromIdx, 1);
    list.splice(toIdx, 0, item);
    return true;
  }

  function sortDragDisabled() {
    return searchQuery().length > 0;
  }

  function activeSortContainer() {
    if (activeTab === "groups") return panelGroups;
    if (activeTab === "tools") return toolList;
    if (activeTab === "favorites") return panelFav?.querySelector(".nav-organize-sort-list");
    return null;
  }

  function clearSortDragStyles() {
    dlg.querySelectorAll(".nav-organize-row.is-dragging, .nav-organize-row.drag-over").forEach((el) => {
      el.classList.remove("is-dragging", "drag-over");
    });
  }

  function sortRowAtPoint(x, y, skipRow) {
    const stack = typeof document.elementsFromPoint === "function" ? document.elementsFromPoint(x, y) : [document.elementFromPoint(x, y)];
    const container = activeSortContainer();
    for (const el of stack) {
      const row = el?.closest?.(".nav-organize-row[data-org-id]");
      if (!row || !container?.contains(row) || row === skipRow) continue;
      return row;
    }
    return null;
  }

  function commitSortDrag(fromId, toId) {
    if (!fromId || !toId || fromId === toId) return false;
    let ok = false;
    if (activeTab === "groups") ok = reorderById(draftGroupOrder, fromId, toId);
    else if (activeTab === "tools") ok = reorderToolsInGroup(fromId, toId);
    else if (activeTab === "favorites") ok = reorderById(draftFavorites, fromId, toId);
    if (!ok) return false;
    dirty = true;
    renderActiveTab();
    return true;
  }

  function applyGroupToolOrder(orderedIds) {
    const n = nav();
    const gid = groupSelect?.value;
    const group = n?.GROUP_BY_ID?.[gid];
    if (!group || !orderedIds?.length) return false;
    const set = new Set(group.tools);
    let replaced = false;
    const next = [];
    draftToolOrder.forEach((id) => {
      if (!set.has(id)) {
        next.push(id);
        return;
      }
      if (!replaced) {
        orderedIds.forEach((tid) => {
          if (set.has(tid) && n.isNavToolVisible?.(tid)) next.push(tid);
        });
        replaced = true;
      }
    });
    if (!replaced) {
      orderedIds.forEach((tid) => {
        if (set.has(tid) && n.isNavToolVisible?.(tid)) next.push(tid);
      });
    }
    draftToolOrder = next;
    return true;
  }

  function reorderToolsInGroup(fromId, toId) {
    if (fromId === toId) return false;
    const items = toolsForSelectedGroup();
    const fromLocal = items.indexOf(fromId);
    const toLocal = items.indexOf(toId);
    if (fromLocal < 0 || toLocal < 0) return false;
    const reordered = items.slice();
    const [moved] = reordered.splice(fromLocal, 1);
    reordered.splice(toLocal, 0, moved);
    return applyGroupToolOrder(reordered);
  }

  let sortPointer = null;
  let longPressSort = null;

  function cancelLongPressSort() {
    if (!longPressSort) return;
    clearTimeout(longPressSort.timer);
    if (longPressSort.onMove) {
      document.removeEventListener("pointermove", longPressSort.onMove);
      document.removeEventListener("pointerup", longPressSort.onUp);
      document.removeEventListener("pointercancel", longPressSort.onCancel);
    }
    longPressSort.row?.classList.remove("is-longpress-pending");
    longPressSort = null;
  }

  function cancelSortPointer() {
    if (!sortPointer) return;
    if (sortPointer.onMove) {
      document.removeEventListener("pointermove", sortPointer.onMove);
      document.removeEventListener("pointerup", sortPointer.onUp);
      document.removeEventListener("pointercancel", sortPointer.onCancel);
    }
    clearSortDragStyles();
    sortPointer = null;
  }

  function beginSortPointer(e, row, { immediate = false, captureEl = null } = {}) {
    if (sortDragDisabled() || !row?.dataset?.orgId) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    cancelLongPressSort();
    cancelSortPointer();
    const fromId = row.dataset.orgId;
    const startX = e.clientX;
    const startY = e.clientY;
    const ACTIVATE_PX = immediate ? 0 : 8;
    const captureTarget = captureEl || e.target.closest(".nav-organize-drag-handle") || row;

    const onMove = (ev) => {
      if (!sortPointer || sortPointer.pointerId !== ev.pointerId) return;
      const dx = Math.abs(ev.clientX - startX);
      const dy = Math.abs(ev.clientY - startY);
      if (!sortPointer.active) {
        if (dx + dy < ACTIVATE_PX) return;
        sortPointer.active = true;
      }
      ev.preventDefault();
      clearSortDragStyles();
      sortPointer.row?.classList.add("is-dragging");
      const target = sortRowAtPoint(ev.clientX, ev.clientY, sortPointer.row);
      if (target) target.classList.add("drag-over");
      sortPointer.overId = target?.dataset?.orgId || "";
    };

    const finish = (ev, cancelled) => {
      if (!sortPointer || sortPointer.pointerId !== ev.pointerId) return;
      const state = sortPointer;
      try {
        state.captureTarget?.releasePointerCapture?.(ev.pointerId);
      } catch (_) {}
      const toId = cancelled
        ? ""
        : state.overId || sortRowAtPoint(ev.clientX, ev.clientY, state.row)?.dataset?.orgId;
      cancelSortPointer();
      if (!state.active || !toId) return;
      commitSortDrag(fromId, toId);
    };

    const onUp = (ev) => finish(ev, false);
    const onCancel = (ev) => finish(ev, true);

    sortPointer = {
      pointerId: e.pointerId,
      row,
      captureTarget,
      active: immediate,
      overId: "",
      onMove,
      onUp,
      onCancel,
    };

    try {
      captureTarget.setPointerCapture(e.pointerId);
    } catch (_) {}

    document.addEventListener("pointermove", onMove, { passive: false });
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
  }

  function beginLongPressSort(e, row) {
    cancelLongPressSort();
    const startX = e.clientX;
    const startY = e.clientY;
    const LONG_MS = 360;
    const CANCEL_PX = 14;
    row.classList.add("is-longpress-pending");

    const onMove = (ev) => {
      if (!longPressSort) return;
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > CANCEL_PX) cancelLongPressSort();
    };
    const onEnd = () => cancelLongPressSort();

    const timer = window.setTimeout(() => {
      if (!longPressSort) return;
      const startEvent = longPressSort.startEvent;
      cancelLongPressSort();
      try {
        navigator.vibrate?.(12);
      } catch (_) {}
      beginSortPointer(startEvent, row, { immediate: true, captureEl: row });
    }, LONG_MS);

    longPressSort = { timer, row, startEvent: e, onMove, onUp: onEnd, onCancel: onEnd };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onEnd);
    document.addEventListener("pointercancel", onEnd);
  }

  function createRow(label, { id, sortable, meta, upDisabled, downDisabled, onUp, onDown, trailing = [] } = {}) {
    const row = document.createElement("div");
    row.className = "nav-organize-row";
    if (sortable && id) row.dataset.orgId = id;
    let dragHandle = null;
    if (sortable) {
      dragHandle = document.createElement("button");
      dragHandle.type = "button";
      dragHandle.className = "nav-organize-drag-handle";
      dragHandle.textContent = "⠿";
      dragHandle.title = "拖动排序（或长按名称）";
      dragHandle.setAttribute("aria-label", "拖动排序");
      dragHandle.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
      row.appendChild(dragHandle);
    }
    const textWrap = document.createElement("div");
    textWrap.className = "nav-organize-row-text";
    const name = document.createElement("span");
    name.className = "nav-organize-row-label";
    name.textContent = label;
    textWrap.appendChild(name);
    if (meta) {
      const metaEl = document.createElement("span");
      metaEl.className = "nav-organize-row-meta";
      metaEl.textContent = meta;
      textWrap.appendChild(metaEl);
    }
    const actions = document.createElement("div");
    actions.className = "nav-organize-row-actions";
    trailing.forEach((btn) => actions.appendChild(btn));
    const up = document.createElement("button");
    up.type = "button";
    up.className = "ghost-btn nav-organize-nudge";
    up.textContent = "↑";
    up.title = "上移";
    up.disabled = !!upDisabled;
    up.addEventListener("click", () => onUp?.());
    const down = document.createElement("button");
    down.type = "button";
    down.className = "ghost-btn nav-organize-nudge";
    down.textContent = "↓";
    down.title = "下移";
    down.disabled = !!downDisabled;
    down.addEventListener("click", () => onDown?.());
    actions.appendChild(up);
    actions.appendChild(down);
    row.appendChild(textWrap);
    row.appendChild(actions);
    return row;
  }

  function appendEmpty(panel, text) {
    const empty = document.createElement("p");
    empty.className = "hint tight nav-organize-empty";
    empty.textContent = text;
    panel.appendChild(empty);
  }

  function setTab(tab) {
    activeTab = tab;
    dlg.querySelectorAll("[data-nav-org-tab]").forEach((btn) => {
      const on = btn.dataset.navOrgTab === tab;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    dlg.querySelectorAll("[data-nav-org-panel]").forEach((panel) => {
      const on = panel.dataset.navOrgPanel === tab;
      panel.hidden = !on;
    });
    syncSearchPlaceholder();
    renderActiveTab();
  }

  function syncSearchPlaceholder() {
    if (!searchInput) return;
    const map = {
      groups: "搜索分类…",
      tools: "搜索工具（跨分类）…",
      favorites: "搜索常用或待添加工具…",
    };
    searchInput.placeholder = map[activeTab] || "搜索…";
  }

  function renderGroupsTab() {
    if (!panelGroups) return;
    panelGroups.innerHTML = "";
    const n = nav();
    if (!n) return;
    const q = searchQuery();
    const visible = draftGroupOrder.filter((gid) => {
      const g = n.GROUP_BY_ID?.[gid];
      return g && matchesQuery(g.label, q);
    });
    if (!visible.length) {
      appendEmpty(panelGroups, q ? "没有匹配的分类" : "暂无分类");
      return;
    }
    visible.forEach((gid) => {
      const g = n.GROUP_BY_ID[gid];
      const idx = draftGroupOrder.indexOf(gid);
      panelGroups.appendChild(
        createRow(g.label, {
          id: gid,
          sortable: !q,
          upDisabled: idx <= 0,
          downDisabled: idx >= draftGroupOrder.length - 1,
          onUp: () => {
            if (moveInList(draftGroupOrder, idx, -1)) {
              dirty = true;
              renderGroupsTab();
            }
          },
          onDown: () => {
            if (moveInList(draftGroupOrder, idx, 1)) {
              dirty = true;
              renderGroupsTab();
            }
          },
        })
      );
    });
  }

  function toolsForSelectedGroup() {
    const n = nav();
    if (!n) return [];
    const gid = groupSelect?.value;
    const group = n.GROUP_BY_ID?.[gid];
    if (!group) return [];
    const set = new Set(group.tools);
    return draftToolOrder.filter((id) => set.has(id) && n.isNavToolVisible?.(id));
  }

  function toolsMatchingSearch() {
    const n = nav();
    if (!n) return [];
    const q = searchQuery();
    if (!q) return [];
    return draftToolOrder.filter((id) => {
      if (!n.isNavToolVisible?.(id)) return false;
      const name = n.toolName?.(id) || id;
      const groupLabel = n.groupLabel?.(n.toolGroupId?.(id)) || "";
      return matchesQuery(name, q) || matchesQuery(groupLabel, q) || matchesQuery(id, q);
    });
  }

  function fillGroupSelect() {
    const n = nav();
    if (!n || !groupSelect) return;
    const prev = groupSelect.value;
    groupSelect.innerHTML = "";
    draftGroupOrder.forEach((gid) => {
      const g = n.GROUP_BY_ID?.[gid];
      if (!g) return;
      const opt = document.createElement("option");
      opt.value = gid;
      opt.textContent = g.label;
      groupSelect.appendChild(opt);
    });
    if (prev && [...groupSelect.options].some((o) => o.value === prev)) groupSelect.value = prev;
    else if (groupSelect.options.length) groupSelect.selectedIndex = 0;
  }

  function renderToolsTab() {
    const n = nav();
    if (!n || !toolList) return;
    fillGroupSelect();
    const q = searchQuery();
    const global = q.length > 0;
    if (groupPickWrap) groupPickWrap.hidden = global;
    toolList.innerHTML = "";

    const items = global ? toolsMatchingSearch() : toolsForSelectedGroup();
    if (!global && items.length) {
      const hint = document.createElement("p");
      hint.className = "hint tight nav-organize-search-hint";
      const groupLabel = n.groupLabel?.(groupSelect?.value) || "当前分类";
      hint.textContent = `正在调整「${groupLabel}」下的工具顺序；长按名称或拖 ⠿ 均可排序。`;
      toolList.appendChild(hint);
    }
    items.forEach((id, idx) => {
      const groupLabel = n.groupLabel?.(n.toolGroupId?.(id)) || "";
      toolList.appendChild(
        createRow(n.toolName?.(id) || id, {
          id,
          sortable: !global,
          meta: global ? groupLabel : "",
          upDisabled: global || idx === 0,
          downDisabled: global || idx === items.length - 1,
          onUp: () => {
            const prevId = items[idx - 1];
            if (!prevId || !reorderToolsInGroup(id, prevId)) return;
            dirty = true;
            renderToolsTab();
          },
          onDown: () => {
            const nextId = items[idx + 1];
            if (!nextId || !reorderToolsInGroup(id, nextId)) return;
            dirty = true;
            renderToolsTab();
          },
        })
      );
    });

    if (!items.length) {
      appendEmpty(
        toolList,
        global ? "没有匹配的工具" : q ? "该分类下没有匹配项" : "该分类下暂无可见工具"
      );
    } else if (global) {
      const hint = document.createElement("p");
      hint.className = "hint tight nav-organize-search-hint";
      hint.textContent = "搜索模式下仅预览；清空搜索后在「工具」Tab 选分类，再拖动或 ↑↓ 调整顺序。";
      toolList.prepend(hint);
    }
  }

  function favoriteCandidates() {
    const n = nav();
    if (!n) return [];
    const q = searchQuery();
    const favSet = new Set(draftFavorites);
    return (n.DEFAULT_ORDER || []).filter((id) => {
      if (!n.isNavToolVisible?.(id) || favSet.has(id)) return false;
      const name = n.toolName?.(id) || id;
      const groupLabel = n.groupLabel?.(n.toolGroupId?.(id)) || "";
      return matchesQuery(name, q) || matchesQuery(groupLabel, q);
    });
  }

  function removeFavBtn(id) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ghost-btn nav-organize-remove";
    btn.textContent = "移除";
    btn.title = "从常用移除";
    btn.addEventListener("click", () => {
      draftFavorites = draftFavorites.filter((x) => x !== id);
      dirty = true;
      renderFavoritesTab();
    });
    return btn;
  }

  function renderFavoritesTab() {
    if (!panelFav) return;
    panelFav.innerHTML = "";
    const n = nav();
    if (!n) return;
    const q = searchQuery();

    const listHead = document.createElement("p");
    listHead.className = "nav-organize-section-label";
    listHead.textContent = "已添加";
    panelFav.appendChild(listHead);

    const favItems = draftFavorites.filter((id) => {
      if (!n.isNavToolVisible?.(id)) return false;
      if (!q) return true;
      const name = n.toolName?.(id) || id;
      const groupLabel = n.groupLabel?.(n.toolGroupId?.(id)) || "";
      return matchesQuery(name, q) || matchesQuery(groupLabel, q);
    });

    if (!favItems.length) {
      appendEmpty(panelFav, q ? "没有匹配的常用工具" : "还没有常用工具，可从下方添加");
    } else {
      const sortList = document.createElement("div");
      sortList.className = "nav-organize-sort-list";
      favItems.forEach((id) => {
        const idx = draftFavorites.indexOf(id);
        const groupLabel = n.groupLabel?.(n.toolGroupId?.(id)) || "";
        sortList.appendChild(
          createRow(n.toolName?.(id) || id, {
            id,
            sortable: !q,
            meta: groupLabel,
            upDisabled: idx <= 0,
            downDisabled: idx >= draftFavorites.length - 1,
            trailing: [removeFavBtn(id)],
            onUp: () => {
              if (moveInList(draftFavorites, idx, -1)) {
                dirty = true;
                renderFavoritesTab();
              }
            },
            onDown: () => {
              if (moveInList(draftFavorites, idx, 1)) {
                dirty = true;
                renderFavoritesTab();
              }
            },
          })
        );
      });
      panelFav.appendChild(sortList);
    }

    const addHead = document.createElement("p");
    addHead.className = "nav-organize-section-label";
    addHead.textContent = "添加常用";
    panelFav.appendChild(addHead);

    const candidates = favoriteCandidates();
    if (!candidates.length) {
      appendEmpty(panelFav, q ? "没有可添加的匹配工具" : "可添加的工具已全部加入常用");
      return;
    }

    const addGrid = document.createElement("div");
    addGrid.className = "nav-organize-add-grid";
    candidates.slice(0, q ? 48 : 24).forEach((id) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "nav-organize-add-btn";
      const groupLabel = n.groupLabel?.(n.toolGroupId?.(id)) || "";
      btn.innerHTML = `<span class="nav-organize-add-name">${escapeHtml(n.toolName?.(id) || id)}</span><span class="nav-organize-add-meta">${escapeHtml(groupLabel)}</span>`;
      btn.addEventListener("click", () => {
        if (draftFavorites.includes(id)) return;
        draftFavorites.push(id);
        dirty = true;
        renderFavoritesTab();
      });
      addGrid.appendChild(btn);
    });
    panelFav.appendChild(addGrid);
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderActiveTab() {
    if (activeTab === "groups") renderGroupsTab();
    else if (activeTab === "tools") renderToolsTab();
    else renderFavoritesTab();
  }

  function loadDrafts() {
    const n = nav();
    if (!n) return;
    draftGroupOrder = cloneList(n.loadGroupOrder?.());
    draftToolOrder = cloneList(n.loadOrder?.());
    draftFavorites = cloneList(n.loadFavorites?.());
    dirty = false;
  }

  function commitDrafts() {
    const n = nav();
    if (!n) return;
    if (dirty) {
      n.saveGroupOrder?.(draftGroupOrder);
      n.saveOrder?.(draftToolOrder);
      n.saveFavorites?.(draftFavorites);
      n.refreshNav?.();
      dirty = false;
      toast("已保存菜单顺序");
    }
  }

  function resetDefaults() {
    const n = nav();
    if (!n) return;
    draftGroupOrder = cloneList(n.DEFAULT_GROUP_ORDER);
    draftToolOrder = cloneList(n.DEFAULT_ORDER);
    draftFavorites = [];
    dirty = true;
    renderActiveTab();
    toast("已载入默认顺序（点完成保存）");
  }

  function confirmDiscard() {
    if (!dirty) return true;
    return window.confirm("放弃未保存的更改？");
  }

  function openOrganize() {
    loadDrafts();
    if (searchInput) searchInput.value = "";
    setTab("groups");
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
    document.body.classList.add("nav-organize-open");
    requestAnimationFrame(() => searchInput?.focus());
  }

  function closeOrganize(save) {
    cancelLongPressSort();
    cancelSortPointer();
    if (!save && !confirmDiscard()) return;
    if (save) commitDrafts();
    else dirty = false;
    if (typeof dlg.close === "function") dlg.close();
    else dlg.removeAttribute("open");
    document.body.classList.remove("nav-organize-open");
  }

  dlg.addEventListener("pointerdown", (e) => {
    if (sortDragDisabled()) return;
    if (e.target.closest(".nav-organize-row-actions, .nav-organize-add-grid, .nav-organize-add-btn")) return;
    const row = e.target.closest(".nav-organize-row[data-org-id]");
    if (!row || !activeSortContainer()?.contains(row)) return;

    if (e.target.closest(".nav-organize-drag-handle")) {
      e.preventDefault();
      beginSortPointer(e, row, { captureEl: e.target.closest(".nav-organize-drag-handle") });
      return;
    }

    if (e.target.closest(".nav-organize-row-text, .nav-organize-row-label, .nav-organize-row-meta")) {
      if (e.pointerType === "touch") e.preventDefault();
      beginLongPressSort(e, row);
    }
  });

  dlg.querySelectorAll("[data-nav-org-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.navOrgTab || "groups"));
  });

  groupSelect?.addEventListener("change", () => renderToolsTab());
  searchInput?.addEventListener("input", () => renderActiveTab());

  closeBtn?.addEventListener("click", () => closeOrganize(false));
  cancelBtn?.addEventListener("click", () => closeOrganize(false));
  doneBtn?.addEventListener("click", () => closeOrganize(true));
  resetBtn?.addEventListener("click", () => {
    if (window.confirm("恢复分类、全部工具与常用工具的默认顺序？")) resetDefaults();
  });

  dlg.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeOrganize(false);
  });

  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) closeOrganize(false);
  });

  window.DevToolsNavOrganize = { open: openOrganize, close: () => closeOrganize(true) };
})();
