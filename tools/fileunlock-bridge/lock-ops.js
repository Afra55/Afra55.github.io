"use strict";

/**
 * Windows 文件占用检测 / 解锁。
 * 探测用 Windows Restart Manager（rstrtmgr.dll），无需额外下载工具。
 * 仅 Windows 可用；其他平台直接报错。
 */

const fs = require("fs");
const path = require("path");
const { execFile } = require("child_process");

const MAX_FILES = 600;

function isWindows() {
  return process.platform === "win32";
}

function execFileAsync(file, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { windowsHide: true, maxBuffer: 16 * 1024 * 1024, timeout: opts.timeout || 60000, ...opts },
      (err, stdout, stderr) => {
        if (err) {
          err.stdout = stdout;
          err.stderr = stderr;
          reject(err);
          return;
        }
        resolve({ stdout: String(stdout || ""), stderr: String(stderr || "") });
      }
    );
  });
}

function runPowerShell(script, { sta = false, timeout = 60000 } = {}) {
  const args = ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass"];
  if (sta) args.push("-STA");
  args.push("-Command", script);
  return execFileAsync("powershell.exe", args, { timeout });
}

const RM_CSHARP = [
  "using System;",
  "using System.Runtime.InteropServices;",
  "public static class RmLock {",
  "  [StructLayout(LayoutKind.Sequential)]",
  "  private struct RM_UNIQUE_PROCESS {",
  "    public int dwProcessId;",
  "    public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;",
  "  }",
  "  private const int ERROR_MORE_DATA = 234;",
  "  private const int CCH_RM_MAX_APP_NAME = 255;",
  "  private const int CCH_RM_MAX_SVC_NAME = 63;",
  "  private enum RM_APP_TYPE { RmUnknownApp = 0, RmMainWindow = 1, RmOtherWindow = 2, RmService = 3, RmExplorer = 4, RmConsole = 5, RmCritical = 1000 }",
  "  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]",
  "  private struct RM_PROCESS_INFO {",
  "    public RM_UNIQUE_PROCESS Process;",
  "    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_APP_NAME + 1)]",
  "    public string strAppName;",
  "    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_SVC_NAME + 1)]",
  "    public string strServiceShortName;",
  "    public RM_APP_TYPE ApplicationType;",
  "    public uint AppStatus;",
  "    public uint TSSessionId;",
  "    [MarshalAs(UnmanagedType.Bool)]",
  "    public bool bRestartable;",
  "  }",
  '  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]',
  "  private static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);",
  '  [DllImport("rstrtmgr.dll")]',
  "  private static extern int RmEndSession(uint pSessionHandle);",
  '  [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]',
  "  private static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames, uint nApplications, [In] RM_UNIQUE_PROCESS[] rgApplications, uint nServices, string[] rgsServiceNames);",
  '  [DllImport("rstrtmgr.dll")]',
  "  private static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);",
  "  public static string Who(string[] files) {",
  "    uint handle;",
  "    string key = Guid.NewGuid().ToString();",
  "    int res = RmStartSession(out handle, 0, key);",
  '    if (res != 0) return "{\\"error\\":\\"RmStartSession " + res + "\\"}";',
  '    var sb = new System.Text.StringBuilder();',
  '    sb.Append("[");',
  "    try {",
  "      res = RmRegisterResources(handle, (uint)files.Length, files, 0, null, 0, null);",
  '      if (res != 0) return "{\\"error\\":\\"RmRegisterResources " + res + "\\"}";',
  "      uint needed = 0, count = 0, reasons = 0;",
  "      res = RmGetList(handle, out needed, ref count, null, ref reasons);",
  "      if (res == ERROR_MORE_DATA) {",
  "        var info = new RM_PROCESS_INFO[needed];",
  "        count = needed;",
  "        res = RmGetList(handle, out needed, ref count, info, ref reasons);",
  "        if (res == 0) {",
  "          for (int i = 0; i < count; i++) {",
  '            if (i > 0) sb.Append(",");',
  '            string name = (info[i].strAppName ?? "").Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"");',
  '            sb.Append("{\\"pid\\":").Append(info[i].Process.dwProcessId)',
  '              .Append(",\\"name\\":\\"").Append(name).Append("\\"")',
  '              .Append(",\\"type\\":").Append((int)info[i].ApplicationType).Append("}");',
  "          }",
  "        }",
  "      }",
  "    } finally { RmEndSession(handle); }",
  '    sb.Append("]");',
  "    return sb.ToString();",
  "  }",
  "}",
].join("\n");

