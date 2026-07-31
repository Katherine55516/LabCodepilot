# 冒烟测试（测试工作台第三形态）

> 创建时间：2026-07-30
> 最后更新：2026-07-31
> 方案与原型见 [docs/research/smoke-test-feature-proposal.md](../../research/smoke-test-feature-proposal.md) + `docs/research/prototypes/smoke-test-prototype.html`
> 参照特性：[test-exec-mode.md](../../handover/test-exec-mode.md)（执行机器）、[regression-library.md](../../handover/regression-library.md)（第二形态如何加入）、[test-viewer-defect-revise.md](../../handover/test-viewer-defect-revise.md)（缺陷报告链路）、[test-usage-stats.md](../../handover/test-usage-stats.md)（复核事件与准确度 KPI）

## 一句话

把用户手工投喂的「冒烟测试提示词」产品化为测试工作台**第三段页签**：手动录入测试场景（验证目标 + 预期结果）→ 无门控自动执行 → 冒烟报告（Bug 可复核列表）。环境沿用现有配置，执行/报告机器全量复用。

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 方案 + 原型 + 决策收敛（8 项全锁） | ✅ 已完成 | 提案 + 原型 v2.1，用户两轮反馈已吸收 |
| Phase 1 | 数据与类型层：任务 `type`/`moduleEntry`、场景解析、`observations`/`bugs.json` 类型 | ✅ 已完成 | 新增 `lib/test/smoke-scenarios.ts`（24 单测全过）+ 类型 4 处；typecheck 0 |
| Phase 2 | Prompt 层：冒烟角色 system + 3 变体 + `rules/smoke-test.md` + fallback | ✅ 已完成 | `SMOKE_SYS` + 3 prompt + 规则文件；32 单测（含打包态 fallback + 功能测试零回归） |
| Phase 3 | 执行归约：`@@OBSERVATION` harvest → `run.json.observations[]` | ✅ 已完成 | 仅改 reduce.ts；exec-stream **零改动**（唯一归约点走 reduceFromText）；14 单测 |
| Phase 4 | UI 主链：第三段页签 + 环境沿用条 + 新建表单 + 无门控 auto-chain | ✅ 已完成 | CDP 端到端验证通过（隔离数据目录）；i18n ×3；场景表编辑并入 Phase 5 |
| Phase 5 | 冒烟报告：结论横幅 + **Bug 可复核列表** + 体验问题 | ✅ 已完成 | 新增 `smoke-bugs.ts`（25 单测）+ `/api/test/bugs`；复核复用 report_reviewed；CDP 全交互验证 |
| Phase 6 | i18n 三语言 + 埋点口径 | ✅ 已完成 | `test.smoke.*` ×3；冒烟不发 cases_approved（采纳率口径隔离）；task_created 带 taskType |
| Phase 7 | 验证：单测 + dev CDP | ✅ dev 侧完成 | 2439 单测 0 fail；API curl 合同（GET/PUT/409/400）+ CDP 报告全交互；**打包态实测待用户发起** |
| Phase 8 | 文档：handover + insights 互链 + ARCHITECTURE 索引 | ✅ 已完成 | 两份互链文档 + 三处索引（handover/insights README、ARCHITECTURE） |
| Phase 9 | 冒烟看板环境摘要修复 | ✅ 已完成 | 修复 dash 视图未请求 env-config；按项目路径+环境隔离响应，加载态不误报；2446 单测 0 fail（1 skip）+ 9/9 smoke E2E + dev 截图/console 0 error |
| Phase 10 | 登录态整体失效机器早停 | ✅ 已完成 | `@@AUTH_INVALID` → 服务端终止 agent → 前端执行置失败并跳过报告；2454 单测 0 fail（1 skip）+ 14/14 smoke E2E + dev CDP/trace 截图、console 0 error |

## 决策日志

