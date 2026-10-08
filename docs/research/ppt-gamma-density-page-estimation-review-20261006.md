# AIMate PPT：以 Gamma 内容密度为标准的页数估算与规划改进建议

2026-10-06 · 当前代码基线 `1bdc5f5` · 本文为分析与实施建议，未修改生产代码、原型或既有 PPTX，未运行真实 LLM，未 commit。

## 1. 结论：为什么优化后仍然是 22 页

**原因已经由代码和估算函数重跑确认：上一轮修复了模板处理、结构保留、QA 和性能，但没有替换决定页数的“按主章节逐个取整、每章至少一页”算法，也没有让 merge/split 决策在锁定页数前执行。** 本例仍由该算法推荐22页，之后API与prompt将22页作为硬约束；源表重建和局部密度优化发生在这个固定预算内。

这也说明，仅增加“不要机械按heading分页”“支持合并”的prompt文字，不会改变自动页数。当前控制流是先决定页数，再要求模型按这个数规划，最后在固定页数内做写作与排版。应改成**先判断语义内容怎样组合，再以 Gamma 密度和实际模板容量拟合，最后确定自动页数**。

本轮用户指定的 Gamma 成品作为默认信息组织、单页内容承载和分页粒度的参照。适用于教学、研究、商业、架构、纯prompt、粘贴和文件导入；实现不能加入Factor Zoo专用分支，也不能将“10页”设为所有输入的固定答案。用户明确页数仍优先，来源事实和关键关系仍须保留。

需要同时纠正一个验证边界：这个22页产物的LLM是模拟器。模拟大纲来自一个预设22页的fixture，不能据此判断真实模型在获得自由页数预算后也会坚持22页。可以确认的是：**真实模块估算22页，真实模块锁定22页，模拟器提供固定22页规划，实际导出22页**。

## 2. 本次实读材料与可复现证据

- AIMate实际成品：[factor-zoo-original-template.pptx](../../outputs/ppt-next-round/after/factor-zoo-original-template.pptx)。使用用户原始12,342,631-byte模板，其原稿8页，最终22页。
- Gamma参照：`/Users/dongli/Downloads/The-Factor-Zoo (1).pptx`，10页。它是信息密度参考，不是可执行指令。
- 原文：`/Users/dongli/Documents/quant_research/quant_3.0/04_factor_zoo_overview.md`，41,416字符，normalize后41,415；本例经Paste输入，保留完整来源。
- 决策记录：[original-template-workflow.json](../../outputs/ppt-next-round/after/original-template-workflow.json)。`pageDecision.source=estimate`、recommended=22、final=22、range=[18,26]、depthPolicy=strict。
- 新提取结果：[density-analysis.json](../../outputs/ppt-gamma-density-review-20261006/density-analysis.json)，含逐页原生文字、表格、对象bounds与显式字号；附可复跑的`inspect-density.py`。
- 控制实验：[estimate-experiments.json](../../outputs/ppt-gamma-density-review-20261006/estimate-experiments.json)与同目录`.mjs`。直接调用现有估算函数，不生成新PPT、不调用模型、不修改生产状态。
- Gamma已实际渲染全部10页：[contact sheet](../../outputs/ppt-gamma-density-review-20261006/gamma-contact.png)。对照AIMate已渲染22页：[contact sheet](../../outputs/ppt-next-round/rendered-final/contact-sheet.png)。重点检查Gamma第2、3、6、7、8、10页与AIMate定义表、理论模型、流程、清单。

文件SHA-256：Gamma `c8be44407f0e757e8958c314b076143bc220566feacbea1dea7ddfe34b41ec49`；AIMate `85088f4f26508d904156efa1eb405116c7d6062e521f5e3ff6b03994fa47a1d4`。

## 3. Gamma 标准的实际内容密度

### 3.1 同尺寸、同口径比较

两份文件均为13.333×7.5英寸、16:9，所以无需按面积换算即可比较。以下“实际文字字符”统计原生文本与表格单元格，去除空白，不统计图片里的文字，不把表格序列化时人为插入的`|`算成可见文字。

