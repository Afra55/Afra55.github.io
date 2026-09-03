#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
chmod +x "$DIR/upgrade-devtools-env.sh" 2>/dev/null || true
# 若同目录已有完整脚本，优先本地 upgrade（离线友好）；否则走联网拉最新
if [ -f "$DIR/install-devtools-env.sh" ]; then
  chmod +x "$DIR/install-devtools-env.sh" 2>/dev/null || true
  exec "$DIR/install-devtools-env.sh" upgrade
fi
exec "$DIR/upgrade-devtools-env.sh"
