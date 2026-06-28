# 测试工作台 · 多任务并行执行（交接文档）

> 产品思考见 [docs/insights/test-multitask-parallel-execution.md](../insights/test-multitask-parallel-execution.md)
> 执行计划见 [docs/exec-plans/active/test-multitask-parallel-execution.md](../exec-plans/active/test-multitask-parallel-execution.md)

把测试工作台从「一次只能跑一个任务」升级为「可勾选多任务、按并发数并行、超出排队、执行前查登录态」。改动几乎全集中在 [src/components/test/InlineTestingPanel.tsx](../../src/components/test/InlineTestingPanel.tsx)（客户端编排），外加一处纯函数 + 一处 GET 路由 + i18n。

## 一、四个需求 → 落点

| 需求 | 落点 |
|------|------|
| 多任务执行，执行节点默认后台无头 | 看板多选 + 批量执行；批量任务进 `forceHeadlessIdsRef` → `runStep` 对执行步强制 `headed=false` |
| 执行前查登录态 | `inspectLoginState`（纯函数）+ env-config GET 带出 `loginState` + 批量启动前 `runBatchLoginGate` 弹门 |
| 并发数 1–5 可配置（本机） | `concurrency` state，存 `localStorage['codepilot:test-concurrency']`，看板工具条下拉 |
| 排队机制 | `waitingQueueRef` + `pumpQueue()` 槽位调度（槽位 = 并发 − autoRun 任务数） |

## 二、核心架构变更：编排去单例化

改动前是**严格单任务串行**：单个 `busyTaskId` 锁 + 单个 `abortRef` + 单个 `autoRunRef` + 只推进活动任务的 auto-chain。改动后按任务集合并行。

| 改动前（单例） | 改动后（按任务） | 作用 |
|------|------|------|
| `busyTaskId: string\|null` | `runningTaskIds: Set` (state) + `runningIdsRef` (ref) | 哪些任务有 in-flight 运行；ref 供异步闭包同步读防竞态 |
| `abortRef: AbortController` | `abortMapRef: Map<taskId, AbortController>` | 每任务独立中断句柄 |
| `autoRunRef: string\|null` | `autoRunIdsRef: Set<taskId>` | 哪些任务在「运行任务/批量」自动接力模式 |
| —（新增） | `forceHeadlessIdsRef: Set<taskId>` | 批量任务强制无头（单任务「运行任务」仍按 execMode） |
| —（新增） | `waitingQueueRef: string[]` + `waitingTaskIds: Set` | 排队队列（ref 权威 FIFO，state 供渲染） |

辅助：`markRunning/markIdle(id)` 同步 ref+state；`busy = runningTaskIds.has(aId)`（活动任务是否在跑，保持单任务 UX）。

### runStep 参数化

`runStep(step, opts?)` 新增 `opts.target?: { projPath, task }`：
- 缺省 → 走活动选择（`selected`/`selectedTask`），与原行为完全一致；
- 传入 → 跑指定后台任务（批量 / auto-chain 接力非活动任务）。

守卫从「全局 busy」改为 `runningIdsRef.current.has(task.id)`（按任务）。执行步 `headed`：`forceHeadlessIdsRef.has(id) ? false : (opts.headed ?? execModeRef=='visible')`。`finally` 里：错误/停止/报告完成时 `autoRunIdsRef.delete(id)` + `forceHeadlessIdsRef.delete(id)`，并调 `pumpQueue()` 放下一个排队任务。

`reviseStep` / `chatSend` 同样改为按 `task.id` 走 `abortMapRef` + `markRunning/markIdle`（它们只作用于活动任务，天然与该任务的 runStep 串行）。

### auto-chain effect（多任务独立推进）

`useEffect([taskStates, runningTaskIds, aId])`：候选集 = `{活动任务} ∪ autoRunIdsRef`。对每个**未在跑**、且有「下一可执行步」的任务调 `runStep(next, {target})`；`stepUnlockedFor(ss, step)` 抽出可传显式 stepStatus 的解锁判定。autoRun 任务跑完（无可执行步）时从集合释放并 `pumpQueue()`，避免空占槽位。

## 三、排队调度（pumpQueue / startBatch）

- `startBatch(ids)`：入队（去重，跳过在跑/已排队/不存在/已全部 done 的），调 `pumpQueue`。语义 = 单任务「运行任务」的「从当前进度续跑」。
- `pumpQueue()`：`slots = 并发 − autoRunIdsRef.size`；有空槽就把队首任务提升进 `autoRunIdsRef` + `forceHeadlessIdsRef`，清其停止标记。**批量 = 自动批准**：新晋任务里 `review`（待批准）步直接标 `done`（functional `setTaskStates`，不受 finally 回调闭包陈旧影响），让 auto-chain 续跑到执行/报告。提升后 `setRunningTaskIds(...)` 触发 auto-chain effect 起跑（effect 读最新 taskStates，规避从 `runStep.finally` 回调进来的闭包陈旧问题）。
- 触发点：批量启动、`runStep.finally`（槽位空出）、`persistConcurrency`（调大并发）、auto-chain 释放。

