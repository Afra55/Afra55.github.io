#!/usr/bin/env node
"use strict";

/**
 * 启动前检查默认桥端口。
 * - 若已被本机 DevTools 桥占用：交互询问「保持 / 结束并重启 / 取消」；
 *   网页协议唤起或非交互（DEVTOOLS_BRIDGE_QUIET=1）则直接 `ALREADY <port>`。
 * - 若只有僵死启动锁、没有 /health：交互询问「再探测 / 结束旧服务并启动 / 取消」。
 * - 若端口空闲：输出 `READY <port>`。
 * - 若被其他进程占用：交互询问结束进程 / 换端口 / 取消；非交互则尽量换空闲端口。
 *
 * 提示与问答一律走 stderr；stdout 仅输出最终一行，便于 bat/sh 重定向捕获。
 */

const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const readline = require("readline");
const { execSync } = require("child_process");

const PORT_MIN = 17888;
const PORT_MAX = 17899;
const DEFAULT_PORT = Number(process.env.ADB_BRIDGE_PORT || process.env.DEVTOOLS_BRIDGE_PORT || PORT_MIN);
const LOCK_PATH = path.join(__dirname, ".bridge-instance.lock");
const LOCK_STALE_MS = 20000;

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
    return { input: process.stdin, output: process.stderr.isTTY ? process.stderr : process.stdout };
  }
  // Windows：bat 把 stdout 重定向到文件时，stdin 可能不再是 TTY；走 CONIN$/CONOUT$ 才能问「结束旧桥」
  if (process.platform === "win32") {
    try {
      return {
        input: fs.createReadStream("\\\\.\\CONIN$"),
        output: fs.createWriteStream("\\\\.\\CONOUT$"),
      };
    } catch (_) {
      return null;
    }
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

function isQuietMode() {
  const v = String(process.env.DEVTOOLS_BRIDGE_QUIET || process.env.ADB_BRIDGE_QUIET || "").trim();
  return v === "1" || /^true$/i.test(v) || /^yes$/i.test(v);
}

function clearInstanceLock() {
  try {
    fs.unlinkSync(LOCK_PATH);
  } catch (_) {
    /* ignore */
  }
}

function releaseStarterLockIfOurs() {
  const meta = readLockMeta();
  if (meta?.pid === process.pid) clearInstanceLock();
}

/**
 * 本站桥已在跑：不要「再开一座」。
 * 手动双击可选手动结束旧桥后在本窗口重启；协议唤起 / 非交互则静默复用。
 */
async function resolveExistingBridge(port, health) {
  const shown = Number(health?.port) || port;
  const ver = health?.version || "?";

  if (isQuietMode()) {
    releaseStarterLockIfOurs();
    emit("ALREADY", shown);
    return;
  }

  const streams = getAskStreams();
  if (!streams) {
    console.error("");
    console.error(`[OK] 本机桥已在端口 ${shown} 运行（版本 ${ver}）。`);
    console.error("无需再开第二个窗口。请保持已打开的启动脚本窗口，回到网页点「连接」。");
    console.error("");
    releaseStarterLockIfOurs();
    emit("ALREADY", shown);
    return;
  }

  console.error("");
  console.error(`[OK] 检测到本机桥已在端口 ${shown} 运行（版本 ${ver}）。`);
  console.error("同时开两座桥容易导致镜像/连接异常，不建议再开新进程。");
  console.error("");
  console.error("请选择：");
  console.error("  1) 保持现有桥（推荐）— 关掉本窗口，回到网页点「连接」");
  console.error("  2) 结束旧桥，在本窗口重新启动");
  console.error("  3) 取消");
  console.error("");

  const choice = (await ask("请输入 [1/2/3]: ", streams)).toLowerCase();

  if (choice === "2" || choice === "r" || choice === "restart") {
    const pids = getBridgeRangePids().filter((pid) => pid !== process.pid);
    if (pids.length) {
      console.error(`正在结束旧桥相关进程: ${pids.join(", ")}`);
      await killPids(pids);
      await sleep(600);
    } else {
      console.error("未找到可结束的监听进程，仍将尝试启动…");
    }
    clearInstanceLock();
    const prefer = Number.isFinite(shown) && shown >= PORT_MIN && shown <= PORT_MAX ? shown : port;
    if (await isPortInUse(prefer)) {
      const alt = await findFreePort(prefer === PORT_MAX ? PORT_MIN : prefer + 1);
      if (alt == null) {
        console.error(`端口 ${PORT_MIN}-${PORT_MAX} 仍被占用，请手动结束后重试。`);
        process.exit(1);
      }
      console.error(`将使用端口 ${alt}。网页桥地址请改为: http://127.0.0.1:${alt}`);
      tryWriteLock();
      emit("READY", alt);
      return;
    }
    tryWriteLock();
    console.error(`将在本窗口重新启动（端口 ${prefer}）。`);
    emit("READY", prefer);
    return;
  }

  if (choice === "3" || choice === "c" || choice === "cancel") {
    releaseStarterLockIfOurs();
    console.error("已取消启动。");
    process.exit(1);
  }

  console.error("将保持现有桥。请关掉本窗口，回到网页点「连接」。");
  releaseStarterLockIfOurs();
  emit("ALREADY", shown);
}

function isPidAlive(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  if (process.platform === "win32") {
    try {
      const out = execSync(`tasklist /FI "PID eq ${pid}" /NH`, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return new RegExp(`\\b${pid}\\b`).test(out);
    } catch (_) {
      return false;
    }
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (_) {
    return false;
  }
}

function readLockMeta() {
  try {
    const text = fs.readFileSync(LOCK_PATH, "utf8");
    const [pidLine, tsLine] = text.split(/\r?\n/);
    return { pid: Number(pidLine), ts: Number(tsLine) || 0 };
  } catch (_) {
    return null;
  }
}

function tryWriteLock() {
  try {
    const fd = fs.openSync(LOCK_PATH, "wx");
    fs.writeFileSync(fd, `${process.pid}\n${Date.now()}\n`);
    fs.closeSync(fd);
    return true;
  } catch (err) {
    if (err && err.code === "EEXIST") return false;
    throw err;
  }
}

async function probeAnyBridge(timeoutMs = 800) {
  const ports = [];
  const push = (p) => {
    if (!Number.isFinite(p) || p <= 0 || ports.includes(p)) return;
    ports.push(p);
  };
  push(DEFAULT_PORT);
  for (let port = PORT_MIN; port <= PORT_MAX; port += 1) push(port);
  for (const port of ports) {
    const existing = await probeBridgeHealth(port, timeoutMs);
    if (existing) return existing;
  }
  return null;
}

/**
 * 防止「手动双击 + 网页协议唤起」在第一座尚未 listen 时各起一座。
 * 锁由本进程写入；server.js 听端口成功后会改写成自己的 pid。
 */
async function acquireStarterLock() {
  const deadline = Date.now() + 16000;
  while (Date.now() < deadline) {
    const running = await probeAnyBridge(600);
    if (running) return { mode: "already", health: running };

    if (tryWriteLock()) return { mode: "acquired" };

    const meta = readLockMeta();
    const age = meta?.ts ? Date.now() - meta.ts : Infinity;
    const alive = meta?.pid ? isPidAlive(meta.pid) : false;
    // 持锁进程已死 → 立刻清锁（不必等 LOCK_STALE_MS，否则用户会看到「另一个脚本」假提示）
    if (!alive) {
      try {
        fs.unlinkSync(LOCK_PATH);
      } catch (_) {
        /* ignore */
      }
      continue;
    }
    // 活着但超时太久且一直没有 /health → 视为僵死启动，清锁重试
    if (age > LOCK_STALE_MS) {
      try {
        fs.unlinkSync(LOCK_PATH);
      } catch (_) {
        /* ignore */
      }
      continue;
    }
    await sleep(400);
  }
  const running = await probeAnyBridge(800);
  if (running) return { mode: "already", health: running };
  return { mode: "pending", health: null };
}

/**
 * 锁/探测陷入「说有别人在开、实际没有窗口」时：交互给出结束旧服务并启动的选项。
 * 协议唤起 / QUIET 仍静默 ALREADY，避免网页连点弹多个确认框。
 */
async function resolvePendingStart(port) {
  const shown = port;

  if (isQuietMode()) {
    releaseStarterLockIfOurs();
    emit("ALREADY", shown);
    return;
  }

  const streams = getAskStreams();
  const rangePids = getBridgeRangePids().filter((pid) => pid !== process.pid);
  const lockMeta = readLockMeta();
  const lockAlive = lockMeta?.pid ? isPidAlive(lockMeta.pid) : false;

  if (!streams) {
    console.error("");
    console.error("[WARN] 检测到启动锁或残留进程，但当前无法弹出选择菜单（非交互环境）。");
    console.error("可手动结束 17888–17899 占用进程，删除同目录 .bridge-instance.lock 后重试。");
    console.error("");
    releaseStarterLockIfOurs();
    emit("ALREADY", shown);
    return;
  }

  console.error("");
  console.error("[WARN] 检测到启动锁或端口范围内可能有残留服务，但当前没有可用的本机桥 /health。");
  console.error("常见原因：上次窗口被关掉后进程仍在后台，或启动锁文件未清理。");
  console.error("（若你确认另有启动窗口正在打开，可选 1 继续等待。）");
  console.error("");
  if (lockMeta?.pid) {
    console.error(`  锁文件 PID: ${lockMeta.pid}${lockAlive ? "（仍在运行）" : "（已不存在）"}`);
  }
  if (rangePids.length) {
    console.error(`  17888–17899 监听进程: ${rangePids.join(", ")}`);
  } else {
    console.error("  17888–17899：未列出监听进程（可能只有僵死锁文件）");
  }
  console.error("");
  console.error("请选择：");
  console.error("  1) 再探测一次（若已有桥则复用）");
  console.error("  2) 结束旧服务并在本窗口启动（清锁 + 结束 17888–17899 监听进程）");
  console.error("  3) 取消");
  console.error("");

  const choice = (await ask("请输入 [1/2/3]: ", streams)).toLowerCase();

  if (choice === "2" || choice === "k" || choice === "kill" || choice === "r" || choice === "restart") {
    const pids = getBridgeRangePids().filter((pid) => pid !== process.pid);
    if (lockMeta?.pid && lockAlive && lockMeta.pid !== process.pid && !pids.includes(lockMeta.pid)) {
      pids.push(lockMeta.pid);
    }
    if (pids.length) {
      console.error(`正在结束相关进程: ${pids.join(", ")}`);
      await killPids(pids);
      await sleep(600);
    } else {
      console.error("未找到可结束的监听进程，将清理启动锁并尝试启动…");
    }
    clearInstanceLock();
    const prefer = port;
    if (await isPortInUse(prefer)) {
      const alt = await findFreePort(prefer === PORT_MAX ? PORT_MIN : prefer + 1);
      if (alt == null) {
        console.error(`端口 ${PORT_MIN}-${PORT_MAX} 仍被占用，请手动结束后重试。`);
        process.exit(1);
      }
      console.error(`将使用端口 ${alt}。网页桥地址请改为: http://127.0.0.1:${alt}`);
      tryWriteLock();
      emit("READY", alt);
      return;
    }
    tryWriteLock();
    console.error(`将在本窗口启动（端口 ${prefer}）。`);
    emit("READY", prefer);
    return;
  }

  if (choice === "3" || choice === "c" || choice === "cancel") {
    releaseStarterLockIfOurs();
    console.error("已取消启动。");
    process.exit(1);
  }

  // 默认 / 1：再探测；有桥则走保持/重启菜单，否则仍给一次结束选项提示后 ALREADY
  const again = await probeAnyBridge(1200);
  if (again) {
    await resolveExistingBridge(port, again);
    return;
  }
  console.error("");
  console.error("仍未探测到可用本机桥。若没有其它窗口，请重新运行并选 2 结束旧服务。");
  console.error("");
  releaseStarterLockIfOurs();
  emit("ALREADY", shown);
}

async function main() {
  let port = DEFAULT_PORT;
  if (port < PORT_MIN || port > PORT_MAX) {
    console.error(`ADB_BRIDGE_PORT=${port} 超出本机桥范围 ${PORT_MIN}-${PORT_MAX}`);
    process.exit(1);
  }

  const lock = await acquireStarterLock();
  if (lock.mode === "already") {
    await resolveExistingBridge(port, lock.health);
    return;
  }
  if (lock.mode === "pending") {
    await resolvePendingStart(port);
    return;
  }

  if (!(await isPortInUse(port))) {
    emit("READY", port);
    return;
  }

  const existing = await probeBridgeHealth(port);
  if (existing) {
    await resolveExistingBridge(port, existing);
    return;
  }

  const streams = getAskStreams();
  if (!streams || isQuietMode()) {
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
    clearInstanceLock();
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
