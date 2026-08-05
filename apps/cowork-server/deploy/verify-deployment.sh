#!/usr/bin/env bash
# 校验「生产上跑的」与「仓库里的」是否一致 —— 部署漂移检测。
#
# 为什么需要它:cowork-server 是 scp/install.sh 推上去的,没有任何机制会告诉你
# 两边分叉了。2026-08-04 手工比对时发现生产落后仓库 3 个文件(其中 OPERATIONS.md
# 缺了「selftest 三个必踩的坑」那段,而那正是运维在服务器上直接读的 runbook)——
# 这类漂移只有主动比才看得见。
#
# 用法:
#   ./deploy/verify-deployment.sh                      # 默认比 cowork-prod:/opt/cowork-server
#   ./deploy/verify-deployment.sh cowork-vm            # 换目标主机(ssh 别名或 user@host)
#   ./deploy/verify-deployment.sh cowork-prod /opt/xx  # 换远端目录
#
# 退出码:0 = 完全一致;1 = 有漂移/缺失(可用于巡检脚本或 CI)。
#
# 刻意只读:全程不写远端、不重启服务。发现漂移后要怎么处理由人判断 ——
# 有些漂移是「仓库领先、等下次部署」,有些是「生产被手工改过」,处理方式相反。

set -uo pipefail

HOST="${1:-cowork-prod}"
REMOTE_DIR="${2:-/opt/cowork-server}"
LOCAL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 不参与比对的东西,分三类:
#   - 密钥/数据:.env(密钥,绝不进 git)、*.log(审计日志)
#   - 部署产物:node_modules、package-lock.json(远端 npm install 生成)
#   - 垃圾:macOS 的 ._* 伴生文件(scp 带过去的)、.bak-*(升级时的备份目录)、.DS_Store
readonly EXCLUDES=(
  -not -path "*/node_modules/*"
  -not -name "._*"
  # .env 及其一切备份变体(.env.bak-*)。只排 ".env" 的话,改配置时留的备份会被报成
  # 「🔺 仅生产有」—— 那是最吓人的一类提示,而它们其实是含密钥的备份、本就不该进 git。
  # 误报会训练人无视这个脚本,而检测工具最怕的就是被无视。
  -not -name ".env*"
  -not -name "*.log"
  -not -path "*/.bak-*"
  -not -name "package-lock.json"
  -not -name ".DS_Store"
  # 本脚本自己:开发机工具,不需要存在于生产。不排掉的话它会被永远报成
  # 「仅仓库有」,几次之后人就开始无视这个脚本的输出了 —— 噪音是检测工具的天敌。
  -not -name "verify-deployment.sh"
)

# md5:Linux 是 md5sum,macOS 是 md5 -r —— 两者输出都是「哈希 空格 文件名」,可统一处理。
# 必须存成命令数组而不是 shell 函数:下面走 `xargs` 调它,而 xargs 只能 exec 真实
# 可执行文件,调不到函数(踩过:清单会静默变成 0 个文件)。
if command -v md5sum >/dev/null 2>&1; then
  MD5_CMD=(md5sum)
elif command -v md5 >/dev/null 2>&1; then
  MD5_CMD=(md5 -r)
else
  echo "错误:本机既没有 md5sum 也没有 md5" >&2
  exit 2
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

echo "═══ 部署漂移检测 ═══"
echo "  仓库: $LOCAL_DIR"
echo "  生产: $HOST:$REMOTE_DIR"
echo "  分支: $(git -C "$LOCAL_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?') @ $(git -C "$LOCAL_DIR" rev-parse --short HEAD 2>/dev/null || echo '?')"
if [ -n "$(git -C "$LOCAL_DIR" status --porcelain -- "$LOCAL_DIR" 2>/dev/null)" ]; then
  echo "  ⚠️  仓库工作区有未提交改动 —— 比对的是工作区内容,不是 HEAD"
fi
echo

# —— 采两侧清单(格式统一为「相对路径 哈希」并排序,供 join/comm)——
( cd "$LOCAL_DIR" && find . -type f "${EXCLUDES[@]}" -print0 \
    | xargs -0 "${MD5_CMD[@]}" 2>/dev/null \
    | sed 's| \./| |' | awk '{print $2" "$1}' | sort
) > "$tmp/repo.md5"

