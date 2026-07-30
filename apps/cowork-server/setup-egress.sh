#!/bin/sh
# R4 出网禁内网 —— 阻断办公沙箱会话容器访问公司内网(防不可信 agent 内网横移),
# 放行公网 + 会话容器→cred-proxy(同网络内部)。部署时以 root 跑一次(建议 systemd
# 开机自启,幂等可重复跑)。cowork-server 本身不需要 NET_ADMIN。
#
# 匹配对象:cowork-net 的固定网桥 cowork0(orchestrator/cred-proxy 建网时
# --opt com.docker.network.bridge.name=cowork0)。规则挂 DOCKER-USER 链(docker 保证
# 它在所有容器转发规则之前生效,重启 docker 也不被冲掉)。
#
# 顺序(DOCKER-USER 链自顶向下):
#   1) cowork0 ↔ cowork0 内部互通 RETURN(容器↔cred-proxy 必须通)
#   2) cowork0 出站 → 私网四段 REJECT(10/8、172.16/12、192.168/16、169.254/16 link-local)
#   3) 其余(公网)落到 DOCKER-USER 末尾 RETURN,放行
#
# 若真 API(cred-proxy 转发目标)在内网而非公网,在第 1 条之后追加一条
#   iptables -I DOCKER-USER 2 -i cowork0 -d <真API/内网段> -m comment --comment cowork-egress -j RETURN
# 放行该地址(cred-proxy 是可信组件)。默认假设真 API 在公网。
set -e

BR="${COWORK_NET_BRIDGE:-cowork0}"
TAG="cowork-egress"
IPT="${IPTABLES:-iptables}"

if ! "$IPT" -L DOCKER-USER -n >/dev/null 2>&1; then
  echo "[setup-egress] DOCKER-USER chain missing — is docker running with iptables enabled?" >&2
  exit 1
fi

# 幂等:先删本脚本装过的所有规则(按 comment 标记),再重装
while "$IPT" -L DOCKER-USER -n --line-numbers | grep -q "$TAG"; do
  line=$("$IPT" -L DOCKER-USER -n --line-numbers | grep "$TAG" | head -1 | awk '{print $1}')
  "$IPT" -D DOCKER-USER "$line"
done

# 倒序 -I(每次插到最前)→ 最终顺序:内部 RETURN 在最前,随后 4 条私网 REJECT
"$IPT" -I DOCKER-USER 1 -i "$BR" -d 169.254.0.0/16 -m comment --comment "$TAG" -j REJECT --reject-with icmp-admin-prohibited
"$IPT" -I DOCKER-USER 1 -i "$BR" -d 192.168.0.0/16 -m comment --comment "$TAG" -j REJECT --reject-with icmp-admin-prohibited
"$IPT" -I DOCKER-USER 1 -i "$BR" -d 172.16.0.0/12  -m comment --comment "$TAG" -j REJECT --reject-with icmp-admin-prohibited
"$IPT" -I DOCKER-USER 1 -i "$BR" -d 10.0.0.0/8     -m comment --comment "$TAG" -j REJECT --reject-with icmp-admin-prohibited
"$IPT" -I DOCKER-USER 1 -i "$BR" -o "$BR" -m comment --comment "$TAG" -j RETURN

echo "[setup-egress] installed on $BR: intra-net RETURN + private-net REJECT (public egress allowed)"
