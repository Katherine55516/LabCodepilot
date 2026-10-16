# Exec Plans / 执行计划

中大型功能的执行计划，包含分阶段目标、进度状态和决策日志。

**AI 须知：**
- 新建执行计划放在 `active/`，完成后移至 `completed/`
- 纯调研/可行性分析仍放 `docs/research/`
- 修改或新增文件后更新下方索引
- 检索本目录前先读此文件

## 什么时候需要执行计划

本轮计划：[Claude 第五轮后的 PPT 核验与真实生成](active/ppt-claude-followup-live-20261011.md) — 2026-10-11，核验与真实生成进行中。

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

- [PPT 真实模型失败矩阵与修复](active/ppt-real-model-failure-remediation-20261015.md)：完整84次中8次失败的根因、修复与恢复记录；119项回归通过，按用户要求先提交，Factor最终整稿验收待续。

| active/ppt-report-completion-20261011.md | Gamma报告17步与原64项代码/真实UI/Office/质量闭环 | 实施中 |

| active/ppt-alpha-mining-live-20261010.md | Alpha Mining完整prompt/原生模板/自动N/真实BYOK/UI/ARM64/逐页QA | 进行中 |

| 文件 | 主题 | 状态 |
|------|------|------|
| [ppt-experience-quality-routing-20261014.md](active/ppt-experience-quality-routing-20261014.md) | PPT 工作区/创建/Visual Editor/聊天差异取舍与逐项改进；用户质量等级、按页难度多模型路由、预算/恢复及真实验收方案 | 按用户要求先提交；最终119项回归、npm2922/0/1、UI73+15及Gamma48页通过；84次矩阵原8失败保留并另列恢复，Factor98页最终验收暂停待续 |
| completed/ppt-editor-template-bilingual-20261013.md | 六项重新复核、创建操作栏、暂停/完成编辑、旧报告模板隔离和单语 topic/多语分组 | 本地实现/独立提交快照16领域/CDP/smoke通过；在线长稿及远端未验收 |
| active/ppt-factor-zoo-live-ci.md | Factor Zoo 原文与 Deal Review 模板的真实模型 ARM64 CI、容量合同修复、浏览器证据与最终导出 | 大纲合同修复进行中；真实整稿待门禁通过 |
| [ppt-gamma-semantic-improvements-20261013.md](active/ppt-gamma-semantic-improvements-20261013.md) | DL 29/Gamma 10 对照、语义组织与视觉修复、gamma.md 真实 3141 测试 | 进行中 |
| [ppt-five-point-improvements-20261012.md](active/ppt-five-point-improvements-20261012.md) | 页数、局部规划、模板字体、多选；DL/Gamma 对照与 QuantPilot 真模型实测 | 功能已实施；整稿质量验收未通过 |
| active/ppt-factor-zoo-postmortem-remediation.md | 51/10 页逐页比较、三语/短合同/候选错误、原生容量及语义质量修复 | Phase 0 完成，Phase 1 进行中 |
| active/ppt-byok-api-setup.md | OpenAI-compatible 持久化、PPT 本地模型队列、加密 API 设置与连接验证 | 本地实现/回归与真实 deepseek 连接完成；远端部署及真实整稿验收待执行 |
| completed/ppt-gamma-density-packing.md | Gamma参照密度、语义分组/容量packing、自动syllabus页数与prompt/可见QA闭环 | 本地实现与模拟/原生导出/浏览器回归完成；真实模型待验收 |
| completed/ppt-edit-intent-proposal-integration.md | 最新原型架构接入：共用模板确认、持久 Proposal/EditIntent、页级版本协调、单页 AI 前后预览与定向撤回 | 本地实现和回归完成；真实模型/远端/打包态待环境验收 |
| active/ppt-gamma-depth-design-editor.md | Gamma 样例驱动的内容容量页数估算、语义版式和编辑器样式优化 | 实施中 |
| active/ppt-general-content-media-balance.md | 跨模板/跨输入通用化：模板组件档案 + 内容供给 + 页数/版式/媒体联合规划；去重复填写、媒体随页数伸缩（映射模式也保留）、Gamma 相对区间的分布/深度/密度；双语按输入保留、非代码模板代码不上页并说明；真实模型矩阵验收 | Phase 1 ✅；Phase 0 harness/基线完成，真实模型矩阵待环境；Phase 2–6 待开始 |
| active/ppt-page-contract-relations-media-repair.md | PPT 四支柱确定性基础：类型化语义关系（矩阵/顺序/可替代/公式解释）及保真检查、页面设计契约（规划解析/推导/持久化/prompt v10/可见检查）、媒体角色账本、issue 所属层与修复路由（主题绑定、回滚） | A–D ✅；第二轮：来源外数字门禁、导出视觉证据与遮挡检查、prompt 压缩 −43% ✅；E（比例缩放/组件原型）与 F（真实模型）待开始 |
| completed/ppt-alpha-mining-gamma-comparison.md | Alpha Mining 双产物对照驱动的内容深度、原生模板槽位和无关媒体治理 | 已完成，含 16 页模拟产物与分析报告 |
| completed/ppt-alpha-mining-performance-depth.md | Alpha Mining 与 Performance Review 模板样例对照：模板文字容量、写作深度和可见内容质检 | 已完成，旧产物确定性复核检出 10 个硬错误 |
| completed/ppt-gamma-factor-zoo-parity.md | Factor Zoo 样例驱动的内容深度、point 篇幅/分布、自适应布局和可视化编辑改造 | 已完成，详见分析报告及 10 页模拟产物 |
| active/ppt-evidence-semantic-quality.md | 49 页 LLM Compression 输出评估驱动的 P0–P4 来源证据、叙事深度、模板语义适配、质量门禁与回归验证 | 实施中 |
| completed/ppt-html-semantic-content-repair.md | HTML 语义层级、逐页事实到原生模板槽位的内容一致性，以及模板变体图文可读性修复 | 已完成 |
| active/ppt-workspace.md | 办公区 PPT Workspace：M1 远程生成；M2 输入/治理；M3 版本/模板；M4 丰富编辑；M5 `review → repair → publish`、九类版式、模板字体、有界并行 DAG 与整稿评审 | M1–M5 本地实现并通过本地门禁；真实 Cowork/跨设备、容器 PDF 和安装包验收待补 |
| active/ppt-20260924-requirements-parity.md | 2026-09-24 需求与原型差异补齐：真实 outline 预览、版本更新大纲、手动排序、移动端导航、生成逐页展示、编辑器退出守卫及导入 LLM 顺序 | 本地实现与自检完成；真实登录 Cowork/跨设备验收待补 |
| completed/cowork-scheduled-routines.md | **沙箱定时任务（服务端调度·对标 Claude Routines）**：定时任务跑在公司沙箱服务器，关掉客户端也运行；客户端只做管理/拉取/展示。routineId 直接当 sid 用（自动获得独立容器+持久 volume，orchestrator 零改动）；凭证走 RD4-C 且**单独用 APP_COWORK_INTERNAL_SECRET**（不复用 COWORK_AUTH_SECRET，防沙箱失陷升级为全员 key 泄露）；运行仍物化成 chat_sessions 复用渲染，但**办公列表加 routine_id IS NULL 排除**，靠三层面包屑导航进入。P9 生产端到端全绿（调度器自主触发、审计链六事件归属正确、产物落卷、删除连带清卷） | ✅ P0-P9 全部完成（2026-08-10） |
| active/context-usage-accuracy-overhaul.md | **上下文用量计算正确性改造**：四类根因（权威分子交付链断裂 / fallback 被 sidechain 污染 / UI 与压缩分母双轨分叉致 managed 1M 误压缩 / 压缩估算脱离真实 resume 上下文）→ 五 Phase：探针结果回合末拉取闭环 + sidechain 过滤 → 分母单一 resolver → resume 路径压缩权威交给 CLI auto-compact → 明细分类真实化（探针 categories 落库）+ source 徽标 → 回归与观测；决策点 D1 分母 live 优先 / D2 压缩二选一 / D3 cowork 探针缓做（均已拍板） | **Phase 1-5 全部完成**（c8d1109→560c7bf，6 commits，dev 态验证 2767 单测 + 冒烟 17/17 + CDP）；4A 明细分类经实测**改为不做**（探针临时 HOME 无配置，分类非真实构成）；剩打包态验收 / Windows slug / 办公沙箱盲区（另立项） |
| active/cowork-usage-admin.md | **沙箱使用情况管理后台**:审计入库(exec_end 补全 + 惰性增量拉取 + fileId 截断容错)→ PG 统计(用户/会话/成功率,JOIN users 换人名)→ admin web「沙箱用量」页;admin 可删会话/看下载产物(UD2/UD3),动作写 admin_* 审计回流留痕;`__admin__` HMAC 鉴权零新密钥 | P0-P2 完成;沙箱侧已上线;账号后端待用户部署(pull+migrate+build) |
| active/cowork-routines-admin.md | **定时任务管理后台**:沙箱 `/admin/routines*` 四端点(文件直读,全局列表/历史/停用/删除+审计留痕)→ 账号后端代理(JOIN users 换人名)→ admin web「定时任务」页(统计条/任务表/历史抽屉/transcript 下载);边界=看+停+删不代建不代改(AD1),停用走 disabledReason 用户侧透明(AD3),v1 不做硬锁(AD4);顺带补用量页 routine 字段显示(§L.2 旧账) | 设计完成,待用户确认三个未决问题后开工 |
| active/cowork-p2-windows.md | **Cowork P2 Windows/WSL2 移植**:补平台后端(约半数模块复用,四接缝=通道/生命周期/分发/网络)；通道走 `wsl.exe -e` stdio 模型(与现 exec 帧封装天然契合，免 admin)；决策 D1 接受策略级隔离先交付/D2 全 Win10-11 不设门槛/D3 stdio/D4 实测需 Win 机；W0 通道 POC 先行 → W1 抽象(macOS 可做) → W2-W7 | ⏸ 挂起(企业禁虚拟化→远程容器方案取代;个人 Win 场景保留) |
| active/smoke-test.md | **冒烟测试（测试工作台第三形态）**：第三段页签 + 手动录入测试场景（验证目标+预期结果）+ 无门控三节点流水线；环境沿用现有配置、提示词三段固定内容内嵌为 skill/prompt；Phase 11 收敛为单份完整冒烟报告（Bug 表格），停止 Excel/独立缺陷/回归脚本 | Phase 1-11 已完成；打包态实测待用户发起 |
| active/regression-library.md | 测试工作台:回归用例库(用例设计后自动沉淀「回归测试」标签用例 + 项目级库查看/管理 + 跨任务一键重跑) | 设计完成,待实现(批 A-E) |
| active/regression-library-v2.md | 回归用例库 v2 一期：执行轮次实体（留痕/快照/中断态）+ 回归套件（静态+查询构建器+pinned）+ 发起弹窗重做（套件/env/预检估算）+ 报告按来源任务分组与 delta + 库检索；方案见 research/regression-library-v2-benchmark-proposal.md | 批 A-E/G/H 已完成；批 F（打包验收）待用户发起 |
| active/regression-library-v2-phase23.md | 回归用例库 v2 二/三期（按交互原型 6 屏 1:1）：`_lib` 治理元数据（评审态/rev/隔离）+ 跨轮矩阵读侧现算 + 复测轮 failed-only 与合并口径红线 + 轮次报告独立页 + AI 失败归因 + 对比矩阵 + 健康度治理与隔离护栏 | 批 I-P 已完成；打包验收 + 真实 AI 归因质量待验 |
| active/test-regression-gate-audit.md | 测试工作台:回归集标签 + 用例门控 + 操作审计 | 开发完成(合并 PR #8),待打包验收 mac+Win |
| active/regression-script-replay.md | 回归执行·脚本重放优先:有合格沉淀脚本的用例直接跑脚本(阶段A),AI 只执行剩余(阶段B),全覆盖零模型消耗;失败策略A+连败提示 | 开发完成(单测 12 条全过),待打包验收 |
| active/regression-assertion-evidence.md | 回归脚本·执行期断言取证（方案 A′）：执行智能体输出 `@@EVIDENCE` 结构化判定依据落进轨迹，作为生成期断言定位器的第一事实来源。**Phase 0 真机取样已推翻根因假设**（臆造率仅 4.7%、83% 断言不涉及 DOM；`structural` 断言实为用例 expected 写死 Tailwind 类的传导），Phase 1-5 暂缓，改投用例设计侧治理；取样见 research/regression-assertion-evidence-sampling.md | Phase 0 完成（结论：暂缓），Phase 1-5 ⏸ 待重启信号 |
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
| active/deid-gateway.md | **办公模式脱敏网关(deid-service)对接** — 输入区脱敏开关(会话级持久/默认关/仅办公)+ 发送前预览逐项确认 + 客户端按 normalizedText 偏移重建外发文本 + 渲染层占位符还原 + unknownPlaceholders 告警;决策 D1-D10(展示原文/外发脱敏复用 displayOverride、历史回灌重脱敏、fail-closed、mapping 会话级原子覆盖) | P1 已完成(单测 16 + 真实链路 13 项),P2 图片脱敏待做 |
| active/v0.48-post-release-issues.md | v0.48.0/0.48.1 发版后问题追查（已归档至 issue-tracker.md，保留原始记录） | 已归档 |
| active/security-audit-remediation.md | 安全审计修复方案：2 处无鉴权 RCE（Shell 注入）→ API 边界鉴权（middleware）→ 文件接口作用域 → Bridge 访问控制/凭证加密 → Electron CSP/sandbox → 依赖升级，共 7 Phase | Phase 1-7 待开始 |
| active/stream-idle-timeout-rework.md | 对话流空闲超时改造：从「距上次任何事件」改为「距上次实质内容」计时，根治慢首包 provider 误杀（B-019），保留真卡死兜底 | Phase 0/1/4 已完成（c7888dc/e9ddbc2），Phase 2-3 可选暂缓 |
| active/test-framework-integration.md | 测试框架集成（对话内嵌测试）：把 ai-lab-test-framework 做成第三种对话模式（代码/计划/测试），上半结构化面板(看板/流程/报告)+下半对话流；锁定作用域/模式/视图模型，替换 Phase-1 的 /test 独立路由 | Phase 0 进行中，Phase 1-8 待开始 |
| active/test-account-settings.md | 测试账号设置：设置内新增多系统测试账号面板（系统下拉 + local/SIT 标签 + 密码/token/获取登录态），导出到 AI_LabTest `environments.json` + `.auth/` storageState，Electron BrowserWindow 抓取登录态 | Phase 0 完成，Phase 1-6 待开始 |
| active/test-env-inline-config.md | 测试工作台·就地环境配置（test-account-settings 消费侧延伸）：项目=系统按归一化路径自动绑定、右侧抽屉复用共享 `TestSystemEditor` 就地编辑写同一库、消灭 3 处跳设置页往返；保留设置页双入口 | 阶段 1 完成（dev 态验证 55/55 单测 + CDP），打包态实测待验；阶段 2（环境胶囊+登录态可视）/3 待立项 |
| active/test-report-display-and-evidence.md | 测试报告就地展示 + 产物预览 + 缺陷结构化 + 执行端接口/录像采集：报告节点完成后工作台流程页展示「概览+产物列表+内嵌全文」，md 渲染/编辑、xlsx 表格、证据截图+录像（每用例一段、留 fail/partial）、缺陷报告结构化模板、`@@RESULT` 加 `api` 字段穿透 run.json | Phase 0-6 代码完成（typecheck/单测 + CDP mock 验证通过），录像/接口真跑 POC 待验证 |
| active/test-multitask-parallel-execution.md | 测试工作台多任务并行执行：看板多选 + 批量执行（强制无头）+ 并发数 1–5（本机设置）+ 客户端排队（running/waiting 槽位调度）+ 执行前登录态预检（storageState 存在性/过期）；编排去单例化（busyTaskId/abortRef/autoRunRef → 按任务集合） | Phase 0 完成，Phase 1-5 进行中 |
| active/uploads-storage-relocation.md | 上传附件（截图/@文件）存储从用户工作目录迁到统一缓存 `~/.codepilot/` + 存储治理（会话级联清理 + 容量/TTL）+ `/api/uploads` 锚定根校验 + 存量迁移；连带 `.codepilot-images` 同迁 | Phase 0 完成，Phase 1-6 待开始 |
| active/mcp-marketplace.md | MCP 市场（对照技能市场）：接官方 Registry + Glama 兜底，server.json→MCPServerConfig 确定性映射，一键安装（prefetch 预热 + 安全确认屏障 + 密钥钥匙串），复用 `~/.claude.json` 写入链路 | Phase 0 完成（POC），Phase 1 进行中，Phase 2-4 待开始 |
| active/skills-discovery-fix.md | 技能创建与发现修复（应用内创建 + 手动拖入）：列表显示项目级 + 项目徽章、Option C 项目斜杠命令客户端展开、codepilot-skill in-process MCP 让 agent 自主发现项目技能（绕开 settingSources，全服务商一致） | Phase 1/Option C/根治/Phase 3/测试 全部完成；Phase 4 原生对齐待立项 |
| active/btw-side-question.md | `/btw` 会话内临时问答浮层（对标 Claude Code CLI /btw）：无状态端点 native generateText（无工具/不取锁/不落库）+ 前端 `/btw <arg>` 解析 + BtwDialog 浮层 + 前端内存上下文快照（含 in-flight），主对话流式期间不打断 | Phase 0 完成，Phase 1-6 待开始 |
| active/image-model-managed-delivery-client.md | **文生图模型账号下发（客户端层）**：去编译期 key 注入，改登录后服务端下发百炼凭证+模型列表；以 `settings.bailian_image_config` 落地（不进 api_providers，结构上隔离对话下拉框），复刻 ASR 下发范式 + broker 写入嵌入式 Next | Phase 0-6 待开始 |
| active/image-model-managed-delivery-server.md | **文生图模型账号下发（服务端层）**：新增 `GET /api/v1/image/config(/encrypted/hash)`，apiKey 复用 configs 的 AES-256-GCM 加密口令；图片配置独立于 configs 列表避免泄漏进对话下拉框 | S1-S5 待开始 |
| active/ppt-alpha-mining-round5-priorities.md | **PPT 第五轮（Alpha Mining）**：模板文字色、保留媒体版式与媒体守恒门禁、封面副题、生成过程可视（骨架/流式草稿/大纲确认）、eyebrow 规范化、双语标题策略、术语锁、代码悬挂缩进 | A/B 完成，C 部分完成；F-P0-1 待用户授权 |
| active/ppt-outline-concision.md | **PPT 大纲精炼**：页数预算、按卡片计费、双语原文正文单语、收窄必须上页、先压缩后加页的修复顺序、小节分组两阶段规划、精炼指标 | 1–7 完成；待真实模型验证 |
| active/ppt-gamma-parity-round7-20261013.md | PPT 第七轮十点问题：两条代码线合并、大纲编译而非拒绝、主要语言主题、Gamma 式逐页生成、内容/标题/结束语、图片输入与自适应位置、修改面板与批量操作、真实模型验收 | 🧪 Round 7 集成与功能回归完成；真实模型验收及后续修复进行中 |

### Completed

| 文件 | 主题 | 完成日期 |
|------|------|----------|
| completed/ppt-input-progressive-editor-20261013.md | 七项图片输入、逐页预览、裁切/居中、聊天修改、内容/结束语和主要语言 topic；本地单元/领域/全站 smoke/CDP/生产构建通过 | 2026-10-13 |
| completed/ppt-offline-contract-template-validation.md | 无 API 数值/可见合同、修复约束/回滚、两模板组件档案、三共享布局与真实导出/CDP 回归 | 2026-10-09 |
| completed/ppt-hard-rule-remediation.md | 五项P0核心修复、实际PPTX/PDF实例合同、完整义务/媒体处置与32组专项回归；复杂视觉/长输入/真实模型边界 | 2026-10-08 |
| completed/ppt-input-scope-harness.md | PPT harness 输入框架与受限扩展、强制审查、候选及缓存门禁；本地回归完成，真实模型语义准确率待评测 | 2026-10-08 |
| completed/ppt-general-render-contract.md | 多输入共享文本/媒体契约、typed ingestion、深度密度与生成/发布门禁；PPTX/PDF/CDP/多格式回归 | 2026-10-08 |
| completed/ppt-copy-media-integrity-20261007.md | PPT写作/重复、完整来源媒体与对象、实际文件门禁、唯一信息packing、字体主题和局部完整性；29专项/2808单测/37smoke/两模式模拟文件通过，外部验收单列 | 2026-10-08 |
| completed/ppt-gamma-density-contract-audit-20261007.md | Gamma交接核对修复：最终模板fit、严格来源分片、slot/source写作与repair、共享可见QA和评审缓存；27项核对及本地回归通过 | 2026-10-07 |
| completed/ppt-next-round-audit-performance-content.md | PPT审计/模板IR与安全/媒体存储/来源结构/trace及Before–After；本地PPT通过，Chat/Search与生产验证限制保留 | 2026-10-03 |
| completed/ppt-prototype-policy-chat-parity.md | PPT 最新原型对齐：模板先于输入、异步估算、策略契约、稳定多轮聊天、局部动作、尺寸与滚动；本地门禁完成，真实模型/远端/安装包待环境验收 | 2026-10-03 |
| completed/ppt-prompt-depth-contracts.md | PPT 提示词与内容深度契约、完整来源上下文和有界 critic 重写；实现与模拟回归完成，真实 GPT A/B 待可用环境 | 2026-10-02 |
| completed/ppt-factor-zoo-visible-depth.md | Factor Zoo 双稿比较：章节容量、完整来源、模板可见正文/源表行门禁、媒体回收安全及22页模拟原生导出 | 2026-10-01 |
| completed/ppt-mutation-runtime-unification.md | PPT 类型化修改、版本与约束、逐页预览、暂停恢复、独立媒体 retry、结构提案与十项本地验收 | 2026-09-30 |
| completed/ppt-gamma-copy-media-repair.md | Gamma 20 页模板的页内/列表重复、媒体错配、原生组件省略与发布门禁修复，模拟 LLM 重跑及独立 PPTX 审计 | 2026-09-29 |
| completed/ppt-content-depth-sparse-typography.md | PPT 短输入预规划、按角色控制 point 深度、排版舒适度与本地回归 | 2026-09-28 |
| completed/ppt-visible-copy-integrity.md | PPT 模板可见内容完整性门禁、标题说明增量、原生导出文本核对和 27 页成品回归 | 2026-09-28 |
| completed/ppt-template-semantic-expansion.md | 原生 PPTX 模板的语义版式/容量目录、内容适配扩页调度、安全卡片重排与媒体变体、长文稿来源/重复约束及真实 Gamma 模板导出核验 | 2026-09-24 |
| completed/ppt-prototype-visual-parity.md | PPT 模块原型视觉对齐：局部深浅色与字体、工作区侧栏、模板四列、创建阶段、生成与编辑器布局；不改后端工作流 | 2026-09-24 |
| completed/ppt-long-deck-template-variants.md | 上传 PPTX 长文稿：版式目录与受控裁切变体、100 页内容感知调度、API/编辑器页数接通、快照去重压缩、DAG 恢复和原生导出压力测试 | 2026-09-23 |
| completed/ppt-template-variant-report-readiness.md | 复用模板页的原生布局/媒体变体与导出校验；职场报告 Brief、逐页文案规则、确定性内容评审和 20 页 Cowork 回放 | 2026-09-23 |
| completed/ppt-template-reuse-diversity.md | 上传 PPTX 扩页：确定性无相邻重复调度、最多双次复用、版式与图片相似度、页数可行性提示及真实模板原生导出回归 | 2026-09-23 |
| completed/ppt-uploaded-template-fidelity.md | 上传 PPTX 保真：原生对象与图片保留、shape ID 文本填槽、模板容量检查、预览与原文件导出校验 | 2026-09-22 |
| completed/ppt-template-preview-copy-depth.md | 模板预览与可见要点说明：逐页 PNG 伴随预览、标题/说明/标签槽位配对、最短长度与重复检查、真实模板回归 | 2026-09-23 |
| completed/ppt-native-paragraph-fit.md | 模板原生段落与文字适配：逐段 label/body、模板项目符号和字号、单行宽度约束、编辑兼容及 15 页真实模板回归 | 2026-09-23 |
| completed/ppt-semantic-planning-optimization.md | PPT 语义分块、Brief/Story/Slide 规划、逐页事实整理和内容 QA；维持现有 DAG、模型调用轮次、界面与导出架构 | 2026-09-22 |
| completed/ppt-visual-editor-hardening.md | PPT Visual Editor 完整性加固：真实预览路由、有界 mutation/AI schema、完整对象与页面编辑、共享 Render Tree、Command Journal、三语与响应式 | 2026-09-21 |
| completed/ppt-prototype-parity.md | PPT 模块严格按 `prototype.html` 校对工作区、创建、任务、模板、生成、详情、编辑器和版本更新的布局、按钮与流程，同时保留生产后端架构 | 2026-09-20 |
| completed/ppt-product-conformance.md | PPT 产品流程与交互补齐：保留生产后端能力，完成 Workspace、Task Center、创建/更新向导、真实渐进生成、模板治理、单一连续画布编辑器和三语交互 | 2026-09-20 |
| completed/ppt-structured-artifact.md | PPT Structured Artifact Runtime：稳定 IR、持久 Run/DAG/Event、SSE、共享 Render Tree、Command Journal、对象编辑器、增量发布与外部 PPTX 保守编辑 | 2026-09-20 |
| completed/skills-store-internal.md | **技能市场（内部）**：Skills 页第三 tab 接 codeagent-server Skills 商店 BFF（acb6240）；主进程 IPC 持 token、yauzl 安装事务（zip 三重守卫/原子落位/台账自愈/串行化）、错误码分支 UI、「我的技能」互通（顺修 installed 删除残留 bug）；假 JWKS+假 Hub 真实链路 26 断言全过 | 2026-07-28 |
| completed/cowork-remote-container.md | **Cowork 远程容器沙箱(R 系列,取代本地 VM)**:RD1-RD8 八决策(全平台统一远程/单公司服务器账号下发/凭证代理 sidecar/无状态 HMAC+禁内网放公网/粒度=归属隔离容器仍 per 会话);R0 POC→R1 控制面+CoworkBackend→R2 文件通道(helper 直读持久 volume)→R3 凭证代理(真 key 不进 agent 容器)→R4 多用户 authz/配额 TTL/出网禁内网→R5 打包版实测+部署包(install.sh+systemd 双单元+TLS 预留)+运维手册+账号下发客户端全链+Windows 平台 gate。剩:Win 真机实测/账号后端接口/裸金属迁移三件套(见文档头) | 2026-07-17 |
| completed/cowork-p3-security.md | **Cowork P3 安全强化**:凭证不进 VM(宿主代理注入一次性 token,NAT 网关方案)+ 每会话非特权用户(setuid 降权,会话间不可越权互读)+ 宿主侧安全审计;明确不做出网白名单(用户接受 agent 自由上网) | 2026-07-15 |
| completed/cowork-image-pipeline.md | **Cowork 镜像流水线**:沙箱环境零手动预置(3.1.15→3.1.17)— M1 cloud-init seed 首启自注入+SSH 全退役 → M2 应用内下载(中科大底镜+npmmirror SDK 平台子包,断点续传/校验/8GiB 稀疏扩容)→ M3 资源随包(vfkit/daemon/forwarder,signIgnore 保 entitlement)+目录正式化+版本追踪+daemon v3 偏斜自愈 → M4 裸机模拟验收 | 2026-07-15 |
| completed/cowork-office-mode.md | Cowork 办公模式:侧边栏「办公/研发」双栏切换(办公=沙箱会话平铺不绑项目文件夹);E1 执行层守卫(硬失败/native 拒绝/MCP 过滤)→ E2 创建期沙箱+暂存目录 → E3 双栏 → E4 办公 UI 面+实测反馈修复(E4.1-E4.3)→ E5 设置开关+零写入验收+双文档 | 2026-07-14 |
| completed/cowork-vm-mode.md | Cowork 沙箱 P1 macOS MVP 底层:文件通道(上传进 VM + 产物下载/落库)→ VM 生命周期管理器(server 侧单例)→ guest-daemon/vsock 通道 → 就绪状态机;P1-E 由 cowork-office-mode.md 承接 | 2026-07-14 |
| completed/test-project-system-display-name.md | 测试工作台项目展示名称：环境配置系统名优先，保留文件夹名与路径；脱敏摘要接口 + 路径归一化 + 空名称回退 + 三语与 UI 验证，不改变项目持久化身份 | 2026-07-30 |
| completed/script-gen-trace-anchors-incremental.md | 回归脚本生成质量与韧性:快照元素清单(治定位器臆造,具名元素臆造 class → 语义化 getByRole;边界:视觉结构类断言仍需被测端 data-testid)+ 逐条增量沉淀(执行流内 pass 即入队生成,断流不再全丢)+ 未执行守卫 + 打包产物完整性闸 | 2026-07-17 |
| completed/regression-script-generation.md | 测试报告成功后后台为本轮 pass+「回归测试」标签用例生成独立 Playwright 脚本；四节点不变，具备脱敏轨迹、结构化生成、安全校验、指纹幂等、锁恢复、源任务回写、报告区查看/重试/运行，并通过开发态与 macOS 打包态真实回放 | 2026-07-10 |
| completed/test-usage-stats.md | **测试模块使用统计**（P1）：test_stats_events 事件流水 + 纯函数聚合口径层（采纳率首轮基线 / 报告准确度+覆盖率 / 服务端逐用例计时 / 模型节点级归因 / 熔断排除 / 时间窗口计入门控）、10 类事件字典、四 scope API + 4 Sheet XLSX 导出、TestStatsView 看板（第 4 视图）+ 复核 UI + 节点用时/模型徽标。P2 匿名上报为独立后续里程碑 | 2026-07-09 |
| completed/marketplace-skill-translate.md | 技能市场「AI 翻译简介」：详情页一键翻译 README 到应用语言（非英语才显示），managed 第一个模型 + generateTextViaSdk 单轮（别名坑规避）、11 条规则系统提示词（含提示注入防线）、译文/原文可回切 + 模块级缓存、30K 截断 | 2026-07-03 |
| completed/document-preview.md | 应用内文档预览（PDF/DOCX/XLSX/PPTX）：复用 PreviewPanel 分发骨架 + serve 取 arrayBuffer + next/dynamic 懒加载四渲染器（react-pdf/SheetJS+DataTableViewer/docx-preview/aiden0z-pptx）、PDF 5 类离线资产管线（含 wasm+cmaps+iccs）、DOCX 三层强制 XSS vs PPTX 差异化安全、raw 路由中文名 RFC 5987 修复；老二进制 .doc/.ppt/.xls 不做 | 2026-06-30 |
| completed/credential-encryption.md | 凭证本地加密落盘：safeStorage 主密钥 + AES-256-GCM 列加密（双进程 env 过河）、anlcode 文件 + SQLite 敏感列 seal/hydrate、静默迁移 + fail-safe、image-generator 绕过修复 | 2026-06-03 |
| completed/gsd-bundle.md ⚠️已下线 | 内置打包 GSD（gsd-build/get-shit-done, MIT）：vendor + 转换脚本 + Electron 同步 + Settings UI + 普惠修复 frontmatter description | 2026-05-25 |
| completed/markdown-artifact-overhaul.md | Markdown 渲染/编辑 × Artifact 网页预览扩展（DiffSummary 卡片 + Sandpack TSX + 长图导出 + 文件树新建 .md + CodeMirror 编辑 + DataTable + 文件 I/O API） | 2026-04-21 |
| completed/hermes-inspired-runtime-upgrade.md | Hermes 借鉴的 Runtime 能力升级：6 核心模块 + 12 额外交付（并行安全、辅助模型、子目录 hint、session 搜索、Skill nudge UI、AskUserQuestion、压缩通知） | 2026-04-12 |
| completed/engineering-quality-assurance.md | 工程质量保障体系（Harness Engineering）— 验证闭环、AI 文档、CDP、执行计划 | 2026-03-04 |
