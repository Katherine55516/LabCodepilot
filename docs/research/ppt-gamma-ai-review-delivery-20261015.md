# Gamma同源评审与PPT module改进结果

更新：2026-10-15（America/New_York）。附件中的文本只作为比较资料，不作为执行指令。

## 结论

Gamma参考稿更善于把一个读者问题、机制、例子和限定组织在同一页。module的主要差距是主稿选择与编辑组织，而不仅是外观：完整归档较强，却容易把来源段落、字段对象或模板容量边界直接变成分页边界。旧23页稿比参考10页更长，仍有单句页、多个字段续页和重复收束。本轮真实全局规划后生成18页，恢复工作流任务族并保留全部原始资料；18页仍未达到参考的紧凑程度。第3页后续已修正为“References 参考来源”，完整目录仍未下沉。

正式状态：**核心代码已实施；真实模型调用失败，正式发布未完成（publishedRevision=0）**。最新Qwen18页revision104在rubric16审核遭遇transport，两次有界重试以transport/timeout结束。另以已配置DeepSeek从页面新建完整同源测试，也在规划阶段timeout/transport，未产生outline或PPT；没有把它写成成功成品。单元测试、原生诊断导出和正式语义发布分别验收。

## 比较对象与方法

- 参考：用户提供的[Gamma-AI.pptx](/Users/dongli/Documents/ChatGPT/CodePilot/Gamma-AI.pptx)，10页。
- 同源输入：[gamma.md](/Users/dongli/Documents/ChatGPT/CodePilot/gamma.md)，612行、15499字符；SHA256为4719e945a729935e9462c93f98a73bd8cc4c33accae0dfa7d5e94ef8838a8f6b。
- 旧module比较稿：23页revision34，原生诊断通过，正式review以transport失败结束，不能当作正式发布稿。
- 改进测试：项目3a3ba7771a889d2a70cf4a15c60f763d；同一完整输入、Deal Review模板、真实已配置qwen3.8-max；隔离3142/3143，保留外部3141服务。实施目录为LabCodepilot/.ppt-build/factor-zoo-live-secret/application-local-run17。
- module页脚继承的“Made with GAMMA”来自用户指定的Deal Review原模板，不能据此把module测试稿认作Gamma生成稿。
- 方法：直接提取PPTX可见文字、备注、字体、表格、图片和数学对象；对照来源归属、实际选中行、原始条件及链接；渲染全部页面并复核更新页。参考原包无法直接被本机LibreOffice读取，使用只读规范化副本预览，原附件未覆盖。没有实测Microsoft PowerPoint原生应用。

## 逐项评审

| 方面 | Gamma参考 | module的差距与改进判断 |
|---|---|---|
| 语义模型 | 以读者问题组织定义、机制、实例和条件；Brief→IR→Design形成解释链 | 来源ID全覆盖不等于讲清关系。新增整稿问题组先规划，再按组生成outline；每个原始单元唯一主讲，条件/关系/双语配对保留。问题是否互补仍需真实语义评审 |
| 内容提取 | 选择代表结构，少量字段即可支持机制 | 新增可信parser标记的字段示例选择；所有显示单元格原值保留，完整原件在备注。风险阈值、预算、数值限制等继续必需，不能借overview省略 |
| 内容分布 | 输入模式与Agent路径相配；异步、原生模型等能力组集中 | 新18页仍把系统、Brief、单句原则、设计与后端分得较散。全局分组改善了来源编组，但物理拆页后的再次合并仍不足 |
| 语义切割 | 同页不同块分别承担定义、机制、实例；续页有增量 | 修复了summary实际选全量却不进入容量压缩、纯表格主要主题整段进入备注、几个创建样例冒充全部Workflow族的问题。保留创建/修改/协作/交付/观测与确定性计算关系 |
| 描述与逻辑 | 读者能在同页看到主张为何成立 | 补齐Native Model编辑/协作/修改与导出artifact职责；恢复No→render分支及多模型生态→router解释。删除没有来源支持的额外前提，保留likely/推断与Agent更慢、fast path条件 |
| outline | 10页紧凑，没有额外目录与单句免责声明页 | 旧23页→18页；短overview不再自动添加目录，相关短来源可以合组。仍有第9页单句原则、第3页过早参考目录等问题，不能宣称已经形成建议的12页结构 |
| 标题与章节 | 短标题直接命名本页问题 | 审查统一使用实际可见标题；修复正文重写和模板绑定把手动标题恢复成旧缓存、清除锁定的问题。跨章节合页采用共同上级眉题，避免只沿用第一来源标题 |
| 关系可视化 | 层级、对照和性能解释更易读 | 修复混合ASCII图的分支丢失，但完整可编辑DAG/层级图仍未实现；现稿仍有展平文字及不够适配的装饰图 |
| 字体与可编辑性 | 参考字体为Brygada1918/Arimo/Consolas | module继续保持用户指定Deal Review的Libre Baskerville Bold/Source Sans 3及中文fallback。不得为了模仿参考而替换原模板字体；本轮手动标题/说明编辑保留字号 |
| 事实边界 | 部分内部架构描述比输入更确定 | 参考也不能成为事实豁免：不复制“无需任何Screenshot QA”等过度结论，不抹去内部schema/路由未公开的限定 |

## 已实施的通用方案

