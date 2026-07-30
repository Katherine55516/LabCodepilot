# 冒烟测试（测试工作台第三形态）（技术交接）

> 产品思考见 [docs/insights/smoke-test.md](../insights/smoke-test.md)
> 执行计划（决策日志/验证记录）见 [docs/exec-plans/active/smoke-test.md](../exec-plans/active/smoke-test.md)
> 方案与原型见 [docs/research/smoke-test-feature-proposal.md](../research/smoke-test-feature-proposal.md) + `docs/research/prototypes/smoke-test-prototype.html`

分支：dev_202608_testFeat（2026-07-30）。Commits：`0102599`（Phase 1-3 底层）→ `9451acb`（Phase 4 UI 主链）→ Phase 5-6（报告与复核）。

## 一句话

把用户手工投喂的「冒烟测试提示词」产品化为测试工作台**第三段页签**：手动录入测试场景（验证目标 + 预期结果，不含操作步骤）→ **无门控**创建即自动执行 → 冒烟报告（结论横幅 + Bug 可复核列表 + 体验问题）。环境沿用现有配置，执行/归约/报告机器全量复用。

## ⚠️ 读代码前必知（三条口径铁律）

1. **冒烟是任务子类型，不是回归那样的独立工作区**。`Project.tasks[].type?: 'smoke'`（缺省 = 功能任务，判定一律 `=== 'smoke'`），走既有任务机器（看板/flow/runStep/auto-chain/报告区），仅按 type 裁剪节点 + 换 prompt。回归的库/套件/轮次结构冒烟一概不用。
2. **场景落盘为 cases.json 极简用例，`tags` 恒空、`verification` 恒「功能验证」**。带「回归测试」标签会被 `depositTask` 收进回归用例库并触发发版红线；标「回归基线」会被 funcCounts 排除、通过率变 N/A。两条都有单测锁死（`test-smoke-scenarios.test.ts`）。注意 `CASE_TAGS` 里既有的「冒烟测试」**标签**是功能用例上的人工标注（无程序消费），与冒烟**形态**是两回事。
3. **run.json 只读、人工只写旁路**。Bug 复核的人工字段（严重级别/备注）落 `{任务}-{env}.bugs.json` 覆盖层，绝不写进 run.json（确定性归约产物，四态由代码算）。

## 数据流

```
新建冒烟任务（NewSmokeTaskModal，必填 3 项：模块名称/模块入口/测试场景）
  → 前端 scenarioTextToCases() 解析（容错 6 种分隔符/序号/缺预期不臆造）
  → PUT /api/test/cases 落 testCase/.data/{任务}.cases.json（SM- 前缀极简用例）
  → addSmokeTask：tasks[] 写 {type:'smoke'} + TaskState.moduleEntry；
    stepStatus 预置 requirement/cases=done（无门控）
  → pendingSmokeRun effect（等选中态落定）→ startRunAllFrom('execution')
    （复用既有并发/排队/auto-chain）
  → runStep 带 taskType/moduleEntry/dataPrefix(前端按本地日期生成)
  → POST /api/test/run → buildStep 按 taskType==='smoke' 分流 prompt 变体
  → 执行（自主探索 + @@RESULT 四态 + @@OBSERVATION 体验观察）
  → wrapExecutionStream → reduceFromText（观察自动归约进 run.json.observations[]）
  → 报告步（五节固定结构 + 结构化 Bug 字段）→ report/{任务}/{任务}-{env}.md
  → 报告区 ReportView（taskType='smoke'）：结论横幅 + Bug 复核列表 + 体验问题
```

## Prompt 层（`src/lib/test/prompts.ts`）

- `SMOKE_SYS`：三步各自的冒烟角色 system prompt（场景整理员/冒烟执行/冒烟报告员）。
- `smokeScenariosPrompt`（cases 步，实际上无门控流程下**通常不跑**——场景由前端直落盘；保留它是为了「AI 重新归整」类操作与 revise 场景）：只审不改写、禁臆造/增删、保护 tags/verification。
- `smokeExecutionPrompt`：自主探索式（场景无预设步骤，先 snapshot 再操作）、数据前缀铁律 `冒烟测试_{YYYYMMDD}_`（前端下发防跨零点）、写操作只针对自建数据（需要"任选一条"必须先自建）、失败不中断（依赖场景判 blocked）、`@@OBSERVATION` 体验观察（与四态正交）；保留既有全部契约（@@CASE_START/@@RESULT 裸写、登录态三分支、非交互护栏、覆盖自检、探活声明）。
- `smokeReportPrompt`：五节固定（环境/场景结果表/Bug 清单/体验问题/整体结论）；Bug 按**固定字段**输出（编号/标题/严重级别/关联场景/实际/预期/接口/证据）供服务端解析；结论口径 = 主流程通不通 + 能否进入下一阶段；**不出**需求覆盖矩阵/双口径/回归红线。
- `rules/smoke-test.md` + 每个变体的 `ruleBlock` fallback：打包 standalone 剥 .md，**fallback 必须一次写足**（单测 chdir 模拟打包态验证）。

## Bug 复核（Phase 5 核心）

### 三层数据模型（`src/lib/test/smoke-bugs.ts` 纯函数 + `/api/test/bugs` 薄壳）

