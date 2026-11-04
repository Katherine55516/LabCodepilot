# Factor Zoo：重复内容、媒体丢失与 Gamma 密度对照审计

日期：2026-10-07（America/New_York）。范围：当前 PPT 模块源码、提示词、指定成品、该成品的模拟运行脚本与报告，以及附件 Gamma PPTX。本文提出修复方案，**本轮没有修改产品代码、重生成交付稿或提交 Git**。

## 1. 结论与最高优先级

指定 AIMate 成品确实存在严重的重复与结构/媒体缺失，不能将其视为已达到 Gamma 内容质量的成功样例。

- **P0-A：消除重复内容及修复后重复回流。** AIMate 21 页的原生文本共 7,995 个非空白字符，其中同页完全重复段落的额外字符为 2,582，约 **32.30%**；15 页存在至少 40 字符的完全重复段落。Gamma 同口径为 0。问题同时来自模拟 writer 的重复生成、标题/副标题/正文/结论之间缺少统一去重，以及产品 `repairProject()` 重新插入已被删除的重复 takeaway。最后一项已用当前代码独立复现。
- **P0-B：恢复来源结构与必要媒体的完整链路。** AIMate 成品有 **0 图片、0 原生表格、0 原生图表**；Gamma 有 **42 个直接图片实例、3 张原生表格**。本例不只是缺装饰：公式及变量、表格关系、流程和清单大量退化为标题或短句。模板本身的 24 个直接图片实例也全部没有进入成品。
- **P0-C：使前两项成为真实的交付门禁，并恢复可信的运行基线。** 运行报告已有 76 条警告、结构保留率代理指标为 0，却仍给出 `completed`、`publishEligible:true`、`editorialReady:true`。模拟 reviewer 恒定返回空问题，不能证明整稿通过。模拟脚本还把自动估算结果改为显式页数、切换 mapped 模式、增加导出后改色；因此该文件不能证明“完全按生产自动工作流运行且质量合格”。

以上三项先于继续调页数、增添装饰或微调 Gamma 密度参数。**减少页数不会自动恢复信息，增加字数也可能只增加重复。** 应先恢复唯一信息和来源组件，再评估相同信息量在模板中的页数与排布。

当前代码已经包含单份 `contentBlocks`、来源结构组合、模板容量拟合、可见节点 QA、问题驱动 packing 等设计，不能笼统归因为“没有相关功能”。本次缺口主要是：模拟实现违反契约、某些阶段不共享契约、必需内容缺失只告警、最终文件未进入闭环验证。

## 2. 输入、证据与统计边界

### 2.1 文件与可复核证据

| 对象 | 路径 / 标识 |
|---|---|
| 来源 | `/Users/dongli/Documents/quant_research/quant_3.0/04_factor_zoo_overview.md` |
| AIMate 成品 | [factor-zoo-mood-board.pptx](../../outputs/factor-zoo-mood-board-simulated-20261007/factor-zoo-mood-board.pptx) |
| 实际运行脚本 | [run-factor-zoo-workflow.mjs](../../outputs/factor-zoo-mood-board-simulated-20261007/run-factor-zoo-workflow.mjs) |
| 实际运行报告 | [workflow-report.json](../../outputs/factor-zoo-mood-board-simulated-20261007/workflow-report.json) |
| Gamma 成品 | `/Users/dongli/Downloads/The-Factor-Zoo (1).pptx` |
| Mood Board 模板 | `/Users/dongli/Downloads/Copy-of-Mood-Board.pptx` |
| 密度交接依据 | [ppt-gamma-density-packing.md](../handover/ppt-gamma-density-packing.md) |
| 本次 OOXML 审计 | [pptx-audit.json](../../outputs/ppt-mood-board-gamma-review-20261007/pptx-audit.json)；[提取脚本](../../outputs/ppt-mood-board-gamma-review-20261007/audit_pptx.py) |
| 逐页文本 | [AIMate](../../outputs/ppt-mood-board-gamma-review-20261007/aimate-slide-text.txt)；[Gamma](../../outputs/ppt-mood-board-gamma-review-20261007/gamma-slide-text.txt)；[模板](../../outputs/ppt-mood-board-gamma-review-20261007/template-slide-text.txt) |
| 视觉证据 | [AIMate 全稿概览](../../outputs/ppt-mood-board-gamma-review-20261007/aimate-render/contact-sheet.jpg)；[Gamma 全稿概览](../../outputs/ppt-mood-board-gamma-review-20261007/gamma-render/contact-sheet.jpg)；[Gamma 媒体清单图](../../outputs/ppt-mood-board-gamma-review-20261007/gamma-media-contact.jpg)；[模板媒体清单图](../../outputs/ppt-mood-board-gamma-review-20261007/template-media-contact.jpg) |
| 当前文件重新渲染 | [AIMate PDF](../../outputs/ppt-mood-board-gamma-review-20261007/aimate-render/factor-zoo-mood-board.pdf)；[Gamma PDF](<../../outputs/ppt-mood-board-gamma-review-20261007/gamma-render/The-Factor-Zoo (1).pdf>)；同目录逐页 PNG |
| 产品缺陷最小复现 | [reproduce-takeaway.mjs](../../outputs/ppt-mood-board-gamma-review-20261007/reproduce-takeaway.mjs)；[结果 JSON](../../outputs/ppt-mood-board-gamma-review-20261007/takeaway-reproduction.json) |

SHA-256 用于冻结比较对象：

```text
source  ebacfacedb6138ccb30f6b6af2b7b23a74574c741d348105aa5a2b2dba4fee16
AIMate  23dbbdc7987dd77621d2c7d0f5946e5e1c8440d2f1cc6f100d4b6cf37deb1b97
Gamma  c8be44407f0e757e8958c314b076143bc220566feacbea1dea7ddfe34b41ec49
Mood   d510e66a5f67502b3139651243092358b236e9ba150e90bf8d2d2385dd9f5eb3
```

来源当前哈希与运行报告一致；Gamma 哈希与模块冻结密度 profile 一致。本次重新用 LibreOffice 渲染两份成品并检查逐页概览及重点页面，不依赖上一轮“已检查”的结论。没有调用真实 LLM，也没有在桌面 Microsoft PowerPoint 中打开验收。

### 2.2 统计口径

