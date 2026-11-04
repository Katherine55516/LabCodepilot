# 冒烟测试功能方案（提案）

> 状态：**提案沟通中** —— 已拍板 4 项（见 §7 决策记录），场景来源范围待定；用户确认后再立执行计划（`docs/exec-plans/active/`）| 创建：2026-07-30
> 2026-07-30 用户反馈已吸收（两轮）：① 被测系统环境配置通用、冒烟**沿用现有环境配置**（系统名称/地址/登录态不重复填）；② 原提示词所有 `<>` 占位符**转为页面输入或平台自动提供**（映射见 §4.7）；③ 冒烟报告 **Bug 清单改为列表 + 人工复核**（§4.8）；④ 场景输入框文案改为「测试场景（描述"验证目标 + 预期结果"，不含具体操作步骤）」；⑤ 明确【角色与目标】【全局规则】【报告结构】三段**内嵌进平台 skill / prompt，不需用户录入**。原型已改版为 v2。
> 交互原型：`docs/research/prototypes/smoke-test-prototype.html`（浏览器直接打开，5 屏走查完整流程）；在线版 https://claude.ai/code/artifact/428f0a3f-55ca-47d6-a0e0-6907c2ecf204
> 输入：用户现用冒烟测试提示词（Playwright MCP 手工投喂版），本文 §1 为其结构化拆解
> 现状参照：[docs/handover/test-exec-mode.md](../handover/test-exec-mode.md)（执行机器）、[docs/handover/regression-library.md](../handover/regression-library.md)（第二形态如何加入）、[docs/handover/ailab-plugin.md](../handover/ailab-plugin.md)（插件侧）

## 0. 一句话

把用户手工投喂的「冒烟测试提示词」产品化为测试工作台的**第三段页签**：轻场景（验证目标 + 预期结果）替代 12 列用例，流水线裁剪为 `场景清单 → 测试执行 → 冒烟报告` 3 节点且**无门控（创建即自动跑到报告）**，环境信息全部沿用现有环境配置，执行与报告机器（环境解析 / 登录态 / 探活闸门 / @@RESULT 四态归约 / 证据 / 报告区）**全量复用**，新增代码集中在 prompt 变体与轻量场景表。

## 1. 现用提示词拆解 → 平台能力映射

| 提示词要素 | 平台现状 | 结论 |
|---|---|---|
| 角色：测试工程师 + Playwright MCP 驱动 | `SYS.execution` + `buildPlaywrightMcp`（prompts.ts） | ✅ 直接复用 |
| 系统地址 / cookie / 模块入口 | environments.json + 测试账号（storageState / 密码下发）+ 任务级 targetUrl 三层地址优先级 | ✅ 复用；**「模块入口」为新增任务字段**（进执行 prompt） |
| 测试数据可识别前缀「冒烟测试_×_」 | 功能测试有 `auto-uitest-{时间戳}` 惯例（completeness §7） | 🆕 冒烟规则固定前缀 `冒烟测试_{YYYYMMDD}_` |
| 数据安全（只操作自建数据） | 执行规范已有数据纪律 | ✅ 冒烟规则强化表述 |
| 自主执行（snapshot 定位、无固定步骤） | 执行步本就是 snapshot→操作模式，但按用例步骤走 | 🆕 冒烟执行 prompt 改为**自主探索式**（场景只给验证目标） |
| 判定原则（对照预期，可观察依据） | 四态判定（pass/fail/partial/blocked） | ✅ 直接复用 |
| 失败不中断、跳过依赖场景、统一汇报 | 覆盖自检 + 登录态整体失效早停例外 | ✅ 复用；冒烟 prompt 补「依赖场景跳过判 blocked」 |
| 截图规范（每场景关键状态） | evidenceDir + 每条截图 + fail/partial 录像 | ✅ 直接复用 |
| 报告：场景结果表 / Bug 清单（严重级别）/ **奇怪交互与体验问题** / **整体结论（是否具备进一步测试条件）** | 报告机器可复用；「体验问题」与「冒烟结论口径」现无 | 🆕 冒烟报告 prompt + `@@OBSERVATION` 观察通道 |

