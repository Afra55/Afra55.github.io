(() => {
  "use strict";

  /**
   * 生码分片格式：`[i/n]正文`
   * - 匹配且 total 相同 → 可拼（未齐也先拼已有，缺片用占位）
   * - 无此外缀 / 不同内容 → 当独立码，绝不拼进正文
   */
  const PART_RE = /^\[(\d+)\/(\d+)\]([\s\S]*)$/;
  const GAP_MARK = (i) => `【缺第${i}片】`;

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

  /** 按 1..n 拼已有正文。中间缺口插【缺第i片】；末尾缺的只写在标签里，方便直接复制已有正文 */
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
      // 后面还有已扫到的片 → 中间缺口，插入可见占位
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

  function ingest(session, seriesParts, seriesTotal) {
    let sess = session;
    const total = Number(seriesTotal) || 0;
    if (!total || !(seriesParts instanceof Map) || seriesParts.size === 0) {
      const empty = joinAvailable(sess?.parts || new Map(), sess?.total || 0);
      return {
        session: sess,
        added: [],
        complete: false,
        joined: empty.text,
        missing: empty.missing,
        format: empty.format,
        got: empty.got,
        total: empty.total || sess?.total || 0,
      };
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
    const joinedInfo = joinAvailable(sess.parts, sess.total);
    return {
      session: sess,
      added,
      complete: joinedInfo.complete,
      joined: joinedInfo.text,
      missing: joinedInfo.missing,
      format: joinedInfo.format,
      got: joinedInfo.got,
      total: sess.total,
    };
  }

  /**
   * 结果列表：第 1 条为（部分）拼接正文；其后为无关码。
   * 未齐时也给出可复制的已拼文本。
   */
  function buildDisplayHits(result, plain) {
    const hits = [];
    if (result && result.got > 0 && result.joined) {
      hits.push({
        text: result.joined,
        format: result.format || (result.complete ? `拼接全文 · ${result.total} 片` : `部分拼接 ${result.got}/${result.total}`),
      });
    }
    for (const t of plain || []) {
      if (t) hits.push({ text: t, format: "其它码（未拼接）" });
    }
    return hits;
  }

  function progressLabel(got, total) {
    return `分片进度 ${got}/${total}`;
  }

  const api = {
    PART_RE,
    GAP_MARK,
    parsePart,
    classifyTexts,
    createSession,
    joinAvailable,
    ingest,
    buildDisplayHits,
    progressLabel,
  };

  if (typeof module === "object" && module.exports) module.exports = api;
  globalThis.DevToolsQrSeries = api;
})();
