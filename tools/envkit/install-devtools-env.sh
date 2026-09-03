#!/usr/bin/env bash
# DevTools EnvKit — 一键检测 / 安装 / 升级本机依赖与桥文件
# 用法：
#   ./install-devtools-env.sh              # 等同 install
#   ./install-devtools-env.sh check        # 只检测，不安装
#   ./install-devtools-env.sh install      # 缺啥装啥 + 同步桥文件
#   ./install-devtools-env.sh upgrade      # 升级已装工具 + 同步桥文件
#   ./install-devtools-env.sh bridges      # 只下载/更新桥脚本
#
# 环境变量：
#   DEVTOOLS_BRIDGE_DIR  桥文件目录（默认 ~/DevToolsBridges）
#   DEVTOOLS_BASE_URL    静态资源根（默认 https://afra55.github.io/tools）
#   DEVTOOLS_SKIP_ADB=1  跳过 ADB
#   DEVTOOLS_SKIP_FFMPEG=1
#   DEVTOOLS_SKIP_YTDLP=1
#   DEVTOOLS_SKIP_GIT=1

set -u

MODE="${1:-install}"
BASE_URL="${DEVTOOLS_BASE_URL:-https://afra55.github.io/tools}"
BRIDGE_DIR="${DEVTOOLS_BRIDGE_DIR:-$HOME/DevToolsBridges}"
OS="$(uname -s 2>/dev/null || echo unknown)"

have() { command -v "$1" >/dev/null 2>&1; }

say() { printf '%s\n' "$*"; }
ok() { printf '  [OK]   %s\n' "$*"; }
miss() { printf '  [缺]   %s\n' "$*"; }
info() { printf '  [..]   %s\n' "$*"; }
warn() { printf '  [!]    %s\n' "$*"; }

ver_of() {
  local bin="$1"
  if ! have "$bin"; then
    echo ""
    return 1
  fi
  case "$bin" in
    node) node -v 2>/dev/null | tr -d '\r' ;;
    git) git --version 2>/dev/null | tr -d '\r' ;;
    ffmpeg) ffmpeg -version 2>/dev/null | head -n1 | tr -d '\r' ;;
    adb) adb version 2>/dev/null | head -n1 | tr -d '\r' ;;
    yt-dlp) yt-dlp --version 2>/dev/null | tr -d '\r' ;;
    brew) brew --version 2>/dev/null | head -n1 | tr -d '\r' ;;
    *) "$bin" --version 2>/dev/null | head -n1 | tr -d '\r' ;;
  esac
}

detect_pm() {
  if [[ "$OS" == "Darwin" ]]; then
    if have brew; then echo brew; else echo none; fi
    return
  fi
  if have apt-get; then echo apt
  elif have dnf; then echo dnf
  elif have pacman; then echo pacman
  elif have zypper; then echo zypper
  elif have brew; then echo brew
  else echo none
  fi
}

ensure_brew() {
  if have brew; then return 0; fi
  say "未找到 Homebrew，正在安装（需要网络，约几分钟）…"
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
  have brew
}

install_one() {
  local name="$1"
  local pm
  pm="$(detect_pm)"
  case "$name" in
    node)
      case "$pm" in
        brew) brew install node ;;
        apt) sudo apt-get update -y && sudo apt-get install -y nodejs npm ;;
        dnf) sudo dnf install -y nodejs npm ;;
        pacman) sudo pacman -Sy --noconfirm nodejs npm ;;
        *) warn "请手动安装 Node.js：https://nodejs.org/"; return 1 ;;
      esac
      ;;
    git)
      case "$pm" in
        brew) brew install git ;;
        apt) sudo apt-get update -y && sudo apt-get install -y git ;;
        dnf) sudo dnf install -y git ;;
        pacman) sudo pacman -Sy --noconfirm git ;;
        *) warn "请手动安装 git"; return 1 ;;
      esac
      ;;
    ffmpeg)
      case "$pm" in
        brew) brew install ffmpeg ;;
        apt) sudo apt-get update -y && sudo apt-get install -y ffmpeg ;;
        dnf) sudo dnf install -y ffmpeg ;;
        pacman) sudo pacman -Sy --noconfirm ffmpeg ;;
        *) warn "请手动安装 ffmpeg"; return 1 ;;
      esac
      ;;
    adb)
      case "$pm" in
        brew) brew install --cask android-platform-tools ;;
        apt) sudo apt-get update -y && sudo apt-get install -y adb ;;
        dnf) sudo dnf install -y android-tools ;;
        pacman) sudo pacman -Sy --noconfirm android-tools ;;
        *) warn "请手动安装 platform-tools：https://developer.android.com/tools/releases/platform-tools"; return 1 ;;
      esac
      ;;
    yt-dlp)
      case "$pm" in
        brew) brew install yt-dlp ;;
        apt)
          if have pipx; then pipx install yt-dlp
          elif have pip3; then pip3 install --user -U yt-dlp
          else sudo apt-get update -y && sudo apt-get install -y yt-dlp || warn "请 pipx/pip 安装 yt-dlp"
          fi
          ;;
        dnf) sudo dnf install -y yt-dlp || (have pip3 && pip3 install --user -U yt-dlp) ;;
        pacman) sudo pacman -Sy --noconfirm yt-dlp ;;
        *)
          if have pipx; then pipx install yt-dlp
          elif have pip3; then pip3 install --user -U yt-dlp
          else warn "请手动安装 yt-dlp"; return 1
          fi
          ;;
      esac
      ;;
  esac
}

