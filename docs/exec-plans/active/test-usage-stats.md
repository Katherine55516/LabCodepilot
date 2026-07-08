# 测试模块使用统计（test-usage-stats）

> 创建时间：2026-07-08
> 最后更新：2026-07-08
> 方案原型（已评审定稿 v7）：https://claude.ai/code/artifact/23045a8c-ce2f-4820-bd0d-c465014fdbfe

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 执行计划 + 口径冻结（本文档） | ✅ 已完成 | 三个决策点已由用户确认走推荐项 |
| Phase 1 | 数据层：`test_stats_events` 表 + 类型 + 采集/聚合 API 骨架 | ✅ 已完成 | 34 条单测；Electron-ABI 闭环通过；三视角对抗评审 4 项发现全部修复 |
| Phase 2 | 服务端埋点与计时：run/revise/cases 路由事件、进度行时间戳、run.json `durationMs` | ✅ 已完成 | 8 条计时单测；三视角评审 3 项发现全部修复；真实全流程验收并入 Phase 3 CDP 走查（同需 electron:dev） |
| Phase 3 | 前端埋点 + 复核 UI + 节点徽标：新建/批准事件、ReportView 复核条、流程节点用时+模型、报告矩阵用时列 | 📋 待开始 | 复核是唯一新增用户操作 |
| Phase 4 | 统计视图 + 任务详情 + 导出：`TestStatsView`（第 4 个 view）、模型效果表、节点轮次对比矩阵、XLSX 导出 | 📋 待开始 | 新组件独立文件 |
| Phase 5 | 测试验证 + i18n + 文档收尾 | 📋 待开始 | handover/insights 双文档 |

## 决策日志

- 2026-07-08: **三个决策点定稿**（用户确认按推荐项执行）：① 统计范围 P1 本地采集+本地看板、不上报，schema 带 `schema_version` 为 P2 账号体系上报预留；② 采纳率基线 = **AI 首轮生成**，用户要求重新生成的次数单独记「返工轮数」；③ 复核粒度 = **逐条复核 + 一键全准**，误判自动归类（误报/漏报/程度不符）。
- 2026-07-08: 存储选 **SQLite 事件流水**（`test_stats_events`）而非 workbench.json 或项目内文件：聚合查询方便、不依赖项目目录存活、追加式事件可随时按新口径重算、P2 上报直接复用。展示层聚合，**只给指标、不列具体用例**（用户明确要求），但底层事件保留用例粒度（id+hash），这是自动 diff 与误判归类的基础。
- 2026-07-08: 执行时长 = **服务端计时**：执行步利用现有进度行「▶ 用例 N/总数：标题」（`exec-progress.ts` 已解析）在 SSE 转发处打时间戳求差，逐用例耗时不采信 AI 自报；步骤级用时按流起止计。模型归因利用 run 请求体现成的 `model/providerId`（`run/route.ts:211`），零新增传递链路。
- 2026-07-08: 任务详情的节点轮次采用**横向对比矩阵**（每节点一卡、指标做行、轮次做列、Δ 标记），四个节点全覆盖（需求/用例/执行/报告每次运行各记一轮）。
- 2026-07-08: 统计视图新建独立文件 `TestStatsView.tsx`，不再往 `InlineTestingPanel.tsx`（~3.9k 行）里塞大块 UI；面板内只加视图路由与埋点调用。
- 2026-07-09（Phase 2 实现与评审后）: ① run/revise/cases 请求体新增 **taskId**（workbench 任务 UUID）；服务端缺 taskId 时**跳过埋点**（宁缺毋错，taskName 仅项目内唯一不能冒充 id）。② **错误/中断轮不记事件**：wrapper 跟踪 `error` 帧、**`result{is_error:true}` 帧**（SDK 会话级失败不发 error 帧，评审发现）与 abort 信号，只有干净收尾才落 step_completed / cases_generated / execution_completed / report_generated。③ cases_generated 加 **mtime 门**：文件 mtime 早于本轮开跑则跳过（AI 只产摘要不调 Write 时不能记幻影返工轮）。④ revise 修订轮只记 cases_generated 不记 step_completed；**chat 路径改写 cases.json v1 不计轮**（批准 diff 以首轮为基线，采纳率不失真；记为已知局限）。⑤ 逐用例计时的 id **刻意不归一化**，与 reduce.harvestResults 完全同键——两侧归一不一致会让时长错挂到「未执行」补全条目，同键最坏只是缺省。⑥ run.json 的 tests[] 增加可选 durationMs，在 stringify 前合入 → runHash（=sha1(runContent)，与 .history 快照去重同源导出 sha1Hex）覆盖时长；对快照去重零影响（run.json 本含 time 字段跨轮必不同）。
- 2026-07-08（Phase 1 对抗评审后）: ① `execution_completed` 增补 **runHash** 字段（Phase 2 落点强制携带，与 report_generated 同源）；聚合层同时实现**时序回填**（report_generated 的 runHash 回溯关联其前最近一次执行），事件缺失时熔断排除与模型归因不静默失效。② **时间窗口语义冻结**：路由对窗口查询补齐涉及任务的全量事件上下文，聚合层按窗口做"计入门控"（任务按创建时间、采纳按批准时间、执行按执行时间、复核按其所属执行轮是否在窗内）——窗外执行轮的归因上下文不丢失、覆盖率不越界。③ 查询超限时保留**最新** N 条（DESC 取数后反转回升序），截断只丢最旧数据。④ 任务详情节点轮次改**时间就近配对**（±120s），revise 轮不再错绑整步重跑的用时。

