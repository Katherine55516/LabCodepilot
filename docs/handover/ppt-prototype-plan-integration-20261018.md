# PPT 原型方案适配交接（2026-10-18，验收中）

> **最新阶段（2026-10-19）：用户要求先排查前端、LLM先模拟。** 不继续真实模型请求。重新检查确认原配置和3143接口/密钥相同，`/models`成功，实际生成返回`insufficient_user_quota`（HTTP403），旧“授权失败/请修复权限”归因不准确。前端关键流程全量71/71通过，另2项来源警告正反例通过；完整npm3005pass/0fail/1既有skip，源码首尾一致。新增修复：未验收稿导出原生disabled、版本更新手动读取边界/三档深度/同ID修改、高级策略与模板入口文案、窄屏徽标。生产v27构建和standalone通过，3143已更新且关键7/7模拟冒烟通过；真实23页稿仍未验收，不commit。详见`docs/research/ppt-frontend-simulation-review-20261019.md`和`docs/exec-plans/completed/ppt-frontend-simulation-acceptance-20261019.md`。下面早期“最新”检查点均为历史记录。

> **最新恢复点：2026-10-19 04:07 UTC。** 后端冻结hash `6273b52b55c840497b8fe9a482bd8ca62eb660a8fe1aa7a30f53b4a27aea37f4`；domain-v15=132/132且codeUnchanged=true。生产v25完整通过（1442666ms、sourceUnchanged=true），其standalone必要依赖/SQLite/Word/Excel/SDK/MCP/Discord与3146 HTTP均通过，独立进程已停止。开发认证环境smoke=5/5，首次未登录环境的401失败保留；未屏蔽console或改断言。npm-v18=3004pass/1fail/1skip，唯一失败为子进程30秒超时，其原测试单独2/2通过；v19完整复验已通过：3005pass/0fail/1既有skip，sourceUnchanged=true。3143已通过受保护stop/start切换v25，模型DeepSeek，保留原profile与全部任务；3141未动。
>
> **真实验收仍未完成：** 项目504d142a439e1ffa70692564955818e6，failed:outline / ppt_auth，publishedRevision=0；23页正文保存在nativeTitleRepairSeed。现有qwen、Sonnet与DeepSeek接口均最小连接HTTP403，已向用户请求在API设置恢复权限。恢复后先check-llm，再普通retry该失败outline，不再调用repairOutlineSubjects，不覆盖retainedNodes，不重置预算。没有正式验收PPTX/PDF，也没有commit；下方旧状态均为历史。

当前权威执行清单见[计划](../exec-plans/active/ppt-prototype-plan-integration-20261018.md)，接续10-16整合计划。基础检查点86b5be0d，本轮尚未提交。用户明确要求所有检查通过后commit，不push；保留3141。

用户逐项确认：Task/Project保留ID分离投影；允许小幅缩字号及可读下限；草稿仅预览/修复、过门禁才发布导出；目录/章节页不机械占页；表格取舍在确认大纲时决定；版式/字数比例仅诊断；50成品/运行预留、失败不占成品名额、不自动清理；执行策略放高级设置，默认均衡。

实现落点：
- `ppt-generation-policy` Contract48，新v2 sourceTypography=bounded；`ppt-density-capacity`和`ppt-source-layout-fit`共享原字号优先、最多减少10%且不低于16pt的来源正文拟合，严格测框，记录fontAdaptation；Render Contract14。原模板已更小则不缩，锁定/人工/sourceFontFloors保护保持。
- `ppt-presentation-writing`先检查所有页型的备注占位，再跳过封面/末页正文密度；覆盖copy.blocks/槽位/生成节点。`ppt-prompt-contracts`/`semantic-groups`/`global-outline-plan`/`outline-protocol`/API修复Prompt清除v2全文备注承诺，主稿需自足，项目来源保留原文。旧显式v1未批量迁移。
- `ppt-semantic-groups`稳定source-membership ID；有明确受影响组时只返回patches，服务按ID合并并记录丢弃越权项，缺目标/重复/来源覆盖/关系错误仍硬失败。未知全局shape才重返全局schema修复，元数据继续窄delta。
- `ppt-library`/`ppt-store`/`project-view`独立任务成品/配额/封面投影，`task-record DELETE`只隐藏记录；永久删除文件保留元数据墓碑。已发布封面独立cover读取，绝不将未发布草稿当封面。保存同步检查50文件/活动预留，重试/恢复重新取得名额。
- Workspace/TaskCenter/Rail展示成功任务及筛选/排序、独立删记录与回收站入口、正确配额；真实已发布封面使用PptCanvas与模板字体懒加载；清理重复顶部导航。基础LLM选择在主对话框，高级执行策略折叠；缺角色/不可用警告留在外层可见。
- Wizard/M3/GenerationMonitor有Home与未保存离开确认；后台生成保留，生成期间禁加页且只展示已开始页；真实流式/暂停/原生编辑机制保留。

