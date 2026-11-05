# Tech Debt Tracker / 技术债务追踪

已知技术债务清单。每项标注优先级、影响范围和初步解决思路。

**AI 须知：发现新的技术债务时添加到此文件；解决后标注完成日期。**

## PPT 跨模板/输入通用化 Phase 0–1 发现（2026-10-08）

计划见 [ppt-general-content-media-balance](active/ppt-general-content-media-balance.md)。

- **P0 大纲 prompt 体量**：09_factor_testing（46k 字符）× Process Improvement 的首个模型调用（outline）为 **405,700 字符**（`scripts/ppt-balance` dry run 实测），主要来自完整 inventory、INPUT_FRAMEWORK 与 source_objects 重复内嵌。真实模型可能超出上下文或成本过高；需在 Phase 3 改为按问题分区的来源包，并给出上限与 not_evaluated 语义。 **2026-10-09 部分缓解**：INPUT_FRAMEWORK 与 inventory 去重后，Factor Zoo 大纲 prompt 348,280 → 198,965 字符，09 为 225,155 字符；批次审查与 token 预算回执仍未实现。
- **P1 真实模型评测环境**：本机无 Docker、无本地 Claude CLI，`run --adapter routine|cli` 无法在此工作区执行；需在 Cowork 环境或提供 `PPT_EVAL_CLAUDE_BIN` 后跑 Phase 0 的真实矩阵。
- **P1 测试运行时**：`density / export-integrity / hard-rules` 自测需要 python-pptx + LibreOffice；系统 python3 下会因缺 `pptx`/`soffice` 失败（环境问题）。需设置 `PPT_TEST_PYTHON` 并把 `soffice` 加入 PATH。

## PPT hard-rule 后续验收（2026-10-08）

五项已复现漏洞的核心修复和本地回归已完成，见 [交接](../handover/ppt-hard-rule-remediation.md)。以下不得按当前 certificate passed 推定完成：

- **P0 视觉边界**：复杂 group/alpha/曲线 ink 遮挡、任意 diagram 拓扑替换、复杂 chart 视觉符号未全认证。基础 collision/实际PDF glyph/frame和简单mixed-sign column已落地；unknown媒体保留，不支持替换阻断；visualVerified维持false。后续需要真实 ink/遮挡及关系fixtures。
- **P1 长输入审查**：token-aware来源分区、父条件闭包和跨区结果合并未实现。当前完整原文不截断、超过1MiB review prompt显式容量失败；更小模型context需not_evaluated，不能返回空结果当通过。
- **P1 外部验收**：live所选LLM的mandatory recall/框架/近义重复、部署Cowork字体/office运行环境、Windows/Microsoft PowerPoint未验收。缺真实转换环境时阻断，保留上次发布，不能降级payload-only证书。

## PPT 重复内容与媒体/来源结构丢失（2026-10-07 审计；2026-10-08 本地修复）

- **P0-A：跨角色重复与修复回流。** Mood Board 模拟成品同页精确重复额外字符约32.30%。当前 `materializeCopy` 删除重复 takeaway 后，`repairProject` 可从 factSynthesis 再次插入相同句；独立复现后 `duplicateFindings` 仍为空。需统一 writer/repair/editor 的可见内容规范化与去重，增加幂等检查。
- **P0-B：来源结构/媒体没有贯穿到最终文件的保留义务。** 当前成品21页、0图片/0原生表格；模拟脚本排除公式、mapped 分支不分配结构、模板媒体未复制。产品已有 sourceArtifacts，不能归因为 mapped 必然只支持文字。需来源/模板资产分类、对象→计划→IR→实际导出的账本与完整性检查。
- **P0-C：质量及验证基线不可靠。** 结构保留代理指标为0、76条警告仍可 editorialReady；模拟 reviewer 固定无问题，且脚本切换模式、将推荐页数改为 explicit、导出后改色。必保留对象缺失应阻断正常交付；模拟仅替换LLM并如实标识未评估能力，导出后重新验证文件。
- 以上为 10-07 冻结的缺陷基线。**2026-10-08 本地修复完成**：canonical 写作/精确重复/claim ownership、对象和资产账本、实际文件 gate、原生数学/表/流程、主题字体、完整预算 packing、legacy 保存和局部候选/评审失效。29 组 PPT 专项、2,808 全仓单测、37 smoke 场景通过。两模式忠实模拟必保留结构 31/31、精确重复额外字符 0，含真实 PPTX/PDF 及逐页渲染。见 [实施交接](../handover/ppt-copy-media-integrity.md)。
- 剩余外部验收：真实所选 LLM 的近义重复/叙事压缩质量、部署 Cowork 镜像重建（本机 daemon 未运行）、Windows/桌面 PowerPoint 字体和编辑。模拟的 46/48 页保留大量原文，不能当作 Gamma 密度胜出或最终推荐页数。扫描/OCR、任意 PDF 矢量图语义重建、所有 OfficeMath 语法仍有明确支持边界；必要对象不能解析时硬诊断，不静默丢弃。

## PPT 下一轮审计剩余验收（2026-10-03）

- [本轮实现与迁移](../research/ppt_changes.md)：25组PPT自检、PPT UI及本机原生导出已通过；真实模型、部署Cowork、Gamma同任务冷/温实测、Windows/PowerPoint字体仍未验收。
- 全应用E2E 52通过/112跳过/19失败（Chat/Search），未做独立Before控制实验；保留失败日志，不能归为PPT已通过的覆盖。
- 结构覆盖已有源表/关系/流程/尾部检查，但词面匹配不证明语义完整；22页样例仍有29条确定性警告、未完整公式与模板装饰融合问题。真实模型critic与完整OMML需后续。
- media-v2需完整状态备份；实际GC必须停写，grace不提供多worker锁。managed登记跨实例分发/事务、在线downgrade与浏览器first-paint时延仍待治理。

## PPT 可见事实深度待治理（2026-10-01）

- 2026-10-02 已解决提示词层缺口：PPT 专用角色、文件名深度误判、具体 keyPoints、完整来源对象、单份可见文案及有界 critic 重写；详见 [提示词深度契约](../handover/ppt-prompt-depth-contracts.md)。用户指定 GPT 但本地不可调用，本轮按用户要求模拟；真实模型质量/成本 A/B 仍待可用环境，不能由模拟结果替代。

