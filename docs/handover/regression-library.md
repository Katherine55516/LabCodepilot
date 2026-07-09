# 测试工作台 · 回归用例库(自动沉淀 + 跨任务一键重跑)(技术交接)

> 产品思考见 [docs/insights/regression-library.md](../insights/regression-library.md)
> 执行计划(含决策日志/验证记录)见 [docs/exec-plans/active/regression-library.md](../exec-plans/active/regression-library.md)
> 依赖前置特性:[test-regression-suite.md](./test-regression-suite.md)(「回归测试」标签 = 回归集)

分支:V3.1.0_dev(2026-07-08)

## 一句话

每个测试任务在**用例设计步完成后**,后端自动把该任务里 `tags` 含「回归测试」的用例 **upsert** 进一个**项目级回归用例库**(`AI_LabTest/testCase/回归用例库.json`);库可查看/按任务管理,并能作为**跨任务回归套件一键重跑**(复用现有执行+报告机器)。

## ⚠️ 与既有「回归集」的关系(读代码前必知)

本特性**不是**新的「回归」概念,而是既有「回归集」(`tags` 含「回归测试」,失败即阻塞系统)的**下游沉淀层**:

| 层 | 是什么 | 落点 |
|---|---|---|
| 回归集标签(前置特性) | 单个任务内、哪些用例是「失败即阻塞」 | 各任务 `{task}.cases.json` 的 `tags` |
| **回归用例库(本特性)** | 跨任务把这些标签用例**汇集**成一个可重跑的套件 | 项目级 `回归用例库.json` |

⚠️ 仍需与「回归基线」(`verification`,oracle 口径)硬隔离——见 test-regression-suite.md。库只认 `tags` 含「回归测试」。

## 数据模型

### 库文件 `AI_LabTest/testCase/回归用例库.json`
```jsonc
{
  "version": 1,
  "updatedAt": "ISO",
  "entries": [                         // ⚠️ 顶层用 entries(非 cases),避免被别处当普通用例文件消费
    {
      ...原用例全字段(id/caseType/priority/purpose/steps/tags/...),
      "_source": { "task": "设备预约系统", "originalId": "TC-003", "depositedAt": "ISO" }
    }
  ]
}
```
- 只收 `tags` 含「回归测试」的用例;`_source.task` 是 **upsert 主键维度**。

## 核心模块 `src/lib/test/library.ts`(纯逻辑,18 单测覆盖)

| 函数 | 职责 |
|---|---|
| `readLibrary(projectPath)` | 读库;缺文件/损坏/结构不符 → 空库(不抛,库是增强特性) |
| `writeLibrary` | 原子写(.tmp+rename)+ 刷新 `updatedAt` |
| `depositTask(projectPath, taskName, cases)` | **核心 upsert**:筛 `tags` 含「回归测试」→ 删该 task 旧 entries → 插当前 → 原子写。幂等,回归集为空=清空该任务贡献。返回 `{added,removed,total}` |
| `removeEntries(projectPath, pred)` | 按谓词删(移除单条 / 某任务全部) |
| `listByTask(lib)` | 按 `_source.task` 分组(保持首次出现顺序) |
| `buildRunnableCases(lib)` | 聚合成 `{cases, idMap}`;**跨任务 id 冲突命名空间化**(`{task}::{originalId}`),`idMap` 供报告反解 |
| `readTaskCases(casesAbs)` | 健壮读 `{cases:[]}` 或顶层数组 → 数组 |

常量在 `src/lib/test/library-constants.ts`(纯字符串、**客户端安全**,无 fs):`REGRESSION_TAG='回归测试'`、`REGRESSION_LIBRARY_TASK='回归用例库'`。library.ts 再导出;前端(InlineTestingPanel)只从 constants 引入,避免把 Node-only 的 library.ts 拖进浏览器 bundle。

## API 路由

| 路由 | 方法 | 作用 |
|---|---|---|
| `/api/test/library` | GET `?projectPath` | 列库,按来源任务分组 `{total,updatedAt,tasks:[{task,count,entries}]}` |
| `/api/test/library` | DELETE `{projectPath,task,originalId?}` | 移除:给 `originalId` 删单条、只给 `task` 删整任务;**缺 `task` → 400**(不支持无差别清空,防误删)。记审计 `library-remove` |
| `/api/test/library/deposit` | POST `{projectPath,taskName}` | 前端 **re-sync**:按当前 cases.json 重新 upsert 该任务(编辑/推荐后保库不 stale)。记 `deposit-library`(manual) |
| `/api/test/library/run` | POST `{projectPath}` | **聚合准备**:`readLibrary→buildRunnableCases→写 回归用例库.cases.json`。返回 `{ok,total}`。记 `run-library` |

## 触发与数据流

### 自动入库(用例设计完成后)
`run/route.ts` 的 `step==='cases'` 用新的 **`wrapCasesStream`** 包装(仿 `wrapExecutionStream`):透传 SSE,流结束时 read 该任务 cases.json → `depositTask` → `appendAudit('deposit-library', mode:'auto')` → 补发 `{type:'library_updated', data:{added,removed,total}}` 帧。失败静默、不阻塞用例设计步。保留任务名 `回归用例库` 自身不入库(防自递归)。

