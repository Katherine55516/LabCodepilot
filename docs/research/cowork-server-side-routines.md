# 定时任务跑在沙箱服务器上 —— cowork-server 实现读解与方案设计

> 调研时间：2026-08-04
> 前置：[cowork-scheduled-routines.md](cowork-scheduled-routines.md)（对标 Claude Routines 的能力清单与三方案对比）
> **决策已定**：走该文 §3 的**方案 B（服务端调度）** —— 定时任务在沙箱服务器上跑，不依赖用户电脑
> 底座文档：[handover/cowork-vm-mode.md](../handover/cowork-vm-mode.md) · [research/cowork-remote-container.md](cowork-remote-container.md)

---

## 0. 结论速览

读完 `apps/cowork-server/` 全部 1874 行后的判断：

**这套实现对定时任务的适配度出乎意料地高。** 容器编排、多用户隔离、配额、出网管控、文件通道、凭证代理、审计——定时任务需要的基础设施**全部现成**。会话容器里本来就躺着一个真的 `claude` 二进制，服务端本来就在 `docker exec` 它。所以"服务端自己跑一个 agent 回合"不是新造轮子，是**换一种方式调用已有的轮子**。

**五个断点，只有一个是真的贵：**

| # | 断点 | 成本 | 说明 |
|---|---|---|---|
| ① | **凭证**：真 key 只在客户端本地加密库里，服务端拿不到 | 🔴 高 | 唯一需要动账号后端的地方。但注入点零改动（见 §3.1） |
| ② | 执行方式：现有 exec 是"给 SDK 当管道"，定时任务要"自己起一轮" | 🟢 低 | `claude -p` + 复用 shim，改动约 40 行 |
| ③ | 状态持久化：cowork-server 现在是**完全无状态**的 | 🟡 中 | 加一个文件型 store，不引新依赖 |
| ④ | **TTL 会把跑到一半的定时任务容器回收掉** | 🟢 低 | 但不修就是线上事故（见 §3.4） |
| ⑤ | 结果回传：run 产生在服务端，展示面在客户端 SQLite | 🟡 中 | 拉取 + 本地物化 |

**一句话方案**：给 cowork-server 加一个 `routines` 模块（REST + 调度循环 + 执行器 + 文件型 store），routine 自己持有一个 sid（= 一个容器 + 一个持久 volume），到点由服务端 `docker exec` 跑 `claude -p`，transcript 落盘，客户端上线后拉回来物化成会话。

---

## 1. cowork-server 实现读解

### 1.1 全貌

```
apps/cowork-server/                     1874 行，运行时依赖只有 ws 一个
├── index.mjs              255   HTTP + WS 单入口，路由/鉴权/空闲回收
├── lib/
│   ├── orchestrator.mjs   240   容器 per 会话编排（docker labels 作事实源）
│   ├── files.mjs          201   文件通道四 op（短命 helper 容器直读 volume）
│   ├── cred-proxy.mjs     127   凭证代理编排 + 经 stdin 注入
│   ├── authz.mjs           69   HMAC token 验签取 uid，无状态
│   ├── exec-bridge.mjs     53   WS ↔ docker exec 帧桥
│   └── audit.mjs           33   append-only JSONL 审计
├── container/
│   ├── cowork-shim.py     166   容器内解帧器 + 预制 skill 软链
│   └── cred-proxy.py      154   sidecar：校验 cwk_ token → 注入真 key → 转发
├── client/forwarder-remote.mjs 61  客户端侧：SDK 以为它是 claude
└── image/Dockerfile             自建镜像：claude + shim + cred-proxy + 5 个办公 skill
```

### 1.2 三个值得记住的设计决策

**① 控制面无状态，docker labels 就是数据库。**
`orchestrator.mjs:114` `sessionOwner()` 从容器 label `cowork.uid` 读属主，回退 volume label。`listSessions()`（`:203`）扫**容器 ∪ volume**——容器可以被 TTL 回收，volume 还在就代表会话还在。server 重启后从 labels 完整重建认知，**进程内 Map 只是缓存**。

