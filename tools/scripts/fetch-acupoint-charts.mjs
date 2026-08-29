#!/usr/bin/env node
/**
 * 从 Wikimedia Commons 下载 Wellcome 经络参考图（CC BY 4.0）
 * 用法：node tools/scripts/fetch-acupoint-charts.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../lib/acupoint/wellcome");

/** @type {{ out: string, wiki: string }[]} */
const FILES = [
  {
    out: "whole-body-front-back.jpg",
    wiki: "Anterior_and_posterior_whole-body_acu-moxa_charts,_Chinese_Wellcome_L0037879.jpg",
  },
  { out: "figures-pair.jpg", wiki: "Acupuncture_figures_Wellcome_V0018479.jpg" },
  { out: "full-chart.jpg", wiki: "Chinese_chart_showing_acupuncture_points_Wellcome_L0005253.jpg" },
  {
    out: "thorax-abdomen.jpg",
    wiki: "Channels_and_acupoints_of_the_thorax_and_abdomen_Wellcome_L0037861.jpg",
  },
  { out: "back-torso.jpg", wiki: "Channels_and_acupoints_of_the_back_of_the_torso_Wellcome_L0037863.jpg" },
  {
    out: "head-front.jpg",
    wiki: "Channels_and_points_of_the_front_of_the_head_and_neck_Wellcome_L0037859.jpg",
  },
  {
    out: "head-back.jpg",
    wiki: "Channels_and_acupoints_of_the_back_of_the_head_and_neck_Wellcome_L0037860.jpg",
  },
  {
    out: "hand-yin-channels.jpg",
    wiki: "Chart_of_the_three_hand_yin_channels,_Chinese_woodcut_Wellcome_L0037908.jpg",
  },
  {
    out: "hand-yang-channels.jpg",
    wiki: "Chart_of_the_three_hand_yang_channels,_Chinese_woodcut_Wellcome_L0037907.jpg",
  },
  {
    out: "stomach-channel.jpg",
    wiki: "Acupuncture_chart,_stomach_channel_of_foot_yangming,_Chinese_Wellcome_L0037812.jpg",
  },
  {
    out: "kidney-channel.jpg",
    wiki: "Acupuncture_chart,_kidney_channel_of_foot_shaoyin,_Chinese_Wellcome_L0037822.jpg",
  },
  {
    out: "foot-acupoints.jpg",
    wiki: "Acupuncture_points_and_meridians._The_foot_Wellcome_L0043616.jpg",
  },
  {
    out: "head-front-17c.jpg",
    wiki: "Acupuncture_chart_of_front_of_head,_17th_C._Chinese_woodcut_Wellcome_L0034707.jpg",
  },
  {
    out: "chest-17c.jpg",
    wiki: "Acupuncture_chart_of_chest_and_abdomen,_17th_C._Chinese_Wellcome_L0034709.jpg",
  },
  {
    out: "head-back-17c.jpg",
    wiki: "Acupuncture_chart_of_back_of_head,_17th_C._Chinese_woodcut_Wellcome_L0034708.jpg",
  },
];

async function downloadOne({ out, wiki }, attempt = 1) {
  const dest = path.join(OUT_DIR, out);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 8000) {
    return { out, bytes: fs.statSync(dest).size, skipped: true };
  }
  const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(wiki)}`;
  const res = await fetch(url, { redirect: "follow" });
  if (res.status === 429 && attempt < 6) {
    await new Promise((r) => setTimeout(r, 2000 * attempt));
    return downloadOne({ out, wiki }, attempt + 1);
  }
  if (!res.ok) throw new Error(`${wiki} HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 8000) throw new Error(`${wiki} too small (${buf.length} bytes)`);
  fs.writeFileSync(dest, buf);
  return { out, bytes: buf.length };
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const results = [];
  for (const item of FILES) {
    process.stdout.write(`fetch ${item.out}… `);
    try {
      const r = await downloadOne(item);
      results.push(r);
      console.log(r.skipped ? `skip ${(r.bytes / 1024).toFixed(0)} KiB` : `${(r.bytes / 1024).toFixed(0)} KiB`);
    } catch (err) {
      console.log(`FAIL: ${err.message}`);
      process.exitCode = 1;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  console.log(`done: ${results.length}/${FILES.length}`);
}

main();
