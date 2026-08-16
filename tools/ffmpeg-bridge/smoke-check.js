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

async function waitJob(id, timeoutMs = 60000) {
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

    const denied = await req("GET", "/local/roots");
    if (denied.status !== 401) throw new Error(`expected 401 without token, got ${denied.status}`);

    const roots = await req("GET", "/local/roots", { headers: { "X-Ffmpeg-Token": TOKEN } });
    if (!roots.json?.ok || !roots.json.roots?.length) throw new Error("roots failed");

    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ff-smoke-"));
    const mp4 = path.join(tmp, "in.mp4");
    const outDir = path.join(tmp, "out");
    fs.mkdirSync(outDir);
    await new Promise((resolve, reject) => {
      const ff = spawn(
        "ffmpeg",
        ["-y", "-f", "lavfi", "-i", "testsrc=size=320x240:rate=10:duration=1", "-f", "lavfi", "-i", "sine=f=440:d=1", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", mp4],
        { stdio: "ignore" }
      );
      ff.on("error", reject);
      ff.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg make sample exit ${code}`))));
    });

    const start = await req("POST", "/jobs/extract-audio", {
      headers: { "X-Ffmpeg-Token": TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ paths: [mp4], outDir, format: "mp3", overwrite: true }),
    });
    if (!start.json?.ok || !start.json.job?.id) throw new Error(`extract start failed: ${start.text}`);
    const job = await waitJob(start.json.job.id);
    if (job.status !== "done") throw new Error(`extract job failed: ${JSON.stringify(job)}`);
    if (!job.artifacts?.length) throw new Error("no artifacts");
    const art = path.join(outDir, job.artifacts[0].name);
    if (!fs.existsSync(art)) throw new Error(`artifact missing: ${art}`);

    console.log(
      JSON.stringify(
        {
          ok: true,
          version: healthy.json.version,
          features: healthy.json.features,
          extract: { status: job.status, artifacts: job.artifacts.length },
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
