# PPT 可见内容深度与章节容量

更新时间：2026-10-01

## 目的与架构边界

Factor Zoo 双稿比较暴露出页数被文件名压缩、长章节分配过少、来源元数据被截断、窄卡片配对错误，以及可见正文门槛过弱。详细证据见 [对照报告](../research/ppt-factor-zoo-content-depth-comparison.md)。

沿用现有 source → planning → outline → content DAG → review/repair → export/publish。用户所选 LLM 配置、修改状态机、版本隔离和单页 AI 路径不变。无数据库迁移、前端变更或新增依赖。此次提升规划和模板契约、检查真实可见内容；不是新的模型编排系统。

## 文件地图

| 文件 | 改动 |
|---|---|
| `apps/cowork-server/lib/ppt-planning.mjs` | 文件名不构成概览授权；每章节按可读成本预留页数；根级引言留给封面；完整 refs 与有界写作上下文分离 |
| `apps/cowork-server/lib/ppt-api.mjs` | outline 合法 refs/chunkRefs 全保留；slot 字符超安全上限显式报错，不再静默切500字符 |
| `apps/cowork-server/lib/ppt-template-fidelity.mjs` | 窄多行正文、窄/多段标题与列表分组、同行说明、group-heading小节导航；按独立组计容量；以原始容量检查正文不足；合法比率；声明省略计入变体变化；媒体空间回收拒绝扩大文字交叠、短粗体标题和强制17pt |
| `apps/cowork-server/lib/ppt-presentation-writing.mjs` | 共享 visibleBodyTarget 与原生模板 templateVisualUnits；preserve 模式隐藏 takeaway 不算已呈现支持 |
| `apps/cowork-server/lib/ppt-content-qa.mjs` | 优先实际 native node 的正文；按组统计；源表行名称/数量与table意图校验；严格模式未映射阻断；通用空话判错 |
| `apps/cowork-server/lib/ppt-quality.mjs` | 完整有界槽位与代表来源进入 critic；严格缺失判错；禁止 preserve 模式制造导出忽略的 takeaway 修复 |
| `apps/cowork-server/selftest-ppt-visible-depth.mjs` | 以上边界的专门回归 |

## 契约与兼容

1. 页数推荐按章节成本累加；用户明确缩页仍优先，并沿用既有 LLM 重规划/压缩授权。该推荐是启发式，不是模型token计费或准确完备性证明。
2. Provenance 可保留所有合法 refs，但每次 LLM prompt 仍有上下文预算；locked/相关chunk优先进入摘录。不能把来源元数据全保留误认为模型已读完整篇。
3. `group-heading`代表整组卡片的小节导航标题；不消费独立事实，也不进入正文容量预算。窄标题、列表标题和同行短说明按语义组绑定；原生节点上的用途用于旧项目门禁升级。
4. 富来源正文最低目标为 `min(originalCapacity × .48, detailed ? 440 : 330)` visual units；>=130容量触发硬检查，封面/分节/结尾按既有豁免。英文字符约.55 units、非ASCII约1unit，是布局启发式。大正文自身40%/110units底线仍独立检查。
5. 省略无关组件不降低原始正文目标。容量太小的模板需要内容重新分布；不能用删除、碎句、缩字或重复填充绕过。
6. 旧项目通过 effectiveSlots 从原生节点升级过时的语义标签/分组，保留 native IDs；重新生成/编辑会接受新门禁。已发布旧文件不会自动重写。对于此前媒体回收造成的错误几何，需从原始 sourceCatalog 重新确认/调度模板映射并生成，语义标签升级不能修复旧几何。
7. 严格深度且未授权压缩时，未映射关键章节/chunk及critic必要缺失阻断发布。显式允许压缩保留warning与解释，仍不允许确定性错误。
8. 字符安全上限：普通slot5000、列表body2000/label120/最多30项；超上限返回400并要求改写/重分布。几何容量约束独立生效。


## 验证与运行边界

- 最新 `npm test`：typecheck通过，2806通过、1跳过、0失败。
- 专项 visible-depth、template-fidelity，以及semantic/content-depth/evidence-quality/template-scheduler/M5/long-limits/report-QA回归通过。
- 旧10页稿被新门禁检出14条硬错误（两类稀疏各5条、overflow2条、重复1条、空话1条），存在重合；slot稀疏页3/4/6/8/9。
- Deal Review 同源示例走实际API、页数估算、DAG、整稿审查、导出与发布，只有 modelCall 人工模拟。示例与真实所选LLM效果不可等同。
- 本轮不包含真实LLM、远端账号、跨设备与安装包验收。22页原生示例及实际证据指标/警告/渲染局限见对照报告；不能把无硬错误等同全事实覆盖。

## 源表行门禁的边界

显式table意图或匹配源表数量的英文类别/方法标题，检查同chunk页面共同保留每个规范行名；跨页可共同覆盖、词边界避免短词误命中长词。明确table意图的数量与源表行数不符也提示。严格模式阻断，压缩授权/跨语言精确名无法判断时warning。该检查不等于完整表格行列或语义关系验证，不支持所有词形、同义翻译与隐含数量承诺；下一阶段扩充对象账本。

## 下一步

优先建立 SourceRequirement / RenderedFact 对象账本，覆盖表格行列、公式项、清单数量、机制/实例/限制；再以用户选定LLM做同源A/B。章节refs和字符密度只解决部分问题。原始模板顺序与复制页选择仍有限制，规划与组件适配需迭代协商。来源内部矛盾应单独诊断，禁止未经说明复制或篡改。
