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

## 第二轮执行记录（2026-10-09）：补齐评审建议中可确定性落地的部分

### 建议落实情况（对照 `ppt-master-skill-review-20261009.md`）

| 建议 | 状态 | 说明 |
|---|---|---|
| 3.1 / 12.2 页面职责与契约 | ✅（首轮） | `explanationChains`、`subjobs` 未做：需要主张级 ID，待真实模型输出后定义 |
| 3.2 / 13 语义关系 | ✅（首轮） | 层级、泳道、循环、overlap 未做：来源中尚无可靠识别依据 |
| 3.3 模板组件档案 / mapped 媒体继承 | ❌ | 即 balance 计划 Phase 2 |
| 3.4 / 14.2 媒体账本字段 | ✅（本轮补字段） | 增加 required、cropPolicy、boundUnitIds；focalPoint、derivedFrom 待 Phase 2 资产档案 |
| 3.5 导出后视觉核验（P0） | ✅（本轮，确定性部分） | 见下文“视觉证据”；LLM/人工视觉评审未接入，`visualVerified` 仍为 false |
| 3.6 / 15 分层修复 | ✅（首轮） | 所属层只作标注与修复记录；critic 重写仍按模型发现路由，未按所属层过滤 |
| 3.7 组件原型与节奏 | ❌ | Phase E / balance Phase 4 |
| 3.8 分阶段上下文（P1） | ✅（本轮，压缩部分） | 见下文“prompt 压缩”；批次 scope audit、预算回执未做 |
| 3.9 原生最小重建回执（P2） | ❌ | 低优先级 |
| 17 P0 无来源数字阻断 | ✅（本轮） | 见下文“来源外数字门禁” |
| 18.2 有下限的整页比例缩放 | ❌ | 需要渲染契约支持，Phase E |
| 17 P1 内容供给 × 复合页联合估算 | ❌ | balance 计划 Phase 3 |
| F 真实模型验证 | ❌ | 需要模型凭证 |

### 本轮实现

**来源外数字门禁**（`lib/ppt-source-numbers.mjs`，进入 `deterministicReview`）

- 页面上的数字必须出现在输入正文、用户要求、封面标题或模板原文中。
- “1,000”等同于“1000”，“0.50”等同于“0.5”，但“3.0”不等同于“3”。
- 编号徽章（01–09）、个位数和页码不计入。
- source_only 下为 error（阻断发布），bounded explanation 下为 warning。
- 所属层为 scope。

**视觉证据**（`lib/ppt/export-verifier-python.mjs`、`ppt-export-integrity.mjs`）

- 在已有“实际 PPTX → PDF → 字形”核验基础上，按 PowerPoint z-order 检查顶层文本是否被**后绘制的不透明图片或填充形状**遮挡：覆盖字形区域 ≥50% 为硬错误，15–50% 记为软发现。透明（alpha）对象不计。
- 每页生成 PNG（默认 48 dpi，可用 `PPT_VISUAL_DPI` 调整），记录 sha256，与 manifestHash 绑定。
- `quality.visualEvidence` 记录页数、遮挡检查次数与软发现数；`visualVerified` 保持 false，等待视觉评审。

**Prompt 压缩**（`ppt-input-scope.mjs`、`ppt-prompt-contracts.mjs`；契约版本 11）

- INPUT_FRAMEWORK 在 prompt 中只放一次正文，段落与普通正文对象改用 `[start,end)` 偏移；表格、代码、公式保留原文。hash 仍按完整材料计算，已有 scope audit 不失效。
- `<source_inventory>` 改为 ID、类型、章节、标记、表格形状与 160 字预览。

| 输入 | 大纲 prompt：改前 | 改后 |
|---|---:|---:|
| 04 Factor Zoo | 348,280 字符 | 198,965 字符（−43%） |
| 09 Factor Testing | 405,700 字符（含模板） | 225,155 字符（无模板） |

逐页写作 prompt 同样包含 INPUT_FRAMEWORK，每次调用约减少 7 万字符。

### 验证

- `selftest-ppt-export-integrity.mjs` 新增两项：实际导出带 4 页 PNG 证据与遮挡检查；在文本框上方插入不透明图片的篡改文件被拒绝（“covered by later object”）。
- `selftest-ppt-four-pillars.mjs` 新增门禁测试：
  - 无来源的 2016、3.0 报 error；
  - 来源中的 800%、编号徽章 01、个位数通过；
  - bounded 模式为 warning；
  - 用户要求中给出的数字允许；
  - 账本字段齐全。
