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
| cowork-local-vm-mode.md | Cowork 模式（本地 VM 隔离 agent）实现方案调研 — 官方 Cowork 逆向事实库（VZ/Hyper-V、vsock RPC、installSdk 动态推 CLI、VirtioFS）；推荐架构 = 宿主 SDK 不动 + `pathToClaudeCodeExecutable` 转发桥把 CLI 放进 VM（0.3.203 已核实）+ 官方 linux 子包 binary；macOS 选 VZ+vfkit、Windows 选 WSL2 私有 distro（明确不学 Cowork 走 HCS 的 Home 惨案）；文件走拷贝语义非挂载；P0–P4 分期与风险登记册 |
| cowork-p2-windows.md | **Cowork P2 Windows/WSL2 移植调研**（基于 P3 完成后当前架构，取代 P1 §5.2 的 SSH 时代粗判）— 移植面盘点（约半数模块复用，通道抽象层是关键接缝）+ WSL2 深度硬事实（裸 vsock 非免 admin、`wsl.exe -e` stdio 生产验证、systemd 0.67.6+、wsl-distribution.conf oobe = seed 等价、**#12443 隔离落差**、降级探测齐全、WSLC 2026 秋 GA 前瞻，均带权威源）+ **通道选型=`wsl.exe -e` stdio 模型（与现 exec 帧封装天然契合）** + W0-W7 分期 + **§8 企业无管理员深度核实（装应用免 admin 与启用 VMP 需 IT 一次性，两者正交；免 VMP 无可信隔离方案）** |
| cowork-remote-container.md | **Cowork 远程容器沙箱调研**（触发：企业 IT 禁虚拟化 → WSL2 对公司场景死亡）— 服务端容器替代本地 VM：威胁模型反转（真机隔离天然达成，新战场=多租户+内网横移）、转发桥换传输层架构（SDK 留客户端/帧协议端到端/容器 per 会话/daemon 可能退役）、模块映射（守卫/UI/契约层全复用，客户端零本地资产）、凭证三方案、R0-R5 分期（R0-R4 不需要 Windows 机）、docker exec EOF/gVisor 兼容/硬化基线待回填 |
| conversation-rewind-and-fork.md | 对话撤回与新开分支实现评估 — 对标 desktop-cc-gui（手搓 JSONL 截断）→ 我们可用 SDK 0.3.203 原生 `forkSession(upToMessageId)` 替代；统一原语"fork-at-message"（撤回=replace、分支=新会话）；P0 前置 = messages 表持久化 SDK uuid（现仅内存 rewind_point，重开即丢）；含锚点语义（对话层 assistant uuid / 文件层 user uuid）、降级链、分期估算与 POC 清单 |
| regression-library-v2-benchmark-proposal.md | 回归用例库 v2 竞品对标与方案提案 — TestRail/Xray/MeterSphere/Azure/方法论 5 组调研 + 16 项能力矩阵 + P0-P2 缺口 + 四支柱三期方案（轮次实体/套件化/信任治理/健康度与 AI 差异化）；配套可交互原型 `prototypes/regression-library-v2-prototype.html`（七屏，mock 数据） |
| regression-assertion-evidence-sampling.md | **回归脚本断言证据链真机取样（Phase 0）** — 离线挖掘 learning-system 的 17 个沉淀脚本/3 份轨迹/4 条真实修复记录，零模型调用；结论：断言取证方案（A′）作用面仅 4.7%（83% 断言压根不涉及 DOM 定位），建议暂缓；真根因是**用例 expected 把 Tailwind 实现类写死**（占真实失败 2/4 + warning 绝对多数）与**测试数据不唯一**（1/4） |
| smoke-test-feature-proposal.md | 冒烟测试功能方案（沟通中）— 现用冒烟提示词产品化为测试工作台第三段页签：任务子类型 + 轻场景（验证目标/预期结果）+ 3 节点无门控流水线，环境沿用现有配置、提示词 `<>` 占位符全转页面输入（§4.7 映射表），执行/报告机器全量复用 + @@OBSERVATION 体验观察通道；已拍板 5 项、场景来源范围待定；配套原型 v2 `prototypes/smoke-test-prototype.html`（五屏走查） |
| cowork-scheduled-routines.md | **办公模式定时任务（对标 Claude Routines）** — 三套 Claude 调度辨析（云端 Routines / Desktop 定时任务 / `/loop`）+ 15 条体验验收清单；现状实测（task-scheduler 调度机械已备但执行引擎是纯文本残废、零 UI、`scheduled_tasks` 缺 owner_uid 会跨账号串）；三方案（客户端调度 / 服务端调度真云端需 RD4-C / 混合推荐）+ 三个待拍板决策（谁敲钟、运行是否独占持久 workspace、补跑语义）+ P0-P3 分期与风险登记册 |
