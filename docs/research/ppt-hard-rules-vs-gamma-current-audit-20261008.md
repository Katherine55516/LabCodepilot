# PPT module 与 Gamma：Hard rules 差异、当前状态与剩余修复审计

日期：2026-10-08。对象：当前工作区代码，包含尚未提交的输入范围与共享渲染契约变更；不能仅用 Git HEAD 判断实现状态。第 1–10 节记录修复前代码审计、负向复现、既有回归、Gamma 成品核验；当时未修改生产 Prompt/code。**后续实施见第 18 节：已修改生产 Prompt/code 并完成本地回归。** 没有重新生成 Gamma 文稿，不讨论 Gamma 成本模型。

补充说明：第 11–17 节为五项 P0 的原始实施讨论和目标验收条件；第 18 节区分实际落地、证据及未覆盖部分。第 1–10 节保留修复前复现口径，不应当作现在仍允许坏稿发布的结论。

## 1. 主要结论

当前模块已经从“让模型填模板”改进为来源清单、内容归属、容量预测、语义审查、版本与发布门禁共同约束的 pipeline。输入范围、代码/表格结构、正负值图、图片 fit/crop、跨视图文字契约都有实际改进。但仍不能认为“quality passed + export verified”就等于内容完整且画面可靠。

本轮最高优先级的发现是：

1. **导入原生 PPTX 的发布分支会删除确定性硬错误。** 相同的文本重叠、必需来源证据缺失，在 generic 项目被拦截，在 `externalPptx` 项目被过滤后允许进入发布。生产发布函数已复现，模型与 renderer 使用隔离测试替身。
2. **导出核验主要检查 payload 是否存在，缺少对象级渲染合同。** 五份真实、故意损坏的 PPTX 全部被当前 reopening verifier 判为 passed，包括页外文字、极小框、两个对象合为一个、图片实例减少和错误裁切。
3. **重叠检查同时存在误报和漏报。** 正常背景承载文字被报错；两个 locked 文本框重叠未被检查。矩形相交既不能直接等同“画面坏”，也不能因为 locked 就免检。
4. **必需细节仍被归一化截短，且完整性门禁强度不一致。** 324 字符条件说明被截为 160，尾部禁止条件不再进入 `requiredDetails`；其可见性检查仍为 warning，词覆盖也不能证明逻辑条件完整。
5. **模板媒体“等价替换”的依据仍过弱。** 未显式标为 protected 的模板图片，可以因为与 source region 相交而被移除，并由无对应关系的一般来源文字登记成 `replaced_equivalent`。显式 protected 的对照用例会正确阻断丢失。

Gamma 的优势有直接证据：按问题组织内容、组合不同组件、流式可视化、目标范围显式化、局部重排与 Before/After。Gamma 也存在可复查的问题：首次布局失败仍能导出、条件被压缩、局部改写会改变字号/公式表示，Agent 的自述与文件测量不完全一致。**应吸收其组织和编辑逻辑，保留 AIMate 更严格的事实边界；不能复制其带告警交付作为正确性的标准。**

## 2. “Hard rules”应如何定义

本报告不声称知道 Gamma 私有系统提示词、布局算法或服务器代码。外部观察不足以证明其“内部硬规则”。比较分四层：

| 层级 | 含义 | 本报告的证据要求 |
|---|---|---|
| H：代码硬规则 | 条件失败后确定性阻断，不由模型自述决定 | 代码路径、负向输入、实际返回/状态 |
| S：语义审查规则 | 必须调用审查、验证协议并阻断指定 findings；语义判断仍依赖模型 | 协议与缓存/发布测试；真实准确率另测 |
| P：Prompt/启发式 | 要求模型执行、容量/覆盖的近似预测、warning | 不能表述为绝对保证 |
| G：Gamma 外部行为 | UI、DOM/CSS、真实文件和局部前后差异 | 明确样本、模式和操作，不推广为所有路径 |

“至少 17pt”“每页 900–1100 字”“每章一页”“任何 nowrap 都错误”“输出不会遗漏”“模型说检查通过就是成功”均不能列为 Gamma 的通用硬规则。来源材料中名为 “Hard Rule” 的金融/研究原则，也不能误认为 Gamma 产品策略。

## 3. 样本、控制条件与 double check

### 3.1 Gamma 的观察依据

