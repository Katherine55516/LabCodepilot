# PPT 模块交接清单（给 Codex，2026-10-27）

> 作者：Claude（会话 73b37573）。范围：PPT 模块（`apps/cowork-server/lib/ppt*`、`src/components/ppt`、相关 selftest 与文档）。
> 相关计划：[选项 D 主线整合计划](exec-plans/active/ppt-integration-option-d-mainline-20261026.md)（决策日志与逐轮记录）、[技术债务](exec-plans/tech-debt-tracker.md)。

## 1. 代码在哪里

所有代码都在仓库 `/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot`（worktree 与主目录共用同一个 git 仓库）。

| 分支 | HEAD | 说明 |
|---|---|---|
| `claude/ppt-integration-20261026` | 本文档所在提交（其前一个是 `29500aa1`） | **PPT 主线**。已包含下面所有分支的工作。worktree：`.ppt-build/integration-20261026`；3157 手动测试服务从这里运行。 |
| `claude/ppt-integration-merge-main-20261026` | `ab1aa567` | 合并 main 的审阅分支，已并入主线。worktree：`.ppt-build/merge-main-20261026`。 |
| `claude/ppt-integration-run17-merge-20261026` | `e0887030` | “slides outline” 会话移植的 report 冻结后修复，已并入主线。 |
| `main` | 与主线相同 | 2026-10-27 用户批准后快进到主线（含无关文件清理 `2c8825c2`）。合并前主目录里自 2026-10-21 起暂存的 584 个改动、22 个未暂存改动和 7 个未跟踪文件保存在分支 `backup/main-uncommitted-20261021`（`1aaef9b2` 暂存状态、`33926bd9` 未暂存与未跟踪）。 |

主线上本轮的提交（新→旧）：

- `29500aa1` Merge main（经审阅的合并分支）into 主线
- `98798c1b` Merge “slides outline” 会话的 run17 移植（`e0887030`）
- `9a79708f` fix(ppt): PDF 论文可作为输入生成并发布；外文封面标题不再挡住确认
- `ab1aa567` fix(ppt): main 合并后的门禁修复；手动卡片格式（Q1b）
- `5d50a9d3` / `d4c7d5a7` feat(ppt): 大纲“生成”按钮说明等待原因并带 AI 图标
- `883a6acf` Merge main into the PPT integration branch

工作区里只剩未跟踪的 `apps/cowork-server/outputs/`（运行产物，按规则不提交）。

## 2. 合并细节

### 2.1 合并 main（`883a6acf`，59 个冲突文件）

- main 上需要并入的是三个 2026-10-13 的 PPT 修复：`9b7a049f`（视觉输入、逐页生成）、`9e0351cd`（编辑器控件、模板仅取设计）、`3d5c8e82`（修复时保留来源），以及文档 `f29db081`。
- 原则（Fable 决定）：集成分支（选项 D）是主线；main 只补集成分支缺的能力，与选项 D 决策冲突处保留集成分支。
- 从 main 移植：预览里表格/文本框的 SVG 缩放（`exporters/preview.mjs` 的 `htmlBox`）；品牌文字与序号标签不作槽位（`ppt-template-fidelity.mjs slotsFor`）；代码块的作者字体（`import-pptx.mjs`）；发布时清 `renderUpgradePending`；`next.config.ts` 的 `optimizePackageImports`；`dominantInputLanguage` 作为后备语言（卡片标题仍用稿件语言）。
- 其余冲突（i18n、类型、编辑器/向导/监控、render/render-tree/render-contract、density、quality、ppt-api、prompt-contracts、selftests/e2e）保留集成分支。
- 自动合并带来的重复声明已清理：`writerCorrectionContext`、`prepareNativeTextElement`、第二个 `mergeSourceSupplement`、重复 import、5 个重复 i18n 键（每种语言）；补了 `dominantInputLanguage` 的 import。

### 2.2 合并后的门禁修复（`ab1aa567`）

完整自测发现 7 个失败（集成分支上全部通过），逐个修复，main 与选项 D 冲突处问 Fable：

