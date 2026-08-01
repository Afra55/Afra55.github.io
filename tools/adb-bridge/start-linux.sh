#!/usr/bin/env bash
set -e
echo "DevTools ADB Bridge 启动中..."
echo "使用本工具需要本机已安装 adb，并可用：adb devices"
echo ""

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 node。请先安装 Node.js：https://nodejs.org/"
  exit 1
fi

if ! command -v adb >/dev/null 2>&1; then
  echo "未找到 adb。请安装 Android platform-tools，并确保 adb 在 PATH 中。"
  exit 1
fi

BRIDGE_DIR="${HOME}/.devtools-adb-bridge"
mkdir -p "${BRIDGE_DIR}"
BASE_URL="${ADB_BRIDGE_BASE_URL:-https://afra55.github.io/tools/adb-bridge}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "${SCRIPT_DIR}/server.js" ]; then
  cp -f "${SCRIPT_DIR}/server.js" "${BRIDGE_DIR}/server.js"
else
  echo "正在下载桥接服务：${BASE_URL}/server.js"
  curl -fsSL "${BASE_URL}/server.js" -o "${BRIDGE_DIR}/server.js"
fi

cd "${BRIDGE_DIR}"
export ADB_BRIDGE_TOKEN="${ADB_BRIDGE_TOKEN:-devtools-adb}"
export ADB_BRIDGE_PORT="${ADB_BRIDGE_PORT:-17888}"
echo "adb 版本："
adb version | head -n 1 || true
echo ""
exec node server.js