主档案：[Gamma 实机观察与核验](../../outputs/alpha-mining-gamma-live-observation-20261008/README.md)；详细记录见 [Alpha Mining 报告第 16–24 节](ppt-alpha-mining-layout-content-gamma-review-20261008.md#16-gamma-实机补充实验身份控制条件与证据边界)。另参考已有 [Gamma 模板拆解](/Users/dongli/Documents/ChatGPT/CodePilot/AIMate_PPT_Gamma_Template_Generation_Teardown.md)、[Prompt 深度评审](/Users/dongli/Documents/ChatGPT/CodePilot/AIMate_PPT_Prompt_Depth_Review_vs_Gamma.md) 和 [密度 packing 交接](../handover/ppt-gamma-density-packing.md)。旧 Classic/Paste 菜单与本次 Agent/Compiler 路径分开记录。

| 样本 | 控制条件 | 可用证据与限制 |
|---|---|---|
| Compiler / Alpha Mining 首次稿、单页修复稿 | 完整来源 14307 字符；Plan、Standard effort、Condense；显式选择英文下附中文；默认 Plan 20 页，因本次账户限制明确要求合并成 10 页 | 真实 UI/DOM、PPTX、Gamma PDF、逐页 PNG、代码与非目标页核验；10 页不是自动估算结论 |
| 用户提供的 Alpha-Mining.pptx | 同源 8 页参考；没有其完整创建轨迹 | 用于文件密度/组件对照，不能推断设置或和 Compiler 做严格同条件 A/B |
| Factor Zoo Gamma 参考 | 英文占主导，正文较密；密度 profile 的既有校准样本 | 是观察样本，不能作为跨语言、跨用途固定配额 |
| Tutorial 13 / Lecture Plan 旧实验 | 模板起始 8 卡，提示页数约 8，最终 9 卡 | 有生成/UI/局部编辑记录；该旧实验没有取得实际 PPTX，不用它证明导出保真 |

本轮新生成的 [Gamma 重新核验结果](../../outputs/ppt-hard-rules-gamma-audit-20261008/gamma-export-recheck.json) 与历史文件一致：两版 10 页；第 9 页代码逐字及 AST 等价；仅第 2 页文本/几何/shape 数改变；两版 PDF 可提取字符的页外计数均为 0。该计数**不证明内部无遮挡、足够边距或字号可读**。

初始 PPTX SHA-256：`8ccdf46245d41aa886d48dab2cb60467a219119f7afbb6560d8765c1618337f9`；修复稿：`cd6a2afe98439dff13ccb7eeeb389d12fdfbcf9b808d5363a8b0e6d19210660b`。输入 SHA-256：`f7aec434d5496f9b4c2d114ecf26648eeda45fa1544837f59499de3d394f7c5d`。

本轮复查初始/修复第 2 页大图、修复稿全页联系表，以及模块最新生产 PDF 渲染 fixture。Gamma 初始第 2 页贴近底部的条件/问题区域，修复后被重新分组进两列，明显增加底部空间；新的模块 fixture 中中文、代码缩进、空表格单元、负值向下、USD 单位均可见。旧 Alpha generic-route 成品的遮罩损失和旧字体问题不能直接当作当前保真路径的新缺陷。

### 3.2 当前模块的证据身份

审计的是当前工作区文件。关键代码 SHA-256 已保存于 [代码快照](../../outputs/ppt-hard-rules-gamma-audit-20261008/code-snapshot-hashes.json)。本轮未用历史坏稿冒充最新代码生成结果。

新证据在 [本轮审计目录](../../outputs/ppt-hard-rules-gamma-audit-20261008/README.md)：生产函数测试、5 个实际 PPTX 负向文件、对应 manifests、重新打开的结果、4 组回归日志。发布隔离测试不产生实际已发布用户稿，使用模拟 clean critic 和成功 renderer；文件核验负向测试直接读真实 PPTX，无模型/renderer 替身。

## 4. 逐项规则对照

| 规则/维度 | Gamma 的确认行为 | 模块当前机制 | 差异、强度与剩余问题 |
|---|---|---|---|
| 输入事实边界 | Condense、计划与局部请求可约束；样本仍发生条件压缩/遗漏 | 原始 `INPUT_FRAMEWORK`、模板不作为事实、bounded explanation、逐页 scopeAudit | 模块 S 层更明确；真实模型准确率未测，不能把 hash/complete 当语义证明 |
| 框架内补充 | 生成机制解释、标题与连接关系 | 仅允许解释既有对象/关系，禁止新议程、数字、引用、责任承诺 | 规则方向正确；需要每项补充的 topic/claim anchor，而不是词汇一致性 |
| 标准/详细与语言 | 本次 Condense、显式双语；旧模式选项不同 | balanced/detailed、跟随 input 混合语言；局部翻译有显式 override | 不照搬 Gamma 默认双语；混合输入、译文成对事实需真实模型验收 |
| 页数初值/估算 | 模板与 Plan 可改；默认 20→人为 10；旧例 8→9 | 模板初值、内容估算、候选 grouping/packing、显式/确认页数冻结 | 不应以模板页数、章节数或 Gamma 某次账户上限定页；profile 仍单样本 |
| 内容归属与重复 | 本次主要内容承担不同任务；必要回指保留 | claim primary owner、unique visible copy、repeatPurpose、无 filler 规则 | 明显改进；同义改写与伪造 recap 用途仍需语义审查，不能只看字串/ID |
| 全面性/深度 | 11 章有覆盖，但参数、职责、条件等被压缩 | 覆盖、requiredEvidence、结构对象 ledger、requiredDetails、critic missing/shallow | 章节覆盖≠细节覆盖；requiredDetails 截断与 warning 使规则不够硬 |
| 论点/标题 | 陈述性标题与内容任务一致；对照/流程/代码分配独立页 | question、headlineIntent、owned/key points、支持与条件写作 guide | 有 P/S 规则；还缺真实多输入标题承诺与可见内容一致性评价 |
| 内容密度 | 随语言、角色、图示变化；没有固定字数保证 | 宽度单位、typed components、物理容量、unique 信息，低密度 warning | 单 Factor Zoo target 仍影响估算；需多角色 profile，禁止为了达标重复 |
| 页面尺寸 | 本次文件约 960×540pt，16:9；viewport 随面板缩放 | Render Tree/Canvas/原生输出读取 logical size，generic 默认16:9 | generation monitor 仍有 aspect-video 外框，custom/4:3 展示一致性待修 |
| 换行/段落 | CSS pre-wrap、break-word、normal；代码硬换行独立；PPTX wrap True/False 混用 | 共享 text contract：padding、paragraph/runs、换行、固定框 | 比旧版统一 nowrap 好；measureText 是近似，不是实际 font shaping |
| 字号/缩放 | Page setup 17pt 不是通用下限；代码13、caption12.5，修复正文14.5；局部 fontsize 会变 | 非 native 正文最低14pt、native 保留原字号、按容量阻断 | 没有“Gamma 绝不缩字”；模块需按角色可读性与 native 继承字体判断 |
| 重叠/裁切 | 初始页失败，局部重排改善；首稿仍可导出 | IR 容量、边界、矩形重叠、table cell capacity | 当前 overlap 锁定漏检/背景误报，external publish 还过滤它 |
| code/table/process | 本次代码完整，步骤卡片关系清晰；没有验证 Gamma 原生 data chart/table 行为 | CSV/table/code typed ingestion、原文代码、矩阵/行范围、流程 inventory | 常规结构已修；超长续页、merged cells、扫描 PDF、任意拓扑仍待补 |
| 图表数值/单位 | 当前 Gamma 样本主要是文字/图示，缺少有正负值的 native chart 控制实验 | signed axis、原生数据、单位、pie 非负校验 | 模块已修负值；多 series/长标签与实际图像语义核验仍不足 |
| 源媒体义务 | 观察到图示/装饰；不能证明所有源图被完整保留 | required source image、caption、typed object ledger、用户批准排除 | 明确来源媒体已有 H 门禁；模板媒体未标角色时“等价”仍过宽 |
| 图片 crop/mask | 本次 reexport 图像像素/字节有差异，来源/位置未变；原因未隔离 | 共享 fit/crop；正确 native export 保留曲线遮罩 | positive 应保留；复杂 mask preview 近似，reopening 尚不检查 crop/mask |
| local AI target | Card/Heading scope chip、浮动 composer、主聊天同步；实测单页仅改变目标页 | 对象/页/章节/范围 proposal、candidate hash、revision、apply/undo | 模块版本机制强；Heading 执行、所有 scope 的真实模型准确性未全测 |
| AI 候选完整性 | 修改解释与 Before/After；解释与字号实测有出入 | deterministic introduced errors + required evidence、语义范围审查 | 不能只信解释；requiredDetails/缺失严重级、语义性 asset 改动需补门禁 |
| 生成中修改 | 本轮观察到聊天/Stop，未实测运行中新增要求；旧实验有排队证据 | scope snapshot、epoch、冻结/冲突、队列与 stale 结果拒绝 | 当前机制不能说来自本次 Gamma 已验证同样实现；全失败/恢复矩阵仍应常测 |
| 进度状态 | writing/images/checking/polishing；9/10 失败信息可见 | 内容完成、preview/renderReady、全稿 review 状态分离 | 两者都需区分活动/结果；完成数不能代替对应 revision 的质量证据 |
| publish/export | 真实 PPTX/PDF 可导出，初始失败页未被硬封锁 | deterministic+semantic review→publish→reopening verify | 模块设计更严格；external 漏洞与弱 export contract 削弱实际保证 |
| 全局样式/Visuals | 主题字体/色彩/Logo/Images 等与局部内容入口分开 | 模板 tokens、局部 style/asset；可选 visual 增强留后续 | 先修事实/渲染；装饰图不应冒充证据，不能以固定图片数验收 |

## 5. 新复现：规则在哪里失效

### F1 / P0：externalPptx 发布过滤掉确定性错误

代码：[publish-service.mjs:26](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt/publish-service.mjs:26)。`reviewProject` 已发现错误，随后 external 分支仅保留列举的 code，再按过滤结果计算 `hardErrors`。白名单不包括 `render_overlap`、`required_evidence_missing`；其他遗漏的内容/主题/数值/对比度 code 也需要逐项审计，不能推定只漏两项。

| 隔离用例 | 发布前 error | generic 结果 | external 结果 |
|---|---|---|---|
| 两个可编辑文本框重叠 | render_overlap | blocked、renderer 0 次 | error 被删除、published=true、renderer 1 次 |
| 锁定 benchmark 的数值/单位未呈现 | required_evidence_missing | blocked、renderer 0 次 | error 被删除、published=true、renderer 1 次 |

这证明 **clean critic 不能弥补被删除的确定性错误**。没有证明线上任何模型必然漏掉该错误；但发布正确性不能依赖 critic 每次恰好抓回确定性检测已找到的问题。也不要把 `externalPptx` 分支泛指为所有 templateFidelity 保真模板：它们是不同路由。

修法：取消 broad whitelist；校验器根据对象来源/能力产生准确 severity。确实不适用的规则使用明确 applicability、原因和测试，保留原发现；所有 route 共用不可降级的 critical gate。native 的合理版式叠放应在 overlap classifier 中解决，不能在 publish 删除所有 overlap。

验收：上述两例 external 也 blocked；新增错误 code 默认不能免检；导入、generic、模板 preserve、更新、局部编辑、重试/再次发布各路径都跑同一错误矩阵。

### F2 / P0：export verified 不足以证明对象和画面保持

代码：[ppt-export-integrity.mjs:4](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-export-integrity.mjs:4)。manifest 仅有 id/type/sourceArtifact/content，缺少几何、文字合同、crop/mask/角色；普通文字用整页文本包含匹配。图片使用 hash 集合，不消耗已匹配的 picture 实例。source table/math 有更强的对象匹配，但不能据此宣称所有对象都有一对一核验。

本轮 [实际文件结果](../../outputs/ppt-hard-rules-gamma-audit-20261008/export-audit-results.json)：

| 真实负向 PPTX | 缺陷 | verifier |
|---|---|---|
| collapsed-text-objects | 两个期望文字对象只导出一个合并框 | passed |
| offslide-text | 必需文字完全放到页面右侧之外 | passed |
| clipped-long-text | 长段落放进 0.2×0.05in 极小框 | passed |
| missing-image-instance | 两个同 hash 图片实例只导出一个 | passed，仍报告 imagesChecked=2 |
| wrong-image-crop | 同图片 payload 被裁掉左侧80% | passed |

这些复现直接测试 reopening verifier，不声称生产 renderer 自然生成了这些错误；它们证明下游损坏无法由当前核验发现。IR render gate 可能拦住 IR 本身的页外框，但无法发现 exporter 将正确 IR 错写为另一个框，所以两道检查都必要。

修法：manifest v2 携带 revision/renderHash、稳定 object instance ID、期望数量、逻辑框/rotation/zOrder、完整 text contract、字体/段落/runs、图片 assetHash 与 crop/fit/mask、所有 chart series/单位/轴语义、table 行列/样式、数学树。导出映射建立一对一对应，匹配对象被 consumed；不要仅依赖 shape name 或全文 substring。对有意的对象合并/拆分，用显式 mapping 证明全部内容与阅读关系。

随后转换实际成品做 rendered visibility 核验；存储 conversion engine/font fingerprint、revision 和产物 hash。OOXML 验证负责结构，实际 render 检查负责可见/遮挡/裁切，两者不能互替。

当前 `acceptExportVerification` 正确保留 `visualVerified:false`，不应改成自动 true。验收要求五份负向文件拒绝；正常多处复用同图、代码/表/数学、合法 crop/mask 与显式 group 映射通过；实际渲染证据绑定同 revision。

### F3 / P0：overlap 的判定对象与意义不正确

代码：[render-audit.mjs:9](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt/render-audit.mjs:9)。当前 pairwise 集合排除 `locked`，其余合法矩形一相交就报 error。

生产函数复现：灰色矩形背景内放短文字→`render_overlap`；两个 locked 短文字同框→无 overlap issue。locked 仅表示用户操作权限，不表示文字允许被遮挡；容器/背景内的文字则属于正常叠放。

修法：全部可见内容参与检查；区分 background/container/mask/image/text/data，检查层级、实际文本/图像 ink bounds、旋转与遮挡比例、透明度、group、明确的 containment/overlay 意图。合法叠放不是默认错误；必需文本被遮挡、互相撞字或侵入保护区为 hard error。先用类型/关系修正明显误判，再接实际字体/成品测量。

验收：背景+前景通过；locked/unlocked 两类真正撞字都失败；背景图、水印、卡片、曲线遮罩、图标标签、半透明遮层、旋转框与同组组合均有正负例；不得靠 external 发布过滤掩盖误报。

### F4 / P0：必需说明截短与遗漏只告警

代码：[ppt-planning.mjs:292](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-planning.mjs:292) 的 `requiredDetails` 直接 `.slice(0,160)`；`mustInclude`、supportingPoints 等也有截短。[ppt-content-qa.mjs:300](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-content-qa.mjs:300) 用词覆盖近似判定，未覆盖的 required detail 仍是 warning。[ppt-quality.mjs:379](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-quality.mjs:379) 中 model missing 是否为 error 依赖 strictCoverage。

本轮 324 字符来源说明在 plan 中变成 160 字符，尾部 `do not apply ... when validation fails` 消失。`INPUT_FRAMEWORK` 仍保留完整原文，所以不能说所有模型上下文都被截断；问题是计划及其确定性义务已经变弱，模型需要额外发现并补救。

修法：预算可以摘要，**必需事实义务不能摘要后替代原义务**。以 source/claim ID + span/完整文本表达 condition、negation、unit、comparison、exception、uncertainty、sequence；超预算显式拆分或返回 capacity conflict，不 silent truncate。每项区分 mandatory / optional / approved compression；必需遗漏独立于“丰富输入 strict”成为硬错误。模型判 shallow 与可选深度不足可维持 warning，避免所有小 label/封面被过度约束。

验收：长条件尾部、中文否定、双语对照、法律/业务例外、实验限制、数值单位必须保留。paraphrase 能通过但改变否定/条件不能通过；明确用户批准的压缩记录哪些义务排除及原因。局部优化也跑该义务差分，不能只保护数字 evidence。

### F5 / P0：模板媒体的“等价”不能由同一区域和文字存在证明

代码：[ppt-source-artifacts.mjs:16](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-source-artifacts.mjs:16) 自动按 region overlap≥35% 登记替换；[ppt-object-integrity.mjs:68](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-object-integrity.mjs:68) 接受 sourceArtifact replacements，甚至仅有 omission reason 的未保护模板资产可被登记 excluded_approved。

复现：未标 protected 的三步示意图片，在相交 region 被移除；只有无对应关系的 SummaryBlock 文字时，ledger 返回 replaced_equivalent、issues=[]。将该图片显式标为 semanticDiagram，丢失则正确报 template_media_unaccounted。这说明已有保护机制有效，但入口角色判定和等价证据不足。

修法：区分来源证据、品牌/视觉资产、承载关系的图示、旧模板样例内容和装饰。旧样例事实不转成来源，但图示可以用本次输入适配同类关系。`replaced_equivalent` 必须有 old object→new objects 映射、所承载关系/功能及验证；不能要求保留旧案例事实，也不能以普通段落替代所有媒体。`excluded_approved` 只用于真实批准，自动适配另设状态和记录；ambiguous 资产保守保留或提示冲突，不能伪装成 user approved。

验收：流程/对照/证据图/装饰图/品牌/旧样例分组测试；一段 prose 不能替代有必需箭头/顺序的图示；允许将旧案例三步图改成 source 支持的三步图；来源图片/公式/表不受 density reclaim 影响。

## 6. 当前已改进的部分与未完成边界

| 当前能力 | 现有正面证据 | 尚不能承诺 |
|---|---|---|
| 输入范围 harness | 原始 input 不被 brief、模板和 local edits 扩权；完整尾部进入 critic；无模型/缺少 scopeAudit/过期候选拒绝；14 个对抗协议场景通过 | 真实模型不会误判、漏判或假 complete；每个新增主张已有可验证来源 |
| anti-repeat / writing normalization | unique copy、primary owner、purposeful recap、保留不同机制/条件；21组 density 自检 | 换词重复或滥用 recap 永不漏检；同义重复的真实召回率 |
| 页面估算/packing | auto 候选可合并减页；explicit/confirmed 保持；rich prose/typed objects 更适配 | 所有领域和模板的估算与 Gamma 等价；不用单一密度 target 即可解决所有分布问题 |
| text/media contract | preview/generic/native 共用文字、表、image、chart 规则；真实 PPTX/PDF fixture、Chromium 检查 | Office 字体 shaping/继承 table cell styles、复杂 mask 完全一致；任何成功输出无 clipping |
| signed chart | 正负值/零值/轴/单位已改；最新生产 PDF 的负值向下 | 多 series、stacked、长标签、log axis 等复杂图表均已验收 |
| ingestion | CSV quoted multiline/空单元格、HTML/Markdown fenced code、代码缩进、原始矩阵保留 | OCR、任意 merged 表、跨页脚注关系、任意图/流程拓扑和超长结构续页 |
| native template fidelity | 正确保真路由维持 Alpha 曲线 image mask；当前中文 glyph 正常 | 所有 preview mask 与所有 Office/font 环境一致；弱角色媒体替换已解决 |
| edit/review version | revision、plan/hash、scope snapshot、epoch、candidate/apply gate | 所有 intent 类型都无语义旁路；用户接受页不受 semantic asset 改动影响 |
| quality/publication | deterministic 与模型审查、实际文件 reopening；不假报 visualVerified | external 规则与 generic 一致；verified 已覆盖几何/对象实例/最终可见性 |

现有范围审查是必要基础，但 `scopeAudit={hash,allSlideIDs,complete}` 只证明回答协议完整；模型返回 clean 时，代码仍无法独立知道其是否真正做过逐事实核对。应保留此门禁，增加 claim/义务证据和真实模型评估，不能把完整协议和语义准确率混为一谈。

## 7. 其他需要修复或补充的通用问题

### P1-A：密度需要多条件校准，不能强行逼近一份 Gamma

[ppt-density-profile.mjs:5](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-density-profile.mjs:5) 已声明统计非硬配额，但仍只返回 `gamma-reference-v1`。`pageCapacity` 的 target/high 被该 profile 与物理容量共同限制。

| Gamma 样本 | 正文中位 nonspace chars | 正文宽度单位中位 | 说明 |
|---|---:|---:|---|
| Factor Zoo 校准 | 1019 | 约674 | 英文占主导，不能成为所有输入最低字数 |
| 用户 Alpha 8 页参考 | 847 | 550.46 | 与新 Compiler 不同模板/条件 |
| Compiler 10 页首次稿 | 525 | 367.90 | 显式双语、混合图示、人工页数限制 |
| Compiler 单页修复稿 | 576 | 401.80 | 只有目标页变化；整体统计随之改变 |

这些数取自既有同口径 OOXML 统计，不能把字数、宽度单位、distinct facts 等同。实现应按 page role、language mix、template usable area、font metrics、结构类型与 source richness 选择 profile；按独立内容/必需结构的实际 fit 决定页数。密度低的合理图示/代码页应说明原因，不自动填 prose。title、教学回顾、图示 labels 与正文分开算；双语不把相同事实计两次。

### P1-B：更完整的事实/关系审查，降低模型自由发挥

当前 plan 很多普通 prose 义务由模型挑选；章节 refs 和合理主题不能证明每个机制、条件、结论已覆盖。建议 ingest 后形成 source-owned atomic obligations，writer 只负责表达/分组，critic 给每项 `supported / bounded_explanation / missing / conflict` 和来源 anchor；判断机制/条件变化，不用纯关键字匹配替代语义。

[input-scope-service.mjs:17](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt/input-scope-service.mjs:17) 对局部候选重点阻断 unsupported/conflicts，missing/repeated 的处理依赖其他质量门禁。应区分 harmless shortening 与删除 mandatory facts，精确处理目标页及新增/删除页。重复校验需要跨页 claim 含义、repeatPurpose 正当性，不只是 exact copy。

asset 分支也需复核：[typed-proposal.mjs:49](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt/typed-proposal.mjs:49) 可设置 image content.text；proposal 对 asset 没有与 data/structure 相同的 scopeAudit，apply 对 asset 也豁免。纯 crop/色彩无需语义审查，但更换语义图像或说明文字应按实际内容变化分类。**这是代码可见的待补路径审计，不是本轮已复现的端到端越界案例。** 不要以 mutation type 名称认定一定没有语义变化。

完整 INPUT_FRAMEWORK 还会与 source packet、全稿页面重复出现在 prompt 中。需长输入/长稿 context 预算与审查分片；每片保留对应完整义务及全局不变量，最终聚合覆盖所有页/义务。不允许通过再次截断尾部来解决预算，也不允许部分 review 伪装 complete。

### P1-C：本体渲染、复杂结构与可追踪续页

文字估算器 [render-contract.mjs:24](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt/render-contract.mjs:24) 使用近似宽度/行高；尚不具备实际 font shaping/ink bounds。需查字号/字体继承、CJK fallback、mixed runs/bold、段前后/缩进、旋转、公式与 table cell styles。公式虽然有完整源文本 fallback/warning，不能据此证明所有公式 fit。

超长代码/复杂表格目前以容量失败阻断，优于丢字，但未形成完整生产恢复路径。增设行号/行列/continued mapping、重复表头与说明，保持 source IDs、代码 token/缩进、表格 numeric/unit；显式页数不足返回可确认的结构方案。扫描 PDF/OCR、merged HTML 表与任意关系图保留拓扑及不确定状态。不得把 pending/warning 结构直接升级“已完整提取”。

图表扩展需完整 series、轴/类别、符号、units/scales 和显示一致性。原生数据正确不等于柱形方向/单位可见正确，最终图片/PDF仍要对照数据。复杂图片 mask 尽量保真复用，preview 的近似边界明确记录。

### P1-D：UI 状态和对比证据完整

[PptGenerationMonitor.tsx:65](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/src/components/ppt/generation/PptGenerationMonitor.tsx:65) 的缩略图与主 preview 容器仍用 aspect-video。`object-contain` 可以保护图片比例，所以目前只确认外框统一16:9，**没有证明实际图片被拉伸**。应与 Canvas/export 一样使用当前 logical page size，并验收 4:3/custom、窄屏与聊天展开。

[types.ts:29](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/src/components/ppt/types.ts:29) 的质量类型未完整表达 scopeAudit、contentReady、exportable、visualVerified 等后端状态。补齐数据与展示：来源/内容审查完成、预览可用、结构导出核验、实际视觉核验分别对应证据，不把 renderReady 当全稿通过。修复/缩字/内容删改以真实 diff 解释，不能只显示 Agent 自述。保留当前 workflow 步骤，不新增用户必须经过的流程。

局部 Before/After 应分别展示事实、表述、布局、媒体变化，列出保留/删除义务、影响页面、页数/字体/crop差异；确认/Undo 后核验目标范围及非目标页。长内容、长输入、比较窗口和 composer/footer 的垂直可达性继续做响应式回归。

### P2：可选 Visuals 与审美增强

完善主题 tokens、图片来源/风格/比例、装饰 visual 的异步任务和替换候选；明确 evidence / explanatory diagram / decorative 角色，失败不改变必需来源信息。素材变化进入 media diff 和版本 hash。该阶段不能绕过前面事实与可见性门禁，也不用 image count 或卡片填满率代表内容质量。

## 8. 建议的实施顺序与代码落点

| 顺序 | Priority | 改动部位 | 完成标准 |
|---|---|---|---|
| 1 | P0 | publish-service、quality-service、所有 publish/导出路由 | 删除 broad error whitelist；mandatory error 各 route 不可降级；F1 对照全部阻断 |
| 2 | P0 | render-audit、render-contract、native styles parser | 修正 locked 漏检/背景误报；开始实际成品可见性；F3 正负例通过 |
| 3 | P0 | export-integrity、generic/native exporter、artifact/revision 保存 | instance manifest + geometry/text/media contract；F2 全部拒绝，正常可编辑结构通过 |
| 4 | P0 | planning、content-qa、input-scope、critic schema、proposal gate | 禁止 mandatory 截断；独立完整性严重级；长条件/否定/例外与局部删改阻断 |
| 5 | P0 | source-artifacts、object-integrity、template-fidelity/角色识别 | 映射媒体等价与批准状态；无关系 prose 替代图示失败；protected/source 媒体始终完整 |
| 6 | P1 | source inventory、prompt-contracts、quality、scope candidate/service | claim/关系 anchor、所有语义改动入口、真实模型对抗测试、长 prompt 分片 |
| 7 | P1 | density-profile/packing、capacity、writer guide | 条件化 profile；不同内容填充；合并/减页不损失，explicit 页数冲突透明 |
| 8 | P1 | source ingestion、source artifacts、math/chart/table exporters | 代码/表可追踪续页、merged/OCR/关系；复杂多 series 与 visible unit/sign |
| 9 | P1 | generation monitor、质量 types/UI、BeforeAfterPreview | 所有 logical sizes 一致、质量证据分层、真实 diff/滚动/按钮可达 |
| 10 | P2 | Visuals/主题/资产候选 | 可选增强、角色区分、版本与异步失败隔离 |

建议先把本轮反例纳入生产 selftest，确保修复后不再接受损坏稿，再改规则。F1 与 F3 应成对推进，避免取消过滤后把合法 native 背景叠放全封锁。F4/F5 是内容和媒体的高优先级语义义务，不应等审美优化完成后再补。

沿用现有 source→outline→content/media→layout→preview→quality/review→repair→publish DAG 与已确认用户步骤。内部增加 evidence/contract 检查，不需要改变入口、LLM、模板、input、估算、syllabus、生成、编辑和发布的 workflow。

Prompt 增量建议是：planner 指定每项义务的完整 source span 与唯一主承载页；writer 依据义务表达机制/条件，不按字数创造事实；critic 按 mandatory/optional、事实/关系、可见结构核验并给 anchors；repair 优先重组不同内容，自动模式可减页，确认模式返回容量冲突；local AI 输出事实/布局/媒体 diff。Prompt 不能替代确定性 gate 或实际 render。

## 9. 通用验收矩阵与推荐指标

| 输入类型 | 正向样本 | 必须拒绝/明确报告的反例 |
|---|---|---|
| 稀疏 prompt | 既有对象必要解释、少页、不凑篇幅 | 新 agenda、公司/负责人/时间/业绩、同一句换词填满 |
| 丰富教程/研究 | 机制、例子、边界、尾部章节各有主承载 | 只覆盖标题、公式条件尾部丢失、事实跨页重复 |
| 商业/决策简报 | 事实/责任/决策条件按原文保留 | 编造数字、deadline、把建议写成已批准行动 |
| 中/英/混合输入 | 混合语言结构、数值/条件对应、字体实际可见 | 译文改变否定、中文 clipping、同义双语当两份信息 |
| CSV/XLSX/复杂表 | quoted newline/空值/负值/单位/完整矩阵、可追踪续页 | 空矩阵、删除行列、错误cell继承字号、无法提取却 complete |
| Code/数学 | 缩进、硬换行、原公式树/条件、续页映射 | 长行/尾部截断、公式降级无提示、括号/比较关系变化 |
| 图表/数据 | 正负/零值、units、全部series、长标签 | 数据正确但柱形符号/刻度错、单位丢失、第二series没核验 |
| 图/媒体/流程 | required source图、caption、crop/mask、箭头/顺序/依赖 | 一个实例冒充多个、prose 冒充必需diagram、媒体被canvas覆盖 |
| 模板原生/导入 | 16:9/4:3/custom、背景/组合/曲线遮罩、继承styles | external绕过错误、locked文字漏检、合理卡片叠放误报 |
| Local/generation edit | current/object/remaining/section等范围、diff/Undo、epoch冲突 | 改非目标页、stale写回、删mandatory条件、语义asset旁路 |
| 长稿/长输入 | 50+页、尾部限制、分片审查覆盖/聚合 | 超context仍返回complete、部分失败被标成功 |

指标分开统计：mandatory facts/conditions/relationships recall；结构/媒体 instance recall；unsupported/out-of-scope rate；semantic duplicate rate；实际 clipping/occlusion rate；preview/PPTX/PDF 合同一致性；页数估算误差及合理压缩解释；局部范围与版本正确率；独立信息/深度的人评。页数/字数/图数只是分层描述，不是通过标准。

“达到 Gamma 水平”应在同源、同用途、同语言、同页数约束及类似模板可写面积下盲评多个领域。模型输出和模拟输出分开，不用一份手写 simulation 的好结果证明模型稳定性。Gamma 参考本身有遗漏时仍以原输入 mandatory 义务为准。

## 10. 本轮验证结果、范围与交付

本轮新跑：`selftest-ppt-input-scope`、`selftest-ppt-render-contract`、`selftest-ppt-evidence-quality`、`selftest-ppt-density` 均退出0；input-scope 14 场景、density 21 组。验证了已有正向契约仍成立，**没有覆盖或消除本轮负向漏洞**。本轮未重跑全仓 npm/E2E：没有生产改动；前轮已记录31个PPT backend脚本通过、npm 2808 passed/0 failed/1 skipped，仅作为既有基线，不写成本轮新结果。

本轮新增生产函数审计9项（包括两种发布路由对照和 protected media 对照），真实损坏文件 reopening 5项，Gamma 真实文件重新核验一组。全部结果与复现方法见 [证据说明](../../outputs/ppt-hard-rules-gamma-audit-20261008/README.md)。没有调用真实 LLM，没有测试 Microsoft PowerPoint UI；没有验证全部 Gamma 模式/preset/元素编辑执行/运行中队列。代码检查而未端到端复现的问题已单独标注。

当前可以确认：模块已有可复用的输入范围、分组/去重、渲染与版本基础；Gamma 的生成与局部编辑提供了有价值的产品参考。下一轮最需要补齐的是**规则跨路由不可降级、mandatory 内容不被归一化削弱、媒体替换有真正证据、实际导出对象与可见画面匹配**。在这些 P0 完成前，不能将 successful export 当作可靠成品验收。

## 11. 五项 P0 的实施边界与共用设计

以下把“修哪个文件”进一步展开为“在哪个边界验证、保存什么、失败后做什么”。不改已确认的用户 workflow，不引入额外必经确认页；新的检查进入已有 quality/review、proposal、repair 与 publish 节点。

实施时坚持四个共用原则：

1. **规则只在产生发现时判断适用性，发布不删发现。** locked、native、旧模板、auto 页数都不能成为整类错误的豁免理由。
2. **内容、可见性和产物证据分别验证。** source span/义务证明应讲什么；Render Tree 证明计划怎么显示；实际 PPTX/PDF/图像证明导出了什么。任何一层都不能替代其他两层。
3. **所有证据绑定快照。** source/framework、义务清单、模板/媒体、render contract、revision、renderHash、artifact hash 与 verifier version 都参与对应证据的有效性判断。仅凭 `passed` 或同一页数不能复用。
4. **修复先保留内容，再调整呈现。** 来源支持的不同信息可重新分组；自动页数可合并/减页或必要时拆页；显式/已确认页数不足时在现有编辑/确认机制中报告冲突，不能通过截断、重复、缩小到不可读来消除错误。

建议新增的 issue 记录至少有 `code、severity、ruleVersion、slideId、nodeIds/obligationIds、basis、applicability、repairable、details`。`basis` 区分代码事实、预测、真实导出测量和模型判断；`not_applicable` 必须有确定性原因；`not_evaluated` 与通过是不同状态。临界预测可为 warning，但 mandatory 义务未审查、确定性内容丢失和确认可见损失不能因此放行。

新建模块名称、schema 与函数名均为实施建议，不表示当前代码已经存在。跨模块落地前，按 AGENTS.md 建立执行计划，记录 schema/version 与分阶段验收；本次只补讨论文档。

## 12. F1：跨发布路径统一不可降级的质量门禁

### 12.1 应修改的位置与操作

| 当前代码位置 | 应进行的具体操作 | 为什么需要在这里改 |
|---|---|---|
| [publish-service.mjs:26](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt/publish-service.mjs:26) `publishLocked` | 删除 externalPptx 的 issue 白名单过滤；保留原始 deterministic findings，以统一策略计算阻断原因 | 当前漏洞在此发生，critic 已完成也不能覆盖硬错误 |
| [quality-service.mjs:6](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt/quality-service.mjs:6) `reviewProject` | 保证 review 返回完整 issues、各检查的执行状态与合同版本；集中计算 hardErrors，避免调用方自行过滤或重计 | quality 的原始发现必须可追溯，新增规则默认生效 |
| [ppt-quality.mjs:377](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-quality.mjs:377) `finalQualityReport` | 统一 deterministic、semantic、mandatory completeness 的阻断策略；区分“可进入导出核验”与“产物已可发布” | 目前 publishEligible 在实际导出前计算，后续需要更精确的状态语义 |
| [ppt-api.mjs:886](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-api.mjs:886) 首次生成发布 | 用同一发布策略/产物核验流程，代替本地独立判断；保留生成 lease、runId、pause、hash 的重验 | 首次生成没有直接调用手动 `publishProject`，只修手动入口不完整 |
| [ppt-api.mjs:1366](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-api.mjs:1366) editable import | 分开记录 imported baseline 和经过新规则验证的 published artifact；不因导入完成就把所有 quality/review 节点视作已通过 | 当前导入直接设置 publishedRevision=1 并完成全部节点，不能继承新质量认证 |
| [ppt-api.mjs:1426](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-api.mjs:1426) PPTX/PDF 下载 | 下载已发布快照及对应证据；不得把当前坏 draft 与旧 publishedRevision 混用；PDF 的核验绑定实际 PDF hash | 有合法旧成品时允许下载该旧版本，但不能自动认证新 draft 或新转换产物 |

建议将策略聚合提取到 `apps/cowork-server/lib/ppt/quality-policy.mjs`（拟新增）；首次生成与手动发布共享策略和产物认证函数，不直接强迫生成态调用只接受 completed/quality_blocked 的现有 `publishProject`。两条路径的状态管理保留，规则与证据标准共用。

### 12.2 规则适用性和发布事务

不要将白名单改成“少过滤两个 code”或另一份黑名单。检测器应决定：该对象没有该能力时检查不适用；对象属于已支持类型却检查失败时保留 error；对象未能完整解析而无法验证时记录 not_evaluated。来源证据、可见文字、必需结构/媒体、非法几何和真实遮挡不会因 external/native 而失效。旧模板自带的合法背景叠放通过 F3 分类器处理。

建议使用内部状态 `preExportEligible` 表示可尝试 renderer；保留对外兼容字段并明确最终 published 判定。目标发布顺序是：

```text
读取候选快照 → 确定性/mandatory 审查 → 当前语义审查
→ 生成唯一 candidate artifact → 对象合同核验 → 实际可见性核验
→ 在项目队列内重查 revision/hash/run lease/pause
→ 原子更新 publishedArtifact、publishedRevision 与证据
```

模型调用和耗时转换尽量在不可变快照上执行，不长时间持有整个项目队列；提交阶段以 compare-and-check 拒绝期间产生的新 draft。renderer、核验、存储任一环节失败，都不更新 publishedRevision；保留上一份已发布产物，记录 candidate failure，清理或隔离未通过文件。因纯样式变化而重新渲染也必须重做 visual/export 核验；不必重复与语义无关的模型审查。

### 12.3 兼容与测试

旧记录的 `publishedRevision` 不等于新标准 passed：标注旧 verifier version；新修改或重新发布时按新规则重查。用户上传的原文件可保留为来源/历史基线，不能把原文件存在包装为“agent 修复后的成品通过”。无需改变新建/导入步骤，展示证据状态即可。

将 F1 两个复现移入正式发布自检，同时覆盖 generic、templateFidelity preserve、external import、update、首次生成、手动重新发布：clean critic 不能救回 deterministic error；新增未知 error code 仍阻断；合理 native 容器叠放通过；导出失败、pause、取消、stale reviewer、并发修改、lease 丢失不覆盖旧版本；PDF 下载使用已发布快照。**完成标准是所有写 publishedRevision 的路径均受同一策略控制，所有读产物的路径都能对应具体已核验版本。**

## 13. F2：对象实例合同、实际文件核验与最终可见性

### 13.1 应修改的位置与操作

| 当前代码位置 | 应进行的具体操作 |
|---|---|
| [ppt-export-integrity.mjs:4](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-export-integrity.mjs:4) `exportManifest` | 从当前 Render Tree 与 canonical visible nodes 产生 manifest v2；覆盖文字/shape 中的文字、表、图、图片、公式、组合及必需 foreign 资产；保存 instance mapping 和合同 |
| [ppt-render.mjs:235](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-render.mjs:235) generic exporter | 在每个对象创建/组合后写 stable mapping；所有 add_textbox/picture/chart/table 分支适用，不仅 source objects 有名称 |
| [import-pptx.mjs:427](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt/import-pptx.mjs:427) `renderImportedPptx` 及 EXPORT_SCRIPT | 将 native identity、实际保留/删除/替换、组变换、source-added objects 传到映射；未改原生对象仍能被核对 |
| [ppt-export-integrity.mjs:17](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-export-integrity.mjs:17) `EXPORT_VERIFY_SCRIPT` | 实际重新打开文件，按一对一/声明的一对多映射核验；消费匹配对象；比较几何、文字合同、媒体、全部 series/轴、表/数学关系 |
| [ppt-export-integrity.mjs:12](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-export-integrity.mjs:12) `acceptExportVerification` | 验证 artifact hash、snapshot/manifest/renderHash、版本及必要 checks 完整；仅 status=passed 不再够；分别保存结构与实际渲染状态 |
| [ppt-pdf.mjs:178](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-pdf.mjs:178)、publish/API、revision 保存 | 在已有转换能力上核验实际候选 PPTX 的 PDF/全页图；存转换引擎和字体指纹；将报告与具体产物/版本一起提交 |

### 13.2 manifest v2 的最小合同

建议的结构示意如下，字段为新设计，不是目前返回值：

```text
manifest.version / verifierVersion / revision / renderHash / sourceFrameworkHash
slides[].slideId / logicalSizeEMU
objects[].instanceId / canonicalNodeId / type / required / sourceObligationIds
objects[].expectedGeometry / rotation / zOrder / groupTransform
objects[].textContract 或 tableContract/chartContract/imageContract/mathContract
objects[].representation: native | rebuilt | declaredComposite
```

实例 identity 使用 deck/slide/node 组合；native 映射另带原 template/file hash、origin slide、shapeId 和 group path，避免重用模板页后 shapeId 冲突。sourceUnitId 是事实/对象来源，不是导出实例 ID：同一源图允许出现两次，但必须存在两个被批准的实例。

文字合同包含完整原文、paragraph/runs、font、margins、indent/bullets、spacing、wrap、autofit。正文仅容许声明的表示规范化；代码按字符、缩进和换行精确检查，不能靠折叠空白后的 substring；数学检查关系树，数值/负号/单位不在规范化中被抹去。普通 shape 如果承载文字也受文字合同保护。

图片合同同时记录 source assetHash、instance frame、fit/crop、mask/customGeom 与允许的转换。图像经过正常重编码时，不能简单以原始 byteHash 不同失败，也不能只凭 perceptual hash 相似通过；必须有可验证的转换来源/参数、实际像素或几何检查。原生图未改变时优先保留原资产与遮罩。

### 13.3 一对一核验与容差

普通输出默认一个 manifest instance 对一个实际对象。所有 type 都进入 consumed 集合；缺少、重复、未知替代或多个期望复用同一个对象均报错。shape name 可辅助定位，但不得是唯一身份依据；导出时建立可信映射，核验时重新读取 actual shapeId、slide/group path 与实际 payload/geometry，不能只信 exporter 自己的 sidecar 自述。

确实需要把一个 list 变成多个文字框、把图示组合输出为 group 时，导出器必须声明 composite mapping；子节点、范围、顺序与所有内容都可追踪。不得以该机制许可未经声明的“两框合一”。附加页码等对象也应声明为生成 decoration，不要求整个文件对象数与 IR 简单相等。

几何/字号/行距差异按单位换算、Office 舍入与渲染引擎建立小容差；容差由控制 fixtures 校准并版本化，不能用“大概5%”掩盖排版变化。要求至少核验页面尺寸、对象框、rotation/group变换、padding、wrap/autofit、paragraph/runs、图片 crop/mask、table rows/cells、chart 全部 series/units/axis、OMML/公式关系。opaque foreign 对象若没有可支持的结构比较，标记其验证能力和未完成项，不能默认检查通过。

### 13.4 实际画面的第二道门禁

导出层同时产出 `structuralVerification` 与 `renderedVisibilityVerification`：前者证明内容/合同写入；后者针对**实际导出的文件**检查必需文字/媒体是否页外、被遮挡、缺字、裁切或不能显示。优先利用生产 PDF 字符位置、实际字体解析、全页渲染与对象映射；复杂 masks、公式/图示需要图像区域和源结构对应，不能只统计 PDF 页外字符。

近似 measureText 继续用于早期容量反馈，不用它生成“实际渲染通过”。文字不可提取、字体/引擎缺失、复杂对象测量不支持时返回 not_evaluated 与原因；对要求视觉认证的新发布候选不置 visualVerified=true。图像 OCR/像素相似度仅为辅助证据，不能单独认证公式/数字/无遮挡。

P0 验证目标先限定为当前支持的 text/table/code/chart/image/已知 native 结构，在可复现转换环境建立 fixtures；unsupported 对象的认证状态显式化。未来可加入其他 Office 环境，不以 LibreOffice 通过代表 Microsoft PowerPoint 本体已测。

### 13.5 顺序与验收

先实现 v2 identity/消费匹配，阻断 collapsed-text 和 missing-image-instance；再加 frame/text/crop/mask 合同，阻断 offslide-text 和 wrong-image-crop；最后加入实际可见性，阻断 tiny-frame clipping 和真实遮挡。v2 阶段不得把尚未完成的视觉验证标作通过。

正式测试不仅重放五份负向 PPTX，还要从**正确 IR 经过生产 exporter**后故意扰动几何/图片 crop/对象个数再核验，确保测试针对 exporter→verifier 边界。正向覆盖同图多实例、双语/mixed runs、合法 native masks、组合列表、完整表/code/math、负值图。旧 v1 导出标记 legacy，重新发布重新核验；“同时维护 v1/v2”期间不接受 v1 认证新 v2 项目。

## 14. F3：区分合法叠放、内容碰撞与遮挡

### 14.1 应修改的位置与操作

| 当前代码位置 | 应进行的具体操作 |
|---|---|
| [render-audit.mjs:6](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt/render-audit.mjs:6) `renderIssues` | 将 editable 集合改为实际可见集合；locked 不参与是否检测的判断；把矩形相交变为 broad-phase 候选，而不是直接 error |
| [render-tree.mjs:48](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt/render-tree.mjs:48) 对象构建/原生页构建 | 保留 visibility、opacity、zOrder、rotation、group/world transform、mask、visual role、containment 与允许叠放关系 |
| [render-contract.mjs:24](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt/render-contract.mjs:24) `measureText` | 区分预测行框与真实 glyph/ink 测量；加入继承 run font/spacing/indent 的解析证据，不把宽框空白当实际文字 |
| [import-pptx.mjs:29](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt/import-pptx.mjs:29)、[ppt-template-fidelity.mjs:528](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-template-fidelity.mjs:528) | 导入/分析时记录组内坐标和有效样式、shape fill/透明度、connector/mask 关系，处理 nested group；锁定属性保留为编辑权限 |
| quality/proposal/repair 与 F2 实际渲染验证 | 共用相同关系分类；新引入的真实 collision 拒绝候选；修复结果重新验证，不能通过误报过滤“通过” |

建议建立一个纯函数 collision classifier（可置于拟新增 `ppt/render-collision.mjs`），返回 `allowed / collision / occlusion / unresolved` 与证据；不把 LLM 生成的“允许叠放”声明直接当豁免。

### 14.2 推荐的判定逻辑

| 相交组合 | 正确处理 |
|---|---|
| 卡片背景位于文字下层、容器与其文字 | 合法 containment；背景需在下层且角色/边界可验证 |
| 两个文字框相交，但实际字行在不同位置 | 仅 frame 候选；用 ink/行框排除误报，不因文本框有空白判坏 |
| 两组实际字形覆盖、条件/单位被另一段遮挡 | collision/occlusion；必需可见内容受影响为 error，与 locked 无关 |
| 文字覆盖图片 | source 支持的 caption/overlay 在明确安全区可允许；必要图示/证据区域被盖住则错误；无可靠测量为 unresolved |
| 箭头与流程节点、图标与标签、遮罩与图片 | 验证结构关系和 zOrder，不把预期连接或 mask 当一般 collision |
| 半透明图层/水印/装饰 | 根据实际 fill/opacity/可读性判断；对象有 groupId 并不自动允许任何叠放 |
| 页外背景/出血装饰 | 可有声明的 bleed；必需正文、表/图数据与 labels 不适用 bleed 豁免 |

先统一 EMU→point 和 group/world 坐标，处理 rotation/mask，再做快速几何筛选；随后用实际内容区域判断。大文本框互相覆盖不必阻断，字形碰撞则要阻断。只根据 overlap area 比例设置一个全局阈值不足以处理小负号、脚注或遮住关键条件。

metadata 可在 trusted layout/import analyzer 中生成；来自模型或随意用户 command 的 overlay 声明需校验，不能让模型把真正冲突标为 background。父子 group、container 关系与 layout 生成证据可信度也应记录。

### 14.3 自动修复的允许范围

可执行的确定性修复是移动/重新分栏、调整正文区域、换受支持的版式、在合理字体下重新排段，且保留所有义务和媒体关系。代码/表过长走续页或现有结构 proposal；模板中不可移动的 required asset 占位不能被偷偷隐藏。locked 对象可以被诊断，但未经解锁不能被自动移动/改写；错误需报告其保护状态和可操作的未锁定替代区域。

自动页数且没有锁定时可以拆页；显式页数或人工接受页则提出冲突/结构修改候选。repair 不能通过丢尾句、把字号降到不可读、删图、添加 fake overlay permission 或把 error 改 warning 来达成 success。一次调整后重跑 geometry、content obligations、媒体 ledger、collision 和实际 render；无进展时停止现有 repair loop。

### 14.4 分阶段落地与测试

第一步取消 locked 检测豁免，并实现 trusted background/container 的明确正向规则，同时保留相交候选证据；第二步解析组变换、旋转/透明度和继承样式；第三步接 F2 实际字体/画面测量，解决 frame-only 的不确定性。复杂 unresolved 不能被全局当作 allowed。

正式自检保留 F3 两个反例，增加：半透明水印、opaque 背景放在文字上层、合法卡片、两个短段落共享大框范围、同组撞字、locked/unlocked 混合、旋转文字、曲线 crop、connector 穿过 labels、表内换行与公式。桌面/移动 Canvas 缩放只改变 viewport，不改变碰撞结论；生产 PPTX/PDF 用同 logical dimensions 复核。**F1 删除过滤的合入必须与这些正常 native 叠放用例共同验收。**

## 15. F4：完整 source obligation 替代被截短的 requiredDetails

### 15.1 应修改的位置与操作

| 当前代码位置 | 应进行的具体操作 |
|---|---|
| [ppt-content-inventory.mjs:27](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-content-inventory.mjs:27)、source semantic/index | 在完整原文和 typed objects 上形成义务 registry；保存 source block/span、关系、条件、数值/单位、例外与语言关联；不由 writer 自造事实义务 |
| [ppt-planning.mjs:276](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-planning.mjs:276) `sourceBackedDetails`、normalizeBrief、slidePlan/buildPlanning | 去掉 mandatory 文本/条数的静默 slice；计划引用义务 ID 与完整摘要出处，指定 primary owner/续页范围；预算 summary 单独存放 |
| [ppt-prompt-contracts.mjs:204](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-prompt-contracts.mjs:204) outline schema、sourcePacket、writer/repair | 增加完整 obligation packet 与引用；writer 返回 claim/obligation→visible node/paragraph/range 映射；packet 超预算分片，不把尾部切掉 |
| [ppt-content-qa.mjs:300](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-content-qa.mjs:300) required detail 检查 | 词覆盖只用于候选匹配；精确结构/数值条件检查与语义等价核验分开；mandatory missing/changed 成为 error，不依赖 strictCoverage |
| [ppt-quality.mjs:298](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-quality.mjs:298) critic、normalizeModelReview、finalQualityReport | 增加 obligationIds、可见节点/范围、核验结果与完成清单；severity 由服务端义务等级决定，不让模型降级 |
| [input-scope-service.mjs:17](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt/input-scope-service.mjs:17)、[proposal-service.mjs:188](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt/proposal-service.mjs:188) | 内容/title/data/structure/有语义asset 改动验证义务差分；apply 再核验候选 hash 与义务版本；merge/delete 用整稿检查防止义务从删页消失 |
| [versioning.mjs:6](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt/versioning.mjs:6)、generation policy、types/migration | obligation registryHash、规则版本、approved exclusions 加入 plan/review/candidate 缓存；schema 变化使旧审查失效，不仅重建文本 |

registry 的执行接口可放拟新增 `apps/cowork-server/lib/ppt-source-obligations.mjs`；不要把 source object ledger 和 prose obligations 做成互相矛盾的两套 mandatory 定义。表、代码、数学、媒体复用已有 inventory/sourceArtifact ID，普通 prose 再补关系义务。

### 15.2 义务结构与 mandatory 的确定

建议每项包含：

```text
id / sourceHash / blockId / segmentId / span(start,end,offsetUnit) / exactText
kind: fact | condition | exception | numeric | relationship | structure | boundary
relatedClaimIds / parentObligationId / languagePairId
importance: mandatory | optional
primaryOwnerSlideId / permittedContinuation / supportedParaphrasePolicy
```

source span 必须能从当前 sourceHash 重建 exactText；offsetUnit 明确字符编码口径，避免 JS UTF-16 与 Python Unicode 索引不同。模型辅助拆句/提取关系时，代码校验实际 span、关联父主张及范围，不能仅凭返回 source ID 就确认新增事实。复杂语义识别仍需模型，但其结果有可复查出处。

mandatory 的最小范围：用户明确必讲/保留项、已锁证据、必需 typed/source 媒体、使主张成立的条件/否定/例外、避免误导的单位与比较基准。可选背景、重复历史、额外解释细节可 optional。不要把所有段落逐字搬上幻灯片，也不要让模型自行把困难的 required condition 降成 optional。压缩某个主题时，它被保留主张的条件仍必须一起保留；整项经用户批准不呈现时记录独立 exclusion，而不是修改原始义务等级。

source 不足时不要创建更全面的新事实列表。框架内 bounded explanation 可关联已有主张，但不能代替真实 mandatory 事实。中英配对表达归属同一主张；双语事实/条件分别检查，统计 distinct facts 只算一次。

### 15.3 完整性验证与 Prompt 变化

planner 分配义务及其父条件到同页/关联续页，完整 required packet 与可选上下文摘要分离。writer 输出可读释义，不要求每句逐字复制；明确“不把否定、条件、单位和限制挪到不可见元数据”。自动页数不足时重新 grouping/拆页，已确认页数则返回具体容量冲突。

确定性校验负责：ID 有效、source span 一致、所有 mandatory 已分配、source object/代码/表完整、数值/单位/关系映射存在。语义 critic 对 visible actual copy 给 `satisfied / missing / altered / not_evaluated` 与 evidence node/range，核对 if/unless/except/只在/不得、比较方向、因果与限定语。60% 词覆盖最多帮助找对应句，不能决定 satisfied；包含完整关键词却把“不得”改成“可以”必须失败。

`normalizeModelReview` 保留四类 finding 兼容，同时增加义务清单；unknown IDs、缺少 mandatory 检查、重复/漏页、假的完整状态返回无效审查。服务端把 mandatory missing/altered/not_evaluated 设为阻断；optional missing 或无 mandatory 关联的 shallow 仍可 warning。不要把所有 model_missing 升成 error，避免误伤合理封面/图示 label。

局部候选保存前检查实际内容变化，不仅 mutation type；在 apply/commit 再比较 actual candidate/registry/source hash。merge/split/delete 检查 after 全稿，确保义务被迁移到实际可见节点；生成中改动复用现有 epoch，最终整稿 review 必须覆盖最新 epoch。纯 style 只做可见性检查，不重复调用无关语义模型。

### 15.4 超预算、旧项目与测试

删除 `.slice(0,160)` 不能简单替换成无限复制 full source 到每次调用。按页发送完整 assigned obligations 和相关父条件；分片审查保留 global boundary、source registryHash 与 coverage cursor，最终汇总所有 mandatory/页 IDs。未读完某片或超模型上下文返回 not_evaluated，不补 complete。输入条数超 schema 上限时显式重新分组或报错，不能 silent slice。

旧 requiredDetails 可先作为 compatibility projection，依据完整 source 重建 registry；不能从已经截短的 strings 推断尾部内容。无完整来源的旧项目保持审查未完成，允许在原输入更新流程补足来源。更新 prompt contract/review rubric/plan schema 后使旧 cached clean reviews 和候选失效；持久迁移只补 metadata，不自动重写人工稿。

验收必须包括324→160反例、超过10项必讲内容、尾部否定、unless/except、数值单位、不同中文标点、双语条件不一致、同义 paraphrase、source 内部冲突、长 input 分片、merge/delete 迁移、accepted/locked 页局部缩短。正例允许不同表达与合理压缩；反例没有 mandatory 改写/丢失可通过。协议替身测试与真实多领域 LLM 召回/误报测试分开报告。

## 16. F5：媒体角色、关系保真与可验证替换账本

### 16.1 应修改的位置与操作

| 当前代码位置 | 应进行的具体操作 |
|---|---|
| [ppt-template-fidelity.mjs:225](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-template-fidelity.mjs:225) `templateMediaRole`、fidelityFromImported | 建立角色及判定依据；不能仅以面积/位置推断语义或可删；记录图片/组/connector/table/chart 承载的关系与视觉功能 |
| [ppt-template-fidelity.mjs:214](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-template-fidelity.mjs:214) `autoTemplateMediaOmissions` | 停止把 deterministic_topic_mismatch 自动标作 excluded_approved；主题错配仅说明旧样例事实不能用，不证明视觉组件无用 |
| [ppt-source-artifacts.mjs:16](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-source-artifacts.mjs:16) `replaceTemplateSourceRegion` | overlap≥35% 只生成 adaptation candidate；无验证 replacement mapping 时不自动删除 image/diagram/语义组件 |
| [ppt-source-artifacts.mjs:43](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-source-artifacts.mjs:43) `bindSourceArtifacts/bindSourceMedia` | 已创建来源文字/图并不意味着原 region 所有媒体都等价；只更新有确切处置记录的对象，保留图示关联和必要 caption |
| [ppt-density-capacity.mjs:7](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-density-capacity.mjs:7) protectedTemplateAsset/contentCanvas | unknown/required/brand/evidence 按保护区占位；只回收明确可适配的旧内容区域；不能删除媒体来获得 capacity_ok |
| [ppt-object-integrity.mjs:60](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-object-integrity.mjs:60) 模板 ledger | 删掉“任何 sourceArtifact 即等价”和“有 reason 即 approved”；验证映射、角色、关系、真实批准；扩展到语义 foreign/group/connectors |
| [ppt-template-fidelity.mjs:708](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-template-fidelity.mjs:708) slot/绑定/inspection、proposal、native exporter | 相同处置规则贯穿 draft、bind、候选、apply、最终 export；所有删除/替换显示真实 media diff；不只在最后 ledger 检查 |

### 16.2 推荐角色与处置矩阵

| 对象角色 | 推荐默认行为 | 合法适配/排除的条件 |
|---|---|---|
| source_evidence/source_structure | mandatory 保留，包括 caption、数据/公式/关系 | 完整 native/rebuilt 表达或明确用户 source exclusion；prose 不可冒充 |
| brand | 保留规定资产/位置规则 | 已有用户品牌设置明确替换；不得因主题错配删除 |
| semantic_diagram | 保留功能/拓扑，可适配标签 | 当前输入支持同类关系，映射节点/边/顺序可核验；不能复制旧案例事实 |
| old_example_content | 旧事实不作为本次来源 | 可 source-grounded 替换或在合法适配政策下 retire；不是 user approved，也不一定等价 |
| decorative/artwork | 保留视觉功能，按既有模板适配规则可替换 | 不承担证据；适配理由、主题/样式和空间作用有记录，不声称“事实等价” |
| unknown | 不回收、不自动认证 | 补角色依据或呈现可确认处置；保留明显旧案例文字时也不能冒充当前 input |

必须先区分“附件是设计模板”与“附件是输入内容”。模板的旧文字/图表事实不能混入源事实；导入内容稿的原始媒体/关系则属于输入基线。角色判定可借助模型，但声明 evidence/diagram/decoration 本身不是证明；与 source binding、native group、caption/连接线和关系清单交叉验证，歧义时标 unknown。

### 16.3 新处置记录与等价证明

建议 template disposition v2 有 `retained、replaced_verified、retired_by_adaptation、excluded_by_user、unresolved`；不要继续用 excluded_approved 同时表示用户批准和系统判断。每条记录保存 old object compound ID（templateHash/origin slide/shape/group）、role、before asset/structure hash、source obligations、replacement instance IDs、relation mapping、policy version、basis、review result、revision。用户批准另保存可信 actor/action、source/template hash 与原因，不由模型或 reason string 代填。

`replaced_verified` 的最低条件是：replacement instances 实际存在且可见；source 支撑其内容；原对象的必要功能/拓扑由新对象承担；F2 验证实际导出实例；F3 证明没有被新正文遮挡。例如三阶段图需有三个不同 source 支持的阶段以及对应顺序/依赖；可把旧模板图的标签换成新来源，不要求复用旧案例原词。两个主图加比较关系不能由无对应结构的一段 prose 声称等价。

装饰图替换只验证样式/空间功能和视觉合同，不要求虚构 semantic relation。确实要将旧案例图删除且不保留同类 visual 功能时，使用 retired_by_adaptation 并说明作用/影响，不能标 replaced_verified；若违反模板视觉保持要求，返回待确认候选。对新输入没有对应图示内容，不要为了保图数编造关系，选择合法 retirement/布局调整或报告冲突。

ledger 不只统计 image/chart/table：图示可能由 foreign shapes、connectors、number badges、文字 labels 与 group 组成。应把组合视为一个带成员/边的 semantic component，并同时核验其成员、阅读顺序和引用；模板 reschedule/reuse 后不能凭当前数组 index 与 shapeId 错配资产。

### 16.4 capacity、写作与局部编辑如何配合

先识别 protected/unknown 资产占用区，再给来源组件分配内容区。若正文与必要图示无法同页放下，优先换布局、移动可适配装饰、将不同内容分组，或给出页数冲突；不调用 replaceTemplateSourceRegion 隐藏媒体后再宣告 fit。非矩形/native masks 无法精确建模时保守占位并保留实际测量待验，不能当空地。

writer 接收 `availableContentRegion、protectedAssetIds、adaptationCandidates、requiredRelations`，可以提出基于 source 的 replacement IDs/关系映射，但没有删除资产或批准排除的最终权力。media adaptation 走已有 proposal/diff，commit 后 invalidate ledger/visual/export 证据。纯 fit/crop 不一定改事实，caption/语义图示替换则触发 F4 范围和义务审查；accepted/locked 页的语义资产也受保护。

旧 `templateOmissions` 有 automatic/source_region_replacement/topic_mismatch 的记录，迁移为待复核的自动适配，不能升级成用户批准。保留历史 snapshots；对当前稿重建 ledger 并尝试从原模板恢复遗漏对象或生成 source-supported replacement proposal，不自动覆盖人工布局。批准记录需沿用项目真实权限与 source/template hash。

### 16.5 验收

将 F5 未标保护资产被一般 SummaryBlock 文字替代的反例设为失败，显式 protected 对照继续失败；合法 source-grounded 三步图替换通过。增加：原图缩成不可读、箭头/编号丢失、旧图保留但标签换错、仅 caption 替代图片、同图多个实例、brand、明确装饰替换、未知资产、topic mismatch 自动 retirement、真实/伪造排除记录、template 复用/重排、source 图与旧模板图重叠、native curve mask、local asset caption 越界。**通过标准是 mandatory 媒体/关系全部完整，模板自动适配记录诚实且可追踪；不以“仍有一张图片”或“仍有source ID”通过。**

## 17. 五项 P0 的联动施工、测试与完成定义

### 17.1 推荐拆分为五个可评审变更

| 变更 | 主操作 | 与其他 P0 的依赖 | 本阶段不能宣称的成果 |
|---|---|---|---|
| A：统一发布策略 + 基础 collision 分类 | F1 所有发布入口共享策略；F3 locked 与 trusted containment 修正；先合入反例 | F1/F3 同验，避免 native 合法布局被全封锁 | 尚无实际视觉测量，不能宣称所有画面无 clipping |
| B：export contract v2 | instance mapping、全部 payload/geometry/text/crop/结构合同及版本失效 | 使用 A 的统一 pre/post export gate | 几何/结构正确不代表 font shaping/遮挡都正确 |
| C：mandatory obligations | F4 完整 registry、plan/writer/critic 与 local edit/apply、长输入分片 | 义务级验收与 B 的可见实例映射衔接 | 协议完备不代表真实模型准确率100% |
| D：媒体 disposition v2 | F5 角色/拓扑、替换映射、capacity 保护、真实批准与迁移 | 使用 C 来源义务、B 导出实例与 F3 保护区 | 不按固定图数或保留旧案例事实定义等价 |
| E：实际成品可见性 + 全路径验收 | F2/F3 final render、font/engine证据、响应式与失败恢复回归 | A–D 的快照/合同已稳定 | 只测一个转换引擎时，不外推为所有 Office 环境认证 |

这五个变更是分阶段交付结构，用户 workflow 保持不变。F4/F5 可在 B 阶段并行准备设计，但正式依赖合入与同一 schema/hash 版本核验要有顺序；不要求本次文档讨论启动并行 agent。

### 17.2 正式测试如何从已有审计迁移

现有 [audit.mjs](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/outputs/ppt-hard-rules-gamma-audit-20261008/audit.mjs) 和 [audit-export.py](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/outputs/ppt-hard-rules-gamma-audit-20261008/audit-export.py) 是发现漏洞的研究工具，其 assertions/结果说明描述“当前接受了坏稿”。修复时把 fixtures 导入正式 selftest，**反转预期为 reject/block**，研究基线文件保留，不覆盖为修复结果。

建议增加正式 hard-gates/export-integrity/obligations/template-media 自检（名称可按仓库约定确定），并扩展现有 render-contract、input-scope、evidence-quality、density、template fidelity 与 mutation/runtime 自检。每组包含真实生产函数/输出正例与反例，避免只测新 validator 的手写等价实现。

验收应分四层：

1. **规则单测**：severity/applicability、义务/source span、身份消费、relation mapping、locked/overlay 正负例。
2. **生产 exporter/发布集成**：真实生成文件再重新打开、故意扰动、各 route 同错误矩阵、并发/失败/历史版本保护。模拟 critic 只用于隔离确定性门禁。
3. **真实 render/UI**：生产转换环境全页图与字体证据；Canvas/缩略图/BeforeAfter/聊天面板的桌面与移动操作，按仓库规则用 CDP；不能只看 toast。
4. **真实模型内容评价**：多来源、多用途、中英/混合、长输入、反向条件和外框架诱导；统计 mandatory recall、unsupported、semantic repeat、条件关系与误报，并与模拟测试分开。

跨模块代码实施完成后运行 `npm run test` 和相关全部 PPT backend 自检；触及 UI 时启动当前 checkout 的 dev server，做 CDP 与 smoke；结构/字体/PPTX/PDF变更须核对真实产物。完整报告注明 skip/unsupported 与渲染引擎，不将 skipped 转成 passed。

### 17.3 最终完成定义与兼容回滚

五项 P0 均完成，至少需要：原有9项代码审计中的漏洞被新规则正确处理，五份损坏文件拒绝；各 route 不绕过；合法背景/图/原生遮罩正常；mandatory 尾部条件与媒体关系完整；所有证据匹配当前 revision；失败保留旧发布版本；新增普通 prompt、表/代码、双语、业务、研究、custom size 的正负样例通过。

升级 quality policy、manifest/verifier、render contract、obligation/disposition schema、review rubric 相关版本并建立明确兼容读取。旧 artifacts/snapshots 可保留，旧 passed 不认证新候选；如回滚某个新实现，标记该版本相关检查不再可用并限制新发布，不能为了恢复流程重新启用删除硬错误、截断 mandatory 或无依据媒体等价。所有 migration 与 repair 均可审查，不能悄悄改原输入或已发布历史。

以上为实施前的方案冻结记录。后续执行情况见第 18 节，不修改既有负向基线文件。

## 18. 按优先级实际实施与复核（2026-10-08）

### 18.1 已落地的五项核心修复

施工按 A→B→C→D→E 推进，先移除发布绕过与基础 collision 漏检，再加入实例文件合同、义务与媒体门禁，最后用真实文件/PDF 核查。完整文件地图和运维合同见 [实施交接](../handover/ppt-hard-rule-remediation.md)，原研究反例保留在原目录，修复结果另存 [验证产物](../../outputs/ppt-hard-rule-remediation-20261008/README.md)。

| 项 | 实施内容 | 实际验证与边界 |
|---|---|---|
| F1 | `publish-service` 移除原生分支硬错误过滤；初次生成和再次发布统一严格核验；导出失败保存 quality_blocked/repair，不覆盖历史发布 | generic/native 文本重叠和必需来源证据缺失均阻断；renderer 失败保留旧发布路径和 revision |
| F2 | export manifest/verifier v2，由 Render Tree 实例及 canonical node 对应生成；逐实例核验位置/旋转/大小、段落、字号/边距、图片 bytes/crop/mask、表/图/数学结构和数量；actual PPTX→PDF glyph/frame 检查 | 新自检中的 6 份实际坏文件全部拒绝；generic/native 正例通过。不是任意像素遮挡和所有 Office 环境认证 |
| F3 | locked 可见节点不再豁免；合法下层背景承载允许；文本按实际预测行占用，前景不透明覆盖视为错误 | 背景通过、locked 文本重叠和遮挡失败；复杂 artwork/connector/alpha/group ink 判断仍有限 |
| F4 | 完整 requiredDetails/mustInclude/source condition registry，不再 160 字符/10 项截断；所有义务逐项审查，真实可见实例/excerpt、当前 source/framework/registry hash；局部提案和 apply 再审 | 尾部禁令、超过 10 项、非 strict 模式 missing/altered/not_evaluated、删页和局部短写均覆盖。没有宣称确定性规则能理解所有隐含语义 |
| F5 | 媒体 disposition v2；unknown/source/brand/diagram 保留并占位；prose/source ID/reason 不足以认证等价或用户批准；明确旧案例自动 retirement 与实际批准分离 | 未保护 unknown 图也不会因 source region 相交被移除；普通文本等价反例失败；合法显式旧案例 retirement 哈希绑定。任意 diagram 拓扑替换暂不支持，保守阻断 |

### 18.2 Prompt、写作深度与框架内内容

Prompt contract/review rubric 升至 8。plan/writer/repair/critic/local AI 共用完整输入框架和 mandatory registry：父条件、否定、例外、单位、适用边界和不确定性不得因容量被缩掉；planned detail 不是新增事实权威。评论结果不允许只给空的四数组，必须逐项给 obligationAudit，并完成 scopeAudit。

义务 satisfied 必须提供当前可见 nodeId 和其逐字存在的证据 excerpt；可以同义表达，但“证据里存在某句话”仍不等于逻辑关系必然正确，关系判断由真实 critic 承担。协议不完整、registry 过期、证据实例不存在、未审完一律阻断。

密度沿用不同来源内容的 grouping/packing 和最终可用容量重测；不把 mandatory 内容复制到多个卡片填空。AI 局部优化审查包括重复 claim、被删除页以及资产 caption/内容变化，候选应用时重新核对内容与义务哈希。深度不足优先基于原来源补齐机制/条件、重排或报告容量冲突，不能新编事实或省略尾部禁令。

### 18.3 实际成品检验发现的补修

- **原生负柱方向**：native chart 数据正确但实际 PDF 将负值向上绘制。设置轴 min/max 和 crossesAt=0 仍不足；关闭 `invert_if_negative` 后重新转换，负柱向下。新 verifier 对混合正负、单 series 垂直柱测实际 PDF 柱矩形与零轴。多 series 数据在泛用 exporter 中全部输出；复杂图表视觉符号尚未全覆盖。
- **正文与表格可见性**：实际字体暴露表格/清单/摘要文本高度不足。统一 TOP anchor、段落 before/after、边距；文本测量预留字体盒高度，再以真实 PDF 检查。保留行距/字号合同，不依赖“PPTX text 存在”通过。
- **多实例文本与媒体**：metric 数字/说明、timeline/list point 分开映射，修复 timeline 编号格式与合同不一致。一个形状不允许消费两条实例义务。
- **原生 chart 安全与兼容**：允许 chart 自身内部关系拥有的静态 workbook；内层 ZIP/XML/路径/关系继续检查，宏、OLE、外链、公式和活动内容拒绝。原生 shape/chart/mask/group 合同来自新的 `pptx-ir-4` 解析缓存，所有缓存生产/消费路径同步。

### 18.4 最终验证结果

| 检查 | 最终结果 |
|---|---|
| `selftest-ppt-hard-rules.mjs` | 25 组场景通过；含真实生产 exporter、局部/发布阻断、stale 证书与 mandatory/media 反例 |
| 实际损坏 PPTX | 6/6 拒绝（offslide、collapsed、crop、missing-instance、font-size、paragraph-order） |
| 全部 PPT backend selftests | 32 个脚本全部 exit 0，逐个日志保存 |
| `npm test` | typecheck 成功；2,808 pass、0 fail、1 skip，共 2,809 tests |
| 实际成品复核 | 生产 generic/native PPTX/PDF通过；7 页最终 PDF 图片人工复核，负值柱向下、表/清单/摘要可见、旋转文字和 ellipse mask 保留 |
| 差异校验 | `git diff --check` 通过 |

M2 历史 matplotlib PDF 子检查因本机依赖不可用而 skip；生产 LibreOffice PPTX/PDF 检验已实际执行，两者不能相互替代。语义 reviewer 的测试响应是模拟协议，不是 live LLM benchmark。没有本轮前端组件修改，不复用此前 UI 测试声称本轮新增 UI 已测。

### 18.5 仍需完成的能力及正确状态

1. **真实模型与跨引擎**：所选 LLM 的 recall/误报/近义重复，Windows/桌面 PowerPoint、部署镜像验收未完成。结构门禁通过不能外推为模型内容质量全通过。
2. **自动长来源分区**：完整来源审查的 token-aware partition/父条件闭包/合并未落地；当前不截来源，prompt 超过 1 MiB 显式 `content_review_capacity`，小于该阈值也可能超过所选模型 context，必须 not_evaluated。该部分明确列技术债务。
3. **复杂遮挡和图关系**：实际 PDF glyph/frame 检查及基础碰撞已实现，任意 alpha/group/曲线 ink occlusion、复杂 chart、任意 diagram 拓扑的等价证明未全实现。未知媒体默认保留；不支持替换不得认证。
4. **旧稿兼容**：旧 artifacts/snapshots 保留；旧 certificate 不认证新稿。旧 nativeRef 无 v2 信息须重新导入/生成才能新发布；原始导入文件可以作为 imported_baseline 保留，但不冒充新内容通过审查。

因此，本轮五项已复现漏洞的核心修复和本地回归已完成；第 11–17 节中的更广泛视觉/模型/长输入验收目标不能全部标为完成。`renderedTextVerified` 与 `visualVerified` 分开，后者保持 false。新增核验环境不可用时阻断，不能退回旧 whitelist 或 payload-only 成功。
