# Handover / 交接文档

系统架构、数据流、关键设计决策的持久化记录，供后续开发者（含 AI）快速上手。

**AI 须知：修改或新增文件后更新下方索引；检索本目录前先读此文件。**

## 索引

| 文件 | 主题 |
|------|------|
| requirement-import-modes.md | 导入需求保留原文 + 需求分析节点二选一（生成 md / 直接用原文）：三文件模型（原始件 / docx 抽取文本 / AI 归一 md）、待选择闸门、批量停下等选、docx 必经抽取、需求来源路径穿透、向后兼容 |
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
| ailab-plugin.md | 内置 AI_LabTest（qitianersheng/ai-lab-test-agent, MIT）：参照 GSD 的 vendor 流水线，差异为命名空间用 commands/ai-lab-test/ 子目录、安装时改写 ${CLAUDE_PLUGIN_ROOT} 为插件目录绝对路径、默认关闭、停用真删命名空间目录、启用时经 /api/plugins/mcp 注册 playwright MCP |
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
| stream-idle-timeout.md | 对话流空闲超时改按「实质内容」计时：lastSubstantiveEventTime + markSubstantive 回调分类、shouldAbortForNoContent 纯判定（stream-timeout.ts 可单测）、keep_alive/状态不重置掐断、权限期间暂停、与工具超时/真断线正交、:1475 死代码说明、i18n 文案 |
| test-account-settings.md | 测试账号设置：设置内多系统测试账号面板（系统下拉 + local/SIT 标签 + 密码/token/获取登录态）、`test_account_systems` 表（明文）、CRUD + 导出 API、`toEnvironmentsJson` 前端预览/后端导出同源、AI_LabTest environments.json 契约（authType 按形状推断、TBD/"/" 强制、tag 大小写）、Electron BrowserWindow 抓登录态 → Playwright storageState 文件（抓取归 CodePilot/重放归 AI_LabTest）、抓取窗口安全模型、已知限制 |
| test-oracle-dual-rate.md | 测试质量（需求自审内化 + oracle 双轴 + 双口径通过率）：导入 requirement-review/completeness 规则、requirementPrompt 自审趟（内化评审直接修订需求、非交互不产 review.json）、casesPrompt + cases.json 加 oracle/验证性质双轴字段、reduce.ts 按 verification join 算功能验证四态(funcCounts/funcPassStr)、reportPrompt 双口径通过率、UI 标签 + 编辑器 select、export 两列、向后兼容退化 |
| test-report-compare.md | 报告多版本对比（回归分析）：run.json 历史快照(history.ts SHA-1 去重)+ diffRuns 纯函数(逐用例 added/removed/improved/regressed + 双口径通过率 delta)+ reports/history route + CompareView(版本选择 + 通过率变化卡 + diff 表)+「本次结果/对比历史」tab。复用 oracle 双轴 funcCounts 算功能验证通过率变化 |
| test-viewer-defect-revise.md | 报告查看器 + 缺陷报告 + 对话式修订（第一批剩余三项）：media route(证据图/录像流,白名单 basename + 视频 Range,路径穿越 404 防护)+ ReportView 缩略图 lightbox + defect route(缺陷单,守 QA 铁律只写期望行为+验收)+ 报告行三 tab(结果/对比/缺陷)+ revise route(读当前产物精准改写覆盖)+ composer 修订按钮(区别于 submitNote 追加指令) |
| test-exec-mode.md | 测试执行方式（独立窗口可见 / 后台无头）+ 执行前确认弹窗：补回原框架 headed/headless（桌面应用此前写死 `--headless`）；buildPlaywrightMcp 增 `{headed}`，**打包态有头改走系统 Chrome**（随包只有 headless_shell）；新增 `/api/test/probe` 服务端探活；run route 加 `headed` + `baseUrl` 覆盖；ExecConfirmModal（被测链接 + 执行方式 + 测试连接）；模式持久化 + 运行任务/auto-chain 复用不弹窗 |
| test-report-inline-display.md | 测试报告就地展示 + 产物预览 + 执行端接口/录像采集：报告步 done 后流程页详情卡显示 概览条+产出资料列表(测试报告.md 点开修改/Excel 预览导出/缺陷报告生成)+内嵌全文；md 渲染/编辑(MarkdownEditor 存回 /api/files/write)、xlsx 表格(新增 report-xlsx route exceljs 解析)、证据截图灯箱/录像内联(复用 ReportView mediaUrl)；reduce.ts 加 ApiInfo+sanitizeApi 透传 run.json、reports API 带 api+xlsxFile、defect prompt 接口信息逐子项；执行 prompt 加 browser_start_video 每用例录像(留 fail/partial)+ browser_network_request 采接口 |
| test-multitask-parallel-execution.md | 测试工作台多任务并行执行：编排去单例化(busyTaskId/abortRef/autoRunRef → runningTaskIds Set/abortMap/autoRunIds Set + forceHeadlessIds + waitingQueue)、runStep 加 target 参数化跑后台任务、auto-chain 各任务独立推进、客户端排队 pumpQueue 槽位调度(并发−autoRun 数)+ 批量自动批准 review→done、看板多选/并发下拉(localStorage 1–5)/批量执行(强制无头)/运行中·排队中徽标、inspectLoginState 纯函数(storageState 文件存在+cookie 过期)+ env-config GET 带 loginState + 批量启动前 runBatchLoginGate 弹门 |
| skills-discovery.md | 技能创建与发现（应用内创建 + 手动拖入）：两套运行时 × settingSources 约束、列表 PROJECT 分区 + 项目徽章、Option C 项目斜杠命令客户端展开（expandSkillBody + displayLabel 保 `/命令`）、codepilot-skill in-process MCP 文件系统直扫绕开 settingSources、磁盘格式识别矩阵、零开销注册、非原生执行语义局限 |
| document-preview.md | 应用内文档预览（PDF/DOCX/XLSX/PPTX）：复用 PreviewPanel 分发骨架 + serve 取 arrayBuffer + next/dynamic 懒加载四渲染器、isDocumentPreview 短路跳过文本通道、PDF 5 类离线资产管线（copy-doc-assets.js + public 绝对路径 + 四入口幂等挂载）、DOCX 三层强制 XSS 防护 vs PPTX 结构化渲染差异化安全、raw 路由中文名 RFC 5987 修复、@napi-rs/canvas+echarts chunk 待巡检、缺 e2e 用 CDP |
| skill-translate.md | 技能市场「AI 翻译简介」：README 一键翻译到应用语言（`locale!=='en'` 才显示），managed 第一行 + role default 模型经 generateTextViaSdk 单轮调用（CLI 别名坑规避）、11 条规则系统提示词（完整性/结构保留/不译清单/提示注入防线）、译文⇄原文切换 + 模块级缓存 + cacheKeyRef 竞态守卫、30K 截断、409/502 分支与验证前提 |
