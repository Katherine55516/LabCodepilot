# 对话撤回与新开分支实现评估

> 参考实现：`desktop-cc-gui`（Tauri + 直驱 Claude CLI 的开源桌面 GUI，分析快照位于 ~/Downloads/desktop-cc-gui-main）。
> 本文拆解其机制，并映射到 AI Native Lab（Electron + Next.js + Claude Agent SDK）给出实现方案。
> 调研日期：2026-07-09。SDK 结论基于实际安装的 `@anthropic-ai/claude-agent-sdk@0.3.203` 类型定义核实。

## TL;DR

1. **可行，且比参考项目省一大块工作。** 参考项目直驱 CLI、拿不到 SDK 高级参数，只能在 Rust 里手搓「克隆 JSONL 转录 → 按目标消息截断 → 改写 session_id → 删旧文件」。我们装的 SDK 0.3.203 有**原生等价物** `forkSession(sessionId, { upToMessageId })` —— 官方实现干的正是同一件事（复制转录、重映射 uuid、保留 parentUuid 链）。
2. **撤回和分支应做成同一个底层原语**（参考项目正是如此）：fork-at-message。**撤回 = fork 后替换当前会话游标；分支 = fork 后新建会话并跳转。**
3. **最大前置工作在数据层**：`messages` 表目前只有本地随机 hex 主键，**SDK message uuid 不落库**（仅活跃流的内存 `rewindPoints`，重开会话即丢）。撤回/分支的锚点恰恰是这个 uuid，必须先补持久化。
4. **文件恢复建议分期**：P1 只做对话层（messages-only）；文件回滚维持现有 RewindButton 能力；P2 再做参考项目式的三态确认弹窗与统一文件恢复。

---

## 1. 参考项目机制拆解

### 1.1 两套彼此独立的 fork（勿混淆）

| | 机制 A：末尾开分支 | 机制 B：从中间消息 fork / rewind |
|---|---|---|
| 触发 | 会话级「新建分支」 | 用户消息上的 Fork 按钮 / Composer 的 Rewind 按钮 |
| 实现 | CLI 原生 `--resume <父sessionId> --fork-session`，CLI 自行分配子 session id | Rust 手搓：克隆 `~/.claude/projects/<hash>/<sid>.jsonl`，命中目标 user 消息即 break（**exclusive 截断**），逐行改写 `session_id` 为新 uuid，写 `<newUuid>.jsonl` |
| 父会话 | 保留（父子并存） | **删除**（rename thread + hide + 删源文件，"从中间 fork"实为换 id 的原地替换） |
| 关键代码 | `src-tauri/src/engine/claude.rs:935`（参数拼装） | `src-tauri/src/engine/claude_history.rs:2334`（截断克隆） |

### 1.2 rewind = fork + mode 开关

- rewind 与 fork 调**同一个** `forkSessionFromMessageForWorkspace`，唯一差别是三态 `rewindMode`：
  - `messages-and-files`（默认）/ `messages-only`（fork 按钮硬编码此值）/ `files-only`
- 确认弹窗（`ClaudeRewindConfirmDialog`）内容：三态单选、目标消息预览、影响统计（将删除的 user/assistant 消息数与工具调用数、受影响文件数）、受影响文件 diff 预览（仅 git 脏或非 git 仓库时展示）、"Store changes" 撤回前导出备份。
- 消息锚点 = JSONL 里的 **uuid**；前端 id → uuid 有三级回退匹配（精确 id → 归一化文本+出现次数 → 距末尾位置），用于兼容对不上号的场景。

### 1.3 文件恢复：反向重放工具编辑（不依赖 git checkpoint）

- 从撤回点起逆序遍历被撤回范围内的工具调用，提取结构化变更（Edit 的 old/new、unified diff、add/delete/rename），**反向套用**还原文件；Bash 类改动靠产物推断。
- 纪律：**只动 git 脏文件，已提交路径跳过**；反向重放失败退 `git checkout` 单文件；仍失败记入 skipped 上报。
- 安全网：落盘前抓原始快照，会话 fork 失败则用快照把文件写回（对话与文件两步的事务性靠这个补偿实现）。

### 1.4 值得直接抄的边界处理清单

