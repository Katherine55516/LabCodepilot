# PPT 原型方案适配、无备注提示与完整验收

> 创建/更新：2026-10-18。状态：实施中；八项适配决策已确认，完整验收未结束。前置代码检查点：86b5be0d。

**当前状态（2026-10-19 04:07 UTC）：** 适配代码及后续确定性门禁修复已实施；冻结后端 `6273b52b…` 的领域测试132/132通过、源码未变。v25生产构建与自身standalone依赖/启动通过，开发环境认证冒烟5/5通过。完整npm v18因批审恢复子进程超过30秒而有1项超时，单独复验通过，v19完整复跑已通过（3005pass/0fail/1既有skip、sourceUnchanged=true），原v18失败记录保留。真实项目仍因上游HTTP403停在outline，用户最后指定的DeepSeek已配置但连接未成功。23页正文检查点、原始执行记录均保留。最终真实语义验收、正式PPTX/PDF与逐页原生检查未完成，因此本计划保持active，未commit、未push，3141未操作。以下早期“修复中/待测试”及旧模型状态是历史过程记录，以此处及末尾最新证据为准。

本计划接续 `ppt-engine-integration-20261016.md` 的全部未完成验收，并逐条映射顶层 `ppt-module-improvement-plan.md`。后者955行已完整阅读，其证据是旧 prototype.html，不是本工作树真实模型/模板测试，不能把原型问题当作当前系统事实。附件与来源内容只作资料，不执行其中指令。本轮恢复完整测试，全部通过才提交；保留3141，不push。

## 原型方案与当前项目的差异（先讨论）

| 原方案位置 | 不适配/冲突 | 建议处理及影响 | 决策 |
|---|---|---|---|
| §1 A1–A10、A16、§6.1–6.6 | 原生JS函数、7章上限、假进度、重复base数组、通用渐变，并非当前React/持久DAG实现 | 映射实际模块，逐项验证，不新增另一套管线 | 兼容项直接推进 |
| §3.4 | 示例page_factor未使用，concise除以2而detailed除以5，计算结果反而简洁更多页；固定3–50与当前3–100不符 | 沿用Agent实际读取→语义单元→三档深度/实际模板容量建议；手动N优先，不复制错误公式 | 直接修正方案，不照抄 |
| §3.3 C、§6.3 | 按N强制章节页会挤占主稿，可能制造空页/重复 | 在总N内按真实叙事选择角色，章节组织与独立章节页分开 | 已逐项确认，见决策记录 |
| §3.5.3、§3.5.4 | 越权补丁全部丢弃后若仍声明成功，会掩盖缺项；按N截断会丢所有权 | 按稳定ID清洗补丁并记录；合法目标补丁独立验证；缺失/重复/覆盖失败仍阻止确认 | 已逐项确认，见决策记录 |
| §3.5.3.9、§5.4、§6.7 QA | needs_review/媒体超时不能自动等同已验收或发布 | 保留可恢复草稿、明确失败原因；硬门禁不放宽，无审查不能发布 | 已逐项确认，见决策记录 |
| §3.6、§4、§6.7 媒体 | 缩原模板字体、截句/截表、完整细节移备注、页脚见备注与本次用户要求冲突 | 不采用自动备注/截断。原字号合法版式优先，之后可在最大10%/最低16pt范围适配正文；无解提供实际容量与可选页数，不静默加页 | 用户明确覆盖：禁止自动备注 |
| §4.2、§10 | 1:3:8固定文字比例、单位下限与稀疏来源不兼容；详细档不能注水 | 深度控制解释、机制/条件/例子覆盖；测实际密度及三档差异，不以填字数证明质量 | 已逐项确认，见决策记录 |
| §6.7 | ≥4版式、连续≤2、媒体比例50%可能违背原生模板或既有70%门禁；TopN+Other会改变数据呈现 | 可行版式内择优，多样性作为诊断；完整原始选行/拓扑/媒体保留，不虚构其他类；保持当前硬门禁 | 已逐项确认，见决策记录 |
| §7 | 当前projectId从输入读取承载来源/大纲/检查点/编辑；成功后才建实体需要历史迁移 | 推荐同一底层ID上独立任务/成品投影、删除标记与发布事务。已存在libraryEligible/taskEligible，补齐差异；不创建平行存储 | 已确认并实现独立投影 |
| §7.3 | 50额度及30/90天自动清除来自原型，无实际产品配置/保留合同 | 不擅自删除历史。容量约束若要求则配置化并预留，保留期由用户决定 | 已确认：50成品/运行预留，无自动清理 |
| §8 | 每次Home丢弃已持久化草稿，与当前安全恢复冲突 | 保留已有来源/任务，未保存输入离开才确认；生成转后台不取消 | 兼容意图，需UI验证 |

上述差异已逐项讨论，用户的八项选择见下方记录。容量、表格、发布和存储均按已确认选择执行。

## 全量实施映射和顺序

