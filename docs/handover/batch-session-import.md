# 批量会话导入（多选 + 全选）

> 产品思考见 [docs/insights/batch-session-import.md](../insights/batch-session-import.md)

给"从 Claude Code 导入"对话框加上多选、全选、一次性批量导入；保留原有的单条"导入即跳转"快捷路径。

## 概述

`ImportSessionDialog` 原本每行一个"导入"按钮，点击即调单条 API 导入并跳转到新会话。本次叠加多选能力：行首三态 checkbox、搜索框下方全选栏、底部"导入选中 (N)"操作条，配套新增批量 endpoint。

## 数据流

```
ImportSessionDialog
  ├─ GET /api/claude-sessions            → 列表 ClaudeSessionInfo[]
  ├─ 单条："导入"按钮 → POST /api/claude-sessions/import { sessionId }
  │                     → importOneSession → 201 → router.push(/chat/{id})   (行为不变)
  └─ 批量："导入选中" → POST /api/claude-sessions/import-batch { sessionIds }
                        → 一次建查重 Map → 逐条 importOneSession(try/catch)
                        → 200 { results[], summary{imported,skipped,failed} }
                        → 前端聚合 toast + 标记 importedIds + dispatch session-created
                        → 不跳转
```

## 后端

### `src/lib/session-import.ts`（新增）
共享的解析+落库逻辑，单条/批量两个 route 复用，避免逻辑分叉。

- `importOneSession(sessionId): ImportedSession` —— `parseClaudeSession` → 标题生成（首条 user 消息前 50 字）→ `createSession` → `updateSdkSessionId` → 循环 `addMessage`（含 tool blocks 的存 JSON，纯文本存原文）。**不做查重**（职责单一，查重留在 route 层）。
- `ImportSessionError extends Error { status }` —— 携带单条 route 需要回传的 HTTP 状态：找不到/不可解析 → 404，无消息 → 400。

### `src/app/api/claude-sessions/import/route.ts`（重构）
查重（`getAllSessions()` 找相同 `sdk_session_id` → 409 + existingSessionId）后调 `importOneSession`。`catch` 中 `ImportSessionError` 用其 `status`，其余 500。**对外行为与改动前完全一致**。

### `src/app/api/claude-sessions/import-batch/route.ts`（新增）
`POST { sessionIds: string[] }`：
1. **一次** `getAllSessions()` 建 `sdk_session_id → id` 查重 Map（关键优化，见下）。
2. 逐条 try/catch：命中 Map → `skipped`（带 existingSessionId）；否则 `importOneSession` → `imported`（并把新 id 写回 Map，防同批重复）；抛错 → `failed`（带 error message）。**单条失败不中断**。
3. **永远返回 200** + `{ results[], summary{imported,skipped,failed} }`，即使全失败也 200——让前端按 summary 渲染"N 成功 / M 已存在 / K 失败"，而非把部分失败当 5xx。仅请求体非数组/空 → 400，进程级异常 → 500。

## 前端（`src/components/layout/ImportSessionDialog.tsx`）

### 状态
- `selectedIds: Set<string>` —— 当前选中（可跨搜索保留）。
- `importedIds: Set<string>` —— 本次已导入/已存在的行，锁定不可再选。
- `batchImporting: boolean` —— 批量进行中。

### 自制三态 checkbox `SelectCheckbox`
项目无 `ui/checkbox` 组件。用 styled `<button role="checkbox" aria-checked>`：`unchecked` 空框、`checked` 实心 + `Check`、`indeterminate` 半填 + `Minus`（`@/components/ui/icon`）。`onClick` 内 `stopPropagation` 防止冒泡到整行。

