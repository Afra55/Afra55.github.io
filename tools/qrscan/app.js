(() => {
  "use strict";

  const $ = (sel) => document.querySelector(sel);
  const video = $("#qs-video");
  const canvas = $("#qs-canvas");
  const preview = $("#qs-preview");
  const statusEl = $("#qs-status");
  const errEl = $("#qs-error");
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
  let deferredPrompt = null;
  let jsQrReady = null;

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

  function loadJsQr() {
    if (typeof globalThis.jsQR === "function") return Promise.resolve();
    if (jsQrReady) return jsQrReady;
    jsQrReady = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "../vendor/jsQR.js";
      s.async = true;
      s.onload = () => (typeof globalThis.jsQR === "function" ? resolve() : reject(new Error("jsQR 加载失败")));
      s.onerror = () => reject(new Error("无法加载扫码库"));
      document.head.appendChild(s);
    }).catch((err) => {
      jsQrReady = null;
      throw err;
    });
    return jsQrReady;
  }

  function decodeImageData(imageData) {
    if (typeof globalThis.jsQR !== "function") throw new Error("扫码库未就绪");
    return globalThis.jsQR(imageData.data, imageData.width, imageData.height, {
      inversionAttempts: "attemptBoth",
    });
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
    resultText.value = text;
    setStatus(meta || "已识别", "ok");
    setError("");
    if (openBtn) {
      const ok = looksLikeUrl(text);
      openBtn.hidden = !ok;
      openBtn.disabled = !ok;
    }
    try {
      if (navigator.vibrate) navigator.vibrate(40);
    } catch (_) {}
  }

  function stopCamera() {
    scanning = false;
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
    if (startBtn) startBtn.hidden = false;
    if (stopBtn) stopBtn.hidden = true;
  }

  function scanFrame() {
    if (!scanning || !video || !canvas) return;
    if (video.readyState >= 2) {
      try {
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        const w = video.videoWidth;
        const h = video.videoHeight;
        if (w && h) {
          canvas.width = w;
          canvas.height = h;
          ctx.drawImage(video, 0, 0, w, h);
          const code = decodeImageData(ctx.getImageData(0, 0, w, h));
          if (code && code.data) {
            showResult(code.data, `摄像头识别 · ${w}×${h}`);
            stopCamera();
            return;
          }
        }
      } catch (_) {
        /* keep scanning */
      }
    }
    raf = requestAnimationFrame(scanFrame);
  }

  async function startCamera() {
    setError("");
    await loadJsQr();
    if (!navigator.mediaDevices?.getUserMedia) {
      setError("当前浏览器不支持摄像头，请用 Chrome 打开本页");
      return;
    }
    stopCamera();
    if (preview) {
      preview.hidden = true;
      preview.removeAttribute("src");
    }
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
    } catch (err) {
      setError(`无法打开摄像头：${err.message || err}（请允许权限后重试）`);
      return;
    }
    video.hidden = false;
    video.srcObject = stream;
    await video.play();
    scanning = true;
    if (startBtn) startBtn.hidden = true;
    if (stopBtn) stopBtn.hidden = false;
    setStatus("对准二维码，自动识别…");
    scanFrame();
  }

  function decodeFromFile(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
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
          const code = decodeImageData(ctx.getImageData(0, 0, w, h));
          if (!code) throw new Error("未识别到二维码，请换更清晰的图片");
          if (preview) {
            preview.hidden = false;
            preview.src = url;
          }
          resolve({ text: code.data, meta: `图片识别 · ${file.name}` });
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
    startCamera().catch((err) => setError(err.message || String(err)));
  });
  stopBtn?.addEventListener("click", () => {
    stopCamera();
    setStatus("已关闭摄像头");
  });
  againBtn?.addEventListener("click", () => {
    resultPanel.hidden = true;
    startCamera().catch((err) => setError(err.message || String(err)));
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
    stopCamera();
    try {
      await loadJsQr();
      const { text, meta } = await decodeFromFile(file);
      showResult(text, meta);
    } catch (err) {
      setError(err.message || String(err));
    }
  });

  window.addEventListener("pagehide", stopCamera);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") stopCamera();
  });

  if ("serviceWorker" in navigator) {
    const ready = () => {
      navigator.serviceWorker.register("./sw.js", { scope: "./" }).catch(() => {});
    };
    if (document.readyState === "complete") ready();
    else window.addEventListener("load", ready, { once: true });
  }

  syncInstallUi();
  setStatus("点「开始扫码」打开后置摄像头");
})();
