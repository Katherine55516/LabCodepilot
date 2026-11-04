# Outline-first implementation — 2026-10-21

用户已确认研究方案，并要求依次实施、unit test通过后commit。本次交付是代码与工程回归；上一条“暂不执行完整workflow”继续有效，真实Qwen的Factor Zoo成稿验收没有恢复，也没有新增可发布成品。3141及正在运行的3143均不重启；Chrome验证使用本工作树隔离开发服务3163。

## 实施结果

| 顺序 | 落点 | 实现与验收边界 |
|---|---|---|
| 0：收尾与历史回归 | `ppt-editorial-*`、`ppt-page-reassessment.mjs`、生产坏回复fixture | 纳入此前授权的来源取舍、显式owner、表格投影、条件归属、完整来源审查、无进展停止、metadata-only复评修复；不自动补齐未分配正文，不以notes替代可见解释 |
| 1：合同与身份 | `ppt-outline-first.mjs`、`ppt-input-understanding.mjs` | 独立`planningContract.version=3`，保留generationPolicy v2；阅读/语义/容量身份分离。模式和模板变更复用已完整读取的来源，重做容量。已有确认稿、手工大纲及导入不自动迁移 |
| 2：全局轻大纲 | `semanticTask/acceptSemantic/editSemantic`、`ppt-api.mjs` | 全部原始来源按核心/可选候选分配到逻辑卡片，前后依赖、双语对、稳定ID严格校验。先全局任务后正文；公开投影仅标题、辅助标题、意图、短要点。错误可见字段只做一次定向patch，不能顺便改owner/依赖/正确正文 |
| 3：唯一模式入口 | `PptOutlineFirstPlanner.tsx`、`PptCreateWizard.tsx`、三语言i18n | 读取后查看/编辑/重排/锁定逻辑主题，大纲后一个“简洁/均衡/详细”入口；模板/模式/页数/主题变化立即撤销生成许可。恢复读取及失败项目使用同一入口；语义就绪与容量阻断采用不同提示 |
| 4：模式与物理页 | `capacityTask/acceptCapacityAllocation/materializeCapacityPlan` | 模型先给全局物理页任务，明确所属逻辑卡片、来源、媒体类型及授权范围，再最多3页并行物化选中解释包。每页读取完整相关原文、实际模板区域/字体、全局任务与语言约束。完成顺序不能改变叙事顺序 |
| 5：页数授权 | `pagePreference/assertPagePreference/planningView` | 初次模型建议不覆盖；adaptive含用户目标与上限，fixed为恰好N；代码只校验/计数。UI分别显示首次建议和已校验计划，展示变化原因、拟展示/省略来源及表格投影；不再用第二个代码推荐N替代模型 |
| 6：容量、续页与writer | `ppt-outline-continuation.mjs`、`ppt-density-capacity.mjs`、`ppt-prompt-contracts.mjs` | 每页记录真实区域/字体/布局/来源范围预算。正常原生14pt仍14pt，通用可读下限不向原生模板强加16pt；受限缩字不得越界。容量续页只改一个未锁定任务，保留已选内容、精确无重无漏表格范围、无关页ID/内容；fixed及上限不能突破 |
| 7：事务与门禁 | `ppt-api.mjs` | 页面生成时仅纯容量故障可申请有界续页，最多两次；独立语义/原生预检后在项目队列内校验revision/run/epochs并原子更新。旧回复不能覆盖新版本；确认API拒绝未经容量重规划的物理大纲修改；导出与发布原硬门禁保留 |
| 8：恢复与局部缓存 | materializations、requestRevision、capacityRevision | 每页真实prompt hash缓存，明确同页不合法owner/选择仅重试该页。取消/新规划让旧回复失效；模板分析期间的并发项目变更拒绝覆盖。模拟ENOSPC保持磁盘上原检查点，不在真实磁盘造满 |

## 数据结构适配

研究中的结构是设计草案，不新增第二套可修改事实库。实际逻辑卡片使用原始`sourceUnitIds/optionalSourceUnitIds`及`dependsOn`，实际claim、必要条件、媒体关系沿用已有source/pageContract IR与独立审查。物理计划使用`capacityPlan.pages`，最终通过预检的`actualPageIds/physicalBudgets`及后续原生页面revision；公开`measurement=projected_geometry`只表示选中投影通过预检，不声称尚未生成正文已实际渲染通过。

