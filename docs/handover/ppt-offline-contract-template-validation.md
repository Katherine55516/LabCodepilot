# PPT 无 API 契约、模板组件与离线验证

> 2026-10-09；承接 ppt-master/Gamma 调研后的第一批实现。基线 HEAD：`988dfd2`。没有调用 LLM/视觉模型 API，没有改创建 workflow 的步骤。

## 本批完成的行为

| 层 | 实现位置 | 行为 |
|---|---|---|
| 来源与数值 | `apps/cowork-server/lib/ppt-source-numbers.mjs` | 检查数值、正负号、单位和局部归属；明确编号才豁免；模板示例不能许可新事实 |
| 语义与页面合同 | `ppt-semantic-relations.mjs`、`ppt-page-contract.mjs` | 中文“其中/式中”连接公式解释；结构与必要解释不能用 omissions 豁免；只有 source ID 而可见正文不符仍报错 |
| 修复执行 | `ppt-repair-routing.mjs`、`ppt-quality.mjs`、`ppt-api.mjs` | 核对实际候选的范围、锁定、层和回归；自动 critic 失败候选回滚并留记录 |
| 模板档案 | `ppt-template-components.mjs`、`ppt-template-fidelity.mjs` | 原始模板页的布局、槽位容量、重复组、保护区和媒体身份进入版本化 profile；mapped 模式也解析模板 |
| 媒体账本 | `ppt-media-ledger.mjs` | mapped 模式按真实 profile 与绑定记账，标明可选资产未选择；必需资产缺失仍阻塞 |
| 共享组件 | `ppt/component-layout.mjs`、`ppt-layout.mjs`、`ppt/render-tree.mjs` | 不等宽面板、公式与变量、条目与图标，统一生成 RenderTree，不由模型写坐标 |
| 编辑与提案入口 | `ppt/command-schema.mjs`、`ppt/typed-proposal.mjs`、`ppt/proposal-service.mjs`、现有前端布局面板 | 服务端白名单共用 registry；布局能通过编辑命令及 AI 布局提案选择，补齐三种语言标签，无新增 workflow 步骤 |
| 导出 | `ppt-render.mjs`、`ppt-export-integrity.mjs`、`ppt/exporters/preview.mjs` | 卡片不继承 Office 默认居中/阴影；短公式按表达式尺寸输出；实例 manifest 校验实际公式框，不放宽核验 |
| 离线工具 | `scripts/ppt-balance/ppt-offline-eval.mjs`、`selftest-ppt-offline-contracts.mjs`、`src/__tests__/e2e/ppt-offline-components.spec.ts` | 固定数值正负例、历史 writer IR 回放、两模板档案、生产 PPTX/PDF 导出、真实 React 编辑器 CDP 验证 |

上述服务端短文件名均位于 `apps/cowork-server/lib/`。

## 来源约束与修复规则

数字检查以前只问“这个数字是否曾在输入/模板出现”。现在模板内容退出事实许可集合，数字保留符号，等价小数和千分位规范化；百分比、bp、金额数量级等匹配单位。表格把数值与行标题、列标题一起检查，避免把 Revenue 的数值移到 Costs。明确 Step/Page/第 N 页及独立编号标签豁免，普通“7 funds”不豁免。

局部语境仍是词汇检查：若当前归属在来源支持另一数值，而同值只在其他语境出现，报归属不受支持；跨语言/同义改写无法确认时报告 warning，不能声称已证明错误或正确。不能证明复杂运算、因果关系或时间窗口的语义等价；来源含多个数字的同一句话也可能有归属盲点。这些限制不能靠降低事实门禁来解决。

页面合同要求可见文本覆盖库存单元；贴 ID 本身不算完成。结构和公式解释不接受“为了 fit”省略。否定词、条件词丢失给出审查信号，仍不是完整语义证明。writer prompt 明确不同内容职责、完整条件、唯一正文和结构保留，不为了密度补重复句。

