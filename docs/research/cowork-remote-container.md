# Cowork 远程容器沙箱 — 服务端容器替代本地 VM 可行性调研

> 创建时间:2026-07-16
> 状态:**调研完成**(架构映射 + 外部硬事实均已核实,权威源齐全;三条硬结论:①EOF 不赌 docker 半关闭、容器内 shim 解帧;②gVisor 跑 claude 有活跃 bug、默认硬化 runc;③服务器无 KVM 则 microVM 路线整体出局)
> 触发:**企业 IT 不给办公电脑开虚拟化**(用户实机取证:BIOS 虚拟化禁用 + 无本地管理员,见 [cowork-p2-windows.md](./cowork-p2-windows.md) §8 场景③)→ WSL2 本地路线对公司部署场景死亡。
> 上游:cowork macOS 本地 VM 已全交付([handover](../handover/cowork-vm-mode.md));P2 WSL2 已立项([exec-plans/active/cowork-p2-windows.md](../exec-plans/active/cowork-p2-windows.md)),本调研评估其替代方案。

## 0. 提案与一句话判定

**用户提案**:公司有一台远程 Linux 服务器,可跑容器。应用远程连服务器,每个用户启动办公模式时由服务端分配一个容器作沙箱(容器内跑 claude),替代本地 VM 方案。

**一句话判定:可行,且与现有架构的契合度极高 —— 这不是重写,是给转发桥换一根更长的线。** SDK 仍在客户端;`pathToClaudeCodeExecutable` 转发桥把"CLI 进程放进本地 VM"改成"放进远程容器";拷贝语义、E1 守卫、帧协议、产物快照链路全部原样复用。变化收敛在三处:**通道**(vsock unix socket → WebSocket/TLS)、**生命周期**(vfkit spawn → 服务端容器编排)、**凭证注入点**(本机 NAT 网关代理 → 服务端代理)。

**附带的战略收益(不只是求生)**:
1. **客户端零前置**:不需要虚拟化、不需要管理员、不需要下载 3.2GB 镜像、不需要 vfkit —— Windows/macOS 通吃,连管控最严的企业电脑都能用(只要能连内网服务器)。对企业场景这是**唯一活路**,对普通用户是**体验升级**。
2. **更新集中化**:镜像/claude 版本升级在服务端一次完成,客户端零感知(对比现在每台机器下载 3GB)。
3. **客户端硬件解耦**:低配办公机也能跑重回合(算力在服务器)。

**诚实的代价**(§9 展开):网络依赖(离线不可用)、服务器单点、用户文件上服务器(驻留策略)、运维负担移到服务端、多租户隔离成为新的安全主战场。

## 1. 威胁模型反转(理解本方案的钥匙)

本地方案与远程方案保护的东西**不一样**,这决定了安全设计的重心迁移:

| | 本地 VM(现状) | 远程容器(提案) |
|---|---|---|
| 用户真机安全 | **主战场**(E1 三守卫+零写入验收) | **天然达成**——什么都不在本地执行,真机零接触是架构自带的,不需要守卫去挣 |
| 凭证保护 | P3-B 本机代理,真 key 不进 VM | 仍需设计:key 在客户端,claude 在服务端,注入点要移(§5) |
| 会话间隔离 | P3-A setuid 每会话用户 | **容器边界替代**(每会话一容器,比 setuid 更强)(§6) |
| **多租户隔离** | 不存在(单机单用户) | **新主战场**:一台服务器多个用户的容器共享内核 |
| **内网横移** | 不存在(agent 出网走用户家宽/办公网,与本人同权) | **新增高危面**:容器在公司服务器上,提示注入可指挥 agent 扫内网/打内网服务 → 必须"放公网、禁内网"的出网策略(§6) |
| 文件驻留 | 用户真机 + 本机 VM 磁盘 | **用户文件上服务器**:传输加密、按用户隔离、删除级联、驻留策略要明确 |
| 服务器自身 | 不存在 | 新增:agent 跑任意 bash,服务器要防逃逸、防资源耗尽(配额) |

