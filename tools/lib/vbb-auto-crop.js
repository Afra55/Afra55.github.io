/**
 * 黑盒「自动裁剪纯色边框」纯函数（与 v2g-suite-src/40-vbb.js 对齐）。
 * Node 单测 / 离线回归用；浏览器套件内另有同名实现，改一处必须两边一起改。
 *
 * v14：起/中/末三取样；各边独立；有画面不裁、纯色边才裁（全体最小 trim）；
 * 左右仅认「平坦纯黑」pillarbox（暗场景内容不误裁）；上下 letterbox 允许字幕噪点；
 * 映射时暗边不回退 1px；纯色边须扫到异色内容，防整幅纯色误裁。
 */
"use strict";

const DARK_CH = 32;
const DARK_RATIO = 0.9;
const DARK_EDGE_AVG = 36;
const SOFT_CH = 48;
const SOFT_RATIO = 0.82;
const OUTLIER_RATIO = 0.012;
/** 影院片上下黑边常见 ~10–20%；过小会留底条 */
const MAX_SIDE_RATIO = 0.25;
/** 检测缩略图最大宽（细左右边在 360 宽里易丢） */
const DETECT_MAX_W = 960;
/** 算法版本（缓存键 / 回归） */
const CROP_ALGO_VER = "v14";

/**
 * @param {{ width:number, height:number, data:Uint8ClampedArray|Uint8Array }} img
 * @param {number} [tol=14]
 * @returns {null|{left:number,top:number,right:number,bottom:number,w:number,h:number,darkLeft:boolean,darkRight:boolean,darkTop:boolean,darkBottom:boolean}}
 */
