# Cowork 模式(本地虚拟机隔离)实现方案调研

> 调研日期:2026-07-09。状态:**调研完成,待立项**。
> 需求:参考 Claude 官方 Cowork,新增一种会话模式——底层仍走 Claude Agent SDK,但 agent **不能读写用户真机文件**;应用在用户本机部署一个虚拟机,用户通过对话框发送文件 → 自动放入 VM → agent 在 VM 内读改建 → 完成后用户从 VM 下载产物。全程不动真机文件。

---

## 0. 结论速览(TL;DR)

| 决策点 | 推荐 | 一句话理由 |
|---|---|---|
| 总体架构 | **宿主 SDK 不动 + "转发桥"把 CLI 进程放进 VM** | SDK 0.3.203 开放 `pathToClaudeCodeExecutable`/`env`,现有 claude-client.ts 2300 行逻辑几乎零改动(已本地核实) |
| VM 内 agent | **官方 linux 平台子包的 claude binary** | npm 官方发布 linux-x64/arm64(glibc+musl)~250MB,版本与宿主 SDK 严格同步(已核实 0.3.203 存在) |
| macOS 虚拟化 | **Virtualization.framework + 捆绑 vfkit**(Apache-2.0) | 与官方 Cowork 同底层;双架构、macOS 12.5+、冷启动 1–3s、DMG 增量 60–120MB/架构;Podman/minikube/ovm 生产先例 |
| Windows 虚拟化 | **WSL2 私有 import distro**(硬化 wsl.conf) | Home 版可用、微软维护、体积小;**不学 Cowork 走 Hyper-V HCS**(Home 版全挂,官方 issue 堆积成反面教材) |
| 文件进出 | **拷贝语义**(RPC push/pull),**不用** Cowork 的 VirtioFS 挂载 | 需求是"全程不动真机",比 Cowork 更严格也更简单——不挂真机目录,隔离承诺更硬 |
| 凭证 | 起步 env 注入不落盘;目标态 **宿主侧 API 代理,token 永不进 VM** | 复刻 Cowork 的出口代理模型 + 本项目 usage-meter 已有主进程代理先例 |
| 镜像分发 | 安装包不带,**首次启用时下载 + 后台预热**(zstd ~500MB 级) | Cowork 同款策略;安装包已因内置 CLI 涨到 ~350MB,不宜再 +250MB×2 |

**总评:技术路线全部打通,无硬阻塞点。** 最大的工程风险不在虚拟化(两平台都有成熟先例),而在:① SDK↔CLI stream-json 协议跨 VM 转发的长期兼容性维护;② Windows 侧"BIOS 虚拟化未开 / 企业 GPO 禁 WSL"人群的降级体验。

---

## 1. 参照系:官方 Cowork 是怎么做的(逆向事实库)

多源逆向(Simon Willison / pvieito / aaddrick / pluto.security)+ Anthropic 员工 HN 确认 + 官方文档,交叉一致:

### 1.1 隔离栈

```
宿主 hypervisor(macOS: VZVirtualMachine / Windows: Hyper-V HCS)
  └─ Ubuntu 22.04 guest(mac 上 arm64)
       └─ 每会话临时非特权用户(会话间互不可读)
            └─ bubblewrap 命名空间
                 └─ seccomp 系统调用过滤
                      └─ Claude Code CLI(与 Claude Code 同一套 harness,官方确认)
```

- 信任边界刻意放在 **VM 这一层**:guest 内 `coworkd` 守护进程以 root 跑且关掉了进程加固——VM 里提权到 root 也仍被关在虚拟机里。
- Windows 用 **完整 Hyper-V HCS**(`vmcompute` → `vmwp.exe`),后果:**Windows Home 全部跑不起来**,anthropics/claude-code 仓库 #27906、#59035 等大量 issue。这是我们要避开的坑。

### 1.2 关键工程机制(可直接借鉴)

