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
        │                  cpu/mem/pids 配额;两个 named volume:
        │                  cowork-ws-<sid> → /workspace(用户产物,只有它进产物 diff)
        │                  cowork-st-<sid> → /home/agent(claude 的会话记录/配置)
        ├─ cowork-proxy    凭证代理 sidecar(常驻;真 key 只在它的 tmpfs /creds)
        └─ cowork-net      专用网络(固定网桥 cowork0,egress 防火墙按此名匹配)
```

- 三类东西**开机自启**:docker(发行版自带)、`cowork-server.service`、`cowork-egress.service`。
- 会话容器/cowork-proxy/cowork-net 都由控制面**运行时动态编排**,不在 systemd 里声明;server 重启不影响已跑的会话容器。cowork-proxy 在 server **启动时**确保存在(有 memoize,运行中被误删不会自动检测)—— 误删后 `systemctl restart cowork-server` 即重建。
- 凭证:客户端每回合重新注册,server 重启后**自动自愈**,无需运维干预。
- **两条执行路径,别混**:交互回合的 agent loop 跑在**客户端**(server 只是转发器的哑管道);
  定时任务的 agent loop 跑在**服务端**(`routine-runner.mjs` 自己 `docker exec`)。所以
  「客户端全关着但容器在跑」是定时任务的正常现象,不是泄漏。详见 §10。

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
| `COWORK_STATE_DIR` | `/data/cowork-state` | **定时任务**的定义与运行历史(见 §10)。install.sh 会建好并 chown —— 服务非 root 跑,漏了会 EACCES 而**表现是任务永远不触发** |
| `COWORK_BACKEND_URL` | 空 | 账号后端地址。定时任务靠它取模型凭证;**没配 = 所有定时运行都 credential_error** |
| `COWORK_INTERNAL_SECRET` | 空 | 取凭证用的独立密钥,与账号后端 `APP_COWORK_INTERNAL_SECRET` 同值。**必须与 `COWORK_AUTH_SECRET` 不同**(理由见 §10.5) |
| `COWORK_ROUTINE_CONCURRENCY` | `4` | 同时最多跑几个定时任务 |
| `COWORK_ROUTINE_DAILY_CAP` | `20` | 每用户每天最多跑几次 |
| `COWORK_ROUTINE_MAX_PER_UID` | `50` | 每用户最多建几个定时任务 |
| `COWORK_ROUTINE_TIMEOUT_MS` | `900000`(15min) | 单次运行硬超时,超时 SIGTERM → SIGKILL |
| `COWORK_ROUTINE_MAX_ERRORS` | `10` | 连续失败几次后自动停用该任务 |

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

append-only JSONL,`COWORK_AUDIT_FILE` 指定路径;超 64MB(`COWORK_AUDIT_MAX_BYTES`,`0`=不截断)软截断保留后半。**绝不记录 key/token 本体**。真实样例:

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
| `routine_create` / `routine_delete` | 定时任务建/删(uid) |
| `routine_fire` | 一次定时运行开始(uid + 容器是新建还是复用) |
| `routine_end` | 一次定时运行结束(uid + 终态;`code` 是退出码,`durationMs` 是耗时) |
| `cred_fetched` | 为定时运行取到模型凭证(uid + 配置名,**无 key**) |

🔴 **带归属的事件,`detail` 必须以 uid 开头**(后面可以跟补充信息)。账号后端的用量归属
就按这条规则解析;写成 `"success <uid>"` 之类照样入库、也不报错,但 uid 落成 NULL ——
归不到人头、在用户维度聚合里整个消失。`selftest-r5.mjs` 第 5 组按源码锁住了这条。

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

### 部署漂移检测(在**开发机**上跑,不是服务器)

服务端是 scp/install.sh 推上来的,没有任何机制会告诉你「生产上跑的」和「仓库里的」
分叉了。2026-08-04 手工比对发现生产落后仓库 3 个文件,其中就包括本文件自己 ——
少了下面 §7 的「selftest 三个必踩的坑」,而那正是出事时要照着做的那段。

```bash
# 在 LabCodepilot 仓库里跑;只读,不写远端、不重启服务
apps/cowork-server/deploy/verify-deployment.sh              # 默认比 cowork-prod
apps/cowork-server/deploy/verify-deployment.sh cowork-vm    # 换目标
```

输出分三类,**处理方式完全不同**:
- `⚠️ 内容不一致` — 先判方向。仓库领先 = 等下次部署;生产领先 = 有人手工改过服务器,
  必须回填进 git,否则那份改动只活在一台机器上。
- `⬜ 仅仓库有` — 新文件还没部署,正常。
- `🔺 仅生产有` — **最危险**:只存在于这台机器的代码,机器没了就没了,立刻回填 git。

退出码 0 = 一致、1 = 有漂移,可直接挂进巡检脚本。

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
| 磁盘涨 | 会话 volume 是持久的(删除会话才清),且**每会话两个**(`cowork-ws-*` 产物 + `cowork-st-*` claude 状态)。孤儿盘点:`docker volume ls --filter label=cowork.managed=1`,对不上客户端会话列表的可由客户端 reconcile 清,或确认后 `docker volume rm` |
| 接着聊上一轮却"没反应" | 容器里没有该会话的 transcript,claude 打 `No conversation found with session ID` 并 exit 1(`journalctl -u cowork-server | grep "No conversation"`)。shim 会自动降级成"以同 id 新建会话"(日志 `[cowork-shim] 会话 … 已不在容器内`),用户只失忆一轮。**仍频繁出现** = 该会话容器还是老的 tmpfs HOME,按 §8 重建一次 |
| install.sh 报 npm 相关错 | sudo 的 secure_path 常不认 npm 的 .js symlink —— 把 `node_modules/ws` 随部署源一并拷来(install.sh 优先直拷,根本不需要 npm) |
| 远程脚本操作结果错乱 | SSH ControlMaster 连接复用叠加会话状态导致跨调用副作用错乱(踩过:文件"传完即失踪")。部署类操作用**单次原子 ssh**(tar-pipe + 执行放同一 shell) |

## 8. 升级 / 迁移

- **升级 server 代码**:新源码放服务器 → 重跑 `sudo ./deploy/install.sh`(幂等;拷代码+更新单元,**保留 `.env`**)→ 完。会话容器不受影响。
- **⚠️ 升级到「HOME 用状态卷」这一版**:`docker run` 的挂载参数在建容器时就固化了,**存量容器仍是 tmpfs HOME**,不重建就享受不到。升级步骤:装新代码 + 重建镜像(§9,shim 有改动)→ `systemctl restart cowork-server` → 确认无活跃回合后 `docker rm -f $(docker ps -aq --filter label=cowork.managed=1)`(**产物卷保留,用户文件不丢**;proxy 会随下次 restart 重建)。存量会话记着的 sdk_session_id 在新卷里同样不存在,首个回合由 shim 降级成"以同 id 新建",之后恢复正常。
- **升级 claude 二进制**:通用镜像模式下替换 `$COWORK_ASSETS_DIR/claude`(bind `:ro` 实时,新回合即生效);自建镜像模式下重建镜像(见 §9)。两种模式都要与客户端 SDK 版本对齐,架构别搞错 x64/arm64。
- **迁移到真裸金属三件套**:① 换目标架构 claude 二进制;② 跑 selftest 自检(见下);③ 上 TLS(README「TLS」节)+ 真实域名下发。
- **selftest 自检**(部署目录自带,验证 docker/容器链路完好;需 assets + egress 段需免密 sudo):

  ```bash
  cd /opt/cowork-server
  set -a; . ./.env; set +a
  export COWORK_SERVER_HOST=127.0.0.1        # selftest 自起实例连 127.0.0.1,必须覆盖 .env 的内网 IP
  unset COWORK_AUTH_SECRET COWORK_SERVER_TOKEN  # r1-r3 不发 Authorization;r4 自带 r4-test-secret
  node selftest-r1.mjs && node selftest-r2.mjs && node selftest-r3.mjs && node selftest-r4.mjs
  ```

  **三个必踩的坑(2026-07-28 生产实测)**:
  1. **不 unset `COWORK_AUTH_SECRET` 则 r1-r3 全 FAIL** —— 它们不带 Authorization 头,authz 开着时一律 401,现象是所有断言返回 `undefined`(不是明显的 401 报错,极易误判成功能坏了)。r4 自带密钥专测鉴权,同样要清掉外部密钥免得干扰。
  2. **不覆盖 `COWORK_SERVER_HOST` 则连不上** —— 生产 .env 绑内网 IP,而 selftest 的 BASE 写死 127.0.0.1。
  3. ⚠️ **r4 跑完会把 DOCKER-USER 规则清空**(它要对比"装 egress 前后"),生产机上等于**出网防护短暂失效**。跑完**必须** `systemctl restart cowork-egress` 并复验:
     ```bash
     iptables -S DOCKER-USER | grep -c cowork-egress   # 应为 5
     ```

  另:selftest 自起独立端口实例,**会清场 cowork 容器/网络**,别在有活跃用户时跑;跑完 `systemctl restart cowork-server cowork-egress` 恢复生产网络与规则。自建镜像模式下 `.env` 里已有 `COWORK_IMAGE`/`COWORK_IMAGE_BUNDLED`,source 后自动带上。

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

### 依赖预装与 pip 源(省带宽,10M 共享出口关键项)

镜像已预装办公高频 Python 包(pandas/openpyxl/xlsxwriter/python-docx/python-pptx/
pdfplumber/pypdf/matplotlib+中文字体/pillow/requests/tabulate)—— 日常任务 agent
**零运行时 pip 下载**。长尾包 agent 仍会 `pip install --user`,pip 源三层:

| 层 | 配置 | 何时用 |
|---|---|---|
| 运行期覆盖 | `.env` 的 `COWORK_PIP_INDEX_URL`(orchestrator 注入容器 env,优先级最高) | **阿里云部署必配内网源** `https://mirrors.cloud.aliyuncs.com/pypi/simple/` → 长尾包走内网零公网带宽 |
| 镜像默认 | 镜像内 `/etc/pip.conf` = 公网阿里镜像 | 未配置覆盖时(非阿里云环境) |
| 构建期 | `COWORK_BUILD_PIP_INDEX` 环境变量传给 `build-image.sh` | 阿里云上构建镜像时配内网源,预装下载也零公网带宽 |

