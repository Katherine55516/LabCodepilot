#!/bin/zsh
set -eu
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd)"
cd "$SCRIPT_DIR/../.."
NODE_BIN="${PPT_NODE_BIN:-$HOME/.nvm/versions/node/v22.22.0/bin/node}"
if [[ ! -x "$NODE_BIN" ]]; then
  NODE_BIN="$(command -v node || true)"
fi
if [[ -z "$NODE_BIN" || ! -x "$NODE_BIN" ]]; then
  print -u2 "需要 Node.js 22 或更新版本；可通过 PPT_NODE_BIN 指定 Node 路径。"
  exit 1
fi
exec "$NODE_BIN" --import tsx "$SCRIPT_DIR/manual-test-launcher.mjs" "$@"