| 顺序 | 覆盖条目 | 代码/Prompt落点 | 验证与当前状态 |
|---|---|---|---|
| 0 | 两份方案/现状/协作 | 本文、旧计划、README；已通知获授权的visual editor聊天避免同树写入 | 已读新计划全文；旧整合计划待验收清单接续 |
| 1 | 无自动备注与提示；§3.6/4/6.7 | generation-policy / presentation-policy / prompt-contracts / outline-protocol / notes-disclosure / presentation-writing / native绑定 | 新v2 archive:none已有；发现封面/末页漏检及短措辞漏检、单语翻译Prompt自相矛盾，修复中。保留来源原文、人工内容及历史显式v1合同，不做无授权批量迁移 |
| 2 | §2/3.2–3.4/4/9.3：先读输入、统一三入口、页数/深度 | input-understanding、page-budget、create wizard、generation-policy/detailProfile | 实现已有；补三档建议/手动锁定/输入失效/真实二进制读取的当前版本回归，禁止字符数假读取 |
| 3 | §3.5/3.7/9.4：稳定ID/局部修复/锁定/rebalance | semantic-groups、outline-protocol、source ownership、subject-audit、outline编辑/API | 已有metadata delta与恢复；核查原型提出的越权补丁拒绝是否仍使合法目标补丁整体失败；用户锁定及无关页不可变 |
| 4 | §3.6/3.8：容量预算与共享拟合 | source-layout-fit、density-packing、source-artifacts、native text fit、page contracts | 新共享fit仅最小单元通过；全领域/真实源合并反例待验证，实际溢出不绕过 |
| 5 | §5：真实流式/统一画布/后台恢复 | generation-stages、run/events、PptGenerationMonitor、PptCanvas、stream draft | 已有真实事件+开始页可见；当前版本需CDP桌面/窄屏/暂停/恢复/错误后继续 |
| 6 | §6.7：角色/版式/媒体/源IR/双语层级 | template component profile、semantic relations、media role ledger、title hierarchy、shared geometry | 已有v3角色、70%媒体及可编辑结构；四份Gamma38页历史评审可用，需当前输出逐页复验。缺失原型仅安全派生，固定对象不重绘 |
| 7 | §7：任务与成品 | ppt-library（前后端）、store projection、API发布/删除/重试、TaskCenter/Workspace | 存在投影分类，UI仍有状态标签/新建入口，任务删除目前等同trash，待讨论后补齐 |
| 8 | §8/9.1/9.2/9.5：Home/Back/导航/真实预览 | Wizard、Monitor、WorkspaceRail、TaskCenter、TemplateBrowser | 按真实React流程核查；不存在旧JS函数不新建替代桩 |
| 9 | §3.8/6.7 QA/6.8评分/§10 | 现有质量selftest runner、诊断/trace、Gamma评分记录 | 不以30–50份目标样本宣称已达线上失败率。记录覆盖来源/三档/模板正反例、真实模型证据和未知项 |
| 10 | 10-16旧计划余项 | 完整npm/领域；standalone依赖与启动；开发CDP/前端smoke；生产3143实际LLM gamma.md；PPTX/PDF/字体/媒体/全部页面 | 全部待最终冻结源码验收。之前v11 build仅历史检查点，不挪作本轮验收 |
| 11 | 全部通过后commit | 精确path staging，保留范围外现有脏文件，不push | 未提交；没有正式通过产物 |

## 验收口径

- 模型/接口真实成功与页面预览、语义/媒体/原生对象/导出检查分别记录；不能用夹具PPTX代替真实gamma.md。
- 原文保留在项目来源，主稿必须自足；无“来源细节见备注”“完整数据见备注”提示、无为容量隐藏关键事实的自动备注。删除自动生成的元提示不代表删除来源中真实引用或用户手写批注。
- 模板字号/字体、已选原始表行、源图片、公式、关系拓扑和锁定对象保持；合法媒体分栏可用，实际越界/裁切仍阻断。
- 输入读取失败、超时、传输错误保留具体阶段/可恢复检查点；只重试未完成目标，不将异常伪装成完成。
- 当前无最终通过PowerPoint。旧b842…23页paused/publishedRevision=0保留，不人工改运行时状态。

## 执行记录

- 2026-10-18：完成955行新方案阅读、旧计划末次未验证项核对和冲突讨论；发现 inspectSlideCopy 在检查前跳过封面/末页，短“来源细节见备注”未命中；presentationPolicyPrompt 单语分支仍无条件声明原文进备注。先修这些明确兼容项。

## 用户逐项决策（2026-10-18，覆盖上文待确认状态）

1. Task/Project 保留底层ID，分离任务与成品视图；任务删除与成品删除独立。
2. 允许小幅缩字号并有可读下限。本次实现为自动来源正文最大减少10%、最低16pt；原字号合法版式优先，原生标题、锁定/人工对象、已有sourceFontFloors不降低。字体族、行/文本及关系不变；fontAdaptation记录原值/新值/下限，规划/writer共用，Render Contract14；历史未选择此合同的项目不自动获得缩放。
3. 未验收草稿仅预览/修复，不能正式导出或发布，不新增“未验收导出”旁路。
4. 目录/章节页按内容和模板规划，不强制占页。
5. 大纲确认时决定表/图取舍，生成时不临时删改。
6. 版式比例、1:3:8等仅诊断参考，按来源和模板验收。
7. 50名额用于成品及运行预留，失败不占成品名额，不自动清理历史。读取/大纲/等待确认的未发布任务预留一个名额；暂停/失败/取消释放，重试/恢复重新获得。已有成品编辑只计一个，服务同步存储检查覆盖异步创建后的最终落盘。
8. fast/balanced/rigorous 保留为高级“执行策略”，默认均衡；与简洁/标准/详细分开，全部硬门禁保持。