function detectFrameContentRect(img, tol = 14) {
  const w = img.width;
  const h = img.height;
  const data = img.data;
  const px = (x, y) => {
    const i = (y * w + x) * 4;
    return { r: data[i], g: data[i + 1], b: data[i + 2] };
  };
  const near = (a, b) =>
    Math.abs(a.r - b.r) <= tol && Math.abs(a.g - b.g) <= tol && Math.abs(a.b - b.b) <= tol;
  const lineStats = (get, n) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let dark = 0;
    let soft = 0;
    const cols = [];
    for (let i = 0; i < n; i++) {
      const p = get(i);
      cols.push(p);
      r += p.r;
      g += p.g;
      b += p.b;
      const mx = Math.max(p.r, p.g, p.b);
      if (mx <= DARK_CH) dark += 1;
      if (mx <= SOFT_CH) soft += 1;
    }
    const avg = { r: r / n, g: g / n, b: b / n };
    const limit = Math.max(1, Math.floor(n * OUTLIER_RATIO));
    let bad = 0;
    let maxDev = 0;
    for (let i = 0; i < n; i++) {
      const p = cols[i];
      const dr = Math.abs(p.r - avg.r);
      const dg = Math.abs(p.g - avg.g);
      const db = Math.abs(p.b - avg.b);
      maxDev = Math.max(maxDev, dr, dg, db);
      if (!near(p, avg)) bad += 1;
    }
    return {
      avg,
      pure: bad <= limit && maxDev <= tol + 6,
      darkRatio: dark / n,
      softRatio: soft / n,
      avgMax: Math.max(avg.r, avg.g, avg.b),
      maxDev,
    };
  };
  /** 左右：必须平坦纯黑，避免暗树林/夜景内容被当成 pillarbox */
  const isFlatBlackBar = (st) => st.avgMax <= 14 && st.darkRatio >= 0.96 && st.pure;
  const isStillFlatBlack = (st) =>
    (st.avgMax <= 16 && st.darkRatio >= 0.94 && st.pure) ||
    (st.avgMax <= 12 && st.darkRatio >= 0.97);
  /** 上下：影院 letterbox；允许底条烧录字幕带来的少量亮点 */
  const isLetterboxRow = (st) =>
    (st.avgMax <= 14 && st.darkRatio >= 0.92) || (st.avgMax <= 8 && st.darkRatio >= 0.85);
  const isStillLetterbox = (st) =>
    (st.avgMax <= 18 && st.darkRatio >= 0.9) || (st.avgMax <= 12 && st.darkRatio >= 0.82);
  const rowAt = (y) => (i) => px(i, y);
  const colAt = (x) => (i) => px(x, i);
  const scanSide = (isCol, fromStart, maxN) => {
    const length = isCol ? h : w;
    const span = isCol ? w : h;
    const lineAt = isCol ? colAt : rowAt;
    const edgeIdx = fromStart ? 0 : span - 1;
    const st0 = lineStats(lineAt(edgeIdx), length);
    const darkStart = isCol ? isFlatBlackBar(st0) : isLetterboxRow(st0);
    if (darkStart) {
      let trim = 0;
      let idx = edgeIdx;
      while (trim < maxN) {
        const st = lineStats(lineAt(idx), length);
        const keep = isCol ? isStillFlatBlack(st) : isStillLetterbox(st);
        if (keep) {
          trim += 1;
          idx = fromStart ? idx + 1 : idx - 1;
          continue;
        }
        break;
      }
      // 宁可留一丝边，也不裁进有画面像素
      return { trim, dark: true };
    }
    if (st0.pure) {
      const c0 = st0.avg;
      let trim = 0;
      let idx = edgeIdx;
      while (trim < maxN) {
        const st = lineStats(lineAt(idx), length);
        if (!st.pure || !near(st.avg, c0)) break;
        trim += 1;
        idx = fromStart ? idx + 1 : idx - 1;
      }
      // 整幅近纯色（雾/纯色场）：扫到 max 仍同色 → 不是「边框」
      if (trim >= maxN) return { trim: 0, dark: false };
      // 必须看到与边框异色的内容行，否则也不裁
      if (trim > 0) {
        const stStop = lineStats(lineAt(idx), length);
        if (stStop.pure && near(stStop.avg, c0)) return { trim: 0, dark: false };
      }
      return { trim, dark: false };
    }
    return { trim: 0, dark: false };
  };
  const maxTop = Math.floor(h * MAX_SIDE_RATIO);
  const maxBottom = Math.floor(h * MAX_SIDE_RATIO);
  const maxLeft = Math.floor(w * MAX_SIDE_RATIO);
  const maxRight = Math.floor(w * MAX_SIDE_RATIO);
  const leftScan = scanSide(true, true, maxLeft);
  const rightScan = scanSide(true, false, maxRight);
  const topScan = scanSide(false, true, maxTop);
  const bottomScan = scanSide(false, false, maxBottom);
  const left = leftScan.trim;
  const top = topScan.trim;
  const right = w - 1 - rightScan.trim;
  const bottom = h - 1 - bottomScan.trim;
  if (right <= left || bottom <= top) return null;
  if (top === 0 && left === 0 && right === w - 1 && bottom === h - 1) return null;
  return {
    left,
    top,
    right,
    bottom,
    w,
    h,
    darkLeft: leftScan.dark && left > 0,
    darkRight: rightScan.dark && rightScan.trim > 0,
    darkTop: topScan.dark && top > 0,
    darkBottom: bottomScan.dark && bottomScan.trim > 0,
  };
}

/**
 * 缩略图裁切框 → 源分辨率 crop {x,y,w,h}
 * @param {NonNullable<ReturnType<typeof detectFrameContentRect>>} acc
 * @param {number} vw
 * @param {number} vh
 */
