# PPT 体验与质量路由：技术交接

> 产品思考见 [docs/insights/ppt-experience-quality-routing.md](../insights/ppt-experience-quality-routing.md)
> 执行计划：[2026-10-14 计划](../exec-plans/active/ppt-experience-quality-routing-20261014.md)
> 状态：实施及验收进行中，不能作为全部通过或可提交的证明。

## 实现入口

- `src/components/ppt/PptWorkspace.tsx`：独立资源加载/重试、隐藏选中项、批量部分失败、工作区标题、质量策略与创建协议预检。
- `PptM3.tsx`、`create/TemplateBrowser.tsx`：真实模板预览、直接使用、兼容说明与重新解析。
- `create/PptCreateWizard.tsx`、`TemplateFixedObjects.tsx`：固定底部动作、单一读取动作、混合图片去重、来源资产清单、固定对象选择。模板固定对象改变须重新确认计划。
- `editor/StructuredPptEditor.tsx`、`PptTextToolbar.tsx`：暂停保留当前草稿、已完成页编辑、混合格式与只读原因、标题/正文选择、页面栏收起和宽度调节、原生页转组件副本入口。
- `generation/GenerationEditDialog.tsx`：单一消息滚动、固定输入、Enter 换行/Ctrl 或 Cmd+Enter 发送、原始请求/已提交历史读取、新消息提示。
- `create/PptQualitySettings.tsx`、`editor/PptExecutionPanel.tsx`：三档质量、角色池、高级视觉选择、输入/输出 token 上限、实际执行记录、仅修改后续策略。

## 路由及数据流

`generationPolicy` 管内容、语言、来源；`executionPolicy` 管资源投入。创建界面先绑定配置中的模型引用，再由后台 `ppt-execution-policy.mjs` 归一化、按逻辑任务预留预算；`ppt-task-complexity.mjs` 决定难度和角色。原生产 `modelCall` 作为统一入口，继续使用已有模型队列、服务商适配器和来源/质量/导出验证。

`src/lib/ppt-model-catalog.ts` 读取已有服务商模型的 `capabilities`。`capabilities.ppt` 可包含角色评测、评测版本/时间、协议、健康、质量分及延迟；仅明确有评测的模型进入自动评估池。未知模型使用账号配置的兼容默认值并显示未评测说明。不得用名称或价格猜测能力。视觉池要求 `vision=true`；推理控制仅在显式 `thinkingControl=true` 时发送。没有价格证据时费用为未知。

角色包括来源整理、规划、简单/标准/复杂写作、视觉、审查。规划及审查可快选基础模型，复杂任务使用同角色的 `complexPrimary`。单模型可兼任不同角色，界面如实说明。旧项目没有策略时保留 `legacy_single_model`。

执行记录保留任务/尝试、run、版本、来源与附件 hash、冻结合同摘要、真实模型、理由、usage、耗时、状态和输出 hash。最大尝试次数包含 SDK schema 降级与传输重试。缺失 usage 保留预算，不当作零。鉴权/模型不存在会熔断对应路由；显式策略更新后才可重新试。进程重启后的未交付请求标为结果未知并暂停，不直接重放。

## 图片、模板及副本

输入图片保留原始资产与映射。可选 `ppt-source-vision.mjs` 仅提供不确定性标记的关系描述，不把模型描述当数字事实；原图不被替换。BYOK 使用 SDK 多模态消息，托管路径使用经过有界校验的 stream-json 图像消息。托管帧测试属于协议覆盖，尚需实际托管环境验证。

`templateFixedObjectIds` 保存明确选择的对象。默认沿用设计；固定模式也清理未选择的旧报告内容。只有用户勾选的固定对象保留；未选的模板位图（含背景）清理，字体、配色、矢量装饰继续沿用。这样无需猜测背景像素中的旧文字。原模板与解析缓存不被改写。固定对象失效时报错，不悄悄忽略。背景图片中的文字仍必须结合实际模板做视觉验收。

