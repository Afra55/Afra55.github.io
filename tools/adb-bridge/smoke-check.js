#!/usr/bin/env node
"use strict";

const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

const PORT = 17991;
const TOKEN = "devtools-bridge";
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

    // /data/data is browsable (virtual package list when no root) — must not be path-guard rejected
    const dataData = await req("GET", "/fs/list?serial=demo&path=/data/data", {
      headers: { "X-Adb-Token": TOKEN },
    });
    if (String(dataData.json?.error || "").includes("仅允许访问")) {
      throw new Error("/data/data should be browsable (virtual or device-permission)");
    }

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
      "fs-roots",
      "fs-run-as",
      "fs-data-virtual",
      "host-tools",
    ]) {
      if (!features.includes(need)) throw new Error(`health missing feature: ${need}`);
    }

    if (health2.json?.version !== "0.8.2") {
      throw new Error(`expected bridge version 0.8.2, got ${health2.json?.version}`);
    }
    if (!features.includes("local-pull")) throw new Error("health missing feature: local-pull");
    for (const need of ["fs-zip", "app-backup-splits", "logcat-level", "mirror", "scrcpy-mirror", "unified-bridge", "ffmpeg-mount"]) {
      if (!features.includes(need)) throw new Error(`health missing feature: ${need}`);
    }
    if (!health2.json?.unified) throw new Error("expected unified bridge flag");
    if (health2.json?.ffmpegMount !== "/ff") throw new Error("expected ffmpegMount /ff");

    const ffHealth = await req("GET", "/ff/health", { headers: { "X-Adb-Token": TOKEN } });
    // /ff/health should work without token actually - test without
    const ffHealthOpen = await req("GET", "/ff/health");
    if (ffHealthOpen.status !== 200 || !ffHealthOpen.json?.ok) {
      throw new Error(`ff/health failed: ${ffHealthOpen.status}`);
    }

    const mirrorStatus = await req("GET", "/mirror/status", { headers: { "X-Adb-Token": TOKEN } });
    if (mirrorStatus.status !== 200 || !mirrorStatus.json?.ok) {
      throw new Error(`mirror/status failed: ${mirrorStatus.status}`);
    }
    if (mirrorStatus.json?.version !== "3.1") {
      throw new Error(`expected scrcpy server pin 3.1, got ${mirrorStatus.json?.version}`);
    }
    const prepared = await req("POST", "/mirror/prepare", {
      headers: { "X-Adb-Token": TOKEN, "Content-Type": "application/json" },
      body: "{}",
    });
    if (prepared.status !== 200 || !prepared.json?.ok) {
      throw new Error(`mirror/prepare failed: ${prepared.text || prepared.status}`);
    }
    if (!prepared.json?.jar?.vendor && !prepared.json?.jar?.cached) {
      throw new Error("mirror prepare did not locate scrcpy-server jar");
    }

    // Token compat
    const ops = await req("GET", "/ff/ops", { headers: { "X-Adb-Token": "devtools-bridge" } });
    if (ops.status !== 200 || !ops.json?.ok) throw new Error("ff/ops with unified token failed");
    void ffHealth;

    // Path alias expansion (mirrors server expandFsPathCandidates)
    const expand = (input) => {
      let p = String(input || "").trim().replace(/\\/g, "/");
      if (!p.startsWith("/")) p = `/${p}`;
      const parts = [];
      for (const seg of p.split("/")) {
        if (!seg || seg === ".") continue;
        if (seg === "..") {
          parts.pop();
          continue;
        }
        parts.push(seg);
      }
      const dir = parts.length ? `/${parts.join("/")}` : "/";
      const out = [];
      const push = (x) => {
        if (!out.includes(x)) out.push(x);
      };
      push(dir);
      const rewrite = (fromPrefix, toPrefix) => {
        if (dir === fromPrefix) push(toPrefix);
        else if (dir.startsWith(`${fromPrefix}/`)) push(`${toPrefix}${dir.slice(fromPrefix.length)}`);
      };
      rewrite("/sdcard", "/storage/emulated/0");
      rewrite("/storage/emulated/0", "/sdcard");
      return out;
    };
    const sd = expand("/sdcard");
    if (!sd.includes("/storage/emulated/0") || !sd.includes("/sdcard")) {
      throw new Error(`sdcard alias expand failed: ${JSON.stringify(sd)}`);
    }
    const dl = expand("/sdcard/Download");
    if (!dl.includes("/storage/emulated/0/Download")) {
      throw new Error(`Download alias expand failed: ${JSON.stringify(dl)}`);
    }
    if (!health2.json?.tools || typeof health2.json.tools.keytool !== "object") {
      throw new Error("health should expose tools.keytool probe");
    }
    if (!features.includes("fs-preview")) throw new Error("health missing feature: fs-preview");
    if (!features.includes("host-tools-probe")) throw new Error("health missing feature: host-tools-probe");
    if (!features.includes("app-labels-aapt")) throw new Error("health missing feature: app-labels-aapt");

    // Label parser smoke (mirrors server parseLabelFromBadging / dumpsys rules)
    const badging = [
      "application-label-zh-CN:'微信'",
      "application-label:'WeChat'",
      "application: label='Demo' icon='res/xxx.png'",
    ].join("\n");
    const zh =
      (badging.match(/application-label-zh-CN:'([^']*)'/) ||
        badging.match(/application-label:'([^']*)'/) ||
        badging.match(/application:\s*label='([^']*)'/) ||
        [])[1] || "";
    if (zh !== "微信") throw new Error(`badging label parse failed: ${zh}`);
    const dump = `
Package [com.demo.app] (abc):
    applicationLabel=演示应用
Package [com.other] (def):
    nonLocalizedLabel=null
`;
    const dumpLabels = new Map();
    let cur = "";
    for (const line of dump.split(/\r?\n/)) {
      const pkg = line.match(/^\s*Package\s+\[([^\]]+)\]/);
      if (pkg) {
        cur = pkg[1].trim();
        continue;
      }
      const raw =
        (line.match(/applicationLabel=(.+)$/) || line.match(/nonLocalizedLabel=(.+)$/) || [])[1];
      if (!cur || !raw) continue;
      const cleaned = String(raw).trim();
      if (!cleaned || /^null$/i.test(cleaned)) continue;
      if (!dumpLabels.has(cur)) dumpLabels.set(cur, cleaned);
    }
    if (dumpLabels.get("com.demo.app") !== "演示应用") {
      throw new Error("dumpsys label parse failed");
    }
    if (dumpLabels.has("com.other")) throw new Error("dumpsys should ignore null nonLocalizedLabel");

    if (!health2.json?.tools || typeof health2.json.tools !== "object") {
      throw new Error("health missing tools probe");
    }
    if (!health2.json?.setup || typeof health2.json.setup !== "object") {
      throw new Error("health missing setup hints");
    }
    const roots = health2.json?.roots || [];
    for (const root of ["/", "/data/local/tmp", "/data/data", "/system/app", "/system/priv-app"]) {
      if (!roots.includes(root)) throw new Error(`health missing root: ${root}`);
    }

    const sysList = await req("GET", "/fs/list?serial=demo&path=/system/app", {
      headers: { "X-Adb-Token": TOKEN },
    });
    // Path is allowed; may fail on missing adb/device with 400, but must not be "仅允许访问" reject
    if (sysList.status === 200) throw new Error("unexpected success without device");
    if (String(sysList.json?.error || "").includes("仅允许访问")) {
      throw new Error("system/app should be browsable (Device Explorer mode)");
    }

    const rootList = await req("GET", "/fs/list?serial=demo&path=/", {
      headers: { "X-Adb-Token": TOKEN },
    });
    if (String(rootList.json?.error || "").includes("仅允许访问")) {
      throw new Error("root / should be browsable");
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
