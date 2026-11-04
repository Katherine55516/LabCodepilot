# Gamma比较报告的实施与验证

实现位于codex/ppt-report-completion-20261011隔离分支；禁止自动合并/推送主仓库。完整证据与逐项状态输出于主工作区outputs/ppt-report-implementation-20261011。保留本任务开始前的Claude/用户代码。

- 原生ComponentSpec识别局部图片/原生底板，原生XML实例同页克隆，unique shape IDs、关系和hash校验。文本为不可变source ReadingUnit的测量替换，语义绑定与媒体整组台账一起验收。未知复杂组保留，不能盲目克隆。
- 双语list point按对应索引交织；planner/writer共用typed rich components与atomic ReadingUnit。真实测试发现旧planner缺原子组约束导致预测可放、writer溢出；现在测量路径一致。auto只能对未写页面尝试已有原生模板变体，保持font floor、所有模板谱系、完成页映射。无可用变体仍返回容量冲突。
- claim audit绑定当前可见text hash与owned source exact spans，缺少/未评估/矛盾均阻断。Python AST仅对明确直接pandas rank提供确定性范围负例，不猜代码别名。真实LLM语义判断及多人可讲性评估不能由协议mock替代。
- 组件commit只来自真实worker stream，经run/epoch/revision/生成lease/source hash与实际容量校验；只展示已校验来源。新LLM解释仍草稿，整页render_ready前禁止对象编辑；预览完成计数只计render_ready。模型worker本身有独立客户端lease/replay/cancel守卫。
- auto写后proposal可执行完整source object的copy-on-write整页语义合并，失败原子回滚；exact-N不自动合并。目录绑定最终slideId/page ranges；标题后缀基于最终分片，人工锁尊重。导出技术verified绑定revision/manifest/render/export hash，人工视觉签收独立。
- 自动critic、确定性repair、写后replan保存真实SVG before/after和hash。选择页/对象与scroll分别按project/slide保存；旧滚动值不覆盖新查看页。跨路由全局worker与Home任务摘要保持。
- 源span repair校验node/sourceId/raw范围/revision、delimiter-only数学等价及原frame/font，不改旁边对象。writer Delta仍只允许诊断字符串，表格/代码/源ID不可任意改动。
- DOCX按引用提取脚注/尾注和textbox一次；PDF按持久gutter检测多栏并验证完整glyph覆盖；OCR只补图像页，坐标/置信度与人工确认必要，不能覆盖native text。XLSX源cell/range数值和series名生成可编辑chart+workbook，unsupported/无cached公式结果显式required warning。Docker声明三语OCR依赖。
- Microsoft PowerPoint 16.78实际打开、修改三个语言页OMML下标、保存/关闭/重开，逐页核对数学XML与原生PDF。该用例不代表所有矩阵/字体/Office版本。

核验边界：主测试、全部backend selftest、真实UI、真实生产模型、Office及GitHub runner各自记录。无测试证据不得标完成。GitHub新的最小ARM64预检38205765850仍runner_id=0、steps=[]，付款/额度由账户owner处理，不改信用卡或预算。Cowork Docker镜像已真实构建并实跑英文OCR；三语traineddata已安装，但尚不等于中文/香港繁体扫描全面验收。设备/多人人工验收需另有真实证据。

2026-10-12生产修复：跨标签重试恢复live editor；metadata包含generationPolicy；编译目录同步writer节点，避免重新装配恢复旧导航解释。mandatory审查使用当前可见slide/node/quote三元组，结构化协议不预设事实判定。

v24少页合同：summaryText只用于overview+notes的非结构正文。原文不改写，完整存notes；semantic summary生成的claim只对originalSourceInventory原文审核，不许摘要引用自己来证明。单一语言可将配对原语言存notes，但必须visibleEquivalentSourceUnitId指向真实目标语言主稿；pairId只是候选关系，原语言全部条件义务仍须由可见原文/摘要通过模型审查。公式、代码、显式清单/角色、表行仍按完整结构或原始单元格规则。

optional-copy repair仅移除实际unsupported/contradicted的非来源节点，固定source content signature和source hash，任何已接受/锁定/用户操作历史/new deterministic error拒绝自动提交。每次仍重新审查，不自动签收。

2026-10-12补充：PowerPoint侧栏原icon.png alpha mask/currentColor/14px；AI菜单用PptSelect/Radix，实际327px触发与菜单一致、14px字号、mobile不越界。目标页显示语义标题，Escape不关闭外层AI面板。failed-generation若仍有render_ready页可以返回编辑器；局部提案按page/run/epoch/plan/fingerprint校验，pending/accepted/跨页结构仍保护。单页critic不再从旧缓存装配其他页；可选解释移除保geometry，独立写后事务再量测。

