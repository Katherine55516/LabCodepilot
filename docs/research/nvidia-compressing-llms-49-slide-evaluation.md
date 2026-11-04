# 49 页 LLM Compression 输出评估与 PPT 模块改进方案

评估日期：2026-09-28。对象是 [`outputs/nvidia-compressing-llms-gamma-template-semantic-repaired-49-slides-simulated.pptx`](../../outputs/nvidia-compressing-llms-gamma-template-semantic-repaired-49-slides-simulated.pptx)，对照输入 `/Users/dongli/Documents/NVIDIA_Compressing_LLMs/compressing_LLMs.html`、模板 `/Users/dongli/Documents/ChatGPT/CodePilot/Gamma-AI.pptx`、同名 `.run.json` 和当前 PPT 模块代码。逐页抽取 PPTX 对象文字，并用 LibreOffice 将**当前文件**重新渲染为 49 页 PDF、逐页检查。本文评价的是这一次样例，不把模拟模型的表现直接归咎于生产 LLM。

## 1. 结论与边界

这份文件已经实现了**可打开、49 页、原生模板组件保留、主要章节顺序合理**的演示草稿。相较此前截图中的断词、严重错位，当前渲染没有发现同等级的大面积遮挡。它可以作为课程目录和内容骨架供编辑，但**尚不达到可直接用于职场汇报或技术培训交付的内容标准**：正文过于抽象，重要来源数字和算例没有进入页面，所谓“evidence”页没有证据，来源页没有具体出处，很多装饰图形没有解释所讲机制。

这次运行使用 `simulated-structured-llm`，`externalApiUsed=false`；49 次内容调用的响应由本地手工策划事实的模拟器提供，整稿模型评审返回空数组。`handlePpt` 状态机与模块脚本在本机运行，`coworkSandbox=false`，未验证真实模型和 Docker/Cowork 部署环境。以下问题中，“for comparison”等凑字尾语可以直接归因于样例模拟器；**数值缺失、占位图与真实机制不匹配、来源映射误报覆盖、质量门禁容许证据缺失**，则在现有代码规则中确有可复现的结构性原因。

| 维度 | 评估 | 依据 |
|---|---|---|
| PPTX 技术完整性 | 基本通过 | 49 页可渲染；原生模板文本、形状和媒体仍在；未见中文乱码（本次为英文稿）或全页空白。 |
| 内容与来源一致性 | 有条件通过 | 主要主题与原文相符，但大量具体事实被概括掉；部分图解关系不足以表达原文。未发现可证明的系统性事实编造，不等于事实已充分核验。 |
| 证据密度与可追溯性 | 不通过 | 无带单位的量化结论、无可见出处；第 36–37 页声称“evidence”却没有数值、比较图或明确样本。 |
| 叙事与信息密度 | 需重写 | 49 页以课程小节铺开，摘要、决策启示和量化结论薄弱；个别页面信息很少，部分页面重复类似规则。 |
| 版式与语义适配 | 需改进 | 模板风格保住，但大量建筑照片、冰山和半环图与模型压缩主题没有语义关系；流程顺序与图形排列不一致。 |
| 投影可读性 | 不通过 | 有明确字号的 816 个文本 run 中，701 个低于 18 pt，中位数 12.5 pt；模板自身也有小字，因此是模板适用性和长稿扩展问题，并非全由导出器改坏。 |

以上“通过/不通过”是本次用途的编辑评估，不是自动化单测判定。若用户目标只是课程提纲而非 49 页可讲解材料，内容深度要求可以调低；但第 36–37 页和来源页的标题与正文不符，仍应修复。

## 2. 可核实的量化结果

