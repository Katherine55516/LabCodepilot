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

---

# v2 一期：轮次 + 套件 + 报告分组（2026-07-10）

> 方案与竞品对标见 [docs/research/regression-library-v2-benchmark-proposal.md](../research/regression-library-v2-benchmark-proposal.md)；执行计划(决策日志/设计默认/验证记录)见 [docs/exec-plans/active/regression-library-v2.md](../exec-plans/active/regression-library-v2.md)；交互原型 `docs/research/prototypes/regression-library-v2-prototype.html`

## 一句话

在 v1「自动沉淀 + 全量一键重跑」之上：**轮次实体化**(同环境多轮互不覆盖 + 当轮快照)、**套件圈选**(静态/查询双型 + pinned 必跑)、**发起弹窗**(套件/环境/预检)、**报告按来源任务分组 + 轮次 delta**、**库检索**。全部本地 JSON,零中心服务;「全量」内置套件保证 v1 行为向后兼容。

## 概念模型(读代码前必知)

| 概念 | 是什么 | 落点 |
|---|---|---|
| 套件(Suite) | 「本轮跑什么」的圈选**规则**(引用不复制) | `testCase/回归套件.json` |
| 轮次(Round) | 一次回归执行**实例**(一轮=一套件×一环境×一模式,原子) | 索引 `testCase/.data/回归轮次.json`,产物 `report/回归用例库/{roundId}/` |
| 快照(Snapshot) | 发起时该轮实际执行用例集的不可变副本(含 idMap) | `{roundId}/cases.snapshot.json` |
| pinned 白名单 | 项目级核心必跑,任何套件执行始终并入 | 回归套件.json 顶层 `pinned` |

标签管「进不进库」(v1 不变),套件管「这轮跑不跑」;报告挂轮次不挂套件。

## 核心模块

- **`src/lib/test/rounds.ts`**:轮次索引读写(宽松解析)、`generateRoundId`(RND-YYYYMMDD-HHmm+冲突后缀)、状态机 running→done/aborted/partial、`finishRound` 收口摘要、`normalizeStaleRounds` **惰性收口**(running 超 2h 视图归一 aborted,不回写)、`roundArtifactPaths`、`readRoundSnapshot`、`buildLastResultLookup`(最近已收口轮 run.json × 快照 idMap → 套件「上次结果」条件数据源)。
- **`src/lib/test/suites.ts`**:套件读写、`sanitizeSuite`(文件/API 共用清洗)、`evalSuite`(query 四字段 AND/值 OR/空不限制;static keys;pinned 并入去重;`quarantined===true` 前置排除——三期字段兼容)、内置 `REGRESSION_FULL_SUITE='全量'` 不落盘不可改删。
- **并发写保护(两文件同款)**:`seq` 写入序号 + mutate 在 rename 前重读比对,冲突在最新内容上重放一次——updatedAt 毫秒粒度同刻写入无法区分,故用 seq。
- **`library.ts`**:`buildRunnableCases(lib, include?)` 加圈选集参数(套件求值/二期复测共用),缺省=v1 全库。
- **`reduce.ts`**:`taskCounts`(opts.taskOf=runId→来源任务,来自快照 idMap)——按来源任务四态小计入 run.json;不传字段缺省。

## API 路由(新增/改造)

| 路由 | 说明 |
|---|---|
| POST `/api/test/library/run` | v2 重写:`{projectPath, suiteName?, env?}` → readSuites→evalSuite(pinned+lastResult)→buildRunnableCases(include)→写聚合 cases.json→**建轮次(running)+写快照**→返回 `{ok,total,roundId}`。未知套件 400;快照写失败不阻塞。 |
| POST `/api/test/run` | 接受 `roundId`(段安全校验+仅保留任务名);穿透 buildStep/evidenceDir/两个 wrap→产物落 `report/回归用例库/{roundId}/`、证据 `_evidence/{task}-{env}-{roundId}`;执行归约注入快照 idMap 出 taskCounts;reportPrompt 注入「按来源任务分节」要求。 |
| GET/PATCH/DELETE `/api/test/library/rounds` | 列轮次(惰性收口视图,倒序)/收口(done 从该轮 run.json 摘录 counts/suitePassStr,缺 run.json 按 aborted)/删单轮(索引+产物目录+该轮证据;审计 delete-round)。 |
| GET `/api/test/library/rounds/detail` | 单轮按来源任务分组 + 与上一全量轮 delta(新增失败/已修复/持续失败,**交集口径**,复测轮不作基准)。只读拼装。 |
| GET/POST/DELETE `/api/test/suites` | 列套件(hits=执行范围口径:求值+pinned 并入+隔离排除,含 hitTasks/fullHits/fullTasks)/新建更新套件或覆盖 pinned(内置名 400;审计 suite-save)/删套件(内置 400;审计 suite-delete)。 |
| POST `/api/test/suites/eval` | 构建器【未保存】套件实时命中预览(口径与发起执行完全一致)。 |
| GET `/api/test/reports` | 扫描下钻轮次子目录(跳过 `.history`),条目透传 `roundId`。 |