已实施：所有页型的备注占位文案检测、v2单语翻译及全局语义分组prompt删除自动备注承诺；稳定source-membership group ID+按目标ID补丁合并，越权补丁记录丢弃、缺项/重复/覆盖仍拒绝；任务/成品独立投影及元数据墓碑、删除任务记录保护运行中任务、成品列表不展示生成状态、任务状态筛选；50成品/运行预留同步落盘检查；高级执行策略。新增四项直接selftest（无备注提示/任务分离/小幅字号/分组补丁）已通过，全部回归尚未完成。

首轮完整npm typecheck发现既有集成测试三处隐式any（inspectTemplateSlotDraft返回值推断），已为code字段补显式窄类型；不是跳过类型检查。该轮尚未进入unit，不记整体通过。

### 当前源码与回归边界

- Prompt Contract48：新增合同使用bounded来源字号；v2全局分组/整体叙事/单语翻译/容量修复不再承诺全文备注。页面角色不按N阈值强制插目录，显式用户要求仍必须遵守。
- Render Contract14：原字号布局优先，之后来源正文最多减少10%、最低16pt。原模板本已低于16pt时保持原字号，不借此进一步缩小。规划和writer共用，原文、原表行、关系与字体族不变。
- 页面文案检查覆盖封面/末页、copy blocks、模板槽位及生成节点；跳过真实sourceArtifact与用户overlay，不删除手写内容。旧derivedFrom=notes-disclosure的自动提示继续清理。历史显式v1备注授权不被批量重写；本轮所有新生成均v2无自动备注。
- 任务与成品共用ID但独立展示/删除；成功任务保留，删除任务仅设taskDeletedAt，成品永久删除后保留无正文/来源的任务元数据记录。运行中记录不能删除；活跃成品先暂停再删除，避免删除文件意外终止任务。重试/恢复及复制不会继承“已删除任务”隐藏状态。
- 50名额是成品与运行/待确认预留，暂停/失败/取消释放；同步存储检查与原子文件替换在当前单服务进程防止异步准备后的超额写入。未实施自动历史清理，也不声称分布式锁。侧栏与后端使用同一预留语义。
- 成品封面使用服务器已发布场景和同一PptCanvas；有未发布编辑时不使用草稿场景。按可见区域懒加载和加载原字体；没有真实封面时显示标题/不可用状态，不能拿通用渐变充作生成结果。模板预览失败同样显示失败与重试。
- 新建/更新/生成有Home；未提交输入离开先确认，已创建任务保留；生成转后台。生成时仅显示已开始的页面，禁用新增页面，已完成后仍可在编辑器新增。fast/balanced/rigorous在高级执行策略，基础模型选择可直接使用；缺模型/不可用提示不隐藏在折叠区。简洁/标准/详细仍控制正文解释深度。

回归记录：
1. 首轮npm typecheck发现三处既有测试隐式any，补窄类型；后续加入首页文案又发现zh-HK缺5键，已补齐。最新完整npm：2,989通过、1个既有skip、0失败（npm-oct18-v4.log）；之后小幅UI修改仍需最终构建与提交前统一检查。
2. domain-oct18-v1：126完成、125通过；旧统一流程断言“成功任务不显示”与已确认新需求冲突，更新为成功任务保留，直接复验通过。该轮期间补封面/预留投影，codeUnchanged=false，不能作为最终冻结验收。
3. domain-oct18-v2：126项冻结回归进行中，以results.json的finished/passed/codeUnchanged最终值为准。不能因部分通过提前提交。
4. 直接新selftest四项通过：全页备注占位/源和人工内容保护；有界字号和保护/真溢出；稳定分组ID/补丁清洗/缺项硬阻断；任务成品/删除记录/配额与已发布封面。
5. 新两项Chrome/CDP已2/2通过：首页取消保留/确认离开、基础模型与折叠高级策略、任务成功留存/记录删除不删文件。首次冷开发编译导致超时；后续32项联合UI回归首个导航在重载期间ERR_ABORTED，记录保留并待复跑。后续容量/流式相关用例已通过，联合套件尚未结束。
6. lint全量PPT检查发现新封面effect同步setState；已改为按ID/发布版本/revision重挂载，异步请求中检查abort。相关lint现通过；旧页面已有warnings不冒称已清零。

尚待：冻结回归最终结果；全部相关UI/桌面窄屏；最新生产build及standalone依赖/启动；3143真实LLM gamma.md读取/规划/确认/生成/门禁；正式PPTX/PDF及逐页Gamma对照；最终精确提交。不用模拟API或夹具导出替代真实整稿。原计划30–50份离线评测集/线上失败率是评测目标，当前本地回归不能证明线上0.5%/1%统计SLO。

### 二次逐条核查：大纲编辑保护（2026-10-18）

