# Cowork 远程容器沙箱 — R0 通道 POC

> 调研:[docs/research/cowork-remote-container.md](../../../../docs/research/cowork-remote-container.md)
> 目标:验证"SDK(客户端)→ 转发桥 → 远程 server → 容器内 shim → claude"整条通道,
> 替代本地 VM。R0 只验通道字节语义,不碰凭证注入(R3)/容器编排(R1)/多租户(R4)。

## 架构(一次办公回合的字节流)

```
客户端(Mac/Win)                     远程服务器(R0:UTM 里的 Linux)
  SDK query()
   pathToClaudeCodeExecutable
   = forwarder-remote.mjs ──TCP──▶ cowork-server-poc.mjs
        帧: [u32 len][bytes]          │ 哑字节管道,不解帧
        + 零长度=EOF                   │ docker exec -i <c> python3 shim -- <argv>
        stdout 裸流 ◀─────────────────┤        │
                                       │   容器 cowork-poc
                                       │    cowork-shim.py ── 解帧 ─▶ claude(linux)
                                       │      零帧→关 claude stdin      stream-json
                                       │      stdin EOF→杀 claude(自保)
```

**为什么容器内要 shim**:docker exec 的 stdin EOF 只能靠"关连接写侧"表达,moby 官方自认
该流协议 fundamentally flawed;零长度帧是应用层带内 EOF 信号(与 K8s 1.31 exec v5 子协议
同构),穿过 TCP/docker exec 所有中间层可靠传播。shim = cowork-daemon.py `op_exec` 的容器版
最小子集。

## 文件

| 文件 | 跑在哪 | 职责 |
|---|---|---|
| `forwarder-remote.mjs` | 客户端 | SDK 当 claude spawn;连 server TCP、发 header、stdin 帧封装、stdout 裸流。**与 forwarder-vsock.mjs 只差连接方式** |
| `cowork-server-poc.mjs` | 远程服务器 | TCP ↔ `docker exec` 哑管道;连接断→关 exec stdin(让 shim 自保) |
| `cowork-shim.py` | 容器内 | 解帧喂 claude stdin;零帧优雅 EOF;stdin EOF abort 自保 |
| `fake-claude.mjs` | 本机自测 | 模拟 claude 的 stream-json stdio,不需凭证 |
| `selftest-local.mjs` | 本机自测 | 不依赖 docker,验帧/EOF/流式/并发/中断 |

## 本机协议自测(已通过,可复现)

```bash
export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"
cd scripts/poc/cowork/remote
node selftest-local.mjs
# 期望:T1/T2/T3 全 PASS(基本+流式+优雅EOF / 并发不串 / 中断无孤儿)
```

这一步把协议层钉死;唯一没覆盖的是 `docker exec` 那一格 —— 下面在 UTM 里补。

## UTM 真实验证(等 Linux 虚机就绪后)

**架构注意**:UTM 在 Apple Silicon 上默认起 **arm64** Linux → 容器用 **linux-arm64** 的 claude
(= 本机已下好的 `~/.codepilot/cowork-assets/bin/package/claude`,直接传进 UTM,不用重下)。
真服务器是 **x64** → 换 linux-x64 那份(服务端按需从 npmmirror 下,复用 M2 下载器,R1 做)。

### 1. UTM 里装 docker + 起长期容器

```bash
curl -fsSL https://get.docker.com | sh          # Debian/Ubuntu 通用
ls /dev/kvm && echo "有 KVM" || echo "无 KVM → 硬化 runc(符合预期)"
sudo docker run -d --name cowork-poc \
  --cap-drop ALL --security-opt no-new-privileges \
  --read-only --tmpfs /tmp --memory 2g --pids-limit 512 \
  -v cowork-poc-ws:/workspace \
  debian:12-slim sleep infinity
sudo docker exec cowork-poc sh -c 'command -v python3 || (apt-get update && apt-get install -y python3)'
sudo docker exec cowork-poc mkdir -p /opt/cowork
```

### 2. 放 shim + claude 二进制进容器

```bash
# shim(从本仓库传到 UTM)
sudo docker cp cowork-shim.py cowork-poc:/opt/cowork/cowork-shim.py
# claude(arm64;从 Mac scp 到 UTM 再 cp)
sudo docker cp claude cowork-poc:/opt/cowork/claude
sudo docker exec cowork-poc chmod +x /opt/cowork/claude
# 冒烟:容器里 claude 能起吗(Bun 二进制 × 硬化 runc)
sudo docker exec cowork-poc /opt/cowork/claude --version
```

### 3. UTM 里起 server(去掉 LOCAL,走真 docker)

```bash
export PATH=...node...   # UTM 里的 node
COWORK_REMOTE_PORT=8790 COWORK_POC_CONTAINER=cowork-poc \
  COWORK_SHIM_PATH=/opt/cowork/cowork-shim.py \
  node cowork-server-poc.mjs
```

### 4. 从 Mac 连 UTM 跑一轮真 claude(凭证经 env 过河,POC 简化;R3 换一次性 token)

```bash
# 先记下 UTM 的 IP(UTM 网络设为 Bridged 或共享)
printf '%s\n' '{"type":"user","message":{"role":"user","content":"reply OK"}}' | \
COWORK_REMOTE_HOST=<UTM_IP> COWORK_REMOTE_PORT=8790 COWORK_SESSION_ID=t1 \
ANTHROPIC_API_KEY=<key> ANTHROPIC_BASE_URL=<url> \
  node forwarder-remote.mjs --print --input-format stream-json --output-format stream-json --verbose
# 期望:收到 claude 真实 stream-json 输出(init → assistant → result)
```

## R0 验收点(在真 docker 下补齐本机没覆盖的)

- [x] 帧编解码 / 零帧优雅 EOF / stdin-EOF abort 自保 / 流式 / 并发(本机 selftest 已过)
- [ ] claude linux 二进制在硬化 runc 容器内跑通 `--version`(Bun × runc 兼容性冒烟)
- [ ] 经通道跑通一轮真 stream-json(EOF/中断在**真 docker exec** 下的语义)
- [ ] `docker exec` CLI 被 kill 后容器内进程不成孤儿(shim stdin-EOF 自保是否在真 docker 下生效)
- [ ] 并发两会话各自独立容器(R1 起才每会话一容器;R0 先单容器多 exec 验通道)

通过后进 R1(guest-backend 接口两用 + cowork-server 控制面 + 容器 per 会话编排)。