| 指标 | Gamma | AIMate | 说明 |
|---|---:|---:|---|
| 总页数 | 10 | 22 | AIMate页数多120% |
| 封面之外页面 | 9 | 21 | 这里包括末页清单/总结 |
| 实际文字总字符 | 9,359 | 10,175 | AIMate总文字仅多约8.7% |
| 封面之外文字总字符 | 9,109 | 10,091 | 正文总量相近，分布到的页数差很多 |
| 正文页字符中位数 | **1,019** | **443** | Gamma约2.30倍 |
| 正文页Q1 / Q3 | 909.5 / 1,097.5 | 371 / 587 | Gamma密度在多种结构间较稳定 |
| 正文页最少 / 最多字符 | 802 / 1,196 | 237 / 834 | 本例AIMate全部21个正文页都低于Gamma正文Q1 |
| 原生表格 | 3 | 7 | 数量多不代表单页信息更丰富，AIMate拆表较多 |
| 非表格正文页字符中位数（AIMate） | — | 399 | 稀疏不仅发生在新增表格页 |
| 正文页文本框矩形并集面积中位数 | 28.76% | 41.38% | **这是分配区域，不能作为实际文字填充率** |
| 正文页显式字号统计中位数 | 约11pt | 约13pt | 仅显式run/paragraph字号，未完整解析主题继承 |

字号口径：先在每页按显式字号对应字符数加权取中位数，再对正文页取中位数；不代表每页所有文字都使用这一字号。Gamma第10页统计约9.5pt，AIMate新增结构通常14pt。Gamma信息组织方式应成为标准，但容量校准必须带字号/视距条件，不能通过缩字作弊。若既有模板必须保留较大字号，应明确说明其容量差异，并给出经过拟合的候选页数。

历史报告的Gamma 9,409 / AIMate 10,295字符与正文中位1,019 / 460，沿用了`benchmark-content.mjs`的表格`' | '.join`序列化口径，分别包含50/120个合成分隔符。本次JSON保留这组兼容数据，同时新增`actualTextChars`；443与460的差别不是文件内容变化。

字符数不能独立代表信息深度。Gamma正文以英文为主，中文多在标题或短补充中；跨中文/英文必须按字形宽度和语义单元归一化。段落数、文本框数也不能代表概念完整度：AIMate共有353个非空段落、Gamma199个，但AIMate单页承载明显更少。

### 3.2 Gamma 逐页如何组织内容

| Gamma页 | 实际主题组合 | 实际字符 | 对应AIMate当前分布 | 可一般化的组织原则 |
|---:|---|---:|---|---|
| 1 | 封面与核心定位 | 250 | p1，84字符 | 封面单独建基准，不要求正文密度 |
| 2 | 因子/特征/异常/alpha定义，基准模型与关系 | 1,094 | p2–3，部分模型说明又在p4 | 相关定义+区别+表达式组成一个概念框架 |
| 3 | CAPM、APT、FF3、Carhart、FF5/q理论谱系 | 1,019 | 主要散布p4–12 | 同一比较轴用多列时间线，避免每个模型一页 |
| 4 | GRS与因子溢价解释 | 1,082 | p10、p12、p13中的相关内容 | 检验问题+解释机制可以共享一页 |
| 5 | 因子动物园问题、冗余、数据挖掘、多重检验与证据门槛 | 1,196 | p14等 | 一个问题页可容纳主证据和多个不同支撑维度 |
| 6 | 分类总表+逐因子评分卡，两张表并列 | 902 | p15、p16分开 | 短表按共同维度组合，保留两表各自关系 |
| 7 | 组合构建方式+择时/拥挤 | 917 | p17、p18分开 | 构建方法与实施风险在同一操作框架下表达 |
| 8 | 美股/A股适用边界+2×3排序算例 | 996 | p19、p20分开 | 适用边界+对应方法/例子用双区布局 |
| 9 | 从研究到策略，多阶段工作流 | 802 | p21，237字符 | 步骤需包含输入、动作、检验和输出，不只列步骤名 |
| 10 | 8条实践清单+模型汇总表+综合小结 | 1,101 | p22仅清单，模型表/小结迁到p11–12 | closing可以是高信息量总结，不能默认只容纳3–4条原则 |

这些是本案例的页面映射，不是未来所有主题的模板。一般化目标是：在一页内形成明确读者问题，将解释、条件、比较、例子与结论组合成完整答案；通过结构减少同义重复和拆页。

