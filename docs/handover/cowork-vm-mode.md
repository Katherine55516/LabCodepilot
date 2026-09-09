# Cowork 办公模式(本地 VM 隔离 agent)— 技术交接文档

---

# 📍 §A 当前状态速览(2026-07-29 · 接手先读本节,读完即可继续干活)

> **本节自足**:只读这一节就能知道系统现在长什么样、还剩什么、怎么继续。
> 下面 §0-§9 是历史全貌(本地 vfkit 时代的背景),**不是当前活跃路径**,按需再查。

## A.1 一句话现状

**已开通,并完成真实用户端到端验收 —— 远程沙箱正式可用。**
沙箱服务器(香港阿里云 x64)已部署、域名与 TLS 已通、四套 selftest 在 x64+userns 上全过;
账号后端下发接口与 admin 可视化配置页已上线。2026-07-29 在 admin 页开通后,
**两个真实账号**都跑通了完整链路(配置下发 → 起容器 → 凭证代理 → WS exec → 文件通道上下行),
过程中发现并修掉一个只在特定机器上复现的真 bug(A.5 ⑤,代理变量过河)。剩余工作见 A.9。

## A.2 生产环境实况(2026-07-29 实测核准)

**沙箱服务器**(RD2 的「单一公司服务器」):

| 项 | 值 |
|---|---|
| SSH | `ssh cowork-prod`(别名已配)= `root@47.243.237.188:40022`,专用密钥 `~/.ssh/cowork_prod` |
| 密码 | 在 `/Users/yuanqi/project/server.txt`(纯密码 18 字符,**只用于一次性装公钥,之后全程密钥认证**;要用请 `sshpass`/`expect` 从文件读,勿打印) |
| OS | Alibaba Cloud Linux 4.0.4(OpenAnolis)· **dnf 系,非 apt** |
| 架构/规格 | **x86_64** · 32 核 Xeon · 60Gi 内存 · **无 swap** |
| 磁盘 | 系统盘 `vda` 40G;数据盘 `vdb` 1TB → ext4 挂 `/data`(已写 fstab,UUID `0405f6a2-…`),现 915M 用 / 973G 余 |
| 虚拟化 | **无 KVM**(普通 ECS,未开嵌套虚拟化)—— 见 RD3 修正 |
| docker | 24.0.9(阿里云内网源)· containerd 1.7.29 · runc 1.2.8 · **legacy builder,无 buildx** |
| docker 配置 | `/etc/docker/daemon.json`:`data-root=/data/docker`、**`userns-remap=default`**、日志 50m×3 |
| userns 实况 | `dockremap` uid 994,`subuid=100000:65536`,容器内 uid 0 → 宿主 uid 100000 |
| node / git | v22.23.0 / 2.47.3(均内网源) |
| 服务用户 | `cowork`(uid 993,在 docker 组)—— **非 root**,故绑不了 <1024 端口 |
| 镜像 | `cowork-sandbox:2.1.203` + `:latest`,**786MB**(x64 本机构建) |
| claude | `/opt/cowork-assets/claude` = **2.1.203 · ELF x86-64** |
| 网络 | `cowork-net` 网段 **172.19.0.0/16**,网桥名 `cowork0`;宿主 eth0 `172.24.185.132/20`(不冲突) |

**systemd 两单元**:`cowork-server` + `cowork-egress`,均 `active` + `enabled`(开机自启);
监听 `172.24.185.132:8790`;`DOCKER-USER` 5 条 egress 规则在位。

**`/opt/cowork-server/.env` 生效值**:
```
COWORK_AUTH_SECRET=<64 位 hex —— 故意不写进本文档,见服务器 /opt/cowork-server/.env>
COWORK_ASSETS_DIR=/opt/cowork-assets
COWORK_SERVER_PORT=8790
COWORK_SERVER_HOST=172.24.185.132     # ← 绑内网 IP;**绝不能设 127.0.0.1**(NPM 在另一台机器)
COWORK_IDLE_TTL_MS=1800000
COWORK_CPUS=2 / COWORK_MEM=2g / COWORK_PIDS=512
COWORK_AUDIT_FILE=/opt/cowork-server/cowork-audit.log
COWORK_IMAGE=cowork-sandbox:latest
COWORK_IMAGE_BUNDLED=1
COWORK_PIP_INDEX_URL=http://mirrors.cloud.aliyuncs.com/pypi/simple/   # ← 必须 http,见 A.5①
```

## A.3 网络拓扑(与原设计不同,务必先看)

两台 ECS **共用同一个公网 IP**,另一台跑 Nginx Proxy Manager(NPM)做反代:

```
客户端 → https://cowork-server.ai-native-lab.com   (公网,Let's Encrypt *.ai-native-lab.com,有效至 2026-09-13)
       → NPM(另一台 ECS,内网 172.24.185.130)
       → 本机 172.24.185.132:8790                  (cowork-server)
```

- **SSH 的 40022 也是经 NAT/转发到本机 22**,故 `ss -tlnp` 看到的是 `:22`。
- **NPM 的 Forward Port 已由用户改为 8790**(原先填 80,但服务以非 root 跑绑不了特权端口)。
- 实测(带真 token,经公网域名):REST `GET /health` → `200 {"ok":true,...}`;
  WS `/session/:id/exec` 升级 → **`101 Switching Protocols`**(NPM 的 Websockets Support 已开)。
  无 token 时 WS 返回 **502** 属正常(服务端直接断连,nginx 视为上游关闭),不是代理故障。
- X-Forwarded-For 正常透传;`client_max_body_size` ≥10MB(声明 10MB 未被立即 413)。
- **R5-3 预留的 Caddy TLS 反代作废**(`docker-compose.tls.yml`/`Caddyfile.example`)—— NPM 已承担 TLS。
- ⚠️ **曾记录「从开发者网络上传仅 66KB/s」—— 那个数字是被本地代理软件污染的,不是链路真实水平。**
  2026-07-29 定位清楚:开发机跑着 fake-ip + TUN 模式的代理(域名解析到 `198.18.x.x` 这类
  RFC 2544 保留段),流量绕经代理节点再回香港。实测对照:
  服务端本地处理 `0.0001s` · NPM→沙箱内网 `0.0002s` · 内网 TLS 握手 `0.033s` ·
  **服务器侧走公网+TLS `~0.10s`(这才是真实基线)** · 而开发机 TLS 握手 **1.5~3.0s**。
  判据:开发机 ping 该 IP 物理 RTT 95ms,但 curl 的 TCP 握手只要 **0.6ms** —— 比物理延迟
  快 150 倍,说明连接根本没出本机,连的是本地代理进程。
  **做容量/体感判断时不要采信 66KB/s**;要测真实水平,先在代理规则里把
  `ai-native-lab.com` 设为 DIRECT(判据:TCP 时间从 0.6ms 变成 ~95ms 才算真直连)。

## A.4 本轮新增/修正的决策

- **RD3 已修正**(见 exec-plan):服务器实为**无嵌套虚拟化的普通 ECS**,`/dev/kvm` 不存在、
  cpuinfo 无 `vmx|svm`、`virt-what` 报自身即 KVM guest → **Kata microVM 与 gVisor-KVM 平台彻底出局**;
  gVisor **systrap** 平台(不需 KVM)仍可选但**未采用**(办公 agent 是文件 IO/进程创建密集型,
  正是 gVisor 的损耗区,上之前必须实测)。**主线不受影响**:`apps/cowork-server/` 全量 grep
  `kvm|gvisor|runsc|kata|--runtime` **零命中**,R0-R5 本就建立在硬化 runc 上,RD3 原文也把
  microVM 定为「评估项」而非前置。若将来要架构级隔离 = **换实例规格**(支持嵌套虚拟化的规格族
  或裸金属 `ecs.ebm*`),代码侧只需给 orchestrator 加 `--runtime`。
- **RD9(新增)**:无 KVM 场景的补偿加固 = **docker `userns-remap`**。零代码改动、零性能损耗,
  容器内 root 映射到宿主非特权 uid。**兼容性已逐项实测**:chown init 容器(`--cap-drop ALL
  --cap-add CHOWN`)成功、会话容器 `--user 1000` 写 volume 成功、宿主侧文件属主 = 101000。
  orchestrator **无需改动**。⚠️ **必须在装 docker 时就开** —— 事后再开要迁移已有镜像/volume
  (data-root 会变成 `<root>/<uid>.<gid>` 子目录)。

## A.5 修掉的 5 个真 bug(都是"开发者自己那台机器恰好没事"型)

**① 阿里云内网 pip 源配置从来没被真正验证过**(`53fbe68`)
`mirrors.cloud.aliyuncs.com` 的 https 证书签给 `mirrors-ssl.aliyuncs.com`/`mirrors.aliyun.com`
→ **hostname mismatch,内网源只能走 http**;而 pip 对 http 索引强制要求 `--trusted-host`,
构建期与运行期**都缺**。修三处:Dockerfile 按 scheme 自动推导 `--trusted-host`(**只在 http 时
放宽**,https 照常验证)、`orchestrator.mjs` 注入 `PIP_INDEX_URL` 时同步注入 `PIP_TRUSTED_HOST`、
`.env.example` 改正并补验证命令。根因是原文档只要求「curl 验可达性」—— **curl 通不代表 pip 能用**。
实测:`http://mirrors.cloud.aliyuncs.com/pypi/simple/pandas/` → 200/0.5s;解析 `100.100.2.148`
(100.64/10 段,**不在 egress 拦截的私网四段内**,故容器内走内网源零公网带宽成立)。

**② 镜像构建依赖 BuildKit,而多数服务器没有**(`277f15a`)
`COPY --chmod=` 要求 BuildKit,Anolis 自带 docker 24 默认 legacy builder 且内网源无 buildx 插件
→ 构建直接失败。Mac 的 Docker Desktop 默认开 BuildKit,所以一直没暴露。改为 Dockerfile 去掉
`--chmod`、由 `build-image.sh` 组装上下文时显式 `chmod`(claude 755 / 两个 py 644),两种 builder
都保留源文件权限,镜像因此可在**任何** docker 上构建。

**③ 生产机上跑 selftest-r4 会清空出网防护**(`cc68b6d`,已写进 OPERATIONS)
r4 要对比「装 egress 前后」,跑完 `DOCKER-USER` 只剩默认 `RETURN`。本次实测中招并已恢复。

**④ 账号后端 compose 完全没透传 `APP_COWORK_*`**(codeagent-server `4c6ee22`)
运维即使按 `.env.production.example` 写进 `.env` 也进不了容器,下发接口对所有人 404 ——
R5-5 交付时「接口做了、部署面没接上」。同 commit 还修了两处:示例值 `wss://` 是错的
(客户端 REST 走 `fetch(url+path)` 不支持 wss;WS 由 `https:` 推导,填 wss 反而降级成明文 ws),
以及补记灰度组对桌面端不可用(见 A.6)。

**⑤ 宿主代理变量过河进沙箱,导致别人的账号办公模式完全无响应**(`7ba9420`,2026-07-29 生产实测)
`electron/main.ts:641-668` 会**主动探测 macOS 系统代理并注入 `HTTP_PROXY`/`HTTPS_PROXY`**
(对本机跑 claude 是必要的),而两个 forwarder 的 env 白名单原样把它们送进沙箱。宿主代理
地址几乎总是 `127.0.0.1:xxxx`,进容器后 `127.0.0.1` 指向**容器自身**,claude 把每个 API
请求发往一个不存在的端口 → **出向零字节、卡 2 分 23 秒后 `exit 1`**,用户侧只看到"模型
没有任何反应",且**服务端 stderr 一片空白**(claude 没来得及报错)。
**为什么开发者自己测不出**:TUN 模式的代理软件不设系统代理(`scutil --proxy` 全 0),
探测不到就不注入;只有**系统代理模式**的机器才中招 —— 典型的"我这好好的"型 bug。
修复 = 白名单移除 `HTTP_PROXY`/`HTTPS_PROXY`/`NO_PROXY`,改动两处(两处都打进安装包):
`apps/cowork-server/client/forwarder-remote.mjs`(远程,生产路径)与
`scripts/poc/cowork/forwarder-vsock.mjs`(本地 VM —— VM 内的 `127.0.0.1` 同样不是宿主)。
**没有动 main.ts 的注入逻辑**(本机确实需要走代理),只是不让它跨过沙箱边界。
定位手法值得复用:`exec spawn env=21` 比正常的 `19` 多两个 + 容器 `NET=1.01kB/0B`
+ cred-proxy 流量零增长 —— 三个数字就锁定了"请求从未离开容器"。

