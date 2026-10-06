/**
 * 通用码扫描：BarcodeDetector（若可用）→ ZXing → jsQR(仅 QR)
 * 独立扫码页与 #qrcode 面板共用。
 */
(() => {
  "use strict";

  const FORMAT_HINT =
    "支持：QR、EAN-13/8、UPC-A/E、Code128/39/93、Codabar、ITF、Data Matrix、PDF417、Aztec。不支持：MaxiCode / 部分 GS1 DataBar。";

  const BD_FORMATS = [
    "qr_code",
    "ean_13",
    "ean_8",
    "upc_a",
    "upc_e",
    "code_128",
    "code_39",
    "code_93",
    "codabar",
    "itf",
    "data_matrix",
    "pdf417",
    "aztec",
  ];

  const FORMAT_LABEL = {
    qr_code: "QR",
    QR_CODE: "QR",
    ean_13: "EAN-13",
    EAN_13: "EAN-13",
    ean_8: "EAN-8",
    EAN_8: "EAN-8",
    upc_a: "UPC-A",
    UPC_A: "UPC-A",
    upc_e: "UPC-E",
    UPC_E: "UPC-E",
    code_128: "Code128",
    CODE_128: "Code128",
    code_39: "Code39",
    CODE_39: "Code39",
    code_93: "Code93",
    CODE_93: "Code93",
    codabar: "Codabar",
    CODABAR: "Codabar",
    itf: "ITF",
    ITF: "ITF",
    data_matrix: "DataMatrix",
    DATA_MATRIX: "DataMatrix",
    pdf417: "PDF417",
    PDF_417: "PDF417",
    aztec: "Aztec",
    AZTEC: "Aztec",
  };

  let zxingReader = null;
  let zxingHintsReady = false;
  let barcodeDetector = null;
  let barcodeDetectorFormats = [];
  let barcodeDetectorTried = false;

  function formatLabel(fmt) {
    if (!fmt) return "";
    const key = String(fmt);
    return FORMAT_LABEL[key] || FORMAT_LABEL[key.toUpperCase?.()] || key;
  }

  function cloneImageData(imageData) {
    return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  }

  function pointsToBbox(points) {
    if (!points?.length) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let n = 0;
    for (const p of points) {
      if (!p) continue;
      const x = Number(typeof p.getX === "function" ? p.getX() : p.x);
      const y = Number(typeof p.getY === "function" ? p.getY() : p.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      n += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    if (!n) return null;
    return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
  }

  function bboxIou(a, b) {
    if (!a || !b) return 0;
    const x0 = Math.max(a.x, b.x);
    const y0 = Math.max(a.y, b.y);
    const x1 = Math.min(a.x + a.w, b.x + b.w);
    const y1 = Math.min(a.y + a.h, b.y + b.h);
    const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
    const union = a.w * a.h + b.w * b.h - inter;
    return union > 0 ? inter / union : 0;
  }

  function addHit(hits, hit) {
    if (!hit?.text) return false;
    for (const prev of hits) {
      if (prev.text !== hit.text) continue;
      if (!prev.bbox || !hit.bbox) return false;
      if (bboxIou(prev.bbox, hit.bbox) > 0.35) return false;
    }
    hits.push(hit);
    return true;
  }

  function maskRect(imageData, bbox) {
    if (!imageData?.data || !bbox) return false;
    const pad = Math.max(6, Math.round(Math.min(bbox.w, bbox.h) * 0.1));
    const x0 = Math.min(imageData.width, Math.max(0, Math.floor(bbox.x - pad)));
    const y0 = Math.min(imageData.height, Math.max(0, Math.floor(bbox.y - pad)));
    const x1 = Math.min(imageData.width, Math.max(0, Math.ceil(bbox.x + bbox.w + pad)));
    const y1 = Math.min(imageData.height, Math.max(0, Math.ceil(bbox.y + bbox.h + pad)));
    if (x1 - x0 < 2 || y1 - y0 < 2) return false;
    if ((x1 - x0) * (y1 - y0) > imageData.width * imageData.height * 0.92) return false;
    const data = imageData.data;
    const w = imageData.width;
    for (let y = y0; y < y1; y += 1) {
      let i = (y * w + x0) * 4;
      for (let x = x0; x < x1; x += 1) {
        data[i] = 255;
        data[i + 1] = 255;
        data[i + 2] = 255;
        data[i + 3] = 255;
        i += 4;
      }
    }
    return true;
  }

  function cameraErrorMessage(err) {
    const name = err?.name || "";
    const msg = String(err?.message || err || "").trim();
    if (name === "NotAllowedError" || name === "PermissionDeniedError") {
      return "摄像头权限被拒绝：请在浏览器地址栏/设置中允许本站使用摄像头后重试";
    }
    if (name === "NotFoundError" || name === "DevicesNotFoundError") {
      return "未检测到摄像头设备";
    }
    if (name === "NotReadableError" || name === "TrackStartError") {
      return "摄像头被其他应用占用，请关闭后重试";
    }
    if (name === "SecurityError") {
      return "当前环境不允许使用摄像头（请用 HTTPS 或 localhost 打开）";
    }
    if (name === "OverconstrainedError" || name === "ConstraintNotSatisfiedError") {
      return "无法按后置摄像头约束打开，请重试或换浏览器";
    }
    if (!window.isSecureContext && !/^(localhost|127\.0\.0\.1)$/i.test(location.hostname)) {
      return "摄像头需要 HTTPS（或本机 localhost）才能使用";
    }
    return msg ? `无法打开摄像头：${msg}` : "无法打开摄像头";
  }

  function assertCameraEnvironment() {
    if (!window.isSecureContext && !/^(localhost|127\.0\.0\.1)$/i.test(location.hostname)) {
      throw Object.assign(new Error("摄像头需要 HTTPS（或本机 localhost）才能使用"), { name: "SecurityError" });
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前浏览器不支持摄像头，请用 Chrome / Safari 打开本页");
    }
  }

  async function getRearCameraStream() {
    assertCameraEnvironment();
    const tries = [
      {
        audio: false,
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      },
      { audio: false, video: { facingMode: "environment" } },
      { audio: false, video: true },
    ];
    let lastErr = null;
    for (const constraints of tries) {
      try {
        return await navigator.mediaDevices.getUserMedia(constraints);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error("无法打开摄像头");
  }

  function ensureZxingReader() {
    const ZXing = globalThis.ZXing;
    if (!ZXing?.MultiFormatReader) return null;
    if (!zxingReader) zxingReader = new ZXing.MultiFormatReader();
    if (!zxingHintsReady) {
      const formats = [
        ZXing.BarcodeFormat.QR_CODE,
        ZXing.BarcodeFormat.EAN_13,
        ZXing.BarcodeFormat.EAN_8,
        ZXing.BarcodeFormat.UPC_A,
        ZXing.BarcodeFormat.UPC_E,
        ZXing.BarcodeFormat.CODE_128,
        ZXing.BarcodeFormat.CODE_39,
        ZXing.BarcodeFormat.CODE_93,
        ZXing.BarcodeFormat.CODABAR,
        ZXing.BarcodeFormat.ITF,
        ZXing.BarcodeFormat.DATA_MATRIX,
        ZXing.BarcodeFormat.PDF_417,
        ZXing.BarcodeFormat.AZTEC,
      ];
      const hints = new Map();
      hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
      hints.set(ZXing.DecodeHintType.TRY_HARDER, true);
      if (ZXing.DecodeHintType.ALSO_INVERTED != null) {
        hints.set(ZXing.DecodeHintType.ALSO_INVERTED, true);
      }
      zxingReader.setHints(hints);
      zxingHintsReady = true;
    }
    return zxingReader;
  }

  /** ImageData.data 是 RGBA；ZXing RGBLuminanceSource 要 Int32 ARGB */
  function imageDataToArgb(imageData) {
    const src = imageData.data;
    const n = imageData.width * imageData.height;
    const pixels = new Int32Array(n);
    for (let i = 0, j = 0; i < n; i += 1, j += 4) {
      pixels[i] = (src[j + 3] << 24) | (src[j] << 16) | (src[j + 1] << 8) | src[j + 2];
    }
    return pixels;
  }

  function decodeWithZxing(imageData) {
    const ZXing = globalThis.ZXing;
    const reader = ensureZxingReader();
    if (!reader || !imageData?.data) return null;
    try {
      const pixels = imageDataToArgb(imageData);
      const source = new ZXing.RGBLuminanceSource(pixels, imageData.width, imageData.height);
      const bitmap = new ZXing.BinaryBitmap(new ZXing.HybridBinarizer(source));
      const result = reader.decode(bitmap);
      if (!result) return null;
      const text = String(result.getText?.() ?? result.text ?? "").trim();
      if (!text) return null;
      const fmt = result.getBarcodeFormat?.() ?? result.format;
      const fmtName = typeof fmt === "number" ? ZXing.BarcodeFormat[fmt] : fmt;
      const pts = result.getResultPoints?.() || result.resultPoints || [];
      const bbox = pointsToBbox(pts);
      return { text, format: formatLabel(fmtName) || "码", engine: "ZXing", bbox };
    } catch (_) {
      try {
        reader.reset?.();
      } catch (_) {}
      return null;
    }
  }

  function decodeWithJsQr(imageData) {
    if (typeof globalThis.jsQR !== "function" || !imageData?.data) return null;
    try {
      const code = globalThis.jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "attemptBoth",
      });
      if (!code?.data) return null;
      const loc = code.location;
      const pts = loc
        ? [loc.topLeftCorner, loc.topRightCorner, loc.bottomRightCorner, loc.bottomLeftCorner]
        : [];
      return { text: String(code.data), format: "QR", engine: "jsQR", bbox: pointsToBbox(pts) };
    } catch (_) {
      return null;
    }
  }

  async function ensureBarcodeDetector() {
    if (barcodeDetectorTried) return barcodeDetector;
    barcodeDetectorTried = true;
    if (typeof globalThis.BarcodeDetector !== "function") return null;
    try {
      const supported = await globalThis.BarcodeDetector.getSupportedFormats();
      const list = Array.isArray(supported) ? supported.map((x) => String(x).toLowerCase()) : [];
      const formats = BD_FORMATS.filter((f) => list.includes(f));
      // 仅有 QR、或无实用一维码时仍可用，但优先当引擎之一
      if (!formats.length) return null;
      barcodeDetectorFormats = formats;
      barcodeDetector = new globalThis.BarcodeDetector({ formats });
      return barcodeDetector;
    } catch (_) {
      barcodeDetector = null;
      return null;
    }
  }

  function hitFromBarcodeDetector(code) {
    const text = String(code?.rawValue || "").trim();
    if (!text) return null;
    const bb = code.boundingBox;
    let bbox = null;
    if (bb && Number(bb.width) > 0 && Number(bb.height) > 0) {
      bbox = {
        x: Number(bb.x) || 0,
        y: Number(bb.y) || 0,
        w: Number(bb.width),
        h: Number(bb.height),
      };
    } else if (code.cornerPoints?.length) {
      bbox = pointsToBbox(code.cornerPoints);
    }
    return { text, format: formatLabel(code.format) || "码", engine: "系统", bbox };
  }

  async function decodeAllWithBarcodeDetector(source) {
    const detector = await ensureBarcodeDetector();
    if (!detector || !source) return [];
    try {
      const codes = await detector.detect(source);
      if (!codes?.length) return [];
      const hits = [];
      for (const code of codes) addHit(hits, hitFromBarcodeDetector(code));
      return hits;
    } catch (_) {
      return [];
    }
  }

  async function decodeWithBarcodeDetector(source) {
    const hits = await decodeAllWithBarcodeDetector(source);
    return hits[0] || null;
  }

  function decodeRemaining(work, hits) {
    let stalled = 0;
    for (let i = 0; i < 12; i += 1) {
      const hit = decodeWithZxing(work) || decodeWithJsQr(work);
      if (!hit) break;
      const added = addHit(hits, hit);
      stalled = added ? 0 : stalled + 1;
      if (!hit.bbox || !maskRect(work, hit.bbox) || stalled >= 2) break;
    }
  }

  /**
   * 识别画面中全部条码/二维码（含位置）。旧接口 decodeImageData 仍返回第一个。
   * @param {ImageData} imageData
   * @param {{ bitmapSource?: CanvasImageSource, preferNative?: boolean }} [opts]
   * @returns {Promise<Array<{text:string, format:string, engine:string, bbox?:{x:number,y:number,w:number,h:number}}>>}
   */
  async function decodeAllImageData(imageData, opts = {}) {
    if (!imageData?.width || !imageData?.height) return [];
    const hits = [];
    const work = cloneImageData(imageData);
    if (opts.preferNative !== false && opts.bitmapSource) {
      const nativeHits = await decodeAllWithBarcodeDetector(opts.bitmapSource);
      for (const hit of nativeHits) {
        addHit(hits, hit);
        if (hit.bbox) maskRect(work, hit.bbox);
      }
    }
    decodeRemaining(work, hits);
    return hits;
  }

  /**
   * @param {ImageData} imageData
   * @param {{ bitmapSource?: CanvasImageSource, preferNative?: boolean }} [opts]
   */
  async function decodeImageData(imageData, opts = {}) {
    const hits = await decodeAllImageData(imageData, opts);
    return hits[0] || null;
  }

  function engineStatusText() {
    const parts = [];
    if (barcodeDetector) parts.push("系统识别");
    if (globalThis.ZXing?.MultiFormatReader) parts.push("ZXing");
    else if (typeof globalThis.jsQR === "function") parts.push("jsQR(仅QR)");
    return parts.length ? parts.join(" + ") : "解码库未就绪";
  }

  function supportedHint() {
    return FORMAT_HINT;
  }

  window.DevToolsCodeScan = {
    FORMAT_HINT,
    formatLabel,
    cameraErrorMessage,
    assertCameraEnvironment,
    getRearCameraStream,
    ensureBarcodeDetector,
    ensureZxingReader,
    decodeImageData,
    decodeAllImageData,
    decodeWithZxing,
    decodeWithJsQr,
    engineStatusText,
    supportedHint,
    getNativeFormats: () => barcodeDetectorFormats.slice(),
  };
})();