1. 文本为 OOXML 中的原生文本框段落和表格单元格，移除空白；包含标题、页脚等，不含图片中的文字，未做 OCR。Gamma 将部分公式做成图片，因此其实际可见信息多于这里的原生字符数。
2. 同页重复：段落经 NFKC、大小写和空白归一后完全相等，长度至少 12；多出的实例计入额外字符。长重复阈值为 40。不是语义相似度，也没有把中英翻译视为重复。
3. 重复额外字符采用归一化段落长度、总字数采用非空白原文长度，32.30% 是近似比率。不是“32.30% 的事实错误”或“只保留了 67.70% 的来源”。
4. 图片实例为 slide XML 的直接 `p:pic`；不含继承的 master 图片。ZIP 的 `ppt/media` 资源数包括共享、回退或未使用资源，不能等同于页面图片数。形状、原生表格和文本不会算作图片。
5. 正文页字符分位排除封面，使用线性插值。本次 Gamma Q1/Q3 为 917/1,094；交接文档的 909.5/1,097.5 使用不同分位口径，中位数均为 1,019。不能将这个小差异当成参考文件变化。
6. 运行报告的 recall 指标是现有算法的词面/结构代理值，不是人工逐事实召回率，也不适合用来断言 Gamma 有多少事实更正确。

## 3. 全稿量化比较

| 维度 | AIMate 指定成品 | Gamma 参考 | Mood Board 模板 |
|---|---:|---:|---:|
| 页数 | 21 | 10 | 8 |
| 页面比例 | 16:9 | 约 16:9 | 约 16:9 |
| 页面尺寸 EMU | 12,192,000 × 6,858,000 | 12,191,695 × 6,858,000 | 12,191,695 × 6,858,000 |
| 原生非空白字符总量 | 7,995 | 9,359 | 4,925 |
| 正文页字符总量 | 7,938 / 20 页 | 9,109 / 9 页 | 不作内容基准 |
| 正文页中位数 | 396.5 | 1,019 | — |
| 正文页 Q1–Q3 | 313.5–474.5 | 917–1,094 | — |
| 正文页最小–最大 | 154–663 | 802–1,196 | — |
| 同页精确重复额外字符 | 2,582 | 0 | 0 |
| 存在长精确重复的页数 | 15 | 0 | 0 |
| 直接图片实例 | 0 | 42 | 24 |
| ZIP 媒体资源 | 0 | 48 | 32 |
| 原生表格 | 0 | 3 | 0 |
| 原生图表 | 0 | 0 | 0 |

AIMate 的正文页中位文本负载仅为 Gamma 的约 **38.91%**，而其中还包含大量重复。AIMate 有更多页却更少总文本、没有图片和原生表格，说明“21 页看起来较长”没有转化为内容完整性。两个文件均采用宽屏比例，305 EMU 的宽度差不构成本轮重复和媒体丢失的原因。

逐页完全去重后，AIMate 原生字符约剩 5,413；这只是重复诊断，不代表完整信息量。不能简单除以 Gamma 每页字符数得到应该生成的页数，因为两者语言比例、公式图片、字号、叙述范围及来源保留要求不同。

### 3.1 Gamma 的 42 张图片究竟是什么

| 类别 | 实例数 | 功能 |
|---|---:|---|
| 公式与数学符号位图 | 13 | 第 2 页 7 个、第 3 页 3 个、第 4 页 3 个；包括主公式及单独变量 |
| 财经/城市装饰照片 | 4 | 第 1、4、7、9 页的主题图或侧栏 |
| 图标 | 17 | 第 3 页 5 个、第 7 页 4 个、第 10 页 8 个箭头 |
| 卡片/面板背景 | 7 | 第 5 页 4 个、第 8 页 3 个 |
| 2×3 分组流程图 | 1 | 第 8 页，四阶段图示 |

因此不应提出“每稿补足 42 张 AI 图片”。需要优先恢复的是**承担表达功能的公式、表格、流程、对比关系**；照片与图标是次级的主题表达。原生表格有 3 张，但原生图表为 0，Gamma 的优势也不是使用了更多可编辑数据图表。

原始 Markdown 中有公式和结构化内容，未据此发现可称为“输入照片”的资产。应区分三类：来源信息结构丢失、模板视觉资产未被沿用、未生成适合新内容的图示。这三者不能统一叫作导出丢图。

## 4. 逐页对照：Gamma 值得吸收什么

### 4.1 Gamma 10 页的组织方式

| 页 | 原生字符 / 图片 / 表格 | 内容与呈现 | AIMate 应吸收的设计 |
|---|---|---|---|
| 1 | 250 / 1 / 0 | 主题、课程定位、简介、财经照片 | 封面说明读者将学会什么，保持主题辨识度 |
| 2 | 1,094 / 7 / 0 | 因子公式与变量释义；characteristic/factor/anomaly/alpha 四类概念；解释模型相对性 | 定义、关系、适用边界同页成立，公式紧邻解释 |
| 3 | 1,019 / 8 / 0 | CAPM、APT、FF3、Carhart、FF5/q 五列理论谱系；公式、构造、局限并排 | 以比较问题组织多个模型，不能只把章节标题变成独立页 |
| 4 | 1,082 / 4 / 0 | GRS/时序检验、风险与错误定价；三个编号内容区+侧图 | 检验对象、解释机制、失败条件共同构成可理解的单元 |
| 5 | 1,196 / 4 / 0 | 因子动物园问题；大数字与冗余、挖掘、多重检验、最低门槛四个面板 | 层级清晰的论点—解释—行动；引用事实仍需独立核对 |
| 6 | 902 / 0 / 2 | 8 类因子×2 列 taxonomy；6 行×3 列风险/行为解释 scorecard；页底判断 | 关系数据放表格，保留行列比较能力，不改成几句泛称 |
| 7 | 917 / 5 / 0 | 三种构造风格及 timing/crowding，配交易权衡与图标 | 机制、优缺点、应用限制在同一阅读路径中完成 |
| 8 | 996 / 4 / 0 | US/A-share 三类差异+2×3 四阶段流程 | 并排放“市场边界”和“构造步骤”；图示必须与事实对应 |
| 9 | 802 / 1 / 0 | 九步策略流程，归组为四阶段；含动作、检验与产出 | 保留全流程，减少重复导航，避免最后半稿被压成标题 |
| 10 | 1,101 / 8 / 1 | 八项检查清单+八模型四列表格+收束判断 | 总结应帮助比较和使用知识，不能只重复“Summary” |

这份 Gamma 样例的密度来自关系组织、结构化组件和每区的具体解释。即使某页照片占较大面积，正文仍有完整表达链路。AIMate 当前的多个卡片重复相同小标题和同一句话，视觉上占满区域但信息量很低。