upgrade_one() {
  local name="$1"
  local pm
  pm="$(detect_pm)"
  case "$pm" in
    brew)
      case "$name" in
        adb) brew upgrade --cask android-platform-tools 2>/dev/null || brew upgrade android-platform-tools 2>/dev/null || true ;;
        *) brew upgrade "$name" 2>/dev/null || true ;;
      esac
      ;;
    apt)
      case "$name" in
        node) sudo apt-get install -y --only-upgrade nodejs npm ;;
        adb) sudo apt-get install -y --only-upgrade adb ;;
        yt-dlp)
          if have pipx; then pipx upgrade yt-dlp
          elif have pip3; then pip3 install --user -U yt-dlp
          else sudo apt-get install -y --only-upgrade yt-dlp || true
          fi
          ;;
        *) sudo apt-get install -y --only-upgrade "$name" || true ;;
      esac
      ;;
    *)
      if [[ "$name" == "yt-dlp" ]]; then
        if have pipx; then pipx upgrade yt-dlp
        elif have pip3; then pip3 install --user -U yt-dlp
        fi
      else
        info "当前包管理器不支持自动升级 $name，跳过"
      fi
      ;;
  esac
}

download_file() {
  local url="$1"
  local dest="$2"
  mkdir -p "$(dirname "$dest")"
  if have curl; then
    curl -fsSL --connect-timeout 20 --max-time 180 "$url" -o "$dest.tmp" && mv -f "$dest.tmp" "$dest"
  elif have wget; then
    wget -q -O "$dest.tmp" "$url" && mv -f "$dest.tmp" "$dest"
  else
    warn "需要 curl 或 wget 才能下载桥文件"
    return 1
  fi
}

sync_bridges() {
  say ""
  say "== 同步本机桥文件 → ${BRIDGE_DIR} =="
  mkdir -p "$BRIDGE_DIR/adb-bridge" "$BRIDGE_DIR/ffmpeg-bridge" "$BRIDGE_DIR/git-bridge"

  # ADB 统一桥核心文件
  local adb_files=(server.js resolve-port.js scrcpy-mirror.js scrcpy-ctrl.js everything-proxy.js device-inspect.js)
  for f in "${adb_files[@]}"; do
    info "adb-bridge/$f"
    download_file "${BASE_URL}/adb-bridge/$f" "$BRIDGE_DIR/adb-bridge/$f" || warn "下载失败 $f"
  done
  download_file "${BASE_URL}/adb-bridge/start-linux.sh" "$BRIDGE_DIR/adb-bridge/start-linux.sh" || true
  download_file "${BASE_URL}/adb-bridge/start-mac.command" "$BRIDGE_DIR/adb-bridge/start-mac.command" || true
  chmod +x "$BRIDGE_DIR/adb-bridge/start-linux.sh" "$BRIDGE_DIR/adb-bridge/start-mac.command" 2>/dev/null || true

  # FFmpeg / yt-dlp
  for f in server.js ytdlp-core.js start-linux.sh start-mac.command; do
    info "ffmpeg-bridge/$f"
    download_file "${BASE_URL}/ffmpeg-bridge/$f" "$BRIDGE_DIR/ffmpeg-bridge/$f" || warn "下载失败 $f"
  done
  chmod +x "$BRIDGE_DIR/ffmpeg-bridge/start-linux.sh" "$BRIDGE_DIR/ffmpeg-bridge/start-mac.command" 2>/dev/null || true

  # Git
  for f in server.js start-linux.sh start-mac.command; do
    info "git-bridge/$f"
    download_file "${BASE_URL}/git-bridge/$f" "$BRIDGE_DIR/git-bridge/$f" || warn "下载失败 $f"
  done
  chmod +x "$BRIDGE_DIR/git-bridge/start-linux.sh" "$BRIDGE_DIR/git-bridge/start-mac.command" 2>/dev/null || true

  # 便捷启动器
  cat >"$BRIDGE_DIR/start-all-hint.txt" <<EOF
DevTools 桥目录：${BRIDGE_DIR}

推荐：
  1) 统一桥（ADB + FFmpeg + yt-dlp）：运行 adb-bridge/start-*.sh|command
     地址 http://127.0.0.1:17888  Token: devtools-bridge
  2) Git 桥：运行 git-bridge/start-*.sh|command
     地址 http://127.0.0.1:17890  Token: devtools-git