| 层 | 来源 | 落盘 |
|---|---|---|
| 事实层 | run.json fail 场景 1:1（`deriveBugs`），actual/api/evidence 直引 | 不落盘，GET 现场派生 |
| AI 初判层 | 报告 md 行扫描（`parseMdBugInfo`：标题→严重级别→关联场景 顺序暂存归位；只扫「Bug 清单」章节；同场景多条先到先得） | 不落盘；漂移回退默认「严重」 |
| 人工覆盖层 | 严重级别覆盖（`severityOverriddenFrom` 保留 AI 原判）+ 备注 | `report/{任务}/{任务}-{env}.bugs.json`（原子写，**runHash 绑定**） |

### API 合同

- `GET /api/test/bugs?projectPath&taskName&env` → `{ok, runHash, bugs}`（派生+初判+覆盖合并；无 run.json → `runHash:null, bugs:[]`）。
- `PUT {projectPath, taskName, env, runHash, patch:{sceneId, severity?, note?, severityOverriddenFrom?}}` → 覆盖层 upsert；`runHash` 与当前 run.json 不符 → **409**（前端重拉）；非法 severity → 400。runHash 变化时旧文件整体丢弃重建（`upsertBugOverride`）。

### 复核动作 = 既有 report_reviewed 事件（零新事件类型）

Bug 行的三个动作直接复用 ReportView 的 `markAccurate`/`markBad`/`undoReview`（sceneId 即 caseId）：确认缺陷→`accurate`、误报→`false_fail`、程度不符→`severity_mismatch`；批量确认→`report_review_bulk`。与上方场景表**同一份 reviews 态**双向联动，DB 回显（`/api/test/stats?scope=reviews`）、准确度 KPI（reviews_accurate）全部原样生效。

### 结论横幅（`smokeVerdict`，双记录）

有 fail → 未通过；**全部** fail 复核为误报 → 「通过（经人工复核，N 项误报已排除）」但 AI 原判保留在场景表/报告 md（复核只影响横幅表述，不改事实数据）；无 fail 有 blocked → 未完成（不得报通过）；全 pass → 通过。

## 关键文件

**新增**：`src/lib/test/smoke-scenarios.ts`（场景解析/互转/前缀，纯函数）、`src/lib/test/smoke-bugs.ts`（Bug 派生/md 解析/覆盖合并/结论，纯函数）、`src/app/api/test/bugs/route.ts`、`src/lib/test/rules/smoke-test.md`、单测 ×4（scenarios 24 / prompts 30 / observations 14 / bugs 25）。
**改动**：`prompts.ts`（SMOKE_SYS + 3 变体 + BuildStepOptions.taskType/moduleEntry/dataPrefix + buildStep 分流）、`reduce.ts`（harvestObservations + RunJson.observations）、`run/route.ts`（三字段透传）、`reports/route.ts`（observations 透传）、`InlineTestingPanel.tsx`（三段页签/visibleTasks 过滤保原始下标/NewSmokeTaskModal/addSmokeTask/pendingSmokeRun effect/stepLabel/ReportView 冒烟扩展/cases_approved 冒烟不发）、`types/index.ts`（TestTaskType/SmokeBug/SmokeBugsFile）、i18n ×3（`test.smoke.*`）。

## 埋点口径

- `task_created` 带 `payload.taskType:'smoke'` + `source:'smoke_manual'`。
- **冒烟不发 `cases_approved`**：从未有「AI 生成→批准」环节，发了会污染采纳率口径（无首轮基线可 diff）。
- `step_completed`/`execution_completed`/`report_generated` 照发（冒烟是真实测试活动）；复核走 `report_reviewed`（准确度 KPI 天然计入）。
- Stats 看板冒烟分桶、usage-rollup `smoke_*` 上报 = P2（未做）。

## 验证状态（2026-07-30，dev）

- `npm run test:unit` 2439 pass / 0 fail（新增 93 条）；typecheck 0。
- API curl 合同：GET 派生+初判+覆盖合并、PUT 200/409/400、bugs.json 原子落盘。⚠️ curl 直打需 URL 编码中文（Node 拒绝原始字节请求行）；前端 encodeURIComponent 不受影响。
- CDP 端到端（隔离 `CLAUDE_GUI_DATA_DIR` + 临时项目，未碰真实 workbench）：三段页签、新建弹窗实时解析（4 种分隔符 + 缺预期计数）、创建即执行、三节点流水线、报告全交互（横幅三态翻转/severity 覆盖落盘/备注持久化/复核事件 DB 回显/体验问题渲染）、console 零代码报错。
- **未验证（需打包+登录）**：真实 AI 执行的自主探索质量、@@OBSERVATION 遵从性、打包态 fallback 规则实跑效果。

## 已知边界

- 冒烟场景质量取决于用户录入（验证目标写太粗会让自主探索发散）；表单提示语 + 解析预览是软约束。
- Bug↔场景 1:1：报告 AI 对同一场景产多条 Bug 时先到先得（`parseMdBugInfo`），复核退化为对该场景的单一判定。
- 流程内联报告（flow 视图）不含 Bug 复核（与既有「复核仅报告区」口径一致，canReview 需 taskId+runHash）。
- 任务形态创建后不可改（形态决定流水线与 prompt，中途切换产物对不上）。
