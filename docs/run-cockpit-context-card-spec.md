# RunCockpit 上下文用量卡片 — 完整实现文档

> 目标：拿着这份文档，在另一个类似的（聊天 / Agent）项目中**从零复刻**聊天框右下角那个"本次运行 / 上下文用量"卡片。
> 文档覆盖：所有相关文件、数据结构、数据流、核心算法、组件 props、样式（含精确配色与 Tailwind 类）、i18n、交互逻辑、分支状态、集成点、依赖、移植清单。
>
> 源项目：CodePilot（Next.js + React + Tailwind + shadcn/ui + Radix）。技术栈不同也能照搬——核心逻辑（`context-breakdown` / `context-usage-walk` / dot-matrix 分配算法）是纯函数，与框架无关。

---

## 目录

1. [功能概览与视觉拆解](#1-功能概览与视觉拆解)
2. [文件清单与职责](#2-文件清单与职责)
3. [数据结构 / 类型契约](#3-数据结构--类型契约)
4. [端到端数据流](#4-端到端数据流)
5. [核心算法（需精确复刻）](#5-核心算法需精确复刻)
6. [组件逐个说明（props + 渲染结构）](#6-组件逐个说明props--渲染结构)
7. [样式规范（配色 + 布局）](#7-样式规范配色--布局)
8. [i18n 文案表](#8-i18n-文案表)
9. [交互逻辑](#9-交互逻辑)
10. [分支与状态机](#10-分支与状态机)
11. [集成点（宿主项目要提供什么）](#11-集成点宿主项目要提供什么)
12. [依赖](#12-依赖)
13. [移植清单 / 最小可用版本](#13-移植清单--最小可用版本)
14. [不变量与边界情况](#14-不变量与边界情况)

---

## 1. 功能概览与视觉拆解

聊天输入框**右下角**有一个触发器（一个 10 格迷你点阵 + 一段百分比文字，如 `▪▪▫▫▫▫▫▫▫▫ 3.3%`）。点击后向上弹出一张卡片，自上而下分为两大半，中间一条分隔线：

**上半（上下文用量）**
1. 顶行：左侧百分比（`3.3%`），右侧 `已用 / 总量`（等宽字体、灰色，如 `33.1K / 1000K`）。
2. 点阵主条：100 格（2 行 × 50 列），按类别上色，剩余容量为灰格，"待加入"格为虚线描边。
3. 明细列表：每类一行 = 色点 + 类别名 + 右对齐 token 数。默认隐藏数值为 0 的行（所以常见只显示 4 行：工具 / 规则 / 对话历史 / 缓存·上轮）。

**下半（本次运行 = "This run"）**
4. 标题"本次运行"。
5. 模型行：`服务商 · 模型` + 右侧「切换 ↗」。
6. 默认行：`自动 / 已固定 / …` + 右侧「修改 ↗」。
7. 权限行：`默认权限 / 完全访问`（完全访问标红）。
8. 问题块（可选）：当服务商/模型/CLI 有问题时，列出待处理项 + 「前往修复 ↗」。
9. 页脚：`Total cost  $x.xx`（注意：源项目这一行**硬编码英文**，未本地化）。

加法自洽性：明细各项相加 ≈ 顶部"已用"（对话历史这一项吸收残差，见 [§5.1](#51-buildcontextusagebreakdown核心拆分)）。

---

## 2. 文件清单与职责

| 文件 | 职责 | 纯函数? |
|---|---|---|
| `src/lib/context-breakdown.ts` | **核心**。把总用量拆成 10 类的纯数据层 `buildContextUsageBreakdown`。定义类别枚举、顺序、默认标签、不变量。 | ✅ |
| `src/lib/context-usage-walk.ts` | 从消息列表倒着走，解析出 `baseline`（used/cache/output）、最新 SDK 上下文窗口、最新 `context_accounting` 快照。 | ✅ |
| `src/lib/harness/context-accounting.ts` | 运行时记账契约的辅助：把 Runtime 产出的 `RuntimeContextAccountingSnapshot` 映射成 `buildContextUsageBreakdown` 的 `compiler` 入参（`snapshotToCompilerInputs`）。 | ✅ |
| `src/lib/model-context.ts` | 模型 → 上下文窗口大小的静态目录 + 解析逻辑 `getContextWindow`。 | ✅ |
| `src/hooks/useContextUsage.ts` | **数据编排 hook**。把上面四个拼起来，产出 `ContextUsageData`（含 `breakdown`）。处理 snapshot 快路径、窗口优先级、warning 状态。 | React hook |
| `src/components/ai-elements/context-core.tsx` | 轻量 React Context（`ContextProvider` / `useContextValue` / `ContextContext`），只发布 `usedTokens/maxTokens/usage/modelId`，不引入重依赖。 | React |
| `src/components/ai-elements/context.tsx` | AI Elements 全套：`ContextContentHeader/Body/Footer`、`ContextInput/Output/Reasoning/CacheUsage`。本卡片**只用到 `ContextContentFooter`**（Total cost）。用 `tokenlens` 算钱。 | React |
| `src/components/chat/context-breakdown/ContextDotMatrix.tsx` | 点阵渲染 + 格子分配算法 `computeAllocations`。触发器迷你条与弹窗主条都用它。 | React + 纯算法 |
| `src/components/chat/context-breakdown/ContextBreakdownList.tsx` | 10 行明细列表。标签走 i18n。 | React |
| `src/components/chat/RunCockpit.tsx` | **触发器外壳**（始终渲染）。算 `useContextUsage`，画迷你点阵 + 百分比，包 `ContextProvider` + Radix `Popover`，懒加载弹窗内容。 | React |
| `src/components/chat/RunCockpitPopoverContent.tsx` | **弹窗主体**（懒加载，首次打开才挂载）。组合顶行 + 点阵 + 明细 + 分隔线 + 本次运行 + 问题块 + Total cost。 | React |
| `src/components/settings/useOverviewData.ts` | 聚合"服务商/模型/运行时/工作区"状态的 hook。弹窗"本次运行"区的模型标签、默认模式、问题判定都读它。 | React hook |
| `src/lib/runtime/effective.ts` | 运行时解析纯函数：`computeEffectiveRuntime`、`runtimeDisplayLabel`、`resolveNewChatDefault`。 | ✅ |
| `src/lib/model-option-match.ts` | `findModelOption`——把 canonical 模型 id 映射回别名行，让模型标签显示友好名。 | ✅ |
| `src/app/globals.css` | `--context-dot-*` OKLCH 配色（10 个 CSS 变量）。 | CSS |
| `src/i18n/zh.ts` / `src/i18n/en.ts` | `runStatus.*` 文案。 | 数据 |
| `src/types/index.ts` | `TokenUsage`、`RuntimeContextAccountingSnapshot`、`ContextAccountingEntry/Kind/RuntimeId`、`Message.token_usage`。 | 类型 |
| `src/components/chat/ChatView.tsx` | **集成点**。挂 `<RunCockpit>` 并喂入所有 props。 | React |

> 架构关键：**触发器轻、弹窗重**。`RunCockpit.tsx` 用 `next/dynamic({ ssr: false })` 懒加载 `RunCockpitPopoverContent`，且 Radix `PopoverContent` 只在打开时挂载子树——所以重依赖（`useOverviewData` → 运行时解析 → 服务商目录、`tokenlens`、`useClaudeStatus`）只有用户**第一次点开**时才进编译/运行图，不拖累聊天首屏。这条由测试 `src/__tests__/unit/chat-static-graph.test.ts` 锁定。

### 2.1 ⚠️ 不要移植的旧版组件 & 共享 hook

- **`src/components/chat/ContextUsageIndicator.tsx`（旧版/勿移植）**：截图那张卡片的**前身**。它用老的 ai-elements `Context` 套件（`ContextTrigger/ContextContent/ContextContentHeader/Body` + `ContextInput/Output/CacheUsage` 三行）+ `HoverCard`，容量未知时走一个简版 HoverCard。它**不**用 `ContextDotMatrix` / `ContextBreakdownList`，也**当前没有被任何地方挂载**（已被 `RunCockpit` 取代）。`ContextDotMatrix.tsx` / `ContextBreakdownList.tsx` 文件头注释里 "Sub-component of ContextUsageIndicator" 是**过时注释**——实际只有 `RunCockpitPopoverContent` 用它们。👉 复刻时 grep 到 `ContextUsageIndicator` 请忽略，**以 `RunCockpit` 为准**。
- **`useContextUsage` 是共享数据层**：除了本卡片，它还被 `ChatView`（顶部 RunCheckpoint 拦截）、`MessageInput`（输入框 pending 预估）、`chat/page.tsx` 等消费。也就是说它不是卡片私有的——卡片只是它的一个渲染面。移植时可把它当通用 hook 放在公共位置。

---

## 3. 数据结构 / 类型契约

### 3.1 类别枚举与拆分结果（`context-breakdown.ts`）

```ts
export type ContextBreakdownKind =
  | 'system_prompt' | 'tools' | 'rules' | 'skills' | 'mcp' | 'memory'
  | 'files_attachments' | 'conversation' | 'pending_next_turn' | 'cache_or_previous';

// 渲染与测试的稳定顺序（点阵上色顺序、明细行顺序都按它）
export const CONTEXT_BREAKDOWN_KIND_ORDER: readonly ContextBreakdownKind[] = [
  'system_prompt','tools','rules','skills','mcp','memory',
  'files_attachments','conversation','pending_next_turn','cache_or_previous',
] as const;

// "待加入下一轮"的类别——点阵/列表用虚线样式区分；且不计入 usedTokens
export const PENDING_BREAKDOWN_KINDS: readonly ContextBreakdownKind[] =
  ['files_attachments','pending_next_turn'] as const;

// 仅作 fallback / 测试 / 非 React 消费 / 调试用，UI 不要直接渲染（UI 走 i18n）
export const DEFAULT_LABELS: Record<ContextBreakdownKind, string> = {
  system_prompt: '系统提示', tools: '工具', rules: '规则', skills: 'Skills',
  mcp: 'MCP', memory: 'Memory', files_attachments: '文件与附件',
  conversation: '对话历史', pending_next_turn: '本次待加入', cache_or_previous: '缓存 / 上轮',
};

export interface ContextBreakdownPart {
  kind: ContextBreakdownKind;
  label: string;   // = DEFAULT_LABELS[kind]，但 UI 用 i18n 覆盖
  tokens: number;  // 0 表示该来源未接线或为空
  source: string;  // 内部调试面包屑，永不渲染给用户
  detail?: string; // 可选子明细（如文件名列表）
}

export interface ContextUsageBreakdown {
  usedTokens: number;            // 所有"已用"（非 pending）项之和
  contextWindow?: number;        // 解析出的窗口；未知/非法时 undefined
  remainingTokens?: number;      // max(0, window - used)；窗口未知时 undefined
  ratio?: number;                // used/window，clamp 到 [0,1]；窗口未知时 undefined
  parts: ContextBreakdownPart[]; // 恒为 10 项，按 CONTEXT_BREAKDOWN_KIND_ORDER
}
```

### 3.2 `buildContextUsageBreakdown` 的入参

```ts
export interface ContextBreakdownBaseline {
  used: number;                 // = input + cacheRead + cacheCreation（来自最近一次 API 用量）
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
}
export interface ContextBreakdownPending {  // 来自输入框（还没发送）的预估
  attachmentTokens?: number;    // 附件
  mentionTokens?: number;       // @ 提及的路径
  directoryTokens?: number;     // 目录引用
  composerTextTokens?: number;  // 纯文本（源项目 Phase 1a 未接线，默认 0）
}
export interface ContextBreakdownCompiler {  // 编排/harness 侧片段，全部可选，undefined = 未接线 → 该行显示 0
  systemPromptTokens?: number;
  toolDescriptorTokens?: number;   // 工具描述（不含 MCP）
  workspaceRuleTokens?: number;    // 工作区/项目规则
  skillsHarnessTokens?: number;    // Skill 提示 + harness 扩展提示
  mcpDescriptorTokens?: number;    // 仅 MCP server 的工具定义
  memoryTokens?: number;           // 记忆片段
}
export interface ContextBreakdownInputs {
  baseline?: ContextBreakdownBaseline;
  contextWindow?: number;
  pending?: ContextBreakdownPending;
  compiler?: ContextBreakdownCompiler;
}
```

### 3.3 运行时记账契约（`types/index.ts`）

这是"工具 / 规则 / Skills / MCP / Memory / 系统提示"等**编排侧**真实 token 的来源。由各 Runtime 适配器在发送时产出，随 assistant 消息持久化到 `token_usage.context_accounting`。

```ts
export type ContextAccountingRuntimeId = 'claude_code' | 'codepilot_runtime' | 'codex_runtime';

// Runtime 能上报的类别（不含 conversation/cache/pending_next_turn——那些来自 baseline/输入框）
export type ContextAccountingKind =
  | 'system_prompt' | 'tools' | 'rules' | 'skills' | 'mcp' | 'memory' | 'files_attachments';

export interface ContextAccountingEntry {
  tokens: number;
  source: string;   // 必填面包屑：必须能区分"可用(每轮都在)"vs"本轮真正注入"
  detail?: string;
}
export interface RuntimeContextAccountingSnapshot {
  entries: Partial<Record<ContextAccountingKind, ContextAccountingEntry>>; // 只放有可信 source 的类别
  unsupported: readonly ContextAccountingKind[];  // 本 Runtime 无法统计的类别 → UI 隐藏这些行
  producedBy: ContextAccountingRuntimeId;
  providerBackend?: 'codex_account' | 'codepilot_proxy' | 'native_app_server' | string;
}
```

> 设计要点（踩坑史）：早期版本用一份固定的 `context_breakdown` 喂 Skills/MCP/Tools，导致用户发"你好"也显示"Skills 1.5K"（假数据）。新契约强制：① `source` 必填，区分"可用"与"本轮注入"；② `unsupported` 一等公民，Runtime 说"我数不了 MCP"而不是上报 0；UI 对 unsupported 隐藏行。**复刻时可简化**：若你的项目暂时算不出这些，整张快照传 `null`，则只有 `conversation` 和 `cache_or_previous` 非零（见 [§13](#13-移植清单--最小可用版本)）。

### 3.4 消息上的用量字段（`types/index.ts`）

```ts
export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cost_usd?: number;
  context_accounting?: RuntimeContextAccountingSnapshot; // §3.3，弹窗明细的真相源
  context_window?: number;  // 该轮模型的上下文窗口（SDK 上报；优先于静态目录）
  // context_breakdown?: ... // 已废弃，忽略
}

// Message（节选）
interface Message {
  role: 'user' | 'assistant' | string;
  token_usage: string | null; // TokenUsage 的 JSON 字符串
  // ...其它字段
}
```

### 3.5 hook 输出（`useContextUsage.ts`）

```ts
export interface ContextUsageData {
  modelName: string;
  contextWindow: number | null;
  used: number;            // 来自 breakdown.usedTokens（可能被提升，见 §5.1）
  ratio: number;           // used / contextWindow
  estimatedNextTurn: number; // used + outputTokens + 200
  estimatedNextRatio: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  outputTokens: number;
  hasData: boolean;
  state: 'normal' | 'warning' | 'critical'; // 取 actual/estimated 比值的较大者
  hasSummary: boolean;     // 是否启用了会话压缩摘要
  source: 'snapshot' | 'result_usage' | 'none';
  snapshotCapturedAt?: number;
  breakdown: ContextUsageBreakdown; // §3.1，UI 主要消费它
}
```

### 3.6 轻量 Provider 契约（`context-core.tsx`）

```ts
export interface ContextSchema {
  usedTokens: number;
  maxTokens: number;
  usage?: LanguageModelUsage; // 来自 'ai' 包；给 Total cost 用
  modelId?: string;
}
```

---

## 4. 端到端数据流

```
宿主提供：messages[]（每条 assistant 带 token_usage JSON）
           + modelName / upstreamModelId / context1m / hasSummary
           + 输入框 pending 子项（附件/@提及/目录）
           + permissionProfile / sessionRuntimePin / providerId
                         │
                         ▼
        ┌──────────────────────────────────────────────┐
        │ useContextUsage(messages, modelName, opts)     │
        │                                                │
        │ 1) getContextWindow(modelName,{context1m,      │   ← 静态目录兜底
        │      upstream}) → catalogWindow                │
        │ 2) 若有"新鲜"snapshot(<60s) → 快路径直接返回    │   ← SDK 权威快照
        │ 3) walkContextUsage(messages) →                │
        │      { baseline, latestSdkContextWindow,        │
        │        contextAccounting }                      │
        │ 4) contextWindow =                              │
        │      is1m(walk.latestModel) ? 1M（最高优先级）   │
        │      : baseline.sdkContextWindow                │
        │      ?? latestSdkContextWindow ?? catalogWindow │
        │ 5) compiler = snapshotToCompilerInputs(         │   ← 工具/规则/Skills…真实值
        │                 contextAccounting)              │
        │ 6) breakdown = buildContextUsageBreakdown({     │   ← 纯函数核心
        │      baseline, contextWindow, pending, compiler})│
        │ 7) used = breakdown.usedTokens; ratio=used/win  │
        └──────────────────────────────────────────────┘
                         │ ContextUsageData
                         ▼
        ┌──────────────────────────────────────────────┐
        │ RunCockpit（触发器外壳，始终渲染）              │
        │  - 迷你点阵(10格,1行,minCells=0) + 百分比文字   │
        │  - <ContextProvider usedTokens/maxTokens/usage/ │
        │     modelId> 包住 <Popover>                     │
        │  - usage→LanguageModelUsage 映射（给 Total cost）│
        └──────────────────────────────────────────────┘
                         │ 点击打开（懒加载）
                         ▼
        ┌──────────────────────────────────────────────┐
        │ RunCockpitPopoverContent（弹窗主体）           │
        │  上半：顶行(% + used/total)                     │
        │       + ContextDotMatrix(100格)                │
        │       + ContextBreakdownList(隐藏0值行)         │
        │  ── 分隔线 ──                                   │
        │  下半：本次运行(模型/默认/权限) ← useOverviewData │
        │       + 问题块                                  │
        │       + ContextContentFooter(Total cost,tokenlens)│
        └──────────────────────────────────────────────┘
```

数据来源链（窗口大小优先级）：`[1m] 运行时模型名（token_usage.model 带 "[1m]" 后缀 → 恒 1M，最高优先级，压过快照/SDK/账号/目录全部来源）` → `新鲜 snapshot 的 maxTokens` → `本条 baseline 记录自带的 SDK 窗口` → `walk 过程中见过的最新 SDK 窗口` → `账号下发 modelContextWindow` → `静态目录 getContextWindow`。

> `token_usage.model` 是本回合实际请求的模型名，与执行状态行 "Connected (…)" 括号里显示的同源（后端在 result usage 里携带，落库到消息 token_usage），**不是**模型下拉框的展示名 —— 同一模型两套名称，只有前者带 `[1m]` 标记（如 `claude-opus-4-7[1m]`）。判断入口：`is1mContextModelName`（model-context.ts）。

---

## 5. 核心算法（需精确复刻）

> 这一节的函数是整个特性的"心脏"，与框架无关，**建议逐字照抄**。

### 5.1 `buildContextUsageBreakdown`（核心拆分）

要点：
- `cacheTokens = cacheRead + cacheCreation`。
- `knownUsedNonConversation = system_prompt + tools + rules + skills + mcp + memory + cache`。
- **关键提升**：`usedTokens = max(reportedUsed, knownUsedNonConversation + outputTokens)`。原因：某些 provider 代理（Native/Codex 经 proxy）会把 `input_tokens` 报成 0，但 `entries` 里其实有真实的每轮 token；用 max 取"我们确知在上下文里的量"的下界。ClaudeCode 路径下 reportedUsed 已含全部，max 永远取较大者，无重复计数风险。
- **对话历史吸收残差**：`conversation = max(0, usedTokens - knownUsedNonConversation)`。当已知项之和 > used 时 conversation 钳到 0，此时 sum(parts) = knownParts > used（**故意不缩放**已知估算值，钳零即"编排器高估了"的信号）。
- pending 项（files_attachments + pending_next_turn）**不计入** usedTokens——它们描述"下一轮会加入什么"。
- `ratio` / `remainingTokens` 在窗口未知或 ≤0 时为 `undefined`。

```ts
export function buildContextUsageBreakdown(inputs: ContextBreakdownInputs): ContextUsageBreakdown {
  const { baseline, contextWindow, pending, compiler } = inputs;

  const reportedUsedTokens = Math.max(0, Math.floor(baseline?.used ?? 0));
  const outputTokens = Math.max(0, Math.floor(baseline?.outputTokens ?? 0));

  const systemPromptTokens = Math.max(0, compiler?.systemPromptTokens ?? 0);
  const toolsTokens  = Math.max(0, compiler?.toolDescriptorTokens ?? 0);
  const rulesTokens  = Math.max(0, compiler?.workspaceRuleTokens ?? 0);
  const skillsTokens = Math.max(0, compiler?.skillsHarnessTokens ?? 0);
  const mcpTokens    = Math.max(0, compiler?.mcpDescriptorTokens ?? 0);
  const memoryTokens = Math.max(0, compiler?.memoryTokens ?? 0);
  const cacheTokens  = Math.max(0,
    (baseline?.cacheReadTokens ?? 0) + (baseline?.cacheCreationTokens ?? 0));

  const knownUsedNonConversation =
    systemPromptTokens + toolsTokens + rulesTokens + skillsTokens + mcpTokens + memoryTokens + cacheTokens;

  const usedTokens = Math.max(reportedUsedTokens, knownUsedNonConversation + outputTokens);

  const validWindow = (typeof contextWindow === 'number' && contextWindow > 0) ? contextWindow : undefined;
  const ratio = validWindow !== undefined ? Math.min(1, Math.max(0, usedTokens / validWindow)) : undefined;
  const remainingTokens = validWindow !== undefined ? Math.max(0, validWindow - usedTokens) : undefined;

  const conversationTokens = Math.max(0, usedTokens - knownUsedNonConversation);

  const filesAttachmentsTokens = Math.max(0,
    (pending?.attachmentTokens ?? 0) + (pending?.mentionTokens ?? 0) + (pending?.directoryTokens ?? 0));
  const pendingNextTurnTokens = Math.max(0, pending?.composerTextTokens ?? 0);

  const tokensByKind: Record<ContextBreakdownKind, number> = {
    system_prompt: systemPromptTokens, tools: toolsTokens, rules: rulesTokens,
    skills: skillsTokens, mcp: mcpTokens, memory: memoryTokens,
    files_attachments: filesAttachmentsTokens, conversation: conversationTokens,
    pending_next_turn: pendingNextTurnTokens, cache_or_previous: cacheTokens,
  };
  // sourceByKind 是调试面包屑，可省略或填占位

  const parts = CONTEXT_BREAKDOWN_KIND_ORDER.map((kind) => ({
    kind, label: DEFAULT_LABELS[kind], tokens: tokensByKind[kind], source: /* ... */ '',
  }));

  return { usedTokens, contextWindow: validWindow, remainingTokens, ratio, parts };
}
```

### 5.2 `walkContextUsage`（从消息倒推 baseline）

两条非显然规则：
1. **跳过 output-only / 全零记录**：尾部记账记录有时是 `{input:0, cache:0, output:N}`，直接当 used=0 会把进度条清零（其实上一轮的 input+cache 还在上下文里）。倒着走，遇到 `used>0` 的记录立即作为"强 baseline"返回；遇到 `used==0 && output>0` 的记到"弱 baseline"备用。
2. **窗口字段始终权威**：即使要跳过的记录，其 `context_window` 也有效（SDK 每条结果都填）。捕获走查过程中见到的**第一个**（即最新）正值作为兜底——这让目录里没有的模型（GLM/Kimi/DeepSeek…）不至于"容量未知"。
3. `context_accounting` 同理：从**每条**记录捕获（最新优先），不只 baseline 记录——这样 Native/Codex（常 input=0）即便落到弱 baseline 也能带出快照。

```ts
export function walkContextUsage(messages) {
  let latestSdkContextWindow = null, latestContextAccounting = null, weakBaseline = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'assistant' || !msg.token_usage) continue;
    let usage; try { usage = typeof msg.token_usage === 'string' ? JSON.parse(msg.token_usage) : msg.token_usage; }
    catch { continue; }
    if (!usage || typeof usage !== 'object') continue;

    const inputTokens = usage.input_tokens || 0;
    const cacheRead = usage.cache_read_input_tokens || 0;
    const cacheCreation = usage.cache_creation_input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    const used = inputTokens + cacheRead + cacheCreation;

    const ctxWindowField = usage.context_window;
    if (latestSdkContextWindow === null && typeof ctxWindowField === 'number' && ctxWindowField > 0)
      latestSdkContextWindow = ctxWindowField;

    const accountingField = usage.context_accounting;
    if (latestContextAccounting === null && accountingField && typeof accountingField === 'object')
      latestContextAccounting = accountingField;

    const baselineSdkContextWindow = (typeof ctxWindowField === 'number' && ctxWindowField > 0) ? ctxWindowField : null;

    if (used === 0 && outputTokens === 0) continue; // 全空，跳过
    if (used > 0) {
      return { baseline: { used, cacheReadTokens: cacheRead, cacheCreationTokens: cacheCreation,
                           outputTokens, sdkContextWindow: baselineSdkContextWindow },
               latestSdkContextWindow, contextAccounting: latestContextAccounting };
    }
    if (!weakBaseline) weakBaseline = { used: 0, cacheReadTokens: cacheRead,
      cacheCreationTokens: cacheCreation, outputTokens, sdkContextWindow: baselineSdkContextWindow };
  }
  return { baseline: weakBaseline, latestSdkContextWindow, contextAccounting: latestContextAccounting };
}
```

### 5.3 `snapshotToCompilerInputs`（快照 → compiler 入参）

```ts
export function snapshotToCompilerInputs(snapshot) {
  if (!snapshot) return undefined;
  const get = (k) => snapshot.unsupported.includes(k) ? undefined : snapshot.entries[k]?.tokens;
  const result = {
    systemPromptTokens: get('system_prompt'),
    toolDescriptorTokens: get('tools'),
    workspaceRuleTokens: get('rules'),
    skillsHarnessTokens: get('skills'),
    mcpDescriptorTokens: get('mcp'),
    memoryTokens: get('memory'),
  };
  if (Object.values(result).every((v) => v === undefined)) return undefined; // 全空 → 无可合并
  return result;
}
```

### 5.4 `getContextWindow`（模型 → 窗口）

- 静态目录 `MODEL_CONTEXT_WINDOWS`（节选）：`sonnet/opus/haiku = 200000`，`claude-opus-4-7/4-8 = 1_000_000`，`claude-fable-5 = 1_000_000`，`glm-5-turbo = 202752`，`gpt-5.5/5.4 = 1_000_000` 等。
- 解析顺序：**先精确命中**，再按 key **长度从长到短**做子串匹配（让 `us.anthropic.claude-opus-4-7-v1:0` 命中 `claude-opus-4-7` 而不是更短的 `opus`）。
- 优先用 `upstream`（解析后的上游 id），它能消歧别名（first-party `opus`=4.7=1M，Bedrock/Vertex `opus`=4.6=200K）。
- `options.context1m === true` → 直接返回 `1_000_000`。
- 都没命中 → `null`（上层走"容量未知"，迷你条用 200K 兜底分母）。

### 5.5 dot-matrix 格子分配 `computeAllocations`

输入：`breakdown`、`cellCount`、`minCellsPerKind`（0 或 1）。输出：`{ cells: {kind,cells,isPending}[], emptyCells }`。

- **分母**决定一格代表多少 token：
  - 窗口已知 → `contextWindow`（1 格 = window/cellCount）。
  - 窗口未知 + `minCellsPerKind===1`（弹窗主条）→ `used + pendingTotal`（填满约 100%，靠"容量未知"表头说明）。
  - 窗口未知 + `minCellsPerKind===0`（迷你条）→ `max(used + pendingTotal, 200000)`（避免 3K 用量也填满，误读"爆了"）。
- `denominator <= 0` → 全空格返回。
- 每类原始格数 `raw = tokens/denominator*cellCount`；分配函数：`minCellsPerKind===1 ? Math.max(1, ceil(raw)) : Math.round(raw)`。
- **两趟**：先 `CONTEXT_BREAKDOWN_KIND_ORDER` 里的非 pending 类（稳定上色顺序），再 pending 类。
- 总数 > cellCount 时从尾部裁剪，丢掉裁成 0 的项，`emptyCells=0`。
- **迷你条兜底**：`minCellsPerKind===0` 且全部 round 成 0 但 `used>0` 时，给最大的非 pending 类补 1 格（否则"刚发消息条却空着"）。
- 返回 `emptyCells = cellCount - totalAllocated`（剩余容量，渲染成灰格）。

### 5.6 格式化 & 派生量（散落在多个文件，需一致）

```ts
// 紧凑 token：23900 → "23.9K"，1000000 → "1000K"，999 → "999"
function formatTokensCompact(n) {
  if (n >= 1000) { const k = n/1000; return (k>=100 ? k.toFixed(0) : k.toFixed(1).replace(/\.0$/,'')) + 'K'; }
  return String(n);
}
// 百分比：ratio<0.1 保留 1 位，否则 0 位 → 0.033 → "3.3%"，0.62 → "62%"
const pct = `${(ratio*100).toFixed(ratio < 0.1 ? 1 : 0)}%`;

// 派生
estimatedNextTurn = used + outputTokens + 200;      // +200 为新用户消息开销
effectiveRatio    = Math.max(ratio, estimatedNextRatio);
state = effectiveRatio >= 0.95 ? 'critical' : effectiveRatio >= 0.8 ? 'warning' : 'normal';

// 常量
SNAPSHOT_FRESHNESS_MS = 60_000;     // snapshot 新鲜窗口
FALLBACK_CONTEXT_WINDOW = 200_000;  // 迷你条窗口兜底
```

### 5.7 费用（`ContextContentFooter`，用 tokenlens）

```ts
import { getUsage } from 'tokenlens';
const costUSD = modelId
  ? getUsage({ modelId, usage: { input: usage?.inputTokens ?? 0, output: usage?.outputTokens ?? 0 } }).costUSD?.totalUSD
  : undefined;
const totalCost = new Intl.NumberFormat('en-US', { currency: 'USD', style: 'currency' }).format(costUSD ?? 0);
```

`RunCockpit` 把 `ContextUsageData` 映射成 `LanguageModelUsage` 喂给 Provider：
```ts
inputTokens = max(0, used - cacheRead - cacheCreation);
{ inputTokens,
  inputTokenDetails: { noCacheTokens: inputTokens, cacheReadTokens, cacheWriteTokens: cacheCreation },
  outputTokens, outputTokenDetails: { textTokens: outputTokens, reasoningTokens: undefined },
  totalTokens: used + outputTokens, cachedInputTokens: cacheReadTokens }
// modelId = upstreamModelId ?? modelName
```

---

## 6. 组件逐个说明（props + 渲染结构）

### 6.1 `ContextProvider`（context-core.tsx）
- props = `ContextSchema`（§3.6）+ children。`useMemo` 包一层放进 `ContextContext.Provider`。
- `useContextValue()` 读取，不在 Provider 内使用则 throw。
- 存在意义：让重组件 `ContextContentFooter` 通过同一个 React Context 拿到 `usage/modelId`，又不把 `tokenlens/HoverCard/Progress` 拉进触发器首屏。

### 6.2 `ContextContentFooter`（context.tsx）
- 从 `useContextValue()` 取 `modelId/usage`，按 §5.7 算钱。
- 渲染：`<div className="flex w-full items-center justify-between gap-3 bg-secondary p-3 text-xs">` → `<span className="text-muted-foreground">Total cost</span>` + `<span>{totalCost}</span>`。
- 卡片里调用时传 `className="!p-0 bg-transparent"` 覆盖掉默认 padding 和底色。
- ⚠️ "Total cost" 是**硬编码英文**。要本地化就把它换成 i18n key。
- （同文件还有 `ContextContentHeader/Body`、`ContextInput/Output/Reasoning/CacheUsage`——本卡片**没用**，可不移植。）

### 6.3 `ContextDotMatrix`（ContextDotMatrix.tsx）
```ts
interface ContextDotMatrixProps {
  breakdown: ContextUsageBreakdown;
  cellCount?: number;        // 默认 100
  rows?: number;             // 默认 2（→ 50 列 × 2 行，列优先填充）
  minCellsPerKind?: 0 | 1;   // 默认 1（弹窗）；触发器传 0
  className?: string;
}
```
- 调 `computeAllocations`，`allocations.length===0 && emptyCells===0` 时返回 `null`。
- 容器：`<div aria-hidden className="grid gap-px" style={{ gridTemplateRows:`repeat(${rows},minmax(0,1fr))`, gridAutoFlow:'column', gridAutoColumns:'minmax(0,1fr)' }}>`（**列优先**：先填第一列的 row1/row2 再到第二列）。
- 上色格：`<span className="aspect-square rounded-[2px]" style={{ backgroundColor: var(--context-dot-{kebab-kind}) }}>`。
- pending 格：`className+="border border-dashed border-muted-foreground bg-transparent"`，无背景色。
- 空格：`<span className="aspect-square rounded-[2px] bg-muted/60">`。
- `dotVar(kind) = var(--context-dot-${kind.replace(/_/g,'-')})`。

### 6.4 `ContextBreakdownList`（ContextBreakdownList.tsx）
```ts
interface ContextBreakdownListProps { breakdown; hideZero?: boolean /*默认 true*/; className?; }
```
- `hideZero` → 只渲染 `tokens > 0` 的项；全为 0 → 返回 `null`。
- `LABEL_KEY`：kind → `runStatus.breakdown*` i18n key（**不要**直接渲染 `part.label`，那是中文 fallback）。
- 列表：`<ul className="flex flex-col gap-1.5 text-xs">`。
- 每行：`<li className="flex items-center justify-between gap-3">`（pending 行加 `text-muted-foreground`）。
  - 左：`<span className="flex min-w-0 items-center gap-2">` → 色点 `<span className="inline-block size-2.5 rounded-[2px] shrink-0" style={背景色}>`（pending 用虚线点）+ `<span className="truncate">{t(LABEL_KEY[kind])}</span>`。
  - 右：`<span className="font-mono shrink-0 tabular-nums">{formatTokens(tokens)}</span>`。

### 6.5 `RunCockpit`（RunCockpit.tsx，触发器外壳）
```ts
interface RunCockpitProps {
  providerId?: string; messages?: Message[]; modelName?: string;
  context1m?: boolean; hasSummary?: boolean; upstreamModelId?: string;
  contextUsageSnapshot?: { totalTokens; maxTokens; capturedAt };
  permissionProfile?: 'default' | 'full_access';
  pendingContextTokens?: number;                    // 触发器上 "+10K 待加" 后缀
  pendingContextSubTotals?: { attachment; mention; directory };
  sessionRuntimePin?: string;
}
```
- 调 `useContextUsage(messages, modelName, { context1m, hasSummary, upstreamModelId, snapshot, pending })`。
- `hasFullCtx = usage.hasData && (usage.contextWindow ?? 0) > 0`。
- `ratioText`：full → `"3.3%"+pendingSuffix`；有数据无窗口 → `"33.1K"+pendingSuffix`；仅 pending → `"+10K"`；否则 `"—"`。
- 触发器按钮：
  ```tsx
  <Button variant="ghost" size="xs"
    className="h-7 gap-1.5 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors"
    aria-label={t('runStatus.triggerLabel')}>
    <ContextDotMatrix breakdown={usage.breakdown} cellCount={10} rows={1} minCellsPerKind={0} className="w-[44px] shrink-0" />
    <span className="truncate">{ratioText}</span>
  </Button>
  ```
- `hasFullCtx` 时用 `<ContextProvider usedTokens maxTokens={contextWindow!} usage={lmUsage} modelId={upstream??modelName}>` 包住 Popover；否则不包。
- Popover：`<Popover><PopoverTrigger asChild>{button}</PopoverTrigger><PopoverContent side="top" align="end" className="w-80 overflow-hidden p-3">{lazyContent}</PopoverContent></Popover>`。
- 懒加载：`const RunCockpitPopoverContent = dynamic(() => import('./RunCockpitPopoverContent').then(m => ({default:m.RunCockpitPopoverContent})), { ssr:false })`。

### 6.6 `RunCockpitPopoverContent`（RunCockpitPopoverContent.tsx，弹窗主体）
```ts
interface RunCockpitPopoverContentProps {
  providerId?: string; modelName?: string; upstreamModelId?: string;
  permissionProfile: 'default' | 'full_access';
  sessionRuntimePin?: string; pendingSuffix: string;
  hasFullCtx: boolean; usage: ContextUsageData;
}
```
- 读 `useOverviewData()`（模型标签、默认模式、问题判定）、`useClaudeStatus()`（CLI 警告）、`useRouter()`（跳设置）。
- `state.loading` → 渲染 `runStatus.loading` 占位。
- 模型标签：用 `providerId` 在 `state.providers` 里找组 → `findModelOption(group.models, modelName)` 取友好 label；缺则回退原始 id/`未配置`。
- `defaultModeValue`：session pin → 自动；pinned 且 invalid → modePinnedInvalid；pinned → modePinned；否则 modeAuto。
- `auxRows`（本次运行）结构：
  ```tsx
  <div className="flex flex-col gap-2 text-xs">
    <div className="text-sm font-medium text-foreground">{t('runStatus.title')}</div>
    {/* 模型行 */}
    <div className="group/row flex items-baseline gap-3">
      <span className="shrink-0 text-muted-foreground">{t('runStatus.model')}</span>
      <span className="min-w-0 flex-1 truncate text-right text-foreground">{`${providerLabel} · ${modelLabel}`}</span>
      <button onClick={()=>router.push('/settings/models')} className="shrink-0 ... text-[11px] ...">{t('runStatus.switch')}<ExternalIcon/></button>
    </div>
    {/* 默认行：label=defaultMode, value=defaultModeValue(invalid 时标 warning 色), 按钮=modify → /settings/models */}
    {/* 权限行：label=permission, value= full_access?permissionFullAccess(标红):permissionDefault, 无按钮 */}
  </div>
  ```
- 三个渲染分支见 [§10](#10-分支与状态机)。`hasFullCtx` 分支输出：
  ```tsx
  <>
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3 text-xs">
          <p>{headerPercentText}</p>
          <p className="font-mono text-muted-foreground">{headerTokensText}</p>
        </div>
      </div>
      <div className="space-y-3">
        <ContextDotMatrix breakdown={usage.breakdown} />
        <ContextBreakdownList breakdown={usage.breakdown} />
      </div>
    </div>
    <div className="-mx-3 my-2 border-t border-border" />
    <div className="space-y-3">
      {auxRows}
      {issuesBlock}
      <ContextContentFooter className="!p-0 bg-transparent" />
    </div>
  </>
  ```
  其中 `headerPercentText = contextWindow>0 ? `${(ratio*100).toFixed(ratio<0.1?1:0)}%` : ''`，`headerTokensText = `${formatTokensCompact(used)} / ${formatTokensCompact(contextWindow??0)}``。

> 注意 divider 的 `-mx-3` 依赖 `PopoverContent` 外层的 `p-3`——两者必须配套，否则负边距会"漏"到弹窗外遮住正文（源项目踩过这个 bug）。

---

## 7. 样式规范（配色 + 布局）

### 7.1 CSS 变量配色（`globals.css`，亮暗同色）
低彩度 OKLCH，亮度 0.55–0.80，亮暗主题共用。变量名用 **kebab-case**（与 `kind.replace(/_/g,'-')` 对应）。

```css
:root {
  --context-dot-system-prompt:    oklch(0.62 0.04 252);
  --context-dot-tools:            oklch(0.62 0.08 288); /* 紫 */
  --context-dot-rules:            oklch(0.66 0.08 144); /* 绿 */
  --context-dot-skills:           oklch(0.72 0.10 80);
  --context-dot-mcp:              oklch(0.66 0.10 0);
  --context-dot-memory:           oklch(0.66 0.08 200);
  --context-dot-files-attachments:oklch(0.68 0.10 40);
  --context-dot-conversation:     oklch(0.55 0.07 70);  /* 最大类，暖棕锚点 */
  --context-dot-pending-next-turn:oklch(0.70 0.02 0);   /* 实际不消费（pending 用虚线） */
  --context-dot-cache-or-previous:oklch(0.78 0.05 220); /* 冷蓝灰 */
}
```

### 7.2 关键 Tailwind 类速查
| 元素 | 类 |
|---|---|
| 弹窗容器 | `w-80 overflow-hidden p-3`；`side="top" align="end"` |
| 触发器按钮 | `h-7 gap-1.5 rounded-md px-2 text-[11px] font-medium text-muted-foreground transition-colors`（ghost/xs） |
| 迷你点阵 | `cellCount=10 rows=1 minCellsPerKind=0`，容器 `w-[44px] shrink-0` |
| 点阵容器 | `grid gap-px` + inline style：`gridTemplateRows:repeat(rows,minmax(0,1fr)); gridAutoFlow:column; gridAutoColumns:minmax(0,1fr)` |
| 点阵格子 | `aspect-square rounded-[2px]`；pending：`border border-dashed border-muted-foreground bg-transparent`；空：`bg-muted/60` |
| 顶行 | `flex items-center justify-between gap-3 text-xs`；右侧 token `font-mono text-muted-foreground` |
| 明细列表 | `flex flex-col gap-1.5 text-xs`；行 `flex items-center justify-between gap-3` |
| 明细色点 | `inline-block size-2.5 rounded-[2px] shrink-0` |
| 明细数值 | `font-mono shrink-0 tabular-nums` |
| 分隔线 | `-mx-3 my-2 border-t border-border` |
| 本次运行标题 | `text-sm font-medium text-foreground` |
| 本次运行行 | `flex items-baseline gap-3`；label `shrink-0 text-muted-foreground`；value `min-w-0 flex-1 truncate text-right` |
| 切换/修改按钮 | `shrink-0 inline-flex items-center gap-0.5 text-[11px] text-muted-foreground/40 group-hover/row:text-muted-foreground hover:!text-foreground` |
| 权限=完全访问 | value 加 `text-status-error-foreground` |
| 默认=pinned 失效 | value 加 `text-status-warning-foreground` |
| Total cost 页脚 | 卡片内 `!p-0 bg-transparent`；标签 `text-muted-foreground` |

> 用到的非标准色 token：`--muted/--muted-foreground/--secondary/--border/--foreground`、`--status-error-foreground`、`--status-warning-foreground`（shadcn 风格设计变量，宿主项目需有等价物）。

---

## 8. i18n 文案表

弹窗用到的 `runStatus.*`（标 ⭐ 的是卡片直接渲染的）：

| key | 中文 | English |
|---|---|---|
| ⭐ `runStatus.title` | 本次运行 | This run |
| ⭐ `runStatus.model` | 模型 | Model |
| ⭐ `runStatus.defaultMode` | 默认 | Default |
| ⭐ `runStatus.permission` | 权限 | Permission |
| ⭐ `runStatus.switch` | 切换 | Switch |
| ⭐ `runStatus.modify` | 修改 | Modify |
| ⭐ `runStatus.modeAuto` | 自动 | Auto |
| `runStatus.modePinned` | 已固定 | Pinned |
| `runStatus.modePinnedInvalid` | （走 RuntimePanel 文案/警告色） | Pinned unavailable |
| ⭐ `runStatus.permissionDefault` | 默认权限 | Default permissions |
| ⭐ `runStatus.permissionFullAccess` | 完全访问 | Full access |
| `runStatus.triggerLabel` | 查看本次运行状态 | View this run |
| `runStatus.loading` | （加载中占位） | Loading run status... |
| `runStatus.notConfigured` | 未配置 | Not configured |
| `runStatus.contextCapacityUnknown` | 容量未知 | Capacity unknown |
| `runStatus.fixIssue` | 前往修复 | Fix |
| `runStatus.issuesHeader` | 需要处理 | Needs attention |
| ⭐ `runStatus.breakdownSystemPrompt` | 系统提示 | System prompt |
| ⭐ `runStatus.breakdownTools` | 工具 | Tools |
| ⭐ `runStatus.breakdownRules` | 规则 | Rules |
| ⭐ `runStatus.breakdownSkills` | Skills | Skills |
| ⭐ `runStatus.breakdownMcp` | MCP | MCP |
| ⭐ `runStatus.breakdownMemory` | Memory | Memory |
| ⭐ `runStatus.breakdownFilesAttachments` | 文件与附件 | Files & attachments |
| ⭐ `runStatus.breakdownConversation` | 对话历史 | Conversation |
| ⭐ `runStatus.breakdownPendingNextTurn` | 本次待加入 | Pending next turn |
| ⭐ `runStatus.breakdownCacheOrPrevious` | 缓存 / 上轮 | Cache / previous |

> 语言判定源项目用 `const isZh = t('nav.chats') === '对话'` 这种 hack；你的项目按自己的 i18n 体系来即可。
> **"Total cost"** 未进 i18n（硬编码），要本地化自行补 key。

---

## 9. 交互逻辑

1. **打开/关闭**：Radix `Popover`，点击触发器开关。`side="top" align="end"` → 从右下角向上、右对齐弹出。
2. **悬停反馈**：本次运行的"模型/默认"行用 `group/row` + `group-hover/row:`，「切换/修改」按钮默认极淡（`text-muted-foreground/40`），悬停行时变亮、悬停按钮本身变 `foreground`。
3. **懒加载**：首次打开才下载并挂载弹窗 chunk（`next/dynamic ssr:false` + Radix 仅 open 时挂子树）。触发器本身不依赖重数据，首屏零成本。
4. **跳转**：
   - 「切换」/「模型行」→ `router.push('/settings/models')`。
   - 「修改」/「默认行」→ `router.push('/settings/models')`。
   - 问题项「前往修复」→ 按问题类型跳 `/settings/providers | /settings/models | /settings/runtime`。
5. **触发器后缀**：输入框挂了 @ 提及/附件时，`pendingContextTokens>0` → 触发器显示 `+10K`（`formatTokensCompact`）。发送后清零。
6. **权限/默认的视觉告警**：`full_access` 权限值标红；pinned 失效的默认值标黄。
7. **会话级 pin 抑制全局信号**：当用户在输入框给本会话固定了运行时（`sessionRuntimePin`），弹窗里关于"全局默认失效 / 运行时降级"的提示被抑制（因为用户已显式脱离全局默认）。
8. **数值刷新**：`useContextUsage` 是 `useMemo`，依赖 `messages/modelName/context1m/hasSummary/upstreamModelId/snapshot/pending`；每次新 assistant 消息带回 `token_usage` 后自动重算。

---

## 10. 分支与状态机

`RunCockpitPopoverContent` 三个渲染分支：

| 条件 | 表头 | 点阵+明细 | 本次运行 | 备注 |
|---|---|---|---|---|
| **A. hasFullCtx** = `hasData && contextWindow>0` | `% + used/total` | ✅ | ✅ + Total cost | 截图就是这个分支 |
| **B. 容量未知** = `hasData && !hasFullCtx` | `容量未知 + used(+pending)` | ✅（分母用 used+pending 或 200K 兜底） | ✅（无 Total cost） | 目录没收录、SDK 也没报窗口的模型 |
| **C. 无数据** = `!hasData` | 无 | 无 | ✅ 仅本次运行 + 问题块 | 首条消息发出前 |
| **loading** | — | — | — | 渲染 `runStatus.loading` 占位 |

`useContextUsage` 内部三条数据路径（`source` 字段）：
- `snapshot`：有 `<60s` 的 SDK 权威快照 → 直接用 `totalTokens/maxTokens`，不走 walk。
- `result_usage`：walk 出 baseline（主路径）。
- `none`：无 baseline，但可能仍带窗口（用于显示容量但 `hasData=false`）。

`state`（告警等级，源项目里给上方 RunCheckpoint 用，卡片本身不强依赖）：`effectiveRatio≥0.95 critical / ≥0.8 warning / else normal`。

---

## 11. 集成点（宿主项目要提供什么）

### 11.1 挂载（`ChatView.tsx`）
```tsx
<RunCockpit
  providerId={currentProviderId}
  messages={messages}                         // 每条 assistant 带 token_usage(JSON)
  modelName={currentModel}
  context1m={context1m}
  hasSummary={hasSummary}
  upstreamModelId={currentModelUpstream}       // 来自 /api/providers/models 每个模型的 upstreamModelId
  contextUsageSnapshot={streamSnapshot?.contextUsageSnapshot}
  permissionProfile={permissionProfile}        // 'default' | 'full_access'
  pendingContextTokens={pendingContextTokens}  // 输入框预估总量
  pendingContextSubTotals={pendingContextSubTotals} // {attachment,mention,directory}
  sessionRuntimePin={runtimePin}
/>
```

### 11.2 宿主必须保证
1. **消息持久化用量**：发送完成后把 API 返回的用量写进该 assistant 消息的 `token_usage`（JSON，含 `input_tokens/output_tokens/cache_*`，最好含 `context_window`）。**这是进度条/百分比的根**。
2. **（可选但推荐）运行时记账**：在发送链路产出 `RuntimeContextAccountingSnapshot` 写入 `token_usage.context_accounting`——这才能让"工具/规则/Skills/MCP/Memory/系统提示"显示真实非零值。算不出就别写（或 `unsupported` 标注），UI 自动隐藏。
3. **模型→窗口**：维护 `MODEL_CONTEXT_WINDOWS` 目录；拿不到就靠 SDK 的 `context_window` 或 200K 兜底。
4. **模型标签解析**：`useOverviewData().providers`（来自 `/api/providers/models`）+ `findModelOption` 把 id 转友好名。最小实现可直接显示 `modelName`。
5. **设置页路由**：`/settings/models`（切换/修改）、`/settings/providers`、`/settings/runtime`（问题修复）。没有就改成你项目的对应入口。

### 11.3 `useOverviewData` 依赖的接口（弹窗下半部分）
- `GET /api/settings/app` → `agent_runtime` + `cli_enabled`
- `GET /api/providers/models?runtime=auto` → 运行时过滤后的 groups + `default_provider_id` + `runtime_applied`
- `GET /api/providers/models` → 全量 groups（模型标签解析、计数）
- `GET /api/providers/options?providerId=__global__` → 默认模式（auto/pinned）+ pinned provider/model
- `GET /api/settings/workspace` / `GET /api/workspace/summary` → 工作区状态
- 监听 `window` 上的 `provider-changed` 事件触发重取

> 这些是 CodePilot 特有的多服务商/运行时体系。**若你的项目只有单一模型/无设置页**，整个"本次运行 + 问题块"下半部分可大幅简化甚至删掉（见 §13）。

---

## 12. 依赖

- **运行时无关纯逻辑**：无外部依赖（`context-breakdown` / `context-usage-walk` / `context-accounting` / dot-matrix 算法 / `model-context`）。
- `tokenlens`（`^1.3.1`）：`getUsage({modelId, usage})` 算费用。不要 Total cost 可删。
- `ai`：仅用其 `LanguageModelUsage` 类型（可自定义等价类型替代）。
- **UI**：Radix `Popover`（经 shadcn 封装的 `@/components/ui/popover`）、shadcn `Button`。换成你项目的 popover/button 即可。
- `next/dynamic` + `next/navigation`（`useRouter`）：换框架时用对应的懒加载和路由。
- Tailwind + 一套设计 token（`muted/secondary/border/foreground/status-*`）。

---

## 13. 移植清单 / 最小可用版本

按"先跑起来→再增强"顺序：

**Tier 0 — 纯逻辑（直接抄，零改动）**
- [ ] `context-breakdown.ts`（§5.1 + §3.1/3.2 类型）
- [ ] `context-usage-walk.ts`（§5.2）
- [ ] `model-context.ts`（§5.4，按你支持的模型改目录）
- [ ] `context-accounting.ts` 的 `snapshotToCompilerInputs`（§5.3）；没有运行时记账就跳过，`compiler` 传 `undefined`

**Tier 1 — 最小卡片（能看到进度条+明细+费用）**
- [ ] CSS 变量配色（§7.1）
- [ ] `ContextDotMatrix`（§6.3 + §5.5）
- [ ] `ContextBreakdownList`（§6.4）+ `runStatus.breakdown*` 文案
- [ ] `useContextUsage`（§3.5 + 数据流 §4）
- [ ] 触发器 + Radix Popover + 顶行（%、used/total）。**本次运行下半部分可先省略**
- [ ] 宿主：发送后把用量写进 `message.token_usage`

此时即可显示：百分比、点阵、对话历史+缓存两行（compiler 没接线时其余为 0 隐藏）、（可选）Total cost。

**Tier 2 — "本次运行"区**
- [ ] 模型/默认/权限三行（§6.6 auxRows）。最小实现：模型行直接显示 `modelName`，去掉切换/修改按钮
- [ ] `ContextContentFooter` + `tokenlens`（Total cost）

**Tier 3 — 完整（多服务商/运行时/问题块）**
- [ ] `useOverviewData` + 那一组 `/api/...` 接口
- [ ] `findModelOption` 友好标签、`runtime/effective` 运行时解析、问题块 + 跳转、session pin 抑制
- [ ] 运行时记账契约（§3.3）端到端：让工具/规则/Skills/MCP 显示真实值
- [ ] SDK 权威 snapshot 快路径（§10）

> 真正的"灵魂"是 Tier 0 + Tier 1。Tier 2/3 都是围绕 CodePilot 多引擎体系的增强，可按需裁剪。

---

## 14. 不变量与边界情况

1. **parts 恒 10 项**，顺序固定（`CONTEXT_BREAKDOWN_KIND_ORDER`）——点阵上色顺序、明细行顺序都依赖它。
2. **加法自洽**：已知项 ≤ used 时，sum(非 pending parts) === usedTokens（conversation 吸收残差）；已知项 > used 时 conversation 钳 0，sum = 已知项之和 > used（故意不缩放，钳零作为"高估"信号）。
3. **pending 不入 used**：`files_attachments` / `pending_next_turn` 永远不计入 usedTokens / ratio。
4. **窗口未知**：`ratio`/`remainingTokens` 为 `undefined`；弹窗走"容量未知"分支；迷你条用 200K 兜底分母（避免误显示 100%）。
5. **output-only 记录**：walk 跳过 used=0 的尾部记录选 baseline，但**保留**其 `context_window` 与 `context_accounting`。
6. **provider 代理报 input=0**：`usedTokens = max(reported, knownNonConversation + output)` 防止整条弹窗空白。
7. **snapshot 新鲜度**：`Date.now() - capturedAt < 60s` 才走快路径；过期回退估算并翻转 `source`。
8. **隐藏 0 值行**：明细默认 `hideZero`，所以常见只 4 行；这是预期，不是 bug。
9. **迷你条不空**：`minCellsPerKind=0` 且全 round 成 0 但 used>0 时，最大类补 1 格。
10. **divider 负边距依赖外层 p-3**：`PopoverContent` 必须 `p-3`，否则 `-mx-3` 漏到弹窗外遮正文。
11. **i18n 边界**：明细标签走 `runStatus.breakdown*`，**不要**渲染 `part.label`（那是中文 fallback，会把中文混进英文 UI）。
12. **费用 0**：`modelId` 未知或 tokenlens 无价 → `$0.00`（不是报错）。

---

### 附：源文件索引（CodePilot 路径，便于对照原实现）

```
src/lib/context-breakdown.ts                                  §3.1-3.2 §5.1
src/lib/context-usage-walk.ts                                 §5.2
src/lib/harness/context-accounting.ts                        §5.3
src/lib/model-context.ts                                      §5.4
src/hooks/useContextUsage.ts                                  §3.5 §4
src/components/ai-elements/context-core.tsx                  §6.1
src/components/ai-elements/context.tsx (ContextContentFooter) §6.2 §5.7
src/components/chat/context-breakdown/ContextDotMatrix.tsx    §6.3 §5.5
src/components/chat/context-breakdown/ContextBreakdownList.tsx §6.4
src/components/chat/RunCockpit.tsx                            §6.5
src/components/chat/RunCockpitPopoverContent.tsx             §6.6 §10
src/components/settings/useOverviewData.ts                   §11.3
src/lib/runtime/effective.ts                                 §11
src/lib/model-option-match.ts                                §6.6
src/app/globals.css (--context-dot-*)                        §7.1
src/i18n/{zh,en}.ts (runStatus.*)                            §8
src/types/index.ts (TokenUsage / RuntimeContextAccountingSnapshot / ...) §3.3-3.4
src/components/chat/ChatView.tsx (挂载)                        §11.1
src/components/chat/ContextUsageIndicator.tsx (旧版,勿移植)    §2.1
```

### 附：行为锁定单测（复刻后照抄可验证忠实度）

源项目这些 unit test 锁定了上面的算法与不变量，移植时建议一并搬过去当回归基线：

| 测试 | 锁定什么 |
|---|---|
| `context-breakdown.test.ts` | `buildContextUsageBreakdown` 拆分、残差吸收、钳零、pending 不入 used（§5.1 §14） |
| `context-usage-walk.test.ts` | 倒走选 baseline、窗口/快照捕获（§5.2） |
| `use-context-usage-output-only-skip.test.ts` | output-only 记录跳过规则（§14.5） |
| `context-dot-matrix.test.ts` | `computeAllocations` 分母/分配/裁剪/迷你条兜底（§5.5） |
| `context-breakdown-list-i18n.test.ts` | 明细标签走 i18n 而非 `part.label`（§14.11） |
| `model-context.test.ts` | `getContextWindow` 精确+子串解析、1m 开关（§5.4） |
| `extract-token-usage-context-window.test.ts` | 从 SDK 结果提取 `context_window`（§3.4） |
| `run-cockpit-unknown-capacity.test.ts` | 容量未知分支（§10 分支 B） |
| `context-accounting.test.ts` | 快照 → compiler 入参映射、unsupported 隐藏（§5.3 §3.3） |
| `chat-static-graph.test.ts` | 触发器不静态拉入弹窗重依赖（§2 架构关键） |
