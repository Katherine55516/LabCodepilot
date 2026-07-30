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
[ -d "$DIR/skills" ] || die "缺 $DIR/skills(预制 skill 目录)"

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
# 预制 skills(纯 Markdown,无可执行脚本 —— 见 skills/README.md 的选型与 license 说明)
cp -R "$DIR/skills" "$ctx/skills"
# 从 macOS 同步过来时,tar/cp 会把扩展属性写成 AppleDouble 伴生文件(._xxx),
# 连 .DS_Store 一起清掉 —— 否则它们会原样进镜像(2026-07-30 实测中招)。
find "$ctx/skills" \( -name '._*' -o -name '.DS_Store' \) -delete
# 权限在这里定死(Dockerfile 不用 COPY --chmod —— 那需要 BuildKit,legacy builder
# 会直接失败,见 Dockerfile 注释)。两种 builder 都保留源文件权限,故等效。
chmod 755 "$ctx/claude"
chmod 644 "$ctx/cowork-shim.py" "$ctx/cred-proxy.py"
find "$ctx/skills" -type d -exec chmod 755 {} +
find "$ctx/skills" -type f -exec chmod 644 {} +
info "预制 skills:$(find "$DIR/skills" -name SKILL.md | wc -l | tr -d ' ') 个"

info "docker build → cowork-sandbox:$TAG …"
# 构建期 pip 源:默认公网阿里镜像;阿里云服务器上可 COWORK_BUILD_PIP_INDEX 换内网源
# (mirrors.cloud.aliyuncs.com/pypi/simple/)让预装依赖下载走内网零公网带宽。
docker build \
  --build-arg "PIP_INDEX=${COWORK_BUILD_PIP_INDEX:-https://mirrors.aliyun.com/pypi/simple/}" \
  -t "cowork-sandbox:$TAG" -t cowork-sandbox:latest "$ctx"

echo
info "✅ 镜像就绪:"
docker images cowork-sandbox --format '   {{.Repository}}:{{.Tag}}  {{.Size}}  {{.ID}}'
echo
echo "   启用(/opt/cowork-server/.env):"
echo "     COWORK_IMAGE=cowork-sandbox:latest"
echo "     COWORK_IMAGE_BUNDLED=1"
echo "   然后 systemctl restart cowork-server(新会话生效;proxy 容器会在重启时按新镜像重建需先 docker rm -f cowork-proxy)"