| 测试 | 根因 | 处理 |
|---|---|---|
| rich-text、manual-format-export | main 在 `render_scene_element` 里把样式强写到每个 run，覆盖富文本 | 删掉；作者格式只走 `apply_scene_text_style` |
| render-contract | 原生导出先取 `textLayout` 的 Consolas，作者字体被旧版式覆盖 | 作者的 `fontFamily` 覆盖优先 |
| m4 | main 把来源图片上限从 4 提到 64 并按字节去重，没改测试 | 测试边界改 65，第二张图换像素 |
| m5、mutation-runtime、edit-intent | main 的逐页生成把并发降到 1 | **Fable (c)**：模型调用并发 ≤3，预览按阅读顺序提交；新增 `selftest-ppt-ordered-commit` |
| real-fixture | main 的 `outputs/` 基线让可选回放第一次运行；第 30 页旧块号已变 | 按章节主题迁移第 30 页 |
| generation-input-contract | 设置 `PPT_TEST_OUTPUT` 时引用未定义变量 | 修正 |

同一提交还有 **Q1(b)**：作者的字体/粗细/斜体/下划线覆盖到卡片（两个导出器、预览、编辑画布）；渲染树此前不给来源对象和视觉元素传 `textStyleOverrides`，内置模板上作者格式根本到不了导出文件，已修。新增 `selftest-ppt-card-style-overrides`、`selftest-ppt-kept-fixed-text`；`gamma-semantic` 加了“导出几何等于拟合框”的检查。

### 2.3 合并 “slides outline” 分支（`98798c1b`）

`e0887030` 把 report 分支冻结后的两个提交（`942eb90b`、`a4507131`）按选项 D 逐项移植（与 Fable 分类）。无冲突；该会话在临时 worktree 里预演过合并，相关自测通过。

### 2.4 合并合并分支（`29500aa1`）

只有两个文档冲突（计划与技术债务，两边都保留）。**注意**：合并 main 也带进了 main 的 `e1929ae7`（“Add LabCodepilot project”）里约 2 万个无关文件（`outputs/`、`.ppt-build/` 下的产物、`apps/cowork-server/node_modules`、`cowork-audit.log`、`public/System/Library/Fonts/Supplemental/Arial.ttf`）。清理见待办 P1-4。

### 2.5 合并后的验证

- `npm run test`：3103 个，3102 通过，0 失败（1 个跳过）。
- 完整 selftest：195 个全部通过（`apps/cowork-server/selftest-ppt-*.mjs`，含 `gamma-http`）。
- 生产构建成功；PPT 冒烟 `@smoke` 85/85 通过（生产构建，3161 端口，测完已关）。
- 生产构建：在这台机器上 `next build` 需要 `NODE_OPTIONS="--no-network-family-autoselection --dns-result-order=ipv4first"`（Google 字体下载在 Node 22 的地址竞速下超时）。

## 3. 本轮修复与验收状态

| 修复 | 状态 |
|---|---|
| 大纲“生成”按钮：说明等待原因、AI 图标（`d4c7d5a7`） | 已在 3157 浏览器验证，冒烟 85/85 |
| 封面标题：中文稿的外文标题按汉字上限、短标题+完整译文、被拒重试一次、不退回外文标题；标题容量 409 本地化 | selftest 通过；**未在 3157 实跑**（见 P0-3） |
| PDF 读取：词距、分栏、页边印章、页眉按字号、连字/重音、公式提示合并为一条、参考文献作存档 | selftest + 3157 九轮实跑：提示由 21 个变为 1 个，文字干净 |
| PDF 图片：按图区裁剪+图注、模板稿图进图页（选项 A）、图页按测量放图、标题适配模板、附录图可选、放不下时缩小 | selftest + 实跑：第 9 轮所有质量检查通过 |
| 数字检查：PDF 元数据、图页 k/n 标记 | 同上 |
| 章节标签字号不超过量框字号；不匹配来源的 `$...$` 显示为纯文本；只有真实双语对才按 ` | ` 拆行 | 同上 |
| 卡片稿不再走旧的 `applySourceImages` 自动挂图 | 修复了第 9 轮的导出失败（Figure 27）；**未实跑**（用户要求第 9 轮后停止） |
| 编辑器里模板稿的结构/版式编辑被拒时显示中文说明 | 单元测试通过 |

## 4. 待办（按优先级）

### P0（先做）

