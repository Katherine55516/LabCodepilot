# PPT 大纲收敛：调用预算、代码修正与模型命名

> 产品思考见 [docs/insights/ppt-outline-convergence.md](../insights/ppt-outline-convergence.md)
> 执行计划：[exec-plans/completed/ppt-outline-calls-titles-selection-20261022.md](../exec-plans/completed/ppt-outline-calls-titles-selection-20261022.md)

outline-first（`planningContract.version === 3`）项目在逐页展开之后，要经过合同评估、模型审查和修复循环，才能进入可确认的页面计划。本文记录这一段如何保证有限步内停下、哪些问题由代码直接修正、标题由谁决定。


> **2026-10-26 并入 option D 主线（[整合计划](../exec-plans/active/ppt-integration-option-d-mainline-20261026.md)）**：卡片大纲（方案 D）删除了治理器、编辑覆盖/修复、容量修复、选择修正与 critic 重写循环。本文中的"数据流（展开之后）""覆盖审查复用（L2）"、调用预算 L1–L3、选择修正 S1–S8、标题保留 T1–T3、S6 回退各节描述的是已删除的路径，仅作历史参考。仍然有效：写手页面来源范围（W1）、生成阶段审查提示与调用账本（只记录，不再有预算）、编辑器内处理提示、回复先规范化再校验、关系图跨页拆分、LibreOffice 不可用时照常发布。

## 模块

| 文件 | 职责 |
|---|---|
| `apps/cowork-server/lib/ppt-outline-governor.mjs` | O1 门禁分级、O5 修复预算与振荡检测、L1 调用账本、L3 总调用预算 |
| `apps/cowork-server/lib/ppt-selection-salvage.mjs` | S1–S4：模型选择条目的确定性修正；S6：关系审查拒绝后的确定性修复 |
| `apps/cowork-server/lib/ppt-partition-intent.mjs` | T1–T3：归属变化后标题和意图是否保留、临时标题标记 |
| `apps/cowork-server/lib/ppt-editorial-coverage.mjs` | 完整来源覆盖审查与 L2 增量复用 |
| `apps/cowork-server/lib/ppt-outline-compile.mjs` | 编译入口：先 `salvageSelection`，再编辑归属合同或通用编译 |
| `apps/cowork-server/lib/ppt-api.mjs` `startOutline` | `governor.markAssessment()`、`reviewCall`、`judged()`、`namePages()` |

## 数据流（展开之后）

1. `materializeCapacityPlan` 完成后调用 `governor.markAssessment()`。之前的调用计为 `planning`，之后的计入 L3 预算。
2. `assessCandidate` → `assessOutlineCandidate` → `compileOutlineCandidate`：
   - `salvageSelection(project, raw)`：
     - S1 图示证据偏移按唯一原文 quote 重绑（`summary_graph_evidence_rebound`）；
     - S2 仍无效的图示改为本页完整原文（`summary_graph_restored_complete`，要求允许 `slides` 且已有页面拥有该来源）；
     - S3 `reason` > 240 字截短（`metadata_shortened`）；
     - S4 单语来源的摘要去掉追加的翻译（`summary_translation_removed`）。
   - 归属编译后，`partitionTitle` / `partitionIntent` 决定标题：页面仍拥有全部计划来源、且新增来源来自同一章节时，保留模型标题和意图；否则用章节名作临时标题，并写入 `titleBasis:'source_headings'`、`titleBeforeRepartition`（`headingTitleMarker`）。
3. `judged('summary_faithfulness' | 'coverage')` 通过 `reviewCall` 调用模型：`governor.reviewAllowed()` 为 false 时抛 `review_budget_exhausted`，`judge()` 返回 `advise`，提示码 `outline_review_skipped_advisory`，`resolution:'review_skipped'`。
4. 修复循环：`allowRepair()` 同时检查修复预算（16）和总调用预算（48）。确定性修复优先：语言兜底，然后 S6 `relationGraphFallback`（关系审查拒绝的图示 → 本页完整原文；错误上带 `details.relationAuditRejected`）。
5. 收敛后 `namePages()`：收集 `titleBasis==='source_headings'` 的非封面页，一次 `repairOutlineMetadataBatch`（节点 `outline:page-names:<n>`，原因 `ownership_changed`，附 `previousTitle`）。成功后 `titleBasis:'ownership_named'`，更正 `ownership_title_named`；失败按 `degradeTitleRepair` 降级，保留临时标题。
6. 保存时 `outlineRepairGovernor = governor.summary()`（`version: 2`，含 `calls.{total, assessment, byKind, byFamily}`、`callBudget`、`stopped`）。

