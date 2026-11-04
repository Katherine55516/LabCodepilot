# PPT 大纲生成：调用链、标题覆盖与模型输出改写

> 创建时间：2026-10-22
> 最后更新：2026-10-22
> 基线：run17 `f8f479cb`（outline-first v3 + 阶段 A 的 O1/O5）。分支 `claude/ppt-outline-improve-20261022`。
> 关联：`ppt-gamma-results-20261013/PPT_Module_Architecture_Errors_Outline_Plan_20261021.md`（O1–O6、阶段 A–E）。本计划处理其中三个具体问题，编号见第 2 节。

## 状态

| 步骤 | 内容 | 状态 | 备注 |
|---|---|---|---|
| 0 | 真实 LLM 基线（改动前，同一输入） | ✅ 已完成 | 第 7 节；暴露出 outline-first 下的 8 次逐条拒绝（1.3） |
| 1 | L1 调用账本 | ✅ 已完成 | 问题 1 的度量前提 |
| 2 | S1–S5 选择条目先由代码修正，不再要模型重做 | ✅ 已完成 | 问题 3；基线回放 8 次拒绝 → 0 |
| 3 | T1–T3 归属变化不再覆盖模型标题；需要重命名的页交给模型一次命名 | ✅ 已完成 | 问题 2（O3 的命名部分） |
| 4 | L2 覆盖审查增量复用 | ✅ 已完成 | 问题 1 |
| 5 | L3 总调用预算覆盖审查调用 | ✅ 已完成 | 问题 1（O5 的补全） |
| 6 | 全量回归、提交 | ✅ 已完成 | unit 3058 项通过；selftest 138 通过、33 失败（与基线逐条相同，主要是本机没有 LibreOffice） |
| 7 | 真实 LLM 验证（改动后，同一输入，对照第 0 步） | ✅ 已完成 | 第 7 节；验证中补充 S6 并再次提交 |

## 1. 问题与证据

### 1.1 调用链长：大部分调用是审查和修复，而且阶段 A 的预算管不到它们

cd5a2737（Factor Zoo，outline-first，已含阶段 A）最近一次重试（10-22 02:26–04:07）：

| 指标 | 数值 |
|---|---|
| 大纲阶段调用 | 264 次，101 分钟 |
| 结果 | `outline_ready` / `capacity_blocked`，8 页容量不足，仍不可确认 |
| governor 计费的修复 | 7 次（预算 16）——预算只计"修复轮"，不计审查和容量窗口 |
| 覆盖审查 + 精确复核 | 81 + 30 = 111 次（42%） |
| 摘要忠实性审查 | 37 次 |
| 完全相同的调用（同 stage、同 prompt） | 42 / 554（8%） |

根因：

- **R3（未解决）覆盖审查没有增量。** `auditEditorialCoverage` 的缓存键包含**整套稿件**的可见正文和所有页标题。任何一页的任何改动（一次摘要修复、一次标题缩短）都会让**每个来源组**的结论失效，于是每轮评估都重审所有组。而且只缓存"通过"，被拒的结论每次都重跑审查 + 精确复核。
- **R7（部分解决）总预算不覆盖审查。** 阶段 A 的预算只计修复轮。审查调用占多数，却不受任何上限约束。
- **逐个暴露、逐个修。** 内容选择校验在**第一个**违规处就抛错。v2 实测（向量检索复盘，6 页）：3 个摘要图示依次被拒，每次一轮修复 + 一次 delta 纠正，共 6 次调用，模型每次返回的都是同一个动作（改回 `slides`）。

### 1.2 好标题被覆盖

`compileOutlineCandidate` 编译时，选择补全、孤儿来源回挂会改变某页的来源归属。`partitionTitle` 只要发现归属与模型原稿**有任何不同**，就用来源章节名拼接替换模型标题（只有确认过、用户请求、锁定的标题例外）。容量拆页（`ppt-outline-capacity-repair.mjs` 的 `titleFor`）在 v2 策略下也走同一个函数。