| 机制 | Cowork 做法 | 对我们的启示 |
|---|---|---|
| 镜像分发 | ~500MB zstd 下载 → 10GB 稀疏 `rootfs.img`;**用户正常聊天时后台预热下载**,点开 Cowork 时把预热 bundle "提升"为正式会话 | 直接抄:首次启用下载 + 预热,不进安装包 |
| CLI 部署 | **claude CLI 不预装在 rootfs**,宿主通过 `installSdk()` RPC 动态推进 VM | 直接抄:binary 随宿主 SDK 版本走,镜像与 CLI 解耦升级 |
| 宿主↔guest 控制通道 | 长度前缀 JSON-RPC:宿主侧 Unix socket(`cowork-vm-service.sock`),guest 侧 **AF_VSOCK**;约 22 个方法(startVM/spawn/writeStdin/mountPath/readFile/installSdk/subscribeEvents…) | 我们的 guest-daemon RPC 面照此设计,方法数可减半 |
| agent 进程模型 | guest 内 `sdk-daemon` 按任务拉起 `claude` CLI,`--allowedTools ... --mcp-config --resume <uuid>` + **stream-json 双向 I/O** | 证实"stream-json 跨 VM 边界转发"正是官方在生产跑的模式 |
| 文件进出 | **VirtioFS 双向共享挂载**真实目录到 `/sessions/<name>/mnt/<folder>`,agent 原地读写、改动实时落回真机;另有每会话 `uploads/`、`outputs/` 挂载点 | **我们不这么做**(见 §4):需求是拷贝语义 |
| 网络 | guest 内禁止自发起原始出网;强制走宿主侧代理(HTTP :3128 / SOCKS :1080,socat 桥),域名白名单(api.anthropic.com/npm/pypi/github),对 api.anthropic.com 做临时 CA 的 MITM | 目标态照抄简化版(§6) |
| 资源 | 4 vCPU、~4GB 内存档、常驻 1.8–2.6GB | 我们按需启动 + 空闲关机,内存 2GB 起步 |

来源(节选):官方架构文档 support.claude.com/articles/14479288;Anthropic 工程博客 anthropic.com/engineering/how-we-contain-claude;simonwillison.net/2026/Jan/12/claude-cowork/;pvieito.com/2026/01/inside-claude-cowork;pluto.security/blog/inside-claude-cowork;开源协议复刻 github.com/patrickjaja/claude-cowork-service。

### 1.3 与我们需求的一个本质差异

Cowork 的文件模型是**共享挂载**(授权文件夹 → VirtioFS 双向挂进 VM,产物原位落回真机)。我们的需求是**拷贝快照**(发送进去、做完拷出、真机零改动)。这意味着:

- 我们**不需要** VirtioFS 挂载真机目录——整面"挂载点权限管理/路径穿越校验"的复杂度直接消失;
- 隔离承诺反而更强:VM 与真机文件系统**零共享面**,唯一通道是受控的 push/pull RPC;
- 代价是"产物要显式导出"的一步交互——但这正是产品定义想要的("下载使用")。

---

## 2. 本项目现状与集成点(已实地核实)

### 2.1 现有执行链路

```
Electron main(electron/main.ts)
  └─ fork/utilityProcess → Next.js standalone server
       └─ /api/chat(src/app/api/chat/route.ts)
            └─ claude-client.ts → SDK query()
                 └─ SDK 内部 spawn 平台子包 native binary(claude / claude.exe)
                      cwd = session.working_directory(真机目录)
                      文件工具直接读写真机 ← cowork 要切断的就是这里
```

- 上传:前端 base64 → [route.ts:213](../../src/app/api/chat/route.ts) 写入 `{working_directory}/.codepilot-uploads/` → prompt 引用真机绝对路径。
- Runtime 抽象已存在:[types.ts](../../src/lib/runtime/types.ts) 的 `AgentRuntime`(stream/interrupt/isAvailable/dispose,17 种 SSE 事件为契约)。
- 凭证经 env 注入 SDK 子进程(credential-encryption 的"双进程 env 过河"模式),可直接延伸为"注入 VM 内 exec"。

### 2.2 SDK 侧的两个决定性核实(本机 node_modules@0.3.203)

1. **`Options` 开放完整 spawn 控制面**(`sdk.d.ts:1690` 等):`pathToClaudeCodeExecutable?: string`("Uses the built-in executable if not specified")、`env?`、`extraArgs?`、`executable?/executableArgs?`、`stderr?: (data) => void`。→ 可以把 spawn 目标换成我们的转发器,SDK 无感。
2. **官方 linux 平台子包存在且版本同步**:`@anthropic-ai/claude-agent-sdk-linux-arm64-musl@0.3.203` unpacked ≈ 247MB、`linux-x64-musl` ≈ 251MB(npm view 核实);另有 glibc 版 `linux-arm64`/`linux-x64`。→ VM 内直接跑官方 binary,无需自建 Node 环境,版本与宿主 SDK 主包天然锁定。

