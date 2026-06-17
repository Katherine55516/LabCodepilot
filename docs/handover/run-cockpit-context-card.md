# RunCockpit 上下文用量卡片 — 技术交接

> 产品思考见 [docs/insights/run-cockpit-context-card.md](../insights/run-cockpit-context-card.md)
> 相关：上下文压缩逻辑见 [context-management.md](./context-management.md)（本卡片是其用量的**可视化展示层**，不负责压缩）

## 概述

对话框右下角（`ChatComposerActionBar` 的 `right` 槽）的"本次运行"控件。折叠态是**迷你点阵 + 百分比**触发器，点击向上弹出一张卡片：

- **上半（上下文用量）**：顶行 `百分比 + 已用/总量` → 彩色点阵进度条（2 行 × 50 列）→ 明细列表（每类一行：色点 + 名称 + token 数）
- **下半（本次运行）**：`本次运行`标题 → 模型行（`服务商 · 模型` + 切换↗）→ 默认行（自动/已固定 + 修改↗）→ 权限行（默认权限 / 完全访问标红）→ 本次花费

> 本控件取代了旧的"百分比圆环"`ContextUsageIndicator.tsx`（已删除）。

## 文件清单

### 纯逻辑层（无 React，已被单测锁定）
| 文件 | 职责 |
|---|---|
| `src/lib/context-breakdown.ts` | **核心**。`buildContextUsageBreakdown` 把总用量拆成 10 类；枚举/顺序/默认标签/类型；`formatTokensCompact` / `formatContextPercent` 格式化（全局须一致） |
| `src/lib/context-usage-walk.ts` | `walkContextUsage` 从消息倒着走，解析 baseline（used/cache/output）、最新 SDK 窗口、最新 `cost_usd`、`context_accounting`（预留） |
| `src/lib/context-dot-allocations.ts` | `computeAllocations` 点阵格子分配算法（分母选择、两趟分配、裁剪、迷你条兜底） |
| `src/lib/model-option-match.ts` | `findModelOption` 把模型 id 映射回友好 label |

### 组件 / Hook
| 文件 | 职责 |
|---|---|
| `src/hooks/useContextUsage.ts` | **数据编排**。拼合 walk + buildContextUsageBreakdown，输出 `ContextUsageData`（含 `breakdown` / `costUsd`）。保留 snapshot 快路径 |
| `src/hooks/useOverviewData.ts` | 精简版聚合：fetch `/api/providers/models`（模型标签）+ `/api/providers/options?providerId=__global__`（默认模式）。监听 `provider-changed` 重取 |
| `src/components/chat/RunCockpit.tsx` | 触发器外壳（始终渲染）：迷你点阵 + 百分比 + Radix `Popover`，`next/dynamic` 懒加载弹窗 |
| `src/components/chat/RunCockpitPopoverContent.tsx` | 弹窗主体（懒加载）：三分支渲染 + 本次运行 + Total cost |
| `src/components/chat/context-breakdown/ContextDotMatrix.tsx` | 点阵渲染（列优先 grid），调 `computeAllocations` |
| `src/components/chat/context-breakdown/ContextBreakdownList.tsx` | 明细列表，`hideZero` 默认隐藏 0 值行，标签走 `runStatus.breakdown*` i18n |
| `src/components/ui/popover.tsx` | shadcn 风格 Popover（用 `radix-ui` 聚合包，仿 `hover-card.tsx`） |

### 改动
- `src/types/index.ts` — `TokenUsage` 加可选 `context_window?: number`
- `src/app/globals.css` — `:root` 加 10 个 `--context-dot-*` OKLCH 变量（亮暗共用，靠继承）
- `src/i18n/{en,zh,zh-HK}.ts` — 新增 `runStatus.*` 文案（三语必须同步，否则 `Record<Locale, Record<TranslationKey,string>>` 类型检查失败）
- `src/components/chat/ChatView.tsx` — 解析 `currentModelContextWindow`、挂载 `<RunCockpit>` 到 `ChatComposerActionBar` 的 `right`

### 单测（`src/__tests__/unit/`）
`context-breakdown.test.ts` / `context-dot-matrix.test.ts` / `context-usage-walk.test.ts` — 锁定拆分/残差吸收/钳零/pending、分配/裁剪/兜底、倒走/跳过/捕获。

