# PPT 卡片稿：方案 D 混合版式与 Gamma 式大纲

> 产品思考见 [docs/insights/ppt-card-outline-option-d.md](../insights/ppt-card-outline-option-d.md)
> 执行计划：[docs/exec-plans/completed/ppt-option-d-gamma-simplification-20261023.md](../exec-plans/completed/ppt-option-d-gamma-simplification-20261023.md)
> 分析依据：`ppt-gamma-results-20261013/PPT_Gamma_SaltAir_vs_Cards_Failures_and_Outline_Simplification_20261023.md`（F1–F13、S1–S11、§8 方案 D）

## 一句话

所有新演示文稿都是**卡片稿**：代码读原文、按长度定主题，**一次调用写完整份卡片大纲、一次小调用收尾**（章节标题、结尾要点、要点小标题）；生成时卡片页**不调写手**，原生版式原样放得下就用原生版式，否则用模板主题页 + 测量过的组件（方案 D）。模型整稿审查改为编辑器里按需的“AI 检查”。

## 数据流

```
创建（POST /ppt/projects，任何输入；可编辑 PPTX 导入除外）
  └─ planningContract v3（flow: cards），readOnlyInput 默认 true
startOutline（lib/ppt-api.mjs，约 190 行）
  1. 代码读原文：codeInputUnderstanding（lib/ppt-card-outline.mjs）
     ├─ 有原文：叶子小节、字数、对象、双语比例、长度预设、警告
     └─ 无原文（短提示词）：简述模式 brief:true，预设 8/14/20 页
  2. readOnlyInput → status input_ready（前端显示设置表单）
  3. 规划命令 outline（设置表单提交）→ phase semantic_planning
  4. planCardDeck / planBriefDeck：主题与每主题卡数、章节（代码，零调用）
  5. phase expanding：
     ├─ 有原文：deckCardsTasks（≤30k 字符一次；更长按 ≤20k 分块并行）
     │          失败的块 → 该块主题逐个调用（callWithContract，纠正一次后清洗）
     ├─ 简述：briefDeckTask 一次调用（纠正一次后清洗）
     ├─ deckFinishTask：章节标题、结尾要点、要点小标题（D1）；封面标题放不下时另要短标题 coverTitle；无效项丢弃
     └─ assembleCardDeck：封面、章节卡、卡片、结尾卡；assignSourceImages 配图
  6. assessOutlineCandidate 编译（S7：只列提示，不阻断）
  7. status outline_ready；planningContract.cardOutline = {raw, advisories, summary}
确认（PATCH /outline，原样）→ 生成（startGeneration）
  ├─ 封面（D10）：deterministicCoverDraft，不调写手
  ├─ 卡片页（原生模板）：cardPageDraft → 原生版式或主题页（lib/ppt-card-pages.mjs）
  ├─ 带对象的卡片页：cardObjectPageDraft
  ├─ 章节卡/结尾卡（内置模板）：代码写出，不调写手
  ├─ 其他：写手；卡片稿写手失败 → 代码放置（F2）
  └─ 模型审查：卡片稿跳过（D3），批判重写跳过
发布：卡片稿不调审查；只有完整性规则阻断（F8，lib/ppt-gate-tiers.mjs）
AI 检查：POST /ppt/projects/:id/ai-check → 模型审查，结果只作提示
```

## 模块

| 文件 | 职责 |
|---|---|
| `lib/ppt-card-outline.mjs` | 大纲引擎：结构分析、长度预设、主题规划、整稿写卡任务、收尾调用、组装、取舍说明、简述模式、用户大纲转卡片、配图 |
| `lib/ppt-card-language.mjs` | 语言选择（双语/English/中文）、默认值、另一语言写入演讲者备注（导出清单） |
| `lib/ppt-card-pages.mjs` | 方案 D：原生版式判定、主题页组件（步骤、网格、对比、大数字、论断、章节、要点）、评分与绑定 |
| `lib/ppt-outline-cards.mjs` | 单卡合同（引用、数字/公式全文核对、预算）、按主题任务、卡片编辑 |
| `lib/ppt-gate-tiers.mjs` | 卡片稿门禁分级：只有完整性规则阻断 |
| `lib/ppt/publish-service.mjs` | 发布（卡片稿不审查）与 `aiCheckProject` |
| `src/components/ppt/create/PptCardOutline.tsx` | 设置表单 + 卡片大纲 + 取舍说明 + 按指令重写 |

