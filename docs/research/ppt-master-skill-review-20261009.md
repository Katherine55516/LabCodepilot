# PPT module 与 ppt-master skill：可借鉴设计及落地建议

日期：2026-10-09。代码快照：`0f29c78ea27b037a98510021545fe6bf8942c1c4`。评审对象：本地 `ppt-master` v6.7.0，以及当前 PPT 模块的规划、输入策略、模板适配、渲染、发布、编辑和评测代码。

**补充实证：第 10–17 节新增用户指定的 Factor Zoo 同源成品对照。** ppt-master 为 16 页，Gamma 为 10 页；在本轮统一的字体可用渲染环境中，正文 glyph 包围盒覆盖率均值分别约 5.36% 与 12.90%，正文字号中位数接近。Gamma 的优势主要来自复合页面和来源关系的组织，不应归结为更多字、更小字或更少页。以下第 1–9 节保留首次 skill/code 评审记录；“未做同源生成对照”等边界描述仅适用于首次评审。本轮已经对照现有成品，但没有重新执行两家的生成流程。

## 1. 结论与评审边界

**建议吸收它的页面设计契约、语义关系建模、资源账本和分层修复方法，继续使用模块现有的 Deck IR、确定性布局、共享渲染契约和发布事务。** 不建议把整个 skill 的运行流程或 SVG 作者路径直接接入产品。

两者定位不同：ppt-master 是面向交互式作者的技能包，模型在文件工作区中规划并制作页面；当前模块是具有项目状态、版本、编辑候选、并发生成与发布门禁的应用服务。技能包规定得细，不等于它已经在我们的输入和模板上证明效果更好。

本轮将 SKILL.md 及其引用文件作为被评审资料，没有执行其中的生成路线、确认门禁或 attribution guard，也没有生成新的用户演示文稿。本轮仅新增调研文档和索引，没有修改模块代码。实际运行了三组当前模块专项自测，见第 8 节；没有运行真实 LLM、PowerPoint 应用或新的 UI 端到端验收。

## 2. 当前模块已有能力及实际缺口

| 环节 | 当前代码实际具备的能力 | 仍需改进的部分 |
|---|---|---|
| 内容边界 | 原始输入框架 hash、来源义务、逐页 scope audit；模板样例和模型自写计划不能成为事实来源 | 内容正确性仍依赖模型判断；全量框架重复序列化造成上下文负担；不能把审查协议完整当作语义正确的证明 |
| 规划和估算 | 来源库存、密度与结构容量、自动/手动页数区别；v9 代码展示策略、双语配对和可见规划假设；估算异常返回警告而不崩溃 | 章节分配、内容供给上限、组件容量与页数的联合优化仍在后续计划中 |
| 写作与重复 | claim 归属、必要回顾用途、规范化正文、sourceArtifacts；明确禁止重复填充或编造数据 | 独立内容供给和版式容量还没有充分联动；丰富表达需要从不同来源内容和关系中产生 |
| 模板 | mapped 与 preserve 区分；原生对象、文字槽位、受保护资产、处置记录、模板页匹配及受控变体 | mapped 主要继承配色/字体；完整模板组件档案、条目媒体绑定、可变槽位尚未完成 |
| 版式 | `ppt-layout.mjs` 中 10 种通用布局；模型提供语义，系统负责几何；原生模板另有页匹配和变体机制 | 通用 `chooseLayout` 主要按组件类型、角色、visualIntent 和关键词选择；缺少贯穿规划到渲染的页面关系图与构图契约 |
| 文本与媒体渲染 | Render Contract v2 统一文字边距、段落、换行、图片 crop/fit、图表有符号坐标轴；表格逐单元格容量检查 | 字符宽度和高度仍是保守预测；复杂遮罩/遮挡、真实字体 ink、整体视觉层级不能仅靠估算认证 |
| 质量与发布 | 内容审查后导出实际 PPTX；重开文件核验对象、内容、样式与 hash；转 PDF 检查文字保留/边界及部分混合正负柱图 | `visualVerified` 明确保持 false；PDF glyph 保留不代表没有遮挡，也不代表图片主体、视觉重点和构图正确 |
| 编辑与恢复 | 局部候选、baseRevision、scope、epoch、审查失效及受影响节点更新；writer/critic 有界修复 | 故障分类尚未统一映射为“修改哪一层、执行哪种操作、重验哪些节点”；几何问题仍可能落到文案重写 |

当前活跃计划 `ppt-general-content-media-balance.md` 明确：Phase 1 已完成，Phase 0 真实模型矩阵未完成，Phase 2–6 待开始。该状态与代码检查基本一致，不能把这些后续设计写成当前已具备能力。

另需纠正一个容易沿用的旧判断：`replaceTemplateSourceRegion` 目前跳过 protected 资产及 image/chart/table；仍存在的 35% 相交判定作用于可退役的旧前景标签/形状，不应再描述为“所有相交媒体都会被直接删除”。下一步重点应是媒体角色与重新绑定，而非只删除这个阈值。

## 3. 最值得借鉴的设计

### 3.1 页面必须有明确职责，构图建议不能成为事实许可（P1）

skill 的 `Audience move`、`Core message`、`Relationships` 和 `Page job` 将“读者读完这一页应理解什么”放在画图之前。它同时区分 Reference 与 binding：推荐构图可以调整，来源关系与明确锁定的要求必须保留。

模块已经有 question、focus/message、keyPoints、claimId、visualIntent。建议在这些字段上增量补充，而非再造一套平行 brief：

```json
{
  "pageIntent": {
    "readerQuestion": "输入支持的读者问题",
    "coreMessage": "本页独立主张",
    "audienceMove": {"before": "尚未理解的关系", "after": "本页能解释的关系"}
  },
  "relationships": [
    {"id": "rel-1", "type": "order", "unitIds": ["u1", "u2"], "sourceRefs": ["src-1"]}
  ],
  "compositionHint": {"prototypeId": "numbered-steps", "binding": false}
}
```

这些是建议字段，不是当前 schema。`after` 不能发明输入未给出的商业收益、行动承诺或因果结论。一般解释页无需“推动决策”；其职责可以是说明定义、机制或限制。缺少 audience 信息时使用已披露默认值，不增加新 workflow 步骤。

实施位置：`ppt-prompt-contracts.mjs` 的 OUTLINE_SCHEMA/outlineContentContract/writerPrompt → `ppt-api.mjs` 的 parseOutline → `ppt-planning.mjs` 的 slidePlan → 后续布局选择和 critic。只改 prompt 而不保留字段，结果会在解析阶段被丢弃。

验收：教学、业务汇报、纯数据、流程输入都有来源支持的页面职责；人工锁定标题不被强制改成断言；没有证据的“建议/收益/决定”不能通过。

### 3.2 从语义关系选择结构，而不是把所有内容装入卡片（P1）

skill 给出 order/link/parent/membership/contrast/overlap 六类关系，并强调拓扑先于坐标。它还区分：数值决定长度/面积/位置的是 Chart；行列事实是 Table；定性关系才是拓扑构图。不能画一个漂亮箭头就声称保留了原文流程。

当前库存已有 relationships/adjacency，并非完全没有关系信息；但表格多被概括成 comparison、流程多变成 precedes。`ProcessBlock` 遇到复杂分支可回退原文 text，普通流程为 timeline；mermaid 转换保存了部分分支标签，但不是完整的、可编辑的图关系契约。

建议保留关系的 unit/node/edge/condition/sourceRefs，先支持线性顺序、条件分支、层级、分组、对比五种常见结构。无可靠关系证据时保持 prose/table，不自行补出闭环、包含或因果箭头。循环、共享所有权与复杂 overlap 可后续增加。

实施位置：`ppt-content-inventory.mjs`、`ppt-semantic.mjs`、`ppt-presentation-policy.mjs` 保留关系 → `ppt-source-artifacts.mjs` 绑定 → `ppt-layout.mjs` / `ppt-density-capacity.mjs` 选择合法原型 → RenderTree、preview、PptCanvas、PPTX/PDF 消费同一关系与几何结果。不要允许 LLM 直接生成路径、坐标和任意 SVG。

验收：流程重排不能丢边或更改条件；组织层级和泳道不能被改成无关系列表；不同语言标签与条件有同一节点 ID；preview 与 PPTX 的箭头端点、方向和分组一致。

### 3.3 分离品牌、风格、结构与整套应用模板（P1）

skill 的 Brand/Style/Layout/Deck 分层很适合改进模板档案，但不需要把四个技术分类直接做成用户必须选择的四种入口。

建议在既有 templateSpec/templateFidelity 内建立 `templateComponentProfile`：