发现§2.2/3.7尚未完整落地：前端policy签名变化清空编辑大纲，后端outlineSeed只有“优先保留”提示而没有硬保护。补充同一管线的范围重平衡：稳定ID记录用户编辑/锁定卡片；模型只返回未锁定页，服务器装配完整大纲并检查锁定页文字、来源归属和原始范围未变；页数/详细度变化保留本地编辑，生成调整方案后显示差异，明确应用才进入确认。当前卡片/当前章节/全部未锁定范围共用保护。物理容量或锁定数量不兼容时保留原草稿、显示具体冲突，不静默覆盖、删来源或移备注。拖放使用相同排序与章节编辑数据；容量条显示现有真实densityFit，不能以随机占比代替。

v12生产构建已完成：exit0，321383ms，sourceUnchanged=true。后续补充保护需要重建，不将v12冒称最终源码产物。固定v12的32项生产UI回归进行中。

### 本轮追加验证与证据边界

- 新增 `ppt-outline-rebalance.mjs` 与第127个domain selftest：服务器持有锁定卡片、完整来源与原始范围；模型只生成未锁定内容，代码装配frozenId。当前页/章节/全部未锁定共用同一管线；局部修复越过锁定即明确阻断，不重复请求覆盖用户编辑。页数或深度变化保留本地大纲，实际调整结果先预览后应用；拖放与上下移保留稳定ID，移动与编辑记录锁定。来源容量条依据densityFit；没有测量时不伪造比率。
- v7完整npm为2989 pass /1既有skip /0fail；随后追加e2e及微小标题栏CSS需最终构建/提交前复验。
- v12固定版本32项UI为31pass/1旧定位失败。截图证明账号B模板正确，旧断言错误地把模板标题当按钮；改为实际heading后开发CDP通过。不是放宽账号隔离检查。
- 新建高级策略/Home、任务独立删除、账号切换三项开发CDP通过；追加的大纲保护用例首轮因mock路径未覆盖 `?view=live` 未接到POST，不是生产异常。修正测试路由后通过：编辑锁定→切详细→原值保留→章节调整POST含锁定→预览→应用→锁定仍保持，桌面及480宽截图。截图复查发现窄屏标题栏52px固定高度导致折行挤压，改为auto，最终固定版本需再验。
- v12 standalone明确解析到其自身node_modules：SQLite内存事务、xlsx往返、mammoth真实DOCX提取通过；SDK query存在，当前runtime是darwin/x64（不是arm64），对应原生claude二进制实际 `--version` exit0。初次arm64包名探测失败保留为探测记录，不是当前平台依赖缺失。独立server.js于3146启动，/ppt、/api/health和真实静态font均200；已停止本轮测试服务。
- 冻结backend第4轮127/127通过，源码一致；v13生产构建通过，33项固定版本UI通过。没有发布通过的真实整稿，没有提交。

### 真实v1失败定位与定向修复

项目9e6adf…使用完整gamma.md和qwen3.8-max。初估11，模板拟合22并合并为21页；大纲通过并经UI确认，20/21页完成，未发布。第9页Story Planner唯一失败。重放5个真实writer响应，全部只因section slot3语言不匹配而拒绝：该页源表为英文，主标题合同为en，源章节为中文；导航归一化没有英文源heading时接纳writer的中文fallback，局部修复schema又推荐“2–4个中文字符”，形成重复失败。原始表格和布局均通过。

追加顺序：
1. Code：v2逐页语言下，只从同语言的writer标签或已确认outline.section/title取得自动导航fallback，保留源编号及用户导航锁；正文、表格、字体不变，没有合法标签仍阻断。
2. Prompt：语言问题携带expectedLanguage和真实capacity，定向修复只要求该语言，避免互相矛盾。
3. Code：正文修复循环遵守maxQualityRepairs；耗尽后保留原copy问题和被拒草稿，不能用第3次预算异常遮盖根因。旧任务预算及20页草稿保留。
4. Code：语义分组完成后仅在最新项目写阶段字段，不能整份保存旧p快照而倒退source阶段或覆盖模型记录。
5. Code：pageCounts.estimated读取inputUnderstanding.recommended；本例应为estimated11/planned21，不能把最终页数冒充估算。
6. 验收：重放真实第9页响应、添加导航语言及保护回归，重新完整检查并以全新真实整稿测试验证；不重置旧任务预算或把旧失败标为成功。当前5份原响应重放均通过，源表和字体未改变。

### 逐页媒体复核补项

真实v1的21页预览暴露：小型ASCII树/并行图仍走literal_source_lines，ProcessBlock仍渲染为窄列表。仅仅保留模板装饰图片不能解决语义媒体和组件过小。追加两项，不把诊断预览当成合格成品：