前端(InlineTestingPanel)`library_updated` 帧(在 runStep 的 SSE 分发)→ toast「📥 已入回归用例库…」+ bump `libraryReload`。另在 `saveCases`(编辑保存)、`recommendSuite`(AI 推荐)之后 `resyncLibrary()` fire-and-forget 调 deposit API,保库不 stale。

### 跨任务一键重跑(最大复用、零执行逻辑重复)
`RegressionLibraryModal` 的「一键重跑」→ 面板 `runLibrary()`:
1. POST `/api/test/library/run` → 写 `回归用例库.cases.json`(返回 `total`;0 → 提示空库);
2. 依次 stream **现有** `/api/test/run`(`taskName='回归用例库'`,step=`execution`→`report`,env 走项目 `environments.json`)——复用执行机器(env 解析 / Playwright / 可达性闸门 / `wrapExecutionStream` 归约 / suiteIds 口径);
3. 产物落 `report/回归用例库/`,**自动出现在报告区**(`/api/test/reports` 扫全 `report/` 目录);跑完 bump `reportsReload`。
- 状态经 `libraryRunStatus` 在弹窗内展示(库不属任何任务对话,不走任务 `push`)。
- ⚠️ 聚合用例保留原 `tags`(含「回归测试」)→ 执行归约时 `suiteIds` = 全部 → 报告天然按回归集口径 + 红线规则(未全过=不可发版)。

## UI(InlineTestingPanel.tsx)

- **入口**:项目头(看板层,与「环境配置/新建任务」同排)「回归用例库」按钮(`FolderOpen` 图标)——库是**项目级**,故放项目头而非任务详情头。
- **`RegressionLibraryModal`**:按来源任务分组列条目(来源任务 · 原ID · 优先级 · 标题)、单条/按任务移除(`window.confirm` 二次确认)、顶部「一键重跑」按钮 + 运行状态行。`reloadSignal`(libraryReload)变化时重新拉取。

## i18n(三文件强类型齐)
`test.library.*`(title/open/deposited/empty/summary/fromTask/remove/removeTask/confirm*/run/running/runHint/runStarted/runDone/runFailed/close)+ 审计动作标签 `test.audit.action.{depositLibrary,runLibrary,libraryRemove}`。

## 验证状态(2026-07-08,dev)
- `npm run test`:1890 pass / 1 fail(project-mcp-injection 预存环境问题)/ +18 库单测。typecheck 0。
- 后端 curl 端到端:deposit 幂等/标签同步/保留名守卫/审计;GET 分组;DELETE 单条·整任务·缺 task 400;run 聚合命名空间(跨任务 TC-001→`登录鉴权::TC-001`)+ 空库 + 审计。
- CDP(隔离数据目录,**未碰真实 workbench**):项目头库按钮 → 模态分组渲染 → 移除单条落盘 → 一键重跑触发聚合+执行+报告,run.json `suiteCounts 2/2 blocked`、`suitePassStr 0/2`(红线数据正确),报告进报告区(API 已返回)。
- ⚠️ **未验证(需凭证/打包)**:真实 AI 执行结果(dev env 模式 NO_CREDENTIALS、managed key 无主密钥解密为空)——库重跑在 dev 里执行步必 blocked;A1 自动入库的**真实 AI 打标质量**同此前提。需注入 BYOK key 或打包登录后终验。

## AI 推荐回归集 · 可视化审阅改造(2026-07-08 追加)

用户反馈:用例设计阶段的「AI 推荐回归集」不应在**对话框**里流式跑,应**可视化审阅**。改造:

- **交互**:用例设计阶段点「🎯 AI 推荐回归集」→ 弹 `RecommendReviewModal`(不再往任务对话流 push)。弹窗内表格逐条列:`纳入`(复选框)/ 用例(ID+标题)/ AI 建议(回归集 ✓ 或 否 badge)/ 理由;当前标签与 AI 建议不一致的行标「变更」。用户勾选调整后点「应用」才写盘。
- **后端**:`/api/test/cases/recommend` 加 `review` 模式——`review:true` 时 wrapRecommendStream **只 harvest 不写盘**,补发 `{type:'recommend_verdicts', data:[{id,suite,reason}]}` 帧(新 `harvestRecommendDetailed` 保留 reason);**不**改 cases.json、**不**记审计。默认(review 省略)保持旧的 auto-apply(向后兼容)。
- **应用**:新 `POST /api/test/cases/recommend/apply {projectPath,taskName,verdicts:[{id,suite}]}` → 复用 `applyRecommend` 精确 merge 标签 → 记审计 `recommend-suite`(审阅后应用)→ **同步回归用例库**(depositTask upsert 该任务贡献)。
- **验证**:后端 curl(review 不写盘 md5 不变 + apply merge/库同步正确);前端 CDP mock 注入假 verdicts——表格三行渲染、取消勾选 TC-003(覆盖 AI)后「应用」payload 为 `[TC-001:true,TC-002:false,TC-003:false]`(用户覆盖生效)。单测 `harvestRecommendDetailed` +2。

## 已知局限 / 未来
- 重跑报告目前按 runId(命名空间后)呈现,未按 `_source.task` 视觉分组(idMap 已具备,留作后续)。
- 库导出(xlsx)未做(批 C 只做查看+移除);可后续复用 report-xlsx 派生。
- 保留任务名 `回归用例库` 与用户真实同名任务的冲突校验未加(记 tech-debt)。