初估、偏好、计划、已发布页数保持不同生命周期。实际续页后的`plannedPageCount`取最新已校验页ID数量，不能仍显示最初allocation长度。不会生成备注细节占位，也不会改写输入本身的2×3×3/27矛盾。

## 测试入口和证据

以下测试不调用真实模型。模拟只位于模型/API边界，实际编译、来源、容量及发布校验没有替换成success常量。

- `npm test`：最终全量 **3039通过、0失败、1既有Linux-only跳过**（总3040）。日志`/tmp/ppt-outline-first-final-frozen.log`；本工作树提交时未触发自动hook；提交前已手动运行完整npm test（含typecheck）及lint-staged，新改断言另经ESLint检查。
- 新增`src/__tests__/unit/ppt-outline-first.test.ts`共12项，覆盖完整来源分配、缓存身份、fixed/adaptive边界、双语/顺序、并行乱序、过期容量、实际API门禁、表格续页事务、原生14pt联合容量、182来源单元/14内容主题及metadata-only修复、短prompt/full_source兼容，以及主要语言正文的合法译文映射（选择双语正文时不能借此省一侧）。
- `selftest-ppt-outline-first-api.mjs`：临时store、真实handlePpt及编译器；验证reading→semantic→capacity→确认。故意初估12/实际3，不修改初估；提前generate409、旧revision409、未验收物理修改409、transport独立归因、取消后回复不能复活、ENOSPC保留检查点。实际正向容量和确认均通过。
- Chrome/CDP：`ppt-outline-first.spec.ts`验证正常读取与失败恢复、唯一模式入口、目标/上限payload、实际3/初估12、改模式撤销确认、desktop/mobile footer可达及无console/pageerror；截图保存在忽略输出目录。
- 旧UI断言已适配“读取前不选详细度”；旧合同的恢复、手工页数、局部重排与锁定仍验证。首次全smoke有3个旧流程断言失败，修复后对应16项全部通过。
- 首次全smoke另7项非PPT页面因隔离服务未登录、非PPT fixture未拦截侧边栏PPT列表/model-jobs请求返回401；不是容量或新规划失败。未通过删除console断言或放宽鉴权来制造通过。
- 原生回归`selftest-ppt-process-cards.mjs`、`selftest-ppt-native-diagrams.mjs`、`selftest-ppt-native-range-export.mjs`通过。真实PPTX/PDF验证了九步流程、层级/卡片/指标/图表/连接线以及局部文字编辑保留原字号/颜色/超链接/下划线/段落。它们是原生组件fixture，不是本次Factor Zoo成稿。
- `git diff --check`与新文件ESLint通过。最终UI及提交hook结果在下方收尾记录补充。

## 研究fixture的映射

| 研究清单 | 本次覆盖入口 |
|---|---|
| F01–F08：封面、wire、阅读证据、transport、复评 | cover-subtitle-role / reading-evidence / reading-obligation-audit / desktop-model-worker / page-reassessment系列及本次API fixture |
| F09–F26：取舍、owner、双语、必要条件、比较、缓存 | editorial-ownership / editorial-selection / editorial-coverage / table-projection-repair / obligation-placement / source-types-resources领域测试；真实坏owner与缺行JSON回放 |
| F27–F33：全局分配、联合容量、媒体、标题 | 新182来源拓扑、乱序物化、14pt/长正文反例、精确表格续页；已有capacity/source-fit/媒体合同及上述原生组件导出测试 |
| F34–F40：模板字体、超时、重试、磁盘、状态 | native fonts/template preview既有测试、模型worker与read retry、ENOSPC临时store、计划/确认API门禁、恢复UI |
| F41–F43：公开字段、唯一模式、局部范围、原文矛盾 | metadata-only反例、新Chrome流程、已有editorial-composer/source-warning与来源完整性测试；真实语义质量仍待L5 |
| 9.5新增流程1–4 | 182单元全局分配、单模式/缓存、并行乱序、初估/目标/计划不同和授权负例 |
| 9.5新增流程5–8 | 精确续页范围、原生联合容量、独立完整源语义审查、取消/epoch/无关页保持 |
| 9.5新增流程9–10 | 双语共同归属、原生组件/标题既有检查、确认版本和发布/导出既有硬门禁；不冒充新长稿已导出 |

## 保留的验收边界

