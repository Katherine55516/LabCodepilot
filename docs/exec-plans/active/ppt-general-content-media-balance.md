# PPT 跨模板/跨输入通用化：页数–内容–组件联合规划

> 创建时间：2026-10-08
> 最后更新：2026-10-08（Phase 0–1）
> 依据：`docs/research/ppt-alpha-mining-layout-content-gamma-review-20261008.md`（第 7–9、16–28 节）、工作区原型 `/Users/dongli/Documents/ChatGPT/CodePilot/prototype.html`、7 份本地 Gamma 成稿与模板的 OOXML 统计、两次 Gamma 实机观测（Compiler × Alpha Mining，Sample Size × 09_factor_testing）
> 关联：`active/ppt-gamma-depth-design-editor.md`（页数估算/版式/编辑器的上一轮）；`completed/ppt-general-render-contract.md`（共享渲染契约，本计划沿用）

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | 基线合并、评测 harness、Gamma 参照区间、当前基线报告 | 🔄 进行中 | 基线 commit、harness（estimate/inspect/run）、参照区间与基线报告已完成；真实模型运行受环境阻塞，见“Phase 0–1 实施记录” |
| Phase 1 | P0：估算不再崩溃、代码展示策略、双语配对计量、规划假设清单 | ✅ 已完成 | 本地验收全部通过；prompt 契约升到 v9 |
| Phase 2 | 模板组件档案；映射模式继承模板媒体 | 📋 待开始 | 模板 IR 缓存版本升级 |
| Phase 3 | 内容供给 × 页数联合分配；prompt 契约 v10 | 📋 待开始 | |
| Phase 4 | 版式原型库、可变槽位、媒体随页数伸缩 | 📋 待开始 | 替换“重叠 35% 即移除”的规则 |
| Phase 5 | 门禁、修复阶梯、有界 polish | 📋 待开始 | |
| Phase 6 | 原型对齐的 UI 接入、真实模型矩阵验收、交接/产品文档 | 📋 待开始 | |

## 决策日志

- 2026-10-08（用户）**输出语言与输入语言保持一致。** 平行双语输入的成稿保留两种语言。每个英中配对算**一条内容**，用于重复判定和深度计数；两种语言**分别计算版面占用**。研究文档第 28.2 节提出的 `primary_with_key_terms`（Gamma 的“英文正文 + 中文术语标签”）不作为默认，也不作为自动选项。因此双语输入的页数可以高于 Gamma；与 Gamma 比较密度时，按单语等价口径计算（见“验收指标”）。
- 2026-10-08（用户）**非代码模板遇到讲解性代码：不上页，并说明。** 公式、阈值和代码表达的流程逻辑保留为文字、步骤或公式。说明写入规划假设清单，用户可在 syllabus 中改为保留。以下两种情况保留代码，并沿用现有 CodeBlock 逐字门禁：模板有代码组件；用户在输入或要求中明确要求代码。
- 2026-10-08（用户）**映射模式也必须保留媒体。** 映射模式不再只继承配色和字体，必须带上模板的组件与媒体档案。
- 2026-10-08（用户）**真实模型评测预算不设限。** 真实模型矩阵是必经验收步骤，不能用模拟结果替代。
- 2026-10-08 **“以 Gamma 为标准”定义为相对模板的区间，不是固定数字。** 本地 Gamma 样本中每页字符为 322–950，每页图片为 0.3–4.2，差异来自模板和内容；任何单一字数、图片数或页数都不能作为通用目标。
- 2026-10-08 **Phase 0 先提交基线。** codex 遗留的未提交 PPT 改动（渲染契约、输入范围 harness、硬规则修复）原样提交为 `b963592`，之后的改动是干净的增量。
- 2026-10-08 **评测 harness 不做模拟模型的端到端运行。** 现有模拟器为 Factor Zoo 定制，模拟内容也不能代表写作质量。mock 层改为：estimate（确定性的页数/假设/分配指标）和 inspect（任意 PPTX 的平衡指标）；端到端只走真实模型适配器（cli / routine），另有 dry 适配器验证接线。
- 2026-10-08 **流式图不再按代码处理。** fenced 的 ASCII/mermaid 流程图转为有序步骤（ProcessBlock，保留 `diagramSource`）；同一章节中表达同一流程的第二个流程图标记为 `merged_equivalent`，只呈现一次，并写入规划假设。表格永不合并。
- 2026-10-08 **流程不变。** 按原型执行：选模板 → 输入与生成要求（页数估算 3–50、手动设置不被覆盖、“采用当前建议”）→ Syllabus 确认 → 生成（生成中可修改要求）→ 编辑 → 导出。不新增必经页面，不写任何模板名或教程名分支，不引入成本模型。

