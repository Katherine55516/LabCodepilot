# PPT 真实模型失败矩阵与修复方案

> 2026-10-16；状态：按用户要求提交当前实现；Factor最终整稿验收仍待续。主计划：[体验与质量路由](ppt-experience-quality-routing-20261014.md)。

## 真实失败基线

生产模块 hash `011fa4bb4f1eeaa2be860428fed54d40aa849d1e218986cd043157081c42a121`，prompt41 / rubric15。48 次真实请求流程：39 通过、9 失败。四档为旧单模型基线、快速、均衡、严谨；路由池 source_organizer/writer_fast 使用 qwen3.8-flash，其余角色 qwen3.8-max。单模型基线全部 max。没有用模拟结果替代真实模型结果。

| 案例 | 等级 | 项目 ID | 错误 |
|---|---|---|---|
| bilingual-1 | rigorous | `649ddc63238889b28ca04c50c7f96c8a` | ppt_timeout |
| technical-1 | fast | `722280037e233b3a17e1f37f60204ad7` | PPT quality gate blocked publish: Numeric value, sign, unit or attribution is unsupported by the input: 0 (attribution_unverified), 5 (value_or_sign_not_in_input). Template examples are not sources. |
| technical-1 | rigorous | `ca98a63fc3b267c935f8902918be3fec` | ppt_timeout |
| visual-1 | legacy_single_model | `fc691399ec1561ece36bd5b7c8de86af` | PPT quality gate blocked publish: Slide 2 node_0f845899158b05f57576fb13 visibly renders the source instruction 'Keep the complete table and the definition of acceptance visible.' as on-screen body text. This is an embedded generation directive from the source material, not an audience-facing factual claim about migration progress. D |
| visual-1 | balanced | `7b453fee90e3484f7412dbd262c57a3e` | PPT quality gate blocked publish: Mandatory source condition/detail was not fully verified |
| visual-1 | rigorous | `224c9ee44900d011864e67cb7e3f4e78` | PPT quality gate blocked publish: Slide title 'Cohort migration comparison (rows 1–3)' asserts the table contains only rows 1–3, but the visible table node includes all 3 data rows plus header (rowStart:1, rowEnd:4), and the mandatory obligation requires keeping the complete table. The title's range claim contradicts the actual full |
| visual-2 | rigorous | `44634fe642821e9c2be04c36a439485d` | ppt_timeout |
| template-1 | fast | `8996f44dd9c94d9ff297c3f66bf0728e` | ppt_timeout |
| template-2 | rigorous | `d90010b17ae1fa418977bcf53222c419` | PPT quality gate blocked publish: Slide 2 node_89c173aac7ec995d5edbeb2a includes the source meta-instruction 'End with an invitation for questions and a thank-you message.' as visible body text, while slide 3 actually fulfills this instruction with 'Questions & discussion.' and 'Thanks for watching!'. Presenting the directive to end |

原始日志：`outputs/ppt-experience-quality-20261014/benchmark-matrix-review-wire.log`；每项目原始快照、执行历史、源 hash 均在同目录的 `real-ui-suite/`。已完成不能与复测结果混成一个“全通过”矩阵。

## 根因、取舍和实施顺序

