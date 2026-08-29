#!/usr/bin/env node
"use strict";

/**
 * 启动前检查默认桥端口；若被占用则询问：结束占用进程 / 换端口 / 取消。
 * 输出最终端口号到 stdout（最后一行），供 start-*.bat/sh 读取。
 */

const net = require("net");
const readline = require("readline");
const { execSync } = require("child_process");

const PORT_MIN = 17888;
const PORT_MAX = 17899;
const DEFAULT_PORT = Number(process.env.ADB_BRIDGE_PORT || process.env.DEVTOOLS_BRIDGE_PORT || PORT_MIN);

function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (err) => resolve(err && err.code === "EADDRINUSE"));
    server.once("listening", () => server.close(() => resolve(false)));
    server.listen(port, "127.0.0.1");
  });
}

function getListenerPids(port) {
  const pids = new Set();
  if (process.platform === "win32") {
    try {
      const out = execSync("netstat -ano -p tcp", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      for (const line of out.split(/\r?\n/)) {
        if (!/LISTENING/i.test(line)) continue;
        const parts = line.trim().split(/\s+/);
        if (parts.length < 5) continue;
        const local = parts[1] || "";
        const pid = Number(parts[parts.length - 1]);
        const m = local.match(/:(\d+)$/);
        if (!m || Number(m[1]) !== port || !Number.isFinite(pid) || pid <= 0) continue;
        pids.add(pid);
      }
    } catch (_) {
      /* ignore */
    }
    return [...pids];
  }

  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    out.split(/\r?\n/)
      .map((s) => Number(s.trim()))
      .filter((n) => Number.isFinite(n) && n > 0)
      .forEach((n) => pids.add(n));
  } catch (_) {
    /* ignore */
  }
  return [...pids];
}

function describeListeners(port) {
  const lines = [];
  if (process.platform === "win32") {
    try {
      const out = execSync("netstat -ano -p tcp", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
      for (const line of out.split(/\r?\n/)) {
        if (!/LISTENING/i.test(line)) continue;
        const parts = line.trim().split(/\s+/);
        const local = parts[1] || "";
        const pid = parts[parts.length - 1];
        if (local.endsWith(`:${port}`)) lines.push(`  PID ${pid}  ${local}`);
      }
    } catch (_) {
      /* ignore */
    }
    return lines;
  }

  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN 2>/dev/null`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    for (const line of out.split(/\r?\n/).slice(1)) {
      const t = line.trim();
      if (t) lines.push(`  ${t}`);
    }
  } catch (_) {
    /* ignore */
  }
  return lines;
}

function getBridgeRangePids() {
  const pids = new Set();
  for (let port = PORT_MIN; port <= PORT_MAX; port += 1) {
    getListenerPids(port).forEach((pid) => pids.add(pid));
  }
  return [...pids];
}

async function killPids(pids) {
  const uniq = [...new Set(pids.filter((n) => Number.isFinite(n) && n > 0))];
  if (!uniq.length) return;

  if (process.platform === "win32") {
    for (const pid of uniq) {
      try {
        execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
      } catch (_) {
        /* ignore */
      }
    }
    return;
  }

  for (const pid of uniq) {
    try {
      process.kill(pid, "SIGTERM");
    } catch (_) {
      /* ignore */
    }
  }
  await sleep(400);
  for (const pid of uniq) {
    try {
      process.kill(pid, "SIGKILL");
    } catch (_) {
      /* ignore */
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(String(answer || "").trim());
    });
  });
}

async function findFreePort(prefer) {
  for (let port = prefer; port <= PORT_MAX; port += 1) {
    if (!(await isPortInUse(port))) return port;
  }
  for (let port = PORT_MIN; port < prefer; port += 1) {
    if (!(await isPortInUse(port))) return port;
  }
  return null;
}

async function main() {
  let port = DEFAULT_PORT;
  if (port < PORT_MIN || port > PORT_MAX) {
    console.error(`ADB_BRIDGE_PORT=${port} 超出本机桥范围 ${PORT_MIN}-${PORT_MAX}`);
    process.exit(1);
  }

  if (!(await isPortInUse(port))) {
    process.stdout.write(String(port));
    return;
  }

  const interactive = process.stdin.isTTY && process.stdout.isTTY;
  if (!interactive) {
    const alt = await findFreePort(port + 1);
    if (alt == null) {
      console.error(`端口 ${PORT_MIN}-${PORT_MAX} 均已占用，且当前为非交互环境，无法询问。`);
      process.exit(1);
    }
    console.warn(`[resolve-port] 端口 ${port} 被占用，非交互模式自动改用 ${alt}`);
    process.stdout.write(String(alt));
    return;
  }

  console.error("");
  console.error(`[WARN] 端口 ${port} 已被占用。`);
  console.error("常见原因：上次直接关闭了命令窗口，本机桥进程仍在后台运行。");
  console.error("");
  console.error("当前占用：");
  const desc = describeListeners(port);
  if (desc.length) desc.forEach((line) => console.error(line));
  else console.error("  （未能列出进程详情，但仍检测到端口不可用）");
  console.error("");
  console.error("请选择：");
  console.error("  1) 结束占用进程并启动（将结束 17888–17899 范围内所有监听进程）");
  console.error("  2) 改用其他空闲端口");
  console.error("  3) 取消");
  console.error("");

  const choice = (await ask("请输入 [1/2/3]: ")).toLowerCase();

  if (choice === "1" || choice === "k" || choice === "kill") {
    const pids = getBridgeRangePids();
    if (pids.length) {
      console.error(`正在结束 ${pids.length} 个相关进程: ${pids.join(", ")}`);
      await killPids(pids);
      await sleep(500);
    } else {
      console.error("未找到可结束的监听进程，仍将尝试启动…");
    }
    if (await isPortInUse(port)) {
      console.error(`端口 ${port} 仍被占用，请手动结束占用进程后重试。`);
      process.exit(1);
    }
    process.stdout.write(String(port));
    return;
  }

  if (choice === "2" || choice === "n" || choice === "new") {
    const alt = await findFreePort(port === PORT_MAX ? PORT_MIN : port + 1);
    if (alt == null) {
      console.error(`端口 ${PORT_MIN}-${PORT_MAX} 均已占用，请先选择 1 结束进程。`);
      process.exit(1);
    }
    console.error("");
    console.error(`将使用端口 ${alt}。网页桥地址请改为: http://127.0.0.1:${alt}`);
    console.error("");
    process.stdout.write(String(alt));
    return;
  }

  console.error("已取消启动。");
  process.exit(1);
}

main().catch((err) => {
  console.error(err && err.message ? err.message : String(err));
  process.exit(1);
});