`ppt-component-copy.mjs` 将支持的原生内容转为组件副本，保留文字、表/图、图片及备注。不支持的外部对象阻止转换。副本以待审阅状态打开，不能继承原文件的发布/质量通过结果；整体排版与样式可能变化，发布仍执行原门禁。

## 新增接口

所有项目和模板接口复用现有账号归属校验，不传服务商密钥。

| 接口 | 用途 |
|---|---|
| GET `/ppt/projects/:id/execution` | 策略与运行记录 |
| PATCH `/ppt/projects/:id/execution-policy` | 基于 revision 更新后续任务策略，活跃生成须先暂停 |
| GET `/ppt/projects/:id/conversation` | 原始请求与已提交的修改历史 |
| GET `/ppt/projects/:id/source-assets?assetId=...` | 账号内来源图片，仅 PNG/JPEG/WebP |
| POST `/ppt/projects/:id/component-copy` | 显式新建组件副本，保留原文件 |
| GET `/ppt/templates/:id?view=objects` | 固定对象选择清单 |
| PATCH `/ppt/templates/:id`，`reparse:true` | 重新解析上传模板 |

`ppt-model-jobs` capabilities 新增 `executionPolicyVersion=1`、`multimodalVersion=1`；客户端创建前检查，防止旧后台静默忽略新策略。协议 v1 原有调用仍兼容。

## 验收与运行纪律

证据根目录为 `outputs/ppt-experience-quality-20261014/`，忽略入库。`.codepilot/quality-routing-baseline/` 保存起点 tracked patch、未跟踪文件 hash 和测试启动器。起点包含未提交的 Round 7 内容，不将它当作本轮独立改动。

生产队列桥、真实 SDK 线路、本地协议帧、自检与真实在线模型分别记录。`scripts/ppt/manual-test-service.mjs` 支持仅 API 验收，生产模型队列由原桌面 SDK worker 消费；主账号凭证只读后写入独立加密测试配置。`scripts/ppt/benchmark-quality-routing.mjs` 固定 12 个来源、4 档运行与 hash，旧报告样本必须指定实际上传模板；缺模板会记失败，不能偷换为系统模板。

执行结果以计划附录和当前日志为准。尚未完成全部视口、真实导出逐页检查及完整同源多档基准。当前实际模型试跑出现过页面超时、两行标题高度不足及结束语覆盖业务主题，不得计为成功。已新增标题空白区扩框和独立/页脚结束语修复，正在重跑；原始失败记录保留。普通前端编译和验证实例资源竞争也保留失败记录；不能用未加载完成的页面声称 UI 已通过。

继续执行记录：`ui-current2.log` 的 8 项生产组件 UI 检查已通过并保留 CDP 截图，`npm-test-current.log` 为 2908 通过/1 跳过。当前源快照与后端 hash 分开记录，不混用旧实例。原生模板固定模式的未选旧图表/旧备注泄漏已在实际 PPTX 中验证修复；图片输入 6 格式到实际 PPTX 的原图 hash 验证通过。

新的真实 PDF 逐页复核仍发现完整来源短稿过薄。`ppt-outline-condense.mjs` 现在允许自动、未确认的 full_source 稀疏邻页合并，保留所有来源单位与选择合同，仍调用完整的大纲评估器；显式页数、确认后计划、更新/导入稿与人工锁定不改动。`selftest-ppt-full-source-merging.mjs` 覆盖这些边界。此逻辑不复用 overview 的删减规则。业务证据额外支持 hours/minutes/days/weeks，内容门禁采用大纲的精确 chunk 归属，相关正负断言在 `selftest-ppt-evidence-quality.mjs`。

自动结束页使用紧凑封面式问答邀请，显式页数的实体总结页保留主题与正文，在原生可导出节点添加结束语。库存未评估模型仍作为配置兼容回退，实际两模型试跑不自动升级为推荐目录。托管环境只有协议验证；完整多策略/多次真实基准仍未完成，不应提交“全部验收完成”的结论。

