# Cowork P2 — Windows/WSL2 移植调研

> 创建时间:2026-07-15
> 状态:**调研中**(移植面已盘定;WSL2 技术事实与通道选型待深度调研回填)
> 上游:cowork 主线已收官(P0 + P1-A~E + 办公模式 E1-E5 + 镜像流水线 M1-M4 + P3 安全强化 A/B/C);当前架构见 [docs/handover/cowork-vm-mode.md](../handover/cowork-vm-mode.md)
> 关联:本文档取代 P1 时代 [cowork-local-vm-mode.md](./cowork-local-vm-mode.md) §5.2 的粗略 Windows 判断(那是基于 SSH 架构写的,已被 P1-C~P3 的 vsock+daemon+setuid+代理架构取代)

## 0. 为什么要重新调研

P1 时代 research §5.2 已给出 Windows 骨架(不走 Hyper-V HCS、`wsl --import` 私有 distro、wsl.conf 硬化、`\\wsl$` UNC 文件面、`wsl.exe -e` stdio exec、降级探测)。但那份判断基于**当时的 SSH 转发架构**。此后主线大幅演进,现有 Windows 判断与当前架构已不对齐:

- **通道**:现在是 vfkit 暴露 unix socket → 宿主 vsock RPC ↔ guest Python daemon(AF_VSOCK 监听),不是 SSH。§5.2 说的"exec 走 wsl.exe stdio、文件走 UNC"是两套不同的通道模型,要重新对齐到当前 daemon 架构。
- **每会话隔离**(P3-A):daemon root + exec setuid 降权到会话专属 Linux 用户。
- **凭证不进 VM**(P3-B):宿主代理绑 vmnet 网关 IP,VM 内 claude 走网关拿一次性 token。WSL2 网络模型不同,网关方案要重验。
- **镜像分发**(M2):下载 Debian **raw 磁盘镜像** + cloud-init seed 首启注入。WSL2 是 **rootfs tarball**(`wsl --import`),没有 cloud-init,注入机制完全不同。

**本调研的价值:基于 P3 完成后的当前架构,把 Windows 路线重新对齐成可执行方案,并攻破关键技术不确定点(尤其宿主↔WSL2 通道选型)。**

## 1. 移植面盘点(当前代码的平台假设 —— 客观事实)

核心洞察:**通道抽象层是移植的关键接缝**。`cowork-transfer.ts` 是稳定的文件通道契约(claude-client 依赖它),全部委托给 `cowork-vsock.ts` 的 vfkit vsock 实现;guest 侧路径(`/home/agent/sessions/<id>/workspace`)是 Linux 路径,平台无关。**WSL2 移植 = 换通道实现 + VM 生命周期 + 分发,契约层与 guest 逻辑大量复用。**

