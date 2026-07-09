# 测试模块使用统计（Test Usage Stats）

> 产品思考见 [docs/insights/test-usage-stats.md](../insights/test-usage-stats.md)
>
> 执行计划（分阶段进度 + 决策日志 + 已知局限）：[docs/exec-plans/completed/test-usage-stats.md](../exec-plans/completed/test-usage-stats.md)
>
> 相关：[handover/test-report-display-and-evidence.md](./test-report-display-and-evidence.md)（run.json / 报告视图）、[handover/requirement-import-modes.md](./requirement-import-modes.md)（任务导入来源）

统计用户对测试模块的使用情况，回答四个问题：**新建了多少任务**、**AI 生成的用例被采纳多少**、**测试报告的结论有多准**、**执行花了多少时间**（逐用例 + 逐节点），并支持**按模型归因**分析与 **XLSX/JSON 导出**。看板是测试面板的第 4 个视图（`dash / flow / report / stats`）。

## 架构总览

追加式**事件流水**是唯一数据底座：所有采集点只往一张表写不可变事件，看板/导出全部从事件**聚合**得出。口径改了可以对历史事件随时重算；二期（P2）接账号体系后，同一批事件可直接匿名上报做全体用户聚合，采集层零改动（`schema_version` 已预留）。

```
采集（7 点位）                          存储                 消费
─────────────────────────────────────  ───────────────────  ─────────────────────
服务端 4 处（run/revise/cases 路由内     test_stats_events    GET /api/test/stats
  直接写库，不经 HTTP）                   （SQLite 追加式）      ?scope=global|task|model
前端 3 处（新建/删除/批准/复核 →                              → 聚合（纯函数层）→ TestStatsView
  POST /api/test/stats）                                     GET .../export → exceljs 4 Sheet
```

**分层**（关键：聚合口径全在纯函数层，可在 node:test 下直测，绕开 better-sqlite3 的 Electron ABI）：

| 层 | 文件 | 职责 |
|----|------|------|
| 纯函数口径层 | [src/lib/test/stats.ts](../../src/lib/test/stats.ts) | 事件校验、用例 id+hash 快照、采纳 diff 四分类、误判归类、global/task/model 三种聚合 |
| 逐用例计时 | [src/lib/test/exec-timing.ts](../../src/lib/test/exec-timing.ts) | 进度行 → @@RESULT 行的挂钟差（纯函数，服务端计时，不采信 AI 自报） |
| 埋点胶水 | [src/lib/test/stats-recorder.ts](../../src/lib/test/stats-recorder.ts) | fail-safe 落库、step_completed 构造、cases_generated 快照、observeStream 流观测包装 |
| DB | [src/lib/db.ts](../../src/lib/db.ts) | 建表 + `insertTestStatsEvents` + `queryTestStatsEvents` |
| 采集/聚合 API | [src/app/api/test/stats/route.ts](../../src/app/api/test/stats/route.ts) | POST 采集（含 cases_approved / report_reviewed 服务端增补）+ GET 四 scope |
| 导出 API | [src/app/api/test/stats/export/route.ts](../../src/app/api/test/stats/export/route.ts) | 4 Sheet XLSX + JSON |
| 看板 UI | [src/components/test/TestStatsView.tsx](../../src/components/test/TestStatsView.tsx) | KPI + 六图（内联 SVG）+ 模型表 + 任务明细/节点轮次矩阵 |
| 面板集成 | [src/components/test/InlineTestingPanel.tsx](../../src/components/test/InlineTestingPanel.tsx) | 前端埋点、step_stats 帧消费、节点徽标、报告复核 UI、第 4 视图路由 |

## DB Schema

`test_stats_events`（[db.ts](../../src/lib/db.ts) `migrateDb` 内幂等建表，本功能唯一 schema 变更）：

```sql
CREATE TABLE IF NOT EXISTS test_stats_events (
  id TEXT PRIMARY KEY,                  -- crypto.randomBytes(16).hex
  event_type TEXT NOT NULL,
  project_path TEXT NOT NULL,
  task_id TEXT NOT NULL,                -- workbench 任务 UUID（不是 chat_session）
  task_name TEXT NOT NULL DEFAULT '',
  env TEXT,                             -- local/sit，仅执行/报告类事件
  payload TEXT NOT NULL DEFAULT '{}',   -- JSON，字段随 event_type 而异
  schema_version INTEGER NOT NULL DEFAULT 1,  -- P2 上报演进预留
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_tse_type_time ON test_stats_events(event_type, created_at);
CREATE INDEX idx_tse_task ON test_stats_events(task_id);
```

