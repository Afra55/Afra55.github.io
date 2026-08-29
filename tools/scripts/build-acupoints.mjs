#!/usr/bin/env node
/**
 * 合并本草典（CC BY-SA 4.0）经穴详情与 AcuKG 361 经穴名录，生成 tools/lib/acupoints-bundle.json
 * 运行：node tools/scripts/build-acupoints.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

const MERIDIAN_PREFIX = {
  LU: "shou_tai_yin_fei",
  LI: "shou_yang_ming_da_chang",
  ST: "zu_yang_ming_wei",
  SP: "zu_tai_yin_pi",
  HT: "shou_shao_yin_xin",
  SI: "shou_tai_yang_xiao_chang",
  BL: "zu_tai_yang_pang_guang",
  KI: "zu_shao_yin_shen",
  PC: "shou_jue_yin_xin_bao",
  TE: "shou_shao_yang_san_jiao",
  GB: "zu_shao_yang_dan",
  LR: "zu_jue_yin_gan",
  CV: "ren_mai",
  GV: "du_mai",
};

function readJsonl(file) {
  return fs
    .readFileSync(file, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function acuKgToCode(raw) {
  const m = String(raw).match(/^([A-Z]+)(\d+)$/);
  if (!m) return raw;
  return `${m[1]}-${Number(m[2])}`;
}

/** 本草典 REN/DU 与 AcuKG CV/GV 互通 */
function lookupRich(richByCode, code) {
  return richByCode[code] || null;
}

function slugFromName(name) {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9\u4e00-\u9fff-]/g, "");
}

function pickTexts(items) {
  if (!Array.isArray(items)) return [];
  return items.map((x) => (typeof x === "string" ? x : x.zh || x.en || "")).filter(Boolean);
}