## 详细设计

### 目标

统计测试模块使用情况，覆盖四类数据：**新建任务量**、**AI 生成用例的采纳情况**（批准时自动 diff，用户零操作）、**测试报告结论的人工复核准确度**（唯一新增用户操作）、**执行时长**（逐用例 + 节点级）；全部指标支持**任务级详情**（节点轮次横向对比）与**按模型归因**分析，看板数据可导出 XLSX。

### 数据模型

表 DDL（`src/lib/db.ts`，走现有 `CREATE TABLE IF NOT EXISTS` + 迁移模式）：

```sql
CREATE TABLE IF NOT EXISTS test_stats_events (
  id TEXT PRIMARY KEY,                 -- uuid
  event_type TEXT NOT NULL,
  project_path TEXT NOT NULL,
  task_id TEXT NOT NULL,
  task_name TEXT NOT NULL DEFAULT '',
  env TEXT,                            -- local/sit，仅执行/报告类事件
  payload TEXT NOT NULL DEFAULT '{}',  -- JSON
  schema_version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_tse_type_time ON test_stats_events(event_type, created_at);
CREATE INDEX IF NOT EXISTS idx_tse_task ON test_stats_events(task_id);
```

事件字典（v1，10 个；「层」= 采集位置）：

| event_type | 触发点 | 层 | payload 关键字段 |
|---|---|---|---|
| `task_created` | 新建任务弹窗提交成功 | 前端 | `source`（imported_requirement / imported_cases / both） |
| `task_deleted` | 删除任务 | 前端 | — |
| `step_completed` | 四步任一步 SSE 正常收尾 | 服务端 | `step, status, durationMs, model, providerId` |
| `cases_generated` | cases 步 / revise 写出 cases.json | 服务端 | `round, caseCount, model, cases[{id, hash}]` 快照 |
| `cases_edited` | 用例手动编辑保存（PUT） | 服务端 | `countBefore, countAfter` |
| `cases_approved` | 用户批准用例 | 前端触发，**diff 服务端算** | `finalCount, diff{kept, modified, removed, added}, aiRounds` |
| `execution_completed` | 执行步收尾、run.json 落盘 | 服务端 | `env, counts, funcCounts, circuitBroken, durationMs, model, runHash, tests[{id, durationMs}]` |
| `report_generated` | 报告步收尾 | 服务端 | `env, runHash, model` |
| `report_reviewed` | 复核单条结论 | 前端 | `caseId, aiStatus, verdict(accurate/false_fail/missed_fail/severity_mismatch), runHash, note?` |
| `report_review_bulk` | 一键全部准确 | 前端 | `caseIds[], count, runHash` |

