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
      return { text, format: formatLabel(fmtName) || "码", engine: "ZXing" };
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
      return { text: String(code.data), format: "QR", engine: "jsQR" };
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

  async function decodeWithBarcodeDetector(source) {
    const detector = await ensureBarcodeDetector();
    if (!detector || !source) return null;
    try {
      const codes = await detector.detect(source);
      const hit = codes && codes[0];
      if (!hit?.rawValue) return null;
      return {
        text: String(hit.rawValue),
        format: formatLabel(hit.format) || "码",
        engine: "系统",
      };
    } catch (_) {
      return null;
    }
  }

  /**
   * @param {ImageData} imageData
   * @param {{ bitmapSource?: CanvasImageSource, preferNative?: boolean }} [opts]
   */
  async function decodeImageData(imageData, opts = {}) {
    if (!imageData?.width || !imageData?.height) return null;
    if (opts.preferNative !== false && opts.bitmapSource) {
      const nativeHit = await decodeWithBarcodeDetector(opts.bitmapSource);
      if (nativeHit) return nativeHit;
    }
    const zx = decodeWithZxing(imageData);
    if (zx) return zx;
    return decodeWithJsQr(imageData);
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
    decodeWithZxing,
    decodeWithJsQr,
    engineStatusText,
    supportedHint,
    getNativeFormats: () => barcodeDetectorFormats.slice(),
  };
})();