## 数据流

```
ChatView: messages[]（每条 assistant 带 token_usage JSON）
         + modelName / upstreamModelId / modelContextWindow（来自 /api/providers/models）
         + context1m / hasSummary / permissionProfile / contextUsageSnapshot
              │
              ▼
useContextUsage(messages, modelName, opts)
  1) catalogWindow = getContextWindow(modelName, {context1m, upstream})
  2) walk = walkContextUsage(messages) → baseline / latestSdkWindow / latestCostUsd
  3) 窗口优先级：snapshot.maxTokens(fresh) → baseline.sdkContextWindow
        → walk.latestSdkContextWindow → modelContextWindow → catalogWindow → null
  4) breakdown = buildContextUsageBreakdown({baseline, contextWindow, compiler: undefined})
  5) 输出 ContextUsageData（used / ratio / breakdown / costUsd / hasData …）
              │ ContextUsageData
              ▼
RunCockpit（触发器，始终渲染） ── 点击 ──▶ RunCockpitPopoverContent（懒加载）
  迷你点阵(10格,minCells=0)+%                上半(%+点阵+明细) + 下半(本次运行 + Total cost)
```

## 核心算法要点（详见各文件头注释 / 源规格 `docs/run-cockpit-context-card-spec.md`）

- **`buildContextUsageBreakdown`**：`usedTokens = max(reportedUsed, knownNonConversation + output)`（防 proxy 报 input=0 时卡片空白）；`conversation = max(0, used - known)` 吸收残差，known>used 时钳 0 不缩放；pending（files_attachments + pending_next_turn）**不计入** used。
- **`computeAllocations`**：分母 = 窗口已知用窗口，否则 `used+pending`（弹窗）或 `max(used+pending, 200K)`（迷你条）；两趟（非 pending 按 ORDER → pending）；超 cellCount 从尾部裁剪；迷你条全 round 成 0 但 used>0 时给最大类补 1 格。
- **`walkContextUsage`**：倒走，遇 `used>0` 立即作强 baseline；`used==0 && output>0` 记弱 baseline；全空跳过；窗口/cost/accounting 始终捕获最新（即使跳过的记录）。

## 三个渲染分支（`RunCockpitPopoverContent`）

| 条件 | 表头 | 点阵+明细 | 本次运行 + Total cost |
|---|---|---|---|
| **A. hasFullCtx** = `hasData && window>0` | `% + used/total` | ✅ | ✅ |
| **B. 容量未知** = `hasData && !window` | `容量未知 + used/—` | ✅（分母用 used 填满） | ✅ |
| **C. 无数据** = `!hasData` | 无 | 无 | ✅ 仅本次运行 |

## 本项目适配（与源规格的关键差异）

1. **Total cost 用 `cost_usd`（SDK 真实值）而非 tokenlens** → 不引入 tokenlens，省去源规格的 `context-core.tsx` / `context.tsx` 整层 `ContextProvider`。
2. **后端无运行时记账（`context_accounting`）** → `buildContextUsageBreakdown` 的 `compiler` 入参恒传 `undefined`，故工具/规则/MCP/Skills/Memory/系统提示等行 token 为 0 **自动隐藏**，常见只显示「对话历史 + 缓存/上轮」两行。这是预期，不是 bug。
3. **窗口优先用 `/api/providers/models` 的 `contextWindow`**（账号下发，最权威），由 ChatView 在解析 upstream 时顺带取出传入。

## 未来扩展点

- 后端若能在发送链路产出 `RuntimeContextAccountingSnapshot` 并写入 `token_usage.context_accounting`，则：① `walkContextUsage` 已捕获该字段；② 实现一个 `snapshotToCompilerInputs` 把它映射成 `ContextBreakdownCompiler` 喂给 `useContextUsage` 第 4 步——工具/规则/MCP 等行即自动点亮，无需改 UI。
- 输入框 pending 预估（@提及/附件 token）：`ContextBreakdownPending` 入参已预留，接通后触发器可显示 `+10K` 后缀。

## 验证

- `npm run test`（typecheck + 1437 单测）全绿。
- CDP（mock 数据）验证三分支渲染、迷你点阵配色、Popover 弹出/关闭、`full_access` 权限标红、console 无报错。本地无登录体系，结论基于 mock 数据验证渲染与分支逻辑正确性。
