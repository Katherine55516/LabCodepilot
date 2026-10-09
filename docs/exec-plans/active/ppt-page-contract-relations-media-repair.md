# PPT 四支柱：页面设计契约、语义关系、媒体账本、分层修复

> 创建时间：2026-10-09
> 最后更新：2026-10-09
> 依据：`docs/research/ppt-master-skill-review-20261009.md`（第 3、12–18 节），Factor Zoo 同源对照（Gamma 10 页 / ppt-master 16 页 / 模块估算 34 页双语、25 页单语等价）
> 关联：`active/ppt-general-content-media-balance.md`（本计划是其 Phase 2–5 的确定性基础，不另起页面流程）

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| A | 语义关系：库存中的类型化关系 + 关系保真检查 | ✅ 已完成 | 见“执行记录” |
| B | 页面设计契约：schema、解析、推导、持久化、prompt v10、确定性检查 | ✅ 已完成 | |
| C | 媒体账本：角色分桶、相对模板守恒、连续纯文字页、mapped 未建档状态 | ✅ 已完成 | |
| D | 分层修复：issue 所属层与允许操作、主题绑定保护、修复回滚 | ✅ 已完成 | |
| E | 有下限的整页比例缩放、组件原型、可变槽位、媒体随条目伸缩 | 📋 待开始 | 并入 balance 计划 Phase 4（需渲染契约改动） |
| F | 真实模型验证：同源 Factor Zoo × Process Improvement、09 × Process Improvement | 📋 待开始 | 需模型凭证（harness `--adapter docker`） |

## 决策日志

- 2026-10-09 **只做确定性基础，不新增用户步骤。** 契约、关系、账本、所属层都在现有流水线内部产生，结果进入现有质量报告，UI 展示留给 balance 计划 Phase 6。
- 2026-10-09 **新检查默认 warning，结构性破坏为 error。** 关系类型被改（可替代表达画成顺序、流程顺序被改）为 error；契约单位缺失、公式与解释分页、媒体角色归零为 warning。理由：没有真实模型基线前，不能让启发式检查阻断现有发布；结构关系错误则属于明确的事实失真。
- 2026-10-09 **契约以“模型给出 + 确定性推导”合并。** 模型给出的 ID 必须是真实库存/关系 ID，否则丢弃；推导部分总是补齐公式解释邻接、矩阵比较轴等可由来源确定的要求。
- 2026-10-09 **主题绑定。** 只有显式绑定（`project.bindings.theme === true` 或 `templateSpec.palette.locked === true`）时修复不改色；当前没有项目设置这两个字段，行为不变，但修复入口已受约束。
- 2026-10-09 **修复回滚。** `repairProject` 若产生新的硬错误（按 code + slideId 计），整体回滚到修复前并记录 `repair_rolled_back`。
- 2026-10-09 **Prompt 契约 9 → 10。** OUTLINE_SCHEMA 增加 `pageContract`，大纲规则说明关系类型与契约含义。

## 设计

### A. 语义关系（`lib/ppt-semantic-relations.mjs`）

库存 `relationships` 由来源结构确定性生成，保留旧字段（`id / sourceUnitId / relation / steps / chunkRefs / priority`）以兼容覆盖统计：

| type | 来源 | 记录 |
|---|---|---|
| `matrix` | TableBlock | axes（表头）、members（首列）、rowCount、columnCount |
| `order` | ProcessBlock（含 ASCII/mermaid 转换后的步骤） | members（步骤标签）、branches（含 Yes/No 等条件的步骤） |
| `alternative` | 正文中的“several ways: A, B, … / 多种表达方式：A、B…”；遇到 “not interchangeable / 不可互换” 标记 `interchangeable:false` | members（≥3 项） |
| `definition` | 公式块之后同节以 where / here / then / 其中 / 式中 开头的解释段（及其语言配对） | unitIds = [公式, 解释…] |

`inspectRelationFidelity(project, slides)`：
- `relation_alternative_as_sequence`（error）：拥有可替代关系的页面用了时间线/步骤原型或有序列表承载其成员；
- `relation_order_changed`（error）：由流程单元渲染的时间线步骤顺序与来源不同；
- `relation_definition_split`（warning）：公式与其解释被分到不同页面。

### B. 页面设计契约（`lib/ppt-page-contract.mjs`）

字段：`job / question / requiredUnits / requiredRelations / adjacencyPairs / comparisonAxes / groupingReason / omissions / compositionCandidates / basis`。

- `normalizeOutline` 解析模型给出的 `pageContract`，只保留真实 ID；
- `slidePlan` 合并推导结果并持久化为 `pageContract`，writer 通过现有 `<slide_contract>` 收到；
- 推导：拥有的公式自动带上解释单位与邻接对；矩阵带比较轴；`big-number` 只在本页拥有数值证据原子时列入候选；
- `inspectPageContracts`：`page_contract_unit_missing`（warning）、`page_contract_adjacency_split`（warning）、`big_number_without_source_value`（warning：非封面页的 ≥40pt 文字不是来源数值）。

### C. 媒体账本（`lib/ppt-media-ledger.mjs`）