## 覆盖审查复用（L2）

`project.editorialCoverageAudits` 中三类键：

- `<hash(完整材料)>`：原有，通过的结论；
- `group:<hash(组材料)>`：`{sufficient:true, visible:[可见正文条目哈希…, 页标题哈希…]}`。当前可见集合包含它时复用；
- `refusal:<hash(完整材料)>`：最终拒绝结论（含精确复核），相同材料直接复用。

组材料 = 完整材料去掉全稿可见正文和页标题。发给模型的材料不变。

## 写手页面来源范围（W1/W2）

- `ppt-planning.mjs` `scopeRetrievalToSources(project, retrieval, permittedIds)`：只保留来源单元全部被允许的分块、`sourceUnitId` 被允许的证据，去掉原始分段。
- `ppt-api.mjs` `writerRetrieval()`：页面合同 `sourceScope:'owned'` 时，permitted = 本页 `sourceUnitIds`/`sourceArtifactRanges`/合同 `sourceArtifacts` ∪ `claimSupportSourceIds` ∪ `closingEvidenceSourceIds`（与 `claimAuditRegistry` 相同）。
- `ppt-prompt-contracts.mjs` `writerPrompt()`：owned 页面总是 `writerCorrectionContext(prompt,{always:true})`，原输入只给 `immutable_input_identity`；页面视图包含 `task`、`intent_is_not_source_authority`、`source_artifacts`；`userPrompt` 与原文只差空白时省略。
- W2：`ppt-outline-first.mjs` 展开提示词、`ppt-editorial-repair.mjs` 摘要忠实性审查：标题/文档标题内容不能作为来源事实。

## 生成阶段：审查提示与调用账本（执行计划 ppt-pipeline-unblocked 阶段 3）

只对 outline-first 项目生效（`outlineFirst(project)`）；旧流程的门禁和修复轮数不变。

- `ppt-quality.mjs`：`JUDGED_REVIEW_CODES = model_missing / model_repeated / model_conflict / model_unsupported / claim_redundant`。`finalQualityReport(..., { judgedAdvisory })` 为 true 时，这些码的 `error` 改为 `warning`，带 `advisory:true`、`requiresReview:true`；报告新增 `reviewAdvisories`（计数）。仍然阻断：`claim_entailment_*`（页面事实与所引原文不符）、`mandatory_content_*`（义务）、确定性 `hardErrors`、`evaluation:'not_evaluated'`。非严格覆盖下 `model_missing` 原本就是 warning，不打标。
- `ppt-api.mjs` `startGeneration` critic 循环：本轮所有目标页的发现都属于 `JUDGED_CRITIC_CATEGORIES`（unsupported / conflicts / missing / repeated）时，`maxRounds = 1`；含确定性或义务类发现时仍为 `maxQualityRepairs`（默认 2）。
- 调用账本：`startGeneration` 包一层 `deps.modelCall`，记 `generationCalls = {version, total, byFamily, budget}`。`byFamily` 用 `generationFamily(nodeKey)`：去掉页 ID、`claim-<hex>`、轮次数字和长哈希，最多 3 段（如 `content`、`content:critic`、`review:deck:findings_confirmation`）。完成时写入 `project.generationCalls`（所有项目都记）。
- 预算：outline-first 项目 `total >= budget` 时不再开新的 critic 轮，`runtime.criticRepair.stoppedReason = 'call_budget'`；写手、整稿审查和发布照常进行，剩余发现按上面的规则成为提示。
- `deterministicGate` 和 `publish-service.mjs` 重新生成报告时同样传 `judgedAdvisory`，编辑后重新发布不会把提示变回错误。
- 页面事实审查的镜像：`normalizeReview` 把 `claimAudit` 的失败镜像进 `repeated` / `unsupported`（`origin:'claim_audit'`，由 `withClaimAuditFindings` 生成）；`confirmNegativeClaimAudits` 复核后用同一函数按新结果重建，被推翻的结论不再残留。`finalQualityReport` 用 `isClaimAuditMirror` 跳过镜像，页面事实失败只从 `claimAudit` 计一次；整稿审查的发现按来源列表（missing / repeated / conflicts / unsupported）判为模型判断，不看审查给的问题码。
- 前端：工作区质量面板 `data-testid="ppt-review-advisories"`（计数 + 前 5 条 `detail`），编辑器导出对话框 `data-testid="ppt-export-review-advisories"`；i18n `ppt.quality.reviewAdvisories`（en / zh / zh-HK，`{count}` 占位）。类型：`PptQualityReport.reviewAdvisories`、`modelIssues`。