- identity：颜色、字体、logo 与必须保留的品牌 token；
- style：构图倾向、文本表达习惯、图片处理和节奏，可作为建议；
- structure：实际区域、容量、重复条目组、媒体角色、可变条目范围；
- scenario：原模板的旧案例文本，不具有新输入事实权威。

mapped 可以借结构原型和角色资产，不能只复用调色板却暗示完整保真；preserve 要保存原生对象/遮罩，但也不能把旧 KPI、客户照片或样例图当作新输入证据。模板内专有 Master/Layout 结构与页面构图要分别记录。

实施位置：`ppt-template.mjs`、`ppt-template-scheduler.mjs`、`ppt-template-fidelity.mjs`、模板缓存及安全校验，衔接当前计划 Phase 2。档案必须由真实对象和尺寸推导，不能让模型猜图标数量。

验收：上传同一模板的 mapped/preserve 模式有明确不同能力；扩大页数后 item 图标和图片随条目绑定；保留品牌/装饰不等于保留旧案例事实；旧缓存需要版本迁移或重新分析。

### 3.4 用资源账本管理图片，而不是按数量补图（P1）

skill 的资源表记录 purpose、source/acquireVia、cropPolicy、status、派生关系和 page role。它的 native-restore proxy 规则也提示：不支持重建的复杂媒体应作为原子对象保留，不应为了增加编辑自由而破坏它。

模块已有图片 ID/hash、crop/fit、nativeMaskXml、受保护资产和处置记录，建议在此基础上补齐媒体计划：`role`、`sourceHash`、`boundUnitIds`、`cropPolicy`、`focalPoint`、`required`、`status`、`derivedFrom`、`reusePolicy`。区分来源证据、条目图标、背景照片、品牌标记和旧案例资产。

媒体未准备好、被策略省略或已验证替换应是不同状态，不能一概显示为成功。证据图 no-crop 必须可见完整；背景/装饰图 adaptive 可以裁切；新 AI 图或网络图应作为独立的获授权能力，不通过局部优化默默扩展来源。

实施位置：`ppt-source-artifacts.mjs`、`ppt-semantic-media.mjs`、`ppt-template-dispositions.mjs`、`ppt-object-integrity.mjs`、`imageContract` 和最终 exportManifest。

验收：删掉任何 required 图片产生定位明确的错误；省略旧案例需记录角色与依据；同一资产不同 caption 不丢上下文；媒体数量增加不允许用同一图片或相同说明反复填充。

### 3.5 将真正的视觉核验补在实际导出之后（P0）

skill 的 visual rubric 值得借鉴：区分 hard（溢出、遮挡、缺关键元素、图片破损）与 soft（节奏、对齐、重点）；规定修复权限；留下 before/after、截图、backup 和验证状态。

但它默认 rubric 每页只做 1 轮，修复后并不总是再渲染；routing 也只有显式请求视觉评审才触发 visual-review。因此不能直接把“skill 有 visual-review”理解为其所有成品都通过完整视觉验收。模块应做得更明确：**修改过的页面必须重新验证，不能以 fixed 代替 verified。**

建议保留现有真实 PPTX/PDF 核验，再增加实际导出页的视觉证据：

1. 每页保存实际 PPTX 转换得到的 PNG/PDF/hash，绑定 revision/renderHash/manifestHash。
2. 确定性检查负责可测的文字边界、缺对象、签名和图表数据；视觉判断负责复杂遮挡、主体裁切、结构读法和视觉重点。
3. 高风险页（dense、双语、表格、复杂 mask/foreign、unresolved overlap）必须检查；低风险页也生成截图证据。审查预算不足时明确 not_evaluated，不能将整个 deck 标成 visualVerified。
4. 修复后只重渲染受影响页及共享 token 影响的页面；重新检查 hard issues，并保留软问题的未改原因。

建议记录 `{rule, severity, slideId, nodeIds, basis, evidencePath, ownerLayer, allowedOperations, beforeHash, afterHash, verifiedHash}`。不同引擎的结果独立记录；LibreOffice 通过不自动等同 Microsoft PowerPoint 通过。

实施位置：`ppt/render-audit.mjs`、`ppt/render-collision.mjs`、`ppt/export-verifier-python.mjs`、`ppt-export-integrity.mjs`、`ppt-quality.mjs`、`ppt-api.mjs` 的 publish 节点及编辑后发布路径。

验收：文字仍存在于 PDF 但被前景遮住的负例不能被视为视觉通过；刻意的背景包围/图层重叠不误报成必须拆开的 collision；任何改动使旧视觉审查失效。

### 3.6 让问题修复到所属层，避免用重写解决所有故障（P0）

skill 的 “Act at the owning layer” 和恢复矩阵是可直接借鉴的工程原则。当前已存在 writer/critic 有界重试、无进展停止、revision 校验、DAG 恢复；应补齐的是统一故障 → 操作路由，而非新增无边界 agent 循环。

| 故障 | 应修改的层 | 操作及禁止事项 |
|---|---|---|
| 来源外事实、丢限定词、重复主张 | content/plan | 返回来源支持的独立内容；无法支撑自动页数时确认前合并；不能用同义句填槽位 |
| 文字超框、表格单元格容量不足 | composition/text | 先调整合法布局/列宽/段落与结构，再做信息等价精简或拆页提议；不能静默裁字/删列 |
| 章节分配失衡、页面无独立职责 | plan | 重分配内容供给；保留人工锁定页数，容量冲突可见报告 |
| 图表符号/单位错误 | renderer/data | 改坐标与序列契约；文案模型不能改真实数值来配合图形 |
| 图标脱离条目、照片裁掉主体 | media/composition | 恢复绑定、修 crop/fit；不是重写 claim |
| 共享品牌 token 可读性冲突 | theme | 非锁定 token 可全局修改；明确锁定 token 需要报告冲突和可审阅方案，不能在 repairProject 中静默换色 |
| XML/package/font conversion 失败 | exporter/runtime | 修对应实现或环境，重跑受影响导出；不得把底层错误包装成内容不足 |

当前 `repairProject` 可自动改 templateSpec.palette.foreground/muted，尚无该处 token 级 binding 检查。因此从 skill 借鉴 binding 时，需要同时约束实际修复代码。

实现建议：统一 `ownerLayer/repairKind/affectedNodes`；不同层采用小型显式操作白名单；一次候选修复后重验内容义务、范围、几何与媒体，不只复跑触发它的规则。失败回滚，保持有限轮数、无进展停止，沿现有 DAG 更新 hash 和下游失效范围。用户已锁定页数或确认的页面不得被自动拆分/重写。

### 3.7 页面节奏与信息等价表达，增加选择空间而非规定装饰配额（P1）

skill 对 authored texture 的要求很好：因果解释、限定条件和连续论证应保留为 prose；真正并列/有序材料才改成 bullets。模板卡片槽位不应反过来决定来源表达。

可借鉴 `geometrySignature` 和 anchor/dense/breathing，但转成可测的 composition signature：原型、主结构、媒体角色、视觉主次、内容角色。对连续同构页面给出软提示，允许同类任务反复使用同一结构。

模块已有模板 visualSimilarity/TEMPLATE_VARIANTS，不能把多样性说成完全没有。建议重点扩展通用布局与原生模板共同消费的组件原型：table+notes、mechanism+example、image-split、two-panel、numbered-steps、formula+variables、collection-with-item-icons，条目数由真实内容决定，容量由 Render Contract 测量。

实施位置：`ppt-prompt-contracts.mjs` 的 writingGuide/canonicalWriterOutput、`ppt-presentation-writing.mjs`、`ppt-layout.mjs`、`ppt/point-layout.mjs`、`ppt-template-scheduler.mjs`、`ppt-density-packing.mjs`。

验收：不同输入产生不同信息结构；连续讲解页可同构但主张不重复；不会为了避免三页同版式而换掉正确图表；不会为达到 Gamma 字符区间增加无来源内容。Gamma 密度作为按用途/语言/模板分层的参考分布，而不是每页字符数 hard minimum。

### 3.8 分阶段上下文与对象级验证回执（P1）

skill 按路线与触发模块加载资料、每个图表留下独立校验回执，值得吸收其“最小充分上下文”和“每个对象都有证据”原则。

当前 sourcePacket 虽有预算，但 `inputScopeContext` 把 sourceText、segments、objects 全部序列化，outline 又加入 inventory/source_objects；局部上下文限制并不等于整个 prompt 有预算。活跃计划记录一次 dry run 大纲 prompt 达 405,700 字符；这是既有记录，本轮没有重测该数值。