### 4.2 AIMate 21 页逐页问题

下表“重复”指同页精确重复额外字符；“0”不等于没有语义重复或内容缺失。

| 页 | 字符 / 重复 | 当前问题 | 建议处理 |
|---|---:|---|---|
| 1 | 57 / 0 | 简短封面，模板主题图未保留 | 按资产角色保留或替换主题图；不强行增加封面字数 |
| 2 | 352 / 113 | 来源总标题反复成为正文和卡片标题；目录导航消耗页面 | 将重复导航收束为一次，改成具体学习目标或与定义页合理合并 |
| 3 | 398 / 251 | 定义页出现同一判断三次；变量被移除后句子失去数学对象 | 重建公式+变量+四概念；保留判断一次，并增加与判断不同的解释 |
| 4 | 291 / 126 | “Risk Factors vs.” 残缺标题；大标题/卡片反复重复 | 完整呈现风险/错误定价机制、观察证据和边界 |
| 5 | 430 / 194 | CAPM 与推导标题占大量正文；理论谱系信息不足 | 一条主结论带公式、假设、解释；细推导按用户深度另作规划 |
| 6 | 457 / 86 | 推导页失去变量；出现“the -th row”“dividing by”等不完整语句 | 数学对象不可被清洗，检查变量依赖与推导连续性 |
| 7 | 515 / 229 | 标题仍是 CAPM 推导，正文转到 flat SML/size；副标题、正文、takeaway重复 | 按新的问题重拟标题；异象与模型预测构成真正对照 |
| 8 | 464 / 81 | CAPM 推导标题下混入 APT；“where is the risk premium…”重复且少变量 | 理论比较或独立完整 APT 单元，禁止跨主题机械拼接 |
| 9 | 550 / 207 | FF3 同名标题反复出现，构造描述重复，无实际公式/表格 | 市场、SMB、HML 的定义与构造，以公式和分组结构表达 |
| 10 | 353 / 152 | Carhart 页提前出现 FF5 标题，重复与边界混乱 | 说明动量因子新增了什么，比较应有明确关系标签 |
| 11 | 417 / 168 | FF5/CMA 文字重复、细节短缺 | 补充来源支持的盈利/投资构造和解释，不拷贝前页标题 |
| 12 | 395 / 140 | q 模型题头重复 | 用投资/盈利等关系组织，明确与 FF 模型的异同 |
| 13 | 513 / 176 | q5 说明又成为 takeaway | 区分新增因子、机制与启示；同一句说明只显示一次 |
| 14 | 663 / 258 | SY 内容多但截断，长说明作为结论重复 | 原句完整性、组别及构造关系优先于卡片数和字数目标 |
| 15 | 290 / 84 | “Time-Series vs.” 标题残缺；检验和风险溢价主要是章节名 | 保留检验对象、零假设/解释、使用方式和局限 |
| 16 | 262 / 105 | 风险溢价与动物园问题混排，只有概括和标题 | 以机制和研究筛选问题组织，避免无来源具体数字 |
| 17 | 229 / 0 | “Risk vs.”；taxonomy、构造风格只剩标题，无表格 | 恢复 taxonomy 和 scorecard 的行列关系及关键说明 |
| 18 | 378 / 78 | crowding、市场差异与 checklist 一项混排 | 清理 topic ownership，将拥挤/交易成本的因果链讲完整 |
| 19 | 506 / 30 | 美国/A股、12股样例与策略步骤拥挤，示例只有标题，无计算结构 | 保留 worked example 的分组/计算和市场适用条件，必要时按完整任务拆分 |
| 20 | 321 / 92 | checklist 和 Summary 标题重复，出现“--”，检查项不全 | 显式核验清单基数、总结表结构；清理解析分隔符 |
| 21 | 154 / 12 | 泛化收尾、Source detail 标题，不形成可用总结 | 用不同于正文的判断或使用规则收束，并追踪来源 |

### 4.3 不应照搬 Gamma 的部分

- Gamma 采用英文主体+部分双语标签，不等于完整双语逐段讲义。它没有完整展开 CAPM 推导及所有 q5/SY 细节，也没有保留来源中每个表格的全部列。因此 **10 页不是这份完整双语来源的强制答案**。
- Gamma 第 5 页的“400+”、约 50% FDR、Harvey/Liu/Zhu 2016、Benjamini–Hochberg，以及第 9 页的 t>3.0，在所给原始 Markdown 的针对性检索中未找到对应文本。它们可作为“参考稿新增信息”登记，不能无来源移入 AIMate。这里未做外部文献正确性鉴定。
- Gamma 第 8 页在 US/A-share 混合语境下写“Always use NYSE breakpoints”；采用时需要保留美国 Fama–French 构造的适用范围，不能扩大成全部市场的规则。
- 公式图片能够保证视觉表达，但不等于原生可编辑公式；本次看到的公式为位图。AIMate 可以先实现可靠公式显示，再逐步提升编辑能力，不能宣称直接达到 OMML 编辑保真。
- 两稿在本机 LibreOffice 渲染均存在部分中文缺字/替代显示；字符在 OOXML 中仍可提取。该问题需要字体链路修复，不能把所有渲染缺字认定为生成时丢内容，也不能把 Gamma 视为跨环境字体完全通过。

## 5. 根因一：模拟脚本没有履行既有生成契约

分析依据为当前输出目录的实际脚本与报告，而非假设所有问题由真实 LLM 产生。