**关键认知:本地方案里最难挣的东西(真机隔离),远程方案免费得到;本地方案里不存在的问题(多租户、内网横移),远程方案必须新做。** 总盘子不是变小了,是换了位置——但换到的位置是业界有成熟先例的位置(所有 cloud sandbox 厂商都在解这套题,§8)。

## 2. 推荐架构形态

```
客户端(用户机,Win/mac)                     公司服务器(Linux + Docker)
┌────────────────────────────┐            ┌─────────────────────────────────┐
│ Next server(应用内)         │            │ cowork-server(控制面,常驻)      │
│  claude-client.ts            │   HTTPS    │  REST: 会话容器分配/释放/文件op   │
│   └ SDK query()              ├───────────┤  WS:  exec 双向流桥接            │
│      pathToClaudeCodeExec    │   WSS      │  凭证代理(P3-B 移植,§5)        │
│      = forwarder-remote ─────┼───────────┼→ docker exec -i <c> claude ...   │
│         (帧协议原样,          │  (帧封装    │      │                          │
│          换传输层)            │   端到端)   │  ┌───▼──────────────────────┐  │
│                              │            │  │ 容器(每会话一个)           │  │
│ 产物卡/守卫/双栏 UI 全复用     │            │  │  claude(linux x64 binary) │  │
└────────────────────────────┘            │  │  /workspace ← 会话专属 volume│  │
                                           │  └──────────────────────────┘  │
                                           │  出网策略:放公网,禁内网(§6)      │
                                           └─────────────────────────────────┘
```

**数据流(一次办公回合,对照 handover §1 几乎同构)**:
1. `/api/chat` 收到消息 → `decideCowork` → **remote backend** 的 `ensureRunning()`:调服务端 REST 确保会话容器存在(不存在则 `docker run` + 挂会话 volume,秒级,对比本地 VM 冷启动 97s **更快**)。
2. 附件经 HTTPS 上传到服务端 → 落会话 volume(拷贝语义原样)。
3. SDK spawn `forwarder-remote`(win 是 .cmd 包装,mac 是 .sh)→ 转发器连 `wss://server/exec?ticket=...` → 服务端桥接到容器内 claude 的 stdio。**stdin 帧封装([uint32 BE 长度][字节] + 零长度 EOF)端到端保留** —— 它本来就是为"传输层不可靠传播半关闭"设计的,天然传输无关。
4. claude 在容器内跑 stream-json,输出经 WS → 转发器 → SDK。
5. 回合末 `listNewFiles` diff(服务端直接读 volume,**连容器都不用醒**)→ 落库 + `vm_artifacts` SSE → 产物卡片。
6. 下载:服务端直接从 volume 流式读 —— **比本地更好:不需要唤醒 VM**(现在休眠 VM 下载要等 ensureRunning)。

**关键架构决策点**:

