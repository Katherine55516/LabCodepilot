# /btw 侧边提问（会话内临时问答浮层）

> 创建时间：2026-06-30
> 最后更新：2026-06-30
>
> 功能文档（handover / insights）见 Phase 6，实现完成后补链接。

在主对话进行中，用户输入 `/btw <问题>` 发送后，弹出一个**临时小浮层**回答问题：基于**当前这通对话的上下文**作答，但**不打断**正在进行的主对话、**不进对话历史**、**不落库**，关闭即弃。对标 Claude Code CLI 的 `/btw`（"by the way"）命令。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 调研 + 方案确认（Claude /btw 语义 + 本项目基础设施盘点） | ✅ 已完成 | 见「详细设计」 |
| Phase 1 | 后端无状态端点 `/api/chat/btw`（native generateText，无工具，不取锁，不落库） | 📋 待开始 | 核心 |
| Phase 2 | 前端命令解析 `/btw <arg>` + `BtwDialog` 浮层（非流式跑通闭环 + 传内存上下文） | 📋 待开始 | 核心 |
| Phase 3 | i18n 三语（en / zh / zh-HK） | 📋 待开始 | zh-HK 手动加 |
| Phase 4 | 验证（`npm run test` + CDP：弹窗 / Esc 不留痕 / 主流式期间不打断 / console 无报错） | 📋 待开始 | 提交门槛 |
| Phase 5 | （增强，可选）流式 SSE + prompt cache 逼近「几乎免费」 | 📋 待开始 | 体验对齐 CLI |
| Phase 6 | （可选）功能文档 handover + insights + 反向链接 + 更新索引 | 📋 待开始 | 大迭代收尾 |

## 决策日志

- 2026-06-30：**功能出处认准**——`/btw` 是 **Claude Code CLI** 的命令（2026-03-10，CC 2.1.72，Erik Schluntz 出品），**不是** Claude 桌面版聊天应用的功能。语义六条：① 不打断主任务 ② 完全可见当前对话上下文 ③ 无工具 ④ 单次回答 ⑤ 临时浮层、不进历史、不落库 ⑥ 复用父对话 prompt cache 故"几乎免费"。
- 2026-06-30：**否决「新建持久侧边会话 + 快照」方案**（首轮探索代理建议）。理由：`/btw` 本质是**临时、无会话、不落库**；新建会话会污染会话列表、消耗会话锁逻辑、更重，且不忠实原语义。改为**无状态、不落库的轻量端点**。
- 2026-06-30：**后端走 native `generateText`（Vercel AI SDK），不走 `generateTextViaSdk`（Agent SDK 子进程）**。理由：native 一次 HTTP、**严格无工具**（不挂 tools，天然满足语义③）、更轻更快、可把 `generateText` 平滑换成 `streamText` 上流式；`generateTextViaSdk` 每次 spawn 子进程（cwd=homedir、60s 超时、shadow home cleanup）较重，且 `bypassPermissions` 单轮内模型仍可能尝试工具，不严格无工具。精确用法参照 `src/app/api/chat/structured/route.ts`（`createModel` + `generateText`）。
- 2026-06-30：**上下文来源 = 前端内存快照**（`messages` 最近 N 条 + 当前 `streamingContent`），随请求体 POST 给端点；不（只）读 DB。理由：主会话流式进行中，assistant 回复要等流结束才 `addMessage` 落库，只读 DB 会漏掉「正在生成的内容」；前端内存最贴合语义②「完全可见当前对话」，且绕开 DB 落库延迟。
- 2026-06-30：**端点不取 session 锁**（不调 `acquireSessionLock`）。理由：主聊天用 per-session 互斥锁，`/btw` 只要不取这把锁，就是独立 HTTP 请求 + 独立 LLM 调用，主 SSE 流照常推送 → 物理上不打断（语义①）。
- 2026-06-30：**与 `unified-context-layer.md` 的「浮窗助理」明确区分**，二者不冲突不重复：浮窗助理 = 系统级独立 `BrowserWindow` + 全局快捷键 + 剪贴板/语音、固定助理 workspace、**不带当前对话上下文**；`/btw` = 会话级、主窗口内浮层、**基于当前对话**、临时不落库。
- 2026-06-30：**保真度坦白**——CLI 的「几乎免费」靠复用父会话同进程 prompt cache；本端点是独立调用，token 成本≈上下文大小，不为零。MVP 不强求复刻；Phase 5 用 Anthropic `cache_control: ephemeral` 给上下文块打缓存逼近。

## 详细设计