| 位置 | 实际行为 | 对结果的影响 |
|---|---|---|
| 脚本 `promptText`、source import | 使用文件导入并加了一段人工构造的英文任务提示 | 与“整个 Markdown 作为 prompt”并非同一入口条件；来源相同但运行条件应如实标注 |
| `summaryFor()`、`plainSentences()`、`fit()` | 抽第一句/行、移除 TeX、按字符截断；过长可能回退为 topic heading；标点切分会伤及 `vs.` | 生成章节名而非知识点，数学对象消失，句子/标题不完整 |
| `distributeChunks()` | 按索引均分 60 chunks 到正文页槽位 | 章节跨度与读者问题无关，造成标题与正文错位、结尾覆盖不足 |
| `buildOutline()` | 主动排除 `EquationBlock`；support 数量受限 | 规划阶段就放弃公式，writer 不可能凭空恢复已排除的必需对象 |
| `allocateStructures()` | mapped/缺少 fidelity 时不分配来源结构；text fallback 截取部分句子；管道表格行被清洗 | 表格、流程、清单退化为片段，丢失行列和顺序；不是单纯导出少带资源 |
| `draftFor()` | section→eyebrow，focus→subtitle，topic→卡片 heading，末条要点→takeaway；还返回 bullets/factSynthesis | 多个角色重复同一内容；违背 writer 已有的单份文案要求 |
| `modelCall()` reviewer | 固定返回 `missing/repeated/conflicts/unsupported: []` | review hash 有效只证明当前版本被“看过”，不证明有真实审查 |
| repair 模拟响应 | 重写基本仍返回同一 draft，不依据问题修订 | 调用次数不等于修复次数；可出现无进展循环 |
| create 参数 | `templateMode:'mapped'`，`pages:parsedRecommendation.recommended` | 自动估算 21 被改成 explicit 21；自动候选 packing/fit 的拒绝条件不再是同一路径 |
| 导出依赖覆写 | 修改 palette/render tree 文本颜色，再对导出 PPTX 改色；PDF 返回空字节占位 | 成品颜色不是标准模块输出，质量报告与最终文件可能不一致，PDF 接口未真实验收 |
| 模拟 native 导出分支 | 自组 payload 只传 `nodes.filter(nativeRef)`，没有传生产 adapter 的 `sourceArtifacts` | 即使 IR 新增来源表格/公式节点，也可能在该模拟分支不被导出；本次最终稿为 mapped，所以这是额外的代码路径风险，不能当作已观测到的 native 丢失运行 |

报告的 `decisionNote` 明确写明：把推荐页数作为显式选择传入，以绕过 automatic layout rejection；`pageDecision` 为 `source:user`、`mode:explicit`、`fitValidated:false`。所以“页数取了模块推荐值”成立，但“验证了模块完整自动估算/拟合/打包路径”不成立。

已保存的失败调试和容量矩阵可用于定位某次 native candidate 的拟合失败；但不能由此推论“该模板在所有正确规划下都无法保留来源结构”。尤其最终成功稿切换了模式，而完整失败运行快照不齐，无法将两者直接当作同配置 A/B。

生产 [ppt/import-pptx.mjs](../../apps/cowork-server/lib/ppt/import-pptx.mjs) 的 adapter（约 401 行）会把 `isSourceOwnedNode` 选出的节点传入 `sourceArtifacts`，Python exporter（约 299 行）会新增对应 shape。模拟脚本直接调用内部 `EXPORT_SCRIPT` 却漏传该字段，说明“调用了生产 Python 脚本”仍不等于“使用了完整生产导出工作流”。后续 runner 应调用正式 wrapper，或逐字段校验依赖 adapter 与生产一致，禁止自行维护第二套不完整 payload。

**修复模拟基线的方法：** 只替代 `modelCall` 的结构化响应；源解析、估算、pageDecision、模板模式、渲染、导出和质量判定均走产品入口。模拟 writer/critic 必须消费真实输入和 repair findings；没有模拟的能力应标成 `not_evaluated`，不能返回“无问题”。禁止导出后补丁作为产品成功证据。每次 run 保存输入参数、版本、模式切换理由、模型请求/响应、每轮差异和最终文件 hash。

## 6. 根因二：跨角色重复和修复回流属于产品缺陷

### 6.1 已有防护及其盲区

[ppt-prompt-contracts.mjs](../../apps/cowork-server/lib/ppt-prompt-contracts.mjs) 的 writer 已明确普通正文只返回一份 `contentBlocks`，`bullets` 由系统派生，native 模式不要重复输出 factSynthesis。该要求应保留并由 schema/运行时执行，不能再增加一段泛泛的“避免重复”就视为解决。

[ppt-presentation-writing.mjs](../../apps/cowork-server/lib/ppt-presentation-writing.mjs) `materializeCopy()`（约 284–312 行）把 blocks 转为 bullets，并将 takeaway 与 title/subtitle/body/heading 做 overlap 检查，达到阈值便清空 takeaway。但是：

- 副标题和 eyebrow 没有同等的增量信息检查。
- 多个卡片 heading 可以全是同一章节标题；段落之间可语义同义但字符串不完全相同。
- `deterministicReview()` 在 [ppt-quality.mjs](../../apps/cowork-server/lib/ppt-quality.mjs) 主要对完整 `bullets` 做精确重复检测，跨字段、跨正文节点的重复覆盖不足。
- `repairProject()`（约 270–276 行）看到 detailed 页没有 takeaway，会直接取 `factSynthesis.implications[0]` 写回 copy 和节点，**没有调用前述去重逻辑**。

本次最小复现：同一句交易成本说明同时作为正文与 takeaway；`materializeCopy()` 正确把 takeaway 置空；`repairProject()` 又把它恢复；最终 `duplicateFindings:[]`。见[复现结果](../../outputs/ppt-mood-board-gamma-review-20261007/takeaway-reproduction.json)。这证明不是只有模拟内容不佳，后续产品修复本身也能制造重复。

### 6.2 不能误判为“双份数据必然被渲染两遍”

[ppt/ir.mjs](../../apps/cowork-server/lib/ppt/ir.mjs) 的规范节点和 [ppt/render-tree.mjs](../../apps/cowork-server/lib/ppt/render-tree.mjs) 通常仅渲染一份 body list；canonical 节点存在时不会把所有 legacy 字段再画一遍。因此本轮不是一般性的 `contentBlocks + bullets` 自动双渲染 bug。真正的路径是：相同语义进入不同可见角色，每个角色被合法渲染；repair 又增加一个合法但重复的节点。

### 6.3 推荐修法

1. 建立唯一的 `normalizeVisibleCopy()` / `validateVisibleClaims()`，writer、repair、局部 AI 编辑及 finalization 共用；避免不同阶段各自写副标题或 takeaway。
2. 原文原样重复且无独立功能时，确定性删除冗余展示；若用户已锁定内容，保留并显式报告，不偷偷改。对近义重复只提出重写目标，不依赖字符串阈值盲删。
3. 跨角色规则：eyebrow 只作导航；title 回答本页问题；subtitle 增补范围或主张；各卡片提供不同的证据/机制/例子；takeaway 仅在具有新的推论/行动价值时出现。可选字段可以为空。
4. 新增事实/主张 ownership，标明主讲页与允许的 recap。术语、共同表头、中英译文、跨页公式变量不是默认错误；允许复用时记录 `repeatPurpose`，并检查该次出现有新的比较/应用语境。
5. 把重复检测作用于最终可见节点，定位到 nodeId/role/sourceClaimId，而非只检查旧 draft。页内完整长句跨角色重复为阻断项；跨页语义重复结合主讲关系和 recap 标记处理。
6. 检查 repair 的幂等与单调性：修一次不会新增重复；修第二次结果稳定；必需信息集合不能减少。修复无进展时退出并返回待处理事项，不能仍宣布完成。

