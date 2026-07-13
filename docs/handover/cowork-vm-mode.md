# Cowork 沙箱模式(本地 VM 隔离 agent)— 技术交接文档

> 产品思考见 [docs/insights/cowork-vm-mode.md](../insights/cowork-vm-mode.md)(P1-E 待补)
> 调研与 P0 结论:[docs/research/cowork-local-vm-mode.md](../research/cowork-local-vm-mode.md)
> 执行计划(进度/决策日志):[docs/exec-plans/active/cowork-vm-mode.md](../exec-plans/active/cowork-vm-mode.md)
> POC 脚手架说明:[scripts/poc/cowork/README.md](../../scripts/poc/cowork/README.md)
>
> **本文件目标:让接手者读完即可完整理解 cowork 沙箱、并立刻接上未完成的工作,无遗漏。**
> 最后更新:2026-07-13 · 分支 `vm_cowork` · 版本 3.1.9 · 状态:P0 + P1-A/A+/B/C/D 完成,P1-E 待做。

---

## 0. 这是什么 / 为什么

参考 Anthropic 官方 Claude Cowork,给本应用加一种**沙箱会话**:底层仍是 Claude Agent SDK,但 agent 的文件工具(Read/Write/Bash…)**只作用于一台本地 Linux 虚拟机内**,碰不到用户真机文件。用户通过对话框发文件 → 自动进 VM → agent 在 VM 内读改建 → 产物卡片下载回真机。全程真机零写入(除应用数据目录暂存 + 用户主动下载)。

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
2. `decideCowork` → `ensureRunning()`:VM 没起就 spawn vfkit + provision daemon(阻塞到就绪,期间发 `vm_status` SSE)。
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
| `src/lib/cowork-vm-manager.ts` | VM 生命周期**单例**(挂 globalThis 抗 hot-reload)。`ensureRunning()`(懒启动/复用/崩溃重建,幂等+并发安全 startingPromise)、`getStatus()`、`markSessionActive/releaseSession`(空闲回收计数)、`stop()`、`onVmProgress()`(P1-D 进度发射器)、`parseLeaseIp()`(纯函数,单测覆盖)。健康探测走 vsock。 |
| `src/lib/cowork-vsock.ts` | 宿主侧 vsock RPC 客户端。连 vfkit 的 unix socket,发 JSON header + body。导出 `vsockHealthy` / `rpcMkdirWorkspace` / `rpcWriteFile` / `rpcListFiles` / `rpcRemoveSession` / `rpcReadFileStream` / `rpcArchiveStream`。`readJsonHeader` 处理 close/超时(见 §9 bug①)。 |
| `src/lib/cowork-transfer.ts` | 文件通道**对外契约层**(claude-client / artifacts route 依赖这些签名):`sessionWorkspace` / `vmChannelReady` / `ensureSessionWorkspace` / `pushFileToVm` / `listNewFiles` / `assertPathInWorkspace`(host 侧廉价早拒)/ `readFileStream` / `archiveStream` / `removeSessionDir`。内部全部委托给 cowork-vsock。 |
| `src/app/api/cowork/artifacts/route.ts` | 产物 API。`?list=1`(读库,VM 休眠也可用,懒迁移)、`?path=`(下载单文件,VM 离线时 ensureRunning 唤醒)、`?archive=1`(打包)。错误统一脱敏(403/404/500,不回显内部路径)。 |
| `src/components/chat/SandboxToggle.tsx` | 输入框「完全访问」右侧的沙箱开关。PATCH `sandbox_enabled`;切换连带清 `sdk_session_id`。 |
| `src/components/chat/VmArtifactsCard.tsx` | 产物卡片(输入框上方)。文件列表 + 单文件/打包下载。下载走受控 fetch:VM 休眠时点下载显示 spinner(自动唤醒)。休眠时显示"沙箱休眠中"徽标。 |
| `src/components/chat/VmProvisioningBanner.tsx` | P1-D 冷启动横幅。`vm_status` 的 starting/booting/provisioning 显示"沙箱准备中",ready 清除,failed 显示重试。 |
| `src/hooks/useSSEStream.ts` | 加了 `onVmArtifacts` / `onVmStatus` 回调 + `vm_artifacts` / `vm_status` case。 |
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
- **启动**:沙箱首条消息触发 → spawn vfkit(带 vsock 设备)→ 轮询 DHCP 租约(`parseLeaseIp` 按 hostname `cowork-poc` 反查,**不能按 MAC**——vmnet 的 hw_address 是 client-id 格式)+ SSH 就绪 → provision(推 claude binary + 推/启 daemon)。
- **健康**:每 20s vsock health,双探失败 → crashed(下条消息 ensureRunning 自动重建)。
- **空闲回收**:活跃会话计数(markSessionActive/releaseSession)归零 15 分钟 → stop。
- **退出清理**:process exit/SIGTERM/SIGINT 关掉本进程起的 VM(不留孤儿);spawn 前 reap 无法连通的 pidfile 孤儿。
- **进度**:`onVmProgress` 模块级发射器(挂 globalThis),在 starting/booting/provisioning/ready/failed 各点 emit,claude-client 订阅转 `vm_status` SSE。

