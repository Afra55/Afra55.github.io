/* DevTools PWA service worker — 轻量壳缓存，不预缓存大体积 wasm/编码器 */
/* eslint-disable no-restricted-globals */
"use strict";

const SHELL_CACHE = "devtools-shell-20260817memoux1";
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

  // 在线优先拉新，离线再回退缓存——这样网页更新后 PWA 下次打开会同步
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && res.type !== "opaque") {
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