1. **world_models.pdf 实跑到发布**。用 `/Users/dongli/Desktop/Spatial_omics/world_models.pdf`，模板 `38b66a7c77b5cd63cd17b44bc46d9288`（preserve / design_only），篇幅“标准”、语言 English。第 9 轮（项目 `785a8c2324fffad6b9f37a80ec0559ae`）通过全部质量检查，卡在导出校验 `Visible canonical object has no exported render mapping: source_image_7ee3902f…`（Figure 27，附录可选图）。根因是 `ppt-api.mjs` 的 `applySourceImages` 把大纲未放的图自动挂到一页，已改为卡片稿跳过；需要重跑确认发布，并读成稿：每张有图注的图在引用它的卡片后面，图注完整，标题不重复。
2. **E3：模板卡片页在要点旁放图（Fable 选项 B，已决定做）**。现在模板稿每张图都进图页，26 页里 12 页是图页，用户嫌一张图占一页。规则（Fable）：
   - 主题卡片页把它引用的图放在要点旁一列（参照 `ppt-media-preserving-layout.mjs` 的 `artworkPreservingFit`）；
   - 默认一张图（两张都能 ≥2.2 英寸宽时两张）；图列取画布宽的 40% 与图自然宽度中较小者；
   - 图注在图下方、正文字号 −2（`figure_caption` 字号依据，审计已接受）；要点列按正文字号用剩余宽度测量；
   - 要点放不下就把图送图页（F2/F4 不变），**不给要点降字号**；原生槽位卡片页一律送图页；
   - 这个决定必须在模板排期（`rescheduleTemplateFidelity`）之后、按真实页面测量，所以要在排期后再调整 `sourceImageIds` / 图页；
   - 自测：3 个要点的卡片带横图能放旁边、6 个要点的卡片退回图页、原生槽位页从不带图、门禁每张图恰好出现一次。
3. **E1 + E2：成稿后的页面结构编辑**。用户在第 5 轮成稿上输入“把页面3和页面4的内容合并到一个页面中”，被拒（第 3 页是“Abstract · Figures”图页，第 4 页是章节页）。根因：`ppt/mutation-router.mjs` 对 `editableCapabilities(project).relayout===false`（`ppt/edit-context.mjs`：preserve 模板即 false）的项目一律拒绝结构/版式编辑，而现有结构编辑路径（`ppt/typed-proposal.mjs`）只认旧的 `body` 列表节点。Fable 决定：
   - E1：谓词改为只有原生绑定的页不可改，代码排版的卡片页（主题页或槽位计划）可编辑；仍拒绝时用界面语言说明两页是什么、能做什么（本轮已做本地化文案，在 `src/lib/ppt-error.ts`）；
   - E2：卡片+卡片合并（要点合并，测量能放下才做，否则给出测量原因）、图页+图页合并；“章节页+下一页”不是合并，提供“删除章节页”（章节标题留作卡片的章节标签）；均走现有提案预览/确认，不调用写作模型，门禁重跑；
   - 做完 E3 后重新生成 world_models.pdf，再原样执行用户那句指令，报告前后页数和用户看到的回复。
4. **封面标题修复的实跑**：3157 上项目 `3adb5584ed6ab13915fd0a63ffd3d7da`（06_rl_llm_frontier.pdf，中文稿、英文 H1）在修复前生成了大纲，确认被 409 挡住。需要用新代码重写大纲（改一个设置或给一句指令后点“重写大纲”），确认封面是 ≤8 个汉字的短标题、下方是完整中文译文，确认通过并生成。
5. **大纲编辑器里的图页**：第 9 轮界面上图页仍显示“+ 要点”，没有列出配图。`PptCardOutline.tsx` 的 `outlineCards` 已按 `slide.figurePage` / `sourceImageIds` 显示图注并隐藏“+要点”，但页面上的项目视图（`lib/ppt/project-view.mjs` 的 outline 投影）可能没有带这两个字段；查清并补上。用户在大纲里编辑/移动/删除图页时服务器的处理也没有专门测试。
6. **13_dl_quant 实跑的阻断与缺陷**（见 4A）：先问 Fable 对比度误报（问题 1），修编号缺陷（问题 2），完成并合并对象分组（问题 3，WIP `4f39eb9a`），然后在 3157 重跑。

### P1