function mapThumbCropToSource(acc, vw, vh) {
  const sx = vw / acc.w;
  const sy = vh / acc.h;
  let x = acc.left > 0 ? Math.max(0, Math.ceil(acc.left * sx)) : 0;
  let y = acc.top > 0 ? Math.max(0, Math.ceil(acc.top * sy)) : 0;
  let x2 = Math.min(vw, Math.floor((acc.right + 1) * sx));
  let y2 = Math.min(vh, Math.floor((acc.bottom + 1) * sy));
  // 非暗边回退 1px，避免缩略量化裁进画面；
  // 暗边（letterbox）不回退，并多吃 1 源像素，清掉发丝黑线/底条残留
  if (x > 0 && !acc.darkLeft) x -= 1;
  if (y > 0 && !acc.darkTop) y -= 1;
  if (x2 < vw && !acc.darkRight) x2 += 1;
  if (y2 < vh && !acc.darkBottom) y2 += 1;
  if (acc.darkLeft && x > 0) x = Math.min(vw - 8, x + 1);
  if (acc.darkTop && y > 0) y = Math.min(vh - 8, y + 1);
  if (acc.darkRight && x2 < vw) x2 = Math.max(x + 8, x2 - 1);
  if (acc.darkBottom && y2 < vh) y2 = Math.max(y + 8, y2 - 1);
  let w = x2 - x;
  let h = y2 - y;
  if (x + w > vw) w = vw - x;
  if (y + h > vh) h = vh - y;
  if (w >= 8 && h >= 8 && (w < vw - 2 || h < vh - 2)) return { x, y, w, h };
  return null;
}

/** 无边框时的「整幅」样本（参与多帧合并，避免只剩有边帧） */
function fullFrameContentRect(w, h) {
  return {
    left: 0,
    top: 0,
    right: Math.max(0, w - 1),
    bottom: Math.max(0, h - 1),
    w,
    h,
    darkLeft: false,
    darkRight: false,
    darkTop: false,
    darkBottom: false,
  };
}

/**
 * 起/中/末采样时刻（秒）。短片去重；跳过纯 0 以免未解码黑帧，但仍贴近片头/片尾。
 * @param {number} dur
 * @returns {number[]}
 */
function cropSampleMarks(dur) {
  const d = Number(dur) || 0;
  if (!(d > 0.2)) return [0];
  const start = Math.min(0.08, Math.max(0, d * 0.02));
  const mid = d * 0.5;
  const end = Math.max(start + 0.05, d - Math.min(0.12, Math.max(0.04, d * 0.04)));
  const marks = [start, mid, end];
  const out = [];
  for (const t of marks) {
    const clamped = Math.min(Math.max(0, t), Math.max(0, d - 0.02));
    if (!out.length || Math.abs(out[out.length - 1] - clamped) >= 0.04) out.push(clamped);
  }
  return out.length ? out : [0];
}

/** 内容并集：各边取最浅裁（兼容旧调用） */
function unionContentRects(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    left: Math.min(a.left, b.left),
    top: Math.min(a.top, b.top),
    right: Math.max(a.right, b.right),
    bottom: Math.max(a.bottom, b.bottom),
    w: b.w,
    h: b.h,
    darkLeft: a.darkLeft || b.darkLeft,
    darkRight: a.darkRight || b.darkRight,
    darkTop: a.darkTop || b.darkTop,
    darkBottom: a.darkBottom || b.darkBottom,
  };
}

/**
 * 多帧合并（起/中/末）：
 * 各边独立——三帧（各样本）该边都有色边才裁，取最小 trim；
 * 任一帧该边无边（trim=0）→ 不裁该边。
 * @param {Array<ReturnType<typeof detectFrameContentRect>|ReturnType<typeof fullFrameContentRect>>} rects
 */
function mergeContentRects(rects) {
  const list = (rects || []).filter((r) => r && r.w > 0 && r.h > 0);
  if (!list.length) return null;
  const w = list[0].w;
  const h = list[0].h;
  const n = list.length;

  const sideTrim = (trimOf, darkFlag) => {
    const allTrims = [];
    let darkN = 0;
    for (const r of list) {
      const t = Math.max(0, trimOf(r) | 0);
      allTrims.push(t);
      if (r[darkFlag] && t > 0) darkN += 1;
    }
    const trim = Math.min(...allTrims);
    return { trim, dark: trim > 0 && darkN === n };
  };

  const leftS = sideTrim((r) => r.left, "darkLeft");
  const topS = sideTrim((r) => r.top, "darkTop");
  const rightS = sideTrim((r) => r.w - 1 - r.right, "darkRight");
  const bottomS = sideTrim((r) => r.h - 1 - r.bottom, "darkBottom");
  const L = leftS.trim;
  const T = topS.trim;
  const Rt = rightS.trim;
  const Bt = bottomS.trim;
  if (L === 0 && T === 0 && Rt === 0 && Bt === 0) return null;
  const right = w - 1 - Rt;
  const bottom = h - 1 - Bt;
  if (right <= L || bottom <= T) return null;
  return {
    left: L,
    top: T,
    right,
    bottom,
    w,
    h,
    darkLeft: leftS.dark && L > 0,
    darkRight: rightS.dark && Rt > 0,
    darkTop: topS.dark && T > 0,
    darkBottom: bottomS.dark && Bt > 0,
  };
}

