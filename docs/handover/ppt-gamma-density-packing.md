# PPT：Gamma 密度校准、自动页数与组合页面

> 初版 2026-10-06；交接核对修复更新 2026-10-07。实施依据：[密度与页数调研](../research/ppt-gamma-density-page-estimation-review-20261006.md)。本地代码与模拟链路验收完成；真实模型质量尚未验收。

## 结果与边界

原来的主章节逐个取整、每章至少一页和固定封面/结尾预留，已从丰富来源的估算路径移除。来源按预计展示负载给出初估；自动大纲允许不同于初估的页数，代码对候选页面执行有界组合和容量检查后形成 syllabus。用户明确数量、手调数量、手改大纲或确认生成后，保持数量约束。

这不是把所有主题改为 Gamma 样例的10页。Gamma 的同一问题组织方式和密度分布作为共同参照，来源完整性、语言、字号和空间约束优先。没有改变“方式 → LLM → 模板 → 输入/要求 → syllabus → 生成 → 编辑/发布”的产品步骤，没有修改 prototype.html，没有增加依赖或成本模型。

## 文件与职责

| 文件 | 职责 |
|---|---|
| `apps/cowork-server/lib/ppt-density-profile.mjs` | 冻结 `gamma-reference-v1`、参考文件 SHA、密度/组合模式、共享提示词、auto 判断 |
| `ppt-density-capacity.mjs` | 来源结构与解释文字共用的区域、字形宽度、行数、表格列/行权重和自然高度预测 |
| `ppt-density-packing.mjs` | 来源展示负载初估、候选组、outline 合并、真实库存 ID 和表格分片范围验证、预拟合 |
| `ppt-density-qa.mjs` | 可见内容宽度单位/字符、低密度率、相关页可行合并建议 |
| `ppt-planning.mjs` / `ppt-content-depth.mjs` | 丰富输入统一路径；标准/详细进入估算；规划版本8与实际容量预算 |
| `ppt-api.mjs` | auto/explicit 边界、解析后校准、动态大纲、既有一次有界修订、确认后冻结 |
| `ppt-prompt-contracts.mjs` / `ppt-quality.mjs` | 规划/写作/评审密度契约4；完整机制与关系；不以短句长度或章节拆页 |
| `ppt-source-artifacts.mjs` | 源表/公式/流程/清单与 `sourceCommentary` 共用实际区域；容量不足不截断 |
| `ppt-content-inventory.mjs` / `ppt-content-qa.mjs` | 库存级 ownership、实际拟合结果、结构覆盖与密度指标接入原有门禁 |
| `ppt-visible-content.mjs` / `ppt-evidence.mjs` / `ppt/versioning.mjs` | 共享可见节点判定；实际解释文字进入证据/critic；可见性变动使旧评审失效 |
| `ppt/render-tree.mjs`、`ppt/import-pptx.mjs`、`ppt-render.mjs`、`ppt/exporters/preview.mjs` | 原生与通用导出保留解释文字，表格字号/权重/表头颜色一致 |
| `src/components/ppt/create/PptCreateWizard.tsx` / `PptWorkspace.tsx` | 估算携带模板；模板/版本变化使旧估算与 syllabus 失效；分析不把自动数量误标为手动 |
| `src/components/ppt/canvas/PptCanvas.tsx` / `types.ts` | 编辑器按 Render Tree 的表格字号、列宽、行高与颜色显示 |

## 数据流与确认时机

