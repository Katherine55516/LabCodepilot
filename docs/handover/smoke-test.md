# 冒烟测试（测试工作台第三形态）（技术交接）

> 产品思考见 [docs/insights/smoke-test.md](../insights/smoke-test.md)
> 执行计划（决策日志/验证记录）见 [docs/exec-plans/active/smoke-test.md](../exec-plans/active/smoke-test.md)
> 方案与原型见 [docs/research/smoke-test-feature-proposal.md](../research/smoke-test-feature-proposal.md) + `docs/research/prototypes/smoke-test-prototype.html`

分支：dev_202608_testFeat（2026-07-30）。Commits：`0102599`（Phase 1-3 底层）→ `9451acb`（Phase 4 UI 主链）→ Phase 5-6（报告与复核）。

## 一句话

把用户手工投喂的「冒烟测试提示词」产品化为测试工作台**第三段页签**：手动录入测试场景（验证目标 + 预期结果，不含操作步骤）→ **无门控**创建即自动执行 → 单一「冒烟测试报告」。环境沿用现有配置，执行/归约/报告机器复用，但冒烟不生成 Excel、独立缺陷报告或回归脚本。

## ⚠️ 读代码前必知（四条口径铁律）

1. **冒烟是任务子类型，不是回归那样的独立工作区**。`Project.tasks[].type?: 'smoke'`（缺省 = 功能任务，判定一律 `=== 'smoke'`），走既有任务机器（看板/flow/runStep/auto-chain/报告区），仅按 type 裁剪节点 + 换 prompt。回归的库/套件/轮次结构冒烟一概不用。
2. **场景落盘为 cases.json 极简用例，`tags` 恒空、`verification` 恒「功能验证」**。带「回归测试」标签会被 `depositTask` 收进回归用例库并触发发版红线；标「回归基线」会被 funcCounts 排除、通过率变 N/A。两条都有单测锁死（`test-smoke-scenarios.test.ts`）。注意 `CASE_TAGS` 里既有的「冒烟测试」**标签**是功能用例上的人工标注（无程序消费），与冒烟**形态**是两回事。
3. **run.json 只读、人工只写旁路**。Bug 复核的人工字段（严重级别/备注）落 `{任务}-{env}.bugs.json` 覆盖层，绝不写进 run.json（确定性归约产物，四态由代码算）。
4. **整站登录态失效是机器终态，不是普通 blocked**。AI 必须裸写 `@@AUTH_INVALID {"reason":"login_state_invalid"}`；服务端收到后立即 abort agent、取消上游、不归约本轮 run.json，前端把 execution 收口为 `error` 并保持 report `idle`。不要把它改回“剩余场景逐条 blocked + 正常 EOF”，否则 auto-chain 会再次生成无意义冒烟报告。

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
    ↘ 若整站登录态失效：@@AUTH_INVALID → 服务端硬停止 → UI 提示用户，跳过报告
  → wrapExecutionStream → reduceFromText（观察自动归约进 run.json.observations[]）
  → 报告步（五节固定结构 + 8 列 Bug 表格）→ report/{任务}/{任务}-{env}.md
  → wrapReportStream 按 run.json 校验/规范化 Bug 表格
  → 流程页/报告页：单张报告卡（状态 + Bug 数 + 整体结论）
  → 查看报告：PreviewModal 大弹窗展示完整 Markdown 五节