| 模块 | macOS 现状 | 平台性 | Windows/WSL2 移植面 |
|---|---|---|---|
| `cowork-vm-manager.ts` | spawn vfkit + vsock 就绪轮询 + pidfile 生命周期 | **macOS 专属** | 需 WSL2 版 manager:`wsl --import`/启动/`wsl --terminate`(绝不 `wsl --shutdown`),就绪探测换通道 |
| `cowork-vsock.ts` | 连 vfkit unix socket 的 vsock RPC(health/mkdir/write/list/read/archive/remove/reconcile/installBinary/exec) | **通道专属** | **最大改造点**:WSL2 宿主↔guest 通道待选型(调研 §3) |
| `cowork-seed.ts` | cloud-init seed(hdiutil 造 cidata ISO,daemon+systemd base64 注入) | **macOS 专属** | WSL2 无 cloud-init,改 rootfs 构建期定制 或 首次 import 后初始化脚本 |
| `scripts/poc/cowork/cowork-daemon.py` | AF_VSOCK 监听 + 文件op + exec 帧封装 + 每会话 setuid + reconcile | **大部分可复用** | 业务逻辑(文件op/exec/setuid/用户生命周期)复用;仅 `AF_VSOCK` 监听层换成 WSL2 通道的服务端 |
| `cowork-proxy.ts` | 绑 vmnet 网关 `192.168.64.1:8788`,校验来源 vmnet 网段 | **网络专属** | WSL2 网关 IP/网段不同(NAT vs mirrored,调研 §3);来源校验网段要参数化 |
| `cowork-paths.ts` | vfkit 路径解析、vsock socket 路径、资产目录 | 部分专属 | 加平台分支:vfkit vs wsl.exe、vsock socket vs WSL2 通道端点 |
| `cowork-assets.ts` | 下载 Debian **raw 磁盘**(中科大)+ sha512 + 稀疏扩容 | **分发专属** | WSL2 下载 **rootfs tarball**;manifest 加 WSL2 rootfs 来源 + 校验;claude binary 复用(WSL2 是真 Linux x64/arm64) |
| `cowork-transfer.ts` | 文件通道契约,全部委托 cowork-vsock | **契约稳定** | 契约不变,底层 vsock 实现换 WSL2 通道即透明 |
| `forwarder-vsock.sh/.mjs` | SDK 当 claude spawn 的转发器,连 vsock 发 exec 帧 | **通道专属** | WSL2 版 forwarder(连 WSL2 通道 或 `wsl.exe -e` 包装) |
| `claude-client.ts` cowork 分支 | decideCowork + 注入 `COWORK_VSOCK_PATH/NODE_BIN` + 代理注册 + 附件推送 | **大部分复用** | 通道相关 env(VSOCK_PATH)抽象成平台无关的通道端点 |
| `cowork-audit.ts` | 宿主侧 append-only 审计 | **平台无关** | 复用 |
| `cowork-guards.ts` / `cowork-staging.ts` | 纯逻辑(守卫/暂存目录) | **平台无关** | 复用 |
| UI(双栏/空态卡/设置开关/产物卡/横幅) | React 组件,平台无关 | **平台无关** | 复用(降级探测失败时办公 tab 隐藏,复用现有 cowork_status gate) |

**结论:约一半模块(契约层 + guest 业务逻辑 + UI + 审计 + 守卫)可直接复用;需 Windows 实现的是"通道 + VM 生命周期 + 分发 + 网络"四块,且它们都收敛在清晰的接缝上(cowork-vsock / cowork-vm-manager / cowork-assets / cowork-proxy)。这是一次"补平台后端"的移植,不是重写。**

建议引入一个 **platform-agnostic guest backend 接口**(封装 vsock RPC 的 10 个 op + VM 生命周期 + 通道端点),macOS 实现=vfkit+vsock,Windows 实现=WSL2+待选通道。claude-client / cowork-transfer 只依赖接口。

## 2. 关键不确定点(待深度调研攻破)