建议保持完整输入为不可变事实权威，在存储层保留全文/hash；按阶段编译有限上下文：来源目录、全局约束/排除项、当前页完整源对象、关联关系和必要邻页主张。长输入采取分块提取与来源覆盖核对，不能只做简单 slice 丢尾部。完整范围审查也可按来源/页面批次执行，最后汇总遗漏/冲突；hash 只是身份校验，不能替代被审查的事实。

实施位置：`ppt-input-scope.mjs`、`sourcePacket`、`sourcePlanningContext`、`ppt-obligations.mjs` 和各阶段 prompt builder。加入输入/输出 token 预算与覆盖回执；预算超限应重新打包而非截断结构对象。

图表回执可直接扩展 exportVerification：objectId、sourceDataHash、axisDomain、zeroBaseline、unit、numberFormat、geometryCheck、nativeReadback、renderEngine、status。当前基本 bar/line/pie 与混合正负柱图检查已有基础；复杂图表先显式标记 unsupported，不能假装已验证。

验收：长文最后一节的限制不能因上下文压缩消失；table/code/math 对象不半截进入 prompt；每个关键图表都有与当前版本绑定的独立记录，未检查对象不可归入通过数。

### 3.9 原生局部编辑的最小重建和回执（P2）

skill 的 native route 记录 passthrough/cloned_passthrough/patched/rebuilt；未编辑页面保留原生结构，不支持对象用原子 proxy 保护。该思想有助于验证“局部修改没有损坏其他内容”。

当前模块已有 nativeRef/hash 和 preserve 导出，不建议再增加 SVG roundtrip 作为第二主数据源。可增加导出变化清单：页面/对象为什么被重建、哪些 XML/媒体/遮罩保持、哪些共享资产影响了多个页面。针对单对象文字修改，对未改对象进行结构及依赖校验；除非已有实现能够保证，不承诺整页或整个 ZIP byte-for-byte 相同。

实现位置：`ppt/import-pptx.mjs`、exportManifest、`ppt-template-fidelity.mjs`、编辑 operation/revision 日志。验证分组、裁切/遮罩、SmartArt/foreign、共享媒体、链接以及重排后内部跳转。复杂对象不支持时给出明确范围，不自动转换成截图宣称可编辑。

## 4. 不建议照搬的部分

| skill 做法 | 不直接采用的原因 | 适合模块的替代 |
|---|---|---|
| 整套串行步骤、多轮 BLOCKING 与角色切换日志 | 交互式技能规约不等于产品工作流；增加等待和状态维护成本 | 保持现有用户步骤；依赖节点按 DAG 执行，互不依赖页面保留并发；重大需求冲突再确认 |
| LLM 直接 hand-author SVG/任意形状 | 扩大自由发挥、攻击面、测量差异，产生第二套几何权威 | 模型输出来源支持的语义与合法原型建议；确定性 renderer 编译 IR |
| topic-only 默认 research、scenario 数值 | 当前模块输入范围约束更严格；不能把额外研究或虚构 KPI 当作常规补足 | source_only / bounded explanation 保持；新增来源需显式进入输入流程；情景数值需授权及可见标签 |
| 所有文字遵守某个全局字号 anchor ±2px | 上传模板和不同角色本来有多种字号，强制统一可能破坏结构 | 角色级字体/字号/最小可读尺寸与 template intent；基于实际容量验证 |
| presets、渐变、filters 不出现就要求理由 | 容易诱导为了配额而装饰，不一定服务内容 | 只检查页面职责是否表达成功；风格多样性是软建议 |
| 自动“缩字或换行”解决 overflow | 技能 rubric 的局部动作不足以保证内容完整和投影可读 | 重排/结构调整优先；信息等价精简；必要时请求拆页；最后受限缩字且复验 |
| 直接替换现有 native exporter/共享渲染链 | 双系统会增加一致性风险与迁移成本 | 个别工具用隔离 PoC 对比；通过真实 PPTX/PDF 和输入矩阵后才考虑移植 |

该技能包为 MIT。若实际复制脚本/模板，需要保留对应版权和许可证、审查依赖及数据访问，不必把它自己的运行入口/attribution guard 移植成模块产品门禁。这里是复用要求，不是本次评审的额外审批步骤。

## 5. 建议实施顺序与现有计划衔接

| 顺序 | 交付 | 优先级 | 与现有计划关系 |
|---|---|---|---|
| 1 | 当前真实模型端到端基线；复杂遮挡、裁切、来源外扩展负例；保留全部版本证据 | P0 | 先补 Phase 0 的实际模型证据，不用历史模拟结果替代 |
| 2 | 统一修复 ownerLayer/operation、binding token 保护、实际渲染复验与回滚 | P0 | 提前实现 Phase 5 中的基础部分，并利用当前 exporter/发布门禁 |
| 3 | 模板组件档案与媒体角色账本，mapped 媒体继承 | P1 | Phase 2；先校对真实模板对象与容量 |
| 4 | 页面意图 + typed relationships + 内容供给/页数联合分配 | P1 | Phase 3；先确保内容独立、限定词保留和关系正确 |
| 5 | 组件原型、可变槽位、媒体随条目伸缩及 soft rhythm | P1 | Phase 4；所有视图共用 IR/Render Contract |
| 6 | 分阶段 prompt 编译、批次 scope audit 和对象级回执 | P1 | 可单独分阶段推进；保持原始权威和覆盖验证 |
| 7 | 最小重建回执、更多 native chart/shape、notes/动画等能力 | P2 | 基础一致性稳定后推进，不影响既有用户步骤 |

原型步骤不必增加。页面职责、关系和资源计划可在现有 Syllabus/生成任务面板展示摘要，局部优化在既有候选/应用流程中展示影响范围与失败原因。质量状态应区分 content passed、export passed、rendered text passed、visual evaluated，不用一个“通过”掩盖未验证部分。

## 6. Prompt 应如何吸收

不要把整个 SKILL.md 拼进 system prompt。按模块已有职责，补入少量稳定契约：

- Planner：每页一个来源支持的核心问题/职责；关系与独立 claim 有来源 ID；保留框架内解释深度；构图只是建议；供给不足不重复填充。
- Writer：按 prose/list/table/process 的语义保留表达；条件、变量、单位和否定随主张一起出现；只输出合法语义 schema。
- Layout：由代码消费关系、实际组件档案和容量；禁止模型提供坐标、删媒体或静默调整页数。
- Critic：分别审查内容范围、覆盖/重复、页面职责、关系和视觉表现；每条 finding 指定 ownerLayer 和合法操作，而非只返回“改善排版”。
- Local AI edit：继承输入 framework、binding tokens、固定页数和已接受页面；以 candidate/diff 展示变更；不能把局部编辑请求自动升级成新来源。

Prompt 修改必须和 parse、schema 版本、IR 存储、恢复迁移、重验逻辑一起交付。来源真实性与任意因果关系的判断不能完全靠枚举/ID 校验实现。

## 7. 通用验收矩阵

| 输入/场景 | 必须验证 |
|---|---|
| 短主题/来源不足 | 可解释范围与未知事实分开；不造数字；更多页数不会产生重复或新议程 |
| 纯中文/纯英文/双语长文 | 同一 claim 配对、限定词一致；不同字体及标点下换行；末节不丢失 |
| CSV/XLSX、Markdown、HTML、DOCX 表格 | 空单元格、多行文本、单位/负号、全部列、跨页表头与连续行范围 |
| 程序代码/ASCII/Mermaid/公式 | 展示策略披露；代码缩进；图的分支/顺序；数学结构、变量与条件 |
| 流程/层级/分类/比较 | topology 不补出来源不存在的边；各视图关系相同；有语义的 overlap 不当作碰撞拆开 |
| 图表 | 正负/全负/零值、多系列、单位、格式和轴范围；XML 数据、preview、实际 PDF 一致 |
| 多图模板/少图模板/复杂遮罩 | 来源证据与装饰不同规则；crop/fit/no-crop；item 绑定；shared asset 改动范围 |
| 自动/手动页数，估算值/0.6×/1.5× | 内容供给与完整性；超限显式报告；人工页数不被自动覆盖 |
| AI 局部优化/用户接受页/恢复/再次导出 | stale finding 不能通过；未改对象保持；修复失败回滚；新版本重验 |

每项同时检查确定性负例与真实模型正例。生成成功率、误拦截率、修复收敛率、媒体角色保留、来源支持和实际可见性需要分别报告。

## 8. 本轮验证结果和限制

运行时：`/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3`，测试调用模块现有本地运行时与生产 exporter；生成的测试文件位于临时目录并由测试清理。

