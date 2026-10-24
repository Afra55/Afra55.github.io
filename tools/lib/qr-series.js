(() => {
  "use strict";

  /**
   * 生码分片格式：`[i/n]正文`
   * - 匹配且 total 相同 → 可拼
   * - 无此外缀 / 不同内容 → 当独立码，绝不拼进正文
   */
  const PART_RE = /^\[(\d+)\/(\d+)\]([\s\S]*)$/;

  function parsePart(text) {
    const m = String(text ?? "").match(PART_RE);
    if (!m) return null;
    const index = Number(m[1]);
    const total = Number(m[2]);
    if (!Number.isInteger(index) || !Number.isInteger(total)) return null;
    if (total < 2 || total > 98 || index < 1 || index > total) return null;
    return { index, total, body: m[3] };
  }

  /** 从一批文本里挑主分片组（同 n、唯一 index 最多）；其余当分片失败或独立码 */
  function classifyTexts(texts) {
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
      if (!byTotal.has(item.total)) byTotal.set(item.total, new Map());
      const m = byTotal.get(item.total);
      if (!m.has(item.index)) m.set(item.index, item);
    }
    let best = null;
    for (const [total, map] of byTotal) {
      if (!best || map.size > best.count || (map.size === best.count && total < best.total)) {
        best = { total, map, count: map.size };
      }
    }
    /** 落选的其它 n 分片也当独立原文列出（不拼） */
    const straySeries = [];
    if (best) {
      for (const [total, map] of byTotal) {
        if (total === best.total) continue;
        for (const item of map.values()) straySeries.push(item.text);
      }
    } else {
      for (const item of parsed) straySeries.push(item.text);
    }
    return {
      seriesTotal: best ? best.total : 0,
      seriesParts: best ? best.map : new Map(), // index -> { index, total, body, text }
      plain: plain.concat(straySeries),
      hasSeries: Boolean(best && best.count > 0),
    };
  }

  function createSession(total) {
    return { total: Number(total) || 0, parts: new Map() };
  }

  function ingest(session, seriesParts, seriesTotal) {
    let sess = session;
    const total = Number(seriesTotal) || 0;
    if (!total || !(seriesParts instanceof Map) || seriesParts.size === 0) {
      return { session: sess, added: [], complete: false, joined: "", got: 0, total: sess?.total || 0 };
    }
    if (!sess || sess.total !== total) sess = createSession(total);
    const added = [];
    for (const [index, item] of seriesParts) {
      const body = typeof item === "string" ? item : item.body;
      if (!sess.parts.has(index)) {
        sess.parts.set(index, body);
        added.push(index);
      }
    }
    let complete = sess.parts.size >= sess.total;
    if (complete) {
      for (let i = 1; i <= sess.total; i += 1) {
        if (!sess.parts.has(i)) {
          complete = false;
          break;
        }
      }
    }
    let joined = "";
    if (complete) {
      const chunks = [];
      for (let i = 1; i <= sess.total; i += 1) chunks.push(sess.parts.get(i) || "");
      joined = chunks.join("");
    }
    return {
      session: sess,
      added,
      complete,
      joined,
      got: sess.parts.size,
      total: sess.total,
    };
  }

  function progressLabel(got, total) {
    return `分片进度 ${got}/${total}`;
  }

  const api = {
    PART_RE,
    parsePart,
    classifyTexts,
    createSession,
    ingest,
    progressLabel,
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  globalThis.DevToolsQrSeries = api;
})();