Gamma的密度来源包括多列比较、并列表格、短长解释混合、完整阶段说明与组合式结尾。不能只从附件抽取“每页约1000字”，然后把所有主题写到同样长度。

## 4. 22 页的数学来源与控制实验

### 4.1 当前算法怎样得到22

`sourceCapacityPlan()`按主章节聚合chunks，对每章计算加权来源负载，然后执行：

```js
const sourceBudgetPerPage = 2700;
const chapterPages = section => section === intro ? 0 : Math.max(1, Math.ceil(section.contentCost / sourceBudgetPerPage));
recommended = 2 + sum(chapterPages);
```

实际共有15个section：根部引言不分正文页，14个正文主章节分别取整。额外2页是固定封面与结尾预留。

| 分组 | contentCost | 当前正文页配额 |
|---|---:|---:|
| 1. 什么是因子 | 3,649 | 2 |
| 2. 理论谱系 | 13,789 | 6 |
| 3–14，十二个其他主章节 | 单章302–795，总计5,599 | 每章1，共12 |
| 封面与结尾预留 | — | 2 |
| 合计 | — | **2+6+12+2=22** |

全section含引言的contentCost=23,653；正文cost=23,037。十二个较小章节按2700的总预算可以装在若干合适页面，但当前各自保底1页，将许多原本能组合的空间浪费掉。结尾预留之外“14.小结”仍占一个主章节配额，存在小结内容与末页角色重复预留的结构性风险。

单纯按正文总cost计算`2+ceil(23037/2700)=11`只说明逐章取整造成的膨胀，**不是经过版面、来源完整性验证的11页最终答案**。需要把结构差异和具体布局带入，而不是改成另一个全局除法。

### 4.2 函数重跑结果

| 控制变量 | 推荐 / 选择 | 实测说明 |
|---|---|---|
| 当前原文+原教学要求 | 22 / 22 | 与产物记录一致 |
| generationPolicy.detail=balanced | 22 / 22 | 标准模式没有进入容量参数 |
| generationPolicy.detail=detailed | 22 / 22 | 详细模式也未改变估算 |
| templateSpec.pages=8 或10 | 都22 / 22 | 估算不读取实际模板容量，模板页数本身也不该决定结果 |
| 显式project.pages=10 | 22 / 10，compressionRisk=true | 推荐范围仍18–26，把10页视为压缩风险 |
| prompt明确写overview | 10 / 10 | 命中`2+ceil(14/1.75)`的章节数量分支，未验证10页实际容量 |
| 相同10,000字符以Prompt估算 | 10 | `source_structure`分支 |
| 相同10,000字符以Paste估算 | 5 | `readable_content_capacity`分支；入口改变了算法 |
| 只去除原文`##`边界 | 17 | 内容表达基本保留，章节表示改变后推荐变动，显示对格式敏感 |

额外将41k原文直接作为prompt的纯函数探针返回27，但生产prompt有长度上限，**不能把该探针当成一个合法完整生成请求**。上述合法长度10k的Prompt/Paste对照已足以证明入口分歧。

短prompt运营复盘探针推荐8页；5主章节架构和5主章节商业短材料都推荐7页。后两者受每章1页+2页预留影响；这并不证明最佳页数一定更低，但说明算法还没有检验能否像Gamma一样将相关内容合并。

### 4.3 为什么只改2700无效

| 假设每页source budget | 仍按章节保底的结果 |
|---:|---:|
| 2700 | 22 |
| 4000 | 19 |
| 8000 | 17 |
| 极大值，消除cost影响 | **16** |

这是对同一已提取cost的反事实算术实验，没有修改生产常数。即使每页容量无限大，14章×至少1页+2仍为16。**章节保底必须改成语义组容量约束，不能只调常数。**

## 5. 代码与 Prompt 因果链

下列路径相对仓库`LabCodepilot-para`。行号用于本次`1bdc5f5`定位，后续代码修改可能移动。

