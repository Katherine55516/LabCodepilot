# 空框组件绑定、局部优化路由与跨语言验收修复

## 范围与隔离

基线 d0d5f986；独立分支 codex/ppt-component-local-repair-20261028。原项目 3adb5584ed6ab13915fd0a63ffd3d7da，第六页 page_5692ed387b313b0612b5。保留两个 Claude 任务及 3141/3143/3157，不修改其工作树、状态、端口或模型配置。使用只读快照建立独立状态与临时测试服务；不合并或推送。

## 已确认根因

1. 三个框是 locked/templateDesignOnly 图片；旧模板文字已移除，新内容绕排至框外，缺少卡片背景与内部内容区域的绑定。
2. 补充空框落入只允许修改已有文字的 content-patch，无法插入文本或调整目标组件内部布局。
3. 第一轮真实回复添加双语，两个框分别需要 2/6 行，只能容纳 1/4 行；容量重试改为中文后，missingCardPoints 英文词汇 30% 匹配产生两项误报。已以真实回复内存重放复现。
4. 页面虽然是 workflow/ProcessBlock，呈现退化为两个普通文本；整页词袋无法证明流程次序与数据边界。
5. 可见覆盖还读取 copy.blocks 等旧投影，可能把未渲染内容当成已展示。

## 实施顺序与验收

- [x] A. 用可信模板组件、成员几何和安全内边距建立可填写区域；仅高置信内容容器，不把照片/品牌图当成空框。原生背景保留，生成内容为可编辑文字。绑定、换内容与删除必须整体处理，空组件不得被静默发布。
- [x] B. 明确 fill-component 意图，优先于泛化 content/style；仅所选页/组件，使用本页已确认来源，保留标题和邻页。以服务器计算的容量规划文本节点，复用提案预览、版本冲突、审核、应用与撤销，不直接写 deck。
- [x] C. 词汇检查保留快速路径；跨语言/结构表达需要受来源约束的逐要点语义核验，验证当前可见对象、对应 ID、流程顺序和必要限定。证据绑定要点、来源、文本与版本哈希，内容变化即失效；不能由模型声明覆盖直接豁免，也不能降低阈值或跳过硬门禁。
- [x] D. 增加与渲染对象一致的内容提取；覆盖流程/列表/表格，移除仅后台存在的旧 copy 证明。容量失败应指出目标组件和可用行数；不能通过压缩其他文本解决填空请求。
- [x] E. 固定回归：真实第一轮容量错误、第二轮跨语言误报、真实删掉外部测试/冻结边界仍失败、旧投影不能蒙混过关、未知/锁定/照片不能误填、重复点击/版本冲突、应用撤销、未选页不变。
- [x] F. 用同份 PPT 快照第六页执行提案→预览→应用→导出；检查所有已用框内有字、结构完整、无溢出，检查 PPTX 内文字及几何并渲染截图。原项目和服务保持原样。
- [x] G. 执行定向 selftest、npm run test 与必要 UI 冒烟；记录结果后完成文档并 commit，仅提交本轮文件。

## 第六页内容设计

保留研究员/LLM→候选卡片→编译器→开发集评估器，以及冻结候选→独立外部测试评估器→决策记录的原始次序与数据边界。框数不是事实来源，不为了填满增加无来源内容；优先将相关流程放入绑定的内容区，未用框随组件整体处理，不留下空壳。保留模板配色和可读字号。

## 验收记录

待实施后逐项填写。模拟/录制回复回放与新真实 LLM 调用须明确区分；不得声称未执行的验证已通过。

## 实施记录

