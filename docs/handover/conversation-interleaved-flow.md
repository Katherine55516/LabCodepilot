# 对话流交错渲染（Interleaved Conversation Flow）— 技术交接

> 产品思考见 [docs/insights/conversation-interleaved-flow.md](../insights/conversation-interleaved-flow.md)

## 一句话

把 assistant 消息从「工具/思考折叠在上、文字堆在下」改成「文字 / 工具调用 / 思考按真实发生顺序从上往下交错排列」（类似 Claude 桌面版），工具平铺单行不折叠。

## 数据流

```
SDK (有序 content blocks)
  → claude-client.ts SSE events（到达顺序 = 内容顺序，未改）
  → stream-session-manager.ts: 按到达顺序累积成 orderedBlocks: MessageContentBlock[]
       ├─ snapshot.blocks（实时渲染源）
       └─ finalMessageContent = JSON.stringify(orderedBlocks)（持久化，真顺序）
  → 渲染:
       ├─ 实时: StreamingMessage 读 snapshot.blocks → segmentsFromBlocks → MessageSegments
       └─ 持久: MessageItem parseOrderedSegments(message.content) → MessageSegments
```

## 关键文件

| 文件 | 职责 |
|------|------|
| [src/types/index.ts](../../src/types/index.ts) | `RenderSegment`（text/thinking/tool 视图模型）；`SessionStreamSnapshot.blocks` |
| [src/lib/message-segments.ts](../../src/lib/message-segments.ts) | **纯函数** `segmentsFromBlocks`（保序 + 按 id 配对 tool_use/tool_result）、`formatToolInput`、`truncateToolResult`（工具详情的参数格式化 / 结果截断）。无 React，可单测 |
| [src/lib/stream-session-manager.ts](../../src/lib/stream-session-manager.ts) | 流式累积 `orderedBlocks`（`appendOrderedText`/`appendOrderedThinking`/`pushOrderedToolUse`/`pushOrderedToolResult`/`endOrderedTextRun`）；重建 `buildFinalContentFromBlocks` |
| [src/components/chat/MessageSegments.tsx](../../src/components/chat/MessageSegments.tsx) | 共享渲染组件：按序 map，连续 tool/thinking 归到一条左边框，text 打断分组 |
| [src/components/chat/MessageItem.tsx](../../src/components/chat/MessageItem.tsx) | `parseOrderedSegments(content)`（持久消息）；渲染改用 `<MessageSegments renderText={AssistantContent}>` |
| [src/components/chat/StreamingMessage.tsx](../../src/components/chat/StreamingMessage.tsx) | 读 `blocks` → segments；`renderStreamingText` 保留流式 widget 预览（仅尾部 active 段） |
| [src/components/ai-elements/tool-actions-group.tsx](../../src/components/ai-elements/tool-actions-group.tsx) | `ToolActionRow`（**可折叠**：hover→caret、点击展开）+ `GenericToolDetail`（参数+结果面板）+ `ToolDiffView`（文件编辑的行级 diff）+ `ThinkingRow`；`ToolActionsGroup` 折叠组保留但已停用 |
| [src/lib/tool-diff.ts](../../src/lib/tool-diff.ts) | **纯函数** `computeLineDiff`（LCS 行级 diff）、`toolDiff`（从 Edit/Write/MultiEdit input 提取 diff）。无 React、无第三方依赖，可单测 |

## 保序原理

SSE 事件到达顺序天然等于内容顺序（`onToolUse` 里 `flushTextThrottle()` 保证 text 先于 tool）。累积时维护单一 `orderedBlocks` 数组：

- `onText(acc)`：`acc` 是全量累积文字。当前文字段 = `acc.slice(currentTextOffset)`；尾部是 text block 则更新，否则新建。
- 工具/思考到达 → `endOrderedTextRun`：`currentTextOffset = accumulatedText.length` + `needNewTextBlock=true`，下一段文字开新 block。
- tool_use → push block；tool_result → 按 `tool_use_id` 插入/更新。
- 所有更新**不可变**（新对象 + 新数组），保证 React 跨节流 emit 正确 reconcile。

