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

- **`src/lib/test/rounds.ts`**:轮次索引读写(宽松解析)、`generateRoundId`(RND-YYYYMMDD-HHmm+冲突后缀)、状态机 running→done/aborted/partial、`finishRound` 收口摘要(`ifRunning` 终态保护 + 清 .alive)、**三层收口**(见下方事故):①`createRoundKeeper` 服务端收口守护(执行流 done/cancel/error 直接 finishRound + 30s 心跳)②`reapOrphanRounds` 读侧心跳判活(陈旧/缺失且过 120s 启动宽限 → 回写 aborted)③`normalizeStaleRounds` 惰性视图归一(running 超 2h,不回写,最后兜底)、`roundArtifactPaths`、`readRoundSnapshot`、`buildLastResultLookup`(最近已收口轮 run.json × 快照 idMap → 套件「上次结果」条件数据源)。
- **`src/lib/test/suites.ts`**:套件读写、`sanitizeSuite`(文件/API 共用清洗)、`evalSuite`(query 四字段 AND/值 OR/空不限制;static keys;pinned 并入去重;`quarantined===true` 前置排除——三期字段兼容)、内置 `REGRESSION_FULL_SUITE='全量'` 不落盘不可改删。
- **并发写保护(两文件同款)**:`seq` 写入序号 + mutate 在 rename 前重读比对,冲突在最新内容上重放一次——updatedAt 毫秒粒度同刻写入无法区分,故用 seq。
- **`library.ts`**:`buildRunnableCases(lib, include?)` 加圈选集参数(套件求值/二期复测共用),缺省=v1 全库。
- **`reduce.ts`**:`taskCounts`(opts.taskOf=runId→来源任务,来自快照 idMap)——按来源任务四态小计入 run.json;不传字段缺省。

## API 路由(新增/改造)

| 路由 | 说明 |
|---|---|
| POST `/api/test/library/run` | v2 重写:`{projectPath, suiteName?, env?}` → readSuites→evalSuite(pinned+lastResult)→buildRunnableCases(include)→写聚合 cases.json→**建轮次(running)+写快照**→返回 `{ok,total,roundId}`。未知套件 400;快照写失败不阻塞。 |
| POST `/api/test/run` | 接受 `roundId`(段安全校验+仅保留任务名);穿透 buildStep/evidenceDir/两个 wrap→产物落 `report/回归用例库/{roundId}/`、证据 `_evidence/{task}-{env}-{roundId}`;执行归约注入快照 idMap 出 taskCounts;reportPrompt 注入「按来源任务分节」要求。 |
| GET/PATCH/DELETE `/api/test/library/rounds` | 列轮次(先 reapOrphanRounds 孤儿回写、再惰性视图兜底,倒序)/收口(前端兜底通道,权威收口在执行流:done 从该轮 run.json 摘录 counts/suitePassStr,缺 run.json 按 aborted;aborted 带 ifRunning 不降级终态)/删单轮(索引+产物目录+该轮证据;审计 delete-round)。 |
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
- runLibrary(面板):发起带 suiteName/env→驱动 /api/test/run 带 roundId→完成 PATCH done/失败 PATCH aborted。**前端 PATCH 只是兜底**——权威收口在服务端执行流(见下方「轮次卡执行中」事故),页面中途死亡不再孤儿化轮次。
- 附带修复:`status-danger-*`→`status-error-*`(未定义 token,删除 hover 红色此前静默失效);next.config dev watch 忽略 `.playwright-mcp/`(见下方排障记,根治 CDP 验证时的重编译死循环)。

## 事故:轮次卡「执行中」——收口所有权押在前端,页面一刷新轮次成孤儿

真机 mealAllowance / RND-20260722-1450(14 条用例,14:50 发起):执行中途页面上下文死亡
(刷新/切走/关窗任一),19 分钟后用户又正常跑完了另一轮,轮次页却仍显示旧轮「执行中」。
磁盘物证:该轮产物目录只有 `cases.snapshot.json`,无 run.json、无报告、无证据——执行流从未
走到收口。

