# PPT fixture 与内容/媒体优化实施

创建：2026-10-19。依据：[评审与方案](../../research/ppt-gamma-fixture-content-media-review-20261019.md)。

## 范围与验收

按 P0-1→P0-7→P1-1→P1-10→P2-1→P2-2 执行。LLM保持受控模拟，业务HTTP、持久化、来源解析、编译、容量、发布、PPTX与原生下载真实执行。语义模型判断不冒充真实模型质量。不得改用户预算、丢选中事实或使用全文备注；不改变3141。提交仅包括本轮拥有的代码、fixture与文档。

|阶段|状态|交付|
|---|---|---|
|P0-1 纠正证据|完成|研究报告及独立 corrected-verification.json；历史原件保留|
|P0-2/3 后端HTTP harness 与真实来源|完成|仅注入modelCall与本地runtime，真实API、parser、inventory、检查点|
|P0-4 canonical一致性|完成|IR/preview/export revision、ID与内容一致|
|P0-5/6 role容量诊断与硬门禁|完成|正文/标题定位、失败不能发布|
|P0-7 实际浏览器下载|完成|真实导出响应、download.failure、hash/revision|
|P1-1 退役伪生成算法|完成|stage响应fixture，无正则删结构或截字|
|P1-2/3 全局语义骨架与完整摘要|完成|必要主张、条件、推断限定与来源锚点|
|P1-4/5 类型与composition|完成|表/流程/分支/代码及真实原生组件|
|P1-6 局部修复|完成|失败页修复、锁定页和预算不变|
|P1-7/8 关系媒体与账本|完成|原生信息图计入、装饰不计证据、丢边阻断|
|P1-9 媒体任务生命周期|完成|独立重试、run/epoch/hash保护|
|P1-10 空主题与碎片诊断|完成|空Workflow阻断、合并仅建议|
|P2-1/2 样式与多输入矩阵|完成|内置/上传风格及Gamma/Factor/DL/Alpha真实解析矩阵|
|最终验收与commit|完成（本次提交）|npm test、实际dev/CDP、生产3143复测、逐页/下载证据|

## 执行记录

- 起点HEAD为ab15d159；Dockerfile、layout.tsx、ChatListPanel.tsx、tsconfig.json及已有未跟踪资源不是本轮改动，不纳入提交。
- 研究报告和research索引是当前聊天上轮成果，纳入本轮文档提交。
- 不以fixture成功代替产品检查；现有能力若已满足条目，则补真实链路/负例证据，不重复实现平行引擎。

## 验收与复用说明

逐项code/prompt/fixture映射、故障和证据见[实施验收](../../research/ppt-fixture-content-media-implementation-results-20261019.md)。P1已有的全局分组、来源摘要义务、范围修复、typed关系、流式/epoch/lease和模板组件沿用原实现；补真实路径及负例，不重写平行引擎。

- `npm test`：3020项，3019通过、0失败、1跳过。
- 20组专项selftest：全部通过；代码空行真实PPTX/PDF和完整来源分片通过。
- gamma.md：真实业务HTTP、40页、69来源单元、0硬错误、实际文件重开/渲染可见性；critic模拟，不宣称实时语义质量或Gamma编辑质量已达标。
- 四输入、Light/Blue/Mood Board/Deal Review四模板矩阵；Gamma、Mood Board和Deal Review实际嵌入字体测试通过。
- Chrome实际dev/CDP点击与原生下载通过；桌面和手机截图，下载hash与发布hash相同。
- 使用隔离3173/3172验收开发UI，保留3143，不操作3141。最后只读探测3141没有监听；没有将其写成健康检查通过。
- 历史有损脚本归档并退役入口，不把旧mock界面的成功归为真实后端验收。