这个设计很干净，但**定时任务是第一个真正需要持久状态的功能**（prompt 文本、cron 表达式、运行历史都塞不进 label）。这是 §3.3 要处理的。

**② 鉴权无状态：HMAC token 自带 uid。**
`authz.mjs:34` `signToken(uid)` = `base64url({uid,exp}) + "." + HMAC_SHA256`。server 只有一个 `COWORK_AUTH_SECRET`，验签取 uid，**不存用户表**。账号后端用同一密钥签发。所有 op 按 `cowork.uid` label scope，跨用户访问返回 **404 而非 403**（防枚举，`index.mjs:141`）。

→ 定时任务**完全复用**：客户端创建 routine 时带着自己的 Bearer token，uid 从签名里来，无需任何新鉴权。

**③ 凭证三层隔离（RD6）。**
```
客户端 ──真key──> cowork-server ──docker exec stdin──> cred-proxy 容器 tmpfs /creds/<token>.json
                       │                                        ↑
                       └──返回 cwk_xxx token──> 会话容器 ────HTTP──┘
                                              ANTHROPIC_BASE_URL=http://cowork-proxy:8791
```
真 key **不落宿主盘**（走 docker exec stdin，`cred-proxy.mjs:107`）、**不进会话容器**、**不进 argv**（避免进程表泄漏）。会话容器只见一次性 `cwk_` token。

**`cred-proxy.mjs:17-19` 的注释已经把定时任务需要的路径写好了：**

> credSource 预留(RD4)：registerCredentials 是唯一登记入口。方案 A 由 REST 路由（客户端 TLS 交 key）喂；**将来切方案 C（服务端向账号后端直取）时，服务端自己拉取后喂同一入口，proxy 容器/会话容器侧零改动。**

这是本次调研最省事的一条发现 —— 断点①的注入点早就留好了。

### 1.3 一次 exec 回合现在是怎么走的

```
SDK query()
 └ pathToClaudeCodeExecutable = forwarder-remote.mjs        ← SDK 以为这是 claude
    └ WS ws(s)://server/session/<sid>/exec  (Bearer token)
       ├ 首个 text message = {argv, env}                    ← env 白名单 ANTHROPIC_*/CLAUDE_*/COWORK_*
       └ 后续 binary = [u32 BE len][bytes] 帧流，零长 = EOF
          └ index.mjs:211 ensureContainer(sid, uid)         ← 归属校验在这里
             └ exec-bridge.mjs:31
                docker exec -i -e... <容器> python3 cowork-shim.py -- <claude argv>
                   └ shim 解帧 → 喂 claude stdin
                      claude stdout 裸流 → shim stdout → WS binary → forwarder → SDK
```

**关键点：agent loop 在客户端**（SDK 在 Next server 里跑），服务端只是一根**哑管道**。这正是定时任务必须改的地方——服务端要能自己发起一轮，不能等客户端。

### 1.4 shim 里那个容易被忽略的职责

`cowork-shim.py:29` `link_preinstalled_skills()`：把镜像里 `/opt/cowork-skills/` 的 5 个办公 skill（docx / xlsx / pptx / pdf / office-cn）**逐个软链**进 `~/.claude/skills/`。

为什么必须每次启动做：HOME 是 orchestrator 挂的 **tmpfs**（`orchestrator.mjs:166`），容器每次创建都是空的，镜像里写死没用。

**⚠️ 这意味着"绕开 shim 直接 `docker exec claude`"会静默丢失全部办公 skill。** 定时任务恰恰最需要这些（"每天生成 xlsx 报表"）。所以执行器**必须走 shim**，见 §3.2。

### 1.5 空闲回收的续命逻辑

`index.mjs:62-71` + `:236-248`：
- `lastActive: Map<sid, ms>` —— **只有 WS exec 打开/关闭时更新**（`execOpened`/`execClosed`），文件 op 不算活跃
- `activeExec: Map<sid, count>` —— 有活跃连接的会话**绝不回收**
- reaper 每 60s 扫 `listRunning()`，超 `IDLE_TTL_MS`（默认 30min）且无活跃连接 → `docker stop`（保留 volume）
- server 重启后 `lastActive` 为空 → 给一个 TTL 宽限