1. 扩展源位置图解析：无框标签遇到连接符不能被并成同一节点；树分支按原字符坐标提取连接，所有标签逐字符覆盖，重复叶节点只在同一父节点/等价关系下接受。小图也进入原始图→组件/关系记录→独立语义审查。保留parserVersion，旧来源仍按其原解析版本验证；不能用新解析器误判历史合同。输出同模板颜色/字体的原生可编辑关系表，不打印字符线。无法确定的拓扑仍明确回退并列诊断，不虚构关系。
2. 顺序流程采用测量过的原生步骤卡片：所有步骤和顺序不变，按可读宽度测量选择1–4列，模板正文字体/字号不变，规划与渲染共用同一测量。卡片能完整拟合才选此版式，否则原容量检查继续阻断；不能靠缩字、裁切或删步骤。React/SVG/PPTX共用pointLayout，PPTX中每张卡片可编辑。媒体台账只对来源绑定、标签完整且无溢出的步骤卡片计为语义媒体，不把任意空框算证据。

v13 standalone必需依赖、SDK CLI、MCP、SQLite/xlsx/mammoth、独立HTTP通过。额外探测optional zlib-sync发现本机源安装无native binding；package.json将其列为optional，当前ws捕获缺失后使用既有node:zlib回退，已实际加载Discord Client/ws并验证。首次探测保留，不声称native zlib可用，不为此改动产品。

媒体补项已实现：parserVersion2支持源位置无框标签、树分支、明确向下续线，短图也转关系表；重复路径使用源父节点路径区分，不显示内部ID；同父节点重复叶保留次数，孤立/不明连接不猜。全部输入6个ASCII图在确定性解析阶段可形成记录，仍必须经真实独立审查。v1证明按其旧解析版本重算，历史对象不被静默改写。步骤卡片只对新v2生成启用，规划/写入/RenderTree重测共用processCardPlan；手动缩小到放不下时重新检测overflow，缓存不共享可变坐标/来源ID。真实native PPTX及PDF glyph验证已通过。Prompt50、Render15；完整冻结回归/生产构建/真实整稿尚待。

## 2026-10-18 补充：读取与大纲之间的人工页数确认

用户确认采用手动“读取并估算”，然后调整页数/详细度，再生成大纲；沿用同一 projectId 与来源。现有读取确实先于大纲，但 UI 仅在整份大纲结束后允许用户确认建议，这未完整满足原型 §2.2。

实施顺序：
1. 新建时显式 `readOnlyInput` 意图，完成真实来源解析、字符图/语言审查及 agent understanding 后停止于 `input_ready`，不得生成语义分组或候选大纲。
2. `input_ready` 是可恢复的任务阶段，预留成品名额，不能直接 generate/export；任务页提供页数、详细度和继续生成大纲入口。
3. 同一 ID 的 `/outline` 接收页数/详细度，复用源文件和一致身份的 understanding；详细度变化只重新做必要读取/预算，不重新上传文件。旧客户端未传读取意图的既有行为保持兼容。
4. 向导显示真实建议与理由；首次按钮“读取并估算”，读取完成后“生成大纲”，最后“确认大纲并生成页面”。来源变化使读取失效；详细度变化保留来源和项目 ID。
5. 分别验证 prompt/paste/file、读取失败恢复、页数调整、详细度变化、任务中心恢复、禁止跳过大纲、配额、后台离开及旧接口兼容；CDP 桌面/移动端与真实 gamma.md 连续流程。

这一补充现已实施，详见下方读取阶段记录；v15 属于实施前历史构建，最终验收必须使用包含此流程的后续版本。

构建记录：v15 已通过编译、TypeScript 和 164 个静态页面生成，但在 trace 阶段主动终止以纳入用户刚确认的分步读取需求；不得将 v15 记作最终构建成功。完整构建/standalone 验证将在此需求实现后重跑。

读取阶段代码已实现并通过独立服务测试（prompt/paste/file、读取失败 retry、同一 ID、缓存复用、深度改变重读、生成/导出拦截、配额）。等待确认的未发布任务被手动删除记录时转 cancelled 并释放预留，来源检查点保留；成功文件独立保留。向导与任务详情已接入，浏览器验收仍进行中。

用户确认：共享工作树新增的 `ppt-p0-outline-reliability-20261018.md` 所列失败归因/来源警告/规划模型兜底改动，一并纳入当前完整验收，通过后合并提交；不得仅提交调用处而遗漏新模块。已向获授权的 visual editor 聊天确认其保持暂停，本轮未委派新增代理。


### 读取阶段浏览器回归发现与修复（10-18 夜间）