| 本轮实际执行 | 结果 | 证据范围 |
|---|---|---|
| `selftest-ppt-balance-p0.mjs` | 通过 | 数学表格解析、估算异常降级、图转步骤、代码策略、双语配对、prompt policy；09 fixture 代码省略 32 页/保留 44 页 |
| `PPT_CONTRACT_PDF=1 selftest-ppt-render-contract.mjs` | 通过 | 多种 typed 输入、可见损失门禁、正负图、图片 fit/crop、生产 PPTX，以及实际 PDF 的符号/中文/代码等宽/表格硬换行 fixture |
| `selftest-ppt-export-integrity.mjs` | 通过 | mapped/native 实际文件、中文 glyph、表格/公式/图片/说明保留；破坏 cell/math/image/caption 的负例被拦截 |

这些是明确 fixture 的回归证据，不证明所有模板/语言/密度都无问题。本轮没有真实 LLM 样本、复杂视觉模型审查、Microsoft PowerPoint 或 UI 验证；ppt-master 的描述和脚本实现也没有经过同源生成对照。因此不作“采用该 skill 就能达到 Gamma”或“当前所有问题已修复”的结论。

## 9. 主要代码及 skill 依据

模块路径相对于仓库根目录 `/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/`：

- `apps/cowork-server/lib/ppt-prompt-contracts.mjs`：system、policy、OUTLINE_SCHEMA、writer/repair 契约。
- `apps/cowork-server/lib/ppt-input-scope.mjs`：原始输入 authority、scope hash 与审查协议。
- `apps/cowork-server/lib/ppt-planning.mjs`、`ppt-presentation-policy.mjs`：估算、策略与披露。
- `apps/cowork-server/lib/ppt-content-inventory.mjs`、`ppt-density-capacity.mjs`：结构库存、关系覆盖与组件测量。
- `apps/cowork-server/lib/ppt-layout.mjs`：10 个通用布局及语义/关键词选择。
- `apps/cowork-server/lib/ppt-template.mjs`、`ppt-template-scheduler.mjs`、`ppt-template-fidelity.mjs`、`ppt-source-artifacts.mjs`：mapped/preserve、变体、媒体保护及结构绑定。
- `apps/cowork-server/lib/ppt/render-contract.mjs`、`render-audit.mjs`、`render-collision.mjs`、`export-verifier-python.mjs`，`src/components/ppt/canvas/PptCanvas.tsx`：共享渲染及预测/实际校验。
- `apps/cowork-server/lib/ppt-quality.mjs`、`ppt-export-integrity.mjs`、`ppt-api.mjs`：修复、发布门禁和 verification 状态。
- `apps/cowork-server/lib/ppt/generation-edit-service.mjs`、`quality-service.mjs`：局部编辑范围及复验。
- `apps/cowork-server/scripts/ppt-balance/`、`docs/exec-plans/active/ppt-general-content-media-balance.md`：现有 harness、实测记录和阶段状态。

skill 根路径：`/Users/dongli/Documents/ppt-master/skills/ppt-master/`：

- [SKILL.md](/Users/dongli/Documents/ppt-master/skills/ppt-master/SKILL.md)：v6.7.0、Reference/binding、Page job、Geometry signature、owning-layer repair。
- [routing.md](/Users/dongli/Documents/ppt-master/skills/ppt-master/workflows/routing.md)：路线、视觉评审触发和 Brand/Style/Layout/Deck 边界。
- [design_spec_reference.md](/Users/dongli/Documents/ppt-master/skills/ppt-master/templates/design_spec_reference.md)：页面意图/关系、typed visuals、图片资源表。
- [spec_lock_reference.md](/Users/dongli/Documents/ppt-master/skills/ppt-master/templates/spec_lock_reference.md)：跨页 anchors、参考与约束边界。
- [executor-base.md](/Users/dongli/Documents/ppt-master/skills/ppt-master/references/executor-base.md)：信息等价、表达 texture、page rhythm、事实来源。
- [executor-structure.md](/Users/dongli/Documents/ppt-master/skills/ppt-master/references/executor-structure.md)、[topology-assembly.md](/Users/dongli/Documents/ppt-master/skills/ppt-master/references/topology-assembly.md)：关系原子、编辑单位与相对注册。
- [visual-review.md](/Users/dongli/Documents/ppt-master/skills/ppt-master/references/visual-review.md)：hard/soft、权限、截图回执、回滚及默认迭代限制。
- [failure-recovery.md](/Users/dongli/Documents/ppt-master/skills/ppt-master/workflows/governance/failure-recovery.md)：按 fault owner 修复、下游失效及 resume。
- [verify-charts.md](/Users/dongli/Documents/ppt-master/skills/ppt-master/workflows/stages/verify-charts.md)：每对象数据/轴/几何验证及回执。
- [edit-native-pptx.md](/Users/dongli/Documents/ppt-master/skills/ppt-master/workflows/edit-native-pptx.md)：原子 proxy、最小重建、页面计划和导出分类回执。

## 10. Factor Zoo 同源成品：取证范围与指标口径

### 10.1 本次实际检查的文件

| 对象 | 路径/证据 |
|---|---|
| 输入 | `/Users/dongli/Documents/quant_research/quant_3.0/04_factor_zoo_overview.md` |
| ppt-master 成品 | `/Users/dongli/Documents/ppt-master/projects/factor_zoo_overview_20261008/exports/factor_zoo_overview_20261008_20261008_231047.pptx` |
| Gamma 成品 | `/Users/dongli/Downloads/The-Factor-Zoo (1).pptx` |
| master 工作区 | `page_plan.json`、`authoring-svg-flat/`、`analysis/`、原始模板与输入副本、三个质量/交付报告 |
| 本轮复查产物 | [ppt-master-vs-gamma-factor-zoo-20261009](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/outputs/ppt-master-vs-gamma-factor-zoo-20261009/README.md)：逐页文字/对象抽取、图片角色账本、指标、实际 PPTX→PDF→PNG 和联系表 |

输入文件与 master 工作区中的 `sources/factor_zoo_overview.md` **SHA-256 完全一致**：`ebacfacedb6138ccb30f6b6af2b7b23a74574c741d348105aa5a2b2dba4fee16`。Gamma 的同源条件来自用户说明及成品主题/内容对应，本轮没有其提交记录，不能反推其创建时的每项参数。

两份 PPTX 的 SHA-256：master `4a3a681b93f84c3f2b145e545dc8c0e2ada97b75fa51b50f70a70571779afe85`；Gamma `c8be44407f0e757e8958c314b076143bc220566feacbea1dea7ddfe34b41ec49`。两者画布均为 `12191695 × 6858000 EMU`，约 16:9。这里比较的是附件这份 **10 页 Gamma**，不要混入其他历史 8/22 页样本的数值。

读取全部 26 页的 OOXML、文本、表格和图片；逐页查看渲染图；关键内容回查输入。渲染使用同一 LibreOffice 转 PDF、PDFium 栅格化路径，没有在 Microsoft PowerPoint 中打开。

首次默认环境渲染出现中文缺字，不能把这个环境现象直接判为某份 PPTX 的布局缺陷。随后提供系统字体目录，对 master 声明的 SimSun 使用 Songti SC 的 fontconfig fallback，两份文件重新渲染；所有正式视觉判断使用 `*-font-aware/`。复查后的 PDF 中文字符数 master 2,360、Gamma 335，与各自 OOXML 抽取数一致。原始 PPTX 没有被改动。字体替代会影响字宽，测量是本环境结果，不是原生 PowerPoint 的逐像素证明。

### 10.2 可复查的密度、字号与组件差异

| 指标 | ppt-master | Gamma | 解释边界 |
|---|---:|---:|---|
| 总页数 | 16 | 10 | 不证明任一份页数来自自动估算；也不是通用页数目标 |
| 封面外页面 | 15 | 9 | 本轮“正文页”统一仅排除第一页 |
| 全稿非空白文本字符 | 3,065 | 9,359 | master 偏中文，Gamma 偏英文；不能据此说信息量是 3 倍 |
| 正文页非空白字符均值/中位数 | 201 / 213 | 1,012 / 1,019 | 图片公式不计入抽取文字；不能把约 5 倍字符量当成深度比例 |
| 正文 glyph 包围盒面积占整页面积：均值 | 5.36% | 12.90% | 实际 PDF 文本几何代理；不是墨水面积、全部内容填充或完整性评分 |
| 同指标：中位数 | 5.31% | 13.21% | 支持 Gamma 的可见正文密度显著更高，约 2.4 倍均值 |
| 正文字号：页内 glyph 中位数再取页间中位数 | 11.51 pt | 11.00 pt | 密度差异主要不来自大幅缩字；不能当作投影字号建议 |
| 页面 picture 对象/实际使用唯一图片 | 35 / 16 | 42 / 32 | 含公式、图标、边框、背景，不等于照片数 |
| 原生 Table 对象 | 0 | 3 | master 第 10/14 页有形状+文本绘制的表格；不能说它没有表格 |
| 原生 Chart 对象 | 0 | 0 | 都没有可用作数值图表正确性基线的 native chart |