网页：${BASE_URL%/tools}/tools/#envkit
EOF

  printf '%s\n' "{
  \"updatedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
  \"baseUrl\": \"${BASE_URL}\",
  \"bridgeDir\": \"${BRIDGE_DIR}\"
}" >"$BRIDGE_DIR/envkit-state.json"

  ok "桥文件已同步到 ${BRIDGE_DIR}"
}

print_report() {
  say ""
  say "== 本机工具检测 =="
  local items=(node git ffmpeg adb yt-dlp)
  local name v
  for name in "${items[@]}"; do
    v="$(ver_of "$name" || true)"
    if [[ -n "$v" ]]; then ok "$name · $v"
    else miss "$name 未安装"
    fi
  done
  say ""
  say "包管理器：$(detect_pm) · 系统：$OS"
  say "桥目录：${BRIDGE_DIR}"
}

need_install_list() {
  local out=()
  have node || out+=(node)
  [[ "${DEVTOOLS_SKIP_GIT:-0}" == "1" ]] || have git || out+=(git)
  [[ "${DEVTOOLS_SKIP_FFMPEG:-0}" == "1" ]] || have ffmpeg || out+=(ffmpeg)
  [[ "${DEVTOOLS_SKIP_ADB:-0}" == "1" ]] || have adb || out+=(adb)
  [[ "${DEVTOOLS_SKIP_YTDLP:-0}" == "1" ]] || have yt-dlp || out+=(yt-dlp)
  printf '%s\n' "${out[@]+"${out[@]}"}"
}

do_install() {
  if [[ "$OS" == "Darwin" ]]; then
    ensure_brew || warn "Homebrew 安装失败，后续可能只能手动装"
  fi
  local missing
  missing="$(need_install_list)"
  if [[ -z "${missing//[$'\n']/}" ]]; then
    ok "依赖都已存在，跳过安装"
  else
    say ""
    say "== 安装缺失依赖 =="
    while IFS= read -r name; do
      [[ -z "$name" ]] && continue
      info "安装 $name …"
      install_one "$name" && ok "$name 完成" || warn "$name 失败"
    done <<<"$missing"
  fi
  sync_bridges
}

do_upgrade() {
  if [[ "$OS" == "Darwin" ]] && ! have brew; then
    ensure_brew || true
  fi
  say ""
  say "== 升级已安装工具 =="
  local name
  for name in node git ffmpeg adb yt-dlp; do
    if have "$name" || { [[ "$name" == "adb" ]] && have adb; }; then
      info "升级 $name …"
      upgrade_one "$name"
      ok "$name · $(ver_of "$name" 2>/dev/null || echo 已尝试)"
    else
      info "$name 未安装，改走安装"
      install_one "$name" || true
    fi
  done
  sync_bridges
}

main() {
  say "DevTools EnvKit"
  say "模式：$MODE"
  print_report
  case "$MODE" in
    check|status) ;;
    install|fix) do_install; print_report ;;
    upgrade|update) do_upgrade; print_report ;;
    bridges|bridge) sync_bridges ;;
    *)
      say "未知模式：$MODE（check|install|upgrade|bridges）"
      exit 2
      ;;
  esac
  say ""
  say "下一步："
  say "  1. 启动 ${BRIDGE_DIR}/adb-bridge 与/或 git-bridge 启动脚本"
  say "  2. 打开网页 ${BASE_URL%/tools}/tools/#envkit 查看桥在线状态"
}

main
