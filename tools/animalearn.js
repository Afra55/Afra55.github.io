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
  let speakGen = 0;
  let bootPromise = null;
  let kidsImgReady = null;

  function ensureKidsImg() {
    if (window.DevToolsKidsImg) return Promise.resolve(window.DevToolsKidsImg);
    if (kidsImgReady) return kidsImgReady;
    kidsImgReady = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      const v = encodeURIComponent(window.TOOLS_BUILD || window.TOOLS_VERSION || "");
      s.src = `./lib/kids-img-cache.js${v ? `?v=${v}` : ""}`;
      s.async = true;
      s.onload = () => resolve(window.DevToolsKidsImg);
      s.onerror = () => reject(new Error("kids-img-cache 加载失败"));
      document.head.appendChild(s);
    }).catch((err) => {
      kidsImgReady = null;
      throw err;
    });
    return kidsImgReady;
  }

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
    if (window.DevToolsKidsImg?.commonsUrl) return window.DevToolsKidsImg.commonsUrl(file);
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

  function speakPair(animal, opts = {}) {
    if (!window.speechSynthesis || !animal) return;
    window.speechSynthesis.cancel();
    const gen = ++speakGen;
    const onDone = typeof opts.onDone === "function" ? opts.onDone : null;
    primeVoices();
    const zh = new SpeechSynthesisUtterance(animal.nameZh);
    zh.lang = "zh-CN";
    if (zhVoice) zh.voice = zhVoice;
    zh.rate = 0.92;
    const en = new SpeechSynthesisUtterance(animal.nameEn);
    en.lang = "en-US";
    if (enVoice) en.voice = enVoice;
    en.rate = 0.95;
    const finish = () => {
      if (gen !== speakGen) return;
      onDone?.();
    };
    en.onend = finish;
    en.onerror = finish;
    zh.onend = () => {
      if (gen !== speakGen) return;
      window.setTimeout(() => {
        if (gen !== speakGen) return;
        window.speechSynthesis.speak(en);
      }, 160);
    };
    zh.onerror = finish;
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

  async function resolveImage(animal, onProgress, onPreview) {
    if (!animal) return { url: "", credit: "" };
    // 会话级元数据命中（可能是 blob: 或热链）
    if (imgCache[animal.id]?.url && !String(imgCache[animal.id].url).startsWith("blob:")) {
      onProgress?.({ percent: 100 });
      onPreview?.({ url: imgCache[animal.id].url });
      return imgCache[animal.id];
    }
    try {
      await ensureKidsImg();
      const hit = await window.DevToolsKidsImg.resolveItemImage(
        {
          id: animal.id,
          commons: animal.commons,
          query: animal.query || animal.nameEn || animal.id,
          nameEn: animal.nameEn,
        },
        {
          namespace: "animalearn",
          onProgress,
          onPreview,
        }
      );
      if (hit?.url) {
        const row = { url: hit.url, credit: hit.credit || "" };
        imgCache[animal.id] = row;
        // 只把可持久的热链/来源记进 session；blob 不写，下次走 Cache API
        if (!String(hit.url).startsWith("blob:")) saveImgCache();
        return row;
      }
    } catch (_) {
      /* fall through legacy */
    }

    // 旧路径兜底
    if (animal.commons) {
      const url = commonsUrl(animal.commons);
      if (await probeImage(url)) {
        const hit = { url, credit: `Wikimedia Commons · ${animal.commons}` };
        imgCache[animal.id] = hit;
        saveImgCache();
        onPreview?.({ url });
        onProgress?.({ percent: 100 });
        return hit;
      }
    }
    return { url: "", credit: "" };
  }

  function waitImgReady(imgEl) {
    if (!imgEl) return Promise.resolve();
    if (typeof imgEl.decode === "function") {
      return imgEl.decode().catch(() => {});
    }
    return new Promise((resolve) => {
      if (imgEl.complete) {
        resolve();
        return;
      }
      const done = () => {
        imgEl.removeEventListener("load", done);
        imgEl.removeEventListener("error", done);
        resolve();
      };
      imgEl.addEventListener("load", done);
      imgEl.addEventListener("error", done);
    });
  }

  const MIN_LOAD_MS = 650;

  function cancelLoadClear(mediaEl) {
    const t = mediaEl && mediaEl._aeLoadClear;
    if (t) {
      window.clearTimeout(t);
      mediaEl._aeLoadClear = 0;
    }
  }

  function setLoadingPlaceholder(mediaEl, animal, loading, opts = {}) {
    if (!mediaEl) return;
    const optGen = opts.paintGen != null ? String(opts.paintGen) : null;
    if (optGen != null && (mediaEl.dataset.paintGen || "") !== optGen) return;
    cancelLoadClear(mediaEl);
    if (loading) mediaEl.classList.add("is-loading");
    else if (optGen == null || (mediaEl.dataset.paintGen || "") === optGen) {
      mediaEl.classList.remove("is-loading");
    }
    let ph = mediaEl.querySelector(".animalearn-placeholder");
    if (!loading) {
      const shownAt = Number(mediaEl.dataset.loadShownAt || 0);
      const wait = shownAt ? Math.max(0, MIN_LOAD_MS - (Date.now() - shownAt)) : 0;
      const expectedGen = optGen != null ? optGen : mediaEl.dataset.paintGen || "";
      const clear = () => {
        if ((mediaEl.dataset.paintGen || "") !== expectedGen) return;
        mediaEl.querySelector(".animalearn-placeholder")?.remove();
        delete mediaEl.dataset.loadShownAt;
        mediaEl._aeLoadClear = 0;
      };
      if (wait > 0) mediaEl._aeLoadClear = window.setTimeout(clear, wait);
      else clear();
      return;
    }
    if (!ph) {
      ph = document.createElement("div");
      ph.className = "animalearn-placeholder";
      ph.setAttribute("aria-hidden", "true");
      mediaEl.appendChild(ph);
      mediaEl.dataset.loadShownAt = String(Date.now());
    } else if (!mediaEl.dataset.loadShownAt) {
      mediaEl.dataset.loadShownAt = String(Date.now());
    }
    const emoji = animal?.emoji || "🐾";
    const hideName = Boolean(opts.hideName);
    const label = hideName ? "" : [animal?.nameZh, animal?.nameEn].filter(Boolean).join(" ");
    const pct = typeof opts.percent === "number" ? opts.percent : -1;
    const pctText =
      pct < 0 ? "加载中…" : pct >= 100 ? "即将完成…" : `加载 ${pct}%`;
    const bar =
      pct < 0
        ? `<span class="animalearn-load-bar animalearn-load-bar-indeterminate"></span>`
        : `<span class="animalearn-load-bar"><span class="animalearn-load-bar-fill" style="width:${Math.max(
            4,
            pct
          )}%"></span></span>`;
    ph.innerHTML = `<span class="animalearn-placeholder-emoji">${emoji}</span>${
      label ? `<span class="animalearn-placeholder-text">${label}</span>` : ""
    }<span class="animalearn-load-pct">${pctText}</span>${bar}`;
  }

  async function paintMedia(mediaEl, emojiEl, imgEl, animal, opts = {}) {
    if (!animal || !mediaEl) return null;
    const paintGen = String(Number(mediaEl.dataset.paintGen || 0) + 1);
    mediaEl.dataset.paintGen = paintGen;
    const hideName = Boolean(opts.hideName);
    setLoadingPlaceholder(mediaEl, animal, true, { hideName, percent: -1, paintGen });
    if (emojiEl) {
      emojiEl.hidden = false;
      emojiEl.textContent = animal.emoji || "🐾";
    }
    if (imgEl) {
      imgEl.hidden = true;
      imgEl.removeAttribute("src");
      imgEl.alt = hideName ? "动物图片" : `${animal.nameZh} ${animal.nameEn}`;
      imgEl.dataset.expectId = animal.id;
      imgEl.classList.remove("is-preview", "is-ready");
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

    const stillThis = () =>
      mediaEl.dataset.paintGen === paintGen && (!imgEl || imgEl.dataset.expectId === animal.id);

    const showPreview = (url) => {
      if (!imgEl || !url || !stillThis()) return;
      imgEl.referrerPolicy = "no-referrer";
      imgEl.classList.add("is-preview");
      imgEl.classList.remove("is-ready");
      imgEl.src = url;
      imgEl.hidden = false;
      if (emojiEl) emojiEl.hidden = true;
      mediaEl.classList.add("has-preview");
    };

    const hit = await resolveImage(
      animal,
      (p) => {
        if (!stillThis()) return;
        const percent = typeof p?.percent === "number" ? p.percent : -1;
        setLoadingPlaceholder(mediaEl, animal, true, { hideName, percent, paintGen });
      },
      (prev) => showPreview(prev?.url)
    );
    if (mediaEl.dataset.paintGen !== paintGen) return hit;
    if (!imgEl || !hit.url) {
      if (emojiEl) emojiEl.hidden = false;
      setLoadingPlaceholder(mediaEl, animal, false, { paintGen });
      mediaEl.classList.add("is-fallback");
      mediaEl.classList.remove("has-preview");
      return hit;
    }
    if (!stillThis()) return hit;
    imgEl.referrerPolicy = "no-referrer";
    if (imgEl.src !== hit.url) imgEl.src = hit.url;
    imgEl.hidden = false;
    if (emojiEl) emojiEl.hidden = true;
    await waitImgReady(imgEl);
    if (!stillThis()) return hit;
    imgEl.classList.remove("is-preview");
    imgEl.classList.add("is-ready");
    setLoadingPlaceholder(mediaEl, animal, false, { paintGen });
    mediaEl.classList.remove("is-fallback", "has-preview");
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

  function getCatSheet() {
    return document.getElementById("ae-cat-sheet");
  }

  function openCatSheet() {
    const sheet = getCatSheet();
    const openBtn = root && $("#ae-cat-open", root);
    if (!sheet) return;
    // 面板有 transform/overflow，fixed 会被困在面板底；挂到 body 才是真弹层
    if (sheet.parentElement !== document.body) {
      document.body.appendChild(sheet);
    }
    sheet.hidden = false;
    openBtn?.setAttribute("aria-expanded", "true");
    document.body.classList.add("animalearn-sheet-open");
    window.setTimeout(() => $("#ae-cat-close", sheet)?.focus?.(), 30);
  }

  function syncFsButton() {
    const btn = root && $("#ae-fs-toggle", root);
    if (!btn) return;
    const on = root?.classList.contains("is-fs");
    btn.textContent = on ? "退出全屏" : "全屏";
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.title = on ? "退出全屏 (Esc)" : "全屏沉浸";
  }

  function isFs() {
    return Boolean(root?.classList.contains("is-fs"));
  }

  async function enterFullscreen() {
    if (!root || isFs()) return;
    root.classList.add("is-fs");
    document.body.classList.add("animalearn-fs-active");
    syncFsButton();
    try {
      if (!document.fullscreenElement && root.requestFullscreen) {
        await root.requestFullscreen({ navigationUI: "hide" });
      }
    } catch (_) {
      /* iOS 等不支持原生全屏时，仅用 CSS 沉浸 */
    }
    $("#ae-fs-toggle", root)?.focus?.();
  }

  async function exitFullscreen() {
    if (!root) return;
    root.classList.remove("is-fs");
    document.body.classList.remove("animalearn-fs-active");
    syncFsButton();
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
    } catch (_) {
      /* ignore */
    }
  }

  function toggleFullscreen() {
    if (isFs()) exitFullscreen();
    else enterFullscreen();
  }

  function closeCatSheet() {
    const sheet = getCatSheet();
    const openBtn = root && $("#ae-cat-open", root);
    if (!sheet) return;
    sheet.hidden = true;
    openBtn?.setAttribute("aria-expanded", "false");
    document.body.classList.remove("animalearn-sheet-open");
  }

  function applyGroup(nextId) {
    groupId = nextId || "all";
    cardIndex = 0;
    updateCredit();
    renderFilters();
    closeCatSheet();
    savePosition();
    if (tab === "cards") renderCard();
    else if (tab === "quiz-look") nextLookQuiz();
    else nextListenQuiz();
  }

  function renderFilters() {
    const host = document.getElementById("ae-filters");
    if (!host || !catalog) return;
    host.innerHTML = (catalog.groups || [])
      .map((g) => {
        const on = g.id === groupId ? " is-active" : "";
        return `<button type="button" class="ghost-btn animalearn-filter-btn${on}" data-group="${g.id}">
          <span>${g.nameZh}</span>
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
    if (meta) meta.textContent = `${cardIndex + 1} · ${list.length}`;
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
      lookAnswer,
      { hideName: true }
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
        (a) => `<button type="button" class="animalearn-img-choice is-loading" data-id="${a.id}" aria-label="选项">
        <span class="animalearn-emoji" hidden>${a.emoji || "🐾"}</span>
        <img alt="" hidden />
      </button>`
      )
      .join("");
    // 先塞居中占位（不显示名字，避免泄题）
    choices.forEach((a) => {
      const btn = host.querySelector(`[data-id="${a.id}"]`);
      setLoadingPlaceholder(btn, a, true, { hideName: true });
    });
    await Promise.all(
      choices.map(async (a) => {
        const btn = host.querySelector(`[data-id="${a.id}"]`);
        if (!btn) return;
        await paintMedia(btn, btn.querySelector(".animalearn-emoji"), btn.querySelector("img"), a, {
          hideName: true,
        });
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
        ? `对啦！${lookAnswer.nameZh}`
        : `是 ${lookAnswer.nameZh}`;
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
        ? `找对了！${listenAnswer.nameZh}`
        : `正确答案：${listenAnswer.nameZh}`;
    }
    speakPair(listenAnswer);
  }

  function bindHoldSpeak(el, getItem) {
    if (!el || el.dataset.holdSpeakBound === "1") return;
    el.dataset.holdSpeakBound = "1";
    let holding = false;
    let loopGen = 0;
    const stopHold = () => {
      holding = false;
      loopGen += 1;
    };
    const speakLoop = (myGen) => {
      const item = getItem();
      if (!item || myGen !== loopGen) return;
      speakPair(item, {
        onDone: () => {
          if (!holding || myGen !== loopGen) return;
          window.setTimeout(() => {
            if (holding && myGen === loopGen) speakLoop(myGen);
          }, 220);
        },
      });
    };
    const start = (ev) => {
      if (ev.pointerType === "mouse" && ev.button !== 0) return;
      // 不 preventDefault：保留 iOS 用户手势以便出声
      holding = true;
      loopGen += 1;
      const myGen = loopGen;
      try {
        el.setPointerCapture?.(ev.pointerId);
      } catch (_) {}
      speakLoop(myGen);
    };
    el.addEventListener("pointerdown", start);
    el.addEventListener("pointerup", stopHold);
    el.addEventListener("pointercancel", stopHold);
    el.addEventListener("lostpointercapture", stopHold);
    el.addEventListener("contextmenu", (ev) => ev.preventDefault());
  }


  function updateCredit() {
    if (!root) return;
    let el = $("#ae-credit", root);
    if (!el) {
      el = document.createElement("p");
      el.id = "ae-credit";
      el.className = "animalearn-credit";
      const body = root.querySelector(".animalearn-body") || root;
      body.appendChild(el);
    }
    const text = String(catalog?.credit || "").trim();
    el.textContent = text;
    el.hidden = !text;
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
      // 卡片点读由 bindHoldSpeak（短按/长按）处理
    });

    // 弹层挂到 body 后，点击不再冒泡到 root，单独绑定
    const sheet = getCatSheet();
    sheet?.addEventListener("click", (ev) => {
      const t = ev.target;
      if (t.closest?.("#ae-cat-backdrop") || t.closest?.("#ae-cat-close")) {
        closeCatSheet();
        return;
      }
      const filterBtn = t.closest?.(".animalearn-filter-btn");
      if (filterBtn) applyGroup(filterBtn.getAttribute("data-group") || "all");
    });

    $("#ae-prev", root)?.addEventListener("click", () => stepCard(-1));
    $("#ae-next", root)?.addEventListener("click", () => stepCard(1));
    $("#ae-random", root)?.addEventListener("click", () => randomCard());
    // 点读：短按一次；长按循环朗读
    bindHoldSpeak($("#ae-speak", root), () => filteredAnimals()[cardIndex]);
    bindHoldSpeak($("#ae-card-media", root), () => filteredAnimals()[cardIndex]);
    bindHoldSpeak($(".animalearn-names", root), () => filteredAnimals()[cardIndex]);
    $("#ae-look-next", root)?.addEventListener("click", () => nextLookQuiz());
    $("#ae-listen-next", root)?.addEventListener("click", () => nextListenQuiz());
    $("#ae-listen-replay", root)?.addEventListener("click", () => {
      if (listenAnswer) speakPair(listenAnswer);
    });

    $("#ae-cat-open", root)?.addEventListener("click", () => openCatSheet());
    $("#ae-fs-toggle", root)?.addEventListener("click", () => toggleFullscreen());

    $("#ae-card-media", root)?.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        speakCurrentCard();
      }
    });

    document.addEventListener("keydown", (ev) => {
      if (ev.key !== "Escape") return;
      const s = getCatSheet();
      if (s && !s.hidden) {
        closeCatSheet();
        return;
      }
      if (isFs()) exitFullscreen();
    });

    document.addEventListener("fullscreenchange", () => {
      if (!root) return;
      // 系统退出原生全屏时，同步关掉 CSS 沉浸
      if (!document.fullscreenElement && isFs()) {
        root.classList.remove("is-fs");
        document.body.classList.remove("animalearn-fs-active");
        syncFsButton();
      }
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

  window.addEventListener("devtools:panel-mounted", (ev) => {
    if (ev?.detail?.id === TOOL_ID) start();
  });

  window.addEventListener("devtools:route", () => {
    const head = location.hash.replace(/^#/, "").split(/[/?]/)[0];
    if (head === TOOL_ID) start();
    else {
      if (isFs()) exitFullscreen();
      savePosition();
    }
  });
})();