### 2.3 SDK 官方能力边界(调研确认)

- SDK **没有**官方"remote tool executor"——工具执行永远发生在 CLI 进程所在机器。所以隔离的唯一正解:**把 CLI 进程放进 VM**。
- Claude Code 自带的 sandbox(macOS Seatbelt / Linux bubblewrap)是进程级隔离,同内核,达不到"真机不可见"的硬边界,不满足本需求(可作为 VM 内的纵深层)。
- `permissionMode: bypassPermissions` 官方建议的适用场景恰是"无宿主挂载的容器/一次性 VM"——cowork 模式内可安全启用,消灭权限弹窗(Cowork 的"减少审批疲劳"同款思路)。

---

## 3. 核心架构:转发桥(Forwarder Bridge)

### 3.1 两个候选拓扑

**方案 A(推荐):宿主 SDK + 转发桥,CLI 在 VM 内**

```
Next server(宿主)                          VM guest
┌─────────────────────────┐               ┌──────────────────────────┐
│ claude-client.ts(不动)  │               │ guest-daemon(常驻)       │
│   └ SDK query()          │   vsock/     │   └ 按请求 spawn claude   │
│      └ spawn 转发器 ──────┼── AF_VSOCK ──┼──→   (linux binary)      │
│        (argv+env 打包,   │   或 wsl.exe │      cwd=/sessions/<id>  │
│         stdio 字节透传)   │              │      stream-json stdio    │
└─────────────────────────┘               └──────────────────────────┘
```

- 转发器是一个小程序(Go 静态二进制或 node 脚本):被 SDK 当作 claude 可执行文件 spawn;启动后把自己收到的 argv + 白名单 env 打包成 exec 请求发给 guest-daemon,之后双向透传 stdin/stdout 字节流,stderr 回传给 SDK 的 `stderr` 回调。
- SDK↔CLI 之间的一切(stream-json 消息、控制协议、in-process MCP 调用、canUseTool 权限回调)都封装在这条 stdio 流里,**转发器只搬字节,不解协议**。
- 改动面:claude-client.ts 只加一个分支——cowork 会话时设 `pathToClaudeCodeExecutable=转发器` + `env` 白名单 + cwd 映射;其余 2300 行(MCP 装配、skills、权限、resume、usage)原样复用。

**方案 B(Cowork 同款):guest 内 daemon 全权管理 agent,宿主只发 RPC**

- 宿主的 SDK 调用逻辑要拆到 guest(或重写 daemon),canUseTool/权限回调、SDK in-process MCP server(codepilot-skill / codepilot-media)全部要跨 VM RPC 化,改动巨大。
- 优点:宿主↔guest 接口收敛为粗粒度 RPC,SDK 升级只影响 guest 侧。

**推荐 A 起步、协议兼容性出问题时以 B 兜底。** 官方 Cowork 走的是 B(它没有我们这样的存量宿主侧 SDK 集成),而 A 对本项目是改动最小路径;A 的核心赌注"stream-json stdio 可跨边界转发"已被 Cowork 生产验证(guest 内 sdk-daemon ↔ claude 也是 stream-json stdio)。

### 3.2 方案 A 的关键细节

| 问题 | 处理 |
|---|---|
| cwd 映射 | SDK spawn 转发器时 cwd 是宿主路径;exec 请求里显式带 `guestCwd=/sessions/<id>/workspace`,daemon 以之为 CLI cwd |
| env 白名单 | 只透传 `ANTHROPIC_*`、`CLAUDE_*`、代理相关;宿主机路径类 env(HOME 等)一律不过河 |
| 版本锁定 | guest 内 claude binary 由宿主在 VM 启动/升级时推送(installSdk 模式),取自 CI 预置的 linux 子包,版本 = 宿主 SDK `claudeCodeVersion`,消灭漂移 |
| SDK 升级回归 | 每次升级 SDK 跑 cowork E2E 冒烟(转发桥打通一条消息 + 文件读写);协议是 SDK↔CLI 内部协议,升级窗口内两端同步更新,风险可控 |
| 中断/kill | SDK abort → 转发器进程被 kill → daemon 检测连接断开 → kill guest 内 claude 进程树 |
| resume | `--resume <uuid>` 依赖 guest 内 `~/.claude` 会话文件;VM 常驻期间天然可用;VM 重建则丢(与现有"重开会话"语义一致,可接受;进阶:把 guest 会话目录持久化到数据盘) |
| stdio MCP(用户配置的) | CLI 在 VM 内 spawn,VM 里没有 npx/uvx → **cowork 会话默认屏蔽外部 stdio MCP**(UI 标注),SSE/HTTP MCP 经出口代理可用;SDK in-process MCP(codepilot-*)经控制协议回宿主执行,不受影响,但其中涉及宿主文件路径的工具(如 media import)需按 §4 的 pull RPC 改造 |