```

## Prompt 层（`src/lib/test/prompts.ts`）

- `SMOKE_SYS`：三步各自的冒烟角色 system prompt（场景整理员/冒烟执行/冒烟报告员）。
- `smokeScenariosPrompt`（cases 步，实际上无门控流程下**通常不跑**——场景由前端直落盘；保留它是为了「AI 重新归整」类操作与 revise 场景）：只审不改写、禁臆造/增删、保护 tags/verification。
- `smokeExecutionPrompt`：自主探索式（场景无预设步骤，先 snapshot 再操作）、数据前缀铁律 `冒烟测试_{YYYYMMDD}_`（前端下发防跨零点）、写操作只针对自建数据（需要"任选一条"必须先自建）、失败不中断（依赖场景判 blocked）、`@@OBSERVATION` 体验观察（与四态正交）；保留既有全部契约（@@CASE_START/@@RESULT 裸写、登录态三分支、非交互护栏、覆盖自检、探活声明）。登录态三分支在冒烟模式下共用 `@@AUTH_INVALID` 硬停止协议，明确区分整站会话失效与个别权限/单接口 401。
- `smokeReportPrompt`：五节固定（环境/场景结果表/Bug 清单/体验问题/整体结论）；Bug 按固定 8 列 GFM 表格输出（编号/标题/严重级别/关联场景/实际/预期/接口/证据），fail 场景 1:1；结论口径补齐 fail/blocked/partial/pass；**不出**需求覆盖矩阵/双口径/回归红线。
- `rules/smoke-test.md` + 每个变体的 `ruleBlock` fallback：打包 standalone 剥 .md，**fallback 必须一次写足**（单测 chdir 模拟打包态验证）。

## 登录态整体失效硬停止（Phase 10）

旧链路只有提示词“立即停止”，平台无法理解 AI 的自然语言。AI 即使口头宣布停止，SSE 仍是正常 EOF；`runStep.finally` 因没有 error/abort 把 execution 置 `done`，auto-chain 随即启动 report。

新链路分四层：

1. `prompts.ts` / `rules/smoke-test.md`：确认整站登录墙后输出唯一控制行 `@@AUTH_INVALID {"reason":"login_state_invalid"}`，标记后禁工具、禁后续结果、禁总结。
2. `markers.ts` + `exec-live.ts`：控制行必须位于剥除 Markdown 装饰后的行首，避免正文讲解协议时误停；支持 SSE 跨帧拼接，机器行不展示给用户。
3. `wrapExecutionStream`：仅 `taskType==='smoke'` 开启识别；标记可跨 text 帧，识别后 abort 真实 agent、cancel 上游、发 `auth_invalid` 结构帧并关闭，不走 EOF 的 run.json/统计/脚本沉淀。
4. `InlineTestingPanel.runStep`：收到机器行或结构帧后只显示本地化平台提示，execution=`error`、report=`idle`、释放 autoRun。兼容旧模型的兜底仅认“权威 tests 全 blocked + 至少一条明确登录失效证据”；其它 blocked 仍照常生成报告。

## 单一报告交付（Phase 11）

- **用户可见产物只有一份**：流程页和报告页都只显示「冒烟测试报告」卡片；卡片只含报告状态、Bug 数量和不带场景计数的整体结论。环境/时间、场景结果、体验观察只在完整报告弹窗中展示。
- **完整报告仍保留五节**：点击「查看报告」复用 `PreviewModal` 居中大弹窗，渲染完整 Markdown；Bug 清单固定为 8 列表格。`ensureSmokeReportBugTable` 在服务端收口时规范化新报告，UI 打开/编辑/导出时再兜底历史逐字段报告，因此不是只靠模型遵从提示词。
- **截图文件名可直接打开**：冒烟报告表格中整格为安全媒体 basename（支持图片及录像、支持多个文件）时，`MdPreview` 会复用 `/api/test/media` 白名单接口渲染为可点击按钮，并通过 Portal 灯箱查看；正文中的文件名、路径、URL 保持普通文本，功能测试 Markdown 不启用该转换。
- **不生成或展示副产物**：冒烟隐藏执行矩阵 Excel、独立缺陷报告、回归脚本、对比/缺陷页签和「交给研发修复」。旧文件只隐藏，不删除。
- **脚本前后端双保险**：新任务显式存 `depositScripts:false`，所有冒烟运行入口隐藏开关并传 false；`resolveDepositScripts` 在 `/api/test/run` 以 `taskType==='smoke'` 强制 false，覆盖 execution/report 两条包装链，即使旧客户端传 true 也不能绕过。
- **功能测试保持原样**：缺省 task type 仍走四张产物卡、自动缺陷报告、脚本轮询/重试、报告对比与研发交接。

## Bug 复核（Phase 5 核心）

> Phase 11 后这套复核数据/API 仍保留兼容性，但不再作为冒烟报告的用户可见入口；完整报告
> 以只读/编辑 Markdown 表格呈现。以下内容记录 Phase 5 的底层结构，避免历史数据失读。

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

**新增**：`src/lib/test/smoke-scenarios.ts`（场景解析/互转/前缀，纯函数）、`src/lib/test/smoke-bugs.ts`（Bug 派生/md 解析/表格规范化/状态归约/覆盖合并）、`src/lib/test/run-options.ts`（脚本开关服务端归一化）、`src/app/api/test/bugs/route.ts`、`src/lib/test/rules/smoke-test.md`。
**改动**：`prompts.ts`（SMOKE_SYS + 3 变体 + 固定 Bug 表格/四态结论）、`markers.ts` / `exec-live.ts` / `exec-stream.ts`（登录失效硬停止 + 冒烟报告表格收口）、`reduce.ts`（observations）、`run/route.ts`（冒烟硬停止 + 脚本硬关断）、`InlineTestingPanel.tsx`（第三形态主链 + 单报告卡/弹窗 + 功能分支隔离）、`types/index.ts`、i18n ×3。

## 埋点口径

- `task_created` 带 `payload.taskType:'smoke'` + `source:'smoke_manual'`。
- **冒烟不发 `cases_approved`**：从未有「AI 生成→批准」环节，发了会污染采纳率口径（无首轮基线可 diff）。
- `step_completed`/`execution_completed`/`report_generated` 照发（冒烟是真实测试活动）；复核走 `report_reviewed`（准确度 KPI 天然计入）。
- Stats 看板冒烟分桶、usage-rollup `smoke_*` 上报 = P2（未做）。

## 验证状态（2026-07-31，dev）

- `npm run test:unit` 2439 pass / 0 fail（新增 93 条）；typecheck 0。
- API curl 合同：GET 派生+初判+覆盖合并、PUT 200/409/400、bugs.json 原子落盘。⚠️ curl 直打需 URL 编码中文（Node 拒绝原始字节请求行）；前端 encodeURIComponent 不受影响。
- CDP 端到端（隔离 `CLAUDE_GUI_DATA_DIR` + 临时项目，未碰真实 workbench）：三段页签、新建弹窗实时解析（4 种分隔符 + 缺预期计数）、创建即执行、三节点流水线、报告全交互（横幅三态翻转/severity 覆盖落盘/备注持久化/复核事件 DB 回显/体验问题渲染）、console 零代码报错。
- Phase 10：`npm run test` 共 2454 条（2453 pass / 0 fail / 1 skip）；`PORT=3001 npm run test:smoke` 14/14。专项 E2E 覆盖结构事件、文本标记、旧模型 run.json 兜底、单接口 401 负例与正常 auto-chain；Playwright trace 截图确认 execution 失败、report 未开始、三语平台提示可见，应用内浏览器 console 0 error。
- Phase 11：定向单元/路由测试 89/89；`npm run test` 共 2469 条（2468 pass / 0 fail / 1 skip）；`PORT=3001 npm run test:smoke` 17/17。覆盖流程页与报告页单卡、历史列表确定性转 8 列表格、无缺陷/脚本副作用、无研发交接，以及功能测试四产物对照；弹窗截图与 console 0 error 已验证。
- **未验证（需打包+登录）**：真实 AI 执行的自主探索质量、@@OBSERVATION 遵从性、打包态 fallback 规则实跑效果。

## 已知边界

- 冒烟场景质量取决于用户录入（验证目标写太粗会让自主探索发散）；表单提示语 + 解析预览是软约束。
- Bug↔场景 1:1：服务端表格规范化以 run.json 的 fail 场景为权威，多余/缺失行会按 1:1 重建；历史 AI 标题/严重级别能解析则保留，否则回退事实与默认「严重」。
- Phase 5 的 Bug 复核 API/旁路文件保留兼容，但 Phase 11 的冒烟 UI 不再展示复核控件。
- 任务形态创建后不可改（形态决定流水线与 prompt，中途切换产物对不上）。