- 2026-07-30：**形态选型 = 任务子类型（方案 B），不照抄回归的独立工作区**。理由：回归需要库/套件/轮次跨任务聚合结构，冒烟没有这些概念；照抄形态是纯开销。冒烟走既有任务机器（看板/flow/runStep/auto-chain/报告区），仅按 type 裁剪节点 + 换 prompt。
- 2026-07-30：**入口 = 第三段页签**（功能 | 回归 | 冒烟）。与回归的信息架构一致（形态=页签），功能看板不被冒烟任务打散。
- 2026-07-30：**无门控**——创建任务即自动「场景落盘 → 执行 → 报告」。冒烟的价值是快，多一次确认就削弱定位。场景事后可改可重跑作为补偿。
- 2026-07-30：**环境信息全部沿用现有环境配置**（用户明确要求）。系统名称/地址/登录态只读展示，cookie 不手填；仅保留可选的任务级地址覆盖（复用现有 targetUrl）。**不建第二套环境体系。**
- 2026-07-30：**原提示词 `<>` 占位符全部转页面输入或平台自动提供**（用户明确要求）。表单必填收敛到 3 项：模块名称 / 模块入口 / 测试场景。
- 2026-07-30：**三段固定内容内嵌进平台**（用户确认）：【角色与目标】→ 冒烟 system prompt；【全局规则】7 条 → `rules/smoke-test.md` + 执行 prompt 铁律块；【报告结构】→ 报告 prompt 模板。判据：每次冒烟都相同的内容沉淀进平台，每次都不同的才留表单。表单里用只读说明块告知用户"它们没丢，只是被平台接管"。
- 2026-07-30：**Bug 清单 = 结构化可复核列表**（用户要求）。复核**复用现有 `report_reviewed` 事件**（Bug ↔ 失败场景 1:1，caseId 用场景 id、runHash 同源）→ 零新事件类型、零新统计口径，直接汇入现有「AI 判定准确度 + 复核覆盖率」KPI。仅严重级别与备注需新落点。
- 2026-07-30：**严重级别/备注落 `bugs.json`，不塞 run.json**。run.json 是确定性归约产物，不应被人工写入污染（延续「四态由代码算、不由人改」原则）。
- 2026-07-30：**复核改结论用双记录**。复核为误报时横幅更新为「通过（经人工复核，N 项 AI 误报已排除）」，但保留 AI 原始判定供追溯；报告 Markdown 本体不被复核改写（它是 AI 产物快照），复核态是 UI 叠加层。
- 2026-07-30：**场景来源 P1 只做手动录入**（用户最终决定）。AI 生成场景、从功能任务提炼 P0 用例均降为 P2。理由：手动录入与用户现用提示词习惯完全一致，零猜测风险；先验证形态跑顺，再考虑生成。
- 2026-07-30：**插件侧 `ai-lab-test:smoke` 本期不做**。平台先行验证形态，P2 再改上游 ai-lab-test-agent 仓库并走 vendor 流水线。
- 2026-07-30（Phase 1 实施中发现）：**既有 `CASE_TAGS` 里已有一个「冒烟测试」标签**（`InlineTestingPanel.tsx` 的用例编辑器多选标签、导入路由也认），但它**只是功能用例上的人工标注，无任何程序消费**（对比「回归测试」标签驱动 `depositTask` 入库 + reduce 的 `suiteCounts` 红线）。处置：① P1 冒烟场景 `tags` 恒空，与该标签零交互，无功能冲突；② 该标签是 P2「从功能任务提炼冒烟场景」最自然的数据源（用户打了标签 = 已经标出了主流程用例），P2 实现时直接消费它；③ 概念上二者需在文档里说清——**标签 = 功能用例上的标注，形态 = 任务类型**，避免用户困惑"打了冒烟标签的用例为什么不出现在冒烟页签"。已在 `smoke-scenarios.ts` 顶部注释与单测里锁死。
- 2026-07-30（Phase 1 实施中修正）：任务级地址字段实际是 **`targetUrlByEnv?: Record<string, string>`（按 env 隔离）**，非方案里写的单一 `targetUrl`（那是已迁移的旧字段）。冒烟的地址覆盖直接复用该结构，Phase 4 写表单时按当前 `selectedEnv` 存取。
- 2026-07-30（Phase 9 缺陷修复）：**冒烟项目看板与新建弹窗必须和 flow 共用 `/api/test/env-config`，并将响应绑定到 `normalize(projectPath) + env` scope**。根因是 Phase 4 新增了 dash 消费者，却沿用了旧 effect 的 `view === "flow"` 加载门槛，导致配置与登录态真实存在时仍把 `null` 渲染成“未配置/未捕获”。不在弹窗内另建请求，也不改服务端 resolver；scope key 同时防止切项目/环境时旧 URL 与登录态串台，首次加载明确显示 loading。
- 2026-07-30（Phase 10 缺陷修复）：**登录态整体失效必须是平台机器终态，不能只靠 AI 自然语言“自觉停止”**。历史修复只改提示词，流正常 EOF 后前端仍把 execution 标 `done`，auto-chain 随即生成无意义报告。新增冒烟专用裸标记 `@@AUTH_INVALID {"reason":"login_state_invalid"}`：服务端识别后立即 abort agent、取消上游且不归约本轮 run.json；前端以 `error` 收口、显示三语平台提示并保持 report `idle`。为兼容未遵守新标记的旧模型，只有在权威结果满足“全部 blocked + 至少一条明确登录失效证据”时才做报告阻断兜底；个别页面权限或单接口 401 不触发机器早停。