## A.6 ⚠️ 六条必须记住的坑(踩过,再踩一次就是浪费时间)

1. **`APP_COWORK_ALLOWED_GROUPS` 对桌面客户端 = 总开关,必须留空。**
   桌面端走 opaque session token,`claims.groups` **恒为 `[]`**(`app/auth/security.py` 显式置空),
   而灰度判定是 `isdisjoint(claims.groups)` —— 该项非空则恒真 → **每个桌面用户都被判「组不匹配」→ 全员 404**。
   它只对 admin web 的 JWT 路径有意义。
2. **cowork-server 以非 root 跑,绑不了 80。** 走 NPM 转 8790(已如此);若非要 80,需给
   systemd 单元加 `AmbientCapabilities=CAP_NET_BIND_SERVICE`。
3. **换镜像必须先 `docker rm -f cowork-proxy` 再 restart** —— `ensureProxy` 见 running 即复用,
   否则 proxy 还挂在旧镜像上(本次实测中招:install.sh 首启时 .env 还没配 `COWORK_IMAGE`)。
4. **跑 selftest 前必须 `unset COWORK_AUTH_SECRET`**,否则 r1-r3 全 FAIL 且断言返回 `undefined`
   (不是明显的 401,极易误判成功能坏了 —— 本次就误判了一轮);同时要 `export COWORK_SERVER_HOST=127.0.0.1`
   覆盖 .env 的内网 IP。r4 自带 `r4-test-secret` 专测鉴权。完整命令见 `deploy/OPERATIONS.md`。
5. **REST 路径是 `POST /session/:id`,不是 `/session/:id/ensure`** —— 后者是设计文档里的简写,
   实现以 `index.mjs` 的 `SID_RE` 为准(`/^\/session\/([a-f0-9]{1,64})$/i`)。
6. **报「模型没反应」时的排障顺序**(别一上来怀疑鉴权/下发)。先看审计日志有没有该 uid 的
   `session_ensure`:**有 = 沙箱侧全通,问题在容器内**(下发、HMAC、网络都可以排除)。
   然后 `journalctl -u cowork-server` 找 `exec exit code=`:`code=0` 是正常回合,
   **`code=1` + 容器 `NET` 出向为 0 = 请求从未离开容器**,首先怀疑 env 污染(见 A.5 ⑤)。
   注意两点:**`exec exit` 只进 journal 不进审计日志**(只看审计会误判成"卡住没退出");
   claude 的 stderr 是 `inherit` 直通 journal,但**它可能什么都不输出** —— stderr 空
   不代表没出错。对比 `exec spawn env=N` 的 N 值是快速判据(正常 19)。
   **`code=1` 且只跑了几百毫秒**,先 grep `No conversation found` —— 见下面第 7 条。
7. **`--resume` 与退出码:2026-08-05 的静默事故,两条协议级结论。**
   ① **容器内 claude 的会话记录必须持久**。原来 `HOME=/home/agent` 是 tmpfs,而 TTL 空闲
   回收会 `docker stop`,tmpfs 每次 `docker start` 都是空的 → 客户端按本地 DB 的
   `sdk_session_id` 发 `--resume` → claude 打 `No conversation found with session ID` 并
   **~650ms 内 exit 1**。线上两天 20 次,占失败回合七成、全部回合两成。已改为独立状态卷
   `cowork-st-<sid>`(与 workspace 卷分开,"状态不进产物"由分卷保证而非 tmpfs),
   并在 `cowork-shim.py` 加兜底:transcript 不在就把 `--resume <id>` 改写成
   `--session-id <id>`,以同一个 id 新建 → 只失忆一轮,下一回合的 resume 就能命中。
   ② **退出码必须端到端还原,否则失败会变成"静默成功"**。转发器原来无条件
   `process.exit(0)`,把容器里的 exit 1 抹平;SDK 见 code 0 + stdout 零字节,既不生成
   exitError 也不产出消息 → 客户端 `for await` 一次都不进,回合无声结束,**日志一片干净**,
   全部证据只在服务端 journal 里。现在约定:**close code 1000=正常,4000+N=claude 退出码 N**
   (`exec-bridge.mjs` 发、`forwarder-remote.mjs` 还原;老转发器忽略未知 code 仍 exit(0),
   可混跑)。客户端另加两条护栏:resume 首消息**零消息即判失败**、**60s 超时**,都走既有的
   "清 sdk_session_id + 不带 resume 重跑"兜底。回归用例:
   `apps/cowork-server/selftest-forwarder-exit.mjs`(退出码映射,免 docker)、
   `container/selftest-shim-resume.py`(改写分支)、`src/__tests__/unit/cowork-resume-guard.test.ts`。

## A.7 账号后端侧(codeagent-server)—— 已全部完成并推送 main

`origin/main` 最新三条(**均已推送**):

| commit | 内容 |
|---|---|
| `aa263ae` | fix:「测试连接」改为测**表单里的待存值**而非库里已保存的(用户实测踩到:填完没保存就点测试→报"未配置") |
| `eeb1f31` | feat: **admin「办公沙箱」可视化配置页**(此前 cowork 是唯一没有管理页的模块) |
| `4c6ee22` | fix: compose 补 `APP_COWORK_*` 透传 + 修正示例 URL + 灰度说明 |

**配置页能力**(`/cowork` 路由,侧栏「办公沙箱」):开关 / 服务器地址 / 签发密钥(加密入库、
只显示掩码)/ **测试连接** / 清空回落 env。三项均 **DB 优先、env 兜底**,改完**即时生效无需重启**;
每项旁有来源标记(`本页配置` / `环境变量兜底`)。
「测试连接」用当前表单值签 token 真打沙箱 `/health`,**区分三种失败**:连不上 / 可达但密钥不被
认可(401)/ 非预期状态码 —— 密钥不一致是最难查的故障(用户侧只有 401 且不提示原因)。

对应服务端:`app/admin/cowork.py`(GET/PUT/POST probe/DELETE)+ `app/cowork/service.py` 新增
`cowork_enabled` 键(DB 三态,未设回落 `APP_COWORK_ENABLED`)+ `resolve_enabled/server_url/auth_secret`。
测试:`tests/cowork/` 共 **32 passed**;全仓 122 passed。

## A.8 ✅ 已完成的验证(不必重做)

- **四套 selftest 在 x64 + userns-remap 上全过,共 25 项**(r1 编排/WS exec 4 · r2 文件通道 8 ·
  r3 凭证代理 7 · r4 authz/配额/出网 6)—— 这是「裸金属迁移三件套」的第一件。
- **真实会话全链**:`POST /session/<hex>` 起容器(uid 1000 / NanoCpus 2e9 / Mem 2g)→
  **容器内 `pip install humanize` 走内网源真装上并可 import** → 出网策略实证(内网 10 段与
  NPM 所在 172 段均被拒、公网放行)→ `DELETE` 三方归零。
- **镜像内容**:claude 2.1.203 可执行、权限 755/644/644、办公依赖全部可 import(pandas 3.0.5)、
  中文字体 4 个、以 uid 1000 非 root 可跑。
- **账号后端**:本地起真后端 + 真 admin web,保存生产配置后用户侧 `/api/v1/cowork/config`
  **立刻从 404 变 200**(无需重启);页面「测试连接」真打香港沙箱返回 ok;故意填错密钥/错地址/
  wss:// 三种情况均给出准确诊断。
- **🎯 生产端到端验收(2026-07-29,真实账号 + 打包客户端)** —— 四条通道全通:
  ①下发:客户端日志 `cowork config synced: url=https://cowork-server.ai-native-lab.com hasToken=true`,
  DB 落 `cowork_backend=remote` + 215 字符密文 token;
  ②鉴权:`/api/cowork/status` 用**真实下发 token** 打沙箱 `/health` → `usable:true`
  (**这一步才证明 admin 页填的密钥与沙箱 `.env` 逐字符一致**,密钥错的唯一表现是全员 401 且不提示原因);
  ③执行:`session_ensure → cred_issued(+0.5s) → exec_start(+3.5s) → exec exit code=0`,
  第二轮 `(reused)` 复用容器;④文件通道:`file_download /workspace/1.md (294B)`。
  **交叉验证**(排除"其实跑在本地"):客户端显示的 `Python 3.14.6` 与 `294 B` 同沙箱内实物逐字节吻合,
  宿主卷属主 `101000`(userns 生效),容器 `User=1000:1000 / CapDrop=[ALL] / no-new-privileges`。
  **UUID 格式 uid 已实测**:此前测试用的都是 `alice` 这类短串,而账号后端签发的是用户 UUID(含连字符);
  `UID_RE = /^[a-zA-Z0-9._:-]{1,128}$/` 兼容,容器与卷 label 原样保留、清理归零。
  **多用户已验证**:两个不同 UUID 的账号各自起容器互不干扰(开通是全局的,不按账号发)。

## A.9 🔜 还剩什么(按优先级)

**① ~~在 admin 页开通~~ ✅ 已于 2026-07-29 完成**(验收结果见 A.8)。
配置方法留档,**换密钥/换地址/重建环境时照此操作**:
```bash
# 服务器上(账号后端 codeagent-server)
git pull && docker compose up -d --build backend     # --build 必须(含前端页面)
```
admin →「办公沙箱」→ 地址填 `https://cowork-server.ai-native-lab.com`(不带端口/尾斜杠、
**不要填 `wss://`**)+ 密钥(取自沙箱服务器 `/opt/cowork-server/.env` 的 `COWORK_AUTH_SECRET`)
→ **先点「测试连接」看绿色再保存**(密钥错会让全员 401 且不提示原因)→ 打开「开通状态」。
**`APP_COWORK_ALLOWED_GROUPS` 必须留空**(原因见 A.6 ①)。开通是**全局**的,不按账号逐个发。
生效判据:客户端日志由 `cowork config not provisioned for this account (404) — skipping`
变为 `cowork config synced: url=... hasToken=true`(登录时或每 10 分钟轮询)。

**② LabCodepilot `vm_cowork` 有若干 commit 未推送**(**别照抄数字,以 `git log origin/vm_cowork..HEAD` 为准**
—— 本文档此前写死"4 个"已被证伪:实际还压着**技能市场 Phase 0/1、image-studio 修复**等
与 cowork 无关的更早工作,推分支会把它们一并推上去,推之前先看清楚)。**push 需用户明确指示。**

**③ R5-6 Windows 真机实测**(等机器)。代码侧全完成:NSIS 免管理员(`perMachine:false` +
`packElevateHelper:false`)、非 darwin 平台诚实降级 gate、forwarder+ws 会进 win 包。
真机清单:装测零 UAC / forwarder `ELECTRON_RUN_AS_NODE` spawn .mjs / 完整办公回合。

**④ 裸金属迁移三件套 —— 实际已消解 2/3**:x64 重跑 selftest ✅ 已完成;KVM 隔离评估 → RD3 已否决;
TLS 真网联调 → NPM 已承担并实测。**故此项基本可关闭。**

**⑤ 长尾**:`vm_cowork` 合回 main(用户拍板);技术债 #30(cred-proxy 拒绝无观测信号);
审计日志 UI 查看面;办公会话标题旁模式徽标;guest 磁盘用量可视化。

## A.10 运维速查

```bash
ssh cowork-prod                                   # 上机
systemctl status cowork-server cowork-egress      # 服务
journalctl -u cowork-server -f                    # 日志
docker ps --filter label=cowork.managed=1         # 受管容器(cowork-proxy + 会话容器)
iptables -S DOCKER-USER | grep -c cowork-egress   # 出网规则,应为 5
# 手工签 token(联调用;生产由账号后端签)
sudo -u cowork sh -c 'set -a; . /opt/cowork-server/.env; node /opt/cowork-server/sign-token.mjs <uid>'
# 升级镜像后
docker rm -f cowork-proxy && systemctl restart cowork-server
```
运维/IT 手册全文:`apps/cowork-server/deploy/OPERATIONS.md`(含 10 类审计事件、排障表、
密钥轮换 = 全量 token 失效、selftest 三坑)。

---

