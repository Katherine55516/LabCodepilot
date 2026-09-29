# Cowork 自建会话镜像 —— 把 claude 二进制 + cowork-shim.py + cred-proxy.py + 办公高频
# Python 依赖烘进镜像,取代"python:3-slim + 宿主 bind-mount"(R 系列遗留形态)。
# 收益:会话容器不依赖宿主 assets(离线部署净)、镜像即版本单元(升级=换镜像)、
# **agent 处理办公文件零运行时 pip 下载**(10M 共享带宽下的最大流量点直接消失)。
#
# 路径与运行时协议完全对齐 bind 时代(零服务端协议改动):
#   /opt/cowork/claude           — agent 二进制(shim 默认 CLAUDE_BIN)
#   /opt/cowork/cowork-shim.py   — exec 桥容器侧(index.mjs 默认 COWORK_SHIM_PATH)
#   /opt/cred-proxy.py           — 凭证代理(cred-proxy.mjs 启动命令同路径)
#
# 构建:用 build-image.sh(负责组装 build context + 透传 PIP_INDEX),不要直接 docker build。
# base 保持 python:3-slim(debian/glibc,claude Bun 二进制已在其上验证过 R0-R5 全链)。
FROM python:3-slim

# 构建期 pip 源(默认公网阿里镜像,全球可达;阿里云服务器上构建可 --build-arg 换内网源
# mirrors.cloud.aliyuncs.com 走零公网带宽)。仅影响构建,运行期源见下方 /etc/pip.conf。
ARG PIP_INDEX=https://mirrors.aliyun.com/pypi/simple/

# 中文字体(matplotlib 画图中文标签必需,slim 基础镜像没有 —— 缺了全是方块)。
RUN apt-get update \
    && apt-get install -y --no-install-recommends fonts-noto-cjk fontconfig libreoffice-impress \
    && rm -rf /var/lib/apt/lists/*

# 办公高频依赖预装(root 装进全局 site-packages,uid 1000 运行时可直接 import;
# agent 运行时仍可 pip install --user 补长尾包,互不冲突)。清单克制:表格/文档/PDF/
# 绘图/HTTP 五类刚需,增量约 0.5GB(服务器本地磁盘,不占带宽)。
# ⚠️ http 索引必须配 --trusted-host,否则 pip 直接拒绝("not a trusted or secure host")。
# 阿里云**内网**源只能走 http —— 其 https 证书签给 mirrors-ssl.aliyuncs.com / mirrors.aliyun.com,
# 用 mirrors.cloud.aliyuncs.com 访问会 hostname mismatch(2026-07-28 生产实测)。
# 只在 http 时放宽:https 索引照常验证证书,不降级。
RUN set -eu; \
    EXTRA=""; \
    case "$PIP_INDEX" in \
      http://*) EXTRA="--trusted-host $(printf '%s' "$PIP_INDEX" | sed -E 's#^http://([^/:]+).*#\1#')" ;; \
    esac; \
    pip install --no-cache-dir -i "$PIP_INDEX" $EXTRA \
    pandas \
    openpyxl \
    xlsxwriter \
    python-docx \
    python-pptx \
    pdfplumber \
    pypdf \
    matplotlib \
    pillow \
    requests \
    tabulate

# 运行期 pip 全局配置:默认公网阿里镜像(比 pypi.org 快且稳)。阿里云部署时由
# orchestrator 注入 PIP_INDEX_URL 环境变量覆盖为内网源(env 优先级高于本文件),
# 见 deploy/OPERATIONS.md §9 —— 镜像本身保持环境无关。
RUN printf '[global]\nindex-url = https://mirrors.aliyun.com/pypi/simple/\ntimeout = 20\n' > /etc/pip.conf

# 刻意不用 COPY --chmod=:它**要求 BuildKit**,而不少发行版自带的 docker(如
# Alibaba Cloud Linux 4 的 docker 24)默认仍是 legacy builder 且仓库里没有 buildx
# 插件 —— 用了会直接构建失败(2026-07-28 生产实测)。改为由 build-image.sh 在组装
# 上下文时显式 chmod,两种 builder 都保留源文件权限,镜像因此可在任何 docker 上构建。
COPY claude /opt/cowork/claude
COPY cowork-shim.py /opt/cowork/cowork-shim.py
COPY cred-proxy.py /opt/cred-proxy.py

# 预制 Agent Skills(办公高频)。三个位置都不能用,所以落在 /opt/cowork-skills:
#   - `~/.claude/skills`:HOME 是 orchestrator 挂的会话状态卷,新建会话时为空,
#     写进镜像无效 —— 必须由 shim 在启动时软链进去;
#   - `/workspace`:持久卷,但**会被回合末产物 diff 扫描**,skill 文件会被当成用户
#     产物显示在「沙箱产物」卡片里,污染界面;
#   - `/opt/cowork/skills`:非 bundled 模式下 orchestrator 会 `-v ASSETS_DIR:/opt/cowork:ro`,
#     把整个目录连同 skills 一起**遮蔽掉**。故刻意放在该挂载点之外。
# 内容全是 Markdown、零可执行脚本(选型与 license 见 skills/README.md)。
COPY skills /opt/cowork-skills

# 无 ENTRYPOINT/CMD:会话容器由 orchestrator 以 `sleep infinity` 起,proxy 以
# `python3 /opt/cred-proxy.py` 起,helper 以 python one-liner 起 —— 全部显式传参。
