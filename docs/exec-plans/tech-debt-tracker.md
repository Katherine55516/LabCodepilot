# Tech Debt Tracker / 技术债务追踪

已知技术债务清单。每项标注优先级、影响范围和初步解决思路。

**AI 须知：发现新的技术债务时添加到此文件；解决后标注完成日期。**

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

## 已解决

| # | 描述 | 解决日期 | 解决方式 |
|---|------|----------|----------|
| 7 | `project-mcp-injection.test.ts` 的 "resolves ${...} env placeholders" 被 `process.env.CI ? it.skip : it` 跳过 | 2026-07-09 | 原条目归因（tsx 在 linux 与 macOS 上 module identity 去重不一致）不成立：`db.ts` 在 tsx 下本就会被 CJS 与 ESM 两套注册表各求值一次，与平台、与 `@/` 别名均无关。真正的根因是 `db.ts` 把 `dataDir` / `DB_PATH` 写成模块顶层 `const`，于是两个实例各自钉死一个 `CLAUDE_GUI_DATA_DIR` 快照，测试侧 `setSetting` 与 prod 侧 `getSetting` 落在不同的 SQLite 文件上。改为惰性函数求值后两个实例指向同一文件，守卫已移除，该用例在 `CI=true` 下正常执行 |
| 13(旧,编号曾与上传条目重复) | 测试工作台「执行」步在打包版跑不起来（@playwright/mcp 不在 asarUnpack + Chromium 未随包） | 2026-07-09 确认 | `scripts/bundle-chromium.mjs`（electron:pack* 链内）用 @playwright/mcp 自带 revision 装 chromium-headless-shell → electron-builder extraResources 复制进包内 `resources/ms-playwright`，运行时经 `AILAB_RESOURCES_PATH` 定位 `--executable-path` 启动（见 electron-builder.yml:127-133、prompts.ts buildPlaywrightMcp）。回归用例库 v2 打包验收时一并复核真跑 |
| 18(新增,与上表 18 不同类) | `GET /api/test/media` 与 `POST /api/test/defect` 不接受 `roundId` —— v2 一期把产物迁进 `report/{task}/{roundId}/`、证据迁进 `_evidence/{task}-{env}-{roundId}` 之后，轮次维度的证据**根本取不到**，缺陷单也会读错（平铺的）run.json | 2026-07-10 | 两处均补 `roundId` 参数 + `isUnsafeSegment` 段安全校验（穿越返回 400，已验证）；缺省行为不变，普通任务零影响 |
| 19(新增) | `writeLibrary` 无 `seq` 写入序号，`updatedAt` 毫秒粒度下同一毫秒的两次写入无法区分 → 依赖它做失效判断的读侧缓存会漏更新 | 2026-07-10 | 补 `seq`（与 `rounds.ts`/`suites.ts` 同款），`case-history` 缓存改用 `seq` 作变更令牌；单测捕获并钉死 |