自动修复必须通过实际 before/after：

- 不新增/删除页，不越过当前页范围，不改 accepted、locked 或 active constraint 的页/节点；锁定对象的层级变化也算变化。
- 内容修复不改版式、已有对象几何/样式/层级，也不增删改媒体或表格；媒体、裁切、排版问题交给相应层。
- 每项修复操作必须属于 issue route 的允许操作。标题选择、内容去重和排版重排分别记录。
- 新 hard error、同类错误新增目标、容量超出量加重或覆盖率下降均回滚。记录 rolledBack 和 violations；不因为旧稿已有错误就允许变得更差。

这不是完整语义代理。无代码可执行修复的诊断保持 blocked/待处理，不通过自由重写或隐藏内容让检查变绿。

## 模板组件与编辑完整性

profile version 1 包含 template hash、profile hash、原始页序列、textSlots（原生字号/边距/保守行数及 visualUnitCapacity）、repeatedGroups、itemCapacity、media 和 protectionRegions。容量来自共享文字测量，`visualVerified:false`；布局/角色几何推断明确标为 heuristic，不当作视觉模型结论。原模板页数不等于生成页数。

本地实际解析：

| 模板 | 原页数 | 图片使用次数 | 唯一资产数 | 角色分布 |
|---|---:|---:|---:|---|
| Process Improvement | 8 | 17 | 17 | 9 icons、6 decoration、2 unknown |
| Deal Review | 8 | 20 | 19 | 7 icons、3 decoration、9 artwork、1 unknown |

mapped 模式仅将可选图标作为视觉辅助绑定给适合的普通条目页，稳定绑定包含 assetId/itemId/index/origin。白色透明图标保留原背景色的对比载体。它们不算来源证据；unknown、protected、mustPreserve 媒体不自动搬移。可选照片/复杂 artwork 的图文映射尚未实现，不能宣称 mapped 模式已经继承所有媒体。native preserve 仍使用原生结构与保护规则。

三组件的正文有一个重要约束：**一个 canonical list 仍是一个可编辑对象**。不等宽分栏及图标条目使用 `pointLayout.boxes` 派生呈现，不把部分正文伪装成共用父 nodeId 的独立文字框。已有要点编辑器更新整份列表并保留 item ID/provenance；拖动正文使用 canonical geometry，重新派生盒子；图标自己的显式几何仍优先。超容量设置 overflow 并阻塞，不能裁掉剩余点。碰撞检查按实际 point boxes 判定图标是否遮字，不给整个 group 无条件豁免。

公式的编辑区域与实际表达式墨迹区域不同：MathML + 字号给出 `mathLayout.bounds`，Office 输出与实例 manifest 使用同一个表达式框，避免把短公式放大到整个面板；浏览器在原编辑区内居中呈现公式。超出区域报 `math_layout_capacity`，不截断项。Office/浏览器字体引擎仍需实际渲染验证。

## 验收记录与复现

证据目录：`outputs/ppt-offline-contract-template-20261009/`。