## 7. 根因三：来源组件和模板媒体没有统一的交付义务

### 7.1 来源结构在何处丢失

报告的原始来源并未在读取层整体截断：56,148 bytes、41,416 characters、218 segments、60 semantic chunks、182 inventory items。高保留义务的结构项共 29：18 个公式、5 张表、4 个流程、2 个清单；还有总结类内容需要覆盖。损失主要发生在模拟规划/写作和未阻断的结构降级中。

[ppt-source-artifacts.mjs](../../apps/cowork-server/lib/ppt-source-artifacts.mjs) 已支持来源结构和 commentary 的组合、表格分片与容量校验；mapped writer schema 也允许 `sourceArtifacts`。因此 **mapped 并不天然只能输出纯文本**。本例的脚本主动不分配结构对象，是零表格/零结构的直接原因之一。

[ppt-source-text.mjs](../../apps/cowork-server/lib/ppt-source-text.mjs) 有常见数学记号的文本适配，但不是完整 TeX/数学排版引擎。应区分产品记号支持不足与脚本把公式整段删除；不能把后者全归到产品转换器。

### 7.2 模板媒体在何处丢失

Mood Board 8 页含 24 个直接图片实例：11 个 JPEG 照片/艺术图实例、13 个 PNG 图标/面板/圆环等实例。最终文件 ZIP 内没有任何媒体，最直接原因是 mapped 输出并未复制原生模板页对象，writer 又没提供新媒体；不是发现了 PPTX 中资源存在但 relationship 断裂的证据。

生产 preserve 路径也有需要治理的独立风险，见 [ppt-template-fidelity.mjs](../../apps/cowork-server/lib/ppt-template-fidelity.mjs)：

- `sourceMediaFor()` 偏向尺寸至少 640×360、比例相近的 PNG/JPEG，适合照片替换，不适合小尺寸公式、图标或矢量组件的通用复用。
- `safeDecorativeMedia()` / `contentMediaCandidates()` 使用几何和语义启发式；`autoTemplateMediaOmissions()` 可省略低 affinity 的内容图。
- `reclaimedMediaTextFrames()` 可以把移除图片区让给文字；若没有替代表达义务，容易形成“清掉图片，剩文字卡”的结果。
- `bindTemplateFidelity()` 仅 preserve 模式执行，所以以上 omission 规则并非本次 mapped 成品丢失全部模板图片的直接原因。
- [ppt-api.mjs](../../apps/cowork-server/lib/ppt-api.mjs) 的 `applySourceImages()` 主要面向 `image-text` 且 blocks 较少的页面，不能作为多表、多卡、流程等所有布局的媒体路由器。
- [ppt-semantic-media.mjs](../../apps/cowork-server/lib/ppt-semantic-media.mjs) 根据 visualIntent 生成少数确定性图示；metric 要有同单位多值证据才生成。它不等同于任意来源结构都已建立图示表达，也不保证 mapped 全路径自动调用。

### 7.3 推荐引入对象义务账本

来源内容与模板资产分开登记，统一追踪到最终文件：

```text
source object / template asset
  → role + priority + preservation policy
  → owning slide(s) + representation + source selection
  → IR node(s) + evidence/asset references
  → visible render node(s)
  → exported shape/table/picture + payload verification
  → rendered visual inspection
```

每个对象只允许明确终态：`rendered`、`replaced_equivalent`、`excluded_approved`、`failed`；中间 `planned` 或“有 source ref”不能算作保留成功。这里是建议的新契约，不是声称当前已有这些字段。

| 对象 | 建议策略 | 不可接受的降级 |
|---|---|---|
| 来源公式 | 保留表达式、变量、条件；可靠 SVG/PNG 回退并携带 TeX/altText/来源；后续支持可编辑数学 | 删除公式只留“where/其中”；把部分变量变成空白 |
| 来源表格 | 优先原生表；分片保留全部列、表头及已计划行并集；记录对象/行/列 ID | 将整表改成一个主题名，或只保留第一列冒充关系完整 |
| 流程/架构 | 保留节点、顺序、分支、边与标签；图形或结构化列表均可，需表达等价 | 把多个步骤压成无顺序关键词；图示与来源关系无关 |
| 清单/总结 | 明确条目基数、各项条件、总结比较维度 | 只留下一个 checklist 条目或“Summary”标题 |
| 来源图片/图表 | 路由到合适布局；校验 image/asset 数据与关系 | 只因当前 layout 非 image-text 就静默忽略 |
| 模板装饰 | 保留风格、裁切、层级；可重复使用适合的新页对象 | 因小尺寸或低文本相似度统一删除 |
| 模板旧内容图 | 评估内容过时，替换为新内容等价表达并留审计 | 将模板旧数据图当新事实，或删完不提供任何表达 |

**P0-B 的边界是保留必要表达，不是盲目保留模板所有图片。** 对 Mood Board 中不适合量化教程的旧主题内容，可以替换；但应明确“保留什么视觉角色、用什么新的表达替代”，并让结果有可见、可验证的结构。

## 8. 根因四：质量报告检测到严重损失却没有阻断

运行报告记录：

| 诊断 | 数量/数值 | 意义 |
|---|---:|---|
| `source_structure_or_detail_missing` | 29 | 高优先级来源结构/细节存在缺失 |
| `source_end_section_missing` | 2 | 尾部内容覆盖不足 |
| `source_evidence_unrendered` | 7 | 已计划证据未充分可见 |
| `under_expanded` / `point_under_expanded` | 9 / 1 | 缺解释深度 |
| `visible_content_sparse` | 5 | 页面过薄 |
| `required_detail_not_visible` | 1 | 必需细节未可见 |
| `duplicate_title` | 3 | 多页同标题 |
| `gamma_density_underfill` | 19 | 大多数适用页显著低密度 |
| `structureRecall` / `relationshipRecall` | 0 / 0 | 结构及关系代理检查失败 |
| `topicRecall` / `highPriorityDetailRecall` | 约 14.84% / 9.68% | 内容覆盖代理明显偏低 |
| `equationRecall` / `workflowRecall` | 约 11.11% / 25% | 词面/结构混合代理，不能解释成实际有 2 个可见完整公式 |
| `checklistRecall` / `summaryRecall` | 0 / 0 | 清单与总结代理未通过 |
| `endSectionRecall` | 约 6.52% | 尾部信息明显不足 |

