(() => {
  "use strict";

  /**
   * 幼儿闪卡工厂：window.DevToolsKidsFlash.mount(config)
   * visual: image | color | digit | shape（数据 data.visual 或 config.visual）
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
    let speakGen = 0;

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

    function isIOSLike() {
      const ua = navigator.userAgent || "";
      if (/iP(hone|ad|od)/i.test(ua)) return true;
      return navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    }

    function unlockSpeech() {
      if (!window.speechSynthesis || window.speechSynthesis.__kfUnlocked) return;
      window.speechSynthesis.__kfUnlocked = true;
      try {
        window.speechSynthesis.getVoices();
      } catch (_) {}
      try {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      } catch (_) {}
      primeVoices();
    }

    // 仅在早期 touch 解锁；不要在 speak 前 cancel，否则同拍点读会被吞
    if (isIOSLike()) {
      document.addEventListener("touchstart", unlockSpeech, { capture: true, passive: true });
    }

    function speakUtterance(utterance) {
      if (!window.speechSynthesis || !utterance) return;
      try {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      } catch (_) {}
      try {
        window.speechSynthesis.speak(utterance);
      } catch (_) {}
      try {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      } catch (_) {}
    }

    function speakPair(item, opts = {}) {
      if (!window.speechSynthesis || !item) return;
      const zhText = String(item.nameZh || "").trim();
      const enText = String(item.nameEn || "").trim();
      if (!zhText && !enText) return;
      // iOS：cancel 后立刻 speak 常被丢弃，且延时重试已脱离用户手势 → 全程静音
      // 策略：iOS 不 cancel（靠 speakGen 丢弃旧 onend）；其它平台仅在忙碌时 cancel
      if (!isIOSLike()) {
        try {
          if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
            window.speechSynthesis.cancel();
          }
        } catch (_) {}
      }
      const gen = ++speakGen;
      const onDone = typeof opts.onDone === "function" ? opts.onDone : null;
      // 必须在用户手势同步调用 speak，否则 iOS 静音
      primeVoices();
      const finish = () => {
        if (gen !== speakGen) return;
        onDone?.();
      };
      const speakEn = () => {
        if (gen !== speakGen || !enText) {
          finish();
          return;
        }
        const en = new SpeechSynthesisUtterance(enText);
        en.lang = "en-US";
        if (enVoice) en.voice = enVoice;
        en.rate = 0.95;
        en.onend = finish;
        en.onerror = finish;
        speakUtterance(en);
      };
      if (!zhText) {
        speakEn();
        return;
      }
      const zh = new SpeechSynthesisUtterance(zhText);
      zh.lang = "zh-CN";
      if (zhVoice) zh.voice = zhVoice;
      zh.rate = 0.92;
      zh.onend = () => {
        if (gen !== speakGen) return;
        window.setTimeout(speakEn, 160);
      };
      zh.onerror = finish;
      speakUtterance(zh);
    }


    function clearSpecialVisual(mediaEl) {
      mediaEl?.querySelectorAll(".kidsflash-swatch, .kidsflash-digit, .kidsflash-shape").forEach((n) => n.remove());
      mediaEl?.classList.remove("is-color", "is-digit", "is-shape");
    }

    const MIN_LOAD_MS = 650;

    function cancelLoadClear(mediaEl) {
      const t = mediaEl && mediaEl._kfLoadClear;
      if (t) {
        window.clearTimeout(t);
        mediaEl._kfLoadClear = 0;
      }
    }

    function setLoadingPlaceholder(mediaEl, item, loading, opts = {}) {
      if (!mediaEl) return;
      const optGen = opts.paintGen != null ? String(opts.paintGen) : null;
      // 旧 paint 的开关不得动新卡 UI
      if (optGen != null && (mediaEl.dataset.paintGen || "") !== optGen) return;
      cancelLoadClear(mediaEl);
      if (loading) mediaEl.classList.add("is-loading");
      else if (optGen == null || (mediaEl.dataset.paintGen || "") === optGen) {
        mediaEl.classList.remove("is-loading");
      }
      let ph = mediaEl.querySelector(".kidsflash-placeholder");
      if (!loading) {
        const shownAt = Number(mediaEl.dataset.loadShownAt || 0);
        const wait = shownAt ? Math.max(0, MIN_LOAD_MS - (Date.now() - shownAt)) : 0;
        const expectedGen = optGen != null ? optGen : mediaEl.dataset.paintGen || "";
        const clear = () => {
          // 切卡后旧请求不得拆掉新卡的加载框
          if ((mediaEl.dataset.paintGen || "") !== expectedGen) return;
          mediaEl.querySelector(".kidsflash-placeholder")?.remove();
          delete mediaEl.dataset.loadShownAt;
          mediaEl._kfLoadClear = 0;
        };
        if (wait > 0) mediaEl._kfLoadClear = window.setTimeout(clear, wait);
        else clear();
        return;
      }
      if (!ph) {
        ph = document.createElement("div");
        ph.className = "kidsflash-placeholder";
        ph.setAttribute("aria-hidden", "true");
        mediaEl.appendChild(ph);
        mediaEl.dataset.loadShownAt = String(Date.now());
      } else if (!mediaEl.dataset.loadShownAt) {
        mediaEl.dataset.loadShownAt = String(Date.now());
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

    function paintLocalVisual(mediaEl, emojiEl, imgEl, item) {
      if (!mediaEl) return Promise.resolve({ url: "", credit: "" });
      if (imgEl) {
        imgEl.hidden = true;
        if (imgEl.getAttribute("src")) imgEl.removeAttribute("src");
      }
      if (emojiEl) emojiEl.hidden = true;
      setLoadingPlaceholder(mediaEl, item, false);
      mediaEl.classList.remove("is-fallback", "is-loading", "has-preview");
      mediaEl.classList.toggle("is-color", visual === "color");
      mediaEl.classList.toggle("is-digit", visual === "digit");
      mediaEl.classList.toggle("is-shape", visual === "shape");

      mediaEl.querySelectorAll(":scope > .kidsflash-swatch, :scope > .kidsflash-digit, :scope > .kidsflash-shape").forEach((n) => {
        if (visual === "color" && n.classList.contains("kidsflash-swatch")) return;
        if (visual === "digit" && n.classList.contains("kidsflash-digit")) return;
        if (visual === "shape" && n.classList.contains("kidsflash-shape")) return;
        n.remove();
      });

      if (visual === "color") {
        let sw = mediaEl.querySelector(":scope > .kidsflash-swatch");
        if (!sw) {
          sw = document.createElement("div");
          sw.className = "kidsflash-swatch";
          sw.setAttribute("aria-hidden", "true");
          mediaEl.appendChild(sw);
        }
        sw.style.background = item.color || "#888";
      } else if (visual === "digit") {
        const text = item.digit != null ? String(item.digit) : item.nameZh || "";
        let dig = mediaEl.querySelector(":scope > .kidsflash-digit");
        if (!dig) {
          dig = document.createElement("div");
          dig.className = "kidsflash-digit";
          dig.setAttribute("aria-hidden", "true");
          mediaEl.appendChild(dig);
        }
        dig.textContent = text;
        dig.classList.toggle("is-wide", text.length >= 3);
      } else if (visual === "shape") {
        const kind = item.shape || "circle";
        let sh = mediaEl.querySelector(":scope > .kidsflash-shape");
        if (!sh) {
          sh = document.createElement("div");
          sh.className = "kidsflash-shape";
          sh.setAttribute("aria-hidden", "true");
          mediaEl.appendChild(sh);
        }
        sh.className = `kidsflash-shape is-${kind}`;
        sh.style.setProperty("--shape-color", item.color || "#3b82f6");
      }
      return Promise.resolve({ url: "", credit: "" });
    }

    async function paintMedia(mediaEl, emojiEl, imgEl, item, opts = {}) {
      if (!item || !mediaEl) return null;
      if (visual === "color" || visual === "digit" || visual === "shape") {
        return paintLocalVisual(mediaEl, emojiEl, imgEl, item);
      }
      clearSpecialVisual(mediaEl);
      const paintGen = String(Number(mediaEl.dataset.paintGen || 0) + 1);
      mediaEl.dataset.paintGen = paintGen;
      const hideName = Boolean(opts.hideName);
      setLoadingPlaceholder(mediaEl, item, true, { hideName, percent: -1, paintGen });
      if (emojiEl) {
        // 加载期间先留 emoji，避免白板空等
        emojiEl.hidden = false;
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

      const stillThis = () => mediaEl.dataset.paintGen === paintGen && imgEl?.dataset.expectId === item.id;

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
        item,
        (p) => {
          if (!stillThis()) return;
          setLoadingPlaceholder(mediaEl, item, true, {
            hideName,
            percent: typeof p?.percent === "number" ? p.percent : -1,
            paintGen,
          });
        },
        (prev) => showPreview(prev?.url)
      );
      if (mediaEl.dataset.paintGen !== paintGen) return hit;
      if (!imgEl || !hit.url) {
        if (emojiEl) emojiEl.hidden = false;
        setLoadingPlaceholder(mediaEl, item, false, { paintGen });
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
      setLoadingPlaceholder(mediaEl, item, false, { paintGen });
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
      // 色块/数字先立刻画完，再播名字动画，避免同步重排卡顿
      await paintMedia(
        $(`#${id("card-media")}`, root),
        $(`#${id("card-emoji")}`, root),
        $(`#${id("card-img")}`, root),
        item
      );
      const names = $(".kidsflash-names", root);
      if (names) {
        names.classList.remove("is-pop");
        if (visual === "image") {
          void names.offsetWidth;
          names.classList.add("is-pop");
        } else {
          requestAnimationFrame(() => names.classList.add("is-pop"));
        }
      }
      savePosition();
      prefetchAround();
    }

    function prefetchAround() {
      if (visual !== "image") return;
      const list = filtered();
      if (list.length < 2) return;
      const idxs = [1, -1, 2].map((d) => (cardIndex + d + list.length) % list.length);
      for (const i of idxs) {
        const it = list[i];
        if (!it || imgCache[it.id]?.url) continue;
        resolveImage(it).catch(() => {});
      }
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

    function bindHoldSpeak(el, getItem) {
      if (!el || el.dataset.holdSpeakBound === "1") return;
      el.dataset.holdSpeakBound = "1";
      let holding = false;
      let loopGen = 0;
      let spokeAt = 0;
      const stopHold = () => {
        holding = false;
        loopGen += 1;
      };
      const speakLoop = (myGen) => {
        const item = getItem();
        if (!item || myGen !== loopGen) return;
        spokeAt = Date.now();
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
        // 不 preventDefault：iOS 需保留用户手势才能出声
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
      // iOS 部分场景 pointerdown 不触发 speak；click 兜底（刚 pointer 说过则跳过）
      el.addEventListener("click", () => {
        if (Date.now() - spokeAt < 500) return;
        const item = getItem();
        if (item) speakPair(item);
      });
      el.addEventListener("contextmenu", (ev) => ev.preventDefault());
    }

    function updateCredit() {
      if (!root) return;
      let el = $(`#${id("credit")}`, root);
      if (!el) {
        el = document.createElement("p");
        el.id = id("credit");
        el.className = "kidsflash-credit";
        const body = root.querySelector(".kidsflash-body") || root;
        body.appendChild(el);
      }
      const text = String(catalog?.credit || "").trim();
      el.textContent = text;
      el.hidden = !text;
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
        const text = a.digit != null ? String(a.digit) : a.nameZh || "";
        const wide = text.length >= 3 ? " is-wide" : "";
        return `<span class="kidsflash-digit kidsflash-digit-sm${wide}" aria-hidden="true">${text}</span>`;
      }
      if (visual === "shape") {
        const kind = a.shape || "circle";
        const color = a.color || "#3b82f6";
        return `<span class="kidsflash-shape kidsflash-shape-sm is-${kind}" style="--shape-color:${color}" aria-hidden="true"></span>`;
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
        // 卡片点读由 bindHoldSpeak（短按/长按）处理
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
      // 点读：短按一次；长按循环朗读（不再绑 click，避免与 pointerdown 双触发）
      bindHoldSpeak($(`#${id("speak")}`, root), () => filtered()[cardIndex]);
      bindHoldSpeak($(`#${id("card-media")}`, root), () => filtered()[cardIndex]);
      bindHoldSpeak($(".kidsflash-names", root), () => filtered()[cardIndex]);
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

    function waitForRoot(timeoutMs = 10000) {
      const existing = document.getElementById(toolId);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          window.clearTimeout(timer);
          window.removeEventListener("devtools:panel-mounted", onMounted);
          resolve(document.getElementById(toolId));
        };
        const onMounted = (ev) => {
          if (ev?.detail?.id === toolId) finish();
        };
        const timer = window.setTimeout(finish, timeoutMs);
        window.addEventListener("devtools:panel-mounted", onMounted);
      });
    }

    async function boot() {
      if (bootPromise) return bootPromise;
      bootPromise = (async () => {
        root = document.getElementById(toolId) || (await waitForRoot());
        if (!root) throw new Error(`面板 #${toolId} 未挂载`);
        const zhEl = $(`#${id("card-zh")}`, root);
        const enEl = $(`#${id("card-en")}`, root);
        if (zhEl && (!zhEl.textContent || zhEl.textContent === "—" || zhEl.textContent === "－")) {
          zhEl.textContent = "加载中…";
        }
        if (enEl && (!enEl.textContent || enEl.textContent === "—" || enEl.textContent === "－")) {
          enEl.textContent = "Loading…";
        }
        bind();
        loadPosition();
        if (!catalog) {
          const v = window.TOOLS_BUILD || window.TOOLS_VERSION || "";
          if (!dataUrl) throw new Error("缺少 dataUrl");
          const res = await fetch(`${dataUrl}${v ? `?v=${encodeURIComponent(v)}` : ""}`);
          if (!res.ok) throw new Error(`加载数据失败（${res.status}）`);
          catalog = await res.json();
          visual = catalog.visual || config.visual || "image";
        }
        if (visual === "image") loadImgCache();
        const groups = catalog.groups || [];
        if (groupId !== "all" && !groups.some((g) => g.id === groupId)) groupId = "all";
        if (!["cards", "quiz-look", "quiz-listen"].includes(tab)) tab = "cards";
        // shape/color/digit 不走网络图
        updateCredit();
        renderFilters();
        setTab(tab || "cards");
      })().finally(() => {
        bootPromise = null;
      });
      return bootPromise;
    }

    const start = () => {
      boot().catch((err) => {
        root = root || document.getElementById(toolId);
        showError(err.message || String(err));
      });
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

    window.addEventListener("devtools:panel-mounted", (ev) => {
      if (ev?.detail?.id === toolId) start();
    });

    return { boot, start };
  }

  window.DevToolsKidsFlash = { mount };
})();
