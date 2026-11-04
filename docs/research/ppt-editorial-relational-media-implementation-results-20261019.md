# PPT 编辑规划与关系媒体：实施和验收记录

日期：2026-10-19。对应[详细方案](ppt-editorial-relational-media-gamma-observation-20261019.md)及[执行计划](../exec-plans/completed/ppt-editorial-relational-media-implementation-20261019.md)。状态：可执行的本地产品改进已完成并通过模拟/实际文件验收，本地验收完成（提交标识以Git记录为准）；下表只记录实际证据，不代表实时模型或Gamma网页实验完成。

## 1. 实施顺序与逐项结果

|方案|本轮实改与复用|验收方式|
|---|---|---|
|P0-1 完整来源与读取|reader保存实际发送的completeInput/IDs清单、字符范围/编码/字节数/哈希、已确认ownership与未解决ID；清单与实际packet不一致则拒绝估算。缓存身份包含原始inventory，解析结构改变会失效。完整交付不冒充模型理解证明|长输入末尾约束、截断packet/遗漏ID负例；五份真实文件与粘贴的完整解析签名一致|
|P0-1 双语与结构|复用原始语言对、独立等价审查、公式/代码/表格与原图节点关系识别；移除语言对prompt中自动写备注的遗留表述|语言投影/双语/分片标题自测；中文说明被大量技术标识污染的新增负例|
|P0-2 唯一估算|仍是完整阅读LLM给recommended/min/max。V2全局规划使用已验证reader语义组，不回退字符权重分配，不造第二推荐N|真实HTTP：reader18、旧缓存34、用户19，最终全部19；4/5页编辑fixture的reader始终4|
|P0-3 页面预算与角色|只扣实际规划且无来源义务的封面/导航/章节/结束页，不再无条件预留两页。复用N冻结、source owner及局部预算修复|没有结束页、实质总结占内容预算、已选来源守恒；范围/字段局部修复自测|
|P0-3 蓝图消费|`withEditorialContext`将reader/group的问题、核心结论、support roles接到逐页planning；writer已有whole-deck ownership上下文，critic新增对应蓝图审查说明。生成意图不能替代事实依据|实际HTTP生成的slidePlan携带上下文；原始主张/已选摘要与writer绑定结果核验|
|P0-3 合同完整性|requiredRelations不再只留前12条，requiredUnits/邻接也不静默截断。未知ID及非法集合保留为明确合同错误，不能过滤后伪装有效|15条关系、未知关系ID、非法adjacency集合负例；现有来源/单元格硬门禁继续执行|
|P0-4 摘要与修复|复用selection/obligation/claim约束，双预算编辑fixture实测摘要没有被原文回填覆盖。原文保留在source storage，不生成全文备注|实际读取→大纲→生成→发布→PPTX；丢前提/改变范围等原有负例及定向修复测试|
|P1-1 树/分支/DAG|已有解析且独立审查的source graph现在可生成原生卡片与正交连线，保留同名节点、所有直接边及Yes/No节点；不再默认统一投影为关系表|节点删除/改字、丢边/反向/循环、分片图负例；真实绑定、Render Tree、SVG及PPTX重新打开/Office可见性|
|P1-1 泳道|仅对明确Role/Lane及Stage列的真实来源表启用；角色×阶段共享网格，保留空格、同格多动作及全部阶段，不为独立角色补造跨泳道因果边|完整单元格/角色映射与负例；真实native export|
|P1-1 时间线|仅对可验证递增ISO日期表启用，使用真实时间间隔；数字1/2不能被Date.parse误当日期。空间不足保留完整表|日期反序/无日期/间隔及碰撞检查；真实native export|
|P1-1 对比/公式|复用共同维度矩阵与原生数学/变量邻接合同；含数学的graph继续用完整rich table，不丢OMML来凑卡片|原有native diagrams、公式定位/表示与渲染回归；四模板结构容量矩阵|
|P1-1 媒体账本与重试|receipt保留实际组件类型、sourceEdge→实际容器/节点的绑定，以及表格降级原因；不以ready代替对象/关系/渲染门禁。独立媒体重试复用既有run/source/epoch/revision与锁定保护|真实HTTP：重试不调用writer，其他页逐字不变；旧revision、锁定来源和未重验导出均拒绝|
|P1-2 自适应|按文字测量计算关系图最小高度，尝试不同方向；连线穿过其他节点时不认可该布局；打包后的最终框再次测量，不以原canvas的fit代替真实frame。规划与生成共用完整表格兜底，固定字号/已选内容；锁定/编辑后不自动改表示|大树graph不fit而表格可fit的规划反例；真实uploaded Mood Board/Deal Review及Light/Blue容量矩阵|
|P1-2 双语标题|复用较小、不同可读颜色的上方次标题；补强主语言检测，剔除代码/公式/技术标识，并优先实际正文，忽略派生英文表头；只有图时使用原始图标签。接近均衡时沿用全稿语言偏好|page-header、topic/partition-language与新增graph-only/代码密集/中文说明负例|
|P1-2 大纲确认|折叠区域增加页面阅读任务、来源主题、组合依据和表达方向；不用source IDs/JSON替代用户说明|真实Chrome CDP展开、移动视口和后续生成/下载|
|P1-3 渐进、有限并行|复用已冻结蓝图后的调度、稳定slideId、真实增量draft、SSE顺序/epoch保护、检查点与独立重试。队列空页不当成正在生成页面|既有managed-stream、恢复/输入合同与实际UI流式冒烟；没有宣称新增私有思维链展示|
|P2-1 表达验收|新增相同计划答案的诊断与关系表降级提示；critic同时核对实际页面及蓝图，允许不同用途的合理开场/结尾复述。诊断不冒充语义判断或强制版式配额|重复答案/recap豁免测试；工程、来源和表达评审边界分开记录|
|P2-2 两类fixture|保留gamma.md 40页结构保留fixture；新增同源4/5页精炼fixture，明确合并短说明、summaryText与原生并行关系；只模拟modelCall|真实HTTP、实际存储/门禁/原生文件；手工模型响应不能证明实时模型叙事质量|