- `ppt-component-regions.mjs`：基于原模板内部标题/正文槽位、几何边界与简单框图像特征识别容器；保护固定对象/照片，按模板行分组阅读顺序分配。生成阶段先尝试把已审查要点绑定进原容器；未使用容器与旧示例整体退役。已有三空框页面通过 scoped fill 修复。
- `ppt/component-fill.mjs`：仅已认证空框可填，服务器控制 ID/字体/几何/来源；写手仅返回容器文字和要点引用。逐框按共享 render-contract 测量，保留全部已确认流程。整页填充仅替换松散的系统生成说明，标题、手工对象和其他页面不重写。
- `mutation-router.mjs` / `proposal-service.mjs`：fill-component 优先于泛化布局；复用预览、scope audit、版本检查、应用幂等和恢复。`typed-proposal` 在应用时只替换目标页，防止旧 deck 快照覆盖提案后其他页的手工修改。
- `ppt-card-coverage.mjs`：英语词汇不足不能直接代表翻译丢失；独立小范围审查当前可见对象，逐要点核验流程实体/次序/限定和来源支持。证据绑定来源版本、来源内容、要点、当前可见对象及位置；任意相关语义/位置变化使其失效；不改变内容/位置的发布测量尺寸变化不触发误失效，作者原文保护仍保留。未知对象、虚构引用、不完整检查、未通过结论均拒绝。
- 可见覆盖以 canonical nodes 为准，包含列表和表格；隐藏/删除对象不能从 copy 或 templateSlotTexts 复活。旧测试改为实际调用原生 slot binder 后再证明可见。
- 修复真实回归发现的恢复元数据问题：旧快照与应用后的 IR 规范化不同，前后快照均在同一规范化规则下保存，恢复时仍保留后续手工冲突保护。
- 原生导出实测首次使用独立 LibreOffice 时中文缺字；测试运行器加入私有 fontconfig，加载宿主中文字体。未改系统字体或主服务配置。

## 已完成验收与证据

- 固定单元回归：三空框识别/行阅读顺序、照片与固定图排除、fill 路由、超容量拒绝、来源关联、中文翻译、缺失流程/过期证据拒绝、隐藏对象与空 canonical nodes、表格覆盖、新生成容器绑定及空组件门禁。
- 原项目第六页只读快照重放：真实双语容量失败→一次 fit 重试→中文语义核验通过；三个框内部新增可编辑文本；重复应用幂等；恢复前/后版本；过期版本拒绝；其他九页 canonical 对象、槽位和 omission 不变。
- 另测提案后其他页发生手工修改，填充 materialization 保留该修改。
- 同份十页 PPTX 真实原生导出：`exportVerification.status=passed`，整稿确定性硬错误 0。第六页 XML 检查文字与矩形坐标；LibreOffice→PDF→PNG 实际查看中文可见、三个框内有字、无溢出。
- 定向领域 selftest 10/10，生产代码哈希在整轮测试中保持一致。完整 `npm run test` 首轮使用 Node 24 遇共享 SQLite ABI 不匹配，改用与三个服务一致的 Node 22.22.0 后 3111 通过、1 跳过、0 失败。最后复核避免与临时 Next types 重建并行，详见最终记录。
- 证据目录：`outputs/ppt-empty-component-repair-20261028/`，`acceptance.json`、`domain-final/results.json`、`export-slide6-text-geometry.json`、`export-slide6.png`、`Research-Loop-Component-Repair-10p.pptx`。完整真实 API 与 UI 路径见下方最终记录。

## 重放方式与边界

`node scripts/ppt/replay-empty-component-local-edit.mjs <GET-project-snapshot.json> <private-output>`：状态/原模板复制到私有目录，只有 modelCall 为具名录制/模拟回复；提案、命令、容量、门禁与原生导出均为生产实现。

`node --import tsx scripts/ppt/serve-component-repair-fixture.mjs <snapshot.json> <private-output>`：3179/3178 独立前后端、独立 SQLite profile；不读取真实 provider key。需要使用与本机 SQLite ABI 一致的 Node 22；工具/字体环境由私有测试 helper 准备。现有 3141/3143/3157 运行目录、数据库和原项目没有迁移或覆盖，本轮也没有进行新真实 LLM 质量评测。提交在独立 codex 分支，不自动合并到正在运行的分支。

### 正式发布补充回归