- 来源约 82,237 个提取字符、903 个 source segment、103 个 semantic chunk；最终 49 页。模块自动估计 49 页（范围 40–58），用户这次没有手动指定页数。
- 页级 `sourceChunks` 的并集是 103/103，41/41 高优先级 chunk 均被标为覆盖；但页级 `sourceRefs` 并集只有 403/903。**这些数字只是引用映射，不代表事实进入可见页面。**
- 页面文字约 2,500 个英文词，中位数每页约 48 词。PPTX 可见文本中，没有“数值＋GB/PFLOPS/TPS/ms/%/bit 等单位”的量化证据。原文明确写有 NVFP4 约 4.5 bits/value、Hopper/Blackwell/Blackwell Ultra 2/10/15 PFLOPS、Llama-3.2-3B 约 3.21B 参数的组件算例、GB200 在指定负载下约 10,000 TPS/GPU 与约 50 TPS/user 等。把这些例子放回页面时必须连同硬件、模型、负载与来源限定词写清，不能只搬数字。
- 模板只有 10 页原始页。源模板第 2、3、7、8、9 页各复用 7 次；同一张占页面约 38% 面积的建筑照片出现在 11 页。复用变体改变裁切和版式，但视觉主题仍明显重复。
- 自动质量结果是 `passed_with_warnings`：101 个确定性问题，其中 100 个 `image_resolution`、1 个 `report_small_text`；`hardErrors=0`。编辑性报告另外显示 `needs_review`，指出 49 页正文槽位小于 18 pt。整稿模型评审四类问题均为空，因为此运行使用了空的模拟评审响应。共记录 36 次事后修复（33 次 `under_expanded`、3 次 `layout_density`），仍留下下述内容问题。
- 文件中的 `sourceRefs` 主要存在于项目/运行数据，不是页面上可读的引文；结尾第 49 页也没有文献名、链接、页码或可追踪的来源标识。不能把“有内部来源编号”等同于交付物可追溯。

## 3. 逐页评估

标记：**高**＝影响结论或技术准确表达，**中**＝削弱讲解/视觉，**低**＝编辑完善。没有列出的错误不表示已经逐事实验证了该页。