- 2026-10-08：来源对象→可见结构→实际文件账本、全表行列/公式/流程/清单/总结门禁已实施。真实模型的语义完整性和标题正文错配判断仍需同源 A/B；见 [完整性修复](../handover/ppt-copy-media-integrity.md) 与历史 [Factor Zoo 对照](../research/ppt-factor-zoo-content-depth-comparison.md)。
- 中优先级：原生模板原页顺序保真与教学容量的协商仍有限，复制页可以择优，原页尚不能自由调换最合适组件；需在planning阶段显式分布/取舍，不能靠填短句保版式。
- 中优先级：源码引用内部矛盾尚无统一 source-integrity 诊断；来源的数值/假设冲突应与生成错误区分，并保留用户认可修正的审计。

## PPT 架构接入后待治理（2026-09-30）

- 2026-09-30 已解决：历史自检 M3/M4/semantic/template-scheduler 的 fixture 按 planning v5、来源媒体绑定、安全装饰替换、当前模型审查和显式发布协议修订；18 组 PPT 自检通过，未降低生产门禁。
- 项目队列与写前恢复仅保证单进程；若部署多 worker，迁移为跨进程锁/事务库。当前 publish 的渲染 I/O 会占住同项目队列，后续可做带版本校验的队列外导出。
- Proposal/Intent/发布产物的过期归档与清理尚未实现；已明确数量上限与错误。未提交输入当前仅 sessionStorage，跨设备草稿另行设计。
- 真实模型、远端 Cowork 导出、Electron 打包态和 Windows 需环境验收；原生组/未知媒体预览仍受现有 renderer 能力限制。
- 页级依赖/attempt/checkpoint 已落地，仍是专用有界 coordinator；通用 DAG、跨主机 lease/事务、持久容量队列与 CRDT 协作未实现。PID 文件锁不解决多个 API 进程同时写 JSON 的问题。
- 生成中结构修改在生成 barrier 后形成确认提案；asset/data 限完成后对象编辑，不支持所有类型实时改变未完成的大纲。文本模型保持用户选择；Research、自动模型路由和 VLM 质量审查未启用。
- 数据数值/单位来源检查和文本 critic 不能证明完整事实正确；高密度组件/长表格整稿审查的上下文预算仍需专门治理。Imported PPTX 保守发布不具备同等全文语义 critic。
- 首次生成发布与后续显式 publish 共用版本/渲染/评审协议，但仍有两个 coordinator 调用入口。AssetTask 结果并发可能留下不可应用的孤立 proposal，需结合 TTL 清理及跨进程幂等事务治理。

## 活跃项

