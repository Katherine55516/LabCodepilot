# PPT 创建、策略与多轮编辑：最新原型对齐

2026-10-03；基线 de946f6。先更新外层 `AIMate_PPT_Implementation_Plan_and_Priorities.md`，随后实施本交接所列代码。原型文件没有修改。

## 本轮后续补充（2026-10-03）

最新[审计](../research/ppt_next_round_audit.md)、[性能实测](../research/ppt_performance_benchmark.md)和[代码/配置/迁移交接](../research/ppt_changes.md)已落地：binary模板上传、operator managed登记、模板IR/cache、媒体引用快照、source inventory/typed结构、可见深度QA与13里程碑。下文产品步骤与局部编辑协议保持；升级后snapshot v2回滚必须恢复完整备份，不能仅回滚代码。PPT回归通过；全仓E2E的19条Chat/Search失败与真实模型/远端验收边界见上述交接。

## 产品流程与兼容边界

新建方式（Prompt / 粘贴 / 文件）→ LLM → 模板和翻页预览 → 输入与生成要求 → 生成。模板中心锁定所选模板，但仍选择输入方式和 LLM；工具栏导入预选文件方式，后续同流程。版本更新继续使用原来的来源/进展、模板/页数、大纲确认步骤。

- Prompt 从输入页直接启动分析和生成，没有增加 Syllabus 确认页面。
- 粘贴/文件在输入页生成、编辑和确认 Syllabus。页数/模板改变后重新规划，保留人工编辑的 seed outline。
- 空输入展示模板页数；输入后 debounce 450 ms 请求估算。等待期间保留模板或上次结果，AbortController 防晚到覆盖。手动值始终优先，清空后也保留手动值；采用建议恢复自动模式。生产 3–100 页能力保留。
- `POST /ppt/page-estimate` 使用现有语义规划/容量估算代码，无项目写入、无模型调用。文件首次按字节体量和补充要求估算，解析后的建议再校准；服务不可用时明确标识本地 fallback。
- 原生可编辑 PPTX 保持原稿实际尺寸与页数，不受所选生成模板的页数上限影响。
- `min-height:0`、不收缩的头/尾操作和正文滚动修复短窗口可达性；同阶段渲染不重建滚动容器。取消入口、模板能力、压缩确认与上传能力保留。

## 策略与 Prompt

`ppt-generation-policy.mjs` 提供可选的 v1 规范：

```json
{"version":1,"detail":"balanced","language":{"mode":"source"},"knowledge":"source_only"}
```

仅 balanced/detailed；language 仅 source；knowledge 为 source_only/source_plus_explanation。错误配置在模型调用前返回 400。前端请求、项目 JSON、outline 重规划/确认、creationContext、planKey 和 Proposal 都携带有效策略。版本更新继承基稿的显式策略，无字段的旧稿保留原语言指令和自动深度逻辑；无需数据库表迁移。

`ppt-prompt-contracts.mjs` 的契约版本为 2。`normalizeBrief` 和 `writingGuide` 以显式深度为优先。新策略用实际输入语言，混合/双语内容保留原表达和事实归属；简易语言检测仅提供排版提示，不能把法语等拉回英语。旧稿继续读取原 outputLanguage/语言指令。

来源政策在 planning、writer、repair、edit context 中共用。source_only 包括稀疏 Prompt：可以解释给出的关系，但不能编造名称、引用、数值、条件或效果。source_plus_explanation 允许标记清楚的通用解释，不允许虚构具体业务事实。继续保护锁定标题、数据、公式、所需证据和只读相邻页，保留单份正文真相。

## 局部 AI 动作

`ppt/ai-actions.mjs` 提供 improve / grammar / translate / expand / shorten / simplify / specific 七种写作契约，复用 `proposal-service` 的原候选、apply/discard、质量和冲突检查。

