#!/usr/bin/env node
/**
 * Smoke: jSquash hub encodes tiny images in Node (same WASM as the browser).
 * Loads WASM via fs — Node fetch() cannot read file://.
 */
import { readFile } from "node:fs/promises";
import { encodeImageData } from "../vendor/jsquash/hub.js";
import { init as initJpeg } from "../vendor/jsquash/jpeg/encode.js";
import { init as initWebp } from "../vendor/jsquash/webp/encode.js";
import { init as initOxipng } from "../vendor/jsquash/oxipng/optimise.js";

if (typeof ImageData === "undefined") {
  globalThis.ImageData = class ImageData {
    constructor(data, width, height) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  };
}

async function loadWasm(rel) {
  const buf = await readFile(new URL(rel, import.meta.url));
  return WebAssembly.compile(buf);
}

await initJpeg(await loadWasm("../vendor/jsquash/jpeg/codec/enc/mozjpeg_enc.wasm"));
await initWebp(await loadWasm("../vendor/jsquash/webp/codec/enc/webp_enc.wasm"));
await initOxipng(await readFile(new URL("../vendor/jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm", import.meta.url)));

const w = 8;
const h = 8;
const data = new Uint8ClampedArray(w * h * 4);
for (let i = 0; i < data.length; i += 4) {
  data[i] = 220;
  data[i + 1] = 40;
  data[i + 2] = 40;
  data[i + 3] = 255;
}
const imageData = new ImageData(data, w, h);

async function check(format, min, max, magic) {
  const blob = await encodeImageData(imageData, format, { quality: 0.75 });
  const buf = await blob.arrayBuffer();
  if (blob.size < min || blob.size > max) {
    throw new Error(`${format} size unexpected: ${blob.size}`);
  }
  // Guard against accidentally shipping the whole WASM heap as the "image"
  if (blob.size > 256 * 1024) {
    throw new Error(`${format} looks like WASM heap leak: ${blob.size}`);
  }
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < magic.length; i++) {
    if (bytes[i] !== magic[i]) {
      throw new Error(`${format} missing magic at ${i}: got ${bytes[i]}`);
    }
  }
  console.log(`imgkit-hq-smoke: ok ${format} ${blob.size} bytes`);
}

await check("jpeg", 40, 8000, [0xff, 0xd8]);
await check("webp", 40, 8000, [0x52, 0x49, 0x46, 0x46]); // RIFF
await check("png", 40, 8000, [0x89, 0x50, 0x4e, 0x47]);

console.log("imgkit-hq-smoke: all ok");
