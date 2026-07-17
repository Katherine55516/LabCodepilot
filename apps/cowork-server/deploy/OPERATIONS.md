# Cowork 沙箱服务器运维手册(R5-4)

> 部署操作见 [README.md](./README.md)(3 步快速部署);本文是部署完成后的日常运维/IT 参考。
> 架构与设计决策见 [docs/handover/cowork-vm-mode.md](../../../docs/handover/cowork-vm-mode.md)。

## 1. 架构速览(运维视角)

```
客户端(AI Native Lab 桌面版)
   │  HTTP/WS :8790(Bearer HMAC token;生产经 caddy TLS :443)
   ▼
cowork-server(宿主 node 进程,systemd 管理)── 控制面,自身无特权
   │  docker CLI(服务用户在 docker 组)
   ▼
docker ─┬─ cowork-<sid>    会话容器(每会话一个;非 root uid 1000、cap-drop ALL、
        │                  cpu/mem/pids 配额;workspace = named volume cowork-ws-<sid>)
        ├─ cowork-proxy    凭证代理 sidecar(常驻;真 key 只在它的 tmpfs /creds)
        └─ cowork-net      专用网络(固定网桥 cowork0,egress 防火墙按此名匹配)
```

- 三类东西**开机自启**:docker(发行版自带)、`cowork-server.service`、`cowork-egress.service`。
- 会话容器/cowork-proxy/cowork-net 都由控制面**运行时动态编排**,不在 systemd 里声明;server 重启不影响已跑的会话容器。cowork-proxy 在 server **启动时**确保存在(有 memoize,运行中被误删不会自动检测)—— 误删后 `systemctl restart cowork-server` 即重建。
- 凭证:客户端每回合重新注册,server 重启后**自动自愈**,无需运维干预。

## 2. 服务管理

```bash
systemctl status cowork-server cowork-egress     # 状态(都应 active;egress 是 oneshot,active=exited 正常)
systemctl restart cowork-server                  # 改 .env 后重启生效
journalctl -u cowork-server -f                   # 实时日志
journalctl -u cowork-server --since "1 hour ago" # 回溯
journalctl -u cowork-egress --no-pager           # 防火墙安装日志
```

启动成功的日志特征(据此确认配置生效):

```
[cowork-server] listening 0.0.0.0:8790 authz=HMAC image=python:3-slim assets=/home/fer/cowork-poc idleTTL=1800000ms
```

`authz=HMAC` 必须在 —— 若显示 `OFF(dev)` 说明 `.env` 没被读到或密钥为空,**生产事故级配置错误**。

## 3. 配置参考(/opt/cowork-server/.env)

改后 `systemctl restart cowork-server`。完整注释见 [.env.example](./.env.example)。

| 键 | 默认 | 说明 |
|----|------|------|
| `COWORK_AUTH_SECRET` | install 时随机生成 | HMAC 验签密钥,与账号后端签发密钥**必须同一个**。空=authz 关闭(仅 dev) |
| `COWORK_ASSETS_DIR` | `/opt/cowork-assets` | claude 二进制 + cowork-shim.py 的宿主目录(bind 进容器 `/opt/cowork:ro`) |
| `COWORK_SERVER_PORT` / `HOST` | `8790` / `0.0.0.0` | 上 TLS 反代时 HOST 改 `127.0.0.1` |
| `COWORK_IDLE_TTL_MS` | `1800000`(30min) | 空闲回收:仅 exec 续命;超时 `docker stop` 保留 volume,下次秒级复用 |
| `COWORK_CPUS` / `MEM` / `PIDS` | `2` / `2g` / `512` | 每会话容器配额(改后只影响**新建**容器) |
| `COWORK_AUDIT_FILE` | `<部署目录>/cowork-audit.log` | 审计文件路径 |
| `COWORK_IMAGE` | `python:3-slim` | 会话容器镜像(**首次部署需能拉到或提前 `docker load`**;推荐切自建镜像,见 §9) |
| `COWORK_IMAGE_BUNDLED` | 空(关) | `1` = 自建镜像模式:claude/shim/cred-proxy 已烘入镜像,不再 bind 宿主 assets/脚本 |

## 4. 密钥与 token 管理