删除：`ppt-outline-rebalance`、`ppt-outline-balance`、`ppt-outline-range-repair`、`ppt-planning-fallback`、`ppt-source-vision`、`PptInputReview.tsx`。

## API

| 路由 | 说明 |
|---|---|
| `POST /ppt/projects` | 只接受 v2 生成策略（v1 → 400）；`readOnlyInput:false` 时同一次写完标准长度大纲；短提示词自动 `knowledge: source_plus_explanation` |
| `POST /ppt/updates` | 更新版同样是卡片稿（无 keep/rewrite 对应，`diff: null`） |
| `POST /ppt/projects/:id/planning` | `command: outline`（`length: {preset} \| {exact: 6–40}`、`contentMode`、`language`、`notesOther`、`instruction`、`template`）或 `edit`；其他命令 400 |
| `POST /ppt/projects/:id/outline` | 410（已退役） |
| `POST /ppt/projects/:id/ai-check` | 按需模型审查（仅卡片稿，completed/quality_blocked） |
| `POST /ppt/projects/:id/pause` | 只能暂停生成；大纲阶段 409 |
| `POST /ppt/projects/:id/table-representation` | `{slideId,sourceUnitId,representation:'table'\|'diagram',baseRevision}`：把画成卡片网格的来源表格切回原表（或反之），重新排版该页，返回 live 视图（技术债 T5） |

项目视图新增：`planningContract.settings`（长度、预设、语言、默认语言、是否双语原文、备注、简述）、`structure`、`summary`、`writing.pages`；`runtimeWarnings`；`quality.modelReview.evaluation`。

## 关键设计决策（Fable 决定，详见执行计划决策日志）

