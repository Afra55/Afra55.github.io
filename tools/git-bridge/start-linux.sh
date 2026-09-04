#!/usr/bin/env bash
# DevTools Git Bridge launcher (Linux)
# Runtime files stay in the same folder as this script.

echo "DevTools Git Bridge 启动中..."
echo "需要本机已安装 Node.js 与 git"
echo ""

export PATH="/usr/local/bin:/usr/bin:/bin:$HOME/.local/bin:$PATH"
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
LOG_FILE="${SCRIPT_DIR}/last-start.log"
{
  echo "==== $(date) ===="
  echo "SCRIPT_DIR=${SCRIPT_DIR}"
  command -v node || true
  command -v git || true
} >"${LOG_FILE}" 2>&1

if ! command -v node >/dev/null 2>&1; then
  echo "未找到 node。请先安装 Node.js：https://nodejs.org/"
  echo "日志：${LOG_FILE}"
  pause_exit 1
fi

if ! command -v git >/dev/null 2>&1; then
  echo "未找到 git。请安装 Git 并确保在 PATH 中。"
  echo "日志：${LOG_FILE}"
  pause_exit 1
fi

TARGET="${SCRIPT_DIR}/server.js"

is_valid_server() {
  local f="$1"
  [ -f "$f" ] && [ -s "$f" ] && grep -q "devtools-git-bridge\|GIT_BRIDGE_TOKEN\|DevTools local Git bridge" "$f" 2>/dev/null
}

if is_valid_server "${TARGET}"; then
  echo "已使用同目录 server.js"
else
  URLS=(
    "${GIT_BRIDGE_BASE_URL:-https://afra55.github.io/tools/git-bridge}/server.js"
    "https://afra55.github.io/tools/git-bridge/server.js"
    "https://raw.githubusercontent.com/Afra55/Afra55.github.io/master/tools/git-bridge/server.js"
  )
  OK=0
  for url in "${URLS[@]}"; do
    echo "正在下载桥接服务：${url}"
    if curl -fsSL --connect-timeout 15 --max-time 120 "$url" -o "${TARGET}.tmp"; then
      if is_valid_server "${TARGET}.tmp"; then
        mv -f "${TARGET}.tmp" "${TARGET}"
        OK=1
        break
      fi
      rm -f "${TARGET}.tmp"
    else
      rm -f "${TARGET}.tmp"
    fi
  done
  if [ "$OK" -ne 1 ]; then
    echo "无法获取 server.js。请下载完整 ZIP 包后重试。"
    pause_exit 1
  fi
fi

OPS_JS="${SCRIPT_DIR}/git-ops.js"
if [ ! -s "${OPS_JS}" ] || ! grep -q "OP_DEFS\|buildOp" "${OPS_JS}" 2>/dev/null; then
  echo "正在下载 git-ops.js …"
  for url in \
    "${GIT_BRIDGE_BASE_URL:-https://afra55.github.io/tools/git-bridge}/git-ops.js" \
    "https://afra55.github.io/tools/git-bridge/git-ops.js" \
    "https://raw.githubusercontent.com/Afra55/Afra55.github.io/master/tools/git-bridge/git-ops.js"
  do
    if curl -fsSL --connect-timeout 15 --max-time 120 "$url" -o "${OPS_JS}.tmp"; then
      if grep -q "OP_DEFS\|buildOp" "${OPS_JS}.tmp" 2>/dev/null; then
        mv -f "${OPS_JS}.tmp" "${OPS_JS}"
        break
      fi
      rm -f "${OPS_JS}.tmp"
    fi
  done
fi
if [ ! -s "${OPS_JS}" ]; then
  echo "缺少 git-ops.js。请重新下载完整包。"
  pause_exit 1
fi

cd "${SCRIPT_DIR}" || pause_exit 1

# 独立 Git 桥已废弃：优先转到上级统一桥（17888，含 /git）
PARENT="$(cd "${SCRIPT_DIR}/.." && pwd)"
if [ -z "${GIT_BRIDGE_FORCE_STANDALONE:-}" ] && [ -f "${PARENT}/start-linux.sh" ]; then
  echo "Git 已并入统一桥。正在启动：${PARENT}/start-linux.sh"
  exec bash "${PARENT}/start-linux.sh" "$@"
fi

export GIT_BRIDGE_TOKEN="${GIT_BRIDGE_TOKEN:-devtools-bridge}"
export GIT_BRIDGE_PORT="${GIT_BRIDGE_PORT:-17888}"
export GIT_BRIDGE_DIR="${SCRIPT_DIR}"
echo "提示：网页只连接统一桥 17888 /git。调试独立模块请设 GIT_BRIDGE_FORCE_STANDALONE=1"

# Register xdg URL handler (best-effort) so webpage can open devtools-git://start
DESKTOP_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$DESKTOP_DIR"
HANDLER="$SCRIPT_DIR/devtools-git-open.sh"
cat > "$HANDLER" <<EOF
#!/usr/bin/env bash
DIR="$SCRIPT_DIR"
cd "\$DIR" || exit 1
export DEVTOOLS_GIT_QUIET=1
if command -v curl >/dev/null 2>&1; then
  if curl -fsS --connect-timeout 1 --max-time 2 "http://127.0.0.1:\${GIT_BRIDGE_PORT:-17888}/health" >/dev/null 2>&1; then
    exit 0
  fi
fi
for s in start-git-bridge.sh start-linux.sh; do
  if [ -f "\$DIR/\$s" ]; then
    nohup bash "\$DIR/\$s" >/dev/null 2>&1 &
    exit 0
  fi
done
exit 1
EOF
chmod +x "$HANDLER"
cat > "$DESKTOP_DIR/devtools-git.desktop" <<EOF
[Desktop Entry]
Name=DevTools Git Bridge
Exec=$HANDLER %u
Type=Application
Terminal=false
MimeType=x-scheme-handler/devtools-git;
NoDisplay=true
EOF
xdg-mime default devtools-git.desktop x-scheme-handler/devtools-git >/dev/null 2>&1 || true
update-desktop-database "$DESKTOP_DIR" >/dev/null 2>&1 || true

echo "启动桥：${TARGET}"
echo "地址 http://127.0.0.1:${GIT_BRIDGE_PORT}  Token: ${GIT_BRIDGE_TOKEN}"
echo ""

set +e
node server.js 2>&1 | tee -a "${LOG_FILE}"
CODE=${PIPESTATUS[0]}
set -e

echo ""
if [ -t 0 ] && [ "${DEVTOOLS_GIT_QUIET:-0}" != "1" ]; then
  read -r -p "按回车关闭..." _
fi
exit "$CODE"
