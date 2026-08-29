(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.DiffCore = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DIFF_MAX_LINES = 12000;
  const DIFF_MAX_EDITS = 24000;
  const DIFF_MAX_CHARS = 12000;

  function diffLineNorm(line, opts = {}) {
    let s = String(line);
    if (opts.trimTrailing) s = s.replace(/\s+$/, "");
    if (opts.ignoreWhitespace) s = s.replace(/\s+/g, " ").trim();
    if (opts.ignoreCase) s = s.toLowerCase();
    return s;
  }

  function splitLines(text) {
    return String(text).split(/\r\n|\n|\r/);
  }

  function diffGuard(n, m, { maxLines = DIFF_MAX_LINES, maxCells = 0 } = {}) {
    if (n > maxLines || m > maxLines) {
      return {
        ok: false,
        reason: `文本行数过多（A ${n} / B ${m} 行，上限 ${maxLines}）。请分段比对。`,
      };
    }
    if (maxCells > 0 && n * m > maxCells) {
      return {
        ok: false,
        reason: `文本体量过大（${n}×${m} 行），请缩短后重试。`,
      };
    }
    return { ok: true };
  }

  function makeEq(opts) {
    return (la, lb) => diffLineNorm(la, opts) === diffLineNorm(lb, opts);
  }

  /** Myers O(ND) on index arrays; eq compares logical lines */
  function myersOps(a, b, eq) {
    const n = a.length;
    const m = b.length;
    if (!n && !m) return [];
    if (!n) {
      const ops = [];
      for (let j = 0; j < m; j++) ops.push({ type: "add", bj: j });
      return ops;
    }
    if (!m) {
      const ops = [];
      for (let i = 0; i < n; i++) ops.push({ type: "del", ai: i });
      return ops;
    }

    const max = n + m;
    const offset = max;
    const size = 2 * max + 1;
    let v = new Int32Array(size);
    v.fill(-1);
    v[offset + 1] = 0;
    const trace = [];

    for (let d = 0; d <= max; d++) {
      if (d > DIFF_MAX_EDITS) {
        const err = new Error(`差异过大（超过 ${DIFF_MAX_EDITS} 步编辑），请分段比对。`);
        err.code = "DIFF_TOO_LARGE";
        throw err;
      }
      trace.push(v.slice());
      for (let k = -d; k <= d; k += 2) {
        const ki = offset + k;
        let x;
        if (k === -d || (k !== d && v[ki - 1] < v[ki + 1])) {
          x = v[ki + 1];
        } else {
          x = v[ki - 1] + 1;
        }
        let y = x - k;
        while (x < n && y < m && eq(a[x], b[y])) {
          x++;
          y++;
        }
        v[ki] = x;
        if (x >= n && y >= m) {
          return backtrackOps(trace, offset, n, m);
        }
      }
    }
    return [];
  }

  function backtrackOps(trace, offset, n, m) {
    const ops = [];
    let x = n;
    let y = m;
    for (let d = trace.length - 1; d >= 0; d--) {
      const v = trace[d];
      const k = x - y;
      const ki = offset + k;
      let prevK;
      if (k === -d || (k !== d && v[ki - 1] < v[ki + 1])) {
        prevK = k + 1;
      } else {
        prevK = k - 1;
      }
      const prevX = v[offset + prevK];
      const prevY = prevX - prevK;
      while (x > prevX && y > prevY) {
        ops.push({ type: "same", ai: x - 1, bj: y - 1 });
        x--;
        y--;
      }
      if (d === 0) break;
      if (x === prevX) {
        ops.push({ type: "add", bj: y - 1 });
        y--;
      } else {
        ops.push({ type: "del", ai: x - 1 });
        x--;
      }
    }
    ops.reverse();
    return ops;
  }

  function opsToRows(ops, aLines, bLines) {
    const rows = [];
    for (const op of ops) {
      if (op.type === "same") {
        const left = aLines[op.ai];
        const right = bLines[op.bj];
        rows.push({ type: "same", text: left, left, right });
      } else if (op.type === "del") {
        const left = aLines[op.ai];
        rows.push({ type: "del", text: left, left, right: "" });
      } else {
        const right = bLines[op.bj];
        rows.push({ type: "add", text: right, left: "", right });
      }
    }
    return rows;
  }

  function mergeAdjacentChanges(rows) {
    const out = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const next = rows[i + 1];
      if (r.type === "del" && next?.type === "add") {
        out.push({
          type: "change",
          text: next.right,
          left: r.left,
          right: next.right,
        });
        i++;
      } else {
        out.push(r);
      }
    }
    return out;
  }

  function diffLines(aText, bText, opts = {}) {
    const aLines = splitLines(aText);
    const bLines = splitLines(bText);
    const eq = makeEq(opts);
    const guard = diffGuard(aLines.length, bLines.length);
    if (!guard.ok) {
      const err = new Error(guard.reason);
      err.code = "DIFF_TOO_LARGE";
      throw err;
    }

    let lo = 0;
    let hiA = aLines.length;
    let hiB = bLines.length;
    while (lo < hiA && lo < hiB && eq(aLines[lo], bLines[lo])) lo++;

    const suffixRows = [];
    while (hiA > lo && hiB > lo && eq(aLines[hiA - 1], bLines[hiB - 1])) {
      hiA--;
      hiB--;
      suffixRows.unshift({
        type: "same",
        text: aLines[hiA],
        left: aLines[hiA],
        right: bLines[hiB],
      });
    }

    const prefix = [];
    for (let i = 0; i < lo; i++) {
      const left = aLines[i];
      const right = bLines[i];
      prefix.push({ type: "same", text: left, left, right });
    }

    const midA = aLines.slice(lo, hiA);
    const midB = bLines.slice(lo, hiB);
    const ops = midA.length || midB.length ? myersOps(midA, midB, eq) : [];
    const middle = mergeAdjacentChanges(opsToRows(ops, midA, midB));
    return prefix.concat(middle, suffixRows);
  }

  function diffAlignFromRows(rows) {
    const out = [];
    let ln = 0;
    let rn = 0;
    for (const row of rows) {
      if (row.type === "same") {
        ln++;
        rn++;
        out.push({
          kind: "same",
          left: { num: ln, text: row.left ?? row.text },
          right: { num: rn, text: row.right ?? row.text },
        });
      } else if (row.type === "del") {
        ln++;
        out.push({
          kind: "del",
          left: { num: ln, text: row.left ?? row.text },
          right: { num: null, text: "" },
        });
      } else if (row.type === "change") {
        ln++;
        rn++;
        out.push({
          kind: "change",
          left: { num: ln, text: row.left ?? "" },
          right: { num: rn, text: row.right ?? "" },
        });
      } else {
        rn++;
        out.push({
          kind: "add",
          left: { num: null, text: "" },
          right: { num: rn, text: row.right ?? row.text },
        });
      }
    }
    return out;
  }

  function diffAlign(aText, bText, opts = {}) {
    return diffAlignFromRows(diffLines(aText, bText, opts));
  }

  function diffStats(rows) {
    const stats = { same: 0, add: 0, del: 0, change: 0 };
    (Array.isArray(rows) ? rows : []).forEach((row) => {
      const t = row.type || row.kind;
      if (t === "same") stats.same += 1;
      else if (t === "add") stats.add += 1;
      else if (t === "del") stats.del += 1;
      else if (t === "change") stats.change += 1;
    });
    return stats;
  }

  function diffChars(aText, bText) {
    const a = String(aText);
    const b = String(bText);
    const n = a.length;
    const m = b.length;
    const guard = diffGuard(n, m, { maxLines: DIFF_MAX_CHARS, maxCells: 0 });
    if (!guard.ok) {
      const err = new Error(guard.reason.replace(/行/g, "字符"));
      err.code = "DIFF_TOO_LARGE";
      throw err;
    }
    if (n * m > 2_000_000) {
      const err = new Error("单行差异字符过多，无法精细高亮。");
      err.code = "DIFF_TOO_LARGE";
      throw err;
    }
    const dp = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const left = [];
    const right = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) {
        left.push({ type: "same", ch: a[i] });
        right.push({ type: "same", ch: b[j] });
        i++;
        j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        left.push({ type: "del", ch: a[i++] });
      } else {
        right.push({ type: "add", ch: b[j++] });
      }
    }
    while (i < n) left.push({ type: "del", ch: a[i++] });
    while (j < m) right.push({ type: "add", ch: b[j++] });
    return { left, right };
  }

  function diffCharHtml(parts, side) {
    const cls = side === "left" ? "diff-ch-del" : "diff-ch-add";
    let html = "";
    for (const p of parts) {
      const ch = p.ch === " " ? "&nbsp;" : escapeHtml(p.ch);
      if (p.type === "same") html += ch;
      else if (p.type === (side === "left" ? "del" : "add")) html += `<span class="${cls}">${ch}</span>`;
    }
    return html || "&nbsp;";
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function diffLineCount(text) {
    if (!text) return 0;
    return splitLines(text).length;
  }

  function diffAutoPolicy(aText, bText) {
    const lines = diffLineCount(aText) + diffLineCount(bText);
    if (lines > 6000) return { allowAuto: false, debounce: 0, lines };
    if (lines > 1200) return { allowAuto: true, debounce: 420, lines };
    if (lines > 400) return { allowAuto: true, debounce: 260, lines };
    return { allowAuto: true, debounce: 160, lines };
  }

  return {
    DIFF_MAX_LINES,
    diffLineNorm,
    diffLines,
    diffAlign,
    diffAlignFromRows,
    diffStats,
    diffChars,
    diffCharHtml,
    diffAutoPolicy,
    escapeHtml,
  };
});
