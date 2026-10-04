/* DevTools PWA service worker — 轻量壳缓存，不预缓存大体积 wasm/编码器 */
/* eslint-disable no-restricted-globals */
"use strict";

const SHELL_CACHE = "devtools-shell-20261004-152127";
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
  // 独立扫码 PWA 自有 SW，主站壳不要接管
  if (/\/qrscan\//i.test(path)) return true;
  // 大体积内容资源：不进 SW 缓存（养生 GIF / 白噪音等，打开工具时再拉）
  if (/\/health-articles\//i.test(path)) return true;
  if (/\/assets\/ambient\//i.test(path)) return true;
  if (/\/lib\/health-articles\//i.test(path)) return true;
  return false;
}

/** 可缓存的静态资源（含带 ?v= 的 JS/CSS/HTML）；大体积编码器与 wasm 除外 */
function shouldCacheResponse(url) {
  const path = url.pathname;
  if (/\.wasm$/i.test(path)) return false;
  if (/\/vendor\/(ffmpeg|gifsicle|gif\.worker|omggif)/i.test(path)) return false;
  if (/\/ffmpeg\//i.test(path)) return false;
  if (/\/health-articles\//i.test(path)) return false;
  if (/\/assets\/ambient\//i.test(path)) return false;
  if (/\/lib\/health-articles\//i.test(path)) return false;
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

  // 构建戳入口与备忘录主脚本：网络优先，避免壳缓存把坏掉的旧 memo.js 一直喂给用户
  const path = url.pathname || "";
  if (/\/(?:tools-build|memo)\.js$/i.test(path) || /\/lib\/tools-build\.js$/i.test(path)) {
    event.respondWith(networkFetch(req, url));
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