- 长度：N = 有正文的叶子小节；精简 0.6N、标准 0.8N、完整 N+大对象小节；另加封面和结尾卡；标准/完整 ≥8 张时 2 张章节卡；6–40 页。
- 卡片合同：要点必须引用；数字与公式按全文核对；超预算 130% 退回一次；其余只提示。
- 简述模式：数字只能来自简述或为 1–12 的小整数。
- 门禁：卡片稿只阻断完整性（溢出/重叠、字号、图片/表格数据损坏、导出失败、原文没有的数字、锁定标题、模板资产、计划对象、卡片要点缺失）。
- 暂停只在生成阶段；大纲写完后按指令重写。
- 重复标题只作大纲提示（同一主题内退回一次）；确认与生成只拦非提示级的标题问题。
- 封面标题：完整 H1 放不进测量过的封面标题框时，收尾调用返回由原标题词按序组成的短标题（代码校验：词序、放得下、不是标签），完整标题印在下方（封面正文框）；不合格则提示作者改封面标题。
- 数字连同单位核对（“3,700 天”须在原文中成对出现），不符的要点退回一次后删除并记提示。
- 要点内的列表序号（“audit; 2. IC; 3. …”）退回一次，仍有则代码去掉序号；数字用发布门禁同一套 `numericRecords` 核对，原文的列表与标题编号不算数字。
- 带对象的卡片页按测量排版（`fitObjectPage`/`objectContinuation`，`lib/ppt-card-pages.mjs`）：放得下的要点合为一段说明，其余在生成时续页；对象本身过高则一对象一页、表格按行、代码按整行拆分（大纲阶段先拆，作者可见）；单个公式/图片比任何页都高时确认大纲被拒。续页只保持已完成页面的版式（`movedFinishedFrame`），每次放弃都记录原因（`runtime.continuationDeclines`）。
- 原文数量不一致（`source_arithmetic_conflict`）只是提示，不阻止生成；卡片写出“数量+乘式”时 `source_arithmetic_shown` 阻止发布，作者在卡片下修改要点或保留原文（`planningContract.sourceNotes`）。内容丢失类警告仍须先处理。
- 大纲阶段的数字检查直接调用发布门禁的规则：`textNumberFailures`（`lib/ppt-source-numbers.mjs`，数值/单位/归属，与 `inspectSourceNumbers` 共用 `recordFailure`）与 `unsupportedMeasurements`（`lib/ppt-evidence.mjs`，引用单元及其 chunk、段落中的数值+单位），入口 `cardNumberProblems`（`lib/ppt-outline-cards.mjs`），按要点显示的样子（公式取纯文本、双语分行）核对。
- 公式：`undelimitedMath`/`plainMath`（`lib/ppt-rich-text.mjs`）与门禁 `math_delimiter_missing` 同一判定；`withSourceMath` 宽松匹配原文公式（忽略 `\text{}`、间距命令与空格，候选为引用单元、其语言对、本主题单元）并换回原文 `$...$`；仍在定界符外则退回一次，再不行以 Unicode 纯文本显示（`card_formula_plain`），从不删要点。
- 原生版式（`nativeCardSlots`/`nativeReadsAsCard`，`lib/ppt-card-pages.mjs`）：承载要点的槽位用途一致、字号差 ≤15%、按阅读顺序，且版式没有要移除的模板图表；结尾卡永远是主题论断页。省略的步骤组连同其静态编号一起移除（`leftOutDecorations`）。
- 结尾卡（`acceptTakeaway`/`takeawayCorrectionTask`，`lib/ppt-card-outline.mjs`）：重复某条要点（词语重合 ≥0.75）、标题是卡片标题或只是“Takeaway/小结”、写出原文没有的公式、无引用、超长或数字不在原文时，单独纠正一次，仍不合格则不放；页眉标签按语言为“Takeaway / 小结 / 小結”，双语“Takeaway | 小结”。
- 模板图标：卡片稿对象页与主题页从不保留或挂靠模板卡片图标（`mediaPreservingFit(...,{icons})` 默认按 `cardsFlow`，`replaceTemplateSourceRegion` 的 `retireIcons`，底色块随图标撤掉），品牌图片可保留为侧栏（`artworkPreservingFit`）；`inspectCardPageMedia` 报 `orphan_template_icon`（阻断）。
- 主题页排版（`fitThemePage`）：填充不足 65% 时放大字号、内容块垂直居中（`fitComponents(...,{center:true})`）；章节页 24/20 磅、双语两行；要点页的小标题加粗为第一行。
- 页眉：卡片稿页眉标签取大纲章节（`normalizeDeckEyebrows` 的 cards 分支）；第一章前为“Introduction / 导言”。
- 页眉与标题译文：卡片稿 `bindTitleHierarchy` 不占用页眉槽位，译文放在标题下方的预留带（`TITLE_BAND_PT`，`contentCanvas` 同步下移内容区），放不下时才放在页眉右侧；`fitSectionLabelCarrier` 把标签底色块加宽到标签实测宽度；`inspectCardPageLabels` 报 `section_label_missing`（阻断，接受“A · B”双语标签）。
- 双语标签：`bilingualSection`（`lib/ppt-section-eyebrow.mjs`）取章节页的 `titleSecondary`，导言/小结用固定对照；不超过 28 字时显示“A · B”，否则只显示主语言。
- 表格字号与行高：`planTableFonts`/`tableFont`（`lib/ppt-card-pages.mjs`）在某行 14 磅放不下时整表试 13/12 磅，记入 `project.tableTypography`，`measureComponent` 与 `composeSourcePage` 共用；卡片稿表格节点 `content.rowExport='min'`，导出每行最小行高 `pt*1.18+6`，由渲染器按文字撑开（`ppt-render.mjs` 与原生模板的 `ppt/import-pptx.mjs` 两个写入器都实现，设置行高后恢复外框高度，导出校验同步）。表格字号缺失时由 `fitObjectPage`/`objectContinuation`/`objectPageScore` 按同一规则推导（`pageTableFonts`）；标题译文带由 `translatedTitle` 判断（`titlePair`、`titleSecondary` 或未拆分的双语标题），大纲、确认、生成三个阶段测量一致。双语单元格由 `pairedCell` 在英文→中文边界换行。
- 原生页字号：`cardSlotFont`（`lib/ppt-outline-cards.mjs`）把要点槽位定为 12–14 磅、标签 16 磅，记在幻灯片 `templateSlotFonts`，由 `ppt-template-fidelity.mjs` 应用。
- 标签：`labelProblem` 拒绝从要点内摘出的短语；`acceptDeckFinish` 要求一张卡的标签全有或全无（`labels_partial_dropped`）；`labelledPoint` 统一为标题式大小写。
- 续页标记：`continuationTitle`/`markContinuation`（`lib/ppt-outline-cards.mjs`）按语言分半标记；门禁 `continuation_marker_language`（`inspectCardPageLabels`）。
- 对象页续页：`fitObjectPage` 不留单条要点续页（说明文字 13/12 磅，`ladderFontPt` 由 `measureComponent` 按本身字号测量与设置，随 `sourceCommentary` 传到绑定），否则至少移走 2 条；`wideTable`/`narrowFrame` 让宽表格只排全宽版式；`tableFont` 取所需页数最少的整表字号。
- 卡片完整性：`cardIntegrity`（`lib/ppt-card-outline.mjs`，`assembleCardDeck` 内）合并同主题内的单要点无对象卡片、按来源小节标题改写重复标题（`card_merged`/`card_retitled`）；章节页条目来自本章最终卡片标题。
- 公式：正体单词写 `m:nor`（`lib/ppt-math.mjs`）；`braceLegend` 把 `\underbrace`/`\overbrace` 标注移到公式下方 12 磅图例行（`sourceComponentParts` 生成，导出校验拒绝 ⏟/⏞）；卡片稿公式框取槽位全宽（`fitSourceMathFrames`）。
- 标题语言：卡片稿 `pageTopicLanguage` 一律取稿件主语言。
- 来源编号：`stripSourceIds` 去掉编号及其留下的空括号（结尾卡、要点清理）。
- 标题槽：`unfitCardTitles`/`titleShortenTask`/`acceptShortTitles`/`fallbackCardTitle`（`lib/ppt-card-pages.mjs`）在大纲组装后按每页标题槽检查（`cardTitleFits` 只量主语言半句，与确认阶段的 `inspectNativeOutlineTitles` 一致），模型批量缩短一次，否则主题标题或按词截短，重新排版直至稳定。
- 来源对象归属：`strayCardObjects`（`lib/ppt-outline-cards.mjs`）——对象只跟随其要点来自同一小节的卡片；`cardTopicProblems` 报 `object_section` 退回一次，`sanitizeCardTopic` 把它移到本主题该小节的卡片，否则单独成卡（标题为小节标题，`card_object_moved`）。
- 对象页排版：`roomierObjectPage`（`lib/ppt-source-artifacts.mjs`）放大说明文字并垂直居中；表格续页中放不下本页的单行可单独成页（`objectContinuation`）。
- 横幅与侧栏：`contentCanvas` 在卡片稿不因横幅截断到 65% 以下；`regionArtwork` 不把宽而矮的图片当背景；`scaledArtworkFit` 在卡片稿要求侧栏 ≥2×1.5 英寸。
- 结尾卡标题：`claimTitle`（带动词/判断词），否则纠正一次后用“Key Takeaway / 核心要点”。

