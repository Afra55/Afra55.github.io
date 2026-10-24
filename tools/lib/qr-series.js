(() => {
  "use strict";

  /**
   * 生码分片格式：`[i/n]正文`
   * - 同套：同 n，且已有片内容相容 → 累加拼接
   * - 另一套：不同 n，或同 n 但同序号正文冲突 → 新开会话，互不合并
   * - 无此前缀 → 独立码，绝不拼进正文
   */
  const PART_RE = /^\[(\d+)\/(\d+)\]([\s\S]*)$/;
  const GAP_MARK = (i) => `【缺第${i}片】`;
  let _sid = 1;

  function parsePart(text) {
    const m = String(text ?? "").match(PART_RE);
    if (!m) return null;
    const index = Number(m[1]);
    const total = Number(m[2]);
    if (!Number.isInteger(index) || !Number.isInteger(total)) return null;
    if (total < 2 || total > 98 || index < 1 || index > total) return null;
    return { index, total, body: m[3] };
  }

  /** @deprecated 单组分类；新逻辑请用 ingestTexts / classifyAll */
  function classifyTexts(texts) {
    const all = classifyAll(texts);
    const best = all.groups[0] || null;
    const stray = [];
    for (let i = 1; i < all.groups.length; i += 1) {
      for (const item of all.groups[i].parts.values()) stray.push(item.text);
    }
    return {
      seriesTotal: best ? best.total : 0,
      seriesParts: best ? best.parts : new Map(),
      plain: all.plain.concat(stray),
      hasSeries: Boolean(best && best.parts.size > 0),
      groups: all.groups,
    };
  }

  /** 按 n 分组（同 n 多套在 ingest 时再按内容拆） */
  function classifyAll(texts) {
    const list = (texts || []).map((t) => String(t ?? ""));
    const parsed = [];
    const plain = [];
    for (const text of list) {
      const part = parsePart(text);
      if (part) parsed.push({ text, ...part });
      else if (text) plain.push(text);
    }
    const byTotal = new Map();
    for (const item of parsed) {
      if (!byTotal.has(item.total)) byTotal.set(item.total, []);
      byTotal.get(item.total).push(item);
    }
    const groups = [];
    for (const [total, items] of byTotal) {
      const parts = new Map();
      for (const item of items) {
        if (!parts.has(item.index)) parts.set(item.index, item);
      }
      groups.push({ total, parts, count: parts.size });
    }
    groups.sort((a, b) => b.count - a.count || a.total - b.total);
    return { groups, plain };
  }

  function createSession(total) {
    return {
      id: `s${_sid++}`,
      total: Number(total) || 0,
      parts: new Map(),
      updatedAt: Date.now(),
    };
  }

  function createBag() {
    return { sessions: [] };
  }

  function sessionIncomplete(sess) {
    return !!(sess && sess.total >= 2 && sess.parts.size > 0 && sess.parts.size < sess.total);
  }

  function bagHasIncomplete(bag) {
    return !!(bag && Array.isArray(bag.sessions) && bag.sessions.some(sessionIncomplete));
  }

  /** 按 1..n 拼已有正文。中间缺口插【缺第i片】；末尾缺的只写在标签里 */
  function joinAvailable(parts, total) {
    const n = Number(total) || 0;
    const map = parts instanceof Map ? parts : new Map();
    const missing = [];
    if (n < 1) {
      return { text: "", missing, got: 0, total: 0, complete: false, format: "" };
    }
    let maxPresent = 0;
    for (const idx of map.keys()) {
      if (idx > maxPresent) maxPresent = idx;
    }
    const chunks = [];
    for (let i = 1; i <= n; i += 1) {
      if (map.has(i)) {
        chunks.push(map.get(i) || "");
        continue;
      }
      missing.push(i);
      if (i < maxPresent) chunks.push(GAP_MARK(i));
    }
    const got = n - missing.length;
    const complete = missing.length === 0;
    const missLabel =
      missing.length === 0
        ? ""
        : missing.length <= 4
          ? ` · 缺第${missing.join("、")}片`
          : ` · 缺 ${missing.length} 片`;
    const format = complete
      ? `拼接全文 · ${n} 片`
      : `部分拼接 ${got}/${n}${missLabel}`;
    return { text: chunks.join(""), missing, got, total: n, complete, format };
  }

  function summarizeSession(sess, labelPrefix) {
    const info = joinAvailable(sess.parts, sess.total);
    const prefix = labelPrefix ? `${labelPrefix} · ` : "";
    return {
      id: sess.id,
      session: sess,
      added: [],
      complete: info.complete,
      joined: info.text,
      missing: info.missing,
      format: prefix + info.format,
      got: info.got,
      total: sess.total,
    };
  }

  /**
   * 把一片归入已有会话，或新开一套。
   * 相容：同 n，且该序号未占或正文相同；冲突则另开。
   */
  function matchOrCreateSession(bag, part) {
    const list = bag.sessions;
    const sameTotal = list.filter((s) => s.total === part.total);
    for (const s of sameTotal) {
      if (s.parts.has(part.index) && s.parts.get(part.index) === part.body) return s;
    }
    const open = sameTotal
      .filter((s) => !s.parts.has(part.index))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    if (open.length) return open[0];
    const sess = createSession(part.total);
    list.push(sess);
    return sess;
  }

  /**
   * 多套分片袋：一次扫入若干文本，按内容分流到不同会话。
   * 返回 { bag, plain, results, completed, incomplete, displayHits, addedAny }
   */
  function ingestTexts(bag, texts) {
    const b = bag && Array.isArray(bag.sessions) ? bag : createBag();
    const plain = [];
    const touched = new Map(); // id -> { sess, added: number[] }
    for (const raw of texts || []) {
      const text = String(raw ?? "");
      if (!text) continue;
      const part = parsePart(text);
      if (!part) {
        plain.push(text);
        continue;
      }
      const sess = matchOrCreateSession(b, part);
      let entry = touched.get(sess.id);
      if (!entry) {
        entry = { sess, added: [] };
        touched.set(sess.id, entry);
      }
      if (!sess.parts.has(part.index)) {
        sess.parts.set(part.index, part.body);
        entry.added.push(part.index);
        sess.updatedAt = Date.now();
      }
    }

    const completed = [];
    const incomplete = [];
    const results = [];
    const still = [];
    // 稳定编号：按首次出现顺序
    let ordinal = 0;
    const ordById = new Map();
    for (const s of b.sessions) {
      if (!ordById.has(s.id)) ordById.set(s.id, ++ordinal);
    }
    for (const s of b.sessions) {
      if (s.parts.size === 0) continue;
      const label = b.sessions.length > 1 ? `套${ordById.get(s.id)}` : "";
      const sum = summarizeSession(s, label);
      const touch = touched.get(s.id);
      if (touch) sum.added = touch.added;
      results.push(sum);
      if (sum.complete) completed.push(sum);
      else {
        incomplete.push(sum);
        still.push(s);
      }
    }
    b.sessions = still;

    return {
      bag: b,
      plain,
      results,
      completed,
      incomplete,
      addedAny: [...touched.values()].some((t) => t.added.length > 0),
      displayHits: buildDisplayHitsMulti(completed, incomplete, plain),
      hasSeries: results.length > 0,
    };
  }

  /** 兼容旧单会话 ingest（仅同 n 一套） */
  function ingest(session, seriesParts, seriesTotal) {
    const bag = createBag();
    if (session && session.total) {
      const s = {
        id: session.id || `s${_sid++}`,
        total: session.total,
        parts: new Map(session.parts || []),
        updatedAt: session.updatedAt || Date.now(),
      };
      bag.sessions.push(s);
    }
    const texts = [];
    const total = Number(seriesTotal) || 0;
    if (total && seriesParts instanceof Map) {
      for (const [index, item] of seriesParts) {
        const body = typeof item === "string" ? item : item.body;
        texts.push(`[${index}/${total}]${body}`);
      }
    }
    const out = ingestTexts(bag, texts);
    // 优先交回本次目标 n 的那一套（换 n 时旧套仍留在 bag 里）
    const primary =
      out.results.find((r) => r.total === total) ||
      out.results[out.results.length - 1] || {
        session: session,
        added: [],
        complete: false,
        joined: "",
        missing: [],
        format: "",
        got: 0,
        total: session?.total || 0,
      };
    const alive =
      out.bag.sessions.find((s) => s.id === primary.session?.id) ||
      out.completed.find((r) => r.id === primary.id)?.session ||
      primary.session;
    return {
      session: alive,
      added: primary.added,
      complete: primary.complete,
      joined: primary.joined,
      missing: primary.missing,
      format: primary.format,
      got: primary.got,
      total: primary.total,
      bag: out.bag,
      displayHits: out.displayHits,
      plain: out.plain,
    };
  }

  function buildDisplayHits(result, plain) {
    const hits = [];
    if (result && result.got > 0 && result.joined) {
      hits.push({
        text: result.joined,
        format:
          result.format ||
          (result.complete ? `拼接全文 · ${result.total} 片` : `部分拼接 ${result.got}/${result.total}`),
      });
    }
    for (const t of plain || []) {
      if (t) hits.push({ text: t, format: "其它码（未拼接）" });
    }
    return hits;
  }

  function buildDisplayHitsMulti(completed, incomplete, plain) {
    const hits = [];
    for (const r of completed || []) {
      if (r.got > 0 && r.joined) hits.push({ text: r.joined, format: r.format });
    }
    for (const r of incomplete || []) {
      if (r.got > 0 && r.joined) hits.push({ text: r.joined, format: r.format });
    }
    for (const t of plain || []) {
      if (t) hits.push({ text: t, format: "其它码（未拼接）" });
    }
    return hits;
  }

  function progressLabel(got, total) {
    return `分片进度 ${got}/${total}`;
  }

  function bagProgressLines(bag) {
    if (!bag?.sessions?.length) return [];
    const lines = [];
    let i = 0;
    for (const s of bag.sessions) {
      if (!sessionIncomplete(s) && !(s.parts.size > 0)) continue;
      i += 1;
      const info = joinAvailable(s.parts, s.total);
      const head = bag.sessions.length > 1 ? `套${i} ` : "";
      lines.push(`${head}${info.format}`);
    }
    return lines;
  }

  const api = {
    PART_RE,
    GAP_MARK,
    parsePart,
    classifyTexts,
    classifyAll,
    createSession,
    createBag,
    sessionIncomplete,
    bagHasIncomplete,
    joinAvailable,
    ingest,
    ingestTexts,
    buildDisplayHits,
    buildDisplayHitsMulti,
    progressLabel,
    bagProgressLines,
    matchOrCreateSession,
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  globalThis.DevToolsQrSeries = api;
})();