## 目标与非目标

**目标（对所有模板和输入成立）：**

1. **不重复填写**：可见内容都有来源归属，每条内容只在一页展开；不靠复写、换说法或填满固定槽位来凑篇幅。
2. **媒体不大量消失，并随页数伸缩**：以模板的媒体分布为基准。页数减少时，先减装饰性媒体；页数增加时，媒体同步增加。证据类媒体（图表、数据表、来源原图）只由来源决定，不编造。
3. **分布、深度、密度合理（以 Gamma 为标准）**：按独立问题分页；每页密度落在同类模板的 Gamma 区间内；保留优先级为：流程/规则/数字/公式/枚举 > 限定条件 > 机制说明 > 动机与替代方案。

**非目标：** 复制 Gamma 的 UI 或账户限制；逐像素复刻 Gamma 版式；没有来源数据时生成图表；本计划不新增“AI 自动生成装饰图”（编辑器中现有的单图 asset task 保持不变）。

## 验收指标（通用定义）

评测 harness 从最终 PPTX、Deck IR 和来源 inventory 计算以下指标。阈值是初始值，Phase 0 用 Gamma 参照数据校准后写回本节。

### A. 重复

| 编号 | 指标 | 规则 |
|---|---|---|
| A1 | 无归属内容占比 | 可见正文单位中，没有绑定 `sourceUnitId/claimId` 的部分 ≤ 5%。标题、标签和模板固定文字不计入 |
| A2 | 跨页近重复 | 同一语言内，两段正文的字符 4-gram Jaccard ≥ 0.6，或二者的 claim 集合相同，即为 error；声明了 `repeatPurpose ∈ {recap, application}` 的除外 |
| A3 | 页内近重复 | 同页两个内容块 Jaccard ≥ 0.5 为 warning，≥ 0.7 为 error |
| A4 | 槽位如实 | 重复项组件（卡片/步骤/网格）的填充数 ≤ 分配给该页的不同 claim 数；多余槽位通过变体删除，不得填充 |
| A5 | 双语配对 | 译文与原文共享 claim ID，不计重复、不计新增内容；两侧的数字、变量、否定词和条件词集合一致 |

现有 `inspectVisibleCopy`（`apps/cowork-server/lib/ppt-copy-integrity.mjs`）只检查规范化后完全相同的文本和 claim 主归属。A1–A4 为新增检查，A5 重用 `repeatPurpose: 'translation'`。

### B. 媒体伸缩

模板组件档案按角色统计每张内容页的媒体密度 `ρ_r`，角色分为：hero 大图（≥ 12 in²）、item 图标/小图（< 1.2 in，绑定到重复文字组）、卡片媒体、背景/装饰带、证据（图表/数据表/截图）。

| 编号 | 指标 | 规则 |
|---|---|---|
| B1 | 守恒比 | `C = Σ 实际_r / Σ 期望_r`（证据类除外）∈ [0.7, 1.6]。期望_r = `ρ_r × 输出内容页数 × 调整系数_r`；item 媒体按“输出每页条目组数 / 模板每页条目组数”调整，hero 按章节数调整 |
| B2 | 角色不归零 | 模板中 `ρ_r > 0` 的角色，在输出中不得为 0，除非媒体台账对该角色写明理由（如内容无条目组） |
| B3 | 文字页连续上限 | 模板 ≥ 50% 的内容页带媒体时，输出不得出现 ≥ 3 张连续纯文字内容页 |
| B4 | 单调性 | 同一输入在 N 页和 1.5N 页下生成：媒体总数(1.5N) ≥ 媒体总数(N)；0.6N 时先减装饰/hero，item 媒体随条目数变化 |
| B5 | 证据媒体 | 来源原图、表格、图表 100% 保留或有经验证的等价对象（沿用现有门禁）；旧模板中的证据类媒体不得冒充当前数据 |

参照数据：Deal Review 模板 8 页 20 张图 → Gamma Alpha Mining 8 页 20 张（C≈1.0）；Process Improvement 模板 8 页 17 张（9 个图标 + 8 张大图）→ Gamma Factor Zoo 10 页 42 张（26 个图标 + 11 张中图 + 5 张大图）。内容变密时，Gamma 把大图换成条目图标，总量不降。反例：Factor Zoo × Process Improvement 的模块映射模式运行，模板媒体全部丢失。

### C. 分布