| 页 | 页面 | 评估与具体改动 |
|---:|---|---|
| 1 | LLM Compression | 中：封面副标题 “Three ways to serve LLMs” 与全稿的三种**压缩方法**不等义；换成明确范围与目标。 |
| 2 | The trade-offs | 高：摘要只有通用“质量、内存、计算、恢复”与公平比较原则；加入由来源支持的 2–3 个具体结论和适用边界，形成真正的阅读入口。 |
| 3 | Course roadmap | 低：章节路径清楚；如果目标是职场报告，课程/Notebook 导航应放附录或改成“问题→方法→证据→决策”目录。 |
| 4 | Cost versus quality | 中：只说权衡，没有使用原文的显存工作例；建筑图占 38% 画面，却没有解释成本。应换成显存组成或测量框架。 |
| 5 | Three levers | 中：“三种杠杆”却显示四张卡；`Teach students`、`Mix / All three` 太空泛，需在第四卡明确“组合顺序与前提”。 |
| 6 | Pipeline order | **高**：标题讲先后顺序，六卡围绕 `Orders` 中心排列，无箭头/两条分支，容易把两种 NVIDIA 路径误读成同一循环；改成两条有向链。 |
| 7 | Measure a baseline | 中：原则正确，但与第 4 页的 baseline 再次重合；应补本课程评测输入、指标或作为实际评测表。 |
| 8 | Structured pruning | 中：冰山图与结构化剪枝无对应关系；“dense/sparse”应有操作前后结构示意。 |
| 9 | Choose what to cut | 低：采样→排名→验证清楚，但缺具体 PPL/BI 测量口径；可承接第 11 页，避免两个页面重复概述。 |
| 10 | Depth pruning | 中：三个步骤可读，却没有模型层数或参数变化算例，留白较多。 |
| 11 | PPL versus BI | **高**：这是核心方法比较页，却只有 4 组短句，大片空白；需要相同输入下的评估次数、成本、排序依据和何时选用的对照。 |
| 12 | Pruning guardrails | 中：半环图不表达“小步、保护边缘层”的因果或顺序；文字贴在图周边且偏小，改为规则＋失败条件。 |
| 13 | Width pruning | 中：冰山图误导“头、神经元、通道”之间像层级剖面；改成被裁剪的模型结构与尺寸标注。 |
| 14 | Size the target | **高**：标题指向参数预算，来源含 3.21B 模型组件与 28→24 层算例，页面却没有一项计算结果或公式；应改为参数表/大数字。 |
| 15 | Architecture search | 中：只描述“设预算、搜候选、选模型”，缺候选空间与评价指标实例；建筑图重复。 |
| 16 | Pruning in practice | 中：Meta/NVIDIA/NAS 卡片是标签，不是案例证据；用“输入模型→裁剪→恢复→结果/局限”对应同一案例。 |
| 17 | Notebook 1 | 中：小字分布在半环四周；课程操作步骤与图无对应，宜改成编号实验流程与待记录指标。 |
| 18 | Teacher and student | 中：概念基本正确，冰山图没有教师到学生的知识传递方向；换有向关系。 |
| 19 | Hard versus soft | **高**：重要对比仅四块短语，大片空白；应同轴比较训练目标、信息量、代价和使用场景。 |
| 20 | Synthetic data | 中：图上的编号视觉顺序呈 2、1、3，读者需来回找；本页正文是“先生成、再过滤、再训练”，应按阅读顺序排版并核对操作先后。 |
| 21 | Soft targets | 中：讲解尚可，但再次出现同一建筑图；应显示 teacher/student logits→softmax→loss 的小机制图。 |
| 22 | Distillation loss | **高**：`NLL/Blend/Guide/Soft` 等散卡没有说明 NLL 与 KL 等目标如何组成损失，`Predict the observed next token for comparison` 是不完整的伪解释；需公式或明确关系式。 |
| 23 | Minitron method | 中：半环图没有表示剪枝→蒸馏的时间顺序；容量限制与恢复关系应放进同一有向链。 |
| 24 | Iterative recovery | **高**：`Avoid a single large.` 是残句；三处 `for comparison` 是凑长度的模拟器尾语；保留“小步裁剪→测量→恢复→停止阈值”的真实讲解。 |
| 25 | Why distil? | 中：`Targets/Data/Compare/Limit/Student` 只是标签；改为同计算预算下“从头训练 vs 蒸馏”的可核对比较。 |
| 26 | Industry distillation | 中：Gemma/Flash 两例过于简略，没有明确哪一项是原文事实、哪一项是解释；需要案例对象和限定词。 |
| 27 | Notebook 2 | 低：能读出训练动作；仍是同一建筑图＋三卡，与第 3/9/15/39/46 页视觉近似。 |
| 28 | Lower precision | 中：页面讲内存/带宽/计算，半环图只起装饰作用；用字节流或数据路径图更合适。 |
| 29 | Float formats | 中：编号视觉顺序 2、1、3；应按 sign→exponent→mantissa 顺序，并给出格式示例。 |
| 30 | NVFP4 structure | **高**：全页没有 NVFP4 的实际位宽、block 大小与 scale 构成；标题承诺“structure”，内容只有概括。 |
| 31 | Why blocks matter | 中：冰山图不代表异常值影响全局 scale；原文有合成权重对照，应转成两组比例/量化误差示意。 |
| 32 | Inference formats | 中：编号 2、1、3 与正常阅读顺序不符；FP8、NVFP4、INT8 的硬件边界与比较轴不足。 |
| 33 | PTQ | 中：四句定义型内容散在大片空白，缺校准输入、scale 选择和评价输出的流程。 |
| 34 | QAT | **高**：六个双词卡片围绕 `QAT`，没有解释 fake quantization、梯度近似、更新对象之间的有向关系。 |
| 35 | QAD | 中：教师指导与学生关系只靠文字，半环图不表达训练信号。 |
| 36 | PTQ evidence | **高**：没有任何结果值、图表、误差或明确 benchmark，却名为“evidence”；必须填来源证据或改标题为“评估准则”。 |
| 37 | QAD evidence | **高**：同样没有 QAD 实验结果；仅陈述常识。不得让 `evidence` 标签与页面证据脱节。 |
| 38 | Industry low bits | 中：混用训练精度、推理量化和端侧应用三个不同层级的案例；应分清概念/案例及来源条件。`for comparison` 为模拟器凑字。 |
| 39 | Notebook 3 | 低：阶段顺序清楚，但读者还不知道实际质量数值如何变化；可以承接第 36–37 页的图表。 |
| 40 | Deployment path | 中：半环不能表示 checkpoint→服务→流量→测量；第 45/47/48 页再述类似路径，建议合并分层。 |
| 41 | Inference metrics | **高**：TTFT、ITL、throughput 有定义却无单位、测量公式或解释范围；信息量远低于四宫格版式可容纳内容。 |
| 42 | Serving trade-off | **高**：有每用户速度与每 GPU 吞吐的概念，却没有原文的 TPS 曲线或带负载条件的例子；建筑图占 38% 面积。 |
| 43 | Load testing | 中：冰山装饰与压测无关；应画并发数→请求→度量→曲线的链路。 |
| 44 | vLLM serving | 中：三个机制可读，但编号 2、1、3 不合阅读习惯；与上一页应明确“系统机制”和“测试方法”的分工。 |
| 45 | Benchmark workflow | 中：内容重复第 41–43 页的原则，大片空白；可放真实实验协议、输入长度、并发档位和输出表。 |
| 46 | Notebook 4 | 中：操作点重复第 45 页；应转成实际实验记录模板或附录。 |
| 47 | Assessment path | 中：半环不表达基线、剪枝、恢复、量化、部署的完整评估次序；“医学领域新任务”缺前提与评价目标。 |
| 48 | Practical rules | 中：`Base/Quant/Prune/Distil/Serve/Compare` 为散卡，不能代替流程图；与第 40/47 页重复。 |
| 49 | Sources and limits | **高**：声称有来源、估算和后续论文工具，但没有一条具体引文、链接或文档定位；需列来源文件、章节/页段、估算标记和未核实事项。 |