> 产品思考见 [docs/insights/cowork-vm-mode.md](../insights/cowork-vm-mode.md)
> 调研与 P0 结论:[docs/research/cowork-local-vm-mode.md](../research/cowork-local-vm-mode.md)
> 执行计划(进度/决策日志,均已完成):[docs/exec-plans/completed/cowork-vm-mode.md](../exec-plans/completed/cowork-vm-mode.md)(P1 底层)+ [cowork-office-mode.md](../exec-plans/completed/cowork-office-mode.md)(办公模式 E1-E5)+ [cowork-remote-container.md](../exec-plans/completed/cowork-remote-container.md)(R 系列远程容器,RD1-RD8)
> POC 脚手架说明:[scripts/poc/cowork/README.md](../../scripts/poc/cowork/README.md)
>
> **本文件目标:让接手者读完即可完整理解 cowork 办公模式、并立刻接上未完成的工作,无遗漏。**
> ⚠️ **以下 §0-§9 为历史全貌,部分结论已被 §A 取代**(最显著的三处:①「账号后端下发接口待做」——
> 实际早已完成**并已上线**,且 admin 可视化配置页也已做完;②「裸金属/KVM」——实际服务器无 KVM,
> 见 RD3 修正;③「等外部条件」清单已大幅收窄。**以 §A 为准。**)
>
> 最后更新:2026-07-17 · 分支 `vm_cowork`(HEAD 以 git log 为准;R 系列已推送 origin 至 `c02f564` = R4+R5-1..4 全推齐;**R5-5/R5-6/R5-7 commit 未推送**)· 状态:**cowork 战略转向 —— 全平台统一「远程容器沙箱」(R 系列),取代本地 VM**。macOS 本地 vfkit(3.1.18 已交付)与 Windows WSL2(P2)都退为保留/挂起(代码不删,RD1)。**R 系列 R0-R5 代码侧全完成(exec-plan 已归档 completed/);剩余=等外部条件:R5-6 Windows 真机实测(等机器)、账号后端下发接口(契约见 exec-plan R5-5)、裸金属迁移三件套;后续候选之一「自建会话镜像」已完成 ✅(2026-07-17):`apps/cowork-server/image/`(Dockerfile+build-image.sh)把 claude+shim+cred-proxy 烘进 `cowork-sandbox` 镜像(tag 自动取 claude 版本,实测 2.1.203/537MB),开关 `COWORK_IMAGE_BUNDLED=1` 跳过全部宿主 bind(默认关零破坏,容器内路径不变零协议改动);**VM 已切 bundled 为常态**,selftest r2/r3/r4 全 21 项 PASS+生产实例容器挂载只剩 volume;**镜像已含办公依赖预装(2026-07-20,10M 共享带宽省流关键)**:pandas/openpyxl/xlsxwriter/python-docx/python-pptx/pdfplumber/pypdf/matplotlib+Noto CJK/pillow/requests/tabulate(537MB→1.16GB,日常任务零运行时 pip 下载)+ pip 三层源(运行期 COWORK_PIP_INDEX_URL 注入容器 env——阿里云配内网源零公网带宽 > 镜像 /etc/pip.conf 公网阿里源 > 构建期 COWORK_BUILD_PIP_INDEX),流程与部署日实测清单见 OPERATIONS §9;坑=切/升级镜像须先 `docker rm -f cowork-proxy` 再 restart(ensureProxy 见 running 即复用),存量会话容器 TTL/删除后才换新镜像;流程见 deploy/OPERATIONS.md §9。其余候选=gVisor·Kata 评估 RD3/凭证方案 C。**
>
> **当前节点与下一步(接手先读这段;远程容器是当前主线,本文档 §1-§9 的本地 vfkit 内容为"保留态背景",不是当前活跃路径)**:
>
> 1. **战略转向(2026-07-16 用户拍板)**:用户办公电脑实测 BIOS 虚拟化禁用+无管理员+**IT 明确不给开虚拟化** → WSL2 本地路线对公司场景死亡(核实见 [research/cowork-p2-windows.md](../research/cowork-p2-windows.md) §8:装应用免管理员 vs 启用 VMP 需 IT 一次性=正交;免 VMP 无可信隔离方案)。为 mac/win 体验一致,mac 本地 vfkit 一并退场,**全平台统一远程容器**。**先读两份**:执行计划 [exec-plans/completed/cowork-remote-container.md](../exec-plans/completed/cowork-remote-container.md)(已归档)(RD1-5 决策 + R0-R5 分期 + CoworkBackend/cowork-server 设计 + 复用不删清单 + 每阶段验收)+ 调研 [research/cowork-remote-container.md](../research/cowork-remote-container.md)(架构映射 + 外部硬事实 + R0 实测)。**决策 RD1-5**:RD1 全平台远程(弃本地活跃/代码保留)、RD2 单公司裸金属服务器账号下发(不开放个人自配)、~~RD3 裸金属有 KVM 隔离可升 gVisor/Kata~~ → **RD3 已修正(2026-07-28)**:实际服务器是无嵌套虚拟化的阿里云 ECS,Kata/gVisor-KVM 出局,长期方案 = 硬化 runc + **RD9 userns-remap**(已生产实测,零代码改动),gVisor systrap 留作可选、**RD4 凭证先 A(客户端交 key 给服务端内存)预留 C(服务端向账号后端直取),B 反向隧道不做**、RD5 单点诚实降级。
>
> 2. **R 系列进度 + R5 待做**:**R0 ✅** 通道 POC(真 claude 经完整链路 BRIDGE_OK;代码 scripts/poc/cowork/remote/)。**R1 ✅**(commit `371c40b`/`599b6fb`/`cd99730`/`aa87674`):控制面 + CoworkBackend 接口双实现 + claude-client 切 remote + dev 端到端真 claude。**R2 ✅ 文件通道全完成**:R2-0 workspace 换**会话专属持久 named volume**(volume 也打 cowork labels 进事实源,reconcile 扫容器∪volume;首建用一次性 init 容器 chown uid 1000,**必须 `--cap-add CHOWN`**——cap-drop ALL 连 root 的 CHOWN 都剥,踩过;chown 失败即回收 volume 防半初始化卡死;**HOME 挪 tmpfs /home/agent**,防 claude 状态文件混进持久 volume 被当产物;⚠️ **2026-08-06 已推翻:改为独立状态卷 `cowork-st-<sid>`**——tmpfs 每次 `docker start` 都是空的,TTL 空闲回收 stop 一次就丢掉 claude 的会话记录,客户端的 `--resume` 随即必挂且报错被 forwarder 抹平成静默无响应(线上占两成回合);"状态不进产物"改由"独立卷"保证,与持久性不再冲突,见 commit `400cfac` 与 `apps/cowork-server/container/cowork-shim.py` 的 `rewrite_stale_resume` 兜底);R2-1 cowork-server 文件 REST 四 op(`POST/GET /session/:id/file|files|archive`,**短命 helper 容器直读 volume,会话容器不用醒**;helper=python one-liner 复刻 daemon 语义:path 沙箱视角 `/workspace/...`、mtime 毫秒、递归含 dotfiles、archive tar.gz `arcname=.`、读 op 容器内 realpath 权威校验 exit 3/4→404/403、写 op `.part`+字节数校验+原子 rename 防半截文件;DELETE 会话改为连 volume 一起清,**volume rm 加 4 次短退避**防在飞 helper 竞态);R2-2 `cowork-backend-remote.ts` 四文件 op 落地(fetch 流式,错误保留 "No such file"/"escapes" 归类词供 route 映射 404/403);R2-3 artifacts route **去 vfkit 硬依赖**(唤醒分支 `ensureRunning`→`backend.ensureReady`,remote 下永不为下载多起容器);R2-4 验证=VM selftest-r2 **8 项全过**(含符号链接逃逸 403/容器删后仍可读/孤儿 volume reconcile)+ dev 真 claude 全链(上传附件→容器读改→产物卡 3 文件→单下/archive 落盘字节对→会话删除容器 volume 归零)+ CDP(办公列表/卡片渲染/刷新 DB 恢复/console 干净)+ 单测 1948 零回归。**R3 ✅ 凭证代理**(commit 见 git log,未推送):**关键决策 RD6 —— 代理从"宿主进程"下沉为"sidecar 容器"**。原因:docker 场景"容器→宿主网关"不可靠(验证 VM 因 k8s/kube-router 残留 iptables,容器→宿主任何 IP 全超时,而容器↔容器恒通;企业防火墙同理)。方案:`cowork-proxy` sidecar 容器(`apps/cowork-server/container/cred-proxy.py`,python)与会话容器同处专用网络 `cowork-net`,claude `ANTHROPIC_BASE_URL=http://cowork-proxy:8791`;真 key 只在 proxy 容器 **tmpfs `/creds`**,cowork-server 经 **`docker exec` stdin** 注入(不走网络、不落宿主盘);会话容器只拿一次性 `cwk_` token。威胁模型与 P3-B 等价(proxy 容器可信、不跑 agent、不碰不可信文件)。app 侧 `cowork-backend-remote.ts` registerCredentials→POST cred、revoke→DELETE,会话删除走 `backend.revokeCredentials`(去 cowork-proxy 直依赖)。验证:**selftest-r3 7 项全过**(api_key/auth_token 双风格注入+host 重写+path 保留+SSE 流式+错/缺 token 401+revoke+会话删除联动+审计零 key/token 泄漏,全在 cowork-net 真容器间)+ dev 真 claude 回合 success+/creds 有会话 token 文件+会话容器无真 key+DELETE 联动清空+单测零回归;claude **拒绝自证 env**(安全对齐),凭证隔离由"回合 success+token 文件+selftest 白盒"三重独立证据确证。**坑**:docker cp 到 tmpfs 挂载点被遮盖→cred-proxy.py 改 bind-mount(:ro,R5 烘镜像后去掉)。**R4 ✅ 多用户/配额/出网**(已推送):**决策 RD7 —— HMAC 签名 token authz**(用户拍板)。`lib/authz.mjs` 简化 HS256(`base64url(JSON{uid,exp?}).base64url(HMAC_SHA256(secret,payload))`,不引依赖),server 只需 `COWORK_AUTH_SECRET` 验签取 uid **无状态不存用户表**;密钥空=authz 关闭回退单用户(dev 兼容);R5 由账号后端同密钥签发 per-user token。会话打 `cowork.uid` label,所有 op 校验归属跨用户 **404 防枚举**,reconcile/list 按 uid scope;`sign-token.mjs` 签发工具。**配额**:`--cpus`(mem/pids 已有)+ **TTL 空闲回收**(仅 exec 续命、有活跃 exec 连接不回收;超时 `docker stop` 保留 volume,下次 ensure `docker start` 复用)。**出网禁内网**:`setup-egress.sh`(root 跑,幂等,建议 systemd 开机自启,cowork-server 不需 NET_ADMIN)装 DOCKER-USER 规则——固定网桥名 **cowork0**(建网 `--opt com.docker.network.bridge.name=cowork0`),`-i cowork0 -o cowork0 RETURN` 放行内部(会话容器↔cred-proxy)+ 私网四段 REJECT(10/8、172.16/12、192.168/16、169.254/16);host-network 靠强制会话容器 `--network cowork-net` 杜绝。`cowork-guards` 系统提示补"内网被拒"边界。验证:**selftest-r4 6 项全过**(authz 401/scope 404/--cpus/TTL stop 复用/reconcile scope/出网内网拦公网放)+ dev 真 claude 在 **authz+egress 双开**下 success + agent 容器出网实测(10/172/192 三内网段 REJECT 计数命中、公网 OPEN、cred-proxy OPEN)+ 单测 1948 零回归。**坑**:cowork0=172.18/16 标准 docker 网段**无生产冲突**(内部靠"同网桥 RETURN"放行与网段无关,真 API 须在公网否则 egress 加定向放行);验证 VM 有 flannel/cni0(10.42.x)k8s 残留但不影响;**SSH 多层引号会 mangle 内联 python → 用文件跑 probe**。**下一步 = R5(七步重排,RD8:UTM VM 即假裸金属,买服务器非前置)**:R5-1 ✅ forwarder-remote.mjs+ws 整包进 extraResources(c62df18;ws 不可换 Node 内置 WebSocket,握手需自定义 Bearer 头)→ R5-2 ✅ 3.1.19 打包版连 VM 全链实测(hostname=容器短哈希+uid 1000 双指纹/产物卡+下载逐字节比对/会话删除三方归零/authz+配额生效;坑=adhoc 重签包首启卡钥匙串授权静默等待,输密码放行,正式固定签名无此问题)→ R5-3 ✅ 部署包 apps/cowork-server/deploy/(install.sh 幂等 + cowork-server/cowork-egress 两 systemd 单元 + .env.example + TLS 反代预留 caddy;VM 实测迁 systemd 后两单元 enabled+active+端到端全过;index.mjs 加 COWORK_SERVER_HOST;坑=sudo 下 npm 的 .js symlink 不识别→ws 优先源直拷、SSH ControlMaster 复用致跨调用错乱→部署类远程操作用单次原子 ssh)→ R5-4 ✅ 运维手册 deploy/OPERATIONS.md(服务管理/密钥轮换=全量 token 失效/审计 10 事件表/巡检/排障表/升级迁移;核出盲区:cowork-proxy 运行中误删不自动重建,restart server 才重建;**复查修正**:剔除幽灵事件 cred_reject(audit.mjs 注释 R3 预留但代码零触发点,已修注释+文档+tech-debt #15),VM deploy/ 缺 README/OPERATIONS 已重装同步)→ R5-5 ✅ 客户端侧账号下发全链(复刻 image-config 范式:client fetch encrypted 优先→broker sync/purge→route 校验落三键 backend=remote,token 密封;main 五触发点+登出双 purge;**404=未开通→跳过不清配置**保 dev 三键后门;4 单测+mock 七步过。待后端:GET /api/v1/cowork/config[/encrypted] 200={server_url,token} 404=未开通,token 用 COWORK_AUTH_SECRET 签同 sign-token.mjs;**服务端开发文档已交付:codeagent-server/docs/cowork-config-api.md**——含客户端固化契约/接口规范/token 精确格式+Python 参考实现+经 authz.mjs 真实验签的 golden 向量/三级存储设计/groups 灰度/落地文件清单/pytest+联调验收)→ R5-6 🔄 代码侧全完成(平台 gate:status route 非 darwin+未下发 remote→assets.overall='unsupported',CoworkAssetsAction/设置页只出「公司远程沙箱提供」说明绝不给下载按钮——堵住 win 引导下载 mac vfkit 资产的死路;remote 分支在前不受挡;i18n 三语 remoteOnlyPlatform;4 单测+CDP mock 双页验证。核实:NSIS 免管理员早已配好 perMachine:false+packElevateHelper:false、CI windows-2022 现成 workflow_dispatch 触发、forwarder+ws 会进 win 包;.cmd 作废见 RD8)。**仅剩真机实测等 Windows 机**:装测零 UAC/forwarder spawn/完整回合→ R5-7 双文档归档合流。**RD8 沙箱粒度(用户拍板):维持容器 per 会话 + uid 归属隔离,不做每用户常驻容器**;裸金属迁移三件套后置=x64 重跑 selftest/KVM 评估/TLS 联调。
>
> 3. **VM 环境(R0-R4 的"远程服务器",已就绪可直接 SSH 迭代)**:UTM Ubuntu 26.04 arm64(15G/8核,有 KVM),SSH 别名 **`cowork-vm`**(192.168.64.9,免密 key `~/.ssh/cowork_vm_poc` + 免密 sudo 已配,用户 `fer`);装了 docker 29 + node v22 + claude arm64 二进制。**cowork-server 常驻**:`~/cowork-server`(scp 自 `apps/cowork-server/`,node_modules/ws 单独 scp),**R5-3 起已迁 systemd**:`systemctl start/restart/status cowork-server`(+ `cowork-egress`),日志 `journalctl -u cowork-server -f`;部署/升级用 `apps/cowork-server/deploy/install.sh`(装到 `/opt/cowork-server`,`.env` 随机密钥,两单元 enabled 开机自启)。~~旧手动方式 `setsid nohup node index.mjs`(已停用)~~。绑 `*:8790`(**Mac↔VM vmnet 直连,免端口转发**)。`/home/fer/cowork-poc` 放 claude + cowork-shim.py(bind `:ro` 进容器 `/opt/cowork`)。改 server 代码 → scp 到 VM 重起(R3 起 `container/` 目录也要 scp:`ssh cowork-vm 'mkdir -p ~/cowork-server/container' && scp container/*.py cowork-vm:~/cowork-server/container/`)。**杀/重起 server 用 `fuser -k 8790/tcp` 清端口,绝不 `pkill -f "node index"`(会匹配 ssh 自己 bash-c 命令行 → 自杀 → ssh exit 255,已踩)**。**R3 起 server 启动会 ensureProxy**:自动建 docker 网络 `cowork-net` + 起 `cowork-proxy` sidecar 容器(bind-mount `container/cred-proxy.py:ro`);会话容器都接入 cowork-net。**真服务器已到位并完成勘察(2026-07-28)**:阿里云 ECS `47.243.237.188:40022` root,SSH 别名 **`cowork-prod`**(专用密钥 `~/.ssh/cowork_prod`,密码只用于一次性装公钥)。Alibaba Cloud Linux 4.0.4(OpenAnolis,**dnf 系非 apt**,`install.sh` 只检查 docker/node/iptables 故天然兼容)/ x86_64 / 32 核 Xeon / 60Gi 内存(**无 swap**)/ 系统盘 40G + **数据盘 1TB 已格式化 ext4 挂 `/data`(写入 fstab)**。**无 KVM 已复验**(见 RD3 修正)。已装 docker 24.0.9(内网源,零公网带宽)+ containerd 1.7.29 + runc 1.2.8,**data-root=`/data/docker`、userns-remap 已开**(RD9)。**待做**:换 x64 claude 二进制重建 `cowork-sandbox` 镜像(现有镜像是 Mac 上构建的 arm64)→ 跑 deploy/install.sh → x64 上重跑 selftest r1-r4 → 配 admin service_secrets 开通下发。**内网 `172.24.185.132/20` 与 cowork0(172.18/16)不冲突**;阿里云内网源解析到 `100.100.2.148`(100.64/10),**不在 egress 私网四段内 → 容器内走内网源零公网带宽成立**(已实测)。**⚠️ 这台验证 VM 被历史 k8s/kube-router 污染(死 iptables 规则,无活进程):容器→宿主任何 IP 全超时,但容器↔容器/容器→公网正常——这正是 R3 代理必须走 sidecar 容器(RD6)而非宿主进程的直接原因;干净裸金属无此问题,但也印证了"不该依赖容器→宿主网关"。**连通性自检法**(部署前跑):宿主起个 http server 绑网关/主 IP,`docker run` 一次性容器 curl 它——超时=容器→宿主被拦(该机需查防火墙/iptables),200=可达。**
>
> 4. **dev 端到端验证配方(R1-4 实证)**:① unseal 解主密钥(§8 配方:electron safeStorage 解 `~/.codepilot/secret.key.enc` → 64hex;打包版开着时脚本必须 `app.setPath('userData', 独立临时目录)` 避免 ProcessSingleton 锁互斥;**macOS 无 `timeout` 命令,别用**)→ `CLAUDE_GUI_SECRET_KEY=<hex> PORT=3000 npm run dev`(解密 managed 凭证);② DB 设 `cowork_backend=remote` + `cowork_remote_url=http://192.168.64.9:8790`(`sqlite3 ~/.codepilot/codepilot.db`);③ 建 sandbox 会话带 model+provider_id(现存 managed provider,如 `sonnet`/`managed-0836...`)发消息,SSE 看 `result subtype:success` + cowork-server log `exec exit code=0`。**验证完必删 `cowork_backend`/`cowork_remote_url` 恢复 vfkit 默认**——dev 与打包版共用 `~/.codepilot/codepilot.db`,remote 设置会让用户正在跑的打包版办公模式也走 remote。
>
> 5. **R1-4 抓到的两个真 bug(R2+ 沿用别重踩)**:① **容器内 claude 必须非 root** —— 办公 full_access → SDK 带 `--dangerously-skip-permissions`,claude 安全限制禁"root+该参数"→ 秒退;`orchestrator.mjs` 用 `--user 1000` + `HOME=/workspace` + tmpfs workspace(claude `cwd=/workspace`)。这提前落实了 P3-A"非 root 跑 claude"方向。② **shim 用 `os._exit`** —— claude 秒退后 shim 的 pump_in daemon 线程仍阻塞 stdin,Python 解释器 finalize 时 `_enter_buffered_busy` SIGABRT(exit 134);shim 结尾 `os._exit(rc)`(stdout 已 flush)。
>
> 6. **远程容器新增文件地图**(本地 vfkit 文件地图见 §2):**服务端** `apps/cowork-server/`(`index.mjs` HTTP+WS 入口(REST+文件四 op+cred 路由)/ `lib/orchestrator.mjs` 容器+volume+接入 cowork-net 编排 / `lib/files.mjs` 文件通道 helper 容器四 op(R2)/ `lib/cred-proxy.mjs` 凭证代理编排+exec 注入(R3)/ `lib/audit.mjs` 服务端审计(R3)/ `lib/exec-bridge.mjs` WS 帧桥 / `client/forwarder-remote.mjs` WS 转发器 / `container/cowork-shim.py` 容器内解帧器 / `container/cred-proxy.py` cred-proxy sidecar(R3,python)/ `selftest-r1.mjs`+`selftest-r2.mjs`+`selftest-r3.mjs`);**应用侧** `src/lib/cowork-backend.ts`(接口+`getCoworkBackend` 工厂,await import 延迟加载,设置 `cowork_backend` 选实现)+ `cowork-backend-remote.ts`(活跃)+ `cowork-backend-vfkit.ts`(现有 vm-manager/vsock/proxy 包成 adapter,保留);**改动** `cowork-transfer.ts`(10 函数委托 backend,签名全稳定)、`cowork-poc.ts`(`decideCowork(sessionId, sandboxEnabled)` 走 backend)、`claude-client.ts`(cowork 分支切 backend)、`api/cowork/status/route.ts`(按 backend.kind 分);**R0 POC** `scripts/poc/cowork/remote/`。
>
> 7. **其他待定**:vm_cowork 合回 main(40+ commit,R 系列又加 8 个);R 系列 commit **未推送**(push 等用户明确指示)。用户 untracked 文件 `docs/user-manual/`、`image-config-server-verification.md`、`scripts/dev/docker-win-build.sh`,**commit 绝不 `git add -A`**(踩过,当场 amend 移出)。P2 WSL2 计划已挂起(远程容器取代),`scripts/poc/cowork/remote/wsl-probe.ps1` 留档备个人 Windows 场景。newapi POC key(`sk-XyYJ...`)每次 dev 验证用完即弃,**提醒用户在 newapi 后台轮换**。

---

## 0. 这是什么 / 为什么

参考 Anthropic 官方 Claude Cowork,给本应用加**「办公」模式**:侧边栏对话列表上方有「办公 / 研发」双栏切换(参照 Claude 桌面版 Home/Code)——研发 = 原有的一切(项目分组、文件树/Git/任务面板、宿主执行);办公 = 沙箱会话,底层仍是 Claude Agent SDK,但 agent 的文件工具(Read/Write/Bash…)**只作用于一台本地 Linux 虚拟机内**,碰不到用户真机文件。办公会话不绑项目文件夹、列表平铺;用户通过对话发文件 → 自动进 VM 的会话专属工作区 → agent 读改建 → 产物卡片下载回真机;不同会话的产物按 sessionId 天然隔离。模式在**建会话时定死**(所在 tab 决定),会话内不可切换。全程真机零写入(除应用数据目录 + 用户主动下载,已系统性验收,见 §8.5)。

**与官方 Cowork 的关键差异**:官方用 VirtioFS 双向挂载真机目录(agent 改动实时落回真机);我们用**拷贝语义**(上传/下载各拷一次,VM 与真机文件系统零共享面)——隔离更彻底,也更简单。

---

## 1. 核心架构:转发桥(宿主 SDK 不动,把 CLI 进程放进 VM)

关键洞察:Agent SDK 的工具**永远在 CLI 进程所在的机器上执行**。所以不改 SDK,只把 SDK spawn 的"claude 可执行文件"换成一个转发器,让真正的 claude 跑在 VM 里。

```
Next server(宿主)                                     VM guest(Debian, aarch64)
┌─────────────────────────────┐                      ┌────────────────────────────┐
│ claude-client.ts             │                      │ cowork-daemon.py (vsock     │
│  └ SDK query()               │                      │   监听 CID_ANY:1024)        │
│     pathToClaudeCodeExecutable│  vfkit vsock         │   每连接 = 一个 op           │
│     = forwarder-vsock.sh ─────┼── connect 模式 ──────┼→  exec → spawn ~/bin/claude │
│        └ node forwarder-vsock │  (unix socket        │        (linux claude,       │
│           .mjs → 连 unix sock)│   透明字节代理,      │         stream-json stdio)  │
│                              │   无握手无魔数)       │   cwd=/home/agent/sessions/ │
└─────────────────────────────┘                      │        <id>/workspace       │
        │ IPC 无关(见 §5)                            └────────────────────────────┘
        └ cowork-vm-manager.ts(server 侧单例)负责 vfkit 生命周期
```

数据流(一次沙箱回合):
1. `/api/chat` 收到消息,`claude-client.streamClaudeSdk` 进入 cowork 分支(`decideCowork`)。
2. `decideCowork` → `ensureRunning()`:VM 没起就生成 seed + spawn vfkit,轮询 vsock 到 daemon 就绪(daemon 由 cloud-init 首启注入、systemd 开机拉起;claude binary 缺则 vsock 推入。阻塞到就绪,期间发 `vm_status` SSE)。
3. 附件经 vsock `writeFile` 推入 VM workspace;prompt 里的文件路径改写成 VM 内路径。
4. SDK spawn `forwarder-vsock.sh`(它 exec `node forwarder-vsock.mjs`),转发器连 vsock,发 `exec` header,把 stdin/stdout 与 VM 内 claude 对接。
5. claude 在 VM 内跑 stream-json,输出经 vsock→转发器→SDK。
6. 回合结束:`listNewFiles` diff 出 workspace 新增/改动文件 → 落库(`vm_artifacts_json`)+ 发 `vm_artifacts` SSE → 前端产物卡片。
7. 用户点下载 → `/api/cowork/artifacts` → vsock `readFile` 流式拉出。

---

## 2. 文件地图(每个文件的职责)

**应用内(src/,随包分发)**
| 文件 | 职责 |
|---|---|
| `src/lib/cowork-poc.ts` | `decideCowork(sandboxEnabled)`:两重门(会话 `sandbox_enabled` + `backend.ensureReady` 就绪;vfkit 另加本地资产门)→ 返回是否走沙箱 + 转发器路径 + 连接 env。**async**(会等沙箱就绪)。**原先还有一道全局 `cowork_enabled` 门,已随办公模式转正删除**(见下方「设置键」)。 |
| `src/lib/cowork-vm-manager.ts` | VM 生命周期**单例**(挂 globalThis 抗 hot-reload)。`ensureRunning()`(懒启动/复用/崩溃重建,幂等+并发安全 startingPromise)、`getStatus()`、`markSessionActive/releaseSession`(空闲回收计数)、`stop()`、`onVmProgress()`(P1-D 进度发射器)、`provisionGuest()`(M1:health 拿 version/claude,binary 缺则 vsock 推入)。**M1 起零 SSH**:就绪判定=轮询 vsock health,DHCP/`parseLeaseIp`/sshOk/scp 全删,`VmStatus` 不再有 ip 字段。 |
| `src/lib/cowork-seed.ts` | **M1 新增:cloud-init seed 生成**。`SEED_TEMPLATE_VERSION`(决定 instance-id → 升级触发器)、`EXPECTED_DAEMON_VERSION`(跨层单测锁 daemon 版本)、`buildUserData`(daemon base64 内嵌 + systemd unit + mask ssh,纯函数)、`buildMetaData`、`ensureSeedIso()`(hdiutil makehybrid 造 cidata ISO,内容寻址缓存+旧版清理)、`resolveDaemonSource()`(原 hostDaemonPath 迁入)。 |
| `src/lib/cowork-paths.ts` | **M3 新增:路径单一事实源**。资产目录正式化 `~/.codepilot/cowork-poc` → `cowork-assets`(模块加载时 renameSync 原子迁移,幂等;双存在用新告警,失败回退老);全部规范路径常量(IMAGE/CLAUDE/EFI/PID/CONSOLE/VSOCK/marker);`bundledCoworkResource()`(AILAB_RESOURCES_PATH/cowork 解析随包资源)、`vfkitBin()`(bundled 优先→PATH)。**server-only,勿被客户端组件引用**。 |
| `scripts/bundle-vfkit.mjs` | **M3 新增**:构建期从 brew 拷 vfkit 进 vfkit-bundle/(挂 electron:build 链),强校验 virtualization entitlement,缺失即构建失败。 |
| `src/lib/cowork-assets.ts` | **M2 新增:资产下载器**(server 侧单例)。manifest 常量:底镜锚定 dated build `20260712-2537`(**绝不锚 latest**,单测锁)双源 USTC+官方 + sha512;claude=`@anthropic-ai/claude-agent-sdk-linux-arm64` **与宿主 SDK 同版本**(`CLAUDE_SDK_VERSION` 单测锁 package.json)npmmirror+npmjs 双源,integrity 取 registry 元数据。引擎:Range 断点续传(.part+续传前重哈希前缀)、sha512 流式校验(失败删 .part 防死循环)、源不支持 Range→200 回退清零重下、`statfs` 磁盘预检、镜像落位后 `truncate` 稀疏扩容 8GiB(guest growpart 吃满)、claude tgz 系统 tar 解包。`getAssetsStatus()/assetsReady()/startAssetsDownload()(幂等)/cancelAssetsDownload()(保留 .part)`。**IMAGE_PATH/CLAUDE_BIN_PATH 是资产路径单一事实源**(vm-manager 从这里 import)。 |
| `src/lib/cowork-proxy.ts` | **P3-B 新增:宿主凭证注入代理**(server 侧单例)。真 managed key 只在内存 Map;绑 vmnet 网关 `192.168.64.1:8788`;`registerSession`(签发 `cwk_` 一次性 token,幂等)/`revokeSession`/`ensureProxyRunning`/`discoverGatewayIp`。请求处理:校验来源 vmnet 网段+token→剥→注入真 key(authStyle)→https 转发真 base_url→SSE 流式回。**真 key 永不进 VM**。 |
| `src/lib/cowork-audit.ts` | **P3-C 新增:宿主侧安全审计**。append-only `audit.log`(凭证签发/废止、文件进出、VM 生命周期);best-effort 永不抛;`readRecentAudit`。宿主是 VM 唯一出入口,日志 VM 攻陷改不了。 |
| `src/hooks/useCoworkStatus.ts` | **M2 新增:状态共享 hook**。拉 /api/cowork/status;`overall==='downloading'` 期间 2s 轮询;监听 `cowork-status-changed`/`cowork-assets-changed`;`startDownload/cancelDownload` 封装 + 广播。使用方:OfficeEmptyCard(内部自持)、GeneralSection、ChatView(D4 禁发)。 |
| `src/app/api/cowork/assets/route.ts` | **M2 新增**:POST=开始下载(显式触发 D3,幂等)/DELETE=取消。进度经 status 轮询。 |
| `src/lib/cowork-vsock.ts` | 宿主侧 vsock RPC 客户端。连 vfkit 的 unix socket,发 JSON header + body。导出 `vsockHealth`(M1 富探测 {ok,version,claude})/ `vsockHealthy` / `rpcInstallBinary`(M1:createReadStream 推流,253MB 级)/ `rpcMkdirWorkspace` / `rpcWriteFile` / `rpcListFiles` / `rpcRemoveSession` / `rpcReadFileStream` / `rpcArchiveStream`。`readJsonHeader` 处理 close/超时(见 §9 bug①)。 |
| `src/lib/cowork-transfer.ts` | 文件通道**对外契约层**(claude-client / artifacts route 依赖这些签名):`sessionWorkspace` / `vmChannelReady` / `ensureSessionWorkspace` / `pushFileToVm` / `listNewFiles` / `assertPathInWorkspace`(host 侧廉价早拒)/ `readFileStream` / `archiveStream` / `removeSessionDir`。内部全部委托给 cowork-vsock。 |
| `src/app/api/cowork/artifacts/route.ts` | 产物 API。`?list=1`(读库,VM 休眠也可用,懒迁移;**VM 在线时对账剔除已删文件并回写**,E4.2)、`?path=`(下载单文件,VM 离线时 ensureRunning 唤醒)、`?archive=1`(打包)。错误统一脱敏。 |
| `src/app/api/cowork/status/route.ts` | 可用性状态(E3):`{enabled, imageProvisioned, vmPhase}`,只读探测绝不触发 VM 启动,fail-closed。供双栏可见性 gate、办公空态、设置页提示。 |
| `src/lib/cowork-guards.ts` | **E1 执行层守卫纯逻辑**:`buildSandboxUnavailableError`(reason→结构化错误,含"没有在真机上执行任何操作"隔离尾注)、`SANDBOX_NATIVE_RUNTIME_GUARD`(412 响应体)、`buildSandboxSystemNote`(沙箱回合能力边界系统提示)。 |
| `src/lib/cowork-staging.ts` | **E2 办公暂存目录**:`~/.codepilot/cowork/<sessionId>/` 的 path/ensure/remove(hex 校验;删除只按 sessionId 推导路径,绝不读 working_directory —— 防误删遗留 POC 会话绑的真实项目目录)。 |
| `src/components/layout/ChatListPanel.tsx` | **双栏主战场(E3)**:「办公/研发」分段控件(`activationMode="manual"`,防 focus 误触)、按 `sandbox_enabled` 切分列表(办公平铺/研发分组互斥)、办公新建流(POST sandbox_enabled:1)、tab 记忆(localStorage `codepilot:workspace-tab`)、切 tab 主区跟随(E4.1)、监听 `cowork-status-changed` 即时显隐。 |
| `src/components/layout/OfficeEmptyCard.tsx` | 办公空态卡:sidebar 变体(列表区)+ landing 变体(/chat 主区,E4)。镜像未预置时显示提示不给按钮。 |
| `src/components/chat/VmArtifactsCard.tsx` | 产物卡片(输入框上方)。文件列表 + 单文件/打包下载;VM 休眠徽标 + 下载自动唤醒 spinner;**下载 404 → toast + 触发 `vm-artifacts-refresh` 重拉**(E4.2)。 |
| `src/components/chat/VmProvisioningBanner.tsx` | P1-D 冷启动横幅。`vm_status` 的 starting/booting/provisioning 显示"沙箱准备中",ready 清除,failed 显示重试。 |
| `src/hooks/useSSEStream.ts` | 加了 `onVmArtifacts` / `onVmStatus` 回调 + `vm_artifacts` / `vm_status` case。**vm_artifacts 空表必须放行**(E4.3:快照语义,空表=清卡)。 |
| `src/components/chat/ChatView.tsx` | 组装:产物卡/横幅挂载、`sandboxEnabled` 下发 MessageList/MessageInput、快照**整表替换**、回合完成自动重拉清单(E4.3)、办公隐藏 ModeIndicator/权限选择器。 |
| `src/hooks/usePanel.ts` + `AppShell.tsx` + `UnifiedTopBar.tsx` | `isOfficeSession` 信号(E4):/chat/[id] 载入会话时设置;一处 gate 压制 PanelZone 全部侧板;顶栏四按钮+项目文件夹 chip 办公隐藏。 |
| `src/hooks/useSlashCommands.ts` + `MessageInput.tsx` | `officeMode`(E4/E4.1):隐藏斜杠/CLI 按钮;输入 `/`、`@` 不触发补全弹窗(办公传空 workingDirectory 走既有优雅降级)。 |
| ~~`src/components/settings/GeneralSection.tsx` + `api/settings/app`~~ | ~~设置页「办公模式(Cowork 沙箱)」开关(E5)~~ —— **已删除**:办公模式转正后不再是实验功能,开关连同其下的沙箱资产下载区一并从设置页移除(资产下载在办公首页空态卡里仍有同一个组件)。设置页现已与 cowork 无关。 |
| `scripts/poc/cowork/fs-audit.sh` | 真机零写入**强验收脚本**(E5):sudo fs_usage 包装,按进程树过滤写调用、剔除豁免面,violations 应为空。 |
| `src/lib/stream-session-manager.ts` | snapshot 加 `vmArtifacts` / `vmStatus` 字段 + 回调。**注意 `buildSnapshot()` 是字段白名单**——加快照字段必须同步列进去(见 §9 bug④)。 |
| `src/components/chat/ChatView.tsx` | 组装:沙箱开关状态、产物卡片、准备中横幅、消息内 DiffSummary 在沙箱下隐藏(传 `sandboxEnabled` 给 MessageList/MessageItem)。 |
| `src/lib/claude-client.ts` | cowork 分支(约 775–847 行):`decideCowork` → 设 `pathToClaudeCodeExecutable` + 注入 env(`COWORK_SESSION_ID/VSOCK_PATH/NODE_BIN` + `ELECTRON_RUN_AS_NODE=1`)→ 推附件 → 回合末 diff 产物落库+发 SSE。订阅 `onVmProgress` 转 `vm_status`。 |
| `src/lib/db.ts` | `chat_sessions` 加列 `sandbox_enabled`(INT)、`vm_artifacts_json`(TEXT)。函数:`updateSessionSandboxEnabled`(清 sdk_session_id)、`getSessionVmArtifacts` / `mergeSessionVmArtifacts` / `setSessionVmArtifacts` / `mergeVmArtifactLists`(纯函数,单测覆盖)。 |
| `src/types/index.ts` | `SSEEventType` 加 `vm_artifacts`/`vm_status`;类型 `VmArtifactFile`、`VmStatusEvent`;`SessionStreamSnapshot` 加 `vmArtifacts`/`vmStatus`。 |
| `src/__tests__/unit/cowork-vm-manager.test.ts` | parseLeaseIp、decideCowork 安全早返回、mergeVmArtifactLists、状态面 no-throw 单测。 |

**POC 脚手架(scripts/poc/cowork/,不随包分发,靠绝对路径引用 —— 见 §8 打包说明)**
| 文件 | 职责 |
|---|---|
| `cowork-daemon.py` | **guest 侧 vsock RPC 守护进程**(Python3,标准库)。协议见 §4。 |
| `forwarder-vsock.sh` | SDK 当 claude spawn 的入口;`exec "$COWORK_NODE_BIN" forwarder-vsock.mjs "$@"`。 |
| `forwarder-vsock.mjs` | vsock exec 转发器:连 unix socket、发 exec header、stdin 帧封装(§4)、stdout 裸流。 |
| `vm-up.sh` | 手动启停 VM(dev 调试用;带 vsock 设备)。`start\|stop\|ip\|ssh`。 |
| `sdk-probe.mjs` | P0 时代的 SDK 探针(历史,验证用)。 |
| `forwarder-ssh.sh` / `forwarder-local.mjs` | **已废弃**(P1-C 前的 SSH/本地转发器)。保留作参照,运行时已不用。 |

---

## 3. VM 生命周期(cowork-vm-manager.ts)

- **放 server 侧而非 electron main**:`npm run dev`(主要验证环境)没有 main 进程,也没有 server→main 消息通道;dev 与打包版共用同一套逻辑,claude-client 直接 import 调用。代价:VM 与 next-server 同生命周期。
- **状态机**:`stopped → starting → running → crashed`。`ensureRunning()` 幂等 + 并发安全(共享 `startingPromise`)。
- **启动(镜像流水线 M1 起全 vsock,零 SSH)**:沙箱首条消息触发 → `ensureSeedIso()`(cowork-seed.ts 生成 cloud-init seed,内容寻址缓存)→ spawn vfkit(挂底镜 + 生成的 seed + vsock 设备)→ **轮询 vsock health 即就绪**(daemon 由 cloud-init 首启注入的 systemd unit 开机拉起;老盘实测 ~5s,虚拟首启含 cloud-init 注入更久,READY_TIMEOUT 240s)→ `provisionGuest()`(health 一次拿全 version/claude:binary 缺 → vsock `installBinary` 流式推入)。宿主全程不需要知道 VM 的 IP(DHCP 租约反查/`parseLeaseIp`/sshOk/scp 已全部删除)。
- **健康**:每 20s vsock health,双探失败 → crashed(下条消息 ensureRunning 自动重建)。
- **空闲回收**:活跃会话计数(markSessionActive/releaseSession)归零 15 分钟 → stop。
- **退出清理**:process exit/SIGTERM/SIGINT 关掉本进程起的 VM(不留孤儿);spawn 前 reap 无法连通的 pidfile 孤儿。
- **进度**:`onVmProgress` 模块级发射器(挂 globalThis),在 starting/booting/provisioning/ready/failed 各点 emit,claude-client 订阅转 `vm_status` SSE。

---

## 4. vsock 通道协议(P1-C 核心,踩坑最多)

**vfkit 配置**:`--device virtio-vsock,port=1024,socketURL=<POC>/vsock-1024.sock,connect`。`connect` 模式 = guest daemon 当 server、宿主连 unix socket。**vfkit 是透明字节代理:无 Firecracker 式 `CONNECT` 握手、无魔数**,连上即裸流,应用层协议自定。(网上说的 "VFKT 魔数" 是 gvproxy 网络栈的东西,与 vsock 无关。)

**daemon 协议**(每连接首行 JSON header `\n` 结尾;daemon v2 起 health 带版本与执行面状态):
```
{"op":"health"}                                  -> {"ok":true,"version":N,"claude":bool}\n
{"op":"mkdirWorkspace","sessionId"}              -> {"ok":true,"path"}\n
{"op":"writeFile","sessionId","name","size":N}   -> 读 N 字节 -> {"ok":true,"path"}\n
{"op":"installBinary","name","size":N}           -> 读 N 字节(流式直写 .part+原子替换)-> {"ok":true,"path"}\n
{"op":"listFiles","sessionId","since":ms}        -> {"ok":true,"files":[{path,name,size,mtime}]}\n
{"op":"readFile","sessionId","path"}             -> {"ok":true,"size":N}\n + N 字节
{"op":"archive","sessionId"}                     -> {"ok":true,"size":N}\n + N 字节(tar.gz)
{"op":"removeSession","sessionId"}               -> {"ok":true}\n
{"op":"exec","sessionId","argv":[],"env":{}}     -> 见下
错误 -> {"ok":false,"error":"..."}\n
```
installBinary 的 name 走 daemon 侧白名单(仅 `claude` → `~/bin/claude`),绝不接受路径;
v1 daemon(SSH 时代)health 无 version 字段,宿主 provisionGuest 据此走兼容路径(跳过
binary 检查,VM 重启后经新 seed 自动升 v2)。**版本纪律:改 cowork-daemon.py 必须同步
bump DAEMON_VERSION + cowork-seed.ts 的 SEED_TEMPLATE_VERSION/EXPECTED_DAEMON_VERSION**
(跨层单测锁定;instance-id 随模板版本变化,cloud-init 才会在已有磁盘上重跑注入)。

**exec 通道(关键)**:spawn claude 后双向管道。**stdin 方向做 `[uint32 BE 长度][字节]` 帧封装 + 长度 0 的 EOF 标记;stdout 方向裸流。** 为什么:vfkit 不可靠传播 TCP 半关闭(host `sock.end()` 的 FIN 到不了 guest),不能靠 recv 返回空判定 stdin 结束。SDK 单轮结束关 forwarder stdin → forwarder 发长度 0 帧 → daemon 关 claude stdin → claude 退出 → SDK 迭代器结束 → `done`。连接被非正常断(abort)→ 帧读到中途 EOF → daemon 杀 claude。**这是修卡死 bug 的核心机制,改这块务必理解(§9 bug②③)。**

**安全**:sessionId 强制 hex 校验;readFile 经 daemon 内 `realpath` + workspace 前缀判定防逃逸(权威校验在 guest 侧,文件真身在那);host 侧另有廉价 `..` 早拒。

---

## 5. 数据模型 / 接线点

- **DB**(`chat_sessions`):`sandbox_enabled` INTEGER 0/1 —— **单一事实源**(D1):同时驱动列表归栏、UI 压制、执行判定;创建期经 `createSession(..., sandboxEnabled)` 落库,**建后不可改**(PATCH 返回 400 `SANDBOX_MODE_IMMUTABLE`,E5)。`vm_artifacts_json` TEXT(回合末**权威快照覆盖**落库,E4.2;不再只增 merge)。
- **办公会话的宿主 cwd**:合成暂存目录 `~/.codepilot/cowork/<sessionId>/`(D2,POST 无 working_directory 且 sandbox_enabled 时服务端生成),附件沿既有链路落 `<暂存>/.codepilot-uploads/`;权限创建期定 `full_access`(D3)。删除会话三级级联:DB 行 + 宿主暂存目录 + VM 会话目录(后者 best-effort,兜底见 daemon 对账)。
- **SSE 事件**:`vm_artifacts` —— **回合末权威全量快照**(E4.2/E4.3:总是发、含空表;前端整表替换,空表=清卡;useSSEStream 不得加长度守卫);`vm_status`(冷启动进度 + 硬失败 failed)。
- **daemon 对账**(E4.1):op `reconcileSessions {keep}` —— VM 每次 ready 后宿主带全量现存会话 id fire-and-forget 调用,删除 guest 内 DB 已不存在的 hex 目录(堵"休眠期删除会话"的孤儿残留,防 guest 磁盘占满)。
- **设置键**:~~`cowork_enabled`~~ **已废弃并从代码中删除** —— 它曾是必须为 `'true'` 的全局门,但账号下发链路(`setCoworkRemoteConfig`)从不写它,导致每个新开通的用户都被自己的客户端挡成「沙箱启动失败」(reason `cowork_disabled_globally`,线上工单实证)。现在开通与否只由配置下发决定,DB 里的存量残留值无人读取、无需迁移。`cowork_forwarder_path`(仍指旧 ssh 路径,`forwarderPath()` 同目录解析 vsock 版,无需改)。
  事件 `cowork-status-changed` 仍在(资产下载启停等仍会广播),只是不再有开关写入它。
- **前端状态**:localStorage `codepilot:workspace-tab`('dev'|'office');事件 `workspace-tab-changed`(tab 同步,双向)、`cowork-status-changed`(设置变更)、`vm-artifacts-refresh`(清单重拉)。
- **env 过河**(claude-client 注入 queryOptions.env,forwarder 白名单透传):`COWORK_SESSION_ID`、`COWORK_VSOCK_PATH`、`COWORK_NODE_BIN`(= `process.execPath`)、`ELECTRON_RUN_AS_NODE=1`。
- **凭证**:managed provider key 经 provider-resolver 注入 SDK env,不落 VM 磁盘(沿用现有"env 过河"纪律)。

---

## 6. 资产布局(`~/.codepilot/cowork-assets/`,不进 git,不随包;M3 起全部应用自管)

```
images/debian-12-genericcloud-arm64.raw    # Debian 底镜(应用内下载:中科大源,3GB;落位后稀疏扩到 8GiB)
images/installed-image.json                # 已装底镜版本戳(build/sha512;legacy 懒栽种)
images/seed-codepilot-v<N>-<hash8>.iso     # 代码生成的 cloud-init seed(daemon+systemd 注入,内容寻址,旧版自动清)
bin/package/claude                         # linux-arm64 claude binary(应用内下载:npmmirror SDK 平台子包,经 vsock 推入 guest)
bin/package/installed-claude.json          # 已装 binary 版本戳(=宿主 SDK 版本)
efi-variable-store                         # vfkit EFI 变量(镜像升级换盘时重置)
vfkit.pid / vm-console.log                 # 运行时状态
vsock-1024.sock                            # vfkit 暴露的 vsock unix socket(VM 跑时存在)
```
**零手动预置(3.1.17)**:新机器装 DMG → 设置页/办公首页点「下载沙箱环境」即可,vfkit/daemon/forwarder 随包分发(Resources/cowork/)。老机器的 `cowork-poc` 目录由 cowork-paths.ts 首次触达自动迁移为 `cowork-assets`(内含遗留 seed.iso/ssh/ 已无用,可手动清)。流水线全貌见 docs/exec-plans/completed/cowork-image-pipeline.md。

---

## 7. 已完成 / 未完成

### 已完成
- **P0 POC**:转发桥拓扑证实(stream-json 跨 VM 无损、工具调用读写 VM 文件、真机隔离、中断)。
- **P1-A 文件通道**(`53c6ebc`):附件进 VM 会话工作区、回合产物 diff、产物卡片下载(单文件/打包)、路径校验、错误脱敏。
- **P1-A+ 产物落库**(`ca508ef`):`vm_artifacts_json` 落库,历史会话 VM 休眠仍显示卡片(列表读库),下载按需唤醒 + 休眠徽标。修用户反馈"打开旧会话看不到产物"。
- **P1-B VM 生命周期管理器**(`f87d8a4`):懒启动/健康/崩溃自愈/空闲回收/退出清理,去掉手动 vm-up.sh。
- **P1-C 通道产品化**(`f7a8a6d`):Python3 guest-daemon + vsock 替代 SSH 运行时通道。SSH 仅剩一次性 provisioning。
- **P1-D 就绪状态机**(`91737a3`):`vm_status` 事件贯通 + "沙箱准备中"横幅,修冷启动静默"生成中"疑似卡死。
- **两个用户反馈修复**:消息内产物卡在沙箱下隐藏 + 下载唤醒转圈(`ce7408e`);产物卡片实时性(`e9c50ff`)。
- **一个卡死 bug 修复**(`e0dfb51`):vsock exec 流 stdin EOF 语义(见 §9 bug②③)。

### 已完成 —— 办公模式 E1-E5(P1-E 重定义,方案见 cowork-office-mode.md)
- **E1 执行层守卫**(`66e09ca`):沙箱回合 VM 不可用 → 硬失败终止,绝不落宿主(修 POC 的"安全回退"隔离违约);native runtime 分发前 412 拒绝;外部 MCP 全部剔除(仅留 in-process codepilot-*)+ 能力边界系统提示注入。
- **E2 数据与创建流**(`bbdce87`):创建期指定 sandbox_enabled;办公暂存目录 `~/.codepilot/cowork/<id>/`;full_access 默认;删除级联清暂存目录。
- **E3 侧边栏双栏**(`eebac7e`):「办公/研发」分段控件(manual 激活)、列表互斥切分、办公新建流、空态卡、tab 记忆、/api/cowork/status。
- **E4 办公会话 UI 面**(`3e731d6`):isOfficeSession 信号;隐藏矩阵全压制(PanelZone/顶栏四按钮+文件夹 chip/首开文件树/ModeIndicator/权限选择器/斜杠 CLI 按钮/@ 引用/RewindButton);**SandboxToggle 退役删除**;/chat 落地页办公 landing。
- **E4.1 实测反馈修复**(`b80fe7d`):办公输入 `/` 不弹窗;CLI 工具预填跳转强制切研发;切 tab 主区跟随;**daemon reconcileSessions 对账**(guest 孤儿目录清理,实测 keep=53 removed=1 零误伤)。
- **E4.2 产物删除对账**(`fb9b288`):回合末权威快照替代只增合并;list 端点在线自愈;下载 404 toast+重拉。
- **E4.3**(`ed6d4fe`):useSSEStream 空快照放行(纯删除回合清卡的根因)+ 回合完成自动重拉兜底。
- **E5 正式化收尾**:设置页「办公模式(Cowork 沙箱)」开关(写 cowork_enabled、双栏即时显隐、镜像未预置警示);PATCH sandbox_enabled 锁定(400 SANDBOX_MODE_IMMUTABLE);真机零写入验收(见 §8.5)+ fs-audit.sh 强验收脚本;本双文档。

### 已完成 —— 镜像流水线 M1(2026-07-14,计划见 exec-plans/active/cowork-image-pipeline.md)

- **M1 首启自注入 + SSH 全退役**:cowork-seed.ts 生成 cloud-init seed(daemon base64 + systemd unit + mask ssh,instance-id=模板版本);daemon v2(health 带 version/claude + installBinary 流式落盘);vm-manager 删光 SSH/DHCP 链,就绪=轮询 vsock,binary 缺则 vsock 推入。四项实测:老盘 cloud-init 重跑升级、处女盘(中科大新下+sha512 核验)97s 首启全链路、二次启动 daemon ~5s、SSH 密钥挪走全程零影响;guest 内取证 sshd inactive+masked、daemon active+enabled、binary 时间戳=当次推入。

### 已完成 —— 镜像流水线 M2(2026-07-14)

- **M2 宿主下载器 + UI 下载引导**:cowork-assets.ts(manifest 锚定 dated build `20260712-2537` + sha512;claude 平台子包与宿主 SDK 同版本走 npmmirror)、/api/cowork/assets、useCoworkStatus hook、设置页/办公空态「下载沙箱环境(约 3.2 GB)」按钮+进度条、D4 下载中办公 composer 禁发+提示、E1 守卫文案演进为下载引导。实测:3GB 全程下载→校验→就绪翻回;取消/续传(前缀重哈希被最终校验硬证明);npmmirror 无 Range 的 200 回退真实触发;稀疏 8GiB+growpart 吃满(guest df 7.7G);新下载盘 41s 回合 E2E。**至此新机器只差 vfkit(brew)一项手动前置,M3 内置后归零。**

### 已完成 —— 镜像流水线 M3(2026-07-14)

- **M3 打包正式化**:①资产目录 `cowork-poc`→`cowork-assets`(cowork-paths.ts 首触原子迁移,本机实测无感);②daemon/forwarder/vfkit 随包(Resources/cowork/,解析 bundled→设置→仓库三级)——**打包版脱离仓库绝对路径依赖 + 免 brew 前置**;③**大坑实证:electron-builder 签名剥 vfkit 的 virtualization entitlement** → `mac.signIgnore` 跳过 + after-sign.js 防回归校验/自愈(修后包内 vfkit 与 brew 原件逐位一致);④版本追踪 installed-*.json(懒栽种)+ 设置页「下载新版沙箱环境」+ `usable` 语义(升级下载不误禁办公);⑤daemon v3(health 带 claudeSize,宿主大小比对不符重推 —— SDK 升级后 guest binary 偏斜自愈),老盘经 instance-id v2 重灌取证 DAEMON_VERSION=3。

### 已完成 —— 镜像流水线 M4(2026-07-15)

- **M4 裸机模拟验收**(见 §8.6):全新资产目录 + dev 以 3.1.17 包 Resources 为解析源 + 仓库运行时脚本全部藏起 → 回合成功唯一可能是包内资源;spawn 日志+ps 双证包内 vfkit 起 VM,包内 daemon 生成 seed,包内 forwarder 跑通;升级面 usable/upgradeAvailable CDP 验证。

### 已完成 —— P3 安全强化 M1-C(2026-07-15,计划见 exec-plans/active/cowork-p3-security.md)

> 威胁模型转变:E1-E5+流水线保护"真机";P3 保护"凭证与数据"——办公模式把不可信文件喂给 agent,提示注入可指挥它干权限内的坏事。**用户拍板范围:每会话隔离 + 凭证不进 VM + 审计;明确不做出网白名单(接受 agent 自由上网)。**

- **P3-A 每会话非特权用户**(`f7d1cd6`):daemon 提权 root(seed User=root),exec claude 时降权到会话专属 Linux 用户 `cw_<id[:12]>`(幂等 useradd -M -r nologin),workspace/home chown 给它 + chmod 700,兄弟会话从文件系统权限层面穿不过(`<id>` 700)。文件 op 由 daemon(root)执行,上传下载不受影响;removeSession/reconcile 带 userdel。daemon v4/seed v3。VM 实测:会话 B cat/ls 会话 A 目录均 Permission denied,自己 workspace 正常。**副产物修三个升级健壮性 bug**(见 §9 坑20):seed instance-id 内容寻址、runcmd restart 替代 enable --now、就绪判定加 root 门(vsockRootReady)。
- **P3-B 宿主代理注入 token**(`714840b`,POC `4377aed`):真 managed key 只留宿主 `cowork-proxy` 内存,VM 里的 claude 只拿按会话签发的一次性 token(`cwk_`+24 字节 hex)。**NAT 网关方案**(实测 guest→宿主网关 192.168.64.1 可达,免 HTTP-over-vsock 复杂度,daemon 不参与代理链故不改):proxy 绑 `192.168.64.1:8788`,claude base_url 指它;proxy 校验来源 vmnet 网段+token→剥→注入真 key(按 authStyle)→https 转发真 base_url→SSE 流式回。claude-client cowork 分支覆盖 env 为 token+代理地址(真 key 不过河);DELETE 会话 revokeSession。VM 实测:VM 内 `ANTHROPIC_API_KEY=cwk_…(len=52,token 非真 key)`、`BASE_URL=http://192.168.64.1:8788`,回合正常。**边界:只代理 claude API,通用出网走 NAT(自由上网)。**
- **P3-C 安全审计 + 收尾**:cowork-audit.ts 宿主侧 append-only 审计(凭证签发/废止、文件进出 VM、VM 生命周期;宿主是 VM 唯一出入口,日志 VM 攻陷改不了,且不用改 daemon)。落 `~/.codepilot/cowork-assets/audit.log`(JSON Lines,8MB 软截断)。

### 未完成 —— P2 + 明确不做 + 小项

- **明确不做**:出网白名单(用户接受 agent 自由上网风险;白名单会让画图装包/查网页失效)。
- **P2 Windows/WSL2(已立项待开工,2026-07-15)**:计划 [exec-plans/active/cowork-p2-windows.md](../exec-plans/active/cowork-p2-windows.md) + 调研 [research/cowork-p2-windows.md](../research/cowork-p2-windows.md)。**通道选型已定=`wsl.exe -e` stdio 模型**(不走 vsock —— WSL2 上裸 vsock 非免 admin;stdio 与当前架构天然契合:"一次连接=一个 op"→"一次 wsl.exe -e=一个 op",forwarder→spawn wsl.exe,daemon op 逻辑含 P3-A setuid 全复用,daemon 加 --stdio 入口)。**关键约束:W0 通道 POC + W2-W7 实测必须 Windows 机器**(开发机 macOS);W1 平台后端抽象(guest-backend 接口 + daemon --stdio)可在 macOS 做且零回归 —— 是不阻塞 Windows 环境的开工起点。**最大安全落差**:WSL2 隔离弱于 vfkit(#12443 automount 可被提权 PowerShell 绕过,官方 issue 仍 open),D1 已定接受"策略级隔离+诚实文案"先交付。POC 待攻破:exec 的 EOF 半关闭语义(WSL #4424)决定去/留帧封装。
- **明确不做**:出网白名单(P3,用户接受 agent 自由上网);Hyper-V HCS(P2);mirrored networking 依赖(P2,砍 Win10 用户);WSLC GA 等待(P2,先交付)。
- **小项待办**:审计日志 UI 查看面(现只落盘,readRecentAudit 已备)、办公会话标题旁的模式徽标(可选)、guest 磁盘用量可视化。

---

## 8. 如何运行 / 验证 / 打包(完整命令)

**前置**:node 是 nvm 管理的,Bash 默认 PATH 里没有 → 每条命令前 `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"`。

**dev 起服务(需要解密密钥才能用 managed 凭证)**:
```bash
# 1. 解封主密钥(打包版 keychain 里的 Safe Storage;unseal.js 每次可按下方配方重建)
npx electron <unseal.js 路径> /tmp/mk.tmp   # 输出 UNSEAL_OK
# 2. 带密钥起 dev
CLAUDE_GUI_SECRET_KEY=$(cat /tmp/mk.tmp) PORT=3000 npm run dev
```
unseal.js 完整配方(scratchpad 会被清,丢了照这个重建;**每一步都必要**):
```js
const { app, safeStorage } = require('electron');
const fs = require('fs'); const os = require('os'); const path = require('path');
app.setName('codepilot');   // keychain service 名跟 app name 走,必须是 codepilot
// 关键(坑13):userData 挪独立临时目录 —— 打包版 App 开着时共用
// ~/Library/Application Support/codepilot 会在 ProcessSingleton 锁上无限排队
app.setPath('userData', path.join(os.tmpdir(), 'codepilot-unseal-' + process.pid));
app.whenReady().then(() => {
  const enc = fs.readFileSync(path.join(os.homedir(), '.codepilot', 'secret.key.enc'));
  const hex = safeStorage.decryptString(enc).trim();
  if (!/^[0-9a-f]{64}$/i.test(hex)) { console.error('UNSEAL_FAIL'); app.exit(2); return; }
  fs.writeFileSync(process.argv[2], hex, { mode: 0o600 });
  console.log('UNSEAL_OK'); app.exit(0);
});
```
测试会话创建注意(坑14):脚本/curl 建会话**必须带 model + provider_id**(UI 会自动带 localStorage 的 last-model/last-provider-id,裸建的会话没有凭证面 → VM 内 claude 秒退:init 正常但 result is_error、0 token、~15ms)。可用值参考现存会话:`sqlite3 ~/.codepilot/codepilot.db "SELECT model,provider_id FROM chat_sessions WHERE provider_id!='' LIMIT 1"`。

**手动起/停 VM(dev 调试)**:`bash scripts/poc/cowork/vm-up.sh start|stop`。但**正常路径是让应用自动起**(P1-B):dev 起好后,发沙箱消息即自动 spawn。

**验证沙箱(CDP)**:开沙箱会话(DB `sandbox_enabled=1` + `cowork_enabled='true'`)→ 发消息 → 看 VM 自动起、产物卡片、下载。冷机验 P1-D 横幅要先 `pgrep -f 'vfkit --cpus' | xargs kill -9` 停 VM。**精确数 VM 进程用 `pgrep -f 'vfkit --cpus'`**(别用 `ps|grep vfkit`,会匹配到自己的命令行,曾误判"双 VM")。

**打包(macOS arm64)**:
```bash
npm version 3.1.x --no-git-tag-version   # bump
rm -rf release/ .next/
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm run electron:build && node scripts/bundle-chromium.mjs && npx electron-builder --mac dmg --arm64 --config electron-builder.yml
# 产物:release/AI Native Lab-3.1.x-arm64.dmg
# electron:build 链自动执行 scripts/bundle-vfkit.mjs(本机需 brew 装 vfkit,
# 缺失或 entitlement 不齐会构建失败);afterSign 日志应出现
# "bundled vfkit entitlements intact (virtualization OK)"(坑18 防回归哨兵)
```
**打包后必做**:`npm rebuild better-sqlite3` —— 打包会把 better-sqlite3 编成 Electron ABI,dev/test 用 node ABI 会崩(见 §9)。

**测试**:`npm run test`(typecheck + 单元,~5s)。当前 1940 passed。

### 8.5 真机零写入验收记录(E5,2026-07-14)

- **弱验收(快照对比,已执行,通过)**:dev + 真实 managed 凭证,VM 冷启动,一轮完整办公回合 —— 上传 audit-input.csv → agent 在 VM 内读取、qty 翻倍、另存 doubled.csv → 产物接口下载并核验内容正确。`find $HOME -newer <T0>` 对比用户数据区(豁免面:`~/.codepilot` 应用数据、`~/Library` 系统/应用缓存、`~/Downloads` 下载落点、开发工具 dotfiles、本仓库),**违规 0 条**。同轮实测 daemon 对账 keep=55 removed=0。
- **强验收(系统调用级,脚本就绪)**:`sudo bash scripts/poc/cowork/fs-audit.sh` —— fs_usage 全量写调用按本应用进程树过滤、剔除豁免面,violations.log 应为空。需 root,交由使用者在打包版上执行。
- 局限:快照法无法按进程归因(违规为 0 时无归因需求);fs_usage 法可归因但需 sudo。

### 8.6 镜像流水线裸机模拟验收记录(M4,2026-07-15)

- **设置**:`cowork-assets` 整体挪空(全新目录)+ dev 以 3.1.17 包的 `Resources/` 为解析源(AILAB_RESOURCES_PATH)+ **仓库运行时脚本(daemon/forwarder×2)全部藏起** —— 回合成功的唯一可能是包内资源。
- **通过项**:claude 二进制应用内真下载(npmmirror,含版本戳);办公回合 49s 零错误;**spawn 日志与 ps 双证 VM 由包内 vfkit 启动**;fresh 目录的 seed 由包内 daemon 生成;包内 forwarder 跑通 stream-json;guest 取证 instance-id v2 / DAEMON_VERSION=3 / daemon active / ssh masked / df 7.7G;产物下载逐字正确。升级面:伪造旧 build → `usable=true + upgradeAvailable=true`(办公不受扰)→ 设置页升级按钮+提示渲染(CDP)→ 恢复。
- **如实注明**:底镜 3GB 下载环节引用 M2 全程实证(挪走双资产→下载→校验→首启→回合,含取消/续传与 Range 回退);本次跑到 75% 后按用户指示中止、从备份克隆,避免重复下载。升级换盘的执行段(停 VM+EFI 重置+原子 rename)为代码审阅级,组件(stop/rmSync/renameSync/truncate)均在其他路径单独实证。
- 意外收获:验收窗口 `cowork_enabled` 被外部清空,E1 硬失败守卫真实触发(结构化错误+隔离尾注,零宿主执行)——守卫链拿到一次生产级实证。

---

## 9. 踩过的坑 / 关键陷阱(改代码前必读)

1. **`readJsonHeader` 挂死(P1-C)**:daemon 未监听时 vfkit accept 宿主连接后**立刻关闭**(裸代理连不到 guest);只处理 data/error 不处理 close → 永久挂起 `ensureDaemon` 首探。修:close/end → reject + 读超时。
2. **daemon `pump_out` 缓冲(P1-C)**:`proc.stdout.read(N)` 阻塞到攒够 N 或进程退出,把 stream-json 小块增量全缓冲住,SDK 等不到 init 响应 → claude 挂死。修:改 `os.read(fd)` 真流式。
3. **exec 流卡在"生成中"(P1-C 卡死 bug)**:vfkit 不传播半关闭 → daemon 收不到 stdin EOF → claude 不退出 → SDK 迭代器不结束 → 无 `done`。修:stdin 方向帧封装 + 长度 0 EOF 标记(§4)。
4. **`buildSnapshot` 白名单漏字段**:stream-session-manager 每次广播前按字段白名单重建 snapshot;新加的 snapshot 字段(vmArtifacts/vmStatus)**必须同步列进 buildSnapshot**,否则被静默丢弃(产物卡片曾因此切走再切回才显示)。
5. **provision `pkill -f cowork-daemon.py` 自杀**:命令行含 python3 路径 → pkill 匹配到自己那条 launch 命令 → 自杀,daemon 起不来。修:bracket trick `[c]owork-daemon.py` + 拆独立 ssh 调用。
6. **better-sqlite3 ABI**:打包 → Electron ABI;dev/test 需 `npm rebuild better-sqlite3` 回 node ABI。每次打包后都要 rebuild 才能继续 dev/test。
7. **forwarder 需要 node 但打包版 Electron 无独立 node**:用 `COWORK_NODE_BIN=process.execPath` + `ELECTRON_RUN_AS_NODE=1`,forwarder.sh 用它跑 .mjs,不依赖 PATH。
8. **SSH 已 100% 退役(镜像流水线 M1,2026-07-14)**:provisioning 改为 cloud-init seed 首启自注入(daemon+systemd),binary 走 vsock installBinary,新 seed 灌过的 guest 里 sshd 被 mask。**代价:guest 无 SSH 调试通道** —— 观测手段=沙箱会话里让 agent 跑命令带出结果(systemctl/ls/cat 均可),或 git revert 回老链路;vm-console.log 因 guest 内核未把 console 指到 virtio-serial 长期为空(P1 时代已如此),别指望它。
9. **decideCowork 是 async**:会阻塞到 VM 就绪(冷启动数秒~数十秒)。沙箱首条消息因此慢是正常的,P1-D 横幅就是给这段做反馈。
10. **vm_artifacts 空表不得吞(E4.3)**:事件语义是"回合末权威全量快照",空表 = 纯删除回合清卡的关键载荷。useSSEStream 曾残留 `length>0` 守卫吞空快照 →"只删文件的回合卡片不刷新"。改事件链任何一层都不要加长度守卫;ChatView 是整表替换不是合并。
11. **Radix Tabs 默认 automatic 激活 = focus 即切换**:侧边栏双栏必须 `activationMode="manual"`,否则 Tab 键路过/a11y 遍历就切视图并写 localStorage(CDP 实测误触)。另:程序化 `.click()` 不触发 Radix 激活(挂在 mousedown),测试要派发完整鼠标事件序列。
12. **pkill 自匹配自杀**:`pkill -f xxx` 的模式若出现在当前 shell 命令行里会杀掉自己(daemon provision 与本地调试都踩过)。bracket trick(`[x]xx`)或拆独立调用。
13. **unseal 脚本 vs 运行中的打包版 App**:两者同 app name(codepilot)→ 同 userData → Chromium ProcessSingleton 锁互斥,打包版开着时 unseal 无限排队(实测挂一小时)。unseal.js 必须 `app.setPath('userData', <独立临时目录>)`(keychain service 名只跟 app name 走,不受影响)。
14. **裸 API 创建的会话没有凭证面**:UI 创建会自动带 localStorage 的 last-model/last-provider-id;curl 直接 POST 不带 → 会话落到默认模型且无 managed provider → VM 内 claude 秒退(init 成功但 result is_error、0 token、~15ms)。测试脚本创建会话务必带 model + provider_id。
15. **别名模型(如 claude-opus-4-8[1m])在办公回合**:同上一条一起排查过 —— 模型面问题的表象都是"init 正常 + 秒退",先查会话的 model/provider_id 再怀疑通道。
16. **三处版本必须同步 bump(M1 seed 注入纪律)**:改 `cowork-daemon.py` → 必 bump 它的 `DAEMON_VERSION` + `cowork-seed.ts` 的 `EXPECTED_DAEMON_VERSION`(跨层单测锁,忘了会挂测试)**和 `SEED_TEMPLATE_VERSION`**(这个单测锁不住:instance-id 不变则 cloud-init 不重跑,已有磁盘永远拿不到新 daemon,表象=健康探测 version 落后告警)。write_files/runcmd 是 per-instance 语义,这是升级机制的全部。
17. **npmmirror 对 npm tarball 不支持 Range**(M2 实测):带 Range 头请求返回 200 全量 —— 下载器的"200 回退清零重下"路径不是防御性代码,是 npmmirror 的常态路径;改下载引擎别删这个分支。中科大 debian-cdimage 支持 Range(断点续传正常)。另:升级底镜 build 时同步改 `IMAGE_BUILD/IMAGE_SHA512/IMAGE_SIZE` 三常量(单测锁 URL 不含 latest);升级宿主 SDK 时 `CLAUDE_SDK_VERSION` 单测会挂,提醒同步。
18. **electron-builder 签名会剥 bundled vfkit 的 entitlement(M3 实测)**:它用 Electron 默认 entitlements(只剩 allow-jit)重签 Resources 里的 Mach-O,`com.apple.security.virtualization` 被剥 → 沙箱 VM 起不来。修复:`mac.signIgnore: ["cowork/bin/vfkit$"]` 跳过(保留 brew 原签名,包内与原件逐位一致)+ after-sign.js `ensureVfkitEntitlements`(adhoc 路径在主 bundle 落 seal 前校验/自愈;真证书路径只查告警,改了会破坏 Developer ID resource seal)。**将来接真证书签名/公证时,vfkit 必须用同 Team ID 重签且带 virtualization entitlement**,到时再解决。
19. **资产目录已正式化(M3)**:运行时目录是 `~/.codepilot/cowork-assets/`(cowork-paths.ts 首次加载把老的 cowork-poc 原子迁走)。文档/脚本里出现的 cowork-poc 是历史名;`npm run test` 也会触发迁移(import 即迁,幂等安全)。
20. **daemon 提权/setuid 类改动的坑全在启动时序,dev 单测测不出,必须 kill VM 冷启动实测(P3-A 三坑)**:①**就绪判定竞态**——daemon 冷启动会先以旧配置(User=agent)被 systemd 拉起就 vsock 应答,cloud-init 的 `restart` 把它提权 root 尚未完成;此时开跑回合 exec setuid 失败、claude 秒退。修:health 上报 `uid`,`vsockRootReady` 要求 v4+ daemon `uid==0` 才算就绪(fail-secure,绝不在非 root 时执行回合)。②**runcmd 必须 `restart` 而非 `enable --now`**——后者对已运行 daemon 是 no-op,新 unit(User=root)/新代码不加载。③**instance-id 已改内容寻址**(`codepilot-cowork-v{N}-{userData hash}`)——daemon/模板一改 hash 变即触发已有磁盘重灌,**消除坑16 的手动 bump 纪律**(SEED_TEMPLATE_VERSION 仅留结构版本 + EXPECTED_DAEMON_VERSION 单测锁)。表象都是"claude 秒退 0 输出",先查 daemon uid 再怀疑别处。
21. **P3-B 真 key 不进 VM 靠 claude-client 覆盖 env,不是改 forwarder**:cowork 分支把 coworkEnv 的真 `ANTHROPIC_API_KEY/BASE_URL` 覆盖成一次性 token + 代理地址,过河的就是假的;forwarder 白名单不用动(它透传的已是 token)。**改凭证注入链时别把这层覆盖弄丢**(丢了真 key 就回到过河)。验证法:办公回合里让 agent 跑 `case "$ANTHROPIC_API_KEY" in cwk_*) ...` 确认是 `cwk_` token 非真 key(零泄漏)。cowork-proxy 绑 vmnet 网关 IP,VM 必须已起(bridge100 存在)才绑得上 → ensureProxyRunning 在 decision.useSandbox(VM ready)后调。

---

## 10. 分支 / 提交 / 远程

- 分支 `vm_cowork`(从 `origin/para` 拉),已 push 到 `origin/vm_cowork`。
- 远程:`origin` = CmftAiLabs/LabCodepilot。个人副本 remote 已弃用,勿推。
- 发版纪律:`git push` / `git tag` 必须用户明确指示;commit 可正常进行。
- 每完成一个子阶段的模式:改代码 → typecheck + `npm run test` → dev+CDP 验证 → commit → bump 版本 → 打包给用户实测 → push(用户说了才推)。