以上路径均位于现有IR与来源绑定链，没有新建平行图形/布局引擎或更改数据库实体。没有新增Express入口：方案对此是条件性讨论，用户已确认的手动读取/调整/大纲确认流程继续保留。

## 2. 本轮发现并修复的实际问题

1. 原生图形默认消耗整个可用高度，使短解释无处安放；改为按节点文字计算所需高度并比较方向。
2. 规划认为graph不fit，writer却能用表格fit，导致本可呈现的页面提前容量失败；两阶段现在消费相同fallback。降级为表格仍会列为表达质量诊断。
3. 仅标题卡片被exporter额外写入空body段落，rich payload与实际XML不一致；不再产生该空段落，实际PPTX与Office复核通过。
4. 新泳道/日期组件通过绑定后多了richText/id等合法载体元数据，完整对象比较误报丢表格；验证改为比较全部来源行及实际可见字段，不能以新增元数据误判，也不能允许成员/关系缺失。
5. 原语言对prompt仍提及把原文放备注，已改为source storage；没有恢复备注兜底。
6. 旧代码分片POC用12pt测量第一分片却按18pt绘制，真实Office报告越界；修正fixture消费实际measurement字号，未放宽可见性门禁。另修正旧native diagrams fixture遗漏页数确认字段。
7. 精炼fixture最初用已选摘要冒充原文证据引用，被真实claim门禁拒绝；改为使用当前original quoteId，未放宽来源审查。critic仍明确是协议double。
8. 独立前端测试最初未指定带pptx的Python，实际发布正确阻断；启动器现在先检查真实依赖，缺失即失败。导出使用本机已配置runtime，不安装/替换用户Python。
9. Next子进程及db退出监听可使异步关闭未执行，产生孤立测试服务；启动器增加端口预检与退出时仅清理本次创建的后代进程，保护3141/3143及各自后端。CDP调试端口改为临时分配，失败采证不再覆盖原始异常。
10. 泳道实际Office图中，较短角色原来被按动作数量拉高，阶段没有对齐；现改为共享角色×阶段网格，保留缺席阶段为空格，同行多动作仍完整呈现。新增相同阶段对齐与错误stage绑定负例。
11. UI冒烟发现唯一页数建议投影误丢代码展示说明；只携带非数字assumptions，不读取旧推荐34/旧范围30–38，界面仍显示reader8。媒体移除确认原来被全屏editor遮挡，现迁入editor画布内，保留确认理由及重新检查入口。
12. 若干旧UI fixture在服务端HTML出现时就点击导航，事件发生在hydration之前；改为等待真实项目加载完成，选择框测试按现有hover规则操作，不以force click绕过遮挡。
13. 保留原生模板的exporter曾把卡片压成普通列表；现在与重建路径共用`ppt-point-cards-python.mjs`，消费同一Render Tree路由与字体。原生标量槽位清空/替换后删除多余空段落，未改变文字的原生层级保持原样。
14. 新增实际PPTX连线门禁：每段唯一名称、坐标/方向、终点箭头与多余连线核查；含连线的新发布回执必须含`relationRouteVersion=1`及准确段数。旧回执不能授权新发布。真实文件中删线、改坐标、新增关系、删箭头四种负例均被拒绝。
15. 上传模板暴露“原canvas测量可fit，打包后图形框不可fit”的容量假阳性；加入最终分配框重测及9组宽高反例，触发既有同字体/完整来源表格兜底，不调整用户N。
16. 开发服务首次冷编译造成导航/模型列表超时，原始失败保留；脚本通过真实“重新加载模型”恢复，不通过API拦截造成功。后续原生下载、hash与pageerror单独核验，requestfailed列表不隐藏。