### 聚合口径（冻结）

- **任务数** = count(task_created)，按 source 细分；
- **采纳率** = Σ(kept+modified) / Σ(首轮 cases_generated.caseCount)，**首轮为基线**；原样率 = Σkept/分母；`imported_cases` 任务不进分母；返工轮数单独统计；
- **准确度** = accurate 复核数 / 已复核数；**必须同示复核覆盖率**；`circuitBroken` 的轮次整轮排除；误判归类：AI=fail/blocked 而实际正常 → 误报；AI=pass 而实际有问题 → 漏报；partial/blocked 程度错 → 程度不符；
- **时长**：逐用例 = 相邻进度行时间戳差（末条到 `@@RESULT`）；节点级 = SSE 起止；
- **模型归因**：采纳率归因「用例设计」所用模型；准确度/通过率/耗时归因「测试执行」所用模型；小样本行前端标注。

### 分阶段步骤

**Phase 1 · 数据层（S）**
1. `src/lib/db.ts`：建表 + 索引 + `insertTestStatsEvent` / 查询函数（幂等迁移，遵循现有模式）。
2. `src/types/index.ts`：`TestStatsEventType`、`TestStatsEvent`、各 payload 类型、聚合响应类型（全局 KPI / 任务详情 / 模型效果 / 节点轮次）。
3. `src/app/api/test/stats/route.ts`（新）：`POST` 事件上报（单条/批量，task/env 段过 `isUnsafeSegment`）+ `GET` 聚合（`?scope=global|task|model&taskId&from&to`）。
4. 单测：事件插入/查询、聚合 SQL 口径（含排除规则）。
   验收：`npm run test` 通过；手工 POST/GET 闭环。

**Phase 2 · 服务端埋点与计时（M）**
1. `src/app/api/test/run/route.ts`：步骤起止计时 → `step_completed`；执行步在 `wrapExecutionStream` 给进度行打时间戳 → 逐用例耗时 → `execution_completed`（含 `tests[].durationMs`）；cases 步落 `cases_generated`（round 自增 + id/hash 快照）；报告步落 `report_generated`。所有埋点 try/catch **fire-and-forget，失败不影响主流程**。
2. `src/lib/test/reduce.ts`：`ReducedTest`/`RunJson` 增加可选 `durationMs`，`reduceFromText` 接受 duration map 合入。
3. `src/app/api/test/revise/route.ts`：revise 产出用例 → `cases_generated`（round++）；`src/app/api/test/cases/route.ts` PUT → `cases_edited`。
4. `cases_approved` 的 diff 计算放服务端（stats POST 收到 approved 信号时读首轮快照事件 + 当前 cases.json，按 id+hash 算 kept/modified/removed/added）。
5. 单测：进度行时间戳→duration 边界（预检段不计、AI 漏打进度行时 duration 缺省不阻塞）、diff 四分类、误判归类纯函数。
   验收：跑一条真实任务全流程，sqlite 查询事件序列完整、时长与挂钟核对（±1s 量级）、旧 run.json 无 durationMs 仍可渲染。