| 编号 | 指标 | 规则 |
|---|---|---|
| C1 | 问题保底 | 页数 ≥ 独立问题数时，每个独立问题（顶层章节，或含独立决策的子节）至少拥有 1 页；页数不足时显式合并，并在 syllabus 中给出映射 |
| C2 | 大章封顶 | 单个问题默认 ≤ 3 页、详细档 ≤ 4 页；枚举项超过一页容量时可例外，需写明理由 |
| C3 | 每页密度 | 正文页的可见单位落在同类模板 Gamma 区间 [P10, P90] 内；低于下限的页只能是封面、分隔页或结尾 |
| C4 | 纵向填充 | 内容页 75–90%（模板自带大面积留白的版式除外，以模板档案为准） |
| C5 | 页数估算 | 单语等价口径下，估算页数相对 Gamma 自动规划的偏差 ≤ 20%；双语、保留代码等策略带来的增量必须写进估算说明 |

### D. 深度

| 编号 | 指标 | 规则 |
|---|---|---|
| D1 | 枚举完整 | 页数 ≥ 推荐值时，来源中的可枚举条目 100% 可见；少于推荐值时，省略项写入台账 |
| D2 | 限定条件 | 保留下来的数字，其同句限定词（one-way、annualized、monthly、long-only、gross/net、in-sample、单边、年化等）100% 保留 |
| D3 | 编造为零 | 可见数字和专名必须能在来源中找到；`expert` 来源规则下的通用解释不得含新数字 |
| D4 | 每页深度 | 内容页 ≥ 2 条不同 claim，且至少 1 条带机制或条件；详细档要求更多机制/条件，由 Phase 0 校准 |

### E. 版式适配

沿用渲染契约的门禁：不越框；H2 标题在角色字号下单行；正文块 ≤ 3 行；字号不低于角色字号，除非走到 `minShrinkPt` 兜底，且兜底要记录。

## 现状根因（代码位置）

| 问题 | 根因 | 位置 |
|---|---|---|
| 重复填写 | 页数估算偏高（09 输入为 46 页，Gamma 为 24 页），事实不够时，固定槽位只能被填满 | `ppt-density-packing.mjs` `sourceDensityPlan`（代码按实测全高计成本；双语两侧都计成本且不识别为同一 claim） |
| 重复填写 | 只检查完全相同的文本；近义改写、槽位超填、无归属内容都检测不到 | `ppt-copy-integrity.mjs` `inspectVisibleCopy` |
| 媒体消失 | 内置模板和上传后被判为 mapped 的模板只有配色和字体（“source geometry is not reused”） | `ppt-template.mjs:14,225`；`ppt-api.mjs:1084–1089` |
| 媒体消失 | 正文区域替换时，与区域重叠 ≥ 35% 的图片、编号、连线一律退役，没有替代 | `ppt-source-artifacts.mjs:17–35`（`replaceTemplateSourceRegion`），调用方为 `bindSourceArtifacts:43`、`bindSourceMedia:109` |
| 媒体消失 | 旧主题示例媒体因主题不符被退役后，不找同角色的替代 | `ppt-template-fidelity.mjs:220–222`；`ppt-template-dispositions.mjs` |
| 媒体消失 / 分布 | 容量拟合只有单栏堆叠和双等宽栏两种，没有带条目图标的卡片、步骤、图文分栏 | `ppt-density-capacity.mjs` `fitComponents`；`ppt-layout.mjs` 中 10 个语义 layout |
| 分布 | 页数按来源字节比例分配（09 输入：§2 分到 13.98 页，§10 分到 0.37 页） | `ppt-density-packing.mjs`、`ppt-planning.mjs` `estimatePageRecommendation` |
| 密度 | 只有一份 8 页样本的密度 profile（674 units）；容量估算正文行高取 1.18，而 Gamma 正文为 1.35 | `ppt-density-profile.mjs`；`ppt-density-capacity.mjs:79–100` |
| 稳定性 | 表格解析把行内数学里的 `|` 当成分隔符，行宽不一致时直接 throw，整个估算失败 | `ppt-content-inventory.mjs:12` `markdownRows`；`ppt-density-capacity.mjs:75` |

## 详细设计

### 总体结构：四层，对模板和输入都通用

```
模板 ──► ① 模板组件档案 ─┐
                          ├─► ③ 联合规划：页数 → 每页版式原型 → 槽位数 → 媒体计划 ─► ④ 门禁与修复 ─► 导出
输入 ──► ② 内容供给清单 ─┘          （syllabus 展示并允许修改）
```

“详细程度决定解释深度；模板决定呈现方式”（原型原文）：①决定呈现方式，②与详细程度决定内容量，③把二者对齐。

### ① 模板组件档案 `templateComponentProfile`（v1，存入模板 IR 缓存）

