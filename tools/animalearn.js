(() => {
  "use strict";

  const TOOL_ID = "animalearn";
  const DATA_URL = "./data/animals-kids.json";
  const IMG_CACHE_KEY = "devtools-animalearn-img-v1";
  const POS_KEY = "devtools-animalearn-pos-v1";

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  let root = null;
  let catalog = null;
  let groupId = "all";
  let tab = "cards";
  let cardIndex = 0;
  let imgCache = {};
  let lookAnswer = null;
  let listenAnswer = null;
  let lookLocked = false;
  let listenLocked = false;
  let zhVoice = null;
  let enVoice = null;
  let bootPromise = null;

  function showError(msg) {
    const el = root && $("#ae-error", root);
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = String(msg);
  }

  function loadImgCache() {
    try {
      imgCache = JSON.parse(sessionStorage.getItem(IMG_CACHE_KEY) || "{}") || {};
    } catch (_) {
      imgCache = {};
    }
  }

  function saveImgCache() {
    try {
      sessionStorage.setItem(IMG_CACHE_KEY, JSON.stringify(imgCache));
    } catch (_) {}
  }

  function loadPosition() {
    try {
      const raw = JSON.parse(localStorage.getItem(POS_KEY) || "null");
      if (!raw || typeof raw !== "object") return;
      if (typeof raw.groupId === "string") groupId = raw.groupId;
      if (typeof raw.tab === "string") tab = raw.tab;
      if (Number.isFinite(Number(raw.cardIndex))) {
        cardIndex = Math.max(0, Number(raw.cardIndex) | 0);
      }
    } catch (_) {}
  }

  function savePosition() {
    try {
      localStorage.setItem(
        POS_KEY,
        JSON.stringify({ groupId, tab, cardIndex, at: Date.now() })
      );
    } catch (_) {}
  }

  function commonsUrl(file) {
    if (!file) return "";
    return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}?width=900`;
  }

  function filteredAnimals() {
    const list = catalog?.animals || [];
    if (!groupId || groupId === "all") return list.slice();
    return list.filter((a) => a.group === groupId);
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i];
      a[i] = a[j];
      a[j] = t;
    }
    return a;
  }

  function pickChoices(correct, n = 3) {
    const pool = filteredAnimals().filter((a) => a.id !== correct.id);
    const others = shuffle(pool).slice(0, Math.max(0, n - 1));
    const all = catalog?.animals || [];
    while (others.length < n - 1) {
      const extra = all.find((a) => a.id !== correct.id && !others.some((o) => o.id === a.id));
      if (!extra) break;
      others.push(extra);
    }
    return shuffle([correct, ...others]).slice(0, n);
  }

  function primeVoices() {
    const voices = window.speechSynthesis?.getVoices?.() || [];
    zhVoice =
      voices.find((v) => /zh[-_]?CN/i.test(v.lang)) ||
      voices.find((v) => /^zh/i.test(v.lang)) ||
      null;
    enVoice =
      voices.find((v) => /en[-_]?US/i.test(v.lang)) ||
      voices.find((v) => /^en/i.test(v.lang)) ||
      null;
  }

  function speakPair(animal) {
    if (!window.speechSynthesis || !animal) return;
    window.speechSynthesis.cancel();
    primeVoices();
    const zh = new SpeechSynthesisUtterance(animal.nameZh);
    zh.lang = "zh-CN";
    if (zhVoice) zh.voice = zhVoice;
    zh.rate = 0.92;
    const en = new SpeechSynthesisUtterance(animal.nameEn);
    en.lang = "en-US";
    if (enVoice) en.voice = enVoice;
    en.rate = 0.95;
    zh.onend = () => {
      window.setTimeout(() => window.speechSynthesis.speak(en), 160);
    };
    window.speechSynthesis.speak(zh);
  }

  function probeImage(url) {
    return new Promise((resolve) => {
      const img = new Image();
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        resolve(ok);
      };
      img.onload = () => finish(true);
      img.onerror = () => finish(false);
      window.setTimeout(() => finish(false), 8000);
      img.referrerPolicy = "no-referrer";
      img.src = url;
    });
  }

  async function resolveImage(animal) {
    if (!animal) return { url: "", credit: "" };
    if (imgCache[animal.id]?.url) return imgCache[animal.id];

    if (animal.commons) {
      const url = commonsUrl(animal.commons);
      if (await probeImage(url)) {
        const hit = { url, credit: `Wikimedia Commons · ${animal.commons}` };
        imgCache[animal.id] = hit;
        saveImgCache();
        return hit;
      }
    }

    try {
      const q = encodeURIComponent(animal.query || animal.nameEn || animal.id);
      const api = `https://api.openverse.org/v1/images/?q=${q}&license=cc0,by,by-sa&page_size=5`;
      const res = await fetch(api, { headers: { Accept: "application/json" } });
      if (res.ok) {
        const data = await res.json();
        for (const item of data.results || []) {
          const url = item.url || item.thumbnail || "";
          if (!url || !(await probeImage(url))) continue;
          const hit = {
            url,
            credit: [item.license, item.creator, "Openverse"].filter(Boolean).join(" · "),
          };
          imgCache[animal.id] = hit;
          saveImgCache();
          return hit;
        }
      }
    } catch (_) {
      /* ignore */
    }
    return { url: "", credit: "" };
  }

  function setLoadingPlaceholder(mediaEl, animal, loading) {
    if (!mediaEl) return;
    mediaEl.classList.toggle("is-loading", Boolean(loading));
    let ph = mediaEl.querySelector(".animalearn-placeholder");
    if (!loading) {
      if (ph) ph.remove();
      return;
    }
    if (!ph) {
      ph = document.createElement("div");
      ph.className = "animalearn-placeholder";
      ph.setAttribute("aria-hidden", "true");
      mediaEl.appendChild(ph);
    }
    const emoji = animal?.emoji || "🐾";
    const label = [animal?.nameZh, animal?.nameEn].filter(Boolean).join(" / ");
    ph.innerHTML = `<span class="animalearn-placeholder-emoji">${emoji}</span>${
      label ? `<span class="animalearn-placeholder-text">${label}</span>` : ""
    }`;
  }

  async function paintMedia(mediaEl, emojiEl, imgEl, animal) {
    if (!animal) return null;
    setLoadingPlaceholder(mediaEl, animal, true);
    if (emojiEl) {
      emojiEl.hidden = true;
      emojiEl.textContent = animal.emoji || "🐾";
    }
    if (imgEl) {
      imgEl.hidden = true;
      imgEl.removeAttribute("src");
      imgEl.alt = `${animal.nameZh} / ${animal.nameEn}`;
      imgEl.dataset.expectId = animal.id;
      // 兜底：强制框内完整显示（禁止裁切下半截 / 撑破屏幕）
      imgEl.style.maxWidth = "100%";
      imgEl.style.maxHeight = "100%";
      imgEl.style.width = "100%";
      imgEl.style.height = "100%";
      imgEl.style.setProperty("object-fit", "contain", "important");
      imgEl.style.objectPosition = "center center";
      imgEl.style.position = "absolute";
      imgEl.style.inset = "0";
      imgEl.style.margin = "0";
    }
    const hit = await resolveImage(animal);
    if (!imgEl || !hit.url) {
      if (emojiEl) emojiEl.hidden = false;
      setLoadingPlaceholder(mediaEl, animal, false);
      mediaEl?.classList.add("is-fallback");
      return hit;
    }
    if (imgEl.dataset.expectId !== animal.id) return hit;
    imgEl.referrerPolicy = "no-referrer";
    imgEl.src = hit.url;
    imgEl.hidden = false;
    if (emojiEl) emojiEl.hidden = true;
    setLoadingPlaceholder(mediaEl, animal, false);
    mediaEl?.classList.remove("is-fallback");
    return hit;
  }

  function currentGroupLabel() {
    const g = (catalog?.groups || []).find((x) => x.id === groupId);
    if (!g) return "分类 · 全部";
    return `分类 · ${g.nameZh}`;
  }

  function updateCatLabel() {
    const el = root && $("#ae-cat-label", root);
    if (el) el.textContent = currentGroupLabel();
  }

  function openCatSheet() {
    const sheet = root && $("#ae-cat-sheet", root);
    const openBtn = root && $("#ae-cat-open", root);
    if (!sheet) return;
    sheet.hidden = false;
    openBtn?.setAttribute("aria-expanded", "true");
    document.body.classList.add("animalearn-sheet-open");
    window.setTimeout(() => $("#ae-cat-close", root)?.focus?.(), 30);
  }

  function closeCatSheet() {
    const sheet = root && $("#ae-cat-sheet", root);
    const openBtn = root && $("#ae-cat-open", root);
    if (!sheet) return;
    sheet.hidden = true;
    openBtn?.setAttribute("aria-expanded", "false");
    document.body.classList.remove("animalearn-sheet-open");
  }

  function renderFilters() {
    const host = $("#ae-filters", root);
    if (!host || !catalog) return;
    host.innerHTML = (catalog.groups || [])
      .map((g) => {
        const on = g.id === groupId ? " is-active" : "";
        return `<button type="button" class="ghost-btn animalearn-filter-btn${on}" data-group="${g.id}">
          <span>${g.nameZh}<span class="hint tight"> · ${g.nameEn}</span></span>
          <span class="animalearn-filter-check" aria-hidden="true">✓</span>
        </button>`;
      })
      .join("");
    updateCatLabel();
  }

  function normalizeCardIndex(list) {
    if (!list.length) {
      cardIndex = 0;
      return;
    }
    cardIndex = ((cardIndex % list.length) + list.length) % list.length;
  }

  async function renderCard() {
    const list = filteredAnimals();
    if (!list.length) {
      showError("当前分类没有动物");
      return;
    }
    showError("");
    normalizeCardIndex(list);
    const animal = list[cardIndex];
    const zh = $("#ae-card-zh", root);
    const en = $("#ae-card-en", root);
    const meta = $("#ae-card-meta", root);
    if (zh) zh.textContent = animal.nameZh;
    if (en) en.textContent = animal.nameEn;
    if (meta) meta.textContent = `${cardIndex + 1} / ${list.length}`;
    // 重播名字淡入
    const names = $(".animalearn-names", root);
    if (names) {
      names.classList.remove("is-pop");
      void names.offsetWidth;
      names.classList.add("is-pop");
    }
    await paintMedia(
      $("#ae-card-media", root),
      $("#ae-card-emoji", root),
      $("#ae-card-img", root),
      animal
    );
    savePosition();
  }

  function stepCard(delta) {
    const list = filteredAnimals();
    if (!list.length) return;
    cardIndex = (cardIndex + delta + list.length) % list.length;
    renderCard();
  }

  function randomCard() {
    const list = filteredAnimals();
    if (!list.length) return;
    if (list.length === 1) {
      renderCard();
      return;
    }
    let next = cardIndex;
    while (next === cardIndex) next = Math.floor(Math.random() * list.length);
    cardIndex = next;
    renderCard();
  }

  function speakCurrentCard() {
    const animal = filteredAnimals()[cardIndex];
    if (animal) speakPair(animal);
  }

  function setTab(next) {
    tab = next || "cards";
    $$(".animalearn-tab", root).forEach((btn) => {
      const on = btn.dataset.tab === tab;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
      btn.classList.toggle("secondary-btn", on);
      btn.classList.toggle("ghost-btn", !on);
    });
    $$(".animalearn-pane", root).forEach((pane) => {
      pane.hidden = pane.dataset.pane !== tab;
    });
    savePosition();
    if (tab === "cards") renderCard();
    else if (tab === "quiz-look") nextLookQuiz();
    else if (tab === "quiz-listen") nextListenQuiz();
  }

  async function nextLookQuiz() {
    lookLocked = false;
    const pool = filteredAnimals();
    if (pool.length < 2) {
      showError("当前分类太少，请选「全部」再玩看图");
      return;
    }
    showError("");
    lookAnswer = pool[Math.floor(Math.random() * pool.length)];
    const choices = pickChoices(lookAnswer, 3);
    await paintMedia(
      $("#ae-look-media", root),
      $("#ae-look-emoji", root),
      $("#ae-look-img", root),
      lookAnswer
    );
    const fb = $("#ae-look-feedback", root);
    if (fb) {
      fb.textContent = "";
      fb.className = "animalearn-feedback";
    }
    const host = $("#ae-look-choices", root);
    if (!host) return;
    host.innerHTML = choices
      .map(
        (a) => `<button type="button" class="animalearn-choice" data-id="${a.id}">
        <span class="animalearn-choice-zh">${a.nameZh}</span>
        <span class="animalearn-choice-en">${a.nameEn}</span>
      </button>`
      )
      .join("");
  }

  async function nextListenQuiz() {
    listenLocked = false;
    const pool = filteredAnimals();
    if (pool.length < 3) {
      showError("听名选图需要至少 3 种，请选「全部」");
      return;
    }
    showError("");
    listenAnswer = pool[Math.floor(Math.random() * pool.length)];
    const choices = pickChoices(listenAnswer, 3);
    const fb = $("#ae-listen-feedback", root);
    if (fb) {
      fb.textContent = "";
      fb.className = "animalearn-feedback";
    }
    const host = $("#ae-listen-choices", root);
    if (!host) return;
    host.innerHTML = choices
      .map(
        (a) => `<button type="button" class="animalearn-img-choice is-loading" data-id="${a.id}" aria-label="${a.nameZh} ${a.nameEn}">
        <span class="animalearn-emoji" hidden>${a.emoji || "🐾"}</span>
        <img alt="" hidden />
      </button>`
      )
      .join("");
    // 先塞居中占位
    choices.forEach((a) => {
      const btn = host.querySelector(`[data-id="${a.id}"]`);
      setLoadingPlaceholder(btn, a, true);
    });
    await Promise.all(
      choices.map(async (a) => {
        const btn = host.querySelector(`[data-id="${a.id}"]`);
        if (!btn) return;
        await paintMedia(btn, btn.querySelector(".animalearn-emoji"), btn.querySelector("img"), a);
        btn.classList.remove("is-loading");
      })
    );
    speakPair(listenAnswer);
  }

  function onLookChoice(id) {
    if (lookLocked || !lookAnswer) return;
    lookLocked = true;
    const host = $("#ae-look-choices", root);
    $$(".animalearn-choice", host).forEach((btn) => {
      const bid = btn.getAttribute("data-id");
      if (bid === lookAnswer.id) btn.classList.add("is-correct");
      if (bid === id && id !== lookAnswer.id) btn.classList.add("is-wrong");
    });
    const ok = id === lookAnswer.id;
    const fb = $("#ae-look-feedback", root);
    if (fb) {
      fb.className = `animalearn-feedback ${ok ? "is-ok" : "is-bad"}`;
      fb.textContent = ok
        ? `对啦！${lookAnswer.nameZh} / ${lookAnswer.nameEn}`
        : `是 ${lookAnswer.nameZh} / ${lookAnswer.nameEn}`;
    }
    speakPair(lookAnswer);
  }

  function onListenChoice(id) {
    if (listenLocked || !listenAnswer) return;
    listenLocked = true;
    const host = $("#ae-listen-choices", root);
    $$(".animalearn-img-choice", host).forEach((btn) => {
      const bid = btn.getAttribute("data-id");
      if (bid === listenAnswer.id) btn.classList.add("is-correct");
      if (bid === id && id !== listenAnswer.id) btn.classList.add("is-wrong");
    });
    const ok = id === listenAnswer.id;
    const fb = $("#ae-listen-feedback", root);
    if (fb) {
      fb.className = `animalearn-feedback ${ok ? "is-ok" : "is-bad"}`;
      fb.textContent = ok
        ? `找对了！${listenAnswer.nameZh} / ${listenAnswer.nameEn}`
        : `正确答案：${listenAnswer.nameZh} / ${listenAnswer.nameEn}`;
    }
    speakPair(listenAnswer);
  }

  function bind() {
    root = document.getElementById(TOOL_ID);
    if (!root || root.dataset.bound === "1") return;
    root.dataset.bound = "1";

    root.addEventListener("click", (ev) => {
      const t = ev.target;
      const tabBtn = t.closest?.(".animalearn-tab");
      if (tabBtn) {
        setTab(tabBtn.dataset.tab || "cards");
        return;
      }
      const filterBtn = t.closest?.(".animalearn-filter-btn");
      if (filterBtn) {
        groupId = filterBtn.getAttribute("data-group") || "all";
        cardIndex = 0;
        renderFilters();
        closeCatSheet();
        savePosition();
        if (tab === "cards") renderCard();
        else if (tab === "quiz-look") nextLookQuiz();
        else nextListenQuiz();
        return;
      }
      const lookBtn = t.closest?.("#ae-look-choices .animalearn-choice");
      if (lookBtn) {
        onLookChoice(lookBtn.getAttribute("data-id"));
        return;
      }
      const listenBtn = t.closest?.("#ae-listen-choices .animalearn-img-choice");
      if (listenBtn) {
        onListenChoice(listenBtn.getAttribute("data-id"));
        return;
      }
      if (t.closest?.("#ae-card-media, #ae-card-zh, #ae-card-en")) {
        speakCurrentCard();
      }
    });

    $("#ae-prev", root)?.addEventListener("click", () => stepCard(-1));
    $("#ae-next", root)?.addEventListener("click", () => stepCard(1));
    $("#ae-random", root)?.addEventListener("click", () => randomCard());
    $("#ae-speak", root)?.addEventListener("click", () => speakCurrentCard());
    $("#ae-look-next", root)?.addEventListener("click", () => nextLookQuiz());
    $("#ae-listen-next", root)?.addEventListener("click", () => nextListenQuiz());
    $("#ae-listen-replay", root)?.addEventListener("click", () => {
      if (listenAnswer) speakPair(listenAnswer);
    });

    $("#ae-cat-open", root)?.addEventListener("click", () => openCatSheet());
    $("#ae-cat-close", root)?.addEventListener("click", () => closeCatSheet());
    $("#ae-cat-backdrop", root)?.addEventListener("click", () => closeCatSheet());

    $("#ae-card-media", root)?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        speakCurrentCard();
      }
    });

    document.addEventListener("keydown", (ev) => {
      if (ev.key !== "Escape") return;
      const sheet = root && $("#ae-cat-sheet", root);
      if (sheet && !sheet.hidden) closeCatSheet();
    });

    if (window.speechSynthesis) {
      window.speechSynthesis.addEventListener("voiceschanged", primeVoices);
      primeVoices();
    }

    window.addEventListener("pagehide", savePosition);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") savePosition();
    });
  }

  async function boot() {
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      bind();
      root = document.getElementById(TOOL_ID);
      if (!root) return;
      loadImgCache();
      loadPosition();
      if (!catalog) {
        const v = window.TOOLS_BUILD || "";
        const res = await fetch(`${DATA_URL}${v ? `?v=${encodeURIComponent(v)}` : ""}`);
        if (!res.ok) throw new Error(`加载动物数据失败（${res.status}）`);
        catalog = await res.json();
      }
      const groups = catalog.groups || [];
      if (groupId !== "all" && !groups.some((g) => g.id === groupId)) groupId = "all";
      if (!["cards", "quiz-look", "quiz-listen"].includes(tab)) tab = "cards";
      renderFilters();
      setTab(tab || "cards");
    })().finally(() => {
      bootPromise = null;
    });
    return bootPromise;
  }

  const start = () => {
    boot().catch((err) => showError(err.message || String(err)));
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();

  window.addEventListener("devtools:route", () => {
    const head = location.hash.replace(/^#/, "").split(/[/?]/)[0];
    if (head === TOOL_ID) start();
    else savePosition();
  });
})();