阿里云部署两条实测(部署当天做):① 宿主 `curl -sI https://mirrors.cloud.aliyuncs.com/pypi/simple/`
确认内网源可达;② 沙箱容器内试 `pip download tabulate`——若内网源解析到 10/8 或 172.16/12
被 egress 拦(阿里内网服务通常在 100.64/10 段不受拦),按 `setup-egress.sh` 尾注加定向放行。

---

## 10. 定时任务(服务端调度)

用户在客户端建的定时任务**跑在这台服务器上**,到点由本机调度器自己发起完整的 agent 回合。
**客户端关着、用户电脑关机都照跑** —— 所以「没人在线但容器在转」是正常的。

### 10.1 它在哪、长什么样

```
$COWORK_STATE_DIR(默认 /data/cowork-state,权限 700,属服务用户)
├── routines/<uid>/<routineId>.json         任务定义 + 调度状态(原子写)
├── routines/<uid>/<routineId>.runs.jsonl   运行历史(append-only,**永久保留**)
└── runs/<runId>.jsonl                      每次运行的完整 stream-json 原文
```

**routineId 就是 sid**,所以每个任务天然拥有自己的容器 `cowork-<id>` 和工作区卷
`cowork-ws-<id>`,与普通会话同一套编排。区别只在容器/卷带 `cowork.kind=routine` 标签。

