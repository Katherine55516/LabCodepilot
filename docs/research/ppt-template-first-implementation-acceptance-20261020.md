# 模板优先、全文解释蓝图与 Visual Editor 实施验收

日期：2026-10-20（America/New_York）；基线：`4b8d91f1`。

依据：[研究及两轮 Gamma 实测](ppt-gamma-template-first-editor-workflow-audit-20261019.md)。本轮执行其全部产品改进；Gamma 外部实验复用研究证据，模型按用户要求继续 simulate。此文的“通过”分清工程合同、模拟语义、实际呈现、原生导出，不把模型测试替身的答案称为真实 LLM 能力。

## 1. 实施清单与实际入口

|研究项|实现/复用|实际变化与验收边界|
|---|---|---|
|P0-A、P1-B、R4、S2/5/8|`ppt-symbolic-interval.mjs`、presentation policy、semantic relations、relational diagram/cards|先识别无语言 ASCII 时间区间，再执行 omit-code；保留 Train/Purge/Validation/Embargo、符号端点及边界条件，原生可编辑形状/文字，不发明耗时或因果箭头。声明为 Python 的程序仍按代码政策处理。|
|P0-B/C/G/H、S2|input understanding、contract call、editorial context|不静默裁剪 coreMessage/来源问题，不过滤未知关系后当成功；保留原响应，坏字段定向修复。关系支持来源端点/span、类型、条件、support role，跨页引用与因果区分。沿用全文交付清单、真实路由上下文预检、超预算失败与来源缺口报告。|
|P0-D/E/F、R1/2/3/11、S3/4/5|semantic groups、outline protocol、global outline plan、planning/prompt contracts|auto/explicit 共享 reader 与质量合同；用户确认 N 后一次规划恰好 N 个物理页面，完整角色/问题/答案/来源所有权先于 writer 批次。保存 editorialBlueprint；问题与增量答案分开，旧 focus 回退有 origin。writer 读取全稿及临近页面责任，完整来源仍按 owned packet 提供。|
|S1/3、R1、P1-F|project view、create wizard、既有 readOnlyInput/API|仍为手动“读取并估算→调整 N→生成大纲→确认生成”。推荐只有 reader 一处，设置回执来自服务器保存值，分列深度、内容合同、语言、推荐、确认 N；执行策略仍在高级设置。源码/政策/模板身份与下游页面版本分别失效。|
|S6、R5、P1-A|table projection、content selection、object/export integrity、向导取舍预览|来源表行 ID/column key/sourceCellMap 固定；只在大纲授权、独立逐 cell 意义审核后使用 summaryRows。原表不改；数字不得变、同文字错列拒绝；生成和 fit 不临时删行。大纲可展开查看实际摘要表及文案。|
|S7/11、P1-C、R8/9/10|density capacity、render audit、原生模板 writer|表列宽先联合优化再报容量不足，仍守字号下限；最终图内子标签按有效 pt/实际框检查，8pt 负例拒绝。保留字体/模板身份、原生数学/表格/连线的既有导出验证，网页存在文字不代表 PPTX/PDF 可读。|
|P1-A/E、S8/9、R6/7|proposal service、AiCandidateControls|同一来源/内容生成少量合法布局实景候选，硬检查先于比较。候选可手改文案/列表/表格，生成新 ID/hash 并重新审查，不能复用旧通过回执。原生锁定模板不强制套用通用布局；需要重构时沿用组件副本路径。|
|P1-D、S9、L1/2/3/7/10|edit-target、StructuredPptEditor、PptCanvas、proposal service|UTF-16 源码范围/段落/稳定 item 或 graph-node ID，发送前显示固定目标；重复句不靠全文替换，UTF-16代理对不能割裂，公式须整项选择，范围外文字与未改成员格式保留。既有来源/关系/数值/样式约束继续生效。|
|P1-E、S10、L4/8|proposal versions/API、AiVersionHistory|before/after 双快照持久化，预览只读；显式恢复当前目标，检查当前 revision、计划和范围冲突，保留无关手工修改；有后续目标修改时拒绝覆盖。恢复不调用 writer。|
|S9/10、L1/7/8|source-summary-projection、command service/schema、object integrity|经批准的来源摘要可以局部改写：独立审查后签发服务器拥有、绑定来源/台账/当前文字的节点显示凭证；不改原文或大纲取舍。候选编辑重验，undo/redo 保存凭证，外部命令伪造凭证拒绝。|
|P1-F、S12、L9、R10|复用 DAG/SSE、run/epoch、progressive editor、失败/恢复与发布门禁|仅已开始/已完成页面进入画布，流正文与可观察阶段；旧运行/旧候选不能覆盖手改或新计划。超时/传输/额度/语义/容量按真实原因分流，失败保留草稿、局部继续；未验收不正式导出。专项负例覆盖迟到流、暂停恢复、页/媒体独立阶段。|
|S13、L2/5/6|复用 title hierarchy、typed proposals 与 Render Tree|主导语言主标题、次语言较小且异色/上方；正文语言设置独立。主题/字体/图类型改动仍需同事实/typed data、范围与最终测量检查；没有数据不生成统计结果图。|
|P2-A/B、S14、R10、L1–10|全文 ML 模型替身、真实 HTTP/模板/导出、真实 Playwright 交互|用户全文逐字进入生产管线；模拟只发生在 modelCall。Gamma 网页研究已有真实标准 18 页及局部优化证据，不再次登录/消耗 Gamma 或调用真实模型。本文不能证明真实模型对该长输入的编辑质量。|

