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
    BODY: "#9aa7b8",
  };

  const RTXW_BASE = "./lib/acupoint/rtxw/";

  function assetUrl(rel) {
    if (!rel) return "";
    return RTXW_BASE + String(rel).replace(/^\.?\//, "");
  }

  function cacheBust(url) {
    const v = window.TOOLS_BUILD || window.TOOLS_VERSION || "1";
    if (!url) return url;
    const join = url.includes("?") ? "&" : "?";
    return `${url}${join}v=${encodeURIComponent(v)}`;
  }

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
      : '<li class="muted">暂无</li>';
    $("#acu-detail-actions-wrap").hidden = ap.type === "extra" && !actions.length;

    const inds = ap.indications || [];
    $("#acu-detail-indications").innerHTML = inds.length
      ? inds.map((a) => `<li>${a}</li>`).join("")
      : '<li class="muted">暂无</li>';

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

  function bindWellcomeTabs() {
    const tabs = $$(".acu-more [data-acu-chart]");
    const panels = $$(".acu-more [data-acu-chart-panel]");
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

  function bindLightbox() {
    const dlg = $("#acu-lightbox");
    const stage = $("#acu-lightbox-stage");
    const img = $("#acu-lightbox-img");
    const cap = $("#acu-lightbox-cap");
    const pctEl = $("#acu-lightbox-zoom-pct");
    const closeBtn = $("#acu-lightbox-close");
    const zoomInBtn = $("#acu-lightbox-zoom-in");
    const zoomOutBtn = $("#acu-lightbox-zoom-out");
    const zoomResetBtn = $("#acu-lightbox-zoom-reset");
    if (!dlg || !stage || !img) return { openPreview() {} };

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

    // event delegation for all zoom buttons (including dynamic main chart)
    document.addEventListener("click", (e) => {
      const btn = e.target.closest?.(".acu-chart-zoom");
      if (!btn || !btn.closest("#acupoint")) return;
      const inner = btn.querySelector("img");
      const src = btn.dataset.acuZoomSrc || inner?.currentSrc || inner?.src || "";
      openPreview(src, inner?.alt || btn.getAttribute("aria-label") || "");
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

    return { openPreview };
  }

  async function initAcupoint() {
    const root = $("#acupoint");
    if (!root || root.dataset.bound) return;
    root.dataset.bound = "1";

    const search = $("#acu-search");
    const listEl = $("#acu-list");
    const listTitle = $("#acu-list-title");
    const countEl = $("#acu-count");
    const metaEl = $("#acu-meta");
    const merNav = $("#acu-mer-nav");
    const segStrip = $("#acu-seg-strip");
    const mainZoom = $("#acu-main-zoom");
    const mainImg = $("#acu-main-img");
    const chartTitle = $("#acu-chart-title");
    const chartSub = $("#acu-chart-sub");
    const chartEmpty = $("#acu-chart-empty");
    const openZoomBtn = $("#acu-open-zoom");

    let bundle;
    let charts;
    try {
      const [bRes, cRes] = await Promise.all([
        fetch(cacheBust("./lib/acupoints-bundle.json")),
        fetch(cacheBust("./lib/acupoint/rtxw/rtxw-manifest.json")),
      ]);
      if (!bRes.ok) throw new Error(`穴位数据 HTTP ${bRes.status}`);
      bundle = await bRes.json();
      if (cRes.ok) charts = await cRes.json();
      else charts = { meridians: [], body: [], extra: [], labels: {} };
    } catch (err) {
      if (metaEl) metaEl.textContent = `数据加载失败：${err.message}`;
      return;
    }

    const meridianByKey = Object.fromEntries((bundle.meridians || []).map((m) => [m.key, m]));
    const acupoints = bundle.acupoints || [];
    const meridianCount = bundle.counts?.acupoints || acupoints.filter((x) => x.type !== "extra").length;
    const extraCount = bundle.counts?.extraPoints || acupoints.filter((x) => x.type === "extra").length;
    const chartByAbbr = Object.fromEntries((charts.meridians || []).map((m) => [m.abbr, m]));
    const labels = charts.labels || {};

    let scope = (charts.meridians && charts.meridians[0]?.abbr) || "LU";
    let segKey = "overview";
    let selectedId = "";
    let query = "";

    if (metaEl) {
      const nSeg = (charts.meridians || []).reduce((n, m) => n + (m.segments?.length || 0), 0);
      metaEl.textContent = `共 ${meridianCount} 经穴 + ${extraCount} 奇穴 · 示意图 ${nSeg} 段 / 总图 ${(charts.body || []).length} · 奇穴图 ${(charts.extra || []).length}`;
    }

    const lightbox = bindLightbox();
    bindWellcomeTabs();

    function currentChartFrames() {
      if (scope === "BODY") {
        return (charts.body || []).map((b, i) => ({
          key: `body:${b.id}`,
          label: b.label || `总图 ${i + 1}`,
          file: b.file,
          alt: b.label || "人体总图",
        }));
      }
      if (scope === "EX") {
        return (charts.extra || []).map((x, i) => ({
          key: `ex:${x.id}`,
          label: `奇穴 ${x.index || i + 1}`,
          file: x.file,
          alt: `经外奇穴示意图 ${x.index || i + 1}`,
        }));
      }
      const m = chartByAbbr[scope];
      if (!m) return [];
      const frames = [];
      if (m.overview) {
        frames.push({
          key: "overview",
          label: "本经总览",
          file: m.overview,
          alt: `${m.nameZh || labels[scope] || scope}总览`,
        });
      }
      (m.segments || []).forEach((s, i) => {
        frames.push({
          key: s.id || `seg-${i}`,
          label: `第 ${i + 1} 段`,
          file: s.file,
          alt: `${m.nameZh || scope} 第 ${i + 1} 段示意图`,
        });
      });
      return frames;
    }

    function setMainImage(frame) {
      if (!mainImg || !mainZoom) return;
      if (!frame?.file) {
        mainImg.removeAttribute("src");
        mainZoom.dataset.acuZoomSrc = "";
        mainZoom.hidden = true;
        if (chartEmpty) chartEmpty.hidden = false;
        if (openZoomBtn) openZoomBtn.hidden = true;
        return;
      }
      const url = cacheBust(assetUrl(frame.file));
      mainImg.src = url;
      mainImg.alt = frame.alt || frame.label || "";
      mainZoom.dataset.acuZoomSrc = url;
      mainZoom.hidden = false;
      if (chartEmpty) chartEmpty.hidden = true;
      if (openZoomBtn) {
        openZoomBtn.hidden = false;
        openZoomBtn.onclick = () => lightbox.openPreview(url, mainImg.alt);
      }
    }

    function renderSegStrip() {
      const frames = currentChartFrames();
      if (!frames.length) {
        if (segStrip) segStrip.innerHTML = "";
        setMainImage(null);
        if (chartSub) chartSub.textContent = "无图";
        return;
      }
      if (!frames.some((f) => f.key === segKey)) segKey = frames[0].key;
      const active = frames.find((f) => f.key === segKey) || frames[0];
      if (segStrip) {
        segStrip.innerHTML = frames
          .map((f) => {
            const on = f.key === active.key ? " is-active" : "";
            return `<button type="button" class="acu-seg-btn${on}" role="tab" data-acu-seg="${f.key}" aria-selected="${f.key === active.key}">${f.label}</button>`;
          })
          .join("");
        segStrip.querySelectorAll("[data-acu-seg]").forEach((btn) => {
          btn.addEventListener("click", () => {
            segKey = btn.dataset.acuSeg;
            renderSegStrip();
          });
        });
      }
      setMainImage(active);
      if (chartSub) chartSub.textContent = `${active.label} · ${frames.length} 张`;
    }

    function renderMerNav() {
      if (!merNav) return;
      const items = [
        ...(charts.meridians || []).map((m) => ({
          id: m.abbr,
          label: m.abbr,
          title: m.nameZh || labels[m.abbr] || m.abbr,
          color: MERIDIAN_COLORS[m.abbr] || "var(--accent)",
          icon: m.icon ? assetUrl(m.icon) : "",
        })),
        {
          id: "EX",
          label: "奇穴",
          title: "经外奇穴",
          color: MERIDIAN_COLORS.EX,
          icon: charts.cateByAbbr?.EX ? assetUrl(charts.cateByAbbr.EX) : "",
        },
        {
          id: "BODY",
          label: "总图",
          title: "人体总图",
          color: MERIDIAN_COLORS.BODY,
          icon: "",
        },
      ];
      merNav.innerHTML = items
        .map((it) => {
          const on = it.id === scope ? " is-active" : "";
          const icon = it.icon
            ? `<img class="acu-mer-icon" src="${cacheBust(it.icon)}" alt="" width="18" height="18" loading="lazy" />`
            : "";
          return `<button type="button" class="acu-mer-btn${on}" data-acu-scope="${it.id}" title="${it.title}" style="--acu-mer-color:${it.color}">${icon}<span>${it.label}</span></button>`;
        })
        .join("");
      merNav.querySelectorAll("[data-acu-scope]").forEach((btn) => {
        btn.addEventListener("click", () => {
          scope = btn.dataset.acuScope;
          segKey = "overview";
          selectedId = "";
          renderMerNav();
          renderSegStrip();
          renderList();
          updateChartTitle();
        });
      });
    }

    function updateChartTitle() {
      if (!chartTitle) return;
      if (scope === "BODY") chartTitle.textContent = "人体总图";
      else if (scope === "EX") chartTitle.textContent = "经外奇穴示意图";
      else chartTitle.textContent = labels[scope] || chartByAbbr[scope]?.nameZh || scope;
    }

    function filtered() {
      return acupoints.filter((ap) => {
        if (scope === "BODY") return matchesQuery(ap, query);
        if (scope === "EX") {
          if (ap.type !== "extra") return false;
          return matchesQuery(ap, query);
        }
        if (ap.type === "extra") return false;
        if ((ap.meridianAbbr || "") !== scope) return false;
        return matchesQuery(ap, query);
      });
    }

    function renderList() {
      const rows = filtered();
      if (countEl) countEl.textContent = `${rows.length} 条`;
      if (listTitle) {
        listTitle.textContent =
          scope === "EX" ? "奇穴列表" : scope === "BODY" ? (query ? "搜索结果" : "全部穴位") : "本经穴位";
      }
      if (!listEl) return;

      if (!rows.length) {
        listEl.innerHTML = `<p class="hint acu-list-empty">没有匹配的穴位。</p>`;
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
      // 有搜索词时切到总览范围便于跨经检索
      if (query && scope !== "BODY" && scope !== "EX") {
        // keep current meridian filter for in-meridian search
      }
      renderList();
    });

    renderMerNav();
    updateChartTitle();
    renderSegStrip();
    renderList();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initAcupoint);
  } else {
    initAcupoint();
  }
})();
