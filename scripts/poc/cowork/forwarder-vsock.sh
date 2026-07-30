#!/bin/bash
# Cowork 沙箱 P1-C — exec 转发器的 bash 包装。
#
# SDK 把本脚本当 claude 可执行文件 spawn。它用宿主已知可用的 node
# (COWORK_NODE_BIN,由 claude-client 注入 = next-server 的 process.execPath;
# 打包版是 Electron,靠 ELECTRON_RUN_AS_NODE=1 当纯 node 跑)执行同目录的
# forwarder-vsock.mjs。这样不依赖 PATH 里有 node —— 打包版 Electron 应用里
# 通常没有独立 node。
DIR="$(cd "$(dirname "$0")" && pwd)"
exec "${COWORK_NODE_BIN:-node}" "$DIR/forwarder-vsock.mjs" "$@"
