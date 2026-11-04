# PPT 最新原型对齐：创建、策略与局部编辑

2026-10-03；基线 de946f6。依据外层 AIMate_PPT_Implementation_Plan_and_Priorities.md（先更新后实施）。

## 范围与不变量

- 新建方式 → LLM → 模板 → 输入/异步估算/大纲确认 → 生成。版本更新、原生 PPTX 导入、管理与发布能力保留。
- 模板页数基线、手动优先、竞态保护；生产 3–100 页不变。
- generationPolicy v1：balanced/detailed、source language、source_only/source_plus_explanation；无字段的旧稿保持原行为。
- 项目拥有生成编辑面板，收起不卸载；范围稳定 IDs、续期保留目标、版本保护与参数幂等。
- 局部 Writing/Translate/Expand 参数进真实 Proposal，共用来源/语言契约与长度反馈；不绕过质量门禁。
- 默认精确宽屏 EMU，保真导入保持实际尺寸；输入、大纲、聊天操作在短窗口可达。
- 后续 P1 文字选区/完整容量报告/多候选组/交付追踪与 P2 Visuals/公式代码保持路线图，不扩展此次范围。

## 实施步骤

1. [x] 核查原型与源码，更新外层方案。
2. [x] 创建入口/页面重排、异步估算、策略字段与服务端保存。
3. [x] 共享 writer/planning/edit 策略和动作参数/长度反馈。
4. [x] 稳定聊天、完成态范围续期、幂等 payload。
5. [x] 精确页面尺寸与滚动布局。
6. [x] 单测/服务端自测、npm test、smoke、实际生产 UI 桌面/窄屏浏览器检查（仓库 Chromium；CUA 限制见下）。
7. [x] 回填证据、更新 handover 和执行计划索引。

## 验证

重点验证模板先于输入、空输入模板基线、估算晚到/清空/手动优先、paste/file Syllabus、旧 policy 兼容、局部参数约束、重复请求、同范围第二轮、旧 run 拒绝、精确 PPTX XML 与导入尺寸。UI 用真实滚轮/焦点/点击；不把 mock 模型验证称为真实生成质量验证。工作区既有 .ppt-build 与 outputs 不删除。

## 实施结果

2026-10-03 本轮 P0 基础闭环与 P1 写作参数切片完成。创建流程按最新原型重排；Prompt 直接开始生成，粘贴/文件同页确认 Syllabus；版本更新步骤保留。新稿使用可选 generationPolicy v1 / Prompt contract 2，旧稿不迁移。页数 API 复用语义估算而非新增模型调用，等待期间不提前覆盖模板基线或手动值。

项目级生成聊天收起不卸载，保存草稿和真实历史，完成后继续编辑。续期冻结页 ID，仅接受同范围自有 AI 操作带来的版本变化；目标手改返回 409，用户显式重选后才能用新基线。参数幂等、run/plan/epoch 与原质量/发布门禁保留。Translate/Expand 等七种动作进入 Proposal 契约，显示实际长度与近似目标反馈。

修复原代理缺少 preview、scope/intent/Proposal/runtime 等路径的问题；保留 ID/动作白名单和认证。默认宽屏精确 EMU；原生导入尺寸与媒体保真保留。短窗口输入、大纲、聊天底部操作可滚动到达，原生导入不受生成模板页数上限误限。

## 最终验证

- Node 22 下 `npm test`：2808 通过、1 跳过、0 失败；包含 TypeScript。
- 完整 smoke：33 通过；最终专项 UI 复验 5 通过，每项 pageerror / console.error 均为空。实际生产 Next 页面 + 隔离 API fixture，桌面和 390×500，真实点击/滚轮/键盘交互。
- 七组服务端自测通过：prototype parity、edit intent、mutation runtime、recovery sync、prompt contracts、structured、content depth。实际 PPTX 新稿宽屏与原生 4:3 尺寸回读、媒体哈希检查通过。
- 指定文件 ESLint 与 `git diff --check` 通过。英文/简体/繁体只增此次字段；原型文件未编辑，工作区原有 outputs / .ppt-build 保留。

见 [日志与截图](../../../outputs/ppt-prototype-parity/README.md) 和 [交接](../../handover/ppt-prototype-policy-chat-parity.md)。外层实施计划 §15 已回填实际结果与后续任务。

## 验收边界与后续

chrome-devtools MCP 未提供；CUA 内置浏览器未完成开发页面客户端加载，独立 React 组件页也未执行脚本，该尝试未算作人工验收。实际浏览器证据来自仓库 Chromium Playwright。模型调用采用确定性 fixture，未验证真实托管模型质量、远端 Cowork、跨设备恢复或 Electron 安装包。

完整容量/事实差异报告、文字选区、多版式候选组、交付追踪、Visuals、公式/代码 IR 仍在 P1/P2 路线图。本轮本地实现完成不等于后续 backlog 全部完成。
