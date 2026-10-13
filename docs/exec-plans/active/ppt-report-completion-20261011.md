# PPT Gamma报告实施与64项闭环

创建：2026-10-11。状态：实施中。按原report.md实施并逐项补齐64项。

## 范围与隔离

复用application-local-run17，codex/ppt-report-completion-20261011分支。保留已有Claude/用户修改。基线hash在主目录outputs/ppt-report-implementation-20261011/evidence/pre-change-code-inventory.json。不自动合并主目录，不推送部署。集成为可审查分支与完整依赖补丁。

## 阶段

| Phase | 内容 | 状态 | 验收 |
| --- | --- | --- | --- |
| 0 | 64项/指引/基线/方案 | 已核对 | 原issue不遗漏、已有成果保持 |
| 1 | ComponentSpec、ReadingUnit、可变原生组件、双语packing | 已实施主要路径；完整验收仍在进行 | point1/2/3/4/6/8三语、来源/字体/媒体组完整 |
| 2 | 解释语义、迟到结果、导出状态 | 已实施主要路径；完整验收仍在进行 | 负例/同页竞争/取消/lease/revision |
| 3 | 写后执行、少页合同、目录/收束、标题/导航 | 已实施主要路径；完整验收仍在进行 | 原子回滚/exact-N/关系与密度 |
| 4 | span修复、outline进度、恢复/修复diff | 已实施主要路径；完整验收仍在进行 | UI真实状态、不抢焦点/不导草稿 |
| 5 | selftest/格式三语/模型/Office/录像 | 已实施主要路径；完整验收仍在进行 | 单元/实际UI/原生PPTX与真实LLM |
| 6 | ARM64阻挡核实、预检、64项清单 | 已实施主要路径；完整验收仍在进行 | 外部阻挡不算通过、无重复收费 |

## 决策日志

- 原质量与来源门禁不降低，auto与exact-N不同，冻结页数不默改。
- 使用已配置且授权deepseek-v4-flash，不记录密钥。
- 先有界POC再接入生产路径，不用独立辅助函数/模拟冒充集成。
- UI实际运行并CDP验证；未提供chrome-devtools MCP，使用仓库现有CDP/Playwright协议驱动并记录边界。
- Microsoft PowerPoint已安装；权限/跨设备/付款阻挡单列。

## 2026-10-12补齐与实际发现

- 真实UI在Home重试后，已选详情停留旧failed状态；现根据账户任务摘要重新取live projection，恢复同项目编辑器，dirty不覆盖。CDP回归已通过。
- live mutation返回约58MB项目曾阻塞UI；精简projection保留合同、质量轴与资产URL。
- 原生合法clone-count不再当资产丢失；缺source node目录仍明确阻断。
- source节点与writer checkpoint分离导致确定性目录被旧解释覆盖；目录编译同步canonical node，再由review验证。
- cover、declared recap按每source ID判断，不能把新事实当recap；只删除被实际claim审查拒绝的可选解释，接受/锁定/用户命令/新错误均阻断。
- v24增加overview语义摘要及单一语言可见配对归属；原文完整notes，所有摘要按immutable original审查，条件与关键数值义务仍必须有可见证据。显式清单/角色用typed objects，不可摘要或藏到notes。
- 新真实DeepSeek摘要负例（数字改动与范围泛化）均被阻断。54个三语×point1/2/3/4/6/8×长度0.5/1/2 native布局用例已执行，完整原生导出通过。
- ARM64预检38205765850于2026-10-12仍runner_id=0/steps=[]，annotation明确付款/额度失败，另有arm64容量notice；不声称云端通过。
- 主应用不合并/推送/部署，完整代码依赖在隔离分支，尚未将64项标为全完成。

## 2026-10-12用户追加：Gamma对比、编辑功能与ML Quant实测