### 10.2 巡检

```bash
# 调度器起来了没(启动时打一行,没有这行 = 调度根本没跑)
journalctl -u cowork-server --no-pager -o cat | grep 'routine scheduler started' | tail -1
#   期望:routine scheduler started (tick=60000ms concurrency=4 dailyCap=20)

# 现存任务数(按用户分目录)
find "$COWORK_STATE_DIR/routines" -name '*.json' | wc -l

# 只看定时任务的容器(普通会话不带这个标签)
docker ps -a --filter label=cowork.kind=routine

# 最近的运行结果
grep -h routine_end /opt/cowork-server/cowork-audit.log | tail -20

# 状态目录属主(必须是服务用户,不是 root)
ls -ld "$COWORK_STATE_DIR"
```

### 10.3 排障:任务到点不跑

**按这个顺序查,前三条覆盖绝大多数情况:**

1. **状态目录权限**。`ls -ld $COWORK_STATE_DIR` 属主不是服务用户 → 服务读写不了,
   而它的表现极不直观:**服务一切正常、health 也正常,只是任务永远不触发**。
   修:`chown -R <服务用户>:<服务用户> $COWORK_STATE_DIR`,重启服务。
2. **`COWORK_BACKEND_URL` / `COWORK_INTERNAL_SECRET` 没配或不匹配**。表现是每次运行都
   `credential_error`。验(不打印 key;⚠️ 必须用一个**确定能正常用办公模式**的 uid,
   否则 404 有歧义 —— 「密钥不对」和「这人没有可用配置」返回同一个 404):

   ```bash
   cd /opt/cowork-server; set -a; . ./.env; set +a
   node -e "import('./lib/backend-credentials.mjs').then(async m=>{try{const c=await m.fetchModelCredentials(process.argv[1]);console.log('✅',c.configName,c.realBase);}catch(e){console.log('❌',e.reason,e.message);}})" <用户UUID>
   ```