在 `ppt-template-scheduler.mjs` 的 `profileTemplateSlide` / `catalogTemplateLayouts` 基础上扩展，每个模板分析一次。

- **每页**：版式原型（`family` 扩展为 image-split / two-panel / collection-grid / numbered-steps / media-text / table / chart / diagram / text）；标题/正文/标签槽位的角色、容量、字号、实际行距；`minTextPt`。
- **重复文字组**：几何相同、按行列排布的文字组即条目组，记录组数、方向和间距，以及能否增减（`variableCount: {min, max, reflow}`）。
- **媒体角色**：每个图片/形状按尺寸、位置和是否与条目组对齐，分为 hero / item / card-media / background / decorative-band / evidence；记录资产 hash 与可裁剪变体（沿用 `TEMPLATE_VARIANTS`）。
- **全模板汇总**：各角色的 `ρ_r`、带媒体的页面比例，以及“媒体节奏”（例如每章首页有 hero）。
- **内置模板**：在 `BUILT_INS` 中声明档案。媒体角色由原生结构组件承担（编号徽章、卡片框、分隔带），图片槽位优先使用来源图片；没有来源图片时用原生装饰组件，不放占位假图。

### ② 内容供给清单 `contentSupply`

由 `ppt-content-inventory.mjs` 的 inventory 派生：

- `claims[]`：不同的事实、规则、机制，含 sourceUnitIds 与优先级等级（见③中的保留阶梯）；
- `enumerations[]`：条目数与条目文本；`procedures[]`：步骤及顺序；
- `numbers[]`：值、单位、同句限定词；`formulas[]`；`tables[]`；`sourceImages[]`；
- `codeBlocks[]`：附带 `presentation: keep | omit_with_disclosure`（按决策 2 推导）；
- `languagePairs[]`：`languagePairId`、主/次语言、对齐置信度；
- `questions[]`：独立问题（顶层章节，或含独立决策的子节）及其 claim 集合。

### ③ 联合规划

1. **页数**：问题保底（C1）+ 大章封顶（C2）。在封顶范围内，按保留阶梯装填：流程/规则/带单位数字/公式/枚举 → 限定条件 → 每条规则一句机制 → 动机与替代方案。双语配对按两种语言的版面占用计入容量；被省略的代码不计。容量取自模板档案的角色字号和实际行距。估算说明列出依据，例如“15 个问题；代码不上页；双语按两种语言排版”。
2. **供给上限**：用户选择的页数超过“供给可支撑的最大页数”时，估算说明给出提示和建议值。多出的页只能来自更深的内容（详细档下的机制、条件、例子）或声明过的回顾，**不得填充或改写重复**。
3. **版式原型**：每页按内容关系，从模板档案中选能表达该关系的原型：n 个并列条目 → collection-grid（条目数 = n），有先后 → numbered-steps，对照 → two-panel，单一主题配图 → image-split，数值例子 → table + notes。同一原型避免连续使用（沿用调度器的相似度惩罚）。
4. **槽位数**：由内容决定。上传模板中有重复文字组的页面可以克隆或删除组（组内几何重排，每个条目的媒体随条目一起），不再“填满或删除”。
5. **媒体计划 `mediaPlan`**：
   - item 媒体随条目组走；
   - hero/装饰按模板节奏，并随章节数伸缩；
   - 页数减少时先减装饰和 hero，页数增加时复用带媒体的原型与模板资产（通过裁剪/镜像变体保持多样）；
   - 证据类媒体只来自来源。

   每个模板媒体角色在**媒体台账**中有处置记录：kept / rebound / replaced / reduced，每条附理由。
6. **双语**：标题用“主语言标题 + 次语言副行”角色。正文配对用一个组件承载两种语言，次语言为较小字号的 run；不拆成两个独立内容块，避免看起来像重复。模板若有专门的双语槽位，优先使用。

### ④ 门禁与修复

- 门禁：A–E 全部进入生成路径的 `deterministicReview`，与 `ppt/quality-service.mjs` 共用。
- 修复阶梯：重排（换原型或变体）→ 重新分配 claim → 删减（只删阶梯最低一层）→ 拆页提议 → 缩字到 `minShrinkPt`。不得通过填充、复写或删除媒体角色来通过门禁。媒体问题先尝试重新绑定，再考虑省略。
- 有界 polish：版式测量后，对填充超过上限或末行只有一个词的页删减 1–5%。不动阶梯前两层，删减后重新测量并记录差异。

## 分阶段实施

### Phase 0：基线与评测 harness

