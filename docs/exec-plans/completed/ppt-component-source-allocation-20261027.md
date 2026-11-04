# 局部填框：先分配来源，再生成组件文字

创建：2026-10-27（America/New_York）。用户要求：简短指令无需逐框指定，原PPT第6页真实LLM回归、导出验收后commit。

## 状态

1. 根因与边界：完成。旧写手只看到2个point和3个容器，仍按一要点一框写作，第三框为空；门禁正确拒绝，缺少写作前的来源分配合同。
2. 来源分段/容器分配与写手合同：完成。
3. 正反例及集成单测：4项默认单元测试及扩展领域测试通过；首次全量3133 pass/1 skip/0 fail。合法换行箭头支持补充后4项复跑通过，最终补齐单框普通文本边界后全量3135 pass/1 skip/0 fail，业务与测试文件hash前后一致。
4. 3157空闲加载、原C6简短指令真实回归、发布导出：完成，首次写手与独立审核各1次，无重试，revision4正式发布，10页原生导出通过。
5. 复核、独立提交：验收通过，仅提交本轮6个文件；不提交另一聊天的WIP、不push。

## 设计

- 先建立只含原始来源文字的分配合同，写手不得自行决定哪些框不填。显式流程可以按相邻边拆分，分片共享边界节点以保持顺序；限定语始终跟随原步骤。按阅读顺序、来源顺序和真实容器容量分配；2条流程可合理拆成3个框。
- 来源要点多于框时，保持顺序组合多个要点；少于框时，只拆可证实的关系链，不将任意句子按字符截断。无法支持所有框时显式报告source_insufficient，原稿保留；不补造事实，不复制整条主张填空。
- 写手只把每框已分配的原文片段转换为输出语言和容量内文字；框ID、来源pointIds、几何和样式由服务端控制。要求完整覆盖片段及边界，独立语义审核继续核对原始完整points。
- 空/重复/未知目标、越界pointIds、容量超限仍阻断。保留原无自动重试约定；本轮修分配设计，不加入无限或隐藏重试。
- 原C6已发布修订2保留为恢复点。通过产品版本恢复入口恢复本页原空框状态，再以原短指令发起新提案；不得用上轮已填好的版本伪装首次填充测试。其他9页必须不变。
- 与visual editor聊天协调，等待其活跃测试/模型完成才加载；不影响3141/3143或两个Claude任务。共享工作树仅提交本轮文件；全量单测在稳定代码上核验。

## 验收

- 源内2条流程→3框自动分片；全步骤/开发集限定/冻结与独立外测边界完整，无无来源内容。
- 更多/更少框、不同容量、单框、非流程短来源、未知ID、空字、恶意pointIds、超容量、删边界等正反例。
- 原项目第6页以“请根据本页来源补充方框内的内容，保持标题和其他页面”真实qwen3.8-max生成候选、语义审核、应用、发布、下载PPTX；审计响应与导出证据保留。
- 本轮所有定向/全量单测通过；实际导出字形/遮挡/可编辑文字和3框几何检查通过，未修改其他9页。失败诚实记录，不把模拟当真实。


## 实际验收记录

- 原项目`3adb5584ed6ab13915fd0a63ffd3d7da`第6页`page_5692ed387b313b0612b5`。3157在其他任务终态后由共享服务负责聊天使用非force保护启动器重载；加载manifest hash `e3679c842c094ff38f3763edaa0e3b6064e58f5c98b013ae9effbcedcdb98911`包含assignment模块。
- 原单页版本恢复遇到已知误判：publication将页码放至末尾，derived `nodeOrder`/`componentGraph`与proposal快照排序不同，返回409。节点无后续人工改动。本轮未绕过此保护、未宣称单页恢复成功；记录为单独待修边界。
- 通过产品整稿历史`revisions/1/restore`恢复原始空框，生成新草稿revision3，原published2备份和历史保留。实际检查3个未occupied容器、2条原始英语流程都在；其他9页规范化content与原published2相同。
- 原UI只输入“请根据本页来源补充方框内的内容，保持标题和其他页面”。没有逐框指定，没有复用上轮人工分配文字作为模型指令。写作前服务端分配原英语片段：研究员/LLM→候选卡片→compiler在第一框；compiler→开发集evaluator在第二框；冻结候选→独立外部测试evaluator→决策记录在第三框。
- 真实qwen3.8-max：一次writer 6,841ms，三框均非空；一次独立语义audit 8,173ms，2 points均preserved=true、unsupported为空。无模拟、无模型自动重试。模型保留了部分英语技术角色词，未声称全中文。
- 实际UI候选/应用通过，revision4；apply前后其余9页ensureDeckV3 nodes及templateSlotTexts完全一致。正式检查发布到revision4/4，0硬错误；45项旧稿审查提示保留。浏览器error控制台为空。
- 原生HTTP导出10页PPTX 1,892,281 bytes，SHA256 `cdbe8b8d6861410923ba99ec7e008948f741241a2aad53debdf09f60dc84df58`，与published verifier一致。LibreOffice重新打开到PDF、字形/遮挡检查通过，renderContract24。第6页120dpi逐框视觉检查及XML可编辑文字检查通过，无空框、截字或框外正文；原模板几何和顶部标签描边保留，本轮未做另一聊天的自适应排版。
- 最终全量`npm run test` typecheck及所有单元测试：3135 pass / 1 skip / 0 fail（Node22.22.0），4个新分配单测及扩展empty-component领域测试通过。最后补充仅object单框普通文本分支，slide路径保持一致；此单框边界用领域测试验证，未冒充真实页面测试。
- 证据：`outputs/ppt-component-allocation-20261027/`内`original-published-revision2.json.gz`、before-restore/empty-baseline/applied/published.json、test-start.json、original-c6-allocation.json、model-responses、acceptance.json、release-source-hashes.json、npm-test-release.log、ui-published-page6.png、page6-editable-text.json、export-page6-120dpi.png及`Research-Loop-Auto-Allocated-10p.pptx`/PDF。私有来源、PPTX及录制均不进git。
- 3141/3143未被本轮停止或修改；未终止两个Claude任务，未中断任何生成。真实模型窗口用完即释放，另一聊天可继续同源生成与排版。

补充核验：最后object专用普通文本边界修补后，当前slide路径捕获的prompt SHA与真实成功调用逐字一致（`slide-prompt-equivalence.json`），没有再次调用模型。最终release全量3135 pass/1 skip/0 fail，release-source-hashes前后不变。