| 环节 | 代码定位 | 当前行为 | 为什么阻止Gamma式密度 |
|---|---|---|---|
| 来源估算 | `apps/cowork-server/lib/ppt-planning.mjs:29–89` | 按主章节逐个ceil、每章至少1页、固定2页预留 | 语义关联并未先组合，小章占满整页预算 |
| 策略入口 | 同文件`:92–144` | sparse / overview / sourceCapacity / fallback依次选一种；range用±18% | 混合规则未统一，range不是布局可行区间 |
| 源token与profile | `ppt-semantic.mjs:11`、`ppt-content-depth.mjs:20` | 两套近似token/词段计数 | 原文负载不是可见内容长度；本例profile 5,593与semantic 20,133不可互换 |
| 新建页数 | `ppt-api.mjs:1213–1237` | `data.pages ?? promptPages ?? estimatedPages`，写入pageDecision | 没有显式数量时，未经语义packing的估算成为初始最终数 |
| 大纲prompt | `ppt-api.mjs:179–203` | 明确“project.pages最终硬参数”“slides恰好N”“封面结论各1页”，输出章节配额 | 下游模型不能主动从22缩为10或12 |
| 大纲校验 | `ppt-api.mjs:93`起、内容校验`:149` | schema/outline/content按既有页数检查 | 当前行为应保留在最终确认后，问题是自动值锁得过早 |
| 大纲内容契约 | `ppt-prompt-contracts.mjs:190–214` | many-to-one指令及topicGroups；结尾又要求Preserve confirmed page count | 合并只能在既定22个容器内重新分配，无法减少容器数 |
| grouping数据 | `ppt-content-inventory.mjs:55–66` | 根据outline引用派生merge/split；capacity_ok按block数与semanticUnitBudget估算 | 记录了关系，不是可执行的页面组合算法，也不是物理容量证明 |
| 密度契约 | `ppt-planning.mjs:282–305,343–384` | 按角色默认3–6 units，结尾4；再受槽位point容量约束 | 没有从Gamma提取role-specific target，没有全稿密度拟合 |
| Writer | `ppt-prompt-contracts.mjs:64–80,232–258` | 解释长度建议、原生slot容量硬限、最多2 sourceArtifacts | 各页局部填槽，缺少整体区域组合与返还空余页的能力 |
| 普通文案预算 | `ppt-presentation-writing.mjs:186–198` | bodyUnits=500/600/750等固定值 | 未按语言、实际结构和reference profile动态校准 |
| typed结构几何 | `ppt-source-artifacts.mjs:11,19–58` | 最多2对象；正文固定87%宽、68%高；仅Process/Checklist允许双列，其余纵向分配 | Gamma的双表、清单+表格、正文+算例等组合尚未被覆盖 |
| 可见QA | `ppt-content-qa.mjs:64–94` | underfill仅warning；fragment要相邻薄页、共享chunk、相似message；page数不匹配error | 把不同章节但相关的候选页漏掉；警告不会触发自动页数重规划 |
| UI估算 | `src/components/ppt/PptWorkspace.tsx:463`、`create/PptCreateWizard.tsx:113–143` | page-estimate传input与policy，未传template或Density Profile；估算signature排除模板 | 换版式、有效正文区域变化都不能参与页数更新 |
| 文件预估与确认 | `ppt-api.mjs:1170–1185,419–430`、`PptCreateWizard.tsx:155–168` | 文件先按bytes粗估；analyze主动把pageSource改user；解析后仅estimate可自动校准 | 用户只是点生成syllabus，也可能锁住未解析文件的粗估。属于静态代码发现，未作本轮UI实机复现 |
| 本例模拟规划 | `outputs/run-factor-zoo-next-round.mjs:88–114,395–449`、`outputs/factor-zoo-process-improvement-slide-plan.mjs` | 固定22页fixture、pageSlotCopy；若估算改变就报长度不匹配 | 无法用它验证新自动页数，必须另建动态分组/候选fixture或真实模型回放 |

本例topicGroups共60条，**全部origin=derived_allocation，planner=0**；标记38 merge、7 split、15 standalone，但页数还是22。这是“已有合并字段”与“已执行合并规划”不同的直接证据。

既有QA已发现7个`rich_source_underfilled`，underfillRate=0.35，但fragmentationRate=0、mergeCandidates=[]。所以“碎片率0”不能解释为没有碎页。当前产物还有20个source_structure_or_detail_missing及其他2项，共29项确定性问题、0 hard errors，状态passed_with_warnings；这些事实也不能证明22页是保全来源所必需。

