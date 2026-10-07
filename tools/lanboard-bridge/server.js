"use strict";

/**
 * 局域网看板模块（挂到统一桥 /lanboard/*）。
 * 文字快照 + 可选媒体暂存；电脑退出后手机仍可从桥拉文字/已暂存媒体。
 */

const BRIDGE_VERSION = "0.1.0";
const FEATURES = { lanboard: true, textSnapshot: true, mediaStash: true };

const MAX_TEXT_ITEMS = 300;
const MAX_TEXT_BYTES = 8 * 1024;
const MAX_MEDIA_BYTES = 24 * 1024 * 1024;
const MAX_MEDIA_TOTAL = 96 * 1024 * 1024;
const MAX_MEDIA_FILES = 40;
const TTL_MS = 24 * 60 * 60 * 1000;

/** @type {Map<string, { id: string, kind: string, text?: string, name?: string, mime?: string, size?: number, ownerId?: string, ownerName?: string, thumb?: string, addedAt: number, updatedAt: number }>} */
const textItems = new Map();
/** @type {Map<string, { id: string, name: string, mime: string, size: number, ownerId: string, ownerName: string, thumb: string, addedAt: number, buf: Buffer }>} */
const mediaItems = new Map();

function pruneExpired() {
  const now = Date.now();
  for (const [id, it] of textItems) {
    if (now - (it.updatedAt || it.addedAt || 0) > TTL_MS) textItems.delete(id);
  }
  for (const [id, it] of mediaItems) {
    if (now - (it.addedAt || 0) > TTL_MS) mediaItems.delete(id);
  }
  let total = 0;
  for (const it of mediaItems.values()) total += it.buf.length;
  if (total <= MAX_MEDIA_TOTAL && mediaItems.size <= MAX_MEDIA_FILES) return;
  const ordered = [...mediaItems.values()].sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
  while (ordered.length && (total > MAX_MEDIA_TOTAL || mediaItems.size > MAX_MEDIA_FILES)) {
    const oldest = ordered.shift();
    if (!oldest) break;
    mediaItems.delete(oldest.id);
    total -= oldest.buf.length;
  }
}

