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
    let qrDecodeList;
    let qrDecodedLabel;
    let qrLastFrame = null;
    let qrHits = [];
    let qrActiveHit = 0;
    const QR_CAP_L40 = 2953;
  
    function qrPayloadBytes(text) {
      const s = String(text);
      const encoded = encodeURI(s).replace(/%[0-9a-fA-F]{2}/g, "a");
      return encoded.length + (encoded.length !== s.length ? 3 : 0);
    }
  
    function qrEccFromLevel(level) {
      const qg = globalThis.qrcodegen?.QrCode;
      const map = globalThis.QRCode?.CorrectLevel;
      if (!qg) return null;
      if (map) {
        if (level === map.L) return qg.Ecc.LOW;
        if (level === map.M) return qg.Ecc.MEDIUM;
        if (level === map.Q) return qg.Ecc.QUARTILE;
        if (level === map.H) return qg.Ecc.HIGH;
      }
      return qg.Ecc.MEDIUM;
    }

    /** 按模块数放大：长文本格子更密，像素也要更大才方便手机扫 */
    function qrTargetPx(moduleCount) {
      const n = Math.max(21, Number(moduleCount) || 29);
      const border = 4;
      // 目标约 5～6px/模块，最短边至少 360，最长 720（屏上可扫）
      const raw = (n + border * 2) * (n >= 57 ? 6 : 5);
      return Math.min(720, Math.max(360, raw));
    }

    function drawQrCanvas(parent, qr, px) {
      const border = 4;
      const n = qr.size;
      const target = px || qrTargetPx(n);
      const scale = Math.max(2, Math.floor(target / (n + border * 2)));
      const size = (n + border * 2) * scale;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "二维码");
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = "#0b1220";
      for (let y = 0; y < n; y += 1) {
        for (let x = 0; x < n; x += 1) {
          if (qr.getModule(x, y)) {
            ctx.fillRect((x + border) * scale, (y + border) * scale, scale, scale);
          }
        }
      }
      parent.appendChild(canvas);
    }

    function qrCorrectLevels() {
      const map = globalThis.QRCode?.CorrectLevel;
      const qg = globalThis.qrcodegen?.QrCode;
      if (map) {
        return [
          { level: map.M, label: "标准纠错" },
          { level: map.L, label: "低纠错（容量更大）" },
        ];
      }
      if (qg) {
        return [
          { level: qg.Ecc.MEDIUM, label: "标准纠错", qg: true },
          { level: qg.Ecc.LOW, label: "低纠错（容量更大）", qg: true },
        ];
      }
      return [];
    }

    function renderQrBoxWithEcc(text, ecc, { qgDirect = false } = {}) {
      if (qgDirect && globalThis.qrcodegen?.QrCode) {
        const el = document.createElement("div");
        el.className = "qr-box";
        const qr = globalThis.qrcodegen.QrCode.encodeSegments(
          /[^\u0000-\u007f]/.test(text)
            ? [
                globalThis.qrcodegen.QrSegment.makeEci(26),
                globalThis.qrcodegen.QrSegment.makeBytes(globalThis.qrcodegen.QrSegment.toUtf8ByteArray(text)),
              ]
            : globalThis.qrcodegen.QrSegment.makeSegments(text),
          ecc
        );
        drawQrCanvas(el, qr);
        return el;
      }
      return renderQrBox(text, ecc);
    }

    function encodeQrUtf8(text, level) {
      const QrCode = globalThis.qrcodegen?.QrCode;
      const QrSegment = globalThis.qrcodegen?.QrSegment;
      if (!QrCode || !QrSegment) return null;
      const ecl = qrEccFromLevel(level) ?? QrCode.Ecc.MEDIUM;
      const segs = /[^\u0000-\u007f]/.test(text)
        ? [QrSegment.makeEci(26), QrSegment.makeBytes(QrSegment.toUtf8ByteArray(text))]
        : QrSegment.makeSegments(text);
      return QrCode.encodeSegments(segs, ecl);
    }

    function renderQrBox(text, level) {
      const el = document.createElement("div");
      el.className = "qr-box";
      const utf8Qr = encodeQrUtf8(text, level);
      if (utf8Qr) {
        drawQrCanvas(el, utf8Qr);
        return el;
      }
      if (typeof QRCode === "undefined") throw new Error("QRCode 库未加载");
      const side = qrTargetPx(41);
      // eslint-disable-next-line no-new
      new QRCode(el, {
        text,
        width: side,
        height: side,
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
        if (typeof QRCode === "undefined" && typeof globalThis.qrcodegen?.QrCode === "undefined") {
          throw new Error("QRCode 库未加载");
        }
        const tries = qrCorrectLevels();
        if (!tries.length) throw new Error("QRCode 库未加载");
        for (const { level, label, qg } of tries) {
          try {
            wrap.appendChild(renderQrBoxWithEcc(text, level, { qgDirect: Boolean(qg) }));
            const canvas = wrap.querySelector("canvas, img");
            const side = canvas?.width || canvas?.naturalWidth || 0;
            if (meta) {
              meta.textContent = side
                ? `已生成 · ${label} · 约 ${text.length} 字 · 图 ${side}×${side}px（可放大屏扫）`
                : `已生成 · ${label} · 约 ${text.length} 字`;
            }
            setError($("#qr-error"), "");
            return;
          } catch (err) {
            if (!/Too long|overflow/i.test(String(err.message || err))) throw err;
          }
        }
        const chunks = splitQrChunks(text);
        if (!chunks.length) throw new Error("内容过长，无法生成二维码");
        const lowLevel = globalThis.QRCode?.CorrectLevel?.L ?? globalThis.qrcodegen?.QrCode?.Ecc?.LOW;
        chunks.forEach((payload, i) => {
          const piece = document.createElement("div");
          piece.className = "qr-piece";
          const lab = document.createElement("p");
          lab.className = "hint tight qr-piece-label";
          lab.textContent = `第 ${i + 1}/${chunks.length} 张`;
          piece.appendChild(lab);
          piece.appendChild(
            renderQrBoxWithEcc(payload, lowLevel, { qgDirect: !globalThis.QRCode?.CorrectLevel })
          );
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
        qrDecodeList = $("#qr-decode-list");
        qrDecodedLabel = $("#qr-decoded-label");
        const qrSupportHint = $("#qr-support-hint");
  
        $("#qr-gen")?.addEventListener("click", generateQr);
    if ($("#qr-text")) generateQr();
  
    let qrStream = null;
    let qrScanTimer = 0;
    let qrScanning = false;
    let qrDecodeBusy = false;
    let qrFrameSkip = 0;
    let qrUserStopped = false;
    let qrLibsReady = null;

    const Scan = () => window.DevToolsCodeScan;

    function ensureScanLibs() {
      if (qrLibsReady) return qrLibsReady;
      qrLibsReady = (async () => {
        if (!window.DevToolsCodeScan) {
          await window.DevToolsLazy.loadScript("./lib/code-scan.js");
        }
        if (window.DevToolsLazy?.loadVendor) {
          try {
            await window.DevToolsLazy.loadVendor("zxing");
          } catch (_) {}
          try {
            await window.DevToolsLazy.loadVendor("jsQR");
          } catch (_) {}
        }
        if (!window.DevToolsCodeScan) throw new Error("扫码模块未就绪");
        await window.DevToolsCodeScan.ensureBarcodeDetector();
        if (qrSupportHint) qrSupportHint.textContent = window.DevToolsCodeScan.supportedHint();
      })().catch((err) => {
        qrLibsReady = null;
        throw err;
      });
      return qrLibsReady;
    }
  
    function showResultUi(on) {
      const stage = $("#qr-scan-stage");
      const head = $("#qr-result-head");
      const reticle = stage?.querySelector(".qr-scan-reticle");
      stage?.classList.toggle("is-result-only", !!on);
      if (reticle) reticle.hidden = !!on;
      if (head) head.hidden = !on;
      if (qrDecoded) qrDecoded.hidden = !on;
      if (qrDecodeList) qrDecodeList.hidden = !on || qrHits.length < 2;
      if (qrDecodeMeta) qrDecodeMeta.hidden = true;
      if (qrCamStart) {
        qrCamStart.hidden = !on;
        qrCamStart.textContent = "继续扫";
      }
      if (qrCamStop) qrCamStop.hidden = true;
    }

    function copyHitText(text) {
      const t = String(text || "");
      if (!t) return;
      const done = () => toast("已复制");
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(t).then(done).catch(() => {
          if (qrDecoded) {
            qrDecoded.focus();
            qrDecoded.select();
          }
          toast("请手动复制");
        });
      } else {
        toast("请手动复制");
      }
    }

    function paintHitBoxes(hits, activeIndex) {
      if (!qrCanvas || !qrLastFrame) return;
      const ctx = qrCanvas.getContext("2d");
      ctx.putImageData(qrLastFrame, 0, 0);
      hits.forEach((hit, i) => {
        const b = hit.bbox;
        if (!b) return;
        const active = i === activeIndex;
        const x = b.x;
        const y = b.y;
        ctx.strokeStyle = active ? "#2ec4b6" : "rgba(46,196,182,0.75)";
        ctx.lineWidth = active ? 4 : 2;
        ctx.strokeRect(x, y, b.w, b.h);
        const label = String(i + 1);
        ctx.font = "bold 14px system-ui,sans-serif";
        const padX = 6;
        const th = 18;
        const tw = ctx.measureText(label).width + padX * 2;
        const lx = Math.max(0, Math.min(x, qrCanvas.width - tw));
        const ly = Math.max(th, y);
        ctx.fillStyle = "#2ec4b6";
        ctx.fillRect(lx, ly - th, tw, th);
        ctx.fillStyle = "#06241f";
        ctx.fillText(label, lx + padX, ly - 4);
      });
    }

    function selectHit(index) {
      if (!qrHits.length) return;
      qrActiveHit = Math.max(0, Math.min(index, qrHits.length - 1));
      const hit = qrHits[qrActiveHit];
      if (qrDecoded) qrDecoded.value = hit.text;
      if (qrDecodedLabel) {
        qrDecodedLabel.textContent =
          qrHits.length > 1 ? `扫描结果（${qrHits.length} 个，当前第 ${qrActiveHit + 1}）` : "扫描结果";
      }
      qrDecodeList?.querySelectorAll(".qr-hit-item").forEach((el, i) => {
        el.classList.toggle("is-active", i === qrActiveHit);
      });
      paintHitBoxes(qrHits, qrActiveHit);
    }

    function renderHitList(hits) {
      if (!qrDecodeList) return;
      qrDecodeList.innerHTML = "";
      if (hits.length < 2) {
        qrDecodeList.hidden = true;
        return;
      }
      qrDecodeList.hidden = false;
      hits.forEach((hit, i) => {
        const li = document.createElement("li");
        li.className = "qr-hit-item" + (i === qrActiveHit ? " is-active" : "");
        li.innerHTML =
          `<span class="qr-hit-num">${i + 1}</span>` +
          `<div class="qr-hit-body"><p class="qr-hit-fmt">${escapeHtml(hit.format || "码")}</p>` +
          `<p class="qr-hit-text">${escapeHtml(hit.text)}</p></div>` +
          `<button type="button" class="copy-btn qr-hit-copy">复制</button>`;
        li.addEventListener("click", () => selectHit(i));
        li.querySelector("button")?.addEventListener("click", (ev) => {
          ev.stopPropagation();
          selectHit(i);
          copyHitText(hit.text);
        });
        qrDecodeList.appendChild(li);
      });
    }

    function showHits(hits, metaText) {
      const list = (hits || []).filter((h) => h?.text);
      if (!list.length) return;
      qrHits = list;
      qrActiveHit = 0;
      if (qrCanvas) {
        qrCanvas.hidden = false;
        qrCanvas.classList.add("qr-hit-preview");
      }
      if (qrPreview) qrPreview.hidden = true;
      if (qrVideo) qrVideo.hidden = true;
      setError(qrDecodeError, "");
      showResultUi(true);
      renderHitList(list);
      selectHit(0);
      toast(list.length > 1 ? `已识别 ${list.length} 个码` : "已识别");
      void metaText;
    }

    async function decodeFromImageElement(img, metaText) {
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
      qrLastFrame = ctx.getImageData(0, 0, w, h);
      const hits = await Scan().decodeAllImageData(qrLastFrame, {
        bitmapSource: canvas,
        preferNative: true,
      });
      if (!hits.length) throw new Error("未识别到条码/二维码，请换更清晰的图片试试");
      const eng = hits[0].engine ? ` · ${hits[0].engine}` : "";
      showHits(hits, metaText || `已识别 ${hits.length} 个 · ${w}×${h}${eng}`);
      return hits;
    }
  
    function stopCamera({ fromUser } = {}) {
      if (fromUser) qrUserStopped = true;
      qrScanning = false;
      qrDecodeBusy = false;
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
      const hasResult = qrDecoded && !qrDecoded.hidden && String(qrDecoded.value || "").trim();
      if (qrCamStart) {
        qrCamStart.hidden = !hasResult;
        qrCamStart.textContent = hasResult ? "继续扫" : "扫码";
      }
    }

    function drawScanFrame() {
      if (!qrVideo || !qrCanvas) return null;
      const w0 = qrVideo.videoWidth;
      const h0 = qrVideo.videoHeight;
      if (!w0 || !h0) return null;
      const maxSide = 960;
      const scale = Math.min(1, maxSide / Math.max(w0, h0));
      const w = Math.max(1, Math.round(w0 * scale));
      const h = Math.max(1, Math.round(h0 * scale));
      const ctx = qrCanvas.getContext("2d", { willReadFrequently: true });
      qrCanvas.width = w;
      qrCanvas.height = h;
      ctx.drawImage(qrVideo, 0, 0, w, h);
      return { imageData: ctx.getImageData(0, 0, w, h), w, h };
    }
  
    function scanCameraFrame() {
      if (!qrScanning || !qrVideo) return;
      qrFrameSkip = (qrFrameSkip + 1) % 2;
      if (!qrDecodeBusy && qrFrameSkip === 0 && qrVideo.readyState >= 2) {
        const drawn = drawScanFrame();
        if (drawn) {
          qrDecodeBusy = true;
          Promise.resolve()
            .then(() =>
              Scan().decodeAllImageData(drawn.imageData, {
                bitmapSource: qrCanvas,
                preferNative: true,
              })
            )
            .then((hits) => {
              if (!qrScanning || !hits?.length) return;
              qrLastFrame = drawn.imageData;
              showHits(hits, `摄像头 · ${hits.length} 个 · ${drawn.w}×${drawn.h}`);
              stopCamera();
            })
            .catch(() => {})
            .finally(() => {
              qrDecodeBusy = false;
            });
        }
      }
      if (qrScanning) qrScanTimer = requestAnimationFrame(scanCameraFrame);
    }

    async function startCamera() {
      qrUserStopped = false;
      setError(qrDecodeError, "");
      if (qrDecoded) qrDecoded.value = "";
      qrHits = [];
      qrLastFrame = null;
      if (qrDecodeList) {
        qrDecodeList.innerHTML = "";
        qrDecodeList.hidden = true;
      }
      if (qrCanvas) {
        qrCanvas.hidden = true;
        qrCanvas.classList.remove("qr-hit-preview");
      }
      showResultUi(false);
      await ensureScanLibs();
      try {
        stopCamera();
        qrUserStopped = false;
        qrStream = await Scan().getRearCameraStream();
        if (qrPreview) qrPreview.hidden = true;
        qrVideo.hidden = false;
        qrVideo.setAttribute("playsinline", "");
        qrVideo.muted = true;
        qrVideo.srcObject = qrStream;
        await qrVideo.play();
        qrScanning = true;
        if (qrCamStart) qrCamStart.hidden = true;
        if (qrCamStop) qrCamStop.hidden = false;
        if (qrDecodeMeta) qrDecodeMeta.textContent = "";
        scanCameraFrame();
      } catch (err) {
        stopCamera();
        if (qrCamStart) {
          qrCamStart.hidden = false;
          qrCamStart.textContent = "扫码";
        }
        setError(qrDecodeError, Scan()?.cameraErrorMessage(err) || err.message || String(err));
      }
    }
  
    $("#qr-file")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      stopCamera({ fromUser: true });
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = async () => {
        try {
          await ensureScanLibs();
          qrPreview.hidden = true;
          qrPreview.src = url;
          await decodeFromImageElement(img, `图片识别 · ${file.name}`);
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
  
    qrCamStart?.addEventListener("click", () => {
      startCamera().catch((err) => {
        setError(qrDecodeError, Scan()?.cameraErrorMessage(err) || err.message || String(err));
      });
    });
  
    qrCamStop?.addEventListener("click", () => {
      stopCamera({ fromUser: true });
    });
  
    window.addEventListener("pagehide", () => stopCamera());

    startCamera().catch(() => {
      if (qrCamStart) {
        qrCamStart.hidden = false;
        qrCamStart.textContent = "扫码";
      }
    });
    });

  window.DevToolsExtraBoot = window.DevToolsExtraBoot || {};
  window.DevToolsExtraBoot["qrcode"] = () => { try { generateQr(); } catch (_) {} };
})();
