(() => {
  "use strict";

  /**
   * 幼儿闪卡工厂：window.DevToolsKidsFlash.mount(config)
   * visual: image | color | digit（数据 data.visual 或 config.visual）
   */
  if (window.DevToolsKidsFlash?.mount) return;

  const $ = (sel, el = document) => el.querySelector(sel);
  const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

  function ensureKidsImg() {
    if (window.DevToolsKidsImg) return Promise.resolve(window.DevToolsKidsImg);
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      const v = encodeURIComponent(window.TOOLS_BUILD || window.TOOLS_VERSION || "");
      s.src = `./lib/kids-img-cache.js${v ? `?v=${v}` : ""}`;
      s.async = true;
      s.onload = () => resolve(window.DevToolsKidsImg);
      s.onerror = () => reject(new Error("kids-img-cache 加载失败"));
      document.head.appendChild(s);
    });
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function mount(config) {
    const toolId = config.toolId;
    const prefix = config.prefix || "kf";
    const namespace = config.namespace || toolId;
    const dataUrl = config.dataUrl;
    const defaultEmoji = config.defaultEmoji || "⭐";
    const posKey = `devtools-${toolId}-pos-v1`;
    const imgCacheKey = `devtools-${toolId}-img-v1`;
    const id = (suffix) => `${prefix}-${suffix}`;

    let root = null;
    let catalog = null;
    let visual = config.visual || "image";
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
      const el = root && $(`#${id("error")}`, root);
      if (!el) return;
      el.hidden = !msg;
      el.textContent = msg ? String(msg) : "";
    }

    function loadImgCache() {
      try {
        imgCache = JSON.parse(sessionStorage.getItem(imgCacheKey) || "{}") || {};
      } catch (_) {
        imgCache = {};
      }
    }

    function saveImgCache() {
      try {
        sessionStorage.setItem(imgCacheKey, JSON.stringify(imgCache));
      } catch (_) {}
    }

    function loadPosition() {
      try {
        const raw = JSON.parse(localStorage.getItem(posKey) || "null");
        if (!raw || typeof raw !== "object") return;
        if (typeof raw.groupId === "string") groupId = raw.groupId;
        if (typeof raw.tab === "string") tab = raw.tab;
        if (Number.isFinite(Number(raw.cardIndex))) cardIndex = Math.max(0, Number(raw.cardIndex) | 0);
      } catch (_) {}
    }

    function savePosition() {
      try {
        localStorage.setItem(posKey, JSON.stringify({ groupId, tab, cardIndex, at: Date.now() }));
      } catch (_) {}
    }

    function items() {
      return catalog?.items || [];
    }

    function filtered() {
      const list = items();
      if (!groupId || groupId === "all") return list.slice();
      return list.filter((a) => a.group === groupId);
    }

    function pickChoices(correct, n = 3) {
      const pool = filtered().filter((a) => a.id !== correct.id);
      const others = shuffle(pool).slice(0, Math.max(0, n - 1));
      const all = items();
      while (others.length < n - 1) {
        const extra = all.find((a) => a.id !== correct.id && !others.some((o) => o.id === a.id));
        if (!extra) break;
        others.push(extra);
      }
      return shuffle([correct, ...others]).slice(0, n);
    }

    function primeVoices() {
      const voices = window.speechSynthesis?.getVoices?.() || [];
      zhVoice = voices.find((v) => /zh[-_]?CN/i.test(v.lang)) || voices.find((v) => /^zh/i.test(v.lang)) || null;
      enVoice = voices.find((v) => /en[-_]?US/i.test(v.lang)) || voices.find((v) => /^en/i.test(v.lang)) || null;
    }

    function speakPair(item) {
      if (!window.speechSynthesis || !item) return;
      window.speechSynthesis.cancel();
      primeVoices();
      const zh = new SpeechSynthesisUtterance(item.nameZh);
      zh.lang = "zh-CN";
      if (zhVoice) zh.voice = zhVoice;
      zh.rate = 0.92;
      const en = new SpeechSynthesisUtterance(item.nameEn);
      en.lang = "en-US";
      if (enVoice) en.voice = enVoice;
      en.rate = 0.95;
      zh.onend = () => window.setTimeout(() => window.speechSynthesis.speak(en), 160);
      window.speechSynthesis.speak(zh);
    }

    function clearSpecialVisual(mediaEl) {
      mediaEl?.querySelectorAll(".kidsflash-swatch, .kidsflash-digit").forEach((n) => n.remove());
    }

    function setLoadingPlaceholder(mediaEl, item, loading, opts = {}) {
      if (!mediaEl) return;
      mediaEl.classList.toggle("is-loading", Boolean(loading));
      let ph = mediaEl.querySelector(".kidsflash-placeholder");
      if (!loading) {
        if (ph) ph.remove();
        return;
      }
      if (!ph) {
        ph = document.createElement("div");
        ph.className = "kidsflash-placeholder";
        ph.setAttribute("aria-hidden", "true");
        mediaEl.appendChild(ph);
      }
      const emoji = item?.emoji || defaultEmoji;
      const hideName = Boolean(opts.hideName);
      const label = hideName ? "" : [item?.nameZh, item?.nameEn].filter(Boolean).join(" ");
      const pct = typeof opts.percent === "number" ? opts.percent : -1;
      const pctText = pct < 0 ? "加载中…" : pct >= 100 ? "即将完成…" : `加载 ${pct}%`;
      const bar =
        pct < 0
          ? `<span class="kidsflash-load-bar kidsflash-load-bar-indeterminate"></span>`
          : `<span class="kidsflash-load-bar"><span class="kidsflash-load-bar-fill" style="width:${Math.max(4, pct)}%"></span></span>`;
      ph.innerHTML = `<span class="kidsflash-placeholder-emoji">${emoji}</span>${
        label ? `<span class="kidsflash-placeholder-text">${label}</span>` : ""
      }<span class="kidsflash-load-pct">${pctText}</span>${bar}`;
    }

    async function resolveImage(item, onProgress, onPreview) {
      if (!item) return { url: "", credit: "" };
      if (imgCache[item.id]?.url && !String(imgCache[item.id].url).startsWith("blob:")) {
        onProgress?.({ percent: 100 });
        onPreview?.({ url: imgCache[item.id].url });
        return imgCache[item.id];
      }
      try {
        await ensureKidsImg();
        const hit = await window.DevToolsKidsImg.resolveItemImage(
          { id: item.id, commons: item.commons, query: item.query || item.nameEn || item.id, nameEn: item.nameEn },
          { namespace, onProgress, onPreview }
        );
        if (hit?.url) {
          const row = { url: hit.url, credit: hit.credit || "" };
          imgCache[item.id] = row;
          if (!String(hit.url).startsWith("blob:")) saveImgCache();
          return row;
        }
      } catch (_) {}
      return { url: "", credit: "" };
    }

    function waitImgReady(imgEl) {
      if (!imgEl) return Promise.resolve();
      if (typeof imgEl.decode === "function") return imgEl.decode().catch(() => {});
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

    function paintColorOrDigit(mediaEl, emojiEl, imgEl, item) {
      clearSpecialVisual(mediaEl);
      if (imgEl) {
        imgEl.hidden = true;
        imgEl.removeAttribute("src");
      }
      if (emojiEl) emojiEl.hidden = true;
      setLoadingPlaceholder(mediaEl, item, false);
      mediaEl?.classList.remove("is-fallback", "is-loading");
      if (visual === "color") {
        const sw = document.createElement("div");
        sw.className = "kidsflash-swatch";
        sw.style.background = item.color || "#888";
        sw.setAttribute("aria-hidden", "true");
        mediaEl.appendChild(sw);
      } else {
        const dig = document.createElement("div");
        dig.className = "kidsflash-digit";
        dig.textContent = item.digit != null ? String(item.digit) : item.nameZh || "";
        dig.setAttribute("aria-hidden", "true");
        mediaEl.appendChild(dig);
      }
      return Promise.resolve({ url: "", credit: "" });
    }

    async function paintMedia(mediaEl, emojiEl, imgEl, item, opts = {}) {
      if (!item || !mediaEl) return null;
      if (visual === "color" || visual === "digit") {
        return paintColorOrDigit(mediaEl, emojiEl, imgEl, item);
      }
      clearSpecialVisual(mediaEl);
      const hideName = Boolean(opts.hideName);
      setLoadingPlaceholder(mediaEl, item, true, { hideName, percent: -1 });
      if (emojiEl) {
        emojiEl.hidden = true;
        emojiEl.textContent = item.emoji || defaultEmoji;
      }
      if (imgEl) {
        imgEl.hidden = true;
        imgEl.removeAttribute("src");
        imgEl.alt = hideName ? "配图" : `${item.nameZh} ${item.nameEn}`;
        imgEl.dataset.expectId = item.id;
        imgEl.classList.remove("is-preview", "is-ready");
        Object.assign(imgEl.style, {
          maxWidth: "100%",
          maxHeight: "100%",
          width: "100%",
          height: "100%",
          objectPosition: "center center",
          position: "absolute",
          inset: "0",
          margin: "0",
        });
        imgEl.style.setProperty("object-fit", "contain", "important");
      }

      const showPreview = (url) => {
        if (!imgEl || !url || imgEl.dataset.expectId !== item.id) return;
        imgEl.referrerPolicy = "no-referrer";
        imgEl.classList.add("is-preview");
        imgEl.classList.remove("is-ready");
        imgEl.src = url;
        imgEl.hidden = false;
        if (emojiEl) emojiEl.hidden = true;
        mediaEl.classList.add("has-preview");
      };

      const hit = await resolveImage(
        item,
        (p) => {
          setLoadingPlaceholder(mediaEl, item, true, {
            hideName,
            percent: typeof p?.percent === "number" ? p.percent : -1,
          });
        },
        (prev) => showPreview(prev?.url)
      );
      if (!imgEl || !hit.url) {
        if (emojiEl) emojiEl.hidden = false;
        setLoadingPlaceholder(mediaEl, item, false);
        mediaEl.classList.add("is-fallback");
        mediaEl.classList.remove("has-preview");
        return hit;
      }
      if (imgEl.dataset.expectId !== item.id) return hit;
      imgEl.referrerPolicy = "no-referrer";
      if (imgEl.src !== hit.url) imgEl.src = hit.url;
      imgEl.hidden = false;
      if (emojiEl) emojiEl.hidden = true;
      await waitImgReady(imgEl);
      if (imgEl.dataset.expectId !== item.id) return hit;
      imgEl.classList.remove("is-preview");
      imgEl.classList.add("is-ready");
      setLoadingPlaceholder(mediaEl, item, false);
      mediaEl.classList.remove("is-fallback", "has-preview");
      return hit;
    }

    function currentGroupLabel() {
      const g = (catalog?.groups || []).find((x) => x.id === groupId);
      return g ? `分类 · ${g.nameZh}` : "分类 · 全部";
    }

    function updateCatLabel() {
      const el = root && $(`#${id("cat-label")}`, root);
      if (el) el.textContent = currentGroupLabel();
    }

    function getCatSheet() {
      return document.getElementById(id("cat-sheet"));
    }

    function openCatSheet() {
      const sheet = getCatSheet();
      const openBtn = root && $(`#${id("cat-open")}`, root);
      if (!sheet) return;
      if (sheet.parentElement !== document.body) document.body.appendChild(sheet);
      sheet.hidden = false;
      openBtn?.setAttribute("aria-expanded", "true");
      document.body.classList.add("kidsflash-sheet-open");
      window.setTimeout(() => $(`#${id("cat-close")}`, sheet)?.focus?.(), 30);
    }

    function closeCatSheet() {
      const sheet = getCatSheet();
      const openBtn = root && $(`#${id("cat-open")}`, root);
      if (!sheet) return;
      sheet.hidden = true;
      openBtn?.setAttribute("aria-expanded", "false");
      document.body.classList.remove("kidsflash-sheet-open");
    }

    function isFs() {
      return Boolean(root?.classList.contains("is-fs"));
    }

    function syncFsButton() {
      const btn = root && $(`#${id("fs-toggle")}`, root);
      if (!btn) return;
      const on = isFs();
      btn.textContent = on ? "退出全屏" : "全屏";
      btn.setAttribute("aria-pressed", on ? "true" : "false");
      btn.title = on ? "退出全屏 (Esc)" : "全屏沉浸";
    }

    async function enterFullscreen() {
      if (!root || isFs()) return;
      root.classList.add("is-fs");
      document.body.classList.add("kidsflash-fs-active");
      syncFsButton();
      try {
        if (!document.fullscreenElement && root.requestFullscreen) {
          await root.requestFullscreen({ navigationUI: "hide" });
        }
      } catch (_) {}
      $(`#${id("fs-toggle")}`, root)?.focus?.();
    }

    async function exitFullscreen() {
      if (!root) return;
      root.classList.remove("is-fs");
      document.body.classList.remove("kidsflash-fs-active");
      syncFsButton();
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
      } catch (_) {}
    }

    function toggleFullscreen() {
      if (isFs()) exitFullscreen();
      else enterFullscreen();
    }

    function applyGroup(nextId) {
      groupId = nextId || "all";
      cardIndex = 0;
      renderFilters();
      closeCatSheet();
      savePosition();
      if (tab === "cards") renderCard();
      else if (tab === "quiz-look") nextLookQuiz();
      else nextListenQuiz();
    }

    function renderFilters() {
      const host = document.getElementById(id("filters"));
      if (!host || !catalog) return;
      host.innerHTML = (catalog.groups || [])
        .map((g) => {
          const on = g.id === groupId ? " is-active" : "";
          return `<button type="button" class="ghost-btn kidsflash-filter-btn${on}" data-group="${g.id}">
          <span>${g.nameZh}</span>
          <span class="kidsflash-filter-check" aria-hidden="true">✓</span>
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
      const list = filtered();
      if (!list.length) {
        showError("当前分类没有内容");
        return;
      }
      showError("");
      normalizeCardIndex(list);
      const item = list[cardIndex];
      const zh = $(`#${id("card-zh")}`, root);
      const en = $(`#${id("card-en")}`, root);
      const meta = $(`#${id("card-meta")}`, root);
      if (zh) zh.textContent = item.nameZh;
      if (en) en.textContent = item.nameEn;
      if (meta) meta.textContent = `${cardIndex + 1} · ${list.length}`;
      const names = $(".kidsflash-names", root);
      if (names) {
        names.classList.remove("is-pop");
        void names.offsetWidth;
        names.classList.add("is-pop");
      }
      await paintMedia(
        $(`#${id("card-media")}`, root),
        $(`#${id("card-emoji")}`, root),
        $(`#${id("card-img")}`, root),
        item
      );
      savePosition();
    }

    function stepCard(delta) {
      const list = filtered();
      if (!list.length) return;
      cardIndex = (cardIndex + delta + list.length) % list.length;
      renderCard();
    }

    function randomCard() {
      const list = filtered();
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
      const item = filtered()[cardIndex];
      if (item) speakPair(item);
    }

    function setTab(next) {
      tab = next || "cards";
      $$(".kidsflash-tab", root).forEach((btn) => {
        const on = btn.dataset.tab === tab;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
        btn.classList.toggle("secondary-btn", on);
        btn.classList.toggle("ghost-btn", !on);
      });
      $$(".kidsflash-pane", root).forEach((pane) => {
        pane.hidden = pane.dataset.pane !== tab;
      });
      savePosition();
      if (tab === "cards") renderCard();
      else if (tab === "quiz-look") nextLookQuiz();
      else if (tab === "quiz-listen") nextListenQuiz();
    }

    async function nextLookQuiz() {
      lookLocked = false;
      const pool = filtered();
      if (pool.length < 2) {
        showError("当前分类太少，请选「全部」再玩看图");
        return;
      }
      showError("");
      lookAnswer = pool[Math.floor(Math.random() * pool.length)];
      const choices = pickChoices(lookAnswer, 3);
      await paintMedia(
        $(`#${id("look-media")}`, root),
        $(`#${id("look-emoji")}`, root),
        $(`#${id("look-img")}`, root),
        lookAnswer,
        { hideName: true }
      );
      const fb = $(`#${id("look-feedback")}`, root);
      if (fb) {
        fb.textContent = "";
        fb.className = "kidsflash-feedback";
      }
      const host = $(`#${id("look-choices")}`, root);
      if (!host) return;
      host.innerHTML = choices
        .map(
          (a) => `<button type="button" class="kidsflash-choice" data-id="${a.id}">
        <span class="kidsflash-choice-zh">${a.nameZh}</span>
        <span class="kidsflash-choice-en">${a.nameEn}</span>
      </button>`
        )
        .join("");
    }

    function choiceInnerHtml(a) {
      if (visual === "color") {
        return `<span class="kidsflash-swatch kidsflash-swatch-sm" style="background:${a.color || "#888"}" aria-hidden="true"></span>`;
      }
      if (visual === "digit") {
        return `<span class="kidsflash-digit kidsflash-digit-sm" aria-hidden="true">${
          a.digit != null ? a.digit : a.nameZh
        }</span>`;
      }
      return `<span class="kidsflash-emoji" hidden>${a.emoji || defaultEmoji}</span><img alt="" hidden />`;
    }

    async function nextListenQuiz() {
      listenLocked = false;
      const pool = filtered();
      if (pool.length < 3) {
        showError("听名选图需要至少 3 种，请选「全部」");
        return;
      }
      showError("");
      listenAnswer = pool[Math.floor(Math.random() * pool.length)];
      const choices = pickChoices(listenAnswer, 3);
      const fb = $(`#${id("listen-feedback")}`, root);
      if (fb) {
        fb.textContent = "";
        fb.className = "kidsflash-feedback";
      }
      const host = $(`#${id("listen-choices")}`, root);
      if (!host) return;
      host.innerHTML = choices
        .map(
          (a) =>
            `<button type="button" class="kidsflash-img-choice${
              visual === "image" ? " is-loading" : ""
            }" data-id="${a.id}" aria-label="选项">${choiceInnerHtml(a)}</button>`
        )
        .join("");
      if (visual === "image") {
        choices.forEach((a) => {
          const btn = host.querySelector(`[data-id="${a.id}"]`);
          setLoadingPlaceholder(btn, a, true, { hideName: true });
        });
        await Promise.all(
          choices.map(async (a) => {
            const btn = host.querySelector(`[data-id="${a.id}"]`);
            if (!btn) return;
            await paintMedia(btn, btn.querySelector(".kidsflash-emoji"), btn.querySelector("img"), a, {
              hideName: true,
            });
            btn.classList.remove("is-loading");
          })
        );
      }
      speakPair(listenAnswer);
    }

    function onLookChoice(choiceId) {
      if (lookLocked || !lookAnswer) return;
      lookLocked = true;
      const host = $(`#${id("look-choices")}`, root);
      $$(".kidsflash-choice", host).forEach((btn) => {
        const bid = btn.getAttribute("data-id");
        if (bid === lookAnswer.id) btn.classList.add("is-correct");
        if (bid === choiceId && choiceId !== lookAnswer.id) btn.classList.add("is-wrong");
      });
      const ok = choiceId === lookAnswer.id;
      const fb = $(`#${id("look-feedback")}`, root);
      if (fb) {
        fb.className = `kidsflash-feedback ${ok ? "is-ok" : "is-bad"}`;
        fb.textContent = ok ? `对啦！${lookAnswer.nameZh}` : `是 ${lookAnswer.nameZh}`;
      }
      speakPair(lookAnswer);
    }

    function onListenChoice(choiceId) {
      if (listenLocked || !listenAnswer) return;
      listenLocked = true;
      const host = $(`#${id("listen-choices")}`, root);
      $$(".kidsflash-img-choice", host).forEach((btn) => {
        const bid = btn.getAttribute("data-id");
        if (bid === listenAnswer.id) btn.classList.add("is-correct");
        if (bid === choiceId && choiceId !== listenAnswer.id) btn.classList.add("is-wrong");
      });
      const ok = choiceId === listenAnswer.id;
      const fb = $(`#${id("listen-feedback")}`, root);
      if (fb) {
        fb.className = `kidsflash-feedback ${ok ? "is-ok" : "is-bad"}`;
        fb.textContent = ok ? `找对了！${listenAnswer.nameZh}` : `正确答案：${listenAnswer.nameZh}`;
      }
      speakPair(listenAnswer);
    }

    function bind() {
      root = document.getElementById(toolId);
      if (!root || root.dataset.kidsflashBound === "1") return;
      root.dataset.kidsflashBound = "1";

      root.addEventListener("click", (ev) => {
        const t = ev.target;
        const tabBtn = t.closest?.(".kidsflash-tab");
        if (tabBtn) {
          setTab(tabBtn.dataset.tab || "cards");
          return;
        }
        const lookBtn = t.closest?.(`#${id("look-choices")} .kidsflash-choice`);
        if (lookBtn) {
          onLookChoice(lookBtn.getAttribute("data-id"));
          return;
        }
        const listenBtn = t.closest?.(`#${id("listen-choices")} .kidsflash-img-choice`);
        if (listenBtn) {
          onListenChoice(listenBtn.getAttribute("data-id"));
          return;
        }
        if (t.closest?.(`#${id("card-media")}, #${id("card-zh")}, #${id("card-en")}`)) {
          speakCurrentCard();
        }
      });

      const sheet = getCatSheet();
      sheet?.addEventListener("click", (ev) => {
        const t = ev.target;
        if (t.closest?.(`#${id("cat-backdrop")}`) || t.closest?.(`#${id("cat-close")}`)) {
          closeCatSheet();
          return;
        }
        const filterBtn = t.closest?.(".kidsflash-filter-btn");
        if (filterBtn) applyGroup(filterBtn.getAttribute("data-group") || "all");
      });

      $(`#${id("prev")}`, root)?.addEventListener("click", () => stepCard(-1));
      $(`#${id("next")}`, root)?.addEventListener("click", () => stepCard(1));
      $(`#${id("random")}`, root)?.addEventListener("click", () => randomCard());
      $(`#${id("speak")}`, root)?.addEventListener("click", () => speakCurrentCard());
      $(`#${id("look-next")}`, root)?.addEventListener("click", () => nextLookQuiz());
      $(`#${id("listen-next")}`, root)?.addEventListener("click", () => nextListenQuiz());
      $(`#${id("listen-replay")}`, root)?.addEventListener("click", () => {
        if (listenAnswer) speakPair(listenAnswer);
      });
      $(`#${id("cat-open")}`, root)?.addEventListener("click", () => openCatSheet());
      $(`#${id("fs-toggle")}`, root)?.addEventListener("click", () => toggleFullscreen());
      $(`#${id("card-media")}`, root)?.addEventListener("keydown", (ev) => {
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
        if (!document.fullscreenElement && isFs()) {
          root.classList.remove("is-fs");
          document.body.classList.remove("kidsflash-fs-active");
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
        root = document.getElementById(toolId);
        if (!root) return;
        loadImgCache();
        loadPosition();
        if (!catalog) {
          const v = window.TOOLS_BUILD || "";
          const res = await fetch(`${dataUrl}${v ? `?v=${encodeURIComponent(v)}` : ""}`);
          if (!res.ok) throw new Error(`加载数据失败（${res.status}）`);
          catalog = await res.json();
          visual = catalog.visual || config.visual || "image";
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
      if (head === toolId) start();
      else {
        if (isFs()) exitFullscreen();
        savePosition();
      }
    });

    return { boot, start };
  }

  window.DevToolsKidsFlash = { mount };
})();
