# Cowork 远程容器沙箱 — 执行计划(R 系列)

> 创建:2026-07-16
> 调研(先读):[docs/research/cowork-remote-container.md](../../research/cowork-remote-container.md)(架构映射 + 外部硬事实 + R0 实测)
> 上游:本地 VM(macOS vfkit)已全交付 + P3 安全强化;R0 通道 POC 已实测全过(见调研 §10)

## 战略转向(2026-07-16 用户拍板)

**放弃"本地 VM 沙箱"作为活跃路径,全平台统一走"远程容器沙箱"。** 触发:Windows 因企业 IT 禁虚拟化无法走本地 WSL2(见 [cowork-p2-windows.md](./cowork-p2-windows.md) §8);为保证 mac/win 体验一致,mac 本地 vfkit 一并退场,两端统一远程。R0 已证明远程容器方案技术可行(真 claude 经完整通道跑通)。

**本地 VM 代码保留不删**(用户明确要求):能复用的直接复用,平台专属的转入"接口后非活跃"状态,以防将来要本地离线版能捡回。

## 决策日志

- **RD1 全平台统一远程,弃本地活跃路径**(用户拍板)。不再做平台分派(mac vfkit / win wsl / 远程),`CoworkBackend` 只有一个活跃实现 = 远程容器;vfkit 实现包进接口保留但不激活。
- **RD2 单一公司服务器,不开放个人自配**(用户拍板)。server 地址 + 接入凭证纯账号登录下发(复刻 [image-cred-account-delivery] 范式);不做设置页手填 server。后续用户提供一台**裸金属服务器**(有 KVM)专跑沙箱。
- **RD3 裸金属有 KVM → 隔离可升级**(RD2 推论)。R1-R4 先用 R0 已验证的**硬化 runc**;裸金属就位后评估 gVisor(KVM 平台)/ Kata microVM(每会话轻量 VM,架构级隔离,不弱于原 vfkit)。
- **RD4 凭证先 A 起步、预留切 C**(用户拍板)。A=客户端把真 key 经 TLS 交服务端内存代理;C=服务端直接向账号后端取凭证(客户端不碰 key,需后端加接口)。A/C 容器侧与注入侧代码相同,只差"真 key 怎么进服务端内存",切换成本低。B(反向隧道)不做。
- **RD5 单点诚实降级**(RD2 推论)。服务器不可达 = 办公模式不可用,复用现有 `cowork_status` gate 隐藏 tab + 引导,不假装。
- **RD6 凭证代理下沉为共享网络里的 sidecar 容器**(R3 实测倒逼,替代 P3-B 的"宿主/服务端进程代理")。docker 场景"容器→宿主网关"的可达性不可靠 —— 企业防火墙、k8s/kube-router 残留 iptables 都可能堵死(验证 VM 实测容器→宿主任何 IP 全超时,而容器↔容器恒通)。故 cred-proxy 改为一个可信 sidecar 容器 `cowork-proxy`,与会话容器同处专用网络 `cowork-net`,claude 经**容器名**访问(`ANTHROPIC_BASE_URL=http://cowork-proxy:8791`)。威胁模型与 P3-B 等价:真 key 只在 proxy 容器(可信,不跑 agent、不碰不可信文件)的 **tmpfs**;凭证经 `docker exec` stdin 注入(走 docker API,不走网络、不落宿主盘);会话容器只拿一次性 `cwk_` token。**这条路对生产也更 robust**(不依赖宿主网络拓扑/防火墙),且是 R4 出网管控、R5 docker-compose 部署的自然基座。
- **RD7 多用户鉴权 = HMAC 签名 token;出网 = 禁内网、放行公网**(用户拍板,R4)。token = `base64url(JSON{uid,exp?}) . base64url(HMAC_SHA256(secret, payload))`(简化 HS256,零依赖);server 只持 `COWORK_AUTH_SECRET` 验签取 uid,**无状态不存用户表**;R5 由账号后端用同一密钥按用户签发下发。密钥未配置 = authz 关闭回退单用户(dev 兼容)。出网策略:阻断私网四段防内网横移,公网放行(若真 API 在内网,需在 setup-egress.sh 加定向放行,见脚本注释)。
- **RD8 沙箱粒度 = 用户级归属隔离,容器仍 per 会话;账号沿用现有用户体系**(用户拍板,2026-07-17)。"一个用户对应一个沙箱实例"= 用户间绝对隔离(R4 uid scope 已实现),**不做**"每用户一个常驻容器":每会话独立环境互不污染(同用户某会话的敏感文件,其他会话的 agent 不可见,默认安全最强);会话 volume 本就持久 + TTL 停容器秒级复用,资源已可控。不新建账号体系:token 由现有账号后端(下发 managed 配置那套)签发,cowork-server 无状态无用户表(RD2/RD7 既定)。同轮结论:**裸金属服务器不是功能前置** —— UTM VM 即"假裸金属",全功能闭环先在 VM 跑通,迁移三件套后置(x64 二进制重跑 selftest / KVM 隔离升级评估 RD3 / 真网络 TLS 联调);**Windows .cmd 转发器作废** —— SDK 对 `.js/.mjs` 结尾的 executable 走 JS 运行时 spawn(源码判定 `[".js",".mjs",...].some(endsWith)`),配合 execEndpoint 已设的 `ELECTRON_RUN_AS_NODE=1` 平台无关,Windows 剩余项=NSIS 免管理员打包(CI windows-2022)+无 vfkit 回退的诚实降级 gate+真机验证。

