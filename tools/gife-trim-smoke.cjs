"use strict";

const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const { GifWriter } = require("./vendor/omggif.js");

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function makeGif() {
  const buf = Buffer.alloc(64 * 1024);
  const palette = [0xff2244, 0x22cc66, 0x2266ff, 0x222222];
  const w = new GifWriter(buf, 16, 16, { loop: 0, palette });
  for (let i = 0; i < 12; i++) {
    const pixels = Buffer.alloc(16 * 16, i % 3);
    w.addFrame(0, 0, 16, 16, pixels, { delay: 12 });
  }
  return buf.subarray(0, w.end());
}

(async () => {
  const chrome =
    process.env.CHROME ||
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const html = fs.readFileSync(path.join(__dirname, "panels", "gife.html"), "utf8");
  const js = fs.readFileSync(path.join(__dirname, "extra-panels", "gife.js"), "utf8");
  const css = fs.readFileSync(path.join(__dirname, "styles", "panels", "gife.css"), "utf8");
  assert(html.includes('id="gife-timeline"'), "timeline html");
  assert(html.includes("设为起点") && html.includes("设为终点"), "mark buttons");
  assert(html.includes("预览保留段"), "play keep");
  assert(html.includes("用帧号微调"), "frame inputs secondary");
  assert(!html.includes("去掉前") || html.includes("gife-trim-advanced"), "numbers not primary-only");
  assert(js.includes("playGifeKeepRange") && js.includes("markGifeStart"), "trim js");
  assert(!js.includes("blackboxUseMaxBytes") && !js.includes("10MB"), "no 10MB on gife");
  assert(css.includes(".gife-handle") && css.includes("#f5c542"), "yellow handles");

  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox", "--disable-gpu"],
  });
  const page = await browser.newPage();
  page.setDefaultTimeout(30000);
  const errors = [];
  page.on("pageerror", (err) => errors.push(String(err)));
  await page.goto("http://127.0.0.1:8080/tools/#gife", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#gife-file", { timeout: 25000 });
  await page.waitForFunction(
    () => [...document.scripts].some((s) => (s.src || "").includes("extra-panels/gife.js")),
    { timeout: 20000 }
  );
  await new Promise((r) => setTimeout(r, 800));
  await page.waitForSelector("#gife-play", { timeout: 10000 });
  const gif = makeGif();
  const b64 = gif.toString("base64");
  await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const file = new File([bin], "trim-demo.gif", { type: "image/gif" });
    const input = document.getElementById("gife-file");
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }, b64);

  try {
    await page.waitForFunction(() => {
      const trim = document.getElementById("gife-trim");
      const clock = document.getElementById("gife-clock");
      return trim && !trim.hidden && clock && /12 帧/.test(clock.textContent || "");
    }, { timeout: 20000 });
  } catch (err) {
    const dump = await page.evaluate(() => ({
      err: document.getElementById("gife-error")?.textContent,
      meta: document.getElementById("gife-meta")?.textContent,
      clock: document.getElementById("gife-clock")?.textContent,
      trimHidden: document.getElementById("gife-trim")?.hidden,
      progress: document.getElementById("gife-progress-text")?.textContent,
      hasReader: typeof GifReader,
      hasWriter: typeof GifWriter,
      hasDecoder: typeof ImageDecoder,
    }));
    console.error("dump", dump, "pageErrors", errors);
    throw err;
  }

  for (let i = 0; i < 3; i++) await page.click("#gife-next");
  await page.click("#gife-mark-start");
  for (let i = 0; i < 5; i++) await page.click("#gife-next");
  await page.click("#gife-mark-end");

  const afterMark = await page.evaluate(() => ({
    head: document.getElementById("gife-trim-head").value,
    tail: document.getElementById("gife-trim-tail").value,
    clock: document.getElementById("gife-clock").textContent,
    meta: document.getElementById("gife-meta").textContent,
    startPct: document.getElementById("gife-timeline").style.getPropertyValue("--gife-start"),
    endPct: document.getElementById("gife-timeline").style.getPropertyValue("--gife-end"),
  }));
  assert(afterMark.head === "3", "start at frame 4 (head=3), got " + afterMark.head);
  assert(afterMark.tail === "3", "end 5 frames later from 3 -> frame 8, tail=3, got " + JSON.stringify(afterMark));
  assert(afterMark.meta.includes("保留 6 帧"), "keep 6 frames: " + afterMark.meta);
  assert(!/10MB|黑盒/.test(afterMark.meta), "no blackbox copy on gife meta");

  await page.click("#gife-play");
  await page.waitForFunction(() => document.getElementById("gife-play").textContent === "暂停", { timeout: 5000 });
  await new Promise((r) => setTimeout(r, 350));
  const playingClock = await page.$eval("#gife-clock", (el) => el.textContent);
  assert(/第 \d+\/12 帧/.test(playingClock), "clock while playing: " + playingClock);
  await page.click("#gife-play");

  await page.click("#gife-apply");
  await page.waitForFunction(() => {
    const a = document.getElementById("gife-download");
    return a && !a.hidden && a.getAttribute("href");
  }, { timeout: 25000 });

  const mobile = await page.evaluate(() => {
    const btn = document.getElementById("gife-mark-start");
    const handle = document.getElementById("gife-handle-start");
    const cs = getComputedStyle(btn);
    const hs = getComputedStyle(handle);
    return {
      btnH: parseFloat(cs.minHeight || cs.height),
      handleW: parseFloat(hs.width),
      timelineTouch: getComputedStyle(document.getElementById("gife-timeline")).touchAction,
    };
  });
  assert(mobile.handleW >= 28, "handle width " + mobile.handleW);
  assert(mobile.timelineTouch === "none", "timeline touch-action");

  await browser.close();
  if (errors.length) {
    console.error(errors.join("\n"));
    throw new Error("page errors");
  }
  console.log(JSON.stringify({ ok: true, afterMark, playingClock, mobile }, null, 2));
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
