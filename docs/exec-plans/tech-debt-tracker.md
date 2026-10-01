# Tech Debt Tracker / 技术债务追踪

已知技术债务清单。每项标注优先级、影响范围和初步解决思路。

**AI 须知：发现新的技术债务时添加到此文件；解决后标注完成日期。**

## PPT 可见事实深度待治理（2026-10-01）

- 高优先级：建立来源对象/必需细节→实际渲染事实账本；本轮已加入来源表行名/部分基数检查，但章节映射和字数目标不能证明表格每列关系、公式条件、所有清单数量完整，也不能可靠识别所有标题正文语义错配。先以用户选定模型作同源A/B，再扩展对象级门禁；见 [Factor Zoo 对照](../research/ppt-factor-zoo-content-depth-comparison.md)。
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