| # | 描述 | 优先级 | 影响范围 | 发现日期 |
|---|------|--------|----------|----------|
| 1 | ESLint 存量 4 个 error（`MessageItem.tsx` hooks 条件调用、`ChatView` impure render、`GalleryDetail` setState in effect） | 中 | CI lint 步骤需 `continue-on-error` | 2026-03-04 |
| 2 | `conversation-registry` / `permission-registry` 运行态依赖内存 Map，重启后丢失 | 中 | 长时间运行的会话、Bridge 模式 | 2026-02-26 |
| 3 | 消息 fallback 上下文固定最近 50 条，无动态 token 预算截断 | 低 | 长会话上下文质量 | 2026-02-26 |
| 4 | `context-storage-migration` Phase 0 剩余：`projects` 表未建、`canUpdateSdkCwd` 未实现 | 低 | 多项目隔离 | 2026-03-04 |
| 5 | Bridge 的 `/mode plan` 在会话权限档位为 `full_access` 时仍会被 `bypassPermissions` 覆盖，导致 Plan 语义失效；需让 bridge 与桌面聊天一致，显式以 Plan 优先于 full_access | 中 | Bridge 远程会话的权限/安全语义 | 2026-03-25 |
| 6 | Electron 主进程行为（外链拦截、窗口管理等）无自动化测试覆盖。现有 Playwright 测试只覆盖 Next.js web 层，需要搭建 `@playwright/test` + `_electron.launch()` 的 Electron E2E 测试框架 | 低 | Electron 主进程回归风险 | 2026-03-30 |
| 8 | `@file`/`@directory` mention 无法识别带空格的路径（如 `docs/Product Spec.md`、`My Folder`）。插入文本是裸 `@${path}`，但 `parseMentionRefs` 用 `/@([^\s@]+)/` 分词，遇到空格就截断；`mentionNodeTypes[path]` 查不到，chip 消失、结构化 mention 不发送、目录 summary / 文件附件路径全部跳过。影响 PR #508 picker 插入 和 07eb5a9 目录拖拽两条链路。修复需要同时改 插入 token（转义或引号）+ `parseMentionRefs` 解析 + Backspace 整块删除逻辑；建议单开小 PR 处理并补测试 | 中 | 任何含空格的路径都无法走结构化 mention 流程；仅纯文本可达 LLM | 2026-04-18 |
| 9 | `src/__tests__/e2e/layout.spec.ts` 的 Sidebar Collapse/Expand、Theme Switch、Navigation Menu Highlight、Header、Mobile Responsive、Three-Column Layout (V2) 六个 describe 块都在测已经被重写的旧版布局（带 sr-only "Toggle sidebar" / "Toggle theme" 的按钮、header `<h1>` 标题、`navLink(Chat/Plugins/MCP Servers/Settings)`、右侧面板等）。当前 UI 改用 UnifiedTopBar + NavRail + ChatListPanel，且 nav 项是 Skills/MCP/CLI 工具/素材库/远程桥接。已在 spec 里 `test.describe.skip` 占位，避免 E2E gate 长期红；需要按新 layout 重写断言 | 中 | E2E 布局覆盖缺失；新 UI 回归只能靠手动 / CDP 抽查 | 2026-04-19 |
| 10 | `/api/search` 的 file branch 目前是 N-recent-unique-workspaces 的递归 fs.readdir 扫描——全局搜索每次键入都会触发 sequential workspace 扫描。当前临时方案：按 resolved path 去重后 all-mode 限 5 个最近 workspace，`file:` 限 15 个；超出范围无法通过不加前缀的搜索找到。真正的解是**文件索引**：在 session 创建 / 文件变更时维护持久化 trie 或 SQLite FTS 表，搜索时从索引读而不是每次扫磁盘。索引命中率高后可以放宽上限回到"全量扫描" | 中 | 搜索结果范围受限：跨 10+ 项目找文件必须用 `file:` 前缀；不加前缀默认只在最近 5 workspace 里找 | 2026-04-19 |
| 11 | `TodoWrite` 工具在 SDK 0.2.136 起被标记为 deprecated，未来 0.3.x 大版本会切换到 `TaskCreate` / `TaskGet` / `TaskUpdate` / `TaskList` 体系。当前项目在 db schema、stream-session-manager、useSSEStream、TaskListPanel、ChatView 等 11 个文件里都按 `TodoWrite` 事件解析。0.2.x 期间不会立刻坏，但需要在升 0.3.x 前完成迁移：在 sdk-runtime / message-normalizer / db schema 中同时识别 Task*/TodoWrite 事件，渐进切换 | 中 | 未来 SDK 升 0.3.x 时所有 TODO/任务面板会失效 | 2026-05-19 |
| 12 | v0.55 切换到内置 Claude Code 后，`InstallWizard`、`ConnectionStatus`（install/upgrade 子流程）、`CliSettingsSection`（installType 显示、其他装机冲突警告）、`useClaudeStatus` 仍保留了「未连接 / 引导安装」分支，但运行时永远走不到（API 永远返回 `connected: true`）。`src/lib/platform.ts` 也仍导出 `findClaudeBinary`、`findAllClaudeBinaries`、`classifyClaudePath`、`getClaudeCandidatePaths`、`getUpgradeCommand`、`isWingetInstall` 一组本地 CLI 探测函数，但只剩文档 / debug 入口在引用。建议下一次清理 PR 时统一删除，可净减约 200 行 | 低 | 死代码膨胀；冷启动加载多 ~5KB | 2026-05-19 |
| 13 | 上传附件（截图/@文件）落盘到 `session.working_directory/.codepilot-uploads`，污染用户工程、被用户工程 git 跟踪，且无任何清理（无 TTL/容量上限/会话级联，只增不减）。AI 生成图 `.codepilot-images` 同病。`/api/uploads` 安全校验用子串 `includes` 而非锚定根。**已有执行计划** [active/uploads-storage-relocation.md](./active/uploads-storage-relocation.md)：迁到统一缓存 `~/.codepilot/` + 存储治理 + 安全收口 + 存量迁移。另含未来优化：@文件引用工作区已有文件却仍落第二份副本（去重需配合「清理不删原件」隔离） | 中 | 用户工程目录被污染 + git 跟踪异常；缓存无限膨胀 | 2026-06-23 |
| 14 | 技能调用非原生语义（[skills-discovery-fix](./active/skills-discovery-fix.md) 已知局限）：项目级斜杠命令走客户端展开、项目技能走 codepilot-skill MCP 返回正文，均非 Claude Code 原生 slash command / Agent Skill 的系统级执行，不支持 `$1..$9`/frontmatter allowed-tools/`` !`bash` ``/`@file`。原生对齐 = Phase 4：按官方文档把 Agent Skills(`.claude/skills`) 与 Slash Commands(`.claude/commands`) 拆成两条链路 + 用 SDK `skills` 选项加载 + `system:init` 下发真实 inventory 作为 UI 真源。参考 [research/skills-agent-sdk-review-2026-03-10.md](../research/skills-agent-sdk-review-2026-03-10.md) | 中 | 用户手写带原生模板语法的命令会降级（不报错但 token 不展开）；与 Claude Code 本体有差异 | 2026-06-26 |
| 15 | 回归用例库保留任务名「回归用例库」与用户真实同名任务无冲突校验（新建任务/导入入口不拦截），撞名会被轮次聚合覆盖 cases.json。二/三期（[regression-library-v2-phase23](./active/regression-library-v2-phase23.md)）**未实现**，仍待做（前后端双拦截） | 低 | 撞名任务的用例文件被聚合覆盖等未定义行为 | 2026-07-10 |
| 16 | 回归轮次产物（report/回归用例库/{roundId}/ 报告+快照+证据）随轮次只增不减，无保留 N 轮/归档策略；已支持单轮手动删除作逃生通道。计划三期与 stats 环形口径（近 20 轮）对齐 | 低 | 长期使用后项目目录磁盘膨胀 | 2026-07-10 |
| 17 | 回归轮次/套件 JSON 的并发写保护为「seq 写前比对 + 冲突重放一次」（同进程内可靠）；跨进程（主目录+worktree 双 dev server 写同一项目）极端时序仍可能丢更新，长期方案需文件锁（lockfile）或 OS advisory lock | 低 | 双 dev server 同时操作同一项目库的极端场景 | 2026-07-10 |
| 18 | 回归用例「AI 就地复核」（同版本连跑 3 次判定真 flaky）未实现：健康度页与用例详情抽屉的入口已置灰标注「即将推出」。当前 flaky 队列只是**候选**——跨轮翻转 ≠ flaky（版本一直在变），无同版本复跑就下不了定论 | 中 | 用户看到 flaky 徽标但无法确证；隔离决策缺依据 | 2026-07-10 |
| 19 | 回归套件「自然语言转查询条件」（如「只跑上轮挂过的预约相关 P0」→ 过滤条件）未实现，原型有、本轮置灰 | 低 | 套件构建器仍需手工点选条件 | 2026-07-10 |
| 20 | 跨轮矩阵行身份 = `(来源任务, originalId)`。AI 重新生成用例改了 `id` → 该用例的跨轮历史断开、健康度重新计数，且**无任何提示**。需在重生成链路做身份继承或至少告警 | 中 | 历史断裂静默发生，flaky/连败判定被重置 | 2026-07-10 |
| 21 | `npm run test:smoke` 在 worktree 内跑不了：playwright.config 的 webServer 用 `npm run dev`（Next 16 默认 Turbopack），而 worktree 的 `node_modules` 是指向主仓的符号链接，Turbopack 直接拒绝（"Symlink points out of the filesystem root"）。绕过办法是手动 `PORT=3000 next dev --webpack` 后复用（`reuseExistingServer`）。长期应让 webServer 命令可配置或改用 `--webpack` | 低 | worktree 内 UI 批次无法按纪律跑 smoke，需手工绕过 | 2026-07-10 |
| 22 | 回归用例库批量移除走「逐条 DELETE」循环（`/api/test/library` 的 DELETE 是单条/单任务口径）。条数量级为个位数~百时可接受，选中上千条会产生同等数量的请求与落盘 | 低 | 大批量移除慢；每条都触发一次原子写 | 2026-07-10 |
| 24 | 执行进展面板的「收口中 / 疑似卡住」是**推断态**：最后一条 @@RESULT 到 run_json 之间服务端在做证据归集与归约，不发任何 SSE 帧。面板靠「多久没收到帧」推断，无心跳帧兜底。服务端若真卡死，面板只能靠 90s 超时提示，无法区分「归约慢」与「进程挂了」 | 低 | 收口阶段的可观测性依赖启发式 | 2026-07-10 |
| 25 | 执行流事件在内存中无界增长：大回归套件（十几条用例 × 几百条工具调用）的 `libraryLive.cases[].events` 会持续膨胀。按用例分段 + 工具轨迹折叠缓解了渲染压力，但数组本身未封顶/虚拟化 | 低 | 超大套件长跑后滚动可能卡顿 | 2026-07-10 |
| 31 | `claude-client.ts` 的 catch 块**不区分「本轮已成功交付」**：只要迭代器最终抛错，就一律分类 + 发 error SSE + 清 `sdk_session_id`。但 print 模式收尾阶段的失败（后台任务被强杀 → exit 1）发生在 result 之后，此时 SDK 报的是 `process exited with code N` 而非 `returned an error result`（按 SDK `lastErrorResultText` 逻辑，这只在 result 是 `is_error:false` 时可能），即答案已完整交付，报错纯属误报；更糟的是清掉 `sdk_session_id` 会把下一轮推上「历史当纯文本重发」路径，而那条路径正是上游内容策略拦截（CONTENT_BLOCKED）反复复发的入口。修法：本轮收到过 `is_error:false` 的 result 后，把后续进程退出错误降级为只记日志（不发 error SSE、不清 session）。已通过 `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=60000` 把等待窗口从 10 分钟压到 1 分钟，但**误报本身仍在**（sweep 照样 exit 1，只是提前了）。现场证据与推导见 [handover/provider-error-doctor.md](../handover/provider-error-doctor.md)「print 模式后台任务收尾上限」 | 中 | 成功回合被显示成失败并弹「检查 API Key / Base URL」；连带清 session 触发内容拦截复发 | 2026-08-17 |
| 30 | Cowork 凭证探测无观测信号:坏 token 打到 cowork-proxy 只回 401 且故意不打日志(防敏感头落盘),宿主审计无 cred_reject 类事件(audit.mjs 注释曾预留未实现,R5-4 复查发现该注释误导过运维文档,已修正注释与文档)。修复思路:cred-proxy.py 把拒绝**计数**(不含头/路径)打 stdout 进 docker logs,或 server 周期 docker exec 收集计数写宿主审计 | 低 | 无法监控凭证暴力探测;审计链有盲区 | 2026-07-17 |
| 32 | Gamma 兼容 API 没有设置 key 的界面，只能用环境变量 `PPT_GAMMA_API_KEY` 或直接写 setting `ppt_gamma_api_key`（见 docs/handover/ppt-gamma-compat.md） | 低 | 外部脚本/Agent 调用 PPT | 2026-11-05 |
| 33 | Gamma 兼容 API 的真实引擎端到端未跑（本地 dev 无登录体系）；需在打包登录版上用 Classic/Agent 各跑一次到下载 | 中 | `/api/ppt/gamma/v1.0` | 2026-11-05 |
| 34 | 应用内粘贴路径把无法嵌入的远程图片引用视为必需来源并阻断生成；API 路径已按 Gamma 语义跳过，应用内可加“跳过无法读取的图片”选项 | 低 | PPT 粘贴/提示词输入 | 2026-11-05 |