实例（v2，向量检索复盘）：模型给出"业务增长带来的性能与成本挑战""优化效果量化验证"，编译后变成"背景 / 根因分析""结果"。这两页只是**多拿到了**一个来源（b_0006 从摘要改为上页后挂回原页），模型的主题并没有失效。

`partitionTitle` 防的是另一种情况：一页被拆开后，原标题可能声称了不在本页的内容。这条理由只对"失去了原有来源"的页成立，对"只是增加了来源"的页不成立。

### 1.3 模型输出被丢弃或改写

同一次 v2 实测，模型为三个列表来源选择了 `summary + summaryGraph`（并列图示），全部被 `validProseMedia` 拒绝：

| 来源 | 模型的问题 | 能否不靠模型修正 |
|---|---|---|
| b_0006 根因列表 | 4 个节点的 quote 都是原文、且在原文中唯一，但字符偏移 `start/end` 算错 | 能：按唯一原文 quote 重新定位偏移（run17 已有 `normalizeProseMediaEvidence`，但只在编辑归属合同路径上调用） |
| b_0020 遗留风险 | 节点 label 是模型改写的短语，不在原文 quote 中 | 不能保留图示；可以改为本页显示完整原文（3 条短列表） |
| b_0022 Q4 计划 | `parallel` 图示带了 3 条边；1 个 label 不在原文中 | 同上 |

三次修复，模型返回的都是"改为 `slides`，显示完整原文"。这正是校验器自己写在错误里的要求，是一个确定的动作，不需要模型。

outline-first 基线（第 0 步，run17 原代码，同一输入）更明显。逐页展开后，内容选择校验**每轮只报第一个**违规，模型修一条、再报下一条，共 8 轮（外加 2 次 delta 纠正）。把存下来的展开结果离线回放，8 条拒绝的原因一次列全：

| 来源 | 拒绝原因 | 性质 |
|---|---|---|
| b_0006、b_0020、b_0022 | 摘要图示不是逐字摘录（标签/正文是模型改写或翻译；`parallel` 带边） | 无法保留图示；完整原文是校验器要求的结果 |
| b_0011、b_0013、b_0015、b_0022 | `reason` 266–278 字，超过 240 字上限（报错文案是"Invalid or duplicated source disposition"） | 纯规划元数据，不显示给读者 |
| b_0009、b_0018 | 中文单语来源的摘要后面追加了英文翻译 | 展开提示词在 `body:'both'` 时一律要求"两种语言都显示"，即使本页没有双语对 |

这 8 轮修复没有一轮需要模型判断。

## 2. 方案总览

| ID | 问题 | 做法 | 对应 | 本轮 |
|---|---|---|---|---|
| L1 | 1 | 每次大纲运行记录调用账本（总数、按类别、审查/修复/规划），写进 governor 摘要和失败追踪 | O5 | ✅ |
| S1 | 3 | 所有 v2 合同在校验前按唯一原文 quote 重新绑定图示证据偏移 | — | ✅ |
| S2 | 1、3 | 仍无效的摘要图示：在同一页改为显示完整原文（`slides`），记一条更正，不调用模型 | O1（确定性规则不交给模型） | ✅ |
| T1 | 2 | 归属变化时，若该页仍拥有原计划的**全部**来源（只增不减），保留模型的标题、焦点和问题 | O3 | ✅ |
| T2 | 2 | 失去部分原来源的页（拆页、移走）：先用章节名作临时标题并标记 `titleBasis:'source_headings'`，评估收敛后把这些页**一次性**交给模型命名（复用有界的元数据修复批次）；命名失败则保留临时标题，不阻断 | O3 | ✅ |
| T3 | 2 | 拆页的每一部分沿用同一规则（T1/T2），重复标题仍由 `distinctPageTitles` 区分 | O3 | ✅ |
| L2 | 1 | 覆盖审查按来源组复用："通过"在本组材料不变、且当前可见正文是当时可见正文的超集时继续有效（只增不减不会造成新的遗漏）；页标题变化不使结论失效；"拒绝"按完整材料精确缓存 | O4 的增量部分 | ✅ |
| L3 | 1 | 展开后所有大纲调用（含审查）计入总预算 `PPT_OUTLINE_CALL_BUDGET`（默认 48）。到达后：停止修复轮；尚未运行的模型判断审查（覆盖、摘要忠实性）不再调用，改为"未审查"提示；确定性硬门禁不变 | O5 | ✅ |
| B1 | 1、3 | 大纲不写摘要正文，只给来源 ID + 预算，正文和忠实性审查移到写手阶段 | O2 | ⏸ 阶段 B |
| B2 | 2 | 主题内分页完全由代码按来源顺序和测量权重切分，模型只为每页命名 | O3 全量 | ⏸ 阶段 B |
| B3 | 1 | 覆盖审查只在语义大纲上做一次 | O4 | ⏸ 阶段 C |
| B4 | 1 | 统一计划修改入口、拆出 `ppt-outline-pipeline.mjs` | O6 | ⏸ 阶段 D |

