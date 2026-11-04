# PPT 结构识别与表示转换 P0（2026-10-19）

> 来源：`ppt-gamma-results-20261013/PPT_KnowledgeBase_Run_Review_20261019.md` 第四节 P0-1～P0-3。
> 触发样例：`knowledge_base.md`（审计知识库建设方案）两次运行都在大纲阶段失败（`source_artifact_capacity`）。

## 背景

技术方案文档常用代码围栏写四类“非代码”内容：ASCII 分层架构图、目录树、带编号或箭头的流程、YAML 配置示例。旧的解析器有三个问题：
1. 方框图和目录树只要含有 `├`，就被统一判成“分支图”（ComparisonBlock，literal_source_lines），要求 18pt 原样排版。单行超宽时任何分页都救不回来，大纲直接失败。
2. 写在围栏里的流程被当成 CodeBlock，而概览默认策略 `code.presentation:'omit'` 会把它们全部丢掉，例如编译 9 步、问答链路。
3. YAML 示例的值里只要出现 “schema” 字样，就被误判成 field-value 表。

## 改动

| 编号 | 改动 | 位置 |
|---|---|---|
| P0-1 | 新模块 `ppt-source-structures.mjs`，只接受形状明确的结构：<br>· `layerStackRows`：单外框加 `├─┤` 分节 → [层级, 组成与职责]；<br>· `directoryTreeRows`：`├──`/`└──` 加 `# 注释`，七成以上节点是路径 → [目录, 作用, 包含]，长条目按 140 字分行，深层名称按顺序折叠；<br>· `annotatedListRows`（`项  # 说明`）、`labeledFlowRows`（`名称：A → B → C`）；<br>· `textFlowSteps`：编号或圈号行，以及 4 步以上的箭头链，括号内的箭头不切分；<br>· `isConfigListing`、`isLeadInCaption`（只认加粗标签，例如 `**处理步骤**：`）。 | `apps/cowork-server/lib/ppt-source-structures.mjs` |
| P0-1 | `codeDiagram` 的非程序分支先走上述识别器，没有命中时保持旧行为。field-value 的关键词改为必须出现在行首。 | `ppt-presentation-policy.mjs` |
| P0-1 | 引导句合并：纯加粗标签段落如果紧接同一 section 的表格、代码、图或列表，就成为后者的 `caption`，不再单独成为内容单元。caption 会进入读取、语义分组、编辑合并和大纲的来源目录。 | `ppt-semantic.mjs`（`attachLeadInCaptions`）、`ppt-content-inventory.mjs`、5 个提示词目录 |
| P0-2 | 识别结果是可编辑的原生对象：分层、目录、清单、命名流程 → TableBlock（`diagramSource.kind='schema'`，原图保存在 `diagramSource.text`）；流程 → ProcessBlock（text-flow 时间线）。 | 同上 |
| P0-2 | CodeBlock 增加 `codeKind`（config / program）。配置示例不随程序代码省略，按代码卡保留（`codeRetention:'config_listing'`），也不会被强制放进备注。 | `ppt-content-inventory.mjs`、`ppt-presentation-policy.mjs`、`ppt-content-selection.mjs` |
| P0-3 | 等宽代码和图使用独立字号：从页面字号开始逐级下调，直到不折行（preserveLayout 的情况是直到最宽一行放得下），下限 `CODE_FONT_FLOOR_PT=11`；纵向仍放不下时最低可用 12pt 留在一页。测量结果带 `fontSizePt/fontBasis`，节点样式使用同一字号；渲染审核对代码使用 11pt 下限。 | `ppt/render-contract.mjs`、`ppt-density-capacity.mjs`、`ppt-source-artifacts.mjs`、`ppt/render-audit.mjs` |

## 不在本次范围

- P0-4：测量估页按档位和合同计算。现在结构保留得更完整，估页反而升高（knowledge_base：结构页 46 → 50，建议 35 → 37）。
- P0-5：显式页数下的 condense；P0-7：semantic-groups 修复循环（S1–S3）。
- 块引用元数据（`> 版本：…`）仍按 ProcessBlock 识别。

## 验证

- 新增 `selftest-ppt-structure-recognition.mjs`。
- `selftest-ppt-balance-p0.mjs`：真实样例 09 的单元数从 233 变为 232，原因是一个加粗标签成了 caption，测试同时断言 caption 被保留。
- 完整 selftest 与基线对比：见下方“验证记录”。

## 为跑通追加的修复（2026-10-19）

- **S4（只改提示词）**：新模块 `ppt-planning-language.mjs` 提供 `planningLanguageRule`，规划文本使用来源主语言，coreMessage 目标 ≤240 字符。已加到语义分组主提示词、两处修复提示词和编辑合并提示词。触发原因：qwen3.8-max 对中文来源用英文写了 15 个组，其中 10 个超长。
- **批量 coreMessage 修复**：`semanticGroupMetadataSchema/applySemanticGroupMetadataRepair` 支持多组（一次修完所有超长字段，只返回部分组的结果会被拒绝），单组时保持原 schema。
- **配置示例的编辑排除被保留**：重新套用展示策略时，不再抹掉 `excluded_by_policy` 或备注类处理。
- **代码字号回退**：在任何字号下都放不下时保持页面字号，与旧行为一致，交给按行分页处理。

## 验证记录

- 新增 `selftest-ppt-structure-recognition.mjs` 通过；`selftest-ppt-scoped-group-patches`、`semantic-preplanning`、`outline-concision` 通过。
- 完整 selftest 132 个：失败的仍是基线那 25 个，同一批，原因是缺 soffice、写死的 /data 路径等。
- PPT 单元测试 198/198 通过（`ppt-engine-integration` 中的“不折行宽度”测试曾因代码字号回退失败，已修复）。
- 实测（隔离服务 3152/3153，`knowledge_base.md`，qwen3.8-max，自动页数）：大纲 41 页，正文 41/41 生成，没有出现上一轮的 `source_artifact_capacity`。整稿审阅因服务商额度不足（403 `insufficient_user_quota`）没有完成。逐页评审见 `ppt-gamma-results-20261013/PPT_KnowledgeBase_Structure_Rerun_Review_20261019.md`。