async function main() {
  const bencaodianPath = process.env.BENCAODIAN_ACUPOINTS || "/tmp/acupoints-bencaodian.json";
  const meridiansPath = process.env.BENCAODIAN_MERIDIANS || "/tmp/meridians-bencaodian.json";
  const acuCnPath = process.env.ACUKG_CN || "/tmp/acu-Chinesename.json";
  const acuPyPath = process.env.ACUKG_PY || "/tmp/acu-pinyinname.json";
  const acuIndPath = process.env.ACUKG_IND || "/tmp/acu-Indication.json";
  const extraPath = path.join(ROOT, "lib", "extra-acupoints-source.json");

  for (const p of [bencaodianPath, meridiansPath, acuCnPath, acuPyPath, acuIndPath]) {
    if (!fs.existsSync(p)) {
      console.error(`缺少输入文件: ${p}`);
      process.exit(1);
    }
  }
  if (!fs.existsSync(extraPath)) {
    console.error(`缺少奇穴源文件: ${extraPath}`);
    process.exit(1);
  }

  const bencaodian = JSON.parse(fs.readFileSync(bencaodianPath, "utf8"));
  const meridiansRaw = JSON.parse(fs.readFileSync(meridiansPath, "utf8"));
  const cnRows = readJsonl(acuCnPath);
  const pyRows = readJsonl(acuPyPath);
  const indRows = readJsonl(acuIndPath);
  const extraRaw = JSON.parse(fs.readFileSync(extraPath, "utf8"));

  const richByCode = {};
  bencaodian.filter((x) => x.code).forEach((x) => {
    richByCode[x.code] = x;
    const m = x.code.match(/^(REN|DU)-(\d+)$/);
    if (m) richByCode[`${m[1] === "REN" ? "CV" : "GV"}-${m[2]}`] = x;
  });

  const nameByCode = Object.fromEntries(
    cnRows.map((x) => [x.Acupoint_Code, String(x.Chinese_Name || "").replace(/\([^)]*\)/g, "").trim()])
  );
  const pinyinByCode = Object.fromEntries(
    pyRows.map((x) => [x.Acupoint_Code, x.Pinyin_Name || x.Pinyin || ""])
  );
  const indByCode = {};
  indRows.forEach((x) => {
    if (!indByCode[x.Acupoint_Code]) indByCode[x.Acupoint_Code] = [];
    if (x.Indication) indByCode[x.Acupoint_Code].push(x.Indication);
  });

  const meridians = meridiansRaw.map((m) => ({
    key: m.key,
    slug: m.slug,
    nameZh: m.name_zh,
    namePinyin: m.name_pinyin,
    nameEn: m.name_en,
    abbreviation: m.abbreviation,
    element: m.element,
    yinYang: m.yin_yang,
    limb: m.limb,
    descriptionZh: m.description_zh || "",
    descriptionEn: m.description_en || "",
  }));

  const meridianByAbbr = Object.fromEntries(meridians.map((m) => [m.abbreviation, m]));

  const meridianPoints = cnRows
    .map((row) => {
      const rawCode = row.Acupoint_Code;
      const code = acuKgToCode(rawCode);
      const prefix = rawCode.replace(/\d+$/, "");
      const meridianKey = MERIDIAN_PREFIX[prefix] || "";
      const rich = lookupRich(richByCode, code);
      const nameZh = rich?.name_zh || nameByCode[rawCode] || "";
      const namePinyin = rich?.name_pinyin || pinyinByCode[rawCode] || "";
      const nameEn = rich?.name_en || pinyinByCode[rawCode] || "";

      return {
        id: rich?.key || slugFromName(nameZh) || rawCode.toLowerCase(),
        code,
        nameZh,
        namePinyin,
        nameEn,
        meridianKey,
        meridianAbbr: meridianByAbbr[prefix]?.abbreviation || prefix,
        type: "meridian",
        location: rich?.location?.zh || "",
        locationEn: rich?.location?.en || "",
        depth:
          rich?.depth && (rich.depth.min_cun || rich.depth.max_cun)
            ? `${rich.depth.method || "直刺"} ${rich.depth.min_cun || "?"}–${rich.depth.max_cun || "?"} 寸`
            : "",
        moxibustion: rich?.moxibustion ?? null,
        specialCategories: rich?.special_categories || [],
        actions: pickTexts(rich?.actions),
        indications: rich?.indications?.length ? pickTexts(rich.indications) : indByCode[rawCode] || [],
        description: rich?.description_zh || "",
        descriptionEn: rich?.description_en || "",
        rich: Boolean(rich),
      };
    })
    .sort((a, b) => {
      const [ap, an] = a.code.split("-");
      const [bp, bn] = b.code.split("-");
      if (ap !== bp) return ap.localeCompare(bp);
      return Number(an) - Number(bn);
    });

  // meridianPoints only — extra merged below
  const extraPoints = extraRaw.map((row) => ({
    id: slugFromName(row.nameZh) || row.code.toLowerCase(),
    code: row.code,
    nameZh: row.nameZh,
    namePinyin: row.namePinyin || "",
    nameEn: row.nameEn || "",
    meridianKey: "",
    meridianAbbr: "EX",
    region: row.region || "奇穴",
    type: "extra",
    location: row.location || "",
    locationEn: "",
    depth: "",
    moxibustion: null,
    specialCategories: [],
    actions: [],
    indications: row.indications || [],
    description: "",
    descriptionEn: "",
    rich: Boolean(row.location),
  }));

  const acupoints = [...meridianPoints, ...extraPoints].sort((a, b) => {
    if (a.type !== b.type) return a.type === "meridian" ? -1 : 1;
    const [ap, an] = a.code.split("-");
    const [bp, bn] = b.code.split("-");
    if (ap !== bp) return ap.localeCompare(bp);
    const anNum = Number(an);
    const bnNum = Number(bn);
    if (!Number.isNaN(anNum) && !Number.isNaN(bnNum)) return anNum - bnNum;
    return String(an).localeCompare(String(bn));
  });

  const bundle = {
    version: 2,
    generated: new Date().toISOString().slice(0, 10),
    counts: {
      meridians: meridians.length,
      acupoints: meridianPoints.length,
      extraPoints: extraPoints.length,
      total: acupoints.length,
      richDetail: meridianPoints.filter((x) => x.rich).length,
    },
    attribution: {
      bencaodian: "Bencaodian Editorial / 本草典编辑部 — CC BY-SA 4.0",
      acukg: "AcuKG (yimingli99) — 经穴名录与主治英文条目",
      extraStandard: "GB/T 40997-2021 经外奇穴名称与定位（51 穴，本站结构化整理）",
      charts: "Wellcome Collection — CC BY 4.0（经络参考图）",
    },
    meridians,
    acupoints,
  };

  const outPath = path.join(ROOT, "lib", "acupoints-bundle.json");
  fs.writeFileSync(outPath, `${JSON.stringify(bundle)}\n`);
  console.log(`Wrote ${outPath}`);
  console.log(JSON.stringify(bundle.counts));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
