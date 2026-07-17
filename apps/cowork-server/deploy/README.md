# Cowork 控制面部署包(R5-3)

> 完整运维文档见 [docs/handover/cowork-vm-mode.md](../../../docs/handover/cowork-vm-mode.md)(R5-4 补运维/IT 专章)。
> 本文件是部署操作向导,目标:把 `apps/cowork-server/` 部署成单公司裸金属服务器上开机自启的服务。

## 部署形态(RD8)

cowork-server 是**编排宿主 docker 的控制面**(spawn `docker run/exec`、bind-mount 宿主 assets 进会话容器),故以**宿主 systemd 进程**运行、不进容器 —— 零 `docker.sock` 挂载弱化,bind-mount 路径天然宿主视角。两个 systemd 单元:

| 单元 | 作用 | 权限 |
|------|------|------|
| `cowork-server.service` | 控制面 node 进程(会话容器编排 + exec WS 桥 + cred-proxy 编排) | 服务用户(docker 组) |
| `cowork-egress.service` | 开机装出网禁内网防火墙(DOCKER-USER 规则,幂等 oneshot) | root(iptables) |

会话容器、cred-proxy sidecar、cowork-net 网络都由控制面在**运行时**动态编排,不在 systemd/compose 里声明。

## 前置

- Linux + systemd + docker(带 iptables,`DOCKER-USER` 链存在)+ node ≥ 20 + npm + iptables
- 一个**在 docker 组**的服务用户(免 sudo 跑 docker)
- **assets 目录**:放 `claude` 可执行二进制(与客户端 SDK 同版本、目标架构,x64/arm64 别搞错)+ `cowork-shim.py`(取自 `apps/cowork-server/container/cowork-shim.py`)

## 快速部署(3 步)

```bash
# 1. 准备 assets 目录(示例 /opt/cowork-assets)
sudo mkdir -p /opt/cowork-assets
sudo cp cowork-shim.py /opt/cowork-assets/          # 来自 container/cowork-shim.py
sudo cp /path/to/claude /opt/cowork-assets/ && sudo chmod +x /opt/cowork-assets/claude

# 2. 一键装(在 apps/cowork-server/ 下)
sudo COWORK_ASSETS_DIR=/opt/cowork-assets ./deploy/install.sh

# 3. 签个 token 联调(生产由账号后端用同密钥签发下发,R5-5)
sudo -u <服务用户> sh -c 'set -a; . /opt/cowork-server/.env; node /opt/cowork-server/sign-token.mjs <userId>'
```

`install.sh` 幂等:前置检查 → 拷代码 `/opt/cowork-server` → 装 ws → 首次生成 `.env`(随机 `COWORK_AUTH_SECRET`,已存在不覆盖)→ 装并启两个 systemd 单元 → 验证 health。重复跑=升级代码(保留 `.env`)。

## 配置

改 `/opt/cowork-server/.env`(键说明见 `.env.example`),然后 `systemctl restart cowork-server`。核心:

- `COWORK_AUTH_SECRET` —— HMAC 鉴权密钥,与账号后端签 token 用同一个。**留空=authz 关闭回退单用户,勿用于生产**。
- `COWORK_ASSETS_DIR` —— claude + shim 所在宿主目录。
- `COWORK_CPUS/MEM/PIDS` —— 每会话容器配额。`COWORK_IDLE_TTL_MS` —— 空闲回收(默认 30min)。

## TLS(生产必做)

明文 `ws/http` 仅内网可信环境用。公网走 TLS 反代(`docker-compose.tls.yml` + caddy 自动证书):`.env` 设 `COWORK_SERVER_HOST=127.0.0.1` 让明文端口只在本机 → 填 `Caddyfile` 域名 → `docker compose -f docker-compose.tls.yml up -d`。账号后端下发的 server 地址用 `wss://<域名>`。

## 常用运维

```bash
systemctl status cowork-server cowork-egress
journalctl -u cowork-server -f                       # 实时日志
curl -s http://127.0.0.1:8790/health                 # 健康检查(未带 token 返回 unauthorized 属正常)
iptables -L DOCKER-USER -n | grep cowork-egress       # 出网规则(应有 5 条)
```

## 排坑

- **重装/换网桥后出网规则匹配不到**:若删过 `cowork-net` 又没重启控制面,网桥名可能变。重启 `cowork-server`(重建 `cowork-net`+固定网桥 `cowork0`)后 `systemctl restart cowork-egress` 重装规则。
- **真 API 在内网**:`setup-egress.sh` 默认拦私网四段;若 cred-proxy 转发目标是内网地址,按脚本注释加一条定向 RETURN 放行。
- **密钥管理**:`.env` 权限 600、属服务用户;轮换 `COWORK_AUTH_SECRET` 需同步账号后端签发密钥,否则存量 token 全失效。
