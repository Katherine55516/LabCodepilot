# PPT 大纲可靠性 P0：失败归因、契约降级、输入就绪、页数对齐

> 创建时间：2026-10-18
> 最后更新：2026-10-18
> 来源：顶层 `ppt-gamma-results-20261013/PPT_Workspace_Outline_Input_Review_and_Plan_20261018.md` §5 的 P0-1 至 P0-4

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| P0-1 | 失败归因 `failure.origin`，诊断面板按归因和阶段显示 | ✅ 已完成 | 旧记录由前端镜像分类器补算 |
| P0-2 | `callWithContract`；图审计、主题审计、编辑合并、原生标题改为可降级 | ✅ 已完成 | 关键步骤（语义分组、分组大纲、选择）仍按原规则失败 |
| P0-3 | 运行环境探测；必需来源警告在生成前处理 | ✅ 已完成 | 确认记录复用 `sourceObjectExclusions`（kind `source_warning`） |
| P0-4 | 测量的结构化下限和模型初估对齐；增长原因；页数变化日志 | ✅ 已完成 | 显式页数只记录 `measuredExceedsRequest`，不改页数 |
| 验证 | 单元测试、selftest 与基线对比、真实失败离线重放、组件页面检查 | ✅ 已完成 | 交付为可应用到 run17 的补丁，未提交 |

## 决策日志

- 2026-10-18：失败原因不能只看失败码，因为模型步骤的校验器复用 `coverage_invalid` / `schema_invalid`。改为由后端在 `fail()` 里写入 `origin`，前端保留同一套分类作为旧记录的兜底。
- 2026-10-18：提供商的 schema 模式不可信（DeepSeek 网关返回 `{equivalent,notes}`，遥测仍记为 schema）。统一做法：本地格式归一化 → 校验 → 带具体错误修复一次 → 非关键步骤降级。只修格式，不补判断；肯定结论缺少列表时不接受。
- 2026-10-18：主题审计不匹配、用户锁定标题不匹配时，不再让大纲失败，改为 `requiresReview` 警告：停止自动生成，但不强制用户改大纲。审计不可用时记为 `audit_skipped`。
- 2026-10-18：必需来源警告改为在 `/generate` 前拦截（409 `source_warnings_unresolved`），用户确认后最终质检不再报错；来源哈希变化后确认失效。
- 2026-10-18：分页本身不设页数上限，否则会留下溢出页、让写作阶段的修复预算耗尽。改为让预算在一开始就包含测量下限（推荐 = max(模型, 代码密度估算)，上限 = max(模型上限, 结构化下限, 代码上限)），超出时用增长原因说明哪些结构化原件占了页数。

## 详细设计

- 新模块（`apps/cowork-server/lib/`）：
  - `ppt-failure-origin.mjs`，前端镜像 `src/lib/ppt-failure-origin.ts`
  - `ppt-contract-call.mjs`
  - `ppt-source-readiness.mjs`
  - `ppt-page-floor.mjs`
- 修改：
  - `ppt-api.mjs`：fail、大纲警告、来源警告接口、`/generate` 拦截、增长原因、页数变化日志、原生标题降级
  - `ppt-source-graph-audit.mjs`、`ppt-outline-subject-audit.mjs`、`ppt-semantic-groups.mjs`、`ppt-input-understanding.mjs`、`ppt-object-integrity.mjs`、`ppt/project-view.mjs`、`ppt-source.mjs`（soffice 路径解析，缺失时标记 `runtime_dependency_missing`）
  - `scripts/ppt/manual-test-service.mjs`：把探测结果写入 `service-ready.json` 的 `runtimeCapabilities`
  - 前端：`PptOutlineDiagnostic`、`PptOutlineCorrections`、`PptOutlineConcision`、`create/PptSourceWarnings`（新）、`PptCreateWizard`、`types.ts`、`ppt-proxy-path.ts`、i18n 三种语言
- 新接口：`POST /ppt/projects/:id/source-warnings {keys, reason}`
- 测试：
  - `src/__tests__/unit/ppt-p0-outline-reliability.test.ts`（6 项）
  - `apps/cowork-server/selftest-ppt-source-readiness.mjs`
  - 更新 `ppt-engine-integration.test.ts` 中主题审计的预期，改为降级语义

## 验收

- PPT 单元测试只剩快照基线中已有的 1 项失败（ASCII 图），新增 6 项全部通过。
- 129 个 PPT selftest 与快照基线逐项对比：失败集合相同（26 项，都是快照中已有的失败）。
- 离线重放：
  - `c25d9b3a`：DeepSeek 图审计回复直接被接受，图回退为原文逐行，大纲可以继续。
  - `9e6adfda`：预算从 11（9–13）调整为 16（15–21），最终 21 页落在范围内。
