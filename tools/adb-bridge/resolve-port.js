#!/usr/bin/env node
"use strict";

/**
 * 启动前检查默认桥端口。
 * - 若已被本机 DevTools 桥占用：输出 `ALREADY <port>`，调用方应直接退出（勿再起一座）。
 * - 若端口空闲：输出 `READY <port>`。
 * - 若被其他进程占用：交互询问结束进程 / 换端口 / 取消；非交互则尽量换空闲端口。
 *
 * 提示与问答一律走 stderr；stdout 仅输出最终一行，便于 bat/sh 重定向捕获。
 */

const fs = require("fs");
const http = require("http");
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

function probeBridgeHealth(port, timeoutMs = 2500) {
  return new Promise((resolve) => {
    const req = http.get(
      {
        host: "127.0.0.1",
        port,
        path: "/health",
        timeout: timeoutMs,
        headers: { Accept: "application/json" },
      },
      (res) => {
        let raw = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          raw += chunk;
          if (raw.length > 65536) req.destroy();
        });
        res.on("end", () => {
          try {
            const data = JSON.parse(raw);
            const service = String(data?.service || "");
            const looksLikeOurs =
              data?.ok === true &&
              (service === "devtools-bridge" ||
                service === "devtools-adb-bridge" ||
                Array.isArray(data?.features) ||
                data?.unified === true ||
                Boolean(data?.version));
            resolve(looksLikeOurs ? data : null);
          } catch (_) {
            resolve(null);
          }
        });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
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
    out
      .split(/\r?\n/)
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

/** Prefer console for Q&A even when stdout is redirected to a file by the launcher. */
function getAskStreams() {
  if (process.stdin.isTTY) {
    return { input: process.stdin, output: process.stderr };
  }
  if (process.platform === "win32") {
    return null;
  }
  try {
    fs.accessSync("/dev/tty", fs.constants.R_OK | fs.constants.W_OK);
    return {
      input: fs.createReadStream("/dev/tty"),
      output: fs.createWriteStream("/dev/tty"),
    };
  } catch (_) {
    return null;
  }
}

function ask(question, streams) {
  const rl = readline.createInterface({
    input: streams.input,
    output: streams.output,
    terminal: true,
  });
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

function emit(mode, port) {
  process.stdout.write(`${mode} ${port}`);
}

async function main() {
  let port = DEFAULT_PORT;
  if (port < PORT_MIN || port > PORT_MAX) {
    console.error(`ADB_BRIDGE_PORT=${port} 超出本机桥范围 ${PORT_MIN}-${PORT_MAX}`);
    process.exit(1);
  }

  if (!(await isPortInUse(port))) {
    emit("READY", port);
    return;
  }

  const existing = await probeBridgeHealth(port);
  if (existing) {
    const shown = Number(existing.port) || port;
    console.error("");
    console.error(`[OK] 本机桥已在端口 ${shown} 运行（版本 ${existing.version || "?"}）。`);
    console.error("无需再开第二个窗口。请保持已打开的启动脚本窗口，回到网页点「连接」。");
    console.error("");
    emit("ALREADY", shown);
    return;
  }

  const streams = getAskStreams();
  if (!streams) {
    const alt = await findFreePort(port + 1);
    if (alt == null) {
      console.error(`端口 ${PORT_MIN}-${PORT_MAX} 均已占用，且当前为非交互环境，无法询问。`);
      process.exit(1);
    }
    console.error(`[resolve-port] 端口 ${port} 被占用（非本站桥），非交互模式自动改用 ${alt}`);
    emit("READY", alt);
    return;
  }

  console.error("");
  console.error(`[WARN] 端口 ${port} 已被占用，且不是可识别的 DevTools 本机桥。`);
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

  const choice = (await ask("请输入 [1/2/3]: ", streams)).toLowerCase();

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
    emit("READY", port);
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
    emit("READY", alt);
    return;
  }

  console.error("已取消启动。");
  process.exit(1);
}

main().catch((err) => {
  console.error(err && err.message ? err.message : String(err));
  process.exit(1);
});
