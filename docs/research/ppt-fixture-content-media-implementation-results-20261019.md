# PPT fixture、内容与媒体方案实施验收

日期：2026-10-19。对应方案：[原评审](ppt-gamma-fixture-content-media-review-20261019.md)。

本轮按 P0→P1→P2 执行，补缺口并复测已经存在的能力。测试模型继续 simulate；没有调用用户配置的真实 LLM，也没有用模拟业务接口声明发布成功。**以下“通过”指受控响应下的工程合同、确定性检查与实际文件验收，不指实时模型已经达到 Gamma 的内容质量。**

## 实际交付与边界

- 完整 gamma.md 经真实 HTTP 读取、页数确认、大纲、逐页生成、评审、发布、导出，得到 40 页 PPTX，69 个来源单元。
- 大纲、canonical deck、Render Tree 均为同一组 40 个 slideId；发布 revision=1。确定性硬错误为 0，状态 `passed_with_warnings`。
- 40 是本组**人工编写模型响应**的结构保留测试预算，不是代码的页数公式，不是实时 LLM 推荐，也不是 Gamma 对照目标。保留大量整表和原流程使它明显比 Gamma 10 页稿更详细。不能以该文件宣称精炼度已达到 Gamma。
- 实际 PPTX 重开、对象/文字核验及 LibreOffice→PDF 可见性通过。已查看全部 40 页联系表；没有发现裁字；部分短原文页仍偏空，采用既有碎片诊断与合并建议，未擅改确认预算。
- 另一组小输入走实际开发前端、Chrome CDP 和真实服务端，点击读取、把页数改为5再改回4、生成大纲、生成页面、原生下载。`download.failure()=null`，字节 SHA-256 与已发布产物一致。
- 开发 UI 验收使用隔离的 **3173/3172**，保留已有3143。没有对3141执行停止、重启或配置修改；最终只读探测时3141没有监听，不能声称其健康检查通过。

精确页数污染回归也已通过：reader18、旧代码34、用户19，最终大纲/deck/Render Tree/实际导出均19，reader建议仍18（`authority19/`）。

证据根目录：`outputs/ppt-fixture-implementation-20261019/`。该目录属于本地测试输出，不提交二进制或私有输入；可用下列脚本复现。

## 按序实施记录

