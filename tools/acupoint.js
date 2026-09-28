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

  const MERIDIAN_SHORT = {
    LU: "肺",
    LI: "大肠",
    ST: "胃",
    SP: "脾",
    HT: "心",
    SI: "小肠",
    BL: "膀胱",
    KI: "肾",
    PC: "心包",
    TE: "三焦",
    GB: "胆",
    LR: "肝",
    CV: "任",
    GV: "督",
    EX: "奇穴",
    BODY: "总图",
  };

  const EX_REGION_ORDER = ["头颈部", "胸腹部", "背部", "肩胛部", "上肢", "下肢", "经穴混入"];

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

  function codeNum(code) {
    const m = String(code || "").match(/(\d+)\s*$/);
    return m ? +m[1] : 0;
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

  function pickBestHit(hits, q) {
    if (!hits.length) return null;
    const nq = norm(q);
    const exactName = hits.find((ap) => norm(ap.nameZh) === nq);
    if (exactName) return exactName;
    const exactCode = hits.find((ap) => norm(ap.code) === nq);
    if (exactCode) return exactCode;
    const starts = hits.find((ap) => norm(ap.nameZh).startsWith(nq) && nq.length >= 2);
    if (starts) return starts;
    return hits[0];
  }

  function buildExtraFrames(charts, acupoints, mapDoc) {
    const byId = Object.fromEntries(acupoints.map((a) => [a.id, a]));
    const curated = (mapDoc && mapDoc.byImage) || {};
    const used = new Set();
    const extras = acupoints
      .filter((a) => a.type === "extra")
      .slice()
      .sort((a, b) => {
        const ra = EX_REGION_ORDER.indexOf(a.region);
        const rb = EX_REGION_ORDER.indexOf(b.region);
        const ia = ra < 0 ? 99 : ra;
        const ib = rb < 0 ? 99 : rb;
        if (ia !== ib) return ia - ib;
        return codeNum(a.code) - codeNum(b.code) || String(a.code).localeCompare(String(b.code));
      });

    const frames = (charts.extra || []).map((x, i) => {
      const cur = curated[x.id];
      let ap = cur?.id && byId[cur.id] ? byId[cur.id] : null;
      if (ap) used.add(ap.id);
      return {
        key: `ex:${x.id}`,
        imageId: x.id,
        index: x.index || i + 1,
        file: x.file,
        ap,
        pointId: ap?.id || "",
        label: "",
        alt: "",
        region: "",
      };
    });

    const remain = extras.filter((e) => !used.has(e.id));
    let ri = 0;
    for (const f of frames) {
      if (!f.ap && ri < remain.length) {
        f.ap = remain[ri++];
        f.pointId = f.ap.id;
        used.add(f.ap.id);
      }
      if (f.ap) {
        f.label = f.ap.nameZh;
        f.alt = `${f.ap.nameZh}（${f.ap.code}）`;
        f.region = f.ap.type === "extra" ? f.ap.region || "奇穴" : "经穴混入";
      } else {
        f.label = `奇穴 ${f.index}`;
        f.alt = `经外奇穴示意图 ${f.index}`;
        f.region = "未标注";
      }
    }
    return frames;
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
    const chartPane = root.querySelector(".acu-chart-pane");

    let captionEl = $("#acu-chart-caption");
    if (!captionEl && chartPane && mainZoom) {
      captionEl = document.createElement("p");
      captionEl.id = "acu-chart-caption";
      captionEl.className = "hint tight acu-chart-caption";
      mainZoom.insertAdjacentElement("afterend", captionEl);
    }

    let regionEl = $("#acu-ex-regions");
    if (!regionEl && chartPane && segStrip) {
      regionEl = document.createElement("div");
      regionEl.id = "acu-ex-regions";
      regionEl.className = "acu-ex-regions";
      regionEl.hidden = true;
      regionEl.setAttribute("role", "tablist");
      regionEl.setAttribute("aria-label", "奇穴分区");
      segStrip.insertAdjacentElement("beforebegin", regionEl);
    }

    let bundle;
    let charts;
    let mapDoc = { byImage: {} };
    try {
      const [bRes, cRes, mRes] = await Promise.all([
        fetch(cacheBust("./lib/acupoints-bundle.json")),
        fetch(cacheBust("./lib/acupoint/rtxw/rtxw-manifest.json")),
        fetch(cacheBust("./lib/acupoint/rtxw/extra-chart-map.json")),
      ]);
      if (!bRes.ok) throw new Error(`穴位数据 HTTP ${bRes.status}`);
      bundle = await bRes.json();
      if (cRes.ok) charts = await cRes.json();
      else charts = { meridians: [], body: [], extra: [], labels: {} };
      if (mRes.ok) mapDoc = await mRes.json();
    } catch (err) {
      if (metaEl) metaEl.textContent = `数据加载失败：${err.message}`;
      return;
    }

    const meridianByKey = Object.fromEntries((bundle.meridians || []).map((m) => [m.key, m]));
    const acupoints = bundle.acupoints || [];
    const byPointId = Object.fromEntries(acupoints.map((a) => [a.id, a]));
    const meridianCount = bundle.counts?.acupoints || acupoints.filter((x) => x.type !== "extra").length;
    const extraCount = bundle.counts?.extraPoints || acupoints.filter((x) => x.type === "extra").length;
    const chartByAbbr = Object.fromEntries((charts.meridians || []).map((m) => [m.abbr, m]));
    const labels = charts.labels || {};
    const maxCodeByAbbr = {};
    for (const ap of acupoints) {
      if (ap.type === "extra") continue;
      const abbr = ap.meridianAbbr;
      if (!abbr) continue;
      const n = codeNum(ap.code);
      if (n > (maxCodeByAbbr[abbr] || 0)) maxCodeByAbbr[abbr] = n;
    }

    const extraFramesAll = buildExtraFrames(charts, acupoints, mapDoc);
    const pointToExKey = new Map();
    for (const f of extraFramesAll) {
      if (f.pointId && !pointToExKey.has(f.pointId)) pointToExKey.set(f.pointId, f.key);
    }

    let scope = (charts.meridians && charts.meridians[0]?.abbr) || "LU";
    let segKey = "overview";
    let selectedId = "";
    let query = "";
    let exRegion = "全部";

    if (metaEl) {
      const nSeg = (charts.meridians || []).reduce((n, m) => n + (m.segments?.length || 0), 0);
      const mapped = extraFramesAll.filter((f) => f.pointId).length;
      metaEl.textContent = `共 ${meridianCount} 经穴 + ${extraCount} 奇穴 · 示意图 ${nSeg} 段 / 总图 ${(charts.body || []).length} · 奇穴图 ${mapped}/${extraFramesAll.length} 已对照`;
    }

    const lightbox = bindLightbox();
    bindWellcomeTabs();

    function scopeForPoint(ap) {
      if (!ap) return scope;
      if (ap.type === "extra") return "EX";
      return ap.meridianAbbr || scope;
    }

    function guessSegmentKey(ap, frames) {
      if (!ap || !frames.length) return frames[0]?.key || "overview";
      if (scope === "EX" || ap.type === "extra") {
        return pointToExKey.get(ap.id) || frames[0].key;
      }
      if (scope === "BODY") return frames[0].key;

      const segs = frames.filter((f) => f.key !== "overview");
      if (!segs.length) return frames[0].key;

      const loc = `${ap.location || ""}${ap.nameZh || ""}${ap.description || ""}`;
      let idx = null;
      if (/头|面|额|目|眼|鼻|耳|项|颈|巅/.test(loc)) idx = 0;
      else if (/足|踝|趾|跟|涌泉/.test(loc)) idx = segs.length - 1;
      else if (/膝|股|髀|腘/.test(loc)) idx = Math.max(0, Math.round(segs.length * 0.72) - 1);
      else if (/腕|手|指|鱼际/.test(loc)) idx = Math.max(0, Math.round(segs.length * 0.85) - 1);
      else if (/肘|臂|臑/.test(loc)) idx = Math.max(0, Math.round(segs.length * 0.55) - 1);
      else if (/胸|乳|腋|肩/.test(loc)) idx = Math.min(segs.length - 1, Math.round(segs.length * 0.2));
      else if (/腹|脐|脘|季胁/.test(loc)) idx = Math.min(segs.length - 1, Math.round(segs.length * 0.4));
      else if (/腰|背|脊|俞/.test(loc)) idx = Math.min(segs.length - 1, Math.round(segs.length * 0.5));

      if (idx == null) {
        const n = codeNum(ap.code);
        const maxN = maxCodeByAbbr[ap.meridianAbbr] || n || segs.length;
        if (n > 0 && maxN > 0) {
          idx = Math.min(segs.length - 1, Math.floor(((n - 1) / maxN) * segs.length));
        } else {
          idx = 0;
        }
      }
      return segs[Math.max(0, Math.min(segs.length - 1, idx))].key;
    }

    function currentChartFrames() {
      if (scope === "BODY") {
        return (charts.body || []).map((b, i) => ({
          key: `body:${b.id}`,
          label: b.label || `总图 ${i + 1}`,
          file: b.file,
          alt: b.label || "人体总图",
          pointId: "",
        }));
      }
      if (scope === "EX") {
        return extraFramesAll
          .filter((f) => exRegion === "全部" || f.region === exRegion)
          .map((f) => ({
            key: f.key,
            label: f.label,
            file: f.file,
            alt: f.alt,
            pointId: f.pointId,
            region: f.region,
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
          pointId: "",
        });
      }
      (m.segments || []).forEach((s, i) => {
        frames.push({
          key: s.id || `seg-${i}`,
          label: `第 ${i + 1} 段`,
          file: s.file,
          alt: `${m.nameZh || scope} 第 ${i + 1} 段示意图`,
          pointId: "",
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
        if (captionEl) captionEl.textContent = "";
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
      if (captionEl) {
        if (scope === "EX" && frame.label) {
          const ap = frame.pointId ? byPointId[frame.pointId] : null;
          captionEl.textContent = ap ? `${ap.nameZh} · ${ap.code}` : frame.label;
        } else {
          captionEl.textContent = frame.label || "";
        }
      }
    }

    function renderExRegions() {
      if (!regionEl) return;
      if (scope !== "EX") {
        regionEl.hidden = true;
        regionEl.innerHTML = "";
        return;
      }
      regionEl.hidden = false;
      const regions = ["全部"];
      for (const name of EX_REGION_ORDER) {
        if (extraFramesAll.some((f) => f.region === name)) regions.push(name);
      }
      for (const f of extraFramesAll) {
        if (f.region && !regions.includes(f.region)) regions.push(f.region);
      }
      if (!regions.includes(exRegion)) exRegion = "全部";
      regionEl.innerHTML = regions
        .map((r) => {
          const on = r === exRegion ? " is-active" : "";
          return `<button type="button" class="acu-ex-region-btn${on}" data-acu-ex-region="${r}" role="tab" aria-selected="${r === exRegion}">${r}</button>`;
        })
        .join("");
      regionEl.querySelectorAll("[data-acu-ex-region]").forEach((btn) => {
        btn.addEventListener("click", () => {
          exRegion = btn.dataset.acuExRegion;
          segKey = "";
          renderExRegions();
          renderSegStrip();
          renderList();
        });
      });
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
            const title = f.alt || f.label;
            return `<button type="button" class="acu-seg-btn${on}" role="tab" data-acu-seg="${f.key}" title="${title}" aria-selected="${f.key === active.key}">${f.label}</button>`;
          })
          .join("");
        segStrip.querySelectorAll("[data-acu-seg]").forEach((btn) => {
          btn.addEventListener("click", () => {
            segKey = btn.dataset.acuSeg;
            const frame = frames.find((f) => f.key === segKey);
            if (scope === "EX" && frame?.pointId) {
              const ap = byPointId[frame.pointId];
              selectedId = frame.pointId;
              if (ap && ap.type !== "extra") {
                scope = ap.meridianAbbr || "BODY";
                renderMerNav();
                renderExRegions();
                updateChartTitle();
                const merFrames = currentChartFrames();
                segKey = guessSegmentKey(ap, merFrames);
                renderSegStrip();
                renderList();
                return;
              }
            }
            renderSegStrip();
            renderList();
          });
        });
      }
      setMainImage(active);
      if (chartSub) {
        chartSub.textContent =
          scope === "EX" && active.label
            ? `${active.label}${active.region ? ` · ${active.region}` : ""} · ${frames.length} 张`
            : `${active.label} · ${frames.length} 张`;
      }
      if (scope === "EX" && active.pointId) selectedId = active.pointId;
    }

    function renderMerNav() {
      if (!merNav) return;
      const items = [
        ...(charts.meridians || []).map((m) => ({
          id: m.abbr,
          label: MERIDIAN_SHORT[m.abbr] || m.abbr,
          sub: m.abbr,
          title: m.nameZh || labels[m.abbr] || m.abbr,
          color: MERIDIAN_COLORS[m.abbr] || "var(--accent)",
          icon: m.icon ? assetUrl(m.icon) : "",
        })),
        {
          id: "EX",
          label: MERIDIAN_SHORT.EX,
          sub: "EX",
          title: "经外奇穴",
          color: MERIDIAN_COLORS.EX,
          icon: charts.cateByAbbr?.EX ? assetUrl(charts.cateByAbbr.EX) : "",
        },
        {
          id: "BODY",
          label: MERIDIAN_SHORT.BODY,
          sub: "",
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
          const sub = it.sub ? `<span class="acu-mer-abbr mono">${it.sub}</span>` : "";
          return `<button type="button" class="acu-mer-btn${on}" data-acu-scope="${it.id}" title="${it.title}" style="--acu-mer-color:${it.color}">${icon}<span class="acu-mer-short">${it.label}</span>${sub}</button>`;
        })
        .join("");
      merNav.querySelectorAll("[data-acu-scope]").forEach((btn) => {
        btn.addEventListener("click", () => {
          scope = btn.dataset.acuScope;
          segKey = scope === "EX" ? "" : "overview";
          selectedId = "";
          if (scope !== "EX") exRegion = "全部";
          renderMerNav();
          renderExRegions();
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

    function inScope(ap) {
      if (scope === "BODY") return true;
      if (scope === "EX") {
        if (ap.type !== "extra") return false;
        if (exRegion === "全部") return true;
        return (ap.region || "") === exRegion;
      }
      if (ap.type === "extra") return false;
      return (ap.meridianAbbr || "") === scope;
    }

    function filtered() {
      if (query) {
        return acupoints.filter((ap) => matchesQuery(ap, query));
      }
      return acupoints.filter((ap) => inScope(ap));
    }

    function applyPointSelection(ap, { switchScope = true, switchSeg = true } = {}) {
      if (!ap) return;
      selectedId = ap.id;
      if (switchScope) {
        const next = scopeForPoint(ap);
        if (next !== scope) {
          scope = next;
          if (scope === "EX" && ap.type === "extra" && ap.region) {
            exRegion = "全部";
          }
          renderMerNav();
          renderExRegions();
          updateChartTitle();
        }
      }
      if (switchSeg) {
        if (scope === "EX" || ap.type === "extra") {
          const key = pointToExKey.get(ap.id);
          if (key) {
            const frame = extraFramesAll.find((f) => f.key === key);
            if (frame?.region) exRegion = "全部";
            segKey = key;
          }
        } else if (scope !== "BODY") {
          const frames = currentChartFrames();
          segKey = guessSegmentKey(ap, frames);
        }
        renderExRegions();
        renderSegStrip();
      }
    }

    function renderList() {
      const rows = filtered();
      if (countEl) countEl.textContent = `${rows.length} 条`;
      if (listTitle) {
        listTitle.textContent = query
          ? "搜索结果"
          : scope === "EX"
            ? "奇穴列表"
            : scope === "BODY"
              ? "全部穴位"
              : "本经穴位";
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
          const merLabel =
            ap.type === "extra"
              ? ap.region || "奇"
              : MERIDIAN_SHORT[abbr] || abbr;
          return `<button type="button" class="acu-row${active}" data-acu-id="${ap.id}" style="--acu-mer-color:${color}">
            <span class="acu-row-code mono">${highlight(ap.code, query)}</span>
            <span class="acu-row-name">${highlight(ap.nameZh, query)}</span>
            <span class="acu-row-mer">${merLabel}</span>
          </button>`;
        })
        .join("");

      listEl.querySelectorAll("[data-acu-id]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const ap = byPointId[btn.dataset.acuId];
          applyPointSelection(ap, { switchScope: true, switchSeg: true });
          renderList();
        });
      });

      renderDetail(byPointId[selectedId] || null, meridianByKey, query);
    }

    search?.addEventListener("input", () => {
      query = search.value.trim();
      if (query) {
        const hits = acupoints.filter((ap) => matchesQuery(ap, query));
        const best = pickBestHit(hits, query);
        const nq = norm(query);
        const confident =
          best &&
          (hits.length === 1 ||
            norm(best.nameZh) === nq ||
            norm(best.code) === nq ||
            (nq.length >= 2 && norm(best.nameZh).startsWith(nq)));
        if (confident) {
          applyPointSelection(best, { switchScope: true, switchSeg: true });
        } else if (best) {
          const local = hits.filter((ap) => inScope(ap));
          if (!local.length) {
            applyPointSelection(best, { switchScope: true, switchSeg: true });
          } else {
            selectedId = local[0].id;
          }
        }
      }
      renderList();
    });

    renderMerNav();
    renderExRegions();
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
