#!/bin/bash
# DevTools FFmpeg Bridge launcher (macOS)

echo "DevTools FFmpeg Bridge 启动中..."
echo "需要本机已安装 Node.js 与 ffmpeg（含 ffprobe）"
echo ""

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1 || true
fi
if [ -s "$HOME/.zshrc" ]; then
  # shellcheck disable=SC1090
  . "$HOME/.zshrc" >/dev/null 2>&1 || true
fi

pause_exit() {
  local code="${1:-1}"
  echo ""
  read -r -p "按回车关闭窗口..." _
  exit "$code"
}

LOG_DIR="${HOME}/.devtools-ffmpeg-bridge"
mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/last-start.log"
{
  echo "==== $(date) ===="
  echo "PATH=$PATH"
  command -v node || true
  command -v ffmpeg || true
  command -v ffprobe || true
} >"${LOG_FILE}" 2>&1

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 node。请先安装 Node.js：https://nodejs.org/"
  echo "日志：${LOG_FILE}"
  pause_exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "未找到 ffmpeg。请安装后重试。"
  echo "macOS 可用：brew install ffmpeg"
  echo "日志：${LOG_FILE}"
  pause_exit 1
fi

BRIDGE_DIR="${HOME}/.devtools-ffmpeg-bridge"
mkdir -p "${BRIDGE_DIR}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET="${BRIDGE_DIR}/server.js"

is_valid_server() {
  local f="$1"
  [ -f "$f" ] && [ -s "$f" ] && grep -q "devtools-ffmpeg-bridge\|FFMPEG_BRIDGE_TOKEN\|DevTools local FFmpeg bridge\|DevTools FFmpeg bridge" "$f" 2>/dev/null
}

if is_valid_server "${SCRIPT_DIR}/server.js"; then
  cp -f "${SCRIPT_DIR}/server.js" "${TARGET}"
  echo "已使用同目录 server.js"
elif is_valid_server "${TARGET}"; then
  echo "已使用本地缓存：${TARGET}"
else
  URLS=(
    "${FFMPEG_BRIDGE_BASE_URL:-https://afra55.github.io/tools/ffmpeg-bridge}/server.js"
    "https://afra55.github.io/tools/ffmpeg-bridge/server.js"
    "https://raw.githubusercontent.com/Afra55/Afra55.github.io/master/tools/ffmpeg-bridge/server.js"
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
    echo "无法获取 server.js。请下载完整 ZIP 包后重试。"
    echo "日志：${LOG_FILE}"
    pause_exit 1
  fi
fi

cd "${BRIDGE_DIR}" || pause_exit 1
export FFMPEG_BRIDGE_TOKEN="${FFMPEG_BRIDGE_TOKEN:-devtools-ffmpeg}"
export FFMPEG_BRIDGE_PORT="${FFMPEG_BRIDGE_PORT:-17889}"
echo "node: $(command -v node)"
echo "ffmpeg："
ffmpeg -version 2>/dev/null | head -n 1 || echo "(ffmpeg version 读取失败)"
echo ""
echo "启动桥：${TARGET}"
echo ""

set +e
node server.js 2>&1 | tee -a "${LOG_FILE}"
CODE=${PIPESTATUS[0]}
set -e

echo ""
if [ "$CODE" -ne 0 ]; then
  echo "桥进程退出，代码 ${CODE}。日志：${LOG_FILE}"
else
  echo "桥已正常退出。"
fi
read -r -p "按回车关闭窗口..." _
exit "$CODE"