## 6. 通用改进架构：在现有 Workflow 内先组合再分页

外部产品步骤保持现状。改造发生在已有estimate / source / outline / layout / quality节点内，不增加用户必走的设置页。

```text
输入与模板
  → 规范化来源 / 识别受众、用途、语言、标准或详细
  → 建立可追溯的语义内容与关系
  → 按读者问题形成候选语义组（允许跨章节）
  → 为每组选择组合结构 + 估算实际可见内容与空间
  → 按Gamma Density Profile与当前模板能力进行有界packing
  → 确定自动建议页数与可解释范围
  → 既有确认边界后冻结最终页数
  → 页级写作 / layout fit / QA / 导出
```

### 6.1 参考Profile要做成可复用配置

建议新增`ppt-density-profile.mjs`，登记例如`gamma-reference-v1`。只保存布局与密度特征，不把附件的金融事实放进其他主题prompt。

```json
{
  "id": "gamma-reference-v1",
  "referenceSha256": "c8be44407f0e757e8958c314b076143bc220566feacbea1dea7ddfe34b41ec49",
  "referenceSize": {"widthIn": 13.333, "heightIn": 7.5},
  "textNormalization": "actual cells and text, whitespace excluded",
  "observedBody": {"q1Chars": 909.5, "medianChars": 1019, "q3Chars": 1097.5},
  "patterns": ["definition-framework", "multi-column-lineage", "dual-table", "method-and-risk", "boundary-and-example", "expanded-workflow", "checklist-and-summary"],
  "policy": {"chapterFloor": false, "manualPageCountWins": true, "autoShrinkToFit": false}
}
```

这些字段是建议schema，不是已上线配置。Q1/median/Q3来自实测；按role分开的合理范围需要对这10页作人工结构标注后建立初版，不能把9页统计伪装成跨行业已验证的概率分布。

默认全场景采用附件的组织密度。不同语言、图表/流程/表格比例、页面尺寸、模板字号、输出用途先映射到同一Profile的容量，再适配具体页面。稀疏source_only输入不足时保持诚实，不能为了达到900–1100字符填充无来源事实；纯prompt可展开通用机制，但不编公司数据。

### 6.2 语义组需要真正驱动估算

将章节降级为来源定位，保留引用与叙事顺序；取消“每章必须独立页”。建立带内容的group：

```json
{
  "groupId": "g_01",
  "readerQuestion": "本页回答的具体问题",
  "sourceUnitIds": ["真实ID"],
  "claims": ["具体主张"],
  "relations": ["定义区别/机制条件/比较维度/阶段依赖"],
  "mustShow": ["必须可见的表达式、表格关系和限制"],
  "candidateLayouts": ["two-column-explainer", "dual-table"],
  "estimatedVisibleUnits": {"explanation": 4, "comparisonRows": 6},
  "decision": "merge",
  "reason": "同一读者问题，两个部分共同形成答案"
}
```

明确把“语义unit”与paragraph、table-row、token区分：一个短行名不是完整说明，重复的中英翻译也不能算两个独立概念。当前semantic index可用于检索，packing应按新group和具体结构，不按chunk数量分页。

可合并条件：共同受众问题、比较轴或过程目标；内容职责互补；合并后保留必要事实与过渡；至少一个允许版式拟合。必须拆分条件：问题不同、单页推导/例子容量不足、正文/图表失去可读性或逻辑依赖无法在一页表达。仅因headings不同不能拆，仅因词面相似不能合并。

### 6.3 页面容量与实际布局统一

建议新增`ppt-density-packing.mjs`，并复用现有layout catalog / Render Tree测量：

- cost来自**计划展示内容**：标题、解释行、公式行、列宽与表格行高、代码行、图表标签、流程说明，不再直接把原文source tokens当可见负载。
- 使用同一字形宽度/字体/行高测量估算器与renderer。声明effectiveContentRect、reservedZones、fontPolicy、结构允许组合与readable capacity。
- 允许多列模型比较、双表、清单+汇总表、主机制+条件、方法+实例等Gamma式组合。替换“最多两个同类对象”这类与版式无关的全局限制，改成`layout.allowableComponents`与总复杂度/空间上限。
- `capacity_ok`只在实际候选结构完成测量后为true；建议提供predictedOverflow、lineCounts、tableRowRanges、fontPt、layoutId，不能只比较block数。
- 表格/流程按自然高度占区，支持并列/局部区，而非一律拉满68%页高；剩余区域承载对应解释、例子或综合判断。保留标题、模板必要装饰和安全边界。
- 对原生保真模板复用同一palette/font/style。若其布局不支持目标密度，优先选择目录中更适合的版式或受控结构重排；无法拟合时再扩页并给证据。不能静默改成另一套主题或缩字。