`queryTestStatsEvents` 返回按 `(created_at, rowid)` **升序**（聚合层 last-wins 依赖此顺序）；超 limit（默认 10 万）时保留**最新** N 条（DESC 取数后 reverse），截断只丢最旧。

## 事件字典（v1，10 类）

| event_type | 触发点 | 层 | payload 关键字段 |
|---|---|---|---|
| `task_created` | 新建任务弹窗提交成功 | 前端 | `source`（imported_requirement / imported_cases / both） |
| `task_deleted` | 删除任务 | 前端 | — |
| `step_completed` | 四步任一步干净收尾 | 服务端 | `step, status, durationMs, model, providerId` |
| `cases_generated` | cases 步 / revise 写出 cases.json | 服务端 | `round, caseCount, model, cases[{id, hash}]` 快照 |
| `cases_edited` | 用例手动编辑保存（PUT） | 服务端 | `countBefore, countAfter`（v1 聚合不消费） |
| `cases_approved` | 进入执行（批准汇聚点） | 前端触发，diff 服务端算 | `finalCount, diff{kept,modified,removed,added}, final[{id,hash}], aiRounds` |
| `execution_completed` | 执行步收尾、run.json 落盘 | 服务端 | `env, counts, funcCounts, circuitBroken, durationMs, model, runHash, tests[{id,durationMs}]` |
| `report_generated` | 报告步收尾 | 服务端 | `env, runHash, model` |
| `report_reviewed` | 复核单条（含撤销 `cleared`） | 前端 | `caseId, aiStatus?, actual?, verdict?, runHash` |
| `report_review_bulk` | 一键全部准确 | 前端 | `caseIds[], count, runHash` |

## 冻结口径（聚合层实现）

- **采纳率** = (原样采纳+修改后采纳) / **首轮** cases_generated 的 caseCount；分母只含「AI 生成流（source=imported_requirement）且已批准」的任务；`imported_cases` 与未批准任务排除；返工轮数 = 各任务 cases 生成轮数-1 之和（单独指标）。
- **采纳 diff**：批准时服务端读当前 cases.json 拍终态快照，与首轮快照按 **id+hash** 配对——同 id 同 hash=原样采纳、同 id 异 hash=修改后采纳、配不上=弃用/新增。
- **准确度** = 复核为准确的条次 / 已复核条次；**必须同示复核覆盖率**（= 已复核/可复核条次）；复核按其**所属执行轮**（runHash）计入。
- **误判归类**（服务端 `classifyVerdict`）：AI 判 fail/blocked 而实际正常=误报；AI 判 pass 而实际有问题=漏报；partial/blocked 程度错=程度不符。
- **401 熔断轮（circuitBroken）整轮排除**：不进通过率、不进复核分母，其复核也剔除。
- **时长**：逐用例 = 进度行「▶ 用例 N/总数」→ 下一条 `@@RESULT` 行的挂钟差（服务端打时间戳，id 取自 @@RESULT）；节点级 = SSE 流起止。
- **模型归因**：采纳率归因**首轮用例设计**所用模型；准确度/通过率/耗时归因**测试执行**所用模型（同一任务不同节点可换模型，各自归因）。
- **时间窗口**：路由对 from/to 查询**补齐涉及任务的全量上下文**，聚合层按窗口做「计入门控」（任务按创建、采纳按批准、执行按执行、复核按所属执行轮是否在窗内）——窗外归因上下文不丢失、覆盖率不越界。

## API 路由

| 路由 | 方法 | 说明 |
|---|---|---|
| `/api/test/stats` | POST | 事件采集（前端埋点）。逐条 sanitize 静默跳过；`cases_approved` 读 cases.json 算 diff；`report_reviewed` 带 actual 时服务端归类。响应 `{ok, stored, skipped}` |
| `/api/test/stats` | GET | `?scope=global`（KPI+周趋势+任务明细）/`task`（节点轮次详情，taskId 必填）/`model`（模型效果）/`reviews`（复核回显 byCaseId，last-wins + cleared 移除）。`from/to` 可选 |
| `/api/test/stats/export` | GET | `?format=xlsx`（4 Sheet）/`json`（原始事件）。`from/to` 可选 |

