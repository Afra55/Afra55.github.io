#!/usr/bin/env node
"use strict";

const http = require("http");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const PORT = 17991;
const TOKEN = "devtools-bridge";
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

async function main() {
  const mirrorSrc = fs.readFileSync(path.join(__dirname, "scrcpy-mirror.js"), "utf8");
  if (/waitForLocalListen/.test(mirrorSrc)) {
    throw new Error("scrcpy-mirror.js must not probe-connect adb forward before device listen");
  }
  if (!/转发已失效，正在重建 adb forward/.test(mirrorSrc)) {
    throw new Error("scrcpy-mirror.js should rebuild forward on ECONNREFUSED");
  }
  if (!/INFO:\\s\*Device:/.test(mirrorSrc)) {
    throw new Error("scrcpy-mirror.js should wait for Device banner before handshake connect");
  }
  if (!EXPECTED_BRIDGE_VERSION) {
    throw new Error("BRIDGE_VERSION missing in server.js");
  }

  const resolveSrc = fs.readFileSync(path.join(__dirname, "resolve-port.js"), "utf8");
  if (!/保持现有桥|结束旧桥/.test(resolveSrc)) {
    throw new Error("resolve-port.js should prompt keep/restart when our bridge is running");
  }
  if (!/isQuietMode|DEVTOOLS_BRIDGE_QUIET/.test(resolveSrc)) {
    throw new Error("resolve-port.js should support quiet mode for protocol launches");
  }
  const mirrorJs = fs.readFileSync(path.join(__dirname, "scrcpy-mirror.js"), "utf8");
  if (!/(max_fps|maxFps|QUALITY_PRESETS)/.test(mirrorJs) || !/(video_bit_rate|videoBitRate|2500000)/.test(mirrorJs + require("fs").readFileSync(require("path").join(__dirname, "scrcpy-ctrl.js"), "utf8"))) {
    throw new Error("scrcpy-mirror.js should use browser-friendly fps/bitrate presets");
  }
  if (!/lastKeyFrame/.test(mirrorJs)) {
    throw new Error("scrcpy-mirror.js should cache/replay lastKeyFrame for late WS clients");
  }
  if (!/pendingConfig|packet_merger|wrapMirrorPacket/.test(mirrorJs)) {
    throw new Error("scrcpy-mirror.js should merge codec config into following media packets");
  }
  if (!/isAvcDecoderConfig|shouldMergeConfigIntoMedia/.test(mirrorJs)) {
    throw new Error("scrcpy-mirror.js should skip merging avcC into keyframes (WebCodecs black screen)");
  }
  if (!/control=true|CTRL_RESET_VIDEO|injectTouch|encodeKeycode|TYPE_SET_CLIPBOARD/.test(mirrorJs + require("fs").readFileSync(require("path").join(__dirname, "scrcpy-ctrl.js"), "utf8"))) {
    throw new Error("scrcpy-mirror should expose full control surface (touch/key/clipboard/…)");
  }
  if (!/scrcpy-ctrl/.test(mirrorJs)) {
    throw new Error("scrcpy-mirror.js should require scrcpy-ctrl.js");
  }
  if (!/连接 scrcpy 控制通道|控制通道连接失败/.test(mirrorJs)) {
    throw new Error("scrcpy-mirror.js should connect control socket after video dummy byte");
  }
  if (!/QUALITY_PRESETS|resolveQuality|quality=/.test(mirrorJs)) {
    throw new Error("scrcpy-mirror.js should support quality presets");
  }
  if (!/audio=true|pumpAudio|AUDIO_FLAG/.test(mirrorJs)) {
    throw new Error("scrcpy-mirror.js should support optional audio forwarding");
  }
  if (!/show_touches=true/.test(mirrorJs)) {
    throw new Error("scrcpy-mirror.js should support show_touches");
  }
  if (/video_codec_options=i-frame-interval=1/.test(mirrorJs) && !/不要默认传 video_codec_options|启用 control|控制通道/.test(mirrorJs)) {
    throw new Error("scrcpy-mirror.js must not force i-frame-interval=1 (breaks some OEM encoders)");
  }
  if (!/i-frame-interval=5/.test(mirrorJs)) {
    throw new Error("scrcpy-mirror.js should allow soft i-frame-interval=5 on last retry");
  }
  if (!/无控制通道降级/.test(mirrorJs)) {
    throw new Error("scrcpy-mirror.js should fall back to control=false if control channel fails");
  }
  if (!/降低分辨率重试|最小参数重试/.test(mirrorJs)) {
    throw new Error("scrcpy-mirror.js should retry handshake with softer encoder profiles");
  }
  if (!/action === "touch"/.test(fs.readFileSync(path.join(__dirname, "server.js"), "utf8"))) {
    throw new Error("server.js should support input touch/motionevent");
  }

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

    if (health2.json?.version !== EXPECTED_BRIDGE_VERSION) {
      throw new Error(`expected bridge version ${EXPECTED_BRIDGE_VERSION}, got ${health2.json?.version}`);
    }
    if (Number(health2.json?.port) !== PORT) {
      throw new Error(`health.port should match listen port ${PORT}, got ${health2.json?.port}`);
    }
    if (!features.includes("local-pull")) throw new Error("health missing feature: local-pull");
    for (const need of ["fs-zip", "app-backup-splits", "logcat-level", "mirror", "scrcpy-mirror", "unified-bridge", "ffmpeg-mount", "git-mount", "device-perf", "device-processes", "device-shell", "device-layout"]) {
      if (!features.includes(need)) throw new Error(`health missing feature: ${need}`);
    }
    if (!health2.json?.unified) throw new Error("expected unified bridge flag");
    if (health2.json?.ffmpegMount !== "/ff") throw new Error("expected ffmpegMount /ff");
    if (health2.json?.gitMount !== "/git") throw new Error("expected gitMount /git");
    if (!health2.json?.capabilities?.git) throw new Error("expected capabilities.git");
    if (health2.json?.capabilities?.everything || health2.json?.everythingMount) {
      throw new Error("everything capability/mount should be removed");
    }

    const child2 = spawn(process.execPath, [path.join(__dirname, "server.js")], {
      env: {
        ...process.env,
        ADB_BRIDGE_PORT: String(PORT),
        ADB_BRIDGE_TOKEN: TOKEN,
        ADB_BRIDGE_ORIGINS: "http://127.0.0.1:8080,https://afra55.github.io",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let boot2 = "";
    child2.stdout.on("data", (d) => {
      boot2 += d.toString("utf8");
    });
    child2.stderr.on("data", (d) => {
      boot2 += d.toString("utf8");
    });
    const code2 = await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          child2.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        resolve(-1);
      }, 8000);
      child2.on("exit", (code) => {
        clearTimeout(timer);
        resolve(code == null ? 0 : code);
      });
    });
    if (code2 !== 0) {
      throw new Error(`second instance should exit 0 when port busy, got ${code2}: ${boot2}`);
    }
    if (!/不重复启动|已在端口/.test(boot2)) {
      throw new Error(`second instance should refuse to start another bridge: ${boot2}`);
    }

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

    const evGone = await req("GET", "/everything/health", {
      headers: { "X-Adb-Token": TOKEN },
    });
    if (evGone.status !== 404) {
      throw new Error(`expected /everything removed (404), got ${evGone.status}`);
    }

    // Token compat
    const ops = await req("GET", "/ff/ops", { headers: { "X-Adb-Token": "devtools-bridge" } });
    if (ops.status !== 200 || !ops.json?.ok) throw new Error("ff/ops with unified token failed");
    void ffHealth;

    const gitHealth = await req("GET", "/git/health", { headers: { "X-Adb-Token": TOKEN } });
    if (gitHealth.status !== 200 || !gitHealth.json?.ok) {
      throw new Error("git/health failed: " + JSON.stringify(gitHealth.json));
    }
    if (!gitHealth.json?.git) throw new Error("git binary missing in /git/health");
    const gitOps = await req("GET", "/git/repo/ops", { headers: { "X-Adb-Token": TOKEN } });
    if (gitOps.status !== 200 || !(gitOps.json?.ops || []).length) {
      throw new Error("git/repo/ops failed");
    }

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

    // device-inspect parsers (no device required)
    const di = require("./device-inspect");
    const cpus = di.parseProcStat(
      "cpu  1 2 3 4 5 6 7\ncpu0 10 0 5 100 0 0 0\ncpu1 20 0 10 200 0 0 0\n"
    );
    if (cpus.length !== 2) throw new Error(`parseProcStat expected 2 cpus, got ${cpus.length}`);
    const load = di.cpuLoadBetween(
      { times: { user: 10, nice: 0, sys: 5, idle: 100, iowait: 0, irq: 0, softirq: 0 } },
      { times: { user: 20, nice: 0, sys: 10, idle: 110, iowait: 0, irq: 0, softirq: 0 } }
    );
    if (!(load > 0.4 && load < 0.8)) throw new Error(`cpuLoadBetween unexpected ${load}`);
    const mem = di.parseMeminfo("MemTotal: 1000 kB\nMemAvailable: 400 kB\nMemFree: 200 kB\n");
    if (mem.totalKb !== 1000 || mem.usedKb !== 600) throw new Error("parseMeminfo failed");
    const procs = di.parsePs("USER PID PPID VSZ RSS WCHAN ADDR S NAME\nu0_a1 123 1 100 50 0 0 S com.example.app\n");
    if (!procs.some((p) => p.pid === 123 && /com\.example\.app/.test(p.name))) {
      throw new Error(`parsePs failed: ${JSON.stringify(procs)}`);
    }
    const nodes = di.parseUiAutomatorXml(
      '<?xml version="1.0"?><hierarchy><node class="android.widget.TextView" text="Hi" bounds="[0,0][10,20]" resource-id="a:id/b" clickable="true" /></hierarchy>'
    );
    if (nodes.length !== 1 || nodes[0].text !== "Hi" || nodes[0].rect?.w !== 10) {
      throw new Error(`parseUiAutomatorXml failed: ${JSON.stringify(nodes)}`);
    }

    const badKill = await req("POST", "/device/process/kill", {
      headers: { "X-Adb-Token": TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    if (badKill.status === 200) throw new Error("process/kill should reject missing serial");

    const badShell = await req("POST", "/shell/exec", {
      headers: { "X-Adb-Token": TOKEN, "Content-Type": "application/json" },
      body: JSON.stringify({ serial: "", command: "echo hi" }),
    });
    if (badShell.status === 200) throw new Error("shell/exec should reject missing serial");

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
