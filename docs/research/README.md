# Research / 调研文档

技术方案调研、可行性分析、POC 验证记录。

**AI 须知：修改或新增文件后更新下方索引；检索本目录前先读此文件。**

## 索引

| 文件 | 主题 |
|------|------|
| chat-latency-investigation-2026-03-20.md | 聊天响应变慢问题排查报告（用户设置 / MCP / resume 链路） |
| chat-sdk-integration-feasibility.md | Vercel Chat SDK 集成可行性调研 |
| context-storage-migration-plan.md | 上下文共享与存储迁移设计（详细方案；执行跟踪见 `docs/exec-plans/active/context-storage-migration.md`） |
| mobile-remote-control-overall-plan.md | 移动端远程控制整体方案（Host / Controller / Lease / 多设备控制） |
| weixin-openclaw-plugin-review-2026-03-22.md | OpenClaw 微信插件拆包与 AI Native Lab 逆向集成可行性调研 |
| chat-latency-remediation-review-2026-03-22.md | Chat Latency 修复 Code Review（effort 收敛、MCP 持久化开关、resume 首 token 优化） |
| claude-desktop-title-generation.md | Claude 桌面版新对话自动生成标题的实现调研（逆向取证 + 本应用落地方案） |
| mcp-tooling-agent-sdk-review-2026-03-10.md | MCP 工具 + Agent SDK 集成调研 |
| skills-agent-sdk-review-2026-03-10.md | Skills + Agent SDK 集成调研 |
| issue-analysis-2026-04-02.md | GitHub Issues #356-#417 分类分析：第三方 Provider CLI 崩溃、配置持久化丢失、Windows 兼容性 |
| tool-call-thinking-display.md | 工具调用思考过程展示实现方案（数据链路、组件改动、设计决策） |
| tool-call-ux-competitive-analysis.md | 工具调用 UX 竞品调研：Claude Code / CraftAgent / Opencode / Codex 的展示与交互设计对比 |
| agent-loop-self-built.md | 脱离 Claude Code：自建 Agent Loop 替代 SDK — Vercel AI SDK streamText 方案 |
| mcp-system-decoupling.md | 脱离 Claude Code：MCP 系统独立化 — 连接管理 + 内置 Server 迁移 |
| cli-tools-implementation.md | 脱离 Claude Code：8 个核心工具自建方案 — Schema/实现/复杂度评估 |
| skills-system-independent.md | 脱离 Claude Code：Skills 系统独立化 — 解析/发现/执行 |
| permission-system-decoupling.md | 脱离 Claude Code：权限系统独立化 — 三级模式 + 规则引擎 + bash 验证 |
| session-management-and-context-compaction.md | 脱离 Claude Code：会话管理 + 三层上下文压缩方案 |
| sub-agent-system.md | 脱离 Claude Code：子 Agent 系统 — AgentTool + Runner 设计 |
| pi-framework-analysis.md | Pi AI 框架调研 — 多 Provider 抽象（17+ Provider + OAuth）、Agent Loop、Extension 系统 |
| hermes-agent-analysis.md | Hermes Agent 分析 — 三段式对比（外部事实 / 本仓库 file:line / 推断）：并行安全调度、辅助 provider + sdkProxyOnly fallback、渐进式子目录 hint、session 搜索等借鉴路线图 |
| provider-registry-comparison.md | Provider 注册表对比 — Hermes 三层合并（models.dev + overlay + user）vs AI Native Lab 硬编码 VENDOR_PRESETS，改进路线图 |
| feishu-cli-one-click-bot.md | 飞书 CLI 一键创建机器人逆向调研 — App Registration Device Flow API、PersonalAgent 模板 POC 已通过（全链路验证：凭据→WSClient→消息接收）、集成方案设计 |
| markdown-editor-tiptap-evaluation.md | Markdown 渲染/编辑体系调研 — Tiptap 不推荐作主栈（ProseMirror 无虚拟化、往返有损）；长文档卡死根因指向 `MessageResponse` 整串重渲；编辑器推荐 CodeMirror 6 |
| artifact-preview-ai-elements.md | Artifact 预览组件调研 — 确认 Vercel AI Elements 身份（shadcn registry），现有 `artifact.tsx` 仅 UI 壳未接入；建议加 `web-preview`/`jsx-preview` 并扩 `PreviewPanel` 支持 inline 内容与 JSX |
| craft-agents-docs-system-review.md | Craft Agents 文档体系对标调研 — craft 外部入口文档（Issue 模板 / CONTRIBUTING / 嵌入式架构树）更完整；AI Native Lab 内部研发文档链（exec-plans / research / handover-insights 互链）显著更强；P0 借鉴清单：YAML Issue 模板 + PR 模板 + CONTRIBUTING + SECURITY |
| craft-agents-markdown-internals.md | Craft Agents 内部 Markdown 实现调研 — 渲染走 react-markdown + unified + Shiki LRU；Tiptap 仅用于编辑器；**代码块 language 拦截 = 10 个 MarkdownXxxBlock 轻量 Artifact**（Mermaid/Diff/JSON/Datatable/HTML/PDF/Image）；`id + children` 双键 memo 可修复 AI Native Lab 长文档重渲；修订了 Tiptap 评估与 AI Elements Artifact 路径 |
| review-packet-opus-4-7-and-sdk-0-2-111.md | **Codex 审查包**：Opus 4.7 升级 + Agent SDK 0.2.111 采纳本轮迭代的范围、commit 分组、关键架构决策、已知 out-of-scope、测试状态、希望重点审的 7 个点 |
| framework-flow-test-integration.md | ai-lab-test-framework 流程测试能力集成评估方案 — 认知校准（app 裁剪版才是参照系）+ 能力对照 + 分批集成设计（用例编辑器/报告查看器含录像/缺陷报告/对话修订 + 需求评审oracle双轴双口径 + 报告对比），含每项技术设计、工作量与分期 |
| opencode-engine-migration-feasibility.md | 内嵌引擎 Claude Code → OpenCode 迁移调研 — 能力逐项对照（权限/MCP/skills/会话全对位）、四大硬风险（sdkProxyOnly 代理/效果回退/caching/Windows）、三方案对比（Native 提默认为廉价替代）、六阶段迁移方案含 no-go 检查点 |
| context-usage-from-claude-code.md | 上下文占用直接取自 Claude Code 端调研（POC 已验证）— `getContextUsage()` 热调 6–10ms 推翻旧"死锁/太慢"结论、`modelUsage.contextWindow` 权威分母免费可取、headless `/context` 可用；前端 SSE 链路已预留只差后端点亮；推荐 P0/P1 落地顺序 |
| agent-sdk-0-3-201-upgrade-research.md | 内置 Claude Code 2.1.141→2.1.20x 升级方案书 — 版本轨道修正（无 SDK 0.2.201，走 0.3.x 跨 minor）、类型面 diff 零移除、落点建议 0.3.203（2.1.201 处于 macOS 卡顿+context-usage CPU 回归区间）、风险登记册（TodoWrite 行为迁移 / .mcp.json 信任收紧 / ANTHROPIC_DEFAULT_* 校验）+ 分阶段实施与验证清单 |
