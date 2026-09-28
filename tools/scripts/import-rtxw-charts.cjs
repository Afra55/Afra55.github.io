#!/usr/bin/env node
/**
 * 从本机反编译「人体穴位图」目录导入示意图：
 * - 文件头前 2 字节对调解混淆（PNG/JPEG）
 * - 写出 tools/lib/acupoint/rtxw/
 * - 生成 rtxw-manifest.json
 *
 * 用法:
 *   node tools/scripts/import-rtxw-charts.mjs [反编译根目录]
 * 默认: F:/DecodeAAPPKK/人体穴位图 或环境变量 RTXW_SRC
 */
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "lib", "acupoint", "rtxw");

const APP_TO_ABBR = {
  lu: "LU",
  li: "LI",
  st: "ST",
  sp: "SP",
  ht: "HT",
  si: "SI",
  bl: "BL",
  ki: "KI",
  pc: "PC",
  tw: "TE",
  gb: "GB",
  lr: "LR",
  cv: "CV",
  gv: "GV",
};

const ABBR_LABEL = {
  LU: "手太阴肺经",
  LI: "手阳明大肠经",
  ST: "足阳明胃经",
  SP: "足太阴脾经",
  HT: "手少阴心经",
  SI: "手太阳小肠经",
  BL: "足太阳膀胱经",
  KI: "足少阴肾经",
  PC: "手厥阴心包经",
  TE: "手少阳三焦经",
  GB: "足少阳胆经",
  LR: "足厥阴肝经",
  CV: "任脉",
  GV: "督脉",
  EX: "经外奇穴",
};

const MERIDIAN_ORDER = ["LU", "LI", "ST", "SP", "HT", "SI", "BL", "KI", "PC", "TE", "GB", "LR", "CV", "GV"];

const BODY_LABELS = {
  a: "人体总图 A",
  b: "人体总图 B",
  c: "人体总图 C",
  d: "人体总图 D",
  e: "人体总图 E",
};

function findDefaultSrc() {
  if (process.env.RTXW_SRC) return process.env.RTXW_SRC;
  const parent = "F:\\DecodeAAPPKK";
  if (!fs.existsSync(parent)) return "";
  const hit = fs.readdirSync(parent).find((n) => /穴位/.test(n));
  return hit ? path.join(parent, hit) : "";
}

function deobfuscateBytes(buf) {
  if (!buf || buf.length < 2) return buf;
  const out = Buffer.from(buf);
  const a = out[0];
  out[0] = out[1];
  out[1] = a;
  return out;
}