## UI(InlineTestingPanel,批 H 页面化后)

**信息架构(用户 2026-07-10 拍板)**:项目下两种**平级测试类型**——「功能测试」(现有任务四步流,交互不变)与「回归测试」(整页工作区)。项目头是分段式类型切换;「新建任务」仅功能测试显示;切换项目时类型/子页签重置。

- **RegressionWorkspace**(回归测试整页):子页签 用例库/回归套件/轮次历史 + 右侧「发起回归」主按钮 + 运行状态行。三个区块由原 v2 弹窗内容页面化(卡片容器,无遮罩),数据链路不变:
  - **RegressionLibrarySection**:摘要条(N 条·M 任务)+检索工具条(搜索 ID/标题+来源任务/优先级过滤,纯前端)+按任务分组列表与移除;
  - **RegressionSuitesSection**:套件列表(内置全量🔒+类型 badge+实时命中+编辑/删除)+构建器(查询条件 chips 四字段 300ms 防抖实时预览/静态分组勾选树)+pinned 白名单;
  - **RegressionRoundsSection**:轮次表(红线 badge/中断态/单轮删除)+行内展开详情(delta 三卡+任务分组红绿小计);reloadSignal 联动,跑完一轮自动刷新。
- **StartRegressionModal**(唯一保留的对话框——一次性执行确认):套件下拉(命中数)/环境下拉(env-config allowedEnvs)/被测地址展示(未配置警示)/预检卡(条数+任务数+近 3 个 done 轮均值时长估算,无历史显「暂无估算」)/红线说明/空套件禁用。确认→`runLibrary({suiteName, env})`。
- runLibrary(面板):发起带 suiteName/env→驱动 /api/test/run 带 roundId→完成 PATCH done/失败 PATCH aborted(读侧惰性兜底)。
- 附带修复:`status-danger-*`→`status-error-*`(未定义 token,删除 hover 红色此前静默失效);next.config dev watch 忽略 `.playwright-mcp/`(见下方排障记,根治 CDP 验证时的重编译死循环)。

## i18n / 审计

`test.suites.*`(41)+`test.launch.*`(15)+`test.rounds.*`(19)+库检索 5 键;zh/en 手写,zh-HK `gen-zh-hk.mjs` 生成。审计新动作:`suite-save`/`suite-delete`/`delete-round`(标签映射齐)。

## 验证状态(2026-07-10,dev)

- `npm run test` 1968/0(新增 27 条:rounds/suites 25 + reduce taskCounts 2)。
- curl 端到端:同环境两轮互不覆盖(冲突后缀)/快照 idMap 命名空间/未知套件 400/PATCH 收口摘录/缺 run.json 转 aborted/last=fail 查询套件精确命中/单轮删除/detail delta(新增失败/已修复精确)。
- CDP 实测(mock 仅拦 workbench 项目列表 GET/PUT 防污染真实数据,业务 API 真调、数据落隔离项目):四弹窗全链路+检索过滤+构建器实时预览(pinned 去重)+发起预检(近 2 轮时长估算)+轮次 delta 展开,console 0 errors。
- ⚠️ 未验证(需凭证/打包):真实 AI 执行(dev NO_CREDENTIALS);打包验收含新 roundId 产物路径(tech-debt 旧 #13 的 bundle-chromium 链路一并复核)。

## 已知偏差与局限

- 预检 **token 估算未做**(方案含此项):现状无按轮 token 数据源,一期仅时长估算;待 usage-stats 打通后补。
- 复测轮(failed-only)/评审门禁/缺陷闭环/rev 版本号=二期;健康度/隔离区/stats=三期(quarantined 排除已前置兼容)。
- 旧平铺重跑产物兼容显示、不折算轮次(设计默认 #3)。
- dev 排障记:playwright MCP 往仓库根写 `.playwright-mcp/` 会触发 Tailwind/webpack 监听重编译死循环(表象:页面永远转圈、Fast Refresh 每 0.5s rebuilding、大 chunk 下载中被截断报 SyntaxError/ChunkLoadError)。已在 next.config.ts 的 dev webpack watchOptions.ignored 根治(注意:Next 默认 ignored 是 RegExp,不能把 RegExp 塞进 webpack 的字符串数组,按类型合并)。