1. **主目录里的 7 个未跟踪文件**：`backup/main-uncommitted-20261021` 里也有（逐字节相同）。其中两个单元测试（`ppt-capacity-selection-repair.test.ts`、`ppt-main-merge-regressions.test.ts`）测的是已不存在的模块，留在主目录里会让 `npm run test`（和提交钩子）失败 6 个；由用户决定移走还是整合。那个备份分支里 10-21 的暂存改动是否还有价值，也需要用户或 Codex 判断（其中 214 个文件与主线相同，约 156 个是更旧的版本）。
2. **续页标记已改为 “ · k/n”（`c20161c8`，已并入整合分支 `67ebe87d`）**：拆开的卡片每页（含第 1 页）标题为 “<标题> · k/n”，不再显示 “(cont.)”/“（续）”，不加 “续” 眉标（Fable 10-27）。实现：`numberCardParts`（`ppt-card-pages`，大纲阶段与生成阶段续页各调用一次），数字检查豁免 `verifiedPartCounter`（`ppt-source-numbers`，按大纲核对 k 与 n，与图页的 `verifiedFigurePageMarker` 并列），已完成页只改计数不重写（Fable 选项 A），细节见 [卡片大纲交接](handover/ppt-card-outline-option-d.md)。待实跑确认：拆页的卡片在成稿里每页带计数、数字检查不报计数。已知边角：图页标题的末级回退 “<标题> · k/n” 与同卡片的拆页计数可能同名（罕见，未处理）。
3. **无关文件已清理**（`2c8825c2`，用户 2026-10-27 批准）：约 20,900 个文件 `git rm --cached` 并加入 `.gitignore`，文件都还在磁盘上，历史未改。cowork-server 的 katex 0.19.0 / commander 由根目录 `package-lock.json` 的 workspace 嵌套条目提供（`npm install` 会重建）。新克隆或新 worktree 需要先 `npm install`。
4. **图页数量**：world_models.pdf 标准篇幅 26 页（14 张卡片 + 12 张图页）。E3 后应明显减少；Fable 预期 16–18 页。
5. **PDF 图识别余项**：Figure 7（第 3 页）没被识别为图；第 7 页没被判成双栏，Figure 15 的图注与左栏同行（现在靠按词位置找图注已找到，但该页正文仍按单栏读）。
6. **卡片的行高与字号覆盖（Fable Q1(a)）**：现在只覆盖字体、粗细、斜体、下划线；改行高或字号要重新测量容量（布局、导出、校验一致）。
7. **Codex 容量恢复与卡片质量线**（见 4B.1）：`b236f540` 加上未提交的卡片质量 WIP，都不在主线上；等该线完成后从主线按项移植，续页标题以 “ · k/n” 为准，由用户或 Fable 决定移植范围。

### P2

1. `measureText` 不区分字重，目前靠 >30% 余量兜住（全粗体卡片实际溢出在测量 130%–160% 之间）。
2. `real-fixture` 回放靠章节迁移表对齐分段（已 4 页）；再多两页需要迁移时，在当前分段下重生成基线。
3. `gamma-http` 在全量自测负载下会超时（单独跑通过）。
   - `selftest-ppt.mjs`（10-27 “slides outline” 会话）：在 `997aa66e` 与 `4ff446d5` 上单独跑都失败，停在 `input_ready`（等 5 秒也一样，不是负载）。新建项目在选项 D 下停在输入步骤、要显式开始规划，而这个测试（最后改于 `65989e64`，早于选项 D）仍等它自动出大纲。Gamma 在 `29500aa1` 上报告它通过，差异未查清；先当作测试过期处理，需要对照确认。
4. 致谢（Acknowledgements）章节仍可能成为卡片主题。
5. 其余见 [技术债务](exec-plans/tech-debt-tracker.md) 的 “PPT 合并 main 的 10-13 修复之后” 等小节。

## 4A. “slides outline”会话的实测发现（13_dl_quant，2026-10-27，用户已叫停）

> 来源：“slides outline”会话（`local_f28fc750`）的汇报，由本会话按用户要求写入。该会话已停止所有实跑，不再动主线 worktree 和 3157。

### 状态

- 3155/3157 在 04:44:49 用带 “ · k/n” 编号的主线代码重启（`c20161c8`，经 `67ebe87d` 合并）。
- 实跑 d1：`13_dl_quant.md`，模板 `5d49de09`（设置照搬项目 `b959767b`），qwen3.8-max，项目 `d45c68ac47e39fd0e63b9d922dc5429d`。大纲 40 张卡片（586 s），确认通过，生成 458 s，44 页，状态 `quality_blocked`，只有 1 个确定性错误（问题 1）。
- 未合并分支 `claude/ppt-object-packing-20261027`，WIP 提交 `4f39eb9a`，worktree `.ppt-build/integration-merge-20261026`（见问题 3）。

### 已实测验证

- 拆分卡片的 “ · k/n” 编号在大纲阶段和生成时的拆分都生效，前面的部分会就地重新编号（Honest Counter-argument 1/2、2/2 → 1/3..3/3；Qlib-style Baselines 1/3..3/3；Decision Table 1/3..3/3）。
- 数字检查没有误拦任何编号（整份稿唯一的错误是问题 1 的对比度）。