暂缓项的理由见第 4 节。

## 3. 详细设计（按执行顺序）

### 步骤 1　L1 调用账本

- `ppt-outline-governor.mjs`：`meter(nodeKey)` 对每次调用计数，按 `outline:<family>` / `input:<family>` 归类，并分为 `planning`（logical、capacity、materialize、input）、`review`（各类 audit、precision）、`repair`（现有 `REPAIR_STAGE`）、`other`。`summary()` 增加 `calls: {total, byKind, byFamily}`。
- 只在 outline-first 项目启用（与阶段 A 一致），旧流程行为不变。
- 测试：`selftest-ppt-outline-governor.mjs` 增加账本断言（分类、合计、关闭时为 undefined）。

### 步骤 2　S1–S5 选择条目先由代码修正（原 S1/S2，基线后扩充）

- 新函数 `salvageSummaryGraphs(project, raw)`（`ppt-content-selection.mjs` 旁的小模块 `ppt-summary-graph-salvage.mjs`），在 `compileOutlineCandidate` 的最前面调用，因此编辑归属合同（overview）和其他 v2 合同都会经过：
  1. 对每个 `destination:'summary'` 且带 `summaryGraph` 的条目，先用 `normalizeProseMediaEvidence` 重新绑定偏移；有效则保留模型的图示（更正记 `summary_graph_evidence_rebound`）。
  2. 仍无效，并且该来源的允许去向包含 `slides`、且已有页面拥有它：改为 `destination:'slides'`，删除 `summaryGraph`，原因写明"图示不是逐字摘录，显示完整原文"，更正记 `summary_graph_restored_complete`。
  3. 都不满足：原样保留，交给原有校验和修复（行为不变）。
- S3：`reason` 超过 240 字时在句子/分句边界截短（更正 `metadata_shortened`）。
- S4：单语来源（无 `languagePairId`）的摘要违反来源语言规则、且能干净地拆成"来源语言部分 + 另一种语言部分"时，只保留来源语言部分（更正 `summary_translation_removed`）；拆不开则交给原有路径。
- S5：展开提示词只在本页确有双语对时才说"两种语言都显示"，否则明确"按来源语言写，不要追加翻译"；并写明 reason 上限和图示标签/正文必须逐字摘录。
- S6（真实验证中补充）：独立关系审查（`source:graph-audit`，硬门禁）拒绝一张逐字摘录、但边是模型推断的图示时，修复循环用确定性修复把它改为本页完整原文（`relationGraphFallback`），不再调用模型。依据：改动后的两次真实样本里，这类拒绝共 3 次，模型 3 次都返回"改为 slides"。
- 实现：`ppt-selection-salvage.mjs`，S1–S4 在 `compileOutlineCandidate` 开头调用（编辑归属合同与其他 v2 合同都经过）；S6 作为确定性修复任务接在语言兜底之后（主修复循环和编辑范围修复循环都接入）。
- 不改变来源归属、页数和其他条目。
- 测试（单元，`src/__tests__/unit/ppt-outline-salvage.test.ts`）：用实测的三条来源和模型回复作为 fixture——b_0006 保留图示且偏移被修正；b_0020、b_0022 改为完整原文；不允许 `slides` 的来源不被改动；编译后的候选通过 `compileContentSelection`，不再抛 `Prose media requires exact ...`。

