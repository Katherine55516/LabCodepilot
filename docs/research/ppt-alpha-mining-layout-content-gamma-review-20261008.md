# PPT 模块与 Gamma 同源输出对比：文本适配、模板组件、内容组织与通用改进方案

日期：2026-10-08。状态：已补充跨输入通用设计，完成本轮渲染契约、结构保留、深度/密度与门禁优化及本地测试；原始比较文件仍作为修复前证据。修复前代码基线：`0d5711820d6577edfec48983bc83800a9b609bd1`。**第 16–24 节为 Gamma 实机观测；第 25–26 节整合 dots 反馈、多输入验收、实际代码改动、验证证据及剩余边界。第 27 节为第二次 Gamma 实机观测（Sample Size 模板 × `09_factor_testing.md`），第 28 节为据此补充的实施方案；第 16–21 节中被第二次观测推翻或需限定的结论已就地标注“【第二次实测修正】”。**

## 1. 结论与适用范围

当前 Alpha Mining 样例确实存在会导致 PowerPoint 文本越框和重叠的导出设置错误。**15 个长正文框全部为 `wrap="none"`，同时包含 `a:spAutoFit`。** 布局器按固定宽度计算多行，导出器却禁止自动换行并允许文本扩展形状。文件中“框的位置没有相交”与文字实际不越界是两回事。

另一个关键结论是：**该样例不是默认模板保真导出分支的完整代表。** 本次复查发现，上一轮模拟脚本覆盖了产品默认的 `renderPptx` 分派，将 preserve 模板项目交给通用空白 PPT 重建器。必须先修正模拟运行的接入方式，再用相同来源、策略和模板评估产品质量。不能把模拟器造成的全部差异归因于真实 LLM 或 Gamma 的模型能力。

实施前的产品代码存在可独立确认的通用问题：字体解析不识别模板内嵌字体；来源区域替换过于宽泛，正文会代替原有图形组件；代码块没有独立的结构义务；内容覆盖记录与实际可见内容脱节；容量估算、预览、PPTX 和质量门禁没有使用一致的文本布局契约。

本轮已优先修复共享文字/媒体契约、输入结构与可见损失门禁，并改进 source-adaptive 容量和深度合同（第 26 节）；像素级测量与真实模型对照继续单独验收。不能继续用“导出后文本仍在”或“零 hard error”作为“PowerPoint 可正常阅读”的证明，也不能以重复、缩小字号或省略媒体来达成密度目标。

本报告用 Alpha Mining 作为可复现证据，建议面向任意长短输入、语言、领域、模板、表格、图表、公式和代码。Gamma 的具体 8 页、字号和字数只是样本观测；要吸收的是内容分组、可见层级、组件适配和布局约束的做法。

## 2. 材料、方法与证据边界

### 2.1 输入与对照对象

| 对象 | 文件 | 用途 |
|---|---|---|
| 同源输入 | `/Users/dongli/Documents/quant_research/quant_3.0/10_alpha_mining.md` | 英中双语教程，11 个主体章节，包含算子、研究方法、检验、治理、A 股限制和代码案例 |
| 模块交付样例 | `outputs/alpha-mining-deal-review-simulation-20261008/alpha-mining-deal-review.pptx` | 用户指出换行与重叠问题的实际文件 |
| Gamma 成品 | `/Users/dongli/Downloads/Alpha-Mining.pptx` | 用户提供的同源内容参考，观察最终输出而非推测 Gamma 内部服务 |
| 原模板 | `/Users/dongli/Downloads/Copy-of-Deal-Review (1).pptx` | 对照原版字体、组件、图片、裁剪和版式关系 |
| 运行归档 | `outputs/alpha-mining-deal-review-simulation-20261008/workflow.json` 与 `run-alpha-mining.mjs` | 检查页数、LLM 模拟行为、节点、覆盖记录、媒体省略和导出依赖 |

模块成品 SHA-256：`550aa71c6daea64125f3fda701da7df8301cc01764bf4e27ce69f5374f59157d`。

Gamma 成品 SHA-256：`149c852640e40802a81fc7fe9ddab20d84b2ae69a1e31bd9b7437e5f867e8994`。

### 2.2 实际完成的检查

1. 读取两份成品及模板的 OOXML，提取各页文本、字号、文本框几何、内边距、wrap/autoFit、图片、原生表格/图表、图片自定义几何和字体部件。
2. 用 PPT 模块相同的 LibreOffice PDF 转换脚本渲染 Gamma；渲染模块已有 PDF，逐页查看联系表和关键页面大图。
3. 用当前 `reviewProject()` 重新检查归档项目，验证现有质量门禁是否能发现本轮问题。
4. **对照实验：不改变归档项目内容，直接使用产品默认 `renderTemplatePptx()` 导出同一 Deck IR。** 比较其 OOXML 与原交付文件，隔离模拟器路由问题和产品问题。
5. 对禁止换行的长正文框，使用成品实际字体 Arial Unicode 的 glyph advance 近似测量单行宽度；这是风险预测，不是 Microsoft PowerPoint 的实际像素测量。
6. 将最终 PDF 中精确匹配的字符矩形与原始 OOXML 文本框对照，检测实际框内容量偏差，并区分字体度量留白、显著越框与未匹配对象。

本次没有在 Microsoft PowerPoint UI 中打开文件，因此不把 LibreOffice 的表现冒充 PowerPoint 实测。用户报告的 PowerPoint 越框/重叠与 OOXML 中的错误设置相符；LibreOffice PDF 对这些框仍显示多行，未出现页外字符，反而证明单一渲染器预览不能替代导出契约检查。

未读取 Gamma 私有 API、提示词或后台模型。**第 1–15 节**对 Gamma 的评价来自用户提供的成品；**第 16–24 节**补充同日实际操作 Gamma 新 Agent 模板路径的 UI、可见 DOM、真实下载文件和逐页渲染证据；**第 27 节**是另一模板、另一输入的第二次实机运行，只有编辑器 DOM/CSS 证据，未导出文件。没有以 Gamma 成品作为新的事实来源，也没有将其遗漏视为应该删除的内容。

### 2.3 证据文件

证据位于 [alpha-mining-deal-review-gamma-review-20261008](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/outputs/alpha-mining-deal-review-gamma-review-20261008)。其中：

- `inspect-decks.py`、`comparison-summary.json`、`module-metrics.json`、`gamma-metrics.json`、`template-metrics.json`：OOXML 统计与可重复读取脚本。
- `module-text.md`、`gamma-text.md`：逐页文本及对应文本框属性。
- `no-wrap-risk.json`：15 个正文框的禁止换行风险测量。
- `pdf-fit-audit.py`、`pdf-fit-audit.json`：将最终 PDF 中精确匹配的文本字符矩形与 OOXML 文本框对照；未匹配对象不会被假定通过。
- `quality-recheck.json`：现有模块的重新审查结果与媒体省略记录。
- `control-native-export.pptx`、`native_control-metrics.json`、`control-native-export-result.json`：默认模板保真导出的对照证据，不是完整修复稿。
- `module-render/`、`gamma-render/`、`native-control-render/`：渲染图片；`pdf-text-metrics.json` 记录原两份 PDF 的字体和页外字符统计。

## 3. 定量对比与口径

| 指标 | 模块交付样例 | Gamma 成品 | 原 Deal Review 模板 |
|---|---:|---:|---:|
| 页数 | 8 | 8 | 8 |
| 页面大小 | 960 × 540 pt | 约 960 × 540 pt | 约 960 × 540 pt |
| 幻灯片自身文本对象 | 30 | 89 | 87 |
| 幻灯片自身图片实例 | 4 | 20 | 20 |
| 其他原生 shape | 8 | 33 | 35 |
| 原生表格 / 数据图表 | 0 / 0 | 0 / 0 | 0 / 0 |
| 包内 media 文件 | 4 | 32 | 32 |
| 图片自定义几何 `custGeom` | 0 | 5 | 5 |
| 包内嵌入字体文件 | 0 | 3 | 3 |
| 全部可提取文本的非空白字符 | 3,833 | 6,091 | 2,399 |
| 除封面各页“正文对象”字符中位数 | 507 | 847 | 334 |
| 除封面各页“正文对象”近似宽度单位中位数 | 349.24 | 550.46 | 209.26 |
| 英文 token 近似计数 | 457 | 920 | 360 |
| 汉字数量 | 634 | 238 | 0 |

统计口径：对象数来自幻灯片自身及 group 子对象，不包含母版上的所有装饰；包内 media 包含未在当前幻灯片使用的关系部件，不能直接当作可见媒体数。正文统计把显式字号 <26pt、非空白字符数 >2 的文本对象归为正文，包含局部标题和导航，排除封面；Gamma 的目录页仍参与该中位数。宽度单位沿用模块的 CJK/Latin 字符权重，是粗略测量，不是语义信息量。完整原始数据保留在 JSON。

Gamma 在同样 8 页中有约 59% 更多可提取字符、约两倍英文 token，并保持更细的可见层级。模块有更多汉字，是因为大量正文逐句英中双语拼接；不能把这些译文重复计算为两倍独立信息。

Gamma 的正文通常为 11–13pt，模块新正文为 14–14.5pt。密度差异部分来自字体和字号，也来自内容组织。**不建议直接将模块字号降到 11pt。** 应按模板字体、用途和实际观看距离制定字号下限，在同一可读性条件下比较独立主张、条件、证据和关系的覆盖。

Gamma 的多数图片是抽象背景、圆形装饰、图标或卡片背景；两份成品都没有原生数据图表/表格。这里的“媒体组件不足”主要体现为信息分组和模板视觉组件消失，不代表应为没有数据的来源新增虚构图表。

## 4. 换行、越框和重叠：具体证据

### 4.1 长正文框的导出设置

模块 30 个文本对象中，28 个 `wordWrap=False`，只有最后一页的两段 ProcessBlock 为 True。28 个中有标题/导航等合法单行对象，但也包括 **全部 15 个长正文框**。这些长框均有 `spAutoFit`，没有固定形状的明确 fit 策略。

| 页 | 长正文框数量 | 可用行宽 | 近似自然单行宽度 / 可用行宽 | 风险 |
|---|---:|---:|---:|---|
| 2 Why Mine? | 4 | 约 408pt | 2.97–5.04 倍 | 左栏文字会侵入右栏，右栏可能越过画布 |
| 3 Operator Algebra | 2 | 约 397pt | 4.94–5.88 倍 | 算子长串和双语说明无法按固定框宽显示 |
| 4 Search Design | 3 | 约 701pt | 2.28–2.90 倍 | 单行文字超出正文区域右边界 |
| 5 Alpha Tests | 3 | 约 454pt | 2.59–4.89 倍 | 文字可能侵入右侧背景图及越出画布 |
| 6 Governance | 2 | 约 397pt | 4.95–5.33 倍 | 双栏互相覆盖风险 |
| 7 Worked Example | 1 | 约 841pt | 3.20 倍 | 代码行与说明不能受文本框宽度约束 |

这些倍率由 Arial Unicode 字体近似测得，反映导出契约的严重矛盾。它们不等同于当前 LibreOffice PDF 的实际越界长度。

不能简单把所有 `wrap=False` 判为错误：Gamma 也有 52 个单行对象，主要承担短标题、标签或编号。必须结合**文本角色、实际宽度、是否允许多行以及对象的 fit 策略**判断。新生成的多句正文应该明确启用换行；保留单行的标签则必须实测适配。

### 4.2 通用渲染器的直接代码原因

在 [ppt-render.mjs:234](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-render.mjs:234) 的 `kind == 'text'` 分支：

- `add_textbox()` 后没有设置 `text_frame.word_wrap=True`。
- 没有明确关闭 `SHAPE_TO_FIT_TEXT`。当前导出的长框因此为 `wrap=none + spAutoFit`。
- 没有将 Render Tree 的 nativeTextFrame、内边距、垂直对齐和段落策略完整应用到新框。

同一文件的 list/timeline 分支显式设置 `word_wrap=True`。这是为什么最后两段流程能换行，而普通长段落的 OOXML 不允许换行。

### 4.3 测量与实际输出不是同一个契约

`measureComponent()` 用字符权重与可用行宽计算多行，`fitComponents()` 再安排固定几何；通用导出器却写单行扩展框。即使预测框互不相交，实际文本也可越框。

此外，源结构测量默认扣除 7.2pt 横向 padding，而新文本框导出后的左右 margin 合计为 14.4pt；表格、普通文本、列表和标题的 padding、行距、段间距也由不同模块分别控制。`estimateTypographyFit()` 主要使用整个矩形和粗略权重；字体变更后没有重新测量。容量安全不是一个统一、可跨阶段验证的结果。

### 4.4 最终 PDF 也能发现的框内容量错误

对模块 PDF 的 30 个文本对象逐项做 NFKC/去空白后的精确文本匹配，30/30 匹配成功，随后比较 PDF 字符矩形与原始 OOXML 框。除 nowrap 风险外，仍有如下实际输出度量差异：

| 对象 | 原始框底部 | PDF字符矩形底部 | 超出框底部 |
|---|---:|---:|---:|
| 第3页算子正文 | 298.65pt | 302.47pt | 3.82pt |
| 第4页其他搜索方法正文 | 367.85pt | 375.46pt | 7.61pt |
| 第6页A股说明 | 344.13pt | 364.49pt | 20.36pt |
| 第8页英文流程 | 481.14pt | 495.08pt | 13.93pt |
| 第8页中文流程 | 395.59pt | 412.99pt | 17.39pt |

第 6 页角色正文还向原始框右侧超出约 1.57pt。使用默认保真导出器后，上述主体容量偏差仍存在，不能只通过修正 renderer 路由解决。

这里的 PDF 字符矩形来自字体度量，可能包括下伸部和字体留白，不等于逐像素黑色字形边缘。Gamma 也存在一些小幅框外字体矩形，不能机械地把 1pt 差异都当成裁切或重叠。新生成正文的显著超出、相邻组件安全距离、模板原有合法延伸及实际遮挡应分别判断。模块这些文本仍留在 540pt 画布内，所以仅检查页面边界不会报警。

### 4.5 现有门禁的漏检

本次用当前 `reviewProject()` 对归档项目重新检查，结果仍是 **0 个 hard error，5 个 `rich_source_underfilled`，3 个 `gamma_density_underfill`**。

原因包括：

1. `ppt-quality.mjs` 的 region 重叠检查仍使用通用 layout registry 区域，不能充分代表原生模板的实际区域；preserve 项目的部分正文排版检查被跳过。Render Tree 虽有实际节点框的检查，仍没有补上原生文本与新正文最终 glyph 占用检查。
2. `ppt/quality-service.mjs` 比较的是框的矩形，不是按最终字体、wrap、autoFit 计算的实际文字占用。正文容量告警也没有验证最终 OOXML 的换行设置。
3. `ppt-export-integrity.mjs` 的重开校验主要验证文本、图片、结构存在，manifest 没有充分约束文本框 fit、字体、裁剪和段落几何；文字完整地存在于包内仍可显示越界。
4. `visualVerified` 为 false 并不阻止项目继续完成和发布。现有 `passed_with_warnings` 表示分析校验通过，不能表示实际视觉质量已通过。
5. “可见内容”筛选主要检查 hidden、opacity 和 templateOmissions，没有完整判断文字是否被 clip、叠层遮挡或落在画布之外。

因此，上一轮运行报告中的“重开通过”和“hard error 为 0”应按上述范围理解；该文件存在已确认的文本设置缺陷，不应继续当作布局合格的基准。

## 5. 对照导出实验：分清模拟器与产品问题

### 5.1 上一轮模拟接入的偏差

产品默认依赖在 [ppt-api.mjs:269](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-api.mjs:269) 已明确分派：

```js
renderPptx: project => project.templateFidelity?.mode === 'preserve'
  ? renderTemplatePptx(project)
  : renderPptx(project)
```

但 `run-alpha-mining.mjs` 中的模拟 deps 将其替换为不区分模板模式的通用 `render.renderPptx(project, runtime.io)`。模拟器改变的不只是 LLM，而是生产导出器的选择。模板项目随后从空白 Presentation 重建，原图的 `custGeom`、embedded fonts、母版关系和部分段落格式无法完整保留，还每页加入了原模板没有的顶部色带。

模拟 writer 也刻意将所有 content slot 省略，统一返回无 heading 的 `sourceCommentary` 长段落；review 模拟则复用 deterministicReview 的结果。它没有独立阅读图像，也没有进行真正的语义批评。这样的测试可以验证部分管线可运行，不能评估真实 writer 是否能完成模板配对、媒体组织和独立 critic。

### 5.2 使用默认 preserve 导出器的控制结果