### 选择派生（基于过滤结果）
```
selectableInView   = filteredSessions.filter(s => !importedIds.has(s.sessionId))
allInViewSelected  = selectableInView.length>0 && 全部在 selectedIds
masterState        = all ? checked : some ? indeterminate : unchecked
hiddenSelectedCount= selectedIds 中不在 filteredSessions 的数量
```
- **全选语义 = 当前过滤结果** `filteredSessions`，非全部 `sessions`。
- `selectedIds` 跨搜索保留（搜索 onChange 不清空）；有隐藏选中时显示 `import.hiddenSelectedHint`。

### `handleBatchImport`
`showLoadingToast` → POST import-batch → 解析 summary → `updateToast`（全成功 `batchSuccess`，否则 `batchSummary`）→ `imported>0` 时 `dispatchEvent('session-created')` 刷新侧栏 → 把 imported+skipped 的 id 并入 `importedIds`、从 `selectedIds` 移除 → **不跳转**、**不关弹窗**。

### 行为细节
- 整行 `onClick` 切换选中；单条"导入"按钮 `onClick` 加 `e.stopPropagation()` 防误触；已导入行替换为禁用的"已导入"徽标且不可再选。
- 弹窗每次 `open` 重置 `selectedIds`/`importedIds`/`searchQuery`。

## 关键设计决策

1. **批量为何走独立 endpoint 而非前端循环单条 API**：`parseClaudeSession` 每次都遍历全部 project 目录做 fs 探测，单条 route 每次 `getAllSessions()` 全表查重。N 条走 N 次单 API = N 次全目录走查 + N 次全表查重 + N 次 HTTP。批量 endpoint 把查重降到 1 次，错误聚合集中，前端逻辑更简。
2. **helper 不含查重**：查重源不同（单条一次性 lookup，批量一次性 Map），放 route 层职责更清晰。
3. **嵌套 `<button>` 修复**：初版全选栏外层是 `<button>` 包 `SelectCheckbox`（也是 button），触发 hydration error（button 不能嵌 button）。改外层为 `<div onClick>`（验证阶段 chrome-devtools console 发现并修）。

## i18n（zh + en 同步，`src/i18n/{zh,en}.ts` 的 `import.*` 区块）

`selectAll` / `selectedCount {n}` / `importSelected {n}` / `importingCount {n}` / `clearSelection` / `batchSuccess {n}` / `batchSummary {imported}{skipped}{failed}` / `alreadyImported` / `hiddenSelectedHint {n}` / `batchEmptyError`。

## 文件清单

| 文件 | 改动 |
|------|------|
| `src/lib/session-import.ts` | 新增：`importOneSession` + `ImportSessionError` |
| `src/app/api/claude-sessions/import/route.ts` | 重构为调 helper（行为不变） |
| `src/app/api/claude-sessions/import-batch/route.ts` | 新增：批量 + 聚合 summary |
| `src/components/layout/ImportSessionDialog.tsx` | 主改动：多选 UI + 全选 + 批量 |
| `src/i18n/zh.ts` / `src/i18n/en.ts` | 10 个新 `import.*` key |

不改：`CliSettingsSection.tsx`（props 不变）、`claude-session-parser.ts`、`db.ts`（仅复用现有函数）。

## 已知边界

- 实际"批量导入真实会话"未在真实数据上端到端跑过（避免污染用户 DB）；已验证：UI 交互全链路、import-batch endpoint 契约（fake id → 200 + summary，无副作用）、`importOneSession` 系从原单条逻辑等价抽取。建议手动选 2–3 条真导入做一次验收。
- 批量为单请求，拿不到逐条真实进度，进度反馈为"忙碌态 + loading-toast 原地更新"，非 "3/10" 数字进度。要数字进度需改前端串行或 endpoint 流式。

## 验证

`tsc --noEmit` + `npm run test`（既有 Windows 路径用例失败与本功能无关）。chrome-devtools：184 行渲染；全选→184 选中 + master checked + "导入选中 (184)"；取消一行→master mixed（Minus）+ "已选 183 个"；fake id 调 batch → 200 + `summary{0,0,1}`；搜索缩小→选中保留 + 隐藏提示；console 干净。