### 3.3 与 Runtime 抽象的关系

不建议做成第三个 `AgentRuntime`(它不是新引擎,仍是 SDK runtime),而是 SDK runtime 的一个**执行后端(execution backend)维度**:`session.execution_target = 'host' | 'vm'`。DB 的 `chat_sessions` 加一列;`RuntimeStreamOptions.runtimeOptions` 传 `executionTarget`,claude-client.ts 内分支。

---

## 4. 文件进出流水线(拷贝语义)

### 4.1 Guest 目录布局

```
/sessions/<sessionId>/
  uploads/     ← 用户发送的文件(daemon writeFile 写入,agent 视角只读)
  workspace/   ← agent 的 cwd,自由读写创建
  (产物 = workspace 下用户可下载的一切)
```

每会话一个目录 + 一个临时非特权用户(Cowork 同款,`drwxr-x---` 会话互不可读);起步可先单用户简化,Phase 3 再加。

### 4.2 上传(对话框 → VM)

现有链路改造:[route.ts:210-225](../../src/app/api/chat/route.ts) 的 cowork 分支不再写 `.codepilot-uploads/`,改为 `guestDaemon.writeFile(sessionId, name, buffer)`(vsock RPC / Windows 走 `\\wsl$` UNC 直写),prompt 中引用 **VM 内路径** `/sessions/<id>/uploads/<name>`。消息气泡的文件预览仍用宿主暂存副本(现有 uploads 服务复用),两份互不影响——真机上的暂存副本属于应用数据目录,不属于"用户文件被改动"。

### 4.3 下载(VM → 用户)

1. 回合结束后 daemon `listFiles(sessionId, since)` 报告 workspace 新增/修改文件(mtime 快照 diff);
2. SSE 推 `vm_artifacts` 事件 → 前端渲染产物卡片(文件名/大小/预览);
3. 用户点击下载 → `/api/cowork/artifacts?session=..&path=..` → daemon `readFile` 流式拉出 → 浏览器"另存为"(用户主动选择落点,这一步是用户导出动作,不违背"agent 不动真机");
4. 支持"全部打包下载"(daemon 在 guest 内 tar/zip 后拉出)。

### 4.4 防护(照抄 Cowork 已验证的)

- daemon 侧路径规范化 + 前缀校验(防 `../` 逃出会话目录);
- 可执行文件类型(.exe/.app/.jar/.sh 等)下载时警示或拦截;
- 上传/下载大小限额与进度事件。

---

## 5. 平台虚拟化选型

### 5.1 macOS:Virtualization.framework + vfkit(推荐,与 Cowork 同底层)

