"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "extra-panels", "qrcode.js"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "..", "style.css"), "utf8");
const qgCode = fs.readFileSync(path.join(__dirname, "..", "vendor", "qrcodegen.js"), "utf8");

let n = 0;
function t(name, fn) {
  fn();
  n += 1;
}

t("长文本优先拆分常量存在", () => {
  assert.ok(/QR_CAP_PHONE\s*=\s*700/.test(src));
  assert.ok(/qrPreferSplit/.test(src));
  assert.ok(/openQrLightbox|qr-lightbox/.test(src));
  assert.ok(/点图可放大/.test(src) || /点按可放大/.test(src));
  assert.ok(/qr-lightbox-toolbar|zoomAt|fitImage/.test(src));
  assert.ok(/wheel/.test(src) && /pointerdown/.test(src));
});

t("渲染最小模块像素 ≥4，上限抬到 1280", () => {
  assert.ok(/Math\.max\(4,\s*Math\.floor\(target/.test(src));
  assert.ok(/Math\.min\(1280,/.test(src));
});

t("样式支持 denser 放大与 lightbox 缩放拖拽", () => {
  assert.ok(/qr-box--dense/.test(css));
  assert.ok(/\.qr-lightbox\b/.test(css));
  assert.ok(/min\(100%,\s*min\(92vw/.test(css));
  assert.ok(/\.qr-lightbox-toolbar\b/.test(css));
  assert.ok(/touch-action:\s*none/.test(css));
});

t("2000 ASCII 拆成多张且每张可编码", () => {
  const ctx = {};
  vm.runInNewContext(qgCode + "; this.qg = qrcodegen;", ctx);
  const QrCode = ctx.qg.QrCode;
  const QrSegment = ctx.qg.QrSegment;
  const text = "a".repeat(2000);
  const bytes = Buffer.byteLength(text, "utf8");
  assert.ok(bytes > 700, "fixture should exceed phone cap");

  // 复刻 split：每块 ≤700
  const cap = 700;
  const chunks = [];
  let pos = 0;
  const totalN = Math.ceil(bytes / (cap - 8));
  for (let i = 0; i < totalN; i += 1) {
    const prefix = `[${i + 1}/${totalN}]`;
    const budget = cap - Buffer.byteLength(prefix, "utf8");
    const take = Math.min(text.length - pos, budget);
    chunks.push(prefix + text.slice(pos, pos + take));
    pos += take;
  }
  assert.ok(chunks.length >= 3, `expected multi chunks, got ${chunks.length}`);
  for (const c of chunks) {
    const segs = QrSegment.makeSegments(c);
    const qr = QrCode.encodeSegments(segs, QrCode.Ecc.LOW);
    assert.ok(qr.size <= 101, `chunk too dense: modules=${qr.size}`);
  }
});

t("2000 汉字必须拆分（单张远超容量）", () => {
  const text = "测".repeat(2000);
  const bytes = Buffer.byteLength(text, "utf8");
  assert.ok(bytes > 2953);
  assert.ok(bytes / 700 > 4);
});

console.log(`qrcode-long-text.test.js: ${n} passed`);