→ **服务端发起的 exec 不经过 WS，所以完全不在这套续命机制里。** 这是断点④，见 §3.4。

---

## 2. 适配度评估：哪些能直接用

| 定时任务需要 | 现有实现 | 位置 | 状态 |
|---|---|---|---|
| 隔离的执行环境 | 硬化容器（cap-drop ALL / no-new-privileges / 非 root / 2c2g/512pids） | `orchestrator.mjs:152-171` | ✅ 直接用 |
| 持久工作区 | 会话专属 named volume，与容器生命周期解耦 | `orchestrator.mjs:88` | ✅ 直接用 |
| 多用户隔离 | `cowork.uid` label + 跨用户 404 | `orchestrator.mjs:129` | ✅ 直接用 |
| 鉴权 | HMAC token 验签取 uid | `authz.mjs:48` | ✅ 直接用 |
| 凭证不进容器 | cred-proxy sidecar + cwk_ 一次性 token | `cred-proxy.mjs:94` | ✅ 注入点直接用 |
| 产物取回 | 文件通道四 op（helper 容器直读 volume，**会话容器不用醒**） | `files.mjs` | ✅ 直接用 |
| 出网管控 | DOCKER-USER 拒私网四段 | `setup-egress.sh` | ✅ 直接用（但见 R5） |
| 审计 | append-only JSONL，10 类事件 | `audit.mjs` | ✅ 加事件即可 |
| 办公 skill | 镜像预制 + shim 软链 | `Dockerfile:70` | ✅ 走 shim 就有 |
| 开机自启/守护 | systemd `cowork-server` | `deploy/cowork-server.service` | ✅ 直接用 |
| **自主发起一轮 agent** | ❌ 服务端只是哑管道 | — | 🔴 要做 |
| **持久化状态** | ❌ 完全无状态 | — | 🔴 要做 |
| **凭证来源（无客户端）** | ❌ 只有客户端喂 | — | 🔴 要做 |

**九项现成、三项要做。** 这就是为什么服务端调度这条路比它听起来便宜。

---

## 3. 五个断点与解法

### 3.1 断点①：凭证 —— 唯一需要动账号后端的地方

**问题**：真 key（managed provider 的 `ANTHROPIC_AUTH_TOKEN` + `ANTHROPIC_BASE_URL`）来自 `claude-client.ts:974`，它读的是客户端本地 SQLite 里**用 safeStorage 主密钥加密的列**。这个密钥绑定用户机器的钥匙串。**服务端在原理上拿不到。**

**两条路：**

**(a) RD4 方案 C —— 服务端向账号后端直取（推荐）**
```
cowork-server ──service secret──> codeagent-server
  GET /api/v1/internal/cowork/model-credentials?uid=<uid>
  → { realKey, realBase, authStyle }
     └ 喂进现有的 cred.registerCredentials(routineSid, {...})   ← 零改动
```
账号后端**本来就持有**这些 managed 凭证（它就是下发方），这是反向复用同一套体系。契约可以照抄已有的 `docs/cowork-config-api.md`（R5-5 交付的那份）的形状。

**(b) 客户端预存 —— 更便宜但有致命缺陷**
客户端创建 routine 时把凭证存到服务端，之后一直用。
**❌ 不推荐**：凭证存在 cred-proxy 容器的 **tmpfs**（`cred-proxy.mjs:77`）+ server 进程内 `tokenBySession` Map（`:45`），**server 重启或 proxy 容器重建就全没了**。而定时任务的全部意义就是"客户端长期不在也要跑"——凭证恰好在客户端离线最久的时候失效，这是自相矛盾的设计。要修就得给凭证做持久化，那反而比 (a) 更危险（长期落盘的真 key）。

**建议**：走 (a)。这是唯一需要跨仓库协调的一项，应当**最先启动**（账号后端加接口的排期是关键路径）。

