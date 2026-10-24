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
    /** @type {{ total: number, parts: Map<number, string> } | null} */
    let qrSeries = null;
    let qrSeriesLastToastAt = 0;
    /** 规格上限（v40-L 字节）；超此必须拆，否则生成失败 */
    const QR_CAP_L40 = 2953;
    /**
     * 手机扫屏友好单张预算（约 v15–v20、模块 ≤97）。
     * 2000 字（尤其中文）若硬塞一张会密到 v30+，屏上每格 ≈2px，扫不到。
     */
    const QR_CAP_PHONE = 700;
  
    function qrPayloadBytes(text) {
      const s = String(text);
      try {
        return new TextEncoder().encode(s).length;
      } catch (_) {
        const encoded = encodeURI(s).replace(/%[0-9a-fA-F]{2}/g, "a");
        return encoded.length + (encoded.length !== s.length ? 3 : 0);
      }
    }

    function qrPreferSplit(text) {
      return qrPayloadBytes(text) > QR_CAP_PHONE;
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
      // 目标 ≥5px/模块；密码抬到 8px；画布最长 1280（保存/全屏放大用）
      const per = n >= 97 ? 8 : n >= 57 ? 6 : 5;
      const raw = (n + border * 2) * per;
      return Math.min(1280, Math.max(420, raw));
    }

    function drawQrCanvas(parent, qr, px) {
      const border = 4;
      const n = qr.size;
      const target = px || qrTargetPx(n);
      const scale = Math.max(4, Math.floor(target / (n + border * 2)));
      const size = (n + border * 2) * scale;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      canvas.setAttribute("role", "img");
      canvas.setAttribute("aria-label", "二维码，点按可放大扫描");
      canvas.title = "点按放大，方便手机扫描";
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
      if (n >= 57) parent.classList.add("qr-box--dense");
    }

    function qrCorrectLevels({ preferLow = false } = {}) {
      const map = globalThis.QRCode?.CorrectLevel;
      const qg = globalThis.qrcodegen?.QrCode;
      const lowFirst = [
        { level: map?.L ?? qg?.Ecc?.LOW, label: "低纠错（更好扫）", qg: !map },
        { level: map?.M ?? qg?.Ecc?.MEDIUM, label: "标准纠错", qg: !map },
      ].filter((x) => x.level != null);
      const midFirst = [
        { level: map?.M ?? qg?.Ecc?.MEDIUM, label: "标准纠错", qg: !map },
        { level: map?.L ?? qg?.Ecc?.LOW, label: "低纠错（容量更大）", qg: !map },
      ].filter((x) => x.level != null);
      if (!map && !qg) return [];
      return preferLow ? lowFirst : midFirst;
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
  
    function splitQrChunks(text, byteCap = QR_CAP_PHONE) {
      const total = String(text);
      const cap = Math.max(64, Math.min(QR_CAP_L40, Number(byteCap) || QR_CAP_PHONE));
      let n = Math.max(2, Math.ceil(qrPayloadBytes(total) / Math.max(32, cap - 16)));
      for (; n < 99; n += 1) {
        const chunks = [];
        let pos = 0;
        let ok = true;
        for (let i = 0; i < n; i += 1) {
          const prefix = `[${i + 1}/${n}]`;
          const budget = cap - qrPayloadBytes(prefix);
          if (budget < 8) {
            ok = false;
            break;
          }
          let take = Math.min(total.length - pos, budget);
          while (take > 0 && qrPayloadBytes(prefix + total.slice(pos, pos + take)) > cap) take -= 1;
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

    function renderQrPieces(chunks, lowLevel) {
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
    }

    function ensureQrLightbox() {
      let lb = document.getElementById("qr-lightbox");
      if (lb) return lb;
      lb = document.createElement("div");
      lb.id = "qr-lightbox";
      lb.className = "qr-lightbox";
      lb.hidden = true;
      lb.innerHTML =
        '<button type="button" class="qr-lightbox-close" aria-label="关闭">关闭</button>' +
        '<div class="qr-lightbox-stage"></div>' +
        '<p class="qr-lightbox-hint">放大后用手机扫；再点空白处关闭</p>';
      document.body.appendChild(lb);
      const close = () => {
        lb.hidden = true;
        lb.querySelector(".qr-lightbox-stage").innerHTML = "";
      };
      lb.querySelector(".qr-lightbox-close")?.addEventListener("click", close);
      lb.addEventListener("click", (ev) => {
        if (ev.target === lb) close();
      });
      document.addEventListener("keydown", (ev) => {
        if (ev.key === "Escape" && !lb.hidden) close();
      });
      return lb;
    }

    function openQrLightbox(fromEl) {
      const src = fromEl?.matches?.("canvas, img")
        ? fromEl
        : fromEl?.querySelector?.("canvas, img");
      if (!src) return;
      const lb = ensureQrLightbox();
      const stage = lb.querySelector(".qr-lightbox-stage");
      stage.innerHTML = "";
      let node;
      if (src.tagName === "CANVAS") {
        node = document.createElement("canvas");
        node.width = src.width;
        node.height = src.height;
        node.getContext("2d").drawImage(src, 0, 0);
      } else {
        node = src.cloneNode(true);
      }
      node.className = "qr-lightbox-img";
      stage.appendChild(node);
      lb.hidden = false;
    }

    function bindQrLightbox(root) {
      if (!root || root.dataset.qrLbBound === "1") return;
      root.dataset.qrLbBound = "1";
      root.addEventListener("click", (ev) => {
        const box = ev.target.closest?.(".qr-box");
        if (!box || !root.contains(box)) return;
        openQrLightbox(box);
      });
    }

    function setExportButtons(on) {
      const saveBtn = $("#qr-save");
      const shareBtn = $("#qr-share");
      if (saveBtn) saveBtn.hidden = !on;
      if (shareBtn) shareBtn.hidden = !on;
    }

    function listQrSurfaces() {
      if (!wrap) return [];
      return [...wrap.querySelectorAll(".qr-box canvas, .qr-box img")];
    }

    function triggerBlobDownload(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "qrcode.png";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
      }, 2000);
    }

    function surfaceToCanvas(el) {
      if (el instanceof HTMLCanvasElement) return el;
      if (el instanceof HTMLImageElement) {
        const c = document.createElement("canvas");
        const w = el.naturalWidth || el.width;
        const h = el.naturalHeight || el.height;
        if (!w || !h) throw new Error("无法读取图片尺寸");
        c.width = w;
        c.height = h;
        const ctx = c.getContext("2d");
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(el, 0, 0, w, h);
        return c;
      }
      throw new Error("无可导出的二维码");
    }

    function canvasToPngBlob(canvas) {
      return new Promise((resolve, reject) => {
        canvas.toBlob((blob) => {
          if (blob) resolve(blob);
          else reject(new Error("导出 PNG 失败"));
        }, "image/png");
      });
    }

    async function collectQrPngFiles() {
      const surfaces = listQrSurfaces();
      if (!surfaces.length) throw new Error("请先生成二维码");
      const files = [];
      for (let i = 0; i < surfaces.length; i += 1) {
        const canvas = surfaceToCanvas(surfaces[i]);
        const blob = await canvasToPngBlob(canvas);
        const name =
          surfaces.length === 1 ? "qrcode.png" : `qrcode-${i + 1}-of-${surfaces.length}.png`;
        if (typeof File !== "undefined") {
          files.push(new File([blob], name, { type: "image/png" }));
        } else {
          blob.name = name;
          files.push(blob);
        }
      }
      return files;
    }

    async function saveQrImages() {
      try {
        const files = await collectQrPngFiles();
        files.forEach((f) => triggerBlobDownload(f, f.name || "qrcode.png"));
        toast(files.length > 1 ? `已保存 ${files.length} 张图片` : "已保存图片");
      } catch (err) {
        setError($("#qr-error"), err.message || String(err));
      }
    }

    function canShareFiles(files) {
      if (typeof navigator.share !== "function" || typeof File === "undefined") return false;
      try {
        if (typeof navigator.canShare === "function") {
          return Boolean(navigator.canShare({ files }));
        }
        return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent || "");
      } catch (_) {
        return false;
      }
    }

    async function shareQrImages() {
      try {
        const files = await collectQrPngFiles();
        if (canShareFiles(files)) {
          try {
            await navigator.share({
              files,
              title: files.length > 1 ? "二维码图片" : "二维码",
            });
            toast("已打开系统分享");
            return;
          } catch (err) {
            if (err && (err.name === "AbortError" || /abort|cancel|取消/i.test(String(err.message || "")))) {
              return;
            }
          }
        }
        files.forEach((f) => triggerBlobDownload(f, f.name || "qrcode.png"));
        toast(canShareFiles(files) ? "分享未成功，已改为下载" : "当前环境不支持分享，已下载图片");
      } catch (err) {
        setError($("#qr-error"), err.message || String(err));
      }
    }
  
    function generateQr() {
      const text = $("#qr-text")?.value.trim() || "";
      if (!wrap) return;
      wrap.innerHTML = "";
      if (meta) meta.textContent = "";
      setExportButtons(false);
      if (!text) {
        setError($("#qr-error"), "请输入内容");
        return;
      }
      try {
        if (typeof QRCode === "undefined" && typeof globalThis.qrcodegen?.QrCode === "undefined") {
          throw new Error("QRCode 库未加载");
        }
        const bytes = qrPayloadBytes(text);
        const lowLevel = globalThis.QRCode?.CorrectLevel?.L ?? globalThis.qrcodegen?.QrCode?.Ecc?.LOW;
        bindQrLightbox(wrap);

        // 长文本优先拆成手机可扫的多张（单张过密时摄像头认不出）
        if (qrPreferSplit(text) && lowLevel != null) {
          const chunks = splitQrChunks(text, QR_CAP_PHONE);
          if (chunks.length >= 2) {
            renderQrPieces(chunks, lowLevel);
            if (meta) {
              meta.textContent =
                `约 ${text.length} 字 / ${bytes} 字节，已拆成 ${chunks.length} 张便于手机扫描。` +
                `逐张扫描后去掉 [n/m] 前缀并按顺序拼接；点图可放大。`;
            }
            setError($("#qr-error"), "");
            setExportButtons(true);
            return;
          }
        }

        const tries = qrCorrectLevels({ preferLow: bytes > 200 });
        if (!tries.length) throw new Error("QRCode 库未加载");
        for (const { level, label, qg } of tries) {
          try {
            wrap.appendChild(renderQrBoxWithEcc(text, level, { qgDirect: Boolean(qg) }));
            const canvas = wrap.querySelector("canvas, img");
            const side = canvas?.width || canvas?.naturalWidth || 0;
            if (meta) {
              meta.textContent = side
                ? `已生成 · ${label} · 约 ${text.length} 字 · 图 ${side}×${side}px · 点图可放大扫描`
                : `已生成 · ${label} · 约 ${text.length} 字 · 点图可放大扫描`;
            }
            setError($("#qr-error"), "");
            setExportButtons(true);
            return;
          } catch (err) {
            if (!/Too long|overflow/i.test(String(err.message || err))) throw err;
          }
        }
        const chunks = splitQrChunks(text, QR_CAP_L40);
        if (!chunks.length || lowLevel == null) throw new Error("内容过长，无法生成二维码");
        renderQrPieces(chunks, lowLevel);
        if (meta) {
          meta.textContent =
            `内容较长，已拆成 ${chunks.length} 张二维码。扫描后去掉 [n/m] 前缀并按顺序拼接；点图可放大。`;
        }
        setError($("#qr-error"), "");
        setExportButtons(true);
      } catch (err) {
        setError($("#qr-error"), err.message || String(err));
        setExportButtons(false);
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
        $("#qr-save")?.addEventListener("click", () => {
          saveQrImages().catch((err) => setError($("#qr-error"), err.message || String(err)));
        });
        $("#qr-share")?.addEventListener("click", () => {
          shareQrImages().catch((err) => setError($("#qr-error"), err.message || String(err)));
        });
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

    function showScanStage(on) {
      const stage = $("#qr-scan-stage");
      if (stage) stage.hidden = !on;
    }
  
    function seriesIncomplete() {
      return !!(qrSeries && qrSeries.total >= 2 && qrSeries.parts.size > 0 && qrSeries.parts.size < qrSeries.total);
    }

    function updateSeriesProgressUi() {
      const el = $("#qr-series-progress");
      const clearBtn = $("#qr-series-clear");
      const Series = globalThis.DevToolsQrSeries;
      if (!el) return;
      if (qrSeries && qrSeries.total >= 2 && qrSeries.parts.size > 0) {
        const got = qrSeries.parts.size;
        const done = got >= qrSeries.total;
        el.hidden = false;
        el.textContent = done
          ? `分片已齐 ${got}/${qrSeries.total}，已自动拼接（无 [i/n] 前缀的其它码不会并入）`
          : `${Series?.progressLabel(got, qrSeries.total) || `分片 ${got}/${qrSeries.total}`} · 请继续扫缺的张；其它无关码不会拼进来`;
        if (clearBtn) clearBtn.hidden = false;
      } else {
        el.hidden = true;
        el.textContent = "";
        if (clearBtn) clearBtn.hidden = true;
      }
    }

    function clearSeriesSession() {
      qrSeries = null;
      updateSeriesProgressUi();
      toast("已清空分片进度");
    }

    function showResultUi(on) {
      const stage = $("#qr-scan-stage");
      const head = $("#qr-result-head");
      const reticle = stage?.querySelector(".qr-scan-reticle");
      if (on) showScanStage(true);
      stage?.classList.toggle("is-result-only", !!on);
      if (reticle) reticle.hidden = !!on;
      if (head) head.hidden = !on;
      if (qrDecoded) qrDecoded.hidden = !on;
      if (qrDecodeList) qrDecodeList.hidden = !on || qrHits.length < 2;
      if (qrDecodeMeta) qrDecodeMeta.hidden = true;
      if (qrCamStart) {
        qrCamStart.hidden = false;
        const cont = on || seriesIncomplete();
        qrCamStart.textContent = cont ? "继续扫" : "扫码";
      }
      if (qrCamStop) qrCamStop.hidden = true;
      updateSeriesProgressUi();
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

    /**
     * 智能分流：
     * - 带 [i/n] 且同 n → 记入分片会话，齐了才拼
     * - 其它内容 → 独立列出，绝不拼进正文
     * 返回是否继续开着摄像头收分片。
     */
    function ingestDecodedHits(hits, { fromCamera = false } = {}) {
      const list = (hits || []).filter((h) => h?.text);
      if (!list.length) return { keepScanning: false };
      const Series = globalThis.DevToolsQrSeries;
      if (!Series?.classifyTexts) {
        showHits(list);
        if (fromCamera) stopCamera();
        return { keepScanning: false };
      }
      const cls = Series.classifyTexts(list.map((h) => h.text));
      if (!cls.hasSeries) {
        // 全是无关内容：保持旧行为，多码分列、不拼接
        if (!seriesIncomplete()) qrSeries = null;
        showHits(list);
        if (fromCamera) stopCamera();
        return { keepScanning: false };
      }

      const result = Series.ingest(qrSeries, cls.seriesParts, cls.seriesTotal);
      qrSeries = result.session;

      if (result.complete) {
        const display = [
          { text: result.joined, format: `拼接全文 · ${result.total} 片`, bbox: null },
          ...cls.plain.map((t) => ({ text: t, format: "其它码（未拼接）", bbox: null })),
        ];
        showHits(display);
        if (qrDecodedLabel) qrDecodedLabel.textContent = "拼接结果";
        qrSeries = null;
        updateSeriesProgressUi();
        toast(`已自动拼接 ${result.total} 张分片`);
        if (fromCamera) stopCamera();
        return { keepScanning: false };
      }

      // 分片未齐：更新进度；摄像头则继续扫
      updateSeriesProgressUi();
      const now = Date.now();
      if (result.added.length && now - qrSeriesLastToastAt > 800) {
        qrSeriesLastToastAt = now;
        toast(`${Series.progressLabel(result.got, result.total)} · 继续扫下一张`);
      }
      if (fromCamera) {
        // 保持预览，不进入结果独占态
        if (qrCamStart) qrCamStart.hidden = true;
        if (qrCamStop) qrCamStop.hidden = false;
        const head = $("#qr-result-head");
        if (head) head.hidden = true;
        if (qrDecoded) qrDecoded.hidden = true;
        if (qrDecodeList) qrDecodeList.hidden = true;
        return { keepScanning: true };
      }

      // 选图：展示已收到的分片原文 + 同图里的无关码
      const partialHits = [];
      for (let i = 1; i <= result.total; i += 1) {
        if (result.session.parts.has(i)) {
          partialHits.push({
            text: `[${i}/${result.total}]${result.session.parts.get(i)}`,
            format: `分片 ${i}/${result.total}`,
            bbox: null,
          });
        }
      }
      for (const t of cls.plain) partialHits.push({ text: t, format: "其它码（未拼接）", bbox: null });
      if (partialHits.length) showHits(partialHits);
      if (qrDecodedLabel) {
        qrDecodedLabel.textContent = `分片未齐（${result.got}/${result.total}）· 可点「继续扫」`;
      }
      updateSeriesProgressUi();
      return { keepScanning: false };
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
      ingestDecodedHits(hits, { fromCamera: false });
      void metaText;
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
        qrCamStart.hidden = false;
        qrCamStart.textContent = hasResult ? "继续扫" : "扫码";
      }
      if (!hasResult) showScanStage(false);
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
              const { keepScanning } = ingestDecodedHits(hits, { fromCamera: true });
              if (!keepScanning) stopCamera();
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
      const keepSeries = seriesIncomplete();
      if (!keepSeries) qrSeries = null;
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
      updateSeriesProgressUi();
      showScanStage(true);
      await ensureScanLibs();
      try {
        stopCamera();
        qrUserStopped = false;
        showScanStage(true);
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
        showScanStage(false);
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
      showScanStage(true);
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = async () => {
        try {
          await ensureScanLibs();
          qrPreview.hidden = true;
          qrPreview.src = url;
          await decodeFromImageElement(img, `图片识别 · ${file.name}`);
        } catch (err) {
          showScanStage(false);
          setError(qrDecodeError, err.message || String(err));
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        showScanStage(false);
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
      updateSeriesProgressUi();
      if (seriesIncomplete() && qrCamStart) {
        qrCamStart.hidden = false;
        qrCamStart.textContent = "继续扫";
      }
    });

    $("#qr-series-clear")?.addEventListener("click", () => {
      clearSeriesSession();
      if (qrCamStart && !qrScanning) {
        qrCamStart.textContent = qrDecoded && !qrDecoded.hidden && String(qrDecoded.value || "").trim() ? "继续扫" : "扫码";
      }
    });
  
    window.addEventListener("pagehide", () => stopCamera());

    // 默认不开启摄像头；本页以生成为主，扫码请点「扫码」或用独立页
    if (qrCamStart) {
      qrCamStart.hidden = false;
      qrCamStart.textContent = "扫码";
    }
    if (qrCamStop) qrCamStop.hidden = true;
    showScanStage(false);
    updateSeriesProgressUi();
    });

  window.DevToolsExtraBoot = window.DevToolsExtraBoot || {};
  window.DevToolsExtraBoot["qrcode"] = () => { try { generateQr(); } catch (_) {} };
})();
