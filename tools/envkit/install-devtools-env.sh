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
  case "$name" in
    yt-dlp)
      # yt-dlp 更新最快，优先官方渠道
      if have brew; then brew upgrade yt-dlp 2>/dev/null || brew install yt-dlp || true; fi
      if have pipx; then pipx upgrade yt-dlp 2>/dev/null || pipx install yt-dlp || true; fi
      if have pip3; then pip3 install --user -U yt-dlp 2>/dev/null || true; fi
      if have yt-dlp; then
        yt-dlp -U 2>/dev/null || true
      fi
      case "$pm" in
        apt) sudo apt-get install -y --only-upgrade yt-dlp 2>/dev/null || true ;;
        dnf) sudo dnf upgrade -y yt-dlp 2>/dev/null || true ;;
        pacman) sudo pacman -Sy --noconfirm yt-dlp 2>/dev/null || true ;;
      esac
      return 0
      ;;
  esac

  case "$pm" in
    brew)
      case "$name" in
        node) brew update >/dev/null 2>&1 || true; brew upgrade node 2>/dev/null || brew install node ;;
        git) brew upgrade git 2>/dev/null || brew install git ;;
        ffmpeg) brew upgrade ffmpeg 2>/dev/null || brew install ffmpeg ;;
        adb)
          brew upgrade --cask android-platform-tools 2>/dev/null \
            || brew upgrade android-platform-tools 2>/dev/null \
            || brew install --cask android-platform-tools \
            || true
          ;;
      esac
      ;;
    apt)
      sudo apt-get update -y >/dev/null 2>&1 || true
      case "$name" in
        node) sudo apt-get install -y --only-upgrade nodejs npm 2>/dev/null || sudo apt-get install -y nodejs npm ;;
        git) sudo apt-get install -y --only-upgrade git 2>/dev/null || sudo apt-get install -y git ;;
        ffmpeg) sudo apt-get install -y --only-upgrade ffmpeg 2>/dev/null || sudo apt-get install -y ffmpeg ;;
        adb) sudo apt-get install -y --only-upgrade adb 2>/dev/null || sudo apt-get install -y adb ;;
      esac
      ;;
    dnf)
      case "$name" in
        node) sudo dnf upgrade -y nodejs npm 2>/dev/null || sudo dnf install -y nodejs npm ;;
        git) sudo dnf upgrade -y git 2>/dev/null || sudo dnf install -y git ;;
        ffmpeg) sudo dnf upgrade -y ffmpeg 2>/dev/null || sudo dnf install -y ffmpeg ;;
        adb) sudo dnf upgrade -y android-tools 2>/dev/null || sudo dnf install -y android-tools ;;
      esac
      ;;
    pacman)
      case "$name" in
        node) sudo pacman -Sy --noconfirm nodejs npm ;;
        git) sudo pacman -Sy --noconfirm git ;;
        ffmpeg) sudo pacman -Sy --noconfirm ffmpeg ;;
        adb) sudo pacman -Sy --noconfirm android-tools ;;
      esac
      ;;
    *)
      warn "无可用包管理器，无法自动升级 $name（请手动更新）"
      return 1
      ;;
  esac
}

tool_should_skip() {
  case "$1" in
    git) [[ "${DEVTOOLS_SKIP_GIT:-0}" == "1" ]] ;;
    ffmpeg) [[ "${DEVTOOLS_SKIP_FFMPEG:-0}" == "1" ]] ;;
    adb) [[ "${DEVTOOLS_SKIP_ADB:-0}" == "1" ]] ;;
    yt-dlp) [[ "${DEVTOOLS_SKIP_YTDLP:-0}" == "1" ]] ;;
    *) return 1 ;;
  esac
}

snapshot_versions() {
  local name v
  for name in node git ffmpeg adb yt-dlp; do
    v="$(ver_of "$name" || true)"
    if [[ -n "$v" ]]; then printf '%s=%s\n' "$name" "$v"
    else printf '%s=(missing)\n' "$name"
    fi
  done
}

