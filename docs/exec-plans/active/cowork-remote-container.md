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

## 状态

| Phase | 内容 | 环境 | 状态 |
|-------|------|------|------|
| R0 | 通道 POC:forwarder→TCP→server→docker exec→shim→claude,帧/EOF/中断/并发 + claude×runc + 真 claude 一轮 | UTM+Mac | ✅ **完成**(2026-07-16,代码 scripts/poc/cowork/remote/) |
| R1 | `CoworkBackend` 接口(远程唯一活跃,vfkit 包入保留)+ cowork-server 控制面 MVP(容器 per 会话编排 + exec WS 桥 + docker labels 事实源)+ claude-client 切远程 | Mac+VM | 📋 待开工 |
| R2 | 文件通道:上传/diff/下载/archive **服务端直读会话 volume**(容器不用醒)+ 产物卡链路接通 + cowork-transfer 底层换远程 | Mac+VM | 📋 |
| R3 | 凭证代理(方案 A:客户端 TLS 交 key→服务端内存→容器一次性 token→注入真 key→转发真 base_url;预留 C 的取凭证钩子)+ 双侧审计 | Mac+VM | 📋 |
| R4 | 多用户 authz(userId+sessionId label scope)+ 配额(mem/cpu/pids/TTL 回收)+ **出网禁内网**(DOCKER-USER 四段 REJECT + 封 host-network/DNS 旁路)+ 隔离硬化文案 | VM | 📋 |
| R5 | 客户端接入(账号下发 server 配置)+ Windows forwarder(.cmd 包装)+ NSIS 免管理员打包 + 单服务器 docker-compose 部署包 + 运维/IT 文档 + 双文档 | Win+VM | 📋 |

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
- **凭证代理**(R3,方案 A):`POST /session/:id/cred`(客户端 TLS 交真 key→内存 Map)→ 容器 claude 用一次性 `cwk_` token → 代理校验→注入真 key→转发真 base_url→SSE 回。预留 `credSource` 抽象(A=客户端交;C=后端取)。
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