- 撤回目标是**第一条用户消息** → 不截断，直接删整个会话（等价"清空重来"）。
- **流式输出中禁用**入口（`isLoading`）；每 thread 一把 in-flight 锁防并发 rewind/fork；弹窗请求带 requestId 去重。
- 目标消息在转录中找不到 → 后端清理半成品文件并明确报错。
- 子代理转录（`agent-*.jsonl`）在枚举/fork 时跳过、删除会话时连带清理。
- codex 引擎用「文本+回合序号」锚点（无稳定 uuid），claude 用 uuid —— 我们只有 SDK 一条主链路，天然规避这种分裂。

---

## 2. 我们的现状与差距

| 维度 | 参考项目 | AI Native Lab 现状 |
|---|---|---|
| 会话真数据 | 磁盘 JSONL（`~/.claude/projects`） | SQLite `messages` 表（SSE 流式落库），JSONL 仅"导入外部会话"用 |
| 续接方式 | CLI `--resume` | SDK `query({ resume: sdk_session_id })`，每条消息新起一次 query（`claude-client.ts:1045`）；resume 失败降级为"DB 历史拼进 prompt"（`claude-client.ts:1269`） |
| 消息锚点 | JSONL uuid | **缺**：`messages.id` 是本地随机 hex（`db.ts:1321`），SDK uuid 不落库；`rewind_point` 事件带 user 消息 uuid 但只存活跃流内存（`stream-session-manager.ts:61`），重开会话即失 |
| 撤回 | 完整（对话+文件三态） | 仅文件层：`/api/chat/rewind` SDK 路径只调 `rewindFiles`（依赖内存活跃 conversation）；native 兜底路径倒是会截 DB + 内存 checkpoint，但**两路 id 空间不一致**（SDK 路给 uuid、native 查本地 id，`rewind/route.ts:36` 对 uuid 必然查不到）——存量 bug |
| 分支 | 完整（两套机制） | 无任何代码 |
| 分支谱系 | 前端 `threadParentById` + 侧栏父子缩进 | `chat_sessions` 无 parent 字段 |
| 文件恢复 | 反向重放 + git 兜底 + 快照补偿 | SDK 路径 `enableFileCheckpointing`（默认开，`route.ts:556`）+ `rewindFiles`；native 路径进程内存 checkpoint（重启即失，`file-checkpoint.ts:35`） |

## 3. SDK 原生能力核实（v0.3.203 `sdk.d.ts`，均已读原文确认）

**独立导出函数 `forkSession`（sdk.d.ts:654）——本方案的核心依赖：**

```ts
/** Fork a session into a new branch with fresh UUIDs.
 *  Copies transcript messages from the source session into a new session file,
 *  remapping every message UUID and preserving the parentUuid chain. Supports
 *  `upToMessageId` for branching from a specific point in the conversation.
 *  Forked sessions start without undo history (file-history snapshots are not copied). */
forkSession(sessionId, { dir?, upToMessageId?, title? }): Promise<{ sessionId }>
// upToMessageId: "Slice transcript up to this message UUID (inclusive). If omitted, full copy."
// 返回的新 sessionId 可直接 query({ options: { resume } })
```

**query Options（撤回的轻量替代路径）：**

- `resume?: string` — 按 session id 恢复历史。
- `resumeSessionAt?: string` — "resume messages **up to and including** the message with this UUID... should be from **SDKAssistantMessage.uuid**"。即锚点是 assistant 消息 uuid、含端点。
- `forkSession?: boolean` — 与 `resume` 连用时 fork 出新 session id（≈ 参考项目机制 A）。
- `sessionId?: string` — 可为 fork 出的会话指定自定义 UUID。

**文件层：** `Query.rewindFiles(userMessageId, { dryRun? })`（sdk.d.ts:2423）——锚点是 **user 消息 uuid**，需 `enableFileCheckpointing`，且是**活跃 Query 上的方法**（重开应用后没有活跃 Query 就调不到；这是现有 `/api/chat/rewind` SDK 路径的真实约束）。

**辅助：** `getSessionMessages(sessionId, { dir?, limit?, offset? })` 直接读转录并按 parentUuid 链返回消息（可用于旧会话 uuid 对齐）；`deleteSession` / `renameSession`；`SessionMutationOptions.dir` = 项目目录（即会话 cwd），省略则全项目目录搜索——**建议总是传 cwd**，避免重名歧义并加速。

**两个关键语义结论：**