### 2026-10-24/25 增补（[执行计划](../exec-plans/completed/ppt-option-d-techdebt-20261024.md)）

- 建站工具标识：`BUILDER_MARK_SCRIPT`（`lib/ppt-template-security.mjs`）在导出时去掉母版/版式/页面上的“Made with GAMMA”等标识及其超链接关系；导出校验残留即阻断（`builder_mark_present`）。
- 页码：`lib/ppt-page-numbers.mjs` 的 `syncPageNumbers` 在 `prepareNativeExportFrames` 中为除封面外每页加锁定的 10 磅页码节点（右下，右边距 0.5、底边距 0.3 英寸），有模板页码槽时复用；卡片页内容区底部保留 0.66 英寸；缺失阻断（`page_number_missing`）。
- 标题语言：`language.title` 默认 `'primary'`（`titleLanguageMode`，`lib/ppt-generation-policy.mjs`），`bindTitleHierarchy` 不画翻译副标题；`titleBandReserved` 只在 `'both'` 时为翻译保留标题带；章节标签去掉源文小节编号。
- 模板媒体：`cardPageScore`/`objectPageScore` 含媒体项（`mediaCost`、`pageVisuals`，`lib/ppt-card-pages.mjs`），`balanceTemplateMedia` 经 `setCardPageVisuals` 计数并接受未溢出的卡片页候选；`reservedArtworkFit`（`lib/ppt-media-preserving-layout.mjs`）原位保留照片；`badgePrototypes`/`bindThemeCardPage` 在网格、步骤、数字卡上方放模板“圆形+图标”徽章（`badgeInsetPt` 由 `diagramCardPlan`/`processCardPlan` 预留，`templateComponentBinding.badge`）；`statementBanner` 让单要点陈述进入模板引言横幅。
- 公式图例：行内公式的 `\underbrace` 标注经 `richBraceLegend` 收集为要点下方一行 12 磅图例（`formula_legend`）；带图例的卡片页不用原生槽位。
- 版本更新：`PptM3` 第 2 步即 `PptCardOutline`（设置、卡片、来源提示、生成），旧页数与旧大纲编辑删除。
- 模板预览：`PptM3` 预览弹窗的 `PreviewThumbs` 缩略图条（懒加载、骨架、单页重试、`role=tab`/`aria-current`、←/→ 翻页、手机横排）。
- 标题容量：`nativeTitleFitsFrame`（`lib/ppt-template-fidelity.mjs`）先按 `normalizeTypography` 规范化（“/”“+”“→”两侧加空格、中英文之间加空格）再测量，与渲染一致；大纲标题环节最后用 `repeatedTitlePages` 给相邻同名页加续页标记。
- 表格形式切换（T5）：`POST /ppt/projects/:id/table-representation` 需同时列在 Next 代理白名单（`src/lib/ppt-proxy-path.ts`）和后端 `PPT_RE`（`lib/ppt-api.mjs`）里；新增项目动作时两处都要加。按钮只在生成中、导入 PPTX 或请求中禁用，模板稿可用。
- 旁路文件的媒体：命令检查点（`pending-command.json`）、操作日志、修订快照、运行检查点和编辑提案经 `atomicJson`/`appendJsonLine` 的 `mediaOwner` 参数写成媒体引用（`stringifyWithMediaRefs`），读取时用同一参数还原；新增的项目级旁路文件也要传 uid。
- 卡片稿续页标记：`planTitleHierarchy`、`distinctPageTitles`、`normalizeOutline` 和写页的 `materializeCopy` 都会去掉标题末尾的续页标记（针对模型写的标记）；卡片稿在这四处经共用的 `keepCardContinuation`（`lib/ppt-topic-language.mjs`）放回代码加的 “(cont.)”/“（续）”。新增标题规范化步骤时同样要调用它。
- 分章页目录：只显示主语言标题时，目录项取 `primaryHalf`。
- 卡片稿 AI 编辑规则：除非指令要求补充或展开，只用原文已有事实、不比原文长（容量含 `charactersNow`、按质量门同一行高给 `maxLines`）。
- 模型服务失败：结构化 API 把 `ppt_transport`/`timeout`/`network` 等模型调用失败回 502 并写明上游状态与耗时，不再是 500。
- 卡片稿 AI 编辑：`cardEditPolicy` 用编辑专用语言规则（保留换行）；`objectWritingCapacity` 对卡片文本框给出实测容量；质量门拒绝时 422 写明“需要 N 行，文本框容 M 行”，不自动重试。
- 导出校验的悬挂标点：`verify_hanging_marks` 接受行尾中文收尾标点在右边框外一个字宽内（每行至多一个）。
- 表格分行：`tableFont` 在 `project.tableTypography[id].frameKey` 记录需要页数最少的模板页（来源页:变体）；`objectContinuation` 在该页上先求最少页数再均分行；`objectPageScore` 的高页成本以该页高度为准。
- 记录表行页（`recordRowPages`）：纯数字的首列（行号）不作为要点；标题计数写成 “(n / N)”。
- 生成阶段续页（`tryGenerationContinuation`）：要点页先经 `moveCardPageFrame` 试换到能整页容纳且更大的内容模板页（只改这一页的模板，`movedFinishedFrame` 校验已完成页不动，经 `commitContinuation` 提交并计入续页次数）；都不行才 `splitCardPage`，第一页至少保留一半字数、至少两条要点。
- 模板重排的缓存：`buildFidelity(..., memo)` 按（页序、模板页、使用序号）复用单页构建，`fidelityMemo()` 每次重排（以及 `moveCardPageFrame`、`repairNativePageAssignment`）新建一个；单页构建只读大纲与来源图片，重排期间不变。改动单页构建的输入时要保证这一点仍成立。
- 版式复用上限（用户 2026-10-25）：`nativeCardSlots` 包住原来的判定（`uncappedNativeSlots`），按阅读顺序统计此前每个模板页（`slides[j].sourceIndex`，不分变体）的原生卡片页数，达到 `cardLayoutCap(N)=max(2,⌊N/5⌋)` 的页面返回 null、改排主题页。统计按 fidelity 对象缓存，前面页面的判定变了会重新计算。`cardPageScore` 与 `cardPageDraft` 都经过它，评分与成稿一致。主题页、对象页（包括保留角落照片或图标徽章的）不计入（Fable）。`setCardLayoutCap(value)` 只供 selftest 与离线比较使用。
- 相邻照片：`mediaCost` 对前一页与已绑定（`deck.slides[i+1].id` 与大纲一致）的后一页的相同大图都计 `SAME_PHOTO_COST`，生成中插入的续页因此避开后面已完成页面的照片（mlq-r42 第 8、9 页）。未绑定的后一页不计，它排到时会自己看前一页。隔一页（`NEAR_PHOTO_COST`）和全稿复用计数仍只向前。
- 续页标记（10-27 起显示为 “ · k/n”，见下）：卡片稿的 “(cont.)”/“（续）” 由代码设置，作为标题流程内部的标记；旧流程的 `normalizePaginationTitles` 对卡片稿直接返回（它会把单个续页当成孤立后缀删掉，fz/mlq-r42）。最终审阅 `inspectCardContinuations`（`ppt-quality.mjs` 调用）对 “与前一页同标题却没有标记” 的页面报错（`continuation_marker_missing`）；“(n/N)” 行页与标记放不下标题框的页面除外。
- 来源小节标题作卡片标题：`sourceHeadingTitle`（标题去重、标题放不下时的缩短都用它）按 T18 规则返回 Title Case，与大纲编译一致（mlq-r43 第 10 页 “Raw forward return”）。
- 表格/卡片切换（T5）：`POST /ppt/projects/:id/table-representation` 内部执行命令 `slide.setTableRepresentation`（`lib/ppt/table-representation.mjs` 负责重新绑定本页来源，保留本页解释与证据，不调用写手）。逆命令 `slide.restoreRepresentation` 是整页快照，只供撤销/重做，公共命令接口拒绝。命令提交会递增本页 `editing.epochs`，迟到的写手结果按 epoch 被忽略；切换结果在来源对象上记 `tableRepresentation`、`representationVersion: 1`、`representationBasis: "user"`。
- 卡片稿 AI 编辑：`cardEditPolicy(project, action)`，扩写/具体化/翻译动作不加 “不比原文长” 限制；候选只因超出文本框被拒时（`FIT_CODES`）带实测行数重试一次（模型阶段 `ai:<id>:fit`），否则返回 422。
- 记录表行页计数保持 “(n/N)”：`planTitleHierarchy` 会把 “ / ” 当作中英文分隔。
- PDF 中的公式（2026-10-26，用户的 `01_research_contract.pdf` 第 3 页因正文里一个 “²” 被拦）：`ppt-source.mjs` 的 `pdf_math_evidence(page, text, tables)` 只按提取方式的证据要求确认：丢失的字形（`(cid:N)`、U+FFFD）、数学字体（CMMI/CMSY/CMEX、Latin Modern Math、STIX Math、Cambria Math、Symbol、MT Extra 等）、含数学符号或希腊字母的行上偏离基线的小字号上下标（排除脚注标记的形状），以及表格外上下都有文字的短横线（分数线）。任一项成立是必须确认的警告 `source_pdf_math_requires_confirmation`（带 `evidence.kind`）；只有正文字体里的 Unicode 数学字符时按原文读取，记一条不拦生成的提示 `source_pdf_math_text`。`selftest-ppt-pdf-math-evidence.mjs` 用 ReportLab 生成两类夹具。
- 封面标题的语言（2026-10-26，同一个 PDF：唯一的一级标题只有中文 “研究目标与完整闭环”，主语言为英文，生成被 “Page 1 generated topic must use English” 拦下）：代码从来源取封面标题时在封面页记 `coverSourceTitle`（作者自定标题与版本更新不记；`normalizeOutline` 只在第 1 页保留）。来源标题与该页语言不符时，收尾调用（`deckFinishTask`）多要一项 `coverTitle`：同一标题的译文，只译原词，不加数字与内容，放得进封面；`acceptDeckFinish` 检查语言、内部 ID、数字和是否放得下，通过则封面换成译文，原标题只留在数据里（不印在页面上）。收尾调用失败或译文被拒时，封面保留来源原标题，`inspectOutlineTopicLanguages` 对第 1 页给出提示 `cover_title_source_language`（severity warning，不拦确认与生成）；用户改过的封面标题、其他页面照常严格检查。