---

## 4. vsock 通道协议(P1-C 核心,踩坑最多)

**vfkit 配置**:`--device virtio-vsock,port=1024,socketURL=<POC>/vsock-1024.sock,connect`。`connect` 模式 = guest daemon 当 server、宿主连 unix socket。**vfkit 是透明字节代理:无 Firecracker 式 `CONNECT` 握手、无魔数**,连上即裸流,应用层协议自定。(网上说的 "VFKT 魔数" 是 gvproxy 网络栈的东西,与 vsock 无关。)

**daemon 协议**(每连接首行 JSON header `\n` 结尾):
```
{"op":"health"}                                  -> {"ok":true}\n
{"op":"mkdirWorkspace","sessionId"}              -> {"ok":true,"path"}\n
{"op":"writeFile","sessionId","name","size":N}   -> 读 N 字节 -> {"ok":true,"path"}\n
{"op":"listFiles","sessionId","since":ms}        -> {"ok":true,"files":[{path,name,size,mtime}]}\n
{"op":"readFile","sessionId","path"}             -> {"ok":true,"size":N}\n + N 字节
{"op":"archive","sessionId"}                     -> {"ok":true,"size":N}\n + N 字节(tar.gz)
{"op":"removeSession","sessionId"}               -> {"ok":true}\n
{"op":"exec","sessionId","argv":[],"env":{}}     -> 见下
错误 -> {"ok":false,"error":"..."}\n
```

**exec 通道(关键)**:spawn claude 后双向管道。**stdin 方向做 `[uint32 BE 长度][字节]` 帧封装 + 长度 0 的 EOF 标记;stdout 方向裸流。** 为什么:vfkit 不可靠传播 TCP 半关闭(host `sock.end()` 的 FIN 到不了 guest),不能靠 recv 返回空判定 stdin 结束。SDK 单轮结束关 forwarder stdin → forwarder 发长度 0 帧 → daemon 关 claude stdin → claude 退出 → SDK 迭代器结束 → `done`。连接被非正常断(abort)→ 帧读到中途 EOF → daemon 杀 claude。**这是修卡死 bug 的核心机制,改这块务必理解(§9 bug②③)。**

**安全**:sessionId 强制 hex 校验;readFile 经 daemon 内 `realpath` + workspace 前缀判定防逃逸(权威校验在 guest 侧,文件真身在那);host 侧另有廉价 `..` 早拒。

---

## 5. 数据模型 / 接线点

- **DB**(`chat_sessions`):`sandbox_enabled` INTEGER 0/1;`vm_artifacts_json` TEXT(JSON `VmArtifactFile[]`,回合末 merge 落库,历史会话 VM 休眠也能显示产物)。
- **SSE 事件**:`vm_artifacts`(回合产物)、`vm_status`(冷启动进度:phase = starting/booting/provisioning/ready/failed)。
- **设置键**:`cowork_enabled`(全局门,必须 `'true'` 才生效)、`cowork_forwarder_path`(转发器绝对路径;当前值仍指向旧 `forwarder-ssh.sh`,但 `forwarderPath()` 会从同目录解析出 `forwarder-vsock.sh`,所以无需改)。
- **env 过河**(claude-client 注入 queryOptions.env,forwarder 白名单透传):`COWORK_SESSION_ID`、`COWORK_VSOCK_PATH`、`COWORK_NODE_BIN`(= `process.execPath`)、`ELECTRON_RUN_AS_NODE=1`。
- **凭证**:managed provider key 经 provider-resolver 注入 SDK env,不落 VM 磁盘(沿用现有"env 过河"纪律)。