[ppt-content-inventory.mjs](../../apps/cowork-server/lib/ppt-content-inventory.mjs) 对高优先级 missing/structureRetained 等问题目前产生 warning，且部分为 `repairable:false`；[ppt-content-qa.mjs](../../apps/cowork-server/lib/ppt-content-qa.mjs) 存在 strict 和 locked evidence 的错误门禁，但覆盖规则不等于所有 `must_preserve` 结构必保留。

[ppt-prompt-contracts.mjs](../../apps/cowork-server/lib/ppt-prompt-contracts.mjs) 的 `criticRewriteTargets()` 给 repeated 的权重低于 unsupported/conflicts/missing，且最多选部分页面；对全稿系统性重复，需要先做确定性统一修复和整稿诊断，再有界重写，不能只挑少数页后默认其余已好。

[ppt-api.mjs](../../apps/cowork-server/lib/ppt-api.mjs) 生成流程在组装与有限修复后计算 quality，再调用导出；没有把“重新打开最终 PPTX 核对组件+实际渲染”作为这次 completed 的完整质量证据。运行脚本又在导出时覆写颜色，使 pre-export 审查更不能证明最终文件状态。

建议区分三个状态：文件技术上可导出、内容义务已满足、交付视觉已验收。未完成真实 critic 可标 `not_evaluated`；强制对象未渲染、跨角色长段完全重复、数学表达被破坏应阻断正常完成/发布。可另保留明确标识的诊断草稿下载能力。低于 Gamma 密度、装饰少或模型提出的非必需建议可继续为软警告，不应把全部 76 条警告一律升为错误。

## 9. 与密度交接设计对齐：哪些保留，哪些补齐

### 9.1 保留已经实现且正确的设计

- `sourceDensityPlan()` 从实际来源展示负载估算，不再使用章节数量作页数硬下限；standard/detailed 应映射解释深度和结构选择。
- 多个相关知识点可以围绕同一 reader question 同页，packing 保护不同问题、锁定标题、来源对象和 requiredSupport。
- 原生模板调度后用最终 geometry 拟合，保护标题/导航/页脚，表格范围合并取并集，SummaryBlock 也进入拟合。
- 字号有下限，不能靠无限缩字或删除结构追平页数；确认后不静默改页数。
- visibleNodes 是内容 QA 和 critic 的共享入口，隐藏/透明/省略对象不算保留。

### 9.2 本轮必须补齐的密度含义

[ppt-density-qa.mjs](../../apps/cowork-server/lib/ppt-density-qa.mjs) 已排除部分导航角色，但 subtitle/takeaway/正文中重复表达仍可能增加负载。应同时报告：

1. `rawVisibleUnits`：实际排版占用，重复文字也占位置，用于 fit。
2. `uniqueInformationUnits`：去除无功能重复后的信息量，用于内容密度判断。
3. `requiredObjectCoverage` / `relationshipCoverage`：必要公式、表格行列、流程边、条件是否真的可见。
4. `visualOccupancyByRole`：文字、公式、表格、流程、照片/装饰分别占用的区域。不能把所有图片等权转换成“字数”。
5. `readerQuestionCompleteness`：本页提出的问题是否被机制、证据/例子、边界、结论完整回答。

前两者不能混用：同一句写三次可增加 raw load，但不增加 unique information。公式短、信息量高，也不能为达到字符目标强行配无关段落。

### 9.3 页数估算如何改进

交接中的标准 21（21–25）、详细 25（25–30）是当前完整双语来源的默认画布估计，不能解读为代码保证所有模板最终均 21 或 25 页。当前成品锁定 explicit 21，因此不足以判断自动 packing 是否仍有缺陷。

建议沿原 workflow 完成两次校准：输入后快速估算 → 解析模板/来源后用完整对象、注释和实际几何重新拟合。在 syllabus 确认前，按唯一信息和保留义务生成多个可行候选；不足时调整 related grouping、结构分片与布局，不删必需对象。候选需要同时满足问题完整性和最终拟合，不单纯追求页数最少。

具体注意：

- 来源正文 projection 系数只用于估算，不得变成 writer 的机械截字上限。
- outline 拟合要预算公式变量释义、表格解释、图注及结论，不只是库存原文与几个 keyPoints；最终 writer 文案需要再次真实 fit。
- 语言策略由输入/用户要求确定。识别同义双语只用于规划，不能擅自去掉用户要求保留的语言。
- 低密度页优先判断是否缺信息，再判断是否可合并；丢失结构导致的薄页不能直接与另一薄页拼接了事。
- 显式页数不足时，给出容量冲突与可选方案；不能伪造 `source:user` 来规避自动 fit。
- 确认之后，生成阶段调整内容可保持页数；如确需变页，沿现有要求修订/确认逻辑显式处理。

## 10. Prompt 与数据契约的具体改进

以下为建议实施稿，尚未写入生产。优先修改 [ppt-prompt-contracts.mjs](../../apps/cowork-server/lib/ppt-prompt-contracts.mjs) 中现有阶段，不新增用户步骤，也不需要为每个检查都新增 LLM 调用。

### 10.1 Outline：从章节均分改为可验证的内容所有权

保留 readerQuestion / groupId / keyPoints / sourceArtifacts 的既有含义，补充唯一 claim/object 分配。建议契约片段：

```json
{
  "slideId": "s03",
  "readerQuestion": "特征、因子、alpha 和 anomaly 的关系是什么？",
  "mainClaimIds": ["claim-definition-relationship"],
  "requiredObjects": [{"objectId": "equation-source-id", "representation": "equation"}],
  "recaps": [{"claimId": "claim-prior", "purpose": "apply_to_new_case"}],
  "visualPlan": [{"role": "definition_formula", "sourceObjectId": "equation-source-id"}],
  "omissions": []
}
```

提示词应明确：标题不能冒充 keyPoint；每个 keyPoint 是完整主张+来源+解释义务；必需对象要有主讲页，不得靠引用 ID 证明完成；多次引用有明确用途；跨页表格行分片与流程依赖不能遗漏。补充以“两个来源小节同一读者问题”和“同一小节不同问题”两类例子校准规划，而非固定一个案例页序。