| 指标 | 原交付样例 | 同一 IR 的原生保真对照导出 | 说明 |
|---|---:|---:|---|
| 内容 / 页数 | 3,833 字符 / 8 页 | 3,833 字符 / 8 页 | 仅改变导出路径，保持内容与省略决策 |
| 长正文框换行 | 15/15 禁止 | 15/15 启用 | 直接确认通用重建分支导致的错误 |
| 保留曲线图片几何 | 0 | 4 | 保真路径保留已有图片原生裁剪 |
| 嵌入字体部件 | 0 | 3 | 原生包关系保留 |
| 幻灯片图片实例 | 4 | 4 | 媒体早在规划/归一化阶段被省略，改导出器不会恢复 |
| 最终字体引用 | Arial Unicode | 仍为 Arial Unicode | 字体解析器覆盖原字体，属于产品侧问题 |
| 源新增正文/流程 fit | 默认扩展形状 | 仍有 `spAutoFit` | 正确换行后仍需显式固定形状与实际高度检查 |

对照导出 SHA-256：`620ff1cda3d90e80227f17c347261282d5041fa106c720fcb9d81b3dafd6e7f6`。

该对照文件保留了包内 32 个 media 文件，但只显示 4 个幻灯片图片实例。这是“包里还有媒体”不等于“页面组件还在”的具体证据。它只用于定位问题，不应替代完整修复稿。

通用改进：测试运行器只允许替换模型与 I/O transport，保留生产分派逻辑；把选用的 exporter、模板模式、源文件 hash、模型模式、契约版本写入 provenance，并断言 preserve 项目不会落入空白重建器。模拟 writer/critic 需满足真实 schema，独立验证关键来源与布局，不能把代码门禁重复返回为“模型审查通过”。

## 6. 标题、字体与文本层级对比

### 6.1 标题语义

| 模块标题 | Gamma 对应标题或内容位置 | 差异与改进方向 |
|---|---|---|
| Alpha | Alpha Mining | 模块缩短后丢失“挖掘”这一核心主题；应该保留核心词，先换行、调整标题区域或版式，再处理非必要修饰 |
| Why Mine? | What Alpha Mining Is | 模块问题标题可用，但正文混合研究范式、生产模式与统计风险，没有清晰子标题 |
| Operator Algebra | Operator Algebra, Alpha101 & Data Fields | 模块同时谈算子与 Alpha101，标题未表达合并范围；Gamma 的更长标题由准确主题与局部标题支撑 |
| Search Design | Genetic Programming；Other Search Approaches；Data Fields | 一个泛标题下塞了三个不同读者问题，导航标签 Fields 也没有覆盖全页 |
| Alpha Tests | Evaluation Gauntlet；Alpha Combination | 模块正文包含组合器过拟合与权重，但 Tests 只表达检验；可以明确范围或按内容职责分区 |
| Governance | Industrial Pipeline；A-share Notes | 工业职责与市场约束被归为一个宽泛概念，缺乏局部层级 |
| Worked Example | Gamma 最后一页只给 Mining Loop | 模块保留了代码线索，但标题没有揭示示例具体机制；不能为了向 Gamma 靠拢而删掉代码 |
| Validation | A-share Notes & Worked Example | 模块将双语循环完整展示，但最后一步混入长解释，层级不清 |

不能规定所有页面都要判断式标题或都要短名词：概念、定义、流程页适合直接命名主题；有来源支持的结果页可以用结论；用户锁定标题要保留原词。当前 writer 的统一“标题表达完整判断、英文 6–12 词”应改成按 page role 选择 titleIntent，并服从实测字体与区域约束。

建议把标题的 coreTerms、scope、intent 和 subtitle 分开记录。适配失败时保留核心主体与区别词，修改次要范围、合法换行或选择适合的标题区域，禁止通过截取字符变成缺少主题的短标签。

### 6.2 字体与富文本

Gamma 和原模板均包含 3 个嵌入字体文件。Gamma PDF 实际使用 Source Sans 3、Libre Baskerville Bold，以及中文字体 fallback，标题与正文的设计身份明显分开。模块 PDF 的全部文本则是 Arial Unicode MS，模板衬线标题变成无衬线。

问题有两层：

- 通用重建器丢弃原包嵌入字体；同时 `cjk_font()` 的 role 判断只识别 `title`，preserve 节点的 `template-title` 被当正文。元素的 `fontFamily` 也没有完整进入该 helper。
- 原生 exporter 虽保留字体部件，却调用只查宿主 `fc-match` 的 `resolve_font()`，没有将模板内嵌字体作为有效资源。对照实验显示 `Libre Baskerville Bold` 和 `Source Sans 3` 仍被改成 Arial Unicode MS。字体“有 glyph”不能替代“符合模板且测量一致”。

长英中混合段在一个 run 中会整段转成 CJK fallback，进一步改变英文度量与标题视觉。应将 Latin/CJK/math 分为 runs，保留强调和代码样式，分别做 fallback；字体选择完成后再测量。对模板标题与正文 token、嵌入资源、实际渲染 family 都应有明确审计。

Gamma 通过局部标题、英文解释、双语标签、正文加粗和少量术语强调建立阅读层级。模块把这些层级合并为普通 text，导致读者只能逐段扫描。应保留 `heading + body + emphasis + note` 的职责，不要把完整块压成无 heading 的 `sourceCommentary` 字符串。

## 7. 内容分布、密度与完整性对比

### 7.1 逐页观察

| 页 | 模块：文本非空白字符 / 图片实例 | Gamma：文本非空白字符 / 图片实例 | 主要观察 |
|---|---:|---:|---|
| 1 | 5 / 1 | 89 / 1 | 模块仅有 Alpha，丢失教程身份和主题范围；Gamma 封面有主题、双语范围、原生曲线图像 |
| 2 | 737 / 0 | 526 / 0 | 模块直接放四段概览；Gamma 提供六项目录及简短说明。目录应按任务需要选择，不应机械新增 |
| 3 | 513 / 1 | 675 / 1 | 模块是两段算子/Alpha101说明；Gamma 用四个编号组解释范式、生产模式、风险，组内有双语名称和正文 |
| 4 | 661 / 0 | 1,258 / 4 | 模块把字段、GP、其他方法放入三个长段且留有无意义左侧空列；Gamma 四个图文组，每组有独立标题、机制或边界 |
| 5 | 671 / 1 | 703 / 5 | 模块检验与组合写成段落；Gamma 用四组分别解释树结构、fitness、好坏 fitness、正则化，原有组件支持对照关系 |
| 6 | 517 / 0 | 894 / 1 | 模块标题较低、上方大幅空白，两段合并治理与 A 股；Gamma 的图像带与四个编号组明确检验层级 |
| 7 | 359 / 0 | 1,023 / 4 | 模块代码压成一句长串；Gamma 组合原则配四个角色组，能读出工业职责与试验治理 |
| 8 | 370 / 1 | 923 / 4 | 模块双语流程两栏，最后节点混入解释；Gamma 将 A 股、挖掘循环、Tutorial 14 分成三段有图标的主题 |

这些不是一一同义页。Gamma 含封面、目录、6 页主体，模块含封面和7页主体；应按“哪个读者问题出现在哪个区域”比较，而不能用相同页码判断缺失。

### 7.2 Gamma 值得吸收的内容组织

- 将来源位置变成读者问题，例如同页解释算子、Alpha101 读法和字段边界，避免一节机械一页。
- 每个组提供不同信息职责：定义、机制、条件、对照或适用限制；小标题不是重复的页面标题。
- 方法旁有风险，工业职责旁有产出与治理；文字解释组件，而不是让组件只作装饰。
- 使用不同版式承担不同任务：范式对照、四组机制、角色分工、带解释的流程。布局多样性来自信息关系，而非随机改颜色或镜像。
- 保留必要的空白和密度节奏，局部内容有明确边界。不是每页、每框都要达到相同字符数。

### 7.3 Gamma 也没有保留的来源细节

Gamma 没有展示完整 `candidate_alpha()` 代码；评估关卡没有逐项展示所有成本、容量、稳健性和 walk-forward 内容；一些数值例子、独立性假设和公式参数也有压缩。因此它是布局与内容组织的参考，不是完整性唯一标准。

模块保留了较完整的评估检查名称、数值线索和双语循环，这些应保留并改善呈现。向 Gamma 学习不能退化成“只保留它展示的内容”。

### 7.4 当前覆盖记录不能充分证明完整性

归档有 64 个 inventory item，`coverageV2.detail` 只有 2 个 ProcessBlock 映射到 sourceUnitIds，另 62 个显示 `unmapped; requires planner review`。实际长段落已概括多个来源，所以这不等于 62 项全部从文字中消失；它说明**细节所有权记录失效，当前系统无法清楚区分已表达、压缩与省略**。

模拟器把多条 keyPoint 绑定到一个大范围 refs 集合，但每个点的 sourceUnitIds 为空；这也使主题引用和可见事实覆盖很容易混淆。宽泛 chunk 或 refs 出现不应自动证明其中的全部事实被展示。

应记录来源细节到可见组件的绑定：`sourceUnitId/claimId → owningPage → nodeId → rendered location`。压缩要注明保留的机制、条件和省略内容；关键数字、公式、代码依赖、表格关系和结论依据必须有独立义务。

### 7.5 双语与密度

Gamma 主要是英中标题、英文正文；模块大量逐句双语拼接。同源输入有两种语言，但成品采用不同的语言呈现策略，因此字符数比较不能直接当成信息密度比较。

通用方案应识别可验证的翻译配对，给它们同一语义主张 ID，但分别计算各语言的展示空间。支持双语标题加双语分区、对照段落或成组译文。输出语言仍遵从输入/用户策略，不能为了密度静默删除一种语言。流程翻译应是同一个流程对象的两种标签或说明，不应被当成两个独立机制。

## 8. 代码、公式和原生证据的问题

来源中 fenced code 被 parser 识别为 `type='code'`，但 `ppt-content-inventory.mjs` 没有 CodeBlock 分支，随后被归为普通 `MechanismBlock`，`priority=normal`、`must_preserve_structure=false`。本例 `b_0090` 就是这种情况。

模块示例页保留了 `ret5`、`vol20` 和 `raw` 的表达式，却省略 `def candidate_alpha(df)`、`df["alpha"] = raw`、完整赋值方式和 `return df`。它又引用 `df.groupby("date")["alpha"]`，所以展示的片段缺少中间数据依赖，不能视为完整可运行示例。核心公式 token 匹配通过也不等于代码结构完整。

通用改进应覆盖：

1. CodeBlock 单独保留语言、缩进、行序、变量依赖、函数签名、关键赋值和返回；required 的代码不能按普通 prose 摘要预算压缩。
2. 允许“完整代码”或“明确标注的最小片段”，由 planner 决定；最小片段仍必须依赖完整，不把删失后的文本冒充原代码。
3. 使用等宽 code runs/原生可编辑文本；按语法边界换行，超宽 token、路径和函数名采用专门策略，不能在标识符中任意插入空格。
4. 展示解释和代码本身分开，避免一段文字同时承担多条代码语句、中文翻译和方法说明。
5. 表格与图表采用同样原则：数据和关系完整、单位/表头/图例明确；不把图表对象的存在当作信息可读的证明。
6. 公式使用原生数学或可验证文本表示，检查变量、上下标、分子分母及条件关系，避免用单个表达式命中代替整页逻辑检查。

最后一页 ProcessBlock 的末项还包含长解释“即使拒绝也记录，才能估算试验次数”。解析器应将动作节点、输出与附注分开；长说明无需挤进最后一步。该方法适用于科研流程、审批、实施计划、产品流程和教学步骤。

## 9. 媒体与模板组件为什么减少

Gamma 与原模板的 20 个图片实例不只包含大背景，还包括四组圆形图像、卡片背景、角色图标和流程图标。模块只保留4个大背景；其余视觉信息组织大量消失，剩余 8 个 shape 是通用重建器加入的顶部色带。

两个直接原因：

1. 模拟 writer 将全部正文 slot 省略，选择长段落替代，原有 heading/description/编号关系没有被使用。
2. `bindSourceArtifacts()` 只要接到 commentary，即对整个来源区域重新排布，并省略全部 content slots。`replaceTemplateSourceRegion()` 又将与区域相交面积 ≥35% 的图像、编号、连线和相关 shape 自动排除，除非满足少数大背景/标题/页脚保留条件。

这套逻辑合理地避免了旧主题图表和孤立标签残留，但将“正文区域替换”近似等同于“图形组件由文字代替”。账本理由称新内容 complete/editable，并不能证明比较关系、流程关系、图标职责和信息层级得到了等价替换。

建议采用按组件组处理的策略：

| 媒体/组件类型 | 默认策略 | 可替换条件 |
|---|---|---|
| 主题背景、品牌/装饰、曲线裁剪 | 保留原生关系与几何，作为 protected zone | 与内容冲突且有明确等效版式时调整，避免“新段落覆盖就删除” |
| 通用图标、编号、连接线、角色框架 | 先保留结构角色，重新绑定新文本 | 新内容关系不适配时，整组选择同等表达能力的组件 |
| 旧主题照片 | 判定是否属于装饰或事实 | 不合适时可替换/省略，但仍需满足媒体意图和可用区域 |
| 旧主题图表、截图、证据 | 禁止当作当前来源事实 | 来源支持的数据/图表替换；无证据则改成机制组件或透明记录缺口 |
| 来源原始图、公式图、表格截图 | 建立 required obligation | 只有经验证的等价原生对象才能替代 |

不要求每个案例都有 20 张图片，也不把图片数量作为通过指标。验收应看媒体角色和关系是否保留/等效，而非字符段落是否覆盖原图区域。主张、caption、alt/语义描述、对象来源和替换理由应与组件一起维护。

## 10. 通用架构与工作流改进

维持现有用户工作流，在现有解析、规划、写作、审查、发布步骤内部补充一致的契约和反馈，不需要新增一个用户必须经过的阶段。

```mermaid
flowchart LR
    A[来源与模板解析] --> B[语义主张和组件义务]
    B --> C[按读者问题分组与页数候选]
    C --> D[按角色写作与组件绑定]
    D --> E[最终字体解析和区域测量]
    E --> F[统一布局与导出]
    F --> G[最终文件结构和视觉复核]
    G -->|具体容量或完整性失败| C
    G -->|通过| H[完成和交付]
```

### 10.1 统一文本布局契约

建议在 IR / Render Tree 中定义明确的 `textLayout`，而不是依赖 Python/Office 默认值。以下是建议字段，不是现有接口：

```json
{
  "wrap": "word",
  "fit": "fixed",
  "marginsPt": {"left": 7.2, "top": 3.6, "right": 7.2, "bottom": 3.6},
  "verticalAlign": "top",
  "lineHeight": 1.18,
  "paragraphSpaceAfterPt": 0,
  "fontRuns": [{"text": "...", "script": "latin", "fontResourceId": "...", "sizePt": 14.5}],
  "overflowPolicy": "reflow_or_split",
  "measurementVersion": "..."
}
```

测量、HTML/SVG 编辑器、原生保真 exporter、通用 exporter 与最终 QA 消费同一份契约。正文默认固定形状并启用换行；短标签可用 nowrap，但必须验证实际 width。用户主动设置的自动尺寸要作为明确选项保留，不能被默认导出行为隐式引入。

以真实字体 shaping、语言断行、内边距、段落间隔、bullet 缩进、旋转与文本方向测量；粗略 visualUnits 可用于快速预估，但 final fit 必须由实际度量或等价验证支撑。跨平台不同字体资源需要标识并重新测量，不能继续使用旧 fitValidated。

### 10.2 模板模式与正文模式明确分开

模板选择应保留三种内部策略：适配原生 slots、局部组件重排、来源结构替换。每个区域选择一种主正文表示，杜绝同一正文在多个字段重复，但不因此删除所有可复用组件。

只有确有表格、代码、公式或完整关系不能放入原区域时，才选择来源结构重建；普通段落说明应优先保留 heading/body 对和组件组。替换的最小单位是结构组，记录输入角色、输出角色和 source binding。

### 10.3 内容关系驱动布局

当前 `fitComponents()` 主要在单栏与双栏之间选择，并把下一个对象放到当前高度最小的栏中，最后优先较短总高度。它容易把有顺序的解释和因果拆到不同栏，也容易让独立对象失去小标题。内容 canvas 还是多个模板框的外接矩形，可能跨过图片或其他 protected zones。

应先定义 comparison、sequence、taxonomy、method-risk、role-output 等关系和 readingOrder，再选可兼容的模板组件。排版器管理区域的真实可用多边形/矩形集合、reserved zones 和组内约束。使用一个 union 大矩形前必须验证中间没有需要保留的图片、标识或边界。