### 步骤 3　T1–T3 标题

- `ppt-partition-intent.mjs`：
  - `partitionTitle`：若新归属是原归属的超集（原 `sourceUnitIds`、`sourceArtifactRanges` 全部仍在），**且新增来源都来自原有来源所在的章节**，返回模型原标题。否则用章节名拼接作临时标题，调用方写入 `titleBasis:'source_headings'` 与 `titleBeforeRepartition`（模型原标题，作为命名参考）。
  - 修订（实施中）：原计划只看"超集"。已有测试 `ppt-source-graph.test.ts` 要求"页面新增了另一章节的内容时，标题要跟上"，这个要求合理（原标题会漏掉新主题）。所以超集但跨章节的页也交给模型命名，而不是保留原标题或停在章节名拼接。用户的例子（"背景"页挂回了"根因分析"的来源）属于这一类，由模型在原标题基础上重新命名。
  - `partitionIntent`：超集时保留模型的 `focus/question`；否则维持原逻辑。
- `ppt-outline-compile.mjs`、`ppt-outline-capacity-repair.mjs`：按上面写入标记；`ownership_title_refreshed` 更正只在真的换了标题时记录。
- 命名批次 `ppt-api.mjs`：评估收敛后（原生标题修复之前），收集 `titleBasis==='source_headings'` 的非封面页，生成 `metadataConflicts`（`field:'title'`，`reason:'ownership_changed'`，带 `previousTitle`），调用 `repairOutlineMetadataBatch` 一次（节点 `outline:page-names:<pass>`）。校验沿用现有规则（长度、语言、不重复、有主题）。失败按现有 `degradeTitleRepair` 降级。`outlineMetadataRepairPrompt` 为该原因增加一句：在 `previousTitle` 仍被本页来源支持的部分上改写，不要拼接章节名。
- 测试：`src/__tests__/unit/ppt-outline-titles.test.ts`——同章节新增保留标题和焦点；跨章节新增与拆页被标记；命名提示词带原标题，应用后 `titleBasis:'ownership_named'`，重复标题被拒，再次编译保持模型命名。

### 步骤 4　L2 覆盖审查增量复用

- `ppt-editorial-coverage.mjs`：每组的"组材料"= 来源组、本组条目的去向与可见内容、被排除列表、详细度、`coverageScopeVersion`（不含全稿可见正文与页标题）。
  - 通过：缓存 `{groupKey → {visible: 全稿可见条目哈希集合, verdict}}`。之后若组材料相同，且当前全稿可见条目哈希集合 ⊇ 缓存时的集合，直接复用。
  - 拒绝：按完整材料（含全稿可见正文）精确缓存最终结论（含精确复核），同一材料不再重审。
  - 修订（实施中）：原计划"页标题不进入复用判断"。已有 selftest 明确要求"可见标题变化后重新审查"（标题是可见的框架）。改为：可见正文条目和页标题都是当时的超集才复用；新增页、新增正文不重审，改动或删除已有标题、正文则重审。
- 测试：单元测试（假模型计数）——无关页的标题缩短后不重审；其他组的可见正文增加后不重审；删除该组所依赖的可见条目后重审；同一被拒材料第二次不调用模型。

### 步骤 5　L3 总调用预算覆盖审查

