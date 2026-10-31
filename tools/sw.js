/* DevTools PWA service worker — 轻量壳缓存，不预缓存大体积 wasm/编码器 */
/* eslint-disable no-restricted-globals */
"use strict";

const SHELL_CACHE = "devtools-shell-20261031-175045";
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
  // 大体积编码器 / wasm 壳：不进 SW（动态 import 自带 ?v=；避免坏缓存粘滞）
  if (/\/vendor\/(ffmpeg|gifsicle|gifski|gif\.worker|omggif|jsquash)/i.test(path)) return true;
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
  if (/\/vendor\/(ffmpeg|gifsicle|gifski|gif\.worker|omggif|jsquash)/i.test(path)) return false;
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

  const path = url.pathname || "";

  // 唯二「网络优先」：构建戳。页面其余时间缓存优先即时可用；
  // 客户端 tools-build 探测到远端 BUILD 更新后再清壳缓存并刷新。
  if (/\/(?:tools-build)\.js$/i.test(path) || /\/lib\/tools-build\.js$/i.test(path)) {
    event.respondWith(networkFetch(req, url));
    return;
  }

  // HTML / JS / CSS / 面板等：缓存优先，命中即返回，后台 stale-while-revalidate
  // （资源带 ?v=<BUILD>；发版改 SHELL_CACHE 名会清旧壳；BUILD 探测负责拉新 HTML）
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = networkFetch(req, url).catch(() => {
        if (req.mode === "navigate") {
          return caches.match("./index.html").then((r) => r || caches.match("./"));
        }
        return undefined;
      });
      if (cached) {
        event.waitUntil(network.catch(() => {}));
        return cached;
      }
      return network;
    })
  );
});