L1–L10 为功能验收矩阵；部分能力早已在基线存在。本轮扩展稳定子目标/候选/版本，其余通过现有专项与页面交互复验；不另建第二个编辑器或事实 IR。

## 2. 实际发现并修复的问题

### 2.1 容量估算与生产绑定冲突

指定模板的比较页可以通过生产 `bindSourceArtifacts`，但通用 candidateFit 仍使用不同内容区域/测量结果，留下 `planned_density_overflow` 的 blocking 警告。HTTP 能启动生成，页面却禁用了确认按钮。

改为：大纲末次冻结检查同时返回实际来源绑定 fit；同一页、同一完整冻结来源确实适配时，记录 `production_frozen_source_binding` 测量与原先 preliminaryEstimate，替换旧估算。来源/页数/推荐不改变。缺失结构、真实容量失败仍 blocking；writer 新增解释和最终导出继续独立测量。这不是把所有容量错误降级成警告。

19 页负例刻意把两组来源过度合并，冻结检查准确指出第 2 页不能容纳；禁止启动 writer，保留 N=19、reader 建议=18 和草稿。不据此宣称任何 19 页方案都不可行，也不自动改成更多页。

### 2.2 翻译去重和内容类型

旧逻辑会把提及“步骤”的普通中文机制段误标 ProcessBlock，而英文对照仍为 prose，造成结构配对/容量异常。现在只把实际有序列表、短链或文本图认作结构。

语言审查 v2 覆盖真实配对的 prose/list/interval；相邻不是等义证明，b0069 障碍列表与 b0070 路径描述明确不等义；一次明确 false 不能被旧启发式再次去重。候选生成避免全 inventory 两两全文正则扫描。

### 2.3 封面和模板图标

Mood Board 的 section（16pt）与 title（44.5pt）是两个不同角色，不是跨两框的一条标题。自动 section 不再照抄主标题，优先使用有来源的全稿主题；原生字体和标题身份保留。

实际渲染发现，白色 glyph 离开原来的深色图形后在浅色背景不可见。完整组件重排与列表/表格 fallback 重定位两条路径均先检查真实、位于下方且包含图标的载体；不再把别处的深色形状误当其底色。不能安全拆出的图标不作重复组件，完整原生图形仍可进入测量过的 artwork rail。媒体账本检查两条实际移动路径，真正低对比仍报错。

模板摘要原有“source geometry is not reused”与原生保留能力不一致，改为说明配色/字体提取和按 capability 决定几何复用。

