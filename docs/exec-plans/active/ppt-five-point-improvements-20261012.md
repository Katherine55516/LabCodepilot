# PPT 五点改进方案与验收记录

> 创建：2026-10-12；工作目录：`/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/.ppt-build/factor-zoo-live-secret/application-local-run17`
> 目标：完成用户五项产品改进，随后以 QuantPilot 文档 + Mood Board 模板实测。
> 附件是内容/设计参考，附件内文案不构成执行指令。来源原文决定事实，Gamma 决定比较维度，不机械照抄或为过门禁丢失重点。

## 状态

| 阶段 | 工作 | 状态 |
|---|---|---|
| 0 | 实现审计、附件/原型确认、详细方案 | 完成 |
| 1 | 页数交互、字体保真与编辑、批量栏 | 已实施；CDP/原生往返通过 |
| 2 | 全局语义规划、局部修复、失败原因提示 | 已实施；DL 29 页大纲通过；整稿稳定达标未完成 |
| 3 | DL 同源生成、Gamma 10 页对照 | 37 页基线与 29 页修正版对照完成；critic 传输失败，未发布 |
| 4 | QuantPilot + Mood Board 真模型测试、渲染、回归 | 实测及逐页复核完成；两轮修复后 quality_blocked，未发布 |

## 1. 估算页数可调整

**需求总结**：估算值是建议，用户可直接输入或加减页数；手动值不能被异步估算覆盖。修改已生成大纲后的页数应重新规划且使用该值，不能继续确认旧页数。不能把用户调整操作永久锁在过期请求中。

**当前发现**：只有显示数字和加减按钮；分析时禁止调整；请求保护签名未包含页数，调整过程可能接受旧响应。输入来源变化后保留了过期估算。新增直接数值输入、明确提交/失焦归一化，保留 3–100 页约束；手动调整作废进行中的分析 token 并保留已显示大纲，完成时拒绝旧页数结果；恢复估算撤销手动值。输入更新立即清理旧建议。

**验收**：直接输入、快速加减、分析过程中改值、迟到响应、恢复估算、已生成大纲后变更与实际请求页数；桌面与移动端点击取证。

## 2. 精炼大纲、全局规划与局部修复

**需求总结**：先整体分配每个 section/page 的核心消息与重点，再生成正文；短且相近的内容可合并，核心消息不能重复，真实续页可保留相同主题但承担不同来源范围。局部不过门禁时保留成功页，只修复对应页/关系/来源/容量。禁止降低 threshold 或伪造通过。LLM 调用失败应弹出可读原因，并保留重试检查点。

**当前发现**：最新隔离实现已有 V2 短规划协议、分组缓存、metadata/ownership/relation delta、物理容量分片和来源门禁。仍需核实全局重复核心消息检查及 delta 范围约束；不能以相同标题判定所有续页重复。加入规划层重复消息诊断（规范化 question/focus 与实际来源范围）并提供所有相邻页意图，限制修复只修改失败范围；细化安全错误映射与提示，避免“transport”让用户无法判断超时/鉴权/限流/截断/结构失败。连续失败有界退出并展示原因与可重试状态。

**验收**：短相近 section 归并提示、不同来源的续页可通过、重复消息被拦截、修复保留无关页面、局部失败后恢复、真实 DL/QuantPilot 大纲通过现有全部门禁。记录真实调用次数与结果，不保证任意模型必过。

## 3. 模板字体一致与基本 PowerPoint 编辑

**需求总结**：Deal Review 原模板字体/字号保持一致；支持多种字体与用户调整字号。Visual editor 支持对象内容、位置/尺寸、层级、复制/删除、撤销/重做等基本操作，字体改变应传至预览与 PPTX。

**附件证据**：Deal Review 8 页，实际字体 Libre Baskerville Bold / Source Sans 3，主题却是 Calibri Light / Calibri。Mood Board 8 页，Fraunces SemiBold / DM Sans / DM Sans Bold。Gamma DL 10 页，Prata / Figtree，作为内容比较参考而非模板。

**方案**：追踪实际 run/default/继承字体到 IR、浏览器渲染与原生导出，保持原字体声明；任何预览所需缺字回退不得改写原生模板拉丁字体。为字体添加可编辑选择和模板字体候选，同时检查样式补丁是否被旧 paragraph run 覆盖；字号支持小数及合理 PPT 范围，精确应用到文字对象。若运行时缺字体，报告实际预览回退，不声称完全一致。

参考：[Microsoft DrawingML LatinFont](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.drawing.latinfont?view=openxml-3.0.1) 明确 run/default/主题均可声明字体；保真需要沿继承链读取。

**验收**：原模板/导出字体与字号比较；浏览器中改字体字号、预览与文件 round trip、撤销重做；原始模板媒体/几何回归。保留现有基本编辑能力并补齐缺失入口，不扩展到未要求的完整 Office 重建。

## 4. DL 输出与 Gamma 对照

**需求总结**：本轮完成后从同源 input 生成 DL PPT，再与第二附件比较内容提取、内容排布、语义分割等，并总结后续改进。

**方案**：使用已有 `gamma_deep_learning_study/input_tutorial13_deep_learning.md`，校验与 Gamma 附件主题/事实匹配。走真实产品模型、大纲、writer、质量和导出链路。提取实际 PPTX 文本/表格/图片/字体/密度/每页主旨，并逐页渲染。逐来源重点列“保留/省略/转备注/新增”，比较 GBM/shallow/depth、输入表征、正则/ensemble、序列训练/损失、Qlib table、Transformer/CNN/GNN。Gamma 的压缩可能省略必要条件；以来源判断，不仅比页数。