### 目标 / 非目标

**目标**：会话内 `/btw <问题>` → 临时浮层基于当前对话作答；不打断主对话、不进历史、不落库、关闭即弃；无工具、单次。

**非目标**：浮层内多轮追问（语义④单次）；工具调用 / 文件读写（语义③无工具）；持久化答案（语义⑤临时）；系统级跨 app 浮窗（那是「浮窗助理」，另案）。

### 现状基础设施（Phase 0 盘点结论）

| 能力 | 位置 | 复用方式 |
|------|------|----------|
| 斜杠命令注册表 | `src/lib/constants/commands.ts:18` `BUILT_IN_COMMANDS` | 加 `/btw` 条目（弹窗提示） |
| 直接斜杠解析 | `src/lib/message-input-logic.ts:305` `resolveDirectSlash` | ⚠️ 现为**精确匹配**，`/btw <arg>` 带参不命中 → 需特判 |
| 提交分发接缝 | `src/components/chat/MessageInput.tsx:599` | `immediate_command` → `onCommand` 范式，新增 `btw_command` 分支 |
| 命令处理器 | `src/components/chat/ChatView.tsx:854` `useChatCommands` | 主路径；旧路径 `src/app/chat/page.tsx:871` `handleCommand` |
| native 轻量补全 | `src/app/api/chat/structured/route.ts` | `createModel` + `generateText` 范式照搬 |
| provider/model 工厂 | `src/lib/ai-provider.ts` `createModel({ providerId, model })` | 端点直接用 |
| 统一上下文组装 | `src/lib/context-assembler.ts` `assembleContext({ entryPoint })` | 可选 fallback（DB 路径）时用 |
| 会话历史读取 | `src/lib/db.ts` `getMessages` / `getSessionSummary` | 可选 fallback |
| 浮层组件 | `src/components/ui/dialog.tsx` / `popover.tsx` | `BtwDialog` 复用；参照 `ImageLightbox.tsx` 受控用法 |

### 数据流

```
用户输入 "/btw 这个函数为什么用 maxTurns:1?" → 回车
   │ MessageInput.handleSubmit
   ▼ resolveDirectSlash 特判 → { action:'btw_command', question }
   │ 不走 onSend（不进主对话），打开 BtwDialog
   ▼ 前端拼上下文 = 内存 messages(最近N条) + 当前 streamingContent
   │ POST /api/chat/btw { question, contextMessages, model, providerId }   ← 不带锁
   ▼ 端点：createModel → generateText（无工具，system=BTW 提示）
   │ （主会话 SSE 此刻照常推送，互不影响）
   ▼ 答案回浮层渲染 → 用户 Esc/Enter/Space 关闭 → 丢弃，不落库
```

### Phase 1：后端无状态端点（核心）

**新建 `src/app/api/chat/btw/route.ts`**（参照 `chat/structured/route.ts`）：
- 入参：`{ question: string, contextMessages: {role,content}[], model?: string, providerId?: string }`
- `createModel({ providerId, model })` → `generateText({ model, system: BTW_SYSTEM_PROMPT, messages: [...contextMessages, { role:'user', content: question }], maxOutputTokens })`
- `BTW_SYSTEM_PROMPT`：说明「这是一条侧边快速提问，只依据上文已有信息简洁作答，不调用任何工具，不要假设能读文件/跑命令」。
- **禁止**：`addMessage` / `createSession` / `acquireSessionLock` / `updateSdkSessionId` / 任何写库。
- abort + 超时（沿用 60s 量级），错误归一返回 `{ error }`。
- 自测：`curl -X POST localhost:3000/api/chat/btw`（本地无登录 → provider 为空，用 mock 验证逻辑分支，详见 Phase 4）。

**验收**：curl 传一段假上下文 + 问题，返回纯文本答案；无任何库写入（查 messages/sessions 表无新增）。

### Phase 2：前端命令解析 + 浮层（核心）

1. `src/lib/constants/commands.ts`：`BUILT_IN_COMMANDS` 加 `{ label:'btw', value:'/btw', description:'Quick side question', descriptionKey:'messageInput.btwDesc', builtIn:true }`（仅用于 `/` 弹窗展示；真正解析在第 2 步）。
2. `src/lib/message-input-logic.ts` `resolveDirectSlash`：函数开头加特判
   ```ts
   if (content === '/btw' || content.startsWith('/btw ')) {
     return { action: 'btw_command', question: content.slice(4).trim() };
   }
   ```
   （扩展 `DirectSlashResult` 类型加 `btw_command`）。
