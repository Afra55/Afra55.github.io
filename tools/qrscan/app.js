(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const video = $("#qs-video");
  const canvas = $("#qs-canvas");
  const preview = $("#qs-preview");
  const statusEl = $("#qs-status");
  const errEl = $("#qs-error");
  const supportEl = $("#qs-support");
  const resultPanel = $("#qs-result");
  const resultText = $("#qs-text");
  const resultLabel = $("#qs-text-label");
  const hitListEl = $("#qs-hit-list");
  const installCard = $("#qs-install");
  const installBtn = $("#qs-install-btn");
  const installHint = $("#qs-install-hint");
  const startBtn = $("#qs-start");
  const stopBtn = $("#qs-stop");
  const againBtn = $("#qs-again");
  const copyBtn = $("#qs-copy");
  const openBtn = $("#qs-open");
  const fileBtn = $("#qs-file");

  let stream = null;
  let raf = 0;
  let scanning = false;
  let decodeBusy = false;
  let frameSkip = 0;
  let deferredPrompt = null;
  let libsReady = null;
  let userStopped = false;
  let lastFrame = null;
  let hits = [];
  let activeHit = 0;

  const Scan = () => window.DevToolsCodeScan;

  function isStandalone() {
    try {
      if (window.matchMedia("(display-mode: standalone)").matches) return true;
      if (window.matchMedia("(display-mode: window-controls-overlay)").matches) return true;
    } catch (_) {}
    return window.navigator.standalone === true;
  }

  function setStatus(text, kind) {
    if (!statusEl) return;
    statusEl.textContent = text || "";
    statusEl.classList.toggle("error", kind === "error");
    statusEl.classList.toggle("ok", kind === "ok");
  }

  function setError(text) {
    if (!errEl) return;
    const msg = String(text || "").trim();
    errEl.hidden = !msg;
    errEl.textContent = msg;
  }

  function toast(msg) {
    setStatus(msg, "ok");
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`无法加载 ${src}`));
      document.head.appendChild(s);
    });
  }

  function ensureLibs() {
    if (libsReady) return libsReady;
    libsReady = (async () => {
      if (!window.DevToolsCodeScan) {
        await loadScript("../lib/code-scan.js");
      }
      if (!globalThis.ZXing?.MultiFormatReader) {
        await loadScript("../vendor/zxing-library.min.js");
      }
      if (typeof globalThis.jsQR !== "function") {
        try {
          await loadScript("../vendor/jsQR.js");
        } catch (_) {
          /* jsQR 可选 */
        }
      }
      if (!window.DevToolsCodeScan) throw new Error("扫码模块未就绪");
      await window.DevToolsCodeScan.ensureBarcodeDetector();
      if (!globalThis.ZXing?.MultiFormatReader && typeof globalThis.jsQR !== "function") {
        throw new Error("扫码库加载失败");
      }
    })().catch((err) => {
      libsReady = null;
      throw err;
    });
    return libsReady;
  }

  function looksLikeUrl(text) {
    return /^(https?:\/\/|www\.)/i.test(String(text || "").trim());
  }

  function normalizeUrl(text) {
    const t = String(text || "").trim();
    if (/^https?:\/\//i.test(t)) return t;
    if (/^www\./i.test(t)) return `https://${t}`;
    return t;
  }

  function paintHitBoxes(list, activeIndex) {
    if (!canvas || !lastFrame) return;
    const ctx = canvas.getContext("2d");
    ctx.putImageData(lastFrame, 0, 0);
    list.forEach((hit, i) => {
      const b = hit.bbox;
      if (!b) return;
      const on = i === activeIndex;
      ctx.strokeStyle = on ? "#2ec4b6" : "rgba(46,196,182,0.75)";
      ctx.lineWidth = on ? 4 : 2;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      const label = String(i + 1);
      ctx.font = "bold 14px system-ui,sans-serif";
      const padX = 6;
      const th = 18;
      const tw = ctx.measureText(label).width + padX * 2;
      const lx = Math.max(0, Math.min(b.x, canvas.width - tw));
      const ly = Math.max(th, b.y);
      ctx.fillStyle = "#2ec4b6";
      ctx.fillRect(lx, ly - th, tw, th);
      ctx.fillStyle = "#06241f";
      ctx.fillText(label, lx + padX, ly - 4);
    });
  }

  function selectHit(index) {
    if (!hits.length) return;
    activeHit = Math.max(0, Math.min(index, hits.length - 1));
    const hit = hits[activeHit];
    resultText.value = hit.text;
    if (resultLabel) {
      resultLabel.textContent =
        hits.length > 1 ? `扫描结果（${hits.length} 个，当前第 ${activeHit + 1}）` : "扫描结果";
    }
    hitListEl?.querySelectorAll(".hit-item").forEach((el, i) => {
      el.classList.toggle("is-active", i === activeHit);
    });
    paintHitBoxes(hits, activeHit);
    if (openBtn) {
      const ok = looksLikeUrl(hit.text);
      openBtn.hidden = !ok;
      openBtn.disabled = !ok;
    }
  }

  function renderHitList(list) {
    if (!hitListEl) return;
    hitListEl.innerHTML = "";
    if (list.length < 2) {
      hitListEl.hidden = true;
      return;
    }
    hitListEl.hidden = false;
    list.forEach((hit, i) => {
      const li = document.createElement("li");
      li.className = "hit-item" + (i === activeHit ? " is-active" : "");
      li.innerHTML =
        `<span class="hit-num">${i + 1}</span>` +
        `<div><p class="hit-fmt">${hit.format || "码"}</p><p class="hit-text"></p></div>` +
        `<button type="button" class="ghost">复制</button>`;
      li.querySelector(".hit-text").textContent = hit.text;
      li.addEventListener("click", () => selectHit(i));
      li.querySelector("button")?.addEventListener("click", async (ev) => {
        ev.stopPropagation();
        selectHit(i);
        try {
          await navigator.clipboard.writeText(hit.text);
          toast("已复制");
        } catch (_) {
          toast("请长按结果手动复制");
        }
      });
      hitListEl.appendChild(li);
    });
  }

  function showHits(list, meta) {
    const found = (list || []).filter((h) => h?.text);
    if (!found.length) return;
    hits = found;
    activeHit = 0;
    resultPanel.hidden = false;
    document.body.classList.add("has-result");
    if (canvas) {
      canvas.hidden = false;
      canvas.classList.add("hit-preview");
    }
    if (preview) preview.hidden = true;
    if (video) video.hidden = true;
    setStatus(found.length > 1 ? `已识别 ${found.length} 个码` : "已识别", "ok");
    setError("");
    if (startBtn) {
      startBtn.hidden = false;
      startBtn.textContent = "继续扫";
    }
    if (stopBtn) stopBtn.hidden = true;
    renderHitList(found);
    selectHit(0);
    try {
      if (navigator.vibrate) navigator.vibrate(40);
    } catch (_) {}
    void meta;
  }

  function stopCamera({ fromUser } = {}) {
    if (fromUser) userStopped = true;
    scanning = false;
    decodeBusy = false;
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      stream = null;
    }
    if (video) {
      try {
        video.pause();
      } catch (_) {}
      video.srcObject = null;
      video.hidden = true;
    }
    const showingResult = resultPanel && !resultPanel.hidden;
    if (startBtn) {
      startBtn.hidden = false;
      startBtn.textContent = showingResult ? "继续扫" : "扫码";
    }
    if (stopBtn) stopBtn.hidden = true;
  }

  function drawVideoFrame() {
    if (!video || !canvas) return null;
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) return null;
    const maxSide = 960;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const dw = Math.max(1, Math.round(w * scale));
    const dh = Math.max(1, Math.round(h * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    canvas.width = dw;
    canvas.height = dh;
    ctx.drawImage(video, 0, 0, dw, dh);
    return { imageData: ctx.getImageData(0, 0, dw, dh), w: dw, h: dh };
  }

  function scanFrame() {
    if (!scanning || !video || !canvas) return;
    frameSkip = (frameSkip + 1) % 2;
    if (!decodeBusy && frameSkip === 0 && video.readyState >= 2) {
      const drawn = drawVideoFrame();
      if (drawn) {
        decodeBusy = true;
        Promise.resolve()
          .then(() =>
            Scan().decodeAllImageData(drawn.imageData, {
              bitmapSource: canvas,
              preferNative: true,
            })
          )
          .then((found) => {
            if (!scanning) return;
            if (found?.length) {
              lastFrame = drawn.imageData;
              showHits(found, `摄像头 · ${found.length} 个`);
              stopCamera();
            }
          })
          .catch(() => {})
          .finally(() => {
            decodeBusy = false;
          });
      }
    }
    if (scanning) raf = requestAnimationFrame(scanFrame);
  }

  async function startCamera() {
    userStopped = false;
    setError("");
    setStatus("");
    if (resultPanel) resultPanel.hidden = true;
    document.body.classList.remove("has-result");
    if (resultText) resultText.value = "";
    hits = [];
    lastFrame = null;
    if (hitListEl) {
      hitListEl.innerHTML = "";
      hitListEl.hidden = true;
    }
    if (canvas) {
      canvas.hidden = true;
      canvas.classList.remove("hit-preview");
    }
    await ensureLibs();
    stopCamera();
    userStopped = false;
    if (preview) {
      preview.hidden = true;
      preview.removeAttribute("src");
    }
    try {
      stream = await Scan().getRearCameraStream();
    } catch (err) {
      setError(Scan().cameraErrorMessage(err));
      setStatus("点「开始扫码」重试", "error");
      if (startBtn) startBtn.hidden = false;
      if (stopBtn) stopBtn.hidden = true;
      return;
    }
    video.hidden = false;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.muted = true;
    video.srcObject = stream;
    try {
      await video.play();
    } catch (err) {
      setError(`摄像头画面无法播放：${err.message || err}`);
      stopCamera();
      return;
    }
    scanning = true;
    if (startBtn) startBtn.hidden = true;
    if (stopBtn) stopBtn.hidden = false;
    setStatus("");
    scanFrame();
  }

  function decodeFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = async () => {
        try {
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          const maxSide = 1400;
          let w = img.naturalWidth || img.width;
          let h = img.naturalHeight || img.height;
          const scale = Math.min(1, maxSide / Math.max(w, h));
          w = Math.max(1, Math.round(w * scale));
          h = Math.max(1, Math.round(h * scale));
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(img, 0, 0, w, h);
          const found = await Scan().decodeAllImageData(ctx.getImageData(0, 0, w, h), {
            bitmapSource: canvas,
            preferNative: true,
          });
          if (!found.length) throw new Error("未识别到条码/二维码，请换更清晰的图片");
          lastFrame = ctx.getImageData(0, 0, w, h);
          if (preview) {
            preview.hidden = true;
            preview.removeAttribute("src");
          }
          URL.revokeObjectURL(url);
          resolve({ hits: found, meta: `图片 · ${found.length} 个 · ${file.name}` });
        } catch (err) {
          URL.revokeObjectURL(url);
          reject(err);
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("图片加载失败"));
      };
      img.src = url;
    });
  }

  function syncInstallUi() {
    const standalone = isStandalone();
    if (standalone) {
      if (installCard) installCard.hidden = true;
      document.documentElement.classList.add("is-pwa-standalone");
      return;
    }
    if (installCard) installCard.hidden = false;
    if (installBtn) {
      const can = Boolean(deferredPrompt);
      installBtn.hidden = !can;
      installBtn.disabled = !can;
    }
    if (installHint) {
      installHint.textContent = deferredPrompt
        ? "浏览器已允许一键安装。点下方按钮即可加到桌面。"
        : "若没有安装按钮：用 Chrome 打开本页 → 右上角 ⋮ →「安装应用」或「添加到主屏幕」。";
    }
  }

  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredPrompt = e;
    syncInstallUi();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    toast("已添加到桌面");
    syncInstallUi();
  });

  installBtn?.addEventListener("click", async () => {
    if (!deferredPrompt) {
      syncInstallUi();
      return;
    }
    try {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch (_) {}
    deferredPrompt = null;
    syncInstallUi();
  });

  startBtn?.addEventListener("click", () => {
    startCamera().catch((err) => setError(Scan()?.cameraErrorMessage(err) || err.message || String(err)));
  });
  stopBtn?.addEventListener("click", () => {
    stopCamera({ fromUser: true });
    setStatus("已关闭摄像头");
  });
  againBtn?.addEventListener("click", () => {
    startCamera().catch((err) => setError(Scan()?.cameraErrorMessage(err) || err.message || String(err)));
  });
  copyBtn?.addEventListener("click", async () => {
    const text = resultText?.value || "";
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      toast("已复制");
    } catch (_) {
      resultText.focus();
      resultText.select();
      toast("请长按结果手动复制");
    }
  });
  openBtn?.addEventListener("click", () => {
    const href = normalizeUrl(resultText?.value || "");
    if (!looksLikeUrl(href)) return;
    window.open(href, "_blank", "noopener,noreferrer");
  });
  fileBtn?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError("");
    stopCamera({ fromUser: true });
    try {
      await ensureLibs();
      const { hits: found, meta } = await decodeFromFile(file);
      showHits(found, meta);
    } catch (err) {
      setError(err.message || String(err));
    }
  });

  window.addEventListener("pagehide", () => stopCamera());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      stopCamera();
      return;
    }
    if (!userStopped && resultPanel?.hidden && !scanning) {
      startCamera().catch(() => {});
    }
  });

  if ("serviceWorker" in navigator) {
    const ready = () => {
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
    };
    if (document.readyState === "complete") ready();
    else window.addEventListener("load", ready, { once: true });
  }

  syncInstallUi();
  ensureLibs()
    .then(() => startCamera())
    .catch((err) => {
      setError(Scan()?.cameraErrorMessage?.(err) || err.message || String(err));
      if (startBtn) {
        startBtn.hidden = false;
        startBtn.textContent = "扫码";
      }
    });
})();