最新验收记录：77 项领域回归已通过一次；最新 `npm test` 为 2909 通过/1 跳过；54 项 PPT UI/烟测已分批通过，包含账号切换、模型目录恢复、协议拒绝与恢复、原生公式/图表/裁剪及手工编辑。开发服务器内存重启造成的中断另行保留，不宣称一次全批通过。[代表性截图](assets/ppt-experience-quality-routing/README.md)区分生产组件夹具和真实 PDF。

`ppt-task-complexity.mjs` 的全局角色只依据实际来源判断难度，避免把协议示例当成复杂源材料。`ppt-quality.mjs` 通过 `application_framing` 标明程序结束页上精确的固定礼貌文字，防止审查器因其不是原文事实而无意义重写；其他文字、图片、数字仍接受审查，没有过滤或丢弃审查发现。后端 `5b2bea9c…` 的真实双模型矩阵正在执行。基准脚本支持额外原始长稿、预期来源矛盾负例和样本间停止标志，出现未通过或运行缺项时以非零状态退出。


## 最新续做：双语与章节数字

完整来源绑定页只请求元信息与冻结选择；`bound_source_body` 在长提示裁剪后保留，`boundWriterResponseSchema` 强制内容/媒体空数组，JSON-only 回退仍执行原服务端校验。普通段落数量不是复杂推理的独立触发；结构化公式/代码等仍走强角色。合并页采用已核实来源主题，标题中的原文章节序号需精确匹配才作为导航；其他数字不豁免。

最新 `npm test` 2913 通过、1 跳过；真实双语矩阵仍有修复后待重跑项。完整状态与失败日志见计划 §11.3，不得将 54 项夹具 UI 或短业务稿通过当成真实长稿/旧模板验收。当前本机测试字体依赖采用隔离 Noto SC fontconfig 对齐生产镜像，原始回退字体的字形问题及对照记录保留；没有改变宿主字体或提交字体文件。


原生导入补充：`ppt-native-shape-ids.mjs` 对无歧义引用的重复 cNvPr ID 建立稳定工作映射，持久化在 externalPptx/templateFidelity.nativeIdNormalization；原 PPTX 字节不变。导出以相同算法重建并精确核对，动画/连接线引用重复 ID 拒绝猜测。模板缓存版本为 pptx-ir-8。真实 Gamma 模板包含重复 ID，旧缓存需重读。实际封面无来源时省略旧正文，纯致谢不继承正文点数目标；原生标题复用原字体和原框的测量合同，不能只用粗字符容量判断。来源页跨章节合并时导航用共同父章节，避免 Scope 标签误罩住 Decision 内容。

实际 UI 组合验收记录见计划 §11.4：同一项目真实暂停、Arial 32pt 修改、恢复、导出，最终 PPTX 样式已重开核对。包含一次客户端连接重置和恢复，不宣称一次连续通过；PowerPoint 桌面应用未打开。来源图片的位置/格式标签属于诊断元数据，不能自动显示为图注；作者 alt/title/desc 保留。


`PPTX_IR_VERSION` 由 ppt-native-shape-ids.mjs 统一导出，store、API、fidelity、template-preview-service 和离线 register-ppt-template 使用同一版本，避免写新缓存却读不到。仅改 API 的版本字符串会造成真实缓存退化，已由 registry/quality-routing 回归覆盖。自动 full_source/source_only 原生封面在确认前迁移全部正文归属，模板存在旧正文槽不代表适合新正文。已确认/用户指定分配不修改。英文 before/after 单独出现是时间条件，不作为 comparison 类型；审查必须区分内部 sourceArtifact 分类与实际可见声明，真实改变条件的发现仍阻塞。