1. 锚点分工明确——**对话层锚点用 assistant uuid**（`resumeSessionAt` 文档明示；`forkSession.upToMessageId` 传 assistant uuid 同样成立且语义直观），**文件层锚点用 user uuid**（`rewindFiles`）。两种 uuid 都要落库。
2. **fork 不复制 file-history 快照** → 文件恢复必须发生在 fork **之前**（在原会话上做），fork 出的新会话早期回合 `rewindFiles` 不可用。参考项目"先恢复文件、后 fork 会话、失败用快照回滚"的顺序正好印证。

## 4. 推荐方案

### 4.0 统一原语

```
forkChatSession(localSessionId, anchor, { replace: boolean })
  anchor = 目标消息的 SDK uuid 换算出的 upToMessageId（含端点）
  replace=true  → 撤回：新 sdk_session_id 回写当前会话 + 截断 DB 消息
  replace=false → 分支：新建 chat_sessions 行 + 复制 DB 消息 + 跳转
```

### 4.1 P0 前置：持久化 SDK uuid（数据层）

- `messages` 增列 `sdk_message_uuid TEXT`（可空，旧数据为 NULL）：
  - **user 行**：`claude-client.ts:1467` 已对 prompt 级 user 消息 emit `rewind_point { userMessageId: uuid }`，在 `route.ts` 消费处回填 `UPDATE messages SET sdk_message_uuid=?`（与现有 `updateSdkSessionId` 同构）。
  - **assistant 行**：流结束落库时写入**本回合最后一条** SDK assistant 消息的 uuid（claude-client 需在 SSE 载荷中带出 uuid；注意排除子代理 sidechain 消息，只取主链）。
- `chat_sessions` 增列 `parent_session_id TEXT`、`forked_from_message_id TEXT`（分支谱系，UI 标识用）。
- `db.ts` 迁移按既有 `ALTER TABLE` 惯例补列。

### 4.2 撤回（rewind，作用于 user 消息 U：删除 U 及之后，重来这一轮）

1. 锚点换算：DB 里取 U 之前最近一条 assistant 行的 `sdk_message_uuid` 作为 `upToMessageId`（含端点 → 恰好切到 U 前）。
2. （P2 可选）文件恢复：**先于 fork**，走活跃 Query 的 `rewindFiles(U.sdk_message_uuid)`。
3. `forkSession(sdk_session_id, { upToMessageId, dir: cwd })` → 新 sdkId → `UPDATE chat_sessions SET sdk_session_id = 新id`。
4. `DELETE FROM messages WHERE session_id=? AND rowid >= U.rowid`（以 user 消息为界，天然保住之前回合的 tool_use/tool_result 配对）。
5. 前端刷新列表，并把 U 的文本回填输入框（"编辑重发"体验，成本极低、感知强，参考项目没有但主流 chat UI 都有）。
- **特判**：U 是第一条消息 → 不 fork，清空 `sdk_session_id` + 删全部消息（= 清空会话）。
- **降级链**：无 `sdk_session_id` / 锚点 uuid 缺失 / `forkSession` 抛错 → 纯 DB 截断。现有"resume 失败 → DB 历史拼 prompt"机制（`buildFinalPrompt(true)`）让降级后对话依然可续，native runtime 也统一走这条。
- 原 SDK 会话文件**不删**（与参考项目不同）：留作 redo/调试余地，磁盘成本可忽略；后续可挂会话删除时的连带清理。

### 4.3 分支（fork，作用于 assistant 最终回复 A：保留到 A 为止，另开新线）

1. `forkSession(sdk_session_id, { upToMessageId: A.sdk_message_uuid, dir, title })`。
2. 新建 `chat_sessions` 行：复制 `working_directory`/`sdk_cwd`/provider 相关字段，`sdk_session_id=新id`，`parent_session_id=原会话`，`forked_from_message_id=A.id`，标题 = 原标题 + " (分支)"。
3. `INSERT INTO messages ... SELECT`（`rowid <= A.rowid`）复制历史到新会话——UI 立即有完整历史，降级 prompt-history 路径也天然可用。
4. 跳转 `/chat/<新id>`。
- 末尾整会话分支（会话菜单「复制为分支」）：同一函数不带 `upToMessageId`。

### 4.4 API 设计