**新增安全面**（必须同时做）：
- cowork-server ↔ codeagent-server 用独立的 service secret，与 `COWORK_AUTH_SECRET` **分开**
- 该接口只能内网访问 / IP 白名单
- 取凭证事件进审计（`cred_fetched`，只记 uid，绝不记 key）

### 3.2 断点②：执行方式 —— `claude -p` + 复用 shim

现有 `exec-bridge.mjs` 是为"给 SDK 当管道"设计的：等 WS header、解帧、双向泵。定时任务不需要交互，只需要**跑完一轮、拿到结果**。

**做法**：给 shim 加一个 one-shot 模式，服务端直接 spawn，不经 WS。

```python
# container/cowork-shim.py —— 新增分支
# 用法: python3 cowork-shim.py --oneshot -- <claude argv...>
# 与帧模式的唯一区别:不解帧、stdin 直接关闭(prompt 在 argv 里),
# stdout 原样透传。link_preinstalled_skills() 照常执行 —— 这是必须走 shim 的原因。
```

```js
// lib/routine-runner.mjs（新建）
const args = [
  'exec', '-i',
  '-e', `ANTHROPIC_BASE_URL=${baseUrl}`,           // cred-proxy
  '-e', `ANTHROPIC_AUTH_TOKEN=${cwkToken}`,        // 一次性 token
  containerName, 'python3', SHIM, '--oneshot', '--',
  '-p', prompt,
  '--output-format', 'stream-json', '--verbose',
  '--dangerously-skip-permissions',                // 办公模式本来就是这个模式
  ...(model ? ['--model', model] : []),
];
```

**为什么 `--dangerously-skip-permissions` 是对的**：办公模式的交互回合本来就走 `bypassPermissions`（`claude-client.ts:382`），容器内已经强制非 root（`orchestrator.mjs:158`，正是因为 claude 禁止 root + 该参数）。这同时天然满足了 Claude Routines 的"全自主、无审批"语义。

**必须配套的三个护栏**（交互回合有人盯着，定时任务没有）：
| 护栏 | 值 | 理由 |
|---|---|---|
| 硬超时 | `COWORK_ROUTINE_TIMEOUT_MS`，默认 15min | claude 可能卡住；超时 SIGTERM → 3s 后 SIGKILL |
| 输出上限 | transcript 单次 ≤ 8MB | 防日志盘打爆 |
| 并发上限 | `COWORK_ROUTINE_CONCURRENCY`，默认 4 | 32 核 / 每容器 2 核，见 R6 |

**⚠️ 待 POC 验证**：容器内 claude 2.1.203 的 `-p --output-format stream-json` 具体行为（退出码语义、结果消息形状、是否需要 `--verbose`）**没有实测过**，这是本方案的第一个 POC 项，应在动工前用一条 SSH 命令验掉：
```bash
docker exec -i -u 1000 -e ANTHROPIC_BASE_URL=... -e ANTHROPIC_AUTH_TOKEN=... \
  cowork-<sid> /opt/cowork/claude -p "列出 /workspace 下的文件" \
  --output-format stream-json --verbose --dangerously-skip-permissions
```

### 3.3 断点③：状态持久化 —— 文件型 store，不引依赖

cowork-server 的运行时依赖只有 `ws` 一个，这个克制值得保留。routine 状态用文件型 store：

```
$COWORK_STATE_DIR (默认 /data/cowork-state)     ← 数据盘 1TB，systemd 用户 cowork 可写
└── routines/
    └── <uid>/
        ├── <routineId>.json          # 定义 + 调度状态（原子写:.tmp + rename）
        └── <routineId>.runs.jsonl    # 运行历史（append-only，尾部 N 条即可，软截断同 audit.mjs）
```

