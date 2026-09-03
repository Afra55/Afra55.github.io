#!/bin/bash
# DevTools ADB Bridge launcher (macOS)
# Avoid set -e so errors always pause instead of flashing closed.
# Runtime files stay in the same folder as this script.

echo "DevTools ADB Bridge 启动中..."
echo "使用本工具需要本机已安装 adb，并可用：adb devices"
echo ""

# Finder 双击时 PATH 很短，补上常见安装位置
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$HOME/Library/Android/sdk/platform-tools:$HOME/Android/Sdk/platform-tools:$PATH"
# Prepend newest build-tools (apksigner / aapt)
for sdk in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "$HOME/Library/Android/sdk" "$HOME/Android/Sdk"; do
  [ -n "$sdk" ] || continue
  if [ -d "$sdk/build-tools" ]; then
    newest="$(ls -1 "$sdk/build-tools" 2>/dev/null | sort -V | tail -n 1 || true)"
    if [ -n "$newest" ] && [ -d "$sdk/build-tools/$newest" ]; then
      export PATH="$sdk/build-tools/$newest:$PATH"
      export ANDROID_HOME="${ANDROID_HOME:-$sdk}"
    fi
  fi
done
# Homebrew OpenJDK 常为 keg-only，不会进 /opt/homebrew/bin
for jdk in \
  /opt/homebrew/opt/openjdk \
  /opt/homebrew/opt/openjdk@21 \
  /opt/homebrew/opt/openjdk@17 \
  /usr/local/opt/openjdk \
  /usr/local/opt/openjdk@21 \
  /usr/local/opt/openjdk@17
do
  if [ -d "${jdk}/bin" ]; then
    export PATH="${jdk}/bin:$PATH"
  fi
done
if [ -x /usr/libexec/java_home ]; then
  JH="$(/usr/libexec/java_home 2>/dev/null || true)"
  if [ -n "${JH}" ] && [ -d "${JH}/bin" ]; then
    export JAVA_HOME="${JH}"
    export PATH="${JAVA_HOME}/bin:$PATH"
  fi
fi
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
  echo "若已安装仍提示找不到，请用终端运行本脚本（不要只依赖双击）。"
  echo "日志：${LOG_FILE}"
  pause_exit 1
fi

if ! command -v adb >/dev/null 2>&1; then
  echo "未找到 adb。请安装 Android platform-tools，并确保 adb 在 PATH 中。"
  echo "可用：brew install android-platform-tools"
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
echo "若窗口立刻关掉，请查看日志：${LOG_FILE}"
echo ""

set +e

# Remember install dir for /health and register URL scheme helper (best-effort)
export ADB_BRIDGE_DIR="$SCRIPT_DIR"
PROTOCOL_APP="$SCRIPT_DIR/DevToolsBridge Protocol.app"
if [ ! -d "$PROTOCOL_APP" ]; then
  mkdir -p "$PROTOCOL_APP/Contents/MacOS" "$PROTOCOL_APP/Contents/Resources"
  cat > "$PROTOCOL_APP/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleIdentifier</key><string>io.github.afra55.devtools-bridge</string>
  <key>CFBundleName</key><string>DevToolsBridge</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleURLTypes</key><array><dict>
    <key>CFBundleURLName</key><string>DevTools Bridge</string>
    <key>CFBundleURLSchemes</key><array><string>devtools-bridge</string></array>
  </dict></array>
</dict></plist>
PLIST
  cat > "$PROTOCOL_APP/Contents/MacOS/launch" <<EOF
#!/bin/bash
cd "$SCRIPT_DIR" || exit 1
exec "$SCRIPT_DIR/$(basename "$0")"
EOF
  # Fix: launch should call the .command file by absolute path
  cat > "$PROTOCOL_APP/Contents/MacOS/launch" <<EOF
#!/bin/bash
DIR="$SCRIPT_DIR"
cd "\$DIR" || exit 1
# Re-enter the same start script (ignore URL args)
nohup bash "$SCRIPT_DIR/$(basename "$0")" >/dev/null 2>&1 &
EOF
  # Actually basename of start-mac.command when packaged becomes start-adb-bridge.command
  cat > "$PROTOCOL_APP/Contents/MacOS/launch" <<'EOF'
#!/bin/bash
DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
# App is at $BRIDGE/DevToolsBridge Protocol.app → parent is bridge dir
DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$DIR" || exit 1
for s in start-adb-bridge.command start-mac.command; do
  if [ -x "$DIR/$s" ] || [ -f "$DIR/$s" ]; then
    nohup bash "$DIR/$s" >/dev/null 2>&1 &
    exit 0
  fi
done
exit 1
EOF
  chmod +x "$PROTOCOL_APP/Contents/MacOS/launch"
  # Fix DIR: Contents/MacOS -> ../.. is Contents, ../../.. is app root, ../../../.. is bridge
  cat > "$PROTOCOL_APP/Contents/MacOS/launch" <<'EOF'
#!/bin/bash
DIR="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$DIR" || exit 1
for s in start-adb-bridge.command start-mac.command; do
  if [ -f "$DIR/$s" ]; then
    nohup bash "$DIR/$s" >/dev/null 2>&1 &
    exit 0
  fi
done
exit 1
EOF
  chmod +x "$PROTOCOL_APP/Contents/MacOS/launch"
fi
# Register with Launch Services (best-effort)
if command -v lsregister >/dev/null 2>&1; then
  lsregister -f "$PROTOCOL_APP" >/dev/null 2>&1 || true
elif [ -x "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister" ]; then
  /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "$PROTOCOL_APP" >/dev/null 2>&1 || true
fi


node server.js 2>&1 | tee -a "${LOG_FILE}"
CODE=${PIPESTATUS[0]}
set -e

echo ""
if [ "$CODE" -ne 0 ]; then
  echo "桥进程退出，代码 ${CODE}。请向上滚动查看错误，或打开日志："
  echo "  ${LOG_FILE}"
else
  echo "桥已正常退出。"
fi
read -r -p "按回车关闭窗口..." _
exit "$CODE"
