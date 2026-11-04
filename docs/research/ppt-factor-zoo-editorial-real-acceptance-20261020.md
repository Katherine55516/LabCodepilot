# Factor Zoo：编辑取舍、归属与容量闭环的真实验收

> 状态：尚无通过最终发布验收的本轮 PowerPoint。2026-10-21按用户最新要求暂停完整workflow，先收尾既有修复并讨论新规划方案；历史尝试按下列时间顺序保留。不能把单元测试、API连通或 outline_ready 当成整稿完成。

## 输入和边界

- input：`04_factor_zoo_overview.md`，SHA256 `ebacfacedb6138ccb30f6b6af2b7b23a74574c741d348105aa5a2b2dba4fee16`。
- template：`Copy-of-Process-Improvement-Proposal.pptx`，SHA256 `ded048efedf16230eee0fe1df9db3fca0fc16e6700382e4eae8250cce4a0edb8`，原生8页、Roboto系列、橙色强调。
- slides源接口复制到隔离验证配置，所有角色实际调用 qwen3.8-max；最小探测 actualModel=qwen3.8-max；无模拟LLM。
- 3143同一项目 `7e5e5469bf0ac161e5e0afeaa2c85c9c`；3141未执行启停或配置修改。
- 阅读模型给出14页、范围12–16。代码不产生另一套推荐页数；本轮截至此记录仍按14页局部修复。

## 已发现、定位和修复

| 问题 | 根因 | Code / Prompt 修复 | 验证边界 |
|---|---|---|---|
| 61归属被补成168 | 编译器用最近页面替模型决定语义归属 | 完整读取后的v2编辑计划只绑定显式 primaryPageIndex；不补齐全文/关系/摘要 | 真实61-owner拓扑回归通过，缺归属必须拒绝 |
| 0语义摘要 | v2实际分支重保留，混入旧全文备注指令 | 独立编辑prompt，区分读取覆盖、主稿选取、物理归属；提供真实摘要/关系图示例 | 新Qwen初稿88 summaryText、1 summaryGraph；不是fixture注入 |
| 94个页码不一致 | 模型把声明页码和数组索引混用 | 批量仅修复索引/归属的typed delta；冻结正文、选择、N | 不再错误路由成“恢复全文”摘要任务 |
| 选3行却只返回2行 | summaryRows与rowIndices形状不符 | 按原表行列键局部修复，不截断、补“其他”或转备注 | 实际坏表fixture及范围越界/行键负例通过 |
| 表格摘要丢语义 | 模型在FF5等列省掉必要比较成员 | 每个改写单元格独立审查，修复原列；审核前不冻结主稿 | 实际critic拒绝后逐格修复；原始表保持 |
| 表格审查HTTP400 | JSON模式请求没有明确JSON输出指令/typed schema | 返回明确JSON且携带完整check schema；不是容量失败 | 修复后真实单元格审查可执行 |
| 流程允许普通摘要 | schema和validator允许形式不同 | Process仅完整对象或精确来源关系图；修复schema同规则 | 先收集全部错误形式，避免逐ID循环 |
| 英文标签首字母大写被拒 | 提取证据比较过度限制展示大小写 | 仅允许普通词组首字母的显示大写；变量/公式及证据仍精确 | 精确原文/emoji/重复引用/篡改负例保持 |
| 同主题误强制同页 | 阅读阶段将定义和后文应用合成一个same_page约束 | 独立审查物理邻接；只在各页条件完整且跨页联系成立时改linked_pages | 本输入定义/多重检验关联通过独立审查；真实必要邻接不放宽 |
| 摘要漏条件 | 初稿26段省掉MV有效性、均衡条件等 | 对完整原文独立审查，只有失败摘要做delta；原文和N冻结 | 当前候选84个实际可见语义摘要经审核后才进入容量阶段 |
| 容量delta被ID拒绝 | 编译前raw无ID、渲染outline已有ID，两者混用 | pageIndex作delta定位；ID由服务端保留；返回具体范围差异 | 不把合法已知服务器ID当新页面，也不允许借用其他页 |
| “超过10对象”冒充容量 | 历史资源guard先于几何检查 | 有界64对象资源保护与14pt实际版面测量分开，错误类型独立 | 11短对象可读通过，11长对象仍真实溢出，65对象明确资源错误 |
| 解释段落被冻成流程 | Markdown含箭头就成为diagram，inventory无条件给Process | 仅真实图、明确步骤或流程前缀构成流程；普通模型演进段落可语义摘要 | 原始ID/text/rows不变，已确认合同不迁移；LLM已读页数保留 |
| 媒体晚到writer才失败 | 纯表格fallback能装下但未兑现关系媒体 | 大纲物理预检也检查真实media receipt；不把表格覆盖当关系图完成 | 最终图形/PPTX编辑性仍待正式输出验证 |
| 重开任务丢阅读 | 模型/模板目录异步加载误作输入变化 | 按模型实际配置识别来源变化；恢复统一向导、原页数/深度/来源 | 实际Chrome恢复读取项目、同页数继续修复已操作 |
| 候选状态误导 | accepted与阻断式容量警告共存 | schema/ownership/semantic/physical/confirmable分开；阻断草稿不发布 | 当前物理失败时accepted=false、confirmable=false、按钮禁用 |
| 模板强调色/预览字形 | 灰色文字频率高；SVG外部图像字体未包含 | 色彩token优先、旧上传缓存版本更新、SVG嵌入原生字体 | #606a6b→#cc5500；8个实际SVG图像预览均含原生font-face |