- `ppt-outline-governor.mjs`：`callBudget`（`PPT_OUTLINE_CALL_BUDGET`，默认 48，只计展开之后的调用，即不含阅读、语义、容量分配和逐页展开），`reviewAllowed()`；到达预算时 `stop('call_budget')`，`allowRepair()` 随之为 false。
- `ppt-api.mjs` 的 `judged(kind,…)`：`reviewAllowed()` 为 false 时不运行该审查，加入提示 `{code:'outline_review_skipped_advisory', kind, resolution:'review_skipped'}`；覆盖审查同时把 `editorialCoverageAcceptance` 记为 `advisory`（与阶段 A 的提示路径相同）。
- 前端 `PptOutlineCorrections`：`review_skipped` 进入 `DETAILED`；i18n（en / zh / zh-HK）新增 `ppt.outlineFix.review_skipped`。新更正码 `summary_graph_evidence_rebound`、`summary_graph_restored_complete` 归入 summary 类，`ownership_title_named` 归入 metadata 类。
- 测试：governor 自测（预算停止、审查跳过）；API 测试（假模型：覆盖审查一直拒绝 + 预算很小 → 进入 `page_plan_ready`，带"未审查"提示，审查调用次数 ≤ 预算）。

### 步骤 6　回归与提交

- `npm run test`（typecheck + unit）、全部 `selftest-ppt-*.mjs`、PPT e2e 中与大纲确认相关的用例。
- 提交按步骤分组写明改了什么、为什么。

### 步骤 7　真实 LLM 验证

- 同一隔离后端脚本（`outputs/ppt-outline-improve-20261022/`，backend-only + 真实 SDK worker，qwen3.8-max），同一输入（向量检索复盘），同一驱动（读取 → 语义大纲 → 展开）。
- 对照第 0 步：调用总数和分类、耗时、最终阶段、页标题、更正和提示。
- 之后在前端走一次确认和生成，确认输出页面。

## 4. 暂缓项与理由

- **B1（O2，大纲不写摘要）**：要改写手提示词、writer gate 和单页忠实性审查（G4），是生成阶段的合同变更，需要它自己的真实整稿验收。本轮 S2 只消除"图示无效 → 再问模型"这一类循环。
- **B2（O3 全量，代码切分主题内分页）**：要替换 `capacityTask` 的逐页来源分配，并重新验证容量测量。本轮 T1–T3 先实现"代码改了归属不再改名，命名交给模型"。
- **B3（O4）**：依赖 B1，否则展开后仍有新的摘要要审。本轮 L2 先去掉"无关改动导致全量重审"。
- **B4（O6）**：纯重构，等 B1/B2 落地后再拆，避免同时改行为和结构。

## 5. 决策日志

- 2026-10-22：基于 run17 新建分支（用户选择）。run17 有 Codex 未提交的改动，本分支不碰该工作树。
- 2026-10-22：预算用尽时降级为"只保留硬门禁"并提示未审查项，而不是停下等用户（回答架构文档 §9 第 3 问）。理由：模型判断的问题在阶段 A 已经是提示；停下等用户只会把同样的提示推迟出现，且用户无法在大纲阶段补一次审查。
- 2026-10-22：标题保留规则用"超集"而不是"有重叠"。拆页后的部分与原页有重叠，但原标题可能声称了不在本页的内容，这类页交给模型重新命名。
- 2026-10-22：覆盖审查复用要求可见正文和页标题都是超集（尊重已有"标题变化需重审"的合同），见步骤 4。
- 2026-10-22：标题保留规则收紧为"超集且同章节"，跨章节新增交给模型命名（尊重已有"标题跟随恢复的归属"的测试），见步骤 3。
- 2026-10-22：基线暴露出 S3–S5 三类确定性问题（reason 超长、追加翻译、提示词误导），并入步骤 2。
- 2026-10-22：第一次改动后的真实验证发现关系审查拒绝后的修复同样是确定动作，补充 S6，再次提交并重新验证。

## 6. 验收标准