- 0.1 合并 codex 尚未提交的 PPT 改动（`git status` 显示约 30 个 `apps/cowork-server/lib/ppt*` 文件已修改），记录基线 commit。
- 0.2 新增评测脚本 `apps/cowork-server/scripts/ppt-balance-eval.mjs`，支持：
  - fixture 与模板注册（含 hash）；
  - mock 和 real 两种运行方式；
  - 读取最终 PPTX、Deck IR 和 inventory，计算 A–E 指标，输出 JSON 与 Markdown 报告。
- 0.3 新增 Gamma 参照提取：从本地 Gamma PPTX 计算每页字符、各角色媒体数、组件类型；Sample Size 与 Compiler 两次实机只有 DOM 数据，读取已存的 DOM 测量。结果写入 `apps/cowork-server/lib/ppt-gamma-reference-bands.json`（带版本），按模板类别给出 [P10, P90]。
- 0.4 评测矩阵：

  | 维度 | 取值 |
  |---|---|
  | 输入 | `quant_3.0/` 下的 `09_factor_testing.md`（双语、代码、公式）、`04_factor_zoo_overview.md`、`10_alpha_mining.md`、`11_backtesting.md`；以及短提示业务汇报、CSV/XLSX 表格输入、纯英文文档、纯中文文档 |
  | 模板 | Deal Review（照片多）、Process Improvement（图标 + 照片）、Performance Review Framework、Capabilities Overview，以及内置 Education、Light |
  | 模式 | 保真（preserve）、映射（mapped） |
  | 页数 | 估算值、0.6×、1.5× |

  真实模型（决策 4）：8 个输入 × 4 个上传模板 × 估算页数，另加 2 个输入 × 2 个模板 × 0.6×/1.5×，共 40 次运行；完整矩阵用 mock 跑确定性层。
- 0.5 产出当前代码的基线报告，存入 `outputs/ppt-general-balance-baseline-YYYYMMDD/`。

**验收**：mock 矩阵可重复运行；至少 1 个真实模型用例端到端产出 PPTX 与指标；基线报告列出每项指标的当前值。

### Phase 1：P0 修复（小改动，各自独立提交）

- 1.1 **估算不崩溃**：`markdownRows` 把 `$…$`、`\(…\)`、反引号内的 `|` 视为普通字符；行宽不一致时规范化并记录 `tableGeometryWarning`，估算只降级、不 throw；严格校验留在导出门禁并给出定位。涉及 `ppt-content-inventory.mjs`、`ppt-density-capacity.mjs`、`ppt-planning.mjs`。
- 1.2 **代码展示策略**（决策 2）：
  - `codePresentation` 推导：模板档案有代码组件，或用户意图明确要求代码 → `keep`；否则 `omit_with_disclosure`。
  - 代码块中带框线字符且无程序语法的 ASCII 图 → `ProcessBlock`。
  - 省略的代码不计成本，在 `ppt-object-integrity.mjs` / `ppt-obligations.mjs` 中记为“按策略省略”，不算违规。
  - 涉及 `ppt-source.mjs`、`ppt-semantic.mjs`、`ppt-content-inventory.mjs`、`ppt-density-packing.mjs`。
- 1.3 **双语配对计量**（决策 1）：
  - 识别相邻、文字系统交替、数字/变量/专名可对齐的段落，生成 `languagePairId`；
  - 配对共享 claim（A5），两侧都计版面；
  - prompt 契约（`ppt-prompt-contracts.mjs` 第 58–60 行）明确：follow_input 指配对呈现同一条内容，不翻倍事实；
  - 增加配对一致性检查（数字/变量/否定/条件词集合）。
- 1.4 **规划假设清单**：`estimatePageRecommendation` 与大纲结果附带 `planningAssumptions[]`，字段为 `{topic: code|language|merge|omission|media, decision, reason, affectedSourceIds, reversible}`。`PptCreateWizard.tsx` 的 Syllabus 面板展示该清单，并提供“代码：不上页/保留”切换；切换后只重新估算受影响的分组。

**验收**：09 原文件估算正常返回；在保留双语、代码不上页时，估算落在 26–34 页（改造前的反事实值为 31），说明中写明双语和代码的处理；切换为保留代码后估算上升并给出原因；新增自测 `selftest-ppt-balance-p0.mjs`；`npm run test` 通过。

### Phase 2：模板组件档案与映射模式媒体继承