模板EOT字体经边界与SFNT名称/weight/fsType校验，按项目账号与fontSHA提供FontFace和SVG内嵌；Office临时fontconfig读取同一PPTX嵌入字体。字体fallback按字形簇，只影响缺字字符；原始run字号/粗细不因分裂而zip错配。等线等未嵌入CJK家族仍可能需要经验证的备用字体，不能声称各OS字形完全相同。

测试固定Google Chrome与127.0.0.1:3141。原历史部分使用bundled Chromium/3153，不重写身份。harness记录Browser.getVersion及close/crash/disconnected。账户项目摘要不hydrate媒体，测试状态poll每5秒，避免状态采集本身长期占用CPU。保留所有历史run/检查点，不批量反复收费。

用户已确认ML Quant采用overview+notes、中文输出、source_only、code=omit的Gamma式精炼主稿；原双语正文/完整代码保notes，原文hash不变，auto N。主应用未合并/推送/部署。

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


### v151–v159 更新

真实native-ai-v152：预览/应用/撤销HTTP200，旁节点严格hash不变、撤销旁节点与原标题均恢复。input-scope的完整来源对象台账先对全候选计算；局部视图不把其他页素材误判缺失；格式错误用生产有界review合同修复，真实语义失败仍拒绝。目标与依赖hash保护，不覆盖其他页手工修改。

固定3141后来切换到gamma-semantic frontend-snapshot及独立state，原fb项目被并行修改为explicit49，已保留未覆盖。本任务独立项目1a313b6e56f1ef06fba6835970ed2b79使用完整13输入/DealReview模板/Qwen、未提供pages。生成仍未发布；新record154从真实API创建记录，旧record152不冒充同一state连续生成。

scope151、native标题/metadata159、统一workflow159专项通过；npm150 2887通过/1跳过，Chrome156在当前快照34/34通过。新增ownership-only优先级以保留既定semantic summary；metadata schema每个pageIndex+field对应真实上限，focus请求180字符意图，section80，最终validator仍严格；selection理由请求80字符内部标签，正文/源/notes不裁切。报告和64项清单：/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-unified-workflow-20261012/report.md、/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/outputs/ppt-unified-workflow-20261012/full-checklist.md。不得写全部改进已签收：DL13最终PPTX/PDF与新overview成功生产仍缺，原64项跨设备/复杂格式/独立人审见清单。


### 2026-10-13 v167–v182检查点

最新report.md/full-checklist.md已更新64项代码链接。DL13项目1a313...在Chrome明确确认模块51页，51个writer/render_ready完成；两轮critic均transport timeout，publishedRevision仍0。原生技术导出PPTX/PDF51页通过且逐页查看，仅作未发布诊断。record163有效自身项目连续片段约69分钟，record174独立续跑已结束并保留trace/video。

purpose/type只兼容已知enum；部分失败新增canonicalSlide缓存和只读working-deck投影，waiting不可编辑、epoch/preview/quality严格校验。Alpha原生副本preview/apply/undo真实200，旁节点hash不变。标题重复在确认前受限metadata修复，用户锁保留。可选critic timeout/network保留原页与未解决finding，最终仍quality_blocked且不export；auth/取消/迟到编辑继续传播，完整API负例通过。

用户最新要求来源双语标题及正文；默认/overview缺省body=both，Wizard未碰语言也both，明确中文/英文/香港繁体优先。历史显式primary保持，菜单明确其译文仅备注。不得为压缩页数隐式切回primary。未完成quality只在最终status存在时显示结果，避免undefined和误导零项统计。

backend-v182完整63/63；npm182为2887通过/1跳过/0失败；build181完成。新前端快照位于隔离outputs/ppt-unified-workflow-20261012/frontend-v175。3141有并行Gamma项目，需空闲后安全加载新快照再实际Chrome核验。正式DL最终签收仍缺，不标整个计划complete。GitHub38336751369 runner0/steps=[]，无ARM64通过。主应用未push/merge/deploy。


v184–v192：新前端build181已在固定3141加载，manual187实测双语默认/英文覆盖、Qwen、图标14px、下拉同宽、5文件统计及hover/bulk/portal通过、pageerror0。source title188对已确认旧合同兼容；新DL13 eb0caf... auto初估12/candidate11未接受，过早原生coverage恢复中止于source5。189只对auto未确认候选保留最小真实overflow映射，原8版式全保留且9实际溢出仍阻断，随后走原容量修复。源、字体、媒体和最终门禁不变。192局部取舍保持双语pair一起notes，只同页且仍有主稿owner；跨页、受保护结构不改。backend19163/63及pair192负例通过；后端189/192待并行Gamma任务空闲再加载，不能称新输入最终成功。
