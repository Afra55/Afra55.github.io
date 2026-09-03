/**
 * Browser ESM hub for jSquash encoders (mozjpeg / webp / avif / oxipng).
 * Derived from https://github.com/jamsinclair/jSquash (Apache-2.0).
 * Encoder-only; SIMD/MT variants omitted so GitHub Pages can load without bundler.
 */
import jpegEncode from "./jpeg/encode.js";
import webpEncode from "./webp/encode.js";
import avifEncode from "./avif/encode.js";
import oxipngOptimise from "./oxipng/optimise.js";

function toArrayBuffer(result) {
  if (result instanceof ArrayBuffer) return result.slice(0);
  if (ArrayBuffer.isView(result)) {
    return result.buffer.slice(result.byteOffset, result.byteOffset + result.byteLength);
  }
  throw new Error("编码器返回了无法识别的数据");
}

function clamp01(n, fallback = 0.75) {
  const x = Number(n);
  if (!Number.isFinite(x)) return fallback;
  return Math.min(1, Math.max(0.05, x));
}

function quality100(q01) {
  return Math.round(clamp01(q01) * 100);
}

async function encodeOnce(imageData, format, quality01) {
  const fmt = String(format || "jpeg").toLowerCase();
  const q = quality100(quality01);
  let buf;
  if (fmt === "jpeg" || fmt === "jpg") {
    buf = await jpegEncode(imageData, { quality: q, progressive: true, optimize_coding: true });
  } else if (fmt === "webp") {
    buf = await webpEncode(imageData, { quality: q, method: 4 });
  } else if (fmt === "avif") {
    buf = await avifEncode(imageData, { quality: q, speed: 6, subsample: 1, bitDepth: 8 });
  } else if (fmt === "png") {
    buf = await oxipngOptimise(imageData, { level: 2, interlace: false, optimiseAlpha: false });
  } else {
    throw new Error(`高质量编码不支持格式：${fmt}`);
  }
  return toArrayBuffer(buf);
}

function mimeOf(format) {
  const f = String(format || "").toLowerCase();
  if (f === "jpeg" || f === "jpg") return "image/jpeg";
  if (f === "webp") return "image/webp";
  if (f === "avif") return "image/avif";
  return "image/png";
}

/**
 * @param {ImageData} imageData
 * @param {string} format jpeg|webp|avif|png
 * @param {{ quality?: number, targetBytes?: number }} [opts] quality is 0–1
 * @returns {Promise<Blob>}
 */
export async function encodeImageData(imageData, format, opts = {}) {
  const fmt = String(format || "jpeg").toLowerCase();
  const targetBytes = Number(opts.targetBytes) || 0;
  const quality = clamp01(opts.quality, 0.75);
  const lossy = fmt === "jpeg" || fmt === "jpg" || fmt === "webp" || fmt === "avif";

  if (!lossy || !targetBytes || targetBytes <= 0) {
    const buf = await encodeOnce(imageData, fmt, quality);
    return new Blob([buf], { type: mimeOf(fmt) });
  }

  let lo = 0.08;
  let hi = 1;
  let bestBuf = await encodeOnce(imageData, fmt, quality);
  let best = bestBuf;
  if (best.byteLength <= targetBytes) {
    return new Blob([best], { type: mimeOf(fmt) });
  }
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    const buf = await encodeOnce(imageData, fmt, mid);
    if (buf.byteLength > targetBytes) {
      hi = mid;
    } else {
      lo = mid;
      best = buf;
    }
  }
  if (best.byteLength > targetBytes) {
    best = await encodeOnce(imageData, fmt, 0.08);
  }
  return new Blob([best], { type: mimeOf(fmt) });
}

export const JQUASH_FORMATS = ["jpeg", "webp", "avif", "png"];
