# 上下文占用直接取自 Claude Code 端 — 可行性调研（POC 已验证）

> 调研日期：2026-07-06 · 环境：Claude Code CLI 2.1.201 / @anthropic-ai/claude-agent-sdk 0.2.141
> 关联：`docs/run-cockpit-context-card-spec.md`（现有卡片口径）、记忆中"Token 用量卡片累计 bug 修复"一轮的结论

## 背景与问题

上下文用量卡片当前的口径是应用内自算：倒序取末条带 usage 的 assistant 消息，`input + cache_read + cache_creation` 做分子（`src/lib/context-usage-walk.ts`），分母靠静态目录 + 托管表 + `[1m]` 后缀判定（`src/lib/model-context.ts`）拼出来。用户反馈"同事对话很多轮占用不到 5%"——经排查分子没错，分母是 1M（`[1m]` 托管模型），但暴露了根本问题：**分母是应用猜的，不是 Claude Code 说的**（托管表里名义 1M 的模型只有 Kimi 做过真实窗口探针，且 Kimi 实测就与名义不符：256K→200K）。

本调研回答：**能否不在应用内重写计算逻辑，直接从 Claude Code 端拿权威的上下文占用？**

## 结论：可以，四条通道全部实测可用

| 通道 | 拿到什么 | 实测延迟 | 成本 | 适用 |
|------|---------|---------|------|------|
| ① SDK `Query.getContextUsage()` | `/context` 同源结构化数据：totalTokens / maxTokens / 分类明细 | 首调 25–45ms，热调 6–10ms | 零 API 调用、零网络 | **主方案**：回合结束推送权威快照 |
| ② `result.modelUsage[model].contextWindow` | CLI 权威的分母（窗口） | 0（已在每回合 result 里） | 0 | **免费顺手修**：替换应用内猜表 |
| ③ 独立探针进程（SDK resume + fork） | 任意历史会话的快照 | spawn→快照 ~280ms–1s | 零 API 调用 | 兜底 / 离线校验 |
| ④ headless `claude -p "/context"` | markdown 格式上下文报告 | 秒级 | 零 API 调用 | 人工诊断（如同事案例对账） |

**当年放弃 `getContextUsage()` 的两条理由在 SDK 0.2.141 上均已不成立**（详见下文 POC 3）。

## 通道 ①：`Query.getContextUsage()`（推荐主方案）

### 返回结构（sdk.d.ts:2596）

`/context` 命令的同源数据，比应用现有 breakdown 细得多：

- `totalTokens / maxTokens / rawMaxTokens / percentage / model` — 分子分母一次给齐，`maxTokens` 就是 CLI 权威窗口；
- `categories[]` — System prompt / System tools / MCP tools / Memory files / Skills / Messages / Autocompact buffer / Free space 等分类 token 数（正好对上卡片 dot-matrix 的 10 类需求，`buildContextUsageBreakdown` 的 `compiler` 入参本来就是为此预留的）；
- `memoryFiles[] / mcpTools[] / agents[] / skills / slashCommands` — 每个 MCP 工具、每个 memory 文件的逐项 token 数。

### POC 实测数据

**POC 1 — 冷启动、不发消息、零 API 调用**（streaming-input 挂起 stdin，init 后直接调）：

```
init: 428ms
getContextUsage#1: 25ms  (spawn→snapshot 453ms)
getContextUsage#2: 6ms
→ {"totalTokens":3482,"maxTokens":1000000,"model":"claude-opus-4-7[1m]",
   "categories":[Skills 3482, Autocompact buffer 33000, Free space 963518]}
```

**POC 2 — resume 真实长会话**（`resume` + `forkSession:true`，同样零 API 调用）：

```
init: 234ms
getContextUsage#1: 45ms  (spawn→snapshot 279ms)
→ {"totalTokens":111931,"maxTokens":1000000,"percentage":11,
   "categories":[Skills 3482, Messages 108449, Autocompact buffer 33000, ...]}
```