- 34 个 `selftest-ppt*.mjs` 通过；tsc 通过；单元测试 2808 通过。

### 风险

- 来源外数字门禁在真实模型输出上可能误报（例如由来源数值推导出的新数值）。若出现，应改由 writer 引用来源原值，或在 bounded 模式下标注示意，而不是放宽门禁。
- 遮挡检查只看顶层形状；组合内对象与旋转文本暂不判定，结果中记录为未检查。


### 2026-10-09 Factor Zoo live BYOK continuation

User authorized fixes after real capacity failures. Source remains pinned to 08727bea7f3198ba1e4e2f3b57d5073e2c5b86d3 and page estimate remains 51. GitHub private macOS ARM64 run 37990935148 was rejected before runner startup by account payment/spending checks. Local x64 run 17 retained 51 generated pages but failed on invalid critic JSON; its 25 actual model calls, failed report and partial 55-second recording are preserved separately.

Fixes retain original gates: structured quote IDs bind to exact current visible content; critic JSON/capacity correction is bounded; copy and deterministic text reflow validate separately; different required-detail findings are not compared as the same regression; MathML attribute order is canonicalized without changing formula content. Numeric checks normalize source notation, use Chinese bigrams and explicit year-column units, and allow only exactly preserved native process step counts. Compound prose requirements and explicit continuation groups use visible evidence; pure equations still require exact expressions. Bound bilingual lists require both original source lists. Unapproved plain media omission requests restore the original asset. Existing frozen evidence is rechecked on retry, and deterministic content errors reach the writer. Round bounds, source-object checks, locked content, fonts, page count, media, final semantic review and physical export verification remain mandatory.

The read-only browser observer removes duplicated unused import/runtime preview payloads from UI responses and limits SSE snapshots to one per navigation; actual production project state, rendered deck and model workflow are not modified by this observer. Report this transport limitation explicitly. Human visual verification of every final exported page remains outstanding.


Local run19 regenerated the CAPM native source page after measuring the actual header boundary, reached 51 complete pages, then failed when a critic writer selected an evidence ID outside the frozen set. Original gates rejected that response. Real UI PNGs and a completed supplementary recording are preserved; they verify preview availability, not final PowerPoint appearance.

The next explicit rerun includes original table source IDs and half-open row partitions in review context, so the model can audit the entire original table across declared fragments without requiring every fragment to duplicate every row. Intended source language pairs remain identifiable, while additional repetition and genuine omissions remain reviewable. Self-negating findings require a fresh bounded model correction. The paired writer/reflow guard permits unchanged source tables to move and update measured row/column weights; cells, source provenance, font and locked nodes remain exact, with final hard gates retained. Unknown evidence IDs now trigger the existing bounded correction rather than bypassing validation. An explicit quality retry starts a new durable run, retains prior critic attempts in history, and reruns all review/export gates under the original per-run bounds. Failed runs retain ordinary resume semantics unless the retry explicitly requests restartReviewRun.


Local run20 completed a fresh independent review: all 79 obligations satisfied, no model findings. Publication remained blocked by three visible_numeric_fidelity findings on the sourced q-factor construction 2×3×3. The legacy quantity extractor had treated multiplication signs followed by another number as speedup units. The correction excludes only those operators, retains true 4× speedup measurements, and additionally compares entire ordered multiplication chains against original input. Altered 2×4×3, reordered 3×2×3 and truncated chains fail despite their individual numbers appearing in the input. Read-only recheck of the unchanged actual run20 deck found zero deterministic hard errors and 31 source objects; this diagnostic does not publish or approve the stored run. A new explicit module retry still performs fresh semantic review and original physical export gates.

Review guidance now states continuation/table union and source language-pair rules in the core Chinese rubric, rather than relying only on appended English notes. Positive/self-negating problem entries require fresh model correction. OpenAI-compatible/OpenRouter PPT workers request native JSON object output using the existing SDK; wire tests verify response_format and reject malformed/truncated responses. A real deepseek-v4-flash native JSON probe returned a valid object. Local source, template, actual checkpoint and loaded patch hashes remain separately recorded. Final native visual verification remains pending.


### Authorized live continuation 21–22

