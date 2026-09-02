(() => {
  "use strict";

  const P = window.DevToolsPure;
  const K = window.DevToolsExtraKit;
  if (!P || !K) return;
  const { $, $$, setError, toast, bindPanel, flushPendingFileInput, formatKb, EBind } = K;
  const escapeHtml = P.escapeHtml;

    let wrap;
    let meta;
    let qrVideo;
    let qrCanvas;
    let qrPreview;
    let qrDecoded;
    let qrDecodeMeta;
    let qrDecodeError;
    let qrCamStart;
    let qrCamStop;
    const QR_CAP_L40 = 2953;
  
    function qrPayloadBytes(text) {
      const s = String(text);
      const encoded = encodeURI(s).replace(/%[0-9a-fA-F]{2}/g, "a");
      return encoded.length + (encoded.length !== s.length ? 3 : 0);
    }
  
    function renderQrBox(text, level) {
      const el = document.createElement("div");
      el.className = "qr-box";
      // eslint-disable-next-line no-new
      new QRCode(el, {
        text,
        width: 180,
        height: 180,
        colorDark: "#0b1220",
        colorLight: "#ffffff",
        correctLevel: level,
      });
      return el;
    }
  
    function splitQrChunks(text) {
      const total = String(text);
      let n = Math.max(2, Math.ceil(qrPayloadBytes(total) / (QR_CAP_L40 - 16)));
      for (; n < 99; n += 1) {
        const chunks = [];
        let pos = 0;
        let ok = true;
        for (let i = 0; i < n; i += 1) {
          const prefix = `[${i + 1}/${n}]`;
          const budget = QR_CAP_L40 - qrPayloadBytes(prefix);
          if (budget < 8) {
            ok = false;
            break;
          }
          let take = Math.min(total.length - pos, budget);
          while (take > 0 && qrPayloadBytes(prefix + total.slice(pos, pos + take)) > QR_CAP_L40) take -= 1;
          if (take <= 0) {
            ok = false;
            break;
          }
          chunks.push(prefix + total.slice(pos, pos + take));
          pos += take;
        }
        if (ok && pos >= total.length) return chunks;
      }
      return [];
    }
  
    function generateQr() {
      const text = $("#qr-text")?.value.trim() || "";
      if (!wrap) return;
      wrap.innerHTML = "";
      if (meta) meta.textContent = "";
      if (!text) {
        setError($("#qr-error"), "请输入内容");
        return;
      }
      try {
        if (typeof QRCode === "undefined") throw new Error("QRCode 库未加载");
        const tries = [
          { level: QRCode.CorrectLevel.M, label: "标准纠错" },
          { level: QRCode.CorrectLevel.L, label: "低纠错（容量更大）" },
        ];
        for (const { level, label } of tries) {
          try {
            wrap.appendChild(renderQrBox(text, level));
            if (meta) meta.textContent = `已生成 · ${label} · 约 ${text.length} 字`;
            setError($("#qr-error"), "");
            return;
          } catch (err) {
            if (!/Too long|overflow/i.test(String(err.message || err))) throw err;
          }
        }
        const chunks = splitQrChunks(text);
        if (!chunks.length) throw new Error("内容过长，无法生成二维码");
        chunks.forEach((payload, i) => {
          const piece = document.createElement("div");
          piece.className = "qr-piece";
          const lab = document.createElement("p");
          lab.className = "hint tight qr-piece-label";
          lab.textContent = `第 ${i + 1}/${chunks.length} 张`;
          piece.appendChild(lab);
          piece.appendChild(renderQrBox(payload, QRCode.CorrectLevel.L));
          wrap.appendChild(piece);
        });
        if (meta) {
          meta.textContent = `内容较长，已拆成 ${chunks.length} 张二维码。扫描后去掉 [n/m] 前缀并按顺序拼接。`;
        }
        setError($("#qr-error"), "");
      } catch (err) {
        setError($("#qr-error"), err.message || String(err));
      }
    }
    bindPanel("qrcode", () => {
          wrap = $("#qr-box-wrap");
          meta = $("#qr-meta");
        qrVideo = $("#qr-video");
        qrCanvas = $("#qr-scan-canvas");
        qrPreview = $("#qr-scan-preview");
        qrDecoded = $("#qr-decoded");
        qrDecodeMeta = $("#qr-decode-meta");
        qrDecodeError = $("#qr-decode-error");
        qrCamStart = $("#qr-cam-start");
        qrCamStop = $("#qr-cam-stop");
  
        $("#qr-gen")?.addEventListener("click", generateQr);
    if ($("#qr-text")) generateQr();
  
    let qrStream = null;
    let qrScanTimer = 0;
    let qrScanning = false;
  
    function decodeImageData(imageData) {
      if (typeof jsQR !== "function") throw new Error("jsQR 库未加载");
      return jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "attemptBoth",
      });
    }
  
    function showDecoded(text, meta) {
      qrDecoded.value = text;
      qrDecodeMeta.textContent = meta || "";
      setError(qrDecodeError, "");
      toast("已识别二维码");
    }
  
    function decodeFromImageElement(img, meta) {
      const canvas = qrCanvas;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const maxSide = 1200;
      let w = img.naturalWidth || img.videoWidth || img.width;
      let h = img.naturalHeight || img.videoHeight || img.height;
      if (!w || !h) throw new Error("无法读取图像尺寸");
      const scale = Math.min(1, maxSide / Math.max(w, h));
      w = Math.max(1, Math.round(w * scale));
      h = Math.max(1, Math.round(h * scale));
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);
      const code = decodeImageData(ctx.getImageData(0, 0, w, h));
      if (!code) throw new Error("未识别到二维码，请换更清晰的图片试试");
      showDecoded(code.data, meta || `已识别 · ${w}×${h}`);
      return code.data;
    }
  
    function stopCamera() {
      qrScanning = false;
      if (qrScanTimer) {
        cancelAnimationFrame(qrScanTimer);
        qrScanTimer = 0;
      }
      if (qrStream) {
        qrStream.getTracks().forEach((t) => t.stop());
        qrStream = null;
      }
      if (qrVideo) {
        qrVideo.pause();
        qrVideo.srcObject = null;
        qrVideo.hidden = true;
      }
      if (qrCamStop) qrCamStop.hidden = true;
      if (qrCamStart) qrCamStart.hidden = false;
    }
  
    function scanCameraFrame() {
      if (!qrScanning || !qrVideo) return;
      if (qrVideo.readyState >= 2) {
        try {
          const canvas = qrCanvas;
          const ctx = canvas.getContext("2d", { willReadFrequently: true });
          const w = qrVideo.videoWidth;
          const h = qrVideo.videoHeight;
          if (w && h) {
            canvas.width = w;
            canvas.height = h;
            ctx.drawImage(qrVideo, 0, 0, w, h);
            const code = decodeImageData(ctx.getImageData(0, 0, w, h));
            if (code) {
              showDecoded(code.data, `摄像头识别 · ${w}×${h}`);
              stopCamera();
              return;
            }
          }
        } catch (_) {
          // keep scanning
        }
      }
      qrScanTimer = requestAnimationFrame(scanCameraFrame);
    }
  
    $("#qr-file")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      stopCamera();
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        try {
          qrPreview.hidden = false;
          qrPreview.src = url;
          decodeFromImageElement(img, `图片识别 · ${file.name}`);
        } catch (err) {
          setError(qrDecodeError, err.message || String(err));
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        setError(qrDecodeError, "图片加载失败");
      };
      img.src = url;
      e.target.value = "";
    });
  
    qrCamStart?.addEventListener("click", async () => {
      setError(qrDecodeError, "");
      if (!navigator.mediaDevices?.getUserMedia) {
        setError(qrDecodeError, "当前浏览器不支持摄像头");
        return;
      }
      try {
        stopCamera();
        qrStream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" } },
        });
        qrPreview.hidden = true;
        qrVideo.hidden = false;
        qrVideo.srcObject = qrStream;
        await qrVideo.play();
        qrScanning = true;
        qrCamStart.hidden = true;
        qrCamStop.hidden = false;
        qrDecodeMeta.textContent = "摄像头扫描中…对准二维码即可";
        scanCameraFrame();
      } catch (err) {
        stopCamera();
        setError(qrDecodeError, `无法打开摄像头：${err.message || err}`);
      }
    });
  
    qrCamStop?.addEventListener("click", () => {
      stopCamera();
      qrDecodeMeta.textContent = "已关闭摄像头";
    });
  
    window.addEventListener("pagehide", stopCamera);
  
    
    });

  window.DevToolsExtraBoot = window.DevToolsExtraBoot || {};
  window.DevToolsExtraBoot["qrcode"] = () => { try { generateQr(); } catch (_) {} };
})();
