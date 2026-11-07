/**
 * 轻量 MP4 时间轴探测：从 moov/stts(/ctts) 读视频轨真实采样时间，
 * 供编辑器 keep / 导出 trim 与片源对齐（避免 rVFC 把 24 估成 30）。
 */
(() => {
  "use strict";

  function normalizeFps(raw) {
    const f = Number(raw) || 0;
    if (!(f >= 5 && f <= 120)) return 0;
    if (f >= 23.5 && f < 24.5) return 24;
    if (f >= 24.5 && f <= 25.8) return 25;
    if (f >= 29.2 && f <= 30.8) return 30;
    if (f >= 49.5 && f <= 50.5) return 50;
    if (f >= 59 && f <= 61) return 60;
    if (Math.abs(f - 12.5) <= 0.35) return 12.5;
    if (Math.abs(f - 15) <= 0.4) return 15;
    if (Math.abs(f - 20) <= 0.4) return 20;
    if (Math.abs(f - 12) <= 0.35) return 12;
    return Math.round(f * 1000) / 1000;
  }

  function u32(dv, o) {
    return dv.getUint32(o);
  }
  function u16(dv, o) {
    return dv.getUint16(o);
  }
  function i32(dv, o) {
    return dv.getInt32(o);
  }
  function fourcc(dv, o) {
    return String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  }

  /**
   * @param {DataView} dv
   * @param {number} start
   * @param {number} end
   * @param {(type:string, off:number, size:number, hdr:number) => boolean|void} visit
   */
  function walkBoxes(dv, start, end, visit) {
    let o = start;
    while (o + 8 <= end) {
      let size = u32(dv, o);
      const type = fourcc(dv, o + 4);
      let hdr = 8;
      if (size === 1) {
        if (o + 16 > end) break;
        const hi = u32(dv, o + 8);
        const lo = u32(dv, o + 12);
        size = hi * 0x100000000 + lo;
        hdr = 16;
      } else if (size === 0) {
        size = end - o;
      }
      if (!(size >= hdr) || o + size > end + 0.5) break;
      const stop = visit(type, o, size, hdr);
      if (stop) return true;
      o += size;
    }
    return false;
  }

  async function readSlice(file, start, len) {
    const a = Math.max(0, Math.min(file.size, start));
    const b = Math.max(a, Math.min(file.size, a + Math.max(0, len)));
    if (b <= a) return new ArrayBuffer(0);
    return file.slice(a, b).arrayBuffer();
  }

  /** 在缓冲里扫 'moov' 四字符（尾部扫描不能假定从 box 边界开始） */
  function findMoovInBuffer(buf, fileOffset) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(buf);
    for (let i = 0; i + 8 <= u8.length; i++) {
      if (u8[i + 4] !== 0x6d || u8[i + 5] !== 0x6f || u8[i + 6] !== 0x6f || u8[i + 7] !== 0x76) {
        continue; // m-o-o-v
      }
      let boxSize = dv.getUint32(i);
      let hdr = 8;
      if (boxSize === 1) {
        if (i + 16 > u8.length) continue;
        const hi = dv.getUint32(i + 8);
        const lo = dv.getUint32(i + 12);
        boxSize = hi * 0x100000000 + lo;
        hdr = 16;
      } else if (boxSize === 0) {
        continue;
      }
      if (!(boxSize >= hdr + 8) || boxSize > 64 * 1024 * 1024) continue;
      return { offset: fileOffset + i, size: boxSize, local: i, hdr };
    }
    return null;
  }

  /** 定位 moov：优先文件头顺序走 box；失败再在尾部字节扫描（非 faststart） */
  async function locateMoov(file) {
    const size = Number(file?.size) || 0;
    if (size < 16) return null;
    const headLen = Math.min(size, 512 * 1024);
    const headBuf = await readSlice(file, 0, headLen);
    const headDv = new DataView(headBuf);
    let found = null;
    walkBoxes(headDv, 0, headBuf.byteLength, (type, off, boxSize) => {
      if (type === "moov") {
        found = { offset: off, size: boxSize };
        return true;
      }
      return false;
    });
    if (!found) {
      // 头里可能被截断的 moov：四字符兜底
      const hit = findMoovInBuffer(headBuf, 0);
      if (hit) found = { offset: hit.offset, size: hit.size };
    }
    if (found) {
      if (found.offset + found.size <= headBuf.byteLength) {
        return {
          offset: found.offset,
          size: found.size,
          buf: headBuf.slice(found.offset, found.offset + found.size),
        };
      }
      const buf = await readSlice(file, found.offset, found.size);
      return { offset: found.offset, size: found.size, buf };
    }
    // 尾部：从文件末往前扩大窗口扫（手机录像常把 moov 放最后）
    for (const tailLen of [2 * 1024 * 1024, 8 * 1024 * 1024, 24 * 1024 * 1024]) {
      const win = Math.min(size, tailLen);
      const tailStart = size - win;
      const tailBuf = await readSlice(file, tailStart, win);
      const hit = findMoovInBuffer(tailBuf, tailStart);
      if (!hit) continue;
      if (hit.local + hit.size <= tailBuf.byteLength) {
        return {
          offset: hit.offset,
          size: hit.size,
          buf: tailBuf.slice(hit.local, hit.local + hit.size),
        };
      }
      const buf = await readSlice(file, hit.offset, hit.size);
      return { offset: hit.offset, size: hit.size, buf };
    }
    return null;
  }

  function parseMdhd(dv, off, size, hdr) {
    const v = dv.getUint8(off + hdr);
    let timescale = 0;
    let duration = 0;
    if (v === 1) {
      if (hdr + 32 > size) return null;
      timescale = u32(dv, off + hdr + 20);
      // duration u64
      const hi = u32(dv, off + hdr + 24);
      const lo = u32(dv, off + hdr + 28);
      duration = hi * 0x100000000 + lo;
    } else {
      if (hdr + 20 > size) return null;
      timescale = u32(dv, off + hdr + 12);
      duration = u32(dv, off + hdr + 16);
    }
    return { timescale, duration };
  }

  function parseHdlr(dv, off, size, hdr) {
    if (hdr + 12 > size) return "";
    return fourcc(dv, off + hdr + 8);
  }

  function parseStts(dv, off, size, hdr) {
    if (hdr + 8 > size) return [];
    const entryCount = u32(dv, off + hdr + 4);
    const entries = [];
    let p = off + hdr + 8;
    for (let i = 0; i < entryCount; i++) {
      if (p + 8 > off + size) break;
      entries.push({ count: u32(dv, p), delta: u32(dv, p + 4) });
      p += 8;
    }
    return entries;
  }

  function parseCtts(dv, off, size, hdr) {
    if (hdr + 8 > size) return [];
    const version = dv.getUint8(off + hdr);
    const entryCount = u32(dv, off + hdr + 4);
    const entries = [];
    let p = off + hdr + 8;
    for (let i = 0; i < entryCount; i++) {
      if (p + 8 > off + size) break;
      const count = u32(dv, p);
      const offset = version === 1 ? i32(dv, p + 4) : u32(dv, p + 4);
      entries.push({ count, offset });
      p += 8;
    }
    return entries;
  }

  /** 取第一条有效 elst 的 media_time（媒体时间尺度） */
  function parseElstMediaTime(dv, off, size, hdr) {
    if (hdr + 8 > size) return 0;
    const version = dv.getUint8(off + hdr);
    const entryCount = u32(dv, off + hdr + 4);
    if (!(entryCount > 0)) return 0;
    let p = off + hdr + 8;
    if (version === 1) {
      if (p + 20 > off + size) return 0;
      // segment_duration u64, media_time i64
      const mtHi = i32(dv, p + 8);
      const mtLo = u32(dv, p + 12);
      if (mtHi < 0) return 0;
      return mtHi * 0x100000000 + mtLo;
    }
    if (p + 12 > off + size) return 0;
    const mediaTime = i32(dv, p + 4);
    return mediaTime > 0 ? mediaTime : 0;
  }

  function buildTimelineFromTrack(track) {
    const timescale = Number(track.timescale) || 0;
    const stts = Array.isArray(track.stts) ? track.stts : [];
    if (!(timescale > 0) || !stts.length) return null;
    let sampleCount = 0;
    let sumDelta = 0;
    for (const e of stts) {
      const c = Math.max(0, Number(e.count) || 0);
      const d = Math.max(0, Number(e.delta) || 0);
      sampleCount += c;
      sumDelta += c * d;
    }
    if (!(sampleCount > 0) || !(sumDelta > 0)) return null;
    const durationTicks = Number(track.duration) > 0 ? Number(track.duration) : sumDelta;
    const durationSec = durationTicks / timescale;
    const avgDelta = sumDelta / sampleCount;
    const fpsRaw = timescale / avgDelta;
    const fps = normalizeFps(fpsRaw) || Math.round(fpsRaw * 1000) / 1000;

    const ctsSec = new Float64Array(sampleCount);
    const ctts = Array.isArray(track.ctts) ? track.ctts : [];
    let cttsIdx = 0;
    let cttsLeft = ctts.length ? Number(ctts[0].count) || 0 : 0;
    let cttsOff = ctts.length ? Number(ctts[0].offset) || 0 : 0;
    const mediaTime0 = Math.max(0, Number(track.elstMediaTime) || 0);
    let dts = 0;
    let i = 0;
    for (const e of stts) {
      const c = Math.max(0, Number(e.count) || 0);
      const d = Math.max(0, Number(e.delta) || 0);
      for (let n = 0; n < c; n++) {
        const comp = dts + cttsOff - mediaTime0;
        ctsSec[i] = comp / timescale;
        i += 1;
        dts += d;
        if (ctts.length) {
          cttsLeft -= 1;
          if (cttsLeft <= 0) {
            cttsIdx += 1;
            if (cttsIdx < ctts.length) {
              cttsLeft = Number(ctts[cttsIdx].count) || 0;
              cttsOff = Number(ctts[cttsIdx].offset) || 0;
            } else {
              cttsLeft = Infinity;
              cttsOff = 0;
            }
          }
        }
      }
    }
    // ffmpeg demux 后 frame 0 ≡ 第一条 CTS≥0 的采样（editlist 之后）
    let firstPresentIdx = 0;
    while (firstPresentIdx < ctsSec.length && ctsSec[firstPresentIdx] < -1e-6) {
      firstPresentIdx += 1;
    }
    return {
      ok: true,
      fps,
      fpsRaw,
      timescale,
      sampleCount,
      durationSec,
      ctsSec,
      hasCtts: ctts.length > 0,
      elstMediaTime: mediaTime0,
      firstPresentIdx,
    };
  }

  /** 采样下标 → ffmpeg trim start_frame（相对 demux 后第 0 帧） */
  function toDemuxFrameIndex(timeline, sampleIdx) {
    const base = Math.max(0, Number(timeline?.firstPresentIdx) || 0);
    const n = timeline?.ctsSec?.length || 0;
    const i = Math.max(0, Math.round(Number(sampleIdx) || 0));
    const capped = n > 0 ? Math.min(i, n) : i;
    return Math.max(0, capped - base);
  }

  function extractVideoTrack(moovBuf) {
    const dv = new DataView(moovBuf);
    /** @type {any} */
    let best = null;
    const visitTrak = (trakOff, trakSize) => {
      let mdhd = null;
      let handler = "";
      let stts = [];
      let ctts = [];
      let elstMediaTime = 0;
      walkBoxes(dv, trakOff + 8, trakOff + trakSize, (type, off, size, hdr) => {
        if (type === "edts") {
          walkBoxes(dv, off + hdr, off + size, (t2, o2, s2, h2) => {
            if (t2 === "elst") elstMediaTime = parseElstMediaTime(dv, o2, s2, h2);
          });
        } else if (type === "mdia") {
          walkBoxes(dv, off + hdr, off + size, (t2, o2, s2, h2) => {
            if (t2 === "mdhd") mdhd = parseMdhd(dv, o2, s2, h2);
            else if (t2 === "hdlr") handler = parseHdlr(dv, o2, s2, h2);
            else if (t2 === "minf") {
              walkBoxes(dv, o2 + h2, o2 + s2, (t3, o3, s3, h3) => {
                if (t3 !== "stbl") return;
                walkBoxes(dv, o3 + h3, o3 + s3, (t4, o4, s4, h4) => {
                  if (t4 === "stts") stts = parseStts(dv, o4, s4, h4);
                  else if (t4 === "ctts") ctts = parseCtts(dv, o4, s4, h4);
                });
              });
            }
          });
        }
      });
      if (handler !== "vide" || !mdhd || !stts.length) return;
      const track = {
        timescale: mdhd.timescale,
        duration: mdhd.duration,
        stts,
        ctts,
        elstMediaTime,
      };
      const sampleCount = stts.reduce((s, e) => s + (Number(e.count) || 0), 0);
      if (!best || sampleCount > best._n) {
        best = { ...track, _n: sampleCount };
      }
    };
    walkBoxes(dv, 0, moovBuf.byteLength, (type, off, size, hdr) => {
      if (type === "trak") visitTrak(off, size);
      else if (type === "moov") {
        walkBoxes(dv, off + hdr, off + size, (t2, o2, s2) => {
          if (t2 === "trak") visitTrak(o2, s2);
        });
      }
    });
    if (!best) return null;
    delete best._n;
    return best;
  }

  /**
   * @param {Blob|File} file
   * @returns {Promise<null|{ok:true,fps:number,fpsRaw:number,timescale:number,sampleCount:number,durationSec:number,ctsSec:Float64Array,hasCtts:boolean,elstMediaTime:number}>}
   */
  async function probeMp4VideoTimeline(file) {
    if (!file || !(file.size > 32)) return null;
    try {
      const moov = await locateMoov(file);
      if (!moov?.buf) return null;
      const track = extractVideoTrack(moov.buf);
      if (!track) return null;
      return buildTimelineFromTrack(track);
    } catch (_) {
      return null;
    }
  }

  /**
   * 半开：返回时刻 t 对应的「显示帧」采样下标（CTS<=t 的最后一帧）。
   * @param {{ctsSec:Float64Array}} timeline
   * @param {number} sec
   */
  function sampleIndexAtSec(timeline, sec) {
    const arr = timeline?.ctsSec;
    if (!arr || !arr.length) return 0;
    const t = Math.max(0, Number(sec) || 0);
    let lo = 0;
    let hi = arr.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= t + 1e-9) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }

  /**
   * 半开 [start,end) → [startF, endF) 采样下标（endF 为不含）。
   */
  function sampleRangeForKeep(timeline, startSec, endSec) {
    const n = timeline?.ctsSec?.length || 0;
    if (!(n > 0)) return null;
    const a = Math.max(0, Number(startSec) || 0);
    const b = Math.max(a, Number(endSec) || 0);
    let startF = sampleIndexAtSec(timeline, a);
    // 半开 [a,b)：末帧 = CTS < b 的最后一帧；用半帧 ε 避免 b 恰落在帧 CTS 上算进区间
    const eps = 0.5 / Math.max(5, Number(timeline.fps) || 30);
    let endF = sampleIndexAtSec(timeline, Math.max(0, b - eps)) + 1;
    if (endF <= startF) endF = Math.min(n, startF + 1);
    endF = Math.min(n, endF);
    startF = Math.min(startF, Math.max(0, n - 1));
    return { startF, endF };
  }

  window.DevToolsMp4Timeline = {
    probeMp4VideoTimeline,
    sampleIndexAtSec,
    sampleRangeForKeep,
    toDemuxFrameIndex,
    normalizeFps,
  };
})();