1. 先完成原64项中可实施补齐与Alpha生产验收；不得将未通过项目标完成。
2. 以最新Alpha测试PPTX与Downloads/Alpha-Mining.pptx作逐页/逐对象对比。Gamma是外观和讲述参照；其遗漏条件仍不能作为删除必讲来源的许可。内容分布、语义模型、chunking、组件数量/位置、局部优化/生成要求、模板字形/颜色和目录数字逐点记录。
3. 修正侧栏为PowerPoint，使用用户根目录icon.png原资产，经currentColor alpha mask匹配办公区14px图标；不使用下载图标。修正AI面板全部下拉宽度/字体/视口边界，页名使用实际native/template-title或outline，禁止内部slide ID作为标签。
4. 修复proposal对generating/failed状态一概拒绝：只允许当前已校验render_ready页的局部content/title候选，run/epoch/plan/fingerprint守卫；pending页和全稿结构仍需先冻结范围，不允许迟到writer覆盖用户修改。
5. 核查旧浏览器证据：原harness为Playwright Chromium，并非每轮已证明Google Chrome。用户授权今后固定Google Chrome与http://127.0.0.1:3141/ppt，建立专用配置/实际version manifest，不假称旧轮次遵循了新规则。
6. 完成以上并保留Alpha最终证据后，以10_alpha_mining.md相同原生模板和已授权DeepSeek运行12_ml_quant.md；auto N，生产planner/writer/gates，不手写内容/假进度。保存独立ML报告、最终PPTX/PDF、Chrome真实全程录屏与逐页审查。

### 用户确认的ML Quant合同（2026-10-12）

用户明确选择“Gamma式中文精炼主稿＋完整双语原文与代码备注”。ML创建policy为overview、details=notes、language=output/zh、knowledge=source_only、code=omit；code原文完整保存notes，并非删除；auto页数由模块估算/原生容量校准。Alpha旧full_source合同不因此改变。必须让semanticSummary/语言可见归属经过原文审查，保数字/必要条件/结构清单与公式，不能用notes包存在证明主稿语义正确。

本轮测试规则：PPT专用playwright.ppt.config.ts与真实harness均Google Chrome、headed、http://127.0.0.1:3141/ppt；query可深链项目。旧Chromium/3153证据明确保留原身份。主窗口关闭/崩溃/断开必须记录并停止测试；不能让失去BYOK worker后的五分钟lease超时冒充上游模型故障。协议UI回归完成后再保持单一生产生成窗口。

## v31–v34 真实失败与补齐（2026-10-12）

- 新ML实际候选从64/65页降到29页，未接受、未发布；完整输入和自动页数合同不变。失败首先来自原生表格通过sourceArtifactRanges分配却未被取舍校验计作owner，随后来自英文含“A股/涨跌停”被any-Han误判中文。代码现在识别合法原表行范围，并复用主文字分类，混合/不确定段落不自动投影。
- selection修复一次列出全部缺失/重复/未知ID及去向/owner冲突。重复条目不“自动选最后一项”；模型仍须返回每ID恰好一次的合法完整合同。完整表/摘要表的真实行覆盖和必要风险继续独立验收。
- 原文备注增加完整不可变archive（包括H1、标题、已可见正文、另一语言和全部代码）。原生ML notes transport fixture逐字/hash通过，但该fixture不是LLM完成稿，不可交付冒充最终ML。
- 单次长outline真实closed-page流可见，文案区别来源组与未校验候选页，不再显示0/…组。同步DAG检查节点间让出I/O，避免HTTP/SSE/BYOK被整个批次饿死。
- 可选解释删除：按当前canonical deck，不依赖旧writer cache；其他页的用户命令不全局禁止修复，同页/结构/未知历史仍保护。若删掉无依据可选文字使原插图锚点孤立，可仅将引用移到同页真实保留source anchor；像素/geometry/font/hash不动，严格验证真实删除及锚点。实际Alpha只读proposal门禁通过，实际自动提交/全稿发布尚待验收。
- Alpha v33审查batch2发生transport超时，未发布。~100KiB/30k input-token真实review从4分钟改为有界7分钟，与bridge预算一致；仍只有一次受控schema fallback，任何超时失败不算通过。
- v33 root typecheck和2883测试（2882通过、1跳过、0失败），53个backend专项全通过；v34取舍/媒体引用/模型deadline目标回归通过。之后最终全量与生产签收另存，不用旧证据代表新代码。
- Home v33因/chat冷启动120秒失败；不能沿用v29截图冒充v33成功。记录失败并在warm UI重验；primary editor真实连续video/SSE保持。