由对象完整性账本的 `templateAssets` 与来源图片构建。角色分为 evidence / brand / aid / decoration / unknown 五桶，状态取自现有处置（retained / replaced_verified / retired_by_adaptation / excluded_by_user / unresolved）。

- 汇总：每桶期望数（输出页对应模板页的媒体）、保留数、守恒比、归零角色、模板带媒体页占比、最长连续纯文字页；
- mapped 或无模板档案：`status: 'template_media_not_profiled'`，不判通过；
- 检查：`media_role_dropped`、`media_conservation_low`（<0.7）、`media_text_only_run`（≥3 且模板带媒体页 ≥50%），均为 warning；
- `deterministicReview` 返回 `mediaLedger`，最终质量报告带出。

### D. 分层修复（`lib/ppt-repair-routing.mjs`）

`annotateIssue` 为每个 issue 补 `ownerLayer / repairKind / allowedOperations`：

| ownerLayer | 典型 issue | 允许操作 |
|---|---|---|
| scope | model_unsupported、model_conflict、numeric_source | 用来源改写、删除无据主张 |
| content | model_missing、mandatory_content_*、page_contract_unit_missing、重复类 | 用来源补齐、去重、重组 |
| semantic | relation_*、page_contract_adjacency_split | 换原型、重组、恢复顺序 |
| plan | planned_* | 重分配、拆页提议 |
| composition | 溢出/容量/碰撞/布局/标题、big_number_without_source_value | 换原型、调区域、重排、拆页提议、有下限缩放 |
| media | media/image/asset/template_media | 重绑、恢复资产、改裁切 |
| theme | contrast/palette/font token | 调整未绑定 token、报告绑定冲突 |
| export | export/render/verification | 重渲染、修运行环境 |

`deterministicReview` 与 `finalQualityReport` 的所有 issue 都经过标注；`repairProject` 的每条修复记录带 `ownerLayer`；主题绑定时不改色；新增硬错误则回滚。

## 验收

- 新增自测 `selftest-ppt-four-pillars.mjs` 覆盖 A–D 的正例与负例；
- 全部 `selftest-ppt*.mjs`、tsc、单元测试通过；
- 用 Factor Zoo 输入验证：§8 识别为 alternative（5 项，不可互换），§6/§7 表格识别为矩阵（8×3、7×4），公式与解释邻接对被推导。

## 执行记录（2026-10-09）

| Phase | 实现 | 位置 |
|---|---|---|
| A | `buildRelations` 替换原库存关系构建（保留旧字段）；`inspectRelationFidelity` 进入 `deterministicReview`；平行双语的可替代表达合并为一条关系 | `lib/ppt-semantic-relations.mjs`、`ppt-content-inventory.mjs`、`ppt-quality.mjs` |
| B | `normalizePageContract`（只保留真实 ID）、`pageContractFor`（合并推导）、`inspectPageContracts`；`normalizeOutline` 解析、`slidePlan` 持久化；OUTLINE_SCHEMA 与 `<page_contract_rules>`；契约版本 10 | `lib/ppt-page-contract.mjs`、`ppt-api.mjs`、`ppt-planning.mjs`、`ppt-prompt-contracts.mjs`、`ppt-generation-policy.mjs` |
| C | `buildMediaLedger` / `inspectMediaLedger`；`deterministicReview` 与最终质量报告带出 `mediaLedger` | `lib/ppt-media-ledger.mjs`、`ppt-quality.mjs` |
| D | `routeIssue` / `annotateIssues`；所有确定性与模型 issue 带所属层；`repairProject` 修复记录带所属层与操作、主题绑定时不改色、新增硬错误整体回滚 | `lib/ppt-repair-routing.mjs`、`ppt-quality.mjs` |

**验证：**

- 新增 `selftest-ppt-four-pillars.mjs`，覆盖四个支柱的正例与负例：
  - 可替代表达画成步骤会报错，比较原型不报；
  - 步骤反序会报错；
  - 公式与解释分页会报警；
  - 伪造 ID 被丢弃；
  - “β ≠ α”和无来源的“400+”占大字位会报警，来源中的“800%”与标题不报；
  - 媒体角色归零、守恒低、连续纯文字页会报警，mapped 模式记为未建档；
  - issue 均带所属层；
  - 主题绑定时不改色并报告冲突。
- 真实输入 Factor Zoo：
  - §8 识别为 5 项不可互换的可替代表达（中英一条关系）；
  - 矩阵 5×3、7×4、7×4、8×3、8×5；
  - 6 组公式解释。
- 34 个 `selftest-ppt*.mjs` 全部通过（python-pptx + LibreOffice 运行时）；tsc 通过；单元测试 2808 通过、1 跳过。
- harness dry run（Factor Zoo × Process Improvement）流水线贯通。估算 35 页（双语，与 18.4 节口径一致），首个大纲 prompt 为 376,645 字符（技术债务仍在）。

**边界：**

- 修复回滚只对 `newHardErrors` 做了单元验证，尚无能触发回滚的真实修复样例。
- 新检查除关系类型错误外均为 warning，待真实模型基线后再校准严重级别。
- 契约是否改善页面组织，需要真实模型运行（Phase F）才能判断；本轮只证明契约被正确生成、传递与检查。
- 有下限的整页比例缩放、组件原型与可变槽位属于 Phase E。