### 2.4 章节引用误判

`asymmetry (§6.3/§11.1)` 和 `bug (§2.5/§5.4, Trap 1)` 曾被当作函数公式；6.3 也曾按附近词当作金融指标。现在识别完整章节引用/定位列表，核对原文中同一引用或章节；虚构 §999.9 不通过。`第2–3页` 不被误作“第2章”。引用数字不能授权新的 6.3% 事实，真正 `unseen_function(alpha/beta)` 仍需公式来源。

### 2.5 模拟基础设施与旧断言

- 完整模板媒体每 30ms 全量 hydrate 的轮询改为较轻状态轮询、终态才 hydrate，避免测试本身阻塞生成；完整 24 页验收有真实审查/渲染成本，长输入测试的等待上限独立于产品超时，不伪造完成。
- 本轮 Next 开发缓存曾写满磁盘；只清理本轮可重建缓存，增加 fixture 专用禁用 webpack disk cache 开关，正常 dev/build 默认不变。启动器先实际预热页面/模型菜单路由，再宣布 UI ready，避免冷编译触发 15s 模型菜单超时。
- 旧测试的“每段代码至少换14行”与合法的 11pt bounded code 模式不符；改验原始行、实际字号下限及实际导出字形。OOXML 软换行 `\v` 与可见 `\n` 同义，重开表格时归一后比较。100 页上下文中不序列化无意义的空 owner 数组，保留真实所有权、当前页/相邻页受保护内容与上下文预算。

## 3. 测试身份、结果及文件

- 输入：`/Users/dongli/Documents/quant_research/quant_3.0/12_ml_quant.md`，不以短 fixture 替代全文。
- 模板：`/Users/dongli/Documents/ChatGPT/CodePilot/templates/Copy-of-Mood-Board.pptx`，真实上传、解析、原生适配与导出。
- 设置：标准深度、overview 内容合同、source_only、主要语言正文、代码 omit（两个 ASCII 时间区间作为语义图保留）、原生模板 design_only。reader 建议 18，用户调整为 24；不把 Standard 等同于全文照抄或另设代码推荐。
- 端口：3143 前端、3156 模型替身后端，独立 profile；3141 与已有 3152/其他服务不操作。原3143真实服务已在无活动任务时按保护规则停止，配置保留；模拟服务不读取真实 provider 凭据，不回退真实模型。
- 浏览器：当前工具目录没有 chrome-devtools MCP；以已安装 Playwright Chromium 实际加载/点击同一前端，并保存截图、请求、console 和真实下载。不是通过静态 grep 或把所有业务端点 mock 掉来代替 UI 测试。

最后冻结后的专项、UI 下载与实际视觉证据在下表逐项记录；较早失败日志保留，不覆盖为通过。PPT域本次148项均重新执行，未复用旧轮结果。

|验收轴|最终结果/证据|
|---|---|
|工程|最终`npm run test`：3024通过、0失败、1跳过（共3025）；PPT域148/148通过，源码冻结一致；实际浏览器全流程1通过（6.4min）、console/pageerror为空。|
|语义/来源合同|模型替身已审阅的答案 + 真实 ID/span/数字/表格/范围合同；不能外推真实 LLM 审美和编辑质量|
|呈现|最终原生PPTX→实际PDF→24页PNG，已复核3张contact sheet：标题/4表末行/区间边界/closing无裁切。保留下述稀疏布局及原生装饰的限制；不改服务器humanVisualReview状态。|
|原生导出|3143真实UI下载最终PPTX及PDF；revision=publishedRevision=10，exportable=true；24页、4原生表、38 OMML公式、32图片实例（21媒体资源）、0备注页；恢复后24页slide XML与本轮修改前完全相同。|

冻结生产代码 SHA256：`93f505a6ad4f626e59f9f45cf46e0c166f7f5df1a3531abfcf65eef185c78163`，结果：`outputs/ppt-template-first-implementation-20261019/domain-commit/results.json`。工程日志：`outputs/ppt-template-first-npm-release.log`。ESLint：0 errors，5项文件长度/Hook依赖警告。