### 2026-10-26 整合第 4 步（report 4a）

- 门禁分级：`lib/ppt-gate-tiers.mjs` 的 `BLOCKING_CODES` 增加 `media_required_missing`、`math_export_unsupported`；`text_contrast_insufficient`（`lib/ppt-text-contrast.mjs`，文字与其背后最上层填充形状或图片面板的对比度低于 2:1）在 `pageMode` 为 theme/objects 时阻断，native/cover 时是提示。模型审查只给提示；`review-findings-confirmation` 确认过的发现带 `confirmed: true`，`tierCardDeckModelIssues` 把它们和 `claim_entailment_contradicted` 排在最前。
- 事实检查：`cardFactIssues`（`lib/ppt-content-qa.mjs`）检查卡片要点里来源没有说过的数量（`card_quantity_unstated`）和无法排版的公式（`card_math_untypeset`），页面来源取自页面与要点的 refs/chunkRefs，跳过分隔页的导航要点。大纲写完时先对每个这样的要点做一次定向改写（模型阶段 `outline:card-fact:<revision>:<page>:<point>`，每份最多 8 个，`acceptCardFactRepair` 只接受清除了问题且其他数量与公式不变的改写，记为 `card_fact_repaired`）；剩下的列在大纲里，`PATCH /outline` 与 `POST /generate` 返回 409 `card_facts_unstated`，作者改完即可。
- 大纲规则：`planCardDeck` 去掉只含被策略排除内容的小节（`deckPlan.excludedSections`，提示 `card_topic_excluded`）；以冒号结尾的引导要点退回一次，之后并入下一条或去掉冒号；合并了来源列表两项的要点退回一次（`list_join`）；两个提示词都写明数量要保留限定词。
- 要点小标题：编辑器每条要点上方有小标题输入框（`ppt-card-heading`），提交 `labels`；`applyCardEdits` 用它替换要点的 `label`。
- 模板图片：配置了视觉读取路由时，卡片规划前读一次模板图片（按哈希缓存，每次最多 4 张），有文字的退役，无文字无人物的前景图作为装饰保留。