Local run 21 retained 51 cached source-complete pages and reused the content-bound run 20 review (zero model calls). Numeric multiplication gates passed. Native export was blocked before a candidate file was written because the IR retained an unpositioned migration title alongside the exact native template title. The fix removes only stable-ID, unlocked, unpositioned legacy title aliases with exact native-title text, preserves real or locked nodes and makes the native title authoritative. Repeated IR migration and native-binding fixtures verify no alias recreation; differing, user-created and locked missing mappings still fail the original export gate. Explicit quality retry now invalidates review approval and retains its prior review and critic history, forcing an independent review for the next durable run. Run 22 starts from the unchanged actual quality-blocked run 21 checkpoint, with hashes checked for input, template and all 19 media blobs. Its source, semantic, capacity and native export gates remain enabled. Final user-deck visual verification remains pending until successful export.


### Live run 22 audit-count failure and next correction

Run 22 made 8 accepted real DeepSeek JSON calls and retained 51 complete source pages. After a bounded writer round, the critic repeatedly returned only 54 audit checks instead of all 79; two original contract corrections exhausted their limit and the workflow stopped before native export. All attempts remain recorded. Review prompts now end with the authoritative ordered obligation ID/text/basis checklist and explicit expected count; count-error feedback names missing, unknown and duplicated IDs and expected/received registry hashes. It neither supplies verdicts nor completes missing checks. Evidence diagnostics remain for actual evidence errors, instead of flooding a count-error correction with unrelated full-instance text. The original every-ID-once validation, factual scope, evidence binding, three-call correction bound, critic bounds and native export gates are unchanged. Tests cover a foreign duplicated audit, exact missing-ID feedback, a fresh complete model response and repeated incomplete responses still stopping after three calls. UI-only observer timeout argument order is corrected and partial failed-run recordings are reported as partial.


### Native CJK frame and punctuation verification (local retry 24)

Run 23 made five accepted real deepseek-v4-flash calls; its final critic satisfied every one of 79 source obligations with empty finding arrays. Publication still correctly stopped on native glyph containment. Original title frames were sized for English: 51 pt CJK ink ended 3.1 pt beyond the cover frame, and two 34.5 pt wrapped titles occupied 85.18 pt from the frame origin against an 83.50 pt frame. Native unlocked CJK title frames now reserve first-line glyph extent plus 1.20 em subsequent line advance, bounded before the next overlapping element with one-point clearance; font, title text, origin and width are preserved. A 0.08 em right inset keeps the final CJK glyph ink inside its advance-width wrap boundary. Too-crowded frames remain hard failures; locked and English titles are untouched. Six body/table punctuation instances were present on the rendered page but hung beyond their frames. Serialized text contracts now explicitly disable hanging punctuation, including source-table paragraphs, and the native export verifier checks that setting. No glyph-bound, content, equation, image, source, occlusion, review or capacity tolerance is relaxed. Regression tests cover title idempotence, multi-line space, protected collisions and real-file corruption of the hanging-punctuation property. The authentic failed run-23 checkpoint is resumed through the production retry API for a fresh critic run; the 51-page module decision and all original source assets remain unchanged. GitHub ARM64 Actions remain blocked before runner allocation by account billing/spending checks; local x64 execution is separately identified.


### Final bound-source writer schema (local retry 25)

Run 24 retained 51 complete content nodes and made 13 accepted real model calls. The first critic returned zero obligation checks and was rejected; correction returned all 79 satisfied plus 15 missing explanations. Original bounded writer repair stopped on the FF5 present-value page: two paragraphs repeated automatically displayed RMW/CMA definitions and the original dividend-discount excerpt, exceeding its measured single-paragraph commentary budget. The intact frozen sources themselves fit. The original capacity gate still stopped generation; no native final artifact was published. Source-owned native semantic repairs now end with the exact current frozen artifact/evidence selection and a one-paragraph commentary schema; the target is 85% of the measured commentary capacity, with no changes to source text, font, ranges or capacity validation. Contract-correction context selects the last/current schema instead of an earlier obsolete example. The conflicting generic suggestion to merge into one or two paragraphs is replaced with the actual measured one-paragraph instruction. Only genuinely absent relationships may be added; optional duplicate explanation may be removed, never locked source or necessary conditions. Prompt regression verifies the exact row/evidence selection survives and the current schema supersedes the obsolete one. All original bounded retry and source/capacity gates remain. Retry 25 restores the genuine failed run-24 checkpoint through production API and requests a fresh review.