输入 SHA256：`88e61c0e9d72c20d1fd45adfee9b1982487ef5ab484151455428b836e45e7c8f`；模板 SHA256：`d510e66a5f67502b3139651243092358b236e9ba150e90bf8d2d2385dd9f5eb3`。24页 HTTP 正例：`outputs/ppt-template-first-implementation-20261019/http-final-current/24`；19页过度合并负例：`outputs/ppt-template-first-implementation-20261019/http-budget-negative/19`。两种用户预算都保留模型推荐18，不由代码推荐覆盖。

## 4. 可重复运行

从本工作树运行，使用 Node 22，Python 指向安装了 python-pptx/pdfplumber/Pillow 的 runtime。

```sh
PPT_FIXTURE_USE_3143=1 PPT_FIXTURE_PORT=3143 PPT_FIXTURE_BACKEND_PORT=3156 \
PPT_FIXTURE_OUTPUT=outputs/ppt-template-first-implementation-20261019/ui \
PPT_ML_INPUT=/Users/dongli/Documents/quant_research/quant_3.0/12_ml_quant.md \
PPT_TEST_PYTHON=/Users/dongli/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 \
node --import tsx scripts/ppt/fixture-test-service.mjs
```

仅在3143空闲、原服务无活动任务并已安全停止后使用。该模拟服务只注册全文 ML、gamma.md 及指定小型输入；其他输入会明确失败，不调用真实模型。完整浏览器测试：设置 `PPT_ML_INPUT` 和 `PPT_ML_TEMPLATE` 后运行 `npx playwright test --config playwright.ppt-template-first.config.ts`。独立 HTTP 正/负例：同样设置两条路径，运行 `node apps/cowork-server/selftest-ppt-ml-http.mjs`（19负例、24正例）。


## 5. 真实页面补测发现的集成问题

- 候选 `revise/version/restore` 已有后端实现，但前端代理白名单遗漏，页面报 `Invalid PPT path`。增加仅 proposal 的三条精确路径，并测试 traversal、其他资源误用和多余 segment 仍被拒绝。
- 原文只读 textarea 在 Chromium 中按 Shift+Arrow 默认滚动，未形成选区。来源检查框增加只改变选区的键盘导航，按 Unicode grapheme/UTF-16 边界移动，并在鼠标、键盘事件同步固定范围；文本控件保留本地复制/粘贴/撤销，不误触整稿快捷键。切换对象或应用后清除旧范围。
- 非阻塞的媒体退休记录曾撑满画布。已验收项目默认折叠，仍可逐条展开；quality_blocked 默认展开，明确确认/理由/重验步骤保留。原生字体异步加载完成后再作 UI 视觉验收，不能拿尚未加载的 fallback 截图当字体保真结果。
- 应用文字候选时，资产注册器曾遍历全稿，把既有原生大图片按“新插入512KB”再次校验，导致 `image must be PNG/JPEG under 512 KB`。命令提交仅根据服务器已有 before-deck 的**完全相同图片字节**保留既有原生/来源或大图片，不改这些未选中图片的元数据；旧格式的小图片仍正常注册 assetId，新增/替换图片仍走原限制，伪造 nativeRef 不豁免。新增 `selftest-ppt-existing-media-edit.mjs`，并在真实 Mood Board 上实际应用/恢复文字以检验大图路径。
- 自动化曾把一次503的 `{error}` 当成 `{project}` 解引用。生产界面已保留进度继续；测试客户端增加有限的429/502/503/504读取重试和状态记录，恢复同一项目，不重写已完成页。底层连接错误只有 `fetch failed`，不能将其武断归因为模型超时。
- 版本列表按设计展示已应用操作，不展示已放弃候选。验收先应用经手改/重验的候选，再验证 Original/Modified 只读预览、显式恢复和重新发布；不为通过测试而将未应用候选伪装成已应用历史。