1. **来源范围与标题。** 内部代码区间为零起点、右侧开区间，标题却沿用内部 0–5；标题校验又信任文字中的数字。以真实 sourceArtifactRanges 为唯一范围依据，展示转换成 1–5。完整表格已验证全范围时，在确认前移除冗余 rows 定位后缀，保留完整主题；错误/部分范围不静默删除，用户锁定和已确认标题不自动变更。
2. **critic 的结构误判。** 原表有表头和 North/South/East 三行，全部可见；审核器却混淆表头计数和区间端点。提供明确的 headerRows、displayedDataRowCount、源区间及一基闭区间说明。对于精确绑定且完全可见的原文被判冲突，最多一次独立来源证据复核；保留上次评审，不由程序直接清除 finding。完整原文中的祈使句仍为材料，不升级为用户命令。复核仍有负向结论就阻止发布。
3. **按任务困难度启用推理。** 普通简单审查不统一启用思考。争议来源复核属于显式复杂子任务，仅在配置已经验证 thinkingControl 时启用；可使用 critic 的 complexPrimary。独立 POC：关闭思考仍出现误判；启用思考 3 个正例通过、1 个返回空输出，必须保留为空输出失败。篡改数值及编造验收的 2 个真实负例均被拦截。不能据此宣称稳定性或延迟已经达标。复核与原评审共享逻辑任务预算，不增加重试上限。
4. **四项超时。** bilingual-1 rigorous critic 84,132ms、template-1 fast critic 81,255ms（均 thinking disabled）；technical-1 rigorous planner 176,589ms、visual-2 rigorous planner 240,113ms（均 thinking enabled）。均 1 次 wire request。现有信息只能归因到传输/服务商请求超时，不能证明是本地算力或某个内容缺陷。保留未知用量、检查点、错误与显式恢复；不无限自动重发，不重置 5 次上限，不提高超时掩盖失败。新冻结构建同源复测，失败继续单列。
5. **Gamma 树图。** 完整/部分显式行范围使等宽树图退回普通富文本，丢缩进并缺少 processSource 字面载体。对当前所选行使用字面等宽 diagram 载体并保留 processSource，原图与部分图都按当前范围校验；篡改缩进、顺序、可见文字必须拒绝。
6. **Alpha 封面。** topic-only cover 的空正文合同漏查 subtitle/takeaway/callout。服务器与 SDK schema 一起约束；正文事实仍由其原所属页面承载，不能让封面编造结论。
7. **薄页。** 自动且未确认、未编辑的大纲中，邻接同节页面可按完整 reading unit 再分配；中英配对、引导语/列表关系、顺序、字体、源字面、所有门禁保持。候选必须提高最薄页利用率并且不新增问题；随后执行已有安全合并。已确认、人工锁定、显式范围不自动重排。38 页新布局实验未通过，弃用；采用通过隔离验证的 40 页候选逻辑。
8. **基准清理竞态。** pause 请求成功只代表进入 pausing，原脚本立即 trash 导致 Factor 未完成检查点被归档。先等待服务返回 paused 或其他实际终态，再允许归档；未能确认即停止批次并保留项目。恢复原项目，不重置历史或计费记录。

## 验收和提交门禁

- 新增正反例领域回归：范围、树图、空封面、薄页再分配、来源复核、任务预算/推理控制；跑冻结全领域、npm typecheck/unit、相关 lint。
- 重新跑同输入同模板的四档矩阵；保留所有失败，不以挑选重跑覆盖原记录。代表性重复独立统计；价格未知则标未知。
- Gamma、Alpha 原稿重新生成，Factor 原检查点恢复；完整源 hash 不变。完整成品必须经 PPTX 重开/PDF 逐页视觉审查。
- 实际浏览器验证暂停、字体、刷新持久化、恢复、导出；真实 CDP 控制，记录控制台与截图。现有 Playwright CDP 是当前可用验证工具，未声称使用缺席的 chrome-devtools MCP。
- 结果全部满足后更新主计划与交接文档，关闭本任务启动的服务，git diff 检查并 commit；不 push。

## 实施记录

- 本文先于正式接入候选修复创建；候选代码此前只在 `.codepilot/diagram-line-poc/` 隔离验证。


### 2026-10-15 第二轮根因与修订