## 验证记录（进行中）

- `npm test`最近完整运行：3025通过、1既有跳过、0失败；随后新增修复仍需提交前最终重跑。
- 领域回归：显式归属、表格投影、邻接审查、资源/几何分离、parser分类、确认硬门禁、关系图证据及旧版预算分区通过。
- 首轮默认smoke：92通过、7失败；其中1项旧容量文案已更新、恢复入口断言迁移到新向导、2项旧编辑器入口需先进入高级设置、确认对话框层级已修复；1项手动ML成品依赖用例改归`@live-ppt`，不是通用smoke。重启造成的连接拒绝不记为产品容量失败。全部适用smoke待最终重跑。
- 容量/渐进展示7项专项Chrome smoke重跑通过。
- 生产构建已通过；最新UI发布构建位于`.next-ppt-factor-editorial-release`。
- 每轮原始模型回复和usage保存在outputs/ppt-factor-zoo-real-20261020/live/；本轮UI和导出证据另存outputs/ppt-factor-zoo-editorial-20261020/。

## 完成前必须补齐

实际模板容量通过 → 用户界面确认大纲 → 真实页面writer → 独立逐页及整稿critic → 正式PPTX/PDF验证 → 每页视觉和逻辑评审 → 对照来源与Gamma参考 → 全部必要回归通过后本地commit。未完成前保留本页进行中状态。

### 真实追加：显式修复轮次与双语取舍

- 同一规划运行积累多次用户发起的重试，任务级5次额度被旧轮次耗尽。显式“重新规划/继续修复/失败重试”创建新的可追踪run；自动transport/格式重试仍受原任务限制，executionHistory与项目累计token预算不清空。新增预算回归确认新run不能绕开累计费用限制。
- 真实Qwen连续返回b_0173可见、b_0174排除的双语不一致delta。修复提示之前仅说保持配对含义，没有把languagePairId的整组可见性表达成明确合同。现在传递完整配对规则；诊断中同一组必须全部slides/summary或全部合法excluded，apply阶段立即拒绝相同无效分裂，而不是让下一轮再发现。
- 独立原生渲染探针已检测到LibreOfficeDev 26.8及Poppler。前一份历史报告的“本机没有LibreOffice”只反映当时环境，不能沿用作本轮最终渲染结论。
- 最新生产UI构建`.next-ppt-factor-editorial-build`通过。修复高级AI目标变更残留旧inline scope、内部离开确认被inline composer遮挡；实际Chrome完整smoke重跑中。

- 真实审查还出现缺少非空reason的单条verdict。此类审查响应合同错误原本会进入selection修复，错误地恢复正文；已改为只对缺失verdict做一次有界审查重试，保留有效审查及缓存，绝不借此改动正文。仍无效时明确报告reviewer schema错误。新增空reason/缺checks回归。
- 表格容量prompt明确使用summaryRows精炼原单元格；“少选几行但逐字复制长单元格”不是有效压缩。行键、列口径、数量和必要条件仍由原表独立审核，无法容纳须合法分片。

### 从一次大JSON修复改为分阶段规划

真实反馈已证明“给更大的scope、继续让模型同时复制摘要及决定归属”仍可维持错误分配。新增的allocation阶段不改任何已选文字：先明确每页独立问题、材料归属和保守物理负载，再进入局部正文精炼。所有已选ID必须恰好一次，区间外/用户锁定/分片合同不改变，正常source/semantic/physical gate继续决定结果。不是代码按篇幅计算第二个页数，也不先放弃校验来凑成品。

### 关键遗留：全局关键词保护与选中主张条件混用

旧selectionConstraints/compileContentSelection仍无条件保护含only/must的段落和全部定义/流程，并沿启发式关系全局闭包。这与“可选推导可不选、所选主张的必要条件必须保留”不同。新v2完整读取方案改为：保留明确必显及主要主题硬约束；对完整原文组和实际可见投影独立做核心覆盖/条件审核，逐项拒绝真正缺失的核心或条件；不靠代码关键词选择正文。未通过独立覆盖审查的草稿不进入后续验收。确认后只沿用匹配原文及ledger哈希的授权，不能扩散为旧项目门禁豁免。

### 显式页数调整

14页完成有界重组后仍有真实容量阻断，未启动writer。测试人员在3143创建向导将页数显式调为16（在阅读模型12–16建议范围内）；保留14页原建议，不触发代码重新推荐，不重复读取相同来源。16页测试加载了独立完整组核心覆盖审查与条件范围修复，继续使用同项目、同输入/模板/真实Qwen。

- 16页真实初稿出现两个独立双语配对冲突。修复器曾在第一组已修好、第二组未触碰时整体拒绝delta；下一次模型只修第二组，第一组又丢失。现改为只要求被本次delta修改的配对内部一致，正确的独立配对立即成为未确认检查点，其余问题由下一轮assessment继续报告。不是允许最终残缺配对通过；最终完整selection检查仍拒绝任何未修好的配对。新增两个独立配对的组合修复回归。

