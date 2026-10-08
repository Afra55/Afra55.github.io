/**
 * 黑盒「自动裁剪纯色边框」纯函数（与 v2g-suite-src/40-vbb.js 对齐）。
 * Node 单测 / 离线回归用；浏览器套件内另有同名实现，改一处必须两边一起改。
 *
 * v8：暗边按占比吃边；映射多吃约 1 缩略像素；四边对称。
 */
"use strict";

const DARK_CH = 32;
const DARK_RATIO = 0.9;
const DARK_EDGE_AVG = 36;
const SOFT_CH = 48;
const SOFT_RATIO = 0.82;
const OUTLIER_RATIO = 0.012;
const MAX_SIDE_RATIO = 0.18;
/** 检测缩略图最大宽（细左右边在 360 宽里易丢） */
const DETECT_MAX_W = 960;

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
    };
  };
  const isDarkBorder = (st) => st.avgMax <= DARK_EDGE_AVG && st.darkRatio >= DARK_RATIO;
  const isSoftDark = (st) =>
    st.avgMax <= SOFT_CH + 8 && st.softRatio >= SOFT_RATIO && st.darkRatio >= 0.55;
  const rowAt = (y) => (i) => px(i, y);
  const colAt = (x) => (i) => px(x, i);
  const scanSide = (isCol, fromStart, maxN) => {
    const length = isCol ? h : w;
    const span = isCol ? w : h;
    const lineAt = isCol ? colAt : rowAt;
    const edgeIdx = fromStart ? 0 : span - 1;
    const st0 = lineStats(lineAt(edgeIdx), length);
    const darkish =
      isDarkBorder(st0) || (st0.darkRatio >= 0.85 && st0.avgMax <= DARK_EDGE_AVG + 6);
    if (darkish) {
      let trim = 0;
      let idx = edgeIdx;
      while (trim < maxN) {
        const st = lineStats(lineAt(idx), length);
        const hard = st.darkRatio >= DARK_RATIO && st.avgMax <= DARK_EDGE_AVG + 4;
        if (hard || isSoftDark(st)) {
          trim += 1;
          idx = fromStart ? idx + 1 : idx - 1;
          continue;
        }
        break;
      }
      if (trim > 0 && trim < maxN) {
        const st = lineStats(lineAt(idx), length);
        if (st.avgMax <= 55 && st.darkRatio >= 0.35) trim += 1;
      }
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
  const extraX = Math.max(1, Math.round(sx));
  const extraY = Math.max(1, Math.round(sy));
  if (acc.darkLeft && x > 0) x = Math.min(x + extraX, Math.floor(vw * 0.2));
  if (acc.darkRight && x2 < vw) x2 = Math.max(x + 8, x2 - extraX);
  if (acc.darkTop && y > 0) y = Math.min(y + extraY, Math.floor(vh * 0.2));
  if (acc.darkBottom && y2 < vh) y2 = Math.max(y + 8, y2 - extraY);
  if (!acc.darkLeft && x > 0) x -= 1;
  if (!acc.darkTop && y > 0) y -= 1;
  if (!acc.darkRight && x2 < vw) x2 += 1;
  if (!acc.darkBottom && y2 < vh) y2 += 1;
  let w = x2 - x;
  let h = y2 - y;
  if (x + w > vw) w = vw - x;
  if (y + h > vh) h = vh - y;
  if (w >= 8 && h >= 8 && (w < vw - 2 || h < vh - 2)) return { x, y, w, h };
  return null;
}

/** 内容并集：各边取最浅裁 */
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
  DETECT_MAX_W,
  DARK_CH,
  DARK_RATIO,
  DARK_EDGE_AVG,
  detectFrameContentRect,
  mapThumbCropToSource,
  unionContentRects,
  makeBorderedRgba,
  measureDarkBars,
  cropRgba,
};