直接四项新selftest已通过。最新完整npm 2989通过/1skip/0fail；之后仍有少量UI调整，最终构建与提交前检查待完成。领域v1 125/126通过且源码变化，不算最终；唯一旧成功任务断言已按新需求更新并直接复验。领域v2冻结126运行中。新Chrome/CDP 2/2通过，联合32项仍进行中，首个开发重载导航中断待复跑。全部证据在忽略目录outputs/ppt-engine-integration-20261016；不提交凭证、运行时状态或候选PPT。

3145只为本轮开发UI fixture验证，不能宣称真实LLM完成。3143/3142待最新生产构建后通过现有隔离启动器加载；launch-config目前仍指旧v5，不能据旧服务验收最新源码。旧b842…23页仍paused/publishedRevision=0；新真实gamma.md整稿、正式PPTX/PDF、逐页视觉与Gamma对照尚待。旧10-17“不再测试”已被10-18本次用户要求覆盖。

## 追加：范围重平衡与冻结验收

新增 `ppt-outline-rebalance.mjs`：按服务器已保存卡片ID绑定来源，客户端只能编辑文字/锁定状态，不能改来源引用。模型返回未锁定页和frozenId引用；代码装配原锁定卡片，重复/缺项/顺序变更/来源变更均拒绝，原草稿与backup保留。用户改详细度保留编辑；调整方案要预览并显式应用。模板/输入改变仍重新读取，不能沿用错误源合同。目录和章节不按N强制插页。第127个domain测试覆盖范围、N冲突、原始来源和用户children保护；新的CDP用例验证整个前端交互。

v12 build exit0/sourceUnchanged=true，独立standalone依赖/SQLite/xlsx/mammoth/当前darwin-x64 SDK与HTTP已验证；v13包括追加保护与窄屏标题栏，验收尚未完成。不要将v12检查等同v13或真实LLM通过。

## 2026-10-18 最新权威状态（覆盖上述历史测试/服务快照）

- 用户确认手动读取阶段：首次 `readOnlyInput:true` 创建同一底层项目，解析与真实 LLM understanding 后停于 `input_ready`；不调用 semantic groups/outline/writer。调整页数、详细度后通过 `/outline` 继续；深度变化时需重新估算，源文件复用。旧 API 未传此字段维持兼容。
- 向导：读取并估算 → 页数/详细度确认 → 生成大纲 → 确认大纲并生成页面。任务详情 `PptInputReview` 恢复等待确认的读取检查点；不能跳过大纲直接生成或导出。input_ready 预留50名额中的一个；删除等待任务记录释放预留、保留来源，成功成品独立保存。
- Prompt Contract50 / Render Contract15。小字符树/流程图采用 parserVersion2，独立图审查仍硬约束；未接受则保留完整字面源。2–24步骤可生成真实可编辑步骤卡片，按实际字宽/高度/模板字号测框，源步骤不裁剪、不重排，调整到放不下仍返回容量错误。已通过真实 PPTX/PDF 字形验证。
- v1真实gamma测试项目9e6adf…是未验收失败稿：21页中的Story Planner因英文表格页被自动写入中文章节标签失败；已修复页级语言归一和对应修复Prompt，5份原模型响应离线复验均过该项，但不能据此发布旧项目。另发现架构流程媒体重叠，新流程卡片布局已针对实际框测量，仍须新整稿确认。
- npm v9：3005 pass /1skip /0fail。后续 quota 小修及新UI测试，最终 npm v10正在运行。领域v6：129/130，旧“树图不支持”负例已改为真实审查拒绝的回退路径并单独复验通过。领域v7新增读取/P0共132项，运行期间quota小修导致hash变化，不能作为最终冻结全绿证据；最终须重跑。
- 开发CDP：旧webpack冷启动导航多次超时，记录保留；独立3147切到默认Turbopack后新“手动读取/改深度/同ID/生成大纲”实际交互已通过并有移动端截图。其余UI仍在验证。该模式不接真实模型，不能替代3143。
- 用户明确将新“大纲可靠性P0”改动纳入本轮验收并一并提交；visual editor保持暂停。当前未提交、无本轮最终accepted整稿。旧服务/launch-config/运行进程状态需最终构建后重新核对，不能沿用历史版本断言。