**routine 记录：**
```jsonc
{
  "id": "rt_a1b2c3…",              // 也是它的 sid → 容器 cowork-<sid>、volume cowork-ws-<sid>
  "uid": "<账号 UUID>",
  "name": "每日销售日报",
  "description": "汇总昨天的数据出 xlsx",
  "prompt": "…自包含的完整指令…",
  "model": "claude-opus-4-7",       // 可空 = 服务端默认
  "schedule": { "kind": "cron", "expr": "0 9 * * 1-5", "tz": "Asia/Shanghai" },
  //          | { "kind": "once", "fireAt": "2026-08-10T09:00:00+08:00" }
  //          | { "kind": "manual" }
  "enabled": true,
  "nextRunAt": "2026-08-05T09:03:00+08:00",   // 已含 stagger
  "lastRunAt": null,
  "consecutiveErrors": 0,
  "createdAt": "…", "updatedAt": "…"
}
```

**关键决策：routine 的 id 直接当 sid 用。**
`orchestrator.mjs` 的 sid 约束是 `/^[a-f0-9]{1,64}$/`（`:45`），所以 routineId 生成为 32 位 hex 即可。这样一来：
- routine 拥有**自己的容器 + 自己的持久 volume**，与用户的交互会话完全隔离
- 多次运行**共享同一个 workspace**（办公任务通常有状态：昨天的表今天要接着写）
- `ensureContainer` / `removeContainer` / 文件通道 / 归属校验 / reconcile **全部零改动直接可用**
- 两次运行之间容器被 TTL 回收，下次 `docker start` 秒级复用 —— 资源占用只有一个 volume

这同时回答了前一份调研里的决策 D2（每次运行是否新容器）：**一个 routine 一个持久 workspace，每次运行是一条独立 run 记录**。

**⚠️ reconcile 必须排除 routine 会话**：`index.mjs:83` 的 `/reconcile` 收客户端的 `keep` 列表删孤儿。客户端不知道 routine 的 sid，会把它们全当孤儿删掉。解法：routine 的容器/volume 打额外 label `cowork.kind=routine`，`orchestrator.reconcile()` 跳过这类。**不修就是"用户打开 app → 所有定时任务工作区被清空"。**

### 3.4 断点④：TTL 会回收跑到一半的容器

reaper（`index.mjs:236`）只认 WS 连接。服务端发起的 exec 不经 WS ⇒ `activeExec` 为 0、`lastActive` 可能是很久以前（如果这个 sid 之前被交互用过）⇒ **routine 跑到第 30 分钟被 `docker stop`**。

**解法**：把续命机制从"WS 专属"提升为通用的活跃登记。
```js
// index.mjs 现有的 execOpened/execClosed 已经是正确的抽象，
// routine-runner 起 exec 前后调用同一对函数即可 —— 不需要新机制。
execOpened(routineSid);
try { await runOnce(...); } finally { execClosed(routineSid); }
```
一行一行都是现成的，**只是需要有人记得调**。这条属于"不写进文档就一定会踩"的类型。

### 3.5 断点⑤：结果回传与展示

run 发生在服务端，但用户的展示面是客户端 SQLite。

**服务端存**：`<routineId>.runs.jsonl` 每行一条 run 元数据；transcript（stream-json 原文）单独落 `runs/<runId>.jsonl`。

**新增 REST**（沿用现有鉴权与 uid scope）：
```
GET    /routines                    列出本 uid 的 routine
POST   /routines                    创建
PATCH  /routines/:id                改（prompt/schedule/enabled/model）
DELETE /routines/:id                删（连容器 + volume）
POST   /routines/:id/run            立即运行（可带一次性 text）
GET    /routines/:id/runs?since=    运行历史
GET    /runs/:runId/transcript      取 stream-json 原文
```

**客户端物化**：app 启动 + 每 N 分钟拉 `?since=<本地最新>`，把新 run 转成本地 `chat_sessions` + `messages`（transcript 重放），在办公列表里以「定时」分组呈现，并对离线期间的运行发一条汇总通知（"你不在时跑了 3 次，2 成功 1 失败"）。产物走已有文件通道，零新增。

**诚实边界**：run 完成时用户如果没开 app，**当时收不到通知**（bridge 也在客户端）。要做真正的即时推送需要服务端出站通道，是独立议题，不进本期。

---

## 4. 调度循环设计