### 编辑器内处理提示（执行计划 ppt-editor-review-advisories-20261022）

- `lib/ppt/review-advisories.mjs`：
  - `advisoryId(issue)` = `adv_` + 摘要(code, 排序后的 slideIds, nodeId, detail) 前 20 位。报告每次发布都重建，ID 只由审查器说的内容决定。
  - `advisoryTarget(project, issue, slideId)`：按页解析目标节点，顺序为审查给的 `nodeId` → 正文/建议里点名的节点 ID → `bulletIndexes` 对应的正文列表 → `detail` 引号内原文所在的可见节点 → `nodeId:null`（整页）。`basis` 记录依据。
  - 决定账本 `project.reviewAdvisoryDecisions[id] = {status, at, actor, checkedAt, operationId?}`，最多 200 条。`dismissed` 跨报告有效；`applied` 只在 `checkedAt === quality.checkedAt` 时有效（重新审查后仍报同一条就重新打开）；`undone` 视为未处理。
  - `reviewAdvisoryView(project)` 给 `liveProjectView` 的 `quality`：`modelIssues`（只含提示，带 `id / targets / review`）、`reviewAdvisories`（未处理条数）、`reviewedAdvisories`。之前 live 投影不含 `modelIssues` 与 `reviewAdvisories`，工作区面板和导出对话框在真实应用里拿不到提示。
  - `recordReviewDecision`：忽略/恢复。校验 `baseRevision`（不符 409 带 `currentRevision`），不推进 `revision`（同 `setPageAccepted`），已应用的提示不能直接恢复（409，需撤销那次修改）。
  - `advisoryEditRequest`：由存储的提示组装 AI 编辑请求（`type:'content'`，有目标节点用 object 范围，否则 slide 范围；指令 ≤1000 字，含建议与审查理由），客户端只传 `reviewAdvisoryId / slideId / baseRevision / preview`。
  - `recordAdvisoryOperation(project, operation, meta)`：`commit()` 在写入操作日志前调用。`meta.reviewAdvisoryId`（由 `applyProposal` 从提案带入）→ `applied`；撤销该操作 → `undone`；重做 → 再次 `applied`（`operationId` 换成重做操作的 ID，之后的撤销能对上）。
- 接口（`lib/ppt/api.mjs`，代理白名单 `src/lib/ppt-proxy-path.ts` 已放行）：
  - `POST /ppt/projects/:id/review-advisories/:advisoryId` `{status:'dismissed'|'open', baseRevision}` → `{project}`。
  - `POST /ppt/projects/:id/ai-edit` 带 `reviewAdvisoryId` 时，请求体由 `advisoryEditRequest` 替换；提案文件记 `reviewAdvisoryId`（`reviseProposal` 克隆时保留）。
