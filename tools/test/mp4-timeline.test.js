"use strict";
const assert = require("assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "lib", "mp4-timeline.js"), "utf8");
const sandbox = { window: {}, console };
vm.runInNewContext(src, sandbox);
const api = sandbox.window.DevToolsMp4Timeline;
assert.ok(api, "DevToolsMp4Timeline exported");

function u32be(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}
function fourcc(s) {
  return Buffer.from(s, "ascii");
}
function box(type, payload) {
  const size = 8 + payload.length;
  return Buffer.concat([u32be(size), fourcc(type), payload]);
}

/** 最小 vide trak：24fps, timescale=24000, 10 frames delta=1000 */
function buildMoov() {
  const mdhd = Buffer.alloc(24);
  mdhd[0] = 0; // version
  mdhd.writeUInt32BE(24000, 12); // timescale
  mdhd.writeUInt32BE(10000, 16); // duration 10 frames * 1000
  const hdlr = Buffer.alloc(12);
  hdlr.write("vide", 8);
  // stts: 1 entry, count=10, delta=1000
  const stts = Buffer.alloc(16);
  stts.writeUInt32BE(1, 4); // entry_count
  stts.writeUInt32BE(10, 8);
  stts.writeUInt32BE(1000, 12);
  const stbl = box("stbl", box("stts", stts));
  const minf = box("minf", stbl);
  const mdia = box(
    "mdia",
    Buffer.concat([box("mdhd", mdhd), box("hdlr", hdlr), minf])
  );
  const trak = box("trak", mdia);
  return box("moov", trak);
}

function buildFile() {
  const ftyp = box("ftyp", Buffer.from("isomisomiso2mp41"));
  const moov = buildMoov();
  const mdat = box("mdat", Buffer.alloc(8));
  return Buffer.concat([ftyp, moov, mdat]);
}

(async () => {
  const t = api.normalizeFps(23.976);
  assert.strictEqual(t, 24);
  assert.strictEqual(api.normalizeFps(29.97), 30);

  const buf = buildFile();
  const file = new Blob([buf], { type: "video/mp4" });
  // Node Blob OK
  const tl = await api.probeMp4VideoTimeline(file);
  assert.ok(tl && tl.ok, "probe ok");
  assert.strictEqual(tl.fps, 24, `fps=${tl.fps}`);
  assert.strictEqual(tl.sampleCount, 10);
  assert.strictEqual(tl.ctsSec.length, 10);
  assert.ok(Math.abs(tl.ctsSec[1] - 1 / 24) < 1e-6);

  const r = api.sampleRangeForKeep(tl, 0, 5 / 24);
  assert.strictEqual(r.startF, 0);
  assert.strictEqual(r.endF, 5);
  assert.strictEqual(tl.firstPresentIdx, 0);
  assert.strictEqual(api.toDemuxFrameIndex(tl, 5), 5);

  // cut end at frame 2 CTS → next start frame 3
  const idx = api.sampleIndexAtSec(tl, 2 / 24);
  assert.strictEqual(idx, 2);

  assert.ok(typeof api.frameSeekSec === "function", "frameSeekSec");
  assert.ok(typeof api.calibrateToElement === "function", "calibrateToElement");
  assert.ok(typeof api.canFfmpegFirst === "function", "canFfmpegFirst");
  // 有采样表且单调 → 默认可快切（校准 method 不挡；对齐预览帧不当默认）
  assert.strictEqual(api.canFfmpegFirst(tl), true, "有 stts 默认可 ffmpeg-first");
  tl.calibrateMethod = "already-aligned";
  tl.calibrated = true;
  assert.strictEqual(api.canFfmpegFirst(tl), true, "already-aligned 可 ffmpeg-first");
  tl.calibrateMethod = "out-of-range";
  assert.strictEqual(api.canFfmpegFirst(tl), true, "校准失败也不挡有表快切");
  assert.ok(src.includes("videoframe-t0-soft"), "mid 抖须 soft");
  assert.ok(
    /frameTol\s*=\s*1\s*\/\s*Math\.max/.test(src) || /1\s*\/\s*Math\.max\(5,\s*Number\(timeline\.fps\)/.test(src),
    "mid-check 容差须 1 帧"
  );
  // 乱序拒快切
  const bad = {
    ctsSec: Float64Array.from([0, 0.1, 0.05, 0.2]),
    mediaCtsSec: Float64Array.from([0, 0.1, 0.05, 0.2]),
  };
  assert.strictEqual(api.canFfmpegFirst(bad), false, "CTS 乱序不可");
  tl.calibrateMethod = "already-aligned";
  assert.ok(tl.mediaCtsSec && tl.mediaCtsSec.length === tl.ctsSec.length, "mediaCtsSec");
  const seek0 = api.frameSeekSec(tl, 0);
  assert.ok(seek0 > tl.ctsSec[0] && seek0 < tl.ctsSec[1], `frameSeek0=${seek0}`);
  const seekLast = api.frameSeekSec(tl, 9);
  assert.ok(seekLast > tl.ctsSec[9], `frameSeekLast=${seekLast}`);

  // 手动平移模拟校准：media 不变，cts 对齐显示时钟
  const X = 0.02;
  for (let i = 0; i < tl.ctsSec.length; i++) tl.ctsSec[i] = tl.mediaCtsSec[i] + X;
  tl.chromeOffsetSec = X;
  tl.calibrated = true;
  assert.ok(Math.abs(tl.ctsSec[0] - X) < 1e-9);
  assert.ok(Math.abs(tl.mediaCtsSec[0]) < 1e-9);

  console.log("mp4-timeline.test.js: ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
