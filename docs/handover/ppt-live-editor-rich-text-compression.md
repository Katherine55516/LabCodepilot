# PPT实时编辑、符号保真与固定页数取舍

2026-10-10，隔离工作树实施。与既有PPT交接同时阅读。

- AppShell挂载PptBackgroundTasks；全局worker离开PPT路由仍claim，server lease/uid权威。Home使用project summary，failed可原地重试。应用退出并非云端执行；20秒client heartbeat后waiting_client，有界租约与等待。
- `ppt/project-view.mjs`精简SSE live projection，认证asset refs、按页runtime.preview/hash；缓存renderContractVersion=3。生成中StructuredPptEditor只允许有效页对象编辑；pending409；revision/epoch挡晚到writer。
- `ppt-rich-text.mjs`是sourceDisplayText/ensureRichContent共同入口，MarkdownIt保raw/source与typed runs。MathML/OMML+fallback不同引擎，未知宏/分隔符不完整必须报错，不能将source_text_fallback当pass。
- native正文保每段原fontsize/spacing和label/body混合run。重写paragraph移除pPr以外所有XML子节点（Paragraph.clear漏MC）；多行table frame只写一次。nativeMath未改时保原OMML；编辑后统一新rich语义。
- Cover必须先applyLayoutRegistry再ensureDeckV3，避免缺layoutId被默认summary。geometry保存仅实际改变才发POST；doubleclick textarea停止pointer冒泡。
- `ppt-content-selection.mjs`保存不可变来源/hash与slides/notes/summary取舍账本。notes需显式details=notes；完整表和摘要表独立合同；关系不跨主稿/notes误切。fixed N覆盖所有页，冲突具体报告，不缩字/暗增页。
- skeleton v2仅短可读claim/sourceIDs，执行合同代码编译；完整关系分组checkpoint绑定完整prompt/model/config，局部delta。`ppt-review-batches.mjs`20页以上分8页完整局部+全局交叉关系，成功结果复用，不接受partial审查。
- `ppt-postwriter-plan.mjs`基于实际writer对象/font/fit/hash及空节点；合并候选只供复核，confirmed exact-N不静默变化。自动跨页语义合并产品闭环和通用span级writer自动修复仍未完成。
- DeepSeek专用source/outline/review:deck结构化请求thinking disabled；writer维持默认。不向其他模型套DeepSeek参数。schema只有明确不支持的400允许一次JSON降级；截断JSON不得补括号接受。
- `ppt-source-arithmetic.mjs`只检明确整数乘积与named count，原文冲突不自改。Factor Zoo真实两语2×3×3/27冲突是当前完整稿批准阻挡。

证据及38-ID状态：outputs/ppt-remediation-round2-20261010/verification-report.md。全量2840pass/1skip、smoke42含PPT25、capacity52、actualnative/font/math/cells/notes正反例；真实录制与复核以报告收尾为准。没有Microsoft PowerPoint应用实测、ARM64外部账务通过或GPT网关长请求成功证据。

收尾补充：cover source canvas按真实body区域绑定；editorial eyebrow .24in保11pt；PptCanvas隔离z-index避免高层对象盖住export dialog；publish editor的有效review时间与当前revision同步DAG，mutation13项测试。真实4/8页发布、原速录像/trace、限制见复核报告。


## 2026-10-10 Alpha Mining 真实模板补充

当前 prompt 合同20、rich/display AST4、template parser6。本轮真实输入为10_alpha_mining.md、原生Deal Review模板、DeepSeek；完整双语来源64对象/28对。自动估算/解析建议/实际模板容量校准分开记账，确认之后冻结N，不能用角色调度覆盖容量调度。完整sourceCatalog连同媒体交给store按hash去重，不能提前删除暂未被映射的页的dataUrl。N大于等于模板页数时必须覆盖每一张原始模板页；容量优化后补覆盖，选择可用重复版式且不改变accepted页；已有源字号下限进入重新测量。

full_source+source语言明确冻结两种原文与代码；overview/course/输出语言拥有另一取舍合同。无正文槽位的封面不得持有必保留完整段落。source-region仅对已验证纯色卡或有角色、hash与真实重叠几何的模板装饰/艺术图进行退役，保护品牌、来源、图表、未知和正文外资产。模型omit理由不是删除授权；重试可重新计算旧disposition，但保留文字、几何和字体hash。Home quality_blocked与failed均可发起同项目新run审查，旧批次与失败结果保留。

CJK强/斜体扩展由typed parser实现，跳过代码和数学跨度；嵌套`**中文*不同***`须先闭合内层，再闭合外层，AST4仅从未改变的原始source迁移；实际编辑使用当前新文本。规则是产品扩展而非CommonMark标准保证。数学fallback字号直接按DrawingML百分之一pt写XML，避免python-pptx的EMU中间截断（14.5×0.65期望9.43pt），校验仍严格核对OMML树、fallback文字/基线/字号/样式。故意改变字号等负例必须被拒绝。

Writer局部错误使用唯一Delta JSON Schema，限定既有路径/原值hash/字符范围，保护数字与变量，越界/整页响应不扩权。native section修复schema不能给模型旧超长内容作为唯一返回示例。制作说明进入报告，正文制作元信息门禁对真实来源不误报。

实时跟随以render_ready+updatedAt选稳定slideId，画布article真正滚动，重复同页快照不抢手工滚动；Home返回从快照恢复，手工浏览状态记忆。UI测试卡片限定article，不能仅按任务名误点全局重试；常驻任务轮询存在时以DOMContentLoaded+可见main验证页面可用，不等待networkidle。

详细逐项证据与实际运行边界见outputs/ppt-alpha-mining-live-20261010/report.md。自动跨页语义重写/合并产品闭环、原Factor Zoo/Gamma大稿A/B、PowerPoint应用与真实双设备/各模型长请求尚非本次已通过项，不能把代表回归写成全场景无误。

局部分页修复必须与nativeCapacityAssignment一致：有可用真实版式即可成为候选，不能因窄尾页不适合而拒绝或强迫过度拆分；分配之后仍严格逐页测量，不能把some当作最终通过。旧的全版式portable合同仍要求every。真实故障分组在保留64对象/全部8模板页的情况下，由20页1溢出修复为21页0问题；该重放仅为代码证明，不作为替代LLM运行结果。