- 没有自己标题的来源（工作簿和 CSV 的工作表只是小节）：封面按标题属性（提取器报告的 `documentTitle`）、文件名（`fileTitle`）、第一个非通用工作表名的顺序取；全是通用名（`GENERIC_TITLE`：Sheet1、Book1、工作表1 等）时，收尾调用写封面标题（`genericCover`，检查同译文封面）。
- 一个来源单元只属于一个主题：标题少于四个、用段落代替小节时，引言不再重复包含这些段落。只由分隔字符组成的块（如 `|----|----|`）不是内容。

- 真实演示文稿作模板（第 4b 步）：导入时 `externalPptx.inherited` 列出母版/版式的文字与图片，每页记录 `nativeLayout`；`templateDesignView` 生成 `inheritedActions`（文字 `clear_text`、图片 `remove`），经 `templateFidelity.inheritedActions` 在导出时执行。带链接的图片与读出旧文字的图片退役。成稿检查 `inspectTemplateLeak`（`lib/ppt-template-leak.mjs`）。固定对象选择器列出继承对象并标注母版/版式与链接地址。
- PDF 表格：没有竖线、只有横线的表格由 `rule_tables` 读出（行来自横线和表头色带，列来自所有行都没有文字的空隙）；横线和扁平通栏色带不再让一页成为“矢量图”；矢量图页面截图的角色是 `diagram`，不进模板照片框。