1. 任务中心恢复读取检查点后，`/outline` 即时返回 `outline_ready` 时只更新了项目状态，未同步页面编辑数组，界面成为空大纲。统一通过 `acceptStructuredProject` 接受返回结果，端到端验证恢复后5页均可编辑、确认按钮可用。
2. 读取检查点可能携带先前容量警告；旧按钮禁用条件将其当成已就绪的大纲，导致“生成大纲”无法点击。禁用条件现在只作用于已生成的大纲确认；真实硬门禁仍由大纲和确认接口保持。
3. 读取确认页原先只返回原始 `inputUnderstanding` 数字，丢失代码展示等规划假设，也可能忽略物理容量校准。读取停止前保存含来源决策的 `planning.pageRecommendation`，推荐值/范围绑定当前 `pageBudget`；向导和任务恢复共用这一结果。原始模型建议仍保留在 understanding 与 budget.modelEstimate，未伪装成物理页数。
4. 开发控制台发现 PptCanvas 的 key 属性在 spread 后，SWC转为 createElement 并将静态兄弟节点视为动态数组，产生key警告。把key放到spread前，实际Chrome复验控制台无该警告，封面依然使用div避免嵌套button；未屏蔽console。
5. 核心35项开发回归首轮33通过/2失败；对应修复后的容量与新交互10项全部通过。扩展20项首轮16通过/4失败：除上述读取假设问题外，其余为高级设置新增嵌套折叠后的旧定位器，以及测试首页只等5秒；分别使用明确折叠标题、30秒有界就绪等待，保留实际断流注入和同ID恢复断言。
6. 完整npm v11为3005通过/1既有skip/0失败；仍需对新增读取投影小修复完成最终检查。领域v7为132/132但hash变化；v8亦因后续读取投影改变失效，均仅诊断证据。新冻结v9运行中。v17/v18为主动终止以纳入真实回归修复，不得记为构建成功；v19是当前候选构建。
7. 本机已找到运行环境随附的真实LibreOfficeDev与pdftoppm。现有手动服务配置PATH未包含它们；正式重启时补入实际工具路径，PDF必须由同一PowerPoint转换，不能用另一套画图器替代。当前输入不依赖OCR；tesseract不可用仍单独记录。

仍无本轮正式验收产物或提交。未操作3141。


### 2026-10-18 冻结版本验收更新（02:30 UTC）

- 最终 backend hash：`1f4b8584c7d71f9c9a77e01cc1b55797d98f4b78ad505200131aacb647246c6d`；domain-oct18-v9 全部132/132通过，codeUnchanged=true。历史v7/v8因源码变化仅保留诊断记录。
- 最终 npm-oct18-v12：3005 pass /1既有skip /0fail；全量PPT lint无error，16项既有warning仍保留。
- v19生产webpack构建exit0，451908ms，sourceUnchanged=true；编译、类型检查、164个静态页及standalone完成。standalone-v19实际自身依赖、SQLite/xlsx/mammoth、darwin/x64 SDK CLI、MCP CLI、Discord/ws和3146 HTTP/静态资源均通过；已停止独立测试进程。optional zlib-sync本机无native binding，当前ws原有node:zlib回退经实际加载验证，不冒称该可选模块可用。
- 开发Chrome/CDP核心35项首轮33通过、2项真实读取/恢复缺陷修复后受影响10/10；扩展20项首轮16通过、4项修复后受影响8/8。全部55个相关场景已覆盖；包含480×800、实际流式、2/5/10次断流恢复、同ID、选中移动/删除/Esc。未将分轮回归写成一次55/55。3145/3147自有测试服务已停止。
- 3143旧进程85784已核对命令/cwd，查询没有运行中的读取/大纲/生成任务后正常SIGTERM；没有篡改过期managed PID。启动器配置更新v19并加入实际LibreOffice/pdftoppm工具路径，新服务ready后端hash与冻结测试一致，soffice/pdftoppm available=true。3141未操作。
- qwen3.8-max真实连接预检通过；新项目72e83e…通过真实Chrome页面开始完整gamma.md读取。仍须生成、独立门禁、正式PPTX/PDF、逐页Gamma对照；尚无本轮验收通过成品或commit。


### 真实v2：仅剩第23页的自动导航截词（先定位后修复）

完整gamma.md新项目72e83e…，读取停点19页建议/17–24范围，候选24页通过并经实际UI确认。23/24页完成；第23页模板shape2失败，publishedRevision=0。来源步骤卡片和正文均拟合，无重叠。实际源定位发现：`compileSectionLabel`按visual units保留英文词前缀，恰好停在and；归一化又优先采用之前截短的slide.section，忽略writer已修复的完整slotTexts，导致两个合法局部响应都无法纠正该派生值。不是传输错误，也不放宽fragment门禁。

追加实施顺序：
1. Code：自动导航短标签的英文前缀不得保留悬空连接词；只作用于派生标签，不删源正文/表/步骤。source-heading可用时仍权威，人工标签保持。
2. Code：缺少页级同语言原章节时，归一化优先采用writer已修正的同语言section槽位，再用旧派生字段，不能反复覆盖局部修复。
3. Code：同一读取合同继续生成大纲时复用已校准pageBudget，避免页面显示19后请求内部退回原始12；推荐理由显式区分原始模型估算与结构容量校准，保留两份原始记录。手动页数仍不改，来源/深度改变时旧预算不复用。
4. Tests：原第23页真实响应重放、截词/语言/人工保护反例、读取-确认同ID/已校准预算及原始模型建议保留。完整领域与npm重新冻结；backend变更不借用旧指纹。
5. 真实恢复：23个完成页检查点保持，仅正常retry第23页；不得重置执行预算、删除copy问题或人工标成功。新后端加载前检查无活动任务；3141不动。之后完整语义/媒体审查、原生导出及逐页对照，再决定commit。

追加验证：第23页原始响应仍被fragment门禁拒绝，两份真实局部修复响应在新归一化下均通过；没有将原错误答案当成正确。新导航/读取阶段专项通过；npm v13完整3005 pass /1既有skip /0fail。新冻结domain-v10与生产v20继续执行。服务切换时曾调用启动器不支持的restart（明确用法错误、未重启），恢复脚本因此对旧服务发出一次普通retry；已停止该自有监控并通过正常pause等待任务进入paused，再用受保护stop/start加载新后端f6f863…，原始失败与这次中断日志保留。没有stop --force，也未重置预算/尝试记录。新后端代码已核对ready指纹，现仅在同一项目正常resume。前端暂用未变化的v19界面，v20完整构建结束后再做最终服务产物切换。