- 真实模型验证（2026-10-18，补丁已应用到 run17，3142/3143 已重启；前端仍是 v13 构建，因为 run17 当前缺少 `create/PptInputReview` 无法重新构建，新文案暂不可见）：
  - deepseek-v4-flash（`a33777fe`）：6 个图审计全部通过（其中 2 个经契约修复），不再在图审计失败；随后在关键步骤 `input:understand` 失败，因为两次回复都用了自定义结构（`readerQuestions` / `logicalGroups` / `pageEstimate`），遥测仍记为 schema。待做：在提示词中内嵌 schema 并探测提供商能力（报告 P1-4）。
  - qwen3.8-max 第一次（`44ff2421`）：在 `outline:subject-format` 失败，这条标题格式修复路径漏了降级。已补修（`ppt-p0-outline-reliability-20261018-followup.patch`）并加回归测试。
  - qwen3.8-max 修复后重跑（`1366a9f9`）：进入 outline_ready，共 23 页；预算是模型 11（9–13）、代码估算 19（18–22）、结构化下限 24，调整为 19（18–24）；23 页落在范围内，没有触发增长确认。页数变化（12→14→23）都有日志。封面标题过长的修复降级 3 次，留下 1 条阻塞性标题警告（测试标题是锁定的用户标题）。

### 追加：不遵守 schema 的模型（2026-10-18，`ppt-p0-outline-reliability-20261018-followup2-schema.patch`）

- 传输层：如果回复缺少 schema 要求的顶层字段，就把该 provider/model 标记为 schema 不可靠；之后所有带 schema 的调用都在提示词里内嵌精简版 schema（ID 枚举超过 16 个时改为文字描述）。
- `input:understand` 改走 `callWithContract`：先归一化 deepseek 的字段漂移（`logicalGroups`、`title/summary`、`pageEstimate.range/low/high`），校验时逐条列出具体问题，最多修复 2 次，修复提示词带缺失和多余的顶层字段以及形状示例。
- deepseek-v4-flash 重跑（`a5ced022`）：
  - 首个图审计回复被识别为不遵守 schema，此后提示词都内嵌 schema。
  - `input:understand` 第一次就使用了正确的顶层字段，只有 3 个来源单元未分配；修复一次后通过，预算为 20 页。
  - 随后在 `outline:semantic-groups` 失败：`b_0018` 同时分给了两个组；模型两次给出相同的补丁，又引入新的重复。这是内容层面的归属错误，不再是格式问题。可以考虑的后续：重复归属时按规则确定性去重（保留第一次出现，其余组至少保留一个来源），并记为修正项。

### 追加：语义分组重复归属确定性去重（2026-10-18，`ppt-p0-outline-reliability-20261018-followup3-dedupe.patch`）

- `normalizeSemanticGroups` 先执行 `dedupeSemanticOwnership`：同一来源单元出现在多个组时保留第一次出现，从后面的组里删掉它和对应的 support role，前提是后面的组仍至少保留一个来源。同组内重复、未知 ID、会导致组变空的重复、关系或语言对跨组，仍然交给模型修复。修正项写入 `semanticGrouping.ownershipCorrections`，大纲接受时作为 `duplicate_owner_removed` 列在“修正页面归属”下，并写日志。
- 验证：单元测试 10/10；130 个 selftest 与基线逐项相同（含 `selftest-ppt-semantic-preplanning`，同组重复仍按原规则拒绝）。
- deepseek-v4-flash 重跑（`ff493127`）：
  - 这次第一次分组回复没有跨组重复，去重没有触发。
  - 失败原因换成 support role 用了不在允许列表里的值：4 个组把叙事角色 `process` / `conclusion` 当成 support role（允许值为 definition、mechanism、example、condition、comparison、evidence、reference）。
  - 校验遇到第一个错误就停止，局部修复每次只能修一个组，两次修复后以 `Missing narrativeRole or supportRoles` 结束。
  - 可以考虑的后续：校验一次列出所有组的问题并批量修复；对超出允许列表的 support role 做显式映射或交给模型批量修正。

### 追加：语义分组批量列错与批量修复；截断回复按契约处理（2026-10-18）

- `followup4-batch-groups.patch`：`normalizeSemanticGroups` 把所有组的问题一次收集。只有 1 个问题时保持原消息和原 details，所以单独的 coreMessage 超长仍走单字段修复；多个问题时 details 带 `problems` 列表和全部 `affectedIndexes`，一次局部修复覆盖全部出错的组。重复核心消息和关系跨组同样批量处理。不做任何角色映射。`selftest-ppt-scoped-group-patches` 原来断言“每次修一个组”，已更新为“一次调用修全部”。
- `followup5-truncation.patch`：`callWithContract` 把 `truncated_output`、`empty_visible_output`、`invalid_json` 当作契约问题，重试一次并提示简短作答；非关键步骤之后降级。起因是 deepseek 在一次图审计中产出 4096 token 的失控回复，导致整个大纲失败（`967f5259`）。
- 验证：单元测试 12/12；130 个 selftest 与基线逐项相同。
- deepseek-v4-flash 重跑（`d2fccfc5`）：
  - 所有模型契约步骤都通过：图审计、`input:understand`（第一次就通过）、语义分组（这次是缺来源单元，走全量修复，两轮通过；批量局部修复路径这次没被触发，只由测试覆盖）、编辑合并、分组大纲、容量分页。
  - 最终在本地容量检查失败，归因为 `local_capacity`：架构 ASCII 图（审计后回退为原文逐行）被按每页 17 行分页，每页在 14pt 下仍超出 0.018 英寸。原因是行分页和最终版面测量差了约一行。可以考虑的后续：行分页改用与最终测量相同的函数，或预留一行余量。