「运行中流水线数」用 `autoRunIdsRef.size` 计（每个 autoRun 任务跨其各步直到 report 占一个槽位）；活动任务的手动接力（非 autoRun）不计入槽位，属用户当前焦点，允许轻微超订 1。

## 四、登录态预检

- `src/lib/test/env-config.ts` 新增 `inspectLoginState(resolved, nowMs?) → { account, hasState, expired, capturedAtMs }`：纯 fs 读 `.auth/{env}.{账号}.storageState.json`，按 cookie `expires`（epoch 秒，-1=会话 cookie 忽略）判过期——全部过期才算 `expired`，单个未过期即有效；`nowMs` 可注入便于单测。单测 [src/__tests__/unit/test-login-state.test.ts](../../src/__tests__/unit/test-login-state.test.ts)（7 例）。
- [src/app/api/test/env-config/route.ts](../../src/app/api/test/env-config/route.ts) GET 在 `resolved` 上附 `loginState`（best-effort，失败不阻断）。
- `runBatchLoginGate(ids)`：批量启动前拉当前项目+环境的 `loginState`；仅当「配了 `account` 但 `!hasState || expired`」才弹 `loginGate` 模态（取消 / 去捕获 / 仍要执行）；没配账号或接口失败 → 不挡直接排队。
- **深度探活（真起浏览器导航判断会话有效）刻意未做**，留作后续「深度检查」开关——见 insights。
- 客户端队列，没有在 `/api/test/run` 加服务端阻断（会干扰单步 SSE 与 auto-chain）。

## 五、UI 触点（看板）

- 工具条（`current.tasks.length > 0` 时）：`全选`、`已选 N`、`运行中 X`、`排队中 Y`、`并发 [1–5]` 下拉、`批量执行`；下方一行 `多任务在后台无头执行…` 说明。
- 任务卡：左上角勾选框（`toggleTaskSel`，选中高亮 primary 边框）；状态徽标按优先级 = 排队中（`排队中·第K位`，amber）> 运行中且批量（`运行中·无头`，info）> 原 `taskChip`。
- 多选状态 `selectedTaskIds: Set`，切项目时清空。

## 六、改动文件清单

- [src/components/test/InlineTestingPanel.tsx](../../src/components/test/InlineTestingPanel.tsx) — 编排去单例化 + 调度器 + 多选/工具条/登录门 UI
- [src/lib/test/env-config.ts](../../src/lib/test/env-config.ts) — `inspectLoginState` + `LoginStateInfo`
- [src/app/api/test/env-config/route.ts](../../src/app/api/test/env-config/route.ts) — GET 返回 `loginState`
- [src/i18n/en.ts](../../src/i18n/en.ts) / [zh.ts](../../src/i18n/zh.ts) / [zh-HK.ts](../../src/i18n/zh-HK.ts) — `test.batch.*` + `test.login.*`
- [src/__tests__/unit/test-login-state.test.ts](../../src/__tests__/unit/test-login-state.test.ts) — 新增单测

## 七、验证

- `npm run test`（typecheck + 1653 单测，含新增 7 例）通过。
- CDP（chrome-devtools，dev `PORT=3001 --webpack` + 隔离 `CLAUDE_GUI_DATA_DIR` + mock workbench/.auth 数据，登录捕获是 Electron 专属、dev 跑不了，故用 mock）验证：多选/全选、并发下拉、批量执行触发登录门（local 未捕获登录态）、`仍要执行` 后并发 2 起跑 + 排队、强制无头徽标、批量自动批准（待批准任务自动越过用例步）、已完成任务被排除、队列耗尽归零、单任务流程页无回归、console 无 React 报错（运行失败因 dev 无有效 provider，属预期，以任务内错误气泡呈现）。

## 八、已知边界

- **客户端队列**：批量跑到一半若切走测试页/刷新应用会中断在跑任务（「后台」=无头浏览器，已满足；跨页面存活不在本期）。后续可升级服务端 globalThis 队列（参照 `src/lib/job-executor.ts` + media-jobs 的 fire-and-forget start + 独立 SSE progress 路由）。
- 登录态只查文件存在 + cookie 过期，查不到「服务端已使会话失效」；配合执行阶段既有的 401 熔断兜底。
- 并发计数用 autoRunIdsRef.size，活动手动接力任务可能让瞬时并发超订 1。

## 九、「运行任务」选择起点（后续增强）

把单任务顶部「运行任务」从「全 idle/全 done → 静默清空从需求重跑；部分 → 继续/重新执行二选一」改为**统一的「选择起点」弹窗**，让用户自选从哪一步重跑、覆盖前给确认。

