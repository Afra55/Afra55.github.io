(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const FAV_KEY = "devtools-ambient-favorites-v1";
  const RECENT_KEY = "devtools-ambient-recent-v1";
  const STATE_KEY = "devtools-ambient-state-v1";

  let root = null;
  let catalog = null;
  let itemsById = new Map();
  let favorites = new Set();
  let recentIds = [];
  let collapsedCats = new Set();
  let filterMode = "all";
  let searchQuery = "";
  let currentId = null;
  let audio = null;
  let paused = false;
  let inited = false;
  let sleepTimer = 0;
  let sleepEndsAt = 0;

  let gridEl = null;
  let searchEl = null;
  let playerEl = null;
  let filterBtns = [];
  let sleepSelect = null;
  let zhVoice = null;
  let enVoice = null;
  let speechPrimed = false;

  function cacheBust(url) {
    if (!url) return url;
    const v = window.TOOLS_BUILD || "";
    if (!v || url.includes("?")) return url;
    return `${url}?v=${encodeURIComponent(v)}`;
  }

  function loadJson(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify([...favorites]));
    } catch (_) {}
  }

  function saveRecent() {
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recentIds.slice(0, 24)));
    } catch (_) {}
  }

  function loadState() {
    const data = loadJson(STATE_KEY, {});
    if (Array.isArray(data.collapsedCats)) collapsedCats = new Set(data.collapsedCats);
    sleepEndsAt = Number(data.sleepEndsAt) || 0;
  }

  function saveState() {
    try {
      localStorage.setItem(
        STATE_KEY,
        JSON.stringify({
          collapsedCats: [...collapsedCats],
          sleepEndsAt,
          lastId: currentId,
        })
      );
    } catch (_) {}
  }

  function ensureIconify() {
    if (window.Iconify || window.iconify) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@iconify/iconify@3.1.1/dist/iconify.min.js";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("iconify"));
      document.head.appendChild(s);
    });
  }

  function iconHtml(iconId, cls = "") {
    return `<span class="iconify ambient-ic ${cls}" data-icon="${iconId}" aria-hidden="true"></span>`;
  }

  function loadSpeechVoices() {
    if (!window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices();
    zhVoice =
      voices.find((v) => /^zh-(CN|Hans)/i.test(v.lang)) ||
      voices.find((v) => /^zh/i.test(v.lang)) ||
      null;
    enVoice =
      voices.find((v) => /^en(-US|$)/i.test(v.lang)) ||
      voices.find((v) => /^en/i.test(v.lang)) ||
      null;
  }

  function primeSpeech() {
    if (!window.speechSynthesis || speechPrimed) return;
    speechPrimed = true;
    loadSpeechVoices();
    try {
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    } catch (_) {}
    try {
      const u = new SpeechSynthesisUtterance(" ");
      u.volume = 0.01;
      u.rate = 2;
      window.speechSynthesis.speak(u);
      window.speechSynthesis.cancel();
    } catch (_) {}
  }

  function itemIcon(item) {
    return item.icon || item.categoryIcon || "mdi:music-note";
  }

  function speakItemNames(item) {
    if (!item || !window.speechSynthesis) return;
    primeSpeech();
    const synth = window.speechSynthesis;
    try {
      synth.cancel();
    } catch (_) {}
    const parts = [];
    if (item.nameZh) {
      const u = new SpeechSynthesisUtterance(item.nameZh);
      u.lang = "zh-CN";
      if (zhVoice) u.voice = zhVoice;
      u.rate = 0.95;
      u.volume = 1;
      parts.push(u);
    }
    if (item.nameEn) {
      const u = new SpeechSynthesisUtterance(item.nameEn);
      u.lang = "en-US";
      if (enVoice) u.voice = enVoice;
      u.rate = 0.95;
      u.volume = 1;
      parts.push(u);
    }
    parts.forEach((u, i) => {
      if (i < parts.length - 1) u.onend = () => synth.speak(parts[i + 1]);
    });
    if (parts.length) synth.speak(parts[0]);
  }

  function speakLabelEl(el) {
    const item = itemsById.get(el.dataset.speakId);
    if (!item) return;
    speakItemNames(item);
  }

  function bumpRecent(id) {
    recentIds = [id, ...recentIds.filter((x) => x !== id)].slice(0, 24);
    saveRecent();
  }

  function toggleFavorite(id) {
    if (favorites.has(id)) favorites.delete(id);
    else favorites.add(id);
    saveFavorites();
    if (filterMode === "fav") render();
    else updateCardPlayingState();
    updatePlayer();
  }

  function stopAudio() {
    if (!audio) return;
    try {
      audio.pause();
      audio.currentTime = 0;
    } catch (_) {}
    audio = null;
    paused = false;
  }

  function unlockAudio() {
    if (!audio) return;
    const p = audio.play();
    if (p && typeof p.catch === "function") p.catch(() => {});
  }

  function playItem(id) {
    const item = itemsById.get(id);
    if (!item) return;
    if (currentId === id && audio && !paused) {
      audio.pause();
      paused = true;
      updateCardPlayingState();
      updatePlayer();
      return;
    }
    if (currentId === id && audio && paused) {
      unlockAudio();
      paused = false;
      updateCardPlayingState();
      updatePlayer();
      return;
    }
    stopAudio();
    currentId = id;
    paused = false;
    audio = new Audio(cacheBust(item.audio));
    audio.loop = true;
    audio.volume = 0.85;
    audio.addEventListener("ended", () => {}, { once: true });
    unlockAudio();
    bumpRecent(id);
    saveState();
    updateCardPlayingState();
    updatePlayer();
  }

  function clearSleepTimer() {
    sleepEndsAt = 0;
    if (sleepTimer) {
      clearInterval(sleepTimer);
      sleepTimer = 0;
    }
    saveState();
    updatePlayer();
  }

  function setSleepMinutes(min) {
    clearSleepTimer();
    const m = Number(min);
    if (!Number.isFinite(m) || m <= 0) return;
    sleepEndsAt = Date.now() + m * 60 * 1000;
    saveState();
    sleepTimer = window.setInterval(() => {
      if (Date.now() >= sleepEndsAt) {
        stopAudio();
        currentId = null;
        clearSleepTimer();
        updateCardPlayingState();
        updatePlayer();
      } else {
        updatePlayer();
      }
    }, 1000);
    updatePlayer();
  }

  function matchItem(item) {
    if (filterMode === "fav" && !favorites.has(item.id)) return false;
    if (filterMode === "recent" && !recentIds.includes(item.id)) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const hay = [item.nameZh, item.nameEn, item.categoryZh, item.category, ...(item.tags || [])]
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  }

  function downloadItem(item) {
    const a = document.createElement("a");
    a.href = cacheBust(item.audio);
    a.download = `${item.id}${item.audio.match(/\.(mp3|wav)$/i)?.[0] || ".mp3"}`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  function renderCard(item) {
    const active = currentId === item.id && audio && !paused;
    const isPaused = currentId === item.id && paused;
    const fav = favorites.has(item.id);
    const ic = itemIcon(item);
    const img = item.image
      ? `<img class="ambient-card-img" src="${cacheBust(item.image)}" alt="" loading="lazy" draggable="false" data-fallback-icon="${escapeHtml(ic)}" />`
      : `<div class="ambient-card-img ambient-card-img-fallback">${iconHtml(ic, "ambient-card-fallback-ic")}</div>`;
    return `<button type="button" class="ambient-card${active ? " is-playing" : ""}${isPaused ? " is-paused" : ""}" data-id="${item.id}" aria-pressed="${active}">
      ${img}
      <span class="ambient-card-body">
        <span class="ambient-card-names ambient-speak" data-speak-id="${item.id}" title="朗读中英文">
          <span class="ambient-card-zh">${escapeHtml(item.nameZh)}</span><span class="ambient-card-sep" aria-hidden="true"> · </span><span class="ambient-card-en">${escapeHtml(item.nameEn)}</span>
        </span>
      </span>
      <span class="ambient-card-fav${fav ? " is-on" : ""}" data-fav="${item.id}" title="收藏" aria-label="收藏">♥</span>
    </button>`;
  }

  function bindCardImageFallbacks() {
    if (!gridEl) return;
    $$(".ambient-card-img[src]", gridEl).forEach((img) => {
      if (img.dataset.fallbackBound === "1") return;
      img.dataset.fallbackBound = "1";
      img.addEventListener("error", () => {
        const ic = img.dataset.fallbackIcon || "mdi:music-note";
        const wrap = document.createElement("div");
        wrap.className = "ambient-card-img ambient-card-img-fallback";
        wrap.innerHTML = iconHtml(ic, "ambient-card-fallback-ic");
        img.replaceWith(wrap);
        if (window.Iconify?.scan) window.Iconify.scan(wrap);
        else if (window.iconify?.scan) window.iconify.scan(wrap);
      }, { once: true });
    });
  }

  function updateCardPlayingState() {
    if (!gridEl) return;
    $$(".ambient-card", gridEl).forEach((card) => {
      const id = card.dataset.id;
      const active = currentId === id && audio && !paused;
      const isPaused = currentId === id && paused;
      card.classList.toggle("is-playing", active);
      card.classList.toggle("is-paused", isPaused);
      card.setAttribute("aria-pressed", String(active));
    });
    $$(".ambient-card-fav", gridEl).forEach((fav) => {
      fav.classList.toggle("is-on", favorites.has(fav.dataset.fav));
    });
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function render() {
    if (!gridEl || !catalog) return;
    const sections = [];
    for (const cat of catalog.categories) {
      const catItems = catalog.items.filter((it) => it.category === cat.id && matchItem(it));
      if (!catItems.length) continue;
      const collapsed = collapsedCats.has(cat.id);
      sections.push(`<section class="ambient-cat${collapsed ? " is-collapsed" : ""}" data-cat="${cat.id}">
        <button type="button" class="ambient-cat-head" data-toggle-cat="${cat.id}">
          ${iconHtml(cat.icon, "ambient-cat-ic")}
          <span class="ambient-cat-title">${escapeHtml(cat.nameZh)} <span class="ambient-cat-en">${escapeHtml(cat.nameEn)}</span></span>
          <span class="ambient-cat-count mono">${catItems.length}</span>
          <span class="ambient-cat-chevron" aria-hidden="true">▾</span>
        </button>
        <div class="ambient-grid">${catItems.map(renderCard).join("")}</div>
      </section>`);
    }
    gridEl.innerHTML =
      sections.join("") ||
      `<p class="hint ambient-empty">没有匹配的环境音，试试换个关键词或切换筛选。</p>`;
    bindCardImageFallbacks();
    if (window.Iconify?.scan) window.Iconify.scan(gridEl);
    else if (window.iconify?.scan) window.iconify.scan(gridEl);
  }

  function updatePlayer() {
    if (!playerEl) return;
    const item = currentId ? itemsById.get(currentId) : null;
    const sleepLeft =
      sleepEndsAt > Date.now() ? Math.ceil((sleepEndsAt - Date.now()) / 60000) : 0;
    if (!item) {
      playerEl.hidden = true;
      return;
    }
    playerEl.hidden = false;
    const playing = audio && !paused;
    playerEl.innerHTML = `
      <div class="ambient-player-main">
        ${iconHtml(itemIcon(item), "ambient-player-ic")}
        <div class="ambient-player-text">
          <strong class="ambient-speak" data-speak-id="${item.id}" title="朗读中英文"><span class="ambient-card-zh">${escapeHtml(item.nameZh)}</span><span class="ambient-card-sep" aria-hidden="true"> · </span><span class="ambient-card-en">${escapeHtml(item.nameEn)}</span></strong>
          <span class="hint">${sleepLeft ? `${sleepLeft} 分钟后停止` : ""}</span>
        </div>
      </div>
      <div class="ambient-player-actions btn-row">
        <button type="button" class="ghost-btn" id="ambient-player-toggle">${playing ? "暂停" : "播放"}</button>
        <button type="button" class="ghost-btn" id="ambient-player-stop">停止</button>
        <button type="button" class="ghost-btn${favorites.has(item.id) ? " is-active" : ""}" id="ambient-player-fav">${favorites.has(item.id) ? "已收藏" : "收藏"}</button>
        <button type="button" class="ghost-btn" id="ambient-player-dl">下载</button>
      </div>`;
    $("#ambient-player-toggle", playerEl)?.addEventListener("click", () => playItem(item.id));
    $("#ambient-player-stop", playerEl)?.addEventListener("click", () => {
      stopAudio();
      currentId = null;
      updateCardPlayingState();
      updatePlayer();
    });
    $("#ambient-player-fav", playerEl)?.addEventListener("click", () => toggleFavorite(item.id));
    $("#ambient-player-dl", playerEl)?.addEventListener("click", () => downloadItem(item));
    if (window.Iconify?.scan) window.Iconify.scan(playerEl);
  }

  function bindAmbientEvents() {
    if (window.speechSynthesis) {
      window.speechSynthesis.addEventListener("voiceschanged", loadSpeechVoices);
      loadSpeechVoices();
    }
    root?.addEventListener("click", (e) => {
      const speakEl = e.target.closest("[data-speak-id]");
      if (speakEl) {
        e.stopPropagation();
        e.preventDefault();
        speakLabelEl(speakEl);
        return;
      }
      if (!gridEl?.contains(e.target)) return;
      const favBtn = e.target.closest("[data-fav]");
      if (favBtn) {
        e.stopPropagation();
        e.preventDefault();
        toggleFavorite(favBtn.dataset.fav);
        return;
      }
      const catBtn = e.target.closest("[data-toggle-cat]");
      if (catBtn) {
        const id = catBtn.dataset.toggleCat;
        if (collapsedCats.has(id)) collapsedCats.delete(id);
        else collapsedCats.add(id);
        saveState();
        render();
        return;
      }
      const card = e.target.closest(".ambient-card");
      if (card?.dataset.id) playItem(card.dataset.id);
    });
  }

  function bindFilters() {
    filterBtns.forEach((btn) => {
      btn.addEventListener("click", () => {
        filterMode = btn.dataset.filter || "all";
        filterBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
        render();
      });
    });
    searchEl?.addEventListener("input", () => {
      searchQuery = String(searchEl.value || "").trim();
      render();
    });
    sleepSelect?.addEventListener("change", () => {
      const v = sleepSelect.value;
      if (v === "0") clearSleepTimer();
      else setSleepMinutes(v);
    });
  }

  async function loadCatalog() {
    const v = window.TOOLS_BUILD || "";
    const res = await fetch(`./assets/ambient/catalog.json${v ? `?v=${encodeURIComponent(v)}` : ""}`);
    if (!res.ok) throw new Error("catalog");
    catalog = await res.json();
    itemsById = new Map(catalog.items.map((it) => [it.id, it]));
  }

  function isAmbientRoute() {
    const raw = String(location.hash || "")
      .replace(/^#/, "")
      .trim();
    return raw.split(/[/?]/)[0] === "ambient";
  }

  function onLeave() {
    stopAudio();
    currentId = null;
    if (window.speechSynthesis) {
      try {
        window.speechSynthesis.cancel();
      } catch (_) {}
    }
    updatePlayer();
  }

  async function ensureAmbient() {
    if (!isAmbientRoute()) return;
    if (inited) {
      render();
      updatePlayer();
      return;
    }
    root = $("#ambient");
    if (!root || root.dataset.bound) return;
    root.dataset.bound = "1";
    gridEl = $("#ambient-grid");
    searchEl = $("#ambient-search");
    playerEl = $("#ambient-player");
    sleepSelect = $("#ambient-sleep");
    filterBtns = $$(".ambient-filter-btn", root);

    favorites = new Set(loadJson(FAV_KEY, []));
    recentIds = loadJson(RECENT_KEY, []);
    loadState();

    try {
      await Promise.all([loadCatalog(), ensureIconify()]);
    } catch (_) {
      if (gridEl) gridEl.innerHTML = `<p class="hint ambient-empty">环境音目录加载失败，请强制刷新后重试。</p>`;
      return;
    }

    if (sleepEndsAt > Date.now()) {
      const leftMin = Math.ceil((sleepEndsAt - Date.now()) / 60000);
      setSleepMinutes(leftMin);
    }

    bindAmbientEvents();
    bindFilters();
    inited = true;
    render();
    updatePlayer();
  }

  function onRoute(ev) {
    const tool = ev?.detail?.tool || (isAmbientRoute() ? "ambient" : "");
    if (tool === "ambient") ensureAmbient();
    else if (inited) onLeave();
  }

  window.addEventListener("devtools:route", onRoute);
  if (isAmbientRoute()) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ensureAmbient, { once: true });
    else ensureAmbient();
  }
})();
