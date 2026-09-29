# PPT 模板复用差异与职场报告质量

## 目标和边界

沿用现有 Cowork `source → outline → content/media → layout/preview → review/repair → publish` DAG、IR v3、共享 Render Tree、原生 PPTX 出口和用户确认的页数。LLM 只规划语义和填模板文本；媒体与坐标变体由确定性程序生成。`report readiness` 是内容评审状态，不等于文件能否正常导出。

## 1. 模板复用必须发生视觉变化

- 模板页第一次出现保持原形状、图片与顺序；封面和结尾仍只用一次。每次复用内容页时，对同页所有原生对象做水平布局镜像，并轮换已有的图片裁切预设。这样没有大图的页面也能获得确定性布局变体。
- 如果用户提供了粘贴图片，且复用页存在占画布至少 15% 的原生图片位置，可在该原生 picture 形状内替换媒体。替换媒体需至少 640×360、与目标图片框纵横比接近；多张粘贴图片还须由 caption 与页面主题对应，不能随机插入不相关素材。替换保留图片对象、其他组件和可编辑文字，并记录来源 ID、目标 shape ID、新图片 SHA-256；没有合适大图则只调整布局。
- 变体 ID、来源页索引、变体种类与媒体校验值进入持久化 `templateFidelity`。`inspectTemplateFidelity` 对每张复用页检查相对原版确实改变了布局或图片，未改变即为硬错误。原生导出再次校验形状数和未替换图片的原始 SHA-256；声明替换的形状校验新 SHA-256。
- `reusePlan.visualSimilarityPairs` 基于实际变体页重新计算，不再仅计算模板原页。页数调度继续避免相邻同源、抑制 ABAB 重复和控制复杂页复用。

水平镜像是当前安全的对象级几何变体，原生图解的组件关系、背景和字体不会被 LLM 修改。带方向语义的复杂流程图仍需人工检查镜像是否适合；图片裁切或水平镜像也不能把原本信息贫乏的模板变成 100 张独立视觉稿。

## 2. 职场报告写作与评审

- `Presentation Brief` 增加 `reportMode`（普通演示、信息汇报、决策汇报）、`decisionQuestion` 和 `sourceScope`。大纲节点提示模型在前几页交代摘要或待决策问题，尽早给出主流程/核心证据，结尾安排来源支持的条件性建议；页数仍由用户决定。大纲若有摘要、流程、建议位置或重复主张问题，在**同一个 outline 节点**内最多请求一次完整修订，仅当问题数下降且报告模式未降级时采用。用户手工提交的大纲不自动改写。
- 现有逐页内容节点收到该 Brief，按 summary、process/architecture、evidence、recommendation/decision、appendix 角色写内容；要点须有简洁解释，区分来源事实与未验证项，不能用同义改写扩充页数。原有槽位容量和模板字体约束继续生效。
- 现有确定性质量门禁新增 `report readiness`：检查摘要位置、来源量与页数的比例、主流程位置、决策问题与建议、重复主张、事实来源、高优先级主题覆盖、模板正文小字号。结果随质量报告持久化，在 PPT 项目详情显示三语本地化的“可用/需要内容复核”。警告不会误当作 PPTX 文件损坏，也不会默默宣称报告已达到提交标准。
- 整稿模型评审仍限于缺失、重复、冲突、证据不足；不得修改坐标。来源不足时显示局限，而不是生成未经证实的案例、数据或结论。

## 验证

- `node apps/cowork-server/selftest-ppt-template-scheduler.mjs`：10→15/20/100 页调度、每次复用的真实几何变化、原生对象与图片校验、粘贴图片的原生替换。
- `node apps/cowork-server/selftest-ppt-template-fidelity.mjs`：原生模板保真与文本槽位。
- `node apps/cowork-server/selftest-ppt-report-qa.mjs`：不合格和合格大纲/报告、Prompt 传递、导出状态与内容评审状态分离。
- 既有 PPT semantic、M2、M3、M5、structured 自检、报告面板的简中/英语/繁中本地化单测及 `npm run typecheck` 通过。
- 使用单页 MCP PDF、Gamma-AI.pptx、20 页硬参数和模拟 LLM，真实运行 Cowork 流程得到 `outputs/mcp-full-chain-gamma-template-20-slides-simulated-variant-report-v3.pptx`，执行记录为同名 `-workflow.json`。大纲模型模拟调用两次（初稿加一次修订）；模拟器返回同样的弱大纲，因此生产逻辑保留初稿并在最终报告中明确警告。PowerPoint 原生对象核验：20 页中 10 页原版、10 页复用变体；每页形状数量不变，未替换图片的 SHA-256 不变，所有复用页几何有变。LibreOffice 将 `v3` 成功渲染为 20 页 PDF，前一版 `v2` 也经过逐页视觉检查。`v3` 质量状态 `passed_with_warnings`，报告状态 `needs_review`：一页来源约 1,939 字和 3 个语义单元支撑 20 页存在内容重复风险，且模拟大纲缺少足够靠前的摘要/主流程、结尾建议；模板正文有小字号。这是刻意保留的内容风险提示，不能称为已经达到职场决策报告标准。