1. 丰富 Prompt、Paste、已解析 File 使用同一 semantic inventory。短主题 Prompt 保留“待论证概念计划”的路径，不把概念推测标记成来源事实。
2. 来源结构保持完整负载；普通段落按标准/详细分别使用65/95宽度单位的**暂定展示投影上限**。完全重复的普通文字在初估中计一次，全部来源 ID 和 refs 保留；不去重原生结构，不据此删除内容。语言交替仅标记 `possible_translation_pair`，不宣称已验证翻译等价，不减少两种语言的负载。
3. `groups` 保存库存 ID、refs、关系、预计负载和 provisional 标识。section 是来源位置；fractional sectionAllocation 只是提示，不能恢复章节最低页配额。页数由全局预计负载/模板可读容量给出范围，不从候选组数量逐组向上取整。
4. 新建未指定数量：`pageDecision.source=estimate`、`mode=auto`、`confirmedAt=null`。文件大小估算不锁定；解析后重新估算。outline prompt 允许3–100候选页，不再同时附带“恰好初估 N 页”的矛盾命令。
5. planner 输出具体 `question`、`keyPoints`、`sourceUnitIds`、`groupId`、必要 `sourceArtifactRanges`。代码校验库存 ID 与行范围，补齐真正来源 refs。只组合相关问题、未锁定标题且有展示内容的相邻正文候选；不同明确问题不因相同章节而合并。
6. 合并保留 keyPoints、内容职责、证据、来源、children、过渡和 `packedFrom`。不以截断字段满足 schema 安全上限；超限则保留原页。正文组合须自然高度拟合、在参考容量内且不超过组合复杂度限制，封面和末页保持。
7. 原有 outline 修订调用可处理容量冲突；仍预测溢出时自动规划失败并暴露冲突，不带错误拟合状态进入生成。缺少展示计划的旧兼容返回 `capacity_ok=false` / `missing_display_plan`，不伪造容量证明；最终写作/QA仍适用。
8. `pageDecision` 保存 initial/final count、profile、calibratedAt、fitValidated。syllabus 展示后仍可继续调整；提交手动大纲 PATCH 或开始生成才写 confirmedAt。明确数量始终 exact-N，原生保真导入/版本更新及已确认旧项目不自动缩页。

`densityPacking` 保存 initial/candidate/final count、mergeCount 和逐页拟合；`planning.sourceCapacity` 保存来源负载、范围和候选组。缓存使用 prompt契约4、planning8、review rubric4，避免误用旧计划/旧评审结果。计划哈希另外包含当前生效的 prompt 契约版本，旧项目保存的历史契约版本不被覆写；语义评审哈希包含节点 hidden、opacity、nativeRef 与页面 templateOmissions，可见性改变会使评审失效。

## 组合布局、写作与 QA

来源对象不再全局限制为两个；保留最多10对象的输入安全边界，由实际空间/复杂度决定组合是否可用。支持两张短表、表格+清单+解释、机制+例子等组合。表格分片明确使用第0行为表头、rowStart≥1、rowEnd为不包含末端索引；writer 不能把规划分片替换成完整大表重复显示。

模型只选来源对象、行范围和解释文字；坐标、字号、列宽、行高由代码生成。原生 writer 明确区分两种正文：保留模板槽位时使用 slotTexts；来源结构替换正文时使用 sourceArtifacts + sourceCommentary，省略将被替换的正文槽位，标题/导航等剩余槽位仍遵守原契约。repair 从实际节点还原来源 ID、表格行范围和解释，不把旧 copy/bullets 当成已显示的结构正文。普通正文按完整机制/条件/比较组织，不再统一限制15–35英文单词。原生与通用 writer schema 均包含 sourceCommentary，结构替换正文区域后仍可显示对应解释。自然高度避免多个全高白框互相遮挡。

本轮实际导出暴露并修复了两处一致性问题：没有 sourceArtifact ID 的 source-explanation 原先被保真 render/export 过滤；深色模板表头原先使用深色文字。现在预览和两种导出路径共用 source-owned 判定及表头颜色。编辑器使用同一字号与测量权重，去除表格固定10px字体的误导。

QA从真实节点取可见文字，不把 hidden 节点、被原生模板 omission 排除的文字、页标题/页码/脚注或合成表格 `|` 纳入正文深度。已有节点均隐藏时不能回退到旧 copy 假报深度。库存级 ownership 存在时，不把整个 chunk 的引用视为其中所有结构都已分配。

丰富来源正文低于参考目标60%产生可修复 warning；它不是填字硬下限。可行合并候选包括非相邻但同问题、共享来源或明确支持/对照/依赖关系的页，需要实际组合拟合且不能超出参考容量。已确认后仅提供结构建议，不静默改变页数。既有表格单元格、公式、关系、末尾总结、证据与发布门禁保留。

## 测量与仍需验证的范围

