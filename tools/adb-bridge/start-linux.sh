#!/usr/bin/env bash
# DevTools ADB Bridge launcher (Linux)
# Do not use set -e for the whole script — always show errors before exit.

echo "DevTools ADB Bridge 启动中..."
echo "使用本工具需要本机已安装 adb，并可用：adb devices"
echo ""

export PATH="$HOME/Android/Sdk/platform-tools:/usr/local/bin:/usr/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
fi

pause_exit() {
  local code="${1:-1}"
  echo ""
  if [ -t 0 ]; then
    read -r -p "按回车关闭..." _
  fi
  exit "$code"
}

LOG_DIR="${HOME}/.devtools-adb-bridge"
mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/last-start.log"
{
  echo "==== $(date) ===="
  echo "PATH=$PATH"
  command -v node || true
  command -v adb || true
} >"${LOG_FILE}" 2>&1

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 node。请先安装 Node.js：https://nodejs.org/"
  echo "日志：${LOG_FILE}"
  pause_exit 1
fi

if ! command -v adb >/dev/null 2>&1; then
  echo "未找到 adb。请安装 Android platform-tools，并确保 adb 在 PATH 中。"
  echo "日志：${LOG_FILE}"
  pause_exit 1
fi

BRIDGE_DIR="${HOME}/.devtools-adb-bridge"
mkdir -p "${BRIDGE_DIR}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="${BRIDGE_DIR}/server.js"

is_valid_server() {
  local f="$1"
  [ -f "$f" ] && [ -s "$f" ] && grep -q "devtools-adb-bridge\|ADB_BRIDGE_TOKEN\|DevTools local ADB bridge" "$f" 2>/dev/null
}

if is_valid_server "${SCRIPT_DIR}/server.js"; then
  cp -f "${SCRIPT_DIR}/server.js" "${TARGET}"
  echo "已使用同目录 server.js"
elif is_valid_server "${TARGET}"; then
  echo "已使用本地缓存：${TARGET}"
else
  URLS=(
    "${ADB_BRIDGE_BASE_URL:-https://afra55.github.io/tools/adb-bridge}/server.js"
    "https://afra55.github.io/tools/adb-bridge/server.js"
    "https://raw.githubusercontent.com/Afra55/Afra55.github.io/master/tools/adb-bridge/server.js"
  )
  OK=0
  if ! command -v curl >/dev/null 2>&1; then
    echo "未找到 curl，无法下载 server.js"
    echo "请重新从网页下载「完整 ZIP 包」（内含 server.js），解压后运行本脚本。"
    pause_exit 1
  fi
  for url in "${URLS[@]}"; do
    echo "正在下载桥接服务：${url}"
    if curl -fsSL --connect-timeout 15 --max-time 120 "$url" -o "${TARGET}.tmp"; then
      if is_valid_server "${TARGET}.tmp"; then
        mv -f "${TARGET}.tmp" "${TARGET}"
        OK=1
        break
      fi
      rm -f "${TARGET}.tmp"
      echo "下载内容无效，尝试下一个地址…"
    else
      rm -f "${TARGET}.tmp"
      echo "下载失败，尝试下一个地址…"
    fi
  done
  if [ "$OK" -ne 1 ]; then
    echo ""
    echo "无法获取 server.js（桥接服务主文件）。"
    echo "请回到网页重新下载「完整 ZIP 包」，解压后确保与启动脚本同目录有 server.js，再运行。"
    echo "日志：${LOG_FILE}"
    pause_exit 1
  fi
fi

if ! is_valid_server "${TARGET}"; then
  echo "找不到有效的 server.js：${TARGET}"
  pause_exit 1
fi

cd "${BRIDGE_DIR}" || pause_exit 1
export ADB_BRIDGE_TOKEN="${ADB_BRIDGE_TOKEN:-devtools-adb}"
export ADB_BRIDGE_PORT="${ADB_BRIDGE_PORT:-17888}"
echo "node: $(command -v node)"
echo "adb 版本："
adb version 2>/dev/null | head -n 1 || echo "(adb version 读取失败)"
echo ""
echo "启动桥：${TARGET}"
echo "日志：${LOG_FILE}"
echo ""

node server.js 2>&1 | tee -a "${LOG_FILE}"
CODE=${PIPESTATUS[0]}
echo ""
if [ "$CODE" -ne 0 ]; then
  echo "桥进程退出，代码 ${CODE}。日志：${LOG_FILE}"
  pause_exit "$CODE"
fi
exit 0