## tool_use / tool_result 配对

`segmentsFromBlocks` 先建 `resultById` 映射，每个 `tool_use` 取自己的 result（支持并行工具乱序到达）。孤儿 `tool_result`（无对应 tool_use）渲染成裸行。

## 工具行折叠展开（查看参数 + 结果）

`ToolActionRow` 与 `ThinkingRow` 同款交互：hover 时行首工具图标换成 `>`（CaretRight），点击整行 toggle 展开内联详情面板。

- **可展开判定** `expandable`：有 bash/agent 运行中的自定义 detail、有 `result`、有 `input` 参数，或运行中有流式输出。不可展开的极少数行（空 input + 无 result + 非运行中）退化为普通 `<div>`。
- **默认态**：运行中（`result === undefined`）默认展开看实时输出；完成 / 历史默认折叠。初始值随挂载只取一次（`useState(isRunning)`），跑完仍保持当时状态。
- **展开内容**：
  - bash / agent **运行中**（`liveCustom`）→ 复用各自 `renderDetail`（滚动输出窗口 / 子任务进度）。
  - 其它工具，以及 bash / agent **完成后** → `GenericToolDetail`：上方 `formatToolInput` 渲染参数（JSON 美化，2000 字符封顶），下方 `truncateToolResult` 渲染结果（200 行 / 8000 字符封顶，超出提示「还有 N 行」/「内容已截断」），`isError` 标红。
  - 这样 bash/agent 完成后也能看到**最终结果**（旧 `renderDetail` 只显示流式进度，agent 跑完看不到产出）。
- **media（图片）**：仍走消息底部统一 `MediaPreview`，展开区不重复渲染（仅行内一个图片图标提示）。
- **复用 `stopScroll`**：展开时调用，避免 stick-to-bottom 把页面跳到底。`ToolActionRow` 仅经 `MessageSegments` 渲染（与 `ThinkingRow` 同处），都在 `StickToBottom` provider 内，安全。
- **改动面**：只改 `ToolActionRow` 一处，实时（StreamingMessage）/ 持久（MessageItem）/ 导入三条路径同时生效（都经 MessageSegments → ToolActionRow）。

### 文件编辑的 diff 视图（Edit / Write / MultiEdit）

文件编辑类工具行尾显示 `+N −M` 徽标（绿增 / 红删），展开渲染行级 diff（绿底新增、红底删除、灰色 context），对齐 Claude 桌面版。

- [src/lib/tool-diff.ts](../../src/lib/tool-diff.ts)：`computeLineDiff(old,new)` 用 LCS 算行级 diff（无外部依赖；一侧为空走全增 / 全删快路径；`m·n` 过大时退化为全删全增防 OOM）；`toolDiff(name,input)` 从 Edit（`old_string`/`new_string`）、Write（`content`，全增）、MultiEdit（`edits[]`）提取 diff，其它工具返回 null。
- `ToolDiffView`：渲染 diff 行，最多 400 行（超出用 `tool.moreLines` 提示剩余），`max-h-[320px]` 可滚动。
- `ToolActionRow` 展开优先级：`liveCustom`（bash/agent 运行中进度）> `hasDiff`（Edit/Write 的 diff）> result/input（`GenericToolDetail`）。有 diff 时隐藏完整路径，腾位给 `+N −M` 徽标。

## 向后兼容

- **历史旧消息**：改造前 AI Native Lab 把 content 持久化成旧硬编码顺序（thinking→text→tools）。改造后这些旧消息按**存储顺序**平铺渲染（思考→文字→工具，flat 但非真交错），可读不报错。**只有新消息**（改造后生成）从 SQLite 读出来就是真交错。
- **顺序并非永久丢失**：丢的只是 AI Native Lab 的 SQLite 缓存（`messages.content`）。Claude Code SDK 的原始转录 JSONL（`~/.claude/projects/<sdk_cwd 编码>/<sdk_session_id>.jsonl`）**完整保留了带时间戳的交错顺序**——每个 thinking/text/tool_use/tool_result 都是独立一行。因此旧消息的真顺序**可以从 JSONL 回填**（见下方「已知后续」）。
- **持久化格式不变**：仍是 `MessageContentBlock[]` JSON，无 DB schema 迁移。
- **legacy HTML-comment 格式**：`parseOrderedSegments` 保留兜底。