- 前端：`StructuredPptEditor.tsx` 缩略图栏琥珀色框与 `ppt-thumb-advisory` 标记（悬停列出理由）；页眉 `ppt-slide-advisory-toggle`；画布下方 `ppt-slide-advisories` 面板（选中被标记节点时自动出现并突出对应条目，`data-focused`）；"应用建议"打开内联 AI 面板并直接请求提案，预览后"应用"走 `/proposals/:id/apply`；"忽略"/"恢复"走上面的接口。`PptCanvas.tsx` 新增 `advisories`（nodeId → 理由）：节点琥珀色虚线框、角标，`title` 显示理由；只是编辑器覆盖层，不进入幻灯片或导出。工作区面板只列未处理条目。i18n `ppt.advisory.*`（en / zh / zh-HK）。
- 测试：`src/__tests__/unit/ppt-review-advisories.test.ts`（ID、目标解析、账本规则、live 投影、提案→命令→撤销/重做、接口的版本校验与幂等）；`ppt-proxy-path.test.ts`；e2e `ppt-frontend-controls.spec.ts`「review advisories are flagged…」（标记、悬停理由、选中聚焦、应用建议、忽略与恢复、导出计数）。

## 回复先编译后校验与真实回复语料（阶段 4）

- `lib/ppt-reply-normalize.mjs` `normalizeReply(value, schema)`：只按本阶段自己的 response schema 处理，不改可见正文。三条规则：ID 列表（`items.enum` / `items.const` / `uniqueItems`）去重；包着空白的枚举值去空白；路径以 `reason` 结尾、超过 schema `maxLength` 的规划理由按句/分句边界截短（`shortenAtBoundary`，S3 也用它）。返回 `{value, notes}`。
- 回放时 S8 可能出现在 S1 分支里：偏移需要重绑的回复，重绑时一并去掉重复正文，更正码只记 `summary_graph_evidence_rebound`；语料检查的是结果（没有节点把标签印两遍），不是更正码。
- 接入点：`ppt-api.mjs` `modelCallTransport` 的两条返回路径都经过 `settleReply(p, responseSchema, value, log)`，在任何阶段的校验器之前；有改动时打一行日志 `settled reply: duplicate_ids_removed@missingSourceUnitIds`。测试替身直接替换 `deps.modelCall`，不经过这一层，所以各阶段原有的局部处理（覆盖审查去重 `acceptedCoverageVerdict`、`settleSemanticDependencies`、S1–S8）保留。
- `ppt-editorial-coverage.mjs` 导出 `coverageVerdictSchema(reviewable)` 和 `acceptedCoverageVerdict(answer, reviewable)`，审查与精确复核共用，语料回放也用它们。
- 语料：`test/fixtures/ppt-vector-search-real-replies.json`（向量检索复盘真实运行的原始输入 + 13 条 qwen3.8-max 真实回复：覆盖审查重复 ID ×4、卡片自依赖 ×3、图示正文重复标签 ×4、摘要里数字紧贴汉字（`从9.6万元`）×2；只存解析后的回复和 prompt sha256）。`selftest-ppt-real-reply-corpus.mjs` 把每条回复送进生产编译和校验器，要求不触发修复轮；数值部分：原文和真实摘要里的每个测量值都必须是完整数字（`9.6万元` 曾被读成 `6万`），摘要里的数值还要能在原文测量值里找到同值同单位（即 `visible_numeric_fidelity` 不会误报）。用修复前的 `ppt-evidence.mjs` 跑这份语料会在 `6万` 上失败。新修一个模型失误时把回复加进语料；新的确定性门禁要先过整套语料。
- 不在语料里的：越页事实（写手把别页事实写进本页）是模型行为，由 W1 的提示词范围收窄处理，见 `ppt-writer-page-scope.test.ts`。

## 验收中修复的确定性问题

- `ppt-source-numbers.mjs` `sourceRecords`：`TableBlock` 和 `SummaryTableBlock`（表格被选为摘要后的类型）都按行列取数值和上下文，并同时读 `originalSourceInventory`。之前摘要表格被当散文读，单元格的上下文取自下一行。
- `ppt-section-eyebrow.mjs` `normalizeDeckEyebrows`：整个标签就是页标题的眉题置空（派生的导航节点一并移除）；带章节编号的标签（"1.3 核心张力"）仍有定位作用，保留。只有一页的大纲卡片章节名等于页标题。

## 超大关系图跨页拆分（ppt-pipeline-unblocked 1.6）

