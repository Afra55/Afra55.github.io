#!/usr/bin/env node
"use strict";

const http = require("http");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const PORT = 17993;
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
    if (!healthy || healthy.status !== 200 || !healthy.json?.ok) {
      throw new Error(`health failed: ${boot || JSON.stringify(healthy)}`);
    }
    if (!healthy.json.ffmpeg?.ok) throw new Error(`ffmpeg missing: ${JSON.stringify(healthy.json.ffmpeg)}`);
    if (String(healthy.json.version) !== "0.4.0") throw new Error(`unexpected version: ${healthy.json.version}`);

    const ops = await req("GET", "/ops", { headers: { "X-Ffmpeg-Token": TOKEN } });
    if (!ops.json?.ok || ops.json.ops.length < 45) throw new Error(`ops too few: ${ops.json?.ops?.length}`);
    const opIds = new Set(ops.json.ops.map((o) => o.id));

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
    const batch = [
      ["extract-audio", [mp4], { format: "mp3" }],
      ["volume", [mp4], { volumePct: 120, format: "wav" }],
      ["loudnorm", [mp4], { format: "mp3" }],
      ["dynaudnorm", [mp4], { format: "mp3" }],
      ["mono", [mp4], { format: "mp3" }],
      ["stereo", [mp4], { format: "mp3" }],
      ["denoise-audio", [mp4], { format: "mp3" }],
      ["silence-trim", [mp4], { format: "mp3" }],
      ["sample-rate", [mp4], { sampleRate: "22050", format: "mp3" }],
      ["convert", [mp4], { preset: "mp4-fast" }],
      ["compress", [mp4], { compress: "high" }],
      ["hevc", [mp4], { hevcCrf: "32" }],
      ["scale", [mp4], { height: 180 }],
      ["fps", [mp4], { fps: 12 }],
      ["mute", [mp4], {}],
      ["crop", [mp4], { cropRatio: "1:1" }],
      ["pad", [mp4], { padRatio: "16:9" }],
      ["blur-pad", [mp4], { blurPadSize: "1080x1920" }],
      ["rotate", [mp4], { rotate: 90 }],
      ["flip", [mp4], { flip: "h" }],
      ["reverse", [mp4], {}],
      ["deinterlace", [mp4], {}],
      ["eq", [mp4], { brightness: 0.05, contrast: 1.05, saturation: 1.05 }],
      ["sharpen", [mp4], {}],
      ["blur", [mp4], { blurStrength: "3" }],
      ["deshake", [mp4], {}],
      ["hue", [mp4], { hueDeg: 20 }],
      ["vignette", [mp4], {}],
      ["negate", [mp4], {}],
      ["speed", [mp4], { speed: 2 }],
      ["trim", [mp4], { startSec: 0.1, durationSec: 0.5 }],
      ["cut-tail", [mp4], { tailSec: 0.6 }],
      ["fade", [mp4], { fadeIn: 0.15, fadeOut: 0.15 }],
      ["loop", [mp4], { loops: 2 }],
      ["segment", [mp4], { segmentSec: 1 }],
      ["split-parts", [mp4], { parts: 2 }],
      ["gif", [mp4], { gifFps: 8, gifWidth: 160 }],
      ["webp", [mp4], { webpFps: 8, webpWidth: 160 }],
      ["thumb", [mp4], { atSec: 0.2 }],
      ["frames", [mp4], { everySec: 0.5 }],
      ["volume-keep", [mp4], { volumePct: 80 }],
      ["strip-meta", [mp4], {}],
      ["overlay-text", [mp4], { text: "ok", textPos: "br", fontSize: 18 }],
      ["burn-subs", [mp4], {}],
      ["concat", [mp4, mp4b], {}],
      ["replace-audio", [mp4, path.join(outDir, "placeholder")], {}],
      ["slideshow", [png, png2], { holdSec: 0.4, slideSize: "640x360" }],
    ];

    // extract first so we have audio for replace/waveform
    results.extract = await runOp("extract-audio", [mp4], outDir, { format: "mp3" });
    const mp3 = path.join(outDir, results.extract.artifacts[0].name);
    if (!fs.existsSync(mp3)) throw new Error("mp3 missing");

    results.waveform = await runOp("waveform", [mp3], outDir, { waveSize: "640x360" });
    results.audioConvert = await runOp("audio-convert", [mp3], outDir, { format: "wav" });
    results.replace = await runOp("replace-audio", [mp4, mp3], outDir);
    results.slideshow = await runOp("slideshow", [png, png2], outDir, { holdSec: 0.4, slideSize: "640x360" });

    for (const [op, paths, extra] of batch) {
      if (["extract-audio", "replace-audio", "slideshow"].includes(op)) continue;
      if (!opIds.has(op)) throw new Error(`missing catalog op ${op}`);
      results[op] = await runOp(op, paths, outDir, extra);
    }

    const summary = {
      ok: true,
      version: healthy.json.version,
      ops: ops.json.ops.length,
      jobs: Object.keys(results).length,
      sample: Object.fromEntries(
        Object.entries(results)
          .slice(0, 8)
          .map(([k, j]) => [k, j.status])
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