原生发布续修：显式 design_only/keep_fixed 模板复用允许原模板页子集；普通导入仍保留全页保护，所选页完整性照旧。renderImportedPptx 对 deck 做副本准备，主生成发布向 renderer 传独立候选，避免渲染失败导致 review key 漂移并一直停 publish。实际 10→3 旧模板两个输入已通过完整流水线（4ff72eee）；后续胶囊/网格线修复在 dbbc969f 构建复验。固定对象来自未使用页时现有导出明确拦截，确认前分配仍待补足。最新 79 个领域用例含 source-diagram-fit，已证明大 ASCII 图的完整层级可按行分页为可编辑表格，但代码/流程的通用行范围尚未接入；详见执行计划 §11.8。


## 长来源与确认前容量（2026-10-15）

- `ppt-source-line-ranges.mjs`：代码/文本流程的字面行范围，零起点、结束不包含；保持原始文本、缩进、空行、语言与顺序。`mergedSourceRanges` 只并集当前选择，不能把局部页扩展到整段。
- `ppt-outline-source-fit.mjs`、`ppt-outline-title-fit.mjs`：确认前使用真实来源绑定及系统标题/写作预算；PATCH 和 generate 不能绕过未解决的源范围、容量或标题问题。
- `ppt-text-flow.mjs`：仅严格纯文字 TeX 箭头流程变成可编辑流程；含数学变量/运算符的表达式保留数学路径。大 ASCII 层级图按来源层级表呈现，父行和直接子项共同分页。
- `ppt-template-fixed-authority.mjs`：固定展示对象只授权精确身份和原文，不为新正文提供事实；固定页映射必须在确认前覆盖。当前固定视图重建 sourceCatalog，防止旧缓存误判。
- `ppt-density-capacity.mjs` / `ppt-system-title-fit.mjs`：标题、来源正文和真实页码共享空间合同；候选测量必须使用该候选标题，不沿用上一页。两行标题不能把正文移入页码。
- `ppt-api.mjs`：`invalid_json` 纳入现有有限合同修复，使用同角色、记实际调用；不可无限重试或把失败视为完成。
- `ppt-navigation-plan.mjs`：只规范主题语言，不截取超宽标签的词前缀；有限模型重写和独立语义审查共同保证目录主题完整。

当前验证身份/失败详见执行计划 §11.11。完整实际长稿、同源矩阵及最终回归未全部结束，因此不能把这些入口当作整体通过证明。

## 2026-10-15 续做：长稿导航与评审表示

目录同时保留真实来源的未编号前言及编号章节，关闭/感谢页不因兜底标签而进入目录。`ppt-source-continuations.mjs` 从连续、同章节的引导句和完整清单推导跨页提示；`contentCanvas` 提前预留导航带，来源组件绑定时仅为后续真实分配的目标页写入提示。它不修改正文、来源主归属或字体，不能用提示替代实际缺失内容。

数学评审使用 typed runs 提供语义显示文本，原始文本投影与 quoteId 协议继续保持；全局审查不再丢掉节点角色及导航来源。章节眉题重复与真正重复正文分别判断。来源内编辑说明不是用户新增版面命令；真实计算条件和明确用户同页约束仍强制执行。标题关键词“证据保留”不等于宣称实测结果。代码不静默过滤模型发现。

最新矩阵 `be6ab093…`：48 项中 40 项流水线通过，8 项失败；26 次已完成重复中 24 次通过，另 10 次未执行。`4a48491b…` 新修复下的完整回归及真实原稿正在重跑，评审容量回归另有修复中。当前 `npm test` 2920/0/1。状态以执行计划 §11.14 和实际日志为准，尚不能标记全部验收完成。

最新补充见计划 §11.15：合并标题保留双方主题，ASCII 图表使用完整表头与图示标签；实文复核最多一次并消耗原纠正预算，保留初次发现，不在代码中消除语义错误。预览 API 只对当前未完成页提供安全占位以处理恢复时请求竞争；模型桥把明确已过期/取消的任务作为 skipped 确认，其余错误保持。`6ee89e0c…` 的 91 项领域/54 项 UI 已通过，但实际矩阵仍有失败；`d01832c2…` 正在重新验收，不把旧测试通过套到新构建。