- **`.env` 权限 600、属服务用户**(install.sh 已设);`COWORK_AUTH_SECRET` 泄漏 = 任何人可给任意 uid 签 token。
- **签 token**(R5-5 前的运维/联调方式;生产由账号后端用同一密钥按用户签发):

  ```bash
  sudo -u <服务用户> sh -c 'set -a; . /opt/cowork-server/.env; node /opt/cowork-server/sign-token.mjs <userId> [ttlSeconds]'
  ```

  token 无状态(`base64url(JSON{uid,exp?}).base64url(HMAC_SHA256)`),server 不存用户表;不带 ttl 则永不过期。
- **轮换密钥**:改 `.env` 的 `COWORK_AUTH_SECRET` → 同步账号后端签发密钥 → `systemctl restart cowork-server`。**存量 token 全部立刻失效**(无状态设计的代价与好处),客户端重新拉取下发配置即恢复。
- 撤销单个用户:无状态设计下不能单点吊销,靠 ttl 短周期 + 账号后端停发。要立即封禁某 uid,临时手段是轮换全局密钥。

## 5. 审计

append-only JSONL,`COWORK_AUDIT_FILE` 指定路径;超 4MB 软截断保留后半。**绝不记录 key/token 本体**。真实样例:

```json
{"ts":"2026-07-17T08:57:54.185Z","event":"session_ensure","sessionId":"e2e5b3d4c1a09f7e","detail":"alice"}
```

| 事件 | 含义(detail) |
|------|------|
| `session_ensure` / `session_remove` | 会话容器新建/删除(uid) |
| `exec_start` | 一次 agent 回合开始(uid) |
| `file_upload` / `file_download` / `archive_download` | 文件上行/下行/打包下载(路径+字节数) |
| `cred_issued` / `cred_revoked` | 凭证登记/废止(仅 sessionId) |
| `reconcile` | 客户端对账清孤儿(uid + 清了哪些 sid) |
| `idle_reap` | TTL 空闲回收(容器停、volume 留) |