当前仍在隔离分支，未合并、推送、部署主应用；固定已安装Google Chrome、http://127.0.0.1:3141/ppt。Alpha27页未满足≤20，ML无最终PPTX/PDF，不声称64项全部完成。

2026-10-12用户新增统一工作流：详细清单位于 /Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-unified-workflow-20261012/improvements.md。默认Gamma式overview/notes/source双语；显式语言选择优先；Qwen默认；库与任务计数分离；hover checkbox/bulk/portal菜单；大纲显式确认、hash与固定writer；用户可手动操作的3141持久服务；完成后DL13实际测试。旧Alpha/ML合同保留，未发布稿不称最终。


### 2026-10-12统一合同及真实长稿复验（v40–v52，进行中）

最新用户需求和实施清单见主输出 `outputs/ppt-unified-workflow-20261012/improvements.md`。合同版本29；新增默认overview/notes/source双语/source_only/code omit，显式语言请求与来源文本语言句子区分；统一库统计、hover checkbox、Radix menus、更新icon、Qwen默认、真实大纲明确确认及持久3141服务。DL13项目24993bff3ff676abd1d9fced16e143c4保留139单元全部来源；大纲未接受，禁止新建重复项目或声称最终PPT已生成。关系闭包、局部关系delta与分组规划、摘要表格坐标及global审查去重复仍需加载后实际复验。Alpha原生框高诊断已通过，但正式语义调用截断；不可复用旧review hash或将诊断候选冒充最终文件。无主仓库推送/合并。

持久服务和Chrome观察器分开：隔离checkout outputs/ppt-unified-workflow-20261012/harness/serve.mjs / record.mjs；通过原launch.cjs从Keychain读取master key，仅存于进程。observer退出不停止服务；serve的prependListener先清理自己Next子进程，再退出DB。固定Chrome与127.0.0.1:3141/ppt，不更换端口。PPT背景worker在所有route继续挂载，PPT页面隐藏重复Home任务条。真实模型遥测与失败检查点、报告输出放主outputs，应用源码仅隔离目录。


### 2026-10-13 v86–v88：DL13真实失败后标题合同恢复

DL13项目24993bff3ff676abd1d9fced16e143c4经Chrome3141真实确认43页，生成失败38页。确认前原来只校验正文拟合，没有校验native标题6/17/23VU预算；确认后标题冻结与writer缩短形成冲突。新增规划/确认共享inspectNativeOutlineTitles及最多3次范围限于title的模型修复。显式retry.repairOutlineTitles撤销当前确认、归档原确认与页面节点，保留既有selection/N重新审核；再次确认后才写作。表格范围标题修复不会被fragmentTitle重扩展。

目录数字保护门禁是正确拦截（模型删了Tutorial13/section ranges），没有放松。无source正文的navigation直接从最终outline派生，在source合同中保留双语目录标签；已确认标题禁止post-writer重命名。新增native-outline-titles和unified-workflow专项通过。npm-v87错误为Node18 ABI108与现有SQLiteABI127不兼容，正在Node22重跑；不能记为代码已通过。build-v87隔离目录不覆盖正在使用的dist；3150并行任务服务不触碰。待新DL真实成品及逐页QA，不签收全部完成。


### 2026-10-13 v109–v114：真实DL13恢复与失败editor补齐