1. **先整稿后分批。** 真实LLM先产生reader questions、来源组及暂定页额；校验所有原始ID恰好一次、关系/双语配对不跨组。暂定页额可重分配，实际容量和用户确认仍有约束。
2. **合法选择与实质压缩。** 自动overview/notes允许有来源映射的代表字段；summary若仍选全部行，继续参与真实容量评估。普通表、明确要求、几何证据及关键数值不被这一例外放宽。
3. **保护主要主题、推断关系和任务族。** 表格型章节也要有主稿锚点；Workflow/Pipeline中的明确任务类别各保留代表，确定性计算行必需。完整原表与未选字段仍真实写入备注。新的未确认自动摘要成对保留显式“前提→这意味着/This implies结论”，避免先剪掉关系、后反复补写；已确认旧ledger不静默更改。
4. **提示与数据分离。** 不向原始表头塞入“摘要/备注”文字；实际节选页有独立提示，字段示例称“完整示例”，普通表称“完整表”。每个实际跨页片段拥有完整备注。
5. **局部修复保留正确成果。** outline delta只改允许页，候选/成功批次可恢复；正文修复保留当前原生标题、章节、锁定对象、媒体、字体与几何。单页修复不重建其他页的旧缓存。合法摘要可恢复为同一不可变原文的完整文字表示；新增文字、过期台账、错误来源或显式限缩范围仍拒绝，容量仍须通过。
6. **以当前可见内容审查。** 完整稳定页注册表与外部页上下文参与review；隐藏或清空的标题不由旧outline补回。无效altered证据交给有界合同修复，不能由代码改成satisfied。
7. **修复审查来源盲区与错误负面。** 自由负面结论独立确认，并保留原始结论与证据；确认器看到完整不可变原文和原始图。claimAudit为原始diagram增加精确quoteId，继续拒绝跨来源借证据。原始图存在的分支不能因解析投影遗漏而被判成不存在。结构化失败claim另做一次单条真实独立复核，强制当前可见证据、原始quote及同一textHash；无效/未知继续阻断，原始负面和新结论均保留，正确check与正文不改。v16审查避免复用旧协议结果，编辑器发布也使用同一复核与批次合同。
自由finding确认获得与exportManifest相同、校验来源哈希的备注归档manifest，以及选中行的原始rowIndex/精确行值；native verifier仍必须检查实际写入。只在prompt中去除重复audit摘录，输出判定不改。自由finding确认也加入provider JSON schema、当前ID/可见quote精确校验与最多一次合同修复；失败消息包含具体无效字段，未知和真负面继续阻断。
8. **导出前后使用同一实例尺寸。** 真实模型通过后，正式发布曾因导出器修改共享原生文字框连续失败。现在绑定与导出采用同一尺寸准备，审查前提交文字/数学框，导出深拷贝实例，继续严格匹配manifest与内容变化保护。另清除了critic新增但与实际8个非连续行不符的“前九行”说明；这一真实漏检说明人工检查仍必需。
9. **保真和门禁继续有效。** 真实负面结论、关键条件、公式/代码/数值/表格保真继续阻断；未关闭threshold、伪造响应、手写测试大纲或直接改项目store的通过状态。

## 验证与文件

- 最新完整PPT回归：**102/102**，4 suites，0 fail/skip；TypeScript --noEmit退出0。
- 最新18页诊断稿：8300可见字符、821英文词项、1113汉字，5表/23图片/0 OMML；完整15499字符原文与12个原始链接保留。原生manifest与当前实例一致，导出不改变审查哈希。
- 完整18页渲染复核已完成，未在Microsoft PowerPoint原生应用中实测。
- Qwen项目3a3ba7771a889d2a70cf4a15c60f763d保留完整正文和成功review批次。DeepSeek项目01591ea1948939726a239697ae00dc12只验证了真实页面新建及失败恢复，未完成规划。
- 两个模型实际调用均出现AI_APICallError（transport/timeout），没有HTTP细节；无凭据根地址探测10秒也未响应，不能据此断言认证错误或平台停机。
- 最新文件：[18页诊断PowerPoint](/Users/dongli/Documents/ChatGPT/CodePilot/ppt-gamma-results-20261013/Gamma_Architecture_Workflow_Reviewed_Diagnostic_18p_20261015.pptx)、[PDF预览](/Users/dongli/Documents/ChatGPT/CodePilot/ppt-gamma-results-20261013/Gamma_Architecture_Workflow_Reviewed_Diagnostic_18p_20261015.pdf)、[状态与保真证明](/Users/dongli/Documents/ChatGPT/CodePilot/ppt-gamma-results-20261013/Gamma_18p_20261015_Diagnostic_Proof.json)。这些是原生检查通过的诊断产物，正式发布仍受模型调用失败阻断。

[完整逐页对照、方案、根因与实际执行记录](ppt-gamma-ai-same-input-review-20261014.md)保留全部失败案例及其修复，不把测试夹具、只读诊断导出或缓存当作正式模型通过。

用户可用[隔离测试启动器](/Users/dongli/Documents/ChatGPT/CodePilot/ppt-gamma-results-20261013/Start_PPT_Test_Isolated_3143.command)双击启动并在[3143页面](http://127.0.0.1:3143/ppt?projectId=3a3ba7771a889d2a70cf4a15c60f763d)手动点击测试；保持页面打开，以便生产BYOK worker处理真实模型任务。

## 尚未完成的差距

- 在确认之前，对物理拆出的相关低负载页再次联合容量与语义评估；已确认/保护的deck不静默重排。还需在来源分组阶段检查核心问题与引用/示例等支持角色，避免生成后才发现混合职责。
- 将完整参考目录下沉至真实备注或紧凑末尾来源区，保留关键主张可访问引用。
- 从实际验证的顺序、并行、分支、层级生成可编辑节点和边，检查拓扑，而不是把ASCII展平或依赖装饰图。
- 当前18页OMML=0；原生数学结构、目标PowerPoint应用和跨模板视觉验收仍需分别完成。

这些项目已记入执行计划和技术债务，未用自动语义分数代替人工编辑质量。