根因是**收口所有权错位**:轮次由服务端建(`appendRound(running)`),收口却只有前端
`settle()` 在流消费完后 PATCH 这一条路。客户端断开 → `req.signal` abort 杀掉 SDK 流 →
服务端流的 `cancel()` 只做 `reader.cancel()`,不写 run.json 不收口;前端的
`settle('aborted')` 随页面一起死了。唯一兜底是读侧 2h 惰性视图归一——孤儿轮要顶着
「执行中」挂近 2 小时。且「无法中途停止」(tech-debt #23)诱导用户用刷新当停止键,放大此缺陷。

修复 = **三层收口**(rounds.ts 模块头有完整描述):

| 层 | 机制 | 管什么 |
|----|------|--------|
| ① 服务端收口 | `createRoundKeeper`:wrapExecutionStream 的 done/cancel/error 三路径直接 `finishRound`;run 路由闸门 503/兜底 500 两处早退同样收口 | 流死、进程还活着(刷新/关窗/断网) |
| ② 心跳判活 | keeper 每 30s touch `{roundDir}/.alive`;rounds GET 先 `reapOrphanRounds`:心跳陈旧(>90s)或缺失且过启动宽限(120s,发起与执行是两次请求之间无心跳)→ **回写** aborted | 进程本身被杀(dev server 重启/应用退出) |
| ③ 惰性视图归一 | `normalizeStaleRounds`(running>2h,不回写) | 心跳文件写不进去等极端情况 |

配套约束:`finishRound` 支持 `ifRunning`(aborted 类收口仅 running→aborted 生效,流末端
竞态不得把服务端刚写的 done 降级);收口顺带清 .alive;done 收口摘要直接取归约内存值(counts/
suitePassStr),不再回读 run.json。心跳必须**定时器驱动**而非随帧写——SDK 长工具调用会静默
数分钟,随帧写会被误判死亡。存量孤儿轮(修复前留下的)在首次打开轮次页时自愈为「中断」。

为什么「执行面板已完成、轮次页还在执行中」能并存:面板 `libraryLive` 是内存态(跑完定格,
刷新即消失),轮次页读磁盘索引——一个数据源已死一个还活着,正是两套状态的裂缝暴露了孤儿轮。

- 单测:`test-rounds.test.ts`(ifRunning 终态保护/keeper 幂等/reap 判活边界/存量自愈复刻/零写放大)、`test-exec-stream.test.ts`(done→轮次 done+摘要;**cancel→aborted**——摘掉 cancel 收口该用例即红;stats.aborted→aborted;无 roundId 零影响)。
- 真机数据回放:mealAllowance `回归轮次.json` 副本过 `reapOrphanRounds`,RND-20260722-1450 running→aborted,其余 15 轮不动。

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

---

# v2 二/三期：治理（评审 · 隔离 · 健康度 · 复测轮 · 归因）（2026-07-10）

> 执行计划见 [regression-library-v2-phase23.md](../exec-plans/active/regression-library-v2-phase23.md)（决策日志/验证记录）
> 交互原型：Artifact `6b854a65-79f4-40bc-89ca-769a29c16680`（6 屏，本期 1:1 实现）

## 一句话

一期让回归「能跑、可信、可圈选」；二/三期让它**可治理**——用例有评审态与版本、坏用例能隔离且隔离本身被曝光、失败有 AI 归因、跨轮结果能横向对比、flaky/连败/久未跑有专门队列。

## 概念模型（读代码前必知）

| 概念 | 落点 | 一句话 |
|------|------|--------|
| **`_lib` 治理元数据** | `回归用例库.json` 每条 `entries[]` 里，与 `_source` 并列 | reviewState / rev / fingerprint / history / quarantined。**缺失即安全默认**（approved + r1 + 未隔离），存量零迁移 |
| **跨轮矩阵** | 无文件，`case-history.ts` **读侧现算** | 遍历近 20 轮 `run.json` + 快照 `idMap` 反解拼装。run.json 是唯一真相源，不物化 stats.json |
| **复测轮（failed-only）** | 轮次索引的 `mode` + `parentRoundId` | 基准轮的失败集合成一个**静态套件**再走 `evalSuite`，隔离/pinned/approvedOnly 三条口径自动一致 |
| **合并口径** | `mergedStats()` | 每条用例**截至该轮的最新结果**。复测轮的红线必须看它——只跑失败子集并全过，不等于可发版 |
| **失败归因** | `report/回归用例库/{roundId}/verdicts.json` | 归因是「这一轮的解读」，不是库用例的属性；随轮删除 |

## 核心模块

- **`src/lib/test/library.ts`（改）**：`LibMeta` + `readLibMeta`（宽松归一）+ `caseFingerprint`。
  - `depositTask` 按 `originalId` **继承** `_lib`：upsert 的语义是「刷新用例体」，评审态/隔离/rev 时间线是人工资产，不能被一次重新入库抹掉。指纹变化 → `rev+1` + 追加 history；首次入库 → `pending` + r1；存量条目（无指纹基线）→ 惰性回填，不误判为变更。
  - `buildRunnableCases` 同时剥离 `_source` 与 `_lib`——治理字段不该进 AI 执行 prompt。
  - `setReviewState` / `setQuarantine`（批量、幂等）、`sanitizeEntryKeys`（路由入参清洗）。
  - **新增 `seq` 写入序号**：`updatedAt` 是毫秒粒度，同毫秒两次写入无法区分，读侧缓存会漏失效。与 rounds/suites 同款。
- **`src/lib/test/case-history.ts`（新）**：`buildCaseHistory`（限流近 20 轮 + 进程内缓存，按 `seq` 失效）+ 派生纯函数 `execSeq/flips/tailFails/lastRunIdx/health/roundStats/mergedStats`。**阈值集中于此**（flaky=翻转≥2、连败=尾部≥3、久未执行=距最新轮≥3），与交互原型 `health()` 逐行等价，有单测钉死。
- **`src/lib/test/run-scope.ts`（新）**：`resolveRunScope` = 「本轮跑哪些用例」的**唯一实现**。发起弹窗的预检卡与发起接口都调它，所以「将执行 N 条」永远等于实跑条数。前端重算命中集是预览/实跑漂移的经典来源，明令禁止。`baseFailedCount`（基准轮失败数）与 `hits`（含 pinned 的实跑数）分开返回，UI 不得混用。
- **`src/lib/test/verdicts.ts`（新）**：归因读写 + `@@VERDICT` 行 harvest + prompt 构造。**规则内联**而非读 `rules/regression-verdict.md`——打包 standalone 下 `outputFileTracingExcludes` 会剥掉 `.md`，读文件会让 dev 与打包态给出不同质量的归因（那份 md 保留为人读规范）。
- **`src/lib/test/rounds.ts`（改）**：`pickBaseRound`（复测轮的基准**只取全量轮**，否则失败集逐轮收缩、漏掉真正没修好的用例）、`failedKeysOfRound`（非 pass 的任何终态都算失败）。

## API 路由（新增/改造）

| 路由 | 方法 | 作用 |
|---|---|---|
| `library/review` | POST | 批量评审态；审计 `library-review` |
| `library/quarantine` | POST | 隔离/恢复；审计 `library-quarantine` |
| `library/history` | GET | 跨轮矩阵 + 健康度派生 + 通过率趋势 + 隔离护栏（矩阵页与健康度页共用） |
| `library/verdict` | POST | AI 失败归因（SSE 透传；流尾 harvest 落 `verdicts.json`） |
| `library/run` | POST | 加 `mode`/`approvedOnly`/`parentRoundId`；范围解析下沉 `run-scope.ts` |
| `library/rounds` | GET | 复测轮附 `mergedPassStr`（合并口径）+ 全库 `quarantined` |
| `library/rounds/detail` | GET | 失败用例透传 `actual/error/evidence/api` + 该轮 `verdicts.json` + 隔离条数 |
| `suites/eval` | POST | 新增 `scope` 形态（按套件名/复测模式求值），供发起弹窗预检；构建器形态不变 |
| `suites` | GET | 加 `quarantinedCount` |
| `media` | GET | **加 `roundId`**（此前轮次维度的证据 `_evidence/{task}-{env}-{roundId}` 根本取不到） |
| `defect` | POST | **加 `roundId`**（此前只读平铺 run.json，对轮次转缺陷会读错数据） |

## UI（六个子页签）

`RegressionWorkspace` 的 `regTab`：用例库 / 回归套件 / 轮次历史 / **轮次报告** / **对比矩阵** / **健康度**。

- **用例库**：📌pinned / 评审态 / 健康度徽标 / 上次结果圆点 / rN；六个过滤器；多选 sticky 批量条（确认·加入套件·隔离·移除）；行点击开 **CaseDrawer**（步骤表 / 跨轮圆点+翻转连败 / rev 时间线 / 隔离说明与恢复 / 操作）。「加入套件」只列静态套件——查询套件保存的是**条件**，手工塞入会让「条件即真相」失效。
- **发起回归**：模式 radio（全量 / 仅复测上轮失败，无基准轮时禁用）+「仅执行已确认用例」+ 预检卡（条数/任务数/隔离排除数/待确认提示）+ 复测轮红线说明。
- **轮次历史**：通过率趋势线、环境过滤、失败轮「复测 N 条」直达（预置基准轮）、复测轮红线徽标显示合并口径、展开区带当轮快照摘要。
- **轮次报告**：红/绿横幅（**中断轮不给发版结论**——0/0 既不是可发版也不是不可发版）+ delta 三卡（点击过滤）+ 按任务分组小计 + 失败行展开（AI 归因 / 实际结果 / 错误 / 证据缩略图 / 转缺陷）+ **强制曝光「⛔ 隔离中 N 条未计入」**。
- **对比矩阵**：行=用例（按任务分组，首列 sticky）× 列=轮次；单元格点击跳该轮报告；行尾翻转/连败；「只看有失败的行」。对标 TestRail *Comparison for Cases*。
- **健康度**：5 张统计卡 + 三条队列（flaky / 连败 / 久未跑）+ 隔离区（可恢复）+ 护栏（隔离占比 >10% 告警）。**连败队列不给「隔离」按钮**——连败的正解是修，隔离会把真实回归藏起来。

## 红线口径（不变 + 新增）

- 发版红线仍是「回归集未全过 = 不可发版」。**`reviewState` 不参与红线**，只影响「仅执行已确认用例」开关与库内曝光——做成硬门禁会让存量项目一夜之间无法发版。
- **复测轮按合并口径评估**，不看自身通过率。
- **隔离不计红线，但每份报告横幅强制显示隔离条数**；占比 >10% 健康度页告警。隔离不是遮羞布。

## i18n / 审计

新增 `test.library.*` / `test.health.*` / `test.case.*` / `test.report.*` / `test.matrix.*` / `test.launch.*` / `test.rounds.*` 共 ~160 键；zh/en 手写，zh-HK 由 `gen-zh-hk.mjs` 生成。新审计动作：`library-review` / `library-quarantine` / `verdict-round`。

## 验证状态（2026-07-10，dev）

- `npm run test`：1903/2044 通过；**114 条失败与开工前 baseline 完全一致**（better-sqlite3 在 node 下的 ABI 不匹配，非本期引入）。新增单测 71 条（`test-library-meta` / `test-case-history` / `test-verdicts`）。
- curl 端到端：治理写盘幂等 + 审计留痕；复测轮圈选 = 基准轮失败集 ∪ pinned（跨任务撞号自动命名空间化）；**预检 `hits` ≡ 实跑 `total`**；**合并口径识破陷阱**（复测轮自身 3/3=100%，合并后 13/15 → 不可发版）；media 带 roundId → 200 / 穿越 → 400。
- CDP（mock 仅拦 workbench 项目列表，防污染用户真实数据）：六屏全链路，`/api/test/*` 零 console error；健康度六类分类与原型 `health()` 逐条一致；**护栏双向可逆**（隔离连败用例 → 告警出现、连败队列 1→0；恢复 → 反向）。
- ⚠️ **未验证（需凭证/打包）**：真实 AI 失败归因质量（dev 无登录体系 → `NO_CREDENTIALS`，本期以 mock `verdicts.json` 验证读侧与渲染）；打包验收。
- ⚠️ `npm run test:smoke` 在本 worktree 跑不了（Next 16 Turbopack 拒绝符号链接的 `node_modules`）。改用 `--webpack` 临时起 3000 验证：6 条失败，**回退到开工前提交后失败完全相同**，根因同为 better-sqlite3 ABI。

## 已知局限 / 未来

- **AI 就地复核**（同版本连跑 3 次判 flaky）与**自然语言转套件条件**：入口已置灰标注「即将推出」。跨轮翻转 ≠ 真 flaky（版本一直在变），健康度的 flaky 队列只是**候选**。
- **行身份漂移**：矩阵行身份 = `(来源任务, originalId)`；AI 重生成改 id 会让历史断开，本期不解决。
- 预检 **token 估算**仍缺数据源（一期遗留）。
- 批量移除走「逐条 DELETE」（库 DELETE 是单条/单任务口径），条数量级为个位数~百，可接受。

---

# 执行进展面板 + 标记解析统一（2026-07-10 事故后续）

## 事故：模型把 `@@RESULT` 加粗，整轮被误报为 0/3 全阻塞

模型输出的判定行是 `**@@RESULT {…}**`。`harvestResults` 的实现是「找到标记 → 把它之后的整段 `trim()` → `JSON.parse`」，尾部那两个 `*` 让解析抛异常，`catch` 块**静默丢弃**。三条判定全丢，`reduce` 用 `caseIds` 兜底把它们补成 `blocked`。模型真实判的是 **2 pass / 1 fail**。

排查之所以困难：**同一份文本有两套宽严不一的解析器**。`script-trace` 用正则抽 `{…}`（宽容），所以 trace 里 caseId、工具轨迹、截图录像一应俱全，唯独结果是空的。

## `src/lib/test/markers.ts`：唯一的标记解析实现

- 大括号配对 + 字符串/转义感知，从标记后取出恰好一个 JSON 对象；标记两侧的 `**` / 反引号 / 列表符 / 尾随文字一律忽略；行内无 `{` 则跳过（`| 已输出 @@RESULT 行数 | 3 |` 这类正文行不会被误采）。
- 解析失败不再静默：计入 `malformed`。
- **位置仍然宽容**（不要求标记在行首）。两类错误代价不对称：漏采一行 = 真实判定丢失被改写成 blocked（灾难）；多采一行 = 下游一律按 id 白名单过滤（`reduce` 按 `caseIds` 对齐 / 归因按快照 `idMap` 反解 / `applyRecommend` 只改 cases.json 已有 id），编造的 id 到不了任何地方（无害）。

接入点：`reduce.ts`（本次事故）、`exec-timing.ts`（否则耗时错挂到兜底补全的条目上）、`recommend.ts`、`verdicts.ts`（原用 `^@@VERDICT` 锚定行首，一加粗归因全空）。`script-trace.ts` 保留其宽容正则。执行步与归因 prompt 加了「标记行必须裸写」的约束。

## 事故：模型把 id 里的弯引号抄成直引号，pass 被报成 blocked

同一个症状（模型判 pass、报告写 blocked），另一个根因。真机 `forum-xc-sit / 20260722测试用例`：

- cases.json 里的 id 是 `1108941+菜单栏-更多-‘码’上合规的子标题更改`（弯引号 U+2018/U+2019）；
- 模型执行完、判定 pass、`@@RESULT` 裸写合规、执行总结也写着 `pass=1`——**只是把弯引号敲成了 ASCII 直引号** `'码'`；
- `reduce` 的 `caseIds` 对齐是精确字符串比对：认不出 → 真结果按「cases 之外的多余条目」丢弃 → 该用例兜底补成 `blocked` + `notExecuted`；
- 报告最终写「⛔ 回归集未全过（0/1）—— 存在阻塞级失败，不可发版」。

排查难点与上一起同源：**轨迹是全的**（`.trace.jsonl` 里 9 条动作、截图俱在），唯独判定成了「未执行」，看起来像执行阶段漏跑。

不能靠 prompt 修：`prompts.ts` 第 8 条早就写了「id 必须与 cases.json 完全一致」。把印刷体标点规整成 ASCII 是 LLM 抄写文本的固有行为，不是提示词不够严。**判定的正确性不能押在模型的抄写保真度上。**

### `src/lib/test/case-id.ts`：id 的「回贴」解析器

`canonicalCaseKey` 建一条只用于匹配的规范键通道（NFKC → 印刷体引号/破折号归一 → 去不可见字符与空白 → 小写），`createCaseIdResolver` 据此把模型回写的 id 认回 cases.json 的权威写法。三条纪律：

- **精确匹配永远优先**，回退只在精确失配时启用 → 本就抄对的 id 行为完全不变；
- **歧义不猜**：cases.json 里两条 id 规范化后撞键，该键即作废、谁都不走回退——宁可退回「未执行」也不能把 A 的结果记到 B 头上（判定张冠李戴比漏判危险）；
- **不做塞进多余结果的后门**：认不出的 id 原样返回，照旧被 `caseIds` 白名单过滤掉。

刻意不归一 CJK 的 `「」『』《》`——它们在中文标题里是结构符号（执行 prompt 还让模型用 `「」` 做内层引号），归过去反而制造歧义。

### 接入点（四处，都是同一个 join 的不同面）

`reduce.ts` 对齐后把 `tests[].id` 改写成权威写法，下游 `suiteIds`/`verificationById`/`taskOf` 因此自动对上。另三处在 `exec-stream.ts`，若不一起改会静默半瘫：

| 位置 | 不改的后果 |
|------|-----------|
| `reduce.ts` 的 `caseIds` 对齐 | 本次事故：pass 被丢、报成 blocked 不可发版 |
| 耗时表 `durations` | 报告不显示该用例耗时 |
| 落盘轨迹的 `caseId` | `selectEligibleCases` 按 `action.caseId === id` 过滤 → 0 条动作，脚本生成没有依据 |
| 增量脚本喂料 `caseById` | 查不到 caseBody → 该用例静默不入队，回归脚本永远沉淀不下来 |

轨迹侧仍按**模型写的** id 取（`@@CASE_START` 与 `@@RESULT` 出自同一次输出、漂移一致），只在带出去时挂权威 id。

- 单测：`case-id.test.ts`（归一/歧义/不猜）、`test-reduce.test.ts`「id 印刷体标点漂移」组、`script-incremental.test.ts` 同名用例。把解析器改回纯精确比对，这几条会红。
- 重放：用真机 cases.json + `.trace.jsonl` 里模型真实回写的 id 跑 `reduceFromText`，`{pass:0, blocked:1}` → `{pass:1, blocked:0}`，`suitePassStr` `0/1` → `1/1`。

## `src/lib/test/exec-live.ts`：客户端同口径

前端原来也在 `InlineTestingPanel` 里就地用「indexOf + slice + JSON.parse」解析 `@@RESULT`——**功能测试的实时四态与用例列表同样会因加粗而全空**（只是当时那轮没加粗）。现在下沉为客户端安全模块，与服务端共用 `markers.ts`：

- `classifyExecLine`：`@@RESULT` / `@@CASE_START` / `▶ 进度行` / 普通正文；进度行连带剥掉「用例 N/总数：」前缀；markdown 分隔线不进 AI 气泡。
- `resultMalformed`：含判定标记却解不出的行**显式暴露**。
- `createExecLineBuffer`：SSE 会把一行切成多帧，必须先拼回整行再分类。

## 回归执行进展面板（`RegressionLivePanel`）

发起回归后就地展开，替换原来那条只有一句话的运行状态行。**不保留历史**：状态活在内存，跑完定格为本次快照，切走/刷新即消失；收口后的事实见「轮次报告」页。

- 折叠 = 一行摘要（状态点 / 当前用例 / 进度条 / 四态 chip）。
- 展开 = 左侧用例进度 + 右侧**按用例分段**的执行流：通过的自动收起、失败与无判定的保持展开并挂红边、工具轨迹折叠成「N 步」。
- 跑完却没收到判定的用例显示「⚠ 无判定」而**不是骗人的「待执行」**——它明明跑完了，这个区分正是事故难查的关键。

### 对账条

正常时一行安静的 `✓ 判定 3/3 与执行一致`；背离时展开三源读数（工具活动 N 步 · 已开始 M 条 · 已收到判定 K 条 · 无法解析的判定行 J）。

**锚点是 `tool_use` 计数**，不是 `@@CASE_START` / `@@RESULT`——后两者都是模型自由文本，同一次 markdown 装饰会把它们一起污染、让背离被掩盖；`tool_use` 是 SDK 结构化帧，与格式漂移无关。

**中断与判定丢失显式区分**：中断的轮天然缺判定，混为一谈会让真事故淹没在噪音里。

### `drive()` 重构（唯一实质行为改动）

`runLibrary` 原来把 SSE 直接排空（只判 `done`）。现在解析并上抛 live 状态：

- **只认执行步的 `run_json`**：报告步流末也发一条，套用它会把已算好的盘面清零。
- 解析 `result{is_error:true}`：会话级失败（限流/鉴权）只发这一帧、没有 `error` 帧，不解析它面板会一路假绿到收口。
- 缺 `@@CASE_START` 时按 `▶` 行序号兜底切段（模型可能漏输出机器标记）。
- 「收口中」是推断态：最后一条判定到 `run_json` 之间服务端在做证据归集与归约、不发任何帧；超时转「疑似卡住」。
- 报告步不流详情，执行步收口即冻结。

**已知缺口**：`runLibrary` 没有 AbortController（功能测试有），因此面板只读进度、不能中途停止。

## 顺带修复：回归轮次的脚本生成从来没成功过

`script-job-manager.currentInputs` 用 `artifactPaths(taskName, env)` 取 run.json，而 v2 起回归执行的产物落 `report/{task}/{roundId}/`，平铺路径下没有这个文件（审计里那条 `generate-scripts ... ENOENT`）。`ScriptJobRequest` 加 `roundId`，`exec-stream` 透传。与此前修的 `media` / `defect` 路由同属一类：v2 一期迁移产物路径时漏改的调用方。

## 验证

- 单测：`test-markers`（+24）、`test-exec-live`（+20）、`test-script-generation`（+3），全部以**线上真实模型输出**作夹具。
- 重放：用 `~/.claude/projects/…jsonl` 里那次真实会话重跑 `reduceFromText`，`{pass:0, blocked:3}` → `{pass:2, fail:1}`。
- CDP：把同一份会话记录转成 SSE 帧回放三个剧本 —— 正常轮走到「执行中 · 用例 2/3」并收口 2/3；判定行被破坏时面板在**第一条用例结束时就亮红**、三条标「⚠ 无判定」、并退回 `▶` 行兜底切段；`error` 帧时对账条显示「执行已中断」而非「判定丢失」。