## 状态

| Phase | 内容 | 环境 | 状态 |
|-------|------|------|------|
| R0 | 通道 POC:forwarder→TCP→server→docker exec→shim→claude,帧/EOF/中断/并发 + claude×runc + 真 claude 一轮 | UTM+Mac | ✅ **完成**(2026-07-16,代码 scripts/poc/cowork/remote/) |
| R1 | `CoworkBackend` 接口(远程唯一活跃,vfkit 包入保留)+ cowork-server 控制面 MVP(容器 per 会话编排 + exec WS 桥 + docker labels 事实源)+ claude-client 切远程 | Mac+VM | ✅ **完成**(R1-1 控制面 / R1-2 接口+双实现 / R1-3 claude-client+契约层切 remote / R1-4 **dev 端到端真 claude BRIDGE_OK**;修容器非 root + shim os._exit) |
| R2 | 文件通道:上传/diff/下载/archive **服务端直读会话 volume**(容器不用醒)+ 产物卡链路接通 + cowork-transfer 底层换远程 | Mac+VM | ✅ **完成**(R2-0 tmpfs→持久 named volume+uid 1000 chown / R2-1 文件 REST 四 op:helper 容器直读 volume / R2-2 remote backend 四文件 op / R2-3 artifacts route 去 vfkit 硬依赖 / R2-4 selftest 8 项全过 + dev 真 claude 上传→容器读改→产物卡→下载→archive→会话删除全链 CDP 验证。坑:chown init 容器须 `--cap-add CHOWN`;HOME 挪 tmpfs 防 claude 状态混进产物 diff;DELETE 清 volume 加短退避防在飞 helper 竞态) |
| R3 | 凭证代理(方案 A:客户端 TLS 交 key→服务端内存→容器一次性 token→注入真 key→转发真 base_url;预留 C 的取凭证钩子)+ 双侧审计 | Mac+VM | ✅ **完成**(**RD6:代理下沉为 sidecar 容器**,非宿主进程 —— 见决策日志)。R3-1 `container/cred-proxy.py`(python,tmpfs /creds,剥 token 注入真 key 转发,SSE chunked 流回)+ `lib/cred-proxy.mjs`(编排 cowork-net+proxy 容器,`docker exec` stdin 注入凭证不落宿主盘)+ `lib/audit.mjs`(服务端审计,与 app 侧事件对齐)+ 会话容器接 cowork-net。R3-3 `cowork-backend-remote.ts` registerCredentials→POST cred(真 key 不再进容器 env)、revoke→DELETE;会话删除走 backend.revokeCredentials。R3-2 **selftest-r3 7 项全过**(api_key/auth_token 双风格注入+host 重写+path 保留+SSE 流式+错/缺 token 401+revoke+会话删除联动+审计零 key/token 泄漏,全在 cowork-net 真容器间)。R3-4 dev 真 claude 回合 success(经 cred-proxy 转发)+ /creds 有会话 token 文件+会话容器无真 key+DELETE 联动清空;单测 1948 零回归。**坑**:docker cp 到 tmpfs 挂载点被遮盖→cred-proxy.py 改 bind-mount(R5 烘镜像);cap-drop ALL 剥 CHOWN(R2 已记)) |
| R4 | 多用户 authz(userId+sessionId label scope)+ 配额(mem/cpu/pids/TTL 回收)+ **出网禁内网**(DOCKER-USER 四段 REJECT + 封 host-network/DNS 旁路)+ 隔离硬化文案 | VM | ✅ **完成**(**RD7:HMAC 签名 token + 禁内网放行公网** —— 见决策日志)。R4-1 `lib/authz.mjs` 无状态 HS256 验签(密钥空=关闭回退单用户)+ 会话/volume 打 `cowork.uid` label + 所有 op 校验归属,跨用户一律 **404 防枚举** + reconcile/list 按 uid scope + `sign-token.mjs` 签发工具。R4-2 `setup-egress.sh`(root 幂等,DOCKER-USER 链,建议 systemd 自启):固定网桥 **cowork0**(建网 `--opt com.docker.network.bridge.name`)上装"内部 RETURN(会话↔cred-proxy)+ 私网四段 REJECT(10/8、172.16/12、192.168/16、169.254/16)",公网放行;host-network/DNS 旁路靠强制会话容器 `--network cowork-net` 杜绝。R4-3 配额 `--cpus`(mem/pids R1 已有)+ TTL 空闲回收(默认 30min,仅 exec 续命、有活跃 exec 连接不回收;超时 `docker stop` 保留 volume,下次 ensure `docker start` 复用)。R4-4 **selftest-r4 6 项全过**(坏/缺 token 401;跨用户 ensure/read/delete 404;NanoCpus 生效;stop 保留 volume+ensure 复用;reconcile 按 uid scope;装 egress 后内网 REJECT/公网 OPEN/cred-proxy OPEN)+ dev 真 claude 在 authz+egress 双开下回合 success。R4-5 app 侧 token 链路 R1 已就绪(`cowork_remote_token` → REST Bearer + WS env),服务端换 HMAC 验签零改动;单测 1948 零回归。**坑**:残留 cowork-net 会让 ensureProxy 跳过重建 → egress 的 `-i cowork0` 匹配不到旧网桥,重部署前先删网络;cowork0=172.18/16 标准段无生产冲突(内部互通靠"同网桥 RETURN"与网段无关;真 API 须在公网否则加定向放行);SSH 多层引号会 mangle 内联 python → probe 脚本走文件 |
| R5 | **七步(RD8 重排:UTM VM 即假裸金属,买服务器非前置)** —— R5-1 forwarder-remote.mjs 进 electron-builder extraResources → R5-2 mac 打包版实测完整办公回合(打包形态首验)→ R5-3 ✅ 单服务器部署包:`apps/cowork-server/deploy/`(install.sh 幂等一键 + cowork-server.service 宿主 node 控制面 + cowork-egress.service oneshot + .env.example + docker-compose.tls.yml/Caddyfile TLS 反代预留 + README);VM 实测:install.sh 从 nohup 迁 systemd → 两单元 enabled+active、health、egress 5 条;端到端**真实复验于 R5-4**(alice ensure→`{name,reused:false}`+容器 uid=alice/NanoCpus 2e9、bob 跨用户 files→404、alice 删除→`{ok:true}`+CONTAINER_GONE、审计落 /opt/cowork-server/cowork-audit.log 记 session_ensure/session_remove 仅 uid 无 token);顺手给 index.mjs 加 COWORK_SERVER_HOST(TLS 时只听 127.0.0.1);单测 1948 零回归。**坑**:npm 的 .js symlink 在 sudo secure_path 下不被识别→install.sh 改 ws 优先从源直拷(纯 JS 零依赖)、npm 仅兜底;SSH ControlMaster 连接复用会让跨调用副作用错乱(ws 传输"成功"却消失)→部署脚本类远程操作用单次原子 ssh(tar-pipe+install 同一 shell)→ R5-4 ✅ 运维/IT 手册 `deploy/OPERATIONS.md`(架构速览/服务管理与日志特征行/配置表/密钥与 token 管理——轮换即全量 token 失效、无状态不可单点吊销/审计 10 事件表+真实样例/巡检命令/排障表/升级迁移+selftest 注意事项;写作中核出一处真实盲区:**cowork-proxy 运行中被误删不会自动重建**——ensureProxy 仅启动时跑且 memoize,需 restart server,已入排障表。**复查修正**(用户报另一会话可能干错活,全面核查后):①剔除幽灵事件 cred_reject——audit.mjs 注释 R3 预留但代码零触发点,坏 token 拒绝在 cred-proxy 容器内且无日志,已修文档+注释+记 tech-debt #15;②VM deploy/ 缺 README/OPERATIONS(R5-3 rsync 错乱期受害),重装同步;③其余全绿:git 无外来 commit/无重复文档/env 表与代码全吻合/VM 共同文件零 differ)→ R5-5 ✅ 客户端侧全链(复刻 image-config 范式:`fetchCoworkConfig` encrypted 优先/503·404 回退明文/断网回退加密缓存/**404=未开通→跳过且不清配置**,dev 手写三键联调后门不被登录轮询打扰 → broker sync/purge → `/api/auth/cowork-config/sync|purge` 经 `lib/cowork-remote-config` 校验落三键含 `cowork_backend=remote`,`cowork_remote_token` 入 db.ts SENSITIVE_SETTINGS 密封、存量明文 open 直通兼容 → main.ts 与 image 同批五触发点+登出/401 双 purge;+4 单测、dev mock 七步验证全过——sync 落三键/坏 URL·空 token 400 不落半截/purge 置空回落。**待账号后端实现(契约)**:`GET /api/v1/cowork/config/encrypted`(优先,token 为 AES-256-GCM 密文同 configs auth_token 加密法)与明文 `GET /api/v1/cowork/config`,登录态鉴权,200=`{server_url|serverUrl, token}`,404=该用户未开通;token=HMAC(cowork-server 的 COWORK_AUTH_SECRET, {uid[,exp]}) 格式同 sign-token.mjs,建议短 exp 周期签发)→ R5-6 🔄 **代码侧全完成,仅剩真机实测等 Windows 机**:①平台 gate(本次新做)——status route 非 darwin 且未下发 remote 时返回 `assets.overall='unsupported'`(remote 分支在前不受挡:win+已下发照常可用);唯一动作组件 CoworkAssetsAction 对 unsupported 只渲染「由公司远程沙箱提供,登录后自动开通」说明行,设置页外层文案同步分支——**绝不给下载按钮**(原缺口:win 上 overall='missing' 会引导下载 mac 专属 vfkit 资产的死路,违 RD5);i18n 三语手工加 `workspace.office.remoteOnlyPlatform`(zh-HK 手工,勿 regen);+4 单测(win32 默认 unsupported/开关尊重/win32+remote 不被挡/darwin 不回归)+ CDP mock 双页验证(办公空态卡与设置页均只出说明行无按钮,console 零错)。②核实既有:NSIS 免管理员早已配好(`perMachine:false`+`packElevateHelper:false` 零 UAC)、CI windows-2022 出包链现成(workflow_dispatch 触发);bundle-vfkit 非 darwin skip 且 electron-builder 容忍 vfkit-bundle 缺失(CI 长绿证据);R5-1 的 forwarder+ws extraResources 平台无关、会进 win 包。真机清单:NSIS 装测零 UAC 弹窗、forwarder ELECTRON_RUN_AS_NODE spawn .mjs、完整办公回合、(**.cmd 已作废**,见 RD8)→ R5-7 双文档 + exec-plan 归档 + 合流 main(用户拍板) | Mac+VM(R5-6 需 Win 机) | 🔄 **R5-1 ✅ + R5-2 ✅**(2026-07-17,c62df18):3.1.19 打包版连 VM 全链实测过 —— hostname=容器短哈希 + uid 1000 无 passwd 映射双指纹、登录态/托管 14 服务商可用、产物卡 + 下载 24B 逐字节比对、会话删除容器/volume/凭证三方归零、authz(容器 label uid=devuser)+--cpus 生效、egress 双开下回合 success。**坑**:adhoc 重签的新包首启会卡「钥匙串授权」静默等待(next-server 不起、日志停在 ABI check;用户输密码放行即可;正式固定签名无此问题);ws 不可换 Node 内置 WebSocket(握手需自定义 Bearer 头) |

## 核心设计

### CoworkBackend 接口(R1,claude-client / cowork-transfer 只依赖它)

```
interface CoworkBackend {
  ensureReady(sessionId): Promise<BackendStatus>          // 确保会话容器就绪(懒起/复用)
  execEndpoint(sessionId): { forwarderPath, env }         // forwarder 连远程所需(端点+env)
  // 文件 op —— 复用 cowork-transfer 的 10 个契约签名,底层委托本 backend
  ensureWorkspace(sid); pushFile(sid,local,name); listFiles(sid,since);
  readFileStream(sid,path); archiveStream(sid); removeSession(sid); reconcile(keep);
  releaseSession(sid); stop(); getStatus()
}
```
- **RemoteContainerBackend(唯一活跃)**:全部 op 走 HTTPS 调 cowork-server;execEndpoint 返回 forwarder-remote + `COWORK_REMOTE_HOST/PORT/TOKEN`。
- **VfkitBackend(保留非活跃)**:现 cowork-vm-manager + cowork-vsock 原样包进接口,默认不激活(RD1)。
- `cowork-transfer.ts` 契约层签名不变,内部从"直接 vsock"改为"调当前 backend"——对 claude-client/artifacts route 透明。

### cowork-server(服务端控制面,R1 起)

单 Node 服务 + Docker Engine;**docker labels 作事实源**(控制面无状态,重启从 labels 重建;呼应现有 globalThis 单例哲学)。

- **REST**(短 op,Bearer 鉴权 + per-user):`POST /session/:id/ensure`、`DELETE /session/:id`、`POST /session/:id/file`、`GET /session/:id/files?since=`、`GET /session/:id/file?path=`、`GET /session/:id/archive`、`POST /reconcile`
- **WS**:`/session/:id/exec` —— 帧流桥到 `docker exec`(R0 已验;server 哑管道,容器内 shim 解帧)
- **凭证代理**(R3 已完成,方案 A + **RD6 sidecar 容器**):`POST /session/:id/cred`(客户端 TLS 交真 key)→ cowork-server `docker exec` stdin 把凭证注入 **`cowork-proxy` sidecar 容器**的 tmpfs `/creds/<token>.json`(不走网络、不落宿主盘)→ 容器 claude 用一次性 `cwk_` token + `ANTHROPIC_BASE_URL=http://cowork-proxy:8791` → proxy 容器校验 token→注入真 key→转发真 base_url→SSE chunked 流回。会话容器与 proxy 容器同处 `cowork-net`(容器↔容器,绕开"容器→宿主"的环境依赖)。预留 `credSource` 抽象(A=客户端交;C=后端取,喂同一 registerCredentials 入口)。
- **容器规格**(R0 已验硬化基线):`--cap-drop ALL --security-opt no-new-privileges --memory/--pids-limit`,claude+shim bind-mount `:ro`,workspace 用**会话专属 named volume**(与容器生命周期解耦:容器可回收,volume 留到会话删)。
- **keepalive**:WS 双向 ping/pong 25s(防企业中间设备掐);断线=回合 abort(首版),"重连 re-attach 不杀回合"列演进。

### 通道(R0 已定并实测)

帧协议端到端(stdin `[u32 len][bytes]`+零长 EOF / stdout 裸流),容器内 stdio shim 解帧(= daemon op_exec 子集)。**POC 用裸 TCP,R1 生产切 WSS/TLS**(只换连接层,协议不动)。

## 复用不删清单(RD1)

| 直接复用 | 保留但非活跃(接口后) |
|---|---|
| cowork-transfer(契约层,换底层)、cowork-guards、cowork-staging、双栏/产物卡/横幅/设置全套 UI、DB(sandbox_enabled/vm_artifacts_json)、帧协议、forwarder 结构、cowork-proxy 凭证逻辑(移服务端)、cowork-audit、cowork-daemon op 逻辑(→shim) | cowork-vm-manager(vfkit 生命周期)、cowork-seed(cloud-init)、cowork-assets(本地镜像下载)、cowork-vsock、vfkit 打包链(bundle-vfkit/after-sign entitlement)、镜像流水线 M1-M4 的本地下载器 |

## dev 验证方式

全远程后 dev 不再起本地 vfkit,改**指向 UTM 那台 VM**(`cowork-vm` 192.168.64.9,R0 环境已就绪)作集成测试后端。cowork-server 跑在 VM,dev 的 next-server 连它。managed 凭证仍走 [dev-managed-verification] 解封。

## 明确不做

- 不做本地 VM 活跃路径(RD1,代码保留)。
- 不做个人自配远程服务器(RD2)。
- 不做凭证方案 B 反向隧道(RD4)。
- 不做假隔离:服务器/虚拟化不可用 = 诚实降级(RD5)。
- microVM(gVisor/Kata)不在 R1-R4 强做,裸金属就位后评估(RD3)。

## 验收标准(每阶段)

- R1:dev 连 VM,办公会话一轮真 claude 经 CoworkBackend→cowork-server→容器跑通;vfkit 代码保留且 typecheck 过;macOS 现有单测零回归。
- R2:附件上传→容器读改→产物 diff→下载,全程服务端直读 volume;产物卡片链路 CDP 验证。
- R3:办公回合里容器内 `ANTHROPIC_API_KEY` 是 `cwk_` token 非真 key(零泄漏,复刻 P3-B 验证法);审计双侧落盘。
- R4:容器内 agent 访问内网被拒、访问公网正常;两用户会话互不可见(label scope);配额触发回收。
- R5:全新 Win 机免管理员装客户端 + 账号下发 server 配置 + 办公回合跑通;单服务器 docker-compose 一键起;双文档 + IT 部署清单。
