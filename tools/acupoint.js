(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

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
    EX: "#c9a0ff",
  };

  const EXTRA_REGIONS = ["头颈部", "胸腹部", "背部", "肩胛部", "上肢", "下肢"];

  function norm(s) {
    return String(s || "")
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[()（）]/g, "");
  }

  function highlight(text, q) {
    const raw = String(text || "");
    if (!q) return raw;
    const nq = norm(q);
    const nraw = norm(raw);
    const idx = nraw.indexOf(nq);
    if (idx < 0) return raw;
    let rawIdx = 0;
    let normIdx = 0;
    while (normIdx < idx && rawIdx < raw.length) {
      const ch = raw[rawIdx];
      if (!/[()（）\s]/.test(ch)) normIdx += 1;
      rawIdx += 1;
    }
    const mid = raw.slice(rawIdx, rawIdx + q.length);
    return `${raw.slice(0, rawIdx)}<mark class="acu-mark">${mid}</mark>${raw.slice(rawIdx + q.length)}`;
  }

  function meridianLabel(ap, meridianByKey) {
    if (ap.type === "extra") return ap.region || "经外奇穴";
    const m = meridianByKey[ap.meridianKey];
    return m ? m.nameZh : ap.meridianKey || "—";
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
    $("#acu-detail-meridian").textContent = meridianLabel(ap, meridianByKey);

    const typeBadge = $("#acu-detail-type");
    if (typeBadge) {
      typeBadge.textContent = ap.type === "extra" ? "奇穴" : "经穴";
      typeBadge.dataset.kind = ap.type || "meridian";
    }

    const loc = ap.location || ap.locationEn || "";
    $("#acu-detail-location").textContent = loc || "（暂无定位描述）";
    $("#acu-detail-location-wrap").hidden = false;

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
    $("#acu-detail-actions-wrap").hidden = ap.type === "extra" && !actions.length;

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
      ap.region,
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
    const tabs = $$("[data-acu-chart]");
    const panels = $$("[data-acu-chart-panel]");
    tabs.forEach((tab) => {
      tab.addEventListener("click", () => {
        const id = tab.dataset.acuChart;
        tabs.forEach((t) => {
          const on = t === tab;
          t.classList.toggle("is-active", on);
          t.setAttribute("aria-selected", on ? "true" : "false");
        });
        panels.forEach((p) => {
          const show = p.dataset.acuChartPanel === id;
          p.hidden = !show;
          if (show) {
            p.querySelectorAll("img").forEach((img) => {
              if (img.loading === "lazy") img.loading = "eager";
              img.decode?.().catch(() => {});
            });
          }
        });
      });
    });
  }

  function bindChartPreview() {
    const dlg = $("#acu-lightbox");
    const stage = $("#acu-lightbox-stage");
    const img = $("#acu-lightbox-img");
    const cap = $("#acu-lightbox-cap");
    const pctEl = $("#acu-lightbox-zoom-pct");
    const closeBtn = $("#acu-lightbox-close");
    const zoomInBtn = $("#acu-lightbox-zoom-in");
    const zoomOutBtn = $("#acu-lightbox-zoom-out");
    const zoomResetBtn = $("#acu-lightbox-zoom-reset");
    if (!dlg || !stage || !img) return;

    const view = { scale: 1, x: 0, y: 0, dragging: false, lastX: 0, lastY: 0 };

    function syncTransform() {
      img.style.transform = `translate(calc(-50% + ${view.x}px), calc(-50% + ${view.y}px)) scale(${view.scale})`;
      if (pctEl) pctEl.textContent = `${Math.round(view.scale * 100)}%`;
    }

    function fitImage() {
      const sw = stage.clientWidth || 1;
      const sh = stage.clientHeight || 1;
      const nw = img.naturalWidth || 1;
      const nh = img.naturalHeight || 1;
      view.scale = Math.min(1, sw / nw, sh / nh);
      view.x = 0;
      view.y = 0;
      syncTransform();
    }

    function resetView() {
      fitImage();
    }

    function clampScale(next) {
      return Math.min(6, Math.max(0.35, next));
    }

    function zoomAt(clientX, clientY, nextScale) {
      const rect = stage.getBoundingClientRect();
      const cx = clientX - rect.left - rect.width / 2;
      const cy = clientY - rect.top - rect.height / 2;
      const ratio = nextScale / view.scale;
      view.x = cx - (cx - view.x) * ratio;
      view.y = cy - (cy - view.y) * ratio;
      view.scale = nextScale;
      syncTransform();
    }

    function openPreview(src, alt) {
      if (!src) return;
      view.scale = 1;
      view.x = 0;
      view.y = 0;
      img.onload = () => fitImage();
      img.src = src;
      img.alt = alt || "";
      if (cap) cap.textContent = alt || "";
      if (typeof dlg.showModal === "function") dlg.showModal();
      else dlg.setAttribute("open", "");
    }

    function closePreview() {
      if (dlg.open) dlg.close();
      else dlg.removeAttribute("open");
      img.removeAttribute("src");
      resetView();
    }

    $$(".acu-chart-zoom").forEach((btn) => {
      btn.addEventListener("click", () => {
        const inner = btn.querySelector("img");
        const src = btn.dataset.acuZoomSrc || inner?.currentSrc || inner?.src || "";
        openPreview(src, inner?.alt || btn.getAttribute("aria-label") || "");
      });
    });

    closeBtn?.addEventListener("click", closePreview);
    dlg.addEventListener("click", (e) => {
      if (e.target === dlg) closePreview();
    });
    dlg.addEventListener("cancel", (e) => {
      e.preventDefault();
      closePreview();
    });

    zoomInBtn?.addEventListener("click", () => {
      const rect = stage.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, clampScale(view.scale * 1.2));
    });
    zoomOutBtn?.addEventListener("click", () => {
      const rect = stage.getBoundingClientRect();
      zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, clampScale(view.scale / 1.2));
    });
    zoomResetBtn?.addEventListener("click", resetView);

    stage.addEventListener(
      "wheel",
      (e) => {
        if (!dlg.open) return;
        e.preventDefault();
        const factor = Math.exp(-e.deltaY * 0.0015);
        zoomAt(e.clientX, e.clientY, clampScale(view.scale * factor));
      },
      { passive: false }
    );

    stage.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      view.dragging = true;
      view.lastX = e.clientX;
      view.lastY = e.clientY;
      stage.setPointerCapture?.(e.pointerId);
    });
    stage.addEventListener("pointermove", (e) => {
      if (!view.dragging) return;
      view.x += e.clientX - view.lastX;
      view.y += e.clientY - view.lastY;
      view.lastX = e.clientX;
      view.lastY = e.clientY;
      syncTransform();
    });
    stage.addEventListener("pointerup", () => {
      view.dragging = false;
    });
    stage.addEventListener("pointercancel", () => {
      view.dragging = false;
    });

    stage.addEventListener("dblclick", (e) => {
      if (view.scale > 1.05) resetView();
      else zoomAt(e.clientX, e.clientY, clampScale(view.scale * 1.8));
    });
  }

  async function initAcupoint() {
    const root = $("#acupoint");
    if (!root || root.dataset.bound) return;
    root.dataset.bound = "1";

    const search = $("#acu-search");
    const meridianFilter = $("#acu-meridian");
    const listEl = $("#acu-list");
    const listTitle = $("#acu-list-title");
    const countEl = $("#acu-count");
    const metaEl = $("#acu-meta");
    const typeSeg = $("#acu-type-seg");

    let bundle;
    try {
      const res = await fetch("./lib/acupoints-bundle.json?v=2026.08.29-030442");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bundle = await res.json();
    } catch (err) {
      if (metaEl) metaEl.textContent = `数据加载失败：${err.message}`;
      return;
    }

    const meridianByKey = Object.fromEntries((bundle.meridians || []).map((m) => [m.key, m]));
    const acupoints = bundle.acupoints || [];
    const meridianCount = bundle.counts?.acupoints || acupoints.filter((x) => x.type !== "extra").length;
    const extraCount = bundle.counts?.extraPoints || acupoints.filter((x) => x.type === "extra").length;
    let selectedId = acupoints[0]?.id || "";
    let query = "";
    let scopeFilter = "";
    let typeFilter = "all";

    if (meridianFilter) {
      const regionOpts = EXTRA_REGIONS.map(
        (r) => `<option value="reg:${r}">奇穴 · ${r}</option>`
      ).join("");
      meridianFilter.innerHTML =
        `<option value="">全部（${meridianCount + extraCount} 穴）</option>` +
        `<optgroup label="十四经">${(bundle.meridians || [])
          .map((m) => `<option value="mer:${m.key}">${m.abbreviation} · ${m.nameZh}</option>`)
          .join("")}</optgroup>` +
        `<optgroup label="经外奇穴">${regionOpts}</optgroup>`;
    }

    if (metaEl) {
      metaEl.textContent = `共 ${meridianCount} 经穴 + ${extraCount} 奇穴 · ${bundle.counts?.richDetail || 0} 条经穴含本草典详细字段 · 参考图来自 Wellcome Collection（CC BY 4.0）`;
    }

    function syncTypeSeg() {
      if (!typeSeg) return;
      $$(".acu-type-btn", typeSeg).forEach((btn) => {
        btn.classList.toggle("is-active", btn.dataset.acuType === typeFilter);
      });
    }

    function filtered() {
      return acupoints.filter((ap) => {
        if (typeFilter === "meridian" && ap.type === "extra") return false;
        if (typeFilter === "extra" && ap.type !== "extra") return false;
        if (scopeFilter.startsWith("mer:") && ap.meridianKey !== scopeFilter.slice(4)) return false;
        if (scopeFilter.startsWith("reg:") && (ap.type !== "extra" || ap.region !== scopeFilter.slice(4))) {
          return false;
        }
        return matchesQuery(ap, query);
      });
    }

    function renderList() {
      const rows = filtered();
      if (countEl) countEl.textContent = `${rows.length} 条`;
      if (listTitle) {
        listTitle.textContent =
          typeFilter === "extra" ? "奇穴列表" : typeFilter === "meridian" ? "经穴列表" : "穴位列表";
      }
      if (!listEl) return;

      if (!rows.length) {
        listEl.innerHTML = `<p class="hint acu-list-empty">没有匹配的穴位，试试换关键字或筛选条件。</p>`;
        renderDetail(null, meridianByKey, query);
        return;
      }

      if (!rows.some((r) => r.id === selectedId)) selectedId = rows[0].id;

      listEl.innerHTML = rows
        .map((ap) => {
          const abbr = ap.type === "extra" ? "EX" : ap.meridianAbbr || "";
          const color = MERIDIAN_COLORS[abbr] || "var(--accent)";
          const active = ap.id === selectedId ? " is-active" : "";
          const merLabel = ap.type === "extra" ? ap.region || "奇" : abbr;
          return `<button type="button" class="acu-row${active}" data-acu-id="${ap.id}" style="--acu-mer-color:${color}">
            <span class="acu-row-code mono">${highlight(ap.code, query)}</span>
            <span class="acu-row-name">${highlight(ap.nameZh, query)}</span>
            <span class="acu-row-mer">${merLabel}</span>
          </button>`;
        })
        .join("");

      listEl.querySelectorAll("[data-acu-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          selectedId = btn.dataset.acuId;
          renderList();
        });
      });

      renderDetail(
        acupoints.find((x) => x.id === selectedId),
        meridianByKey,
        query
      );
    }

    search?.addEventListener("input", () => {
      query = search.value.trim();
      renderList();
    });

    meridianFilter?.addEventListener("change", () => {
      scopeFilter = meridianFilter.value;
      renderList();
    });

    typeSeg?.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-acu-type]");
      if (!btn) return;
      typeFilter = btn.dataset.acuType || "all";
      syncTypeSeg();
      renderList();
    });

    syncTypeSeg();
    bindChartTabs();
    bindChartPreview();
    renderList();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAcupoint);
  } else {
    initAcupoint();
  }
})();