- Factor 保留项目 `dd8826ebd8844c6f20507bdb17996b9b` 的 98 页中 97 页完成，剩余 Turnover 页耗尽五次实际请求。不是证据被遮挡：该页冻结所有权 b_0211–b_0216，相邻 b_0217 的 50 bps 算例却因共享 chunk c_055 被派为 requiredEvidenceIds。补写算例与 full_source 空附加正文合同冲突，格式修复又删除补写，形成无效循环。
- 修复：新证据原子记录 sourceUnitId；V2 显式/自动证据均服从精确单元和行/表范围，旧原子要求原文精确包含于所属单元；合法 repeatSourceUnitIds 仍可用。旧计划重试时记录前后证据归属审计。并未更改 missingRequiredEvidence 或语义评审门槛。
- 恢复仅适用于已有完整当前 run/source/revision/epoch 的 source-component 检查点，且本次有错误证据归属修订、没有人工编辑/接受/图片义务。重新绑定全部冻结原文，重新运行复制/证据/物理检查，后续整稿评审照常。五次请求及原失败保留，不加第六次请求。缺页、过期、篡改、保护页及真正缺失证据反例均阻止恢复。
- Gamma 与 Alpha 的人工标题修订在 quality_blocked 后 retry 被旧 node.slide 缓存覆盖。根因：手动命令只同步 paused/generating/failed 缓存，遗漏 completed/quality_blocked。补齐两状态，回归实际 command→retry→持久化，正文不重写。先前 QA 多改的 13 个 Gamma 标题已被这一旧缓存恢复为原英文；正确修订也被覆盖，必须在修复后重新执行明确的三处 Gamma/两处 Alpha 标题命令，不能声称自动首次成功。
- 冻结 abb76 自测为 94/111，17 项失败是测试快照漏拷 ppt-scope-test-helpers.mjs；补齐后 16/17 通过，剩余 prompt-contracts 又发现 container/cowork-shim.py 未拷。保留失败日志、补齐环境再测，不能将缺失环境运行记为成功。
- 通用 UI 对照：HEAD 六项通过；当前暖态复测交互通过但八项被 SSR 动态 AppShell 的一个不存在的 JS preload 404 阻断。正在隔离验证客户端加载修正；保留初次 64/73 和暖态 7/15 失败，不以归因替代复测。


### 当前已完成的冻结门禁

生产后端 `8740a8dff11f5446385bd9d6d1d8622deacf44ff13379bf29941cbc574971eaa`：`domain-evidence-resumed-final/results.json` 为 **112/112**，首尾 hash 相同。`npm test` **2922 pass / 0 fail / 1 skip**；TS/TSX lint **0 error / 28 warning**。UI 产品源逐文件与根目录比较一致，hash `3a783bc56fcd99f6cc9866e2f8535fe89f1eb341769596ac0d1a1c470f5662d9`；`ui-smoke-evidence-resumed.log` **73/73**。

实际浏览器项目 `4e90e0d1e251ddd582d1a7485c860075` 完成新建/生成、暂停、Arial32pt、真实刷新、恢复与导出，源码及手改保留、控制台 0 错误。PPTX `36c395365f507a7f07bb7afc0d512d4edfe3579514c6a45105f73f9e083208fe`，PDF `a534ac6251b53089ae5f39963e80eb6fb082d9e4ec4a71856c15d1f273150b17`；实际 4 页全部查看，无裁切、无内部 source ID/错误行号进入主题。原 fc16 浏览器闭环虽然操作通过，页面标题仍有 `(source b_0002, b_0004)`，因此不能作为主题验收通过；现只对未确认自动主题清除已验证归属、且非原文的内部定位信息。

来源容量修复不是缩小字体：绑定当前语义标题预留，代码自动换行使用与 Office 一致的单词边界及等宽字宽；旧 render contract5 的未编辑代码缓存可在6重验几何。当前标题容量回归包含真实 PPTX/PDF 和字形验证，18pt 源代码保持；已接受/手改页不自动重排。

格式修复调用不再被计为语义质量修复轮次；所有 wire request 仍共享五次上限。第一次语义升级先用强 writer 的 primary，下一轮才到 fallback。相关真实队列预算/路由回归已随112项通过；不增加总调用上限。

额外生产构建检查暴露既有命令不匹配：Next16默认Turbopack，仓库有webpack配置。默认 `npm run build` 被拒绝，失败日志保留；正在验证与 Electron 构建一致的 `--webpack`，验证后才决定统一默认脚本。当前完整真实矩阵与 Gamma/Factor 成品仍未收尾，尚不 commit。