**POC 3 — 回合内 result 之后、for-await 循环内直接 await**（当年注释断言会死锁的形态）：

```
result at 2225ms
getContextUsage(post-result): 10ms   ← 循环内 await，未死锁
→ {"totalTokens":2624,"maxTokens":200000,"model":"claude-haiku-4-5-20251001",...}
```

### 两条旧结论的复核

1. **"循环内 await 死锁 / Query closed before response"**（`src/lib/claude-client.ts` result 分支的长注释）：POC 3 直接以该形态调用，10ms 返回。前提差异：POC 用 streaming-input 生成器**保持 stdin 挂起**，result 后 Query 仍存活；string prompt 模式下 result 后 CLI 立即退出，才会出现"closed before response"。**死锁的根因是 Query 生命周期，不是控制通道本身。**
2. **"getContextUsage 实测太慢不可用"**（记忆）：热调 6–10ms、首调 ≤45ms。当年的"慢"大概率就是上述生命周期问题导致的挂死被误判。

### 集成方案（改动集中在 claude-client.ts，前端零改动）

前端链路 **Phase 5 时已全部预留、从未点亮**：

- `useSSEStream.ts:289` — `case 'context_usage'` 事件解析 + `onContextUsage` 回调 ✅
- `stream-session-manager.ts:594` — 快照落入 `snapshot.contextUsageSnapshot` ✅
- `ChatView.tsx:1142` — 透传给卡片 ✅
- `useContextUsage.ts` — `options.snapshot` 优先于 walk 估算（`source:'snapshot'`，60s 新鲜度）✅

后端需要的唯一改动：**把 prompt 统一为 streaming-input 生成器并在回合末保持挂起** → result 到达后 `await query.getContextUsage()`（~10ms）→ enqueue SSE `context_usage` 事件 → 放行生成器结束回合。带图路径本来就走 AsyncIterable（`buildFinalPrompt` 返回 `string | AsyncIterable`），等于把纯文本路径也统一过去。

每回合额外开销 ~10ms + 一次本地 tokenize，无 API 成本。

### 限制与注意

- `totalTokens` 是 CLI 的**本地估算口径**（与 `/context`、auto-compact 触发同源），不是 API 返回的计费 usage；与真实 input tokens 有小偏差，但"对齐它 = 对齐 Claude Code 自身行为"，这正是本调研要的权威口径。
- 快照只在回合结束更新，回合之间（如切模型后未发消息）会 stale——现有 60s 新鲜度 + walk 兜底已覆盖。
- `maxTokens` vs `rawMaxTokens`：CLI 会把 Autocompact buffer（1M 窗口下 33K）单列，卡片可顺带展示"自动压缩缓冲"。
- 待应用内集成后补一项验证：真实成功回合后 categories 是否包含 System prompt / System tools 行（本次 POC 的 Bash 环境子进程无 CLI 登录态，回合报错未压入完整上下文；应用子进程带 provider API key，不受此影响）。

## 通道 ②：`result.modelUsage[model].contextWindow`（免费、建议立即做）

`SDKResultMessage.modelUsage` 每回合都带 `contextWindow`（sdk.d.ts:1123，POC 3 中 haiku 返回 200000）。现状：`extractTokenUsage`（claude-client.ts:180）只取 `msg.usage`，**没提取 modelUsage**；而 walk 侧 `usage.context_window` 字段和读取逻辑早已预留（`context-usage-walk.ts` 的 `sdkContextWindow`、`types/index.ts:386`），写入即生效。

一行级改动就能把分母从"应用内猜表"（`MODEL_CONTEXT_WINDOWS` / `MANAGED_CONTEXT_WINDOW_BY_NAME` / `[1m]` 后缀判定）降级为兜底——托管 1M 模型窗口虚标的风险由权威值直接消解。

## 通道 ③：独立探针进程（兜底 / 校验）

