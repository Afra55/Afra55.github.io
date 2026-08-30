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

  function createRow(label, { meta, upDisabled, downDisabled, onUp, onDown, trailing = [] } = {}) {
    const row = document.createElement("div");
    row.className = "nav-organize-row";
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
  }

  function renderToolsTab() {
    const n = nav();
    if (!n || !toolList) return;
    const q = searchQuery();
    const global = q.length > 0;
    if (groupPickWrap) groupPickWrap.hidden = global;
    toolList.innerHTML = "";

    const items = global ? toolsMatchingSearch() : toolsForSelectedGroup();
    items.forEach((id, idx) => {
      const groupLabel = n.groupLabel?.(n.toolGroupId?.(id)) || "";
      toolList.appendChild(
        createRow(n.toolName?.(id) || id, {
          meta: global ? groupLabel : "",
          upDisabled: global || idx === 0,
          downDisabled: global || idx === items.length - 1,
          onUp: () => {
            const globalFrom = draftToolOrder.indexOf(id);
            const prevId = items[idx - 1];
            const globalTo = draftToolOrder.indexOf(prevId);
            if (globalFrom < 0 || globalTo < 0) return;
            const [item] = draftToolOrder.splice(globalFrom, 1);
            draftToolOrder.splice(globalTo, 0, item);
            dirty = true;
            renderToolsTab();
          },
          onDown: () => {
            const globalFrom = draftToolOrder.indexOf(id);
            const nextId = items[idx + 1];
            const globalTo = draftToolOrder.indexOf(nextId);
            if (globalFrom < 0 || globalTo < 0) return;
            const [item] = draftToolOrder.splice(globalFrom, 1);
            draftToolOrder.splice(globalTo + 1, 0, item);
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
      hint.textContent = "搜索模式下仅预览；清空搜索后可 ↑↓ 调整顺序。";
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
      favItems.forEach((id) => {
        const idx = draftFavorites.indexOf(id);
        const groupLabel = n.groupLabel?.(n.toolGroupId?.(id)) || "";
        panelFav.appendChild(
          createRow(n.toolName?.(id) || id, {
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
    if (!save && !confirmDiscard()) return;
    if (save) commitDrafts();
    else dirty = false;
    if (typeof dlg.close === "function") dlg.close();
    else dlg.removeAttribute("open");
    document.body.classList.remove("nav-organize-open");
  }

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

  openBtn?.addEventListener("click", () => openOrganize());

  window.DevToolsNavOrganize = { open: openOrganize, close: () => closeOrganize(true) };
})();
