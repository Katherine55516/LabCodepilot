# Cowork 办公模式(本地 VM 隔离 agent)— 技术交接文档

> 产品思考见 [docs/insights/cowork-vm-mode.md](../insights/cowork-vm-mode.md)
> 调研与 P0 结论:[docs/research/cowork-local-vm-mode.md](../research/cowork-local-vm-mode.md)
> 执行计划(进度/决策日志,均已完成):[docs/exec-plans/completed/cowork-vm-mode.md](../exec-plans/completed/cowork-vm-mode.md)(P1 底层)+ [cowork-office-mode.md](../exec-plans/completed/cowork-office-mode.md)(办公模式 E1-E5)
> POC 脚手架说明:[scripts/poc/cowork/README.md](../../scripts/poc/cowork/README.md)
>
> **本文件目标:让接手者读完即可完整理解 cowork 办公模式、并立刻接上未完成的工作,无遗漏。**
> 最后更新:2026-07-15 · 分支 `vm_cowork`(HEAD 以 git log 为准,**已全部推送 origin**)· 版本 **3.1.18** · 状态:**cowork 主线 macOS 侧全部交付**(P0 + P1 + 办公模式 E1-E5 + 镜像流水线 M1-M4 + P3 安全强化全完成)。**P2 Windows/WSL2 已立项待开工。**
>
> **当前节点与下一步(接手先读这段)**:
> 1. **macOS 侧全交付,3.1.18 已打包已推送**。四个执行计划已归档到 completed/:办公模式(cowork-office-mode)、镜像流水线(cowork-image-pipeline)、P3 安全(cowork-p3-security)、P1 底层(cowork-vm-mode)。P3 成果:每会话非特权用户隔离(P3-A)+ 凭证不进 VM(P3-B 宿主代理注入一次性 token,NAT 网关)+ 宿主侧安全审计(P3-C);出网白名单明确不做(用户接受 agent 自由上网)。
> 2. **下一步 = P2 Windows/WSL2,已立项**。**先读**:计划 [docs/exec-plans/active/cowork-p2-windows.md](../exec-plans/active/cowork-p2-windows.md) + 调研 [docs/research/cowork-p2-windows.md](../research/cowork-p2-windows.md)。核心决策:D1 接受"策略级强隔离+诚实文案"先交付(不等 WSLC GA,WSL2 隔离弱于 vfkit,#12443)、D2 全 Win10-11 不设门槛、D3 通道=`wsl.exe -e` stdio 模型(与现 exec 帧封装天然契合,免 admin)。
> 3. **P2 开工卡点(关键)**:W0 通道 POC + W2-W7 实测**必须 Windows 机器**(开发机是 macOS)。**W1 平台后端抽象可在 macOS 做且零回归**(抽 guest-backend 接口 + daemon 加 --stdio 模式)。等用户给 Windows 环境:有 → W1(mac)并行 + W0(Win)验;没有 → 先做完 W1 抽象铺接缝,W0 起等环境。
> 4. **其他待定(用户拍板)**:vm_cowork 合回 main(40+ commit,越拖冲突面越大,建议尽早)、用户手册(docs/user-manual/)补办公模式章节(产品名全称「AI Native Lab - 工作平台」、桥接只讲微信)。
> 5. 注意:`docs/user-manual/`、`image-config-server-verification.md`、`scripts/dev/docker-win-build.sh` 是用户自己的 untracked 文件,**commit 时绝不能用 `git add -A` 扫进去**(踩过一次,当场 amend 移出)。开发机 `~/.codepilot/cowork-assets/images/*.bak` 老盘备份(3GB)确认稳定后可删。

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
| `src/lib/cowork-poc.ts` | `decideCowork(sandboxEnabled)`:三重门(全局 `cowork_enabled` 设置 + 会话 `sandbox_enabled` + `ensureRunning` 就绪)→ 返回是否走沙箱 + 转发器路径。**async**(会等 VM 就绪)。`forwarderPath()` 解析 forwarder-vsock.sh。 |
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
| `src/components/settings/GeneralSection.tsx` + `api/settings/app` | 设置页「办公模式(Cowork 沙箱)」开关(E5):写 `cowork_enabled`,广播 `cowork-status-changed` 双栏即时显隐;镜像未预置显示警示。 |
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
- **设置键**:`cowork_enabled`(全局门,必须 `'true'`;设置页开关 E5 起可视化,写入后广播 `cowork-status-changed`)、`cowork_forwarder_path`(仍指旧 ssh 路径,`forwarderPath()` 同目录解析 vsock 版,无需改)。
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
