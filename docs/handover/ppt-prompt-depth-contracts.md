# PPT 提示词深度契约：Claude 建议的取舍与落地

更新时间：2026-10-02。适用基线：`bde3303b` 之后本次改动。

## 1. 讨论结论

结合 [现有提示词审计](../research/ppt-prompt-audit-gamma-benchmark-20261002.md) 与用户提供的 Claude 分析，优先解决“内容承诺不具体、写作输出重复、上下文丢细节、审查不回写”四个问题。Gamma 的可见内容深度是参照，字数只用于辅助判断；同样是专业内容，Factor Zoo 与 Deep Learning 样例的平均字数差异很大。

用户确认的事实政策：**文件/粘贴/版本更新仅依据来源；纯 prompt 可以解释通用知识，具体引用与数字需核实。** 本次不增加专家知识默认开关或更换用户选择的模型。用户选择 GPT 做后续真实对照，但说明本地暂不能调用，因此本轮按用户要求模拟 LLM。

| Claude 的建议 | 实施决定与理由 |
|---|---|
| PPT 用独立 system prompt | 采纳；仅 PPT routine 替换默认编码角色，无工具权限继续保留 |
| 明确输出语言 | 采纳；显式语言指令优先，其次来源，再次纯 prompt；编辑请求可以明确指定本次语言；术语及用户锁定标题保留原样 |
| 正向范例、减少禁止事项 | 采纳；解释对象、机制、条件或对照，用完整/浅薄范例明确深度；禁止事项集中在来源及作用范围边界 |
| 字数代替 visual units | 写作指南采用词数/CJK 字数，内部容量仍用原有单位；不把字数设为统一硬下限 |
| 英文标题放宽、降低 brevity 权重 | 非原生正文标题上限从 36 调至 44 units；保留两行与真实布局检查。现有 `compileTitle` 已优先保留能放下的明确标题，故不再无依据调整评分权重；原生模板容量不扩大 |
| 删除 factSynthesis、多个候选标题与三份文案 | 新 prompt 不再请求隐藏事实清单和 3–5 个标题。非原生只请求 `contentBlocks`；原生只请求 `slotTexts`；旧返回结构仍可读 |
| 大纲以实际 key_points 为中心 | 采纳；`keyPoints` 包含具体解释和真实 refs/chunkRefs；角色、密度及预算继续由规划代码推导 |
| exactly-once ownership | 改为“具体要点分工”。同一来源可以支持多页，章节总结可短暂回指；不能用 chunk 仅出现一次的规则破坏必要拆解 |
| 所有来源缺口只放 notes | 不采纳绝对规则。制作元信息不作为正文填充；影响理解的条件、缺失数据及不确定性仍需可见；本轮未新增 exporter notes schema |
| domain brief 单独新步骤 | 在现有 outline 调用里要求主题特有的内容计划，不额外增加模型/搜索步骤。静态 sparse planner 保留为估算和失败恢复参考，不要求原样套用 |
| cards 自动按位置映射原生槽位 | 不采用不可靠的位置猜测；使用已有语义配对，从原生槽位反向派生兼容文案，避免模板长列表/多栏错配 |
| shallow critic + bounded rewrite | 采纳；浅薄解释作为 `missing` 的 `reason=shallow`，保留现有四类报告兼容性；具体修复建议回到原 writer，最多两轮 |
| 小槽位不够就换布局 | 保留现有模板调度和注册版式能力；本轮不加入自动改变模板几何或页数的协商器。必要内容放不下应进入质量门禁，不能以碎句“通过” |

## 2. 修改了哪些提示词和上下文

