# 测试工作台:回归用例库(自动沉淀 + 跨任务一键重跑)实施计划

> 状态:**批 A-E 代码完成,dev 全绿;真实 AI 执行 + 打包待验** | 分支:V3.1.0_dev | 创建:2026-07-08
> 依赖:回归集标签特性([test-regression-gate-audit.md](./test-regression-gate-audit.md),已合并 PR #8)
> 一句话:每个测试任务在**用例设计完成后**,自动把打了「回归测试」标签的用例沉淀进**项目级回归用例库**;库可查看/管理,并能作为**跨任务回归套件一键重跑**。

## 0. 决策日志(用户 2026-07-08 拍板)

| # | 决策点 | 结论 |
|---|--------|------|
| 1 | 入库范围 | **全部打了「回归测试」标签的用例**,不看本次执行结果(pass/fail 都入;库=该任务的回归集定义,失败的回归用例恰恰最该留着下次重跑) |
| 2 | 入库时机 | **用例设计步完成后自动入库**(不等执行/报告)。与 #1 自洽:不依赖执行结果,用例设计好即可沉淀 |
| 3 | 本轮范围 | 含**跨任务一键重跑**:除自动沉淀 + 查看/管理库,还要能把整个库作为跨任务套件重新执行 |

## 1. 设计默认(未单独问、按下列默认执行,实现中如遇冲突再澄清)

| 点 | 默认 | 理由 |
|----|------|------|
| 作用域 | **项目级**,落 `AI_LabTest/testCase/回归用例库.json` | 与 AI_LabTest 一致每项目独立;一个项目=一个被测系统,环境/URL 可共享 |
| 去重/更新 | **upsert by 来源任务**:某任务再次入库,覆盖它上次的全部贡献(非追加) | 重复跑/改用例不产生重复;任务回归集缩小(某用例掉了标签)库同步移除 |
| 溯源 | 每条库用例记 `_source:{ task, originalId, depositedAt }` | 查看时可见来源、可按任务移除、重跑报告可按任务分组 |
| id 命名空间 | 库内执行 id 保证唯一:跨任务 originalId 冲突时用 `{task}::{originalId}`,不冲突保留原 id;展示「来源任务 · 原ID」 | 执行/归约按 id 索引,跨任务 TC-001 会撞;命名空间避免 @@RESULT 串号 |
| 重跑落点 | 保留任务名 **`回归用例库`**(通过 `isUnsafeSegment`),聚合写入其 `cases.json`,复用现有执行+报告机器,打项目 `environments.json` 环境;产物落 `report/回归用例库/` | 零新增执行逻辑,最大复用;报告/run.json/证据全部沿用 |
| 触发实现 | 后端 cases 步流结束 wrap 时 deposit(UI 无关、确定性);另在 `edit-cases` 保存、`recommend-suite` apply 后 re-sync,防库 stale | 与 wrapExecutionStream/wrapRecommendStream 同构;后端触发不依赖面板开着 |
| 审计 | 入库记 `deposit-library`、重跑记 `run-library`、移除记 `library-remove`(复用 audit.ts,action 枚举扩充) | 与门控/推荐同一留痕体系 |
| 自动入库失败 | 静默、fire-and-forget、不阻塞 cases 步主流程 | 与 appendAudit 同策略;库是增强,不该拖垮出用例 |

## 2. 数据模型

### 2.1 库文件 `AI_LabTest/testCase/回归用例库.json`
```jsonc
{
  "version": 1,
  "updatedAt": "2026-07-08T...Z",
  "entries": [
    {
      // 原 GeneratedCase 全字段原样保留(id/caseType/requirement/priority/purpose/
      //  precondition/steps/assertion/oracle/verification/cleanup/tags)
      "id": "TC-003",                         // 原任务内 id(展示用)
      "caseType": "...", "purpose": "...", "steps": [...], "tags": ["回归测试"], ...,
      "_source": { "task": "设备预约系统", "originalId": "TC-003", "depositedAt": "ISO" }
    }
  ]
}
```
- 库以 **entries** 命名(区别于任务 cases.json 的 `cases`),避免误当普通用例文件被别处消费。
- 只收 `tags` 含「回归测试」的用例;`_source.task` 是 upsert 主键维度。

### 2.2 聚合成可执行 cases 集(重跑用)
`buildRunnableCases(library)` → `{ cases: [...], idMap: Map<runId, {task, originalId}> }`
- 遍历 entries,分配唯一 runId(冲突加 `{task}::` 前缀),产出标准 `{cases:[...]}` 结构写入 `回归用例库.cases.json`;
- idMap 供重跑报告把 @@RESULT/run.json 的 runId 反解回「来源任务 · 原ID」。

## 3. 分批实现

### 批 A — 数据层(纯逻辑 + 单测,不碰 UI/凭证)
**新增** `src/lib/test/library.ts`:
- `libraryPath(taskName?)`、保留任务名常量 `REGRESSION_LIBRARY_TASK = '回归用例库'`;
- `readLibrary(projectPath): Library`(缺文件→空;健壮解析,仿 applyRecommend 容错);
- `depositTask(projectPath, taskName, cases): {added,removed,total}` —— 从 cases 过滤 `tags.includes('回归测试')`,**upsert by task**(先删该 task 旧 entries,再插当前);`.tmp`+rename 原子写;
- `removeEntries(projectPath, pred)` / `listByTask(library)`;
- `buildRunnableCases(library)` —— id 命名空间 + idMap。
- **改** `src/lib/test/prompts.ts` `artifactPaths`:加 `library` 路径 + 导出保留任务名。
- **改** `src/types/index.ts`:`RegressionLibrary` / `LibraryEntry` 类型。
- 单测 `src/__tests__/unit/test-library.test.ts`:deposit 首次/重复(upsert 不重复)/标签缩小同步移除/空库/健壮解析/命名空间冲突/idMap 反解。

**验收**:`npm run test` 绿;deposit/upsert/aggregate 逻辑单测覆盖。

### 批 B — 用例设计完成后自动入库
- **新增** `wrapCasesStream(src, {projectPath, taskName})`(run/route.ts,仿 wrapExecutionStream):透传 SSE;流尾 read 该任务 cases.json → `depositTask` → `appendAudit('deposit-library')` → (可选)补发 `{type:'library_updated', data:{added,...}}` 帧。失败静默。
- **改** run/route.ts:`step==='cases'` 用 `wrapCasesStream` 包装(其余步不变)。
- **改** InlineTestingPanel.tsx:`edit-cases` 保存后、`recommend-suite` apply 后 → fire-and-forget `POST /api/test/library/deposit`(re-sync);`library_updated` 帧 → toast「已沉淀 N 条回归用例到回归用例库」。
- **新增** `POST /api/test/library/deposit`(供前端 re-sync;taskName 过 isUnsafeSegment)。
- i18n。

**验收**:跑用例设计 → `回归用例库.json` 出现该任务回归条目;改标签重跑 → 无重复、随标签增删;编辑用例保存后库同步。

### 批 C — 库查看 / 管理 UI
- **新增** `GET /api/test/library`(按来源任务分组返回)+ `DELETE /api/test/library`(移除某条/某任务贡献)。
- **改** InlineTestingPanel.tsx:项目级「回归用例库」入口(任务列表区,与「运行任务」同层)→ 弹窗:按来源任务分组列条目(展示「来源任务 · 原ID · 标题 · 标签」)、单条/按任务移除、导出(复用 export 逻辑)。
- i18n 三文件。

**验收**:CDP 打开库弹窗,条目与已跑任务回归集一致;移除生效;导出 xlsx。

### 批 D — 跨任务一键重跑
- **新增** `POST /api/test/library/run`:`readLibrary`→`buildRunnableCases`→写 `回归用例库.cases.json`→驱动执行(**复用 run/route 执行 step 的 streamClaude 调用**,taskName=保留名,env 走项目 environments.json)→ wrapExecutionStream 归约(suiteIds=全部,因库即回归集)→ 报告落 `report/回归用例库/`。`appendAudit('run-library')`。
- **改** InlineTestingPanel.tsx:库弹窗「一键重跑」按钮 → 进度(复用执行进度 UI)→ 完成查看报告(复用 ReportView,report/回归用例库/)。报告内按 `_source.task` 分组展示(idMap 反解)。
- 可达性闸门/登录态注入沿用执行步现有逻辑。

**验收**:库含 2+ 任务的回归用例 → 一键重跑 → 逐条执行 → 报告含跨任务分组 + 回归集口径通过率;报告红线规则(未全过→不可发版)沿用。

### 批 E — 收尾
- 单测补齐(deposit 触发、library API、run 聚合);`npm run test` 全绿。
- i18n 三文件(zh/en/zh-HK)强类型齐。
- 双文档:`docs/handover/regression-library.md` + `docs/insights/regression-library.md`(互反链);更新 handover/insights README 索引。
- CDP mock 全链路验证(dev 无凭证→AI 真跑打标/重跑执行需**打包登录后**或注入 key 补验,结论如实标注)。

## 4. 验证与交付纪律
1. 每批 `npm run test` → CDP mock 全链路(preview_start 读**父目录** `/Users/jiah/AILab/.claude/launch.json`,配置名 `labcodepilot`=3001)。
2. 自动入库/库 UI/重跑均 UI+执行行为,**打包验收**(mac+Win),BUILD_ID 核对包版本。
3. push 前 `git fetch + rebase`(V3.1.0_dev 多人并行);push 由用户执行。
4. **真跑 AI 依赖凭证**:dev env 模式 NO_CREDENTIALS、managed key 无主密钥解密为空;A1 打标质量 + 库重跑真实执行需打包登录后或注入 BYOK key 验证。

## 5. 风险与回滚
| 风险 | 缓解 |
|------|------|
| 跨任务 id 冲突致 @@RESULT 串号 | buildRunnableCases 命名空间 + idMap 反解,单测覆盖冲突场景 |
| 库与任务用例 stale(改了任务用例库没更新) | upsert by task + edit/recommend 后 re-sync;库条目带 depositedAt 可见新鲜度 |
| 重跑环境不匹配(不同任务不同 URL) | 项目级单一 environments.json;跨项目不聚合(库项目级);文档说明「一个项目一个被测系统」前提 |
| 自动入库拖垮 cases 步 | fire-and-forget、静默失败、不阻塞流 |
| 保留任务名与用户真实任务同名冲突 | `回归用例库` 作保留名;若用户已有同名任务,建任务侧后续加校验(记 tech-debt) |
| 库文件损坏 | 读侧健壮解析(缺/坏→空库+告警),写侧 .tmp+rename 原子 |
| 回滚 | 各批独立 commit 可单独 revert;库是增量特性,删文件/关入口即回退,不影响既有流程 |

## 6. 进度跟踪
| 项 | 状态 | commit |
|----|------|--------|
| 执行计划文档 | ✅ 完成 | |
| 批 A 数据层+单测 | ✅ 完成(18 单测绿) | |
| 批 B 自动入库触发 | ✅ 完成(curl 端到端:幂等/标签同步/审计) | |
| 批 C 库查看/管理 UI | ✅ 完成(API + CDP 模态渲染/移除落盘) | |
| 批 D 跨任务一键重跑 | ✅ 完成(CDP:聚合+执行+报告 suiteCounts 2/2 红线) | |
| 批 E 单测+i18n+双文档 | ✅ 完成(双文档互反链+索引) | |
| B3 改造 AI 推荐可视化审阅(用户 07-08 反馈) | ✅ 完成(review 模式+apply 接口+RecommendReviewModal,CDP mock 验) | |
| 打包验收(mac+Win) | ⬜ 待用户发起 | |