- 2.1 按“①”实现 `templateComponentProfile` v1，模板 IR 缓存版本 +1，旧缓存触发重新分析。涉及 `ppt-template-scheduler.mjs`、`ppt-template-fidelity.mjs`、`ppt/template-preview-service.mjs`。
- 2.2 映射模式（决策 3）：
  - 上传模板分析时除配色和字体外，还提取媒体资产、角色与布局原型（经过 `ppt-template-security.mjs` 的限制）；
  - `ppt-layout.mjs` 的确定性版式增加媒体槽位（image-split、item 图标卡、装饰带）；
  - 映射导出按角色放置模板资产；
  - 内置模板在 `BUILT_INS` 中声明档案。
- 2.3 档案校对：对 6 个本地模板手工计数，与档案输出对照（例如 Process Improvement 应有 9 个 item 图标和 8 张 hero；Deal Review 应有 7 个图标、8 张中图、5 张大图）。

**验收**：6 个模板的档案与手工计数一致；Factor Zoo × Process Improvement 在映射模式下 B1/B2 达标（之前为 0）；模板安全和模板注册自测通过。

### Phase 3：内容供给 × 页数联合分配

- 3.1 实现 `contentSupply`（见“②”），新增 `ppt-content-supply.mjs`，供 `ppt-density-packing.mjs` 与 `ppt-planning.mjs` 使用。
- 3.2 页数分配改为“问题保底 + 大章封顶 + 保留阶梯”，容量使用模板档案的角色字号和实际行距（替换 1.18）。手动页数沿用同一算法重新分配（原型规定手动设置不被覆盖）。
- 3.3 加入供给上限提示；多出的页只来自更深的内容或声明过的回顾。
- 3.4 prompt 契约升到 v9，review rubric 同步。要点：
  - 保留阶梯；
  - 限定词保留（D2）；
  - ≥ 3 组“标签/数值”的正文例子改为原生表格；
  - 双语配对一致；
  - 禁止为填满槽位而改写。

  涉及 `ppt-prompt-contracts.mjs`、`ppt-generation-policy.mjs`、`ppt/versioning.mjs`。

**验收**：4 份教程输入的 C1/C2 全部达标；C5 在单语等价口径下偏差 ≤ 20%；1.5× 页数时 A2 = 0，且 D4 上升；D2、D3 达标。

### Phase 4：版式原型、可变槽位与媒体伸缩

- 4.1 版式原型库：image-split、two-panel（不等宽）、collection-grid（含条目媒体）、numbered-steps、公式侧栏、table + notes、big-number + cards、timeline、comparison。每个原型定义条目数范围、条目媒体绑定和角色字号，容量用共享渲染契约测量。保真模式和映射模式共用。涉及 `ppt-layout.mjs`、`ppt-density-capacity.mjs` `fitComponents`、`ppt/point-layout.mjs`、`ppt/render-tree.mjs`、`ppt/render-contract.mjs`。
- 4.2 可变槽位：保真模式下，有重复文字组的模板页可以克隆或删除组，组内重排，条目媒体随条目。`replaceTemplateSourceRegion` 的“重叠 ≥ 35% 即退役”改为按角色处置：item/卡片媒体重新绑定；装饰类保留为保护区；只有旧数据的证据类媒体退役，并由原型或台账说明替代方式。
- 4.3 媒体计划与台账（“③”第 5 条），满足 B1–B4；页数增加时复用 `TEMPLATE_VARIANTS` 保证多样性。
- 4.4 fit 顺序：重排 → polish 删减 → 拆页提议 → 缩字到 `minShrinkPt`。角色字号与 `minShrinkPt` 分为两个字段。

**验收**：矩阵中 B1–B4 全部达标；A4 = 0；preview、PPTX、PDF 中原型渲染一致；B4 用 N 与 1.5N 两次运行验证。

### Phase 5：门禁、修复与 polish

- 5.1 A–E 门禁进入 `ppt-quality.mjs` 的 `deterministicReview`（生成路径）和 `ppt/quality-service.mjs`，severity 与台账统一。
- 5.2 修复阶梯（“④”），最多 2 轮，未收敛则保持 blocked 并给出定位。
- 5.3 有界 polish（1–5%）。

**验收**：负例 fixture 全部被拦截：近义改写重复、槽位超填、删光图标、连续纯文字页、过满页、丢失限定词；正例在 2 轮内收敛。

### Phase 6：原型对齐 UI、真实模型验收与文档