- **SDK 留客户端(定)**:回合仍由用户的应用驱动,服务端只是"更远的 CLI 进程宿主"。不搬 SDK 上服务端——那是完全不同的重写(会话状态/DB/SSE 全要动),且转发桥模式本来就为此而生。
- **容器 per 会话(推荐)而非 per 用户**:容器边界直接替代 P3-A 的 setuid 隔离(更强、更简单——容器内不再需要 root daemon + 降权,claude 直接非 root 跑);容器=牲口不是宠物,坏了就重建;reconcile 对账变成"容器列表 vs 会话列表"天然对齐。per-用户容器(内部 setuid 分会话)是最贴近现状的移植但引入有状态宠物,仅作备选。
- **workspace 用会话专属 volume,与容器生命周期解耦**:容器可随时回收(空闲/升级),volume 保留到会话删除 —— 对应现在"VM 休眠产物仍可下载"的语义,且实现更简单(服务端直接读 volume)。
- **guest daemon 瘦身为一个极小 stdio shim(调研后定论,§4)**:本地方案 daemon 存在的三个理由——vsock 监听、文件 op 执行、setuid——在远程方案分别被"服务端控制面"、"直接读写 volume"、"容器边界"替代。唯一保留的是 exec 通道的解帧器:**容器内放一个小 stdio shim(收长度帧→喂 claude stdin,零长度帧→主动关 claude stdin)**。这不是兜底而是正解——外部调研证实 docker exec 的传输层半关闭链路"官方自认协议有缺陷",而 K8s 1.31 的 exec 协议演进(v5 子协议给 stdin 加带内 CLOSE 信号)与我们的零长度帧是同一设计动机。帧协议端到端(客户端 forwarder → shim),docker exec 只当哑字节管道。shim ≈ 现 daemon exec op 的几十行子集。
- **claude 版本偏斜(多客户端版本 vs 一台服务器)**:客户端 SDK 版本决定它要的 CLI 版本(`CLAUDE_SDK_VERSION` 纪律)。服务端按需从 npmmirror 下载对应版本的 linux-x64 平台子包、按版本缓存(服务器有外网,复用 M2 的下载器逻辑),容器启动时挂对应版本二进制。**不需要客户端上传 250MB**。
- **服务端配置下发走既有模式**:server URL + 接入凭证经账号体系登录后下发(settings 键,复刻 `bailian_image_config` 的 S1 模式,见 memory image-cred-account-delivery)—— 公司部署零手工配置;个人用户(自带服务器)走设置页手填。

## 3. 模块映射表(复用面盘点,对照 P2 调研 §1 同一张表的第三列)

| 模块 | macOS 现状 | 远程容器移植面 |
|---|---|---|
| `cowork-transfer.ts` | 文件通道契约层 | **契约不变**,底层实现换 HTTPS 调服务端(与 WSL2 方案同一个接缝) |
| `cowork-vm-manager.ts` | vfkit 生命周期 | 换 remote backend:`ensureRunning`=REST 确保容器;健康=服务端 health;空闲回收移到服务端 |
| `cowork-vsock.ts` | vsock RPC 10 op | 换 HTTPS/WS 客户端,**"一次连接=一个 op"同构映射为"一次请求=一个 op"** |
| `forwarder-vsock.mjs` | 连 unix socket 发帧 | `forwarder-remote.mjs`:连 WSS 发同样的帧;**帧协议零改动**;Windows 需 .cmd 包装(SDK win32 spawn,已有经验) |
| `cowork-daemon.py` | guest 守护(vsock/文件/setuid/exec) | **大概率整个退役**(§2);EOF 不可靠时留 stdio shim 兜底 |
| `cowork-seed.ts` / `cowork-assets.ts` | cloud-init seed / 3GB 镜像下载 | **客户端侧整个不需要**(远程模式零本地资产);服务端镜像构建走 Dockerfile |
| `cowork-proxy.ts`(P3-B) | 本机 NAT 网关注入 token | **移植到服务端**(§5),cwk_ token 模式复用 |
| `cowork-audit.ts`(P3-C) | 宿主审计 | 客户端继续审计文件进出;**服务端新增**容器生命周期/凭证/配额审计(按用户) |
| `cowork-guards.ts` / staging / UI 全家 | 守卫/暂存/双栏/产物卡/横幅 | **原样复用**(守卫的"VM 不可用硬失败"语义变成"服务器不可达硬失败") |
| DB(`sandbox_enabled`/`vm_artifacts_json`) | 单一事实源/产物快照 | **原样复用** |
| **新增:cowork-server(服务端)** | 无 | 控制面:容器编排 + 文件 op(直读 volume)+ exec WS 桥 + 凭证代理 + 按用户 authz/配额/对账 + 审计。单二进制 Node 服务 + Docker Engine API,**docker labels 做事实源**(控制面无状态,重启从 labels 重建,呼应 globalThis 单例哲学) |

