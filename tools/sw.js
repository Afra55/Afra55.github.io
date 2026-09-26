/* DevTools PWA service worker — 轻量壳缓存，不预缓存大体积 wasm/编码器 */
/* eslint-disable no-restricted-globals */
"use strict";

const SHELL_CACHE = "devtools-shell-20260926-132748";
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

/** 可缓存的静态资源（含带 ?v= 的 JS/CSS/HTML）；大体积编码器与 wasm 除外 */
function shouldCacheResponse(url) {
  const path = url.pathname;
  if (/\.wasm$/i.test(path)) return false;
  if (/\/vendor\/(ffmpeg|gifsicle|gif\.worker|omggif)/i.test(path)) return false;
  if (/\/ffmpeg\//i.test(path)) return false;
  if (path.includes("/tools")) return true;
  if (/\/index\.html$/i.test(path) || path.endsWith("/tools/") || path.endsWith("/tools")) return true;
  if (/\/icons\//i.test(path)) return true;
  if (path.endsWith("/manifest.webmanifest")) return true;
  return false;
}

function cacheResponse(req, res) {
  if (!res || !res.ok || res.type === "opaque") return;
  const copy = res.clone();
  caches.open(SHELL_CACHE).then((c) => c.put(req, copy)).catch(() => {});
}

function networkFetch(req, url) {
  return fetch(req)
    .then((res) => {
      if (shouldCacheResponse(url)) cacheResponse(req, res);
      return res;
    })
    .catch(() =>
      caches.match(req).then((cached) => {
        if (cached) return cached;
        if (req.mode === "navigate") {
          return caches.match("./index.html").then((r) => r || caches.match("./"));
        }
        return undefined;
      })
    );
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

  // 导航请求（HTML 文档）走网络优先：否则缓存的 index.html 会一直引到旧的 ?v= 资源，
  // 用户永远拿不到新代码（曾导致「发了版手机上还是旧版」）。离线时才回退缓存。
  const isDoc =
    req.mode === "navigate" ||
    (req.headers.get("accept") || "").includes("text/html");
  if (isDoc) {
    event.respondWith(
      networkFetch(req, url).catch(() =>
        caches.match(req).then((c) => c || caches.match("./index.html").then((r) => r || caches.match("./")))
      )
    );
    return;
  }

  // 其余静态资源缓存优先：命中即返回，后台 stale-while-revalidate
  // （JS/CSS 都带 ?v=<BUILD>，新版本 = 新 URL，所以不会拿到旧文件）
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = networkFetch(req, url);
      if (cached) {
        event.waitUntil(network.catch(() => {}));
        return cached;
      }
      return network;
    })
  );
});