- 新增 `POST /api/chat/sessions/[id]/fork`：`{ anchorMessageId?: string }` → `{ sessionId, sdkSessionId }`（分支）。
- 升级现有 `POST /api/chat/rewind`：加 `mode`（对齐参考项目三态，P1 先支持 `messages-only`），内部走同一原语 `replace=true`；顺手修掉 SDK/native 两路 id 空间不一致的存量 bug（统一以本地 message id 入参、服务端换算 uuid）。

### 4.5 UI（`MessageItem` / `MessageList` / `ChatView`）

- user 消息 hover：**「撤回到此」**；assistant 最终回复 hover：**「从此新开分支」**。
- 撤回确认弹窗 P1 简版：目标消息预览 + "将删除 N 条消息、M 次工具调用"（DB 可直接算）；P2 扩三态 + 受影响文件。
- 会话头/列表项的分支标识：「分支自 <原会话>」可点击跳转（用 `parent_session_id`）；树状侧栏缩进列为 P3 可选。
- 纪律：流式中禁用两个入口（`isLoading`）；每会话 in-flight 锁；`ChatView` 的 `useState<Message[]>` 支持截断刷新。

### 4.6 旧会话兼容

- P1：`sdk_message_uuid` 为 NULL 的消息不显示撤回/分支按钮（新消息立即可用，简单诚实）。
- P2：用 `getSessionMessages()` 读转录按「文本+出现次数+位置」对齐回填旧消息 uuid（参考项目三级回退逻辑可直接抄）。

### 4.7 native runtime 与 Bridge

- native（非 Anthropic provider）：无 SDK session 概念。fork = 新会话 + 复制消息（其历史本就靠 prompt 注入，天然成立）；rewind = DB 截断 +（现有内存 file-checkpoint）。统一在原语层按 runtime 分流。
- Bridge 复用同一存储与 `streamClaude`，核心层实现后能力自动具备；IM 侧指令入口暂不做。

## 5. 风险与待 POC 验证点

| # | 风险/未知 | 验证方式 |
|---|---|---|
| 1 | `forkSession` 独立函数在 Next.js server 进程直接 import 调用的可用性（纯本地转录文件操作，理论无子进程/网络依赖；不涉及模型调用，无 managed 别名 503 问题） | 本地 dev 对已有会话跑一次 fork + resume 冒烟 |
| 2 | `upToMessageId` 传 user uuid 是否也合法（若合法可简化锚点换算；文档只对 assistant uuid 有明示） | 同上 POC 顺带验 |
| 3 | `rewind_point` 目前只对 prompt 级 user 消息 emit，多模态/斜杠命令消息的覆盖度 | 各类消息发一遍看事件 |
| 4 | 会话经历过 compact（自动压缩）后，早期消息 uuid 是否仍在转录中可作锚点 | 构造长会话触发 compact 后 fork 早期锚点 |
| 5 | fork 后 file-history 不复制 → 新会话早期 `rewindFiles` 不可用，RewindButton 展示逻辑需兼容 | 实现时处理 |
| 6 | Windows 路径：`dir` 参数交给 SDK 定位转录，**不要自己拼 `~/.claude/projects` 路径** | 代码纪律 |

## 6. 分期与工作量估算

| 阶段 | 内容 | 估算 |
|---|---|---|
| P0 | `sdk_message_uuid` 双端落库 + schema 迁移 + `forkSession` POC（风险点 1/2/4） | ~0.5 天 |
| P1 | 统一原语 + fork/rewind API + 简版确认弹窗 + 两个消息级入口 + 分支来源标识 + 撤回回填输入框 + 测试 | ~2 天 |
| P2 | 三态弹窗（对话/文件/两者）+ 文件恢复整合 + 旧会话 uuid 对齐回填 | ~1.5 天 |
| P3（可选） | 侧栏分支树、redo（原会话文件保留的红利）、Bridge IM 指令 | 按需 |

## 7. 结论

参考项目验证了「fork-at-message 单一原语，rewind 与 fork 是它的两种 UX 包装」这条架构路线，其最重的部分（JSONL 截断手术、uuid 对齐、失败补偿）我们可以用 SDK 0.3.203 原生 `forkSession` / `resumeSessionAt` / `getSessionMessages` 替代大半。真正要自己做的是：**uuid 持久化（P0）、原语与 API（P1）、UI 入口与弹窗（P1）**。建议按 P0 → P1 先交付对话层撤回+分支，文件恢复三态放 P2。