**已知观测缺口**(tech-debt #15):坏 token 打到凭证代理的拒绝发生在 cowork-proxy **容器内**(只回 401,且故意不打日志防敏感头落盘),宿主侧**没有**对应审计事件 —— 当前无法从审计文件监控凭证探测行为。

app 侧另有一半审计(`src/lib/cowork-audit.ts`,记在用户机),事件名对齐,可两侧对账。

## 6. 日常巡检(可做成 cron)

```bash
# 健康(不带 token 返回 {"error":"unauthorized"} 即为"活着且 authz 开启")
curl -s -m 5 http://127.0.0.1:8790/health
# 带 token 深检(返回 docker 版本 + 会话数)
curl -s -H "authorization: Bearer $TOKEN" http://127.0.0.1:8790/health
# 沙箱资产盘点
docker ps -a --filter label=cowork.managed=1 --format '{{.Names}}\t{{.State}}'
docker volume ls -q --filter label=cowork.managed=1 | wc -l
# 出网防火墙(应为 5 条:1 内部 RETURN + 4 私网 REJECT)
iptables -L DOCKER-USER -n | grep -c cowork-egress
# 最近审计事件抽查
tail -5 /opt/cowork-server/cowork-audit.log
```

## 7. 故障排查

| 症状 | 排查/处置 |
|------|-----------|
| server 起不来 | `journalctl -u cowork-server -n 30`。常见:`.env` 缺失/密钥行断裂、node 不在 PATH(unit 用 `/usr/bin/env node`)、docker daemon 没起、服务用户不在 docker 组 |
| health 返回 unauthorized | **正常**(authz 开着)。带 token 复测才是深检 |
| egress 规则 0 条 | docker 未带 iptables 起(`iptables -L DOCKER-USER -n` 报错)→ 查 docker daemon 配置;或单元失败 → `journalctl -u cowork-egress` |
| 删过 cowork-net 后内网没拦住 | 网桥名可能已不是 cowork0:`systemctl restart cowork-server`(重建网络+固定网桥)→ `systemctl restart cowork-egress`(重装规则) |
| 真 API 在公司内网,回合全失败 | egress 默认拦私网四段。按 `setup-egress.sh` 尾注加一条对该地址的定向 RETURN(cred-proxy 是可信组件) |
| 会话容器起不来 | 通用镜像模式:assets 缺件(`claude` 可执行 + `cowork-shim.py`)或镜像拉不到(离线先 `docker load`);自建镜像模式:`docker images cowork-sandbox` 确认镜像在、`.env` 的 `COWORK_IMAGE` 拼写对 |
| 回合全部连不上凭证代理 | `docker ps --filter name=cowork-proxy` 看是否被误删/退出 → `systemctl restart cowork-server` 重建(运行中不自动检测,见 §1) |
| 容器"消失" | 大概率 TTL 空闲回收(审计有 `idle_reap`)。volume 还在,客户端下回合 ensure 自动 `docker start` 复用,**不是故障** |
| 磁盘涨 | 会话 volume 是持久的(删除会话才清)。孤儿盘点:`docker volume ls --filter label=cowork.managed=1`,对不上客户端会话列表的可由客户端 reconcile 清,或确认后 `docker volume rm` |
| install.sh 报 npm 相关错 | sudo 的 secure_path 常不认 npm 的 .js symlink —— 把 `node_modules/ws` 随部署源一并拷来(install.sh 优先直拷,根本不需要 npm) |
| 远程脚本操作结果错乱 | SSH ControlMaster 连接复用叠加会话状态导致跨调用副作用错乱(踩过:文件"传完即失踪")。部署类操作用**单次原子 ssh**(tar-pipe + 执行放同一 shell) |

## 8. 升级 / 迁移

- **升级 server 代码**:新源码放服务器 → 重跑 `sudo ./deploy/install.sh`(幂等;拷代码+更新单元,**保留 `.env`**)→ 完。会话容器不受影响。
- **升级 claude 二进制**:通用镜像模式下替换 `$COWORK_ASSETS_DIR/claude`(bind `:ro` 实时,新回合即生效);自建镜像模式下重建镜像(见 §9)。两种模式都要与客户端 SDK 版本对齐,架构别搞错 x64/arm64。
- **迁移到真裸金属三件套**:① 换目标架构 claude 二进制;② 跑 selftest 自检(见下);③ 上 TLS(README「TLS」节)+ 真实域名下发。
- **selftest 自检**(部署目录自带,验证 docker/容器链路完好;需 assets + egress 段需免密 sudo):

  ```bash
  cd /opt/cowork-server && COWORK_ASSETS_DIR=<assets目录> node selftest-r4.mjs   # 多用户/配额/TTL/出网
  ```

  注意:selftest 用独立端口(8795)自起 server 实例,**会清场 cowork 容器/网络**,别在有活跃用户时跑;跑完 `systemctl restart cowork-server cowork-egress` 恢复生产网络与规则。自建镜像模式下跑 selftest 需带环境:`COWORK_IMAGE=cowork-sandbox:latest COWORK_IMAGE_BUNDLED=1 node selftest-r4.mjs`。

## 9. 自建会话镜像(推荐的生产形态)

把 claude 二进制 + cowork-shim.py + cred-proxy.py 烘进镜像,取代"python:3-slim + bind 宿主 assets"。收益:会话容器不依赖宿主 assets 目录(离线部署更净)、cred-proxy 不 bind 宿主脚本、镜像即版本单元。

```bash
# 构建(在 /opt/cowork-server 下;claude 从 assets 目录取,tag 自动取 claude 版本号)
sh image/build-image.sh /opt/cowork-assets

# 启用:.env 设两行 → 清 proxy → 重启
#   COWORK_IMAGE=cowork-sandbox:latest
#   COWORK_IMAGE_BUNDLED=1
docker rm -f cowork-proxy && systemctl restart cowork-server
```

- **切换/升级后 proxy 必须手动清一次**:`ensureProxy` 见 proxy running 就复用,不会自动按新镜像重建。
- **存量会话容器仍是旧镜像**:TTL 回收或会话删除后新建的才用新镜像;要全量立刻切,先让客户端 reconcile 或确认无活跃用户后 `docker rm -f $(docker ps -aq --filter label=cowork.managed=1)`(volume 保留,数据不丢)。
- **升级 claude** = 换 assets 里的新二进制 → 重跑 `build-image.sh`(tag 自动取新版本)→ 清 proxy → 重启。
- **回退** = `.env` 去掉 `COWORK_IMAGE_BUNDLED` 与 `COWORK_IMAGE`(回 bind 模式,assets 目录须在)→ 清 proxy → 重启。
