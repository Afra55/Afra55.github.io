"use strict";

/**
 * 真实「生成 → 像素图 → jsQR 解码」回读，不是只看模块数。
 * 覆盖：1000 ASCII / 1000 汉字；并模拟手机把图画到 320/360px。
 */

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const qgCode = fs.readFileSync(path.join(ROOT, "vendor", "qrcodegen.js"), "utf8");
const jsQRCode = fs.readFileSync(path.join(ROOT, "vendor", "jsQR.js"), "utf8");

const qgCtx = {};
vm.runInNewContext(`${qgCode}; this.out = qrcodegen;`, qgCtx);
const { QrCode, QrSegment } = qgCtx.out;

const jsCtx = { module: { exports: {} }, exports: {}, console };
jsCtx.self = jsCtx;
jsCtx.window = jsCtx;
vm.runInNewContext(jsQRCode, jsCtx);
const jsQR = jsCtx.module.exports;
assert.strictEqual(typeof jsQR, "function", "jsQR 未加载");

const QR_CAP_PHONE = 700;

function qrPayloadBytes(text) {
  return Buffer.byteLength(String(text), "utf8");
}

function splitQrChunks(text, byteCap = QR_CAP_PHONE) {
  const total = String(text);
  const cap = Math.max(64, Math.min(2953, Number(byteCap) || QR_CAP_PHONE));
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

function encode(text) {
  const segs = /[^\u0000-\u007f]/.test(text)
    ? [QrSegment.makeEci(26), QrSegment.makeBytes(QrSegment.toUtf8ByteArray(text))]
    : QrSegment.makeSegments(text);
  return QrCode.encodeSegments(segs, QrCode.Ecc.LOW);
}

function render(qr, scale = 6, border = 4) {
  const n = qr.size;
  const size = (n + border * 2) * scale;
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const mx = Math.floor(x / scale) - border;
      const my = Math.floor(y / scale) - border;
      const dark = mx >= 0 && my >= 0 && mx < n && my < n && qr.getModule(mx, my);
      const i = (y * size + x) * 4;
      const v = dark ? 0 : 255;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return { data, size };
}

function downscale(src, srcSize, dstSize) {
  const data = new Uint8ClampedArray(dstSize * dstSize * 4);
  for (let y = 0; y < dstSize; y += 1) {
    for (let x = 0; x < dstSize; x += 1) {
      const sx = Math.min(srcSize - 1, Math.floor((x * srcSize) / dstSize));
      const sy = Math.min(srcSize - 1, Math.floor((y * srcSize) / dstSize));
      const si = (sy * srcSize + sx) * 4;
      const di = (y * dstSize + x) * 4;
      data[di] = src[si];
      data[di + 1] = src[si + 1];
      data[di + 2] = src[si + 2];
      data[di + 3] = 255;
    }
  }
  return data;
}

function decodeText(text, displayPx) {
  const qr = encode(text);
  const per = qr.size >= 97 ? 8 : qr.size >= 57 ? 6 : 5;
  const { data, size } = render(qr, Math.max(4, per), 4);
  const side = displayPx || size;
  const img = side === size ? data : downscale(data, size, side);
  const r = jsQR(img, side, side, { inversionAttempts: "attemptBoth" });
  return { ok: !!(r && r.data === text), modules: qr.size, side, qr };
}

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("700 字以内单张可回读", () => {
  const r = decodeText("a".repeat(700));
  assert.ok(r.ok, `700 ASCII decode failed modules=${r.modules}`);
});

t("1000 ASCII 按产品逻辑拆 2 张，原生分辨率均可回读", () => {
  const text = "a".repeat(1000);
  const chunks = splitQrChunks(text);
  assert.ok(chunks.length >= 2, `expected split, got ${chunks.length}`);
  for (const c of chunks) {
    const r = decodeText(c);
    assert.ok(r.ok, `chunk decode failed modules=${r.modules}`);
    assert.ok(r.modules <= 97, `chunk too dense: ${r.modules}`);
  }
  const body = chunks.map((c) => c.replace(/^\[\d+\/\d+\]/, "")).join("");
  assert.strictEqual(body, text);
});

t("1000 ASCII 拆片在 320/360px（模拟手机屏）可回读", () => {
  const chunks = splitQrChunks("a".repeat(1000));
  for (const d of [320, 360]) {
    for (const c of chunks) {
      const r = decodeText(c, d);
      assert.ok(r.ok, `chunk @${d}px failed modules=${r.modules}`);
    }
  }
});

t("未拆的 1000 ASCII 单张在 360px 下应扫不出（对照）", () => {
  const r = decodeText("a".repeat(1000), 360);
  assert.strictEqual(r.ok, false, "dense single @360 should fail — otherwise threshold too conservative");
});

t("1000 汉字拆片在原生与 320/360px 均可回读并拼回", () => {
  const text = "测".repeat(1000);
  const chunks = splitQrChunks(text);
  assert.ok(chunks.length >= 4, `expected many chunks for CJK1000, got ${chunks.length}`);
  for (const d of [0, 320, 360]) {
    for (const c of chunks) {
      const r = decodeText(c, d || undefined);
      assert.ok(r.ok, `CJK chunk @${d || "native"} failed modules=${r.modules}`);
    }
  }
  const body = chunks.map((c) => c.replace(/^\[\d+\/\d+\]/, "")).join("");
  assert.strictEqual(body, text);
});

console.log(`qrcode-decode-roundtrip.test.js: ${n} passed`);