## 已解决

| # | 描述 | 解决日期 | 解决方式 |
|---|------|----------|----------|
| 23 | 回归执行无法中途停止：`runLibrary`(InlineTestingPanel.tsx) 的两处 fetch 没有 AbortController（功能测试的 `runStep` 有），执行进展面板只读进度、不能取消；长跑的大套件只能等它跑完 | 2026-07-22 | `runLibrary` 接入 AbortController + 执行面板头「停止」按钮（confirm 二次确认）。服务端零改动（`/api/test/run` 早已接 `req.signal`，与功能测试停止同机制）。收口语义：执行中途停止 → 轮次 aborted（与断网中断一致，判定不落盘）；报告步停止 → 轮次收 done（run.json 已落盘且权威，保留进复测基准/上次结果链路）。与 #29 三层收口叠加后，停止的收口不再依赖前端存活：执行流 cancel → keeper 服务端收 aborted，前端 settle PATCH 降级为幂等兜底（`ifRunning` 防晚到降级）。审计复用 `stop` 动作落 回归用例库.jsonl。CDP 三场景实测（执行停/报告停/取消确认继续跑）；文档见 handover/regression-library.md |
| 29 | 回归轮次卡「执行中」：轮次收口的唯一写入方是**前端** `settle()` PATCH——执行中途页面刷新/关窗/dev server 重启，settle 永远不会到达，轮次孤儿化为 running，要顶着「执行中」挂到 2h 惰性兜底才转中断。真机 mealAllowance / RND-20260722-1450（14 条用例）：产物目录只有 cases.snapshot.json，执行流从未收口，19 分钟后新轮已正常跑完，轮次页仍显示旧轮「执行中」。#23（无法停止）诱导用户拿刷新当停止键，放大此缺陷 | 2026-07-22 | 三层收口（rounds.ts 模块头）：①**服务端收口** `createRoundKeeper`——wrapExecutionStream 的 done/cancel/error 三路径直接 finishRound（done 摘要取归约内存值），run 路由闸门 503/兜底 500 两处早退同样收口；②**心跳判活**——keeper 定时器每 30s touch `{roundDir}/.alive`（必须定时器驱动，SDK 长工具调用静默数分钟、随帧写会误判死亡），rounds GET 先 `reapOrphanRounds`：心跳陈旧(>90s)/缺失且过启动宽限(120s) → **回写** aborted，存量孤儿首次打开轮次页自愈；③2h 惰性视图归一保留为最后兜底。配套 `finishRound.ifRunning` 终态保护（晚到的 aborted 不降级 done）。单测 +14；真机数据副本回放 RND-20260722-1450 running→aborted、其余 15 轮不动。详见 [handover/regression-library.md](../handover/regression-library.md) |
| 28 | 模型把用例 id 里的**弯引号抄成 ASCII 直引号**（`‘码’`→`'码'`），`reduce` 的 `caseIds` 对齐是精确字符串比对 → 认不出 → 真的 pass 结果按「cases 之外的多余条目」丢弃、该用例补成 `blocked`+`notExecuted`。真机 `forum-xc-sit / 20260722测试用例`：执行总结明写 `pass=1`、轨迹与截图俱全，报告却出「⛔ 回归集未全过（0/1），存在阻塞级失败，不可发版」。与 #20 同症状不同根因（那次是标记行被加粗） | 2026-07-22 | 新增 `lib/test/case-id.ts`：`canonicalCaseKey`（NFKC → 印刷体引号/破折号归一 → 去不可见字符与空白 → 小写）+ `createCaseIdResolver` 把模型回写的 id 认回 cases.json 权威写法。**精确匹配优先**（抄对的行为不变）、**歧义不猜**（两条 id 撞键则该键作废，宁可退回「未执行」也不张冠李戴）、**认不出原样返回**（不做塞进多余结果的后门）；刻意不归一 CJK `「」『』` —— 中文标题里是结构符号。接入四处同源 join：`reduce.ts` 对齐（并把 `tests[].id` 改写成权威写法，下游 suiteIds/verificationById/taskOf 自动对上）、`exec-stream.ts` 的耗时表 / 落盘轨迹 caseId / 增量脚本喂料。靠 prompt 修不掉（第 8 条早已要求 id 完全一致），判定正确性不能押在模型抄写保真度上。单测 21 条 + 真机数据重放（`{pass:0,blocked:1}`→`{pass:1,blocked:0}`）；详见 [handover/regression-library.md](../handover/regression-library.md) |
| 26 | 静态校验器对 **API 接口测试脚本**误报「未使用语义化定位器」→ 恒被压成 `needs_review`，稀释真正需要人工复核的信号（真机 8 条 API 用例常年待复核） | 2026-07-21 | 新增导出谓词 `touchesPage`（判据是**有没有实际 `page.` 调用**，而非 fixture 解构 —— `{ page, request }` 混合型含真实 UI 操作，必须照常检查），该警告仅对操作页面的脚本生效。另三条定位器警告（xpath/nth/waitForTimeout）是「用了不好的东西」才告警，API 脚本本就不会触发，无需改。单测 4 条覆盖纯 API/纯 UI/混合型/判据本身；真实脚本回放 15 条全部无假告警 |
| 7 | `project-mcp-injection.test.ts` 的 "resolves ${...} env placeholders" 被 `process.env.CI ? it.skip : it` 跳过 | 2026-07-09 | 原条目归因（tsx 在 linux 与 macOS 上 module identity 去重不一致）不成立：`db.ts` 在 tsx 下本就会被 CJS 与 ESM 两套注册表各求值一次，与平台、与 `@/` 别名均无关。真正的根因是 `db.ts` 把 `dataDir` / `DB_PATH` 写成模块顶层 `const`，于是两个实例各自钉死一个 `CLAUDE_GUI_DATA_DIR` 快照，测试侧 `setSetting` 与 prod 侧 `getSetting` 落在不同的 SQLite 文件上。改为惰性函数求值后两个实例指向同一文件，守卫已移除，该用例在 `CI=true` 下正常执行 |
| 13(旧,编号曾与上传条目重复) | 测试工作台「执行」步在打包版跑不起来（@playwright/mcp 不在 asarUnpack + Chromium 未随包） | 2026-07-09 确认 | `scripts/bundle-chromium.mjs`（electron:pack* 链内）用 @playwright/mcp 自带 revision 装 chromium-headless-shell → electron-builder extraResources 复制进包内 `resources/ms-playwright`，运行时经 `AILAB_RESOURCES_PATH` 定位 `--executable-path` 启动（见 electron-builder.yml:127-133、prompts.ts buildPlaywrightMcp）。回归用例库 v2 打包验收时一并复核真跑 |
| 18(新增,与上表 18 不同类) | `GET /api/test/media` 与 `POST /api/test/defect` 不接受 `roundId` —— v2 一期把产物迁进 `report/{task}/{roundId}/`、证据迁进 `_evidence/{task}-{env}-{roundId}` 之后，轮次维度的证据**根本取不到**，缺陷单也会读错（平铺的）run.json | 2026-07-10 | 两处均补 `roundId` 参数 + `isUnsafeSegment` 段安全校验（穿越返回 400，已验证）；缺省行为不变，普通任务零影响 |
| 19(新增) | `writeLibrary` 无 `seq` 写入序号，`updatedAt` 毫秒粒度下同一毫秒的两次写入无法区分 → 依赖它做失效判断的读侧缓存会漏更新 | 2026-07-10 | 补 `seq`（与 `rounds.ts`/`suites.ts` 同款），`case-history` 缓存改用 `seq` 作变更令牌；单测捕获并钉死 |
| 20(新增) | AI 输出的机器标记行解析脆弱：`harvestResults` / `harvestRecommend` / `harvestVerdicts` / `exec-timing` 以及前端 `processText` 全用「indexOf + slice 到行尾 + JSON.parse」。模型把判定行包成 `**@@RESULT {…}**` → 整行解析失败并被 catch 静默丢弃 → 整轮回归被误报为 0/3 全阻塞（模型判的是 2 通过 1 失败）。同一份文本里 script-trace 用宽容正则，故 trace 完整、结果为空，极难排查 | 2026-07-10 | 新增 `lib/test/markers.ts` 作唯一实现（大括号配对 + 字符串/转义感知，容忍 markdown 装饰；解析失败计入 `malformed` 不再静默）。五处解析全部接入；新增 `lib/test/exec-live.ts` 让客户端与服务端同口径。prompt 加「标记行必须裸写」。以线上真实输出作夹具 +44 单测 |
| 21(新增) | 回归轮次的自动化脚本生成**从来没成功过**：`script-job-manager.currentInputs` 用 `artifactPaths(task, env)` 读平铺路径的 run.json，而 v2 起回归产物落 `report/{task}/{roundId}/` → ENOENT，被软失败咽掉（审计里只留一行 `generate-scripts 失败`） | 2026-07-10 | `ScriptJobRequest` 加 `roundId`，`exec-stream` 透传。与 #18/#19(已解决区) 的 media/defect 同源：v2 一期迁移产物路径时漏改的三个调用方，全都用 try/catch 或软失败把错误咽了下去 |


