#!/bin/bash
# Cowork POC — 用 vfkit 启动 Debian VM(EFI 引导 + NAT + cloud-init seed)。
# 资产目录:~/.codepilot/cowork-poc(镜像/seed/SSH 密钥,见 README.md)
# 用法: vm-up.sh [start|stop|ip|ssh]
set -euo pipefail

# M3 资产目录正式化:应用已把 cowork-poc 迁移为 cowork-assets;老目录兜底兼容
POC="$HOME/.codepilot/cowork-assets"
[ -d "$POC" ] || POC="$HOME/.codepilot/cowork-poc"
DISK="$POC/images/debian-12-genericcloud-arm64.raw"
SEED="$POC/images/seed.iso"
EFI_STORE="$POC/efi-variable-store"
MAC="72:20:43:d4:38:62"
PIDFILE="$POC/vfkit.pid"
LOG="$POC/vm-console.log"
SSH_OPTS=(-i "$POC/ssh/id_ed25519" -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o LogLevel=ERROR -o ConnectTimeout=5)

vm_ip() {
  # vmnet NAT 的 DHCP 租约表按 guest hostname(cloud-init 设的 local-hostname)反查 IP。
  # 不按 MAC:macOS vmnet 的 hw_address 用 DHCP client-id 格式,与 --device mac= 不一致。
  awk '
    /^\{/ { ip=""; nm="" }
    /ip_address=/ { split($0,a,"="); ip=a[2] }
    /name=/ { split($0,a,"="); nm=a[2] }
    /^\}/ { if (nm == "cowork-poc") print ip }
  ' /var/db/dhcpd_leases 2>/dev/null | tail -1
}

case "${1:-start}" in
  start)
    [ -f "$DISK" ] || { echo "missing disk image: $DISK"; exit 1; }
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "already running pid=$(cat "$PIDFILE")"; exit 0
    fi
    rm -f "$POC/vsock-1024.sock"
    nohup vfkit \
      --cpus 2 --memory 2048 \
      --bootloader "efi,variable-store=$EFI_STORE,create" \
      --device "virtio-blk,path=$DISK" \
      --device "virtio-blk,path=$SEED" \
      --device "virtio-net,nat,mac=$MAC" \
      --device "virtio-serial,logFilePath=$LOG" \
      --device virtio-rng \
      --device "virtio-vsock,port=1024,socketURL=$POC/vsock-1024.sock,connect" \
      --restful-uri tcp://127.0.0.1:47899 \
      >"$POC/vfkit.out" 2>&1 &
    echo $! > "$PIDFILE"
    echo "vfkit started pid=$!"
    for i in $(seq 1 60); do
      IP=$(vm_ip)
      if [ -n "$IP" ] && ssh "${SSH_OPTS[@]}" "agent@$IP" true 2>/dev/null; then
        echo "$IP" > "$POC/vm-ip"
        echo "VM ready: agent@$IP  (console log: $LOG)"
        exit 0
      fi
      sleep 2
    done
    echo "VM did not become SSH-ready in 120s; check $LOG"; exit 1
    ;;
  stop)
    [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null && rm -f "$PIDFILE" && echo stopped || echo "not running"
    ;;
  ip) vm_ip ;;
  ssh) exec ssh "${SSH_OPTS[@]}" "agent@$(cat "$POC/vm-ip")" "${@:2}" ;;
  *) echo "usage: vm-up.sh [start|stop|ip|ssh]"; exit 2 ;;
esac