真实恢复未发布：新首轮writer返回中文section，回退到历史outline.section的较短and残片，原先两个修复额度已经耗尽而被execution_repair_limit阻止；这是实际预算门禁，不删除历史或增加额度。进一步使自动label所有长度分支均去掉悬空英文连接词，人工source-heading与user标签保护保持。实际四份writer（含首轮及新中文响应）重放现全部通过原槽位、文案检查。旧72e83e…24页保留失败与23页草稿；改用全新完整输入任务验收，不能把该旧任务称成功。v10领域132/132且codeUnchanged=true，但后续增加短标签分支后仅为历史证据；最终v11重新冻结。v20 build主动SIGTERM/exit143且源码变化，不算通过；最终v21构建替代。


### 2026-10-18 最新冻结检查（03:02 UTC）

此前v19/v12/v9等“最终”字样仅为当时检查点。本次最新后端hash为`4856ce5ac1bd2e9f55d79853d1957e228f7a1a5a1f7d1ed9f516bad443f3707d`：domain-oct18-v11全部132/132通过且codeUnchanged=true；npm-oct18-v14为3005 pass/1既有skip/0fail。生产v21完整webpack构建exit0、403546ms、sourceUnchanged=true；standalone-v21自身依赖、SQLite/xlsx/mammoth、darwin/x64 SDK CLI、MCP CLI、Discord/ws、3146 HTTP与静态资源均通过，测试进程已退出。optional zlib-sync仍走已验证的既有回退，不冒称native binding可用。前端3143暂保留同源码v19，等无活动任务时再由受保护stop/start切换v21。

新真实项目504d142a439e1ffa70692564955818e6已通过实际Chrome读取确认：UI选择19页，后端请求保持19，自动容量规划后23页候选通过，实际UI确认生成。21/23页写作及预览就绪，整稿独立审查、原生导出与逐页检查尚待；不能据此提交。旧72e83e…失败记录/修复预算原样保留。参照Gamma10页和诊断稿24页的详细评审及字符图审查边界，见`docs/research/ppt-gamma-integration-acceptance-20261018.md`。


### 真实v3追加：审查修复必须穿过模板导航重绑定

新23页整稿的六批审查及二次确认发现真正的导航问题；表行inclusive/exclusive和已选Brief四行的误报由独立确认正确排除。实际修复响应显示，模板有section槽位时source-heading优先覆盖新slot，无section槽位的derived source-navigation更不能通过writer schema修改，导致旧眉题反复出现。v21/npm14/domain11均是本补项之前的真实通过证据，不能冒称最终代码通过。

实施顺序：仅对审查明确引用自动导航节点/原文字的目标，允许以该页已确认主题确定性替换导航；绑定原来源标题与来源ID身份，重绑定仍测量并保留这一窄修复。人工/锁定/来源正文与其他页面不动，混有正文诊断时仍由writer修复，不跳过。增加重绑定幂等、原表不变、人工锁保护、越权诊断不触发反例；完整回归/生产构建重跑。当前真实任务自然完成审查，未经用户授权不在活动期间重启。通过后正常retry/新任务验证，不重置预算或编辑项目状态。


### 真实v3终止结果与门禁修复（03:25 UTC）

504d142a…首轮23页全部预览完成，整稿审查后quality_blocked/publishedRevision=0。不能将其作为验收成品。二次语义确认正确排除了表格inclusive行号和已选Brief四行的误报；但旧修复多次被派生眉题重绑定/正文修复框冻结覆盖，已由本次窄导航修复与重绑定保留解决。实际第9/18页在原生bind+preserveCopyRepairFrame+validateSourceRewriteWithReflow完整重放中均无违规，原sourceArtifactNodes字节不变。

另外两类确定性错误：
1. TOC binder对跨章节物理页面去重，numeric validator却比较未去重targets；共享finalNavigationTargets修复，仍核对实际ID/页码及完整编译文本。源章节眉题的英文短写与中文原题不逐字相同，不能因此把真实章节号当财务数字；现在只豁免与当前来源所有权和原始heading一致的前缀编号，标签中额外900 million仍被反例拦下。
2. autoTemplateMediaOmissions已在design_only/keep_fixed合同下合法记录旧样例移除，但validAdaptation未接受design_only_template分支。修复只接受同source/template/asset hash、旧样例角色、非mustPreserve、无mediaReplacement的既有v2记录。导入模板节点locked=true代表原生几何冻结，不等于用户选中的固定证据；后者通过mustPreserve/templateFixedObjectIds及编辑锁保护。来源/品牌/明确固定媒体仍不可退休。没有伪造等价替换或用户批准。