- 问题 3：实测输入中，模型选择的有效图示保留；无效图示在编译时改为完整原文，大纲阶段不再出现 `outline:summary:*` 修复轮。
- 问题 2：只增加来源的页保留模型标题；拆页后被标记的页经一次命名调用得到模型标题，不出现"A / B"拼接（命名失败时除外，且有更正记录）。
- 问题 1：outline-first 每次运行的展开后调用不超过预算；同一输入的大纲调用数低于基线；无关改动不触发覆盖重审。
- `npm run test` 与相关 selftest、e2e 通过。

## 7. 真实 LLM 对照

环境：隔离后端（backend-only + 真实 SDK worker），qwen3.8-max，模板 blue，输入为约 1,000 字的向量检索复盘（`outputs/ppt-outline-improve-20261022/input-vector-search.md`，不入库），驱动脚本同目录 `drive-outline.mts`。

### 第 0 步：基线（run17 `f8f479cb` 原代码）

| 样本 | 流程 | 结果 | 调用总数 | 其中修复轮 | 展开后审查 |
|---|---|---|---|---|---|
| baseline-vector-1 | outline-first / overview | `page_plan_ready` | 32 | summary ×9（含 2 次 delta 纠正）、selection ×1、table-projection ×1 | 覆盖 6、摘要 3 |
| baseline-vector-2 | outline-first / overview | `page_plan_ready` | 25 | summary ×8 | 覆盖 3、摘要 2 |
| baseline-full | outline-first / full_source | `page_plan_ready` | 5 | 0 | 0（全文模式不做选择） |
| baseline-v2 | 经典 v2 | 失败：大纲调用传输超时（104 s，模型侧） | 3 | — | — |

两个 overview 样本中，模型标题都没有被代码改写（编辑归属合同路径不经过 `partitionTitle`）；问题 2 只在经典 v2 流程或全文模式下归属发生变化时出现（10-22 早些时候 v2 实测："背景 / 根因分析"）。

### 第 7 步：改动后

`after` = 提交 `1ea5598d`（S1–S5、T、L1–L3）；`after2` = 再加 `0585f6a5`（S6）。基线服务和改动后服务同时运行，代码哈希不同（`b4c9ec1e…` / `ade91472…`）。

| 样本 | 流程 | 结果 | 调用总数 | 修复轮 | 审查调用 | 规划后耗时 |
|---|---|---|---|---|---|---|
| baseline-vector-1 | outline-first / overview | `page_plan_ready` | 32 | 11 | 10 | 3.5 min |
| baseline-vector-2 | outline-first / overview | `page_plan_ready` | 25 | 8 | 6 | 2.4 min |
| after-vector-1 | outline-first / overview | `page_plan_ready` | 20 | 2 | 9 | 1.9 min |
| after-vector-2 | outline-first / overview | `page_plan_ready` | 20 | 3 | 8 | 1.9 min |
| **after2-vector-1** | outline-first / overview | `page_plan_ready` | **19** | **1** | 9 | 2.1 min |
| **after2-vector-2** | outline-first / overview | `page_plan_ready`（9 页） | **20** | **1** | 7 | 1.9 min |
| baseline-full / after-full | outline-first / full_source | `page_plan_ready` | 5 / 5 | 0 / 0 | 1 / 2 | — |
| baseline-v2b / after2-v2 | 经典 v2 | `outline_ready` | 12 / 12 | 4 / 1 | 5 / 7 | 0.7 / 0.8 min |

"修复轮"包含 delta 纠正；"规划后耗时"从容量分配（v2 为大纲调用）返回到最后一次调用。

结论：