### 10.2 Writer：只写一次事实，结构与解释共同交付

建议规则文本：

> 输出一个规范可见内容表示，禁止同时返回重复的正文投影。各内容区提供不同的信息：定义、机制、证据/例子、条件或应用。标题/副标题/卡片标题/结论不得重复同一完整句。没有新增信息时省略可选字段。所有 requiredObjects 必须使用计划的来源选择和表示，不得移除公式或截断变量。来源表格保留所选行的全部列；流程保留顺序和依赖；清单逐项完整。空间不足返回具体对象及容量冲突，不能通过截字、丢行、删媒体伪造成功。

不同模式可以有不同 output adapter，但应共享内容所有权：native `slotTexts` 与 `sourceArtifacts` 有明确区域，mapped `contentBlocks` 与结构组件也有明确边界。对于 source-owned 表格，正文只补解释与判断，不再复制整表为 bullets。

visualPlan 必须路由到模块支持的真实组件。当前 writer 示例主要展示 table 不足以说明公式、流程、图标/照片及可用 asset 的选择约束，应补充组件级 schema、来源 ID、缺失行为和回退策略。模型选择对象与语义，不直接指定未经校验的几何，也不任意读取本地路径。

### 10.3 Repair / Critic：必须以最终可见差异回答

repair 输入增加：具体冲突节点、重复主张、缺失对象、允许修改范围、已锁定内容、前次修复结果；现有 sourceArtifacts/sourceCommentary/omissions 继续完整传入。现在 findings 的有界截取应按对象/严重度归并，避免前十条同类 warning 挤掉关键媒体缺失。

输出需包含实际 patch、问题处理结果和保留义务，不允许仅声称 fixed。repair 后运行同一 validator；无变化/重复问题未改善要可观测且停止无效重试。不要自动用 factSynthesis 填空 takeaway。

critic 看最终可见节点与来源义务，报告 `slideId/nodeId/claimId/objectId` 和证据；分别评估重复、来源支持、结构完整、数学语义、页内主线和跨页覆盖。模拟 critic 必须真的检查这些输入；真实 critic 不可被 deterministic file-read 成功替代。

### 10.4 局部 AI 编辑：不能重新引入全稿问题

“扩写、缩短、改布局、替换图片、优化当前页”都要保留 claim/object ID，并在候选上重跑相同规则。扩写新增解释而非同义复述；缩短不删除必需表格列/公式条件；换图保留图片用途和来源；改布局不降级 source-owned 结构。候选预览给出新增/移除对象与影响页；接受后失效旧 reviewHash，撤销恢复内容、对象与审计状态。该建议不改变现有局部编辑 workflow。

## 11. 推荐架构改动与文件落点

保留既有“来源方式 → LLM → 模板 → 输入与要求 → syllabus → 生成 → 编辑器”用户步骤。以下为内部增强，不新增 UI 审批层级。

| 优先级 | 部位与文件 | 具体实施 | 验收输出 |
|---|---|---|---|
| **P0-A** | `ppt-presentation-writing.mjs`、`ppt-quality.mjs` | 共用跨角色规范化；删除 repair 回填重复 takeaway 的路径或通过统一验证；最终 visible node 去重；repair 幂等 | 最小复现从复现成功变为回归测试通过；成品无未授权长段重复 |
| **P0-A** | `ppt-prompt-contracts.mjs`、`ppt/ir.mjs`、`ppt/render-tree.mjs` | 单一规范文案、claim ownership；legacy 投影只读派生；同一 claim 的多次出现需语义用途 | writer/repair/editor 到 renderer 的 canonical contract 一致 |
| **P0-B** | `ppt-source.mjs`、`ppt-content-inventory.mjs`、`ppt-source-artifacts.mjs`、`ppt-source-text.mjs` | 结构对象 ID、必保留义务、表格行列/流程边/公式语义完整；mapped 与 preserve 都可表达 | 计划、IR、可见树、实际文件逐对象核验 |
| **P0-B** | `ppt-template-fidelity.mjs`、`ppt-semantic-media.mjs`、`ppt-api.mjs` | 区分来源媒体/模板装饰/模板旧内容；按语义角色路由，取消通用大图尺寸假设；省略要有替代或允许理由 | 每个媒体资产有角色、去向、最终可见状态 |
| **P0-C** | `ppt-content-qa.mjs`、`ppt-quality.mjs`、`ppt-api.mjs` | 必需对象缺失和结构损坏阻断交付；分离 exportable/contentReady/visualVerified；导出后检查 | 不再出现结构全失而 editorialReady 的报告 |
| **P0-C** | 模拟 runner/回归 fixture | 只模拟 LLM；禁止换模式、显式锁页、导出补丁、空 reviewer 掩盖；保存配置和每轮差异 | 可复跑的同配置 baseline，不把模拟当真实模型验收 |
| P1 | `ppt-density-packing.mjs`、`ppt-density-profile.mjs`、`ppt-density-qa.mjs` | raw 排版负载与唯一信息分离；结构/图注完整预算；匹配实际模板候选；正确 invalidation | 自动页数来源可追溯、每次候选 fit 证据完整 |
| P1 | `ppt-template.mjs`、render tree/exporter、预览消费端 | 解析继承主题/背景，按语义角色应用颜色；按字符覆盖选 CJK fallback；统一预览/导出 | 两种运行环境中无缺字，逐节点对比度可解释 |
| P1 | writer/title compiler、source inventory | 禁止 heading 冒充正文与句中截断；数学依赖与标题/正文主题一致；尾部保留义务 | 完整句、完整公式、清单/总结不被系统性削弱 |
| P1 | 局部编辑/版本/评审缓存链路 | 对象 ID 与语义义务随 patch/undo 保留，局部操作后复检、评审失效 | 缩短/扩写/换布局/换图不会再次丢结构或复制事实 |
| P2 | 组件和资产能力扩展 | 更丰富的可编辑流程/数学/图表、样式可迁移、语义候选比较 | 完整性稳定后提升样式与可编辑性 |

模板色彩问题的具体证据：`ppt-template.mjs` 对明确背景与形状颜色作统计，在没有足够背景信息时会使用图片 RGB 频数等启发式；Mood Board 被分析为深色 background `#2c2c20`、accent `#2e2f23`，而视觉参考主画布为浅奶油色。模拟脚本因此又改为浅背景和深文字。建议先解析 slide→layout→master→theme 的有效样式，再考虑可见面积、遮挡和用途，不把未经加权的图片主色当整稿背景。颜色修复必须更新同一 IR/主题，不能导出后手工改色而保留旧质量结论。

