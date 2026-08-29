(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  const MERIDIAN_COLORS = {
    LU: "#7eb8da",
    LI: "#e8a87c",
    ST: "#f4d06f",
    SP: "#c5e063",
    HT: "#f08a8a",
    SI: "#ffb4a2",
    BL: "#9bbcff",
    KI: "#b8a9ff",
    PC: "#ff9ecd",
    TE: "#7fd8be",
    GB: "#a8e6cf",
    LR: "#8fd694",
    CV: "#ffd6a5",
    GV: "#ffe066",
  };

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[()（）]/g, "");
  }

  function highlight(text, q) {
    const raw = String(text || "");
    if (!q) return raw;
    const idx = norm(raw).indexOf(norm(q));
    if (idx < 0) return raw;
    const before = raw.slice(0, idx);
    const mid = raw.slice(idx, idx + q.length);
    const after = raw.slice(idx + q.length);
    return `${before}<mark class="acu-mark">${mid}</mark>${after}`;
  }

  function meridianName(key, meridianByKey) {
    const m = meridianByKey[key];
    return m ? m.nameZh : key || "—";
  }

  function renderDetail(ap, meridianByKey, q) {
    const detail = $("#acu-detail");
    const empty = $("#acu-detail-empty");
    if (!detail || !empty) return;
    if (!ap) {
      detail.hidden = true;
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    detail.hidden = false;

    $("#acu-detail-code").textContent = ap.code;
    $("#acu-detail-name").innerHTML = highlight(ap.nameZh, q);
    $("#acu-detail-pinyin").textContent = ap.namePinyin || ap.nameEn || "";
    $("#acu-detail-meridian").textContent = meridianName(ap.meridianKey, meridianByKey);

    const loc = ap.location || ap.locationEn || "";
    $("#acu-detail-location").textContent = loc || "（暂无定位描述）";
    $("#acu-detail-location-wrap").hidden = !loc;

    const depth = ap.depth || "";
    $("#acu-detail-depth").textContent = depth;
    $("#acu-detail-depth-wrap").hidden = !depth;

    const desc = ap.description || ap.descriptionEn || "";
    $("#acu-detail-desc").textContent = desc;
    $("#acu-detail-desc-wrap").hidden = !desc;

    const cats = ap.specialCategories || [];
    const catEl = $("#acu-detail-cats");
    catEl.innerHTML = cats.map((c) => `<span class="acu-tag">${c}</span>`).join("");
    $("#acu-detail-cats-wrap").hidden = !cats.length;

    const actions = ap.actions || [];
    $("#acu-detail-actions").innerHTML = actions.length
      ? actions.map((a) => `<li>${a}</li>`).join("")
      : "<li class=\"muted\">暂无</li>";

    const inds = ap.indications || [];
    $("#acu-detail-indications").innerHTML = inds.length
      ? inds.map((a) => `<li>${a}</li>`).join("")
      : "<li class=\"muted\">暂无</li>";

    const richBadge = $("#acu-detail-rich");
    if (richBadge) richBadge.hidden = !ap.rich;
  }

  function matchesQuery(ap, q) {
    if (!q) return true;
    const n = norm(q);
    const hay = [
      ap.code,
      ap.nameZh,
      ap.namePinyin,
      ap.nameEn,
      ap.location,
      ap.description,
      ...(ap.actions || []),
      ...(ap.indications || []),
      ...(ap.specialCategories || []),
    ]
      .join(" ")
      .toLowerCase();
    return norm(hay).includes(n);
  }

  function bindChartTabs() {
    const tabs = document.querySelectorAll("[data-acu-chart]");
    const panels = document.querySelectorAll("[data-acu-chart-panel]");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const id = tab.dataset.acuChart;
        tabs.forEach((t) => {
          const on = t === tab;
          t.classList.toggle("is-active", on);
          t.setAttribute("aria-selected", on ? "true" : "false");
        });
        panels.forEach((p) => {
          p.hidden = p.dataset.acuChartPanel !== id;
        });
      });
    });
  }

  async function initAcupoint() {
    const root = $("#acupoint");
    if (!root || root.dataset.bound) return;
    root.dataset.bound = "1";

    const search = $("#acu-search");
    const meridianFilter = $("#acu-meridian");
    const listEl = $("#acu-list");
    const countEl = $("#acu-count");
    const metaEl = $("#acu-meta");

    let bundle;
    try {
      const res = await fetch("./lib/acupoints-bundle.json?v=20260829acu1");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bundle = await res.json();
    } catch (err) {
      if (metaEl) metaEl.textContent = `数据加载失败：${err.message}`;
      return;
    }

    const meridianByKey = Object.fromEntries((bundle.meridians || []).map((m) => [m.key, m]));
    const acupoints = bundle.acupoints || [];
    let selectedId = acupoints[0]?.id || "";
    let query = "";
    let meridianKey = "";

    if (meridianFilter) {
      meridianFilter.innerHTML =
        `<option value="">全部经络（${acupoints.length} 穴）</option>` +
        (bundle.meridians || [])
          .map((m) => `<option value="${m.key}">${m.abbreviation} · ${m.nameZh}</option>`)
          .join("");
    }

    if (metaEl) {
      metaEl.textContent = `共 ${bundle.counts?.acupoints || acupoints.length} 个经穴 · ${bundle.counts?.richDetail || 0} 条含详细定位与功效（本草典）`;
    }

    function filtered() {
      return acupoints.filter((ap) => {
        if (meridianKey && ap.meridianKey !== meridianKey) return false;
        return matchesQuery(ap, query);
      });
    }

    function renderList() {
      const rows = filtered();
      if (countEl) countEl.textContent = `${rows.length} 条`;
      if (!listEl) return;

      if (!rows.length) {
        listEl.innerHTML = `<p class="hint acu-list-empty">没有匹配的穴位，试试换关键字或经络筛选。</p>`;
        renderDetail(null, meridianByKey, query);
        return;
      }

      if (!rows.some((r) => r.id === selectedId)) selectedId = rows[0].id;

      listEl.innerHTML = rows
        .map((ap) => {
          const abbr = ap.meridianAbbr || "";
          const color = MERIDIAN_COLORS[abbr] || "var(--accent)";
          const active = ap.id === selectedId ? " is-active" : "";
          return `<button type="button" class="acu-row${active}" data-acu-id="${ap.id}" style="--acu-mer-color:${color}">
            <span class="acu-row-code mono">${highlight(ap.code, query)}</span>
            <span class="acu-row-name">${highlight(ap.nameZh, query)}</span>
            <span class="acu-row-mer">${abbr}</span>
          </button>`;
        })
        .join("");

      listEl.querySelectorAll("[data-acu-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          selectedId = btn.dataset.acuId;
          renderList();
          const ap = acupoints.find((x) => x.id === selectedId);
          renderDetail(ap, meridianByKey, query);
        });
      });

      const ap = acupoints.find((x) => x.id === selectedId);
      renderDetail(ap, meridianByKey, query);
    }

    search?.addEventListener("input", () => {
      query = search.value.trim();
      renderList();
    });

    meridianFilter?.addEventListener("change", () => {
      meridianKey = meridianFilter.value;
      renderList();
    });

    bindChartTabs();
    renderList();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAcupoint);
  } else {
    initAcupoint();
  }
})();
