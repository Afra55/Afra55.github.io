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

  // cut end at frame 2 CTS → next start frame 3
  const idx = api.sampleIndexAtSec(tl, 2 / 24);
  assert.strictEqual(idx, 2);

  console.log("mp4-timeline.test.js: ok");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