目标函数可使用“在coverage与readability硬约束下，最小化过多页面、低密度页和过载页，并保持适当密度节奏”。Gamma的每页密度作为校准项；不是只最小化页数，也不是所有页填到完全相同字数。

### 6.4 自动值、显式值和确认必须分开

建议PageDecision增加`mode=auto|explicit|preserve_import`、`estimateVersion`、`densityProfileId`、`estimatedBeforeParse`、`confirmedAt`、`reason`，保留现有兼容字段。

- **auto**：输入时给快速初估；解析/语义分组与fit后在既有分析阶段校准，显示更新理由。执行packing后才冻结，避免粗估进入最终硬约束。
- **explicit**：用户手调、明确指令数量或编辑大纲数量。保留exact-N要求；不自动减页。密度不足/容量不足应指出真实问题，不能复制事实凑页。
- **preserve_import**：原生可编辑文件的保守导入仍保留原文件页数，不套生成型Gamma估算。这是保留用户原稿操作的边界。
- `confirmed`与`source=manual`不能混成一个概念。现有“点击生成syllabus就改pageSource=user”建议改为记录确认状态和原始来源，让文件解析后的auto校准在最终确认前可达；最终已确认的页数不悄悄覆盖。
- page-estimate请求加入templateId、templateVersion、densityProfileId、generationPolicy；换模板/有效容量改变时重新估算。保持debounce、取消旧请求、手动值优先与空输入显示模板原页数。

### 6.5 标准/详细、语言与各入口统一

标准与详细都应达到Gamma式的信息组织密度。详细模式增加需要解释的机制、证据、变量/条件与案例，不应只是更长句子，也不能让该选项对page estimate完全无作用。两模式可能恰好得到相同页数，但必须来自同一fit结果，不能因策略被忽略而相同。

纯prompt先形成领域特定内容group，解除通用QUESTION_BANK与页面的近一对一绑定；已有来源的Prompt/Paste/Markdown/PPTX文本走同一normalize/inventory/grouping。文件bytes仅用于未解析初估与安全限制，解析后改用真实内容。Update按变化的group重算候选，保留稳定ID和明确保留页的要求。

统一`sourceTokens`、`displayVisualUnits`、`semanticUnits`、`relationUnits`命名；profile的词段计数不要继续与model tokens混称。双语建立translationPair，语义容量去重但显示空间仍按两种语言实际计算；输出语言沿用已有source规则，不借密度优化擅自改语言。

## 7. Prompt 具体修改建议

### 7.1 Planner：自动数量与明确数量采用不同契约

当前问题在`ppt-api.mjs`的planningContract，而不是只在通用system prompt。建议保留原有来源安全指令、标题锁定和schema要求，按PageDecision.mode生成两个分支：

**自动页数分支草案：**

```text
当前数量为初估，不是最终页数命令。先按受众问题建立有内容的group，再提供可拟合的结构。
默认信息组织密度参考density_profile，不以source heading作为页面边界。
相关定义组成框架，比较对象共享比较轴，短表可并列，流程保留每阶段动作/条件/输出，
总结可同时包含清单、汇总结构与综合判断。
为各group返回真实sourceUnitIds、mustShow、互补内容职责、candidateLayouts与merge/split理由。
覆盖所需的模型/事实/公式关系/表格列与末尾内容；资料不足须明确。
最终数量由代码依据候选group、layout fit和density profile确定，不按固定10/12或每章至少一页。
不得为达到密度填字、编数据、删除必要条件或仅列名词。
```

**明确或最终确认数量分支：**继续要求exact-N。模型在该数量内采用Gamma式组合，提出必要取舍/容量问题。不能因推荐更少而无视用户数量。

