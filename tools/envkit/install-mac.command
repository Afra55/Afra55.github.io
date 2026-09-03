#!/bin/bash
# macOS / Linux 双击入口 → 默认 install
DIR="$(cd "$(dirname "$0")" && pwd)"
chmod +x "$DIR/install-devtools-env.sh" 2>/dev/null || true
exec "$DIR/install-devtools-env.sh" "${1:-install}"