### 当前读取验收补项

读取检查点现在持久化容量校准后的pageRecommendation及代码等来源决策；向导与恢复页一致。恢复后空大纲、读取阶段旧容量警告挡住下一步、PptCanvas开发key警告已修复，容量+读取+恢复10项开发CDP通过（包含桌面与480×800截图，全console error收集）。核心35项的另外25项通过；扩展20项仍在补验。npm v11为3005/1skip/0fail，之后读取投影小修须提交前再验。领域v7为132/132但hash变化，v8同样失效；冻结v9和生产v19运行中。新P0一并纳入。当前服务3143由同树进程85784运行，旧managed PID文件过期，正式切换前必须核对实际进程与活动任务，不能通过重写PID文件冒认进程。真实LibreOffice工具应补进本机配置PATH后再验原生PDF。以上均不代表最终整稿已验收。


### 2026-10-18 冻结版本验收更新（02:30 UTC）

- 最终 backend hash：`1f4b8584c7d71f9c9a77e01cc1b55797d98f4b78ad505200131aacb647246c6d`；domain-oct18-v9 全部132/132通过，codeUnchanged=true。历史v7/v8因源码变化仅保留诊断记录。
- 最终 npm-oct18-v12：3005 pass /1既有skip /0fail；全量PPT lint无error，16项既有warning仍保留。
- v19生产webpack构建exit0，451908ms，sourceUnchanged=true；编译、类型检查、164个静态页及standalone完成。standalone-v19实际自身依赖、SQLite/xlsx/mammoth、darwin/x64 SDK CLI、MCP CLI、Discord/ws和3146 HTTP/静态资源均通过；已停止独立测试进程。optional zlib-sync本机无native binding，当前ws原有node:zlib回退经实际加载验证，不冒称该可选模块可用。
- 开发Chrome/CDP核心35项首轮33通过、2项真实读取/恢复缺陷修复后受影响10/10；扩展20项首轮16通过、4项修复后受影响8/8。全部55个相关场景已覆盖；包含480×800、实际流式、2/5/10次断流恢复、同ID、选中移动/删除/Esc。未将分轮回归写成一次55/55。3145/3147自有测试服务已停止。
- 3143旧进程85784已核对命令/cwd，查询没有运行中的读取/大纲/生成任务后正常SIGTERM；没有篡改过期managed PID。启动器配置更新v19并加入实际LibreOffice/pdftoppm工具路径，新服务ready后端hash与冻结测试一致，soffice/pdftoppm available=true。3141未操作。
- qwen3.8-max真实连接预检通过；新项目72e83e…通过真实Chrome页面开始完整gamma.md读取。仍须生成、独立门禁、正式PPTX/PDF、逐页Gamma对照；尚无本轮验收通过成品或commit。


### 2026-10-18 最新冻结检查（03:02 UTC）

此前v19/v12/v9等“最终”字样仅为当时检查点。本次最新后端hash为`4856ce5ac1bd2e9f55d79853d1957e228f7a1a5a1f7d1ed9f516bad443f3707d`：domain-oct18-v11全部132/132通过且codeUnchanged=true；npm-oct18-v14为3005 pass/1既有skip/0fail。生产v21完整webpack构建exit0、403546ms、sourceUnchanged=true；standalone-v21自身依赖、SQLite/xlsx/mammoth、darwin/x64 SDK CLI、MCP CLI、Discord/ws、3146 HTTP与静态资源均通过，测试进程已退出。optional zlib-sync仍走已验证的既有回退，不冒称native binding可用。前端3143暂保留同源码v19，等无活动任务时再由受保护stop/start切换v21。