- 6.1 按原型接入（不新增步骤）：

  | 原型位置 | 改动 |
  |---|---|
  | Step 1 选模板（“模板初始 N 页”） | 后台生成模板组件档案；预览不变 |
  | Step 2 页数估算与设置 | 估算说明列出依据和策略；保留“采用当前建议”和手动设置；超过供给上限时提示 |
  | 内容生成策略（标准/详细，输出语言与输入一致，来源规则） | 不新增选项；详细档影响保留阶梯的深度 |
  | Syllabus | 每章分到的页数、每页计划原型（如“4 卡片 + 图标”）、规划假设清单与代码开关；编辑后只做局部重估 |
  | 生成中 | 每页状态（writing / checking / polishing / ready / blocked），接在 `PptGenerationMonitor.tsx` 与已有 run 事件上 |
  | 编辑器 | 原型的 `editorAiLayoutCandidates` 对应“同一内容换原型”，由 4.1 的原型库提供，不调用 LLM 改写文字；保真模板中受限的部分沿用现有提示 |

- 6.2 i18n 同步 `src/i18n/en.ts`、`zh.ts`（以及 zh-HK 覆盖）；按 CLAUDE.md 用 CDP 验证桌面和移动视口；`npm run test`、`npm run test:smoke` 通过；测试后关闭 dev server。
- 6.3 真实模型矩阵（40 次运行）：产出与 Gamma 参照区间的对比报告，并列出残留问题。
- 6.4 交接文档 `docs/handover/ppt-general-content-media-balance.md` 与产品文档 `docs/insights/ppt-general-content-media-balance.md`，两者互链。

**验收**：真实模型矩阵中 A–E 达标率 ≥ 90%，未达标项有定位和后续计划；UI 用 CDP 截图验证无 console 错误。

## 依赖与风险

| 风险 | 处理 |
|---|---|
| codex 在同一批文件上有未提交改动 | Phase 0 先合并并记录基线，之后每个 Phase 小步提交 |
| 模板 IR 缓存与 prompt 契约版本升级，导致旧项目重新分析、旧评审失效 | 版本号显式递增，旧项目首次打开时重新分析；评审缓存按契约版本失效（沿用现有机制） |
| 双语输入页数高于 Gamma | 决策 1 接受；估算说明写明原因；对比用单语等价口径 |
| 内置模板没有图片资产 | 由原生结构组件承担媒体角色；不生成假图，不放占位图 |
| 可变槽位破坏模板原生几何 | 只在档案标记 `variableCount.reflow` 的组内重排；导出后用渲染契约与 OOXML 复核 |
| 真实模型输出波动 | 每个用例跑 2 次，取两次中较差的指标作为结论 |

## 回滚

每个 Phase 有独立开关（`generationPolicy` 契约版本，以及 `templateComponentProfile` 版本）；回滚即切回上一版本，已生成项目不受影响。Phase 1 的估算鲁棒性修复不设开关。

## Phase 0–1 实施记录（2026-10-08）

### 环境与基线

- 基线 commit：`b963592`（codex 遗留改动）。其上 tsc 通过，单元测试 2808 通过、1 跳过，32 个 `selftest-ppt*.mjs` 全部通过。
- 测试运行时：`density / export-integrity / hard-rules` 自测需要 python-pptx + LibreOffice。系统 python3 下这三项会因缺 `pptx`/`soffice` 失败（环境问题）。本机可用：
  - `PPT_TEST_PYTHON=~/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3`
  - `PATH` 前置 `…/dependencies/bin/override`（提供 `soffice`）
- 本机无 Docker、无本地 Claude CLI，真实模型运行受阻（见技术债务追踪）。

### Phase 0 交付

| 交付 | 位置 | 说明 |
|---|---|---|
| 评测脚本 | `apps/cowork-server/scripts/ppt-balance/ppt-balance-eval.mjs` | `estimate` / `inspect [--write-bands]` / `run --adapter dry\|cli\|routine` |
| PPTX 检查 | `scripts/ppt-balance/pptx-inspect.mjs` | 只用 Python 标准库；处理组合形状变换、占位符、图片、表格、图表 |
| 指标 | `scripts/ppt-balance/metrics.mjs` | A 重复（4-gram Jaccard）、B 媒体（按尺寸分角色、相对模板守恒比、连续纯文字页）、C 密度/填充、D 数字（来源外数字候选、限定词丢失） |
| 矩阵 | `scripts/ppt-balance/matrix.json` | 8 个输入、7 个模板、6 份 Gamma PPTX + 1 份 Gamma DOM 样本、3 份模块产物 |
| 参照区间 | `apps/cowork-server/lib/ppt-gamma-reference-bands.json` | 由 Gamma PPTX 计算；观测值，不是硬阈值 |
| 基线报告 | `outputs/ppt-general-balance-baseline-20261008/` | `estimate.json`、`inspect.json`、dry run 记录（outputs 不入库） |

**基线结论（同源、同模板对比）：**