放在 `lib/routine-scheduler.mjs`，随 `index.mjs` 启动（和 `cred.ensureProxy()` 同级）：

```js
// 60s tick —— 与 reaper 同频，复用 unref() 惯例
const tick = setInterval(async () => {
  for (const r of await store.listDue()) {          // nextRunAt <= now && enabled
    if (running.size >= CONCURRENCY) break;         // 超并发留到下一 tick
    if (await store.dailyCount(r.uid) >= DAILY_CAP) { skip(r, 'daily_cap'); continue; }
    fire(r);                                        // 不 await，队列由 running.size 控
  }
}, 60_000);
tick.unref?.();
```

**每次 fire 的完整链路：**
```
1. store.markRunning(r)                          写 run 记录 status=running
2. cred = await fetchCredentials(r.uid)          ← RD4-C，账号后端
3. {token,baseUrl} = cred.registerCredentials(r.id, cred)   ← 现有函数，零改动
4. orch.ensureContainer(r.id, r.uid)             ← 现有函数（docker start 复用）
5. execOpened(r.id)                              ← 断点④，否则被 TTL 回收
6. runOnce()  docker exec … shim --oneshot … claude -p    超时 15min
7. execClosed(r.id) + transcript 落盘 + store.finish(r, status)
8. cred.revokeCredentials(r.id)                  ← 用完即废，不留长期凭证
9. computeNextRun(r) + audit('routine_fire'|'routine_error')
```

**第 8 步很重要**：跑完立刻废止 token，服务端在两次运行之间**不持有任何有效凭证**。这让"服务端能自主发起 agent"这件事的攻击窗口只存在于运行期间。

**cron 求值与时区**：客户端已有 `getNextCronTime()`（`src/lib/task-scheduler.ts:456`，按天扫 4 年、覆盖闰年）和 `getJitter()`（`:299`，确定性 stagger）。这两个是**纯函数、零依赖**，直接移植到服务端。但服务器时区与用户时区不同，routine 记录必须带 `tz`，求值时按 `tz` 而非服务器本地时区 —— 这是客户端版本不需要、服务端版本必须补的一点。

**补跑**：服务端常驻，理论上不会错过。但 server 重启/宕机期间可能跳过 ⇒ 启动时扫 `nextRunAt` 已过去的，**只补最近一次**（照抄 Claude Desktop 语义），更早的记 `skipped` 并注明原因。

---

## 5. 分期

| 期 | 内容 | 阻塞依赖 | 验收 |
|---|---|---|---|
| **S0** | POC：SSH 到生产，手工 `docker exec` 跑一次 `claude -p --output-format stream-json`，确认输出形状与退出码 | 无 | 拿到一份真实 transcript 样本 |
| **S1** | 账号后端加内部凭证接口（RD4-C）+ service secret | **关键路径，最先启动** | cowork-server 能用 uid 换到可用凭证 |
| **S2** | shim `--oneshot` + `routine-runner.mjs` + 三护栏（超时/输出上限/并发） | S0 | 手工触发一条 routine 跑完，transcript 落盘 |
| **S3** | store + 调度循环 + REST 七个端点 + `cowork.kind=routine` label + reconcile 排除 + `execOpened` 续命 | S2 | 建一条 cron routine，客户端全程关闭，到点自动跑完 |
| **S4** | 客户端：`/api/routines/*` 代理 + 拉取物化 + 办公 tab 定时入口 + 列表/表单/详情/历史 UI | S3 | 打开 app 看到离线期间的运行记录，可点开看全过程 |
| **S5** | 配额（per-uid 日上限）、审计事件、`OPERATIONS.md` 补章、selftest-r5 | S3 | selftest 覆盖：调度触发/超时/并发上限/跨用户 404/凭证用后即废 |

**S1 是关键路径**，建议立刻确认账号后端的接口排期，其余各期可并行准备。

---

## 6. 风险登记册