## 详细设计

### 目标与非目标

**目标**：让「跑一遍主流程看通不通」从「复制提示词 + 手填 5 处 + 粘贴场景」变成「填 3 项 + 点创建」，并让 AI 的失败判定可被人工复核、汇入既有准确度统计。

**非目标（本期明确不做）**：AI 生成场景、从功能任务提炼场景、定时冒烟、插件命令、Stats 看板冒烟分桶、usage-rollup 上报 `smoke_*`。

### 数据模型（零 schema 迁移）

- `Project.tasks[]`（test-workbench.json）：`{id, name}` → `{id, name, type?: 'smoke'}`，缺省视为功能任务（沿用 `requirementMode` 回填的兼容策略）。
- `TaskState` 增 `moduleEntry?: string`（目标模块入口，进执行 prompt）。被测地址复用现有任务级 `targetUrl`，三层优先级不动。
- 场景落盘 = 既有 cases.json 极简用例（`testCase/.data/{任务}.cases.json`），id 前缀 `SM-`，`caseType:'冒烟'`、`tags:[]`（恒空 → 回归库沉淀与红线小节天然不触发）、`verification:'功能验证'`。归约器/报告/funcCounts/历史对比零改动。
- 新增 `report/{任务}/{任务}-{env}.bugs.json`：`{version, runHash, bugs:[{id, sceneId, title, severity, severityOverriddenBy?, note?}]}`。

### 流水线（复用三步键，不加新 step）

冒烟任务节点 = `cases`（UI 标「测试场景」）→ `execution` → `report`；`requirement` 节点按 type 隐藏、stepStatus 预置 `done`（沿用导入用例任务的先例）。cases 步不进 `review` 态 → auto-chain 一路推进到报告。改场景触发 `withDownstreamReset` 重置执行/报告，「重跑」再来一轮。

`POST /api/test/run` 增透传 `taskType`，`buildStep` 按 `taskType==='smoke'` 分流 prompt 变体；其余机器（env 解析、探活闸门、Playwright 注入、wrapExecutionStream/wrapReportStream、埋点）原样。

### 拆分步骤

**Phase 1 · 数据与类型层**
1. `src/types/index.ts`：任务 `type`、`TaskState.moduleEntry`、`RunJson.observations?`、`SmokeBug`/`BugsFile` 类型。
2. `src/lib/test/smoke-scenarios.ts`（新，纯函数）：`parseScenarioLines(text)` → `SmokeScenario[]`（容错分隔符 `→`/`->`/`|`/制表符；空行跳过；缺预期时整行作验证目标并标记）；`scenariosToCases(scenarios, taskName)` → cases.json 结构；`casesToScenarios(cases)` 反向（供场景表编辑）。**纯函数、node 可测**（规避 better-sqlite3 ABI）。

**Phase 2 · Prompt 层**
3. `src/lib/test/rules/smoke-test.md`（新）：移植提示词【全局规则】7 条 + 【角色与目标】要旨。
4. `src/lib/test/prompts.ts`：`BuildStepOptions.taskType`/`moduleEntry`；`SYS.smokeExecution`；`smokeScenariosPrompt`（cases 步：归整手动录入场景为 cases.json，只审不改写）、`smokeExecutionPrompt`（自主探索 + 数据前缀铁律 + 依赖场景跳过 + `@@OBSERVATION`；保留 @@CASE_START/@@RESULT、登录态三分支、非交互护栏、覆盖自检）、`smokeReportPrompt`（五段式 + 结构化 Bug 列表 + 结论口径）；每个变体配 `ruleBlock` fallback 精简版（打包态 .md 被 NFT 剥离）。

**Phase 3 · 执行归约**
5. `src/lib/test/markers.ts`：`@@OBSERVATION` harvest（行首裸写纪律同 @@RESULT）。
6. `src/lib/test/reduce.ts`：`RunJson.observations[]`（缺省 `[]`，老 run.json 兼容）。

**Phase 4 · UI 主链**（`InlineTestingPanel.tsx`）
7. `testType` 扩三态 + 冒烟页签（任务看板按 type 过滤 + 环境沿用信息条）。
8. 新建冒烟任务弹窗：环境只读块（环境切换 + 系统名称/地址/登录态 + 收起的地址覆盖）、模块名称（联动任务名 `{模块}-冒烟`）、模块入口、测试场景 textarea、数据前缀展示、内嵌 skill 只读说明块。
9. `addTask` 写 `type:'smoke'`/`moduleEntry` + 场景解析落盘 + stepStatus 预置；无门控 auto-chain。
10. 测试场景两列表（执行中只读、执行后可编辑 → 保存走既有 `/api/test/cases` + 下游重置）。
11. 任务卡冒烟 badge + 通过/未通过 chip + 重跑。

