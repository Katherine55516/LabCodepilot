#!/bin/bash
# Cowork POC — Step B 跨界转发器。
#
# SDK 把本脚本当 claude 可执行文件 spawn;本脚本把 SDK 给的 argv 原样转义、
# 把 ANTHROPIC_*/CLAUDE_* 白名单 env 过河,经 SSH 在 VM 内 ~/workspace 下
# 运行 linux 版 claude,stdin/stdout/stderr 逐字节透传。
# 生产形态会换成 vsock + guest-daemon;SSH 仅为 POC 最短路径。
set -uo pipefail

POC="$HOME/.codepilot/cowork-poc"
VM_IP="$(cat "$POC/vm-ip" 2>/dev/null || true)"
if [ -z "$VM_IP" ]; then
  echo "[forwarder-ssh] no vm-ip; run vm-up.sh start first" >&2
  exit 127
fi

# 白名单 env 过河(printf %q 防注入;不透传宿主 HOME/PATH 等)
ENV_PREFIX=()
while IFS='=' read -r k v; do
  case "$k" in
    ANTHROPIC_*|CLAUDE_*|API_TIMEOUT_MS|HTTP_PROXY|HTTPS_PROXY|NO_PROXY)
      ENV_PREFIX+=("$k=$v");;
  esac
done < <(env)

# argv 逐参转义(模型名含 [1m] 等 shell 元字符,必须 %q)
QUOTED_ARGS=""
for a in "$@"; do
  QUOTED_ARGS+=" $(printf '%q' "$a")"
done
QUOTED_ENV=""
for e in "${ENV_PREFIX[@]}"; do
  QUOTED_ENV+=" $(printf '%q' "$e")"
done

echo "$(date -u +%FT%TZ) ssh-exec argc=$# ip=$VM_IP" >> /tmp/cowork-poc-forwarder.log

exec ssh -i "$POC/ssh/id_ed25519" \
  -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR \
  -o ServerAliveInterval=15 -o ExitOnForwardFailure=yes \
  "agent@$VM_IP" \
  "cd ~/workspace && exec env$QUOTED_ENV ~/bin/claude$QUOTED_ARGS"