## 2. 定位：三种测试形态

| | 功能测试（现状） | 回归测试（现状） | **冒烟测试（新增）** |
|---|---|---|---|
| 回答的问题 | 新功能对不对 | 老功能退没退 | **主流程通不通** |
| 用例形态 | 12 列结构化用例、八维覆盖 | 从功能用例沉淀（库/套件/轮次） | 轻场景：验证目标 + 预期结果 |
| 流程 | 需求 → 用例（门控）→ 执行 → 报告 | 圈选套件 → 轮次重跑 | 场景清单（无门控，创建即跑）→ 执行 → 报告 |
| 典型时机 | 功能提测后 | 发版前 | **提测第一时间 / 部署后快检 / 详细测试的前置闸门** |
| 结论口径 | 双口径通过率 + 回归红线 | 红线（未全过不可发版） | **是否通过冒烟、是否具备进一步测试条件** |

## 3. 方案选型

### 形态：任务子类型（推荐）vs 独立工作区

摸底结论（InlineTestingPanel.tsx）：功能/回归的分野是项目详情页的 `testType` 二段开关（`:1567`、`:2862`），回归整页替换为独立 `RegressionWorkspace`（约 2000+ 行独立组件树 + 3 个独立 JSON 数据模型 + 独立 API 面）。

- **方案 A · 独立工作区（仿回归）**：为冒烟建独立 section。❌ 不推荐——回归需要库/套件/轮次那套跨任务聚合结构，冒烟没有；照抄形态是纯开销。
- **方案 B · 任务子类型（推荐）**：任务加 `type: 'func' | 'smoke'`（缺省 = func，零迁移），冒烟任务走既有任务机器（看板卡片 / flow 流水线 / runStep / auto-chain / 报告区），仅按 type 裁剪节点与换 prompt。**先例现成**：导入用例任务就是「过滤 requirement 节点（`:2395`）+ stepStatus 预置 done（`:1289`）」实现的裁剪。

### 入口呈现（✅ 已拍板：B1 第三段页签）

`testType` 开关扩为 `功能测试 | 回归测试 | 冒烟测试`，冒烟页签 = 同一套任务看板组件按 `type==='smoke'` 过滤 + 页签内「新建冒烟任务」+ 顶部「沿用环境配置」信息条（只读展示系统名称/环境/地址/登录态，配置本体仍在现有 TestEnvDrawer）。与回归的信息架构一致（形态=页签）、功能看板不被冒烟任务打散。原型 v2 第 1 屏即此形态。

## 4. 推荐方案详细设计（方案 B）

### 4.1 数据模型（零 schema 迁移）

- `Project.tasks[]`（test-workbench.json）：`{id, name}` → `{id, name, type?: 'smoke'}`，缺省视为 func（与 `requirementMode` 回填同款兼容策略）。
- `TaskState` 增 `moduleEntry?: string`（目标模块入口，进执行 prompt）；被测地址复用现有任务级 `targetUrl`（三层优先级不动）。
- 场景落盘 = **既有 cases.json 极简用例**（`testCase/.data/{任务}.cases.json`）：

```jsonc
{ "cases": [{
  "id": "SM-001",                    // SM- 前缀视觉区分，机器不关心前缀
  "caseType": "冒烟",
  "priority": "P0",
  "purpose": "添加评估机构",          // 验证目标
  "steps": [{ "content": "场景：添加评估机构（自主探索完成）", "expected": "按要求填写机构信息字段，添加成功，列表出现新机构" }],
  "assertion": "L2", "oracle": "产品确认", "verification": "功能验证", "tags": []
}]}
```

归约器 / 报告 / funcCounts / 历史对比（runHash）对该结构**零改动**；`tags` 恒空 → 回归库沉淀（depositTask 只收「回归测试」标签）与红线小节天然不触发。