|条目|实施与复用|验收证据|
|---|---|---|
|P0-1 分层证据|保留旧脚本原件，退役其可执行入口；原报告撤回超范围结论。新 manifest 分别列真实层、模型 double、未验证层|`acceptance-manifest.json`；原报告第5–6节|
|P0-2 真实后端|新增 `test/ppt-http-harness.mjs`，注入仅限 `modelCall` 和宿主 IO。实际 `handlePpt`、存储、门禁、发布、导出照常执行|`http-acceptance/`、`gamma-acceptance/` 的 HTTP/模型阶段记录|
|P0-3 真实来源|直接 production parser；修正 Markdown 文件在3000字符处提前切段的问题；结构不经正则删除或截字|4输入×4模板矩阵；69/182/138/64个来源单元；文件与粘贴的类型、完整文字、表格行列一致|
|P0-4 单一真源|`exportManifest` 比较当前 canonical deck 的实际 scene 内容、ID、尺寸、版本，拒绝陈旧 tree。兼容没有deckId的旧输入，以稳定可见scene生成标识|错ID、缺页、旧Topic内容负例；实际导出与发布hash|
|P0-5 容量定位|render audit 和 source binding 带节点role、pageIndex、字号、实际frame及测量依据；诊断组件按标题/正文显示，支持三语言|`selftest-ppt-fixture-integrity.mjs`；`PptCapacityDetails`；前置真实源容量拒绝记录|
|P0-6 真实门禁|复测原source容量409、最终可见性失败、空正文；模型critic返回无问题也不能覆盖确定性错误。修复空页用缓存bullets掩盖的漏洞|`http-acceptance/negative-publish.json`、第一次Gamma容量/Brief可见性失败记录|
|P0-7 原生下载|新增CDP下载脚本，没有API拦截、没有fetch替代下载；记录下载错误、网络失败、实际字节hash；导出增加发布revision与可用时的SHA ETag|`browser-acceptance/manifest.json`、`native-download.pptx`、真实HTTP200/409追踪|
|P1-1 stage fixture|新增小输入与完整gamma受控模型响应；未知阶段抛错，测试服务只接受登记输入，不回落真实模型|`ppt-pipeline-model-fixture.mjs`、`ppt-gamma-model-fixture.mjs`；旧脚本归档|
|P1-2 全局骨架|复用 reader/global-outline-plan/semantic-groups；不创建另一套IR。确认页数后保留既有分组、来源owner和预算保护|`semantic-preplanning`既有合同；`gamma-semantic`、`four-pillars`、页数错误局部修复的真实HTTP测试|
|P1-3 完整摘要|复用 selection/obligation/claim语义协议及V2无全文备注规则；修复冻结来源标签被当成新增冗余文案而要求改写的问题。豁免需匹配真实可见sourceNodeId和逐字内容|summary/条件/来源义务回归；隐藏来源、修改文案、无来源新增filler仍受检查|
|P1-4 结构类型|复用表格、ASCII graph、process、code与source ranges；修正文件解析前置切段和实际代码分片导出问题|4输入解析矩阵；`source-graph-small`、`source-line-integration`、表/流程/No分支等既有负例|
|P1-5 合同驱动排布|复用sourceComponent、pageContract、fitSourceLayout、diagram/process cards；修复分片标题被源章节长标题覆盖导致过长/主语言冲突；保留规划短标题和真实范围|`partition-topic-language`；完整Gamma表格/卡片/流程真实PPTX|
|P1-6 局部修复|复用metadata/range/writer span repair；补新回归。固定预算、来源数据、锁定内容不因修复变化；原始过容量组真实返回409|`outline-range-repair`、`writer-field-repair`、`source-binding-capacity`；reader18/旧34/用户19的真实19页导出，以及错误页数delta真实HTTP|
|P1-7 关系媒体任务|在既有slidePlan增加来源结构媒体task，由真实source binding写回receipt，携带来源/选择范围、relationIds、组件类型、实际nodeIds、样式hash及版本。不另建图片生成引擎|计划与实际节点可对应；源对象/关系门禁继续验证完整选中内容，不用task=ready代替证明|
|P1-8 账本分类|`slideMedia`识别已验证可见card-grid/process/table；检查来源覆盖与可读fit。图标、背景、未知图片不能冒充完整信息图。连续text-only只作诊断，仍保留必要媒体及未批准删除的硬门禁|缺一模式卡片不计完整媒体，装饰不清零text-only，媒体守恒仍阻断；four-pillars与专项回归|
|P1-9 独立重试|新增 `POST /projects/:id/source-media/retry`。只重绑本页来源媒体、不调用writer；校验run/source/revision/epoch，拒绝已接受或手动锁定/设置样式的来源组件，其他页逐字不变；产生待重新验收草稿，不能直接导出|真实HTTP重试、锁定来源409、旧revision409、未发布409、重新publish；已有component lease/stream races负例|
|P1-10 空页/碎片|空canonical正文优先于缓存文案；正常无来源结束页与封面仍可按角色设计。复用density/coherence提出合并建议，未自动改变N|空Workflow负例；hidden/cache负例；source/对照/短页相关回归|
|P2-1 模板适应|模板字体、色板、容量及原生组件继续用既有profile；修正富文本换行与空代码行默认字体造成的Office实际行高偏差；不套用Gamma品牌|Light/Blue及实际Mood Board/Deal Review分析矩阵；真实嵌入字体测试；actual PPTX/PDF|
|P2-2 多输入矩阵|新增可复现脚本，4输入×4模板检验真实解析、关系类型和结构容量。来源大对象可明确要求分片，不将其计作成功一页|`source-matrix/manifest.json`；非Gamma输入本轮没有宣称整稿发布或实时模型质量通过|

## 实际发现和修复的故障