### 10.4 密度从单一字数目标转为条件化指标

现有 `gamma-reference-v1` 固定为 601/674/740 宽度单位，注释已说明只是单份英文主导样例的观测。但后续容量 target 和 underfill 仍可能将其变成统一目标，source projection 又将普通段落压到标准65/详细95单位。

建议按页面角色、组件类型、语言、字体、模板可用区域和来源充分性建立不同校准 profile。密度至少包括：独立主张数、关系数、证据/条件覆盖、实际正文占用、媒体信息作用、阅读负担和合法留白。

封面、目录、章节、单公式和单图证据页不能统一要求达到正文密度。普通富来源页 underfill 时，先检查是否省略了**不同**机制、条件或案例；合并要基于同一读者问题，不能把无关内容塞在一起。稀疏来源允许保持留白，不虚构事实。

### 10.5 页数估算与最终校准

本例解析前5页、解析后推荐7页（范围7–8）、最终8页；页数本身与 Gamma 相同，但内容仍不均衡。问题不能通过把 defaultPages 改为8解决。

推荐估算过程：来源主张去重与双语关系识别 → required 对象完整成本 → 候选内容分组 → 对实际模板区域、最终字体和组件关系进行测量 → 校准页数与分布。记录初估、最终值和变化原因。

自动页数可因不同内容与容量适当减少或增加；用户锁定页数时保留锁定，并报告真实冲突。模板页数只提供布局资源。校准不能因字幕/翻译重复或 sourceCommentary 的默认退化布局被迫增页；也不能把未展示的事实从成本中扣掉而不记录省略。

### 10.6 完整性与局部 AI 编辑共用门禁

生成、继续生成、单页 AI 编辑、段落改写、换版式、改字体、插图和导出都应经过同一组 fit/coverage/media 检查。文字变长后重新布局并更新受影响的节点和来源义务；版本、预览和导出文件需对应同一 revision/hash。

局部修复应收到具体对象、最终可用宽高、字体资源和失败原因，例如 `nowrap_body`、`glyph_bounds_overflow`、`heading_without_description`、`replacement_relationship_missing`，不能只收到笼统“本页太密/太空”。改写、reflow、换组件、重规划是不同动作，结构性失败不能只让 LLM 反复缩短正文。

## 11. Prompt 改动建议

提示词已经包含禁止重复、来源结构、密度分组等原则，应补强输出契约与代码执行，不建议只再堆一段“不要重叠”的自然语言。

### 11.1 Planner

新增或强化输出：

- 每页 `readerQuestion`、`titleIntent`、`coreTerms`、`ownedClaimIds/sourceUnitIds`、`requiredDetails`。
- `componentGroups` 的内容角色、关系、阅读顺序、模板候选与 required media/structure；坐标仍由代码生成。
- 原生标题/正文槽配对与替换范围；不能为了方便把所有 content slots 全部省略。
- 双语翻译配对只算一个语义主张，展示成本分别计算；没有验证关系时保留为独立内容。
- `coverageDecisions` 写明 included/compressed/omitted 及原因；不能把广泛 refs 当作已覆盖全文。

建议补充的核心规则：

> 先为不同内容建立职责，再分组与选模板组件。每个组回答一个具体问题，解释需要的机制、条件或证据。标题保留核心主题和区别词。页数来自完整义务与实测容量。来源细节可明确压缩或省略，但不得通过重复内容、隐藏正文或清空媒体区域满足目标。

### 11.2 Writer

原生槽位模式输出配对 heading/description 或 native paragraph runs；来源结构模式输出 typed objects 和必要的局部解释。`sourceCommentary` 应定位到对象/组，不作为逃逸模板约束的全页长文容器。

建议规则：

> 各组使用不同的小标题，并让说明补充机制、条件或例子。代码、公式、表格和流程依照对象义务输出。媒体无法匹配时给具体替换方案，不用长段落代替关系组件。输出短标签/正文/注释的类型；不输出坐标，代码按最终字体和可用区域决定换行。内容无法容纳时返回具体冲突，不截断、不减小关键内容字号、不遗漏依赖语句。

### 11.3 Critic / repair

把语义审查与视觉/结构审查分开。模型检查新事实、条件、来源和重复；代码/渲染器检查换行、glyph bounds、几何、字体资源、媒体关系与最后导出的文件。模型不能通过返回“无问题”解除确定性的结构失败。

repair 保留已有的 claim ownership、代码依赖、数据表列/单位和 required media；优先调整阅读顺序、区域或模板组件，之后才在不丢失条件的前提下改写。只有真正无法容纳时再提页数校准。

## 12. 需要改动的代码部位

| 文件 / 位置 | 当前职责与已确认问题 | 建议改动 |
|---|---|---|
| [ppt-api.mjs:269](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-api.mjs:269)；本轮模拟 runner | 产品已有 preserve 分派，模拟 deps 绕过了它 | 抽取可复用的 renderer dispatch；模型模拟只替换 modelCall 与 transport，写 provenance 并断言 exporter mode |
| [ppt-render.mjs:234](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-render.mjs:234) | 普通 text 未设置 word_wrap，shape 默认可扩展，template-title 被当 body | 应用统一 textLayout；固定正文形状、正确角色与 runs；非模板路径也必须满足相同 fit 契约 |
| [ppt/import-pptx.mjs:192](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt/import-pptx.mjs:192) | 新增 source objects 开启 wrap 但保留默认 spAutoFit；保真字体仍被 fallback 改写 | 明确 fit 策略与 margins；保留原生关系、字体资源与 rich runs；改动后的框逐项测量 |
| [ppt-fonts.mjs:26](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-fonts.mjs:26) | 仅查宿主字体与 glyph coverage，不识别 embedded fonts | 建立模板字体资源表、脚本级 fallback、字体角色与度量；保留内嵌字体可用引用，fallback 后重新布局 |
| [ppt-density-capacity.mjs:6](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-density-capacity.mjs:6) | 外接矩形 canvas、粗略行数、仅单/双栏、padding 与 exporter 不一致 | 多个真实区域/protected zones；共享实际文本测量；按关系选择 readingOrder 与 layout |
| [ppt-source-artifacts.mjs:16](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-source-artifacts.mjs:16) | overlap≥35% 即自动省略组件；commentary 也清空全部 content slots | typed/grouped source component；局部绑定；保留通用图标/组件结构；替换要证明角色与关系等效 |
| [ppt-template-fidelity.mjs:234](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-template-fidelity.mjs:234) | template frame 用固定权重预测容量，标题可能被过度缩短 | 使用最终字体、真实 run/段落与标题核心词；模板结构组/图片路径纳入 fidelity |
| [ppt-content-inventory.mjs:16](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-content-inventory.mjs:16) | CodeBlock 未建模；结构优先级和 detail ownership 不完整 | 增加代码结构及依赖义务；从来源到可见节点验证压缩/省略；类型与schema/version同步 |
| [ppt-planning.mjs:295](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-planning.mjs:295)；[ppt-prompt-contracts.mjs:235](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-prompt-contracts.mjs:235) | 既有内容角色/密度契约，但模拟结果无完整配对和细节映射 | 强制所有权、component groups、title intent、coverage decisions 与 mode一致；拒绝无理由全部省略槽位 |
| [ppt-density-profile.mjs:5](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-density-profile.mjs:5)；`ppt-density-packing.mjs` | 单份 Gamma 的宽度区间、普通段落固定projection | 多角色/语言/媒体 profile；实际容量优先，基于独立内容重新校准自动页数 |
| [ppt/quality-service.mjs:18](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt/quality-service.mjs:18)；`ppt-quality.mjs` | 只比较框、native typography 部分豁免、visualVerified未参与完成标准 | 所有新/改动对象检查最终占用；允许有意背景叠层；确定性 layout failures 阻止“完成” |
| [ppt-export-integrity.mjs:4](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt-export-integrity.mjs:4) | manifest 偏向内容/图片存在性 | 扩展 geometry、wrap/fit、font resource、crop/customGeom、style与group关系；导出后重开+渲染一致性 |
| [ppt/exporters/preview.mjs:75](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/apps/cowork-server/lib/ppt/exporters/preview.mjs:75)；`ppt/render-tree.mjs` | 浏览器文本/clip 与 Office默认值不同，原生几何支持不全 | 共用textLayout/clip契约；预览固定尺寸与字体一致；unsupported native geometry 保留原生预览，不擅自转矩形 |
| `ppt/publish-service.mjs`、`ppt/versioning.mjs`、`ppt/command-service.mjs` | 发布/局部改动需与新校验一致 | 同revision/hash校验；结构失败不可绕过；局部AI编辑触发受影响组件的reflow与完整性复核 |

这里列的是具体实施接缝，不建议一次性重写整个 PPT 引擎。优先建立共享契约，逐条替换现有默认和豁免逻辑。

## 13. 实施优先级、顺序和验收

### P0：先阻止错误成品通过

| 顺序 | 事项 | 完成标准 |
|---|---|---|
| 1 | 修正模拟/测试的生产 exporter 分派 | preserve 模板运行使用保真 exporter；日志可核对；相同 IR 的生产与模拟导出结构策略一致 |
| 2 | 两个 exporter 共用明确的 wrap/fit/margins 契约 | 每个新多句正文有 wrap 与固定形状策略；没有默认为扩展形状的长框；短单行标签实测适配 |
| 3 | 补布局与导出硬门禁 | 本轮15个长框可被识别并阻止作为合格成品；检查glyph占用、画布边界、遮挡与未声明重叠 |
| 4 | 嵌入字体、标题角色和图片几何保真 | preserve 不丢embedded font关系、curve clip；fallback可追踪并重新测量；无额外通用色带 |
| 5 | 改为组件组级媒体替换 | 省略不只靠矩形相交；required media/relationship零无依据丢失；普通 commentary 不清空全部视觉组件 |
| 6 | CodeBlock与关键来源结构完整性 | 案例中保留函数/赋值/数据依赖或明确正确最小片段；代码可运行性、表格完整列和流程步骤可以验证 |
| 7 | 修正测试和 critic 的证据质量 | 不再用deterministicReview模拟独立模型判断；输出可复查typed JSON、来源绑定与独立验收；每项通过说明其范围 |

P0 应覆盖模板模式与非模板模式，不能只给 Alpha Mining 的几页插入硬编码换行或手动改坐标。

### P1：提高不同案例的内容与布局质量

1. Planner/Writer 的主张所有权、component groups、required details、title intent 与 rich runs。
2. 各组 heading/body/condition/note 的层级，按比较、过程、机制等关系布置 readingOrder。
3. 多语言语义配对与空间成本，避免逐句长串和翻译误计独立信息。
4. 富来源可见覆盖与来源充分性联合检查，保留不同细节而非 filler；单一Gamma字数目标改为条件化profile。
5. 页数在完整义务与实际模板/字体容量上校准，允许源不足减页、结构复杂增页，保留用户锁定与来源限制。
6. 在生成与局部AI编辑后共用布局检查、版本一致性与目标修复反馈。

### P2：扩大模板与媒体能力

- 扩充比较、机制、角色职责、步骤、代码、图表、表格等组件族，以内容角色选择模板，保留原生可编辑证据。
- 有来源资产时自动绑定图像与caption；缺少装饰时使用可追踪的主题资产。来源不足时不生成假的数据图。
- 维护多案例Gamma/其他优质成品的校准集合，按用途和语言分组；从成品模式学习，不假设对方后台模型或照搬品牌与小字号。
- 加入跨平台字体及Office/LibreOffice差异的回归证据，记录 renderer 与字体版本，形成可持续质量基线。

## 14. 通用回归方案

只靠现有 Alpha Mining 样例通过不足以验证通用性。建议建立如下来源 × 模板矩阵，每种至少包含不同长度与页面容量：

| 场景 | 关键检验 |
|---|---|
| 中文、英文、英中双语长文 | 自动换行、标点断行、翻译语义成本、字体fallback、每组层级 |
| 稀疏短prompt / 单个概念 | 不虚构、不过度拆页、不为密度重复、不强制填满全部组件 |
| 科学/金融公式密集输入 | 变量、分数/上下标、数学字体、条件和可复算关系 |
| 代码教程 | 缩进、行顺序、函数签名、变量赋值与依赖、长标识符处理 |
| 多表/超长表 | 表头、列、单位、分页续表、双表比较轴及cell overflow |
| 多图与来源截图 | required小图、caption、图片role、crop和自定义几何、无证据替换 |
| 决策/业务汇报 | 较早的证据与判断、风险条件、角色行动、来源不足不编数字 |
| 流程/体系说明 | 先后关系、分支、动作/输出/注释分离、readingOrder |
| 不同模板 | 短槽/长槽、原生单行、多行标题、圆形图、复杂母版、嵌入字体、非16:9 |
| 局部修改与版本 | 加长正文、换标题/字体/模板、加图、undo/redo、导出与预览同revision |

应有三层验收：

1. **契约与结构测试**：导出OOXML 的wrap、autoFit、margins、字体资源、原生几何与声明一致；required对象、代码依赖、主张所有权完整；未声明组件丢失为0。
2. **实际渲染测试**：每页文字不得越出允许区域；无未声明遮挡/重叠；标题与局部标题清晰；表格/图表标签可读。允许预先声明的背景、卡片、图标、文字合法叠层，不要求所有矩形互不相交。
3. **内容/人工复核**：不同事实和关系充分，省略原因可核对；密度与用途匹配；重要原生对象可编辑。全局语义审查不可由对象计数或相同词命中代替。

最关键的负例就是当前文件：框几何无重叠、文字和图片都在、结构校验通过，但长正文导出为nowrap+spAutoFit。这类输入必须从“通过”变成可定位的失败，而不是继续返回8条密度warning。

## 15. 本轮成果与下一轮起点

本轮完成了成品逐页对比、OOXML/文本/媒体统计、当前质量门禁复查、原生保真导出控制实验和通用代码/Prompt改进方案。未修改产品代码或原交付PPT，也未把诊断性控制文件作为修复稿。

下一轮宜先实施 P0 的 exporter分派与 textLayout/fit门禁，保留本报告中的失败文件作为回归基准；随后恢复组件级模板适配和来源代码结构，最后重跑多案例内容组织与页数校准。每阶段均用最终导出文件作为证据，避免只检查中间IR或渲染联系表便宣布成品合格。

## 16. Gamma 实机补充：实验身份、控制条件与证据边界

### 16.1 本次确实运行的对象