glyph 指标仅统计 PDF 中非空白字符，位于页面高度 20%–98% 的正文区域；计算字符包围盒的几何并集，避免重复叠加，不包含图片公式、照片和装饰。两份正式渲染提取出的字符均没有落到画布之外，但这不认证内部遮挡、文本框裁切或所有浏览器/Office 环境。

另算 `中文字符 + 英文词数` 的粗代理，正文均值 master 162.6、Gamma 187.1。它也不能作为语义等价换算。**密度要看实际空间使用，深度要检查定义、机制、条件和关系；语言字符数不适合兼任两者。**

### 10.3 一项重要限制：这是 native 模板适配结果，不是 Default 全流程效果

master 工作区使用 `ppt-master.roundtrip-page-plan.v1`；原始 `source.pptx` 是 8 页 Process Improvement Proposal。页映射把这 8 页复用/重排成 16 页：原第 2 页的链环结构重复 3 次，原第 8 页的竖向路线图重复 3 次，原第 7 页的案例/引语结构重复 3 次。没有 `design_spec.md/spec_lock.md`；这与 Edit Native route 不创建 Default 工件的规定相符，不能因此认定违规。

`page_plan.json` 只存 source_slide 与 SVG 文件，不承担每页语义覆盖和内容深度契约。是否在当时聊天中做过完整源内容映射，本轮没有证据。该工作区证明“本次输出较稀疏、旧结构复用显著”，不证明该 skill 的所有生成路线都会如此。

检查报告为：SVG final 16 页、0 error、16 warning（主要是导入画布的小数 viewBox）；postflight `passed-with-warnings`，delivery `passed-with-advisories`。这些通过证明结构/打包检查的相应范围，**并未发现本轮对照揭示的语义稀疏、分类损失、替代关系被画成顺序等问题**。因此要补内容与构图验收，而不是单纯增加更多文件格式 hard rules。

## 11. 逐主题对照：Gamma 的优势具体在哪里

| 来源内容 | Gamma 的实际组织 | master 的实际组织 | 可以迁移的标准与保留事项 |
|---|---|---|---|
| §1 定义及概念边界 | G2：定义、收益生成式、变量、低秩结构/风险溢价、异象相对性、四概念卡、风险/错定价解释同页 | M2：定义、四个短标签、β≠α 大字及一段解释；无生成式/噪声/低秩作用 | 让数学、变量和概念边界共同支持一个问题；不要把关键关系换成通用链环 |
| §2 模型谱系 | G3：五个并列年代/模型节点，按因子、理论和未解释问题展开，兼有公式 | M3–6：四页分别 CAPM、局限/APT、FF3/Carhart、FF5/q；后者大部分是名称 | 统一比较轴可以提高每页解释量；M3 的 CAPM 推导步骤比 G3 的概览更细，不能为少页删掉要求保留的推导 |
| §3–4 检验与溢价 | G4：检验对象、GRS 作用/限制、风险/错定价机制与失效条件 | M7–8：两个独立页面；M7 再次使用链环和 GRS 大字，M8 三机制+引语 | 相关概念可在共同阅读框架下合页；M8 单独保留“市场摩擦”维度，Gamma 将其并入行为部分，不代表后者更完整 |
| §5 Factor Zoo | G5：问题规模/原因说明，四卡分别冗余、挖掘、多重检验、最低标准 | M9：多重检验、定义/样本、成本/复现三项要求，原因结构较弱，主标题与页内标题近重复 | 把问题是什么/为什么/如何判断连接起来；Gamma 额外数字和引用必须过来源门禁 |
| §6–7 评分卡与分类 | G6：左右两个原生表，分类8行、评分6行，页尾反证提醒 | M10–11：评分7行4列较完整；分类用6个模板卡承载8类，合并低风险/流动性、情绪/另类数据 | 借双表与“分类+诊断”组织；不借 Gamma 删除 controls/mining concern/流动性评分行的做法；保留完整独立类别 |
| §8–9 构建与择时 | G7：三种组合表达的用途/限制，第四块讨论择时与拥挤及监控 | M12–13：构建采用1–4路线图；择时采用 β(t)/AUM/ρ/TC 四个大标签 | 表达方式是 alternatives，不是必须依次完成的步骤；G7 的同线图标也不能作为顺序证据 |
| §10–11 市场与算例 | G8：左侧三类市场条件，右侧四步图及独立排序说明 | M14–15：市场比较表+大照片，另页竖向排序流程与 HML 公式 | 共享画布可以容纳两个独立面板；不能发明它们之间的因果；M15 明示 HML 公式优于 G8 的仅“Compute HML”标签 |
| §12 从因子到策略 | G9：9步归为4阶段，每阶段交代验证任务、成本、治理 | M16：压为验证信号/约束组合/小规模上线三项，合入检查与总结，标题近重复 | 用 phase→steps 层级节省空间，不丢工作流顺序和关键输出 |
| §13–14 检查与总结 | G10：8项检查与8行模型谱系表并排，末段收束 | M16：5类检查压成一句、总结段；没有全局年份/因子数/理论表 | “可执行检查+全局对照”比再次概述更有信息；不能用一句“均已覆盖”代替各项可见内容 |

这里的 G/M 分别是成品页码。Gamma 的页面通常具备几个不同表达层：主题/范围 → 主解释 → 结构化对照或步骤 → 适用条件/提醒。master 很多页则让模板图形和大标签占据主要视觉空间，正文只有短解释。后者即使覆盖了章节名，也没有等价保留该章节的解释关系。

Gamma 也不包含原输入的全部理论细节：CAPM 矩阵推导、完整 FF3 构建式、FF5 折现推导、q 因子的具体口径与分组、q5 的前瞻性动机、SY 簇内容与事后构建限制均未充分展开。**用户需要 detailed 时，应以来源中不同机制的可见保留为准；不能把该 10 页 condensed 成品当作全部输入的上限。**

## 12. 以 Gamma 为标准重定义页面设计契约

### 12.1 成品支持的特点与不能确认的内部实现

| Gamma 成品可直接确认 | 适合模块的契约设计（建议，不是 Gamma 私有 schema） |
|---|---|
| 一个页面容纳多个互补组件；正文内容不局限于原模板文字槽 | 一个 governing question，可有不同 subjobs；允许组件重组及在容量内修改槽位数量 |
| 模型谱系使用一致比较轴；分类表、评分卡能共同阅读 | pageIntent 与 comparisonAxes/requiredUnits 显式化；类型差异保留，不把所有内容变成 bullet |
| 公式附近有变量解释；检查与模型汇总能并列 | 记录解释链及 adjacencyPairs，布局必须在空间上保留绑定 |
| 样例中的相关章节经常合页 | 先做语义 grouping，再做容量 packing；只在确有共同问题或独立面板可读时合并 |
| 有正文、关键词、表、图、条件句等不同表达 | blockTexture 是内容表达选择；图形不得替代未表达的机制/条件 |

Gamma 的页面结果支持这些设计目标，不能证明后台一定有同名字段、固定规则或某种 agent 分工。

### 12.2 建议的可执行页面契约

在第 3.1 节的 pageIntent 之上增加以下信息，并贯穿 planner→writer→layout→critic→edit：

```json
{
  "question": "本页必须回答的来源问题",
  "job": "definition|comparison|mechanism|workflow|diagnostic|synthesis",
  "subjobs": [{"id": "job-1", "sourceUnitIds": ["u1"], "purpose": "具体内容任务"}],
  "requiredUnits": ["不同事实/机制/条件的来源ID"],
  "requiredRelations": ["必须保留的关系ID"],
  "explanationChains": [{"claimId": "c1", "mechanismIds": ["u2"], "qualifierIds": ["u3"]}],
  "adjacencyPairs": [{"a": "formula-1", "b": "variable-explanation-1", "reason": "解释绑定"}],
  "comparisonAxes": ["来源实际支持的比较维度"],
  "groupingReason": "互补/比较/共同检验问题，或明确的独立面板",
  "omissions": [{"sourceUnitId": "u4", "reason": "压缩/不适配", "requiresConfirmation": true}],
  "compositionCandidates": ["合法组件原型ID"],
  "authority": {"sourceHash": "...", "templateGeometryBinding": false}
}
```