新真实项目504d142a439e1ffa70692564955818e6已通过实际Chrome读取确认：UI选择19页，后端请求保持19，自动容量规划后23页候选通过，实际UI确认生成。21/23页写作及预览就绪，整稿独立审查、原生导出与逐页检查尚待；不能据此提交。旧72e83e…失败记录/修复预算原样保留。参照Gamma10页和诊断稿24页的详细评审及字符图审查边界，见`docs/research/ppt-gamma-integration-acceptance-20261018.md`。


### 真实v3终止结果与门禁修复（03:25 UTC）

504d142a…首轮23页全部预览完成，整稿审查后quality_blocked/publishedRevision=0。不能将其作为验收成品。二次语义确认正确排除了表格inclusive行号和已选Brief四行的误报；但旧修复多次被派生眉题重绑定/正文修复框冻结覆盖，已由本次窄导航修复与重绑定保留解决。实际第9/18页在原生bind+preserveCopyRepairFrame+validateSourceRewriteWithReflow完整重放中均无违规，原sourceArtifactNodes字节不变。

另外两类确定性错误：
1. TOC binder对跨章节物理页面去重，numeric validator却比较未去重targets；共享finalNavigationTargets修复，仍核对实际ID/页码及完整编译文本。源章节眉题的英文短写与中文原题不逐字相同，不能因此把真实章节号当财务数字；现在只豁免与当前来源所有权和原始heading一致的前缀编号，标签中额外900 million仍被反例拦下。
2. autoTemplateMediaOmissions已在design_only/keep_fixed合同下合法记录旧样例移除，但validAdaptation未接受design_only_template分支。修复只接受同source/template/asset hash、旧样例角色、非mustPreserve、无mediaReplacement的既有v2记录。导入模板节点locked=true代表原生几何冻结，不等于用户选中的固定证据；后者通过mustPreserve/templateFixedObjectIds及编辑锁保护。来源/品牌/明确固定媒体仍不可退休。没有伪造等价替换或用户批准。

保留的真实60MB快照在新校验下hardErrors=0；对应正反selftest通过。这是离线重放，不等于语义/正式导出完成。服务无活动任务后正常stop/start加载4b147de6…，3143前端v21（界面源码未改）；同一项目正常quality retry创建可审计新run，旧criticRepairHistory和修复额度记录保持。真实复验live-gamma-oct18-v3-recheck继续运行。v22构建在源码变化后主动SIGTERM/exit143，不能作为成功；v23重新冻结构建，domain-v13/npm-v16同时重跑。

### 2026-10-19 03:51 UTC 恢复点

当前真实项目 `504d142a439e1ffa70692564955818e6`，23页，failed:outline / ppt_auth（HTTP403），publishedRevision=0。23页正文保存在 nativeTitleRepairSeed.retainedNodes；主题重审未完成，不能当作已验收。用户最后指定DeepSeek，已通过生产 execution-policy PATCH 切换全部文本角色到隔离配置 `deepseek-v4-pro`；launcher也选此模型。主开发配置只读、3141未动。相同现有接口的qwen、两个已配置Sonnet及DeepSeek最小连接都403；已请用户在3143 API设置修复，不要在聊天发密钥。恢复后先check-llm成功，再普通retry失败outline，不要重新repairOutlineSubjects覆盖retainedNodes，不要重置预算。

最新代码 hash `6273b52b55c840497b8fe9a482bd8ca62eb660a8fe1aa7a30f53b4a27aea37f4`。新增：critic批审格式重试不再误算正文修复，仍共享5次wire；显式主题重审使旧aligned缓存失效但保留历史，支持未发布outline_ready重审；Prompt区分方法声明与引用列表。17项集成单测及生产bridge routing测试通过。冻结domain-v15/build-v25进行中；完整npm-v17=3005pass/1skip/0fail，但最终交付仍需要当前版本整稿真实验收和正式导出。

