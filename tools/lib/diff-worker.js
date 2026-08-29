"use strict";

importScripts("./diff-core.js");

self.onmessage = (ev) => {
  const { id, a, b, opts } = ev.data || {};
  try {
    const rows = DiffCore.diffLines(a, b, opts || {});
    const aligned = DiffCore.diffAlignFromRows(rows);
    const stats = DiffCore.diffStats(rows);
    self.postMessage({ id, ok: true, rows, aligned, stats });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err?.message || String(err),
      code: err?.code || "",
    });
  }
};
