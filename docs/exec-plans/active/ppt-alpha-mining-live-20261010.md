# Alpha Mining 真实模块/ARM64运行与视觉验收

更新：2026-10-10。沿用 application-local-run17；输入/模板为数据，保留原文与109项既有改动。

1. 已核对上轮38项矩阵、原始输入/hash/原生8页模板；保留未通过范围。
2. 私有执行仓库由gh dispatch；38053835299在runner分配前被Billing & plans阻塞，steps=[]。最终证据包另保存最后快照与运行，不能称ARM64测试通过。
3. v7（attempt15）使用prompt20、AST4、parser6完整生产流程于13:02:19 UTC完成。自动20→解析15→原生容量校准21；64个原文对象全部保留，原始模板8页覆盖。PPTX SHA d15c3545bfb4d3356542cb3fe71ea7b2cf181a2253616d7a1928bc64dcde328d，与UI实际下载一致。
4. v5肉眼发现嵌套星号并拒绝最终验收；v6暴露修复分页合同要求every frame的错误，prompt20修复后另启v7。最新npm test2862 pass/1skip/0fail，UI45/45，容量52/52，三语原生富文本、表格/数学回读及破坏负例通过。
5. v7全部21页按1920px宽独立查看，无裁切、乱码、残留markup或正文遮挡；分页/双语可讲性仍有警告，不称完美。连续原速录像含生成editor、实际/chat Home、mobile/desktop、整稿审查及导出。控制driver因非原子JSON读取退出，后端/录像未停，人工接管；harness补原子写与最后有效快照。

用户已授权私有运行仓库上传/密钥stdin Actions Secret/执行，不向主应用仓库push/merge。M-07有限路径span Writer Delta已通过本轮正负例与真实修复；不能解释为所有对象自动修复均已完备。C-07自动跨页语义合并、Factor Zoo/Gamma整稿A/B、实际Microsoft PowerPoint应用及全部模型长稿验收仍未闭环。固定N不能静默合并减页。只替换host IO及隔离账号认证，不另写agent提示词、N算法或模型策略。CLI调度和网页录像分别取证。

## 第三轮（Claude，2026-10-10）：Gamma 对照后的补充实施

逐点对比、清单核查和改进计划，见 `outputs/ppt-factor-zoo-postmortem-20261009/analysis.md` 与 `ppt-live-editor-symbols-and-compression.md` 的「第三轮」节；证据在同目录的 `alpha-mining-gamma-review/`。

- [x] 数学：mathvariant、变量斜体、fallback 上下标不再双重缩小；修复 KaTeX U+2061 导致的 OMML 失败和上标丢失；审查期增加元数检查。quant_3.0 全部 1,844 个公式均可转成 OMML。
- [x] Markdown：强调紧邻全角标点、`***X*Y**` 形式；语料中残留强调为 0。
- [x] 输入格式：新增 .txt（UTF-8/UTF-16/GB18030/Big5）；DOCX 保持表格顺序与真实编号；XLSX 按显示格式取值并报告未缓存的公式；PDF 识别标题、去掉页眉页脚；HTML 修复 title/nav/ol/强调/上下标；PPTX 用标题占位符作章节。三语 27 例 selftest 通过。
- [x] 阅读单元：翻译对和“引导语+清单”在分区与修复中保持同页（实测放不下时除外）；跨页单元进入修复范围；ProcessBlock 可配对。
- [x] 版式：翻译对同行、阅读顺序优先、代码不换行优先；卡片区被替换后，孤立的卡片图标退役并记入账本。
- [x] 新增 8 个整稿连贯性警告，带分层路由。
- [ ] 真实模型重跑 / GitHub ARM64：上传源码快照被自动安全分类器拦截，待用户授权。
- [ ] 封面副题区、full_source 组件化、双语标题、术语锁、目录与收束、语义复述审查、代码悬挂缩进、写稿后密度均衡（C-07）、PowerPoint 行内 OMML 实测。