不是所有页面都要求所有字段非空，也不要求每页强凑定义/机制/例子三件套。封面可以只建立范围；纯数据页可以只交代数据、口径和限制。对来源已有丰富推导的 mechanism 页面，则不能只留符号名和一句结论便宣称详细模式完成。

修复“稀疏”时，依次补齐已经被选为必讲的机制、变量、比较轴和条件；若本页真实供给确实不足，自动页数在确认前合并。**不能先认定16页必须填满，再让模型为所有空框扩写。** 手动/已确认页数保留，给出真实供给不足或结构无法容纳的反馈。

估算页数也不应直接追求本样本的10页。先评估来源不同信息与角色容量，再估算复合组件能共同承载多少；对 detailed 与完整表列保留，合理页数可能多于 Gamma。页面数量是“内容供给×组件容量×完整性要求”的结果。

### 12.3 对 skill 和当前模块分别如何落实

- **skill native route**：在既有内容 mapping 中加入旁挂的 page_content_contract，而不是强制它执行 Default route。page_plan 保持原导出格式，只做页面来源映射；新增契约负责内容、比较轴、取舍和组件匹配。模板缺合适结构时允许合法重组/新组件，必要时明确提出改走 redesign；不得默默删掉内容来迁就原骨架。
- **PPT module**：修改 OUTLINE_SCHEMA、parseOutline 和 slidePlan 的持久化，再用组件档案/Render Contract 测量 compositionCandidates；全稿 critic 检查必讲链是否可见。保持已有 Syllabus 确认与生成步骤。
- **验收**：相同主题以不同语言、不同模板、不同页数运行，仍保留必讲链和比较轴；重复标题/术语不算新增信息；相近 fontsize 下能把内容组织到适合的区域；需要详细推导时不套 condensed 的页数目标。

## 13. 语义关系建模：从内容关系到构图，而不是从模板形状猜关系

### 13.1 Gamma 更有价值的关系表达

G2 中公式→变量→概念对照→模型相对性，G3 中模型→因子集→理论依据→局限，G9 中阶段→子步骤→检查/风险，是不同层次的信息关系。它们不必全部画成箭头；表格同列、正文邻接、分组和视线顺序也可承载关系。

建议在第 3.2 节六类定性拓扑之上，先保留内容图：`defined_by / constructed_from / compared_with / alternative_of / qualifies / explains / precedes / depends_on / belongs_to`，每条边有来源支持和方向。再把图投影到六类形状关系；只有需要几何才能表达时才画 topology。

| 输入关系 | 合适表现 | 本轮揭示的易错做法 |
|---|---|---|
| 并列定义/分类 | 对照卡或表格，类别数量来自来源 | 把8类塞进6槽，合并类别但标题仍写8类 |
| 理论模型的共同维度/分歧 | 比较表、时间轴加一致维度；并行理论保留并行 | 因名称相似而使用链环；把 FF5/q 画成完全相同或前后替代 |
| 公式构成/变量含义 | 式子、变量、条件相邻 | 用 β≠α 或5/4大字占主区域，却没有定义链/经济机制 |
| 可替代的组合表达 | 同轴比较，标明用途与约束 | M12 将四种表达放上编号竖向路线，容易暗示先后步骤；G7 同线图标也需语义审查 |
| 真正的研究工作流 | 阶段分组，保持真实步骤次序和阶段任务 | M16 压为三项而淡化9步；照着模板只有3槽去写内容 |
| 评分卡/分类 | 保留矩阵的类别与维度 | 以词汇仍出现为依据，声称被删除的表列关系已保留 |

G8 将市场差异与排序算例放在左右面板，说明空间上可合页，**不说明两者存在来源陈述的因果边**。一般化实现应允许 multi-panel coexistence，并用独立小标题保持边界；不能为了满足“一个主张”发明一条因果解释把两者硬连起来。

### 13.2 通用验收应检查关系类型

关系覆盖不能只检查两端词语是否都出现。应核验方向、比较轴、条件、序列和分类数：alternative 不得变 precedes；qualification 不得被删成无条件断言；related_to 不得被增强成 causation；“模型内异常”不变成“绝对错误”；同一术语作为输入和作为结果必须保留不同角色。

适用于各种 input：产品方案的互斥选项、组织层级、实验方法比较、政策条件、接口依赖、故障诊断都按此规则检查。结构复杂或关系不明确时保留文字/表格并报告，不补出看起来漂亮的闭环。

## 14. 媒体账本：Gamma 的优势是信息角色匹配，不能以 picture 数量替代

### 14.1 本次图片角色的实际清点

| 渲染上下文中人工复核的角色（使用次数） | ppt-master | Gamma |
|---|---:|---:|
| 模板风格照片 | 8 | 4 |
| 通用链环 motif | 3 | 0 |
| 条目/检查图标 | 21 | 17 |
| 引语背景 | 3 | 0 |
| 数学公式或行内数学 token 图片 | 0 | 13 |
| 卡片框图片 | 0 | 7 |
| 排序流程复合图图片 | 0 | 1 |

角色按图片缩略图及所在页面复核；白色图标在橙色载体上使用，独立缩略图显空白不等于图片破损。Gamma 的42个picture中包含13个数学对象、7个边框；不能称为42幅内容配图，也不能设每页≥4图片的指标。

master 的35次图片使用全部与其原模板图片字节一致，证明真实复用。Gamma 图片与这份 master 原模板 hash 不一致，但照片/色彩仍呈同类模板风格；**不相同的 hash 不能证明重新 AI 生成或没有复用模板**。其图片获取方式、模型、编码过程本轮未知。

更重要的语义区别是：master 的链环被用于定义、FF5/q、GRS，虽然视觉结构保留，却没有清晰说明三者各自的具体关系；Gamma 用来源数学对象、四概念区域、排序图等承载具体内容。master 原模板的橙色条带/引语块也跨多个主题重复，占据了稀疏页面的相当空间。

### 14.2 账本应约束什么

在第 3.4 节资源账本基础上增加：`semanticRole`、`boundUnitIds`、`relationIds`、`informationalPurpose`、`requiredVisibility`、`fallbackRepresentation`。区分四种责任：

1. **内容证据/结构**：表格、公式、流程和来源图，必须与数据、变量/条件/边绑定，不能被装饰照片替代。
2. **语义辅助**：图标、提示标记，需要正确匹配条目；图标可复用，但不会新增 claim 或补足深度。
3. **模板装饰/品牌**：照片、背景、条带可以维持风格；若挤占必讲内容而非用户 binding，应可缩小、移动或选择不同原型。
4. **受保护原生对象**：不支持重建的遮罩/foreign/媒体保持原子语义；明确能力和替换权限，不以通用截图冒充可编辑内容。

Gamma 样本的公式实际是 raster picture。模块要学习“公式与解释共同布局”的结果，继续使用自己的原生数学/可编辑表格能力；**不要为了模拟外观把公式转成图片**。Gamma 的三张 native table 是结构可编辑的正例，master 用形状绘表虽然视觉可读，不能等价拥有 cell/row/column 数据契约。

图像账本应测“内容对象保留＋角色绑定＋替换证据”，而不是追求照片守恒。例如 preserve 需要保留明确锁定资产；mapped 允许重组非 binding 装饰，但须记录处置，不把“减少照片、增加数学结构”判为媒体退化。

## 15. 分层修复：区分成品推断、既有实测和模块应实现的闭环

### 15.1 可以说什么，不能说什么

本次 Factor Zoo 只有最终 Gamma PPTX，无法证明它经历几轮 layout checking/polishing，也无法知道失败如何归因。因此不能声称“Gamma 内部已实现确定性的四层 repair agent”。

可以引用仓库已有、不同输入的 Gamma 实机记录作补充证据：

- `ppt-alpha-mining-layout-content-gamma-review-20261008.md` §19–20：Compiler 首稿第2页靠近底边、layout告警；单页 Agent 修复改变了文本组织/几何/shape数，其他9页这些字段相同；修复后有 Before/After 与 restore/continue。
- 同文 §27.5：Sample Size 生成有 writing/checking/polishing，实测 polish 删减若干页约1–4%字符。这不是所有输入的固定允许删减比例。
- `gamma-ai-editing-generation-queue-2026-09-29.md` §2–3：范围 chip、排队请求和单段落编辑的回执/比较；不能据此保证任意范围或实时中断都正确。

这些支持 **诊断可见、目标范围明确、局部改动、比较/恢复、生成后检查与轻量修订** 的产品特征。也有负面证据：Compiler 首次有告警仍可导出；修复把 √N 图片变成 sqrt(N) 文本，字号自述与实测不完全一致。模块的 gate 和变更证据应比这些观察更严格。