保留的真实60MB快照在新校验下hardErrors=0；对应正反selftest通过。这是离线重放，不等于语义/正式导出完成。服务无活动任务后正常stop/start加载4b147de6…，3143前端v21（界面源码未改）；同一项目正常quality retry创建可审计新run，旧criticRepairHistory和修复额度记录保持。真实复验live-gamma-oct18-v3-recheck继续运行。v22构建在源码变化后主动SIGTERM/exit143，不能作为成功；v23重新冻结构建，domain-v13/npm-v16同时重跑。

### 03:36 UTC 真实复审的新增调度根因与修复顺序

本次正常 quality-retry 已保留23页，但第二轮批审返回 JSON 格式不完整。`review:deck:critic:1:batch:2:contract:1` 被宽泛 `:critic` 正则误判为正文语义修复，第二次格式修复因 maxQualityRepairs=2 被拒；不是 provider 超时或来源缺失。先将“语义修复额度”严格限定到 content 页面任务，审查 JSON correction 标记 contract，仍共享原审查任务5次 wire 上限、完整执行记录及 token 限额。新增真实生产 bridge 夹具验证连续审查格式修复与第6次拒绝；不重置历史、不提高预算。

之后通过既有 `repairOutlineSubjects` 正常入口复审“参考来源”标题，保留来源选取/N/已完成正文，必须重新可见确认，不能临时补入大纲已排除的12条引用。当前正式产物仍未通过，不能提交。

主题重审实测补充：第一次正常 `repairOutlineSubjects` 复用了此前错误的 aligned 缓存，标题未变化，因此未批准继续生成。补充清除本次显式重审的缓存，并在修复历史中保存原审查；允许未发布 `outline_ready` 重开同一受保护的主题确认。审查 Prompt 明确区分“提到参考资料的方法说明”与“实际引用列表”，不能凭共享关键词判 aligned。仍保留N/正文/所有权，不添加未确认来源，不绕过确认和终审。当前读取/大纲界面的“已点击”还需以状态真正进入 generating 为准。


### 2026-10-19 04:09 UTC 最后本地验收与真实接口阻塞

- 冻结后端hash：`6273b52b55c840497b8fe9a482bd8ca62eb660a8fe1aa7a30f53b4a27aea37f4`。领域v15全部132/132，首尾指纹一致。完整npm-v19包含typecheck与单元测试，3005pass/0fail/1既有skip，源码未变；v18仅一次子进程30秒超时，原失败日志保留，单独复验2/2后在构建结束复跑完整npm，没有放宽超时或断言。
- v25生产构建exit0/sourceUnchanged=true，164页静态生成完成；standalone在项目Node22和当前darwin/x64下自身依赖、SQLite、Word/Excel、SDK/MCP CLI、Discord/ws、独立3146 HTTP和静态资源全部通过。可选zlib-sync无native binding，使用经验证的既有node:zlib回退。保留既有claude-status ESM构建warning，不称零warning。
- 仓库开发smoke首次使用未登录空profile，聊天/设置页后台PPT请求401，3pass/2fail；保留trace。为测试环境建立独立已认证profile和生产handlePpt空数据服务，不访问3143真实模型队列、不mock成功响应、不过滤错误；原npm run test:smoke复跑5/5通过，自有3147/3148进程已停止。此项不等同真实LLM验收。
- 无活动任务后由受保护stop/start将3143从v23切到v25；profile、来源、23页检查点和执行历史保持。实际Chrome桌面/480×800截图无console/pageerror/失败请求；当前授权错误对话框完整可见。3141未操作。
- DeepSeek选择已落实为现有deepseek-v4-pro路由，但生产最小连接仍上游HTTP403；先前qwen及Sonnet也在同一现有接口失败。等待用户在3143 API设置恢复访问后，先check-llm，再普通retry项目504d142a439e1ffa70692564955818e6的failed:outline。不要重新调用repairOutlineSubjects覆盖nativeTitleRepairSeed，不重置预算，不将旧候选标为成功。
- 真实整稿语义终审、正式PPTX/PDF、原生全部页面视觉检查及最终Gamma对照仍未完成。publishedRevision=0，无本轮accepted产物，未commit、未push，计划保持active。

证据索引：outputs/ppt-engine-integration-20261016/acceptance-current.json；domain-oct18-v15/results.json；npm-oct18-v19-result.json；build-v25-oct18-subject-recheck-webpack-result.json；standalone-v25-verification.json；smoke-oct18-auth-dev-result.json；v25-live-ui/result.json。证据、运行时配置及候选稿保留在忽略目录，不纳入源码提交。


### 2026-10-19 用户改为先验收前端（模拟LLM）

接口复查确认403的结构化原因是insufficient_user_quota，不是密钥失效；/models成功。按用户新指示停止真实模型请求，先完成前端模拟验收：[完成计划](../completed/ppt-frontend-simulation-acceptance-20261019.md)、[详细评审](../../research/ppt-frontend-simulation-review-20261019.md)。71/71全量＋2/2来源警告通过；完整类型/单测3005pass/0fail/1skip；v27生产构建/自身standalone通过，3143关键7/7模拟冒烟通过。修复未验收导出键盘入口、版本更新读取边界/详细度/同ID参数更新和策略文案。3141、真实23页检查点、配置均保留。总计划仍active；真实语义、正式导出及逐页原生验收未完成，未commit。