- 完整原文组审查真实拒绝了b_0195/b_0196拥挤机制遗漏；已由模型只恢复该中英文核心风险说明，未恢复全部原文。
- 另发现生成的outlineSeed被当成人工指定大纲，关闭了每个主要来源章节的代表内容保护。完整读取的新v2编辑草稿恢复主主题保护；人工requestedOutline及旧合同仍保留。独立审查也保留sectionPath作为核心层级证据，不能只看被粗合并的reader group摘要来判“2×3算例可以整个省略”。新增AI草稿seed不关闭主题保护的回归。

- 真实流程图审查要求保留“流程应为”的建议语气，模型却添加一个不在真实9步中的第10步，并给节点加未支持的英文解释。不能批准这张图。此类失败的Process图projection定向要求模型恢复完整原始流程；修复orderedSourceSteps对“workflow should/must be”“流程应为”的识别，限定语留在第一个真实阶段，不创建额外步骤。中英文箭头链回归确认阶段数与建议语气同时保持；之后仍走真实语义、媒体及几何检查。

- 修正scoped修复循环的末次验证：第8次合法delta必须再assessment，不能因循环结束直接丢弃并重写128条父proposal。仍未通过时保留最新未确认检查点，下一次显式继续修复；局部阶段耗尽不自动重生成整个范围。新回归明确第8次修复成功会有第9次assessment，超限保留可恢复状态。
- 核心覆盖审查改为一次列出本组所有可识别独立缺口（每个缺口保留最低必要来源），并纳入实际可见标题的框架信息，避免已写“CAPM经验失败”标题却还要求再复制一段同义导言；标题不能替代正文必要条件/数值。隐藏focus/question不能作为可见事实。缓存绑定可见标题，已加标题变化/隐藏focus对照回归。
- 审查顺序调整为局部表格/摘要/图的来源忠实性先过，再做完整原文组的核心覆盖。防止一个摘要省错定义时先把原本未选的邻段恢复上页，应该优先修那个摘要本身。
- 容量prompt移除内部priority/must_preserve_structure等可能被误读为“必选正文”的元数据；全文/原表/来源ID仍完整，结构保护是“选中后保持”，真正取舍权限来自source_rules和独立核心审查。

- 发现重排后IR的pageContract仍合并旧页面requiredUnits/question/comparisonAxes等派生数据，造成新页面仍带旧任务。完整读取的新v2未确认编译按实际sourceUnitIds重建owned作用域合同，普通启发式跨页关系不再添加另一页的必显单元；有来源证据的解释义务和全组核心审核继续硬执行。marker经normalize/buildPlanning保留；旧显式合同继续原行为。补齐definition/workflow角色到页面任务的直接映射。
- allocation重排后清除旧titlePair/titleSecondary，允许模型为同一新主题提供可选、忠实的第二语言题目；不把“分类、构建与应用纪律”沿用为策略流程页副标题。
- 有实际二级章节时，课程导言/章节预告不再被算作额外必讲章节；真正章节代表内容及显式must-display继续保留，导言的核心信息仍须经完整原文审核。回归覆盖章节保护/课程导言区别、旧关系合同不变及真实来源条件依赖仍阻断。
- scoped容量请求仅发送实际叙事字段及归属，排除旧pageContract/densityFit等派生元数据；JSON解码的sourceUnitIds及表/行范围ID限制为当前scope，避免返回不允许的其他页来源后整块重试。

- 只读CPU取样证据`backend-cpu-sample.txt`：该3秒窗口主线程206/219样本位于kevent/poll等待，不能将当前整段等待笼统归咎于本地渲染CPU或传输错误。模型调用、逐项语义修复、纯排版检查仍分别记录。短时取样不代表整轮性能统计。

### 跨组覆盖及摘要修复的进一步收敛

- 核心覆盖审查此前仅把当前阅读组的实际正文交给critic，导致模型组中的FF3独立分组与后部2×3算例无法互相提供可见证据。现在每个完整原文组都对照整稿实际可见投影及标题审查，原文组不是重复展示边界。必要同页解释合同仍独立执行；标题或隐藏focus不能代替正文事实。审查缓存版本更新并绑定整稿可见材料，其他组的实际证据变化也必须重新审查。新增跨组方法只解释一次、外部证据改变使缓存失效的回归。
- 普通可摘要段落的失败修复现在只允许修改原有summaryText，补充诊断指出的必要定义/条件/范围；不再提供“恢复整段原文为slides”的逃生分支。真实表格、显式必显和受保护对象仍保留完整结构修复；旧项目的全文保留合同不改变。新增新编辑合同拒绝全文逃逸、摘要修复不改归属及旧合同兼容回归。
- 最新完整Chrome smoke：98项通过；生产UI构建`.next-ppt-factor-editorial-build`通过。后续修复仅后端/测试/文档；最终单元回归及真实发布验收仍进行中。