1. **宿主↔WSL2 guest 双向通道**(决定 cowork-vsock 怎么改,最大不确定点):AF_VSOCK/hvsocket 能否从 Windows 宿主连 WSL2 内监听?还是 localhost forwarding?还是 `wsl.exe -e` stdio?—— 现在的 daemon 是 AF_VSOCK 长连接 RPC + 流式 exec,通道要能承载长时双向流。
2. **WSL2 systemd**:daemon 靠 systemd 自启(macOS seed 里配),WSL2 systemd 支持的版本要求与私有 distro 实践。
3. **rootfs 定制注入**:无 cloud-init,定制(daemon/systemd/agent 用户/关不必要服务)怎么进 rootfs.tar。
4. **WSL2 网络**:宿主代理(P3-B)绑哪个网关 IP;NAT vs mirrored networking(Win11)的差异;来源 IP 校验怎么做。
5. **隔离边界诚实性**:drvfs 挂回宿主 C 盘的风险(§5.2 提过 bug #12443)对"真机文件不可见"承诺的影响;agent 非 root 能否封住。
6. **降级探测**:编程探测 WSL 可用/VMP 启用/BIOS 虚拟化/GPO 的方式。

## 3. WSL2 关键技术事实(深度调研,均有权威来源)

### 3.1 宿主↔guest 通道(最关键)
- **裸 vsock/hvsocket 非免管理员**:WSL2 内部确实跑在 hvsocket 上(plan9 文件服务),但"宿主监听、guest 连入"要么用真实 VmId(取它需 `hcsdiag`,管理员),要么在 `HKLM\...\GuestCommunicationServices` 注册服务 GUID(建 HKLM 键需管理员)。最著名的宿主↔guest 桥接实现 **wsl-vpnkit v0.4 后已弃用 vsock,改 stdio 管道**,README 明确"no admin privileges"——正因裸 vsock 要 admin。来源:microsoft/WSL#5751、containers/gvisor-tap-vsock、sakai135/wsl-vpnkit。
- **`wsl.exe -d <distro> -e <cmd>` 的 stdio 长流可行且有生产先例**:wsl-vpnkit 用它承载长时双向流。EOF 坑 #5699 只发生在"WSL 里启动 Windows exe"方向(与我们相反,不踩);但 #4424(宿主 RedirectStandardInput 跑 wsl.exe 进程不退出)是我们的方向,**须 POC 专门压测半关闭/EOF**。来源:microsoft/WSL#5699、#4424。
- **localhost 转发有方向性**:NAT(默认,全 Win10/11)只保证"宿主→WSL2 可 localhost",反向 WSL2→宿主要用宿主 IP(动态查默认路由,172.x 网段);mirrored 模式(**仅 Win11 22H2+**)双向 `127.0.0.1`,但入站需配 Hyper-V 防火墙、IPv6 loopback 不支持。来源:learn.microsoft.com/windows/wsl/networking。
- **`\\wsl$` UNC 文件访问**:9p over hvsocket,**小文件极慢、有历史竞态**;仅适合偶发单文件,不能做高频 RPC。来源:wsl.dev/plan9、microsoft/WSL#9412。

### 3.2 systemd(daemon 自启)
- Store 版 WSL **0.67.6+** 支持,**Win10/11 均可**;`/etc/wsl.conf` 的 `[boot] systemd=true`。须 mask 一批会出问题的 unit(systemd-resolved/networkd/NetworkManager/tmp.mount 等)。**caveat**:systemd service 不阻止 VM idle 关机(默认 `vmIdleTimeout=60s`),常驻需外部保活。来源:devblogs systemd-support、learn.microsoft build-custom-distro。

### 3.3 wsl --import 私有 distro
- **平台首装需管理员 + 重启(一次性,任何 VM 方案绕不开)**:`wsl --install` 启用 Virtual Machine Platform 后须重启。
- **import 本身 per-user**(注册在 `HKCU\...\Lxss`,证据强但无一句官方"免 admin"原文 → **目标机实测坐实**)。
- **cloud-init seed 的等价物 = `/etc/wsl-distribution.conf` 的 `[oobe] command`**(首次进 shell 跑一次初始化脚本,WSL **2.4.4+**);rootfs 从 distro Mini Root FS tar 或 `docker export` 来;`shortcut.enabled=false` 隐藏开始菜单快捷方式(但 distro 仍在 `wsl -l` 可见,无文档化的完全隐藏)。来源:learn.microsoft build-custom-distro、use-custom-distro。

### 3.4 隔离边界(移植的最大安全落差)
- **`automount=false` 不是硬边界**:issue **#12443 仍 open**——只要有"普通+管理员"一对 PowerShell 进入同一运行中的 distro,WSL 会忽略 automount 设置、把**所有** Windows 盘挂进来。root 手动 `mount -t drvfs C:` 也始终可行。
- **agent 非 root 部分缓解**:挡住"主动新挂 drvfs",但挡不住已挂盘的访问(受 WSL 进程对应 Windows 用户的 NTFS ACL 约束)。
- **结论:WSL2 的"真机文件不可见"弱于 vfkit**(vfkit 里 guest 根本看不到宿主 FS)。硬化组合(automount=false + 无 fstab + interop=false + agent 无 sudo + 低权限 Windows 用户跑 WSL)能逼近但非 airtight。来源:microsoft/WSL#12443。

### 3.5 降级探测(编程方式齐全)
- WSL/VMP 是否启用:`Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Windows-Subsystem-Linux / VirtualMachinePlatform`;运行时 `wsl --status`;BIOS 虚拟化 `Get-ComputerInfo -property "Hyper*"` 看 `HyperVRequirementVirtualizationFirmwareEnabled`;hypervisor `bcdedit /enum | findstr hypervisorlaunchtype`;错误码 `0x80370102`=VMP/BIOS 未开;企业 GPO 读 `HKLM\SOFTWARE\Policies\Microsoft\Windows\WSL\AllowWSL`(=0 禁用)。来源:learn.microsoft troubleshooting、intune。

### 3.6 前瞻:WSL Containers(wslc.exe)
- **2026-06-29 公开预览**(WSL 2.9.3 pre-release),**GA 目标 2026 秋**。**每会话独立轻量 Hyper-V utility VM** + 默认 virtiofs(文件访问 2x)+ 官方 `Microsoft.WSL.Containers` NuGet 编程 API(C/C++/C#)。**架构上比"单 import distro 内 setuid 多用户"更贴近 macOS 侧的每会话隔离模型**,但 pre-release 不宜作当前地基,列为 6-12 个月演进目标。来源:devblogs wsl-container-public-preview。

## 4. 通道选型决策 —— 走 `wsl.exe -e` stdio 模型(与当前架构天然契合)

**结论:WSL2 通道不走 vsock/hvsocket(要 admin),走"每 RPC 一次 `wsl.exe -d <distro> -u root -e python3 daemon.py <op> ...`"的 stdio 模型。**

为什么这跟当前架构**几乎零阻抗**:
- **cowork-vsock 的每个 rpc\* 本来就是"一次连接=一个 op"**(health/writeFile/listFiles/readFile/exec…),换成"一次 wsl.exe -e = 一个 op"是**同构映射**,契约层 cowork-transfer 完全不动。
- **forwarder 本来就是"spawn 一个进程做双向管道"**,Windows 版 forwarder = spawn `wsl.exe -d <distro> -u root -e python3 daemon.py exec <sid>`,它的 stdin/stdout 直接是 claude 的双向流。
- **daemon 的 op 逻辑(文件/exec/每会话 setuid)完全复用**,只加一个"stdio 模式入口"(argv 解析 + 读写 stdin/stdout,取代 AF_VSOCK accept 循环)。`-u root` 让 daemon root 跑,P3-A 的 setuid 降权原样可用。
- **免 admin(运行期)、免 vsock 注册、免常驻 daemon**(每次 wsl.exe -e spawn 短命进程处理一个 op;exec 是长命进程=一次回合)。

**唯一要 POC 攻破的**:exec 通道的 EOF/半关闭语义(#4424)——当前 vsock 版做了帧封装是因为 vfkit 不传播半关闭;wsl.exe stdio **可能可靠传 EOF(则可去掉帧封装,更简单)**,也可能踩 #4424(则保留帧封装)。POC 定夺。

引入 **platform guest-backend 接口**(封装 10 个 op + VM 生命周期 + 通道端点),macOS 实现=vfkit+vsock(现状),Windows 实现=WSL2+stdio。claude-client/cowork-transfer 只依赖接口。

## 5. 工作量与分期建议

| 阶段 | 内容 | 说明 |
|---|---|---|
| **W0 通道 POC(先行,最大不确定点)** | `wsl.exe -e` stdio 跑通 daemon 的 health/writeFile/exec 双向流 + **EOF 半关闭 #4424 压测** + claude linux binary 在 WSL2 跑通 stream-json 一轮 | 不通过则退 mirrored TCP-over-localhost(限 Win11 22H2+)。POC 脚手架放 scripts/poc/cowork/ |
| **W1 平台后端抽象** | 抽 guest-backend 接口,macOS 现状包装成 vfkit 实现;daemon 加 `--stdio` 模式(复用全部 op) | 纯重构,macOS 零回归 |
| **W2 WSL2 后端** | WSL2 版 vm-manager(wsl --import/启动/wsl --terminate,**绝不 wsl --shutdown**)+ stdio 通道 + Windows forwarder | |
| **W3 分发** | cowork-assets 加 WSL2 rootfs tarball 来源 + import + wsl-distribution.conf oobe 定制(daemon/systemd/agent 用户/mask unit);claude binary 复用 | |
| **W4 网络+代理** | cowork-proxy WSL2 网关发现(NAT:查 guest 默认路由拿宿主 IP;来源校验网段参数化) | P3-B 移植 |
| **W5 降级探测+UI** | 探测 WSL/VMP/BIOS/GPO,任一不满足→隐藏办公 tab + 引导文案(复用 cowork_status gate) | |
| **W6 隔离硬化+诚实文案** | wsl.conf 硬化组合 + #12443 残余风险产品文案 | |
| **W7 打包+裸机验收** | Windows NSIS 打包(项目已有 CI windows-2022 经验)+ 全新 Win 机验收 | |

## 6. 风险、降级与诚实边界

- **隔离落差(最重要,需用户拍板)**:WSL2 的"真机文件不可见"**弱于 macOS vfkit**——#12443 让 automount=false 可被提权 PowerShell 绕过。产品文案必须诚实:WSL2 是"**策略级强隔离,非架构级 airtight**"。**这是一个战略决策点**:接受这个落差先交付 Win 版(硬化组合缓解 + 诚实文案),还是等 WSLC GA(2026 秋,每会话独立 utility VM = 架构级隔离)?
- **首装 admin+重启**:硬约束(任何 Win VM 方案绕不开),给清晰引导文案(一次性)。
- **VM idle 关机**:WSL2 默认 60s idle 关机,常驻需保活(host 持一个连接或调 vmIdleTimeout);stdio 模型下每回合一次 wsl.exe -e,天然按需拉起,idle 关机反而省资源——保活只对"回合间复用"有意义。
- **企业 GPO 禁 WSL**:降级探测 + 引导(联系 IT),不做弱沙箱冒充。
- **stdio EOF(#4424)**:W0 POC 攻破;不通过退 mirrored localhost。
- **UNC 慢**:大文件/高频不走 UNC,走 stdio 通道。

## 7. 待 POC 验证的假设(W0)

1. `wsl.exe -d <distro> -u root -e` 的 stdio 能承载 daemon 的短 op(health/writeFile,JSON+字节)与长 op(exec 双向流式 stream-json)。
2. exec 通道的 EOF/半关闭语义(#4424):可靠传 EOF(去帧封装)还是要保留帧封装。
3. claude linux binary(x64,复用 SDK 平台子包)在 WSL2 distro 内跑通 stream-json 一轮(经宿主代理注入凭证)。
4. `wsl --import` 在标准用户 + 平台已装的机器上免 UAC(坐实 per-user)。
5. 宿主代理在 NAT 模式下网关可达性(WSL2→宿主 IP)。

## 8. 需要你拍板的决策点

1. **隔离落差怎么处理**(最重要):接受"策略级隔离 + 诚实文案"先交付,还是等 WSLC GA 的架构级隔离?
2. **目标 Windows 版本**:全 Win10/11(NAT + stdio 模型,推荐)还是要求 Win11 22H2+(可用 mirrored localhost,但砍掉一批用户)?
3. **优先级**:P2 现在做,还是先合流 main + 用户手册,P2 排后?(P2 是整个 cowork 里体量最大、且有隔离落差需权衡的一块)