## 3. 验收证据与口径

证据根目录：`outputs/ppt-editorial-relational-20261019/`；总清单`acceptance.json`，最终及原始失败日志已复制到`acceptance-logs/`，不提交用户私有原始输入、二进制产物或账号凭据。

- `release/editorial/`：4/5页同源真实HTTP，reader始终4；outline/deck/render/export各自遵守用户N，确定性硬错误0，摘要没有被原文覆盖。模型和critic都是显式double。
- `release/gamma/`：完整gamma.md真实管线；40页、69来源单元，实际PPTX，硬错误0。第14/22/34页分别为9/6/12条真实边的原生树/DAG，已查看实际Office渲染图。这是结构保留预算，不是实时LLM建议或Gamma10页对照目标。
- `release/authority/`：reader18/旧34/用户19，真实19页文件。
- `native-route-verified/`：树、决策分支、泳道和真实日期关系的原生PPTX、重新打开检查、Office可见性。它是原生组件测试，不能冒充经过整稿模型评审的产品演示稿。
- `release/source-matrix/`：Gamma69、Factor Zoo182、Deep learning138、Alpha Mining64、Machine learning198个来源单元，各经4模板；文件/paste的完整类型、文本和表格签名一致。这里只验证真实提取与结构容量，不声称5份输入全稿都已发布。
- `browser-final-accepted/`：最终代码的实际开发前端/Chrome CDP，展开计划说明、4→5→4页调整、生成、原生下载；download.failure=null，34,669字节，SHA `4e19c0c399023f44cf43cc76d4eba2dd9750984c349f3e5246de8ed249c2b54e` 与发布产物一致，pageerror=0，并确认新连线验证回执。原始requestfailed保留3个模型目录请求中止及1个SSE中止，不能报告“零传输问题”。桌面/mobile关系截图已关闭导出弹窗并实际查看，不沿用旧遮挡截图。
- `regression-acceptance/`：27项专项脚本通过；早期`regression/`仍保留代码POC失败与修正后的记录，不删除失败证据。新增泳道网格负例另经最终unit/native export重验。

最终`npm test`（`/tmp/ppt-editorial-npm-frozen.log`）：3024项，3023通过、1跳过、0失败。冻结后的`release/manifest.json`中10项HTTP/原生模板/数学表格/代码分片/媒体导出回归全部通过，另外27项专项回归见上。ESLint为0错误、19条现有大文件/依赖等警告。