- 真实容量delta再次出现106条summary、0条summaryText，全部退回sentenceIndices；这是结构化解码仍提供旧摘句分支导致的真实退化。容量修复请求现在只为普通摘要提供summaryText/有证据的graph，服务端也拒绝该scope中再次用摘句绕过编辑；编译器仍能读取历史摘句草稿，既有全文合同不迁移。
- 多页失衡时，若首尾失败卡片紧邻同一真实来源主章节的未锁定内容卡，也将该邻卡纳入重排范围，允许合并“因子定义”和“信号/异象”来释放后部实操页；不因为整稿同名而扩大scope，单页失败仍保持局部范围。真实source heading作为边界，新增同章节/不同章节/锁页/单页负例。
- 真实双语delta两次仅重画英文9步图而继续排除中文流程。既有server门禁已拒绝；请求schema现在在诊断到可修复双语分裂时要求成组返回两个成员，明确不能靠再次重写英文来解决翻译缺失，新增schema回归。
- 容量修复上下文过去把writer在确认后的“保留完整冻结正文”诊断指令也发送给未确认编辑器，和此阶段允许取舍/摘要冲突。现在scoped prompt仅携带code/pageIndex及实际几何details，不复制另一阶段的修复指令；真实原文和来源规则仍完整提供。回归确认usedHeight数值保留，而确认后冻结文案不进入未确认修复。
- 测试脚本等待修复完成增加已观察outlining状态的条件，避免只因updatedAt先改变就把尚未开始的outline_ready误判为修复完成。此处为测试驱动时序修正，不冒充产品容量优化。

### 来源编辑先于物理归属

后续真实返回已出现122条summaryText、18,162字符，但前部仍安排3页定义，末页混入31个来源。单纯增加摘要字段没有解决任务分解。新增`ppt-editorial-selection.mjs`：仅在完整读取的新v2、source/both、未确认、多页容量失败且没有分片/复述/锁页合同时，按原始sectionPath形成不超过24个ID的有界批次，完整保留语言对，以生产并发限制执行。各批次只能按schema生成真实来源取舍/语义摘要，不返回页数、标题、任务或owner；可见owner保留，明确excluded只移除对应现有归属，原文不变。合并后先走摘要/表格/图/完整来源覆盖审查，再对已精炼材料做allocation与物理检查。单页、已确认、锁页及已有分片不进入该批量阶段。

allocation不再无条件冻结所有历史选入ID：可把source_rules许可的可选重复明确列入excludedSourceUnitIds，语言对整体变更，所选ID与排除ID必须恰好分区、不得丢ID或重复占有。不是代码选择删什么；原始文字/表格不改，必要事实遗漏继续被独立审核拒绝。真实有解释内容的矩阵/卡片可承担模型说明，不能强求同义正文再单独占页；仅标题或模型名仍不构成解释。

新增回归覆盖：原始章节分批、24-ID边界、双语不可拆、显式必显不可排除、不可改owner/标题/N/原文、范围外不变、遗漏/重复/借用ID拒绝、排除与页面归属一致、确认/锁页/分片合同不迁移。完整工程回归及真实新阶段验收继续进行；尚无正式成品。

- 前一轮真实整体capacity round 2的请求217,609 bytes、32,768输出token上限，在420秒执行截止时返回ppt_timeout。不是页面容量错误、不是接口鉴权失败，也不是已有PowerPoint验收失败；writer仍未开始。记录`attempt-semantic-capacity-timeout-manifest.json`及原始model.claim.metadata。章节批次替代这类大范围正文重写，未扩大超时或关闭审查。
- 发现较旧pendingEditorialRepair会优先于更新的主检查点恢复。新检查点保留retainedAt，恢复选择匹配合同中较新者；真正最新的未验证delta仍可恢复，来源/模型/规划身份及hash仍严格校验。成功assessment保存主检查点后清理过时pending；旧无时间戳记录在平局时优先主检查点。新增新旧顺序、身份改变与旧版本兼容回归。历史状态和模型回复继续保留。
- 只允许原样slides的章节没有可编辑操作，不发付费模型调用；此guard的空批次flatten回归已修复并通过。

- 真实章节批次的失败进一步定位为：旧summary-only delta重建entry时丢掉primaryPageIndex；此外新批次错误地添加80字符reason硬限制，与现有compile的240字符内部元数据合同不一致。摘要delta现在保留owner；对旧条目仅在原页sourceUnitIds有唯一显式声明时同步冗余index，绝不按距离猜页。新批次统一240字符并准确报告reason字段错误，不改任何可见正文。新负例验证完全无owner仍拒绝，120字符内部reason可接受、241字符只报metadata错误。保存下来的23个真实最新批次回复用修复后local合同离线重放23/23通过，**这不等于语义审查或整稿通过**；生产真实重跑继续。
- 已完成且结构合法的章节回复按source/model/provider/execution policy/实际prompt哈希保存有界缓存；重试先重新校验，再合并并照常独立审查，单个批次失败不重复调用其他已完成批次。不以缓存结构通过冒充语义通过。
- 测试驱动的retry曾使用默认完整投影，202已收到但大型模板载体的response body在30秒工具截止前未收完，驱动关闭浏览器。改用产品前端已经采用的`view=live`并延长有界请求等待；这是驱动与产品协议对齐，不是发现产品相同接口必然超时。

- 新章节阶段真实23批一次返回完成，进入独立语义审核；审核精确指出并修复了Gaussian-return条件、不可交易风险等遗漏，并实际生成了三种溢价解释的平行关系图及9步策略流程图，不能据此提前宣称媒体/导出通过。
- 合法allocation的独立完整组审查仅剩b_0159时间序列回归方程、b_0207 HML构建方程缺失。旧代码把schema纠正和semantic assessment合在同一个两次allocation尝试中，第二次结构修复后才发现的两条语义缺口会使整个蓝图丢失。现在结构合法立即保留检查点，缺少的公式/条件交由已有typed local repair，只修诊断来源与实际owner，仍经全部语义和物理门禁。章节源编辑仅运行在仍有摘句/普通全文prose的来源组，已是semantic summary的组不反复重写。确认/分片/锁页边界不变。

