#!/usr/bin/env node
"use strict";
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..");
const assert = (c, m) => {
  if (!c) throw new Error(m);
};

execSync("node --check tools/ffmpeg-bridge/ytdlp-core.js", { cwd: ROOT, stdio: "inherit" });
execSync("node --check tools/ytdlp.js", { cwd: ROOT, stdio: "inherit" });
execSync("node --check tools/ffmpeg-bridge/server.js", { cwd: ROOT, stdio: "inherit" });
execSync("node --check tools/adb-bridge/server.js", { cwd: ROOT, stdio: "inherit" });

const shell = fs.readFileSync(path.join(ROOT, "tools/index.html"), "utf8");
const panel = fs.readFileSync(path.join(ROOT, "tools/panels/ytdlp.html"), "utf8");
const app = fs.readFileSync(path.join(ROOT, "tools/app.js"), "utf8");
const lazy = fs.readFileSync(path.join(ROOT, "tools/lib/lazy-scripts.js"), "utf8");
const adb = fs.readFileSync(path.join(ROOT, "tools/adb-bridge/server.js"), "utf8");
const extra = fs.readFileSync(path.join(ROOT, "tools/extra.js"), "utf8");

assert(shell.includes('id="workspace-panels"'), "shell missing");
assert(panel.includes('id="ytdlp"'), "panel");
assert(panel.includes('id="yd-download"'), "download btn");
assert(app.includes('"ytdlp"'), "TOOL_GROUPS");
assert(lazy.includes('ytdlp: "./ytdlp.js"'), "lazy");
assert(adb.includes("/ytdlp"), "adb mount");
assert(extra.includes("ffmpeg-bridge/ytdlp-core.js"), "zip ytdlp-core");

const createYtdlp = require("./ffmpeg-bridge/ytdlp-core");
const stub = {
  whichSync: () => "/usr/bin/yt-dlp",
  execFileAsync: async () => ({ stdout: "2024.01.01\n", stderr: "" }),
  resolveLocalPath: async (p) => p,
  ensureWritableDir: async (p) => p,
  mkdirpAllowed: async (p) => p,
  revealLocalPath: async (p) => ({ path: p, isDir: true }),
  localFsRoots: () => [{ path: "/tmp", name: "tmp" }],
  sendJson: () => {},
  readBody: async () => Buffer.from("{}"),
  parseJsonBody: () => ({}),
  checkBinary: async () => ({ ok: true }),
};
const api = createYtdlp(stub);
const args = api.buildDownloadArgs(
  { mode: "audio", audioFormat: "mp3", writeSubs: true, cookiesFromBrowser: "chrome", downloadArchive: true },
  ["https://www.youtube.com/watch?v=dQw4w9WgXcQ"],
  "/tmp/out"
);
assert(args.includes("-x"), "audio extract");
assert(args.includes("--audio-format"), "audio format");
assert(args.includes("--write-subs"), "subs");
assert(args.includes("--cookies-from-browser"), "cookies");
assert(args.includes("--download-archive"), "archive");
assert(args.includes("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "url");
let threw = false;
try {
  api.buildDownloadArgs({ extra: "; rm -rf /" }, ["https://example.com"], "/tmp");
} catch {
  /* extra ignored */
}
try {
  api.assertUrl("file:///etc/passwd");
} catch (e) {
  threw = true;
}
assert(threw, "reject file url");
console.log("ytdlp-smoke ok");