网页实测捕获发布阶段标题框测量高度变化导致已验证翻译证明失效；已将 proof hash 的几何部分收敛为位置（x/y），保留文字/对象/顺序/来源版本绑定。宽高变化仍由真实容量、遮挡和导出门禁验证；移动流程对象、改字、删边界或换来源仍使语义证明失效。重放脚本现在必须调用生产 `publishProject`，断言 `published=true` 后才写最终交付文件，防止仅直接 renderer 成功而实际发布被挡。

### 额外发现与处理边界

模板副本需同时保存账户 templates/<templateId>.bin，只有 original.pptx 会让 native-fonts/缩略图接口缺文件；独立 UI fixture 已补齐该只读模板副本。未修改生产模板资源。

发布器还会将页码移至 canonical nodes 序列末尾。语义 hash 现按稳定对象 ID 排序，并记录各对象位置与正文，而不把这类不影响视觉阅读的数组序列化重排当成语义变化；新增测试覆盖。实际关系顺序由流程文本、对象位置和独立语义核验约束，文字缺失与位置移动均使证明失效。

现存重复标题、旧库存 recall、密度/媒体建议等仍为可见审查提示；本轮没有为消除提示而改写其他九页、降低门禁或补充无来源内容。验收指硬门禁、组件填充和实际文件通过，并非宣称整份旧稿没有编辑建议。

## 最终验收（2026-10-28）

- 冻结代码领域回归：13/13，通过；代码哈希 `31047337051789c9325ab23edb7a2f181d28252ce3dcdb563836bed67fad2ef5` 前后一致（`domain-release/results.json`）。
- 最后一次完整 `npm run test`：typecheck、vendor 与全部单元测试通过，3111 pass / 1 skip / 0 fail。Node 22.22.0，与在运行服务的 SQLite ABI 一致；临时 Next 服务停止并撤销其自动添加的 types include 后执行，避免生成类型文件竞争。
- Codex 内置 Chromium 实际操作：选第六页→AI润色→输入“请根据本页来源补充方框内的内容，保持标题和其他页面”→发送→候选预览→应用→检查并发布→PPTX 下载。最后一轮 ai-edit/apply/publish/export 均 HTTP 200，发布 revision=2，10 页，0 阻断错误。所有缩略图正常，页面截图 `ui-final-published.png`。
- 下载 SHA-256：`27f803c58fc3b8685016310003ec4ae6ecf79e2bde259078988d02b9e95deb7a`，与正式发布 verifier 相同；大小 1,892,266 bytes。最终输出 `Research-Loop-Component-Repair-10p.pptx` 为实际 HTTP 导出字节，XML 几何记录及截图已刷新。
- 原稿相关审查提示保留；没有抹去 warning 来凑“通过”。本轮语义核验响应为模拟/录制回放，不把它称为真实 LLM 质量评测。
- 3178/3179/3180 本轮临时前后端已关闭。提交前检查时 3141/3143/3157 监听进程分别为 35781/40419/62345，启动时间未变；没有重启、合并、热加载或写入原服务。两个 Claude 工作树与任务未被本轮修改或终止。
- 仅在独立分支 `codex/ppt-component-local-repair-20261028` 提交；3157 仍运行其原代码，待任务空闲时再集成加载。

### 提交后服务复核

最终复核时 3157 的监听已由其原 `integration-20261026/scripts/ppt/manual-test-service.mjs` 启动器更新为 PID 86928（父 PID 86780，原 Claude 会话日志目录），属于另一工作树的服务生命周期变化。本轮没有向这些 PID 发信号或修改其文件。3141/3143/3157 的 workspace API 最终均 HTTP 200；3141/3143 仍为原监听进程。本轮修改仍只在独立 codex 分支，未自动集成到原服务。


## 3157 原分支集成及真实模型验收（2026-10-28 UTC）

本节为用户明确要求把 `d9f62ae7` 集成进3157分支后的新验收，覆盖上文“尚未集成”的历史边界；不把前述模拟结果当成本次真实结果。