### 4.2 流水线（复用三步键，不加新 step；✅ 无门控）

冒烟任务节点 = `cases`（UI 改标签「场景清单」）→ `execution` → `report`；requirement 节点按 type 隐藏、stepStatus 预置 done（沿用导入用例任务的先例）。**无门控**：创建任务即自动「场景落盘 → 执行 → 报告」一路推进（复用现有 auto-chain，cases 步不进 review 态）；场景清单节点保留查看/编辑入口——执行中只读、执行后可改，改场景触发下游状态重置（withDownstreamReset 现有机制），点「重跑」再来一轮。step 状态机 / 排队 / 审计 / step_completed 埋点全部不动。

`POST /api/test/run` 增透传 `taskType`，`buildStep` 按 `taskType==='smoke'` 分流到三个 prompt 变体；`/api/test/run` 其余机器（env 解析、探活闸门、Playwright 注入、wrapExecutionStream/wrapReportStream）原样。

### 4.3 Prompt 层（新增 3 个变体 + 1 个规则文件）

| 变体 | 作用 | 要点 |
|---|---|---|
| `smokeScenariosPrompt`（cases 步） | 把用户手动录入的场景清单归整为极简 cases.json（**只审不改写**，同「用户上传用例以上传为准」纪律：格式归整 + 列审核提醒交用户裁定，不臆造、不新增） | 明确「仅主流程，不覆盖边界/异常/权限」；产物仍只写 cases.json |
| `smokeExecutionPrompt`（execution 步） | 在现执行 prompt 骨架上替换执行方式段 | ① 自主探索式（场景无固定步骤，snapshot 观察后自行完成验证目标）；② 数据前缀铁律 `冒烟测试_{YYYYMMDD}_`、只操作本次自建数据；③ 依赖场景跳过判 blocked；④ 顺带输出 `@@OBSERVATION` 体验观察（非阻塞）；@@CASE_START/@@RESULT、登录态三分支、非交互护栏、覆盖自检全保留 |
| `smokeReportPrompt`（report 步） | 冒烟报告结构 | 章节：概要+结论横幅（**是否通过冒烟 / 是否具备进一步测试条件**，有 fail 即未通过）→ 场景结果表（场景/验证目标/预期/实际/结论/截图）→ **Bug 清单（结构化列表，每条含编号/标题/严重级别/关联场景/实际vs预期/证据，供 UI 渲染可复核表，见 §4.8）** → 奇怪交互与体验问题（读 run.json.observations）→ 整体结论；**不出**需求覆盖矩阵/回归红线/双口径 |
| `rules/smoke-test.md` | 冒烟全局规则（移植用户提示词的【全局规则】节） | 经 `loadRule` 加载；打包态 .md 被剥离 → 必须同步提供 `ruleBlock` 内置精简 fallback（现有机制） |

### 4.4 `@@OBSERVATION` 体验观察通道（小而清晰的机器增量）

执行中 AI 顺带记录非功能观察（响应慢/提示不清/按钮无反馈/状态不同步），单行标记 `@@OBSERVATION {"text":"...","scene":"SM-004"}`：

- `markers.ts` 增 harvest；`reduce.ts` 归约进 `run.json.observations[]`（缺省空数组，老 run.json 兼容）；
- 报告步读 run.json 渲染「体验问题」章节；功能/回归任务不受影响（不输出该标记即无此节）。

这是唯一动归约器的点，其余均为 prompt / UI 层增量。

### 4.5 UI 触点（InlineTestingPanel 为主）

