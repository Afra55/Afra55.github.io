#!/usr/bin/env bash
# DevTools ADB Bridge launcher (Linux)
# Do not use set -e for the whole script — always show errors before exit.
# Runtime files stay in the same folder as this script.

echo "DevTools ADB Bridge 启动中..."
echo "使用本工具需要本机已安装 adb，并可用：adb devices"
echo ""

export PATH="$HOME/Android/Sdk/platform-tools:/usr/local/bin:/usr/bin:$PATH"
# Prepend newest build-tools (apksigner / aapt) when SDK is present
for sdk in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "$HOME/Android/Sdk"; do
  [ -n "$sdk" ] || continue
  if [ -d "$sdk/build-tools" ]; then
    newest="$(ls -1 "$sdk/build-tools" 2>/dev/null | sort -V | tail -n 1 || true)"
    if [ -n "$newest" ] && [ -d "$sdk/build-tools/$newest" ]; then
      export PATH="$sdk/build-tools/$newest:$PATH"
      export ANDROID_HOME="${ANDROID_HOME:-$sdk}"
    fi
  fi
done
# Debian/Ubuntu OpenJDK 与常见自装路径
for jdk in /usr/lib/jvm/default-java /usr/lib/jvm/java-21-openjdk-amd64 /usr/lib/jvm/java-17-openjdk-amd64; do
  if [ -d "${jdk}/bin" ]; then
    export JAVA_HOME="${JAVA_HOME:-$jdk}"
    export PATH="${jdk}/bin:$PATH"
  fi
done
if [ -n "${JAVA_HOME}" ] && [ -d "${JAVA_HOME}/bin" ]; then
  export PATH="${JAVA_HOME}/bin:$PATH"
fi
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

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
BRIDGE_DIR="${SCRIPT_DIR}"
LOG_FILE="${SCRIPT_DIR}/last-start.log"
{
  echo "==== $(date) ===="
  echo "SCRIPT_DIR=${SCRIPT_DIR}"
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

TARGET="${SCRIPT_DIR}/server.js"

is_valid_server() {
  local f="$1"
  [ -f "$f" ] && [ -s "$f" ] && grep -q "devtools-adb-bridge\|ADB_BRIDGE_TOKEN\|DevTools local ADB bridge\|devtools-bridge\|统一本机桥" "$f" 2>/dev/null
}

download_mirror_js() {
  local out="$1"
  local urls=(
    "${ADB_BRIDGE_BASE_URL:-https://afra55.github.io/tools/adb-bridge}/scrcpy-mirror.js"
    "https://afra55.github.io/tools/adb-bridge/scrcpy-mirror.js"
    "https://raw.githubusercontent.com/Afra55/Afra55.github.io/master/tools/adb-bridge/scrcpy-mirror.js"
  )
  for url in "${urls[@]}"; do
    echo "正在下载 scrcpy-mirror.js：${url}"
    if curl -fsSL --connect-timeout 15 --max-time 120 "$url" -o "${out}.tmp"; then
      if [ -s "${out}.tmp" ] && grep -q "module.exports\|scrcpy" "${out}.tmp" 2>/dev/null; then
        mv -f "${out}.tmp" "$out"
        return 0
      fi
      rm -f "${out}.tmp"
    fi
  done
  return 1
}

if is_valid_server "${TARGET}"; then
  echo "已使用同目录 server.js"
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

if [ ! -f "${SCRIPT_DIR}/scrcpy-mirror.js" ]; then
  download_mirror_js "${SCRIPT_DIR}/scrcpy-mirror.js" || {
    echo "无法获取 scrcpy-mirror.js。请重新下载完整 ZIP 包。"
    pause_exit 1
  }
fi

cd "${BRIDGE_DIR}" || pause_exit 1
export ADB_BRIDGE_TOKEN="${ADB_BRIDGE_TOKEN:-devtools-bridge}"
export ADB_BRIDGE_DIR="${BRIDGE_DIR}"

RESOLVE_SCRIPT="${SCRIPT_DIR}/resolve-port.js"
if [ -f "${RESOLVE_SCRIPT}" ]; then
  echo "检查端口是否可用…"
  RESOLVE_OUT="$(node "${RESOLVE_SCRIPT}")" || pause_exit $?
  PORT_MODE="${RESOLVE_OUT%% *}"
  RESOLVED_PORT="${RESOLVE_OUT#* }"
  if [ "${PORT_MODE}" = "ALREADY" ]; then
    echo "本机桥已在端口 ${RESOLVED_PORT:-17888} 运行，无需重复启动。"
    echo "请保持已打开的窗口，回到网页点「连接」。"
    exit 0
  fi
  export ADB_BRIDGE_PORT="${RESOLVED_PORT:-17888}"
else
  export ADB_BRIDGE_PORT="${ADB_BRIDGE_PORT:-17888}"
fi
echo "桥端口：${ADB_BRIDGE_PORT}"
echo "node: $(command -v node)"
echo "adb 版本："
adb version 2>/dev/null | head -n 1 || echo "(adb version 读取失败)"
echo ""
echo "启动桥：${TARGET}"
echo "日志：${LOG_FILE}"
echo ""


export ADB_BRIDGE_DIR="$SCRIPT_DIR"
# Register xdg URL handler (best-effort) so webpage can open devtools-bridge://start
DESKTOP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$DESKTOP_DIR"
HANDLER="$SCRIPT_DIR/devtools-bridge-open.sh"
cat > "$HANDLER" <<EOF
#!/usr/bin/env bash
DIR="$SCRIPT_DIR"
cd "\$DIR" || exit 1
if command -v curl >/dev/null 2>&1; then
  if curl -fsS --connect-timeout 1 --max-time 2 "http://127.0.0.1:17888/health" >/dev/null 2>&1; then
    exit 0
  fi
fi
for s in start-adb-bridge.sh start-linux.sh; do
  if [ -f "\$DIR/\$s" ]; then
    nohup bash "\$DIR/\$s" >/dev/null 2>&1 &
    exit 0
  fi
done
exit 1
EOF
chmod +x "$HANDLER"
cat > "$DESKTOP_DIR/devtools-bridge.desktop" <<EOF
[Desktop Entry]
Name=DevTools Bridge
Exec=$HANDLER %u
Type=Application
Terminal=false
MimeType=x-scheme-handler/devtools-bridge;
NoDisplay=true
EOF
xdg-mime default devtools-bridge.desktop x-scheme-handler/devtools-bridge >/dev/null 2>&1 || true
update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true


node server.js 2>&1 | tee -a "${LOG_FILE}"
CODE=${PIPESTATUS[0]}
echo ""
if [ "$CODE" -ne 0 ]; then
  echo "桥进程退出，代码 ${CODE}。日志：${LOG_FILE}"
  pause_exit "$CODE"
fi
exit 0