### 15.2 将本轮差距转成修复路由

| 检出问题 | 所属层 | 修复操作 | 重新验证 |
|---|---|---|---|
| 章节名都有，但关键机制/变量/限定条件缺失 | source/content | 返回缺失的来源 atoms；必要时重做 grouping；不补外部事实 | requiredUnits、条件与范围审查 |
| 页面只有短标签，源内容丰富 | plan/content | 增加来源中的不同解释链或合并相关稀疏页，按详细档保留推导 | 内容独立性、深度与重分配覆盖 |
| 互斥表达被画成顺序、8类挤成6类 | semantic/composition | 修 relation type 和组件数；换 comparison/table/collection | 边类型、数量、标签归属、读取顺序 |
| 通用装饰抢占信息区 | composition/media | 改原型、减少非 binding 装饰面积，重绑语义组件 | 必讲内容、保护资产、实际图层 |
| 同页多组件过满 | layout/text | 重排/列宽/段落→信息等价精简→必要拆页提议 | 字体、完整表列、变量/条件和实际渲染 |
| 新数字/引用来自 Gamma 示例或 agent 推测 | content/scope | 删除无依据事实，或通过获授权输入流程补来源 | 与当前 source hash 对应的事实支持 |
| 字体缺字/导出对象失真 | runtime/export | 修字体覆盖/导出契约，保留原稿内容 | 实际文件读回、glyph与视觉；不把环境失败当作内容不足 |

修复“稀疏”发生在规划/写作层；修复“过满”优先发生在构图/排版层。不能为过满删掉关键条件，也不能为稀疏拉大字号、循环同一主张或增加装饰图。

每次候选记录 ownerLayer、issue→operation、受影响 IDs、内容/关系/媒体 delta、before/after revision 和验收证据。无进展停止；修复出新 hard issue 回滚；人工已接受页面、锁定页数和来源边界继续生效。UI 对范围/变化的反馈可在现有局部 AI 编辑面板完成，不新增创建步骤。

## 16. Gamma 标准中的取舍：吸收密度与深度，拦截遗漏和无来源扩展

### 16.1 本次明确发现的来源差异

| Gamma 内容/压缩 | 原输入核对 | 模块的处理 |
|---|---|---|
| G5：400+、约50% false discovery、Harvey/Liu/Zhu(2016)、t>3.0、Benjamini-Hochberg | 输入§5只有“数百”“高于t>2”及多重检验原则，没有上述具体数值/引用 | source_only 下不引入；不能把 Gamma 基准附件当作输入事实来源 |
| G10：US large-cap 1990–2020 | 原检查项为 reasonable horizons/universes，没有指定此时间窗 | 作为新增示例也需授权/标记，不能当原文事实 |
| G6 分类表删除 Typical controls 列 | 输入分类表每行有 controls | 完整性义务下保留；容量不足换布局/拆页，不静默删列 |
| G6 评分表删 mining concern 列和 Liquidity 行 | 来源评分卡7因子、3种解释/风险维度 | 需要保留该矩阵，或有明确可审阅的取舍 |
| G8 的2×3只列过程，未明示 HML 计算式 | 原§11有完整 HML式；master M15保留 | 要求算例时保留公式与变量；不能用“Compute HML”标签声称完成 |
| G3 的模型概览代替理论展开 | 源输入有CAPM/FF5/q推导与q5/SY机制 | 标准档可披露压缩；详细档保留关键机制，必要多页/附录 |

这里判断的是“输入支持不足”，没有验证这些外部学术数字本身真伪。本轮不通过联网补证据改变比较的 input 条件。

master 也有明显压缩：定义倾向仅把因子说成收益序列；M11 合并类别并省略 CFO/P、QMJ 等信号；q5/SY仅标签；最后检查压缩为一句。这些不能因 native 结构/导出通过而忽略。

因此正确目标是 **Gamma 水平的可见组织＋输入支持的机制深度＋更严格的来源与结构保留**。主张、解释、限定条件和对照关系来自不同 source atoms；字符量只作观测，不作强制填充指标。不能靠复制 Gamma 的新数字、删表列或缩字来获得“密度达标”。

### 16.2 通用评价方法

- 覆盖按 source atoms / 表行列 / 公式变量条件 / 流程边计算，不按 heading 命中计算。
- 深度按所选 claim 的解释链完整性审查：为何、如何、成立条件、区别/后果是否在来源要求下可见；不数关键词或机械要求每页几条机制。
- 密度按角色、用途、语言、组件类型及实际布局测量；本样本约11pt正文适合文档式细读，不能直接成为投影模板默认字号。
- 多页完整详细讲解与少页 condensed 概览分层比较。逐页同题对照之外，要检查全稿 coverage，防止“页少且密”是遗漏造成的。
- 除 content/export/rendered visibility 状态外，单列 semantic-depth/relationship/visual 的已评估与未评估范围；任何 reviewer 自述都不能替代最终对象。

## 17. 对原实施建议的具体补强及优先级

本节是建议施工，不表示已修改 PPT module 的 prompt/code。

| 优先级 | 改进点 | 具体代码/Prompt 部分 | 通用验收 |
|---|---|---|---|
| P0 | 补齐语义内容与解释链门禁 | `ppt-content-inventory.mjs` / `ppt-obligations.mjs` 为关键不同内容建立义务；`ppt-prompt-contracts.mjs` 的 planner/writer/critic明确链和压缩决策；`ppt-content-qa.mjs` / `ppt-quality.mjs` 联合审查 | 有章节但无机制不能算详细通过；无依据数字/引用阻断；关键表列与流程边不丢 |
| P0 | 关系类型不能因模板变化 | inventory/semantic→OUTLINE_SCHEMA/parseOutline/slidePlan→布局；`ppt-density-capacity.mjs`、`ppt-source-artifacts.mjs` 按 typed relation 绑定 | alternatives/因果/条件/顺序负例均被识别；类别数不受模板固定槽影响 |
| P0 | 修复候选及实际渲染复验 | `ppt-quality.mjs`、编辑proposal/apply、`ppt-api.mjs` 发布节点、export-integrity；接第3.5–3.6节 | 新问题回滚、旧review失效、字体缺字不被当作内容通过；用户锁定内容不被静默改动 |
| P1 | 内容供给和复合页面联合估算 | `ppt-planning.mjs`、`ppt-density-packing.mjs`；Phase3的 contentSupply；不以模板页数/heading作下限 | 中文/英文/双语和自动/手动页数正确；合页不重复，不丢输入尾部；详细档保留更多不同机制 |
| P1 | 媒体角色与模板骨架解绑 | `ppt-template*.mjs` 档案与受控适配；`ppt-semantic-media.mjs`、source-artifacts/object-integrity/dispositions；Phase2 | 允许以合法数学/表/步骤替代非 binding 通用装饰；来源证据/品牌与处置记录可靠 |
| P1 | 多组件、可变槽位与表达 texture | `ppt-layout.mjs`、point-layout、RenderTree、Render Contract、PptCanvas、exporters；Phase4 | formula+variables、dual-table、comparison+conditions等共用同一渲染契约；不强制保留少槽位造成稀疏/损失 |
| P1 | 建立同题与全稿 Gamma 参照测量 | `scripts/ppt-balance/` 加解释链/关系/表列/媒体角色验收，与原Gamma bands并存 | 分语言/用途比较；原始文本、图片数学、照片、native tables分口径；成品页数不是估算真值 |
| P2 | skill native route 的旁挂内容契约/回执 | 外部skill如要试验，新增内容mapping工件并与page_plan关联；模块只吸收其数据模型，不引入第二套SVG权威 | 后续同源实验证明增益；原生保护/最小重建与内容完整可以同时满足 |

实施先后：先把失真/遗漏和关系错误纳入可定位验收 → 模板组件与媒体角色档案 → 内容供给与复合页估算 → 组件原型与局部修复 → 真实模型矩阵。新建、模板、输入、估算、Syllabus、生成、局部编辑的用户步骤保持现状；增加契约与证据发生在现有步骤内部。

下一轮矩阵除这份 Factor Zoo 外，还应包括：短业务输入、长机制教程、只有表格的CSV/XLSX、纯中文/纯英文/双语、互斥方案、分支流程、带来源证据图的报告。每类覆盖两个以上不同结构模板，检查默认估算、手动较少页和较多页。真实模型结果与模拟/确定性fixture分别报告；不以本次16→10写死所有输入的压缩比例。