- **新建冒烟任务表单（必填仅 3 项）**：
  - 测试环境块（**沿用环境配置，只读**）：环境选择 local/sit（复用项目 selectedEnv）+ 系统名称 / 系统地址 / 登录态状态展示（来自 test_account_systems / environments.json 解析）；「本任务覆盖被测地址」为收起的可选项（复用现有任务级 targetUrl 机制，仅覆盖地址、登录态仍按环境注入）。**不新建第二套环境体系，cookie 不手填。**
  - 模块名称（必填）→ 任务名自动生成 `{模块}-冒烟`（可改）；
  - 目标模块入口（必填，如何进入该模块，进执行 prompt）；
  - **测试场景**（必填，文案：「测试场景（描述"验证目标 + 预期结果"，不含具体操作步骤）」）：textarea 手动录入，每行一条 `验证目标 → 预期结果`；
  - 信息条展示自动生成的数据前缀 `冒烟测试_{YYYYMMDD}_` 与「截图/录像平台自动管理」。
- 场景清单节点：**新轻量两列表**（验证目标/预期结果 + 增删行），执行中只读、执行后可编辑重跑；保存走既有 `/api/test/cases`；不复用 12 列用例编辑器（字段噪音大），并隐藏「AI 推荐回归集」按钮。
- 任务卡「冒烟」badge + 通过/未通过结果 chip；执行进度 / 报告区零改动（自动生效）。无门控故不弹执行前确认弹窗（同现有「运行任务」全流水线不弹的行为）。
- i18n：`test.smoke.*` 三语言（en 为类型源）。

### 4.6 统计与审计

- 复用既有事件（task_created / step_completed / execution_completed / report_generated），payload 增 `taskType:'smoke'`；`stats.ts` 采纳率口径（`:844` 起「AI 生成流」判定）把冒烟任务从分母排除（手动场景非 AI 生成用例，不应稀释采纳率）。
- Stats 看板冒烟分桶、usage-rollup 上报增 `smoke_*` 字段（冻结契约，需仿 regression 增列不污染现有列）→ **P2**。
- 审计沿用 `logAudit` / `appendAudit` 既有动作点。

### 4.7 原提示词 `<>` 占位符 → 页面来源映射（2026-07-30 用户要求的核心口径）

| 提示词中的占位 / 段落 | 现在从哪来 |
|---|---|
| `<系统名称>` | 环境配置的系统名称（沿用，只读展示） |
| `<URL>` 系统地址 | 环境配置所选环境的 frontendBaseUrl（可选任务级覆盖地址） |
| cookie 信息 | 环境配置登录态：storageState / 密码账号自动注入，**无需手填** |
| `<模块名称>` | 新建表单「模块名称」输入框（同时派生任务名与报告标题） |
| `<如何进入该模块>` | 新建表单「目标模块入口」输入框 |
| 【测试场景】段（可替换部分） | 场景来源：手动录入 textarea / AI 按模块描述生成 |
| 前缀 `冒烟测试_<模型/日期>_` | 平台自动生成 `冒烟测试_{YYYYMMDD}_`，表单内展示 |
| `<截图目录>` + 截图命名/稳定性规则 | 平台证据目录与截图机制自动管理（报告内可点开） |
| 【角色与目标】【全局规则】 | 平台内置冒烟规则（`rules/smoke-test.md` + prompt 变体），无需输入 |
| 【交付：测试报告结构】 | 平台内置冒烟报告模板（§4.3 smokeReportPrompt），无需输入 |

表单必填只剩 3 项（模块名称 / 模块入口 / 测试场景或模块描述），其余全部沿用环境配置或平台自动提供——每次冒烟不再复制粘贴改提示词。

**「内嵌」的确切落点**（回答用户第 3 问：这三段是否内嵌、故无需录入）：

| 提示词段落 | 内嵌成什么 | 物理落点 |
|---|---|---|
| 【角色与目标】 | 冒烟执行角色 system prompt | `prompts.ts` 的 `SYS.execution` 冒烟变体（仿现有四个角色 system prompt 的写法） |
| 【全局规则（必须遵守）】7 条 | 规则文件 + 执行 prompt 铁律块 | `src/lib/test/rules/smoke-test.md`（经 `loadRule` 加载）+ `smokeExecutionPrompt` 内的 fallback 精简版（打包态 .md 被 NFT 剥离时兜底，现有机制） |
| 【交付：测试报告结构】 | 冒烟报告 prompt 模板 | `smokeReportPrompt`（§4.3） |