### 发现的问题（含根因）

1. **阻断，门禁误报**：第 43 页 `text_contrast_insufficient`（ALSTM 注意力公式 `b_0182`，#111827 在 #57068c 上，1.53:1）。公式底板（`ppt-native-text-fit.mjs:28`）给来源公式深色字加了文本框自己的白底（`style.fill` #ffffff，`colorBasis: 'source-math-accessible-plate'`），导出也画了这层底（`ppt-render.mjs:329`）；但 `ppt-text-contrast.mjs` 的 `backgroundOf`（约第 27 行）只看文本框后面的形状和图片，不看文本框自己的填充，于是按紫色页面背景算了对比度。候选修复：不透明的自身填充就是文字的背景。属于门禁规则改动，**需 Fable 决定**（尚未询问）。
2. **编号缺陷**：第 15、16 页都叫 “Architecture Guidance for Low SNR”，没有编号。这是生成时拆出的要点页，“(cont.)” 放不下，`continuedPageTitle` / `fallbackCardTitle` 保留了不带标记的完整标题；`numberCardParts`（`ppt-card-pages.mjs`）只把带标记的页连成一组，所以没成组。修法：同一 `logicalCardId` 上重复上一页标题的无标记页（`repeatedTitlePages` 的情形）也当作后续部分，再由放得下检查决定加编号还是省略；在 `selftest-ppt-part-counter.mjs` 加用例。**未做**。
3. **一页一个公式**：“LSTM Gate Equations · 1/9 … 9/9”（6 个 LSTM + 3 个 GRU 单行公式，第 1 页之后没有要点）。根因：`objectContinuation`（`ppt-card-pages.mjs` 约 844 行）对放不下的多对象卡片一律返回 `{each:true}`。**Fable 已决定 B**（2026-10-27）：用最少的部分、按数量均分对象，每部分连同跟随的要点逐一测量（要点跟随它引用的第一个对象，未引用对象的要点归第 1 部分）；某部分放不下就用 n+1 部分；单个对象自己都放不下就单独成一部分（下一轮再按行拆）；只有测量抛错时才用 `{each:true}`。已在 WIP `4f39eb9a` 实现（`ppt-card-pages` 的 `objectGroups`、`splitCardPage` 的 `options.groups`、`ppt-api` 的原因文本）；`selftest-ppt-object-packing.mjs` 里“n−1 部分放不下”的检查仍失败，原因未查明；完整 selftest 未跑。
4. **附录内容放错位置**：来源把 ALSTM 相关单元 `b_0180`–`b_0185` 放在第 12 节 “Decision Table and Closing Reminders”，于是 ALSTM 注意力公式落在 “Decision Table · 3/3”。`semantic_unit_placement` 触发 4 次，全是 ALSTM 单元，已满足把第 19 项从提示升级为“重新归位”的条件（把这些单元移到讲解它们的章节卡片，这里是 “HIST, TRA, and ALSTM Architectures”）。**需设计 + Fable**，未开始。
5. **阅读顺序**：“Decision Table” 生成时拆分后，要点页插在表格部分之间（1/3 表格、2/3 要点、3/3 公式）：要点续页总是紧跟本页插入，即使卡片的对象在后面还有续页。
6. `selftest-ppt.mjs` 在 `997aa66e` 及之后停在 `input_ready`（单独跑、等待时间加到 10 倍、两种测试环境都一样）；在 `29500aa1` 上本会话跑是通过的，差异原因未查明（P2 已记）。
7. **新 worktree 里 `npm install` 失败**：下载 `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz` 超时（ETIMEDOUT）。临时办法：从主线 worktree 复制 `apps/cowork-server/node_modules`（仍在磁盘上，已不跟踪）。
8. **边界情况**（已在交接里）：图页最后退路的标题 “<base> · k/n” 可能与同一卡片拆分部分的标题相同。

### 待测试

- 修完问题 1–3 后在 3157 重跑 13_dl_quant（先重启 3155/3157；保持一个可见的 3157 `/ppt` 标签页；预热 provider 接口），逐页审阅成稿。
- 用这次重跑决定第 2 组（要点缩短相关：第 10、22、8、2 项）。d1 的提示：`card_title_shortened` ×7、`labels_partial_dropped` ×9、`card_numbering_dropped` ×2、`card_length` ×2，大纲阶段 8 个来源未覆盖。
- 合并后主线的完整 selftest 和生产构建上的 `@smoke`（P1）。