### 追加：行分页与最终版面测量一致（2026-10-18，`followup6-line-pagination.patch`）

- 根因（离线重放 `d2fccfc5` 定位）：测量函数本身一致，17 行在模板第 2 页上，分页测量和最终绑定都是 4.781/4.763 英寸。问题出在版式选择：原生模式下分页只要求“任一候选版式放得下”，而 10 个候选版式里有 6 个连一行都放不下，其余几个容量也不同。之后重排把这几页分到了较小的版式，导致溢出。另外分页测量的探针没有标题，和实际输出的页面不一样。
- 修复：`lineHostMask` 先找出能放下该来源至少一行的版式，`paginateLinesForAnyLayout` 要求每个行段在这些版式上全部放得下；测量用与最终页面相同的 `visible()` 页面（含标题和页面契约）。合并原子时，含行段的部分也按同一规则判断，不再被宽松规则合并回 17 行。显式页数（非原生）保持原来的“所有版式”规则。
- 离线验证：失败状态在一轮分页后变为每页 13 行、共 5 页（多 1 页），密度溢出 0，冻结来源绑定失败 0。单元测试 13/13；130 个 selftest 与基线逐项相同。
- deepseek-v4-flash 重跑（`01e7633f`）：还没走到分页就在语义分组失败。批量修复按设计工作：一个错误列出 5 个组，一次修复调用返回 5 个补丁；但 deepseek 两次修复都继续把 `process` / `conclusion` 写成 support role。行分页修复只有离线验证，没有真实端到端验证。

### 追加：语义分组修复提示词逐字段列出允许值（2026-10-18，`followup7-group-field-rules.patch`）

- 只改提示词，不做代码映射：局部修复和全量修复的提示词都附带 `SEMANTIC_GROUP_FIELD_RULES`，逐字段列出类型、长度和允许值，并明确说明 `process` / `conclusion` 只是 narrativeRole 的取值，不能用作 supportRoles[].role（只有 `comparison` 两个字段都可用）。校验用的枚举改为引用同一组常量。
- deepseek-v4-flash 重跑（`c58e560a`）：
  - 第一次分组回复有 2 个组出错（`b_0041`、`b_0091`），两个都用了不允许的 support role。
  - 第一次批量修复改对了 `b_0041`，但 `b_0091` 仍是 `conclusion`；第二次修复依然是 `conclusion`，语义分组失败（model_contract）。
  - 提示词改动有部分效果（2 个改对了 1 个），但这个模型在个别来源上仍不遵守枚举。这次又没走到分页，行分页修复仍只有离线验证。

### 追加：规划类关键步骤的回退模型（2026-10-18，`followup8-planning-fallback.patch`）

- 执行策略新增可选字段 `executionPolicy.planningFallback`（校验方式同 modelRef）。
- `withPlanningFallback` 包住两个关键规划步骤：`input:understand` 和 `outline:semantic-groups`。原模型契约修复用尽后（属于 model_contract 类错误；传输、取消、预算类错误不触发），该步骤用回退模型重试一次：
  - 重试时 stage 带 `:fallback` 后缀，使用独立的任务键和尝试预算，并通过 `routeOverride` 在执行记录里归属到回退模型。
  - 语义分组从最后一个候选结果继续修复，不重新规划。
  - 切换事件写入日志和 `project.modelFallbacks`，成功时在大纲警告中显示 `planning_model_fallback`（处理方式为 `model_fallback_used`）。
- run17 的 `ppt-api.mjs` 在快照之后被 Codex 改过，补丁的上下文对不上，因此用同一组锚点编辑手动合入，并按 run17 重新生成了 patch 8。用 acorn 检查过变量作用域：所有使用都在声明块内。
- 验证：单元测试 15/15；130 个 selftest 与基线逐项相同。
- deepseek-v4-flash 重跑，回退模型为 qwen3.8-max（`a525250c`）：**进入 outline_ready，共 24 页**。
  - 语义分组在 deepseek 上 2 次修复用尽，切到 qwen 后 1 次局部修复加编辑合并即成功，之后的步骤回到 deepseek。
  - 预算是模型 11（10–13），调整为 20（18–24）；24 页落在范围内，没有触发增长确认，`fitValidated=true`。
  - **行分页得到真实验证**：架构图 b_0017（图审计后为原文逐行）分成 16/16/16/12 行四页，没有冻结来源容量失败。上一轮同一张图按 17 行分页时在这一步失败。
  - 剩余 1 条阻塞警告：封面标题过长，原因是测试用的锁定标题“P0 验证 · deepseek-v4-flash（规划回退 qwen）”太长，确认前需要缩短。