字体问题也不能靠只写 `titleEastAsia/bodyEastAsia` token 解决。当前 QA 检查了字体字段和替换字符，但不存在这些错误不代表实际字体有对应 glyph；中文能从 XML 提取而渲染成方框就是反例。需要本地可用字体、逐 run 字符覆盖、fallback 和最终渲染验证，保留原始文本不作字符删除。

## 12. 验收方案：防止再次“测试通过但成品失败”

### 12.1 P0 必须满足的验收

| 层次 | 用例 | 通过条件 |
|---|---|---|
| 单元 | 当前 takeaway 最小复现 | 归一化后为空的重复 takeaway 不被 repair 重新插入；两次 repair 稳定 |
| 单元 | 同一句在 subtitle/body/takeaway；不同 heading 下相同 body | 最终可见节点检测到重复；不只比较整个 bullet |
| 单元 | 术语、表头、翻译、公式变量、明确 recap | 不被误删；复用原因可追踪；公式语义不因文本归一改变 |
| 契约 | writer 同时返回重复 contentBlocks/bullets/factSynthesis | 确定唯一正文；不允许冲突的多个可写 truth source |
| 结构 | 完整表、分片表、18 个公式、流程与清单 fixture | 选定对象完整；表格行范围并集和所有列无损；步骤/边/变量关系正确 |
| 媒体 | 小公式位图、SVG、照片、模板装饰、旧内容截图 | 分角色处理；必要对象可见；不使用统一尺寸阈值误删 |
| 门禁 | 空 reviewer + 缺必需结构 | 不可宣布 contentReady/publishEligible；允许带问题标识的诊断稿另行下载 |
| 集成 | prompt/paste/file、standard/detailed、mapped/preserve、auto/explicit | 真实入口参数未被测试器改写，页数 provenance 与模式一致 |
| 导出 | 重新读取最终 PPTX 与 render tree | 对象、文本、表格单元格、媒体引用与 hash 对应；无缺失关系或不可读资源 |
| 视觉 | 真实渲染与关键页放大 | 无缺字、裁切、遮挡、不可读对比度；公式符号、表格与图注完整 |

建议将当前坏样例保存为 regression fixture：去重后非空信息不能更少，必保留结构完成率应为 100%（对明确批准的排除另行列账），必要媒体义务无悬空。同页未授权的长完全重复应为 0；不是要求所有术语只出现一次。词面 topicRecall 只作辅助趋势，不能替代对象/事实审计。

### 12.2 内容密度与叙事验收

- 使用同一来源、相同语言/深度/保留策略作 before–after；Gamma 提供版面密度与表达方法参考，不能被当作完整来源答案。
- 报告每页 raw/unique units、来源对象数、表格/公式/流程角色、读者问题、缺失信息和拟合状态。不要只有总页数或字数。
- 对比实际正文密度分布与 Gamma profile，排除封面/章节导航等特殊角色；低密度必须解释是合理留白、媒体占用，还是内容缺失。
- 自动模式检查模块最终推荐及候选 fit；显式模式检查页数约束冲突。不能通过把自动结果写成用户指定来通过测试。
- 三类来源至少覆盖研究教程、业务分析、系统架构；每类包含一种 rich source（公式/表/流程）和长尾总结，避免针对 Factor Zoo 硬编码。
- 在模拟 schema/回归通过后再运行真实所选模型的样例，分别记录模型 writer/critic 的实际表现。调用次数、`reviewState:valid`、包可打开均不等于内容合格。

### 12.3 UI 与局部操作回归范围

实施涉及前端时按仓库要求真实启动应用、经 CDP 验证；保留现有 workflow。至少检查：三种输入入口、模板选择/预览、输入后估算更新、返回修改与失效、syllabus 确认、生成中改要求、暂停恢复、单页/组件 AI 编辑、候选接受/拒绝、撤销、换图、换布局、导出和失败重试。改变来源/模板/模式/页数后，旧对象账本与旧评审不得继续显示为有效。滚动/可点击性为既有回归，本文没有再次操作整个 UI，也不声明本轮已经通过这些测试。

## 13. 建议实施顺序与交付划分

1. **先冻结坏样例和真实运行条件，修 P0-A/P0-B 的最小闭环。** 并行的工作面可以是可见文案去重与来源对象保留，但共享同一个最终 validator；优先证明公式、表格和流程能在两种模板模式进入真实文件。不要先用更好看的模拟输出覆盖现场。
2. **落实 P0-C。** 将强制义务和最终文件核验接入现有质量/发布阶段；停止空 reviewer 与导出补丁制造假通过。保持诊断能力，清楚区分 failed、not evaluated 和 passed。
3. **再校准密度、页数与叙事。** 在结构恢复后重跑标准/详细与自动模式，分析唯一内容和模板容量。根据结果调整估算/packing，而不是预先指定必须 10 页或必须 21 页。
4. **收敛预览/导出一致性与局部编辑。** 修主题继承、glyph fallback、颜色角色和对象级 undo/review invalidation，完成实际渲染及 UI 验证。
5. **最后扩展视觉种类。** 加强可编辑图示与数学、可替换资产和风格质量。装饰图片数量不作为 P0 成功指标。

本次可立即进入实现的第一组变更是：`repairProject` 重复回流修复、跨角色可见重复 QA、必保留结构/媒体账本及门禁、忠实模拟 runner。它们直接对应用户反馈的两项主要问题；其余改动服务于完整性、正确页数、布局与长期不回归。

## 附录：本轮复核命令与限制

```sh
# 在仓库根目录执行。审计工具仅写本轮 evidence 目录。
/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 outputs/ppt-mood-board-gamma-review-20261007/audit_pptx.py
node outputs/ppt-mood-board-gamma-review-20261007/reproduce-takeaway.mjs
```

第二条当前以“复现缺陷成功”退出 0，不是修复通过测试。实施修复时应将其迁入正式 selftest 并反转断言，要求 `duplicateReintroduced:false`。

本轮执行了 OOXML 提取、SHA 核验、逐页文本对比、媒体用途检查、两稿 LibreOffice PDF/PNG 渲染、当前代码的重复回流最小复现。没有修改业务代码，所以没有重跑全仓实现测试；没有真实 LLM、远端部署或桌面 PowerPoint 验收。文中的具体组件设计和门槛均为待实施建议，不应记录成已修复。