- `report.json` / `README.md`：输入与模板 SHA256、profile、数值前后比较、历史回放诊断、导出核验。
- 数值七例：五个错误例（个位数、符号、单位、归属、模板示例数字）旧 checker 都漏过，新 checker 全部报 hard error；等价小数和明确编号保持通过。此比较只替换数字 checker，旧模块引用现有 policy helper，**不是整个旧版本系统的对照实验**。
- 新专项另测中文解释关系、不可豁免结构、ID 冒充覆盖、表格数值归属、同义中文的 warning、修复范围/锁定/操作/媒体、完整正文编辑/拖动及密集双语溢出。
- 3 份历史模拟 Alpha writer IR 原文件未改，新规则下分别有 33、33、35 个 hard errors，主要是模板媒体未交代与文本容量。它们保持 blocked；没有把旧稿算作本批成功生成，也没有用模拟校准真实模型质量。
- Factor Zoo/09 的现有估算分别为 34/32 页（默认画布、输入包含双语），只记录估算，不宣称实现模板容量联合分配或已经达到 Gamma 页数/密度。
- 四页组件测试稿走生产 exporter，重新打开 PPTX、实际 LibreOffice PDF/逐页 PNG 核验并逐页查看。卡片对齐/阴影与短公式拉伸问题在视觉复查中发现并修复。原输入与原模板 hash 保持一致。没有在 Microsoft PowerPoint 中打开检查。
- 全部 35 项 PPT 自测通过；最后的视觉修复后重跑受影响专项。`npm run test`：2808 通过、1 跳过（含 typecheck）；新增 UI 测试后再次 typecheck。
- 11 项浏览器检查全部通过；另跑组件/数学两项通过（组件为重复复验，唯一用例总数为 12）。前端验收运行 dev server + Playwright Chromium CDP，在实际 React 页面导航、选择/切换新增版式、确认完整正文与桌面/紧凑视口，通过要点 inspector 改一个点并验证其余点完整，保存截图并检查无 console/page errors。chrome-devtools MCP 在此环境不可用，使用浏览器 CDP session 执行相同检查；不是另造静态 HTML 验证。

本机使用 Node 22.22.0；默认 Node 18 与既有 SQLite native addon 的 ABI 不匹配。第一次测试因此失败，切换已安装的匹配运行时后通过；未改依赖锁文件。

```sh
PATH=/Users/dongli/.nvm/versions/node/v22.22.0/bin:$PATH npm run test
PATH=/Users/dongli/.nvm/versions/node/v22.22.0/bin:$PATH node apps/cowork-server/selftest-ppt-offline-contracts.mjs
PATH=/Users/dongli/.nvm/versions/node/v22.22.0/bin:$PATH PPT_TEST_PYTHON=/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 PPT_VISUAL_DPI=120 node apps/cowork-server/scripts/ppt-balance/ppt-offline-eval.mjs
PATH=/Users/dongli/.nvm/versions/node/v22.22.0/bin:$PATH PORT=3109 npx playwright test src/__tests__/e2e/ppt-offline-components.spec.ts src/__tests__/e2e/ppt-prototype-parity.spec.ts src/__tests__/e2e/ppt-render-contract.spec.ts src/__tests__/e2e/ppt-planning-assumptions.spec.ts --workers=2
```

离线 harness 的模板与输入路径为本机调研资产路径；缺失项显式报告 missing。生成的组件测试稿只是机制验收，不是 Factor Zoo 正文的新一轮输出。浏览器 fixture 来自 harness 的真实 RenderTree/canonical deck，POST 编辑使用生产 normalizeCommand/applyToDeck/buildRenderTree，但 API/storage 用隔离 fixture，不向用户账号写入。

## 下一批依赖与边界

1. 将 profile 的不同槽位容量真正接入“受众问题 + 结构义务 + 关系 + 候选组件”的联合页数分配；检查双语实际占位，不按字节机械分摊，不用重复填充减少页数。
2. 为可选照片/图文、多表/步骤等建立对应组件及媒体选择规则；复杂原生关系继续保护，不能拿图标装饰代替来源结构。
3. 扩展冻结来源 + 冻结 writer IR 的多领域金标与渲染证据，验证否定、条件、时间、表头归属；真实模型可用后再校准误报，不先放宽门禁。
4. 有界整页缩放（约 0.83 下限只是待验证设计参数）、视觉模型评审、真实模型 baseline 留在后续。本批不添加 API 调用或自动全页缩放，也不改变现有步骤。

新增 npm 入口：`npm run selftest:ppt-offline-contracts -w cowork-server`（纯规则测试），`npm run benchmark:ppt-offline -w cowork-server`（本机资产回放/导出，仍需上述 Python 环境）。