# 空清单 = 采集失败(find/xargs/md5 任一环节坏了),不能当成「仓库是空的」往下走 ——
# 否则会把生产的全部文件误报成「仅生产有」,而那恰恰是最吓人的那一类。
if [ ! -s "$tmp/repo.md5" ]; then
  echo "❌ 仓库侧清单为空 —— 采集失败,不是真的没文件。检查 $LOCAL_DIR 是否存在、md5 是否可用。" >&2
  exit 2
fi

# ⚠️ 远端命令是拼成字符串再交给 ssh 的,所以模式必须**逐个 shell 转义**(%q)——
# 用 %s 的话 `.env*` / `*.log` 这类会先被远端 shell 按它当时的工作目录展开,
# find 拿到的就不是模式而是一串文件名(或匹配不到时的残缺参数),整条命令静默失效。
# 这是原本就埋着的坑:早先的模式恰好在远端家目录匹配不到东西,所以一直没暴露,
# 直到加了 `.env*` 才踩响。
if ! ssh -o BatchMode=yes -o ConnectTimeout=15 "$HOST" \
  "cd '$REMOTE_DIR' 2>/dev/null && find . -type f $(printf '%q ' "${EXCLUDES[@]}") -print0 \
     | xargs -0 md5sum 2>/dev/null | sed 's| \./| |' | awk '{print \$2\" \"\$1}' | sort" \
  > "$tmp/prod.md5" 2>"$tmp/ssh.err"; then
  echo "❌ 连不上 $HOST 或读不到 $REMOTE_DIR:"
  sed 's/^/   /' "$tmp/ssh.err" >&2
  exit 2
fi

echo "  仓库 $(wc -l < "$tmp/repo.md5" | tr -d ' ') 个文件 · 生产 $(wc -l < "$tmp/prod.md5" | tr -d ' ') 个文件"
echo

cut -d' ' -f1 "$tmp/repo.md5" > "$tmp/repo.names"
cut -d' ' -f1 "$tmp/prod.md5" > "$tmp/prod.names"

drift=$(join "$tmp/repo.md5" "$tmp/prod.md5" | awk '$2!=$3 {print $1}')
only_repo=$(comm -23 "$tmp/repo.names" "$tmp/prod.names")
only_prod=$(comm -13 "$tmp/repo.names" "$tmp/prod.names")

rc=0

if [ -n "$drift" ]; then
  echo "⚠️  内容不一致($(echo "$drift" | wc -l | tr -d ' ') 个)—— 先判方向再决定怎么处理:"
  echo "$drift" | sed 's/^/     /'
  echo "     查看差异: ssh $HOST 'cat $REMOTE_DIR/<文件>' | diff - $LOCAL_DIR/<文件>"
  rc=1
fi

if [ -n "$only_repo" ]; then
  echo "⬜ 仅仓库有,未部署到生产($(echo "$only_repo" | wc -l | tr -d ' ') 个):"
  echo "$only_repo" | sed 's/^/     /'
  rc=1
fi

if [ -n "$only_prod" ]; then
  echo "🔺 仅生产有,git 里没有($(echo "$only_prod" | wc -l | tr -d ' ') 个)—— 这类最危险,是"
  echo "   只存在于一台机器上的代码,机器没了就没了:"
  echo "$only_prod" | sed 's/^/     /'
  rc=1
fi

[ $rc -eq 0 ] && echo "✅ 源码完全一致"

# —— 非 git 资产:不进仓库(体积/密钥),但版本必须可追溯,否则重建时无从验证 ——
echo
echo "═══ 非 git 资产(信息,不参与上面的成败判定)═══"
ssh -o BatchMode=yes "$HOST" '
  a=/opt/cowork-assets/claude
  if [ -x "$a" ]; then
    echo "  claude 二进制: $("$a" --version 2>/dev/null | head -1)  sha256=$(sha256sum "$a" | cut -c1-16)…  $(du -h "$a" | cut -f1)"
  else
    echo "  claude 二进制: 缺失(bundled 镜像模式下正常)"
  fi
  echo "  会话镜像:     $(docker images cowork-sandbox --format "{{.Repository}}:{{.Tag}} {{.Size}}" 2>/dev/null | tr "\n" " ")"
  echo "  服务状态:     cowork-server=$(systemctl is-active cowork-server 2>/dev/null) cowork-egress=$(systemctl is-active cowork-egress 2>/dev/null)"
  echo "  出网规则:     $(iptables -S DOCKER-USER 2>/dev/null | grep -c cowork-egress) 条(应为 5)"
' 2>/dev/null || echo "  (取不到 —— 可能需要 root 权限)"

exit $rc