本轮对第1节结论的补强是：skill 的 vocabulary 和流程约束值得参考，但必须把它们变成可执行的内容/关系/组件契约。**Gamma 成品更强的部分在于让不同信息共同承担页面任务；页面检查和打包成功无法替代这项能力。** 四个支柱需要共同实现，单独增加 Page job 字段、图片清单或更多hard rules，不会自动产生这份 Gamma 的组织效果。

## 18. 复查补充（2026-10-09，第二轮）

本节对第 10–17 节逐项复查。方法：用 `apps/cowork-server/scripts/ppt-balance/pptx-inspect.mjs` 重新读取两份成品与原模板的 OOXML，并回查输入原文。结论：第 10–17 节的事实性陈述均可复现，但有以下遗漏与需要限定之处。

### 18.1 已复核无误的陈述

| 陈述 | 复核结果 |
|---|---|
| Gamma 10 页、42 个 picture、3 个原生表格；master 16 页、35 个 picture、0 个原生表格 | 一致：G6 为 9×2 分类表与 7×3 评分表，G10 为 9×4 模型表 |
| G6 分类表删除 Typical controls 列；评分表删除 Data-mining concern 列和 Liquidity 行 | 一致：来源分类表为 8 行 × 3 列（含 controls），评分表为 7 行 × 4 列（含 Liquidity 与 Data-mining concern） |
| G5 的 400+、2016、Benjamini-Hochberg、t>3.0 不在输入中 | 一致：输入只有“数百 / hundreds”，没有这些数字与引用 |
| G10 的 “US large-cap 1990–2020” 不是来源设定的检查窗口 | 一致：来源中的 1990 只出现在 “CAPM was tested … in the 1970s–1990s” |
| `replaceTemplateSourceRegion` 跳过 protected 资产及 image/chart/table（第 2 节末） | 一致（`ppt-source-artifacts.mjs` 第 26 行）。`ppt-general-content-media-balance.md` 根因表中“与区域重叠 ≥35% 的图片……一律退役”的旧描述已同步修正 |

### 18.2 遗漏一：两份成品使用同一模板的版式与字号阶梯，Gamma 在密集页按比例缩放整页

每页文字的字号集合可以对应到模板页：

| Process Improvement 模板页 | 字号阶梯（pt） | Gamma 使用 | master 使用 |
|---|---|---|---|
| 1 封面 | 44.5 / 13 / 10 | G1 | M1 |
| 2 大字页 | 65 / 32.5 / 16 / 13 / 10 | G5（整体 ×0.90：58.5 / 29 / 14.5 / 11.5 / 9） | M2、M6、M7 |
| 3 四卡 | 27.5 / 16.5 / 11 / 8.5 | G4、G6、G7 | M5、M11 |
| 4 时间线 | 26 / 15.5 / 10 / 8 | G9 | M4 |
| 7 三栏 + 图 | 29 / 17.5 / 14.5 / 11.5 / 9 | G8；G10（整体 ×0.83：24 / 12 / 9.5 / 7.5） | M8–M10、M14、M16 |
| 8 链环 | 30.5 / 18.5 / 12 | G2（副标题降为 15）、G3 | M3、M12、M15 |

据此可以补充三点：

1. **两份成品都基于同一模板的版式体系。** 第 14.1 节说图片 hash 不同不能证明是否复用模板；字号阶梯则能证明 Gamma 也复用了该模板的文字层级。差别不在于有没有模板，而在于每页如何把内容组织进模板版式。
2. **Gamma 的密度有一小部分来自“整页比例缩放”。** 10 页中有 2 页（G5 ×0.90、G10 ×0.83）整体缩放，层级比例保持不变（标题 / 小标题 / 正文 / 注释同比缩小）。这与第 27 节观测到的 Gamma Page setup “Scale content to fit / Minimum text size” 语义一致。第 10.2 节“密度差异主要不来自大幅缩字”仍然成立（8/10 页未缩放），但页面契约应把**有下限的整页比例缩放**列为重排之后、拆页之前的合法手段：保持层级比例，记录缩放系数，不突破角色最小可读字号。不应逐个文本框各自缩字。
3. **版式必须与内容类型匹配。** 模板第 2 页是“大数字 + 说明”。master 把它用了 3 次，承载 “β ≠ α”“5 / 4”“GRS” 这类并非数量的标签，主区域被大字占据而缺少解释。Gamma 只用 1 次，承载数量 “400+”，但这个数量本身无来源（见 18.1）。通用规则应为：大数字原型只能绑定一个来源中存在的数值事实及其口径；没有合格数值时选择其他原型，不能为了沿用模板页而造数或放标签。

### 18.3 遗漏二：G10 模型表也有列压缩

来源 §13 的模型表为 8 行 × 5 列（Model / Year / Factors / # / Theoretical grounding）。G10 为 `Model / Year / Factors # / Grounding`：把因子名称列与数量列合并成只剩数量（如 CAPM 一行为 `1`），因子名称（MKT、SMB、HML…）不可见。应加入第 16.1 节的取舍清单：在完整性义务下，因子名称列需要保留；容量不足时换布局或拆页，不能合并成计数。

### 18.4 遗漏三：语言策略不同，密度比较需要按单语等价口径

Gamma 成品是“英文标题 + 中文标题”双语标题、英文正文，中文只出现在标题、表头与少量标签（PDF 中文字符 335）。master 以中文为主（2,360）。当前模块的已定策略是**输出语言与输入一致**：平行双语输入的两种语言都保留，配对算一条内容，两种语言分别占版面（`ppt-general-content-media-balance.md` 决策日志）。

因此模块与 Gamma 的密度和页数比较必须使用单语等价口径，否则会把“保留第二语言”误判为“稀疏或页数过多”。模块对同一输入的当前估算：

| 口径 | standard | detailed |
|---|---:|---:|
| 双语全保留 | 34 页 | 39 页 |
| 单语等价（启发式去除中文平行段） | 25 页 | 29 页 |
| Gamma 成品 | 10 页（condensed） | — |
| master 成品 | 16 页 | — |

单语等价 25 页与 Gamma 10 页的差距，主要来自章节分配：§2 模型谱系分到 10.3 页（双语 14.5 页），而 Gamma 只用 1 页、master 用 4 页。这正是页面契约中 grouping 与复合页面要解决的问题，详见 18.6。

### 18.5 遗漏四：本模块在同一输入 / 模板上的基线

第 10–17 节比较的是 master 与 Gamma。用 balance harness 对本模块已有产物做同口径测量（模拟 LLM，只说明结构与流水线，不代表写作质量）：

| 指标 | 模块 22 页（模拟，Process Improvement） | Gamma 10 页 |
|---|---:|---:|
| 正文可见单位，P50 | 260 | 659 |
| 正文可见单位，P10–P90 | 200–358 | 542–766 |
| 相对模板的媒体守恒比 C | 0.96 | 1.99 |
| 连续纯文字页最长 | 1 | 0 |
| 原生表格 | 0（来源表格被写成文字） | 3 |

另一次 codex 的同输入运行被脚本强制为 mapped 模式：自动估算 34 页、打包后 29 页、20 项正文容量错误，最终未导出（`outputs/factor-zoo-process-proposal-simulated-20261008/run-report.md`）。所以模块的问题与 master 相近：页面稀疏、页数偏多。成因一是章节内按字节比例分配；二是组件词汇只有单栏 / 双等宽栏，无法形成 Gamma 式复合页面。

### 18.6 对四个支柱的补充要求（并入实施计划）

| 支柱 | 本轮补充的可执行要求 |
|---|---|
| 页面设计契约 | 原型须与内容类型匹配（大数字只绑定来源数值）；有下限的整页比例缩放列为合法 fit 手段并记录系数；契约中的 requiredUnits / adjacencyPairs 须在同一页可见 |
| 语义关系 | 至少识别：表格矩阵（行类别数、列轴）、有序流程、条件分支、互斥 / 可替代表达（如 §8 “expressed several ways … not interchangeable”）、公式与变量解释的邻接；可替代表达不得画成顺序步骤，矩阵不得合并或删减列 |
| 媒体账本 | 按角色（证据 / 结构、语义辅助、模板装饰、受保护）记录模板与来源媒体的保留、替换、退役及理由；统计相对模板的角色密度与连续纯文字页；mapped 模式缺少模板媒体档案时明确记为“未建档”，不记为通过 |
| 分层修复 | 每个 issue 标注所属层与允许操作；只有内容层问题进入文案重写；主题 token 被绑定时不得在修复中静默改色；修复后若出现新的硬错误则回滚 |

实施计划与执行记录见 [`docs/exec-plans/active/ppt-page-contract-relations-media-repair.md`](../exec-plans/active/ppt-page-contract-relations-media-repair.md)。