优先让既有outline调用返回groupPlan及候选组合，由确定性packing生成最终outline；需修正时在现有outline节点做有界repair。不要为每个章节另开无限模型循环，也不要增加创建流程步骤。

### 7.2 Writer：从slot填字扩展为结构化答案

```text
本页readerQuestion、claim、mustShow与layout contract如下。
在允许结构内把解释、变量/条件、对照/例子、风险或结论组合成完整答案。
以density_profile对应页面角色为目标；正文长度是拟合建议而非填字额度。
不得把完整机制缩成标签，不重复改写同一事实，不以引用ID代替可见表达。
sourceArtifacts保留全部授权单元格及必要关系；需按指定组合区域输出结构，不另写隐藏重复正文。
无法在既定字号和可用区域保留必要内容，返回明确overflow及可拆分内容，不自行缩字或截断。
```

取消普通页机械三点或统一短句倾向，但保留合适的短label。细节由“具体关系是否讲明白”与最终可见fit验证，而非“至少有三条bullet”。

### 7.3 Reviewer：整稿密度与来源同检

加入densityProfileId、逐页测量、group关系和candidate merge信息。review应标记：

- 相关内容被拆成数页，合并后是否仍完整且可读；允许非相邻但关系强的候选。
- 流程是否只有步骤名称，而没有实际动作/条件/检验/产出。
- 表格是否有完整列关系与原有类别，清单和summary是否失去核心判断。
- 同一事实是否跨页同义重复，语言重复是否被误算成独立信息。
- 与reference的同role密度差是否合理，依据是否为容量或证据稀疏。

auto且尚未确认时允许有界重规划；已确认/手动页数则提供范围明确的既有structure Proposal，不静默改页。发布前以实际Render Tree/PPTX而非模型草稿检查。

## 8. 一般化验收：不能只让这个案例变10页

建议新增专用reference-density benchmark，保存Profile版本、fixture、group decisions、page count decision与最终测量。Gamma是密度标准，用户source是事实范围。

| 测试族 | 必须验证 |
|---|---|
| 本例同源对照 | 从10页Gamma分组起生成候选；验证章节floor已解除、模板/内容fit、源表列/公式条件/末页清单覆盖；不只检查output.pages===10 |
| 教学/长研究材料 | 多章节能合并或因推导确需拆分，heading改写不显著改变有效语义页数 |
| 商业复盘/方案 | 证据、机制、风险和判断结合；没有企业数据时不编造，也不只按章节标题分配页 |
| 架构/产品说明 | 组件及连接/依赖共同呈现，接口/约束有解释；不每组件独立一页 |
| 表格/分类多 | 双表与比较矩阵能组合；保持全部必要cells、比较轴和字体 |
| 多阶段流程 | 每阶段动作/输入/检验/输出完整；和reference流程密度校准 |
| 中英/双语 | 相同语义不因重复翻译被加倍计为概念；实际布局仍计双语宽度 |
| Prompt / Paste / File | 合法范围内同内容得到相同语义groups与接近页数；文件解析后不被粗估锁死 |
| 标准 / 详细 | 详细增加具体必要内容，fit可解释地不同或相同；不只是固定乘页数系数 |
| Sparse source_only | 不以参考字符数补造内容；记录density不足原因 |
| 用户明确页数 | exact-N保留，不以自动优化覆盖；真正容量问题可见 |
| Editable import / Update | 原稿页数保持；更新遵守保留页/增量变更与现有publish机制 |

建议指标组合：required-unit recall、relationship retention、table-cell retention、workflow completeness、summary completeness；actual visible text/visual units与语言比；role-normalized density deviation、readable block/line count、预测与实际overflow；underfill与可行merge候选；跨页重复。来源coverage不应以chunk被refs引用就算通过。

`textFrameUnionRatio`不可独立作验收。AIMate文本框面积更大但文字更少，尤其typed对象铺满白色canvas。应使用实际文字行/字形区域、容器自然高度、内容与空余空间，结合最终渲染图检查。此轮没有得到完整像素级文字占用测量，不将矩形指标冒充实际ink面积。

建议先用附件的正文密度分布与结构标注作为v1目标。条件相当、信息充分的正文若显著低于Gamma同role基准，应要求合并/补充真实关系或明确理由；不要硬设所有页不得低于909.5字符。阈值、容忍差和最小字号须由这组reference回放与跨域fixtures校准，不把单一案例阈值伪装成所有主题已验证的标准。