全量smoke共97项：首轮75通过/22失败；串行复查修复真实UI缺陷及fixture准备后，全量重跑93通过/4失败（触屏卡片加载、Plugins/MCP/Settings冷启动就绪）；触屏复验通过，其余3项在保持可见性断言、把初始就绪等待从5秒改为30秒后复验全部通过。相关原始日志分别为`/tmp/ppt-editorial-smoke.log`、`...-smoke-final-all.log`、`...-smoke-last-confirm.log`、`...-smoke-other-retry.log`，失败记录没有删除；97项均已覆盖并复验通过，不声称某次单轮97项零失败。`helpers.ts`仍等待真实可见main，没有改为networkidle或跳过断言。

### 表达评审仍有的明确限制

40页结构fixture的整体状态为`passed_with_warnings`，不能称为无表达问题：7个关系分片仍用忠实表格，并有短页、可合并页、重复claim及低密度诊断。3个整图已变为原生关系图，不能据此声称所有表格都已转图。`source_evidence_unrendered`、封面标题完整性等现有警告也保留在project.json供继续核对；本轮没有删除警告来凑通过。

4/5页精炼fixture用的是同一份明确的`Connected review`来源（不是完整gamma.md），验证合并/摘要/独立分支/来源支持的结尾及两个可行预算。两类fixture各自证明工程行为，不能把人工响应的精炼效果外推为完整gamma.md或金融长教程的真实模型水平。真实模型恢复后须对同一实际输入、深度与预算另做叙事评审。

### 模板与文件门禁补充

`template-render-accepted/`实测Blue、用户Mood Board、用户Deal Review及生成的宽敞原生模板；全部实际PPTX重开和Office检查通过。Blue与宽敞原生模板各保留7条原生边；两个用户模板在本页实际容量下保留完整关系表（0条原生连接线），并已查看其真实渲染，不冒称其关系图形已fit。该测试是组件级，不能代替整稿叙事评审。

`native-route-verified/`记录21个真实线段及四种实际XML变异拒绝；`release/gamma/`最终成品117个线段经实际文件门禁验证。

## 4. 可复现命令

使用Node22、配置包含python-pptx/pdfplumber/Pillow的 `PPT_TEST_PYTHON`，并具备实际Office验证所需的LibreOffice。运行：

```sh
node apps/cowork-server/selftest-ppt-editorial-relational.mjs
node apps/cowork-server/selftest-ppt-editorial-http.mjs
node apps/cowork-server/selftest-ppt-relational-export.mjs
node apps/cowork-server/selftest-ppt-relational-templates.mjs
node apps/cowork-server/selftest-ppt-http-pipeline.mjs
node apps/cowork-server/selftest-ppt-http-authority.mjs
node apps/cowork-server/selftest-ppt-gamma-http.mjs
node scripts/ppt/fixture-source-matrix.mjs
npm test
```

独立UI：

```sh
PPT_FIXTURE_PORT=3185 PPT_FIXTURE_BACKEND_PORT=3184 node --import tsx scripts/ppt/fixture-test-service.mjs
PPT_FIXTURE_BASE=http://127.0.0.1:3185 PPT_BROWSER_SCENARIO=editorial node scripts/ppt/fixture-native-download.mjs
PORT=3185 npm run test:smoke -- --workers=2 --reporter=line
```

启动器只识别登记的gamma.md、PIPELINE_SOURCE和EDITORIAL_SOURCE，其他输入明确拒绝，不回落真实模型。改变来源可走source matrix，不能把未登记输入说成已经接入模型。启动器进程清理本轮在macOS验证，不宣称Windows实机通过。

## 5. 未完成的外部实验与质量层

Gamma内置浏览器当前仍无读取/点击/输入工具；`zz4404@nyu.edu`账号切换、12_ml_quant全文的Gamma生成观察尚未执行。原研究第14节保持未勾选，不用官方帮助页或旧附件补造实测。

本地模型按用户要求simulate，未调用真实LLM。本轮证明受控输入/模型响应下的实现、拒绝路径和导出可靠性；不能证明真实模型已经能把长教程精炼为Gamma级叙事。`readManifest`证明实际交付全文及验证ownership，不证明模型完整理解、内部NLP实现或私有思维过程。