- 进一步修正章节保护：新v2编辑范围的代码硬门禁要求每个主要章节至少有实际可见来源，而非固定印出首段。独立完整原文审查负责验证该替代说明是否实质完整；只有一条数学假设而缺核心机制仍拒绝，表格完整表达概念则允许省掉同义导言。显式mustDisplay/mainIdeaRequired、旧版合同保持。新增整章缺失拒绝、表格替代、无意义替代被critic拒绝、显式必显和旧版兼容回归。
- 普通来源的typed selection repair也仅新建semantic summaryText，不再把刚精炼的正文恢复为sentenceIndices。已存在未修改的摘句仍兼容，结构表格/流程/公式保持各自规则，服务端同样拒绝违反新修复schema的摘句返回。
- 只读独立几何重放发现表格投影的已接受审查回执仅在内存候选中，未随检查点及最终项目保存。现在实际audit结果在finally及最终项目中持久化，正向缓存仍绑定完整原表、选行、实际单元格及sourceRevision的hash；新文字不能借旧回执通过。
- 原模板已通过LibreOfficeDev独立转PDF。PDF的BaseFont实际为Roboto-Regular、Roboto-Medium、Roboto-Bold（另有符号字体OpenSymbol）；封面原生渲染已查看。这是原模板字体基线，不代表尚未输出的Factor Zoo成品已通过。

### 新阅读项目及明确页数调整

原16页项目仍保留，最新候选9页真实几何失败，未启动writer，没有正式PPTX。其最后状态归档为`16p-final-blocked-*`，不把它改称成功。

增加了阅读阶段的结构signals：声明的原生正文区/字体、完整原表及含header单行的真实高度/可移植性，测量上限与完整性标志均明确。没有计算、推导或输出另一推荐N，没有把原表全展示场景当作综述的页数下限；全文原表不截断。输入/字体/行数未变及64行测量边界回归通过。

新项目`b1063d81e5aedc980a730b570709c365`使用同一原文件、同一模板和真实Qwen，完整送读41,415 UTF-16字符、182/182来源确认；只做了一次阅读加一次目标metadata修复。模型明确提到5个长表、双语和原生区域，但仍推荐14、范围12–16。**这说明模型估算仍偏乐观；结构signals本身不保证估算精确，不能报告为自动容量估算已完全解决。**

测试人员随后通过实际UI将页数明确选为24（超出建议范围，用于原生双语结构保留测试）；原reading推荐14不改、没有代码校准为24。后续24页若通过，只证明这个明确选择预算下的完整生成/导出，不冒充14/16页已通过。仍需完成writer/critic/正式文件/逐页原生核验后才能提交。

### 24页真实候选：表格行选择修复与工程回归

首次完整24页真实回复保留182条来源取舍；五个普通表格的rowIndices包含不存在的N+1行，且可见summaryRows与索引数目不匹配。新增的typed table-row-selection repair提供原始header=0、DATA=1..N及每行原始键，模型仅修改被诊断表的rowIndices/summaryRows；没有截掉越界行来猜其意图，也未改变其他来源、owner、标题或N。随后实际Qwen调用`outline:table-row-selection:0`完成，继续正常selection/summary/独立审查，证明此前路由阻塞已解除，不代表成稿验收通过。

回归包含真实header/N+1拓扑、0/N+1/重复/乱序/空行号负例、未知ID及改行键负例，检查输入候选、页面及primaryPageIndex不变。最新完整`npm test`记录`/tmp/ppt-factor-all-table-row-selection.log`：3026通过、1既有跳过、0失败（3027项）。真实摘要审查仍在进行，writer及正式输出尚未开始。

### 24页初稿的独立规划复核（非最终成稿）

真实初稿并未因增加页数就自动变好：FF3概述和独立2×3示例重复拥有b_0089/b_0090/b_0095/b_0096，模型家族又被评分卡/taxonomy打断，前部推导占页较多。只读原生容量重放仍检出10个溢出主题（术语、CAPM假设/失败、FF3、评分卡、FF5、q/q5/SY、策略与结论），另有4项重复主owner及对应对象重复诊断。该探针仅用于排查，不是正式发布验收。

正常管线现已完成首轮独立摘要检查并定向修正必要条件；来源级取舍阶段将excluded从2改为12（不是代码自动删除），随后完整原文组覆盖审核通过，进入固定N下紧凑allocation。allocation只处理任务、标题、明确owner及被规则允许的可选省略，不重写已验证可见单元格或语句。实际Qwen首个allocation漏掉后部策略/验证来源，严格exact-partition校验已拒绝并给出missing IDs进行一次有界合同修正；不把漏项挂到末页来伪装完整。当前仍无正式输出。

第二个allocation的归属分区完整，但五个section标签为82/84/92/100/123字符，超过80字符上限；旧泛化错误只报“Invalid page intent”，导致整份分配作废。修复为聚合字段诊断与独立metadata delta，仅修改指定section等字段；保留N、source ownership、exclusions和正文。未验证draft按完整任务hash/source/model/config保留，恢复时仍严格重新验证。针对本次长双语标签拓扑的回归、未知字段/重复更新/超限值负例通过，完整工程回归与同项目真实重试继续进行。