**Phase 3 · 前端埋点 + 复核 UI + 节点徽标（M）**
1. `InlineTestingPanel.tsx`：`addTask` 成功 → `task_created`；删除 → `task_deleted`；批准 cases → POST approved 信号；`TaskState` 增加 `stepDurations`/`stepModels`（向后兼容，旧 workbench.json 缺省），run 路由在流末补发 `{type:'step_stats', durationMs, model}` 帧（沿用 `run_json` 追加帧先例）供前端写入。
2. 流程视图步骤节点：用时徽标（运行中实时累计）+ 模型小字 + 轮数标记。
3. `ReportView` 执行矩阵：行内复核条（✓ 准确 / ✗ 有误 → 选「实际结果」自动归类）+ 一键全准 + 撤销；打开报告时 `GET /api/test/stats?scope=task&runHash` 回显已复核状态；矩阵加「用时」列。
   验收：CDP 走查（新建→生成→批准→执行→报告→复核），事件逐条落库；复核回显正确；`npm run test:smoke`。

**Phase 4 · 统计视图 + 导出（M）**
1. `src/components/test/TestStatsView.tsx`（新）：KPI 四卡、六图（任务趋势/采纳构成/复核分布/准确度趋势/时长分布/步骤平均用时，SVG 自绘无新依赖）、模型使用与效果表、任务明细表 + 行展开「节点轮次横向对比矩阵」（按原型 v7）。
2. `InlineTestingPanel.tsx`：`View` 加 `"stats"`，header 分段控件加「统计」段。
3. `src/app/api/test/stats/export/route.ts`（新）：exceljs 生成 4 Sheet（汇总指标/任务明细/复核明细/事件流水）+ `?format=json`；`src/app/api/test/report-xlsx/route.ts` 执行矩阵加「用时」列。
   验收：CDP 截图对照原型；导出文件 Excel 打开正常、数字与看板一致。

**Phase 5 · 收尾（S）**
1. `src/i18n/en.ts` + `zh.ts` 全量文案键。
2. 测试：`npm run test` + `npm run test:smoke`（worktree 用 PORT=3001，测完关服务）；补聚合/归类单测缺口。
3. 文档：`docs/handover/test-usage-stats.md` + `docs/insights/test-usage-stats.md`（互链），更新 `ARCHITECTURE.md` 表清单与 API 数、`docs/exec-plans/README.md` 索引、本文档状态表。

### 依赖与风险

- **事件写库失败不得影响测试主流程**：所有埋点 fire-and-forget + 环形去重（同一 step 完成只记一次）。
- **兼容性**：`TaskState` 新字段缺省安全；`run.json.tests[].durationMs` 可选，旧快照/历史对比不受影响；`.history` SHA-1 因新字段变化只影响新快照去重，无回溯问题。
- **进度行依赖**：AI 偶发不按格式打印进度行时逐用例时长缺省（事件仍记步骤级时长），不阻塞、不报错。
- **隐私边界**：事件只存任务名/项目路径/指标与用例 id+hash，**不存用例内容与页面数据**；P2 上报前另行评估 project_path 脱敏。
- **单文件膨胀**：统计视图独立组件文件；InlineTestingPanel 只增路由/埋点/复核条挂载点。
- 已知环境噪音：`npm run test` 中 better-sqlite3 ABI 造成的既有 node 下单测失败与本功能无关（见 electron-build-test-gotchas 备忘）。

### 验收标准（总）

1. 新建任务→生成→批准→执行→报告→复核全流程后，`test_stats_events` 事件序列完整且 payload 符合字典；
2. 采纳率与手工 diff 核对一致；导入用例任务不进分母；返工轮数正确；
3. 复核事件与看板准确度/误判构成一致；熔断轮排除生效；
4. 逐用例时长与挂钟核对一致（±1s 量级）；节点徽标、报告矩阵用时列、看板时长图数据同源一致；
5. 模型效果表按节点归因正确（混用模型任务分别归因）；
6. 任务详情节点轮次矩阵与原型 v7 一致（四节点、轮次做列、Δ 标记、只给指标）；
7. 导出 XLSX 4 Sheet 可打开、数字与看板一致；
8. `npm run test` / `npm run test:smoke` 通过；CDP 截图验证统计视图、复核交互、入口分段。

### 提交策略

按 Phase 原子提交（`feat(test-stats): ...`），worktree 内完成；**不 push、不合并**，均等用户指示。