function detectExt(buf) {
  if (buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return ".png";
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return ".jpg";
  if (buf.length >= 8 && buf[0] === 0x50 && buf[1] === 0x89 && buf[2] === 0x4e && buf[3] === 0x47) return ".png"; // still obfuscated
  if (buf.length >= 3 && buf[0] === 0xd8 && buf[1] === 0xff) return ".jpg";
  return ".bin";
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function writeDeobfuscated(srcFile, destPathNoExt) {
  const raw = fs.readFileSync(srcFile);
  const fixed = deobfuscateBytes(raw);
  const ext = detectExt(fixed);
  const dest = destPathNoExt + ext;
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, fixed);
  return path.relative(OUT, dest).replace(/\\/g, "/");
}

function naturalSegSort(a, b) {
  const ma = a.match(/_(\d+)$/);
  const mb = b.match(/_(\d+)$/);
  if (ma && mb) return Number(ma[1]) - Number(mb[1]);
  return a.localeCompare(b);
}

function main() {
  const srcRoot = path.resolve(process.argv[2] || findDefaultSrc());
  if (!srcRoot || !fs.existsSync(srcRoot)) {
    console.error("找不到反编译目录。用法: node tools/scripts/import-rtxw-charts.mjs <路径>");
    process.exit(1);
  }
  const assets = path.join(srcRoot, "flutter_assets", "assets");
  const imgDir = path.join(assets, "data_hans", "img");
  const diagramDir = path.join(assets, "data_hans", "diagram");
  const jwqxDir = path.join(assets, "data", "img_jwqx");
  const qjbmDir = path.join(assets, "data", "img_qjbm");
  const cateDir = path.join(assets, "data", "img_cate");

  if (!fs.existsSync(imgDir)) {
    console.error("缺少 data_hans/img:", imgDir);
    process.exit(1);
  }

  // clean output (keep ATTRIBUTION if any)
  ensureDir(OUT);
  for (const name of fs.readdirSync(OUT)) {
    if (name === "ATTRIBUTION.txt") continue;
    fs.rmSync(path.join(OUT, name), { recursive: true, force: true });
  }

  const meridiansMap = {};
  for (const file of fs.readdirSync(imgDir)) {
    const full = path.join(imgDir, file);
    if (!fs.statSync(full).isFile()) continue;
    const m = file.match(/^([a-z]+)_(meridian|\d+)$/i);
    if (!m) continue;
    const appKey = m[1].toLowerCase();
    const abbr = APP_TO_ABBR[appKey];
    if (!abbr) continue;
    if (!meridiansMap[abbr]) {
      meridiansMap[abbr] = {
        abbr,
        appKey,
        nameZh: ABBR_LABEL[abbr] || abbr,
        overview: "",
        segments: [],
      };
    }
    const rel = writeDeobfuscated(full, path.join(OUT, "meridians", abbr.toLowerCase(), file));
    if (m[2].toLowerCase() === "meridian") meridiansMap[abbr].overview = rel;
    else meridiansMap[abbr].segments.push({ id: file, file: rel });
  }
  for (const m of Object.values(meridiansMap)) {
    m.segments.sort((a, b) => naturalSegSort(a.id, b.id));
  }

  const body = [];
  if (fs.existsSync(diagramDir)) {
    for (const file of fs.readdirSync(diagramDir).sort()) {
      const full = path.join(diagramDir, file);
      if (!fs.statSync(full).isFile()) continue;
      const rel = writeDeobfuscated(full, path.join(OUT, "body", file));
      body.push({ id: file, file: rel, label: BODY_LABELS[file] || `总图 ${file}` });
    }
  }

  const extra = [];
  if (fs.existsSync(jwqxDir)) {
    const files = fs
      .readdirSync(jwqxDir)
      .filter((f) => /^JWQX_/i.test(f))
      .sort((a, b) => {
        const na = Number((a.match(/(\d+)/) || [])[1] || 0);
        const nb = Number((b.match(/(\d+)/) || [])[1] || 0);
        return na - nb;
      });
    for (const file of files) {
      const rel = writeDeobfuscated(path.join(jwqxDir, file), path.join(OUT, "extra", file));
      extra.push({ id: file, file: rel, index: Number((file.match(/(\d+)/) || [])[1] || 0) });
    }
  }

  const qjbm = [];
  if (fs.existsSync(qjbmDir)) {
    for (const file of fs.readdirSync(qjbmDir).sort()) {
      const full = path.join(qjbmDir, file);
      if (!fs.statSync(full).isFile()) continue;
      const rel = writeDeobfuscated(full, path.join(OUT, "qjbm", file));
      qjbm.push({ id: file, file: rel });
    }
  }

  const cate = {};
  if (fs.existsSync(cateDir)) {
    for (const file of fs.readdirSync(cateDir)) {
      const full = path.join(cateDir, file);
      if (!fs.statSync(full).isFile()) continue;
      const base = path.parse(file).name;
      const rel = writeDeobfuscated(full, path.join(OUT, "cate", base));
      cate[base] = rel;
    }
  }

  // cate icon hint by abbr (best-effort Chinese filenames from app)
  const cateByAbbr = {
    LU: cate.fei || cate.all || "",
    LI: cate.dc || "",
    ST: cate.wei || "",
    SP: cate.pi || "",
    HT: cate.xin || "",
    SI: cate.xb || "",
    BL: cate.pg || "",
    KI: cate.shen || "",
    PC: cate.xb || "",
    TE: cate.sj || "",
    GB: cate.dan || "",
    LR: cate.gan || "",
    CV: cate.rm || "",
    GV: cate.dm || "",
    EX: cate.jwqx || cate.qjbm || "",
  };

  const meridians = MERIDIAN_ORDER.filter((a) => meridiansMap[a]).map((a) => ({
    ...meridiansMap[a],
    icon: cateByAbbr[a] || "",
  }));

  const manifest = {
    version: 1,
    generated: new Date().toISOString(),
    source: "com.myapp.li.rentixuewei flutter_assets (deobfuscated header swap)",
    basePath: "./lib/acupoint/rtxw/",
    abbrMap: APP_TO_ABBR,
    labels: ABBR_LABEL,
    meridians,
    body,
    extra,
    qjbm,
    cate,
    cateByAbbr,
  };

  fs.writeFileSync(path.join(OUT, "rtxw-manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");
  fs.writeFileSync(
    path.join(OUT, "ATTRIBUTION.txt"),
    [
      "Charts imported from a local decompiled Android/Flutter package",
      "(com.myapp.li.rentixuewei / 人体穴位图) for personal tool UI.",
      "Files were header-deobfuscated (swap first two bytes).",
      "Do not redistribute commercially without rights clearance.",
      "",
    ].join("\n"),
    "utf8"
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        out: OUT,
        meridians: meridians.length,
        segments: meridians.reduce((n, m) => n + m.segments.length, 0),
        body: body.length,
        extra: extra.length,
        qjbm: qjbm.length,
        cate: Object.keys(cate).length,
      },
      null,
      2
    )
  );
}

main();
