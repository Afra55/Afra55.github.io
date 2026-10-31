#!/usr/bin/env node
"use strict";

/**
 * 自动去色边：四边合成图断言 + 与 40-vbb.js / 面板默认开关同步检查。
 * 若本机有 D:\Download\1101.mp4 等样本，再跑离线 ffmpeg 回归（缺样本则跳过）。
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  DETECT_MAX_W,
  detectFrameContentRect,
  mapThumbCropToSource,
  makeBorderedRgba,
  measureDarkBars,
  cropRgba,
  cropSampleMarks,
  fullFrameContentRect,
  mergeContentRects,
} = require("./lib/vbb-auto-crop.js");

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assert failed");
}

function nearestResize(img, cw, ch) {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(cw * ch * 4);
  for (let y = 0; y < ch; y++) {
    const sy = Math.min(h - 1, Math.round((y + 0.5) * (h / ch) - 0.5));
    for (let x = 0; x < cw; x++) {
      const sx = Math.min(w - 1, Math.round((x + 0.5) * (w / cw) - 0.5));
      const si = (sy * w + sx) * 4;
      const di = (y * cw + x) * 4;
      out[di] = data[si];
      out[di + 1] = data[si + 1];
      out[di + 2] = data[si + 2];
      out[di + 3] = 255;
    }
  }
  return { width: cw, height: ch, data: out };
}

// ---- 合成图：四边各自能裁，裁后暗条 ≈ 0 ----
{
  const cases = [
    { name: "L-only", L: 24, R: 0, T: 0, B: 0 },
    { name: "R-only", L: 0, R: 30, T: 0, B: 0 },
    { name: "T-only", L: 0, R: 0, T: 18, B: 0 },
    { name: "B-only", L: 0, R: 0, T: 0, B: 22 },
    { name: "LR-only", L: 20, R: 24, T: 0, B: 0 },
    { name: "TB-only", L: 0, R: 0, T: 16, B: 18 },
    { name: "three-LRT", L: 14, R: 18, T: 12, B: 0 },
    { name: "three-LRB", L: 14, R: 18, T: 0, B: 12 },
    { name: "all-four", L: 16, R: 28, T: 12, B: 10 },
    { name: "fine-LR", L: 6, R: 8, T: 0, B: 0 },
  ];
  for (const c of cases) {
    const full = makeBorderedRgba(320, 240, c);
    const rect = detectFrameContentRect(full, 14);
    assert(rect, `${c.name}: 应检出边框`);
    const crop = mapThumbCropToSource(rect, full.width, full.height);
    assert(crop, `${c.name}: 应映射出 crop`);
    if (c.L) assert(crop.x >= c.L - 2, `${c.name}: 左边至少裁到 ~${c.L}，得 ${crop.x}`);
    if (c.R) {
      const rTrim = full.width - crop.x - crop.w;
      assert(rTrim >= c.R - 2, `${c.name}: 右边至少裁到 ~${c.R}，得 ${rTrim}`);
    }
    if (c.T) assert(crop.y >= c.T - 2, `${c.name}: 顶边至少裁到 ~${c.T}，得 ${crop.y}`);
    if (c.B) {
      const bTrim = full.height - crop.y - crop.h;
      assert(bTrim >= c.B - 2, `${c.name}: 底边至少裁到 ~${c.B}，得 ${bTrim}`);
    }
    const cropped = cropRgba(full, crop);
    const bars = measureDarkBars(cropped, { avgMax: 40, darkCh: 40 });
    assert(bars.L <= 1 && bars.R <= 1 && bars.T <= 1 && bars.B <= 1, `${c.name}: 裁后暗条应≈0，得 ${JSON.stringify(bars)}`);
  }
}

// ---- 缩略图路径（960 映射）细左右边 ----
{
  const full = makeBorderedRgba(960, 720, { L: 12, R: 20, T: 0, B: 0 });
  // 模拟源 1920×1440：先建大图
  const big = makeBorderedRgba(1888, 1440, { L: 12, R: 20 });
  const cw = Math.min(DETECT_MAX_W, big.width);
  const ch = Math.max(1, Math.round(big.height * (cw / big.width)));
  const thumb = nearestResize(big, cw, ch);
  const rect = detectFrameContentRect(thumb, 14);
  assert(rect, "细边缩略应检出");
  const crop = mapThumbCropToSource(rect, big.width, big.height);
  assert(crop, "细边应映射");
  const rTrim = big.width - crop.x - crop.w;
  assert(crop.x >= 10 && rTrim >= 18, `细边映射不足 L${crop.x} R${rTrim}`);
  const cropped = cropRgba(big, crop);
  const bars = measureDarkBars(cropped, { avgMax: 40, darkCh: 40 });
  // 映射回退 1px 保画面，允许残留 ≤1px 发丝边
  assert(bars.L <= 1 && bars.R <= 1 && bars.T <= 1 && bars.B <= 1, `细边裁后暗条≤1 ${JSON.stringify(bars)}`);
  void full;
}

// ---- 源码 / 面板同步 ----
{
  const vbb = fs.readFileSync(path.join(__dirname, "extra-panels/v2g-suite-src/40-vbb.js"), "utf8");
  const panel = fs.readFileSync(path.join(__dirname, "panels/vbb.html"), "utf8");
  assert(/devtools-vbb-auto-crop[\s\S]{0,120}!==\s*"0"/.test(vbb), "默认开：localStorage !== \"0\"");
  assert(/stored\s*==\s*null[\s\S]{0,80}setItem\([\s\S]{0,40}"1"/.test(vbb), "首次写入默认 1");
  assert(/cacheKey\s*=\s*`v14\|/.test(vbb), "crop 缓存键须为 v14");
  assert(/MAX_SIDE_RATIO\s*=\s*0\.25/.test(vbb), "单边上限须 25%");
  assert(/Math\.min\(\.\.\.allTrims\)/.test(vbb), "多帧合并须全体最小 trim（任一帧无边不裁）");
  assert(/detectVideoCropViaFfmpeg/.test(vbb), "须有 ffmpeg 抽帧回退（手机 HTML5 seek 失败）");
  assert(/frameLooksDecoded/.test(vbb), "须过滤未解码近黑帧");
  assert(/mergeCropRects/.test(vbb) && /fullFrameContentRect/.test(vbb), "须多帧合并且无边记整幅");
  assert(/darkN\s*===\s*n/.test(vbb), "暗边标记须全体样本该边都是暗边");
  assert(/isFlatBlackBar/.test(vbb) && /isLetterboxRow/.test(vbb), "左右纯黑 / 上下 letterbox 须分流");
  assert(/d \* 0\.5/.test(vbb) && /start \+ 0\.05/.test(vbb), "取样须含起/中/末");
  assert(/去色边未生效/.test(vbb), "开关开着但无 crop 须 toast 提示");
  assert(/devtools-vbb-auto-crop"\)\s*!==\s*"0"/.test(vbb), "DOM 缺失时仍认 localStorage");
  assert(!/编辑只裁了时长[\s\S]{0,40}禁止再叠/.test(vbb), "不得再因只裁时长跳过自动去色边");
  assert(/edit\?\.cropOn\s*&&\s*edit\.crop/.test(vbb), "手动裁画面仍优先绿框");
  assert(/id="vbb-auto-crop"\s+checked/.test(panel), "面板 checkbox 默认 checked");
  assert(/Math\.min\(960,\s*vw\)/.test(vbb), "检测宽须 960");
  assert(/DARK_RATIO\s*=\s*0\.9/.test(vbb), "暗边占比阈值须同步");
  assert(/cropFilter[\s\S]{0,40}crop=\$\{/.test(fs.readFileSync(path.join(__dirname, "extra-panels/v2g-suite-src/10-shared-encode.js"), "utf8"))
    || /cropFilter\s*=\s*crop\s*\?\s*`crop=/.test(fs.readFileSync(path.join(__dirname, "extra-panels/v2g-suite-src/10-shared-encode.js"), "utf8")),
    "ffmpeg/gifski 路径须带 cropFilter");
  const enc = fs.readFileSync(path.join(__dirname, "extra-panels/v2g-suite-src/10-shared-encode.js"), "utf8");
  assert(/cropFilter\s*=\s*crop\s*\?\s*`crop=/.test(enc), "encode 须真用 crop=w:h:x:y");
  assert(/q\.set\("crop"/.test(enc), "原生 gifski 须传 crop 查询参数");
}

// ---- 起/中/末取样 + 片头有边后半无边不误裁 ----
{
  const marks = cropSampleMarks(10);
  assert(marks.length === 3, `10s 应 3 点，得 ${marks}`);
  assert(marks[0] <= 0.12, `起点应靠近片头，得 ${marks[0]}`);
  assert(Math.abs(marks[1] - 5) < 0.01, `中点应≈5，得 ${marks[1]}`);
  assert(marks[2] >= 9.5, `终点应靠近片尾，得 ${marks[2]}`);
  const bordered = makeBorderedRgba(320, 240, { L: 24, R: 28, T: 0, B: 0 });
  const rBorder = detectFrameContentRect(bordered, 14);
  assert(rBorder, "有边帧应检出");
  const full = fullFrameContentRect(320, 240);
  const transient = mergeContentRects([rBorder, full, full]);
  assert(!transient, "仅 1/3 帧有边 → 不裁");
  const mixed = mergeContentRects([rBorder, rBorder, full]);
  assert(!mixed, "2/3 有边、1 帧无边 → 该边不裁");
  const stable = mergeContentRects([rBorder, rBorder, rBorder]);
  assert(stable && stable.left >= 20 && stable.w - 1 - stable.right >= 24, "三帧都有左右边 → 应裁左右");
  assert(stable.top === 0 && stable.bottom === stable.h - 1, "稳定左右边不得误裁上下");
  const uneven = makeBorderedRgba(320, 240, { L: 10, R: 10, T: 0, B: 0 });
  const rNarrow = detectFrameContentRect(uneven, 14);
  assert(rNarrow, "窄边应检出");
  const minMerge = mergeContentRects([rBorder, rNarrow, rBorder]);
  assert(minMerge && minMerge.left <= rNarrow.left, "多帧左右宽度不一 → 取最浅，不裁进窄边帧内容");
  const lrOnly = detectFrameContentRect(makeBorderedRgba(320, 240, { L: 20, R: 22 }), 14);
  const tbOnly = detectFrameContentRect(makeBorderedRgba(320, 240, { T: 16, B: 18 }), 14);
  assert(lrOnly && lrOnly.top === 0 && lrOnly.bottom === lrOnly.h - 1, "仅左右");
  assert(tbOnly && tbOnly.left === 0 && tbOnly.right === tbOnly.w - 1, "仅上下");
}

// ---- v14：底条 + 顶发丝；全体同意；纯色场不误裁；暗边映射不回退；夜景左右不误裁 ----
{
  // 仅底黑条（约 11%），模拟用户成片残留
  const bottomOnly = makeBorderedRgba(960, 720, { B: 80, border: [0, 0, 0], content: [60, 110, 50] });
  const rB = detectFrameContentRect(bottomOnly, 14);
  assert(rB && rB.darkBottom && rB.top === 0, `仅底条应检出暗底，得 ${JSON.stringify(rB)}`);
  const cropB = mapThumbCropToSource(rB, bottomOnly.width, bottomOnly.height);
  assert(cropB, "底条应映射");
  const bTrim = bottomOnly.height - cropB.y - cropB.h;
  assert(bTrim >= 80, `暗底映射应吃满≥80（含 +1），得 ${bTrim}`);
  const barsB = measureDarkBars(cropRgba(bottomOnly, cropB), { avgMax: 40, darkCh: 40 });
  assert(barsB.B <= 1 && barsB.T <= 1, `底条裁后应干净 ${JSON.stringify(barsB)}`);

  // 顶 2px + 底条
  const hair = makeBorderedRgba(960, 720, { T: 2, B: 80, border: [0, 0, 0], content: [70, 120, 55] });
  const rH = detectFrameContentRect(hair, 14);
  assert(rH && rH.darkTop && rH.top >= 2, `顶发丝应检出，得 top=${rH && rH.top}`);
  const cropH = mapThumbCropToSource(rH, hair.width, hair.height);
  assert(cropH && cropH.y >= 2, `暗顶不回退，y 应≥2，得 ${cropH && cropH.y}`);
  const barsH = measureDarkBars(cropRgba(hair, cropH), { avgMax: 40, darkCh: 40 });
  assert(barsH.T <= 1 && barsH.B <= 1, `发丝+底条裁后应干净 ${JSON.stringify(barsH)}`);

  // 整幅纯色不得当色边
  const flat = makeBorderedRgba(320, 240, { content: [40, 80, 40], border: [40, 80, 40] });
  // makeBordered with no LRTB still fills content color everywhere
  const rFlat = detectFrameContentRect(flat, 14);
  assert(!rFlat, `整幅纯色不得裁，得 ${JSON.stringify(rFlat)}`);

  // 用户截图像素：底条约 24/214
  const shot = "/home/ubuntu/.cursor/projects/workspace/assets/01a18f18-3be3-7177-8a4d-5a78f6ba8b6e.jpg";
  if (fs.existsSync(shot)) {
    const raw = "/tmp/vbb-user-shot.rgba";
    const ff = spawnSync("ffmpeg", ["-y", "-i", shot, "-f", "rawvideo", "-pix_fmt", "rgba", raw], {
      encoding: "utf8",
    });
    if (ff.status === 0 && fs.existsSync(raw)) {
      const buf = fs.readFileSync(raw);
      const img = { width: 448, height: 214, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, 448 * 214 * 4) };
      const rU = detectFrameContentRect(img, 14);
      assert(rU && rU.darkBottom, `用户截图应检出底黑条，得 ${JSON.stringify(rU)}`);
      const cropU = mapThumbCropToSource(rU, 448, 214);
      assert(cropU, "用户截图应映射 crop");
      const bt = 214 - cropU.y - cropU.h;
      assert(bt >= 22, `用户底条应裁掉≥22px，得 ${bt}`);
      const after = measureDarkBars(cropRgba(img, cropU), { avgMax: 40, darkCh: 40 });
      assert(after.B <= 2, `用户图裁后底条应≈0，得 ${JSON.stringify(after)}`);
    }
  }

  // 夜景骑士：左右是暗树林画面，不得当 pillarbox；上下 letterbox 仍可裁
  const night = "/home/ubuntu/.cursor/projects/workspace/assets/01a19057-91f4-7c8c-a22c-35f02a700127.jpg";
  if (fs.existsSync(night)) {
    const raw = "/tmp/vbb-night.rgba";
    const ff = spawnSync("ffmpeg", ["-y", "-i", night, "-f", "rawvideo", "-pix_fmt", "rgba", raw], {
      encoding: "utf8",
    });
    if (ff.status === 0 && fs.existsSync(raw)) {
      const dim = spawnSync(
        "ffprobe",
        ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", night],
        { encoding: "utf8" }
      ).stdout.trim();
      const [nw, nh] = dim.split(",").map(Number);
      const buf = fs.readFileSync(raw);
      const img = { width: nw, height: nh, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, nw * nh * 4) };
      const rN = detectFrameContentRect(img, 14);
      assert(rN, `夜景应至少检出上下黑边，得 ${JSON.stringify(rN)}`);
      assert(!rN.darkLeft && rN.left === 0, `夜景左树林不得裁，left=${rN.left}`);
      assert(!rN.darkRight && rN.right === nw - 1, `夜景右树林不得裁，right=${rN.right}`);
      assert(rN.darkTop && rN.top >= 80, `夜景顶 letterbox 应裁，top=${rN.top}`);
      assert(rN.darkBottom && nh - 1 - rN.bottom >= 80, `夜景底 letterbox 应裁，B=${nh - 1 - rN.bottom}`);
    }
  }
}

// ---- 可选：本机 Download 样本离线回归 ----
function findFfmpeg() {
  const candidates = [
    process.env.FFMPEG,
    "D:/ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe",
    "ffmpeg",
  ].filter(Boolean);
  for (const c of candidates) {
    const r = spawnSync(c, ["-version"], { encoding: "utf8" });
    if (r.status === 0) return c;
  }
  return null;
}

function findFfprobe(ff) {
  if (ff.endsWith("ffmpeg.exe")) return ff.replace(/ffmpeg\.exe$/i, "ffprobe.exe");
  if (ff.endsWith("ffmpeg")) return ff.replace(/ffmpeg$/i, "ffprobe");
  return "ffprobe";
}

function probeWH(fp, media) {
  const r = spawnSync(
    fp,
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", media],
    { encoding: "utf8" }
  );
  const [w, h] = String(r.stdout || "").trim().split(",").map(Number);
  return { w, h };
}

function loadFrameRgba(ff, media, t, w, h, rawPath) {
  const args = ["-y"];
  if (t > 0) args.push("-ss", String(t));
  args.push("-i", media, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgba", rawPath);
  const r = spawnSync(ff, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr?.slice(-200) || "ffmpeg failed");
  const buf = fs.readFileSync(rawPath);
  return { width: w, height: h, data: new Uint8ClampedArray(buf.buffer, buf.byteOffset, buf.byteLength) };
}

function verifyDownloadSample(ff, fp, name) {
  const video = path.join("D:/Download", name);
  if (!fs.existsSync(video)) return null;
  const { w: vw, h: vh } = probeWH(fp, video);
  const durR = spawnSync(fp, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", video], {
    encoding: "utf8",
  });
  const dur = Number(String(durR.stdout).trim()) || 1;
  const tmp = path.join(__dirname, ".tmp-vbb-border");
  fs.mkdirSync(tmp, { recursive: true });
  const samples = [];
  for (const t of cropSampleMarks(dur)) {
    const raw = path.join(tmp, `reg-${name}-${String(t).replace(".", "_")}.rgba`);
    const full = loadFrameRgba(ff, video, t, vw, vh, raw);
    const cw = Math.min(DETECT_MAX_W, vw);
    const ch = Math.max(1, Math.round(vh * (cw / vw)));
    const thumb = nearestResize(full, cw, ch);
    samples.push(detectFrameContentRect(thumb, 14) || fullFrameContentRect(cw, ch));
  }
  const acc = mergeContentRects(samples);
  assert(acc, `${name}: 应检出边框`);
  const crop = mapThumbCropToSource(acc, vw, vh);
  assert(crop, `${name}: 应映射 crop`);
  const midRaw = path.join(tmp, `reg-${name}-mid.rgba`);
  const mid = loadFrameRgba(ff, video, Math.min(dur * 0.4, dur - 0.05), vw, vh, midRaw);
  const cropped = cropRgba(mid, crop);
  // 黑盒成片约 420 宽：在缩略尺寸上断言（全分辨率可能剩 1～4px 过渡，缩后应消掉）
  const outW = 420;
  const outH = Math.max(2, Math.round((cropped.height * outW) / cropped.width / 2) * 2);
  const scaled = nearestResize(cropped, outW, outH);
  const bars = measureDarkBars(scaled, { avgMax: 36, darkCh: 32 });
  assert(
    bars.L <= 1 && bars.R <= 1 && bars.T <= 1 && bars.B <= 1,
    `${name}: 缩到 ${outW}x${outH} 后四边暗条≈0，crop=${crop.w}x${crop.h}+${crop.x}+${crop.y} bars=${JSON.stringify(bars)}`
  );
  return { name, crop, bars };
}

{
  const ff = findFfmpeg();
  if (ff) {
    const fp = findFfprobe(ff);
    const samples = ["1101.mp4", "1096.mp4", "1084.mp4", "1077.mp4", "1078.mp4"];
    let ran = 0;
    for (const s of samples) {
      const got = verifyDownloadSample(ff, fp, s);
      if (got) {
        ran += 1;
        console.log(`sample OK ${got.name}: crop=${got.crop.w}x${got.crop.h}+${got.crop.x}+${got.crop.y}`);
      }
    }
    if (ran) console.log(`offline samples: ${ran}/${samples.length}`);
    else console.log("offline samples: skipped (no D:\\\\Download videos)");
  } else {
    console.log("offline samples: skipped (no ffmpeg)");
  }
}

console.log("vbb-auto-crop.test.js: all passed");
