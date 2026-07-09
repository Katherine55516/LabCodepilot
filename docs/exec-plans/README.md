# Exec Plans / 执行计划

中大型功能的执行计划，包含分阶段目标、进度状态和决策日志。

**AI 须知：**
- 新建执行计划放在 `active/`，完成后移至 `completed/`
- 纯调研/可行性分析仍放 `docs/research/`
- 修改或新增文件后更新下方索引
- 检索本目录前先读此文件

## 什么时候需要执行计划

- 涉及数据库 schema 变更
- 跨 3 个以上模块的功能
- 需要分阶段交付的中大型功能
- 重构或迁移类任务

## 执行计划模板

```markdown
# {功能名称}

> 创建时间：YYYY-MM-DD
> 最后更新：YYYY-MM-DD

## 状态

| Phase | 内容 | 状态 | 备注 |
|-------|------|------|------|
| Phase 0 | ... | 📋 待开始 / 🔄 进行中 / ✅ 已完成 / ⏸ 暂缓 | |

## 决策日志

- YYYY-MM-DD: 决策内容及原因

## 详细设计

（目标、技术方案、拆分步骤、依赖项、验收标准）
```

## 索引

### Active

| 文件 | 主题 | 状态 |
|------|------|------|
| active/regression-library.md | 测试工作台:回归用例库(用例设计后自动沉淀「回归测试」标签用例 + 项目级库查看/管理 + 跨任务一键重跑) | 设计完成,待实现(批 A-E) |
| active/regression-library-v2.md | 回归用例库 v2 一期：执行轮次实体（留痕/快照/中断态）+ 回归套件（静态+查询构建器+pinned）+ 发起弹窗重做（套件/env/预检估算）+ 报告按来源任务分组与 delta + 库检索；硬门槛=打包版执行可用(#13)；方案见 research/regression-library-v2-benchmark-proposal.md | 设计完成，待开工（批 A-G） |
| active/test-regression-gate-audit.md | 测试工作台:回归集标签 + 用例门控 + 操作审计 | 开发完成(合并 PR #8),待打包验收 mac+Win |
| active/chat-latency-remediation.md | 聊天链路提速 + 模式入口收敛 + MCP 持久开关 | Phase 0 完成，Phase 1-4 待开始 |
| active/context-storage-migration.md | 上下文共享与存储迁移 | Phase 0 部分完成，Phase 1-3 待开始 |
| active/site-and-docs.md | 官网 + 文档站（apps/site） | Phase 0-1 进行中 |
| active/weixin-bridge-channel.md | 微信 Bridge 通道一次性交付方案 | One Shot 待开始 |
| active/unified-context-layer.md | 统一上下文层 + 浮窗助理 + 产品架构演进 | Phase 1-3 已完成，Phase 4-5 待开始 |
| active/provider-governance.md | 服务商系统治理：Preset Schema 校验、宿主接管、连通性验证、引导 UX、错误治理 | Phase 0 完成，Phase 1-6 待开始 |
| active/decouple-claude-code.md | 脱离 Claude Code 依赖 — 自建 Agent Runtime（Provider/Loop/Tools/MCP/Permission/Session/Skills/SubAgent） | Phase 0 完成，Phase 1-8 待开始 |
| active/runtime-auto-and-onboarding.md | Runtime auto 简化（CLI binary check 代替凭据推断）+ Chat 入口拦截 + 错误归一翻译（复用现有 SetupCenter）+ FileTree hotfix + 百炼 catalog 替换 | Phase 0-4 已完成（commits bc308e9/2d06f50/d1fac18/3e03919/a32837e），Phase 5 待发版 |
| active/issue-tracker.md | **统一问题跟踪** — 合并所有 Bug / Feature Request / Sentry 监控，持续更新（替代 open-issues + v0.48-post-release） | 持续维护 |
| active/opus-4-7-upgrade.md | Opus 4.7 模型升级：双 SDK 升级（agent-sdk + ai-sdk/anthropic）、`xhigh` effort + catalog 能力元数据回填、Native 路径 thinking/display/beta header 清理、tokenizer + vision 预算复核、prompt 字面化回归 | Phase 0 部分完成，Phase 1-6 待开始 |
| active/agent-sdk-0-2-111-adoption.md | Agent SDK 0.2.111 能力采纳（Codex 审核后双层化 + 用户视角推进路线图）：Layer A 已完成 Phase 1 chip + Phase 2b 类型适配 / 待做 Phase 1b chip 按钮 + Phase 2 限流 UI；Layer B 待 POC 后推进 WarmQuery / session fork / getContextUsage / 新 hooks / Elicitation / Deferred tools | SDK 升级已完成，下一步阶段 1（chip 按钮 + 限流 UI）1-2 周可发版 |
| active/agent-sdk-0-2-141-upgrade.md | SDK 0.2.141 升级 + 内置 Claude Code：从 0.2.111 升到 0.2.141（含 Claude Code 2.1.141）；切换到 SDK 新架构的平台子包，把 Claude Code 原生二进制内置到安装包；删除本地 CLI 探测；保留 Native runtime 应急 fallback | Phase 0-9 已完成，Phase 10 进行中，Phase 11 待开始 |
| active/login-system.md | 登录账号体系（managed-account login）：浏览器 OAuth + 服务端下发 ModelConfig + 与 BYOK 并存 + 与 OpenAI OAuth 完全隔离 | Phase 1-5 待开始 |
| active/updates-v2-migration.md | 自动更新迁移到研发平台 V2 API：主进程自定义更新器（检查/CDN 下载/sha256 校验/安装）复用登录 `getBackendBase`+`apiRequest`+token，退役 GitHub op7418 旧检查 | Phase 0 待审核 |
| active/v0.48-post-release-issues.md | v0.48.0/0.48.1 发版后问题追查（已归档至 issue-tracker.md，保留原始记录） | 已归档 |
| active/security-audit-remediation.md | 安全审计修复方案：2 处无鉴权 RCE（Shell 注入）→ API 边界鉴权（middleware）→ 文件接口作用域 → Bridge 访问控制/凭证加密 → Electron CSP/sandbox → 依赖升级，共 7 Phase | Phase 1-7 待开始 |
| active/stream-idle-timeout-rework.md | 对话流空闲超时改造：从「距上次任何事件」改为「距上次实质内容」计时，根治慢首包 provider 误杀（B-019），保留真卡死兜底 | Phase 0/1/4 已完成（c7888dc/e9ddbc2），Phase 2-3 可选暂缓 |
| active/test-framework-integration.md | 测试框架集成（对话内嵌测试）：把 ai-lab-test-framework 做成第三种对话模式（代码/计划/测试），上半结构化面板(看板/流程/报告)+下半对话流；锁定作用域/模式/视图模型，替换 Phase-1 的 /test 独立路由 | Phase 0 进行中，Phase 1-8 待开始 |
| active/test-account-settings.md | 测试账号设置：设置内新增多系统测试账号面板（系统下拉 + local/SIT 标签 + 密码/token/获取登录态），导出到 AI_LabTest `environments.json` + `.auth/` storageState，Electron BrowserWindow 抓取登录态 | Phase 0 完成，Phase 1-6 待开始 |
| active/test-report-display-and-evidence.md | 测试报告就地展示 + 产物预览 + 缺陷结构化 + 执行端接口/录像采集：报告节点完成后工作台流程页展示「概览+产物列表+内嵌全文」，md 渲染/编辑、xlsx 表格、证据截图+录像（每用例一段、留 fail/partial）、缺陷报告结构化模板、`@@RESULT` 加 `api` 字段穿透 run.json | Phase 0-6 代码完成（typecheck/单测 + CDP mock 验证通过），录像/接口真跑 POC 待验证 |
| active/test-multitask-parallel-execution.md | 测试工作台多任务并行执行：看板多选 + 批量执行（强制无头）+ 并发数 1–5（本机设置）+ 客户端排队（running/waiting 槽位调度）+ 执行前登录态预检（storageState 存在性/过期）；编排去单例化（busyTaskId/abortRef/autoRunRef → 按任务集合） | Phase 0 完成，Phase 1-5 进行中 |
| active/uploads-storage-relocation.md | 上传附件（截图/@文件）存储从用户工作目录迁到统一缓存 `~/.codepilot/` + 存储治理（会话级联清理 + 容量/TTL）+ `/api/uploads` 锚定根校验 + 存量迁移；连带 `.codepilot-images` 同迁 | Phase 0 完成，Phase 1-6 待开始 |
| active/mcp-marketplace.md | MCP 市场（对照技能市场）：接官方 Registry + Glama 兜底，server.json→MCPServerConfig 确定性映射，一键安装（prefetch 预热 + 安全确认屏障 + 密钥钥匙串），复用 `~/.claude.json` 写入链路 | Phase 0 完成（POC），Phase 1 进行中，Phase 2-4 待开始 |
| active/skills-discovery-fix.md | 技能创建与发现修复（应用内创建 + 手动拖入）：列表显示项目级 + 项目徽章、Option C 项目斜杠命令客户端展开、codepilot-skill in-process MCP 让 agent 自主发现项目技能（绕开 settingSources，全服务商一致） | Phase 1/Option C/根治/Phase 3/测试 全部完成；Phase 4 原生对齐待立项 |
| active/btw-side-question.md | `/btw` 会话内临时问答浮层（对标 Claude Code CLI /btw）：无状态端点 native generateText（无工具/不取锁/不落库）+ 前端 `/btw <arg>` 解析 + BtwDialog 浮层 + 前端内存上下文快照（含 in-flight），主对话流式期间不打断 | Phase 0 完成，Phase 1-6 待开始 |
| active/image-model-managed-delivery-client.md | **文生图模型账号下发（客户端层）**：去编译期 key 注入，改登录后服务端下发百炼凭证+模型列表；以 `settings.bailian_image_config` 落地（不进 api_providers，结构上隔离对话下拉框），复刻 ASR 下发范式 + broker 写入嵌入式 Next | Phase 0-6 待开始 |
| active/image-model-managed-delivery-server.md | **文生图模型账号下发（服务端层）**：新增 `GET /api/v1/image/config(/encrypted/hash)`，apiKey 复用 configs 的 AES-256-GCM 加密口令；图片配置独立于 configs 列表避免泄漏进对话下拉框 | S1-S5 待开始 |
### Completed

| 文件 | 主题 | 完成日期 |
|------|------|----------|
| completed/test-usage-stats.md | **测试模块使用统计**（P1）：test_stats_events 事件流水 + 纯函数聚合口径层（采纳率首轮基线 / 报告准确度+覆盖率 / 服务端逐用例计时 / 模型节点级归因 / 熔断排除 / 时间窗口计入门控）、10 类事件字典、四 scope API + 4 Sheet XLSX 导出、TestStatsView 看板（第 4 视图）+ 复核 UI + 节点用时/模型徽标。P2 匿名上报为独立后续里程碑 | 2026-07-09 |
| completed/marketplace-skill-translate.md | 技能市场「AI 翻译简介」：详情页一键翻译 README 到应用语言（非英语才显示），managed 第一个模型 + generateTextViaSdk 单轮（别名坑规避）、11 条规则系统提示词（含提示注入防线）、译文/原文可回切 + 模块级缓存、30K 截断 | 2026-07-03 |
| completed/document-preview.md | 应用内文档预览（PDF/DOCX/XLSX/PPTX）：复用 PreviewPanel 分发骨架 + serve 取 arrayBuffer + next/dynamic 懒加载四渲染器（react-pdf/SheetJS+DataTableViewer/docx-preview/aiden0z-pptx）、PDF 5 类离线资产管线（含 wasm+cmaps+iccs）、DOCX 三层强制 XSS vs PPTX 差异化安全、raw 路由中文名 RFC 5987 修复；老二进制 .doc/.ppt/.xls 不做 | 2026-06-30 |
| completed/credential-encryption.md | 凭证本地加密落盘：safeStorage 主密钥 + AES-256-GCM 列加密（双进程 env 过河）、anlcode 文件 + SQLite 敏感列 seal/hydrate、静默迁移 + fail-safe、image-generator 绕过修复 | 2026-06-03 |
| completed/gsd-bundle.md | 内置打包 GSD（gsd-build/get-shit-done, MIT）：vendor + 转换脚本 + Electron 同步 + Settings UI + 普惠修复 frontmatter description | 2026-05-25 |
| completed/markdown-artifact-overhaul.md | Markdown 渲染/编辑 × Artifact 网页预览扩展（DiffSummary 卡片 + Sandpack TSX + 长图导出 + 文件树新建 .md + CodeMirror 编辑 + DataTable + 文件 I/O API） | 2026-04-21 |
| completed/hermes-inspired-runtime-upgrade.md | Hermes 借鉴的 Runtime 能力升级：6 核心模块 + 12 额外交付（并行安全、辅助模型、子目录 hint、session 搜索、Skill nudge UI、AskUserQuestion、压缩通知） | 2026-04-12 |
| completed/engineering-quality-assurance.md | 工程质量保障体系（Harness Engineering）— 验证闭环、AI 文档、CDP、执行计划 | 2026-03-04 |