| 路径 | 现在的契约 |
|---|---|
| `routine-runner.mjs` | PPT 专用系统角色，用户模型/configId 与原凭证代理不变；PPT 提示词走现有 shim 输入帧，避免 Linux 单参数长度限制 |
| `outlinePrompt` 三个入口分支 | 统一语言/来源政策；明确传入用户另行要求；请求具体 `keyPoints`；完整来源表格/公式/代码作为 `source_objects`，不只给目录摘要；旧版上下文读取实际可见 native 文字及表格/图表内容，而不只读旧 bullets |
| outline 修复 | 保留完整 JSON 初稿与用户编辑草稿，不再切断序列化 JSON |
| `contentPrompt` | 读取具体内容承诺、相邻页分工、角色和所需细节；按语言给解释篇幅建议；不要求每页重复同一论证模板 |
| native template prompt | 槽位文字是正文事实源；短标签与完整说明区别对待；正文可用一到两句；源表类别和关系不能只写成名词；容量不足必须报告 |
| `contentRepairPrompt` | 传完整上一稿、shapeId、缺失支撑、诊断原因和可操作 suggestedFix，不只重复“更详细” |
| `deckReviewPrompt` | 看实际可见槽位与内容组件、keyPoints、requiredDetails、完整锁定证据和有界来源；浅薄、表格关系缺失与来源矛盾均需具体报告 |
| 生成后的 object/slide proposal | 同一语言、事实政策、写作指南与相邻页分工；完整 JSON 上下文；原生文本附实际容量、行数、配对和列表结构 |
| typed data/insert/split/style/layout | 共用事实与语言政策；data/insert 使用写作指南；style/layout 保持既有纯样式/布局 schema，不能借机重写内容 |
| 生成中 title mutation | 明确原正文主张、标题预算与语言，仅改标题；content mutation 继续走同一 writer；原有固定范围、epoch 和 Proposal 守卫保留 |
| legacy `/rewrite` | 同一写作指南与完整对象化来源，最多 10 点，不再无条件压成 6 点；对象/单页的实际修改范围不扩大 |

新增共用模块：`apps/cowork-server/lib/ppt-prompt-contracts.mjs`。它负责政策、语言、范例、JSON schema、叙事/来源上下文、兼容适配和 critic 目标选择；不控制坐标、字体、模型路由或导出。

## 3. 数据模型与兼容

- `outline[].keyPoints`: `{text, refs, chunkRefs}[]`；过滤无效编号，合并进入页级 provenance，并保留到 `planning.slidePlan`。旧大纲仍可使用 `supportingPoints`；空 keyPoints 不遮住旧字段。
- `planning.brief.outputLanguage`：由代码确定，不依赖模型猜测。原先文件名中的 `overview/report/tutorial` 可能误触发深度/用途判断，本轮把文件名从用户意图判断中去掉，并复用估算器已有规则。
- 新 writer 输出：非原生 `contentBlocks` → 派生 `bullets`/IR；原生 `slotTexts` → 根据 `purpose/pairedWith` 派生兼容内容块。仍接受旧 `factSynthesis/titleCandidates/bullets/contentBlocks/slotTexts`，并接受 `cards/headline/table` 的兼容输入。
- 原生安全界限仍为普通 slot 5,000 字符、list body 2,000、label 120、最多 30 项。超界拒绝，未静默截断；超过十个原生解释的兼容副本合并尾部，不删除真实槽位文字。非原生正文安全上限不变。
- `modelReview` 保留 `missing/repeated/conflicts/unsupported`；可增加 `reason: shallow` 和 `suggestedFix`。既有客户端报告继续可用，不需要数据库迁移。TypeScript 类型已同步。
- `runtime.criticRepair` 持久化 runId、rounds、页级尝试、前后 hash、诊断和耗时；更新原 DAG 页节点及真实预览事件，不新建无限循环流水线。
- `rubricVersion=2`：旧内容评审即使内容 hash 一致，也不能作为新深度规则的有效评审复用。

## 4. Pipeline 与并发保护

```text
source → 页数估算/用户确认 → outline(具体解释计划)
       → content DAG(每页一份文案) → render/preview
       → 全稿 critic
       → 有界 writer rewrite → 全稿 critic（最多两轮）
       → 既有确定性 repair → 最终质量门禁 → publish
```