| 成稿 | 媒体守恒比 C | 归零的媒体角色 | 最长连续纯文字页 | 跨页近重复 | 正文单位 P50 |
|---|---:|---|---:|---:|---:|
| Gamma · Alpha Mining × Deal Review | 1.00 | 无 | 1 | 0 | 561 |
| 模块（模拟）· Alpha Mining × Deal Review | 0.16 | medium、icon | 2 | 0 | 357 |
| Gamma · Factor Zoo × Process Improvement | 1.99 | 无 | 0 | 0 | 659 |
| 模块（模拟）· Factor Zoo × Process Improvement（22 页） | 0.96 | 无 | 1 | 0 | 260 |
| 模块（模拟）· Factor Zoo × Mood Board（21 页） | 0 | large、medium、icon | 20 | 12（页内 24） | 266 |

- 估算基线：09 输入 16 个章节中 11 个分到不足 1 页，最大章节 11 页（C1/C2 留待 Phase 3）。
- Gamma Factor Zoo 中出现来源外数字（“2.0”“3.0”“50%”“2016”“2020”），说明 Gamma 不是零编造；D3 对模块仍按零容忍执行。
- dry run（09 × Process Improvement，保真模式）：模板上传、模板 IR 导入、建项目、解析、策略、估算（自动 32 页、带模板容量重估 34 页）和大纲 prompt 组装全部打通。首个模型调用为 **405,700 字符**，已记入技术债务。

### Phase 1 交付

| 项 | 实现 | 位置 |
|---|---|---|
| 1.1 估算不崩溃 | 表格单元格按行内数学/代码识别竖线（Pandoc 规则，`$5 \| $10` 仍正常拆分）；行宽不一致时补齐或并入最后一列，并记录 `source_table_ragged_rows`；容量计算异常降级为 `capacity_estimate_failed` 警告 | `ppt-content-inventory.mjs`（`splitTableRow`、`normalizeTableRows`）、`ppt-planning.mjs` |
| 1.2 代码展示策略 | `codePresentation`：用户选择 > 用户要求 > 模板代码组件（等宽字体）> 默认不上页；省略的代码不计成本，不算必保留对象，覆盖记录写明 `omitted_by_policy`；ASCII/mermaid 流程图转为步骤 | `ppt-presentation-policy.mjs`、`ppt-semantic.mjs`、`ppt-density-packing.mjs`、`ppt-content-inventory.mjs` |
| 1.3 双语配对 | 相邻、文字系统交替、长度比合理、多位数字一致的段落标为 `languagePairId`；配对算一条内容，两种语言都计版面；prompt 说明成对呈现与一致性 | `ppt-presentation-policy.mjs`（`markLanguagePairs`）、`ppt-density-packing.mjs`、`ppt-prompt-contracts.mjs` |
| 1.4 规划假设清单 | 估算返回 `assumptions / warnings / reasonBase`；创建向导在页数设置下展示清单与“代码”选项（自动/保留/不上页），修改后重新估算；Syllabus 面板提示 | `ppt-planning.mjs`、`ppt-api.mjs`、`PptCreateWizard.tsx`、`PptWorkspace.tsx`、`types.ts`、i18n（zh / zh-HK / en） |
| 契约 | `generationPolicy.code.presentation`（auto/keep/omit）可选；prompt 契约 8 → 9，`<policy>` 加入 presentation_policy；`source_objects` 排除被策略省略/合并的对象 | `ppt-generation-policy.mjs`、`ppt-prompt-contracts.mjs` |

**验收结果：**

- 09 原文件估算不再抛异常，阈值表为 3 列。
- 默认（代码不上页、双语保留）为 **32 页**，范围 31–38，落在 26–34 目标内；改为保留代码时为 44 页，估算说明写明原因。
- 2 张流程图转为步骤，1 张重复的 mermaid 流程图合并，识别出 84 组双语配对。
- 新增自测 `selftest-ppt-balance-p0.mjs`。
- 33 个 PPT 自测、tsc、单元测试 2808/2809（1 跳过）通过。
- 新增 e2e `ppt-planning-assumptions.spec.ts`。smoke 共 39 项：首轮 8 项因冷启动编译在 30s 超时，重跑全部通过。
- 桌面与 390 宽截图检查无横向溢出。

**尚未完成（Phase 0 剩余）：** 真实模型矩阵（40 次运行）需要 Cowork/Docker 环境，或本地 `PPT_EVAL_CLAUDE_BIN`。命令示例：

```
PPT_EVAL_CLAUDE_BIN=/path/to/claude PPT_TEST_PYTHON=… node apps/cowork-server/scripts/ppt-balance/ppt-balance-eval.mjs run --input factor-testing --template process-improvement --adapter cli
```