- Translate：目标语言必选，replace/bilingual、地区、术语规则有类型和长度约束。局部翻译覆盖本次目标语言，不修改项目 policy；edit context 同样使用该局部覆盖。
- Expand：UI 1.5/2/3×，服务端 1.1–4；以当前目标长度为基线，优先展开已分配来源关系。容量和来源限制优先，不能重复凑长度。
- Grammar 只修拼写语法；Shorten 保留核心事实和限定；Simplify 保留专业区别；Specific 不补无依据的日期、指标或负责人。规则既进入 Prompt，也保持原数据/目标校验；不能把仅有 Prompt 的自然语言约束称为确定性语义证明。
- 写作动作不能路由到 layout/asset/data/structure。布局、图表、图片、结构继续走已有的独立命令契约。
- 候选记录 action/parameters/Prompt 版本/policy，并显示实际目标文字长度、倍率和无变化结果。计量为 CJK 字数与其他语言词数（排除代码围栏）；扩写超过或低于约定 ±20% 也标为未达近似目标。该反馈不是完整容量报告。

预览不改原稿；应用仍走 Command 与 QA，定向撤销机制保留。文字选区、列表项目标、多版式候选组和完整事实差异 UI 本次未实现。

## 多轮生成聊天

Workspace 按 project ID 持有 `GenerationEditDialog`，收起只隐藏。草稿按范围保存至 `ppt-generation-draft:<projectId>:conversation`；读取旧 slide key 以兼容未提交草稿。消息引用真实 intent 状态和逐页结果，不复制整稿。SSE 更新、完成态转编辑器与收起重开保留 composer。

每次发送先续期当前 scope，再携带稳定 idempotencyKey 提交。网络失败时保留同一规范 payload/key，关闭面板不会中断已提交请求；发送过程中继续输入的新文字不被响应清除。轮询全部活动意图，历史检查不替换正在输入的范围草稿。

服务端续期保持 current/remaining/following/section/deck 的固定 ID 集合，只更新版本/hash；检查同 run/plan、目标删除和 accepted。续期只允许前一 scope 的自有意图操作造成的版本变化；命令历史中额外的目标手改返回 409，用户需明确重新选择范围。范围外操作不因此获得修改权限。

幂等 digest 覆盖 instruction、scope/scopeId、type、action、规范 parameters、count 和 conversationId。内容阶段沿用 epoch fence；完成态使用原 Proposal worker。旧 run/plan 或候选晚到依然拒绝，已有恢复、重试和质量门禁不撤除。

桌面右侧约 400 px，主画布使用剩余宽度；窄屏底部 60dvh 面板自身滚动，收起可完整查看预览。原有 scope/intent 配额仍有效。

## 代理与页面尺寸

`src/lib/ppt-proxy-path.ts` 抽出原白名单并补齐模板 preview、估算、scope/intent、Proposal、asset task、页 accept/retry/regenerate、暂停恢复和手动排序接口。保留登录、远端 token 和 ID/动作路径限制；未引入任意代理。

新稿 render tree 和 Python PPTX renderer 使用精确 12192000 × 6858000 EMU。Canvas 与候选复用真实树尺寸。原生导入保留原稿尺寸；实际宽屏导出和 4:3 原稿编辑导出均以 python-pptx 回读验证，原生媒体哈希检查继续通过。

## 验证与限制

详见 [本轮验证](../../outputs/ppt-prototype-parity/README.md) 和 [执行计划](../exec-plans/completed/ppt-prototype-policy-chat-parity.md)。本地 Node 22：npm test、完整 smoke、相关服务端自测、PPTX 回读。新 UI 测试运行真实 Next 开发页面与生产组件，API/模型使用隔离 fixture；检查桌面、390×500、实际滚轮、按钮和 console。

chrome-devtools MCP 本会话不可用；尝试 CUA 内置浏览器时开发页未完成客户端加载，独立 React 组件页也未执行脚本，不能把该尝试称为人工交互验收。仓库 Chromium Playwright 测试是此次实际浏览器验收证据。没有真实托管模型内容质量、远端 Cowork、跨设备恢复或 Electron 安装包验收，也没有发版/部署。

完整 allocation/capacity report、文字选区、多版式候选、交付送达追踪、Visuals、公式/代码 IR 保持后续任务；不改其他模块。