- 参考 SHA 和字符四分位来自所给 Gamma PPTX。字符指标指封面之外的原生文字与表格，包含该页标题；宽度单位目标601/674/740是参考页面文字负载的近似校准区间。QA排除页标题后与该目标比较，存在小幅角色口径差；目标为建议，不能作为字符或像素精度证明。
- `shared_line_estimator` 是使用现有字形宽度模型的解析预测，考虑字体、行高、内边距、换行和表格权重，不是 PowerPoint 的真实字体 shaping 引擎。单页-fit 证明必须和最终渲染/门禁结合，不能把返回 capacity_ok 当作全部环境下零溢出的保证。
- 快速 page-estimate 带模板快照和版本失效逻辑，但上传模板此时尚未解析原生节点，仍是 `default_canvas_before_template_parse`。解析/prepare 后以 `native_frame_geometry` 再校准；同尺寸、同字号的模板初估可能相同。浏览器测试的不同模板页数是 fixture，用来验证失效与更新流程，不证明所有真实模板都已在快速接口得到不同容量。
- 长来源 prompt 上下文沿用已有有界策略；未增加额外语义翻译/去重模型。初估仍是展示负载启发式，模型负责最终问题组织；代码的合并为有界相邻 packing，QA提供非相邻建议，不是全局最优布局求解器。
- Factor Zoo 原始双语输入用默认画布重算：标准初估21页、范围21–25；详细25页、范围25–30。此数不是最终输出：旧22页硬锁已解除，但本轮没有运行真实模型重生成该长稿，不能声称已得到10页或达到 Gamma 的全部内容质量。两种语言、所有结构和较大字号不能仅为追平10页删除或缩小。

## 2026-10-07：交接核对后的具体改动

本轮逐项对照当前实现，保留已实现的密度路径与产品步骤，只修正不满足本交接契约的部分。[梳理与执行记录](../exec-plans/completed/ppt-gamma-density-contract-audit-20261007.md)列出代码位置、根因与验收；本轮没有重新改动 prototype 或前端组件。

- **语义 ownership / packing**：不同明确 question 优先于 groupId，两个字段拼写 titleLocked/title_locked 均保护用户锁定标题；合并保留双方 requiredSupport/required_support，超出上限保留原页。按输出页序而非原候选页序测量。完整表格与分片合并取范围并集，避免完整表被后页片段替换。
- **来源选择校验**：共享校验器验证可用库存类型和 ID、数组形态、非表格唯一引用、仅表格允许整数行范围、同页范围不重叠；非表格不能伪装成分片。SummaryBlock 与结构对象一致进入预拟合及组合复杂度检查。
- **最终模板容量**：candidate assessment 使用隔离的候选项目，先规范化大纲并完成模板调度，再按最终页序重算 fit，记录 templateAssignmentValidated/templateSlideMap。评审与一次既有 outline 修订使用这份最终 fit；持久化时直接使用同一模板映射，不再在 fit 后重新调度。非法模型选择进入既有一次有界大纲修订；用户手改大纲不触发模型代改。
- **区域 / 字号**：来源组合区域取有效原生正文 frame 的几何并集，限定在页面尺寸内，并保留与其横向相交的标题、导航和页脚区。没有有效正文 frame 时如实使用默认区域基准。原生普通正文字号保留最小有效字号及14pt下限，去掉18pt上限；现有36pt正文的合并建议不能借缩字获取空间。空组件没有拟合证明，零尺寸区域明确报容量不足。
- **写作 / 修复 prompt**：去掉原生槽位“唯一正文”与来源组合的冲突；说明可选 SummaryBlock、表格分片索引及同页约束。repair 携带真实 sourceArtifacts、sourceCommentary、omissions 和证据使用记录，要求保留所有列、已规划的行范围与解释。再次绑定来源结构先移除旧 source-owned 节点，避免旧表格和解释重复显示。
- **可见内容 QA / 缓存**：密度、证据、库存结构/关系和 critic 的组件上下文共用 visibleNodes。排除 hidden、opacity=0 和被 native omission 排除的节点；规范节点存在时不回退到旧草稿证明保留。来源解释与原生文本/表格共同进入 visibleSlideText，不再因出现表格而漏掉解释。空白页不获合并建议；不同明确 question 不获合并建议；低密度率只统计适用正文角色。可见性变动进入评审哈希。

