# 测试工作台 · 多任务并行执行

> 创建时间：2026-06-28
> 最后更新：2026-06-28
> 技术交接见 [docs/handover/test-multitask-parallel-execution.md](../../handover/test-multitask-parallel-execution.md)（Phase 5 产出）
> 产品思考见 [docs/insights/test-multitask-parallel-execution.md](../../insights/test-multitask-parallel-execution.md)（Phase 5 产出）

## 背景与需求

用户（产品负责人）提出 4 条需求优化（针对 `src/components/test/InlineTestingPanel.tsx` 测试工作台）：

1. **多任务执行**：可勾选多个测试任务一起执行；多任务执行时「测试执行」节点默认后台无头运行（不弹浏览器窗口）。
2. **执行前登录态预检**：执行前检查登录态是否正常，不正常要提醒用户。
3. **并发数可配置（1–5）**：放在环境配置中，每个用户按自己电脑情况设定。
4. **排队机制**：并发设为 N，同时起 M(>N) 个任务时，N 个运行、其余排队，空出槽位再开跑。

## 现状结论（已核对到代码行）

- 「后台无头运行」**已存在**：`execMode` 默认 `headless`，`headed` 参数从 UI → `/api/test/run` → `buildPlaywrightMcp` 的 `--headless` 全程打通。缺的是「多选 + 批量时强制无头」。
- **多选不存在**：仅单个 `selectedTask`；`busyTaskId` 单锁强制「一次只跑一个任务」（`runStep` 守卫 `if (busyTaskId) return`）。`abortRef`（单）、`autoRunRef`（单）同样是单例假设。
- 利好：每个任务的对话气泡 `convo` 与状态 `taskState` 本就按任务 ID 隔离（`taskStates: Record<id, TaskState>`、`patchTask(id, …)`），并行不会串台。
- **登录态预检不存在**：登录态 = Playwright `storageState` 文件（`AI_LabTest/.auth/{env}.{账号}.storageState.json`）。`resolveProjectEnvWithDb` 已能算出 `storageStatePath`（文件不存在 → null）。目前只有跑到一半 401 超 50% 的事后熔断。env-config GET 已经把 `storageStatePath`/`defaultAccount` 返回了，但面板的 `envCfg` 类型把它们丢了。
- **并发/排队不存在**：`/api/test/run` 是每请求独立 SSE、无注册表、无队列。但每个执行步用 `--isolated` 起独立浏览器，**并行本身是安全的**，只差调度。可参考 `src/lib/job-executor.ts`（图片批量）的槽位循环。

## 决策日志

- 2026-06-28: **队列放客户端**（面板内调度），不做服务端队列。理由：复用现有逐步 SSE 链路与 reduce/落盘，改动集中在 `InlineTestingPanel`，风险小、交付快。代价（已与用户确认）：批量跑到一半若**切走测试页/刷新应用**会中断在跑的任务（需求里的「后台」=无头浏览器，已满足；「跨页面存活」不在本期）。后续可升级服务端队列。
- 2026-06-28: **并发数存工作台本机设置**（localStorage，跟「执行方式」并列），默认 2、范围 1–5。理由：需求是「每人按自己电脑」，是机器属性而非项目属性；现有「环境配置」（设置·测试账号）会随 `environments.json` 导出共享，不适合放机器级并发。
- 2026-06-28: **登录态预检 = 文件存在 + cookie 过期/陈旧检查**（纯函数可单测）；真实探活导航留作后续「深度检查」开关。注意：登录态捕获是 Electron 专属，本地 `npm run dev` 跑不了捕获，只能用 mock `.auth` 验证逻辑。
- 2026-06-28: **批量范围 = 整条流水线 + 自动批准**（同现有「运行任务」语义），批量时强制无头。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 执行计划文档 | ✅ 已完成 | 本文件 |
| Phase 1 | 编排去单例化 | ✅ 已完成 | busyTaskId→runningTaskIds(Set)+runningIdsRef；abortRef→abortMap；autoRunRef→autoRunIds(Set)+forceHeadlessIds；runStep 加 target 参数化；auto-chain 各任务独立推进；stopTask 按任务停 |
| Phase 2 | 多选 + 批量工具条 + 强制无头 | ✅ 已完成 | 看板勾选(selectedTaskIds)、并发选择器(localStorage)、批量执行、运行中/排队中统计；批量进 forceHeadlessIds 强制无头；i18n en/zh/zh-HK |
| Phase 3 | 客户端排队 | ✅ 已完成 | waitingQueueRef + pumpQueue 槽位调度(并发−autoRun 数)+ 批量自动批准 review→done；卡片「排队中·第 K 位」/「运行中·无头」徽标 |
| Phase 4 | 登录态预检 | ✅ 已完成 | inspectLoginState 纯函数(+7 单测)；env-config GET 带 loginState；runBatchLoginGate 批量启动前弹门 |
| Phase 5 | 自检 + 文档 | ✅ 已完成 | npm run test 通过(1653 单测)；CDP(dev 3001 + mock)全流程验证；handover + insights 文档互链；i18n 三语同步 |
| Phase 6 | 「运行任务」选择起点（增强） | ✅ 已完成 | handleRunTask 分流(全新→直跑/其余→弹窗)；startRunAllFrom(step)；纯函数 runStartOptions(+5 单测)；RunStartModal(3 起点+锁定+覆盖确认+默认下一步)；不再清空对话；i18n test.runStart.* 替换 runChoice.*；CDP 三态验证。见交接文档「九」 |

