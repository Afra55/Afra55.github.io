(() => {
  "use strict";

  const TOOL_ID = "enspeak";
  const STORAGE_KEY = "devtools-enspeak-v1";
  const BUILD = window.TOOLS_BUILD || "";
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  /** @type {any} */
  let CONTENT = null;
  /** @type {ReturnType<typeof defaultState>} */
  let state = defaultState();
  let activeIsland = "who";
  let activeSentenceId = "";
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordedUrl = "";
  let bound = false;

  function defaultState() {
    return {
      profile: {},
      sentences: {},
      today: {
        date: "",
        blocks: { listen: false, reword: false, reply: false, output: false },
        spokenIds: [],
        listen: { island: "who", day: 0, count: 0, startedOn: "" },
        newIds: [],
      },
      streak: 0,
      lastGoalDate: "",
      settings: { rate: 0.92 },
      history: {},
    };
  }

  function todayKey(d = new Date()) {
    const p = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  function weekIndexFromInstall(installDate) {
    const start = new Date(installDate + "T00:00:00");
    if (Number.isNaN(start.getTime())) return 1;
    const now = new Date();
    const days = Math.floor((startOfDay(now) - startOfDay(start)) / 86400000);
    return Math.min(4, Math.max(1, Math.floor(days / 7) + 1));
  }

  function startOfDay(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }

  function loadState() {
    try {
      const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!raw || typeof raw !== "object") return defaultState();
      const base = defaultState();
      return {
        ...base,
        ...raw,
        profile: { ...base.profile, ...(raw.profile || {}) },
        sentences: { ...(raw.sentences || {}) },
        today: { ...base.today, ...(raw.today || {}), blocks: { ...base.today.blocks, ...(raw.today?.blocks || {}) }, listen: { ...base.today.listen, ...(raw.today?.listen || {}) } },
        settings: { ...base.settings, ...(raw.settings || {}) },
        history: { ...(raw.history || {}) },
      };
    } catch (_) {
      return defaultState();
    }
  }

  function saveState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function ensureToday() {
    const key = todayKey();
    if (!state.installDate) state.installDate = key;
    if (state.today.date === key) return;
    // roll streak based on yesterday goal
    const y = new Date();
    y.setDate(y.getDate() - 1);
    const yKey = todayKey(y);
    if (state.history[yKey]?.goal && state.lastGoalDate === yKey) {
      /* streak already counted */
    } else if (state.history[yKey]?.goal) {
      state.streak = (state.streak || 0) + 1;
      state.lastGoalDate = yKey;
    } else if (state.today.date && state.today.date !== key) {
      // missed a day → streak break unless today continues after goal day
      if (state.lastGoalDate && state.lastGoalDate !== yKey) state.streak = 0;
    }
    state.today = {
      date: key,
      blocks: { listen: false, reword: false, reply: false, output: false },
      spokenIds: [],
      listen: state.today.listen?.island
        ? { ...state.today.listen }
        : { island: focusIslandId(), day: 1, count: 0, startedOn: key },
      newIds: [],
    };
    // lock listen clip 3 days
    const lockDays = CONTENT?.method?.listenLockDays || 3;
    if (!state.today.listen.startedOn) state.today.listen.startedOn = key;
    const started = new Date(state.today.listen.startedOn + "T00:00:00");
    const dayNum = Math.floor((startOfDay(new Date()) - startOfDay(started)) / 86400000) + 1;
    if (dayNum > lockDays) {
      state.today.listen = { island: focusIslandId(), day: 1, count: 0, startedOn: key };
    } else {
      state.today.listen.day = Math.max(1, dayNum);
    }
    saveState();
  }

  function focusIslandId() {
    const week = weekIndexFromInstall(state.installDate || todayKey());
    const plan = (CONTENT?.weekPlans || []).find((w) => w.week === week) || CONTENT?.weekPlans?.[0];
    return plan?.focus?.[0] || "who";
  }

  function weekPlan() {
    const week = weekIndexFromInstall(state.installDate || todayKey());
    return (CONTENT?.weekPlans || []).find((w) => w.week === week) || CONTENT?.weekPlans?.[0];
  }

  function sentenceById(id) {
    return (CONTENT?.sentences || []).find((s) => s.id === id);
  }

  function sentencesForIsland(island) {
    return (CONTENT?.sentences || []).filter((s) => s.island === island);
  }

  function lifelines() {
    return (CONTENT?.sentences || []).filter((s) => s.role === "lifeline" || s.island === "lifeline");
  }

  function replies() {
    return (CONTENT?.sentences || []).filter((s) => s.role === "reply" || s.island === "reply");
  }

  function fillTemplate(text, extra = {}) {
    const map = { ...(state.profile || {}), ...extra };
    return String(text || "").replace(/\{([a-z0-9_]+)\}/gi, (_, key) => {
      const v = map[key];
      if (v != null && String(v).trim()) return String(v).trim();
      return `{${key}}`;
    });
  }

  function displayEn(sent) {
    const st = state.sentences[sent.id];
    if (st?.myVersion?.trim()) return st.myVersion.trim();
    return fillTemplate(sent.en);
  }

  function getStatus(id) {
    return state.sentences[id]?.status || "new";
  }

  function setSentencePatch(id, patch) {
    state.sentences[id] = { ...(state.sentences[id] || {}), ...patch };
    saveState();
  }

  function markStatus(id, status) {
    const order = { new: 0, practicing: 1, spoken: 2, flexible: 3 };
    const cur = getStatus(id);
    if ((order[status] || 0) < (order[cur] || 0) && status !== "practicing") {
      /* allow practicing anytime */
    }
    const next = (order[status] || 0) >= (order[cur] || 0) ? status : cur;
    const rec = state.sentences[id] || {};
    const fills = new Set(rec.fills || []);
    setSentencePatch(id, { status: next, fills: [...fills], updatedAt: todayKey() });
  }

  function markSpoken(id) {
    ensureToday();
    const rec = state.sentences[id] || {};
    const fills = new Set(rec.fills || []);
    if (rec.myVersion?.trim()) fills.add(rec.myVersion.trim().toLowerCase());
    let status = "spoken";
    if (fills.size >= 3) status = "flexible";
    setSentencePatch(id, {
      status,
      fills: [...fills],
      spokenCount: (rec.spokenCount || 0) + 1,
      lastSpoken: todayKey(),
    });
    if (!state.today.spokenIds.includes(id)) state.today.spokenIds.push(id);
    if (state.today.spokenIds.length >= (CONTENT?.method?.mustSpeak || 2)) {
      state.today.blocks.output = true;
    }
    maybeCompleteGoal();
    saveState();
    renderAll();
  }

  function starterFlexibleRatio() {
    const starters = (CONTENT?.islands || []).filter((i) => i.starter).map((i) => i.id);
    const lines = (CONTENT?.sentences || []).filter((s) => starters.includes(s.island) && s.role !== "prompt");
    if (!lines.length) return 0;
    const flex = lines.filter((s) => ["spoken", "flexible"].includes(getStatus(s.id))).length;
    return flex / lines.length;
  }

  function extensionsUnlocked() {
    return starterFlexibleRatio() >= (CONTENT?.method?.unlockFlexibleRatio || 0.7);
  }

  function goalReached() {
    const b = state.today.blocks;
    const spokenOk = (state.today.spokenIds || []).length >= (CONTENT?.method?.mustSpeak || 2);
    const blocksOk = b.output && [b.listen, b.reword, b.reply].filter(Boolean).length >= 2;
    return spokenOk && blocksOk;
  }

  function maybeCompleteGoal() {
    if (!goalReached()) return;
    const key = todayKey();
    if (!state.history[key]?.goal) {
      state.history[key] = { ...(state.history[key] || {}), goal: true };
      if (state.lastGoalDate !== key) {
        const y = new Date();
        y.setDate(y.getDate() - 1);
        if (state.lastGoalDate === todayKey(y)) state.streak = (state.streak || 0) + 1;
        else state.streak = 1;
        state.lastGoalDate = key;
      }
      saveState();
    }
  }

  function pickTodayNew(n = 6) {
    const focus = weekPlan()?.focus || ["who"];
    const pool = (CONTENT?.sentences || []).filter(
      (s) => focus.includes(s.island) && getStatus(s.id) === "new" && s.role !== "prompt"
    );
    const lifelineNew = lifelines().filter((s) => getStatus(s.id) === "new");
    const mixed = [...lifelineNew.slice(0, 2), ...pool];
    const ids = [];
    for (const s of mixed) {
      if (ids.length >= n) break;
      if (!ids.includes(s.id)) ids.push(s.id);
    }
    if (ids.length < n) {
      for (const s of CONTENT.sentences) {
        if (ids.length >= n) break;
        if (s.role === "prompt") continue;
        if (!ids.includes(s.id) && getStatus(s.id) !== "flexible") ids.push(s.id);
      }
    }
    return ids;
  }

  function toast(msg) {
    window.DevToolsExtraKit?.toast?.(msg) || console.info(msg);
  }

  function speakText(text, { rate } = {}) {
    try {
      window.speechSynthesis?.cancel();
      const u = new SpeechSynthesisUtterance(String(text || ""));
      u.lang = "en-US";
      u.rate = rate ?? state.settings.rate ?? 0.92;
      const voices = window.speechSynthesis?.getVoices?.() || [];
      const en = voices.find((v) => /en(-|_)US/i.test(v.lang)) || voices.find((v) => /^en/i.test(v.lang));
      if (en) u.voice = en;
      window.speechSynthesis.speak(u);
    } catch (err) {
      toast("当前浏览器不支持朗读");
    }
  }

  async function loadContent() {
    if (CONTENT) return CONTENT;
    const url = new URL(`./data/en-speak/content.json`, document.baseURI || location.href);
    if (BUILD) url.searchParams.set("v", BUILD);
    const res = await fetch(url.href, { cache: BUILD ? "default" : "no-store" });
    if (!res.ok) throw new Error(`句库加载失败 (${res.status})`);
    CONTENT = await res.json();
    return CONTENT;
  }

  function switchTab(tab) {
    $$(".enspeak-tab").forEach((btn) => {
      const on = btn.dataset.tab === tab;
      btn.classList.toggle("is-active", on);
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    $$(".enspeak-panel").forEach((p) => {
      const on = p.dataset.panel === tab;
      p.hidden = !on;
      p.classList.toggle("is-active", on);
    });
  }

  function renderTodayMeta() {
    const plan = weekPlan();
    const week = plan?.week || 1;
    const el = $("#enspeak-today-meta");
    if (!el) return;
    const spoken = state.today.spokenIds.length;
    const need = CONTENT.method.mustSpeak || 2;
    el.innerHTML = `
      <span class="enspeak-pill">第 ${week} 周 · ${escapeHtml(plan?.title || "")}</span>
      <span class="enspeak-pill">连续达标 ${state.streak || 0} 天</span>
      <span class="enspeak-pill ${goalReached() ? "is-ok" : ""}">${goalReached() ? "今日已达标" : `开口 ${spoken}/${need}`}</span>
      <span class="enspeak-pill">听跟第 ${state.today.listen.day || 1} 天</span>
    `;
    const hint = $("#enspeak-today-hint");
    if (hint) hint.textContent = plan?.hint || "把句子换成自己的真实情况，并说出口。";
  }

  function renderBlocks() {
    const box = $("#enspeak-blocks");
    if (!box) return;
    const items = [
      { id: "listen", title: "听跟", time: "10′", desc: "同一段对话反复听跟" },
      { id: "reword", title: "换词", time: "10′", desc: "5 句改成自己的话" },
      { id: "reply", title: "接话", time: "10′", desc: "Really? / Same here…" },
      { id: "output", title: "输出", time: "5～10′", desc: "至少 2 句真实开口" },
    ];
    box.innerHTML = items
      .map((it) => {
        const done = !!state.today.blocks[it.id];
        return `<button type="button" class="enspeak-block ${done ? "is-done" : ""}" data-block="${it.id}">
          <span class="enspeak-block-kicker">${it.time}${done ? " · 完成" : ""}</span>
          <span class="enspeak-block-title">${it.title}</span>
          <span class="enspeak-block-status">${it.desc}</span>
        </button>`;
      })
      .join("");
  }

  function openDrill(block) {
    const drill = $("#enspeak-drill");
    const title = $("#enspeak-drill-title");
    const body = $("#enspeak-drill-body");
    if (!drill || !body) return;
    drill.hidden = false;
    if (block === "listen") {
      title.textContent = "听跟 · 同一段连用多天";
      body.innerHTML = renderListenDrill();
      bindListenDrill(body);
    } else if (block === "reword") {
      title.textContent = "换词 · 改成自己的话";
      body.innerHTML = renderRewordDrill();
      bindRewordDrill(body);
    } else if (block === "reply") {
      title.textContent = "接话专项";
      body.innerHTML = renderReplyDrill();
      bindReplyDrill(body);
    } else if (block === "output") {
      title.textContent = "输出 · 必须说出口";
      body.innerHTML = renderOutputDrill();
      bindOutputDrill(body);
    }
  }

  function renderListenDrill() {
    const island = state.today.listen.island || focusIslandId();
    const lines = CONTENT.dialogues?.[island] || CONTENT.dialogues?.who || [];
    const html = lines
      .map((line, i) => {
        const text = fillTemplate(line.text);
        return `<div class="enspeak-dialogue-line ${line.speaker === "B" ? "is-b" : ""}" data-line="${i}">
          <strong>${line.speaker}</strong>
          <span>${escapeHtml(text)}</span>
        </div>`;
      })
      .join("");
    return `
      <p class="hint tight">岛：${escapeHtml(islandName(island))} · 第 ${state.today.listen.day} 天 · 已跟读 ${state.today.listen.count || 0} 次</p>
      <div>${html}</div>
      <div class="btn-row tool-actions">
        <button type="button" class="primary-btn" data-act="play-all">整段朗读</button>
        <button type="button" class="ghost-btn" data-act="shadow">跟读 +1</button>
        <button type="button" class="ghost-btn" data-act="done">完成本段</button>
      </div>`;
  }

  function bindListenDrill(root) {
    root.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const act = btn.dataset.act;
      const island = state.today.listen.island || focusIslandId();
      const lines = (CONTENT.dialogues?.[island] || []).map((l) => fillTemplate(l.text));
      if (act === "play-all") {
        void playQueue(lines);
      } else if (act === "shadow") {
        state.today.listen.count = (state.today.listen.count || 0) + 1;
        if (state.today.listen.count >= 3) state.today.blocks.listen = true;
        saveState();
        maybeCompleteGoal();
        openDrill("listen");
        renderBlocks();
        renderTodayMeta();
      } else if (act === "done") {
        state.today.blocks.listen = true;
        saveState();
        maybeCompleteGoal();
        renderBlocks();
        renderTodayMeta();
        toast("听跟段已勾完成");
      }
    });
  }

  async function playQueue(lines) {
    for (const line of lines) {
      await new Promise((resolve) => {
        try {
          window.speechSynthesis?.cancel();
          const u = new SpeechSynthesisUtterance(line);
          u.lang = "en-US";
          u.rate = state.settings.rate || 0.92;
          u.onend = resolve;
          u.onerror = resolve;
          window.speechSynthesis.speak(u);
        } catch (_) {
          resolve();
        }
      });
      await sleep(280);
    }
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function renderRewordDrill() {
    if (!state.today.newIds?.length) {
      state.today.newIds = pickTodayNew(6);
      saveState();
    }
    const cards = state.today.newIds
      .map((id) => {
        const s = sentenceById(id);
        if (!s) return "";
        const mine = state.sentences[id]?.myVersion || displayEn(s);
        return `<div class="enspeak-sent" data-sid="${id}">
          <div class="enspeak-sent-en">${escapeHtml(fillTemplate(s.en))}</div>
          <div class="enspeak-sent-zh">${escapeHtml(s.zh)}</div>
          <label class="enspeak-field">我的版本
            <input class="text-input enspeak-mine-input" data-sid="${id}" value="${escapeAttr(mine)}" />
          </label>
          <div class="btn-row tool-actions">
            <button type="button" class="ghost-btn" data-act="speak" data-sid="${id}">朗读</button>
            <button type="button" class="ghost-btn" data-act="save" data-sid="${id}">保存变形</button>
          </div>
        </div>`;
      })
      .join("");
    return `${cards}
      <div class="btn-row tool-actions">
        <button type="button" class="primary-btn" data-act="done-reword">完成换词段</button>
      </div>`;
  }

  function bindRewordDrill(root) {
    root.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const id = btn.dataset.sid;
      const act = btn.dataset.act;
      if (act === "speak" && id) {
        const input = root.querySelector(`input[data-sid="${id}"]`);
        speakText(input?.value || displayEn(sentenceById(id)));
      } else if (act === "save" && id) {
        const input = root.querySelector(`input[data-sid="${id}"]`);
        const val = input?.value?.trim() || "";
        const fills = new Set(state.sentences[id]?.fills || []);
        if (val) fills.add(val.toLowerCase());
        setSentencePatch(id, { myVersion: val, fills: [...fills], status: fills.size >= 3 ? "flexible" : "practicing" });
        if (!state.today.newIds.includes(id)) state.today.newIds.push(id);
        toast("已保存你的版本");
      } else if (act === "done-reword") {
        let ok = 0;
        for (const id of state.today.newIds || []) {
          const input = root.querySelector(`input[data-sid="${id}"]`);
          const val = input?.value?.trim();
          if (val) {
            const fills = new Set(state.sentences[id]?.fills || []);
            fills.add(val.toLowerCase());
            setSentencePatch(id, { myVersion: val, fills: [...fills], status: getStatus(id) === "new" ? "practicing" : getStatus(id) });
            ok += 1;
          }
        }
        if (ok >= 5) {
          state.today.blocks.reword = true;
          saveState();
          maybeCompleteGoal();
          renderBlocks();
          renderTodayMeta();
          toast("换词段完成");
        } else toast(`再改 ${5 - ok} 句成自己的话`);
      }
    });
  }

  function renderReplyDrill() {
    const list = [...replies(), ...lifelines()].slice(0, 12);
    return `<div class="enspeak-sent-list">${list
      .map((s) => {
        return `<button type="button" class="enspeak-sent" data-sid="${s.id}">
          <div class="enspeak-sent-en">${escapeHtml(displayEn(s))}</div>
          <div class="enspeak-sent-zh">${escapeHtml(s.zh)}</div>
          <div class="enspeak-sent-meta">${statusLabel(getStatus(s.id))}</div>
        </button>`;
      })
      .join("")}</div>
      <div class="btn-row tool-actions">
        <button type="button" class="primary-btn" data-act="done-reply">完成接话段</button>
      </div>`;
  }

  function bindReplyDrill(root) {
    root.addEventListener("click", (e) => {
      const sent = e.target.closest("[data-sid]");
      const act = e.target.closest("[data-act]")?.dataset.act;
      if (act === "done-reply") {
        state.today.blocks.reply = true;
        saveState();
        maybeCompleteGoal();
        renderBlocks();
        renderTodayMeta();
        toast("接话段完成");
        return;
      }
      if (sent?.dataset.sid) openSentenceDialog(sent.dataset.sid);
    });
  }

  function renderOutputDrill() {
    const ids = [...new Set([...(state.today.newIds || []), ...(state.today.spokenIds || [])])].slice(0, 8);
    const fallback = pickTodayNew(4);
    const use = ids.length ? ids : fallback;
    return `
      <p class="hint tight">对着空气说也行；有真人就优先找人。勾选「已用真实情况说出口」才算数。</p>
      <div class="enspeak-sent-list">${use
        .map((id) => {
          const s = sentenceById(id);
          if (!s) return "";
          const done = state.today.spokenIds.includes(id);
          return `<div class="enspeak-sent">
            <div class="enspeak-sent-en">${escapeHtml(displayEn(s))}</div>
            <div class="enspeak-sent-zh">${escapeHtml(s.zh)}</div>
            <div class="btn-row tool-actions">
              <button type="button" class="ghost-btn" data-act="speak" data-sid="${id}">听示范</button>
              <button type="button" class="primary-btn" data-act="spoken" data-sid="${id}" ${done ? "disabled" : ""}>${done ? "今日已开口" : "已开口"}</button>
            </div>
          </div>`;
        })
        .join("")}</div>`;
  }

  function bindOutputDrill(root) {
    root.addEventListener("click", (e) => {
      const btn = e.target.closest("[data-act]");
      if (!btn) return;
      const id = btn.dataset.sid;
      if (btn.dataset.act === "speak") speakText(displayEn(sentenceById(id)));
      if (btn.dataset.act === "spoken") {
        markSpoken(id);
        openDrill("output");
      }
    });
  }

  function islandName(id) {
    return (CONTENT.islands || []).find((i) => i.id === id)?.name || id;
  }

  function statusLabel(st) {
    return ({ new: "新学", practicing: "练中", spoken: "能开口", flexible: "能变形" }[st] || st);
  }

  function renderIslands() {
    const map = $("#enspeak-island-map");
    if (!map) return;
    const unlocked = extensionsUnlocked();
    map.innerHTML = (CONTENT.islands || [])
      .map((island) => {
        const locked = !island.starter && !unlocked;
        const lines = sentencesForIsland(island.id);
        const done = lines.filter((s) => ["spoken", "flexible"].includes(getStatus(s.id))).length;
        return `<button type="button" class="enspeak-island-btn ${activeIsland === island.id ? "is-active" : ""} ${locked ? "is-locked" : ""}" data-island="${island.id}" ${locked ? "data-locked=1" : ""}>
          <strong>${escapeHtml(island.name)}</strong>
          <span class="hint tight">${escapeHtml(island.blurb)}</span>
          <span class="hint tight">${locked ? "起步岛达标约 70% 解锁" : `${done}/${lines.length}`}</span>
        </button>`;
      })
      .join("");
    renderIslandList();
  }

  function renderIslandList() {
    const title = $("#enspeak-island-title");
    const list = $("#enspeak-island-list");
    if (title) title.textContent = islandName(activeIsland);
    if (!list) return;
    const lines = sentencesForIsland(activeIsland);
    list.innerHTML = lines
      .map((s) => {
        return `<button type="button" class="enspeak-sent" data-sid="${s.id}">
          <div class="enspeak-sent-en">${escapeHtml(displayEn(s))}</div>
          <div class="enspeak-sent-zh">${escapeHtml(s.zh)}</div>
          <div class="enspeak-sent-meta">${statusLabel(getStatus(s.id))}${state.sentences[s.id]?.myVersion ? " · 有我的版本" : ""}</div>
        </button>`;
      })
      .join("");
  }

  function renderFrames() {
    const grid = $("#enspeak-frame-grid");
    if (!grid) return;
    grid.innerHTML = (CONTENT.frames || [])
      .map((f) => {
        return `<button type="button" class="enspeak-frame-btn" data-fid="${f.id}">
          <div class="enspeak-sent-en">${escapeHtml(f.en)}</div>
          <div class="enspeak-sent-zh">${escapeHtml(f.zh)}</div>
        </button>`;
      })
      .join("");
  }

  function openFrame(id) {
    const f = (CONTENT.frames || []).find((x) => x.id === id);
    const box = $("#enspeak-frame-detail");
    const title = $("#enspeak-frame-detail-title");
    const body = $("#enspeak-frame-detail-body");
    if (!f || !box || !body) return;
    box.hidden = false;
    title.textContent = f.en;
    const slotVal = state.profile[f.slot] || "";
    body.innerHTML = `
      <p class="hint">${escapeHtml(f.zh)}</p>
      <label class="enspeak-field">槽位「${escapeHtml(f.slot)}」
        <input class="text-input" id="enspeak-frame-slot" value="${escapeAttr(slotVal)}" placeholder="${escapeAttr((f.examples || [])[0] || "")}" />
      </label>
      <div class="btn-row tool-actions">
        <button type="button" class="primary-btn" id="enspeak-frame-gen">生成变体并朗读</button>
      </div>
      <div id="enspeak-frame-variants" class="enspeak-sent-list"></div>
    `;
    $("#enspeak-frame-gen")?.addEventListener("click", () => {
      const val = $("#enspeak-frame-slot")?.value?.trim() || "";
      if (val) {
        state.profile[f.slot] = val;
        saveState();
      }
      const variants = (f.examples || []).slice(0, 10).map((ex) => fillTemplate(f.en, { [f.slot]: val || ex }));
      if (val) variants.unshift(fillTemplate(f.en, { [f.slot]: val }));
      const uniq = [...new Set(variants)].slice(0, 10);
      const wrap = $("#enspeak-frame-variants");
      if (wrap) {
        wrap.innerHTML = uniq
          .map(
            (line) => `<button type="button" class="enspeak-sent" data-say="${escapeAttr(line)}">
              <div class="enspeak-sent-en">${escapeHtml(line)}</div>
            </button>`
          )
          .join("");
        wrap.onclick = (e) => {
          const b = e.target.closest("[data-say]");
          if (b) speakText(b.dataset.say);
        };
      }
      if (uniq[0]) speakText(uniq[0]);
    });
  }

  function renderReplyTab() {
    const card = $("#enspeak-reply-card");
    if (!card) return;
    const pool = [...replies(), ...lifelines()];
    const s = pool[Math.floor(Math.random() * pool.length)];
    if (!s) return;
    card.innerHTML = `<div class="enspeak-sent-en">${escapeHtml(displayEn(s))}</div>
      <div class="enspeak-sent-zh">${escapeHtml(s.zh)}</div>
      <div class="btn-row tool-actions">
        <button type="button" class="ghost-btn" id="enspeak-reply-speak">朗读</button>
        <button type="button" class="primary-btn" id="enspeak-reply-spoken" data-sid="${s.id}">已开口</button>
      </div>`;
    $("#enspeak-reply-speak")?.addEventListener("click", () => speakText(displayEn(s)));
    $("#enspeak-reply-spoken")?.addEventListener("click", () => {
      markSpoken(s.id);
      markStatus(s.id, "spoken");
      toast("接话已记开口");
    });
  }

  function renderProfileForm() {
    const form = $("#enspeak-profile-form");
    if (!form) return;
    form.innerHTML = (CONTENT.profileFields || [])
      .map((f) => {
        return `<label class="enspeak-field">${escapeHtml(f.label)}
          <input class="text-input" name="${escapeAttr(f.key)}" value="${escapeAttr(state.profile[f.key] || "")}" placeholder="${escapeAttr(f.placeholder || "")}" />
        </label>`;
      })
      .join("");
  }

  function renderReview() {
    const el = $("#enspeak-review");
    if (!el) return;
    const spokenToday = state.today.spokenIds.length;
    const flex = (CONTENT.sentences || []).filter((s) => getStatus(s.id) === "flexible").length;
    const spoken = (CONTENT.sentences || []).filter((s) => ["spoken", "flexible"].includes(getStatus(s.id))).length;
    const ratio = starterFlexibleRatio();
    el.innerHTML = `
      <div>今日开口：${spokenToday} 句 · 达标：${goalReached() ? "是" : "尚未"}</div>
      <div>累计能开口/变形：${spoken} · 其中能变形：${flex}</div>
      <div>起步岛进度：${Math.round(ratio * 100)}% ${extensionsUnlocked() ? "（扩展岛已解锁）" : "（约 70% 解锁扩展岛）"}</div>
      <div class="enspeak-progress-bar" aria-hidden="true"><span style="width:${Math.min(100, Math.round(ratio * 100))}%"></span></div>
      <div>连续达标：${state.streak || 0} 天</div>
    `;
  }

  function renderSos() {
    const list = $("#enspeak-sos-list");
    if (!list) return;
    list.innerHTML = lifelines()
      .map((s) => {
        return `<button type="button" class="enspeak-sent" data-sid="${s.id}">
          <div class="enspeak-sent-en">${escapeHtml(displayEn(s))}</div>
          <div class="enspeak-sent-zh">${escapeHtml(s.zh)}</div>
        </button>`;
      })
      .join("");
  }

  function openSentenceDialog(id) {
    const s = sentenceById(id);
    const dlg = $("#enspeak-sent-dialog");
    if (!s || !dlg) return;
    activeSentenceId = id;
    $("#enspeak-dlg-en").textContent = displayEn(s);
    $("#enspeak-dlg-zh").textContent = s.zh;
    $("#enspeak-dlg-mine").value = state.sentences[id]?.myVersion || displayEn(s);
    $("#enspeak-dlg-status").textContent = `状态：${statusLabel(getStatus(id))}`;
    $("#enspeak-dlg-play").hidden = true;
    if (recordedUrl) {
      URL.revokeObjectURL(recordedUrl);
      recordedUrl = "";
    }
    dlg.showModal();
    markStatus(id, "practicing");
  }

  function bindDialog() {
    $("#enspeak-dlg-speak")?.addEventListener("click", () => {
      speakText($("#enspeak-dlg-mine")?.value || "");
    });
    $("#enspeak-dlg-spoken")?.addEventListener("click", () => {
      const id = activeSentenceId;
      const mine = $("#enspeak-dlg-mine")?.value?.trim() || "";
      if (mine) setSentencePatch(id, { myVersion: mine });
      markSpoken(id);
      $("#enspeak-dlg-status").textContent = "已记：今日真实开口";
      toast("已记开口");
    });
    $("#enspeak-dlg-rec")?.addEventListener("click", async () => {
      const btn = $("#enspeak-dlg-rec");
      if (mediaRecorder && mediaRecorder.state === "recording") {
        mediaRecorder.stop();
        btn.textContent = "录音";
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recordedChunks = [];
        mediaRecorder = new MediaRecorder(stream);
        mediaRecorder.ondataavailable = (ev) => {
          if (ev.data?.size) recordedChunks.push(ev.data);
        };
        mediaRecorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = new Blob(recordedChunks, { type: "audio/webm" });
          if (recordedUrl) URL.revokeObjectURL(recordedUrl);
          recordedUrl = URL.createObjectURL(blob);
          const audio = $("#enspeak-dlg-audio");
          const play = $("#enspeak-dlg-play");
          if (audio) {
            audio.src = recordedUrl;
            audio.hidden = false;
          }
          if (play) play.hidden = false;
          $("#enspeak-dlg-status").textContent = "录音已保存（仅本机，可回放）";
        };
        mediaRecorder.start();
        btn.textContent = "停止";
        $("#enspeak-dlg-status").textContent = "录音中…";
      } catch (_) {
        toast("无法录音：请检查麦克风权限，或改为自言自语后点「已开口」");
      }
    });
    $("#enspeak-dlg-play")?.addEventListener("click", () => {
      $("#enspeak-dlg-audio")?.play?.();
    });
    $("#enspeak-sent-dialog")?.addEventListener("close", () => {
      const id = activeSentenceId;
      const mine = $("#enspeak-dlg-mine")?.value?.trim();
      if (id && mine) {
        const fills = new Set(state.sentences[id]?.fills || []);
        fills.add(mine.toLowerCase());
        setSentencePatch(id, {
          myVersion: mine,
          fills: [...fills],
          status: fills.size >= 3 ? "flexible" : getStatus(id) === "new" ? "practicing" : getStatus(id),
        });
      }
      renderAll();
    });
  }

  function escapeHtml(s) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, "&#39;");
  }

  function renderAll() {
    ensureToday();
    renderTodayMeta();
    renderBlocks();
    renderIslands();
    renderFrames();
    renderProfileForm();
    renderReview();
    renderSos();
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), state }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `enspeak-progress-${todayKey()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || ""));
        const next = data.state || data;
        if (!next || typeof next !== "object") throw new Error("bad");
        state = { ...defaultState(), ...next, today: { ...defaultState().today, ...(next.today || {}) } };
        saveState();
        renderAll();
        toast("进度已导入");
      } catch (_) {
        toast("导入失败：JSON 无效");
      }
    };
    reader.readAsText(file);
  }

  function printWeekSheet() {
    const focus = weekPlan()?.focus || ["who"];
    const lines = (CONTENT.sentences || [])
      .filter((s) => focus.includes(s.island) || s.role === "lifeline")
      .slice(0, 24);
    const html = `<!doctype html><meta charset="utf-8" /><title>日常开口·本周</title>
      <body style="font-family:system-ui;padding:24px;line-height:1.5">
      <h1>日常开口 · 第 ${weekPlan()?.week || 1} 周</h1>
      <p>${escapeHtml(weekPlan()?.title || "")} — 没说出口，不算会</p>
      <ol>${lines
        .map((s) => `<li><strong>${escapeHtml(displayEn(s))}</strong><br/><span>${escapeHtml(s.zh)}</span></li>`)
        .join("")}</ol>
      <script>print()</script></body>`;
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  }

  function runPseudoDialogue() {
    const island = activeIsland;
    const lines = CONTENT.dialogues?.[island] || CONTENT.dialogues?.who;
    if (!lines?.length) {
      toast("当前岛暂无伪对话，试试「我是谁 / 今天 / 喜好 / 接话」");
      return;
    }
    openDrill("listen");
    state.today.listen.island = ["who", "today", "likes", "reply"].includes(island) ? island : state.today.listen.island;
    saveState();
    switchTab("today");
    openDrill("listen");
    toast("已打开听跟/伪对话：你重点练 B 侧");
  }

  function bindUi() {
    if (bound) return;
    bound = true;

    $$(".enspeak-tab").forEach((btn) => {
      btn.addEventListener("click", () => {
        switchTab(btn.dataset.tab);
        if (btn.dataset.tab === "reply") renderReplyTab();
        if (btn.dataset.tab === "more") renderReview();
      });
    });

    $("#enspeak-blocks")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-block]");
      if (b) openDrill(b.dataset.block);
    });

    $("#enspeak-start-today")?.addEventListener("click", () => {
      ensureToday();
      if (!state.today.newIds?.length) {
        state.today.newIds = pickTodayNew(6);
        saveState();
      }
      openDrill(state.today.blocks.listen ? (state.today.blocks.reword ? (state.today.blocks.reply ? "output" : "reply") : "reword") : "listen");
    });

    $("#enspeak-drill-close")?.addEventListener("click", () => {
      const d = $("#enspeak-drill");
      if (d) d.hidden = true;
    });

    $("#enspeak-sos")?.addEventListener("click", () => {
      const box = $("#enspeak-sos-box");
      if (box) box.hidden = !box.hidden;
      if (box && !box.hidden) renderSos();
    });

    $("#enspeak-sos-list")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-sid]");
      if (b) openSentenceDialog(b.dataset.sid);
    });

    $("#enspeak-island-map")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-island]");
      if (!b) return;
      if (b.dataset.locked) {
        toast("起步四岛「能开口/变形」约 70% 后解锁扩展岛");
        return;
      }
      activeIsland = b.dataset.island;
      renderIslands();
    });

    $("#enspeak-island-list")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-sid]");
      if (b) openSentenceDialog(b.dataset.sid);
    });

    $("#enspeak-pseudo")?.addEventListener("click", runPseudoDialogue);

    $("#enspeak-frame-grid")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-fid]");
      if (b) openFrame(b.dataset.fid);
    });

    $("#enspeak-reply-draw")?.addEventListener("click", renderReplyTab);
    $("#enspeak-reply-all")?.addEventListener("click", () => {
      const list = $("#enspeak-reply-list");
      if (!list) return;
      list.hidden = !list.hidden;
      if (!list.hidden) {
        list.innerHTML = [...replies(), ...lifelines()]
          .map((s) => `<button type="button" class="enspeak-sent" data-sid="${s.id}">
            <div class="enspeak-sent-en">${escapeHtml(displayEn(s))}</div>
            <div class="enspeak-sent-zh">${escapeHtml(s.zh)}</div>
          </button>`)
          .join("");
      }
    });
    $("#enspeak-reply-list")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-sid]");
      if (b) openSentenceDialog(b.dataset.sid);
    });

    $("#enspeak-profile-form")?.addEventListener("submit", (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      for (const [k, v] of fd.entries()) state.profile[k] = String(v || "").trim();
      saveState();
      toast("生活档案已保存");
      renderAll();
    });

    $("#enspeak-export")?.addEventListener("click", exportJson);
    $("#enspeak-import")?.addEventListener("change", (e) => {
      const f = e.target.files?.[0];
      if (f) importJson(f);
      e.target.value = "";
    });
    $("#enspeak-print")?.addEventListener("click", printWeekSheet);
    $("#enspeak-reset")?.addEventListener("click", () => {
      if (!confirm("清空本机开口进度？句库不受影响。")) return;
      state = defaultState();
      state.installDate = todayKey();
      saveState();
      renderAll();
      toast("进度已清空");
    });

    bindDialog();
  }

  async function boot() {
    const root = document.getElementById(TOOL_ID);
    if (!root) return;
    try {
      await loadContent();
    } catch (err) {
      const body = root.querySelector(".panel-body");
      if (body) body.innerHTML = `<p class="hint">句库加载失败：${escapeHtml(err.message || err)}</p>`;
      return;
    }
    state = loadState();
    ensureToday();
    activeIsland = focusIslandId();
    bindUi();
    renderAll();
    try {
      window.speechSynthesis?.getVoices?.();
    } catch (_) {}
  }

  window.addEventListener("devtools:route", (e) => {
    if (String(e.detail?.tool || "") === TOOL_ID) void boot();
  });

  if (document.getElementById(TOOL_ID)?.classList.contains("is-workspace-active")) {
    void boot();
  }
})();