- 来源对象补回：`restoreSourceObjects`（`assembleCardDeck` 内）把没有卡片显示的必需来源对象放回卡片（见执行计划）；放不下的记在 `cardOutline.raw.unplacedObjects`，`unplacedSourceObjects` 让确认和生成返回 409 `source_object_unplaced`。
- 母版/版式页码字段（`a:fld type="slidenum"`）不算旧内容，导出时保留；手打的 “‹#›” 和日期字段清除。

- 模板标题框（GPH，10-26）：`buildFidelity` 把我们填写的文字框夹到页面内（`node.frameClamped`，绑定后页面记 `slide.frameClamped`）；`contentCanvas` 对所有模板页让出标题/章节；`headerFrameReason`（`ppt-template-roles.mjs`）与 `themeFrameEligibility` 决定章节页不作内容卡片的主题框架（`HEADER_FRAME_COST`）；`derivedSectionLabelFrame`（`ppt-density-capacity.mjs`）给没有章节槽位的页找标签位置（标题上方或下方）；封面 `deterministicCoverDraft` 的章节槽位不重复标题，`coverTitleSize` 按字号阶梯避开框内装饰。

- 项目列表（10-26）：`store.registerListProjection` 登记的小摘要（`task-summary-v1`、`library-quota-record-v1`）持久化在 `<id>.summary.json`，列表不读项目文件；`GET /ppt/health` 供就绪探测，只检查存储目录可读写。