> 代码 + 验证完成，待用户验收 / 合并后移至 `completed/`。客户端队列「跨页面存活」与登录态「深度探活」为已知后续方向（见详细设计末与 insights）。

## 详细设计

### Phase 1 · 编排去单例化（核心、风险最高）

**目标**：把「一次只跑一个任务」的单例编排，换成「按任务并行」的编排，单任务行为不回归。

- 状态：
  - `busyTaskId: string|null` → `runningTaskIds: Set<string>`（state，供渲染 + auto-chain 依赖）+ `runningIdsRef`（ref，供异步闭包同步读，避免竞态）。`markRunning(id)/markIdle(id)` 同步两者。
  - `abortRef`（单）→ `abortMapRef: Map<taskId, AbortController>`。
  - `autoRunRef`（单）→ `autoRunIdsRef: Set<taskId>`。
  - 新增 `forceHeadlessIdsRef: Set<taskId>`：批量任务强制无头（单任务「运行任务」仍走 execMode）。
  - `busy`（渲染用）= `runningTaskIds.has(aId)`（活动任务是否在跑），保持单任务 UX 不变。
- `runStep(step, opts)` 增加 `opts.target?: { projPath, task }`：缺省走活动选择（原行为），传入则跑指定后台任务。守卫改为 `runningIdsRef.current.has(task.id)`。执行步 `headed`：`forceHeadlessIdsRef.has(id) ? false : (opts.headed ?? execModeRef=='visible')`。
- `reviseStep`/`chatSend`：守卫与 abort 全部按 `task.id` 走 Map + running 集合（它们只作用于活动任务，天然与该任务的 runStep 串行）。
- auto-chain effect：遍历候选集 `{活动任务} ∪ autoRunIdsRef`，对每个未在跑、且有下一可执行步的任务调 `runStep(next, {target})`。`stepUnlockedFor(ss, step)` 抽出可传显式 stepStatus 的版本。
- `stopTask(tid)` / `stopStep()`（=停活动任务）；删除项目/任务时中断其所有在跑任务。

### Phase 2 · 多选 + 批量工具条 + 强制无头

- 看板卡片左上角加勾选（`selectedTaskIds: Set<string>`，仅 dash 视图）。
- 顶部工具条：并发选择器（1–5，存 `localStorage['codepilot:test-concurrency']`，默认 2）、「批量执行」按钮、「N 运行中 / M 排队中」统计、空槽自动开跑的说明。
- 批量执行：把所选任务加入 `forceHeadlessIdsRef` + autoRun，强制无头。
- i18n：`src/i18n/en.ts` + `zh.ts` 同步新增文案。

### Phase 3 · 客户端排队

- 调度器：`waitingQueueRef: taskId[]` + 并发上限读 localStorage。`pump()`：当 `运行中流水线数 < 并发` 时，从队首取任务启动。
- 「运行中流水线数」= autoRun 集合大小（每个 autoRun 任务占一个槽位，跨其各步直到 report 完成）。
- 卡片显示「排队中·第 K 位」；停止排队中任务 = 从 waiting 移除。

### Phase 4 · 登录态预检

- `src/lib/test/env-config.ts` 加纯函数 `inspectLoginState(projectPath, env)` → `{ hasState, expired, capturedAt, account }`（读 storageState 文件 + cookie `expires`）。纯 fs/JSON，可单测。
- `/api/test/env-config` GET 把该信号一并返回（或新增轻量字段）；面板 `envCfg` 类型补回 `storageStatePath`/`defaultAccount`/`loginState`。
- 批量启动前对所选环境校验一次：缺登录态 / 已过期 → 弹警告条（去「设置·测试账号」捕获 / 仍要执行）。

### Phase 5 · 自检 + 文档

- `npm run test`（typecheck + 单测）必过；新增纯函数加单测。
- CDP 在 `npm run dev`（本 worktree 用 `PORT=3001`）下验证渲染与交互；登录捕获是 Electron 专属，dev 用 mock `.auth` + 拦截 env-config 验证逻辑，结论注明此前提。
- 出交接文档（docs/handover/）+ 产品文档（docs/insights/），互相反向链接，并更新两目录 README 索引。

## 验收标准

- [ ] 单任务跑法（运行此步 / 运行任务 / 批准门控 / 停止 / 重跑）与改动前完全一致。
- [ ] 看板可多选任务，「批量执行」按并发数并行跑，超出的排队，空槽自动接力。
- [ ] 批量执行的「测试执行」步一律无头，不弹浏览器窗口。
- [ ] 批量启动前，缺/过期登录态会弹警告，可选择去捕获或仍执行。
- [ ] 并发数 1–5 可在工作台设置、本机持久化。
- [ ] `npm run test` 通过；i18n en/zh 同步。
