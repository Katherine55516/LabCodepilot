# Cowork 沙箱模式 POC

> 方案调研见 [docs/research/cowork-local-vm-mode.md](../../../docs/research/cowork-local-vm-mode.md)
> 首启窗口设计见同文档 §7.1

验证"把 Claude Agent SDK 的 CLI 进程放进本地隔离虚拟机、真机文件零接触"的转发桥拓扑。
**这是开发者自测用的 POC 脚手架,不随应用分发。** 生产形态会把 SSH 换成 vsock + guest-daemon、
把 vfkit 换成签名 helper、把手动脚本换成 electron-main 里的 VM 管理器。

## 前置

- macOS Apple Silicon(本 POC 在 macOS 26 / arm64 验证)
- `brew install vfkit`
- 资产目录 `~/.codepilot/cowork-poc/`(不进仓库):
  - `images/debian-12-genericcloud-arm64.raw` — Debian 13 云镜像(中科大源)
  - `images/seed.iso` — cloud-init NoCloud seed(注入 SSH 公钥 + agent 用户)
  - `ssh/id_ed25519{,.pub}` — POC 专用密钥
  - `bin/package/claude` — 官方 linux-arm64 子包解包出的 binary(`npm pack @anthropic-ai/claude-agent-sdk-linux-arm64@<版本>`)
  - `vm-ip` — vm-up.sh 写入的 guest IP

## 脚本

| 文件 | 作用 |
|---|---|
| `vm-up.sh [start\|stop\|ip\|ssh]` | vfkit 启停 VM(EFI + NAT + seed),按 hostname 反查 DHCP 租约 IP |
| `forwarder-local.mjs` | Step A 转发器:子进程管道透传到**本机** darwin claude(不跨 VM,只验 SDK 对中间层的容忍度) |
| `forwarder-ssh.sh` | Step B 转发器:argv/env 白名单过河,经 SSH 在 **VM 内** 跑 linux claude,stdio 逐字节透传 |
| `sdk-probe.mjs` | 用 SDK query() 打真实消息流,验 init/工具调用/文件落点/宿主隔离/中断 |

`sdk-probe.mjs` 需要真实凭证。POC 期用一个仓库外的 runner 经项目 `resolveProvider`+`toClaudeCodeEnv`
组装 managed env(密钥从打包版进程 env 或 safeStorage 解封取,不落盘)——见方案文档"dev 侧 managed 真实验证方法"。

## 应用内联通(已合入 src/)

- DB:`chat_sessions.sandbox_enabled`(0/1);切换连带清 `sdk_session_id`(执行目标变了,跨界 resume 会失败)
- 开关:`SandboxToggle.tsx`,在输入条「完全访问」右侧;PATCH `/api/chat/sessions/:id { sandbox_enabled }`
- 分支:`cowork-poc.ts` 的 `decideCowork()` 三重门(全局 `cowork_enabled` 设置 + 会话开关 + VM 就绪)→ 满足则给 SDK 设 `pathToClaudeCodeExecutable=forwarder-ssh.sh`
- 全局门:`settings.cowork_enabled='true'` 才生效(POC 默认无此设置 → 开关点了也安全回退宿主)

## 一次完整验证

```bash
brew install vfkit
bash scripts/poc/cowork/vm-up.sh start          # 起 VM,写 vm-ip
IP=$(cat ~/.codepilot/cowork-poc/vm-ip)
scp -i ~/.codepilot/cowork-poc/ssh/id_ed25519 ~/.codepilot/cowork-poc/bin/package/claude agent@$IP:~/bin/claude
ssh -i ~/.codepilot/cowork-poc/ssh/id_ed25519 agent@$IP 'chmod +x ~/bin/claude'
# 应用内:设置 cowork_enabled=true → 会话开沙箱开关 → 发消息 → 观察 VM 内文件、真机无残留
bash scripts/poc/cowork/vm-up.sh stop           # 用完停 VM
```

**注意**:开关开着但 VM 没跑时,当前 POC 会 SSH 失败报错(vmReady 只查 vm-ip 文件存在)。
开发者自测请确保 `vm-up.sh start` 后再开沙箱。生产形态由 VM 管理器保证生命周期。

## 验证结论(2026-07-10)

见方案文档 §"POC 验证结论"。核心:stream-json 经 SSH 跨 VM 边界无损透传,真实 managed 凭证下
init/工具调用/文件读写/中断全通过;应用内开关 → 消息 → 文件落 VM `~/workspace/`、真机全盘搜索无残留。
