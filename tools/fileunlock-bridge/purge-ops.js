"use strict";

/**
 * 安全擦除（尽量不可恢复）+ 占用时强制解锁再删。
 * 仅 Windows 完整能力（占用检测）；擦除本身用 Node fs。
 * SSD/TRIM 下无法保证绝对不可恢复，只能大幅提高恢复成本。
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { checkLocks, killProcess, isWindows } = require("./lock-ops");

const CHUNK = 1024 * 1024;
const DEFAULT_PASSES = 2;
const MAX_KILL_ROUNDS = 3;

/** 盘符下第一级目录名若命中则整树禁删 */
const PROTECTED_TOP = new Set([
  "windows",
  "program files",
  "program files (x86)",
  "programdata",
  "users",
  "boot",
  "efi",
  "system volume information",
  "$recycle.bin",
  "recovery",
]);

/** 不可自动杀掉的进程名（小写） */
const NEVER_KILL = new Set([
  "system",
  "idle",
  "csrss.exe",
  "wininit.exe",
  "services.exe",
  "lsass.exe",
  "smss.exe",
  "winlogon.exe",
  "registry",
  "memory compression",
  "fontdrvhost.exe",
  "dwm.exe",
]);

function normalizePath(p) {
  return path.resolve(String(p || "").trim());
}

