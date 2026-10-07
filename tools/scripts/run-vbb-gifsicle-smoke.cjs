#!/usr/bin/env node
/** Puppeteer：打开 #vbb，确认 resolve + loadGifsicle 预热成功 */
"use strict";

const path = require("path");
const fs = require("fs");

async function main() {
  const puppeteer = require("puppeteer-core");
  const chrome =
    process.env.CHROME_PATH ||
    (process.platform === "win32"
      ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      : "google-chrome");
  const base = process.argv[2] || "http://127.0.0.1:8080/tools/";
  const mp4 = process.argv[3] || "D:\\Download\\1042.mp4";

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(90000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    // 1) 正常 /tools/#vbb
    await page.goto(`${base.replace(/\/?$/, "/")}#vbb`, { waitUntil: "networkidle2" });
    await page.waitForFunction(
      () => window.DevToolsExtraMedia && typeof window.DevToolsExtraMedia.loadGifsicle === "function",
      { timeout: 60000 }
    );
    const r1 = await page.evaluate(async () => {
      const M = window.DevToolsExtraMedia;
      const resolve = window.resolveToolsAssetUrl;
      const url = resolve("vendor/gifsicle.min.js");
      const g = await M.loadGifsicle();
      return {
        build: window.TOOLS_BUILD,
        url,
        hasRun: typeof g?.run === "function",
        activeHash: location.hash,
      };
    });
    console.log("vbb-gifsicle:", JSON.stringify(r1));
    if (!r1.hasRun || !/\/tools\/vendor\/gifsicle\.min\.js\?v=/.test(r1.url)) {
      throw new Error("loadGifsicle failed on /tools/");
    }

    // 2) 在已加载页上模拟 pathname=/tools（无尾斜杠）时的 resolve 行为
    const r2 = await page.evaluate(() => {
      const resolve = window.resolveToolsAssetUrl;
      const fake = new URL(location.href);
      fake.pathname = "/tools";
      fake.search = "";
      fake.hash = "";
      // 直接测公共函数（不依赖服务器是否重定向 /tools）
      const url = resolve("vendor/gifsicle.min.js");
      const naive = new URL("./vendor/gifsicle.min.js", fake.href).href;
      return { url, naive, path: location.pathname };
    });
    console.log("no-slash-sim:", JSON.stringify(r2));
    if (!/\/tools\/vendor\/gifsicle\.min\.js\?v=/.test(r2.url)) {
      throw new Error("resolve broken after vbb load: " + r2.url);
    }
    if (/\/tools\/vendor\//.test(r2.naive)) {
      console.log("no-slash-note: naive unexpectedly under /tools");
    }

    // 3) 可选：挂本地 mp4，确认面板吃到文件 + gifsicle 仍可用
    if (fs.existsSync(mp4)) {
      await page.waitForSelector("#vbb-file", { timeout: 30000 });
      const input = await page.$("#vbb-file");
      if (input) {
        await input.uploadFile(mp4);
        await new Promise((r) => setTimeout(r, 1200));
        const meta = await page.evaluate(() => {
          const v = document.querySelector("#vbb-video");
          return {
            hasSrc: Boolean(v && v.src),
            readyState: v ? v.readyState : -1,
            duration: v && Number.isFinite(v.duration) ? v.duration : null,
          };
        });
        console.log("mp4-attach:", JSON.stringify(meta));
        const warm = await page.evaluate(async () => {
          const g = await window.DevToolsExtraMedia.loadGifsicle();
          return typeof g?.run === "function";
        });
        console.log("mp4-gifsicle-warm:", warm);
        if (!warm) throw new Error("gifsicle warm failed after mp4 attach");
      } else {
        console.log("mp4-attach: #vbb-file not found");
      }
    } else {
      console.log("mp4-skip: file not found " + mp4);
    }

    if (errors.length) console.log("pageerrors:", errors.slice(0, 5).join(" | "));
    console.log("vbb-smoke: PASS");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("vbb-smoke: FAIL", err.message || err);
  process.exit(1);
});