**W1 抽象的两用论证**:P2 计划的 W1(抽 `CoworkGuestBackend` 接口,macOS 现状包装成 vfkit 实现)**对远程容器方案同样是正确的第一步** —— 接口的 10 个 op + 生命周期 + exec 端点,第三个实现就是 remote。无论 WSL2 是死是活,W1 都不白做;唯一调整:daemon `--stdio` 模式从 W1 挪出(remote 大概率不需要,WSL2 复活才需要)。

## 4. 通道设计(外部硬事实已核实)

- **控制面 op**:HTTPS + Bearer(短 op:分配/释放/上传/列表/下载/对账)。现 vsock 的 JSON header 协议语义逐个映射成 REST 端点,天然幂等。
- **exec 通道**:WSS 一条连接 = 一个回合(对应现在"一次 vsock 连接 = 一次 exec")。stdin 方向沿用长度前缀帧 + 零长度 EOF,**端到端直达容器内 shim**;stdout 方向注意 docker 的多路复用头(Tty=false 时 stdout/stderr 在同一流上以 8 字节头分帧,桥接端需解复用——Engine API 文档明确)。
- **EOF 语义(核心结论):不赌传输层半关闭,带内信号一条道走到黑。** 权威事实链:①docker exec 的 stdin EOF 唯一信号=客户端关连接写侧,CloseWrite 转发 2018 年才修好(moby#36517);②moby 维护者 2023 年公开定性现有 exec/attach 流协议 "fundamentally flawed"(discussions#45414),新协议至今未落地;③dockerode 的 stdin 半关闭是其 issue 区长期困惑点(#136/#534/#418);④**K8s 1.31 把 exec 流迁到 WebSocket 时,v5 子协议专门加了"带内 CLOSE 信号"单独关 stdin——官方博客明说是为了 "proper EOF signalling"**。业界结论与我们 P1-C 在 vfkit 上踩坑后的设计完全同构:EOF 必须应用层编码。我们的零长度帧协议**原样贯通到容器内 shim**,shim 收到零帧主动 close(claude.stdin) —— docker exec 全程只当哑字节管道,EOF 可靠性与它无关。
- **中断语义**:WS 断 = 回合 abort(对应现在"连接非正常断 → daemon 杀 claude"→ 这里服务端杀 exec 进程)。**演进项(非 R0)**:服务端保留会话输出缓冲,支持"断线重连 re-attach 不杀回合"(企业网络抖动友好);首版先与现有 VM 崩溃语义对齐(abort)。
- **keepalive(已核实)**:企业中间设备(nginx 默认 proxy_read_timeout 60s、代理/防火墙常更激进)必掐"几十秒无字节"的 agent 回合空窗 → **双向 ping/pong 间隔 25s**(通吃常见默认值的甜点);自建反代显式调大读超时。客户端是 Node(ws 库)可发协议层 ping,无浏览器限制。
- **就绪探测**:客户端 gate 从"VM ready"变"服务器可达 + 容器 ready";`/api/cowork/status` 语义不变,数据源换 REST health。

## 5. 凭证方案(P3-B 移植,三选一,需结合公司 relay 拓扑拍板)

不变的纪律:**真 key 绝不落容器、绝不落服务端磁盘**。变的是注入点位置:

| 方案 | 流向 | 优 | 劣 |
|---|---|---|---|
| **A. 服务端内存代理(直觉推荐)** | 客户端在会话建立时把真 key 经 TLS 交给服务端控制面(仅内存 Map);容器 claude 拿 `cwk_` token → 服务端代理校验→注入真 key→转发真 base_url | P3-B 逻辑几乎原样移植;链路最短 | 真 key 离开用户机(到公司服务器内存)——对公司部署可接受,需明示 |
| **B. 客户端反向隧道** | 容器 claude → 服务端 relay → 经客户端已建立的 WS 多路复用回客户端 → 本机代理注入 → API | 真 key 永不离开用户机(最忠实于 P3-B) | 多一层多路复用协议;API 流量绕道客户端(带宽/时延翻倍;不过 SDK stdio 本来就经客户端,客户端掉线回合本来也死,可用性不额外变差) |
| **C. 服务端自取 key(公司部署可能最优)** | 服务端用用户身份直接向公司账号后端/relay 换取凭证(或服务端持服务账号,per-user 记账),客户端全程不传 key | 客户端最干净;key 生命周期全在公司可控面内 | 依赖账号后端提供相应 API(待确认);个人自带服务器场景不可用 |

推荐:**公司部署走 C(若账号后端支持)否则 A;个人自带服务器走 A**。B 仅在"key 绝不能离开用户机"成为硬需求时启用。三案共用的骨架(token 签发/校验/剥离/authStyle 注入/SSE 流式回)就是现在的 cowork-proxy,代码大头可搬。

## 6. 隔离与安全(服务端侧,硬事实已核实)

### 6.1 运行时选型:默认硬化 runc;gVisor 降级为"可选实验档";Kata/microVM 大概率整体出局

- **gVisor × claude 二进制 = 已知跑不稳(重要证伪)**。claude 原生二进制确认是 **Bun 编译**(bun build --compile,Bun 官方亦确认)。gVisor 兼容性不是想象中的 io_uring 单点问题(Bun 官方文档:io_uring 非硬依赖,内核老到 3.10 也能优雅降级),而是**Bun 事件循环与 gVisor syscall 仿真的多起活跃 bug 且随 claude 小版本回归**:anthropics/claude-code#27230(v2.1.42 正常,**v2.1.49 起在 gVisor 下渲染后 ~5s 静默退出 exit 0**,开 gVisor 实验 --iouring 也无效);#35454(ARM64 gVisor 永久卡死 epoll_pwait);oven-sh/bun#16063 / google/gvisor#11331(bun 在 gVisor 挂起,gvisor 侧仍 open)。**结论:gVisor 不能作为默认承诺;若启用必须锁 claude 版本 + 每次升级回归实测** —— 与我们"CLI 版本跟 SDK 走"的升级纪律直接冲突,故降为可选加固档。
- **Kata/Firecracker(microVM 硬边界)前提 = 宿主 KVM**;服务器若是无嵌套虚拟化的内网云 VM(大概率),整条 microVM 路线出局(连 Docker 官方 Sandboxes、e2b 一起)。gVisor 的 systrap 平台**不需要 KVM**,这是它仍留在演进选项里的原因。
- **默认解 = 硬化 runc**:共享内核,边界=内核攻击面;seccomp/userns 可大幅收窄。产品文案如实标注:"防绝大多数提示注入类攻击,不防内核 0day"。

### 6.2 硬化基线(全部有官方/OWASP 背书,单台服务器一天可落地)

非 root 运行 + userns-remap(容器 root 映射宿主非特权 UID)或 rootless;默认 seccomp(禁 ~44 个 syscall,可再显式禁 `io_uring_*`/`bpf`);`--cap-drop ALL` + `--security-opt no-new-privileges`;`--read-only` rootfs + 仅 workspace volume 可写(`nosuid,nodev`);`--pids-limit`/`--memory`/`--cpus` 限额(防 fork 炸弹/资源耗尽 = 配额)。来源:Docker 官方 security 文档 + OWASP Docker Cheat Sheet(报告末来源清单)。

### 6.3 出网策略:放公网、禁内网(新增必做项,含两个必封旁路)

容器统一放**专用 bridge**(固定子网),`DOCKER-USER` iptables 链(Docker 官方承诺的唯一稳定用户规则挂点,在 FORWARD 之前求值):

```
-I DOCKER-USER -m state --state RELATED,ESTABLISHED -j ACCEPT
(前置例外:-d <宿主IP> -p tcp --dport <代理端口> ACCEPT —— 凭证代理)
-A DOCKER-USER -s <沙箱子网> -d 10.0.0.0/8     -j REJECT
-A DOCKER-USER -s <沙箱子网> -d 172.16.0.0/12  -j REJECT
-A DOCKER-USER -s <沙箱子网> -d 192.168.0.0/16 -j REJECT
-A DOCKER-USER -s <沙箱子网> -d 169.254.0.0/16 -j REJECT   # link-local/云 metadata
```

**两个官方机制决定的旁路,设计里显式封死**:①DOCKER-USER 只管 FORWARD 路径 → 沙箱容器**绝不允许 `--network=host`**(否则整套失效);②Docker 内嵌 DNS(127.0.0.11)由 dockerd 在宿主侧代发、不走 FORWARD 链 → 容器仍可解析内网域名/借 DNS 探测,给沙箱网络指定受控 `--dns` 上游。与用户已拍板的"agent 自由上网"不冲突:自由上**公网**,内网从来不在授权范围。

### 6.4 authz 与审计

- **按用户 authz**:每个容器/volume 打 userId+sessionId label;所有 op 校验"会话属于该用户";对账(reconcileSessions)按用户 scope;另加服务端 TTL 兜底回收(客户端消失不再对账的孤儿)。
- **审计双侧**:客户端 cowork-audit 继续记文件进出;服务端记分配/释放/凭证/配额事件(append-only,同 P3-C 哲学)。

## 7. 容量与运维(粗估,待服务器规格确认)

- 单回合活跃 claude 进程 RSS 数百 MB 量级 + 工具子进程;空闲容器接近零(可回收,volume 保数据)。64GB 内存服务器粗估承载数十个并发活跃回合(估算,POC 实测校准)。
- stream-json 是 KB/s 级文本流,附件 MB 级 —— 内网带宽完全无压力。
- 服务端组件 = 一个 Node 服务 + Docker,交付形态 docker-compose(控制面自身也容器化);镜像升级 = 服务端 pull 新镜像,新会话即用新版,存量容器随回收自然汰换(health op 版本纪律照搬)。

## 8. 先例架构(已核实)—— 我们的方案 = 两个先例的交集,不孤僻

- **OpenHands**:每会话一 runtime 容器,容器内跑常驻 action-execution server(REST),文件走 volume。对照:先例走"容器内常驻 server + 结构化 RPC",我们走"透传原生 stdio 协议"——更薄;容器内 shim 承担的正是先例 server 里"进程生命周期管理"的最小子集。
- **Anthropic 官方 Claude Code on the web(最强背书)**:每会话一隔离沙箱,两条边界=文件系统+网络;**凭证设计与我们 P3-B 完全同构——真凭证不进沙箱,沙箱内用 per-session 降权 token 找宿主侧代理换真凭证**;内部使用中沙箱化让权限弹窗减少 84%。我们等于把官方 cloud 架构自托管化。
- **e2b**:Firecracker 架构,自托管硬性要求 KVM + Nomad/Consul 集群 + 多节点池,**明确不适合一台普通公司服务器**(出局)。
- **Docker Sandboxes(2025 底)**:每 sandbox 一 microVM,官方支持 `docker sandbox run claude` —— 方向印证,但 microVM 需 KVM 且面向"开发者本机",不能替代;其"HTTP(S) 代理做域名允许列表"设计值得未来抄。
- **每会话一沙箱 vs 池化**:业界默认**每会话一个、用完即弃**(Codespaces/claude.ai/Docker Sandboxes/OpenHands 全如此);池化只在"毫秒级冷启动是卖点"的商业沙箱(e2b 靠 Firecracker snapshot)出现。容器冷启动本身秒级,**无池化必要**,预拉镜像即可 —— 印证 §2"容器 per 会话"的推荐。
- **生产隔离选型基准**:AWS Lambda/Fargate=Firecracker;Cloud Run 一代=gVisor、二代=microVM;OpenAI 高风险任务=gVisor + egress 默认全拒;**Anthropic claude.ai 代码执行=gVisor 容器+seccomp**;Codespaces=每会话独占 VM。→ 巨头都在 KVM 富余的基础设施上;单台无 KVM 内网服务器上,硬化 runc + 每会话一容器 + 宿主侧凭证代理是与先例方向一致的最优解。

## 9. 与现有路线的关系 + 诚实代价

| | 本地 VM(macOS,已交付) | WSL2(P2 原计划) | **远程容器(本提案)** |
|---|---|---|---|
| 客户端前置 | 无(entitlement 随包) | VMP+管理员(企业死穴) | **无**(只要能连服务器) |
| 隔离强度 | 架构级(VM) | 策略级(#12443) | 容器级(服务端多租户,选型可升 gVisor/Kata) |
| 保护对象 | 用户真机 | 用户真机(打折) | 用户真机(天然)+ **服务器与内网(新战场)** |
| 离线可用 | ✅ | ✅ | ❌(网络依赖) |
| 数据位置 | 全在本机 | 全在本机 | **用户文件上服务器**(需驻留/删除策略明示) |
| 运维 | 零(用户自机) | 零 | **服务端持续运维**(公司 or 自带服务器的用户) |
| 更新分发 | 每机 3GB 下载 | 每机 rootfs 下载 | **服务端一次**(客户端零下载) |
| 单点 | 无 | 无 | 服务器单点(挂了办公模式全员不可用) |

**建议的路线关系**(待拍板):
- **WSL2 P2 挂起**(不归档不作废):调研成果保留;若未来出现"个人 Windows 用户无服务器"的需求再复活。W1 抽象照做(两用)。
- **macOS 本地 VM 保留为默认**(已交付、离线可用、数据不出机);远程容器作为**新增部署模式**(设置/账号下发决定走哪个 backend)—— 公司部署可统一切远程。
- 远程容器立项为新阶段(暂称 **R 系列**)。

## 10. 分期草案(待调研回填后细化成执行计划)

| 阶段 | 内容 | 环境 |
|---|---|---|
| R0 通道 POC | 服务器上手工容器 + claude + **stdio shim(解帧)**;客户端 SDK→forwarder-remote→TCP→docker exec→shim→claude,stream-json 一轮跑通;EOF(零帧)/中断/并发两会话压测(gVisor 不试,已证实不稳→硬化 runc)。**POC 用裸 TCP 验协议(生产切 WS/TLS 是纯工程,只换连接层);代码 scripts/poc/cowork/remote/** | **你的服务器 + 任一客户端**(mac 即可先验,不用等 Windows!)。**进展:本机协议自测已过(selftest-local.mjs:帧/零帧EOF/stdin-EOF abort自保/流式/并发全 PASS);docker exec 那一格待 UTM 补,验收点见 remote/README.md** |
| R1 W1 抽象 + 服务端控制面 MVP | guest-backend 接口(两用)+ cowork-server(分配/释放/exec 桥/labels 事实源) | mac + 服务器 |
| R2 文件通道 + 产物 | 上传/diff/下载/archive 直读 volume;产物卡链路接通 | 同上 |
| R3 凭证代理 + 审计 | P3-B 移植(方案 A/C)+ 双侧审计 | 同上 |
| R4 多用户 + 配额 + 出网策略 | authz/label scope/TTL 回收/资源限额/DOCKER-USER 禁内网 | 服务器 |
| R5 Windows 客户端收尾 + 打包 + 部署文档 | forwarder .cmd/win 路径面;NSIS 免管理员装;docker-compose 部署包 + 运维文档 | Windows + 服务器 |

**注意 R0-R4 都不需要 Windows 机器** —— 客户端逻辑平台无关,mac 上开发验证,Windows 只在 R5 收尾。这比 WSL2 路线(W0 起就要 Windows)对开发环境友好得多。

## 11. 风险登记册

| 风险 | 等级 | 缓解 |
|---|---|---|
| docker exec EOF 半关闭不可靠 | **已消解(设计层)** | 调研证实不能赌传输层(moby 官方自认协议缺陷)→ 帧协议端到端 + 容器内 stdio shim 为正解(K8s v5 同构背书);R0 实测走通即可 |
| claude(Bun)与 gVisor 不兼容 | **已证实(不再是风险,是事实)** | gVisor 下有活跃 bug 且随 claude 小版本回归(#27230/#35454)→ **默认硬化 runc**,gVisor 仅可选实验档(锁版本+升级回归) |
| 共享内核逃逸(runc) | 中(诚实标注) | 6.2 硬化基线全套;文案"防绝大多数提示注入类攻击,不防内核 0day";服务器有 KVM 则可评估 microVM 演进 |
| 内网横移(提示注入扫内网) | **高(新增)** | 6.3 出网策略为 R4 硬门槛,不做不上多用户;**host network 禁用 + DNS 上游受控两个旁路显式封死** |
| 多客户端版本 vs 单服务器 | 中 | 服务端按版本缓存 claude 二进制,按需下载 |
| 服务器单点/容量 | 中 | 诚实降级(不可达=办公模式不可用,同 cowork_status gate);容量 POC 实测 |
| 用户文件驻留合规 | 中 | 删除级联(volume 随会话删)+ 产品文案明示"文件存于公司服务器" |
| 企业中间设备掐 WS 长连接 | 低(已核实对策) | 双向 ping/pong 25s + 自建反代调大读超时;首版断线=回合 abort(与 VM 崩溃语义一致),"重连 re-attach 不杀回合"列演进项 |

## 12. 待你拍板 + 环境信息问卷

**决策点**:
1. **路线关系**:同意"WSL2 挂起、远程容器立项 R 系列、macOS 本地保留为默认"?
2. **凭证方案**:A(客户端交 key 给服务端内存)/ B(反向隧道)/ C(服务端自取,需账号后端支持)—— 公司 relay/账号后端能否给服务端发凭证?
3. **部署形态**:远程模式只服务公司部署(账号下发 server 配置),还是也开放个人自带服务器(设置页手填)?

**环境问卷(决定 R0 怎么跑)**:
- 服务器:OS/发行版?**CPU 架构(x64/arm64)**?内存/核数?Docker 版本?有无 KVM(裸金属还是云 VM,嵌套虚拟化开没开)?
- 网络:客户端到服务器是纯内网还是公网可达?有无公司 CA/能否签 TLS 证书?服务器出公网(到 API relay/npmmirror)通不通?
- 规模:预期多少用户/并发会话?
- 权限:你在服务器上有 root/docker 权限吗(R0 要装东西)?

## 13. 关键来源(外部硬事实,均为权威源)

- **通道/EOF**:moby#36517(CloseWrite 修复)· moby discussions#45414(维护者定性协议 "fundamentally flawed")· Engine API attach 流格式(8 字节多路复用头)· dockerode#136/#534/#418(stdin 半关闭历史坑)· **K8s 1.31 SPDY→WebSocket + v5 子协议带内 CLOSE 信号**(kubernetes.io blog 2024-08-20 + KEP-4006)
- **gVisor/Bun**:claude 原生二进制=Bun 编译(frr.dev 分析 + Bun 官方确认)· Bun 内核要求(io_uring 非硬依赖,bun.com/docs/installation)· gVisor io_uring 默认禁(gvisor.dev compatibility)· **anthropics/claude-code#27230(v2.1.49 起 gVisor 下静默退出)· #35454(ARM64 卡死)**· bun#16063 / gvisor#11331(挂起,open)· Kata 需 KVM(kata-containers + AWS blog)
- **硬化**:Docker seccomp/userns-remap/rootless/resource_constraints 官方文档 · **DOCKER-USER 链**(docs.docker.com firewall-iptables)· Engine 28 网络硬化 · OWASP Docker Cheat Sheet · gVisor 性能文档 · Firecracker 官方(125ms/<5MiB)
- **先例**:OpenHands runtime 架构文档 · e2b self-host.md(KVM+集群硬要求)· **Anthropic claude-code-sandboxing / how-we-contain-claude(per-session token→宿主代理换真凭证,与 P3-B 同构)**· Docker Sandboxes(docs.docker.com/ai/sandboxes)· Codespaces 安全文档 · OpenAI 基础设施安全博客 · Cloud Run 执行环境文档
- **WS keepalive**:websocket.org timeout/heartbeat 指南 · websockets 库 keepalive 文档