### 与Gamma页数比较的合同边界

用户原有两份Factor Zoo Gamma参考都是10页、13.333×7.5in，不能假设它们是无限高度卡片。实际提取显示正文主要为英文，中文多用于标题和短标签：第一份共11,321字符、433个汉字；第二份共11,139字符、335个汉字（仅提取PowerPoint原生文字，不代表图片内公式已完整统计）。本轮配置却是source/both双语正文，须分别保留成对内容，所以不能用10与24的页数比直接判内容效率；也不能为追Gamma页数而静默把正文改成单语言。应分别比较核心题目覆盖、每页任务独立性、表达冗余和真实可读密度。当前初稿仍存在理论过重与末页堆积，不能用双语差异替这些问题辩护。

### 24页后续失败与分层修复

第二轮大scope容量回复把79条来源标excluded，但实际出现空占位页，且核心审查要求恢复Carhart/FF5等内容；未通过，不计作精炼成功。恢复delta重复使用b_0107给译文，第二次泛化schema修正仍重复，触发有界停止。最终界面保留的是之前的合法草稿，四页仍阻断：p2 12.406/5.536in、p5 7.733/5.728in、p13 6.247/5.728in、p24 26.279/4.908in。writer未启动，正式导出未运行。

据此追加的不是放宽门禁：一是给重复ID及完整语言对精确诊断；二是防止旧有效稿的最后metadata检查点删除较新pending局部修复；三是把超高普通表先拆为独立cell condensation任务、行列与owner冻结；四是compact allocator消费真实逐页负载，并在多页失败时先有界修正分配，减少一次完整复制一百多条正文的修复请求。对应领域正反回归已通过，最新完整工程回归与同项目3143真实UI“AI重新组织”续跑中。未验收前不提交。

### 两项语义门禁的职责纠正及真实新增发现

旧summary review误把“原段全部核心事实等价”当成综述摘要合同，包括漂亮的修辞、未断言的可选实现细节；而core review只处理有整条excluded的组，未检查其余已摘要来源。现在faithfulness只要求每个可见断言及其必要条件忠实，完整组coverage则检查每个压缩组（即使0 excluded）有无丢掉核心意义，版本3缓存作废旧coverage结论。不是用代码字数或关键词代替语义验收。新增负例确认已可见summary ID也可被独立core审查判缺失，原错误条件/数量及整个主题省略仍拒绝。

真实新轮已从只审核含excluded的两个组，扩展到全部6个压缩组，马上发现过去漏检的问题：评分卡省了Momentum/Quality/Low volatility；taxonomy省了Value/Quality/Investment/Sentiment。返回b_0179/b_0184的具体缺失后，正常rowIndices及summaryRows定向修复恢复这些比较成员，再做独立单元格与完整组复核。最新完整工程测试`/tmp/ppt-factor-all-faithfulness-coverage.log`为3026通过、1既有跳过、0失败。真实整稿仍在验收，未产出正式PPTX。

### 九步流程的可读容量修复：减少编号独占行

基于真实b_0214/b_0215、14pt、相同正文宽度的只读POC：英文流程3.238in→2.487in，中文2.687in→1.711in。步骤数量、原文、顺序和字体未改，差异来自将结构序号置于步骤正文行首，减少独占标题行。共享processCardPlan实测stacked/inline与列数后选择可读方案，原有stacked仍可用；不以font缩小或文字截断换容量。数学rich runs及原item.text保留，重渲染不重复编号。v20同步影响估算、绑定、RenderTree、预览与原生导出，旧v19缓存不复用。

`/tmp/ppt-process-inline-native.log`的实际原生PPTX/PDF glyph verification通过，含不变原文/字号/9步、数学源和缓存隔离/极小框仍失败回归。首次独立运行因系统Python缺pptx模块失败，改用已加载的bundled Python依赖后通过，未改依赖安装或全局Python。完整npm v20和生产构建/3143再验收继续进行，不能把此独立短流程当作整份Factor Zoo验收。

### 2026-10-21追加：真实局部取舍与恢复路径

取舍独立调用实际提出了跨页重复表b_0154/b_0224相互替代，也试图把只有一个原子owner的页清空。现任务schema不再提供无法合法省略的最后owner/完整语言对；仍对组合省略做非空检查。单个有界取舍提案结构失败会保留该窗口原稿、记录具体错误，其他独立有效提案继续审核；网络错误不伪装为有效空提案。对应唯一owner、原子对、非法ID、原稿不变及传输错误回归通过。

真实complete-source reviewer正确发现术语表缺少Factor定义，实际恢复该行；另把reader自动生成的“closing summary”描述视为强制重印全部年代回顾表。这与overview允许省略可选历史和已解释重复总结冲突。审查上下文v4将readingQuestion/readingSummary标为descriptive metadata，仅作为阅读组织，不能新增用户展示义务；唯一结论、模型机制、比较成员、条件及显式must继续保护。更新缓存版本，旧判定不能冒充新审查。

