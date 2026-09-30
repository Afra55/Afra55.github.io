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

  function showResult(text, meta) {
    resultPanel.hidden = false;
    document.body.classList.add("has-result");
    resultText.value = text;
    setStatus("");
    setError("");
    if (startBtn) {
      startBtn.hidden = false;
      startBtn.textContent = "继续扫";
    }
    if (stopBtn) stopBtn.hidden = true;
    if (openBtn) {
      const ok = looksLikeUrl(text);
      openBtn.hidden = !ok;
      openBtn.disabled = !ok;
    }
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
            Scan().decodeImageData(drawn.imageData, {
              bitmapSource: canvas,
              preferNative: true,
            })
          )
          .then((hit) => {
            if (!scanning) return;
            if (hit?.text) {
              const eng = hit.engine ? ` · ${hit.engine}` : "";
              showResult(hit.text, `摄像头 · ${hit.format || "码"}${eng} · ${drawn.w}×${drawn.h}`);
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
          const hit = await Scan().decodeImageData(ctx.getImageData(0, 0, w, h), {
            bitmapSource: canvas,
            preferNative: true,
          });
          if (!hit?.text) throw new Error("未识别到条码/二维码，请换更清晰的图片");
          if (preview) {
            preview.hidden = false;
            preview.src = url;
          } else {
            URL.revokeObjectURL(url);
          }
          const eng = hit.engine ? ` · ${hit.engine}` : "";
          resolve({ text: hit.text, meta: `图片 · ${hit.format || "码"}${eng} · ${file.name}` });
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
      const { text, meta } = await decodeFromFile(file);
      showResult(text, meta);
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