判据：**每次冒烟都相同的内容 → 沉淀进平台；每次都不同的内容 → 留在表单**。前者三段固定不变，故内嵌；后者仅 3 项（模块名称/入口/场景）。新建表单里用一个只读说明块把这三段列出来，让用户知道"它们没丢，只是被平台接管了"。

### 4.8 Bug 清单列表化 + 人工复核（2026-07-30 用户要求）

冒烟报告的 Bug 清单从「叙述式卡片」改为**结构化可复核列表**。

**列结构**：编号 | 标题 | 严重级别（可人工调整）| 关联场景 | 实际 vs 预期（含接口信息）| 证据 | 人工复核动作 + 备注。表头带「已复核 N/M」进度。

**复核动作复用现有报告复核机制**（关键：零新事件类型、零新统计口径）：
- 现有 `ReportView` 已有逐条判定复核（`postReview` → `POST /api/test/stats`，事件 `report_reviewed`，payload `{caseId, verdict|aiStatus+actual, runHash}`，state 型按 `` `${runHash}|${caseId}` `` last-wins），verdict 取值 `accurate` / `falseFail`(误报) / `missedFail`(漏报) / `severityMismatch`(程度不符) / `cleared`(撤销)，并汇入 Stats 的「AI 判定准确度 + 复核覆盖率」KPI。
- 冒烟 Bug ↔ 失败场景是 1:1（每个 fail 场景生成一条 Bug），故 **Bug 行的复核 = 对该场景 AI 判定的复核**，`caseId` 直接用场景 id（SM-00X）、`runHash` 同源 → **复用同一事件、同一 KPI，不新增字典项**。
- 冒烟侧增量仅两处 UI 语义：① 「确认缺陷」= `accurate`、「误报」= `falseFail`、「程度不符」= `severityMismatch`（措辞按缺陷语境本地化，数据值不变）；② 严重级别人工调整 + 复核备注 → 需要一个可持久化的落点。

**严重级别与备注的落点（新增，最小面）**：写 `report/{任务}/{任务}-{env}.bugs.json`（`{version, runHash, bugs:[{id, sceneId, title, severity, severityOverriddenBy?, note?}]}`），由报告步产出初版、UI 复核时增量覆盖；不塞进 run.json（run.json 是确定性归约产物，不该被人工写入污染）。

**复核对结论的影响（双记录，诚实口径）**：
- 结论横幅默认按 AI 判定；若某 fail 被复核为「误报」，横幅更新为「冒烟通过（经人工复核，N 项 AI 误报已排除）」，**同时保留 AI 原始判定**供追溯，不覆盖历史事实（与既有「run.json 不可人工改」的原则一致）。
- 报告 Markdown 本体不被复核改写（它是 AI 产物快照）；复核态是 UI 叠加层（读 bugs.json + 复核事件），与「报告可重新生成」不冲突。

**导出缺陷单给开发**：Bug 列表复用现有 `/api/test/defect` 缺陷报告链路（现成的 QA 铁律 prompt：只写期望行为 + 验收，禁修复方案/优先级/指派），冒烟侧只是把入口挪到 Bug 列表工具条。

## 5. P1 触及文件清单

