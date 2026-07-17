# Cowork 自建会话镜像 —— 把 claude 二进制 + cowork-shim.py + cred-proxy.py 烘进镜像,
# 取代"python:3-slim + 宿主 bind-mount"(R 系列遗留形态)。收益:会话容器不再依赖宿主
# assets 目录(离线部署更净)、cred-proxy 不再 bind 宿主脚本、镜像即版本单元(升级=换镜像)。
#
# 路径与运行时协议完全对齐 bind 时代(零服务端协议改动):
#   /opt/cowork/claude           — agent 二进制(shim 默认 CLAUDE_BIN)
#   /opt/cowork/cowork-shim.py   — exec 桥容器侧(index.mjs 默认 COWORK_SHIM_PATH)
#   /opt/cred-proxy.py           — 凭证代理(cred-proxy.mjs 启动命令同路径)
#
# 构建:用 build-image.sh(负责从 assets 目录/仓库组装 build context),不要直接 docker build。
# base 保持 python:3-slim(debian/glibc,claude Bun 二进制已在其上验证过 R0-R5 全链;
# helper/proxy 依赖 python3)。不预装办公工具链——agent 在容器内可自行 pip/apt(公网放行),
# 需要预装时在下方追加 RUN apt-get 层(注意镜像体积与离线源)。
FROM python:3-slim

# 会话容器以 --user 1000 运行(orchestrator 指定),文件属 root 只读即可(0755/0644)。
COPY --chmod=755 claude /opt/cowork/claude
COPY --chmod=644 cowork-shim.py /opt/cowork/cowork-shim.py
COPY --chmod=644 cred-proxy.py /opt/cred-proxy.py

# 无 ENTRYPOINT/CMD:会话容器由 orchestrator 以 `sleep infinity` 起,proxy 以
# `python3 /opt/cred-proxy.py` 起,helper 以 python one-liner 起 —— 全部显式传参。