**Phase 5 · 冒烟报告**
12. `src/app/api/test/bugs/route.ts`（新）：GET 读 bugs.json；PUT 增量更新 severity/note（路径安全复用 `path-safety.ts`）。
13. 报告视图：结论横幅（按复核态更新，双记录）+ 场景结果表 + Bug 可复核列表（severity select / 确认缺陷·误报·程度不符 / 备注 / 批量确认 / 复核进度）+ 体验问题章节；复核动作复用 `postReview` 的 `report_reviewed`；「导出缺陷单」接现有 `/api/test/defect`。

**Phase 6 · i18n 与埋点**
14. `src/i18n/{en,zh,zh-HK}.ts`：`test.smoke.*`（en 为类型源）。
15. 埋点 payload 增 `taskType:'smoke'`；`stats.ts` 采纳率「AI 生成流」分母排除冒烟任务（手动录入场景不是 AI 生成用例，不应稀释采纳率）。

**Phase 7 · 验证**（见验收标准）

**Phase 8 · 文档**
16. `docs/handover/smoke-test.md` + `docs/insights/smoke-test.md`（互链）；ARCHITECTURE.md 文档索引补两行；本计划移入 `completed/`。

### 依赖项

- 无新增三方依赖。
- 依赖既有：`/api/test/run` 执行链、`/api/test/cases`、`/api/test/defect`、`/api/test/stats`、`TestEnvDrawer` 环境体系、`path-safety.ts`、`withDownstreamReset`。

### 验收标准

**功能**
1. 冒烟页签存在且只列冒烟任务；功能/回归页签行为零变化（回归测试）。
2. 新建表单必填仅 3 项；环境信息只读且与「环境配置」抽屉一致；地址覆盖可选生效。
3. 创建后无需任何确认即自动跑到报告；中途可停止；场景可改可重跑（下游状态正确重置）。
4. 执行 prompt 含数据前缀铁律、自主探索、失败不中断、`@@OBSERVATION`；产物落 cases.json / run.json / 报告 md，路径与功能测试同构。
5. 报告含五段；Bug 为列表；severity 可改并持久化；复核动作写出 `report_reviewed` 事件且 Stats 准确度 KPI 计入；复核为误报后结论横幅更新且保留 AI 原判。

**质量闸**
6. `npm run test` 通过（typecheck + 单测），新增单测覆盖：场景解析（各分隔符/空行/缺预期）、scenariosToCases 结构、smoke prompt 变体断言（含 fallback 生效）、`@@OBSERVATION` 归约与旧 run.json 兼容。
7. dev 态 CDP 验证：三段页签切换、新建表单两态、场景表编辑、Bug 复核列表交互（severity 改、三种复核、批量、进度）、控制台无报错；登录态相关走 mock（dev 无登录体系）。
8. 打包态实测：真实项目跑一轮冒烟（含登录态注入 + 真 AI 执行 + 报告 + 复核落盘）。
9. 登录态整体失效：AI 发出 `@@AUTH_INVALID` 后服务端取消后续源读取、不落本轮 run.json，UI 同时丢弃同批次已到达的后续场景；执行节点收口为失败、报告保持未开始、对话明确提示重新获取登录态；自动接力对 `/api/test/run` 的请求序列只有 `execution`，正常冒烟仍为 `execution → report`。

### 风险与已知边界

- **自主探索执行**无固定步骤兜底，判定依赖 AI 对页面的观察（与用户现用提示词同性质）；报告如实呈现，不额外承诺稳定性。
- **`@@OBSERVATION` 遵从性**是新标记，需按 @@RESULT 同款方法在打包态验证（网关模型标记裸写纪律已有先例）。
- **dev 无登录体系**：登录态链路本地只能 mock 验证，真验证需打包登录（CLAUDE.md 既有纪律）。
- **打包态规则文件剥离**：`smoke-test.md` 同受 `outputFileTracingExcludes` 影响，fallback 精简规则必须一次写足。
- **复核语义边界**：Bug ↔ 场景 1:1 成立于「每个 fail 场景生成一条 Bug」；若报告步为同一场景产出多条 Bug，复核会退化为对该场景的单一判定。Phase 5 需在报告 prompt 里约束 1 场景 ≤ 1 Bug，或在复核 UI 上按场景聚合（实现时确认）。