function isDriveRoot(p) {
  const n = normalizePath(p);
  if (process.platform === "win32") {
    return /^[A-Za-z]:\\?$/.test(n) || /^[A-Za-z]:\/?$/.test(n.replace(/\//g, "\\"));
  }
  return n === "/";
}

function assertSafeTarget(raw) {
  const p = normalizePath(raw);
  if (!p) throw new Error("空路径");
  if (isDriveRoot(p)) throw new Error(`拒绝删除盘符根：${p}`);
  const lower = p.replace(/\//g, "\\").toLowerCase().replace(/\\+$/, "");
  try {
    const home = path.resolve(require("os").homedir()).replace(/\//g, "\\").toLowerCase().replace(/\\+$/, "");
    if (lower === home) throw new Error(`拒绝删除用户主目录根：${p}`);
  } catch (err) {
    if (String(err.message || "").startsWith("拒绝")) throw err;
  }
  // Windows：盘符下第一级为系统目录则整树禁删（含该目录自身）
  const m = lower.match(/^[a-z]:\\([^\\]+)/);
  if (m && PROTECTED_TOP.has(m[1])) {
    throw new Error(`拒绝删除受保护路径：${p}`);
  }
  return p;
}

async function pathKind(p) {
  try {
    const st = await fs.promises.lstat(p);
    if (st.isSymbolicLink()) return { kind: "link", size: 0, exists: true };
    if (st.isDirectory()) return { kind: "dir", size: 0, exists: true };
    if (st.isFile()) return { kind: "file", size: st.size, exists: true };
    return { kind: "other", size: st.size || 0, exists: true };
  } catch {
    return { kind: "missing", size: 0, exists: false };
  }
}

async function inspectPaths(paths) {
  const list = Array.isArray(paths) ? paths : [];
  const out = [];
  for (const raw of list) {
    const p = String(raw || "").trim();
    if (!p) continue;
    let safe = true;
    let reason = "";
    try {
      assertSafeTarget(p);
    } catch (err) {
      safe = false;
      reason = err.message || String(err);
    }
    const info = await pathKind(normalizePath(p));
    out.push({
      path: normalizePath(p),
      ...info,
      safe,
      reason,
    });
  }
  return out;
}

async function listAllFilesDeep(root) {
  const files = [];
  const dirs = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      try {
        if (e.isSymbolicLink()) {
          // 符号链接：只删链接本身，不跟随
          files.push(full);
          continue;
        }
      } catch (_) {}
      if (e.isDirectory()) {
        dirs.push(full);
        stack.push(full);
      } else {
        files.push(full);
      }
    }
  }
  // 深目录先删：按路径长度降序
  dirs.sort((a, b) => b.length - a.length);
  return { files, dirs };
}

async function overwriteFile(filePath, size, passes) {
  if (size <= 0) return;
  const fh = await fs.promises.open(filePath, "r+");
  try {
    const buf = Buffer.alloc(CHUNK);
    for (let pass = 0; pass < passes; pass++) {
      let offset = 0;
      while (offset < size) {
        const n = Math.min(CHUNK, size - offset);
        if (pass % 2 === 0) crypto.randomFillSync(buf, 0, n);
        else buf.fill(0, 0, n);
        await fh.write(buf, 0, n, offset);
        offset += n;
      }
      await fh.sync();
    }
  } finally {
    await fh.close();
  }
}

async function shredOneFile(filePath, { passes = DEFAULT_PASSES } = {}) {
  let st;
  try {
    st = await fs.promises.lstat(filePath);
  } catch (err) {
    if (err?.code === "ENOENT") return { ok: true, skipped: true };
    throw err;
  }
  if (st.isSymbolicLink()) {
    await fs.promises.unlink(filePath);
    return { ok: true, bytes: 0 };
  }
  if (st.isDirectory()) throw new Error("内部错误：目录不能按文件擦除");
  const size = st.size;
  // 只读属性：去掉后再写
  try {
    await fs.promises.chmod(filePath, 0o666);
  } catch (_) {}
  try {
    await overwriteFile(filePath, size, passes);
  } catch (err) {
    // 无写权限时仍尝试 unlink（至少删目录项）
    if (!/EPERM|EACCES|EBUSY/i.test(String(err?.code || err?.message || ""))) throw err;
  }
  // 打乱文件名再删，降低按名恢复概率
  const dir = path.dirname(filePath);
  const scrambled = path.join(dir, `.~w${crypto.randomBytes(8).toString("hex")}`);
  try {
    await fs.promises.rename(filePath, scrambled);
    await fs.promises.unlink(scrambled);
  } catch (_) {
    await fs.promises.unlink(filePath);
  }
  return { ok: true, bytes: size };
}

function canAutoKill(proc) {
  const name = String(proc?.name || "").trim().toLowerCase();
  const base = name.includes("\\") ? path.basename(name) : name;
  if (NEVER_KILL.has(base) || NEVER_KILL.has(name)) return false;
  if (Number(proc?.type) === 1000) return false; // 关键进程
  return true;
}

async function unlockPath(target) {
  if (!isWindows()) return { killed: [], skipped: [] };
  let data;
  try {
    data = await checkLocks(target);
  } catch {
    return { killed: [], skipped: [] };
  }
  const killed = [];
  const skipped = [];
  for (const proc of data.processes || []) {
    if (!canAutoKill(proc)) {
      skipped.push(proc);
      continue;
    }
    try {
      await killProcess(proc.pid, { force: true });
      killed.push(proc);
    } catch (_) {
      skipped.push(proc);
    }
  }
  if (killed.length) await sleep(400);
  return { killed, skipped };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withUnlockRetry(target, fn) {
  let lastErr = null;
  for (let round = 0; round <= MAX_KILL_ROUNDS; round++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const code = err?.code || "";
      const msg = String(err?.message || err);
      if (!/EBUSY|EPERM|EACCES|resource busy|being used/i.test(`${code} ${msg}`)) throw err;
      if (round === MAX_KILL_ROUNDS) break;
      await unlockPath(target);
    }
  }
  throw lastErr || new Error("删除失败");
}

async function purgeOne(rawPath, { passes = DEFAULT_PASSES, onProgress } = {}) {
  const p = assertSafeTarget(rawPath);
  const info = await pathKind(p);
  if (!info.exists) {
    return { path: p, ok: true, missing: true, wipedFiles: 0, wipedBytes: 0, killed: [] };
  }

  const killedAll = [];
  const report = (patch) => {
    try {
      onProgress?.({ path: p, ...patch });
    } catch (_) {}
  };

  if (info.kind === "file" || info.kind === "link" || info.kind === "other") {
    report({ phase: "shred", current: p });
    await withUnlockRetry(p, async () => {
      const u = await unlockPath(p);
      killedAll.push(...u.killed);
      await shredOneFile(p, { passes });
    });
    return {
      path: p,
      ok: true,
      kind: info.kind,
      wipedFiles: 1,
      wipedBytes: info.size || 0,
      killed: killedAll,
    };
  }

  // directory
  report({ phase: "scan", current: p });
  const { files, dirs } = await listAllFilesDeep(p);
  let wipedFiles = 0;
  let wipedBytes = 0;
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    report({ phase: "shred", current: f, index: i + 1, total: files.length });
    await withUnlockRetry(f, async () => {
      const u = await unlockPath(f);
      killedAll.push(...u.killed);
      let size = 0;
      try {
        size = (await fs.promises.stat(f)).size;
      } catch (_) {}
      await shredOneFile(f, { passes });
      wipedFiles += 1;
      wipedBytes += size;
    });
  }
  for (const d of dirs) {
    report({ phase: "rmdir", current: d });
    await withUnlockRetry(d, async () => {
      const u = await unlockPath(d);
      killedAll.push(...u.killed);
      await fs.promises.rmdir(d).catch(async () => {
        await fs.promises.rm(d, { recursive: true, force: true });
      });
    });
  }
  report({ phase: "rmdir", current: p });
  await withUnlockRetry(p, async () => {
    const u = await unlockPath(p);
    killedAll.push(...u.killed);
    await fs.promises.rm(p, { recursive: true, force: true });
  });

  // dedupe killed by pid
  const seen = new Set();
  const killed = [];
  for (const k of killedAll) {
    if (seen.has(k.pid)) continue;
    seen.add(k.pid);
    killed.push(k);
  }

  return {
    path: p,
    ok: true,
    kind: "dir",
    wipedFiles,
    wipedBytes,
    killed,
  };
}

async function purgePaths(paths, opts = {}) {
  const list = [...new Set((Array.isArray(paths) ? paths : []).map((p) => String(p || "").trim()).filter(Boolean))];
  if (!list.length) throw new Error("请至少选择一个文件或文件夹");
  const results = [];
  for (const raw of list) {
    try {
      const r = await purgeOne(raw, opts);
      results.push(r);
    } catch (err) {
      results.push({
        path: String(raw),
        ok: false,
        error: err?.message || String(err),
        wipedFiles: 0,
        wipedBytes: 0,
        killed: [],
      });
    }
  }
  const ok = results.filter((r) => r.ok).length;
  const fail = results.length - ok;
  return {
    ok: fail === 0,
    total: results.length,
    succeeded: ok,
    failed: fail,
    results,
    note: "已覆写后删除（尽量不可恢复）。固态硬盘/TRIM 下无法保证绝对不可恢复。",
  };
}

module.exports = {
  assertSafeTarget,
  inspectPaths,
  purgeOne,
  purgePaths,
  DEFAULT_PASSES,
};