| 文件 | 改动 |
|---|---|
| `src/components/test/InlineTestingPanel.tsx` | task type 字段消费：第三段页签 + 环境沿用信息条、新建冒烟表单（环境只读块/模块名称/模块入口/场景来源）、看板 badge、requirement 节点按 type 隐藏 + stepStatus 预置、cases 节点改标「场景清单」+ 无门控 auto-chain、场景两列表、runStep 透传 taskType |
| `src/app/api/test/workbench/route.ts` | 无 schema 校验改动（tasks[] 透明存储），仅类型注释 |
| `src/app/api/test/run/route.ts` | 读 `taskType` 透传 `buildStep` |
| `src/lib/test/prompts.ts` | `BuildStepOptions.taskType` + 三个 smoke prompt 变体 + fallback 精简规则 |
| `src/lib/test/rules/smoke-test.md` | 新增：冒烟全局规则（数据前缀/数据安全/自主执行/判定/失败不中断/截图/体验观察） |
| `src/lib/test/markers.ts` / `reduce.ts` | `@@OBSERVATION` harvest + `run.json.observations[]` |
| `src/app/api/test/bugs/route.ts`（新） | Bug 列表读写：GET 返回 `bugs.json`；PUT 增量更新严重级别 / 备注（复核动作本身仍走既有 `/api/test/stats` 的 `report_reviewed`） |
| `src/components/test/InlineTestingPanel.tsx`（报告侧） | 冒烟报告视图：Bug 可复核列表（严重级别 select + 确认缺陷/误报/程度不符 + 备注 + 批量确认 + 复核进度）、结论横幅按复核态更新、体验问题章节；导出缺陷单入口接现有 `/api/test/defect` |
| `src/types/index.ts` | 任务 type / moduleEntry / observations 类型；stats payload 注释 |
| `src/lib/test/stats.ts` | 采纳率口径排除冒烟任务 |
| `src/i18n/{en,zh,zh-HK}.ts` | `test.smoke.*` |
| 单测 | prompts 变体断言（仿 test-prompts-note.test.ts）、reduce observations、场景归整 |

**不触及**：exec-stream 主链、env 体系、回归全家桶、报告区、脚本重放、DB schema。

## 6. 分期与实施阶段（两个不同的轴，别混）

> ⚠️ 本方案出现两套编号，含义完全不同：
> - **P1 / P2 = 功能范围**（本期交付什么 vs 后续再说）；
> - **Phase 1–8 = 本期内部的实施顺序**（把 P1 拆成可依次落地、可分别验收的 8 段）。
> **Phase 1–8 全部完成 = P1 交付完毕。** Phase 的完整拆解（每段的具体步骤、文件、验收）在执行计划里：[docs/exec-plans/active/smoke-test.md](../exec-plans/active/smoke-test.md)。

### 6.1 功能范围（P1 / P2）

- **P1（MVP，本期）**：任务子类型 + 测试场景**手动录入** + 冒烟执行/报告 prompt + Bug 可复核列表 + @@OBSERVATION + i18n + 埋点标记。
- **P2（后续按需）**：① **AI 生成冒烟场景**（按模块描述生成主流程场景）；② 从已有功能任务提炼 P0 用例为冒烟场景；③ Stats 看板冒烟分桶 + usage-rollup `smoke_*` 上报；④ 插件侧 `ai-lab-test:smoke` 命令（改上游 ai-lab-test-agent 仓库再走 vendor 流水线）；⑤ 定时冒烟（部署后自动跑，配通知）。

### 6.2 本期实施阶段（Phase 1–8）概览

按「先底层后 UI、先主链后周边」排序——每个 Phase 结束时代码可编译、可单测，不留半截状态。

| Phase | 做什么 | 产出 | 为什么排这个位置 |
|---|---|---|---|
| 1 | **数据与类型层**：任务 `type`/`moduleEntry`、场景解析纯函数、`observations`/`bugs.json` 类型 | `types/index.ts`、新 `lib/test/smoke-scenarios.ts` | 后面所有阶段都依赖这些类型与解析；纯函数可直接单测（绕开 better-sqlite3 ABI） |
| 2 | **Prompt 层**：冒烟角色 system + 3 个 prompt 变体 + `rules/smoke-test.md` + 打包态 fallback | `lib/test/prompts.ts`、新规则文件 | 这是冒烟与功能测试的**唯一实质差异**；先定下来，UI 才知道要传什么 |
| 3 | **执行归约**：`@@OBSERVATION` harvest → `run.json.observations[]` | `markers.ts`、`reduce.ts` | 全期唯一改动归约器的地方，单独成段以便重点回归旧 run.json 兼容性 |
| 4 | **UI 主链**：第三段页签 + 环境沿用条 + 新建表单 + 测试场景表 + 无门控 auto-chain | `InlineTestingPanel.tsx` | 前三段就绪后，UI 才能端到端跑通「建任务→出报告」 |
| 5 | **冒烟报告**：结论横幅 + 场景结果表 + **Bug 可复核列表** + 体验问题 | 新 `api/test/bugs/route.ts`、报告视图 | 依赖 Phase 3 的 observations 与 Phase 4 跑出的真实产物 |
| 6 | **i18n 与埋点**：三语言键 + payload `taskType` + 采纳率口径排除冒烟 | `i18n/*`、`stats.ts` | 界面文案稳定后再补，避免反复改键 |
| 7 | **验证**：单测 + dev CDP + 打包态实测 | 测试用例 + 验证记录 | 见执行计划的 8 条验收标准 |
| 8 | **文档**：handover + insights 互链 + ARCHITECTURE 索引 | `docs/handover/smoke-test.md` 等 | CLAUDE.md 强制：新功能必须两份文档 |

