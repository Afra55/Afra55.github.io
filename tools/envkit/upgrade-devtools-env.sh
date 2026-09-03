#!/usr/bin/env bash
# 一键升级：先拉最新 EnvKit 脚本，再升级本机工具 + 桥文件
# Node / Git / FFmpeg / ADB / yt-dlp 都会尝试升级；未装则安装。

set -u
BASE_URL="${DEVTOOLS_BASE_URL:-https://afra55.github.io/tools}"
TMP="${TMPDIR:-/tmp}/devtools-envkit-upgrade-$$.sh"

echo "DevTools 一键升级"
echo "拉取最新脚本：$BASE_URL/envkit/install-devtools-env.sh"

if command -v curl >/dev/null 2>&1; then
  curl -fsSL --connect-timeout 20 --max-time 120 "$BASE_URL/envkit/install-devtools-env.sh" -o "$TMP"
elif command -v wget >/dev/null 2>&1; then
  wget -q -O "$TMP" "$BASE_URL/envkit/install-devtools-env.sh"
else
  echo "需要 curl 或 wget"
  exit 1
fi

chmod +x "$TMP"
bash "$TMP" upgrade
CODE=$?
rm -f "$TMP"
echo ""
if [ -t 0 ]; then
  read -r -p "按回车关闭…" _
fi
exit "$CODE"