- **问题 3**：after2 两个样本只剩 1 次修复，都是摘要忠实性审查（模型判断）触发的那一次（O1 允许每类 1 次），没有一次是因为格式、元数据、语言或图示。S2 在 after 样本中把 3 个无效图示直接改为原文；S6 在 after2-vector-1 中处理了关系审查拒绝的图示。
- **问题 1**：outline-first overview 的调用从 32/25 降到 19/20，修复轮从 11/8 降到 1/1，规划后耗时约减半。审查调用没有减少（7–9 次）：S1 保住了模型的有效图示，这些图示要经过关系审查（`source:graph-audit`，原来被修复成原文后就不审了）；这份输入只有 3–4 个来源组，L2 复用的收益在大文档上才明显。所有样本都远低于 L3 预算（48），预算未触发。
- **问题 2**：这些样本的编译都没有改变页面归属（编辑归属合同不经过 `partitionTitle`；全文模式下容量分配已覆盖全部来源），所以标题都是模型的。命名步骤单独用真实模型验证（`naming-check.mts`，同一提示词和校验器）：用户的例子编译后的临时标题"背景 / 根因分析"，一次调用后得到"业务增长带来的性能与成本挑战及其根因"，保留了原标题并补上新主题。

### 前端与生成

- 在隔离前端（3246）打开 after2 的两个页面计划：计划与分页理由正常显示；after2-vector-2 的更正面板显示"摘要补回必须保留的句子或行（3）"（3 条图示改原文）和摘要忠实性提示及原因。
- 在 after2-vector-2 上确认并生成：9 页全部写完，确定性门禁 0 个错误；整稿审查拦下发布（`quality_blocked`）：第 6 页写手把其他页的事实（"62% GPU 时间""第三步、第三季度实施"）写进了只绑定 b_0013 的页面，页面级事实审查判为无依据。这是写手阶段的范围问题（与 10-22 v2 实测中被拦下的总结页同类），不属于本计划；记入后续。
- 本机没有 LibreOffice，导出可见性校验无法运行（与基线相同）。

### 后续：写手越页引用（已处理，见第 8 节）

- O2/O3 全量/O4/O6 见第 4 节。

## 8. 写手阶段：页面来源范围（W1/W2，真实验证后追加）

被拦下的第 6 页（只拥有 b_0013）有两处无依据的内容，来源不同：

| 内容 | 从哪来 | 根因 |
|---|---|---|
| "此优化属于复盘第三步，于 2026 年第三季度实施" | 大纲展开时写进 b_0013 的摘要 | 展开提示词要求"是什么、为什么、何时适用"，模型从节标题和文档标题补了一句；大纲的摘要忠实性审查看到 `sectionPath`，认为"由节路径合理推出"而通过。发布时的页面事实审查只认 b_0013 原文，判为无依据 |
| "以解决召回与重排耦合占用 62% GPU 时间的问题" | 整稿审查后的修复轮（`critic-1`）写手新增 | 写手上下文含其他页的事实：检索按关键词把根因页的分块和证据（62%）放进 `source_packet`；短稿（< 30k 字符）还会把整份原文作为 `INPUT_FRAMEWORK` 发给每一页 |

修改：

- **W1 写手只看本页审查认可的来源**（`writerRetrieval`、`scopeRetrievalToSources`、`writerPrompt`）：页面合同为 `sourceScope:'owned'`（编辑归属合同）时，检索结果只保留来源单元全部在"本页拥有 ∪ 同分块备注 ∪ 结尾页回顾证据"内的分块和证据（与 `claimAuditRegistry` 的 permitted 集合相同），去掉原始分段；并且无论长度都使用页面视图（`writerCorrectionContext(..., {always:true})`：原输入只发身份哈希，不发全文）。页面视图补上 `task`、`intent_is_not_source_authority`、`source_artifacts` 三块（本页说明和本页来源，不含他页事实）。从 Prompt 开始的稿件，prompt 与原文只差空白时不再作为 userPrompt 重发。
- **W2 大纲摘要不得把标题内容写成事实**：展开提示词和摘要忠实性审查都写明：节标题、文档标题中的内容（步骤号、日期、项目名）不能作为关于该来源的事实；审查对这类新增句判为不忠实，与发布时的页面事实审查一致。
- 其他合同（全文、课程等）的写手上下文不变（测试覆盖）。