POC 2 的形态独立成工具：turn 之外任意时刻 spawn SDK、`resume` 目标会话、取快照、abort。适合离线对账（如"探针实测所有名义 1M 托管模型的真实窗口"）。

**保真前提**：探针必须传应用真实的 queryOptions（systemPrompt preset / mcpServers / agents / settingSources）。默认 options 下实测只计 Skills + Messages，**不含 system prompt / tools 的 ~15–25K**，直接用会低估。加上每次 spawn ~0.3–1s 成本，不如通道 ① 优雅，不建议做主路径。

## 通道 ④：headless `claude -p "/context"`（人工诊断）

CLI 2.1.201 实测可用，无需登录态、无 API 调用，输出 markdown 报告（Model / Tokens x/y / 分类表 / Agents 表）。配 `--resume <sessionId>` 可直接看任意历史会话。适合写进排查手册：让同事跑一条命令即可与卡片对账。程序化集成则不如通道 ①（要解析 markdown、有 spawn 成本、数据同源无增益）。

## 推荐落地顺序

1. **P0（一行级）**：`extractTokenUsage` 补提取 `modelUsage[connectedModel].contextWindow` → 随 `token_usage.context_window` 落库 → walk 现成消费。分母立即权威化。
2. **P1（本调研主建议）**：claude-client 统一 streaming-input + result 后取 `getContextUsage()` 快照 → 点亮已预留的 SSE `context_usage` 链路。卡片分子分母、分类明细全部换成 Claude Code 权威值，应用内 walk 降级为快照缺失时的兜底。
3. **诊断工序**：`claude -p --resume <id> "/context"` 写入用户/运维排查手册。

## POC 复现

脚本未入库（临时验证件）。复现要点：streaming-input 生成器 `yield` 后以未决 Promise 挂起保持 Query 存活；`initializationResult()` 后即可调 `getContextUsage()`；resume 场景加 `forkSession: true` 避免写原会话。注意 SDK 默认 options 与应用真实 options 的上下文构成差异（见通道 ③）。

## 落地记录（2026-07-06，同日实现）

按用户决策落地了一个变体：**分子（已用）取 Claude Code 权威值，分母（窗口）保留应用侧解析逻辑**（`[1m]` 别名/托管表/目录），即通道 ① 的分子部分 + 刻意不采用其 `maxTokens` 做分母。

实现（`FIX(权威分子)` 注释锚点）：

- `claude-client.ts`：`wrapPromptWithTurnGate()` 把 string/AsyncIterable prompt 统一包成"回合门"streaming-input（yield 完消息后挂起，result 分支取完快照再放行；`finally` 兜底放行）；`fetchContextUsageSnapshot()` 带 2s 超时静默回退；主路径 + resume-fallback + 压缩重试路径三处覆盖。
- 快照 `totalTokens` → `token_usage.context_used_tokens` 落库；`maxTokens` → 仅诊断字段 `cli_context_window`，**刻意不写 `context_window`**（后者会进入 useContextUsage 的窗口解析链）。
- `context-usage-walk.ts`：分子优先 `context_used_tokens`，缺失（旧记录/快照失败）回退 `input+cacheR+cacheC` 旧口径。前端零改动（走既有 token_usage 链路，重开会话也生效；Phase 5 的 SSE `context_usage` 通道保持休眠）。

验证：单测 1854 全过；本地 Anthropic 协议 stub（managed 凭据 dev 无主密钥解不开，按 CLAUDE.md 用 mock）跑通真实回合——result 事件与 DB `token_usage` 均携带 `context_used_tokens:12345 / cli_context_window:200000`，回合生命周期正常（`terminal_reason: completed`）。

待真实环境复核（打包版或有凭据环境）：成功回合后快照 categories 是否含 System prompt / System tools 行（stub 回合 CLI 的 Messages 估算与 API input 一致，分类完整性未在真实网关下复核）。
