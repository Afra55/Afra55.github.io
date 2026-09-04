# DevTools EnvKit — Windows 一键检测 / 安装 / 升级
# 用法（PowerShell）：
#   Set-ExecutionPolicy -Scope Process Bypass
#   .\install-devtools-env.ps1
#   .\install-devtools-env.ps1 -Mode check
#   .\install-devtools-env.ps1 -Mode install
#   .\install-devtools-env.ps1 -Mode upgrade
#   .\install-devtools-env.ps1 -Mode bridges
#
# 可选环境变量：DEVTOOLS_BRIDGE_DIR、DEVTOOLS_BASE_URL

param(
  [ValidateSet("check", "install", "upgrade", "bridges")]
  [string]$Mode = "install"
)

$ErrorActionPreference = "Continue"
$BaseUrl = if ($env:DEVTOOLS_BASE_URL) { $env:DEVTOOLS_BASE_URL } else { "https://afra55.github.io/tools" }
$BridgeDir = if ($env:DEVTOOLS_BRIDGE_DIR) { $env:DEVTOOLS_BRIDGE_DIR } else { Join-Path $HOME "DevToolsBridges" }

function Have-Cmd([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-Ver([string]$Name) {
  try {
    switch ($Name) {
      "node" { return (node -v 2>$null) }
      "git" { return (git --version 2>$null) }
      "ffmpeg" { return ((ffmpeg -version 2>$null | Select-Object -First 1)) }
      "adb" { return ((adb version 2>$null | Select-Object -First 1)) }
      "yt-dlp" { return (yt-dlp --version 2>$null) }
      default { return "" }
    }
  } catch { return "" }
}

function Write-Ok($m) { Write-Host "  [OK]   $m" -ForegroundColor Green }
function Write-Miss($m) { Write-Host "  [缺]   $m" -ForegroundColor Yellow }
function Write-Info($m) { Write-Host "  [..]   $m" }

function Ensure-Winget {
  if (Have-Cmd "winget") { return $true }
  Write-Miss "未找到 winget。请安装「应用安装程序」或手动装 Node/Git：https://nodejs.org/"
  return $false
}

function Install-One([string]$Name) {
  if (-not (Ensure-Winget)) { return }
  switch ($Name) {
    "node" { winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements }
    "git" { winget install -e --id Git.Git --accept-package-agreements --accept-source-agreements }
    "ffmpeg" { winget install -e --id Gyan.FFmpeg --accept-package-agreements --accept-source-agreements }
    "adb" { winget install -e --id Google.PlatformTools --accept-package-agreements --accept-source-agreements }
    "yt-dlp" { winget install -e --id yt-dlp.yt-dlp --accept-package-agreements --accept-source-agreements }
  }
}

function Upgrade-One([string]$Name) {
  if ($Name -eq "yt-dlp") {
    if (Have-Cmd "yt-dlp") {
      try { yt-dlp -U 2>$null } catch {}
    }
    if (Have-Cmd "pipx") {
      try { pipx upgrade yt-dlp } catch { try { pipx install yt-dlp } catch {} }
    }
    if (Have-Cmd "pip") {
      try { pip install --user -U yt-dlp } catch {}
    }
  }
  if (-not (Ensure-Winget)) { return }
  $id = switch ($Name) {
    "node" { "OpenJS.NodeJS.LTS" }
    "git" { "Git.Git" }
    "ffmpeg" { "Gyan.FFmpeg" }
    "adb" { "Google.PlatformTools" }
    "yt-dlp" { "yt-dlp.yt-dlp" }
  }
  if ($id) {
    winget upgrade -e --id $id --include-unknown --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
      # 可能已是最新，或未通过 winget 安装；尝试 install 兜底
      winget install -e --id $id --accept-package-agreements --accept-source-agreements
    }
  }
}

function Snapshot-Versions {
  $map = [ordered]@{}
  foreach ($n in @("node", "git", "ffmpeg", "adb", "yt-dlp")) {
    $v = Get-Ver $n
    if ($v) { $map[$n] = [string]$v } else { $map[$n] = "(missing)" }
  }
  return $map
}

function Do-Upgrade {
  Write-Host ""
  Write-Host "== 升级本机工具（Node / Git / FFmpeg / ADB / yt-dlp）+ 桥文件 =="
  $before = Snapshot-Versions
  Write-Host "-- 升级前 --"
  foreach ($k in $before.Keys) { Write-Info "$k=$($before[$k])" }

  foreach ($n in @("node", "git", "ffmpeg", "adb", "yt-dlp")) {
    if (Have-Cmd $n) {
      Write-Info "升级 $n …"
      Upgrade-One $n
    } else {
      Write-Info "$n 未安装 → 安装"
      Install-One $n
    }
  }

  Write-Host ""
  Write-Host "== 同步最新桥脚本 =="
  Sync-Bridges

  # 刷新 PATH 后再读版本（本会话可能仍旧）
  $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
  $after = Snapshot-Versions
  Write-Host ""
  Write-Host "-- 升级后对照 --"
  $lines = @("upgradedAt=$((Get-Date).ToUniversalTime().ToString('o'))", "---- before ----")
  foreach ($k in $before.Keys) {
    $b = $before[$k]; $a = $after[$k]
    if ($b -eq $a) { Write-Ok "$k 未变 · $a" } else {
      Write-Ok "$k 已更新"
      Write-Info "  前: $b"
      Write-Info "  后: $a"
    }
    $lines += "before_$k=$b"
  }
  $lines += "---- after ----"
  foreach ($k in $after.Keys) { $lines += "after_$k=$($after[$k])" }
  if (-not (Test-Path $BridgeDir)) { New-Item -ItemType Directory -Force -Path $BridgeDir | Out-Null }
  Set-Content -Encoding UTF8 (Join-Path $BridgeDir "last-upgrade.log") ($lines -join "`n")
  Write-Ok "对照已写入 $BridgeDir\last-upgrade.log"
  Write-Host "若版本显示仍旧：请新开终端再 check（PATH 需刷新）。"
}

function Download-File([string]$Url, [string]$Dest) {
  $dir = Split-Path -Parent $Dest
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  Invoke-WebRequest -Uri $Url -OutFile "$Dest.tmp" -UseBasicParsing
  Move-Item -Force "$Dest.tmp" $Dest
}

function Sync-Bridges {
  Write-Host ""
  Write-Host "== 同步本机桥文件 → $BridgeDir =="
  $adb = @(
    "server.js", "resolve-port.js", "scrcpy-mirror.js", "scrcpy-ctrl.js",
    "everything-proxy.js", "device-inspect.js", "start-win.bat", "start-win.cmd"
  )
  foreach ($f in $adb) {
    Write-Info "adb-bridge/$f"
    try { Download-File "$BaseUrl/adb-bridge/$f" (Join-Path $BridgeDir "adb-bridge\$f") }
    catch { Write-Miss "下载失败 $f" }
  }
  foreach ($f in @("server.js", "ytdlp-core.js", "start-win.bat", "start-win.cmd")) {
    Write-Info "ffmpeg-bridge/$f"
    try { Download-File "$BaseUrl/ffmpeg-bridge/$f" (Join-Path $BridgeDir "ffmpeg-bridge\$f") }
    catch { Write-Miss "下载失败 $f" }
  }
  foreach ($f in @("server.js", "git-ops.js", "start-win.bat", "start-win.cmd", "start-linux.sh", "start-mac.command")) {
    Write-Info "git-bridge/$f"
    try { Download-File "$BaseUrl/git-bridge/$f" (Join-Path $BridgeDir "git-bridge\$f") }
    catch { Write-Miss "下载失败 $f" }
  }
  foreach ($f in @("start-win.bat", "start-win.cmd", "start-linux.sh", "start-mac.command")) {
    try { Download-File "$BaseUrl/adb-bridge/$f" (Join-Path $BridgeDir "adb-bridge\$f") } catch {}
    try { Download-File "$BaseUrl/ffmpeg-bridge/$f" (Join-Path $BridgeDir "ffmpeg-bridge\$f") } catch {}
  }

  $bad = $false
  foreach ($rel in @("adb-bridge\server.js", "ffmpeg-bridge\server.js", "git-bridge\server.js", "git-bridge\git-ops.js")) {
    $p = Join-Path $BridgeDir $rel
    if (-not (Test-Path $p) -or (Get-Item $p).Length -lt 10) {
      Write-Miss "缺失或空：$rel"
      $bad = $true
    }
  }
  if (-not $bad) { Write-Ok "关键文件校验通过" } else { Write-Miss "桥文件校验有问题" }

  @"
DevTools 桥目录：$BridgeDir

只需启动一座统一桥：
  双击 adb-bridge\start-win.cmd
  地址 http://127.0.0.1:17888  Token: devtools-bridge
  API: /ff · /ytdlp · /git · /everything

（ffmpeg-bridge / git-bridge 目录是统一桥的嵌套模块，请勿单独启动。）

网页：https://afra55.github.io/tools/#envkit
"@ | Set-Content -Encoding UTF8 (Join-Path $BridgeDir "start-all-hint.txt")

  $state = @{
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
    baseUrl = $BaseUrl
    bridgeDir = $BridgeDir
    ok = -not $bad
  } | ConvertTo-Json
  Set-Content -Encoding UTF8 (Join-Path $BridgeDir "envkit-state.json") $state
  Write-Ok "桥文件已同步"
}

function Show-Report {
  Write-Host ""
  Write-Host "== 本机工具检测 =="
  foreach ($n in @("node", "git", "ffmpeg", "adb", "yt-dlp")) {
    $v = Get-Ver $n
    if ($v) { Write-Ok "$n · $v" } else { Write-Miss "$n 未安装" }
  }
  Write-Host "桥目录：$BridgeDir"
}

function Need-List {
  $list = @()
  if (-not (Have-Cmd "node")) { $list += "node" }
  if (-not (Have-Cmd "git")) { $list += "git" }
  if (-not (Have-Cmd "ffmpeg")) { $list += "ffmpeg" }
  if (-not (Have-Cmd "adb")) { $list += "adb" }
  if (-not (Have-Cmd "yt-dlp")) { $list += "yt-dlp" }
  return $list
}

Write-Host "DevTools EnvKit"
Write-Host "模式：$Mode"
Show-Report

switch ($Mode) {
  "check" { }
  "install" {
    $missing = Need-List
    if ($missing.Count -eq 0) {
      Write-Ok "依赖都已存在，跳过安装"
    } else {
      Write-Host ""
      Write-Host "== 安装缺失依赖 =="
      foreach ($n in $missing) {
        Write-Info "安装 $n …"
        Install-One $n
      }
      Write-Host "若命令仍找不到：请关闭本窗口，新开 PowerShell 再跑 check（PATH 刷新）。"
    }
    Sync-Bridges
    Show-Report
  }
  "upgrade" {
    Do-Upgrade
    Show-Report
  }
  "bridges" { Sync-Bridges }
}

Write-Host ""
Write-Host "下一步：启动 $BridgeDir\adb-bridge\start-win.cmd（统一桥 17888），再打开网页 #envkit / #gitbridge。"