## 9. 这个案例下一轮应怎样验证页数

先按Gamma的10页组织提出候选，再用AIMate的具体模板、来源要求、字号与组合布局验证。AIMate当前显示文字比Gamma稍多，保留更完整信息可能需要额外页；这需要明确容量证据，不能继续以“14主章所以至少16页”解释。

仅按现有已生成的10,091正文字符、Gamma正文Q1–Q3作重新分布的粗算：正文约10–12页，加封面约**11–13页**。它说明22页存在很大的重新组织空间；它既不是新估算器结果，也不保证包含原文所有未展示细节的最终页数。

应比较10/11/12/13等合理候选的真实fit与required coverage，选择满足reference密度、完整性和可读性的方案。若需要超过候选范围，记录哪一组公式、结构/例子在何种字号/区域下确需拆页。不预先承诺所有source_only原文压到10页，也不让表格更完整成为保留22页的自动理由。

本例模拟器必须移除“预设22个slide+pageSlotCopy+长度必须相等”的耦合。保留22页版本作回归历史，用能输出动态groupPlan的模拟fixture验证状态/packing，再用实际用户所选模型验证写作与语义质量。模拟响应覆盖记录一律included不能替代真实可见coverage。

## 10. 推荐实施点与 Priority

| 优先级 | 实施点 | 主要文件 | 依赖与验收 |
|---|---|---|---|
| P0-1 | 落地Gamma Density Profile及一致的可见统计 | 新`ppt-density-profile.mjs`，benchmark-content | 原附件实测可复算，按role/语言/结构保留校准，剔除合成separator与伪语义unit |
| P0-2 | 取消每章至少1页，执行语义grouping + 有界packing | planning、content-inventory；新packing模块 | 依赖P0-1；章节只作refs，模型决策驱动实际组合，capacity_ok来自真实测量 |
| P0-3 | 自动页数在fit后冻结；明确数量继续exact-N | API planningContract/normalizeOutline、PageDecision、CreateWizard/Workspace | 与P0-2一起交付；防文件粗估锁死，保持已有确认、manual override、debounce/取消语义 |
| P0-4 | 估算与renderer共享容量，支持Gamma组合结构 | template layout catalog、source-artifacts、render-tree、preview/import exporter | 与P0-2并行；双表、清单+表、机制+实例能真实拟合，保字号与完整cells |
| P0-5 | QA能判密度偏低和碎页，auto确认前有界replan | content-qa、quality、outline runtime | 不以文本框面积/段落数证明密度；没有静默丢源、缩字、改用户页数 |
| P1-1 | 标准/详细、Prompt/Paste/File/Update统一语义成本 | generation-policy、content-depth、semantic、planning | 相同输入跨入口回归；双语显示成本/翻译关系分开；detail影响mustShow与cost |
| P1-2 | 改造Writer/Reviewer prompt，写结构化完整答案 | prompt-contracts、presentation-writing | reference profile进入contracts，局部短句不替代整体密度，完整阶段与比较关系可见 |
| P1-3 | 模拟器动态页数与真实模型同源A/B | simulation harness、跨域benchmark | 不为Factor Zoo写生产分支；页数减少须经过真实导出与覆盖/可读性检查 |
| P2-1 | 字形/行级实测、reference corpus扩展与投影检查 | render measurement、QA、研究fixtures | v1先以本附件为标准，扩展用于验证通用性，不随意更换默认密度风格 |
| P2-2 | 估算trace/cache与版本可解释性 | trace/store/planning | 保存profile、group、fit、initial/final counts及原因；缓存key含模板/policy/语言/模型与profile版本 |

**推荐第一批必须联动交付P0-1～P0-5。** 单独调2700、改overview比例、提高每页point上限、把源表放更大区域、在prompt里加“像Gamma一样密集”，都不能完成从估算到写作到最终可见密度的闭环。

建议交付顺序：校准附件数据与统计 → 语义分组/packing及auto/explicit边界 → 组合结构与统一容量 → QA与真实导出 → 跨入口/模式/领域回归 → 真实模型对照。产品workflow步骤不变，commit留待实施与验收阶段。