- **S7（复验中发现）**：两次复验的语义大纲都因模型把最后一张卡片的 `dependsOn` 写成包含自身（`[5, 6]`）而整次失败，且没有修复路径。依赖关系是规划元数据：自身或之后卡片的引用在校验前去掉（`settleSemanticDependencies`），其余字段仍由 `acceptSemantic` 严格校验。

- **复验中再发现的三处（都已修，各自单独提交）**：
  - 数值核对把"从9.6万元""增至21.4万元"读成"6万""4万"（汉字紧贴数字时，正则的前向排除把汉字当成标识符字母，匹配从小数点后开始），确定性门禁拦下发布。前向排除改为只排除拉丁/希腊/西里尔字母、数字、`_`、`.`、`,`（`ppt-evidence.mjs`）。
  - 覆盖审查的模型回复把同一个来源 ID 写了两次（`[b_0020, b_0020]`），校验要求不重复，判为无效结论，两次纠正后仍无效，整次大纲失败。先去重再校验。
  - 模型给出的有效图示里，每个节点的正文与标签是同一句原文，页面把每条列表项打印两遍，整稿审查判为重复并拦下发布。S8：编译时去掉只是重复标签的正文，图示仍逐字有效。以短标签开头的完整句子（"Train" / "Train on the past."）是正常解释，保留（第一版误删了这类正文的开头，已改正）。
  - 更一般地：outline-first 下，模型判断类审查（覆盖、摘要忠实性）在有界纠正后仍给不出有效结论时，改为"未完成复核"提示（`review_skipped`），不再让整次大纲失败（O1：模型判断不阻断）。旧流程不变。提示文案改为同时覆盖"预算用完"和"没有有效结果"两种原因。

验证：同一项目的第 6 页，写手提示词中 "62%" 从 2 处变为 0；改为页面视图后提示词 20k 字符（原压缩视图 19k，未压缩全量 29k）。单元测试 `ppt-writer-page-scope.test.ts`。

### 真实生成复验（同一输入，确认页面计划后生成）

| 样本 | 代码 | 页数 | 页面事实审查（不成立 / 总数） | 整稿审查 | 停在 |
|---|---|---|---|---|---|
| after2-vector-2（修复前） | `0585f6a5` | 9 | 2 / 8 | 无依据 1 | 写手越页（62%）与标题事实（第三步、第三季度） |
| after3-gen-1 | `bc2b4bb8` | 10 | 0 / 9 | 重复 1 | 数值误判"6万""4万"（已修 `c57c6957`） |
| after3-gen-2 | `bc2b4bb8` | 7 | 0 / 7 | 0 | 同上 |
| after4-gen-1 | `c57c6957` | 7 | 0 / 8 | 0 | 导出校验（本机无 LibreOffice） |
| after4-gen-2 | `c57c6957` | — | — | — | 大纲：覆盖审查回复重复 ID（已修 `ede403cf`） |
| after5-gen-1 | `ede403cf` | 9 | 0 / 7 | 0 | 导出校验（本机无 LibreOffice） |
| after5-gen-2 | `ede403cf` | 7 | 0 / 9 | 重复 1 | 图示节点正文重复标签（已修 `3cca1afe`/`c9bddc72`） |
| after6-gen-1 | `c9bddc72` | 7 | 0 / 8 | 0 | 导出校验（本机无 LibreOffice） |
| after6-gen-2 | `c9bddc72` | 7 | 0 / 8 | 无依据 1、冲突 1 | 写手把 b_0009 的"查询先路由到所属业务线的分片"写成"默认路由至…"，审查认为"默认"引入了原文没有的例外。本页来源内的措辞问题，模型判断，可在编辑器里改 |

结论：修复后 8 次生成中，页面事实审查没有再出现越页事实或标题事实（0 条不成立）。复验中暴露的其余拦截都是确定性问题，已逐个修复并提交。剩下的拦截一类是环境（本机没有 LibreOffice，导出可见性校验无法运行，与基线相同），一类是写手在本页来源内的措辞被模型审查判为改义。