3. `src/components/chat/MessageInput.tsx` 分发：`btw_command` → **不调 `onSend`**；调用新 prop `onBtw(question, contextSnapshot)` 或内部状态打开 `BtwDialog` 并发请求。上下文快照由父级（ChatView）提供（它持有 `messages`），把当前 `streamingContent` 也并入。
4. **新建 `src/components/chat/BtwDialog.tsx`**：复用 `dialog.tsx`；展示问题、答案（Markdown 渲染复用现有 renderer）、loading 态；`onOpenChange(false)` 即弃，Esc/Enter/Space 关闭；空问题给友好提示。
5. 闭环：先非流式（拿 Phase 1 端点的一次性返回）跑通。

**验收**：输入 `/btw xxx` 弹层出答案；主对话消息列表无新增该问答；关闭后 DOM 不留痕。

### Phase 3：i18n 三语

- `src/i18n/en.ts` 加：`messageInput.btwDesc`、`btw.title`、`btw.placeholder`、`btw.thinking`、`btw.emptyHint`、`btw.error`。
- `src/i18n/zh.ts` 同步。
- `src/i18n/zh-HK.ts` **手动加**（禁止跑 `gen-zh-hk.mjs`，会回退既有 HK 术语）。

**验收**：三语文件 key 对齐，`npm run test`（含 i18n 一致性校验）通过。

### Phase 4：验证（提交门槛）

- `npm run test`（typecheck + 单测）通过；为 `resolveDirectSlash` 的 `/btw` 特判加单测。
- `npm run dev` 起服务，CDP 打开 `localhost:3000` 聊天页：
  - 注入 mock 让 `createModel`/provider 有可用配置（本地无登录体系，managed 为空），或在端点加 dev mock 分支，验证**逻辑正确性**（非真实数据，结论按此前提表述）。
  - 截图确认：`/btw` 浮层渲染正确；Esc 关闭后无残留；**主对话流式进行中**发 `/btw`，主流不中断（关键语义①）；console 无报错。
- 提交前关闭 dev server（只杀占用 3000 的进程）。

### Phase 5：流式 + 保真度收口（增强，可选）

- `generateText` → `streamText`（同一 `languageModel`），端点改 SSE，浮层逐字渲染（参照 `chat/page.tsx:630` SSE 解析）。
- prompt cache：对 `contextMessages` 块加 Anthropic `cache_control: { type:'ephemeral' }`，逼近「几乎免费」。

### Phase 6：功能文档（可选，大迭代收尾）

- `docs/handover/btw-side-question.md`（架构、数据流、端点契约、为何 native generateText、为何不落库）。
- `docs/insights/btw-side-question.md`（解决什么用户问题、为何临时不落库、与浮窗助理的边界、局限）。
- 两份互相反向链接；更新 `docs/handover/README.md`、`docs/insights/README.md`、本计划 frontmatter 链接。

## 涉及文件

| 文件 | 改动 |
|------|------|
| `src/app/api/chat/btw/route.ts` | **新增** 无状态端点 |
| `src/components/chat/BtwDialog.tsx` | **新增** 浮层组件 |
| `src/lib/constants/commands.ts` | 加 `/btw` 条目 |
| `src/lib/message-input-logic.ts` | `resolveDirectSlash` 加 `/btw <arg>` 特判 + 类型 |
| `src/components/chat/MessageInput.tsx` | 分发 `btw_command` + 上下文快照 |
| `src/components/chat/ChatView.tsx` | 提供上下文快照 + 挂 `BtwDialog` |
| `src/i18n/{en,zh,zh-HK}.ts` | 文案 key |
| `src/__tests__/unit/message-input-logic.test.ts`（或就近） | `/btw` 解析单测 |

## 验收标准（总）

- ✅ `npm run test` 通过（含新单测）
- ✅ `npm run test:smoke` 通过（UI 改动）
- ✅ CDP：`/btw` 浮层渲染正确、Esc/Enter/Space 关闭即弃、**主对话流式期间发 `/btw` 不打断**、console 无报错
- ✅ 该问答**不进主对话历史、不写库**（查表确认）
- ✅ 端点严格无工具（不挂 tools）

## 依赖 / 待办

- `createModel` 入参/返回以 `src/lib/ai-provider.ts` 实际签名为准（Phase 1 开工时核对）。
- 本地 dev 无登录体系，provider/managed 数据为空 → 验证用 mock，结论限定为「逻辑正确」。
- Phase 5/6 待 MVP 跑通后视需要推进。