## 4. 根因：发生在现有节点的哪一层

1. **页数规划优先保留主题，未设证据配额。** `ppt-planning.mjs::estimatePageRecommendation` 用语义 token、章节数、高优先级 chunk 估算 49 页；算法没有根据目标受众、演讲时长、每页最低独立证据、图表容量调整。`sourcePlanningContext` 对 103 个 chunk 使用 28k 字符预算并截断 chunk 详情。结果适合作提纲，不保证 49 页都有独立论证。
2. **“覆盖”的定义太弱。** `coverageMap` 只要某页引用 chunk ID 就判 `included`；`ppt-content-qa.mjs::inspectContent` 随后报告 `coverageRatio=1`。它没有核对 chunk 中应保留的数字、算例、机制或限制是否出现在可见 `slotTexts`。`requiredDetailCoverage≈0.996` 也主要做关键词包含和“任一 token”匹配，不能证明原子事实被完整表达。
3. **页级检索可能丢掉关键证据。** `retrieveSlideSources` 对每页只召回 6/8 个 chunk，最后保留最多 12 个 sourceRef；`contentPrompt` 对每个 chunk 取前 900 字，对来源总量再限约 16k。长章节后半段的表格/量化结果在文案阶段可能不可见。要在实际运行中记录每页哪些 evidence atom 被召回和使用，不能仅靠 chunk ID。
4. **模板匹配只给软惩罚，且只处罚“太满”。** `templateContentFit` 对 role/visual 误配只加分数，容量惩罚只在目标语义单元超过模板容量时发生；没有惩罚大面积空白、装饰图与主题无关。扩页器为了保留 10 张原生模板页并凑足 49 页，反复使用建筑、冰山、半环和散卡。`visualSimilarityPairs` 主要约束相邻页，看不到第 4/7/10/14 页这类隔页重复。
5. **填槽检查管字数/重复，不管关系和证据。** `inspectTemplateSlotDraft` 检查片段、槽容量、字数下限、精确重复；不验证模板的序号阅读顺序，不验证“evidence”是否真有证据、不验证图解是否表达来源里的因果/流程。模拟器为了达到 `minVisualUnits` 增加无意义尾语；生产模型虽不一定照做，但长度下限作为硬约束有相同诱因。
6. **整稿评审的输入和阻断边界不够。** `deckReviewPrompt` 每页最多取 12 个可见 slot，来源仅取每页前两个 ref、最多 120 个 segment；49 页时无法确认所有可见文字与来源。此次评审还被模拟为空响应。`finalQualityReport` 仅在确定性 hard error 时 `blocked`，模型指出缺失或冲突也只形成 warning，`report.status=needs_review` 与可发布状态并存。
7. **媒体警报噪声掩盖内容警报。** `inspectMedia` 只要原图小于 640×360 就提示，不考虑图像在页面上只占一个小图标还是 38% 的大照片。本次 100 个此类警告使真正重要的“49 页小字”埋在列表里。