function readBody(req, limit = MAX_MEDIA_BYTES + 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error("请求体过大"), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function parseJsonBody(buf) {
  const text = Buffer.isBuffer(buf) ? buf.toString("utf8") : String(buf || "");
  if (!text.trim()) return {};
  return JSON.parse(text);
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function normalizeTextItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = String(raw.id || "").trim().slice(0, 64);
  if (!id) return null;
  const text = String(raw.text ?? "");
  if (Buffer.byteLength(text, "utf8") > MAX_TEXT_BYTES) {
    throw Object.assign(new Error(`文字超过 ${MAX_TEXT_BYTES} 字节`), { status: 400 });
  }
  const addedAt = Number(raw.addedAt) || Date.now();
  return {
    id,
    kind: "text",
    text,
    ownerId: String(raw.ownerId || "").slice(0, 64),
    ownerName: String(raw.ownerName || "").slice(0, 48),
    addedAt,
    updatedAt: Date.now(),
  };
}

function exportTextItems() {
  pruneExpired();
  return [...textItems.values()]
    .map((it) => ({
      id: it.id,
      kind: "text",
      text: it.text || "",
      ownerId: it.ownerId || "",
      ownerName: it.ownerName || "",
      addedAt: it.addedAt || 0,
    }))
    .sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
}

function exportMediaMetas() {
  pruneExpired();
  return [...mediaItems.values()]
    .map((it) => ({
      id: it.id,
      kind: it.mime?.startsWith("video/") ? "video" : "image",
      name: it.name,
      mime: it.mime,
      size: it.size,
      ownerId: it.ownerId || "",
      ownerName: it.ownerName || "",
      thumb: it.thumb || "",
      addedAt: it.addedAt || 0,
      onBridge: true,
    }))
    .sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
}

function mediaTotalBytes() {
  let n = 0;
  for (const it of mediaItems.values()) n += it.buf.length;
  return n;
}

async function handleRequest(req, res, opts = {}) {
  const pathname = String(opts.pathname || "/").replace(/\/+$/, "") || "/";
  try {
    if (pathname === "/health" || pathname === "/") {
      pruneExpired();
      sendJson(res, 200, {
        ok: true,
        version: BRIDGE_VERSION,
        features: FEATURES,
        textCount: textItems.size,
        mediaCount: mediaItems.size,
        mediaBytes: mediaTotalBytes(),
      });
      return;
    }

    if (pathname === "/snapshot" && req.method === "GET") {
      sendJson(res, 200, {
        ok: true,
        texts: exportTextItems(),
        media: exportMediaMetas(),
        ts: Date.now(),
      });
      return;
    }

    if (pathname === "/texts" && req.method === "GET") {
      sendJson(res, 200, { ok: true, items: exportTextItems(), ts: Date.now() });
      return;
    }

    if (pathname === "/texts" && req.method === "PUT") {
      const body = parseJsonBody(await readBody(req, 2 * 1024 * 1024));
      const items = Array.isArray(body.items) ? body.items : [];
      textItems.clear();
      for (const raw of items.slice(-MAX_TEXT_ITEMS)) {
        const it = normalizeTextItem(raw);
        if (it) textItems.set(it.id, it);
      }
      pruneExpired();
      sendJson(res, 200, { ok: true, count: textItems.size });
      return;
    }

    if (pathname === "/texts" && req.method === "POST") {
      const body = parseJsonBody(await readBody(req, MAX_TEXT_BYTES + 4096));
      const it = normalizeTextItem(body.item || body);
      if (!it) {
        sendJson(res, 400, { ok: false, error: "无效文字条目" });
        return;
      }
      textItems.set(it.id, it);
      while (textItems.size > MAX_TEXT_ITEMS) {
        const oldest = exportTextItems()[0];
        if (!oldest) break;
        textItems.delete(oldest.id);
      }
      sendJson(res, 200, { ok: true, item: it });
      return;
    }

    const textDel = pathname.match(/^\/texts\/([^/]+)$/);
    if (textDel && req.method === "DELETE") {
      const id = decodeURIComponent(textDel[1]);
      textItems.delete(id);
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === "/media" && req.method === "GET") {
      sendJson(res, 200, { ok: true, items: exportMediaMetas() });
      return;
    }

    if (pathname === "/media" && req.method === "POST") {
      const buf = await readBody(req);
      const id = String(req.headers["x-lanboard-id"] || "").trim().slice(0, 64);
      let name = "file";
      let ownerName = "";
      let thumb = "";
      try {
        name = decodeURIComponent(String(req.headers["x-lanboard-name"] || "file")).slice(0, 180);
      } catch {
        name = String(req.headers["x-lanboard-name"] || "file").slice(0, 180);
      }
      try {
        ownerName = decodeURIComponent(String(req.headers["x-lanboard-owner-name"] || "")).slice(0, 48);
      } catch {
        ownerName = String(req.headers["x-lanboard-owner-name"] || "").slice(0, 48);
      }
      try {
        thumb = decodeURIComponent(String(req.headers["x-lanboard-thumb"] || "")).slice(0, 120000);
      } catch {
        thumb = "";
      }
      const mime = String(req.headers["x-lanboard-mime"] || "application/octet-stream").slice(0, 120);
      const ownerId = String(req.headers["x-lanboard-owner"] || "").slice(0, 64);
      if (!id) {
        sendJson(res, 400, { ok: false, error: "缺少 x-lanboard-id" });
        return;
      }
      if (!buf.length) {
        sendJson(res, 400, { ok: false, error: "空文件" });
        return;
      }
      if (buf.length > MAX_MEDIA_BYTES) {
        sendJson(res, 413, { ok: false, error: `单文件超过 ${MAX_MEDIA_BYTES} 字节` });
        return;
      }
      mediaItems.set(id, {
        id,
        name,
        mime,
        size: buf.length,
        ownerId,
        ownerName,
        thumb,
        addedAt: Date.now(),
        buf,
      });
      pruneExpired();
      sendJson(res, 200, { ok: true, id, size: buf.length });
      return;
    }

    const mediaGet = pathname.match(/^\/media\/([^/]+)$/);
    if (mediaGet && req.method === "GET") {
      pruneExpired();
      const id = decodeURIComponent(mediaGet[1]);
      const it = mediaItems.get(id);
      if (!it) {
        sendJson(res, 404, { ok: false, error: "媒体不在桥上" });
        return;
      }
      res.writeHead(200, {
        "Content-Type": it.mime || "application/octet-stream",
        "Content-Length": it.buf.length,
        "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(it.name || id)}`,
        "Cache-Control": "no-store",
        "X-Lanboard-Name": encodeURIComponent(it.name || ""),
      });
      res.end(it.buf);
      return;
    }

    if (mediaGet && req.method === "DELETE") {
      mediaItems.delete(decodeURIComponent(mediaGet[1]));
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname === "/clear" && req.method === "POST") {
      textItems.clear();
      mediaItems.clear();
      sendJson(res, 200, { ok: true });
      return;
    }

    sendJson(res, 404, { ok: false, error: "未知接口" });
  } catch (err) {
    sendJson(res, err?.status || 400, { ok: false, error: err?.message || String(err) });
  }
}

module.exports = { handleRequest, BRIDGE_VERSION, FEATURES };