- 目标：`integration-20261026` 工作树的 `claude/ppt-integration-20261026`。HEAD由`d0d5f986` fast-forward至`d9f62ae739403b1c483485d365f75977063f05a7`。操作前保存完整tracked WIP补丁和变更文件，按最新内容三方保留card-pages、outline-cards、quality和执行索引的另一轮修复；其余未提交改动保持。合并冲突脚本一度截短quality/README，定向测试即时检出，已从备份恢复并重新三方核对；该错误未加载到服务。
- 与“visual editor”聊天按用户授权协调，先等待其A/R生成结束。只读任务summary活动数为0，另一轮通过非force启动器的`assertPptServiceIdle`后统一重载。检查记录：`outputs/quality-remediation-20261027/service-stop-second.log`；没有停止活跃生成或另两个服务。3141/3143原监听PID35781/40419和启动时间保持。
- 集成定向7组通过：empty-component-local-edit、outline-cards、card-pages、mutation-runtime、proposal-targets、quality-routing、quality-pdf-recovery。最后一项首次系统Python缺pdfplumber，改用既有bundled Python后通过，无依赖安装。另一轮对组合工作树完整`npm run test`结果为3124 pass / 1 skip / 0 fail；详细统一记录归其111 remediation计划。
- 加载代码hash：`2b627ae52fc42e467e5797b3e311bdba44c9d075e3d3b96f93fc4bee2f974bca`，manifest确有component-fill。原项目`3adb5584ed6ab13915fd0a63ffd3d7da`、第6页`page_5692ed387b313b0612b5`，真实已配置qwen3.8-max，未改模型配置或以模拟替换。
- 首次宽泛指令“请根据本页来源补充方框内的内容，保持标题和其他页面”：模型把两条流程放前两框并返回空第三框，服务拒绝，原revision1不变。这是实际响应可靠性限制，不能声称宽泛指令一次通过。没有新增自动重试或降低空框门禁。
- 人工在UI明确源内分配后重试：开发流程拆前两框，冻结候选→独立外部测试评估器→决策记录放第三框。真实writer返回完整3个assignment，独立`review:card-points`逐条确认实体、箭头顺序和开发/外测边界，`unsupported=[]`。预览、应用通过；revision2，其他9页在apply前后ensureDeckV3 nodes及templateSlotTexts逐项相同。
- 实际UI检查发布与可编辑PPTX下载通过；显式publish API也确认`published=true`。发布revision=草稿revision=2，共10页，0阻断，45条旧稿审查提示保留。首次检查使用live投影未显示完整publication/verification元数据，后续查看durable/full项目确认；另一轮已单独补project-view投影，未用“200”代替发布成功断言。
- 正式HTTP导出1,892,266 bytes，SHA256 `1d6c3c8aa2b9b3f214628550902a1dd711f378e7edf29b48bbe48ee345a99ca0`与verifier一致。LibreOffice重开PPTX→PDF字形及遮挡检查通过，10页；第6页XML含三框可编辑中文步骤，120dpi实际渲染逐框检查无截字/框外文字。顶部英文标签的原模板描边在旧发布版已经存在，本轮保留。
- 证据目录`outputs/component-repair-integration-20261028/`：integration.json、before-integration.patch、before-integration/、domain-tests.json、model-responses/（两次writer+真实audit）、live-before-apply/live-applied/live-published.json、publish-response.json、acceptance.json、ui-final-page6.png、export-page6-120dpi.png、export-page6-text.json、Research-Loop-C6-Repaired-10p.pptx及PDF。
- 本轮集成未新增业务代码，未push；另一轮仍有独立未提交修复，统一提交由其整体验收后处理，不把这些WIP混入本次提交。

后续可靠性建议：先按可认证框数建立来源关系片段分配（允许同一流程跨相邻框，明确连续关系），再写框内内容，避免模型机械地“一来源要点占一框”造成剩余空框。若来源不能支撑全部容器，应提供明确的保留/移除空框布局建议并由用户确认，不能补造事实。此建议在本次仅记录，未暗中加入自动重试或额外改动。