### 待办

- 问 Fable：问题 1（对比度按自身填充）和问题 4（重新归位的设计）。
- 修问题 2；完成并合并问题 3（`claude/ppt-object-packing-20261027`）；然后做问题 5。
- 不变：3143/3141 不更新（用户决定）；不 `git push`。

## 4B. 不在主线上的两条 PPT 线（2026-10-27 盘点）

> 盘点方法：对全部 PPT 分支与 worktree 做 `git branch --no-merged main`、`git cherry`、patch-id 比对和逐文件比较。10-13～10-21 的旧线已在[集成计划](exec-plans/active/ppt-integration-option-d-mainline-20261026.md)第 1、3.6 节判定为已移植或已取代；`integration-trial-20261027` 暂存区的补丁与 `e0887030` 完全相同（patch-id 一致），已在主线；`claude/ppt-object-packing-20261027` 见 4A 问题 3。下面两条线都没有进主线，也都没有经过本次验收：第一条需要移植，第二条已被主线取代。

### 4B.1 Codex 容量恢复与卡片质量线（`codex/ppt-capacity-recovery-20261026`）

- 位置：worktree `.ppt-build/capacity-recovery-20261026`。分支基于 option D POC `ada21be5`（10-26，已在主线），没有后来的集成、main 合并、PDF 与分页编号改动。
- 已提交，未进主线：`b236f540` fix(ppt): preflight full card capacity and batch continuation repairs。新增 `lib/ppt-card-capacity-preflight.mjs`，把对象连同说明文字一起测量，续页子页重新测量，行结论只在放得下时追加，容量失败全部修完再重启生成。另改了 `ppt-api`、`ppt-card-pages`、`ppt-outline-cards`、`ppt-outline-continuation`、`ppt-source-artifacts`，并有自己的完成计划 `docs/exec-plans/completed/ppt-capacity-recovery-20261026.md`（只在该分支上）。
- 未提交、进行中（文件最后修改于 2026-10-27 04:06）：卡片整稿非阻断质量修复，计划是该 worktree 里的 `docs/exec-plans/active/ppt-card-quality-20261026.md`（基线 48 页、154 条提示、20 种代码；计划自述“验收尚未通过”，最后一次完整 `npm test` 有 1 个失败，是 card outline API 子进程超时）。改动涉及 15 个已跟踪文件（+236/−58），新增 `lib/ppt-card-quality-titles.mjs`、`selftest-ppt-card-quality.mjs`、`src/__tests__/unit/ppt-card-quality.test.ts`，另有测试设计文档 `docs/handover/ppt-test-cases-v1-20261026.md`（“全部用例未执行”）。
- 与主线重叠：主线的 run17 移植、分页编号 “ · k/n”（`numberCardParts`）、图页和 PDF 修复改的正是 `ppt-card-pages`、`ppt-outline-cards`、`ppt-api` 这些文件；该线的续页改名（“按实际内容重命名”，计划第 1 行）与 Fable 定的 “ · k/n” 编号直接冲突。
- 建议：先让该线自己完成并提交，然后从主线 `a390a9ef` 之后的头部开分支，**按项移植，不整枝合并**；续页标题以 “ · k/n” 为准。移植项按集成计划的流程过 `npm run test`、全部 selftest 和生产构建上的 `@smoke`，并在 3157 跑一次同输入实跑。是否移植、移植哪些，由用户或 Fable 决定。

### 4B.2 列表摘要冷启动索引（`claude/ppt-summary-index-20261026`）：已被主线取代，不移植

- 位置：worktree `.ppt-build/summary-index-20261026`，是冻结标签 `report-freeze-20261026`（`632b5e9c`）之后的两个提交，来自 3143 会话（Fable 选项 C）。集成计划第 4c 步只移植了冻结后的 `942eb90b`、`a4507131`，没有这两个。
- 解决的问题：3143 上 130 个项目（449 MB），每次列表都要解析全部项目文件（约 8.7 s），就绪检查因此超时。
- 主线已用自己的方案解决同一事故（2026-10-26）：`7eb14967` 给每个项目写 `<id>.summary.json` 摘要旁文件（按文件身份校验，过期或缺失才重读那一份），冷启动列表不读项目；投影缓存有 8 MB 字节预算，条目数随项目数扩到 1.25 倍；就绪检查改用 `/api/ppt/health`（`storeReady()`），不再列项目。分支的 `dcb7f38d`（每账户一个 `_summary-index.v1`）和 `d48dfaa9`（字节预算 + 命中刷新 LRU）与之功能重叠。
- 唯一差别：主线缓存命中时不刷新顺序（按插入顺序淘汰）。条目数上限是项目数的 1.25 倍，单一列表键下只有超过 8 MB 字节预算才会淘汰；多个列表键同时使用时可能更早淘汰。冷启动走摘要旁文件，不受影响。
- 结论：不移植。两个分支和 worktree 可在用户确认后删除；3143 跑的仍是 report 分支，它自己的列表性能问题不在主线范围内。

