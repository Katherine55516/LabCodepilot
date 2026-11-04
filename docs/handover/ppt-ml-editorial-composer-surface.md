# PPT 来源解释、关系媒体和就近 AI 编辑

更新：2026-10-20。ML Quant方案及逐项实施矩阵：[ML Quant/Gamma 评审 §16](../research/ppt-ml-quant-24p-vs-gamma-18p-review-20261020.md)。该ML基线测试simulate；后续[Factor Zoo真实Qwen验收](../research/ppt-factor-zoo-editorial-real-acceptance-20261020.md)进行中，不能混用两者的质量结论。验收通过后仅commit，不push。

## 管线和权威

1. 完整 input → immutable inventory → reader 逻辑分组、主要语言、必要解释义务和唯一页数建议。义务引文为原文 UTF-16 范围；不基于字符数另算推荐页数。
2. 用户确认 N → 完整 N 页 task/answer/支持及关系蓝图 → selection 取舍、主要语言等义投影、比较表与图的独立审核。容量问题只修具体页/合法布局；无法容纳时提示调整，不能自动改 N、删行或转备注。
3. prose relation 材料化后必须再运行 source graph audit。旧的 input ASCII 审核不能覆盖尚不存在的新图。quote 校验不是因果或语义等义证明，独立 critic 仍必要。
4. 最终绑定与预估复用相同 source layout。DAG 按实际层高，五段区间把端点贴到对应区域；三组件以上的 source order 可比较不等宽双列。原始字体、固定品牌及用户编辑区域受保护。
5. actual PPTX/PDF → 来源/表示/几何/字体验证 → 正式发布。当前工作稿渲染合同 v20（此前ML成稿v19）；新布局实测行首/独占行流程编号，不改变步骤、原文或字号。旧合同即使同revision也不能直接导出，保留旧版本并提示重新验证/发布。PDF缓存还绑定实际发布PPTX哈希/路径和渲染合同，不能仅用revision复用旧PDF。

## 编辑事务

`SelectionAiComposer` 只是 portal 覆盖层，不能序列化进 slide IR。正文选择、组件成员、稳定 itemId、UTF-16 range 和 revision 冻结后，共享既有 proposal/revise/apply/discard/history；浏览邻页不能改变目标。晚到请求按 attempt 失效，不能在用户取消后自动应用。IME 组合输入不触发快捷发送/关闭。

`native-range-edit` 用目标范围切分/替换当前 native runs；目标外字体、字号、颜色、链接、下划线及段落保持。公式和 grapheme 不可切半。受控 `native-content` layout 仅重排明确可写内容框，保护同页其他固定、手工和锁定对象；不等于开放所有原生模板对象自由转图。

## 视觉和来源边界

- 新增文本默认 no-fill，原生未指定填充默认 preserve；显式 none 与 solid 独立验证。不要再写 `fill || '#ffffff'`。
- 六类 prose 关系进入既有 editable list/cards/connector 渲染；对比表、组合公式、区间复用既有类型。窗口是无数据的示意位置，不能生成市场价格或回测数值。
- 主要语言投影和 explanation completeness 是两项验证。原始双语和出处留在来源中；可见主要语言的否定、条件、单位/范围及数学结构不能缺失。原文章节号不是当前演示页码。
- 原始媒体保留率与有效解决率分开。已验证的非必需装饰区域适配可记 resolvedAdaptations；未知/事实/品牌对象仍硬检查，不伪造用户批准。
- 模拟模型审核不能证明真实 LLM 质量，`visualVerified` 不因 fixture 返回 passed 而改为人工通过。实际截图复核在独立记录中列明。

## 回归入口