恢复已有草稿时resumeLocalCapacity跳过global规划，原本也跳过了独立tableCellCapacityTasks；coverage恢复Factor行后更高的术语表又被直接送进大scope。共享该步骤，初稿、恢复及取舍后按当前正文/任务hash有界调用单元格精炼，再做局部页面规划。单元格可见文字须真实Qwen改写，选定行列、数字、条件、owner和N均不变，独立cell及native geometry门禁未关闭。

工程回归`/tmp/ppt-factor-all-reduction-isolated.log`：3026通过、1既有跳过、0失败。该次完整回归在最新v4审查/共享table步骤写入前启动，不能作为最后两处变更的最终全量验证；领域回归已通过，最终全量仍待补跑。本节仍不代表整稿通过，writer尚未开始。

### 2026-10-21追加：减小修复粒度与复核精度

多窗口实际回复仍原样复制不少summaryText，说明只允许语义摘要的schema不足以保证模型实际精炼。新增body-only小任务：仅修改已选的指定summaryText，提供完整原段/当前可见摘要/实际used与available/软写作长度；每批最多12个ID，双语原子闭包、所有owner、N、行列、公式和图不变。没有代码截字，回复仍经断言忠实性和完整组核心覆盖。任务显式消费原文算术冲突，不能把原文27当作已核实事实；保留原文不代表在新正文中独立背书。

六个完整组基于同一不可变候选，可复用现有boundedAll按最多3组并行，保持全部原文/全局可见正文、缓存身份和严格schema；全部调用settle后才返回聚合缺口或原始typed错误。

实际v4 reviewer仍曾将“前文模型均已解释，但没有集中重复年份”判为核心缺失；另一次发现CAPM可检验预测确实缺失。对此不能统一忽略，也不能把所有负判都恢复成全文：有效negative增加一次独立precision review，完整原组/整个实际可见稿/原negative均在场，区分真正缺主要机制/必要限定与可选历史/已有实质解释的重复。保留原判及最终复核证据，缓存v5；畸形复核无法转accept，确定性必显、来源、owner和geometry检查不变。相关正反领域回归已通过，真实v5续跑及最终全量工程验收待完成。

### 原评审方案与实现对应（发布验收仍独立）

| 原方案 | 本轮Code / Prompt落点 | 必须保留的验收边界 |
|---|---|---|
| P0-1取舍/归属分离 | editorial-contract/planner/allocation/selection、outline compile/selection；所有可见ID显式唯一owner，ledger全读但不全印；原61→168拓扑负例 | 原始来源不可变，拒绝无owner/借用/重复；不自动塞最近页 |
| P0-2语义摘要 | 清洁v2语义summaryText/summaryGraph分支；章节选择、body-only精炼；断言忠实与全组core coverage分工 | 否定/条件/数字/比较成员有实际可见表达；有字段不等于通过 |
| P0-3真实容量与唯一N | actual frozen binding测量；单元格/正文/owner小任务；恢复路径共享表格检查；原生流程inline编号v20 | 不靠另一代码推荐N、截字、缩至不可读、备注或fallback假装媒体通过 |
| P0-4状态与恢复UI | acceptance拆schema/ownership/semantic/physical/confirmable；任务URL恢复同一wizard和读取/模板/模型/详细度/页数/警告 | 有草稿≠可确认；真实button和writer/正式export均受硬门禁 |
| P1-1关系媒体 | source types纠正、source graph逐字引用、typed obligation placement、64资源限制与实际fit分离、required媒体实际representationFulfilled | 不发明收益/股价，不把并行模型画成因果升级；plain table不能假冒被要求的relation图 |
| P1-2模板视觉 | 描述型cover角色、原生accent #cc5500证据、分析cache v2、自包含Roboto预览、render contract20缓存隔离 | 实际原模板8页均已LibreOffice独立渲染并逐页查看；最终输出还必须另验 |
| P1-3观测与真实fixture | wire schema兼容、精确metadata/source delta、分批缓存、局部失败保留、负判precision review、完整组≤3并行；真实owner/table负例fixtures | 最小探针不能代替全流程；保留真实network失败和重试；不报告未知账户金额 |

原模板原生8页核对结果：浅色建筑图与留白、橙色chain/六卡/三条带/比较图表/四指标/三阶段引用/四步路线图分别存在；它不是每页固定正文框都相同的纯文字模板。已有原生35%、30%/20%/15%/60%等为模板样例数据，最终Factor Zoo文件不得把它们当成来源事实。最终需检查未替换样例文案/数据、所有页面字体、原生对象及实际office渲染，不能仅比较缩略图。

### 2026-10-21最新完整流程（仍在验收）

新项目`8ff80c5b356dc9c2409171ee4a41dab1`：同一input/template SHA，实际slides副本/qwen3.8-max。首次读取的中文证据把原文直引号写成弯引号，metadata两次仅挪start/end，严格逐字校验失败；没有模糊匹配或自动改引号。补充逐证据diagnostics后，同一项目再次完整阅读成功，41,415 UTF-16、182/182、complete_delivery；本次reader建议**12（10–14）**，与老b106的14（12–16）是不同真实reading，不混写。测试者通过实际UI明确选24，保持原建议12，不以代码替换。证据`final-ui-20261021/verified-reading.json`、原始模型回复、02b截图。