/**
 * 合成带纯色边的 RGBA 图（离线单测）
 * @param {number} cw 内容宽
 * @param {number} ch 内容高
 * @param {{L?:number,R?:number,T?:number,B?:number, border?:[number,number,number], content?:[number,number,number]}} edges
 */
function makeBorderedRgba(cw, ch, edges = {}) {
  const L = edges.L || 0;
  const R = edges.R || 0;
  const T = edges.T || 0;
  const B = edges.B || 0;
  const br = edges.border || [8, 8, 8];
  const cr = edges.content || [180, 120, 90];
  const w = cw + L + R;
  const h = ch + T + B;
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inContent = x >= L && x < L + cw && y >= T && y < T + ch;
      const c = inContent ? cr : br;
      data[i] = c[0];
      data[i + 1] = c[1];
      data[i + 2] = c[2];
      data[i + 3] = 255;
    }
  }
  return { width: w, height: h, data };
}

/**
 * 量四边「暗条」像素数（成片断言用）
 * @param {{ width:number, height:number, data:Uint8ClampedArray|Uint8Array }} img
 */
function measureDarkBars(img, opts = {}) {
  const darkCh = opts.darkCh ?? 28;
  const darkRatio = opts.darkRatio ?? 0.85;
  const avgMax = opts.avgMax ?? 24;
  const maxFrac = opts.maxFrac ?? 0.25;
  const { width: w, height: h, data } = img;
  const colOk = (x) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let dark = 0;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      if (Math.max(data[i], data[i + 1], data[i + 2]) <= darkCh) dark += 1;
    }
    return dark / h >= darkRatio && Math.max(r / h, g / h, b / h) <= avgMax;
  };
  const rowOk = (y) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let dark = 0;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      if (Math.max(data[i], data[i + 1], data[i + 2]) <= darkCh) dark += 1;
    }
    return dark / w >= darkRatio && Math.max(r / w, g / w, b / w) <= avgMax;
  };
  let L = 0;
  let R = 0;
  let T = 0;
  let B = 0;
  const maxL = Math.floor(w * maxFrac);
  const maxR = Math.floor(w * maxFrac);
  const maxT = Math.floor(h * maxFrac);
  const maxB = Math.floor(h * maxFrac);
  while (L < maxL && colOk(L)) L++;
  while (R < maxR && colOk(w - 1 - R)) R++;
  while (T < maxT && rowOk(T)) T++;
  while (B < maxB && rowOk(h - 1 - B)) B++;
  return { L, R, T, B, w, h };
}

function cropRgba(img, crop) {
  const out = new Uint8ClampedArray(crop.w * crop.h * 4);
  for (let y = 0; y < crop.h; y++) {
    for (let x = 0; x < crop.w; x++) {
      const si = ((y + crop.y) * img.width + (x + crop.x)) * 4;
      const di = (y * crop.w + x) * 4;
      out[di] = img.data[si];
      out[di + 1] = img.data[si + 1];
      out[di + 2] = img.data[si + 2];
      out[di + 3] = 255;
    }
  }
  return { width: crop.w, height: crop.h, data: out };
}

module.exports = {
  CROP_ALGO_VER,
  DETECT_MAX_W,
  DARK_CH,
  DARK_RATIO,
  DARK_EDGE_AVG,
  MAX_SIDE_RATIO,
  detectFrameContentRect,
  mapThumbCropToSource,
  fullFrameContentRect,
  cropSampleMarks,
  unionContentRects,
  mergeContentRects,
  makeBorderedRgba,
  measureDarkBars,
  cropRgba,
};