## 2026-10-16：完整第二轮真实矩阵与最终修订

冻结后端 `8740a8df…` / prompt43 / rubric16：84 次，76 通过、8 失败。首次48次为42通过/6失败；独立重复36次为34通过/2失败。没有把后续恢复算作首次成功。实际模型池：source_organizer/writer_fast 为 qwen3.8-flash，planner/standard/reasoning/critic 为 qwen3.8-max；legacy 全部 qwen3.8-max。

| 等级 | 总次数 | 通过 | 失败 |
|---|---:|---:|---:|
| legacy_single_model | 21 | 19 | 2 |
| fast | 21 | 19 | 2 |
| balanced | 21 | 20 | 1 |
| rigorous | 21 | 18 | 3 |

| 输入 / 等级 / 重复 | 项目 | 原始结果 |
|---|---|---|
| bilingual-3 / fast / 1 | `41f441cca5cc24412c3c901701a6fd76` | PPT quality gate blocked publish: 第4页标题中“翻译对是一项主张的两个显示成本”的“显示成本”在来源中无对应事实依据，且遗漏了该节关于“中文作为讲解主要语言，英文保留术语和补充案例”的核心双语关系。 |
| visual-1 / balanced / 1 | `14d665a2fbd0196c844a816bcd23b482` | PPT quality gate blocked publish: Title asserts 'Cohort Migration Comparison' but the source text explicitly states 'Fixture observations; status and acceptance are distinct.' The visible content describes fixture observation status, not a migration comparison |
| technical-2 / fast / 1 | `b87f34ac9c83f70cf28b7ff453f4fac0` | PPT quality gate blocked publish: The slide title 'Arithmetic scoring example' frames the page as solely an example, but the visible body includes fixture assumptions (b_0002) and validation rules (b_0006) that are not part of the worked example. The title mis |
| technical-2 / rigorous / 1 | `ff3eff5370189745c41a94ed9341053b` | ppt_timeout |
| visual-1 / legacy_single_model / 1 | `e2d865f72e6f7992be37f4b3f77ea76b` | PPT quality gate blocked publish: The slide title 'Fixture Status Definitions' asserts that the page defines fixture statuses, but the visible body only distinguishes status from acceptance and defines 'Accepted'. No definition of 'Pending' or other fixture st |
| template-2 / legacy_single_model / 1 | `4ca26e59047a1535d82441590e1f16b5` | PPT quality gate blocked publish: Slide 2 displays the source material literally including 'End with an invitation for questions and a thank-you message.' as part of the training brief text. Slide 3 then executes this instruction by displaying 'Questions & dis |
| template-2 / rigorous / 1 | `bdaca4de238e47db92401004c691594b` | PPT quality gate blocked publish: Source heading 'Learning activities' (span [219,238]) is omitted from visible content. Under full_source contract, all specified source structure including headings must be retained. |
| technical-2 / rigorous / 1 | `ea6e73a7c2b71cd07b0d19f3cd01e523` | ppt_timeout |

已核对 76 份实际 PPTX（ZIP/XML/python-pptx 重开）及 373 页实际导出 PDF，106 张联系表逐页查看；未使用 PowerPoint 桌面应用。逐页视觉结果保存在两个 `matrix-current-*` 下的 `review-wire-matrix/*/visual-review-result.json`。旧矩阵并不证明后续代码 hash；少数目录同页排序、非结束页标题带 thank-you 的编辑问题另行保留。

根因与改进顺序：

