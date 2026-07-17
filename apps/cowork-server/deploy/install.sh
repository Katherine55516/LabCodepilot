#!/usr/bin/env bash
# Cowork 控制面一键部署(R5-3)—— 单公司裸金属服务器。幂等,可重复跑升级。
#
#   sudo ./install.sh                     # 用调用者作为服务用户,assets 默认 /opt/cowork-assets
#   sudo COWORK_ASSETS_DIR=/path ./install.sh
#   sudo COWORK_USER=cowork ./install.sh  # 指定服务用户(须在 docker 组)
#
# 装完:cowork-server.service(宿主 node 控制面)+ cowork-egress.service(出网禁内网防火墙)
# 都 enable+start 且开机自启。首次生成 /opt/cowork-server/.env 并填随机 HMAC 密钥。
set -euo pipefail

DEST=/opt/cowork-server
SRC="$(cd "$(dirname "$0")/.." && pwd)"          # apps/cowork-server
DEPLOY="$SRC/deploy"
COWORK_USER="${COWORK_USER:-${SUDO_USER:-root}}"
ASSETS_DIR="${COWORK_ASSETS_DIR:-/opt/cowork-assets}"

info() { printf '\033[36m[install]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[install]\033[0m %s\n' "$*"; }
die()  { printf '\033[31m[install] ERROR:\033[0m %s\n' "$*" >&2; exit 1; }

# ── root ──
[ "$(id -u)" = 0 ] || die "需 root:sudo $0"

# ── 前置检查 ──
info "前置检查…"
command -v docker  >/dev/null || die "docker 未安装"
docker info >/dev/null 2>&1   || die "docker daemon 不可用(未启动?)"
command -v node    >/dev/null || die "node 未安装"
command -v iptables>/dev/null || die "iptables 未安装(出网防火墙需要)"
# npm 非硬前置:ws 是纯 JS 零依赖,优先从源 node_modules/ws 直拷(裸金属常无可用 npm,
# 且 sudo secure_path 下 npm 的 .js symlink 可能不被识别)。仅两者都缺时才要求 npm。
id "$COWORK_USER" >/dev/null 2>&1 || die "服务用户不存在:$COWORK_USER"
id -nG "$COWORK_USER" | tr ' ' '\n' | grep -qx docker \
  || die "服务用户 $COWORK_USER 不在 docker 组(usermod -aG docker $COWORK_USER 后重登)"
[ -d "$ASSETS_DIR" ] || die "assets 目录不存在:$ASSETS_DIR(放 claude 二进制 + cowork-shim.py)"
[ -x "$ASSETS_DIR/claude" ] || die "缺 $ASSETS_DIR/claude(可执行 claude 二进制)"
[ -f "$ASSETS_DIR/cowork-shim.py" ] || die "缺 $ASSETS_DIR/cowork-shim.py"
info "  docker $(docker --version | awk '{print $3}' | tr -d ,) · node $(node -v) · 用户 $COWORK_USER(docker 组✓) · assets $ASSETS_DIR ✓"

# ── 拷代码 ──
info "部署代码到 $DEST …"
mkdir -p "$DEST"
for item in index.mjs package.json lib container client setup-egress.sh sign-token.mjs deploy; do
  [ -e "$SRC/$item" ] && cp -a "$SRC/$item" "$DEST/"
done
# selftest 也带上(运维自检用)
cp -a "$SRC"/selftest-*.mjs "$DEST/" 2>/dev/null || true

# ── 依赖(ws,纯 JS 无编译)──
if [ ! -d "$DEST/node_modules/ws" ]; then
  if [ -d "$SRC/node_modules/ws" ]; then
    info "拷贝依赖 ws(来自部署源,免 npm)…"
    mkdir -p "$DEST/node_modules"
    cp -a "$SRC/node_modules/ws" "$DEST/node_modules/ws"
  elif command -v npm >/dev/null; then
    info "安装依赖(ws,npm)…"
    ( cd "$DEST" && npm install --omit=dev --no-audit --no-fund >/dev/null ) || die "npm install 失败"
  else
    die "缺依赖 ws 且无 npm:请在有网机 npm i,把 node_modules/ws 随部署源一并拷来"
  fi
fi

# ── .env(首次生成,已存在不覆盖)──
if [ -f "$DEST/.env" ]; then
  warn ".env 已存在,保留(不覆盖密钥)。改配置后 systemctl restart cowork-server"
else
  info "生成 .env(随机 HMAC 密钥)…"
  secret="$(openssl rand -hex 32 2>/dev/null || head -c32 /dev/urandom | od -An -tx1 | tr -d ' \n')"
  [ -n "$secret" ] || die "无法生成随机密钥(openssl/urandom 都不可用)"
  cp "$DEPLOY/.env.example" "$DEST/.env"
  sed -i "s#^COWORK_AUTH_SECRET=.*#COWORK_AUTH_SECRET=$secret#" "$DEST/.env"
  sed -i "s#^COWORK_ASSETS_DIR=.*#COWORK_ASSETS_DIR=$ASSETS_DIR#" "$DEST/.env"
  # 审计落 DEST(WorkingDirectory,COWORK_USER 可写),消除 cwd 歧义
  grep -q '^COWORK_AUDIT_FILE=' "$DEST/.env" || echo "COWORK_AUDIT_FILE=$DEST/cowork-audit.log" >> "$DEST/.env"
  chmod 600 "$DEST/.env"
fi

# ── 属主(含 audit log 可写)──
chown -R "$COWORK_USER":"$COWORK_USER" "$DEST"

# ── systemd units(渲染占位符)──
info "安装 systemd 单元…"
sed -e "s#__DEST__#$DEST#g" -e "s#__COWORK_USER__#$COWORK_USER#g" \
  "$DEPLOY/cowork-server.service" > /etc/systemd/system/cowork-server.service
sed -e "s#__DEST__#$DEST#g" \
  "$DEPLOY/cowork-egress.service" > /etc/systemd/system/cowork-egress.service
systemctl daemon-reload
systemctl enable --now cowork-egress.service
systemctl enable --now cowork-server.service

# ── 验证 ──
sleep 2
port="$(grep -E '^COWORK_SERVER_PORT=' "$DEST/.env" | cut -d= -f2)"; port="${port:-8790}"
info "验证…"
systemctl is-active --quiet cowork-server || { journalctl -u cowork-server -n 20 --no-pager; die "cowork-server 未起来"; }
egress_n="$(iptables -L DOCKER-USER -n 2>/dev/null | grep -c cowork-egress || true)"
health="$(curl -s -m 5 "http://127.0.0.1:$port/health" || true)"

echo
info "✅ 部署完成"
echo "   cowork-server : $(systemctl is-active cowork-server)  (:$port)  health=$health"
echo "   cowork-egress : $(systemctl is-active cowork-egress)  DOCKER-USER 规则 $egress_n 条"
echo
echo "   下一步 —— 签发用户 token(R5-5 前由账号后端用同密钥签,此为运维/联调手动方式):"
echo "     sudo -u $COWORK_USER sh -c 'set -a; . $DEST/.env; node $DEST/sign-token.mjs <userId>'"
echo "   日志:journalctl -u cowork-server -f     停/起:systemctl restart cowork-server"
echo "   TLS(可选):见 $DEST/deploy/docker-compose.tls.yml"