## 完整来源、预算与 topic 的最新修复（2026-10-15）

`ppt-rich-text.mjs` 的只读显示字符串直接读取有界解析缓存；需要修改 runs 的调用仍返回深副本。避免容量扫描为每个冒号检测克隆完整数学树。`selftest-ppt-display-projection-cache.mjs` 验证调用方污染隔离、值归一化和缓存淘汰。

`boundedCapacityPartitions` 原子应用预算内的独立分片，超过 100 页的范围暂缓；已有的完整测量合并回收预算。预模型、局部模型与最终确定性分片路径统一采用此逻辑，保持原始单元/行/列/图片。表格分页测量包含实际标题及跨页提示。跨章节合并后再拆页时，页只持有另一章节的来源，不能继承前一章节的专属主题。自动长稿可预留来源为空的目录；显式、已确认或 100 页预算不会自动增页。

`fragmentTitle` 对通过语言检查的标题保存 exact source scope hash；范围变化即失效。规划标题检查必须读 `assessed.rawOutline.slides`，不能读先丢掉中文/locator 的显示投影。`requiredTopicRange` 保证译后的 locator 数字不变，其他来源与正文语言不改。目录 schema 直接约束字符上限，物理宽度和独立语义审查照旧，最多三次，目录 contract hash 3。

验证：`f6d3bf2d…` 98/98 冻结领域回归、npm 2922/0/1；后续 `7b0922f4…` / prompt contract 37 的 100 项完整回归及 56 项 UI CDP 正在执行。实际 Gamma 目录失败、Alpha 无来源数字和章节错配阻塞都保留，完整状态见计划 §11.18–11.19。当前不能标记全部交付或自动提交。


最新证据见计划 §11.21：6d24 的 102/102 领域回归通过，56/56 暖启动 CDP 通过，真实 UI 项目 b865… 的四页导出全部审阅，Arial 32 在实际 PPTX 中保留，浏览器无错。当前 c48 / prompt40 新增 ProcessBlock 相邻分片再平衡，防止 12＋3 的稀薄尾页；每个范围重新测量且不改变代码分页/源文本。103 项冻结回归和长稿/矩阵仍在运行，原 Gamma critic 阻塞与启动身份错误记录保留，不能据此标记全部交付。


标题后续见计划 §11.22：c48 的 103/103 冻结测试通过，但实稿暴露空主题 locator、用户封面授权错位和标题去重回添超长限定语循环。当前 b242 / prompt41 已加入用户封面先绑定、主题非空、局部标题避免重复、限定语预算和 system/native 度量分别一致的修复；104 项与真实全量验收仍在执行。不要把旧成功记录推广到新 hash。


当前状态见计划 §11.23：011fa4bb / prompt41 / review rubric15，修复 suffix-only 结构化 schema 导致标题只能返回范围、typed math 评审和跨页实例表示，以及 inline OMML 列表 2pt 字形余量。来源 ledger 额外校验数学结构，quoteId 保持字面不可变。105 项、真实长稿和 48＋36 基准仍在执行；旧 Factor 已耗尽原任务上限，不清空预算，以原始输入另建 clean 验收，保留历史。没有提交或宣称全部通过。

真实失败续修（2026-10-15）：[失败矩阵及方案](../exec-plans/active/ppt-real-model-failure-remediation-20261015.md)。当前 prompt42/rubric16 的 `4fc0a2ca…` 冻结领域回归 110/110、工程单测 2922/0fail/1skip。修复显式树图行载体、空封面合同漏字段、完整来源邻页平衡和区间主题；审查增加明确表格计数及一次精确来源证据复核，复核与原请求共用尝试预算。普通简单任务不会因此统一启用思考。真实同源矩阵与长稿仍在验收，不能以领域测试代替真实成品通过。


## 2026-10-16 当前可验证边界

