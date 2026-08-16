#!/usr/bin/env node
"use strict";

const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = 17992;
const TOKEN = "devtools-ffmpeg";
const HOST = "127.0.0.1";

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

async function waitJob(id, timeoutMs = 120000) {
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
    ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exit ${code}: ${args.join(" ")}`))));
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
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100));
      try {
        healthy = await req("GET", "/health");
        if (healthy.status === 200) break;
      } catch {
        /* retry */
      }
    }
    if (!healthy || healthy.status !== 200 || !healthy.json?.ok) {
      throw new Error(`health failed: ${boot || JSON.stringify(healthy)}`);
    }
    if (!healthy.json.ffmpeg?.ok) throw new Error(`ffmpeg missing on host: ${JSON.stringify(healthy.json.ffmpeg)}`);
    if (String(healthy.json.version) !== "0.3.0") {
      throw new Error(`unexpected bridge version: ${healthy.json.version}`);
    }

    const denied = await req("GET", "/local/roots");
    if (denied.status !== 401) throw new Error(`expected 401 without token, got ${denied.status}`);

    const ops = await req("GET", "/ops", { headers: { "X-Ffmpeg-Token": TOKEN } });
    if (!ops.json?.ok || !Array.isArray(ops.json.ops) || ops.json.ops.length < 20) {
      throw new Error(`ops catalog too small: ${ops.text}`);
    }
    const opIds = new Set(ops.json.ops.map((o) => o.id));
    for (const need of [
      "extract-audio",
      "volume",
      "loudnorm",
      "convert",
      "compress",
      "hevc",
      "scale",
      "mute",
      "crop",
      "pad",
      "rotate",
      "flip",
      "speed",
      "trim",
      "fade",
      "gif",
      "thumb",
      "frames",
      "concat",
      "overlay-text",
      "reverse",
      "mono",
      "denoise-audio",
      "loop",
      "eq",
      "deinterlace",
      "audio-convert",
      "fps",
    ]) {
      if (!opIds.has(need)) throw new Error(`missing op: ${need}`);
    }

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ff-smoke-"));
    const mp4 = path.join(tmp, "in.mp4");
    const mp4b = path.join(tmp, "in2.mp4");
    const outDir = path.join(tmp, "out");
    fs.mkdirSync(outDir);

    await runFfmpeg([
      "-y",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=320x240:rate=10:duration=1.2",
      "-f",
      "lavfi",
      "-i",
      "sine=f=440:d=1.2",
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

    const results = {};

    results.extract = await runOp("extract-audio", [mp4], outDir, { format: "mp3" });
    results.volume = await runOp("volume", [mp4], outDir, { volumePct: 150, format: "wav" });
    results.loudnorm = await runOp("loudnorm", [mp4], outDir, { format: "mp3" });
    results.mono = await runOp("mono", [mp4], outDir, { format: "mp3" });
    results.denoise = await runOp("denoise-audio", [mp4], outDir, { format: "mp3" });
    results.convert = await runOp("convert", [mp4], outDir, { preset: "mp4-fast" });
    results.compress = await runOp("compress", [mp4], outDir, { compress: "high" });
    results.scale = await runOp("scale", [mp4], outDir, { height: 180 });
    results.fps = await runOp("fps", [mp4], outDir, { fps: 15 });
    results.mute = await runOp("mute", [mp4], outDir);
    results.crop = await runOp("crop", [mp4], outDir, { cropRatio: "1:1" });
    results.pad = await runOp("pad", [mp4], outDir, { padRatio: "16:9" });
    results.rotate = await runOp("rotate", [mp4], outDir, { rotate: 90 });
    results.flip = await runOp("flip", [mp4], outDir, { flip: "h" });
    results.speed = await runOp("speed", [mp4], outDir, { speed: 2 });
    results.trim = await runOp("trim", [mp4], outDir, { startSec: 0.1, durationSec: 0.5 });
    results.fade = await runOp("fade", [mp4], outDir, { fadeIn: 0.2, fadeOut: 0.2 });
    results.gif = await runOp("gif", [mp4], outDir, { gifFps: 8, gifWidth: 160 });
    results.thumb = await runOp("thumb", [mp4], outDir, { atSec: 0.3 });
    results.frames = await runOp("frames", [mp4], outDir, { everySec: 0.5 });
    results.reverse = await runOp("reverse", [mp4], outDir);
    results.deinterlace = await runOp("deinterlace", [mp4], outDir);
    results.eq = await runOp("eq", [mp4], outDir, { brightness: 0.05, contrast: 1.1, saturation: 1.1 });
    results.loop = await runOp("loop", [mp4], outDir, { loops: 2 });
    results.overlay = await runOp("overlay-text", [mp4], outDir, { text: "ok", textPos: "br", fontSize: 20 });
    results.concat = await runOp("concat", [mp4, mp4b], outDir);
    results.hevc = await runOp("hevc", [mp4], outDir, { hevcCrf: "32" });

    const mp3Art = path.join(outDir, results.extract.artifacts[0].name);
    if (!fs.existsSync(mp3Art)) throw new Error(`artifact missing: ${mp3Art}`);
    results.audioConvert = await runOp("audio-convert", [mp3Art], outDir, { format: "wav" });

    const probe = await req("POST", "/probe/batch", {
      headers: { "X-Ffmpeg-Token": TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ paths: [mp4, mp4b] }),
    });
    if (!probe.json?.ok || probe.json.items?.length !== 2) throw new Error(`probe batch failed: ${probe.text}`);

    const summary = {
      ok: true,
      version: healthy.json.version,
      ops: ops.json.ops.length,
      features: healthy.json.features?.length || 0,
      jobs: Object.fromEntries(
        Object.entries(results).map(([k, j]) => [k, { status: j.status, artifacts: j.artifacts?.length || 0 }])
      ),
    };
    console.log(JSON.stringify(summary, null, 2));
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