计划见 [ppt-relation-graph-split-20261022.md](../exec-plans/completed/ppt-relation-graph-split-20261022.md)。

- 通过图审计的来源关系图（`diagramSource.presentation === 'semantic_graph_rows'`）是必选的 `source-relations` 媒体；退回表格仍被 `inspectFrozenOutlineSources` 拦下（`planned_source_media_layout`）。
- `ppt-relational-diagram.mjs` `relationalComponent(item, rowStart, rowEnd)`：行范围画成部分图。`graphNodeRows(item)` 给出每个节点所属的数据行（紧凑投影的叶子跟随行号最小的父节点）。跨部分的边连到延续卡片（原文标签加 `→`，条目带 `continuation.direction`），部分图带 `relational.part = {rowStart,rowEnd,nodeIds,continuationNodeIds}`。环形图和重叠窗口不拆。
- `relationalCoverage`：部分图按同一规则重建后比对；整图校验不变。对象完整性按各部分覆盖的行合并，所以拆分后仍要求每一行恰好出现一次。
- `ppt-outline-source-fit.mjs` 新增两个阻断问题：`planned_source_graph_split_unneeded`（整图单独放这一页能画成关系图就不许拆，测量走真实 `bindSourceArtifacts`）、`planned_source_graph_split_order`（各部分按行序放相邻页）。容量窗口提示词和媒体布局错误信息都说明了这个选项。
- 渲染、PPTX 导出和导出校验只看 `items` 与 `edges`，部分图不需要改动；`selftest-ppt-relation-graph-split.mjs` 覆盖原生导出。

## 配置

原来的 `PPT_OUTLINE_REPAIR_BUDGET`、`PPT_OUTLINE_CALL_BUDGET`、`PPT_GENERATION_CALL_BUDGET` 随治理器与 critic 重写循环一并删除（2026-10-26），已不再读取。

## 前端

- `PptOutlineCorrections.tsx`：`review_skipped` 进入 `DETAILED`（显示 message）；新更正码归类：`summary_graph_*` → summary，`ownership_title_named` → metadata。
- i18n：`ppt.outlineFix.review_skipped`（en / zh / zh-HK）。
- 展开提示词（`ppt-outline-first.mjs`）：只在本页有双语对时要求两种语言；否则要求按来源语言写，不追加翻译；写明 reason 上限和图示逐字摘录。

## 测试

- `src/__tests__/unit/ppt-selection-salvage.test.ts`、`ppt-outline-titles.test.ts`（真实回复作为 fixture）、`ppt-writer-page-scope.test.ts`（真实越页案例）。
- `selftest-ppt-outline-governor.mjs`（账本、预算、跳过的审查）、`selftest-ppt-editorial-coverage.mjs`（L2）、`selftest-ppt-outline-first-api.mjs`（预算为 1 时进入 `page_plan_ready` 并带"未审查"提示）。
- `selftest-ppt-real-reply-corpus.mjs`（真实回复语料）、`selftest-ppt-reply-settle-transport.mjs`（经真实任务队列返回的回复在校验前已整理）、`src/__tests__/unit/ppt-reply-normalize.test.ts`（规则）。
- `selftest-ppt-judged-advisory.mjs`（报告分级：哪些变提示、哪些仍阻断、旧流程不变）、`selftest-ppt-judged-review-generation.mjs`（HTTP 全流程：审查一直报一条无依据 → 一轮修复后发布并列为提示；预算为 1 → 不开修复轮；旧流程同样审查 → 两轮后阻断）。e2e `ppt-frontend-controls.spec.ts` 覆盖提示的显示与不显示。
- 真实 LLM 前后对照：执行计划第 7 节；驱动脚本在 `outputs/ppt-outline-improve-20261022/`（不入库）。
- `selftest-ppt-relation-graph-split.mjs`（b_0017、b_0061 形状的超大图：节点只归一个部分、每条边可见、延续卡片准确、篡改被拒、两个新门禁、表格退回仍不算完成、原生导出校验）；`selftest-ppt-gamma-http.mjs`（完整 HTTP 流程，b_0017 拆 5 部分、b_0061 拆 2 部分）。