1. **规划控制元数据进入主题**：将语言配对策略与观众材料分开；只对明确内部标识/内部断言组合阻断，不误伤原文真有的“成本/证据”等概念。prompt44；未确认自动标题才可自动清理，人工和确认标题受保护。新建同源 bilingual-3 fast 已成功，保留旧负例。
2. **评审上下文膨胀**：98 页来源实例被每批和全局重复内联。批次只展开实际所属/跨页伴随单元，全局用实际 quoteId 引用已经完整提供的组件；完整不可变来源始终保留。测量首批 524715→233579 bytes，全局 901576→613947 bytes。没有截掉来源或提高超时掩盖问题。
3. **精确正文与标题语义不能混同**：全量可见正文的标题争议允许一次独立来源复核；明确 titleVerified=false，正文可见不证明标题成立。虚构结论和真正缺失仍拦截，原评审/计费/五次 wire 预算不清空。visual legacy 的过度标题复核仍失败，明确手改为来源支持的主题后成功。
4. **手改标题仍被 critic writer 恢复**：此前只修 node.slide 缓存不够，confirmed outline.title 仍是旧值。显式命令同步当前有效标题、冻结 hash、copy 和缓存；原确认及每次更改保留审计。用 titleEditBaseline 避免无关页手改使另一页提案整体失效，同页冲突检查仍有效。
5. **PPTX 坐标小数**：DrawingML 坐标必须整数，仅序列化时量化 EMU；不改来源或编辑 IR，回归真实导出重开。
6. **图示原始分支丢失**：长 ASCII 图转表格使用规范摘要，摘要会漏条件/箭头。可见单元格改为原始逐行（含空行、缩进、分支），按精确行范围分页。旧已编辑 40 页稿不能自动覆盖：17 行原图+既有正文在18pt不适配时必须继续阻止，不能删分支/缩字体冒充成功。新建同源48页稿正在完整实测。
7. **表格严格阈值丢失（本轮实测新发现）**：单元格 `> 0.05` 被块级 Markdown 当引用，投影和旧完整性 key 一起丢了 `>`。隔离 POC 将表格单元格统一为 inline 解析，缓存区分 block/inline，版本化旧 rich 内容；完整性按 inline 原值核对，增加丢符号反例及实际 PPTX。普通段落的引用/列表合同保留。接入前先等当前运行终态，防止测试混 hash。
8. **保留长稿的真实邻接/题目问题**：98页原确认规划存在预处理步骤范围跨错页、基本法公式与 TC 解释隔页。按原文做明确编辑，保留来源与原确认历史；不删除审核 finding。表格真实错误需修渲染根因后再审。

最终冻结 `ee06526d…` 的领域回归为115/116；唯一旧断言预期图示摘要，按“原始行不能被摘要替代”更新后单项导出与负例重测通过。完整117项将在表格 inline 修复接入后重跑。`npm test` 在该冻结版本为2922 pass/0 fail/1 skip。默认生产 `npm run build --webpack` 全量构建通过164个静态页面；早先默认Turbopack失败日志保留，统一脚本与Electron现有webpack路线。

QA 环境错误也保留：初次把失败矩阵项目搬到隔离复验服务时，其 providerId 不在该服务 profile，产生 ppt_transport。复制已有加密 provider 行到隔离 profile 后才复测，未改原矩阵；不把此环境故障归因产品模型。严谨档重复的来源同一规划超时仍保留，显式重试不突破原尝试预算。


### 组合居中根因与修订（2026-10-16）

Gamma48页在68fe最终被物理门禁阻止：一张表格和两段说明分成两栏，`fitComponents`把每个右栏段落独立垂直居中，导致两个段落重叠。新方案：横向范围相交的组件组成同一栏/堆叠组，对组统一平移，保留组内相对位置和间距；跨栏全宽组件会把相关堆叠连成一组，避免表格与下方两栏说明相交。来源、字号、列宽不因此删改。隔离POC通过，新增真实形态的三组件回归；同时ASCII表格完整性逐字检查可见缩进，不能通过空白归一化丢分支层级。

b267 / render9 / rubric20已接入，118项冻结回归在运行。实际Gamma通过显式标题与两条几何命令应用修复，正文及18pt完全不变；修正后确定性error为0，再启动有审计的新质量评审run。68fe失败和全部尝试保留。


