#!/usr/bin/env node
"use strict";

/**
 * 启动前释放被旧 DevTools 本机桥占用的端口（跨平台，零依赖）。
 * 用法：node port-guard.js [port]
 */
const http = require("http");
const net = require("net");
const { execFileSync } = require("child_process");

const port = Number(process.argv[2] || process.env.ADB_BRIDGE_PORT || process.env.DEVTOOLS_BRIDGE_PORT || 17888);

function portBusy(p) {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once("error", (e) => resolve(e && e.code === "EADDRINUSE"));
    srv.once("listening", () => srv.close(() => resolve(false)));
    srv.listen(p, "127.0.0.1");
  });
}

function healthCheck(p) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${p}/health`, { timeout: 2500 }, (res) => {
      let body = "";
      res.on("data", (c) => {
        body += c;
      });
      res.on("end", () => {
        try {
          const j = JSON.parse(body);
          resolve(j && j.service === "devtools-bridge" ? j : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}

function killPortListeners(p) {
  const plat = process.platform;
  try {
    if (plat === "win32") {
      const out = execFileSync("netstat", ["-ano"], { encoding: "utf8", windowsHide: true });
      const pids = new Set();
      for (const line of out.split("\n")) {
        if (!/LISTENING/i.test(line)) continue;
        if (!new RegExp(`:${p}\\s`).test(line)) continue;
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (/^\d+$/.test(pid)) pids.add(pid);
      }
      for (const pid of pids) {
        try {
          execFileSync("taskkill", ["/PID", pid, "/F"], { stdio: "ignore", windowsHide: true });
          console.log(`已结束占用端口 ${p} 的进程 PID ${pid}`);
        } catch {
          /* ignore */
        }
      }
      return pids.size > 0;
    }
    const out = execFileSync("lsof", ["-ti", `tcp:${p}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim();
    if (!out) return false;
    for (const pid of out.split("\n").filter(Boolean)) {
      try {
        process.kill(Number(pid), "SIGTERM");
        console.log(`已结束占用端口 ${p} 的旧本机桥 PID ${pid}`);
      } catch {
        /* ignore */
      }
    }
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    console.error("无效端口号:", port);
    process.exit(1);
  }
  const busy = await portBusy(port);
  if (!busy) {
    process.exit(0);
  }
  const health = await healthCheck(port);
  if (health) {
    console.log(
      `端口 ${port} 上检测到旧的 DevTools 本机桥（v${health.version || "?"}），正在结束以便启动新实例…`
    );
    killPortListeners(port);
    await new Promise((r) => setTimeout(r, 900));
    if (await portBusy(port)) {
      console.warn(`端口 ${port} 仍被占用，新桥将尝试 ${port + 1} 等备用端口；请在网页同步修改桥地址。`);
    }
    process.exit(0);
  }
  console.error("");
  console.error(`错误：端口 ${port} 已被其他程序占用（不是 DevTools 本机桥）。`);
  console.error("请关闭占用该端口的程序，或设置环境变量 ADB_BRIDGE_PORT 使用其他端口。");
  console.error("");
  process.exit(1);
}

main().catch((err) => {
  console.error(err && err.message ? err.message : err);
  process.exit(1);
});