## Gamma同源成品的剩余编辑质量差距（2026-10-15）

见[同源评审第6.10/6.13节](../research/ppt-gamma-ai-same-input-review-20261014.md)。真实全局规划和来源选择修复后为18页；不能把发布门禁通过当作达到参考10页的编辑质量。

- **P1 物理分片后合并及主题顺序**：第8页系统架构与第9页单句原则仍可共担一个理解任务；参考目录在第3页过早。需要在确认前再次联合容量与语义评估，保持原始来源、实际字号、推断条件和显式页数；手动保护的deck不静默重排。
- **P1 关系表达**：层级、DAG仍展平为ASCII/文字，模板装饰图与机制页不匹配。需以已验证关系生成可编辑节点/边并检查拓扑，不能凭布局猜边。
- **P1 原生数学与实际应用验证**：本次18页原生PPTX OMML=0，公式仍线性文本；Microsoft PowerPoint原生应用未实测。需单独验证数学结构、编辑性和目标应用表现，不能借其他revision的数学对象数量宣称完成。


### PPT审查错误的安全诊断链（2026-10-15补充）

真实revision104出现ppt_transport，当前记录没有进一步HTTP细节。desktop worker已有白名单diagnostic分类，但model-jobs complete主要保留code/usage；需把经过白名单/脱敏的HTTP状态、SDK错误类与失败阶段贯穿队列、任务记录和用户提示，继续禁止保存provider原始请求/headers、密钥或任意错误body。不得把未知transport写成确定的认证/限流错误。本轮保留真实失败并有界重试，没有伪造原因。