### 公式表示一致性（2026-10-16）

Factor98页在68fe被最后一条确定性检查阻止，源b_0152与可见节点的完整TeX、MathML均一致；启发式function-call检测却提取raw `sum_t (IC_t - \overline{IC})`，仅与展平后的Unicode来源比较，造成误报。现在先按相同raw表示精确核对，再保留已有display对display路径。没有删除公式检查或结构账本；改减号为加号的反例在启发式和原生数学结构两处均失败。最终5986280c…冻结领域回归119/119，首尾hash一致；prompt44/rubric20/render9/display7。Factor原不可变输入与98页继续正常最终验收。

Gamma48页已完成真实模型审核及PPTX/PDF导出并逐页查看：最终5986280c重新导出的PPTX SHA256仍为0e0042081bde52b636a6013f150fe27490c7f26899ed9a446c56fb8ce1facbc1，PDF仍为799d0e5f2e526ab9b334324607c787c54f8413d67e6f01d422ffd0978e0b3e27，与b267已阅文件完全相同。第25页No→render/Yes完整，第26页原段落重叠消除，保留18pt及正文。长ASCII图采用完整原始行分页，框线跨页及部分完整来源短页的留白明确记录为表现限制，不宣称已变成紧凑原生语义图。


### 四档真实对照的耗时与用量口径（2026-10-16）

以下取自同一8740a8df冻结代码的84份项目快照（12个独立输入，代表性输入追加重复）。耗时为createdAt至updatedAt，包含生成、审核和失败，按档位汇总；不同来源/页数混合，不能当成单页性能、稳定p95或模型因果收益。原始汇总为`outputs/ppt-experience-quality-20261014/matrix-current-metrics-summary.json`。

| 档位 | 完成/总数 | 耗时中位秒 | 范围秒 | 已回传input tokens | 已回传output tokens | 用量覆盖 |
|---|---:|---:|---:|---:|---:|---|
| legacy_single_model | 19/21 | 59.0 | 39.9–203.1 | 1,126,330 | 49,917 | 137条modelUsage；旧单模型没有新executionHistory记录 |
| fast | 19/21 | 95.8 | 33.6–226.6 | 1,121,631 | 69,078 | 136条已知modelUsage |
| balanced | 20/21 | 82.8 | 41.4–169.8 | 1,080,786 | 51,492 | 131条已知modelUsage |
| rigorous | 18/21 | 109.0 | 42.1–393.0 | 1,020,328 | 95,161 | 118条已知＋2条未知modelUsage |

这些token是提供方已回传记录之和，不是全部实际计费。传输失败、重试、孤立请求可能没有usage；即使该档modelUsage未知数为0，也不能证明没有未回传费用。价格未可靠取得，成本保持unknown。没有承诺固定降本比例；快速档本批并未更快，严谨档也未显示更高完成率，不能以增加调用宣传质量收益。默认保持均衡，简单写作走fast角色，复杂页/修复与critic按能力升级；复杂度门槛、路由原因、预算和真实调用可审计。后续跨提供方调参须同源配对并重复验证，不能据这批小样本强制所有页走昂贵模型。


### 八个原始失败项目的实际恢复结果

以下均保持各自输入hash，实际导出且所有PDF页已查看。它们是失败后的恢复，不修改84次原始完成率，也不等于最终598代码完整重跑84次。小稿的恢复代码为128…/784…/ee065…等对应冻结版本，完整hash保存在各目录result.json；源码后续回归119/119另列。