## 5. 已有决定（不要重议）

都记录在整合计划的对应小节，要点：选项 D 主线；门禁分级（确定性完整性缺陷阻断，模型评审只作提示）；标题只用主语言；版式复用上限 max(2, floor(N/5))；内容页并发 ≤3、预览按阅读顺序提交；PDF 公式确认一次、引用公式页的卡片有近似公式提示；参考文献是存档；有图注的图必需、无图注的绘图可选、附录图在标准篇幅下可选；模板卡片页暂不放图（选项 A，E3 之后改为 B）；页面永不因图片放不下而让整份失败。

## 6. 环境与运行

- **3157 手动测试服务**：`PPT_MANUAL_STATE_DIR=<scratchpad>/option-d/manual-state node --import tsx scripts/ppt/manual-test-launcher.mjs stop|start --no-open`（在主线 worktree 根目录）。前端是 `next dev`，只热更新 UI；`/api/ppt` 由 3155 端口的后端（`manual-test-service.mjs`）处理，它只在启动时加载 `apps/cowork-server/lib`，**改了服务器端代码必须 stop/start**。启动后首次加载模型列表常超过 15 秒（页面提示“部分工作区数据加载失败 (models)”），先请求一次 `/api/providers`、`/api/providers/models`、`/api/providers/options?providerId=__global__` 预热。健康检查用 `/api/ppt/health`。
- **模型任务**：由浏览器里打开的 `/ppt` 页面领取，跑实测时保持一个可见的 3157 `/ppt` 标签页。
- **selftest**：`PPT_TEST_PYTHON` / `PPT_PYTHON` 指向带 pdfplumber、python-pptx、reportlab 的 Python（本机：`/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3`），PATH 加上同目录的 `bin/override`；`PPT_MATRIX_TEMPLATE_DIR=/Users/dongli/Documents/ChatGPT/CodePilot/templates`。
- **冒烟**（生产构建，非 dev）：
  - `NODE_OPTIONS="--no-network-family-autoselection --dns-result-order=ipv4first" CODEPILOT_NEXT_DIST_DIR=.next-ppt-prod npx next build --webpack`
  - `CODEPILOT_NEXT_DIST_DIR=.next-ppt-prod PORT=3161 npx next start -p 3161 -H 127.0.0.1`
  - `PORT=3161 npx playwright test src/__tests__/e2e/ppt-*.spec.ts --grep @smoke --workers=2 --reporter=line`，结束后关掉 3161。
- 规则：不 `git push`；合并进 main 由用户发起；不要动 3143 服务（factor-zoo-live-secret / run17）；API key 只经项目启动器（钥匙串），不要打印或保存。

## 7. 关键文件

| 领域 | 文件 |
|---|---|
| PDF 读取、分栏、页边、图区 | `apps/cowork-server/lib/ppt-document-extraction-python.mjs`（`pdf_reading_lines`、`pdf_figures`、`pdf_clean_text`）、`lib/ppt-source.mjs`（PDF 分支、提示合并、图片输出） |
| 参考文献存档 | `lib/ppt-semantic.mjs`（`withSemanticIndex`）、`lib/ppt-card-outline.mjs`（`REFERENCES_SECTION`） |
| 图放置、图页 | `lib/ppt-card-outline.mjs`（`assignSourceImages`、`figurePageFits`）、`lib/ppt-source-artifacts.mjs`（`bindSourceMedia`、`scaledMediaFit`）、`lib/ppt-api.mjs`（图页生成分支、`applySourceImages` 跳过） |
| 封面标题 | `lib/ppt-card-outline.mjs`（`deckFinishTask`、`acceptCover`、`coverCorrectionTask`）、`lib/ppt-card-pages.mjs`（`deterministicCoverDraft`） |
| 数字检查 | `lib/ppt-source-numbers.mjs`（`authorities`、`verifiedFigurePageMarker`） |
| 结构编辑 | `lib/ppt/mutation-router.mjs`、`lib/ppt/edit-context.mjs`、`lib/ppt/typed-proposal.mjs`、`lib/ppt/proposal-service.mjs` |
| 界面 | `src/components/ppt/create/PptCardOutline.tsx`、`PptSourceWarnings.tsx`、`editor/StructuredPptEditor.tsx`、`src/lib/ppt-error.ts` |
| 新测试 | `selftest-ppt-pdf-two-column`、`-pdf-figures`、`-figure-placement`、`-ordered-commit`、`-card-style-overrides`、`-kept-fixed-text` |