## 导入历史会话 = 自动交错重建（已实现）

应用未发布，没有线上老用户的旧消息——唯一会遇到旧 JSONL 的场景是**导入会话**功能。所以交错重建放在导入流程里做，[src/lib/claude-session-parser.ts](../../src/lib/claude-session-parser.ts) 的 `parseClaudeSession`：

- **回合合并**：Claude Code 的 JSONL 把一个逻辑回合拆成多行（thinking / text / 每个 tool_use 各一行，tool_result 作为 `user` 行回喂）。导入时把**两个真实用户提示之间**的所有 assistant 行 + tool_result 行**合并成一条 assistant 消息**，`contentBlocks` 保持 JSONL 的时间顺序。
- 关键修复（旧导入逻辑的 bug）：
  - 之前 `thinking` 块**没解析 → 被丢弃**；现在 `parseAssistantBlocks` 加了 thinking。
  - 之前 tool_result 在 `user` 行里、`parseUserMessage` 只取 text → **tool_result 被丢、tool_use 没结果**；现在 `analyzeUserEntry` 区分「真实提示」vs「tool_result 回喂行」，后者并入当前回合。
- 实测：导入一个 444 行真实 JSONL → 1 用户 + 1 个含 350 个有序 block 的 assistant 回合，顺序 `thinking→text→tool_use→tool_result→thinking→text→…` 完整交错。
- 局限：JSONL 需仍在磁盘；native runtime 会话无 JSONL。这些是导入功能本身的固有前提，非本改造引入。

## 自动批准 / MCP

不涉及 MCP 工具或自动批准策略变更。

## 测试

- 单测：[src/__tests__/unit/message-segments-order.test.ts](../../src/__tests__/unit/message-segments-order.test.ts) — 8 例覆盖 text→tool→text 交错、并行工具乱序配对、多段 thinking、running 工具、孤儿 result、media、空块。
- 单测：[src/__tests__/unit/tool-detail-format.test.ts](../../src/__tests__/unit/tool-detail-format.test.ts) — `formatToolInput`（对象/空/原始值/超长封顶）+ `truncateToolResult`（行截断/字符截断/空）共 8 例。
- 单测：[src/__tests__/unit/tool-diff.test.ts](../../src/__tests__/unit/tool-diff.test.ts) — `computeLineDiff`（全增/全删/单行改/无变化/多行插入）+ `toolDiff`（Edit/Write/MultiEdit/非编辑工具/缺字段）共 10 例。
- e2e（CDP 实测）：打开含 120 个工具行的导入会话 → hover 行首图标换成 `>`（caret path 119 vs NotePencil 332）、Bash 行展开「参数 + 结果」、Write 行显示 `+N` 且展开全绿行级 diff、Edit 行显示 `+1 −1` 且展开红删 / 绿增对比、console 零报错。
- 注意：直接 navigate `/chat/[id]` URL 会触发 Next 的 `generateStaticParams`（worker 查 DB），dev 下可能崩 worker（预存问题，与本改动无关）；验证走 `/chat` → 点击会话的 client 导航即可绕开。
- e2e 手测：插入合成交错消息 → CDP 确认 DOM 顺序 text→Read→text→Edit→text、无折叠头、console 零报错。

## 已知后续

- `ToolActionsGroup`（折叠组）已停用但未删，确认无其它引用后可清理。
- `ContextGroup`（连续读取自动归组）在新流程未使用——当前刻意全平铺。如需可在 MessageSegments 里恢复。
