(() => {
  "use strict";

  const dlg = document.getElementById("nav-organize");
  if (!dlg) return;

  const closeBtn = document.getElementById("nav-organize-close");
  const doneBtn = document.getElementById("nav-organize-done");
  const resetBtn = document.getElementById("nav-organize-reset");
  const openBtn = document.getElementById("nav-organize-open");
  const groupSelect = document.getElementById("nav-org-tool-group");
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

  function moveInList(list, fromIdx, delta) {
    const toIdx = fromIdx + delta;
    if (fromIdx < 0 || toIdx < 0 || fromIdx >= list.length || toIdx >= list.length) return false;
    const item = list[fromIdx];
    list.splice(fromIdx, 1);
    list.splice(toIdx, 0, item);
    return true;
  }

  function createRow(label, { upDisabled, downDisabled, onUp, onDown }) {
    const row = document.createElement("div");
    row.className = "nav-organize-row";
    const name = document.createElement("span");
    name.className = "nav-organize-row-label";
    name.textContent = label;
    const actions = document.createElement("div");
    actions.className = "nav-organize-row-actions";
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
    row.appendChild(name);
    row.appendChild(actions);
    return row;
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
    renderActiveTab();
  }

  function renderGroupsTab() {
    if (!panelGroups) return;
    panelGroups.innerHTML = "";
    const n = nav();
    if (!n) return;
    draftGroupOrder.forEach((gid, idx) => {
      const g = n.GROUP_BY_ID?.[gid];
      if (!g) return;
      panelGroups.appendChild(
        createRow(g.label, {
          upDisabled: idx === 0,
          downDisabled: idx === draftGroupOrder.length - 1,
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
    fillGroupSelect();
    if (!toolList) return;
    toolList.innerHTML = "";
    const n = nav();
    if (!n) return;
    const items = toolsForSelectedGroup();
    items.forEach((id, idx) => {
      toolList.appendChild(
        createRow(n.toolName?.(id) || id, {
          upDisabled: idx === 0,
          downDisabled: idx === items.length - 1,
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
      const empty = document.createElement("p");
      empty.className = "hint tight nav-organize-empty";
      empty.textContent = "该分类下暂无可见工具";
      toolList.appendChild(empty);
    }
  }

  function renderFavoritesTab() {
    if (!panelFav) return;
    panelFav.innerHTML = "";
    const n = nav();
    if (!n) return;
    if (!draftFavorites.length) {
      const empty = document.createElement("p");
      empty.className = "hint tight nav-organize-empty";
      empty.textContent = "还没有常用工具。在主菜单长按工具名可添加。";
      panelFav.appendChild(empty);
      return;
    }
    draftFavorites.forEach((id, idx) => {
      if (!n.isNavToolVisible?.(id)) return;
      panelFav.appendChild(
        createRow(n.toolName?.(id) || id, {
          upDisabled: idx === 0,
          downDisabled: idx === draftFavorites.length - 1,
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
    if (!n || !dirty) return;
    n.saveGroupOrder?.(draftGroupOrder);
    n.saveOrder?.(draftToolOrder);
    n.saveFavorites?.(draftFavorites);
    n.refreshNav?.();
    dirty = false;
    toast("已保存菜单顺序");
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

  function openOrganize() {
    loadDrafts();
    setTab("groups");
    if (typeof dlg.showModal === "function") dlg.showModal();
    else dlg.setAttribute("open", "");
    document.body.classList.add("nav-organize-open");
  }

  function closeOrganize(save) {
    if (save) commitDrafts();
    if (typeof dlg.close === "function") dlg.close();
    else dlg.removeAttribute("open");
    document.body.classList.remove("nav-organize-open");
  }

  dlg.querySelectorAll("[data-nav-org-tab]").forEach((btn) => {
    btn.addEventListener("click", () => setTab(btn.dataset.navOrgTab || "groups"));
  });

  groupSelect?.addEventListener("change", () => renderToolsTab());

  closeBtn?.addEventListener("click", () => closeOrganize(true));
  doneBtn?.addEventListener("click", () => closeOrganize(true));
  resetBtn?.addEventListener("click", () => {
    if (window.confirm("恢复分类、全部工具与常用工具的默认顺序？")) resetDefaults();
  });

  dlg.addEventListener("cancel", (e) => {
    e.preventDefault();
    closeOrganize(true);
  });

  dlg.addEventListener("click", (e) => {
    if (e.target === dlg) closeOrganize(true);
  });

  openBtn?.addEventListener("click", () => openOrganize());

  window.DevToolsNavOrganize = { open: openOrganize, close: () => closeOrganize(true) };
})();