服务端埋点直接调 `insertTestStatsEvents`（不经 HTTP）：[run](../../src/app/api/test/run/route.ts)（step_completed/execution_completed/report_generated + 补发 `step_stats` 帧）、[revise](../../src/app/api/test/revise/route.ts)（cases_generated）、[cases PUT](../../src/app/api/test/cases/route.ts)（cases_edited）。

## 关键设计决策（详见执行计划决策日志）

1. **纯函数聚合层**：口径与 db/fs 解耦，node:test 可直测，避开 better-sqlite3 Electron ABI（`npm test` 下 db-backed 测试全 DLOPEN 失败，纯函数不受影响）。
2. **cases_approved 锚在执行步开始**：手动批准 / 运行任务 / 批量三条路径的单一汇聚点，不逐一挂 handler（易漏）。重跑重复发：内容取最新（捕获编辑）、时间取最早（首批周归属，防窗口漂移）。
3. **runHash = sha1(run.json 全文)**：执行/报告埋点、reports 路由、.history 去重同源同值，把复核关联到确切执行轮（重跑即失效）；执行事件缺 runHash 时由 report_generated 时序回填。
4. **错误/中断不记完成**：流观测器跟踪 `error` 帧、`result{is_error:true}` 帧（SDK 会话级失败不发 error 帧）与 abort 信号，只有干净收尾才落事件。
5. **fail-safe 埋点**：所有采集 try/catch，失败只打日志绝不影响测试主流程；缺 taskId（旧前端）跳过埋点，不用 taskName 冒充。
6. **复核撤销落库**：`verdict:'cleared'` 哨兵事件，聚合与回显 last-wins 移除（仅本地删会在重开时从 DB 复现且仍占准确度分母）。

## 埋点为何 fail-safe / 服务端归类

- 统计是旁路观测，任何异常（写库失败、cases.json 缺失、payload 超限）都只吞掉，测试主流程零感知。
- 复核 verdict 由服务端 `classifyVerdict` 判定，前端仅乐观显示同款逻辑——单一事实来源，避免分类规则在前端重复实现而漂移。

## 前端集成点（InlineTestingPanel）

- `recordTestStat`：fire-and-forget 上报（keepalive + 分批 ≤200）。
- 埋点：`addTask`→task_created、删除→task_deleted、runStep 执行步开始→cases_approved、ReportView 复核→report_reviewed/bulk/cleared。
- `step_stats` 帧消费 → `TaskState.stepDurations/stepModels`（随 test-workbench.json 持久化）→ 流程节点用时+模型徽标（运行中本地 1s ticker，失败重跑清空）。
- 报告复核 UI 在 `ReportView`（报告浏览器），需 taskId（project.tasks 按 name 映射）+ runHash（reports 路由回填）。

## 测试

- 纯函数单测：[test-stats.test.ts](../../src/__tests__/unit/test-stats.test.ts)（采纳 diff、误判归类、三种聚合、首轮基线、熔断排除、复核 last-wins、runHash 回填、窗口切片、cases_approved 最早时间、cleared 撤销）+ [test-exec-timing.test.ts](../../src/__tests__/unit/test-exec-timing.test.ts)（逐用例计时边界）。
- 端到端验证走 **electron-as-node**（`ELECTRON_RUN_AS_NODE=1 electron next dev`）让 better-sqlite3 用 Electron ABI、DB 路由可通，再用 CDP 走查看板/复核/导出。纯 web `npm run dev` 下 DB 路由会 DLOPEN 失败（ABI 不匹配）。

## 文件清单

新增：`src/lib/test/{stats,exec-timing,stats-recorder}.ts`、`src/app/api/test/stats/{route,export/route}.ts`、`src/components/test/TestStatsView.tsx`、两个单测。
改动：`src/lib/db.ts`（表+CRUD）、`src/types/index.ts`（事件与聚合类型）、`src/lib/test/{reduce,history}.ts`（durationMs / sha1Hex 导出）、`src/app/api/test/{run,revise,cases,reports,report-xlsx}/route.ts`、`src/components/test/InlineTestingPanel.tsx`、`src/i18n/{zh,en,zh-HK}.ts`。