## 5. 在既有架构与 workflow 内实施的顺序

保持 `source ingest → outline → bounded parallel content → layout/render → deterministic + model review → repair → publish` 的 DAG、持久化 Run/Event、IR v3、原生 PPTX 导出不变；下面是**节点内部数据契约和判定逻辑**的改造方案，本轮尚未改代码。

### P0：先修“来源事实已映射但实际消失”

- 在现有 `ppt-semantic.mjs` 的 chunk 内提取可追溯的 `EvidenceAtom`：`id、sourceRef、chunkId、location、kind（number/example/mechanism/constraint）、exactText、value、unit、qualifiers、confidence`。量化原子要带模型、硬件、负载、精度与“约/估算”等条件。不要要求每个 chunk 都有数字；只是让**源里有重要证据且页面声称作证据**时能够追踪它。
- `outline/slidePlan` 为每页增加 `claimIds / requiredEvidenceIds / narrativeRole / evidenceIntent`；`coverageMap` 从“引用了 chunk”升级为“哪些必讲事实进入了哪些可见页面”。保留旧 `chunkRefs/sourceRefs` 兼容字段。
- `retrieveSlideSources` 优先按 `requiredEvidenceIds` 获取原句所在的 segment 和邻近上下文，再使用原有 token 召回；不得因 `.slice(0, 12)` 丢掉本页锁定数值。记录 `retrieved → selected → rendered` 三层覆盖率到 run 报告。对数字做“值＋单位＋限定词”的完整性检查。
- 验收用这份 HTML：第 14 页应出现原始参数预算例子，第 30/31 页应出现 NVFP4 位宽与 block-scale 结构，第 36/37 页要么显示对应结果和条件，要么把标题改成“评估方法/判断原则”；第 42 页应出现服务吞吐/响应速度的具体且有条件的比较。没有来源时必须明确“无可用量化数据”。

### P1：让内容页有独立论证，而不是靠 49 个标题撑满

- 在现有 Brief/Story Planner 内区分 `course walkthrough`、`technical explainer`、`workplace report` 的受众任务；输出页数仍服从“用户手调 > 模块估算 > 模板”。自动估算时增加“独立主张/证据数”和投影字号容量，不要让 49 个主题天然等于 49 张主文。
- 每页计划固定 `question → claim → mechanism/example/evidence → takeaway`，并标注本页与前后页的增量。第 7/4、40/45/47/48 页跨页复述应在规划中被发现；可通过“概念页→算例页→决策页”形成递进，或将不适合主文的 Notebook 操作移到附录。用户坚持 49 页时，允许有课程附录，但应显式标识，不能靠同义改写或装饰卡凑页。
- `contentPrompt` 对 evidence/metric/comparison 页要求结构化数值或来源标记；对 definition 页允许无数字。`minVisualUnits` 不应通过词尾填充满足：若来源不足，应缩减槽数量或改版式、标为待补来源。为模拟适配器加入与生产相同的“无凑字”规则，并建立真实 LLM 对照运行。

### P2：用“语义适配的模板变体”取代无条件保留装饰组件