这些改动仍使用现有模型节点、解析估算器、模板调度与门禁，不新增 LLM 阶段、服务依赖、数据库迁移或成本策略。区域并集和行估算仍为解析预测，不能替代多字体、复杂模板和实际 PowerPoint 渲染验收。

## 2026-10-07 验收

- 新增 `selftest-ppt-density-audit.mjs`：27项全通过。先复现失败再修正；覆盖跨问题误合并、两种标题锁拼写、requiredSupport 保留、非法/重叠分片、完整表格与分片合并、SummaryBlock 溢出、实际原生几何/页脚/字号、空内容拟合、最终模板映射、一次模型修订、透明/隐藏/省略内容、实际解释证据、重复绑定与缓存失效。
- 原 `selftest-ppt-density.mjs`：21场景组全通过；模型响应模拟，实际 Python PPTX exporter 和原生保真导出读取核验通过。
- PPT专项自检通过，覆盖 prompt/语义、模板保真/调度/安全、真实fixture、库存/内容深度/证据、结构IR、M2–M5、局部编辑/版本/要求、100页限制与快照、恢复同步和报告门禁；末次修改后重新运行可见内容、证据、结构、导出、评审/局部编辑相关专项。
- 最终 `npm run test`：typecheck通过，2809测试，2808通过、1跳过、0失败。
- 本轮19项现有PPT浏览器回归通过（45s），localhost:3017 独立开发服务；包含新建、自动syllabus、模板变化、生成要求/编辑、模板复用与390×500滚动场景。使用 Chromium Playwright 原生CDP；相关页面 console/pageerror检查无错误。浏览器业务API响应为fixture，本轮实际生产API的一次 outline 修订及调度/fit由后端自检覆盖。
- 未调用真实LLM、未验收远端容器/桌面PowerPoint；M2本地PDF检查因其默认Python无matplotlib跳过，不以此声明PDF链路全通过。本轮没有生成新的Gamma长稿质量对比产物。

复跑新增核对：`npm run selftest:ppt-density-audit --prefix apps/cowork-server`。详细验证命令和范围见本轮完成计划。

## 2026-10-06 验收记录

- 全仓 `npm run test`：typecheck通过；2809测试，2808通过、1跳过、0失败。
- PPT既有22组自检通过，覆盖语义规划、内容深度/证据、结构、原生模板/调度、来源覆盖、局部编辑/幂等、原型策略、暂停恢复、版本、长文、模板安全、发布门禁及实际文件fixture。本轮末次重新运行受导出/ownership影响的专项，结果全通过。
- 新 `selftest-ppt-density.mjs`：21个场景组，跨研究/业务/架构、合法Prompt/Paste/File、标准/详细、章节变化、auto/explicit、物理容量、表格分片、可见/隐藏统计、非相邻候选、API解析后校准、库存ownership，以及生成→review→publish真实导出链。模型响应模拟，Python PowerPoint exporter实际运行；表格全部单元格、解释文本与表头颜色读取实际PPTX核验。保真导出路径另行实际导出核验。
- 浏览器19项全通过：现有16项流程及新增自动syllabus校准、模板容量变动失效、表格编辑器权重/颜色。复用当前仓库已运行的 localhost:3000 开发服务；chrome-devtools MCP不可用，使用 Chromium Playwright 的原生 CDP会话截图/页面检查。console/pageerror检查无错误；包含390×500滚动用例。未触碰用户账号数据。
- `outputs/ppt-density-implementation-20261006/` 为功能验证产物：3页密度链路smoke、质量/规划JSON、保真路径smoke、LibreOffice PDF及第2页截图。此短输入smoke不作Gamma内容质量对比样例。PPTX→PDF→PNG已核验表格/清单/解释无裁切；未验证桌面PowerPoint、远端容器或真实所选LLM。

可复跑：`npm run selftest:ppt-density --prefix apps/cowork-server`（需可用python-pptx，或设置 `PPT_TEST_PYTHON`）；浏览器运行 `npx playwright test src/__tests__/e2e/ppt-prototype-parity.spec.ts src/__tests__/e2e/ppt-workspace.spec.ts src/__tests__/e2e/ppt-template-reuse.spec.ts --workers=2`。没有commit、push或发版。