## 2026-10-27 Codex 后续核对（原文保留；以下为实际进度）

- 代码工作树仍为 `.ppt-build/integration-20261026` / `claude/ppt-integration-20261026`，基线 `c82dd2ae`；本轮改动尚未提交，main未改、未推送。旧对象分组WIP按项补入并修正生产拟合路径；旧容量线仅按用户授权移植对象+完整说明预检、子页重测和失败波次批处理，未合并旧质量WIP，保留“ · k/n”。
- P0真实证据：新 world_models 项目 `79ae68426138756ffb4558a9c3172eba` 已发布20页、0阻断。新解析29图，按标准篇幅选择21图，实际PPTX的21条图注逐条完整，Figure3末句和Figure7均保留；第7页分栏修复已有真实解析断言。原26页项目也已成功发布。
- E3真实布局已减少独立图页；按实测保留20页，未为达到16–18页预期而缩字号。E1/E2在 `06fbe702249ef00a97088c994ea2b5a1` 用原指令完成20→19、撤销20、重做19及重新发布，标题/章节标签/正文/来源图保留。图页大纲编辑的显示、改名、移动、删除有回归及真实显示证据。
- 中文封面 `3adb5584ed6ab13915fd0a63ffd3d7da` 已重写为“大语言模型研究”（7字）、保留完整中文译文，并生成发布10页。
- 同输入量化稿 `5905559de6b85dc80ecc381f5cdab87e` 已发布35页（旧44页）：九个门公式分为5+4两页，ALSTM公式回到第27页，Decision Table对象在说明前；0阻断。原Prompt逐字hash与旧稿一致。来源覆盖、部分符号/参数定义与留白等提示仍存在，不能宣称内容零遗漏。
- 新增修复：完整PDF图注、纯短线Figure7、稀疏双栏、致谢归档、旧selftest显式规划、版本列表摘要、结构提案精简响应、原生标题索引、双页码（canonical页码替代继承字段）。两种PPTX的实际字号/行高回归已通过。
- P1最终交互还在收尾：修复“选正文”包含锁定页码、两卡片字号编辑忽略原双列、小数字号/1.18行高的表单步长，以及大纲层遮住模型重试按钮。代码与针对性回归已完成；最新v2构建成功，3157更新至该快照后继续真实格式编辑/撤销/重做/重发，验收结果见执行计划最后记录。
- 测试快照：204个服务端selftest全部通过；新增母版页码测试、单独gamma-http通过（真实业务链路、模型双件），合计206个文件有通过证据。完整npm test曾为3111项、3110通过/1跳过；最后选择逻辑修复后正在再跑。生产构建退出0，仍有既有SDK ESM及standalone相对依赖链接复制警告；不把独立打包列为验收通过。
- 3157/3155及原账户、模型和测试数据保留，改用当前工作树的生产构建，避免开发热更新干扰验收。3143/3141未动。截图/机器断言保存在工作树 `outputs/handoff-20261027/`，完整决策与后续状态见 [执行计划](exec-plans/active/ppt-integration-option-d-mainline-20261026.md)。

### 本轮收尾状态

P1真实格式交互已完成：13.5pt/1.2成功、90pt/3拒绝且revision不变，随后undo/redo/undo均成功；原格式恢复后量化稿revision5已重新发布，35页0阻断、111提示。双页码已通过实际PPTX逐页断言。顶部工具栏与右侧面板均按实测14pt显示，深色模板标题为白色。最终后端Render Contract 23，缓存升级与当前源码指纹一致。最新全量npm test为3112项、3111通过/1跳过/0失败；最后小修的相关服务端回归全部通过。完整证据、未解决的内容提示与打包限制以执行计划顶部最新状态表为准。本轮尚未提交、未推送、main未改。
