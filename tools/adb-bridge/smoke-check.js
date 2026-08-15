#!/usr/bin/env node
"use strict";

const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const PORT = 17991;
const TOKEN = "devtools-adb";
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

async function main() {
  const child = spawn(process.execPath, [path.join(__dirname, "server.js")], {
    env: {
      ...process.env,
      ADB_BRIDGE_PORT: String(PORT),
      ADB_BRIDGE_TOKEN: TOKEN,
      ADB_BRIDGE_ORIGINS: "http://127.0.0.1:8080,https://afra55.github.io",
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

    const denied = await req("GET", "/devices");
    if (denied.status !== 401) throw new Error(`expected 401 without token, got ${denied.status}`);

    const devices = await req("GET", "/devices", { headers: { "X-Adb-Token": TOKEN } });
    if (![200, 503].includes(devices.status)) {
      throw new Error(`devices unexpected status ${devices.status}: ${devices.text}`);
    }
    if (devices.status === 200 && !Array.isArray(devices.json.devices)) {
      throw new Error("devices payload invalid");
    }

    const badPath = await req("GET", "/fs/list?serial=demo&path=/data/data", {
      headers: { "X-Adb-Token": TOKEN },
    });
    if (badPath.status === 200) throw new Error("expected path guard to reject /data/data");

    const health2 = await req("GET", "/health");
    const features = health2.json?.features || [];
    for (const need of [
      "jobs",
      "job-cancel",
      "logcat",
      "input",
      "clipboard",
      "snapshot",
      "device-control",
      "apk-info",
      "apk-signing",
      "proxy",
      "forward",
      "developer",
      "screencap",
      "install-push-system",
    ]) {
      if (!features.includes(need)) throw new Error(`health missing feature: ${need}`);
    }

    if (health2.json?.version !== "0.6.1") {
      throw new Error(`expected bridge version 0.6.1, got ${health2.json?.version}`);
    }
    const roots = health2.json?.roots || [];
    for (const root of ["/data/local/tmp", "/system/app", "/system/priv-app"]) {
      if (!roots.includes(root)) throw new Error(`health missing root: ${root}`);
    }

    const sysList = await req("GET", "/fs/list?serial=demo&path=/system/app", {
      headers: { "X-Adb-Token": TOKEN },
    });
    // Path is allowed; may fail on missing adb/device with 400, but must not be "仅允许访问" reject
    if (sysList.status === 200) throw new Error("unexpected success without device");
    if (String(sysList.json?.error || "").includes("仅允许访问")) {
      throw new Error("system/app should be in readable ROOTS");
    }

    const writeDenied = await req("POST", "/fs/mkdir", {
      headers: { "X-Adb-Token": TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: "demo", path: "/system/app/Evil" }),
    });
    if (writeDenied.status === 200) throw new Error("mkdir under /system/app should require forcePush");
    if (!String(writeDenied.json?.error || "").includes("写入仅允许")) {
      throw new Error(`expected write guard for /system/app, got: ${writeDenied.text}`);
    }

    const jobs = await req("GET", "/jobs", { headers: { "X-Adb-Token": TOKEN } });
    if (jobs.status !== 200 || !Array.isArray(jobs.json?.jobs)) {
      throw new Error("jobs endpoint failed");
    }

    const cancel404 = await req("POST", "/jobs/deadbeef/cancel", {
      headers: { "X-Adb-Token": TOKEN, "Content-Type": "application/json" },
      body: "{}",
    });
    if (cancel404.status === 200) throw new Error("cancel unknown job should fail");

    const badInput = await req("POST", "/input", {
      headers: { "X-Adb-Token": TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: "demo", action: "nope" }),
    });
    if (badInput.status === 200) throw new Error("input should reject unknown action");

    // APK signing: upload sample jarsigner APK and expect alias/SHA1
    const sampleApk = "/tmp/adb-apk-sign-test/sample.apk";
    const fs = require("fs");
    if (fs.existsSync(sampleApk)) {
      const buf = fs.readFileSync(sampleApk);
      const up = await req("POST", "/upload?name=sample.apk", {
        headers: {
          "X-Adb-Token": TOKEN,
          "Content-Type": "application/octet-stream",
          "X-Filename": encodeURIComponent("sample.apk"),
          "Content-Length": Buffer.byteLength(buf),
        },
        body: buf,
      });
      if (up.status !== 200 || !up.json?.uploadId) {
        throw new Error(`upload sample apk failed: ${up.text}`);
      }
      const info = await req("POST", "/apk/info", {
        headers: { "X-Adb-Token": TOKEN, "Content-Type": "application/json" },
        body: JSON.stringify({ uploadId: up.json.uploadId }),
      });
      if (info.status !== 200) throw new Error(`apk/info failed: ${info.text}`);
      const signers = info.json?.signatures || info.json?.signing?.signers || [];
      if (!signers.length) throw new Error("apk/info missing signatures");
      const s0 = signers[0];
      const alias = String(s0.alias || s0.v1Entry || "");
      if (!/mad/i.test(alias)) throw new Error(`expected alias mad, got ${alias}`);
      if (!s0.sha1 || s0.sha1.length < 10) throw new Error("missing sha1");
      if (!/Mad Test/i.test(String(s0.cn || s0.owner || ""))) {
        throw new Error(`expected CN Mad Test, got ${s0.cn || s0.owner}`);
      }
    }

    console.log("adb-bridge smoke-check: ok");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error("adb-bridge smoke-check: fail");
  console.error(err);
  process.exit(1);
});