**关键依赖链**：Phase 1 → 2 → 4 是主干（类型 → prompt → UI），Phase 3 可与 2 并行，Phase 5 依赖 3+4，Phase 6-8 收尾。

## 7. 决策记录（2026-07-30 与用户沟通）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 入口呈现 | ✅ **B1 第三段页签**（功能 \| 回归 \| 冒烟） |
| 2 | 场景门控 | ✅ **无门控**：创建即自动跑到报告；场景事后可改可重跑（注意：与 #6 的 Bug 人工复核不冲突——门控管"开跑前"，复核管"出报告后"） |
| 3 | 插件侧 `ai-lab-test:smoke` | ✅ **本期不做**（平台先行验证形态，P2 再同步上游） |
| 4 | 环境信息 | ✅ **沿用现有环境配置**（系统名称/地址/登录态不重复填，可选任务级覆盖地址） |
| 5 | 提示词 `<>` 占位符 | ✅ **全部转页面输入或平台自动提供**（映射见 §4.7） |
| 6 | Bug 清单形态 | ✅ **结构化列表 + 人工复核**（复用现有 report_reviewed 复核机制与准确度 KPI，见 §4.8） |
| 7 | 场景输入框文案 | ✅ **「测试场景（描述"验证目标 + 预期结果"，不含具体操作步骤）」** |
| 8 | 三段固定提示词内容 | ✅ **内嵌进平台**（角色→system prompt、全局规则→rules/smoke-test.md、报告结构→报告 prompt），表单不录入、只读说明块告知 |
| 9 | 场景来源 P1 范围 | ✅ **仅手动录入**（AI 生成场景、从功能任务提炼均降为 P2）——与现用提示词习惯一致、零猜测风险，先验证形态跑顺 |

**决策已全部收敛**。实施阶段概览见 §6.2，完整拆解（每 Phase 的步骤/文件/验收）见执行计划 [docs/exec-plans/active/smoke-test.md](../exec-plans/active/smoke-test.md)。

## 8. 已知边界与风险（诚实口径）

- **场景质量取决于用户录入**（P1 只做手动录入）：验证目标写得太粗（如「测一下机构管理」）会让自主探索发散。表单提示语与 `smokeScenariosPrompt` 的「只审不改写 + 列审核提醒」是两道软约束，但不强制拦截。
- **自主探索执行**没有固定步骤兜底，判定依赖 AI 对页面的观察，与用户现用提示词同性质；报告如实呈现，不额外承诺稳定性。
- **`@@OBSERVATION` 遵从性**是新标记，需按 @@RESULT 同款方法在打包版验证（网关模型标记裸写纪律已有先例）。
- **dev 无登录体系**：涉及登录态的冒烟链路本地用 CDP mock 验证，真实验证需打包登录（CLAUDE.md 既有纪律）。
- **打包态规则文件剥离**：smoke-test.md 与其他 rules 同样受 outputFileTracingExcludes 影响，fallback 精简规则必须一次写足。
