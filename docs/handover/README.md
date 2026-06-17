# Handover / 交接文档

系统架构、数据流、关键设计决策的持久化记录，供后续开发者（含 AI）快速上手。

**AI 须知：修改或新增文件后更新下方索引；检索本目录前先读此文件。**

## 索引

| 文件 | 主题 |
|------|------|
| updates-v2.md | 自动更新（研发平台 V2）：主进程自定义更新器（检查/CDN 下载/sha256 校验/win+mac 安装）复用登录 getBackendBase+apiRequest+token、三层避免重下+pending、强制升级阻断、kill-switch 回滚、退役旧 GitHub 检查 |
| agent-tooling-todo-bridge.md | SDK → SSE → DB 事件流、TodoWrite 字段映射、去重策略 |
| bridge-system.md | 多 IM 远程桥接系统架构（目录结构、数据流、设计决策） |
| assistant-workspace.md | 助理工作区：人格/记忆文件、对话式引导、自动触发、确定性落盘 |
| theme-system.md | 主题家族系统：两层架构、JSON schema、代码高亮三条渲染链、12 个主题清单 |
| cli-tools.md | CLI 工具管理：静态 catalog、系统检测、一键安装、AI 描述、聊天上下文注入、输入框选择器 |
| ui-governance.md | 设计模式治理：四层架构、ESLint 规则、图标/颜色统一、组件拆分记录、新增文件清单 |
| git-terminal-layout.md | Git 集成 + 终端 + 统一布局重构：四层布局、Git 后端/前端、终端抽屉、ResizeHandle 统一、已知债务 |
| onboarding-setup-center.md | 首次引导 Setup Center：三卡片引导流程、Claude Code 环境检测与冲突处理、Provider 三条凭据来源、目录校验回退链、Toast 系统、Windows 适配 |
| generative-ui.md | 生成式 UI Widget 系统：代码围栏触发、receiver iframe 渲染、CSS 变量桥接、流式预览、高度缓存、安全模型、UX 优化清单 |
| media-pipeline.md | 媒体管线：MCP image/audio 回显、Gallery 视频支持、文件树媒体预览、CLI 工具导入、MediaBlock 类型、入库机制、安全模型 |
| dashboard.md | 项目看板：MCP Server（5 工具）、数据源（file/mcp_tool/cli）、排序（CSS order）、导出（Electron 隔离窗口）、cross-widget 通信、CDN 脚本执行、fence-agnostic 解析器 |
| provider-error-doctor.md | Provider/Auth/Error 全链路修复 + Doctor 诊断中心：16 类错误分类、Provider 生效修复、Auth Style 自动分流、5 探针诊断引擎、修复动作、runtime-log 脱敏、CI arm64 原生构建 |
| memory-system-v3.md | 记忆系统 V3/V3.1：对话式 Onboarding、HEARTBEAT_OK 心跳协议、Memory Search MCP、时间衰减、Obsidian 感知、渐进式文件更新、Telegram 静默、transcript 裁剪 |
| buddy-gamification.md | Buddy 游戏化系统：生成/进化/3D 视觉、心跳双模式（完整 tick + 软 hint）、定时任务调度器健壮性、通知队列/轮询/Electron IPC、symlink 安全、cron 4 年扫描 |
| context-management.md | 上下文管理系统：token 预估、自动压缩（80% 阈值）、消息归一化 + microcompaction、PTL reactive compact、前端双指标可视化 |
| run-cockpit-context-card.md | RunCockpit 上下文用量卡片：右下角迷你点阵触发器 + 弹窗（%/点阵/明细/本次运行/Total cost）、buildContextUsageBreakdown 10 类拆分 + computeAllocations 点阵分配 + walkContextUsage 倒推 baseline、cost_usd 替代 tokenlens、无 context_accounting → 工具/规则/MCP 隐藏（compiler 入参预留）、三分支（完整/容量未知/无数据）、窗口优先级链 |
| compact-coverage-boundary.md | 压缩覆盖边界不变量：rowid 而非时间戳、boundary 只前进不后退、slash-command 反馈不入 DB、三条压缩路径的 boundary 写入规则、`_rowid` 端到端透传 |
| cli-upgrade-proxy.md | CLI 版本检测 + 一键升级 + 系统代理透传 + WinGet 支持 + Git for Windows 自动安装 |
| tool-call-ux.md | 工具调用 UX 优化：thinking 展示全链路、工具注册表、上下文归组、状态动画、流式缓冲/节流 |
| performance-memory.md | v0.45.0 内存优化：LRU 缓存、消息 300 条上限双向修剪、面板懒加载、流式文件读取、定时器追踪 |
| provider-architecture.md | 服务商架构全景：18 服务商配置对比、与 Claude Code 关系、认证/协议/模型矩阵、已知问题、优化建议 |
| provider-governance.md | 服务商治理系统：Zod Schema 防护、authStyle 修正 6 preset、宿主接管、连通性验证、引导 UX、错误恢复、模型 CRUD |
| decouple-native-runtime.md | Native Agent Runtime：双 Runtime 架构、AI SDK agent-loop、OpenAI Codex 集成、文件快照 rewind、MCP 全链路、验证边界与剩余风险 |
| builtin-claude-code.md | 内置 Claude Code（v0.55+）：SDK 平台子包架构、自动发现 binary、asarUnpack 配置、CI 跨架构装包、Native runtime 应急 fallback |
| markdown-artifact-overhaul.md | Markdown 渲染 × Artifact 预览体系：PreviewSource 联合、DiffSummary 卡片、Sandpack 单文件 React、CodeMirror 编辑+自动保存、长图导出 IPC、文件 I/O API 合同、loadedPath/freshPreview 防漂移 |
| login-system.md | 登录账号体系：浏览器 OAuth + ModelConfig 下发镜像到 api_providers (source='managed') + 与 OpenAI OAuth 完全隔离、双进程 token 文件共享、broker.ts 桥接、字段映射矩阵、错误处理矩阵 |
| gsd-bundle.md | 内置 GSD（gsd-build/get-shit-done, MIT）：vendor 流水线、平面化 + colon→hyphen 转换、Electron 同步 + IPC、agents 镜像 + hash 冲突跳过、Settings UI 完整面板、扫描器 frontmatter description 普惠修复 |
| skill-agents-dir-mirror.md | Skill 目录镜像（`~/.agents/skills/` → `~/.claude/skills/`）：内置 binary 只扫 `~/.claude/skills/` 导致 `~/.agents/skills/` 技能 agent 不可见、复制非搬移 + 标记 + 哈希刷新 + 孤儿清理、5 个调用点、与 MCP `46caccd` 同类问题 |
| conversation-interleaved-flow.md | 对话流交错渲染：文字/工具/思考按时间序交错；orderedBlocks 累积 + segmentsFromBlocks 保序配对 + MessageSegments 共享渲染；流式 + 持久双路径；旧消息 back-compat 限制 |
| batch-session-import.md | 批量会话导入：多选/全选/三态 checkbox、批量 endpoint（一次查重 Map vs 单条 N 次全表）、importOneSession 共用 helper、聚合 summary 永远 200、不跳转、嵌套 button hydration 修复 |
| credential-encryption.md | 凭证本地加密落盘：safeStorage 守一把主密钥 + AES-256-GCM、双进程 env 过河、Layer1(anlcode 文件)+Layer2(SQLite 列) seal/hydrate 咽喉点、静默迁移 + fail-safe、image-generator 绕过修复、威胁模型边界 |
| usage-meter.md | 额度用量进度条：用户栏内三条已用%进度条(总/国内/国外)、主进程代理 apiRequest('/api/v1/usage')、点开菜单才刷新、usedPercent/levelOf 纯函数、409/503/网络错误态、token 不出主进程 |
| cross-host-session-import.md | 跨主机会话导入：多 `projects/` 根目录合并扫描、自动发现 bsApp（claude-bs-agent）shadow HOME（`<userData>/claude-home`）、零配置导入 bsApp 历史、只改 claude-session-parser.ts 对列表/导入 API 透明 |
| multimodal-model-guard.md | 多模态模型标识 + 上传拦截：description 含「多模态」判定（已落 notes 列，零后端改动）、useManagedMultimodal hook、PromptInput 通用 validateFile、非多模态 managed 模型拦截图片/音视频 + AlertDialog、未知放行 + image-gen 绕过边界 |
| file-logging.md | 主进程文件日志：汇聚点设计（包裹主进程 console.* 同时捕获主进程 + 捆绑服务管道输出）、app.getPath('logs')/main.log 5MB×5 滚动、appendFileSync 崩溃安全、两层密钥脱敏（合并 env 精确值 + 形态匹配，保留路径/host/git SHA）、按完整行脱敏防 chunk 拆分绕过、uncaughtExceptionMonitor 避免吞掉 Sentry 弹窗、logs:open-folder IPC + 设置按钮、源头脱敏待办 |
| voice-input-client.md | 语音转文字输入（客户端，已实现/服务端 mock 联调）：百炼 qwen3-asr-flash-realtime 实时 WS、renderer AudioWorklet 抽 PCM16/16k + IPC、主进程 ws 持连直连百炼、临时 token 缓存(30min/复用)、麦克风按钮 + text/stash 回填、mac 权限/entitlement/Info.plist、逐文件完整代码 + 验证步骤。配套 voice-input-server.md |
| voice-input-server.md | 语音转文字输入（服务端，另一项目/待实现）：仅 1 个接口 POST /api/v1/asr/token——用真 DASHSCOPE_API_KEY 换百炼临时 token 下发已登录用户；⚠️TTL 必走 query string(?expire_in_seconds=1800，放 body 只给 60s)；契约/错误码/配额/安全/Node 参考实现/curl 自测，服务端不经手音频。配套 voice-input-client.md |