3. **任务被自动停用**。连续失败 `COWORK_ROUTINE_MAX_ERRORS`(默认 10)次后自动停,
   `disabledReason` 里写了原因。看 `routines/<uid>/<id>.json` 的 `enabled` 与 `disabledReason`。
4. **配额或并发把它挡了**。这类**不会静默丢**,一定会在 `.runs.jsonl` 里留一条
   `status:"skipped"` 并注明 `skipReason`(`daily_quota_exceeded` / `concurrency_limit` /
   `previous_run_in_progress` / `missed_too_long`)。查不到 skipped 记录就说明不是这个原因。
5. **cron 时区**。任务按它自己的 `schedule.tz`(IANA,如 `Asia/Shanghai`)求值,
   **不是服务器本地时区**。别拿 `date` 的输出去对。

**手工触发一次**(排障主入口,绕开调度器):

```bash
cd /opt/cowork-server; set -a; . ./.env; set +a
node routine-once.mjs --uid <用户UUID> --prompt "在当前目录建 ok.txt 写 OK" --transcript /tmp/x.jsonl
```

### 10.4 调配额

改 `.env` 里 §3 那几个 `COWORK_ROUTINE_*`,`systemctl restart cowork-server`。

- **日配额只数真正跑掉的**:`skipped` 不计入。否则配额一旦打满就再也降不下来
  (满额 → 后续全 skipped → skipped 又计入 → 永远满额,自锁死)。
- **配额的「今天」是北京日**(00:00 UTC+8 重置),与账号后端的口径同源。
- 并发调大前先看内存:每个容器默认 2 CPU / 2G,`COWORK_ROUTINE_CONCURRENCY=4` 时
  定时任务峰值可占 8 核 8G,与交互会话**共享**同一台机器的资源。

### 10.5 两把密钥不能混用

| 密钥 | 作用 |
|---|---|
| `COWORK_AUTH_SECRET` | 签发**用户** token(客户端访问本服务) |
| `COWORK_INTERNAL_SECRET` | 本服务**反向**去账号后端取模型凭证 |

**必须是两个不同的值。** 沙箱是跑不可信 agent 代码的机器,被攻破概率天然高于账号后端。
复用同一把会让「攻破沙箱」从「冒充用户访问沙箱」升级为「批量导出全体用户的模型 API key」——
这是质变,不是量变。

### 10.6 两条别踩的线

- **`selftest-r1..r4` 会清场**(reconcile 掉全部受管容器与网络),有活跃用户时绝不能跑。
  `selftest-r5.mjs` 刻意不清场,可以在生产跑(仍建议低峰)。
- **客户端的 `/reconcile` 不会碰定时任务的工作区** —— 靠 `cowork.kind=routine` 标签排除。
  改 orchestrator 的过滤逻辑时务必先跑 `selftest-r5.mjs` 第 3 组:漏了这条,
  **用户每打开一次 app 就清空一次自己所有定时任务的累积文件**。