- 在 `ppt-template-scheduler.mjs` 为模板页/媒体建立 `purpose、semanticRoles、visualCapacity、visualType、assetFingerprint、readingOrder`；`templateContentFit` 对**过满与过空**双向处罚。保留原生形状与字体，但允许经过定义的安全变体隐藏/替换**与内容不相关的装饰媒体**，以来源图表、参数表或原生形状重画的机制图替代。
- 给图片/图解建立非相邻复用预算；11 页同一大照片不应默认允许。若用户要求严格保留模板媒体，则在 UI/运行报告提示“模板保真优先导致内容语义图不足”，并选择最少误导的版式，不把冰山图当 NVFP4 block diagram。
- 读序从真实 shape 坐标和固定数字标签推导：像第 20/29/32/44 页的 `2、1、3` 必须在匹配时拒绝或重新映射内容。流程必须有方向关系；无箭头的 hub 不能承载“Pipeline order/Assessment path”。
- 小字按实际投影尺寸和使用场景评价。模板样式为首选，但不能在 49 页技术报告中为保留字体大小牺牲阅读。若无法保持字号又保留全部源组件，提示更换版式、拆分/移附录或请用户接受较小投影字；不要静默缩小。

### P3：将编辑质量门禁从“文件可导出”升级到“内容可发布”

- 在 `ppt-content-qa.mjs` 加硬性规则：标题含 `evidence/results/benchmark/数据/结果` 时必须有可见的 `EvidenceAtom`（数字、图表、可复查的质性证据之一）；数字需匹配值、单位、范围、上下文；概念/样例类型不能混放却无说明。检测残句、模板编号乱序、卡片只有单词、跨页**语义**重复与缺少限定词。
- 对整稿模型评审提供分层摘要：每页 claim/visibleSlots/evidenceIds 与精确引用片段；49 页过长时，在**同一个既有 review 节点内部**先进行有界分片检查，最后一次整稿汇总，模型仍只报告缺失、重复、冲突、证据不足，不碰坐标。若必须严格遵守“一次整稿模型评审”，则先由确定性规则压缩成待审页面集，再用一次评审覆盖关键页；对未审页面不能声称 LLM 已审。
- `report.status=needs_review` 不得在 UI 呈现为“可直接发布”。保留草稿预览和导出，但对证据缺失、虚构/错误数字、严重截断设 `blocked`，可修复后再发布；纯装饰媒体/小图标低分辨率只保留轻警告。
- 质量报告按“事实与证据、语义与叙事、排版、媒体”分组，图片分辨率按放映尺寸的有效 DPI/像素密度和显示面积判断。让 100 个小图标警告不再淹没 1 个全稿字号问题。

### P4：回归验证与真实运行

1. 建立这份 HTML 的基准集：锁定第 14/22/30/36/37/42/49 页需要的 source atom 与反例；新增“有来源但丢事实”“evidence 页无证据”“错序图”“无意义填充”“隔页照片复用”“小字过多”用例。
2. 同一输入跑**真实项目 LLM API + 真实 Cowork 沙箱**一次，记录 outline/content/review 原始结构化响应、来源原子召回率、最终覆盖率和每页图像；模拟运行只能作为确定性管线测试。
3. 以 LibreOffice 渲染 49 页，逐页视觉审核与 PPTX 对象抽取双轨比对：无裁切/遮挡、标题和槽位读序一致、P0 证据在实际画面可读、数值和限定词一致；真实浏览器预览也应和导出一致。

**建议验收阈值**（需在实施前由产品确定）：全部标记为“必须出现”的 evidence atom 都出现在可见稿或被说明为明确省略；0 个无证据的 `evidence/results` 页；0 个残句与模拟器凑字；0 个关键流程错序；高面积媒体跨页重复达到预设预算；投影主文最小字号达到目标；模型评审不可为空响应却被当作“已通过”。“来源 100% chunk 映射”“没有 hard error”不再单独作为内容完成条件。

## 6. 本轮已做、未做

已验证当前 PPTX 可重新渲染为 49 页并逐页审阅；读取 PPTX 文字、字体、媒体哈希与 run 质量报告；从输入 HTML 核对上文列举的量化算例；定位当前代码中的页数、覆盖、检索、模板、填槽和门禁逻辑。**未改动 PPT 模块代码，未调用真实 LLM，未在 Cowork 容器内重新生成，未对来源中每一个行业案例逐条做外部事实查核。**