按最新用户指示，本次不执行L5真实LLM全workflow，不重启3143，不产出或声称Factor Zoo已验收。新架构在长双语输入、三档模式、Process Improvement及其他原生模板上的完整逐页成稿评审仍是后续真实测试工作；本次原生组件fixture不能替代该矩阵。旧真实失败记录保留原结论，早期“待确认/不commit”文字是历史阶段记录，以本次用户确认后的交付为准。

提交范围仅PPT相关代码/fixture/文档以及已授权纳入的上轮PPT修复；其他聊天的Dockerfile、全局layout、ChatListPanel、tsconfig、icons/assets及调试配置保持未提交。不push。

### 最终复核补修

主要语言正文策略与全局来源对必须分开：全局阅读仍共同分配双语对；逐页投影只允许既有`visibleEquivalentCandidates`验证的同页译文映射，真实`compileContentSelection`再次校验。双语正文模式拒绝同一省略reply。full_source不生成editorial selection账本，也不允许排除任何原始单元；所有来源仍有显式页归属。相关12项新增unit正反例通过。

### 提交前UI收尾

PPT专项84项运行记录`/tmp/ppt-outline-first-ppt-smoke-clean.log`：82项首次通过，2项进入复核。其中滚动恢复采用固定1500px断言，改为直接验证目标页与视口对齐、重开后仍为手动浏览页；另外一项首次等待DOM超过5秒，保持原断言复测通过。随后整个`ppt-live-follow.spec.ts` **11项全部通过**（`/tmp/ppt-outline-first-follow-final.log`），覆盖这两个失败项及相关进度/草稿/恢复回归。没有通过放宽产品门禁修复测试。

新的正常/失败恢复规划页均完成Chrome/CDP桌面1280×900和移动390×844截图检查，底部操作完整可见，唯一模式与失效状态正确，无console/pageerror。截图位于`outputs/ppt-outline-first-20261021/ppt-final-browser/ppt-outline-first-*`。最终工作树与staged whitespace检查通过；提交只包括82个PPT相关文件。3141/3143仍由原进程监听，未重载新代码。

### 继续执行：重新生成大纲的前端同步补查

本次继续按已确认的工程实施范围补查，完整真实LLM workflow仍暂缓。发现`PptOutlineFirstPlanner`原轮询仅在本地卡片为空时接受服务器卡片；已有轻大纲重新生成后，语义revision更新而UI仍保留旧卡片，下一步会提交旧ID，触发归属/版本错误。不能通过放宽后端校验解决。

修复为按已应用的semanticRevision接收完成的大纲，并单独记录本次重新生成请求：即使模型生成完全相同的revision，也用完成结果替换用户尚未保存的旧编辑；普通轮询不覆盖本地编辑。生成中继续保留上一份卡片，失败后可重试，只有成功完成后才更换。重新生成请求受理不提前清除dirty，失败后“保存并关闭”仍保存用户编辑；活动请求期间需要保存时按钮明确禁用。确认和容量硬门禁保持原样。

新增Chrome/CDP回归覆盖已有大纲打开、异步生成中保留旧稿、transport失败保留本地文字、重试完成后替换卡片，以及容量请求携带最新ID；分别验证新revision和相同revision。首次测试fixture漏设generationPolicy.version=2而进入旧界面，已修正fixture使其与实际新合同一致，没有为此修改产品路由。

最终验收：

- `npm test`包含typecheck，**3039通过、0失败、1既有Linux-only跳过**，总3040；`/tmp/ppt-outline-first-continuation-final-unit.log`。
- Chrome/CDP最终**4项全部通过**，`/tmp/ppt-outline-first-regeneration-accepted.log`。覆盖输入就绪/失败恢复、唯一模式、修改模式撤销确认、异步重新生成的新/同revision、失败后保存并关闭/重开、最新ID提交；console/pageerror为空。桌面和移动截图已检查，固定底部操作可见。
- 测试中一次失败来自全局失败提示弹窗遮挡重试按钮；fixture改为按真实交互先点击“知道了”，没有强制点击或移除遮罩来跳过流程。早期两个浏览器进程在断言完成后未正常退出，已仅清理本轮测试进程；最终运行正常exit 0，不以中断进程作为通过证据。
- 修改文件ESLint、`git diff --check`通过。仅提交本次PPT组件、回归和相关文档；其他聊天的未提交文件保持原状。

本次没有调用真实LLM、没有运行完整Factor Zoo workflow、没有重启3141/3143，不新增或声称已验收Factor Zoo成品。最新源码尚未加载到3143。
