#!/usr/bin/env node
"use strict";

const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = 17996;
const TOKEN = "devtools-ffmpeg";
const HOST = "127.0.0.1";
const EXPECTED_BRIDGE_VERSION = (() => {
  const src = fs.readFileSync(path.join(__dirname, "server.js"), "utf8");
  return src.match(/const BRIDGE_VERSION = "([^"]+)"/)?.[1] || "";
})();

function req(method, urlPath, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const r = http.request(
      {
        host: HOST,
        port: PORT,
        path: urlPath,
        method,
        headers,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
          resolve({ status: res.statusCode, json, text });
        });
      }
    );
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

async function waitJob(id, timeoutMs = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await req("GET", `/jobs/${id}`, { headers: { "X-Ffmpeg-Token": TOKEN } });
    if (res.status !== 200 || !res.json?.job) throw new Error(`job poll failed: ${res.text}`);
    const job = res.json.job;
    if (job.status === "done" || job.status === "error" || job.status === "cancelled") return job;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("job timeout");
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ff = spawn("ffmpeg", args, { stdio: "ignore" });
    ff.on("error", reject);
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}`))));
  });
}

async function runOp(op, paths, outDir, extra = {}) {
  const start = await req("POST", "/jobs/run", {
    headers: { "X-Ffmpeg-Token": TOKEN, "Content-Type": "application/json" },
    body: JSON.stringify({ op, paths, outDir, overwrite: true, createOutDir: true, ...extra }),
  });
  if (!start.json?.ok || !start.json.job?.id) throw new Error(`${op} start failed: ${start.text}`);
  const job = await waitJob(start.json.job.id);
  if (job.status !== "done") throw new Error(`${op} job failed: ${JSON.stringify(job)}`);
  if (!job.artifacts?.length) throw new Error(`${op}: no artifacts`);
  return job;
}

async function main() {
  const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: {
      ...process.env,
      FFMPEG_BRIDGE_PORT: String(PORT),
      FFMPEG_BRIDGE_TOKEN: TOKEN,
      FFMPEG_BRIDGE_ORIGINS: "http://127.0.0.1:8080,https://afra55.github.io",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let boot = "";
  child.stdout.on("data", (d) => {
    boot += d.toString("utf8");
  });
  child.stderr.on("data", (d) => {
    boot += d.toString("utf8");
  });

  try {
    let healthy = null;
    for (let i = 0; i < 50; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        healthy = await req("GET", "/health");
        if (healthy.status === 200) break;
      } catch {
        /* retry */
      }
    }
    if (!healthy?.json?.ok) throw new Error(`health failed: ${boot}`);
    if (String(healthy.json.version) !== EXPECTED_BRIDGE_VERSION) {
      throw new Error(`version ${healthy.json.version}, expected ${EXPECTED_BRIDGE_VERSION}`);
    }

    const ops = await req("GET", "/ops", { headers: { "X-Ffmpeg-Token": TOKEN } });
    if (!ops.json?.ok || ops.json.ops.length < 28) throw new Error(`ops ${ops.json?.ops?.length}`);
    if (!ops.json.tiers?.common?.length || !ops.json.tiers?.more?.length) throw new Error("tiers missing");
    if (!ops.json.aliases?.loudnorm) throw new Error("aliases missing");

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ff-smoke-"));
    const mp4 = path.join(tmp, "in.mp4");
    const mp4b = path.join(tmp, "in2.mp4");
    const png = path.join(tmp, "a.png");
    const png2 = path.join(tmp, "b.png");
    const srt = path.join(tmp, "in.srt");
    const outDir = path.join(tmp, "out");
    fs.mkdirSync(outDir);
    fs.writeFileSync(srt, "1\n00:00:00,000 --> 00:00:01,000\nhello\n");

    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=320x240:rate=10:duration=1.5",
      "-f",
      "lavfi",
      "-i",
      "sine=f=440:d=1.5",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      mp4,
    ]);
    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=320x240:rate=10:duration=0.8",
      "-f",
      "lavfi",
      "-i",
      "sine=f=880:d=0.8",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-shortest",
      mp4b,
    ]);
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=blue:s=320x240:d=0.1", "-frames:v", "1", png]);
    await runFfmpeg(["-y", "-f", "lavfi", "-i", "color=c=red:s=320x240:d=0.1", "-frames:v", "1", png2]);

    const results = {};
    results.extract = await runOp("extract-audio", [mp4], outDir, { format: "mp3" });
    const mp3 = path.join(outDir, results.extract.artifacts[0].name);

    // merged ops
    results.volumeAudio = await runOp("volume", [mp4], outDir, { volumePct: 120, volumeOut: "audio", format: "wav" });
    results.volumeVideo = await runOp("volume", [mp4], outDir, { volumePct: 80, volumeOut: "video" });
    results.normalize = await runOp("normalize", [mp4], outDir, { normAlgo: "loudnorm", format: "mp3" });
    results.channels = await runOp("channels", [mp4], outDir, { channelMode: "mono", format: "mp3" });
    results.convert = await runOp("convert", [mp4], outDir, { preset: "compress-high" });
    results.hevcPreset = await runOp("convert", [mp4], outDir, { preset: "hevc-32" });
    results.padBlack = await runOp("pad", [mp4], outDir, { padStyle: "black", padRatio: "16:9" });
    results.padBlur = await runOp("pad", [mp4], outDir, { padStyle: "blur", padRatio: "1080x1920" });
    results.rotate = await runOp("rotate", [mp4], outDir, { orient: "flip-h" });
    results.fx = await runOp("picture-fx", [mp4], outDir, { fx: "sharpen" });
    results.trimRange = await runOp("trim", [mp4], outDir, { trimMode: "range", startSec: 0.1, durationSec: 0.5 });
    results.trimTail = await runOp("trim", [mp4], outDir, { trimMode: "tail", tailSec: 0.6 });
    results.splitSeg = await runOp("split", [mp4], outDir, { splitMode: "segment", segmentSec: 1 });
    results.splitParts = await runOp("split", [mp4], outDir, { splitMode: "parts", parts: 2 });
    results.animGif = await runOp("anim", [mp4], outDir, { animFormat: "gif", gifFps: 8, gifWidth: 160 });
    results.animWebp = await runOp("anim", [mp4], outDir, { animFormat: "webp", gifFps: 8, gifWidth: 160 });

    // aliases still work
    results.aliasLoud = await runOp("loudnorm", [mp4], outDir, { format: "mp3" });
    results.aliasGif = await runOp("gif", [mp4], outDir, { gifFps: 8, gifWidth: 120 });
    results.aliasCompress = await runOp("compress", [mp4], outDir, { compress: "medium" });

    results.concat = await runOp("concat", [mp4, mp4b], outDir);
    results.replace = await runOp("replace-audio", [mp4, mp3], outDir);
    results.slideshow = await runOp("slideshow", [png, png2], outDir, { holdSec: 0.4, slideSize: "640x360" });
    results.burn = await runOp("burn-subs", [mp4], outDir);
    results.waveform = await runOp("waveform", [mp3], outDir, { waveSize: "640x360" });

    console.log(
      JSON.stringify(
        {
          ok: true,
          version: healthy.json.version,
          ops: ops.json.ops.length,
          common: ops.json.tiers.common.length,
          more: ops.json.tiers.more.length,
          aliases: Object.keys(ops.json.aliases).length,
          jobs: Object.keys(results).length,
        },
        null,
        2
      )
    );
  } finally {
    try {
      child.kill("SIGTERM");
    } catch {
      /* ignore */
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