const APP_TYPE_LABEL = {
  0: "未知应用",
  1: "窗口程序",
  2: "后台窗口",
  3: "系统服务",
  4: "资源管理器",
  5: "控制台",
  1000: "关键进程",
};

function psQuote(s) {
  return `'${String(s).replace(/'/g, "''")}'`;
}

function collectFiles(target) {
  const st = fs.statSync(target);
  if (!st.isDirectory()) return { kind: "file", files: [target] };
  const out = [];
  const stack = [target];
  while (stack.length && out.length < MAX_FILES) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (out.length >= MAX_FILES) break;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) stack.push(full);
      else out.push(full);
    }
  }
  return { kind: "dir", files: out };
}

async function checkLocks(target) {
  if (!isWindows()) throw new Error("仅支持 Windows");
  const p = String(target || "").trim();
  if (!p) throw new Error("请提供文件或文件夹路径");
  if (!fs.existsSync(p)) throw new Error("路径不存在：请检查是否拼错，或先连接对应磁盘");
  const { kind, files } = collectFiles(p);
  if (!files.length) {
    return { path: p, kind, scanned: 0, truncated: false, processes: [] };
  }
  const script = [
    "$ErrorActionPreference='Stop'",
    `$files=@(${files.map(psQuote).join(",")})`,
    "$src=@'\n" + RM_CSHARP + "\n'@",
    "Add-Type -TypeDefinition $src -Language CSharp",
    "Write-Output ([RmLock]::Who($files))",
  ].join("\n");
  let stdout = "";
  try {
    ({ stdout } = await runPowerShell(script, { timeout: 90000 }));
  } catch (err) {
    const msg = String(err?.stderr || err?.message || err).trim();
    throw new Error(`调用 Restart Manager 失败：${msg.slice(0, 300)}`);
  }
  const line = String(stdout || "")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .pop();
  let parsed = [];
  try {
    parsed = JSON.parse(line || "[]");
  } catch {
    throw new Error("解析 Restart Manager 结果失败");
  }
  if (parsed && !Array.isArray(parsed) && parsed.error) throw new Error(parsed.error);
  const seen = new Set();
  const processes = [];
  for (const item of Array.isArray(parsed) ? parsed : []) {
    const pid = Number(item?.pid);
    if (!Number.isFinite(pid) || pid <= 0 || seen.has(pid)) continue;
    seen.add(pid);
    processes.push({
      pid,
      name: String(item?.name || "").trim() || `PID ${pid}`,
      type: Number(item?.type) || 0,
      typeLabel: APP_TYPE_LABEL[Number(item?.type)] || "应用",
    });
  }
  processes.sort((a, b) => a.name.localeCompare(b.name));
  return {
    path: p,
    kind,
    scanned: files.length,
    truncated: kind === "dir" && files.length >= MAX_FILES,
    processes,
  };
}

async function killProcess(pid, { force = false } = {}) {
  if (!isWindows()) throw new Error("仅支持 Windows");
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 0) throw new Error("无效的进程号");
  const args = ["/PID", String(Math.round(n))];
  if (force) args.push("/F");
  try {
    const { stdout } = await execFileAsync("taskkill", args, { timeout: 20000 });
    return { pid: Math.round(n), force, output: String(stdout || "").trim() };
  } catch (err) {
    const msg = String(err?.stderr || err?.stdout || err?.message || err).trim();
    throw new Error(msg.slice(0, 300) || "关闭进程失败（可能权限不足）");
  }
}

async function pickPath(kind = "file") {
  if (!isWindows()) throw new Error("仅支持 Windows");
  const isDir = kind === "dir";
  const script = [
    "Add-Type -AssemblyName System.Windows.Forms",
    "$f = New-Object System.Windows.Forms.Form",
    "$f.TopMost = $true",
    isDir
      ? "$d = New-Object System.Windows.Forms.FolderBrowserDialog; $d.Description='选择文件夹'; $d.ShowNewFolderButton=$false"
      : "$d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title='选择文件'; $d.CheckFileExists=$false; $d.CheckPathExists=$true; $d.ValidateNames=$false",
    "$r = $d.ShowDialog($f)",
    "if ($r -eq [System.Windows.Forms.DialogResult]::OK) { if (" +
      (isDir ? "$d.SelectedPath" : "$d.FileName") +
      ") { Write-Output (" +
      (isDir ? "$d.SelectedPath" : "$d.FileName") +
      ") } }",
  ].join("\n");
  const { stdout } = await runPowerShell(script, { sta: true, timeout: 120000 });
  const picked = String(stdout || "").trim().split(/\r?\n/).filter(Boolean).pop() || "";
  return { path: picked };
}

module.exports = { isWindows, checkLocks, killProcess, pickPath };