| 原项目 | 恢复方式 | 实际页数 | 本地证据（outputs/ppt-experience-quality-20261014/live/） |
|---|---|---:|---|
| 41f441cca5cc24412c3c901701a6fd76 | 显式来源标题修订；另建同源新稿d62f6294…通过8页 | 7 | bilingual-reviewed-title-result；fresh-bilingual-policy-result |
| 14d665a2fbd0196c844a816bcd23b482 | 有界重试及来源复核 | 3 | mapped-final-recovery-visual-1-balanced |
| ff3eff5370189745c41a94ed9341053b | 原任务剩余预算重试 | 5 | mapped-final-recovery-technical-2-rigorous |
| e2d865f72e6f7992be37f4b3f77ea76b | 独立复核仍拒绝过度主题；显式改为Acceptance and Pending Entries | 3 | visual-reviewed-title-result |
| 4ca26e59047a1535d82441590e1f16b5 | 有界复核，区分来源内指令与用户指令 | 3 | mapped-final-recovery-template-2-legacy-single-model |
| bdaca4de238e47db92401004c691594b | 有界来源实文复核 | 3 | mapped-final-recovery-template-2-rigorous |
| b87f34ac9c83f70cf28b7ff453f4fac0 | 有界复核与原项目恢复 | 4 | repeat-source-title-final-fast |
| ea6e73a7c2b71cd07b0d19f3cd01e523 | 首次恢复再超时保留；剩余预算下一次重试成功 | 4 | repeat-source-title-final-rigorous-transport-retry |


## 2026-10-16 用户要求先提交当前改动：验收检查点

本次按用户“先commit当前所有改动”提交已实现的内容；提交不代表尚未结束的整稿验收通过。最终生产模块hash为`5986280cd54ecbabc18f50d4a160af8e53db194796285fd496370d808afade6c`，prompt44/rubric20/render9/display7。

- 最终冻结领域回归119/119，首尾源码hash一致；`npm test`为2922通过、0失败、1跳过。完整默认webpack构建164静态页面通过（构建时68fe前端，之后仅后端MJS修复）。TS/TSX lint 0错误、28警告。
- 实际UI产品hash3a783bc5…/后端8740a8df…：73/73 PPT CDP、15/15通用冒烟，真实4页创建/暂停/Arial32/重新加载/恢复/导出闭环通过。未把旧后端UI证据冒称最终598后端全组复测。
- 原冻结真实矩阵84次中76通过、8失败；76份PPTX重开、373页PDF全部查看。8个失败项目后来恢复并逐页查看，包含2项显式标题修订；不改写首次完成率，不宣称最终598完整重跑84次。分档耗时/token/未知费用及所有失败记录见真实失败复盘。
- Gamma新同源48页真实模型审核、导出及全部逐页检查通过；最终598重新导出与已检查文件字节一致。PPTX SHA256 `0e0042081bde52b636a6013f150fe27490c7f26899ed9a446c56fb8ce1facbc1`，PDF `799d0e5f2e526ab9b334324607c787c54f8413d67e6f01d422ffd0978e0b3e27`。原始ASCII分支与18pt保留，第26页重叠修复；大型ASCII图跨页框线及稀薄来源页留白属于已记录表现限制。
- **Factor98页尚未完成最终整稿验收**：项目`dd8826ebd8844c6f20507bdb17996b9b`，原始输入hash `e10c84c46777d2cac50b8eb3d8a10a4c03a01ce63098e7edc49ea7f239de68c0`保持。按用户本次提交优先指令，在`quality:slide_71fa6d4e638a4d354efc7d60`正常暂停；全部页面已生成，但最后critic修复/复核、正式导出和98页实际视觉检查未结束，不能计为通过。检查点保存在`outputs/ppt-experience-quality-20261014/live-staged/factor-formula-representation-final/commit-checkpoint.json`。后续应从同一任务检查点恢复，不重建输入、清历史或重置尝试预算。
- 本任务3166/3168测试服务在保存检查点后关闭；其他任务实例未改动。用户3141页面若来自其他目录，不会因本工作树commit自动更新。未执行push、merge、发版或重启其他实例。

完整证据保存在本地忽略目录`outputs/ppt-experience-quality-20261014/`；代表性实际截图已随交接文档入库。托管视觉/生图真实凭证、Windows/PowerPoint桌面打开等未验证范围见技术债务，不能计为已完成。计划继续留在active，待Factor及明确的外部验收边界处理后再关闭。