1. **封面证据标题负例**：初版小fixture封面写“Release evidence”且没有证据owner，真实证据门禁正确拒绝。修正受控标题为“Release review”，没有放宽门禁。
2. **陈旧Render Tree**：旧导出仅凭renderContractVersion复用缓存。现在比较实际scene；错页数/错slideId/旧Topic内容均拒绝。旧输入尚无deckId时，不用临时随机deckId制造伪冲突。
3. **空Workflow被缓存掩盖**：原检查同时看canonical与旧bullets/blocks。现在canonical存在时只看真实可见内容；隐去或清空正文会阻断，已确认的空白页和正常结束页仍按其角色处理。
4. **分片标题回退**：表格分片重用章节名/所有行标签，可能推翻规划语言并超标题预算。现在V2保留规划主题、仅加真实范围，锁定标题仍不改；逐页来源主题审查仍保留。
5. **冻结标签反复改写**：原文Native/Export等被当作标题复述。现在copy投影带sourceNodeId，并核对实际可见节点及相同正文。来源本身的完整保留不触发改写；新增复述依旧检查。
6. **Brief卡片实际裁字**：换行被写为a:t中的独立字符，字体回退增高行距，PDF丢失roadmap。改为DrawingML a:br，保完整卡片内容和字号，实际导出再次通过。
7. **代码分片实际裁字**：空行没有run，继承主题较大字号；另有richText整段和逐行代码载体混用风险。代码按逐行合同写入，空行paragraph/endParaRPr显式使用代码字号。真实含空行分片PPTX重开及PDF通过。
8. **文件导入破坏结构**：Markdown prose先被3000字符切开，Factor Zoo文件出现表头与后续行分离、公式空行及清单分段差异。现在完整Markdown段交由语义解析器决定边界，四文件与paste语义签名一致。
9. **装饰冒充媒体/图片配额**：计数区分信息媒体、source-derived、aid、brand、decoration、unknown。保留媒体的合同仍检查；模板图片密度不再强迫无数据来源的页面额外加图。
10. **测试环境问题**：开发首次编译使模型列表15秒超时，使用真实“重新加载模型”恢复；独立启动器停止子进程时需回收整个Next进程组；隔离测试provider使用明确非真实dummy，避免重启后测试主密钥变更导致dummy解密失效。未修改用户密钥或真实provider。

## 复现

在本工作树根目录使用Node22，Python需含python-pptx/LibreOffice等本地依赖；设置 `PPT_TEST_PYTHON`。脚本缺少输入或依赖时必须报告失败，不伪装通过。

```sh
node apps/cowork-server/selftest-ppt-http-pipeline.mjs
node apps/cowork-server/selftest-ppt-http-authority.mjs
node apps/cowork-server/selftest-ppt-fixture-integrity.mjs
node apps/cowork-server/selftest-ppt-gamma-http.mjs
node scripts/ppt/fixture-source-matrix.mjs
npm test
```

开发页面（只模拟登记的gamma.md和PIPELINE_SOURCE）：

```sh
PPT_FIXTURE_PORT=3173 PPT_FIXTURE_BACKEND_PORT=3172 node --import tsx scripts/ppt/fixture-test-service.mjs
PPT_FIXTURE_BASE=http://127.0.0.1:3173 node scripts/ppt/fixture-native-download.mjs
```

可通过 `PPT_GAMMA_INPUT`、`PPT_EVAL_INPUT_DIR`、`PPT_MATRIX_TEMPLATE_DIR` 指定本机资料位置。输出脚本支持独立目录；请勿把用户密钥放进测试文件。下载脚本的Chrome page response有时不包含浏览器接管的下载请求，因此分别记录原生下载结果、字节hash和真实后端HTTP trace；不将缺少page response事件解释成网络成功，也不以fetch文件替代原生下载。

## 剩余质量判断的边界

方案的工程实现及受控fixture可测部分已完成；实时LLM语义质量仍是独立D层，遵从用户simulate要求未执行。40页整表保留稿支持工程回归，**不能代替“与Gamma一样精炼”的编辑稿**。复用的全局规划、摘要义务、定向修复和信息媒体组件现在有真实链路与负例证据；真实模型恢复后仍须评估它能否在用户选择的较短预算中给出完整、清晰、来源忠实的摘要，不沿用本次critic double的判断。
