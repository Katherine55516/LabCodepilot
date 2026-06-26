# 产品思考文档

记录功能设计背后的"为什么"——用户问题、设计理由、外部趋势、已知局限和未来方向。

每份文档对应一个 `docs/handover/` 中的技术交接文档，文件名保持一致，互相反向链接。

## 索引

| 文档 | 对应交接文档 | 主题 |
|------|------------|------|
| [updates-v2.md](./updates-v2.md) | [handover/updates-v2.md](../handover/updates-v2.md) | 自动更新 V2：检查别人仓库+自动更新从未实现的双硬伤、为何不用 electron-updater/放主进程/复用登录、check-only 省流量取舍、借鉴姊妹项目避免重下与自动安装、对照 Trae 取舍、强制升级阻断、dev 验证边界 |
| [cli-tools.md](./cli-tools.md) | [handover/cli-tools.md](../handover/cli-tools.md) | CLI 工具管理的 MCP 化、Agent-first CLI 趋势、凭证管理痛点 |
| [dashboard-generative-ui.md](./dashboard-generative-ui.md) | [handover/dashboard.md](../handover/dashboard.md) | 生成式 UI 持久化、AI-first 项目看板、系统级渲染层构想、实现后复盘 |
| [buddy-gamification.md](./buddy-gamification.md) | [handover/buddy-gamification.md](../handover/buddy-gamification.md) | Buddy 宠物伙伴设计：从工具到伙伴的用户旅程、稀有度/进化/心跳、视觉体系、审查修复决策 |
| [context-management.md](./context-management.md) | [handover/context-management.md](../handover/context-management.md) | 上下文管理：长对话失忆/PTL 问题、分级压缩策略、Claude Code 参考与取舍、Codex 审计驱动的优先级 |
| [run-cockpit-context-card.md](./run-cockpit-context-card.md) | [handover/run-cockpit-context-card.md](../handover/run-cockpit-context-card.md) | RunCockpit 上下文用量卡片：圆环只给「百分之几」的痛点、迷你点阵+展开卡片形态、诚实数据原则（宁隐藏不喂假数据 + 踩坑史）、cost_usd 替代 tokenlens 的取舍、与压缩系统的展示层/逻辑层互补、工具/规则/MCP 待后端记账的接口预留 |
| [cli-upgrade-proxy.md](./cli-upgrade-proxy.md) | [handover/cli-upgrade-proxy.md](../handover/cli-upgrade-proxy.md) | CLI 升级 + 代理透传：P0 版本问题、分渠道升级策略、系统代理无感透传、Git 依赖引导 |
| [tool-call-ux.md](./tool-call-ux.md) | [handover/tool-call-ux.md](../handover/tool-call-ux.md) | 工具调用 UX：thinking 展示设计决策、注册表 vs if/else、归组阈值、缓冲旁路、竞品对比 |
| [performance-memory.md](./performance-memory.md) | [handover/performance-memory.md](../handover/performance-memory.md) | 内存优化：LRU vs 定期清理、300 条上限 + reconciliation、定时器泄漏、大文件流式读取 |
| [user-audience-analysis.md](./user-audience-analysis.md) | [handover/provider-architecture.md](../handover/provider-architecture.md) | 用户受众分析：画像、需求优先级、竞品格局、品牌定位路线取舍（2026-04-04 数据快照） |
| [decouple-native-runtime.md](./decouple-native-runtime.md) | [handover/decouple-native-runtime.md](../handover/decouple-native-runtime.md) | 脱离 Claude Code：用户痛点（安装门槛/单一锁定）、双 Runtime 设计理由、OpenAI 集成、参考项目对比 |
| [builtin-claude-code.md](./builtin-claude-code.md) | [handover/builtin-claude-code.md](../handover/builtin-claude-code.md) | 内置 Claude Code（v0.55+）：从外置 → 内置的产品决策、3 个备选方案对比、+200MB 体积换零配置 setup、SDK 架构变化的偶然性 |
| [markdown-artifact-overhaul.md](./markdown-artifact-overhaul.md) | [handover/markdown-artifact-overhaul.md](../handover/markdown-artifact-overhaul.md) | Markdown/Artifact 重构：卡片点击 vs 自动弹、升级 DiffSummary、分档 50000 行 + 截断提示、PreviewPanel 编辑即核心能力、单文件 React 产品边界、长图走隐藏窗口复用、两段失败路径复盘 |
| [login-system.md](./login-system.md) | [handover/login-system.md](../handover/login-system.md) | 登录账号体系：BYOK vs SaaS 托管的并存决策、为什么独立于现有 OpenAI OAuth、文件 vs DB 存 token、启动不强制登录、与 bsApp 文档的偏离点、未来方向 |
| [gsd-bundle.md](./gsd-bundle.md) | [handover/gsd-bundle.md](../handover/gsd-bundle.md) | 内置 GSD：装完即用对比"自己装"、命名空间隔离 + 命令名共享的看似矛盾解、副作用收益（frontmatter description 普惠修复）、未来"多内置插件 PluginsManager"方向 |
| [ailab-plugin.md](./ailab-plugin.md) | [handover/ailab-plugin.md](../handover/ailab-plugin.md) | 内置 AI_LabTest：为何随包内置（安装门槛 + 自定义 provider 下 SDK 插件解析失效）、默认关闭/子目录命名空间/真删停用/${CLAUDE_PLUGIN_ROOT} 安装时改写的取舍、Playwright MCP 走 app 配置而非 .mcp.json 自启、与 GSD 的对比、通用化方向 |
| [skill-agents-dir-mirror.md](./skill-agents-dir-mirror.md) | [handover/skill-agents-dir-mirror.md](../handover/skill-agents-dir-mirror.md) | Skill"装了却用不了"：位置契约裂缝、与 MCP `46caccd` 同一类问题、为何复制到 `~/.claude/skills/` 而非注入正文/搬移、未来统一 reconcile 心智模型 |
| [conversation-interleaved-flow.md](./conversation-interleaved-flow.md) | [handover/conversation-interleaved-flow.md](../handover/conversation-interleaved-flow.md) | 对话流交错：工具多时不直观的痛点、参考 Claude 桌面版、为何全程交错而非仅完成后、为何不折叠、"顺序一直都在只是被丢了"的洞察、旧消息不可追溯限制 |
| [batch-session-import.md](./batch-session-import.md) | [handover/batch-session-import.md](../handover/batch-session-import.md) | 批量导入：逐条搬运痛点、多选叠加而非替代、全选=过滤结果（最小意外）、选中跨搜索保留 + 隐藏提示、后端 endpoint vs 前端循环的性能依据、批量不跳转、部分失败不中断、未来真实进度方向 |
| [credential-encryption.md](./credential-encryption.md) | [handover/credential-encryption.md](../handover/credential-encryption.md) | 凭证本地加密：保护公司下发凭证是 SaaS 化必补的一环、为何选 safeStorage+列加密而非 SQLCipher/keytar、双进程"主密钥过河"模型、"只加密磁盘、内存/env 明文是设计内"的诚实边界、静默迁移零感知、BYOK 丢钥不可逆与 Bridge token 未覆盖的取舍 |
| [usage-meter.md](./usage-meter.md) | [handover/usage-meter.md](../handover/usage-meter.md) | 额度用量进度条：放用户栏的位置选择、主进程代理而非 renderer 直连(零 token 暴露)、点开才刷新不轮询、三条已用%仅百分比的取舍、百分比放客户端纯函数、不显示货币/历史的轻量边界 |
| [cross-host-session-import.md](./cross-host-session-import.md) | [handover/cross-host-session-import.md](../handover/cross-host-session-import.md) | 跨主机会话导入：「同一份 CLI 为何各跑各的」认知陷阱、bsApp 进程级 env 隔离（shadow HOME）的副作用、零配置自动发现 vs 让用户手填路径的设计权衡 |
| [multimodal-model-guard.md](./multimodal-model-guard.md) | [handover/multimodal-model-guard.md](../handover/multimodal-model-guard.md) | 多模态模型标识 + 上传拦截：错误前移到上传那一刻、为何用 description 关键词而非结构化字段（务实可演进）、为何"无法判断时放行"、image-gen 绕过、通用组件只暴露机制不内置策略 |
| [file-logging.md](./file-logging.md) | [handover/file-logging.md](../handover/file-logging.md) | 主进程文件日志：「线上崩了没日志可查」硬伤起因（真排障案例）、为何汇聚主进程零侵入服务端、为何同步写换崩溃安全、只脱密钥保路径的 recall/precision 取舍、设置页一键打开、对抗评审逼出的三个坑（Sentry 弹窗/精确脱敏形同虚设/chunk 拆分）、源头脱敏与「复制诊断信息」未来方向 |
| [stream-idle-timeout.md](./stream-idle-timeout.md) | [handover/stream-idle-timeout.md](../handover/stream-idle-timeout.md) | 对话流空闲超时：330s 误杀慢首包的用户问题、「心跳无法识别只能豁免」的关键洞察、为何否决无条件心跳、按实质内容计时的取舍、990s 阈值/权限暂停、固有局限与未来方向 |
| [test-oracle-dual-rate.md](./test-oracle-dual-rate.md) | [handover/test-oracle-dual-rate.md](../handover/test-oracle-dual-rate.md) | 测试质量 oracle 双轴 + 双口径：AI 测试「自我证明」陷阱（代码反推用例永远 pass 冒充验证）、用例类型 vs 验证性质两根轴、功能验证通过率排除回归基线 + 全回归基线记 N/A 不报 100%、需求自审为何内化而非独立步、双口径放 reduce 确定性算、效果需真实项目实测 |
| [test-viewer-defect-revise.md](./test-viewer-defect-revise.md) | [handover/test-viewer-defect-revise.md](../handover/test-viewer-defect-revise.md) | 报告查看器+缺陷报告+对话修订：QA 看报告是看证据不是看文件名、测试报告 vs 缺陷单是两拨受众(守 QA 铁律=给事实+验收口径,不替开发产品决策)、修订 vs 追加指令分开(改当前产物 vs 喂下一步)、media 白名单安全、缺陷接口信息暂缺 |
| [test-report-compare.md](./test-report-compare.md) | [handover/test-report-compare.md](../handover/test-report-compare.md) | 报告多版本对比：单次报告答不了「有没有退步」的回归核心问题、这是 oracle 双轴埋的「回归基线主场」伏笔兑现、为何功能验证通过率变化才是真回归信号、文件快照不上 DB / 默认对比上一版 / diff 放纯函数前端跑的取舍、为何只做对比不做同批另三项 |
| [test-exec-mode.md](./test-exec-mode.md) | [handover/test-exec-mode.md](../handover/test-exec-mode.md) | 测试执行方式选择 + 执行前确认弹窗：无头跑「看不见 AI 在干什么」+ local 被测地址不确定两痛点、为何把选模式/确认地址/测连通合并到执行前一个弹窗、默认无头零回归 + 有头按需开、运行任务不二次弹窗、测试连接走服务端探活绕 CORS、打包态有头依赖系统 Chrome 的 best-effort 取舍 |