当前43页writer完成。目录planning thinking缺项修复后真实规划/audit返回；分批整稿审查仍进行。修复derived文件名被封面短标题覆盖、原生core title、native canonical正文清理时序、失败editor retry/明确错误详情及未发布草稿退出。模板6个FontFace loaded；Home桌面/移动/返回深链通过。npm v110 2886 pass/1 skip；62 backend 61 pass/1 timeout，timeout目标独立重测pass。Chrome过时弹窗期望、缺估算fixture和真实被覆盖错误入口分别处理。未发布成果和未验收矩阵继续保留；证据见outputs/ppt-unified-workflow-20261012。


## 2026-10-13 v116–v134：真实生产失败后的根因补齐

最新UI生产快照 `.next-v119` 已成功构建；服务固定 Chrome / http://127.0.0.1:3141/ppt。完整33项Chrome回归通过，新增“失败固定页数→采用模块建议”回归独立通过。62套backend v117全部通过；输入框架局部审查、摘要delta及三语压缩等新专项另行通过。未合并/推送主应用。

### 本轮已证实的根因与实现

1. **双语标题≠双语正文已保留**。旧43页在整稿审查发现b_0051/b_0054等英文主段未真正入画面，虽然primary owner/claim ID存在。selectionSource现将source模式中选为slides的平行语言成员绑定成真实来源对象，摘要成员仍使用原摘要对象；两种语言在确认前进入同一物理容量计算。原始inventory不改，notes/单语翻译分别处理。代码：ppt-content-selection.mjs；证据 unified-v116/unified-v123-fixed、dl13-language-binding-v116.json。
2. **普通封面短标题覆盖文档名**。writer第一页曾把“DL Quant”写回project.title；现在只有用户改名优先，derived使用原始双语文档标题。完整标题同时在可见副标题；PPTX core title取文档名。
3. **失败后可编辑页被弹窗与层级阻住**。StructuredEditor有失败retry及明确错误详情按钮；未发布持久化草稿可退出。failed页面退出调用workspace back，避免failed详情无条件又把editor打开。源码/最新bundle均核对，Chrome相关回归通过。
4. **恢复错误合同**。失败16页后点击采用模块建议，旧analyzeDraft仍会retry原16页。现在仅模型、模板、policy、auto/exact-N合同一致才重试，否则保留旧诊断并新建正确合同。真实Chrome负例通过（retry-scope-chrome-v128.log）。
5. **摘要delta残留形式**。selection修复若换为summaryText，旧sentenceIndices不应残留；当前互斥schema仅允许语义文本/选句/选行之一。同时提供具体invalidSummaryForms错误，不删除原始来源。
6. **非内容metadata使有效修复失败**。summary repair reason旧上限80，与其他disposition的240不一致，曾拒绝有效source恢复。统一240，仍有上限；实测244理由再次超限时，错误现在指出reason实际长度与限制，要求只缩短理由。不能继续泛泛要求notes/null或page-index。reason非页面事实；summaryText/source/语言/数字/否定/容量门禁保持。
7. **跨阶段纠错提示污染内容**。原通用“notes需要null、slides需要页索引”用于Summary Delta，模型竟把primaryPageIndex:20加入摘要。现纠错只引用实际validator错误与当前schema，Summary Delta禁止ownership字段；真实来源摘要仍独立审查。
8. **overview审查误当全文**。审查新增经过校验的disposition/owner/原表rowIndices上下文，说明合法notes不等于主稿缺失，摘要表索引与原表索引有区别，rowEnd为exclusive。真实漏掉选定事实/语言/条件仍拦截。
9. **局部AI审查整稿导致超时**。原生副本1837...只改封面仍产生179,215字符scope请求，真实timeout，未应用。大稿局部scope改为修改页＋共同承载义务的依赖页；完整原始输入仍是事实权威；scope声明publicationReviewRequired，最终发布继续完整整稿审查；记录未改页面hash，过期/旁页更改仍拒绝。input-scope-v134-dependencies负例通过，真实重跑仍待完成。
10. **thinking阶段遗漏**。Qwen planning导航遗漏禁用已修复并真实返回。DeepSeek局部review:scope也纳入禁用思考策略，避免小改动消耗隐藏推理预算；当前服务前端快照与该最后SDK改动仍需最终同步/真实验收。