- `npm run test`；UI 变更另外 `npm run test:smoke -- --config=playwright.ppt-editorial.config.ts`。
- `scripts/ppt/run-quality-selftests.mjs`：选本轮 25 个相关领域测试，输出带代码 hash 的结果；模板矩阵用 `PPT_MATRIX_TEMPLATE_DIR` 指向用户实际模板目录。
- `selftest-ppt-ml-http.mjs`：完整来源和原生模板；18/24 正向、19 故意过合并负向。必须传用户文件路径，没有短输入替代或真实网络 fallback。
- `ppt-template-first-live.spec.ts`：3143 实际 Chrome 上传模板 → 读取建议18 → 改24 → 大纲 → 页面 → PPTX/PDF → 文字候选编辑/校验/应用/只读前后版本/恢复/重新发布；模型边界 simulate。
- `ppt-editorial-composer.spec.ts`：IME、缩放、窄屏定位、邻页冻结目标、取消后晚到响应；不修改项目内容。
- 本地测试启动器只操作其所属 3143 进程；重启先检查活动任务，3141 不操作。

最终测试结果、成品和已知边界请以评审文档末尾验收表为准；中间失败目录保留排查证据，不计通过。

## 2026-10-20 Factor Zoo 真实 Qwen 跟进（验收未完成）

本轮用户要求改用真实slides/qwen3.8-max、04_factor_zoo_overview.md和Process Improvement模板。新增描述型封面识别与Qwen不支持uniqueItems的wire兼容；读取支持唯一原文quote的UTF-16位置派生，保留raw、严格拒绝歧义/伪造/缺证据，局部metadata repair冻结页数/来源ownership。对应计划`../exec-plans/active/ppt-factor-zoo-real-reader-20261020.md`、评审`../research/ppt-factor-zoo-qwen-process-improvement-real-review-20261020.md`。

3143已加载真实队列，3141保留；真实读取10页已通过，但10页大纲9页容量不符，不能开始writer。12页对照同样9页容量失败；writer未开始，publishedRevision=0，无正式PowerPoint。下一轮selection/ownership与semantic summary方案见评审P0/P1。不要将前轮模拟ML验收或本轮npm3024通过当成真实Factor Zoo发布通过；当前无本轮正式PPTX。来源2×3×3/27矛盾由系统正确提示，不能静默修改。


## 2026-10-21 本轮交接：收尾修复与待确认架构

Factor Zoo尚未有正式验收成稿，writer未开始；最新用户要求暂不执行完整workflow。页数复评metadata-only纠错、真实投影测量及失效边界已补齐到源码，原读N/用户N不被修改；当前运行3143未重载这些最新后端变更。新“轻大纲→唯一内容模式→容量展开→弹性分页”仅为[待确认方案](../research/ppt-outline-first-depth-capacity-plan-20261021.md)，不得视为已获实施授权或已经发布。原记录和检查点保留，3141不动，不commit。


## 2026-10-21 用户确认后的工程实施

上节“待确认/不commit”是先前讨论阶段，已由用户明确确认实施并要求unit通过后commit。新建AI项目携带`planningFlow:outline_first`，服务端生成`planningContract.version=3`；旧确认稿、人工大纲、导入仍走原合同。流程为完整读取→轻逻辑大纲→唯一模式→容量规划→确认→writer/硬门禁。新前端为`PptOutlineFirstPlanner`，API为POST `/projects/:id/planning` 的semantic/save/expand。

模式/模板/页数变化复用阅读但失效容量；物理确认拒绝未重新规划的修改。续页只在授权范围内修改未锁定任务，并校验source/run/revision/epoch，保留无关页。十四点原生字体不被通用十六点底线强制放大；writer必须消费`physicalBudgets`。

[实施验收和边界](../exec-plans/completed/ppt-outline-first-implementation-20261021.md)。本次使用3163隔离Chrome测试与模拟模型API，未重启3143/3141、未调用真实LLM或发布Factor Zoo；后续部署和真实整稿需单独核对。

继续补查修复轻大纲重新生成后的UI同步：轮询按semanticRevision接收新卡片，不再仅在空列表时更新；同revision的主动重新生成也须在成功完成时替换本地旧编辑。异步失败保留旧稿供重试，普通轮询不覆盖用户编辑。新增Chrome回归验证下一步容量请求使用完成版本的卡片ID，后端归属和版本检查不放宽。