来源级indispensability review实际移除了“术语表已说明anomaly模型相对性，却仍强制再显示b_0017/18”的冗余派生关系；公式需要变量解释等真实关系保留。原reader合同和逐字触发证据都保存，不改变N或原文；压缩后的实际可见内容仍接受source/core检查。

新24页初稿：182条选择中22 slides、158 summary、2 excluded，150 summaryText、3 summaryGraph。前18页偏理论，后三页混合过多实践任务；不是合格终稿。此前chapter curator用“已有summaryText”跳过，这不等于真实已取舍。改成逐来源curation回执后，21个真实章节批次已完成；变更输入/策略/N/正文会使对应回执失效，纯owner重排不重复。当前候选对原文27增加了归因及2×3×3算术不一致说明；不是静默改原件。

generic selection恢复评分卡选中行时旧summaryRows没有失效，导致表形不符并在初稿有界修复耗尽后停止。已修复辅助投影的生命周期：改选行时撤销旧cell投影，使用选定原行，随后再独立精炼；同样行选择保留有效投影，slides不残留summaryRows。原图/表未删行、owner/N未改。

只读当前候选测量（2026-10-21T05:44:54Z）仍有9页失败，尤其p22 15.58/5.73in、p23 16.35/5.73in、p24 15.68/4.91in。此为writer前测量，不是导出裁切截图。真实紧凑allocation已启动，必须修正这些任务分配；不发布该初稿。

最新完整工程回归`/tmp/ppt-factor-all-v9-curation-receipts.log`：3026通过、1既有跳过、0失败。此前v8同样通过。原模板8页native逐页查看完成；最终Factor Zoo正式PPTX/PDF及其逐页Office渲染仍未产生，未提交。

### 环境故障单独归因

2026-10-21T04:36Z出现真实ENOSPC，测试客户端和backend退出，孤立Next frontend仍监听3143，API返回503 fetch failed。确认launcher PID已退出、frontend cwd属于本工作树后仅停止该孤立frontend，清理本轮旧build/dev/release缓存约6.7GB及当前构建可重建webpack cache约2.1GB，保留运行server chunks、输入、模板、全部状态和模型响应。生产recoverPptJobs实际恢复outlining检查点；旧run随后命中真实task attempt cap，未提高限额。修复table audit按projection hash区分候选版本，避免不同候选误计为同一请求的第6次重试。3141没有停止、重启或改动。

### 2026-10-21追加：选择权限、恢复取舍及测试客户端

- Prompt中的whole-object选择权限与ifSelected完整性规则分层。可省整对象不因mandatoryRowIndices/comparisonSet等变为必显；独立完整来源核心覆盖继续判断模型/方法/必要条件是否实际缺失。
- 唯一整表locator可重新取舍，真实partial/repeat/code范围不可。范围快照以任务所涉ID为界，支持并行批次而不误删其他新分片。新增真实恢复拓扑、过期范围和多owner负例。
- 删除容量阶段同时重印全局page+summary ledger的大回复，保留compact allocation，随后用body-only/table-only及有界页面窗口修复；N仍唯一由reader建议和用户明确选择决定。
- v9真实请求在table-cell audit超时，保留检查点；v10客户端遇到瞬时503曾退出并关闭承担desktop worker的页面。测试客户端现在对502/503/504最多4次读重试，全部记录；后端失败状态仍立即失败。恢复无outline的outlining任务也先等待同一任务，而不误等input_ready。此修复属于验收脚本，不是把网关错误替换为成功。
- `/tmp/ppt-factor-all-v10-prompt-selection.log` 3026通过、1既有跳过、0失败。整表恢复改动后再次全量执行中，正式成稿和逐页验收仍未完成，未commit。


### 2026-10-21 v13/v14收尾与用户要求暂停完整workflow

v13同24页重试最终因双语可见/排除不一致的selection delta失败；只对独立核心审查指出的恢复成员做语言对闭包，schema同时要求两侧。最后有效草稿仍有实际容量阻断，writer未开始。

v14真实页数复评的原始记录：`1792567207359-input-page-reassess-e043224bd1b58cac.json` recommended28（26–30）、章节合计33、reason1781字符；`1792567247641-input-page-reassess-e043224bd1b58cac-contract.json` recommended24（22–26）、合计28、reason1456字符。均被422拒绝，原阅读12及用户24保持，没有采用新N。

本轮补齐metadata-only纠错：冻结章节名/目的/取舍，模型只修sectionPageCounts、推荐/范围及理由；代码检查合计但不代算推荐。提供已选投影表和实际owner/范围的独立测量，排除的表不计入必显；坏测量明确unavailable。task key含实际prompt hash，晚到回复校验来源/模板/策略/N/候选/用户要求和页面意图，最多两次请求。

本轮独立API fixture通过；完整npm测试3027通过、1既有跳过、0失败，`/tmp/ppt-factor-closeout-20261021.log`。上一轮完整Chrome smoke确认99通过，`/tmp/ppt-factor-smoke-v14.log`；v14生产构建已通过。这些都不证明真实成稿完成。收尾身份校验追加后最终回归见新方案第10节的最新记录。

用户本轮要求先讨论并确认新架构，因此没有真实LLM调用、没有完整workflow、没有重新加载3143、没有改动3141、没有commit。新方案：[轻大纲、唯一内容模式与容量展开](ppt-outline-first-depth-capacity-plan-20261021.md)。