| 维度 | 结论 |
|---|---|
| 组件 | 捆绑 [vfkit](https://github.com/crc-org/vfkit)(Apache-2.0,Red Hat CRC 团队,Go 单二进制 ~15MB;Podman applehv / minikube / CRC 生产使用);或用 Code-Hex/vz(MIT)自研 helper |
| 签名 | helper 需 `com.apple.security.virtualization` entitlement——**普通 entitlement,自助声明,无需 Apple 审批**,与现有 Developer ID + 公证兼容;在 `scripts/after-pack.js` 对 helper 单独 codesign(项目已有该钩子);默认 NAT 出网,不需要要审批的 `com.apple.vm.networking` |
| 系统/架构 | arm64 + x64 都支持;实践下限 **macOS 12.5+**(virtio-fs 线,Docker 同判);Intel 老系统钉 6.1/6.6 LTS 内核(规避 6.2 引导 bug) |
| 通信 | vfkit 把 guest vsock 端口转发成宿主 Unix socket,Node 直接连;serial console 日志采集;`--restful-uri` 管生命周期 |
| 体积/启动 | 内核 + Debian slim rootfs + daemon:DMG 增量 60–120MB/架构(若镜像改为下载则近零);冷启动 1–3s(OrbStack 同框架 2s 为标杆) |
| 同构先例 | oomol-lab/[ovm](https://github.com/oomol-lab/ovm)(MPL-2.0):Electron 应用内嵌 vfkit 跑 Linux VM,macOS 12.3+,含睡眠暂停/唤醒恢复——特性清单几乎就是我们要做的,强烈建议读源码 |
| 出局项 | apple/container(要 macOS 26 + AS only,1–2 年后的迁移目标);Tart(Fair Source 许可 + 有执法记录);QEMU(体积/启动/macOS host 无 virtio-fs,仅作老系统兜底);libkrun/microsandbox(仅 arm64,若未来砍 Intel 可重估,microsandbox 是"microVM 隔离 AI agent"同题开源实现值得读) |

### 5.2 Windows:WSL2 私有 import distro(推荐,明确不学 Cowork)

| 维度 | 结论 |
|---|---|
| 为什么不是 Hyper-V HCS | Cowork 的选择,**Home 版无 vmms 彻底不可用**,官方仓库 issue 成灾(#27906/#59035 等)。WSL2 走 Virtual Machine Platform 精简层,**Home 版可用** |
| 部署 | 首次:`wsl --install --no-distribution`(**一次管理员 + 一次重启**,这是 Windows 平台硬约束,任何 VM 方案都绕不开);之后 `wsl --import <私有名> <目录> rootfs.tar` 注册专属 distro——**per-user、免管理员**;`/etc/wsl-distribution.conf` 关掉开始菜单快捷方式做到对用户隐形 |
| 隔离硬化(必做) | `wsl.conf`:`[automount] enabled=false`(否则 /mnt/c 默认暴露整个 C 盘!)+ `[interop] enabled=false` + `appendWindowsPath=false`;agent 以非 root 无 sudo 用户跑 |
| 诚实边界 | WSL2 是"策略级强隔离,非架构级 airtight":distro 内 root 理论可 `mount -t drvfs C:` 挂回宿主盘;已知 bug #12443(管理员 PowerShell 进入时盘会挂回)。缓解 = agent 无 root + bwrap;产品文案如实标注。若未来要 airtight,可评估 QEMU+WHPX 备路 |
| 文件传输 | 宿主直接走 `\\wsl$\<distro>\` UNC 读写(免自建 RPC 的文件面),exec 走 `wsl.exe -d <distro> -e ...` stdio 管道(转发器在 Windows 上就是包一层 wsl.exe) |
| 降级探测 | 启用前探测:`wsl --status` / Virtual Machine Platform / BIOS 虚拟化(0x80370102)/ GPO `AllowWSL`。任一不满足 → **该设备禁用 cowork 模式并给出引导文案**(BIOS 开启指引/联系 IT)。不做弱沙箱冒充(OpenAI Codex 的受限令牌方案只是"写边界",做不到"真机不可见",与本需求的核心承诺冲突) |
| 多应用共存纪律 | 绝不调 `wsl --shutdown`(会杀掉用户其他 distro);不改全局 `.wslconfig`;只 `wsl --terminate <私有名>` |
| 前瞻 | 微软 WSL Containers(wslc.exe)2026-06 公开预览、2026 秋 GA,原生容器 + virtiofs、免 Docker Desktop——GA 后可评估替代自管 distro |

### 5.3 Guest 镜像(两平台共用一套构建)

- **Debian 13 slim 打底**(glibc):Cowork 也用 Ubuntu;agent 会跑 pip/npm/git 等工具链,glibc 兼容面大;claude binary 用 glibc 版 linux 子包。Alpine+musl 更小(~10MB)但工具链兼容差,不值。
- 预装:git、ripgrep、curl、unzip、python3、node22(供 agent 干活用,非跑 CLI 用)+ guest-daemon(Go 静态二进制,vsock listener + exec/readFile/writeFile/listFiles/health ~10 个方法)。
- claude binary **不进镜像**,由宿主推送(§3.2 版本锁定)。
- 产物:macOS = 内核 Image + ext4 稀疏盘(arm64/x64 各一);Windows = 同一 rootfs 打成 tar(`wsl --import` 用)。一条 CI 流水线三产物。
- 体积估算:rootfs 解压 ~400–600MB,zstd 压缩分发 ~150–250MB;claude binary 增量 ~250MB(压缩 ~100MB)。**分发策略:安装包不带,首次启用 cowork 时下载,聊天空闲时后台预热(Cowork 同款)。**

---

## 6. 网络与凭证安全

分两档实施:

**起步档(Phase 1–2):**
- 凭证:managed/用户 provider 的 key 经 exec 请求的 env 注入 guest 进程,**不写 VM 磁盘**(复用现有"env 过河"纪律);
- 网络:NAT 出网 + guest 内 nftables 白名单(anthropic/中转端点、registry.npmjs.org、pypi.org、github.com),DNS 固定;
- 注意本项目 managed 服务商是自有中转端点,白名单以 settings 下发的 base_url 动态生成。

**目标档(Phase 3,Cowork 模型):**
- 宿主侧起代理(vsock/回环),guest 内 `ANTHROPIC_BASE_URL` 指向代理,**API token 由宿主代理注入,永不进 VM**——即使 agent 被 prompt injection 完全劫持也偷不到 key(本项目 usage-meter 已有"主进程代理零 token 暴露"先例,同构扩展);
- guest 断直连出网,一切流量过宿主代理 + 白名单(Cowork 的 socat 桥 + allowlist 模式);
- 下载文件的凭证扫描(Cowork 有 credential_classifier)列为可选增强。

---

## 7. 生命周期与资源

| 项 | 设计 |
|---|---|
| 启动 | 懒启动:首个 cowork 会话触发,vfkit 1–3s / WSL 1–10s,配 UI "沙箱启动中"态 |
| 常驻/回收 | 空闲 N 分钟自动关机(vfkit stop / wsl --terminate);macOS 参考 ovm 的睡眠暂停-唤醒恢复 |
| 配额 | 2GB 内存(virtio-balloon 可回收)/ 2–4 vCPU / 数据盘稀疏上限 8GB;`.wslconfig` 不动,WSL 侧靠 distro 内 cgroup 限 |
| 会话清理 | 会话删除 → daemon 删 `/sessions/<id>`;"重置沙箱" = 删数据盘重建(秒级,镜像只读层不动) |
| 升级 | 镜像带版本号,新版本差量下载;claude binary 随宿主 SDK 升级重推 |
| 崩溃恢复 | daemon 心跳(health RPC);VM 失联 → 会话报错 + 一键重建;serial log 汇入现有主进程文件日志体系 |

---

## 8. 分阶段实施建议

| 阶段 | 内容 | 验收 | 预估 |
|---|---|---|---|
| **P0 POC**(先做,风险前置) | mac 上手动 vfkit 拉 Debian VM + 推 claude linux binary + 手写转发器,宿主 SDK `pathToClaudeCodeExecutable` 指向它,**打通一条完整消息流**(含工具调用读写 VM 文件);Windows 上 `wsl --import` 复刻同一验证 | stream-json 经 vsock/wsl.exe 透传无损;abort/中断可用 | 3–5 天 |
| **P1 macOS MVP** | VM manager(electron main,IPC 面向 next-server)+ 镜像 CI + 下载/预热 + 转发桥产品化 + cowork 会话类型(DB 列/UI 开关)+ 上传进 VM + 产物卡片下载 + i18n | 全流程:发文件 → agent 改 → 下载;真机零写入(用 fs 监控验证) | 2–3 周 |
| **P2 Windows** | WSL2 部署向导(检测→一次管理员启用→重启引导→import)+ 降级探测与禁用文案 + `\\wsl$`/wsl.exe 通道 | Home 版 + Pro 版实机通过;GPO/BIOS 场景走禁用分支 | 1.5–2 周 |
| **P3 安全强化** | 宿主代理(token 不进 VM)+ 出网白名单 + 每会话非特权用户/bwrap + 下载防护 + 审计日志 | 注入攻击演练:agent 内拿不到 key、出不了白名单、读不到其他会话 | 1.5–2 周 |
| **P4 体验** | 后台预热、快照复位、并发会话、产物预览(复用现有文档预览体系)、guest 内工具链按需安装 | — | 持续 |

**先决条件**:P0 通过前不动主代码;P0 若发现 SDK 转发不可行(概率低,Cowork 已生产验证同款拓扑),回退方案 B(guest daemon 全权模式,工作量 ×2.5)。

---

## 9. 风险登记册

| # | 风险 | 等级 | 缓解 |
|---|---|---|---|
| 1 | SDK↔CLI 协议随版本演进,转发桥在某次升级后断裂 | 中 | 版本锁定(binary 由宿主按 SDK 版本推送);升级流程加 cowork E2E 冒烟;方案 B 兜底 |
| 2 | Windows 用户 BIOS 虚拟化未开 / GPO 禁 WSL,cowork 不可用 | 中(比例未知) | 降级 = 明确禁用 + 引导,不做弱沙箱冒充;上线后埋点统计不可用率再决策是否投入 QEMU 备路 |
| 3 | WSL2 非 airtight(root 可 remount 宿主盘) | 中 | agent 无 root + automount/interop 全关 + bwrap;产品文案诚实标注;高保证需求转 QEMU+WHPX 再评估 |
| 4 | 镜像 + binary 下载体积(~350MB 级)在弱网/离线环境体验差 | 中 | 后台预热 + 断点续传 + npmmirror 式国内镜像(项目已有 HK 网络经验);企业可配内网镜像源 |
| 5 | macOS 12.0–12.4 / Intel 老机型 VZ 特性差异 | 低 | 下限定 12.5;Intel 钉 LTS 内核 + 实机回归;Intel 线本身在贬值曲线上 |
| 6 | 外部 stdio MCP / 部分 skills 在 VM 内不可用,功能面裁剪引发用户困惑 | 低 | UI 明示 cowork 会话的能力边界;SSE/HTTP MCP 与内置 MCP 不受影响 |
| 7 | 杀软对 NSIS 里新增 helper/转发器误报 | 低 | 全部随主应用签名;WSL 路线不含 QEMU 类高敏二进制 |
| 8 | GPL 义务(镜像含 Linux 内核) | 低 | 常规义务:随包附 license + 源码 offer(所有捆绑 Linux 镜像的产品同款流程),法务过一次 |

---

## 10. 与需求原文的逐条对照

| 需求 | 方案落点 |
|---|---|
| 底层仍走 Claude Code SDK | 宿主 SDK 原封不动,仅 spawn 目标改为转发桥(§3) |
| 不能直读直改用户本地文件 | CLI 进程在 VM 内,cwd/文件工具只见 guest 文件系统;无任何真机目录挂载(§3、§4) |
| 应用安装时部署 VM | 修正为"首次启用时下载镜像 + 后台预热"(Cowork 同款;安装包直接带会 +350MB 且多数用户可能不用此模式);"安装即备好"可作为设置里的可选预下载开关 |
| 文件经对话框发送 → 自动放进 VM | 复用现有上传链路,落点改为 daemon writeFile → `/sessions/<id>/uploads/`(§4.2) |
| agent 在 VM 内读改建 | guest 内 claude binary + workspace 目录(§3、§4.1) |
| 完成后拷出下载 | 产物 diff 卡片 + readFile 流式导出,用户主动"另存为"(§4.3) |
| 全程不动真机 | 唯一例外是用户主动的下载动作与应用自身数据目录(消息预览暂存);agent 无任何真机写入路径,P1 验收用 fs 监控证明 |

---

## 附录:来源索引

**官方**:Cowork 架构 support.claude.com/en/articles/14479288 · 隔离工程博客 anthropic.com/engineering/how-we-contain-claude · Agent SDK 文档 code.claude.com/docs/en/agent-sdk/overview · 沙箱环境 code.claude.com/docs/en/sandbox-environments · WSL 官方文档 learn.microsoft.com/windows/wsl(install / build-custom-distro / wsl-config / enterprise / intune)· Apple Virtualization developer.apple.com/documentation/virtualization

**逆向/工程分析**:simonwillison.net/2026/Jan/12/claude-cowork · pvieito.com/2026/01/inside-claude-cowork · aaddrick.com(claude-swift RPC/镜像拆解)· pluto.security(安全栈)· github.com/patrickjaja/claude-cowork-service(22 RPC 协议复刻)· SiliconANGLE/gbhackers(Windows 逃逸链与 Anthropic 回应)

**组件**:github.com/crc-org/vfkit · github.com/Code-Hex/vz · github.com/oomol-lab/ovm(Electron+vfkit 同构先例)· github.com/apple/container(未来项)· github.com/superradcompany/microsandbox(microVM AI 沙箱同题)· WSL issues #5363/#10381/#12443 · Cowork Home 版 issue anthropics/claude-code#27906/#59035 · openai.com/index/building-codex-windows-sandbox(非 VM 对照组)· devblogs.microsoft.com(WSL Containers 预览)
