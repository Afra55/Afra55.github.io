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
  let activeFrameGroup = "chat";
  let mediaRecorder = null;
  let recordedChunks = [];
  let recordedUrl = "";
  let bound = false;
  /** @type {ReturnType<typeof setInterval>|null} */
  let blindTimer = null;
  let activeFrameId = "";
  let islandChainIds = [];
  let islandChainIdx = 0;

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

  function fillApi() {
    return window.DevToolsEnspeakFill || null;
  }

  function fillTemplate(text, extra = {}) {
    const map = { ...(state.profile || {}), ...extra };
    const api = fillApi();
    if (api?.fillEnTemplate) return api.fillEnTemplate(text, map);
    // 兜底（fill 库未加载时）：至少 trim，避免残留 {slot}
    return String(text || "").replace(/\{([a-z0-9_]+)\}/gi, (_, key) => {
      const v = map[key];
      if (v != null && String(v).trim()) return String(v).trim();
      return "";
    });
  }

  function variantZhFor(frameZh, fillEn, fillZh) {
    const api = fillApi();
    if (api?.variantZhLine) return api.variantZhLine(frameZh, fillEn, fillZh);
    const zh = String(frameZh || "").trim();
    const zf = String(fillZh || "").trim();
    if (!zh) return zf || "";
    if (!zf) return zh;
    if (/……|\.\.\.|…/.test(zh)) return zh.replace(/……|\.\.\.|…/g, zf).replace(/\s{2,}/g, " ").trim();
    if (zh.includes(zf)) return zh;
    const m = zh.match(/^(.*?)([？?。！!]*)$/);
    if (m) return `${m[1]}（${zf}）${m[2] || ""}`;
    return `${zh}（${zf}）`;
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

  function historyDay(key = todayKey()) {
    if (!state.history[key] || typeof state.history[key] !== "object") {
      state.history[key] = {};
    }
    const h = state.history[key];
    if (!h.selfEval || typeof h.selfEval !== "object") h.selfEval = { smooth: 0, sticky: 0, again: 0 };
    return h;
  }

  function bumpHistory(patch = {}) {
    const h = historyDay();
    if (patch.spokenDelta) h.spoken = (h.spoken || 0) + patch.spokenDelta;
    if (patch.recordedDelta) h.recorded = (h.recorded || 0) + patch.recordedDelta;
    if (patch.eval) {
      const k = patch.eval;
      if (k === "smooth" || k === "sticky" || k === "again") {
        h.selfEval[k] = (h.selfEval[k] || 0) + 1;
      }
    }
    if (patch.goal) h.goal = true;
  }

  function markSpoken(id) {
    ensureToday();
    const rec = state.sentences[id] || {};
    const fills = new Set(rec.fills || []);
    if (rec.myVersion?.trim()) fills.add(rec.myVersion.trim().toLowerCase());
    let status = "spoken";
    if (fills.size >= 3) status = "flexible";
    const firstToday = !state.today.spokenIds.includes(id);
    setSentencePatch(id, {
      status,
      fills: [...fills],
      spokenCount: (rec.spokenCount || 0) + 1,
      lastSpoken: todayKey(),
    });
    if (firstToday) state.today.spokenIds.push(id);
    bumpHistory({ spokenDelta: 1 });
    if (state.today.spokenIds.length >= (CONTENT?.method?.mustSpeak || 2)) {
      state.today.blocks.output = true;
    }
    maybeCompleteGoal();
    saveState();
    renderAll();
  }

  function recordSelfEval(kind) {
    const id = activeSentenceId;
    bumpHistory({ eval: kind });
    if (id) {
      setSentencePatch(id, { lastEval: kind, lastEvalAt: todayKey() });
    }
    if (kind === "again") {
      saveState();
      $("#enspeak-dlg-status").textContent = "再练：先听示范，再说一遍自己的版本";
      toast("再练一次 · 先听再开口");
      const line = $("#enspeak-dlg-mine")?.value || $("#enspeak-dlg-en")?.textContent || "";
      if (line) speakText(line);
      renderCheckin();
      return;
    }
    if (id) {
      const mine = $("#enspeak-dlg-mine")?.value?.trim() || "";
      if (mine) setSentencePatch(id, { myVersion: mine });
      if (!state.today.spokenIds.includes(id)) markSpoken(id);
      else {
        saveState();
        renderReview();
      }
    } else {
      saveState();
      renderReview();
    }
    const label = kind === "smooth" ? "流畅" : "卡了一下";
    $("#enspeak-dlg-status").textContent = `已记开口 · 自评：${label}`;
    toast(`已记 · ${label}`);
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
      bumpHistory({ goal: true });
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
    if (hint) {
      hint.textContent =
        plan?.hint || "今日按 听→裂变→接话→无稿开口；架子换词时变体带中文，说出口再勾完成。";
    }
  }

  function renderBlocks() {
    const box = $("#enspeak-blocks");
    if (!box) return;
    const items = [
      { id: "listen", title: "①听跟", time: "8′", desc: "输入：听清再跟读" },
      { id: "reword", title: "②裂变", time: "10′", desc: "加工：架子换词成自己的" },
      { id: "reply", title: "③接话", time: "8′", desc: "加工：Really? / Same here" },
      { id: "output", title: "④无稿开口", time: "5～8′", desc: "输出：真实情况说出口" },
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
      title.textContent = "裂变 · 词块换词（会一个→会一类）";
      body.innerHTML = renderRewordDrill();
      bindRewordDrill(body);
    } else if (block === "reply") {
      title.textContent = "接话 · 软着陆短句";
      body.innerHTML = renderReplyDrill();
      bindReplyDrill(body);
    } else if (block === "output") {
      title.textContent = "无稿开口 · 说出口才算会";
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

  function frameGroups() {
    const fallback = [
      { id: "chat", name: "日常对话", blurb: "寒暄开场、澄清、道谢、收尾" },
      { id: "self", name: "自我表达", blurb: "身份、今天、喜好" },
      { id: "ask", name: "提问架子", blurb: "问对方、请求帮助" },
      { id: "soft", name: "软着陆", blurb: "抱歉、想法、拖延、同感" },
    ];
    const list = CONTENT.frameGroups?.length ? CONTENT.frameGroups : fallback;
    return [{ id: "all", name: "全部", blurb: "所有架子" }, ...list];
  }

  function renderFrameFilters() {
    const wrap = $("#enspeak-frame-filters");
    if (!wrap) return;
    const groups = frameGroups();
    if (!groups.some((g) => g.id === activeFrameGroup)) activeFrameGroup = groups[0]?.id || "all";
    wrap.innerHTML = groups
      .map((g) => {
        const n =
          g.id === "all"
            ? (CONTENT.frames || []).length
            : (CONTENT.frames || []).filter((f) => (f.group || "self") === g.id).length;
        const on = g.id === activeFrameGroup;
        return `<button type="button" class="ghost-btn enspeak-frame-filter${on ? " is-active" : ""}" data-fgroup="${escapeAttr(g.id)}" role="tab" aria-selected="${on ? "true" : "false"}" title="${escapeAttr(g.blurb || "")}">${escapeHtml(g.name)} · ${n}</button>`;
      })
      .join("");
  }

  function renderFrames() {
    const grid = $("#enspeak-frame-grid");
    if (!grid) return;
    renderFrameFilters();
    const frames = (CONTENT.frames || []).filter((f) => {
      if (activeFrameGroup === "all") return true;
      return (f.group || "self") === activeFrameGroup;
    });
    if (!frames.length) {
      grid.innerHTML = `<p class="hint tight">这一组还没有架子，可在句库里继续补。</p>`;
      return;
    }
    grid.innerHTML = frames
      .map((f) => {
        return `<button type="button" class="enspeak-frame-btn" data-fid="${f.id}">
          <div class="enspeak-sent-en">${escapeHtml(f.en)}</div>
          <div class="enspeak-sent-zh">${escapeHtml(f.zh)}</div>
        </button>`;
      })
      .join("");
  }

  function frameExampleFills(f) {
    return (f.examples || []).map((ex) => {
      if (ex && typeof ex === "object") return String(ex.en ?? ex.fill ?? "").trim();
      return String(ex ?? "").trim();
    });
  }

  function frameExampleZhFills(f) {
    const ex = f.examples || [];
    const ez = Array.isArray(f.examplesZh) ? f.examplesZh : [];
    return ex.map((_, i) => String(ez[i] || "").trim());
  }

  function clearBlindTimer() {
    if (blindTimer) {
      clearInterval(blindTimer);
      blindTimer = null;
    }
  }

  function framesInActiveGroup() {
    return (CONTENT.frames || []).filter((fr) => {
      if (activeFrameGroup === "all") return true;
      return (fr.group || "self") === activeFrameGroup;
    });
  }

  function openFrame(id) {
    const f = (CONTENT.frames || []).find((x) => x.id === id);
    const box = $("#enspeak-frame-detail");
    const title = $("#enspeak-frame-detail-title");
    const body = $("#enspeak-frame-detail-body");
    if (!f || !box || !body) return;
    clearBlindTimer();
    activeFrameId = f.id;
    box.hidden = false;
    title.textContent = f.en;
    const slotVal = state.profile[f.slot] || "";
    const fillsEn = frameExampleFills(f);
    const fillsZh = frameExampleZhFills(f);
    const ph = fillsEn[0] || "";
    const groupFrames = framesInActiveGroup();
    const idxInGroup = Math.max(0, groupFrames.findIndex((x) => x.id === f.id));
    body.innerHTML = `
      <p class="hint">${escapeHtml(f.zh)}</p>
      <p class="hint tight">方法：听示范 → 换槽位裂变 → 无稿开口（倒计时后再揭晓）</p>
      <label class="enspeak-field">槽位「${escapeHtml(f.slot)}」
        <input class="text-input" id="enspeak-frame-slot" value="${escapeAttr(slotVal)}" placeholder="${escapeAttr(ph)}" autocomplete="off" />
      </label>
      <div id="enspeak-frame-variants" class="enspeak-sent-list"></div>
      <p class="hint tight enspeak-blind-status" id="enspeak-blind-status" hidden></p>
      <div class="enspeak-frame-dock" id="enspeak-frame-dock">
        <div class="btn-row tool-actions enspeak-action-row">
          <button type="button" class="primary-btn" id="enspeak-frame-gen">生成变体</button>
          <button type="button" class="ghost-btn" id="enspeak-frame-blind" hidden>无稿开口</button>
          <button type="button" class="ghost-btn" id="enspeak-frame-reveal" hidden>立刻揭晓</button>
          <button type="button" class="primary-btn" id="enspeak-frame-next">下一句</button>
        </div>
        <p class="hint tight enspeak-frame-dock-meta">${idxInGroup + 1}/${groupFrames.length || 1} · ${escapeHtml(f.group || "")}</p>
      </div>
    `;
    const zhForFill = (fill) => {
      const i = fillsEn.findIndex((x) => x === fill);
      if (i >= 0 && fillsZh[i]) return fillsZh[i];
      return "";
    };
    const setBlindUi = (on, leftSec) => {
      const wrap = $("#enspeak-frame-variants");
      const blindBtn = $("#enspeak-frame-blind");
      const revealBtn = $("#enspeak-frame-reveal");
      const status = $("#enspeak-blind-status");
      if (wrap) wrap.classList.toggle("is-blind", !!on);
      if (blindBtn) blindBtn.textContent = on ? "显示英文" : "无稿开口";
      if (revealBtn) revealBtn.hidden = !on;
      if (status) {
        if (on && leftSec != null) {
          status.hidden = false;
          status.textContent = leftSec > 0 ? `先自己说 · ${leftSec} 秒后揭晓英文` : "时间到 · 对照英文";
        } else {
          status.hidden = true;
          status.textContent = "";
        }
      }
    };
    const stopBlind = (reveal) => {
      clearBlindTimer();
      setBlindUi(false);
      if (reveal) toast("已揭晓，对照听一遍");
    };
    const startBlindCountdown = () => {
      clearBlindTimer();
      const secs = 5 + Math.floor(Math.random() * 4); // 5～8
      let left = secs;
      setBlindUi(true, left);
      toast(`先看中文意图，自己开口 · ${secs} 秒后揭晓`);
      blindTimer = setInterval(() => {
        left -= 1;
        if (left <= 0) {
          clearBlindTimer();
          setBlindUi(false);
          toast("时间到 · 对照英文，点「听」校对");
          return;
        }
        setBlindUi(true, left);
      }, 1000);
    };
    const renderVariants = (preferFill) => {
      const val = $("#enspeak-frame-slot")?.value?.trim() || preferFill || "";
      if (val) {
        state.profile[f.slot] = val;
        saveState();
      }
      const fills = [];
      if (val) fills.push(val);
      for (const ex of fillsEn) {
        if (ex && !fills.includes(ex)) fills.push(ex);
        if (fills.length >= 10) break;
      }
      if (!fills.length) fills.push("");
      const pairs = [];
      const seen = new Set();
      for (const fill of fills) {
        const en = fillTemplate(f.en, { [f.slot]: fill });
        if (!en || seen.has(en)) continue;
        seen.add(en);
        pairs.push({ en, zh: variantZhFor(f.zh, fill, zhForFill(fill)), fill });
      }
      const wrap = $("#enspeak-frame-variants");
      const blindBtn = $("#enspeak-frame-blind");
      if (blindBtn) blindBtn.hidden = pairs.length === 0;
      stopBlind(false);
      if (wrap) {
        wrap.innerHTML = pairs
          .map(
            (p, i) => `<div class="enspeak-sent enspeak-variant" data-say="${escapeAttr(p.en)}" data-idx="${i}">
              <div class="enspeak-sent-en">${escapeHtml(p.en)}</div>
              <div class="enspeak-sent-zh">${escapeHtml(p.zh)}</div>
              <div class="btn-row tool-actions enspeak-variant-acts">
                <button type="button" class="ghost-btn" data-vact="hear">听</button>
                <button type="button" class="ghost-btn" data-vact="shadow">跟读</button>
                <button type="button" class="primary-btn" data-vact="spoken">已开口</button>
              </div>
            </div>`
          )
          .join("");
        wrap.onclick = (e) => {
          const actBtn = e.target.closest("[data-vact]");
          const card = e.target.closest(".enspeak-variant");
          if (!card) return;
          const line = card.dataset.say || "";
          const act = actBtn?.dataset.vact;
          if (act === "spoken") {
            toast("裂变句已记开口（继续换词再说一句）");
            return;
          }
          if (act === "shadow" || act === "hear" || !actBtn) {
            if (line) speakText(line);
          }
        };
      }
      return pairs;
    };

    $("#enspeak-frame-gen")?.addEventListener("click", () => {
      const pairs = renderVariants();
      if (pairs[0]?.en) speakText(pairs[0].en);
    });
    $("#enspeak-frame-blind")?.addEventListener("click", () => {
      const wrap = $("#enspeak-frame-variants");
      if (!wrap) return;
      if (wrap.classList.contains("is-blind")) {
        stopBlind(true);
        return;
      }
      startBlindCountdown();
    });
    $("#enspeak-frame-reveal")?.addEventListener("click", () => stopBlind(true));
    $("#enspeak-frame-next")?.addEventListener("click", () => {
      const list = framesInActiveGroup();
      if (!list.length) return;
      const i = list.findIndex((x) => x.id === f.id);
      const next = list[(i + 1) % list.length];
      if (next) openFrame(next.id);
    });
    // 打开即出一版变体，方便手机少点一次
    renderVariants(slotVal);
    try {
      box.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (_) {}
  }

  /** 开场→追问→接话→收尾；无标签时退回伪对话 / 前几句 */
  function buildIslandChain(islandId) {
    const lines = sentencesForIsland(islandId).filter((s) => s.role !== "prompt");
    const roles = ["opener", "ask", "reply", "closer"];
    const labels = { opener: "开场", ask: "追问", reply: "接话", closer: "收尾" };
    const picked = [];
    const used = new Set();
    for (const tag of roles) {
      const pool = lines.filter((s) => (s.tags || []).includes(tag) && !used.has(s.id));
      if (pool.length) {
        const s = pool[Math.floor(Math.random() * pool.length)];
        used.add(s.id);
        picked.push({ tag, label: labels[tag], sent: s });
      }
    }
    if (picked.length >= 3) return picked;
    const dlg = CONTENT.dialogues?.[islandId] || [];
    if (dlg.length >= 3) {
      return dlg.slice(0, 4).map((line, i) => ({
        tag: roles[Math.min(i, roles.length - 1)],
        label: labels[roles[Math.min(i, roles.length - 1)]],
        sent: {
          id: `dlg-${islandId}-${i}`,
          en: fillTemplate(line.text),
          zh: line.zh || `伪对话 · ${line.speaker || "A/B"}`,
          island: islandId,
        },
        synthetic: true,
      }));
    }
    return lines.slice(0, 4).map((s, i) => ({
      tag: roles[Math.min(i, roles.length - 1)],
      label: labels[roles[Math.min(i, roles.length - 1)]],
      sent: s,
    }));
  }

  function renderIslandChain() {
    const box = $("#enspeak-chain-box");
    const steps = $("#enspeak-chain-steps");
    const hint = $("#enspeak-chain-hint");
    if (!box || !steps) return;
    if (!islandChainIds.length) {
      box.hidden = true;
      return;
    }
    box.hidden = false;
    const cur = islandChainIds[islandChainIdx];
    if (hint) {
      hint.textContent = `对话链 · ${islandName(activeIsland)} · 第 ${islandChainIdx + 1}/${islandChainIds.length} 环（${cur.label}）`;
    }
    steps.innerHTML = islandChainIds
      .map((step, i) => {
        const on = i === islandChainIdx;
        const en = step.synthetic ? step.sent.en : displayEn(step.sent);
        const zh = step.sent.zh || "";
        return `<button type="button" class="enspeak-chain-step ${on ? "is-active" : ""}" data-cidx="${i}">
          <span class="enspeak-chain-kicker">${escapeHtml(step.label)}</span>
          <span class="enspeak-sent-zh">${escapeHtml(zh)}</span>
          <span class="enspeak-sent-en enspeak-chain-en">${escapeHtml(en)}</span>
        </button>`;
      })
      .join("");
  }

  function startIslandChain() {
    const chain = buildIslandChain(activeIsland);
    if (!chain.length) {
      toast("当前岛句子太少，先练单句或换岛");
      return;
    }
    islandChainIds = chain;
    islandChainIdx = 0;
    renderIslandChain();
    try {
      $("#enspeak-chain-box")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch (_) {}
    toast("对话链已就绪：先说中文意图对应的英文");
  }

  function currentChainLine() {
    const step = islandChainIds[islandChainIdx];
    if (!step) return "";
    return step.synthetic ? step.sent.en : displayEn(step.sent);
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
    const todayH = state.history[todayKey()] || {};
    const se = todayH.selfEval || {};
    el.innerHTML = `
      <div>今日开口：${spokenToday} 句 · 达标：${goalReached() ? "是" : "尚未"}</div>
      <div>今日自评：流畅 ${se.smooth || 0} · 卡壳 ${se.sticky || 0} · 再练 ${se.again || 0}${todayH.recorded ? ` · 录音 ${todayH.recorded}` : ""}</div>
      <div>累计能开口/变形：${spoken} · 其中能变形：${flex}</div>
      <div>起步岛进度：${Math.round(ratio * 100)}% ${extensionsUnlocked() ? "（扩展岛已解锁）" : "（约 70% 解锁扩展岛）"}</div>
      <div class="enspeak-progress-bar" aria-hidden="true"><span style="width:${Math.min(100, Math.round(ratio * 100))}%"></span></div>
      <div>连续达标：${state.streak || 0} 天</div>
    `;
    renderCheckin();
  }

  function renderCheckin() {
    const el = $("#enspeak-checkin");
    if (!el) return;
    const days = [];
    const now = new Date();
    for (let i = 27; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const key = todayKey(d);
      const h = state.history[key] || {};
      const spokenN = h.spoken || 0;
      const goal = !!h.goal;
      let cls = "is-empty";
      if (goal) cls = "is-goal";
      else if (spokenN > 0) cls = "is-spoken";
      const title = goal
        ? `${key} · 达标 · 开口 ${spokenN || "✓"}`
        : spokenN
          ? `${key} · 开口 ${spokenN} 句 · 未达标`
          : `${key} · 未练`;
      days.push(
        `<button type="button" class="enspeak-checkin-day ${cls}" data-day="${escapeAttr(key)}" title="${escapeAttr(title)}" aria-label="${escapeAttr(title)}"><span>${d.getDate()}</span></button>`
      );
    }
    el.innerHTML = `
      <div class="enspeak-checkin-head hint tight">近 28 天打卡</div>
      <div class="enspeak-checkin-grid">${days.join("")}</div>
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
      $("#enspeak-dlg-status").textContent = "已记：今日真实开口 · 可再点自评";
      toast("已记开口");
    });
    $("#enspeak-dlg-eval")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-eval]");
      if (!b) return;
      recordSelfEval(b.dataset.eval);
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
          bumpHistory({ recordedDelta: 1 });
          saveState();
          $("#enspeak-dlg-status").textContent = "录音已保存（仅本机）· 回放后点自评或「已开口」";
          renderCheckin();
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
    const lines = CONTENT.dialogues?.[island];
    if (!lines?.length) {
      toast("当前岛暂无伪对话，换一个岛或先练对话链");
      return;
    }
    // 听跟段优先切到当前岛（各岛均有伪对话）
    state.today.listen.island = island;
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
      islandChainIds = [];
      islandChainIdx = 0;
      const chainBox = $("#enspeak-chain-box");
      if (chainBox) chainBox.hidden = true;
      renderIslands();
    });

    $("#enspeak-island-list")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-sid]");
      if (b) openSentenceDialog(b.dataset.sid);
    });

    $("#enspeak-chain")?.addEventListener("click", startIslandChain);
    $("#enspeak-chain-steps")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-cidx]");
      if (!b) return;
      islandChainIdx = Number(b.dataset.cidx) || 0;
      renderIslandChain();
    });
    $("#enspeak-chain-hear")?.addEventListener("click", () => {
      const line = currentChainLine();
      if (line) speakText(line);
    });
    $("#enspeak-chain-next")?.addEventListener("click", () => {
      if (!islandChainIds.length) {
        startIslandChain();
        return;
      }
      if (islandChainIdx >= islandChainIds.length - 1) {
        toast("本轮对话链走完了 · 可再抽一串或换岛");
        startIslandChain();
        return;
      }
      islandChainIdx += 1;
      renderIslandChain();
    });
    $("#enspeak-chain-spoken")?.addEventListener("click", () => {
      const step = islandChainIds[islandChainIdx];
      if (!step) return;
      if (!step.synthetic && step.sent?.id) {
        markSpoken(step.sent.id);
        toast("这一环已记开口");
      } else {
        toast("伪对话环已记开口（不计句库进度）");
      }
      if (islandChainIdx < islandChainIds.length - 1) {
        islandChainIdx += 1;
        renderIslandChain();
      }
    });

    $("#enspeak-pseudo")?.addEventListener("click", runPseudoDialogue);

    $("#enspeak-frame-filters")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-fgroup]");
      if (!b) return;
      activeFrameGroup = b.dataset.fgroup || "all";
      renderFrames();
    });

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

    $("#enspeak-checkin")?.addEventListener("click", (e) => {
      const b = e.target.closest("[data-day]");
      if (!b) return;
      const key = b.dataset.day;
      const h = state.history[key] || {};
      const se = h.selfEval || {};
      if (h.goal) {
        toast(`${key} · 达标 · 开口 ${h.spoken || "✓"} · 流畅${se.smooth || 0}/卡壳${se.sticky || 0}`);
      } else if (h.spoken) {
        toast(`${key} · 开口 ${h.spoken} 句 · 未达标 · 再练${se.again || 0}`);
      } else {
        toast(`${key} · 未练`);
      }
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