do_upgrade() {
  if [[ "$OS" == "Darwin" ]] && ! have brew; then
    ensure_brew || true
  fi
  if [[ "$OS" == "Darwin" ]] && have brew; then
    info "brew update …"
    brew update || true
  fi

  say ""
  say "== 升级本机工具（Node / Git / FFmpeg / ADB / yt-dlp）+ 桥文件 =="
  local before after name before_v after_v
  before="$(snapshot_versions)"
  say "-- 升级前 --"
  while IFS= read -r line; do info "$line"; done <<<"$before"

  for name in node git ffmpeg adb yt-dlp; do
    if tool_should_skip "$name"; then
      info "跳过 $name（DEVTOOLS_SKIP_*）"
      continue
    fi
    if have "$name"; then
      info "升级 $name …"
      upgrade_one "$name" || warn "$name 升级命令返回非 0（可忽略若版本已最新）"
    else
      info "$name 未安装 → 安装"
      install_one "$name" || warn "$name 安装失败"
    fi
  done

  say ""
  say "== 同步最新桥脚本 =="
  sync_bridges

  after="$(snapshot_versions)"
  say ""
  say "-- 升级后对照 --"
  for name in node git ffmpeg adb yt-dlp; do
    before_v="$(printf '%s\n' "$before" | sed -n "s/^${name}=//p" | head -n1)"
    after_v="$(printf '%s\n' "$after" | sed -n "s/^${name}=//p" | head -n1)"
    if [[ "$before_v" == "$after_v" ]]; then
      ok "$name 未变 · $after_v"
    else
      ok "$name 已更新"
      info "  前: $before_v"
      info "  后: $after_v"
    fi
  done

  mkdir -p "$BRIDGE_DIR"
  {
    echo "upgradedAt=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    echo "---- before ----"
    printf '%s\n' "$before"
    echo "---- after ----"
    printf '%s\n' "$after"
  } >"$BRIDGE_DIR/last-upgrade.log"
  ok "对照已写入 ${BRIDGE_DIR}/last-upgrade.log"
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

  # Git（含 git-ops.js）
  for f in server.js git-ops.js start-linux.sh start-mac.command start-win.bat start-win.cmd; do
    info "git-bridge/$f"
    download_file "${BASE_URL}/git-bridge/$f" "$BRIDGE_DIR/git-bridge/$f" || warn "下载失败 $f"
  done
  chmod +x "$BRIDGE_DIR/git-bridge/start-linux.sh" "$BRIDGE_DIR/git-bridge/start-mac.command" 2>/dev/null || true

  # ADB / FFmpeg 补齐 Windows 启动脚本
  for f in start-win.bat start-win.cmd; do
    download_file "${BASE_URL}/adb-bridge/$f" "$BRIDGE_DIR/adb-bridge/$f" || true
    download_file "${BASE_URL}/ffmpeg-bridge/$f" "$BRIDGE_DIR/ffmpeg-bridge/$f" || true
  done

  # 校验关键文件
  local bad=0
  for f in \
    "$BRIDGE_DIR/adb-bridge/server.js" \
    "$BRIDGE_DIR/ffmpeg-bridge/server.js" \
    "$BRIDGE_DIR/git-bridge/server.js" \
    "$BRIDGE_DIR/git-bridge/git-ops.js"
  do
    if [[ ! -s "$f" ]]; then
      warn "缺失或空文件：$f"
      bad=1
    fi
  done
  if ! grep -q "devtools-git-bridge\|GIT_BRIDGE_TOKEN" "$BRIDGE_DIR/git-bridge/server.js" 2>/dev/null; then
    warn "git-bridge/server.js 内容异常"
    bad=1
  fi
  if ! grep -q "OP_DEFS\|buildOp" "$BRIDGE_DIR/git-bridge/git-ops.js" 2>/dev/null; then
    warn "git-bridge/git-ops.js 内容异常"
    bad=1
  fi
  if [[ "$bad" -eq 0 ]]; then
    ok "关键文件校验通过"
  else
    warn "桥文件校验有问题，请重跑 bridges 或检查网络"
  fi

  # 便捷启动器
  cat >"$BRIDGE_DIR/start-all-hint.txt" <<EOF
DevTools 桥目录：${BRIDGE_DIR}

推荐：
  1) 统一桥（ADB + FFmpeg + yt-dlp）：运行 adb-bridge/start-*.sh|command|cmd
     地址 http://127.0.0.1:17888  Token: devtools-bridge
  2) Git 桥：运行 git-bridge/start-*（需同目录有 server.js + git-ops.js）
     地址 http://127.0.0.1:17890  Token: devtools-git

网页：${BASE_URL%/tools}/tools/#envkit
EOF

  printf '%s\n' "{
  \"updatedAt\": \"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",
  \"baseUrl\": \"${BASE_URL}\",
  \"bridgeDir\": \"${BRIDGE_DIR}\",
  \"ok\": $((1-bad))
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