- 模板嵌入字体（10-26）：MicroType Express 压缩的字体（EOT 标志 0x4）不解码，导入时列入 `externalPptx.fontSubstitutions`（`ppt-fonts.mjs` 的 `EMBEDDED_FONT_SCRIPT`，按实测宽度选替代字体并写入 fontconfig 别名），质量检查给出 `template_font_compressed` 警告；导出原样保留字体部件。

- 续页编号（10-27，Fable）：拆开的卡片每一页（含第 1 页）标题为 “<标题> · k/n”，取代 “(cont.)”/“（续）”，不加 “续” 眉标。标题流程仍先打旧标记，大纲标题定稿后 `numberCardParts`（`lib/ppt-card-pages.mjs`，`ppt-api.mjs` 大纲阶段与生成阶段续页两处调用）把一段连续的同卡片页改成计数：各页共用一个标题主体（只缩短一次）——先取能让每一页带计数都放下的最长主体；带计数放不下但不带能放下时保留完整标题、不编号（标签或备注说明续页，`continuation_marker_omitted`）；都放不下时把主体按词截短到能带计数。不在一段里的残留计数会去掉。生成阶段续页会重排整段编号；已完成页只改标题里的计数（`patchPartCounter`，不重写），主体变了才重写该页（Fable 选项 A）。
- 计数的读取：`isContinued`/`unmarked`/`numberedTitle`/`cardPartRuns` 在 `lib/ppt-continuation-marker.mjs`；`k>1` 才算续页。数字检查的豁免 `verifiedPartCounter`（`lib/ppt-source-numbers.mjs`）按大纲核对：该页在一段编号里，n 等于段长、k 等于位置。主题语言规范化的 `keepCardContinuation` 也保留计数。自测 `selftest-ppt-part-counter.mjs`。

## 测试

- `selftest-ppt-template-header-frames.mjs`：越界标题框夹紧、章节页不作内容框架（及回落）、无内容槽位页的标题让位、标签上方/下方/槽位空缺阻断、封面标签不重复标题、封面标题字号阶梯与较短标题。
- `selftest-ppt-card-outline-engine.mjs`：预设、两次调用、章节/结尾/小标题、取舍说明、重写、语言、精确页数、逐主题回退、简述模式、备注。
- `selftest-ppt-outline-first-api.mjs`：规划命令、退役命令/路由、无大纲暂停、回退、编辑与确认、用户大纲转卡片、旧流程只读。
- `selftest-ppt-card-pages.mjs`：组件形态（含对比与大数字）；模板媒体（图标框与照片列优先、徽章在卡片上方、角落照片原位、示例图表不出现、横幅陈述）；行内公式图例；标题带只在双语标题时保留。
- `selftest-ppt-builder-mark.mjs`：导出去掉建站工具标识、页面图片保留、校验通过。
- `selftest-ppt-table-min-rows.mjs`：最小行高导出经 soffice 渲染后文字完整可见、不越出表格框。
- 前端：`src/__tests__/unit/ppt-card-outline-render.test.ts`、`src/__tests__/e2e/ppt-outline-first.spec.ts`（@smoke，桌面/手机截图）。
- 测试替身：`ppt-scope-test-helpers.mjs` 的 `cardDeckReply`、`cardWriterReply`、`cardModel`。
- 前端测试替身：`src/__tests__/fixtures/ppt-parity.ts` 模拟卡片稿（新建停在设置表单；`planning` 命令先返回“写大纲中”，下一次读取项目给出卡片；`edit` 命令改卡片），`src/__tests__/helpers.ts` 的 `writeCardOutline` 走完“继续：设置大纲 → 生成大纲”。
- 线上验收：`scripts/ppt/option-d-live.mjs`（模板上传、读取、设置、大纲、生成、发布，记录各阶段耗时与模型调用数；发布后的编辑器环节：局部 AI 候选→应用→版本恢复→重新发布→导出 PPTX/PDF，写入 `summary.json` 的 `editor`，`PPT_EDITOR=0` 跳过；取代已删除的 `ppt-template-first-live.spec.ts`）；需保持服务的 PPT 页面打开（模型任务在页面里执行）。

## 已知限制

见 `docs/exec-plans/tech-debt-tracker.md` “PPT 卡片稿简化后的遗留”。