---

## 6. POC 资产布局(`~/.codepilot/cowork-poc/`,不进 git,不随包)

```
images/debian-12-genericcloud-arm64.raw   # Debian 云镜像(中科大源,3GB raw)
images/seed.iso                            # cloud-init NoCloud seed(注入 agent 用户 + SSH 公钥)
seed/                                      # seed 源文件
ssh/id_ed25519{,.pub}                      # POC 专用 SSH 密钥(仅 provisioning 用)
bin/package/claude                         # 官方 linux-arm64 claude binary(~250MB,provision 时 scp 进 VM)
efi-variable-store                         # vfkit EFI 变量
vfkit.pid / vm-ip / vm-console.log         # 运行时状态
vsock-1024.sock                            # vfkit 暴露的 vsock unix socket(VM 跑时存在)
```
镜像/binary 是**手动预置**的(P1 不做下载流水线)。新机器要跑得先复刻这个目录 —— 见 scripts/poc/cowork/README.md。

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

### 未完成 —— P1-E(入口正式化),下一步就是它
详见执行计划,四块:
1. **能力边界透明化(必须,含真实缺口)**:沙箱会话里外部 stdio MCP 现在被原样传进 VM,但 VM 里没 npx/uvx → 静默失败。要**显式禁用 + 提示**(内置 codepilot-* MCP、SSE/HTTP MCP 不受影响)。加轻量能力说明。
2. **入口正式化(部分可选)**:会话列表沙箱盾牌标识、空态"沙箱对话"入口卡、设置里的 `cowork_enabled` 正式开关(现在是手动写 DB)。**待拍板:入口模型 —— 会话内可切换开关 vs 新建时定死。**
3. **真机零写入验收(必须)**:用 macOS `fs_usage`/文件监控在一次完整沙箱回合期间证明真机零写入(唯二例外:应用数据目录暂存、用户主动下载落点)。出记录。此前只用"find 搜不到产物"侧面验证,P1-E 要系统调用级正面钉死。
4. **双文档**:本交接文档(已建)+ `docs/insights/cowork-vm-mode.md`(产品思考,待写),互链。

**待拍板的产品决策(P1-E 开工前)**:
- (a) 入口模型:会话内开关(现状)vs 新建时定死沙箱/非沙箱。
- (b) 外部 stdio MCP:直接禁用+提示,还是往镜像装 npx/uvx 支持(后者成本大)。

### 未完成 —— P2/P3(P1 之后)
- **P2 Windows**:WSL2 私有 distro(明确不走 Hyper-V HCS,官方 Cowork 的 Home 版惨案)+ 降级探测。vsock 在 WSL2 上的等价通道要重新调研。
- **P3 安全强化**:宿主代理注入 token(永不进 VM)、出网白名单、每会话非特权用户/bwrap、下载凭证扫描。
- **镜像流水线**(P1 之后):镜像 + daemon 烘进产物、CI 构建、首次下载 + 后台预热(调研文档 §7.1 的下载窗口 + 消息队列,P1 未做因镜像手动预置)。daemon 烘进镜像用 systemd 自启后,SSH 可彻底退役。

---

## 8. 如何运行 / 验证 / 打包(完整命令)

**前置**:node 是 nvm 管理的,Bash 默认 PATH 里没有 → 每条命令前 `export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"`。

**dev 起服务(需要解密密钥才能用 managed 凭证)**:
```bash
# 1. 解封主密钥(打包版 keychain 里的 Safe Storage;脚本在旧 session scratchpad,可复制)
#    unseal.js:app.whenReady 后 safeStorage.decryptString(~/.codepilot/secret.key.enc) 写 hex 到文件
npx electron <unseal.js 路径> /tmp/mk.tmp   # 输出 UNSEAL_OK
# 2. 带密钥起 dev
CLAUDE_GUI_SECRET_KEY=$(cat /tmp/mk.tmp) PORT=3000 npm run dev
```
unseal.js 内容(若丢失可重建):`app.setName('codepilot')` → whenReady → 读 `~/.codepilot/secret.key.enc` → `safeStorage.decryptString` → 校验 64 hex → 写文件。