| # | 风险 | 影响 | 缓解 |
|---|---|---|---|
| R1 | **reconcile 误删 routine 工作区** | 用户打开 app → 定时任务工作区全清空 | `cowork.kind=routine` label + reconcile 跳过。**S3 必做，不可延后** |
| R2 | **TTL 回收跑到一半的容器** | 长任务在第 30 分钟被 stop | 复用 `execOpened/execClosed`（§3.4） |
| R3 | 服务端持有可自主发起 agent 的能力 | 攻击面从"哑管道"升级为"能主动花钱的执行器" | 用后即废凭证 + 硬超时 + 日配额 + `routine_fire` 审计 + 内部接口内网限定 |
| R4 | 并发打满 | 32 核，每容器 2 核，N 用户同点触发 | 并发上限默认 4 + 确定性 stagger + 超出留到下 tick |
| R5 | **出网禁私网** | "每天读内网系统出报表"这类 routine 直接失败 | 现有 DOCKER-USER 规则拒私网四段。需求出现时按 `setup-egress.sh` 尾注定向放行，并重评横移风险 |
| R6 | token 无人看管地烧 | 跑飞的 routine 没人喊停 | 日配额 + 连续失败自动 disable（照抄客户端的 10 次阈值） |
| R7 | 磁盘增长 | transcript + volume 累积 | transcript 软截断（同 `audit.mjs:24` 手法）+ volume 随 routine 删除清理 + 数据盘 1TB 有余量 |
| R8 | 无 KVM，隔离仍是硬化 runc | 与现有会话同等级，不新增风险但也不减 | 维持现状（RD3 已否决 Kata/gVisor-KVM，RD9 userns-remap 已生效） |

---

## 7. 待拍板

1. **凭证走 RD4-C（服务端向账号后端直取）** —— 确认后需要立刻和账号后端对接口。是否现在启动？
2. **routine 独占一个持久 volume**（每次运行共享同一 workspace，有状态累积）—— 确认？还是每次运行要全新环境？
3. **并发上限初值 4、日配额初值**（比如每用户每天 20 次）—— 数值是否合适？
4. **最小调度间隔**：Claude 云端是 1 小时。我们跑自家服务器，建议 **15 分钟**下限（比客户端方案的 5 分钟保守，因为每次都要起容器）。是否认可？
5. **离线期间的通知**：本期只做"打开 app 时汇总呈现"，服务端主动推送（邮件/企业微信）另立议题。认可？

---

## 8. 附：一次定时运行的完整时序（目标态）

```
09:03  routine-scheduler tick
        ├ store.listDue() → rt_a1b2…（cron "0 9 * * 1-5" + stagger 3min）
        ├ 并发 1/4，日配额 3/20 → 放行
        ├ fetchCredentials(uid) ────────> codeagent-server（service secret）
        │                          <──── {realKey, realBase, authStyle}
        ├ registerCredentials(rt_a1b2…) ─ docker exec stdin ─> cred-proxy tmpfs
        │                          <──── {token: cwk_…, baseUrl: http://cowork-proxy:8791}
        ├ ensureContainer(rt_a1b2…, uid)   docker start（volume 里还是昨天的工作区）
        ├ execOpened(rt_a1b2…)             ← 挡住 reaper
        ├ docker exec -i … python3 cowork-shim.py --oneshot -- \
        │     /opt/cowork/claude -p "<prompt>" --output-format stream-json \
        │     --verbose --dangerously-skip-permissions --model …
        │     └ shim 先 link 5 个办公 skill → 起 claude（cwd=/workspace）
        │        └ claude 经 cred-proxy 出网 → 生成 昨日销售日报.xlsx 落 /workspace
        ├ transcript → /data/cowork-state/runs/run_xxx.jsonl
        ├ execClosed + revokeCredentials（服务端不再持有任何有效凭证）
        └ audit('routine_fire') + computeNextRun → 明天 09:03

09:41  reaper: rt_a1b2… 空闲超 TTL → docker stop（volume 保留，明天 start 复用）

14:20  用户打开 app
        └ 拉 /routines/rt_a1b2…/runs?since=… → 物化成本地会话
           → 办公列表「定时」分组出现「每日销售日报」，点开看全过程
           → 产物卡片走已有文件通道下载 xlsx
```