v23 standalone在项目Node22下所有必需依赖/SQLite/Word/Excel/SDK/MCP/Discord/HTTP通过。系统Node18探测导致原生SQLite ABI不匹配，属于测试运行时错误，未改原生依赖。v24源码变化后主动终止。清理仅限本轮六个废弃构建的compiler cache（v12/v13/v19/v21/v22/v24）；构建本身、trace、日志、项目、服务数据均保留；磁盘可用约22GB。无commit、无push。未通过不得移动计划到completed。


### 2026-10-19 04:09 UTC 最后本地验收与真实接口阻塞

- 冻结后端hash：`6273b52b55c840497b8fe9a482bd8ca62eb660a8fe1aa7a30f53b4a27aea37f4`。领域v15全部132/132，首尾指纹一致。完整npm-v19包含typecheck与单元测试，3005pass/0fail/1既有skip，源码未变；v18仅一次子进程30秒超时，原失败日志保留，单独复验2/2后在构建结束复跑完整npm，没有放宽超时或断言。
- v25生产构建exit0/sourceUnchanged=true，164页静态生成完成；standalone在项目Node22和当前darwin/x64下自身依赖、SQLite、Word/Excel、SDK/MCP CLI、Discord/ws、独立3146 HTTP和静态资源全部通过。可选zlib-sync无native binding，使用经验证的既有node:zlib回退。保留既有claude-status ESM构建warning，不称零warning。
- 仓库开发smoke首次使用未登录空profile，聊天/设置页后台PPT请求401，3pass/2fail；保留trace。为测试环境建立独立已认证profile和生产handlePpt空数据服务，不访问3143真实模型队列、不mock成功响应、不过滤错误；原npm run test:smoke复跑5/5通过，自有3147/3148进程已停止。此项不等同真实LLM验收。
- 无活动任务后由受保护stop/start将3143从v23切到v25；profile、来源、23页检查点和执行历史保持。实际Chrome桌面/480×800截图无console/pageerror/失败请求；当前授权错误对话框完整可见。3141未操作。
- DeepSeek选择已落实为现有deepseek-v4-pro路由，但生产最小连接仍上游HTTP403；先前qwen及Sonnet也在同一现有接口失败。等待用户在3143 API设置恢复访问后，先check-llm，再普通retry项目504d142a439e1ffa70692564955818e6的failed:outline。不要重新调用repairOutlineSubjects覆盖nativeTitleRepairSeed，不重置预算，不将旧候选标为成功。
- 真实整稿语义终审、正式PPTX/PDF、原生全部页面视觉检查及最终Gamma对照仍未完成。publishedRevision=0，无本轮accepted产物，未commit、未push，计划保持active。

证据索引：outputs/ppt-engine-integration-20261016/acceptance-current.json；domain-oct18-v15/results.json；npm-oct18-v19-result.json；build-v25-oct18-subject-recheck-webpack-result.json；standalone-v25-verification.json；smoke-oct18-auth-dev-result.json；v25-live-ui/result.json。证据、运行时配置及候选稿保留在忽略目录，不纳入源码提交。


### 2026-10-19 前端模拟阶段结束

证据见outputs/ppt-engine-integration-20261016/frontend-acceptance-oct19.json。生产3143=v27，当前backend hash d295c2f2692b6fbaea0f9f40a63cb498ba014039b9a331636985776d4a05d52d；原项目23页retainedNodes、source哈希及未发布状态保留。模拟阶段完成计划已移completed，总计划和真实验收仍active。用户最后要求LLM先simulate，不要自行再次发真实请求；额度不足的结构化分类仍待下一阶段修正，不要再把403归因密钥或权限。

构建v26为避免与浏览器竞争主动SIGTERM/143，不能称成功；v27为完整成功记录。旧Next dev类型缓存损坏文件已备份再重新生成；完整npm仍保留首次类型错误，修复测试类型后最终全绿。为减轻重复类型检查，仅归档并移除本轮15个废弃构建的types/dev/types（2769文件），完整build/runtime/static和源码保留，活动v25与当前dev类型未清理；归档为outputs/ppt-engine-integration-20261016/obsolete-generated-types-oct19.json.gz。TSC曾短暂SIGSTOP让浏览器先执行，随后SIGCONT并正常完成，记录resumed=true，无遗留暂停进程。