**手动起/停 VM(dev 调试)**:`bash scripts/poc/cowork/vm-up.sh start|stop`。但**正常路径是让应用自动起**(P1-B):dev 起好后,发沙箱消息即自动 spawn。

**验证沙箱(CDP)**:开沙箱会话(DB `sandbox_enabled=1` + `cowork_enabled='true'`)→ 发消息 → 看 VM 自动起、产物卡片、下载。冷机验 P1-D 横幅要先 `pgrep -f 'vfkit --cpus' | xargs kill -9` 停 VM。**精确数 VM 进程用 `pgrep -f 'vfkit --cpus'`**(别用 `ps|grep vfkit`,会匹配到自己的命令行,曾误判"双 VM")。

**打包(macOS arm64)**:
```bash
npm version 3.1.x --no-git-tag-version   # bump
rm -rf release/ .next/
export ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
npm run electron:build && node scripts/bundle-chromium.mjs && npx electron-builder --mac dmg --arm64 --config electron-builder.yml
# 产物:release/AI Native Lab-3.1.x-arm64.dmg
```
**打包后必做**:`npm rebuild better-sqlite3` —— 打包会把 better-sqlite3 编成 Electron ABI,dev/test 用 node ABI 会崩(见 §9)。

**测试**:`npm run test`(typecheck + 单元,~5s)。当前 1909 passed。

---

## 9. 踩过的坑 / 关键陷阱(改代码前必读)

1. **`readJsonHeader` 挂死(P1-C)**:daemon 未监听时 vfkit accept 宿主连接后**立刻关闭**(裸代理连不到 guest);只处理 data/error 不处理 close → 永久挂起 `ensureDaemon` 首探。修:close/end → reject + 读超时。
2. **daemon `pump_out` 缓冲(P1-C)**:`proc.stdout.read(N)` 阻塞到攒够 N 或进程退出,把 stream-json 小块增量全缓冲住,SDK 等不到 init 响应 → claude 挂死。修:改 `os.read(fd)` 真流式。
3. **exec 流卡在"生成中"(P1-C 卡死 bug)**:vfkit 不传播半关闭 → daemon 收不到 stdin EOF → claude 不退出 → SDK 迭代器不结束 → 无 `done`。修:stdin 方向帧封装 + 长度 0 EOF 标记(§4)。
4. **`buildSnapshot` 白名单漏字段**:stream-session-manager 每次广播前按字段白名单重建 snapshot;新加的 snapshot 字段(vmArtifacts/vmStatus)**必须同步列进 buildSnapshot**,否则被静默丢弃(产物卡片曾因此切走再切回才显示)。
5. **provision `pkill -f cowork-daemon.py` 自杀**:命令行含 python3 路径 → pkill 匹配到自己那条 launch 命令 → 自杀,daemon 起不来。修:bracket trick `[c]owork-daemon.py` + 拆独立 ssh 调用。
6. **better-sqlite3 ABI**:打包 → Electron ABI;dev/test 需 `npm rebuild better-sqlite3` 回 node ABI。每次打包后都要 rebuild 才能继续 dev/test。
7. **forwarder 需要 node 但打包版 Electron 无独立 node**:用 `COWORK_NODE_BIN=process.execPath` + `ELECTRON_RUN_AS_NODE=1`,forwarder.sh 用它跑 .mjs,不依赖 PATH。
8. **SSH 未 100% 退役**:运行时数据流(exec/文件/健康)全 vsock;SSH 仅剩 VM-provision 一次性(推 binary + 推/启 daemon)。生产把 daemon 烘进镜像 systemd 自启后可彻底去 SSH。
9. **decideCowork 是 async**:会阻塞到 VM 就绪(冷启动数秒~数十秒)。沙箱首条消息因此慢是正常的,P1-D 横幅就是给这段做反馈。

---

## 10. 分支 / 提交 / 远程

- 分支 `vm_cowork`(从 `origin/para` 拉),已 push 到 `origin/vm_cowork`。
- 远程:`origin` = CmftAiLabs/LabCodepilot。个人副本 remote 已弃用,勿推。
- 发版纪律:`git push` / `git tag` 必须用户明确指示;commit 可正常进行。
- 每完成一个子阶段的模式:改代码 → typecheck + `npm run test` → dev+CDP 验证 → commit → bump 版本 → 打包给用户实测 → push(用户说了才推)。