从用户指定的 [Gamma 模板入口](https://gamma.app/#gamma-templates)进入，账户菜单确认登录邮箱为用户指定账户。模板库选择教学/代码方向的 **Compiler**，点击 Use template 后实际进入 **Agent chat → Setup form → Plan → 可视化编辑器**。这不是第 1–15 节原有 Deal Review 的 8 页参考，也不是旧 Paste in text / Visuals 表单；后文只描述本次实际出现的界面。

输入为原文件完整文本，14,307 个字符；SHA-256 为 `f7aec434d5496f9b4c2d114ecf26648eeda45fa1544837f59499de3d394f7c5d`。提交时仅在来源前加“用所选模板创建 presentation”的一句任务指令，未预先规定页数、布局和内容密度。完整请求归档为 `submitted-prompt.md`，不会把来源里的教学文字当作操作权限。

模板介绍提到白底、深色代码面板、克制的语法配色、步骤条、代码/状态成对、细线比较表等。**介绍描述不等于所有能力已执行**：本次实际看到深色代码块、双色分栏/橙色细线、编号检验网格和 AI 线稿，没有执行原生数据图表、状态模拟或 live timer。

| 条件 | 本次实际值 | 不能据此声称 |
|---|---|---|
| 创建模式 | Settings 中 Plan mode 默认选中；Express mode 为跳过计划的另一个选项 | 本次试验验证了 Express 效果 |
| Agent Effort | Standard 默认；菜单另有 Lite、Max | Standard 等于内容详细程度；后台模型已识别 |
| 来源处理 | Setup form 选择 Condense it, keeping your terms and facts | 原文逐字保留或每个细节都可见 |
| 语言 | Setup form 选择 Bilingual, English with Chinese beneath | Gamma 所有路径默认都输出双语 |
| 自动计划 | 完整生成 **20 页** outline | 20 页已经通过真实版式容量检查 |
| 最终页数 | 账户提示本次最多生成 10 页；因此明确发送合并为 10 页的实验指令 | 10 页是 Gamma 自动估算结果、模板固定页数或通用推荐 |
| 图片来源 | Plan 的 Look and feel 中默认 AI images；同菜单另有 Image placeholders | 本次看到了旧路径全部 Visuals 选项/模型/风格选择器 |
| 页面 | Page setup 为 Default 16:9、顶部对齐；Scale content to fit 与 Show overflow guides 开启；截图显示 Minimum text size 17 pt | 配置的 17 pt 能约束全部 caption、代码或最终导出 run |

**【第二次实测修正】Setup form 不是固定步骤。** 第二次运行（Sample Size 模板，46,347 字符双语教程，Plan mode + Standard）没有出现 Setup form。Agent 直接决定了语言（英文正文，中文只作关键术语）和代码处理（不放 Python，保留公式和阈值），并在 Plan 下方以 **“My calls to check”** 列出 Language / Code / Imagery 三项假设，请用户检查。因此上表的“来源处理”“语言”两行只描述 Compiler 这一次：Gamma 会在“先问”与“先做并公开假设”之间切换，触发条件没有观测到（可能与模板、输入或 Agent 判断有关），不能推断出固定规则。详见第 27.2 节。

最终在线文稿：[Alpha Mining / Compiler](https://gamma.app/docs/21cak5zvds79mry)。创建后实际保存了首次成品和单页 AI 修复后的成品，分别导出 PPTX 和 Gamma PDF，未修改账户分享权限或购买升级。

### 16.2 核验层级

本轮将四种证据分别记录：**UI/截图直接观察、可见 DOM/CSS 测量、实际导出 OOXML/PDF、实施建议/推断**。没有读取隐藏应用状态、私有 API 或 Gamma 内部 prompts；界面上的工具活动只证明用户看见了对应活动，不证明后台用了什么算法。没有在 Microsoft PowerPoint UI 中打开这两份新文件；Gamma PDF 的显示正确不等于所有 Office 环境都正确。

证据归档：[alpha-mining-gamma-live-observation-20261008](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/outputs/alpha-mining-gamma-live-observation-20261008)。其中包含逐阶段 AX 文本和截图、Plan 20→10 的请求、生成中/完成态 DOM、单页修改请求和版本比较、初始/修复后 PPTX/PDF、逐页 PNG、统计 JSON、`verify-live-exports.py` 与 `export-verification.json`。原 8 页对照证据继续保留在第 2.3 节目录。

## 17. 从模板到 Plan：交互、内容提取与页数行为

### 17.1 创建入口与可修改计划

1. **先确认模板身份。** Use template 跳转的 chat 带 Compiler template chip，可打开/移除模板；输入区有 Message input、Add or connect、Settings、Effort、Dictate、Send。页面另显示 Presentation、Document、Carousel、Image、Beautify、Import 入口。这些其他入口本次未运行。
2. **Agent 先解释组织方向，再询问必要变量。** 它以“搜索很廉价，验证才是一切”为主线，右侧打开 Setup form。来源处理三选项为压缩保留术语事实、原词保留、补充更多例子；语言选项为英中双语、英文、中文；两题都允许 Something else 自由填写。选择后 Create outline 才进入计划。【第二次实测修正】这一步是条件性的：第二次运行没有表单，Agent 一句话说明方向后直接生成 Plan，把语言、代码、图片的决定写进“My calls to check”供用户事后检查（第 27.2 节）。
3. **原文聊天与结构化 Plan 并存。** 左侧保留输入/解释/工具活动；右侧先 skeleton 后流式出现标题与 bullet 内容。每张 outline card 有 Add slide / Merge，文本可编辑；Look and feel 显示 Suggested template / View / Browse 与 Image source。无需回到来源页就能检查结构和修改要求。
4. **本次自动规划偏细拆分。** 先显示部分页，再完成 20 页；把范式、因子池、看别处效应、评估、池相关性、谱系、代码和坟场拆成不同卡片。其可见行为支持“按主题和教学关系切分”，不能证明已经按最终字体/框容量求得最优页数。【第二次实测补充】46,347 字符的输入自动规划为 24 页（20 张内容页 + 4 张 Part 分隔页）。按章节看，大章节被封顶、短章节各占约 1 页，而不是按字节比例分配（第 27.4 节）。
5. **账户限制独立于内容计划。** 20 页 Plan 保留，同时显示只能生成 10 页与升级提示。为完成实际样例，发送明确的 10 页合并指令，并要求全部 11 章覆盖、完整代码、不重复/不编事实、先改 Plan。右侧在原 Plan 内更新，Generate 在更新时不可用，完成后返回 10 页摘要及各章映射。

这一过程说明“模板默认页数、输入估算页数、计划实际页数、账户上限、用户锁定页数”应该有独立字段。不能把账户上限静默当成 Agent 的内容估算，也不能把 20→10 的人为条件说成自动 packing 成功。

### 17.2 10 页内容与版式的具体对应

| 页 | 来源与内容组织 | 最终可见版式/层级 | 完整性限制或价值 |
|---|---|---|---|
| 1 | 教程主题、公式化搜索、与 Tutorial 14 并读 | 左标题区：Alpha Mining、英文副标题、中文主题/副标题；底部背景说明；右侧线稿树 | 长原题拆成多个角色，而非塞入一个大标题框 |
| 2 | §1：假设驱动/挖掘比较 + WorldQuant 因子池 + 数字关系 | 上半部双栏比较；首次池模型全宽堆叠，修复后改双栏；底部边际价值问题 | 首次遗漏 √N 的近似独立条件，修复时补回；首次布局失败 |
| 3 | §1：看别处效应、验证、正则化、候选限定 | 左小幅线稿、右标题两行/双语说明/三个段落组/强调结论 | 保留百万公式、约 3,700 日、Tutorial 14 检验名；中文解释比英文更短 |
| 4 | §2+§3：字段、两类算子、正则化、Alpha101 阅读问题 | 全宽介绍 → 两栏算子组 → 全宽机制/问题；inline code 浅底 | 参数签名被压缩为算子名，不能算逐项完整函数说明 |
| 5 | §4+§5：数据字典/好坏字段、公式树/适应度 | 双栏，左数据质量，右公式树与 fitness 子标题 | 保留字典维度和罚项；不是完整讲解每个评价标准 |
| 6 | §6+§8：生成器 + 幸存因子组合 | 两个主题栏，中间细线；独立 heading/body/提示句 | “流畅解释不是证据”单独强调；组合器过拟合与权重约束可见 |
| 7 | §7：8 个关卡 + 低相关因子价值 | **4 列 × 2 行**编号检查项，底部一条因子池结论 | 各项短而不同；编号是步骤身份，不是把同一正文复制 8 次 |
| 8 | §9+§10：角色、谱系、A 股护栏/制度检验 | 左栏 Roles + Lineage，右栏 A-share filters/成本/跨制度；橙色顶部细线 | 角色只列团队名，源文的逐角色职责大量压缩；章节覆盖不等于关系覆盖 |
| 9 | §11：完整 candidate_alpha | 标题/中文说明/Example only/代码名称 + 深色完整代码面板 | DOM 与两版 PPTX 代码逐字一致、Python AST 一致；保持代码和说明分离 |
| 10 | §11：8 步挖掘闭环 + rejected graveyard | 左有序列表、右 AI 坟场线稿、底部记录决策原因 | 步骤与解释分开；图像是主题隐喻，不是检验结果或数据证据 |

压缩保留主张、条件、数字和结构应分别审查。首次稿虽覆盖全部 11 个章节，仍省略经济故事例子、部分职责和数学条件；Agent 的“每章已覆盖”“没有遗漏”类自然语言说明不能代替可见事实清单。双语也并非每个英文细节都有等价中文版本，例如第 2 页中文没有逐一重复 IC 与组合 ICIR 数字。

本次没有发现逐页整段 filler 复制来达成字数；同一验证主线在封面/生成器/关卡中出现属于需要评估的教学重申，不能仅按相同关键词判为重复，也不能把英中翻译算两份独立信息。

## 18. 生成中 visual editor：布局如何逐步变化

| 阶段 | 直接观察 | 对状态/产品设计的含义 |
|---|---|---|
| Generate 后 | 右侧由 Plan 转文稿 URL，初始空画布；Writing slides… 0/10 | 文稿容器、计划与已渲染内容分开，不能仅有总进度条 |
| 写作流式阶段 | 前 3 页出现实际标题/正文，后续页仍是标题占位；顶部仍可显示 0/10 | 有正文不等于节点完成；显示进度可能滞后，勿把流式文本当作完成页计数 |
| 图片阶段 | Adding images… 6/10、随后 7/10；部分卡片显示 Checking…、Polishing…、Done | 页面可以处于不同阶段；文本、资产、布局检查并非全稿同时结束 |
| 版式修整 | 封面分拆标题；第 7 页整理为编号检查网格；第 8 页标题层级/字号变化；第 10 页由早期步骤组整理为有序列表 + 图片 | 内容组件与排版在生成后继续变化，不能只保存首次 writer 结果 |
| 首次完成 | Agent 明确说第 2 页超出底部，9/10 通过；卡片一度显示 Couldn't finish | 其“Done/文稿已创建”不是所有页面合格；失败页面仍可导出 |
| 局部修复 | 第 2 页池模型从全宽段落改为双栏；其他页文本及导出几何核验不变 | 可在相同稿件内针对实际布局问题变更组件，而非全稿重跑 |

编辑器采用连续纵向卡片画布，打开 filmstrip 后左侧有缩略图/序号，点击定位页面；关闭 chat/filmstrip 或打开样式面板改变可用显示宽度，页面自身保持比例。实测卡片**真正的 slide surface**曾为 770 × 433.125 px，打开其他面板后为约 605 × 340.31 px，均约 16:9。包含 rail、外边距的 wrapper 约 826 × 481 px 不是 slide，不能拿 wrapper 比例判错。【第二次实测补充】770×433 是屏幕显示尺寸。第二次运行的卡片是 GML 结构：`.gml-card__canvas` 固定为 **1280 × 720 逻辑 px**（`--gml-card-frame-height: 720px`），用 CSS `zoom` 缩放到可用宽度（1440×900 视口下为 0.7266，窄面板下为 0.3766）。版式在逻辑画布上计算，与显示宽度无关。

可编辑正文使用 contenteditable/ProseMirror 风格的结构节点；grid/cell、heading、paragraph、code、math、image 是独立可见组件。手工编辑入口有 Add block、Freeform、插入 slide、页面级 Agent、speaker notes、Undo/Redo 图标；这些入口的存在被观察，未穷举每种手动操作或键盘快捷键。Styles 右侧面板分 Fonts、Colors、Logo、Design、Charts、Images、Custom styling；全局主题层与单页内容编辑层分离。

**本轮未在生成运行中另提交改要求来测试取消/排队语义。** 左侧聊天在生成过程存在并有停止入口，但是否原位替换、排队还是新 run，不能由这点推断。对本模块的 epoch/冻结范围设计仍依据已有代码和回归方案，而非声称 Gamma 本次验证了同样机制。

## 19. 换行、字体、空间约束与导出：双重核验

### 19.1 浏览器层的实际规则

读取正文/标题节点的 computed style 得到：`white-space: pre-wrap`、`overflow-wrap: break-word`、`word-break: normal`，而不是所有字符串都固定单行。段落 margin/padding 通常为 0，空间主要由组件与主题 gap 控制。标题中的显式 `node-hardBreak` 和代码换行与宽度触发的自动折行是两种不同信息，需分别保留。

未整体缩放的常见角色值：H1 56 px / 58.8 px line-height；H2 37.333 px / 42.933 px；正文 22.667 px / 31.733 px；caption 16.667 px / 21.667 px；部分 H4 26 px / 33.8 px；代码 17.333 px / 23.4 px。它们是**逻辑 CSS 尺寸**，屏幕 bounding box 还受卡片整体缩放，不能把屏幕实像素当 pt。【第二次实测修正】在 GML 的 1280×720 逻辑画布上（1280 px = 13.333 in @96 dpi），**逻辑 px × 0.75 = pt**：封面 H1 实测 69.33 px，编辑器工具栏字号框显示 52，两者一致。按这个换算，Compiler 的正文 22.667 px = 17 pt。第二次运行的 Sample Size 模板是另一套字号：H1 52 pt、H2 36 pt、H3 24 pt、H4 20 pt、正文 **18 pt**（24 px，行高 1.35）、次要正文 15.5 pt、footer 14 pt、中文术语标签 13 pt（第 27.7 节）。**字号层级由模板决定**，17 pt 正文不是 Gamma 的通用值。

Styles → Fonts 实际显示 Display、Heading、Subheading、Body、Eyebrow、Caption、Label 都为 **Noto Sans SC**，另有 block spacing，当前值 18。DOM 的代码也报告 Noto Sans SC，但 PPTX 代码 run 实际为 **Consolas 13 pt**；导出面板又要求宿主安装 Noto Sans SC 和 Inter。说明浏览器声明、排版角色、输出字体与运行环境必须分别检查，不能只读模板介绍中的“代码字体”或 CSS family。

Page setup 截图显示最低文字大小 17 pt，同时实际 PPTX caption 12.5 pt、代码 13 pt，局部修复后的正文 14.5 pt。因而 17 pt 设置的精确作用范围未验证，不能把它当成全局导出字号硬下限。AIMate 应明确 role-specific minSize，而不是模仿这个模糊语义。【第二次实测修正】作用范围现已确认。第二次运行的 Page setup 为 Minimum text size **18 pt**，其 tooltip 原文是 “The smallest the text will shrink to fit a slide before content overflows.”。Scale content to fit 的 tooltip 是 “Scale content up or down to best fit the slide dimensions.”，Show overflow guides 的 tooltip 是 “Shows a guide line when content overflows the 16:9 export boundary.”。也就是说，这个值是 **scale-to-fit 自动缩小的下限**，不是各排版角色的下限：同一份文稿里模板设定的 13 pt 标签和 15.5 pt 次要正文照常存在。10 张卡片的 `--content-fit-scale` 全部为 1，没有任何一页被缩小字号。所以 Compiler 的 12.5 pt caption 与 17 pt 设置并不矛盾。AIMate 应该把“角色字号”和“fit 时允许缩到的下限”分成两个字段。

### 19.2 不应把 Gamma 的 wrap=false 简化成禁止换行缺陷

初始 PPTX 有 68 个 `wordWrap=False` 与 48 个 `True`；修复后为 62/49。部分标题和已经可在一行内放下的标签采用 False；长列正文、代码、多段组件使用 True，字体/框尺寸按实际布局适配。两版所有文字框都**没有 `spAutoFit`**；初始 45、修复后 44 个框含 `normAutofit`，其他没有 autoFit 子节点。

这与模块原样例的“长正文统一 wrap=none + spAutoFit、布局器却预算多行”不同。判定缺陷的依据应是框的内容义务、实际测量和 fit 契约冲突，不能以“出现任何 nowrap”就判失败。

### 19.3 首次失败、修复效果及仍存在的差异

首次第 2 页最后问题框位于 y=515.464、h=23.891 pt，框底约 539.36/540 pt，几乎贴住页面底部。Gamma 自己的编辑器检查报失败；实际 Gamma PDF 最低字符 bottom≈539.292 pt，未落到页外，但已没有正常内容安全边距。**PDF 页外字符为 0 不会推翻编辑器的溢出告警**，也不证明内部组件相互间的安全距离合格。

局部修复后问题框改到 y=446.147、h=25.344 pt，中文问题在 y=484.628、h=20.297 pt；PDF 大图可见完整内容，底部空间明显增加。数学组件的原 √N 图像在修复后变成普通 `sqrt(N)` 文本；因此“数学公式溢出可能为误报”是 Agent 的解释，不能当作我们确认的诊断结论。

Agent 说“Text size is unchanged”，但实际导出核验不完全支持：标题由 26.5→28 pt，局部 heading 21.5→23 pt；原独立英文正文部分 16 pt，修复后多个英中段落合并框采用 14.5 pt。浏览器初始第 2 页标题 35.189 px、修复后 37.333 px，也体现原稿整体缩放与新结构角色的差异。**版式确实修复，字号/角色却并非全未变**。应记录机器测量与 Agent 叙述的差别，不能直接写“完全未缩小字号”。

### 19.4 导出交互与跨端边界

Export 支持 All slides、质量三档、PDF/PowerPoint/Google Slides/PNG；本次保持中间质量档、Editable tables 开启、Zoom to fit 开启，未改变设置。导出过程中对应按钮显示生成中且禁用，提示可关闭面板；实际 Downloads 中取得 PPTX/PDF 后复制归档，而非仅凭成功 toast 交付。字体安装提示与 gradient text/frosted background fallback 限制可见。

Zoom to fit、Page setup 的 Scale content to fit、浏览器 Fit 缩放是三个不同控制；本轮没有关闭它们做隔离实验，不推断哪个控制独立修好了哪一个问题。导出仍需重新读文件并核对，不能将屏幕缩放后的“看起来能放下”当作内容容量通过。

## 20. 每页/部分的 Edit with Agent：范围、逻辑、结果比较

### 20.1 单页操作实测

选第 2 页 → 页面 rail 的 **Edit with Agent** → 上方黑色提示“Choose a card or element to edit · Esc to cancel” → 卡片蓝色边框 → 浮动 composer。composer 显示 **Card · 标题截断**、What should change?、Send；空输入时 Send disabled，并标注 Enter send / Esc dismiss。左侧主聊天 composer 同时显示 Selected: Card 的范围 chip，提供 Exit select area，避免指令没有目标。

提交要求只改第 2 页、保留 10 页/模板/双语/数字/近似独立假设、重排固定 16:9、不重复/不编事实/不使用难读的小字。浮动输入提交后，请求进入主聊天历史；主聊天按钮变 Stop，出现 Editing… 工具活动；画布原位变化。完成后解释变更、补充的条件和剩余告警。

结果提供 **Original / Modified** 两张缩略图，Modified 默认选中，旁边标注“This edit changes slide 2.”。**Compare all changes** 打开全屏 Review changes，Before/After 并排，红色/蓝色高亮删改区域；底部 Restore all edits 与 Continue with selection。本次保留 Modified，打开/关闭比较确认后重新导出，两份 PPTX 只有第 2 页的文本、框几何和 shape 数发生变化，其他 9 页这些字段完全一致。

非目标页的 AI 图像在两次导出中字节/pixel 有差异，不能声称整文件或资产字节完全不变；对应编辑器图片 source URL、尺寸和导出位置均未变，逐页 PDF 的图像主题保持一致。差异原因未隔离验证，不能擅自归因于再次生成或某种编码器。

### 20.2 元素级入口实测与未执行部分

重新进入选择模式并点第 2 页 heading，范围自动从 Card 改成 **Heading · 标题截断**，同样出现浮动输入框并同步左侧 Selected chip。这确认页面内元素可作为可见目标。本次没有提交标题改写，以免额外污染成品；不能据此宣称“元素编辑执行一定不影响其他节点”。应通过后续自动化回归验证。

本次新 Agent 路径没有出现旧编辑器的 Make longer、Make shorter 等 preset 菜单；不能把其他报告中的旧菜单拼接成这次的实测界面。可吸收的是范围显式化、自然语言请求、过程反馈、变更解释、可比较版本、恢复/选择结果与局部复核，而不是要求产品复制同一菜单样式。

## 21. 新样本密度与媒体：修正通用 benchmark 口径

| 指标 | 原参考 Gamma / Deal Review | 本次 Compiler 首次稿 | 本次单页修复稿 |
|---|---:|---:|---:|
| 页数 | 8 | 10（人为上限） | 10 |
| slide size | 约 960×540 pt | 959.976×540 pt | 同左 |
| 幻灯片自身文本对象 | 89 | 116 | 111 |
| 幻灯片自身图片实例 | 20 | 5 | 3 |
| 其他原生 shape | 33 | 24 | 24 |
| 包内 media / unique | 32 / 32 | 6 / 6 | 4 / 4 |
| 原生表格 / 数据图表 | 0 / 0 | 0 / 0 | 0 / 0 |
| 内嵌字体部件 | 3 | 0 | 0 |
| 非空白文本字符 | 6,091 | 5,046 | 5,099 |
| 正文对象字符中位数 | 847 | 525 | 576 |
| 正文近似宽度单位中位数 | 550.46 | 367.9 | 401.8 |

沿用第 3 节口径：除封面、字号 <26 pt 且字符 >2 的文本对象，包括局部标题/导航。修复会改变字号角色和对象边界，所以 525→576 不能解释为全稿都增加了 51 个独立事实；只有第 2 页变了。这些统计不是模型 token、语义覆盖率或生成成本。

首次稿 5 张图片为 3 个 AI 线稿（第 1/3/10 页）与第 2 页 2 个 √N 数学图像；修复后数学改成文本，剩 3 张。包内 media 还可能包含非幻灯片自身对象，例如 badge 资产；故不能把 6→4 等同于丢了两个内容图表。代码、步骤、比较结构仍由可编辑文字和原生 shape 构成，并不依靠截图代替。

【第二次实测补充】Sample Size × 09_factor_testing 的 10 页没有导出文件，只有编辑器 DOM 统计，口径与上表不同，不并入上表，见第 27.7 节。该稿每页 36–110 个英文词（中位约 75），innerText 299–648 字符，纵向填充 78–87%，3 张 AI 装饰图，2 个原生表格，5 个 display 公式，0 段代码。

**原 8 页成品的 847 正文字符/20 张图片不是 Gamma 的统一目标。** Compiler 的双语教学布局更强调条理和留白；10 页里一些单元短，代码用独立宽框，检验页用多组短项。页数/密度策略应服从不同语义关系、语言配对、组件最低宽高和模板槽位，不能强迫所有模板达到单一字数或媒体数量。

## 22. 面向现有 PPT 模块的实施方案

本轮仅调研和更新文档。以下是建议改动接缝，**保持已确认的入口、选 LLM、选模板、输入/页数估算、syllabus 确认、生成、编辑与导出步骤**；不新增强制设置页，不复制 Gamma 账户限制，不讨论成本模型。现有模块已具备来源 inventory、packing、局部 action、proposal/version、生成中范围编辑；应补契约和验收而非重建同名系统。

### 22.1 P0-A：共享可测量的 TextLayout 与真实完成门禁

触及 `ppt-density-capacity.mjs`、`ppt-template-fidelity.mjs`、`ppt-render.mjs`、`ppt/import-pptx.mjs`、`ppt/point-layout.mjs`、`ppt/render-tree.mjs`、`ppt/exporters/preview.mjs`、`PptCanvas.tsx`、`ppt/quality-service.mjs`、`ppt-export-integrity.mjs`。

1. 建立版本化 `textLayout`：`role / paragraphs / runs / explicitBreaks / fontResources / fallback / minSize / lineSpacing / margins / availableRegion / wrap / fitPolicy`。正文为固定框、自动换行，只有测量通过的单行 label/title 可用 nowrap；`spAutoFit` 不可由库默认偷偷写入固定布局。预览、估算、导出用同一个字体/段落契约。
2. 将字符权重估算保留为快速初筛，最终以实际 glyph advances、脚本断行、段落 spacing、标题换行、公式/代码尺寸测量；单位只转换一次，明确 PPT pt、EMU、CSS px 和 viewport scale。模板保护区与有效区域按组件 union/holes 处理，不能把整个外接矩形都当可写空间。
3. 质量记录包含失败目标 `slideId/componentId/frameId`、revision、实际 ink bounds、允许边界、失败种类和建议操作；文字超框、覆盖 required asset、意外关系丢失为 hard failure。warning、未验证、通过分别显示；无确定性证据不得由 LLM 说“误报”直接消除。
4. renderer 路由先按第 13 节修正模拟入口；导出后重新读取 OOXML、required node manifest，再做实际渲染。`publish-service`/版本校验必须绑定同 revision/hash；通过预览的旧 revision 不可给新导出背书。
5. 输入内容不够时减页；真实 overflow 先找更合适区域/组件重排，再在完整性允许范围内缩写，再提出拆页/重估页数；最后才在角色下限内适度缩放。固定页数冲突必须返回可解释结果，不能重复填充、删除 required 信息或悄悄降低字号。

验收：长英中正文、长标题、混合标点、不可断标识符、公式和 8 行代码跨两种 exporter 都满足契约；新增测试应包含“框无交叠但 glyph 越框”“PDF 未页外但内容挤到安全区外”的负例。

### 22.2 P0-B：写作与结构覆盖先成为可验证义务

触及 `ppt-content-inventory.mjs`、`ppt-planning.mjs`、`ppt-prompt-contracts.mjs`、`ppt-source-artifacts.mjs`、`ppt-density-packing.mjs`、Deck IR/types 与 `ppt/semantic-review-service.mjs`。

- inventory 记录独立事实、数字/单位、条件、机制、否定、例子、代码/公式/表格/媒体及关系；`CodeBlock` 保存原始代码、语言、行序/缩进、依赖与 optional excerpt policy。数学保存 semantic source、变量与条件，不由文字提炼过程默默变成普通字符串。
- `contentGroups` 绑定 `sourceIds / claimOwner / languagePairId / relation / requiredDetails / componentRole / compressionDecision`。主张只由一个组主讲，教学重申必须显式标记；语言翻译共享 claim ID，但空间测量分别计算。章节命中只用于导航，不能替代每个 required detail 的可见覆盖。
- 对 paragraph、comparison、steps、roles、code、evidence、caveat 分别写作。标题可以是主题、解释或有来源的结论，不能所有标题强制成 6–12 个英文单词的判断句；副标题/双语名/注释有独立角色与容量。
- required 角色关系不能只剩角色名；原始代码原样保留时验 AST/逐字；源码对象被替换需记录等价关系、保留/省略原因，并让可见节点证明其义务。批量“全部 slots 已省略”不能仅因为省空间就通过。

验收：不同语义内容填入不同组件，零无来源事实、零无理由 required 结构丢失；近似独立条件不能在摘要中消失；多个章节被合并仍保留必要关系，密度与重复审查独立进行。

### 22.3 P1-A：页数估算与语义组件联合求解

触及 `ppt-density-profile.mjs`、`ppt-density-capacity.mjs`、`ppt-density-packing.mjs`、`ppt-planning.mjs`、`ppt/layout-registry.mjs`。

把现有页数估算扩展为“来源义务 → 语义分组 → 模板角色候选 → 真实布局测量 → packing → coverage/fit 复核”。比较组估算两列各自高度；英中配对单独计空间；代码按行/最长行宽，表格按最小列宽与表头/续表，流程按步骤关系。并列模块需最小宽度，不能只拿总字符除以固定字数。

输出 `templateInitialCount / estimatedCount / plannedCount / lockedCount / confidence / reasons / assumptions`，区分来自输入明确页数、模板预设、内容推估或用户锁定；初始显示模板页数，输入加载后显示可解释估算，符合最新原型。用户改模板/模式/内容时仅重估受影响容量，保留手动页数策略。账户限制不会进入内容估算公式。

建立多模板/语言/用途 profile，使用本次 10 页和原 8 页作为两份具名样本；不把其数字硬编码为 Alpha Mining 或所有教程目标。不需要通过图片生成来增加“密度”；缺少事实时保持合理留白/减页。

### 22.4 P1-B：在已有局部编辑上补范围、诊断与真实差异

现有 `ppt/ai-actions.mjs` 已有 improve/grammar/translate/expand/shorten/simplify/specific；`generation-edit-service.mjs` 已有冻结范围、hash、epoch、幂等、冲突和 proposal；`GenerationEditDialog.tsx` 已有右侧面板、历史、范围、失败重试与 `AiBeforeAfterPreview`。这些应复用，避免新增一套独立 AI 聊天后绕过现有事务。

1. `PptCanvas` 的选中元素/组件组/slide 与 `edit-context` 对接，浮动输入和右侧 composer 显示同一 `target kind + title/label + target IDs`。对象不可选时说明原因；空请求禁用发送；退出选择清理 UI scope，不改项目默认策略。
2. 将自然语言请求解析成现有 typed proposal；文字 action 不可隐式改布局/数据，layout repair 是独立授权类型。传只读邻页、来源义务、实际容量、保护区、字体角色和告警；不让“加长一点”重复全文或修改未选页。
3. 分开测量 `contentDiff / layoutDiff / typographyDiff / assetDiff`；前后缩略图按真实 slide size，比较页标出变更对象/范围和新旧测量。不能依赖 Agent 自述“字号未变”。asset 字节变动与对象语义/位置变化分开，避免导出重编码制造假差异。
4. 应用候选前重新检查 scope revision/hash；通过后才提交，并触发受影响组件 reflow、来源覆盖、required media、重复和最终导出复核。恢复走现有 command history/versioning，不能另存浏览器 snapshot 当作正式 undo。
5. `reflow` 优先使用同一页面不同组件排列；必要的跨页 split、语言或事实范围变更返回有说明的 proposal，由已有确认步骤处理。不能像首次 Gamma 完成态一样把未通过页包装成全稿成功。

### 22.5 P1-C / P2：生成进度、主题资产和可视化编辑器

在已有 `run-service.mjs`/runtime events 和生成 UI 中将 `planned/writing/assets/layout/checking/repairing/ready/blocked` 作为节点级事实，不用可见字数反推页完成；给出 ready/total、失败页数量与定位按钮。流式草稿、已检查页、最终导出 revision 可区分。用户生成中改要求继续用已有 epoch、冻结 scope、冲突/排队机制，不能由旧 run 最后一次异步写入覆盖新要求。

Styles 仅映射到现有主题 palette/font roles 与来源资产策略，修改字体/模板必须触发重测。Visuals 后续优化可配置来源图/占位/主题装饰/AI 资产、fit/crop/caption/altText，但资产必须分 `evidence / semanticDiagram / decorative`；无数据不生成虚构量化图。Compiler 的 3 幅线稿是可选装饰，不是 required chart 的替代。

卡片 viewport 缩放不改变 slide logical dimensions，缩略图/编辑 canvas/比较 preview/export 全部读取 Deck IR 的 page size。不要硬编码所有模板 16:9；本次 Gamma 默认是 16:9，但导入模板可为 4:3 或 custom。面板采用可达底部的独立纵向滚动区，composer/footer 可操作，避免此前原型长输入/确认按钮不可达的问题再次进入产品。

## 23. 可直接落实的 Prompt 契约增量与施工顺序

以下是 AIMate 的**建议 prompt 内容**，不是 Gamma 私有提示词，也不替代确定性测量。沿用现有 JSON schema/version 机制同步更新；LLM 不得仅返回“通过”或自动修复说明。

| 阶段 | 需加入/强化的指令 | 结构化结果与校验 |
|---|---|---|
| Planner | 按概念关系分组，不按 Markdown heading 机械分页；标记主张所有权、必要条件与结构；标准/详细都不可重复填充；语言跟 input | `sourceIds, relation, requiredDetails, bilingualPairs, componentCandidates, compressionDecisions`；每个 required detail 有归属 |
| Writer | 写不同事实/机制/例子；保留数字单位、否定、不确定性和假设；标题角色可独立；代码/数学保持 typed component；双语同 claim 不增信息量 | 有独立 heading/body/caveat/runs；源对象绑定与可见覆盖；禁止替所有框重写同一总结 |
| Layout | 根据实际字体/有效区域/保护组件选择比较、步骤、角色、代码等 layout；硬换行与自动换行分开；不足时减页、过满重排/提议拆页 | `regionBindings, textLayout, readingOrder, protectedZones, fitMeasurements`；正文 wrap 与固定框契约 |
| Local AI | 只改选中目标；邻页只读；保留目标 required details；禁止自改项目默认；容量优先于加长比例；布局修复与写作动作分开 | typed commands + baseRevision + target hashes + rationale + expected diff；未选中节点不变 |
| Repair | 读取实际诊断；先重排再必要压缩/拆页；不得补重复内容或降到角色字号下限以下；数学/代码不得因 fit 变字符串或截图 | 前后测量 + detail coverage + asset equivalence；剩余失败保留 blocked；不以“我认为误报”免检 |
| Critic/Export | 检查最终可见义务、真实布局和导出契约；分检查层与未验证项；描述 actual diff，不复述 writer 结论 | 同 revision/hash 的结构、语义、render、export 结果，失败目标和可重试操作 |

实施顺序应为：**修正生产/模拟分派 → TextLayout/换行/门禁 → 字体及 required 代码/媒体/语义覆盖 → 组件 packing/页数校准 → 局部编辑的测量差异与 reflow → 生成进度和可选视觉资产**。每批先在 `docs/exec-plans/active/` 写有范围、schema migration、测试和回滚的执行计划，再改对应模块；不能用一次“大修”同时改所有入口。

| 批次 | 优先级 | 验收产物 |
|---|---|---|
| 1：布局可用性 | P0 | 第 4/13 节原失败稿成为负例；修正 wrap/fit 导出；共享测量，安全区/重叠/字体风险可定位并阻止合格发布 |
| 2：内容与组件义务 | P0 | Alpha Mining 保留完整 code 和条件；其他来源含表格/图片/流程也不无理由丢失；独立事实不重复填充 |
| 3：内容容量 | P1 | 不同模板/语言/长短输入页数随真实组件容量变化，源不足减页，用户锁定冲突有解释；plan 与输出页数可追踪 |
| 4：AI 局部优化 | P1 | 页面/组/元素目标明确，真实四类 diff，未选页不变，apply/restore 冲突保护与重新审查；保真模板限制透明 |
| 5：进度与视觉扩展 | P1/P2 | 草稿/ready/blocked 有真实节点证据；生成中指令不被旧结果覆盖；装饰不代替证据媒体，多尺寸 canvas/面板滚动可用 |

## 24. 本次 double check 结论与后续验证边界

| 核验项 | 实际结果 | 证据/边界 |
|---|---|---|
| 输入 | 完整 source 与归档请求对照，hash 可复查 | 14,307 字符，非手工摘要作为输入 |
| 计划/页数 | 20 页默认 Plan；显式合并后 10 页；两版真实 PPTX/PDF 均 10 页 | 不能将 10 页标为自动估算 |
| 逐页画面 | 两版各 10 页 Gamma PDF 全页渲染，检查联系表与第 2/9 页大图 | 未进行 Microsoft PowerPoint UI QA |
| 换行/页面边界 | 所有 PDF 页 960×540，已提取字符页外为 0；初始第 2 页接近底边，修复后留出空间 | 不把页外字符为 0 当作没有内部重叠/安全区问题 |
| 代码 | DOM 完整；两版 PPTX 代码逐字匹配 source、AST 一致 | AX 曾拼接末两行，最终 code DOM/PPTX 否定了“代码丢换行”的假象 |
| 局部范围 | 只有第 2 页文本、shape 数和几何改变；其他 9 页这三项相同 | 非目标图片 source/位置保持，导出字节不同，记录区别而不宣称字节保真 |
| AI 自述 | 有9/10首次通过、修复后公式告警、字号未变等说明 | 警告如实保留；字号未变与 OOXML 实测不完全一致 |
| 内容完整 | 11 章主题皆有归属；关卡/代码/闭环保留 | 部分细节压缩、双语不逐句等价；章节覆盖不足以认证完整性 |
| 未验证功能 | Express、全部入口、Research、所有 preset、生成中排队、元素级执行、原生数据表/图、关闭缩放对照 | 不补成“Gamma 都支持并运行正确” |

本轮补充的是一个真实可复查的新路径观测和可实施方案。Gamma 的优势在于从来源分组到可视化组件、流式展示、局部重排和版本比较的连贯交互；其首次带告警交付、条件压缩和 Agent 自述偏差，也说明 AIMate 需要更严格的可见义务、实际布局测量与版本一致性门禁。通用实现的目标应是完整、不同、可读且可编辑的内容，而不是追求固定 Gamma 字数、固定图片数或固定页数。

## 25. dots 评价核对与跨输入的修复契约（2026-10-08）

本节将用户提供的 dots 评价视为独立测试反馈，不能冒充本轮亲自运行的测试。代码核对确认：坐标统一不等于渲染统一。`ppt/exporters/preview.mjs`、`PptCanvas.tsx` 与 `ppt-render.mjs` 分别决定文字换行、间距和图片 fit；两个预览的柱状图均对数值取绝对值，负数方向必然错误；`ppt-source.mjs` 将 CSV 写成键值文本，而 inventory 的表格 parser 只认 Markdown 管道行；提取器全局压缩空格，semantic 对 code 使用普通长文本分段，确实无法保证缩进。

**当前正面证据与缺陷分开**：正确的 native-template export 已保留曲线遮罩；新 Factor Zoo 渲染可显示中文。旧样例泛化出的“中文必丢/原生遮罩必丢”不作为当前缺陷。generic image framing 与文本契约仍需修复；复杂 native 几何预览近似不代表其原生文件损坏。dots 的 PDF 图表错误需独立重跑；正确 native data 不足以认证每个转换器的可见符号。

### 25.1 不依赖领域的目标和优先级

| 优先级 | 通用问题 | 落实方法 | 验收 |
|---|---|---|---|
| P0 | 固定框文字可见丢失被 warning/原生豁免放过 | 序列化 TextLayout：pt 内边距、wrap、固定框 no autoFit、paragraph/runs、行距；同规则测量，容量错误阻断发布 | 中英/混合、长 URL/标识符、多段/硬换行/小框负例不能通过；原生人工小标签不误当正文 |
| P0 | 三个视图文字规则不同 | Render Tree 生成契约，浏览器/SVG/Python 消费；卡片和表格各自明示有效区域 | 相同文本、边距、段间距和换行策略；不承诺不同字体引擎逐像素一致 |
| P0 | 重复增密度/截断结构 | 独立事实所有权与 source-object ledger；代码原文逐字验证 | 深度来源于机制、条件、关系与证据；不足减页，不能复写概述填槽 |
| P1 | 图表符号、单位、无效数据 | signed domain、零基线、正负方向、原生轴显式设置；invalid pie 阻断，单位原样显示 | 全正/全负/混合/零/小数和单位；不将 percent 自行除以 100 |
| P1 | 图片边框、裁切跨视图变化 | 统一 contain/cover/stretch 和 crop rectangle，显式裁切优先，保真路径仍保持 native mask | 横/竖/透明、裁切与未裁切；截图对比并核对 PPTX crop |
| P1 | 输入先损失结构再排版 | 提取时保存 typed rows/code、语言/缩进、流程顺序；按结构估算容量 | CSV quoted/newline/empty cells、XLSX、HTML table/pre、Markdown 代码、DOCX/PPTX 表格 |
| P2 | 标题/排版漂亮但内容浅 | Planner 分组归属，Writer 完整机制/条件，Critic 检查实际可见义务 | 多领域标准/详细模式，摘要不替代解释，双语同 claim 不重复计信息量 |

### 25.2 多类输入验收矩阵

| 输入族 | 内容义务 | 布局/密度策略 |
|---|---|---|
| 短 prompt、业务汇报、提案 | 问题、决策依据、责任与限制；无数字不造图 | 少页、短主说明与支撑点；合理留白，不拉长重复 |
| 长研究/教程、多章节文件 | 定义、机制、假设、案例、结论与尾部细节 | 按问题与关系合并章节；主解释 + distinct supports；长表续表、完整代码按容量安置 |
| 英中/日文/混合输入 | 原语言分布、变量/专名/否定、必要翻译关系 | CJK/Latin 宽度分开测量；成对语言消耗空间，不充当新事实 |
| CSV/XLSX/HTML/Office 表格 | 行列矩阵、空值、负号、单位、表头关系 | 实际列宽/行高与 cell padding，不能键值 prose 替代 table |
| Markdown/HTML 技术材料 | fenced/pre 原始代码、空行、缩进、语言；公式可编辑表达 | 等宽字体、原始硬换行；容量不足提议分块/拆页，不改程序语义 |
| 流程、制度、服务架构 | 步骤、分支、角色、条件、前后关系 | ordered steps/arrow 保留顺序，不能将同页关键词当关系覆盖 |
| 图表、图片混合内容 | 有效数据、符号/单位、来源图/装饰角色 | 图文联合容量；媒体不能因腾空间默默省略，native 不走 generic 重建 |

### 25.3 Gamma 密度与深度的通用判定

不能以 Alpha Mining 的 8/10 页、847/525 字符中位数或某字号作为所有输入的阈值。应同时看 distinct claims、完整机制与条件、结构/关系召回、正文可读性、组件占用和重复率。图表/代码/公式/表格承载的信息不由正文字符数代表。标准模式保留必要解释，详细模式增加来源支持的关系、证据或实现细节；二者都不能补造案例或重复文字。容量从实际模板文本区域、字体、内边距、语言与组件求得，自动页数可减可增；锁定页数不足返回明确冲突而非静默丢失。

Prompt 不负责预测像素坐标。Planner 先分配不同的 source units，Writer 按角色写完整、非重复解释并原样绑定 required structures，Layout/QA 使用确定性契约；Repair 优先重排/重新分配，再有依据压缩；Critic 检查实际节点和完整关系，不能以模型自评替代渲染。执行计划：`docs/exec-plans/completed/ppt-general-render-contract.md`。实际实现与本轮测试结果见后续补充；Microsoft PowerPoint UI、真实模型和未运行的格式必须保留验证边界。

## 26. 通用优化已落地：实现、实际测试与剩余边界

本节记录本轮代码变更，前面的 Gamma 观测和第 22–23 节提案保留其原始时间与范围。“本轮仅调研”指前一次 Gamma 实机观测，不再代表本轮状态。此次未改新建、选模型、选模板、输入、估算、确认 syllabus、生成中指令、编辑、发布/导出的步骤，也没有增加成本模型。未写 Alpha Mining、Factor Zoo 或特定模板名称分支。

### 26.1 共用渲染契约与可见损失门禁

新增 `apps/cowork-server/lib/ppt/render-contract.mjs`，Render Tree 的元素带 optional `textLayout / tableLayout / chartLayout / imageLayout`。旧项目重建 Render Tree 即获得契约；`renderContractVersion=1` 使旧增量缓存全稿重建，generic exporter 不复用旧合同缓存；没有数据库 schema 或 Deck IR 类型迁移。统一使用 point 定义文本内边距、段间距和字号，EMU 只在布局边界转换，CSS 根据画布实际宽度缩放；不再假定每个模板都是 960 pt 宽；external native 采用原尺寸/段落元数据，Canvas 的宽高比与缩放都跟随真实 slide size，包括 4:3。

| 组件 | 共享规则 | 实际代码接入 |
|---|---|---|
| 正文/标题 | 自动换行，保留硬换行，固定框 `autoFit=none`；pt margins，段落行距/段后距，混合字号 runs；原生段落原文匹配时保留各段规则 | `render-tree.mjs` → `PptCanvas.tsx`、`ppt/exporters/preview.mjs`、`ppt-render.mjs`、`ppt/import-pptx.mjs` |
| 要点卡片 | 统一左右/上下 padding、1.18 行高、3 pt 标题间距；布局估算调用相同测量器 | `ppt/point-layout.mjs` 与两种预览/PPTX |
| 表格 | 保留矩阵，pt cell margins，固定框、自动换行；按真实行/列权重测量；零/负/非有限权重不能以 NaN 绕过审查 | `ppt-density-capacity.mjs`、`render-audit.mjs`、preview/PPTX |
| 代码 | 原始硬换行、空行、缩进、语言，ASCII 与中文字体运行片段分别选择覆盖字体；ASCII 使用等宽候选，禁止普通 prose 清洗 | source/semantic/inventory → source-owned component → 两种 exporter |
| 图表 | 匹配且有限的 labels/values，signed domain、零基线、单位原样、显式数值格式；负值 pie 和全零 pie 拒绝 | 服务端生成 `chartLayout.svg`，两个浏览器预览共用；原生 PPTX 使用相同数据/domain |
| 图片 | contain/cover/stretch；显式 crop 优先，各边和剩余范围合法；有效 crop 不再被各视图私自截成 0.95 | `imageLayout` 与共用 Python `contract_picture`；native 原图/遮罩仍走保真路径 |

新增 `render-audit.mjs`。固定框边界、容量、低于正文下限、非法数据/裁切、表格单元格溢出、point-layout overflow 均进入确定性审查。`ppt-quality.mjs` 的 `deterministicReview` 在**生成路径**也运行 Render Tree 审查；此前只在独立编辑质量服务中检查布局会使首次生成绕开门禁。`ppt/quality-service.mjs` 复用该结果，不产生两套不同的检查。external native 发布过滤名单也保留容量、表格、crop 和图表数据错误，避免审查已检出而发布又过滤。nativeRef 不再自动豁免可见容量问题；原生人工小标签也没有被强行改成 14 pt 正文。

测量器按 CJK/Latin/等宽字符、混合字号、硬/软换行、空代码行、段间距和实际 padding 预测高度，留 10% 宽度余量；单字符比有效宽度还大也失败。**这是保守预测，不是实际 glyph shaping / Office ink-bounds 证明。** 几何通过与导出结构完整均不能等同于每个转换器逐像素一致。复核图片/PDF仍须保存实际证据。

### 26.2 多格式输入不再先丢结构

- CSV 以真正的二维矩阵进入 inventory，quoted pipe、quoted newline、空单元格、负值与单位不变成 `header=value` 摘要。XLSX 按工作表提取矩阵，范围截断有标记；DOCX/PPTX 的现有表格路径也参加原生文件测试。
- HTML `<table>` 保存矩阵、`<br>` 换行和空值；`<pre>`/嵌套 `<code>` 保存原文和可识别语言。合并单元格目前发 required warning，不能伪装成正确矩阵继续合格发布。
- 粘贴/Markdown fenced code 是原子 CodeBlock；不走全局空格压缩，也不在 ordinary prose 的 chunk limit 内随意切开。保留 oversized atomic code 诊断，去掉代码前孤立的纯标题 chunk。过长代码当前会因容量失败阻止发布，**尚未自动生成带行号映射的续页**。
- `ppt-content-inventory.mjs` 保存 CodeBlock 的语言/结构义务；Markdown 表格不再误删全空行或清掉单元格代码符号。流程章节下的有序步骤获得 ProcessBlock；含分支的关系保留其完整原文，不能为了画线性 timeline 而删分支条件。
- `ppt-object-integrity.mjs` 对代码逐字和语言核对，缩进变动即失败。显式标记 `mustPreserve` 或 evidence/source/semanticDiagram/brand 的模板媒体成为保护区，布局找剩余矩形区域；不能仅以“需要更多空间”省略这些对象。未标记旧模板示例内容仍沿用原有主题适配规则。

这些规则适用于业务表格、技术文档、研究教程、制度流程与混合语言文件。普通 PDF 的 OCR、扫描表格复原、Word 中未标记的代码识别、任意 HTML 嵌套/跨格拓扑仍未新增为可靠能力。

### 26.3 Gamma 密度/深度如何进入 prompt 与估算

`ppt-prompt-contracts.mjs`、`ppt-generation-policy.mjs` 的合同版本更新为 6；`ppt/versioning.mjs` 的 review rubric 同步为 6，防止旧模型审查被当作新规则认证。

Writer/Repair 明确要求：不同组件承担不同事实，保留机制、条件、因果、数字/单位、证据和限制；双语两段是同一 claim 的空间占用，不能算两条新增事实。标准模式保留必要解释，详细模式写更多来源支持的机制/关系与实施细节；source-only 不允许补造案例和数据。required 表格/代码/公式/流程/清单通过真实库存 ID 绑定，不由模型改写为标签、prose 或截图。加长不得复写全篇；修复不得把可见丢失/裁切/数据错误降为“误报”，也不能删除 required 对象或无限缩字号。

`ppt-density-packing.mjs` 不再把所有 prose 原句压成固定 65/95 单位预算，而按来源长度、机制/条件/数字锚点和标准/详细模式估算；结构成本来自组件实测尺寸，代码空行、表格列宽行高均计容量。现有 grouping、claim ownership、重复检查、自动减页/锁定页数冲突机制继续工作。装饰图片数量不被当作信息密度，保护媒体占用会减少可写区域。

这改善“丰富原文被压得过浅”和“格式复杂但估算当普通短文字”的根因；**不是与 Gamma 的真实模型输出已达到质量等价的实验结果**。仍需同源、多领域、多个模板的真实模型盲评，比较独立事实、机制/限制覆盖、结构召回、重复和可读性，不能只比较字数。

### 26.4 本轮实际运行与验收证据

证据目录：[`outputs/ppt-general-render-contract-20261008`](../../outputs/ppt-general-render-contract-20261008/README.md)。新增自测 `apps/cowork-server/selftest-ppt-render-contract.mjs` 与 UI 用例 `src/__tests__/e2e/ppt-render-contract.spec.ts`。测试包含正例与错误输入/小框/丢缩进/非法权重/省略保护媒体等负例。

| 层 | 覆盖 | 本轮结果 |
|---|---|---|
| 输入与结构 | paste/Markdown、CSV、XLSX、HTML pre/table、DOCX/PPTX 表格，有序流程；英语/中文/双语、长标识符、多段 | typed matrix、空值/换行/负号、代码原文/语言和结构义务通过 |
| 可见门禁 | 小框、dense bilingual、nativeRef 容量、单字比框宽、非法表格权重、保护媒体 | 应失败的样例产生 hard error，生成确定性审查也收到该错误 |
| PPTX | 生产 generic exporter 与 native added-code 路径，重新打开文件核对 | wrap/no autoFit、混合字号/多段对齐、代码逐字、原生 signed data/axis、crop 通过 |
| 实际 PDF | 调用生产 `renderPdf`（PPTX→LibreOffice），pdfplumber 核验 + PNG 目检 | `-4` 柱子在零线下、`-4` 标签在其下，中文实际可见；ASCII 代码 glyph advances 等宽 |
| 浏览器 | dev 服务 +真实 Chromium，生产 Canvas，API fixture；桌面/窄屏/移动视口截图、控制台 | 带符号图表、图像 fit、代码/表格、可见边距正常，console/page errors 为 0 |
| 基础回归 | `npm test`、smoke、PPT 后端自测 | typecheck + 2,808 单测通过，1 skipped；38/38 smoke；16 个后端脚本（含新契约自测）通过（其中 density 21 场景组、density-audit 27 场景） |

复核期间真正发现并修复的差异：

1. 柱状图原生 values 为负仍可能在 LibreOffice PDF 显示为正；显式设置 bar series `invert_if_negative=False` 后，实际矩形方向与标签一起正确。只检查 chart cache 不够。[python-pptx API](https://python-pptx.readthedocs.io/en/stable/api/chart.html) 给出该系列属性，但这里的修复结论来自生产转换控制实验。
2. SVG 字体若用 EMU 量级数值，Chromium 会产生极小标签；图表内部改 point 坐标再一次缩放到 EMU，并在 UI 测量标签实际高度。
3. SVG fragment 直接交给 DOMPurify 会丢掉图表元素；用完整 SVG namespace 包裹后再消毒、取内部内容，signed bars 的实际 DOM 参加测试。
4. 混合中英代码整行选择 CJK fallback 会令缩进前缀失去等宽保证；分开 ASCII/CJK runs，优先可覆盖的等宽字体。实际 PDF 检查等宽 advances，保留中文字符。
5. richer paragraph runs 不能再被最后一次统一设字号覆盖；逐 run 保留尺寸，浏览器父段落字号同步最大 run，所有段落对齐均写入原生导出。

环境说明：测试使用 Node 22.22.0（匹配当前 SQLite ABI）和自带 Python/LibreOffice；错误 Node/Python 的初次尝试单独辨识并重跑，没有重装依赖来掩盖失败。仓库要求 chrome-devtools MCP 验证，但本会话无该工具；补做 `chromium.connectOverCDP`、`Page.captureScreenshot` 与 `Emulation.setDeviceMetricsOverride` 的实际 CDP 检查。UI API 为 fixture，不代表真实 Cowork/在线模型端到端验收。

### 26.5 后续实施顺序与明确未完成项

| 优先级 | 后续工作 | 验收要求 |
|---|---|---|
| P0 | 实际 font shaping/ink bounds + 每稿转换后可见检查；解析继承字体和 native table cell styles | 同 revision 的实际图像/文字边界，不靠 conservative estimate 认证无 clipping；不会把复杂 native 表格字体误当统一 18 pt |
| P0 | 超长代码和复杂表格的可追踪续页；扫描 PDF/跨格输入结构拓扑 | 原行号/行列/关系映射完整；不能截断或将 pending 当成功 |
| P1 | 长分类标签、多 series/复杂 chart 的容量与语义轴；native mask/复杂几何的预览更精确 | 更多图表类型跨 preview/PPTX/PDF 可见一致，底层正确数据与画面分别验收 |
| P1 | 多领域、语言、模板的真实 LLM 内容基准与 prompt 调优 | 独立事实、条件/机制、尾部细节、媒体关系、重复和读者理解；统计区分模型与模拟输出 |
| P1/P2 | 第 22.4–22.5 节中的真实四类 diff、精细进度证据和可选视觉增强 | 复用当前 proposal/版本/队列，不绕过 revision/hash，不改已确认 workflow |

没有声称测试 Microsoft PowerPoint 本体、在线模型或所有 Office/font 环境。原生曲线遮罩和当前中文正面证据继续保留；本轮主要交付是可靠契约、输入结构、深度容量与确定性门禁的通用基础，之后的像素级和真实模型基准有独立验收条件。

## 27. Gamma 第二次实机观测：Sample Size 模板 × 09_factor_testing（2026-10-08）

本节是另一模板、另一输入的独立运行，用来检验第 16–21 节哪些结论可以推广。证据目录：[factor-testing-gamma-live-observation-20261008](/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot-para/outputs/factor-testing-gamma-live-observation-20261008)（`observation-log.md`、`plan-24-auto.md`、`plan-10-after-merge-request.md`、`final-deck-and-measurements.md`、`module-estimate-counterfactual.mjs`、输入副本与提交请求）。证据层级为 UI 观察、编辑器 DOM/CSS 读取和定时 DOM 采样。**本轮没有导出 PPTX/PDF**（下载需用户另行同意），因此没有本稿的 OOXML wordWrap/autofit 结论。

### 27.1 实验身份与条件

| 条件 | 实际值 | 不能据此声称 |
|---|---|---|
| 模板入口 | 新版 “Gamma templates” 库，筛选 Format / Category（Lesson 201、Proposal 176…）/ Topic（Business 326、Education 256、Data and analytics 129…）/ Color / Style；Lesson + Data and analytics 共 11 个；选 **Sample Size**（Presentation · 16:9 · By Gamma） | 模板库分类数量长期不变 |
| 模板自述 | 原生图表 + 编号注释、数据表、方法条、时间线、worked example；深绿 graph-paper 底、白色 lab-sheet 面板、静物照片；样例约 28 张卡 | 生成稿一定会使用自述中的全部组件 |
| 输入 | `09_factor_testing.md` 全文 46,347 字符，SHA-256 `e10c84c46777d2cac50b8eb3d8a10a4c03a01ce63098e7edc49ea7f239de68c0`；15 章，几乎每段都有英中平行翻译，13 个代码块，23 个 `$$` 公式，4 个表格；前面加一句任务指令 | 换成单语输入也会得到相同结果 |
| 粘贴方式 | 长文本被 composer 转成 “Pasted text · 60 KB” 附件；聊天里显示为 `.txt` 附件 | 附件路径与直接输入的处理完全相同 |
| 模式 | Plan mode + Standard（均为默认） | Express、Lite、Max、Research 的行为 |
| 页数 | Agent 自动规划 **24 页**；Free 账户最多生成 10 页，因此发送了与 Compiler 次相同的“合并为 10 页、覆盖 15 章、不重复不编造”实验指令 | 10 页是 Gamma 的自动估算 |
| 成稿 | [rw4yvdml7t1xokj](https://gamma.app/docs/rw4yvdml7t1xokj)，10 页，生成约 114 s，Agent 称 10/10 通过 layout checks | 已在 PowerPoint 或 PDF 中复核 |

### 27.2 Agent 交互：没有 Setup form，改为先做后公开假设

1. Send 之后显示 “Setting up”，标签页标题变为 “… · Working…”，约 40 s 后变为 “· Outline ready”。Agent 用一句话说明方向：沿八阶段检验流水线组织，“uses English with the Chinese key terms alongside”。工具活动依次为 Prepped selected template → Opened the Plan view → Created Plan。Plan 以文件形式存在：`gamma-agent/session/generations/factor-testing-tutorial/brief.xml`，聊天里可以点开。
2. 右侧 Plan 面板上方是 Look and feel（Suggested template、Browse templates…、Image source: AI images），卡片逐张流式出现，每张有 ⋮ 与 Merge。自动计划是 **24 页、4 个 Part**（Prepare / Test / Can you trade it / Prove it holds），带 4 张章节分隔页。
3. Plan 下方是 **“My calls to check”**。Language：英文为主，中文只在封面和分隔页。Code：“I left the Python code out. The slides keep the formulas and thresholds.”。Imagery：少量，流水线和五股票例子用图表/表格表达。Agent 把自己做出的、会影响内容完整性的决定明确列出来，而不是先弹表单询问。
4. 第 10 张卡后插入 “Free includes up to 10 slides. Upgrade to generate all 24 slides.”。账户限制和内容计划是两件事（与第 17.1 节一致）。
5. 发送合并请求后，状态为 “Deciding on next steps…”，Plan 原位重新流式生成（骨架行，聊天里的 outline 计数从 1 实时增到 10），完成后显示 “Edited Plan”，给出章节映射，并主动提醒：“Some slides are dense because of the merging…”。Agent 工作期间 Generate 按钮 disabled，tooltip 为 “Waiting for agent to finish”。合并时去掉了分隔页，标题后面加上短中文标签。

**结论**：Gamma 在“先问用户”（Compiler 次的 Setup form）与“先做，再公开假设请用户检查”（本次的 My calls to check）之间切换。两种方式共同的地方是：**语言、代码和图片的处理决定在生成前对用户可见、可改**。AIMate 不需要复制表单，但计划结果中必须带这类假设清单（第 28.4 节）。

### 27.3 内容提取规则（由可见结果归纳，非 Gamma 内部规则）

| 源内容类型 | Gamma 的处理 | 实例 |
|---|---|---|
| 英中平行翻译段落 | **只算一份内容**：正文用英文；中文降为标题下 13 pt 的关键术语标签（第 3–10 页），以及封面副标题第二行 | 全稿约 736 个英文词、56 个中文字符；没有任何英中段落对 |
| 讲解性 Python 代码（13 块） | 全部省略，并在 My calls to check 中说明 | 本模板以数据课程为主，不是代码模板。Compiler 次是代码向模板，完整保留了 `candidate_alpha` 代码（第 17.2 节），所以代码策略随模板/用途而变 |
| 代码块里的 ASCII 流程框图（§1） | 改为原生 4×2 编号卡片网格，每格为阶段名 + 该阶段要回答的问题 | 第 2 页 |
| display 公式（23 个） | 保留 5 个 display + 1 个 inline 原生 KaTeX 节点，选的都是定义被报告统计量的公式；√ 写作 `^{1/2}` | MAD、残差、ICIR/t、turnover、break-even、IR law |
| 表格 | 阈值表（§4.4）压成一条 bullet（只保留月频行和 0.15 警戒）；排序错误表（§2.2，5 行）删除；worked example 的代码 dict → 原生 Signal/Forward return 表；正文里的数值例子 → 原生 Example/Value 表 | 第 4、6、8 页 |
| 可枚举条目 | 几乎逐项保留 | 8 个阶段 8/8，报告项 9/9，常见 bug 8/8，A 股掩码全部保留 |
| 长篇讲解章节 | 只保留流程、规则、阈值和一个公式；动机、替代方案比较、错误示例删除 | §2（13,018 字符）与 §3 合成 1 页；§4（10,862 字符）为 1 页，IR law 移到第 10 页 |
| 限定语 | 大多保留，有一处丢失 | “≈ 50 bps” 丢了源文 “one-way equivalent”；“run both and compare” 被简化为 Spearman 是默认（源文确有 “industry-standard default”） |

逐项核对第 4、6、10 页的数字（0.03–0.05、0.05、0.15、12/24、k 3–5、1.4826、4%、800%、50 bps、TC 0.5–0.8、BR 低于股票数），全部能在源文找到，**没有发现编造的事实**。10 页版本的英文词保留率约 736 / 约 4,570 个非代码英文词 ≈ **16%**。

### 27.4 页数：Gamma 自动 24 页 vs 模块估算 46 页

在当前工作树上离线运行 `estimatePageRecommendation`（paste 路径，默认容量 18 pt，不调用模型）：

| 输入变体 | 模块推荐 | 范围 | content cost |
|---|---:|---|---:|
| 原文件 | **抛异常** `invalid source table geometry` | — | — |
| 只把表头 `$\|\overline{IC}\|$` 改写为 `$\lvert\overline{IC}\rvert$` | **46**（detailed 为 51） | 45–55 | 30,096 |
| 再删除代码块 | 31 | 30–36 | 19,684 |
| 保留代码，删除以中文为主的平行段落 | 39 | 38–46 | 25,214 |
| 代码与中文平行段落都删除 | **24** | 23–28 | 14,802 |
| Gamma 自动 Plan | **24**（20 内容页 + 4 分隔页） | — | — |

1. **抛异常是确定的缺陷。** `ppt-content-inventory.mjs` 的 `markdownRows` 按所有未转义的 `|` 拆分单元格，也会拆开行内数学的绝对值竖线，于是表头 5 格、正文 3 格。`ppt-density-capacity.mjs` 的 `measureComponent` 随即 throw，整个页数估算失败。量化、统计类教程里 `$|x|$` 很常见，这不是个例。
2. **其余差距几乎全部来自两条策略。** 代码块按 `must_preserve_structure` 以完整实测高度计成本（46→31）；双语平行段落两种语言都计成本（`ppt-density-packing.mjs` 注释：“Both languages retain display cost”，46→39）。两项都去掉后得到 24 页，与 Gamma 的自动计划一致。这个吻合是在单一样本上的反事实结果，删除中文的方法是启发式的，**不能当作容量模型已校准的证明**，但足以说明主要差距在内容策略，不在每页容量。
3. **分配形状不同。** 模块（balanced、修正表头后）按字节比例分配：§1 5.59 页（ASCII 框图按代码算）、§2 13.98、§3 6.12、§4 10.73、§5–§14 各 0.27–0.74、§15 3.11。Gamma 的 24 页是：§1 2 页、§2 2 页、§3 1 页、§4 2 页 + IR law 1 页，§5–§14 大多各 1 页（§5+§6 合并），§15 1 页，另有封面、动机页和 4 张分隔页。也就是说 **每个独立问题约 1 页，大章封顶**，短章并不因为字数少而被挤成零点几页。

### 27.5 生成中 visual editor 的变化

| t（Generate 后，秒） | 观察 |
|---|---|
| 0–15 | 跳到文稿 URL；**overview 网格**（3 列）一开始就显示 10 张只有计划标题的占位卡；状态 “Writing slides… 0/10” |
| 23–25 | 封面第一个出现正文（311 字符） |
| 27–80 | 卡片大致按顺序写入，同时 2–4 张在进行；单张卡在 1–2 个采样间隔（2–5 s）内从只有标题跳到 430–660 字符，即**整卡写入，不是逐字流式**；后面的卡还在 Writing 时，前面的卡已经独立显示 Checking… / Polishing… / Done |
| ≈80 | 10 张都写完，显示 “Adding images…” |
| ≈84 | “Checking every slide…” |
| 86–110 | “Polishing slides… 9/10”；polish 会小幅删减文字：第 4 页 619→606、第 8 页 629→616、第 9 页 465→454、第 10 页 526→520→514→507 字符 |
| ≈114 | 状态条消失；聊天给出完成说明：10/10 通过 layout checks，最密的是第 3、7 页，可拆分、删减或整体重排 |

与 Compiler 次相比：**这次没有失败页**；进度依然是逐页、各页阶段并行；polish 阶段确实会改文字（删减 1–4%），不只是排版。

### 27.6 版式与组件（GML）

卡片结构是 `gml-heading / gml-paragraph / gml-bullet / gml-table / gml-grid / gml-grid-cell`，grid 带 `layout=grid`、`gridDirection`、`gridRole=structure|collection`、`gridLevel=card|block`。本稿实际用到的版式词汇：

| 版式 | 页 | 比例/结构 |
|---|---|---|
| 文字 + 图片的卡片级分栏 | 1、4、10 | 63/37、30/70、67/33；图片满高 624 px |
| 全宽标题 + 两个面板（structure） | 3、5、6、7、8 | 58/38、49/49、48/48、49/49、55/42；每个面板有 H3 小标题 |
| 重复项网格（collection） | 2、9 | 4 列 × 2 行（编号 + H4 + 问题）、2 列 × 4 行（单句面板） |
| 纵向编号步骤（collection vertical） | 3 | 5 步，带圆形编号 |
| 侧栏公式面板 | 3 | H3 + display math + 2 句说明 |
| 面板底部的结论句 | 5、7 | takeaway 段落沉到面板底部 |
| 原生表格 | 6、8 | 2 列表格，强调最后一格 |

模块目前的 `fitComponents` 只尝试 1 栏或 2 个等宽栏（`stacked-source / parallel-source`），`ppt-layout.mjs` 中的 10 个语义 layout 也没有 collection grid、编号步骤、不等宽面板、公式侧栏这几种（第 28.7 节）。

### 27.7 字号、密度与换行规则

字号（逻辑 px × 0.75 = pt）：H1 52 pt（仅封面，硬换行）、H2 36 pt（全部单行，24–41 个字符）、H3 24 pt、H4 20 pt、正文/bullet/表格 **18 pt**（行高 1.35）、次要正文 15.5 pt、footer 14 pt、中文术语标签 13 pt。全部为 Noto Sans SC，`white-space: pre-wrap; overflow-wrap: break-word; word-break: normal; text-wrap: wrap; hyphens: manual`（与第 19.1 节一致）。

| 指标 | 第 1–10 页 |
|---|---|
| 渲染行数 | 7 / 28 / 15 / 11 / 16 / 19 / 18 / 19 / 13 / 11 |
| 英文词数 | 36 / 83 / 81 / 93 / 59 / 110 / 81 / 66 / 57 / 70 |
| 中文字符 | 8 / 0 / 7 / 4 / 5 / 12 / 5 / 5 / 6 / 4 |
| 页边距 / 纵向填充 | 48 px（1280 宽的 3.75%）；内容底边 612–672 → 填充 78–87% |

换行规则（105 个文本块，表格单元格不计）：

- H2 标题从不折行；封面标题只在显式硬换行处断行。
- 41 个块折行，**没有一个超过 3 行**；正文通常 1–2 行。18 pt 正文每行字符数约等于宽度 px ÷ 13.3（约 0.55 em 一个拉丁字符）：473 px 栏宽约 37 字符/行，742 px 栏宽约 51 字符/行。
- 没有孤字控制：5/41 个折行块最后一行不到 15% 宽度，其中 2 个是行内数学造成的。
- 中文只以短标签（4–13 字）出现，不存在中英两段同时占位的情况。

fit 状态：10 张卡全部是 `data-overflow-mode="reveal"`、`--content-fit-scale: 1`，没有一页缩小字号。第 2、3、9 页（重复项网格和编号步骤）带 `data-layout-fit-active="true"`、`--layout-fit-scale: 0`，其他页为 1。推断（未验证）：密集网格先做版式层面的 fit（间距/排列），而不是缩字。

### 27.8 生成后的编辑器入口

- **工具栏**：Edit | Agent | Undo/Redo | Add block | Layouts ▾ | 文本样式 ▾ | 字体 ▾ | 字号 −/52/+（单位 pt）| More formatting | Comment。首次进入有 4 步引导：工具栏 → Add block（“…and the layout adjusts around them”）→ Styles → Share/Export/Present。
- **Layouts ▾**：5 个 Standard layouts（无强调、顶部色带、左图、右图、背景图），以及 “Suggested layouts”：约 2–4 s 的 “Finding layouts that fit” 之后给出 5 张缩略图，是**同一张卡的同一内容按不同排列渲染的结果**，另有 “Show more layouts”。这就是“换版式不改文字”的入口。
- **卡片 rail**：Edit with Agent、Add speaker notes、卡片之间的 Insert slide、Freeform。
- **··· 菜单**：Settings、Version history、Logo/colors/fonts、Page setup、Export、Comments、Analytics、Publish to site、Duplicate、Create from this (Remix)、Save new template 等。
- **Page setup**：Default 16:9 / Flexible / Tall 4:3 / Custom；Content alignment 顶部；Minimum text size 18 pt；Scale content to fit 开；Show overflow guides 开；Animations 关（三个 tooltip 原文见第 19.1 节的修正）。
- **聊天**：完成后出现满意度评价（It's bad / It's okay / It's great），本轮未作答；composer 有 Add or connect、Select area、Dictate。

### 27.9 对第 16–21 节结论的修正清单

| 原结论 | 修正后 | 依据 |
|---|---|---|
| Use template 后进入 Agent chat → **Setup form** → Plan | Setup form 是条件性的；也可能不出现，由 Agent 直接规划，并通过 My calls to check 公开假设 | 27.2 |
| 正文 22.667 px、H2 37.333 px 等字号 | 这些是 Compiler 模板的值；Sample Size 的正文为 18 pt（24 px），H2 36 pt（48 px）；字号层级由模板决定 | 27.7 |
| “不能直接把 px 当 pt” | 屏幕像素不能当 pt；在 1280×720 逻辑画布上，逻辑 px × 0.75 = pt，工具栏字号可以印证 | 19.1 修正 |
| Minimum text size 17 pt 的作用范围未验证 | 它是 scale-to-fit 缩字的下限（tooltip 原文），不是各角色字号的下限；本稿没有任何缩字 | 19.1 修正、27.7 |
| slide surface 770×433 | 这是显示尺寸；GML 卡片是固定 1280×720 逻辑画布，显示时用 zoom 缩放 | 18 补充 |
| 双语选项输出英中两段 | 那是 Compiler 次表单选择的结果；没有表单时，平行翻译被当成一份内容，中文只作术语标签 | 27.3 |
| 代码完整保留（Compiler） | 代码策略随模板/用途变化：代码模板完整保留，数据课程模板全部省略并公开说明 | 27.3 |
| 首次完成有失败页 | 本次 10/10 通过；“首次可能带告警交付”仍然成立，但不是必然 | 27.5 |

### 27.10 double check 与边界

| 核验项 | 结果 | 边界 |
|---|---|---|
| 输入完整性 | 浏览器内对提交文本做 SHA-256，与源文件一致 | 附件化后 Gamma 内部是否截断不可见；从覆盖结果看，§15 末尾的内容都已使用 |
| 计划与成稿 | 24 页与 10 页 Plan 均从 DOM 文本存档；成稿 10 页结构逐页读取 | 10 页是人为条件 |
| 字号/换行/填充 | 计算样式和 Range rects 实测；cardId 去重（避免 overview/focus 重复计数） | 不是 Office 实际渲染；未导出 |
| 数字与事实 | 第 4、6、10 页的数字逐一回到源文 | 只抽查了数字密集页，其余页做了章节级核对 |
| 图片 | 3 张均来自 `generated-images/` CDN 路径，`alt` 为空 | 生成时机与 prompt 不可见 |
| 模块估算 | 在当前未提交的工作树上离线运行，脚本已存档 | codex 仍在修改这些文件，数值会随代码变化 |
| 未验证 | Express/Research/Lite/Max、24 页实际生成、Edit with Agent 与 Suggested layout 的实际应用、导出文件 | 不补写成“已验证” |

## 28. 实施方案（基于第二次实测）

原则同第 22 节：**保持已确认的流程**（新建 → 选 LLM → 选模板 → 输入 → 页数估算 → syllabus 确认 → 生成 → 编辑 → 导出），不新增强制设置页，不复制 Gamma 的账户限制或计费，不写模板名或教程名分支。下列改动多数位于 codex 当前尚未提交的文件中，开工前应先与该批改动合并，并按 CLAUDE.md 在 `docs/exec-plans/active/` 写执行计划。

### 28.1 P0-1：估算不能因单个表格崩溃

- **文件**：`ppt-content-inventory.mjs`（`markdownRows`）、`ppt-density-capacity.mjs`（`measureComponent`）、`ppt-planning.mjs`（`estimatePageRecommendation`）、`ppt-source.mjs`（paste/Markdown 表格路径）。
- **改动**：拆单元格时把 `$…$`、`\(…\)`、反引号内的 `|` 视为普通字符。行宽不一致时做规范化（补空格或合并溢出的格），并在条目上记录 `tableGeometryWarning`。估算阶段**只能降级，不能 throw**；严格校验留在最终导出门禁，并在那里给出具体位置。
- **验收**：新增自测，表头为 `| $|x|$ | b |`、带转义 `\|`、行宽不一致三种情况；09 原文件的估算正常返回，且该表仍是 3 列。

### 28.2 P0-2：双语平行文本按同一份内容计成本

> **2026-10-08 用户决策（取代本小节的默认值建议）**：输出语言与输入语言保持一致。平行双语输入保留两种语言；配对共享 claim（不算重复、不算新增内容），两种语言分别计版面占用。`primary_with_key_terms` 不作为默认，也不作为自动选项。非代码模板中的讲解性代码不上页，并在规划假设中说明；映射模式也必须保留模板媒体。执行计划见 [`docs/exec-plans/active/ppt-general-content-media-balance.md`](../exec-plans/active/ppt-general-content-media-balance.md)，下文保留作为调研记录。

- **文件**：`ppt-density-packing.mjs`（目前 “Both languages retain display cost”）、`ppt-content-inventory.mjs`（新增 `languagePairId`）、`ppt-generation-policy.mjs`、`ppt-prompt-contracts.mjs`（第 58–60 行的 language_mode）。
- **策略字段** `languagePresentation`：
  - `primary_with_key_terms`：输入是段落级平行翻译、且用户没有要求双语展示时的默认值；
  - `bilingual_full`：用户明确要求，或模板本身是双语排版；
  - `follow_input`：非平行的混合语言。
- **识别平行段**：相邻、文字系统交替；数字、变量、专名能对齐；长度比在合理范围内。识别结果只是候选，置信度低时按 `follow_input` 处理。
- **成本**：默认模式下，主语言全额计算，次语言只计一个标签预算（每页约 4–16 个 CJK 字符）；`bilingual_full` 两种语言都全额计算。Writer 新增“术语标签”角色（13–14 pt，放在标题下）；它和译文都不算新事实。
- **验收**：09 输入在默认模式下，只这一项就让估算下降约 7 页（46→39，与 27.4 的反事实一致）；`bilingual_full` 的结果与当前一致，并在说明中写明原因。

### 28.3 P0-3：代码和 ASCII 图的展示策略

- **字段** `codePresentation`：`full` / `excerpt` / `omit_with_disclosure`。
  - 用户意图提到代码、所选模板有代码组件、或代码本身就是讲解对象时，默认 `full` 或 `excerpt`；
  - 讲解性代码配非代码模板时，默认 `omit_with_disclosure`，公式和阈值保留。
  - 依据：Gamma 两次运行的行为不同，Compiler 完整保留代码，Sample Size 全部省略。
- **ASCII 框图**：代码块里出现 `┌│└▼→` 这类字符、且没有程序语法时，判定为 diagram，转成 `ProcessBlock`，用原生编号网格或步骤呈现，不再按 CodeBlock 计成本。
- **文件**：`ppt-source.mjs`、`ppt-semantic.mjs`（fence 分类）、`ppt-content-inventory.mjs`（`role()`）、`ppt-density-packing.mjs`（只有保留的代码才计成本）、`ppt-object-integrity.mjs` / `ppt-obligations.mjs`（按策略省略不算违规，但必须出现在假设清单里，并可一键改回）。
- **验收**：09 输入的 §1 估算从 5.59 页降到约 1–2 页；13 个代码块在 `omit_with_disclosure` 下不计成本；切换到 `full` 时重新估算，且代码逐字保留（沿用第 26.2 节的门禁）。

### 28.4 P0-4：规划假设清单（对应 My calls to check）

- Planner 输出 `assumptions[]`，每项为 `{topic: language|code|imagery|merge|omission|pageBudget, decision, reason, affectedSourceIds, reversible}`。
- 在现有 syllabus 确认步骤中显示，不新增强制页面。用户修改某一项后，只重算受影响的分组和页数（复用 `pageDecision` 的 estimate/explicit 区分）。
- 合并、压缩造成的密度风险也写进清单，例如“第 3、7 页较密”。
- **文件**：`ppt-planning.mjs`（`normalizeBrief` / `buildPlanning`）、planner prompt schema、syllabus UI 组件。

### 28.5 P1-1：页数分配改为“每个独立问题约 1 页，大章封顶”

- 当前 `sourceDensityPlan` 把各组的投影成本相加，再除以每页容量，结果与源文字节数成比例（§2 13.98 页、§10 0.37 页）。
- 改为两层：
  1. 先识别独立的读者问题（顶层章节，或含独立决策的子节），每个问题保底约 1 页；很短且相关的问题相邻合并。
  2. 每个问题再按“优先级梯度”（第 28.6 节）在封顶范围内装填：默认约 2–3 页，detailed 可放宽。
- Part 分隔页是可选项，只在至少 3 个 Part 且不少于约 16 页时提出，且不计入内容页。
- **验收**：在 28.2、28.3 的默认策略下，09 输入的估算落在 20–28 页（Gamma 为 24），每个章节都有归属；Alpha Mining、Factor Zoo、Tutorial 11 也给出可解释的结果，不为单个样本调参。

### 28.6 P1-2：压缩优先级梯度与限定语检查

- **Writer/Planner 契约**（prompt contract 升到 v9，rubric 同步）按以下顺序保留，删减从最低优先级开始：
  1. 有序流程、决策规则、带单位的数字/阈值、定义被报告统计量的公式、可枚举条目；
  2. 附着在保留数字上的条件和限定语；
  3. 每条规则一句机制说明；
  4. 动机、替代方案比较、错误示例；
  5. 译文和讲解性代码（按 28.2、28.3 的策略处理）。
- 正文里出现 ≥3 组 label/value 的数值例子时，转成原生表格（Gamma 第 6、8 页的做法）。
- **确定性限定语检查**：对每个保留下来的数字，比对源文同一句里的限定词表（one-way、annualized、monthly、long-only、gross/net、in-sample 等）；可见文本中缺失时，给 writer repair 发 warning。
- **文件**：`ppt-prompt-contracts.mjs`、`ppt-content-depth.mjs`、`ppt-visible-content.mjs` 或 `ppt-evidence.mjs`。

### 28.7 P1-3：版式词汇和 fit 顺序

- **新增候选**：`fitComponents` 目前只试 1 栏或 2 个等宽栏，需要增加：
  - 不等宽双面板（约 58/38、55/42）；
  - 图文分栏（图片占 30–37%）；
  - collection grid（4×2 编号卡、2×4 单句卡）；
  - 纵向编号步骤；
  - 公式侧栏；
  - 面板底部结论句。
- **layout registry**：在 `ppt-layout.mjs` 中加入 `collection-grid`、`numbered-steps`、`two-panel`、`image-split`，带各自的角色字号与最少条目数。preview、PPTX、render audit 都从同一个 Render Tree 读取（沿用第 26.1 节的契约）。
- **fit 顺序**：版式 fit（排列、间距）→ 有界 polish 删减（第 28.9 节）→ 拆页提议 → 最后才缩字。缩字下限 `minShrinkPt` 与角色字号分成两个字段（对应 Gamma Page setup 的语义）。
- **行高**：容量估算用的正文行高是 1.18，Gamma 正文为 1.35、标题为 1.05。正文行高偏紧会让纵向容量高估约 14%，应改为读取模板的实际行距。
- **文件**：`ppt-density-capacity.mjs`、`ppt-layout.mjs`、`ppt/point-layout.mjs`、`ppt/render-tree.mjs`、`ppt/render-contract.mjs`。

### 28.8 P1-4：密度与换行 profile（多个具名样本，不设统一硬阈值）

- `GAMMA_DENSITY_PROFILE` 目前只有一份 8 页样本（674 units）。改为多个具名样本，按模板类型和用途选择：
  - `deal-review-8`；
  - `compiler-10`；
  - `sample-size-lesson-10`。
- Sample Size 样本的观测值：
  - 标题单行，36 pt 时不超过约 40 个拉丁字符；
  - 正文 18 pt；单块不超过 3 行，通常 1–2 行；
  - 每个面板 3–5 条；每页 60–110 个英文词；
  - 页边距 3.75%，纵向填充 78–87%；
  - 次要正文 15.5 pt，标签 13–14 pt。
- **标题门禁**：H2 在测得的宽度内放不下一行时，改写标题而不是缩字。正文块超过 3 行时，优先拆成 bullet 或转成表格。
- 这些都是 profile 中的目标区间，由 render audit 和 QA 报告偏离；只有越框、丢失等可见问题才是 hard failure。

### 28.9 P1-5：生成后有界 polish

- 版式测量之后、导出之前，对“填充超过目标上限”或“最后一行是孤字”的页做一次有界删减（约 1–5%）。
- 不删除优先级 1、2 的内容；删减后重新测量，并记录前后差异（复用第 22.4 节的 diff 字段）。
- Gamma 本次的 polish 删减了 1–4% 的字符。

### 28.10 P2：生成过程与编辑器

- 生成时先显示带计划标题的 overview 网格，各页状态（writing / checking / polishing / ready / blocked）独立推进，接在已有的 `run-service` 事件上（第 22.5 节）。
- 编辑器加 “Suggested layouts”：用 28.7 的候选做确定性重排，生成同一内容的 3–5 种排列，不调用 LLM 改写。
- Page setup 中把“角色字号”“缩字下限”“溢出参考线”分开展示。

### 28.11 顺序、验收与回归

| 批次 | 内容 | 验收 |
|---|---|---|
| 1 | 28.1 | 09 原文件估算不再抛异常；数学竖线表格自测通过 |
| 2 | 28.2 + 28.3 + 28.4 | 默认策略下 09 估算约 24；改为双语或完整代码时估算上升且有说明；假设清单出现在 syllabus 步骤 |
| 3 | 28.5 + 28.6 | 4 份教程 fixture 每章都有归属；枚举项完整；限定语检查生效；没有编造数字 |
| 4 | 28.7 + 28.8 + 28.9 | 新版式在 preview、PPTX、PDF 中一致；标题单行；没有超过 3 行的正文块；正常情况下不缩字 |
| 5 | 28.10 | 进度和 Suggested layouts 在真实 Chromium 中验证（按 CLAUDE.md 用 CDP 截图） |

回归 fixture：`09_factor_testing.md`（本节 hash）、Alpha Mining、Factor Zoo、Tutorial 11 backtesting，均保留 Gamma 成稿文本作为对照。真实 LLM 的盲评按第 26.5 节的要求单独进行：比较独立事实数、条件/机制覆盖、枚举完整性、限定语、重复率与可读性，不比较字数。
