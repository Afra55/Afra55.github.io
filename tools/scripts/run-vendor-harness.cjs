#!/usr/bin/env node
/** Headless Chrome + CDP：打开 harness，读 #out / title */
"use strict";

const { spawn } = require("child_process");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const net = require("net");

const CHROME =
  process.env.CHROME_PATH ||
  (process.platform === "win32"
    ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
    : "google-chrome");
const PAGE = process.argv[2] || "http://127.0.0.1:8080/tools/scripts/harness-vendor-import.html";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        let b = "";
        res.on("data", (c) => (b += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(b));
          } catch (e) {
            reject(e);
          }
        });
      })
      .on("error", reject);
  });
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
    s.on("error", reject);
  });
}

function cdpCall(wsUrl, method, params = {}) {
  return new Promise((resolve, reject) => {
    const WebSocket = (() => {
      try {
        return require("ws");
      } catch (_) {
        return null;
      }
    })();
    if (!WebSocket) {
      reject(new Error("no ws module"));
      return;
    }
    const ws = new WebSocket(wsUrl);
    const id = 1;
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch (_) {}
      reject(new Error("cdp timeout " + method));
    }, 20000);
    ws.on("open", () => {
      ws.send(JSON.stringify({ id, method, params }));
    });
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(String(data));
        if (msg.id === id) {
          clearTimeout(timer);
          ws.close();
          if (msg.error) reject(new Error(JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      } catch (e) {
        clearTimeout(timer);
        reject(e);
      }
    });
    ws.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

async function main() {
  const port = await freePort();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "dt-harness-"));
  const chrome = spawn(
    CHROME,
    [
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--headless=new",
      "--disable-gpu",
      "--no-first-run",
      "--disable-extensions",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );

  try {
    let page;
    for (let i = 0; i < 40; i++) {
      await sleep(250);
      try {
        const tabs = await getJson(`http://127.0.0.1:${port}/json`);
        page = (tabs || []).find((t) => t.type === "page" && t.webSocketDebuggerUrl);
        if (page) break;
      } catch (_) {}
    }
    if (!page) throw new Error("no chrome page target");

    // 无 ws 包时退回 title 轮询：先 navigate via /json/new
    let hasWs = false;
    try {
      require.resolve("ws");
      hasWs = true;
    } catch (_) {}

    if (!hasWs) {
      // 用 /json/new?url= 打开页面
      await getJson(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(PAGE)}`).catch(() => null);
      let title = "";
      for (let i = 0; i < 40; i++) {
        await sleep(500);
        const tabs = await getJson(`http://127.0.0.1:${port}/json`);
        const p = (tabs || []).find((t) => /harness-vendor/.test(t.url || "")) || tabs?.[0];
        title = p?.title || "";
        if (/vendor-import-(PASS|FAIL)/.test(title)) break;
      }
      console.log("title=" + title);
      if (/PASS/.test(title)) {
        console.log("harness: PASS");
        process.exitCode = 0;
      } else {
        console.error("harness: FAIL (" + title + ")");
        process.exitCode = 1;
      }
      return;
    }

    await cdpCall(page.webSocketDebuggerUrl, "Page.enable");
    await cdpCall(page.webSocketDebuggerUrl, "Runtime.enable");
    await cdpCall(page.webSocketDebuggerUrl, "Page.navigate", { url: PAGE });
    await sleep(1500);

    let text = "";
    for (let i = 0; i < 40; i++) {
      const ev = await cdpCall(page.webSocketDebuggerUrl, "Runtime.evaluate", {
        expression:
          "({title: document.title, out: (document.getElementById('out')||{}).textContent||'', log: window.__harnessLog||''})",
        returnByValue: true,
      });
      const v = ev?.result?.value || {};
      text = v.out || v.log || v.title || "";
      if (/RESULT=(PASS|FAIL)/.test(text) || /vendor-import-(PASS|FAIL)/.test(v.title || "")) {
        console.log(text || v.title);
        process.exitCode = /PASS/.test(text || v.title || "") ? 0 : 1;
        return;
      }
      await sleep(400);
    }
    console.error("harness timeout\n" + text);
    process.exitCode = 1;
  } finally {
    try {
      chrome.kill();
    } catch (_) {}
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