- **分流**（`handleRunTask`，[InlineTestingPanel.tsx](../../src/components/test/InlineTestingPanel.tsx)）：全新任务（4 步全 idle）→ 直接 `startRunAllFrom("requirement")`，不弹窗；其余（部分/已完成）→ `setModal("runStart")`。
- **`startRunAllFrom(step)`**：加 autoRun + 清停止标记 + 清四态/用例结果 + `runStep(step)`（runStep 自身把起点置 running、下游复位 idle，上游产物保留）。**不再清空对话**（一律保留、追加新一轮）——取代了原 `startRunAll(true)` 的清空行为。
- **纯函数 `runStartOptions(status, order, startSteps)`**（[step-status.ts](../../src/lib/test/step-status.ts)，单测见 [test-step-status.test.ts](../../src/__tests__/unit/test-step-status.test.ts)）→ 每个起点 `{ unlocked, willOverwrite, isNext }`：
  - `unlocked` = 上一步为 done（首步恒可）；否则锁定灰显（「需先完成上一步」）。
  - `willOverwrite` = 此步或其下游有产物（done/review）→ 选它会覆盖 → 弹窗给红字提示 + 按钮变「确认重跑」。
  - `isNext` = 第一个未 done 的步 → 弹窗默认高亮（＝「继续」入口，不覆盖时按钮为「从X运行」）。
- **`RunStartModal`**：起点 = 需求分析 / 用例设计 / 测试执行（**不含测试报告**——仅重生成报告用报告面板已有的「重跑」按钮）。默认选中：下一个待办且可选 → 否则最后一个可选（已完成任务→测试执行）。
- 映射两种情况：**已完成任务** 4 步全 done → 3 起点都可选、都「确认重跑」；**未完成任务** → 下一个待办＝继续（不覆盖时直接运行），已完成的更早节点＝重跑（确认）。
- i18n：`test.runStart.*`（替换原 `test.runChoice.*`）三语同步。
- CDP 验证（dev 3001 + mock 三种态：完成/部分/全新）：已完成→3 起点默认测试执行+覆盖提示+确认重跑；部分→默认用例设计(下一步)+覆盖提示+测试执行锁定；全新→无弹窗直接开跑；console 无 React 报错。

## 十、停止 = 停在当前节点（不向下游接力）

修复「停止测试执行却自动流转到测试报告」。根因：执行步停止与流自然 `done` 同刻竞争时，`reader.read()` 的 `done` 可能抢先于 abort 信号被处理 → `stopped` 仍为 false → 该步落 `done` → auto-chain 接力到测试报告。

- **abort 守卫**（runStep 读流循环，[InlineTestingPanel.tsx](../../src/components/test/InlineTestingPanel.tsx)）：`if ("aborted" in chunk || ctrl.signal.aborted) { stopped = true; break; }` —— 只要信号已 abort，即便 `done` 抢先也按「停止」处理，该步落 idle 而非 done。
- **停止标记扩到下游**：`finally` 里 `stopped` 时，把该步**及其所有下游步**都加入 `stoppedStepRef`（`${id}:${step}`）；auto-chain 跳过带标记的步 → 停在该节点、不流转报告。
- **(重)跑时清下游标记**：runStep 起跑处清掉该步**及下游**的停止标记（与 withDownstreamReset「下游产物失效」一致）→ 停止后再「运行/重跑」该步，报告仍能正常自动接力。
- 单测：[test-flow-stop.test.ts](../../src/__tests__/unit/test-flow-stop.test.ts) 新增「done 与 abort 同刻竞争按停止处理」+ 守卫表达式两例。
- CDP 验证（mock 可停/可完成的执行流）：B1 正常跑完→报告自动接力 ✓；B2 执行中停止→停在测试执行(idle)、报告未开始、不发起 report 请求 ✓；B3 停止后重跑执行→报告再次自动接力 ✓。

## 十一、访问地址自动刷新（env-config 重拉）

修复「在设置·测试账号改了访问地址 / 重新导出 environments.json，切回工作台仍显示旧地址」。根因：工作台面板常驻不卸载，env-config 只在 `[view, current?.path, env]` 变化时拉取，从设置切回不触发重拉。

- env-config 拉取 effect（[InlineTestingPanel.tsx](../../src/components/test/InlineTestingPanel.tsx)）：
  - 抽出 `load()`，依赖加入 **`pathname`**（`usePathname()`）→ 从 `/settings` 切回 `/chat` 时 pathname 变 → 重拉。
  - 监听 **`window 'focus'` + `document 'visibilitychange'(visible)`** → 外部切走再回来 / 窗口重新聚焦时也重拉。
  - fetch 加 **`cache: "no-store"`** → 重拉必拿最新值，避免浏览器回放缓存的旧地址。
- 仍是「文件优先」：访问地址以项目 `AI_LabTest/environments.json` 为准，改了设置(DB)要**点「导出到 AI_LabTest」**覆盖该文件才生效；此修复保证覆盖后切回工作台会自动刷新显示。
- CDP 验证（mock 项目，环境文件 3001→3002）：进入流程显示 3001 → 改文件为 3002 → 触发 focus → 单次重拉(no-store)返回 3002、🎯 徽标即时更新为 3002 ✓。