每轮按 unsupported/conflicts/missing/repeated 排序，最多取可重写正文页数的 30% 向下取整，至少 1 页。封面、结尾、用户空白页、已接受页、有语义内容锁或活动用户约束的页不自动重写；纯装饰 shape 的锁不会误排除整张原生模板页。

整稿重新审查而非只审被改页：局部重写可能引入跨页重复或前后冲突。代价是额外 critic 调用，换来正确的整稿门禁。未解决的发现保留到最终报告；严格来源深度下 missing/shallow 可阻断发布，不因为达到重写上限就视为修复完成。

提交重写结果前核对 worker lease、runId、语义 hash、页 epoch、状态和暂停请求；保护状态也再次检查。过期结果拒绝，暂停/取消结果不写入；用户新编辑不被旧修复覆盖。两轮计数在调用前持久化，同 run 的暂停恢复不会无限重试。

来源上下文预算以**完整对象**为单位；锁定 evidence 和直接引用 chunk 可越过软预算，其他省略项记录为 `omittedFromContext`。该字段表示未进入本次上下文，不代表来源没有内容，也不授权静默删除必要信息。复杂来源的完全可见语义覆盖仍需后续 SourceRequirement/RenderedFact 账本与真实模型验证。

## 5. 模拟前后示例与验证边界

人工模拟的浅稿：`Exposure: Define exposure from the loading on the systematic return component.`

来源还提供：“Larger loadings imply stronger sensitivity; interpret that sensitivity under the same model assumptions.” 新流程把缺少的解释交回 writer，正文增加敏感性含义及模型假设；再次评审后才进入发布。这个测试证明契约与修复链可执行，不证明真实 GPT 会自动达到相同效果。

专项覆盖：语言/来源政策；真实来源编号过滤；完整表格尾部与公式条件；单份文案及旧 schema；英文标题预算；文件名误判深度；装饰锁/用户锁/接受页/约束页；两轮重写和最终 DAG 结果；重写中暂停；超过命令行参数长度的中文文本经实际 Python shim 完整传递；生成后 Proposal 和生成中 mutation 回归。

真实模型验收安排：固定用户选择的 GPT、同源输入与页数，做原提示词与新提示词对照，各至少三次；保存响应并渲染，评估具体锚点、完整解释、表格关系/公式条件覆盖、重复和布局溢出。不能把“Gamma 字数±25%”作为唯一成功条件，也不能由 simulated modelCall 宣称已经达到 Gamma parity。

本轮验证：Node 22.22.0 下 `npm run test` 通过（2,806 通过、1 跳过、0 失败）；20 组 PPT selftest 全通过。默认 Node 18 与现有 SQLite ABI 不匹配，未通过重编译依赖改变环境，而是使用本机已安装的匹配 Node 22。新增专项还验证了重写中取消、epoch 冲突丢弃、两轮后仍有严格缺失时阻断发布，以及最终 DAG 评审结果同步。本轮不调用真实 GPT、不验证远端部署或安装包。

## 6. 后续条件

1. 真实 GPT 可调用后，才能检验提示词的质量提升及成本/时延；当前模拟与确定性检查不能替代这一步。
2. 细粒度 SourceRequirement/RenderedFact 账本需要表格行列、公式项、条件及跨页关系验证；本次完整 `source_objects` 与 keyPoints 是提示词层的承接，不是该账本已实现。
3. 版式容量协商需允许注册布局替换，并保持模板可编辑结构和用户页数决定。不能单靠提示词把五词槽位变成深解释区域。
4. 专家知识扩展/外部核实需用户显式选择与证据入口；此次按用户选择保持来源政策，不启用多模型路由或自动搜索。

CLI 兼容依据：[Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)，`--system-prompt` 替换系统角色，`-p` 支持管道输入。实际 shim 帧协议已用无网络模拟模型程序验证；实际配置下的 GPT 仍待用户可调用环境验收。