### 测试口径与未完成

- 原43页24993...全部曾完成writer/preview，但最终critic传输失败，publishedRevision=0，不能交付为成功PPTX/PDF。录屏包含真实失败/修复过程。
- 6417...与1b81...为未接受的16页测试；page-contract-events-dl13-v120.json记录到17次未在测试动作脚本中的减少页数点击，不能将其报作自动估算。
- 纯自动任务fb8052...：Chrome实际POST生产接口，未提供pages，initial33→parsed28、mode=auto；当前因摘要delta/schema失败仍未批准，正在修复后续跑。没有手写大纲或writer，也没有绕门禁。
- 原生副本AI预览已进入真实模型及scope审查，证明不再直接报project not editable；首次scope超时未应用，新scope重跑仍在验证。最终应用/撤销/保留其他节点的证据未完成前不称闭环通过。
- 本轮尚未提供DL13最终PPTX/PDF；ML12完整输出、原生副本最终发布、多设备/多人/跨领域×格式×三语×模型完整矩阵等原64项仍分别待验。
- Alpha27页 vs Gamma8页的详细逐点对比见alpha-final-comparison.md。该27页为旧全文合同正式输出，不代表新overview默认已达到Gamma效果；静态附件不能证明观察到Gamma生成时动态增减媒体的全过程。
- 当前GitHub最小ARM64 preflight最近证据38336751369：付款/spending limit门禁，runner_id=0，steps=[]。未支付、更改预算或宣称云端通过。


## v139–v151 实际失败补齐

详见 /Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-unified-workflow-20261012/report.md 与 full-checklist.md。新增表格selected-row坐标delta；selection reason超限精确诊断；局部scope依赖hash与独立旁页rebase；原生局部编辑保留已校验deck；局部review复用有界合同纠错及全候选source object ledger；普通ASCII边连接不误判分支。Chrome34/34通过；backend146为62/63加ASCII修复后专项通过；最新scope151专项通过。真实DL13还在生产容量校准，无最终发布；真实AI应用/撤销已200但发现subtitle副作用，修后真实复验待完成，不能签收全部无误。


### v151–v159 更新

真实native-ai-v152：预览/应用/撤销HTTP200，旁节点严格hash不变、撤销旁节点与原标题均恢复。input-scope的完整来源对象台账先对全候选计算；局部视图不把其他页素材误判缺失；格式错误用生产有界review合同修复，真实语义失败仍拒绝。目标与依赖hash保护，不覆盖其他页手工修改。

固定3141后来切换到gamma-semantic frontend-snapshot及独立state，原fb项目被并行修改为explicit49，已保留未覆盖。本任务独立项目1a313b6e56f1ef06fba6835970ed2b79使用完整13输入/DealReview模板/Qwen、未提供pages。生成仍未发布；新record154从真实API创建记录，旧record152不冒充同一state连续生成。

scope151、native标题/metadata159、统一workflow159专项通过；npm150 2887通过/1跳过，Chrome156在当前快照34/34通过。新增ownership-only优先级以保留既定semantic summary；metadata schema每个pageIndex+field对应真实上限，focus请求180字符意图，section80，最终validator仍严格；selection理由请求80字符内部标签，正文/源/notes不裁切。报告和64项清单：/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-unified-workflow-20261012/report.md、/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-unified-workflow-20261012/full-checklist.md。不得写全部改进已签收：DL13最终PPTX/PDF与新overview成功生产仍缺，原64项跨设备/复杂格式/独立人审见清单。
