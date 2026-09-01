/* DevTools PWA service worker — 轻量壳缓存，不预缓存大体积 wasm/编码器 */
/* eslint-disable no-restricted-globals */
"use strict";

const SHELL_CACHE = "devtools-shell-20260901-110000";
const PRECACHE = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-180.png",
];

function shouldBypass(url) {
  if (url.origin !== self.location.origin) return true;
  const path = url.pathname;
  if (!path.includes("/tools")) return true;
  if (/\.wasm$/i.test(path)) return true;
  if (/\/vendor\/(ffmpeg|gifsicle|gif\.worker|omggif)/i.test(path)) return true;
  if (/\/ffmpeg\//i.test(path)) return true;
  if (/\/excalidraw\//i.test(path)) return true;
  if (/\/sandspiel\//i.test(path)) return true;
  return false;
}

/** 脚本/样式走网络，避免升级后 SW 回退到旧版 JS/CSS */
function shouldCacheResponse(url, req) {
  const path = url.pathname;
  if (/\.(js|css|mjs)$/i.test(path)) return false;
  if (req.mode === "navigate") return true;
  if (/\/index\.html$/i.test(path) || path.endsWith("/tools/") || path.endsWith("/tools")) return true;
  if (/\/icons\//i.test(path)) return true;
  if (path.endsWith("/manifest.webmanifest")) return true;
  return false;
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("devtools-shell-") && k !== SHELL_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  let url;
  try {
    url = new URL(req.url);
  } catch (_) {
    return;
  }
  if (shouldBypass(url)) return;

  // 在线优先拉新，离线再回退缓存——JS/CSS 不写入缓存，减少新旧版本混用
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type !== "opaque" && shouldCacheResponse(url, req)) {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() =>
        caches.match(req).then((cached) => {
          if (cached) return cached;
          if (req.mode === "navigate") return caches.match("./index.html").then((r) => r || caches.match("./"));
          return undefined;
        })
      )
  );
});