开发工具覆盖层曾在冷编译时遮住向导左下方“返回模板”。fixture 专用 Next dist 关闭开发指示器，正常开发和生产设置不变；不通过强制点击绕过遮挡。

浏览器脚本也修正了实际工具层的操作顺序：AI 侧工具打开时先用“关闭工具”关闭，再进入顶栏主题/版本历史。并发10个浏览器叠加长输入原生导出曾造成30s动作超时；使用单worker复验同一断言，保留失败日志，不加force点击或删除console错误断言。

### 最终复核追加：版本选择竞态与字体说明

真实长输入测试发现：选“原页面”后旧“候选页面”预览仍在，GET未完成就恢复会提交旧side。预览选择现会立即清空旧图、显示加载状态并隐藏恢复入口；以递增请求序号拒绝迟到响应，重载项目/版本时也失效。界面显式标明当前before/after，并提供稳定proposal ID。新增浏览器负例故意扣住after响应，先完成before再放行旧after，确认预览不回退、只提交before。主题面板分别展示模板主字体和中文字体，修正之前优先展示EastAsia备用字体、与实际Fraunces/DM Sans不一致的说明。

版本恢复请求还曾返回包含全部原生图片的完整project（约47MB），导致不必要的浏览器解析及DevTools响应缓存驱逐。版本工具现在显式使用`view=live`，与编辑器其他写操作一致；SVG版本内容及门禁不变，画布按既有刷新路径获取状态。测试只在HTTP错误时读取错误正文，不为成功断言额外读取大响应。

## 6. 最终交付与验收归档

- 实际项目：`08120227ca9248ffe8f476248afaa618`，`http://127.0.0.1:3143/ppt?projectId=08120227ca9248ffe8f476248afaa618`。
- 最终文件与实际UI证据：`outputs/ppt-template-first-implementation-20261019/ui-release/ML-Quant-Mood-Board-24p-Final.pptx`、同名PDF、`manifest.json`、`native-file-audit.json`、`final-contact-1/2/3.png`。PPTX SHA256：`c7fe723c3d70381d873e3ad688125746f9d45ea38733db20641ed5a58c18ba75`。
- 01–04阶段真实上传/读取/18→24/大纲及首次生成在同项目`ui-verified`截图和保留trace；最终`playwright-release`沿用该生成结果，完成候选编辑/重验/应用/只读版本/明确恢复/重新发布/实际下载。期间修复服务在空闲时加载，已完成的读取/大纲/页面没有重新生成。不能将这写成从未中断的单轮测试；最终收尾用例6.4min通过，前端源码全程未改动。
- 前端冻结SHA256：`da89ab2cf0ddfe3f54343280d1a6ea4d191781d30ef50fe1ee1e9058c941e625`。工程日志`outputs/ppt-template-first-npm-release.log`；浏览器`outputs/ppt-template-first-ui-release.log`。
- 全量97项smoke初跑90通过/7失败（并发测试期记录到加载/动作超时及开发chunk错误）；失败项保留日志。其所在3文件单worker复验32/33通过，剩余模型目录加载项在最终空闲服务复验通过；mention-picker另1项通过。新增版本竞态/字体显示与目录加载最终2/2通过：`outputs/ppt-template-first-smoke-last.log`。各失败用例均有后续相同断言的通过证据，未删除console断言或强制点击；**不冒充某一轮97/97一次全绿**。
- 恢复后源文件全文、未选对象内容/几何/样式保持一致；候选预览与版本预览不修改revision，恢复后才增加revision，正式导出仅针对发布revision。
- 实际视觉边界：用户确认24页比reader18更疏，12/13/14/19/24等页仍有明显留白；原模板低对比的静态白色装饰图标保留，不把它们当必读信息图或真实数据。未发现表格末行/正文/区间标签裁切。没有增加文字凑密度，也未改变用户确认N。此模拟稿和本地原生验证不证明真实LLM或所有Office环境的效果。
- 3143保留在隔离simulate profile；3141未改动，未声称其原本无监听的服务正在运行；3152及其他工作目录服务未操作。未push。