### PPT 卡片稿简化后的遗留（2026-10-23）

2026-10-24：以下 35 项（T1–T35）已按 Fable 逐项定案全部处理，见[执行计划](completed/ppt-option-d-techdebt-20261024.md)。

- ✅ 生成阶段的模型整稿审查、批判重写循环（`criticRewriteTargets`、`rereviewOrKeep` 等）只剩旧流程项目重试时可达；P3b 连同只测它们的 selftest 一起删除。
- ✅ `ppt-planning-source-types`、`ppt-outline-capacity-repair`、`ppt-outline-selection-repair`、`ppt-source-graph-audit` 以及 outline-first / protocol / content-selection 中的旧导出已无生产调用，P3b 清理。
- ✅ 执行策略中的 `planningFallback`、`vision_reader` 角色已无调用方（来源图片视觉描述随 `ppt-source-vision` 删除）；需决定是否在卡片稿里恢复图片描述。
- ✅ 章节卡超过 8 张卡时只列前 8 个主题，后面的不显示（导航截断）。
- ✅ v2 overview 下小表格按设计画成卡片网格（`ppt-presentation-policy.mjs`）；作者若要原表需在编辑器切换。
- ✅ 内置模板（非原生）上的卡片稿：比一页还高的来源对象（如约 15 英寸的代码块）在写手路径触发 `source_artifact_capacity`，F2 的“代码放置”回退只覆盖原生模板，整次生成失败（`selftest-ppt-gamma-http` 的剩余失败即此；基线也因超大对象失败）。需要把超高对象按测量拆到续页（splitCardPage 的做法）或在内置模板上也提供代码放置回退。
- ✅ `src/__tests__/e2e/ppt-template-first-live.spec.ts` 已跳过：它走旧的阅读估页流程，配套的模拟模型只会回答旧大纲提示词。卡片稿的线上验收改用 `scripts/ppt/option-d-live.mjs`；其中编辑器部分（局部 AI 候选、版本恢复、发布导出）需要迁到卡片稿上重新启用。
- ✅ 版本更新（`PptM3`）仍是自己的三步界面（读取 → 模板与页数 → 大纲），只是改用 `outline` 规划命令；还没有换成卡片稿的设置表单和卡片大纲（`PptCardOutline`）。
- ✅ `source_artifact_capacity` 的诊断在只有“按阅读顺序排列”可行时，仍报告双栏候选的横向溢出（Fable 指出的误导性提示，未改）；卡片稿的对象页现已先测量再排版，此提示很少出现。
- ✅ `ppt-experience-quality` 的“folder retry”冒烟用例：项目列表被挂起时，文件夹错误提示约 9 秒后才出现，超过 5 秒断言；与卡片稿改动无关（相关代码未改），原因待查。
- ✅ 双语卡片稿中源文只有一种语言的术语靠提示词要求用领域标准译法（如 universe → 股票池），尚无对照源文汉字的术语核对（Fable 决定延后）。
- ✅ 原生模板不同页面之间标题基线高度不一致（alpha-r9 第 2 页与第 4 页标题位置跳动），属模板几何，未做统一。
- ✅ 卡片稿对象页不复用模板的原生卡片外框（只留面板、不留图标的卡片族复用），目前直接用整块内容区（Fable 决定延后）。
- ✅ 合并主题的标题仍可能是“A · B”拼接（fz p18 “Why Factors Earn Premia · Factor Zoo”）。
- ✅ 章节页条目超过 6 条时双语行很长（fz p6/p15 有 14–16 行，约 11 磅），可改为带编号的双语议程、超过 6 条分两栏（Fable r16 L2）。
- ✅ 填充率低于 65% 的对象页仍偏空（fz p9/p16/p22），说明文字放大到 16/15 磅的规则对部分页面未生效（Fable r16 L1）。
- ✅ 卡片稿没有来源派生的原生图示（流程、对比卡）；每行超过 400 字的“记录型”表格应改为每行一张卡片页，而不是重复表头的单行表（ml_quant p44–49，Fable r16 L3）。
- ✅ 标题大小写不统一（alpha p2 为句子大小写）；模板间标题基线不一致（Fable r16 L4）。
- ✅ 结尾卡复述了总结小节的要点而该要点因卡片少于 2 条被保留时，应改写要点而非结尾卡（fz p25 第 2 条与 p27 相同，Fable r16 L5）。
- ✅ 模板背景图中的“Made with GAMMA”标识与页码：是否遮盖、是否加页码待用户决定（Fable r16 L6）。
- ✅ 公式中 2–3 个小写字母的下标（`w_mkt`）仍逐字母显示为 m k t（Fable r19 L7）。
- ✅ 小标题覆盖率：收尾调用对部分卡片缺失的小标题是整卡丢弃而不是补齐，两份稿件几乎没有小标题（Fable r19 L8）。
- ✅ 原生页上的公式字号约 12 磅，正文 14 磅，应与正文同号（fz p8，Fable r19 L9）。
- ✅ 拆分表格应先选最高的全宽版式（高 ≥4.2 英寸）再按最少页数定字号；目前 Horizon Choice 6 行被拆成 2+4+孤行、CPCV 2+2+2（ml_quant p12–14、p32–34，Fable r19 F）。
- ✅ 模板 6 的原生页把标题译文放在页眉行（标签右侧），应与主题页一样放在标题下方的译文带（Fable r19 K）。
- ✅ 来源中成对的中英文对象（如 b_0191/b_0192 两份 purge/embargo 图）应合并为一个双语对象只显示一次（Fable r19 I）。
- ✅ 长度预设的取舍应优先省略最短的叶子小节，不省略章节页或结尾卡提到的小节；可把被省略小节的一条要点并入相邻卡片（ml_quant “Classification vs Regression”，Fable r19 L）。
- ✅ 记录型表格（每行超过 400 字）改为每行一张卡片页；结尾的 2 条要点页在版式有空间时并入最后一行页（ml_quant p44–49，Fable r19 L10）。
- ✅ 行内代码在 “KFold(shuffle=True” 内部断行，应整段不断行或只在 “.”/“_” 处断（ml_quant p46，Fable r19 L11）。
- ✅ 行内公式中的 `\underbrace` 标注目前被去掉而没有图例（只有独立公式块会生成图例行）。
- ✅ alpha p8 的 8 步流程图（Gauntlet）未生成：步骤图应由来源的编号列表决定，而不是模型选的版式（Fable r22）。
- ✅ 按词截短的标题可能断在半句（fz “Worked Example: A 2×3 Sort on a 12-Stock”）：截短前应先尝试主题标题以外的更短改写（Fable r22）。
- ✅ 单要点陈述卡应使用陈述版式 24 磅，而不是模板 6 原生页 12 磅（ml_quant p41，Fable r22）。
- ✅ 主语言标题在槽位放得下时也应加 “(cont.)”，目前续页英文标题多未标记（Fable r22）。
- ✅ 模板预览对话框可加全部页面的缩略图条（懒加载、当前页高亮、点击跳转）与 ←/→ 键翻页；本次只修正了页数（Fable 决定延后：需要加载/失败状态、手机布局与无障碍）。


### PPT 卡片稿模板媒体与提示词遗留（2026-10-25）

见[执行计划](completed/ppt-option-d-techdebt-20261024.md)与[提示词清单](../research/ppt-prompt-inventory-20261025.md)。

- 模板只有 4 张相似的楼宇照片：限制重复（每张 ≤⌈内容页/6⌉ 次、不相邻）后带图页约 50%，低于 70% 的设想。服务线的生成配图（桌面端桥接）与照片焦点裁切本 POC 未接入。
- T2 的四环链条图（无文字）可作 4 步流程图复用，需先做像素级“无文字”校验与标签位映射（Fable S5，延后）。
- mlq b_0199（7×3，1,475 字）在 11 磅下仍需 2 页；10 磅才能一页，低于所有字号下限（Fable 决定不采用，待用户确认）。
- 卡片提示词与主题提示词的规则重复（`cardRules` 与 `cardTopicTask`），以及代码已负责的规则（重复数字的引用、去序号、公式恢复）仍写在提示词里；`estimate` 恒为 null 的死分支。
- 内置模板（非原生）上的写手提示：`writingGuide` 与卡片合同矛盾（“短名称＋完整解释”、结尾“感谢观看”）；写手失败时没有回退，整页失败。
- AI 检查（`ai-check`）仍使用旧的来源账本评分标准（选择账本、备注/摘要去向、义务表），卡片稿缺少对应数据。
- 废弃但仍被多个工作流测试引用的旧提示词构建器：`ppt-outline-protocol` 的 skeleton/delta/metadata/relation/ownership 提示词、`editorialSkeletonPrompt`、`semanticGroupsPrompt`/`semanticEditorialPrompt`、`continuationTask`、`outlineContentContract`/`terminologyLockPrompt`；连同导航、标题投影、写后合并、页数重估、摘要修复等已被守卫关闭的流程，择期整体清理。
- 编辑器窄窗口（约 630px）下，选中对象后弹出的 AI 优化浮层（`选区AI优化`，固定定位）会盖住版式面板的按钮（如 T5 的“显示为原表”），需先点“取消”。可在打开工具面板时收起浮层，或在窄屏把浮层锚定到画布区域。
- 表格切换（T5）在 48 页项目上每次约 17 秒；同一项目的一次读取也要约 19 秒，耗时主要在整份项目的加载、重建渲染树与保存，未单独分析。
- AI 编辑是同步模型调用（关闭思考后约 4 秒）；只因超出文本框被拒时重试一次（Fable D2′）。数据编辑同样不开思考，若数字核对开始失败再单独放开。异步编辑任务（提交＋轮询）仍为可选改进。
- 内存中的项目把模板图片内联成 data URI（48 页带照片的稿子约 420 MB），每次读取都要还原，读一次项目约 19 秒。旁路文件已改为媒体引用；内存表示本身（按引用延迟加载）未改。
- ~~模板重排每次试排都重建全部页面~~：已改为按（页序、模板页、使用序号）缓存单页构建（`fidelityMemo`，Fable D3(a)）。与原实现逐字节一致；一次重排 mlq 16.0→5.9 秒、fz 11.1→6.2 秒、alpha 2.5→0.6 秒。剩余耗时主要是页面评分。
- 冒烟测试在开发模式下依赖超大开发包（46 MB），与 live 生成共用服务器或冷编译时会加载超时；验收时用独立服务器、2 并发。
- ~~版式复用上限尚未作为硬规则~~：已移植（`nativeCardSlots`，`lib/ppt-card-pages.mjs`）：同一模板页（不分变体）按阅读顺序最多 max(2, ⌊N/5⌋) 个原生卡片页，超出的页面改用主题页；主题页与对象页不计入（Fable）。selftest 覆盖。本模板的 fz/alpha/mlq 没有原生卡片页（带模板版式的都是对象页），live 轮次没有实际触发上限；下一次需在带原生卡片版式的模板（用户反映 “11 页里 3 页同一版式” 的那份）上做 live 验证。
- 编辑器 “恢复” 在 48 页稿子上约 91 秒（mlq-r41；r42 与 selftest 并行时 5 分钟，超过脚本 300 秒超时）：`deck.replace` 的校验对整份稿子两次运行 `reviewProject`。与项目加载（内联图片、读取约 19 秒）一并处理。
- 主题 “要点” 页占比高（alpha 9/14、mlq 23/48）：按卡片形状变化（网格、步骤、KPI 徽章、横幅），不计入版式上限（Fable）。
- 来源章节是代码时（如 mlq “End-to-End Worked Example”），卡片只剩一句：应给出“见代码”要点或并入相邻卡片。
- 多条中英文要点之间没有段距，部分页面较密。
- 对分章页（列出各节标题）请求 AI “精简” 时，提案与原文相同、静默返回（fz-r43 第 5 页，live 脚本记为 candidate:false）。编辑器应明确拒绝或提示 “分章页没有可精简的正文”（Fable）。
- 本机负载很高（40–280，来自其他会话）时，会启动 LibreOffice 的 selftest 可能卡住：`selftest-ppt-input-visuals` 在 2026-10-26 的整合验收中卡了约 2 小时，单独运行 108 秒通过。超时只结束了 node 进程，留下的 soffice 子进程仍占着输出管道。逐个运行 selftest 时应按进程组结束（或在 selftest 内给子进程设超时），与 `caffeinate`、生产构建冒烟同属环境陷阱。

## PPT 超大必选关系图在内置模板里没有合法放置（2026-10-22，同日已解决）

见 [ppt-pipeline-unblocked-20261022 的"1.6"](completed/ppt-pipeline-unblocked-20261022.md)。`selftest-ppt-gamma-http` 曾因此失败。

- **P1 必选关系图无处可放**：通过图审计的来源图会生成 required 的 `source-relations` 媒体任务；`relationalComponent` 只在一页拥有整张表时才画图，be5cd92e 起表格退回被 `inspectFrozenOutlineSources` 阻断。gamma.md + light 模板下，b_0017（17 节点，14pt 仍需 8.43 英寸）和 b_0061（16.2pt 下限需 5.11 英寸）超过 5.075 英寸正文区；两者来源规则只允许 `slides`、不可省略，行切分又过不了门禁。大纲停在 `capacity_blocked`，409 提示"重新分配或增加页数"，两者都无效。修法需产品决策，候选：无法整页放下的必选图按行范围分页，每页画连通子图或作为 `needs_review` 表格退回；允许对超大受保护图使用 `summaryGraph`；退回表格前先尝试 bounded 字号（`fitSourceLayout` 现在遇到 `componentFallbacks` 直接返回，单这一项救不了 b_0061）。修好后按新规则调整 gamma-http 夹具对这两个图的分配。
- **2026-10-22 已解决**（用户批准的产品改动）：放不下一页的关系图按相邻行范围拆成多张部分图，跨部分的边以延续卡片在两边都可见，表格退回门禁不变；新增"不必要的拆分""非相邻拆分"两个阻断问题。见 [超大关系图跨页拆分](completed/ppt-relation-graph-split-20261022.md)。`fitSourceLayout` 遇到表格退回不先试 bounded 字号的行为保留（单这一项救不了 b_0061）。

## PPT 大纲到成稿畅通之后的遗留（2026-10-22）

见 [ppt-pipeline-unblocked-20261022](completed/ppt-pipeline-unblocked-20261022.md)。真实验收第 2 轮已 5/5 到可发布，以下不影响畅通：

- **P1 本机渲染可见性未验证**：用户同意用 Homebrew 安装 LibreOffice，但首次启动即被系统结束（SIGKILL）、应用随后被移除，疑为 Avast 拦截；已卸载残留。本机发布记为"渲染校验未运行"，7 个依赖 LibreOffice 的 selftest 跳过。需要在 Avast 里放行后 `brew reinstall --cask libreoffice`，或在带 soffice 的 CI 容器里跑（`PPT_REQUIRE_SOFFICE=1`）。
- **P1 存在但不能运行的 soffice 会拦下所有发布**：阶段 2 把"有 soffice 但转换失败"当作阻断（正确），但一个指向已删除应用的 Homebrew 包装（`/usr/local/bin/soffice`）也落在这一类，本机曾因此每次发布都失败。思路：可用性判断加一次 `soffice --version` 探测，探测失败（126/127、找不到可执行文件）记为不可用；探测成功后的转换失败仍阻断。注意探测耗时。
  - **2026-10-22 已解决**：导出校验先跑一次 `soffice --headless --version`（60 秒超时）。启动不了、退出码非 0、没有输出或超时都记为渲染校验"不可用"（附原因），照常发布；探测通过后转换失败仍阻断。`selftest-ppt-export-visibility-unavailable` 覆盖：没有 soffice、指向已删除应用的启动器（127）、启动即被结束（-9）、能运行但转换失败。导出对话框的文字改为"本机的 LibreOffice 不可用（未安装或无法运行）"。
- **P2 阶段 5 降调用（O2 / O3 全量 / O4）**：第 2 轮大纲 17–25 次调用、生成 8–14 次，每次 5–10 分钟。不影响畅通，按需再做。
- **P2 提示的后续交互**：任务卡"N 项待复核"、重新发布只重审改动过的页，还没做。
- **P3 规范化层"节点内同句重复"**：计划里列了，但没有真实回复样本，规范化层不改正文，等有样本再加。
- **P3 gamma-http 运行时间**：单独约 3 分钟，机器繁忙时超过本机批量脚本的 240 秒上限（官方运行器 900 秒）。

- **P2 真实演示文稿作模板的余项**：母版/版式内容清除、旧文字检查、外链图片退役已在第 4b 步完成。未做：`templatePurpose`（人物、时间线、logo 墙、引言、指标页的识别）与空洞评分（report `84f9e527` 缺口 3、4），本机没有 tesseract，保留图片里的文字只计数提示。
- **P3 导出校验图片遮罩比较缺夹具测试**（2026-10-26）：遮罩现按标记比较（去掉命名空间声明），只用重新导出线上 pdf-gph6 验证过；还缺一个源文件根元素声明额外命名空间、导出时重建幻灯片的夹具测试。
- **P3 PDF 的图与图注**（2026-10-27）：双栏论文的图注随所在栏的文字流读取；图片本身按页提取，还没有把图注绑定到对应图片（Fable 提到的子图裁切也未处理）。
- **P3 致谢章节**：参考文献已不成卡片主题，致谢（Acknowledgements）仍可能成为主题，需要时按同一规则处理。
- **P2 模板卡片页带图（Fable 选项 B）**：模板上的卡片页现在不放图，图都进图页（选项 A）。后续：主题卡片页在要点旁加一列图（参照 `artworkPreservingFit` 保留模板插图的方式），放不下时退回图页；需要在图多的稿子上单独跑一轮实测。
- **P3 Figure 7 未识别**（world_models.pdf 第 3 页）：该图既不是位图也不是聚得起来的矢量区，目前没有被识别为图。
- **P3 大纲编辑图页**：用户在大纲里编辑图页（删改、移动）时服务器的处理还没有专门测试。


## PPT 合并 main 的 10-13 修复之后（2026-10-26）

见 [ppt-integration-option-d-mainline-20261026](active/ppt-integration-option-d-mainline-20261026.md) 的“合并 main 的 10-13 修复”。

- **P2 卡片的行高与字号覆盖（Fable Q1(a)）**：作者改卡片的行高或字号时，卡片容量要按新值重新测量（布局、导出、校验三处一致）。现在只覆盖字体、粗细、斜体、下划线，这些不影响容量。
- **P3 测量器对粗体不敏感**：`measureText` 不区分字重；目前靠 30% 以上的余量兜住（全粗体卡片实际溢出在测量 130%–160% 之间）。若以后收紧余量，需要加粗体宽度系数。
- **P3 `real-fixture` 基线**：靠章节主题迁移表对齐当前分段（已 4 页）。再多两页需要迁移时，在当前分段下重生成基线并去掉迁移表。
- **P2 main 的垃圾文件（Fable Q2）**：`e1929ae7` 带进 `outputs/`、`.ppt-build/`、`apps/cowork-server/node_modules`（katex 0.19.0 等）、`cowork-audit.log`、`public/System/Library/Fonts/Supplemental/Arial.ttf`。合并进 main 后用单独提交 `git rm --cached` 并加 `.gitignore`；先让 cowork-server 自己安装依赖并验证 KaTeX 输出，查清是否有代码引用该 Arial.ttf 路径。需用户批准。