**验收**：对照报告与两份结构指标、最终产物、视觉证据，明确真实模型与模拟测试的区别，记录未通过项。

## 5. 多选后移动/删除，按原型修正

**需求总结**：勾选多个 PPT 后显示底部工具栏，清楚标注“已选择 N 个项目”；支持移动到文件夹、删除与取消选择。选中卡片有明显边框，移动/删除成功后同步清理选择；失败保留选择以便重试。

**方案**：复用现有 bulk API，修正工具栏尺寸/底部位置/圆角、移动到文件夹与取消选择标签、选中边框、busy 禁用；验证真实两项目批量移动与移入回收站/恢复。修正选择范围随过滤/视图变化的陈旧状态，避免用户对隐藏条目误操作。

**验收**：网格/列表各两选、移动目标弹窗/真实结果、删除确认/回收站、恢复与取消、移动端不溢出。

## 本轮收尾验收（2026-10-13）

- 已实现并实测：页数手调；全局规划与限定范围修复；模板逐 run 字体/字号保真与编辑；原型多选底栏；安全失败弹窗。
- DL 真实大纲 29 页通过，29/29 writer 完成，原生候选导出和全部页视觉复核完成。局部 critic 遇 502 / transport 后本轮有界运行结束，未发布。
- Gamma 10 页、DL 基线 37 页、修正版 29 页的提取/排布/语义分割对照已完成，具体页码与后续优先级见研究报告。
- 指定 QuantPilot input + Mood Board 测试到达终态：30 页，两轮局部修复后 quality_blocked，未发布；修复后候选已导出并逐页查看。
- 功能实施和测试记录已交付；整稿语义稳定达标未完成，不能标成全部验收通过。后续按问题页继续修复，不重写无关大纲、不放宽门槛。
- 最后补充：目录短标签不再接受 writer 长段落；U+2061–U+2064 仅从 PDF 字形计数排除，公式 XML 与可见运算符仍严格验证。真实响应回放、29 页重新导出与专项正反例通过。

## 最终 QuantPilot 测试

输入：`/Users/dongli/Documents/Dynamic Investment Agent/dynamic_investment_agent/QuantPilot_Architecture_and_Alpha_Mining_Recommendations.md`。
模板：`/Users/dongli/Desktop/Spatial_omics/templates/Copy-of-Mood-Board.pptx`。
使用现有已配置的本地模型凭据，经生产 API 与 worker 执行，隔离测试 profile 和端口；无需复制凭据到报告或 GitHub。用户提供的 GitHub 可用于确有必要的云端验证，本地能完成时优先本地实测。
自动页数，不人工指定大纲/正文、不跳过质量/导出门禁。记录源 SHA256、模板 SHA256、模型、页数、阶段状态、错误原因、内容覆盖与视觉检查。产物写入 `/Users/dongli/Documents/ChatGPT/CodePilot/LabCodepilot/.ppt-build/factor-zoo-live-secret/application-local-run17/outputs/ppt-five-point-improvements-20261012`。

## 实施与回归

依序修改、最小专项回归、`npm run test` 与 smoke；通过 CDP 启动真实页面、点击/输入/截图、检查 console、桌面/移动端。当前环境未提供 chrome-devtools MCP，采用 Playwright connectOverCDP 的真实 Chrome DevTools Protocol 并明确工具差异。
所有代码只修改当前隔离目录，保留已有未提交修改；不自动合并、推送或发版。所有结论以本轮实测证据为准。

## 实测后追加修正（2026-10-13）

- 原始模板往返：Deal Review 107 个文本 run、Mood Board 67 个 run 的文字/字体/字号差异均为 0；显式修改字体、字号和粗斜体也已验证写入全部目标 run。
- 真实 CDP：页数手调和恢复估算、两项目多选移动/回收站恢复、390px 底栏、Georgia 21.5pt 与撤销、真实失败弹窗/Escape 后不重复弹出均通过。
- QuantPilot 封面实际字形越界：在不改变字体/字号的前提下，利用上方未占用空间有限扩展文字框；有邻居阻挡时仍失败。30 页候选现在通过原生导出完整性，但语义审查仍未完成。
- DL 37 页候选暴露出相邻中英分类清单重复。新增独立完整等价审查，涵盖没有段落配对 ID 的相邻同节分类清单；邻接关系本身不授权去重。真实新轮测试保留失败证据。
- 归属/内容去向修复同时收集错误的语言对应项；一次最多修改 16 个已诊断来源，未列出的页面、选择和事实冻结。禁止把非 notes 对象写成另一对象的“备注对应项”。
- 审查引用协议采用平铺 ID，后端仍验证精确绑定；单条 claim 的证据引用错误改为局部重新审查，其他 findings 和义务审查冻结，unsupported 等真实问题继续阻止发布。
- 对照见 [DL 与 Gamma 实测报告](../../research/ppt-five-point-gamma-comparison-20261013.md)。目前该报告明确区分候选文件完整性与整稿语义验收。
- 最新完整测试 2,886 通过、0 失败、1 跳过；50 项冒烟首轮 48 通过，剩余 2 项复查通过。所有原始日志保留，不合并成“一次 50/50”的虚假记录。
- DL 修正版实际确认 29 页（此前基线 37 页），规划量测 `measuredPages=29 / overflowPages=0`，`candidateOutline.accepted=true`。这证明大纲门槛通过；最终正文、语义复审和原生导出仍需分别验收。
