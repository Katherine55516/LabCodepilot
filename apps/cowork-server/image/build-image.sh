#!/usr/bin/env bash
# 构建 Cowork 自建会话镜像(claude + shim + cred-proxy 烘入,见 Dockerfile 头注)。
#
#   ./build-image.sh [assets目录]        # 默认 /opt/cowork-assets;claude 二进制从这里取
#   COWORK_IMAGE_TAG=xxx ./build-image.sh  # 覆盖 tag(默认取 claude --version,取不到用日期)
#
# 产出:cowork-sandbox:<tag> + cowork-sandbox:latest。
# 构建完启用:/opt/cowork-server/.env 设 COWORK_IMAGE=cowork-sandbox:latest 与
# COWORK_IMAGE_BUNDLED=1,systemctl restart cowork-server(存量会话容器仍是旧镜像,
# TTL 回收/删除后新建的才用新镜像;强制全量切换 = 先 reconcile 清空)。
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"           # apps/cowork-server/image
SRV="$(cd "$DIR/.." && pwd)"                   # apps/cowork-server
ASSETS_DIR="${1:-/opt/cowork-assets}"

info() { printf '\033[36m[build-image]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[build-image] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "docker 未安装"
[ -x "$ASSETS_DIR/claude" ] || die "缺 $ASSETS_DIR/claude(可执行 claude 二进制);用法: $0 <assets目录>"
[ -f "$SRV/container/cowork-shim.py" ] || die "缺 $SRV/container/cowork-shim.py(在部署目录/仓库下跑本脚本)"
[ -f "$SRV/container/cred-proxy.py" ] || die "缺 $SRV/container/cred-proxy.py"

# tag:优先 claude --version(同架构宿主可直接执行;失败回退日期)
TAG="${COWORK_IMAGE_TAG:-}"
if [ -z "$TAG" ]; then
  ver="$("$ASSETS_DIR/claude" --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)"
  TAG="${ver:-$(date +%Y%m%d)}"
fi

ctx="$(mktemp -d)"
trap 'rm -rf "$ctx"' EXIT
info "组装 build context(claude $(du -h "$ASSETS_DIR/claude" | cut -f1)+ shim + cred-proxy)…"
cp "$ASSETS_DIR/claude" "$ctx/claude"
cp "$SRV/container/cowork-shim.py" "$ctx/cowork-shim.py"
cp "$SRV/container/cred-proxy.py" "$ctx/cred-proxy.py"
cp "$DIR/Dockerfile" "$ctx/Dockerfile"

info "docker build → cowork-sandbox:$TAG …"
docker build -t "cowork-sandbox:$TAG" -t cowork-sandbox:latest "$ctx"

echo
info "✅ 镜像就绪:"
docker images cowork-sandbox --format '   {{.Repository}}:{{.Tag}}  {{.Size}}  {{.ID}}'
echo
echo "   启用(/opt/cowork-server/.env):"
echo "     COWORK_IMAGE=cowork-sandbox:latest"
echo "     COWORK_IMAGE_BUNDLED=1"
echo "   然后 systemctl restart cowork-server(新会话生效;proxy 容器会在重启时按新镜像重建需先 docker rm -f cowork-proxy)"
