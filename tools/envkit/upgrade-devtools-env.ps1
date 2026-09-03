# 一键升级：拉取最新 EnvKit 后升级本机工具 + 桥
# Node / Git / FFmpeg / ADB / yt-dlp

$ErrorActionPreference = "Continue"
$BaseUrl = if ($env:DEVTOOLS_BASE_URL) { $env:DEVTOOLS_BASE_URL } else { "https://afra55.github.io/tools" }
$Tmp = Join-Path $env:TEMP ("devtools-envkit-upgrade-" + [guid]::NewGuid().ToString() + ".ps1")

Write-Host "DevTools 一键升级"
Write-Host "拉取最新脚本：$BaseUrl/envkit/install-devtools-env.ps1"
Invoke-WebRequest -Uri "$BaseUrl/envkit/install-devtools-env.ps1" -OutFile $Tmp -UseBasicParsing
& powershell -NoProfile -ExecutionPolicy Bypass -File $Tmp -Mode upgrade
$code = $LASTEXITCODE
Remove-Item -Force $Tmp -ErrorAction SilentlyContinue
Write-Host ""
Read-Host "按回车关闭"
exit $code