权威状态见计划§11.28及[真实模型失败矩阵与根因](../exec-plans/active/ppt-real-model-failure-remediation-20261015.md)。68fe / prompt44 / rubric19 / render8 / display7领域117/117、npm2922/0/1、完整webpack构建通过。84次旧冻结矩阵保留8次原始失败，76份成功文件共373页全部查看；8个失败后续恢复单列，不改写原记录。48页Gamma与98页Factor的最终模型评审及实际导出仍受后续真实网络失败影响，按剩余预算恢复，不提前宣称长稿完成。

本轮新增后端边界：表格单元格inline解析保留严格比较号，block/inline缓存隔离；显式标题命令同步有效confirmed outline及缓存，titleEditBaseline避免无关页提案误失效；来源评审批次只展开当前所属与真实伴随单元，全局用真实quoteId引用已提供的完整组件，完整输入仍保留。ASCII图表的可见行来自原图而非规范摘要。负向评审不会被确定性正文证据直接抹掉，五次wire预算不扩大。


## 2026-10-16 用户要求先提交当前改动：验收检查点

本次按用户“先commit当前所有改动”提交已实现的内容；提交不代表尚未结束的整稿验收通过。最终生产模块hash为`5986280cd54ecbabc18f50d4a160af8e53db194796285fd496370d808afade6c`，prompt44/rubric20/render9/display7。

- 最终冻结领域回归119/119，首尾源码hash一致；`npm test`为2922通过、0失败、1跳过。完整默认webpack构建164静态页面通过（构建时68fe前端，之后仅后端MJS修复）。TS/TSX lint 0错误、28警告。
- 实际UI产品hash3a783bc5…/后端8740a8df…：73/73 PPT CDP、15/15通用冒烟，真实4页创建/暂停/Arial32/重新加载/恢复/导出闭环通过。未把旧后端UI证据冒称最终598后端全组复测。
- 原冻结真实矩阵84次中76通过、8失败；76份PPTX重开、373页PDF全部查看。8个失败项目后来恢复并逐页查看，包含2项显式标题修订；不改写首次完成率，不宣称最终598完整重跑84次。分档耗时/token/未知费用及所有失败记录见真实失败复盘。
- Gamma新同源48页真实模型审核、导出及全部逐页检查通过；最终598重新导出与已检查文件字节一致。PPTX SHA256 `0e0042081bde52b636a6013f150fe27490c7f26899ed9a446c56fb8ce1facbc1`，PDF `799d0e5f2e526ab9b334324607c787c54f8413d67e6f01d422ffd0978e0b3e27`。原始ASCII分支与18pt保留，第26页重叠修复；大型ASCII图跨页框线及稀薄来源页留白属于已记录表现限制。
- **Factor98页尚未完成最终整稿验收**：项目`dd8826ebd8844c6f20507bdb17996b9b`，原始输入hash `e10c84c46777d2cac50b8eb3d8a10a4c03a01ce63098e7edc49ea7f239de68c0`保持。按用户本次提交优先指令，在`quality:slide_71fa6d4e638a4d354efc7d60`正常暂停；全部页面已生成，但最后critic修复/复核、正式导出和98页实际视觉检查未结束，不能计为通过。检查点保存在`outputs/ppt-experience-quality-20261014/live-staged/factor-formula-representation-final/commit-checkpoint.json`。后续应从同一任务检查点恢复，不重建输入、清历史或重置尝试预算。
- 本任务3166/3168测试服务在保存检查点后关闭；其他任务实例未改动。用户3141页面若来自其他目录，不会因本工作树commit自动更新。未执行push、merge、发版或重启其他实例。

完整证据保存在本地忽略目录`outputs/ppt-experience-quality-20261014/`；代表性实际截图已随交接文档入库。托管视觉/生图真实凭证、Windows/PowerPoint桌面打开等未验证范围见技术债务，不能计为已完成。计划继续留在active，待Factor及明确的外部验收边界处理后再关闭。
